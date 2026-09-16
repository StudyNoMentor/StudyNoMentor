/* ============================================================================
   INTEGRAÇÃO TEC — AUDITORIA TOTAL DE CONFIABILIDADE
   ----------------------------------------------------------------------------
   Endurece a reconstrução histórica sem inventar dados:
   · exige Companion compatível com protocolo durável;
   · confirma lote somente depois da persistência local;
   · torna replay de lote idempotente;
   · normaliza datas equivalentes na validação;
   · arquiva snapshot antes de remoção para permitir restauração auditável.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecIntegracaoAuditoriaTotal) return;
  window.__tecIntegracaoAuditoriaTotal = true;

  const MIN_RECON_COMPANION='1.4.0';
  const BATCH_SUFFIX='tec-reconstruct-batches-processed';
  const APP_SOURCE='StudyNoMentorApp';
  const MAX_BATCH_MARKERS=6000;
  const quiet=(e,ctx)=>{try{if(typeof _quiet==='function')_quiet(e,ctx);}catch(ignored){void ignored;}};
  const text=v=>String(v==null?'':v).trim();

  function versionAtLeast(current,minimum){
    const a=String(current||'0').split('.').map(x=>Number(x)||0),b=String(minimum||'0').split('.').map(x=>Number(x)||0);
    for(let i=0;i<Math.max(a.length,b.length);i++){const av=a[i]||0,bv=b[i]||0;if(av>bv)return true;if(av<bv)return false;}
    return true;
  }
  function profileKey(){
    try{return DB._profilePrefix()+BATCH_SUFFIX;}
    catch(e){quiet(e,'tec-reconstruct-batch-key');return'diario-estudos:'+BATCH_SUFFIX;}
  }
  function batchState(){
    try{const st=JSON.parse(localStorage.getItem(profileKey())||'null');return st&&st.schema===1&&st.ids?st:{schema:1,ids:{}};}
    catch(e){quiet(e,'tec-reconstruct-batch-state');return{schema:1,ids:{}};}
  }
  function hasBatch(id){return !!batchState().ids[String(id||'')];}
  function markBatch(id){
    if(!id)return false;
    try{
      const st=batchState();st.ids[String(id)]=Date.now();
      const rows=Object.entries(st.ids).sort((a,b)=>Number(b[1]||0)-Number(a[1]||0)).slice(0,MAX_BATCH_MARKERS);
      st.ids=Object.fromEntries(rows);localStorage.setItem(profileKey(),JSON.stringify(st));return true;
    }catch(e){quiet(e,'tec-reconstruct-batch-mark');return false;}
  }
  function zeroStats(payload={}){return{questions:0,events:0,aggregateAttempts:0,undatedAttempts:0,unverifiableAttempts:0,account:text(payload.tecAccount),bookId:text(payload.bookId)};}
  function postBatchAck(H,payload){
    if(!payload||!payload.requestId||!payload.batchId)return;
    try{
      window.postMessage({source:APP_SOURCE,type:'tec-reconstruct-batch-ack',payload:{requestId:String(payload.requestId),batchId:String(payload.batchId),context:H.context?H.context():null}},location.origin);
    }catch(e){quiet(e,'tec-reconstruct-batch-ack');}
  }

  function canonicalDay(value){
    const raw=text(value);if(!raw)return null;
    let m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(m)return`${m[3]}-${m[2]}-${m[1]}`;
    m=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);if(m)return`${m[1]}-${m[2]}-${m[3]}`;
    const d=new Date(raw);if(Number.isNaN(d.getTime()))return raw;
    return`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  function normalizeSnapshot(snapshot){
    const out={};
    for(const [id,row] of Object.entries(snapshot||{})){
      const copy=JSON.parse(JSON.stringify(row));
      if(copy.latest&&copy.latest.data)copy.latest.data=canonicalDay(copy.latest.data);
      out[id]=copy;
    }
    return out;
  }

  function patchReconstruction(){
    const H=window.TecHistoricalReconstruction;if(!H||H.__auditTotalPatched)return false;
    H.__auditTotalPatched=true;

    if(typeof H.start==='function'){
      const originalStart=H.start.bind(H);
      H.start=function(...args){
        const version=this.companionVersion?this.companionVersion():null;
        if(!version||!versionAtLeast(version,MIN_RECON_COMPANION)){
          if(this.setStatus)this.setStatus(`⚠️ Reconstrução histórica exige StudyNoMentor Companion ${MIN_RECON_COMPANION}+ para garantir persistência durável. Recarregue a extensão em chrome://extensions.`,'warn');
          return false;
        }
        return originalStart(...args);
      };
    }

    if(typeof H.ingestBatch==='function'){
      const originalIngest=H.ingestBatch.bind(H);
      H.ingestBatch=function(payload={},opts={}){
        const batchId=text(payload.batchId);
        if(batchId&&hasBatch(batchId)){
          postBatchAck(this,payload);
          return zeroStats(payload);
        }
        const result=originalIngest(payload,opts);
        if(batchId){
          if(!markBatch(batchId))throw new Error('O lote foi salvo, mas o marcador idempotente não pôde ser persistido. O Companion manterá o lote para nova tentativa.');
          postBatchAck(this,payload);
        }
        return result;
      };
    }
    return true;
  }

  function patchManager(){
    const M=window.TecHistoricalManager;if(!M||M.__auditTotalPatched)return false;
    M.__auditTotalPatched=true;

    if(typeof M.compareSnapshots==='function'){
      const originalCompare=M.compareSnapshots.bind(M);
      M.compareSnapshots=function(localSnapshot,tecSnapshot){return originalCompare(normalizeSnapshot(localSnapshot),normalizeSnapshot(tecSnapshot));};
    }
    if(typeof M.digestSnapshot==='function'){
      const originalDigest=M.digestSnapshot.bind(M);
      M.digestSnapshot=function(snapshot){return originalDigest(normalizeSnapshot(snapshot));};
    }
    if(typeof M.removeLocalBook==='function'){
      const originalRemove=M.removeLocalBook.bind(M);
      M.removeLocalBook=function(bookId,options={}){
        const id=String(bookId||''),snapshot=this.snapshotFromLocal?this.snapshotFromLocal(id):{},digest=this.digestSnapshot?this.digestSnapshot(snapshot):null;
        const result=originalRemove(id,options);
        if(result&&snapshot&&Object.keys(snapshot).length){
          const st=this.state(),book=st.books[id]||{bookId:id,sources:[]};
          book.archivedSnapshot=snapshot;book.archivedDigest=digest;book.archivedAt=new Date().toISOString();book.archiveReason='before-local-removal';
          st.books[id]=book;this.save(st);if(this.render)this.render();
        }
        return result;
      };
    }
    if(typeof M.beginRun==='function'){
      const originalBegin=M.beginRun.bind(M);
      M.beginRun=function(requestId,bookId,mode='reconstruction'){
        let run=originalBegin(requestId,bookId,mode);if(!run)return run;
        if(Object.keys(run.baseline||{}).length)return run;
        const st=this.state(),book=st.books[String(bookId||'')],archive=book&&book.archivedSnapshot;
        if(!archive||!Object.keys(archive).length)return run;
        const saved=JSON.parse(JSON.stringify(archive));
        run={...run,baseline:saved,baselineDigest:this.digestSnapshot(saved),baselineSource:'archive-before-removal'};
        st.runs[String(requestId)]=run;this.save(st);return run;
      };
    }
    return true;
  }

  function patchAll(){patchReconstruction();patchManager();}
  patchAll();
  window.addEventListener('screen:activated',e=>{if(e.detail&&e.detail.screen==='integracaotec')patchAll();});
  document.addEventListener('DOMContentLoaded',patchAll,{once:true});
})();
