/* ══════════════════════════════════════════════════════════════════════════
   JORNADA DO MOTOR ÚNICO — ciclo incremental e iterativo
   ----------------------------------------------------------------------------
   Prova o contrato central:
     medir -> ordenar lacunas -> atacar até 3 matérias -> novo retrato ->
     reordenar tudo -> rotacionar quem perdeu prioridade -> repetir.
   ========================================================================== */
window.RODAR_JORNADA = function () {
  const falhas = [], notas = [];
  const T = DesempenhoTecScreen, M = MotorSugestao, C = MotorCiclo;
  const F = (passo, o, det) => falhas.push(Object.assign({ passo, o }, det || {}));
  const root = (nome, q, ac) => ({ depth: 0, codigo: null, nome, disciplina: nome, questoes: q, acertos: ac });
  const top = (nome, disc, q, ac) => ({ depth: 1, codigo: '01', nome, disciplina: disc, questoes: q, acertos: ac });
  const snap = (id, data, specs) => {
    const rows = [];
    specs.forEach(x => { rows.push(root(x[0], x[1], x[2]), top('Núcleo de ' + x[0], x[0], x[1], x[2])); });
    return { id, nome: id, date: data, startDate: data.slice(0, 8) + '01', endDate: data, rows };
  };

  const s1 = snap('r1', '2026-01-31', [
    ['A',100,40], ['B',100,50], ['C',100,60], ['D',100,70]
  ]);
  const s2 = snap('r2', '2026-02-28', [
    ['A',125,120], ['B',125,70], ['C',125,80], ['D',125,88]
  ]);
  const s3 = snap('r3', '2026-03-31', [
    ['A',150,105], ['B',150,150], ['C',150,110], ['D',150,90]
  ]);

  const orig = {
    getSnaps: DB.getTecSnapshots, getExtras: DB.getExtras, saveExtras: DB.saveExtras,
    scoped: T.scopedSnapshot, active: T.activeSnapshots
  };
  const prefsKey = M._key();
  const prefsAntes = localStorage.getItem(prefsKey);
  let snaps = [s1], banco = [];

  try {
    DB.getTecSnapshots = () => snaps;
    DB.getExtras = () => banco;
    DB.saveExtras = (l) => { banco = l; };
    // Análise e Motor compartilham exatamente o mesmo período consolidado.
    T.scopedSnapshot = () => T.aggregate(snaps);
    T.activeSnapshots = () => snaps.slice();
    M.salvar({ fase: 'pre', minAmostra: 20, alvoQuestoes: 25, maxFrentes: 3, metaAcerto: 90, disciplinasSel: [] });

    const ranking = () => {
      const r = M.calcular();
      if (!r || r.erro) { F('ranking', 'motor nao calculou', { erro: r && r.erro }); return { itens: [], disciplinas: [], prefs: M.prefs() }; }
      for (let i = 1; i < r.disciplinas.length; i++) {
        if (r.disciplinas[i - 1].lacunaDisc < r.disciplinas[i].lacunaDisc - 1e-9) {
          F('ranking', 'ordem nao segue a maior lacuna', {
            antes: r.disciplinas[i - 1].nome, depois: r.disciplinas[i].nome
          });
        }
      }
      return r;
    };
    const criarRodada = (r) => {
      let n = 0;
      (r.itens || []).forEach(x => {
        if (T.criarExtraDoMotor(x.nome, x.disciplina, x.dose, 'reforco', true, x)) n++;
      });
      return n;
    };

    // Rodada 1: A, B, C são as três maiores lacunas.
    let r = ranking();
    const ordem1 = r.disciplinas.slice(0, 4).map(d => d.nome);
    if (ordem1.join(',') !== 'A,B,C,D') F('rodada-1', 'ranking inicial inesperado', { ordem1 });
    const criadas1 = criarRodada(r);
    if (criadas1 !== 3) F('rodada-1', 'nao criou exatamente tres frentes', { criadas1 });
    const ativas1 = banco.filter(e => e.status !== 'concluida' && C.origemDe(e));
    if (new Set(ativas1.map(e => C.origemDe(e).disciplina)).size !== ativas1.length) {
      F('rodada-1', 'abriu duas frentes da mesma disciplina');
    }
    notas.push({ passo: 1, ordem: ordem1, criadas: criadas1 });

    // Novo retrato: A melhora muito. B/C continuam piores; D entra no lugar de A.
    snaps = [s1, s2];
    const atual2 = M.retratoAtual();
    if (!atual2 || atual2.id !== '__agg__' || atual2.count !== 2) {
      F('rodada-2', 'Motor nao usou todo o periodo selecionado', { atual: atual2 && atual2.id, count: atual2 && atual2.count });
    }
    r = ranking();
    const ordem2 = r.disciplinas.slice(0, 4).map(d => d.nome);
    if (ordem2.slice(0, 3).join(',') !== 'B,C,D') F('rodada-2', 'materia melhorada nao liberou a vaga', { ordem2 });
    const c2 = C.conciliar();
    if (c2.rotacionadas.length !== 1) F('rodada-2', 'esperava uma rotacao', { c2 });
    const rot1 = banco.find(e => c2.rotacionadas.includes(e.id));
    if (!rot1 || C.origemDe(rot1).disciplina !== 'A') F('rodada-2', 'a materia rotacionada deveria ser A');
    if (banco.some(e => e.status !== 'concluida' && C.origemDe(e))) {
      F('rodada-2', 'a rodada anterior ficou presa depois do novo retrato');
    }
    const criadas2 = criarRodada(r);
    const ativas2 = banco.filter(e => e.status !== 'concluida' && C.origemDe(e)).map(e => C.origemDe(e).disciplina).sort();
    if (ativas2.join(',') !== 'B,C,D') F('rodada-2', 'nova rodada nao assumiu B,C,D', { ativas2 });
    notas.push({ passo: 2, ordem: ordem2, rotacionadas: c2.rotacionadas.length, rodadas: c2.rodadas.length, criadas: criadas2 });

    // Outro retrato: B melhora e cai para 4º. A volta ao top 3 porque sua lacuna,
    // embora pequena, agora é maior que a de B. Nada fica congelado por memória.
    snaps = [s1, s2, s3];
    r = ranking();
    const ordem3 = r.disciplinas.slice(0, 4).map(d => d.nome);
    if (ordem3.slice(0, 3).join(',') !== 'D,C,A') F('rodada-3', 'ranking nao foi recalculado do zero', { ordem3 });
    const c3 = C.conciliar();
    const rot2 = banco.find(e => c3.rotacionadas.includes(e.id));
    if (!rot2 || C.origemDe(rot2).disciplina !== 'B') F('rodada-3', 'B deveria liberar sua vaga ao melhorar', { c3 });
    notas.push({ passo: 3, ordem: ordem3, rotacionadas: c3.rotacionadas.length, rodadas: c3.rodadas.length });

    // Apagar/voltar para retrato antigo NÃO é um novo ciclo.
    snaps = [s1, s2];
    const antesFechadas = C.fechados().length;
    const apagou = C.conciliar();
    if (apagou.fechadas.length !== 0 || C.fechados().length !== antesFechadas) {
      F('retrocesso-retrato', 'retrato antigo foi confundido com retrato novo', { apagou });
    }

    // Contratos arquiteturais.
    if (typeof window.PlanoEngine !== 'undefined' || typeof window.PlanoPontos !== 'undefined' || typeof window.PlanoCiclo !== 'undefined') {
      F('arquitetura', 'engine legado ainda existe no runtime');
    }
    if (!M || !C) F('arquitetura', 'MotorSugestao/MotorCiclo ausente');
    if ((M.calcular().itens || []).length > M.prefs().maxFrentes) F('arquitetura', 'mais de tres disciplinas na rodada');

    const fech = C.fechados();
    const porTipo = {};
    fech.forEach(e => {
      const o = C.origemDe(e), tipo = o && o.veredito && o.veredito.tipo;
      if (tipo) porTipo[tipo] = (porTipo[tipo] || 0) + 1;
    });
    return {
      falhas, notas, totalFalhas: falhas.length,
      resumo: {
        retratos: 3,
        extras: banco.length,
        ciclos: fech.length,
        porTipo,
        ordemInicial: ordem1,
        ordemAposMelhoraA: ordem2,
        ordemAposMelhoraB: ordem3,
        rotacoes: (porTipo.rotacionada || 0)
      }
    };
  } finally {
    DB.getTecSnapshots = orig.getSnaps; DB.getExtras = orig.getExtras; DB.saveExtras = orig.saveExtras;
    T.scopedSnapshot = orig.scoped; T.activeSnapshots = orig.active;
    if (prefsAntes == null) localStorage.removeItem(prefsKey); else localStorage.setItem(prefsKey, prefsAntes);
  }
};
