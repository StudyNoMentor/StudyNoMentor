/* ============================================================================
   ESTABILIDADE DE ABERTURA + GUARDA DE SINCRONIZAÇÃO
   ----------------------------------------------------------------------------
   Objetivos:
   1) sincronização em segundo plano nunca deve ficar recarregando a página;
   2) entrar novamente no MESMO perfil aplica dados novos sem hard reload;
   3) troca real de perfil / logout / atualização de versão continua podendo
      recarregar, porque nesses casos limpar estado em memória é desejável;
   4) telemetria e bookkeeping locais do TEC não entram no SectionSync.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__snmStartupStability) return;
  window.__snmStartupStability = true;

  const ACTIVE_AT_LOAD = (() => {
    try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
    catch (_) { return null; }
  })();

  const LOCAL_ONLY_EXACT = new Set([
    'tec-capture-log-v1'
  ]);
  const LOCAL_ONLY_PREFIX = [
    'tec-cloud-ledger:'
  ];

  const isLocalOnly = (section) => {
    const s = String(section || '');
    return LOCAL_ONLY_EXACT.has(s) || LOCAL_ONLY_PREFIX.some(p => s.startsWith(p));
  };

  let softTimer = null;
  let softReasons = [];
  function activeScreenName() {
    try {
      const el = document.querySelector('.screen.active');
      return el && el.id && el.id.startsWith('screen-') ? el.id.slice(7) : null;
    } catch (_) { return null; }
  }

  function softRefreshNow() {
    softTimer = null;
    const reasons = softReasons.splice(0);
    try { if (window.PlanManager && PlanManager.init) PlanManager.init(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'soft-refresh-plan'); }
    try { if (window.ProfileUI && ProfileUI.renderChip) ProfileUI.renderChip(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'soft-refresh-profile'); }
    try { if (window.CloudUI && CloudUI.render) CloudUI.render(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'soft-refresh-cloud'); }
    try { if (window.TecIntegracaoScreen && TecIntegracaoScreen.render) TecIntegracaoScreen.render(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'soft-refresh-tec'); }
    try { if (window.TecRealtime && TecRealtime.render) TecRealtime.render(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'soft-refresh-radar'); }
    try { if (window.TecLacunasContinuas && TecLacunasContinuas.refresh) TecLacunasContinuas.refresh('cloud-soft-refresh'); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'soft-refresh-lacunas'); }

    const screen = activeScreenName();
    try {
      if (screen) window.dispatchEvent(new CustomEvent('screen:activated', { detail:{ screen, reason:'cloud-soft-refresh' } }));
      window.dispatchEvent(new CustomEvent('study:cloud-applied', { detail:{ reasons, screen, at:new Date().toISOString() } }));
    } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'soft-refresh-event'); }
  }

  function scheduleSoftRefresh(reason) {
    softReasons.push(String(reason || 'sincronização'));
    clearTimeout(softTimer);
    // Pequeno debounce: uma rajada de seções remotas vira UMA atualização visual.
    softTimer = setTimeout(softRefreshNow, 180);
  }
  window.__snmSoftRefresh = scheduleSoftRefresh;

  function patchSectionSync() {
    const S = window.SectionSync;
    if (!S || S.__startupStabilityPatched) return false;
    S.__startupStabilityPatched = true;

    // Bookkeeping e diagnóstico locais nunca devem gerar revisão remota.
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
    } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'section-local-only-clean'); }

    // A nuvem já foi aplicada ao localStorage pelo hydrate(). Em vez de um
    // location.reload(), re-renderizamos a tela ativa. Isso elimina a cascata
    // "login -> foco -> seção nova -> reload -> foco -> reload".
    S.pullAndReload = async function() {
      const id = window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null;
      if (!id) return false;
      const r = await CloudStore.aplicando(() => this.hydrate(id));
      if (!r || !r.ok) return false;
      if (!r.mudou) {
        try { console.info('[SectionSync] nuvem conferida: nada mudou, sem recarregar'); } catch (_) {}
        return true;
      }
      try { if (typeof showToast === 'function') showToast('Sincronizado da nuvem ✓'); } catch (_) {}
      scheduleSoftRefresh('dados novos da nuvem');
      return true;
    };
    return true;
  }

  function patchReload() {
    const original = window.recarregarApp;
    if (typeof original !== 'function' || original.__startupStabilityPatched) return false;

    function guardedReload(reason, opts) {
      const why = String(reason || '');
      const current = (() => {
        try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
        catch (_) { return null; }
      })();

      // Login no mesmo perfil: hydrate já escreveu o dado correto no armazenamento.
      // Uma atualização visual é suficiente; hard reload só acrescentava piscadas.
      if (why === 'entrada no perfil com dados novos' && ACTIVE_AT_LOAD && current === ACTIVE_AT_LOAD) {
        scheduleSoftRefresh(why);
        try {
          if (window.ProfileUI) {
            ProfileUI._entering = false;
            if (ProfileUI.hideGate) ProfileUI.hideGate();
            if (ProfileUI.renderChip) ProfileUI.renderChip();
          }
        } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'login-soft-refresh'); }
        return;
      }

      // Qualquer sincronização automática que já aplicou os dados deve atualizar
      // a interface, não reiniciar a aplicação durante o estudo.
      if (!(opts && opts.imediato) && /^dados novos da nuvem/.test(why)) {
        scheduleSoftRefresh(why);
        return;
      }
      return original(reason, opts);
    }
    guardedReload.__startupStabilityPatched = true;
    guardedReload.__original = original;
    window.recarregarApp = guardedReload;
    try { recarregarApp = guardedReload; } catch (_) {}
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
      running = Promise.resolve().then(() => original()).finally(() => { running = null; });
      return running;
    };
    return true;
  }

  function patchAll() {
    patchSectionSync();
    patchReload();
    patchFocusSync();
  }

  patchAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchAll, { once:true });
  setTimeout(patchAll, 0);
})();
