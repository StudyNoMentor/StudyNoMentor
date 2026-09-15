/* ============================================================
   INTEGRAÇÃO TEC — módulo isolado do novo projeto
   ============================================================ */
const TecIntegracaoScreen = {
  STORAGE_SUFFIX: 'tec-integracao:estado-v1',
  _key() {
    try { return DB._profilePrefix() + this.STORAGE_SUFFIX; }
    catch (_) { return 'diario-estudos:' + this.STORAGE_SUFFIX; }
  },
  state() {
    try {
      const raw = localStorage.getItem(this._key());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : { status: 'waiting', metrics: {} };
    } catch (_) { return { status: 'waiting', metrics: {} }; }
  },
  save(next) {
    try { localStorage.setItem(this._key(), JSON.stringify(next)); }
    catch (e) { _quiet(e, 'tec-integracao-save'); }
  },
  render() {
    const root = document.getElementById('screen-integracaotec');
    if (!root) return;
    const state = this.state();
    const metrics = state.metrics || {};
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value || 0); };
    set('tec-connect-questions', metrics.questions);
    set('tec-connect-errors', metrics.errors);
    set('tec-connect-books', metrics.books);
    set('tec-connect-pending', metrics.pending);
    const empty = document.getElementById('tec-connect-empty');
    if (empty) empty.hidden = Number(metrics.questions || 0) > 0;
  },
  bind() {
    const start = document.getElementById('tec-connect-start');
    const refresh = document.getElementById('tec-connect-refresh');
    if (start && !start.dataset.bound) {
      start.dataset.bound = '1';
      start.addEventListener('click', () => {
        const msg = document.getElementById('tec-connect-message');
        if (msg) msg.textContent = 'A tela está pronta. A próxima etapa criará o código de vinculação e a entrada segura no banco.';
        showToast('🔌 Módulo da Integração TEC preparado');
      });
    }
    if (refresh && !refresh.dataset.bound) {
      refresh.dataset.bound = '1';
      refresh.addEventListener('click', () => { this.render(); showToast('Estado da integração atualizado'); });
    }
  },
  init() { this.bind(); this.render(); }
};
window.TecIntegracaoScreen = TecIntegracaoScreen;
window.addEventListener('screen:activated', e => {
  if (e.detail && e.detail.screen === 'integracaotec') TecIntegracaoScreen.init();
});
