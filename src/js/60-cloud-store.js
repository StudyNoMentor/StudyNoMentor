/* ============================================================
   CLOUD STORE — autenticação + fachada da persistência relacional
   ------------------------------------------------------------
   O PostgreSQL relacional é a única fonte persistente dos dados de estudo.
   CloudStore mantém apenas autenticação, metadados de perfis e a API pública
   usada pelas telas. Leituras/escritas do estudo delegam ao RelationalStore.
   ============================================================ */
const CloudStore = {
  SUPABASE_URL: 'https://gizhxgnbmmhhniubelbz.supabase.co',
  SUPABASE_KEY: 'sb_publishable_5t8P8QpVF4tLoWNjQVWsSQ_3dpbxG94',
  TABLE: 'study_profiles',

  client: null,
  session: null,
  libStatus: 'pending',
  channel: null,
  _applying: false,
  _cfgMode: 'signin',
  _lastSyncAt: null,
  _syncing: false,
  serviceStatus: 'unknown',
  _serviceStatusChangedAt: 0,
  _prefsHydratedUid: null,
  _prefsHydratePromise: null,
  _prefsHydratingUid: null,
  _focusSyncPromise: null,
  _lastFocusSyncAt: 0,

  FETCH_TETO_MS: 25000,
  FOCUS_SYNC_MIN_MS: 60 * 1000,
  TOKEN_RETENTATIVAS: 2,
  TOKEN_ESPERA_MS: 1500,

  init() {
    try {
      const lib = (typeof supabase !== 'undefined')
        ? supabase
        : (typeof window !== 'undefined' ? window.supabase : undefined);
      if (!lib || !lib.createClient) {
        this.libStatus = 'missing';
        if (window.ProfileUI && ProfileUI.isGateOpen()) ProfileUI.refreshStage();
        return;
      }
      this.client = lib.createClient(this.SUPABASE_URL, this.SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
        global: { fetch: (u, o) => this._buscarComTeto(u, o) }
      });
      this.libStatus = 'ready';

      this.client.auth.getSession()
        .then(({ data }) => {
          this.session = (data && data.session) || null;
          this.onAuth('SESSION_INIT');
        })
        .catch(e => console.warn('getSession', e));

      this.client.auth.onAuthStateChange((evento, session) => {
        this.session = session;
        this.onAuth(evento);
        if (evento === 'PASSWORD_RECOVERY' &&
            window.ProfileUI && ProfileUI.promptNewPasswordAfterRecovery) {
          setTimeout(() => ProfileUI.promptNewPasswordAfterRecovery(), 300);
        }
      });
    } catch (err) {
      this.libStatus = 'error';
      console.error('CloudStore.init', err);
    }
    if (window.ProfileUI && ProfileUI.isGateOpen()) ProfileUI.refreshStage();
  },

  isReady() { return !!this.client; },
  isLoggedIn() { return !!this.session; },
  userEmail() { return this.session && this.session.user ? this.session.user.email : null; },

  _setServiceStatus(next) {
    const status = ['unknown','ok','restricted','offline'].includes(next) ? next : 'unknown';
    if (this.serviceStatus === status) return;
    const prev = this.serviceStatus;
    this.serviceStatus = status;
    this._serviceStatusChangedAt = Date.now();
    try {
      window.dispatchEvent(new CustomEvent('cloud:service-status', { detail: { status, previous: prev } }));
    } catch (e) { _quiet(e, 'cloud-service-status-event'); }
    try {
      if (window.ProfileUI && ProfileUI.isGateOpen && ProfileUI.isGateOpen()) ProfileUI.refreshStage();
    } catch (e) { _quiet(e, 'cloud-service-status-gate'); }
    try { if (window.CloudUI) CloudUI.refreshSyncBtn(); }
    catch (e) { _quiet(e, 'cloud-service-status-ui'); }
    if (status === 'ok' && prev === 'restricted' && this.isLoggedIn()) {
      try {
        const id = window.ProfileManager && ProfileManager.getActiveProfileId
          ? ProfileManager.getActiveProfileId() : null;
        if (id && window.RelationalStore) RelationalStore.subscribeProfile(id);
      } catch (e) { _quiet(e, 'cloud-service-status-resubscribe'); }
    }
  },

  _buscarComTeto(url, opcoes) {
    const o = opcoes || {};
    if (typeof AbortController === 'undefined') return fetch(url, o);
    const ac = new AbortController();
    const externo = o.signal;
    const propagar = () => { try { ac.abort(); } catch (e) { _quiet(e, 'fetch-abort'); } };
    if (externo) {
      if (externo.aborted) propagar();
      else externo.addEventListener('abort', propagar, { once: true });
    }
    const t = setTimeout(propagar, this.FETCH_TETO_MS);
    return fetch(url, { ...o, signal: ac.signal })
      .then(res => {
        this._setServiceStatus(res.status === 402 ? 'restricted' : 'ok');
        return res;
      }, err => {
        this._setServiceStatus('offline');
        throw err;
      })
      .finally(() => clearTimeout(t));
  },

  _withTimeout(p, ms, label) {
    return Promise.race([
      p,
      new Promise((_, rej) => setTimeout(
        () => rej(new Error((label || 'A operação') + ' demorou demais. Verifique sua internet.')),
        ms
      ))
    ]);
  },

  _textoDoErro(err) {
    if (!err) return '';
    return [err.message, err.code, err.details, err.hint, err.error_description]
      .filter(Boolean).join(' ').toLowerCase();
  },

  _tokenNoFuturo(err) {
    const t = this._textoDoErro(err);
    return /issued at future|not yet valid|\bnbf\b|\biat\b/.test(t);
  },

  _tokenVencido(err) {
    const t = this._textoDoErro(err);
    if (!/jwt|jws|token|pgrst301|pgrst302/.test(t)) return false;
    return /expired|expirou|invalid|inválid|malformed|pgrst301|pgrst302/.test(t);
  },

  async _comTokenTolerante(fn, label) {
    let ultimo = null, futuro = false;
    for (let tentativa = 0; tentativa <= this.TOKEN_RETENTATIVAS; tentativa++) {
      try { return await fn(); }
      catch (err) {
        ultimo = err;
        futuro = this._tokenNoFuturo(err);
        const vencido = !futuro && this._tokenVencido(err);
        if ((!futuro && !vencido) || !this.isLoggedIn()) throw err;
        if (tentativa === this.TOKEN_RETENTATIVAS) break;
        console.warn('[CloudStore] ' + (label || 'operação') + ': token recusado (' +
          (futuro ? 'emitido no futuro' : 'vencido') + ') — tentativa ' +
          (tentativa + 1) + ' de ' + this.TOKEN_RETENTATIVAS + '.');
        if (vencido) {
          try {
            const r = await this.client.auth.refreshSession();
            if (r && r.data && r.data.session) this.session = r.data.session;
          } catch (e) { _quiet(e, 'token-renovar'); }
        }
        await new Promise(r => setTimeout(r, this.TOKEN_ESPERA_MS * (tentativa + 1)));
      }
    }
    const e = new Error(futuro
      ? 'o relógio do servidor ainda não aceitou sua sessão. Aguarde alguns segundos e tente de novo.'
      : 'sua sessão não foi aceita pelo servidor. Entre novamente com sua senha.');
    e.code = futuro ? 'token-fora-de-hora' : 'token-recusado';
    e.causa = ultimo;
    throw e;
  },

  async aplicando(fn) {
    const antes = this._applying;
    this._applying = true;
    try { return await fn(); }
    finally { this._applying = antes; }
  },

  onAuth(evento) {
    try { if (window.ProfileUI) ProfileUI.onAuthChanged(); } catch (e) { _quiet(e, 'auth-ui'); }
    try { if (window.CloudUI) CloudUI.refreshSyncBtn(); } catch (e) { _quiet(e, 'auth-sync-ui'); }

    if (!this.isLoggedIn()) {
      this._prefsHydratedUid = null;
      this._prefsHydratingUid = null;
      this._prefsHydratePromise = null;
      this._unsub();
      return;
    }

    this.subscribeRealtime();

    /* INITIAL_SESSION, SIGNED_IN e TOKEN_REFRESHED podem apontar para a mesma
       sessão. Preferências globais só precisam ser lidas uma vez por usuário;
       reler em todo evento de auth multiplicava SELECTs sem trazer dado novo. */
    try {
      const uid = this.session && this.session.user && this.session.user.id;
      if (uid && window.RelationalStore &&
          this._prefsHydratedUid !== uid &&
          this._prefsHydratingUid !== uid) {
        this._prefsHydratingUid = uid;
        const p = RelationalStore.hydrateUserPreferences()
          .then(() => { this._prefsHydratedUid = uid; })
          .catch(e => {
            if (this._prefsHydratedUid === uid) this._prefsHydratedUid = null;
            _quiet(e, 'rel-user-prefs');
          })
          .finally(() => {
            if (this._prefsHydratingUid === uid) this._prefsHydratingUid = null;
            if (this._prefsHydratePromise === p) this._prefsHydratePromise = null;
          });
        this._prefsHydratePromise = p;
      }
    } catch (e) { _quiet(e, 'rel-user-prefs-start'); }
  },

  async signUp(email, password) {
    const { data, error } = await this._withTimeout(
      this.client.auth.signUp({ email, password }), 20000, 'A criação de conta');
    if (error) throw error;
    return data;
  },

  async signIn(email, password) {
    const { data, error } = await this._withTimeout(
      this.client.auth.signInWithPassword({ email, password }), 20000, 'O login');
    if (error) throw error;
    return data;
  },

  async signOut() {
    this._unsub();
    try { await this.client.auth.signOut(); } catch (e) { _quiet(e, 'signout'); }
    this.session = null;
  },

  async resetPassword(email) {
    const redirectTo = (typeof location !== 'undefined') ? location.href.split('#')[0] : undefined;
    const { error } = await this._withTimeout(
      this.client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined),
      20000, 'O envio do e-mail de recuperação');
    if (error) throw error;
    return true;
  },

  async changePassword(newPassword) {
    const { error } = await this._withTimeout(
      this.client.auth.updateUser({ password: newPassword }), 20000, 'A alteração de senha');
    if (error) throw error;
    return true;
  },

  async listProfiles() {
    return this._comTokenTolerante(async () => {
      const { data, error } = await this._withTimeout(
        this.client.from(this.TABLE)
          .select('id,profile_name,avatar,color,created_at,updated_at')
          .order('updated_at', { ascending: true }),
        15000, 'Carregar perfis');
      if (error) throw error;
      return data || [];
    }, 'Carregar perfis');
  },

  async createRow({ name, avatar, color }) {
    if (!this.session || !this.session.user) throw new Error('Sessão ausente');
    const { data, error } = await this.client.from(this.TABLE)
      .insert({
        user_id: this.session.user.id,
        profile_name: name,
        avatar: avatar || '📘',
        color: color || '#4f46e5'
      })
      .select('id,created_at').maybeSingle();
    if (error) throw error;
    return data;
  },

  async updateMeta(id, { nome, avatar, cor }) {
    const { data, error } = await this.client.from(this.TABLE)
      .update({
        profile_name: nome,
        avatar: avatar,
        color: cor,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id').maybeSingle();
    if (error) throw error;
    return data;
  },

  async deleteRow(id) {
    const { error } = await this.client.from(this.TABLE).delete().eq('id', id);
    if (error) throw error;
  },

  async saveActive() {
    if (!window.RelationalStore) throw new Error('Camada relacional indisponível');
    await RelationalStore.flush();
    this._lastSyncAt = RelationalStore._lastSyncAt || Date.now();
    return { relational: true };
  },


  notifyChange() {
    try { if (window.CloudUI) CloudUI.refreshSyncBtn(); }
    catch (e) { _quiet(e, 'notify-sync-ui'); }
  },

  async autoSave() {
    if (!this.isReady() || !this.isLoggedIn() || !window.RelationalStore) return false;
    this._syncing = true;
    try {
      await RelationalStore.flush();
      this._lastSyncAt = RelationalStore._lastSyncAt || Date.now();
      return true;
    } catch (e) {
      try { if (window.CloudUI) CloudUI.setStatus('error', 'Falha ao salvar no banco'); }
      catch (uiErr) { _quiet(uiErr, 'status-save-error'); }
      throw e;
    } finally {
      this._syncing = false;
      try { if (window.CloudUI) CloudUI.refreshSyncBtn(); }
      catch (e) { _quiet(e, 'autosave-sync-ui'); }
    }
  },

  async flushPending() {
    return this.autoSave();
  },

  _beaconSave() {
    /* Não existe dado de estudo persistente no navegador para descarregar. */
  },

  async syncOnFocus(opts) {
    if (!this.isReady() || !this.isLoggedIn() || !window.RelationalStore) return false;
    if (this.serviceStatus === 'restricted') return false;
    const id = window.ProfileManager && ProfileManager.getActiveProfileId
      ? ProfileManager.getActiveProfileId() : null;
    if (!id) return false;

    const force = !!(opts && opts.force);
    const now = Date.now();
    if (this._focusSyncPromise) return this._focusSyncPromise;
    if (!force && this._lastFocusSyncAt && now - this._lastFocusSyncAt < this.FOCUS_SYNC_MIN_MS) return false;

    this._lastFocusSyncAt = now;
    const job = (async () => {
      try {
        /* Se o websocket tiver sido encerrado enquanto a aba estava em segundo
           plano, o foco restabelece o realtime antes do catch-up de segurança. */
        try { RelationalStore.subscribeProfile(id); } catch (e) { _quiet(e, 'rel-sync-focus-subscribe'); }
        await RelationalStore.flush();
        await RelationalStore.catchUp(id, 'focus');
        this._lastSyncAt = RelationalStore._lastSyncAt || Date.now();
        return true;
      } catch (e) {
        this._lastFocusSyncAt = 0; // permite nova tentativa real após falha
        _quiet(e, 'rel-sync-focus');
        return false;
      }
    })();
    this._focusSyncPromise = job.finally(() => {
      if (this._focusSyncPromise) this._focusSyncPromise = null;
    });
    return this._focusSyncPromise;
  },

  async syncNow() {
    if (!this.isReady() || !this.isLoggedIn()) {
      showToast('Entre na sua conta para consultar o banco.');
      return false;
    }
    if (!window.RelationalStore) return false;
    const id = window.ProfileManager && ProfileManager.getActiveProfileId
      ? ProfileManager.getActiveProfileId() : null;
    try {
      if (window.CloudUI) CloudUI.setStatus('syncing', 'Consultando banco…');
      await RelationalStore.flush();
      if (id) await RelationalStore.catchUp(id, 'manual');
      this._lastSyncAt = RelationalStore._lastSyncAt || Date.now();
      if (window.CloudUI) CloudUI.setStatus('ok', 'Sincronizado com o banco');
      showToast('Banco atualizado ✓');
      return true;
    } catch (e) {
      if (window.CloudUI) CloudUI.setStatus('error', 'Falha ao consultar o banco');
      showToast('Não foi possível consultar o banco agora');
      return false;
    }
  },

  async pullActiveAndReload(opts) {
    const id = window.ProfileManager && ProfileManager.getActiveProfileId
      ? ProfileManager.getActiveProfileId() : null;
    if (!id || !window.RelationalStore) return false;
    return RelationalStore.catchUp(id, (opts && opts.reason) || 'pull');
  },

  async saveThenReload() {
    try {
      if (this.isReady() && this.isLoggedIn() && window.RelationalStore) {
        await RelationalStore.flush();
      }
    } catch (e) {
      console.error('saveThenReload', e);
      showToast('Não foi possível confirmar a gravação no banco. A tela não foi recarregada.');
      return false;
    }
    recarregarApp('troca que exige recarregar a tela', { imediato: true });
    return true;
  },

  subscribeRealtime() {
    if (!this.isReady() || !this.isLoggedIn() || this.channel) return;
    try {
      this.channel = this.client.channel('study_profiles_rt')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: this.TABLE,
          filter: 'user_id=eq.' + this.session.user.id
        }, () => {
          try {
            if (window.ProfileUI && ProfileUI.isGateOpen()) ProfileUI.loadCloudProfiles();
          } catch (e) { _quiet(e, 'profiles-realtime'); }
        })
        .subscribe();
    } catch (e) {
      console.warn('realtime de perfis indisponível', e);
    }
  },

  onActiveProfileChanged(pid) {
    try {
      if (window.RelationalStore && pid && this.isLoggedIn()) {
        RelationalStore.subscribeProfile(pid);
      }
    } catch (e) { _quiet(e, 'profile-realtime'); }
  },

  _unsub() {
    try { if (window.RelationalStore) RelationalStore.unsubscribe(); }
    catch (e) { _quiet(e, 'rel-unsubscribe'); }
    if (this.channel) {
      try { this.client.removeChannel(this.channel); }
      catch (e) { _quiet(e, 'profiles-unsubscribe'); }
      this.channel = null;
    }
  }
};

window.CloudStore = CloudStore;
