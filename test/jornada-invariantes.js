/* ══════════════════════════════════════════════════════════════════════════
   A JORNADA E AS INVARIANTES — um ano de uso, conferido passo a passo
   ────────────────────────────────────────────────────────────────────────── */
window.RODAR_JORNADA = function () {
  const falhas = [], notas = [];
  const T = DesempenhoTecScreen, P = PlanoEngine, C = PlanoCiclo;
  const origSnaps = DB.getTecSnapshots, origExtras = DB.getExtras, origSave = DB.saveExtras,
    origEsc = T.scopedSonapshot || T.scopedSnapshot, origInc = DB.getIncidencia,
    origSubs = DB.getActiveSubjects, origModo = window.planCycleMode;
  let snaps = [], banco = [], inc = [];
  const chaveP = DB._profilePrefix() + P.KEY_PREF;
  const antesP = localStorage.getItem(chaveP);
  const F = (passo, o, det) => falhas.push(Object.assign({ passo, o }, det || {}));
  const num = (v) => typeof v === 'number' && isFinite(v);

  const prefs = (patch) => { P._agrC = null; P.salvarPrefs(patch); T._planoRefC = null; T._fatias = null; };
  const soma = (idx, c) => Object.keys(idx).reduce((a, k) => a + (idx[k][c] || 0), 0);

  /* ── AS INVARIANTES, conferidas depois de CADA passo ───────────────────── */
  function conferir(passo) {
    const p = P.prefs();
    // 1. o índice reparticiona: volume e acertos idênticos em qualquer lente
    snaps.forEach(s => {
      const t = TecEngine.totais({ rows: s.rows });
      [0, 10, 20, 30].forEach(piso => {
        P._agrC = null;
        const idx = P._indice(s, Object.assign({}, p, { granPiso: piso, apenasFolhas: true }));
        if (soma(idx, 'q') !== t.questoes || soma(idx, 'ac') !== t.acertos) {
          F(passo, 'indice nao fecha com o retrato', { retrato: s.id, piso, idx: soma(idx, 'q'), retratoQ: t.questoes, idxAc: soma(idx, 'ac'), retratoAc: t.acertos });
        }
      });
      P._agrC = null;
    });
    // 2. o consolidado soma os retratos
    if (snaps.length) {
      const ag = T.aggregate(snaps);
      const tAg = TecEngine.totais({ rows: ag.rows });
      const somaR = snaps.reduce((a, s) => a + TecEngine.totais({ rows: s.rows }).questoes, 0);
      if (tAg.questoes !== somaR) F(passo, 'consolidado != soma dos retratos', { ag: tAg.questoes, soma: somaR });
      [0, 10].forEach(piso => {
        P._agrC = null;
        const idx = P._indice(ag, Object.assign({}, p, { granPiso: piso, apenasFolhas: true }));
        if (soma(idx, 'q') !== tAg.questoes) F(passo, 'indice do consolidado nao fecha', { piso, idx: soma(idx, 'q'), ag: tAg.questoes });
      });
      P._agrC = null;
    }
    // 3. nenhum número podre em nada que a tela usa
    const r = P.calcular(T.scopedSnapshot(), p);
    if (r && !r.erro) {
      if (!num(r.dominioPct) || r.dominioPct < 0 || r.dominioPct > 100) F(passo, 'dominio fora de [0,100]', { dom: r.dominioPct });
      [].concat(r.itens || [], r.pequenas || []).forEach(x => {
        if (x.taxa != null && (!num(x.taxa) || x.taxa < 0 || x.taxa > 100)) F(passo, 'taxa podre', { nome: x.nome, taxa: x.taxa });
        if (x.margem != null && !num(x.margem)) F(passo, 'margem podre', { nome: x.nome, m: x.margem });
        // 3b. A MARGEM NUNCA PODE SER ZERO COM AMOSTRA FINITA
        if (x.margem === 0 && x.qJanela > 0) F(passo, 'margem ZERO com amostra finita', { nome: x.nome, taxa: x.taxa, n: x.qJanela });
        if (!num(x.custoQ) || x.custoQ <= 0) F(passo, 'custo podre', { nome: x.nome, c: x.custoQ });
      });
      // 4. um assunto não pode estar na lista E no segundo plano
      const ks = [].concat(r.itens || [], r.pequenas || []).map(x => x.disciplina + '|' + x.nome);
      if (new Set(ks).size !== ks.length) F(passo, 'assunto repetido entre lista e segundo plano');
    }
    // 5. as invariantes da própria auditoria
    try {
      const a = PlanoAuditoria.gerar({ cadencia: 'avulsa' });
      (a.invariantes || []).filter(i => !i.ok).forEach(i => F(passo, 'invariante da auditoria falhou', { nome: i.nome, det: i.detalhe }));
    } catch (e) { F(passo, 'auditoria lancou', { erro: String(e && e.message) }); }
    // 6. toda atividade viva com volume no histórico NÃO pode ser órfã
    const rr = (r && !r.erro) ? r : { itens: [], pequenas: [] };
    C.emCurso(rr).forEach(v => {
      const vol = P.volumeDoEscopo(v.origem.escopo || { tipo: 'no', membros: [v.origem.topico] }, v.origem.disciplina, p);
      if (v.estado === 'orfa' && vol.q > 0) F(passo, 'atividade viva declarada orfa', { topico: v.origem.topico, q: vol.q });
      if (!num(v.feito) || v.feito < 0) F(passo, 'progresso podre', { topico: v.origem.topico, feito: v.feito });
      if (v.pct > 100 || v.pct < 0) F(passo, 'pct fora de [0,100]', { topico: v.origem.topico, pct: v.pct });
    });
    // 7. TODA atividade encerrada com origem no Plano tem veredito
    DB.getExtras().filter(e => e.origemPlano && e.origemPlano.topico && e.status === 'concluida')
      .forEach(e => { if (!e.origemPlano.veredito) F(passo, 'encerrada SEM veredito', { titulo: e.titulo }); });
    // 8. a calibragem só usa ciclo com ganho medido
    const cal = C.calibragem();
    if (cal && cal.pronta && (!num(cal.qPorPonto) || cal.qPorPonto <= 0)) F(passo, 'calibragem podre', cal);
    return r;
  }

  try {
    DB.getTecSnapshots = () => snaps;
    DB.getExtras = () => banco;
    DB.saveExtras = (l) => { banco = l; };
    DB.getIncidencia = () => inc;
    DB.getActiveSubjects = () => [];
    window.planCycleMode = () => 'pos';
    T.scopedSnapshot = () => (snaps.length > 1 ? T.aggregate(snaps) : snaps[snaps.length - 1]);

    const todos = SIM.retratos(8);
    inc = SIM.incidencia();
    notas.push({ arvore: SIM.folhas() + ' folhas possiveis', incidencia: inc.length + ' linhas',
      retratos: todos.map(s => ({ id: s.id, linhas: s.rows.length, q: TecEngine.totais({ rows: s.rows }).questoes })) });
    prefs({ foco: [], disciplina: '__todas__', minAmostra: 20, metaDominio: 85, tetoDominio: 90,
      limite: 20, ordenar: 'pior', apenasFolhas: true, granPiso: 0, incluirPequenas: false,
      excluidas: [], banca: '__todas__', migracao: 3 });

    // ── PASSO 1: o primeiro retrato ──────────────────────────────────────
    snaps = [todos[0]];
    let r = conferir('1-primeiro-retrato');
    notas.push({ passo: 1, erro: (r && r.erro) || null, assuntos: (r && r.assuntos) || 0,
      pisoOferecido: (r && r.granSugerida) ? r.granSugerida.piso : null,
      unidadesSeLigar: (r && r.granSugerida) ? r.granSugerida.unidades : null,
      medemSeLigar: (r && r.granSugerida) ? r.granSugerida.qualificam : null });

    // ── PASSO 2: ligar a lente que a tela oferece ────────────────────────
    if (r && r.erro === 'amostra' && r.granSugerida) prefs({ granPiso: r.granSugerida.piso });
    r = conferir('2-lente-ligada');
    notas.push({ passo: 2, piso: P.prefs().granPiso, erro: (r && r.erro) || null,
      assuntos: (r && r.assuntos) || 0, dom: (r && r.dominioPct != null) ? +r.dominioPct.toFixed(1) : null });

    // ── PASSO 3: criar atividades (reforço e diagnóstico) ────────────────
    const criar = (n) => {
      const rr = P.calcular(T.scopedSnapshot(), P.prefs());
      if (!rr || rr.erro) return 0;
      let feitos = 0;
      [].concat(rr.itens || []).slice(0, n).forEach(x => {
        if (T.criarExtraDoPlano(x.nome, x.disciplina, x.custoQ || 30, 'reforco', true)) feitos++;
      });
      [].concat(rr.pequenas || []).slice(0, 2).forEach(x => {
        if (T.criarExtraDoPlano(x.nome, x.disciplina, x.faltaAmostra || 20, 'diagnostico', true)) feitos++;
      });
      return feitos;
    };
    const c1 = criar(5);
    r = conferir('3-atividades-criadas');
    notas.push({ passo: 3, criadas: c1, extras: banco.length,
      diagnosticos: banco.filter(e => e.origemPlano && e.origemPlano.motivo === 'diagnostico').length });

    // ── PASSO 4: importações mensais, com conciliação a cada uma ─────────
    for (let m = 1; m < 5; m++) {
      snaps = todos.slice(0, m + 1);
      T._cicloSel = null;
      const rc = C.conciliar();
      r = conferir('4-import-mes' + (m + 1));
      notas.push({ passo: '4.' + (m + 1), retratos: snaps.length, fechadas: rc.fechadas.length,
        vereditos: rc.vereditos.map(v => v.tipo), assuntos: (r && r.assuntos) || 0,
        dom: (r && r.dominioPct != null) ? +r.dominioPct.toFixed(1) : null });
      if (m === 2 && banco[0]) { DB.addExtraProgress(banco[0].id, 12); conferir('4b-progresso-manual'); }
    }

    // ── PASSO 5: encerrar uma na mão — o caminho do usuário ─────────────
    let viva = banco.find(e => e.origemPlano && e.status !== 'concluida' && e.origemPlano.motivo !== 'diagnostico');
    if (!viva) {
      const rr5 = P.calcular(T.scopedSnapshot(), P.prefs());
      const abertos = new Set(banco.filter(e => e.origemPlano && e.status !== 'concluida')
        .map(e => e.origemPlano.disciplina + '|' + e.origemPlano.topico));
      const x5 = rr5 && !rr5.erro ? (rr5.itens || []).find(x => !abertos.has(x.disciplina + '|' + x.nome)) : null;
      if (x5) {
        T.criarExtraDoPlano(x5.nome, x5.disciplina, x5.custoQ || 30, 'reforco', true);
        viva = banco.find(e => e.origemPlano && e.status !== 'concluida' && e.origemPlano.motivo !== 'diagnostico');
      }
    }
    if (viva) {
      if (globalThis.ReforcoAgendaAuto && typeof ReforcoAgendaAuto.finalizarCiclo === 'function') ReforcoAgendaAuto.finalizarCiclo(viva.id, todayLocal());
      else DB.setConcluidaDia(viva.id, todayLocal(), true);
    }
    conferir('5-concluida-na-mao');
    const vd = viva ? (banco.find(e => e.id === viva.id) || {}).origemPlano : null;
    notas.push({ passo: 5, encerrada: viva ? viva.titulo : null,
      veredito: vd && vd.veredito ? vd.veredito.tipo : null,
      ganhoPP: vd && vd.veredito ? vd.veredito.ganhoPP : null,
      semVeredito: banco.filter(e => e.origemPlano && e.status === 'concluida' && !e.origemPlano.veredito).length });

    // ── PASSO 6: lançamento manual que alcança o alvo ───────────────────
    const v2 = banco.find(e => e.origemPlano && e.status !== 'concluida');
    if (v2) DB.addExtraProgress(v2.id, (v2.alvo || 30) + 5);
    conferir('6-alvo-alcancado-na-mao');
    const v2d = v2 ? (banco.find(e => e.id === v2.id) || {}).origemPlano : null;
    notas.push({ passo: 6, alvoAlcancado: v2 ? v2.titulo : null,
      status: v2 ? (banco.find(e => e.id === v2.id) || {}).status : null,
      veredito: v2d && v2d.veredito ? v2d.veredito.tipo : null });

    // ── PASSO 7: mais retratos e criação em lote ────────────────────────
    snaps = todos.slice(0, 7);
    T._cicloSel = null; C.conciliar();
    const c2 = criar(6);
    r = conferir('7-lote');
    notas.push({ passo: 7, criadas: c2, extras: banco.length });

    // ── PASSO 8: apagar um retrato ANTIGO, com progresso já medido ──────
    snaps = todos.slice(0, 8);
    T._cicloSel = null; C.conciliar();
    r = P.calcular(T.scopedSnapshot(), P.prefs());
    const antesDel = C.emCurso(r && !r.erro ? r : { itens: [] }).map(v => ({ t: v.origem.topico, medido: v.medido }));
    const foto = C.fotoDoProgresso();
    snaps = todos.slice(1, 8);                       // apagou o primeiro retrato
    P._agrC = null;
    const repin = C.repinarProgresso(foto);
    T._cicloSel = null; C.conciliar();
    const r2 = P.calcular(T.scopedSnapshot(), P.prefs());
    const depoisDel = C.emCurso(r2 && !r2.erro ? r2 : { itens: [] }).map(v => ({ t: v.origem.topico, medido: v.medido }));
    const zerou = antesDel.filter(a => { const d = depoisDel.find(x => x.t === a.t); return d && a.medido > 0 && d.medido === 0; });
    const mudou = antesDel.filter(a => { const d = depoisDel.find(x => x.t === a.t); return d && d.medido !== a.medido; });
    if (zerou.length) F('8-apagar-retrato', 'progresso ZERADO ao apagar retrato', { quantas: zerou.length, exemplo: zerou[0] });
    conferir('8-apagar-retrato');
    notas.push({ passo: 8, vivas: antesDel.length, comProgresso: antesDel.filter(a => a.medido > 0).length,
      zeraram: zerou.length, mudaram: mudou.length, repinadas: repin });

    // ── PASSO 9: lente, foco e ordens ──────────────────────────────────
    snaps = todos.slice(0, 8);
    [0, 10, 20, 30].forEach(piso => { prefs({ granPiso: piso }); conferir('9-piso' + piso); });
    prefs({ granPiso: 20 });
    const discs = P.disciplinas(T.scopedSnapshot());
    prefs({ foco: discs.slice(0, 3) });
    const rf = conferir('10-foco3');
    const so = discs.slice(0, 3).map(d => { prefs({ foco: [d] }); const x = P.calcular(T.scopedSnapshot(), P.prefs()); return (x && x.assuntos) || 0; });
    prefs({ foco: discs.slice(0, 3) });
    const somaSo = so.reduce((a, b) => a + b, 0);
    if (rf && !rf.erro && rf.assuntos !== somaSo) F('10-foco3', 'foco de 3 != soma dos 3 recortes', { foco: rf.assuntos, soma: somaSo });
    notas.push({ passo: 10, foco3: (rf && rf.assuntos) || 0, somaDe3: somaSo });
    prefs({ foco: [] });
    ['pior', 'rendimento', 'ganhoDominio', 'volume', 'queda', 'banca'].forEach(ord => { prefs({ ordenar: ord }); conferir('11-ordem-' + ord); });
    prefs({ ordenar: 'pior' });

    // ── PASSO 11: excluir matéria, e o aprendizado ─────────────────────
    prefs({ excluidas: [discs[0]] });
    conferir('12-materia-excluida');
    prefs({ excluidas: [] });
    /* ── O DESFECHO DO DIAGNÓSTICO, EXERCITADO DE PROPÓSITO ─────────────────
       Se depender do sorteio, um dos dois diagnósticos orgânicos pode acabar a
       jornada sem alcançar a amostra — e a conferência mais importante deste
       conserto passaria a depender da sorte. Aqui a régua é cobrada num caso
       construído: um diagnóstico sobre unidade que JÁ mede tem de encerrar como
       "mediu", nunca como "não funcionou". */
    {
      const rr = P.calcular(T.scopedSnapshot(), P.prefs());
      const gorda = [].concat((rr && rr.itens) || []).find(x => x.qJanela >= P.prefs().minAmostra);
      if (!gorda) F('13-diagnostico', 'a jornada nao achou unidade que mede para testar o diagnostico');
      else {
        const e = DB.addExtra({ titulo: 'Diagnosticar: ' + gorda.nome, tipo: 'questoes',
          alvo: 10, periodo: 'unica', contaMetricas: false });
        DB.updateExtra(e.id, { origemPlano: C.origem(gorda.nome, gorda.disciplina, gorda, { motivo: 'diagnostico' }) });
        const v = C.avaliar(DB.getExtras().find(x => x.id === e.id), rr, null);
        if (!v || v.estado !== 'mediu') F('13-diagnostico', 'diagnostico sobre assunto que mede nao encerrou como "mediu"', { estado: v && v.estado });
        T._cicloSel = null;
        C.conciliar();
        const vd = (DB.getExtras().find(x => x.id === e.id) || {}).origemPlano || {};
        if (!vd.veredito || vd.veredito.tipo !== 'mediu') F('13-diagnostico', 'conciliar nao fechou o diagnostico como "mediu"', { veredito: vd.veredito });
        if (vd.veredito && vd.veredito.ganhoPP != null) F('13-diagnostico', 'diagnostico reivindicou ganho, e vai envenenar a calibragem', { ganhoPP: vd.veredito.ganhoPP });
        conferir('13-diagnostico');
      }
    }
    const fech = C.fechados();
    const diagErrado = banco.filter(e => e.origemPlano && e.origemPlano.motivo === 'diagnostico'
      && e.origemPlano.veredito && e.origemPlano.veredito.tipo === 'naoFuncionou');
    if (diagErrado.length) F('13-desfechos', 'diagnostico julgado como "nao funcionou"', { quantos: diagErrado.length });
    notas.push({ passo: 13, ciclosFechados: fech.length,
      porTipo: fech.reduce((a, v) => { a[v.tipo] = (a[v.tipo] || 0) + 1; return a; }, {}),
      semMedicaoNova: fech.filter(v => v.semMedicaoNova).length,
      calibragem: C.calibragem() });

    /* ── A JORNADA TEM DE TER PASSADO PELOS CAMINHOS QUE ELA PROMETE ────────
       Um teste que não exercita nada também não falha. Estas conferências
       cobram que a simulação realmente tenha criado atividade, fechado ciclo,
       encerrado na mão e apagado retrato — senão o zero de falhas é vazio. */
    const nota = (k) => notas.find(n => n.passo === k) || {};
    if (!nota(1).pisoOferecido) F('cobertura', 'a tela nao ofereceu lente no 1o retrato (arvore funda ficaria sem Plano)');
    if (!(nota(2).assuntos > 0)) F('cobertura', 'o Plano nao existiu nem com a lente ligada no 1o retrato');
    if (!(nota(3).criadas > 0) || !(nota(3).diagnosticos > 0)) F('cobertura', 'a jornada nao criou reforco e diagnostico', nota(3));
    if (!nota(5).veredito) F('cobertura', 'encerrar na mao nao gravou veredito', nota(5));
    if (!nota(6).veredito) F('cobertura', 'alcancar o alvo na mao nao gravou veredito', nota(6));
    if (!(nota(8).comProgresso > 0)) F('cobertura', 'apagar retrato foi testado sem atividade com progresso', nota(8));
    if (nota(8).zeraram !== 0 || nota(8).mudaram !== 0) F('cobertura', 'apagar retrato mexeu no progresso medido', nota(8));
    if (!(nota(13).ciclosFechados > 0)) F('cobertura', 'nenhum ciclo foi julgado na jornada', nota(13));
    if (!nota(13).porTipo || !nota(13).porTipo.mediu) F('cobertura', 'nenhum diagnostico foi encerrado como "mediu"', nota(13));
    return { falhas, notas, totalFalhas: falhas.length,
      resumo: { retratos: (nota(1).pisoOferecido != null) ? 8 : 8, extras: nota(7).extras || 0,
        ciclos: nota(13).ciclosFechados || 0, porTipo: nota(13).porTipo || {},
        pisoOferecido: nota(1).pisoOferecido, assuntos1: nota(2).assuntos,
        progressoPreservado: nota(8).comProgresso || 0, repinadas: nota(8).repinadas || 0 } };
  } finally {
    DB.getTecSnapshots = origSnaps; DB.getExtras = origExtras; DB.saveExtras = origSave;
    DB.getIncidencia = origInc; DB.getActiveSubjects = origSubs; window.planCycleMode = origModo;
    T.scopedSnapshot = origEsc; P._agrC = null; T._planoRefC = null;
    if (antesP == null) DB.delRaw(chaveP); else DB.setRaw(chaveP, antesP);
  }
};
