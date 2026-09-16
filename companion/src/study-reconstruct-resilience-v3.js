/* StudyNoMentor Companion — diagnóstico de reconstrução TEC v3 (MAIN world).
 *
 * Complementa o módulo da página sem alterar dados factuais: quando o Companion
 * termina uma reconstrução com falhas definitivas, o Study informa claramente
 * que o resultado é parcial, preserva IDs/motivos e não mostra sucesso total.
 */
'use strict';

(() => {
  if (window.top !== window.self || window.__snmTecReconstructResilienceStudyV3) return;
  window.__snmTecReconstructResilienceStudyV3 = true;

  const EXT_SOURCE = 'StudyMentorCompanion';
  let patched = false;

  function normalizeFailures(summary) {
    const failures = Array.isArray(summary?.failures) ? summary.failures : [];
    const ids = Array.isArray(summary?.failedQuestionIds) ? summary.failedQuestionIds.map(String) :
      failures.map(x => String(x?.questionId || '')).filter(Boolean);
    return {
      failed:Math.max(Number(summary?.failedQuestions || 0), ids.length),
      ids:[...new Set(ids)].slice(0,50),
      failures:failures.slice(0,50),
      recovered:Math.max(0, Number(summary?.recoveredQuestions || 0)),
      retried:Math.max(0, Number(summary?.retriedQuestions || 0))
    };
  }

  function persistDiagnostics(H, bookId, summary) {
    try {
      if (!H || typeof H.state !== 'function' || typeof H.save !== 'function' || !bookId) return;
      const st = H.state();
      const current = st.books && st.books[String(bookId)];
      if (!current) return;
      const diag = normalizeFailures(summary);
      current.incomplete = diag.failed > 0;
      current.failedQuestions = diag.failed;
      current.failedQuestionIds = diag.ids;
      current.failureDetails = diag.failures;
      current.retriedQuestions = diag.retried;
      current.recoveredQuestions = diag.recovered;
      current.lastDiagnosticsAt = new Date().toISOString();
      st.books[String(bookId)] = current;
      H.save(st);
    } catch (_) {}
  }

  function decorateSummary(H, bookId) {
    try {
      const box = document.getElementById('tec-reconstruction-summary');
      if (!box || !H || typeof H.state !== 'function') return;
      const st = H.state();
      const active = st.active && String(st.active.bookId || '') === String(bookId || '') ? st.active : null;
      const row = active || st.books?.[String(bookId || '')];
      if (!row) return;
      const failed = Math.max(0, Number(row.failedQuestions || row.companionSummary?.failedQuestions || 0));
      const ids = Array.isArray(row.failedQuestionIds) ? row.failedQuestionIds :
        Array.isArray(row.companionSummary?.failedQuestionIds) ? row.companionSummary.failedQuestionIds : [];
      const recovered = Math.max(0, Number(row.recoveredQuestions || row.companionSummary?.recoveredQuestions || 0));
      if (failed > 0) {
        const label = ids.length ? ids.slice(0,8).map(id => `#${id}`).join(', ') : `${failed} questão(ões)`;
        if (!box.textContent.includes('reconstrução parcial')) box.textContent += ` · ⚠ reconstrução parcial: falha definitiva em ${label}`;
      } else if (recovered > 0 && !box.textContent.includes('recuperada')) {
        box.textContent += ` · ${recovered} questão(ões) recuperada(s) automaticamente após retry`;
      }
    } catch (_) {}
  }

  function failureReason(summary) {
    const failures = Array.isArray(summary?.failures) ? summary.failures : [];
    const first = failures[0];
    return String(first?.finalError || first?.initialError || '').trim();
  }

  function patch() {
    if (patched) return true;
    const H = window.TecHistoricalReconstruction;
    if (!H || typeof H.onMessage !== 'function') return false;

    if (typeof H.updateSummary === 'function' && !H.__resilienceV3SummaryPatched) {
      const originalUpdateSummary = H.updateSummary.bind(H);
      H.updateSummary = function(bookId, extra = '') {
        const result = originalUpdateSummary(bookId, extra);
        decorateSummary(H, bookId);
        return result;
      };
      H.__resilienceV3SummaryPatched = true;
    }

    const original = H.onMessage.bind(H);
    H.onMessage = function(event) {
      const m = event && event.data;
      const isResult = event && event.source === window && event.origin === location.origin &&
        m && m.source === EXT_SOURCE && m.type === 'tec-reconstruct-result';
      const payload = isResult ? (m.payload || {}) : null;
      const summary = payload?.summary || null;
      const result = original(event);

      if (isResult && payload?.status !== 'cancelled') {
        const bookId = String(payload?.bookId || '');
        const diag = normalizeFailures(summary || {});
        persistDiagnostics(H, bookId, summary || {});
        decorateSummary(H, bookId);

        if (diag.failed > 0) {
          const ids = diag.ids.length ? diag.ids.slice(0,8).map(id => `#${id}`).join(', ') : `${diag.failed} questão(ões)`;
          const reason = failureReason(summary || {});
          const suffix = reason ? ` Motivo final: ${reason}` : '';
          if (typeof H.setStatus === 'function') {
            H.setStatus(`Reconstrução parcial do caderno #${bookId}: ${diag.failed} questão(ões) não puderam ser extraídas após retries (${ids}).${suffix}`, 100, false);
          }
          try {
            if (typeof showToast === 'function') showToast(`⚠️ Reconstrução TEC parcial: ${diag.failed} questão(ões) precisam de nova tentativa.`);
          } catch (_) {}
        } else if (diag.recovered > 0) {
          if (typeof H.setStatus === 'function') {
            H.setStatus(`Reconstrução concluída: todas as questões foram persistidas; ${diag.recovered} recuperada(s) automaticamente após retry.`, 100, false);
          }
        }
      }
      return result;
    };

    H.__resilienceV3Patched = true;
    patched = true;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (patch() || attempts >= 480) clearInterval(timer);
  }, 250);
  patch();
})();
