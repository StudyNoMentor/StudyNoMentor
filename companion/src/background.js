/* StudyNoMentor Companion — service worker MV3
 * Fila durável entre TEC e StudyNoMentor + ponte durável para ChatGPT Plus.
 * Eventos TEC só saem da fila após ACK. Jobs de IA ficam persistidos até o
 * Study receber o resultado e confirmar o consumo.
 */
'use strict';

const QUEUE_KEY = 'snmTecQueueV1';
const STATUS_KEY = 'snmTecStatusV1';
const PLUS_JOBS_KEY = 'snmPlusAiJobsV1';
const MAX_PENDING = 50000;
const PLUS_TIMEOUT_MS = 4 * 60 * 1000;
const PLUS_MAX_ATTEMPTS = 3;
const studyPorts = new Set();
let writeChain = Promise.resolve();
let plusKickRunning = false;

const isTec = (url) => /^https:\/\/(?:www\.)?tecconcursos\.com\.br\//i.test(String(url || ''));
const isStudy = (url) => /^https:\/\/studynomentor\.github\.io\/StudyNoMentor(?:\/|$)/i.test(String(url || ''));
const isChatGPT = (url) => /^https:\/\/chatgpt\.com(?:\/|$)/i.test(String(url || ''));

async function storageGet(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] == null ? fallback : out[key];
}
async function queueState() {
  const q = await storageGet(QUEUE_KEY, null);
  return q && q.version === 1 && q.items && typeof q.items === 'object'
    ? q : { version:1, items:{}, dropped:0, updatedAt:null };
}
async function saveQueue(q) { q.updatedAt = new Date().toISOString(); await chrome.storage.local.set({ [QUEUE_KEY]:q }); }
function serialize(task) { writeChain = writeChain.then(task, task); return writeChain; }
function validEnvelope(env) { return !!(env && env.source === 'StudyMentorCompanion' && Number(env.protocol) === 1 && env.messageId && env.type); }
function healthFrom(q) {
  return { pending:Object.keys(q && q.items || {}).length, dropped:Number(q && q.dropped || 0), limit:MAX_PENDING, updatedAt:q && q.updatedAt || null };
}
function safePost(port,msg) { try { port.postMessage(msg); return true; } catch (_) { return false; } }
function broadcast(msg) { for (const port of [...studyPorts]) if (!safePost(port,msg)) studyPorts.delete(port); }
function broadcastEnvelope(env) { broadcast({ kind:'envelope', envelope:env }); }
async function broadcastHealth() { const q=await queueState(); broadcast({ kind:'health', payload:healthFrom(q) }); }

async function enqueue(env) {
  if (!validEnvelope(env)) return { ok:false, reason:'invalid' };
  return serialize(async () => {
    const q=await queueState(), id=String(env.messageId), exists=!!q.items[id], size=Object.keys(q.items).length;
    if (!exists && size >= MAX_PENDING) return { ok:false, reason:'queue_full', health:healthFrom(q) };
    q.items[id]=env; await saveQueue(q);
    return { ok:true, duplicate:exists, health:healthFrom(q) };
  });
}
async function ack(messageId) {
  if (!messageId) return;
  await serialize(async () => {
    const q=await queueState();
    if (q.items[String(messageId)]) { delete q.items[String(messageId)]; await saveQueue(q); }
  });
  await broadcastHealth();
}

