/* StudyNoMentor Companion — service worker MV3
 * Fila durável entre TEC e StudyNoMentor. O evento só sai da fila após ACK do site.
 */
'use strict';

const QUEUE_KEY = 'snmTecQueueV1';
const STATUS_KEY = 'snmTecStatusV1';
const MAX_PENDING = 10000;
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

async function enqueue(env) {
  if (!validEnvelope(env)) return false;
  return serialize(async () => {
    const q = await queueState();
    q.items[String(env.messageId)] = env;
    const rows = Object.values(q.items).sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
    while (rows.length > MAX_PENDING) {
      const old = rows.shift();
      if (old && old.messageId && q.items[old.messageId]) {
        delete q.items[old.messageId];
        q.dropped = Number(q.dropped || 0) + 1;
      }
    }
    await saveQueue(q);
    return true;
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
}

function safePost(port, msg) {
  try { port.postMessage(msg); return true; } catch (_) { return false; }
}

async function flushTo(port) {
  if (!port) return;
  const status = await storageGet(STATUS_KEY, null);
  if (status) safePost(port, { kind: 'envelope', envelope: status });
  const q = await queueState();
  const rows = Object.values(q.items).sort((a, b) => Number(a.createdAtMs || 0) - Number(b.createdAtMs || 0));
  for (let i = 0; i < rows.length; i += 100) {
    safePost(port, { kind: 'batch', envelopes: rows.slice(i, i + 100), dropped: Number(q.dropped || 0) });
  }
}

function broadcast(env) {
  for (const port of [...studyPorts]) {
    if (!safePost(port, { kind: 'envelope', envelope: env })) studyPorts.delete(port);
  }
}

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

  if (port.name === 'snm-tec-v1' && isTec(url)) {
    port.onMessage.addListener(async (msg) => {
      const env = msg && msg.envelope;
      if (!validEnvelope(env)) return;
      if (env.type === 'ready' || env.type === 'status') {
        await chrome.storage.local.set({ [STATUS_KEY]: env });
        broadcast(env);
        return;
      }
      await enqueue(env);
      broadcast(env);
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ snmCompanionInstalledAt: new Date().toISOString() }).catch(() => {});
});
