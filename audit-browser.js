setTimeout(async function(){
 const report={mode:'browser-real-dom-local-fixtures',errors:[],ui:[]};
 const ck=(name,value,detail)=>report.ui.push({name,pass:!!value,detail:detail??null});
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  const auto=AutoTeste.rodar(false);report.auto={total:auto.total,passed:auto.passou,failed:auto.falhou,failures:auto.falhas};
  report.engine=runTecAudit();
  const day=n=>{const d=new Date(todayLocal()+'T12:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
  const disciplines=['Direito Constitucional','Português','Raciocínio Lógico','Auditoria'];
  const subjects=disciplines.map((nome,i)=>({nome,cor:['#456789','#674589','#896745','#987654'][i],peso:i+1,qtdQuestoes:20,pontosPorQuestao:1,minimoPct:50}));
  DB.saveSubjects(subjects);DB.saveIncidencia([]);
  const snapshots=[-80,-40,-1].map((d,s)=>{const rows=[];disciplines.forEach((disc,i)=>{
   const kids=Array.from({length:5},(_,j)=>{const q=j===4?3:100;const rate=[0,.25,.55,.85,1][j];const ac=Math.round(q*Math.max(0,Math.min(1,rate+(i===0?s*.05:0))));return {codigo:String(j+1).padStart(2,'0'),nome:['Direitos Fundamentais','Organização','Controle','Processo','Sem Classificação'][j],depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};});
   const q=kids.reduce((n,x)=>n+x.questoes,0),ac=kids.reduce((n,x)=>n+x.acertos,0);rows.push({codigo:null,nome:disc,depth:0,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100},...kids);
  });return {id:90001+s,startDate:day(d),endDate:day(d),date:day(d),label:'ALUNO FICTÍCIO — rodada '+(s+1),rows};});
  DB._set(DB.KEYS.tec,snapshots);
  PlanoEngine.salvarPrefs({...PlanoEngine.DEFAULTS,migracao:4});
  DesempenhoTecScreen.scopeMode='all';DesempenhoTecScreen.selectedSnapIds=new Set(snapshots.map(s=>s.id));
  DesempenhoTecScreen.savePrefs({scopeMode:'all',tecTab:'analise'});
  ProfileUI.hideGate();
  switchScreen('desempenhotec');
  for(const tabName of ['analise','incidencia','reforco','plano']){
   try{DesempenhoTecScreen.switchTecTab(tabName);await pause(250);const host=document.getElementById('tec-panel-'+tabName);ck('Render aba '+tabName,host&&host.textContent.trim().length>30,{length:host?.textContent.length});}catch(e){ck('Render aba '+tabName,false,e.message);}
  }
  ck('Sem incidência não afirma estar no teto da prova',!document.getElementById('tec-panel-plano').textContent.includes('você está no teto no que a prova cobra'),{incidencias:DB.getIncidencia().length});
  ck('Persistência dos 3 retratos pelo DB real',DB.getTecSnapshots().length===3);
  ck('Consolidado de 4.836 questões',TecEngine.totais(DesempenhoTecScreen.scopedSnapshot()).questoes===4836);
  const rich={...snapshots[0].rows[1],nome:'<img src=x onerror=alert(1)> " fictício'};
  const testBox=document.createElement('div');testBox.innerHTML=DesempenhoTecScreen.weakRowHtml(rich,false);ck('Nome HTML escapado não cria imagem',testBox.querySelectorAll('img').length===0);
  for(const aba of ['analise','reforco','plano']){try{TecAjustes.abrir(aba);ck('Abrir ajustes '+aba,document.getElementById('tec-cfg-body')?.textContent.trim().length>0);TecAjustes.fechar();}catch(e){ck('Abrir ajustes '+aba,false,e.message);}}
  const DT=DesempenhoTecScreen;
  DT.openImport();
  const start=document.getElementById('tec-import-start'),end=document.getElementById('tec-import-end');
  start.value='';end.value=day(0);ck('Importação: data vazia bloqueada',DT.validateRange()===false);
  start.value=day(0);end.value=day(-1);ck('Importação: início após fim bloqueado',DT.validateRange()===false);
  start.value=day(-80);end.value=day(-80);ck('Importação: sobreposição bloqueada',DT.validateRange()===false);
  start.value=day(0);end.value=day(0);ck('Importação: período adjacente aceito',DT.validateRange()===true);
  const invalid=[{codigo:null,nome:'Inválido',depth:0,disciplina:'Inválido',questoes:10,acertos:15,pctAcerto:150}];
  DT._parsedRows=invalid;const countBefore=DB.getTecSnapshots().length;DT.saveImport();
  ck('Salvar bloqueia acertos maiores que total',DB.getTecSnapshots().length===countBefore,{antes:countBefore,depois:DB.getTecSnapshots().length});
  DB._set(DB.KEYS.tec,snapshots);
  DT.openImport();start.value=day(0);end.value=day(0);DT._parsedRows=[{...invalid[0],questoes:0,acertos:0,pctAcerto:0}];DT.saveImport();
  ck('Salvar bloqueia retrato sem questões',DB.getTecSnapshots().length===3,{depois:DB.getTecSnapshots().length});DB._set(DB.KEYS.tec,snapshots);
  DT.openImport();start.value=day(0);end.value=day(0);DT._parsedRows=snapshots[0].rows;
  const oldReader=MiniXLSX.readFirstSheet;MiniXLSX.readFirstSheet=()=>new Promise(()=>{});
  try{DT.handleFile(new File(['fake'],'novo.xlsx'));DT.saveImport();const ss=DB.getTecSnapshots();ck('Arquivo em leitura impede salvar conteúdo anterior',ss.length===3,{retratos:ss.length,ultimo: ss.at(-1)?.rows[0]?.nome});}finally{MiniXLSX.readFirstSheet=oldReader;DB._set(DB.KEYS.tec,snapshots);DT._parsedRows=null;}
  DT.render();
  DB.saveIncidencia([]);const incRows=disciplines.flatMap((disc,i)=>[
   {disciplina:disc,topico:disc,codigo:null,depth:0,incidencia:100*(i+1)},
   {disciplina:disc,topico:'Direitos Fundamentais',codigo:'01',depth:1,incidencia:60*(i+1)},
   {disciplina:disc,topico:'Organização',codigo:'02',depth:1,incidencia:40*(i+1)}]);
  DB.addIncidenciaRows('BANCA FICTÍCIA A',incRows,false);ck('Incidência: 12 linhas gravadas',DB.getIncidencia().length===12);
  DB.addIncidenciaRows('BANCA FICTÍCIA A',incRows,false);ck('Incidência: reimportar não duplica',DB.getIncidencia().length===12);
  DB.addIncidenciaRows('BANCA FICTÍCIA B',incRows,false);ck('Incidência: bancas separadas',DB.getBancas().length===2);
  DB.renameIncidenciaBanca('BANCA FICTÍCIA B','BANCA FICTÍCIA C');ck('Incidência: renomear preserva 24 linhas',DB.getIncidencia().length===24&&DB.getBancas().includes('BANCA FICTÍCIA C'));
  DB.renameIncidenciaBanca('BANCA FICTÍCIA C','BANCA FICTÍCIA A');ck('Incidência: fusão elimina duplicatas',DB.getIncidencia().length===12&&DB.getBancas().length===1);
  DB.addIncidenciaRows('BANCA FICTÍCIA B',incRows,false);DB.addIncidenciaRows('BANCA FICTÍCIA A',incRows.slice(0,3),true);ck('Incidência: substituir uma banca preserva outra',DB.getIncidencia().filter(x=>x.banca==='BANCA FICTÍCIA B').length===12&&DB.getIncidencia().length===15);
  DT.switchTecTab('incidencia');ck('Incidência: árvore com dados renderiza',document.getElementById('tec-panel-incidencia').textContent.includes('BANCA FICTÍCIA B'));
  DT.switchTecTab('reforco');ck('Reforço com incidência produz conteúdo',document.getElementById('reforco-list').textContent.length>100);
  DT.reforcoToCiclo('Organização','Português');ck('Reforço → Estudo Novo cria aula',DB.getTrack('Português').some(x=>(x.text||'').includes('Organização')),{track:DB.getTrack('Português')});
  DB.saveExtras([]);DT._planoRefC=null;
  ck('Plano cria atividade vinculada',DT.criarExtraDoPlano('Direitos Fundamentais','Português',20,'reforco',true)===true);
  ck('Atividade duplicada em aberto é bloqueada',DT.criarExtraDoPlano('Direitos Fundamentais','Português',20,'reforco',true)===false&&DB.getExtras().length===1);
  ck('Homônimo de outra matéria pode criar atividade',DT.criarExtraDoPlano('Direitos Fundamentais','Auditoria',20,'reforco',true)===true&&DB.getExtras().length===2);
  const first=DB.getExtras()[0],r=PlanoEngine.calcular(DT.scopedSnapshot());const status=PlanoCiclo.avaliar(first,r);
  ck('Atividade nova não herda volume antigo como progresso',status.medido===0&&status.estado==='andamento',{medido:status.medido,estado:status.estado});
  const fresh=JSON.parse(JSON.stringify(snapshots.at(-1)));fresh.id=99999;fresh.startDate=fresh.endDate=fresh.date=day(0);fresh.rows=fresh.rows.filter(x=>x.disciplina==='Português');fresh.rows.forEach(x=>{x.questoes=100;x.acertos=95;x.pctAcerto=95;});
  DB.saveTecSnapshot(fresh);const after=PlanoCiclo.avaliar(first,PlanoEngine.calcular(DT.scopedSnapshot()));ck('Novo retrato a 95% muda veredito para funcionou',after.estado==='funcionou',{estado:after.estado,taxa:after.taxa,medido:after.medido});
  DB._set(DB.KEYS.tec,snapshots);DB.saveExtras([]);DT._planoRefC=null;
  for(const [name,taxa] of [['zero',0],['dominado',100]]){const ss=JSON.parse(JSON.stringify(snapshots));ss.forEach(s=>s.rows.forEach(x=>{x.acertos=x.questoes*taxa/100;x.pctAcerto=taxa;}));DB._set(DB.KEYS.tec,ss);DT.switchTecTab('plano');await pause(200);ck('Plano cenário '+name+' renderiza sem NaN',!document.getElementById('tec-panel-plano').textContent.includes('NaN'));}
  DB._set(DB.KEYS.tec,snapshots);DT._planoRefC=null;
  DT.switchTecTab('analise');
  report.fixture={students:1,snapshots:3,disciplines:4,topicsPerDiscipline:5,questions:4836};
 }catch(e){report.errors.push(e.stack||e.message);}
 const badge=document.createElement('div');badge.id='audit-result';badge.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#12263a;color:white;padding:6px;font:12px sans-serif';badge.textContent='AUDITORIA LOCAL — DADOS FICTÍCIOS — '+(report.engine?report.engine.tests.filter(x=>x.pass).length+'/'+report.engine.tests.length:'erro')+' testes; AutoTeste '+(report.auto?.passed??'?')+'/'+(report.auto?.total??'?');document.body.appendChild(badge);
 const evidence=document.createElement('details');evidence.id='audit-evidence';const summary=document.createElement('summary');summary.textContent='Resultados da auditoria local';evidence.appendChild(summary);const pre=document.createElement('pre');pre.textContent=JSON.stringify(report,null,2);evidence.appendChild(pre);document.body.appendChild(evidence);
 fetch('/audit-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)}).catch(()=>{});
},1500);
