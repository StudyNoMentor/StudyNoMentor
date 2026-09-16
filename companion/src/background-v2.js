/* StudyNoMentor Companion — service worker MV3 v2.
 *
 * Contratos:
 *  - cada resolução TEC é vinculada ao usuário/perfil Study que reivindicou a rota;
 *  - ACK só pode apagar evento pertencente ao mesmo usuário/perfil;
 *  - fila TEC é granular (uma chave por evento), não um blob crescente;
 *  - jobs ChatGPT ficam duráveis, canceláveis e são mantidos por alarmes MV3;
 *  - resultados de IA voltam apenas ao Study que criou o job.
 */
'use strict';

const QUEUE_INDEX_KEY = 'snmTecQueueIndexV2';
const QUEUE_ITEM_PREFIX = 'snmTecQueueItemV2:';
const LEGACY_QUEUE_KEY = 'snmTecQueueV1';
const STATUS_KEY = 'snmTecStatusV2';
const ROUTE_KEY = 'snmStudyCaptureRouteV2';
const PLUS_JOBS_KEY = 'snmPlusAiJobsV2';
const PLUS_LEGACY_KEY = 'snmPlusAiJobsV1';
const ALARM_NAME = 'snm-companion-maintenance-v2';
const MAX_PENDING = 50000;
const ROUTE_TTL_MS = 30 * 60 * 1000;
const PLUS_TIMEOUT_MS = 4 * 60 * 1000;
const PLUS_MAX_ATTEMPTS = 3;
const studyPorts = new Map();
let writeChain = Promise.resolve();
let plusKickRunning = false;

const isTec = url => /^https:\/\/(?:www\.)?tecconcursos\.com\.br\//i.test(String(url||''));
const isStudy = url => /^https:\/\/studynomentor\.github\.io\/StudyNoMentor(?:\/|$)/i.test(String(url||''));
const isChatGPT = url => /^https:\/\/chatgpt\.com(?:\/|$)/i.test(String(url||''));
const nowIso = () => new Date().toISOString();
const serialize = task => { writeChain = writeChain.then(task,task); return writeChain; };

async function storageGet(key,fallback) {
  const out=await chrome.storage.local.get(key);
  return out[key]==null?fallback:out[key];
}
function queueItemKey(id) { return QUEUE_ITEM_PREFIX+String(id||''); }
function validEnvelope(env) { return !!(env&&env.source==='StudyMentorCompanion'&&Number(env.protocol)===1&&env.messageId&&env.type); }
function safePost(port,msg) { try { port.postMessage(msg); return true; } catch (_) { return false; } }

function normalizeContext(raw,tabId) {
  if (!raw||typeof raw!=='object') return null;
  const userId=String(raw.userId||'').trim(), profileId=String(raw.profileId||'').trim();
  if (!userId||!profileId) return null;
  return {
    userId, profileId,
    tabId:tabId==null?null:Number(tabId),
    tabSessionId:String(raw.tabSessionId||''),
    deviceId:String(raw.deviceId||''),
    siteBuild:String(raw.siteBuild||''),
    updatedAt:nowIso(), updatedAtMs:Date.now()
  };
}
function sameOwner(a,b) { return !!(a&&b&&String(a.userId)===String(b.userId)&&String(a.profileId)===String(b.profileId)); }

async function routeState() {
  const route=await storageGet(ROUTE_KEY,null);
  if (!route||!route.userId||!route.profileId) return null;
  const age=Date.now()-Number(route.claimedAtMs||0);
  if (!Number.isFinite(age)||age<0||age>ROUTE_TTL_MS) return null;
  return route;
}
async function claimRoute(context,tabId) {
  const ctx=normalizeContext(context,tabId);
  if (!ctx) return null;
  const route={...ctx,claimedAt:nowIso(),claimedAtMs:Date.now(),expiresAtMs:Date.now()+ROUTE_TTL_MS};
  await chrome.storage.local.set({[ROUTE_KEY]:route});
  return route;
}
function contextForPort(port) { return studyPorts.get(port)?.context||null; }
function contextForTab(tabId) {
  for (const meta of studyPorts.values()) if (meta&&meta.tabId!=null&&Number(meta.tabId)===Number(tabId)&&meta.context) return meta.context;
  return null;
}
function matchingPorts(target) {
  const out=[];
  for (const [port,meta] of studyPorts) if (meta&&meta.context&&sameOwner(meta.context,target)) out.push({port,meta});
  return out;
}
async function activePortFor(target) {
  const route=await routeState();
  if (!route||!sameOwner(route,target)) return null;
  const candidates=matchingPorts(target);
  const exact=candidates.find(x=>x.meta.tabId!=null&&Number(x.meta.tabId)===Number(route.tabId));
  return (exact||candidates.sort((a,b)=>Number(b.meta.claimedAtMs||0)-Number(a.meta.claimedAtMs||0))[0]||{}).port||null;
}

