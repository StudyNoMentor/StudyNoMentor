/* ============================================================================
   MENTOR 90+ V5 — decisão estratégica em modo sombra + executor opt-in
   ----------------------------------------------------------------------------
   Objetivo: unificar domínio, prioridade, incidência, custo temporal e
   intervenção sem alterar silenciosamente o contrato maduro do Plano/Extras.

   Contrato de segurança:
     • RA.ativo=false (padrão legado) => MODO SOMBRA. Calcula, audita e explica,
       mas NÃO muda dose, alvo, status, cooldown nem conclusão de atividade.
     • RA.ativo=true (escolha explícita) => MODO EXECUTOR. A V5 pode limitar o
       BLOCO DIÁRIO por tempo e enriquecer a decisão, mas o alvo global da
       atividade continua soberano e nunca é substituído pela dose diária.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || !window.ReforcoAdaptativo || window.__mentor90BusinessV5) return;
  window.__mentor90BusinessV5 = true;

  const RA = window.ReforcoAdaptativo;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : lo));
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const report = (e, ctx) => { if (typeof _quiet === 'function') _quiet(e, ctx); };
  const norm = (s) => {
    try {
      if (typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm) return ReforcoEngine.norm(s || '');
    } catch (e) { report(e, 'mentor90-norm'); }
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };
  const median = (a) => {
    const x = (a || []).map(Number).filter(Number.isFinite).sort((p, q) => p - q);
    if (!x.length) return null;
    const m = Math.floor(x.length / 2);
    return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
  };

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
    CACHE_MS: 1500,
    _backtestDepth: 0,
    _timeCache: null,
    _calCache: null,
    _incCache: null,

    executorAtivo() {
      try { return !!(RA.prefs && RA.prefs().ativo); }
      catch (e) { report(e, 'mentor90-executor-ativo'); return false; }
    },

    modo() { return this.executorAtivo() ? 'executor' : 'sombra'; },

    posteriorMeta(taxa, n, meta) {
      try { return RA.posterior(clamp(taxa, 0, 100), Math.max(0, Math.round(num(n))), meta, 3); }
      catch (e) {
        report(e, 'mentor90-posterior');
        return { media: clamp(taxa, 0, 100), pMeta: taxa >= meta ? .5 : 0, pLacuna: taxa < meta - 3 ? .5 : 0, lo: null, hi: null };
      }
    },

    dominio(item, r) {
      item = item || {}; r = r || {};
      const n = Math.max(0, Math.round(num(item.qJanela, item.qHist)));
      const taxa = clamp(item.taxa, 0, 100);
      let minAmostra = 20, validade = 120;
      try {
        const p = typeof PlanoEngine !== 'undefined' && PlanoEngine.prefs ? PlanoEngine.prefs() : {};
        minAmostra = Math.max(1, Math.round(num(r.minAmostra, p.minAmostra || 20)));
        validade = Math.max(30, num(r.validadeDias, p.validadeDias || 120));
      } catch (e) { report(e, 'mentor90-dominio-prefs'); }
      const operacional = Math.max(this.META_OPERACIONAL, num(r.meta, this.META_OPERACIONAL));
      const pOp = this.posteriorMeta(taxa, n, operacional);
      const p90 = this.posteriorMeta(taxa, n, this.META_COMPETITIVA);
      const p92 = this.posteriorMeta(taxa, n, this.META_ELITE);
      const dias = item.diasDesdeMedicao == null ? null : Math.max(0, num(item.diasDesdeMedicao));
      const vencido = dias != null && dias > validade;
      let nivel = 'em_aquisicao', rotulo = 'Em aquisição', ordem = 2;
      if (n < minAmostra) { nivel = 'nao_medido'; rotulo = 'Ainda não medido'; ordem = 0; }
      else if (pOp.pLacuna >= .85 && taxa < operacional - 5) { nivel = 'lacuna_confirmada'; rotulo = 'Lacuna com evidência'; ordem = 1; }
      else if (p90.pMeta >= this.CONFIANCA_ELITE && num(item.medicoes, item.retratosJanela) >= 2 && !vencido) { nivel = 'elite'; rotulo = '90%+ consolidado'; ordem = 6; }
      else if (p90.pMeta >= this.CONFIANCA_COMPETITIVA && !vencido) { nivel = 'competitivo'; rotulo = 'Domínio competitivo'; ordem = 5; }
      else if (pOp.pMeta >= .80) { nivel = vencido ? 'manutencao' : 'operacional'; rotulo = vencido ? 'Domínio a revalidar' : 'Domínio operacional'; ordem = vencido ? 3 : 4; }
      return {
        nivel, rotulo, ordem, taxa, n, minAmostra,
        metaOperacional: operacional, metaCompetitiva: this.META_COMPETITIVA,
        pOperacional: clamp(pOp.pMeta, 0, 1), pCompetitiva: clamp(p90.pMeta, 0, 1), pElite: clamp(p92.pMeta, 0, 1),
        intervalo90: { lo: p90.lo, hi: p90.hi }, diasDesdeMedicao: dias, vencido, validadeDias: validade
      };
    },

    velocidade(disciplina) {
      const agora = Date.now();
      if (!this._timeCache || agora - this._timeCache.at > this.CACHE_MS) {
        const porDisc = new Map(), global = { q: 0, min: 0, lanc: 0 };
        let extras = [];
        try { extras = (typeof DB !== 'undefined' && DB.getExtras) ? (DB.getExtras() || []) : []; }
        catch (e) { report(e, 'mentor90-velocidade-extras'); }
        for (const e of extras) {
          const dk = norm((e && (e.disciplina || (e.origemPlano && e.origemPlano.disciplina))) || '');
          if (!porDisc.has(dk)) porDisc.set(dk, { q: 0, min: 0, lanc: 0 });
          const d = porDisc.get(dk);
          for (const h of (e && Array.isArray(e.historico) ? e.historico : [])) {
            const q = Math.max(0, num(h && h.quantidade)), min = Math.max(0, num(h && h.minutos));
            if (!(q > 0 && min > 0)) continue;
            d.q += q; d.min += min; d.lanc++;
            global.q += q; global.min += min; global.lanc++;
          }
        }
        this._timeCache = { at: agora, porDisc, global };
      }
      const dk = norm(disciplina || '');
      let s = this._timeCache.porDisc.get(dk) || { q: 0, min: 0, lanc: 0 }, escopo = 'disciplina';
      if (s.q < this.MIN_Q_TEMPO || s.min <= 0) { s = this._timeCache.global; escopo = 'global'; }
      if (s.q < this.MIN_Q_TEMPO || s.min <= 0) return { confiavel: false, segundosPorQuestao: null, q: s.q, lancamentos: s.lanc, escopo };
      return { confiavel: true, segundosPorQuestao: clamp(s.min * 60 / s.q, 30, 600), q: s.q, lancamentos: s.lanc, escopo };
    },

    calibracaoHierarquica(item) {
      const agora = Date.now();
      if (!this._calCache || agora - this._calCache.at > this.CACHE_MS) {
        let ciclos = [];
        try { ciclos = (typeof PlanoCiclo !== 'undefined' && PlanoCiclo.fechados) ? (PlanoCiclo.fechados() || []) : []; }
        catch (e) { report(e, 'mentor90-calibracao-ciclos'); }
        const uteis = ciclos.filter(v => v && num(v.questoes) > 0 && v.ganhoPP != null && Number.isFinite(Number(v.ganhoPP)));
        const porDisc = new Map(), porTop = new Map(), global = [];
        for (const v of uteis) {
          const ganho100 = clamp(num(v.ganhoPP) / Math.max(1, num(v.questoes)) * 100, -20, 40);
          const d = norm(v.disciplina), t = norm(v.topico), k = d + '\u0001' + t;
          global.push(ganho100);
          if (!porDisc.has(d)) porDisc.set(d, []);
          if (!porTop.has(k)) porTop.set(k, []);
          porDisc.get(d).push(ganho100); porTop.get(k).push(ganho100);
        }
        this._calCache = { at: agora, porDisc, porTop, global, globalMed: median(global) ?? 2.5 };
      }
      const dk = norm(item && item.disciplina), tk = norm(item && item.nome);
      const top = this._calCache.porTop.get(dk + '\u0001' + tk) || [];
      const disc = this._calCache.porDisc.get(dk) || [];
      const global = this._calCache.global;
      let nivel = 'global', pool = global;
      if (top.length >= 3) { nivel = 'topico'; pool = top; }
      else if (disc.length >= this.MIN_CICLOS_PERSONALIZAR) { nivel = 'disciplina'; pool = disc; }
      const n = pool.length, k = 5, med = median(pool), base = this._calCache.globalMed;
      const ganho100 = med == null ? base : (n * med + k * base) / (n + k);
      const qPorPonto = ganho100 > .1 ? clamp(100 / ganho100, .5, 20) : 20;
      return {
        nivel, n, nTopico: top.length, nDisciplina: disc.length, nGlobal: global.length,
        ganho100: Math.round(ganho100 * 10) / 10, qPorPonto: Math.round(qPorPonto * 10) / 10,
        confianca: clamp(n / (n + k), 0, 1), baixaResposta: n >= this.MIN_CICLOS_PERSONALIZAR && ganho100 < 3
      };
    },

    incidenciaNormalizada(item, r) {
      const fallback = { pct: null, confianca: item && num(item.incid) > 0 ? 1 : 0, fonte: 'legado', bancas: 0 };
      if (!item || typeof ReforcoEngine === 'undefined' || typeof DB === 'undefined' || !DB.getIncidencia) return fallback;
      if (typeof ReforcoEngine.incidenceMap !== 'function' || typeof ReforcoEngine.incidenciaDe !== 'function') return fallback;
      const agora = Date.now();
      if (!this._incCache || agora - this._incCache.at > this.CACHE_MS) {
        let rows = [];
        try { rows = DB.getIncidencia() || []; }
        catch (e) { report(e, 'mentor90-incidencia-rows'); return fallback; }
        this._incCache = { at: agora, conjuntos: new Map(), bancas: [...new Set(rows.map(x => x && x.banca).filter(Boolean))], temDados: rows.length > 0 };
      }
      if (!this._incCache.temDados) return fallback;
      let filtro = r && r.banca, bancas;
      if (Array.isArray(filtro)) bancas = filtro.filter(Boolean).filter(x => x !== '__todas__');
      else if (filtro && filtro !== '__todas__') bancas = [filtro];
      else bancas = this._incCache.bancas.slice();
      if (!bancas.length) return fallback;
      const key = bancas.slice().sort().join('\u0001');
      let prep = this._incCache.conjuntos.get(key);
      if (!prep) {
        prep = [];
        for (const b of bancas) {
          try {
            const mapa = ReforcoEngine.incidenceMap(b);
            const porDisc = ReforcoEngine.incidPorDisciplina ? (ReforcoEngine.incidPorDisciplina(b) || {}) : {};
            const total = Object.values(porDisc).reduce((s, x) => s + Math.max(0, num(x)), 0);
            prep.push({ mapa, total });
          } catch (e) { report(e, 'mentor90-incidencia-mapa'); }
        }
        this._incCache.conjuntos.set(key, prep);
      }
      const vals = [], confs = [];
      for (const z of prep) {
        try {
          const ach = ReforcoEngine.incidenciaDe(z.mapa, item.nome, item.disciplina);
          const valor = Math.max(0, num(ach && ach.valor));
          if (z.total > 0) vals.push(100 * valor / z.total);
          confs.push(!ach || !valor ? 0 : (ach.viaNome ? .55 : .95));
        } catch (e) { report(e, 'mentor90-incidencia-match'); }
      }
      if (!vals.length) return fallback;
      return {
        pct: vals.reduce((s, x) => s + x, 0) / vals.length,
        confianca: confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : .5,
        fonte: bancas.length > 1 ? 'normalizada-por-banca' : 'banca-unica', bancas: bancas.length
      };
    },

    doseDiaria(item, rx, vel, dom) {
      const base = rx && num(rx.dose) > 0 ? Math.round(num(rx.dose)) : (dom.nivel === 'nao_medido' ? 15 : 12);
      if (!(base > 0)) return 0;
      if (!vel.confiavel) return base;
      const cap = Math.max(5, Math.floor(this.MINUTOS_BLOCO * 60 / vel.segundosPorQuestao));
      return Math.max(5, Math.min(base, cap, 30));
    },

    intervencao(item, rx, dom, cal, dose) {
      if (dom.nivel === 'nao_medido' || (rx && rx.objetivo === 'diagnosticar')) {
        return { tipo: 'diagnostico', rotulo: 'Diagnóstico por questões', passos: [{ tipo: 'questoes', quantidade: dose }], motivo: 'A amostra ainda é pequena; primeiro medir, depois tratar.', exigeNovaMedicao: true };
      }
      if ((rx && rx.teoriaPrimeiro) || cal.baixaResposta) {
        return { tipo: 'revisao_questoes', rotulo: 'Revisão dirigida → questões', passos: [{ tipo: 'revisao', minutos: 20 }, { tipo: 'questoes', quantidade: Math.max(5, dose) }], motivo: 'Volume isolado não mostrou resposta suficiente; mude a intervenção antes de insistir.', exigeNovaMedicao: true };
      }
      if (['manutencao','competitivo','elite'].includes(dom.nivel)) {
        return { tipo: 'manutencao', rotulo: 'Manutenção espaçada', passos: dose > 0 ? [{ tipo: 'questoes', quantidade: dose }] : [], motivo: 'Preservar domínio com baixa carga e revalidação periódica.', exigeNovaMedicao: dose > 0 };
      }
      return { tipo: 'questoes_dirigidas', rotulo: 'Questões dirigidas', passos: [{ tipo: 'questoes', quantidade: dose }], motivo: 'Há evidência de lacuna e a prática ainda responde.', exigeNovaMedicao: true };
    },

    prioridade(item, rx, dom, cal, inc, vel, maxInc, maxPpm) {
      const gap90 = clamp((this.META_COMPETITIVA - dom.taxa) / this.META_COMPETITIVA, 0, 1);
      const evidence = clamp(num(rx && rx.estatistica && rx.estatistica.pLacuna, dom.nivel === 'lacuna_confirmada' ? .9 : .4), 0, 1);
      const incEfetiva = inc.pct == null ? Math.max(0, num(item.incid)) : inc.pct * inc.confianca;
      const incN = maxInc > 0 ? clamp(incEfetiva / maxInc, 0, 1) : 0;
      const minutos = vel.confiavel ? Math.max(1, num(item.custoQ, 20) * vel.segundosPorQuestao / 60) : null;
      const ppm = minutos ? Math.max(0, num(item.pontosGanho)) / minutos : 0;
      const ppmN = maxPpm > 0 ? clamp(ppm / maxPpm, 0, 1) : 0;
      const response = clamp((num(cal.ganho100, 2.5) + 2) / 12, 0, 1);
      const legado = clamp(num(rx && rx.score, gap90 * 100) / 100, 0, 1);
      let score = rx && rx.fase === 'pos'
        ? 100 * (.35 * legado + .25 * ppmN + .15 * incN + .15 * gap90 + .10 * response)
        : 100 * (.45 * legado + .20 * gap90 + .15 * evidence + .10 * incN + .10 * response);
      if (item.eliminatoria) score = Math.max(score, 95);
      if (dom.nivel === 'elite' && !dom.vencido) score *= .25;
      return clamp(score, 0, 100);
    },

    enriquecerResultado(r) {
      if (!r || r.erro || this._backtestDepth > 2) return r;
      const itens = [...(r.itens || []), ...(r.pequenas || [])];
      if (!itens.length) return r;
      const base = [];
      let maxInc = 0, maxPpm = 0;
      for (const x of itens) {
        const rx = x.prescricaoAdaptativa || null;
        const dom = this.dominio(x, r), cal = this.calibracaoHierarquica(x), inc = this.incidenciaNormalizada(x, r), vel = this.velocidade(x.disciplina);
        const dose = this.doseDiaria(x, rx, vel, dom);
        const incEfetiva = inc.pct == null ? Math.max(0, num(x.incid)) : inc.pct * inc.confianca;
        const minutos = vel.confiavel ? dose * vel.segundosPorQuestao / 60 : null;
        const ppm = minutos > 0 ? Math.max(0, num(x.pontosGanho)) / minutos : 0;
        maxInc = Math.max(maxInc, incEfetiva); maxPpm = Math.max(maxPpm, ppm);
        base.push({ x, rx, dom, cal, inc, vel, dose, minutos, incEfetiva, ppm });
      }
      const modo = this.modo();
      for (const z of base) {
        const score = this.prioridade(z.x, z.rx, z.dom, z.cal, z.inc, z.vel, maxInc, maxPpm);
        const interv = this.intervencao(z.x, z.rx, z.dom, z.cal, z.dose);
        const decisao = {
          versao: this.VERSAO, motorCanonico: 'mentor90-v5', modo,
          score, dominio90: z.dom, calibracaoHierarquica: z.cal,
          incidenciaEstrategica: z.inc,
          tempo: { confiavel: z.vel.confiavel, segundosPorQuestao: z.vel.segundosPorQuestao, minutosEstimados: z.minutos, escopo: z.vel.escopo },
          doseDiaria: z.dose, intervencao: interv,
          racional: {
            regra: z.rx && z.rx.fase === 'pos' ? 'pontos/tempo + incidência + risco + evidência' : 'lacuna + evidência + cobertura estratégica + resposta',
            observacao: 'Prioridade é decisão operacional; não representa causalidade entre atividade e ganho.'
          }
        };
        z.x.mentor90 = decisao;
        z.x.dominio90 = z.dom;
        z.x.intervencaoMentor90 = interv;
        z.x.prioridadeMentor90 = score;
        if (z.rx && modo === 'executor') {
          z.rx.motorCanonico = 'mentor90-v5';
          z.rx.scoreLegado = num(z.rx.score);
          z.rx.score = score;
          z.rx.dominio90 = z.dom;
          z.rx.calibracaoHierarquica = z.cal;
          z.rx.incidenciaEstrategica = z.inc;
          z.rx.tempo = decisao.tempo;
          z.rx.doseMentor90 = z.dose;
          z.rx.intervencao = interv;
          /* INTENCIONAL: z.rx.dose permanece intacta. `doseMentor90` é bloco do
             dia; `dose`/`alvo` do ciclo continuam sob o contrato legado. */
        }
      }
      r.mentor90 = {
        versao: this.VERSAO, modo,
        metaOperacional: this.META_OPERACIONAL, metaCompetitiva: this.META_COMPETITIVA,
        itens: base.length,
        observacao: modo === 'sombra'
          ? 'Modo sombra: calcula e audita sem alterar execução. 85% = domínio operacional; 90%+ = domínio competitivo.'
          : 'Executor opt-in: dose diária e alvo global permanecem grandezas separadas.'
      };
      return r;
    },

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
          const candidatos = (r.itens || []).slice().sort((a, b) => num(b.prioridadeMentor90) - num(a.prioridadeMentor90)).slice(0, limite);
          const prox = ordenados[i + 1];
          const recs = candidatos.map(x => {
            let depois = null;
            try { depois = PlanoEngine.taxaAtualDe(x.disciplina, x.nome, Object.assign({}, PlanoEngine.prefs(), { _snapshots: [prox], _semExclusao: true })); }
            catch (e) { report(e, 'mentor90-backtest-taxa'); }
            const pctDepois = depois && depois.pct != null ? num(depois.pct) : null;
            return { disciplina: x.disciplina, topico: x.nome, antes: num(x.taxa), depois: pctDepois, delta: pctDepois == null ? null : Math.round((pctDepois - num(x.taxa)) * 10) / 10, prioridade: num(x.prioridadeMentor90), intervencao: x.intervencaoMentor90 && x.intervencaoMentor90.tipo };
          });
          out.push({ ate: hist[hist.length - 1].endDate || hist[hist.length - 1].date || null, proximo: prox.endDate || prox.date || null, recomendacoes: recs });
        }
      } finally { this._backtestDepth--; }
      const deltas = out.flatMap(j => j.recomendacoes.map(x => x.delta).filter(Number.isFinite));
      return { ok: true, metodologia: 'rolling-origin observacional; associação longitudinal, não inferência causal', janelas: out, n: deltas.length, deltaMedianoPP: median(deltas) };
    },

    invalidarCaches() { this._timeCache = null; this._calCache = null; this._incCache = null; },

    instalar() {
      if (typeof RA.historico === 'function' && !RA._mentor90HistoricoBase) {
        RA._mentor90HistoricoBase = RA.historico.bind(RA);
        const self = this;
        RA.historico = function(item, p) {
          const h = RA._mentor90HistoricoBase(item, p) || {};
          if (!self.executorAtivo()) return h;
          const c = self.calibracaoHierarquica(item);
          if (c.n >= self.MIN_CICLOS_PERSONALIZAR) {
            h.learn = clamp((c.ganho100 + 2) / 12, 0, 1.5);
            h.baixaResposta = c.baixaResposta;
            h.mentor90 = c;
          }
          return h;
        };
      }

      if (typeof RA.enriquecer === 'function' && !RA._mentor90EnriquecerBase) {
        RA._mentor90EnriquecerBase = RA.enriquecer.bind(RA);
        const self = this;
        RA.enriquecer = function(r) { return self.enriquecerResultado(RA._mentor90EnriquecerBase(r)); };
      }

      try {
        if (typeof ReforcoFila !== 'undefined' && typeof ReforcoFila.tamanhoBloco === 'function' && !ReforcoFila._mentor90TamanhoBase) {
          ReforcoFila._mentor90TamanhoBase = ReforcoFila.tamanhoBloco;
          const self = this;
          ReforcoFila.tamanhoBloco = function(restante, e) {
            const q = ReforcoFila._mentor90TamanhoBase.call(this, restante, e);
            if (!self.executorAtivo()) return q;
            const v = self.velocidade(e && (e.disciplina || (e.origemPlano && e.origemPlano.disciplina)));
            if (!v.confiavel || !(q > 0)) return q;
            const cap = Math.max(5, Math.floor(self.MINUTOS_BLOCO * 60 / v.segundosPorQuestao));
            return Math.max(1, Math.min(q, cap, Math.max(1, num(restante, q))));
          };
        }
      } catch (e) { report(e, 'mentor90-fila'); }

      try {
        if (typeof PlanoCiclo !== 'undefined' && typeof PlanoCiclo.origem === 'function' && !PlanoCiclo._mentor90OrigemBase) {
          PlanoCiclo._mentor90OrigemBase = PlanoCiclo.origem;
          PlanoCiclo.origem = function(topico, disciplina, item, opts) {
            const o = PlanoCiclo._mentor90OrigemBase.apply(this, arguments) || {};
            if (item && item.mentor90) o.mentor90 = Object.assign({}, item.mentor90, { criadoEm: new Date().toISOString() });
            return o;
          };
        }
      } catch (e) { report(e, 'mentor90-origem'); }

      try {
        if (typeof DesempenhoTecScreen !== 'undefined' && typeof DesempenhoTecScreen.criarExtraDoPlano === 'function' && !DesempenhoTecScreen._mentor90CriarBase) {
          DesempenhoTecScreen._mentor90CriarBase = DesempenhoTecScreen.criarExtraDoPlano;
          const self = this;
          DesempenhoTecScreen.criarExtraDoPlano = function(topico, disciplina, alvo, motivo, lote) {
            let antes = new Set();
            try { antes = new Set((DB.getExtras() || []).map(e => e && e.id)); }
            catch (e) { report(e, 'mentor90-extra-antes'); }
            const ok = DesempenhoTecScreen._mentor90CriarBase.apply(this, arguments);
            if (!ok) return ok;
            try {
              const extras = DB.getExtras() || [];
              const e = extras.find(x => x && !antes.has(x.id) && x.origemPlano && norm(x.origemPlano.topico) === norm(topico) && norm(x.origemPlano.disciplina) === norm(disciplina));
              const m = e && e.origemPlano && e.origemPlano.mentor90;
              if (e && m && typeof DB.updateExtra === 'function') {
                const patch = { mentor90: m };
                if (self.executorAtivo() && m.intervencao) {
                  const passos = (m.intervencao.passos || []).map(p => p.tipo === 'revisao' ? `${p.minutos || 20} min de revisão dirigida` : p.tipo === 'questoes' ? `${p.quantidade || m.doseDiaria} questões` : p.tipo).join(' → ');
                  patch.obs = `Mentor 90+: ${m.intervencao.rotulo}. ${passos ? passos + '. ' : ''}${m.intervencao.motivo || ''}`;
                }
                DB.updateExtra(e.id, patch);
                self.invalidarCaches();
              }
            } catch (e) { report(e, 'mentor90-extra-depois'); }
            return ok;
          };
        }
      } catch (e) { report(e, 'mentor90-extra-wrap'); }

      try {
        if (typeof PlanoAuditoria !== 'undefined' && typeof PlanoAuditoria.gerar === 'function' && !PlanoAuditoria._mentor90GerarBase) {
          PlanoAuditoria._mentor90GerarBase = PlanoAuditoria.gerar;
          const self = this;
          PlanoAuditoria.gerar = function() {
            const a = PlanoAuditoria._mentor90GerarBase.apply(this, arguments) || {};
            let snaps = [];
            try { snaps = DB.getTecSnapshots() || []; }
            catch (e) { report(e, 'mentor90-auditoria-snaps'); }
            a.mentor90 = {
              versao: self.VERSAO, modo: self.modo(),
              metas: { operacional: self.META_OPERACIONAL, competitiva: self.META_COMPETITIVA, elite: self.META_ELITE },
              causalidade: 'Os ciclos são evidência longitudinal observacional de resposta; não isolam causalidade.',
              backtest: self.backtest(snaps, 3)
            };
            return a;
          };
        }
      } catch (e) { report(e, 'mentor90-auditoria-wrap'); }

      try { if (typeof ReforcoFila !== 'undefined') ReforcoFila._assinaturaAnterior = ''; }
      catch (e) { report(e, 'mentor90-fila-reset'); }
    }
  };

  window.Mentor90V5 = M90;
  M90.instalar();
})();
