/* StudyNoMentor Companion — proxy MAIN-world opcional para ChatGPT Plus.
 *
 * A API do servidor é o caminho padrão. Este proxy só intercepta /tec-ai quando
 * o próprio pedido declara provider="chatgpt-plus-browser". Assim Gemini/OpenAI
 * e outros provedores configurados no backend nunca são sequestrados pela extensão.
 */
'use strict';

(() => {
  if (window.top !== window.self) return;

  const PROXY_SOURCE = 'StudyNoMentorPlusProxy';
  const EXT_SOURCE = 'StudyMentorCompanion';
  const TARGET_RX = /\/functions\/v1\/tec-ai(?:\?|$)/i;
  const BROWSER_PROVIDER = 'chatgpt-plus-browser';
  const pending = new Map();
  const nativeFetch = window.fetch.bind(window);
  let bridgeReady = false;

  function uid() {
    try { return crypto.randomUUID(); }
    catch (_) { return `plus_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
  }
  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try { return String(input || ''); } catch (_) { return ''; }
  }
  function response(body,status=200) {
    return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8'}});
  }
  async function bodyOf(input,init) {
    if (init&&typeof init.body==='string') return init.body;
    if (input instanceof Request) { try { return await input.clone().text(); } catch (_) { return ''; } }
    return '';
  }
  function analysisEnvelope(section,text) { return {[String(section||'diagnostico')]:String(text||'').trim()}; }
  function cancel(requestId,reason) {
    if (!requestId) return;
    window.postMessage({source:PROXY_SOURCE,type:'plus-ai-cancel',requestId:String(requestId),reason:reason||'cancelled'},location.origin);
  }
  function failAll(reason) {
    for (const [requestId,item] of pending) {
      clearTimeout(item.timer); cancel(requestId,reason);
      item.resolve(response({error:reason||'A ponte com o ChatGPT Plus foi interrompida.'},502));
      pending.delete(requestId);
    }
  }

  window.addEventListener('message',event=>{
    if (event.source!==window||event.origin!==location.origin) return;
    const msg=event.data;
    if (!msg||msg.source!==EXT_SOURCE) return;
    if (msg.type==='plus-ai-ready') { bridgeReady=true; return; }
    if (msg.type==='plus-ai-disconnected') { bridgeReady=false; return; }
    if (msg.type!=='plus-ai-response'||!msg.requestId) return;

    const item=pending.get(String(msg.requestId));
    if (!item) return;
    clearTimeout(item.timer); pending.delete(String(msg.requestId));
    if (!msg.ok) item.resolve(response({error:msg.error||'Não foi possível concluir a análise no ChatGPT Plus.'},Number(msg.status)||502));
    else if (msg.partial) item.resolve(response({error:'O ChatGPT devolveu apenas uma resposta parcial. Reprocesse a análise.'},502));
    else item.resolve(response({analysis:analysisEnvelope(msg.section||item.section,msg.text),promptVersion:msg.promptVersion||item.promptVersion||null,
      transport:BROWSER_PROVIDER,provider:BROWSER_PROVIDER,requestId:msg.requestId},200));
    window.postMessage({source:PROXY_SOURCE,type:'plus-ai-ack',requestId:String(msg.requestId)},location.origin);
  });

  window.fetch = async function(input,init) {
    const url=urlOf(input);
    if (!TARGET_RX.test(url)) return nativeFetch(input,init);
    const method=String((init&&init.method)||(input instanceof Request&&input.method)||'GET').toUpperCase();
    if (method!=='POST') return nativeFetch(input,init);

    let raw,payload;
    try { raw=await bodyOf(input,init); payload=JSON.parse(raw||'{}'); }
    catch (_) { return response({error:'O pedido de IA do StudyNoMentor é inválido.'},400); }

    if (String(payload&&payload.provider||'auto')!==BROWSER_PROVIDER) return nativeFetch(input,init);

    const requestId=uid(), section=String(payload&&payload.section||'diagnostico'), promptVersion=payload&&payload.promptVersion||null;
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{
        if (!pending.has(requestId)) return;
        pending.delete(requestId); cancel(requestId,'proxy_timeout');
        resolve(response({error:'O ChatGPT Plus não respondeu dentro do tempo esperado.'},504));
      },150000);
      pending.set(requestId,{resolve,timer,section,promptVersion});
      window.postMessage({source:PROXY_SOURCE,type:'plus-ai-request',requestId,payload},location.origin);

      if (!bridgeReady) {
        setTimeout(()=>{
          if (!pending.has(requestId)||bridgeReady) return;
          clearTimeout(timer); pending.delete(requestId); cancel(requestId,'bridge_not_ready');
          resolve(response({error:'O provedor ChatGPT Plus foi escolhido, mas o Companion ainda não está pronto. Use API/Auto ou recarregue a extensão.'},503));
        },6000);
      }
    });
  };

  window.addEventListener('pagehide',()=>failAll('A página foi fechada antes de a análise terminar.'));
  window.postMessage({source:PROXY_SOURCE,type:'plus-ai-proxy-ready'},location.origin);
})();
