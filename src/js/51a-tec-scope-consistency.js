/* ============================================================
   DESEMPENHO TEC — consistência do escopo no Plano
   ============================================================
   A aba Análise já trabalha com activeSnapshots(), mas alguns cálculos do Plano
   vivem fora de PlanoEngine.calcular(): o quadro "Onde atacar primeiro" e o
   ritmo medido são os principais. Escopar DB.getTecSnapshots() durante a tela
   inteira seria amplo demais — auditoria e progresso das atividades precisam
   continuar enxergando o histórico integral.

   Portanto esta camada protege SOMENTE as fronteiras analíticas do Plano:
   cálculo central, ranking de matérias e ritmo exibido. O restante do app segue
   usando o histórico global. Toda substituição é síncrona, reentrante e sempre
   restaurada com try/finally.
   ============================================================ */
(function instalarConsistenciaEscopoPlanoTec() {
  if (typeof PlanoEngine === 'undefined' || typeof DesempenhoTecScreen === 'undefined' || typeof DB === 'undefined') return;

  const PE = PlanoEngine;
  const DT = DesempenhoTecScreen;
  const getterBase = DB.getTecSnapshots.bind(DB);

  const normalizarId = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && String(v).trim() !== '' ? n : v;
  };

  function snapshotsAtivos() {
    try {
      if (typeof DT.activeSnapshots === 'function') return (DT.activeSnapshots() || []).slice();
    } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-scope-active'); }
    return (getterBase() || []).slice();
  }

  function assinatura(snaps) {
    return (snaps || []).map(s => String(s && s.id != null ? s.id : '')).join('|');
  }

  function prepararEscopo(snaps) {
    const sig = assinatura(snaps);
    if (PE._tecScopeSignature !== sig) {
      PE._tecScopeSignature = sig;
      PE._agrC = null;
      DT._planoRefC = null;
      DT._fatias = null;
    }
    return sig;
  }

  function comSnapshots(snaps, fn) {
    const anterior = DB.getTecSnapshots;
    DB.getTecSnapshots = () => snaps;
    try { return fn(); }
    finally { DB.getTecSnapshots = anterior; }
  }

  function comEscopoAtivo(fn) {
    const fontes = snapshotsAtivos();
    prepararEscopo(fontes);
    return comSnapshots(fontes, fn);
  }

  /* O motor central continua protegido por scoped._fontes. Assim série,
     consolidação, agrupamento e janela adaptativa veem exatamente o recorte. */
  const calcularOriginal = PE.calcular;
  PE.calcular = function calcularComEscopo(scoped, opts) {
    const fontes = scoped && Array.isArray(scoped._fontes)
      ? scoped._fontes.slice()
      : snapshotsAtivos();
    prepararEscopo(fontes);
    return comSnapshots(fontes, () => calcularOriginal.call(this, scoped, opts));
  };

  /* "Onde atacar primeiro" é calculado fora de PlanoEngine.calcular(). Esta é
     a fuga que fazia um retrato desmarcado continuar mudando q, shareEsforco,
     nível e posição das disciplinas. A proteção fica só em torno dessa conta. */
  if (typeof PlanoPontos !== 'undefined' && PlanoPontos && typeof PlanoPontos.esforcoPorMateria === 'function') {
    const esforcoOriginal = PlanoPontos.esforcoPorMateria;
    PlanoPontos.esforcoPorMateria = function esforcoPorMateriaComEscopo() {
      const args = arguments;
      return comEscopoAtivo(() => esforcoOriginal.apply(this, args));
    };
  }

  /* O Plano calcula o ritmo em três caminhos (abertura, repintura e botão
     "ritmo medido"), todos passando por PlanoEngine.ritmoRecente(). Em vez de
     trocar o DB inteiro durante a tela, trocamos somente a FONTE desse cálculo.
     Auditoria, ciclos e progresso continuam vendo todos os retratos. */
  function comRitmoEscopado(fn) {
    if (typeof PE.ritmoRecente !== 'function') return fn();
    const anterior = PE.ritmoRecente;
    const fontes = snapshotsAtivos().slice().reverse();
    const temporario = function ritmoRecenteDoEscopo(_snaps) {
      const resto = Array.prototype.slice.call(arguments, 1);
      return anterior.apply(this, [fontes].concat(resto));
    };
    PE.ritmoRecente = temporario;
    try { return fn(); }
    finally { if (PE.ritmoRecente === temporario) PE.ritmoRecente = anterior; }
  }

  /* Restaura a seleção antes do render original inicializar "todos marcados".
     IDs inexistentes continuam sendo podados pela implementação original. */
  const renderOriginal = DT.render;
  DT.render = function renderComEscopoPersistido() {
    if (this.selectedSnapIds === null) {
      try {
        const p = this._loadPrefs();
        if (p && Array.isArray(p.selectedSnapIds) && p.selectedSnapIds.length) {
          this.selectedSnapIds = new Set(p.selectedSnapIds.map(normalizarId));
        }
        if (p && p.rangeStart) this.rangeStart = p.rangeStart;
        if (p && p.rangeEnd) this.rangeEnd = p.rangeEnd;
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-scope-restore'); }
    }
    return renderOriginal.apply(this, arguments);
  };

  function persistirEscopo() {
    try {
      const patch = {
        selectedSnapIds: DT.selectedSnapIds ? [...DT.selectedSnapIds] : [],
        rangeStart: DT.rangeStart || null,
        rangeEnd: DT.rangeEnd || null
      };
      DT.savePrefs(patch);
    } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-scope-save'); }
  }

  function invalidarPlano() {
    PE._agrC = null;
    PE._tecScopeSignature = null;
    DT._planoRefC = null;
    DT._fatias = null;
  }

  function atualizarPlanoSeVisivel() {
    invalidarPlano();
    if (DT.tecTab === 'plano' && typeof DT.renderPlanoConteudo === 'function') {
      DT.renderPlanoConteudo();
    }
  }

  function resumoEscopo() {
    const todos = getterBase() || [];
    const ativos = snapshotsAtivos();
    if (!ativos.length) return 'Escopo: nenhum retrato';
    const ini = ativos.reduce((m, s) => !m || (s.startDate && s.startDate < m) ? s.startDate : m, null);
    const fim = ativos.reduce((m, s) => !m || ((s.endDate || s.date) && (s.endDate || s.date) > m) ? (s.endDate || s.date) : m, null);
    const br = (d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : (d || '—');
    return `Escopo do Plano: ${ativos.length} de ${todos.length} retrato(s) · ${br(ini)} a ${br(fim)}`;
  }

  function desenharProvaEscopo() {
    if (typeof document === 'undefined' || DT.tecTab !== 'plano') return;
    const alvo = document.getElementById('plano-lista') || document.getElementById('plano-proj');
    if (!alvo) return;
    let chip = document.getElementById('plano-escopo-efetivo');
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'plano-escopo-efetivo';
      chip.style.cssText = 'font-size:11px;opacity:.72;margin:2px 0 8px 2px;line-height:1.35;';
      alvo.insertBefore(chip, alvo.firstChild);
    }
    chip.textContent = resumoEscopo();
  }

  /* A abertura e cada repintura recebem apenas a fonte de RITMO escopada.
     Nenhum getter global do DB é trocado aqui; isso preserva deliberadamente
     auditoria e medição das atividades sobre o histórico integral. */
  if (typeof DT.renderPlano === 'function') {
    const renderPlanoOriginal = DT.renderPlano;
    DT.renderPlano = function renderPlanoComRitmoDoEscopo() {
      const args = arguments;
      return comRitmoEscopado(() => renderPlanoOriginal.apply(this, args));
    };
  }

  const renderPlanoConteudoOriginal = DT.renderPlanoConteudo;
  DT.renderPlanoConteudo = function renderPlanoConteudoComEscopo() {
    const args = arguments;
    const r = comRitmoEscopado(() => renderPlanoConteudoOriginal.apply(this, args));
    try { desenharProvaEscopo(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-scope-proof'); }
    return r;
  };

  /* O listener original do botão roda na fase bubble. No capture, substituímos
     somente ritmoRecente até o fim do despacho síncrono e restauramos no
     microtask seguinte. O DB permanece global durante todo o clique. */
  function escoparCliqueDeRitmo(e) {
    const t = e && e.target && e.target.closest ? e.target.closest('#plano-ritmo-medido') : null;
    if (!t || typeof PE.ritmoRecente !== 'function') return;
    const anterior = PE.ritmoRecente;
    const fontes = snapshotsAtivos().slice().reverse();
    const temporario = function ritmoDoClique(_snaps) {
      const resto = Array.prototype.slice.call(arguments, 1);
      return anterior.apply(this, [fontes].concat(resto));
    };
    PE.ritmoRecente = temporario;
    queueMicrotask(() => { if (PE.ritmoRecente === temporario) PE.ritmoRecente = anterior; });
  }

  /* Os listeners originais continuam responsáveis por atualizar Análise/Reforço.
     Aqui persistimos o recorte, limpamos caches e, quando a aba visível é Plano,
     recalculamos. Inclui também os atalhos rápidos de intervalo. */
  if (typeof document !== 'undefined' && document && document.addEventListener) {
    document.addEventListener('click', escoparCliqueDeRitmo, true);

    const depois = () => queueMicrotask(() => {
      persistirEscopo();
      atualizarPlanoSeVisivel();
    });

    document.addEventListener('change', (e) => {
      const t = e.target;
      if (!t) return;
      if ((t.matches && t.matches('#tec-scope-select input[data-snap]')) ||
          t.id === 'tec-range-start' || t.id === 'tec-range-end') depois();
    });

    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('button, #tec-scope-all, #tec-scope-none') : null;
      if (!t) return;
      if (t.id === 'tec-scope-all' || t.id === 'tec-scope-none' ||
          (t.matches && (t.matches('#tec-scope-toggle button[data-scope]') || t.matches('.tec-range-quick')))) depois();
    });
  }
})();
