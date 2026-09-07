/* ============================================================
   TELA: DESEMPENHO TEC (importação e análise TecConcursos)
   ============================================================ */
// ============================================================================
// PLANO DE APROVAÇÃO — visão alternativa ao Reforço (o Reforço segue intacto).
// Responde "quanto falta e por onde começar", não só "onde você é fraca".
// Três diferenças de essência em relação ao Reforço:
//   1) TAXA RECENTE: usa o retrato mais novo, não a média da vida inteira. Um
//      assunto que você já dominou para de aparecer no topo.
//   2) ESCALA DA PROVA: converte incidência em questões da SUA prova, e compara
//      com uma nota-alvo. Existe um "pronto".
//   3) GANHO POR HORA: usa o seu ritmo real (min/questão por disciplina, tirado
//      dos seus registros) — com tempo escasso é isso que decide a ordem.
// ============================================================================
const PlanoEngine = {
  KEY_PREF: 'plano-prefs',
  // 100% PONTOS FRACOS — não usa incidência de banca. O universo é o que VOCÊ
  // pratica, medido pelo TEC. Tudo aqui é ajustável pelo usuário.
  //   ponderacao  'igual'  = todo assunto pesa o mesmo (não deixa nada se esconder)
  //               'volume' = pesa pelo quanto você já praticou (reflete sua prioridade)
  //   custoModo   'fixo'   = N questões por assunto
  //               'proporcional' = fator × questões já praticadas
  DEFAULTS: {
    metaDominio: 80, tetoDominio: 90,
    ponderacao: 'igual', minAmostra: 20, incluirPequenas: false,
    custoModo: 'fixo', custoFixo: 60, custoFator: 0.5,
    ritmoSemanal: null, apenasFolhas: true, disciplina: '__todas__',
    limite: 30, ordenar: 'pior',
    faixaCritico: 50,    // abaixo disso o problema é de teoria
    faixaFragil: 65,     // abaixo disso ainda precisa revisar teoria
    pisoSerie: 5,        // amostra mínima por importação p/ série e consolidação
    sensTendencia: 3,    // variação em pp para contar como melhora/piora
    consolidarEm: 2,     // importações seguidas na meta para considerar sólido
    validadeDias: 120,   // acima disso o dado do assunto é considerado vencido
    amostraAlvo: 50,     // amostra que buscamos para a taxa ser confiável (±14pp a 95%)
    janelaMax: 365,      // até onde recuar no tempo procurando essa amostra
    cadenciaDias: 30,
    banca: '__todas__'   // banca usada na ordenação "prioridade na banca" (opcional)
  },
  prefs() {
    try {
      const v = JSON.parse(localStorage.getItem(DB._profilePrefix() + this.KEY_PREF));
      return Object.assign({}, this.DEFAULTS, v || {});
    } catch (_) { return Object.assign({}, this.DEFAULTS); }
  },
  salvarPrefs(patch) {
    const v = Object.assign(this.prefs(), patch || {});
    try { localStorage.setItem(DB._profilePrefix() + this.KEY_PREF, JSON.stringify(v)); } catch (_) { _quiet(_); }
    try { if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange(); } catch (_) { _quiet(_); }
    return v;
  },
  _diasDesde(iso) {
    if (!iso) return Infinity;
    return Math.floor((new Date(todayLocal() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
  },
  // Margem de erro da proporção a 95% de confiança (em pontos percentuais).
  // É isto que transforma "confiável" de opinião em número.
  margemErro(pct, n) {
    if (!n || n < 2) return null;
    const p = Math.min(1, Math.max(0, pct / 100));
    return 1.96 * Math.sqrt(p * (1 - p) / n) * 100;
  },
  confiabilidade(n) {
    if (n >= 100) return { nivel: 'alta', tom: 'good' };
    if (n >= 50) return { nivel: 'média', tom: 'good' };
    if (n >= 20) return { nivel: 'baixa', tom: 'warn' };
    return { nivel: 'insuficiente', tom: 'bad' };
  },
  // JANELA ADAPTATIVA: para cada assunto, recua no tempo apenas o necessário até
  // juntar a amostra-alvo. Assunto muito praticado usa uma janela curta (bem atual);
  // assunto esparso recua mais, mas para assim que a amostra basta — sem pular
  // direto para "a vida inteira".
  _taxaAdaptativa(chave, snapsDesc, opts) {
    let q = 0, ac = 0, diasJanela = 0, retratos = 0;
    for (const s of snapsDesc) {
      // o limite vale para o INÍCIO do período: "não use dado mais velho que isso"
      if (this._diasDesde(s.startDate) > opts.janelaMax) break;
      const idx = s._idx[chave];
      if (idx && idx.q > 0) {
        q += idx.q; ac += idx.ac; retratos++;
        diasJanela = Math.max(diasJanela, this._diasDesde(s.startDate));
      }
      if (q >= opts.amostraAlvo) break;
    }
    if (!q) return null;
    const pct = ac / q * 100;
    return { q, ac, pct, diasJanela, retratos, margem: this.margemErro(pct, q), conf: this.confiabilidade(q) };
  },
  // Folhas do retrato: assuntos atômicos, sem somar pai e filho duas vezes
  _folhas(snap, apenasFolhas) {
    const rows = (snap && snap.rows || []).filter(r => r.depth > 0 && (r.questoes || 0) > 0);
    if (!apenasFolhas) return rows;
    return rows.filter(r => {
      if (!r.codigo) return true;
      return !rows.some(o => o !== r && o.disciplina === r.disciplina && o.codigo &&
        String(o.codigo).startsWith(String(r.codigo) + '.'));
    });
  },
  _indice(snap, apenasFolhas) {
    const m = {};
    this._folhas(snap, apenasFolhas).forEach(r => {
      const k = ReforcoEngine.norm(r.nome);
      const c = m[k] || { q: 0, ac: 0, nome: r.nome, disciplina: r.disciplina };
      c.q += (r.questoes || 0); c.ac += (r.acertos || 0);
      m[k] = c;
    });
    Object.values(m).forEach(v => { v.pct = v.q > 0 ? v.ac / v.q * 100 : null; });
    return m;
  },
  // ── SÉRIE HISTÓRICA: domínio em cada importação ─────────────────────────
  // Responde "está funcionando?" — a pergunta que nenhum número isolado responde.
  // Usa um piso baixo de amostra (a intenção é tendência, não precisão pontual).
  PISO_SERIE: 5,
  serieHistorica(opts) {
    opts = Object.assign({}, this.prefs(), opts || {});
    const snaps = DB.getTecSnapshots();
    const pontos = [];
    let ant = null;
    snaps.forEach(s => {
      const idx = this._indice(s, opts.apenasFolhas);
      const chaves = Object.keys(idx).filter(k => idx[k].q >= (opts.pisoSerie || this.PISO_SERIE) &&
        (opts.disciplina === '__todas__' || ReforcoEngine.norm(idx[k].disciplina || '') === ReforcoEngine.norm(opts.disciplina)));
      if (!chaves.length) return;
      const peso = (k) => (opts.ponderacao === 'volume') ? idx[k].q : 1;
      const univ = chaves.reduce((a, k) => a + peso(k), 0);
      const dom = chaves.reduce((a, k) => a + peso(k) * idx[k].pct / 100, 0) / univ * 100;
      const qTotal = chaves.reduce((a, k) => a + idx[k].q, 0);
      const p = {
        data: s.endDate || s.date, nome: s.nome || '', dominio: dom,
        assuntos: chaves.length, questoes: qTotal,
        delta: ant ? dom - ant.dominio : null,
        // retorno do esforço: pontos de domínio ganhos a cada 100 questões do período
        rendimento: (ant && qTotal > 0) ? (dom - ant.dominio) / qTotal * 100 : null
      };
      pontos.push(p); ant = p;
    });
    return pontos;
  },
  // ── CONSOLIDAÇÃO: quantas importações SEGUIDAS o assunto ficou na meta ───
  // "Cruzou a meta" e "está sólido" são coisas diferentes. Um assunto que acabou
  // de cruzar ainda não provou que fica — tirá-lo da lista agora é abandoná-lo cedo.
  _sequencias(opts) {
    const snaps = DB.getTecSnapshots();
    const porTopico = {};
    snaps.forEach(s => {
      const idx = this._indice(s, opts.apenasFolhas);
      const dataFim = s.endDate || s.date;
      Object.keys(idx).forEach(k => {
        if (idx[k].q < (opts.pisoSerie || this.PISO_SERIE)) return;
        (porTopico[k] = porTopico[k] || []).push({ data: dataFim, pct: idx[k].pct, q: idx[k].q });
      });
    });
    const out = {};
    Object.keys(porTopico).forEach(k => {
      const linha = porTopico[k];                 // já em ordem cronológica
      let seq = 0;
      for (let i = linha.length - 1; i >= 0; i--) {  // do mais novo para trás
        if (linha[i].pct >= opts.metaDominio) seq++; else break;
      }
      out[k] = {
        seq, medicoes: linha.length,
        ultimaMedicao: linha[linha.length - 1].data,
        diasDesde: this._diasDesde(linha[linha.length - 1].data),
        serie: linha.map(x => x.pct)
      };
    });
    return out;
  },
  ritmoRecente(snapsDesc, dias) {
    let q = 0, ini = null, fim = null;
    for (const s of snapsDesc) {
      if (this._diasDesde(s.endDate || s.date) > dias) break;
      q += (s.rows || []).filter(r => r.depth > 0).reduce((a, r) => a + (r.questoes || 0), 0);
      if (!ini || s.startDate < ini) ini = s.startDate;
      const f = s.endDate || s.date;
      if (!fim || f > fim) fim = f;
    }
    if (!q || !ini || !fim) return null;
    const sem = Math.max(1, (new Date(fim + 'T00:00:00') - new Date(ini + 'T00:00:00')) / (7 * 86400000));
    return Math.round(q / sem);
  },
  disciplinas(scoped) {
    const s = new Set();
    (scoped && scoped.rows || []).forEach(r => { if (r.disciplina) s.add(r.disciplina); });
    return [...s].sort();
  },
  calcular(scoped, opts) {
    opts = Object.assign({}, this.prefs(), opts || {});
    if (!scoped) return { erro: 'sem-retrato' };
    const todos = DB.getTecSnapshots();
    if (!todos.length) return { erro: 'sem-retrato' };
    // do mais novo para o mais antigo, cada um com seu índice de assuntos
    const snapsDesc = todos.slice().reverse().map(s => {
      s._idx = this._indice(s, opts.apenasFolhas); return s;
    });
    const mHist = this._indice(scoped, opts.apenasFolhas);
    // Baseline histórico coerente com a JANELA ADAPTATIVA: soma os índices POR RETRATO
    // (mesma chave por nome), em vez de usar o agregado. Sem isto, quando o mesmo assunto
    // muda de código entre importações, o agregado + detecção de folha captura uma amostra
    // menor que a janela — e o delta ▲/▼ ficava espúrio (ex.: "+63pp" num assunto em queda).
    const mFull = {};
    for (const s of snapsDesc) { const idx = s._idx || {}; for (const k in idx) { const c = mFull[k] || { q: 0, ac: 0 }; c.q += idx[k].q; c.ac += idx[k].ac; mFull[k] = c; } }
    const _fullPct = (k, fb) => { const f = mFull[k]; return (f && f.q > 0) ? (f.ac / f.q * 100) : fb; };
    let chaves = Object.keys(mHist);
    if (opts.disciplina && opts.disciplina !== '__todas__') {
      chaves = chaves.filter(k => ReforcoEngine.norm(mHist[k].disciplina || '') === ReforcoEngine.norm(opts.disciplina));
    }
    if (!chaves.length) return { erro: 'sem-retrato' };

    const teto = Math.max(50, Math.min(100, opts.tetoDominio)) / 100;
    const seqs = this._sequencias(opts);
    const brutos = chaves.map(k => {
      const h = mHist[k];
      const a = this._taxaAdaptativa(k, snapsDesc, opts) || { q: h.q, ac: h.ac, pct: h.pct, diasJanela: null, retratos: 0, margem: this.margemErro(h.pct, h.q), conf: this.confiabilidade(h.q) };
      const taxa = a.pct;
      const amostraFraca = a.q < opts.minAmostra;
      const peso = (opts.ponderacao === 'volume') ? a.q : 1;
      const custoQ = (opts.custoModo === 'proporcional')
        ? Math.max(10, Math.round(h.q * opts.custoFator))
        : Math.max(10, Math.round(opts.custoFixo));
      const sq = seqs[k] || { seq: 0, medicoes: 0, diasDesde: null, serie: [] };
      return {
        nome: h.nome, disciplina: h.disciplina || '',
        seq: sq.seq, medicoes: sq.medicoes, serie: sq.serie,
        diasDesdeMedicao: sq.diasDesde,
        vencido: sq.diasDesde != null && sq.diasDesde > opts.validadeDias,
        qHist: (mFull[k] ? mFull[k].q : h.q), pctHist: _fullPct(k, h.pct),
        qJanela: a.q, diasJanela: a.diasJanela, retratosJanela: a.retratos,
        margem: a.margem, conf: a.conf, atingiuAlvo: a.q >= opts.amostraAlvo,
        taxa, amostraFraca, peso, custoQ,
        delta: (a.pct != null) ? Math.round((a.pct - _fullPct(k, h.pct)) * 10) / 10 : null
      };
    });
    const usados = opts.incluirPequenas ? brutos : brutos.filter(x => !x.amostraFraca);
    if (!usados.length) return { erro: 'amostra' };
    const universo = usados.reduce((a, x) => a + x.peso, 0);
    const dominioPct = usados.reduce((a, x) => a + x.peso * x.taxa / 100, 0) / universo * 100;

    // Incidência da banca (opcional): reusa o mapa tópico→incidência já existente.
    // Não altera o domínio nem o ganho; serve para ORDENAR por "onde mais cai na prova".
    let incMap = {}, temIncid = false;
    try {
      if ((typeof ReforcoEngine !== 'undefined') && ReforcoEngine.hasIncidencia && ReforcoEngine.hasIncidencia()) {
        incMap = ReforcoEngine.incidenceMap(opts.banca || '__todas__') || {};
        temIncid = Object.keys(incMap).length > 0;
      }
    } catch (_) { _quiet(_); }
    // 1º passo: anexa a incidência de cada assunto e calcula o rendimento.
    /* DUAS MÉTRICAS DE GANHO, sempre calculadas — a escolha do usuário decide
       qual manda na ordem e o que aparece na tela.

       ganhoDominio  (peso 'igual'): quanto sobe o DOMÍNIO, onde cada assunto vale
         o mesmo. Um tópico de 4 questões a 0% rende muito aqui — é o que impede
         que assunto pequeno e mal dominado se esconda.
       ganhoGeral    (peso 'volume'): quanto sobe o APROVEITAMENTO GERAL mostrado
         no topo desta tela, que é ponderado por questão. Aqui manda o volume.

       Os dois respondem perguntas diferentes e podem discordar: 300 questões a
       60% valem 10pp de domínio mas 90 questões recuperadas; 4 questões a 0%
       valem 30pp de domínio e só 3,6 questões. Nenhum está errado — por isso a
       opção "🔀 Mostrar as duas". */
    const universoQ = usados.reduce((a, x) => a + (x.qHist || x.q || 0), 0) || 1;
    usados.forEach(x => {
      x.ganhoDominio = Math.max(0, (teto - x.taxa / 100) / usados.length * 100);
      x.ganhoQuestoes = Math.max(0, (teto - x.taxa / 100) * (x.qHist || x.q || 0));
      x.ganhoGeral = Math.max(0, x.ganhoQuestoes / universoQ * 100);
      x.ganhoPP = (opts.ponderacao === 'volume') ? x.ganhoGeral
        : Math.max(0, (x.peso * teto - x.peso * x.taxa / 100) / universo * 100);
      x.ganhoDominio = Math.max(0, (x.peso * teto - x.peso * x.taxa / 100) / universo * 100);
      x.rendimento = x.ganhoPP / x.custoQ * 100;
      x.incid = temIncid ? (incMap[ReforcoEngine.norm(x.nome)] || 0) : null;
    });
    // Normaliza pela MAIOR incidência ENTRE OS ASSUNTOS DO PLANO (folhas), não pelo mapa
    // global — senão agregados de disciplina (ex.: 434) achatam todos os assuntos-folha.
    let incMax = 0;
    if (temIncid) usados.forEach(x => { if (x.incid > incMax) incMax = x.incid; });
    usados.forEach(x => {
      x.incidNorm = (temIncid && incMax > 0) ? (x.incid / incMax) : 0;
      // Prioridade na banca = retorno do esforço FORTEMENTE amplificado pela frequência
      // na prova. Mantém o rendimento como base (nada some), mas empurra ao topo o que é
      // fraco E cai muito. K=6 calibrado com dados reais.
      x.prioBanca = x.rendimento * (1 + 6 * x.incidNorm);
    });
    // Classificação em linguagem clara, com o que fazer em cada faixa
    // Orientação escrita para o CASO, não genérica: usa a taxa, a distância até a
    // meta e o histórico daquele assunto. Antes a mesma frase se repetia em vários.
    usados.forEach(x => {
      const t = x.taxa, alvoSeq = opts.consolidarEm;
      const faltaMeta = Math.max(0, opts.metaDominio - t).toFixed(0);
      const caindo = x.delta != null && x.delta <= -opts.sensTendencia;
      if (t < opts.faixaCritico) x.status = { rot: '🔴 Crítico', tom: 'bad',
        acao: 'Você erra mais do que acerta aqui. Resolver mais questões agora só repete o erro — retome a teoria primeiro e volte às questões depois.' };
      else if (t < opts.faixaFragil) x.status = { rot: '🔴 Frágil', tom: 'bad',
        acao: 'A base existe, mas falha em pontos específicos. Vá pelo caminho do erro: resolva um bloco, anote o que errou e revise só esses pontos antes do bloco seguinte.' };
      else if (t < opts.metaDominio) x.status = { rot: '🟠 Em desenvolvimento', tom: 'warn',
        acao: caindo
          ? 'Estava melhor antes e caiu. Antes de aumentar o volume, verifique se o assunto mudou de banca ou se você deixou de revisar — reforce a revisão.'
          : 'Faltam ' + faltaMeta + ' pontos para a meta. Aqui volume resolve: bata questões e revise apenas o que errar, sem voltar à teoria inteira.' };
      else if (x.seq >= alvoSeq) x.status = { rot: '🟢 Consolidado', tom: 'good', seq: x.seq,
        acao: 'Sustenta a meta há ' + x.seq + ' importações seguidas. Está resolvido: só revisão espaçada. Tempo extra aqui rende menos que em qualquer assunto acima.' };
      else x.status = { rot: '🟡 Recém-corrigido', tom: 'warn', seq: x.seq,
        acao: 'Passou da meta em ' + x.seq + ' de ' + alvoSeq + ' importações necessárias. Ainda não provou que fixou — mantenha um volume pequeno e constante até sustentar na próxima importação.' };
    });
    const ordem = {
      rendimento: (a, b) => b.rendimento - a.rendimento,
      pior: (a, b) => a.taxa - b.taxa,
      queda: (a, b) => (a.delta == null ? 0 : a.delta) - (b.delta == null ? 0 : b.delta),
      volume: (a, b) => b.qHist - a.qHist,
      banca: (a, b) => b.prioBanca - a.prioBanca,
      // Ordenar diretamente por cada métrica de ganho — responde "o que mexe
      // mais no número que EU escolhi acompanhar", sem depender do custo.
      ganhoDominio: (a, b) => b.ganhoDominio - a.ganhoDominio,
      ganhoGeral: (a, b) => b.ganhoGeral - a.ganhoGeral
    };
    // Desempate ESTÁVEL por nome: duas execuções com os mesmos dados dão a mesma ordem
    const base = ordem[opts.ordenar] || ordem.rendimento;
    const cmp = (a, b) => base(a, b) || (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    const plano = usados.filter(x => x.ganhoPP > 0.001).sort(cmp);
    const meta = opts.metaDominio;
    let acum = dominioPct, idxMeta = -1, qAteMeta = 0;
    plano.forEach((x, i) => {
      acum += x.ganhoPP; x.acumulado = acum;
      if (idxMeta < 0) { qAteMeta += x.custoQ; if (acum >= meta) idxMeta = i; }
    });
    const ritmo = opts.ritmoSemanal || this.ritmoRecente(snapsDesc, 120) || 0;
    const idadeUltimo = this._diasDesde(todos[todos.length - 1].endDate || todos[todos.length - 1].date);
    const sens = opts.sensTendencia;
    const melhorando = usados.filter(x => x.delta != null && x.delta >= sens).length;
    const piorando = usados.filter(x => x.delta != null && x.delta <= -sens).length;
    const janelaMedia = Math.round(usados.filter(x => x.diasJanela).reduce((a, x) => a + x.diasJanela, 0) / Math.max(1, usados.filter(x => x.diasJanela).length));
    return {
      dominioPct, meta, jaAtinge: dominioPct >= meta, falta: Math.max(0, meta - dominioPct),
      assuntos: usados.length, ignorados: brutos.length - usados.length,
      qTotal: usados.reduce((a, x) => a + x.qJanela, 0),
      idxMeta, qAteMeta: idxMeta >= 0 ? qAteMeta : null,
      ritmo, ritmoMedido: this.ritmoRecente(snapsDesc, 120),
      semanas: (idxMeta >= 0 && ritmo > 0) ? qAteMeta / ritmo : null,
      amostraAlvo: opts.amostraAlvo, janelaMax: opts.janelaMax, janelaMedia,
      // Se quase ninguém alcança o alvo, o problema é a CONFIGURAÇÃO, não o seu estudo.
      maiorAmostra: usados.reduce((m, x) => Math.max(m, x.qJanela), 0),
      alvoInviavel: usados.length > 0 && (usados.filter(x => x.atingiuAlvo).length / usados.length) < 0.25,
      teto: Math.round(teto * 100),
      comAlvo: usados.filter(x => x.atingiuAlvo).length,
      melhorando, piorando, ordenar: opts.ordenar,
      temIncid, banca: opts.banca,
      comIncid: usados.filter(x => x.incid > 0).length,
      consolidados: usados.filter(x => x.taxa >= opts.metaDominio && x.seq >= opts.consolidarEm).length,
      recentes: usados.filter(x => x.taxa >= opts.metaDominio && x.seq < opts.consolidarEm).length,
      vencidos: usados.filter(x => x.vencido).length,
      consolidarEm: opts.consolidarEm, validadeDias: opts.validadeDias,
      sensTendencia: opts.sensTendencia, faixaCritico: opts.faixaCritico, faixaFragil: opts.faixaFragil,
      serie: this.serieHistorica(opts),
      idadeUltimo, cadenciaDias: opts.cadenciaDias,
      defasado: idadeUltimo > opts.cadenciaDias,
      ponderacao: opts.ponderacao,
      itens: plano.slice(0, opts.limite),
      // SEGUNDO PLANO: assuntos sem amostra confiável. Ficam FORA da média (8 questões
      // a 38% podem significar de 4% a 71% — contaminaria o número), mas não somem.
      // Aqui a ação é outra: primeiro juntar dado, depois decidir se é fraqueza.
      pequenas: brutos.filter(x => x.amostraFraca).map(x => Object.assign(x, {
        faltaAmostra: Math.max(1, opts.amostraAlvo - x.qJanela)
      })).sort((a, b) => (a.taxa == null ? 999 : a.taxa) - (b.taxa == null ? 999 : b.taxa))
    };
  }
};

const DesempenhoTecScreen = {
  currentSnapId: null,
  // ---- Escopo da análise: 'consolidado' (todos), 'select' (retratos marcados), 'range' (intervalo) ----
  scopeMode: 'consolidado',
  selectedSnapIds: null, // Set de ids marcados (modo 'select')
  rangeStart: null, rangeEnd: null, // (modo 'range')
  // ---- Persistência de filtros/seleções (lembra entre sessões, por perfil) ----
  _prefsKey() { return DB._profilePrefix() + 'tec-prefs'; },
  _loadPrefs() {
    if (this._prefs) return this._prefs;
    this._prefs = DB._get(this._prefsKey(), {}) || {};
    /* Filtros e configuracoes nascem RECOLHIDOS. A tela e densa: ao abrir, o
       que interessa sao os resultados, nao os controles que os produziram.
       Quem quiser ajustar abre pela engrenagem — e a escolha fica salva.
       Só o padrao inicial muda; quem ja escolheu mostrar continua vendo. */
    if (this._prefs.hideCfg === undefined) this._prefs.hideCfg = true;
    return this._prefs;
  },
  savePrefs(patch) {
    const p = Object.assign(this._loadPrefs(), patch || {});
    this._prefs = p;
    try { localStorage.setItem(this._prefsKey(), JSON.stringify(p)); } catch (_) { _quiet(_); }
  },
  // aplica as preferências salvas aos controles do Reforço (chamado ao renderizar)
  applyReforcoPrefs() {
    const p = this._loadPrefs();
    if (p.reforcoView) this.reforcoView = p.reforcoView;
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
    if (p.ordenar) { const el = document.getElementById('reforco-ordenar'); if (el && [...el.options].some(o => o.value === p.ordenar)) el.value = p.ordenar; }
    if (p.estrat != null) set('reforco-estrat', p.estrat);
    if (p.gran != null) set('reforco-gran', p.gran);
    if (p.minq != null) set('reforco-minq', p.minq);
    if (p.limite != null) set('reforco-limite', p.limite);
    if (p.banca) { const el = document.getElementById('reforco-banca'); if (el && [...el.options].some(o => o.value === p.banca)) el.value = p.banca; }
    if (p.disc) { const el = document.getElementById('reforco-disc'); if (el && [...el.options].some(o => o.value === p.disc)) el.value = p.disc; }
  },
  render() {
    const snaps = DB.getTecSnapshots();
    const emptyEl = document.getElementById('tec-empty');
    const importEl = document.getElementById('tec-import');
    const analysisEl = document.getElementById('tec-analysis');
    importEl.style.display = 'none';
    if (snaps.length === 0) {
      emptyEl.style.display = 'block';
      analysisEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    analysisEl.style.display = 'block';
    // restaura o modo de escopo salvo (persistência de filtros)
    const _p = this._loadPrefs();
    if (_p.scopeMode && ['consolidado', 'select', 'range'].includes(_p.scopeMode)) this.scopeMode = _p.scopeMode;
    if (_p.reforcoView) this.reforcoView = _p.reforcoView;
    // inicializa a seleção (todos marcados) e o intervalo (cobre tudo) na 1ª vez
    if (this.selectedSnapIds === null) this.selectedSnapIds = new Set(snaps.map(s => s.id));
    // remove ids que não existem mais
    [...this.selectedSnapIds].forEach(id => { if (!snaps.find(s => s.id === id)) this.selectedSnapIds.delete(id); });
    if (this.selectedSnapIds.size === 0) snaps.forEach(s => this.selectedSnapIds.add(s.id));
    if (!this.rangeStart || !this.rangeEnd) {
      this.rangeStart = snaps[0].startDate;
      this.rangeEnd = snaps[snaps.length - 1].endDate;
    }
    this.renderScopeControls(snaps);
    this.renderAnalysis();
    this.switchTecTab(this.tecTab || 'analise'); // reaplica a aba ativa
    this.applyCfgHidden();
    this.applyEnxuto();
  },
  // Mostra/oculta todos os filtros e configurações da tela (classe .tec-cfg),
  // deixando só os resultados. Estado salvo por perfil.
  applyCfgHidden() {
    const on = !!this._loadPrefs().hideCfg;
    const wrap = document.getElementById('tec-analysis');
    // hide-cfg esconde os filtros; hide-heads enxuga tambem os subtitulos longos
    // dos cabecalhos de cartao, que so explicam o que a tela ja mostra.
    if (wrap) { wrap.classList.toggle('hide-cfg', on); wrap.classList.toggle('hide-heads', on); }
    const btn = document.getElementById('tec-toggle-cfg');
    if (btn) { btn.classList.toggle('is-active', on); btn.innerHTML = `<span class="gg-ic">🔧</span>${on ? 'Mostrar filtros' : 'Ocultar filtros'}`; }
  },
  /* MODO ENXUTO — depois que você entende a tela, textos de ajuda, legendas e
     dicas viram ruído. Este modo esconde tudo isso e deixa só o que muda de
     valor: números, barras e listas. Fica salvo por perfil. */
  applyEnxuto() {
    const on = !!this._loadPrefs().enxuto;
    const tela = document.getElementById('screen-desempenhotec');
    if (tela) tela.classList.toggle('tec-enxuto', on);
    const b = document.getElementById('tec-enxuto-btn');
    if (b) { b.classList.toggle('is-active', on); b.innerHTML = `<span class="gg-ic">🔎</span>${on ? 'Modo completo' : 'Modo enxuto'}`; }
  },
  // normaliza texto p/ casar tópicos entre retratos (sem acento/caixa/espaços extras)
  _nk(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); },
  // Retorna os retratos ativos conforme o escopo selecionado (ordenados por período)
  activeSnapshots() {
    const snaps = DB.getTecSnapshots();
    if (this.scopeMode === 'select') {
      return snaps.filter(s => this.selectedSnapIds.has(s.id));
    }
    if (this.scopeMode === 'range') {
      const a = this.rangeStart, b = this.rangeEnd;
      // inclui retratos cujo PERÍODO [start,end] se sobrepõe ao intervalo [a,b]
      return snaps.filter(s => s.startDate <= b && s.endDate >= a);
    }
    return snaps; // consolidado
  },
  // Agrega vários retratos num "retrato virtual": soma questões e acertos por tópico
  // (casando por disciplina+código+nome) e recalcula o % de acerto (média ponderada).
  aggregate(snaps) {
    if (!snaps || snaps.length === 0) return null;
    const order = [], map = new Map();
    snaps.forEach(s => {
      (s.rows || []).forEach(r => {
        const key = (r.depth === 0)
          ? 'D::' + this._nk(r.nome)
          : this._nk(r.disciplina) + '|' + (r.codigo || '') + '|' + this._nk(r.nome);
        let agg = map.get(key);
        if (!agg) {
          agg = { codigo: r.codigo, nome: r.nome, depth: r.depth, disciplina: r.disciplina, questoes: 0, acertos: 0, peso: r.peso };
          map.set(key, agg); order.push(key);
        }
        agg.questoes += (r.questoes || 0);
        agg.acertos += (r.acertos || 0);
        if (r.peso != null && (agg.peso == null || r.peso > agg.peso)) agg.peso = r.peso;
      });
    });
    const rows = order.map(k => {
      const a = map.get(k);
      a.pctAcerto = a.questoes > 0 ? Math.round((a.acertos / a.questoes) * 1000) / 10 : 0;
      return a;
    });
    // Reagrupa por DISCIPLINA: um tópico que só apareceu no retrato mais novo entrava no
    // fim da lista e, na árvore, acabava pendurado na disciplina errada.
    const nk = this._nk.bind(this);
    const ordemDisc = [];
    rows.forEach(r => { const d = nk(r.disciplina || r.nome); if (!ordemDisc.includes(d)) ordemDisc.push(d); });
    const agrupadas = [];
    ordemDisc.forEach(d => {
      const daDisc = rows.filter(r => nk(r.disciplina || r.nome) === d);
      const raiz = daDisc.filter(r => r.depth === 0);
      const filhos = daDisc.filter(r => r.depth > 0)
        .sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true }));
      agrupadas.push(...raiz, ...filhos);
    });
    const starts = snaps.map(s => s.startDate).sort();
    const ends = snaps.map(s => s.endDate).sort();
    return {
      id: (snaps.length === 1 ? snaps[0].id : '__agg__'),
      aggregated: snaps.length > 1,
      count: snaps.length,
      startDate: starts[0], endDate: ends[ends.length - 1],
      date: starts[0], rows: agrupadas
    };
  },
  // Retrato efetivo usado por toda a análise (agrega o escopo atual)
  scopedSnapshot() {
    const snaps = this.activeSnapshots();
    if (snaps.length === 0) return null;
    return this.aggregate(snaps);
  },
  openImport() {
    $id('tec-empty').style.display = 'none';
    $id('tec-analysis').style.display = 'none';
    const importEl = document.getElementById('tec-import');
    importEl.style.display = 'block';
    // por padrão sugere o dia seguinte ao último período importado, para não sobrepor
    const snaps = DB.getTecSnapshots();
    const defStart = snaps.length ? this.addDays(snaps[snaps.length - 1].endDate, 1) : todayLocal();
    $id('tec-import-start').value = defStart;
    $id('tec-import-end').value = todayLocal() >= defStart ? todayLocal() : defStart;
    $id('tec-import-label').value = '';
    $id('tec-import-text').value = '';
    $id('tec-import-preview').textContent = 'Aguardando dados...';
    $id('tec-import-preview').style.color = 'var(--text-faint)';
    const fn = document.getElementById('tec-file-name');
    fn.style.display = 'none'; fn.textContent = '';
    $id('tec-file-input').value = '';
    this._parsedRows = null;
    this.validateRange();
  },
  addDays(iso, delta) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  // Valida o intervalo: início ≤ fim e sem sobreposição com retratos já existentes.
  // Retorna true se válido; atualiza a mensagem de aviso e o estado do botão Salvar.
  validateRange() {
    const start = $id('tec-import-start').value;
    const end = $id('tec-import-end').value;
    const warn = document.getElementById('tec-range-warn');
    const saveBtn = document.getElementById('tec-import-save');
    const setWarn = (msg) => {
      if (msg) { warn.textContent = msg; warn.style.display = 'block'; saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
      else { warn.style.display = 'none'; saveBtn.disabled = false; saveBtn.style.opacity = ''; }
    };
    if (!start || !end) { setWarn('Informe o início e o fim do período.'); return false; }
    if (start > end) { setWarn('O início do período não pode ser depois do fim.'); return false; }
    const ov = DB.tecOverlap(start, end);
    if (ov) {
      setWarn(`Este intervalo se sobrepõe ao retrato de ${formatDateShort(ov.startDate)} a ${formatDateShort(ov.endDate)}${ov.label ? ' (' + ov.label + ')' : ''}. Para alterar aquele período, exclua-o antes de reimportar.`);
      return false;
    }
    setWarn(null);
    return true;
  },
  // Lê o arquivo enviado. .xlsx/.xls/.csv via SheetJS; texto puro como fallback.
  handleFile(file) {
    if (!file) return;
    const fnEl = document.getElementById('tec-file-name');
    const prev = document.getElementById('tec-import-preview');
    fnEl.style.display = 'inline-flex';
    fnEl.textContent = '📎 ' + file.name;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const finish = (rows) => {
      this._parsedRows = rows;
      const discs = TecEngine.disciplinas({ rows });
      if (rows.length === 0) {
        prev.textContent = '⚠ Não reconheci dados de desempenho neste arquivo. Confira se é a tabela de desempenho por assunto.';
        prev.style.color = 'var(--warn)';
      } else {
        const tot = TecEngine.totais({ rows });
        prev.textContent = `✓ ${discs.length} disciplina(s), ${rows.length} linha(s) · ${tot.questoes} questões · ${tot.pct}% de acerto geral`;
        prev.style.color = 'var(--good)';
      }
    };
    // CSV é texto puro: lê direto (funciona offline, sem biblioteca alguma)
    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (e) => finish(TecEngine.parse(e.target.result));
      reader.readAsText(file);
      return;
    }
    // Fallback via SheetJS (usado só se o leitor embutido falhar OU para .xls antigo).
    // Carrega a biblioteca SOB DEMANDA (não vem no caminho crítico da abertura).
    const trySheetJS = async () => {
      prev.textContent = 'Carregando leitor de planilha…'; prev.style.color = 'var(--text-faint)';
      const ok = await ensureSheetJS();
      if (!ok || typeof XLSX === 'undefined') {
        prev.textContent = (ext === 'xls')
          ? '⚠ Formato .xls antigo requer internet. No Excel/Calc, salve como .xlsx e reenvie.'
          : '⚠ Não consegui ler a planilha. Exporte como .csv ou cole os dados manualmente.';
        prev.style.color = 'var(--warn)';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          // IMPORTANTE: SheetJS type:'array' espera Uint8Array (não ArrayBuffer cru).
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array', cellDates: false });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) { finish([]); return; }
          // Corrige o bug do <dimension> incorreto (arquivos LibreOffice): recalcula o range real
          try { const ref = XLSX.utils.encode_range(XLSX.utils.decode_range(ws['!ref'])); ws['!ref'] = ref; } catch (e0) { _quiet(e0); }
          let rows = [];
          try {
            const tsv = XLSX.utils.sheet_to_csv(ws, { FS: '\t', RS: '\n', blankrows: false });
            rows = TecEngine.parse(tsv);
          } catch (e2) { rows = []; }
          if (rows.length === 0) {
            const cellRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
            rows = TecEngine.parseCellRows(cellRows);
          }
          finish(rows);
        } catch (err) {
          console.error(err);
          prev.textContent = '⚠ Erro ao ler o arquivo. Tente exportar como .csv ou cole os dados manualmente.';
          prev.style.color = 'var(--bad)';
        }
      };
      reader.readAsArrayBuffer(file);
    };
    if (ext === 'xls') { trySheetJS(); return; } // .xls binário antigo: só via SheetJS
    if (ext === 'xlsx') {
      // Leitor .xlsx EMBUTIDO como PRIMÁRIO: funciona offline e ignora o <dimension>
      // incorreto que faz o SheetJS ler só o cabeçalho (0 linhas). SheetJS vira fallback.
      prev.textContent = 'Lendo planilha…'; prev.style.color = 'var(--text-faint)';
      MiniXLSX.readFirstSheet(file)
        .then((res) => {
          const rows = TecEngine.parseCellRows(res.rows);
          if (rows.length === 0) { trySheetJS(); return; }  // embutido não achou linhas → tenta SheetJS sob demanda
          finish(rows);
        })
        .catch((err) => { console.error(err); trySheetJS(); });
      return;
    }
    // txt/tsv: lê como texto e usa o parser de colagem
    const reader = new FileReader();
    reader.onload = (e) => finish(TecEngine.parse(e.target.result));
    reader.readAsText(file);
  },
  updateImportPreview() {
    // digitar no textarea descarta o arquivo carregado (a colagem passa a valer)
    this._parsedRows = null;
    const fn = document.getElementById('tec-file-name');
    fn.style.display = 'none'; fn.textContent = '';
    $id('tec-file-input').value = '';
    const text = $id('tec-import-text').value;
    const rows = TecEngine.parse(text);
    const discs = TecEngine.disciplinas({ rows });
    const prev = document.getElementById('tec-import-preview');
    /* BUG CORRIGIDO — o preview declarava sucesso em dado inutilizavel.
       Se nenhuma DISCIPLINA e reconhecida (acontece quando a coluna Hierarquia
       vem preenchida tambem nas disciplinas, ou quando faltam colunas), o app
       exibia "✓ 0 disciplina(s)" em VERDE e deixava salvar. O retrato entrava
       zerado e a tela inteira mostrava 0% sem explicar nada.
       Agora o preview diz o que houve e como resolver — antes de salvar. */
    if (rows.length === 0) {
      prev.textContent = text.trim()
        ? '⚠ Nenhuma linha reconhecida. Confira se copiou a tabela inteira, com as colunas de questões e % de acertos.'
        : 'Aguardando dados...';
      prev.style.color = text.trim() ? 'var(--warn-text, var(--warn))' : 'var(--text-faint)';
      return;
    }
    const tot = TecEngine.totais({ rows });
    if (discs.length === 0) {
      prev.textContent = '⚠ ' + rows.length + ' linha(s) lida(s), mas nenhuma DISCIPLINA foi reconhecida. '
        + 'No export do TecConcursos a linha da disciplina vem com a coluna "Hierarquia" VAZIA — só os tópicos têm código (01, 01.01). '
        + 'Verifique se essa coluna foi copiada junto.';
      prev.style.color = 'var(--bad)';
      return;
    }
    if (tot.questoes === 0) {
      prev.textContent = '⚠ ' + discs.length + ' disciplina(s) reconhecida(s), mas nenhuma questão. '
        + 'Confira se as colunas de "Questões Resolvidas" e "% de acertos" vieram no que foi colado.';
      prev.style.color = 'var(--bad)';
      return;
    }
    prev.textContent = `✓ ${discs.length} disciplina(s), ${rows.length} linha(s) · ${tot.questoes.toLocaleString('pt-BR')} questões · ${tot.pct}% de acerto geral`;
    prev.style.color = 'var(--good)';
  },
  saveImport() {
    if (!this.validateRange()) { showToast('Ajuste o intervalo de datas antes de salvar'); return; }
    // usa os dados do arquivo, se houver; senão o texto colado
    const rows = (this._parsedRows && this._parsedRows.length)
      ? this._parsedRows
      : TecEngine.parse($id('tec-import-text').value);
    if (!rows || rows.length === 0) { showToast('Envie um arquivo válido ou cole os dados'); return; }
    const start = $id('tec-import-start').value;
    const end = $id('tec-import-end').value;
    const snap = {
      id: Date.now(),
      startDate: start,
      endDate: end,
      date: start, // compat: mantém `date` = início
      label: $id('tec-import-label').value.trim(),
      bancas: (document.getElementById('tec-import-bancas') || {}).value ? $id('tec-import-bancas').value.trim() : '',
      rows,
      importedAt: new Date().toISOString()
    };
    DB.saveTecSnapshot(snap);
    this.currentSnapId = snap.id;
    // garante que o novo retrato entre no escopo atual (marcado na seleção)
    if (this.selectedSnapIds) this.selectedSnapIds.add(snap.id);
    // amplia o intervalo para cobrir o novo período, se o modo for 'range'
    if (!this.rangeEnd || snap.endDate > this.rangeEnd) this.rangeEnd = snap.endDate;
    if (!this.rangeStart || snap.startDate < this.rangeStart) this.rangeStart = snap.startDate;
    this._parsedRows = null;
    showToast('Importação salva ✓');
    this.render();
  },
  // rótulo curto do intervalo de um retrato (ex.: "04/03 → 05/08")
  rangeLabel(s) {
    if (s.startDate === s.endDate) return `${formatDateShort(s.startDate)}`;
    return `${formatDateShort(s.startDate)} → ${formatDateShort(s.endDate)}`;
  },
  // Sincroniza os controles de escopo (botões, painéis, meta) com o estado atual
  renderScopeControls(snaps) {
    // destaca o modo ativo
    document.querySelectorAll('#tec-scope-toggle button').forEach(b =>
      b.classList.toggle('active', b.dataset.scope === this.scopeMode));
    const selPanel = document.getElementById('tec-scope-select');
    const rangePanel = document.getElementById('tec-scope-range');
    selPanel.style.display = this.scopeMode === 'select' ? 'block' : 'none';
    rangePanel.style.display = this.scopeMode === 'range' ? 'block' : 'none';
    if (this.scopeMode === 'select') this.renderScopeSelectPanel(snaps);
    if (this.scopeMode === 'range') this.syncRangeInputs(snaps);
    // com os filtros recolhidos, o cabecalho precisa dizer o que esta valendo
    try { if (window.PainelRecolhivel) PainelRecolhivel.sincronizar('tec-escopo'); }
    catch (e) { _quiet(e, 'resumo-escopo-tec'); }
    // meta (resumo do que está sendo analisado)
    const active = this.activeSnapshots();
    const meta = document.getElementById('tec-snap-meta');
    if (active.length === 0) {
      meta.textContent = 'Nenhum retrato no escopo atual — ajuste a seleção ou o intervalo.';
    } else if (active.length === 1) {
      const s = active[0];
      meta.textContent = `1 retrato · período ${this.rangeLabel(s)}` + (s.label ? ` · ${s.label}` : '');
    } else {
      const starts = active.map(s => s.startDate).sort();
      const ends = active.map(s => s.endDate).sort();
      meta.textContent = `${active.length} retratos consolidados · de ${formatDateShort(starts[0])} a ${formatDateShort(ends[ends.length - 1])} · questões e acertos somados, % recalculado`;
    }
  },
  // Lista de retratos com checkbox (marcar/desmarcar) + exclusão individual
  renderScopeSelectPanel(snaps) {
    const box = document.getElementById('tec-scope-select');
    const rows = snaps.slice().reverse().map(s => {
      const tot = TecEngine.totais(s);
      const checked = this.selectedSnapIds.has(s.id);
      const lbl = s.label ? ` · ${escapeHtml(s.label)}` : '';
      return `<label class="tec-snap-pick" data-id="${s.id}">
        <input type="checkbox" data-snap="${s.id}" ${checked ? 'checked' : ''}>
        <span class="tsp-main"><b>${this.rangeLabel(s)}</b>${lbl}</span>
        <span class="tsp-stats">${tot.questoes} q · ${tot.pct}%</span>
        <button type="button" class="icon-btn danger tsp-del" title="Excluir este retrato" aria-label="Excluir este retrato">×</button>
      </label>`;
    }).join('');
    box.innerHTML = `
      <div class="tec-scope-actions">
        <button type="button" class="tec-tree-btn" id="tec-scope-all">Marcar todos</button>
        <button type="button" class="tec-tree-btn" id="tec-scope-none">Limpar</button>
        <span class="hint" style="margin:0 0 0 auto;">${this.selectedSnapIds.size} de ${snaps.length} selecionado(s)</span>
      </div>
      <div class="tec-scope-list">${rows}</div>`;
    box.querySelectorAll('input[data-snap]').forEach(cb => cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.snap, 10);
      if (cb.checked) this.selectedSnapIds.add(id); else this.selectedSnapIds.delete(id);
      this.renderScopeControls(DB.getTecSnapshots());
      this.renderAnalysis();
    }));
    box.querySelectorAll('.tsp-del').forEach(btn => btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = parseInt(btn.closest('.tec-snap-pick').dataset.id, 10);
      const s = DB.getTecSnapshots().find(x => x.id === id);
      if (!s) return;
      UI.confirm(`Excluir o retrato do período ${this.rangeLabel(s)}${s.label ? ' (' + s.label + ')' : ''}? Essa ação não pode ser desfeita.`, { title: 'Excluir retrato', okText: 'Excluir', danger: true }).then(ok => {
        if (!ok) return;
        DB.deleteTecSnapshot(id);
        this.selectedSnapIds.delete(id);
        showToast('Retrato excluído');
        this.render();
      });
    }));
    const allBtn = box.querySelector('#tec-scope-all');
    const noneBtn = box.querySelector('#tec-scope-none');
    if (allBtn) allBtn.addEventListener('click', () => { snaps.forEach(s => this.selectedSnapIds.add(s.id)); this.renderScopeControls(DB.getTecSnapshots()); this.renderAnalysis(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { this.selectedSnapIds.clear(); this.renderScopeControls(DB.getTecSnapshots()); this.renderAnalysis(); });
  },
  syncRangeInputs(snaps) {
    const startEl = document.getElementById('tec-range-start');
    const endEl = document.getElementById('tec-range-end');
    if (startEl) startEl.value = this.rangeStart || snaps[0].startDate;
    if (endEl) endEl.value = this.rangeEnd || snaps[snaps.length - 1].endDate;
  },
  // snapshot anterior ao retrato em foco — só faz sentido quando o escopo é UM retrato.
  // Nesse caso, compara com o retrato imediatamente anterior no tempo (mostra a evolução).
  prevSnap() {
    const active = this.activeSnapshots();
    if (active.length !== 1) return null; // sem delta em modo consolidado/múltiplo
    const all = DB.getTecSnapshots();
    const idx = all.findIndex(s => s.id === active[0].id);
    return idx > 0 ? all[idx - 1] : null;
  },
  renderAnalysis() {
    const snap = this.scopedSnapshot();
    const wrap = document.getElementById('tec-panel-analise');
    if (!snap) {
      if (wrap) wrap.querySelectorAll('#tec-totais, #tec-weak-list, #tec-disc-list').forEach(el => { if (el) el.innerHTML = ''; });
      const t = document.getElementById('tec-totais'); if (t) t.innerHTML = '<div class="evo-empty-mini" style="grid-column:1/-1;">Nenhum retrato no escopo atual. Ajuste a seleção ou o intervalo de datas acima.</div>';
      return;
    }
    this.renderTotais(snap);
    this.renderWeak(snap);
    this.renderDisciplinas(snap);
  },
  // ---- Abas (Análise / Incidência / Reforço) ----
  tecTab: 'analise',
  switchTecTab(tab) {
    this.tecTab = tab;
    document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(b => b.classList.toggle('active', b.dataset.tectab === tab));
    ['analise', 'incidencia', 'reforco', 'plano'].forEach(t => {
      const el = document.getElementById('tec-panel-' + t);
      if (el) el.style.display = (t === tab) ? 'block' : 'none';
    });
    if (tab === 'incidencia') this.renderIncidencia();
    if (tab === 'reforco') this.renderReforco();
    if (tab === 'plano') this.renderPlano();
    this.applyCfgHidden();
  },
  // ---- Plano de pontos fracos ----
  // Cria uma Atividade Extra ligada a um assunto do plano — fecha o ciclo:
  // você resolve as questões, importa o novo retrato, e a métrica decide se acabou.
  criarExtraDoPlano(topico, disciplina, alvo, motivo) {
    const jaTem = DB.getExtras().find(e => e.origemPlano &&
      ReforcoEngine.norm(e.origemPlano.topico) === ReforcoEngine.norm(topico));
    if (jaTem) { showToast('Já existe uma atividade para "' + topico + '"'); return; }
    const diag = motivo === 'diagnostico';
    const e = DB.addExtra({
      titulo: (diag ? 'Diagnosticar: ' : 'Reforçar: ') + topico,
      tipo: 'questoes',
      disciplina: disciplina || '',
      unidade: 'questoes',
      alvo: Math.max(1, parseInt(alvo, 10) || 30),
      periodo: 'unica',
      contaMetricas: false,
      obs: diag
        ? 'Gerado pelo Plano: amostra insuficiente. Resolva estas questões para saber se é fraqueza real.'
        : 'Gerado pelo Plano de pontos fracos. Ao importar o próximo retrato do TEC, a métrica dirá se o assunto saiu da lista.'
    });
    if (e) {
      const r0 = PlanoEngine.calcular(this.scopedSnapshot(), PlanoEngine.prefs());
      const alvoTop = [].concat((r0 && r0.itens) || [], (r0 && r0.pequenas) || [])
        .find(t => ReforcoEngine.norm(t.nome) === ReforcoEngine.norm(topico));
      DB.updateExtra(e.id, { origemPlano: { topico, disciplina: disciplina || '', motivo: motivo || 'reforco',
        criadoEm: todayLocal(), taxaInicial: alvoTop && alvoTop.taxa != null ? alvoTop.taxa : null } });
      showToast('Atividade criada: ' + (diag ? 'diagnosticar ' : 'reforçar ') + topico);
      this.renderPlanoConteudo();
    }
  },
  renderPlano() {
    const p = PlanoEngine.prefs();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const chk = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
    set('plano-meta', p.metaDominio); set('plano-teto', p.tetoDominio);
    set('plano-ponderacao', p.ponderacao); set('plano-minamostra', p.minAmostra);
    set('plano-customodo', p.custoModo); set('plano-custofixo', p.custoFixo);
    set('plano-custofator', p.custoFator); set('plano-limite', p.limite);
    chk('plano-folhas', p.apenasFolhas); chk('plano-pequenas', p.incluirPequenas);
    set('plano-amostraalvo', p.amostraAlvo); set('plano-cadencia', p.cadenciaDias); set('plano-ordenar', p.ordenar);
    set('plano-janelamax', p.janelaMax); set('plano-consolidar', p.consolidarEm); set('plano-validade', p.validadeDias);
    set('plano-critico', p.faixaCritico); set('plano-fragil', p.faixaFragil);
    set('plano-piso', p.pisoSerie); set('plano-sens', p.sensTendencia);
    const desc = DB.getTecSnapshots().slice().reverse();
    set('plano-ritmo', p.ritmoSemanal || PlanoEngine.ritmoRecente(desc, 120) || 25);
    const ds = document.getElementById('plano-disc');
    if (ds) {
      const discs = PlanoEngine.disciplinas(this.scopedSnapshot());
      ds.innerHTML = `<option value="__todas__">📚 Todas</option>` +
        discs.map(d => `<option value="${escapeHtml(d)}" ${d === p.disciplina ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
      if (![...ds.options].some(o => o.value === p.disciplina)) ds.value = '__todas__';
    }
    // Seletor de banca: só aparece quando há dados de incidência importados.
    // Alimenta a ordenação "🎯 Prioridade na banca".
    const bf = document.getElementById('plano-banca-field');
    const bs = document.getElementById('plano-banca');
    if (bf && bs) {
      const temInc = (typeof ReforcoEngine !== 'undefined') && ReforcoEngine.hasIncidencia && ReforcoEngine.hasIncidencia();
      bf.style.display = temInc ? '' : 'none';
      if (temInc) {
        const bancas = DB.getBancas();
        bs.innerHTML = `<option value="__todas__">Todas as bancas</option>` +
          bancas.map(b => `<option value="${escapeHtml(b)}" ${b === p.banca ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');
        if (![...bs.options].some(o => o.value === p.banca)) bs.value = '__todas__';
      }
    }
    this.renderPlanoConteudo();
  },
  renderPlanoConteudo() {
    const proj = document.getElementById('plano-proj');
    const lista = document.getElementById('plano-lista');
    if (!proj || !lista) return;
    // com os ajustes recolhidos, o cabecalho mostra o que esta valendo
    try { if (window.PainelRecolhivel) PainelRecolhivel.sincronizar('plano-filtros'); }
    catch (e) { _quiet(e, 'resumo-plano'); }
    const num = (id, d) => { const e = document.getElementById(id); const n = parseFloat(e && e.value); return isNaN(n) ? d : n; };
    const val = (id, d) => { const e = document.getElementById(id); return (e && e.value) || d; };
    const bool = (id) => { const e = document.getElementById(id); return !!(e && e.checked); };
    const opts = {
      disciplina: val('plano-disc', '__todas__'),
      metaDominio: Math.max(30, Math.min(100, num('plano-meta', 80))),
      tetoDominio: Math.max(50, Math.min(100, num('plano-teto', 90))),
      ponderacao: val('plano-ponderacao', 'igual'),
      minAmostra: Math.max(0, num('plano-minamostra', 20)),
      incluirPequenas: bool('plano-pequenas'),
      custoModo: val('plano-customodo', 'fixo'),
      custoFixo: Math.max(10, num('plano-custofixo', 60)),
      custoFator: Math.max(0.1, num('plano-custofator', 0.5)),
      apenasFolhas: bool('plano-folhas'),
      limite: Math.max(5, num('plano-limite', 30)),
      amostraAlvo: Math.max(10, num('plano-amostraalvo', 50)),
      janelaMax: Math.max(30, num('plano-janelamax', 365)),
      cadenciaDias: Math.max(7, num('plano-cadencia', 30)),
      consolidarEm: Math.max(1, num('plano-consolidar', 2)),
      faixaCritico: Math.max(0, Math.min(100, num('plano-critico', 50))),
      faixaFragil: Math.max(0, Math.min(100, num('plano-fragil', 65))),
      pisoSerie: Math.max(1, num('plano-piso', 5)),
      sensTendencia: Math.max(1, num('plano-sens', 3)),
      validadeDias: Math.max(30, num('plano-validade', 120)),
      ordenar: val('plano-ordenar', 'rendimento'),
      banca: val('plano-banca', '__todas__')
    };
    // O ritmo SEGUE a medição automaticamente. Só vira manual se você digitar algo
    // diferente do medido — assim novos imports atualizam o número sozinhos.
    const descSnaps = DB.getTecSnapshots().slice().reverse();
    const medido = PlanoEngine.ritmoRecente(descSnaps, 120) || 25;
    const digitado = Math.max(1, num('plano-ritmo', medido));
    opts.ritmoSemanal = (digitado === medido) ? null : digitado;
    PlanoEngine.salvarPrefs(opts);
    opts.ritmoSemanal = opts.ritmoSemanal || medido;
    const r = PlanoEngine.calcular(this.scopedSnapshot(), opts);
    // liga cada assunto à atividade extra já criada para ele (ciclo de acompanhamento)
    if (r && r.itens) {
      const extras = DB.getExtras().filter(e => e.origemPlano && e.origemPlano.topico);
      const casar = (x) => extras.find(e => ReforcoEngine.norm(e.origemPlano.topico) === ReforcoEngine.norm(x.nome));
      [].concat(r.itens, r.pequenas || []).forEach(x => {
        const e = casar(x);
        if (!e) return;
        x.extra = e; x.extraAlvo = e.alvo || 0;
        x.extraFeito = DB.extraProgressoPeriodo ? DB.extraProgressoPeriodo(e) : (e.progresso || 0);
        x.extraConcluida = e.status === 'concluida' || (e.alvo > 0 && x.extraFeito >= e.alvo);
      });
    }
    if (r.erro === 'sem-retrato') {
      proj.innerHTML = `<p class="hint" style="padding:18px 0;">Importe ao menos um retrato de desempenho em <strong>📊 Análise</strong>.</p>`;
      lista.innerHTML = ''; return;
    }
    if (r.erro === 'amostra') {
      proj.innerHTML = `<p class="hint" style="padding:18px 0;">Nenhum assunto atingiu a amostra mínima de <strong>${opts.minAmostra}</strong> questões. Reduza esse valor nos ajustes avançados ou resolva mais questões.</p>`;
      lista.innerHTML = ''; return;
    }
    const tom = r.jaAtinge ? 'good' : (r.falta <= 8 ? 'warn' : 'bad');
    const pond = r.ponderacao === 'volume' ? 'peso pelo volume praticado' : 'todo assunto com o mesmo peso';
    const aviso = (txt, cor) => `<p class="pl-aviso" style="border-color:var(--${cor});background:var(--${cor}-soft);color:var(--${cor}-text);">${txt}</p>`;
    proj.innerHTML = `
      <div class="pl-hero">
        <div class="pl-hero-top">
          <span class="pl-hero-num tone-${tom}">${r.dominioPct.toFixed(1)}%</span>
          <span class="pl-hero-uni">de domínio</span>
        </div>
        <p class="pl-hero-sub">
          Média de acerto nos <strong>${r.assuntos}</strong> ${r.assuntos === 1 ? 'assunto' : 'assuntos'} com amostra suficiente ·
          ${r.qTotal.toLocaleString('pt-BR')} questões · recorte médio de ${r.janelaMedia || '—'} dias
        </p>
        <div class="pl-medidor" style="height:12px;">
          <i style="width:${Math.min(100, r.dominioPct)}%"></i>
          <u style="left:${Math.min(100, r.meta)}%"></u>
        </div>
        <p class="pl-hero-call tone-${tom}">
          ${r.jaAtinge
            ? `✓ Meta de ${r.meta}% alcançada, com folga de ${(r.dominioPct - r.meta).toFixed(1)} pontos.`
            : `Faltam <span class="pl-num">${r.falta.toFixed(1)}</span> pontos para a meta de ${r.meta}%.`}
        </p>
        ${(!r.jaAtinge && r.qAteMeta) ? `<p class="pl-hero-sub" style="margin:6px 0 0;">
          Caminho mais curto: <strong>${r.qAteMeta.toLocaleString('pt-BR')} questões</strong>${r.semanas ? ` · cerca de <strong>${Math.ceil(r.semanas)} semanas</strong> no seu ritmo de ${r.ritmo}/semana` : ''}
        </p>` : ''}

        <div class="pl-chips">
          <span class="pl-chip res" style="border-color:var(--good);color:var(--good-text);" title="Sustentaram a meta em ${r.consolidarEm}+ importações seguidas">🟢 ${r.consolidados} sólidos</span>
          ${r.recentes ? `<span class="pl-chip res" style="border-color:var(--warn);color:var(--warn-text);" title="Cruzaram a meta há pouco — ainda não provaram que fixaram">🟡 ${r.recentes} recém-corrigidos</span>` : ''}
          ${(r.melhorando || r.piorando) ? `<span class="pl-chip res" style="border-color:var(--${r.melhorando >= r.piorando ? 'good' : 'bad'});color:var(--${r.melhorando >= r.piorando ? 'good' : 'bad'}-text);" title="Variação acima de ${r.sensTendencia}pp contra o histórico">📊 ${r.melhorando} melhorando · ${r.piorando} piorando</span>` : ''}
          ${r.vencidos ? `<span class="pl-chip res" style="border-color:var(--bad);color:var(--bad-text);" title="Sem medição nova há mais de ${r.validadeDias} dias">⏳ ${r.vencidos} com dado vencido</span>` : ''}
          ${r.ignorados ? `<span class="pl-chip res" style="border-color:var(--warn);color:var(--warn-text);" title="Sem amostra suficiente — veja o segundo plano no fim">🕳️ ${r.ignorados} sem diagnóstico</span>` : ''}
        </div>
        <div class="pl-chips" style="margin-top:6px;">
          <span class="pl-chip cfg">amostra-alvo ${r.amostraAlvo}q</span>
          <span class="pl-chip cfg">ritmo ${r.ritmo}/sem${r.ritmoMedido === r.ritmo ? ' (medido)' : ''}</span>
          <span class="pl-chip cfg">${pond}</span>
        </div>

        ${r.ignorados >= r.assuntos * 0.5 ? aviso(
          `📐 Este ${r.dominioPct.toFixed(0)}% descreve só os <strong>${r.assuntos}</strong> assuntos medidos. Outros <strong>${r.ignorados}</strong> ainda não têm dado — bater a meta aqui não é dominar a disciplina inteira.`, 'warn') : ''}
        ${r.alvoInviavel ? aviso(
          `⚙ Alvo de amostra alto para o seu volume: só ${r.comAlvo} de ${r.assuntos} chegam a ${r.amostraAlvo} questões (o maior tem ${r.maiorAmostra}). Experimente <strong>${r.maiorAmostra >= 100 ? 100 : r.maiorAmostra >= 50 ? 50 : 30}</strong> em "Amostra confiável".`, 'warn') : ''}
        ${r.defasado ? aviso(
          `⏳ Última importação há <strong>${r.idadeUltimo} dias</strong> — você definiu ${r.cadenciaDias}. Importe um novo período para a leitura refletir seu nível de hoje.`, 'warn') : ''}
      </div>`;

    // ── Trajetória do domínio a cada importação ──
    const S = r.serie || [];
    let grafico = '';
    if (S.length >= 2) {
      const W = 100, H = 34;
      const lo = Math.max(0, Math.min(...S.map(p => p.dominio), r.meta) - 6);
      const hi = Math.min(100, Math.max(...S.map(p => p.dominio), r.meta) + 6);
      const px = (i) => (S.length === 1 ? W / 2 : i / (S.length - 1) * W);
      const py = (v) => H - (v - lo) / Math.max(1, hi - lo) * H;
      const pts = S.map((p, i) => `${px(i).toFixed(1)},${py(p.dominio).toFixed(1)}`).join(' ');
      const yMeta = py(r.meta).toFixed(1);
      const ganho = S[S.length - 1].dominio - S[0].dominio;
      const rend = S.filter(p => p.rendimento != null);
      const rendMedio = rend.length ? rend.reduce((a, p) => a + p.rendimento, 0) / rend.length : null;
      const ultimo = S[S.length - 1];
      grafico = `
        <div class="card" style="background:var(--surface-sunken);box-shadow:var(--shadow-sm);border:1.5px solid var(--border);margin:0 0 16px;">
          <div style="padding:14px 16px;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <strong style="font-size: var(--fs-sm);">📈 Sua trajetória</strong>
              <span class="reforco-tag ${ganho >= 0 ? 'tone-good' : 'tone-bad'}">${ganho >= 0 ? '+' : ''}${ganho.toFixed(1)}pp em ${S.length} importações</span>
            </div>
            <div style="position:relative;height:74px;margin:10px 0 4px;">
              <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;">
                <line x1="0" y1="${yMeta}" x2="${W}" y2="${yMeta}" stroke="var(--text-faint)" stroke-width="0.4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
                <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
              </svg>
              ${/* pontos em HTML: dentro do SVG esticado eles viravam elipses */''}
              ${S.map((p, i) => `<span title="${escapeHtml(formatDateShort(p.data))}: ${p.dominio.toFixed(1)}%"
                style="position:absolute;left:${px(i).toFixed(1)}%;top:${(py(p.dominio) / H * 100).toFixed(1)}%;
                width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;
                background:var(--accent);border:2px solid var(--surface);box-sizing:border-box;"></span>`).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-family:'Inter',sans-serif;font-size: var(--fs-3xs);color:var(--text-faint);">
              <span>${escapeHtml(formatDateShort(S[0].data))} · ${S[0].dominio.toFixed(0)}%</span>
              <span style="color:var(--text-soft);font-weight:700;">linha tracejada = meta ${r.meta}%</span>
              <span>${escapeHtml(formatDateShort(ultimo.data))} · ${ultimo.dominio.toFixed(0)}%</span>
            </div>
            ${rendMedio != null ? `<p class="pl-prosa" style="margin:10px 0 0;">
              <strong>Retorno do seu esforço:</strong> ${rendMedio.toFixed(1)}pp de domínio a cada 100 questões resolvidas.
              ${S[S.length - 1].rendimento != null ? 'No último período foram ' + S[S.length - 1].rendimento.toFixed(1) + 'pp por 100 questões' +
                (S[S.length - 1].rendimento < rendMedio * 0.5 ? ' — bem abaixo da sua média, sinal de que só aumentar o volume parou de funcionar neste momento.' : '.') : ''}
            </p>` : ''}
          </div>
        </div>`;
    }
    const linhas = r.itens.map((x, i) => {
      const sens = r.sensTendencia || 3;
      const seta = x.delta == null ? '' :
        x.delta >= sens ? `<span class="reforco-tag tone-good" title="Taxa recente acima da média histórica — você evoluiu">▲ ${x.delta}pp</span>` :
        x.delta <= -sens ? `<span class="reforco-tag tone-bad" title="Taxa recente abaixo da média histórica">▼ ${x.delta}pp</span>` : '';
      const desdeAtiv = (x.extra && x.extra.origemPlano && x.extra.origemPlano.taxaInicial != null && x.taxa != null)
        ? `<span class="reforco-tag ${x.taxa - x.extra.origemPlano.taxaInicial >= 0 ? 'tone-good' : 'tone-bad'}" title="Evolução desde que você criou a atividade em ${escapeHtml(formatDateShort(x.extra.origemPlano.criadoEm))}">desde a atividade ${x.extra.origemPlano.taxaInicial.toFixed(0)}→${x.taxa.toFixed(0)}%</span>` : '';
      const marca = (i === r.idxMeta) ? `<div class="pl-marco">🏁 Daqui para cima já basta para chegar a ${r.meta}% de domínio</div>` : '';
      // Direção curta (onde ir), sempre visível — derivada da faixa de acerto.
      const faltaMeta = Math.max(0, r.meta - x.taxa);
      let dir, dirTom;
      if (x.taxa < r.faixaCritico) { dirTom = 'bad'; dir = 'Retome a teoria: você erra mais do que acerta. Só depois volte às questões.'; }
      else if (x.taxa < r.faixaFragil) { dirTom = 'bad'; dir = 'Revise a teoria dos pontos que erra e alterne com blocos de questões.'; }
      else if (x.taxa < r.meta) { dirTom = 'warn'; dir = 'Faltam ' + faltaMeta.toFixed(0) + ' pts: resolva questões e revise só o que errar.'; }
      else if (x.status.rot.indexOf('Consolidado') >= 0) { dirTom = 'good'; dir = 'Sustentado — só revisão espaçada leve.'; }
      else { dirTom = 'warn'; dir = 'Passou da meta há pouco: mantenha um volume pequeno até fixar.'; }
      // Caixinhas numéricas (leitura rápida do status).
      const metricas = `
        <div class="pl-metrics">
          <div class="plm"><b class="tone-${x.conf.tom}">${x.taxa.toFixed(0)}%</b><span>acerto${x.margem != null ? ' ±' + x.margem.toFixed(0) : ''}</span></div>
          <div class="plm"><b class="tone-${dirTom}">${faltaMeta > 0 ? faltaMeta.toFixed(0) : '✓'}</b><span>pts p/ meta</span></div>
          <div class="plm"><b>${x.custoQ}</b><span>questões (custo)</span></div>
          <div class="plm"><b>${x.qJanela}</b><span>na amostra</span></div>
        </div>`;
      // Guia expansível (orientação completa) — aberta só nos primeiros itens (prioridade).
      const abreGuia = (r.idxMeta < 0 || i <= Math.max(r.idxMeta, 2));
      const guia = `
        <details class="pl-guia" ${abreGuia ? 'open' : ''}>
          <summary>💡 Como estudar este assunto <span class="chev">▾</span></summary>
          <div class="pl-guia-body">
            <p class="pl-acao">${escapeHtml(x.status.acao)}</p>
            <p class="pl-base">Máximo realista ${r.teto}% · faltam <b>${(r.teto - x.taxa).toFixed(0)} pts</b> até lá · medido em <b>${x.qJanela}</b> questões${x.diasJanela ? ' dos últimos <b>' + x.diasJanela + '</b> dias' : ''}${x.qHist > x.qJanela ? ' (de <b>' + x.qHist + '</b> no total)' : ''}.</p>
          </div>
        </details>`;
      return `
        <div class="pl-item">
          <div class="pl-rank">${i + 1}</div>
          <div class="pl-nome">${escapeHtml(x.nome)}</div>
          <div class="pl-ganho">
            ${r.ponderacao === 'ambas' ? `
              <b class="pl-g-dom" title="Sobe o DOMÍNIO: cada assunto pesa igual">+${x.ganhoDominio.toFixed(1)}pp</b>
              <span title="Sobe o DOMÍNIO">⚖️ domínio</span>
              <b class="pl-g-ger" title="Sobe o APROVEITAMENTO GERAL (ponderado por questão): recupera ${Math.round(x.ganhoQuestoes)} questões">+${x.ganhoGeral.toFixed(2)}pp</b>
              <span title="Aproveitamento geral desta tela">📊 geral · ${Math.round(x.ganhoQuestoes)}q</span>
            ` : `
              <b>+${x.ganhoPP.toFixed(1)}pp</b>
              <span>${r.ponderacao === 'volume' ? '📊 geral → ' : '⚖️ domínio → '}${x.acumulado.toFixed(1)}%</span>
            `}
          </div>
          <div class="pl-corpo">
            ${x.disciplina ? `<div class="pl-disc">${escapeHtml(x.disciplina)}</div>` : ''}
            <div class="pl-tags">
              <span class="reforco-tag tone-${x.status.tom}" title="${x.status.seq != null ? x.status.seq + ' importação(ões) seguidas na meta' : 'Faixa de acerto'}">${x.status.rot}${x.status.seq ? ' ' + x.status.seq + '×' : ''}</span>
              ${(x.incid > 0) ? `<span class="reforco-tag incid" title="Incidência na banca ${escapeHtml(r.banca === '__todas__' ? 'selecionada' : r.banca)}: aparece bastante na prova">🎯 incidência ${x.incid}</span>` : ''}
              ${seta}${desdeAtiv}
              ${x.vencido ? `<span class="reforco-tag tone-bad" title="Sem medição nova — a taxa pode não refletir você hoje">⏳ ${x.diasDesdeMedicao}d</span>` : ''}
            </div>
            <div class="pl-medidor" title="${x.taxa.toFixed(0)}% de acerto · marcador no máximo realista de ${r.teto}%">
              <i style="width:${Math.min(100, x.taxa)}%"></i><u style="left:${Math.min(100, r.teto)}%"></u>
            </div>
            <p class="pl-direcao tone-${dirTom}"><span class="seta">➜</span><span>${dir}</span></p>
            ${metricas}
            ${guia}
            <div class="pl-rodape">
              ${x.extra
                ? `<span class="reforco-tag ${x.extraConcluida ? 'tone-good' : 'incid'}">${x.extraConcluida ? '✓ meta batida' : '▶ ' + x.extraFeito + '/' + x.extraAlvo}</span>`
                : `<button type="button" class="btn-secondary plano-nova-extra" style="padding:6px 12px;font-size: var(--fs-2xs);white-space:nowrap;" data-topico="${escapeHtml(x.nome)}"
                     data-disc="${escapeHtml(x.disciplina || '')}" data-alvo="${x.custoQ}" data-motivo="reforco">+ Atividade</button>`}
            </div>
          </div>
        </div>${marca}`;
    }).join('');
    const pequenas = r.pequenas.length ? `
      <div style="margin-top:22px;padding-top:16px;border-top:2px solid var(--border);">
        <p class="section-label" style="margin:0 0 4px;">🕳️ Segundo plano — assuntos sem diagnóstico</p>
        <p class="pl-prosa" style="margin:0 0 12px;">
          Menos de ${opts.minAmostra} questões resolvidas: ainda não dá para afirmar que é fraqueza.
          Ficam fora da média de domínio de propósito — com amostra assim pequena a taxa real pode variar dezenas de pontos.
          <strong>Aqui a ação é outra:</strong> resolver questões para descobrir onde você está.
        </p>
        ${r.pequenas.slice(0, 15).map((x, i) => `
          <div class="pl-item">
            <div class="pl-rank" style="background:var(--surface-sunken);color:var(--text-faint)">${i + 1}</div>
            <div class="pl-nome">${escapeHtml(x.nome)}</div>
            <div class="pl-ganho"><b style="color:var(--text-faint);font-size: var(--fs-sm);">?</b></div>
            <div class="pl-corpo">
              ${x.disciplina ? `<div class="pl-disc">${escapeHtml(x.disciplina)}</div>` : ''}
              <div class="pl-tags">
                <span class="reforco-tag tone-warn" title="Margem de erro grande demais para servir de diagnóstico">
                  ${x.taxa != null ? x.taxa.toFixed(0) + '%' : '—'}${x.margem != null ? ' ±' + x.margem.toFixed(0) + 'pp' : ''} em ${x.qJanela} ${x.qJanela === 1 ? 'questão' : 'questões'}
                </span>
              </div>
              <div class="pl-rodape">
                <p class="pl-base">Resolva <b>${x.faltaAmostra}</b> questões para virar diagnóstico confiável.</p>
                <button type="button" class="btn-secondary plano-nova-extra" style="padding:6px 12px;font-size: var(--fs-2xs);white-space:nowrap;"
                  data-topico="${escapeHtml(x.nome)}" data-disc="${escapeHtml(x.disciplina || '')}"
                  data-alvo="${x.faltaAmostra}" data-motivo="diagnostico">+ Atividade</button>
              </div>
            </div>
          </div>`).join('')}
      </div>` : '';
    const comoLer = `
      <details class="rfc-advanced" style="margin:0 0 14px;padding:12px 14px;">
        <summary style="cursor:pointer;font-weight:700;font-size: var(--fs-sm);">📖 Como ler esta tela</summary>
        <div class="pl-prosa" style="margin-top:10px;line-height:1.7;">
          <p style="margin:0 0 10px;"><strong>Domínio</strong> é a sua taxa média de acerto nos assuntos que você já praticou o suficiente para medir. É o número grande lá em cima, e é ele que deve subir.</p>
          <p style="margin:0 0 10px;"><strong>pp</strong> quer dizer <em>pontos percentuais</em>. Sair de 70% para 75% é ganhar 5pp. Usamos pp em vez de % para não confundir com a própria taxa de acerto.</p>
          <p style="margin:0 0 10px;"><strong>63% ±11pp</strong> é sua taxa naquele assunto e o quanto ela pode variar. Amostra pequena dá margem grande: com 8 questões, um 40% pode ser qualquer coisa entre 4% e 71%. Por isso assuntos com pouca prática ficam fora do cálculo e vão para o segundo plano.</p>
          <p style="margin:0 0 10px;"><strong>Medido em N questões dos últimos X dias</strong> mostra de onde veio a taxa. O app usa sempre o dado mais recente e só recua no tempo até juntar amostra suficiente — assim um assunto que você já corrigiu não fica preso ao desempenho antigo.</p>
          <p style="margin:0 0 10px;"><strong>+2,8pp</strong> é quanto o seu domínio sobe se você levar aquele assunto ao acerto máximo realista. <strong>Custo estimado</strong> é a ordem de grandeza de questões para isso — serve para comparar assuntos entre si, não para prever com precisão.</p>
          <p style="margin:0 0 10px;"><strong>🟡 Recém-corrigido × 🟢 Consolidado</strong> é a distinção mais importante. Cruzar a meta uma vez não prova que fixou. Só vira sólido quem sustenta a meta em importações seguidas — e até lá vale manter um volume menor de questões no assunto.</p>
          <p style="margin:0 0 10px;"><strong>Escopo × taxa:</strong> o seletor de <em>Escopo da análise</em> (no topo) define <em>quais assuntos</em> entram aqui, mas a <em>taxa</em> de cada assunto usa sempre o seu dado mais recente — o Plano responde “como você está hoje”, não como estava no período selecionado.</p>
          <p style="margin:0;"><strong>Como agir:</strong> comece pelo topo. Cada assunto traz a orientação conforme a faixa de acerto — abaixo de 50% o problema costuma ser de teoria, acima de 65% costuma ser falta de volume. A faixa verde marca até onde você precisa ir para bater a meta. Use <strong>+ Atividade</strong> para virar aquilo numa tarefa com meta, e reimporte o TEC quando terminar.</p>
        </div>
      </details>`;
    const rotOrdem = { banca: 'prioridade na banca (retorno × incidência)', rendimento: 'melhor retorno (ganho ÷ custo)', pior: 'pior acerto primeiro',
      queda: 'maior queda recente', volume: 'mais questões já resolvidas' }[r.ordenar] || 'pior acerto primeiro';
    // com custo fixo e peso igual, "retorno" e "pior acerto" dão a MESMA ordem — dizer isso
    // evita a impressão de que há uma métrica escondida decidindo por você
    // Só avisa quando o usuário escolheu "rendimento": aí é útil saber que, com custo
    // fixo e peso igual, o resultado é o mesmo de "pior acerto primeiro".
    const mesmaOrdem = (opts.custoModo === 'fixo' && opts.ponderacao === 'igual' && r.ordenar === 'rendimento');
    const notaBanca = (r.ordenar === 'banca')
      ? (r.temIncid
          ? ` — assuntos que <strong>caem mais ${r.banca === '__todas__' ? 'nas suas bancas' : 'na banca ' + escapeHtml(r.banca)}</strong> e ainda têm o que melhorar sobem ao topo (${r.comIncid} com incidência)`
          : ' — importe a incidência em 🎲 Incidência para esta ordenação fazer efeito')
      : '';
    lista.innerHTML = (linhas
      ? grafico + comoLer + `<div class="pl-prosa" style="margin:0 0 8px;color:var(--text-faint);">Ordenado por <strong>${rotOrdem}</strong> · ${r.itens.length} ${r.itens.length === 1 ? 'assunto' : 'assuntos'}${mesmaOrdem ? ' — com custo fixo e peso igual, esta ordem é idêntica a "pior acerto primeiro"' : ''}${notaBanca}</div>${linhas}`
      : `<p class="hint" style="padding:18px 0;">Nenhum assunto abaixo do máximo realista — você já domina tudo que pratica.</p>`) + pequenas;
    lista.querySelectorAll('.plano-nova-extra').forEach(b => b.addEventListener('click', () => {
      this.criarExtraDoPlano(b.dataset.topico, b.dataset.disc, b.dataset.alvo, b.dataset.motivo);
    }));
  },
  // ---- Incidência ----
  _incidParsed: null,
  renderIncidencia() {
    // Render novo = árvores novas. Sem limpar, uma banca excluída (ou renomeada)
    // deixaria a floresta antiga guardada e o bloco poderia nascer com dado velho.
    this._incidForests = {};
    this._incidLazy.clear();
    // datalist de bancas
    $id('incid-banca-list').innerHTML = DB.getBancas().map(b => `<option value="${escapeHtml(b)}">`).join('');
    const bancas = DB.getBancas();
    const card = document.getElementById('incid-bancas-card');
    const list = document.getElementById('incid-bancas-list');
    if (bancas.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const all = DB.getIncidencia();
    const autoOpen = (bancas.length === 1); // se só há uma banca, já abre o detalhe
    list.innerHTML = bancas.map(b => {
      const rows = all.filter(r => r.banca === b);
      const nDisc = rows.filter(r => r.depth === 0).length;
      // TOTAL correto: como pai = soma dos filhos, o total é a soma das DISCIPLINAS
      // (nível 0). Sem info de nível (formato colado plano), soma tudo.
      const soma = nDisc > 0
        ? rows.filter(r => r.depth === 0).reduce((s, r) => s + (r.incidencia || 0), 0)
        : rows.reduce((s, r) => s + (r.incidencia || 0), 0);
      const nSub = rows.length - nDisc;
      const maxInc = Math.max(1, ...rows.map(r => r.incidencia || 0));
      // TOTAL DO CADERNO (quando o arquivo traz a coluna "Porcentagem"): reconstrói pelo
      // % das disciplinas — total = incidência ÷ (%/100). Se a soma das disciplinas já
      // cobre ~100% (como no novo modelo), o total é o próprio "soma".
      const discComPct = rows.filter(r => r.depth === 0 && r.pct != null && r.pct > 0);
      let cadernoTotal = null;
      if (discComPct.length) {
        const sIncid = discComPct.reduce((s, r) => s + (r.incidencia || 0), 0);
        const sPct = discComPct.reduce((s, r) => s + r.pct, 0);
        if (sPct > 0) cadernoTotal = Math.round(sIncid / (sPct / 100));
      }
      const naoClass = (cadernoTotal != null && cadernoTotal > soma + 2) ? (cadernoTotal - soma) : 0;
      const headCount = (cadernoTotal != null && naoClass > 0)
        ? `${nDisc} disc. · ~${cadernoTotal.toLocaleString('pt-BR')} questões no caderno`
        : `${nDisc} disc. · ${soma.toLocaleString('pt-BR')} questões`;
      /* Resumo em PILULAS, no lugar do paragrafo corrido de antes.
         Cada numero vira um bloco com rotulo proprio — a mesma leitura de
         relance dos cartoes da aba Analise, so que com o dado daqui. */
      const pilula = (val, rot, tom) =>
        `<span class="incid-pill ${tom || ''}"><b>${val}</b><i>${rot}</i></span>`;
      const summaryHtml = [
        pilula(nDisc.toLocaleString('pt-BR'), nDisc === 1 ? 'disciplina' : 'disciplinas', 'roxo'),
        pilula(nSub.toLocaleString('pt-BR'), nSub === 1 ? 'subtópico' : 'subtópicos', 'azul'),
        pilula((cadernoTotal != null && naoClass > 0 ? '~' + cadernoTotal.toLocaleString('pt-BR') : soma.toLocaleString('pt-BR')), 'questões', 'verde'),
        (cadernoTotal != null && naoClass > 0)
          ? pilula(naoClass.toLocaleString('pt-BR'), 'sem assunto no índice', 'cinza') : ''
      ].join('') + `<span class="incid-legend">As barras mostram o peso de cada tópico em relação ao mais cobrado do grupo.</span>`;
      // Reconstrói a HIERARQUIA (disciplina → assunto → tópico) a partir das linhas salvas
      const forest = this._buildIncidForest(rows);
      // base das barras de nível 0 = maior disciplina (barras relativas aos irmãos)
      const rootMax = Math.max(1, ...forest.map(n => n.incidencia || 0));
      // A ÁRVORE NÃO É MONTADA AQUI. Antes, o índice inteiro de TODAS as bancas
      // virava HTML já no primeiro render — inclusive o de bancas fechadas, que
      // ninguém estava olhando. Agora a floresta fica guardada e só vira HTML
      // quando o bloco da banca é aberto (e, dentro dele, nível a nível).
      this._incidForests[b] = { forest, rootMax };
      const treeHtml = forest.length
        ? `<div class="itree" data-tree-banca="${escapeHtml(b)}"></div>`
        : '<div class="incid-detail-empty">Nenhum tópico.</div>';
      return `<div class="incid-banca-block ${autoOpen ? 'open' : ''}" data-banca="${escapeHtml(b)}">
        <div class="incid-banca-row expandable">
          <span class="incid-caret">▶</span>
          <span class="incid-banca-name">${escapeHtml(b)}</span>
          <span class="incid-banca-count">${headCount}</span>
          <button type="button" class="icon-btn danger incid-banca-del" title="Excluir esta banca" aria-label="Excluir esta banca">×</button>
        </div>
        <div class="incid-detail">
          <div class="incid-detail-summary">${summaryHtml}</div>
          <div class="itree-toolbar">
            <select class="incid-disc-filter" style="min-width:160px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font-size:12.5px;">
              <option value="__todas__">📚 Todas as disciplinas</option>
              ${forest.map(n => `<option value="${escapeHtml(n.nome)}">${escapeHtml(n.nome)} (${n.incidencia})</option>`).join('')}
            </select>
            <input type="text" class="incid-detail-search" placeholder="🔎 Filtrar assuntos..." style="flex:1; min-width:140px;">
            <button type="button" class="tec-tree-btn itree-expand">⊞ Expandir</button>
            <button type="button" class="tec-tree-btn itree-collapse">⊟ Recolher</button>
          </div>
          <div class="incid-detail-list">${treeHtml}</div>
        </div>
      </div>`;
    }).join('');
    // interações: expandir/recolher a banca, excluir, filtrar, e navegar a árvore
    list.querySelectorAll('.incid-banca-block').forEach(block => {
      const head = block.querySelector('.incid-banca-row');
      const del = block.querySelector('.incid-banca-del');
      head.addEventListener('click', (e) => {
        if (e.target.closest('.incid-banca-del')) return;
        // monta a árvore desta banca na primeira abertura (custo pago só uma vez,
        // e só para a banca que você realmente quis ver)
        if (!block.classList.contains('open')) this._incidBuildTree(block.querySelector('.itree[data-tree-banca]'));
        block.classList.toggle('open');
      });
      // Quando há uma única banca o bloco JÁ NASCE aberto (autoOpen) — e nesse caso
      // ninguém clica no cabeçalho para disparar a montagem. Sem isto, o caso mais
      // comum de todos (um só caderno) exibiria uma árvore vazia.
      if (block.classList.contains('open')) this._incidBuildTree(block.querySelector('.itree[data-tree-banca]'));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = block.dataset.banca;
        UI.confirm(`Excluir toda a incidência da banca "${b}"?`, { title: 'Excluir incidência', okText: 'Excluir', danger: true }).then(ok => {
          if (!ok) return;
          DB.clearIncidenciaBanca(b); this.renderIncidencia();
        });
        return;
      });
      // Toggle e edição por DELEGAÇÃO: as linhas passam a nascer sob demanda, então
      // não dá mais para registrar um listener por linha no momento do render —
      // e isso também elimina milhares de listeners de uma vez só.
      block.addEventListener('click', (e) => {
        const row = e.target.closest('.itree-row.has-kids');
        if (!row || !block.contains(row) || e.target.closest('.itree-edit')) return;
        e.stopPropagation();
        const nodeEl = row.closest('.itree-node');
        if (!nodeEl.classList.contains('open')) this._incidHydrate(nodeEl.querySelector(':scope > .itree-children'));
        nodeEl.classList.toggle('open');
      });
      // editar/renomear item de incidência
      block.addEventListener('click', (e) => {
        const btn = e.target.closest('.itree-edit');
        if (btn && block.contains(btn)) {
          e.stopPropagation();
          const id = btn.dataset.id;
          const nomeAtual = btn.dataset.nome;
          const incAtual = btn.dataset.inc;
          UI.prompt([
            { key: 'nome', label: 'Nome do tópico/disciplina', type: 'text', value: nomeAtual },
            { key: 'inc', label: 'Incidência (nº de questões)', type: 'number', value: incAtual, min: 0 }
          ], { title: '✎ Editar incidência', okText: 'Salvar' }).then(v => {
            if (!v) return;
            DB.updateIncidenciaItem(id, { topico: v.nome, incidencia: v.inc });
            this.renderIncidencia();
            showToast('Incidência atualizada ✓');
          });
        }
      });
      // expandir/recolher tudo
      const setAll = (open) => {
        if (open) this._incidHydrateAll(block);   // só ao expandir vale montar a árvore inteira
        block.querySelectorAll('.itree-node').forEach(n => { if (n.querySelector(':scope > .itree-children')) n.classList.toggle('open', open); });
      };
      const exp = block.querySelector('.itree-expand'); if (exp) exp.addEventListener('click', (e) => { e.stopPropagation(); setAll(true); });
      const col = block.querySelector('.itree-collapse'); if (col) col.addEventListener('click', (e) => { e.stopPropagation(); setAll(false); });
      // busca hierárquica (mostra o nó se ele OU um descendente casar; expande os caminhos)
      const search = block.querySelector('.incid-detail-search');
      // As raízes são lidas na hora do uso (não mais fixadas no render): com a árvore
      // sob demanda, elas podem ainda não existir quando os listeners são criados.
      const getRoots = () => Array.from(block.querySelectorAll('.itree > .itree-node'));
      const filterNode = (node, q) => {
        const nameEl = node.querySelector(':scope > .itree-row .itree-label');
        const selfMatch = !q || (nameEl && nameEl.dataset.s.includes(q));
        const kids = Array.from(node.querySelectorAll(':scope > .itree-children > .itree-node'));
        let kidVisible = false;
        kids.forEach(k => { if (filterNode(k, q)) kidVisible = true; });
        const visible = selfMatch || kidVisible;
        node.style.display = visible ? '' : 'none';
        if (q && kidVisible) node.classList.add('open');
        return visible;
      };
      if (search) {
        search.addEventListener('click', (e) => e.stopPropagation());
        search.addEventListener('input', () => {
          const q = this._normSearch(search.value);
          // BUSCAR exige a árvore inteira em memória — um tópico ainda não
          // materializado seria um falso negativo. Custo pago na 1ª tecla, uma vez.
          if (q) this._incidHydrateAll(block);
          getRoots().forEach(r => filterNode(r, q));
        });
      }
      // filtro por DISCIPLINA: mostra só o ramo escolhido (ou todos)
      const discSel = block.querySelector('.incid-disc-filter');
      if (discSel) discSel.addEventListener('change', () => {
        const val = discSel.value;
        this._incidBuildTree(block.querySelector('.itree[data-tree-banca]'));
        getRoots().forEach(r => {
          const nameEl = r.querySelector(':scope > .itree-row .itree-label');
          const nome = nameEl ? nameEl.getAttribute('title') : '';
          const show = (val === '__todas__') || (nome === val);
          r.style.display = show ? '' : 'none';
          if (show && val !== '__todas__') r.classList.add('open');
        });
        if (search) search.value = '';
      });
    });
  },
  // Reconstrói a floresta hierárquica a partir das linhas salvas (código define o nível)
  _buildIncidForest(rows) {
    const forest = []; let discNode = null; let byCodigo = {};
    rows.forEach(r => {
      const node = { id: r.id, nome: r.topico, incidencia: r.incidencia || 0, codigo: r.codigo || null, depth: r.depth, children: [] };
      if (r.depth === 0) { discNode = node; byCodigo = {}; forest.push(node); }
      else if (r.codigo) {
        byCodigo[r.codigo] = node;
        const parts = r.codigo.split('.');
        const parentCod = parts.slice(0, -1).join('.');
        const parent = (parts.length > 1 && byCodigo[parentCod]) ? byCodigo[parentCod] : discNode;
        (parent ? parent.children : forest).push(node);
      } else if (discNode) { discNode.children.push(node); }
      else forest.push(node);
    });
    return forest;
  },
  // floresta de cada banca, guardada para virar HTML sob demanda
  _incidForests: {},
  _incidLazy: new Map(),
  _incidSeq: 0,
  // Monta a árvore de UMA banca (chamado ao abrir o bloco). Os níveis abaixo do
  // primeiro continuam sendo promessas até serem abertos.
  _incidBuildTree(box) {
    if (!box || box.dataset.built === '1') return;
    const b = box.getAttribute('data-tree-banca');
    const reg = this._incidForests[b];
    if (!reg) return;
    box.dataset.built = '1';
    box.innerHTML = reg.forest.map(n => this._incidNodeHtml(n, 0, reg.rootMax)).join('');
    // o nível 0 já nasce aberto (classe "open"), então os filhos dele precisam existir
    box.querySelectorAll(':scope > .itree-node.open').forEach(n =>
      this._incidHydrate(n.querySelector(':scope > .itree-children')));
  },
  _incidHydrate(box) {
    if (!box) return false;
    const lid = box.getAttribute('data-ilazy');
    if (!lid) return false;
    const reg = this._incidLazy.get(lid);
    box.removeAttribute('data-ilazy');
    this._incidLazy.delete(lid);
    if (!reg) return false;
    const childMax = Math.max(1, ...reg.node.children.map(c => c.incidencia || 0));
    box.innerHTML = reg.node.children.map(k => this._incidNodeHtml(k, reg.level + 1, childMax)).join('');
    return true;
  },
  // Materializa toda a árvore de um bloco — necessário antes de BUSCAR ou de
  // "Expandir tudo": um assunto que ainda não nasceu não poderia ser encontrado.
  _incidHydrateAll(block) {
    const box = block.querySelector('.itree[data-tree-banca]');
    if (box) this._incidBuildTree(box);
    // Por NÍVEL (ver a nota em _hydrateAll da árvore do TEC): resolver um marcador
    // por varredura completa seria O(n²) e travaria a tela no índice de um caderno grande.
    let pend = block.querySelectorAll('.itree-children[data-ilazy]');
    let nivel = 0;
    while (pend.length && nivel++ < 64) {
      pend.forEach(b => this._incidHydrate(b));
      pend = block.querySelectorAll('.itree-children[data-ilazy]');
    }
  },
  _incidNodeHtml(node, level, siblingMax) {
    const hasKids = node.children && node.children.length > 0;
    // Barra RELATIVA AOS IRMÃOS (não ao total do caderno): o maior item de cada
    // grupo enche a barra, tornando a comparação visível em todos os níveis.
    const base = siblingMax || node.incidencia || 1;
    const pct = Math.max(3, Math.round((node.incidencia / base) * 100)); // piso de 3% para não sumir
    const indent = 10 + level * 16;
    const caret = hasKids ? '<span class="itree-caret">▶</span>' : '<span class="itree-dot"></span>';
    let kids = '';
    if (hasKids) {
      const lid = 'il' + (++this._incidSeq);
      this._incidLazy.set(lid, { node, level });
      kids = `<div class="itree-children" data-ilazy="${lid}"></div>`;
    }
    const ns = this._normSearch(node.nome);
    const editBtn = node.id ? `<button type="button" class="itree-edit" data-id="${node.id}" data-nome="${escapeHtml(node.nome)}" data-inc="${node.incidencia}" title="Editar/renomear" aria-label="Editar/renomear">✎</button>` : '';
    return `<div class="itree-node ${level === 0 ? 'open' : ''}">
      <div class="itree-row ${hasKids ? 'has-kids' : ''} ${level === 0 ? 'lvl0' : ''}" style="padding-left:${indent}px;">
        <span class="itree-name">${caret}<span class="itree-label" data-s="${escapeHtml(ns)}" title="${escapeHtml(node.nome)}">${escapeHtml(node.nome)}</span></span>
        <span class="itree-bar"><span style="width:${pct}%"></span></span>
        <span class="itree-val" title="${node.incidencia} questão(ões) no histórico">${node.incidencia}</span>
        ${editBtn}
      </div>
      ${kids}
    </div>`;
  },
  _normSearch(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  },
  // Fonte dos dados: 'file' (arquivo importado) ou 'paste' (textarea). Guardamos as
  // linhas do arquivo separadamente para que digitar a banca NÃO apague a importação.
  _incidFileRows: null,
  updateIncidPreview() {
    const prev = document.getElementById('incid-preview');
    const text = $id('incid-text').value;
    // Se há um arquivo importado e o textarea está vazio, mantemos as linhas do arquivo.
    if (this._incidFileRows && !text.trim()) {
      this._incidParsed = this._incidFileRows;
      prev.textContent = `✓ ${this._incidFileRows.length} tópico(s) reconhecido(s) para importar (arquivo).`;
      prev.style.color = 'var(--good)';
      return;
    }
    // Caso o usuário cole texto, o textarea tem prioridade (e limpamos a fonte "arquivo").
    if (text.trim()) this._incidFileRows = null;
    const banca = $id('incid-banca').value.trim();
    this._incidParsed = ReforcoEngine.parseIncidencia(text, banca || 'X');
    if (!text.trim()) { prev.textContent = 'Aguardando dados...'; prev.style.color = 'var(--text-faint)'; return; }
    if (this._incidParsed.length === 0) { prev.textContent = '⚠ Nenhuma linha reconhecida (use Disciplina · Tópico · Incidência).'; prev.style.color = 'var(--warn)'; }
    else { prev.textContent = `✓ ${this._incidParsed.length} tópico(s) reconhecido(s).`; prev.style.color = 'var(--good)'; }
  },
  // Sugere a sigla da banca a partir do nome do arquivo (ex.: "fcc 10 anos fiscal.xlsx" -> "FCC")
  _bancaFromFilename(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '');
    const m = base.match(/\b(fcc|fgv|cespe|cebraspe|vunesp|cespe|iades|quadrix|aocp|ibfc|consulplan|idecan|fumarc|instituto\s*aocp|esaf|cesgranrio|funrio|fundatec|ivin|selecon)\b/i);
    if (m) return m[1].toUpperCase().replace(/\s+/g, ' ');
    const first = base.split(/[\s_\-]+/)[0];
    return (first && first.length <= 12) ? first.toUpperCase() : '';
  },
  handleIncidFile(file) {
    if (!file) return;
    const fn = document.getElementById('incid-file-name');
    fn.style.display = 'inline-flex'; fn.textContent = '📎 ' + file.name;
    const prev = document.getElementById('incid-preview');
    // Autopreenche a banca pelo nome do arquivo, se o campo estiver vazio
    const bancaEl = document.getElementById('incid-banca');
    if (!bancaEl.value.trim()) {
      const guess = this._bancaFromFilename(file.name);
      if (guess) bancaEl.value = guess;
    }
    const banca = bancaEl.value.trim() || 'X';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const finish = (rows) => {
      // Guarda como fonte "arquivo" (protegido contra o input da banca) e limpa colagem
      this._incidFileRows = rows;
      this._incidParsed = rows;
      $id('incid-text').value = '';
      if (rows.length === 0) { this._incidFileRows = null; prev.textContent = '⚠ Nenhum tópico reconhecido no arquivo.'; prev.style.color = 'var(--warn)'; }
      else { prev.textContent = `✓ ${rows.length} tópico(s) reconhecido(s) para importar. Confirme a banca e clique em Salvar.`; prev.style.color = 'var(--good)'; }
    };
    // CSV é texto puro: funciona offline sem biblioteca
    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (e) => finish(ReforcoEngine.parseIncidencia(e.target.result, banca));
      reader.readAsText(file);
      return;
    }
    const trySheetJS = async () => {
      prev.textContent = 'Carregando leitor de planilha…'; prev.style.color = 'var(--text-faint)';
      const ok = await ensureSheetJS();
      if (!ok || typeof XLSX === 'undefined') {
        prev.textContent = (ext === 'xls')
          ? '⚠ Formato .xls antigo requer internet. Salve como .xlsx e reenvie.'
          : '⚠ Não consegui ler a planilha. Exporte como .csv ou cole os dados.';
        prev.style.color = 'var(--warn)';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          try { ws['!ref'] = XLSX.utils.encode_range(XLSX.utils.decode_range(ws['!ref'])); } catch (e0) { _quiet(e0); }
          const tsv = XLSX.utils.sheet_to_csv(ws, { FS: '\t', RS: '\n', blankrows: false });
          finish(ReforcoEngine.parseIncidencia(tsv, banca));
        } catch (err) { prev.textContent = '⚠ Erro ao ler o arquivo.'; prev.style.color = 'var(--bad)'; }
      };
      reader.readAsArrayBuffer(file);
    };
    if (ext === 'xls') { trySheetJS(); return; }
    if (ext === 'xlsx') {
      // Leitor embutido como PRIMÁRIO (offline + ignora <dimension> incorreto). SheetJS = fallback.
      prev.textContent = 'Lendo planilha…'; prev.style.color = 'var(--text-faint)';
      MiniXLSX.readFirstSheet(file)
        .then((res) => {
          const rows = ReforcoEngine.parseIncidenciaCells(res.rows, banca);
          if (rows.length === 0) { trySheetJS(); return; }
          finish(rows);
        })
        .catch((err) => { console.error(err); trySheetJS(); });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => finish(ReforcoEngine.parseIncidencia(e.target.result, banca));
    reader.readAsText(file);
  },
  saveIncidencia() {
    const banca = $id('incid-banca').value.trim();
    if (!banca) { showToast('Informe a banca'); return; }
    // Prioridade: linhas do arquivo importado → _incidParsed → reparse do textarea
    let rows = (this._incidFileRows && this._incidFileRows.length) ? this._incidFileRows
             : (this._incidParsed && this._incidParsed.length) ? this._incidParsed
             : ReforcoEngine.parseIncidencia($id('incid-text').value, banca);
    if (!rows || rows.length === 0) { showToast('Nenhum dado de incidência reconhecido'); return; }
    // aplica a banca do campo (o parse pode ter usado placeholder 'X')
    rows.forEach(r => r.banca = banca);
    const replace = $id('incid-replace').checked;
    const n = DB.addIncidenciaRows(banca, rows, replace);
    $id('incid-text').value = '';
    $id('incid-file').value = '';
    $id('incid-file-name').style.display = 'none';
    this._incidParsed = null;
    this._incidFileRows = null;
    $id('incid-preview').textContent = 'Aguardando dados...';
    $id('incid-preview').style.color = 'var(--text-faint)';
    showToast(`${n} tópico(s) de incidência salvos na banca ${banca} ✓`);
    this.renderIncidencia();
  },
  // ---- Reforço ----
  renderReforco() {
    const snap = this.scopedSnapshot() || ReforcoEngine.currentSnapshot();
    const bancaSel = document.getElementById('reforco-banca');
    const bancas = DB.getBancas();
    const cur = bancaSel.value || '__todas__';
    bancaSel.innerHTML = `<option value="__todas__">Todas as bancas</option>` +
      bancas.map(b => `<option value="${escapeHtml(b)}" ${b === cur ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');
    if (!bancaSel.value) bancaSel.value = cur;
    // popula o filtro de DISCIPLINA a partir da incidência da banca selecionada
    const discSel = document.getElementById('reforco-disc');
    if (discSel) {
      const bsel = bancaSel.value;
      const discs = [...new Set(DB.getIncidencia()
        .filter(r => r.depth === 0 && (bsel === '__todas__' || r.banca === bsel))
        .map(r => r.topico))].sort();
      const curD = discSel.value || '__todas__';
      discSel.innerHTML = `<option value="__todas__">📚 Todas as disciplinas</option>` +
        discs.map(d => `<option value="${escapeHtml(d)}" ${d === curD ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
      if (![...discSel.options].some(o => o.value === curD)) discSel.value = '__todas__';
    }
    // sugere limite pela carga horária (só na 1ª vez); depois respeita a preferência salva
    if (!this._reforcoInit) { $id('reforco-limite').value = ReforcoEngine.sugerirLimite(); this._reforcoInit = true; }
    // restaura filtros/seleções salvos (banca, ordenação, sliders, mín. e qtd.)
    this.applyReforcoPrefs();
    this.updateEstratLabel();
    this.updateGranLabel();
    // sincroniza o alternador de visão e a visibilidade dos cards laterais
    const vt = document.getElementById('reforco-view-toggle');
    if (vt) vt.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.view === (this.reforcoView || 'global')));
    const side = document.querySelector('.reforco-side-grid');
    if (side) side.style.display = ((this.reforcoView || 'global') === 'disc') ? 'none' : '';
    this.renderReforcoList();
  },
  updateEstratLabel() {
    const v = parseInt($id('reforco-estrat').value, 10);
    const lbl = document.getElementById('reforco-estrat-label');
    lbl.textContent = v <= 25 ? 'foco no erro' : v >= 75 ? 'foco na incidência' : 'equilíbrio';
  },
  updateGranLabel() {
    const el = document.getElementById('reforco-gran');
    if (!el) return;
    const g = parseInt(el.value, 10) / 100;
    const lbl = document.getElementById('reforco-gran-label');
    if (lbl) lbl.textContent = g < 0.33 ? 'Disciplina' : g > 0.66 ? 'Tópico' : 'Assunto (auto)';
  },
  renderReforcoList() {
    const list = document.getElementById('reforco-list');
    const status = document.getElementById('reforco-status');
    const projEl = document.getElementById('reforco-proj');
    const snap = this.scopedSnapshot() || ReforcoEngine.currentSnapshot();
    if (!snap) {
      list.innerHTML = `<div class="evo-empty-mini">Importe seu desempenho do TEC (aba Importar) para gerar o reforço.</div>`;
      status.textContent = ''; if (projEl) projEl.innerHTML = '';
      $id('reforco-blind-card').style.display = 'none';
      $id('reforco-over-card').style.display = 'none';
      return;
    }
    const gEl = document.getElementById('reforco-gran');
    const ordEl = document.getElementById('reforco-ordenar');
    const ordenarPor = ordEl ? ordEl.value : 'oportunidade';
    const res = ReforcoEngine.suggestFrontier(snap, {
      banca: $id('reforco-banca').value,
      estrategia: parseInt($id('reforco-estrat').value, 10) / 100,
      granularidade: gEl ? parseInt(gEl.value, 10) / 100 : 0.5,
      minQuestoes: parseInt($id('reforco-minq').value, 10) || 10,
      limite: parseInt($id('reforco-limite').value, 10) || 12,
      ordenarPor
    });
    // filtro por DISCIPLINA (pós-processa o resultado, sem mexer no motor)
    const discSel = document.getElementById('reforco-disc');
    const discFiltro = discSel ? discSel.value : '__todas__';
    if (discFiltro && discFiltro !== '__todas__') {
      const nk = ReforcoEngine.norm(discFiltro);
      res.items = res.items.filter(it => ReforcoEngine.norm(it.disciplina) === nk);
      res.porDisciplina = res.porDisciplina.filter(d => ReforcoEngine.norm(d.disciplina) === nk);
      res.blindSpots = (res.blindSpots || []).filter(b => ReforcoEngine.norm(b.disciplina) === nk);
      res.overinvest = (res.overinvest || []).filter(o => ReforcoEngine.norm(o.disciplina) === nk);
    }
    // Rótulo explícito de ordenação (#2 didático)
    const olEl = document.getElementById('reforco-orderlabel');
    if (olEl) {
      const map = {
        oportunidade: ['🎯', 'Ordenado por <b>oportunidade de pontos</b> (erro × incidência × zona de virada) — do que mais rende ao que menos rende.'],
        erro: ['🔴', 'Ordenado por <b>maior erro</b> — do tópico em que você mais erra ao que menos erra.'],
        incidencia: ['🏛️', 'Ordenado por <b>maior incidência</b> — do assunto mais cobrado pela banca ao menos cobrado.']
      };
      const m = map[ordenarPor] || map.oportunidade;
      olEl.innerHTML = `<span class="oi">${m[0]}</span> <span>${m[1]}</span>`;
    }
    // Banner de projeção da média (só quando há incidência cadastrada)
    if (projEl) {
      if (res.hasAnyIncid && res.cobertura > 0) {
        const cls = res.confianca === 'alta' ? 'alta' : res.confianca === 'media' ? 'media' : 'baixa';
        projEl.innerHTML = `<div class="reforco-proj-banner">
          <div class="reforco-proj-item"><span class="pv now">${res.projAtual}%</span><span class="pl">Média projetada (banca)</span></div>
          <span class="reforco-proj-arrow">→</span>
          <div class="reforco-proj-item"><span class="pv pot">${res.projPotencial}%</span><span class="pl">Potencial (dominando o TOP)</span></div>
          <div class="reforco-proj-note">Cobertura de <b>${res.cobertura}%</b> da prova pela sua amostra<span class="reforco-conf ${cls}">confiança ${res.confianca}</span></div>
        </div>`;
      } else projEl.innerHTML = '';
    }
    // status
    const parts = [];
    if (!res.fresh && res.snapDate) parts.push(`<span style="color:var(--warn)">⚠ Retrato mais recente (${formatDateShort(res.snapDate)}) tem mais de 3 meses — reimporte para dados atuais.</span>`);
    if (!res.hasAnyIncid) parts.push('Sem incidência cadastrada — o reforço prioriza só pelo seu erro. Cadastre a incidência da banca (aba Incidência) para priorizar por pontos.');
    else parts.push(`<b>${res.totalErros}</b> unidade(s) no ranking de erros · <b>${res.totalCegos}</b> ponto(s) cego(s) · fronteira com <b>${res.totalUnidades}</b> unidade(s), sem dupla contagem.`);
    status.innerHTML = parts.join(' · ');
    // Renderiza conforme a visão escolhida: global (ranking) ou por disciplina (acordeão)
    if ((this.reforcoView || 'global') === 'disc') {
      this._renderReforcoPorDisciplina(list, res);
    } else {
      this._renderReforcoGlobal(list, res);
    }
    // Na visão "por disciplina" os cards laterais já entram embutidos → escondemos aqui
    const discView = (this.reforcoView || 'global') === 'disc';
    // 🕳️ Pontos cegos (alta incidência, pouca prática) — fora do ranking de erros
    const blindCard = document.getElementById('reforco-blind-card');
    const blindList = document.getElementById('reforco-blind-list');
    if (!discView && res.blindSpots && res.blindSpots.length) {
      blindCard.style.display = 'block';
      const maxB = Math.max(1, ...res.blindSpots.map(b => b.incidencia || 0));
      blindList.innerHTML = res.blindSpots.map(b => `
        <div class="reforco-mini tone-blind">
          <div class="rm-ico">🕳️</div>
          <div class="rm-body">
            <div class="rm-name" title="${escapeHtml(b.nome)}">${escapeHtml(b.nome)}</div>
            <div class="rm-sub">${escapeHtml(b.disciplina)}</div>
            <div class="rm-bar"><span style="width:${Math.round((b.incidencia / maxB) * 100)}%"></span></div>
          </div>
          <div class="rm-val">${b.incidencia}<small>${b.questoes}q feitas</small></div>
        </div>`).join('');
    } else blindCard.style.display = 'none';
    // ⚖️ Sobre-investimento
    const overCard = document.getElementById('reforco-over-card');
    const overList = document.getElementById('reforco-over-list');
    if (!discView && res.overinvest && res.overinvest.length) {
      overCard.style.display = 'block';
      const maxO = Math.max(1, ...res.overinvest.map(o => o.fatiaEsforco || 0));
      overList.innerHTML = res.overinvest.map(o => `
        <div class="reforco-mini tone-over">
          <div class="rm-ico">⚖️</div>
          <div class="rm-body">
            <div class="rm-name" title="${escapeHtml(o.nome)}">${escapeHtml(o.nome)}</div>
            <div class="rm-sub">${escapeHtml(o.disciplina)} · esforço ${o.fatiaEsforco}% vs banca ${o.fatiaBanca}%</div>
            <div class="rm-bar"><span style="width:${Math.round((o.fatiaEsforco / maxO) * 100)}%"></span></div>
          </div>
          <div class="rm-val">${o.fatiaEsforco}%<small>seu tempo</small></div>
        </div>`).join('');
    } else overCard.style.display = 'none';
  },
  // linha de tópico reutilizável (sem botões de ação)
  _reforcoItemHtml(it, rank) {
    const tone = it.pctAcerto >= 70 ? 'good' : it.pctAcerto >= 50 ? 'warn' : 'bad';
    const seloTxt = it.selo === 'fraco' ? '🔥 fraco' : it.selo === 'atencao' ? '⚠️ atenção' : '• ok';
    // #3 — por que este item está nesta posição (fator dominante)
    const motivoMap = {
      erro: ['m-erro', '🔴 subiu pelo erro'],
      incidencia: ['m-incidencia', '🎯 subiu pela incidência'],
      equilibrio: ['m-equilibrio', '⚖️ erro + incidência']
    };
    const mv = motivoMap[it.motivo] || motivoMap.equilibrio;
    const motivoHtml = `<span class="reforco-motivo ${mv[0]}" title="Fator que mais pesou para esta posição no ranking">${mv[1]}</span>`;
    // #4 — "Sem Classificação": marca e esmaece
    const semClassTag = it.semClass ? `<span class="reforco-tag semclass" title="Balde genérico do índice do TEC — pouco acionável para estudo">sem classificação</span>` : '';
    return `
      <div class="reforco-row ${it.semClass ? 'is-semclass' : ''}">
        <div class="reforco-rank">${rank}</div>
        <div class="reforco-main">
          <div class="reforco-topico">${escapeHtml(it.nome)}</div>
          <div class="reforco-meta">
            <span class="reforco-tag selo-${it.selo}">${seloTxt}</span>
            ${motivoHtml}
            <span class="reforco-tag nivel">nível ${it.nivel}</span>
            <span class="reforco-tag tone-${tone}">${it.taxaErro}% erro · ${it.erros}/${it.questoes}</span>
            ${it.temIncid
              ? `<span class="reforco-tag incid">incidência ${it.incidencia}</span><span class="reforco-tag pts">~${it.pontosRecuperaveis} pts recuperáveis</span>`
              : `<span class="reforco-tag semincid">sem incidência</span>`}
            ${semClassTag}
          </div>
        </div>
      </div>`;
  },
  _renderReforcoGlobal(list, res) {
    if (!res.items.length) {
      list.innerHTML = `<div class="evo-empty-mini">Nenhum ponto fraco com amostra suficiente. Diminua o "mínimo de questões", mude a granularidade, ou importe/consolide mais retratos.</div>`;
      return;
    }
    list.innerHTML = res.items.map((it, i) => this._reforcoItemHtml(it, i + 1)).join('');
  },
  _renderReforcoPorDisciplina(list, res) {
    const discs = (res.porDisciplina || []).filter(d => d.itens.length > 0 || d.nFracos > 0 || d.incidencia > 0);
    if (!discs.length) {
      list.innerHTML = `<div class="evo-empty-mini">Nenhuma disciplina com dados suficientes. Ajuste os filtros ou importe mais retratos.</div>`;
      return;
    }
    list.innerHTML = discs.map((d, idx) => {
      const emDia = d.itens.length === 0;
      const pct = (d.pctAcerto != null) ? d.pctAcerto + '%' : '—';
      const itensHtml = d.itens.length
        ? d.itens.map((it, i) => this._reforcoItemHtml(it, i + 1)).join('')
          + (d.nItens > d.itens.length ? `<div class="rfd-emptyline">+ ${d.nItens - d.itens.length} outro(s) ponto(s) fraco(s) nesta disciplina (aumente "Qtd. de tópicos").</div>` : '')
        : `<div class="rfd-emptyline">✓ Sem pontos fracos com amostra suficiente aqui — disciplina em dia.</div>`;
      const cegosHtml = d.cegos && d.cegos.length
        ? `<div>🕳️ <b>Pontos cegos:</b> ${d.cegos.map(c => escapeHtml(c.nome) + ' (N=' + c.incidencia + ', ' + c.questoes + 'q)').join(' · ')}</div>` : '';
      const overHtml = d.over && d.over.length
        ? `<div>⚖️ <b>Sobre-investimento:</b> ${d.over.map(o => escapeHtml(o.nome) + ' (' + o.fatiaEsforco + '% vs banca ' + o.fatiaBanca + '%)').join(' · ')}</div>` : '';
      const extra = (cegosHtml || overHtml) ? `<div class="rfd-extra">${cegosHtml}${overHtml}</div>` : '';
      return `
        <div class="rfd-card ${idx === 0 && !emDia ? 'open' : ''}" data-disc="${escapeHtml(d.disciplina)}">
          <div class="rfd-head">
            <span class="rfd-caret">▶</span>
            <div class="rfd-title">
              <div class="rfd-name">${escapeHtml(d.disciplina)}</div>
              <div class="rfd-sub">
                <span class="chip">🏛️ ${d.incidencia} na banca</span>
                <span class="chip">🎯 ${pct} acerto</span>
                ${emDia ? '<span class="rfd-badge-ok">✓ em dia</span>' : `<span class="chip">🔥 ${d.nFracos} ponto(s) fraco(s)</span>`}
              </div>
            </div>
            <div class="rfd-opp ${emDia ? 'rfd-acc-good' : ''}">
              <div class="v">${emDia ? '—' : '+' + d.pontosRec}</div>
              <div class="l">${emDia ? 'em dia' : 'pts recuperáveis'}</div>
            </div>
          </div>
          <div class="rfd-body">${itensHtml}${extra}</div>
        </div>`;
    }).join('');
    list.querySelectorAll('.rfd-head').forEach(head => {
      head.addEventListener('click', () => head.closest('.rfd-card').classList.toggle('open'));
    });
  },
  reforcoToCard(topico, disciplina) {
    if (!window.CardsScreen) { showToast('Abra a aba Cards uma vez e tente de novo'); return; }
    switchScreen('cards');
    setTimeout(() => {
      CardsScreen.openCardModal(null);
      setTimeout(() => {
        const t = document.getElementById('card-topico'); if (t) t.value = topico;
        // tenta casar a disciplina do card com uma matéria existente
        const dest = document.getElementById('card-destino');
        if (dest) {
          const opt = [...dest.options].find(o => o.textContent.trim().toLowerCase() === (disciplina || '').toLowerCase());
          if (opt) dest.value = opt.value;
        }
        const fr = document.getElementById('card-frente'); if (fr) fr.focus();
      }, 60);
    }, 60);
    showToast('Criando card de reforço de "' + topico + '"');
  },
  reforcoToCiclo(topico, disciplina) {
    // adiciona como uma trilha/tarefa: cria a matéria se não existir e registra no Estudo Novo como aula de reforço
    let subj = DB.getActiveSubjects().find(s => s.nome.toLowerCase() === (disciplina || '').toLowerCase());
    if (!subj && disciplina) subj = DB.addSubject({ nome: disciplina, dificuldade: 3, fase: 'Reforço' });
    const alvo = subj ? subj.nome : (disciplina || topico);
    if (subj) {
      DB.addTrackLesson(alvo, '⚠ Reforço: ' + topico);
      showToast('Reforço adicionado à trilha de "' + alvo + '" (Estudo Novo)');
    } else {
      showToast('Cadastre a disciplina "' + disciplina + '" em Configurações primeiro');
    }
  },
  toneOf(pct) { return pct >= 70 ? 'good' : pct >= 50 ? 'warn' : 'bad'; },
  renderTotais(snap) {
    const tot = TecEngine.totais(snap);
    const prev = this.prevSnap();
    let deltaHtml = '';
    if (prev) {
      const pt = TecEngine.totais(prev);
      const d = Math.round((tot.pct - pt.pct) * 10) / 10;
      const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '=';
      deltaHtml = `<span class="tec-delta ${cls}">${arrow} ${d > 0 ? '+' : ''}${d} p.p.</span>`;
    }
    // cor do aproveitamento pela MESMA regra do resto do app (metas de ⚙ Metas)
    const TOM = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad, #e0393f)' };
    const corPct = tot.questoes === 0 ? 'var(--text-faint)' : (TOM[toneFor(tot.pct)] || 'var(--accent)');
    const erros = Math.max(0, tot.questoes - tot.acertos);
    $id('tec-totais').innerHTML = `
      <div class="tec-total-card hero" style="--tec-cor:${corPct};">
        <div class="tico">🎯</div>
        <div class="val">${tot.pct}%${deltaHtml}</div>
        <div class="lbl">Aproveitamento geral</div>
      </div>
      <div class="tec-total-card" style="--tec-cor: var(--accent);">
        <div class="tico">📝</div>
        <div class="val">${tot.questoes.toLocaleString('pt-BR')}</div>
        <div class="lbl">Questões resolvidas</div>
      </div>
      <div class="tec-total-card" style="--tec-cor: var(--good);">
        <div class="tico">✅</div>
        <div class="val tone-good">${tot.acertos.toLocaleString('pt-BR')}</div>
        <div class="lbl">Acertos${erros ? ' <span class="tec-total-sub">' + erros.toLocaleString('pt-BR') + ' erros</span>' : ''}</div>
      </div>
      <div class="tec-total-card" style="--tec-cor: #7c3aed;">
        <div class="tico">📚</div>
        <div class="val">${tot.disciplinas}</div>
        <div class="lbl">Disciplinas</div>
      </div>
    `;
  },
  weakDisc: '__todas__', // '__todas__' = todas (agrupadas) | nome = só aquela disciplina
  weakRowHtml(f, showDisc) {
    const tone = this.toneOf(f.pctAcerto);
    return `
      <div class="weak-row">
        <div class="weak-info">
          <div class="wname">${escapeHtml(f.nome)}</div>
          ${showDisc ? `<div class="wdisc">${escapeHtml(f.disciplina)}</div>` : ''}
        </div>
        <div class="weak-track"><div class="weak-fill tone-${tone}" style="width:${f.pctAcerto}%;"></div></div>
        <div class="weak-pct tone-${tone}">${f.pctAcerto}%<span class="q">${f.acertos}/${f.questoes}</span></div>
      </div>`;
  },
  renderWeak(snap) {
    const limiar = parseInt($id('tec-weak-threshold').value, 10) || 70;
    const minQ = parseInt($id('tec-weak-minq').value, 10) || 1;
    const leaves = $id('tec-weak-leaves').checked;
    const container = document.getElementById('tec-weak-list');
    const sel = document.getElementById('tec-weak-disc');

    // todos os pontos fracos do retrato (já ordenados do pior para o melhor)
    const todos = TecEngine.pontosFracos(snap, { minQuestoes: minQ, limiar, apenasFolhas: leaves });

    // popula o seletor: disciplinas que possuem ao menos um ponto fraco, ordenadas pela mais fraca
    const discPct = Object.fromEntries(TecEngine.disciplinas(snap).map(d => [d.nome, this.nodePct(d)]));
    const discsComFraco = [...new Set(todos.map(f => f.disciplina))]
      .sort((a, b) => (discPct[a] ?? 100) - (discPct[b] ?? 100));
    if (this.weakDisc !== '__todas__' && !discsComFraco.includes(this.weakDisc)) this.weakDisc = '__todas__';
    sel.innerHTML = `<option value="__todas__">Todas as disciplinas (agrupado)</option>` +
      discsComFraco.map(n => {
        const c = todos.filter(f => f.disciplina === n).length;
        return `<option value="${escapeHtml(n)}" ${n === this.weakDisc ? 'selected' : ''}>${escapeHtml(n)} — ${c} ponto(s) fraco(s)</option>`;
      }).join('');

    if (todos.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:24px;"><div class="big">🎉</div>Nenhum tópico abaixo de ${limiar}% com ao menos ${minQ} questão(ões). Mandou bem!</div>`;
      return;
    }

    // FILTRO: uma disciplina específica → lista plana, só dela
    if (this.weakDisc !== '__todas__') {
      const lista = todos.filter(f => f.disciplina === this.weakDisc);
      container.innerHTML = lista.map(f => this.weakRowHtml(f, false)).join('');
      return;
    }

    // AGRUPADO: todas as disciplinas, cada uma como um grupo (mais fraca no topo),
    // e dentro dela os tópicos do pior para o melhor
    const grupos = {};
    todos.forEach(f => { (grupos[f.disciplina] = grupos[f.disciplina] || []).push(f); });
    const ordemDisc = Object.keys(grupos).sort((a, b) => (discPct[a] ?? 100) - (discPct[b] ?? 100));
    container.innerHTML = ordemDisc.map(disc => {
      const itens = grupos[disc].sort((a, b) => a.pctAcerto - b.pctAcerto || b.questoes - a.questoes);
      const dp = discPct[disc];
      const tone = dp !== undefined ? this.toneOf(dp) : 'bad';
      return `
        <div class="weak-group">
          <div class="weak-group-head">
            <span class="weak-group-name">${escapeHtml(disc)}</span>
            <span class="weak-group-meta">
              ${dp !== undefined ? `<span class="weak-group-pct tone-${tone}">${dp}%</span>` : ''}
              <span class="weak-group-count">${itens.length} ponto(s) fraco(s)</span>
            </span>
          </div>
          ${itens.map(f => this.weakRowHtml(f, false)).join('')}
        </div>`;
    }).join('');
  },
  // Usa o % reportado pelo TecConcursos (fiel ao que o usuário vê no TEC);
  // só recalcula por acertos/questões quando o TEC não informou o percentual.
  nodePct(n) {
    if (n.pctAcerto !== null && n.pctAcerto !== undefined) return n.pctAcerto;
    return n.questoes > 0 ? Math.round((n.acertos / n.questoes) * 1000) / 10 : 0;
  },
  // Índice pct do retrato anterior por chave disciplina|codigo, para mostrar a evolução em cada nó
  prevPctIndex() {
    const prev = this.prevSnap();
    if (!prev) return null;
    const idx = {};
    prev.rows.forEach(r => { idx[(r.disciplina || '') + '|' + (r.codigo || '')] = this.nodePct(r); });
    return idx;
  },
  deltaHtml(node, prevIdx) {
    if (!prevIdx) return '';
    const key = (node.disciplina || '') + '|' + (node.codigo || '');
    if (prevIdx[key] === undefined) return '';
    const diff = Math.round((this.nodePct(node) - prevIdx[key]) * 10) / 10;
    if (diff === 0) return `<span class="tec-delta flat">=</span>`;
    const cls = diff > 0 ? 'up' : 'down';
    const arrow = diff > 0 ? '▲' : '▼';
    return `<span class="tec-delta ${cls}">${arrow} ${diff > 0 ? '+' : ''}${diff}</span>`;
  },
  /* ── ÁRVORE SOB DEMANDA ────────────────────────────────────────────────────
     Antes, a árvore inteira do caderno virava HTML de uma vez — milhares de nós
     em disciplina → assunto → tópico → subtópico, todos montados mesmo estando
     recolhidos e invisíveis. Em cadernos grandes isso travava a tela por
     segundos a cada render.
     Agora cada nó nasce com um marcador vazio no lugar dos filhos e só se
     materializa quando você o abre. Nada muda no que você vê: o conteúdo é o
     mesmo, e "Expandir tudo" materializa a árvore completa antes de abrir. */
  _lazyReg: new Map(),   // id do marcador → { node, level }  (só o que ainda não nasceu)
  _lazySeq: 0,
  // Renderiza UM nó; os filhos ficam como promessa até serem abertos
  treeNodeHtml(node, prevIdx, level) {
    const pct = this.nodePct(node);
    const tone = this.toneOf(pct);
    const hasKids = node.children && node.children.length > 0;
    const indent = 10 + level * 18;
    const delta = this.deltaHtml(node, prevIdx);
    const nameCls = level === 0 ? 'tnode-name lvl0' : 'tnode-name';
    const caret = hasKids ? `<span class="tnode-caret">▶</span>` : `<span class="tnode-dot"></span>`;
    let kidsHtml = '';
    if (hasKids) {
      const lid = 'tl' + (++this._lazySeq);
      this._lazyReg.set(lid, { node, level, prevIdx });
      kidsHtml = `<div class="tnode-children" data-lazy="${lid}"></div>`;
    }
    return `
      <div class="tnode ${level === 0 ? 'lvl0' : ''}" data-haskids="${hasKids ? '1' : '0'}">
        <div class="tnode-row ${hasKids ? 'has-kids' : ''}" style="padding-left:${indent}px;">
          ${caret}
          <span class="${nameCls}" title="${escapeHtml(node.nome)}">${escapeHtml(node.nome)}${delta}</span>
          <div class="tnode-track"><div class="tnode-fill tone-${tone}" style="width:${pct}%;"></div></div>
          <span class="tnode-pct tone-${tone}">${pct}%<span class="q">${node.acertos}/${node.questoes}</span></span>
        </div>
        ${kidsHtml}
      </div>`;
  },
  // Materializa os filhos de UM contêiner marcado. Idempotente: se já nasceu, sai.
  _hydrate(box) {
    if (!box) return false;
    const lid = box.getAttribute('data-lazy');
    if (!lid) return false;
    const reg = this._lazyReg.get(lid);
    box.removeAttribute('data-lazy');
    this._lazyReg.delete(lid);
    if (!reg) return false;
    // ordena os filhos SEMPRE do mais fraco para o mais forte (em cada nível e subnível),
    // para que os pontos fracos fiquem no topo em qualquer profundidade
    const kids = reg.node.children.slice()
      .sort((a, b) => this.nodePct(a) - this.nodePct(b) || b.questoes - a.questoes);
    box.innerHTML = kids.map(c => this.treeNodeHtml(c, reg.prevIdx, reg.level + 1)).join('');
    return true;
  },
  // Materializa tudo o que ainda falta dentro de um contêiner (usado por "Expandir tudo"
  // e antes de qualquer operação que precise enxergar a árvore inteira).
  _hydrateAll(root) {
    // POR NÍVEL, não um a um: procurar o próximo marcador varrendo a árvore inteira
    // a cada nó custaria O(n²) — em cadernos grandes, segundos de tela travada.
    // Aqui cada rodada resolve todos os marcadores existentes de uma vez, e a
    // rodada seguinte cuida do nível que acabou de nascer.
    let pend = root.querySelectorAll('.tnode-children[data-lazy]');
    let nivel = 0;
    while (pend.length && nivel++ < 64) {
      pend.forEach(b => this._hydrate(b));
      pend = root.querySelectorAll('.tnode-children[data-lazy]');
    }
  },
  discFilter: '__todas__', // '__todas__' = todas as disciplinas | nome = focar numa
  renderDisciplinas(snap) {
    const container = document.getElementById('tec-disc-list');
    const focusEl = document.getElementById('tec-disc-focus');
    const filterSel = document.getElementById('tec-disc-filter');
    // árvore completa, ordenada do pior para o melhor aproveitamento
    // (desempate: quem tem mais questões aparece antes)
    let forest = TecEngine.buildTree(snap).sort((a, b) => this.nodePct(a) - this.nodePct(b) || b.questoes - a.questoes);
    const prevIdx = this.prevPctIndex();
    if (forest.length === 0) {
      focusEl.innerHTML = '';
      container.innerHTML = `<p class="wd-empty" style="padding:12px 0;">Sem dados neste retrato.</p>`;
      filterSel.innerHTML = `<option>—</option>`;
      return;
    }
    // popula o seletor (ordem alfabética, mais natural para procurar)
    const alpha = forest.slice().sort((a, b) => a.nome.localeCompare(b.nome));
    // se a disciplina filtrada não existe neste retrato, volta para "todas"
    if (this.discFilter !== '__todas__' && !forest.find(d => d.nome === this.discFilter)) {
      this.discFilter = '__todas__';
    }
    filterSel.innerHTML = `<option value="__todas__">Todas as disciplinas (${forest.length})</option>` +
      alpha.map(d => `<option value="${escapeHtml(d.nome)}" ${d.nome === this.discFilter ? 'selected' : ''}>${escapeHtml(d.nome)} — ${this.nodePct(d)}%</option>`).join('');

    const focused = this.discFilter !== '__todas__';
    const shown = focused ? forest.filter(d => d.nome === this.discFilter) : forest;

    // resumo em destaque quando uma disciplina está em foco
    if (focused && shown.length) {
      const d = shown[0];
      const pct = this.nodePct(d);
      const tone = this.toneOf(pct);
      // conta tópicos-folha fracos dentro da disciplina
      const leafWeak = TecEngine.pontosFracos({ rows: snap.rows }, { minQuestoes: 1, limiar: 70, apenasFolhas: true })
        .filter(t => t.disciplina === d.nome).length;
      focusEl.innerHTML = `
        <div class="tec-focus-card">
          <div class="tec-focus-main">
            <div class="tec-focus-name">${escapeHtml(d.nome)}${this.deltaHtml(d, prevIdx)}</div>
            <div class="tec-focus-track"><div class="tec-focus-fill tone-${tone}" style="width:${pct}%;"></div></div>
          </div>
          <div class="tec-focus-stats">
            <div class="tfs"><span class="tfs-val tone-${tone}">${pct}%</span><span class="tfs-lbl">aproveitamento</span></div>
            <div class="tfs"><span class="tfs-val">${d.questoes}</span><span class="tfs-lbl">questões</span></div>
            <div class="tfs"><span class="tfs-val" style="color:var(--good)">${d.acertos}</span><span class="tfs-lbl">acertos</span></div>
            <div class="tfs"><span class="tfs-val ${leafWeak ? '' : ''}" style="color:${leafWeak ? 'var(--bad)' : 'var(--good)'}">${leafWeak}</span><span class="tfs-lbl">tópicos < 70%</span></div>
          </div>
        </div>`;
    } else {
      focusEl.innerHTML = '';
    }

    const toolbar = `
      <div class="tec-tree-toolbar">
        <span class="tec-tree-hint">${focused ? 'Detalhamento por tópico · ' : 'Clique para abrir/fechar cada nível · '}</span>
        <button type="button" class="tec-tree-btn" id="tec-expand-all">⊞ Expandir tudo</button>
        <button type="button" class="tec-tree-btn" id="tec-collapse-all">⊟ Recolher tudo</button>
      </div>`;
    // ao focar numa disciplina, já abre o primeiro nível para leitura imediata
    this._lazyReg.clear();   // render novo: descarta promessas do render anterior
    container.innerHTML = toolbar + `<div class="tec-tree">${shown.map(d => this.treeNodeHtml(d, prevIdx, 0)).join('')}</div>`;
    // ao focar numa disciplina o primeiro nível já abre — então precisa nascer agora
    if (focused) container.querySelectorAll('.tnode.lvl0[data-haskids="1"]').forEach(n => {
      n.classList.add('open');
      this._hydrate(n.querySelector(':scope > .tnode-children'));
    });

    // Toggle por DELEGAÇÃO: um único listener no contêiner, em vez de um por linha.
    // Necessário porque as linhas passam a ser criadas depois (sob demanda) — e de
    // quebra elimina milhares de listeners que antes eram registrados de uma vez.
    container.addEventListener('click', (e) => {
      const row = e.target.closest('.tnode-row.has-kids');
      if (!row || !container.contains(row)) return;
      e.stopPropagation();
      const nodeEl = row.closest('.tnode');
      const box = nodeEl.querySelector(':scope > .tnode-children');
      if (!nodeEl.classList.contains('open')) this._hydrate(box);  // abrindo: materializa
      nodeEl.classList.toggle('open');
    });
    const setAll = (open) => {
      if (open) this._hydrateAll(container);   // só ao expandir é que vale pagar a árvore toda
      container.querySelectorAll('.tnode[data-haskids="1"]').forEach(n => n.classList.toggle('open', open));
    };
    container.querySelector('#tec-expand-all').addEventListener('click', () => setAll(true));
    container.querySelector('#tec-collapse-all').addEventListener('click', () => setAll(false));
  }
};

// Listeners da tela Desempenho TEC
$id('tec-btn-first-import').addEventListener('click', () => DesempenhoTecScreen.openImport());
$id('tec-btn-new-import').addEventListener('click', () => DesempenhoTecScreen.openImport());
$id('tec-toggle-cfg').addEventListener('click', () => {
  const p = DesempenhoTecScreen._loadPrefs();
  DesempenhoTecScreen.savePrefs({ hideCfg: !p.hideCfg });
  DesempenhoTecScreen.applyCfgHidden();
});
$id('tec-enxuto-btn').addEventListener('click', () => {
  const p = DesempenhoTecScreen._loadPrefs();
  DesempenhoTecScreen.savePrefs({ enxuto: !p.enxuto });
  DesempenhoTecScreen.applyEnxuto();
});
$id('tec-import-cancel').addEventListener('click', () => DesempenhoTecScreen.render());
$id('tec-import-save').addEventListener('click', () => DesempenhoTecScreen.saveImport());
$id('tec-import-text').addEventListener('input', () => DesempenhoTecScreen.updateImportPreview());
// validação do intervalo de datas (sem sobreposição)
$id('tec-import-start').addEventListener('change', () => DesempenhoTecScreen.validateRange());
$id('tec-import-end').addEventListener('change', () => DesempenhoTecScreen.validateRange());
// filtro por disciplina na árvore
$id('tec-disc-filter').addEventListener('change', (e) => {
  DesempenhoTecScreen.discFilter = e.target.value;
  const snap = DesempenhoTecScreen.scopedSnapshot();
  if (snap) DesempenhoTecScreen.renderDisciplinas(snap);
});
// upload de arquivo (clique + arrastar-e-soltar)
(function () {
  const dz = document.getElementById('tec-dropzone');
  const fi = document.getElementById('tec-file-input');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', (e) => { if (e.target.files[0]) DesempenhoTecScreen.handleFile(e.target.files[0]); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('dragover');
    if (e.dataTransfer.files[0]) DesempenhoTecScreen.handleFile(e.dataTransfer.files[0]);
  });
})();
// --- Escopo da análise: consolidado / selecionar / intervalo ---
/* Filtros de escopo recolhidos por padrao: o normal e querer ver o RESULTADO
   da analise, nao os controles. O resumo no cabecalho evita que recolher vire
   esconder — o escopo ativo continua legivel sem abrir. */
PainelRecolhivel.registrar({
  id: 'tec-escopo',
  corpo: 'tec-scope-body',
  botao: 'tec-scope-collapse',
  texto: 'tec-scope-collapse-txt',
  resumo: 'tec-scope-resumo',
  calcResumo() {
    const m = DesempenhoTecScreen.scopeMode;
    if (m === 'select') {
      const set = DesempenhoTecScreen.selectedSnapIds;
      const n = set ? set.size : 0;
      return n ? `${n} retrato(s) selecionado(s)` : 'Retratos selecionados';
    }
    if (m === 'range') {
      const a = DesempenhoTecScreen.rangeStart, b = DesempenhoTecScreen.rangeEnd;
      return (a && b) ? `${formatDateShort(a)} → ${formatDateShort(b)}` : 'Intervalo de datas';
    }
    return 'Consolidado (todos)';
  },
});

$id('tec-scope-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-scope]');
  if (!btn) return;
  DesempenhoTecScreen.scopeMode = btn.dataset.scope;
  DesempenhoTecScreen.savePrefs({ scopeMode: btn.dataset.scope });
  DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
  DesempenhoTecScreen.renderAnalysis();
  // reaplica a aba ativa (reforço também depende do escopo)
  if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();
});
// intervalo de datas: inputs manuais
['tec-range-start', 'tec-range-end'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    DesempenhoTecScreen.rangeStart = $id('tec-range-start').value || DesempenhoTecScreen.rangeStart;
    DesempenhoTecScreen.rangeEnd = $id('tec-range-end').value || DesempenhoTecScreen.rangeEnd;
    if (DesempenhoTecScreen.rangeStart > DesempenhoTecScreen.rangeEnd) {
      // corrige intervalo invertido
      const t = DesempenhoTecScreen.rangeStart; DesempenhoTecScreen.rangeStart = DesempenhoTecScreen.rangeEnd; DesempenhoTecScreen.rangeEnd = t;
    }
    DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
    DesempenhoTecScreen.renderAnalysis();
    if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();
  });
});
// atalhos de intervalo (últimos N meses / tudo)
document.querySelectorAll('.tec-range-quick').forEach(btn => btn.addEventListener('click', () => {
  const snaps = DB.getTecSnapshots();
  if (snaps.length === 0) return;
  const r = btn.dataset.range;
  if (r === 'all') {
    DesempenhoTecScreen.rangeStart = snaps[0].startDate;
    DesempenhoTecScreen.rangeEnd = snaps[snaps.length - 1].endDate;
  } else {
    const months = parseInt(r, 10);
    const end = snaps[snaps.length - 1].endDate;
    const d = new Date(end + 'T00:00:00');
    d.setMonth(d.getMonth() - months);
    DesempenhoTecScreen.rangeStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    DesempenhoTecScreen.rangeEnd = end;
  }
  DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
  DesempenhoTecScreen.renderAnalysis();
  if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();
}));
['tec-weak-threshold', 'tec-weak-minq', 'tec-weak-leaves'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const snap = DesempenhoTecScreen.scopedSnapshot();
    if (snap) DesempenhoTecScreen.renderWeak(snap);
  });
});
$id('tec-weak-disc').addEventListener('change', (e) => {
  DesempenhoTecScreen.weakDisc = e.target.value;
  const snap = DesempenhoTecScreen.scopedSnapshot();
  if (snap) DesempenhoTecScreen.renderWeak(snap);
});
// --- Listeners das abas Incidência / Reforço ---
(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  const DT = DesempenhoTecScreen;
  document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(b => b.addEventListener('click', () => DT.switchTecTab(b.dataset.tectab)));
  // Incidência
  on('incid-text', 'input', () => DT.updateIncidPreview());
  on('incid-banca', 'input', () => DT.updateIncidPreview());
  on('incid-save', 'click', () => DT.saveIncidencia());
  const idz = document.getElementById('incid-dropzone');
  if (idz) {
    idz.addEventListener('click', () => $id('incid-file').click());
    idz.addEventListener('dragover', (e) => { e.preventDefault(); idz.classList.add('dragover'); });
    idz.addEventListener('dragleave', () => idz.classList.remove('dragover'));
    idz.addEventListener('drop', (e) => { e.preventDefault(); idz.classList.remove('dragover'); if (e.dataTransfer.files[0]) DT.handleIncidFile(e.dataTransfer.files[0]); });
  }
  on('incid-file', 'change', (e) => { if (e.target.files[0]) DT.handleIncidFile(e.target.files[0]); });
  // Reforço (todos salvam a preferência para lembrar entre sessões)
  on('reforco-banca', 'change', (e) => { DT.savePrefs({ banca: e.target.value }); DT.renderReforco(); });
  // Plano de pontos fracos
  ['plano-disc','plano-meta','plano-ritmo','plano-teto','plano-ponderacao','plano-minamostra',
   'plano-customodo','plano-custofixo','plano-custofator','plano-limite','plano-folhas','plano-pequenas',
   'plano-amostraalvo','plano-cadencia','plano-janelamax','plano-ordenar','plano-banca','plano-consolidar','plano-validade','plano-critico','plano-fragil','plano-piso','plano-sens'].forEach(id => {
    on(id, 'change', () => DT.renderPlanoConteudo());
    on(id, 'input', () => DT.renderPlanoConteudo());
  });
  /* Ajustes do Plano recolhidos por padrao. O resumo traz os tres que mudam a
     leitura da lista: a disciplina, a ordenacao e a meta de dominio. */
  PainelRecolhivel.registrar({
    id: 'plano-filtros',
    corpo: 'plano-filtros-body',
    botao: 'plano-filtros-collapse',
    texto: 'plano-filtros-collapse-txt',
    resumo: 'plano-filtros-resumo',
    rotuloAberto: 'Ocultar ajustes',
    rotuloFechado: 'Mostrar ajustes',
    calcResumo() {
      const sel = (id) => { const e = document.getElementById(id); return e && e.options && e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : ''; };
      const num = (id) => { const e = document.getElementById(id); return e && e.value ? e.value : ''; };
      const disc = sel('plano-disc') || 'Todas';
      // a ordenacao vem com emoji no rotulo; aqui so o texto interessa
      const ord = (sel('plano-ordenar') || '').replace(/^[^\p{L}]+/u, '').split(' — ')[0];
      const meta = num('plano-meta');
      return [disc, ord, meta ? 'meta ' + meta + '%' : ''].filter(Boolean).join(' · ');
    },
  });

  on('plano-reset', 'click', async () => {
    if (!await UI.confirm('Voltar todos os ajustes do Plano aos valores padrão?', { title: 'Restaurar padrões' })) return;
    try { localStorage.removeItem(DB._profilePrefix() + PlanoEngine.KEY_PREF); } catch (_) { _quiet(_); }
    PlanoEngine._c = null;
    DT.renderPlano();
    showToast('Ajustes restaurados ✓');
  });
  on('plano-adv-btn', 'click', () => {
    const box = document.getElementById('plano-advanced');
    const btn = document.getElementById('plano-adv-btn');
    if (!box || !btn) return;
    const aberto = !box.hasAttribute('hidden');
    if (aberto) box.setAttribute('hidden', ''); else box.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', aberto ? 'false' : 'true');
    const ch = btn.querySelector('.chev'); if (ch) ch.textContent = aberto ? '▸' : '▾';
  });
  on('reforco-disc', 'change', (e) => { DT.savePrefs({ disc: e.target.value }); DT.renderReforcoList(); });
  on('reforco-minq', 'input', (e) => { DT.savePrefs({ minq: e.target.value }); DT.renderReforcoList(); });
  on('reforco-limite', 'input', (e) => { DT.savePrefs({ limite: e.target.value }); DT.renderReforcoList(); });
  on('reforco-estrat', 'input', (e) => { DT.savePrefs({ estrat: e.target.value }); DT.updateEstratLabel(); DT.renderReforcoList(); });
  on('reforco-gran', 'input', (e) => { DT.savePrefs({ gran: e.target.value }); DT.updateGranLabel(); DT.renderReforcoList(); });
  on('reforco-ordenar', 'change', (e) => { DT.savePrefs({ ordenar: e.target.value }); DT.renderReforcoList(); }); // #1 Ordenar por
  // alternador de visão: ranking global x por disciplina
  const vt = document.getElementById('reforco-view-toggle');
  if (vt) vt.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    DT.reforcoView = btn.dataset.view;
    DT.savePrefs({ reforcoView: btn.dataset.view });
    vt.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    // no modo "por disciplina", os cards laterais viram redundantes (já entram em cada disciplina)
    const side = document.querySelector('.reforco-side-grid');
    if (side) side.style.display = (DT.reforcoView === 'disc') ? 'none' : '';
    DT.renderReforcoList();
  });
  // painel de ajustes avançados (recolhível)
  const advBtn = document.getElementById('reforco-adv-btn');
  const advPanel = document.getElementById('reforco-advanced');
  if (advBtn && advPanel) advBtn.addEventListener('click', () => {
    const open = advPanel.hasAttribute('hidden');
    if (open) advPanel.removeAttribute('hidden'); else advPanel.setAttribute('hidden', '');
    advBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'desempenhotec') DesempenhoTecScreen.render();
});
