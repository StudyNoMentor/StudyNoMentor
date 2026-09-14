/* ============================================================================
   MOTOR ROBUSTO V4 — integra configuração + roteador + otimizador
   A V3 permanece como baseline interno. Esta fachada não conhece Simplificado.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoSugRobustoV4) return;
  window.__planoSugRobustoV4 = true;
  const BASE=window.PlanoSugestoesRobustoV2,C=window.PlanoRobustoConfigV4,RO=window.PlanoRobustoRouterV4,OP=window.PlanoRobustoOptimizerV4;
  if(!BASE||!C||!RO||!OP)return;
  const clone=x=>{try{return JSON.parse(JSON.stringify(x));}catch(_){return x;}};
  const V4={
    VERSAO:4,MOTOR:'robusto-v4',BASE_MOTOR:BASE.MOTOR,
    arquitetura(){return{motor:this.MOTOR,independente:true,usaSimplificado:false,base:BASE.MOTOR,deps:['PlanoEngine','Mentor90V6','historico-extras','PlanoRobustoConfigV4','PlanoRobustoRouterV4','PlanoRobustoOptimizerV4']};},
    modoAtaque(){return C.detectarModo();},
    config(){const m=this.modoAtaque();return{modo:m,prefs:C.prefs(m),resumo:C.resumo(m)};},
    painelConfigHtml(){const m=this.modoAtaque();return C.html(m);},
    bindConfig(root,onChange){const m=this.modoAtaque();return C.bind(root,onChange,m);},
    calcular(){
      const base=BASE.calcular();if(!base||base.erro)return base;
      const modo=C.detectarModo(),cfg=C.prefs(modo),todos=(base.todos||base.itens||[]).map(c=>{
        const x=Object.assign({},c);x.intervencaoLegada=clone(c.intervencao||null);x.intervencaoV4=RO.decidir(x,cfg);x.intervencao=x.intervencaoV4||x.intervencaoLegada;return x;
      });
      const opt=OP.selecionar(todos,cfg),itens=(opt.itens||[]).map(c=>Object.assign({},c,{motorRobusto:this.MOTOR,perfilAtaque:modo,configRobusto:{versao:C.VERSAO,modo,recursos:clone(cfg.recursos)},auditoria:Object.assign({},c.auditoria||{},{robustoV4:true,roteadorAtivo:!!cfg.recursos.roteadorAtivo,otimizadorAtivo:!!cfg.recursos.otimizadorAtivo,perfilAtaque:modo,otimizacao:clone(opt.meta)})}));
      return Object.assign({},base,{motorAnterior:base.arquitetura&&base.arquitetura().motor||BASE.MOTOR,motor:this.MOTOR,itens,todos,otimizacao:opt.meta,configRobusto:{modo,prefs:clone(cfg),resumo:C.resumo(modo)},arquitetura:this.arquitetura(),explicacao:`Robusto V4 · ${C.LABELS[modo]} · roteador ${cfg.recursos.roteadorAtivo?'ligado':'desligado'} · otimizador ${cfg.recursos.otimizadorAtivo?'ligado':'desligado'}.`});
    }
  };
  window.PlanoSugestoesRobustoV3=BASE;
  window.PlanoSugestoesRobustoV4=V4;
  // Compatibilidade: o controller V2 captura o símbolo depois deste módulo.
  window.PlanoSugestoesRobustoV2=V4;
})();
