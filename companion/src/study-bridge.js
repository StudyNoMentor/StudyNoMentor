/* Ponte isolada da extensão para a página StudyNoMentor. */
'use strict';

(() => {
  if (window.top !== window.self) return;
  const APP_SOURCE = 'StudyNoMentorApp';
  const EXT_SOURCE = 'StudyMentorCompanion';
  let port = null;
  let pageReady = false;
  let retry = 500;
  let retryTimer = null;
  let lifecycle = { type:'load', at:new Date().toISOString(), persisted:false };
  const buffer = [];

  function pageEnvelope(type,payload) {
    return { source:EXT_SOURCE, protocol:1, type, messageId:`${type}-${Date.now()}`, createdAtMs:Date.now(), payload:payload||{} };
  }
  function forwardEnvelope(env) {
    if (!env || env.source!==EXT_SOURCE || Number(env.protocol)!==1) return;
    if (!pageReady) {
      buffer.push(env); if (buffer.length>2000) buffer.splice(0,buffer.length-2000); return;
    }
    window.postMessage(env,location.origin);
  }
  function forwardHealth(payload) { forwardEnvelope(pageEnvelope('companion-health',payload)); }
  function flushBuffer() { if (!pageReady) return; while (buffer.length) window.postMessage(buffer.shift(),location.origin); }
  function announce() {
    forwardEnvelope(pageEnvelope('companion-ready',{ installed:true, version:chrome.runtime.getManifest().version, lifecycle }));
  }
  function scheduleReconnect(delay=retry) {
    if (port || retryTimer) return;
    retryTimer=setTimeout(()=>{ retryTimer=null; connect(); },delay);
  }
  function resync() {
    if (!port) return;
    try { port.postMessage({ type:'resync' }); } catch (_) {}
  }
  function connect() {
    if (port) return;
    try { port=chrome.runtime.connect({ name:'snm-study-v1' }); }
    catch (_) { scheduleReconnect(); retry=Math.min(10000,retry*2); return; }
    retry=500;
    port.onMessage.addListener((msg)=>{
      if (!msg) return;
      if (msg.kind==='envelope') forwardEnvelope(msg.envelope);
      else if (msg.kind==='batch' && Array.isArray(msg.envelopes)) { msg.envelopes.forEach(forwardEnvelope); if (msg.health) forwardHealth(msg.health); }
      else if (msg.kind==='health') forwardHealth(msg.payload||{});
    });
    port.onDisconnect.addListener(()=>{
      const ignored=chrome.runtime.lastError; void ignored;
      port=null;
      lifecycle={ type:'port-disconnect', at:new Date().toISOString(), persisted:false };
      forwardEnvelope(pageEnvelope('companion-disconnected',{ reconnecting:true, reason:'port-disconnect', lifecycle }));
      scheduleReconnect(); retry=Math.min(10000,retry*2);
    });
    lifecycle={ type:'port-connect', at:new Date().toISOString(), persisted:false };
    if (pageReady) { announce(); resync(); }
  }

  window.addEventListener('message',(event)=>{
    if (event.source!==window || event.origin!==location.origin) return;
    const msg=event.data;
    if (!msg || msg.source!==APP_SOURCE) return;
    if (msg.type==='bridge-ready') {
      pageReady=true; announce(); flushBuffer(); resync();
    } else if (msg.type==='ack' && msg.messageId) {
      try { port && port.postMessage({ type:'ack', messageId:String(msg.messageId) }); } catch (_) {}
    }
  });

  window.addEventListener('pagehide',(event)=>{
    lifecycle={ type:'pagehide', at:new Date().toISOString(), persisted:!!event.persisted };
  });
  window.addEventListener('pageshow',(event)=>{
    lifecycle={ type:'pageshow', at:new Date().toISOString(), persisted:!!event.persisted };
    if (!port) connect();
    setTimeout(()=>{ if (pageReady) { announce(); flushBuffer(); resync(); } },50);
  });
  document.addEventListener('visibilitychange',()=>{
    lifecycle={ type:'visibilitychange', at:new Date().toISOString(), persisted:false, visibility:document.visibilityState };
    if (document.visibilityState==='visible') { if (!port) connect(); setTimeout(()=>{ if (pageReady) resync(); },50); }
  });

  connect();
})();
