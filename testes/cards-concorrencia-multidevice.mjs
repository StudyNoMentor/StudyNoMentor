#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const src=readFileSync(join(ROOT,'src/js/60-relational-store.js'),'utf8');

const store=new Map();
const localStorage={
  get length(){return store.size;},
  key(i){return [...store.keys()][i]??null;},
  getItem(k){return store.has(String(k))?store.get(String(k)):null;},
  setItem(k,v){store.set(String(k),String(v));},
  removeItem(k){store.delete(String(k));}
};

const calls=[];
const reviewRows=new Map();
let remoteUpdatedAt='2026-09-22T10:00:00.000Z';

function builder(table){
  const b={
    _table:table,
    select(){return b;}, eq(){return b;}, order(){return b;},
    range(){return b;}, limit(){return b;}, gt(){return b;}, delete(){return b;},
    async maybeSingle(){
      if(table==='study_cards') return {data:{updated_at:remoteUpdatedAt},error:null};
      return {data:null,error:null};
    },
    async upsert(row,opts){
      const copy=structuredClone(row);
      calls.push({table,row:copy,opts:structuredClone(opts||{})});
      if(table==='study_review_log') reviewRows.set(String(row.review_id),copy);
      return {data:null,error:null};
    },
    then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}
  };
  return b;
}

const CloudStore={
  client:{from:table=>builder(table)},
  isLoggedIn:()=>true,
  session:{user:{id:'u1'}}
};
const DB={normalizeCardNotesInPlace(){}};
const ctx={
  console,Promise,Set,Map,Object,Array,Number,String,Boolean,Date,JSON,RegExp,Error,
  structuredClone,parseInt,parseFloat,localStorage,
  navigator:{},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init&&init.detail;}},
  setTimeout,clearTimeout,
  _quiet(){},
  CloudStore,DB,
  window:{CloudStore,dispatchEvent(){},CloudUI:null}
};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(src+'\n;globalThis.RelationalStore=RelationalStore;',ctx,{filename:'60-relational-store.js'});
const R=ctx.RelationalStore;

// 1) ReviewId é identidade estável: replay da mesma operação não duplica histórico.
const baseOp={
  profileId:'p1',planId:'pl1',type:'append',
  row:{reviewId:'rev-1',cardId:'c1',ts:1000,date:'2026-09-22',grade:3,_position:1},
  cardAfter:{id:'c1',updatedAt:'2026-09-22T09:00:00.000Z',frente:'Q',verso:'A'},
  cardPosition:1
};
await R._commitReviewOutboxOp(baseOp);
await R._commitReviewOutboxOp(baseOp);
assert.equal(reviewRows.size,1,'replay do mesmo reviewId deve permanecer idempotente');
const reviewWrites=calls.filter(x=>x.table==='study_review_log');
assert.ok(reviewWrites.length>=2,'o teste deve exercitar replay real');
assert.ok(reviewWrites.every(x=>x.opts.onConflict==='profile_id,plan_id,review_id'&&x.opts.ignoreDuplicates===true),
  'revlog deve usar chave composta estável e ignoreDuplicates');

// 2) Operação offline antiga registra o review, mas NÃO pisa no card mais novo do outro aparelho.
assert.equal(calls.filter(x=>x.table==='study_cards').length,0,
  'card remoto mais novo não pode ser sobrescrito por replay offline antigo');

// 3) Se o snapshot local é realmente mais novo, a projeção do card pode avançar.
remoteUpdatedAt='2026-09-22T08:00:00.000Z';
await R._commitReviewOutboxOp({
  ...baseOp,
  row:{...baseOp.row,reviewId:'rev-2',ts:2000,_position:2},
  cardAfter:{...baseOp.cardAfter,updatedAt:'2026-09-22T11:00:00.000Z',reps:2}
});
const cardWrites=calls.filter(x=>x.table==='study_cards');
assert.equal(cardWrites.length,1,'snapshot local mais novo deve atualizar a projeção remota do card');
assert.equal(cardWrites[0].row.card_id,'c1');
assert.equal(cardWrites[0].opts.onConflict,'profile_id,plan_id,card_id');

// 4) Empates de position entre aparelhos têm ordenação determinística.
R._rpcBundle=async()=>({missing:false,data:{
  profile:{id:'p1'},
  revlog:[
    {review_id:'r4',plan_id:'pl1',position:2,ts:10,review_pk:8},
    {review_id:'r3',plan_id:'pl1',position:1,ts:20,review_pk:7},
    {review_id:'r2',plan_id:'pl1',position:1,ts:10,review_pk:9},
    {review_id:'r1',plan_id:'pl1',position:1,ts:10,review_pk:3}
  ]
}});
const bundle=await R._loadCoreBundle('p1');
assert.deepEqual(Array.from(bundle.revlog,x=>x.review_id),['r1','r2','r3','r4'],
  'revlog concorrente deve desempatar por position, ts e review_pk');

