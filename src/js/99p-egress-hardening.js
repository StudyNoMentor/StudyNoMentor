/* ============================================================================
   EGRESS HARDENING — conteúdo grande nunca trafega por Postgres Changes
   ----------------------------------------------------------------------------
   Motivo:
   - study_profiles.payload pode ultrapassar 1 MB por perfil;
   - profile_sections.data pode chegar a centenas de KB;
   - Postgres Changes envia a linha alterada aos assinantes. Repetir isso a cada
     autosave transforma pequenas edições locais em GB de egress.

   Política:
   - conteúdo de estudo: sincronização explícita em startup/foco/ação manual;
   - Realtime continua reservado a sinais pequenos (ex.: active_sessions e TEC);
   - foco é deduplicado por uma janela curta quando não existe pendência local.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__snmEgressHardening) return;
  window.__snmEgressHardening = true;

  const FOCUS_MIN_INTERVAL_MS = 15000;
  let lastFocusSyncAt = 0;
  let focusRunning = null;

  function quiet(e, tag) {
    try { if (typeof _quiet === 'function') _quiet(e, tag || 'egress-hardening'); }
    catch (_) { /* diagnóstico nunca quebra o app */ }
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
    try { clearTimeout(C._secRtTimer); } catch (_) {}
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

    /* Mesmo que study_profiles/profile_sections sejam recolocados por engano na
       publication do Supabase, este cliente NÃO os assina. */
    C.subscribeRealtime = function() {
      disconnectHeavyRealtime(this);
      return false;
    };
    C.subscribeSections = function() {
      removeChannel(this, 'secChannel');
      try { clearTimeout(this._secRtTimer); } catch (_) {}
      this._secRtTimer = null;
      this._secProfileId = null;
      return false;
    };

    /* O fluxo existente já sabe comparar revisões e puxar somente quando há
       novidade. A proteção abaixo apenas evita várias execuções consecutivas de
       focus/pageshow/visibilitychange quando nada local está pendente. */
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
    catch (_) {}
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
