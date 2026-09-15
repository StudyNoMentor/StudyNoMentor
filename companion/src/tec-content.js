/* Captura de resoluções do TecConcursos para o StudyNoMentor Companion.
 * Não lê credenciais nem envia tokens. A identidade TEC é um fingerprint local
 * de identificadores/labels visíveis, nunca o valor bruto de autenticação.
 */
'use strict';

(() => {
  if (window.__snmTecCompanion) return;
  window.__snmTecCompanion = true;

  const EXT_SOURCE = 'StudyMentorCompanion';
  const VERSION = chrome.runtime.getManifest().version;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let port = null;
  let reconnectMs = 500;
  let pending = null;
  let processing = false;
  let lastFingerprint = '';
  let lastFingerprintAt = 0;

  const text = (el) => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = (el) => !!(el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed'));
  const escRx = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const uid = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  function fnv(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function localDate(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function currentBookId() {
    const m = location.pathname.match(/\/questoes\/cadernos\/(\d+)/i);
    return m ? m[1] : '';
  }

  function accountFingerprint() {
    const ids = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (!/(usuario|user|account|conta|perfil|profile)/i.test(k)) continue;
        const v = String(localStorage.getItem(k) || '').slice(0, 3000);
        const re = /"(?:idUsuario|usuarioId|userId|id_user|id)"\s*:\s*"?([A-Za-z0-9_-]{2,80})/gi;
        let m; let n = 0;
        while ((m = re.exec(v)) && n++ < 3) ids.push(`${k}:${m[1]}`);
      }
    } catch (_) {}
    const labels = [];
    for (const sel of ['[class*="usuario" i]', '[class*="perfil" i]', '[class*="profile" i]', 'a[href*="logout" i]', 'button[aria-label*="perfil" i]']) {
      for (const el of [...document.querySelectorAll(sel)].slice(0, 5)) {
        const t = text(el);
        if (visible(el) && t && t.length < 120) labels.push(t);
      }
    }
    const seed = [...new Set(ids)].sort().join('|') || [...new Set(labels)].sort().join('|') || 'tec-session';
    return 'tec_' + fnv(seed);
  }

  function questionId() {
    for (const el of document.querySelectorAll('[data-question-id],[data-questao-id],[data-id-questao],[data-idquestao]')) {
      for (const a of ['data-question-id','data-questao-id','data-id-questao','data-idquestao']) {
        const v = el.getAttribute(a); if (v && /^\d+$/.test(v)) return v;
      }
    }
    for (const el of [...document.querySelectorAll('a[href],a[aria-label],button[aria-label],h1,h2,h3,strong')].slice(0, 500)) {
      if (!visible(el)) continue;
      const hay = [el.getAttribute && el.getAttribute('href'), el.getAttribute && el.getAttribute('aria-label'), text(el)].join(' ');
      const m = hay.match(/(?:\/questoes\/|quest[aã]o\s*#?\s*|#)(\d{4,})/i);
      if (m) return m[1];
    }
    return null;
  }

  function firstVisible(selectors) {
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) if (visible(el) && text(el)) return el;
    }
    return null;
  }

  function matter() {
    return text(firstVisible(['a[ng-href*="/materias/"]','a[href*="/materias/"]','[data-eq-slot="materia"]','[class*="materia" i]']));
  }

  function topic() {
    return text(firstVisible(['span[ng-bind*="Assunto"]','[data-eq-slot="assunto"]','[class*="assunto" i]']));
  }

  function metadataLink(kind) {
    const el = firstVisible([`a[href*="/${kind}/"]`]);
    return text(el);
  }

  function alternativeLetter(el) {
    if (!el) return null;
    const direct = el.getAttribute && (el.getAttribute('data-letter') || el.getAttribute('data-letra') || el.getAttribute('value'));
    if (direct && /^[A-E]$/i.test(String(direct).trim())) return String(direct).trim().toUpperCase();
    const t = text(el);
    const m = t.match(/^\s*([A-E])(?:\s*[\)\.\-:]|\s{1,})/i);
    return m ? m[1].toUpperCase() : null;
  }

  function isSelected(el) {
    if (!el) return false;
    if (el.matches && el.matches('input:checked')) return true;
    if (el.querySelector && el.querySelector('input:checked')) return true;
    if (String(el.getAttribute && el.getAttribute('aria-checked')).toLowerCase() === 'true') return true;
    if (String(el.getAttribute && el.getAttribute('aria-pressed')).toLowerCase() === 'true') return true;
    return /(?:^|\s)(?:selected|selecionad[ao]|marcad[ao]|checked|active)(?:\s|$)/i.test(String(el.className || ''));
  }

  function isCorrect(el) {
    const cl = String(el && el.className || '');
    const aria = String(el && el.getAttribute && el.getAttribute('aria-label') || '');
    return /(?:wk7j7j|corret[ao]|correct|success|certa)(?:\s|$|_|-)/i.test(cl + ' ' + aria)
      || !!(el && el.querySelector && el.querySelector('.glyphicon-ok-sign,.fa-check,[class*="correct" i],[class*="corret" i]'));
  }

  function isWrongMarked(el) {
    const cl = String(el && el.className || '');
    return /(?:incorrect|errad[ao]|danger|wrong)(?:\s|$|_|-)/i.test(cl)
      || !!(el && el.querySelector && el.querySelector('.glyphicon-remove,.fa-times,[class*="incorrect" i],[class*="errad" i]'));
  }

  function alternatives() {
    const map = new Map();
    const nodes = [...document.querySelectorAll('label,button,[role="radio"],li')].slice(0, 800);
    for (const node of nodes) {
      if (!visible(node)) continue;
      const letra = alternativeLetter(node);
      if (!letra || map.has(letra)) continue;
      const raw = text(node); if (raw.length < 2 || raw.length > 2500) continue;
      const texto = raw.replace(new RegExp('^\\s*' + escRx(letra) + '\\s*(?:[\\)\\.\\-:]|\\s+)\\s*','i'), '').trim();
      map.set(letra, { letra, texto, selected: isSelected(node), correct: isCorrect(node), wrong: isWrongMarked(node) });
    }
    return [...map.values()].sort((a,b) => a.letra.localeCompare(b.letra)).slice(0, 5);
  }

  function statement() {
    const el = firstVisible(['[data-eq-slot="enunciado"]','[data-testid*="enunciado" i]','[class*="enunciado" i]','[id*="enunciado" i]','[class*="statement" i]']);
    const t = text(el); return t.length >= 10 ? t : '';
  }

  function result() {
    const candidates = [...document.querySelectorAll('.jm44ow,[class*="resultado" i],[class*="feedback" i],[role="alert"]')].filter(visible).slice(0, 80);
    for (const el of candidates) {
      const t = text(el).toLowerCase();
      if (el.querySelector('.glyphicon-ok-sign') || /você acertou|voce acertou|resposta correta|parabéns.*acert/i.test(t)) return { acertou: true, text: t };
      if (el.querySelector('.glyphicon-remove') || /você errou|voce errou|resposta incorreta|resposta errada/i.test(t)) return { acertou: false, text: t };
    }
    return null;
  }

  function buildQuestion(acertou, selectedBefore) {
    const alts = alternatives();
    let marcada = (alts.find(a => a.selected) || {}).letra || selectedBefore || null;
    const correta = (alts.find(a => a.correct) || {}).letra || null;
    if (acertou === true && correta && !marcada) marcada = correta;
    return {
      id: questionId(), cadernoId: currentBookId(),
      materia: matter(), assunto: topic(), banca: metadataLink('bancas'), concurso: metadataLink('concursos'),
      enunciado: statement(),
      alternativas: alts.map(a => ({ letra: a.letra, texto: a.texto, correta: !!a.correct, marcadaPorMim: a.letra === marcada })),
      marcada, correta, acertou,
      url: location.href
    };
  }

  function envelope(type, payload, messageId) {
    return {
      source: EXT_SOURCE,
      protocol: 1,
      extensionVersion: VERSION,
      type,
      messageId: messageId || `${type}_${uid()}`,
      createdAtMs: Date.now(),
      payload: payload || {}
    };
  }

  function send(env) {
    try { port && port.postMessage({ envelope: env }); return true; }
    catch (_) { return false; }
  }

  function sendReady(type = 'ready') {
    send(envelope(type, {
      tecAccount: accountFingerprint(),
      bookId: currentBookId(),
      url: location.href,
      capturedAt: new Date().toISOString(),
      localDate: localDate(),
      embedded: window.top !== window.self
    }));
  }

  function connect() {
    try { port = chrome.runtime.connect({ name: 'snm-tec-v1' }); }
    catch (_) { setTimeout(connect, reconnectMs); reconnectMs = Math.min(10000, reconnectMs * 2); return; }
    reconnectMs = 500;
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(10000, reconnectMs * 2);
    });
    sendReady('ready');
  }

  async function processPending(token) {
    if (processing || !pending || pending.token !== token) return;
    processing = true;
    const tx = { ...pending };
    try {
      for (let i = 0; i < 70; i++) {
        if (!pending || pending.token !== token) return;
        if (questionId() && tx.qid && String(questionId()) !== String(tx.qid)) { pending = null; return; }
        const r = result();
        if (!r) { await sleep(75); continue; }
        const q = buildQuestion(r.acertou, tx.selectedBefore);
        if (!q.id) { await sleep(75); continue; }
        const now = new Date();
        const fp = [accountFingerprint(), currentBookId(), q.id, r.acertou, q.marcada || '', q.correta || ''].join('|');
        if (fp === lastFingerprint && Date.now() - lastFingerprintAt < 3500) { pending = null; return; }
        lastFingerprint = fp; lastFingerprintAt = Date.now();
        const eventId = 'res_' + uid();
        const resolution = {
          eventId,
          questionId: String(q.id),
          tecAccount: accountFingerprint(),
          bookId: currentBookId(),
          resolvedAt: now.toISOString(),
          localDate: localDate(now),
          timezoneOffsetMinutes: now.getTimezoneOffset(),
          acertou: !!r.acertou,
          marcada: q.marcada || null,
          correta: q.correta || null,
          materia: q.materia || '', assunto: q.assunto || '', banca: q.banca || '', concurso: q.concurso || '',
          source: 'companion-live'
        };
        send(envelope('resolution', {
          resolution, question: q,
          tecAccount: resolution.tecAccount,
          bookId: resolution.bookId,
          capturedAt: resolution.resolvedAt
        }, eventId));
        pending = null;
        return;
      }
      pending = null;
    } finally { processing = false; }
  }

  function resolverButton(target) {
    const b = target && target.closest ? target.closest('button,a') : null;
    if (!b) return null;
    return /^(?:Resolver\s+quest[aã]o|Responder|Confirmar\s+resposta)$/i.test(text(b)) ? b : null;
  }

  document.addEventListener('click', (event) => {
    if (!resolverButton(event.target)) return;
    const qid = questionId();
    if (!qid) return;
    const selected = (alternatives().find(a => a.selected) || {}).letra || null;
    pending = { token: uid(), qid: String(qid), selectedBefore: selected, startedAt: Date.now() };
    setTimeout(() => processPending(pending && pending.token), 50);
  }, true);

  let mutationTimer = null;
  function installObserver() {
    if (!document.body) return;
    new MutationObserver(() => {
      if (!pending || processing) return;
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => processPending(pending && pending.token), 45);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','aria-checked','aria-pressed'] });
  }

  connect();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installObserver, { once: true });
  else installObserver();
  setInterval(() => sendReady('status'), 15000);
})();
