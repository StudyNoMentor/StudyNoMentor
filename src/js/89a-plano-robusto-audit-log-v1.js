/* ============================================================================
   ROBUSTO — LOG DE AUDITORIA HUMANA V1
   ----------------------------------------------------------------------------
   Telemetria estritamente LOCAL e explícita: nada é enviado para servidor.
   Registra o contexto da decisão do Robusto, atividades efetivamente criadas e
   desfechos observados em Extras. O JSON exportado fornece pares features ->
   outcome para auditoria/calibração offline sem misturar o Simplificado.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoRobustoAuditV1) return;
  const C=window.PlanoSugestoesV4||window.PlanoSugestoesV3||window.PlanoSugestoesV2;
  const R=window.PlanoSugestoesRobustoV6||window.PlanoSugestoesRobustoV5||window.PlanoSugestoesRobustoV4;
  const RC=window.PlanoRobustoConfigV6||window.PlanoRobustoConfigV5||window.PlanoRobustoConfigV4;
  if(!C||!R||typeof DB==='undefined')return;
  window.__planoRobustoAuditV1=true;

  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const finite=v=>Number.isFinite(Number(v));
  const round=(v,d=3)=>finite(v)?Math.round(Number(v)*10**d)/10**d:null;
  const clone=x=>{try{return JSON.parse(JSON.stringify(x));}catch(_){return x;}};
  const iso=()=>new Date().toISOString();
  const norm=s=>String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const canonical=x=>{
    const walk=v=>{
      if(Array.isArray(v))return v.map(walk);
      if(v&&typeof v==='object')return Object.keys(v).sort().reduce((o,k)=>{const z=walk(v[k]);if(z!==undefined)o[k]=z;return o;},{});
      if(typeof v==='number'&&!Number.isFinite(v))return null;
      return v===undefined?undefined:v;
    };
    try{return JSON.stringify(walk(x));}catch(_){return String(x);}
  };
  const hash=x=>{
    const s=typeof x==='string'?x:canonical(x);let h=2166136261;
    for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
    return (h>>>0).toString(36);
  };
  const uid=prefix=>{
    try{if(crypto&&typeof crypto.randomUUID==='function')return prefix+'-'+crypto.randomUUID();}catch(_){/* local fallback */}
    return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
  };
  const numericMap=o=>{
    const out={};if(!o||typeof o!=='object')return out;
    Object.keys(o).forEach(k=>{if(finite(o[k]))out[k]=round(o[k]);});return out;
  };
  const pick=(o,keys)=>{
    const out={};if(!o||typeof o!=='object')return out;
    keys.forEach(k=>{const v=o[k];if(v!==undefined&&v!==null&&v!=='')out[k]=clone(v);});return out;
  };
  const sum=(a,fn)=>(a||[]).reduce((s,x)=>s+n(fn(x)),0);
  const median=a=>{const z=(a||[]).filter(finite).map(Number).sort((x,y)=>x-y);if(!z.length)return null;const m=Math.floor(z.length/2);return z.length%2?z[m]:(z[m-1]+z[m])/2;};

  const A={
    VERSAO:1,
    SCHEMA:'studynomentor.robusto-audit.v1',
    KEY:'plano-robusto-audit-v1',
    MAX_EVENTS:900,
    MAX_CONFIGS:36,
    MAX_CANDIDATES:6,
    DEDUPE_MS:60000,
    SESSION:uid('sessao'),
    _lastDecisionId:null,
    _origRobusto:null,
    _origCriar:null,

    _key(){try{return DB._profilePrefix()+this.KEY;}catch(_){return this.KEY;}},
    _novo(){return{schema:this.SCHEMA,schemaVersion:this.VERSAO,anonProfileId:uid('perfil'),criadoEm:iso(),atualizadoEm:iso(),seq:0,configs:{},events:[],resultadoFingerprints:{}};},
    _load(){
      let z=null;try{z=JSON.parse(localStorage.getItem(this._key())||'null');}catch(_){z=null;}
      if(!z||z.schema!==this.SCHEMA)z=this._novo();
      if(!z.anonProfileId)z.anonProfileId=uid('perfil');
      if(!z.configs||typeof z.configs!=='object')z.configs={};
      if(!Array.isArray(z.events))z.events=[];
      if(!z.resultadoFingerprints||typeof z.resultadoFingerprints!=='object')z.resultadoFingerprints={};
      z.seq=Math.max(0,Math.round(n(z.seq)));
      return z;
    },
    _save(z){
      z.atualizadoEm=iso();
      if(z.events.length>this.MAX_EVENTS)z.events=z.events.slice(z.events.length-this.MAX_EVENTS);
      const usados=new Set(z.events.map(e=>e&&e.configId).filter(Boolean));
      const keys=Object.keys(z.configs||{});
      if(keys.length>this.MAX_CONFIGS){
        keys.filter(k=>!usados.has(k)).slice(0,Math.max(0,keys.length-this.MAX_CONFIGS)).forEach(k=>delete z.configs[k]);
      }
      try{
        const raw=JSON.stringify(z);
        if(DB.setRaw)DB.setRaw(this._key(),raw);else localStorage.setItem(this._key(),raw);
      }catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-audit-save');}
      return z;
    },
    _append(z,tipo,payload){
      const ev=Object.assign({id:'evt-'+(++z.seq),ts:iso(),tipo,sessao:this.SESSION,motor:R.MOTOR||'robusto-v5',revisaoRobusto:R.REVISAO_AUDITORIA||R.VERSAO||null},clone(payload||{}));
      z.events.push(ev);return ev;
    },
    _appVersion(){try{return document.querySelector('meta[name="diario-versao"]')?.content||null;}catch(_){return null;}},
    _perfilAtaque(){try{return R.modoAtaque?R.modoAtaque():(RC&&RC.detectarModo?RC.detectarModo():'base');}catch(_){return'base';}},
    _configSnapshot(){
      const modo=this._perfilAtaque();let prefs={};
      try{prefs=RC&&RC.prefs?clone(RC.prefs(modo)):{};}catch(_){prefs={};}
      return{modo,revisaoAuditoria:R.REVISAO_AUDITORIA||null,versaoMotor:R.VERSAO||null,prefs};
    },
    _ensureConfig(z){const snap=this._configSnapshot(),id='cfg-'+hash(snap);if(!z.configs[id])z.configs[id]=snap;return id;},
    _scope(){
      const out={};
      try{
        const D=window.DesempenhoTecScreen||((typeof DesempenhoTecScreen!=='undefined')?DesempenhoTecScreen:null);
        if(D){out.modo=D.scopeMode||null;out.retratosSelecionados=D.selectedSnapIds&&typeof D.selectedSnapIds.size==='number'?D.selectedSnapIds.size:null;out.dataInicio=D.rangeStart||null;out.dataFim=D.rangeEnd||null;}
      }catch(_){/* diagnóstico opcional */}
      try{const snaps=DB.getTecSnapshots?DB.getTecSnapshots():[];out.retratosDisponiveis=snaps.length;const u=snaps[snaps.length-1];out.ultimoRetrato=u?{id:u.id??null,data:u.endDate||u.date||u.startDate||null}:null;}catch(_){/* opcional */}
      return out;
    },
    _intervencao(c){const v=c&&((c.intervencaoV6)||(c.intervencaoV5)||(c.intervencaoV4)||c.intervencao)||null;if(!v)return null;return pick(v,['tipo','rotulo','motivo','tempoFonte','minutosEstimados','minutosQuestoes','confianca','forcaHeuristica','passos']);},
    _otimizacao(c){const v=c&&((c.otimizacaoV6)||(c.otimizacaoV5)||(c.otimizacaoV4)||c.otimizacao)||null;if(!v)return null;return pick(v,['rank','score','utilidade','minutosAlocados','questoesAlocadas','orcamentoMin','maxFrentePct','restricoes','motivos']);},
    _cand(c,rank){
      if(!c)return null;const m=c.mentor||{},dom=m.dominio||{},cal=m.calibracao||{},tempo=m.tempo||{};
      return{
        rank,disciplina:c.disciplina||'',topico:c.nome||'',score:round(c.score),taxa:round(c.taxa,2),qJanela:Math.max(0,Math.round(n(c.qJanela,c.item&&c.item.qJanela))),qHist:Math.max(0,Math.round(n(c.qHist,c.item&&c.item.qHist))),alvoGlobal:Math.max(0,Math.round(n(c.alvo))),doseDiaria:c.doseDiaria==null?null:Math.max(0,Math.round(n(c.doseDiaria))),meta:c.meta==null?null:round(c.meta,2),minAmostra:c.minAmostra==null?null:Math.round(n(c.minAmostra)),banca:c.banca||null,fase:c.fase||null,
        componentes:numericMap(c.componentes),
        dominio:pick(dom,['nivel','rotulo','n','taxa','metaOperacional','metaCompetitiva','metaElite','pOperacional','pCompetitiva','pElite','diasDesdeMedicao','vencido','validadeDias']),
        calibracao:pick(cal,['nivel','n','nTopico','nDisciplina','nGlobal','ganho100','qPorPonto','confianca','evidenciaIntervencao','baixaResposta','limiarCiclos']),
        tempo:pick(tempo,['confiavel','segundosPorQuestao','q','lancamentos','escopo']),
        intervencao:this._intervencao(c),otimizacao:this._otimizacao(c),
        politica:c.politica?pick(c.politica,['n','nElegiveis','aprendida','shrink','validacao','fase','perfil','outcome','alpha','aplicado','regularizacao']):null,
        auditoria:c.auditoria?pick(c.auditoria,['robustoV6','revisaoAuditoria','posteriorPriorReal','aprendizadoSegregado','scoreCanonicoNoOtimizador']):null
      };
    },
    _decisionSignature(res,configId,modoInterface){const itens=(res&&res.itens||[]).map((c,i)=>[c.disciplina,c.nome,round(c.score),i+1]);return hash({configId,modoInterface,fase:res&&res.fase,itens});},
    registrarCalculo(res,ctx){
      if(!res||res.erro)return null;this.reconciliar({save:false});const z=this._load(),configId=this._ensureConfig(z),modoInterface=(ctx&&ctx.modoInterface)||null,sig=this._decisionSignature(res,configId,modoInterface),ult=[...z.events].reverse().find(e=>e.tipo==='decisao');
      if(ult&&ult.assinatura===sig&&Date.now()-new Date(ult.ts).getTime()<this.DEDUPE_MS){this._lastDecisionId=ult.id;return ult;}
      const pool=(res.todos&&res.todos.length?res.todos:res.itens||[]).slice(0,this.MAX_CANDIDATES),sel=res.itens||[],ev=this._append(z,'decisao',{assinatura:sig,configId,modoInterface,fase:res.fase||null,perfilAtaque:this._perfilAtaque(),escopo:this._scope(),explicacao:String(res.explicacao||'').slice(0,500),candidatos:pool.map((c,i)=>this._cand(c,i+1)),selecionados:sel.map((c,i)=>this._cand(c,i+1)),configPlano:res.configPlano?clone(res.configPlano):null,politica:res.politica?clone(res.politica):null,metaOtimizador:res.metaOtimizador||res.otimizador||null});
      this._lastDecisionId=ev.id;this._save(z);return ev;
    },
    _decisionFor(z,extra){
      const s=extra&&extra.origemPlano&&extra.origemPlano.sugestao||{},d=norm(extra&&extra.disciplina),t=norm(extra&&extra.origemPlano&&extra.origemPlano.topico);
      return [...z.events].reverse().find(e=>e.tipo==='decisao'&&(!s.criadoEm||e.ts.slice(0,10)>=String(s.criadoEm).slice(0,10))&&(e.selecionados||[]).some(c=>norm(c.disciplina)===d&&norm(c.topico)===t))||null;
    },
    registrarCriacao(extra){
      const s=extra&&extra.origemPlano&&extra.origemPlano.sugestao||{};if(!/^robusto-v/.test(String(s.motor||'')))return null;
      const z=this._load(),eid=String(extra.id||''),ja=z.events.find(e=>e.tipo==='atividade_criada'&&e.extraId===eid);if(ja)return ja;
      const dec=this._lastDecisionId?z.events.find(e=>e.id===this._lastDecisionId):this._decisionFor(z,extra),ev=this._append(z,'atividade_criada',{extraId:eid,decisionId:dec&&dec.id||null,configId:dec&&dec.configId||null,modoInterface:s.modoInterface||null,fase:s.fase||null,perfilAtaque:s.configRobusto&&s.configRobusto.modo||s.perfilAtaque||null,disciplina:extra.disciplina||extra.origemPlano.disciplina||'',topico:extra.origemPlano.topico||'',alvoGlobal:Math.max(0,Math.round(n(s.alvoGlobal,extra.alvo))),doseDiaria:s.doseDiaria==null?null:Math.max(0,Math.round(n(s.doseDiaria))),score:round(s.score),componentes:numericMap(s.componentes),intervencao:s.intervencao?clone(s.intervencao):null,otimizacao:s.otimizacaoV6||s.otimizacaoV5||null,criadoEm:s.criadoEm||extra.createdAt||null});
      this._save(z);return ev;
    },
    _histResumo(extra){
      const hist=Array.isArray(extra&&extra.historico)?extra.historico:[],q=sum(hist,h=>Math.max(0,n(h&&h.quantidade))),min=sum(hist,h=>Math.max(0,n(h&&h.minutos))),ac=sum(hist,h=>Math.max(0,n(h&&(h.acertos??h.certas??h.corretas)))),er=sum(hist,h=>Math.max(0,n(h&&(h.erros??h.erradas??h.incorretas)))),datas=hist.map(h=>h&&h.data).filter(Boolean).sort();
      return{lancamentos:hist.length,questoes:q,minutos:round(min,2),acertos:ac||null,erros:er||null,primeiroDia:datas[0]||null,ultimoDia:datas[datas.length-1]||null};
    },
    _resultado(extra){
      const o=extra&&extra.origemPlano||{},s=o.sugestao||{},v=o.veredito||{},h=this._histResumo(extra),qVer=finite(v.questoes)?Math.max(0,n(v.questoes)):null,ganho=finite(v.ganhoPP)?n(v.ganhoPP):null,qBase=Math.max(0,n(o.qBaseNo,o.qBase)),taxaInicial=finite(o.taxaInicial)?n(o.taxaInicial):null,taxaFinal=finite(v.taxa)?n(v.taxa):(finite(v.taxaFinal)?n(v.taxaFinal):null),executado=Math.max(Math.max(0,n(extra.progresso)),h.questoes),alvo=Math.max(0,n(extra.alvo,s.alvoGlobal));
      return{extraId:String(extra.id||''),status:extra.status||null,disciplina:extra.disciplina||o.disciplina||'',topico:o.topico||'',fase:s.fase||null,perfilAtaque:s.configRobusto&&s.configRobusto.modo||s.perfilAtaque||null,alvoGlobal:alvo,doseDiaria:s.doseDiaria==null?null:Math.max(0,n(s.doseDiaria)),executado,percentualAlvo:alvo>0?round(Math.min(1,executado/alvo),4):null,historico:h,medicao:{qBase,taxaInicial:round(taxaInicial,2),taxaFinal:round(taxaFinal,2),ganhoPP:round(ganho,3),questoesVeredito:qVer,em:v.em||v.data||null},concluida:extra.status==='concluida'||(alvo>0&&executado>=alvo),updatedAt:extra.updatedAt||null};
    },
    reconciliar(opts){
      const save=!(opts&&opts.save===false),z=this._load();let alterou=false,extras=[];try{extras=DB.getExtras?DB.getExtras():[];}catch(_){extras=[];}
      for(const e of extras){const s=e&&e.origemPlano&&e.origemPlano.sugestao||{};if(!/^robusto-v/.test(String(s.motor||'')))continue;if(!z.events.some(x=>x.tipo==='atividade_criada'&&x.extraId===String(e.id||''))){this.registrarCriacao(e);continue;}const r=this._resultado(e),fp=hash(r),id=String(e.id||'');if(z.resultadoFingerprints[id]===fp)continue;z.resultadoFingerprints[id]=fp;this._append(z,'resultado_snapshot',Object.assign({fingerprint:fp},r));alterou=true;}
      if(alterou&&save)this._save(z);return{alterou,eventos:z.events.length};
    },
    _latestOutcomes(z){const m=new Map();for(const e of z.events){if(e.tipo==='resultado_snapshot'&&e.extraId)m.set(e.extraId,e);}return m;},
    _dataset(z){
      const out=[],latest=this._latestOutcomes(z),decById=new Map(z.events.filter(e=>e.tipo==='decisao').map(e=>[e.id,e]));
      for(const c of z.events.filter(e=>e.tipo==='atividade_criada')){const r=latest.get(c.extraId);if(!r)continue;const d=c.decisionId&&decById.get(c.decisionId),cand=d&&(d.selecionados||[]).find(x=>norm(x.disciplina)===norm(c.disciplina)&&norm(x.topico)===norm(c.topico));const ganho=finite(r.medicao&&r.medicao.ganhoPP)?n(r.medicao.ganhoPP):null,q=n(r.medicao&&r.medicao.questoesVeredito,r.historico&&r.historico.questoes),min=n(r.historico&&r.historico.minutos),temLabel=ganho!=null&&q>0;
        out.push({extraId:c.extraId,decisionId:c.decisionId||null,tsDecisao:d&&d.ts||c.ts,fase:c.fase||d&&d.fase||null,perfilAtaque:c.perfilAtaque||d&&d.perfilAtaque||null,disciplina:c.disciplina,topico:c.topico,features:{score:c.score??cand&&cand.score??null,componentes:Object.keys(c.componentes||{}).length?c.componentes:(cand&&cand.componentes||{}),taxa:cand&&cand.taxa??null,qJanela:cand&&cand.qJanela??null,dominio:cand&&cand.dominio||null,calibracao:cand&&cand.calibracao||null,tempo:cand&&cand.tempo||null,intervencao:c.intervencao||cand&&cand.intervencao||null,otimizacao:c.otimizacao||cand&&cand.otimizacao||null,alvoGlobal:c.alvoGlobal,doseDiaria:c.doseDiaria},outcome:{observado:temLabel,concluida:!!r.concluida,questoesExecutadas:n(r.historico&&r.historico.questoes),minutosExecutados:min,ganhoPP:ganho,ganhoPP100q:temLabel?round(ganho/q*100,4):null,ganhoPPHora:temLabel&&min>0?round(ganho/min*60,4):null,taxaInicial:r.medicao&&r.medicao.taxaInicial??null,taxaFinal:r.medicao&&r.medicao.taxaFinal??null}});}
      return out;
    },
    _breakdown(dataset,key){const m=new Map();for(const x of dataset){const k=String(key(x)||'sem-classificacao'),z=m.get(k)||{n:0,observados:0,concluidos:0,ganhos:[],ganhosHora:[]};z.n++;if(x.outcome.observado){z.observados++;z.ganhos.push(x.outcome.ganhoPP100q);if(finite(x.outcome.ganhoPPHora))z.ganhosHora.push(x.outcome.ganhoPPHora);}if(x.outcome.concluida)z.concluidos++;m.set(k,z);}return Object.fromEntries([...m.entries()].map(([k,z])=>[k,{n:z.n,observados:z.observados,taxaConclusao:round(z.concluidos/Math.max(1,z.n),4),medianaGanhoPP100q:round(median(z.ganhos),4),medianaGanhoPPHora:round(median(z.ganhosHora),4)}]));},
    diagnostico(){
      this.reconciliar();const z=this._load(),dataset=this._dataset(z),obs=dataset.filter(x=>x.outcome.observado),timed=obs.filter(x=>finite(x.outcome.ganhoPPHora)),latest=this._latestOutcomes(z),horas=[...latest.values()].reduce((s,r)=>s+n(r.historico&&r.historico.minutos),0)/60,minApr=(()=>{try{const p=RC&&RC.prefs?RC.prefs(this._perfilAtaque()):null;return Math.max(1,Math.round(n(p&&p.aprendizado&&p.aprendizado.minCiclos,12)));}catch(_){return 12;}})();
      return{eventos:z.events.length,decisoes:z.events.filter(e=>e.tipo==='decisao').length,atividades:z.events.filter(e=>e.tipo==='atividade_criada').length,resultados:latest.size,paresObservados:obs.length,paresComTempo:timed.length,horasExecutadas:round(horas,2),calibracao:{minimoAtual:minApr,amostraSuficiente:obs.length>=minApr,amostraTemporalSuficiente:timed.length>=minApr},porFase:this._breakdown(dataset,x=>x.fase),porPerfil:this._breakdown(dataset,x=>x.perfilAtaque),porIntervencao:this._breakdown(dataset,x=>x.features&&x.features.intervencao&&x.features.intervencao.tipo),periodo:{primeiro:z.events[0]&&z.events[0].ts||null,ultimo:z.events[z.events.length-1]&&z.events[z.events.length-1].ts||null}};
    },
    gerarPayload(){
      this.reconciliar();const z=this._load(),configAtual=this._configSnapshot(),dataset=this._dataset(z),diag=this.diagnostico();
      return{schema:this.SCHEMA,schemaVersion:this.VERSAO,geradoEm:iso(),meta:{produto:'StudyNoMentor',appVersion:this._appVersion(),motor:R.MOTOR||'robusto-v5',revisaoRobusto:R.REVISAO_AUDITORIA||R.VERSAO||null,anonProfileId:z.anonProfileId,privacidade:'local-only; sem envio automático; exportação explícita pelo usuário',usoPretendido:'auditoria observacional e calibração assistida; não interpretar correlação como causalidade'},configAtual,diagnostico:diag,calibrationDataset:dataset,configs:clone(z.configs),events:clone(z.events)};
    },
    exportar(){
      const payload=this.gerarPayload(),txt=JSON.stringify(payload,null,2),dia=(typeof todayLocal==='function'?todayLocal():new Date().toISOString().slice(0,10)),nome=`studynomentor-robusto-auditoria-${dia}.json`;
      try{const blob=new Blob([txt],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=nome;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-audit-export');throw e;}
      return{nome,bytes:txt.length,payload};
    },
    statsHtml(){const d=this.diagnostico(),pronto=d.calibracao.amostraSuficiente;return`<div class="pmc-audit-stats"><span><b>${d.decisoes}</b> decisões</span><span><b>${d.atividades}</b> atividades</span><span><b>${d.paresObservados}</b> resultados medidos</span><span><b>${d.horasExecutadas??0}</b> h registradas</span></div><small class="pmc-audit-readiness ${pronto?'is-ready':''}">${pronto?'Amostra mínima atual atingida para auditoria de calibração.':`Faltam ${Math.max(0,d.calibracao.minimoAtual-d.paresObservados)} resultado(s) medido(s) para o mínimo atual de aprendizado.`}</small>`;},
    instalar(){
      if(this._installed)return;this._installed=true;
      if(typeof C.robusto==='function'){
        this._origRobusto=C.robusto;const self=this;C.robusto=function(){const res=self._origRobusto.apply(this,arguments);try{self.registrarCalculo(res,{modoInterface:this.prefs?this.prefs().modo:null});}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-audit-calculo');}return res;};
      }
      if(typeof C.criar==='function'){
        this._origCriar=C.criar;const self=this;C.criar=function(){let antes=new Set();try{antes=new Set((DB.getExtras?DB.getExtras():[]).map(e=>String(e.id)));}catch(_){/* noop */}const ret=self._origCriar.apply(this,arguments);try{const novos=(DB.getExtras?DB.getExtras():[]).filter(e=>!antes.has(String(e.id)));novos.forEach(e=>self.registrarCriacao(e));self.reconciliar();}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-audit-criacao');}return ret;};
      }
      try{window.addEventListener('beforeunload',()=>{try{this.reconciliar();}catch(_){/* best effort */}});}catch(_){/* file:// tests */}
    }
  };

  A.instalar();
  window.PlanoRobustoAuditV1=A;
})();
