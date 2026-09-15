/* StudyNoMentor Companion — service worker MV3
 * Fila durável entre TEC e StudyNoMentor. O evento só sai da fila após ACK do site.
 * A captura recebe uma confirmação própria somente DEPOIS de estar persistida.
 */
'use strict';

const QUEUE_KEY = 'snmTecQueueV1';
const STATUS_KEY = 'snmTecStatusV1';
const MAX_PENDING = 50000;
const studyPorts = new Set();
let writeChain = Promise.resolve();

const isTec = (url) => /^https:\/\/(?:www\.)?tecconcursos\.com\.br\//i.test(String(url || ''));
const isStudy = (url) => /^https:\/\/studynomentor\.github\.io\/StudyNoMentor(?:\/|$)/i.test(String(url || ''));

async function storageGet(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] == null ? fallback : out[key];
}

async function queueState() {
  const q = await storageGet(QUEUE_KEY, null);
  return q && q.version === 1 && q.items && typeof q.items === 'object'
    ? q : { version: 1, items: {}, dropped: 0, updatedAt: null };
}

async function saveQueue(q) {
  q.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ [QUEUE_KEY]: q });
}

function serialize(task) {
  writeChain = writeChain.then(task, task);
  return writeChain;
}

function validEnvelope(env) {
  return !!(env && env.source === 'StudyMentorCompanion' && Number(env.protocol) === 1 && env.messageId && env.type);
}

function healthFrom(q) {
  return {
    pending: Object.keys(q && q.items || {}).length,
    dropped: Number(q && q.dropped || 0),
    limit: MAX_PENDING,
    updatedAt: q && q.updatedAt || null
  };
}

function safePost(port, msg) {
  try { port.postMessage(msg); return true; } catch (_) { return false; }
}

function broadcast(msg) {
  for (const port of [...studyPorts]) {
    if (!safePost(port, msg)) studyPorts.delete(port);
  }
}

function broadcastEnvelope(env) {
  broadcast({ kind: 'envelope', envelope: env });
}

async function broadcastHealth() {
  const q = await queueState();
  broadcast({ kind: 'health', payload: healthFrom(q) });
}

async function enqueue(env) {
  if (!validEnvelope(env)) return { ok: false, reason: 'invalid' };
  return serialize(async () => {
    const q = await queueState();
    const id = String(env.messageId);
    const exists = !!q.items[id];
    const size = Object.keys(q.items).length;
    if (!exists && size >= MAX_PENDING) {
      return { ok: false, reason: 'queue_full', health: healthFrom(q) };
    }
    q.items[id] = env;
    await saveQueue(q);
    return { ok: true, duplicate: exists, health: healthFrom(q) };
  });
}

async function ack(messageId) {
  if (!messageId) return;
  await serialize(async () => {
    const q = await queueState();
    if (q.items[String(messageId)]) {
      delete q.items[String(messageId)];
      await saveQueue(q);
    }
  });
  await broadcastHealth();
}

async function flushTo(port) {
  if (!port) return;
  const status = await storageGet(STATUS_KEY, null);
  if (status) safePost(port, { kind: 'envelope', envelope: status });
  const q = await queueState();
  const rows = Object.values(q.items).sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
  safePost(port, { kind: 'health', payload: healthFrom(q) });
  for (let i = 0; i < rows.length; i += 100) {
    safePost(port, { kind: 'batch', envelopes: rows.slice(i, i + 100), health: healthFrom(q) });
  }
}

async function acceptCapture(env) {
  const result = await enqueue(env);
  if (result.ok) broadcastEnvelope(env);
  broadcast({ kind: 'health', payload: result.health || healthFrom(await queueState()) });
  return result;
}

/* Caminho transacional para as resoluções: runtime.sendMessage acorda o service
 * worker e só responde `accepted:true` depois de a fila durável ter sido salva.
 * O content script mantém uma cópia de estágio até receber esta confirmação. */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const url = String(sender && sender.url || '');
  if (!msg || msg.kind !== 'capture' || !isTec(url)) return false;
  const env = msg.envelope;
  acceptCapture(env)
    .then(result => sendResponse({ accepted: !!result.ok, duplicate: !!result.duplicate, reason: result.reason || null, health: result.health || null }))
    .catch(err => sendResponse({ accepted: false, reason: 'storage_error', detail: String(err && err.message || err) }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  const url = String(port.sender && port.sender.url || '');

  if (port.name === 'snm-study-v1' && isStudy(url)) {
    studyPorts.add(port);
    port.onDisconnect.addListener(() => studyPorts.delete(port));
    port.onMessage.addListener((msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ack') ack(msg.messageId);
      else if (msg.type === 'resync') flushTo(port);
    });
    flushTo(port);
    return;
  }

  /* O port do TEC fica para presença/status e compatibilidade. Resoluções novas
   * preferem o caminho transacional acima; se uma versão anterior ainda mandar
   * pelo port, o mesmo enqueue idempotente continua protegendo os dados. */
  if (port.name === 'snm-tec-v1' && isTec(url)) {
    port.onMessage.addListener(async (msg) => {
      const env = msg && msg.envelope;
      if (!validEnvelope(env)) return;
      if (env.type === 'ready' || env.type === 'status') {
        await chrome.storage.local.set({ [STATUS_KEY]: env });
        broadcastEnvelope(env);
        return;
      }
      await acceptCapture(env);
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ snmCompanionInstalledAt: new Date().toISOString() }).catch(() => {});
});
