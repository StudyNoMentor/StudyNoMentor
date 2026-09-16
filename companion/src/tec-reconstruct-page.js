/* StudyNoMentor Companion — leitor MAIN world para reconstrução histórica TEC.
 * Lê somente a questão e o histórico pedagógico exposto pelo AngularJS/DOM.
 * Nenhum cookie, token, senha ou credencial é acessado.
 */
'use strict';

(() => {
  if (window.__snmTecReconstructPage) return;
  window.__snmTecReconstructPage = true;

  const SOURCE = 'StudyMentorTecReconstructPage';
  const REQUEST_SOURCE = 'StudyMentorTecReconstructIsolated';
  const text = el => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const visible = el => {
    try { return !!(el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')); }
    catch (_) { return !!el; }
  };

  function htmlishToText(value) {
    if (value == null) return '';
    const s = String(value);
    if (!/[<>]/.test(s)) return s.replace(/\s+/g, ' ').trim();
    try { const d=document.createElement('div'); d.innerHTML=s; return text(d); }
    catch (_) { return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
  }

  function firstUseful(obj, keys) {
    for (const key of keys) {
      try {
        const value = obj && obj[key];
        if (value !== null && value !== undefined && String(value).trim() !== '') return value;
      } catch (_) {}
    }
    return null;
  }

  function letter(value) {
    const m = String(value == null ? '' : value).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);
    return m ? m[1] : null;
  }

  function bool(value) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return null;
  }

  function questionIdFrom(q, vm) {
    const raw = firstUseful(q, ['id','idQuestao','questaoId','codigo']) || firstUseful(vm, ['idQuestao','questaoId']);
    return String(raw || '').match(/\d{4,}/)?.[0] || null;
  }

  function candidateButtons() {
    const nodes = [...document.querySelectorAll('button,a,[role="button"],[ng-click],[data-ng-click],input[type="submit"]')].filter(visible);
    const preferred = nodes.filter(el => /Desempenho|Resolver|Responder|Confirmar|Quest[aã]o|Gabarito/i.test([
      text(el), el.getAttribute?.('aria-label'), el.getAttribute?.('title'), el.getAttribute?.('ng-click'), el.getAttribute?.('data-ng-click')
    ].join(' ')));
    return (preferred.length ? preferred : nodes).slice(0, 80);
  }

  function vmCandidates() {
    const angular = window.angular;
    if (!angular || typeof angular.element !== 'function') return [];
    const out = [];
    for (const node of candidateButtons()) {
      try {
        const ng = angular.element(node), scopes = [];
        try { scopes.push(ng.scope && ng.scope()); } catch (_) {}
        try { scopes.push(ng.isolateScope && ng.isolateScope()); } catch (_) {}
        try { scopes.push(ng.data && ng.data('$scope')); } catch (_) {}
        try { scopes.push(ng.data && ng.data('$isolateScope')); } catch (_) {}
        for (let scope of scopes) {
          for (let depth=0; scope && depth<28; depth++, scope=scope.$parent) {
            if (scope.vm && !out.includes(scope.vm)) out.push(scope.vm);
          }
        }
      } catch (_) {}
    }
    return out;
  }

  function parseAlternatives(q) {
    const pools = [q?.alternativas,q?.opcoes,q?.opções,q?.respostas,q?.options,q?.itens,q?.alternativaList].filter(Array.isArray);
    for (const pool of pools) {
      const rows = [];
      for (let i=0;i<pool.length;i++) {
        const a = pool[i]; if (a == null) continue;
        const letra = letter(firstUseful(a,['letra','label','alternativa','codigo','sigla','idAlternativa','ordem']) ?? String.fromCharCode(65+i));
        if (!letra) continue;
        const texto = htmlishToText(firstUseful(a,['texto','descricao','descrição','conteudo','conteúdo','enunciado','html','valor','text','description']));
        const selected = bool(firstUseful(a,['selecionada','selecionado','selected','marcada','marcado','checked'])) === true;
        const correct = bool(firstUseful(a,['correta','correto','correct','isCorrect','gabarito'])) === true;
        const wrong = bool(firstUseful(a,['errada','errado','wrong','incorrect'])) === true;
        rows.push({ letra, texto, selected, correct, wrong });
      }
      if (rows.length >= 2) return rows;
    }
    return [];
  }

  function contextFromVm(expectedId = null) {
    for (const vm of vmCandidates()) {
      const q = vm && (vm.questao || vm.questão || vm.question);
      if (!q) continue;
      const id = questionIdFrom(q, vm);
      if (!id || (expectedId && String(id) !== String(expectedId))) continue;
      return {
        id,
        materia:htmlishToText(firstUseful(q?.materia || q?.matéria || q,['nomeMateria','materiaNome','materia','matéria'])),
        assunto:htmlishToText(firstUseful(q?.assunto || q,['nomeAssunto','assuntoNome','assunto'])),
        banca:htmlishToText(firstUseful(q?.banca || q,['nomeBanca','bancaNome','banca'])),
        concurso:htmlishToText(firstUseful(q?.concurso || q,['nomeConcurso','concursoNome','concurso'])),
        enunciado:htmlishToText(firstUseful(q,['enunciado','textoEnunciado','enunciadoHtml','htmlEnunciado','descricao','descrição','texto','comando','statement'])),
        alternativas:parseAlternatives(q),
        source:'angular-main'
      };
    }
    return null;
  }

  function safeDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value < 1e12 ? value * 1000 : value;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const raw = String(value).trim();
    if (!raw) return null;
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (br) {
      if (!br[4]) return `${br[3]}-${br[2]}-${br[1]}`;
      return `${br[3]}-${br[2]}-${br[1]}T${String(br[4]).padStart(2,'0')}:${br[5]}:${br[6] || '00'}`;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toISOString();
  }

  function resolutionDate(r) {
    return safeDate(firstUseful(r,[
      'dataResolucao','dataResolução','dataResposta','dataHora','resolvidoEm','respondidoEm','createdAt','criadoEm','date','data','timestamp'
    ]));
  }

  function historyFromVm(expectedId = null) {
    for (const vm of vmCandidates()) {
      const q = vm && (vm.questao || vm.questão || vm.question);
      const id = q ? questionIdFrom(q, vm) : null;
      if (expectedId && id && String(id) !== String(expectedId)) continue;
      const rs = vm?.desempenhoAluno?.resolucoes;
      if (!Array.isArray(rs)) continue;
      const attempts = [];
      let acertos = 0, erros = 0;
      for (let i=0;i<rs.length;i++) {
        const r = rs[i];
        const acertou = bool(r?.acertou);
        if (acertou === null) continue;
        acertou ? acertos++ : erros++;
        attempts.push({
          index:i,
          acertou,
          alternativa:letter(firstUseful(r,['alternativaSelecionada','alternativaMarcada','resposta','marcada'])),
          resolvedAt:resolutionDate(r),
          source:'angular-desempenho'
        });
      }
      const first = attempts[0] || null;
      return {
        total:attempts.length,
        acertos,
        erros,
        ultimoResultado:first ? (first.acertou ? 'acerto' : 'erro') : null,
        ultimaAlternativa:first ? first.alternativa : null,
        consistente:acertos + erros === attempts.length,
        attempts,
        source:'angular-main'
      };
    }
    return null;
  }

  function historyFromDom() {
    const canvases = [...document.querySelectorAll('canvas[aria-label^="Seu desempenho na questão"]')];
    const canvas = canvases.find(visible) || canvases[0] || null;
    if (!canvas) return null;
    const m = String(canvas.getAttribute('aria-label') || '').match(/Acertos:\s*(\d+)\s*,\s*Erros:\s*(\d+)/i);
    if (!m) return null;
    const acertos = Number(m[1]), erros = Number(m[2]);
    const total = acertos + erros;
    const group = canvas.closest('.detalhes-resolucoes-grafico-agrupador') || canvas.parentElement;
    const latest = group?.querySelector('.historico-resolucoes-aluno li') || null;
    let ultimoResultado = null, ultimaAlternativa = null;
    if (latest) {
      const t = text(latest);
      if (/\bErrou\b/i.test(t) || latest.querySelector('.historico-resolucao-aluno-erros')) ultimoResultado = 'erro';
      else if (/\bAcertou\b/i.test(t)) ultimoResultado = 'acerto';
      for (const s of latest.querySelectorAll('strong')) {
        const l = letter(text(s)); if (l) { ultimaAlternativa = l; break; }
      }
    }
    return { total, acertos, erros, ultimoResultado, ultimaAlternativa, consistente:true, attempts:[], source:'dom-main' };
  }

  function snapshot(expectedId = null) {
    const context = contextFromVm(expectedId);
    const history = historyFromVm(expectedId) || historyFromDom();
    return { context, history, href:location.href, capturedAt:new Date().toISOString() };
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== REQUEST_SOURCE || msg.type !== 'reconstruction-snapshot-request') return;
    const requestId = String(msg.requestId || '');
    const expectedId = msg.questionId ? String(msg.questionId) : null;
    const data = snapshot(expectedId);
    window.postMessage({ source:SOURCE, type:'reconstruction-snapshot', requestId, questionId:expectedId, data }, location.origin);
  });
})();