async function queueIndex() {
  let idx=await storageGet(QUEUE_INDEX_KEY,null);
  if (idx&&idx.version===2&&Array.isArray(idx.ids)) return idx;

  /* Migração única da fila antiga. Eventos sem destino ficam preservados, mas
     NÃO são entregues automaticamente a outro perfil. */
  const legacy=await storageGet(LEGACY_QUEUE_KEY,null);
  idx={version:2,ids:[],dropped:Number(legacy&&legacy.dropped||0),updatedAt:null,migratedAt:nowIso()};
  if (legacy&&legacy.items&&typeof legacy.items==='object') {
    const writes={};
    for (const [id,env] of Object.entries(legacy.items)) {
      if (!env||!validEnvelope(env)) continue;
      idx.ids.push(String(id));
      writes[queueItemKey(id)]={envelope:env,target:null,legacyUnbound:true,queuedAt:nowIso()};
    }
    if (Object.keys(writes).length) await chrome.storage.local.set(writes);
    await chrome.storage.local.remove(LEGACY_QUEUE_KEY);
  }
  await saveQueueIndex(idx);
  return idx;
}
async function saveQueueIndex(idx) {
  idx.updatedAt=nowIso();
  idx.ids=[...new Set((idx.ids||[]).map(String))].slice(-MAX_PENDING);
  await chrome.storage.local.set({[QUEUE_INDEX_KEY]:idx});
}
async function queueItem(id) { return storageGet(queueItemKey(id),null); }
function healthFrom(idx) {
  return {pending:(idx&&idx.ids||[]).length,dropped:Number(idx&&idx.dropped||0),limit:MAX_PENDING,updatedAt:idx&&idx.updatedAt||null,storage:'granular-v2'};
}
async function broadcastHealth() {
  const idx=await queueIndex(), payload=healthFrom(idx);
  for (const [port] of [...studyPorts]) if (!safePost(port,{kind:'health',payload})) studyPorts.delete(port);
}

async function enqueue(env,target) {
  if (!validEnvelope(env)||!target||!target.userId||!target.profileId) return {ok:false,reason:'invalid'};
  return serialize(async()=>{
    const idx=await queueIndex(), id=String(env.messageId), exists=idx.ids.includes(id);
    if (!exists&&idx.ids.length>=MAX_PENDING) return {ok:false,reason:'queue_full',health:healthFrom(idx)};
    if (!exists) idx.ids.push(id);
    const routed={...env,routing:{schema:2,userId:String(target.userId),profileId:String(target.profileId),tabSessionId:String(target.tabSessionId||''),deviceId:String(target.deviceId||''),siteBuild:String(target.siteBuild||''),claimedAt:target.claimedAt||target.updatedAt||nowIso()}};
    await chrome.storage.local.set({[queueItemKey(id)]:{envelope:routed,target:{userId:target.userId,profileId:target.profileId},legacyUnbound:false,queuedAt:nowIso()}});
    await saveQueueIndex(idx);
    return {ok:true,duplicate:exists,health:healthFrom(idx),envelope:routed};
  });
}
async function ack(messageId,port) {
  if (!messageId||!port) return false;
  return serialize(async()=>{
    const id=String(messageId), item=await queueItem(id), ctx=contextForPort(port);
    if (!item||!ctx||!item.target||!sameOwner(ctx,item.target)) return false;
    const idx=await queueIndex();
    idx.ids=(idx.ids||[]).filter(x=>String(x)!==id);
    await chrome.storage.local.remove(queueItemKey(id));
    await saveQueueIndex(idx);
    setTimeout(()=>broadcastHealth().catch(()=>{}),0);
    return true;
  });
}

