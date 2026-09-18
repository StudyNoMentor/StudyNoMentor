/* ============================================================================
   HIERARQUIA DE UX — mesma capacidade, menos ruído
   ----------------------------------------------------------------------------
   Esta camada NÃO cria regra de negócio. Ela organiza as superfícies existentes,
   preserva contexto entre renders/telas e garante que resultado/execução venham
   antes de configuração, auditoria e detalhes.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.UXHierarchy) return;

  const q = (s, r = document) => r && r.querySelector ? r.querySelector(s) : null;
  const qa = (s, r = document) => r && r.querySelectorAll ? Array.from(r.querySelectorAll(s)) : [];
  const nextFrame = (fn) => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0);
  const screenEl = (nome) => document.getElementById('screen-' + nome);
  const activeName = () => {
    const s = q('.screen.active');
    return s && s.id ? s.id.replace(/^screen-/, '') : null;
  };

  const COPY = Object.freeze({
    registrar: 'Registre a sessão atual. O restante é calculado a partir dos seus dados.',
    ciclo: 'Veja se a semana está no ritmo, quanto falta e onde concentrar o próximo esforço.',
    grade: 'Distribua as sessões da semana. Os números reais continuam vindo dos registros.',
    estudonovo: 'Acompanhe o avanço da teoria por disciplina e aula.',
    leis: 'Leia, marque e retome exatamente de onde parou.',
    cards: 'Revise o que vence hoje. O agendamento continua automático.',
    extras: 'Execute hoje o que complementa o plano e acompanhe somente o saldo que ainda importa.',
    links: 'Seus atalhos de estudo, sem competir com a execução do plano.',
    historico: 'Consulte semanas fechadas e os registros que formaram cada resultado.',
    evolucao: 'Acompanhe volume, aproveitamento, distribuição e ritmo no período selecionado.',
    conquistas: 'Marcos acumulados da sua trajetória, sem transformar progresso em cobrança.',
    desempenhotec: 'Meça o desempenho e transforme fraquezas em prioridade de ataque.',
    ferramentas: 'Use os cálculos auxiliares quando precisar, fora do fluxo diário.',
    config: 'Ajuste o que muda o estudo. Backup, recuperação e diagnóstico ficam em segundo plano.',
    planejamentos: 'Alterne entre contextos de estudo sem misturar históricos.'
  });

  const U = {
    _wrapped: new WeakMap(),
    _scroll: new Map(),
    _scrollBound: false,
    _lawDefaultsDone: false,
    _evoDetails: null,
    _configDetails: null,

    rewriteCopy() {
      Object.entries(COPY).forEach(([nome, texto]) => {
        const el = q('.page-subtitle', screenEl(nome));
        if (el && el.textContent !== texto) el.textContent = texto;
      });
    },

    after(obj, metodo, fn) {
      if (!obj || typeof obj[metodo] !== 'function') return;
      let set = this._wrapped.get(obj);
      if (!set) { set = new Set(); this._wrapped.set(obj, set); }
      if (set.has(metodo)) return;
      set.add(metodo);
      const anterior = obj[metodo];
      obj[metodo] = function() {
        const r = anterior.apply(this, arguments);
        try { fn.call(U, this, arguments, r); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ux-hierarchy-' + metodo); }
        return r;
      };
    },

    preserveScroll(obj, metodo, nome) {
      if (!obj || typeof obj[metodo] !== 'function') return;
      const key = '__uxHierarchyScroll_' + metodo;
      if (obj[key]) return;
      obj[key] = true;
      const anterior = obj[metodo];
      obj[metodo] = function() {
        const ativo = activeName() === nome;
        const y = ativo ? window.scrollY : null;
        const r = anterior.apply(this, arguments);
        if (ativo && y != null) nextFrame(() => {
          if (activeName() === nome && Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
        });
        return r;
      };
    },

    setupScrollMemory() {
      if (this._scrollBound) return;
      this._scrollBound = true;
      let queued = false;
      window.addEventListener('scroll', () => {
        if (queued) return;
        queued = true;
        nextFrame(() => {
          queued = false;
          const nome = activeName();
          if (nome) this._scroll.set(nome, window.scrollY);
        });
      }, { passive: true });
      window.addEventListener('screen:activated', (e) => {
        const nome = e && e.detail && e.detail.screen;
        this.onScreen(nome);
        const y = nome ? this._scroll.get(nome) : null;
        if (Number.isFinite(y) && y > 0) nextFrame(() => {
          if (activeName() === nome) window.scrollTo(0, y);
        });
      });
    },

    setupInstantFeedback() {
      if (document.documentElement.dataset.uxInstantFeedback === '1') return;
      document.documentElement.dataset.uxInstantFeedback = '1';
      const sel = [
        '[data-tpm-source]', '.tec-subtab', '#extras-plano-btn', '#extras-suggest-btn',
        '#btn-calc-cycle', '#btn-confirm-cycle', '#study-report-generate', '#cards-foco-btn',
        '#tec-cfg-done', '[data-tpm-rank-more]', '[data-tpm-rank-all]'
      ].join(',');
      document.addEventListener('pointerdown', (e) => {
        const b = e.target && e.target.closest ? e.target.closest(sel) : null;
        if (!b || b.disabled) return;
        b.classList.add('ux-instant-feedback');
        setTimeout(() => { if (b.isConnected) b.classList.remove('ux-instant-feedback'); }, 420);
      }, true);
    },

    decorateRegistrar() {
      const s = screenEl('registrar'); if (!s) return;
      const form = q('form', s);
      form?.closest('.card')?.classList.add('ux-primary-card');
      q('#recent-section', s)?.classList.add('ux-secondary-area');
      q('#reg-repeat', s)?.classList.add('ux-priority-action');
      q('#reg-mode-seg', s)?.classList.add('ux-compact-control');
    },

    decorateCycle() {
      const s = screenEl('ciclo'); if (!s) return;
      q('#ciclo-active .card', s)?.classList.add('ux-primary-card');
      q('#ciclo-subjects-progress', s)?.classList.add('ux-execution-list');
      this.decorateCycleGauges();
    },

    decorateCycleGauges() {
      const host = document.getElementById('ciclo-overview-gauges');
      if (!host) return;
      host.classList.add('ux-week-gauges');
      qa('.mini-gauge-card', host).forEach((card) => {
        const rot = String(q('.label', card)?.textContent || '').trim().toLowerCase();
        let p = 'tertiary', ordem = 6;
        if (rot.includes('cumprido')) { p = 'primary'; ordem = 1; }
        else if (rot === 'faltam' || rot.includes('meta batida')) { p = 'primary'; ordem = 2; }
        else if (rot.includes('por dia') || rot.includes('nada a fazer')) { p = 'primary'; ordem = 3; }
        else if (rot.includes('aproveitamento')) { p = 'secondary'; ordem = 4; }
        else if (rot.includes('estudado')) { ordem = 5; }
        else if (rot.includes('finalizadas')) { ordem = 6; }
        card.dataset.uxPriority = p;
        card.style.order = String(ordem);
      });
    },

    decorateGrade() {
      const s = screenEl('grade'); if (!s) return;
      q('#ciclo-grade', s)?.classList.add('ux-primary-workspace');
      q('#grade-budget', s)?.classList.add('ux-secondary-area');
      q('#grade-chip-tray', s)?.classList.add('ux-supporting-controls');
    },

    decorateStudyNew() {
      const s = screenEl('estudonovo'); if (!s) return;
      q('#en-track-averages', s)?.classList.add('ux-summary-first');
      qa('.track-card', s).forEach(card => {
        q('.track-card-head', card)?.classList.add('ux-card-primary');
        q('.track-stages', card)?.classList.add('ux-card-support');
        q('.track-comment-wrap', card)?.classList.add('ux-card-notes');
      });
      q('#en-view-seg', s)?.classList.add('ux-compact-control');
    },

    configureLawDefaults() {
      if (this._lawDefaultsDone || typeof LeisScreen === 'undefined') return;
      this._lawDefaultsDone = true;
      try {
        const setIfVirgin = (nome, legado, valor) => {
          const k = LeisScreen._prefKey(nome);
          const atual = localStorage.getItem(k);
          const antigo = legado ? localStorage.getItem(legado) : null;
          if (atual === null && antigo === null) LeisScreen._prefSet(nome, valor);
        };
        // Leitura nasce limpa; quem prefere a bancada completa mantém sua escolha salva.
        setIfVirgin('tools-open', 'diario-estudos:leis-tools-open', '0');
        setIfVirgin('p-painel', null, '0');
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ux-hierarchy-law-defaults'); }
    },

    decorateLeis() {
      const s = screenEl('leis'); if (!s) return;
      q('.leis-reader-card', s)?.classList.add('ux-primary-card');
      q('#leis-tools-body', s)?.classList.add('ux-advanced-surface');
      q('#lei-marks-panel', s)?.classList.add('ux-secondary-area');
    },

    decorateCards() {
      const s = screenEl('cards'); if (!s) return;
      // Estatísticas já têm aba própria; o atalho duplicado em “Mais” só aumenta escolha.
      const dupStats = q('#cards-stats-btn', s);
      if (dupStats) { dupStats.hidden = true; dupStats.setAttribute('aria-hidden', 'true'); }
      q('#cards-audit-export-btn', s)?.classList.add('ux-diagnostic-action');
      q('#cards-filter-card', s)?.classList.add('ux-secondary-area');
      q('#cards-content', s)?.classList.add('ux-primary-workspace');
    },

    decorateExtras() {
      const s = screenEl('extras'); if (!s) return;
      q('#extras-summary', s)?.classList.add('ux-summary-first');
      q('#extras-agenda', s)?.classList.add('ux-primary-workspace');
      q('#extras-curso', s)?.classList.add('ux-secondary-area');
      q('#extras-suggest-btn', s)?.classList.add('ux-tertiary-action');
      q('#extras-plano-btn', s)?.classList.add('ux-priority-action');
      qa('.exm-stat', s).forEach((x, i) => x.dataset.uxPriority = i < 2 ? 'primary' : 'secondary');
      qa('.exm-rotation,.exm-load', s).forEach(x => x.classList.add('ux-advanced-surface'));
      qa('.exm-chip[data-exm-view="reforco"],.exm-chip[data-exm-view="manual"],.exm-chip[data-exm-view="plano"]', s)
        .forEach(x => x.classList.add('ux-source-filter'));
    },

    decorateHistory() {
      const s = screenEl('historico'); if (!s) return;
      qa('.week-card', s).forEach(card => {
        card.classList.add('ux-history-card');
        q('.week-stats-row', card)?.classList.add('ux-history-summary');
        q('.week-status-dist', card)?.classList.add('ux-history-support');
      });
    },

    /* ── O PERÍODO DO GRÁFICO É ESCOLHA DE QUEM OLHA ────────────────────────
       Esta camada envolvia `renderDayChart` e reescrevia `tempoStart`/`tempoEnd`
       a CADA repintura, com o intervalo do filtro geral da tela. O efeito era
       o seletor de período do gráfico não funcionar mais: qualquer escolha
       ("última semana", "último mês", um intervalo digitado) era sobrescrita no
       render seguinte, e o campo voltava sozinho para o intervalo inteiro. Duas
       coisas diferentes com o mesmo nome — o filtro recorta QUAIS registros
       entram na tela, o seletor escolhe a JANELA desenhada no gráfico — foram
       forçadas a ser a mesma, e a que o usuário controlava foi a que morreu.

       Nada substitui o método original: o gráfico volta a ler o seu próprio
       estado, que é o único lugar onde a escolha dele existe. */
    syncEvolutionPeriod() {
      if (typeof EvolucaoScreen === 'undefined' || EvolucaoScreen.__uxHierarchyPeriod) return;
      EvolucaoScreen.__uxHierarchyPeriod = true;
    },

    decorateEvolution() {
      const s = screenEl('evolucao'); if (!s) return;
      const content = q('#evolucao-content', s); if (!content) return;
      q('#evolucao-stats', s)?.classList.add('ux-summary-first');
      const keyCards = ['evolucao-day-chart', 'evolucao-acerto-linha', 'evolucao-acerto-materia', 'evolucao-bar-chart', 'evolucao-ritmo'];
      keyCards.forEach(id => document.getElementById(id)?.closest('.card')?.classList.add('ux-primary-analysis'));

      let details = document.getElementById('ux-evo-more');
      if (!details) {
        details = document.createElement('details');
        details.id = 'ux-evo-more';
        details.className = 'ux-more-analysis evo-wide';
        details.innerHTML = '<summary><span><b>Mais análises</b><small>Acumulado, semanas fechadas, TEC, tabela por matéria e modalidades.</small></span><i>▾</i></summary><div class="ux-more-analysis-body"></div>';
        content.appendChild(details);
      }
      const body = q('.ux-more-analysis-body', details);
      ['evolucao-line-chart', 'evolucao-meta-chart', 'evolucao-tec-card', 'evolucao-performance-list', 'evolucao-modality-table'].forEach(id => {
        const el = document.getElementById(id);
        const card = id === 'evolucao-tec-card' ? el : el?.closest('.card');
        if (card && body && card.parentElement !== body) body.appendChild(card);
      });
      const gear = document.getElementById('evo-gear-cards');
      if (gear) { gear.hidden = true; gear.setAttribute('aria-hidden', 'true'); }
      q('.evo-periodo-ctl', s)?.classList.add('ux-redundant-period');
    },

    decorateTec() {
      const s = screenEl('desempenhotec'); if (!s) return;
      // A escolha do motor aparece uma vez, dentro do Plano; o seletor global duplicado some.
      qa('[data-tpm-entry]', s).forEach(x => { x.hidden = true; x.setAttribute('aria-hidden', 'true'); });
      const modos = q('#plano-modos', s), nota = q('#plano-modo-nota', s);
      if (modos) { modos.hidden = true; modos.setAttribute('aria-hidden', 'true'); }
      if (nota) { nota.hidden = true; nota.setAttribute('aria-hidden', 'true'); }
      const oldCfg = q('#tec-panel-plano .tec-cfg-bar', s);
      if (oldCfg) {
        // A folha ainda reúne ajustes analíticos válidos. Mantemos UMA porta compacta,
        // sem devolver à superfície os modos/ordenadores legados de decisão.
        oldCfg.hidden = false;
        oldCfg.removeAttribute('aria-hidden');
        oldCfg.classList.add('ux-analysis-settings');
        const abrirAjustes = q('.tec-cfg-open', oldCfg);
        if (abrirAjustes) {
          abrirAjustes.innerHTML = '<span class="gg-ic">⚙</span>Ajustes da análise';
          abrirAjustes.title = 'Ajustar métricas analíticas sem alterar o motor das sugestões';
        }
      }

      const proj = q('#plano-proj', s);
      if (proj && q('[data-tpm-selector]', proj)) {
        Array.from(proj.children).forEach(ch => {
          if (!ch.matches('[data-tpm-selector]')) ch.classList.add('ux-legacy-projection');
        });
      }
      const out = q('[data-tpm-output]', s);
      if (out) {
        out.classList.add('ux-force-task');
        const titulo = q(':scope > header strong', out);
        if (titulo && /onde atacar agora/i.test(titulo.textContent || '')) titulo.textContent = 'Força-tarefa atual';
        const rankTitle = q('.tpm-ranking > header strong', out);
        if (rankTitle) rankTitle.textContent = 'Ranking completo';
        const rankCopy = q('.tpm-ranking > header p', out);
        if (rankCopy) rankCopy.textContent = 'O TOP 3 é a execução imediata; o restante continua disponível para diagnóstico.';
      }
      const refTab = q('.tec-subtab[data-tectab="reforco"]', s);
      refTab?.classList.add('ux-secondary-tab');
      const motTab = q('.tec-subtab[data-tectab="motores"]', s);
      if (motTab && motTab.textContent !== '⚙ Modelos') motTab.textContent = '⚙ Modelos';
      motTab?.classList.add('ux-secondary-tab');
      q('#tec-panel-motores', s)?.classList.add('ux-advanced-surface');
    },

    /* ── DOIS AGRUPADORES SOBRE A MESMA TELA ────────────────────────────────
       `ConfigUX` (80-ajustes-finais) já divide Configurações em cinco seções
       navegáveis — Estudo, Preferências, Conta e nuvem, Dados e backup,
       Diagnóstico — e MOVE cada cartão para o painel certo. Esta camada, sem
       saber disso, criava um `<details>` "Dados, backup e diagnóstico" e movia
       os mesmos quatro cartões para DENTRO dele, já dentro do painel "Dados".
       Resultado: uma seção dentro da seção, títulos repetidos, e a escala
       tipográfica do `<details>` (`--fs-sm`/`--fs-2xs`) brigando com a dos
       cartões — era daí que vinha a sensação de fonte sem padrão na tela.

       Um agrupador só. Esta camada passa a apenas marcar prioridade, e o
       `<details>` legado que tenha sobrado de uma sessão anterior é desmontado
       devolvendo os cartões ao painel onde `ConfigUX` os colocou. */
    decorateConfig() {
      const s = screenEl('config'); if (!s) return;
      const legado = document.getElementById('ux-config-data');
      if (legado) {
        const destino = legado.parentElement;
        qa('.ux-config-data-body > *', legado).forEach(card => destino && destino.insertBefore(card, legado));
        legado.remove();
      }
      q('#cfg-plano-motores-card', s)?.classList.add('ux-secondary-area');
      q('#cloud-connected-box', s)?.classList.add('ux-secondary-area');
    },

    decorateTools() {
      const s = screenEl('ferramentas'); if (!s) return;
      s.classList.add('ux-auxiliary-screen');
    },

    decorateLinks() { screenEl('links')?.classList.add('ux-auxiliary-screen'); },
    decorateAchievements() { screenEl('conquistas')?.classList.add('ux-auxiliary-screen'); },

    observeCycle() {
      const host = document.getElementById('ciclo-overview-gauges');
      if (!host || host.__uxHierarchyObs) return;
      host.__uxHierarchyObs = true;
      new MutationObserver(() => this.decorateCycleGauges()).observe(host, { childList: true, subtree: true });
    },

    patchRenderers() {
      this.syncEvolutionPeriod();
      this.preserveScroll(window.ExtrasScreen, 'render', 'extras');
      this.preserveScroll(window.HistoricoScreen, 'render', 'historico');
      this.preserveScroll(window.EvolucaoScreen, 'render', 'evolucao');
      this.preserveScroll(window.DesempenhoTecScreen, 'render', 'desempenhotec');

      this.after(window.ExtrasScreen, 'render', () => this.decorateExtras());
      this.after(window.HistoricoScreen, 'render', () => this.decorateHistory());
      this.after(window.EvolucaoScreen, 'render', () => this.decorateEvolution());
      this.after(window.DesempenhoTecScreen, 'render', () => this.decorateTec());
      this.after(window.DesempenhoTecScreen, '_pintarPlano', () => this.decorateTec());
      this.after(window.EstudoNovoScreen, 'renderTrack', () => this.decorateStudyNew());
      this.after(window.CardsScreen, 'renderContent', () => this.decorateCards());
      this.after(window.LeisScreen, 'openReader', () => this.decorateLeis());
      this.after(window.LeisScreen, 'renderCards', () => this.decorateLeis());
      this.after(window.ConfigScreen, 'render', () => this.decorateConfig());
      this.after(window.GradeScreen, 'render', () => this.decorateGrade());
    },

    onScreen(nome) {
      this.rewriteCopy();
      const map = {
        registrar: 'decorateRegistrar', ciclo: 'decorateCycle', grade: 'decorateGrade', estudonovo: 'decorateStudyNew',
        leis: 'decorateLeis', cards: 'decorateCards', extras: 'decorateExtras', historico: 'decorateHistory',
        evolucao: 'decorateEvolution', desempenhotec: 'decorateTec', config: 'decorateConfig',
        ferramentas: 'decorateTools', links: 'decorateLinks', conquistas: 'decorateAchievements'
      };
      const fn = map[nome]; if (fn && typeof this[fn] === 'function') this[fn]();
    },

    applyAll() {
      this.rewriteCopy();
      this.configureLawDefaults();
      this.decorateRegistrar(); this.decorateCycle(); this.decorateGrade(); this.decorateStudyNew(); this.decorateLeis();
      this.decorateCards(); this.decorateExtras(); this.decorateHistory(); this.decorateEvolution(); this.decorateTec();
      this.decorateConfig(); this.decorateTools(); this.decorateLinks(); this.decorateAchievements(); this.observeCycle();
    },

    init() {
      document.documentElement.classList.add('ux-hierarchy-ready');
      this.setupScrollMemory();
      this.setupInstantFeedback();
      this.patchRenderers();
      this.applyAll();
      // Alguns módulos injetam controles no DOM depois da inicialização; uma passada tardia
      // consolida a hierarquia sem observar a árvore inteira e sem custo permanente.
      setTimeout(() => { this.patchRenderers(); this.applyAll(); }, 120);
    }
  };

  window.UXHierarchy = U;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => U.init(), { once: true });
  else U.init();
})();
