/* ============================================================================
   STARTUP HOT HYDRATION — guardas do app
   ----------------------------------------------------------------------------
   A camada IndexedDB abre somente o perfil ativo no caminho crítico. Este módulo
   conecta essa otimização ao restante do app sem mudar a semântica dos dados:
   • antes de abrir/trocar para outro perfil, hidrata o namespace dele;
   • o MESMO perfil já seguro neste aparelho fica visível sem aguardar rede;
   • a reconciliação remota ocorre em segundo plano, mas o reset TEC remoto é
     conferido ANTES de qualquer kick/upload para não ressuscitar dado antigo;
   • perfis frios continuam reconhecidos pelo índice do IndexedDB;
   • expõe diagnóstico simples de startup para medir ganho em máquina real.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__startupHotHydrationGuards) return;
  window.__startupHotHydrationGuards = true;

  const quiet = (e, tag) => {
    try { if (typeof _quiet === 'function') _quiet(e, tag || 'startup-hot'); }
    catch (ignored) { void ignored; }
  };

  async function ensureProfile(id) {
    if (!id || typeof window.__idbHydrateProfile !== 'function') return false;
    const t0 = performance && performance.now ? performance.now() : Date.now();
    try {
      const ok = await window.__idbHydrateProfile(id);
      const ms = Math.round((performance && performance.now ? performance.now() : Date.now()) - t0);
      if (window.StartupTrace && StartupTrace.mark) StartupTrace.mark('perfil-frio-hidratado', { id:String(id), ms });
      return ok;
    } catch (e) {
      quiet(e, 'hydrate-profile-on-demand');
      return false;
    }
  }
  window.__ensureStudyProfileHydrated = ensureProfile;

  function canOpenLocalNow(P, id) {
    try {
      const C = window.CloudStore;
      if (!id || !C || !C.isReady || !C.isReady() || !C.isLoggedIn || !C.isLoggedIn()) return false;
      if (!window.ProfileManager || ProfileManager.getActiveProfileId() !== id) return false;
      if (!P._hasLocalData || !P._hasLocalData(id)) return false;
      const uid = C.session && C.session.user && C.session.user.id;
      if (ProfileManager._podeVerLocal && !ProfileManager._podeVerLocal(id, uid)) return false;
      return true;
    } catch (e) {
      quiet(e, 'local-first-check');
      return false;
    }
  }

  function reconcileLocalProfileInBackground(id) {
    setTimeout(async () => {
      try {
        /* Ordem deliberada: marcador de reset primeiro. Só depois consultamos
           revisões e/ou liberamos a fila local. Assim a tela abre instantânea,
           mas nenhum TEC anterior ao reset volta para a nuvem. */
        if (window.TecDataReset && TecDataReset.applyRemoteResetIfNeeded) {
          await TecDataReset.applyRemoteResetIfNeeded(id);
        }
        if (!window.ProfileManager || ProfileManager.getActiveProfileId() !== id) return;
        const S = window.SectionSync;
        if (!S) return;
        let remote = false;
        try { if (S.hasRemoteUpdates) remote = !!(await S.hasRemoteUpdates(id)); }
        catch (e) { quiet(e, 'local-first-remote-check'); }
        if (!window.ProfileManager || ProfileManager.getActiveProfileId() !== id) return;
        if (remote && S.pullAndReload) await S.pullAndReload();
        else if (S.kick) S.kick();
      } catch (e) {
        quiet(e, 'local-first-reconcile');
      }
    }, 0);
  }

  function patchProfileUI() {
    const P = window.ProfileUI;
    if (!P || P.__hotHydrationPatched || typeof P.enterProfile !== 'function') return false;
    P.__hotHydrationPatched = true;
    const original = P.enterProfile.bind(P);
    P.enterProfile = async function(id) {
      await ensureProfile(id);

      if (canOpenLocalNow(P, id)) {
        try { sessionStorage.setItem(P.SESSION_KEY || 'diario-estudos:entered', id); } catch (e) { quiet(e, 'local-first-session'); }
        try { if (P.setLastProfile) P.setLastProfile(id); } catch (e) { quiet(e, 'local-first-last-profile'); }
        try {
          const C = window.CloudStore;
          const uid = C && C.session && C.session.user && C.session.user.id;
          if (ProfileManager._setOwner && uid) ProfileManager._setOwner(id, uid);
        } catch (e) { quiet(e, 'local-first-owner'); }
        P._entering = false;
        try { if (P.hideGate) P.hideGate(); } catch (e) { quiet(e, 'local-first-hide-gate'); }
        try { if (P.renderChip) P.renderChip(); } catch (e) { quiet(e, 'local-first-chip'); }
        try { if (window.DB && DB.checarEspaco) DB.checarEspaco(); } catch (e) { quiet(e, 'local-first-space'); }
        try {
          if (window.StartupTrace && StartupTrace.mark) StartupTrace.mark('perfil-local-visivel', { id:String(id), mode:'local-first-v2' });
        } catch (e) { quiet(e, 'local-first-trace'); }
        reconcileLocalProfileInBackground(id);
        return true;
      }

      return original(id);
    };
    return true;
  }

  function patchProfilePresence() {
    const P = window.ProfileManager;
    if (!P || P.__coldPresencePatched || typeof P.perfisComDadosLocais !== 'function') return false;
    P.__coldPresencePatched = true;
    const original = P.perfisComDadosLocais.bind(P);
    P.perfisComDadosLocais = function() {
      let rows = original() || [];
      try {
        const known = new Set(rows.map(x => String(x.id)));
        const cold = typeof window.__idbColdProfileIds === 'function' ? window.__idbColdProfileIds() : [];
        for (const id of cold) {
          if (!known.has(String(id)) && typeof window.__idbHasProfileNamespace === 'function' && window.__idbHasProfileNamespace(id)) {
            // Não inventamos bytes/contagens sem ler o conteúdo. A única coisa que
            // afirmamos é que o namespace existe fisicamente no IndexedDB.
            rows.push({ id:String(id), bytes:0, secoes:1, ajustes:0, bytesAjuste:0, cold:true });
            known.add(String(id));
          }
        }
      } catch (e) { quiet(e, 'cold-profile-presence'); }
      return rows;
    };
    return true;
  }

  function exposeDiagnostics() {
    window.__startup = function() {
      const stats = Object.assign({}, window.__idbStartupStats || {});
      try { stats.trace = window.StartupTrace && StartupTrace.last ? StartupTrace.last() : []; }
      catch (e) { quiet(e, 'startup-diag-trace'); stats.trace = []; }
      try { console.table(stats.trace || []); console.info('[startup]', stats); }
      catch (e) { quiet(e, 'startup-diag-console'); }
      return stats;
    };
  }

  function patchAll() {
    patchProfilePresence();
    patchProfileUI();
    exposeDiagnostics();
  }

  patchAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchAll, { once:true });
  setTimeout(patchAll, 0);
})();
