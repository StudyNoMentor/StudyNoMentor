/* ============================================================
   DESEMPENHO TEC — consistência do escopo no Plano
   ============================================================
   O agregado da aba Análise já respeita activeSnapshots(), mas o PlanoEngine
   consulta DB.getTecSnapshots() em vários pontos internos (janela adaptativa,
   sequência, série, agrupamento, incidência/pontos etc.). Isso fazia um retrato
   desmarcado continuar influenciando a fila do Plano.

   Esta camada aplica um escopo transacional e síncrono durante o cálculo do
   Plano. A troca temporária do getter é protegida por try/finally, portanto não
   vaza para outras telas nem para o ciclo de atividades. Também persiste os IDs
   marcados e invalida caches quando o recorte muda.
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

  /* O cálculo é estritamente síncrono. Enquanto ele roda, todos os consumidores
     internos de DB.getTecSnapshots enxergam EXATAMENTE as fontes do agregado
     scopedSnapshot(). O getter original é restaurado mesmo se houver exceção. */
  function comSnapshots(snaps, fn) {
    const anterior = DB.getTecSnapshots;
    DB.getTecSnapshots = () => snaps;
    try { return fn(); }
    finally { DB.getTecSnapshots = anterior; }
  }

  const calcularOriginal = PE.calcular;
  PE.calcular = function calcularComEscopo(scoped, opts) {
    const fontes = scoped && Array.isArray(scoped._fontes)
      ? scoped._fontes.slice()
      : snapshotsAtivos();
    const sig = assinatura(fontes);

    /* _agrupamento tinha cache por quantidade + último id + piso. Dois recortes
       diferentes podiam ter a mesma quantidade e o mesmo último retrato e,
       portanto, reutilizar uma árvore calculada para outro escopo. */
    if (this._tecScopeSignature !== sig) {
      this._tecScopeSignature = sig;
      this._agrC = null;
    }

    return comSnapshots(fontes, () => calcularOriginal.call(this, scoped, opts));
  };

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

  const renderPlanoConteudoOriginal = DT.renderPlanoConteudo;
  DT.renderPlanoConteudo = function renderPlanoConteudoComProva() {
    const r = renderPlanoConteudoOriginal.apply(this, arguments);
    try { desenharProvaEscopo(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-scope-proof'); }
    return r;
  };

  /* Os listeners originais continuam responsáveis por atualizar Análise/Reforço.
     Aqui apenas persistimos o recorte, limpamos caches e, quando a aba visível é
     Plano, recalculamos o Plano. queueMicrotask roda depois do listener original
     que efetivamente alterou selectedSnapIds/range/scopeMode. */
  if (typeof document !== 'undefined' && document && document.addEventListener) {
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
          (t.matches && t.matches('#tec-scope-toggle button[data-scope]'))) depois();
    });
  }
})();
