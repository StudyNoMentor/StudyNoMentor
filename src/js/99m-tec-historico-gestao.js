/* ============================================================================
   TEC — GESTÃO E VALIDAÇÃO DOS HISTÓRICOS RECONSTRUÍDOS
   ----------------------------------------------------------------------------
   Camada de governança por caderno:
   · inventaria fontes e dados locais;
   · compara o retrato local com uma nova leitura REAL do TEC;
   · nunca converte divergência ou leitura parcial em dado validado;
   · exporta auditoria por caderno;
   · permite remover/arquivar dados locais sem o ledger reidratá-los sozinho.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecHistoricoGestao) return;
  window.__tecHistoricoGestao = true;

  const KEY_SUFFIX='tec-historico-gestao';
  const SCHEMA=1;
  const quiet=(e,ctx)=>{try{if(typeof _quiet==='function')_quiet(e,ctx);}catch(ignored){console.warn('[TEC histórico]',ctx,e,ignored);}};
  const now=()=>new Date().toISOString();
  const text=v=>String(v==null?'':v).trim();
  const num=v=>Number.isFinite(Number(v))?Math.max(0,Number(v)):0;
  const letter=v=>{const m=String(v==null?'':v).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);return m?m[1]:null;};
  const fnv=value=>{let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(36);};
  const stable=value=>{
    if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
    return JSON.stringify(value);
  };
  const clone=value=>{try{return JSON.parse(JSON.stringify(value));}catch(e){quiet(e,'tec-history-clone');return value;}};
  const knownAccount=value=>{
    const v=text(value).toLowerCase();
    return !!v&&!['conta-importada','conta-reconstruida','conta-nao-identificada','conta'].includes(v)&&!v.startsWith('session-random');
  };

  const M={
    _patched:false,
    _cloudPatched:false,
    _bound:false,
    _selectedBook:null,
    _validationIntentBook:null,
    _suppressedCloudRows:0,

    key(){try{return DB._profilePrefix()+KEY_SUFFIX;}catch(e){quiet(e,'tec-history-key');return'diario-estudos:'+KEY_SUFFIX;}},
    blank(){return{schema:SCHEMA,books:{},runs:{},updatedAt:null};},
    state(){
      try{
        const st=JSON.parse(localStorage.getItem(this.key())||'null');
        return st&&st.schema===SCHEMA&&st.books&&st.runs?st:this.blank();
      }catch(e){quiet(e,'tec-history-state');return this.blank();}
    },
    save(st){
      st.updatedAt=now();
      try{
        localStorage.setItem(this.key(),JSON.stringify(st));
        if(typeof SectionSync!=='undefined'&&SectionSync.markDirty)SectionSync.markDirty(this.key());
        if(window.CloudStore&&CloudStore.notifyChange)CloudStore.notifyChange();
        return true;
      }catch(e){quiet(e,'tec-history-save');return false;}
    },
    rowSummary(row){
      const q=row&&row.question||{};
      const h=row&&row.history||{};
      const latest=row&&row.latest||{};
      const id=text(row&&row.questionId||q.id);
      if(!id)return null;
      const acertou=typeof latest.acertou==='boolean'?latest.acertou:(typeof q.acertou==='boolean'?q.acertou:null);
      return{
        questionId:id,
        history:{total:num(h.total),acertos:num(h.acertos),erros:num(h.erros)},
        latest:{
          acertou,
          marcada:letter(latest.marcada||q.marcada),
          correta:letter(latest.correta||q.correta),
          data:text(latest.dataResolucao||q.dataResolucao||q.resolvedAt||'')||null
        },
        materia:text(q.materia),assunto:text(q.assunto),banca:text(q.banca)
      };
    },
    snapshotFromRows(rows){
      const out={};
      for(const row of Array.isArray(rows)?rows:[]){const s=this.rowSummary(row);if(s)out[s.questionId]=s;}
      return out;
    },
    snapshotFromLocal(bookId){
      const out={};
      try{
        const T=window.TecIntegracaoScreen,st=T&&T.state?T.state():null;
        for(const row of Object.values(st&&st.questions||{})){
          if(String(row&&row.bookId||'')!==String(bookId))continue;
          const s=this.rowSummary({questionId:row.question&&row.question.id,question:row.question,history:row.history,latest:null});
          if(s)out[s.questionId]=s;
        }
      }catch(e){quiet(e,'tec-history-local-snapshot');}
      return out;
    },
    digestSnapshot(snapshot){
      const rows=Object.values(snapshot||{}).sort((a,b)=>String(a.questionId).localeCompare(String(b.questionId)));
      return fnv(stable(rows));
    },
    compareSnapshots(localSnapshot,tecSnapshot){
      const local=localSnapshot||{},tec=tecSnapshot||{};
      const ids=[...new Set([...Object.keys(local),...Object.keys(tec)])].sort((a,b)=>String(a).localeCompare(String(b)));
      const report={totalLocal:Object.keys(local).length,totalTec:Object.keys(tec).length,matched:0,changed:0,localOnly:0,tecOnly:0,exact:false,differences:[]};
      const fields=[['history','total'],['history','acertos'],['history','erros'],['latest','acertou'],['latest','marcada'],['latest','correta'],['latest','data']];
      for(const id of ids){
        const a=local[id],b=tec[id];
        if(!a){report.tecOnly++;report.differences.push({questionId:id,type:'tec-only'});continue;}
        if(!b){report.localOnly++;report.differences.push({questionId:id,type:'local-only'});continue;}
        const diff=[];
        for(const [group,key] of fields){
          const av=a[group]&&a[group][key],bv=b[group]&&b[group][key];
          if(key==='data'&&(!av||!bv))continue;
          if(av!==bv)diff.push({field:`${group}.${key}`,local:av??null,tec:bv??null});
        }
        if(diff.length){report.changed++;report.differences.push({questionId:id,type:'changed',fields:diff});}
        else report.matched++;
      }
      report.exact=report.changed===0&&report.localOnly===0&&report.tecOnly===0&&report.totalLocal===report.totalTec;
      return report;
    },
    currentBookStats(bookId){
      let questions=0,aggregateAttempts=0,events=0,account='';
      try{
        const T=window.TecIntegracaoScreen,st=T&&T.state?T.state():null;
        for(const row of Object.values(st&&st.questions||{})){
          if(String(row&&row.bookId||'')!==String(bookId))continue;
          questions++;aggregateAttempts+=num(row&&row.history&&row.history.total);account=account||text(row&&row.tecAccount);
        }
      }catch(e){quiet(e,'tec-history-current-library');}
      try{
        const R=window.TecRealtime,st=R&&R.state?R.state():null;
        for(const ev of Object.values(st&&st.events||{}))if(String(ev&&ev.bookId||'')===String(bookId)){events++;account=account||text(ev&&ev.tecAccount);}
      }catch(e){quiet(e,'tec-history-current-events');}
      return{questions,aggregateAttempts,events,account};
    },
    touchBook(bookId,patch={}){
      if(!bookId)return null;
      const st=this.state(),id=String(bookId),old=st.books[id]||{bookId:id,firstSeenAt:now(),sources:[]};
      const next={...old,...patch,bookId:id,lastSeenAt:now()};
      const source=text(patch.source);
      next.sources=[...new Set([...(old.sources||[]),...(patch.sources||[]),...(source?[source]:[])])].filter(Boolean);
      delete next.source;
      st.books[id]=next;this.save(st);return next;
    },
    isSuppressedBook(bookId){
      const book=this.state().books[String(bookId||'')];
      return !!(book&&book.suppressed);
    },
    setSuppressed(bookId,suppressed,reason='manual'){
      const id=String(bookId||'');if(!id)return null;
      return this.touchBook(id,{suppressed:!!suppressed,suppressionReason:reason,suppressedAt:suppressed?now():null,restoredAt:suppressed?null:now()});
    },
    beginRun(requestId,bookId,mode='reconstruction'){
      if(!requestId||!bookId)return null;
      const st=this.state(),baseline=this.snapshotFromLocal(bookId);
      st.runs[String(requestId)]={requestId:String(requestId),bookId:String(bookId),mode:String(mode),startedAt:now(),baseline,baselineDigest:this.digestSnapshot(baseline),live:{}};
      this.save(st);return st.runs[String(requestId)];
    },
    recordRunRows(requestId,bookId,rows){
      if(!requestId||!bookId)return;
      const st=this.state();let run=st.runs[String(requestId)];
      if(!run){run={requestId:String(requestId),bookId:String(bookId),mode:'reconstruction',startedAt:now(),baseline:this.snapshotFromLocal(bookId),live:{}};run.baselineDigest=this.digestSnapshot(run.baseline);}
      Object.assign(run.live,this.snapshotFromRows(rows));st.runs[String(requestId)]=run;this.save(st);
    },
    finishRun(requestId,bookId,source='caderno',summary={},freshAccount='',expectedAccount=''){
      const st=this.state(),run=st.runs[String(requestId||'')];if(!run)return null;
      const live=run.live||{},baseline=run.baseline||{},report=this.compareSnapshots(baseline,live),liveDigest=this.digestSnapshot(live);
      const hadBaseline=Object.keys(baseline).length>0;
      const processed=num(summary&&summary.processed),total=num(summary&&summary.total),failedQuestions=num(summary&&summary.failedQuestions);
      const incomplete=failedQuestions>0||(total>0&&processed<total);
      const stored=text(expectedAccount||st.books[String(bookId)]&&st.books[String(bookId)].account),fresh=text(freshAccount||summary&&summary.tecAccount);
      const accountMismatch=knownAccount(stored)&&knownAccount(fresh)&&stored!==fresh;
      let status;
      if(accountMismatch)status='account-mismatch';
      else if(incomplete)status='partial';
      else status=hadBaseline?(report.exact?'validated':'divergent'):'captured';
      const current=st.books[String(bookId)]||{bookId:String(bookId),firstSeenAt:now(),sources:[]};
      current.lastSeenAt=now();current.sources=[...new Set([...(current.sources||[]),source,'live-tec'])];
      current.validation={
        status,origin:'live-tec',validatedAt:status==='validated'?now():null,capturedAt:now(),baselineDigest:run.baselineDigest,tecDigest:liveDigest,mode:run.mode,report,
        completeness:{processed,total,failedQuestions,incomplete},
        account:{stored:stored||null,fresh:fresh||null,mismatch:accountMismatch}
      };
      st.books[String(bookId)]=current;delete st.runs[String(requestId)];this.save(st);this.render();return current.validation;
    },
    markImported(bookId,account,source){
      const b=this.touchBook(bookId,{account:text(account),sources:[source],importedAt:now(),suppressed:false});
      if(b&&b.validation&&['validated','divergent','partial','account-mismatch'].includes(b.validation.status)){
        b.validation={...b.validation,status:'stale',staleAt:now(),reason:'dados-importados-alteraram-o-retrato-local'};
        const st=this.state();st.books[String(bookId)]=b;this.save(st);
      }
      this.render();
    },
    validateBook(bookId){
      const H=window.TecHistoricalReconstruction;if(!H)return;
      const id=String(bookId);
      this.setSuppressed(id,false,'validacao-real-tec');
      const input=document.getElementById('tec-reconstruction-input');if(input)input.value=id;
      this._validationIntentBook=id;
      H.start();
      const active=H.state&&H.state().active;
      if(active&&String(active.bookId)===id&&active.requestId){
        const st=this.state();if(!st.runs[String(active.requestId)])this.beginRun(active.requestId,id,'validation');
      }else this._validationIntentBook=null;
      this._selectedBook=id;this.render();
    },
    exportBook(bookId){
      const id=String(bookId),management=this.state().books[id]||null,questions=[],events=[];
      try{const T=window.TecIntegracaoScreen,st=T&&T.state?T.state():null;for(const row of Object.values(st&&st.questions||{}))if(String(row&&row.bookId||'')===id)questions.push(clone(row));}catch(e){quiet(e,'tec-history-export-questions');}
      try{const R=window.TecRealtime,st=R&&R.state?R.state():null;for(const ev of Object.values(st&&st.events||{}))if(String(ev&&ev.bookId||'')===id)events.push(clone(ev));}catch(e){quiet(e,'tec-history-export-events');}
      const payload={schema:1,type:'studynomentor-tec-book-audit',generatedAt:now(),bookId:id,management,questions,events};
      try{
        const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download=`studynomentor-tec-caderno-${id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }catch(e){quiet(e,'tec-history-export');}
      return payload;
    },
    removeLocalBook(bookId,{skipConfirm=false}={}){
      const id=String(bookId);
      if(!skipConfirm&&typeof confirm==='function'&&!confirm(`Remover do StudyNoMentor todos os dados LOCAIS do caderno #${id}? O ledger de auditoria não será reescrito e o caderno ficará arquivado localmente até você restaurar e validar no TEC.`))return false;
      let removedQuestions=0,removedEvents=0;
      try{
        const T=window.TecIntegracaoScreen,st=T&&T.state?T.state():null;if(st){
          for(const [key,row] of Object.entries(st.questions||{}))if(String(row&&row.bookId||'')===id){delete st.questions[key];removedQuestions++;for(const ak of Object.keys(st.analyses||{}))if(ak.startsWith(key+':'))delete st.analyses[ak];}
          T.save(st);if(T.selectedKey&&!st.questions[T.selectedKey])T.selectedKey=null;if(T.render)T.render();
        }
      }catch(e){quiet(e,'tec-history-remove-questions');}
      try{
        const R=window.TecRealtime,st=R&&R.state?R.state():null;if(st){
          for(const [key,ev] of Object.entries(st.events||{}))if(String(ev&&ev.bookId||'')===id){delete st.events[key];removedEvents++;}
          const times=Object.values(st.events||{}).map(x=>text(x&&x.receivedAt||x&&x.resolvedAt)).filter(Boolean).sort();st.lastEventAt=times.at(-1)||null;
          R.save(st);if(R.render)R.render();
        }
      }catch(e){quiet(e,'tec-history-remove-events');}
      this.touchBook(id,{localRemovedAt:now(),removedQuestions,removedEvents,suppressed:true,suppressedAt:now(),suppressionReason:'manual-local-removal'});this.render();
      if(typeof showToast==='function')showToast(`🗑️ Caderno #${id}: ${removedQuestions} questão(ões) e ${removedEvents} evento(s) locais removidos e arquivados.`);
      return true;
    },
    statusLabel(book){
      if(book&&book.suppressed)return'⏸ Arquivado localmente';
      const s=book&&book.validation&&book.validation.status;
      if(s==='validated')return'✓ Validado com o TEC';
      if(s==='divergent')return'⚠ Divergências com o TEC';
      if(s==='partial')return'⚠ Leitura TEC incompleta';
      if(s==='account-mismatch')return'⚠ Conta TEC divergente';
      if(s==='stale')return'↻ Validação desatualizada';
      if(s==='captured')return'◉ Capturado do TEC';
      return'○ Ainda não validado';
    },
    patchCloudSuppression(){
      const C=window.TecCloudLedger;if(!C||this._cloudPatched||typeof C.mergeRows!=='function')return;
      this._cloudPatched=true;const original=C.mergeRows.bind(C),self=this;
      C.mergeRows=function(rows){
        const allowed=[],blocked=[];
        for(const row of Array.isArray(rows)?rows:[]){
          const bookId=text(row&&row.book_id||row&&row.payload&&row.payload.bookId||row&&row.payload&&row.payload.resolution&&row.payload.resolution.bookId||row&&row.payload&&row.payload.question&&row.payload.question.cadernoId);
          if(bookId&&self.isSuppressedBook(bookId))blocked.push(row);else allowed.push(row);
        }
        self._suppressedCloudRows+=blocked.length;
        const result=original(allowed)||{};
        return{...result,suppressed:(result.suppressed||0)+blocked.length};
      };
    },
    ensureStyle(){
      if(document.getElementById('tec-history-manager-style'))return;
      const style=document.createElement('style');style.id='tec-history-manager-style';style.textContent=`
        .tec-history-manager-list{display:grid;gap:10px}.tec-history-book{border:1px solid var(--border);border-radius:12px;padding:12px;background:var(--surface-sunken)}
        .tec-history-book-head{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.tec-history-book strong{font-size:13px}.tec-history-meta{font-size:12px;color:var(--text-soft);line-height:1.5}
        .tec-history-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.tec-history-actions button{font-size:12px}.tec-history-report{margin-top:9px;padding-top:9px;border-top:1px dashed var(--border);font-size:12px;color:var(--text-soft);line-height:1.5}
        .tec-history-badge{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:3px 8px;font-size:11px;background:var(--surface)}
      `;document.head.appendChild(style);
    },
    ensureCard(){
      const screen=document.getElementById('screen-integracaotec');if(!screen)return null;
      let card=document.getElementById('tec-history-manager-card');if(card)return card;
      card=document.createElement('section');card.id='tec-history-manager-card';card.className='card';
      const header=document.createElement('div');header.className='card-header';const wrap=document.createElement('div');const h=document.createElement('h2');h.textContent='🧾 Gestão dos históricos TEC';const p=document.createElement('p');p.className='sub';p.textContent='Gerencie cada caderno reconstruído/importado e valide o retrato local contra uma nova leitura real do TEC. Divergências, leituras parciais e conta diferente ficam explícitas; nenhuma tentativa é inventada.';wrap.append(h,p);header.append(wrap);
      const body=document.createElement('div');body.style.cssText='padding:14px 28px 22px;display:grid;gap:10px';const list=document.createElement('div');list.id='tec-history-manager-list';list.className='tec-history-manager-list';body.append(list);card.append(header,body);
      const anchor=document.getElementById('tec-reconstruction-card');if(anchor)anchor.insertAdjacentElement('afterend',card);else screen.prepend(card);return card;
    },
    allBookIds(){
      const ids=new Set(Object.keys(this.state().books||{}));
      try{const T=window.TecIntegracaoScreen,st=T&&T.state?T.state():null;for(const row of Object.values(st&&st.questions||{}))if(row&&row.bookId)ids.add(String(row.bookId));}catch(e){quiet(e,'tec-history-book-ids-library');}
      try{const R=window.TecRealtime,st=R&&R.state?R.state():null;for(const ev of Object.values(st&&st.events||{}))if(ev&&ev.bookId)ids.add(String(ev.bookId));}catch(e){quiet(e,'tec-history-book-ids-events');}
      return[...ids].filter(Boolean).sort((a,b)=>Number(b)-Number(a)||String(a).localeCompare(String(b)));
    },
    render(){
      this.ensureStyle();this.ensureCard();const root=document.getElementById('tec-history-manager-list');if(!root)return;root.replaceChildren();
      const st=this.state(),ids=this.allBookIds();if(!ids.length){const empty=document.createElement('div');empty.className='hint';empty.textContent='Nenhum caderno reconstruído/importado ainda.';root.append(empty);return;}
      for(const id of ids){
        const book=st.books[id]||{bookId:id,sources:[]},stats=this.currentBookStats(id),box=document.createElement('article');box.className='tec-history-book';box.dataset.bookId=id;
        const head=document.createElement('div');head.className='tec-history-book-head';const left=document.createElement('div');const title=document.createElement('strong');title.textContent=`Caderno #${id}`;const meta=document.createElement('div');meta.className='tec-history-meta';meta.textContent=`${stats.questions} questão(ões) · ${stats.aggregateAttempts} tentativa(s) agregadas · ${stats.events} evento(s) verificáveis`+(stats.account?` · conta ${stats.account}`:'');left.append(title,meta);const badge=document.createElement('span');badge.className='tec-history-badge';badge.textContent=this.statusLabel(book);head.append(left,badge);box.append(head);
        const src=document.createElement('div');src.className='tec-history-meta';src.textContent=`Fontes: ${(book.sources||[]).join(', ')||'dados locais existentes'}`+(book.validation&&book.validation.validatedAt?` · validado em ${new Date(book.validation.validatedAt).toLocaleString()}`:'')+(book.suppressed?' · reidratação automática bloqueada':'');box.append(src);
        const actions=document.createElement('div');actions.className='tec-history-actions';
        const mk=(label,action,primary=false)=>{const b=document.createElement('button');b.type='button';b.className=primary?'btn-primary':'btn-secondary';b.textContent=label;b.dataset.historyAction=action;b.dataset.bookId=id;actions.append(b);};
        mk(book.suppressed?'Restaurar e validar no TEC':'Validar no TEC','validate',true);mk('Exportar auditoria','export');mk('Detalhes','details');mk('Remover local','remove');box.append(actions);
        const report=document.createElement('div');report.className='tec-history-report';report.hidden=this._selectedBook!==id;report.dataset.historyReport=id;
        const validation=book.validation,vr=validation&&validation.report;
        if(vr){
          report.textContent=`Comparação TEC: ${vr.matched} questão(ões) idênticas · ${vr.changed} alteradas · ${vr.localOnly} apenas no Study · ${vr.tecOnly} apenas no TEC.`;
          if(validation.completeness&&validation.completeness.incomplete){const line=document.createElement('div');line.textContent=`Leitura incompleta: ${validation.completeness.processed}/${validation.completeness.total||'?'} processadas · ${validation.completeness.failedQuestions} falha(s).`;report.append(line);}
          if(validation.account&&validation.account.mismatch){const line=document.createElement('div');line.textContent=`Conta divergente: histórico ${validation.account.stored||'—'} × TEC atual ${validation.account.fresh||'—'}.`;report.append(line);}
          const diffs=(vr.differences||[]).slice(0,12);for(const d of diffs){const line=document.createElement('div');line.textContent=`#${d.questionId}: ${d.type}`+(d.fields&&d.fields.length?` — ${d.fields.map(x=>x.field).join(', ')}`:'');report.append(line);}if((vr.differences||[]).length>12){const more=document.createElement('div');more.textContent=`+ ${(vr.differences||[]).length-12} divergência(s) adicionais no relatório exportável.`;report.append(more);}
        }else report.textContent=book.suppressed?'Caderno arquivado localmente. O ledger não o reidrata. Use “Restaurar e validar no TEC” para reconstruir a partir da fonte real.':'Sem comparação com o TEC ainda. Use “Validar no TEC” para abrir o caderno real em segundo plano e confrontar os dados.';
        box.append(report);root.append(box);
      }
    },
    patchLegacyOfficialPrecedence(H){
      if(H.__historyOfficialPatched||typeof H.rowsFromLegacyJSON!=='function')return;H.__historyOfficialPatched=true;
      const original=H.rowsFromLegacyJSON.bind(H);
      H.rowsFromLegacyJSON=data=>{
        const rows=original(data);
        for(const row of rows){
          const id=String(row&&row.questionId||''),official=data&&data.resultadosOficiais&&data.resultadosOficiais[id],fallback=data&&data.resultados&&data.resultados[id];
          if(!official)continue;
          const q=row.question||{},canonical=typeof official.acertou==='boolean'?official.acertou:(typeof fallback?.acertou==='boolean'?fallback.acertou:q.acertou);
          if(typeof canonical==='boolean')q.acertou=canonical;
          const marked=letter(q.marcada),correct=letter(q.correta),verified=!!(marked&&correct&&typeof q.acertou==='boolean'&&q.acertou===(marked===correct));
          q.integrity={...(q.integrity||{}),schema:3,status:verified?'verified':'conflict',confidence:verified?'high':'low',source:'tampermonkey-json-official-preferred',marked,correct,canonicalResult:q.acertou,reportedResult:q.acertou,conflict:!verified,reconstructed:true};
          row.question=q;row.latest={...(row.latest||{}),dataResolucao:official.dataResolucao||fallback?.dataResolucao||q.dataResolucao||null,acertou:q.acertou,marcada:marked,correta:correct,verified};
          row.reconstruction={...(row.reconstruction||{}),source:'tampermonkey-json-official-preferred',exactLatest:verified};
        }
        return rows;
      };
    },
    patch(){
      const H=window.TecHistoricalReconstruction;if(!H||this._patched)return;this._patched=true;this.patchLegacyOfficialPrecedence(H);
      const originalStart=typeof H.start==='function'?H.start.bind(H):null,originalIngest=H.ingestBatch.bind(H),originalWrite=H.writeBook.bind(H),self=this;
      if(originalStart)H.start=function(...args){
        const ret=originalStart(...args);
        try{
          const active=this.state&&this.state().active;
          if(active&&active.requestId&&active.bookId){
            const runs=self.state().runs||{};
            if(!runs[String(active.requestId)]){
              const intent=self._validationIntentBook&&String(self._validationIntentBook)===String(active.bookId)?'validation':'reconstruction';
              self.beginRun(active.requestId,active.bookId,intent);
            }
            if(self._validationIntentBook&&String(self._validationIntentBook)===String(active.bookId))self._validationIntentBook=null;
          }
        }catch(e){quiet(e,'tec-history-start-baseline');}
        return ret;
      };
      H.ingestBatch=function(payload,opts={}){
        const active=this.state&&this.state().active,requestId=active&&active.requestId,bookId=String(payload&&payload.bookId||active&&active.bookId||'');
        if(requestId&&bookId){const runs=self.state().runs||{};if(!runs[String(requestId)])self.beginRun(requestId,bookId,'reconstruction');}
        const out=originalIngest(payload,opts);
        if(requestId&&bookId)self.recordRunRows(requestId,bookId,payload&&payload.rows||[]);
        return out;
      };
      H.writeBook=function(bookId,account,stats,extra={}){
        const active=this.state&&this.state().active,requestId=active&&active.requestId,id=String(bookId||''),before=self.state().books[id]||{},ret=originalWrite(bookId,account,stats,extra),source=String(extra&&extra.source||'caderno');
        let validation=null;
        if(requestId)validation=self.finishRun(requestId,id,source,extra&&extra.companionSummary||extra,account,before.account);
        const safeAccount=validation&&validation.status==='account-mismatch'?before.account:(text(account)||before.account||'');
        self.touchBook(id,{account:safeAccount,sources:[source],lastStats:clone(stats),suppressed:false});
        if(source==='tampermonkey-json')self.markImported(id,account,source);
        self.render();return ret;
      };
    },
    bind(){
      this.patch();this.patchCloudSuppression();this.ensureStyle();this.ensureCard();this.render();
      if(!this._bound){this._bound=true;document.addEventListener('click',event=>{
        const b=event.target&&event.target.closest&&event.target.closest('[data-history-action]');if(!b)return;
        const action=b.dataset.historyAction,id=b.dataset.bookId;if(!action||!id)return;event.preventDefault();
        if(action==='validate')this.validateBook(id);
        else if(action==='export')this.exportBook(id);
        else if(action==='remove')this.removeLocalBook(id);
        else if(action==='details'){this._selectedBook=this._selectedBook===id?null:id;this.render();}
      });}
    }
  };

  window.TecHistoricalManager=M;
  const boot=()=>{try{M.bind();}catch(e){quiet(e,'tec-history-manager-boot');}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  setTimeout(boot,1500);
})();
