/* ============================================================================
   UX STABILITY V3
   Corrige densidade, semântica e interações de Extras/Leis/TEC sem duplicar
   motores de negócio. Tudo aqui é uma camada tardia e reversível de apresentação.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__uxStability) return;
  window.__uxStability = true;
  if (typeof document === 'undefined') return;

  const later = (fn) => requestAnimationFrame(() => requestAnimationFrame(() => { try { fn(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ux-v3'); } }));

  const UX = {
    _infoPop: null,
    _cloudUserAt: 0,
    _tecFirstOpen: true,

    /* ── Informações: um único comportamento para .info-dot e .xsc-info ─── */
    infoText(el) {
      if (!el) return '';
      return String(el._info || el.getAttribute('data-info') || el.getAttribute('title') || '').trim();
    },
    closeInfo() {
      if (this._infoPop) { this._infoPop.remove(); this._infoPop = null; }
    },
    openInfo(el) {
      const txt = this.infoText(el); if (!txt) return;
      this.closeInfo();
      const p = document.createElement('div');
      p.className = 'uxv3-info-pop'; p.setAttribute('role', 'tooltip'); p.textContent = txt;
      document.body.appendChild(p); this._infoPop = p;
      const r = el.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
      let left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 8);
      p.style.left = left + 'px'; p.style.top = top + 'px';
      requestAnimationFrame(() => p.classList.add('open'));
    },
    bindInfo() {
      document.addEventListener('click', (e) => {
        const el = e.target && e.target.closest ? e.target.closest('.xsc-info,.info-dot') : null;
        if (!el) { if (this._infoPop && !this._infoPop.contains(e.target)) this.closeInfo(); return; }
        if (!this.infoText(el)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        if (this._infoPop && this._infoPop.dataset.forId === (el.id || el.dataset.uxv3InfoId || '')) { this.closeInfo(); return; }
        if (!el.id && !el.dataset.uxv3InfoId) el.dataset.uxv3InfoId = 'i' + Math.random().toString(36).slice(2);
        this.openInfo(el);
        if (this._infoPop) this._infoPop.dataset.forId = el.id || el.dataset.uxv3InfoId;
      }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeInfo(); }, true);
      window.addEventListener('scroll', () => this.closeInfo(), true);
      window.addEventListener('resize', () => this.closeInfo());
    },

    /* ── Leis: deixa claro o que o rodízio realmente faz ─────────────────── */
    decorateLawList() {
      if (typeof LeiRodizio === 'undefined') return;
      document.querySelectorAll('#screen-leis .lr-law-wrap').forEach(holder => {
        const card = holder.querySelector('.lei-card'); if (!card) return;
        const lei = typeof DB !== 'undefined' && DB.getLei ? DB.getLei(card.dataset.id) : null; if (!lei) return;
        const cfg = LeiRodizio.cfgLei(lei), p = LeiRodizio.prefs(), linha = LeiRodizio._bookmark(lei);
        const input = holder.querySelector('[data-lr-law-on]');
        const label = holder.querySelector('.lr-switch');
        const next = holder.querySelector('.lr-law-next');
        const on = input ? !!input.checked : !!cfg.apta;
        holder.classList.toggle('uxv3-law-in', on); holder.classList.toggle('uxv3-law-out', !on);
        if (label) {
          label.classList.add('uxv3-rotation-toggle');
          const span = label.querySelector('span');
          if (span) span.innerHTML = on
            ? '<span class="uxv3-rotation-state"><b>Incluída nos Extras automáticos</b><small>Pode gerar a leitura do dia pelo rodízio.</small></span>'
            : '<span class="uxv3-rotation-state"><b>Fora dos Extras automáticos</b><small>Continua disponível para leitura manual, sem entrar no rodízio.</small></span>';
          if (input) input.setAttribute('aria-label', on ? 'Remover esta lei do rodízio automático' : 'Incluir esta lei no rodízio automático');
        }
        if (next) {
          next.classList.add('uxv3-next-read');
          next.innerHTML = `<span>Próxima leitura</span><b>Linha ${Number(linha) || 1}</b><small>${Number(cfg.linhasSessao || p.linhasSessao) || 30} linhas por sessão</small>`;
        }
        const adj = holder.querySelector('[data-lr-law-cfg]'); if (adj) { adj.textContent = '⚙ Ajustar'; adj.title = 'Ajustar carga, prioridade e comportamento desta lei'; }
      });
    },
    patchLawRender() {
      if (typeof LeisScreen === 'undefined' || LeisScreen._uxv3LawPatched || typeof LeisScreen.renderCards !== 'function') return;
      LeisScreen._uxv3LawPatched = true;
      const orig = LeisScreen.renderCards;
      LeisScreen.renderCards = function () {
        const r = orig.apply(this, arguments); later(() => UX.decorateLawList()); return r;
      };
    },

    /* ── Extras: barra de controle + chips de Lei Seca sem redundância ───── */
    decorateExtrasToolbar() {
      const bar = document.querySelector('#screen-extras .extras-toolbar'); if (!bar) return;
      bar.classList.add('uxv3-toolbar');
      const global = bar.querySelector('.extras-global');
      if (global) {
        const copy = global.querySelector('span');
        if (copy) copy.textContent = 'Contar Extras marcadas na Evolução';
      }
      let actions = bar.querySelector('.uxv3-toolbar-actions');
      if (!actions) {
        const head = bar.querySelector('.ux100-config-head');
        const movers = [...bar.children].filter(x => x !== head && x !== global);
        actions = document.createElement('div'); actions.className = 'uxv3-toolbar-actions'; bar.appendChild(actions);
        movers.forEach(x => actions.appendChild(x));
      }
    },
    decorateLawCards() {
      if (typeof LeiRodizio === 'undefined') return;
      document.querySelectorAll('#extras-list .lr-extra-card').forEach(card => {
        const extra = typeof DB !== 'undefined' && DB.getExtra ? DB.getExtra(card.dataset.id) : null;
        if (!extra || !LeiRodizio.eExtra(extra)) return;
        const tags = card.querySelector('.exd-tags');
        if (tags) {
          [...tags.querySelectorAll('.extra-tag')].forEach(t => {
            const s = (t.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (s === 'lei seca' || s.includes('rodízio lei seca') || (t.classList.contains('exm-status') && s === 'hoje')) t.remove();
          });
          if (!tags.querySelector('.uxv3-law-kind')) {
            const tag = document.createElement('span'); tag.className = 'extra-tag uxv3-law-kind'; tag.textContent = 'Lei seca';
            tags.prepend(tag);
          }
        }
        const meta = card.querySelector('.exm-card-meta');
        if (meta) meta.innerHTML = 'Rodízio automático <span>·</span> execução de hoje';
      });
    },

    /* Próximas fica fechada no overview; ao filtrar “Planejadas”, abre normal. */
    patchUpcoming() {
      const EM = window.ExtrasModern;
      if (!EM || EM._uxv3Upcoming || typeof EM.secao !== 'function') return;
      EM._uxv3Upcoming = true;
      const orig = EM.secao;
      EM.secao = function (k, titulo, ico, arr, screen) {
        if (k !== 'proximas' || this.view === 'proximas' || !arr.length) return orig.apply(this, arguments);
        const fatia = this.fatiar(k, arr);
        const cards = this.cardsPorDisciplina(fatia.itens, screen);
        const mais = fatia.faltam ? `<div class="exm-more-row"><span>Mostrando ${fatia.itens.length} de ${arr.length}</span><button type="button" class="btn-secondary" data-exm-more="${k}">Mostrar mais ${Math.min(this.passoMais, fatia.faltam)}</button></div>` : '';
        return `<details class="exm-section exm-section-${k}"><summary><span class="exm-section-title">${ico} ${titulo}</span><span class="exm-section-count">${arr.length}</span><span class="chev">⌄</span></summary><div class="exm-section-body">${cards}${mais}</div></details>`;
      };
    },

    /* Recolher o card não recalcula TEC/Plano. Reabre do DOM já pronto. */
    bindFastCourseToggle() {
      document.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('#exc-toggle') : null; if (!btn) return;
        const card = btn.closest('.exc-card'); if (!card) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const aberto = btn.getAttribute('aria-expanded') === 'true';
        if (typeof ExtrasScreen !== 'undefined') ExtrasScreen._cursoAberto = aberto ? false : true;
        if (aberto) {
          card.classList.add('uxv3-collapsed'); btn.setAttribute('aria-expanded', 'false');
          const ch = btn.querySelector('.chev'); if (ch) ch.textContent = '▾';
          return;
        }
        const temCorpo = !!card.querySelector('.exc-grupo');
        if (temCorpo) {
          card.classList.remove('uxv3-collapsed'); btn.setAttribute('aria-expanded', 'true');
          const ch = btn.querySelector('.chev'); if (ch) ch.textContent = '▴';
        } else if (typeof ExtrasScreen !== 'undefined' && typeof ExtrasScreen.renderEmCurso === 'function') {
          requestAnimationFrame(() => { ExtrasScreen.renderEmCurso(); later(() => UX.decorateCourse()); });
        }
      }, true);
    },
    decorateCourse() {
      const card = document.querySelector('#extras-curso .exc-card'); if (!card) return;
      card.classList.add('uxv3-course-card');
      if (typeof ExtrasScreen !== 'undefined' && ExtrasScreen._cursoAberto === false) card.classList.add('uxv3-collapsed');
      const head = card.querySelector('.exc-head'); if (head) head.title = 'Expandir ou recolher sem recalcular o Plano';
      card.querySelectorAll('[data-curso-dia]').forEach(b => { b.textContent = 'Fazer hoje'; b.title = 'Trazer esta missão para a execução de hoje'; });
      card.querySelectorAll('[data-curso-fim]').forEach(b => { if ((b.textContent || '').trim() === 'Concluir') b.textContent = 'Encerrar'; });
    },
    patchExtrasRender() {
      if (typeof ExtrasScreen === 'undefined' || ExtrasScreen._uxv3RenderPatched || typeof ExtrasScreen.render !== 'function') return;
      ExtrasScreen._uxv3RenderPatched = true;
      const orig = ExtrasScreen.render;
      ExtrasScreen.render = function () {
        const r = orig.apply(this, arguments);
        later(() => { UX.decorateExtrasToolbar(); UX.decorateLawCards(); UX.decorateCourse(); });
        return r;
      };
    },

    /* ── TEC: sempre inicia com o escopo recolhido nesta carga ───────────── */
    collapseTecScopeOnce() {
      if (!this._tecFirstOpen) return;
      const screen = document.getElementById('screen-desempenhotec');
      if (!screen || !screen.classList.contains('active')) return;
      this._tecFirstOpen = false;
      try {
        if (window.PainelRecolhivel && PainelRecolhivel._registro && PainelRecolhivel._registro['tec-escopo']) {
          PainelRecolhivel.aplicar('tec-escopo', true, false);
        } else {
          const body = document.getElementById('tec-scope-body'), btn = document.getElementById('tec-scope-collapse');
          if (body) body.hidden = true; if (btn) btn.setAttribute('aria-expanded', 'false');
        }
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-scope-v3'); }
    },
    decorateTec() {
      const screen = document.getElementById('screen-desempenhotec'); if (!screen) return;
      const cmd = screen.querySelector('.tp-command'); if (cmd) cmd.classList.add('uxv3-tec-command');
      screen.querySelectorAll('[class*="loading"],[class*="spinner"]').forEach(el => {
        const c = (el.className || '').toString(); if (/spinner|loading-spin/i.test(c)) el.classList.add('tec-loading-spinner');
      });
    },

    /* ── Nuvem: falha silenciosa de renovação não abre menu de login sozinha ─ */
    stabilizeCloudMenu() {
      const btn = document.getElementById('cloud-sync-btn');
      if (btn && !btn._uxv3UserTrack) {
        btn._uxv3UserTrack = true;
        btn.addEventListener('pointerdown', () => { this._cloudUserAt = Date.now(); }, true);
        btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') this._cloudUserAt = Date.now(); }, true);
      }
      if (document.body._uxv3CloudObserver) return;
      document.body._uxv3CloudObserver = new MutationObserver(muts => {
        for (const m of muts) for (const n of (m.addedNodes || [])) {
          if (!n || n.nodeType !== 1) continue;
          const menu = n.matches && n.matches('.cloud-menu') ? n : (n.querySelector && n.querySelector('.cloud-menu'));
          if (!menu) continue;
          /* Se a pessoa NÃO abriu o menu, ele veio da retentativa automática de
             sessão. Deixamos o botão indicar o estado, mas não interrompemos a tela
             de estudo com formulário de senha. */
          if (Date.now() - this._cloudUserAt > 1500) {
            const scrim = document.querySelector('.cloud-scrim');
            if (scrim) setTimeout(() => { try { scrim.click(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'cloud-menu-v3'); } }, 0);
          }
        }
      });
      document.body._uxv3CloudObserver.observe(document.body, { childList:true, subtree:false });
    },

    /* Gate “Entrando”: nunca fica com mensagem estática parecendo congelada. */
    watchGateEntering() {
      const box = document.getElementById('gate-entering'); if (!box || box._uxv3Watch) return;
      box._uxv3Watch = true;
      let timer = null;
      const arm = () => {
        clearTimeout(timer);
        if (getComputedStyle(box).display === 'none') return;
        const sub = box.querySelector('.gate-entering-sub');
        timer = setTimeout(() => {
          if (getComputedStyle(box).display === 'none') return;
          if (sub) sub.textContent = 'Sincronizando seu perfil com segurança…';
        }, 2800);
      };
      new MutationObserver(arm).observe(box, { attributes:true, attributeFilter:['style','class'] }); arm();
    },

    init() {
      this.bindInfo();
      this.patchUpcoming();
      this.patchLawRender();
      this.patchExtrasRender();
      this.bindFastCourseToggle();
      this.stabilizeCloudMenu();
      this.watchGateEntering();
      later(() => { this.decorateLawList(); this.decorateExtrasToolbar(); this.decorateLawCards(); this.decorateCourse(); this.decorateTec(); this.collapseTecScopeOnce(); });
      window.addEventListener('screen:activated', (e) => {
        const s = e.detail && e.detail.screen;
        if (s === 'leis') later(() => this.decorateLawList());
        if (s === 'extras') later(() => { this.decorateExtrasToolbar(); this.decorateLawCards(); this.decorateCourse(); });
        if (s === 'desempenhotec') later(() => { this.collapseTecScopeOnce(); this.decorateTec(); });
        if (s === 'conquistas') later(() => document.querySelectorAll('#screen-conquistas [class*="spinner"],#screen-conquistas [class*="loading"]').forEach(x => x.classList.add('conq-spinner')));
      });
    }
  };

  UX.init();
  window.UX = UX;
})();