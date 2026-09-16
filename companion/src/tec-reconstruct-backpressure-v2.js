/* StudyNoMentor Companion — TEC reconstruction backpressure v2.
 * Runs only in the dedicated reconstruction tab. It wraps runtime.sendMessage
 * for durable batches: returning from sendBatch now means StudyNoMentor has
 * actually ACKed/persisted the batch, not merely that extension storage accepted it.
 */
'use strict';

(() => {
  if (window.top !== window.self) return;
  if (!/(?:^#|[&#])snm-reconstruct=/.test(String(location.hash || ''))) return;
  if (globalThis.__snmTecReconstructBackpressureV2) return;
  globalThis.__snmTecReconstructBackpressureV2 = true;

  const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  const ACK_TIMEOUT_MS = 90000;
  const POLL_MS = 250;
  const MAX_CONSECUTIVE_FAILURES = 8;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let lastProcessed = 0;
  let lastFailed = 0;
  let consecutiveFailures = 0;

  async function waitPersisted(requestId, batchId) {
    const startedAt = Date.now();
    let last = null;
    while (Date.now() - startedAt < ACK_TIMEOUT_MS) {
      last = await originalSend({ kind:'tec-reconstruct-batch-state', requestId:String(requestId), batchId:String(batchId) });
      if (!last || last.ok !== true) {
        if (last && ['job_missing','job_mismatch'].includes(String(last.reason || ''))) {
          throw new Error('A sessão de reconstrução perdeu a posse desta aba.');
        }
      } else {
        if (last.persisted === true || last.pending === false) return last;
        if (['failed','cancelled','complete'].includes(String(last.status || ''))) {
          throw new Error(`A reconstrução foi encerrada enquanto aguardava persistência (${last.status}).`);
        }
      }
      await sleep(POLL_MS);
    }
    const pending = last && Number.isFinite(Number(last.pendingCount)) ? ` (${last.pendingCount} lote(s) pendente(s))` : '';
    throw new Error(`O StudyNoMentor não confirmou a persistência do lote em ${Math.round(ACK_TIMEOUT_MS / 1000)}s${pending}. A extração foi interrompida para evitar loop ou perda de dados.`);
  }

  function guardProgress(message) {
    const p = message && message.progress || {};
    const processed = Math.max(0, Number(p.processed || 0));
    const failed = Math.max(0, Number(p.failedQuestions || 0));
    if (processed > lastProcessed) {
      consecutiveFailures = failed > lastFailed ? consecutiveFailures + 1 : 0;
      lastProcessed = processed;
      lastFailed = failed;
    }
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      throw new Error(`A reconstrução falhou em ${consecutiveFailures} questões consecutivas. O processo foi interrompido para evitar navegação em loop; recarregue o TEC/Companion e tente novamente.`);
    }
  }

  chrome.runtime.sendMessage = function(message, ...args) {
    if (!message || args.length) return originalSend(message, ...args);

    if (message.kind === 'tec-reconstruct-progress') {
      guardProgress(message);
      return originalSend(message);
    }

    if (message.kind !== 'tec-reconstruct-batch') return originalSend(message);

    return (async () => {
      const result = await originalSend(message);
      if (!result || result.ok !== true || result.durable !== true || !result.batchId) return result;
      await waitPersisted(message.requestId, result.batchId);
      return { ...result, persisted:true };
    })();
  };
})();
