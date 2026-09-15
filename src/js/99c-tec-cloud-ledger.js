/* ============================================================
   TEC CLOUD LEDGER — memória factual entre dispositivos
   ------------------------------------------------------------
   O estado agregado do TEC continua local para UX rápida, mas cada resolução
   também é persistida como uma LINHA imutável/identificável no Supabase.

   Motivação: mapas inteiros em localStorage são bons para leitura local, porém
   não são um formato seguro de merge entre dois PCs. Um navegador recém-aberto
   pode ter events={} e, ao apenas atualizar o status da conexão, publicar esse
   objeto vazio sobre uma cópia remota com histórico. O ledger abaixo elimina
   essa classe de perda: dispositivos fazem UNION por event_id.

   A mesma tabela carrega o payload completo da resolução quando disponível,
   inclusive os dados da questão. Assim a Biblioteca TEC também é reconstruída
   em outra máquina, sem depender de filtro/caderno novo no TEC.
   ============================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecCloudLedger) return;
  window.__tecCloudLedger = true;

  const TABLE = 'tec_resolution_events';
  const PAGE_SIZE = 1000;
  const PENDING_SUFFIX = 'tec-cloud-ledger:pendentes-v1';
  const BACKFILL_SUFFIX = 'tec-cloud-ledger:backfill-v1';
  const LEGACY_SECTIONS = new Set(['tec-realtime:eventos-v1', 'tec-integracao:estado-v2']);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const C = {
    _syncing: false,
    _applying: false,
    _patched: false,
    _channel: null,
    _channelProfile: null,
    _lastProfile: null,
    _timer: null,
    _retryTimer: null,
    _lastSyncAt: null,
    _lastError: null,
    _pulled: 0,
    _pushed: 0,

    profileId() {
      try { return window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null; }
      catch (_) { return null; }
    },
    userId() {
      try { return window.CloudStore && CloudStore.session && CloudStore.session.user ? CloudStore.session.user.id : null; }
      catch (_) { return null; }
    },
    ready() {
      return !!(this.profileId() && this.userId() && window.CloudStore && CloudStore.client && CloudStore.isLoggedIn && CloudStore.isLoggedIn());
    },
    prefix() {
      try { return DB._profilePrefix(); } catch (_) { return 'diario-estudos:'; }
    },
    pendingKey() { return this.prefix() + PENDING_SUFFIX; },
    backfillKey() { return this.prefix() + BACKFILL_SUFFIX; },
    loadPending() {
      try { const x=JSON.parse(localStorage.getItem(this.pendingKey())||'[]'); return new Set(Array.isArray(x)?x.map(String):[]); }
      catch (_) { return new Set(); }
    },
    savePending(set) {
      try {
        const a=[...set].slice(-50000);
        if (a.length) localStorage.setItem(this.pendingKey(),JSON.stringify(a));
        else localStorage.removeItem(this.pendingKey());
      } catch (e) { if (typeof _quiet==='function') _quiet(e,'tec-cloud-pending'); }
    },
    markPending(eventId) { if (!eventId) return; const s=this.loadPending(); s.add(String(eventId)); this.savePending(s); },
    unmarkPending(eventId) { if (!eventId) return; const s=this.loadPending(); s.delete(String(eventId)); this.savePending(s); },

    realtime() { return window.TecRealtime || null; },
    library() { return window.TecIntegracaoScreen || null; },

    localEvent(eventId) {
      const R=this.realtime(); if (!R) return null;
      const st=R.state(); return st&&st.events?st.events[String(eventId)]||null:null;
    },
    libraryRow(ev) {
      const T=this.library(); if (!T || !ev) return null;
      try {
        return Object.values(T.state().questions||{}).find(row=>{
          const q=row&&row.question||{};
          return String(q.id||'')===String(ev.questionId||'') &&
            String(row.tecAccount||'')===String(ev.tecAccount||'') &&
            String(row.bookId||'')===String(ev.bookId||'');
        }) || null;
      } catch (_) { return null; }
    },
    payloadForEvent(ev) {
      if (!ev) return null;
      const row=this.libraryRow(ev), q=row&&row.question;
      return {
        tecAccount:ev.tecAccount||'', bookId:ev.bookId||'', capturedAt:ev.resolvedAt,
        resolution:{ ...ev, eventId:ev.eventId },
        question:q ? { ...q } : {
          id:ev.questionId, cadernoId:ev.bookId, materia:ev.materia||'', assunto:ev.assunto||'', banca:ev.banca||'', concurso:ev.concurso||'',
          marcada:ev.marcada||null, correta:ev.correta||null, acertou:ev.acertou, capturadoEm:ev.resolvedAt, dataResolucao:ev.localDate||null
        },
        history:row&&row.history||null,
        transport:'cloud-ledger-backfill'
      };
    },
    normalizePayload(payload,eventId) {
      const R=this.realtime();
      if (!R || !R.normalize) return null;
      const ev=R.normalize(payload||{}); if (!ev) return null;
      if (eventId) ev.eventId=String(eventId);
      return ev;
    },
    rowFrom(payload,eventId) {
      const ev=this.normalizePayload(payload,eventId); if (!ev) return null;
      const pid=this.profileId(), uid=this.userId(); if (!pid||!uid) return null;
      const safePayload={ ...(payload||{}) };
      safePayload.resolution={ ...(safePayload.resolution||{}), ...ev, eventId:ev.eventId };
      return {
        profile_id:pid, user_id:uid, event_id:String(ev.eventId), tec_account:String(ev.tecAccount||''), book_id:String(ev.bookId||''),
        question_id:String(ev.questionId||''), resolved_at:ev.resolvedAt, local_date:ev.localDate||null, acertou:!!ev.acertou,
        marcada:ev.marcada||null, correta:ev.correta||null, materia:ev.materia||null, assunto:ev.assunto||null,
        banca:ev.banca||null, concurso:ev.concurso||null, source:ev.source||'companion', payload:safePayload, updated_at:new Date().toISOString()
      };
    },
    rowFromLocal(ev) { const payload=this.payloadForEvent(ev); return payload?this.rowFrom(payload,ev.eventId):null; },

    async pushPayload(payload,eventId) {
      if (!this.ready()) return false;
      const row=this.rowFrom(payload,eventId); if (!row) return false;
      this.markPending(row.event_id);
      try {
        const { error }=await CloudStore.client.from(TABLE).upsert(row,{onConflict:'profile_id,event_id'});
        if (error) throw error;
        this.unmarkPending(row.event_id); this._pushed++; this._lastError=null;
        return true;
      } catch (e) {
        this._lastError=(e&&(e.message||e.code))||String(e);
        this.scheduleRetry(); return false;
      }
    },
    async upsertRows(rows) {
      const clean=(rows||[]).filter(Boolean); if (!clean.length) return 0;
      let sent=0;
      for (let i=0;i<clean.length;i+=150) {
        const batch=clean.slice(i,i+150);
        const { error }=await CloudStore.client.from(TABLE).upsert(batch,{onConflict:'profile_id,event_id'});
        if (error) throw error;
        sent+=batch.length;
      }
      this._pushed+=sent; return sent;
    },
    async flushPending() {
      if (!this.ready()) return 0;
      const pending=this.loadPending(); if (!pending.size) return 0;
      const rows=[];
      for (const id of pending) { const ev=this.localEvent(id); if (ev) rows.push(this.rowFromLocal(ev)); }
      if (!rows.length) return 0;
      try {
        await this.upsertRows(rows);
        rows.forEach(r=>r&&pending.delete(String(r.event_id)));
        this.savePending(pending); return rows.length;
      } catch (e) { this._lastError=(e&&(e.message||e.code))||String(e); return 0; }
    },
    localSignature() {
      const R=this.realtime(); if (!R) return '0|';
      const st=R.state(), ids=Object.keys(st.events||{});
      return `${ids.length}|${String(st.lastEventAt||'')}`;
    },
    async backfillLocal() {
      if (!this.ready()) return 0;
      const sig=this.localSignature();
      try { if (localStorage.getItem(this.backfillKey())===sig) return 0; } catch (_) {}
      const R=this.realtime(); if (!R) return 0;
      const rows=Object.values(R.state().events||{}).map(ev=>this.rowFromLocal(ev)).filter(Boolean);
      if (!rows.length) { try { localStorage.setItem(this.backfillKey(),sig); } catch (_){} return 0; }
      try {
        const n=await this.upsertRows(rows);
        localStorage.setItem(this.backfillKey(),sig);
        return n;
      } catch (e) { this._lastError=(e&&(e.message||e.code))||String(e); return 0; }
    },
    async fetchAll() {
      if (!this.ready()) return [];
      const pid=this.profileId(), out=[];
      for (let from=0;;from+=PAGE_SIZE) {
        const { data,error }=await CloudStore.client.from(TABLE)
          .select('event_id,tec_account,book_id,question_id,resolved_at,local_date,acertou,marcada,correta,materia,assunto,banca,concurso,source,payload,updated_at')
          .eq('profile_id',pid).order('resolved_at',{ascending:true}).range(from,from+PAGE_SIZE-1);
        if (error) throw error;
        const part=data||[]; out.push(...part);
        if (part.length<PAGE_SIZE) break;
      }
      return out;
    },
    payloadFromRow(row) {
      if (row&&row.payload&&typeof row.payload==='object'&&!Array.isArray(row.payload)) {
        const p={...row.payload};
        p.resolution={ ...(p.resolution||{}), eventId:row.event_id, questionId:row.question_id, tecAccount:row.tec_account, bookId:row.book_id,
          resolvedAt:row.resolved_at, localDate:row.local_date, acertou:row.acertou, marcada:row.marcada, correta:row.correta,
          materia:row.materia||'', assunto:row.assunto||'', banca:row.banca||'', concurso:row.concurso||'', source:row.source||'cloud-ledger' };
        return p;
      }
      return { tecAccount:row.tec_account, bookId:row.book_id, capturedAt:row.resolved_at,
        resolution:{ eventId:row.event_id,questionId:row.question_id,tecAccount:row.tec_account,bookId:row.book_id,resolvedAt:row.resolved_at,localDate:row.local_date,
          acertou:row.acertou,marcada:row.marcada,correta:row.correta,materia:row.materia||'',assunto:row.assunto||'',banca:row.banca||'',concurso:row.concurso||'',source:row.source||'cloud-ledger' },
        question:{ id:row.question_id,cadernoId:row.book_id,materia:row.materia||'',assunto:row.assunto||'',banca:row.banca||'',concurso:row.concurso||'',marcada:row.marcada,correta:row.correta,acertou:row.acertou,capturadoEm:row.resolved_at,dataResolucao:row.local_date },
        transport:'cloud-ledger' };
    },
    mergeRows(rows) {
      const R=this.realtime(); if (!R) return {events:0,questions:0};
      const rs=R.state(), T=this.library(), ts=T&&T.state?T.state():null;
      let changed=0,qchanged=0;
      this._applying=true;
      try {
        for (const row of rows||[]) {
          const payload=this.payloadFromRow(row), ev=this.normalizePayload(payload,row.event_id); if (!ev) continue;
          const old=rs.events&&rs.events[ev.eventId];
          if (!old) { rs.events[ev.eventId]=ev; changed++; }
          else {
            const merged=R.mergeEvent?R.mergeEvent(old,ev):{...old,...ev};
            if (JSON.stringify(merged)!==JSON.stringify(old)) { rs.events[ev.eventId]=merged; changed++; }
          }
          const q=payload.question;
          if (T&&ts&&q&&(q.id||q.enunciado)) {
            const account=String(ev.tecAccount||payload.tecAccount||'conta-importada'), book=String(ev.bookId||payload.bookId||q.cadernoId||'caderno-desconhecido');
            const key=T.questionKey(account,book,q.id||T.hash(q.enunciado||''));
            const before=ts.questions&&ts.questions[key];
            const incomingAt=String(payload.capturedAt||ev.resolvedAt||row.updated_at||'');
            if (!before || incomingAt>=String(before.receivedAt||'')) {
              T.mergeInto(ts,{...q,id:q.id||ev.questionId,acertou:ev.acertou,marcada:q.marcada||ev.marcada,correta:q.correta||ev.correta},{tecAccount:account,bookId:book,history:payload.history||null,capturedAt:incomingAt});
              if (!before || JSON.stringify(before)!==JSON.stringify(ts.questions[key])) qchanged++;
            }
          }
        }
        if (changed) {
          const times=Object.values(rs.events||{}).map(e=>String(e.receivedAt||e.resolvedAt||'')).filter(Boolean).sort();
          if (times.length) rs.lastEventAt=times[times.length-1];
          R.save(rs);
        }
        if (qchanged&&T&&ts) T.save(ts);
      } finally { this._applying=false; }
      if (changed||qchanged) {
        try { R.render(); } catch (_) {}
        try { if (window.TecLacunasContinuas&&TecLacunasContinuas.refresh) TecLacunasContinuas.refresh('cloud-ledger'); } catch (_) {}
      }
      this._pulled+=(rows||[]).length;
      return {events:changed,questions:qchanged};
    },

    protectLegacySections() {
      const S=window.SectionSync; if (!S||S.__tecLedgerProtected) return;
      S.__tecLedgerProtected=true;
      const originalSectionForKey=S.sectionForKey.bind(S);
      S.sectionForKey=function(fullKey,prefixo){
        const sec=originalSectionForKey(fullKey,prefixo);
        return LEGACY_SECTIONS.has(sec)?null:sec;
      };
      const originalApply=S._applyMap.bind(S);
      S._applyMap=function(id,map,revs,preservar,manifestoRev){
        const clean={...(map||{})}, cleanRevs={...(revs||{})};
        for (const sec of LEGACY_SECTIONS) { delete clean[sec]; delete cleanRevs[sec]; }
        return originalApply(id,clean,cleanRevs,[...new Set([...(preservar||[]),...LEGACY_SECTIONS])],manifestoRev);
      };
      for (const sec of LEGACY_SECTIONS) S._dirty&&S._dirty.delete(sec);
      try { S._savePend&&S._savePend(); } catch (_) {}
    },
    patchIngest() {
      if (this._patched) return;
      const R=this.realtime(); if (!R||!R.ingest) return;
      this._patched=true;
      const original=R.ingest.bind(R), self=this;
      R.ingest=function(payload,messageId){
        const res=original(payload,messageId);
        if (res&&res.ok&&res.event&&!self._applying) {
          self.markPending(res.event.eventId);
          self.pushPayload(payload,res.event.eventId).catch(()=>{});
        }
        return res;
      };
    },
    unsubscribe() {
      if (!this._channel||!window.CloudStore||!CloudStore.client) { this._channel=null; this._channelProfile=null; return; }
      try { CloudStore.client.removeChannel(this._channel); } catch (_) {}
      this._channel=null; this._channelProfile=null;
    },
    subscribe() {
      if (!this.ready()) return;
      const pid=this.profileId(); if (this._channel&&this._channelProfile===pid) return;
      this.unsubscribe();
      try {
        const self=this;
        this._channel=CloudStore.client.channel('tec-ledger-'+pid)
          .on('postgres_changes',{event:'*',schema:'public',table:TABLE,filter:`profile_id=eq.${pid}`},p=>{
            const row=p&&p.new; if (row&&row.event_id) self.mergeRows([row]);
          }).subscribe();
        this._channelProfile=pid;
      } catch (e) { this._lastError=(e&&(e.message||e.code))||String(e); }
    },
    async sync(reason) {
      if (this._syncing||!this.ready()) return false;
      this._syncing=true;
      try {
        this.protectLegacySections(); this.patchIngest();
        await this.flushPending();
        await this.backfillLocal();
        const rows=await this.fetchAll();
        this.mergeRows(rows); this.subscribe();
        this._lastSyncAt=new Date().toISOString(); this._lastError=null;
        try { window.dispatchEvent(new CustomEvent('tec-cloud-ledger-synced',{detail:{reason:reason||'sync',rows:rows.length,at:this._lastSyncAt}})); } catch (_) {}
        return true;
      } catch (e) {
        this._lastError=(e&&(e.message||e.code))||String(e); this.scheduleRetry(); return false;
      } finally { this._syncing=false; }
    },
    scheduleRetry() {
      clearTimeout(this._retryTimer);
      this._retryTimer=setTimeout(()=>this.sync('retry'),10000);
    },
    status() {
      return {ready:this.ready(),profileId:this.profileId(),pending:this.loadPending().size,syncing:this._syncing,lastSyncAt:this._lastSyncAt,lastError:this._lastError,pulled:this._pulled,pushed:this._pushed};
    },
    tick() {
      const pid=this.profileId();
      if (pid!==this._lastProfile) { this._lastProfile=pid; this.unsubscribe(); this._patched=false; this.sync('profile-change'); return; }
      this.protectLegacySections(); this.patchIngest();
      if (this.ready()) this.sync('periodic');
    },
    init() {
      this.protectLegacySections(); this.patchIngest();
      this._lastProfile=this.profileId();
      setTimeout(()=>this.sync('startup'),1200);
      this._timer=setInterval(()=>this.tick(),30000);
      window.addEventListener('focus',()=>this.sync('focus'));
      document.addEventListener('visibilitychange',()=>{ if (!document.hidden) this.sync('visible'); });
      window.addEventListener('online',()=>this.sync('online'));
    }
  };

  window.TecCloudLedger=C;
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>C.init(),{once:true});
  else C.init();
})();
