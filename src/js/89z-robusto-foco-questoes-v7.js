/* ============================================================================
   ROBUSTO V8 — MOTOR TEC + EXTRAS
   ----------------------------------------------------------------------------
   Fontes confiáveis da decisão:
     • TEC escopado: desempenho, amostra, persistência e evolução;
     • incidência importada da banca: relevância objetiva do conteúdo;
     • reforços em Extras: dose executada e resposta posterior observada.

   O motor NÃO usa nomes/pesos do ciclo regular, NÃO escolhe método pedagógico
   e NÃO usa tempo do estudo regular. Em Pós-edital, pesos são atribuídos
   manualmente às disciplinas CANÔNICAS do TEC no próprio planejamento.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__robustoTecExtrasV8) return;
  const R = window.PlanoSugestoesRobustoV6 || window.PlanoSugestoesRobustoV5 || window.PlanoSugestoesRobustoV4;
  const I = window.PlanoSugestoesInfraV2;
  if (!R || !I || typeof DB === 'undefined') return;
  window.__robustoTecExtrasV8 = true;

  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,n(v,a)));
  const norm=I.norm||((s)=>String(s||'').toLowerCase().trim());
  const esc=I.esc||((s)=>String(s??''));
  const codeDepth=c=>{const s=String(c==null?'':c).trim();return s?Math.max(0,s.split('.').filter(Boolean).length-1):0;};
  const isDesc=(pai,filho)=>{const a=String(pai||'').trim(),b=String(filho||'').trim();return !!(a&&b&&a!==b&&b.startsWith(a+'.'));};
  const dateKey=s=>String(s&& (s.endDate||s.date||s.startDate)||'');

  const DEFAULTS=Object.freeze({
    meta:90,minAmostra:20,banca:'__todas__',forcaPrior:3,margemLacunaPP:3,
    doseMin:10,doseBase:15,doseMax:30,minCiclosDose:4,shrinkDose:8,ganhoMinPP100q:3,minQuestoesTempoExtras:30
  });
  const KEY='robusto-tec-v8';
  const PREF_KEYS=Object.keys(DEFAULTS);

  R.VERSAO=8;
  R.REVISAO_AUDITORIA=8;
  R.MOTOR='robusto-v8';
  R.KEY_V8=KEY;
  R.DEFAULTS_V8=DEFAULTS;

  R.prefs=function(){
    let raw={};try{raw=JSON.parse(localStorage.getItem(DB._profilePrefix()+KEY)||'{}')||{};}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v8-prefs');}
    const p={...DEFAULTS};PREF_KEYS.forEach(k=>{if(Object.prototype.hasOwnProperty.call(raw,k))p[k]=raw[k];});
    p.meta=clamp(p.meta,60,99);p.minAmostra=Math.round(clamp(p.minAmostra,5,300));p.forcaPrior=clamp(p.forcaPrior,.5,20);p.margemLacunaPP=clamp(p.margemLacunaPP,0,15);
    p.doseMin=Math.round(clamp(p.doseMin,5,60));p.doseMax=Math.round(clamp(p.doseMax,p.doseMin,100));p.doseBase=Math.round(clamp(p.doseBase,p.doseMin,p.doseMax));p.minCiclosDose=Math.round(clamp(p.minCiclosDose,2,20));p.shrinkDose=clamp(p.shrinkDose,1,40);p.ganhoMinPP100q=clamp(p.ganhoMinPP100q,0,20);p.minQuestoesTempoExtras=Math.round(clamp(p.minQuestoesTempoExtras,10,300));
    p.banca=typeof p.banca==='string'&&p.banca?p.banca:'__todas__';return p;
  };
  R.salvarPrefs=function(patch){const p={...this.prefs()};PREF_KEYS.forEach(k=>{if(patch&&Object.prototype.hasOwnProperty.call(patch,k))p[k]=patch[k];});try{const raw=JSON.stringify(p);if(DB.setRaw)DB.setRaw(DB._profilePrefix()+KEY,raw);else localStorage.setItem(DB._profilePrefix()+KEY,raw);}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v8-save');}return this.prefs();};
  R.restaurarPrefs=function(){try{if(DB.delRaw)DB.delRaw(DB._profilePrefix()+KEY);else localStorage.removeItem(DB._profilePrefix()+KEY);}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v8-reset');}return this.prefs();};
  R.fase=function(){try{const p=typeof PlanManager!=='undefined'&&PlanManager.getActivePlan?PlanManager.getActivePlan():null;return /p[oó]s[- ]?edital/i.test(String(p&&p.tipo||''))?'pos':'pre';}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v8-fase');return'pre';}};
  R.modoAtaque=function(){return this.fase();};
  R._tecDisciplinas=function(snapshot){return [...new Set(I.linhasTec(snapshot||I.snapshot()).map(r=>String(r.disciplina||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));};
  R._postConfig=function(){try{const p=PlanManager.getActivePlan();return p&&p.robustoTecPost&&typeof p.robustoTecPost==='object'?p.robustoTecPost:{configurado:false,disciplinas:{}};}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v8-post-read');return{configurado:false,disciplinas:{}};}};
  R._salvarPostConfig=function(patch){try{const p=PlanManager.getActivePlan();if(!p)return null;const atual=this._postConfig(),next={...atual,...patch,disciplinas:{...(atual.disciplinas||{}),...((patch&&patch.disciplinas)||{})}};PlanManager.updatePlan(p.id,{robustoTecPost:next});return next;}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v8-post-save');return null;}};
  R._fronteira=function(snapshot,p){
    const bloqueadas=I.disciplinasBloqueadas(),all=[],seen=new Set();
    for(const r of I.linhasTec(snapshot)){
      const disciplina=String(r.disciplina||'').trim(),nome=String(r.nome||'').trim(),d=norm(disciplina),k=d+'\u0001'+norm(nome),q=I.q(r),taxa=I.taxa(r);if(!d||seen.has(k)||bloqueadas.has(d)||taxa==null||q<p.minAmostra||taxa>=p.meta)continue;seen.add(k);all.push({item:r,disciplina,nome,qJanela:q,taxa,codigo:String(r.codigo||''),depth:n(r.depth,codeDepth(r.codigo))});
    }
    return all.filter((x,i)=>!all.some((y,j)=>i!==j&&norm(y.disciplina)===norm(x.disciplina)&&isDesc(x.codigo,y.codigo)));
  };
  R._historicoTec=function(c,snapshot,p){
    const fontes=Array.isArray(snapshot&&snapshot._fontes)&&snapshot._fontes.length?snapshot._fontes:[snapshot],pts=[];
    for(const s of fontes){let row=null;for(const r of I.linhasTec(s||{})){if(norm(r.disciplina)===norm(c.disciplina)&&norm(r.nome)===norm(c.nome)){row=r;break;}}if(!row)continue;const q=I.q(row),taxa=I.taxa(row);if(q>=Math.max(5,Math.floor(p.minAmostra/2))&&taxa!=null)pts.push({data:dateKey(s),q,taxa});}
    pts.sort((a,b)=>String(a.data).localeCompare(String(b.data)));const abaixo=pts.filter(x=>x.taxa<p.meta).length,persist=pts.length?abaixo/pts.length:.5;let trend=.5,delta=0;if(pts.length>=2){delta=pts[0].taxa-pts[pts.length-1].taxa;trend=clamp(.5+delta/30,0,1);}return{n:pts.length,persistencia:persist,tendenciaRisco:trend,deltaPP:delta,pontos:pts};
  };
  R._incidencia=function(c,banca,map){
    if(typeof ReforcoEngine==='undefined'||!ReforcoEngine.incidenciaDe)return{valor:0,confianca:0,via:'indisponivel'};const z=ReforcoEngine.incidenciaDe(map,c.nome,c.disciplina);return{valor:Math.max(0,n(z&&z.valor)),confianca:z&&z.ausente?0:(z&&z.viaNome?.72:1),via:z&&z.viaNome?'nome':'disciplina-topico'};
  };
  R._componentes=function(pool,snapshot,p){
    let mapa=null;try{mapa=typeof ReforcoEngine!=='undefined'&&ReforcoEngine.incidenceMap?ReforcoEngine.incidenceMap(p.banca):null;}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v8-incid-map');}
    for(const c of pool){const post=this._posterior(c.taxa,c.qJanela,p.meta,{dominio:{forcaPrior:p.forcaPrior,margemLacunaPP:p.margemLacunaPP}}),histTec=this._historicoTec(c,snapshot,p),inc=this._incidencia(c,p.banca,mapa),histExtra=window.ReforcoTecExtrasV5?ReforcoTecExtrasV5.historico(c.disciplina,c.nome,{minCiclosDose:p.minCiclosDose,ganhoMinPP100q:p.ganhoMinPP100q}):{n:0};c.posterior=post;c.histTec=histTec;c.incidencia=inc;c.histExtra=histExtra;c._gap=clamp((p.meta-post.media)/30,0,1);c._evid=clamp(post.pLacuna,0,1);c._persist=clamp(histTec.persistencia,0,1);c._trend=clamp(histTec.tendenciaRisco,0,1);const g=Number(histExtra&&histExtra.ganhoPP100qMediano);c._resist=Number.isFinite(g)&&histExtra.n>=p.minCiclosDose?clamp((p.ganhoMinPP100q-g+3)/6,0,1):null;}
    const maxInc=Math.max(0,...pool.map(c=>c.incidencia.valor));
    for(const c of pool){c._inc=maxInc>0?clamp(Math.log1p(c.incidencia.valor)/Math.log1p(maxInc)*c.incidencia.confianca,0,1):null;const raw={lacuna:c._gap,evidencia:c._evid,persistencia:c._persist,tendencia:c._trend,incidencia:c._inc,resistencia:c._resist},base={lacuna:.28,evidencia:.20,persistencia:.18,tendencia:.08,incidencia:.16,resistencia:.10};let den=0,num=0;for(const k of Object.keys(base)){if(raw[k]==null)continue;den+=base[k];num+=base[k]*raw[k];}c.componentes={...raw,scoreTopico:den?num/den*100:0};c.scoreTopico=den?num/den*100:0;}
    return pool;
  };
  R._disciplinas=function(pool,fase){
    const map=new Map();for(const c of pool){const k=norm(c.disciplina);if(!map.has(k))map.set(k,{disciplina:c.disciplina,topicos:[]});map.get(k).topicos.push(c);}const post=this._postConfig(),cfg=post.disciplinas||{},active=[];for(const g of map.values()){g.topicos.sort((a,b)=>b.scoreTopico-a.scoreTopico||a.taxa-b.taxa);if(fase==='post'){const pc=cfg[norm(g.disciplina)];if(!pc||pc.ativo!==true)continue;g.peso=Math.max(.1,n(pc.peso,1));}else g.peso=1;const w=[.60,.25,.15],top=g.topicos.slice(0,3);let den=0,base=0;top.forEach((x,i)=>{den+=w[i];base+=w[i]*x.scoreTopico;});g.scoreBase=den?base/den:0;active.push(g);}if(fase==='post'){const mx=Math.max(1,...active.map(x=>x.peso));active.forEach(g=>{g.pesoNorm=g.peso/mx;g.scoreDisciplina=.70*g.scoreBase+.30*g.pesoNorm*100;});}else active.forEach(g=>{g.pesoNorm=1;g.scoreDisciplina=g.scoreBase;});return active.sort((a,b)=>b.scoreDisciplina-a.scoreDisciplina||b.topicos.length-a.topicos.length);
  };
  R.calcular=function(){
    const p=this.prefs(),fase=this.fase(),snapshot=I.snapshot();if(!snapshot)return{erro:'sem-retrato',modo:'robusto',fase,itens:[]};let pool=this._fronteira(snapshot,p);if(!pool.length)return{erro:'sem-lacunas',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};
    if(fase==='post'){const pc=this._postConfig(),sel=Object.values(pc.disciplinas||{}).filter(x=>x&&x.ativo===true);if(!pc.configurado||!sel.length)return{erro:'post-pesos-pendentes',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};}
    pool=this._componentes(pool,snapshot,p);const grupos=this._disciplinas(pool,fase);if(!grupos.length)return{erro:'sem-candidatos',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};const itens=[];
    for(const g of grupos.slice(0,3)){const top=g.topicos[0],rx=window.ReforcoTecExtrasV5?ReforcoTecExtrasV5.prescrever({...top,minAmostra:p.minAmostra,meta:p.meta,componentes:{lacuna:top._gap,evidencia:top._evid,persistencia:top._persist}},p):{dose:p.doseBase,fonte:'tec'};const dose=Math.max(1,Math.round(n(rx.dose,p.doseBase))),tempo=rx.tempo||{confiavel:false,fonte:'indisponivel',minutosEstimados:null};const c={...top,modo:'robusto',fase,score:g.scoreDisciplina,scoreDisciplina:g.scoreDisciplina,scoreTopico:top.scoreTopico,alvo:dose,doseDiaria:dose,meta:p.meta,minAmostra:p.minAmostra,banca:p.banca,pesoPost:fase==='post'?g.peso:1,prescricao:rx,topicosOrdenados:g.topicos.slice(0,5).map((x,i)=>({rank:i+1,nome:x.nome,taxa:x.taxa,qJanela:x.qJanela,score:x.scoreTopico,incidencia:x.incidencia.valor,persistencia:x.histTec.persistencia})),intervencao:{tipo:'questoes_aprofundadas',rotulo:'Questões aprofundadas',quantidadeQuestoes:dose,minutosEstimados:tempo.minutosEstimados,tempoFonte:tempo.fonte,tempoConfiavel:tempo.confiavel,passos:[{tipo:'questoes',quantidade:dose}],motivo:'Dose calculada por estado estatístico do TEC e resposta observada dos reforços em Extras.'},motivo:`Disciplina #${itens.length+1}: prioridade ${g.scoreDisciplina.toFixed(0)}/100 · tópico líder ${top.scoreTopico.toFixed(0)}/100${fase==='post'?` · peso manual ${g.peso}`:''}.`,configRobusto:{versao:8,fonte:'TEC+incidencia+Extras',fase,prefs:p},auditoria:{revisaoAuditoria:8,fonteCanonica:'TEC',pesoDisciplina:fase==='pre'?1:g.peso,tempoSomenteExtras:true,metodoEstudoForaDoModelo:true}};itens.push(c);}
    return{modo:'robusto',motor:this.MOTOR,fase,banca:p.banca,itens,todos:pool,disciplinas:grupos.map(g=>({disciplina:g.disciplina,score:g.scoreDisciplina,peso:g.peso,topicos:g.topicos.slice(0,8).map(x=>({nome:x.nome,score:x.scoreTopico,taxa:x.taxa,qJanela:x.qJanela}))})),configRobusto:{versao:8,prefs:p},arquitetura:this.arquitetura(),explicacao:fase==='pre'?'Pré-edital: todas as disciplinas têm peso 1. O ranking usa apenas TEC, incidência da banca e resposta real dos reforços.':'Pós-edital: identidade e pesos vêm das disciplinas padronizadas do TEC, configuradas manualmente neste planejamento.'};
  };
  R.arquitetura=function(){return{motor:'Robusto V8',revisaoAuditoria:8,independenteSimplificado:true,fontes:['TEC escopado','Incidência importada da banca','Reforços registrados em Extras'],naoUsa:['peso/nome do ciclo regular','tempo do ciclo regular','método de estudo','PlanoEngine para prioridade'],preEdital:'todas as disciplinas peso 1',posEdital:'disciplinas TEC selecionadas manualmente + peso manual',saida:['3 disciplinas','ranking de tópicos por disciplina','dose de questões','tempo somente quando medido em reforços Extras']};};
  R.config=function(){const p=this.prefs(),f=this.fase();return{versao:8,prefs:p,resumo:{rotulo:f==='pre'?'TEC · Pré-edital':'TEC · Pós-edital'}};};
  R._bancasHtml=function(atual){let bs=[];try{bs=I.bancas?I.bancas():[];}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v8-bancas');}return `<option value="__todas__" ${atual==='__todas__'?'selected':''}>Todas as bancas importadas</option>`+bs.map(b=>`<option value="${esc(b)}" ${b===atual?'selected':''}>${esc(b)}</option>`).join('');};
  R.painelConfigHtml=function(){const p=this.prefs(),fase=this.fase(),snap=I.snapshot(),discs=this._tecDisciplinas(snap),post=this._postConfig(),cfg=post.disciplinas||{};const rows=fase==='post'?`<section class="rv8-post"><header><div><b>Disciplinas da prova · Pós-edital</b><small>Escolha somente nomes padronizados vindos do TEC. O ciclo regular não participa deste cruzamento.</small></div></header>${discs.length?`<div class="rv8-post-list">${discs.map(d=>{const k=norm(d),x=cfg[k]||{};return`<label class="rv8-post-row"><input type="checkbox" data-rv8-post-active="${esc(k)}" ${x.ativo===true?'checked':''}><span>${esc(d)}</span><input type="number" min="0.1" max="20" step="0.1" value="${n(x.peso,1)}" data-rv8-post-weight="${esc(k)}" data-rv8-post-name="${esc(d)}"><small>peso</small></label>`;}).join('')}</div><button type="button" class="btn-primary" data-rv8-post-save>Salvar disciplinas e pesos</button>`:'<div class="pmc-empty"><b>Importe o TEC primeiro</b><span>Os pesos só podem ser vinculados depois que existirem nomes canônicos de disciplinas no TEC.</span></div>'}</section>`:`<section class="rv8-pre-note"><b>Pré-edital: peso 1 para todas as disciplinas.</b><span>Nenhum peso do ciclo regular é lido. O que diferencia prioridades é lacuna, evidência, persistência, tendência e incidência da banca.</span></section>`;return`<div class="rv8-panel" data-rv8-panel><div class="rv7-method-note"><b>Robusto V8 · foco estatístico.</b> O motor escolhe três disciplinas, ordena seus tópicos e calcula a dose de questões. O método de estudo permanece subjetivo e fora da plataforma.</div><div class="pmc-simple-grid"><label><span>Meta de domínio</span><div class="pmc-suffix"><input data-rv8="meta" type="number" min="60" max="99" value="${p.meta}"><em>%</em></div><small>Régua comum do TEC.</small></label><label><span>Amostra mínima</span><input data-rv8="minAmostra" type="number" min="5" max="300" value="${p.minAmostra}"><small>Piso para classificar uma lacuna.</small></label><label><span>Incidência</span><select data-rv8="banca">${this._bancasHtml(p.banca)}</select><small>Fonte objetiva de relevância.</small></label><label><span>Dose base</span><input data-rv8="doseBase" type="number" min="5" max="100" value="${p.doseBase}"><small>É recalibrada por TEC + resultados de Extras.</small></label><label><span>Dose mínima</span><input data-rv8="doseMin" type="number" min="5" max="60" value="${p.doseMin}"></label><label><span>Dose máxima</span><input data-rv8="doseMax" type="number" min="5" max="100" value="${p.doseMax}"></label></div>${rows}<footer class="rv8-footer"><span>Fontes: TEC + incidência + Extras.</span><b>Sem dependência de nomes/pesos do ciclo regular.</b><button type="button" data-rv8-reset>↺ Restaurar padrões</button></footer></div>`;};
  R.bindConfig=function(host,onChange){if(!host)return;host.querySelectorAll('[data-rv8]').forEach(el=>el.addEventListener('change',()=>{this.salvarPrefs({[el.dataset.rv8]:el.type==='number'?Number(el.value):el.value});if(onChange)onChange();}));const reset=host.querySelector('[data-rv8-reset]');if(reset)reset.addEventListener('click',()=>{this.restaurarPrefs();if(onChange)onChange();});const save=host.querySelector('[data-rv8-post-save]');if(save)save.addEventListener('click',()=>{const ds={};host.querySelectorAll('[data-rv8-post-active]').forEach(cb=>{const k=cb.dataset.rv8PostActive,w=host.querySelector(`[data-rv8-post-weight="${CSS.escape(k)}"]`),nome=w&&w.dataset.rv8PostName||k;ds[k]={nome,ativo:cb.checked,peso:Math.max(.1,n(w&&w.value,1))};});this._salvarPostConfig({configurado:true,disciplinas:ds,atualizadoEm:new Date().toISOString()});if(typeof showToast==='function')showToast('Pesos Pós-edital vinculados às disciplinas do TEC ✓');if(onChange)onChange();});};

  const A=window.PlanoRobustoAuditV1;if(A&&A._cand&&!A.__robustoV8){A.__robustoV8=true;const old=A._cand.bind(A);A._cand=function(c,rank){const z=old(c,rank)||{};delete z.tempo;delete z.calibracao;z.tecMetrics=c?{posterior:c.posterior||null,historicoTec:c.histTec||null,incidencia:c.incidencia||null,scoreTopico:c.scoreTopico||null,scoreDisciplina:c.scoreDisciplina||null,pesoPost:c.pesoPost||1}:null;z.prescricao=c&&c.prescricao||null;z.topicosOrdenados=c&&c.topicosOrdenados||[];return z;};}

  window.PlanoSugestoesRobustoV8=R;window.PlanoSugestoesRobustoV7=R;window.PlanoSugestoesRobustoV6=R;window.PlanoSugestoesRobustoV5=R;
})();
