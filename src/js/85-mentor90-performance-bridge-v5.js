/* ============================================================================
   MENTOR 90+ V5 — cache das bases + ponte Plano -> Extras
   ----------------------------------------------------------------------------
   A regra canônica nasce no módulo 84. Esta camada final não cria outro motor:
   ela só substitui três leituras O(n) por caches curtos e garante que a decisão
   pedagógica calculada no Plano acompanhe a atividade criada em Extras.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || !window.Mentor90V5 || window.__mentor90PerfBridgeV5) return;
  window.__mentor90PerfBridgeV5 = true;
  const M90 = window.Mentor90V5;
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : lo));
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

  M90.CACHE_MS = 1500;
  M90._timeCache = null;
  M90._calCache = null;
  M90._incCache = null;

  M90.velocidade = function(disciplina) {
    const agora = Date.now();
    if (!this._timeCache || agora - this._timeCache.at > this.CACHE_MS) {
      const porDisc = new Map();
      const global = { q: 0, min: 0, lanc: 0 };
      let extras = [];
      try { extras = (typeof DB !== 'undefined' && DB.getExtras) ? (DB.getExtras() || []) : []; } catch (_) {}
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
  };

  M90.calibracaoHierarquica = function(item) {
    const agora = Date.now();
    if (!this._calCache || agora - this._calCache.at > this.CACHE_MS) {
      let ciclos = [];
      try { ciclos = (typeof PlanoCiclo !== 'undefined' && PlanoCiclo.fechados) ? (PlanoCiclo.fechados() || []) : []; } catch (_) {}
      const uteis = ciclos.filter(v => v && num(v.questoes) > 0 && v.ganhoPP != null && Number.isFinite(Number(v.ganhoPP)));
      const efeitos = uteis.map(v => ({
        d: norm(v.disciplina), t: norm(v.topico),
        ganho100: clamp(num(v.ganhoPP) / Math.max(1, num(v.questoes)) * 100, -20, 40)
      }));
      const porDisc = new Map(), porTop = new Map(), global = efeitos.map(x => x.ganho100);
      for (const x of efeitos) {
        if (!porDisc.has(x.d)) porDisc.set(x.d, []);
        porDisc.get(x.d).push(x.ganho100);
        const k = x.d + '\u0001' + x.t;
        if (!porTop.has(k)) porTop.set(k, []);
        porTop.get(k).push(x.ganho100);
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
    const med = median(pool), n = pool.length, k = 5, base = this._calCache.globalMed;
    const ganho100 = med == null ? base : (n * med + k * base) / (n + k);
    const qPorPonto = ganho100 > .1 ? clamp(100 / ganho100, .5, 20) : 20;
    return {
      nivel, n, nTopico: top.length, nDisciplina: disc.length, nGlobal: global.length,
      ganho100: Math.round(ganho100 * 10) / 10, qPorPonto: Math.round(qPorPonto * 10) / 10,
      confianca: clamp(n / (n + k), 0, 1),
      baixaResposta: n >= this.MIN_CICLOS_PERSONALIZAR && ganho100 < 3
    };
  };

  M90.incidenciaNormalizada = function(item, r) {
    const fallback = { pct: null, confianca: item && num(item.incid) > 0 ? 1 : 0, fonte: 'legado', bancas: 0 };
    if (!item || typeof ReforcoEngine === 'undefined' || typeof DB === 'undefined' || !DB.getIncidencia) return fallback;
    if (typeof ReforcoEngine.incidenceMap !== 'function' || typeof ReforcoEngine.incidenciaDe !== 'function') return fallback;
    const agora = Date.now();
    if (!this._incCache || agora - this._incCache.at > this.CACHE_MS) {
      let rows = [];
      try { rows = DB.getIncidencia() || []; } catch (_) { return fallback; }
      this._incCache = {
        at: agora, conjuntos: new Map(),
        bancas: [...new Set(rows.map(x => x && x.banca).filter(Boolean))],
        temDados: rows.length > 0
      };
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
        } catch (_) {}
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
      } catch (_) {}
    }
    if (!vals.length) return fallback;
    return {
      pct: vals.reduce((s, x) => s + x, 0) / vals.length,
      confianca: confs.length ? confs.reduce((s, x) => s + x, 0) / confs.length : .5,
      fonte: bancas.length > 1 ? 'normalizada-por-banca' : 'banca-unica', bancas: bancas.length
    };
  };

  // Um único ponto monta a origem de qualquer reforço do Plano; anexar aqui
  // impede o diálogo “Puxar do Plano” e o botão da própria tela divergirem.
  try {
    if (typeof PlanoCiclo !== 'undefined' && typeof PlanoCiclo.origem === 'function' && !PlanoCiclo._mentor90OrigemBase) {
      PlanoCiclo._mentor90OrigemBase = PlanoCiclo.origem;
      PlanoCiclo.origem = function(topico, disciplina, item, opts) {
        const o = PlanoCiclo._mentor90OrigemBase.apply(this, arguments) || {};
        const rx = item && item.prescricaoAdaptativa;
        if (rx && rx.motorCanonico === 'mentor90-v5') {
          o.mentor90 = {
            versao: 5, prioridade: rx.score, dominio: rx.dominio90 || null,
            intervencao: rx.intervencao || null, tempo: rx.tempo || null,
            incidencia: rx.incidenciaEstrategica || null, criadoEm: new Date().toISOString()
          };
        }
        return o;
      };
    }
  } catch (_) {}

  // A atividade continua sendo do tipo que o sistema já conhece. A prescrição
  // vira metadado e explicação operacional, sem fabricar um diagnóstico causal
  // (por exemplo “erro de lei seca”) que o TEC não possui evidência para fazer.
  try {
    if (typeof DesempenhoTecScreen !== 'undefined' && typeof DesempenhoTecScreen.criarExtraDoPlano === 'function' && !DesempenhoTecScreen._mentor90CriarBase) {
      DesempenhoTecScreen._mentor90CriarBase = DesempenhoTecScreen.criarExtraDoPlano;
      DesempenhoTecScreen.criarExtraDoPlano = function(topico, disciplina, alvo, motivo, lote) {
        let antes = new Set();
        try { antes = new Set((DB.getExtras() || []).map(e => e && e.id)); } catch (_) {}
        const ok = DesempenhoTecScreen._mentor90CriarBase.apply(this, arguments);
        if (!ok) return ok;
        try {
          const extras = DB.getExtras() || [];
          const e = extras.find(x => x && !antes.has(x.id) && x.origemPlano && norm(x.origemPlano.topico) === norm(topico) && norm(x.origemPlano.disciplina) === norm(disciplina));
          const m = e && e.origemPlano && e.origemPlano.mentor90;
          const it = m && m.intervencao;
          if (e && it && typeof DB.updateExtra === 'function') {
            const passos = (it.passos || []).map(p => p.tipo === 'revisao'
              ? `${p.minutos || 20} min de revisão dirigida`
              : p.tipo === 'questoes' ? `${p.quantidade || e.alvo} questões` : p.tipo).join(' → ');
            const obs = `Mentor 90+: ${it.rotulo}. ${passos ? passos + '. ' : ''}${it.motivo || ''}`;
            DB.updateExtra(e.id, { obs, mentor90: m });
            M90._timeCache = null; M90._calCache = null;
          }
        } catch (_) {}
        return ok;
      };
    }
  } catch (_) {}

  try { if (typeof ReforcoFila !== 'undefined') ReforcoFila._assinaturaAnterior = ''; } catch (_) {}
})();
