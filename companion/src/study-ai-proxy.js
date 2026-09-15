/* StudyNoMentor Companion — proxy MAIN-world da IA TEC para ChatGPT Plus.
 * Intercepta somente a chamada /functions/v1/tec-ai e a transforma em um job
 * local da extensão. Nenhuma chave da OpenAI é usada ou exposta.
 */
'use strict';

(() => {
  if (window.top !== window.self) return;

  const PROXY_SOURCE = 'StudyNoMentorPlusProxy';
  const EXT_SOURCE = 'StudyMentorCompanion';
  const TARGET_RX = /\/functions\/v1\/tec-ai(?:\?|$)/i;
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

  function response(body, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  async function bodyOf(input, init) {
    if (init && typeof init.body === 'string') return init.body;
    if (input instanceof Request) {
      try { return await input.clone().text(); } catch (_) { return ''; }
    }
    return '';
  }

  function analysisEnvelope(section, text) {
    const key = String(section || 'diagnostico');
    return { [key]: String(text || '').trim() };
  }

  function failAll(reason) {
    for (const [requestId, item] of pending) {
      clearTimeout(item.timer);
      item.resolve(response({ error: reason || 'A ponte com o ChatGPT Plus foi interrompida.' }, 502));
      pending.delete(requestId);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== EXT_SOURCE) return;

    if (msg.type === 'plus-ai-ready') {
      bridgeReady = true;
      return;
    }
    if (msg.type === 'plus-ai-disconnected') {
      bridgeReady = false;
      return;
    }
    if (msg.type !== 'plus-ai-response' || !msg.requestId) return;

    const item = pending.get(String(msg.requestId));
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(String(msg.requestId));

    if (!msg.ok) {
      item.resolve(response({ error: msg.error || 'Não foi possível concluir a análise no ChatGPT Plus.' }, Number(msg.status) || 502));
    } else {
      item.resolve(response({
        analysis: analysisEnvelope(msg.section || item.section, msg.text),
        promptVersion: msg.promptVersion || item.promptVersion || null,
        transport: 'chatgpt-plus-browser',
        requestId: msg.requestId
      }, 200));
    }

    window.postMessage({ source:PROXY_SOURCE, type:'plus-ai-ack', requestId:String(msg.requestId) }, location.origin);
  });

  window.fetch = async function(input, init) {
    const url = urlOf(input);
    if (!TARGET_RX.test(url)) return nativeFetch(input, init);

    const method = String((init && init.method) || (input instanceof Request && input.method) || 'GET').toUpperCase();
    if (method !== 'POST') return nativeFetch(input, init);

    let payload;
    try { payload = JSON.parse(await bodyOf(input, init) || '{}'); }
    catch (_) { return response({ error:'O pedido de IA do StudyNoMentor é inválido.' }, 400); }

    const requestId = uid();
    const section = String(payload && payload.section || 'diagnostico');
    const promptVersion = payload && payload.promptVersion || null;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve(response({ error:'O ChatGPT Plus não respondeu dentro do tempo esperado. Verifique se você está conectado ao ChatGPT no navegador.' }, 504));
      }, 180000);

      pending.set(requestId, { resolve, timer, section, promptVersion });
      window.postMessage({
        source:PROXY_SOURCE,
        type:'plus-ai-request',
        requestId,
        payload
      }, location.origin);

      if (!bridgeReady) {
        setTimeout(() => {
          if (!pending.has(requestId) || bridgeReady) return;
          clearTimeout(timer);
          pending.delete(requestId);
          resolve(response({ error:'O Companion está instalado, mas a ponte com o ChatGPT Plus ainda não ficou pronta. Recarregue a extensão e a página.' }, 503));
        }, 6000);
      }
    });
  };

  window.addEventListener('pagehide', () => failAll('A página foi fechada antes de a análise terminar.'));
  window.postMessage({ source:PROXY_SOURCE, type:'plus-ai-proxy-ready' }, location.origin);
})();