async function deliverItem(item) {
  if (!item||!item.envelope||!item.target) return false;
  const port=await activePortFor(item.target);
  return !!(port&&safePost(port,{kind:'envelope',envelope:item.envelope}));
}
async function flushTo(port) {
  if (!port) return;
  const meta=studyPorts.get(port), ctx=meta&&meta.context;
  const idx=await queueIndex();
  safePost(port,{kind:'health',payload:healthFrom(idx)});
  const status=await storageGet(STATUS_KEY,null);
  const route=await routeState();
  if (status&&ctx&&route&&sameOwner(ctx,route)) safePost(port,{kind:'envelope',envelope:status});
  if (!ctx||!route||!sameOwner(ctx,route)) { await flushPlusTo(port); return; }

  const rows=[];
  for (const id of idx.ids||[]) {
    const item=await queueItem(id);
    if (!item||!item.target||!sameOwner(item.target,ctx)) continue;
    rows.push(item.envelope);
    if (rows.length>=100) { safePost(port,{kind:'batch',envelopes:rows.splice(0),health:healthFrom(idx)}); }
  }
  if (rows.length) safePost(port,{kind:'batch',envelopes:rows,health:healthFrom(idx)});
  await flushPlusTo(port);
}
async function acceptCapture(env) {
  const route=await routeState();
  if (!route) return {ok:false,reason:'study_route_unbound',health:healthFrom(await queueIndex())};
  const result=await enqueue(env,route);
  if (result.ok) {
    const item=await queueItem(result.envelope.messageId);
    await deliverItem(item);
  }
  await broadcastHealth();
  return result;
}
async function broadcastStatus(env) {
  const route=await routeState(); if (!route) return;
  const port=await activePortFor(route); if (port) safePost(port,{kind:'envelope',envelope:env});
}

/* -------------------------------------------------------------------------
   ChatGPT Plus browser — opcional. A API do servidor é o caminho padrão.
   ------------------------------------------------------------------------- */
