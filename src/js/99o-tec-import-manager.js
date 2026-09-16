/* ============================================================================
   TEC — CENTRAL COMPLETA DE GESTÃO DE IMPORTAÇÕES / CADERNOS
   ----------------------------------------------------------------------------
   Objetivos:
   · tratar a reconstrução como retrato do CADERNO INTEIRO, nunca do dia;
   · permitir auditoria questão a questão sem destruir o dado bruto;
   · permitir desconsiderar uma questão das métricas de forma reversível;
   · oferecer filtros, seleção em lote, revisão manual e detalhe completo;
   · manter exclusões fora do ledger factual: governança != adulteração do fato.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecImportManagerCompleto) return;
  window.__tecImportManagerCompleto = true;

  const KEY_SUFFIX = 'tec-import-manager';
  const SCHEMA = 1;
  const text = v => String(v == null ? '' : v).trim();
  const num = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
  const letter = v => {
    const m = text(v).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);
    return m ? m[1] : null;
  };
  const norm = v => text(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  const now = () => new Date().toISOString();
  const clone = value => { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; } };
  const esc = v => typeof escapeHtml === 'function' ? escapeHtml(text(v)) : text(v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const quiet = (e, ctx) => { try { if (typeof _quiet === 'function') _quiet(e, ctx); } catch (_) { void 0; } };

  const IM = {
    _patched: false,
    _bound: false,
    _activeBook: null,
    _selected: new Set(),
    _detailQuestion: null,
    _filters: {
      query: '', status: 'all', reviewed: 'all', materia: '', assunto: '', banca: '', concurso: '',
      marcada: '', correta: '', from: '', to: '', minAttempts: 0, sort: 'id-asc', page: 1, pageSize: 50
    },
    _rawTrustClassify: null,

    key() {
      try { return DB._profilePrefix() + KEY_SUFFIX; }
      catch (_) { return 'diario-estudos:' + KEY_SUFFIX; }
    },
    blank() { return { schema: SCHEMA, books: {}, updatedAt: null }; },
    state() {
      try {
        const st = JSON.parse(localStorage.getItem(this.key()) || 'null');
        return st && st.schema === SCHEMA && st.books && typeof st.books === 'object' ? st : this.blank();
      } catch (e) { quiet(e, 'tec-import-manager-state'); return this.blank(); }
    },
    save(st) {
      st.updatedAt = now();
      try {
        localStorage.setItem(this.key(), JSON.stringify(st));
        if (typeof SectionSync !== 'undefined' && SectionSync.markDirty) SectionSync.markDirty(this.key());
        if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange();
        return true;
      } catch (e) { quiet(e, 'tec-import-manager-save'); return false; }
    },
    bookState(st, bookId) {
      const id = text(bookId);
      if (!st.books[id]) st.books[id] = { bookId:id, decisions:{}, createdAt:now(), updatedAt:null };
      if (!st.books[id].decisions || typeof st.books[id].decisions !== 'object') st.books[id].decisions = {};
      return st.books[id];
    },
    decision(bookId, questionId) {
      const st = this.state(), b = st.books[text(bookId)], qid = text(questionId);
      return clone(b && b.decisions && b.decisions[qid] || { excluded:false, reviewed:false, note:'', updatedAt:null });
    },
    setDecision(bookId, questionId, patch={}) {
      const id=text(bookId), qid=text(questionId); if (!id || !qid) return null;
      const st=this.state(), b=this.bookState(st,id), old=b.decisions[qid]||{};
      const next={
        excluded: patch.excluded == null ? !!old.excluded : !!patch.excluded,
        reviewed: patch.reviewed == null ? !!old.reviewed : !!patch.reviewed,
        note: patch.note == null ? text(old.note) : text(patch.note).slice(0,4000),
        exclusionReason: patch.exclusionReason == null ? text(old.exclusionReason) : text(patch.exclusionReason).slice(0,500),
        updatedAt: now()
      };
      b.decisions[qid]=next; b.updatedAt=now(); st.books[id]=b; this.save(st);
      this.refreshConsumers();
      return clone(next);
    },
    setExcluded(bookId, questionId, excluded, reason='manual') {
      return this.setDecision(bookId,questionId,{excluded:!!excluded,exclusionReason:excluded?reason:''});
    },
    setReviewed(bookId, questionId, reviewed) { return this.setDecision(bookId,questionId,{reviewed:!!reviewed}); },
    setNote(bookId, questionId, note) { return this.setDecision(bookId,questionId,{note}); },

    identity(value) {
      const v=value||{}, q=v.question||v.payload&&v.payload.question||v;
      const bookId=text(v.bookId||v.book_id||q&&q.cadernoId||v.payload&&v.payload.bookId||v.resolution&&v.resolution.bookId);
      const questionId=text(v.questionId||v.question_id||q&&q.id||v.resolution&&v.resolution.questionId);
      return {bookId,questionId};
    },
    isExcluded(bookId, questionId) { return !!this.decision(bookId,questionId).excluded; },
    isExcludedValue(value) {
      const id=this.identity(value); return !!(id.bookId&&id.questionId&&this.isExcluded(id.bookId,id.questionId));
    },

    libraryRows(bookId) {
      const id=text(bookId), out=[];
      try {
        const T=window.TecIntegracaoScreen, st=T&&T.state?T.state():null;
        for (const row of Object.values(st&&st.questions||{})) {
          if (text(row&&row.bookId)!==id) continue;
          const q=row&&row.question||{}, qid=text(q.id||row.questionId); if(!qid) continue;
          out.push({...row,question:q,questionId:qid,bookId:id});
        }
      } catch (e) { quiet(e,'tec-import-manager-library'); }
      return out;
    },
    events(bookId, questionId=null) {
      const id=text(bookId), qid=questionId==null?null:text(questionId), out=[];
      try {
        const R=window.TecRealtime, st=R&&R.state?R.state():null;
        for (const ev of Object.values(st&&st.events||{})) {
          if (text(ev&&ev.bookId)!==id) continue;
          if (qid && text(ev&&ev.questionId)!==qid) continue;
          out.push(ev);
        }
      } catch (e) { quiet(e,'tec-import-manager-events'); }
      return out.sort((a,b)=>text(a&&a.resolvedAt).localeCompare(text(b&&b.resolvedAt)));
    },
    rowDate(row) {
      const q=row&&row.question||{};
      const raw=text(q.dataResolucao||q.resolvedAt||row&&row.receivedAt);
      let m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if(m)return`${m[3]}-${m[2]}-${m[1]}`;
      m=raw.match(/^(\d{4}-\d{2}-\d{2})/); if(m)return m[1];
      const evs=this.events(row.bookId,row.questionId); const last=evs.at(-1); return text(last&&last.localDate||'');
    },
    knownHistory(row) {
      const q=row&&row.question||{}, h=row&&row.history||{};
      let total=num(h.total), acertos=num(h.acertos), erros=num(h.erros), minimumKnown=!!h.minimumKnown;
      if (!total && typeof q.acertou==='boolean') {
        total=1; acertos=q.acertou?1:0; erros=q.acertou?0:1; minimumKnown=true;
      }
      if (total && acertos+erros!==total) {
        if (acertos+erros<total) erros=Math.max(erros,total-acertos);
        else total=acertos+erros;
      }
      return {total,acertos,erros,minimumKnown,attempts:Array.isArray(h.attempts)?h.attempts:[],source:text(h.fonte||h.source)};
    },
    rawTrust(row) {
      const q=row&&row.question||row||{};
      try {
        if (this._rawTrustClassify) return this._rawTrustClassify(q);
        if (window.TecTrustGate&&TecTrustGate.classify) return TecTrustGate.classify(q);
      } catch (e) { quiet(e,'tec-import-manager-trust'); }
      const i=q.integrity||{}; return {trusted:i.status==='verified'&&i.confidence==='high',reason:text(i.status||'unknown')};
    },
    normalizedRow(row) {
      const q=row&&row.question||{}, h=this.knownHistory(row), d=this.decision(row.bookId,row.questionId), trust=this.rawTrust(row);
      const marcada=letter(q.marcada)||letter((q.alternativas||[]).find(a=>a&&a.marcadaPorMim)?.letra);
      const correta=letter(q.correta)||letter((q.alternativas||[]).find(a=>a&&a.correta)?.letra);
      return {
        raw:row,bookId:text(row.bookId),questionId:text(row.questionId),question:q,history:h,decision:d,trust,
        materia:text(q.materia),assunto:text(q.assunto),banca:text(q.banca),concurso:text(q.concurso),
        enunciado:text(q.enunciado),marcada,correta,acertou:typeof q.acertou==='boolean'?q.acertou:null,
        date:this.rowDate(row)
      };
    },
    rows(bookId) { return this.libraryRows(bookId).map(r=>this.normalizedRow(r)); },

    stats(bookId) {
      const out={questions:0,consideredQuestions:0,excludedQuestions:0,attempts:0,correct:0,wrong:0,effectiveAttempts:0,effectiveCorrect:0,effectiveWrong:0,verified:0,reviewed:0,contentComplete:0};
      for (const r of this.rows(bookId)) {
        out.questions++;
        out.attempts+=r.history.total; out.correct+=r.history.acertos; out.wrong+=r.history.erros;
        if (r.trust&&r.trust.trusted) out.verified++;
        if (r.decision.reviewed) out.reviewed++;
        if (r.enunciado && Array.isArray(r.question.alternativas) && r.question.alternativas.length>=2) out.contentComplete++;
        if (r.decision.excluded) out.excludedQuestions++;
        else {
          out.consideredQuestions++;
          out.effectiveAttempts+=r.history.total; out.effectiveCorrect+=r.history.acertos; out.effectiveWrong+=r.history.erros;
        }
      }
      out.accuracy=out.attempts?out.correct/out.attempts:null;
      out.effectiveAccuracy=out.effectiveAttempts?out.effectiveCorrect/out.effectiveAttempts:null;
      return out;
    },

    ensureConservativeHistory(payload) {
      const rows=Array.isArray(payload&&payload.rows)?payload.rows:[];
      for (const row of rows) {
        if (!row || row.history || typeof row.latest?.acertou!=='boolean') continue;
        /* Fato mínimo seguro: uma linha em "Resolvidas" prova ao menos a última
           tentativa. Não inventamos tentativas anteriores quando o TEC não as expõe. */
        row.history={
          total:1,acertos:row.latest.acertou?1:0,erros:row.latest.acertou?0:1,
          ultimoResultado:row.latest.acertou?'acerto':'erro',ultimaAlternativa:letter(row.latest.marcada),
          consistente:true,attempts:[],fonte:'reconstrucao:gabarito-minimo',confianca:'media',minimumKnown:true,complete:false,reconstruidoEm:now()
        };
      }
      return payload;
    },

    patchReconstruction() {
      const H=window.TecHistoricalReconstruction; if(!H||H.__fullBookManagerPatched||typeof H.ingestBatch!=='function')return;
      H.__fullBookManagerPatched=true; const original=H.ingestBatch.bind(H), self=this;
      H.ingestBatch=function(payload={},opts={}) { self.ensureConservativeHistory(payload); return original(payload,opts); };
    },
    patchMetrics() {
      const G=window.TecTrustGate;
      if (G&&!G.__importManagerExclusionPatched&&typeof G.classify==='function') {
        G.__importManagerExclusionPatched=true;
        const base=G.classify.bind(G); this._rawTrustClassify=base; const self=this;
        G.classify=function(value) {
          const result=base(value);
          if (!self.isExcludedValue(value)) return result;
          return {...result,trusted:false,prescriptive:false,reason:'manually-excluded'};
        };
      }
      const R=window.TecRealtime;
      if (R&&!R.__importManagerRowsPatched&&typeof R.rows==='function') {
        R.__importManagerRowsPatched=true; const base=R.rows.bind(R), self=this;
        R.rows=function(...args){return (base(...args)||[]).filter(ev=>!self.isExcludedValue(ev));};
      }
    },
    patchHistoricalManager() {
      const M=window.TecHistoricalManager; if(!M||M.__importManagerPatched||typeof M.render!=='function')return;
      M.__importManagerPatched=true; const base=M.render.bind(M), self=this;
      M.render=function(...args){const out=base(...args);setTimeout(()=>self.decorateHistoryCards(),0);return out;};
      setTimeout(()=>this.decorateHistoryCards(),0);
    },

    refreshConsumers() {
      try { if(window.TecRealtime&&TecRealtime.render)TecRealtime.render(); } catch(e){quiet(e,'tec-import-manager-refresh-radar');}
      try { if(window.TecLacunasContinuas&&TecLacunasContinuas.refresh)TecLacunasContinuas.refresh('manual-exclusion'); } catch(e){quiet(e,'tec-import-manager-refresh-lacunas');}
      try { if(window.TecHistoricalManager&&TecHistoricalManager.render)TecHistoricalManager.render(); } catch(e){quiet(e,'tec-import-manager-refresh-history');}
      if (this._activeBook) this.renderModal();
      if (this._detailQuestion) this.renderDetail(this._detailQuestion);
    },

    decorateHistoryCards() {
      const root=document.getElementById('tec-history-manager-list'); if(!root)return;
      for(const card of root.querySelectorAll('.tec-history-book[data-book-id]')){
        const id=text(card.dataset.bookId), actions=card.querySelector('.tec-history-actions'); if(!id||!actions)continue;
        if(!actions.querySelector('[data-import-manager-open]')){
          const b=document.createElement('button');b.type='button';b.className='btn-primary';b.textContent='Abrir caderno';b.dataset.importManagerOpen=id;actions.prepend(b);
        }
        let meta=card.querySelector('.tec-import-effective-meta'); if(!meta){meta=document.createElement('div');meta.className='tec-history-meta tec-import-effective-meta';card.querySelector('.tec-history-book-head')?.insertAdjacentElement('afterend',meta);}
        const s=this.stats(id), pct=s.effectiveAccuracy==null?'—':`${Math.round(s.effectiveAccuracy*1000)/10}%`;
        meta.textContent=`Métricas consideradas: ${s.effectiveAttempts} tentativa(s) · ${s.effectiveCorrect} acerto(s) · ${s.effectiveWrong} erro(s) · ${pct}`+(s.excludedQuestions?` · ${s.excludedQuestions} questão(ões) desconsiderada(s)`:``);
      }
    },

    ensureModal() {
      let root=document.getElementById('tec-import-manager-modal'); if(root)return root;
      root=document.createElement('div');root.id='tec-import-manager-modal';root.className='tec-import-modal';root.hidden=true;
      root.innerHTML=`
        <div class="tec-import-backdrop" data-import-action="close"></div>
        <section class="tec-import-sheet" role="dialog" aria-modal="true" aria-labelledby="tec-import-title">
          <header class="tec-import-head">
            <div><div class="eyebrow">Gestão de importações TEC</div><h2 id="tec-import-title">Caderno</h2><p id="tec-import-subtitle" class="sub"></p></div>
            <div class="tec-import-head-actions"><button type="button" class="btn-secondary" data-import-action="validate">Validar no TEC</button><button type="button" class="btn-secondary" data-import-action="export">Exportar gestão</button><button type="button" class="btn-icon" aria-label="Fechar" data-import-action="close">×</button></div>
          </header>
          <div id="tec-import-summary" class="tec-import-summary"></div>
          <div class="tec-import-filters" aria-label="Filtros do caderno">
            <label class="tec-import-search"><span>Buscar</span><input id="tec-import-q" type="search" placeholder="ID, enunciado, matéria, assunto…"></label>
            <label><span>Status</span><select id="tec-import-status"><option value="all">Todos</option><option value="correct">Acertos</option><option value="wrong">Erros</option><option value="verified">Verificadas</option><option value="unverified">Não verificadas</option><option value="excluded">Desconsideradas</option><option value="considered">Consideradas</option><option value="missing-content">Conteúdo incompleto</option></select></label>
            <label><span>Revisão</span><select id="tec-import-reviewed"><option value="all">Todas</option><option value="reviewed">Revisadas por mim</option><option value="pending">Pendentes</option></select></label>
            <label><span>Matéria</span><select id="tec-import-materia"><option value="">Todas</option></select></label>
            <label><span>Assunto</span><select id="tec-import-assunto"><option value="">Todos</option></select></label>
            <label><span>Banca</span><select id="tec-import-banca"><option value="">Todas</option></select></label>
            <label><span>Concurso</span><select id="tec-import-concurso"><option value="">Todos</option></select></label>
            <label><span>Minha resposta</span><select id="tec-import-marcada"><option value="">Todas</option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option></select></label>
            <label><span>Gabarito</span><select id="tec-import-correta"><option value="">Todos</option><option>A</option><option>B</option><option>C</option><option>D</option><option>E</option></select></label>
            <label><span>De</span><input id="tec-import-from" type="date"></label>
            <label><span>Até</span><input id="tec-import-to" type="date"></label>
            <label><span>Mín. tentativas</span><input id="tec-import-min" type="number" min="0" step="1" value="0"></label>
            <label><span>Ordenar</span><select id="tec-import-sort"><option value="id-asc">ID crescente</option><option value="id-desc">ID decrescente</option><option value="attempts-desc">Mais tentativas</option><option value="accuracy-asc">Pior taxa</option><option value="accuracy-desc">Melhor taxa</option><option value="date-desc">Mais recentes</option><option value="materia">Matéria</option><option value="assunto">Assunto</option></select></label>
            <label><span>Por página</span><select id="tec-import-page-size"><option>25</option><option selected>50</option><option>100</option><option>250</option></select></label>
          </div>
          <div class="tec-import-toolbar">
            <div id="tec-import-count" class="hint"></div>
            <div class="tec-import-toolbar-actions"><button type="button" class="btn-secondary" data-import-action="select-filtered">Selecionar filtradas</button><button type="button" class="btn-secondary" data-import-action="clear-selection">Limpar seleção</button><button type="button" class="btn-secondary" data-import-action="exclude-selected">Desconsiderar selecionadas</button><button type="button" class="btn-secondary" data-import-action="include-selected">Considerar selecionadas</button></div>
          </div>
          <div class="tec-import-table-wrap"><table class="tec-import-table"><thead><tr><th><span class="sr-only">Selecionar</span></th><th>Questão</th><th>Resultado</th><th>Histórico</th><th>Matéria / assunto</th><th>Banca / concurso</th><th>Data</th><th>Governança</th><th></th></tr></thead><tbody id="tec-import-tbody"></tbody></table></div>
          <footer class="tec-import-pager"><button type="button" class="btn-secondary" data-import-action="prev">← Anterior</button><span id="tec-import-page-label"></span><button type="button" class="btn-secondary" data-import-action="next">Próxima →</button></footer>
        </section>`;
      document.body.append(root); this.ensureDetail(); return root;
    },
    ensureDetail() {
      let root=document.getElementById('tec-import-detail-modal'); if(root)return root;
      root=document.createElement('div');root.id='tec-import-detail-modal';root.className='tec-import-modal tec-import-detail-modal';root.hidden=true;
      root.innerHTML=`<div class="tec-import-backdrop" data-import-detail-action="close"></div><section class="tec-import-sheet tec-import-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="tec-import-detail-title"><header class="tec-import-head"><div><div class="eyebrow">Auditoria da questão</div><h2 id="tec-import-detail-title">Questão</h2><p id="tec-import-detail-subtitle" class="sub"></p></div><button type="button" class="btn-icon" aria-label="Fechar" data-import-detail-action="close">×</button></header><div id="tec-import-detail-body" class="tec-import-detail-body"></div></section>`;
      document.body.append(root);return root;
    },
    fillSelect(id, values, current) {
      const sel=document.getElementById(id); if(!sel)return;
      const first=sel.options[0]?{value:sel.options[0].value,label:sel.options[0].textContent}:null;sel.replaceChildren();
      if(first){const o=document.createElement('option');o.value=first.value;o.textContent=first.label;sel.append(o);}
      [...new Set(values.map(text).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;sel.append(o);});
      sel.value=current||'';
    },
    syncFilterOptions(rows) {
      this.fillSelect('tec-import-materia',rows.map(r=>r.materia),this._filters.materia);
      this.fillSelect('tec-import-assunto',rows.map(r=>r.assunto),this._filters.assunto);
      this.fillSelect('tec-import-banca',rows.map(r=>r.banca),this._filters.banca);
      this.fillSelect('tec-import-concurso',rows.map(r=>r.concurso),this._filters.concurso);
    },
    matches(r) {
      const f=this._filters, hay=norm([r.questionId,r.enunciado,r.materia,r.assunto,r.banca,r.concurso].join(' ')), q=norm(f.query);
      if(q&&!hay.includes(q))return false;
      if(f.materia&&r.materia!==f.materia)return false;if(f.assunto&&r.assunto!==f.assunto)return false;if(f.banca&&r.banca!==f.banca)return false;if(f.concurso&&r.concurso!==f.concurso)return false;
      if(f.marcada&&r.marcada!==f.marcada)return false;if(f.correta&&r.correta!==f.correta)return false;
      if(f.from&&(!r.date||r.date<f.from))return false;if(f.to&&(!r.date||r.date>f.to))return false;
      if(r.history.total<num(f.minAttempts))return false;
      if(f.reviewed==='reviewed'&&!r.decision.reviewed)return false;if(f.reviewed==='pending'&&r.decision.reviewed)return false;
      if(f.status==='correct'&&r.acertou!==true)return false;if(f.status==='wrong'&&r.acertou!==false)return false;
      if(f.status==='verified'&&!(r.trust&&r.trust.trusted))return false;if(f.status==='unverified'&&r.trust&&r.trust.trusted)return false;
      if(f.status==='excluded'&&!r.decision.excluded)return false;if(f.status==='considered'&&r.decision.excluded)return false;
      if(f.status==='missing-content'&&r.enunciado&&Array.isArray(r.question.alternativas)&&r.question.alternativas.length>=2)return false;
      return true;
    },
    sortRows(rows) {
      const sort=this._filters.sort, rate=r=>r.history.total?r.history.acertos/r.history.total:2, idn=r=>Number(r.questionId)||0;
      return [...rows].sort((a,b)=>{
        if(sort==='id-desc')return idn(b)-idn(a)||b.questionId.localeCompare(a.questionId);
        if(sort==='attempts-desc')return b.history.total-a.history.total||idn(a)-idn(b);
        if(sort==='accuracy-asc')return rate(a)-rate(b)||b.history.total-a.history.total;
        if(sort==='accuracy-desc')return rate(b)-rate(a)||b.history.total-a.history.total;
        if(sort==='date-desc')return text(b.date).localeCompare(text(a.date))||idn(a)-idn(b);
        if(sort==='materia')return a.materia.localeCompare(b.materia,'pt-BR')||a.assunto.localeCompare(b.assunto,'pt-BR');
        if(sort==='assunto')return a.assunto.localeCompare(b.assunto,'pt-BR')||a.materia.localeCompare(b.materia,'pt-BR');
        return idn(a)-idn(b)||a.questionId.localeCompare(b.questionId);
      });
    },
    filteredRows() { return this.sortRows(this.rows(this._activeBook).filter(r=>this.matches(r))); },

    open(bookId) {
      const id=text(bookId);if(!id)return;
      this._activeBook=id;this._selected.clear();this._detailQuestion=null;this._filters={...this._filters,query:'',status:'all',reviewed:'all',materia:'',assunto:'',banca:'',concurso:'',marcada:'',correta:'',from:'',to:'',minAttempts:0,page:1};
      const modal=this.ensureModal();modal.hidden=false;document.body.classList.add('tec-import-open');this.renderModal();
      const input=document.getElementById('tec-import-q');if(input)setTimeout(()=>input.focus(),0);
    },
    close() { const m=document.getElementById('tec-import-manager-modal');if(m)m.hidden=true;this.closeDetail();this._activeBook=null;this._selected.clear();document.body.classList.remove('tec-import-open'); },
    openDetail(questionId) { this._detailQuestion=text(questionId);this.ensureDetail().hidden=false;this.renderDetail(this._detailQuestion); },
    closeDetail() { const m=document.getElementById('tec-import-detail-modal');if(m)m.hidden=true;this._detailQuestion=null; },

    renderSummary() {
      const root=document.getElementById('tec-import-summary');if(!root||!this._activeBook)return;
      const s=this.stats(this._activeBook), pct=s.effectiveAccuracy==null?'—':`${Math.round(s.effectiveAccuracy*1000)/10}%`, raw=s.accuracy==null?'—':`${Math.round(s.accuracy*1000)/10}%`;
      const cards=[['Questões reconstruídas',s.questions],['Tentativas históricas',s.attempts],['Acertos históricos',s.correct],['Erros históricos',s.wrong],['Taxa bruta',raw],['Tentativas consideradas',s.effectiveAttempts],['Taxa considerada',pct],['Desconsideradas',s.excludedQuestions],['Revisadas por você',s.reviewed],['Conteúdo completo',`${s.contentComplete}/${s.questions}`]];
      root.replaceChildren();for(const [label,value] of cards){const c=document.createElement('div');c.className='tec-import-stat';const v=document.createElement('strong');v.textContent=String(value);const l=document.createElement('span');l.textContent=label;c.append(v,l);root.append(c);}
    },
    renderModal() {
      if(!this._activeBook)return;const modal=this.ensureModal(), all=this.rows(this._activeBook);this.syncFilterOptions(all);
      const title=document.getElementById('tec-import-title');if(title)title.textContent=`Caderno #${this._activeBook}`;
      const subtitle=document.getElementById('tec-import-subtitle');if(subtitle)subtitle.textContent='Visão integral do caderno reconstruído. Os filtros não alteram o dado bruto; “desconsiderar” apenas retira a questão das métricas e pode ser revertido.';
      this.renderSummary();const filtered=this.filteredRows(),count=document.getElementById('tec-import-count');if(count)count.textContent=`${filtered.length} de ${all.length} questão(ões) · ${this._selected.size} selecionada(s)`;
      const pageSize=Math.max(1,num(this._filters.pageSize)||50), pages=Math.max(1,Math.ceil(filtered.length/pageSize));if(this._filters.page>pages)this._filters.page=pages;if(this._filters.page<1)this._filters.page=1;
      const start=(this._filters.page-1)*pageSize, slice=filtered.slice(start,start+pageSize), tbody=document.getElementById('tec-import-tbody');if(tbody){tbody.replaceChildren();for(const r of slice)tbody.append(this.rowNode(r));}
      const label=document.getElementById('tec-import-page-label');if(label)label.textContent=`Página ${this._filters.page} de ${pages}`;
      const prev=modal.querySelector('[data-import-action="prev"]'),next=modal.querySelector('[data-import-action="next"]');if(prev)prev.disabled=this._filters.page<=1;if(next)next.disabled=this._filters.page>=pages;
      const sync=(id,value)=>{const el=document.getElementById(id);if(el&&el.value!==String(value??''))el.value=String(value??'');};
      sync('tec-import-q',this._filters.query);sync('tec-import-status',this._filters.status);sync('tec-import-reviewed',this._filters.reviewed);sync('tec-import-marcada',this._filters.marcada);sync('tec-import-correta',this._filters.correta);sync('tec-import-from',this._filters.from);sync('tec-import-to',this._filters.to);sync('tec-import-min',this._filters.minAttempts);sync('tec-import-sort',this._filters.sort);sync('tec-import-page-size',this._filters.pageSize);
    },
    rowNode(r) {
      const tr=document.createElement('tr');if(r.decision.excluded)tr.classList.add('is-excluded');tr.dataset.questionId=r.questionId;
      const sel=document.createElement('td');const cb=document.createElement('input');cb.type='checkbox';cb.checked=this._selected.has(r.questionId);cb.dataset.importSelect=r.questionId;cb.setAttribute('aria-label',`Selecionar questão ${r.questionId}`);sel.append(cb);
      const q=document.createElement('td');const id=document.createElement('strong');id.textContent=`#${r.questionId}`;const excerpt=document.createElement('div');excerpt.className='tec-import-excerpt';excerpt.textContent=r.enunciado||'Enunciado não capturado';q.append(id,excerpt);
      const result=document.createElement('td');const badge=document.createElement('span');badge.className='tec-import-result '+(r.acertou===true?'ok':r.acertou===false?'bad':'neutral');badge.textContent=r.acertou===true?'Acertou':r.acertou===false?'Errou':'Sem resultado';result.append(badge);const ans=document.createElement('div');ans.className='tec-import-mini';ans.textContent=`Sua: ${r.marcada||'—'} · Gabarito: ${r.correta||'—'}`;result.append(ans);
      const hist=document.createElement('td');const rate=r.history.total?`${Math.round(r.history.acertos/r.history.total*1000)/10}%`:'—';hist.textContent=`${r.history.acertos}/${r.history.total} · ${rate}`;if(r.history.minimumKnown){const min=document.createElement('div');min.className='tec-import-mini';min.textContent='mínimo conhecido';hist.append(min);}
      const tax=document.createElement('td');const m=document.createElement('div');m.textContent=r.materia||'—';const a=document.createElement('div');a.className='tec-import-mini';a.textContent=r.assunto||'—';tax.append(m,a);
      const source=document.createElement('td');const b=document.createElement('div');b.textContent=r.banca||'—';const c=document.createElement('div');c.className='tec-import-mini';c.textContent=r.concurso||'—';source.append(b,c);
      const date=document.createElement('td');date.textContent=r.date||'—';
      const gov=document.createElement('td');const g1=document.createElement('div');g1.className='tec-import-mini';g1.textContent=r.decision.excluded?'⏸ Desconsiderada':'✓ Considerada';const g2=document.createElement('div');g2.className='tec-import-mini';g2.textContent=r.decision.reviewed?'👁 Revisada':'○ Não revisada';const g3=document.createElement('div');g3.className='tec-import-mini';g3.textContent=r.trust&&r.trust.trusted?'🔒 Evidência verificada':`⚠ ${r.trust&&r.trust.reason||'não verificada'}`;gov.append(g1,g2,g3);
      const act=document.createElement('td');const open=document.createElement('button');open.type='button';open.className='btn-secondary btn-sm';open.textContent='Visualizar';open.dataset.importOpenQuestion=r.questionId;act.append(open);
      tr.append(sel,q,result,hist,tax,source,date,gov,act);return tr;
    },

    detailRow(questionId) { return this.rows(this._activeBook).find(r=>r.questionId===text(questionId))||null; },
    renderDetail(questionId) {
      if(!this._activeBook)return;const r=this.detailRow(questionId),root=document.getElementById('tec-import-detail-body');if(!r||!root)return;
      const title=document.getElementById('tec-import-detail-title');if(title)title.textContent=`Questão #${r.questionId}`;
      const sub=document.getElementById('tec-import-detail-subtitle');if(sub)sub.textContent=`Caderno #${r.bookId} · ${r.materia||'sem matéria'} · ${r.assunto||'sem assunto'}`;
      root.replaceChildren();
      const summary=document.createElement('div');summary.className='tec-import-detail-summary';
      const fields=[['Resultado',r.acertou===true?'Acertou':r.acertou===false?'Errou':'—'],['Sua resposta',r.marcada||'—'],['Gabarito',r.correta||'—'],['Data',r.date||'—'],['Banca',r.banca||'—'],['Concurso',r.concurso||'—'],['Histórico',`${r.history.acertos} acerto(s) · ${r.history.erros} erro(s) · ${r.history.total} tentativa(s)`],['Integridade',r.trust&&r.trust.trusted?'Verificada':r.trust&&r.trust.reason||'—']];
      for(const [k,v] of fields){const x=document.createElement('div');const kk=document.createElement('span');kk.textContent=k;const vv=document.createElement('strong');vv.textContent=v;x.append(kk,vv);summary.append(x);}root.append(summary);
      const qsec=document.createElement('section');qsec.className='tec-import-detail-section';const qh=document.createElement('h3');qh.textContent='Enunciado';const qp=document.createElement('p');qp.className='tec-import-statement';qp.textContent=r.enunciado||'Enunciado não capturado pelo TEC nesta reconstrução.';qsec.append(qh,qp);root.append(qsec);
      const alts=document.createElement('section');alts.className='tec-import-detail-section';const ah=document.createElement('h3');ah.textContent='Alternativas';alts.append(ah);const list=document.createElement('div');list.className='tec-import-alternatives';const arr=Array.isArray(r.question.alternativas)?r.question.alternativas:[];
      if(!arr.length){const e=document.createElement('div');e.className='hint';e.textContent='Alternativas não capturadas.';list.append(e);}else for(const a of arr){const l=letter(a.letra)||text(a.letra),item=document.createElement('div');item.className='tec-import-alt';if(l===r.marcada)item.classList.add('is-marked');if(l===r.correta)item.classList.add('is-correct');const key=document.createElement('strong');key.textContent=l||'•';const tx=document.createElement('span');tx.textContent=text(a.texto)||'—';const flags=document.createElement('span');flags.className='tec-import-alt-flags';flags.textContent=[l===r.marcada?'Sua resposta':'',l===r.correta?'Gabarito':''].filter(Boolean).join(' · ');item.append(key,tx,flags);list.append(item);}alts.append(list);root.append(alts);
      const hist=document.createElement('section');hist.className='tec-import-detail-section';const hh=document.createElement('h3');hh.textContent='Histórico de tentativas';hist.append(hh);const attempts=r.history.attempts||[];
      if(!attempts.length){const e=document.createElement('div');e.className='hint';e.textContent=r.history.total?`O TEC informou o agregado (${r.history.total} tentativa(s)), mas não expôs a lista individual completa nesta leitura.`:'Nenhuma tentativa individual exposta.';hist.append(e);}else{const table=document.createElement('table');table.className='tec-import-attempts';table.innerHTML='<thead><tr><th>#</th><th>Data</th><th>Resultado</th><th>Resposta</th><th>Fonte</th></tr></thead><tbody></tbody>';const body=table.querySelector('tbody');attempts.forEach((a,i)=>{const tr=document.createElement('tr');[String(i+1),text(a.resolvedAt)||'—',a.acertou===true?'Acerto':a.acertou===false?'Erro':'—',letter(a.alternativa)||'—',text(a.source)||'—'].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});body.append(tr);});hist.append(table);}root.append(hist);
      const govern=document.createElement('section');govern.className='tec-import-detail-section';const gh=document.createElement('h3');gh.textContent='Governança';govern.append(gh);const actions=document.createElement('div');actions.className='tec-import-detail-actions';
      const exclude=document.createElement('button');exclude.type='button';exclude.className=r.decision.excluded?'btn-primary':'btn-secondary';exclude.dataset.importDetailAction='toggle-excluded';exclude.textContent=r.decision.excluded?'Voltar a considerar nas métricas':'Desconsiderar das métricas';
      const review=document.createElement('button');review.type='button';review.className=r.decision.reviewed?'btn-primary':'btn-secondary';review.dataset.importDetailAction='toggle-reviewed';review.textContent=r.decision.reviewed?'Marcar como não revisada':'Marcar como revisada por mim';actions.append(exclude,review);govern.append(actions);
      const label=document.createElement('label');label.className='tec-import-note';const span=document.createElement('span');span.textContent='Observação de auditoria';const ta=document.createElement('textarea');ta.id='tec-import-detail-note';ta.rows=3;ta.maxLength=4000;ta.placeholder='Ex.: questão anulada, conteúdo fora do edital, classificação conferida…';ta.value=r.decision.note||'';label.append(span,ta);const save=document.createElement('button');save.type='button';save.className='btn-secondary';save.dataset.importDetailAction='save-note';save.textContent='Salvar observação';govern.append(label,save);
      const raw=document.createElement('details');raw.className='tec-import-raw';const rs=document.createElement('summary');rs.textContent='Dados técnicos / proveniência';const pre=document.createElement('pre');pre.textContent=JSON.stringify({bookId:r.bookId,questionId:r.questionId,tecAccount:r.raw.tecAccount||null,history:r.raw.history||null,integrity:r.question.integrity||null,events:this.events(r.bookId,r.questionId)},null,2);raw.append(rs,pre);govern.append(raw);root.append(govern);
    },

    exportManaged(bookId) {
      const id=text(bookId),rows=this.rows(id),payload={schema:1,type:'studynomentor-tec-import-management',generatedAt:now(),bookId:id,summary:this.stats(id),decisions:this.state().books[id]?.decisions||{},questions:rows.map(r=>({questionId:r.questionId,bookId:id,decision:r.decision,question:clone(r.question),history:clone(r.raw.history||null),events:this.events(id,r.questionId)}))};
      try{const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`studynomentor-tec-gestao-caderno-${id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){quiet(e,'tec-import-manager-export');}
      return payload;
    },
    validateActive() { try{if(this._activeBook&&window.TecHistoricalManager&&TecHistoricalManager.validateBook){TecHistoricalManager.validateBook(this._activeBook);if(typeof showToast==='function')showToast(`🔎 Validação integral do caderno #${this._activeBook} iniciada no TEC.`);}}catch(e){quiet(e,'tec-import-manager-validate');} },

    applyFilterInput(target) {
      const map={'tec-import-q':'query','tec-import-status':'status','tec-import-reviewed':'reviewed','tec-import-materia':'materia','tec-import-assunto':'assunto','tec-import-banca':'banca','tec-import-concurso':'concurso','tec-import-marcada':'marcada','tec-import-correta':'correta','tec-import-from':'from','tec-import-to':'to','tec-import-min':'minAttempts','tec-import-sort':'sort','tec-import-page-size':'pageSize'};
      const key=map[target.id];if(!key)return false;this._filters[key]=key==='minAttempts'||key==='pageSize'?num(target.value):target.value;this._filters.page=1;this.renderModal();return true;
    },
    bulkExcluded(excluded) {
      if(!this._activeBook||!this._selected.size)return;const st=this.state(),b=this.bookState(st,this._activeBook);for(const qid of this._selected){const old=b.decisions[qid]||{};b.decisions[qid]={...old,excluded:!!excluded,exclusionReason:excluded?'manual-lote':'',updatedAt:now()};}b.updatedAt=now();this.save(st);this._selected.clear();this.refreshConsumers();
    },

    bind() {
      this.patchReconstruction();this.patchMetrics();this.patchHistoricalManager();this.ensureModal();
      if(this._bound)return;this._bound=true;const self=this;
      document.addEventListener('click',event=>{
        const t=event.target&&event.target.closest?event.target.closest('button,[data-import-manager-open],[data-import-open-question]'):event.target;if(!t)return;
        if(t.dataset&&t.dataset.importManagerOpen){event.preventDefault();self.open(t.dataset.importManagerOpen);return;}
        if(t.dataset&&t.dataset.importOpenQuestion){event.preventDefault();self.openDetail(t.dataset.importOpenQuestion);return;}
        const action=t.dataset&&t.dataset.importAction;if(action){event.preventDefault();
          if(action==='close')self.close();else if(action==='validate')self.validateActive();else if(action==='export')self.exportManaged(self._activeBook);
          else if(action==='prev'){self._filters.page--;self.renderModal();}else if(action==='next'){self._filters.page++;self.renderModal();}
          else if(action==='select-filtered'){self.filteredRows().forEach(r=>self._selected.add(r.questionId));self.renderModal();}
          else if(action==='clear-selection'){self._selected.clear();self.renderModal();}else if(action==='exclude-selected')self.bulkExcluded(true);else if(action==='include-selected')self.bulkExcluded(false);return;
        }
        const d=t.dataset&&t.dataset.importDetailAction;if(d){event.preventDefault();const r=self.detailRow(self._detailQuestion);if(!r)return;
          if(d==='close')self.closeDetail();else if(d==='toggle-excluded'){self.setExcluded(r.bookId,r.questionId,!r.decision.excluded,'manual-detail');self.renderDetail(r.questionId);}else if(d==='toggle-reviewed'){self.setReviewed(r.bookId,r.questionId,!r.decision.reviewed);self.renderDetail(r.questionId);}else if(d==='save-note'){const ta=document.getElementById('tec-import-detail-note');self.setNote(r.bookId,r.questionId,ta&&ta.value||'');if(typeof showToast==='function')showToast('📝 Observação salva.');self.renderDetail(r.questionId);}return;
        }
        if(t.dataset&&t.dataset.importDetailAction==='close')self.closeDetail();
      });
      document.addEventListener('change',event=>{
        const t=event.target;if(!t)return;
        if(t.dataset&&t.dataset.importSelect){t.checked?self._selected.add(t.dataset.importSelect):self._selected.delete(t.dataset.importSelect);self.renderModal();return;}
        self.applyFilterInput(t);
      });
      document.addEventListener('input',event=>{const t=event.target;if(t&&['tec-import-q','tec-import-min','tec-import-from','tec-import-to'].includes(t.id))self.applyFilterInput(t);});
      document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const detail=document.getElementById('tec-import-detail-modal'),modal=document.getElementById('tec-import-manager-modal');if(detail&&!detail.hidden){self.closeDetail();event.preventDefault();}else if(modal&&!modal.hidden){self.close();event.preventDefault();}});
    }
  };

  window.TecImportManager=IM;
  const boot=()=>{try{IM.bind();IM.decorateHistoryCards();}catch(e){quiet(e,'tec-import-manager-boot');}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  setTimeout(boot,1000);setTimeout(boot,3000);
})();
