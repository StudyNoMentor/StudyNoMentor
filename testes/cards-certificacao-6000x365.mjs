#!/usr/bin/env node
/* Certificação anual de escala.
   Exercita os módulos de PRODUÇÃO durante 365 dias sobre 6.000 cards.
   Não substitui os testes unitários existentes: cobre a lacuna temporal/escala. */
import assert from 'node:assert/strict';
import { criarAmbiente } from '../audit/cards-20260921-v2/harness.mjs';

const A=criarAmbiente({now:Date.parse('2026-01-05T12:00:00Z'),rolloverHour:4});
const {DB,CardsConfig:C,CardEngine:E,CardsScreen:S,FSRS,AnkiParity}=A;
A.reset({
  algo:'fsrs',retention:.9,loadBalance:true,learnSteps:[1,10],relearnSteps:[10],
  newPerDay:20,revPerDay:500,maxInterval:36500,leechThreshold:8,leechAction:'tag',
  easyDays:[1,.5,1,1,.5,1,1],buryNew:true,buryReviews:true,buryInterdayLearning:true
});
DB.saveDecks([{id:'d1',nome:'Certificação anual',createdAt:new Date(A.agora()).toISOString()}]);

const N=6000,DAYS=365,base=A.hoje(),cards=[];
for(let i=0;i<N;i++){
  const id='annual-'+String(i).padStart(5,'0'),common={id,noteId:'note-'+Math.floor(i/2),deckId:'d1',frente:'Q'+i,verso:'A'+i,flag:0,suspenso:false,enterradoAte:null,buryKind:null,createdAt:new Date(A.agora()-i*1000).toISOString()};
  if(i<1500){
    cards.push({...common,phase:'new',reps:0,lapses:0,s:null,d:null,intervalo:0,posicaoNova:i+1,due:base,dueTs:null});
  }else if(i<5250){
    const iv=1+(i%180),ago=Math.max(1,Math.floor(iv*(.7+(i%7)/20))),dueOff=(i%61)-20,last=E.addDays(base,-ago);
    cards.push({...common,phase:'review',reps:3+(i%25),lapses:i%4,s:Math.max(.2,iv*(.55+(i%9)/20)),d:1+(i%90)/10,intervalo:iv,lastReview:last,due:E.addDays(base,dueOff),dueTs:null,ease:2.5});
  }else if(i<5625){
    cards.push({...common,phase:'learning',reps:1+(i%3),lapses:0,s:.5+(i%10)/10,d:3+(i%50)/10,intervalo:1,learnStep:i%2,lastReview:E.addDays(base,-1),due:E.addDays(base,i%7),dueTs:null});
  }else{
    cards.push({...common,phase:'relearning',reps:5+(i%10),lapses:1+(i%5),s:2+(i%20)/2,d:4+(i%50)/10,intervalo:5+(i%20),learnStep:0,lastReview:E.addDays(base,-5),due:E.addDays(base,i%11),dueTs:null});
  }
}

const transient=new Set(['_kind','_val','_leechNow']);
const history=[],gradeCount={errei:0,dificil:0,bom:0,facil:0},phaseSeen=new Set(),daily=[],queueChecks=[];
let invalid=0,maxSeenIvl=0,lbCalls=0,fuzzCalls=0,introTotal=0,reviewTotal=0,intradayTotal=0,lapseEvents=0,leechEvents=0;
const origLB=FSRS.loadBalance.bind(FSRS);FSRS.loadBalance=(...args)=>{lbCalls++;return origLB(...args);};
const origLF=AnkiParity.learningFuzzSeconds.bind(AnkiParity);AnkiParity.learningFuzzSeconds=(...args)=>{fuzzCalls++;return origLF(...args);};

