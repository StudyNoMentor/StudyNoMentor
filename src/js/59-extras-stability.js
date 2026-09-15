/* ============================================================
   EXTRAS — estabilidade de modais + performance do reforço adaptativo
   Corrige sobreposições e elimina recomputações quadráticas no Plano.
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__extrasStability) return;
  if (typeof window !== 'undefined') window.__extrasStability = true;

  const OVERLAY_SELECTOR = '.xsc-overlay,.rg-overlay,.ra-overlay';
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const CLOSE_SELECTOR = '.ra-x,.rg-x,.xsc-close,[data-cancel],[data-rg-cancel]';
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v)));
  const median = (a) => {
    const x = (a || []).filter(Number.isFinite).slice().sort((m,n)=>m-n);
    if (!x.length) return null;
    const i = x.length >> 1;
    return x.length % 2 ? x[i] : (x[i-1] + x[i]) / 2;
  };
  const norm = (s) => {
    try { return typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm ? ReforcoEngine.norm(s || '') : String(s || '').toLowerCase().trim(); }
    catch (_) { return String(s || '').toLowerCase().trim(); }
  };

  /* Pilha única de modais de Extras. A posição é recalculada a partir dos
     overlays PRESENTES, em vez de crescer a cada abertura: mesmo após milhares
     de usos ela permanece na faixa de modal e nunca ultrapassa toast/bloqueio. */
  const OverlayStack = {
    base: 1520,
    observer: null,
    top: null,
    openers: new WeakMap(),
    bodyState: null,
    _visible(el) {
      if (!el || el.isConnected === false) return false;
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
      return true;
    },
    _focusables(el) {
      if (!el || !el.querySelectorAll) return [];
      return [...el.querySelectorAll(FOCUSABLE)].filter(x => {
        if (x.closest && x.closest('[inert]')) return false;
        if (typeof getComputedStyle !== 'function') return true;
        const cs=getComputedStyle(x),r=x.getBoundingClientRect();
        return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0;
      });
    },
    _focusFirst(el) {
      const f=this._focusables(el), alvo=f[0] || el?.querySelector?.('[role="dialog"]') || el;
      if (alvo && alvo.focus) { try { alvo.focus({preventScroll:true}); } catch (_) { /* melhoria progressiva */ } }
    },
    _lock(on) {
      if (typeof document === 'undefined') return;
      const html=document.documentElement, body=document.body;
      if (on && !this.bodyState) {
        const state={overflow:body.style.overflow,paddingRight:body.style.paddingRight};
        const gap=Math.max(0,(typeof innerWidth==='number'?innerWidth:html.clientWidth)-html.clientWidth);
        if(gap>0){const atual=parseFloat(getComputedStyle(body).paddingRight)||0;body.style.paddingRight=`${atual+gap}px`;}
        body.style.overflow='hidden'; this.bodyState=state; html.classList.add('extras-modal-open');
      } else if (!on && this.bodyState) {
        body.style.overflow=this.bodyState.overflow; body.style.paddingRight=this.bodyState.paddingRight;
        this.bodyState=null; html.classList.remove('extras-modal-open');
      }
    },
    register(el) {
      if (!el || el.nodeType !== 1 || !el.matches || !el.matches(OVERLAY_SELECTOR)) return;
      if (!this.openers.has(el)) this.openers.set(el, document.activeElement);
      this.sync();
    },
    list() {
      if (typeof document === 'undefined') return [];
      return [...document.querySelectorAll(OVERLAY_SELECTOR)].filter(x => this._visible(x));
    },
    sync() {
      if (typeof document === 'undefined') return;
      const list=this.list(), novo=list[list.length-1]||null, anterior=this.top;
      list.forEach((el,i)=>{
        const active=el===novo;
        el.style.zIndex=String(this.base+i*20);
        el.classList.toggle('extras-overlay-background',!active);
        try{el.inert=!active;}catch(_){/* navegador antigo */}
        if(active)el.removeAttribute('aria-hidden');else el.setAttribute('aria-hidden','true');
      });
      this._lock(!!list.length); this.top=novo;
      if(novo!==anterior){
        const opener=anterior&&this.openers.get(anterior);
        requestAnimationFrame(()=>{
          if(this.top){
            if(opener&&opener.isConnected&&this.top.contains(opener)){try{opener.focus({preventScroll:true});}catch(e){if(typeof _quiet==='function')_quiet(e,'extras-overlay-focus');}}
            else if(!document.activeElement||!this.top.contains(document.activeElement))this._focusFirst(this.top);
          }else if(opener&&opener.isConnected){try{opener.focus({preventScroll:true});}catch(e){if(typeof _quiet==='function')_quiet(e,'extras-overlay-focus');}}
        });
      }
    },
    install() {
      if (typeof document === 'undefined') return;
      document.querySelectorAll(OVERLAY_SELECTOR).forEach(x=>this.register(x));
      if (typeof MutationObserver !== 'undefined' && !this.observer) {
        this.observer=new MutationObserver(records=>{
          records.forEach(r=>[...(r.addedNodes||[])].forEach(n=>{
            if(!n||n.nodeType!==1)return;
            if(n.matches&&n.matches(OVERLAY_SELECTOR))this.register(n);
            if(n.querySelectorAll)n.querySelectorAll(OVERLAY_SELECTOR).forEach(x=>this.register(x));
          }));
          /* síncrono na microtask: o modal-pai nunca fica inert por um frame
             depois que o filho é removido. */
          this.sync();
        });
        this.observer.observe(document.body||document.documentElement,{childList:true,subtree:true});
      }
      document.addEventListener('keydown',e=>{
        const top=this.list().pop(); if(!top)return;
        if(e.key==='Escape'){
          const btn=top.querySelector(CLOSE_SELECTOR);if(btn){e.preventDefault();e.stopPropagation();btn.click();}
          return;
        }
        if(e.key!=='Tab')return;
        const f=this._focusables(top);if(!f.length){e.preventDefault();return;}
        const first=f[0],last=f[f.length-1],act=document.activeElement;
        if(e.shiftKey&&(act===first||!top.contains(act))){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&(act===last||!top.contains(act))){e.preventDefault();first.focus();}
      },true);
      document.addEventListener('focusin',e=>{
        const top=this.list().pop();
        if(top&&!top.contains(e.target))this._focusFirst(top);
      },true);
    }
  };
  OverlayStack.install();
  if (typeof window !== 'undefined') window.ExtrasOverlayStack = OverlayStack;

  if (typeof ReforcoAdaptativo === 'undefined') return;
  const RA = ReforcoAdaptativo;

  /* Índice de histórico construído UMA vez por cálculo do Plano. */
  RA._historyIndex = function() {
    let closed = [];
    try { closed = typeof PlanoCiclo !== 'undefined' && PlanoCiclo.fechados ? PlanoCiclo.fechados() : []; }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'reforco-adaptativo-history-index'); }
    const valid = (closed || []).filter(x => x && num(x.questoes) > 0 && x.ganhoPP != null);
    const byDisc = new Map(), byExact = new Map();
    valid.forEach(x => {
      const d = norm(x.disciplina), t = norm(x.topico), ek = d + '\u0000' + t;
      if (!byDisc.has(d)) byDisc.set(d, []);
      if (!byExact.has(ek)) byExact.set(ek, []);
      byDisc.get(d).push(x); byExact.get(ek).push(x);
    });
    return { valid, byDisc, byExact };
  };
  RA._historicoIndexado = function(item, p, idx) {
    const d = norm(item && item.disciplina), t = norm(item && item.nome), key = d + '\u0000' + t;
    const exact = (idx.byExact.get(key) || []), disc = (idx.byDisc.get(d) || []);
    const pool = exact.length >= p.ciclosAprender ? exact : (disc.length >= Math.max(3,p.ciclosAprender) ? disc : idx.valid);
    const g = median(pool.map(x => num(x.ganhoPP)));
    const g100 = median(pool.map(x => num(x.ganhoPP) / Math.max(1,num(x.questoes,1)) * 100));
    const learn = pool.length ? clamp((num(g100)+2)/12,0,1.5) : .7;
    return { n:pool.length, exatos:exact.length, ganhoMedianoPP:g, ganho100:g100, learn, baixaResposta:pool.length>=p.ciclosAprender && num(g)<p.ganhoMinimoPP };
  };

  /* Mesma matemática da prescrição original, mas reaproveitando prefs, contexto
     do Plano e índice histórico em vez de reler tudo para cada tópico. */
  RA.prescrever = function(item, r, ctx) {
    const p = ctx && ctx._prefs ? ctx._prefs : this.prefs();
    if (!p.ativo || !item) return null;
    const pp = ctx && ctx._planoPrefs ? ctx._planoPrefs : PlanoEngine.prefs();
    const fase = this.fase(p,r), meta = num(r&&r.meta,num(pp.metaDominio,85));
    const n = Math.max(0,Math.round(num(item.qJanela,num(item.qHist)))), taxa = clamp(num(item.taxa,50),0,100);
    const post = this.posterior(taxa,n,meta,p.deltaLacuna);
    const idx = ctx && ctx._histIndex ? ctx._histIndex : this._historyIndex();
    const hist = this._historicoIndexado(item,p,idx), minA = num(pp.minAmostra,20);
    ctx = ctx || this.contexto(r||{itens:[item]});
    const qMed = PlanoEngine.qParaMedir ? PlanoEngine.qParaMedir(taxa,p.margemMedicao) : 97;
    const faltaMed = Math.max(0,qMed-n), gap = clamp((meta-post.media)/Math.max(1,meta),0,1), coverage = 1-clamp(n/Math.max(1,minA*2),0,1);
    const inc=num(item.incid), den=inc+p.shrinkIncidencia || 1;
    const incSmooth=ctx.incMax?clamp((inc/den)*(inc/(ctx.incMax||1))+(p.shrinkIncidencia/den)*(ctx.incMedia/(ctx.incMax||1)),0,1):0;
    const pts=ctx.ptsMax?clamp(num(item.pontosGanho)/ctx.ptsMax,0,1):0;
    const rawEff=num(item.pontosPorQuestao)>0?num(item.pontosPorQuestao):1/Math.max(1,num(item.custoQ,1));
    const eff=ctx.effMax?clamp(rawEff/ctx.effMax,0,1):.5, ev=clamp(post.pLacuna,0,1), learn=clamp(hist.learn/1.2,0,1);
    const urg=fase==='pos'?clamp(1-p.diasAteProva/180,0,1):0;
    const w=fase==='pre'?{gap:p.preLacuna,evid:p.preEvidencia,cov:p.preCobertura,banca:p.preBanca,eff:p.preEficiencia,learn:p.preAprend}:{pts:p.posPontos+5*urg,banca:p.posBanca,gap:Math.max(0,p.posLacuna-5*urg),evid:p.posEvidencia,eff:p.posEficiencia+10*urg,learn:p.posAprend};
    const comp=fase==='pre'?{gap,evid:ev,cov:coverage,banca:incSmooth,eff,learn}:{pts,banca:incSmooth,gap,evid:ev,eff,learn};
    const sum=Object.values(w).reduce((s,x)=>s+x,0)||1;
    const score=100*Object.keys(w).reduce((s,k)=>s+num(w[k])*num(comp[k]),0)/sum;
    const confMeta=post.pMeta*100>=p.confiancaMeta&&n>=minA, confirmed=post.pLacuna*100>=p.confiancaLacuna;
    const sk=fase==='pre'?'Pre':'Pos', mi=p['dose'+sk+'Min'], ba=p['dose'+sk+'Base'], ma=p['dose'+sk+'Max'];
    let objetivo=n<minA?'diagnosticar':'intervir', dose;
    if(confMeta){objetivo='encerrar';dose=0;}
    else if(objetivo==='diagnosticar') dose=clamp(Math.max(mi,Math.min(ma,minA-n||mi)),mi,ma);
    else { let mult=.72+.42*gap+.22*(score/100)+.12*incSmooth; if(post.media>=meta-7)mult*=.78; if(hist.baixaResposta)mult*=.75; dose=clamp(Math.round(ba*mult),mi,ma); }
    const teoria=taxa<num(pp.faixaCritico,50)&&n>=minA||hist.baixaResposta;
    return {versao:1,fase,score:clamp(score,0,100),dose:Math.round(dose),objetivo,teoriaPrimeiro:teoria,confiouMeta:confMeta,lacunaConfirmada:confirmed,estatistica:{...post,qMedir:qMed,faltaMedir:faltaMed},historico:hist,componentes:comp,custoEstrategico:Math.round(num(item.custoQ)),snapshotId:(()=>{try{const a=DB.getTecSnapshots()||[];return a.length?a[a.length-1].id:null;}catch(_){return null;}})(),meta};
  };
  RA.enriquecer = function(r) {
    if(!r) return r;
    const items=[...(r.itens||[]),...(r.pequenas||[])], p=this.prefs();
    if(!p.ativo){ items.forEach(x=>{x.prescricaoAdaptativa=null;}); this._lastResult=r; this._lastResultAt=now(); return r; }
    const ctx=this.contexto(r); ctx._prefs=p; ctx._planoPrefs=PlanoEngine.prefs(); ctx._histIndex=this._historyIndex();
    items.forEach(x=>{x.prescricaoAdaptativa=this.prescrever(x,r,ctx);});
    this._lastResult=r; this._lastResultAt=now();
    return r;
  };

  RA._resultadoRecente = function() {
    if(this._lastResult && now()-num(this._lastResultAt)>-1 && now()-num(this._lastResultAt)<1500) return this._lastResult;
    try { return PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(),PlanoEngine.prefs()); }
    catch(e){ if(typeof _quiet==='function')_quiet(e,'reforco-adaptativo-result-cache'); return null; }
  };

  /* Antes era um PlanoEngine.calcular() POR BOTÃO. Agora é um resultado único
     por render e lookup O(1) por disciplina+tópico. */
  RA.decorarPlano = function() {
    const host=document.getElementById('tec-panel-plano'); if(!host) return;
    const r=this._resultadoRecente(); if(!r) return;
    const map=new Map(); [...(r.itens||[]),...(r.pequenas||[])].forEach(x=>map.set(norm(x.disciplina)+'\u0000'+norm(x.nome),x));
    for(const b of host.querySelectorAll('.plano-nova-extra')){
      const top=b.dataset.topico,disc=b.dataset.disc,x=map.get(norm(disc)+'\u0000'+norm(top)),rx=x&&x.prescricaoAdaptativa;
      const card=b.closest('.pl-item'); if(!rx||card?.querySelector('.ra-mini'))continue;
      b.dataset.alvo=rx.dose||b.dataset.alvo; if(rx.dose>0)b.textContent=`+ Reforço · ${rx.dose}q`;
      const box=document.createElement('div');box.className='ra-mini';box.innerHTML=`<span><b>${rx.dose?rx.dose+'q agora':'encerrar'}</b> · ${rx.fase==='pos'?'pós':'pré'} · prioridade ${rx.score.toFixed(0)}/100${rx.teoriaPrimeiro?' · teoria → questões':''}</span><button class="ra-i" type="button">i</button>`;
      const info=box.querySelector('button');if(info)info.onclick=e=>{e.preventDefault();e.stopPropagation();this.info(rx,top);};b.parentElement?.prepend(box);
    }
  };

  /* Criação individual reaproveita o mesmo retrato recém-calculado. */
  if(typeof DesempenhoTecScreen!=='undefined' && RA._criar){
    DesempenhoTecScreen.criarExtraDoPlano=function(top,disc,alvo,motivo,lote){
      if(motivo==='reforco'){
        try{const r=RA._resultadoRecente(),x=r&&[...(r.itens||[]),...(r.pequenas||[])].find(z=>norm(z.nome)===norm(top)&&norm(z.disciplina)===norm(disc)),rx=x&&x.prescricaoAdaptativa;if(rx&&rx.dose>0)alvo=rx.dose;}
        catch(e){if(typeof _quiet==='function')_quiet(e,'reforco-adaptativo-criar-cache');}
      }
      return RA._criar.call(this,top,disc,alvo,motivo,lote);
    };
  }

  /* Salvar em Extras não precisa redesenhar o TEC escondido. O cálculo pesado
     só roda se a tela TEC estiver realmente visível; sempre em um frame seguinte. */
  RA.rerender = function() {
    this._lastResult=null; this._lastResultAt=0;
    if(this._rerenderQueued) return;
    this._rerenderQueued=true;
    const run=()=>{
      this._rerenderQueued=false;
      try{ if(typeof ExtrasCentral!=='undefined'&&ExtrasCentral.modal) ExtrasCentral._render(); }
      catch(e){if(typeof _quiet==='function')_quiet(e,'reforco-adaptativo-rerender-extras');}
      try{
        const screen=document.getElementById('screen-desempenhotec');
        const visible=!!(screen && !screen.hidden && (typeof getComputedStyle!=='function' || getComputedStyle(screen).display!=='none'));
        if(visible && typeof DesempenhoTecScreen!=='undefined' && DesempenhoTecScreen.renderPlanoConteudo) DesempenhoTecScreen.renderPlanoConteudo();
      }catch(e){if(typeof _quiet==='function')_quiet(e,'reforco-adaptativo-rerender-tec');}
    };
    if(typeof requestAnimationFrame==='function') requestAnimationFrame(()=>setTimeout(run,0)); else setTimeout(run,0);
  };

  /* Evita modal dentro de modal na Central de Extras: fecha a central, abre o
     editor adaptativo e volta à aba Reforços quando ele termina. */
  if(!RA._stableConfigBase && RA.config){
    RA._stableConfigBase=RA.config;
    RA.config=function(opts){
      opts=opts||{}; const voltar=!!opts.fromCentral;
      if(voltar && typeof ExtrasCentral!=='undefined' && ExtrasCentral.modal) ExtrasCentral.fechar();
      const antes=new Set(document.querySelectorAll('.ra-overlay'));
      const ret=this._stableConfigBase.call(this);
      const ov=[...document.querySelectorAll('.ra-overlay')].find(x=>!antes.has(x)) || [...document.querySelectorAll('.ra-overlay')].pop();
      if(ov) OverlayStack.register(ov);
      if(voltar && ov){
        let agendado=false;
        const reopen=()=>{if(agendado)return;agendado=true;setTimeout(()=>{if(typeof ExtrasCentral!=='undefined'&&!ExtrasCentral.modal)ExtrasCentral.abrir(opts.returnTab||'reforcos');},0);};
        ov.querySelectorAll('.ra-x,[data-cancel],[data-save],[data-reset]').forEach(b=>b.addEventListener('click',reopen,{once:true}));
        ov.addEventListener('click',e=>{if(e.target===ov)reopen();});
      }
      return ret;
    };
  }

  /* O wrapper antigo da Central configura onclick sem fechar a janela pai.
     Este último bind substitui apenas essa ação e mantém os demais handlers. */
  if(typeof ExtrasCentral!=='undefined' && !ExtrasCentral._stabilityBind){
    const baseBind=ExtrasCentral._bindBody;
    ExtrasCentral._bindBody=function(){
      baseBind.call(this);
      const b=this.modal?.querySelector('[data-ra-open]');
      if(b)b.onclick=()=>RA.config({fromCentral:true,returnTab:'reforcos'});
    };
    ExtrasCentral._stabilityBind=true;
  }
})();
