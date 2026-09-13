function runTecAudit(){
 const tests=[],benchmarks=[];
 const test=(name,fn)=>{try{const r=fn();tests.push({name,pass:r===true,detail:r===true?'ok':r});}catch(e){tests.push({name,pass:false,detail:e.message});}};
 const eq=(a,b)=>Math.abs(a-b)<1e-7;
 const header=['Hierarquia','Índice','Questões Resolvidas','Acertos (%)','Quantidade de acertos'];
 const T=TecEngine,P=PlanoEngine,D=DesempenhoTecScreen,R=ReforcoEngine;
 const day=offset=>{const d=new Date(todayLocal()+'T12:00:00');d.setDate(d.getDate()+offset);return d.toISOString().slice(0,10);};
 const row=(nome,q,ac,disc='Direito',codigo='01',depth=1)=>({nome,questoes:q,acertos:ac,disciplina:disc,codigo,depth,pctAcerto:q?ac/q*100:0});
 const snap=(id,offset,items)=>({id,startDate:day(offset),endDate:day(offset),date:day(offset),label:'FICTÍCIO '+id,rows:items});
 const simple=(id,offset,q,ac,nome='Tema A',disc='Direito')=>snap(id,offset,[row(disc,q,ac,disc,null,0),row(nome,q,ac,disc)]);
 const original={},methods=['getTecSnapshots','getIncidencia','getActiveSubjects','getSubjects','getEntries','getExtras','getTrack'];
 methods.forEach(k=>original[k]=DB[k]);const oldPrefs=P.prefs;
 let snapshots=[],incidence=[],subjects=[],prefs={...P.DEFAULTS,migracao:4},extras=[];
 DB.getTecSnapshots=()=>snapshots;DB.getIncidencia=()=>incidence;DB.getActiveSubjects=()=>subjects;DB.getSubjects=()=>subjects;DB.getEntries=()=>[];DB.getExtras=()=>extras;DB.getTrack=()=>[];
 P.prefs=()=>({...prefs});
 function reset(ss=[],patch={}){snapshots=ss;incidence=[];subjects=[];extras=[];prefs={...P.DEFAULTS,migracao:4,...patch};D.scopeMode='all';D.selectedSnapIds=new Set(ss.map(s=>s.id));}
 function calc(patch={}){return P.calcular(D.aggregate(snapshots),patch);}
 try{
 test('Sem dados: erro explícito sem-retrato',()=>{reset();return calc().erro==='sem-retrato';});
 for(const q of [1,2,5,19,20,49,50,100,1000])for(const pct of [0,50,100]){
  test(`Amostra ${q}, acertos ${Math.round(q*pct/100)}: domínio finito e exato`,()=>{const ac=Math.round(q*pct/100);reset([simple(1,-1,q,ac)],{incluirPequenas:true});const r=calc();return eq(r.dominioPct,ac/q*100)||r;});
  test(`Wilson n=${q} p=${pct}: limites contêm estimativa e não degeneram`,()=>{const iv=P.intervalo(pct,q);return iv[0]<=pct+1e-8&&iv[1]>=pct-1e-8&&iv[1]>iv[0];});
 }
 test('Pouca amostra não rotulada como diagnóstico firme',()=>{reset([simple(1,-1,5,0)]);return calc().erro==='amostra';});
 test('Taxa ponderada por contagens, não média de percentuais',()=>{reset([simple(1,-10,10,10),simple(2,-1,90,0)]);return eq(T.totais(D.aggregate(snapshots)).pct,10);});
 test('Taxa recente substitui desempenho antigo quando alcança amostra',()=>{reset([simple(1,-60,100,0),simple(2,-1,100,80)]);const r=calc();return eq(r.dominioPct,80);});
 test('Regressão de 90% para 20% gera queda firme',()=>{reset([simple(1,-60,100,90),simple(2,-1,100,20)]);return calc().piorando===1;});
 test('Melhora de 20% para 80% gera melhora firme',()=>{reset([simple(1,-60,100,20),simple(2,-1,100,80)]);return calc().melhorando===1;});
 test('Diferença de uma resposta em amostra pequena não gera tendência firme',()=>{reset([simple(1,-60,20,10),simple(2,-1,20,11)],{amostraAlvo:20});const r=calc();return r.melhorando===0&&r.piorando===0;});
 test('Primeira medição não inventa tendência',()=>{reset([simple(1,-1,100,50)]);return calc().itens[0].delta===null;});
 test('Duas medições na meta consolidam sem perder rastreio',()=>{reset([simple(1,-10,100,90),simple(2,-1,100,90)]);return calc().solidosAtuais===1;});
 test('Medição antiga sinaliza vencimento',()=>{reset([simple(1,-200,100,50)]);return calc().vencidos===1;});
 test('Janela máxima não reutiliza observação inteiramente fora dela',()=>{reset([simple(1,-500,100,80)]);const r=calc();return r.erro||r.qTotal===0?true:{qTotal:r.qTotal,dominio:r.dominioPct,janela:r.janelaMax};});
 test('Filtro de período não incorpora medição futura ao recorte',()=>{reset([simple(1,-60,100,20),simple(2,-1,100,80)]);D.scopeMode='select';D.selectedSnapIds=new Set([1]);const r=P.calcular(D.scopedSnapshot());return eq(r.dominioPct,20)||{esperado:20,obtido:r.dominioPct};});
 test('Seleção vazia não quebra',()=>{reset([simple(1,-1,100,50)]);D.scopeMode='select';D.selectedSnapIds=new Set();return D.scopedSnapshot()===null;});
 test('Datas de filtro incluem retrato que cruza o intervalo',()=>{reset([{...simple(1,-1,100,50),startDate:day(-30),endDate:day(-1)}]);D.scopeMode='range';D.rangeStart=day(-20);D.rangeEnd=day(-10);return D.activeSnapshots().length===1;});
 test('Excluir todas as matérias retorna tudo-excluido',()=>{reset([simple(1,-1,100,50)],{excluidas:['Direito']});return calc().erro==='tudo-excluido';});
 test('Foco em uma matéria remove a outra do domínio',()=>{reset([snap(1,-1,[...simple(1,-1,100,0,'Tema A','Direito').rows,...simple(1,-1,100,100,'Tema B','Português').rows])],{foco:['Direito']});return eq(calc().dominioPct,0);});
 test('Exclusão preserva volume dos dados originais',()=>{reset([simple(1,-1,100,50)],{excluidas:['Direito']});calc();return snapshots[0].rows[0].questoes===100;});
 for(const gran of [0,5,10,20,50,100])test(`Granularidade ${gran}: conserva volume em árvore irregular`,()=>{
  const rr=[row('Direito',32,19,'Direito',null,0),row('Pai',22,13,'Direito','01'),row('Filho A',12,8,'Direito','01.01',2),row('Neto',7,5,'Direito','01.01.01',3),row('Filho B',10,5,'Direito','01.02',2),row('Outro',10,6,'Direito','02')];
  reset([snap(1,-1,rr)],{granPiso:gran,incluirPequenas:true});const idx=P._indice(D.aggregate(snapshots),prefs);const vals=Object.values(idx);return eq(vals.reduce((a,x)=>a+x.q,0),32)&&eq(vals.reduce((a,x)=>a+x.ac,0),19);});
 test('Mudança de código entre retratos preserva volume no Plano',()=>{reset([simple(1,-30,100,50),snap(2,-1,[row('Direito',100,80,'Direito',null,0),row('Tema A',100,80,'Direito','02')])]);return eq(Object.values(P.totalHistorico(prefs)).reduce((n,x)=>n+x.q,0),200);});
 test('Nota projetada acompanha taxa adaptativa usada pelo Plano',()=>{reset([simple(1,-60,100,20),simple(2,-1,100,80)]);subjects=[{nome:'Direito',qtdQuestoes:100,pontosPorQuestao:1,peso:1}];const p=PlanoPontos.projecao(prefs),r=calc();return eq(p.pctHoje,r.dominioPct)||{notaProjetada:p.pctHoje,dominioAtual:r.dominioPct};});
 test('Margem apresentada como ± cobre o intervalo de Wilson em 0/20',()=>{const iv=P.intervalo(0,20),m=P.margemErro(0,20);return m>=iv[1]||{texto:D.weakRowHtml(row('Tema',20,0),false),intervalo:iv};});
 const validCounts=rows=>rows.every(r=>Number.isInteger(r.questoes)&&Number.isInteger(r.acertos)&&r.questoes>=0&&r.acertos>=0&&r.acertos<=r.questoes);
 for(const [label,q,ac,pct] of [['acertos maiores que total',10,15,150],['total negativo',-10,0,0],['acertos negativos',10,-2,-20],['quantidades fracionárias',10.5,5.5,52.4],['quantidade enorme',1e309,1,0]])test('Importação rejeita '+label,()=>{const rr=T.parseCellRows([header,['','Direito',q,pct,ac]]);return validCounts(rr)||rr;});
 test('CSV com nome entre aspas e vírgula preserva tópico e números',()=>{const rr=T.parse('Hierarquia,Índice,Questões Resolvidas,Acertos (%),Quantidade de acertos\n,"Direito, Processo",10,50,5\n01,"Atos, Fatos",10,50,5');return rr.length===2&&rr[1].nome==='Atos, Fatos'&&rr[1].questoes===10||rr;});
 test('Cabeçalho repetido no meio do arquivo não cria dados',()=>{const rr=T.parseCellRows([header,['','Direito',10,50,5],['01','Tema A',10,50,5],header,['','Português',10,50,5],['01','Tema B',10,50,5]]);return rr.length===4||rr;});
 test('Acentos e caixa não duplicam assunto entre retratos',()=>{reset([simple(1,-30,50,25,'Atos Jurídicos'),simple(2,-1,50,25,'ATOS JURIDICOS')]);return P.calcular(D.aggregate(snapshots)).assuntos===1;});
 test('Mesmo nome em matérias distintas não mistura taxa',()=>{reset([snap(1,-1,[...simple(1,-1,100,10,'Teoria','Direito').rows,...simple(1,-1,100,80,'Teoria','Português').rows])]);return calc().assuntos===2;});
 test('Nome especial __proto__ não quebra importação e indexação',()=>{reset([simple(1,-1,100,50,'__proto__','constructor')]);const r=calc();return r.assuntos===1||r;});
 test('Caminho mínimo já na meta não recomenda esforço adicional obrigatório',()=>{reset([simple(1,-1,100,89)]);const r=calc();return r.jaAtinge===true&&(!r.caminho||r.caminho.q===0)||{jaAtinge:r.jaAtinge,caminho:r.caminho};});
 test('Meta inalcançável pelo teto não promete caminho',()=>{reset([simple(1,-1,100,50)],{metaDominio:95,tetoDominio:90});return calc().caminho===null;});
 for(const ordenar of ['pior','queda','rendimento','banca','ganhoGeral','pontos'])test(`Ordem ${ordenar}: domínio invariável e taxas válidas`,()=>{reset([snap(1,-1,Array.from({length:12},(_,i)=>row('Tema '+i,100,10+i*6,'Direito',String(i+1))))]);const r=calc({ordenar});return eq(r.dominioPct,43)&&r.itens.every(x=>x.taxa>=0&&x.taxa<=100);});
 for(const tipo of ['fixo','lacuna','proporcional'])test(`Custo ${tipo}: positivo e finito`,()=>{reset([simple(1,-1,100,50)]);return calc({custoModo:tipo}).itens.every(x=>Number.isFinite(x.custoQ)&&x.custoQ>0);});
 for(const [key,val] of [['metaDominio','abc'],['amostraAlvo','abc'],['limite',-1],['custoFator','abc'],['custoPiso','abc'],['janelaMax',-1]])test(`Preferência inválida ${key}=${val}: saneamento`,()=>{reset([simple(1,-1,100,50)],{[key]:val,...(key==='custoFator'?{custoModo:'proporcional'}:{})});const r=calc();return Number.isFinite(r.meta)&&Number.isFinite(r.dominioPct)&&r.itens.length>0&&r.itens.every(x=>Number.isFinite(x.custoQ))||{meta:r.meta,dominio:r.dominioPct,itens:r.itens?.length,custo:r.itens?.[0]?.custoQ};});
 // Oráculo independente para soma/ponderação em cenários determinísticos.
 let seed=123456789;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 for(let c=0;c<80;c++)test(`Cenário gerado ${c+1}: contagem, domínio, ganho e limite`,()=>{
  const n=3+Math.floor(rand()*17),rr=[];let sumq=0,sumac=0,sumrate=0;
  for(let i=0;i<n;i++){const q=50+Math.floor(rand()*400),ac=Math.floor(rand()*(q+1));rr.push(row('Tópico '+i,q,ac,'Direito',String(i+1)));sumq+=q;sumac+=ac;sumrate+=ac/q*100;}
  reset([snap(1,-1,[row('Direito',sumq,sumac,'Direito',null,0),...rr])]);const r=calc(),v=calc({ponderacao:'volume'});const total=T.totais(D.aggregate(snapshots));
  return eq(total.questoes,sumq)&&eq(total.acertos,sumac)&&eq(r.dominioPct,sumrate/n)&&eq(v.dominioPct,sumac/sumq*100)&&r.itens.length<=10&&r.itens.every(x=>Number.isFinite(x.ganhoPP)&&x.ganhoPP>=0&&x.acumulado<=100.0001);
 });
 for(const n of [100,500,1000,3000]){
  const rr=Array.from({length:n},(_,i)=>row('Assunto '+i,100,20+i%65,'Matéria '+Math.floor(i/100),String(i%100+1)));
  reset([snap(1,-1,rr)]);const a=performance.now();const r=calc();benchmarks.push({assuntos:n,ms:Math.round(performance.now()-a),returned:r.itens?.length,total:r.totalItens});
 }
 }finally{methods.forEach(k=>DB[k]=original[k]);P.prefs=oldPrefs;}
 return {date:todayLocal(),tests,benchmarks};
}
