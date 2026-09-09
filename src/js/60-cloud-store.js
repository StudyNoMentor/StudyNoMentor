/* ============================================================
   CLOUD STORE — camada de dados na nuvem (Supabase / study_profiles)
   ============================================================ */
const CloudStore = {
  SUPABASE_URL: 'https://gizhxgnbmmhhniubelbz.supabase.co',
  SUPABASE_KEY: 'sb_publishable_5t8P8QpVF4tLoWNjQVWsSQ_3dpbxG94',
  TABLE: 'study_profiles',
  client: null, session: null, libStatus: 'pending', channel: null, secChannel: null, _secRtTimer: null,
  _debounce: null, DEBOUNCE_MS: 1500, _applying: false, _cfgMode: 'signin',
  _pending: false, _lastSyncAt: null, _syncing: false, _dirtyAt: null,

  init() {
    try {
      const lib = (typeof supabase !== 'undefined') ? supabase : (typeof window !== 'undefined' ? window.supabase : undefined);
      if (!lib || !lib.createClient) {
        this.libStatus = 'missing';
        if (window.ProfileUI && ProfileUI.isGateOpen()) ProfileUI.refreshStage();
        return;
      }
      this.client = lib.createClient(this.SUPABASE_URL, this.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
      this.libStatus = 'ready';
      this.client.auth.getSession().then(({ data }) => { this.session = (data && data.session) || null; this.onAuth(); }).catch(e => console.warn('getSession', e));
      this.client.auth.onAuthStateChange((_e, session) => {
        this.session = session;
        this.onAuth();
        // Usuário chegou pelo link de recuperação: pede a nova senha na hora.
        if (_e === 'PASSWORD_RECOVERY' && window.ProfileUI && ProfileUI.promptNewPasswordAfterRecovery) {
          setTimeout(() => ProfileUI.promptNewPasswordAfterRecovery(), 300);
        }
      });
    } catch (err) { this.libStatus = 'error'; console.error('CloudStore.init', err); }
    if (window.ProfileUI && ProfileUI.isGateOpen()) ProfileUI.refreshStage();
  },
  isReady() { return !!this.client; },
  isLoggedIn() { return !!this.session; },
  userEmail() { return this.session && this.session.user ? this.session.user.email : null; },
  _withTimeout(p, ms, label) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error((label || 'A operação') + ' demorou demais. Verifique sua internet.')), ms))]);
  },
  onAuth() {
    if (window.ProfileUI) ProfileUI.onAuthChanged();
    if (window.CloudUI) CloudUI.refreshSyncBtn();
    if (this.isLoggedIn()) { this.subscribeRealtime(); this.subscribeSections(); if (window.SessionGuard) SessionGuard.onLogin(); }
    else { this._unsub(); if (window.SessionGuard) SessionGuard.onLogout(); }
    // Sync por seção (Opção B): ao logar / restaurar sessão, popula a tabela nova
    // proativamente — sem depender de uma edição. Pequeno atraso para o perfil ativar.
    try { if (window.SectionSync) setTimeout(() => SectionSync.kick(), 1500); } catch (_) { _quiet(_); }
    // faxina do historico de versoes (janela de 7 dias) logo na abertura
    try { if (window.VersionHistory) setTimeout(() => VersionHistory.limpar(), 2500); } catch (_) { _quiet(_); }
  },

  async signUp(email, password) { const { data, error } = await this._withTimeout(this.client.auth.signUp({ email, password }), 20000, 'A criação de conta'); if (error) throw error; return data; },
  async signIn(email, password) { const { data, error } = await this._withTimeout(this.client.auth.signInWithPassword({ email, password }), 20000, 'O login'); if (error) throw error; return data; },
  async signOut() { clearTimeout(this._debounce); this._unsub(); try { await this.client.auth.signOut(); } catch (e) { _quiet(e); } this.session = null; },
  // Envia e-mail de recuperação de senha (usuário não logado que esqueceu a senha).
  async resetPassword(email) {
    const redirectTo = (typeof location !== 'undefined') ? location.href.split('#')[0] : undefined;
    const { error } = await this._withTimeout(
      this.client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined),
      20000, 'O envio do e-mail de recuperação');
    if (error) throw error; return true;
  },
  // Altera a senha do usuário LOGADO (ou de quem chegou pelo link de recuperação).
  async changePassword(newPassword) {
    const { error } = await this._withTimeout(this.client.auth.updateUser({ password: newPassword }), 20000, 'A alteração de senha');
    if (error) throw error; return true;
  },

  async listProfiles() {
    const { data, error } = await this._withTimeout(
      this.client.from(this.TABLE).select('id,profile_name,avatar,color,rev,updated_at').order('updated_at', { ascending: true }),
      15000, 'Carregar perfis');
    if (error) throw error; return data || [];
  },
  async createRow({ name, avatar, color, payload }) {
    const { data, error } = await this.client.from(this.TABLE)
      .insert({ user_id: this.session.user.id, profile_name: name, avatar, color, payload: payload || {}, rev: 1 })
      .select('id,rev').maybeSingle();
    if (error) throw error; return data;
  },
  async updateMeta(id, { nome, avatar, cor }) {
    const rev = ProfileManager.getRev(id);
    const { data, error } = await this.client.from(this.TABLE)
      .update({ profile_name: nome, avatar, color: cor, rev: rev + 1, updated_at: new Date().toISOString() })
      .eq('id', id).eq('rev', rev).select('rev');
    if (error) throw error;
    if (data && data.length) ProfileManager.setRev(id, rev + 1);
  },
  async fetchPayload(id) {
    const { data, error } = await this._withTimeout(
      this.client.from(this.TABLE).select('payload,rev').eq('id', id).maybeSingle(), 15000, 'Baixar o perfil');
    if (error) throw error;
    /* Resposta DEFINITIVA (não é rede, não é timeout): esta conta não tem este
       perfil. Marcada com código próprio porque quem chama precisa distinguir
       "a nuvem não tem" de "não deu para perguntar" — no primeiro caso, um
       perfil com dados locais tem de abrir mesmo assim. */
    if (!data) { const e = new Error('Perfil não encontrado na nuvem.'); e.code = 'perfil-inexistente'; throw e; }
    return data;
  },
  /* ── A TRAVA QUE FALTAVA ──────────────────────────────────────────────────
     `exportProfile` devolve `null` quando o perfil não está na lista local — e
     essa lista é um espelho da nuvem, que pode chegar incompleta (RLS negando,
     resposta parcial, corrida entre o login e a montagem do espelho). Quando
     isso acontecia, este método gravava `payload: null` na linha do perfil: a
     ÚNICA cópia remota de tudo era substituída por nada, e a leitura seguinte
     ainda propagava o vazio para os outros aparelhos.

     Nunca mais. Um envio só sai daqui se levar conteúdo. Um perfil vazio na
     memória não é uma ordem de apagamento — é sinal de que algo deu errado
     ANTES, e a resposta certa é não publicar nada, manter a pendência e tentar
     de novo. A alteração continua guardada neste aparelho o tempo todo. */
  _payloadUtil(backup) {
    if (!backup || !backup.data || typeof backup.data !== 'object') return 0;
    let n = 0;
    Object.keys(backup.data).forEach(k => { if (!valorVazio(backup.data[k])) n++; });
    return n;
  },
  _tamanhoPayload(backup) {
    try { return JSON.stringify((backup && backup.data) || {}).length; } catch (_) { return 0; }
  },
  async saveActive() {
    const id = ProfileManager.getActiveProfileId();
    if (!id || !this.isLoggedIn()) return { skipped: true };
    const meta = ProfileManager.getProfiles().find(p => p.id === id) || {};
    const backup = ProfileManager.exportProfile(id);
    if (this._payloadUtil(backup) === 0) {
      console.error('[CloudStore] envio RECUSADO: o perfil ' + id + ' não tem nenhuma seção com conteúdo neste aparelho. A cópia da nuvem foi preservada.');
      return { recusado: true, motivo: 'payload-vazio' };
    }
    /* Encolhimento grande: antes de publicar, o estado ANTERIOR vai para a
       tabela de backups. Não bloqueia o usuário (apagar de verdade é um direito
       dele), só garante que o que ele tinha continua resgatável no banco. */
    try {
      if (window.GuardaNuvem) await GuardaNuvem.antesDeEncolher(id, this._tamanhoPayload(backup));
    } catch (e) { _quiet(e, 'guarda-encolhimento'); }
    const rev = ProfileManager.getRev(id);
    const { data, error } = await this.client.from(this.TABLE)
      .update({ payload: backup, rev: rev + 1, updated_at: new Date().toISOString(), profile_name: meta.nome, avatar: meta.avatar, color: meta.cor })
      .eq('id', id).eq('rev', rev).select('rev');
    if (error) throw error;
    if (!data || data.length === 0) return { conflict: true };
    ProfileManager.setRev(id, rev + 1);
    try { if (window.GuardaNuvem) GuardaNuvem.registrarEnvio(id, this._tamanhoPayload(backup)); } catch (e) { _quiet(e, 'guarda-registro'); }
    return { rev: rev + 1 };
  },
  // Lê apenas a rev atual do perfil na nuvem (usado para reconciliar antes de reenviar)
  async _fetchRev(id) {
    const { data, error } = await this.client.from(this.TABLE).select('rev').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? data.rev : null;
  },
  // Salva com RETENTATIVA: em caso de conflito, re-sincroniza a versão e REENVIA o estado
  // local (a ação do usuário nunca é descartada). Evita a perda de dados por conflito de versão.
  async saveActiveWithRetry(maxTries) {
    maxTries = maxTries || 4;
    const id = ProfileManager.getActiveProfileId();
    if (!id || !this.isLoggedIn()) return { skipped: true };
    for (let attempt = 0; attempt < maxTries; attempt++) {
      const r = await this.saveActive();
      if (!r || !r.conflict) return r; // sucesso, skipped ou RECUSADO pela trava
      // conflito → busca a rev real da nuvem, alinha localmente e tenta de novo (empurra o local)
      let currentRev = null;
      try { currentRev = await this._fetchRev(id); } catch (e) { return { conflict: true, error: e }; }
      if (currentRev == null) return { conflict: true };
      ProfileManager.setRev(id, currentRev);
    }
    return { conflict: true };
  },
  async deleteRow(id) { const { error } = await this.client.from(this.TABLE).delete().eq('id', id); if (error) throw error; },

  notifyChange() {
    if (this._applying) return;
    /* Sessão assumida por outro aparelho (ou outra aba): não ENVIA, para não
       sobrescrever o que o outro está fazendo — mas a alteração continua marcada
       como pendente. Antes ela era simplesmente esquecida: o dado ficava só neste
       navegador e a abertura seguinte, ao baixar da nuvem, o apagava. A caixa de
       saída da camada por seção já guardou a seção; aqui basta não perder o
       estado "há algo por enviar" para quando a sessão voltar. */
    if (window.SessionLock && SessionLock.isBlocked()) {
      this._pending = true; this._dirtyAt = this._dirtyAt || Date.now();
      if (window.CloudUI) CloudUI.refreshSyncBtn();
      return;
    }
    if (!this.isReady() || !this.isLoggedIn()) return;
    try { if (!sessionStorage.getItem('diario-estudos:entered')) return; } catch (e) { _quiet(e); }
    try { if (window.VersionHistory) VersionHistory.maybeDailySnapshot(); } catch (e) { _quiet(e); } // 1 backup/dia
    this._pending = true;
    this._dirtyAt = Date.now();          // desde quando há algo não sincronizado
    if (window.CloudUI) CloudUI.refreshSyncBtn();
    clearTimeout(this._debounce);
    this._debounce = setTimeout(() => this.autoSave(), this.DEBOUNCE_MS);
  },
  // reprograma uma nova tentativa daqui a \`ms\` sem descartar o que está pendente
  _rearm(ms) { clearTimeout(this._debounce); this._debounce = setTimeout(() => this.autoSave(), ms); },
  /* ── ESCRITA DUPLA: quando o BLOB precisa mesmo subir ──────────────────────
     O blob é o perfil INTEIRO (exportProfile varre todo o localStorage do perfil).
     Enviá-lo a cada mudança significa subir megabytes para marcar um "Concluir"
     numa atividade extra — caro no 4G e lento no 3G. Com a leitura por seção
     ligada (Fase 2), quem carrega a verdade do dia a dia é profile_sections, que
     envia só o que mudou. Então o blob passa a ser uma REDE DE SEGURANÇA
     periódica, não o caminho principal.

     O blob ainda sobe SEMPRE que: (a) o sync por seção está desligado ou falhou
     — aí ele volta a ser a única fonte; (b) passou o intervalo mínimo; (c) o app
     vai para segundo plano/fecha (flushPending, _beaconSave, saveThenReload);
     (d) é o primeiro salvamento da sessão. Assim o plano B nunca fica velho
     demais nem desatualizado num momento crítico. */
  BLOB_MIN_INTERVAL_MS: 180000,   // 3 min
  _lastBlobAt: 0,
  _forceBlob: false,
  _blobDue() {
    if (this._forceBlob) return true;
    if (!this._lastBlobAt) return true;                       // nada subiu ainda nesta sessão
    if (!window.SectionSync || !SectionSync.enabled || !SectionSync.readEnabled) return true;
    if (SectionSync._lastError) return true;                  // seções com problema: blob assume
    if (SectionSync._seededProfile !== ProfileManager.getActiveProfileId()) return true;
    return (Date.now() - this._lastBlobAt) >= this.BLOB_MIN_INTERVAL_MS;
  },
  // Empurra as seções e diz se ficou tudo entregue. É isto que substitui o blob
  // nas rodadas leves — se sobrar seção suja ou houver erro, a rodada não conta
  // como sincronizada e a pendência é mantida para nova tentativa.
  async _pushSectionsNow() {
    if (!window.SectionSync || !SectionSync.enabled) return false;
    try {
      SectionSync.seedOnce();
      await SectionSync.pushDirty();
      return SectionSync._dirty.size === 0 && !SectionSync._lastError;
    } catch (_) { return false; }
  },
  async autoSave() {
    // BUG CORRIGIDO: se um salvamento já está em curso, NÃO descartamos a rodada —
    // reprogramamos uma nova tentativa para logo após, senão a última alteração ficava
    // presa como "pendente" até o próximo foco/edição (causa de "às vezes não salva").
    if (this._syncing) { this._rearm(400); return; }
    // Sessão assumida em outro aparelho: adia, NÃO descarta. Descartar era perder
    // a alteração de vez — ela nunca mais era tentada nesta ou em outra sessão.
    if (window.SessionLock && SessionLock.isBlocked()) { this._pending = true; return; }
    if (!this.isReady() || !this.isLoggedIn()) return;
    if (!this._pending) return;                // nada novo a enviar
    clearTimeout(this._debounce);
    this._syncing = true; this._pending = false;
    if (window.CloudUI) CloudUI.setStatus('syncing', 'Sincronizando...');
    try {
      if (!this._blobDue()) {
        // ── ROTA LEVE: só as seções alteradas ──────────────────────────────
        // Se o envio periódico de seções já está em curso, esperamos a vez: forçar
        // o blob aqui seria tratar concorrência normal como se fosse falha.
        if (SectionSync._pushing) {
          this._syncing = false; this._pending = true; this._rearm(800); return;
        }
        const ok = await this._pushSectionsNow();
        this._syncing = false;
        if (!ok) {
          // alguma seção não subiu: promove esta rodada a envio de blob e repete
          this._pending = true; this._forceBlob = true;
          if (window.CloudUI) CloudUI.setStatus('error', 'Reenviando…');
          this._rearm(3000);
          return;
        }
        this._lastSyncAt = Date.now();
        if (window.CloudUI) CloudUI.setStatus('ok', 'Sincronizado');
        if (this._pending) this._rearm(300);
        return;
      }
      // ── ROTA COMPLETA: blob + seções ─────────────────────────────────────
      const r = await this.saveActiveWithRetry();
      this._syncing = false;
      if (r && r.conflict) {
        // conflito persistente: mantém pendente e tenta de novo (não perde a alteração)
        this._pending = true;
        if (window.CloudUI) CloudUI.setStatus('error', 'Reenviando…');
        this._rearm(5000);
        return;
      }
      /* Envio RECUSADO pela trava anti-apagamento: a nuvem continua com a cópia
         boa, e é assim que tem de ficar. Não marcamos "Sincronizado" (seria
         mentira), mantemos a pendência e reprogramamos com folga — quando o
         perfil voltar a ter conteúdo em memória, o envio sai sozinho. */
      if (r && r.recusado) {
        this._pending = true;
        if (window.CloudUI) CloudUI.setStatus('error', 'Envio suspenso — cópia da nuvem protegida');
        this._rearm(30000);
        return;
      }
      this._lastBlobAt = Date.now(); this._forceBlob = false;
      this._lastSyncAt = Date.now();
      if (window.CloudUI) CloudUI.setStatus('ok', 'Sincronizado');
      try { if (window.SectionSync) SectionSync.afterBlobSave(); } catch (_) { _quiet(_); } // escrita dupla (Opção B, Fase 1)
    } catch (err) {
      // erro de rede: NÃO perde a alteração — remarca como pendente e reprograma (auto-recupera)
      this._syncing = false; this._pending = true;
      console.error('autoSave', err);
      if (window.CloudUI) CloudUI.setStatus('error', 'Sem conexão — tentando de novo…');
      this._rearm(5000);
      return;
    }
    // se surgiram NOVAS mudanças durante o envio (notifyChange remarcou _pending), dispara outro ciclo já
    if (this._pending) this._rearm(300);
  },
  // Envia AGORA quaisquer alterações pendentes (cancela o debounce e salva já).
  async flushPending() {
    if (!this.isReady() || !this.isLoggedIn()) return;
    clearTimeout(this._debounce);
    // flushPending é chamado nos momentos críticos (app indo para segundo plano,
    // "Sincronizar agora", troca de perfil). Aqui o blob SOBE, custe o que custar:
    // é a hora em que a rede de segurança precisa estar em dia.
    this._forceBlob = true;
    // Alteração que sobreviveu a um recarregamento (caixa de saída gravada) também
    // conta como pendente: sem isto, "Sincronizar agora" não a enviava.
    try { if (window.SectionSync && SectionSync.pendingQuick() > 0) this._pending = true; } catch (e) { _quiet(e, 'flush-pendencia'); }
    if (this._pending || this._syncing) await this.autoSave();
  },
  // SALVAMENTO DE EMERGÊNCIA (keepalive): fetch com keepalive:true sobrevive ao fechamento
  // da aba/app, coisa que uma chamada async normal em beforeunload NÃO faz — o navegador
  // aborta a requisição ao descarregar a página. Sem isto, alterações feitas nos últimos
  // segundos antes de fechar podiam se perder. Não bumpa a rev local de propósito: se der
  // certo, o próximo acesso baixa; se falhar, o próximo autoSave reenvia.
  _beaconSave() {
    try {
      if (!this.isReady() || !this.isLoggedIn()) return;
      if (!this._pending && !this._syncing) return; // nada a garantir
      try { if (!sessionStorage.getItem('diario-estudos:entered')) return; } catch (e) { return; }
      const id = ProfileManager.getActiveProfileId(); if (!id) return;
      const meta = ProfileManager.getProfiles().find(p => p.id === id) || {};
      const rev = ProfileManager.getRev(id);
      const backup = ProfileManager.exportProfile(id);
      // a mesma trava do saveActive: o salvamento de emergência também não pode
      // publicar um perfil vazio por cima do que está na nuvem
      if (this._payloadUtil(backup) === 0) return;
      const body = JSON.stringify({ payload: backup, rev: rev + 1,
        updated_at: new Date().toISOString(), profile_name: meta.nome, avatar: meta.avatar, color: meta.cor });
      // keepalive tem teto de ~64KB no corpo; acima disso não é confiável — deixa para o autoSave normal.
      if (body.length > 60000) return;
      const token = (this.session && this.session.access_token) || this.SUPABASE_KEY;
      fetch(this.SUPABASE_URL + '/rest/v1/' + this.TABLE + '?id=eq.' + encodeURIComponent(id) + '&rev=eq.' + rev, {
        method: 'PATCH', keepalive: true,
        headers: { apikey: this.SUPABASE_KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body
      }).catch(() => {});
    } catch (_) { _quiet(_); }
  },
  // Sincronização inteligente ao voltar o foco/rede: se há mudanças locais, ENVIA;
  // se não há nada pendente e a nuvem está mais nova (outro dispositivo salvou), BAIXA.
  // Assim, editar no celular e no PC não sobrescreve um ao outro no uso normal.
  async syncOnFocus() {
    if (!this.isReady() || !this.isLoggedIn()) return;
    try { if (!sessionStorage.getItem('diario-estudos:entered')) return; } catch (e) { return; }
    if (this._pending || this._debounce) { await this.flushPending(); return; }
    const id = ProfileManager.getActiveProfileId(); if (!id) return;
    // Pendência que sobreviveu a um recarregamento (caixa de saída gravada):
    // ENVIA antes de qualquer coisa; baixar primeiro sobrescreveria o que falta subir.
    try {
      if (window.SectionSync && SectionSync.pendingQuick() > 0) {
        this._pending = true;
        await this.flushPending();
        return;
      }
    } catch (e) { _quiet(e, 'syncOnFocus-pendencia'); }
    try {
      // FASE 2: a novidade é detectada pelas revisões DAS SEÇÕES. Vantagem sobre a
      // rev do blob: só baixa quando o conteúdo em si mudou, e sabemos o que mudou.
      let novidade;
      if (window.SectionSync && SectionSync.readEnabled) {
        novidade = await SectionSync.hasRemoteUpdates(id);
      } else {
        const remoteRev = await this._fetchRev(id);
        novidade = (remoteRev != null && remoteRev > ProfileManager.getRev(id));
      }
      if (novidade) {
        if (window.CloudUI) CloudUI.setStatus('syncing', 'Baixando atualizações...');
        await this.pullActiveAndReload();
      }
    } catch (e) { /* silencioso: tenta de novo no próximo foco */ }
  },
  // Botão manual "Sincronizar agora": empurra pendências e puxa se a nuvem estiver mais nova.
  async syncNow() {
    if (!this.isReady() || !this.isLoggedIn()) { showToast('Entre na sua conta para sincronizar (Configurações → Nuvem).'); return; }
    if (window.CloudUI) CloudUI.setStatus('syncing', 'Sincronizando...');
    let fila = 0;
    try { if (window.SectionSync) fila = SectionSync.pendingQuick(); } catch (e) { _quiet(e, 'syncNow-fila'); }
    try {
      if (this._pending || this._debounce || fila) await this.flushPending();
      else {
        const id = ProfileManager.getActiveProfileId();
        let novidade = false;
        if (id && window.SectionSync && SectionSync.readEnabled) novidade = await SectionSync.hasRemoteUpdates(id);
        else if (id) { const rr = await this._fetchRev(id); novidade = (rr != null && rr > ProfileManager.getRev(id)); }
        if (novidade) { await this.pullActiveAndReload(); return; }
        else { await this.autoSave(); } // reenvia o estado atual como confirmação
      }
      showToast('Sincronizado ✓');
    } catch (e) { if (window.CloudUI) CloudUI.setStatus('error', 'Falha ao sincronizar'); showToast('Não foi possível sincronizar agora'); }
  },
  async pullActiveAndReload() {
    const id = ProfileManager.getActiveProfileId(); if (!id) return;
    // FASE 2: tenta primeiro por seção; só usa o blob se a leitura por seção falhar.
    if (window.SectionSync && SectionSync.readEnabled) {
      try { if (await SectionSync.pullAndReload()) return; } catch (e) { console.warn('pull por seção', e); }
    }
    try {
      // Mesma regra do caminho por seção: primeiro ENTREGA o que este aparelho
      // ainda não enviou; o que não subir é preservado e não é sobrescrito.
      let preservar = [];
      try { if (window.SectionSync) preservar = await SectionSync.flushBeforeRead(id); } catch (e) { _quiet(e, 'pull-pendencia'); }
      const res = await this.fetchPayload(id);
      // REDE DE SEGURANÇA: antes de sobrescrever o estado local com o da nuvem,
      // guarda uma versão do que está aqui — assim, se outro aparelho tiver
      // enviado algo indesejado, você consegue restaurar em Configurações.
      try { if (window.VersionHistory) await VersionHistory.snapshot('antes de baixar da nuvem'); } catch (e) { _quiet(e); }
      this._applying = true;
      const mudou = ProfileManager.restorePayloadInto(id, (res.payload && res.payload.data) || {}, preservar);
      ProfileManager.setRev(id, res.rev);
      this._applying = false;
      if (!mudou) { console.info('[CloudStore] nuvem conferida: nada mudou, sem recarregar'); return; }
      showToast('Sincronizado da nuvem ✓');
      recarregarApp('dados novos da nuvem (blob)');
    } catch (e) { this._applying = false; console.error('pullActiveAndReload', e); }
  },
  // Salva o estado atual na nuvem ANTES de recarregar a página. Essencial: sem isto,
  // o location.reload() cancela o salvamento automático e a alteração se perde na nuvem.
  async saveThenReload() {
    clearTimeout(this._debounce); // cancela qualquer autoSave pendente (vamos salvar já)
    if (this.isReady() && this.isLoggedIn()) {
      try {
        // retentativa: garante que a ação do usuário chegue à nuvem antes de recarregar
        const r = await this.saveActiveWithRetry();
        try { if (window.SectionSync) await SectionSync.afterBlobSave(); } catch (_) { _quiet(_); } // sync por seção
        if (r && r.conflict) {
          showToast('Aviso: não foi possível confirmar o salvamento na nuvem. Seus dados estão guardados neste dispositivo.');
        } else if (r && r.recusado) {
          showToast('Envio suspenso para proteger a cópia da nuvem. Nada foi perdido — seus dados estão neste dispositivo.');
        }
      } catch (e) { console.error('saveThenReload', e); showToast('Aviso: não foi possível salvar na nuvem agora. Verifique a internet.'); }
    }
    recarregarApp('troca que exige recarregar a tela', { imediato: true });
  },

  subscribeRealtime() {
    if (!this.isReady() || !this.isLoggedIn() || this.channel) return;
    try {
      this.channel = this.client.channel('sp_rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: this.TABLE, filter: 'user_id=eq.' + this.session.user.id }, (p) => this._onRealtime(p))
        .subscribe();
    } catch (e) { console.warn('realtime indisponível', e); }
  },
  // Tempo real das SEÇÕES: escuta profile_sections do perfil aberto. O gatilho não
  // recarrega direto — pergunta antes se há revisão nova de verdade (hasRemoteUpdates).
  // Sem essa checagem, os nossos PRÓPRIOS envios disparariam um loop de recarga.
  subscribeSections() {
    if (!this.isReady() || !this.isLoggedIn() || this.secChannel) return;
    const pid = ProfileManager.getActiveProfileId(); if (!pid) return;
    try {
      this.secChannel = this.client.channel('sec_rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_sections', filter: 'profile_id=eq.' + pid }, () => {
          clearTimeout(this._secRtTimer);
          this._secRtTimer = setTimeout(() => this._onSectionRealtime(pid), 1200);
        })
        .subscribe();
    } catch (e) { console.warn('realtime de seções indisponível', e); }
  },
  async _onSectionRealtime(pid) {
    if (this._applying || this._pending || this._syncing || this._debounce) return; // edição local em curso: não atropela
    if (!window.SectionSync || !SectionSync.readEnabled) return;
    if (SectionSync._pushing || SectionSync._dirty.size) return;
    try {
      // O aviso e a recarga saíam ANTES de saber se havia mudança de verdade —
      // era o "Atualizado em tempo real ✓" seguido de um reload à toa. Agora
      // quem avisa é o pullAndReload, e só quando alguma seção realmente mudou.
      if (await SectionSync.hasRemoteUpdates(pid)) await SectionSync.pullAndReload();
    } catch (_) { _quiet(_); }
  },
  _unsub() {
    if (this.channel) { try { this.client.removeChannel(this.channel); } catch (e) { _quiet(e); } this.channel = null; }
    if (this.secChannel) { try { this.client.removeChannel(this.secChannel); } catch (e) { _quiet(e); } this.secChannel = null; }
    clearTimeout(this._secRtTimer);
  },
  _onRealtime(evt) {
    const row = evt.new || evt.old || {};
    if (window.ProfileUI && ProfileUI.isGateOpen() && ProfileUI._stage === 'profiles') ProfileUI.loadCloudProfiles();
    const activeId = ProfileManager.getActiveProfileId();
    if (row.id && row.id === activeId && (row.rev || 0) > ProfileManager.getRev(activeId)) {
      if (this._debounce) return;
      // Na Fase 2 quem manda na leitura é o canal das seções — o blob chegar primeiro
      // não deve provocar uma recarga com dados mais velhos que os das seções.
      if (window.SectionSync && SectionSync.readEnabled) return;
      this.pullActiveAndReload();   // ele mesmo avisa (e só recarrega) se algo mudou
    }
  }
};
window.CloudStore = CloudStore;
