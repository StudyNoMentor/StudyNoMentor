/* ============================================================================
   TEC — RECONSTRUÇÃO HISTÓRICA POR CADERNO
   ----------------------------------------------------------------------------
   Recupera diretamente do caderno no TEC, via Companion dedicado:
   · lista oficial de questões resolvidas e data/resultado do Gabarito;
   · questão completa e gabarito quando ainda expostos pelo TEC;
   · histórico agregado de tentativas por questão;
   · tentativas individuais somente quando o TEC fornece alternativa + data.

   Regra de integridade: ausência de data/alternativa NÃO é preenchida por
   estimativa. O agregado é preservado como agregado; evento prescritivo só é
   criado quando resposta marcada + gabarito + resultado são coerentes.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecReconstrucaoCaderno) return;
  window.__tecReconstrucaoCaderno = true;

  const APP_SOURCE = 'StudyNoMentorApp';
  const EXT_SOURCE = 'StudyMentorCompanion';
  const KEY_SUFFIX = 'tec-reconstrucao-cadernos-v1';
  const quiet = (e, ctx) => { try { if (typeof _quiet === 'function') _quiet(e, ctx); } catch (ignored) { console.warn('[TEC reconstrução]', ctx, e, ignored); } };
  const now = () => new Date().toISOString();
  const uid = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const letter = value => {
    const m = String(value == null ? '' : value).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);
    return m ? m[1] : null;
  };
  const fnv = value => { let h=2166136261; for (const c of String(value||'')) { h^=c.charCodeAt(0); h=Math.imul(h,16777619); } return (h>>>0).toString(36); };

  const H = {
    activeRequestId: null,
    _bound: false,
    _uiBound: false,
    _importPatched: false,
    _detailPatched: false,

    key() { try { return DB._profilePrefix() + KEY_SUFFIX; } catch (e) { quiet(e,'tec-reconstruct-key'); return 'diario-estudos:' + KEY_SUFFIX; } },
    blank() { return { schema:1, books:{}, active:null, updatedAt:null }; },
    state() {
      try {
        const st=JSON.parse(localStorage.getItem(this.key()) || 'null');
        return st && st.schema===1 && st.books && typeof st.books==='object' ? st : this.blank();
      } catch (e) { quiet(e,'tec-reconstruct-state'); return this.blank(); }
    },
    save(st) {
      st.updatedAt=now();
      try {
        localStorage.setItem(this.key(),JSON.stringify(st));
        if (typeof SectionSync!=='undefined' && SectionSync.markDirty) SectionSync.markDirty(this.key());
        if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange();
        return true;
      } catch (e) { quiet(e,'tec-reconstruct-save'); return false; }
    },
    parseBookId(value) {
      const raw=String(value == null ? '' : value).trim();
      const m=raw.match(/\/questoes\/cadernos\/(\d+)/i);
      const id=m?m[1]:(raw.match(/^\d+$/)||[])[0];
      return id?String(id):null;
    },
    context() {
      try { return typeof window.__snmTecStudyContext==='function' ? window.__snmTecStudyContext() : null; }
      catch (e) { quiet(e,'tec-reconstruct-context'); return null; }
    },
    dateInfo(raw) {
      if (raw == null || raw === '') return null;
      const s=String(raw).trim();
      let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        const localDate=`${m[3]}-${m[2]}-${m[1]}`;
        return { raw:s,localDate,resolvedAt:`${localDate}T12:00:00`,precision:'day' };
      }
      m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return { raw:s,localDate:s,resolvedAt:`${s}T12:00:00`,precision:'day' };
      const d=new Date(s);
      if (Number.isNaN(d.getTime())) return null;
      const localDate=/^\d{4}-\d{2}-\d{2}/.test(s)?s.slice(0,10):`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return { raw:s,localDate,resolvedAt:d.toISOString(),precision:/T\d{2}:\d{2}/.test(s)?'instant':'day' };
    },
    equivalentIn(rows,ev) {
      return (rows||[]).some(old => old &&
        String(old.tecAccount||'')===String(ev.tecAccount||'') &&
        String(old.bookId||'')===String(ev.bookId||'') &&
        String(old.questionId||'')===String(ev.questionId||'') &&
        String(old.localDate||'')===String(ev.localDate||'') &&
        old.acertou===ev.acertou && String(old.marcada||'')===String(ev.marcada||'') && String(old.correta||'')===String(ev.correta||''));
    },
    makeEvent({account,bookId,question,acertou,marcada,correta,date,attemptKey,source}) {
      const marked=letter(marcada), correct=letter(correta), result=acertou===true;
      if (!marked || !correct || typeof acertou!=='boolean' || result!==(marked===correct)) return null;
      const di=this.dateInfo(date); if (!di) return null;
      const qid=String(question&&question.id||''); if (!qid) return null;
      const seed=[account,bookId,qid,di.raw,attemptKey,marked,correct,result?'1':'0'].join('|');
      return {
        eventId:'recon_'+fnv(seed),questionId:qid,tecAccount:String(account||'conta-reconstruida'),bookId:String(bookId||''),
        resolvedAt:di.resolvedAt,localDate:di.localDate,timezoneOffsetMinutes:null,acertou:result,marcada:marked,correta:correct,
        materia:String(question.materia||''),assunto:String(question.assunto||''),banca:String(question.banca||''),concurso:String(question.concurso||''),
        source:String(source||'tec-reconstruction'),receivedAt:now(),
        integrity:{schema:3,status:'verified',confidence:'high',source:'historical-marked-vs-gabarito',marked,correct,canonicalResult:result,reportedResult:result,
          conflict:false,conflictResolved:false,reconstructed:true,datePrecision:di.precision},
        provenance:{eventSchemaVersion:3,captureEngineVersion:'reconstruction-1',companionVersion:'1.3.0',captureStrategy:'historical-caderno-reconstruction',datePrecision:di.precision,reconstructedAt:now()}
      };
    },
    eventsFromRow(row,account,bookId) {
      const q=row&&row.question; if (!q||!q.id) return {events:[],undated:0,conflicts:0};
      const correct=letter(q.correta||row.latest&&row.latest.correta);
      const out=[], seen=new Set(); let undated=0,conflicts=0;
      const attempts=row.history&&Array.isArray(row.history.attempts)?row.history.attempts:[];
      attempts.forEach((a,index)=>{
        const marked=letter(a&&a.alternativa);
        if (!a||typeof a.acertou!=='boolean'||!marked||!correct) { if (a&&!a.resolvedAt) undated++; return; }
        if (!a.resolvedAt) { undated++; return; }
        const ev=this.makeEvent({account,bookId,question:q,acertou:a.acertou,marcada:marked,correta:correct,date:a.resolvedAt,attemptKey:`history-${a.index??index}`,source:'tec-reconstruction-history'});
        if (!ev) { conflicts++; return; }
        if (!seen.has(ev.eventId)) { seen.add(ev.eventId); out.push(ev); }
      });
      if (row.latest&&row.latest.verified&&row.latest.dataResolucao) {
        const ev=this.makeEvent({account,bookId,question:q,acertou:row.latest.acertou,marcada:row.latest.marcada||q.marcada,correta:row.latest.correta||q.correta,
          date:row.latest.dataResolucao,attemptKey:'latest-gabarito',source:'tec-reconstruction-gabarito'});
        if (ev && !out.some(x=>x.localDate===ev.localDate&&x.acertou===ev.acertou&&x.marcada===ev.marcada&&x.correta===ev.correta)) out.push(ev);
      }
      return {events:out,undated,conflicts};
    },
    ingestBatch(payload,{source='caderno'}={}) {
      const rows=Array.isArray(payload&&payload.rows)?payload.rows:[];
      if (!rows.length) return {questions:0,events:0,aggregateAttempts:0,undatedAttempts:0,conflicts:0};
      const account=String(payload.tecAccount||'conta-reconstruida');
      const bookId=String(payload.bookId||'');
      const T=window.TecIntegracaoScreen, R=window.TecRealtime;
      const ts=T&&T.state?T.state():null, rs=R&&R.state?R.state():null;
      const preexisting=rs?Object.values(rs.events||{}):[];
      let qn=0,en=0,aggregateAttempts=0,undatedAttempts=0,conflicts=0,lastKey=null;

      for (const row of rows) {
        const q=row&&row.question;
        if (q&&T&&ts) {
          try {
            lastKey=T.mergeInto(ts,q,{tecAccount:account,bookId:bookId||row.bookId||q.cadernoId,history:row.history||null,capturedAt:q.capturadoEm||now()});
            qn++;
            aggregateAttempts+=Math.max(0,Number(row.history&&row.history.total||0));
          } catch (e) { quiet(e,'tec-reconstruct-merge-question'); }
        }
        if (R&&rs&&q) {
          const built=this.eventsFromRow(row,account,bookId||row.bookId||q.cadernoId);
          undatedAttempts+=built.undated; conflicts+=built.conflicts;
          for (const ev of built.events) {
            if (this.equivalentIn(preexisting,ev)) continue;
            const old=rs.events&&rs.events[ev.eventId];
            rs.events[ev.eventId]=old&&R.mergeEvent?R.mergeEvent(old,ev):{...(old||{}),...ev};
            en++;
          }
        }
      }

      if (T&&ts&&qn) {
        T.save(ts); if (lastKey) T.selectedKey=lastKey;
      }
      if (R&&rs&&en) {
        const times=Object.values(rs.events||{}).map(e=>String(e.receivedAt||e.resolvedAt||'')).filter(Boolean).sort();
        if (times.length) rs.lastEventAt=times[times.length-1];
        R.save(rs); R.render();
      }
      if (qn&&T) T.render();
      try { if (en&&window.TecCloudLedger&&TecCloudLedger.backfillLocal) TecCloudLedger.backfillLocal(); } catch (e) { quiet(e,'tec-reconstruct-cloud-backfill'); }
      try { if ((qn||en)&&window.TecLacunasContinuas&&TecLacunasContinuas.refresh) TecLacunasContinuas.refresh('reconstruction'); } catch (e) { quiet(e,'tec-reconstruct-lacunas-refresh'); }
      this.recordBook(bookId,account,{questions:qn,events:en,aggregateAttempts,undatedAttempts,conflicts,source});
      return {questions:qn,events:en,aggregateAttempts,undatedAttempts,conflicts};
    },
    recordBook(bookId,account,delta) {
      if (!bookId) return;
      const st=this.state(), prev=st.books[String(bookId)]||{bookId:String(bookId),account,questions:0,events:0,aggregateAttempts:0,undatedAttempts:0,conflicts:0};
      const next={...prev,account:account||prev.account,lastRunAt:now(),source:delta.source||prev.source||'caderno'};
      for (const k of ['questions','events','aggregateAttempts','undatedAttempts','conflicts']) next[k]=Math.max(Number(prev[k]||0),Number(delta[k]||0));
      st.books[String(bookId)]=next; this.save(st);
    },
    rowsFromLegacyJSON(data) {
      const questions=Array.isArray(data&&data.questoes)?data.questoes:[];
      return questions.map(raw=>{
        const id=String(raw&&raw.id||'');
        const result=data&&data.resultados&&data.resultados[id];
        const official=data&&data.resultadosOficiais&&data.resultadosOficiais[id];
        const latest=result||official||null;
        const q={...(raw||{})};
        if (typeof q.acertou!=='boolean'&&typeof latest?.acertou==='boolean') q.acertou=latest.acertou;
        const marked=letter(q.marcada),correct=letter(q.correta);
        const verified=!!(marked&&correct&&typeof q.acertou==='boolean'&&q.acertou===(marked===correct));
        if (verified) q.integrity={...(q.integrity||{}),schema:3,status:'verified',confidence:'high',source:'tampermonkey-json-marked-vs-gabarito',marked,correct,canonicalResult:q.acertou,reportedResult:q.acertou,conflict:false,reconstructed:true};
        return {questionId:id,bookId:String(data.cadernoId||q.cadernoId||''),question:q,history:data.desempenhoQuestoes&&data.desempenhoQuestoes[id]||null,
          latest:latest?{dataResolucao:latest.dataResolucao||q.dataResolucao||null,acertou:typeof latest.acertou==='boolean'?latest.acertou:q.acertou,marcada:marked,correta:correct,verified}:null,
          reconstruction:{source:'tampermonkey-json',exactLatest:verified,aggregateHistory:!!(data.desempenhoQuestoes&&data.desempenhoQuestoes[id])}};
      });
    },
    patchJSONImport() {
      const T=window.TecIntegracaoScreen;
      if (!T||this._importPatched||typeof T.importJSON!=='function') return;
      this._importPatched=true;
      const original=T.importJSON.bind(T), self=this;
      T.importJSON=async function(file) {
        let data=null;
        try { data=JSON.parse(await file.text()); } catch (e) { quiet(e,'tec-reconstruct-json-parse'); }
        await original(file);
        if (!data||!Array.isArray(data.questoes)||!data.questoes.length) return;
        const rows=self.rowsFromLegacyJSON(data);
        const stats=self.ingestBatch({rows,bookId:String(data.cadernoId||''),tecAccount:String(data.contaTec||'conta-importada')},{source:'tampermonkey-json'});
        if (typeof showToast==='function') showToast(`♻️ Histórico recuperado do JSON: ${stats.aggregateAttempts} tentativa(s) agregadas · ${stats.events} evento(s) verificáveis.`);
      };
    },
    patchDetail() {
      const T=window.TecIntegracaoScreen;
      if (!T||this._detailPatched||typeof T.renderDetail!=='function') return;
      this._detailPatched=true;
      const original=T.renderDetail.bind(T);
      T.renderDetail=function(state) {
        original(state);
        const row=state&&state.questions&&state.questions[this.selectedKey], h=row&&row.history;
        const root=document.getElementById('tec-question-detail');
        if (!root||!h||!Number.isFinite(Number(h.total))) return;
        let box=root.querySelector('.tec-reconstructed-history');
        if (!box) { box=document.createElement('div'); box.className='tec-reconstructed-history'; box.style.cssText='margin-top:12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--surface-sunken);font-size:12px;line-height:1.45'; root.appendChild(box); }
        const dated=Array.isArray(h.attempts)?h.attempts.filter(x=>x&&x.resolvedAt).length:0;
        box.textContent=`Histórico TEC recuperado: ${Number(h.total)} tentativa(s) · ${Number(h.acertos||0)} acerto(s) · ${Number(h.erros||0)} erro(s)`+(dated?` · ${dated} com data individual`:' · tentativas antigas sem data individual permanecem como agregado');
      };
    },
    ensureCard() {
      const screen=document.getElementById('screen-integracaotec'); if (!screen) return null;
      let card=document.getElementById('tec-reconstruction-card'); if (card) return card;
      card=document.createElement('section'); card.id='tec-reconstruction-card'; card.className='card';
      card.innerHTML=`<div class="card-header"><div><h2>♻️ Reconstruir histórico de um caderno</h2><p class="sub">Cole o link ou o número do caderno. O Companion abre uma aba técnica do TEC, percorre o Gabarito e recupera o histórico que ainda existe na sua conta. Nada é inventado: tentativas sem data individual ficam registradas como agregado.</p></div></div>
        <div style="padding:14px 28px 22px;display:grid;gap:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input id="tec-reconstruction-input" type="text" inputmode="url" placeholder="Ex.: 123456 ou https://www.tecconcursos.com.br/questoes/cadernos/123456" style="flex:1;min-width:280px"><button type="button" class="btn-primary" id="tec-reconstruction-start">Reconstruir</button><button type="button" class="btn-secondary" id="tec-reconstruction-cancel" hidden>Cancelar</button></div>
          <div id="tec-reconstruction-status" class="hint">O TEC precisa estar logado neste navegador. A reconstrução roda em segundo plano e pode levar alguns minutos em cadernos grandes.</div>
          <div style="height:8px;border-radius:999px;background:var(--surface-sunken);overflow:hidden"><div id="tec-reconstruction-bar" style="height:100%;width:0%;background:var(--accent,#2563eb);transition:width .2s ease"></div></div>
          <div id="tec-reconstruction-summary" class="hint"></div>
        </div>`;
      const first=screen.querySelector('.card');
      if (first&&first.parentElement) first.insertAdjacentElement('afterend',card); else screen.prepend(card);
      return card;
    },
    setStatus(textValue,percent=null,busy=null) {
      const status=document.getElementById('tec-reconstruction-status'); if (status) status.textContent=String(textValue||'');
      const bar=document.getElementById('tec-reconstruction-bar'); if (bar&&percent!=null) bar.style.width=`${Math.max(0,Math.min(100,Number(percent)||0))}%`;
      const start=document.getElementById('tec-reconstruction-start'), cancel=document.getElementById('tec-reconstruction-cancel');
      if (start&&busy!=null) start.disabled=!!busy;
      if (cancel&&busy!=null) cancel.hidden=!busy;
    },
    updateSummary(bookId,extra='') {
      const box=document.getElementById('tec-reconstruction-summary'); if (!box) return;
      const b=this.state().books[String(bookId||'')];
      if (!b) { box.textContent=extra; return; }
      box.textContent=`Caderno #${b.bookId}: ${b.questions||0} questão(ões) recuperadas · ${b.aggregateAttempts||0} tentativa(s) no histórico agregado · ${b.events||0} evento(s) com evidência completa`+(b.undatedAttempts?` · ${b.undatedAttempts} tentativa(s) sem data individual`:``)+(extra?` · ${extra}`:'');
    },
    start() {
      const input=document.getElementById('tec-reconstruction-input');
      const bookId=this.parseBookId(input&&input.value);
      if (!bookId) { this.setStatus('Informe um número de caderno ou um link válido do TEC.',0,false); return; }
      const context=this.context();
      if (!context) { this.setStatus('Entre na sua conta do StudyNoMentor e selecione um perfil antes de reconstruir. Isso impede que dados caiam no perfil errado.',0,false); return; }
      const requestId='recon_'+uid();
      this.activeRequestId=requestId;
      const st=this.state(); st.active={requestId,bookId,startedAt:now(),status:'queued'}; this.save(st);
      this.setStatus(`Preparando reconstrução do caderno #${bookId}…`,0,true);
      try { window.postMessage({source:APP_SOURCE,type:'tec-reconstruct-request',payload:{requestId,bookId,context}},location.origin); }
      catch (e) { quiet(e,'tec-reconstruct-request'); this.setStatus('Não foi possível enviar o pedido ao Companion.',0,false); }
    },
    cancel() {
      const st=this.state(), active=st.active; if (!active||!active.requestId) return;
      const context=this.context();
      try { window.postMessage({source:APP_SOURCE,type:'tec-reconstruct-cancel',payload:{requestId:active.requestId,context}},location.origin); }
      catch (e) { quiet(e,'tec-reconstruct-cancel'); }
      this.setStatus('Cancelando reconstrução…',null,true);
    },
    onMessage(event) {
      if (event.source!==window||event.origin!==location.origin) return;
      const m=event.data; if (!m||m.source!==EXT_SOURCE||!String(m.type||'').startsWith('tec-reconstruct-')) return;
      const p=m.payload||{}, st=this.state(), active=st.active;
      if (!p.requestId||!active||String(p.requestId)!==String(active.requestId)) return;
      this.activeRequestId=active.requestId;
      if (m.type==='tec-reconstruct-status') {
        active.status=p.status||active.status; st.active=active; this.save(st);
        this.setStatus(p.status==='running'?`TEC aberto. Lendo o caderno #${active.bookId}…`:`Reconstrução ${p.status||'em fila'}…`,p.progress&&p.progress.percent||0,true);
      } else if (m.type==='tec-reconstruct-progress') {
        active.status='running'; active.progress=p; st.active=active; this.save(st);
        const total=Number(p.total||0),processed=Number(p.processed||0),pct=Number(p.percent||0);
        this.setStatus(total?`Reconstruindo #${active.bookId}: ${processed}/${total} questão(ões) processadas…`:`Mapeando questões resolvidas do caderno #${active.bookId}…`,pct,true);
        this.updateSummary(active.bookId);
      } else if (m.type==='tec-reconstruct-batch') {
        const stats=this.ingestBatch(p,{source:'caderno'});
        this.updateSummary(active.bookId,`${stats.questions} questão(ões) incorporadas neste lote`);
      } else if (m.type==='tec-reconstruct-result') {
        const summary=p.summary||{}; active.status=p.status||'complete'; active.completedAt=now(); active.summary=summary; st.active=null; this.save(st);
        this.activeRequestId=null;
        const done=p.status==='cancelled'?'Reconstrução cancelada.':`Reconstrução concluída: ${summary.processed||summary.questions||0} questão(ões) processadas.`;
        this.setStatus(done,p.status==='cancelled'?0:100,false); this.updateSummary(active.bookId);
        if (typeof showToast==='function') showToast(p.status==='cancelled'?'Reconstrução TEC cancelada.':'♻️ Histórico do caderno reconstruído.');
      } else if (m.type==='tec-reconstruct-error') {
        active.status='failed'; active.error=p.error||'Falha desconhecida'; active.completedAt=now(); st.active=null; this.save(st);
        this.activeRequestId=null; this.setStatus(`Falha na reconstrução: ${active.error}`,0,false);
      }
    },
    bind() {
      this.ensureCard(); this.patchJSONImport(); this.patchDetail();
      if (!this._bound) { this._bound=true; window.addEventListener('message',event=>this.onMessage(event)); }
      if (!this._uiBound) {
        this._uiBound=true;
        document.addEventListener('click',event=>{
          const id=event.target&&event.target.id;
          if (id==='tec-reconstruction-start') { event.preventDefault(); this.start(); }
          else if (id==='tec-reconstruction-cancel') { event.preventDefault(); this.cancel(); }
        });
      }
      const st=this.state();
      if (st.active&&st.active.requestId) {
        this.activeRequestId=st.active.requestId;
        this.setStatus(`Reconectando à reconstrução do caderno #${st.active.bookId}…`,st.active.progress&&st.active.progress.percent||0,true);
        const context=this.context();
        try { window.postMessage({source:APP_SOURCE,type:'tec-reconstruct-resync',payload:{requestId:st.active.requestId,context}},location.origin); }
        catch (e) { quiet(e,'tec-reconstruct-resync'); }
      }
    }
  };

  window.TecHistoricalReconstruction=H;
  const boot=()=>{ try { H.bind(); } catch (e) { quiet(e,'tec-reconstruct-boot'); } };
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
  setTimeout(boot,1200);
})();
