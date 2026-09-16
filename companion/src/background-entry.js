/* Entry point do service worker do Companion.
 *
 * A versão anterior abria e fechava uma aba nova do ChatGPT para CADA seção
 * pedagógica. Aqui preservamos toda a fila/transação do background original,
 * mas virtualizamos apenas create/remove de abas ChatGPT: uma aba existente é
 * reutilizada e acordada. Isso reduz latência e elimina a sensação de fluxo
 * imprevisível com janelas surgindo a cada clique.
 */
'use strict';

(() => {
  const nativeCreate = chrome.tabs.create.bind(chrome.tabs);
  const nativeRemove = chrome.tabs.remove.bind(chrome.tabs);
  const nativeQuery = chrome.tabs.query.bind(chrome.tabs);
  const nativeGet = chrome.tabs.get.bind(chrome.tabs);
  const CHAT_URL = /^https:\/\/chatgpt\.com(?:\/|$)/i;

  function wake(tabId, delay = 250) {
    if (tabId == null) return;
    setTimeout(() => {
      try {
        chrome.tabs.sendMessage(Number(tabId), { kind:'plus-ai-wake' }, () => {
          const ignored = chrome.runtime.lastError; void ignored;
        });
      } catch (_) {}
    }, delay);
  }

  chrome.tabs.create = async function(createProperties = {}) {
    const url = String(createProperties && createProperties.url || '');
    if (!CHAT_URL.test(url)) return nativeCreate(createProperties);
    try {
      const tabs = await nativeQuery({ url:['https://chatgpt.com/*'] });
      const reusable = (tabs || []).find(t => t && t.id != null && !t.discarded);
      if (reusable) {
        wake(reusable.id, 400);
        return reusable;
      }
    } catch (_) {}
    const tab = await nativeCreate(createProperties);
    if (tab && tab.id != null) wake(tab.id, 1200);
    return tab;
  };

  chrome.tabs.remove = async function(tabIds) {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    const keep = [], remove = [];
    for (const id of ids) {
      try {
        const tab = await nativeGet(Number(id));
        if (tab && CHAT_URL.test(String(tab.url || ''))) keep.push(Number(id));
        else remove.push(Number(id));
      } catch (_) { remove.push(Number(id)); }
    }
    keep.forEach(id => wake(id, 120));
    if (remove.length) return nativeRemove(Array.isArray(tabIds) ? remove : remove[0]);
    return undefined;
  };
})();

importScripts('background.js');