async function plusState() {
  let st=await storageGet(PLUS_JOBS_KEY,null);
  if (st&&st.version===2&&st.jobs&&typeof st.jobs==='object') return st;
  const legacy=await storageGet(PLUS_LEGACY_KEY,null);
  st={version:2,jobs:{},updatedAt:null,migratedAt:nowIso()};
  if (legacy&&legacy.jobs&&typeof legacy.jobs==='object') {
    for (const [id,job] of Object.entries(legacy.jobs)) st.jobs[id]={...job,target:job.target||null};
    await chrome.storage.local.remove(PLUS_LEGACY_KEY);
  }
  await savePlus(st); return st;
}
async function savePlus(st) { st.updatedAt=nowIso(); await chrome.storage.local.set({[PLUS_JOBS_KEY]:st}); }
function plusResult(job) {
  if (!job||job.status!=='complete'||!job.result) return null;
  return {requestId:String(job.requestId),ok:!!job.result.ok,text:job.result.text||'',error:job.result.error||null,
    status:Number(job.result.status||(job.result.ok?200:502)),section:String(job.payload&&job.payload.section||'diagnostico'),
    promptVersion:job.payload&&job.payload.promptVersion||null,completedAt:job.completedAt||null,partial:!!job.result.partial};
}
function targetPorts(target) {
  if (!target) return [];
  return matchingPorts(target).map(x=>x.port);
}
function broadcastPlusStatus(requestId,status,extra={},target=null) {
  const msg={kind:'plus-ai-status',payload:{requestId:String(requestId||''),status,...extra}};
  for (const port of targetPorts(target)) safePost(port,msg);
}
function broadcastPlusResult(job) {
  const payload=plusResult(job); if (!payload) return;
  for (const port of targetPorts(job.target)) safePost(port,{kind:'plus-ai-result',payload});
}
async function flushPlusTo(port) {
  const ctx=contextForPort(port); if (!ctx) return;
  const st=await plusState();
  const rows=Object.values(st.jobs).filter(x=>x&&x.status==='complete'&&x.result&&x.target&&sameOwner(x.target,ctx))
    .sort((a,b)=>Number(a.completedAtMs||0)-Number(b.completedAtMs||0));
  for (const job of rows) { const payload=plusResult(job); if (payload) safePost(port,{kind:'plus-ai-result',payload}); }
}
function validPlusPayload(payload) { return !!(payload&&typeof payload==='object'&&!Array.isArray(payload)&&payload.question&&(payload.question.id||payload.question.enunciado)); }
async function enqueuePlus(requestId,payload,target) {
  if (!requestId||!validPlusPayload(payload)||!target) return {accepted:false,reason:'invalid'};
  const id=String(requestId);
  const result=await serialize(async()=>{
    const st=await plusState();
    if (st.jobs[id]) return {accepted:true,duplicate:true};
    st.jobs[id]={requestId:id,payload,status:'pending',attempts:0,createdAt:nowIso(),createdAtMs:Date.now(),tabId:null,target:{userId:target.userId,profileId:target.profileId}};
    await savePlus(st); return {accepted:true,duplicate:false};
  });
  broadcastPlusStatus(id,'queued',{},target); kickPlus().catch(()=>{}); return result;
}
async function cancelPlus(requestId,target) {
  if (!requestId) return false;
  let removed=false;
  await serialize(async()=>{
    const st=await plusState(), job=st.jobs[String(requestId)];
    if (!job||!job.target||!target||!sameOwner(job.target,target)) return;
    delete st.jobs[String(requestId)]; removed=true; await savePlus(st);
  });
  if (removed) kickPlus().catch(()=>{});
  return removed;
}
async function markPlusFailed(requestId,error,status=502) {
  let completed=null;
  await serialize(async()=>{
    const st=await plusState(),job=st.jobs[String(requestId)]; if (!job) return;
    job.status='complete'; job.completedAt=nowIso(); job.completedAtMs=Date.now();
    job.result={ok:false,text:'',error:String(error||'Falha ao usar o ChatGPT Plus.'),status:Number(status)||502,partial:false};
    completed=job; await savePlus(st);
  });
  if (completed) { broadcastPlusStatus(requestId,'failed',{error:completed.result.error},completed.target); broadcastPlusResult(completed); }
}
async function kickPlus() {
  if (plusKickRunning) return;
  plusKickRunning=true;
  try {
    let target=null, completedByTimeout=[];
    await serialize(async()=>{
      const st=await plusState(), now=Date.now();
      for (const job of Object.values(st.jobs)) {
        if (!job||!['launching','waiting-chatgpt','running'].includes(job.status)) continue;
        const since=Number(job.launchedAtMs||job.startedAtMs||job.createdAtMs||0);
        if (since&&now-since>PLUS_TIMEOUT_MS) {
          if (Number(job.attempts||0)<PLUS_MAX_ATTEMPTS) { job.status='pending'; job.tabId=null; }
          else {
            job.status='complete'; job.completedAt=nowIso(); job.completedAtMs=now;
            job.result={ok:false,text:'',error:'O ChatGPT Plus não respondeu dentro do limite da fila.',status:504,partial:false};
            completedByTimeout.push(job);
          }
        }
      }
      const busy=Object.values(st.jobs).some(job=>job&&['launching','waiting-chatgpt','running'].includes(job.status));
      if (!busy) {
        target=Object.values(st.jobs).filter(job=>job&&job.status==='pending').sort((a,b)=>Number(a.createdAtMs||0)-Number(b.createdAtMs||0))[0]||null;
        if (target) { target.status='launching'; target.attempts=Number(target.attempts||0)+1; target.launchedAt=nowIso(); target.launchedAtMs=now; target.tabId=null; }
      }
      await savePlus(st);
    });
    for (const job of completedByTimeout) { broadcastPlusStatus(job.requestId,'failed',{error:job.result.error},job.target); broadcastPlusResult(job); }
    if (!target) return;
    broadcastPlusStatus(target.requestId,'opening-chatgpt',{attempt:target.attempts},target.target);
    let tab;
    try { tab=await chrome.tabs.create({url:'https://chatgpt.com/?snm_companion=1',active:false}); }
    catch (_) { await markPlusFailed(target.requestId,'Não foi possível abrir a aba dedicada do ChatGPT.',503); return; }
    await serialize(async()=>{
      const st=await plusState(),job=st.jobs[String(target.requestId)]; if (!job||job.status==='complete') return;
      job.status='waiting-chatgpt'; job.tabId=tab&&tab.id!=null?Number(tab.id):null; await savePlus(st);
    });
    broadcastPlusStatus(target.requestId,'waiting-chatgpt',{tabId:tab&&tab.id!=null?Number(tab.id):null},target.target);
  } finally { plusKickRunning=false; }
}
async function claimPlus(tabId) {
  if (tabId==null) return null;
  let claimed=null;
  await serialize(async()=>{
    const st=await plusState();
    const job=Object.values(st.jobs).find(x=>x&&Number(x.tabId)===Number(tabId)&&['waiting-chatgpt','running'].includes(x.status));
    if (!job) return;
    job.status='running'; job.startedAt=nowIso(); job.startedAtMs=Date.now(); claimed={requestId:job.requestId,payload:job.payload}; await savePlus(st);
  });
  if (claimed) {
    const st=await plusState(),job=st.jobs[String(claimed.requestId)];
    broadcastPlusStatus(claimed.requestId,'running',{tabId:Number(tabId)},job&&job.target||null);
  }
  return claimed;
}
async function completePlus(requestId,tabId,result) {
  let completed=null;
  await serialize(async()=>{
    const st=await plusState(),job=st.jobs[String(requestId)]; if (!job) return;
    if (job.tabId!=null&&tabId!=null&&Number(job.tabId)!==Number(tabId)) return;
    job.status='complete'; job.completedAt=nowIso(); job.completedAtMs=Date.now();
    job.result={ok:!!(result&&result.ok),text:String(result&&result.text||''),error:result&&result.error?String(result.error):null,
      status:Number(result&&result.status||(result&&result.ok?200:502)),partial:!!(result&&result.partial)};
    completed=job; await savePlus(st);
  });
  if (!completed) return false;
  broadcastPlusStatus(requestId,completed.result.ok?'complete':'failed',{error:completed.result.error||null,partial:completed.result.partial},completed.target);
  broadcastPlusResult(completed);
  setTimeout(()=>kickPlus().catch(()=>{}),0);
  return true;
}
async function ackPlus(requestId,target) {
  if (!requestId) return false;
  let removed=false;
  await serialize(async()=>{
    const st=await plusState(),job=st.jobs[String(requestId)];
    if (job&&job.status==='complete'&&job.target&&target&&sameOwner(job.target,target)) { delete st.jobs[String(requestId)]; removed=true; await savePlus(st); }
  });
  if (removed) kickPlus().catch(()=>{}); return removed;
}
async function plusTabRemoved(tabId) {
  let retryJob=null,failedJob=null;
  await serialize(async()=>{
    const st=await plusState();
    const job=Object.values(st.jobs).find(x=>x&&Number(x.tabId)===Number(tabId)&&['waiting-chatgpt','running'].includes(x.status));
    if (!job) return;
    if (Number(job.attempts||0)<PLUS_MAX_ATTEMPTS) { job.status='pending'; job.tabId=null; retryJob=job; }
    else { job.status='complete'; job.completedAt=nowIso(); job.completedAtMs=Date.now(); job.result={ok:false,text:'',error:'A aba dedicada do ChatGPT foi fechada antes da análise terminar.',status:499,partial:false}; failedJob=job; }
    await savePlus(st);
  });
  if (failedJob) { broadcastPlusStatus(failedJob.requestId,'failed',{error:failedJob.result.error},failedJob.target); broadcastPlusResult(failedJob); }
  if (retryJob) { broadcastPlusStatus(retryJob.requestId,'retrying',{},retryJob.target); kickPlus().catch(()=>{}); }
}

