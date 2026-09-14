/* ============================================================================
   REFORÇO ADAPTATIVO — núcleo de continuidade V4
   ----------------------------------------------------------------------------
   Reinstala `enriquecer` como uma passagem única e determinística:
     prescrição estatística base -> estatísticas do mesmo snapshot -> continuidade.
   Isso evita depender de wrappers acumulados e garante que o cooldown/orçamento
   seja aplicado uma única vez por cálculo do Plano.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || !window.ReforcoAdaptativo || window.__raContinuityCoreV4) return;
  window.__raContinuityCoreV4 = true;
  const RA = window.ReforcoAdaptativo;
  if (typeof RA.prescrever !== 'function' || typeof RA.contexto !== 'function' ||
      typeof RA._aplicarContinuidade !== 'function') return;

  /* DB é um global léxico do app. Ele não precisa (nem deve) existir como
     `window.DB`. A primeira versão da ponte checava `window.DB` e, em builds em
     que esse alias não existe, concluía que não havia histórico: a dose voltava
     cheia mesmo depois de o tópico ter sido concluído. O contador abaixo usa o
     contrato real do app (`typeof DB`) e é a única fonte de estatísticas da
     continuidade. */
  RA._contStats = function (snapshotId) {
    const out = new Map();
    if (!snapshotId || typeof DB === 'undefined' || typeof DB.getExtras !== 'function') return out;
    let extras = [];
    try { extras = DB.getExtras() || []; }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ra-cont-stats-v4'); }
    for (const e of extras) {
      const o = e && e.origemPlano;
      const rx = o && o.prescricaoAdaptativa;
      if (!o || !rx || rx.snapshotId !== snapshotId) continue;
      const k = this._contKey(o.disciplina || e.disciplina, o.topico || e.titulo);
      let st = out.get(k);
      if (!st) {
        st = { executado: 0, ciclos: 0, abertos: 0, ultimoDia: '', extras: 0 };
        out.set(k, st);
      }
      const hist = Array.isArray(e.historico) ? e.historico : [];
      const porHist = hist.reduce((s, h) => s + Math.max(0, Number(h && h.quantidade) || 0), 0);
      const feito = Math.max(porHist, Math.max(0, Number(e.progresso) || 0));
      const alvo = Math.max(0, Number(e.alvo) || Number(rx.dose) || 0);
      st.executado += alvo > 0 ? Math.min(feito, alvo) : feito;
      const fechou = e.status === 'concluida' || (alvo > 0 && feito >= alvo);
      if (fechou) st.ciclos++; else st.abertos++;
      st.extras++;
      const dias = hist.map(h => h && h.data).filter(Boolean);
      if (o.veredito && o.veredito.em) dias.push(String(o.veredito.em).slice(0, 10));
      if (e.updatedAt) dias.push(String(e.updatedAt).slice(0, 10));
      dias.sort();
      if (dias.length && dias[dias.length - 1] > st.ultimoDia) st.ultimoDia = dias[dias.length - 1];
    }
    return out;
  };

  RA.enriquecer = function (r) {
    if (!r) return r;
    const itens = [...((r && r.itens) || []), ...((r && r.pequenas) || [])];
    const ctx = this.contexto(r);
    for (const x of itens) x.prescricaoAdaptativa = this.prescrever(x, r, ctx);
    const sid = itens.map(x => x && x.prescricaoAdaptativa && x.prescricaoAdaptativa.snapshotId).find(Boolean) || null;
    const stats = this._contStats(sid);
    for (const x of itens) {
      const rx = x && x.prescricaoAdaptativa;
      if (!rx) continue;
      const k = this._contKey(x.disciplina, x.nome);
      this._aplicarContinuidade(x, rx, stats.get(k));
    }
    return r;
  };

  /* A ajuda antiga dizia “faça a dose e importe outro retrato”. Isso era verdade
     antes da ponte semanal, mas agora ficaria enganoso. Mantemos o modal original
     e atualizamos apenas a explicação operacional quando ele abrir. */
  if (typeof RA.config === 'function' && !RA._uxv4ConfigCopy) {
    RA._uxv4ConfigCopy = true;
    const cfg = RA.config.bind(RA);
    RA.config = function (...args) {
      /* O wrapper de estabilidade usa `fromCentral`/`returnTab` para fechar a
         Central antes do editor e reabri-la na mesma aba ao sair. A versão
         anterior descartava esses argumentos ao chamar `cfg()`, deixando dois
         overlays vivos ao mesmo tempo. Preserve integralmente o contrato. */
      const out = cfg(...args);
      setTimeout(() => {
        try {
          const calls = [...document.querySelectorAll('.ra-overlay .ra-callout')];
          const alvo = calls.find(el => /Custo estratégico|importe novo retrato/i.test(el.textContent || ''));
          if (alvo) alvo.innerHTML = '<b>Como a dose continua</b><span>A dose é curta de propósito. Se você concluir antes do próximo TEC, o motor roda para outras fraquezas no mesmo dia e pode liberar doses menores nos dias seguintes, dentro de um orçamento seguro do mesmo retrato. A confiança só muda quando chegar uma nova medição.</span>';
        } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ra-copy-v4'); }
      }, 0);
      return out;
    };
  }

  try { if (window.ReforcoFila) ReforcoFila._assinaturaAnterior = ''; } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ra-core-v4'); }
})();
/* ============================================================================
   MENTOR 90+ — regra canônica de decisão V5
   ----------------------------------------------------------------------------
   Esta camada NÃO substitui os cálculos confiáveis já existentes. Ela os
   governa. O motor clássico continua produzindo diagnóstico/custo e o motor
   Bayesiano produz evidência/dose; a V5 transforma ambos numa única decisão:

     medir -> classificar domínio -> estimar valor/tempo -> escolher intervenção
     -> dosar -> rodar/espaçar -> medir de novo.

   Princípios:
     • 85% é domínio operacional, não linha de chegada;
     • 90%+ é domínio competitivo, exigindo confiança e recência;
     • amostra curta gera diagnóstico, não rótulo de fraqueza;
     • incidência de múltiplas bancas é normalizada dentro de cada banca;
     • casamento fraco de nomes perde peso em vez de decidir silenciosamente;
     • tempo, quando medido, substitui “número de questões” como recurso escasso;
     • ausência de ganho após volume NÃO prova falha teórica: troca a intervenção;
     • personalização só cresce quando há ciclos suficientes; antes disso há shrinkage;
     • todo backtest é longitudinal/observacional, nunca chamado de causal.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || !window.ReforcoAdaptativo || window.__mentor90BusinessV5) return;
  window.__mentor90BusinessV5 = true;

  const RA = window.ReforcoAdaptativo;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : lo));
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const norm = (s) => {
    try { if (typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm) return ReforcoEngine.norm(s || ''); }
    catch (_) {}
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };
  const median = (a) => {
    const x = (a || []).map(Number).filter(Number.isFinite).sort((p, q) => p - q);
    if (!x.length) return null;
    const m = Math.floor(x.length / 2);
    return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
  };
  const today = () => { try { return todayLocal(); } catch (_) { return new Date().toISOString().slice(0, 10); } };

  const M90 = {
    VERSAO: 5,
    META_OPERACIONAL: 85,
    META_COMPETITIVA: 90,
    META_ELITE: 92,
    CONFIANCA_COMPETITIVA: .75,
    CONFIANCA_ELITE: .90,
    MIN_CICLOS_PERSONALIZAR: 5,
    MIN_Q_TEMPO: 50,
    MINUTOS_BLOCO: 30,
    _backtestDepth: 0,
    _timeCache: null,

    /* Um perfil novo entra no cérebro canônico. Quem explicitamente desligou a
       prescrição adaptativa continua respeitado: a migração altera apenas o
       default em memória, não grava `ativo:true` sobre uma escolha existente. */
    tornarAdaptativoCanonico() {
      try { if (RA.DEFAULTS && RA.DEFAULTS.ativo === false) RA.DEFAULTS.ativo = true; }
      catch (_) {}
    },

    posteriorMeta(taxa, n, meta) {
      try { return RA.posterior(clamp(taxa, 0, 100), Math.max(0, Math.round(num(n))), meta, 3); }
      catch (_) { return { media: clamp(taxa, 0, 100), pMeta: taxa >= meta ? .5 : 0, pLacuna: taxa < meta - 3 ? .5 : 0, lo: null, hi: null }; }
    },

    dominio(item, r) {
      item = item || {}; r = r || {};
      const n = Math.max(0, Math.round(num(item.qJanela, item.qHist)));
      const taxa = clamp(item.taxa, 0, 100);
      const min = Math.max(1, Math.round(num(r.minAmostra, (() => { try { return PlanoEngine.prefs().minAmostra; } catch (_) { return 20; } })())));
      const op = Math.max(this.META_OPERACIONAL, num(r.meta, this.META_OPERACIONAL));
      const pOp = this.posteriorMeta(taxa, n, op);
      const p90 = this.posteriorMeta(taxa, n, this.META_COMPETITIVA);
      const p92 = this.posteriorMeta(taxa, n, this.META_ELITE);
      const dias = item.diasDesdeMedicao == null ? null : Math.max(0, num(item.diasDesdeMedicao));
      const validade = Math.max(30, num(r.validadeDias, (() => { try { return PlanoEngine.prefs().validadeDias; } catch (_) { return 120; } })()));
      const vencido = dias != null && dias > validade;
      let nivel = 'em_aquisicao', rotulo = 'Em aquisição', ordem = 2;
      if (n < min) { nivel = 'nao_medido'; rotulo = 'Ainda não medido'; ordem = 0; }
      else if (pOp.pLacuna >= .85 && taxa < op - 5) { nivel = 'lacuna_confirmada'; rotulo = 'Lacuna com evidência'; ordem = 1; }
      else if (p90.pMeta >= this.CONFIANCA_ELITE && num(item.medicoes, item.retratosJanela) >= 2 && !vencido) { nivel = 'elite'; rotulo = '90%+ consolidado'; ordem = 6; }
      else if (p90.pMeta >= this.CONFIANCA_COMPETITIVA && !vencido) { nivel = 'competitivo'; rotulo = 'Domínio competitivo'; ordem = 5; }
      else if (pOp.pMeta >= .80) { nivel = vencido ? 'manutencao' : 'operacional'; rotulo = vencido ? 'Domínio a revalidar' : 'Domínio operacional'; ordem = vencido ? 3 : 4; }
      return {
        nivel, rotulo, ordem, taxa, n, metaOperacional: op, metaCompetitiva: this.META_COMPETITIVA,
        pOperacional: clamp(pOp.pMeta, 0, 1), pCompetitiva: clamp(p90.pMeta, 0, 1), pElite: clamp(p92.pMeta, 0, 1),
        intervalo90: { lo: p90.lo, hi: p90.hi }, diasDesdeMedicao: dias, vencido, validadeDias: validade
      };
    },

    /* Aprende velocidade somente quando há minutos realmente registrados. Sem
       dado suficiente, não inventa “2 min/questão”: a fila mantém a política
       antiga por quantidade até existir base pessoal. */
    velocidade(disciplina) {
      const dk = norm(disciplina || '');
      let extras = [];
      try { extras = (typeof DB !== 'undefined' && DB.getExtras) ? (DB.getExtras() || []) : []; } catch (_) {}
      const colher = (filtrarDisc) => {
        let q = 0, min = 0, lanc = 0;
        for (const e of extras) {
          const ed = norm((e && (e.disciplina || (e.origemPlano && e.origemPlano.disciplina))) || '');
          if (filtrarDisc && dk && ed !== dk) continue;
          for (const h of (e && Array.isArray(e.historico) ? e.historico : [])) {
            const qq = Math.max(0, num(h && h.quantidade)), mm = Math.max(0, num(h && h.minutos));
            if (qq > 0 && mm > 0) { q += qq; min += mm; lanc++; }
          }
        }
        return { q, min, lanc };
      };
      let s = colher(true), escopo = 'disciplina';
      if (s.q < this.MIN_Q_TEMPO || s.min <= 0) { s = colher(false); escopo = 'global'; }
      if (s.q < this.MIN_Q_TEMPO || s.min <= 0) return { confiavel: false, segundosPorQuestao: null, q: s.q, lancamentos: s.lanc, escopo };
      return { confiavel: true, segundosPorQuestao: clamp(s.min * 60 / s.q, 30, 600), q: s.q, lancamentos: s.lanc, escopo };
    },

    /* Shrinkage hierárquico: tópico -> disciplina -> global. Poucos ciclos nunca
       ganham autoridade suficiente para “personalizar” o aluno inteiro. */
    calibracaoHierarquica(item) {
      let ciclos = [];
      try { ciclos = (typeof PlanoCiclo !== 'undefined' && PlanoCiclo.fechados) ? (PlanoCiclo.fechados() || []) : []; } catch (_) {}
      const uteis = ciclos.filter(v => v && num(v.questoes) > 0 && v.ganhoPP != null && Number.isFinite(Number(v.ganhoPP)));
      const dk = norm(item && item.disciplina), tk = norm(item && item.nome);
      const grupos = {
        topico: uteis.filter(v => norm(v.disciplina) === dk && norm(v.topico) === tk),
        disciplina: uteis.filter(v => norm(v.disciplina) === dk),
        global: uteis
      };
      const efeito = arr => arr.map(v => clamp(num(v.ganhoPP) / Math.max(1, num(v.questoes)) * 100, -20, 40));
      const globalMed = median(efeito(grupos.global)) ?? 2.5;
      let nivel = 'global', pool = grupos.global;
      if (grupos.topico.length >= 3) { nivel = 'topico'; pool = grupos.topico; }
      else if (grupos.disciplina.length >= this.MIN_CICLOS_PERSONALIZAR) { nivel = 'disciplina'; pool = grupos.disciplina; }
      const med = median(efeito(pool));
      const n = pool.length;
      const k = 5;
      const ganho100 = med == null ? globalMed : (n * med + k * globalMed) / (n + k);
      const confianca = clamp(n / (n + k), 0, 1);
      const qPorPonto = ganho100 > .1 ? clamp(100 / ganho100, .5, 20) : 20;
      return {
        nivel, n, nTopico: grupos.topico.length, nDisciplina: grupos.disciplina.length, nGlobal: grupos.global.length,
        ganho100: Math.round(ganho100 * 10) / 10, qPorPonto: Math.round(qPorPonto * 10) / 10,
        confianca, baixaResposta: n >= this.MIN_CICLOS_PERSONALIZAR && ganho100 < 3
      };
    },

    /* Incidência multi-banca: cada banca vira uma distribuição própria antes da
       média. Assim 10 mil questões disponíveis de uma banca não valem 5x mais
       do que 2 mil questões de outra só porque a base é maior. */
    incidenciaNormalizada(item, r) {
      const fallback = { pct: null, confianca: item && num(item.incid) > 0 ? 1 : 0, fonte: 'legado', bancas: 0 };
      if (!item || typeof ReforcoEngine === 'undefined' || typeof DB === 'undefined' || !DB.getIncidencia) return fallback;
      let rows = [];
      try { rows = DB.getIncidencia() || []; } catch (_) { return fallback; }
      if (!rows.length || typeof ReforcoEngine.incidenceMap !== 'function' || typeof ReforcoEngine.incidenciaDe !== 'function') return fallback;
      let filtro = r && r.banca;
      let bancas;
      if (Array.isArray(filtro)) bancas = filtro.filter(Boolean).filter(x => x !== '__todas__');
      else if (filtro && filtro !== '__todas__') bancas = [filtro];
      else bancas = [...new Set(rows.map(x => x && x.banca).filter(Boolean))];
      if (!bancas.length) return fallback;
      const vals = [], confs = [];
      for (const b of bancas) {
        try {
          const mapa = ReforcoEngine.incidenceMap(b);
          const ach = ReforcoEngine.incidenciaDe(mapa, item.nome, item.disciplina);
          const porDisc = ReforcoEngine.incidPorDisciplina ? (ReforcoEngine.incidPorDisciplina(b) || {}) : {};
          const total = Object.values(porDisc).reduce((s, x) => s + Math.max(0, num(x)), 0);
          const valor = Math.max(0, num(ach && ach.valor));
          if (total > 0) vals.push(100 * valor / total);
          confs.push(!ach || !valor ? 0 : (ach.viaNome ? .55 : .95));
        } catch (_) {}
      }
      if (!vals.length) return fallback;
      return {
        pct: vals.reduce((s, x) => s + x, 0) / vals.length,
        confianca: confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : .5,
        fonte: bancas.length > 1 ? 'normalizada-por-banca' : 'banca-unica', bancas: bancas.length
      };
    },

    intervencao(item, rx, dominio, cal) {
      const dose = Math.max(0, Math.round(num(rx && rx.dose)));
      if (!rx) return null;
      if (rx.objetivo === 'diagnosticar' || dominio.nivel === 'nao_medido') {
        return { tipo: 'diagnostico', rotulo: 'Diagnóstico por questões', passos: [{ tipo: 'questoes', quantidade: dose }], motivo: 'A amostra ainda é pequena; primeiro medir, depois tratar.', exigeNovaMedicao: true };
      }
      if (rx.teoriaPrimeiro || (cal && cal.baixaResposta)) {
        return {
          tipo: 'revisao_questoes', rotulo: 'Revisão dirigida → questões',
          passos: [{ tipo: 'revisao', minutos: 20 }, { tipo: 'questoes', quantidade: Math.max(5, dose) }],
          motivo: 'Volume isolado não mostrou resposta suficiente; mudar a intervenção antes de insistir.', exigeNovaMedicao: true
        };
      }
      if (dominio.nivel === 'manutencao' || dominio.nivel === 'competitivo' || dominio.nivel === 'elite') {
        return { tipo: 'manutencao', rotulo: 'Manutenção espaçada', passos: dose > 0 ? [{ tipo: 'questoes', quantidade: dose }] : [], motivo: 'Preservar domínio com baixa carga e revalidação periódica.', exigeNovaMedicao: dose > 0 };
      }
      return { tipo: 'questoes_dirigidas', rotulo: 'Questões dirigidas', passos: [{ tipo: 'questoes', quantidade: dose }], motivo: 'Há evidência suficiente de lacuna e a prática ainda responde.', exigeNovaMedicao: true };
    },

    enriquecerResultado(r) {
      if (!r || r.erro || this._backtestDepth > 2) return r;
      const itens = [...(r.itens || []), ...(r.pequenas || [])];
      if (!itens.length) return r;

      const enriched = [];
      let maxInc = 0, maxPtsMin = 0;
      for (const x of itens) {
        const rx = x.prescricaoAdaptativa;
        if (!rx) continue;
        const dom = this.dominio(x, r);
        const cal = this.calibracaoHierarquica(x);
        const inc = this.incidenciaNormalizada(x, r);
        const vel = this.velocidade(x.disciplina);
        const minDose = rx.fase === 'pos' ? 5 : 5;
        const maxDose = rx.fase === 'pos' ? 30 : 25;
        let dose = Math.max(0, Math.round(num(rx.dose)));

        // 85% = operacional; não encerra automaticamente uma frente estratégica
        // que ainda não atingiu evidência competitiva de 90%+.
        const importanciaBruta = Math.max(0, num(x.pontosGanho)) + Math.max(0, num(inc.pct)) / 10 + (x.eliminatoria ? 10 : 0);
        const bloqueioContinuidade = !!(rx.continuidade && ['rodar-outro-hoje','aguardar-medicao','ciclo-em-aberto'].includes(rx.continuidade.estado));
        if (!bloqueioContinuidade && dose === 0 && dom.nivel === 'operacional' && dom.pCompetitiva < this.CONFIANCA_COMPETITIVA && importanciaBruta > 0) {
          dose = 8;
          rx.objetivo = 'consolidar';
          rx.confiouMetaOperacional = true;
          rx.confiouMeta = false;
        }
        if (!bloqueioContinuidade && dose === 0 && dom.nivel === 'manutencao') {
          dose = 6;
          rx.objetivo = 'revalidar';
          rx.confiouMeta = false;
        }

        // Quando há tempo medido confiável, a sessão é dimensionada em minutos.
        if (dose > 0 && vel.confiavel) {
          const tetoTempo = Math.max(minDose, Math.floor(this.MINUTOS_BLOCO * 60 / vel.segundosPorQuestao));
          dose = Math.max(minDose, Math.min(dose, tetoTempo, maxDose));
        }
        rx.dose = dose;
        const minEstimados = dose > 0 && vel.confiavel ? dose * vel.segundosPorQuestao / 60 : null;
        const pontosMin = minEstimados > 0 ? Math.max(0, num(x.pontosGanho)) / minEstimados : 0;
        const incEfetiva = inc.pct == null ? Math.max(0, num(x.incid)) : inc.pct * inc.confianca;
        maxInc = Math.max(maxInc, incEfetiva); maxPtsMin = Math.max(maxPtsMin, pontosMin);
        enriched.push({ x, rx, dom, cal, inc, vel, minEstimados, pontosMin, incEfetiva });
      }

      for (const z of enriched) {
        const { x, rx, dom, cal, inc, vel } = z;
        const gap90 = clamp((this.META_COMPETITIVA - dom.taxa) / this.META_COMPETITIVA, 0, 1);
        const evidence = clamp(num(rx.estatistica && rx.estatistica.pLacuna), 0, 1);
        const incN = maxInc > 0 ? clamp(z.incEfetiva / maxInc, 0, 1) : 0;
        const ppmN = maxPtsMin > 0 ? clamp(z.pontosMin / maxPtsMin, 0, 1) : 0;
        const response = clamp((num(cal.ganho100, 2.5) + 2) / 12, 0, 1);
        let canonical;
        if (rx.fase === 'pos') canonical = 100 * (.35 * clamp(num(rx.score) / 100, 0, 1) + .25 * ppmN + .15 * incN + .15 * gap90 + .10 * response);
        else canonical = 100 * (.45 * clamp(num(rx.score) / 100, 0, 1) + .20 * gap90 + .15 * evidence + .10 * incN + .10 * response);
        if (x.eliminatoria) canonical = Math.max(canonical, 95);
        if (dom.nivel === 'elite' && !dom.vencido) canonical *= .25;
        rx.scoreLegado = num(rx.score);
        rx.score = clamp(canonical, 0, 100);
        rx.motorCanonico = 'mentor90-v5';
        rx.dominio90 = dom;
        rx.calibracaoHierarquica = cal;
        rx.incidenciaEstrategica = inc;
        rx.tempo = { confiavel: vel.confiavel, segundosPorQuestao: vel.segundosPorQuestao, minutosEstimados: z.minEstimados, escopo: vel.escopo };
        rx.intervencao = this.intervencao(x, rx, dom, cal);
        rx.racional = {
          regra: rx.fase === 'pos' ? 'pontos/tempo + incidência + risco + evidência' : 'lacuna + evidência + cobertura estratégica + resposta',
          metaOperacional: dom.metaOperacional, metaCompetitiva: dom.metaCompetitiva,
          observacao: 'Prioridade é decisão operacional; não representa causalidade entre atividade e ganho.'
        };
        x.dominio90 = dom;
        x.intervencaoMentor90 = rx.intervencao;
        x.prioridadeMentor90 = rx.score;
      }
      r.mentor90 = {
        versao: this.VERSAO,
        metaOperacional: this.META_OPERACIONAL,
        metaCompetitiva: this.META_COMPETITIVA,
        itens: enriched.length,
        observacao: '85% é domínio operacional; 90%+ é domínio competitivo sustentado por confiança e recência.'
      };
      return r;
    },

    /* Backtest rolling-origin: pergunta “o que o motor teria recomendado com o
       que sabia até ali?” e observa o snapshot seguinte. Não chama isso de
       causalidade e não escreve nada no perfil. */
    backtest(snaps, limite = 3) {
      if (!Array.isArray(snaps) || snaps.length < 2 || typeof PlanoEngine === 'undefined' || typeof DesempenhoTecScreen === 'undefined') return { ok: false, motivo: 'amostra-insuficiente', janelas: [] };
      const ordenados = snaps.slice().sort((a, b) => String(a.endDate || a.date || '').localeCompare(String(b.endDate || b.date || '')));
      const out = [];
      this._backtestDepth++;
      try {
        for (let i = 0; i < ordenados.length - 1; i++) {
          const hist = ordenados.slice(0, i + 1);
          const scoped = hist.length > 1 && DesempenhoTecScreen.aggregate ? DesempenhoTecScreen.aggregate(hist) : hist[hist.length - 1];
          const r = PlanoEngine.calcular(scoped, PlanoEngine.prefs());
          if (!r || r.erro) continue;
          const candidatos = (r.itens || []).slice().sort((a, b) => num(b.prioridadeMentor90, b.prescricaoAdaptativa && b.prescricaoAdaptativa.score) - num(a.prioridadeMentor90, a.prescricaoAdaptativa && a.prescricaoAdaptativa.score)).slice(0, limite);
          const prox = ordenados[i + 1];
          const recs = candidatos.map(x => {
            let depois = null;
            try { depois = PlanoEngine.taxaAtualDe(x.disciplina, x.nome, Object.assign({}, PlanoEngine.prefs(), { _snapshots: [prox], _semExclusao: true })); } catch (_) {}
            const pctDepois = depois && depois.pct != null ? num(depois.pct) : null;
            return { disciplina: x.disciplina, topico: x.nome, antes: num(x.taxa), depois: pctDepois, delta: pctDepois == null ? null : Math.round((pctDepois - num(x.taxa)) * 10) / 10, prioridade: num(x.prioridadeMentor90, x.prescricaoAdaptativa && x.prescricaoAdaptativa.score), intervencao: x.intervencaoMentor90 && x.intervencaoMentor90.tipo };
          });
          out.push({ ate: hist[hist.length - 1].endDate || hist[hist.length - 1].date || null, proximo: prox.endDate || prox.date || null, recomendacoes: recs });
        }
      } finally { this._backtestDepth--; }
      const deltas = out.flatMap(j => j.recomendacoes.map(x => x.delta).filter(Number.isFinite));
      return { ok: true, metodologia: 'rolling-origin observacional; associação longitudinal, não inferência causal', janelas: out, n: deltas.length, deltaMedianoPP: median(deltas) };
    },

    instalar() {
      this.tornarAdaptativoCanonico();

      // Personalização robusta entra ANTES da prescrição base calcular learn/baixaResposta.
      if (typeof RA.historico === 'function' && !RA._mentor90HistoricoBase) {
        RA._mentor90HistoricoBase = RA.historico.bind(RA);
        const self = this;
        RA.historico = function(item, p) {
          const h = RA._mentor90HistoricoBase(item, p) || {};
          const c = self.calibracaoHierarquica(item);
          if (c.n >= self.MIN_CICLOS_PERSONALIZAR) {
            h.learn = clamp((c.ganho100 + 2) / 12, 0, 1.5);
            h.baixaResposta = c.baixaResposta;
            h.mentor90 = c;
          }
          return h;
        };
      }

      // A passagem V4 continua responsável por posterior + continuidade; a V5
      // é a única passagem final que transforma isso em decisão de negócio.
      if (typeof RA.enriquecer === 'function' && !RA._mentor90EnriquecerBase) {
        RA._mentor90EnriquecerBase = RA.enriquecer.bind(RA);
        const self = this;
        RA.enriquecer = function(r) {
          const out = RA._mentor90EnriquecerBase(r);
          return self.enriquecerResultado(out);
        };
      }

      // A explicação deixa de mostrar só “dose” e passa a mostrar a decisão:
      // domínio 90+, custo temporal, confiança de incidência e intervenção.
      if (typeof RA.info === 'function' && !RA._mentor90InfoBase) {
        RA._mentor90InfoBase = RA.info.bind(RA);
        RA.info = function(rx, nome) {
          const out = RA._mentor90InfoBase(rx, nome);
          setTimeout(() => {
            try {
              if (!rx || !rx.dominio90) return;
              const body = [...document.querySelectorAll('.ra-overlay .ra-info-body')].pop();
              if (!body || body.querySelector('.mentor90-info')) return;
              const d = rx.dominio90, it = rx.intervencao, inc = rx.incidenciaEstrategica, tp = rx.tempo;
              const box = document.createElement('div'); box.className = 'mentor90-info';
              const pct = v => v == null ? '—' : (100 * v).toFixed(0) + '%';
              box.innerHTML = `<p><b>Régua Mentor 90+</b> · ${d.rotulo}. Probabilidade de domínio ≥${d.metaOperacional}%: <b>${pct(d.pOperacional)}</b>; ≥${d.metaCompetitiva}%: <b>${pct(d.pCompetitiva)}</b>.</p>`
                + (it ? `<p><b>Intervenção:</b> ${it.rotulo}. ${it.motivo}</p>` : '')
                + (tp && tp.confiavel ? `<p><b>Custo temporal:</b> ~${Math.max(1, Math.round(tp.minutosEstimados || 0))} min nesta dose, calibrado pelo seu histórico de execução.</p>` : '<p><b>Custo temporal:</b> ainda sem base pessoal suficiente; a fila mantém a régua por questões.</p>')
                + (inc && inc.pct != null ? `<p><b>Incidência estratégica:</b> ${inc.pct.toFixed(2)}% após normalizar ${inc.bancas} banca(s); confiança do casamento ${(100 * inc.confianca).toFixed(0)}%.</p>` : '');
              body.appendChild(box);
            } catch (_) {}
          }, 0);
          return out;
        };
      }

      // Scheduler por tempo apenas quando há base pessoal suficiente; caso
      // contrário preserva exatamente a política atual de 10–25 questões.
      try {
        if (typeof ReforcoFila !== 'undefined' && typeof ReforcoFila.tamanhoBloco === 'function' && !ReforcoFila._mentor90TamanhoBase) {
          ReforcoFila._mentor90TamanhoBase = ReforcoFila.tamanhoBloco;
          const self = this;
          ReforcoFila.tamanhoBloco = function(restante, e) {
            const q = ReforcoFila._mentor90TamanhoBase.call(this, restante, e);
            const v = self.velocidade(e && (e.disciplina || (e.origemPlano && e.origemPlano.disciplina)));
            if (!v.confiavel || !(q > 0)) return q;
            const cap = Math.max(5, Math.floor(self.MINUTOS_BLOCO * 60 / v.segundosPorQuestao));
            return Math.max(1, Math.min(q, cap));
          };
        }
      } catch (_) {}

      // Corrige a linguagem determinística sem tocar na lógica/histórico.
      try {
        if (typeof DesempenhoTecScreen !== 'undefined' && typeof DesempenhoTecScreen.renderPlanoConteudo === 'function' && !DesempenhoTecScreen._mentor90CopyBase) {
          DesempenhoTecScreen._mentor90CopyBase = DesempenhoTecScreen.renderPlanoConteudo;
          DesempenhoTecScreen.renderPlanoConteudo = function() {
            const out = DesempenhoTecScreen._mentor90CopyBase.apply(this, arguments);
            setTimeout(() => {
              try {
                const host = document.getElementById('tec-panel-plano'); if (!host || typeof NodeFilter === 'undefined') return;
                if (!host.querySelector('.mentor90-ruler')) { const p=document.createElement('p'); p.className='pl-ciclo-obs mentor90-ruler'; p.innerHTML='<b>Régua Mentor 90+:</b> 85% = domínio operacional; 90%+ = domínio competitivo. Um assunto pode sair da força-tarefa aos 85% sem sair da manutenção.'; host.prepend(p); }
                const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT); let n;
                while ((n = tw.nextNode())) {
                  n.nodeValue = n.nodeValue
                    .replace(/cravar uma melhora/gi, 'sustentar evidência de melhora')
                    .replace(/o buraco é de teoria, não de volume/gi, 'volume isolado não mostrou resposta suficiente; revise a causa antes de insistir')
                    .replace(/a lacuna é crítica ou o histórico mostra baixa resposta a volume puro/gi, 'a evidência indica lacuna relevante ou baixa resposta a volume puro');
                }
              } catch (_) {}
            }, 0);
            return out;
          };
        }
      } catch (_) {}

      // Auditoria passa a declarar explicitamente a natureza observacional e
      // expõe o backtest sem alterar o JSON legado que consumidores esperam.
      try {
        if (typeof PlanoAuditoria !== 'undefined' && typeof PlanoAuditoria.gerar === 'function' && !PlanoAuditoria._mentor90GerarBase) {
          PlanoAuditoria._mentor90GerarBase = PlanoAuditoria.gerar;
          const self = this;
          PlanoAuditoria.gerar = function() {
            const a = PlanoAuditoria._mentor90GerarBase.apply(this, arguments) || {};
            let snaps = []; try { snaps = DB.getTecSnapshots() || []; } catch (_) {}
            a.mentor90 = {
              versao: self.VERSAO,
              metas: { operacional: self.META_OPERACIONAL, competitiva: self.META_COMPETITIVA, elite: self.META_ELITE },
              causalidade: 'Os ciclos são evidência longitudinal observacional de resposta; não isolam causalidade.',
              backtest: self.backtest(snaps, 3)
            };
            return a;
          };
        }
      } catch (_) {}

      try { if (typeof ReforcoFila !== 'undefined') ReforcoFila._assinaturaAnterior = ''; } catch (_) {}
    }
  };

  M90.instalar();
  window.Mentor90V5 = M90;
})();
