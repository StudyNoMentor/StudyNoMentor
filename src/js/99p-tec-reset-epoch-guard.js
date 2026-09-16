/* ============================================================================
   TEC RESET EPOCH GUARD
   ----------------------------------------------------------------------------
   Uma limpeza TEC precisa ser monotônica: nenhum envelope factual capturado
   antes da limpeza pode reaparecer depois através da fila durável do Companion.

   Regra:
   - o reset grava um epoch por perfil (`TecDataReset._getApplied`);
   - envelope normal do Companion traz `payload.capturedAt`;
   - se capturedAt < epoch, o envelope é ACKado e descartado;
   - a DATA DA RESOLUÇÃO não participa desta decisão. Assim, uma reconstrução
     feita hoje de uma questão resolvida meses atrás continua válida, pois sua
     captura/reconstrução ocorreu depois do reset.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecResetEpochGuard) return;
  window.__tecResetEpochGuard = true;

  const quiet = (e, tag) => {
    try { if (typeof _quiet === 'function') _quiet(e, tag || 'tec-reset-epoch'); }
    catch (_) {}
  };

  function activeProfile() {
    try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
    catch (_) { return null; }
  }

  function captureInstant(payload) {
    const candidates = [
      payload && payload.capturedAt,
      payload && payload.question && payload.question.capturadoEm,
      payload && payload.provenance && payload.provenance.capturedAt,
      payload && payload.receivedAt
    ];
    for (const raw of candidates) {
      if (!raw) continue;
      const t = Date.parse(String(raw));
      if (Number.isFinite(t)) return t;
    }
    return null;
  }

  function resetInstant(profileId) {
    try {
      const D = window.TecDataReset;
      if (!D || typeof D._getApplied !== 'function' || !profileId) return null;
      const raw = D._getApplied(profileId);
      const t = raw ? Date.parse(String(raw)) : NaN;
      return Number.isFinite(t) ? t : null;
    } catch (e) { quiet(e, 'tec-reset-epoch-read'); return null; }
  }

  function patch() {
    const R = window.TecRealtime;
    const D = window.TecDataReset;
    if (!R || !D || R.__resetEpochGuardPatched || typeof R.ingest !== 'function') return false;
    R.__resetEpochGuardPatched = true;

    const originalIngest = R.ingest.bind(R);
    R.ingest = function(payload, messageId) {
      const profileId = activeProfile();
      const epoch = resetInstant(profileId);
      const captured = captureInstant(payload);

      // Só descartamos quando há DUAS evidências temporais válidas. Payload sem
      // capturedAt nunca é presumido antigo, para não perder dado legítimo.
      if (epoch != null && captured != null && captured < epoch) {
        try { if (typeof this.ack === 'function') this.ack(messageId); } catch (e) { quiet(e, 'tec-reset-stale-ack'); }
        try {
          console.warn('[TEC reset] envelope anterior à limpeza descartado', {
            profileId,
            messageId:String(messageId || ''),
            capturedAt:new Date(captured).toISOString(),
            resetAt:new Date(epoch).toISOString()
          });
        } catch (_) {}
        return { ok:true, dropped:true, reason:'pre-reset-capture' };
      }
      return originalIngest(payload, messageId);
    };
    return true;
  }

  patch();
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (patch() || tries >= 120) clearInterval(timer);
  }, 250);
})();
