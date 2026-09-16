/* Entry point do service worker do Companion.
 *
 * O Companion possui UMA aba ChatGPT própria. Nunca reutiliza uma conversa
 * arbitrária do usuário. O ID da aba dedicada é persistido em chrome.storage e
 * só é reutilizado quando continua apontando para chatgpt.com.
 */
'use strict';

(() => {
  const OWNED_TAB_KEY = 'snmPlusOwnedTabV2';
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

  async function ownedTabId() {
    try { const row=await chrome.storage.local.get(OWNED_TAB_KEY); return row&&row[OWNED_TAB_KEY]!=null?Number(row[OWNED_TAB_KEY]):null; }
    catch (_) { return null; }
  }
  async function rememberOwned(id) {
    if (id==null) return;
    try { await chrome.storage.local.set({[OWNED_TAB_KEY]:Number(id)}); } catch (_) {}
  }
  async function forgetOwned(id) {
    try {
      const current=await ownedTabId();
      if (id==null||current===Number(id)) await chrome.storage.local.remove(OWNED_TAB_KEY);
    } catch (_) {}
  }

  chrome.tabs.create = async function(createProperties = {}) {
    const url = String(createProperties && createProperties.url || '');
    if (!CHAT_URL.test(url)) return nativeCreate(createProperties);

    const wanted=await ownedTabId();
    if (wanted!=null) {
      try {
        const tab=await nativeGet(wanted);
        if (tab && tab.id!=null && CHAT_URL.test(String(tab.url||'')) && !tab.discarded) {
          wake(tab.id,350); return tab;
        }
      } catch (_) { await forgetOwned(wanted); }
    }

    /* A consulta existe apenas para validar que NÃO vamos adotar uma aba pessoal.
       Nenhum resultado daqui é reutilizado sem o ID previamente persistido. */
    try { await nativeQuery({ url:['https://chatgpt.com/*'] }); } catch (_) {}

    const tab = await nativeCreate(createProperties);
    if (tab && tab.id != null) { await rememberOwned(tab.id); wake(tab.id,1200); }
    return tab;
  };

  chrome.tabs.remove = async function(tabIds) {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    const owned=await ownedTabId();
    const remove=[];
    for (const id of ids) {
      if (owned!=null && Number(id)===Number(owned)) { wake(id,120); continue; }
      remove.push(Number(id));
    }
    if (remove.length) return nativeRemove(Array.isArray(tabIds) ? remove : remove[0]);
    return undefined;
  };

  chrome.tabs.onRemoved.addListener(tabId => { ownedTabId().then(id=>{ if (id===Number(tabId)) return forgetOwned(tabId); }).catch(()=>{}); });
})();

importScripts('background-v2.js','background-reconstruct.js','background-reconstruct-backpressure-v2.js');
