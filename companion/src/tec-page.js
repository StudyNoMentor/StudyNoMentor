/* StudyNoMentor Companion — ponte de contexto no MAIN world do TEC.
 *
 * O content script isolado não enxerga os objetos JavaScript da página. O TEC
 * atual ainda expõe parte essencial do contexto da questão no AngularJS; esta
 * ponte lê SOMENTE dados pedagógicos da questão e os publica por postMessage.
 * Nenhuma credencial, cookie ou token é lido ou transmitido.
 */
'use strict';

(() => {
  if (window.__snmTecPageBridge) return;
  window.__snmTecPageBridge = true;

  const SOURCE = 'StudyMentorTecPage';
  const REQUEST_SOURCE = 'StudyMentorCompanionIsolated';
  let lastSignature = '';
  let timer = null;

  const text = (el) => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = (el) => {
    try { return !!(el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')); }
    catch (_) { return !!el; }
  };

  function htmlishToText(value) {
    if (value == null) return '';
    const s = String(value);
    if (!/[<>]/.test(s)) return s.replace(/\s+/g, ' ').trim();
    try {
      const d = document.createElement('div'); d.innerHTML = s;
      return text(d);
    } catch (_) {
      return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  function firstUseful(obj, keys) {
    for (const key of keys) {
      try {
        const value = obj && obj[key];
        if (value != null && String(value).trim()) return value;
      } catch (_) {}
    }
    return null;
  }

  function candidateButtons() {
    return [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(visible)
      .filter(el => /Resolver\s+quest[aã]o|Responder|Confirmar\s+resposta|Desempenho\s+na\s+quest[aã]o/i.test(text(el)) ||
        /desempenho na questão/i.test(String(el.getAttribute && el.getAttribute('aria-label') || '')))
      .slice(0, 20);
  }

  function vmCandidates() {
    const angular = window.angular;
    if (!angular || typeof angular.element !== 'function') return [];
    const out = [];
    for (const node of candidateButtons()) {
      try {
        const ng = angular.element(node);
        const scopes = [];
        try { scopes.push(ng.scope && ng.scope()); } catch (_) {}
        try { scopes.push(ng.isolateScope && ng.isolateScope()); } catch (_) {}
        try { scopes.push(ng.data && ng.data('$scope')); } catch (_) {}
        try { scopes.push(ng.data && ng.data('$isolateScope')); } catch (_) {}
        for (let scope of scopes) {
          for (let depth = 0; scope && depth < 24; depth++, scope = scope.$parent) {
            if (scope.vm && !out.includes(scope.vm)) out.push(scope.vm);
          }
        }
      } catch (_) {}
    }
    return out;
  }

  function parseAlternatives(q) {
    const pools = [q && q.alternativas, q && q.opcoes, q && q.opções, q && q.respostas, q && q.options, q && q.itens, q && q.alternativaList].filter(Array.isArray);
    for (const pool of pools) {
      const rows = [];
      for (let i = 0; i < pool.length; i++) {
        const a = pool[i]; if (a == null) continue;
        const letra = String(firstUseful(a, ['letra','label','alternativa','codigo','sigla','idAlternativa','ordem']) ?? String.fromCharCode(65 + i)).toUpperCase().match(/[A-E]/)?.[0] || null;
        const texto = htmlishToText(firstUseful(a, ['texto','descricao','descrição','conteudo','conteúdo','enunciado','html','valor','text','description']));
        if (!letra) continue;
        rows.push({
          letra,
          texto,
          selected: !!firstUseful(a, ['selecionada','selecionado','selected','marcada','marcado','checked']),
          correct: !!firstUseful(a, ['correta','correto','correct','isCorrect','gabarito']),
          wrong: !!firstUseful(a, ['errada','errado','wrong','incorrect'])
        });
      }
      if (rows.length >= 2) return rows;
    }
    return [];
  }

  function extractAngularContext() {
    for (const vm of vmCandidates()) {
      const q = vm && (vm.questao || vm.questão || vm.question);
      if (!q) continue;
      const id = String(firstUseful(q, ['id','idQuestao','questaoId','codigo']) || '').match(/\d{4,}/)?.[0] || null;
      if (!id) continue;
      const materia = htmlishToText(firstUseful((q.materia || q.matéria || q), ['nomeMateria','materiaNome','materia','matéria']));
      const assunto = htmlishToText(firstUseful((q.assunto || q), ['nomeAssunto','assuntoNome','assunto']));
      const banca = htmlishToText(firstUseful((q.banca || q), ['nomeBanca','bancaNome','banca']));
      const concurso = htmlishToText(firstUseful((q.concurso || q), ['nomeConcurso','concursoNome','concurso']));
      const enunciado = htmlishToText(firstUseful(q, ['enunciado','textoEnunciado','enunciadoHtml','htmlEnunciado','descricao','descrição','texto','comando','statement']));
      return { id, materia, assunto, banca, concurso, enunciado, alternativas: parseAlternatives(q), source:'angular-main' };
    }
    return null;
  }

  function extractDomContext() {
    let id = null;
    for (const el of [...document.querySelectorAll('[data-question-id],[data-questao-id],[data-id-questao],[data-idquestao],h1,h2,h3,h4,strong,[class*="quest" i],[id*="quest" i]')].slice(0, 1000)) {
      if (!visible(el)) continue;
      for (const attr of ['data-question-id','data-questao-id','data-id-questao','data-idquestao']) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v && /^\d+$/.test(v)) { id = v; break; }
      }
      if (id) break;
      const hay = text(el);
      const m = hay.match(/(?:Quest[aã]o\s*#?\s*|\bID\s*[:#]?\s*)(\d{4,})/i);
      if (m) { id = m[1]; break; }
    }
    return id ? { id, source:'dom-main' } : null;
  }

  function context() {
    const out = extractAngularContext() || extractDomContext();
    if (!out) return null;
    return { ...out, href: location.href, capturedAtMs: Date.now() };
  }

  function emit(force = false) {
    const ctx = context();
    if (!ctx) return false;
    const signature = [ctx.id, ctx.materia, ctx.assunto, ctx.href].join('|');
    if (!force && signature === lastSignature) return true;
    lastSignature = signature;
    window.postMessage({ source: SOURCE, type:'question-context', context:ctx }, location.origin);
    return true;
  }

  function schedule(force = false, delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(() => emit(force), delay);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (msg && msg.source === REQUEST_SOURCE && msg.type === 'context-request') emit(true);
  });

  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('button,a,[role="button"]') : null;
    if (!button || !/Resolver\s+quest[aã]o|Responder|Confirmar\s+resposta/i.test(text(button))) return;
    emit(true);
    schedule(true, 120);
    schedule(true, 450);
  }, true);

  const start = () => {
    emit(true);
    const observer = new MutationObserver(() => schedule(false, 80));
    if (document.documentElement) observer.observe(document.documentElement, { childList:true, subtree:true });
    setInterval(() => emit(false), 2000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
