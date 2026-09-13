/* ============================================================
   DESEMPENHO TEC — contrato de escopo e invariantes do Plano
   ============================================================
   O estado do período/seleção pertence à tela principal (51). Esta camada não
   duplica listeners de escopo: ela só garante que consumidores analíticos que
   historicamente leem DB.getTecSnapshots() recebam as fontes ativas.

   CONTRATO:
   - Análise, Plano e Reforço: desempenho do aluno = escopo ativo;
   - Incidência: base externa da banca = independente do período do aluno;
   - Auditoria/ciclo/progresso: histórico integral, nunca mascarado pelo escopo.
   ============================================================ */
(function instalarContratoEscopoTec() {
  if (typeof PlanoEngine === 'undefined' || typeof DesempenhoTecScreen === 'undefined' || typeof DB === 'undefined') return;

  const PE = PlanoEngine;
  const DT = DesempenhoTecScreen;
  const getterBase = DB.getTecSnapshots.bind(DB);

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

  /* O motor central ainda possui helpers legados que consultam o DB. O agregado
     explícito manda; sem agregado, vale activeSnapshots(). O override é local e
     sempre restaurado, inclusive em exceção. */
  const calcularOriginal = PE.calcular;
  PE.calcular = function calcularComEscopo(scoped, opts) {
    const fontes = scoped && Array.isArray(scoped._fontes)
      ? scoped._fontes.slice()
      : snapshotsAtivos();
    prepararEscopo(fontes);
    return comSnapshots(fontes, () => calcularOriginal.call(this, scoped, opts));
  };

  /* “Onde atacar primeiro” vive fora de calcular(). Esta proteção impede que um
     retrato fora do período altere q, shareEsforco, nível ou ordem das matérias. */
  if (typeof PlanoPontos !== 'undefined' && PlanoPontos && typeof PlanoPontos.esforcoPorMateria === 'function') {
    const esforcoOriginal = PlanoPontos.esforcoPorMateria;
    PlanoPontos.esforcoPorMateria = function esforcoPorMateriaComEscopo() {
      const args = arguments;
      return comEscopoAtivo(() => esforcoOriginal.apply(this, args));
    };
  }

  /* O ritmo do Plano deve usar o mesmo período, mas auditoria e atividades não.
     Por isso escopamos apenas a função de ritmo durante as pinturas do Plano. */
  function comRitmoEscopado(fn) {
    if (typeof PE.ritmoRecente !== 'function') return fn();
    const anterior = PE.ritmoRecente;
    const fontes = snapshotsAtivos().slice().reverse();
    const temporario = function ritmoDoEscopo(_snaps) {
      const resto = Array.prototype.slice.call(arguments, 1);
      return anterior.apply(this, [fontes].concat(resto));
    };
    PE.ritmoRecente = temporario;
    try { return fn(); }
    finally { if (PE.ritmoRecente === temporario) PE.ritmoRecente = anterior; }
  }

  if (typeof DT.renderPlano === 'function') {
    const original = DT.renderPlano;
    DT.renderPlano = function renderPlanoComRitmoDoEscopo() {
      const args = arguments;
      return comRitmoEscopado(() => original.apply(this, args));
    };
  }

  if (typeof DT.renderPlanoConteudo === 'function') {
    const original = DT.renderPlanoConteudo;
    DT.renderPlanoConteudo = function renderPlanoConteudoComRitmoDoEscopo() {
      const args = arguments;
      const r = comRitmoEscopado(() => original.apply(this, args));
      try { desenharProvaEscopo(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-scope-proof'); }
      return r;
    };
  }

  /* O botão “usar ritmo medido” calcula antes de uma nova pintura. Capturamos
     somente essa chamada e restauramos a função no microtask seguinte. */
  if (typeof document !== 'undefined' && document && document.addEventListener) {
    document.addEventListener('click', (e) => {
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
    }, true);
  }

  /* Invariantes de negócio. Defaults já são bons; isto só impede combinações
     customizadas contraditórias. Não escolhemos estratégia pelo usuário. */
  const numero = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function normalizarParametrosPlano(orig) {
    const p = Object.assign({}, orig || {});
    p.metaDominio = clamp(numero(p.metaDominio, 85), 1, 100);
    p.tetoDominio = clamp(numero(p.tetoDominio, 90), p.metaDominio, 100);
    p.faixaCritico = clamp(numero(p.faixaCritico, 50), 0, p.metaDominio);
    p.faixaFragil = clamp(numero(p.faixaFragil, 65), p.faixaCritico, p.metaDominio);
    p.minAmostra = Math.max(1, Math.round(numero(p.minAmostra, 20)));
    p.amostraAlvo = Math.max(p.minAmostra, Math.round(numero(p.amostraAlvo, 50)));
    p.pisoSerie = Math.max(1, Math.round(numero(p.pisoSerie, 5)));
    p.consolidarEm = Math.max(1, Math.round(numero(p.consolidarEm, 2)));
    p.validadeDias = Math.max(1, Math.round(numero(p.validadeDias, 120)));
    p.janelaMax = Math.max(1, Math.round(numero(p.janelaMax, 365)));
    p.cadenciaDias = Math.max(1, Math.round(numero(p.cadenciaDias, 30)));
    p.sensTendencia = Math.max(0, numero(p.sensTendencia, 3));
    p.custoPiso = Math.max(0, numero(p.custoPiso, 50));
    p.custoPorPonto = Math.max(0, numero(p.custoPorPonto, 2));
    p.limite = Math.max(1, Math.round(numero(p.limite, 10)));
    if (p.ritmoSemanal != null && p.ritmoSemanal !== '') p.ritmoSemanal = Math.max(1, numero(p.ritmoSemanal, 25));
    return p;
  }
  PE._normalizarParametrosTec = normalizarParametrosPlano;

  if (typeof PE.prefs === 'function') {
    const prefsOriginal = PE.prefs;
    PE.prefs = function prefsCoerentes() {
      return normalizarParametrosPlano(prefsOriginal.apply(this, arguments));
    };
  }
  if (typeof PE.salvarPrefs === 'function') {
    const salvarOriginal = PE.salvarPrefs;
    PE.salvarPrefs = function salvarPrefsCoerentes(patch) {
      const base = Object.assign({}, this.prefs(), patch || {});
      return salvarOriginal.call(this, normalizarParametrosPlano(base));
    };
  }

  function resumoEscopo() {
    const todos = getterBase() || [];
    const ativos = snapshotsAtivos();
    if (!ativos.length) return `Escopo do Plano: 0 de ${todos.length} retrato(s) · nenhum dado no período`;
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

  /* Incidência é uma dimensão externa (o que a banca cobra), não uma série de
     desempenho do aluno. A tela explica o contrato para não parecer defeito. */
  if (typeof DT.renderIncidencia === 'function') {
    const incidenciaOriginal = DT.renderIncidencia;
    DT.renderIncidencia = function renderIncidenciaComContrato() {
      const r = incidenciaOriginal.apply(this, arguments);
      try {
        const host = document.getElementById('incid-selecao-resumo');
        if (host && !document.getElementById('incid-escopo-nota')) {
          const nota = document.createElement('p');
          nota.id = 'incid-escopo-nota';
          nota.className = 'incid-selecao';
          nota.style.opacity = '.78';
          nota.textContent = 'Período do Desempenho TEC: recorta seu desempenho em Análise, Plano e Reforço. O índice de Incidência é externo e continua sendo filtrado pelas bancas selecionadas.';
          host.appendChild(nota);
        }
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-incid-scope-note'); }
      return r;
    };
  }
})();
