/* ============================================================================
   STARTUP HOT HYDRATION — guardas do app
   ----------------------------------------------------------------------------
   A camada IndexedDB abre somente o perfil ativo no caminho crítico. Este módulo
   conecta essa otimização ao restante do app sem mudar a semântica dos dados:
   • antes de abrir/trocar para outro perfil, hidrata o namespace dele;
   • perfis frios continuam sendo reconhecidos como existentes localmente pelo
     índice de chaves do IndexedDB, evitando que a reconciliação os esconda;
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

  function patchProfileUI() {
    const P = window.ProfileUI;
    if (!P || P.__hotHydrationPatched || typeof P.enterProfile !== 'function') return false;
    P.__hotHydrationPatched = true;
    const original = P.enterProfile.bind(P);
    P.enterProfile = async function(id) {
      await ensureProfile(id);
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
