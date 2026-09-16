/* StudyNoMentor Companion — guarda de integridade da resolução TEC.
 *
 * Executa ANTES do capturador principal e normaliza cada envelope de resolução
 * imediatamente antes de ir para o staging/fila. A regra central é simples:
 * "Resposta correta: C" informa o GABARITO, não que o aluno acertou.
 * Quando resposta marcada e gabarito estão disponíveis, o resultado é derivado
 * da comparação entre ambos e prevalece sobre banners/estilos ambíguos.
 */
'use strict';

(() => {
  if (window.__snmTecIntegrityGuard) return;
  window.__snmTecIntegrityGuard = true;

  const PAGE_SOURCE = 'StudyMentorTecPage';
  const STAGE_PREFIX = 'snmTecStageV1:';
  const selectedByQuestion = new Map();
  let pageContext = null;

  const text = el => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = el => {
    try { return !!(el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')); }
    catch (_) { return !!el; }
  };
  const strictBool = value => {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    if (['true','1','sim','s','yes','y','correta','correto'].includes(v)) return true;
    if (['false','0','nao','não','n','no','errada','errado'].includes(v)) return false;
    return null;
  };
  const letter = value => {
    const m = String(value == null ? '' : value).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);
    return m ? m[1] : null;
  };
  const nodeLetter = el => {
    if (!el) return null;
    const direct = el.getAttribute && (el.getAttribute('data-letter') || el.getAttribute('data-letra') || el.getAttribute('value'));
    if (direct && /^[A-E]$/i.test(String(direct).trim())) return String(direct).trim().toUpperCase();
    const m = text(el).match(/^\s*([A-E])(?:\s*[\)\.\-:]|\s{1,})/i);
    return m ? m[1].toUpperCase() : null;
  };
  const classHay = el => String(el && el.className || '') + ' ' + String(el && el.getAttribute && el.getAttribute('aria-label') || '');
  const nodeSelected = el => !!(el && (
    (el.matches && el.matches('input:checked')) ||
    (el.querySelector && el.querySelector('input:checked')) ||
    String(el.getAttribute && el.getAttribute('aria-checked')).toLowerCase() === 'true' ||
    String(el.getAttribute && el.getAttribute('aria-pressed')).toLowerCase() === 'true' ||
    /(?:^|\s)(?:selected|selecionad[ao]|marcad[ao]|checked|active)(?:\s|$)/i.test(String(el.className || ''))
  ));
  const nodeCorrect = el => /(?:wk7j7j|corret[ao]|correct|success|certa)(?:\s|$|_|-)/i.test(classHay(el)) ||
    !!(el && el.querySelector && el.querySelector('.glyphicon-ok-sign,.fa-check,[class*="correct" i],[class*="corret" i]'));
  const nodeWrong = el => /(?:bz2gcz|incorrect|errad[ao]|danger|wrong)(?:\s|$|_|-)/i.test(classHay(el)) ||
    !!(el && el.querySelector && el.querySelector('.glyphicon-remove,.fa-times,[class*="incorrect" i],[class*="errad" i]'));

  function questionId() {
    for (const el of document.querySelectorAll('[data-question-id],[data-questao-id],[data-id-questao],[data-idquestao]')) {
      for (const a of ['data-question-id','data-questao-id','data-id-questao','data-idquestao']) {
        const v = el.getAttribute(a); if (v && /^\d+$/.test(v)) return String(v);
      }
    }
    if (pageContext && pageContext.id) return String(pageContext.id);
    const body = String(location.href) + ' ' + String(document.body && document.body.innerText || '').slice(0, 6000);
    const m = body.match(/(?:\/questoes\/|quest[aã]o\s*#?\s*|\bID\s*[:#]?\s*)(\d{4,})/i);
    return m ? m[1] : null;
  }

  function domAlternatives() {
    const map = new Map();
    const nodes = [...document.querySelectorAll('label,button,[role="radio"],li,[data-letter],[data-letra],.wk7j7j,.bz2gcz')].slice(0, 1400);
    for (const node of nodes) {
      if (!visible(node)) continue;
      const l = nodeLetter(node); if (!l || map.has(l)) continue;
      const raw = text(node); if (raw.length < 2 || raw.length > 2500) continue;
      map.set(l, { letra:l, texto:raw.replace(new RegExp('^\\s*'+l+'\\s*(?:[\\)\\.\\-:]|\\s+)\\s*','i'),'').trim(),
        selected:nodeSelected(node), correct:nodeCorrect(node), wrong:nodeWrong(node), source:'dom' });
    }
    return [...map.values()];
  }

  function normalizedAlternatives(question) {
    const by = new Map();
    const add = (a, source) => {
      if (!a) return;
      const l = letter(a.letra || a.label || a.alternativa || a.value); if (!l) return;
      const old = by.get(l) || { letra:l, texto:'', selected:false, correct:false, wrong:false, sources:[] };
      const selected = strictBool(a.selected ?? a.marcada ?? a.marcadaPorMim ?? a.selecionada);
      const correct = strictBool(a.correct ?? a.correta ?? a.gabarito ?? a.isCorrect);
      const wrong = strictBool(a.wrong ?? a.errada ?? a.incorrect);
      const texto = String(a.texto || a.text || a.descricao || '').trim();
      if (!old.texto && texto) old.texto = texto;
      if (selected === true) old.selected = true;
      if (correct === true) old.correct = true;
      if (wrong === true) old.wrong = true;
      if (source && !old.sources.includes(source)) old.sources.push(source);
      by.set(l, old);
    };
    for (const a of (question && question.alternativas) || []) add(a, 'payload');
    for (const a of (pageContext && pageContext.alternativas) || []) add(a, 'main-world');
    for (const a of domAlternatives()) add(a, 'dom');
    return [...by.values()].sort((a,b) => a.letra.localeCompare(b.letra));
  }

  function bannerEvidence() {
    const nodes = [...document.querySelectorAll('.jm44ow,[class*="resultado" i],[class*="feedback" i],[role="alert"],[class*="gabarito" i]')]
      .filter(visible).slice(0, 160);
    let explicitResult = null, correct = null, marked = null, raw = '';
    for (const el of nodes) {
      const t = text(el); if (!t) continue;
      const low = t.toLowerCase(); raw += (raw ? ' | ' : '') + t.slice(0, 400);
      if (/você\s+errou|voce\s+errou|resposta\s+(?:incorreta|errada)|sua\s+resposta\s+está\s+errada/i.test(low)) explicitResult = false;
      else if (/você\s+acertou|voce\s+acertou|parab[eé]ns[^.]{0,80}acert/i.test(low)) explicitResult = true;
      /* IMPORTANTE: "resposta correta" só extrai a letra do gabarito. */
      const cm = t.match(/(?:gabarito|resposta\s+correta|alternativa\s+correta)\s*(?:é|:|\-|=)?\s*\(?\s*([A-E])\b/i);
      if (cm) correct = cm[1].toUpperCase();
      const mm = t.match(/(?:sua\s+resposta|resposta\s+marcada|voc[eê]\s+marcou)\s*(?:foi|:|\-|=)?\s*\(?\s*([A-E])\b/i);
      if (mm) marked = mm[1].toUpperCase();
    }
    return { explicitResult, correct, marked, raw:raw.slice(0, 1200) };
  }

  function normalizeEnvelope(env) {
    if (!env || env.type !== 'resolution' || !env.payload) return env;
    const payload = env.payload;
    const resolution = payload.resolution || (payload.resolution = {});
    const question = payload.question || (payload.question = {});
    const qid = String(resolution.questionId || question.id || questionId() || '').trim();
    const alts = normalizedAlternatives(question);
    const banner = bannerEvidence();

    let marked = letter(resolution.marcada) || letter(question.marcada) || (qid && selectedByQuestion.get(qid)) ||
      ((alts.find(a => a.selected) || {}).letra) || banner.marked || null;
    let correct = letter(resolution.correta) || letter(question.correta) || ((alts.find(a => a.correct) || {}).letra) || banner.correct || null;

    const reported = typeof resolution.acertou === 'boolean' ? resolution.acertou : (typeof question.acertou === 'boolean' ? question.acertou : null);
    let canonical = null, confidence = 'low', source = 'reported-only';
    if (marked && correct) {
      canonical = marked === correct;
      confidence = 'high'; source = 'marked-vs-gabarito';
    } else if (typeof banner.explicitResult === 'boolean') {
      canonical = banner.explicitResult;
      confidence = 'medium'; source = 'explicit-result-banner';
    } else if (typeof reported === 'boolean') {
      canonical = reported;
      confidence = 'low'; source = 'legacy-reported';
    }
    const conflict = typeof reported === 'boolean' && typeof canonical === 'boolean' && reported !== canonical;

    if (qid) { resolution.questionId = qid; question.id = question.id || qid; }
    if (marked) { resolution.marcada = marked; question.marcada = marked; }
    if (correct) { resolution.correta = correct; question.correta = correct; }
    if (typeof canonical === 'boolean') { resolution.acertou = canonical; question.acertou = canonical; }

    if (alts.length) {
      question.alternativas = alts.map(a => ({ letra:a.letra, texto:a.texto,
        correta:correct ? a.letra === correct : !!a.correct,
        marcadaPorMim:marked ? a.letra === marked : !!a.selected }));
    }

    const evidence = {
      schema:2, status:confidence === 'low' ? 'unverified' : 'verified', confidence, source,
      marked:marked || null, correct:correct || null, canonicalResult:canonical,
      reportedResult:reported, conflict, bannerResult:banner.explicitResult,
      bannerCorrect:banner.correct || null, bannerText:banner.raw || null,
      alternativesCaptured:alts.length, normalizedAt:new Date().toISOString()
    };
    resolution.integrity = evidence;
    question.integrity = evidence;
    payload.integrity = evidence;
    return env;
  }

  function rememberSelection(target) {
    const control = target && target.closest ? target.closest('label,button,[role="radio"],input[type="radio"],[data-letter],[data-letra],li') : null;
    if (!control) return;
    const l = nodeLetter(control) || nodeLetter(control.closest && control.closest('label,[role="radio"],li'));
    if (!l) return;
    const id = questionId(); if (id) selectedByQuestion.set(String(id), l);
  }
  document.addEventListener('click', e => rememberSelection(e.target), true);
  document.addEventListener('change', e => rememberSelection(e.target), true);

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== PAGE_SOURCE || msg.type !== 'question-context') return;
    pageContext = msg.context || msg.payload || null;
    if (!pageContext) return;
    const id = String(pageContext.id || '');
    const marked = ((pageContext.alternativas || []).find(a => strictBool(a.selected ?? a.marcada ?? a.marcadaPorMim) === true) || {}).letra;
    if (id && marked) selectedByQuestion.set(id, letter(marked));
  });

  /* Normaliza ANTES do envio ao worker. */
  try {
    const nativeSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function(message, ...rest) {
      try { if (message && message.kind === 'capture' && message.envelope) normalizeEnvelope(message.envelope); } catch (_) {}
      return nativeSendMessage(message, ...rest);
    };
  } catch (_) {}

  /* O capturador mantém staging local antes de acordar o worker. Também
     normalizamos a cópia staged para que um reload/offline nunca ressuscite
     o dado pré-correção. */
  try {
    const nativeSet = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = function(items, ...rest) {
      try {
        if (items && typeof items === 'object') {
          for (const [k, value] of Object.entries(items)) {
            if (k.startsWith(STAGE_PREFIX) && value && value.type === 'resolution') normalizeEnvelope(value);
          }
        }
      } catch (_) {}
      return nativeSet(items, ...rest);
    };
  } catch (_) {}

  window.__snmTecIntegrity = { normalizeEnvelope, bannerEvidence, normalizedAlternatives, strictBool };
})();
