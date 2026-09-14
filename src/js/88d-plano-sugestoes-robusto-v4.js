/* ============================================================================
   MOTOR ROBUSTO V4 — integra configuração + roteador + otimizador
   A V3 permanece como baseline interno. Esta fachada não conhece Simplificado.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoSugRobustoV4) return;
  window.__planoSugRobustoV4 = true;
  const BASE=window.PlanoSugestoesRobustoV2,C=window.PlanoRobustoConfigV4,RO=window.PlanoRobustoRouterV4,OP=window.PlanoRobustoOptimizerV4;
  if(!BASE||!C||!RO||!OP)return;
  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const clone=x=>{try{return JSON.parse(JSON.stringify(x));}catch(_){return x;}};
  const PESO_KEY={pontos:'pesoPontos',ppm:'pesoPPM',lacuna:'pesoLacuna',incidencia:'pesoIncidencia',recencia:'pesoRecencia',resposta:'pesoResposta',evidencia:'pesoEvidencia',eficiencia:'pesoEficiencia'};
  const V4={
    VERSAO:4,MOTOR:'robusto-v4',BASE_MOTOR:BASE.MOTOR,
    arquitetura(){return{motor:this.MOTOR,independente:true,usaSimplificado:false,base:BASE.MOTOR,deps:['PlanoEngine','Mentor90V6','historico-extras','PlanoRobustoConfigV4','PlanoRobustoRouterV4','PlanoRobustoOptimizerV4']};},
    modoAtaque(){return C.detectarModo();},
    config(){const m=this.modoAtaque();return{modo:m,prefs:C.prefs(m),resumo:C.resumo(m)};},
    painelConfigHtml(){const m=this.modoAtaque();return C.html(m);},
    bindConfig(root,onChange){const m=this.modoAtaque();return C.bind(root,onChange,m);},
    _scoreFixo(c,fase){
      const w=fase==='pos'?{pontos:.34,ppm:.24,lacuna:.14,incidencia:.10,recencia:.10,resposta:.08}:{lacuna:.34,evidencia:.22,incidencia:.12,recencia:.12,resposta:.12,eficiencia:.08},x=c.componentes||{};
      let s=Object.keys(w).reduce((a,k)=>a+n(w[k])*n(x[k]),0)*100;
      if(c.item&&c.item.eliminatoria)s=Math.max(s,97);
      const d=c.mentor&&c.mentor.dominio;if(d&&d.nivel==='elite'&&!d.vencido)s*=.2;else if(d&&d.nivel==='competitivo'&&!d.vencido)s*=.45;
      return Math.max(0,Math.min(100,s));
    },
    _configEfetiva(cfg,pol){
      const out=clone(cfg),rec=out.recursos||{},op=out.otimizador||{},meta={ativo:false,n:n(pol&&pol.n),shrink:0,pesosEfetivos:null};
      if(!rec.aprendizadoPesosAtivo||!pol||!pol.aprendida||!pol.pesos){meta.motivo=rec.aprendizadoPesosAtivo?'sem-evidencia-suficiente':'desligado-pelo-usuario';meta.pesosEfetivos=clone(op);return{cfg:out,meta};}
      const alpha=Math.min(.35,Math.max(0,n(pol.shrink))),apr=pol.pesos;
      Object.keys(PESO_KEY).forEach(k=>{const pk=PESO_KEY[k];if(Number.isFinite(Number(apr[k])))op[pk]=n(op[pk])*(1-alpha)+n(apr[k])*alpha;});
      const ks=Object.values(PESO_KEY),sum=ks.reduce((s,k)=>s+n(op[k]),0)||1;ks.forEach(k=>op[k]=n(op[k])/sum);
      meta.ativo=true;meta.n=n(pol.n);meta.shrink=alpha;meta.validacao=pol.validacao||null;meta.pesosEfetivos=Object.fromEntries(ks.map(k=>[k,op[k]]));return{cfg:out,meta};
    },
    calcular(){
      const base=BASE.calcular();if(!base||base.erro)return base;
      const modo=C.detectarModo(),cfg=C.prefs(modo),fase=base.fase||'pre',ef=this._configEfetiva(cfg,base.politica),cfgEf=ef.cfg,todos=(base.todos||base.itens||[]).map(c=>{
        const x=Object.assign({},c);
        if(!cfg.recursos.aprendizadoPesosAtivo){const sf=this._scoreFixo(x,fase);x.score=sf;x.scoreBruto=sf;x.politica=Object.assign({},x.politica||{},{aprendizadoAplicado:false,motivo:'desligado-pelo-usuario'});}else{x.politica=Object.assign({},x.politica||{},{aprendizadoAplicado:!!ef.meta.ativo});}
        x.intervencaoLegada=clone(c.intervencao||null);x.intervencaoV4=RO.decidir(x,cfgEf);x.intervencao=x.intervencaoV4||x.intervencaoLegada;return x;
      });
      const opt=OP.selecionar(todos,cfgEf),itens=(opt.itens||[]).map(c=>Object.assign({},c,{motorRobusto:this.MOTOR,perfilAtaque:modo,configRobusto:{versao:C.VERSAO,modo,recursos:clone(cfg.recursos),aprendizado:clone(ef.meta)},auditoria:Object.assign({},c.auditoria||{},{robustoV4:true,roteadorAtivo:!!cfg.recursos.roteadorAtivo,otimizadorAtivo:!!cfg.recursos.otimizadorAtivo,aprendizadoPesosAtivo:!!cfg.recursos.aprendizadoPesosAtivo,aprendizadoAplicado:!!ef.meta.ativo,perfilAtaque:modo,otimizacao:clone(opt.meta)})}));
      const anterior=base.arquitetura&&typeof base.arquitetura==='object'&&base.arquitetura.motor?base.arquitetura.motor:BASE.MOTOR;
      return Object.assign({},base,{motorAnterior:anterior,motor:this.MOTOR,itens,todos,otimizacao:opt.meta,configRobusto:{modo,prefs:clone(cfg),efetiva:clone(cfgEf),aprendizado:clone(ef.meta),resumo:C.resumo(modo)},arquitetura:this.arquitetura(),explicacao:`Robusto V4 · ${C.LABELS[modo]} · roteador ${cfg.recursos.roteadorAtivo?'ligado':'desligado'} · otimizador ${cfg.recursos.otimizadorAtivo?'ligado':'desligado'} · aprendizado ${cfg.recursos.aprendizadoPesosAtivo?'controlado':'desligado'}.`});
    }
  };
  window.PlanoSugestoesRobustoV3=BASE;
  window.PlanoSugestoesRobustoV4=V4;
  // Compatibilidade: o controller V2 captura o símbolo depois deste módulo.
  window.PlanoSugestoesRobustoV2=V4;
})();