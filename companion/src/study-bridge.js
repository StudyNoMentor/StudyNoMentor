/* Ponte isolada da extensão para a página StudyNoMentor. */
'use strict';

(() => {
  if (window.top !== window.self) return;
  const APP_SOURCE = 'StudyNoMentorApp';
  const EXT_SOURCE = 'StudyMentorCompanion';
  let port = null;
  let pageReady = false;
  let retry = 500;
  const buffer = [];

  function forwardEnvelope(env) {
    if (!env || env.source !== EXT_SOURCE || Number(env.protocol) !== 1) return;
    if (!pageReady) {
      buffer.push(env);
      if (buffer.length > 2000) buffer.splice(0, buffer.length - 2000);
      return;
    }
    window.postMessage(env, location.origin);
  }

  function flushBuffer() {
    if (!pageReady) return;
    while (buffer.length) window.postMessage(buffer.shift(), location.origin);
  }

  function announce() {
    window.postMessage({
      source: EXT_SOURCE,
      protocol: 1,
      type: 'companion-ready',
      messageId: 'companion-ready-' + Date.now(),
      createdAtMs: Date.now(),
      payload: { installed: true, version: chrome.runtime.getManifest().version }
    }, location.origin);
  }

  function connect() {
    try { port = chrome.runtime.connect({ name: 'snm-study-v1' }); }
    catch (_) { setTimeout(connect, retry); retry = Math.min(10000, retry * 2); return; }
    retry = 500;
    port.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.kind === 'envelope') forwardEnvelope(msg.envelope);
      else if (msg.kind === 'batch' && Array.isArray(msg.envelopes)) msg.envelopes.forEach(forwardEnvelope);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, retry);
      retry = Math.min(10000, retry * 2);
    });
    if (pageReady) {
      announce();
      try { port.postMessage({ type: 'resync' }); } catch (_) {}
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== APP_SOURCE) return;
    if (msg.type === 'bridge-ready') {
      pageReady = true;
      announce();
      flushBuffer();
      try { port && port.postMessage({ type: 'resync' }); } catch (_) {}
    } else if (msg.type === 'ack' && msg.messageId) {
      try { port && port.postMessage({ type: 'ack', messageId: String(msg.messageId) }); } catch (_) {}
    }
  });

  connect();
})();
