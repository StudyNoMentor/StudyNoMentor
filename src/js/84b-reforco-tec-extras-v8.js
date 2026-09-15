/* ============================================================================
   REFORCO PRESCRITIVO V8 — TEC + EXTRAS
   ----------------------------------------------------------------------------
   Fonte operacional da dose:
     1) estado estatistico observado no TEC;
     2) execucao REAL registrada nos reforcos de Extras;
     3) desfecho posterior do TEC tratado como observacional, nunca causal.

   O TEC pode incluir questoes feitas fora do reforco (ex.: ciclo regular).
   Por isso cada observacao recebe um peso de atribuicao conservador: quanto
   menor a fracao da exposicao que conseguimos vincular ao Extra, menor sua
   influencia na calibracao futura da dose.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__reforcoTecExtrasV8) return;
  window.__reforcoTecExtrasV8 = true;

  const N=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const C=(v,a,b)=>Math.max(a,Math.min(b,N(v,a)));
  const norm=s=>String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const sum=(a,fn)=>(a||[]).reduce((s,x)=>s+Math.max(0,N(fn(x))),0);
  const nearest5=v=>Math.max(5,Math.round(N(v)/5)*5);
  const weightedMedian=(rows,valueFn,weightFn)=>{
    const a=(rows||[]).map(x=>({v:Number(valueFn(x)),w:Math.max(0,Number(weightFn(x))||0)})).filter(x=>Number.isFinite(x.v)&&x.w>0).sort((x,y)=>x.v-y.v);
    if(!a.length)return null;const total=a.reduce((s,x)=>s+x.w,0),half=total/2;let acc=0;for(const x of a){acc+=x.w;if(acc>=half)return x.v;}return a[a.length-1].v;
  };

  const X={
    VERSAO:8,
    defaults:Object.freeze({doseMin:10,doseBase:15,doseMax:30,minCiclosDose:4,shrinkDose:8,ganhoMinPP100q:3,minQuestoesTempo:30}),
    _extras(){try{return typeof DB!=='undefined'&&DB.getExtras?DB.getExtras()||[]:[];}catch(e){if(typeof _quiet==='function')_quiet(e,'reforco-tec-extras-v8-db');return[];}},
    _isReforco(e){const s=e&&e.origemPlano&&e.origemPlano.sugestao;return !!(s&&(/^robusto-v/.test(String(s.motor||''))||s.modoInterface==='robusto'||s.modoInterface==='comparar'));},
    _atribuicao(qExtra,veredito){
      const qTec=Number(veredito&&veredito.questoes);
      if(Number.isFinite(qTec)&&qTec>0){
        const fracao=C(qExtra/qTec,0,1);
        return{tipo:'exposicao-conhecida/volume-TEC',qTecObservada:qTec,fracaoExposicaoConhecida:fracao,pesoCalibracao:Math.min(.85,.15+.70*fracao),causal:false};
      }
      return{tipo:'observacional-sem-volume-TEC',qTecObservada:null,fracaoExposicaoConhecida:null,pesoCalibracao:.25,causal:false};
    },
    _obs(e){
      if(!this._isReforco(e))return null;
      const o=e.origemPlano||{},s=o.sugestao||{},v=o.veredito||{},h=Array.isArray(e.historico)?e.historico:[];
      const qHist=sum(h,x=>x&&x.quantidade),q=Math.max(qHist,Math.max(0,N(e.progresso)),Math.max(0,N(v.questoesExtra)));
      if(q<=0)return null;
      const min=sum(h,x=>x&&x.minutos),ganho=Number.isFinite(Number(v.ganhoPP))?Number(v.ganhoPP):null,atr=this._atribuicao(q,v);
      return{
        extraId:String(e.id||''),disciplina:e.disciplina||o.disciplina||'',topico:o.topico||e.titulo||'',questoes:q,minutos:min,
        ganhoPP:ganho,ganhoPP100q:ganho==null?null:ganho/q*100,concluida:e.status==='concluida'||(N(e.alvo)>0&&q>=N(e.alvo)),
        prescrita:N(s.quantidadeRecomendada,s.doseRecomendada||s.doseDiaria||s.alvoGlobal||e.alvo),data:v.em||v.data||e.updatedAt||e.createdAt||null,
        atribuicao:atr
      };
    },
    observacoes(){return this._extras().map(e=>this._obs(e)).filter(Boolean);},
    historico(disciplina,topico,cfg={}){
      cfg={...this.defaults,...cfg};const d=norm(disciplina),t=norm(topico),all=Array.isArray(cfg._observacoes)?cfg._observacoes:this.observacoes(),exact=all.filter(x=>norm(x.disciplina)===d&&norm(x.topico)===t),disc=all.filter(x=>norm(x.disciplina)===d);
      const min=Math.max(2,Math.round(N(cfg.minCiclosDose,4)));let pool=[],nivel='global';
      const efetivo=a=>a.filter(x=>x.ganhoPP!=null).reduce((s,x)=>s+N(x.atribuicao&&x.atribuicao.pesoCalibracao,.25),0);
      if(efetivo(exact)>=min){pool=exact;nivel='topico';}
      else if(efetivo(disc)>=Math.max(min,5)){pool=disc;nivel='disciplina';}
      else{pool=all;nivel='global';}
      const medidos=pool.filter(x=>x.ganhoPP!=null&&x.questoes>0),nEfetivo=efetivo(medidos),w=x=>N(x.atribuicao&&x.atribuicao.pesoCalibracao,.25);
      const ganhoMed=weightedMedian(medidos,x=>x.ganhoPP100q,w),positivos=medidos.filter(x=>N(x.ganhoPP)>0);
      const doseMed=weightedMedian(positivos.length?positivos:medidos,x=>x.questoes,w),qualidade=medidos.length?medidos.reduce((s,x)=>s+w(x),0)/medidos.length:0;
      return{nivel,n:medidos.length,nEfetivo,qualidadeAtribuicao:qualidade,ganhoPP100qMediano:ganhoMed,doseEficienteMediana:doseMed,observacoes:medidos,causal:false};
    },
    tempo(disciplina,topico,dose,cfg={}){
      cfg={...this.defaults,...cfg};const d=norm(disciplina),t=norm(topico),all=(Array.isArray(cfg._observacoes)?cfg._observacoes:this.observacoes()).filter(x=>x.questoes>0&&x.minutos>0),exact=all.filter(x=>norm(x.disciplina)===d&&norm(x.topico)===t),disc=all.filter(x=>norm(x.disciplina)===d);
      let pool=exact.reduce((s,x)=>s+x.questoes,0)>=Math.max(15,N(cfg.minQuestoesTempo,30)/2)?exact:disc;
      const q=pool.reduce((s,x)=>s+x.questoes,0),min=pool.reduce((s,x)=>s+x.minutos,0),confiavel=q>=Math.max(10,N(cfg.minQuestoesTempo,30))&&min>0,segQ=confiavel?min*60/q:null;
      return{confiavel,fonte:confiavel?(pool===exact?'extras-topico':'extras-disciplina'):'indisponivel',questoes:q,minutos:min,segundosPorQuestao:segQ,minutosEstimados:confiavel&&dose>0?Math.max(1,Math.round(dose*segQ/60)):null};
    },
    prescrever(item,cfg={}){
      cfg={...this.defaults,...cfg};const min=Math.max(5,Math.round(N(cfg.doseMin,10))),base=Math.max(min,Math.round(N(cfg.doseBase,15))),max=Math.max(base,Math.round(N(cfg.doseMax,30)));
      const q=Math.max(0,Math.round(N(item&&item.qJanela))),minA=Math.max(1,Math.round(N(item&&item.minAmostra,20))),lac=C(N(item&&item.componentes&&item.componentes.lacuna),0,1),evid=C(N(item&&item.componentes&&item.componentes.evidencia),0,1),pers=C(N(item&&item.componentes&&item.componentes.persistencia),0,1);
      let estat;
      if(q<minA)estat=C(Math.max(min,Math.min(base,minA-q||min)),min,max);
      else{
        estat=C(Math.round(base*(.76+.48*lac+.24*evid+.16*pers)),min,max);
        if(N(item&&item.posterior&&item.posterior.media)>=N(item&&item.meta,90)-5)estat=C(Math.round(estat*.82),min,max);
      }
      const hist=this.historico(item&&item.disciplina,item&&item.nome,cfg),nEff=hist.nEfetivo,alpha=Math.min(.45,nEff/(nEff+Math.max(1,N(cfg.shrinkDose,8)))),histDose=hist.doseEficienteMediana;
      let resposta=1;const g=hist.ganhoPP100qMediano;
      if(Number.isFinite(g)&&nEff>=Math.max(2,N(cfg.minCiclosDose,4)/2)){if(g<N(cfg.ganhoMinPP100q,3))resposta=.90;else if(g>=N(cfg.ganhoMinPP100q,3)*2)resposta=1.06;}
      const baseResp=C(estat*resposta,min,max),mix=Number.isFinite(histDose)?baseResp*(1-alpha)+histDose*alpha:baseResp,dose=C(nearest5(mix),min,max),tempo=this.tempo(item&&item.disciplina,item&&item.nome,dose,cfg);
      return{versao:8,dose,fonte:'tec+extras',doseEstatistica:estat,alphaHistorico:alpha,historico:hist,tempo,regra:q<minA?'completar-amostra':'lacuna-e-resposta-observacional',metodologia:'questoes-aprofundadas',causal:false};
    }
  };

  window.ReforcoTecExtrasV8=X;
})();