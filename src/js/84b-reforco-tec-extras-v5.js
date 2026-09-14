/* ============================================================================
   REFORCO PRESCRITIVO V5 — TEC + EXTRAS
   ----------------------------------------------------------------------------
   Fonte de verdade para dose operacional:
     1) estado estatistico vindo do TEC;
     2) execucao real + veredito posterior das atividades de reforco em Extras.
   Nao usa tempo do ciclo regular, incidencia externa, planejamento da prova,
   nomes de materias do estudo regular ou metodo subjetivo de resolucao.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__reforcoTecExtrasV5) return;
  window.__reforcoTecExtrasV5 = true;

  const N=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const C=(v,a,b)=>Math.max(a,Math.min(b,N(v,a)));
  const norm=s=>String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const median=a=>{const z=(a||[]).filter(Number.isFinite).map(Number).sort((x,y)=>x-y);if(!z.length)return null;const m=z.length>>1;return z.length%2?z[m]:(z[m-1]+z[m])/2;};
  const sum=(a,fn)=>(a||[]).reduce((s,x)=>s+Math.max(0,N(fn(x))),0);
  const nearest5=v=>Math.max(5,Math.round(N(v)/5)*5);

  const X={
    VERSAO:5,
    defaults:Object.freeze({doseMin:10,doseBase:15,doseMax:30,minCiclosDose:4,shrinkDose:8,ganhoMinPP100q:3,minQuestoesTempo:30}),
    _extras(){try{return typeof DB!=='undefined'&&DB.getExtras?DB.getExtras()||[]:[];}catch(e){if(typeof _quiet==='function')_quiet(e,'reforco-tec-extras-db');return[];}},
    _isReforco(e){const o=e&&e.origemPlano,s=o&&o.sugestao;return !!(o&&s&&(/^robusto-v/.test(String(s.motor||''))||s.modoInterface==='robusto'||s.modoInterface==='comparar'));},
    _obs(e){
      if(!this._isReforco(e))return null;
      const o=e.origemPlano||{},s=o.sugestao||{},v=o.veredito||{},h=Array.isArray(e.historico)?e.historico:[];
      const qHist=sum(h,x=>x&&x.quantidade),q=Math.max(qHist,Math.max(0,N(e.progresso)),Math.max(0,N(v.questoes)));
      if(q<=0)return null;
      const min=sum(h,x=>x&&x.minutos),ganho=Number.isFinite(Number(v.ganhoPP))?Number(v.ganhoPP):null;
      return{extraId:String(e.id||''),disciplina:e.disciplina||o.disciplina||'',topico:o.topico||e.titulo||'',questoes:q,minutos:min,ganhoPP:ganho,ganhoPP100q:ganho==null?null:ganho/q*100,concluida:e.status==='concluida'||(N(e.alvo)>0&&q>=N(e.alvo)),prescrita:N(s.doseRecomendada,s.doseDiaria||s.alvoGlobal||e.alvo),data:v.em||v.data||e.updatedAt||e.createdAt||null};
    },
    observacoes(){return this._extras().map(e=>this._obs(e)).filter(Boolean);},
    historico(disciplina,topico,cfg={}){
      cfg={...this.defaults,...cfg};const d=norm(disciplina),t=norm(topico),all=this.observacoes(),exact=all.filter(x=>norm(x.disciplina)===d&&norm(x.topico)===t),disc=all.filter(x=>norm(x.disciplina)===d);
      const min=Math.max(2,Math.round(N(cfg.minCiclosDose,4)));let pool=[],nivel='global';
      if(exact.filter(x=>x.ganhoPP!=null).length>=min){pool=exact;nivel='topico';}
      else if(disc.filter(x=>x.ganhoPP!=null).length>=Math.max(min,5)){pool=disc;nivel='disciplina';}
      else{pool=all;nivel='global';}
      const medidos=pool.filter(x=>x.ganhoPP!=null&&x.questoes>0),ef=medidos.map(x=>x.ganhoPP100q).filter(Number.isFinite),efMed=median(ef),positivos=medidos.filter(x=>N(x.ganhoPP)>0).sort((a,b)=>N(b.ganhoPP100q)-N(a.ganhoPP100q));
      const elite=positivos.length?positivos.slice(0,Math.max(1,Math.ceil(positivos.length/2))):medidos;
      return{nivel,n:medidos.length,nExecucoes:pool.length,ganhoPP100qMediano:efMed,doseEficienteMediana:median(elite.map(x=>x.questoes)),questoesMediana:median(medidos.map(x=>x.questoes)),observacoes:medidos};
    },
    tempo(disciplina,topico,dose,cfg={}){
      cfg={...this.defaults,...cfg};const d=norm(disciplina),t=norm(topico),all=this.observacoes().filter(x=>x.questoes>0&&x.minutos>0),exact=all.filter(x=>norm(x.disciplina)===d&&norm(x.topico)===t),disc=all.filter(x=>norm(x.disciplina)===d);
      let pool=exact.reduce((s,x)=>s+x.questoes,0)>=Math.max(15,N(cfg.minQuestoesTempo,30)/2)?exact:disc;
      const q=pool.reduce((s,x)=>s+x.questoes,0),min=pool.reduce((s,x)=>s+x.minutos,0),confiavel=q>=Math.max(10,N(cfg.minQuestoesTempo,30))&&min>0,segQ=confiavel?min*60/q:null;
      return{confiavel,fonte:confiavel?(pool===exact?'extras-topico':'extras-disciplina'):'indisponivel',questoes:q,minutos:min,segundosPorQuestao:segQ,minutosEstimados:confiavel&&dose>0?Math.max(1,Math.round(dose*segQ/60)):null};
    },
    prescrever(item,cfg={}){
      cfg={...this.defaults,...cfg};const min=Math.max(5,Math.round(N(cfg.doseMin,10))),base=Math.max(min,Math.round(N(cfg.doseBase,15))),max=Math.max(base,Math.round(N(cfg.doseMax,30)));
      const q=Math.max(0,Math.round(N(item&&item.qJanela))),minA=Math.max(1,Math.round(N(item&&item.minAmostra,20))),lac=C(N(item&&item.componentes&&item.componentes.lacuna),0,1),evid=C(N(item&&item.componentes&&item.componentes.evidencia),0,1),pers=C(N(item&&item.componentes&&item.componentes.persistencia),0,1);
      let estat;if(q<minA){estat=C(Math.max(min,Math.min(base,minA-q||min)),min,max);}else{estat=C(Math.round(base*(.75+.55*lac+.25*evid+.20*pers)),min,max);if(N(item&&item.posterior&&item.posterior.media)>=N(item&&item.meta,90)-5)estat=C(Math.round(estat*.82),min,max);}
      const hist=this.historico(item&&item.disciplina,item&&item.nome,cfg),n=hist.n,alpha=Math.min(.60,n/(n+Math.max(1,N(cfg.shrinkDose,8)))),histDose=hist.doseEficienteMediana;
      let resposta=1;const g=hist.ganhoPP100qMediano;if(Number.isFinite(g)){if(g<N(cfg.ganhoMinPP100q,3))resposta=.85;else if(g>=N(cfg.ganhoMinPP100q,3)*2)resposta=1.08;}
      const baseResp=C(estat*resposta,min,max),mix=Number.isFinite(histDose)?baseResp*(1-alpha)+histDose*alpha:baseResp,dose=C(nearest5(mix),min,max),tempo=this.tempo(item&&item.disciplina,item&&item.nome,dose,cfg);
      return{versao:5,dose,fonte:'tec+extras',doseEstatistica:estat,alphaHistorico:alpha,historico:hist,tempo,regra:q<minA?'completar-amostra':'lacuna-e-resposta',metodologia:'questoes-aprofundadas'};
    }
  };

  window.ReforcoTecExtrasV5=X;

  /* Compatibilidade com o modulo prescritivo existente: a dose passa a usar a
     mesma fonte TEC+Extras, mas preserva o envelope esperado pela continuidade. */
  if(window.ReforcoAdaptativo){
    const RA=window.ReforcoAdaptativo;
    RA.VERSAO=5;
    RA.historico=function(item,p){return X.historico(item&&item.disciplina,item&&item.nome,{doseMin:p&&p.dosePreMin,doseBase:p&&p.dosePreBase,doseMax:p&&p.dosePreMax,minCiclosDose:p&&p.ciclosAprender,ganhoMinPP100q:p&&p.ganhoMinimoPP});};
    RA.prescrever=function(item,r){
      const p=this.prefs?this.prefs():{},meta=N(r&&r.meta,90),minA=Math.max(1,N((typeof PlanoEngine!=='undefined'&&PlanoEngine.prefs)?PlanoEngine.prefs().minAmostra:20,20)),taxa=C(N(item&&item.taxa,50),0,100),q=Math.max(0,N(item&&item.qJanela,item&&item.qHist)),post=this.posterior?this.posterior(taxa,q,meta,N(p.deltaLacuna,5)):null;
      const lac=C((meta-N(post&&post.media,taxa))/Math.max(1,meta),0,1),evid=C(N(post&&post.pLacuna,.5),0,1),rx=X.prescrever({disciplina:item&&item.disciplina,nome:item&&item.nome,qJanela:q,minAmostra:minA,meta,posterior:post,componentes:{lacuna:lac,evidencia:evid,persistencia:.5}},{doseMin:p.dosePreMin,doseBase:p.dosePreBase,doseMax:p.dosePreMax,minCiclosDose:p.ciclosAprender,shrinkDose:8,ganhoMinPP100q:p.ganhoMinimoPP});
      let sid=null;try{const a=typeof DB!=='undefined'&&DB.getTecSnapshots?DB.getTecSnapshots():[];sid=a.length?a[a.length-1].id:null;}catch(e){if(typeof _quiet==='function')_quiet(e,'reforco-tec-extras-snapshot');}
      return{versao:5,fase:'tec',score:N(item&&item.score),dose:rx.dose,objetivo:q<minA?'diagnosticar':'intervir',teoriaPrimeiro:false,confiouMeta:false,lacunaConfirmada:evid>=.5,estatistica:post||{},historico:rx.historico,componentes:{lacuna:lac,evidencia:evid},custoEstrategico:rx.dose,snapshotId:sid,meta,fonte:'tec+extras',tempo:rx.tempo};
    };
  }
})();
