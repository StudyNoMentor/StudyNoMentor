/* ============================================================================
   TEC — RECONCILIAÇÃO MULTIDISPOSITIVO V3
   ----------------------------------------------------------------------------
   Consolida captura ao vivo + reconstrução de caderno como UMA base factual:
   · identidade canônica por conta/caderno/questão/data/evidência;
   · reconstrução repetida é idempotente;
   · captura feita no PC e depois reconstruída não duplica;
   · questões feitas em celular/outro dispositivo entram na próxima reconstrução;
   · conta desconhecida nunca cria uma barreira artificial de deduplicação;
   · contas comprovadamente diferentes nunca são fundidas;
   · data oficial do TEC enriquece a captura sem trocar um horário exato por meio-dia;
   · o ledger cloud reconcilia o mesmo fato mesmo quando o event_id veio de outra fonte.

   Quando o TEC só informa o DIA e existem várias tentativas idênticas naquele
   dia, não inventamos timestamps. O evento individual fica conservador e o
   histórico agregado do TEC segue como fonte de verdade para total/acertos/erros.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecReconciliationV3) return;
  window.__tecReconciliationV3 = true;

  const VERSION = 3;
  const INSTANT_TOLERANCE_MS = 30000;
  const UNKNOWN_ACCOUNTS = new Set(['','conta','conta-importada','conta-reconstruida','conta-nao-identificada','unknown','desconhecida']);
  const quiet = (e, ctx) => { try { if (typeof _quiet === 'function') _quiet(e, ctx); } catch (_) { void 0; } };
  const now = () => new Date().toISOString();
  const text = v => String(v == null ? '' : v).trim();
  const letter = v => { const m=text(v).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/); return m ? m[1] : null; };
  const hash = value => { let h=2166136261; for (const c of String(value||'')) { h^=c.charCodeAt(0); h=Math.imul(h,16777619); } return (h>>>0).toString(36); };
  const clone = value => { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; } };

  function localDateFrom(value, explicit='') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text(explicit))) return text(explicit);
    const raw=text(value);
    let m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    m=raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d=new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function precisionOf(ev) {
    const p=text(ev&&ev.datePrecision || ev&&ev.integrity&&ev.integrity.datePrecision || ev&&ev.provenance&&ev.provenance.datePrecision).toLowerCase();
    if (p==='instant'||p==='day') return p;
    const raw=text(ev&&ev.resolvedAt);
    if (/T\d{2}:\d{2}/.test(raw) && !/T12:00:00(?:\.000)?(?:Z)?$/.test(raw)) return 'instant';
    return 'day';
  }
  function sourceOf(ev) {
    const explicit=text(ev&&ev.dateSource || ev&&ev.provenance&&ev.provenance.dateSource).toLowerCase();
    if (explicit) return explicit;
    const src=text(ev&&ev.source).toLowerCase();
    if (src.includes('reconstruction-history')) return 'tec-history';
    if (src.includes('reconstruction-gabarito')) return 'tec-gabarito';
    if (src.includes('reconstruction')) return 'tec-reconstruction';
    if (src.includes('companion')) return 'client-capture';
    return 'unknown';
  }
  function accountConfidence(ev) {
    return text(ev&&ev.accountConfidence || ev&&ev.provenance&&ev.provenance.accountConfidence || ev&&ev.tecAccountConfidence).toLowerCase();
  }
  function accountStrong(ev) { return accountConfidence(ev)==='strong' && !!text(ev&&ev.tecAccount); }
  function accountUnknownValue(value) {
    const a=text(value).toLowerCase();
    return !a || UNKNOWN_ACCOUNTS.has(a) || a.startsWith('unknown_') || a.startsWith('session-random');
  }
  function accountsCompatible(a,b) {
    if (!accountStrong(a) || !accountStrong(b)) return true;
    return text(a.tecAccount)===text(b.tecAccount);
  }
  function signatureCompatible(a,b) {
    if (!a||!b) return false;
    if (text(a.bookId)!==text(b.bookId) || text(a.questionId)!==text(b.questionId)) return false;
    if (typeof a.acertou==='boolean' && typeof b.acertou==='boolean' && a.acertou!==b.acertou) return false;
    const am=letter(a.marcada),bm=letter(b.marcada),ac=letter(a.correta),bc=letter(b.correta);
    if (am&&bm&&am!==bm) return false;
    if (ac&&bc&&ac!==bc) return false;
    return accountsCompatible(a,b);
  }
  function resolutionRef(ev) { return text(ev&&ev.resolutionRef || ev&&ev.resolution_ref || ev&&ev.provenance&&ev.provenance.resolutionRef); }
  function accountScope(ev) { return accountStrong(ev) ? `acct:${text(ev.tecAccount)}` : 'acct:*'; }
  function canonicalKey(ev) {
    if (!ev || !text(ev.bookId) || !text(ev.questionId)) return null;
    const book=text(ev.bookId),qid=text(ev.questionId),ref=resolutionRef(ev),scope=accountScope(ev);
    if (ref) return `v3|${scope}|book:${book}|q:${qid}|ref:${ref}`;
    const day=localDateFrom(ev.resolvedAt,ev.localDate);
    if (!day) return null;
    const sig=[ev.acertou===true?'1':ev.acertou===false?'0':'?',letter(ev.marcada)||'',letter(ev.correta)||''].join(':');
    if (precisionOf(ev)==='instant') {
      const d=new Date(ev.resolvedAt);
      if (!Number.isNaN(d.getTime())) return `v3|${scope}|book:${book}|q:${qid}|instant:${d.toISOString()}|sig:${sig}`;
    }
    return `v3|${scope}|book:${book}|q:${qid}|day:${day}|sig:${sig}`;
  }
  function eventTime(ev) { const t=new Date(ev&&ev.resolvedAt||'').getTime(); return Number.isFinite(t)?t:null; }
  function findMatch(events,incoming) {
    const rows=(events||[]).filter(Boolean);
    const key=text(incoming&&incoming.canonicalAttemptKey || canonicalKey(incoming));
    if (key) {
      const exact=rows.find(x=>text(x.canonicalAttemptKey)===key && accountsCompatible(x,incoming));
      if (exact) return exact;
    }
    const ref=resolutionRef(incoming);
    if (ref) {
      const byRef=rows.find(x=>resolutionRef(x)===ref && text(x.bookId)===text(incoming.bookId) && text(x.questionId)===text(incoming.questionId) && accountsCompatible(x,incoming));
      if (byRef) return byRef;
    }
    const day=localDateFrom(incoming&&incoming.resolvedAt,incoming&&incoming.localDate);
    if (!day) return null;
    const candidates=rows.filter(old=>signatureCompatible(old,incoming) && localDateFrom(old.resolvedAt,old.localDate)===day);
    if (!candidates.length) return null;
    const ip=precisionOf(incoming),it=eventTime(incoming);
    if (ip==='instant' && it!=null) {
      const close=candidates.map(old=>({old,dt:eventTime(old)==null?Infinity:Math.abs(eventTime(old)-it)}))
        .filter(x=>x.dt<=INSTANT_TOLERANCE_MS).sort((a,b)=>a.dt-b.dt);
      if (close.length) return close[0].old;
      if (candidates.every(old=>precisionOf(old)==='instant')) return null;
    }
    /* O Gabarito é a última resolução conhecida do dia: use somente o evento
       compatível mais recente, sem colapsar os demais eventos daquele dia. */
    return candidates.sort((a,b)=>(eventTime(b)||0)-(eventTime(a)||0))[0] || null;
  }
  function trustRank(ev) {
    const s=text(ev&&ev.integrity&&ev.integrity.status).toLowerCase(),c=text(ev&&ev.integrity&&ev.integrity.confidence).toLowerCase();
    return (s==='verified'?30:s==='observed'?20:s==='unverified'?10:0)+(c==='high'?3:c==='medium'?2:c==='low'?1:0);
  }
  function mergeEvent(old,incoming) {
    if (!old) return {...incoming,canonicalAttemptKey:incoming.canonicalAttemptKey||canonicalKey(incoming),reconciliationVersion:VERSION};
    const next={...old}, incomingRank=trustRank(incoming), oldRank=trustRank(old);
    for (const k of ['questionId','bookId','materia','assunto','banca','concurso']) if (!text(next[k])&&text(incoming[k])) next[k]=incoming[k];
    if (!letter(next.marcada)&&letter(incoming.marcada)) next.marcada=letter(incoming.marcada);
    if (!letter(next.correta)&&letter(incoming.correta)) next.correta=letter(incoming.correta);
    if (typeof next.acertou!=='boolean'&&typeof incoming.acertou==='boolean') next.acertou=incoming.acertou;
    const oldStrong=accountStrong(old),newStrong=accountStrong(incoming);
    if ((!oldStrong&&newStrong)||!text(next.tecAccount)||accountUnknownValue(next.tecAccount)) next.tecAccount=incoming.tecAccount||next.tecAccount;
    next.accountConfidence=newStrong?accountConfidence(incoming):(next.accountConfidence||accountConfidence(old)||accountConfidence(incoming)||null);
    const ref=resolutionRef(old)||resolutionRef(incoming); if (ref) next.resolutionRef=ref;

    const oldP=precisionOf(old),newP=precisionOf(incoming),oldDay=localDateFrom(old.resolvedAt,old.localDate),newDay=localDateFrom(incoming.resolvedAt,incoming.localDate);
    if (newP==='instant' && oldP!=='instant') {
      next.resolvedAt=incoming.resolvedAt; next.localDate=newDay; next.datePrecision='instant'; next.dateSource=sourceOf(incoming);
    } else if (newP==='instant' && oldP==='instant' && resolutionRef(incoming) && !resolutionRef(old)) {
      next.resolvedAt=incoming.resolvedAt; next.localDate=newDay; next.datePrecision='instant'; next.dateSource=sourceOf(incoming);
    } else {
      next.localDate=oldDay||newDay||next.localDate;
      next.datePrecision=oldP==='instant'?'instant':newP;
      if (newP==='day'&&newDay&&oldDay===newDay&&oldP==='instant') next.dateSource='client-capture+tec-gabarito';
      else next.dateSource=next.dateSource||sourceOf(old)||sourceOf(incoming);
    }
    if (incomingRank>oldRank) next.integrity=clone(incoming.integrity||next.integrity);
    else if (!next.integrity&&incoming.integrity) next.integrity=clone(incoming.integrity);
    next.provenance={...(old.provenance||{}),...(incoming.provenance||{}),reconciliationVersion:VERSION,reconciledAt:now()};
    /* Uma chave já consolidada não muda por mero enriquecimento de conta/data. */
    next.canonicalAttemptKey=old.canonicalAttemptKey||incoming.canonicalAttemptKey||canonicalKey({...next,localDate:next.localDate});
    next.reconciliationVersion=VERSION; next.reconciledAt=now(); next.receivedAt=incoming.receivedAt||old.receivedAt||now();
    next.eventId=old.eventId||incoming.eventId;
    return next;
  }
  function enrich(ev,extra={}) {
    if (!ev) return ev;
    ev.accountConfidence=ev.accountConfidence||extra.accountConfidence||ev.provenance&&ev.provenance.accountConfidence||null;
    ev.resolutionRef=resolutionRef(ev)||text(extra.resolutionRef)||null;
    ev.datePrecision=precisionOf(ev);
    ev.dateSource=ev.dateSource||extra.dateSource||sourceOf(ev);
    ev.localDate=localDateFrom(ev.resolvedAt,ev.localDate);
    ev.canonicalAttemptKey=ev.canonicalAttemptKey||canonicalKey(ev);
    ev.reconciliationVersion=VERSION;
    ev.provenance={...(ev.provenance||{}),reconciliationVersion:VERSION,datePrecision:ev.datePrecision,dateSource:ev.dateSource,canonicalAttemptKey:ev.canonicalAttemptKey,resolutionRef:ev.resolutionRef||null};
    return ev;
  }

  const API={VERSION,INSTANT_TOLERANCE_MS,localDateFrom,precisionOf,sourceOf,accountStrong,accountsCompatible,signatureCompatible,resolutionRef,canonicalKey,findMatch,mergeEvent,enrich};
  window.TecReconciliationV3=API;

  function patchRealtime() {
    const R=window.TecRealtime;if(!R||R.__reconciliationV3)return;
    R.__reconciliationV3=true;
    const baseNormalize=R.normalize.bind(R),baseIngest=R.ingest.bind(R);
    R.normalize=function(payload){
      const ev=baseNormalize(payload);if(!ev)return ev;
      const raw=payload&&payload.resolution||{},prov=payload&&payload.provenance||{},integ=raw.integrity||payload&&payload.integrity||payload&&payload.question&&payload.question.integrity||{};
      ev.integrity=ev.integrity||integ||null; ev.provenance={...(ev.provenance||{}),...prov};
      ev.accountConfidence=raw.accountConfidence||payload&&payload.tecAccountConfidence||prov.accountConfidence||ev.accountConfidence||null;
      ev.resolutionRef=raw.resolutionRef||raw.resolution_ref||prov.resolutionRef||null;
      ev.datePrecision=raw.datePrecision||integ.datePrecision||prov.datePrecision||ev.datePrecision||null;
      ev.dateSource=raw.dateSource||prov.dateSource||ev.dateSource||null;
      ev.canonicalAttemptKey=raw.canonicalAttemptKey||raw.canonical_attempt_key||prov.canonicalAttemptKey||null;
      return enrich(ev);
    };
    R.mergeEvent=function(old,ev){
      const merged=mergeEvent(old,ev);
      if (window.__tecReconcileContext && JSON.stringify(merged)!==JSON.stringify(old||{})) window.__tecReconcileContext.dirty=true;
      return merged;
    };
    R.ingest=function(payload,messageId){
      try{
        const candidate=R.normalize(payload);
        if(candidate){
          const state=R.state(),match=findMatch(Object.values(state.events||{}),candidate),candidateKey=candidate.canonicalAttemptKey||canonicalKey(candidate),key=match&&match.canonicalAttemptKey||candidateKey;
          payload=payload&&typeof payload==='object'?payload:{};payload.resolution={...(payload.resolution||{})};
          if(match) payload.resolution.eventId=match.eventId;
          else if(key) payload.resolution.eventId=`tec_${hash(key)}`;
          payload.resolution.canonicalAttemptKey=key;payload.resolution.datePrecision=candidate.datePrecision;payload.resolution.dateSource=candidate.dateSource;
          payload.provenance={...(payload.provenance||{}),canonicalAttemptKey:key,datePrecision:candidate.datePrecision,dateSource:candidate.dateSource,reconciliationVersion:VERSION};
        }
      }catch(e){quiet(e,'tec-reconcile-live-preprocess');}
      return baseIngest(payload,messageId);
    };
  }

  function chooseReconstructionAccount(payload) {
    const incoming=text(payload&&payload.tecAccount||'conta-nao-identificada'),conf=text(payload&&payload.tecAccountConfidence||'').toLowerCase();
    if (conf==='strong') return incoming;
    const book=text(payload&&payload.bookId); if(!book)return incoming;
    const accounts=new Set();
    try{const R=window.TecRealtime;for(const e of Object.values(R&&R.state?R.state().events||{}:{}))if(text(e&&e.bookId)===book&&!accountUnknownValue(e&&e.tecAccount))accounts.add(text(e.tecAccount));}catch(e){quiet(e,'tec-reconcile-account-events');}
    try{const T=window.TecIntegracaoScreen;for(const row of Object.values(T&&T.state?T.state().questions||{}:{}))if(text(row&&row.bookId)===book&&!accountUnknownValue(row&&row.tecAccount))accounts.add(text(row.tecAccount));}catch(e){quiet(e,'tec-reconcile-account-library');}
    return accounts.size===1?[...accounts][0]:incoming;
  }

  function patchReconstruction() {
    const H=window.TecHistoricalReconstruction,R=window.TecRealtime;if(!H||!R||H.__reconciliationV3)return;
    H.__reconciliationV3=true;
    const baseMake=H.makeEvent.bind(H),baseIngest=H.ingestBatch.bind(H),baseStart=typeof H.start==='function'?H.start.bind(H):null;
    H.makeEvent=function(args){
      const ev=baseMake(args);if(!ev)return ev;
      const src=text(args&&args.source),ctx=window.__tecReconcileContext,dateSource=src.includes('gabarito')?'tec-gabarito':src.includes('history')?'tec-history':'tec-reconstruction';
      enrich(ev,{dateSource,accountConfidence:ctx&&ctx.accountConfidence||null});
      if(ev.canonicalAttemptKey)ev.eventId=`tec_${hash(ev.canonicalAttemptKey)}`;
      return ev;
    };
    H.equivalentIn=function(rows,ev){
      const match=findMatch(rows,ev);if(!match)return false;
      const before=JSON.stringify(match),merged=mergeEvent(match,ev),changed=JSON.stringify(merged)!==before;
      Object.assign(match,merged);
      const ctx=window.__tecReconcileContext;
      if(ctx){ctx.cloudKnown.push(match);if(changed){ctx.updated++;ctx.dirty=true;}else{ctx.known++;ctx.skipped++;}}
      return true;
    };
    H.ingestBatch=function(payload={},opts={}){
      const originalAccount=text(payload.tecAccount||'conta-nao-identificada'),account=chooseReconstructionAccount(payload),accountConf=text(payload.tecAccountConfidence||'').toLowerCase();
      const effective={...payload,tecAccount:account};
      try{if(window.TecImportManager&&TecImportManager.ensureConservativeHistory)TecImportManager.ensureConservativeHistory(effective);}catch(e){quiet(e,'tec-reconcile-conservative-history');}
      const ctx={dirty:false,updated:0,known:0,skipped:0,cloudKnown:[],originalAccount,account,accountConfidence:accountConf};window.__tecReconcileContext=ctx;
      let out;
      try{out=baseIngest(effective,opts)||{};}finally{window.__tecReconcileContext=null;}
      if(ctx.dirty){try{const st=R.state();R.save(st);R.render();}catch(e){quiet(e,'tec-reconcile-save-updates');}}
      if(ctx.cloudKnown.length){
        try{
          const rows=Array.isArray(effective.rows)?effective.rows:[],byId=new Map(rows.map(x=>[text(x&&x.questionId||x&&x.question&&x.question.id),x]));
          const enriched=ctx.cloudKnown.map(event=>{const row=byId.get(text(event.questionId))||{};return{event,question:row.question||{id:event.questionId,cadernoId:event.bookId},history:row.history||null};});
          H.pushCloud(enriched);
        }catch(e){quiet(e,'tec-reconcile-cloud-known');}
      }
      out.addedEvents=Number(out.events||0);out.updatedEvents=ctx.updated;out.alreadyKnownEvents=ctx.known;out.reconciliationVersion=VERSION;out.account=account;
      try{
        const M=window.TecHistoricalManager,book=text(effective.bookId);
        if(M&&book&&M.touchBook)M.touchBook(book,{lastReconciliation:{at:now(),added:out.addedEvents,updated:ctx.updated,alreadyKnown:ctx.known,accountFrom:originalAccount,accountUsed:account,version:VERSION}});
      }catch(e){quiet(e,'tec-reconcile-book-stats');}
      return out;
    };
    if(baseStart)H.start=function(...args){
      try{const C=window.TecCloudLedger;if(C&&C.ready&&C.ready()&&C.sync)C.sync('pre-reconstruction').catch(e=>quiet(e,'tec-reconcile-pre-sync'));}catch(e){quiet(e,'tec-reconcile-pre-sync');}
      return baseStart(...args);
    };
  }

  function mergeHistory(existing,incoming){
    if(!existing)return incoming;if(!incoming)return existing;
    const et=Number(existing.total||0),it=Number(incoming.total||0),ea=Array.isArray(existing.attempts)?existing.attempts.length:0,ia=Array.isArray(incoming.attempts)?incoming.attempts.length:0;
    return it>et || (it===et&&ia>ea) ? incoming : existing;
  }
  function cloudTrustRank(row){const s=text(row&&row.trust_status),c=text(row&&row.confidence);return(s==='verified'?30:s==='observed'?20:s==='unverified'?10:0)+(c==='high'?3:c==='medium'?2:c==='low'?1:0);}
  function cloudEvent(row){
    const p=row&&row.payload||{},r=p.resolution||{};
    return{eventId:row&&row.event_id,bookId:row&&row.book_id,questionId:row&&row.question_id,resolvedAt:row&&row.resolved_at,localDate:row&&row.local_date,acertou:row&&row.acertou,marcada:row&&row.marcada,correta:row&&row.correta,tecAccount:row&&row.tec_account,accountConfidence:r.accountConfidence||p.tecAccountConfidence||p.provenance&&p.provenance.accountConfidence||null,canonicalAttemptKey:row&&row.canonical_attempt_key||r.canonicalAttemptKey||null,resolutionRef:row&&row.resolution_ref||r.resolutionRef||null,datePrecision:row&&row.date_precision||r.datePrecision||null,dateSource:row&&row.date_source||r.dateSource||null};
  }
  function mergeCloudRow(old,row){
    if(!old)return row;const next={...old,...row,event_id:old.event_id,profile_id:old.profile_id,user_id:old.user_id};
    const oldP=old.payload&&typeof old.payload==='object'?old.payload:{},newP=row.payload&&typeof row.payload==='object'?row.payload:{};
    next.payload={...oldP,...newP,question:{...(oldP.question||{}),...(newP.question||{})},resolution:{...(oldP.resolution||{}),...(newP.resolution||{}),eventId:old.event_id},history:mergeHistory(oldP.history,newP.history)};
    const merged=mergeEvent(cloudEvent(old),cloudEvent(row));
    next.resolved_at=merged.resolvedAt||old.resolved_at;next.local_date=merged.localDate||old.local_date;next.date_precision=merged.datePrecision||old.date_precision;next.date_source=merged.dateSource||old.date_source;
    if(cloudTrustRank(old)>cloudTrustRank(row)){next.trust_status=old.trust_status;next.confidence=old.confidence;next.marcada=old.marcada||row.marcada;next.correta=old.correta||row.correta;next.acertou=old.acertou;}
    next.canonical_attempt_key=old.canonical_attempt_key||row.canonical_attempt_key;next.resolution_ref=old.resolution_ref||row.resolution_ref;next.reconciled_at=now();
    if(next.payload&&next.payload.resolution){next.payload.resolution.eventId=old.event_id;next.payload.resolution.canonicalAttemptKey=next.canonical_attempt_key;}
    return next;
  }

  function patchCloud() {
    const C=window.TecCloudLedger;if(!C||C.__reconciliationV3)return;C.__reconciliationV3=true;
    const baseRow=C.rowFrom.bind(C),baseStatus=C.status.bind(C);
    C.rowFrom=function(payload,eventId){
      const row=baseRow(payload,eventId);if(!row)return row;
      const ev=this.normalizePayload(payload,eventId);if(!ev)return row;enrich(ev);
      row.canonical_attempt_key=ev.canonicalAttemptKey||null;row.resolution_ref=resolutionRef(ev)||null;row.date_precision=precisionOf(ev);row.date_source=sourceOf(ev);row.reconciled_at=now();
      row.payload={...(row.payload||{}),resolution:{...(row.payload&&row.payload.resolution||{}),canonicalAttemptKey:ev.canonicalAttemptKey,resolutionRef:resolutionRef(ev)||null,datePrecision:precisionOf(ev),dateSource:sourceOf(ev),accountConfidence:ev.accountConfidence||null,reconciliationVersion:VERSION},provenance:{...(row.payload&&row.payload.provenance||{}),canonicalAttemptKey:ev.canonicalAttemptKey,resolutionRef:resolutionRef(ev)||null,datePrecision:precisionOf(ev),dateSource:sourceOf(ev),accountConfidence:ev.accountConfidence||null,reconciliationVersion:VERSION}};
      return row;
    };
    C.findCanonical=async function(key){
      if(!key||!this.ready())return null;
      const {data,error}=await CloudStore.client.from('tec_resolution_events').select('*').eq('profile_id',this.profileId()).eq('canonical_attempt_key',key).limit(1);
      if(error)throw error;return data&&data[0]||null;
    };
    C.findSemantic=async function(row){
      if(!row||!this.ready()||!row.book_id||!row.question_id||!row.local_date)return null;
      const {data,error}=await CloudStore.client.from('tec_resolution_events').select('*').eq('profile_id',this.profileId()).eq('book_id',row.book_id).eq('question_id',row.question_id).eq('local_date',row.local_date).limit(50);
      if(error)throw error;const rows=data||[],incoming=cloudEvent(row),match=findMatch(rows.map(cloudEvent),incoming);return match?rows.find(x=>text(x.event_id)===text(match.eventId))||null:null;
    };
    C.pushPayload=async function(payload,eventId){
      if(!this.ready())return false;let row=this.rowFrom(payload,eventId);if(!row)return false;
      this.markPending(row.event_id);
      try{
        let existing=row.canonical_attempt_key?await this.findCanonical(row.canonical_attempt_key):null;
        if(!existing)existing=await this.findSemantic(row);
        if(existing)row=mergeCloudRow(existing,row);
        let result=await CloudStore.client.from('tec_resolution_events').upsert(row,{onConflict:'profile_id,event_id'});
        if(result.error && String(result.error.code||'')==='23505'){
          existing=row.canonical_attempt_key?await this.findCanonical(row.canonical_attempt_key):null;
          if(!existing)existing=await this.findSemantic(row);
          if(existing){row=mergeCloudRow(existing,row);result=await CloudStore.client.from('tec_resolution_events').upsert(row,{onConflict:'profile_id,event_id'});}
        }
        if(result.error)throw result.error;
        this.unmarkPending(eventId||row.event_id);this.unmarkPending(row.event_id);this._pushed++;this._lastError=null;return true;
      }catch(e){this._lastError=(e&&(e.message||e.code))||String(e);this.scheduleRetry();return false;}
    };
    C.status=function(){return{...baseStatus(),reconciliationVersion:VERSION,canonicalMode:'account-aware-semantic-v3'};};
  }

  function patchAll(){patchRealtime();patchReconstruction();patchCloud();}
  const boot=()=>{try{patchAll();}catch(e){quiet(e,'tec-reconcile-boot');}};
  boot();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  setTimeout(boot,1200);
})();
