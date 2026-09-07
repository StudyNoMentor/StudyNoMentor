/* ============================================================================
   SESSION GUARD — login único REAL entre dispositivos (via Supabase)
   ----------------------------------------------------------------------------
   Cada aparelho tem um device_id fixo. Ao logar (ou ao clicar em "Continuar
   neste aparelho"), este device "reivindica" a conta gravando seu id na tabela
   `active_sessions` (uma linha por usuário). Um canal Realtime avisa todos os
   aparelhos: quem vê um device_id diferente do seu entende que outro assumiu,
   é BLOQUEADO e tem a sincronização PAUSADA (para não sobrescrever dados).

   Requer no Supabase (execute uma vez — SQL fornecido no relatório):
     create table public.active_sessions (
       user_id uuid primary key references auth.users(id) on delete cascade,
       device_id text not null, device_label text, updated_at timestamptz default now());
     alter table public.active_sessions enable row level security;
     create policy "own_select" on public.active_sessions for select using (auth.uid()=user_id);
     create policy "own_insert" on public.active_sessions for insert with check (auth.uid()=user_id);
     create policy "own_update" on public.active_sessions for update using (auth.uid()=user_id);
     alter publication supabase_realtime add table public.active_sessions;

   Se a tabela ainda NÃO existir, o guard se desativa sozinho, sem quebrar o app
   (o bloqueio local por aba continua funcionando).
   ============================================================================ */
const SessionGuard = {
  TABLE: 'active_sessions',
  DEVICE_KEY: 'diario-estudos:device-id',
  enabled: true,        // vira false se a tabela não existir
  channel: null,
  _deviceId: null,
  _claimedUid: null,    // uid para o qual já reivindicamos nesta carga de página
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
  // Rótulo legível do aparelho (aparece no aviso do outro dispositivo).
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
      // aparelhos Apple sem navegador específico identificado usam Safari
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
      console.info('[SessionGuard] tabela active_sessions ausente — login único entre dispositivos desligado. Rode o SQL do relatório para ativar. Detalhe:', err && (err.message || err));
    }
  },

  // Chamado pelo CloudStore quando há sessão (login ou sessão restaurada).
  async onLogin() {
    if (!this.enabled) return;
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) return;
    const uid = CS.session.user.id;
    this.subscribe(uid);
    // reivindica só uma vez por carga/uid (evita re-claim a cada evento de auth)
    if (this._claimedUid !== uid) { this._claimedUid = uid; await this.claim(uid); }
  },
  onLogout() {
    this._claimedUid = null;
    this._unsub();
    if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
  },

  // Grava este device como o dono ativo da conta (derruba os demais).
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

  // Verifica quem é o dono atual (na entrada, antes mesmo do primeiro evento realtime).
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
    if (!this.enabled || this.channel) return;
    const CS = window.CloudStore;
    if (!CS || !CS.isReady()) return;
    try {
      this.channel = CS.client.channel('sess_guard')
        .on('postgres_changes', { event: '*', schema: 'public', table: this.TABLE, filter: 'user_id=eq.' + uid }, (p) => {
          const row = p.new || p.old || {};
          if (!row.device_id) return;
          if (row.device_id !== this.deviceId()) this._takenBy(row);
          else if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
          // se a tela de Configurações estiver aberta, reflete a mudança na hora
          try { const cfg = document.getElementById('screen-config'); if (cfg && cfg.classList.contains('active') && window.CloudUI) CloudUI.renderSessions(); } catch (_) { _quiet(_); }
        })
        .subscribe((status) => { if (status === 'SUBSCRIBED') this.check(uid); });
    } catch (e) { console.warn('[SessionGuard] realtime indisponível', e); }
  },
  _unsub() {
    if (this.channel) { try { window.CloudStore.client.removeChannel(this.channel); } catch (_) { _quiet(_); } this.channel = null; }
  },

  // Outro aparelho assumiu: bloqueia e pausa a sincronização aqui.
  _takenBy(row) {
    if (window.SessionLock) SessionLock.block('remote', { label: row.device_label });
    // interrompe qualquer envio pendente para não sobrescrever o outro aparelho
    try { const CS = window.CloudStore; if (CS) { clearTimeout(CS._debounce); CS._debounce = null; CS._pending = false; } } catch (_) { _quiet(_); }
    if (window.CloudUI) CloudUI.refreshSyncBtn();
  },

  // ---- Usado pela tela de Configurações ----
  // status: 'ok' (leu a linha), 'empty' (sem sessão registrada), 'disabled'
  // (tabela ausente/guard desligado), 'offline' (sem conexão/login), 'error'.
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
  // Encerra a sessão do outro aparelho trazendo a posse para ESTE (reivindica).
  // O outro aparelho recebe o evento em tempo real e é bloqueado.
  async endRemoteAndClaimHere() {
    const ok = await this.claim();
    if (ok && window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
    if (window.CloudUI) CloudUI.refreshSyncBtn();
    return ok;
  }
};
window.SessionGuard = SessionGuard;
// "Continuar neste aparelho" (no overlay remoto) → reivindica de volta a posse.
if (window.SessionLock) SessionLock.onTakeover(async (origin) => {
  if (origin !== 'remote') return;
  const ok = await SessionGuard.claim();
  if (ok) { showToast('Sessão retomada neste aparelho ✓'); if (window.CloudUI) CloudUI.refreshSyncBtn(); }
  else { showToast('Não foi possível retomar agora — verifique a internet'); SessionLock.block('remote', {}); }
});
