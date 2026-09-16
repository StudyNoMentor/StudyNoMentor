/* StudyNoMentor Companion — reconstruction backpressure/control v2.
 * Adds a read-only batch state probe used by the TEC runner so extraction only
 * advances after StudyNoMentor has ACKed the durable batch. Also provides a
 * scoped reset for reconstruction jobs/queues without touching captured facts.
 */
'use strict';

(() => {
  const JOBS_KEY = 'snmTecReconstructJobsV1';
  const BATCHES_KEY = 'snmTecReconstructBatchesV1';
  const isStudy = url => /^https:\/\/studynomentor\.github\.io\/StudyNoMentor(?:\/|$)/i.test(String(url || ''));
  const isTec = url => /^https:\/\/(?:www\.)?tecconcursos\.com\.br\//i.test(String(url || ''));

  async function get(key, fallback = null) {
    const row = await chrome.storage.local.get(key);
    return row[key] == null ? fallback : row[key];
  }

  async function batchState(requestId, batchId, tabId) {
    const jobs = await get(JOBS_KEY, { jobs:{} });
    const job = jobs && jobs.jobs && jobs.jobs[String(requestId)] || null;
    if (!job) return { ok:false, reason:'job_missing', pending:false, status:'missing' };
    if (job.tabId != null && tabId != null && Number(job.tabId) !== Number(tabId)) {
      return { ok:false, reason:'job_mismatch', pending:false, status:String(job.status || '') };
    }
    const batches = await get(BATCHES_KEY, { byRequest:{} });
    const bucket = batches && batches.byRequest && batches.byRequest[String(requestId)] || {};
    const pending = !!bucket[String(batchId)];
    return {
      ok:true,
      pending,
      persisted:!pending,
      status:String(job.status || ''),
      pendingCount:Object.keys(bucket || {}).length
    };
  }

  async function resetReconstruction() {
    const jobs = await get(JOBS_KEY, { jobs:{} });
    const tabs = [...new Set(Object.values(jobs && jobs.jobs || {})
      .map(job => job && job.tabId)
      .filter(id => id != null)
      .map(Number))];

    /* Remove ownership before closing tabs. Otherwise background-reconstruct.js
       can observe tabs.onRemoved, call failJob() and resurrect a job we just reset. */
    await chrome.storage.local.remove([JOBS_KEY, BATCHES_KEY]);
    for (const tabId of tabs) {
      try { await chrome.tabs.remove(tabId); } catch (_) {}
    }
    return { ok:true, closedTabs:tabs.length };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return false;
    const url = String(sender && sender.url || '');
    const tabId = sender && sender.tab && sender.tab.id;

    if (msg.kind === 'tec-reconstruct-batch-state' && isTec(url)) {
      batchState(msg.requestId, msg.batchId, tabId)
        .then(sendResponse)
        .catch(error => sendResponse({ ok:false, reason:'state_error', error:String(error && error.message || error) }));
      return true;
    }

    if (msg.kind === 'tec-reconstruct-reset-all' && isStudy(url)) {
      resetReconstruction()
        .then(sendResponse)
        .catch(error => sendResponse({ ok:false, reason:'reset_error', error:String(error && error.message || error) }));
      return true;
    }
    return false;
  });
})();
