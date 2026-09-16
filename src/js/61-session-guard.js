/* ============================================================================
   SESSION GUARD — login único REAL entre dispositivos (via Supabase)
   ----------------------------------------------------------------------------
   Cada aparelho tem um device_id fixo. Ao logar (ou ao clicar em "Continuar
   neste aparelho"), este device "reivindica" a conta gravando seu id na tabela
   `active_sessions` (uma linha por usuário). Um canal Realtime avisa todos os
   aparelhos: quem vê um device_id diferente do seu entende que outro assumiu,
   é BLOQUEADO e tem a sincronização PAUSADA (para não sobrescrever dados).

   A restauração automática de uma sessão não deve roubar a posse de outro
   aparelho: a camada de startup verifica o dono primeiro. Login digitado ou a
   ação explícita "Continuar neste aparelho" podem reivindicar a conta.
   ============================================================================ */
const SessionGuard = {
  TABLE: 'active_sessions',
  DEVICE_KEY: 'diario-estudos:device-id',
  enabled: true,
  channel: null,
  _subscribedUid: null,
  _deviceId: null,
  _claimedUid: null,
  _avisouSemTabela: false,

  deviceId() {
    if (this._deviceId) return this._deviceId;
    let id = null;
    try { id = localStorage.getItem(this.DEVICE_KEY); } catch (_) { _quiet(_); }
    if (!id) {
      id = (window.DB && DB._uid) ? DB._uid() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      try { localStorage.setItem(this.DEVICE_KEY, id); } catch (_) { _quiet(_); }
    }
    this._deviceId = id;
    return id;
  },
  deviceLabel() {
    try {
      const ua = navigator.userAgent || '';
      let so = 'Dispositivo';
      if (/Android/i.test(ua)) so = 'Android';
      else if (/iPhone|iPad|iPod/i.test(ua)) so = 'iPhone/iPad';
      else if (/Windows/i.test(ua)) so = 'Windows';
      else if (/Mac/i.test(ua)) so = 'Mac';
      else if (/Linux/i.test(ua)) so = 'Linux';
      let nav = 'navegador';
      if (/Edg\//i.test(ua)) nav = 'Edge';
      else if (/CriOS/i.test(ua)) nav = 'Chrome';
      else if (/FxiOS|Firefox\//i.test(ua)) nav = 'Firefox';
      else if (/Chrome\//i.test(ua)) nav = 'Chrome';
      else if (/Safari\//i.test(ua)) nav = 'Safari';
      if (nav === 'navegador' && (so === 'iPhone/iPad' || so === 'Mac')) nav = 'Safari';
      return so + ' · ' + nav;
    } catch (_) { return 'Dispositivo'; }
  },
  _isMissingTable(err) {
    const m = ((err && (err.message || err.code || err.details)) || '').toString().toLowerCase();
    return m.includes('active_sessions') || m.includes('does not exist') || m.includes('42p01') ||
           m.includes('could not find the table') || m.includes('schema cache');
  },
  _disable(err) {
    this.enabled = false;
    this._unsub();
    if (!this._avisouSemTabela) {
      this._avisouSemTabela = true;
      console.info('[SessionGuard] tabela active_sessions ausente — login único entre dispositivos desligado.', err && (err.message || err));
    }
  },

  // Mantido como fallback. A camada de estabilidade substitui este método por
  // check-before-claim no startup; ações explícitas continuam usando claim().
  async onLogin() {
    if (!this.enabled) return;
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) return;
    const uid = CS.session.user.id;
    this.subscribe(uid);
    if (this._claimedUid !== uid) { this._claimedUid = uid; await this.claim(uid); }
  },
  onLogout() {
    this._claimedUid = null;
    this._unsub();
    if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
  },

  async claim(uid) {
    if (!this.enabled) return false;
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) return false;
    uid = uid || CS.session.user.id;
    try {
      const { error } = await CS.client.from(this.TABLE)
        .upsert({ user_id: uid, device_id: this.deviceId(), device_label: this.deviceLabel(), updated_at: new Date().toISOString() },
                { onConflict: 'user_id' });
      if (error) { if (this._isMissingTable(error)) this._disable(error); else console.warn('[SessionGuard] claim falhou', error); return false; }
      return true;
    } catch (err) { if (this._isMissingTable(err)) this._disable(err); else console.warn('[SessionGuard] claim erro', err); return false; }
  },

  async check(uid) {
    if (!this.enabled) return;
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) return;
    uid = uid || CS.session.user.id;
    try {
      const { data, error } = await CS.client.from(this.TABLE).select('device_id,device_label').eq('user_id', uid).maybeSingle();
      if (error) { if (this._isMissingTable(error)) this._disable(error); return; }
      if (data && data.device_id && data.device_id !== this.deviceId()) {
        this._takenBy({ device_id: data.device_id, device_label: data.device_label });
      }
    } catch (err) { if (this._isMissingTable(err)) this._disable(err); }
  },

  subscribe(uid) {
    if (!this.enabled) return;
    const CS = window.CloudStore;
    if (!CS || !CS.isReady()) return;
    uid = String(uid || '');
    if (!uid) return;

    // Um canal só pode representar UM usuário. Antes, trocar diretamente de
    // conta mantinha `this.channel` vivo e o `return` abaixo fazia o novo login
    // continuar ouvindo o filtro da conta anterior.
    if (this.channel && this._subscribedUid === uid) return;
    if (this.channel) this._unsub();
    this._subscribedUid = uid;
    try {
      this.channel = CS.client.channel('sess_guard_' + uid.slice(0, 8))
        .on('postgres_changes', { event: '*', schema: 'public', table: this.TABLE, filter: 'user_id=eq.' + uid }, (p) => {
          if (this._subscribedUid !== uid) return; // callback atrasado da conta anterior
          const row = p.new || p.old || {};
          if (!row.device_id) return;
          if (row.device_id !== this.deviceId()) this._takenBy(row);
          else if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
          try { const cfg = document.getElementById('screen-config'); if (cfg && cfg.classList.contains('active') && window.CloudUI) CloudUI.renderSessions(); } catch (_) { _quiet(_); }
        })
        .subscribe((status) => { if (status === 'SUBSCRIBED' && this._subscribedUid === uid) this.check(uid); });
    } catch (e) {
      this.channel = null;
      this._subscribedUid = null;
      console.warn('[SessionGuard] realtime indisponível', e);
    }
  },
  _unsub() {
    if (this.channel) { try { window.CloudStore.client.removeChannel(this.channel); } catch (_) { _quiet(_); } }
    this.channel = null;
    this._subscribedUid = null;
  },

  _takenBy(row) {
    if (window.SessionLock) SessionLock.block('remote', { label: row.device_label });
    try { const CS = window.CloudStore; if (CS) { clearTimeout(CS._debounce); CS._debounce = null; } } catch (_) { _quiet(_); }
    if (window.CloudUI) CloudUI.refreshSyncBtn();
  },

  async fetchActive() {
    if (!this.enabled) return { status: 'disabled' };
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) return { status: 'offline' };
    try {
      const { data, error } = await CS.client.from(this.TABLE)
        .select('device_id,device_label,updated_at').eq('user_id', CS.session.user.id).maybeSingle();
      if (error) { if (this._isMissingTable(error)) { this._disable(error); return { status: 'disabled' }; } return { status: 'error', message: error.message }; }
      if (!data || !data.device_id) return { status: 'empty' };
      return {
        status: 'ok',
        row: data,
        isThisDevice: data.device_id === this.deviceId(),
        thisDeviceId: this.deviceId(),
        thisLabel: this.deviceLabel()
      };
    } catch (err) { if (this._isMissingTable(err)) { this._disable(err); return { status: 'disabled' }; } return { status: 'error', message: err && err.message }; }
  },
  async endRemoteAndClaimHere() {
    const ok = await this.claim();
    if (ok && window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
    if (window.CloudUI) CloudUI.refreshSyncBtn();
    return ok;
  }
};
window.SessionGuard = SessionGuard;
if (window.SessionLock) SessionLock.onTakeover(async (origin) => {
  if (origin !== 'remote') return;
  const ok = await SessionGuard.claim();
  if (ok) { showToast('Sessão retomada neste aparelho ✓'); if (window.CloudUI) CloudUI.refreshSyncBtn(); }
  else { showToast('Não foi possível retomar agora — verifique a internet'); SessionLock.block('remote', {}); }
});
