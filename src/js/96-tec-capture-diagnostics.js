/* ============================================================================
   DIAGNÓSTICO DA CAPTURA TEC
   Torna visível no StudyNoMentor o heartbeat técnico que o Companion já envia.
   Não interfere na captura; apenas mostra em qual etapa a última tentativa parou.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecCaptureDiagnostics) return;
  window.__tecCaptureDiagnostics = true;

  const EXT_SOURCE = 'StudyMentorCompanion';
  let latest = null;
  let observer = null;

  const esc = (v) => typeof escapeHtml === 'function'
    ? escapeHtml(String(v == null ? '' : v))
    : String(v == null ? '' : v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  function statusText(last) {
    const status = String(last && last.status || 'idle');
    const reason = String(last && last.reason || '');
    if (status === 'queued') return ['Captura concluída', 'O evento foi persistido na fila da extensão.', 'ok'];
    if (status === 'staged') return ['Captura preservada', 'O evento está salvo localmente e aguarda o service worker.', 'warn'];
    if (status === 'waiting-result') return ['Clique detectado', 'A extensão está aguardando o resultado do TEC.', 'wait'];
    if (status === 'missed' && reason === 'question_id_not_detected') return ['ID não detectado', 'O clique foi visto, mas o ID da questão não pôde ser identificado.', 'error'];
    if (status === 'missed' && reason === 'result_not_detected') return ['Resultado não detectado', 'O ID foi identificado, mas o estado de acerto/erro não apareceu nos sinais conhecidos.', 'error'];
    if (status === 'aborted' && reason === 'question_changed') return ['Questão mudou durante a captura', 'O Companion abortou para não atribuir o resultado à questão errada.', 'warn'];
    return ['Aguardando resolução', 'Nenhuma tentativa concluída foi diagnosticada nesta sessão ainda.', 'idle'];
  }

  function ensureBox() {
    const card = document.getElementById('tec-realtime-card');
    if (!card) return null;
    let box = document.getElementById('trt-capture-diagnostic');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'trt-capture-diagnostic';
    box.style.cssText = 'margin:0 28px 16px;padding:12px 14px;border:1px solid var(--border,#e5e7eb);border-radius:12px;font-size:12px;line-height:1.45;';
    const note = card.querySelector('#trt-note');
    if (note) note.insertAdjacentElement('beforebegin', box);
    else card.appendChild(box);
    return box;
  }

  function render() {
    const box = ensureBox();
    if (!box) return;
    if (!latest) {
      box.innerHTML = '<b>Diagnóstico da captura</b><div style="margin-top:4px;opacity:.75">Aguardando heartbeat do TEC…</div>';
      return;
    }
    const capture = latest.capture || {};
    const last = capture.last || {};
    const [title, detail, tone] = statusText(last);
    const toneColor = tone === 'ok' ? '#166534' : tone === 'error' ? '#991b1b' : tone === 'warn' ? '#92400e' : 'inherit';
    const qid = last.questionId || capture.questionId || '—';
    const when = last.at ? new Date(last.at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—';
    box.innerHTML = `<div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap"><div><b>Diagnóstico da captura · Companion v${esc(latest.version || '—')}</b><div style="margin-top:5px;color:${toneColor}"><b>${esc(title)}</b> · ${esc(detail)}</div></div><button type="button" class="btn-secondary" id="trt-copy-diagnostic" style="padding:5px 8px;font-size:11px">Copiar diagnóstico</button></div><div style="margin-top:7px;opacity:.78">ID: <b>${esc(qid)}</b> · Resolver: <b>${capture.resolverVisible ? 'detectado' : 'não detectado'}</b> · Contexto MAIN: <b>${capture.mainWorldContext ? 'OK' : 'ausente'}</b> · Último evento: <b>${esc(when)}</b></div>`;
    const copy = box.querySelector('#trt-copy-diagnostic');
    if (copy) copy.addEventListener('click', async () => {
      const payload = JSON.stringify({ extensionVersion: latest.version || null, capture }, null, 2);
      try {
        await navigator.clipboard.writeText(payload);
        if (typeof showToast === 'function') showToast('Diagnóstico da captura copiado ✓');
      } catch (error) {
        if (typeof _quiet === 'function') _quiet(error, 'tec-capture-diagnostic-copy');
      }
    }, { once:true });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== EXT_SOURCE || Number(msg.protocol) !== 1) return;
    if ((msg.type !== 'ready' && msg.type !== 'status') || !msg.payload || !msg.payload.capture) return;
    latest = { version: msg.payload.version || msg.extensionVersion || null, capture: msg.payload.capture, receivedAt: new Date().toISOString() };
    render();
  });

  const start = () => {
    render();
    if (observer || !document.documentElement) return;
    observer = new MutationObserver(() => render());
    observer.observe(document.documentElement, { childList:true, subtree:true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
