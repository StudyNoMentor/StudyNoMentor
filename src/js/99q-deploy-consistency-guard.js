/* ============================================================================
   DEPLOY CONSISTENCY GUARD
   ----------------------------------------------------------------------------
   Objetivo: uma atualização do app nunca pode exigir logout, aba anônima ou
   limpeza manual para que todos os dados apareçam.

   Há dois problemas diferentes a fechar:
   1) página e service worker podem ficar em versões distintas após um deploy;
   2) o perfil local pode parecer "em dia" pela revisão, mas estar incompleto ou
      com bookkeeping inconsistente por causa de uma versão anterior.

   Regras de segurança:
   - nunca apaga conteúdo local para "consertar";
   - nunca sobrescreve seção com alteração local pendente;
   - antes de qualquer reparo por cima de conteúdo existente, cria snapshot;
   - dado local sem prova de sincronização é preservado e reenfileirado;
   - validação profunda ocorre só uma vez por geração, evitando egress repetido;
   - a cada build novo roda uma checagem barata de manifesto/revisões.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__deployConsistencyGuard) return;
  window.__deployConsistencyGuard = true;

  const GENERATION = 'profile-integrity-v1';
  const VERSION_PREFIX = 'diario-estudos:deploy-check:';
  const DEEP_PREFIX = 'diario-estudos:deploy-deep:';
  const ALIGN_PREFIX = 'diario-estudos:deploy-align:';
  const MAX_RETRIES = 3;

  const quiet = (e, tag) => {
    try { if (typeof _quiet === 'function') _quiet(e, tag || 'deploy-consistency'); }
    catch (ignored) { void ignored; }
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function appVersion() {
    try {
      const m = document.querySelector('meta[name="diario-versao"]');
      return (m && m.getAttribute('content')) || 'dev';
    } catch (_) { return 'dev'; }
  }
  function activeProfile() {
    try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
    catch (_) { return null; }
  }
  function enteredProfile() {
    try { return sessionStorage.getItem('diario-estudos:entered') || null; }
    catch (_) { return null; }
  }
  function profileConfirmed(id) {
    return !!id && activeProfile() === id && enteredProfile() === id;
  }
  function versionKey(id) { return VERSION_PREFIX + appVersion() + ':' + String(id || ''); }
  function deepKey(id) { return DEEP_PREFIX + GENERATION + ':' + String(id || ''); }
  function getLocal(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function setLocal(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) { quiet(e, 'marker-write'); } }

  async function askWorker(worker) {
    if (!worker || typeof MessageChannel === 'undefined') return null;
    try {
      return await new Promise(resolve => {
        const ch = new MessageChannel();
        let done = false;
        const finish = v => { if (done) return; done = true; resolve(v || null); };
        ch.port1.onmessage = e => finish(e && e.data && e.data.versao);
        setTimeout(() => finish(null), 1800);
        worker.postMessage('versao', [ch.port2]);
      });
    } catch (e) { quiet(e, 'worker-version'); return null; }
  }

  function hasLocalPending() {
    try {
      const C = window.CloudStore;
      if (C && (C._pending || C._syncing || C._debounce)) return true;
      return !!(window.SectionSync && SectionSync.pendingQuick && SectionSync.pendingQuick() > 0);
    } catch (_) { return true; }
  }

  const VersionAlignment = {
    _running: null,
    _last: null,
    async run() {
      if (this._running) return this._running;
      this._running = this._run().finally(() => { this._running = null; });
      return this._running;
    },
    async _run() {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return { ok:true, reason:'sem-controller' };
      const page = appVersion();
      const controller = await askWorker(navigator.serviceWorker.controller);
      this._last = { page, controller, at:new Date().toISOString() };
      if (!controller || controller === page) return { ok:true, page, controller };

      const hopKey = ALIGN_PREFIX + page + ':' + controller;
      try {
        if (sessionStorage.getItem(hopKey)) return { ok:false, reason:'tentativa-ja-feita', page, controller };
      } catch (_) { /* sem sessionStorage: apenas não usa a trava */ }

      let reg = null;
      try { reg = await navigator.serviceWorker.getRegistration(); } catch (e) { quiet(e, 'get-registration'); }
      if (!reg) return { ok:false, reason:'sem-registration', page, controller };

      try { await reg.update(); } catch (e) { quiet(e, 'registration-update'); }
      for (let i = 0; i < 20 && !reg.waiting; i++) {
        if (reg.installing && reg.installing.state === 'installed') break;
        await sleep(250);
      }

      // Se o worker correto já está ATIVO mas esta página ainda é controlada pelo
      // anterior, basta uma recarga. Isso não toca dado nenhum.
      const activeV = await askWorker(reg.active);
      if (activeV === page && controller !== page) {
        if (hasLocalPending()) {
          try { if (window.Atualizacao) Atualizacao.avisar(reg); } catch (e) { quiet(e, 'align-pending-active'); }
          return { ok:false, reason:'pendencia-local', page, controller, active:activeV };
        }
        try { if (window.__idbFlush) await window.__idbFlush(); } catch (e) { quiet(e, 'align-idb-active'); }
        try { sessionStorage.setItem(hopKey, '1'); } catch (_) { /* noop */ }
        location.reload();
        return { ok:false, reason:'recarregando-worker-ativo', page, controller, active:activeV };
      }

      const waiting = reg.waiting;
      const waitingV = await askWorker(waiting);
      if (!waiting || waitingV !== page) {
        try { if (waiting && window.Atualizacao) Atualizacao.avisar(reg); } catch (e) { quiet(e, 'align-waiting-warn'); }
        return { ok:false, reason:'worker-correto-ainda-nao-espera', page, controller, waiting:waitingV };
      }
      if (hasLocalPending()) {
        try { if (window.Atualizacao) Atualizacao.avisar(reg); } catch (e) { quiet(e, 'align-pending-waiting'); }
        return { ok:false, reason:'pendencia-local', page, controller, waiting:waitingV };
      }

      try { if (window.__idbFlush) await window.__idbFlush(); } catch (e) { quiet(e, 'align-idb'); }
      try { sessionStorage.setItem(hopKey, '1'); } catch (_) { /* noop */ }
      try { if (typeof showToast === 'function') showToast('Finalizando atualização segura…'); } catch (e) { quiet(e, 'align-toast'); }

      let changed = false;
      const onChange = () => {
        if (changed) return;
        changed = true;
        location.reload();
      };
      try { navigator.serviceWorker.addEventListener('controllerchange', onChange, { once:true }); } catch (e) { quiet(e, 'align-controllerchange'); }
      try { waiting.postMessage('skipWaiting'); } catch (e) { quiet(e, 'align-skip-waiting'); }

      // Não existe reload cego. Se o navegador não trocar o controller, mantemos
      // a página funcionando e deixamos o mecanismo normal de atualização avisar.
      setTimeout(() => {
        if (changed) return;
        try { navigator.serviceWorker.removeEventListener('controllerchange', onChange); } catch (_) { /* noop */ }
        try { if (window.Atualizacao) Atualizacao.avisar(reg); } catch (e) { quiet(e, 'align-timeout-warn'); }
      }, 7000);
      return { ok:false, reason:'aguardando-controllerchange', page, controller, waiting:waitingV };
    },
    status() { return this._last; }
  };

  const ProfileConsistency = {
    _running: null,
    _runningId: null,
    _last: null,
    _attempts: Object.create(null),

    async _remoteMeta(id) {
      const C = window.CloudStore, S = window.SectionSync;
      const rowsOp = C.client.from(S.TABLE).select('section,rev').eq('profile_id', id);
      const manifestOp = C.client.from(S.TABLE).select('data,rev,updated_at').eq('profile_id', id).eq('section', S.MANIFEST).maybeSingle();
      const wrap = (p, label) => C._withTimeout ? C._withTimeout(p, 12000, label) : p;
      const [rowsRes, manifestRes] = await Promise.all([
        wrap(rowsOp, 'Validar revisões do perfil'),
        wrap(manifestOp, 'Validar manifesto do perfil')
      ]);
      if (rowsRes.error) throw rowsRes.error;
      if (manifestRes.error) throw manifestRes.error;
      const row = manifestRes.data;
      const sections = row && row.data && Array.isArray(row.data.sections) ? row.data.sections.map(String) : null;
      if (!sections) throw new Error('Manifesto remoto ausente ou inválido.');
      const revs = Object.create(null);
      (rowsRes.data || []).forEach(r => { revs[String(r.section)] = Number(r.rev || 0); });
      return { sections, revs, manifestRev:Number(row.rev || 0), updatedAt:row.updated_at || null };
    },

    async _fetchRemoteSections(id, names) {
      const C = window.CloudStore, S = window.SectionSync;
      names = [...new Set((names || []).filter(Boolean))];
      if (!names.length) return {};
      const op = C.client.from(S.TABLE).select('section,data,rev').eq('profile_id', id).in('section', names);
      const res = C._withTimeout ? await C._withTimeout(op, 16000, 'Reparar seções do perfil') : await op;
      if (res.error) throw res.error;
      const out = {};
      (res.data || []).forEach(r => {
        const raw = S._decode(r.data);
        if (raw !== null) out[String(r.section)] = { raw, rev:Number(r.rev || 0) };
      });
      return out;
    },

    _eligibleSection(S, pfx, sec) {
      if (!sec || sec === S.MANIFEST) return false;
      try { return !!S.sectionForKey(pfx + sec, pfx); } catch (_) { return false; }
    },

    _markLocalForUpload(S, pfx, sec, protectedList, reason) {
      try { S.markDirty(pfx + sec); } catch (e) { quiet(e, 'mark-local-' + sec); }
      protectedList.push({ section:sec, reason });
    },

    async run(id, opts) {
      opts = opts || {};
      id = String(id || activeProfile() || '');
      if (!id || !profileConfirmed(id)) return { ok:false, reason:'perfil-nao-confirmado' };
      const C = window.CloudStore, S = window.SectionSync;
      if (!C || !S || !C.isReady || !C.isReady() || !C.isLoggedIn || !C.isLoggedIn()) return { ok:false, reason:'nuvem-indisponivel' };
      if (window.SessionLock && SessionLock.isBlocked && SessionLock.isBlocked()) return { ok:false, reason:'sessao-bloqueada' };
      if (!opts.force && getLocal(versionKey(id))) return { ok:true, skipped:true, reason:'versao-ja-validada' };
      if (this._running && this._runningId === id) return this._running;

      this._runningId = id;
      this._running = this._run(id, opts).finally(() => { this._running = null; this._runningId = null; });
      return this._running;
    },

    async _run(id, opts) {
      const C = window.CloudStore, S = window.SectionSync;
      const started = Date.now();
      const pfx = 'diario-estudos:u:' + id + ':';
      const result = { ok:false, id, version:appVersion(), generation:GENERATION, repaired:[], protected:[], unresolved:[], at:new Date().toISOString() };
      try {
        if (typeof window.__ensureStudyProfileHydrated === 'function') await window.__ensureStudyProfileHydrated(id);
        if (window.TecDataReset && TecDataReset.applyRemoteResetIfNeeded) {
          try { await TecDataReset.applyRemoteResetIfNeeded(id); } catch (e) { quiet(e, 'consistency-reset-check'); }
        }

        const meta = await this._remoteMeta(id);
        const remoteSet = new Set(meta.sections);
        const localRevs = S._getRevs(id) || {};
        const pending = new Set(S.pendingSections ? S.pendingSections(id) : []);
        const deletions = new Set(S._loadDel ? S._loadDel(id) : []);
        const needRemote = new Set();
        const ambiguous = new Set();
        const localGood = new Set();

        for (const sec of meta.sections) {
          if (!this._eligibleSection(S, pfx, sec)) continue;
          const rr = Number(meta.revs[sec] || 0);
          if (!rr) { result.unresolved.push({ section:sec, reason:'manifesto-sem-linha' }); continue; }
          if (deletions.has(sec)) { result.protected.push({ section:sec, reason:'exclusao-local-pendente' }); continue; }
          const raw = localStorage.getItem(pfx + sec);
          const lm = localRevs[sec] || null;
          const lr = Number(lm && lm.rev || 0);
          const recordedHash = lm && lm.hash ? String(lm.hash) : null;

          if (pending.has(sec)) { result.protected.push({ section:sec, reason:'alteracao-local-pendente' }); continue; }
          if (raw === null) { needRemote.add(sec); continue; }

          const actualHash = S._hash(raw);
          // Alteração local que perdeu apenas o marcador da fila: preservar e
          // reconstruir a pendência em vez de interpretar como dado velho.
          if (recordedHash && actualHash !== recordedHash) {
            this._markLocalForUpload(S, pfx, sec, result.protected, 'hash-local-divergente-do-bookkeeping');
            continue;
          }
          if (!lm || !lr || !recordedHash) {
            this._markLocalForUpload(S, pfx, sec, result.protected, 'local-sem-prova-de-sincronizacao');
            continue;
          }
          if (rr > lr) { needRemote.add(sec); continue; }
          if (lr > rr) { ambiguous.add(sec); continue; }
          localGood.add(sec);
        }

        // Uma geração nova faz UMA auditoria profunda. Builds seguintes ficam na
        // checagem barata acima e só baixam o conteúdo das seções suspeitas.
        const deepNeeded = !getLocal(deepKey(id));
        let deepRows = null;
        let deepPrepared = null;
        if (deepNeeded) {
          deepRows = await S.fetchAllSections(id);
          deepPrepared = S._prepare(deepRows);
          if (!deepPrepared.ok) throw new Error('Auditoria profunda recusada: ' + deepPrepared.motivo);
          for (const sec of meta.sections) {
            if (!this._eligibleSection(S, pfx, sec) || pending.has(sec) || deletions.has(sec)) continue;
            const remoteRaw = deepPrepared.map[sec];
            if (remoteRaw === undefined) { result.unresolved.push({ section:sec, reason:'profundo-sem-conteudo' }); continue; }
            const localRaw = localStorage.getItem(pfx + sec);
            const lm = localRevs[sec] || null;
            const lr = Number(lm && lm.rev || 0);
            const rr = Number(meta.revs[sec] || 0);
            if (localRaw === null) { needRemote.add(sec); continue; }
            if (!lm || !lm.hash || !lr) continue; // já protegido acima
            const actualHash = S._hash(localRaw);
            const remoteHash = S._hash(remoteRaw);
            if (actualHash === remoteHash) { localGood.add(sec); continue; }
            if (String(lm.hash) !== actualHash) continue; // edição local já protegida
            // Mesma revisão com conteúdo diferente ou local aparentemente à
            // frente: precisa de terceira fonte antes de qualquer overwrite.
            if (rr === lr || lr > rr) ambiguous.add(sec);
          }
        }

        let remoteData = {};
        if (deepPrepared) {
          for (const sec of meta.sections) {
            if (deepPrepared.map[sec] !== undefined) remoteData[sec] = { raw:deepPrepared.map[sec], rev:Number(meta.revs[sec] || deepPrepared.revs[sec] || 0) };
          }
        } else if (needRemote.size || ambiguous.size) {
          remoteData = await this._fetchRemoteSections(id, [...needRemote, ...ambiguous]);
        }

        // Conflitos ambíguos usam o blob como terceira fonte. Nunca escolhemos
        // automaticamente entre duas cópias discordantes sem consenso.
        let blobData = null;
        if (ambiguous.size) {
          try {
            const blob = await C.fetchPayload(id);
            blobData = blob && blob.payload && blob.payload.data && typeof blob.payload.data === 'object' ? blob.payload.data : {};
          } catch (e) { quiet(e, 'consistency-blob-consensus'); blobData = {}; }
        }

        const toRepair = [];
        for (const sec of needRemote) {
          const r = remoteData[sec];
          if (!r) { result.unresolved.push({ section:sec, reason:'remoto-nao-retornou-secao' }); continue; }
          toRepair.push({ section:sec, raw:r.raw, rev:r.rev, reason:localStorage.getItem(pfx + sec) === null ? 'secao-local-ausente' : 'remoto-mais-novo' });
        }
        for (const sec of ambiguous) {
          const r = remoteData[sec];
          const localRaw = localStorage.getItem(pfx + sec);
          if (!r || localRaw === null) { result.unresolved.push({ section:sec, reason:'conflito-sem-dados-suficientes' }); continue; }
          const blobRaw = blobData && Object.prototype.hasOwnProperty.call(blobData, sec) ? String(blobData[sec]) : null;
          if (blobRaw !== null && blobRaw === r.raw && localRaw !== r.raw) {
            toRepair.push({ section:sec, raw:r.raw, rev:r.rev, reason:'consenso-nuvem-blob' });
          } else if (blobRaw !== null && blobRaw === localRaw && localRaw !== r.raw) {
            this._markLocalForUpload(S, pfx, sec, result.protected, 'consenso-local-blob');
          } else if (localRaw === r.raw) {
            localGood.add(sec);
          } else {
            result.unresolved.push({ section:sec, reason:'conflito-tres-fontes' });
          }
        }

        if (toRepair.length) {
          try { if (window.BackupHistory) await BackupHistory.snapshot('antes do autorreparo pós-atualização ' + appVersion()); } catch (e) { quiet(e, 'consistency-snapshot'); }
        }

        const revs = S._getRevs(id) || {};
        for (const item of toRepair) {
          const key = pfx + item.section;
          const before = localStorage.getItem(key);
          if (before !== null && before !== item.raw) {
            try { if (window.Lixeira) Lixeira.guardar(key, 'substituída no autorreparo pós-atualização'); } catch (e) { quiet(e, 'consistency-trash'); }
          }
          if (before !== item.raw) localStorage.setItem(key, item.raw);
          revs[item.section] = { rev:Number(item.rev || meta.revs[item.section] || 1), hash:S._hash(item.raw), len:item.raw.length };
          result.repaired.push({ section:item.section, reason:item.reason });
        }

        // Se a seção já bate exatamente com a nuvem, saneia bookkeeping antigo.
        if (deepPrepared) {
          for (const sec of localGood) {
            const raw = localStorage.getItem(pfx + sec);
            if (raw === null || deepPrepared.map[sec] === undefined || raw !== deepPrepared.map[sec]) continue;
            revs[sec] = { rev:Number(meta.revs[sec] || 1), hash:S._hash(raw), len:raw.length };
          }
        }
        if (meta.manifestRev) revs[S.MANIFEST] = { rev:meta.manifestRev, hash:S._hash([...remoteSet].sort().join('|')) };
        S._saveRevs(revs, id);
        try { if (S._savePend) S._savePend(); } catch (e) { quiet(e, 'consistency-pend-save'); }

        if (result.protected.some(x => /local|pendente|consenso-local/.test(x.reason))) {
          C._pending = true;
          C._dirtyAt = C._dirtyAt || Date.now();
          C._forceBlob = true;
          try { if (C._rearm) C._rearm(500); } catch (e) { quiet(e, 'consistency-rearm'); }
        }

        try { if (window.__idbFlush) await window.__idbFlush(); } catch (e) { quiet(e, 'consistency-idb-flush'); }
        if (result.repaired.length) {
          try {
            if (window.__snmSoftRefresh) window.__snmSoftRefresh('autorreparo pós-atualização');
            else window.dispatchEvent(new CustomEvent('study:cloud-applied', { detail:{ reason:'deploy-consistency-repair' } }));
          } catch (e) { quiet(e, 'consistency-soft-refresh'); }
        }

        result.ok = result.unresolved.length === 0;
        result.ms = Date.now() - started;
        result.remoteSections = meta.sections.length;
        result.deep = !!deepNeeded;
        this._last = result;
        if (deepNeeded && result.ok) setLocal(deepKey(id), new Date().toISOString());
        if (result.ok) setLocal(versionKey(id), new Date().toISOString());
        try { console.info('[deploy-consistency]', result); } catch (e) { quiet(e, 'consistency-log'); }
        return result;
      } catch (e) {
        result.reason = (e && (e.message || e.code)) || 'erro';
        result.ms = Date.now() - started;
        this._last = result;
        quiet(e, 'consistency-run');
        return result;
      }
    },

    status() { return this._last; }
  };

  const DeployConsistency = {
    generation: GENERATION,
    VersionAlignment,
    ProfileConsistency,
    _timer: null,
    _tries: 0,
    async maybeRun() {
      const id = activeProfile();
      if (!id || !profileConfirmed(id)) return false;
      const C = window.CloudStore;
      if (!C || !C.isReady || !C.isReady() || !C.isLoggedIn || !C.isLoggedIn()) return false;
      if (getLocal(versionKey(id))) return true;
      const key = appVersion() + ':' + id;
      this._tries = (ProfileConsistency._attempts[key] || 0) + 1;
      ProfileConsistency._attempts[key] = this._tries;
      const r = await ProfileConsistency.run(id);
      if (!r.ok && this._tries < MAX_RETRIES) setTimeout(() => this.maybeRun(), 8000 * this._tries);
      return !!r.ok;
    },
    status() {
      return {
        version:appVersion(),
        generation:GENERATION,
        worker:VersionAlignment.status(),
        profile:ProfileConsistency.status()
      };
    }
  };
  window.DeployConsistency = DeployConsistency;

  // Alinhamento de código acontece cedo; a integridade do perfil só roda quando
  // sessão e perfil estão comprovadamente abertos.
  setTimeout(() => VersionAlignment.run(), 120);
  setTimeout(() => DeployConsistency.maybeRun(), 900);
  window.addEventListener('load', () => {
    setTimeout(() => VersionAlignment.run(), 350);
    setTimeout(() => DeployConsistency.maybeRun(), 1300);
  }, { once:true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(() => DeployConsistency.maybeRun(), 400);
  });
})();
