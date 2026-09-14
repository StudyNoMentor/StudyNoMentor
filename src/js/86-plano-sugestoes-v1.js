/* ============================================================================
   PLANO → EXTRAS — motores de sugestão V1
   ----------------------------------------------------------------------------
   Três formas de olhar para os mesmos dados, uma única fila de execução:
     • Simplificado: TEC × meta; no pós, cruza também banca × peso do edital.
     • Robusto: Plano atual + Mentor 90+ + custo temporal + resposta observada.
     • Comparar: coloca os dois lado a lado sem duplicar atividades.

   Contratos que esta camada protege:
     • no máximo 3 disciplinas distintas e 1 tópico por disciplina por rodada;
     • o motor só escolhe a sugestão; Extras continua sendo a única execução;
     • dose diária/recomendação nunca substitui o alvo global da atividade;
     • atividade aberta/sobreposta não volta a ser sugerida;
     • o modo escolhido fica auditável na origem da atividade.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoSugestoesV1) return;
  window.__planoSugestoesV1 = true;
  if (typeof PlanoEngine === 'undefined' || typeof DesempenhoTecScreen === 'undefined' ||
      typeof ExtrasScreen === 'undefined' || typeof PlanoCiclo === 'undefined' || typeof DB === 'undefined') return;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number.isFinite(Number(v)) ? Number(v) : a));
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = (v) => typeof escapeHtml === 'function'
    ? escapeHtml(String(v == null ? '' : v))
    : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = (s) => {
    try { if (typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm) return ReforcoEngine.norm(s || ''); }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-norm'); }
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };
  const pct = (v, d = 0) => clamp(v, 0, 100).toFixed(d) + '%';

  const Engine = {
    VERSAO: 1,
    KEY: 'plano-sugestoes-v1',
    DEFAULTS: { modo: 'robusto', fase: 'auto', meta: 90, minAmostra: 20, banca: '__todas__' },
    MAX_DISCIPLINAS: 3,
    MAX_TOPICOS_DISC: 1,
    _legacyPuxar: null,

    prefs() {
      let raw = {};
      try { raw = JSON.parse(localStorage.getItem(DB._profilePrefix() + this.KEY) || '{}') || {}; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-prefs'); }
      const p = Object.assign({}, this.DEFAULTS, raw);
      if (!['simplificado','robusto','comparar'].includes(p.modo)) p.modo = this.DEFAULTS.modo;
      if (!['auto','pre','pos'].includes(p.fase)) p.fase = this.DEFAULTS.fase;
      p.meta = clamp(p.meta, 50, 100);
      p.minAmostra = Math.round(clamp(p.minAmostra, 1, 500));
      p.banca = typeof p.banca === 'string' && p.banca ? p.banca : '__todas__';
      return p;
    },
    salvar(patch) {
      const p = Object.assign({}, this.prefs(), patch || {});
      p.meta = clamp(p.meta, 50, 100);
      p.minAmostra = Math.round(clamp(p.minAmostra, 1, 500));
      if (!['simplificado','robusto','comparar'].includes(p.modo)) p.modo = 'robusto';
      if (!['auto','pre','pos'].includes(p.fase)) p.fase = 'auto';
      try {
        const k = DB._profilePrefix() + this.KEY;
        if (DB.setRaw) DB.setRaw(k, JSON.stringify(p)); else localStorage.setItem(k, JSON.stringify(p));
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-save'); }
      return p;
    },
    faseEfetiva(p) {
      if (p && p.fase === 'pre') return 'pre';
      if (p && p.fase === 'pos') return 'pos';
      try { if (typeof PlanoPontos !== 'undefined' && PlanoPontos.temComposicao && PlanoPontos.temComposicao()) return 'pos'; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-fase'); }
      return 'pre';
    },
    bancaEfetiva(p) {
      if (p && p.banca && p.banca !== '__todas__') return p.banca;
      try {
        const atual = PlanoEngine.prefs().banca;
        if (atual && atual !== '__todas__') return atual;
        const f = DesempenhoTecScreen.bancaFiltro && DesempenhoTecScreen.bancaFiltro();
        if (f && f !== '__todas__') return f;
        const bs = DB.getBancas ? DB.getBancas() : [];
        return bs.length === 1 ? bs[0] : '__todas__';
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-banca'); }
      return '__todas__';
    },
    _calcular(p, extra) {
      const atual = PlanoEngine.prefs();
      const opts = Object.assign({}, atual, {
        disciplina: '__todas__', limite: 200,
        metaDominio: p.meta, tetoDominio: Math.max(p.meta, num(atual.tetoDominio, p.meta)),
        minAmostra: p.minAmostra, incluirPequenas: true,
        banca: this.bancaEfetiva(p)
      }, extra || {});
      const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), opts);
      if (r && !r.erro && typeof PlanoPontos !== 'undefined' && PlanoPontos.anexarPontos) {
        try { PlanoPontos.anexarPontos(r, opts); }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-pontos'); }
      }
      return { r, opts };
    },
    _abertas() {
      try { return (DB.getExtras() || []).filter(e => e && e.origemPlano && e.status !== 'concluida'); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-abertas'); return []; }
    },
    _sobreposta(x, abertas) {
      try {
        return abertas.some(e => DesempenhoTecScreen._casaUnidade && DesempenhoTecScreen._casaUnidade(e.origemPlano, x))
          || !!(PlanoEngine.atividadeSobreposta && PlanoEngine.atividadeSobreposta(x.nome, x.disciplina, x.membros));
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-sobreposta'); return false; }
    },
    _pool(r) {
      const abertas = this._abertas();
      const vistos = new Set(), out = [];
      for (const x of [].concat((r && r.itens) || [], (r && r.pequenas) || [])) {
        if (!x || !x.nome || !x.disciplina || this._sobreposta(x, abertas)) continue;
        const k = norm(x.disciplina) + '\u0001' + norm(x.nome);
        if (vistos.has(k)) continue;
        vistos.add(k); out.push(x);
      }
      return out;
    },
    _alvoGlobal(x) {
      return Math.max(1, Math.round(num(x && x.custoQ, 20)));
    },
    _top3(cands) {
      const usados = new Set(), out = [];
      cands.slice().sort((a,b) => num(b.score) - num(a.score) || num(a.item && a.item.taxa, 999) - num(b.item && b.item.taxa, 999)).forEach(c => {
        const d = norm(c.disciplina);
        if (!d || usados.has(d) || out.length >= this.MAX_DISCIPLINAS) return;
        usados.add(d); out.push(c);
      });
      return out;
    },
    _normalizarScores(cands) {
      const max = Math.max(0, ...cands.map(c => Math.max(0, num(c.scoreBruto))));
      cands.forEach(c => { c.score = max > 0 ? clamp(c.scoreBruto / max * 100, 0, 100) : 0; });
      return cands;
    },

    simplificado(p) {
      const fase = this.faseEfetiva(p), banca = this.bancaEfetiva(p);
      const calc = this._calcular(p, { ordenar: 'pior' });
      const r = calc.r;
      if (!r || r.erro) return { erro: (r && r.erro) || 'sem-plano', modo:'simplificado', fase, itens:[] };
      let pool = this._pool(r).filter(x => num(x.qJanela) >= p.minAmostra && num(x.taxa, 100) < p.meta);
      if (!pool.length) return { erro:'sem-lacunas', modo:'simplificado', fase, itens:[], r };
      const gap = x => Math.max(0, p.meta - num(x.taxa, p.meta));
      const cands = [];
      if (fase === 'pre') {
        pool.forEach(x => cands.push({
          item:x, disciplina:x.disciplina, nome:x.nome, modo:'simplificado', fase,
          scoreBruto: gap(x), alvo:this._alvoGlobal(x),
          meta:p.meta, minAmostra:p.minAmostra, banca:null,
          motivo:`Lacuna de ${gap(x).toFixed(1)} pp para a meta de ${p.meta}%`,
          componentes:{ lacunaPP:gap(x), amostra:num(x.qJanela), taxa:num(x.taxa) }
        }));
      } else {
        let temComp = false;
        try { temComp = !!(typeof PlanoPontos !== 'undefined' && PlanoPontos.temComposicao && PlanoPontos.temComposicao()); }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-comp'); }
        if (!temComp) return { erro:'pos-sem-planejamento', modo:'simplificado', fase, itens:[], r };
        if (!banca || banca === '__todas__') return { erro:'pos-sem-banca', modo:'simplificado', fase, itens:[], r };
        const porDisc = Object.create(null);
        this._pool(r).forEach(x => {
          const d = norm(x.disciplina), inc = Math.max(0, num(x.incid));
          porDisc[d] = (porDisc[d] || 0) + inc;
        });
        pool.forEach(x => {
          const d = norm(x.disciplina), totalInc = porDisc[d] || 0, inc = Math.max(0, num(x.incid));
          const parte = totalInc > 0 ? inc / totalInc : 0;
          const pesoMateria = Math.max(0, num(x.pontosMateria));
          const valor = pesoMateria * parte * gap(x) / 100;
          if (!(valor > 0)) return;
          cands.push({
            item:x, disciplina:x.disciplina, nome:x.nome, modo:'simplificado', fase,
            scoreBruto:valor, alvo:this._alvoGlobal(x), meta:p.meta, minAmostra:p.minAmostra, banca,
            motivo:`${gap(x).toFixed(1)} pp de lacuna × ${(parte*100).toFixed(1)}% da matéria na ${banca} × ${pesoMateria.toFixed(1)} ponto(s) do edital`,
            componentes:{ lacunaPP:gap(x), amostra:num(x.qJanela), taxa:num(x.taxa), incidenciaDiscPct:parte*100, pesoMateria, valorPontos:valor }
          });
        });
        if (!cands.length) return { erro:'pos-sem-cruzamento', modo:'simplificado', fase, itens:[], r };
      }
      this._normalizarScores(cands);
      return { modo:'simplificado', fase, banca:fase==='pos'?banca:null, itens:this._top3(cands), todos:cands, r,
        explicacao:fase==='pre'?'Meu TEC × meta desejada × amostra mínima':'Meu TEC × incidência da banca × peso do planejamento pós-edital' };
    },

    _pearson(xs, ys) {
      const n = Math.min(xs.length, ys.length); if (n < 4) return 0;
      const mx = xs.reduce((s,v)=>s+v,0)/n, my = ys.reduce((s,v)=>s+v,0)/n;
      let a=0,b=0,c=0;
      for (let i=0;i<n;i++) { const dx=xs[i]-mx, dy=ys[i]-my; a+=dx*dy; b+=dx*dx; c+=dy*dy; }
      return b>0&&c>0 ? clamp(a/Math.sqrt(b*c),-1,1) : 0;
    },
    politicaAprendida(fase) {
      const base = fase === 'pos'
        ? { pontos:.34, ppm:.24, lacuna:.14, incidencia:.10, recencia:.10, resposta:.08 }
        : { lacuna:.34, evidencia:.22, incidencia:.12, recencia:.12, resposta:.12, eficiencia:.08 };
      let hist = [];
      try {
        hist = (DB.getExtras() || []).filter(e => e && e.origemPlano && e.origemPlano.sugestao &&
          e.origemPlano.sugestao.motor === 'robusto-v2' && e.origemPlano.veredito &&
          Number.isFinite(Number(e.origemPlano.veredito.ganhoPP)) && num(e.origemPlano.veredito.questoes) > 0);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-learning'); }
      const n = hist.length;
      if (n < 10) return { pesos:base, n, aprendida:false, shrink:0 };
      const ys = hist.map(e => num(e.origemPlano.veredito.ganhoPP) / Math.max(1,num(e.origemPlano.veredito.questoes))*100);
      const shrink = Math.min(.6, n/(n+30));
      const pesos = {}, comps = Object.keys(base);
      comps.forEach(k => {
        const xs = hist.map(e => num(e.origemPlano.sugestao.componentes && e.origemPlano.sugestao.componentes[k]));
        const corr = this._pearson(xs, ys);
        const mult = 1 + clamp(corr,-.5,.5) * .3 * shrink;
        pesos[k] = base[k] * mult;
      });
      const soma = Object.values(pesos).reduce((s,v)=>s+v,0)||1;
      Object.keys(pesos).forEach(k => { pesos[k] /= soma; });
      return { pesos, n, aprendida:true, shrink };
    },

    robusto(p) {
      const fase = this.faseEfetiva(p), banca = this.bancaEfetiva(p);
      const calc = this._calcular(p, { ordenar: fase === 'pos' ? 'pontos' : 'rendimento' });
      const r = calc.r;
      if (!r || r.erro) return { erro:(r&&r.erro)||'sem-plano', modo:'robusto', fase, itens:[] };
      const M90 = window.Mentor90V5;
      const pool = this._pool(r).filter(x => num(x.qJanela) >= Math.max(1,p.minAmostra));
      if (!pool.length) return { erro:'sem-candidatos', modo:'robusto', fase, itens:[], r };
      const raw = pool.map(x => {
        const dom = M90 && M90.dominio ? M90.dominio(x, Object.assign({}, r, { meta:p.meta })) : null;
        const cal = M90 && M90.calibracaoHierarquica ? M90.calibracaoHierarquica(x) : null;
        const inc = M90 && M90.incidenciaNormalizada ? M90.incidenciaNormalizada(x, Object.assign({}, r, { banca })) : null;
        const vel = M90 && M90.velocidade ? M90.velocidade(x.disciplina) : {confiavel:false};
        const gap90 = clamp((90-num(x.taxa,90))/90,0,1);
        const evidencia = dom ? clamp(1-num(dom.pCompetitiva),0,1) : clamp((p.meta-num(x.taxa,p.meta))/Math.max(1,p.meta),0,1);
        const incid = inc && inc.pct != null ? Math.max(0,num(inc.pct)*num(inc.confianca,1)) : Math.max(0,num(x.incid));
        const recencia = x.vencido ? 1 : clamp(num(x.diasDesdeMedicao)/Math.max(1,num(r.validadeDias,120)),0,1);
        const resposta = cal ? clamp((num(cal.ganho100,2.5)+2)/12,0,1) : .5;
        const minutos = vel && vel.confiavel ? this._alvoGlobal(x)*num(vel.segundosPorQuestao)/60 : null;
        const pontos = Math.max(0,num(x.pontosGanho));
        const ppm = minutos && minutos>0 ? pontos/minutos : 0;
        const eficiencia = minutos && minutos>0 ? gap90/minutos : 1/Math.max(1,this._alvoGlobal(x));
        return {x,dom,cal,inc,vel,gap90,evidencia,incid,recencia,resposta,minutos,pontos,ppm,eficiencia};
      });
      const mx = k => Math.max(0,...raw.map(z=>Math.max(0,num(z[k]))));
      const maxInc=mx('incid'), maxPts=mx('pontos'), maxPpm=mx('ppm'), maxEff=mx('eficiencia');
      const pol = this.politicaAprendida(fase), cands=[];
      raw.forEach(z => {
        const comp = fase==='pos' ? {
          pontos:maxPts?z.pontos/maxPts:0, ppm:maxPpm?z.ppm/maxPpm:0, lacuna:z.gap90,
          incidencia:maxInc?z.incid/maxInc:0, recencia:z.recencia, resposta:z.resposta
        } : {
          lacuna:z.gap90, evidencia:z.evidencia, incidencia:maxInc?z.incid/maxInc:0,
          recencia:z.recencia, resposta:z.resposta, eficiencia:maxEff?z.eficiencia/maxEff:0
        };
        let score = Object.keys(pol.pesos).reduce((s,k)=>s+num(pol.pesos[k])*num(comp[k]),0)*100;
        if (z.x.eliminatoria) score=Math.max(score,97);
        if (z.dom && z.dom.nivel==='elite' && !z.dom.vencido) score*=.2;
        if (z.dom && z.dom.nivel==='competitivo' && !z.dom.vencido) score*=.45;
        const alvo=this._alvoGlobal(z.x);
        let doseDiaria=null;
        if (z.vel && z.vel.confiavel) doseDiaria=Math.max(5,Math.min(alvo,Math.floor(30*60/num(z.vel.segundosPorQuestao,120))));
        cands.push({
          item:z.x, disciplina:z.x.disciplina, nome:z.x.nome, modo:'robusto', fase,
          scoreBruto:score, score, alvo, doseDiaria, meta:p.meta, minAmostra:p.minAmostra,
          banca:fase==='pos'?banca:null,
          motivo:fase==='pos'
            ? `${z.pontos.toFixed(2)} ponto(s) recuperáveis${z.minutos?` · ~${Math.max(1,Math.round(z.minutos))} min para o alvo global`:''}${z.x.eliminatoria?' · risco eliminatório':''}`
            : `${pct(z.gap90*100)} de lacuna competitiva · evidência ${(z.evidencia*100).toFixed(0)}%${z.dom?` · ${z.dom.rotulo}`:''}`,
          componentes:comp,
          mentor:{dominio:z.dom,calibracao:z.cal,incidencia:z.inc,tempo:z.vel},
          politica:{n:pol.n,aprendida:pol.aprendida,shrink:pol.shrink}
        });
      });
      return { modo:'robusto', fase, banca:fase==='pos'?banca:null, itens:this._top3(cands), todos:cands, r,
        politica:pol, explicacao:'Plano atual + evidência Mentor 90+ + custo temporal + resposta histórica, com pesos autoajustados apenas após evidência suficiente.' };
    },

    comparar(p) {
      const s=this.simplificado(p), r=this.robusto(p);
      if (s.erro && r.erro) return { erro:'ambos-indisponiveis', simples:s, robusto:r, itens:[], modo:'comparar', fase:this.faseEfetiva(p) };
      const byS=new Map(), byR=new Map();
      (s.todos||s.itens||[]).forEach(x=>{const k=norm(x.disciplina);if(!byS.has(k)||num(x.score)>num(byS.get(k).score))byS.set(k,x);});
      (r.todos||r.itens||[]).forEach(x=>{const k=norm(x.disciplina);if(!byR.has(k)||num(x.score)>num(byR.get(k).score))byR.set(k,x);});
      const ds=[...new Set([...byS.keys(),...byR.keys()])].map(k=>{
        const a=byS.get(k)||null,b=byR.get(k)||null,cons=!!(a&&b&&norm(a.nome)===norm(b.nome));
        return {k,disciplina:(a||b).disciplina,simplificado:a,robusto:b,consenso:cons,
          scoreMath:Math.max(num(a&&a.score),num(b&&b.score))+(cons?12:0)};
      }).sort((a,b)=>b.scoreMath-a.scoreMath).slice(0,this.MAX_DISCIPLINAS);
      ds.forEach(x=>{x.escolha=x.consenso?'consenso':(x.robusto?'robusto':'simplificado');});
      return { modo:'comparar', fase:this.faseEfetiva(p), banca:this.bancaEfetiva(p), itens:ds, simples:s, robusto:r,
        explicacao:'Mostra a decisão objetiva e a decisão robusta na mesma disciplina; consenso aparece quando ambos escolhem o mesmo tópico.' };
    },

    calcular(p) {
      return p.modo==='simplificado' ? this.simplificado(p) : p.modo==='comparar' ? this.comparar(p) : this.robusto(p);
    },
    _erroTexto(e) {
      return ({
        'sem-retrato':'Importe um retrato do TEC antes de gerar sugestões.',
        'amostra':'Nenhum assunto atingiu a amostra mínima escolhida.',
        'sem-lacunas':'Nenhum assunto medido está abaixo da meta desejada.',
        'pos-sem-planejamento':'O Simplificado Pós precisa do planejamento da prova com pesos/pontos por matéria.',
        'pos-sem-banca':'Escolha uma banca específica para o Simplificado Pós.',
        'pos-sem-cruzamento':'Não houve cruzamento confiável entre TEC, incidência da banca e matérias do planejamento.',
        'sem-candidatos':'Não há candidatos elegíveis sem sobrepor reforços já abertos.',
        'ambos-indisponiveis':'Nenhum dos dois motores conseguiu formar sugestões neste escopo.'
      })[e] || 'Não foi possível formar sugestões com o escopo atual.';
    },
    _bancasOptions(atual) {
      let bs=[];try{bs=DB.getBancas?DB.getBancas():[];}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-sug-bancas');}
      return `<option value="__todas__" ${atual==='__todas__'?'selected':''}>Selecionar automaticamente</option>`+
        bs.map(b=>`<option value="${esc(b)}" ${b===atual?'selected':''}>${esc(b)}</option>`).join('');
    },
    _cabecalho(p, res) {
      const fase=this.faseEfetiva(p), showSimple=p.modo!=='robusto';
      return `<div class="ps-mode-grid" role="group" aria-label="Modo das sugestões">
        ${[['simplificado','Simplificado','Regra transparente: meu TEC × meta'+(fase==='pos'?' × banca × edital':'')],['robusto','Robusto','Plano atual + Mentor 90+ + tempo + evolução'],['comparar','Comparar','Os dois motores lado a lado']].map(([k,t,s])=>`<button type="button" class="ps-mode ${p.modo===k?'active':''}" data-ps-modo="${k}"><b>${t}</b><small>${s}</small></button>`).join('')}
      </div>
      <div class="ps-settings ${showSimple?'':'is-robust-only'}">
        <label><span>Fase</span><select data-ps-fase><option value="auto" ${p.fase==='auto'?'selected':''}>Automática</option><option value="pre" ${p.fase==='pre'?'selected':''}>Pré-edital</option><option value="pos" ${p.fase==='pos'?'selected':''}>Pós-edital</option></select></label>
        <label><span>Meta desejada</span><div class="ps-input-suffix"><input data-ps-meta type="number" min="50" max="100" value="${p.meta}"><em>%</em></div></label>
        <label><span>Amostra mínima</span><input data-ps-min type="number" min="1" max="500" value="${p.minAmostra}"></label>
        <label class="${fase==='pos'?'':'ps-hidden'}"><span>Banca</span><select data-ps-banca>${this._bancasOptions(p.banca)}</select></label>
      </div>
      <div class="ps-rule"><b>Contrato da rodada:</b> até 3 disciplinas distintas · 1 tópico por disciplina · uma única fila em Extras. <span>${esc((res&&res.explicacao)||'')}</span></div>`;
    },
    _card(c, i, checked=true) {
      return `<label class="ps-card">
        <input type="checkbox" class="ps-pick" data-i="${i}" ${checked?'checked':''}>
        <div class="ps-card-body"><div class="ps-card-top"><span class="ps-disc">${esc(c.disciplina)}</span><span class="ps-score">${Math.round(num(c.score))}/100</span></div>
          <strong>${esc(c.nome)}</strong><p>${esc(c.motivo)}</p>
          <div class="ps-metrics"><span>${num(c.item&&c.item.taxa).toFixed(0)}% atual</span><span>${Math.round(num(c.item&&c.item.qJanela))}q amostra</span><span>${c.alvo}q alvo global</span>${c.doseDiaria?`<span>~${c.doseDiaria}q/dia</span>`:''}</div>
          ${c.modo==='robusto'&&c.politica&&c.politica.aprendida?`<small class="ps-learn">Pesos personalizados com ${c.politica.n} ciclos · regularização ativa</small>`:''}
        </div></label>`;
    },
    _compareRow(x, i) {
      const card=(c,k)=>c?`<label class="ps-compare-option ${x.consenso?'is-consensus':''}"><input type="radio" name="ps-choice-${i}" value="${k}" ${x.escolha===k||x.escolha==='consenso'&&k==='robusto'?'checked':''}><div><span>${k==='simplificado'?'Simplificado':'Robusto'} · ${Math.round(num(c.score))}/100</span><b>${esc(c.nome)}</b><small>${esc(c.motivo)}</small></div></label>`:'';
      return `<section class="ps-compare-row" data-row="${i}"><header><b>${esc(x.disciplina)}</b>${x.consenso?'<span class="ps-consensus">✓ Consenso</span>':'<span>Escolha a leitura</span>'}</header><div class="ps-compare-grid">${card(x.simplificado,'simplificado')}${card(x.robusto,'robusto')}</div></section>`;
    },
    _renderLista(screen, p, res) {
      const host=document.getElementById('pl-lista'), conta=document.getElementById('pl-conta');
      if(!host)return;
      if(res.erro){host.innerHTML=`<div class="ps-empty"><b>Sem sugestões</b><span>${esc(this._erroTexto(res.erro))}</span></div>`;if(conta)conta.textContent='';return;}
      if(p.modo==='comparar') {
        host.innerHTML=(res.itens||[]).map((x,i)=>this._compareRow(x,i)).join('')||'<div class="ps-empty">Nenhuma disciplina elegível.</div>';
        if(conta)conta.innerHTML=`<strong>${res.itens.length}</strong> disciplina(s) para comparar`;
        host.querySelectorAll('input[type=radio]').forEach(r=>r.addEventListener('change',()=>{
          const i=Number(r.name.replace('ps-choice-',''));if(res.itens[i])res.itens[i].escolha=r.value;
        }));
      } else {
        screen._planoSel=new Set((res.itens||[]).map((_,i)=>i));
        host.innerHTML=(res.itens||[]).map((c,i)=>this._card(c,i,true)).join('')||'<div class="ps-empty">Nenhuma sugestão elegível.</div>';
        if(conta)conta.innerHTML=`<strong>${res.itens.length}</strong> disciplina(s) · 1 tópico por disciplina`;
        host.querySelectorAll('.ps-pick').forEach(cb=>cb.addEventListener('change',()=>{const i=Number(cb.dataset.i);if(cb.checked)screen._planoSel.add(i);else screen._planoSel.delete(i);}));
      }
    },
    _renderModal(screen,p,res) {
      const body=document.getElementById('ui-modal-body');
      if(!body)return;
      body.innerHTML=`${this._cabecalho(p,res)}<div class="ps-list-head"><span id="pl-conta"></span><small>As sugestões abertas/overpostas já foram removidas.</small></div><div id="pl-lista" class="ps-list"></div>`;
      this._renderLista(screen,p,res);
      body.querySelectorAll('[data-ps-modo]').forEach(b=>b.addEventListener('click',()=>{p=this.salvar({modo:b.dataset.psModo});this._recalcularModal(screen,p);}));
      const bind=(q,ev,fn)=>{const el=body.querySelector(q);if(el)el.addEventListener(ev,fn);};
      bind('[data-ps-fase]','change',e=>{p=this.salvar({fase:e.target.value});this._recalcularModal(screen,p);});
      bind('[data-ps-meta]','change',e=>{p=this.salvar({meta:Number(e.target.value)});this._recalcularModal(screen,p);});
      bind('[data-ps-min]','change',e=>{p=this.salvar({minAmostra:Number(e.target.value)});this._recalcularModal(screen,p);});
      bind('[data-ps-banca]','change',e=>{p=this.salvar({banca:e.target.value});this._recalcularModal(screen,p);});
    },
    _recalcularModal(screen,p) {
      const host=document.getElementById('pl-lista');if(host)host.innerHTML='<div class="ps-loading">Recalculando sugestões…</div>';
      setTimeout(()=>{
        try { const res=this.calcular(p);screen._psResultado=res;this._renderModal(screen,p,res); }
        catch(e){if(typeof _quiet==='function')_quiet(e,'plano-sug-recalc');}
      },0);
    },
    _escolhidos(screen,p,res) {
      if(!res||res.erro)return[];
      if(p.modo==='comparar') return (res.itens||[]).map(x=>{
        if(x.consenso)return x.robusto||x.simplificado;
        return x.escolha==='simplificado'?x.simplificado:x.robusto;
      }).filter(Boolean);
      return (res.itens||[]).filter((_,i)=>!screen._planoSel||screen._planoSel.has(i));
    },
    criar(screen,p,res) {
      const itens=this._escolhidos(screen,p,res);let n=0;
      itens.forEach(c=>{
        if(!c||!c.item)return;
        const x=c.item, e=DB.addExtra({
          titulo:PlanoCiclo.titulo(x.nome,'reforco',x.membros),tipo:'questoes',disciplina:x.disciplina||'',unidade:'questoes',
          alvo:Math.max(1,c.alvo),periodo:'unica',contaMetricas:false,
          obs:`Gerado pelo Plano · ${c.modo==='robusto'?'Robusto':'Simplificado'} ${c.fase==='pos'?'Pós':'Pré'}.`
        });
        if(!e)return;
        const origem=PlanoCiclo.origem(x.nome,x.disciplina,x,{motivo:'reforco'});
        origem.sugestao={
          versao:this.VERSAO,motor:c.modo==='robusto'?'robusto-v2':'simplificado-v1',modoInterface:p.modo,fase:c.fase,
          meta:p.meta,minAmostra:p.minAmostra,banca:c.banca||null,score:Math.round(num(c.score)*10)/10,
          alvoGlobal:Math.max(1,c.alvo),doseDiaria:c.doseDiaria||null,componentes:c.componentes||{},
          politica:c.politica||null,criadoEm:typeof todayLocal==='function'?todayLocal():new Date().toISOString().slice(0,10)
        };
        DB.updateExtra(e.id,{origemPlano:origem});n++;
      });
      screen.render();
      if(typeof showToast==='function')showToast(n?`${n} reforço(s) criado(s) · ${p.modo==='comparar'?'comparação concluída':p.modo}`:'Nenhuma sugestão selecionada');
      return n;
    },
    abrir(screen) {
      const p=this.prefs();let res;
      try { res=this.calcular(p); }
      catch(e){if(typeof _quiet==='function')_quiet(e,'plano-sug-open'); if(this._legacyPuxar)return this._legacyPuxar.call(screen); return;}
      screen._psResultado=res;screen._planoSel=new Set((res.itens||[]).map((_,i)=>i));
      new Promise(resolve=>{UI._resolve=resolve;UI._mode='confirm';UI._open('🏁 Puxar do Plano','Escolha como deseja visualizar as 3 frentes de reforço','<div id="ps-root"></div>',{okText:'Criar atividades'});})
        .then(ok=>{if(!ok)return;const atual=this.prefs();return this.criar(screen,atual,screen._psResultado);});
      setTimeout(()=>{try{this._renderModal(screen,p,res);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-sug-render');}},0);
    },
    instalar() {
      if (ExtrasScreen._planoSugestoesV1) return;
      ExtrasScreen._planoSugestoesV1=true;
      this._legacyPuxar=ExtrasScreen.puxarDoPlano;
      const self=this;
      ExtrasScreen.puxarDoPlano=function(){return self.abrir(this);};
    }
  };

  Engine.instalar();
  window.PlanoSugestoesV1=Engine;
})();
