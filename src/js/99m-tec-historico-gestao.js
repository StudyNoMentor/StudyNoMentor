/* ============================================================================
   TEC — GESTÃO E VALIDAÇÃO DOS HISTÓRICOS RECONSTRUÍDOS
   ----------------------------------------------------------------------------
   Camada de governança por caderno:
   · inventaria fontes e dados locais;
   · compara o retrato local com uma nova leitura REAL do TEC;
   · nunca converte divergência em dado verificado;
   · exporta auditoria por caderno;
   · permite remover os dados locais de um caderno sem adulterar o ledger.
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

  const M={
    _patched:false,
    _bound:false,
    _selectedBook:null,

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
    finishRun(requestId,bookId,source='caderno'){
      const st=this.state(),run=st.runs[String(requestId||'')];if(!run)return null;
      const live=run.live||{},baseline=run.baseline||{},report=this.compareSnapshots(baseline,live),liveDigest=this.digestSnapshot(live);
      const hadBaseline=Object.keys(baseline).length>0;
      const status=hadBaseline?(report.exact?'validated':'divergent'):'captured';
      const current=st.books[String(bookId)]||{bookId:String(bookId),firstSeenAt:now(),sources:[]};
      current.lastSeenAt=now();current.sources=[...new Set([...(current.sources||[]),source,'live-tec'])];
      current.validation={status,origin:'live-tec',validatedAt:hadBaseline?now():null,capturedAt:now(),baselineDigest:run.baselineDigest,tecDigest:liveDigest,mode:run.mode,report};
      st.books[String(bookId)]=current;delete st.runs[String(requestId)];this.save(st);this.render();return current.validation;
    },
    markImported(bookId,account,source){
      const b=this.touchBook(bookId,{account:text(account),sources:[source],importedAt:now()});
      if(b&&b.validation&&['validated','divergent'].includes(b.validation.status)){
        b.validation={...b.validation,status:'stale',staleAt:now(),reason:'dados-importados-alteraram-o-retrato-local'};
        const st=this.state();st.books[String(bookId)]=b;this.save(st);
      }
      this.render();
    },
    validateBook(bookId){
      const H=window.TecHistoricalReconstruction;if(!H)return;
      const input=document.getElementById('tec-reconstruction-input');if(input)input.value=String(bookId);
      H.start();
      const active=H.state&&H.state().active;
      if(active&&String(active.bookId)===String(bookId)&&active.requestId)this.beginRun(active.requestId,bookId,'validation');
      this._selectedBook=String(bookId);this.render();
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
      if(!skipConfirm&&typeof confirm==='function'&&!confirm(`Remover do StudyNoMentor todos os dados LOCAIS do caderno #${id}? O ledger de auditoria em nuvem não será reescrito.`))return false;
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
      this.touchBook(id,{localRemovedAt:now(),removedQuestions,removedEvents});this.render();
      if(typeof showToast==='function')showToast(`🗑️ Caderno #${id}: ${removedQuestions} questão(ões) e ${removedEvents} evento(s) locais removidos.`);
      return true;
    },
    statusLabel(book){
      const s=book&&book.validation&&book.validation.status;
      if(s==='validated')return'✓ Validado com o TEC';
      if(s==='divergent')return'⚠ Divergências com o TEC';
      if(s==='stale')return'↻ Validação desatualizada';
      if(s==='captured')return'◉ Capturado do TEC';
      return'○ Ainda não validado';
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
      const header=document.createElement('div');header.className='card-header';const wrap=document.createElement('div');const h=document.createElement('h2');h.textContent='🧾 Gestão dos históricos TEC';const p=document.createElement('p');p.className='sub';p.textContent='Gerencie cada caderno reconstruído/importado e valide o retrato local contra uma nova leitura real do TEC. Divergências ficam explícitas; nenhuma tentativa é inventada.';wrap.append(h,p);header.append(wrap);
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
        const src=document.createElement('div');src.className='tec-history-meta';src.textContent=`Fontes: ${(book.sources||[]).join(', ')||'dados locais existentes'}`+(book.validation&&book.validation.validatedAt?` · validado em ${new Date(book.validation.validatedAt).toLocaleString()}`:'');box.append(src);
        const actions=document.createElement('div');actions.className='tec-history-actions';
        const mk=(label,action,primary=false)=>{const b=document.createElement('button');b.type='button';b.className=primary?'btn-primary':'btn-secondary';b.textContent=label;b.dataset.historyAction=action;b.dataset.bookId=id;actions.append(b);};
        mk('Validar no TEC','validate',true);mk('Exportar auditoria','export');mk('Detalhes','details');mk('Remover local','remove');box.append(actions);
        const report=document.createElement('div');report.className='tec-history-report';report.hidden=this._selectedBook!==id;report.dataset.historyReport=id;
        const vr=book.validation&&book.validation.report;
        if(vr){report.textContent=`Comparação TEC: ${vr.matched} questão(ões) idênticas · ${vr.changed} alteradas · ${vr.localOnly} apenas no Study · ${vr.tecOnly} apenas no TEC.`;const diffs=(vr.differences||[]).slice(0,12);for(const d of diffs){const line=document.createElement('div');line.textContent=`#${d.questionId}: ${d.type}`+(d.fields&&d.fields.length?` — ${d.fields.map(x=>x.field).join(', ')}`:'');report.append(line);}if((vr.differences||[]).length>12){const more=document.createElement('div');more.textContent=`+ ${(vr.differences||[]).length-12} divergência(s) adicionais no relatório exportável.`;report.append(more);}}
        else report.textContent='Sem comparação com o TEC ainda. Use “Validar no TEC” para abrir o caderno real em segundo plano e confrontar os dados.';
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
      const originalIngest=H.ingestBatch.bind(H),originalWrite=H.writeBook.bind(H),self=this;
      H.ingestBatch=function(payload,opts={}){
        const active=this.state&&this.state().active,requestId=active&&active.requestId,bookId=String(payload&&payload.bookId||active&&active.bookId||'');
        const out=originalIngest(payload,opts);
        if(requestId&&bookId)self.recordRunRows(requestId,bookId,payload&&payload.rows||[]);
        if(opts&&opts.source==='tampermonkey-json'&&bookId)self.markImported(bookId,payload&&payload.tecAccount||out&&out.account,'tampermonkey-json');
        return out;
      };
      H.writeBook=function(bookId,account,stats,extra={}){
        const active=this.state&&this.state().active,requestId=active&&active.requestId,ret=originalWrite(bookId,account,stats,extra),source=String(extra&&extra.source||'caderno');
        self.touchBook(bookId,{account:text(account),sources:[source],lastStats:clone(stats)});
        if(requestId)self.finishRun(requestId,bookId,source);else if(source==='tampermonkey-json')self.markImported(bookId,account,source);
        self.render();return ret;
      };
    },
    bind(){
      this.patch();this.ensureStyle();this.ensureCard();this.render();
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
