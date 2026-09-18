/* ============================================================================
   MOTOR ROBUSTO — TEC + EXTRAS
   Escolhe onde atacar, em que ordem e com qual dose, sem decidir o método.
   ============================================================================ */
(() => {
  if(typeof window==='undefined'||window.__planoSugRobusto)return;
  const I=window.PlanoSugestoesInfra;if(!I||typeof DB==='undefined')return;
  window.__planoSugRobusto=true;
  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,n(v,a)));
  const norm=I.norm||((s)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim());
  const esc=I.esc||((s)=>String(s??''));
  const codeDepth=c=>{const s=String(c==null?'':c).trim();return s?Math.max(0,s.split('.').filter(Boolean).length-1):0;};
  const dateKey=s=>String(s&&(s.endDate||s.date||s.startDate)||'');
  const itemKey=(d,t)=>norm(d)+'\u0001'+norm(t);

  function logGamma(z){const p=[676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-.13857109526572012,9.984369578019571e-6,1.5056327351493116e-7];if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);z-=1;let x=.9999999999998099;for(let i=0;i<p.length;i++)x+=p[i]/(z+i+1);const t=z+p.length-.5;return .5*Math.log(2*Math.PI)+(z+.5)*Math.log(t)-t+Math.log(x);}
  function betacf(a,b,x){const M=150,e=3e-10,f=1e-300;let q=a+b,ap=a+1,am=a-1,c=1,d=1-q*x/ap;if(Math.abs(d)<f)d=f;d=1/d;let h=d;for(let m=1;m<=M;m++){const m2=2*m;let aa=m*(b-m)*x/((am+m2)*(a+m2));d=1+aa*d;if(Math.abs(d)<f)d=f;c=1+aa/c;if(Math.abs(c)<f)c=f;d=1/d;h*=d*c;aa=-(a+m)*(q+m)*x/((a+m2)*(ap+m2));d=1+aa*d;if(Math.abs(d)<f)d=f;c=1+aa/c;if(Math.abs(c)<f)c=f;d=1/d;const z=d*c;h*=z;if(Math.abs(z-1)<e)break;}return h;}
  function betaI(x,a,b){x=clamp(x,0,1);if(x===0||x===1)return x;const bt=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log(1-x));return x<(a+1)/(a+b+2)?bt*betacf(a,b,x)/a:1-bt*betacf(b,a,1-x)/b;}
  function qbeta(p,a,b){let l=0,h=1;for(let i=0;i<42;i++){const m=(l+h)/2;if(betaI(m,a,b)<p)l=m;else h=m;}return(l+h)/2;}

    /* ── A FASE PASSA A SER CONFIGURÁVEL, COMO NO SIMPLIFICADO ────────────────
     `fase()` só derivava do tipo do planejamento ativo, sem nenhum controle na
     interface: a aba ⚙ Modelos mostrava "TEC · Pré-edital" como um selo de
     leitura, e não havia onde escolher. O Simplificado já tinha o campo
     (auto/pre/pos) e, com os dois motores lado a lado, a ausência no Robusto
     lia como "este não tem fase" em vez de "esta fase é derivada".

     `auto` mantém o comportamento antigo (segue o planejamento) e é o padrão,
     então nenhum perfil existente muda de fase por causa disto.

     `maxDisciplinas`/`topicosPorDisciplina` substituem os `3` e `1` que
     estavam escritos no corpo de `calcular`. O contrato de Extras (até 3
     disciplinas distintas, 1 tópico ativo por disciplina) era apresentado como
     limite do produto quando era uma constante no código — e o campo
     equivalente na folha do Plano (`plano-sug-disciplinas`) governa a rota
     manual, não este motor. Agora cada motor tem o seu, dentro da sua própria
     configuração, sem ler nada de `PlanoEngine`. */
  const DEFAULTS=Object.freeze({fase:'auto',meta:90,minAmostra:20,minObservacao:5,banca:'__todas__',forcaPrior:3,margemLacunaPP:3,doseMin:10,doseBase:15,doseMax:30,minCiclosDose:4,shrinkDose:8,ganhoMinPP100q:3,minQuestoesTempoExtras:30,maxDisciplinas:3,topicosPorDisciplina:1});
  const KEY='robusto-tec-v8',PREF_KEYS=Object.keys(DEFAULTS);

  const R={
    REVISAO_REGISTRO:8,MOTOR:'plano-robusto',KEY,DEFAULTS,PREF_KEYS,
    prefs(){
      let raw={};try{raw=JSON.parse(localStorage.getItem(DB._profilePrefix()+KEY)||'{}')||{};}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-prefs');}
      const p={...DEFAULTS};PREF_KEYS.forEach(k=>{if(Object.prototype.hasOwnProperty.call(raw,k))p[k]=raw[k];});
      p.meta=clamp(p.meta,60,99);p.minAmostra=Math.round(clamp(p.minAmostra,5,300));p.minObservacao=Math.round(clamp(p.minObservacao,1,p.minAmostra));p.forcaPrior=clamp(p.forcaPrior,.5,20);p.margemLacunaPP=clamp(p.margemLacunaPP,0,15);
      p.doseMin=Math.round(clamp(p.doseMin,5,60));p.doseMax=Math.round(clamp(p.doseMax,p.doseMin,100));p.doseBase=Math.round(clamp(p.doseBase,p.doseMin,p.doseMax));p.minCiclosDose=Math.round(clamp(p.minCiclosDose,2,20));p.shrinkDose=clamp(p.shrinkDose,1,40);p.ganhoMinPP100q=clamp(p.ganhoMinPP100q,0,20);p.minQuestoesTempoExtras=Math.round(clamp(p.minQuestoesTempoExtras,10,300));p.banca=typeof p.banca==='string'&&p.banca?p.banca:'__todas__';if(!['auto','pre','pos'].includes(p.fase))p.fase='auto';p.maxDisciplinas=Math.round(clamp(p.maxDisciplinas,1,8));p.topicosPorDisciplina=Math.round(clamp(p.topicosPorDisciplina,1,4));return p;
    },
    salvar(patch){const p={...this.prefs()};PREF_KEYS.forEach(k=>{if(patch&&Object.prototype.hasOwnProperty.call(patch,k))p[k]=patch[k];});try{const raw=JSON.stringify(p);if(DB.setRaw)DB.setRaw(DB._profilePrefix()+KEY,raw);else localStorage.setItem(DB._profilePrefix()+KEY,raw);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-save');}return this.prefs();},
    restaurar(){try{if(DB.delRaw)DB.delRaw(DB._profilePrefix()+KEY);else localStorage.removeItem(DB._profilePrefix()+KEY);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-reset');}return this.prefs();},
    faseAuto(){try{const p=typeof PlanManager!=='undefined'&&PlanManager.getActivePlan?PlanManager.getActivePlan():null;return /p[oó]s[- ]?edital/i.test(String(p&&p.tipo||''))?'pos':'pre';}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-fase');return'pre';}},
    fase(cfg){const f=(cfg||this.prefs()).fase;return f==='pre'||f==='pos'?f:this.faseAuto();},
    modoAtaque(){return this.fase();},

    posterior(taxa,q,meta,cfg,intervalo=true){
      cfg=cfg||this.prefs();const forca=Math.max(.1,n(cfg.forcaPrior,3)),qq=Math.max(0,n(q)),t=clamp(taxa,0,100),ac=qq*t/100,a=forca/2+ac,b=forca/2+Math.max(0,qq-ac),media=a/(a+b)*100,alvo=clamp(meta/100,.001,.999),delta=Math.max(0,n(cfg.margemLacunaPP,3)),corte=clamp((meta-delta)/100,.001,.999);
      const out={a,b,n:qq,ac,media,pMeta:1-betaI(alvo,a,b),pLacuna:betaI(corte,a,b),lo:null,hi:null,forcaPrior:forca,deltaLacunaPP:delta};
      if(intervalo!==false){out.lo=qbeta(.025,a,b)*100;out.hi=qbeta(.975,a,b)*100;}return out;
    },
    _snapshotSeries(snapshot){
      if(Array.isArray(snapshot&&snapshot._fontes)&&snapshot._fontes.length)return snapshot._fontes.slice().sort((a,b)=>dateKey(a).localeCompare(dateKey(b)));
      let snaps=[];try{snaps=DB.getTecSnapshots?DB.getTecSnapshots()||[]:[];}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-snapshots');}
      try{const D=window.DesempenhoTecScreen||((typeof DesempenhoTecScreen!=='undefined')?DesempenhoTecScreen:null);if(D&&D.selectedSnapIds&&D.selectedSnapIds.size){const ids=D.selectedSnapIds,z=snaps.filter(s=>ids.has(s.id));if(z.length)snaps=z;}}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-scope-series');}
      return snaps.slice(-12).sort((a,b)=>dateKey(a).localeCompare(dateKey(b)));
    },
    _tecDisciplinas(snapshot){return [...new Set(I.linhasTec(snapshot||I.snapshot()).map(r=>String(r.disciplina||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));},
    _postConfig(){try{const p=PlanManager.getActivePlan();return p&&p.robustoTecPost&&typeof p.robustoTecPost==='object'?p.robustoTecPost:{configurado:false,disciplinas:{}};}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-post-read');return{configurado:false,disciplinas:{}};}},
    salvarPostConfig(patch){try{const p=PlanManager.getActivePlan();if(!p)return null;const atual=this._postConfig(),next={...atual,...patch,disciplinas:{...(atual.disciplinas||{}),...((patch&&patch.disciplinas)||{})}};PlanManager.updatePlan(p.id,{robustoTecPost:next});return next;}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-post-save');return null;}},

    _fronteira(snapshot,p){
      const bloqueadas=I.disciplinasBloqueadas(),all=[],seen=new Set();
      for(const r of I.linhasTec(snapshot)){
        const disciplina=String(r.disciplina||'').trim(),nome=String(r.nome||'').trim(),d=norm(disciplina),k=itemKey(disciplina,nome),q=I.q(r),taxa=I.taxa(r);
        if(!d||seen.has(k)||bloqueadas.has(d)||taxa==null||q<p.minObservacao||taxa>=p.meta)continue;
        seen.add(k);all.push({item:r,disciplina,nome,qJanela:q,taxa,codigo:String(r.codigo||''),depth:n(r.depth,codeDepth(r.codigo)),_discKey:d,_key:k});
      }
      const pais=new Set();for(const x of all){const a=String(x.codigo||'').split('.').filter(Boolean);while(a.length>1){a.pop();pais.add(x._discKey+'\u0001'+a.join('.'));}}
      return all.filter(x=>!pais.has(x._discKey+'\u0001'+x.codigo));
    },
    _historicoIndex(snapshot,pool,p){
      const wanted=new Set(pool.map(c=>c._key||itemKey(c.disciplina,c.nome))),idx=new Map();for(const k of wanted)idx.set(k,[]);
      const min=Math.max(3,Math.floor(p.minObservacao));for(const s of this._snapshotSeries(snapshot)){const data=dateKey(s);for(const r of I.linhasTec(s||{})){const k=itemKey(r.disciplina,r.nome);if(!idx.has(k))continue;const q=I.q(r),taxa=I.taxa(r);if(q>=min&&taxa!=null)idx.get(k).push({data,q,taxa});}}
      return idx;
    },
    _historicoTec(c,snapshot,p,index){
      let pts;if(index)pts=index.get(c._key||itemKey(c.disciplina,c.nome))||[];else{pts=[];for(const s of this._snapshotSeries(snapshot)){let row=null;for(const r of I.linhasTec(s||{})){if(itemKey(r.disciplina,r.nome)===(c._key||itemKey(c.disciplina,c.nome))){row=r;break;}}if(!row)continue;const q=I.q(row),taxa=I.taxa(row);if(q>=Math.max(3,Math.floor(p.minObservacao))&&taxa!=null)pts.push({data:dateKey(s),q,taxa});}}
      const abaixo=pts.filter(x=>x.taxa<p.meta).length,persist=pts.length?abaixo/pts.length:.5;let trend=.5,delta=0;if(pts.length>=2){delta=pts[0].taxa-pts[pts.length-1].taxa;trend=clamp(.5+delta/30,0,1);}return{n:pts.length,persistencia:persist,tendenciaRisco:trend,deltaPP:delta,pontos:pts};
    },
    _incRows(p){let rows=[];try{rows=I.incidencia?I.incidencia()||[]:[];}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-incidencia');}const b=norm(p.banca);return rows.filter(r=>p.banca==='__todas__'||!p.banca||norm(r&&r.banca)===b);},
    _incIndex(rows){const m=new Map();for(const r of rows||[]){const k=itemKey(r&&r.disciplina,r&&r.topico),v=Math.max(0,n(r&&r.incidencia));m.set(k,(m.get(k)||0)+v);}return m;},
    _incidencia(c,rows,index){if(index){const valor=index.get(c._key||itemKey(c.disciplina,c.nome))||0;return valor>0?{valor,confianca:1,via:'disciplina-topico-exato'}:{valor:0,confianca:0,via:'ausente'};}const d=norm(c.disciplina),t=norm(c.nome),ex=(rows||[]).filter(r=>norm(r&&r.disciplina)===d&&norm(r&&r.topico)===t);if(!ex.length)return{valor:0,confianca:0,via:'ausente'};return{valor:ex.reduce((s,r)=>s+Math.max(0,n(r&&r.incidencia)),0),confianca:1,via:'disciplina-topico-exato'};},
    _componentes(pool,snapshot,p,extraObs){
      const incRows=this._incRows(p),incIndex=this._incIndex(incRows),histIndex=this._historicoIndex(snapshot,pool,p),RX=window.ReforcoTecExtras,rxCfg={minCiclosDose:p.minCiclosDose,ganhoMinPP100q:p.ganhoMinPP100q,_observacoes:extraObs};
      for(const c of pool){
        const post=this.posterior(c.taxa,c.qJanela,p.meta,p,false),histTec=this._historicoTec(c,snapshot,p,histIndex),inc=this._incidencia(c,incRows,incIndex),histExtra=RX?RX.historico(c.disciplina,c.nome,rxCfg):{n:0,nEfetivo:0};
        c.posterior=post;c.histTec=histTec;c.incidencia=inc;c.histExtra=histExtra;c._gap=clamp((p.meta-post.media)/30,0,1);c._evid=clamp(post.pLacuna,0,1);c._persist=clamp(histTec.persistencia,0,1);c._trend=clamp(histTec.tendenciaRisco,0,1);
        const g=Number(histExtra&&histExtra.ganhoPP100qMediano),nEff=n(histExtra&&histExtra.nEfetivo);c._resist=Number.isFinite(g)&&nEff>=Math.max(2,p.minCiclosDose/2)?clamp((p.ganhoMinPP100q-g+3)/6,0,1):null;
      }
      const maxInc=Math.max(0,...pool.map(c=>c.incidencia.valor));
      for(const c of pool){
        c._inc=maxInc>0&&c.incidencia.valor>0?clamp(Math.log1p(c.incidencia.valor)/Math.log1p(maxInc),0,1):null;
        const confiancaAmostra=clamp(c.qJanela/Math.max(1,p.minAmostra),0,1),raw={lacuna:c._gap,evidencia:c._evid,persistencia:c._persist,tendencia:c._trend,incidencia:c._inc,resistencia:c._resist},base={lacuna:.30,evidencia:.23,persistencia:.17,tendencia:.08,incidencia:.17,resistencia:.05};let den=0,num=0;for(const k of Object.keys(base)){if(raw[k]==null)continue;den+=base[k];num+=base[k]*raw[k];}const puro=den?num/den*100:0,ajusteAmostra=.68+.32*confiancaAmostra;c.componentes={...raw,confiancaAmostra,scoreTopico:puro*ajusteAmostra};c.scoreTopico=puro*ajusteAmostra;
      }
      return pool;
    },
    _disciplinas(pool,fase){
      const map=new Map();for(const c of pool){const k=c._discKey||norm(c.disciplina);if(!map.has(k))map.set(k,{disciplina:c.disciplina,topicos:[]});map.get(k).topicos.push(c);}const post=this._postConfig(),cfg=post.disciplinas||{},active=[];
      for(const g of map.values()){g.topicos.sort((a,b)=>b.scoreTopico-a.scoreTopico||a.taxa-b.taxa);if(fase==='pos'){const pc=cfg[norm(g.disciplina)];if(!pc||pc.ativo!==true)continue;g.peso=Math.max(.1,n(pc.peso,1));}else g.peso=1;const w=[.60,.25,.15],top=g.topicos.slice(0,3);let den=0,base=0;top.forEach((x,i)=>{den+=w[i];base+=w[i]*x.scoreTopico;});g.scoreBase=den?base/den:0;active.push(g);}
      if(fase==='pos'){const mx=Math.max(1,...active.map(x=>x.peso));active.forEach(g=>{g.pesoNorm=g.peso/mx;g.scoreDisciplina=.72*g.scoreBase+.28*g.pesoNorm*100;});}else active.forEach(g=>{g.pesoNorm=1;g.scoreDisciplina=g.scoreBase;});return active.sort((a,b)=>b.scoreDisciplina-a.scoreDisciplina||b.topicos.length-a.topicos.length);
    },
    calcular(){
      const p=this.prefs(),fase=this.fase(p),snapshot=I.snapshot();if(!snapshot)return{erro:'sem-retrato',modo:'robusto',fase,itens:[]};let pool=this._fronteira(snapshot,p);if(!pool.length)return{erro:'sem-lacunas',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};
      if(fase==='pos'){const pc=this._postConfig(),sel=Object.values(pc.disciplinas||{}).filter(x=>x&&x.ativo===true);if(!pc.configurado||!sel.length)return{erro:'post-pesos-pendentes',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};}
      const RX=window.ReforcoTecExtras,extraObs=RX&&RX.observacoes?RX.observacoes():[];pool=this._componentes(pool,snapshot,p,extraObs);const grupos=this._disciplinas(pool,fase);if(!grupos.length)return{erro:'sem-candidatos',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};
      const itens=[],rxCfg={...p,_observacoes:extraObs};for(const g of grupos.slice(0,Math.max(1,p.maxDisciplinas))){
        const top=g.topicos[0];top.posterior=this.posterior(top.taxa,top.qJanela,p.meta,p,true);const rx=RX?RX.prescrever({...top,minAmostra:p.minAmostra,meta:p.meta,componentes:{lacuna:top._gap,evidencia:top._evid,persistencia:top._persist}},rxCfg):{dose:p.doseBase,fonte:'tec',tempo:{confiavel:false,fonte:'indisponivel',minutosEstimados:null}},dose=Math.max(1,Math.round(n(rx.dose,p.doseBase))),tempo=rx.tempo||{confiavel:false,fonte:'indisponivel',minutosEstimados:null};
        itens.push({...top,modo:'robusto',fase,score:g.scoreDisciplina,scoreDisciplina:g.scoreDisciplina,scoreTopico:top.scoreTopico,alvo:dose,quantidadeRecomendada:dose,meta:p.meta,minAmostra:p.minAmostra,banca:p.banca,pesoPost:fase==='pos'?g.peso:1,prescricao:rx,topicosOrdenados:g.topicos.slice(0,8).map((x,i)=>({rank:i+1,nome:x.nome,taxa:x.taxa,qJanela:x.qJanela,score:x.scoreTopico,incidencia:x.incidencia.valor,persistencia:x.histTec.persistencia,evidencia:x.posterior.pLacuna})),motivo:`Disciplina #${itens.length+1}: prioridade ${g.scoreDisciplina.toFixed(0)}/100 · tópico líder ${top.scoreTopico.toFixed(0)}/100${fase==='pos'?` · peso manual ${g.peso}`:''}.`,auditoria:{revisaoAuditoria:8,fonteCanonica:'TEC',pesoDisciplina:fase==='pre'?1:g.peso,tempoSomenteExtras:true,metodoEstudoForaDoModelo:true,resultadoExtrasObservacional:true}});
      }
      return{modo:'robusto',motor:this.MOTOR,fase,banca:p.banca,itens,todos:pool,disciplinas:grupos.map(g=>({disciplina:g.disciplina,score:g.scoreDisciplina,peso:g.peso,topicos:g.topicos.slice(0,12).map(x=>({nome:x.nome,score:x.scoreTopico,taxa:x.taxa,qJanela:x.qJanela,incidencia:x.incidencia.valor,persistencia:x.histTec.persistencia}))})),configRobusto:{versao:8,prefs:p},arquitetura:this.arquitetura(),explicacao:fase==='pre'?'Pré-edital: todas as disciplinas têm peso 1. O ranking usa TEC, incidência e resposta observacional dos reforços em Extras.':'Pós-edital: identidade e pesos vêm das disciplinas padronizadas do TEC, configuradas manualmente neste planejamento.'};
    },
    arquitetura(){return{motor:'Robusto',revisaoAuditoria:8,independente:true,independenteSimplificado:true,fontes:['TEC escopado','Incidência importada da banca','Reforços registrados em Extras'],naoUsa:['peso/nome do ciclo regular','tempo do ciclo regular','método de estudo','PlanoEngine para prioridade','roteador pedagógico','otimizador legado','Mentor90'],preEdital:'todas as disciplinas peso 1',posEdital:'disciplinas TEC selecionadas manualmente + peso manual',saida:['3 disciplinas','ranking de tópicos por disciplina','dose de questões','tempo somente quando medido nos reforços Extras']};},
    config(){const p=this.prefs(),f=this.fase(p);return{versao:8,prefs:p,resumo:{rotulo:(f==='pre'?'TEC · Pré-edital':'TEC · Pós-edital')+(p.fase==='auto'?' (automática)':' (fixada)')}};},
    _bancasHtml(atual){let bs=[];try{bs=I.bancas?I.bancas():[];}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-bancas');}return `<option value="__todas__" ${atual==='__todas__'?'selected':''}>Todas as bancas importadas</option>`+bs.map(b=>`<option value="${esc(b)}" ${b===atual?'selected':''}>${esc(b)}</option>`).join('');},
    painelConfigHtml(){
      const p=this.prefs(),fase=this.fase(p),snap=I.snapshot(),discs=this._tecDisciplinas(snap),post=this._postConfig(),cfg=post.disciplinas||{};
      const rows=fase==='pos'?`<section class="rv8-post"><header><div><b>Disciplinas da prova · Pós-edital</b><small>Escolha somente nomes padronizados vindos do TEC. O ciclo regular não participa deste cruzamento.</small></div></header>${discs.length?`<div class="rv8-post-list">${discs.map(d=>{const k=norm(d),x=cfg[k]||{};return`<label class="rv8-post-row"><input type="checkbox" data-rv8-post-active="${esc(k)}" ${x.ativo===true?'checked':''}><span>${esc(d)}</span><input type="number" min="0.1" max="20" step="0.1" value="${n(x.peso,1)}" data-rv8-post-weight="${esc(k)}" data-rv8-post-name="${esc(d)}"><small>peso</small></label>`;}).join('')}</div><button type="button" class="btn-primary" data-rv8-post-save>Salvar disciplinas e pesos</button>`:'<div class="pmc-empty"><b>Importe o TEC primeiro</b><span>Os pesos só podem ser vinculados depois que existirem nomes canônicos de disciplinas no TEC.</span></div>'}</section>`:`<section class="rv8-pre-note"><b>Pré-edital: peso 1 para todas as disciplinas.</b><span>Nenhum peso do ciclo regular é lido. O que diferencia prioridades é lacuna, evidência, persistência, tendência e incidência da banca.</span></section>`;
      return`<div class="rv8-panel" data-rv8-panel><div class="rv8-method-note"><b>Robusto · foco estatístico.</b><span>Escolhe até ${p.maxDisciplinas} disciplina(s), ordena seus tópicos e calcula a dose de questões. Seu método de resolução fica fora do algoritmo.</span></div><div class="pmc-grupo"><h5>1 · Recorte da prova</h5><p>Em que fase o motor raciocina e quantas frentes ele abre de uma vez.</p><div class="pmc-simple-grid"><label><span>Fase</span><select data-rv8="fase"><option value="auto" ${p.fase==='auto'?'selected':''}>Automática — segue o planejamento ativo</option><option value="pre" ${p.fase==='pre'?'selected':''}>Pré-edital</option><option value="pos" ${p.fase==='pos'?'selected':''}>Pós-edital</option></select><small>Hoje valendo: <b>${fase==='pre'?'Pré-edital':'Pós-edital'}</b>${p.fase==='auto'?' (derivada do planejamento)':' (fixada por você)'}. Pré dá peso 1 a todas as disciplinas; Pós usa os pesos manuais abaixo.</small></label><label><span>Disciplinas por vez</span><input data-rv8="maxDisciplinas" type="number" min="1" max="8" value="${p.maxDisciplinas}"><small>Quantas frentes distintas a força-tarefa abre. Era fixo em 3.</small></label></div></div><div class="pmc-grupo"><h5>2 · Régua e confiança</h5><p>O que conta como lacuna e quanta amostra o motor exige para acreditar nela.</p><div class="pmc-simple-grid"><label><span>Meta de domínio</span><div class="pmc-suffix"><input data-rv8="meta" type="number" min="60" max="99" value="${p.meta}"><em>%</em></div><small>Régua comum do TEC.</small></label><label><span>Amostra mínima confiável</span><input data-rv8="minAmostra" type="number" min="5" max="300" value="${p.minAmostra}"><small>Acima daqui a medição recebe confiança plena.</small></label><label><span>Mínimo para observar</span><input data-rv8="minObservacao" type="number" min="1" max="${p.minAmostra}" value="${p.minObservacao}"><small>Abaixo disso o tópico ainda é cedo demais até para disputar.</small></label><label><span>Incidência</span><select data-rv8="banca">${this._bancasHtml(p.banca)}</select><small>Fonte objetiva de relevância.</small></label><label><span>Força do prior</span><input data-rv8="forcaPrior" type="number" min="0.5" max="20" step="0.5" value="${p.forcaPrior}"><small>Regularização Beta real para amostras pequenas.</small></label><label><span>Margem da lacuna</span><div class="pmc-suffix"><input data-rv8="margemLacunaPP" type="number" min="0" max="15" step="0.5" value="${p.margemLacunaPP}"><em>pp</em></div><small>Folga abaixo da meta antes de chamar de lacuna.</small></label></div></div><div class="pmc-grupo"><h5>3 · Dose de questões</h5><p>O tamanho do bloco que o motor recomenda para cada frente.</p><div class="pmc-simple-grid"><label><span>Dose base</span><input data-rv8="doseBase" type="number" min="5" max="100" value="${p.doseBase}"><small>Recalibrada conservadoramente por TEC + Extras.</small></label><label><span>Dose mínima</span><input data-rv8="doseMin" type="number" min="5" max="60" value="${p.doseMin}"></label><label><span>Dose máxima</span><input data-rv8="doseMax" type="number" min="5" max="100" value="${p.doseMax}"></label></div></div>${rows}<footer class="rv8-footer"><span>Fontes: TEC + incidência + reforços em Extras.</span><b>Sem dependência de nomes/pesos/tempo do ciclo regular.</b><button type="button" data-rv8-reset>↺ Restaurar padrões</button></footer></div>`;
    },
    bindConfig(host,onChange){if(!host)return;host.querySelectorAll('[data-rv8]').forEach(el=>el.addEventListener('change',()=>{this.salvar({[el.dataset.rv8]:el.type==='number'?Number(el.value):el.value});if(onChange)onChange();}));const reset=host.querySelector('[data-rv8-reset]');if(reset)reset.addEventListener('click',()=>{this.restaurar();if(onChange)onChange();});const save=host.querySelector('[data-rv8-post-save]');if(save)save.addEventListener('click',()=>{const ds={};host.querySelectorAll('[data-rv8-post-active]').forEach(cb=>{const k=cb.dataset.rv8PostActive,w=host.querySelector(`[data-rv8-post-weight="${CSS.escape(k)}"]`),nome=w&&w.dataset.rv8PostName||k;ds[k]={nome,ativo:cb.checked,peso:Math.max(.1,n(w&&w.value,1))};});this.salvarPostConfig({configurado:true,disciplinas:ds,atualizadoEm:new Date().toISOString()});if(typeof showToast==='function')showToast('Pesos Pós-edital vinculados às disciplinas do TEC ✓');if(onChange)onChange();});}
  };
  window.PlanoSugestoesRobusto=R;
})();