function hash(s){return FSRS._hash(String(s))>>>0;}
function gradeFor(c,day,seq){
  const n=hash(c.id+'|'+day+'|'+(c.reps||0)+'|'+seq)%100;
  if(n<8)return'errei';if(n<18)return'dificil';if(n>=93)return'facil';return'bom';
}
function isBuried(c){return !!(c.enterradoAte&&String(c.enterradoAte)>A.hoje());}
function reviewLike(c){return !c.suspenso&&!c.dueTs&&(c.phase==='review'||((c.reps||0)>0&&(c.intervalo||0)>0));}
function initDueCache(){
  const map={};for(const c of cards){if(!reviewLike(c))continue;const k=c.due||'';map[k]=(map[k]||0)+1;}E._dueCache={day:A.hoje(),map};
}
function bumpDue(c,delta){
  if(!reviewLike(c))return;const k=c.due||'';E._dueCache.map[k]=Math.max(0,(E._dueCache.map[k]||0)+delta);
}
function valid(c){
  if(!['new','learning','review','relearning'].includes(c.phase))return false;
  if(c.dueTs!=null&&!Number.isFinite(Number(c.dueTs)))return false;
  if(c.dueTs==null&&c.phase!=='new'&&!/^\d{4}-\d{2}-\d{2}$/.test(String(c.due||'')))return false;
  if(c.phase!=='new'&&(!(Number(c.s)>0)||!Number.isFinite(Number(c.s))||!(Number(c.d)>=1&&Number(c.d)<=10)))return false;
  if((Number(c.intervalo)||0)>(Number(C.get().maxInterval)||36500))return false;
  return true;
}
function answer(c,grade,day,seq){
  phaseSeen.add(c.phase);const before={phase:c.phase,lapses:Number(c.lapses)||0,due:c.due,dueTs:c.dueTs};
  bumpDue(c,-1);
  const p=E.schedule(c,grade),clean={};for(const [k,v] of Object.entries(p))if(!transient.has(k))clean[k]=v;
  Object.assign(c,clean);bumpDue(c,1);
  gradeCount[grade]++;maxSeenIvl=Math.max(maxSeenIvl,Number(c.intervalo)||0);
  if((Number(c.lapses)||0)>before.lapses)lapseEvents++;if(p._leechNow)leechEvents++;
  if(!valid(c))invalid++;
  history.push({day,cardId:c.id,grade,beforePhase:before.phase,afterPhase:c.phase,due:c.due,dueTs:c.dueTs,s:c.s,d:c.d});
}
function checkpoint(day){
  DB.saveCards(cards);E.invalidateDueCache();const q=S.buildQueue(),uniq=new Set(q);
  queueChecks.push({day,len:q.length,unique:uniq.size,valid:q.every(id=>DB.getCard(id))});
  assert.equal(uniq.size,q.length,'fila sem IDs duplicados no checkpoint '+day);
  assert.ok(q.every(id=>DB.getCard(id)),'fila não pode referenciar card inexistente');
}

