/* StudyNoMentor Companion — reconstrução histórica de um caderno TEC.
 *
 * Roda SOMENTE numa aba dedicada aberta com #snm-reconstruct=<requestId>.
 * Nessa aba bloqueia os capturadores normais antes que eles inicializem, para
 * que cliques de navegação/performance nunca sejam confundidos com nova resposta.
 */
'use strict';

(() => {
  const marker = String(location.hash || '').match(/(?:^#|[&#])snm-reconstruct=([^&]+)/);
  if (!marker || window.top !== window.self) return;

  /* Mesmo isolated world da extensão: estes flags fazem os capturadores que
     vêm depois no manifest encerrarem no início, sem interferir no TEC normal. */
  window.__snmTecCompanionV2 = true;
  window.__snmTecCompanion = true;
  window.__snmTecCaptureWatchdog = true;
  window.__snmTecReconstructionTab = true;

  if (window.__snmTecReconstructRunner) return;
  window.__snmTecReconstructRunner = true;

  const PAGE_SOURCE = 'StudyMentorTecReconstructPage';
  const PAGE_REQUEST_SOURCE = 'StudyMentorTecReconstructIsolated';
  const SESSION_ACCOUNT_KEY = 'snmTecUnknownAccountV2';
  const MAX_LOAD_MORE = 220;
  const BATCH_SIZE = 10;
  let running = false;
  let cancelled = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const text = el => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = el => {
    try { return !!(el && el.isConnected !== false && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')); }
    catch (_) { return !!el; }
  };
  const uid = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const letter = value => {
    const m = String(value == null ? '' : value).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);
    return m ? m[1] : null;
  };

  function fnv(str) {
    let h = 2166136261;
    for (const c of String(str || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  function accountIdentity() {
    const ids = [];
    try {
      for (let i=0;i<localStorage.length;i++) {
        const k = localStorage.key(i) || '';
        if (!/(usuario|user|account|conta|perfil|profile)/i.test(k)) continue;
        const v = String(localStorage.getItem(k) || '').slice(0, 4000);
        const re = /"(?:idUsuario|usuarioId|userId|id_user|id)"\s*:\s*"?([A-Za-z0-9_-]{2,96})/gi;
        let m, count = 0;
        while ((m = re.exec(v)) && count++ < 4) ids.push(`${k}:${m[1]}`);
      }
    } catch (_) {}
    const strong = [...new Set(ids)].sort();
    if (strong.length) return { id:'tec_' + fnv(strong.join('|')), confidence:'strong', source:'storage-id' };

    const labels = [];
    for (const sel of ['[class*="usuario" i]','[class*="perfil" i]','[class*="profile" i]','a[href*="logout" i]','button[aria-label*="perfil" i]']) {
      for (const el of [...document.querySelectorAll(sel)].slice(0, 6)) {
        const t = text(el); if (visible(el) && t && t.length < 120) labels.push(t);
      }
    }
    const weak = [...new Set(labels)].sort();
    if (weak.length) return { id:'tec_' + fnv(weak.join('|')), confidence:'heuristic', source:'visible-label' };

    let sid = '';
    try {
      sid = sessionStorage.getItem(SESSION_ACCOUNT_KEY) || '';
      if (!sid) { sid = 'unknown_' + uid(); sessionStorage.setItem(SESSION_ACCOUNT_KEY, sid); }
    } catch (_) { sid = 'unknown_' + uid(); }
    return { id:'tec_' + fnv(sid), confidence:'unknown', source:'session-random' };
  }

  async function waitFor(fn, timeout = 7000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (cancelled) throw new Error('Reconstrução cancelada.');
      let v = null;
      try { v = await fn(); } catch (_) {}
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function workerTab(label) {
    return [...document.querySelectorAll('.aba-navegacao')].find(x => text(x) === label) || null;
  }

  async function openGabarito() {
    const tab = workerTab('Gabarito');
    if (!tab) throw new Error('A aba Gabarito não foi encontrada neste caderno.');
    if (!tab.classList.contains('selecionada')) tab.click();
    const table = await waitFor(() => document.querySelector('table.tabela-gabaritos'), 8000, 90);
    if (!table) throw new Error('A tabela de Gabarito não apareceu. Confirme se você está logado no TEC e tem acesso ao caderno.');
    await sleep(180);
  }

  async function selectFilter(label) {
    let option = [...document.querySelectorAll('.dropdown-menu li a')].find(x => text(x) === label) || null;
    if (!option) {
      for (const toggle of document.querySelectorAll('.dropdown-toggle')) {
        toggle.click(); await sleep(70);
        option = [...document.querySelectorAll('.dropdown-menu li a')].find(x => text(x) === label) || null;
        if (option) break;
      }
    }
    if (!option) throw new Error(`Filtro "${label}" não encontrado no Gabarito.`);
    option.click();
    await sleep(250);
    await waitStableTable();
  }

  function tableSignature() {
    return JSON.stringify([...document.querySelectorAll('table.tabela-gabaritos tbody tr.questao')].map(row =>
      row.querySelector('td.id-questao a[href*="/questoes/"]')?.getAttribute('href') || ''
    ));
  }

  async function waitStableTable() {
    let prev = tableSignature(), stable = 0;
    for (let i=0;i<35;i++) {
      await sleep(120);
      const current = tableSignature();
      if (current === prev) stable++; else { prev = current; stable = 0; }
      if (stable >= 3) return;
    }
  }

  function loadMoreButton() {
    return [...document.querySelectorAll('a[role="button"],button')].find(el => text(el) === 'Carregar mais' && visible(el) && !el.disabled) || null;
  }

  async function loadAllRows() {
    for (let i=0;i<MAX_LOAD_MORE;i++) {
      const button = loadMoreButton();
      if (!button) {
        await waitStableTable();
        if (!loadMoreButton()) return;
        continue;
      }
      const before = document.querySelectorAll('table.tabela-gabaritos tbody tr.questao').length;
      button.click();
      await waitFor(() => document.querySelectorAll('table.tabela-gabaritos tbody tr.questao').length > before || !loadMoreButton(), 5500, 100);
      await sleep(80);
    }
    throw new Error('O caderno excedeu o limite de paginação do reconstrutor.');
  }

  function readGabaritoRow(row) {
    const link = row.querySelector('td.id-questao a[href*="/questoes/"]');
    const id = link?.getAttribute('href')?.match(/\/questoes\/(\d+)/)?.[1] || null;
    if (!id) return null;
    const date = text(row.querySelector('td.data-resolucao'));
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return null;
    const cell = row.querySelector('td.resultado');
    if (!cell) return null;
    let acertou = !!cell.querySelector('.acertou'), errou = !!cell.querySelector('.errou');
    if (!acertou && !errou) {
      const t = text(cell); acertou = /\bAcertou\b/i.test(t); errou = /\bErrou\b/i.test(t);
    }
    if (acertou === errou) return null;
    return { id:String(id), dataResolucao:date, acertou, rowText:text(row).slice(0,600) };
  }

  function scanTargets() {
    const out = [], seen = new Set();
    for (const row of document.querySelectorAll('table.tabela-gabaritos tbody tr.questao')) {
      const item = readGabaritoRow(row);
      if (!item) continue;
      const key = `${item.id}|${item.dataResolucao}|${item.acertou ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key); out.push(item);
    }
    return out;
  }

  async function findRow(id) {
    for (let i=0;i<MAX_LOAD_MORE;i++) {
      const link = document.querySelector(`td.id-questao a[href$="/questoes/${id}"]`);
      if (link) return link.closest('tr.questao');
      const more = loadMoreButton();
      if (!more) {
        await waitStableTable();
        return document.querySelector(`td.id-questao a[href$="/questoes/${id}"]`)?.closest('tr.questao') || null;
      }
      const before = document.querySelectorAll('table.tabela-gabaritos tbody tr.questao').length;
      more.click();
      await waitFor(() => document.querySelector(`td.id-questao a[href$="/questoes/${id}"]`) || document.querySelectorAll('table.tabela-gabaritos tbody tr.questao').length > before || !loadMoreButton(), 5000, 100);
    }
    return null;
  }

  function currentQuestionId() {
    for (const el of [...document.querySelectorAll('[data-question-id],[data-questao-id],[data-id-questao],[data-idquestao],a[href],h1,h2,h3,strong')].slice(0,1000)) {
      if (!visible(el)) continue;
      for (const attr of ['data-question-id','data-questao-id','data-id-questao','data-idquestao']) {
        const v = el.getAttribute?.(attr); if (v && /^\d+$/.test(v)) return v;
      }
      const hay = [el.getAttribute?.('href'), text(el)].join(' ');
      const m = hay.match(/(?:\/questoes\/|quest[aã]o\s*#?\s*|#)(\d{4,})/i);
      if (m) return m[1];
    }
    return null;
  }

  function requestSnapshot(questionId) {
    return new Promise(resolve => {
      const token = `snap_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      let done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); window.removeEventListener('message', onMessage); resolve(value || null); };
      const onMessage = event => {
        if (event.source !== window || event.origin !== location.origin) return;
        const msg = event.data;
        if (!msg || msg.source !== PAGE_SOURCE || msg.type !== 'reconstruction-snapshot' || msg.requestId !== token) return;
        finish(msg.data || null);
      };
      const timer = setTimeout(() => finish(null), 2200);
      window.addEventListener('message', onMessage);
      window.postMessage({ source:PAGE_REQUEST_SOURCE, type:'reconstruction-snapshot-request', requestId:token, questionId:String(questionId || '') }, location.origin);
    });
  }

  function performanceButton() {
    const nodes = [
      ...document.querySelectorAll('button.questao-cabecalho-desempenho'),
      ...document.querySelectorAll('button[aria-label*="Desempenho" i],a[aria-label*="Desempenho" i],[role="button"][aria-label*="Desempenho" i]'),
      ...document.querySelectorAll('button,a,[role="button"]')
    ];
    return nodes.find(x => visible(x) && /Desempenho\s+na\s+quest[aã]o|Meu\s+Desempenho/i.test(text(x) + ' ' + String(x.getAttribute?.('aria-label') || ''))) || null;
  }

  function historyFromDom() {
    const canvases = [...document.querySelectorAll('canvas[aria-label^="Seu desempenho na questão"]')];
    const canvas = canvases.find(visible) || canvases[0] || null;
    if (!canvas) return null;
    const m = String(canvas.getAttribute('aria-label') || '').match(/Acertos:\s*(\d+)\s*,\s*Erros:\s*(\d+)/i);
    if (!m) return null;
    const acertos = Number(m[1]), erros = Number(m[2]);
    const group = canvas.closest('.detalhes-resolucoes-grafico-agrupador') || canvas.parentElement;
    const latest = group?.querySelector('.historico-resolucoes-aluno li') || null;
    let ultimoResultado = null, ultimaAlternativa = null;
    if (latest) {
      if (/\bErrou\b/i.test(text(latest)) || latest.querySelector('.historico-resolucao-aluno-erros')) ultimoResultado = 'erro';
      else if (/\bAcertou\b/i.test(text(latest))) ultimoResultado = 'acerto';
      for (const s of latest.querySelectorAll('strong')) { const l=letter(text(s)); if (l) { ultimaAlternativa=l; break; } }
    }
    return { total:acertos+erros, acertos, erros, ultimoResultado, ultimaAlternativa, consistente:true, attempts:[], source:'dom-isolated' };
  }

  function contextFromDom(id) {
    const firstText = selectors => {
      for (const sel of selectors) for (const el of document.querySelectorAll(sel)) if (visible(el) && text(el)) return text(el);
      return '';
    };
    const by = new Map();
    const nodes = [...document.querySelectorAll('label,button,[role="radio"],li,[data-letter],[data-letra],.wk7j7j,.bz2gcz')].slice(0,1500);
    for (const node of nodes) {
      if (!visible(node)) continue;
      const direct = node.getAttribute?.('data-letter') || node.getAttribute?.('data-letra') || node.getAttribute?.('value');
      let l = direct && /^[A-E]$/i.test(String(direct).trim()) ? String(direct).trim().toUpperCase() : null;
      if (!l) l = text(node).match(/^\s*([A-E])(?:\s*[\)\.\-:]|\s+)/i)?.[1]?.toUpperCase() || null;
      if (!l) continue;
      const cl = String(node.className || ''), aria = String(node.getAttribute?.('aria-label') || '');
      const selected = node.matches?.('input:checked') || !!node.querySelector?.('input:checked') || String(node.getAttribute?.('aria-checked')).toLowerCase()==='true' || /selected|selecionad|marcad|checked|active/i.test(cl);
      const correct = /wk7j7j|corret|correct|success|certa/i.test(cl + ' ' + aria) || !!node.querySelector?.('[class*="correct" i],[class*="corret" i]');
      const wrong = /bz2gcz|incorrect|errad|danger|wrong/i.test(cl) || !!node.querySelector?.('[class*="incorrect" i],[class*="errad" i]');
      const raw = text(node).replace(new RegExp('^\\s*'+l+'\\s*(?:[\\)\\.\\-:]|\\s+)\\s*','i'),'').trim();
      const old = by.get(l) || { letra:l, texto:'', selected:false, correct:false, wrong:false };
      if (raw && raw.length < 3000 && !old.texto) old.texto = raw;
      old.selected = old.selected || selected; old.correct = old.correct || correct; old.wrong = old.wrong || wrong;
      by.set(l, old);
    }
    return {
      id:String(id),
      materia:firstText(['a[ng-href*="/materias/"]','a[href*="/materias/"]','[data-eq-slot="materia"]','[class*="materia" i]']),
      assunto:firstText(['span[ng-bind="vm.nomeAssuntoExibicao()"]','[data-eq-slot="assunto"]','[class*="assunto" i]']),
      banca:firstText(['a[href*="/bancas/"]']),
      concurso:firstText(['a[href*="/concursos/"]']),
      enunciado:firstText(['[data-eq-slot="enunciado"]','[data-testid*="enunciado" i]','[class*="enunciado" i]','[id*="enunciado" i]','[class*="statement" i]']),
      alternativas:[...by.values()].sort((a,b)=>a.letra.localeCompare(b.letra)).slice(0,8),
      source:'dom-isolated'
    };
  }

  function normalizeContext(context, id) {
    const base = context && String(context.id || '') === String(id) ? context : contextFromDom(id);
    const dom = contextFromDom(id), map = new Map();
    for (const a of [...(base.alternativas || []), ...(dom.alternativas || [])]) {
      if (!a || !letter(a.letra)) continue;
      const l = letter(a.letra), old = map.get(l) || { letra:l, texto:'', selected:false, correct:false, wrong:false };
      if (!old.texto && a.texto) old.texto = String(a.texto);
      old.selected = old.selected || a.selected === true || a.marcadaPorMim === true;
      old.correct = old.correct || a.correct === true || a.correta === true;
      old.wrong = old.wrong || a.wrong === true || a.errada === true;
      map.set(l, old);
    }
    return {
      id:String(id),
      materia:String(base.materia || dom.materia || ''), assunto:String(base.assunto || dom.assunto || ''),
      banca:String(base.banca || dom.banca || ''), concurso:String(base.concurso || dom.concurso || ''),
      enunciado:String(base.enunciado || dom.enunciado || ''), alternativas:[...map.values()].sort((a,b)=>a.letra.localeCompare(b.letra)),
      source:[base.source,dom.source].filter(Boolean).join('+') || 'reconstruction'
    };
  }

  async function collectQuestion(target, bookId) {
    await openGabarito();
    await selectFilter('Resolvidas');
    const row = await findRow(target.id);
    if (!row) throw new Error(`Questão #${target.id} não reapareceu no Gabarito.`);
    const open = row.querySelector('td.num-questao a[role="button"],td.num-questao a,td.id-questao a[role="button"]');
    if (!open) throw new Error(`Não foi possível abrir a questão #${target.id}.`);
    open.click();

    const loaded = await waitFor(async () => {
      const qid = currentQuestionId();
      if (String(qid || '') === String(target.id)) return true;
      const snap = await requestSnapshot(target.id);
      return !!(snap && snap.context && String(snap.context.id || '') === String(target.id));
    }, 7000, 180);
    if (!loaded) throw new Error(`A questão #${target.id} não terminou de abrir.`);

    let snap = await requestSnapshot(target.id);
    let history = snap && snap.history || historyFromDom();
    if (!history || !Number.isFinite(Number(history.total))) {
      const perf = performanceButton();
      if (perf) {
        perf.click();
        await sleep(220);
        await waitFor(() => document.querySelector('canvas[aria-label^="Seu desempenho na questão"]') || document.querySelector('.historico-resolucoes-aluno'), 2400, 80);
        snap = await requestSnapshot(target.id) || snap;
        history = snap && snap.history || historyFromDom();
      }
    }

    const context = normalizeContext(snap && snap.context, target.id);
    let correta = null, marcada = null;
    for (const a of context.alternativas || []) {
      if (a.correct === true) correta = letter(a.letra) || correta;
      if (a.selected === true || a.wrong === true) marcada = letter(a.letra) || marcada;
    }
    if (!marcada && history && history.ultimaAlternativa) marcada = letter(history.ultimaAlternativa);
    const derived = marcada && correta ? marcada === correta : null;
    const verified = typeof derived === 'boolean' && derived === target.acertou;

    const question = {
      ...context,
      cadernoId:String(bookId),
      marcada:marcada || null,
      correta:correta || null,
      acertou:target.acertou,
      dataResolucao:target.dataResolucao,
      capturadoEm:new Date().toISOString(),
      integrity:verified ? {
        schema:3,status:'verified',confidence:'high',source:'historical-marked-vs-gabarito',
        marked:marcada,correct:correta,canonicalResult:derived,reportedResult:target.acertou,
        conflict:false,conflictResolved:false,reconstructed:true,datePrecision:'day'
      } : {
        schema:3,status:'historical-aggregate',confidence:'medium',source:'tec-reconstruction',
        marked:marcada,correct:correta,reportedResult:target.acertou,reconstructed:true,datePrecision:'day'
      }
    };
    question.alternativas = (question.alternativas || []).map(a => ({
      letra:letter(a.letra) || a.letra, texto:String(a.texto || ''),
      correta:!!correta && letter(a.letra) === correta,
      marcadaPorMim:!!marcada && letter(a.letra) === marcada
    }));

    const normalizedHistory = history && Number.isFinite(Number(history.total)) ? {
      total:Number(history.total), acertos:Number(history.acertos || 0), erros:Number(history.erros || 0),
      ultimoResultado:history.ultimoResultado || null, ultimaAlternativa:letter(history.ultimaAlternativa) || null,
      consistente:Number(history.acertos || 0) + Number(history.erros || 0) === Number(history.total),
      attempts:Array.isArray(history.attempts) ? history.attempts.map((a,index) => ({
        index:Number.isFinite(Number(a.index)) ? Number(a.index) : index,
        acertou:a.acertou === true,
        alternativa:letter(a.alternativa),
        resolvedAt:a.resolvedAt || null,
        source:a.source || history.source || 'tec-performance'
      })) : [],
      fonte:`reconstrucao:${history.source || 'tec'}`,
      confianca:'alta',
      reconstruidoEm:new Date().toISOString()
    } : null;

    return {
      questionId:String(target.id),
      bookId:String(bookId),
      latest:{ dataResolucao:target.dataResolucao, acertou:target.acertou, marcada:marcada || null, correta:correta || null, verified },
      question,
      history:normalizedHistory,
      reconstruction:{ source:'tec-caderno', exactLatest:verified, aggregateHistory:!!normalizedHistory, attemptsWithDate:normalizedHistory ? normalizedHistory.attempts.filter(a=>a.resolvedAt).length : 0 }
    };
  }

  async function sendProgress(requestId, progress) {
    const response = await chrome.runtime.sendMessage({ kind:'tec-reconstruct-progress', requestId, progress });
    if (response && response.ok === false && response.reason === 'job_mismatch') throw new Error('A sessão de reconstrução não pertence mais a esta aba.');
  }

  async function sendBatch(requestId, tecAccount, rows) {
    if (!rows.length) return;
    const response = await chrome.runtime.sendMessage({ kind:'tec-reconstruct-batch', requestId, tecAccount, rows });
    if (!response || response.ok !== true) throw new Error('O StudyNoMentor não confirmou o lote reconstruído.');
  }

  async function run(requestId, bookId) {
    if (running) return { accepted:false, reason:'already_running' };
    running = true; cancelled = false;
    const account = accountIdentity();
    const summary = { processed:0,total:0,questions:0,histories:0,verifiedLatest:0,datedAttempts:0,failedQuestions:0,phase:'opening' };
    try {
      await sendProgress(requestId, summary);
      await openGabarito();
      await selectFilter('Resolvidas');
      await loadAllRows();
      const targets = scanTargets();
      summary.total = targets.length; summary.phase = 'scanning';
      await sendProgress(requestId, summary);
      if (!targets.length) throw new Error('O TEC não exibiu questões resolvidas nesse caderno.');

      let batch = [];
      for (let i=0;i<targets.length;i++) {
        if (cancelled) throw new Error('Reconstrução cancelada.');
        const target = targets[i];
        try {
          const row = await collectQuestion(target, bookId);
          batch.push(row);
          summary.questions++;
          if (row.history) summary.histories++;
          if (row.latest && row.latest.verified) summary.verifiedLatest++;
          summary.datedAttempts += Number(row.reconstruction && row.reconstruction.attemptsWithDate || 0);
        } catch (e) {
          summary.failedQuestions++;
          batch.push({ questionId:String(target.id), bookId:String(bookId), latest:{ dataResolucao:target.dataResolucao, acertou:target.acertou, verified:false }, question:null, history:null,
            reconstruction:{ source:'tec-caderno', error:String(e && e.message || e), exactLatest:false, aggregateHistory:false, attemptsWithDate:0 } });
        }
        summary.processed = i + 1;
        summary.percent = Math.round(summary.processed / Math.max(1, summary.total) * 100);
        summary.phase = 'scanning';
        if (batch.length >= BATCH_SIZE || i === targets.length - 1) { await sendBatch(requestId, account.id, batch); batch = []; }
        await sendProgress(requestId, summary);
      }

      summary.phase = 'complete'; summary.percent = 100;
      await chrome.runtime.sendMessage({ kind:'tec-reconstruct-complete', requestId, summary:{ ...summary, tecAccount:account.id, tecAccountConfidence:account.confidence, tecAccountSource:account.source } });
      return { accepted:true };
    } catch (e) {
      await chrome.runtime.sendMessage({ kind:'tec-reconstruct-failed', requestId, status:500, error:String(e && e.message || e) }).catch(() => {});
      return { accepted:false, reason:String(e && e.message || e) };
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.kind !== 'tec-reconstruct-run') return false;
    const requestId = String(msg.requestId || decodeURIComponent(marker[1] || ''));
    const bookId = String(msg.bookId || location.pathname.match(/\/questoes\/cadernos\/(\d+)/)?.[1] || '');
    if (!requestId || !/^\d+$/.test(bookId)) { sendResponse({ accepted:false, reason:'invalid_job' }); return false; }
    sendResponse({ accepted:true });
    run(requestId, bookId).catch(() => {});
    return false;
  });
})();
