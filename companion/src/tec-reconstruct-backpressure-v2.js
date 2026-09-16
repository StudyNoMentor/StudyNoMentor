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
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  chrome.runtime.sendMessage = function(message, ...args) {
    if (!message || message.kind !== 'tec-reconstruct-batch' || args.length) {
      return originalSend(message, ...args);
    }
    return (async () => {
      const result = await originalSend(message);
      if (!result || result.ok !== true || result.durable !== true || !result.batchId) return result;
      await waitPersisted(message.requestId, result.batchId);
      return { ...result, persisted:true };
    })();
  };
})();
