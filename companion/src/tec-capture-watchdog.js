/* StudyNoMentor Companion — watchdog de captura TEC.
 *
 * Rede de segurança para o caso em que o TEC conclui a questão sem o evento de
 * clique/change chegar ao capturador principal. O watchdog NÃO dispara só por
 * haver uma resposta antiga aberta: ele observa a transição sem resultado ->
 * resultado, dá uma janela para o capturador principal trabalhar e só então
 * persiste a resolução se o status principal continuar sem capturá-la.
 */
'use strict';

(() => {
  if (window.__snmTecCaptureWatchdog) return;
  window.__snmTecCaptureWatchdog = true;

  const EXT_SOURCE = 'StudyMentorCompanion';
  const PAGE_SOURCE = 'StudyMentorTecPage';
  const VERSION = chrome.runtime.getManifest().version;
  const STAGE_PREFIX = 'snmTecStageV1:';
  const STATUS_KEY = 'snmTecStatusV1';
  const GRACE_MS = 900;
  const WAITING_GRACE_MS = 3200;

  let pageContext = null;
  let candidate = null;
  let acceptedSig = '';
  let timer = null;
  let statusPort = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text = el => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = el => {
    try { return !!(el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')); }
    catch (_) { return !!el; }
  };
  const uid = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const escRx = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function fnv(str) {
    let h = 2166136261;
    for (let i=0;i<str.length;i++) { h ^= str.charCodeAt(i); h = Math.imul(h,16777619); }
    return (h>>>0).toString(36);
  }
  function localDate(d=new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function bookId() {
    const m=location.pathname.match(/\/questoes\/cadernos\/(\d+)/i); return m?m[1]:'';
  }
  function accountFingerprint() {
    const ids=[];
    try {
      for (let i=0;i<localStorage.length;i++) {
        const k=localStorage.key(i)||'';
        if (!/(usuario|user|account|conta|perfil|profile)/i.test(k)) continue;
        const v=String(localStorage.getItem(k)||'').slice(0,3000);
        const re=/"(?:idUsuario|usuarioId|userId|id_user|id)"\s*:\s*"?([A-Za-z0-9_-]{2,80})/gi;
        let m,n=0; while ((m=re.exec(v)) && n++<3) ids.push(`${k}:${m[1]}`);
      }
    } catch (_) {}
    const labels=[];
    for (const sel of ['[class*="usuario" i]','[class*="perfil" i]','[class*="profile" i]','a[href*="logout" i]','button[aria-label*="perfil" i]']) {
      for (const el of [...document.querySelectorAll(sel)].slice(0,5)) {
        const t=text(el); if (visible(el) && t && t.length<120) labels.push(t);
      }
    }
    const seed=[...new Set(ids)].sort().join('|') || [...new Set(labels)].sort().join('|') || 'tec-session';
    return 'tec_'+fnv(seed);
  }

  window.addEventListener('message',event=>{
    if (event.source!==window || event.origin!==location.origin) return;
    const msg=event.data;
    if (!msg || msg.source!==PAGE_SOURCE || msg.type!=='question-context') return;
    const raw=msg.context||msg.payload||{};
    const id=String(raw.id||raw.questionId||'').match(/\d{4,}/)?.[0]||null;
    pageContext={
      id, materia:String(raw.materia||''), assunto:String(raw.assunto||''), banca:String(raw.banca||''), concurso:String(raw.concurso||''),
      enunciado:String(raw.enunciado||''), alternativas:Array.isArray(raw.alternativas)?raw.alternativas.slice(0,8):[], capturedAtMs:Number(raw.capturedAtMs||Date.now())
    };
  });

  function questionId() {
    for (const el of document.querySelectorAll('[data-question-id],[data-questao-id],[data-id-questao],[data-idquestao]')) {
      for (const a of ['data-question-id','data-questao-id','data-id-questao','data-idquestao']) {
        const v=el.getAttribute(a); if (v && /^\d+$/.test(v)) return v;
      }
    }
    if (pageContext && Date.now()-Number(pageContext.capturedAtMs||0)<60000 && pageContext.id) return pageContext.id;
    for (const el of [...document.querySelectorAll('a[href],a[aria-label],button[aria-label],h1,h2,h3,h4,strong,[class*="quest" i],[id*="quest" i]')].slice(0,1000)) {
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
  function matter() { return text(firstVisible(['a[ng-href*="/materias/"]','a[href*="/materias/"]','[data-eq-slot="materia"]','[class*="materia" i]'])) || String(pageContext?.materia||''); }
  function topic() { return text(firstVisible(['span[ng-bind*="Assunto"]','span[ng-bind="vm.nomeAssuntoExibicao()"]','[data-eq-slot="assunto"]','[class*="assunto" i]'])) || String(pageContext?.assunto||''); }
  function metadata(kind) {
    const live=text(firstVisible([`a[href*="/${kind}/"]`])); if (live) return live;
    return kind==='bancas'?String(pageContext?.banca||''):kind==='concursos'?String(pageContext?.concurso||''):'';
  }
  function statement() {
    const live=text(firstVisible(['[data-eq-slot="enunciado"]','[data-testid*="enunciado" i]','[class*="enunciado" i]','[id*="enunciado" i]','[class*="statement" i]']));
    return live.length>=10?live:String(pageContext?.enunciado||'');
  }

  function letter(el) {
    if (!el) return null;
    const direct=el.getAttribute?.('data-letter')||el.getAttribute?.('data-letra')||el.getAttribute?.('value');
    if (direct && /^[A-E]$/i.test(String(direct).trim())) return String(direct).trim().toUpperCase();
    const m=text(el).match(/^\s*([A-E])(?:\s*[\)\.\-:]|\s{1,})/i); return m?m[1].toUpperCase():null;
  }
  function selected(el) {
    if (!el) return false;
    if (el.matches?.('input:checked') || el.querySelector?.('input:checked')) return true;
    if (String(el.getAttribute?.('aria-checked')).toLowerCase()==='true' || String(el.getAttribute?.('aria-pressed')).toLowerCase()==='true') return true;
    return /(?:^|\s)(?:selected|selecionad[ao]|marcad[ao]|checked|active)(?:\s|$)/i.test(String(el.className||''));
  }
  function correct(el) {
    const s=String(el?.className||'')+' '+String(el?.getAttribute?.('aria-label')||'');
    return /(?:wk7j7j|corret[ao]|correct|success|certa)(?:\s|$|_|-)/i.test(s) || !!el?.querySelector?.('.glyphicon-ok-sign,.fa-check,[class*="correct" i],[class*="corret" i]');
  }
  function wrong(el) {
    const s=String(el?.className||'');
    return /(?:bz2gcz|incorrect|errad[ao]|danger|wrong)(?:\s|$|_|-)/i.test(s) || !!el?.querySelector?.('.glyphicon-remove,.fa-times,[class*="incorrect" i],[class*="errad" i]');
  }
  function alternatives() {
    const map=new Map();
    const nodes=[...document.querySelectorAll('label,button,[role="radio"],li,[data-letter],[data-letra],.wk7j7j,.bz2gcz')].slice(0,1200);
    for (const node of nodes) {
      if (!visible(node)) continue;
      const l=letter(node); if (!l || map.has(l)) continue;
      const raw=text(node); if (raw.length<2 || raw.length>2500) continue;
      const txt=raw.replace(new RegExp('^\\s*'+escRx(l)+'\\s*(?:[\\)\\.\\-:]|\\s+)\\s*','i'),'').trim();
      map.set(l,{letra:l,texto:txt,selected:selected(node),correct:correct(node),wrong:wrong(node)});
    }
    const dom=[...map.values()].sort((a,b)=>a.letra.localeCompare(b.letra)).slice(0,5);
    if (dom.length>=2) return dom;
    const ctx=Array.isArray(pageContext?.alternativas)?pageContext.alternativas:[];
    return ctx.map((a,i)=>({
      letra:String(a.letra||a.label||String.fromCharCode(65+i)).toUpperCase().match(/[A-E]/)?.[0]||null,
      texto:String(a.texto||a.text||a.descricao||''),selected:!!(a.selected||a.marcada),correct:!!(a.correct||a.correta),wrong:!!(a.wrong||a.errada)
    })).filter(a=>a.letra).slice(0,5);
  }

  function resultState() {
    let acertou=null;
    for (const el of [...document.querySelectorAll('.jm44ow,[class*="resultado" i],[class*="feedback" i],[role="alert"]')].filter(visible).slice(0,120)) {
      const t=text(el).toLowerCase();
      if (el.querySelector('.glyphicon-ok-sign') || /você acertou|voce acertou|resposta correta|parabéns.*acert/i.test(t)) { acertou=true; break; }
      if (el.querySelector('.glyphicon-remove') || /você errou|voce errou|resposta incorreta|resposta errada/i.test(t)) { acertou=false; break; }
    }
    const alts=alternatives();
    const certo=alts.find(a=>a.correct), errado=alts.find(a=>a.wrong), marcado=alts.find(a=>a.selected);
    if (acertou==null && errado && certo) acertou=false;
    if (acertou==null && certo && marcado) acertou=String(certo.letra)===String(marcado.letra);
    if (typeof acertou!=='boolean') return null;
    const marcada=(marcado&&marcado.letra) || (!acertou&&errado&&errado.letra) || (acertou&&certo&&certo.letra) || null;
    return {acertou,marcada,correta:certo?.letra||null,alternativas:alts};
  }

  function signature(r,qid) { return [qid||'',r?.acertou?'1':'0',r?.marcada||'',r?.correta||''].join('|'); }
  function envelope(type,payload,messageId) {
    return {source:EXT_SOURCE,protocol:1,extensionVersion:VERSION,type,messageId:messageId||`${type}_${uid()}`,createdAtMs:Date.now(),payload:payload||{}};
  }
  async function mainCaptureStatus() {
    try {
      const obj=await chrome.storage.local.get(STATUS_KEY), env=obj&&obj[STATUS_KEY];
      return env&&env.payload&&env.payload.capture&&env.payload.capture.last ? env.payload.capture.last : null;
    } catch (_) { return null; }
  }
  function recentStatusFor(last,qid,statuses,ms) {
    if (!last || !statuses.includes(String(last.status||''))) return false;
    if (qid && last.questionId && String(last.questionId)!==String(qid)) return false;
    const t=new Date(last.at||0).getTime(); return Number.isFinite(t) && Date.now()-t<=ms;
  }
  async function stageAndDeliver(env) {
    const key=STAGE_PREFIX+String(env.messageId);
    try {
      await chrome.storage.local.set({[key]:env});
      const response=await chrome.runtime.sendMessage({kind:'capture',envelope:env});
      if (response&&response.accepted) { await chrome.storage.local.remove(key); return true; }
      return false;
    } catch (_) { return false; }
  }
  function ensureStatusPort() {
    if (statusPort) return statusPort;
    try {
      statusPort=chrome.runtime.connect({name:'snm-tec-v1'});
      statusPort.onDisconnect.addListener(()=>{ const ignored=chrome.runtime.lastError; void ignored; statusPort=null; });
    } catch (_) { statusPort=null; }
    return statusPort;
  }
  function reportStatus(status,qid,reason) {
    const p=ensureStatusPort(); if (!p) return;
    try {
      p.postMessage({envelope:envelope('status',{
        tecAccount:accountFingerprint(),bookId:bookId(),url:location.href,capturedAt:new Date().toISOString(),localDate:localDate(),version:VERSION,embedded:window.top!==window.self,
        capture:{questionId:qid||null,resolverVisible:true,mainWorldContext:!!pageContext?.id,portConnected:true,visibility:document.visibilityState,lifecycle:{type:'watchdog',at:new Date().toISOString(),persisted:false},last:{status,questionId:qid||null,at:new Date().toISOString(),reason:reason||null}}
      })});
    } catch (_) {}
  }

  async function fallbackCapture(r,qid,sig) {
    const last=await mainCaptureStatus();
    if (recentStatusFor(last,qid,['queued','staged','deduplicated'],6000)) { acceptedSig=sig; candidate=null; return; }
    if (recentStatusFor(last,qid,['waiting-result'],WAITING_GRACE_MS)) {
      if (candidate && Date.now()-candidate.since<WAITING_GRACE_MS) { scheduleCheck(650); return; }
    }

    const now=new Date(), eventId='res_'+uid(), alts=r.alternativas||[];
    const q={
      id:String(qid),cadernoId:bookId(),materia:matter(),assunto:topic(),banca:metadata('bancas'),concurso:metadata('concursos'),enunciado:statement(),
      alternativas:alts.map(a=>({letra:a.letra,texto:a.texto,correta:!!a.correct,marcadaPorMim:a.letra===r.marcada})),
      marcada:r.marcada||null,correta:r.correta||null,acertou:!!r.acertou,url:location.href
    };
    const resolution={
      eventId,questionId:String(qid),tecAccount:accountFingerprint(),bookId:bookId(),resolvedAt:now.toISOString(),localDate:localDate(now),timezoneOffsetMinutes:now.getTimezoneOffset(),
      acertou:!!r.acertou,marcada:r.marcada||null,correta:r.correta||null,materia:q.materia,assunto:q.assunto,banca:q.banca,concurso:q.concurso,source:'companion-watchdog'
    };
    reportStatus('waiting-result',qid,'fallback-result-transition');
    const ok=await stageAndDeliver(envelope('resolution',{resolution,question:q,tecAccount:resolution.tecAccount,bookId:resolution.bookId,capturedAt:resolution.resolvedAt},eventId));
    if (ok) acceptedSig=sig;
    reportStatus(ok?'queued':'staged',qid,ok?'fallback-captured':'awaiting_worker');
    candidate=null;
  }

  function scheduleCheck(delay=GRACE_MS) {
    clearTimeout(timer); timer=setTimeout(checkTransition,delay);
  }
  async function checkTransition() {
    if (document.visibilityState==='hidden') return;
    const qid=questionId(), r=resultState();
    if (!qid || !r) { candidate=null; acceptedSig=''; return; }
    const sig=signature(r,qid);
    if (sig===acceptedSig) return;
    if (!candidate || candidate.sig!==sig) { candidate={sig,since:Date.now(),qid:String(qid),result:r}; scheduleCheck(GRACE_MS); return; }
    if (Date.now()-candidate.since<GRACE_MS) { scheduleCheck(GRACE_MS-(Date.now()-candidate.since)); return; }
    await fallbackCapture(candidate.result,candidate.qid,candidate.sig);
  }

  function baseline() {
    const qid=questionId(), r=resultState();
    acceptedSig=(qid&&r)?signature(r,qid):''; // resposta já aberta não é evento novo
  }
  function start() {
    baseline();
    const root=document.body||document.documentElement; if (!root) return;
    let moTimer=null;
    new MutationObserver(()=>{
      clearTimeout(moTimer); moTimer=setTimeout(()=>checkTransition(),100);
    }).observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-checked','aria-pressed','disabled']});
    document.addEventListener('click',()=>scheduleCheck(180),true);
    document.addEventListener('change',()=>scheduleCheck(180),true);
    document.addEventListener('submit',()=>scheduleCheck(180),true);
    setInterval(()=>checkTransition(),1500);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
