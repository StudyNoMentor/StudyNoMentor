/* ============================================================================
   TEC — GUARDA DE RECONCILIAÇÃO V3
   ----------------------------------------------------------------------------
   Endurece o reconciliador multidispositivo sem alterar os fatos de entrada:
   · nunca muta o payload entregue pelo Companion;
   · não confia em canonicalAttemptKey herdada/stale de um objeto reutilizado;
   · duas tentativas exatas só são equivalentes numa janela conservadora de 5 s;
   · reconstrução diária do Gabarito continua reconciliando a última tentativa
     compatível daquele dia;
   · repetição sem mudança factual não regrava o evento só por bookkeeping.
   ============================================================================ */
(() => {
  const API = window.TecReconciliationV3;
  if (!API || window.__tecReconciliationGuardV3) return;
  window.__tecReconciliationGuardV3 = true;

  const TOLERANCE_MS = 5000;
  const text = v => String(v == null ? '' : v).trim();
  const letter = v => { const m=text(v).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/); return m ? m[1] : null; };
  const time = ev => { const n=new Date(ev&&ev.resolvedAt||'').getTime(); return Number.isFinite(n)?n:null; };
  const precision = ev => API.precisionOf(ev);
  const day = ev => API.localDateFrom(ev&&ev.resolvedAt, ev&&ev.localDate);
  const quiet = (e,ctx) => { try { if (typeof _quiet === 'function') _quiet(e,ctx); } catch (_) { void 0; } };

  function factual(ev) {
    if (!ev) return '';
    return JSON.stringify({
      eventId:text(ev.eventId), bookId:text(ev.bookId), questionId:text(ev.questionId),
      acertou:typeof ev.acertou==='boolean'?ev.acertou:null, marcada:letter(ev.marcada), correta:letter(ev.correta),
      resolvedAt:text(ev.resolvedAt), localDate:day(ev), datePrecision:precision(ev), dateSource:text(ev.dateSource),
      tecAccount:text(ev.tecAccount), accountConfidence:text(ev.accountConfidence), resolutionRef:API.resolutionRef(ev),
      materia:text(ev.materia), assunto:text(ev.assunto), banca:text(ev.banca), concurso:text(ev.concurso),
      integrity:ev.integrity||null
    });
  }

  function strictFindMatch(events,incoming) {
    const rows=(events||[]).filter(Boolean);
    const key=text(incoming&&incoming.canonicalAttemptKey || API.canonicalKey(incoming));
    if (key) {
      const exact=rows.find(x=>text(x.canonicalAttemptKey)===key && API.accountsCompatible(x,incoming));
      if (exact) return exact;
    }
    const ref=API.resolutionRef(incoming);
    if (ref) {
      const byRef=rows.find(x=>API.resolutionRef(x)===ref && text(x.bookId)===text(incoming.bookId) && text(x.questionId)===text(incoming.questionId) && API.accountsCompatible(x,incoming));
      if (byRef) return byRef;
    }
    const d=day(incoming); if(!d) return null;
    const candidates=rows.filter(old=>API.signatureCompatible(old,incoming) && day(old)===d);
    if(!candidates.length) return null;
    if(precision(incoming)==='instant') {
      const it=time(incoming);
      if(it!=null) {
        const close=candidates.map(old=>({old,dt:time(old)==null?Infinity:Math.abs(time(old)-it)}))
          .filter(x=>x.dt<=TOLERANCE_MS).sort((a,b)=>a.dt-b.dt);
        if(close.length) return close[0].old;
        /* Se ambos os lados têm horário real e estão além da janela, são fatos
           distintos — mesmo que alternativa/resultado coincidam. */
        if(candidates.every(old=>precision(old)==='instant')) return null;
      }
    }
    /* Sem horário individual verificável, o Gabarito representa a última
       resolução compatível do dia; nunca colapsamos as demais linhas. */
    return candidates.sort((a,b)=>(time(b)||0)-(time(a)||0))[0]||null;
  }
  API.strictFindMatch=strictFindMatch;
  API.STRICT_INSTANT_TOLERANCE_MS=TOLERANCE_MS;

  function cloneIncoming(payload) {
    const copy={...(payload&&typeof payload==='object'?payload:{})};
    copy.resolution={...(copy.resolution||{})};
    copy.provenance={...(copy.provenance||{})};
    /* A identidade canônica é sempre recalculada a partir dos fatos atuais.
       Isso evita que um objeto reutilizado herde a chave da resolução anterior. */
    delete copy.resolution.canonicalAttemptKey;
    delete copy.resolution.canonical_attempt_key;
    delete copy.provenance.canonicalAttemptKey;
    delete copy.provenance.canonical_attempt_key;
    return copy;
  }

  function installRealtime() {
    const R=window.TecRealtime;
    if(!R||R.__reconciliationGuardV3)return;
    R.__reconciliationGuardV3=true;
    R.ingest=function(payload,messageId){
      const copy=cloneIncoming(payload);
      let candidate;
      try{candidate=R.normalize(copy);}catch(e){quiet(e,'tec-reconcile-guard-normalize');return{ok:false,reason:'invalid'};}
      if(!candidate)return{ok:false,reason:'invalid'};
      const state=R.state(),match=strictFindMatch(Object.values(state.events||{}),candidate);
      const key=match&&match.canonicalAttemptKey || candidate.canonicalAttemptKey || API.canonicalKey(candidate);
      if(match)copy.resolution.eventId=match.eventId;
      else if(key)copy.resolution.eventId='tec_'+R.hash(key);
      copy.resolution.canonicalAttemptKey=key;
      copy.resolution.datePrecision=candidate.datePrecision;
      copy.resolution.dateSource=candidate.dateSource;
      copy.provenance={...copy.provenance,canonicalAttemptKey:key,datePrecision:candidate.datePrecision,dateSource:candidate.dateSource,reconciliationVersion:API.VERSION};

      const ev=R.normalize(copy); if(!ev)return{ok:false,reason:'invalid'};
      const existing=state.events[ev.eventId] || strictFindMatch(Object.values(state.events||{}),ev);
      let stored=ev;
      if(existing){
        const merged=API.mergeEvent(existing,ev);
        if(factual(merged)!==factual(existing)) state.events[existing.eventId]=stored=merged;
        else stored=existing;
      }else state.events[ev.eventId]=stored=ev;

      state.lastEventAt=stored.receivedAt||ev.receivedAt;
      state.connection={...(state.connection||{}),status:'connected',account:stored.tecAccount,bookId:stored.bookId,lastSeenAt:new Date().toISOString()};
      if(!R.save(state))return{ok:false,reason:'save'};
      R.rememberQuestion(copy,stored);
      R.ack(messageId||stored.eventId);
      R.render();
      return{ok:true,event:stored,duplicate:!!existing};
    };
  }

  function installReconstruction() {
    const H=window.TecHistoricalReconstruction;
    if(!H||H.__reconciliationGuardV3)return;
    H.__reconciliationGuardV3=true;
    H.equivalentIn=function(rows,ev){
      const match=strictFindMatch(rows,ev); if(!match)return false;
      const merged=API.mergeEvent(match,ev),changed=factual(merged)!==factual(match),ctx=window.__tecReconcileContext;
      if(changed)Object.assign(match,merged);
      if(ctx){
        if(changed){ctx.updated++;ctx.dirty=true;ctx.cloudKnown.push(match);}
        else{ctx.known++;ctx.skipped++;}
      }
      return true;
    };
  }

  function installCloud() {
    const C=window.TecCloudLedger;
    if(!C||C.__reconciliationGuardV3)return;
    C.__reconciliationGuardV3=true;
    C.findSemantic=async function(row){
      if(!row||!this.ready()||!row.book_id||!row.question_id||!row.local_date)return null;
      const {data,error}=await CloudStore.client.from('tec_resolution_events').select('*')
        .eq('profile_id',this.profileId()).eq('book_id',row.book_id).eq('question_id',row.question_id).eq('local_date',row.local_date).limit(50);
      if(error)throw error;
      const toEvent=x=>{
        const p=x&&x.payload||{},r=p.resolution||{};
        return{eventId:x&&x.event_id,bookId:x&&x.book_id,questionId:x&&x.question_id,resolvedAt:x&&x.resolved_at,localDate:x&&x.local_date,
          acertou:x&&x.acertou,marcada:x&&x.marcada,correta:x&&x.correta,tecAccount:x&&x.tec_account,
          accountConfidence:r.accountConfidence||p.tecAccountConfidence||p.provenance&&p.provenance.accountConfidence||null,
          canonicalAttemptKey:x&&x.canonical_attempt_key||r.canonicalAttemptKey||null,resolutionRef:x&&x.resolution_ref||r.resolutionRef||null,
          datePrecision:x&&x.date_precision||r.datePrecision||null,dateSource:x&&x.date_source||r.dateSource||null};
      };
      const rows=data||[],match=strictFindMatch(rows.map(toEvent),toEvent(row));
      return match?rows.find(x=>text(x.event_id)===text(match.eventId))||null:null;
    };
  }

  function install(){try{installRealtime();installReconstruction();installCloud();}catch(e){quiet(e,'tec-reconciliation-guard-install');}}
  install();
  setTimeout(install,1200);
})();
