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

/* ============================================================
   PLANO — execução realista: sessão curta, ciclo curto, custo só para ranking
   ============================================================
   Há três números diferentes e cada um tem um papel:
   1) amostra estatística: quantas questões no TOTAL dão determinada precisão;
   2) custo estimado: régua relativa para ordenar assuntos por esforço;
   3) meta operacional: um ciclo curto que cabe na rotina e produz feedback.

   O defeito anterior era transformar (2) literalmente em (3): uma estimativa de
   236 questões virava uma atividade de 236 questões. Isso prendia o aluno num
   tópico e ainda fazia a amostra estatística (~95 em torno de 50% para ±10pp)
   parecer uma segunda meta concorrente. Esta camada separa as três moedas.
   ============================================================ */
(function instalarExecucaoRealPlano() {
  if (typeof PlanoEngine === 'undefined' || typeof DB === 'undefined') return;
  const PE = PlanoEngine;
  const PC = (typeof PlanoCiclo !== 'undefined') ? PlanoCiclo : null;
  const EX = (typeof ExtrasScreen !== 'undefined') ? ExtrasScreen : null;
  const DT = (typeof DesempenhoTecScreen !== 'undefined') ? DesempenhoTecScreen : null;
  const MAX_CICLO = 30;
  const MAX_SESSAO = 15;

  const n = (v, f) => Number.isFinite(Number(v)) ? Number(v) : f;
  const inteiro = (v, f) => Math.max(0, Math.round(n(v, f)));
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

  function execucao(item, motivo, prefs) {
    item = item || {};
    const p = Object.assign({}, PE.prefs ? PE.prefs() : {}, prefs || {});
    const taxa = n(item.taxa, n(item.taxaInicial, NaN));
    const qJanela = inteiro(item.qJanela, 0);
    const diagnostico = motivo === 'diagnostico';
    let ciclo;

    if (diagnostico) {
      const falta = inteiro(item.faltaAmostra, Math.max(0, inteiro(p.minAmostra, 20) - qJanela));
      ciclo = limitar(falta || 10, 5, 20);
    } else if (!Number.isFinite(taxa)) ciclo = 25;
    else if (taxa < n(p.faixaCritico, 50)) ciclo = 20;
    else if (taxa < n(p.faixaFragil, 65)) ciclo = 30;
    else if (taxa < n(p.metaDominio, 85)) ciclo = 25;
    else ciclo = 15;

    ciclo = limitar(Math.round(ciclo), 5, MAX_CICLO);
    const sessao = Math.min(MAX_SESSAO, ciclo);
    let qMedir = null;
    try { qMedir = Number.isFinite(taxa) && typeof PE.qParaMedir === 'function' ? PE.qParaMedir(taxa, PE.MARGEM_ALVO || 10) : null; }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-qmedir-execucao'); }
    const custo = inteiro(item.custoEstimadoQ != null ? item.custoEstimadoQ : item.custoQ, 0) || null;
    return {
      modelo: 2,
      ciclo,
      sessao,
      custoEstimadoQ: custo,
      qMedirAlvo: qMedir,
      faltaMedir: qMedir == null ? null : Math.max(0, qMedir - qJanela),
      qJanela,
      motivo: diagnostico ? 'diagnostico' : 'reforco'
    };
  }

  globalThis.PlanoExecucaoReal = {
    versao: 2,
    maxCiclo: MAX_CICLO,
    maxSessao: MAX_SESSAO,
    calcular: execucao
  };

  /* Decoração sem mexer no custoQ. O custo continua disponível para a ordem
     "rendimento"; a ação, porém, fala a linguagem da rotina. */
  const calcularAnterior = PE.calcular;
  PE.calcular = function calcularComExecucaoReal() {
    const r = calcularAnterior.apply(this, arguments);
    if (!r || r.erro) return r;
    const p = arguments[1] || (PE.prefs ? PE.prefs() : {});
    const decorar = (x, motivo) => {
      if (!x) return x;
      const e = execucao(x, motivo, p);
      x.metaCicloQ = e.ciclo;
      x.metaSessaoQ = e.sessao;
      x.custoEstimadoQ = e.custoEstimadoQ;
      x.qMedirAlvo = e.qMedirAlvo;
      x.faltaMedir = e.faltaMedir;
      return x;
    };
    (r.itens || []).forEach(x => decorar(x, 'reforco'));
    (r.pequenas || []).forEach(x => decorar(x, 'diagnostico'));
    return r;
  };

  if (PC && typeof PC.origem === 'function') {
    const origemAnterior = PC.origem;
    PC.origem = function origemComExecucaoReal(topico, disciplina, item, opts) {
      const o = origemAnterior.apply(this, arguments);
      const motivo = (opts && opts.motivo) || (o && o.motivo) || 'reforco';
      const e = execucao(item || o || {}, motivo);
      return Object.assign({}, o, {
        modeloExecucao: 2,
        custoEstimadoQ: e.custoEstimadoQ,
        metaCicloQ: e.ciclo,
        metaSessaoQ: e.sessao,
        qMedirAlvo: e.qMedirAlvo,
        faltaMedirAoCriar: e.faltaMedir
      });
    };
  }

  if (EX) {
    const normalizarCand = (ctx) => {
      (ctx._planoCand || []).forEach(x => {
        const custoAntigo = x.custoEstimadoQ != null ? x.custoEstimadoQ : (x.motivo === 'reforco' ? x.alvo : null);
        const e = execucao(Object.assign({}, x, { custoEstimadoQ: custoAntigo }), x.motivo || 'reforco');
        x.custoEstimadoQ = e.custoEstimadoQ;
        x.metaCicloQ = e.ciclo;
        x.metaSessaoQ = e.sessao;
        x.qMedirAlvo = e.qMedirAlvo;
        x.faltaMedir = e.faltaMedir;
        x.alvo = e.ciclo;
      });
    };

    const selecionarRodizio = (ctx) => {
      const cand = ctx._planoCand || [];
      const sel = new Set();
      const disciplinas = new Set();
      for (let i = 0; i < cand.length && disciplinas.size < 3; i++) {
        const d = String(cand[i].disciplina || 'Sem disciplina');
        if (disciplinas.has(d)) continue;
        disciplinas.add(d); sel.add(i);
      }
      ctx._planoSel = sel;
    };

    if (typeof EX.puxarDoPlano === 'function') {
      const puxarAnterior = EX.puxarDoPlano;
      EX.puxarDoPlano = function puxarDoPlanoEmRodizio() {
        const r = puxarAnterior.apply(this, arguments);
        try {
          if (typeof this._planoRecalc === 'function') {
            const recalcBase = this._planoRecalc;
            this._planoRecalc = () => { recalcBase(); normalizarCand(this); };
          }
          normalizarCand(this);
          selecionarRodizio(this);
          setTimeout(() => {
            try {
              this._planoRenderLista();
              const lista = document.getElementById('pl-lista');
              const modal = lista && lista.closest ? lista.closest('.modal, .ui-modal, [role="dialog"]') : null;
              const hint = modal ? modal.querySelector('.hint') : null;
              if (hint) hint.innerHTML = '<strong>Rodízio sugerido:</strong> 1 tópico de cada uma de até 3 disciplinas. Cada atividade nasce como um <strong>ciclo curto</strong>; o custo grande do Plano serve apenas para comparar esforço.';
            } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-dialogo-rodizio'); }
          }, 45);
        } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-puxar-rodizio'); }
        return r;
      };
    }

    if (typeof EX._planoRenderLista === 'function') {
      const listaAnterior = EX._planoRenderLista;
      EX._planoRenderLista = function renderListaPlanoComTresMetas() {
        normalizarCand(this);
        const r = listaAnterior.apply(this, arguments);
        try {
          const host = document.getElementById('pl-lista');
          if (host) host.querySelectorAll('.pl-linha').forEach(row => {
            const cb = row.querySelector('.pl-pick');
            const i = cb ? parseInt(cb.dataset.i, 10) : -1;
            const x = i >= 0 ? (this._planoCand || [])[i] : null;
            const hint = row.querySelector('.hint');
            if (!x || !hint || hint.querySelector('.pl-execucao-real')) return;
            const custo = x.custoEstimadoQ ? ` · esforço estimado ${x.custoEstimadoQ}q <em>(só ranking)</em>` : '';
            hint.insertAdjacentHTML('beforeend', `<span class="pl-execucao-real"> · sessão ≤${x.metaSessaoQ}q · ciclo ${x.metaCicloQ}q${custo}</span>`);
          });
        } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-lista-execucao'); }
        return r;
      };
    }

    const depoisDeRender = () => {
      try {
        /* Migração de legado fica na superfície operacional, não no banco global.
           Só reduz alvos antigos >120 que ainda não começaram. */
        if (typeof DB.getExtras === 'function' && typeof DB.updateExtra === 'function') {
          (DB.getExtras() || []).forEach(e => {
            const o = e && e.origemPlano;
            if (!o || o.modeloExecucao || e.status === 'concluida' || Number(e.alvo) <= MAX_CICLO * 4) return;
            let feito = Number(e.progresso) || 0;
            try { if (typeof DB.extraProgressoPeriodo === 'function') feito = Math.max(feito, Number(DB.extraProgressoPeriodo(e)) || 0); } catch (_) {}
            if (feito > 0) return;
            const ex = execucao({ taxa: o.taxaInicial, qJanela: 0, custoQ: Number(e.alvo) || 0 }, o.motivo || 'reforco');
            DB.updateExtra(e.id, { alvo: ex.ciclo, origemPlano: Object.assign({}, o, {
              modeloExecucao: 2, custoEstimadoQ: Number(e.alvo) || null, metaCicloQ: ex.ciclo,
              metaSessaoQ: ex.sessao, qMedirAlvo: ex.qMedirAlvo, migradoDeAlvo: Number(e.alvo) || null
            }) });
          });
        }
        const brand = document.querySelector('#extras-curso .exc-brand span:last-child');
        if (brand) brand.textContent = 'Ciclos de reforço';
        const head = document.querySelector('#extras-curso .exc-head');
        if (head && !document.getElementById('exc-ciclo-explica')) {
          const p = document.createElement('p');
          p.id = 'exc-ciclo-explica';
          p.className = 'hint';
          p.style.cssText = 'margin:0;padding:0 18px 10px;font-size:11px;line-height:1.35;opacity:.78;';
          p.textContent = 'Este é o acompanhamento acumulado. A atividade que aparece abaixo na Missão do dia é a mesma: o que você registra hoje soma neste ciclo.';
          head.insertAdjacentElement('afterend', p);
        }
        const sub = document.querySelector('#extras-agenda .cal-card .card-header .sub');
        if (sub) sub.textContent = 'Aqui você registra a sessão do dia. Nas atividades do Plano, este registro alimenta o mesmo ciclo mostrado em “Ciclos de reforço” — não é uma segunda tarefa.';
        document.querySelectorAll('#extras-list .exd[data-id]').forEach(card => {
          const e = DB.getExtra ? DB.getExtra(card.dataset.id) : null;
          const o = e && e.origemPlano;
          if (!o || !o.topico) return;
          const tags = card.querySelector('.exd-tags');
          if (tags && !tags.querySelector('.pl-sessao-tag')) {
            const s = document.createElement('span');
            s.className = 'extra-tag plano pl-sessao-tag';
            s.textContent = `sessão ≤${o.metaSessaoQ || MAX_SESSAO}q · ciclo ${e.alvo || o.metaCicloQ || '—'}q`;
            s.title = 'A sessão é o bloco de hoje. O ciclo é a meta acumulada desta intervenção; os registros do dia somam nele.';
            tags.appendChild(s);
          }
          const prog = card.querySelector('.exd-prog');
          if (prog) prog.title = 'Progresso acumulado do ciclo — não é uma meta para fazer toda hoje.';
        });
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'extras-execucao-real'); }
    };

    if (typeof EX.render === 'function') {
      const renderAnterior = EX.render;
      EX.render = function renderComDistincaoSessaoCiclo() {
        const r = renderAnterior.apply(this, arguments); depoisDeRender(); return r;
      };
    }
    if (typeof EX.renderEmCurso === 'function') {
      const cursoAnterior = EX.renderEmCurso;
      EX.renderEmCurso = function renderCursoComoCiclo() {
        const r = cursoAnterior.apply(this, arguments); depoisDeRender(); return r;
      };
    }
  }

  /* O Plano continua mostrando a estimativa, mas sem chamá-la de tarefa. */
  function ajustarDOMPlano() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.plm').forEach(m => {
      const s = m.querySelector('span');
      if (s && s.textContent.trim() === 'questões (custo)') s.textContent = 'q esforço estimado';
    });
    document.querySelectorAll('.plm-amostra span').forEach(s => {
      if (s.textContent.indexOf('q p/ medir') >= 0) s.textContent = s.textContent.replace('q p/ medir', 'faltam p/ amostra');
    });
    /* O motor mantém a formula estatística intacta. Só a APRESENTAÇÃO deixa de
       transformar uma amostra grande em ordem para uma única sessão. */
    document.querySelectorAll('.pl-direcao span:last-child, .pl-guia-acao').forEach(el => {
      el.textContent = String(el.textContent || '').replace(/\b(\d+)\s+questões\b/g, (m, q) =>
        Number(q) > MAX_CICLO ? `uma amostra de ${q} questões acumuladas em vários ciclos` : m);
    });
    document.querySelectorAll('.pl-base').forEach(el => {
      const txt = String(el.textContent || '');
      if (txt.indexOf('Para a próxima medição') >= 0 && !el.querySelector('.pl-exec-nota')) {
        const nota = document.createElement('span'); nota.className = 'pl-exec-nota';
        nota.textContent = ` Não faça essa amostra de uma vez: acumule-a em ciclos de até ${MAX_CICLO} questões, alternando matérias.`;
        el.appendChild(nota);
      }
      if (txt.indexOf('Custo estimado de') === 0 && !el.querySelector('.pl-exec-nota')) {
        const nota = document.createElement('span'); nota.className = 'pl-exec-nota';
        nota.textContent = ` Este número serve para comparar esforço; a atividade prática usa ciclo de até ${MAX_CICLO} questões.`;
        el.appendChild(nota);
      }
    });
    document.querySelectorAll('[data-info]').forEach(el => {
      const txt = el.getAttribute('data-info') || '';
      if (txt.indexOf('É o alvo que vai para a atividade') >= 0) {
        el.setAttribute('data-info', txt.replace(/É o alvo que vai para a atividade[^<]*(?:<b>\+ Atividade<\/b>)?\.?/,
          `É uma estimativa para comparar esforço entre tópicos. <b>Não vira a meta da atividade.</b> A execução usa ciclos curtos de até ${MAX_CICLO} questões e sessões de até ${MAX_SESSAO}.`));
      }
    });
  }
  if (DT && typeof DT.renderPlanoConteudo === 'function') {
    const renderPlanoAnterior = DT.renderPlanoConteudo;
    DT.renderPlanoConteudo = function renderPlanoComMoedasSeparadas() {
      const r = renderPlanoAnterior.apply(this, arguments);
      try { ajustarDOMPlano(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-dom-execucao'); }
      return r;
    };
  }
})();
