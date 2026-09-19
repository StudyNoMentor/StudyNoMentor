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
  _claimedUid: null,    // uid cuja posse foi confirmada neste aparelho
  _accessUid: null,
  _accessState: 'unknown', // unknown | checking | allowed | blocked | error | disabled
  _loginPromise: null,
  _loginPromiseUid: null,
  _avisouSemTabela: false,

  accessState() {
    const CS = window.CloudStore;
    const uid = CS && CS.session && CS.session.user ? CS.session.user.id : null;
    if (!this.enabled) return 'disabled';
    if (!uid || this._accessUid !== uid) return 'unknown';
    return this._accessState || 'unknown';
  },
  canEnterNow() {
    const s = this.accessState();
    return s === 'allowed' || s === 'disabled';
  },
  isBlockedByRemote() {
    return this.accessState() === 'blocked' ||
      !!(window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote');
  },

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
    this._accessState = 'disabled';
    this._loginPromise = null;
    this._loginPromiseUid = null;
    this._unsub();
    if (!this._avisouSemTabela) {
      this._avisouSemTabela = true;
      console.info('[SessionGuard] tabela active_sessions ausente — login único entre dispositivos desligado. Rode o SQL do relatório para ativar. Detalhe:', err && (err.message || err));
    }
  },

  // Chamado pelo CloudStore quando há sessão (login ou sessão restaurada).
  // Esta PROMISE é também a barreira de entrada: perfil nenhum deve ser exibido
  // ou hidratado enquanto a posse da sessão ainda estiver indefinida.
  async onLogin() {
    if (!this.enabled) return { ok: true, status: 'disabled' };
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) return { ok: false, status: 'offline' };
    const uid = CS.session.user.id;
    this.subscribe(uid);

    if (this._accessUid === uid && this._accessState === 'allowed') {
      return { ok: true, status: 'allowed' };
    }
    if (this._accessUid === uid && this._accessState === 'blocked') {
      return { ok: false, blocked: true, status: 'blocked' };
    }
    if (this._loginPromise && this._loginPromiseUid === uid) return this._loginPromise;

    this._accessUid = uid;
    this._accessState = 'checking';
    this._loginPromiseUid = uid;
    const p = (async () => {
      /* Restaurar a sessão NÃO é um takeover. Primeiro consultamos quem possui a
         conta. Se outro aparelho está ativo, este é bloqueado e não toca na linha.
         Só uma conta livre ou já pertencente a este device é renovada. */
      try {
        const { data, error } = await CS.client.from(this.TABLE)
          .select('device_id,device_label').eq('user_id', uid).maybeSingle();
        if (error) {
          if (this._isMissingTable(error)) {
            this._disable(error);
            return { ok: true, status: 'disabled' };
          }
          this._accessState = 'error';
          console.warn('[SessionGuard] verificação inicial falhou', error);
          return { ok: false, status: 'error', error };
        }
        if (data && data.device_id && data.device_id !== this.deviceId()) {
          this._accessState = 'blocked';
          this._takenBy(data);
          return { ok: false, blocked: true, status: 'blocked', row: data };
        }
        const ok = await this.claim(uid);
        if (ok) return { ok: true, status: 'allowed' };
        this._accessState = 'error';
        return { ok: false, status: 'error' };
      } catch (err) {
        if (this._isMissingTable(err)) {
          this._disable(err);
          return { ok: true, status: 'disabled' };
        }
        this._accessState = 'error';
        console.warn('[SessionGuard] verificação inicial erro', err);
        return { ok: false, status: 'error', error: err };
      }
    })();
    this._loginPromise = p;
    try { return await p; }
    finally {
      if (this._loginPromise === p) {
        this._loginPromise = null;
        this._loginPromiseUid = null;
      }
    }
  },
  onLogout() {
    this._claimedUid = null;
    this._accessUid = null;
    this._accessState = 'unknown';
    this._loginPromise = null;
    this._loginPromiseUid = null;
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
      if (error) {
        if (this._isMissingTable(error)) this._disable(error);
        else { this._accessState = 'error'; console.warn('[SessionGuard] claim falhou', error); }
        return false;
      }
      this._claimedUid = uid;
      this._accessUid = uid;
      this._accessState = 'allowed';
      return true;
    } catch (err) {
      if (this._isMissingTable(err)) this._disable(err);
      else { this._accessState = 'error'; console.warn('[SessionGuard] claim erro', err); }
      return false;
    }
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
        this._accessUid = uid;
        this._accessState = 'blocked';
        this._takenBy({ device_id: data.device_id, device_label: data.device_label });
      } else if (data && data.device_id === this.deviceId()) {
        this._accessUid = uid;
        this._accessState = 'allowed';
        this._claimedUid = uid;
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
          if (row.device_id !== this.deviceId()) {
            this._accessUid = uid;
            this._accessState = 'blocked';
            this._takenBy(row);
          } else {
            this._accessUid = uid;
            this._accessState = 'allowed';
            this._claimedUid = uid;
            /* Não fechamos automaticamente um bloqueio REMOTO só porque chegou
               um evento com nosso device_id. O overlay só some após takeover
               explícito confirmado; assim nenhum claim concorrente ou evento
               tardio decide sozinho que a pessoa "continuou neste aparelho". */
          }
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
    try {
      const CS = window.CloudStore;
      const uid = CS && CS.session && CS.session.user ? CS.session.user.id : null;
      if (uid) this._accessUid = uid;
      this._accessState = 'blocked';
    } catch (_) { _quiet(_); }
    if (window.SessionLock) SessionLock.block('remote', { label: row.device_label });
    /* Interrompe o ENVIO para não sobrescrever o outro aparelho — mas mantém a
       pendência. Zerar _pending aqui apagava a alteração da fila: ela nunca mais
       era tentada, e o download seguinte a removia também do armazenamento local.
       A caixa de saída da camada por seção continua gravada e reenvia quando esta
       sessão for retomada. */
    try { const CS = window.CloudStore; if (CS) { clearTimeout(CS._debounce); CS._debounce = null; } } catch (_) { _quiet(_); }
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
    if (ok) {
      if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
      try {
        const pid = window.ProfileManager ? ProfileManager.getActiveProfileId() : null;
        if (pid && window.CloudStore && CloudStore._drainSectionRealtimeHint) CloudStore._drainSectionRealtimeHint(pid);
      } catch (_) { _quiet(_); }
    }
    if (window.CloudUI) CloudUI.refreshSyncBtn();
    return ok;
  }
};
window.SessionGuard = SessionGuard;
// "Continuar neste aparelho" (no overlay remoto) → reivindica de volta a posse.
if (window.SessionLock) SessionLock.onTakeover(async (origin) => {
  if (origin !== 'remote') return;
  const ok = await SessionGuard.endRemoteAndClaimHere();
  if (ok) {
    showToast('Sessão retomada neste aparelho ✓');
    try { if (window.ProfileUI && ProfileUI.resumeAfterSessionClaim) ProfileUI.resumeAfterSessionClaim(); } catch (_) { _quiet(_); }
  } else {
    showToast('Não foi possível retomar agora — verifique a internet');
    SessionLock.block('remote', {});
  }
});
