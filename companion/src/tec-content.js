/* Captura de resoluções do TecConcursos para o StudyNoMentor Companion.
 * Não lê credenciais nem envia tokens. A identidade TEC é um fingerprint local.
 * Entrega transacional: estágio local -> service worker/fila -> ACK do Study.
 */
'use strict';

(() => {
  if (window.__snmTecCompanion) return;
  window.__snmTecCompanion = true;

  const EXT_SOURCE = 'StudyMentorCompanion';
  const PAGE_SOURCE = 'StudyMentorTecPage';
  const PAGE_REQUEST_SOURCE = 'StudyMentorCompanionIsolated';
  const VERSION = chrome.runtime.getManifest().version;
  const STAGE_PREFIX = 'snmTecStageV1:';
  const MAX_STAGE_REPLAY = 500;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let port = null;
  let reconnectMs = 500;
  let reconnectTimer = null;
  let pending = null;
  let processing = false;
  let replaying = false;
  let pageContext = null;
  let lastCapture = { status:'idle', questionId:null, at:null, reason:null };
  let lastFingerprint = '';
  let lastFingerprintAt = 0;
  let lifecycle = { type:'load', at:new Date().toISOString(), persisted:false };

  const text = (el) => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = (el) => !!(el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed'));
  const escRx = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uid = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  function fnv(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function localDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function currentBookId() {
    const m = location.pathname.match(/\/questoes\/cadernos\/(\d+)/i);
    return m ? m[1] : '';
  }

  function accountFingerprint() {
    const ids = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (!/(usuario|user|account|conta|perfil|profile)/i.test(k)) continue;
        const v = String(localStorage.getItem(k) || '').slice(0, 3000);
        const re = /"(?:idUsuario|usuarioId|userId|id_user|id)"\s*:\s*"?([A-Za-z0-9_-]{2,80})/gi;
        let m; let n = 0;
        while ((m = re.exec(v)) && n++ < 3) ids.push(`${k}:${m[1]}`);
      }
    } catch (_) {}
    const labels = [];
    for (const sel of ['[class*="usuario" i]','[class*="perfil" i]','[class*="profile" i]','a[href*="logout" i]','button[aria-label*="perfil" i]']) {
      for (const el of [...document.querySelectorAll(sel)].slice(0,5)) {
        const t = text(el); if (visible(el) && t && t.length < 120) labels.push(t);
      }
    }
    const seed = [...new Set(ids)].sort().join('|') || [...new Set(labels)].sort().join('|') || 'tec-session';
    return 'tec_' + fnv(seed);
  }

  function acceptPageContext(raw) {
    if (!raw || typeof raw !== 'object') return;
    const id = String(raw.id || raw.questionId || '').match(/\d{4,}/)?.[0] || null;
    pageContext = {
      id,
      materia:String(raw.materia || ''), assunto:String(raw.assunto || ''), banca:String(raw.banca || ''), concurso:String(raw.concurso || ''),
      enunciado:String(raw.enunciado || ''), alternativas:Array.isArray(raw.alternativas) ? raw.alternativas.slice(0,8) : [],
      capturedAtMs:Number(raw.capturedAtMs || Date.now()), href:String(raw.href || location.href)
    };
  }

  function requestPageContext() {
    try { window.postMessage({ source:PAGE_REQUEST_SOURCE, type:'context-request', at:Date.now() }, location.origin); } catch (_) {}
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== PAGE_SOURCE || msg.type !== 'question-context') return;
    acceptPageContext(msg.context || msg.payload || {});
  });

  function pageQuestionId() {
    if (!pageContext || Date.now() - Number(pageContext.capturedAtMs || 0) > 30000) return null;
    return pageContext.id || null;
  }

  function questionId() {
    for (const el of document.querySelectorAll('[data-question-id],[data-questao-id],[data-id-questao],[data-idquestao]')) {
      for (const a of ['data-question-id','data-questao-id','data-id-questao','data-idquestao']) {
        const v = el.getAttribute(a); if (v && /^\d+$/.test(v)) return v;
      }
    }
    for (const el of [...document.querySelectorAll('a[href],a[aria-label],button[aria-label],h1,h2,h3,h4,strong,[class*="quest" i],[id*="quest" i]')].slice(0,1200)) {
      if (!visible(el)) continue;
      const hay = [el.getAttribute && el.getAttribute('href'), el.getAttribute && el.getAttribute('aria-label'), text(el)].join(' ');
      let m = hay.match(/(?:\/questoes\/|quest[aã]o\s*#?\s*|#)(\d{4,})/i);
      if (!m && /quest|cabec|header|detalh/i.test(String(el.className||'')+' '+String(el.id||''))) m = hay.match(/\bID\s*[:#]?\s*(\d{4,})\b/i);
      if (m) return m[1];
    }
    return pageQuestionId();
  }

  function firstVisible(selectors) {
    for (const sel of selectors) for (const el of document.querySelectorAll(sel)) if (visible(el) && text(el)) return el;
    return null;
  }
  function matter() { return text(firstVisible(['a[ng-href*="/materias/"]','a[href*="/materias/"]','[data-eq-slot="materia"]','[class*="materia" i]'])) || String(pageContext && pageContext.materia || ''); }
  function topic() { return text(firstVisible(['span[ng-bind*="Assunto"]','span[ng-bind="vm.nomeAssuntoExibicao()"]','[data-eq-slot="assunto"]','[class*="assunto" i]'])) || String(pageContext && pageContext.assunto || ''); }
  function metadataLink(kind) {
    const live = text(firstVisible([`a[href*="/${kind}/"]`])); if (live) return live;
    if (kind === 'bancas') return String(pageContext && pageContext.banca || '');
    if (kind === 'concursos') return String(pageContext && pageContext.concurso || '');
    return '';
  }

  function alternativeLetter(el) {
    if (!el) return null;
    const direct = el.getAttribute && (el.getAttribute('data-letter') || el.getAttribute('data-letra') || el.getAttribute('value'));
    if (direct && /^[A-E]$/i.test(String(direct).trim())) return String(direct).trim().toUpperCase();
    const m = text(el).match(/^\s*([A-E])(?:\s*[\)\.\-:]|\s{1,})/i); return m ? m[1].toUpperCase() : null;
  }
  function isSelected(el) {
    if (!el) return false;
    if (el.matches && el.matches('input:checked')) return true;
    if (el.querySelector && el.querySelector('input:checked')) return true;
    if (String(el.getAttribute && el.getAttribute('aria-checked')).toLowerCase() === 'true') return true;
    if (String(el.getAttribute && el.getAttribute('aria-pressed')).toLowerCase() === 'true') return true;
    return /(?:^|\s)(?:selected|selecionad[ao]|marcad[ao]|checked|active)(?:\s|$)/i.test(String(el.className || ''));
  }
  function isCorrect(el) {
    const cl = String(el && el.className || ''), aria = String(el && el.getAttribute && el.getAttribute('aria-label') || '');
    return /(?:wk7j7j|corret[ao]|correct|success|certa)(?:\s|$|_|-)/i.test(cl+' '+aria) || !!(el && el.querySelector && el.querySelector('.glyphicon-ok-sign,.fa-check,[class*="correct" i],[class*="corret" i]'));
  }
  function isWrongMarked(el) {
    const cl = String(el && el.className || '');
    return /(?:bz2gcz|incorrect|errad[ao]|danger|wrong)(?:\s|$|_|-)/i.test(cl) || !!(el && el.querySelector && el.querySelector('.glyphicon-remove,.fa-times,[class*="incorrect" i],[class*="errad" i]'));
  }
  function alternatives() {
    const map = new Map();
    const nodes = [...document.querySelectorAll('label,button,[role="radio"],li,[data-letter],[data-letra],.wk7j7j,.bz2gcz')].slice(0,1200);
    for (const node of nodes) {
      if (!visible(node)) continue;
      const letra = alternativeLetter(node); if (!letra || map.has(letra)) continue;
      const raw = text(node); if (raw.length < 2 || raw.length > 2500) continue;
      const texto = raw.replace(new RegExp('^\\s*'+escRx(letra)+'\\s*(?:[\\)\\.\\-:]|\\s+)\\s*','i'),'').trim();
      map.set(letra,{ letra, texto, selected:isSelected(node), correct:isCorrect(node), wrong:isWrongMarked(node) });
    }
    return [...map.values()].sort((a,b)=>a.letra.localeCompare(b.letra)).slice(0,5);
  }
  function statement() {
    const el = firstVisible(['[data-eq-slot="enunciado"]','[data-testid*="enunciado" i]','[class*="enunciado" i]','[id*="enunciado" i]','[class*="statement" i]']);
    const t = text(el); return t.length >= 10 ? t : String(pageContext && pageContext.enunciado || '');
  }

  function result(selectedBefore = null) {
    const candidates = [...document.querySelectorAll('.jm44ow,[class*="resultado" i],[class*="feedback" i],[role="alert"]')].filter(visible).slice(0,120);
    for (const el of candidates) {
      const t = text(el).toLowerCase();
      if (el.querySelector('.glyphicon-ok-sign') || /você acertou|voce acertou|resposta correta|parabéns.*acert/i.test(t)) return { acertou:true, text:t, source:'banner' };
      if (el.querySelector('.glyphicon-remove') || /você errou|voce errou|resposta incorreta|resposta errada/i.test(t)) return { acertou:false, text:t, source:'banner' };
    }
    const alts = alternatives(), correct = alts.find(a=>a.correct), wrong = alts.find(a=>a.wrong);
    const marked = (alts.find(a=>a.selected)||{}).letra || selectedBefore || null;
    if (wrong && correct) return { acertou:false, text:'estado visual das alternativas', source:'alternatives' };
    if (correct && marked) return { acertou:String(correct.letra)===String(marked), text:'gabarito visual das alternativas', source:'alternatives' };
    return null;
  }

  function buildQuestion(acertou, selectedBefore) {
    let alts = alternatives();
    if (alts.length < 2 && pageContext && Array.isArray(pageContext.alternativas)) {
      alts = pageContext.alternativas.map((a,i)=>({
        letra:String(a.letra||a.label||String.fromCharCode(65+i)).toUpperCase().match(/[A-E]/)?.[0]||null,
        texto:String(a.texto||a.text||a.descricao||''), selected:!!(a.selected||a.marcada), correct:!!(a.correct||a.correta), wrong:!!(a.wrong||a.errada)
      })).filter(a=>a.letra);
    }
    let marcada = (alts.find(a=>a.selected)||{}).letra || selectedBefore || null;
    const correta = (alts.find(a=>a.correct)||{}).letra || null;
    if (acertou === true && correta && !marcada) marcada = correta;
    return {
      id:questionId(), cadernoId:currentBookId(), materia:matter(), assunto:topic(), banca:metadataLink('bancas'), concurso:metadataLink('concursos'),
      enunciado:statement(), alternativas:alts.map(a=>({ letra:a.letra, texto:a.texto, correta:!!a.correct, marcadaPorMim:a.letra===marcada })),
      marcada, correta, acertou, url:location.href
    };
  }

  function envelope(type,payload,messageId) {
    return { source:EXT_SOURCE, protocol:1, extensionVersion:VERSION, type, messageId:messageId||`${type}_${uid()}`, createdAtMs:Date.now(), payload:payload||{} };
  }
  function sendStatus(env) {
    if (!port) return false;
    try { port.postMessage({ envelope:env }); return true; } catch (_) { return false; }
  }
  function stageKey(messageId) { return STAGE_PREFIX + String(messageId || ''); }
  async function stageEnvelope(env) { if (!env || !env.messageId) return false; await chrome.storage.local.set({ [stageKey(env.messageId)]:env }); return true; }
  async function unstageEnvelope(messageId) { if (messageId) await chrome.storage.local.remove(stageKey(messageId)); }
  async function deliverEnvelope(env,alreadyStaged=false) {
    if (!env || !env.messageId) return false;
    try {
      if (!alreadyStaged) await stageEnvelope(env);
      const response = await chrome.runtime.sendMessage({ kind:'capture', envelope:env });
      if (response && response.accepted) { await unstageEnvelope(env.messageId); return true; }
      return false;
    } catch (_) { return false; }
  }
  async function replayStaged() {
    if (replaying) return; replaying = true;
    try {
      const all = await chrome.storage.local.get(null);
      const rows = Object.entries(all).filter(([k,v])=>k.startsWith(STAGE_PREFIX)&&v&&v.messageId).map(([,v])=>v)
        .sort((a,b)=>Number(a.createdAtMs||0)-Number(b.createdAtMs||0)).slice(0,MAX_STAGE_REPLAY);
      for (const env of rows) { const ok = await deliverEnvelope(env,true); if (!ok) break; }
    } catch (_) {} finally { replaying = false; }
  }

  function markCapture(status, questionIdValue=null, reason=null) {
    lastCapture = { status, questionId:questionIdValue ? String(questionIdValue) : null, at:new Date().toISOString(), reason:reason || null };
  }

  function sendReady(type='ready') {
    const qid = questionId();
    sendStatus(envelope(type, {
      tecAccount:accountFingerprint(), bookId:currentBookId(), url:location.href, capturedAt:new Date().toISOString(), localDate:localDate(), version:VERSION,
      embedded:window.top!==window.self,
      capture:{
        questionId:qid,
        resolverVisible:[...document.querySelectorAll('button,a,[role="button"]')].some(el=>visible(el)&&/Resolver\s+quest[aã]o|Responder|Confirmar\s+resposta/i.test(text(el))),
        mainWorldContext:!!(pageContext && pageContext.id),
        portConnected:!!port,
        visibility:document.visibilityState,
        lifecycle,
        last:lastCapture
      }
    }));
    requestPageContext(); replayStaged();
  }

  function scheduleReconnect(delay=reconnectMs) {
    if (reconnectTimer || port) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }

  function connect() {
    if (port) return;
    try { port = chrome.runtime.connect({ name:'snm-tec-v1' }); }
    catch (_) { scheduleReconnect(); reconnectMs = Math.min(10000,reconnectMs*2); return; }
    reconnectMs = 500;
    port.onDisconnect.addListener(() => {
      const ignored = chrome.runtime.lastError; void ignored;
      port = null;
      lifecycle = { type:'port-disconnect', at:new Date().toISOString(), persisted:false };
      scheduleReconnect();
      reconnectMs = Math.min(10000,reconnectMs*2);
    });
    lifecycle = { type:'port-connect', at:new Date().toISOString(), persisted:false };
    sendReady('ready');
  }

  async function processPending(token) {
    if (processing || !pending || pending.token !== token) return;
    processing = true; const tx = { ...pending };
    try {
      requestPageContext();
      for (let i=0;i<100;i++) {
        if (!pending || pending.token !== token) return;
        const liveId = questionId();
        if (!tx.qid && liveId) { tx.qid=String(liveId); pending.qid=tx.qid; }
        if (liveId && tx.qid && String(liveId)!==String(tx.qid)) {
          pending=null; markCapture('aborted',tx.qid,'question_changed'); sendReady('status'); return;
        }
        const r = result(tx.selectedBefore);
        if (!r) { await sleep(75); continue; }
        const q = buildQuestion(r.acertou,tx.selectedBefore);
        if (!q.id) { requestPageContext(); await sleep(75); continue; }
        const now = new Date();
        const fp = [accountFingerprint(),currentBookId(),q.id,r.acertou,q.marcada||'',q.correta||''].join('|');
        if (fp===lastFingerprint && Date.now()-lastFingerprintAt<3500) {
          pending=null; markCapture('deduplicated',q.id,null); sendReady('status'); return;
        }
        lastFingerprint=fp; lastFingerprintAt=Date.now();
        const eventId='res_'+uid();
        const resolution={
          eventId, questionId:String(q.id), tecAccount:accountFingerprint(), bookId:currentBookId(), resolvedAt:now.toISOString(), localDate:localDate(now),
          timezoneOffsetMinutes:now.getTimezoneOffset(), acertou:!!r.acertou, marcada:q.marcada||null, correta:q.correta||null,
          materia:q.materia||'', assunto:q.assunto||'', banca:q.banca||'', concurso:q.concurso||'', source:'companion-live'
        };
        const env=envelope('resolution',{ resolution, question:q, tecAccount:resolution.tecAccount, bookId:resolution.bookId, capturedAt:resolution.resolvedAt },eventId);
        const accepted=await deliverEnvelope(env);
        markCapture(accepted?'queued':'staged',q.id,accepted?null:'awaiting_worker'); sendReady('status'); pending=null; return;
      }
      markCapture('missed',tx.qid||null,tx.qid?'result_not_detected':'question_id_not_detected'); sendReady('status'); pending=null;
    } finally { processing=false; }
  }

  function resolverButton(target) {
    const b=target&&target.closest?target.closest('button,a,[role="button"]'):null;
    if (!b) return null;
    return /^(?:Resolver\s+quest[aã]o|Responder|Confirmar\s+resposta)(?:\s|$)/i.test(text(b)) ? b : null;
  }

  document.addEventListener('click',(event)=>{
    if (!resolverButton(event.target)) return;
    pageContext=null; requestPageContext();
    const qid=questionId(); const selected=(alternatives().find(a=>a.selected)||{}).letra||null;
    pending={ token:uid(), qid:qid?String(qid):null, selectedBefore:selected, startedAt:Date.now() };
    markCapture('waiting-result',qid||null,null); sendReady('status');
    setTimeout(()=>processPending(pending&&pending.token),80);
  },true);

  let mutationTimer=null;
  function installObserver() {
    if (!document.body) return;
    new MutationObserver(()=>{
      if (!pending || processing) return;
      clearTimeout(mutationTimer); mutationTimer=setTimeout(()=>processPending(pending&&pending.token),45);
    }).observe(document.body,{ childList:true, subtree:true, attributes:true, attributeFilter:['class','aria-checked','aria-pressed'] });
  }

  window.addEventListener('pagehide',(event)=>{
    lifecycle={ type:'pagehide', at:new Date().toISOString(), persisted:!!event.persisted };
  });
  window.addEventListener('pageshow',(event)=>{
    lifecycle={ type:'pageshow', at:new Date().toISOString(), persisted:!!event.persisted };
    requestPageContext(); replayStaged();
    if (!port) connect();
    setTimeout(()=>sendReady('status'),50);
  });
  document.addEventListener('visibilitychange',()=>{
    lifecycle={ type:'visibilitychange', at:new Date().toISOString(), persisted:false, visibility:document.visibilityState };
    if (document.visibilityState==='visible') { if (!port) connect(); setTimeout(()=>sendReady('status'),50); }
  });

  connect(); requestPageContext(); replayStaged();
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',installObserver,{once:true}); else installObserver();
  setInterval(()=>sendReady('status'),15000);
})();
