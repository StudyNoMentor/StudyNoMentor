/* ============================================================================
   ROBUSTO V7 — FOCO OPERACIONAL EM QUESTOES APROFUNDADAS
   ----------------------------------------------------------------------------
   O motor decide ONDE atacar, QUANTO atacar e, quando ha amostra de tempo,
   QUANTO TEMPO o bloco tende a consumir. O metodo de estudo dentro de cada
   questao pertence ao aluno (comentarios, resumo e cards) e nao e inferido.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__robustoFocoQuestoesV7) return;
  const R = window.PlanoSugestoesRobustoV6 || window.PlanoSugestoesRobustoV5 || window.PlanoSugestoesRobustoV4;
  const RO = window.PlanoRobustoRouterV6 || window.PlanoRobustoRouterV5 || window.PlanoRobustoRouterV4;
  const C = window.PlanoRobustoConfigV6 || window.PlanoRobustoConfigV5 || window.PlanoRobustoConfigV4;
  if (!R || !RO || !C) return;
  window.__robustoFocoQuestoesV7 = true;

  const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  C.REVISAO_AUDITORIA = 7;
  RO.VERSAO = 7;
  RO.REVISAO_AUDITORIA = 7;

  RO.decidir = function(c, cfg) {
    if (!c) return null;
    cfg = cfg || {};
    const r = cfg.roteador || {}, dom = c.mentor && c.mentor.dominio || {}, cal = c.mentor && c.mentor.calibracao || {};
    const qAtual = Math.max(0, Math.round(n(c.qJanela)));
    const minAmostra = Math.max(1, Math.round(n(c.minAmostra, 20)));
    const alvo = Math.max(1, Math.round(n(c.alvo, 20)));
    const dose = Math.max(1, Math.round(n(c.doseDiaria, r.questoesBloco || 12)));
    const queda = (() => {
      for (const k of ['quedaPP', 'queda', 'deltaTaxa', 'tendenciaPP']) {
        const v = Number(c.item && c.item[k]);
        if (Number.isFinite(v)) return (k === 'deltaTaxa' || k === 'tendenciaPP') ? -v : v;
      }
      return 0;
    })();
    const vencido = !!(dom.vencido || (c.item && c.item.vencido));
    const dominioAlto = ['elite', 'competitivo', 'manutencao', 'operacional'].includes(dom.nivel);

    let qq = Math.min(alvo, dose);
    let motivo = 'Bloco calculado pela prioridade do Robusto e limitado pela dose operacional.';
    let contexto = 'correcao';

    if (qAtual < minAmostra) {
      qq = Math.min(alvo, Math.max(5, minAmostra - qAtual));
      motivo = `Amostra ${qAtual}/${minAmostra}: produzir evidencia antes de aumentar a prescricao.`;
      contexto = 'medicao';
    } else if (dominioAlto && (vencido || queda > Math.max(.1, n(r.quedaIntervencaoPP, 3)))) {
      qq = Math.min(alvo, Math.max(5, Math.round(n(r.manutencaoQuestoes, dose))));
      motivo = vencido
        ? 'Dominio alto com medicao vencida: bloco curto para revalidar a fraqueza antes de ampliar volume.'
        : `Dominio alto com queda recente de ${queda.toFixed(1)} pp: bloco curto de revalidacao.`;
      contexto = 'revalidacao';
    }

    const tq = typeof this._tempoQuestoes === 'function' ? this._tempoQuestoes(c, qq, cfg) : { minutos: null, fonte: 'indisponivel', confiavel: false };
    const minutos = tq && Number.isFinite(Number(tq.minutos)) ? Math.max(1, Math.round(Number(tq.minutos))) : null;
    return {
      tipo: 'questoes_aprofundadas',
      rotulo: 'Questoes aprofundadas',
      passos: [{ tipo: 'questoes', quantidade: qq }],
      quantidadeQuestoes: qq,
      contexto,
      motivo,
      minutosEstimados: minutos,
      minutosFixos: 0,
      minutosQuestoes: minutos,
      tempoFonte: minutos == null ? 'indisponivel' : (tq.fonte || 'tempo-pessoal'),
      tempoConfiavel: !!(minutos != null && tq && tq.confiavel),
      forcaHeuristica: null,
      confianca: null,
      evidencia: {
        qAtual,
        minAmostra,
        dominio: dom.nivel || null,
        vencido,
        quedaPP: queda,
        calibracaoNivel: cal.nivel || null,
        metodologiaFixa: true
      }
    };
  };

  R.VERSAO = 7;
  R.REVISAO_AUDITORIA = 7;
  const oldArq = typeof R.arquitetura === 'function' ? R.arquitetura.bind(R) : null;
  R.arquitetura = function() {
    const z = oldArq ? oldArq() : {};
    return Object.assign({}, z, {
      revisaoAuditoria: 7,
      modusOperandi: 'questoes-aprofundadas',
      decide: ['disciplina', 'topico', 'quantidadeQuestoes', 'tempoQuandoConfiavel'],
      naoDecide: ['teoria', 'lei-seca', 'anki', 'resumo', 'metodo-de-estudo']
    });
  };

  const oldHtml = typeof C.html === 'function' ? C.html.bind(C) : null;
  if (oldHtml) C.html = function(m) {
    let h = oldHtml(m);
    h = h.replace('ROBUSTO V5 · POLÍTICA COMPLETA', 'ROBUSTO V7 · PRIORIDADE, DOSE E TEMPO');
    h = h.replace('Central avançada de parâmetros', 'Central do Robusto');
    h = h.replace(/(<p class="rv5-note">[\s\S]*?<\/p>)/,
      '$1<p class="rv7-method-note"><b>Modo operacional:</b> o Robusto recomenda somente <b>questões aprofundadas</b>. Ele escolhe disciplina, assunto, quantidade e estima tempo quando há histórico confiável. Resumo, comentários e criação de cards fazem parte do seu modo de resolução e não são inferidos pelo algoritmo.</p>');
    return h;
  };

  const oldManual = typeof C.manualHtml === 'function' ? C.manualHtml.bind(C) : null;
  if (oldManual) C.manualHtml = function(m) {
    let h = oldManual(m);
    h = h.replace(/Manual do Módulo Robusto V5/g, 'Manual do Módulo Robusto V7');
    h = h.replace('O roteador escolhe a intervenção pedagógica.', 'A camada operacional define a dose de questões aprofundadas e estima o tempo quando há histórico confiável.');
    h = h.replace('decidir onde investir tempo e como intervir', 'decidir onde investir tempo, qual assunto atacar e qual dose de questões aprofundadas executar');
    h = h.replace(/<tr><td><b>Roteador pedagógico<\/b>[\s\S]*?<\/tr>/, '');
    h = h.replace(/<h2>Roteador pedagógico<\/h2>[\s\S]*?<\/table>/, '');
    h = h.replace('</div><h2>Fluxo principal</h2>', '</div><div class="box"><b>Modus operandi fixo:</b> toda recomendação operacional é um bloco de questões aprofundadas. Comentários, resumo teórico e criação de cards pertencem à execução do aluno e não são escolhidos pelo motor.</div><h2>Fluxo principal</h2>');
    return h;
  };

  window.PlanoSugestoesRobustoV7 = R;
  window.PlanoRobustoRouterV7 = RO;
})();