/* -------------------------------------------------------------------------
   Mensagens e portas
   ------------------------------------------------------------------------- */
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  const url=String(sender&&sender.url||''),tabId=sender&&sender.tab&&sender.tab.id;
  if (!msg||typeof msg!=='object') return false;

  if (msg.kind==='capture'&&isTec(url)) {
    acceptCapture(msg.envelope).then(r=>sendResponse({accepted:!!r.ok,duplicate:!!r.duplicate,reason:r.reason||null,health:r.health||null}))
      .catch(err=>sendResponse({accepted:false,reason:'storage_error',detail:String(err&&err.message||err)})); return true;
  }
  if (msg.kind==='study-route-bind'&&isStudy(url)) {
    const ctx=normalizeContext(msg.context,tabId);
    if (!ctx) { sendResponse({ok:false,reason:'invalid_context'}); return false; }
    const portEntry=[...studyPorts.values()].find(x=>x&&Number(x.tabId)===Number(tabId));
    if (portEntry) portEntry.context=ctx;
    Promise.resolve(msg.claim?claimRoute(ctx,tabId):ctx).then(async route=>{
      if (portEntry&&msg.claim) portEntry.claimedAtMs=Date.now();
      sendResponse({ok:true,route:route?{userId:route.userId,profileId:route.profileId,tabId:route.tabId}:null});
    }); return true;
  }
  if (msg.kind==='plus-ai-request'&&isStudy(url)) {
    const target=contextForTab(tabId)||normalizeContext(msg.context,tabId);
    enqueuePlus(msg.requestId,msg.payload,target).then(sendResponse).catch(err=>sendResponse({accepted:false,reason:'storage_error',detail:String(err&&err.message||err)})); return true;
  }
  if (msg.kind==='plus-ai-cancel'&&isStudy(url)) {
    const target=contextForTab(tabId)||normalizeContext(msg.context,tabId);
    cancelPlus(msg.requestId,target).then(ok=>sendResponse({ok})).catch(()=>sendResponse({ok:false})); return true;
  }
  if (msg.kind==='plus-ai-ack'&&isStudy(url)) {
    const target=contextForTab(tabId)||normalizeContext(msg.context,tabId);
    ackPlus(msg.requestId,target).then(ok=>sendResponse({ok})).catch(()=>sendResponse({ok:false})); return true;
  }
  if (msg.kind==='plus-ai-claim'&&isChatGPT(url)) {
    claimPlus(tabId).then(job=>sendResponse({ok:true,job})).catch(err=>sendResponse({ok:false,error:String(err&&err.message||err)})); return true;
  }
  if (msg.kind==='plus-ai-result'&&isChatGPT(url)) {
    completePlus(msg.requestId,tabId,msg.result||{}).then(ok=>sendResponse({ok})).catch(err=>sendResponse({ok:false,error:String(err&&err.message||err)})); return true;
  }
  return false;
});