async function plusState() {
  const st=await storageGet(PLUS_JOBS_KEY,null);
  return st && st.version===1 && st.jobs && typeof st.jobs==='object'
    ? st : { version:1, jobs:{}, updatedAt:null };
}
async function savePlus(st) {
  st.updatedAt=new Date().toISOString();
  await chrome.storage.local.set({ [PLUS_JOBS_KEY]:st });
}
function plusResult(job) {
  if (!job || job.status!=='complete' || !job.result) return null;
  return {
    requestId:String(job.requestId),
    ok:!!job.result.ok,
    text:job.result.text || '',
    error:job.result.error || null,
    status:Number(job.result.status || (job.result.ok ? 200 : 502)),
    section:String(job.payload && job.payload.section || 'diagnostico'),
    promptVersion:job.payload && job.payload.promptVersion || null,
    completedAt:job.completedAt || null
  };
}
function broadcastPlusStatus(requestId,status,extra={}) {
  broadcast({ kind:'plus-ai-status', payload:{ requestId:String(requestId||''), status, ...extra } });
}
function broadcastPlusResult(job) {
  const payload=plusResult(job); if (payload) broadcast({ kind:'plus-ai-result', payload });
}
async function flushPlusTo(port) {
  const st=await plusState();
  const rows=Object.values(st.jobs).filter(x=>x && x.status==='complete' && x.result)
    .sort((a,b)=>Number(a.completedAtMs||0)-Number(b.completedAtMs||0));
  for (const job of rows) {
    const payload=plusResult(job); if (payload) safePost(port,{ kind:'plus-ai-result', payload });
  }
}
async function flushTo(port) {
  if (!port) return;
  const status=await storageGet(STATUS_KEY,null);
  if (status) safePost(port,{ kind:'envelope', envelope:status });
  const q=await queueState();
  const rows=Object.values(q.items).sort((a,b)=>Number(a.createdAtMs||0)-Number(b.createdAtMs||0));
  safePost(port,{ kind:'health', payload:healthFrom(q) });
  for (let i=0;i<rows.length;i+=100) safePost(port,{ kind:'batch', envelopes:rows.slice(i,i+100), health:healthFrom(q) });
  await flushPlusTo(port);
}
async function acceptCapture(env) {
  const result=await enqueue(env);
  if (result.ok) broadcastEnvelope(env);
  broadcast({ kind:'health', payload:result.health || healthFrom(await queueState()) });
  return result;
}

