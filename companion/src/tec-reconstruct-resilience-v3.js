/* StudyNoMentor Companion — resiliência por questão na reconstrução TEC v3.
 *
 * Carrega depois do backpressure v2 e antes do runner. Quando o runner produz
 * uma linha de falha (question:null), tenta recuperar a MESMA questão antes de
 * o lote ser persistido. Assim um timeout/layout transitório do TEC não vira
 * uma lacuna permanente no StudyNoMentor.
 *
 * Regras:
 * - a linha de falha nunca é enviada antes de esgotar os retries;
 * - a questão recuperada precisa provar o mesmo ID;
 * - não inventa matéria/assunto/gabarito: usa snapshot MAIN + DOM factual;
 * - falha definitiva conserva motivo e tentativas no resumo final;
 * - o resumo enviado ao Study desconta falhas recuperadas.
 */
'use strict';

(() => {
  if (window.top !== window.self) return;
  if (!/(?:^#|[&#])snm-reconstruct=/.test(String(location.hash || ''))) return;
  if (globalThis.__snmTecReconstructResilienceV3) return;
  globalThis.__snmTecReconstructResilienceV3 = true;

  const underlyingSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  const PAGE_SOURCE = 'StudyMentorTecReconstructPage';
  const PAGE_REQUEST_SOURCE = 'StudyMentorTecReconstructIsolated';
  const MAX_RECOVERY_ATTEMPTS = 3;
  const MAX_LOAD_MORE = 220;
  const recovered = new Map();
  const unresolvedFailures = new Map();
  const retriedIds = new Set();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = el => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = el => {
    try { return !!(el && el.isConnected !== false && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')); }
    catch (_) { return !!el; }
  };
  const letter = value => {
    const m = String(value == null ? '' : value).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);
    return m ? m[1] : null;
  };

  async function waitFor(fn, timeout = 8000, interval = 120) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try {
        const value = await fn();
        if (value) return value;
      } catch (_) {}
      await sleep(interval);
    }
    return null;
  }

  function currentQuestionId() {
    for (const el of [...document.querySelectorAll('[data-question-id],[data-questao-id],[data-id-questao],[data-idquestao],a[href],h1,h2,h3,strong')].slice(0,1200)) {
      if (!visible(el)) continue;
      for (const attr of ['data-question-id','data-questao-id','data-id-questao','data-idquestao']) {
        const v = el.getAttribute?.(attr);
        if (v && /^\d+$/.test(v)) return String(v);
      }
      const hay = [el.getAttribute?.('href'), text(el)].join(' ');
      const m = hay.match(/(?:\/questoes\/|quest[aã]o\s*#?\s*|#)(\d{4,})/i);
      if (m) return String(m[1]);
    }
    return null;
  }

  function requestSnapshot(questionId, timeoutMs = 2600) {
    return new Promise(resolve => {
      const token = `retry_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(value || null);
      };
      const onMessage = event => {
        if (event.source !== window || event.origin !== location.origin) return;
        const msg = event.data;
        if (!msg || msg.source !== PAGE_SOURCE || msg.type !== 'reconstruction-snapshot' || msg.requestId !== token) return;
        finish(msg.data || null);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      window.addEventListener('message', onMessage);
      window.postMessage({
        source:PAGE_REQUEST_SOURCE,
        type:'reconstruction-snapshot-request',
        requestId:token,
        questionId:String(questionId || '')
      }, location.origin);
    });
  }

  function gabaritoTab() {
    return [...document.querySelectorAll('.aba-navegacao')].find(el => text(el) === 'Gabarito') || null;
  }

  async function waitStableTable() {
    let previous = '', stable = 0;
    for (let i = 0; i < 32; i++) {
      const signature = [...document.querySelectorAll('table.tabela-gabaritos tbody tr.questao')]
        .map(row => row.querySelector('td.id-questao a[href*="/questoes/"]')?.getAttribute('href') || '').join('|');
      if (signature === previous) stable++; else { previous = signature; stable = 0; }
      if (stable >= 3) return true;
      await sleep(120);
    }
    return false;
  }

  async function openResolvedGabarito() {
    const tab = gabaritoTab();
    if (!tab) throw new Error('A aba Gabarito não foi encontrada no retry.');
    if (!tab.classList.contains('selecionada')) tab.click();
    const table = await waitFor(() => document.querySelector('table.tabela-gabaritos'), 9000, 100);
    if (!table) throw new Error('A tabela de Gabarito não reapareceu no retry.');

    let option = [...document.querySelectorAll('.dropdown-menu li a')].find(el => text(el) === 'Resolvidas') || null;
    if (!option) {
      for (const toggle of document.querySelectorAll('.dropdown-toggle')) {
        toggle.click();
        await sleep(80);
        option = [...document.querySelectorAll('.dropdown-menu li a')].find(el => text(el) === 'Resolvidas') || null;
        if (option) break;
      }
    }
    if (!option) throw new Error('O filtro Resolvidas não foi encontrado no retry.');
    option.click();
    await sleep(260);
    await waitStableTable();
  }

  function loadMoreButton() {
    return [...document.querySelectorAll('a[role="button"],button')]
      .find(el => text(el) === 'Carregar mais' && visible(el) && !el.disabled) || null;
  }

  async function findRow(questionId) {
    const id = String(questionId || '');
    for (let i = 0; i < MAX_LOAD_MORE; i++) {
      const link = document.querySelector(`td.id-questao a[href$="/questoes/${id}"]`);
      if (link) return link.closest('tr.questao');
      const more = loadMoreButton();
      if (!more) {
        await waitStableTable();
        return document.querySelector(`td.id-questao a[href$="/questoes/${id}"]`)?.closest('tr.questao') || null;
      }
      const before = document.querySelectorAll('table.tabela-gabaritos tbody tr.questao').length;
      more.click();
      await waitFor(() => document.querySelector(`td.id-questao a[href$="/questoes/${id}"]`) ||
        document.querySelectorAll('table.tabela-gabaritos tbody tr.questao').length > before || !loadMoreButton(), 5500, 100);
    }
    return null;
  }

  function performanceButton() {
    return [...document.querySelectorAll('button,a,[role="button"]')].find(el => visible(el) &&
      /Desempenho\s+na\s+quest[aã]o|Meu\s+Desempenho/i.test(text(el) + ' ' + String(el.getAttribute?.('aria-label') || ''))) || null;
  }

  function contextFromDom(id) {
    const firstText = selectors => {
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const value = text(el);
          if (visible(el) && value) return value;
        }
      }
      return '';
    };
    const by = new Map();
    const nodes = [...document.querySelectorAll('label,button,[role="radio"],li,[data-letter],[data-letra],.wk7j7j,.bz2gcz')].slice(0,1800);
    for (const node of nodes) {
      if (!visible(node)) continue;
      const direct = node.getAttribute?.('data-letter') || node.getAttribute?.('data-letra') || node.getAttribute?.('value');
      let l = direct && /^[A-E]$/i.test(String(direct).trim()) ? String(direct).trim().toUpperCase() : null;
      if (!l) l = text(node).match(/^\s*([A-E])(?:\s*[\)\.\-:]|\s+)/i)?.[1]?.toUpperCase() || null;
      if (!l) continue;
      const classes = String(node.className || '');
      const aria = String(node.getAttribute?.('aria-label') || '');
      const selected = node.matches?.('input:checked') || !!node.querySelector?.('input:checked') ||
        String(node.getAttribute?.('aria-checked')).toLowerCase() === 'true' || /selected|selecionad|marcad|checked|active/i.test(classes);
      const correct = /wk7j7j|corret|correct|success|certa/i.test(classes + ' ' + aria) || !!node.querySelector?.('[class*="correct" i],[class*="corret" i]');
      const wrong = /bz2gcz|incorrect|errad|danger|wrong/i.test(classes) || !!node.querySelector?.('[class*="incorrect" i],[class*="errad" i]');
      const raw = text(node).replace(new RegExp('^\\s*' + l + '\\s*(?:[\\)\\.\\-:]|\\s+)\\s*', 'i'), '').trim();
      const old = by.get(l) || { letra:l, texto:'', selected:false, correct:false, wrong:false };
      if (!old.texto && raw && raw.length < 3000) old.texto = raw;
      old.selected ||= !!selected;
      old.correct ||= !!correct;
      old.wrong ||= !!wrong;
      by.set(l, old);
    }
    return {
      id:String(id),
      materia:firstText(['a[ng-href*="/materias/"]','a[href*="/materias/"]','[data-eq-slot="materia"]','[class*="materia" i]']),
      assunto:firstText(['span[ng-bind="vm.nomeAssuntoExibicao()"]','[data-eq-slot="assunto"]','[class*="assunto" i]']),
      banca:firstText(['a[href*="/bancas/"]']),
      concurso:firstText(['a[href*="/concursos/"]']),
      enunciado:firstText(['[data-eq-slot="enunciado"]','[data-testid*="enunciado" i]','[class*="enunciado" i]','[id*="enunciado" i]','[class*="statement" i]']),
      alternativas:[...by.values()].sort((a,b) => a.letra.localeCompare(b.letra)).slice(0,8),
      source:'dom-isolated-retry'
    };
  }

  function normalizeContext(snapshotContext, id) {
    const exact = snapshotContext && String(snapshotContext.id || '') === String(id) ? snapshotContext : null;
    const dom = contextFromDom(id);
    const base = exact || dom;
    const alternatives = new Map();
    for (const a of [...(exact?.alternativas || []), ...(dom.alternativas || [])]) {
      const l = letter(a && a.letra);
      if (!l) continue;
      const old = alternatives.get(l) || { letra:l, texto:'', selected:false, correct:false, wrong:false };
      if (!old.texto && a.texto) old.texto = String(a.texto);
      old.selected ||= a.selected === true || a.marcadaPorMim === true;
      old.correct ||= a.correct === true || a.correta === true;
      old.wrong ||= a.wrong === true || a.errada === true;
      alternatives.set(l, old);
    }
    return {
      id:String(id),
      materia:String(exact?.materia || dom.materia || ''),
      assunto:String(exact?.assunto || dom.assunto || ''),
      banca:String(exact?.banca || dom.banca || ''),
      concurso:String(exact?.concurso || dom.concurso || ''),
      enunciado:String(exact?.enunciado || dom.enunciado || ''),
      alternativas:[...alternatives.values()].sort((a,b) => a.letra.localeCompare(b.letra)),
      source:[exact?.source, dom.source].filter(Boolean).join('+') || base.source || 'retry'
    };
  }

  function normalizeHistory(history) {
    if (!history || !Number.isFinite(Number(history.total))) return null;
    return {
      total:Number(history.total),
      acertos:Number(history.acertos || 0),
      erros:Number(history.erros || 0),
      ultimoResultado:history.ultimoResultado || null,
      ultimaAlternativa:letter(history.ultimaAlternativa) || null,
      consistente:Number(history.acertos || 0) + Number(history.erros || 0) === Number(history.total),
      attempts:Array.isArray(history.attempts) ? history.attempts.map((a,index) => ({
        index:Number.isFinite(Number(a?.index)) ? Number(a.index) : index,
        acertou:a?.acertou === true,
        alternativa:letter(a?.alternativa),
        resolvedAt:a?.resolvedAt || null,
        source:a?.source || history.source || 'tec-performance'
      })) : [],
      fonte:`reconstrucao-retry:${history.source || 'tec'}`,
      confianca:'alta',
      reconstruidoEm:new Date().toISOString()
    };
  }

  async function recoverOnce(failedRow, attempt) {
    const id = String(failedRow?.questionId || '');
    if (!/^\d+$/.test(id)) throw new Error('Linha de falha sem ID de questão válido.');
    await openResolvedGabarito();
    const tableRow = await findRow(id);
    if (!tableRow) throw new Error(`Questão #${id} não reapareceu no Gabarito durante o retry.`);
    const open = tableRow.querySelector('td.num-questao a[role="button"],td.num-questao a,td.id-questao a[role="button"]');
    if (!open) throw new Error(`Questão #${id} não possui controle de abertura durante o retry.`);
    open.click();

    let preload = null;
    const loaded = await waitFor(async () => {
      if (String(currentQuestionId() || '') === id) return true;
      const snap = await requestSnapshot(id, 1100);
      if (snap?.context && String(snap.context.id || '') === id) { preload = snap; return true; }
      return false;
    }, 9000 + attempt * 2500, 220);
    if (!loaded) throw new Error(`Questão #${id} não terminou de abrir no retry ${attempt}.`);

    let snap = preload || await requestSnapshot(id, 3200);
    let history = snap?.history || null;
    if (!history || !Number.isFinite(Number(history.total))) {
      const perf = performanceButton();
      if (perf) {
        perf.click();
        await sleep(300 + attempt * 120);
        await waitFor(() => document.querySelector('canvas[aria-label^="Seu desempenho na questão"]') ||
          document.querySelector('.historico-resolucoes-aluno'), 3200, 100);
        snap = await requestSnapshot(id, 3200) || snap;
        history = snap?.history || history;
      }
    }

    const context = normalizeContext(snap?.context, id);
    if (String(currentQuestionId() || id) !== id && String(snap?.context?.id || '') !== id) {
      throw new Error(`O TEC exibiu outra questão quando era esperada #${id}.`);
    }
    const hasContextEvidence = !!(context.materia || context.assunto || context.banca || context.concurso || context.enunciado || context.alternativas.length);
    if (!hasContextEvidence) throw new Error(`Questão #${id} abriu, mas o TEC não expôs contexto factual suficiente para persistir com segurança.`);

    let correta = null, marcada = null;
    for (const a of context.alternativas) {
      if (a.correct === true) correta = letter(a.letra) || correta;
      if (a.selected === true || a.wrong === true) marcada = letter(a.letra) || marcada;
    }
    if (!marcada && history?.ultimaAlternativa) marcada = letter(history.ultimaAlternativa);
    const derived = marcada && correta ? marcada === correta : null;
    const reported = failedRow?.latest?.acertou;
    const verified = typeof derived === 'boolean' && typeof reported === 'boolean' && derived === reported;
    const normalizedHistory = normalizeHistory(history);

    const question = {
      ...context,
      cadernoId:String(failedRow?.bookId || ''),
      marcada:marcada || null,
      correta:correta || null,
      acertou:typeof reported === 'boolean' ? reported : null,
      dataResolucao:failedRow?.latest?.dataResolucao || null,
      capturadoEm:new Date().toISOString(),
      integrity:verified ? {
        schema:3,status:'verified',confidence:'high',source:'historical-marked-vs-gabarito-retry',
        marked:marcada,correct:correta,canonicalResult:derived,reportedResult:reported,
        conflict:false,conflictResolved:false,reconstructed:true,datePrecision:'day'
      } : {
        schema:3,status:'historical-aggregate',confidence:'medium',source:'tec-reconstruction-retry',
        marked:marcada,correct:correta,reportedResult:reported,reconstructed:true,datePrecision:'day'
      }
    };
    question.alternativas = context.alternativas.map(a => ({
      letra:letter(a.letra) || a.letra,
      texto:String(a.texto || ''),
      correta:!!correta && letter(a.letra) === correta,
      marcadaPorMim:!!marcada && letter(a.letra) === marcada
    }));

    return {
      questionId:id,
      bookId:String(failedRow?.bookId || ''),
      latest:{
        dataResolucao:failedRow?.latest?.dataResolucao || null,
        acertou:reported,
        marcada:marcada || null,
        correta:correta || null,
        verified
      },
      question,
      history:normalizedHistory,
      reconstruction:{
        source:'tec-caderno-retry-v3',
        recovered:true,
        retryAttempts:attempt,
        previousError:String(failedRow?.reconstruction?.error || ''),
        exactLatest:verified,
        aggregateHistory:!!normalizedHistory,
        attemptsWithDate:normalizedHistory ? normalizedHistory.attempts.filter(a => a.resolvedAt).length : 0
      }
    };
  }

  async function recoverFailure(row) {
    const id = String(row?.questionId || '');
    retriedIds.add(id);
    const attempts = [];
    for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
      try {
        const recoveredRow = await recoverOnce(row, attempt);
        recoveredRow.reconstruction.retryErrors = attempts.slice();
        return recoveredRow;
      } catch (error) {
        attempts.push({ attempt, at:new Date().toISOString(), error:String(error && error.message || error) });
        if (attempt < MAX_RECOVERY_ATTEMPTS) await sleep(450 * attempt + 350);
      }
    }
    const finalError = attempts.at(-1)?.error || String(row?.reconstruction?.error || 'Falha desconhecida');
    unresolvedFailures.set(id, {
      questionId:id,
      initialError:String(row?.reconstruction?.error || ''),
      finalError,
      attempts:attempts.slice()
    });
    return {
      ...row,
      reconstruction:{
        ...(row?.reconstruction || {}),
        source:'tec-caderno-retry-v3',
        recovered:false,
        retryAttempts:MAX_RECOVERY_ATTEMPTS,
        retryErrors:attempts,
        error:finalError
      }
    };
  }

  function isFailedRow(row) {
    return !!(row && row.questionId && !row.question && row.reconstruction && row.reconstruction.error);
  }

  function adjustedSummary(raw) {
    const summary = { ...(raw || {}) };
    const recoveredRows = [...recovered.values()];
    const recoveredHistories = recoveredRows.filter(row => !!row.history).length;
    const recoveredVerified = recoveredRows.filter(row => row.latest?.verified).length;
    const recoveredDatedAttempts = recoveredRows.reduce((sum,row) => sum + Number(row.reconstruction?.attemptsWithDate || 0), 0);
    summary.questions = Math.max(0, Number(summary.questions || 0) + recoveredRows.length);
    summary.histories = Math.max(0, Number(summary.histories || 0) + recoveredHistories);
    summary.verifiedLatest = Math.max(0, Number(summary.verifiedLatest || 0) + recoveredVerified);
    summary.datedAttempts = Math.max(0, Number(summary.datedAttempts || 0) + recoveredDatedAttempts);
    summary.failedQuestions = unresolvedFailures.size;
    summary.retriedQuestions = retriedIds.size;
    summary.recoveredQuestions = recoveredRows.length;
    summary.failedQuestionIds = [...unresolvedFailures.keys()];
    summary.failures = [...unresolvedFailures.values()].slice(0,50);
    summary.incomplete = unresolvedFailures.size > 0;
    return summary;
  }

  chrome.runtime.sendMessage = function(message, ...args) {
    if (!message || args.length) return underlyingSend(message, ...args);

    if (message.kind === 'tec-reconstruct-batch') {
      return (async () => {
        const inputRows = Array.isArray(message.rows) ? message.rows : [];
        const nextRows = [];
        for (const row of inputRows) {
          if (!isFailedRow(row)) { nextRows.push(row); continue; }
          const recoveredRow = await recoverFailure(row);
          const id = String(row.questionId || '');
          if (recoveredRow?.question) {
            recovered.set(id, recoveredRow);
            unresolvedFailures.delete(id);
          }
          nextRows.push(recoveredRow);
        }
        return underlyingSend({ ...message, rows:nextRows });
      })();
    }

    if (message.kind === 'tec-reconstruct-progress') {
      return underlyingSend({ ...message, progress:adjustedSummary(message.progress) });
    }

    if (message.kind === 'tec-reconstruct-complete') {
      return underlyingSend({ ...message, summary:adjustedSummary(message.summary) });
    }

    return underlyingSend(message);
  };
})();