// 5) Hidratação nunca substitui a projeção local antes de drenar respostas offline.
const order=[];
R.isReady=()=>true;
R._trace=()=>{};
R.replayReviewOutbox=async()=>{order.push('replay');return {ok:true,mudou:1};};
R._loadCoreBundle=async()=>{order.push('load');return {profile:{id:'p1'}};};
R._applyCoreBundle=()=>{order.push('apply');};
R.subscribeProfile=()=>{};
R.isHeavyReady=()=>true;
R._lastChangeId=new Map();
R._lastHydratedAt=new Map();
R._heavyReady=new Set();
R._heavyDirty=new Set();
await R.hydrateProfile('p1',{skipWatermark:true,includeHeavy:false});
assert.deepEqual(order.slice(0,3),['replay','load','apply'],
  'outbox offline deve ser drenada antes de carregar/aplicar a nuvem');

// 6) Stress concorrente: milhares de respostas de dois aparelhos em ordens opostas.
// Cada reviewId deve aparecer uma única vez; snapshot remoto mais novo nunca regride.
const beforeStress=reviewRows.size,cardWritesBefore=calls.filter(x=>x.table==='study_cards').length;
for(let i=0;i<5000;i++){
  remoteUpdatedAt='2026-09-22T10:00:00.000Z';
  const newer=(i%2)===1,op={
    ...baseOp,
    row:{...baseOp.row,reviewId:'stress-'+i,ts:100000+i,_position:(i%37)+1},
    cardAfter:{...baseOp.cardAfter,updatedAt:newer?'2026-09-22T11:00:00.000Z':'2026-09-22T09:00:00.000Z',reps:i+3}
  };
  await R._commitReviewOutboxOp(op);
  await R._commitReviewOutboxOp(op); // replay do outro dispositivo / reconexão
}
assert.equal(reviewRows.size,beforeStress+5000,'5.000 reviewIds concorrentes devem permanecer idempotentes');
const stressCardWrites=calls.filter(x=>x.table==='study_cards').length-cardWritesBefore;
assert.equal(stressCardWrites,5000,'cada snapshot realmente mais novo escreve em dois replays idempotentes; stale nunca escreve');
const uniqueStress=new Set([...reviewRows.keys()].filter(x=>x.startsWith('stress-')));
assert.equal(uniqueStress.size,5000,'nenhuma revisão concorrente pode desaparecer ou colidir');

// 7) Catch-up em tempo real não pode apagar uma resposta dada DURANTE a leitura.
// Caso real (auditoria 24/09, card cabb3a95): "Errei" num card novo, a leitura
// do banco já estava em voo com o card ainda novo, e ao chegar regravou a lista
// local inteira. A 2ª resposta partiu de phase:new, s:null.
{
  const k='diario-estudos:u:p1:p:pl1:cards';
  const velho=[{id:'c9',phase:'new',s:null,reps:0,updatedAt:'2026-09-23T20:00:00.000Z'}];
  const novo=[{id:'c9',phase:'learning',s:0.212,reps:1,updatedAt:'2026-09-23T20:09:40.000Z'}];
  localStorage.setItem(k,JSON.stringify(velho));
  R.enabled=true; R._persistPlanKey=async()=>{};
  R.flush=async()=>true;
  R._lastChangeId=new Map([['p1',10]]);
  R._changeSummary=async()=>({count:1,tables:['study_cards'],maxChangeId:11});
  const serverRow={card_id:'c9',plan_id:'pl1',phase:'new',s:null,reps:0,updated_at:'2026-09-23T20:00:00.000Z'};
  let respondeNoMeio=true;
  R._all=async()=>{
    if(respondeNoMeio){
      // a resposta local acontece enquanto a leitura está em voo
      const antes=localStorage.getItem(k),depois=JSON.stringify(novo);
      localStorage.setItem(k,depois); R.onStorageMutation(k,antes,depois);
    }
    await new Promise(r=>setTimeout(r,5));
    return [serverRow];
  };
  const r1=await R.catchUp('p1','realtime');
  clearTimeout(R._rtTimer);
  assert.equal(JSON.parse(localStorage.getItem(k))[0].phase,'learning','leitura velha não pode desfazer a resposta local');
  assert.equal(r1.stale,true,'catch-up deve reconhecer o retrato velho');
  assert.equal(R._lastChangeId.get('p1'),10,'marca d\'água não avança com retrato descartado');
  await R._tail;
  respondeNoMeio=false;
  Object.assign(serverRow,{phase:'learning',s:0.212,reps:1,updated_at:'2026-09-23T20:09:40.000Z'});
  const r2=await R.catchUp('p1','realtime');
  assert.ok(!r2.stale,'sem escrita local concorrente o catch-up aplica');
  assert.equal(R._lastChangeId.get('p1'),11);
  assert.equal(JSON.parse(localStorage.getItem(k))[0].reps,1);
}

console.log('CONCORRÊNCIA CARDS: 5.000 conflitos + replay idempotente, LWW seguro, ordenação estável e hydrate-after-outbox válidos.');