for(let day=0;day<DAYS;day++){
  // 09:00 local aproximado todos os dias; o harness controla a virada às 4h.
  const start=Date.parse('2026-01-05T12:00:00Z')+day*86400000;A.irPara(start);initDueCache();
  const today=A.hoje();let seq=0,newDone=0,revDone=0,intra=0;const intraByCard=new Map();

  // Novos respeitam o limite diário real configurado.
  const news=cards.filter(c=>c.phase==='new'&&!c.suspenso&&!isBuried(c)).sort((a,b)=>(a.posicaoNova||0)-(b.posicaoNova||0)).slice(0,C.get().newPerDay);
  for(const c of news){answer(c,gradeFor(c,day,seq++),day,seq);newDone++;introTotal++;}

  // Reviews + learning/relearning interday respeitam o teto diário de review.
  const due=cards.filter(c=>c.phase!=='new'&&!c.suspenso&&!isBuried(c)&&(
    (c.dueTs!=null&&Number(c.dueTs)<=A.agora())||(c.dueTs==null&&String(c.due||today)<=today)
  )).sort((a,b)=>String(a.due||'').localeCompare(String(b.due||''))||String(a.id).localeCompare(String(b.id))).slice(0,C.get().revPerDay);
  const newIds=new Set(news.map(c=>c.id));
  for(const c of due){if(newIds.has(c.id))continue;answer(c,gradeFor(c,day,seq++),day,seq);revDone++;reviewTotal++;}

  // Passos intradiários: percorre cronologicamente até a próxima virada.
  const nextRollover=A.ctx.proximaViradaTs();let guard=0;
  while(guard++<12000){
    const pending=cards.filter(c=>!c.suspenso&&!isBuried(c)&&c.dueTs!=null&&Number(c.dueTs)<nextRollover).sort((a,b)=>Number(a.dueTs)-Number(b.dueTs));
    if(!pending.length)break;
    const c=pending[0],ts=Number(c.dueTs);if(ts>A.agora()){A.irPara(ts);initDueCache();}
    const seen=(intraByCard.get(c.id)||0)+1;intraByCard.set(c.id,seen);
    if(seen>100)throw new Error('Card preso em passo intradiário: '+JSON.stringify({day,date:today,id:c.id,phase:c.phase,learnStep:c.learnStep,dueTs:c.dueTs,reps:c.reps,lapses:c.lapses,now:A.agora()}));
    answer(c,gradeFor(c,day,seq++),day,seq);intra++;intradayTotal++;
  }
  if(guard>=12000){const top=[...intraByCard.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);throw new Error('Volume intradiário excedeu o teto de segurança: '+JSON.stringify({day,date:today,intra,top}));}
  assert.ok(newDone<=C.get().newPerDay,'limite diário de novos');
  assert.ok(revDone<=C.get().revPerDay,'limite diário de reviews');
  daily.push({day,date:today,newDone,revDone,intra,total:newDone+revDone+intra});

  // Exercita enterro e suspensão sem contaminar a massa inteira.
  if(day%29===0){const x=cards.find(c=>c.phase==='review'&&!c.suspenso);if(x){x.enterradoAte=E.addDays(today,1);x.buryKind='user';}}
  if(day%73===0&&day>0){const x=cards.find(c=>c.phase==='review'&&!c.suspenso&&!isBuried(c));if(x)x.suspenso=true;}
  // Desenterro automático lógico após o dia passar.
  for(const c of cards)if(c.enterradoAte&&String(c.enterradoAte)<=today){c.enterradoAte=null;c.buryKind=null;}

  if(day%90===0||day===DAYS-1)checkpoint(day);
}

assert.equal(cards.length,N,'nenhum card pode desaparecer');
assert.equal(daily.length,DAYS,'365 dias completos precisam ser simulados');
assert.equal(invalid,0,'nenhum estado/agendamento inválido');
assert.ok(history.length>25000,'simulação deve produzir volume material de respostas');
assert.ok(lbCalls>1000,'load balancing precisa ser exercitado de verdade');
assert.ok(fuzzCalls>1000,'fuzz de learning/relearning precisa ser exercitado');
assert.ok(intradayTotal>1000,'passos intradiários precisam ser exercitados');
assert.ok(lapseEvents>500,'lapses precisam ocorrer em escala');
assert.ok(Object.values(gradeCount).every(n=>n>100),'os quatro botões devem ser exercitados');
assert.ok(phaseSeen.has('new')&&phaseSeen.has('learning')&&phaseSeen.has('review')&&phaseSeen.has('relearning'),'todas as fases devem ser exercitadas');
assert.ok(maxSeenIvl<=C.get().maxInterval,'intervalo máximo respeitado');
assert.equal(history.length,Object.values(gradeCount).reduce((a,b)=>a+b,0),'uma entrada lógica por resposta');
assert.ok(queueChecks.length>=5&&queueChecks.every(x=>x.unique===x.len&&x.valid),'fila válida nos checkpoints');

const endReview=cards.filter(c=>c.phase==='review').length,endLearning=cards.filter(c=>c.phase==='learning'||c.phase==='relearning').length,endNew=cards.filter(c=>c.phase==='new').length;
console.log('CERTIFICAÇÃO ANUAL 10/10:');
console.log(JSON.stringify({
  cards:N,dias:DAYS,respostas:history.length,introduzidos:introTotal,revisoesInterday:reviewTotal,
  passosIntraday:intradayTotal,loadBalanceCalls:lbCalls,learningFuzzCalls:fuzzCalls,lapses:lapseEvents,leeches:leechEvents,
  grades:gradeCount,fases:[...phaseSeen],final:{review:endReview,learning:endLearning,new:endNew},maxInterval:maxSeenIvl,
  checkpoints:queueChecks
},null,2));
