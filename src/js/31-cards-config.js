const CardsConfig = {
  // Chaves NAMESPACED pelo perfil ativo: acompanham o perfil e entram no backup/sync.
  // (As chaves globais antigas são migradas na primeira leitura.)
  LEGACY_KEY: 'diario-estudos:cards-cfg',
  LEGACY_PKEY: 'diario-estudos:cards-presets',
  LEGACY_DKEY: 'diario-estudos:cards-daily',
  _pfx() { try { return DB._profilePrefix(); } catch (_) { return 'diario-estudos:'; } },
  get KEY() { return this._pfx() + 'cards-cfg'; },
  get PKEY() { return this._pfx() + 'cards-presets'; },
  get DKEY() { return this._pfx() + 'cards-daily'; },
  DEFAULTS: {
    algo: 'fsrs', retention: 0.9, learnSteps: [1, 10], relearnSteps: [10], weights: null,
    loadBalance: true, lastOptim: null, newPerDay: 20, revPerDay: 200,
    maxInterval: 36500, leechThreshold: 8, leechAction: 'tag', rolloverHour: 4,
    /* Ordem em que as revisões vencidas são apresentadas. O padrão segue a
       direção que o Anki sinalizou adotar: menor retrievability primeiro, ou
       seja, revisar antes o que está mais perto de ser esquecido. Com fila em
       dia a diferença é pequena; com acúmulo, é o que mais preserva memória.
       Alternativas: 'vencimento' (mais atrasado antes) e 'aleatoria'. */
    /* ── ORDENAÇÃO E MISTURA (espelha deck_config.proto do Anki) ─────────────
       Os nomes seguem os oficiais para a equivalência ser rastreável.
       Só ficaram de fora as variantes que dependem de NOTAS/IRMÃOS e de
       TEMPLATES, que não existem neste app (cada card é independente). */

    // ReviewCardOrder — em que ordem as revisões vencidas são apresentadas.
    // Padrão 'retrievabilityAsc': o mais perto de ser esquecido vem primeiro.
    // O Anki sinalizou que essa deve virar a escolha padrão com acúmulo.
    reviewOrder: 'retrievabilityAsc',

    // NewCardGatherPriority — de onde os novos são COLETADOS antes do limite.
    // 'posicao' = ordem de inserção (equivale a LOWEST_POSITION do Anki).
    newGatherOrder: 'posicao',

    // NewCardSortOrder — como o lote coletado é ORDENADO antes de exibir.
    // 'coleta' preserva a ordem de coleta (NO_SORT); 'aleatoria' = RANDOM_CARD.
    newSortOrder: 'coleta',

    // NewCardInsertOrder — posição atribuída ao card ao ser CRIADO.
    newInsertOrder: 'sequencial',

    // ReviewMix — onde os novos entram em relação às revisões.
    newMix: 'misturar',

    // ReviewMix (interday) — cards de aprendizado que passaram da virada.
    interdayMix: 'misturar',

    // new_per_day_minimum — piso de novos por dia mesmo com revisões estouradas.
    newPerDayMinimum: 0,

    // easy_days_percentages — % da carga de revisão aceita por dia da semana
    // (índice 0 = domingo). O balanceador evita marcar em dias "leves".
    easyDays: [1, 1, 1, 1, 1, 1, 1],

    // ignore_revlogs_before_date — corta o histórico usado pelo otimizador.
    ignoreRevlogsBefore: '',

    /* param_search — QUAIS cards entram no treino dos parâmetros.
       No Anki isto é a linguagem de busca completa ("deck:X -is:suspended").
       Aqui usamos o vocabulário do próprio app (materia:, topico:, tipo:,
       baralho:, favorito, suspenso, leech, texto livre), que cobre a mesma
       necessidade sem arrastar um interpretador de buscas inteiro. */
    paramSearch: '',

    // historical_retention — retenção presumida ao converter cards antigos.
    historicalRetention: 0.9,

    /* ── PARÂMETROS DO SM-2 ────────────────────────────────────────────────
       Eu havia classificado estes como "não se aplicam" por o app usar FSRS.
       Errado: existe o modo Clássico (algo: 'sm2') e ele estava com os valores
       CRAVADOS no código. Agora são configuráveis, com os mesmos padrões do
       Anki e os mesmos nomes do deck_config.proto. */
    initialEase: 2.5,          // initial_ease
    hardMultiplier: 1.2,       // hard_multiplier
    easyMultiplier: 1.3,       // easy_multiplier
    lapseMultiplier: 0.0,      // lapse_multiplier — 0 zera o intervalo no lapso
    intervalMultiplier: 1.0,   // interval_multiplier — escala global
    minimumLapseInterval: 1,   // minimum_lapse_interval
    graduatingIntervalGood: 1, // graduating_interval_good
    graduatingIntervalEasy: 4  // graduating_interval_easy
  },
  _c: null, _cKey: null,
  _notify() { try { if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange(); } catch (_) { _quiet(_); } },
  _read(key, legacyKey) {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(key)); } catch (_) { _quiet(_); }
    if (v == null && legacyKey) {
      try {
        const lv = JSON.parse(localStorage.getItem(legacyKey));
        if (lv != null) { v = lv; localStorage.setItem(key, JSON.stringify(lv)); } // migra para o perfil
      } catch (_) { _quiet(_); }
    }
    return v;
  },
  get() {
    const k = this.KEY;
    if (this._c && this._cKey === k) return this._c;   // cache inválido ao trocar de perfil
    const v = this._read(k, this.LEGACY_KEY);
    this._c = Object.assign({}, this.DEFAULTS, v || {});
    this._cKey = k;
    if (!Array.isArray(this._c.learnSteps) || !this._c.learnSteps.length) this._c.learnSteps = this.DEFAULTS.learnSteps.slice();
    if (!Array.isArray(this._c.relearnSteps) || !this._c.relearnSteps.length) this._c.relearnSteps = this.DEFAULTS.relearnSteps.slice();
    return this._c;
  },
  set(patch) {
    const v = Object.assign(this.get(), patch || {}); this._c = v; this._cKey = this.KEY;
    try { localStorage.setItem(this.KEY, JSON.stringify(v)); } catch (_) { _quiet(_); }
    this._notify();
  },
  // ---- Presets POR BARALHO (como o Anki): overrides que herdam do global ----
  _presets: null, _pKey: null,
  _getPresets() {
    const k = this.PKEY;
    if (this._presets && this._pKey === k) return this._presets;
    this._presets = this._read(k, this.LEGACY_PKEY) || {}; this._pKey = k;
    return this._presets;
  },
  _savePresets() { try { localStorage.setItem(this.PKEY, JSON.stringify(this._presets || {})); } catch (_) { _quiet(_); } this._notify(); },
  hasDeckPreset(deckId) { return !!(deckId && this._getPresets()[deckId]); },
  deckPreset(deckId) { return (deckId && this._getPresets()[deckId]) || null; },
  setDeckPreset(deckId, patch) { if (!deckId) return; const p = this._getPresets(); p[deckId] = Object.assign(p[deckId] || {}, patch || {}); this._savePresets(); },
  clearDeckPreset(deckId) { const p = this._getPresets(); delete p[deckId]; this._savePresets(); },
  // Config EFETIVA de um card: global + override do baralho (se houver)
  forDeck(deckId) {
    const base = this.get();
    const ov = this.deckPreset(deckId);
    if (!ov) return base;
    const merged = Object.assign({}, base, ov);
    if (!Array.isArray(merged.learnSteps) || !merged.learnSteps.length) merged.learnSteps = base.learnSteps;
    if (!Array.isArray(merged.relearnSteps) || !merged.relearnSteps.length) merged.relearnSteps = base.relearnSteps;
    return merged;
  },
  // Pesos salvos de antes (19 posições, FSRS-5) são migrados para 21 na leitura.
  // Não reescrevemos o que está gravado: se você voltar para uma versão anterior
  // do app, seus pesos originais continuam lá, intactos.
  weightsFor(deckId) { const c = this.forDeck(deckId); return FSRS.migrarW(c.weights) || FSRS.DEFAULT_W; },
  // pesos ativos globais (compatibilidade)
  weights() { return FSRS.migrarW(this.get().weights) || FSRS.DEFAULT_W; },
  // ---- Contadores diários (novos/revisões introduzidos hoje) — resetam a cada dia ----
  _daily() {
    let d = this._read(this.DKEY, this.LEGACY_DKEY);
    if (!d || d.date !== todayCards()) d = { date: todayCards(), newIds: [], revIds: [] };
    /* MIGRACAO do formato antigo ({newDone: 7}) para o novo (lista de IDs).
       Sem isto, quem atualizasse o app no meio do dia via o contador voltar a
       zero e ganhava um lote extra de cards novos. Os IDs reais nao existem
       mais, entao preenchemos com marcadores so para PRESERVAR A CONTAGEM —
       eles nunca colidem com um id de card real e somem na virada do dia. */
    if (!Array.isArray(d.newIds)) {
      const n = Number(d.newDone) || 0;
      d.newIds = Array.from({ length: n }, (_, i) => '__legado_new_' + i);
    }
    if (!Array.isArray(d.revIds)) {
      const n = Number(d.revDone) || 0;
      d.revIds = Array.from({ length: n }, (_, i) => '__legado_rev_' + i);
    }
    return d;
  },
  _saveDaily(d) { try { localStorage.setItem(this.DKEY, JSON.stringify(d)); } catch (_) { _quiet(_); } this._notify(); },
  newDoneToday() { return this._daily().newIds.length; }, revDoneToday() { return this._daily().revIds.length; },
  markIntroduced(kind, id) { const d = this._daily(); const a = kind === 'new' ? d.newIds : d.revIds; if (id && !a.includes(id)) a.push(id); this._saveDaily(d); },
  unmarkIntroduced(kind, id) { const d = this._daily(); const k = kind === 'new' ? 'newIds' : 'revIds'; d[k] = id ? d[k].filter(x => x !== id) : d[k]; this._saveDaily(d); },
  // Tira um card dos contadores do dia (usado ao excluir o card)
  forgetCardId(id) {
    const d = this._daily();
    const antes = d.newIds.length + d.revIds.length;
    d.newIds = d.newIds.filter(x => x !== id);
    d.revIds = d.revIds.filter(x => x !== id);
    if (antes !== d.newIds.length + d.revIds.length) this._saveDaily(d);
  },
  // Remove do contador os IDs que não correspondem a card nenhum. Marcadores de
  // migração (__legado_*) são preservados: eles existem justamente para manter a
  // contagem de quem atualizou o app no meio do dia.
  limparContadorOrfao(ids) {
    const d = this._daily();
    const vale = (x) => ids.has(x) || String(x).startsWith('__legado_');
    const antes = d.newIds.length + d.revIds.length;
    d.newIds = d.newIds.filter(vale);
    d.revIds = d.revIds.filter(vale);
    const n = antes - (d.newIds.length + d.revIds.length);
    if (n) this._saveDaily(d);
    return n;
  },
  newRemaining() { return Math.max(0, (this.get().newPerDay || 0) - this.newDoneToday()); },
  revRemaining() { return Math.max(0, (this.get().revPerDay || 0) - this.revDoneToday()); }
};
