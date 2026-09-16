/* ============================================================================
   TEC CLOUD LEDGER V2 — SNAPSHOT IMUTÁVEL + CURSOR INCREMENTAL
   ----------------------------------------------------------------------------
   Carrega depois do ledger original e endurece os contratos sem duplicar sua
   infraestrutura de realtime/retry:
   · insert-or-ignore por (profile_id,event_id): fato histórico não é reescrito;
   · backfill antigo nunca reconstrói uma tentativa usando a Biblioteca atual;
   · proveniência/confiança viram colunas de primeira classe;
   · pull periódico baixa somente o delta depois do cursor created_at/event_id.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecCloudLedgerV2) return;
  const C=window.TecCloudLedger;
  if (!C) return;
  window.__tecCloudLedgerV2=true;

  const CURSOR_SUFFIX='tec-cloud-ledger:cursor-v2';
  const PAGE_SIZE=1000;
  const quiet=(e,ctx)=>{ try { if (typeof _quiet==='function') _quiet(e,ctx); } catch (_) {} };
  const fnv=value=>{ let h=2166136261; const s=String(value||''); for (let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0).toString(36); };

  function cursorKey() {
    try { return DB._profilePrefix()+CURSOR_SUFFIX; }
    catch (_) { return 'diario-estudos:'+CURSOR_SUFFIX; }
  }
  function readCursor() {
    try {
      const c=JSON.parse(localStorage.getItem(cursorKey())||'null');
      return c&&c.at&&c.eventId?c:null;
    } catch (_) { return null; }
  }
  function writeCursor(c) {
    if (!c||!c.at||!c.eventId) return false;
    try { localStorage.setItem(cursorKey(),JSON.stringify({schema:2,at:String(c.at),eventId:String(c.eventId),savedAt:new Date().toISOString()})); return true; }
    catch (e) { quiet(e,'tec-ledger-cursor-save'); return false; }
  }
  function afterCursor(row,c) {
    if (!c) return true;
    const at=String(row&&row.created_at||'');
    return at>String(c.at) || (at===String(c.at)&&String(row&&row.event_id||'')>String(c.eventId));
  }
  function trustFor(ev,payload) {
    try {
      const G=window.TecTrustGate;
      const source=ev&&ev.integrity?ev:(payload&&payload.question||ev);
      const c=G&&G.classify?G.classify(source):null;
      if (c&&c.trusted) return {status:'verified',confidence:'high'};
      const integ=ev&&ev.integrity||payload&&payload.integrity||payload&&payload.question&&payload.question.integrity||{};
      return {status:String(integ.status||'legacy-unverified'),confidence:integ.confidence||null};
    } catch (_) { return {status:'legacy-unverified',confidence:null}; }
  }

  /* Backfill factual: somente aquilo que o próprio evento contém. A versão
     anterior consultava a Biblioteca MUTÁVEL e podia anexar a uma tentativa
     antiga a alternativa/enunciado de uma resolução posterior. */
  C.payloadForEvent=function(ev) {
    if (!ev) return null;
    const integ=ev.integrity||null, prov=ev.provenance||{};
    return {
      tecAccount:ev.tecAccount||'',bookId:ev.bookId||'',capturedAt:ev.resolvedAt,
      resolution:{...ev,eventId:ev.eventId,integrity:integ},
      question:{
        id:ev.questionId,cadernoId:ev.bookId,materia:ev.materia||'',assunto:ev.assunto||'',banca:ev.banca||'',concurso:ev.concurso||'',
        marcada:ev.marcada||null,correta:ev.correta||null,acertou:ev.acertou,capturadoEm:ev.resolvedAt,dataResolucao:ev.localDate||null,
        alternativas:[],integrity:integ
      },
      provenance:prov,integrity:integ,history:null,transport:'cloud-ledger-backfill-v2'
    };
  };

  const baseRowFrom=C.rowFrom.bind(C);
  C.rowFrom=function(payload,eventId) {
    const row=baseRowFrom(payload,eventId); if (!row) return row;
    const ev=this.normalizePayload(payload,eventId); if (!ev) return row;
    const prov=payload&&payload.provenance||ev.provenance||{};
    const trust=trustFor(ev,payload);
    row.trust_status=trust.status;
    row.confidence=trust.confidence;
    row.capture_engine_version=prov.captureEngineVersion||null;
    row.companion_version=prov.companionVersion||payload&&payload.__extensionVersion||null;
    row.site_build=prov.siteBuild||null;
    row.device_id=prov.deviceId||null;
    row.tab_session_id=prov.tabSessionId||null;
    row.capture_strategy=prov.captureStrategy||null;
    row.evidence_hash=fnv(JSON.stringify({eventId:ev.eventId,questionId:ev.questionId,resolvedAt:ev.resolvedAt,marcada:ev.marcada,correta:ev.correta,acertou:ev.acertou,integrity:ev.integrity||null}));
    /* updated_at deixa de carregar semântica: evento factual não sofre update. */
    delete row.updated_at;
    return row;
  };

  C.pushPayload=async function(payload,eventId) {
    if (!this.ready()) return false;
    const row=this.rowFrom(payload,eventId); if (!row) return false;
    this.markPending(row.event_id);
    try {
      const {error}=await CloudStore.client.from('tec_resolution_events').upsert(row,{onConflict:'profile_id,event_id',ignoreDuplicates:true});
      if (error) throw error;
      this.unmarkPending(row.event_id); this._pushed++; this._lastError=null; return true;
    } catch (e) {
      this._lastError=(e&&(e.message||e.code))||String(e); this.scheduleRetry(); return false;
    }
  };

  C.upsertRows=async function(rows) {
    const clean=(rows||[]).filter(Boolean); if (!clean.length) return 0;
    let sent=0;
    for (let i=0;i<clean.length;i+=150) {
      const batch=clean.slice(i,i+150);
      const {error}=await CloudStore.client.from('tec_resolution_events').upsert(batch,{onConflict:'profile_id,event_id',ignoreDuplicates:true});
      if (error) throw error;
      sent+=batch.length;
    }
    this._pushed+=sent; return sent;
  };

  C.fetchAll=async function() {
    if (!this.ready()) return [];
    const pid=this.profileId(), cursor=readCursor(), out=[];
    let offset=0;
    for (;;) {
      let query=CloudStore.client.from('tec_resolution_events')
        .select('event_id,tec_account,book_id,question_id,resolved_at,local_date,acertou,marcada,correta,materia,assunto,banca,concurso,source,payload,created_at,trust_status,confidence,capture_engine_version,companion_version,site_build,device_id,tab_session_id,capture_strategy,evidence_hash')
        .eq('profile_id',pid);
      if (cursor) query=query.gte('created_at',cursor.at);
      const {data,error}=await query.order('created_at',{ascending:true}).order('event_id',{ascending:true}).range(offset,offset+PAGE_SIZE-1);
      if (error) throw error;
      const part=data||[];
      out.push(...part.filter(row=>afterCursor(row,cursor)));
      if (part.length<PAGE_SIZE) break;
      offset+=PAGE_SIZE;
    }
    this._cursorCandidate=out.length?{at:String(out[out.length-1].created_at||''),eventId:String(out[out.length-1].event_id||'')}:null;
    return out;
  };

  const originalMergeRows=C.mergeRows.bind(C);
  C.mergeRows=function(rows) {
    const result=originalMergeRows(rows);
    if (this._cursorCandidate) {
      writeCursor(this._cursorCandidate);
      this._cursorCandidate=null;
    }
    return result;
  };

  const originalStatus=C.status.bind(C);
  C.status=function() { return {...originalStatus(),cursor:readCursor(),mode:'immutable-incremental-v2'}; };

  /* bookkeeping do cursor é local por definição. */
  try {
    const S=window.SectionSync;
    if (S&&!S.__tecCursorLocalV2) {
      S.__tecCursorLocalV2=true;
      const original=S.sectionForKey.bind(S);
      S.sectionForKey=function(fullKey,prefixo) {
        const sec=original(fullKey,prefixo);
        return String(sec||'')===CURSOR_SUFFIX?null:sec;
      };
    }
  } catch (e) { quiet(e,'tec-ledger-cursor-local'); }
})();
