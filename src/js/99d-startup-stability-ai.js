/* ============================================================================
   ESTABILIDADE DE ABERTURA + GUARDA DE SINCRONIZAÇÃO
   ----------------------------------------------------------------------------
   Objetivos:
   1) sincronização em segundo plano nunca deve ficar recarregando a página;
   2) entrar novamente no MESMO perfil aplica dados novos sem hard reload;
   3) autenticação restaurada é processada UMA vez por usuário, mesmo que o
      Supabase dispare getSession + INITIAL_SESSION/TOKEN_REFRESHED;
   4) Realtime de seções só acompanha o perfil realmente aberto nesta aba;
   5) sessão restaurada não toma à força a posse de outro dispositivo;
   6) reset TEC é destrutivo apenas para dados TEC do perfil ativo e pode ser
      propagado por marcador remoto antes de qualquer reenvio contaminado;
   7) telemetria e bookkeeping locais do TEC não entram no SectionSync.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__snmStartupStability) return;
  window.__snmStartupStability = true;

  const ACTIVE_AT_LOAD = (() => {
    try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'startup-active-profile'); return null; }
  })();

  const TEC_RESET_SECTION = '__tec_reset_epoch';
  const LOCAL_ONLY_EXACT = new Set([
    'tec-capture-log-v1',
    TEC_RESET_SECTION
  ]);
  const LOCAL_ONLY_PREFIX = [
    'tec-cloud-ledger:'
  ];

  const quiet = (e, tag) => {
    try { if (typeof _quiet === 'function') _quiet(e, tag || 'startup-stability'); }
    catch (_) { /* diagnóstico nunca quebra o app */ }
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const isLocalOnly = (section) => {
    const s = String(section || '');
    return LOCAL_ONLY_EXACT.has(s) || LOCAL_ONLY_PREFIX.some(p => s.startsWith(p));
  };

  function enteredProfile() {
    try { return sessionStorage.getItem('diario-estudos:entered') || null; }
    catch (_) { return null; }
  }
  function activeProfile() {
    try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
    catch (_) { return null; }
  }
  function profileConfirmed(id) {
    const active = activeProfile(), entered = enteredProfile();
    return !!id && active === id && entered === id;
  }

  let softTimer = null;
  let softReasons = [];
  function activeScreenName() {
    try {
      const el = document.querySelector('.screen.active');
      return el && el.id && el.id.startsWith('screen-') ? el.id.slice(7) : null;
    } catch (e) { quiet(e, 'soft-refresh-screen'); return null; }
  }

  function softRefreshNow() {
    softTimer = null;
    const reasons = softReasons.splice(0);
    try { if (window.PlanManager && PlanManager.init) PlanManager.init(); } catch (e) { quiet(e, 'soft-refresh-plan'); }
    try { if (window.ProfileUI && ProfileUI.renderChip) ProfileUI.renderChip(); } catch (e) { quiet(e, 'soft-refresh-profile'); }
    try { if (window.CloudUI && CloudUI.render) CloudUI.render(); } catch (e) { quiet(e, 'soft-refresh-cloud'); }
    try { if (window.TecIntegracaoScreen && TecIntegracaoScreen.render) TecIntegracaoScreen.render(); } catch (e) { quiet(e, 'soft-refresh-tec'); }
    try { if (window.TecRealtime && TecRealtime.render) TecRealtime.render(); } catch (e) { quiet(e, 'soft-refresh-radar'); }
    try { if (window.TecLacunasContinuas && TecLacunasContinuas.refresh) TecLacunasContinuas.refresh('cloud-soft-refresh'); } catch (e) { quiet(e, 'soft-refresh-lacunas'); }

    const screen = activeScreenName();
    try {
      if (screen) window.dispatchEvent(new CustomEvent('screen:activated', { detail:{ screen, reason:'cloud-soft-refresh' } }));
      window.dispatchEvent(new CustomEvent('study:cloud-applied', { detail:{ reasons, screen, at:new Date().toISOString() } }));
    } catch (e) { quiet(e, 'soft-refresh-event'); }
  }

  function scheduleSoftRefresh(reason) {
    softReasons.push(String(reason || 'sincronização'));
    clearTimeout(softTimer);
    softTimer = setTimeout(softRefreshNow, 180);
  }
  window.__snmSoftRefresh = scheduleSoftRefresh;

  /* ───────────────────────── RESET TEC SEGURO ──────────────────────────── */
  const TecDataReset = {
    CONTROL_SECTION: TEC_RESET_SECTION,
    APPLY_KEY_PREFIX: 'diario-estudos:tec-reset-applied:',
    _running: null,

    isTecSection(section) {
      const s = String(section || '');
      if (!s || s === this.CONTROL_SECTION) return false;
      if (/^p:[^:]+:(?:tec(?:[-:_].*)?|incidencia)$/i.test(s)) return true;
      if (/^tec(?:[-:_]|$)/i.test(s)) return true;
      if (/^painel:tec(?:[-:_]|$)/i.test(s)) return true;
      if (/^ux47:tec(?:[-:_]|$)/i.test(s)) return true;
      return false;
    },

    _appliedKey(id) { return this.APPLY_KEY_PREFIX + String(id || ''); },
    _getApplied(id) { try { return localStorage.getItem(this._appliedKey(id)) || ''; } catch (_) { return ''; } },
    _setApplied(id, epoch) { try { localStorage.setItem(this._appliedKey(id), String(epoch || '')); } catch (e) { quiet(e, 'tec-reset-marker-local'); } },

    _sanitizeSyncBookkeeping(id) {
      const pfx = 'diario-estudos:u:' + id + ':';
      const revKey = pfx + '__secrev';
      try {
        const revs = JSON.parse(localStorage.getItem(revKey) || '{}') || {};
        let changed = false;
        Object.keys(revs).forEach(sec => { if (this.isTecSection(sec)) { delete revs[sec]; changed = true; } });
        if (changed) localStorage.setItem(revKey, JSON.stringify(revs));
      } catch (e) { quiet(e, 'tec-reset-revs'); }
      for (const suffix of ['__secpend','__secdel']) {
        const key = pfx + suffix;
        try {
          const arr = JSON.parse(localStorage.getItem(key) || '[]');
          if (!Array.isArray(arr)) continue;
          const next = arr.filter(sec => !this.isTecSection(sec));
          if (next.length) localStorage.setItem(key, JSON.stringify(next));
          else localStorage.removeItem(key);
        } catch (e) { quiet(e, 'tec-reset-' + suffix); }
      }
      try {
        const S = window.SectionSync;
        if (S && S._dirty) [...S._dirty].forEach(sec => { if (this.isTecSection(sec)) S._dirty.delete(sec); });
        if (S && S._savePend) S._savePend();
        if (S && S._seededProfile === id) S._seededProfile = null;
      } catch (e) { quiet(e, 'tec-reset-section-memory'); }
    },

    clearLocal(id, epoch, markApplied = true) {
      if (!id) return 0;
      const pfx = 'diario-estudos:u:' + id + ':';
      const keys = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (key.startsWith(pfx) && this.isTecSection(key.slice(pfx.length))) keys.push(key);
          else if (key.startsWith('diario-estudos:') && !key.startsWith('diario-estudos:u:')) {
            const globalSection = key.slice('diario-estudos:'.length);
            if (this.isTecSection(globalSection)) keys.push(key);
          }
        }
        keys.forEach(key => localStorage.removeItem(key));
      } catch (e) { quiet(e, 'tec-reset-local'); }
      this._sanitizeSyncBookkeeping(id);
      if (markApplied && epoch) this._setApplied(id, epoch);
      try {
        window.postMessage({ source:'StudyNoMentorApp', type:'tec-reconstruct-hard-reset', payload:{} }, location.origin);
      } catch (e) { quiet(e, 'tec-reset-companion'); }
      return keys.length;
    },

    async remoteEpoch(id) {
      const C = window.CloudStore;
      if (!id || !C || !C.isReady || !C.isReady() || !C.isLoggedIn || !C.isLoggedIn()) return null;
      const op = C.client.from('profile_sections')
        .select('data,rev,updated_at')
        .eq('profile_id', id)
        .eq('section', this.CONTROL_SECTION)
        .maybeSingle();
      const res = C._withTimeout ? await C._withTimeout(op, 8000, 'Verificar limpeza TEC') : await op;
      if (res && res.error) throw res.error;
      const data = res && res.data && res.data.data;
      if (data && typeof data === 'object' && data.epoch) return String(data.epoch);
      if (typeof data === 'string') return data;
      return null;
    },

    async applyRemoteResetIfNeeded(id) {
      if (!id) return false;
      try {
        const epoch = await this.remoteEpoch(id);
        if (!epoch || epoch <= this._getApplied(id)) return false;
        const removed = this.clearLocal(id, epoch, true);
        console.warn('[TEC reset] marcador remoto aplicado antes da hidratação:', epoch, '·', removed, 'chave(s) removida(s)');
        return true;
      } catch (e) {
        quiet(e, 'tec-reset-remote-check');
        return false;
      }
    },

    async _cleanBlob(id) {
      const C = window.CloudStore;
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await C.fetchPayload(id);
        const payload = JSON.parse(JSON.stringify(remote.payload || { data:{} }));
        if (!payload.data || typeof payload.data !== 'object') payload.data = {};
        Object.keys(payload.data).forEach(k => { if (this.isTecSection(k)) delete payload.data[k]; });
        const meta = ProfileManager.getProfiles().find(p => p.id === id) || {};
        const nextRev = Number(remote.rev || 0) + 1;
        const { data, error } = await C.client.from(C.TABLE)
          .update({ payload, rev:nextRev, updated_at:new Date().toISOString(), profile_name:meta.nome, avatar:meta.avatar, color:meta.cor })
          .eq('id', id).eq('rev', Number(remote.rev || 0)).select('rev');
        if (error) throw error;
        if (data && data.length) { ProfileManager.setRev(id, nextRev); return true; }
        await sleep(120 * (attempt + 1));
      }
      throw new Error('Conflito persistente ao limpar o blob TEC.');
    },

    async _deleteRemoteFacts(id) {
      const C = window.CloudStore;
      const rowsRes = await C.client.from('profile_sections').select('section').eq('profile_id', id);
      if (rowsRes.error) throw rowsRes.error;
      const names = [...new Set((rowsRes.data || []).map(r => r.section).filter(sec => this.isTecSection(sec)))];
      if (names.length) {
        const del = await C.client.from('profile_sections').delete().eq('profile_id', id).in('section', names);
        if (del.error) throw del.error;
      }
      const events = await C.client.from('tec_resolution_events').delete().eq('profile_id', id);
      if (events.error) throw events.error;
      return names.length;
    },

    async _writeRemoteMarker(id, epoch) {
      const C = window.CloudStore;
      const got = await C.client.from('profile_sections')
        .select('rev').eq('profile_id', id).eq('section', this.CONTROL_SECTION).maybeSingle();
      if (got.error) throw got.error;
      const rev = Number(got.data && got.data.rev || 0) + 1;
      const up = await C.client.from('profile_sections').upsert({
        profile_id:id,
        section:this.CONTROL_SECTION,
        data:{ epoch, reason:'tec-full-reset-v1' },
        rev,
        updated_at:new Date().toISOString()
      }, { onConflict:'profile_id,section' });
      if (up.error) throw up.error;
      try {
        const S = window.SectionSync;
        if (S && S._syncManifest && S._getRevs) {
          const revs = S._getRevs(id);
          await S._syncManifest(id, revs);
          if (S._saveRevs) S._saveRevs(revs, id);
        }
      } catch (e) { quiet(e, 'tec-reset-manifest'); }
    },

    async resetActive() {
      if (this._running) return this._running;
      const id = activeProfile();
      const C = window.CloudStore;
      if (!id || !C || !C.isReady || !C.isReady() || !C.isLoggedIn || !C.isLoggedIn()) {
        if (typeof showToast === 'function') showToast('Entre na sua conta e abra o perfil antes de zerar o TEC.');
        return false;
      }
      const confirmed = await UI.confirm(
        'Isso remove do perfil aberto TODOS os dados derivados da integração TEC: questões, eventos, históricos reconstruídos, incidência importada, Radar TEC e filas técnicas.\n\nOs demais dados de estudo, planejamentos, registros, ciclo, leis, cards e atividades extras não serão apagados.\n\nVocê reconstruirá os cadernos do zero depois.',
        { title:'⚠ Zerar integração TEC', okText:'Zerar TEC deste perfil' });
      if (!confirmed) return false;

      this._running = (async () => {
        const epoch = new Date().toISOString();
        try {
          if (typeof showToast === 'function') showToast('Preparando limpeza TEC…');
          try { if (C.flushPending) await C.flushPending(); } catch (e) { quiet(e, 'tec-reset-flush-before'); }
          const localCount = this.clearLocal(id, null, false);
          const sectionCount = await this._deleteRemoteFacts(id);
          await this._cleanBlob(id);
          await this._writeRemoteMarker(id, epoch);
          this._setApplied(id, epoch);
          try { if (window.__idbFlush) await window.__idbFlush(); } catch (e) { quiet(e, 'tec-reset-idb-flush'); }
          try { if (window.TecIntegracaoScreen && TecIntegracaoScreen.render) TecIntegracaoScreen.render(); } catch (e) { quiet(e, 'tec-reset-render'); }
          scheduleSoftRefresh('TEC zerado');
          if (typeof showToast === 'function') showToast('Integração TEC zerada ✓ agora reconstrua seus cadernos.');
          console.warn('[TEC reset] concluído', { localCount, sectionCount, epoch });
          return true;
        } catch (e) {
          console.error('[TEC reset] falhou', e);
          if (typeof showToast === 'function') showToast('A limpeza TEC não terminou: ' + String(e && e.message || e));
          return false;
        } finally {
          this._running = null;
        }
      })();
      return this._running;
    },

    installButton() {
      if (document.getElementById('tec-full-reset-v1')) return true;
      const card = document.getElementById('tec-reconstruction-card');
      if (!card) return false;
      const cancel = document.getElementById('tec-reconstruction-cancel');
      const host = cancel && cancel.parentElement ? cancel.parentElement : card;
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'tec-full-reset-v1';
      button.className = 'btn-secondary';
      button.textContent = 'Zerar dados TEC';
      button.title = 'Remove apenas os dados da integração TEC deste perfil e preserva o restante do estudo.';
      host.appendChild(button);
      button.addEventListener('click', () => this.resetActive());
      return true;
    }
  };
  window.TecDataReset = TecDataReset;

  /* ───────────────────── SEÇÕES + SOFT REFRESH ─────────────────────────── */
  function patchSectionSync() {
    const S = window.SectionSync;
    if (!S || S.__startupStabilityPatched) return false;
    S.__startupStabilityPatched = true;

    const originalSectionForKey = S.sectionForKey.bind(S);
    S.sectionForKey = function(fullKey, prefixo) {
      const section = originalSectionForKey(fullKey, prefixo);
      return section && !isLocalOnly(section) ? section : null;
    };

    try {
      if (S._dirty && S._dirty.size) {
        [...S._dirty].forEach(sec => { if (isLocalOnly(sec)) S._dirty.delete(sec); });
        if (S._savePend) S._savePend();
      }
    } catch (e) { quiet(e, 'section-local-only-clean'); }

    // Corrige a consulta de revisão: o método original ignorava o `id` recebido e
    // lia as revisões do perfil ATIVO. Um callback atrasado do perfil anterior
    // podia, portanto, anunciar atualização inexistente no perfil atual.
    S.hasRemoteUpdates = async function(id) {
      if (!id || !window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return false;
      const { data, error } = await CloudStore.client.from(this.TABLE).select('section,rev').eq('profile_id', id);
      if (error) throw error;
      const locais = this._getRevs(id);
      return (data || []).some(r => Number(r.rev || 0) > Number(locais[r.section] && locais[r.section].rev || 0));
    };

    S.pullAndReload = async function() {
      const id = activeProfile();
      if (!id) return false;
      await TecDataReset.applyRemoteResetIfNeeded(id);
      const r = await CloudStore.aplicando(() => this.hydrate(id));
      if (!r || !r.ok) return false;
      if (!r.mudou) {
        try { console.info('[SectionSync] nuvem conferida: nada mudou, sem recarregar'); }
        catch (e) { quiet(e, 'section-sync-info'); }
        return true;
      }
      try { if (typeof showToast === 'function') showToast('Sincronizado da nuvem ✓'); }
      catch (e) { quiet(e, 'section-sync-toast'); }
      scheduleSoftRefresh('dados novos da nuvem');
      return true;
    };
    return true;
  }

  /* ─────────────────────── REALTIME POR PERFIL ─────────────────────────── */
  function patchRealtimeSubscriptions() {
    const C = window.CloudStore;
    if (!C || C.__profileRealtimePatched) return false;
    C.__profileRealtimePatched = true;

    const remove = channel => {
      try { if (channel && C.client) C.client.removeChannel(channel); } catch (e) { quiet(e, 'realtime-remove'); }
    };

    C.subscribeRealtime = function() {
      if (!this.isReady() || !this.isLoggedIn()) return;
      const uid = this.session && this.session.user && this.session.user.id;
      if (!uid) return;
      if (this.channel && this._rtUserId === uid) return;
      if (this.channel) remove(this.channel);
      this.channel = null;
      this._rtUserId = uid;
      try {
        this.channel = this.client.channel('sp_rt_' + String(uid).slice(0,8))
          .on('postgres_changes', { event:'*', schema:'public', table:this.TABLE, filter:'user_id=eq.' + uid }, p => this._onRealtime(p))
          .subscribe();
      } catch (e) { this.channel = null; console.warn('realtime indisponível', e); }
    };

    C.subscribeSections = function(profileId) {
      if (!this.isReady() || !this.isLoggedIn()) return;
      const pid = String(profileId || '');
      if (!pid || !profileConfirmed(pid)) return;
      if (this.secChannel && this._secProfileId === pid) return;
      if (this.secChannel) remove(this.secChannel);
      this.secChannel = null;
      this._secProfileId = pid;
      clearTimeout(this._secRtTimer);
      try {
        this.secChannel = this.client.channel('sec_rt_' + pid.slice(0,8))
          .on('postgres_changes', { event:'*', schema:'public', table:'profile_sections', filter:'profile_id=eq.' + pid }, () => {
            // Callback antigo jamais atua sobre o perfil novo.
            if (!profileConfirmed(pid) || this._secProfileId !== pid) return;
            clearTimeout(this._secRtTimer);
            this._secRtTimer = setTimeout(() => {
              if (profileConfirmed(pid) && this._secProfileId === pid) this._onSectionRealtime(pid);
            }, 1200);
          })
          .subscribe();
      } catch (e) { this.secChannel = null; this._secProfileId = null; console.warn('realtime de seções indisponível', e); }
    };

    const originalUnsub = C._unsub.bind(C);
    C._unsub = function() {
      try { originalUnsub(); } finally { this._rtUserId = null; this._secProfileId = null; }
    };

    const originalSectionRealtime = C._onSectionRealtime.bind(C);
    C._onSectionRealtime = async function(pid) {
      if (!profileConfirmed(String(pid || '')) || this._secProfileId !== String(pid || '')) return;
      return originalSectionRealtime(pid);
    };
    return true;
  }

  /* ───────────────────── AUTH SEM EFEITO DUPLICADO ─────────────────────── */
  function patchAuthLifecycle() {
    const C = window.CloudStore, Sg = window.SessionGuard;
    if (!C || C.__authLifecyclePatched) return false;
    C.__authLifecyclePatched = true;

    C.onAuth = function() {
      const uid = this.session && this.session.user ? this.session.user.id : null;
      const state = uid || 'anon';

      // UI pode refletir token/estado em todos os eventos; efeitos caros só quando
      // o usuário realmente muda. getSession + INITIAL_SESSION não duplicam boot.
      try { if (window.ProfileUI) ProfileUI.onAuthChanged(); } catch (e) { quiet(e, 'auth-profile-ui'); }
      try { if (window.CloudUI) CloudUI.refreshSyncBtn(); } catch (e) { quiet(e, 'auth-cloud-ui'); }
      if (this.__authLifecycleState === state) return;
      this.__authLifecycleState = state;

      if (!uid) {
        try { this._unsub(); } catch (e) { quiet(e, 'auth-unsub'); }
        try { if (Sg) Sg.onLogout(); } catch (e) { quiet(e, 'auth-session-logout'); }
        this.__startupSideEffectsUid = null;
        return;
      }

      try { this.subscribeRealtime(); } catch (e) { quiet(e, 'auth-rt'); }
      const pid = activeProfile();
      if (pid && profileConfirmed(pid)) {
        try { this.subscribeSections(pid); } catch (e) { quiet(e, 'auth-sec-rt'); }
      }
      try { if (Sg) Sg.onLogin(); } catch (e) { quiet(e, 'auth-session-login'); }

      if (this.__startupSideEffectsUid === uid) return;
      this.__startupSideEffectsUid = uid;
      setTimeout(() => {
        const current = activeProfile();
        if (!current || !profileConfirmed(current)) return;
        try { if (window.SectionSync) SectionSync.kick(); } catch (e) { quiet(e, 'auth-section-kick'); }
      }, 700);
      setTimeout(() => { try { if (window.BackupHistory) BackupHistory.limpar(); } catch (e) { quiet(e, 'auth-backup-clean'); } }, 1800);
      setTimeout(() => { try { if (window.ProfileManager) ProfileManager.migrarIdsAntigos(); } catch (e) { quiet(e, 'auth-profile-migrate'); } }, 2800);
    };

    // Sessão restaurada: primeiro verifica o dono atual. Só reivindica
    // automaticamente se não existir dono ou se já for este dispositivo.
    if (Sg && !Sg.__checkBeforeClaimPatched) {
      Sg.__checkBeforeClaimPatched = true;
      Sg._loginCheckPromise = null;
      Sg._loginCheckUid = null;
      Sg.onLogin = async function() {
        if (!this.enabled) return false;
        const CS = window.CloudStore;
        if (!CS || !CS.isReady() || !CS.isLoggedIn()) return false;
        const uid = CS.session.user.id;
        this.subscribe(uid);
        if (this._claimedUid === uid) return true;
        if (this._loginCheckPromise && this._loginCheckUid === uid) return this._loginCheckPromise;
        this._loginCheckUid = uid;
        this._loginCheckPromise = (async () => {
          try {
            const { data, error } = await CS.client.from(this.TABLE)
              .select('device_id,device_label').eq('user_id', uid).maybeSingle();
            if (error) {
              if (this._isMissingTable(error)) { this._disable(error); return false; }
              console.warn('[SessionGuard] check-before-claim falhou', error);
              return false;
            }
            if (!data || !data.device_id) {
              const ok = await this.claim(uid);
              if (ok) this._claimedUid = uid;
              return ok;
            }
            if (data.device_id === this.deviceId()) {
              this._claimedUid = uid;
              if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
              return true;
            }
            this._claimedUid = null;
            this._takenBy(data);
            return false;
          } catch (e) {
            if (this._isMissingTable(e)) this._disable(e);
            else console.warn('[SessionGuard] check-before-claim erro', e);
            return false;
          } finally {
            this._loginCheckPromise = null;
            this._loginCheckUid = null;
          }
        })();
        return this._loginCheckPromise;
      };

      // Login digitado é intenção explícita de usar ESTE aparelho: depois que o
      // Supabase confirma a senha, este dispositivo pode assumir a sessão.
      const originalSignIn = C.signIn.bind(C);
      C.signIn = async function(email, password) {
        const data = await originalSignIn(email, password);
        try {
          if (data && data.session) {
            this.session = data.session;
            const ok = await Sg.claim(data.session.user.id);
            if (ok) {
              Sg._claimedUid = data.session.user.id;
              if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') SessionLock.unblock();
            }
          }
        } catch (e) { quiet(e, 'signin-claim'); }
        return data;
      };
    }
    return true;
  }

  /* ───────────────────── PERFIL: PREFLIGHT ÚNICO ───────────────────────── */
  function patchProfileEntry() {
    const P = window.ProfileUI;
    if (!P || P.__deterministicEntryPatched || typeof P.enterProfile !== 'function') return false;
    P.__deterministicEntryPatched = true;
    const original = P.enterProfile.bind(P);
    P.enterProfile = async function(id) {
      try { if (typeof window.__idbHydrateProfile === 'function') await window.__idbHydrateProfile(id); } catch (e) { quiet(e, 'entry-idb-hydrate'); }
      try { await TecDataReset.applyRemoteResetIfNeeded(id); } catch (e) { quiet(e, 'entry-tec-reset'); }
      const result = await original(id);
      try {
        if (profileConfirmed(id) && window.CloudStore) {
          CloudStore.subscribeSections(id);
          if (window.SectionSync) SectionSync.kick();
        }
      } catch (e) { quiet(e, 'entry-postflight'); }
      return result;
    };
    return true;
  }

  function patchReload() {
    const original = window.recarregarApp;
    if (typeof original !== 'function' || original.__startupStabilityPatched) return false;

    function guardedReload(reason, opts) {
      const why = String(reason || '');
      const current = activeProfile();

      if (why === 'entrada no perfil com dados novos' && ACTIVE_AT_LOAD && current === ACTIVE_AT_LOAD) {
        scheduleSoftRefresh(why);
        try {
          if (window.ProfileUI) {
            ProfileUI._entering = false;
            if (ProfileUI.hideGate) ProfileUI.hideGate();
            if (ProfileUI.renderChip) ProfileUI.renderChip();
          }
          if (profileConfirmed(current) && window.CloudStore) CloudStore.subscribeSections(current);
        } catch (e) { quiet(e, 'login-soft-refresh'); }
        return;
      }

      if (!(opts && opts.imediato) && /^dados novos da nuvem/.test(why)) {
        scheduleSoftRefresh(why);
        return;
      }
      return original(reason, opts);
    }
    guardedReload.__startupStabilityPatched = true;
    guardedReload.__original = original;
    window.recarregarApp = guardedReload;
    try { recarregarApp = guardedReload; }
    catch (e) { quiet(e, 'reload-global-alias'); }
    return true;
  }

  function patchFocusSync() {
    const C = window.CloudStore;
    if (!C || !C.syncOnFocus || C.__focusDedupPatched) return false;
    C.__focusDedupPatched = true;
    const original = C.syncOnFocus.bind(C);
    let running = null;
    C.syncOnFocus = function() {
      if (running) return running;
      running = Promise.resolve().then(async () => {
        const id = activeProfile();
        if (id) await TecDataReset.applyRemoteResetIfNeeded(id);
        if (id && profileConfirmed(id)) this.subscribeSections(id);
        return original();
      }).finally(() => { running = null; });
      return running;
    };
    return true;
  }

  const StartupCoordinator = {
    status() {
      const C = window.CloudStore, Sg = window.SessionGuard;
      return {
        activeProfile: activeProfile(),
        enteredProfile: enteredProfile(),
        authUserReady: !!(C && C.isLoggedIn && C.isLoggedIn()),
        authLifecycleState: C && C.__authLifecycleState || null,
        realtimeProfile: C && C._secProfileId || null,
        sessionClaimed: Sg && Sg._claimedUid || null,
        sectionPending: (() => { try { return window.SectionSync ? SectionSync.pendingQuick() : 0; } catch (_) { return null; } })(),
        tecResetMarker: activeProfile() ? TecDataReset._getApplied(activeProfile()) : null
      };
    }
  };
  window.StartupCoordinator = StartupCoordinator;

  function patchAll() {
    patchRealtimeSubscriptions();
    patchAuthLifecycle();
    patchSectionSync();
    patchProfileEntry();
    patchReload();
    patchFocusSync();
    TecDataReset.installButton();
  }

  patchAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchAll, { once:true });
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    patchAll();
    if (tries > 120 || (window.CloudStore && window.SectionSync && window.ProfileUI && TecDataReset.installButton())) clearInterval(timer);
  }, 250);
})();
