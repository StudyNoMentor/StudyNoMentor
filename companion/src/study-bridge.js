/* Ponte isolada da extensão para a página StudyNoMentor. */
'use strict';

(() => {
  if (window.top !== window.self) return;
  const APP_SOURCE = 'StudyNoMentorApp';
  const PLUS_PROXY_SOURCE = 'StudyNoMentorPlusProxy';
  const EXT_SOURCE = 'StudyMentorCompanion';
  let port = null;
  let pageReady = false;
  let plusProxyReady = false;
  let retry = 500;
  let retryTimer = null;
  let studyContext = null;
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
    if (plusProxyReady) window.postMessage({ source:EXT_SOURCE, type:'plus-ai-ready', version:chrome.runtime.getManifest().version }, location.origin);
  }
  function scheduleReconnect(delay=retry) {
    if (port || retryTimer) return;
    retryTimer=setTimeout(()=>{ retryTimer=null; connect(); },delay);
  }
  function bindStudy(claim=false) {
    if (!studyContext) return;
    const ctx={...studyContext};
    try {
      if (port) {
        port.postMessage({type:'bind-study',context:ctx});
        if (claim) port.postMessage({type:'claim-capture-route',context:ctx});
      } else {
        chrome.runtime.sendMessage({kind:'study-route-bind',context:ctx,claim:!!claim},()=>{ const ignored=chrome.runtime.lastError; void ignored; });
      }
    } catch (_) {}
  }
  function resync() {
    if (!port) return;
    try { bindStudy(false); port.postMessage({ type:'resync' }); } catch (_) {}
  }
  function enqueuePlus(requestId,payload) {
    if (!requestId) return;
    const message={ kind:'plus-ai-request', requestId:String(requestId), payload:payload||{}, context:studyContext||null };
    try {
      chrome.runtime.sendMessage(message,()=>{ const ignored=chrome.runtime.lastError; void ignored; });
    } catch (_) {
      window.postMessage({ source:EXT_SOURCE, type:'plus-ai-response', requestId:String(requestId), ok:false, status:503,
        error:'Não foi possível acessar o Companion. Recarregue a extensão e tente novamente.' }, location.origin);
    }
  }
  function ackPlus(requestId) {
    if (!requestId) return;
    try {
      if (port) port.postMessage({ type:'plus-ai-ack', requestId:String(requestId) });
      else chrome.runtime.sendMessage({ kind:'plus-ai-ack', requestId:String(requestId), context:studyContext||null },()=>{ const ignored=chrome.runtime.lastError; void ignored; });
    } catch (_) {}
  }
  function cancelPlus(requestId) {
    if (!requestId) return;
    try {
      if (port) port.postMessage({ type:'plus-ai-cancel', requestId:String(requestId) });
      else chrome.runtime.sendMessage({ kind:'plus-ai-cancel', requestId:String(requestId), context:studyContext||null },()=>{ const ignored=chrome.runtime.lastError; void ignored; });
    } catch (_) {}
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
      else if (msg.kind==='plus-ai-result' && msg.payload && msg.payload.requestId) {
        window.postMessage({ source:EXT_SOURCE, type:'plus-ai-response', ...msg.payload }, location.origin);
      } else if (msg.kind==='plus-ai-status' && msg.payload) {
        window.postMessage({ source:EXT_SOURCE, type:'plus-ai-status', ...msg.payload }, location.origin);
      }
    });
    port.onDisconnect.addListener(()=>{
      const ignored=chrome.runtime.lastError; void ignored;
      port=null;
      lifecycle={ type:'port-disconnect', at:new Date().toISOString(), persisted:false };
      forwardEnvelope(pageEnvelope('companion-disconnected',{ reconnecting:true, reason:'port-disconnect', lifecycle }));
      if (plusProxyReady) window.postMessage({ source:EXT_SOURCE, type:'plus-ai-disconnected' }, location.origin);
      scheduleReconnect(); retry=Math.min(10000,retry*2);
    });
    lifecycle={ type:'port-connect', at:new Date().toISOString(), persisted:false };
    bindStudy(false);
    if (pageReady || plusProxyReady) { announce(); resync(); }
  }

  window.addEventListener('message',(event)=>{
    if (event.source!==window || event.origin!==location.origin) return;
    const msg=event.data;
    if (!msg) return;

    if (msg.source===APP_SOURCE) {
      if (msg.type==='bridge-ready') {
        pageReady=true; announce(); flushBuffer(); resync();
      } else if (msg.type==='bridge-context' && msg.payload) {
        studyContext={...msg.payload}; bindStudy(!!msg.claim); if (msg.claim) resync();
      } else if (msg.type==='ack' && msg.messageId) {
        try { port && port.postMessage({ type:'ack', messageId:String(msg.messageId) }); } catch (_) {}
      }
      return;
    }

    if (msg.source===PLUS_PROXY_SOURCE) {
      if (msg.type==='plus-ai-proxy-ready') {
        plusProxyReady=true; announce(); resync();
      } else if (msg.type==='plus-ai-request' && msg.requestId) {
        enqueuePlus(msg.requestId,msg.payload||{});
      } else if (msg.type==='plus-ai-ack' && msg.requestId) {
        ackPlus(msg.requestId);
      } else if (msg.type==='plus-ai-cancel' && msg.requestId) {
        cancelPlus(msg.requestId);
      }
    }
  });

  window.addEventListener('pagehide',(event)=>{
    lifecycle={ type:'pagehide', at:new Date().toISOString(), persisted:!!event.persisted };
  });
  window.addEventListener('pageshow',(event)=>{
    lifecycle={ type:'pageshow', at:new Date().toISOString(), persisted:!!event.persisted };
    if (!port) connect();
    setTimeout(()=>{ if (pageReady || plusProxyReady) { bindStudy(true); announce(); flushBuffer(); resync(); } },50);
  });
  document.addEventListener('visibilitychange',()=>{
    lifecycle={ type:'visibilitychange', at:new Date().toISOString(), persisted:false, visibility:document.visibilityState };
    if (document.visibilityState==='visible') { if (!port) connect(); setTimeout(()=>{ bindStudy(true); if (pageReady || plusProxyReady) resync(); },50); }
  });

  connect();
})();
