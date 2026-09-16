/* StudyNoMentor Companion — ponte isolada para reconstrução histórica do TEC.
 * Protocolo 1.4.1: lotes só saem da fila durável depois do ACK da página Study;
 * reset operacional limpa somente jobs/lotes de reconstrução.
 */
'use strict';

(() => {
  if (window.top !== window.self || window.__snmTecReconstructStudyBridge) return;
  window.__snmTecReconstructStudyBridge = true;

  const APP_SOURCE = 'StudyNoMentorApp';
  const EXT_SOURCE = 'StudyMentorCompanion';
  let port = null;
  let reconnectTimer = null;
  let retry = 500;
  const pending = [];

  function postToPage(type, payload = {}) {
    try { window.postMessage({ source:EXT_SOURCE, type, payload }, location.origin); } catch (_) {}
  }

  function queue(message) {
    pending.push(message);
    if (pending.length > 500) pending.splice(0, pending.length - 500);
  }

  function send(message) {
    if (!port) {
      queue(message);
      connect();
      return false;
    }
    try { port.postMessage(message); return true; }
    catch (_) { queue(message); port = null; scheduleReconnect(); return false; }
  }

  function flush() {
    if (!port) return;
    while (pending.length) {
      const msg = pending[0];
      try { port.postMessage(msg); pending.shift(); }
      catch (_) { port = null; scheduleReconnect(); break; }
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, retry);
    retry = Math.min(10000, retry * 2);
  }

  function connect() {
    if (port) return;
    try { port = chrome.runtime.connect({ name:'snm-study-reconstruct-v1' }); }
    catch (_) { scheduleReconnect(); return; }
    retry = 500;
    port.onMessage.addListener(msg => {
      if (!msg || !msg.kind) return;
      if (msg.kind === 'tec-reconstruct-status') postToPage('tec-reconstruct-status', msg.payload || {});
      else if (msg.kind === 'tec-reconstruct-progress') postToPage('tec-reconstruct-progress', msg.payload || {});
      else if (msg.kind === 'tec-reconstruct-batch') postToPage('tec-reconstruct-batch', msg.payload || {});
      else if (msg.kind === 'tec-reconstruct-result') postToPage('tec-reconstruct-result', msg.payload || {});
      else if (msg.kind === 'tec-reconstruct-error') postToPage('tec-reconstruct-error', msg.payload || {});
    });
    port.onDisconnect.addListener(() => {
      const ignored = chrome.runtime.lastError; void ignored;
      port = null;
      postToPage('tec-reconstruct-status', { status:'reconnecting' });
      scheduleReconnect();
    });
    flush();
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== APP_SOURCE) return;
    if (msg.type === 'tec-reconstruct-request') {
      send({ type:'reconstruct-request', payload:msg.payload || {} });
    } else if (msg.type === 'tec-reconstruct-cancel') {
      send({ type:'reconstruct-cancel', payload:msg.payload || {} });
    } else if (msg.type === 'tec-reconstruct-resync') {
      send({ type:'reconstruct-resync', payload:msg.payload || {} });
    } else if (msg.type === 'tec-reconstruct-batch-ack') {
      send({ type:'reconstruct-batch-ack', payload:msg.payload || {} });
    } else if (msg.type === 'tec-reconstruct-hard-reset') {
      /* Nunca permita que um request/ACK antigo guardado nesta ponte seja
         reenviado depois da limpeza e recrie um job que o usuário acabou de cancelar. */
      pending.length = 0;
      chrome.runtime.sendMessage({ kind:'tec-reconstruct-reset-all' })
        .then(result => postToPage('tec-reconstruct-reset-result', result || { ok:false }))
        .catch(error => postToPage('tec-reconstruct-reset-result', { ok:false, error:String(error && error.message || error) }));
    }
  });

  connect();
})();