chrome.runtime.onConnect.addListener(port=>{
  const url=String(port.sender&&port.sender.url||''),tabId=port.sender&&port.sender.tab&&port.sender.tab.id;
  if (port.name==='snm-study-v1'&&isStudy(url)) {
    const meta={tabId:tabId==null?null:Number(tabId),context:null,claimedAtMs:0}; studyPorts.set(port,meta);
    port.onDisconnect.addListener(()=>{ const ignored=chrome.runtime.lastError; void ignored; studyPorts.delete(port); });
    port.onMessage.addListener(msg=>{
      if (!msg||typeof msg!=='object') return;
      if (msg.type==='bind-study') {
        const ctx=normalizeContext(msg.context,tabId); if (ctx) meta.context=ctx;
      } else if (msg.type==='claim-capture-route') {
        const ctx=normalizeContext(msg.context||meta.context,tabId); if (!ctx) return;
        meta.context=ctx; meta.claimedAtMs=Date.now();
        claimRoute(ctx,tabId).then(()=>flushTo(port)).catch(()=>{});
      } else if (msg.type==='ack') ack(msg.messageId,port).catch(()=>{});
      else if (msg.type==='resync') flushTo(port).catch(()=>{});
      else if (msg.type==='plus-ai-ack') ackPlus(msg.requestId,meta.context).catch(()=>{});
      else if (msg.type==='plus-ai-cancel') cancelPlus(msg.requestId,meta.context).catch(()=>{});
    });
    flushTo(port).catch(()=>{}); return;
  }

  if (port.name==='snm-tec-v1'&&isTec(url)) {
    port.onDisconnect.addListener(()=>{ const ignored=chrome.runtime.lastError; void ignored; });
    port.onMessage.addListener(async msg=>{
      const env=msg&&msg.envelope; if (!validEnvelope(env)) return;
      if (env.type==='ready'||env.type==='status') {
        await chrome.storage.local.set({[STATUS_KEY]:env}); await broadcastStatus(env); return;
      }
      await acceptCapture(env);
    });
  }
});

chrome.tabs.onRemoved.addListener(tabId=>{ plusTabRemoved(tabId).catch(()=>{}); });
chrome.alarms?.onAlarm.addListener(alarm=>{ if (alarm&&alarm.name===ALARM_NAME) { kickPlus().catch(()=>{}); broadcastHealth().catch(()=>{}); } });

async function ensureMaintenance() {
  try { await chrome.alarms?.create(ALARM_NAME,{periodInMinutes:1}); } catch (_) {}
  try { await queueIndex(); } catch (_) {}
  try { await plusState(); } catch (_) {}
  kickPlus().catch(()=>{});
}
chrome.runtime.onInstalled.addListener(()=>{
  chrome.storage.local.set({snmCompanionInstalledAt:nowIso()}).catch(()=>{}); ensureMaintenance();
});
chrome.runtime.onStartup.addListener(()=>ensureMaintenance());
ensureMaintenance();