function validPlusPayload(payload) {
  return !!(payload && typeof payload==='object' && !Array.isArray(payload) && payload.question && (payload.question.id || payload.question.enunciado));
}
async function enqueuePlus(requestId,payload) {
  if (!requestId || !validPlusPayload(payload)) return { accepted:false, reason:'invalid' };
  const id=String(requestId);
  const result=await serialize(async()=>{
    const st=await plusState();
    if (st.jobs[id]) return { accepted:true, duplicate:true };
    st.jobs[id]={ requestId:id, payload, status:'pending', attempts:0, createdAt:new Date().toISOString(), createdAtMs:Date.now(), tabId:null };
    await savePlus(st);
    return { accepted:true, duplicate:false };
  });
  broadcastPlusStatus(id,'queued');
  kickPlus().catch(()=>{});
  return result;
}
async function markPlusFailed(requestId,error,status=502) {
  let completed=null;
  await serialize(async()=>{
    const st=await plusState(), job=st.jobs[String(requestId)]; if (!job) return;
    job.status='complete'; job.completedAt=new Date().toISOString(); job.completedAtMs=Date.now();
    job.result={ ok:false, text:'', error:String(error || 'Falha ao usar o ChatGPT Plus.'), status:Number(status)||502 };
    completed=job; await savePlus(st);
  });
  if (completed) { broadcastPlusStatus(requestId,'failed',{ error:completed.result.error }); broadcastPlusResult(completed); }
}
async function kickPlus() {
  if (plusKickRunning) return;
  plusKickRunning=true;
  try {
    let target=null;
    await serialize(async()=>{
      const st=await plusState(), now=Date.now();
      for (const job of Object.values(st.jobs)) {
        if (!job || !['launching','waiting-chatgpt','running'].includes(job.status)) continue;
        const since=Number(job.launchedAtMs || job.startedAtMs || job.createdAtMs || 0);
        if (since && now-since>PLUS_TIMEOUT_MS) {
          if (Number(job.attempts||0)<PLUS_MAX_ATTEMPTS) { job.status='pending'; job.tabId=null; }
          else {
            job.status='complete'; job.completedAt=new Date().toISOString(); job.completedAtMs=now;
            job.result={ ok:false, text:'', error:'O ChatGPT Plus não respondeu. Abra chatgpt.com, confirme seu login e tente novamente.', status:504 };
          }
        }
      }
      const busy=Object.values(st.jobs).some(job=>job && ['launching','waiting-chatgpt','running'].includes(job.status));
      if (!busy) {
        target=Object.values(st.jobs).filter(job=>job && job.status==='pending')
          .sort((a,b)=>Number(a.createdAtMs||0)-Number(b.createdAtMs||0))[0] || null;
        if (target) {
          target.status='launching'; target.attempts=Number(target.attempts||0)+1;
          target.launchedAt=new Date().toISOString(); target.launchedAtMs=Date.now(); target.tabId=null;
        }
      }
      await savePlus(st);
    });
    if (!target) return;
    broadcastPlusStatus(target.requestId,'opening-chatgpt',{ attempt:target.attempts });
    let tab;
    try { tab=await chrome.tabs.create({ url:'https://chatgpt.com/', active:false }); }
    catch (err) { await markPlusFailed(target.requestId,'Não foi possível abrir o ChatGPT no navegador.',503); return; }
    await serialize(async()=>{
      const st=await plusState(), job=st.jobs[String(target.requestId)]; if (!job || job.status==='complete') return;
      job.status='waiting-chatgpt'; job.tabId=tab && tab.id != null ? Number(tab.id) : null;
      await savePlus(st);
    });
    broadcastPlusStatus(target.requestId,'waiting-chatgpt',{ tabId:tab && tab.id != null ? Number(tab.id) : null });
  } finally { plusKickRunning=false; }
}
async function claimPlus(tabId) {
  if (tabId == null) return null;
  let claimed=null;
  await serialize(async()=>{
    const st=await plusState();
    const job=Object.values(st.jobs).find(x=>x && Number(x.tabId)===Number(tabId) && ['waiting-chatgpt','running'].includes(x.status));
    if (!job) return;
    job.status='running'; job.startedAt=new Date().toISOString(); job.startedAtMs=Date.now(); claimed={ requestId:job.requestId, payload:job.payload };
    await savePlus(st);
  });
  if (claimed) broadcastPlusStatus(claimed.requestId,'running',{ tabId:Number(tabId) });
  return claimed;
}
async function completePlus(requestId,tabId,result) {
  let completed=null;
  await serialize(async()=>{
    const st=await plusState(), job=st.jobs[String(requestId)]; if (!job) return;
    if (job.tabId != null && tabId != null && Number(job.tabId)!==Number(tabId)) return;
    job.status='complete'; job.completedAt=new Date().toISOString(); job.completedAtMs=Date.now();
    job.result={ ok:!!(result && result.ok), text:String(result && result.text || ''), error:result && result.error ? String(result.error) : null,
      status:Number(result && result.status || (result && result.ok ? 200 : 502)) };
    completed=job; await savePlus(st);
  });
  if (!completed) return false;
  broadcastPlusStatus(requestId,completed.result.ok?'complete':'failed',{ error:completed.result.error || null });
  broadcastPlusResult(completed);
  if (tabId != null) setTimeout(()=>chrome.tabs.remove(Number(tabId)).catch(()=>{}),400);
  return true;
}
async function ackPlus(requestId) {
  if (!requestId) return;
  await serialize(async()=>{
    const st=await plusState(), job=st.jobs[String(requestId)];
    if (job && job.status==='complete') { delete st.jobs[String(requestId)]; await savePlus(st); }
  });
  kickPlus().catch(()=>{});
}
async function plusTabRemoved(tabId) {
  let retryJob=null, failedJob=null;
  await serialize(async()=>{
    const st=await plusState();
    const job=Object.values(st.jobs).find(x=>x && Number(x.tabId)===Number(tabId) && ['waiting-chatgpt','running'].includes(x.status));
    if (!job) return;
    if (Number(job.attempts||0)<PLUS_MAX_ATTEMPTS) { job.status='pending'; job.tabId=null; retryJob=job.requestId; }
    else {
      job.status='complete'; job.completedAt=new Date().toISOString(); job.completedAtMs=Date.now();
      job.result={ ok:false, text:'', error:'A aba do ChatGPT foi fechada antes de a análise terminar.', status:499 }; failedJob=job;
    }
    await savePlus(st);
  });
  if (failedJob) { broadcastPlusStatus(failedJob.requestId,'failed',{error:failedJob.result.error}); broadcastPlusResult(failedJob); }
  if (retryJob) { broadcastPlusStatus(retryJob,'retrying'); kickPlus().catch(()=>{}); }
}

