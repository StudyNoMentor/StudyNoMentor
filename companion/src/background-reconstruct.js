/* StudyNoMentor Companion — orquestrador durável da reconstrução histórica TEC. */
'use strict';

(() => {
  const JOBS_KEY = 'snmTecReconstructJobsV1';
  const ALARM_NAME = 'snm-tec-reconstruct-maintenance-v1';
  const MAX_JOBS = 20;
  const JOB_TIMEOUT_MS = 45 * 60 * 1000;
  const studyPorts = new Map();
  let writeChain = Promise.resolve();
  let kicking = false;

  const nowIso = () => new Date().toISOString();
  const serialize = task => { writeChain = writeChain.then(task, task); return writeChain; };
  const isStudy = url => /^https:\/\/studynomentor\.github\.io\/StudyNoMentor(?:\/|$)/i.test(String(url || ''));
  const isTec = url => /^https:\/\/(?:www\.)?tecconcursos\.com\.br\//i.test(String(url || ''));
  const safePost = (port, msg) => { try { port.postMessage(msg); return true; } catch (_) { return false; } };

  async function storageGet(key, fallback) {
    const out = await chrome.storage.local.get(key);
    return out[key] == null ? fallback : out[key];
  }

  function normalizeContext(raw, tabId = null) {
    if (!raw || typeof raw !== 'object') return null;
    const userId = String(raw.userId || '').trim();
    const profileId = String(raw.profileId || '').trim();
    if (!userId || !profileId) return null;
    return {
      userId,
      profileId,
      tabId: tabId == null ? null : Number(tabId),
      tabSessionId: String(raw.tabSessionId || ''),
      deviceId: String(raw.deviceId || ''),
      siteBuild: String(raw.siteBuild || '')
    };
  }

  function sameOwner(a, b) {
    return !!(a && b && String(a.userId) === String(b.userId) && String(a.profileId) === String(b.profileId));
  }

  async function state() {
    const st = await storageGet(JOBS_KEY, null);
    if (st && st.version === 1 && st.jobs && typeof st.jobs === 'object') return st;
    return { version:1, jobs:{}, updatedAt:null };
  }

  async function save(st) {
    st.updatedAt = nowIso();
    const rows = Object.values(st.jobs || {}).sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
    st.jobs = Object.fromEntries(rows.slice(0, MAX_JOBS).map(x => [String(x.requestId), x]));
    await chrome.storage.local.set({ [JOBS_KEY]: st });
  }

  function targetPorts(target) {
    const rows = [];
    for (const [port, meta] of studyPorts) {
      if (meta && meta.context && sameOwner(meta.context, target)) rows.push(port);
    }
    return rows;
  }

  function broadcast(kind, payload, target) {
    for (const port of targetPorts(target)) {
      if (!safePost(port, { kind, payload })) studyPorts.delete(port);
    }
  }

  function parseBookId(value) {
    const raw = String(value == null ? '' : value).trim();
    const fromUrl = raw.match(/\/questoes\/cadernos\/(\d+)/i);
    const id = fromUrl ? fromUrl[1] : (raw.match(/^\d+$/) || [])[0];
    return id ? String(id) : null;
  }

  async function jobById(requestId) {
    const st = await state();
    return st.jobs[String(requestId)] || null;
  }

  async function queueJob(payload, senderTabId) {
    const requestId = String(payload && payload.requestId || '').trim();
    const bookId = parseBookId(payload && (payload.bookId || payload.book));
    const target = normalizeContext(payload && payload.context, senderTabId);
    if (!requestId || !bookId || !target) return { ok:false, reason:'invalid_request' };

    return serialize(async () => {
      const st = await state();
      const existing = st.jobs[requestId];
      if (existing) {
        if (!sameOwner(existing.target, target)) return { ok:false, reason:'owner_mismatch' };
        return { ok:true, duplicate:true, job:existing };
      }
      const job = {
        requestId,
        bookId,
        target,
        status:'queued',
        tabId:null,
        createdAt:nowIso(),
        createdAtMs:Date.now(),
        startedAt:null,
        startedAtMs:null,
        completedAt:null,
        progress:{ processed:0, total:0, percent:0, phase:'queued' },
        error:null
      };
      st.jobs[requestId] = job;
      await save(st);
      return { ok:true, duplicate:false, job };
    });
  }

  async function markJob(requestId, patch) {
    let next = null;
    await serialize(async () => {
      const st = await state();
      const job = st.jobs[String(requestId)];
      if (!job) return;
      Object.assign(job, patch || {});
      next = { ...job };
      await save(st);
    });
    return next;
  }

  async function waitTabComplete(tabId, timeoutMs = 30000) {
    const start = Date.now();
    for (;;) {
      if (Date.now() - start > timeoutMs) throw new Error('O TEC não terminou de abrir o caderno dentro do limite.');
      let tab;
      try { tab = await chrome.tabs.get(Number(tabId)); }
      catch (_) { throw new Error('A aba de reconstrução do TEC foi fechada.'); }
      if (tab && tab.status === 'complete') return tab;
      await new Promise(r => setTimeout(r, 250));
    }
  }

  async function sendRun(tabId, requestId, bookId) {
    let last = null;
    for (let i = 0; i < 20; i++) {
      try {
        const result = await chrome.tabs.sendMessage(Number(tabId), { kind:'tec-reconstruct-run', requestId:String(requestId), bookId:String(bookId) });
        if (result && result.accepted) return true;
        last = result && result.reason ? new Error(String(result.reason)) : last;
      } catch (e) { last = e; }
      await new Promise(r => setTimeout(r, 300));
    }
    throw last || new Error('O módulo de reconstrução não respondeu na aba do TEC.');
  }

  async function launch(job) {
    const url = `https://www.tecconcursos.com.br/questoes/cadernos/${encodeURIComponent(job.bookId)}#snm-reconstruct=${encodeURIComponent(job.requestId)}`;
    const tab = await chrome.tabs.create({ url, active:false });
    if (!tab || tab.id == null) throw new Error('Não foi possível abrir a aba de reconstrução do TEC.');
    const running = await markJob(job.requestId, {
      status:'running',
      tabId:Number(tab.id),
      startedAt:nowIso(),
      startedAtMs:Date.now(),
      progress:{ processed:0, total:0, percent:0, phase:'opening' },
      error:null
    });
    if (running) broadcast('tec-reconstruct-status', { requestId:job.requestId, bookId:job.bookId, status:'running', phase:'opening' }, running.target);
    await waitTabComplete(tab.id);
    await sendRun(tab.id, job.requestId, job.bookId);
  }

  async function runningJob() {
    const st = await state();
    return Object.values(st.jobs || {}).find(x => x && ['opening','running'].includes(String(x.status))) || null;
  }

  async function nextQueued() {
    const st = await state();
    return Object.values(st.jobs || {})
      .filter(x => x && x.status === 'queued')
      .sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0))[0] || null;
  }

  async function kick() {
    if (kicking) return;
    kicking = true;
    try {
      const active = await runningJob();
      if (active) {
        const age = Date.now() - Number(active.startedAtMs || active.createdAtMs || 0);
        if (age > JOB_TIMEOUT_MS) {
          await failJob(active.requestId, 'A reconstrução excedeu 45 minutos e foi encerrada.', 504);
        }
        return;
      }
      const job = await nextQueued();
      if (!job) return;
      try { await launch(job); }
      catch (e) { await failJob(job.requestId, String(e && e.message || e), 502); }
    } finally {
      kicking = false;
    }
  }

  async function closeJobTab(job) {
    if (!job || job.tabId == null) return;
    try { await chrome.tabs.remove(Number(job.tabId)); } catch (_) {}
  }

  async function failJob(requestId, error, status = 500) {
    const job = await markJob(requestId, { status:'failed', completedAt:nowIso(), error:String(error || 'Falha na reconstrução.') });
    if (!job) return;
    broadcast('tec-reconstruct-error', { requestId:job.requestId, bookId:job.bookId, status, error:job.error }, job.target);
    await closeJobTab(job);
    setTimeout(() => kick().catch(() => {}), 0);
  }

  async function completeJob(requestId, summary) {
    const job = await markJob(requestId, { status:'complete', completedAt:nowIso(), progress:{ ...(summary || {}), phase:'complete', percent:100 }, error:null });
    if (!job) return;
    broadcast('tec-reconstruct-result', { requestId:job.requestId, bookId:job.bookId, status:'complete', summary:summary || {} }, job.target);
    await closeJobTab(job);
    setTimeout(() => kick().catch(() => {}), 0);
  }

  async function cancelJob(requestId, target) {
    let job = null;
    await serialize(async () => {
      const st = await state();
      const current = st.jobs[String(requestId)];
      if (!current || !sameOwner(current.target, target)) return;
      current.status = 'cancelled';
      current.completedAt = nowIso();
      current.error = 'Cancelado pelo usuário.';
      job = { ...current };
      await save(st);
    });
    if (!job) return false;
    await closeJobTab(job);
    broadcast('tec-reconstruct-result', { requestId:job.requestId, bookId:job.bookId, status:'cancelled', summary:job.progress || {} }, job.target);
    setTimeout(() => kick().catch(() => {}), 0);
    return true;
  }

  async function resyncPort(port, context) {
    const st = await state();
    for (const job of Object.values(st.jobs || {})) {
      if (!job || !sameOwner(job.target, context)) continue;
      safePost(port, { kind:'tec-reconstruct-status', payload:{ requestId:job.requestId, bookId:job.bookId, status:job.status, progress:job.progress || {}, error:job.error || null } });
    }
  }

  chrome.runtime.onConnect.addListener(port => {
    const url = String(port.sender && port.sender.url || '');
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (port.name !== 'snm-study-reconstruct-v1' || !isStudy(url)) return;
    const meta = { tabId:tabId == null ? null : Number(tabId), context:null };
    studyPorts.set(port, meta);
    port.onDisconnect.addListener(() => { const ignored = chrome.runtime.lastError; void ignored; studyPorts.delete(port); });
    port.onMessage.addListener(msg => {
      if (!msg || typeof msg !== 'object') return;
      const p = msg.payload || {};
      if (msg.type === 'reconstruct-request') {
        const ctx = normalizeContext(p.context, tabId);
        if (!ctx) { safePost(port, { kind:'tec-reconstruct-error', payload:{ requestId:p.requestId || null, status:400, error:'Contexto do perfil Study inválido.' } }); return; }
        meta.context = ctx;
        queueJob(p, tabId).then(result => {
          if (!result.ok) {
            safePost(port, { kind:'tec-reconstruct-error', payload:{ requestId:p.requestId || null, status:400, error:result.reason || 'Solicitação inválida.' } });
            return;
          }
          safePost(port, { kind:'tec-reconstruct-status', payload:{ requestId:result.job.requestId, bookId:result.job.bookId, status:result.job.status, duplicate:!!result.duplicate } });
          kick().catch(() => {});
        }).catch(e => safePost(port, { kind:'tec-reconstruct-error', payload:{ requestId:p.requestId || null, status:500, error:String(e && e.message || e) } }));
      } else if (msg.type === 'reconstruct-cancel') {
        const ctx = normalizeContext(p.context, tabId) || meta.context;
        cancelJob(p.requestId, ctx).catch(() => {});
      } else if (msg.type === 'reconstruct-resync') {
        const ctx = normalizeContext(p.context, tabId) || meta.context;
        if (ctx) { meta.context = ctx; resyncPort(port, ctx).catch(() => {}); }
      }
    });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    const url = String(sender && sender.url || '');
    const tabId = sender && sender.tab && sender.tab.id;
    if (!isTec(url) || tabId == null) return false;

    if (msg.kind === 'tec-reconstruct-progress') {
      (async () => {
        const job = await jobById(msg.requestId);
        if (!job || Number(job.tabId) !== Number(tabId)) return sendResponse({ ok:false, reason:'job_mismatch' });
        const progress = { ...(msg.progress || {}), phase:String(msg.progress && msg.progress.phase || 'scanning') };
        const next = await markJob(job.requestId, { progress });
        if (next) broadcast('tec-reconstruct-progress', { requestId:job.requestId, bookId:job.bookId, ...progress }, next.target);
        sendResponse({ ok:true });
      })().catch(e => sendResponse({ ok:false, reason:String(e && e.message || e) }));
      return true;
    }

    if (msg.kind === 'tec-reconstruct-batch') {
      (async () => {
        const job = await jobById(msg.requestId);
        if (!job || Number(job.tabId) !== Number(tabId)) return sendResponse({ ok:false, reason:'job_mismatch' });
        const rows = Array.isArray(msg.rows) ? msg.rows.slice(0, 25) : [];
        if (rows.length) broadcast('tec-reconstruct-batch', { requestId:job.requestId, bookId:job.bookId, tecAccount:msg.tecAccount || null, rows }, job.target);
        sendResponse({ ok:true });
      })().catch(e => sendResponse({ ok:false, reason:String(e && e.message || e) }));
      return true;
    }

    if (msg.kind === 'tec-reconstruct-complete') {
      (async () => {
        const job = await jobById(msg.requestId);
        if (!job || Number(job.tabId) !== Number(tabId)) return sendResponse({ ok:false, reason:'job_mismatch' });
        await completeJob(job.requestId, msg.summary || {});
        sendResponse({ ok:true });
      })().catch(e => sendResponse({ ok:false, reason:String(e && e.message || e) }));
      return true;
    }

    if (msg.kind === 'tec-reconstruct-failed') {
      (async () => {
        const job = await jobById(msg.requestId);
        if (!job || Number(job.tabId) !== Number(tabId)) return sendResponse({ ok:false, reason:'job_mismatch' });
        await failJob(job.requestId, msg.error || 'Falha na reconstrução.', Number(msg.status || 500));
        sendResponse({ ok:true });
      })().catch(e => sendResponse({ ok:false, reason:String(e && e.message || e) }));
      return true;
    }
    return false;
  });

  chrome.tabs.onRemoved.addListener(tabId => {
    state().then(st => {
      const job = Object.values(st.jobs || {}).find(x => x && Number(x.tabId) === Number(tabId) && x.status === 'running');
      if (job) failJob(job.requestId, 'A aba de reconstrução do TEC foi fechada antes do término.', 499).catch(() => {});
    }).catch(() => {});
  });

  chrome.alarms?.onAlarm.addListener(alarm => {
    if (alarm && alarm.name === ALARM_NAME) kick().catch(() => {});
  });

  async function ensure() {
    try { await chrome.alarms?.create(ALARM_NAME, { periodInMinutes:1 }); } catch (_) {}
    try {
      const st = await state();
      let changed = false;
      for (const job of Object.values(st.jobs || {})) {
        if (!job || job.status !== 'running' || job.tabId == null) continue;
        try { await chrome.tabs.get(Number(job.tabId)); }
        catch (_) { job.status = 'queued'; job.tabId = null; job.startedAt = null; job.startedAtMs = null; changed = true; }
      }
      if (changed) await save(st);
    } catch (_) {}
    kick().catch(() => {});
  }

  chrome.runtime.onStartup.addListener(() => ensure());
  chrome.runtime.onInstalled.addListener(() => ensure());
  ensure();
})();
