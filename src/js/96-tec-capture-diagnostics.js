/* ============================================================================
   DIAGNÓSTICO DA CAPTURA TEC
   Console observacional da integração Companion -> StudyNoMentor.
   Não interfere na captura. Mantém um ring buffer local, sem credenciais e sem
   conteúdo integral das questões, para permitir copiar o diagnóstico pelo site.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecCaptureDiagnostics) return;
  window.__tecCaptureDiagnostics = true;

  const EXT_SOURCE = 'StudyMentorCompanion';
  const KEY_SUFFIX = 'tec-capture-log-v1';
  const MAX_LOG = 300;
  let latest = null;
  let lastCaptureSig = '';
  let lastHealthSig = '';
  let lastRenderSig = '';
  let timer = null;

  const esc = (v) => typeof escapeHtml === 'function'
    ? escapeHtml(String(v == null ? '' : v))
    : String(v == null ? '' : v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const key = () => {
    try { return DB._profilePrefix() + KEY_SUFFIX; }
    catch (_) { return 'diario-estudos:' + KEY_SUFFIX; }
  };

  function readLog() {
    try {
      const parsed = JSON.parse(localStorage.getItem(key()) || '[]');
      return Array.isArray(parsed) ? parsed.slice(-MAX_LOG) : [];
    } catch (_) { return []; }
  }

  function writeLog(rows) {
    try {
      const raw = JSON.stringify((rows || []).slice(-MAX_LOG));
      if (typeof DB !== 'undefined' && DB.setRaw) DB.setRaw(key(), raw);
      else localStorage.setItem(key(), raw);
    } catch (error) {
      if (typeof _quiet === 'function') _quiet(error, 'tec-diagnostic-log-save');
    }
  }

  function pushLog(event, details = {}, level = 'info', source = 'site') {
    const rows = readLog();
    const row = { at:new Date().toISOString(), level, source, event, details };
    const prev = rows[rows.length - 1];
    const signature = JSON.stringify([source, event, details]);
    const prevSignature = prev ? JSON.stringify([prev.source, prev.event, prev.details]) : '';
    if (signature === prevSignature && prev && Date.now() - new Date(prev.at).getTime() < 2500) return;
    rows.push(row);
    writeLog(rows);
    render();
  }

  function statusText(last) {
    const status = String(last && last.status || 'idle');
    const reason = String(last && last.reason || '');
    if (status === 'queued') return ['Captura concluída', 'Evento persistido na fila da extensão.', 'ok'];
    if (status === 'staged') return ['Captura preservada', 'Evento salvo localmente e aguardando o service worker.', 'warn'];
    if (status === 'waiting-result') return ['Clique detectado', 'Aguardando o resultado do TEC.', 'wait'];
    if (status === 'deduplicated') return ['Duplicidade ignorada', 'A resolução já havia sido capturada há poucos segundos.', 'ok'];
    if (status === 'missed' && reason === 'question_id_not_detected') return ['ID não detectado', 'O clique foi visto, mas o ID da questão não foi identificado.', 'error'];
    if (status === 'missed' && reason === 'result_not_detected') return ['Resultado não detectado', 'O ID foi identificado, mas acerto/erro não apareceu nos sinais conhecidos.', 'error'];
    if (status === 'aborted' && reason === 'question_changed') return ['Questão mudou durante a captura', 'Captura abortada para não atribuir o resultado à questão errada.', 'warn'];
    return ['Aguardando resolução', 'Nenhuma tentativa concluída foi diagnosticada nesta sessão.', 'idle'];
  }

  function realtimeSnapshot() {
    try {
      const R = window.TecRealtime;
      const state = R && R.state ? R.state() : null;
      return {
        events: state && state.events ? Object.keys(state.events).length : 0,
        lastEventAt: state && state.lastEventAt || null,
        connection: state && state.connection ? {
          status:state.connection.status || null,
          queuePending:state.connection.queuePending || 0,
          queueDropped:state.connection.queueDropped || 0,
          lastSeenAt:state.connection.lastSeenAt || null
        } : null
      };
    } catch (_) { return { events:0, lastEventAt:null, connection:null }; }
  }

  function diagnosticPayload() {
    return {
      type:'StudyNoMentorTecCaptureDiagnostic',
      schema:1,
      generatedAt:new Date().toISOString(),
      page:location.href,
      companionVersion:latest && latest.version || null,
      latestCapture:latest && latest.capture || null,
      realtime:realtimeSnapshot(),
      log:readLog()
    };
  }

  async function copyDiagnostic() {
    const text = JSON.stringify(diagnosticPayload(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      if (typeof showToast === 'function') showToast('Log técnico TEC copiado ✓');
    } catch (error) {
      if (typeof _quiet === 'function') _quiet(error, 'tec-capture-diagnostic-copy');
      if (typeof showToast === 'function') showToast('Não foi possível copiar o log neste navegador.');
    }
  }

  function clearDiagnostic() {
    writeLog([]);
    lastCaptureSig = '';
    lastHealthSig = '';
    pushLog('log-cleared', {}, 'info', 'site');
  }

  function ensureBox() {
    const card = document.getElementById('tec-realtime-card');
    if (!card) return null;
    let box = document.getElementById('trt-capture-diagnostic');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'trt-capture-diagnostic';
    box.style.cssText = 'margin:0 28px 16px;padding:12px 14px;border:1px solid var(--border,#e5e7eb);border-radius:12px;font-size:12px;line-height:1.45;';
    box.innerHTML = `
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap">
        <div><b>Diagnóstico técnico da captura</b><div id="trt-diag-summary" style="margin-top:5px;opacity:.78">Aguardando heartbeat do TEC…</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn-secondary" id="trt-copy-diagnostic" style="padding:5px 8px;font-size:11px">Copiar log</button><button type="button" class="btn-secondary" id="trt-clear-diagnostic" style="padding:5px 8px;font-size:11px">Limpar log</button></div>
      </div>
      <div id="trt-diag-meta" style="margin-top:7px;opacity:.78"></div>
      <details id="trt-diag-details" style="margin-top:9px"><summary style="cursor:pointer;font-weight:700">Ver log cronológico</summary><pre id="trt-diag-log" style="margin:9px 0 0;max-height:280px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.4"></pre></details>`;
    const note = card.querySelector('#trt-note');
    if (note) note.insertAdjacentElement('beforebegin', box); else card.appendChild(box);
    box.querySelector('#trt-copy-diagnostic')?.addEventListener('click', copyDiagnostic);
    box.querySelector('#trt-clear-diagnostic')?.addEventListener('click', clearDiagnostic);
    return box;
  }

  function render() {
    const box = ensureBox();
    if (!box) return;
    const capture = latest && latest.capture || {};
    const last = capture.last || {};
    const [title, detail, tone] = statusText(last);
    const qid = last.questionId || capture.questionId || '—';
    const rt = realtimeSnapshot();
    const rows = readLog();
    const signature = JSON.stringify([latest, rt, rows.length, rows[rows.length-1]]);
    if (signature === lastRenderSig) return;
    lastRenderSig = signature;

    const toneColor = tone === 'ok' ? '#166534' : tone === 'error' ? '#991b1b' : tone === 'warn' ? '#92400e' : 'inherit';
    const summary = box.querySelector('#trt-diag-summary');
    if (summary) summary.innerHTML = latest
      ? `<span style="color:${toneColor}"><b>${esc(title)}</b></span> · ${esc(detail)}`
      : 'Aguardando heartbeat do TEC…';
    const meta = box.querySelector('#trt-diag-meta');
    if (meta) meta.innerHTML = `Companion: <b>v${esc(latest && latest.version || '—')}</b> · ID: <b>${esc(qid)}</b> · Resolver: <b>${capture.resolverVisible ? 'detectado' : 'não detectado'}</b> · MAIN: <b>${capture.mainWorldContext ? 'OK' : 'ausente'}</b> · Port: <b>${capture.portConnected === false ? 'desconectado' : capture.portConnected === true ? 'conectado' : '—'}</b> · Página: <b>${esc(capture.visibility || '—')}</b> · Radar: <b>${rt.events} evento(s)</b>`;
    const pre = box.querySelector('#trt-diag-log');
    if (pre) {
      pre.textContent = rows.slice(-120).map(r => {
        const time = new Date(r.at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        return `[${time}] ${String(r.level || 'info').toUpperCase()} ${r.source}/${r.event} ${JSON.stringify(r.details || {})}`;
      }).join('\n') || 'Nenhum evento técnico registrado ainda.';
    }
    const details = box.querySelector('#trt-diag-details');
    if (details) details.querySelector('summary').textContent = `Ver log cronológico (${rows.length})`;
  }

  function captureDetails(payload) {
    const c = payload && payload.capture || {};
    const last = c.last || {};
    return {
      version:payload && payload.version || null,
      questionId:last.questionId || c.questionId || null,
      resolverVisible:!!c.resolverVisible,
      mainWorldContext:!!c.mainWorldContext,
      portConnected:c.portConnected == null ? null : !!c.portConnected,
      visibility:c.visibility || null,
      lifecycle:c.lifecycle || null,
      status:last.status || 'idle',
      reason:last.reason || null,
      lastAt:last.at || null
    };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== EXT_SOURCE || Number(msg.protocol) !== 1) return;

    if ((msg.type === 'ready' || msg.type === 'status') && msg.payload && msg.payload.capture) {
      latest = { version:msg.payload.version || msg.extensionVersion || null, capture:msg.payload.capture, receivedAt:new Date().toISOString() };
      const details = captureDetails(msg.payload);
      const sig = JSON.stringify(details);
      if (sig !== lastCaptureSig) {
        lastCaptureSig = sig;
        const level = details.status === 'missed' ? 'error' : details.status === 'staged' || details.status === 'aborted' ? 'warn' : 'info';
        pushLog('capture-status', details, level, 'tec');
      }
      render();
      return;
    }

    if (msg.type === 'companion-ready') {
      pushLog('companion-ready', { version:msg.payload && msg.payload.version || null }, 'info', 'bridge');
      return;
    }
    if (msg.type === 'companion-disconnected') {
      pushLog('companion-disconnected', { reconnecting:!!(msg.payload && msg.payload.reconnecting), reason:msg.payload && msg.payload.reason || null }, 'warn', 'bridge');
      return;
    }
    if (msg.type === 'companion-health') {
      const details = { pending:Number(msg.payload && msg.payload.pending || 0), dropped:Number(msg.payload && msg.payload.dropped || 0), limit:Number(msg.payload && msg.payload.limit || 0) };
      const sig = JSON.stringify(details);
      if (sig !== lastHealthSig) { lastHealthSig = sig; pushLog('queue-health', details, details.pending || details.dropped ? 'warn' : 'info', 'worker'); }
      return;
    }
    if (msg.type === 'resolution') {
      const r = msg.payload && msg.payload.resolution || {};
      pushLog('resolution-received', { eventId:r.eventId || msg.messageId || null, questionId:r.questionId || null, acertou:typeof r.acertou === 'boolean' ? r.acertou : null, bookId:r.bookId || null }, 'info', 'bridge');
      setTimeout(() => {
        const rt = realtimeSnapshot();
        pushLog('radar-after-resolution', rt, rt.lastEventAt ? 'info' : 'warn', 'site');
      }, 120);
    }
  });

  window.addEventListener('screen:activated', (event) => {
    if (event.detail && event.detail.screen === 'integracaotec') render();
  });

  const start = () => {
    pushLog('diagnostic-panel-ready', { page:location.pathname }, 'info', 'site');
    render();
    if (!timer) timer = setInterval(() => { if (document.getElementById('tec-realtime-card')) render(); }, 2000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
