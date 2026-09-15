/* ============================================================================
   MOTOR SIMPLIFICADO — revisão estatística
   Pré: TEC escopado × meta × amostra mínima, sem sobrepor níveis da árvore.
   Pós: TEC × incidência hierárquica limpa da banca × valor da matéria.
   Independente de PlanoEngine, Mentor90 e do motor Robusto.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoSugSimplificado) return;
  window.__planoSugSimplificado = true;
  const I = window.PlanoSugestoesInfra;
  if (!I || typeof DB === 'undefined') return;
  const { num, clamp, norm } = I;
  const OWN_PREF_KEYS = Object.freeze(['fase','meta','minAmostra','banca','alvoQuestoes']);
  const ownPrefs = (src) => {
    const out = {};
    src = src && typeof src === 'object' ? src : {};
    OWN_PREF_KEYS.forEach(k => { if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k]; });
    return out;
  };
  const codeDepth = (codigo) => {
    const s = String(codigo == null ? '' : codigo).trim();
    if (!s) return 0;
    return Math.max(0, s.split('.').filter(Boolean).length - 1);
  };
  const isDesc = (pai, filho) => {
    const a = String(pai == null ? '' : pai).trim(), b = String(filho == null ? '' : filho).trim();
    return !!(a && b && a !== b && b.startsWith(a + '.'));
  };

  const S = {
    REVISAO_REGISTRO: 3,
    MOTOR: 'simplificado-v2', // identificador histórico persistido; não renomear sem migração
    KEY: 'plano-simplificado-v2',
    DEFAULTS: Object.freeze({ fase:'auto', meta:90, minAmostra:20, banca:'__todas__', alvoQuestoes:30 }),
    PREF_KEYS: OWN_PREF_KEYS,
    deps: Object.freeze(['TEC-escopado','incidencia-bruta','planejamento-materias']),
    prefs() {
      let raw = {};
      try { raw = JSON.parse(localStorage.getItem(DB._profilePrefix() + this.KEY) || '{}') || {}; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-simple-prefs'); }
      const p = Object.assign({}, this.DEFAULTS, ownPrefs(raw));
      if (!['auto','pre','pos'].includes(p.fase)) p.fase = 'auto';
      p.meta = clamp(p.meta, 50, 100);
      p.minAmostra = Math.round(clamp(p.minAmostra, 1, 500));
      p.alvoQuestoes = Math.round(clamp(p.alvoQuestoes, 5, 200));
      p.banca = typeof p.banca === 'string' && p.banca ? p.banca : '__todas__';
      return p;
    },
    salvar(patch) {
      const p = Object.assign({}, this.prefs(), ownPrefs(patch));
      if (!['auto','pre','pos'].includes(p.fase)) p.fase = 'auto';
      p.meta = clamp(p.meta, 50, 100);
      p.minAmostra = Math.round(clamp(p.minAmostra, 1, 500));
      p.alvoQuestoes = Math.round(clamp(p.alvoQuestoes, 5, 200));
      p.banca = typeof p.banca === 'string' && p.banca ? p.banca : '__todas__';
      const persistido = ownPrefs(p);
      try {
        const k = DB._profilePrefix() + this.KEY;
        if (DB.setRaw) DB.setRaw(k, JSON.stringify(persistido)); else localStorage.setItem(k, JSON.stringify(persistido));
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-simple-save'); }
      return Object.assign({}, persistido);
    },
    restaurar() {
      try {
        const k = DB._profilePrefix() + this.KEY;
        if (DB.delRaw) DB.delRaw(k); else localStorage.removeItem(k);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-simple-reset'); }
      return this.prefs();
    },
    fase(p) { return p.fase === 'pre' || p.fase === 'pos' ? p.fase : I.fasePlano(); },
    banca(p) {
      if (p.banca && p.banca !== '__todas__') return p.banca;
      const bs = I.bancas();
      return bs.length === 1 ? bs[0] : '__todas__';
    },
    _casar(nome, candidatos) {
      const raiz = (t) => { let r = t; for (let i = 0; i < 2; i++) { if (r.length > 4 && /[aos]$/.test(r)) r = r.slice(0, -1); else break; } return r; };
      const vazias = new Set(['de','do','da','dos','das','e','em','no','na','nos','nas','para','com','a','o','as','os']);
      const toks = (x) => norm(x).split(' ').filter(t => t && !vazias.has(t)).map(raiz);
      const alvo = norm(nome), lista = (candidatos || []).filter(Boolean);
      const ex = lista.filter(x => norm(x) === alvo); if (ex.length === 1) return { nome:ex[0], confianca:1, via:'exato' };
      const ta = toks(nome); if (!ta.length) return null;
      const sub = lista.filter(x => { const tb=toks(x); if(!tb.length)return false; const curto=ta.length<=tb.length?ta:tb,longo=ta.length<=tb.length?tb:ta; return curto.every(t=>longo.includes(t)); });
      if (sub.length === 1) return { nome:sub[0], confianca:.8, via:'tokens' }; if (sub.length > 1) return null;
      const abr = lista.filter(x => { const tb=toks(x); if(tb.length!==ta.length)return false; return ta.every((t,i)=>{const u=tb[i],c=t.length<=u.length?t:u,g=t.length<=u.length?u:t;return c.length>=3&&g.startsWith(c);}); });
      return abr.length === 1 ? { nome:abr[0], confianca:.72, via:'abreviacao' } : null;
    },
    _top3(cands) {
      const usados = new Set(), out = [];
      cands.slice().sort((a,b)=>num(b.score)-num(a.score)||num(a.taxa,999)-num(b.taxa,999)).forEach(c=>{const d=norm(c.disciplina);if(!d||usados.has(d)||out.length>=3)return;usados.add(d);out.push(c);});
      return out;
    },
    _topicos(snapshot, p) {
      const bloqueadas = I.disciplinasBloqueadas(), vistos = new Set();
      const elegiveis = [];
      for (const r of I.linhasTec(snapshot)) {
        const disciplina = String(r.disciplina || '').trim(), nome = String(r.nome || '').trim();
        const d = norm(disciplina), k = d + '\u0001' + norm(nome), q = I.q(r), taxa = I.taxa(r);
        if (!d || vistos.has(k) || bloqueadas.has(d) || !(q >= p.minAmostra) || taxa == null || taxa >= p.meta) continue;
        vistos.add(k);
        elegiveis.push({ item:r, disciplina, nome, taxa, qJanela:q, lacunaPP:Math.max(0,p.meta-taxa), codigo:String(r.codigo || ''), depth:num(r.depth,codeDepth(r.codigo)) });
      }
      return elegiveis.filter((x, i) => !elegiveis.some((y, j) => i !== j && norm(y.disciplina) === norm(x.disciplina) && isDesc(x.codigo, y.codigo)));
    },
    _mapaPlanejamento(disciplinas) {
      const out = new Map(), nomes = disciplinas.slice();
      for (const m of I.materias()) {
        const q = Math.max(0, num(m && m.qtdQuestoes)), pts = Math.max(0, num(m && m.pontosPorQuestao, 1)), peso = Math.max(0, num(m && m.peso, 1));
        if (!(q > 0)) continue;
        const cas = this._casar(m.nome, nomes);
        if (!cas) continue;
        const k = norm(cas.nome), atual = out.get(k) || { valor:0, confianca:1, origem:[] };
        atual.valor += q * pts * peso;
        atual.confianca = Math.min(atual.confianca, cas.confianca);
        atual.origem.push(m.nome);
        out.set(k, atual);
      }
      return out;
    },
    _raizIncidencia(lista) {
      lista = (lista || []).filter(Boolean);
      let raso = Infinity;
      for (const r of lista) {
        const dep = codeDepth(r.codigo);
        if (dep > 0 && dep < raso) raso = dep;
      }
      if (raso === Infinity) return lista.reduce((s,r)=>s+Math.max(0,num(r.valor)),0);
      return lista.reduce((s,r)=>s+(codeDepth(r.codigo)===raso?Math.max(0,num(r.valor)):0),0);
    },
    _mapaIncidencia(banca, disciplinas) {
      const rows = I.incidencia().filter(r => norm(r && r.banca) === norm(banca));
      const porDisc = new Map(), total = new Map(), nomes = disciplinas.slice();
      for (const r of rows) {
        const cas = this._casar(r.disciplina || '', nomes);
        if (!cas) continue;
        const d = norm(cas.nome), v = Math.max(0, num(r.incidencia));
        if (!porDisc.has(d)) porDisc.set(d, []);
        porDisc.get(d).push({ topico:r.topico || '', valor:v, confianca:cas.confianca, codigo:r.codigo || null, depth:r.depth });
      }
      for (const [d, lista] of porDisc) total.set(d, this._raizIncidencia(lista));
      return { rows, porDisc, total, hierarquiaLimpa:true };
    },
    _incidenciaDo(topico, disciplina, mapa) {
      const d = norm(disciplina), lista = mapa.porDisc.get(d) || [];
      const ex = lista.filter(x => norm(x.topico) === norm(topico));
      if (ex.length) return { valor:ex.reduce((s,x)=>s+x.valor,0), confianca:Math.min(...ex.map(x=>x.confianca), .95), via:'disciplina-topico' };
      const glob = mapa.rows.filter(x => norm(x.topico) === norm(topico));
      const grupos = new Set(glob.map(x => norm(x.disciplina)).filter(Boolean));
      if (glob.length && grupos.size === 1) return { valor:glob.reduce((s,x)=>s+Math.max(0,num(x.incidencia)),0), confianca:.55, via:'nome-unico' };
      return { valor:0, confianca:0, via:'ausente' };
    },
    _normalizar(cands) {
      const mx = Math.max(0, ...cands.map(x => Math.max(0, num(x.scoreBruto))));
      cands.forEach(x => { x.score = mx > 0 ? clamp(x.scoreBruto / mx * 100, 0, 100) : 0; });
      return cands;
    },
    calcular(opcoes) {
      const p = Object.assign({}, this.prefs(), ownPrefs(opcoes));
      p.meta = clamp(p.meta,50,100); p.minAmostra=Math.round(clamp(p.minAmostra,1,500)); p.alvoQuestoes=Math.round(clamp(p.alvoQuestoes,5,200));
      const fase = this.fase(p), banca = this.banca(p), snapshot = I.snapshot();
      if (!snapshot) return { erro:'sem-retrato', modo:'simplificado', fase, itens:[] };
      const pool = this._topicos(snapshot,p);
      if (!pool.length) return { erro:'sem-lacunas', modo:'simplificado', fase, itens:[], arquitetura:this.arquitetura() };
      const cands = [];
      if (fase === 'pre') {
        pool.forEach(x => cands.push({
          ...x, modo:'simplificado', fase, scoreBruto:x.lacunaPP, alvo:p.alvoQuestoes, doseDiaria:null,
          meta:p.meta, minAmostra:p.minAmostra, banca:null,
          motivo:`Lacuna de ${x.lacunaPP.toFixed(1)} pp para a meta de ${p.meta}%`,
          componentes:{ lacunaPP:x.lacunaPP, amostra:x.qJanela, taxa:x.taxa },
          auditoria:{ formula:'lacunaPP', fonte:'TEC escopado direto', particao:'fronteira hierárquica não sobreposta' }
        }));
      } else {
        if (!banca || banca === '__todas__') return { erro:'pos-sem-banca', modo:'simplificado', fase, itens:[], arquitetura:this.arquitetura() };
        const disciplinas = [...new Set(pool.map(x=>x.disciplina))], plano = this._mapaPlanejamento(disciplinas);
        if (!plano.size) return { erro:'pos-sem-planejamento', modo:'simplificado', fase, itens:[], arquitetura:this.arquitetura() };
        const incid = this._mapaIncidencia(banca, disciplinas);
        pool.forEach(x => {
          const d=norm(x.disciplina), pm=plano.get(d), inc=this._incidenciaDo(x.nome,x.disciplina,incid), denom=incid.total.get(d)||0;
          if (!pm || !(pm.valor>0) || !(inc.valor>0) || !(denom>0)) return;
          const share=clamp(inc.valor/denom,0,1), conf=Math.min(pm.confianca,inc.confianca), valor=pm.valor*share*x.lacunaPP/100*conf;
          if (!(valor>0)) return;
          cands.push({
            ...x, modo:'simplificado', fase, scoreBruto:valor, alvo:p.alvoQuestoes, doseDiaria:null, meta:p.meta, minAmostra:p.minAmostra, banca,
            motivo:`${x.lacunaPP.toFixed(1)} pp de lacuna × ${(share*100).toFixed(1)}% da incidência em ${banca} × ${pm.valor.toFixed(1)} ponto(s) do planejamento`,
            componentes:{ lacunaPP:x.lacunaPP, amostra:x.qJanela, taxa:x.taxa, incidenciaDiscPct:share*100, pesoMateria:pm.valor, confiancaCruzamento:conf, valorPontos:valor },
            auditoria:{ formula:'pesoMateria × shareIncidencia × lacuna × confiança', viaIncidencia:inc.via, incidenciaDenominador:'raiz hierárquica sem dupla contagem', fonte:'TEC + incidência + matérias, sem motor Robusto' }
          });
        });
        if (!cands.length) return { erro:'pos-sem-cruzamento', modo:'simplificado', fase, itens:[], arquitetura:this.arquitetura() };
      }
      this._normalizar(cands);
      return {
        modo:'simplificado', fase, banca:fase==='pos'?banca:null, itens:this._top3(cands), todos:cands, arquitetura:this.arquitetura(),
        explicacao:fase==='pre' ? 'TEC direto × meta × amostra mínima em partição hierárquica não sobreposta.' : 'TEC direto × incidência hierárquica limpa da banca × planejamento; sem usar o motor Robusto.'
      };
    },
    arquitetura() { return { motor:this.MOTOR, revisao:this.REVISAO_REGISTRO, independente:true, usaPlanoEngine:false, usaMentor90:false, deps:this.deps.slice(), prefs:this.PREF_KEYS.slice(), particaoHierarquica:'nao-sobreposta' }; }
  };
  window.PlanoSugestoesSimplificado = S;
})();