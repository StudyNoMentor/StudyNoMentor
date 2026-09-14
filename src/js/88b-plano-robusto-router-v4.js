/* ============================================================================
   ROBUSTO — CONFIG/ROTEADOR V6
   - reset realmente volta aos defaults atuais (não ressuscita storage V4);
   - rótulos de confiança heurística deixam de fingir probabilidade calibrada;
   - manutenção respeita a validade própria do domínio;
   - limiar efetivo de ciclos explicita a interação com a confiança da calibração;
   - baixa resposta tem uma única régua soberana no roteador.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoRobustoRouterV6) return;
  window.__planoRobustoRouterV6 = true;
  window.__planoRobustoRouterV5 = true;
  window.__planoRobustoRouterV4 = true;
  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const quedaDe=x=>{for(const k of ['quedaPP','queda','deltaTaxa','tendenciaPP']){const v=Number(x&&x.item&&x.item[k]);if(Number.isFinite(v))return k==='deltaTaxa'||k==='tendenciaPP'?-v:v;}return 0;};

  /* Config V6 por composição: preserva contrato/storage V5, mas corrige reset e
     semântica de interface. O motor carregado depois deste arquivo captura C6. */
  const C5=window.PlanoRobustoConfigV5||window.PlanoRobustoConfigV4;
  if(C5&&!window.PlanoRobustoConfigV6){
    const C6=Object.create(C5);
    C6.REVISAO_AUDITORIA=6;
    C6.restaurarTudo=function(m){
      m=m||this.detectarModo();
      try{
        const ks=[this.chave(m),this.legacyChave?this.legacyChave(m):null].filter(Boolean);
        ks.forEach(k=>{if(DB.delRaw)DB.delRaw(k);else localStorage.removeItem(k);});
      }catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v6-reset');}
      return this.prefs(m);
    };
    const rotulos=(html)=>String(html||'')
      .replace(/ROBUSTO V5/g,'ROBUSTO V6')
      .replace(/Confiança da rota manutenção/g,'Força heurística · manutenção')
      .replace(/Confiança da rota Lei Seca/g,'Força heurística · Lei Seca')
      .replace(/Confiança da rota teoria/g,'Força heurística · teoria')
      .replace(/Confiança da rota flashcards/g,'Força heurística · flashcards')
      .replace(/Confiança de questões com evidência/g,'Força heurística · questões com evidência')
      .replace(/Confiança de questões sem evidência/g,'Força heurística · questões sem evidência')
      .replace(/Ciclos mínimos p\/ intervenção/g,'Ciclos mínimos p/ intervenção (piso)');
    const oldHtml=C5.html,oldManual=C5.manualHtml;
    if(typeof oldHtml==='function')C6.html=function(m){return rotulos(oldHtml.call(this,m));};
    if(typeof oldManual==='function')C6.manualHtml=function(m){return rotulos(oldManual.call(this,m));};
    window.PlanoRobustoConfigV6=C6;
    window.PlanoRobustoConfigV5=C6;
  }

  const R={
    VERSAO:6,
    REVISAO_AUDITORIA:6,
    _legal(disc,r){try{return new RegExp(String(r.padroesNormativos||''),'i').test(norm(disc));}catch(_){return false;}},
    _tempoQuestoes(c,q,cfg){const t=c&&c.mentor&&c.mentor.tempo,rec=cfg.recursos||{},op=cfg.otimizador||{};if(rec.tempoPessoalAtivo&&t&&t.confiavel&&n(t.segundosPorQuestao)>0)return{minutos:q*n(t.segundosPorQuestao)/60,fonte:'tempo-pessoal',confiavel:true};if(rec.fallbackTempoAtivo)return{minutos:q*n(op.fallbackSegQuestao,120)/60,fonte:'fallback-configurado',confiavel:false};return{minutos:null,fonte:'indisponivel',confiavel:false};},
    _ciclosEfetivos(cfg){
      const r=cfg.roteador||{},c=cfg.calibracao||{},p=Math.max(0,Math.min(.999,n(r.confiancaMin,.55))),k=Math.max(1,n(c.shrinkK,5));
      const porConfianca=p<=0?0:Math.ceil(p*k/Math.max(.001,1-p));
      return Math.max(3,Math.round(n(r.minCiclosIntervencao,5)),porConfianca);
    },
    decidir(c,cfg){
      if(!c)return null;
      const r=cfg.roteador||{},rec=cfg.recursos||{},q=n(c.qJanela),taxa=n(c.taxa),dom=c.mentor&&c.mentor.dominio,cal=c.mentor&&c.mentor.calibracao||{},aud=c.auditoria||{},bloco=Math.max(5,Math.round(n(r.questoesBloco,15))),tq=this._tempoQuestoes(c,bloco,cfg),disc=c.disciplina||'',legal=this._legal(disc,r),stale=!!((dom&&dom.vencido)||(c.item&&c.item.vencido)),queda=quedaDe(c),quedaMin=Math.max(.1,n(r.quedaIntervencaoPP,3)),ciclos=Math.max(n(cal.nTopico),n(cal.nDisciplina),n(cal.n)),confCal=Number.isFinite(Number(cal.confianca))?n(cal.confianca):0,minEfetivo=this._ciclosEfetivos(cfg),confMin=n(r.confiancaMin,.55),evid=!!aud.intervencaoConfiavel&&ciclos>=minEfetivo&&confCal>=confMin,baixa=evid&&n(cal.ganho100,99)<=n(r.ganhoBaixaResposta,2.5);
      const mk=(tipo,rotulo,passos,motivo,minFixos,tempoQ,forca)=>{const temQ=!!(tempoQ&&tempoQ.minutos!=null&&Number.isFinite(Number(tempoQ.minutos))),qMin=temQ?n(tempoQ.minutos):null,total=qMin==null?(n(minFixos)>0?n(minFixos):null):n(minFixos)+qMin,fh=Math.max(0,Math.min(1,n(forca,.5)));return{tipo,rotulo,passos,motivo,minutosEstimados:total==null?null:Math.max(1,Math.round(total)),minutosFixos:Math.max(0,Math.round(n(minFixos))),minutosQuestoes:qMin==null?null:Math.max(1,Math.round(qMin)),tempoFonte:qMin==null?'indisponivel':tempoQ.fonte,tempoConfiavel:!!(temQ&&tempoQ.confiavel),forcaHeuristica:fh,confianca:fh,evidencia:{ciclos,ciclosMinConfigurados:Math.max(3,Math.round(n(r.minCiclosIntervencao,5))),ciclosMinEfetivos:minEfetivo,confiancaCalibracao:confCal,confiancaMin:confMin,confiavel:evid,baixaResposta:baixa,legal,stale,quedaPP:queda}};};
      if(!rec.roteadorAtivo)return c.intervencaoLegada||c.intervencao||mk('legado','Intervenção-base',[],'Roteador V6 desligado; preservada a política-base.',0,tq,.5);
      if(q<Math.max(1,n(c.minAmostra,20))&&r.permitirDiagnostico!==false){const faltam=Math.max(5,Math.round(n(c.minAmostra,20)-q)),td=this._tempoQuestoes(c,faltam,cfg);return mk('diagnostico','Diagnóstico por questões',[{tipo:'questoes',quantidade:faltam}],`Amostra ${q}/${Math.round(n(c.minAmostra,20))}: primeiro produzir evidência confiável.`,0,td,.9);}
      if(dom&&['elite','competitivo','manutencao'].includes(dom.nivel)&&(stale||queda>quedaMin)&&r.permitirManutencao!==false){const qq=Math.max(5,Math.round(n(r.manutencaoQuestoes,10))),td=this._tempoQuestoes(c,qq,cfg);if(r.permitirFlashcards&&queda>quedaMin)return mk('flashcards_questoes','Flashcards → manutenção por questões',[{tipo:'anki',minutos:n(r.flashcardsMin,15)},{tipo:'questoes',quantidade:qq}],`Domínio alto com sinal de queda (${queda.toFixed(1)} pp): recuperar antes de ampliar volume.`,n(r.flashcardsMin,15),td,n(r.confiancaManutencao,.8));return mk('manutencao','Manutenção por questões',[{tipo:'questoes',quantidade:qq}],`Domínio alto, mas ${stale?'a medição venceu na validade efetiva do Robusto':'há sinal de queda'}; objetivo é retenção.`,0,td,n(r.confiancaManutencao,.8));}
      const limiarLei=Math.max(0,n(r.taxaTeoria,60)-Math.max(0,n(r.limiarLeiOffset,10)));
      if(baixa&&legal&&taxa>=limiarLei&&r.permitirLeiSeca)return mk('lei_seca_questoes','Lei seca → questões',[{tipo:'leitura',minutos:n(r.leiSecaMin,20)},{tipo:'questoes',quantidade:bloco}],`Matéria normativa com baixa resposta ao volume; reforçar a fonte legal antes da nova medição.`,n(r.leiSecaMin,20),tq,Math.max(confMin,n(r.confiancaLei,.68)));
      if(baixa&&taxa<n(r.taxaTeoria,60)&&r.permitirTeoria)return mk('teoria_questoes','Teoria focal → questões',[{tipo:'teoria',minutos:n(r.teoriaMin,30)},{tipo:'questoes',quantidade:bloco}],`Resposta histórica baixa e taxa ${taxa.toFixed(0)}%: mais volume isolado tende a ter retorno marginal menor.`,n(r.teoriaMin,30),tq,Math.max(confMin,n(r.confiancaTeoria,.70)));
      if(baixa&&legal&&r.permitirLeiSeca)return mk('lei_seca_questoes','Lei seca → questões',[{tipo:'leitura',minutos:n(r.leiSecaMin,20)},{tipo:'questoes',quantidade:bloco}],`Matéria normativa com baixa resposta ao volume; reforçar a fonte legal antes da nova medição.`,n(r.leiSecaMin,20),tq,Math.max(confMin,n(r.confiancaLei,.68)));
      if(evid&&queda>quedaMin&&r.permitirFlashcards)return mk('flashcards_questoes','Flashcards → questões',[{tipo:'anki',minutos:n(r.flashcardsMin,15)},{tipo:'questoes',quantidade:bloco}],`Queda recente sugere recuperação ativa antes do novo bloco de questões.`,n(r.flashcardsMin,15),tq,n(r.confiancaFlashcards,.65));
      if(evid&&taxa<n(r.taxaTeoria,60)&&r.permitirRevisao!==false)return mk('revisao_questoes','Revisão dirigida → questões',[{tipo:'revisao',minutos:n(r.revisaoMin,20)},{tipo:'questoes',quantidade:bloco}],`Taxa ${taxa.toFixed(0)}% abaixo do limiar pedagógico, com histórico suficiente para personalizar.`,n(r.revisaoMin,20),tq,n(r.confiancaQuestoesComEvidencia,.62));
      return mk('questoes_dirigidas','Questões dirigidas',[{tipo:'questoes',quantidade:bloco}],`Não há evidência suficiente de que trocar o método supere um novo bloco de questões.`,0,tq,evid?n(r.confiancaQuestoesComEvidencia,.62):n(r.confiancaQuestoesSemEvidencia,.50));
    }
  };
  window.PlanoRobustoRouterV6=R;
  window.PlanoRobustoRouterV5=R;
  window.PlanoRobustoRouterV4=R;
})();