chrome.runtime.onMessage.addListener((msg,sender,sendResponse) => {
  const url=String(sender && sender.url || '');
  if (!msg || typeof msg!=='object') return false;

  if (msg.kind==='capture' && isTec(url)) {
    acceptCapture(msg.envelope)
      .then(result=>sendResponse({ accepted:!!result.ok, duplicate:!!result.duplicate, reason:result.reason||null, health:result.health||null }))
      .catch(err=>sendResponse({ accepted:false, reason:'storage_error', detail:String(err && err.message || err) }));
    return true;
  }
  if (msg.kind==='plus-ai-request' && isStudy(url)) {
    enqueuePlus(msg.requestId,msg.payload)
      .then(sendResponse).catch(err=>sendResponse({ accepted:false, reason:'storage_error', detail:String(err && err.message || err) }));
    return true;
  }
  if (msg.kind==='plus-ai-ack' && isStudy(url)) {
    ackPlus(msg.requestId).then(()=>sendResponse({ ok:true })).catch(()=>sendResponse({ ok:false })); return true;
  }
  if (msg.kind==='plus-ai-claim' && isChatGPT(url)) {
    claimPlus(sender && sender.tab && sender.tab.id)
      .then(job=>sendResponse({ ok:true, job })).catch(err=>sendResponse({ ok:false, error:String(err && err.message || err) }));
    return true;
  }
  if (msg.kind==='plus-ai-result' && isChatGPT(url)) {
    completePlus(msg.requestId,sender && sender.tab && sender.tab.id,msg.result||{})
      .then(ok=>sendResponse({ ok })).catch(err=>sendResponse({ ok:false, error:String(err && err.message || err) }));
    return true;
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  const url=String(port.sender && port.sender.url || '');

  if (port.name === 'snm-study-v1' && isStudy(url)) {
    studyPorts.add(port);
    port.onDisconnect.addListener(() => {
      const ignored=chrome.runtime.lastError; void ignored;
      studyPorts.delete(port);
    });
    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ack') ack(msg.messageId);
      else if (msg.type === 'resync') flushTo(port);
      else if (msg.type === 'plus-ai-ack') ackPlus(msg.requestId);
    });
    flushTo(port);
    return;
  }

  if (port.name === 'snm-tec-v1' && isTec(url)) {
    port.onDisconnect.addListener(() => { const ignored=chrome.runtime.lastError; void ignored; });
    port.onMessage.addListener(async (msg) => {
      const env=msg && msg.envelope;
      if (!validEnvelope(env)) return;
      if (env.type === 'ready' || env.type === 'status') {
        await chrome.storage.local.set({ [STATUS_KEY]:env });
        broadcastEnvelope(env);
        return;
      }
      await acceptCapture(env);
    });
  }
});

chrome.tabs.onRemoved.addListener(tabId => { plusTabRemoved(tabId).catch(()=>{}); });

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ snmCompanionInstalledAt:new Date().toISOString() }).catch(() => {});
  kickPlus().catch(()=>{});
});
chrome.runtime.onStartup.addListener(() => { kickPlus().catch(()=>{}); });
