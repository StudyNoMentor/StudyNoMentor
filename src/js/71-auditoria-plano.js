/* ═══════════════════════════════════════════════════════════════════════════
   AUDITORIA DO PLANO — o retrato que prova (ou desmente) que o módulo funciona
   ───────────────────────────────────────────────────────────────────────────
   Este arquivo não calcula nada. Ele COLETA: junta num único JSON tudo que é
   preciso para alguém de fora reproduzir cada número da tela do Plano, julgar
   se ele está ajudando de verdade e apontar onde evoluir.

   A regra que define o conteúdo: um dado só entra se, faltando ele, uma
   pergunta de auditoria ficaria sem resposta.

     · os PARÂMETROS entram porque sem eles nenhum número é reproduzível —
       "domínio 78%" não quer dizer nada sem saber a meta, o teto, o piso de
       amostra e a janela que o produziram;
     · a SÉRIE entra porque evolução é a única pergunta que um retrato isolado
       não responde;
     · o CICLO DAS ATIVIDADES entra porque é a única evidência CAUSAL do
       módulo: o Plano mandou atacar, a pessoa atacou, e a medição seguinte
       disse se funcionou. Sem isso, tudo o mais é correlação;
     · a QUALIDADE DO DADO entra porque metade dos diagnósticos errados do
       Plano não são erro de conta: são amostra curta demais para sustentar a
       conta. Um auditor que não vê a mediana de questões por assunto vai
       culpar a fórmula;
     · as INVARIANTES entram porque o arquivo precisa se auto-conferir. Se o
       acumulado não fecha com o domínio mais os ganhos NA HORA DA EXPORTAÇÃO,
       o resto do arquivo não merece confiança, e isso tem de vir escrito;
     · o LEDGER de exportações anteriores entra porque a tendência não pode
       depender de a pessoa ter guardado todos os arquivos.

   O que NÃO entra: nome do perfil, e-mail, qualquer credencial. O arquivo é
   feito para ser enviado a outra pessoa — o que ele carrega é o estudo, não
   a identidade de quem estuda. Quem quiser esconder até os nomes das matérias
   exporta em modo anônimo, e os nomes viram apelidos estáveis (o mesmo assunto
   recebe o mesmo apelido em toda exportação, para dar para comparar).
   ═══════════════════════════════════════════════════════════════════════════ */
