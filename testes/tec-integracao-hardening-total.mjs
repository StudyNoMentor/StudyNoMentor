import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/js/99n-tec-integracao-auditoria-total.js',import.meta.url),'utf8');
const storage=new Map(),posted=[];
let savedManager={books:{'10':{bookId:'10',sources:[]}},runs:{}},ingests=0,started=0,status='';
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
const H={
  companionVersion:()=> '1.4.0',
  context:()=>({userId:'u1',profileId:'p1'}),
  setStatus:v=>{status=v;},
  start(){started++;return true;},
  ingestBatch(payload){ingests++;return{questions:(payload.rows||[]).length,events:1,aggregateAttempts:3,undatedAttempts:0,unverifiableAttempts:0,account:payload.tecAccount,bookId:payload.bookId};}
};
const M={
  state:()=>JSON.parse(JSON.stringify(savedManager)),
  save:st=>{savedManager=JSON.parse(JSON.stringify(st));return true;},
  render(){},
  snapshotFromLocal:id=> id==='10'?{'1':{questionId:'1',latest:{data:'15/09/2026'},history:{total:3,acertos:2,erros:1}}}:{},
  digestSnapshot:s=>JSON.stringify(s),
  compareSnapshots:(a,b)=>({exact:JSON.stringify(a)===JSON.stringify(b)}),
  removeLocalBook(id){const st=this.state();st.books[id]=st.books[id]||{bookId:id};st.books[id].suppressed=true;this.save(st);return true;},
  beginRun(requestId,bookId,mode){const st=this.state(),run={requestId,bookId,mode,baseline:{},baselineDigest:'{}'};st.runs[requestId]=run;this.save(st);return run;}
};
const context={
  console,Date,Math,JSON,Promise,Number,String,Array,Object,Map,Set,RegExp,
  localStorage,location:{origin:'https://studynomentor.github.io'},
  DB:{_profilePrefix:()=> 'test:'},
  document:{addEventListener:()=>{}},
  window:{TecHistoricalReconstruction:H,TecHistoricalManager:M,addEventListener:()=>{},postMessage:m=>posted.push(m)}
};
vm.createContext(context);vm.runInContext(source,context,{filename:'99n-tec-integracao-auditoria-total.js'});

const ok=(cond,msg)=>{if(!cond)throw new Error(msg);};

/* Protocolo mínimo: Companion antigo nunca inicia uma reconstrução sem ACK durável. */
H.companionVersion=()=> '1.3.0';
ok(H.start()===false&&started===0&&/1\.4\.0/.test(status),'Companion antigo não foi bloqueado');
H.companionVersion=()=> '1.4.0';
ok(H.start()===true&&started===1,'Companion 1.4 não iniciou');

/* Lote só é ACKado após persistência e replay é idempotente. */
const payload={requestId:'r1',batchId:'b1',bookId:'10',tecAccount:'tec_a',rows:[{questionId:'1'}]};
let stats=H.ingestBatch(payload,{});
ok(ingests===1&&stats.questions===1,'primeiro lote não foi persistido');
ok(posted.some(x=>x.type==='tec-reconstruct-batch-ack'&&x.payload.batchId==='b1'),'ACK não foi emitido após persistência');
stats=H.ingestBatch(payload,{});
ok(ingests===1&&stats.questions===0,'replay do mesmo lote duplicou dados/estatísticas');

/* Datas semanticamente iguais não podem gerar divergência artificial. */
const a={'1':{questionId:'1',latest:{data:'15/09/2026'},history:{total:3}}};
const b={'1':{questionId:'1',latest:{data:'2026-09-15T12:00:00'},history:{total:3}}};
ok(M.compareSnapshots(a,b).exact===true,'formatos equivalentes de data viraram divergência');
ok(M.digestSnapshot(a)===M.digestSnapshot(b),'digest não normalizou datas equivalentes');

/* Antes de apagar um caderno, snapshot auditável precisa ser arquivado; a
   próxima validação usa esse arquivo como baseline quando o local está vazio. */
ok(M.removeLocalBook('10',{skipConfirm:true})===true,'remoção local falhou');
let st=M.state();
ok(!!st.books['10'].archivedSnapshot&&!!st.books['10'].archivedDigest,'snapshot pré-remoção não foi arquivado');
M.snapshotFromLocal=()=>({});
const run=M.beginRun('restore-10','10','validation');
ok(Object.keys(run.baseline||{}).length===1&&run.baselineSource==='archive-before-removal','restauração não reutilizou snapshot arquivado');

console.log('TEC AUDITORIA TOTAL: ACK durável/idempotente + datas canônicas + arquivo pré-remoção validados.');
