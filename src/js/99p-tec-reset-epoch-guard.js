/* ============================================================================
   TEC RESET EPOCH GUARD
   ----------------------------------------------------------------------------
   Uma limpeza TEC precisa ser monotônica: nenhum envelope factual capturado
   antes da limpeza pode reaparecer depois através da fila durável do Companion.

   Regra:
   - o reset grava um epoch por perfil (`TecDataReset._getApplied`);
   - envelope normal do Companion traz `payload.capturedAt`;
   - se capturedAt < epoch, o envelope é ACKado e descartado;
   - a DATA DA RESOLUÇÃO não participa desta decisão. Assim, uma reconstrução
     feita hoje de uma questão resolvida meses atrás continua válida, pois sua
     captura/reconstrução ocorreu depois do reset.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecResetEpochGuard) return;
  window.__tecResetEpochGuard = true;

  const quiet = (e, tag) => {
    try { if (typeof _quiet === 'function') _quiet(e, tag || 'tec-reset-epoch'); }
    catch (ignored) { void ignored; }
  };

  function activeProfile() {
    try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
    catch (_) { return null; }
  }

  function captureInstant(payload) {
    const candidates = [
      payload && payload.capturedAt,
      payload && payload.question && payload.question.capturadoEm,
      payload && payload.provenance && payload.provenance.capturedAt,
      payload && payload.receivedAt
    ];
    for (const raw of candidates) {
      if (!raw) continue;
      const t = Date.parse(String(raw));
      if (Number.isFinite(t)) return t;
    }
    return null;
  }

  function resetInstant(profileId) {
    try {
      const D = window.TecDataReset;
      if (!D || typeof D._getApplied !== 'function' || !profileId) return null;
      const raw = D._getApplied(profileId);
      const t = raw ? Date.parse(String(raw)) : NaN;
      return Number.isFinite(t) ? t : null;
    } catch (e) { quiet(e, 'tec-reset-epoch-read'); return null; }
  }

  function patch() {
    const R = window.TecRealtime;
    const D = window.TecDataReset;
    if (!R || !D || R.__resetEpochGuardPatched || typeof R.ingest !== 'function') return false;
    R.__resetEpochGuardPatched = true;

    const originalIngest = R.ingest.bind(R);
    R.ingest = function(payload, messageId) {
      const profileId = activeProfile();
      const epoch = resetInstant(profileId);
      const captured = captureInstant(payload);

      // Só descartamos quando há DUAS evidências temporais válidas. Payload sem
      // capturedAt nunca é presumido antigo, para não perder dado legítimo.
      if (epoch != null && captured != null && captured < epoch) {
        try { if (typeof this.ack === 'function') this.ack(messageId); } catch (e) { quiet(e, 'tec-reset-stale-ack'); }
        try {
          console.warn('[TEC reset] envelope anterior à limpeza descartado', {
            profileId,
            messageId:String(messageId || ''),
            capturedAt:new Date(captured).toISOString(),
            resetAt:new Date(epoch).toISOString()
          });
        } catch (e) { quiet(e, 'tec-reset-stale-log'); }
        return { ok:true, dropped:true, reason:'pre-reset-capture' };
      }
      return originalIngest(payload, messageId);
    };
    return true;
  }

  patch();
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (patch() || tries >= 120) clearInterval(timer);
  }, 250);
})();

/* ============================================================================
   EGRESS HARDENING — conteúdo grande nunca trafega por Postgres Changes
   ----------------------------------------------------------------------------
   study_profiles.payload pode ultrapassar 1 MB e profile_sections.data pode
   chegar a centenas de KB. Postgres Changes transmite a linha alterada para cada
   assinante; autosaves frequentes transformavam pequenas edições em GB de egress.

   Política:
   - conteúdo de estudo usa sincronização explícita no startup, foco e ação manual;
   - Realtime fica reservado a sinais pequenos (ex.: active_sessions e TEC);
   - eventos repetidos de focus/pageshow/visibilitychange são deduplicados quando
     não existe alteração local pendente.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__snmEgressHardening) return;
  window.__snmEgressHardening = true;

  const FOCUS_MIN_INTERVAL_MS = 15000;
  let lastFocusSyncAt = 0;
  let focusRunning = null;

  function quiet(e, tag) {
    try { if (typeof _quiet === 'function') _quiet(e, tag || 'egress-hardening'); }
    catch (ignored) { void ignored; }
  }

  function pendingLocal(C) {
    try {
      if (C && (C._pending || C._debounce || C._syncing)) return true;
      return !!(window.SectionSync && SectionSync.pendingQuick && SectionSync.pendingQuick() > 0);
    } catch (_) { return false; }
  }

  function removeChannel(C, key) {
    const ch = C && C[key];
    if (!ch) return;
    try { if (C.client && C.client.removeChannel) C.client.removeChannel(ch); }
    catch (e) { quiet(e, 'egress-remove-' + key); }
    C[key] = null;
  }

  function disconnectHeavyRealtime(C) {
    if (!C) return;
    removeChannel(C, 'channel');
    removeChannel(C, 'secChannel');
    try { clearTimeout(C._secRtTimer); } catch (e) { quiet(e, 'egress-clear-section-timer'); }
    C._secRtTimer = null;
    C._rtUserId = null;
    C._secProfileId = null;
  }

  function patch() {
    const C = window.CloudStore;
    if (!C || C.__egressHardeningPatched) return false;
    C.__egressHardeningPatched = true;
    C.CONTENT_REALTIME_MODE = 'explicit-pull-v1';
    C.CONTENT_REALTIME_DISABLED_REASON = 'avoid-large-row-egress';

    // Defesa no cliente: mesmo que as tabelas pesadas sejam republicadas no
    // Supabase futuramente, este app não volta a assinar esses Postgres Changes.
    C.subscribeRealtime = function() {
      disconnectHeavyRealtime(this);
      return false;
    };
    C.subscribeSections = function() {
      removeChannel(this, 'secChannel');
      try { clearTimeout(this._secRtTimer); } catch (e) { quiet(e, 'egress-clear-subscription-timer'); }
      this._secRtTimer = null;
      this._secProfileId = null;
      return false;
    };

    if (typeof C.syncOnFocus === 'function' && !C.syncOnFocus.__egressPatched) {
      const original = C.syncOnFocus.bind(C);
      const guarded = function() {
        if (focusRunning) return focusRunning;
        const force = pendingLocal(this);
        const now = Date.now();
        if (!force && now - lastFocusSyncAt < FOCUS_MIN_INTERVAL_MS) return Promise.resolve(false);
        lastFocusSyncAt = now;
        focusRunning = Promise.resolve()
          .then(() => original())
          .finally(() => { focusRunning = null; });
        return focusRunning;
      };
      guarded.__egressPatched = true;
      guarded.__original = original;
      C.syncOnFocus = guarded;
    }

    disconnectHeavyRealtime(C);

    window.EgressGuard = {
      mode: C.CONTENT_REALTIME_MODE,
      focusMinIntervalMs: FOCUS_MIN_INTERVAL_MS,
      status() {
        return {
          mode: C.CONTENT_REALTIME_MODE,
          heavyRealtimeConnected: !!(C.channel || C.secChannel),
          lastFocusSyncAt: lastFocusSyncAt || null,
          focusRunning: !!focusRunning,
          localPending: pendingLocal(C),
          activeProfile: (() => {
            try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
            catch (_) { return null; }
          })()
        };
      }
    };

    try { console.info('[egress] Realtime pesado desativado; conteúdo usa pull explícito.'); }
    catch (e) { quiet(e, 'egress-info-log'); }
    return true;
  }

  patch();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch, { once:true });
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (patch() || (window.CloudStore && window.CloudStore.__egressHardeningPatched) || tries > 120) clearInterval(timer);
  }, 250);
})();
