/* StudyNoMentor Companion — captura TEC factual v2.
 *
 * Fonte de verdade da resolução:
 *   1. resposta efetivamente marcada pelo aluno;
 *   2. gabarito efetivamente exibido pelo TEC;
 *   3. resultado = comparação entre ambos.
 *
 * Banners como "Resposta correta: C" NUNCA significam "você acertou".
 * Também é proibido sintetizar a resposta marcada a partir do gabarito.
 *
 * Entrega: seleção -> evidência -> snapshot -> staging local -> worker -> ACK Study.
 */
'use strict';

(() => {
  if (window.__snmTecCompanionV2) return;
  window.__snmTecCompanionV2 = true;

  /* Impede a execução dos capturadores legados carregados depois deste arquivo.
     Eles permanecem no pacote apenas por compatibilidade de transição/testes. */
  window.__snmTecCompanion = true;
  window.__snmTecCaptureWatchdog = true;

  const EXT_SOURCE = 'StudyMentorCompanion';
  const PAGE_SOURCE = 'StudyMentorTecPage';
  const PAGE_REQUEST_SOURCE = 'StudyMentorCompanionIsolated';
  const VERSION = chrome.runtime.getManifest().version;
  const ENGINE_VERSION = '2.0.0';
  const STAGE_PREFIX = 'snmTecStageV2:';
  const SESSION_ACCOUNT_KEY = 'snmTecUnknownAccountV2';
  const MAX_STAGE_REPLAY = 1000;
  const RESULT_WAIT_MS = 9000;
  const RESULT_POLL_MS = 180;
  const DEDUP_MS = 6000;
  const CONTEXT_FRESH_MS = 45000;
  const ACTION_RX = /Resolver\s+quest[aã]o|Responder|Confirmar\s+resposta|Enviar\s+resposta|Corrigir|Ver\s+resposta|Finalizar|Desempenho\s+na\s+quest[aã]o/i;

  let port = null;
  let reconnectMs = 500;
  let reconnectTimer = null;
  let pageContext = null;
  let pendingCapture = null;
  let replaying = false;
  let processing = false;
  let observerTimer = null;
  let heartbeatTimer = null;
  let lifecycle = { type:'load', at:new Date().toISOString(), persisted:false };
  let lastCapture = { status:'idle', questionId:null, at:null, reason:null };
  let lastAccepted = { signature:'', at:0 };
  const selectedByQuestion = new Map();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text = el => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = el => {
    try { return !!(el && el.isConnected !== false && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')); }
    catch (_) { return !!el; }
  };
  const uid = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const escRx = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const letter = value => {
    const m=String(value == null ? '' : value).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);
    return m ? m[1] : null;
  };

  function fnv(str) {
    let h = 2166136261;
    for (let i=0;i<String(str||'').length;i++) { h ^= String(str)[i].charCodeAt(0); h = Math.imul(h,16777619); }
    return (h >>> 0).toString(36);
  }

  function localDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function currentBookId() {
    const m=location.pathname.match(/\/questoes\/cadernos\/(\d+)/i);
    return m ? m[1] : '';
  }

  function accountIdentity() {
    const ids=[];
    try {
      for (let i=0;i<localStorage.length;i++) {
        const k=localStorage.key(i)||'';
        if (!/(usuario|user|account|conta|perfil|profile)/i.test(k)) continue;
        const v=String(localStorage.getItem(k)||'').slice(0,4000);
        const re=/"(?:idUsuario|usuarioId|userId|id_user|id)"\s*:\s*"?([A-Za-z0-9_-]{2,96})/gi;
        let m, count=0;
        while ((m=re.exec(v)) && count++<4) ids.push(`${k}:${m[1]}`);
      }
    } catch (_) {}
    const strong=[...new Set(ids)].sort();
    if (strong.length) return { id:'tec_'+fnv(strong.join('|')), confidence:'strong', source:'storage-id' };

    const labels=[];
    for (const sel of ['[class*="usuario" i]','[class*="perfil" i]','[class*="profile" i]','a[href*="logout" i]','button[aria-label*="perfil" i]']) {
      for (const el of [...document.querySelectorAll(sel)].slice(0,6)) {
        const t=text(el); if (visible(el) && t && t.length<120) labels.push(t);
      }
    }
    const weak=[...new Set(labels)].sort();
    if (weak.length) return { id:'tec_'+fnv(weak.join('|')), confidence:'heuristic', source:'visible-label' };

    let sid='';
    try {
      sid=sessionStorage.getItem(SESSION_ACCOUNT_KEY)||'';
      if (!sid) { sid='unknown_'+uid(); sessionStorage.setItem(SESSION_ACCOUNT_KEY,sid); }
    } catch (_) { sid='unknown_'+uid(); }
    return { id:'tec_'+fnv(sid), confidence:'unknown', source:'session-random' };
  }

  function requestPageContext() {
    try { window.postMessage({ source:PAGE_REQUEST_SOURCE, type:'context-request', at:Date.now() }, location.origin); } catch (_) {}
  }

  function acceptPageContext(raw) {
    if (!raw || typeof raw!=='object') return;
    const id=String(raw.id||raw.questionId||'').match(/\d{4,}/)?.[0]||null;
    pageContext={
      id,
      materia:String(raw.materia||''), assunto:String(raw.assunto||''), banca:String(raw.banca||''), concurso:String(raw.concurso||''),
      enunciado:String(raw.enunciado||''), alternativas:Array.isArray(raw.alternativas)?raw.alternativas.slice(0,8):[],
      source:String(raw.source||'main-world'), capturedAtMs:Number(raw.capturedAtMs||Date.now()), href:String(raw.href||location.href)
    };
    const selected=(pageContext.alternativas||[]).find(a=>a && (a.selected===true || a.marcada===true || a.marcadaPorMim===true));
    if (id && selected) {
      const l=letter(selected.letra||selected.label||selected.alternativa);
      if (l) selectedByQuestion.set(id,{ letter:l, at:Date.now(), source:'main-world-selection' });
    }
  }

  window.addEventListener('message', event => {
    if (event.source!==window || event.origin!==location.origin) return;
    const msg=event.data;
    if (!msg || msg.source!==PAGE_SOURCE || msg.type!=='question-context') return;
    acceptPageContext(msg.context||msg.payload||{});
  });

  function pageQuestionId() {
    if (!pageContext || Date.now()-Number(pageContext.capturedAtMs||0)>CONTEXT_FRESH_MS) return null;
    return pageContext.id||null;
  }

  function questionId() {
    /* O contexto estruturado da questão atual vence o DOM residual da SPA. */
    const fromPage=pageQuestionId();
    if (fromPage) return fromPage;
    for (const el of document.querySelectorAll('[data-question-id],[data-questao-id],[data-id-questao],[data-idquestao]')) {
      if (!visible(el)) continue;
      for (const a of ['data-question-id','data-questao-id','data-id-questao','data-idquestao']) {
        const v=el.getAttribute(a); if (v && /^\d+$/.test(v)) return v;
      }
    }
    for (const el of [...document.querySelectorAll('a[href],a[aria-label],button[aria-label],h1,h2,h3,h4,strong,[class*="quest" i],[id*="quest" i]')].slice(0,1200)) {
      if (!visible(el)) continue;
      const hay=[el.getAttribute?.('href'),el.getAttribute?.('aria-label'),text(el)].join(' ');
      const m=hay.match(/(?:\/questoes\/|quest[aã]o\s*#?\s*|#|\bID\s*[:#]?\s*)(\d{4,})/i);
      if (m) return m[1];
    }
    return null;
  }

  function firstVisible(selectors) {
    for (const sel of selectors) for (const el of document.querySelectorAll(sel)) if (visible(el) && text(el)) return el;
    return null;
  }

  function matter() { return String(pageContext&&pageContext.materia||'') || text(firstVisible(['a[ng-href*="/materias/"]','a[href*="/materias/"]','[data-eq-slot="materia"]','[class*="materia" i]'])); }
  function topic() { return String(pageContext&&pageContext.assunto||'') || text(firstVisible(['span[ng-bind*="Assunto"]','span[ng-bind="vm.nomeAssuntoExibicao()"]','[data-eq-slot="assunto"]','[class*="assunto" i]'])); }
  function metadata(kind) {
    const fromContext=kind==='bancas'?String(pageContext&&pageContext.banca||''):String(pageContext&&pageContext.concurso||'');
    if (fromContext) return fromContext;
    return text(firstVisible([`a[href*="/${kind}/"]`]));
  }
  function statement() {
    const fromContext=String(pageContext&&pageContext.enunciado||'').trim();
    if (fromContext.length>=10) return fromContext;
    const live=text(firstVisible(['[data-eq-slot="enunciado"]','[data-testid*="enunciado" i]','[class*="enunciado" i]','[id*="enunciado" i]','[class*="statement" i]']));
    return live.length>=10?live:'';
  }

  function nodeLetter(el) {
    if (!el) return null;
    const direct=el.getAttribute?.('data-letter')||el.getAttribute?.('data-letra')||el.getAttribute?.('value');
    if (direct && /^[A-E]$/i.test(String(direct).trim())) return String(direct).trim().toUpperCase();
    const m=text(el).match(/^\s*([A-E])(?:\s*[\)\.\-:]|\s{1,})/i);
    return m?m[1].toUpperCase():null;
  }
  function nodeSelected(el) {
    if (!el) return false;
    if (el.matches?.('input:checked') || el.querySelector?.('input:checked')) return true;
    if (String(el.getAttribute?.('aria-checked')).toLowerCase()==='true' || String(el.getAttribute?.('aria-pressed')).toLowerCase()==='true') return true;
    return /(?:^|\s)(?:selected|selecionad[ao]|marcad[ao]|checked|active)(?:\s|$)/i.test(String(el.className||''));
  }
  function nodeCorrect(el) {
    const s=String(el&&el.className||'')+' '+String(el&&el.getAttribute?.('aria-label')||'');
    return /(?:wk7j7j|corret[ao]|correct|success|certa)(?:\s|$|_|-)/i.test(s) || !!el?.querySelector?.('.glyphicon-ok-sign,.fa-check,[class*="correct" i],[class*="corret" i]');
  }
  function nodeWrong(el) {
    const s=String(el&&el.className||'');
    return /(?:bz2gcz|incorrect|errad[ao]|danger|wrong)(?:\s|$|_|-)/i.test(s) || !!el?.querySelector?.('.glyphicon-remove,.fa-times,[class*="incorrect" i],[class*="errad" i]');
  }

  function alternatives() {
    const by=new Map();
    const add=(a,source)=>{
      if (!a) return;
      const l=letter(a.letra||a.label||a.alternativa||a.value); if (!l) return;
      const old=by.get(l)||{letra:l,texto:'',selected:false,correct:false,wrong:false,sources:[]};
      const t=String(a.texto||a.text||a.descricao||'').trim();
      if (t && !old.texto) old.texto=t;
      old.selected=old.selected || a.selected===true || a.marcada===true || a.marcadaPorMim===true;
      old.correct=old.correct || a.correct===true || a.correta===true;
      old.wrong=old.wrong || a.wrong===true || a.errada===true;
      if (source && !old.sources.includes(source)) old.sources.push(source);
      by.set(l,old);
    };
    for (const a of pageContext&&Array.isArray(pageContext.alternativas)?pageContext.alternativas:[]) add(a,'main-world');
    const nodes=[...document.querySelectorAll('label,button,[role="radio"],li,[data-letter],[data-letra],.wk7j7j,.bz2gcz')].slice(0,1400);
    for (const node of nodes) {
      if (!visible(node)) continue;
      const l=nodeLetter(node); if (!l) continue;
      const raw=text(node); if (raw.length<2 || raw.length>2500) continue;
      add({letra:l,texto:raw.replace(new RegExp('^\\s*'+escRx(l)+'\\s*(?:[\\)\\.\\-:]|\\s+)\\s*','i'),'').trim(),selected:nodeSelected(node),correct:nodeCorrect(node),wrong:nodeWrong(node)},'dom');
    }
    return [...by.values()].sort((a,b)=>a.letra.localeCompare(b.letra)).slice(0,8);
  }

  function bannerEvidence() {
    const nodes=[...document.querySelectorAll('.jm44ow,[class*="resultado" i],[class*="feedback" i],[role="alert"],[class*="gabarito" i]')].filter(visible).slice(0,160);
    let explicitResult=null, correct=null, marked=null, raw='';
    for (const el of nodes) {
      const t=text(el); if (!t) continue;
      const low=t.toLowerCase(); raw+=(raw?' | ':'')+t.slice(0,400);
      if (/você\s+errou|voce\s+errou|resposta\s+(?:incorreta|errada)|sua\s+resposta\s+está\s+errada/i.test(low)) explicitResult=false;
      else if (/você\s+acertou|voce\s+acertou|parab[eé]ns[^.]{0,80}acert/i.test(low)) explicitResult=true;
      const cm=t.match(/(?:gabarito|resposta\s+correta|alternativa\s+correta)\s*(?:é|:|\-|=)?\s*\(?\s*([A-E])\b/i);
      if (cm) correct=cm[1].toUpperCase();
      const mm=t.match(/(?:sua\s+resposta|resposta\s+marcada|voc[eê]\s+marcou)\s*(?:foi|:|\-|=)?\s*\(?\s*([A-E])\b/i);
      if (mm) marked=mm[1].toUpperCase();
    }
    return { explicitResult, correct, marked, raw:raw.slice(0,1400) };
  }

  function rememberSelection(target) {
    const control=target&&target.closest?target.closest('label,button,[role="radio"],input[type="radio"],[data-letter],[data-letra],li'):null;
    if (!control) return;
    const l=nodeLetter(control)||nodeLetter(control.closest?.('label,[role="radio"],li'));
    const qid=questionId();
    if (qid && l) selectedByQuestion.set(String(qid),{letter:l,at:Date.now(),source:'user-interaction'});
  }
  document.addEventListener('click',e=>rememberSelection(e.target),true);
  document.addEventListener('change',e=>rememberSelection(e.target),true);

  function evidence(qid) {
    const alts=alternatives(), banner=bannerEvidence();
    const saved=selectedByQuestion.get(String(qid||''));
    const selectedAlt=alts.find(a=>a.selected);
    const wrongAlt=alts.find(a=>a.wrong);
    const correctAlt=alts.find(a=>a.correct);

    /* Resposta marcada exige evidência independente do gabarito. */
    let marked=(saved&&saved.letter)|| (selectedAlt&&selectedAlt.letra) || banner.marked || null;
    if (!marked && wrongAlt && banner.explicitResult===false) marked=wrongAlt.letra;
    const correct=(correctAlt&&correctAlt.letra)||banner.correct||null;

    let result=null, confidence='low', source='insufficient';
    if (marked && correct) {
      result=String(marked)===String(correct); confidence='high'; source='marked-vs-gabarito';
    } else if (typeof banner.explicitResult==='boolean') {
      result=banner.explicitResult; confidence='medium'; source='explicit-result-banner';
    }

    return { qid, alts, banner, marked, correct, result, confidence, source };
  }

  function buildQuestion(ev) {
    const qid=ev.qid;
    return {
      id:qid,
      cadernoId:currentBookId(),
      materia:matter(), assunto:topic(), banca:metadata('bancas'), concurso:metadata('concursos'),
      enunciado:statement(),
      alternativas:(ev.alts||[]).map(a=>({letra:a.letra,texto:a.texto||'',correta:ev.correct?String(a.letra)===String(ev.correct):!!a.correct,marcadaPorMim:ev.marked?String(a.letra)===String(ev.marked):!!a.selected})),
      marcada:ev.marked||null, correta:ev.correct||null,
      acertou:typeof ev.result==='boolean'?ev.result:null,
      url:location.href
    };
  }

  function integrity(ev) {
    return {
      schema:3,
      status:ev.confidence==='high'?'verified':(ev.confidence==='medium'?'observed':'unverified'),
      confidence:ev.confidence,
      source:ev.source,
      marked:ev.marked||null,
      correct:ev.correct||null,
      canonicalResult:typeof ev.result==='boolean'?ev.result:null,
      reportedResult:null,
      conflict:false,
      conflictResolved:false,
      bannerResult:ev.banner&&typeof ev.banner.explicitResult==='boolean'?ev.banner.explicitResult:null,
      bannerCorrect:ev.banner&&ev.banner.correct||null,
      bannerText:ev.banner&&ev.banner.raw||null,
      alternativesCaptured:(ev.alts||[]).length,
      captureEngineVersion:ENGINE_VERSION,
      normalizedAt:new Date().toISOString()
    };
  }

  function envelopeFor(ev,strategy) {
    const account=accountIdentity();
    const question=buildQuestion(ev);
    const integ=integrity(ev);
    question.integrity=integ;
    const eventId=`res_${ev.qid}_${Date.now()}_${uid().slice(-8)}`;
    const now=new Date();
    return {
      source:EXT_SOURCE,
      protocol:1,
      extensionVersion:VERSION,
      type:'resolution',
      messageId:eventId,
      createdAtMs:Date.now(),
      payload:{
        tecAccount:account.id,
        tecAccountConfidence:account.confidence,
        bookId:currentBookId(),
        capturedAt:now.toISOString(),
        transport:'companion-v2',
        provenance:{
          captureEngineVersion:ENGINE_VERSION,
          companionVersion:VERSION,
          captureStrategy:strategy,
          accountConfidence:account.confidence,
          accountSource:account.source,
          pageContextSource:pageContext&&pageContext.source||null,
          pageContextAgeMs:pageContext?Math.max(0,Date.now()-Number(pageContext.capturedAtMs||Date.now())):null
        },
        integrity:integ,
        resolution:{
          eventId, questionId:ev.qid, tecAccount:account.id, bookId:currentBookId(),
          resolvedAt:now.toISOString(), localDate:localDate(now), timezoneOffsetMinutes:now.getTimezoneOffset(),
          acertou:ev.result, marcada:ev.marked||null, correta:ev.correct||null,
          materia:question.materia, assunto:question.assunto, banca:question.banca, concurso:question.concurso,
          source:`companion-${strategy}`, integrity:integ
        },
        question
      }
    };
  }

  function normalizeBeforeStage(env) {
    try {
      const guard=window.__snmTecIntegrity;
      if (guard&&typeof guard.normalizeEnvelope==='function') guard.normalizeEnvelope(env);
    } catch (_) {}
    return env;
  }

  function stageKey(id) { return STAGE_PREFIX+String(id||''); }
  async function stage(env) { normalizeBeforeStage(env); await chrome.storage.local.set({[stageKey(env.messageId)]:env}); }
  async function unstage(id) { if (id) await chrome.storage.local.remove(stageKey(id)); }

  async function deliver(env,alreadyStaged=false) {
    if (!env||!env.messageId) return false;
    try {
      if (!alreadyStaged) await stage(env); else normalizeBeforeStage(env);
      const response=await chrome.runtime.sendMessage({kind:'capture',envelope:env});
      if (response&&response.accepted) { await unstage(env.messageId); return true; }
      markCapture('staged',env.payload&&env.payload.resolution&&env.payload.resolution.questionId,response&&response.reason||'worker_rejected');
      return false;
    } catch (_) { return false; }
  }

  async function replayStaged() {
    if (replaying) return; replaying=true;
    try {
      const all=await chrome.storage.local.get(null);
      const rows=Object.entries(all).filter(([k,v])=>k.startsWith(STAGE_PREFIX)&&v&&v.messageId).map(([,v])=>v)
        .sort((a,b)=>Number(a.createdAtMs||0)-Number(b.createdAtMs||0)).slice(0,MAX_STAGE_REPLAY);
      for (const env of rows) { if (!(await deliver(env,true))) break; }
    } catch (_) {} finally { replaying=false; }
  }

  function signature(ev) { return [ev.qid,ev.result?'1':'0',ev.marked||'',ev.correct||''].join('|'); }
  function dedup(ev) {
    const sig=signature(ev), now=Date.now();
    if (sig===lastAccepted.signature && now-lastAccepted.at<DEDUP_MS) return true;
    lastAccepted={signature:sig,at:now}; return false;
  }

  function markCapture(status,qid=null,reason=null) {
    lastCapture={status,questionId:qid?String(qid):null,at:new Date().toISOString(),reason:reason||null};
  }

  function statusPayload() {
    const account=accountIdentity(), qid=questionId();
    return {
      tecAccount:account.id, tecAccountConfidence:account.confidence, bookId:currentBookId(), url:location.href,
      capturedAt:new Date().toISOString(), localDate:localDate(), version:VERSION, captureEngineVersion:ENGINE_VERSION,
      embedded:window.top!==window.self,
      capture:{questionId:qid,resolverVisible:!!actionControl(),mainWorldContext:!!(pageContext&&pageContext.id),portConnected:!!port,
        visibility:document.visibilityState,lifecycle,last:lastCapture,accountConfidence:account.confidence}
    };
  }

  function makeStatus(type='status') {
    return {source:EXT_SOURCE,protocol:1,extensionVersion:VERSION,type,messageId:`${type}_${Date.now()}`,createdAtMs:Date.now(),payload:statusPayload()};
  }

  function sendStatus(type='status') {
    if (!port) return false;
    try { port.postMessage({envelope:makeStatus(type)}); return true; } catch (_) { return false; }
  }

  function actionControl() {
    const nodes=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"],[ng-click],[data-ng-click]')].filter(visible).slice(0,250);
    return nodes.find(el=>ACTION_RX.test([text(el),el.getAttribute?.('aria-label'),el.getAttribute?.('title'),el.getAttribute?.('ng-click'),el.getAttribute?.('data-ng-click')].join(' ')))||null;
  }

  async function awaitResult(qid,selectedBefore,strategy) {
    if (processing) return false;
    processing=true;
    markCapture('waiting-result',qid,strategy);
    try {
      const start=Date.now();
      while (Date.now()-start<RESULT_WAIT_MS) {
        const live=questionId();
        if (live && qid && String(live)!==String(qid)) { markCapture('aborted',qid,'question_changed'); return false; }
        const ev=evidence(qid);
        if (!ev.marked && selectedBefore) ev.marked=selectedBefore;
        if (ev.marked && ev.correct) { ev.result=String(ev.marked)===String(ev.correct); ev.confidence='high'; ev.source='marked-vs-gabarito'; }
        if (typeof ev.result==='boolean') {
          if (dedup(ev)) { markCapture('deduplicated',qid,'recent_signature'); return true; }
          const env=envelopeFor(ev,strategy);
          const ok=await deliver(env,false);
          if (ok) markCapture('queued',qid,ev.confidence);
          return ok;
        }
        await sleep(RESULT_POLL_MS);
      }
      markCapture('missed',qid,'result_not_detected');
      return false;
    } finally { processing=false; sendStatus('status'); }
  }

  function beginCapture(strategy='action') {
    requestPageContext();
    const qid=questionId();
    if (!qid) { markCapture('missed',null,'question_id_not_detected'); sendStatus('status'); return; }
    const saved=selectedByQuestion.get(String(qid));
    const selected=(saved&&saved.letter)||(alternatives().find(a=>a.selected)||{}).letra||null;
    pendingCapture={qid:String(qid),selectedBefore:selected,startedAt:Date.now(),strategy};
    setTimeout(()=>awaitResult(String(qid),selected,strategy),80);
  }

  document.addEventListener('click',event=>{
    rememberSelection(event.target);
    const control=event.target&&event.target.closest?event.target.closest('button,a,[role="button"],input[type="submit"],[ng-click],[data-ng-click]'):null;
    if (!control) return;
    const hay=[text(control),control.getAttribute?.('aria-label'),control.getAttribute?.('title'),control.getAttribute?.('ng-click'),control.getAttribute?.('data-ng-click')].join(' ');
    if (ACTION_RX.test(hay)) beginCapture('action');
  },true);

  /* Watchdog diferente do gatilho: observa apenas transição para um resultado
     explícito/derivável e reutiliza a seleção já registrada. */
  function watchdogProbe() {
    clearTimeout(observerTimer);
    observerTimer=setTimeout(()=>{
      if (processing) return;
      const qid=questionId(); if (!qid) return;
      const ev=evidence(qid);
      if (typeof ev.result!=='boolean') return;
      const sig=signature(ev);
      if (sig===lastAccepted.signature && Date.now()-lastAccepted.at<DEDUP_MS) return;
      const saved=selectedByQuestion.get(String(qid));
      if (!ev.marked && saved&&saved.letter) ev.marked=saved.letter;
      if (ev.marked&&ev.correct) { ev.result=ev.marked===ev.correct; ev.confidence='high'; ev.source='marked-vs-gabarito'; }
      setTimeout(()=>awaitResult(String(qid),ev.marked||null,'watchdog'),700);
    },160);
  }

  function connect() {
    if (port) return;
    try { port=chrome.runtime.connect({name:'snm-tec-v1'}); }
    catch (_) { scheduleReconnect(); return; }
    reconnectMs=500;
    port.onDisconnect.addListener(()=>{
      const ignored=chrome.runtime.lastError; void ignored;
      port=null; lifecycle={type:'port-disconnect',at:new Date().toISOString(),persisted:false};
      scheduleReconnect();
    });
    lifecycle={type:'port-connect',at:new Date().toISOString(),persisted:false};
    sendStatus('ready');
    replayStaged();
  }

  function scheduleReconnect() {
    if (reconnectTimer||port) return;
    reconnectTimer=setTimeout(()=>{ reconnectTimer=null; connect(); },reconnectMs);
    reconnectMs=Math.min(10000,reconnectMs*2);
  }

  function start() {
    requestPageContext();
    connect();
    replayStaged();
    const observer=new MutationObserver(watchdogProbe);
    if (document.documentElement) observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-checked','aria-pressed']});
    if (!heartbeatTimer) heartbeatTimer=setInterval(()=>{ sendStatus('status'); replayStaged(); },5000);
  }

  window.addEventListener('pageshow',event=>{
    lifecycle={type:'pageshow',at:new Date().toISOString(),persisted:!!event.persisted};
    requestPageContext(); if (!port) connect(); replayStaged();
  });
  window.addEventListener('pagehide',event=>{ lifecycle={type:'pagehide',at:new Date().toISOString(),persisted:!!event.persisted}; });
  document.addEventListener('visibilitychange',()=>{
    lifecycle={type:'visibilitychange',at:new Date().toISOString(),persisted:false,visibility:document.visibilityState};
    if (document.visibilityState==='visible') { requestPageContext(); if (!port) connect(); replayStaged(); }
  });

  window.__snmTecCaptureV2={ evidence, questionId, accountIdentity, beginCapture, replayStaged, engineVersion:ENGINE_VERSION };
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
