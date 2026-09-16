/* ============================================================================
   CONSISTÊNCIA VISUAL + PERSISTÊNCIA DO WORKSPACE TEC
   ----------------------------------------------------------------------------
   O StudyNoMentor é uma SPA. O iframe do TEC não deve ser destruído/reiniciado
   quando o usuário troca de tela: ele fica "estacionado" fora da viewport,
   preservando o browsing context, a rota interna e o caderno aberto.

   Esta camada NÃO altera src do iframe. A abertura/reload continuam pertencendo
   a TecIntegracaoScreen; aqui apenas controlamos visibilidade/acessibilidade.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecWorkspaceKeepalive) return;
  window.__tecWorkspaceKeepalive = true;

  const K = {
    _bound: false,
    _frameBound: false,
    screen() { return document.getElementById('screen-integracaotec'); },
    frame() { return document.getElementById('tec-workspace-frame'); },
    placeholder() { return document.getElementById('tec-workspace-placeholder'); },

    stats() {
      if (!window.__tecWorkspaceKeepaliveStats) {
        window.__tecWorkspaceKeepaliveStats = { loads: 0, lastLoadAt: null, parked: false };
      }
      return window.__tecWorkspaceKeepaliveStats;
    },

    observeFrame() {
      const frame = this.frame();
      if (!frame || this._frameBound || frame.dataset.tecKeepaliveObserved === '1') return;
      this._frameBound = true;
      frame.dataset.tecKeepaliveObserved = '1';
      frame.addEventListener('load', () => {
        const st = this.stats();
        st.loads += 1;
        st.lastLoadAt = new Date().toISOString();
      });
    },

    apply(active) {
      const screen = this.screen();
      if (!screen) return;
      screen.classList.add('tec-workspace-keepalive');
      screen.classList.toggle('tec-screen-parked', !active);

      const st = this.stats();
      st.parked = !active;

      /* Um screen estacionado não deve participar da árvore de foco/leitura,
         embora seu iframe continue vivo fora da viewport. */
      if (active) {
        screen.removeAttribute('aria-hidden');
        screen.removeAttribute('inert');
      } else {
        screen.setAttribute('aria-hidden', 'true');
        screen.setAttribute('inert', '');
      }

      /* Se o iframe já tem uma URL, voltamos a mostrar EXATAMENTE a mesma
         instância. Nunca reatribuímos src aqui: reatribuir, mesmo para a mesma
         URL, é navegação e faria o TEC perder o caderno corrente. */
      const frame = this.frame();
      if (active && frame && frame.getAttribute('src')) {
        frame.hidden = false;
        const placeholder = this.placeholder();
        if (placeholder) placeholder.hidden = true;
        screen.classList.add('tec-workspace-open');
      }
    },

    init() {
      if (this._bound) return;
      const screen = this.screen();
      if (!screen) return;
      this._bound = true;
      this.observeFrame();
      this.apply(screen.classList.contains('active'));

      window.addEventListener('screen:activated', (ev) => {
        const name = ev && ev.detail && ev.detail.screen;
        this.apply(name === 'integracaotec');
      });
    }
  };

  window.TecWorkspaceKeepalive = K;
  K.init();
})();
