import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../companion/src/background-reconstruct.js',import.meta.url),'utf8');
const backpressure=readFileSync(new URL('../companion/src/background-reconstruct-backpressure-v2.js',import.meta.url),'utf8');
const store={};
const runtimeMessages=[],connectListeners=[],startupListeners=[],installedListeners=[],removedListeners=[],alarmListeners=[];
let nextTab=200;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chrome={
  storage:{local:{
    async get(key){return{[key]:store[key]};},
    async set(obj){Object.assign(store,JSON.parse(JSON.stringify(obj)));},
    async remove(key){for(const k of Array.isArray(key)?key:[key])delete store[k];}
  }},
  runtime:{
    lastError:null,
    onConnect:{addListener:fn=>connectListeners.push(fn)},
    onMessage:{addListener:fn=>runtimeMessages.push(fn)},
    onStartup:{addListener:fn=>startupListeners.push(fn)},
    onInstalled:{addListener:fn=>installedListeners.push(fn)}
  },
  tabs:{
    async create({url}){return{id:nextTab++,url,status:'complete'};},
    async get(id){return{id:Number(id),status:'complete',url:'https://www.tecconcursos.com.br/questoes/cadernos/10'};},
    async sendMessage(){return{accepted:true};},
    async remove(){},
    onRemoved:{addListener:fn=>removedListeners.push(fn)}
  },
  alarms:{
    async create(){},
    onAlarm:{addListener:fn=>alarmListeners.push(fn)}
  }
};
const context={console,Date,Math,JSON,Promise,Number,String,Array,Object,Map,Set,RegExp,setTimeout,clearTimeout,chrome};
vm.createContext(context);
vm.runInContext(source,context,{filename:'background-reconstruct.js'});
vm.runInContext(backpressure,context,{filename:'background-reconstruct-backpressure-v2.js'});
const ok=(cond,msg)=>{if(!cond)throw new Error(msg);};

function makePort(){
  const posted=[],messageListeners=[],disconnectListeners=[];
  return{
    name:'snm-study-reconstruct-v1',sender:{url:'https://studynomentor.github.io/StudyNoMentor/',tab:{id:7}},posted,
    postMessage:m=>posted.push(JSON.parse(JSON.stringify(m))),
    onMessage:{addListener:fn=>messageListeners.push(fn)},
    onDisconnect:{addListener:fn=>disconnectListeners.push(fn)},
    send:m=>messageListeners.forEach(fn=>fn(m)),
    disconnect:()=>disconnectListeners.forEach(fn=>fn())
  };
}
async function runtimeMessage(msg,tabId,url='https://www.tecconcursos.com.br/questoes/cadernos/10'){
  return await new Promise((resolve,reject)=>{
    let settled=false;
    const timer=setTimeout(()=>{if(!settled)reject(new Error('timeout runtime message'));},1000);
    for(const fn of runtimeMessages){
      fn(msg,{url,tab:{id:tabId}},answer=>{if(settled)return;settled=true;clearTimeout(timer);resolve(answer);});
    }
  });
}

ok(connectListeners.length===1,'listener de porta de reconstrução ausente');
const ctx={userId:'u1',profileId:'p1',tabSessionId:'s1',deviceId:'d1'};
const p1=makePort();connectListeners[0](p1);
p1.send({type:'reconstruct-request',payload:{requestId:'r1',bookId:'10',context:ctx}});
await sleep(30);
let jobs=store.snmTecReconstructJobsV1;
ok(jobs?.jobs?.r1?.status==='running','job não entrou em execução');
const tabId=jobs.jobs.r1.tabId;

/* Study some: lote deve sobreviver sem porta conectada. */
p1.disconnect();
let response=await runtimeMessage({kind:'tec-reconstruct-batch',requestId:'r1',tecAccount:'tec_a',tecAccountConfidence:'strong',rows:[{questionId:'1',latest:{dataResolucao:'15/09/2026',acertou:true,marcada:'B',correta:'B'}}]},tabId);
ok(response?.ok===true&&response?.durable===true&&response?.batchId,'background não confirmou armazenamento durável');
const batchId=response.batchId;

/* Backpressure: enquanto o Study não ACKar, o runner deve enxergar pending=true. */
let state=await runtimeMessage({kind:'tec-reconstruct-batch-state',requestId:'r1',batchId},tabId);
ok(state?.ok===true&&state?.pending===true&&state?.persisted===false,'barreira não detectou lote ainda não persistido');

response=await runtimeMessage({kind:'tec-reconstruct-complete',requestId:'r1',summary:{processed:1,total:1,failedQuestions:0,tecAccount:'tec_a'}},tabId);
ok(response?.ok===true,'fim do scanner não foi aceito');
jobs=store.snmTecReconstructJobsV1;
ok(jobs.jobs.r1.status==='awaiting-persistence','job foi concluído antes do ACK do Study');
ok(store.snmTecReconstructBatchesV1?.byRequest?.r1?.[batchId],'lote sumiu quando Study estava desconectado');

/* Reconexão: resync precisa reenviar o lote e ACK precisa concluir o job. */
const p2=makePort();connectListeners[0](p2);
p2.send({type:'reconstruct-resync',payload:{context:ctx}});
await sleep(20);
const replay=p2.posted.find(x=>x.kind==='tec-reconstruct-batch'&&x.payload?.batchId===batchId);
ok(!!replay,'lote pendente não foi reenviado após reconexão');
p2.send({type:'reconstruct-batch-ack',payload:{requestId:'r1',batchId,context:ctx}});
await sleep(30);
jobs=store.snmTecReconstructJobsV1;
ok(jobs.jobs.r1.status==='complete','job não concluiu depois do ACK persistente');
ok(!store.snmTecReconstructBatchesV1?.byRequest?.r1,'lote ACKado não foi removido da fila durável');
ok(p2.posted.some(x=>x.kind==='tec-reconstruct-result'&&x.payload?.status==='complete'),'resultado final não foi entregue após ACK');

/* Após ACK, a mesma sonda libera o runner imediatamente. */
state=await runtimeMessage({kind:'tec-reconstruct-batch-state',requestId:'r1',batchId},tabId);
ok(state?.ok===true&&state?.pending===false&&state?.persisted===true,'barreira não liberou lote depois do ACK');

/* Reset é estritamente da reconstrução: jobs/lotes somem e fatos gerais ficam fora do escopo. */
store.snmTecReconstructJobsV1={version:1,jobs:{}};
store.snmTecReconstructBatchesV1={version:1,byRequest:{}};
store.snmTecQueueV1={sentinel:true};
const reset=await runtimeMessage({kind:'tec-reconstruct-reset-all'},7,'https://studynomentor.github.io/StudyNoMentor/');
ok(reset?.ok===true,'reset de reconstrução falhou');
ok(!store.snmTecReconstructJobsV1&&!store.snmTecReconstructBatchesV1,'reset não limpou jobs/lotes de reconstrução');
ok(store.snmTecQueueV1?.sentinel===true,'reset apagou fila factual que não pertence à reconstrução');

console.log('TEC RECONSTRUÇÃO DURÁVEL V2: armazenamento → backpressure → replay → ACK → liberação → reset isolado validados.');
