/* StudyNoMentor Companion — Study reconstruction ACK v2 (MAIN world).
 * Fixes the missing ACK in the current page module and makes replay idempotent.
 * A batch is ACKed only after the imported questions are observable again from
 * TecIntegracaoScreen.state(). Duplicate/replayed batches are not ingested twice.
 */
'use strict';

(() => {
  if (window.top !== window.self || window.__snmTecReconstructAckV2) return;
  window.__snmTecReconstructAckV2 = true;

  const APP_SOURCE = 'StudyNoMentorApp';
  const EXT_SOURCE = 'StudyMentorCompanion';
  const LEDGER_SUFFIX = 'tec-reconstruct-applied-batches-v2';
  const MAX_LEDGER = 2500;
  let patched = false;

  function profileKey() {
    try { return DB._profilePrefix() + LEDGER_SUFFIX; }
    catch (_) { return 'diario-estudos:' + LEDGER_SUFFIX; }
  }

  function ledger() {
    try {
      const parsed = JSON.parse(localStorage.getItem(profileKey()) || 'null');
      return parsed && Array.isArray(parsed.ids) ? parsed : { schema:2, ids:[], updatedAt:null };
    } catch (_) { return { schema:2, ids:[], updatedAt:null }; }
  }

  function seen(batchId) {
    if (!batchId) return false;
    return ledger().ids.includes(String(batchId));
  }

  function remember(batchId) {
    if (!batchId) return;
    const st = ledger();
    st.ids = [...new Set([...st.ids, String(batchId)])].slice(-MAX_LEDGER);
    st.updatedAt = new Date().toISOString();
    try { localStorage.setItem(profileKey(), JSON.stringify(st)); } catch (_) {}
  }

  function context() {
    try { return typeof window.__snmTecStudyContext === 'function' ? window.__snmTecStudyContext() : null; }
    catch (_) { return null; }
  }

  function postAck(payload) {
    if (!payload || !payload.requestId || !payload.batchId) return;
    window.postMessage({
      source:APP_SOURCE,
      type:'tec-reconstruct-batch-ack',
      payload:{ requestId:String(payload.requestId), batchId:String(payload.batchId), context:context() }
    }, location.origin);
  }

  function verifyQuestions(payload) {
    const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
    const expected = rows
      .map(row => ({
        id:String(row && row.question && row.question.id || row && row.questionId || ''),
        bookId:String(payload && payload.bookId || row && row.bookId || row && row.question && row.question.cadernoId || '')
      }))
      .filter(x => x.id && rows.some(row => row && row.question && String(row.question.id || '') === x.id));
    if (!expected.length) return true; // batches containing only failed/unavailable questions carry no fact to persist.

    const T = window.TecIntegracaoScreen;
    if (!T || typeof T.state !== 'function') return false;
    const state = T.state();
    const stored = Object.values(state && state.questions || {});
    return expected.every(want => stored.some(row => {
      const q = row && row.question || {};
      return String(q.id || row.questionId || '') === want.id && (!want.bookId || String(row.bookId || q.cadernoId || '') === want.bookId);
    }));
  }

  function stopSafely(H, payload, reason) {
    try {
      if (H && typeof H.setStatus === 'function') H.setStatus(reason, null, false);
      window.postMessage({
        source:APP_SOURCE,
        type:'tec-reconstruct-cancel',
        payload:{ requestId:String(payload && payload.requestId || ''), context:context() }
      }, location.origin);
    } catch (_) {}
  }

  function patch() {
    if (patched) return true;
    const H = window.TecHistoricalReconstruction;
    if (!H || typeof H.onMessage !== 'function') return false;

    const original = H.onMessage.bind(H);
    H.onMessage = function(event) {
      const m = event && event.data;
      const isBatch = event && event.source === window && event.origin === location.origin &&
        m && m.source === EXT_SOURCE && m.type === 'tec-reconstruct-batch';
      if (!isBatch) return original(event);

      const payload = m.payload || {};
      if (!payload.requestId || !payload.batchId) return original(event);

      // Replay after a lost ACK: do not add stats/questions twice; only confirm again.
      if (seen(payload.batchId)) {
        postAck(payload);
        return;
      }

      try {
        original(event);
      } catch (error) {
        stopSafely(H, payload, `Falha ao persistir lote TEC: ${String(error && error.message || error)}`);
        return;
      }

      if (!verifyQuestions(payload)) {
        stopSafely(H, payload, 'O lote recebido do TEC não ficou persistido no StudyNoMentor. A reconstrução foi interrompida para evitar perda de dados ou repetição em loop.');
        return;
      }

      remember(payload.batchId);
      postAck(payload);
    };
    H.__ackV2Patched = true;
    patched = true;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (patch() || attempts >= 240) clearInterval(timer);
  }, 250);
  patch();
})();