const PlanoAuditoria = {
  VERSAO: 1,
  KEY_LEDGER: 'plano-auditoria-ledger',
  MAX_ASSUNTOS: 500,
  MAX_LEDGER: 60,

  _apelido(s) {
    const t = String(s == null ? '' : s);
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
    return 'a' + h.toString(36);
  },
  _num(v, casas) {
    if (v == null || typeof v !== 'number' || !isFinite(v)) return null;
    const f = Math.pow(10, casas == null ? 2 : casas);
    return Math.round(v * f) / f;
  },
  _ledger() { try { return DB._get(this.KEY_LEDGER, []) || []; } catch (e) { _quiet(e, 'aud-ledger'); return []; } },

  /* As invariantes são as mesmas que a suíte roda no navegador de
     desenvolvimento — só que aqui elas rodam SOBRE OS DADOS REAIS de quem
     exportou. É a diferença entre "o código está certo" e "o seu arquivo está
     coerente". */
  _invariantes(r, tm) {
    const inv = [];
    const push = (nome, ok, detalhe) => inv.push({ nome, ok: !!ok, aplicavel: true, detalhe: detalhe == null ? null : detalhe });
    /* UMA INVARIANTE SEM PRÉ-CONDIÇÃO NÃO É UMA FALHA. Sem incidência nem
       edital importados não existe peso de prova, e "o peso soma 100%" passa a
       cobrar uma conta que ninguém tinha o que fazer. Reprovar aí ensinaria o
       auditor a ignorar o bloco inteiro — que é o oposto do que ele serve.
       Então o estado é três: passou, falhou, ou não se aplica (e por quê). */
    const naoSeAplica = (nome, porque) => inv.push({ nome, ok: true, aplicavel: false, detalhe: { porque } });
    try {
      const itens = r.itens || [];
      if (itens.length) {
        const somaG = itens.reduce((a, x) => a + (x.ganhoPP || 0), 0);
        const ult = itens[itens.length - 1];
        push('acumulado = domínio + soma dos ganhos',
          Math.abs(ult.acumulado - (r.dominioPct + somaG)) < 0.01,
          { acumulado: this._num(ult.acumulado), esperado: this._num(r.dominioPct + somaG) });
        let degrau = true, ant = r.dominioPct;
        itens.forEach(x => { if (Math.abs(x.acumulado - ant - x.ganhoPP) > 1e-6) degrau = false; ant = x.acumulado; });
        push('cada degrau do acumulado é o ganho daquele assunto', degrau);
        const chaves = itens.concat(r.pequenas || []).map(x => (x.disciplina || '') + '|' + x.nome);
        push('nenhum assunto na lista e no segundo plano ao mesmo tempo',
          new Set(chaves).size === chaves.length);
      }
      if (r.caminho && r.caminho.itens) {
        const g = r.caminho.itens.reduce((a, x) => a + (x.ganhoPP || 0), 0);
        push('o caminho mais curto cobre a falta até a meta',
          r.dominioPct + g >= r.meta - 1e-6, { chega: this._num(r.dominioPct + g), meta: r.meta });
        push('e não custa mais que a ordem exibida',
          r.qAteMeta == null || r.caminho.q <= r.qAteMeta, { curto: r.caminho.q, exibida: r.qAteMeta });
        push('e não conta o mesmo assunto duas vezes',
          new Set(r.caminho.itens.map(x => (x.disciplina || '') + '|' + x.nome)).size === r.caminho.n);
      }
      if (tm && tm.linhas && tm.linhas.length) {
        const sp = tm.linhas.reduce((a, l) => a + (l.sharePeso || 0), 0);
        const se = tm.linhas.reduce((a, l) => a + (l.shareEsforco || 0), 0);
        if (tm.fontePeso) push('o peso das matérias soma 100%', Math.abs(sp - 100) < 0.5, { soma: this._num(sp) });
        else naoSeAplica('o peso das matérias soma 100%', 'sem incidência de banca nem edital declarado, não há peso de prova para somar');
        if (tm.seuTotal > 0) push('o esforço das matérias soma 100%', Math.abs(se - 100) < 0.5, { soma: this._num(se) });
        else naoSeAplica('o esforço das matérias soma 100%', 'nenhuma questão medida no TEC até aqui');
        push('a tabela de matérias está ordenada por pontos em jogo',
          tm.linhas.filter(l => l.ganho > 0).every((l, i, a) => i === 0 || a[i - 1].ganho >= l.ganho));
      } else {
        naoSeAplica('as contas do quadro de matérias', 'o quadro de matérias não produziu linhas neste retrato');
      }
    } catch (e) { push('a coleta das invariantes terminou', false, String(e && e.message || e)); }
    return inv;
  },

  gerar(opts) {
    opts = opts || {};
    const anon = !!opts.anonimo;
    const nm = (s) => anon ? this._apelido(s) : (s == null ? null : String(s));
    const N = (v, c) => this._num(v, c);
    const p = PlanoEngine.prefs();
    const snaps0 = DB.getTecSnapshots() || [];
    /* ── O RECORTE DE RETRATOS ENTRA NO ARQUIVO, E NÃO PODE IMPEDI-LO ────────
       A tela do TEC pode estar com um recorte ativo (retratos escolhidos a
       dedo, ou um intervalo de datas). Duas consequências, e as duas
       importam para quem audita:

       · os números do Plano passam a ser DAQUELE recorte, e um arquivo que
         não diz isso leva o auditor a comparar peras com maçãs entre duas
         exportações;
       · se o recorte não casa com nada (seleção vazia, intervalo fora das
         datas), `scopedSnapshot()` devolve null e a exportação simplesmente
         se recusava a existir — justo quando a pessoa mais precisa mandar o
         arquivo para alguém entender o que houve.

       Então: grava o recorte, e quando ele não produz retrato nenhum, cai no
       consolidado e DECLARA a queda no próprio arquivo. */
    let recorte = null, caiuNoConsolidado = false;
    try {
      recorte = { modo: DesempenhoTecScreen.scopeMode || 'consolidado' };
      if (recorte.modo === 'select') recorte.retratosEscolhidos = (DesempenhoTecScreen.selectedSnapIds || { size: 0 }).size;
      if (recorte.modo === 'range') { recorte.de = DesempenhoTecScreen.rangeStart || null; recorte.ate = DesempenhoTecScreen.rangeEnd || null; }
    } catch (e) { _quiet(e, 'aud-recorte'); }
    let snap = null;
    try { snap = DesempenhoTecScreen.scopedSnapshot(); } catch (e) { _quiet(e, 'aud-snap'); }
    if (!snap && snaps0.length) {
      caiuNoConsolidado = true;
      try { snap = DesempenhoTecScreen.aggregate(snaps0); } catch (e) { _quiet(e, 'aud-agg'); }
    }
    const r = PlanoEngine.calcular(snap, Object.assign({}, p, { limite: this.MAX_ASSUNTOS }));
    if (!r || r.erro) return { erro: r ? r.erro : 'sem-retrato' };
    let tm = null;
    try { tm = PlanoPontos.esforcoPorMateria(p); } catch (e) { _quiet(e, 'aud-materias'); }
    let proj = null;
    try { proj = PlanoPontos.projecao(p); } catch (e) { _quiet(e, 'aud-proj'); }
    let cal = null, fechados = [], curso = [];
    try { cal = PlanoCiclo.calibragem(); } catch (e) { _quiet(e, 'aud-cal'); }
    try { fechados = PlanoCiclo.fechados() || []; } catch (e) { _quiet(e, 'aud-fech'); }
    try { curso = PlanoCiclo.emCurso(r) || []; } catch (e) { _quiet(e, 'aud-curso'); }
    const snaps = snaps0;

    /* Qualidade do dado: metade dos "erros do Plano" que alguém reporta é
       amostra curta, não conta errada. Quem audita precisa ver isso ANTES de
       olhar as fórmulas. */
    const qs = (r.itens || []).map(x => x.qJanela || 0).filter(q => q > 0).sort((a, b) => a - b);
    const mediana = qs.length ? qs[Math.floor((qs.length - 1) / 2)] : 0;
    const deltaMed = (r.itens || []).map(x => x.deltaMinimo).filter(v => v != null).sort((a, b) => a - b);

    const payload = {
      formato: 'studynomentor/plano-auditoria',
      versao: this.VERSAO,
      geradoEm: new Date().toISOString(),
      cadencia: opts.cadencia || 'avulsa',
      anonimo: anon,
      app: { versao: (window.APP_VERSION || null), build: (window.BUILD_ID || null) },

      /* Sem os parâmetros, nenhum número deste arquivo é reproduzível. */
      parametros: p,

      contexto: {
        modo: (function () { try { return PlanoPontos.modo(); } catch (e) { return null; } })(),
        disciplinaFiltro: p.disciplina === '__todas__' ? null : nm(p.disciplina),
        fontePeso: tm ? tm.fontePeso : null,
        bancas: (function () { try { return DesempenhoTecScreen.bancasSelecionadas() || []; } catch (e) { return []; } })().map(nm),
        temIncidencia: (function () { try { return !!(ReforcoEngine.hasIncidencia && ReforcoEngine.hasIncidencia()); } catch (e) { return null; } })(),
        temEdital: (function () { try { return PlanoPontos.temComposicao(); } catch (e) { return null; } })(),
        recorteDeRetratos: recorte,
        caiuNoConsolidado: caiuNoConsolidado,
        retratos: snaps.length,
        primeiroRetrato: snaps.length ? (snaps[0].endDate || snaps[0].date) : null,
        ultimoRetrato: snaps.length ? (snaps[snaps.length - 1].endDate || snaps[snaps.length - 1].date) : null
      },

      retrato: {
        dominioPct: N(r.dominioPct), meta: r.meta, teto: r.teto,
        falta: N(r.falta), jaAtinge: r.jaAtinge,
        assuntosMedidos: r.assuntos, semDiagnostico: r.ignorados,
        questoesNaAmostra: r.qTotal, janelaMediaDias: r.janelaMedia,
        ritmoSemanal: r.ritmo, ritmoMedido: r.ritmoMedido,
        defasado: r.defasado, diasDesdeUltimoRetrato: r.idadeUltimo,
        caminhoMaisCurto: r.caminho ? { assuntos: r.caminho.n, questoes: r.caminho.q, semanas: N(r.semanas, 1) } : null,
        questoesNaOrdemExibida: r.qAteMeta,
        solidos: r.solidosAtuais, solidosVencidos: r.solidosVencidos,
        recemCorrigidos: r.recentes, comDadoVencido: r.vencidos,
        melhorando: r.melhorando, piorando: r.piorando,
        empatadosNoTopo: r.empatados, medianaJanela: r.medianaJanela,
        ordem: r.ordenar, ponderacao: r.ponderacao, custoModo: r.custoModo,
        ordensGemeas: r.equivalentes || []
      },

      /* A série é a única coisa aqui que responde "está melhorando?". O
         `deltaComparavel` é o que vale: o bruto compara conjuntos diferentes
         de assuntos a cada importação. */
      serie: (r.serie || []).map(x => ({
        data: x.data, nome: anon ? null : x.nome,
        dominio: N(x.dominio), assuntos: x.assuntos, questoes: x.questoes,
        deltaBruto: N(x.delta), deltaComparavel: N(x.deltaComp),
        assuntosComuns: x.comuns, questoesComuns: x.qComuns,
        rendimento: N(x.rendimento, 4)
      })),

      materias: tm ? {
        emJogoPP: N(tm.emJogo, 1), materiasNoCorte: tm.nCorte, acoes: tm.acoes,
        linhas: (tm.linhas || []).map(l => ({
          nome: nm(l.nome), questoesSuas: l.q,
          esforcoPct: N(l.shareEsforco), pesoPct: N(l.sharePeso),
          nivelPct: N(l.taxa), medido: l.medido,
          emJogoPP: N(l.ganho), estimado: !!l.estimado,
          razaoEsforcoPeso: N(l.razao), sobra: !!l.sobra,
          veredito: l.veredito, noCorte: !!l.noCorte, naFila: !!l.naFila, resumo: l.resumo || null
        }))
      } : null,

      assuntos: (r.itens || []).map((x, i) => ({
        pos: i + 1, disciplina: nm(x.disciplina), nome: nm(x.nome),
        taxaPct: N(x.taxa), margemPP: N(x.margem), confiabilidade: x.conf ? x.conf.nivel : null,
        questoesNaJanela: x.qJanela, questoesNoTotal: x.qHist, diasDaJanela: x.diasJanela,
        retratosNaJanela: x.retratosJanela, atingiuAlvoDeAmostra: !!x.atingiuAlvo,
        taxaAnteriorPct: N(x.pctAntes), questoesAntes: x.qAntes,
        deltaPP: N(x.delta), deltaMinimoComprovavelPP: N(x.deltaMinimo), deltaFirme: !!x.deltaFirme,
        faixa: x.status ? x.status.rot : null, conselho: x.status ? x.status.acao : null,
        lacunaPP: N(x.lacunaPP), custoQuestoes: x.custoQ, amplitude: N(x.amplitude),
        questoesParaMedir: x.qMedir, questoesParaProvar: x.qProvar,
        ganhoDominioPP: N(x.ganhoDominio, 3), ganhoGeralPP: N(x.ganhoGeral, 3),
        ganhoUsadoPP: N(x.ganhoPP, 3), acumuladoPct: N(x.acumulado),
        incidencia: x.incid, sequenciaNaMeta: x.seq, medicoes: x.medicoes,
        diasDesdeMedicao: x.diasDesdeMedicao, vencido: !!x.vencido,
        temAtividade: !!x.extra
      })),

      segundoPlano: (r.pequenas || []).map(x => ({
        disciplina: nm(x.disciplina), nome: nm(x.nome),
        taxaPct: N(x.taxa), questoesNaJanela: x.qJanela, questoesNoTotal: x.qHist
      })),

      /* A EVIDÊNCIA CAUSAL. Tudo o mais neste arquivo é observação; isto aqui é
         o experimento: o Plano mandou atacar, a pessoa atacou, e a medição
         seguinte julgou. Um módulo que não mostra ganho aqui não está
         funcionando, por mais bonitos que sejam os outros números. */
      atividades: {
        emCurso: (curso || []).map(c => ({
          disciplina: nm(c.disciplina || (c.extra && c.extra.origemPlano && c.extra.origemPlano.disciplina)),
          topico: nm(c.topico || (c.extra && c.extra.origemPlano && c.extra.origemPlano.topico)),
          feito: c.feito, medido: c.medido, manual: c.manual,
          taxaPct: N(c.taxa), deltaPP: N(c.delta), estado: c.estado
        })),
        fechadas: (fechados || []).map(v => ({
          disciplina: nm(v.disciplina), topico: nm(v.topico),
          em: v.em, questoes: v.questoes,
          taxaInicialPct: N(v.taxaInicial), taxaFinalPct: N(v.taxaFinal),
          ganhoPP: N(v.ganhoPP), resultado: v.resultado || v.estado || null
        })),
        calibragem: cal
      },

      projecaoDePontos: proj ? {
        valorTotal: N(proj.valorTotal), notaHoje: N(proj.hoje), notaPotencial: N(proj.potencial),
        pctHoje: N(proj.pctHoje), pctPotencial: N(proj.pctPotencial),
        corte: proj.corte, faltaCorte: N(proj.faltaCorte), passaHoje: proj.passaHoje,
        materiasSemDado: (proj.semDado || []).map(nm),
        abaixoDoMinimo: (proj.eliminatorias || []).map(l => nm(l.nome)),
        linhas: (proj.linhas || []).map(l => ({ nome: nm(l.nome), questoes: l.q, pontosPorQuestao: l.pts,
          peso: l.peso, valor: N(l.valor), taxaPct: N(l.taxa), medido: l.medido, minimoPct: l.minimo }))
      } : null,

      qualidadeDoDado: {
        medianaQuestoesPorAssunto: mediana,
        assuntosQueAtingemOAlvo: r.comAlvo, maiorAmostra: r.maiorAmostra,
        alvoDeAmostra: r.amostraAlvo, alvoInviavel: !!r.alvoInviavel, alvoSugerido: r.alvoSugerido,
        deltaMinimoMedianoPP: deltaMed.length ? N(deltaMed[Math.floor((deltaMed.length - 1) / 2)]) : null,
        empatadosNoTopo: r.empatados,
        assuntosComIncidencia: r.comIncid, assuntosListados: (r.itens || []).length,
        materiasSemPeso: tm ? (tm.linhas || []).filter(l => l.sharePeso == null || l.sharePeso <= 0).length : null,
        materiasSemEsforco: tm ? (tm.linhas || []).filter(l => !l.q).length : null,
        janelaMaxDias: p.janelaMax, minimoDeAmostra: p.minAmostra
      },

      invariantes: this._invariantes(r, tm),
      historicoDeAuditorias: this._ledger()
    };
    payload.resumo = this.resumo(payload);
    return payload;
  },

  /* Um parágrafo que a pessoa lê antes de mandar o arquivo — e que o auditor lê
     antes de abrir o resto. Se ele e os números do arquivo discordarem, o
     arquivo está quebrado. */
  resumo(a) {
    const r = a.retrato, m = a.materias, at = a.atividades;
    const ok = (a.invariantes || []).filter(i => !i.ok).length;
    const na = (a.invariantes || []).filter(i => i.aplicavel === false).length;
    const fech = (at && at.fechadas) || [];
    const bons = fech.filter(f => (f.ganhoPP || 0) > 0).length;
    const s = [];
    s.push('Domínio ' + r.dominioPct + '% em ' + r.assuntosMedidos + ' assuntos (meta ' + r.meta + '%, faltam ' + r.falta + ').');
    if (a.contexto.disciplinaFiltro) s.push('ATENÇÃO: filtrado por "' + a.contexto.disciplinaFiltro + '" — estes números são só dessa matéria.');
    if (a.contexto.recorteDeRetratos && a.contexto.recorteDeRetratos.modo && a.contexto.recorteDeRetratos.modo !== 'consolidado') s.push('ATENÇÃO: recorte de retratos "' + a.contexto.recorteDeRetratos.modo + '" ativo.');
    if (a.contexto.caiuNoConsolidado) s.push('O recorte escolhido não cobria retrato nenhum: os números caíram no consolidado.');
    if (r.caminhoMaisCurto) s.push('Caminho mais curto: ' + r.caminhoMaisCurto.assuntos + ' assuntos, ' + r.caminhoMaisCurto.questoes + ' questões, ~' + r.caminhoMaisCurto.semanas + ' semanas a ' + r.ritmoSemanal + '/sem.');
    if (m) s.push(m.emJogoPP + 'pp da prova em jogo; ' + m.materiasNoCorte + ' matéria(s) concentram metade.');
    s.push('Amostra: mediana de ' + a.qualidadeDoDado.medianaQuestoesPorAssunto + ' questões por assunto; ' + r.empatadosNoTopo + ' empatados no topo.');
    s.push('Ciclos fechados: ' + fech.length + (fech.length ? ' (' + bons + ' com ganho).' : '.'));
    s.push('Retratos: ' + a.contexto.retratos + (a.serie.length > 1 ? ', variação comparável acumulada de ' + this._num(a.serie.reduce((x, p) => x + (p.deltaComparavel || 0), 0), 1) + 'pp.' : '.'));
    s.push(ok ? ('⚠️ ' + ok + ' invariante(s) FALHARAM — confira antes de confiar nos números.')
      : ('Invariantes: todas fecham' + (na ? ' (' + na + ' não se aplicam a este retrato).' : '.')));
    return s.join(' ');
  },

  _registrar(a) {
    try {
      const l = this._ledger();
      l.push({
        em: a.geradoEm, cadencia: a.cadencia,
        dominio: a.retrato.dominioPct, assuntos: a.retrato.assuntosMedidos,
        questoes: a.retrato.questoesNaAmostra, retratos: a.contexto.retratos,
        emJogo: a.materias ? a.materias.emJogoPP : null,
        fechadas: a.atividades.fechadas.length,
        comGanho: a.atividades.fechadas.filter(f => (f.ganhoPP || 0) > 0).length,
        invariantesFalhas: (a.invariantes || []).filter(i => !i.ok).length
      });
      DB._set(this.KEY_LEDGER, l.slice(-this.MAX_LEDGER));
    } catch (e) { _quiet(e, 'aud-registrar'); }
  },

  exportar(cadencia, anonimo) {
    const a = this.gerar({ cadencia: cadencia, anonimo: anonimo });
    if (a.erro) { showToast('Sem retrato do TEC para auditar'); return null; }
    this._registrar(a);
    const hoje = todayLocal();
    const nome = 'plano-auditoria-' + (cadencia || 'avulsa') + '-' + hoje + '.json';
    try {
      const blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url; el.download = nome;
      document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Auditoria exportada ✓');
    } catch (e) { _quiet(e, 'aud-download'); showToast('Não consegui gerar o arquivo'); }
    return a;
  }
};
window.PlanoAuditoria = PlanoAuditoria;
