/* ============================================================
   DESEMPENHO TEC — consistência do escopo no Plano
   ============================================================
   O agregado da aba Análise já respeita activeSnapshots(), mas o Plano tem
   consumidores que leem DB.getTecSnapshots() fora de PlanoEngine.calcular()
   (quadro de matérias, ritmo, trajetória e outros auxiliares de renderização).
   Se só o motor central for protegido, um retrato desmarcado ainda consegue
   alterar partes visíveis — inclusive a ordem de "Onde atacar primeiro".

   A regra desta camada é mais forte: enquanto QUALQUER renderização do Plano
   roda, DB.getTecSnapshots() representa exatamente o escopo ativo. O cálculo
   central continua protegido isoladamente para chamadas fora da tela. Tudo é
   síncrono, reentrante e restaurado com try/finally.
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

  /* Reentrante: se renderPlano() chama renderPlanoConteudo(), o getter anterior
     já é o getter escopado. O finally de cada nível devolve exatamente o que
     encontrou, sem vazar estado para Análise, Reforço ou ciclo de atividades. */
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

  /* Chamadas diretas ao motor também obedecem ao agregado explícito. Isso é
     necessário para _planoRef(), conciliação da tela e testes que usam o motor
     sem passar pela renderização completa. */
  const calcularOriginal = PE.calcular;
  PE.calcular = function calcularComEscopo(scoped, opts) {
    const fontes = scoped && Array.isArray(scoped._fontes)
      ? scoped._fontes.slice()
      : snapshotsAtivos();
    prepararEscopo(fontes);
    return comSnapshots(fontes, () => calcularOriginal.call(this, scoped, opts));
  };

  /* Defesa em profundidade para o quadro que efetivamente ordena as matérias.
     Ele vive fora de PlanoEngine.calcular(); foi exatamente o vazamento que o
     PR anterior não cobriu. Mesmo se chamado isoladamente, enxerga só o escopo. */
  if (typeof PlanoPontos !== 'undefined' && PlanoPontos && typeof PlanoPontos.esforcoPorMateria === 'function') {
    const esforcoOriginal = PlanoPontos.esforcoPorMateria;
    PlanoPontos.esforcoPorMateria = function esforcoPorMateriaComEscopo() {
      const args = arguments;
      return comEscopoAtivo(() => esforcoOriginal.apply(this, args));
    };
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

  /* A fronteira correta é a TELA INTEIRA do Plano, não apenas calcular().
     renderPlano cobre a inicialização dos controles (inclusive ritmo medido);
     renderPlanoConteudo cobre cada repintura, ranking de matérias, trajetória,
     projeções e qualquer helper chamado por _pintarPlano(). */
  if (typeof DT.renderPlano === 'function') {
    const renderPlanoOriginal = DT.renderPlano;
    DT.renderPlano = function renderPlanoComEscopo() {
      const args = arguments;
      return comEscopoAtivo(() => renderPlanoOriginal.apply(this, args));
    };
  }

  const renderPlanoConteudoOriginal = DT.renderPlanoConteudo;
  DT.renderPlanoConteudo = function renderPlanoConteudoComEscopo() {
    const args = arguments;
    const r = comEscopoAtivo(() => renderPlanoConteudoOriginal.apply(this, args));
    try { desenharProvaEscopo(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-scope-proof'); }
    return r;
  };

  /* Um único handler do Plano calcula o ritmo ANTES de chamar qualquer método
     embrulhado: o botão "ritmo medido". No capture do clique mantemos o getter
     escopado até o fim do despacho síncrono do evento e restauramos no próximo
     microtask. Assim o listener original também recebe apenas os retratos ativos. */
  function escoparCliqueDeRitmo(e) {
    const t = e && e.target && e.target.closest ? e.target.closest('#plano-ritmo-medido') : null;
    if (!t) return;
    const fontes = snapshotsAtivos();
    prepararEscopo(fontes);
    const anterior = DB.getTecSnapshots;
    DB.getTecSnapshots = () => fontes;
    queueMicrotask(() => { if (DB.getTecSnapshots !== anterior) DB.getTecSnapshots = anterior; });
  }

  /* Os listeners originais continuam responsáveis por atualizar Análise/Reforço.
     Aqui persistimos o recorte, limpamos caches e, quando a aba visível é Plano,
     recalculamos. queueMicrotask roda depois do listener original que alterou o
     estado. Inclui também os atalhos de intervalo, ausentes no PR anterior. */
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
