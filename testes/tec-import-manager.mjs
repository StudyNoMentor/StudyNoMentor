import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source=readFileSync(new URL('../src/js/99o-tec-import-manager.js',import.meta.url),'utf8');
const build=readFileSync(new URL('../build.mjs',import.meta.url),'utf8');
const reconstruct=readFileSync(new URL('../companion/src/tec-reconstruct.js',import.meta.url),'utf8');
const storage=new Map();
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
const questions={};
for(let i=1;i<=100;i++){
  const acertou=i<=70;
  questions['q'+i]={key:'q'+i,bookId:'10',tecAccount:'tec_a',history:null,question:{
    id:String(1000+i),cadernoId:'10',acertou,marcada:acertou?'B':'A',correta:'B',materia:i%2?'Direito':'Contabilidade',assunto:'Assunto '+(i%5),banca:i%3?'FGV':'CEBRASPE',concurso:'Fiscal',enunciado:'Enunciado '+i,
    alternativas:[{letra:'A',texto:'A'},{letra:'B',texto:'B',correta:true}],integrity:{schema:3,status:'verified',confidence:'high',conflict:false}
  }};
}
const events=Object.fromEntries(Object.values(questions).map((row,i)=>['e'+i,{eventId:'e'+i,bookId:'10',questionId:row.question.id,acertou:row.question.acertou,marcada:row.question.marcada,correta:'B',localDate:'2026-09-01',resolvedAt:'2026-09-01T12:00:00',integrity:{schema:3,status:'verified',confidence:'high',conflict:false}}]));
const T={state:()=>({questions})};
const R={state:()=>({events}),rows(){return Object.values(events);},render(){}};
const G={classify(value){const q=value?.question||value||{},i=q.integrity||value?.integrity||{};return{trusted:i.status==='verified'&&i.confidence==='high',prescriptive:true,reason:'verified'};}};
const H={ingestBatch(payload){return payload;}};
const context={
  console,Date,Math,JSON,Promise,Number,String,Array,Object,Map,Set,RegExp,Blob:class {},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},
  localStorage,location:{origin:'https://studynomentor.github.io'},setTimeout:()=>0,clearTimeout:()=>{},
  DB:{_profilePrefix:()=> 'test:'},SectionSync:{markDirty(){}},CloudStore:{notifyChange(){}},
  document:{readyState:'loading',addEventListener(){},getElementById(){return null;},body:{append(){},classList:{add(){},remove(){}}}},
  window:{TecIntegracaoScreen:T,TecRealtime:R,TecTrustGate:G,TecHistoricalReconstruction:H,addEventListener(){},CloudStore:{notifyChange(){}}}
};
context.window.window=context.window;context.window.document=context.document;context.window.localStorage=localStorage;context.window.DB=context.DB;context.window.SectionSync=context.SectionSync;
vm.createContext(context);vm.runInContext(source,context,{filename:'99o-tec-import-manager.js'});
const IM=context.window.TecImportManager;
assert.ok(IM,'central de gestão não foi exportada');

/* Caderno inteiro: nenhuma janela diária participa da conta. Cem questões já
   respondidas precisam resultar em 100 tentativas conhecidas e 70 acertos, mesmo
   quando o histórico agregado individual não foi exposto pelo TEC. */
let s=IM.stats('10');
assert.equal(s.questions,100);
assert.equal(s.attempts,100);
assert.equal(s.correct,70);
assert.equal(s.wrong,30);
assert.equal(s.effectiveAttempts,100);
assert.equal(s.effectiveCorrect,70);
assert.equal(Math.round(s.effectiveAccuracy*100),70);

/* Desconsiderar é governança reversível: dado bruto continua existindo, mas sai
   de Radar/TrustGate e das métricas efetivas. */
IM.setExcluded('10','1001',true,'teste');
s=IM.stats('10');
assert.equal(s.questions,100,'exclusão apagou dado bruto');
assert.equal(s.excludedQuestions,1);
assert.equal(s.effectiveAttempts,99);
assert.equal(s.effectiveCorrect,69);
IM.patchMetrics();
assert.equal(R.rows().length,99,'Radar ainda recebeu questão desconsiderada');
assert.equal(G.classify(events.e0).reason,'manually-excluded','TrustGate não marcou exclusão manual');
IM.setExcluded('10','1001',false,'');
assert.equal(IM.stats('10').effectiveAttempts,100,'reversão da exclusão não restaurou métricas');

/* Reconstrução conservadora: se o TEC prova uma resolução mas não expõe o
   gráfico de histórico, registramos UMA tentativa mínima factual — nunca zero e
   nunca inventamos tentativas anteriores. */
const payload={rows:[{questionId:'9001',latest:{acertou:false,marcada:'A',correta:'B'},question:{id:'9001',acertou:false}}]};
IM.ensureConservativeHistory(payload);
assert.equal(payload.rows[0].history.total,1);
assert.equal(payload.rows[0].history.erros,1);
assert.equal(payload.rows[0].history.minimumKnown,true);
assert.equal(payload.rows[0].history.complete,false);

/* Gestão e auditoria disponíveis por conteúdo e filtros relevantes. */
for(const needle of ['Abrir caderno','Desconsiderar das métricas','Marcar como revisada por mim','Minha resposta','Gabarito','Matéria','Assunto','Banca','Concurso','Mín. tentativas','Histórico de tentativas','Dados técnicos / proveniência'])assert.ok(source.includes(needle),`recurso ausente: ${needle}`);
assert.ok(source.includes("status: 'all'"));
assert.ok(source.includes("reviewed: 'all'"));
assert.ok(source.includes('exportManaged(bookId)'));
assert.ok(build.includes("S('css/35-tec-import-manager.css')"));
assert.ok(build.includes("'js/99o-tec-import-manager.js'"));

/* Scanner histórico continua explicitamente fora do recorte diário: abre
   Resolvidas, carrega TODAS as páginas e só então monta a lista de alvos. */
assert.ok(reconstruct.includes("await selectFilter('Resolvidas');\n      await loadAllRows();\n      const targets = scanTargets();"),'scanner deixou de carregar o histórico inteiro do caderno');
assert.ok(!/today\(\)|localDate\s*===/.test(reconstruct.slice(reconstruct.indexOf('async function run'),reconstruct.indexOf('chrome.runtime.onMessage'))),'scanner do caderno ganhou filtro diário');

console.log('TEC IMPORT MANAGER: caderno integral 100/70 + filtros + auditoria + exclusão reversível validados.');
