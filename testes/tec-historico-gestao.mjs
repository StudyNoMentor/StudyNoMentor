import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/js/99m-tec-historico-gestao.js',import.meta.url),'utf8');
const storage=new Map();
const document={
  readyState:'loading',
  addEventListener:()=>{},
  getElementById:()=>null,
  createElement:tag=>({tagName:tag.toUpperCase(),style:{},dataset:{},append(){},appendChild(){},set textContent(v){this._text=v;},get textContent(){return this._text||'';}}),
  head:{appendChild(){}},
};
const window={addEventListener:()=>{},CloudStore:null,TecHistoricalReconstruction:null};
const context={
  console,Date,Math,JSON,Promise,Number,String,Array,Object,Map,Set,RegExp,Blob:class {},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},
  setTimeout:()=>1,clearTimeout:()=>{},confirm:()=>true,
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  document,window,
  DB:{_profilePrefix:()=> 'test:'},
};
vm.createContext(context);
vm.runInContext(source,context,{filename:'99m-tec-historico-gestao.js'});
const M=context.window.TecHistoricalManager;

function ok(cond,msg){if(!cond)throw new Error(msg);}
ok(M,'gestor não publicou TecHistoricalManager');

const row=(id,total=3,acertos=2,erros=1,acertou=true,marcada='B',correta='B',data='15/09/2026')=>({
  questionId:String(id),question:{id:String(id),materia:'DT',assunto:'Tema',acertou,marcada,correta,dataResolucao:data},
  history:{total,acertos,erros},latest:{acertou,marcada,correta,dataResolucao:data}
});

const a=M.snapshotFromRows([row(1),row(2,5,3,2,false,'A','B','14/09/2026')]);
const b=M.snapshotFromRows([row(1),row(2,5,3,2,false,'A','B','14/09/2026')]);
let report=M.compareSnapshots(a,b);
ok(report.exact&&report.matched===2&&report.changed===0,'snapshot idêntico não foi validado como exato');
ok(M.digestSnapshot(a)===M.digestSnapshot({2:a['2'],1:a['1']}),'digest depende da ordem das chaves');

const changed=M.snapshotFromRows([row(1),row(2,6,3,3,false,'C','B','16/09/2026'),row(3)]);
report=M.compareSnapshots(a,changed);
ok(!report.exact,'divergência passou como exata');
ok(report.changed===1,'questão alterada não foi contada');
ok(report.tecOnly===1,'questão só no TEC não foi contada');
ok(report.differences.some(x=>x.questionId==='2'&&x.fields.some(f=>f.field==='history.total')),'mudança de tentativas não entrou no relatório');
ok(report.differences.some(x=>x.questionId==='2'&&x.fields.some(f=>f.field==='latest.marcada')),'mudança de alternativa não entrou no relatório');

/* Estresse determinístico: 20 mil confrontos. Cada mutação factual precisa aparecer. */
let seed=0x12345678;
const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<20000;i++){
  const size=1+Math.floor(rnd()*20),baseRows=[];
  for(let q=0;q<size;q++)baseRows.push(row(`${i}-${q}`,1+Math.floor(rnd()*8),0,0,true,'B','B',`2026-09-${String(1+(q%20)).padStart(2,'0')}`));
  for(const r of baseRows){r.history.acertos=r.history.total;r.history.erros=0;}
  const base=M.snapshotFromRows(baseRows),live=JSON.parse(JSON.stringify(base));
  if(i%4===0){const ids=Object.keys(live);const id=ids[Math.floor(rnd()*ids.length)];live[id].history.total+=1;live[id].history.erros+=1;live[id].latest.acertou=false;live[id].latest.marcada='A';}
  else if(i%4===1){const id=`${i}-tec-only`;live[id]=M.rowSummary(row(id));}
  else if(i%4===2){delete live[Object.keys(live)[0]];}
  const r=M.compareSnapshots(base,live);
  if(i%4===3)ok(r.exact,`cenário ${i}: igualdade virou divergência`);
  else ok(!r.exact&&r.differences.length>0,`cenário ${i}: mutação factual ficou invisível`);
}

/* JSON legado: resultadosOficiais prevalecem e conflito NÃO ganha selo verified. */
const fakeH={
  rowsFromLegacyJSON:data=>data.questoes.map(q=>({questionId:String(q.id),question:{...q,integrity:{status:'verified'}},history:data.desempenhoQuestoes?.[String(q.id)]||null,latest:{acertou:data.resultados?.[String(q.id)]?.acertou,dataResolucao:data.resultados?.[String(q.id)]?.dataResolucao,verified:true},reconstruction:{source:'legacy'}}))
};
M.patchLegacyOfficialPrecedence(fakeH);
const legacy=fakeH.rowsFromLegacyJSON({
  questoes:[{id:'99',marcada:'A',correta:'B',acertou:false}],
  resultados:{'99':{acertou:false,dataResolucao:'14/09/2026'}},
  resultadosOficiais:{'99':{acertou:true,dataResolucao:'15/09/2026'}},
  desempenhoQuestoes:{'99':{total:4,acertos:1,erros:3}}
})[0];
ok(legacy.question.acertou===true,'resultado oficial não prevaleceu sobre resultado local');
ok(legacy.latest.dataResolucao==='15/09/2026','data oficial não prevaleceu');
ok(legacy.latest.verified===false&&legacy.question.integrity.status==='conflict','conflito oficial foi promovido indevidamente a verified');

/* Gestão destrutiva é seletiva por caderno e preserva os demais. */
let tState={questions:{a:{key:'a',bookId:'10',question:{id:'1'}},b:{key:'b',bookId:'20',question:{id:'2'}}},analyses:{'a:tec-pedagogico-v2':{},'b:tec-pedagogico-v2':{}}};
let rState={events:{e1:{bookId:'10',receivedAt:'2026-09-10'},e2:{bookId:'20',receivedAt:'2026-09-11'}},lastEventAt:'2026-09-11'};
context.window.TecIntegracaoScreen={state:()=>tState,save:s=>{tState=s;return true;},render(){},selectedKey:'a'};
context.window.TecRealtime={state:()=>rState,save:s=>{rState=s;return true;},render(){}};
M.render=()=>{};
ok(M.removeLocalBook('10',{skipConfirm:true})===true,'remoção seletiva falhou');
ok(!tState.questions.a&&tState.questions.b,'remoção de caderno apagou biblioteca de outro caderno');
ok(!rState.events.e1&&rState.events.e2,'remoção de caderno apagou eventos de outro caderno');
ok(!tState.analyses['a:tec-pedagogico-v2']&&tState.analyses['b:tec-pedagogico-v2'],'análises órfãs do caderno removido não foram limpas seletivamente');

console.log('GESTÃO HISTÓRICO TEC: 20.000 confrontos + precedência oficial + remoção seletiva validados.');
