/* ============================================================
   PARIDADE TOTAL ANKI — Browser / Undo / Stats / Media Sync /
   Extensoes / Custom Scheduling
   Camada aditiva. Nao altera o scheduler-base: apenas expoe
   superficies equivalentes e sincroniza recursos que antes
   ficavam locais ao dispositivo.
   ============================================================ */
const AnkiTotalParity = {
  _installed:false,
  _duplicateIds:null,
  _undo:[],
  _redo:[],
  _restoring:false,
  _mediaApplying:false,
  _mediaSyncing:false,
  _customSchedulingErrorShown:false,

  install(){
    if(this._installed||typeof AnkiProductParity==='undefined'||typeof AnkiParity==='undefined')return;
    this._installed=true;
    this._installExtensions();
    this._installBrowserPowerTools();
    this._installGlobalUndo();
    this._installStatsParity();
    this._installDeepCheck();
    this._installMediaSync();
    this._installCustomScheduling();
    this._installMenu();
  },

  esc(v){return AnkiProductParity.esc(v);},
  clone(v){return v==null?v:JSON.parse(JSON.stringify(v));},

  /* ───────────────── BROWSER: SAVED SEARCHES + DUPLICATES ───────────────── */
  _savedSearchKey(){try{return AnkiParity._entityKey('browser','saved-searches');}catch(_){return 'snm-anki-saved-searches';}},
  _savedSearches(){
    try{const x=JSON.parse(localStorage.getItem(this._savedSearchKey())||'[]');return Array.isArray(x)?x:[];}catch(_){return [];}
  },
  _writeSavedSearches(v){try{DB.setRaw(this._savedSearchKey(),JSON.stringify(v||[]));}catch(_){localStorage.setItem(this._savedSearchKey(),JSON.stringify(v||[]));}},
  _browserState(){
    const b=AnkiProductParity.browser||{};
    return {query:String(b.query||''),mode:b.mode==='cards'?'cards':'notes',tag:String(b.tag||''),flag:String(b.flag??''),suspended:String(b.suspended||'all'),marked:!!b.marked,sort:String(b.sort||''),sortDir:b.sortDir==='desc'?'desc':'asc',columns:Array.isArray(b.columns)?b.columns.slice():null};
  },
  _refreshSavedSearchSelect(){
    const s=document.getElementById('anki-browser-saved-search');if(!s)return;
    const rows=this._savedSearches();const cur=s.value;
    s.innerHTML='<option value="">Buscas salvas…</option>'+rows.map(x=>'<option value="'+this.esc(x.id)+'">'+this.esc(x.name)+'</option>').join('');
    if(rows.some(x=>String(x.id)===String(cur)))s.value=cur;
  },
  _installBrowserPowerTools(){
    const tb=document.querySelector('#anki-browser-modal .anki-browser-toolbar');if(!tb||document.getElementById('anki-browser-power-tools'))return;
    const box=document.createElement('div');box.id='anki-browser-power-tools';box.className='anki-browser-power-tools';
    box.innerHTML=
      '<select id="anki-browser-saved-search"><option value="">Buscas salvas…</option></select>'+
      '<button type="button" class="btn-secondary" id="anki-browser-save-search" title="Salvar busca atual">★ Salvar busca</button>'+
      '<button type="button" class="btn-secondary" id="anki-browser-delete-search" title="Excluir busca salva">− Busca</button>'+
      '<button type="button" class="btn-secondary" id="anki-browser-duplicates">≡ Duplicatas</button>'+
      '<button type="button" class="btn-secondary" id="anki-browser-clear-duplicates" style="display:none">× Duplicatas</button>'+
      '<button type="button" class="btn-secondary" id="anki-browser-global-undo" title="Desfazer última operação">↶</button>'+
      '<button type="button" class="btn-secondary" id="anki-browser-global-redo" title="Refazer última operação">↷</button>';
    tb.appendChild(box);
    this._refreshSavedSearchSelect();

    document.getElementById('anki-browser-saved-search').addEventListener('change',e=>this._applySavedSearch(e.target.value));
    document.getElementById('anki-browser-save-search').addEventListener('click',()=>this._saveCurrentSearch());
    document.getElementById('anki-browser-delete-search').addEventListener('click',()=>this._deleteSavedSearch());
    document.getElementById('anki-browser-duplicates').addEventListener('click',()=>this._findDuplicates());
    document.getElementById('anki-browser-clear-duplicates').addEventListener('click',()=>this._clearDuplicates());
    document.getElementById('anki-browser-global-undo').addEventListener('click',()=>this.undoGlobal());
    document.getElementById('anki-browser-global-redo').addEventListener('click',()=>this.redoGlobal());

    const oldRows=AnkiProductParity._browserRows.bind(AnkiProductParity);
    AnkiProductParity._browserRows=()=>{
      let rows=oldRows();
      if(this._duplicateIds&&this._duplicateIds.size)rows=rows.filter(r=>this._duplicateIds.has(String(r.note&&r.note.id)));
      return rows;
    };

    const oldOpen=AnkiProductParity.openBrowser.bind(AnkiProductParity);
    AnkiProductParity.openBrowser=(...args)=>{const out=oldOpen(...args);this._refreshSavedSearchSelect();this._syncUndoButtons();this._syncDuplicateButton();return out;};

    document.addEventListener('keydown',e=>{
      const modal=document.getElementById('anki-browser-modal');if(!modal||modal.style.display!=='flex')return;
      const tag=String(e.target&&e.target.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea'||(e.target&&e.target.isContentEditable))return;
      if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.code==='KeyZ'){e.preventDefault();this.undoGlobal();}
      else if((e.ctrlKey||e.metaKey)&&(e.code==='KeyY'||(e.shiftKey&&e.code==='KeyZ'))){e.preventDefault();this.redoGlobal();}
    });
  },
  _saveCurrentSearch(){
    UI.prompt([{key:'name',label:'Nome da busca',type:'text',value:'',placeholder:'Ex.: Revisões difíceis'}],{title:'★ Salvar busca',okText:'Salvar'}).then(v=>{
      if(!v||!String(v.name||'').trim())return;
      const rows=this._savedSearches(),name=String(v.name).trim(),same=rows.find(x=>x.name.toLowerCase()===name.toLowerCase());
      const item={id:same?same.id:String(Date.now()),name,state:this._browserState()};
      if(same)Object.assign(same,item);else rows.push(item);
      this._writeSavedSearches(rows);this._refreshSavedSearchSelect();showToast('Busca salva ✓');
    });
  },
  _applySavedSearch(id){
    const x=this._savedSearches().find(y=>String(y.id)===String(id));if(!x)return;const s=x.state||{},b=AnkiProductParity.browser;
    Object.assign(b,{query:s.query||'',mode:s.mode==='cards'?'cards':'notes',tag:s.tag||'',flag:s.flag??'',suspended:s.suspended||'all',marked:!!s.marked,sort:s.sort||b.sort,sortDir:s.sortDir==='desc'?'desc':'asc',columns:Array.isArray(s.columns)?s.columns.slice():null,page:0});
    b.selected.clear();this._duplicateIds=null;
    const put=(id,val,prop)=>{const el=document.getElementById(id);if(el){if(prop==='checked')el.checked=!!val;else el.value=val;}};
    put('anki-browser-search',b.query);put('anki-browser-mode',b.mode);put('anki-browser-tag',b.tag);put('anki-browser-flag',b.flag);put('anki-browser-suspended',b.suspended);put('anki-browser-marked',b.marked,'checked');
    if(typeof AnkiMaxParity!=='undefined'&&AnkiMaxParity._renderBrowserControls)AnkiMaxParity._renderBrowserControls();
    AnkiProductParity.renderBrowser();this._syncDuplicateButton();showToast('Busca "'+x.name+'" aplicada');
  },
  _deleteSavedSearch(){
    const sel=document.getElementById('anki-browser-saved-search'),id=sel&&sel.value;if(!id){showToast('Selecione uma busca salva');return;}
    const rows=this._savedSearches().filter(x=>String(x.id)!==String(id));this._writeSavedSearches(rows);this._refreshSavedSearchSelect();showToast('Busca removida');
  },
  _normalizeDuplicate(v){return AnkiProductParity.plain(v).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('pt-BR');},
  _findDuplicates(){
    const names=[...new Set(AnkiParity.noteTypes().flatMap(t=>(t.fields||[]).map(f=>String(f.name||'')).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    if(!names.length){showToast('Nenhum campo disponível');return;}
    UI.prompt([
      {key:'field',label:'Campo',type:'select',value:names[0],options:names.map(n=>({value:n,label:n}))},
      {key:'min',label:'Tamanho mínimo do texto',type:'number',value:1,min:1,max:9999}
    ],{title:'≡ Encontrar duplicatas',okText:'Localizar'}).then(v=>{
      if(!v)return;const min=Math.max(1,Number(v.min)||1),groups=new Map();
      for(const n of AnkiParity.notes()){
        const raw=n.fields&&n.fields[v.field];if(raw==null)continue;const key=this._normalizeDuplicate(raw);if(key.length<min)continue;
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(String(n.id));
      }
      const ids=[...groups.values()].filter(g=>g.length>1).flat();
      this._duplicateIds=new Set(ids);AnkiProductParity.browser.page=0;AnkiProductParity.browser.selected.clear();AnkiProductParity.renderBrowser();this._syncDuplicateButton();
      showToast(ids.length?ids.length+' nota(s) em grupos duplicados':'Nenhuma duplicata encontrada');
    });
  },
  _clearDuplicates(){this._duplicateIds=null;AnkiProductParity.browser.page=0;AnkiProductParity.browser.selected.clear();AnkiProductParity.renderBrowser();this._syncDuplicateButton();},
  _syncDuplicateButton(){
    const b=document.getElementById('anki-browser-clear-duplicates');if(b)b.style.display=this._duplicateIds&&this._duplicateIds.size?'':'none';
  },

  /* ───────────────── UNDO/REDO TRANSVERSAL ───────────────── */
  _entityEntries(){
    const prefixes=[];try{prefixes.push(AnkiParity._entityKey('note',''),AnkiParity._entityKey('notetype',''));}catch(_){}
    const rows=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&prefixes.some(p=>k.startsWith(p)))rows.push([k,localStorage.getItem(k)]);}}catch(_){}
    return {prefixes,rows};
  },
  _snapshot(label){
    const ent=this._entityEntries();
    return {label:String(label||'Ação'),ts:Date.now(),cards:this.clone(DB.getCards()),revlog:this.clone(DB.getRevlog()),decks:this.clone(DB.getDecks()),entityPrefixes:ent.prefixes,entities:ent.rows};
  },
  checkpoint(label){
    if(this._restoring)return;const now=Date.now(),last=this._undo[this._undo.length-1];
    if(last&&last.label===label&&now-last.ts<120)return;
    this._undo.push(this._snapshot(label));if(this._undo.length>20)this._undo.shift();this._redo=[];this._syncUndoButtons();
  },
  _restoreSnapshot(s){
    if(!s)return false;this._restoring=true;
    try{
      DB.saveCards(this.clone(s.cards||[]));DB.saveDecks(this.clone(s.decks||[]));
      if(DB.replaceRevlog)DB.replaceRevlog(this.clone(s.revlog||[]));
      else DB.setRaw(DB.REVLOG_KEY,JSON.stringify(s.revlog||[]));
      try{
        const kill=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&(s.entityPrefixes||[]).some(p=>k.startsWith(p)))kill.push(k);}
        kill.forEach(k=>localStorage.removeItem(k));(s.entities||[]).forEach(([k,v])=>localStorage.setItem(k,v));
      }catch(_){}
      CardEngine.invalidateDueCache();
      if(typeof CardsScreen!=='undefined'&&CardsScreen.render)CardsScreen.render();
      if(typeof AnkiProductParity!=='undefined'&&document.getElementById('anki-browser-modal')&&document.getElementById('anki-browser-modal').style.display==='flex')AnkiProductParity.renderBrowser();
      return true;
    }finally{this._restoring=false;this._syncUndoButtons();}
  },
  undoGlobal(){
    const s=this._undo.pop();if(!s){showToast('Nada para desfazer');return false;}this._redo.push(this._snapshot(s.label));this._restoreSnapshot(s);showToast('↶ '+s.label);return true;
  },
  redoGlobal(){
    const s=this._redo.pop();if(!s){showToast('Nada para refazer');return false;}this._undo.push(this._snapshot(s.label));this._restoreSnapshot(s);showToast('↷ '+s.label);return true;
  },
  _syncUndoButtons(){
    const u=document.getElementById('anki-browser-global-undo'),r=document.getElementById('anki-browser-global-redo');if(u)u.disabled=!this._undo.length;if(r)r.disabled=!this._redo.length;
  },
  _wrapCheckpoint(obj,name,label){
    if(!obj||typeof obj[name]!=='function'||obj[name].__ankiUndo)return;const old=obj[name];
    const self=this;function wrapped(...args){self.checkpoint(label);return old.apply(this,args);}wrapped.__ankiUndo=true;obj[name]=wrapped;
  },
  _installGlobalUndo(){
    this._wrapCheckpoint(typeof AnkiMaxParity!=='undefined'?AnkiMaxParity:null,'_bulkCardsMove','Mover cards');
    this._wrapCheckpoint(typeof AnkiMaxParity!=='undefined'?AnkiMaxParity:null,'_bulkCardsDue','Definir vencimento');
    this._wrapCheckpoint(typeof AnkiMaxParity!=='undefined'?AnkiMaxParity:null,'_bulkCardsForget','Esquecer cards');
    this._wrapCheckpoint(typeof AnkiMaxParity!=='undefined'?AnkiMaxParity:null,'_bulkCardsReposition','Reposicionar cards');
    this._wrapCheckpoint(AnkiProductParity,'deleteNotes','Excluir notas');
    this._wrapCheckpoint(AnkiProductParity,'bulkMark','Marcar notas');
    this._wrapCheckpoint(AnkiProductParity,'toggleSuspend','Suspender/ativar');
    this._wrapCheckpoint(AnkiProductParity,'bulkFlag','Alterar bandeiras');
    this._wrapCheckpoint(AnkiProductParity,'bulkFindReplace','Localizar e substituir');
    this._wrapCheckpoint(AnkiProductParity,'_applyNotetypeEdit','Editar tipo de nota');
    if(typeof AnkiMaxEditor!=='undefined')this._wrapCheckpoint(AnkiMaxEditor,'_saveRichNote','Editar nota');
    if(typeof AnkiImageOcclusion!=='undefined')this._wrapCheckpoint(AnkiImageOcclusion,'save','Editar oclusão');
  },

  /* ───────────────── ESTATÍSTICAS RESTANTES ───────────────── */
  _hist(values,bins,labels){
    const out=Array.from({length:bins.length-1},()=>0);for(const raw of values){const v=Number(raw);if(!Number.isFinite(v))continue;let i=bins.findIndex((b,j)=>j<bins.length-1&&v>=b&&v<bins[j+1]);if(i<0&&v>=bins[bins.length-1])i=out.length-1;if(i>=0)out[i]++;}
    const max=Math.max(1,...out);return '<div class="anki-total-hist">'+out.map((n,i)=>'<div title="'+this.esc(labels[i])+': '+n+'"><i style="height:'+Math.max(n?4:0,Math.round(n/max*100))+'%"></i><span>'+this.esc(labels[i])+'</span></div>').join('')+'</div>';
  },
  _extraStatsHtml(){
    const cards=AnkiParity._scopeCards?AnkiParity._scopeCards():DB.getCards(),logs=AnkiParity._scopeRevlog?AnkiParity._scopeRevlog():DB.getRevlog(),now=new Date(),months=[];
    for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1),k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');months.push({k,label:String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getFullYear()).slice(-2),n:0});}
    cards.forEach(c=>{const k=String(c.createdAt||'').slice(0,7),m=months.find(x=>x.k===k);if(m)m.n++;});
    const maxAdded=Math.max(1,...months.map(x=>x.n));
    const states={Novo:0,Aprendendo:0,Revisão:0,Suspenso:0,Enterrado:0};cards.forEach(c=>{if(c.suspenso)states.Suspenso++;else if(CardEngine.estaEnterrado(c))states.Enterrado++;else if((c.phase||'new')==='new')states.Novo++;else if(['learning','relearning'].includes(c.phase))states.Aprendendo++;else states.Revisão++;});
    const timeDays=Array.from({length:30},(_,i)=>({date:CardEngine.addDays(todayCards(),i-29),sec:0}));const byDay=new Map(timeDays.map(x=>[x.date,x]));
    logs.forEach(r=>{const x=byDay.get(String(r.date||''));if(x)x.sec+=(Number(r.time)||0)/1000;});const maxTime=Math.max(1,...timeDays.map(x=>x.sec));
    const cardCounts=Object.entries(states),maxCount=Math.max(1,...cardCounts.map(x=>x[1]));
    const ease=cards.map(c=>Number(c.ease)||0).filter(Boolean),stab=cards.map(c=>Number(c.s)).filter(Number.isFinite),diff=cards.map(c=>Number(c.d)).filter(Number.isFinite);
    return '<div class="anki-total-stats">'+
      '<div class="stat-grid"><div class="card stat-card"><div class="card-header"><div><h2>＋ Cards adicionados</h2><p class="sub">Últimos 12 meses</p></div></div><div class="anki-total-bars">'+months.map(x=>'<div title="'+x.k+': '+x.n+'"><i style="height:'+Math.max(x.n?4:0,Math.round(x.n/maxAdded*100))+'%"></i><span>'+x.label+'</span></div>').join('')+'</div></div>'+
      '<div class="card stat-card"><div class="card-header"><div><h2>🧮 Contagem de cards</h2><p class="sub">Estado atual da coleção</p></div></div><div class="anki-total-bars">'+cardCounts.map(([k,n])=>'<div title="'+k+': '+n+'"><i style="height:'+Math.max(n?4:0,Math.round(n/maxCount*100))+'%"></i><span>'+k.slice(0,4)+'</span></div>').join('')+'</div></div></div>'+
      '<div class="stat-grid"><div class="card stat-card"><div class="card-header"><div><h2>⏱ Tempo de revisão</h2><p class="sub">30 dias</p></div></div><div class="anki-total-bars anki-time-bars">'+timeDays.map(x=>'<div title="'+x.date+': '+Math.round(x.sec)+'s"><i style="height:'+Math.max(x.sec?3:0,Math.round(x.sec/maxTime*100))+'%"></i></div>').join('')+'</div></div>'+
      '<div class="card stat-card"><div class="card-header"><div><h2>📈 Facilidade</h2><p class="sub">Distribuição SM-2/importados</p></div></div>'+this._hist(ease,[0,1.5,2,2.5,3,3.5,99],['<1.5','1.5–2','2–2.5','2.5–3','3–3.5','>3.5'])+'</div></div>'+
      '<div class="stat-grid"><div class="card stat-card"><div class="card-header"><div><h2>🧠 Estabilidade</h2><p class="sub">Dias de memória FSRS</p></div></div>'+this._hist(stab,[0,1,7,30,90,365,1e12],['<1d','1–7','7–30','30–90','90–365','>1a'])+'</div>'+
      '<div class="card stat-card"><div class="card-header"><div><h2>🎚 Dificuldade</h2><p class="sub">D do FSRS</p></div></div>'+this._hist(diff,[0,2,4,6,8,10,1e12],['0–2','2–4','4–6','6–8','8–10','10+'])+'</div></div></div>';
  },
  _installStatsParity(){
    if(typeof AnkiMaxStatsMedia==='undefined'||typeof AnkiMaxStatsMedia.statsHtml!=='function')return;
    const old=AnkiMaxStatsMedia.statsHtml.bind(AnkiMaxStatsMedia);
    AnkiMaxStatsMedia.statsHtml=()=>old()+this._extraStatsHtml();
  },

  /* ───────────────── CHECK COLLECTION MAIS PROFUNDO ───────────────── */
  deepIssues(){
    const cards=AnkiParity._scopeCards?AnkiParity._scopeCards():DB.getCards(),logs=AnkiParity._scopeRevlog?AnkiParity._scopeRevlog():DB.getRevlog(),
      decks=AnkiParity._scopeDecks?AnkiParity._scopeDecks():DB.getDecks(),notes=AnkiParity.notes(),types=AnkiParity.noteTypes();
    const cardIds=new Set(cards.map(c=>String(c.id))),deckIds=new Set(decks.map(d=>String(d.id))),noteIds=new Set(notes.map(n=>String(n.id))),typeIds=new Set(types.map(t=>String(t.id)));
    const missingNotes=cards.filter(c=>!noteIds.has(String(AnkiParity.noteId(c)))).map(c=>c.id);
    const missingDeck=cards.filter(c=>c.deckId!=null&&!deckIds.has(String(c.deckId))).map(c=>c.id);
    const orphanRevlog=logs.filter(r=>r.cardId!=null&&!cardIds.has(String(r.cardId)));
    const invalidNotetype=notes.filter(n=>!typeIds.has(String(n.notetypeId))).map(n=>n.id);
    const invalidSchedule=cards.filter(c=>{
      const badNum=['s','d','intervalo','reps','lapses'].some(k=>c[k]!=null&&!Number.isFinite(Number(c[k])));
      const badDate=c.due&&!/^\d{4}-\d{2}-\d{2}$/.test(String(c.due));
      const badTs=c.dueTs!=null&&!Number.isFinite(Number(c.dueTs));return badNum||badDate||badTs;
    }).map(c=>c.id);
    const guid=new Map();notes.forEach(n=>{const g=String(n.guid||'');if(!g)return;if(!guid.has(g))guid.set(g,[]);guid.get(g).push(n.id);});
    const duplicateGuid=[...guid.values()].filter(x=>x.length>1);
    return {missingNotes,missingDeck,orphanRevlog,invalidNotetype,invalidSchedule,duplicateGuid};
  },
  _installDeepCheck(){
    if(typeof AnkiMaxStatsMedia==='undefined'||typeof AnkiMaxStatsMedia.renderExtendedCheck!=='function')return;
    const old=AnkiMaxStatsMedia.renderExtendedCheck.bind(AnkiMaxStatsMedia);
    AnkiMaxStatsMedia.renderExtendedCheck=async()=>{await old();const host=document.getElementById('anki-check-extended');if(!host||document.getElementById('anki-check-deep'))return;const s=this.deepIssues(),d=document.createElement('div');d.id='anki-check-deep';d.innerHTML=
      '<h3 class="anki-section-title">Integridade profunda</h3><div class="anki-check-grid">'+
      [['Cards sem nota',s.missingNotes.length],['Cards sem baralho',s.missingDeck.length],['Revlog órfão',s.orphanRevlog.length],['Notas sem tipo',s.invalidNotetype.length],['Agendamento inválido',s.invalidSchedule.length],['GUIDs duplicados',s.duplicateGuid.length]].map(x=>'<div><span>'+x[0]+'</span><strong>'+x[1]+'</strong></div>').join('')+'</div>';host.appendChild(d);};
    const foot=document.querySelector('#anki-check-modal .cards-modal-foot');if(foot&&!document.getElementById('anki-media-sync-now')){const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.id='anki-media-sync-now';b.textContent='☁ Sincronizar mídia';b.onclick=()=>this.syncMedia(true);foot.insertBefore(b,foot.firstChild);}
  },

  /* ───────────────── MEDIA SYNC MULTIDISPOSITIVO ───────────────── */
  _mediaContext(){
    const cs=typeof CloudStore!=='undefined'?CloudStore:null;if(!cs||!cs.isReady||!cs.isReady()||!cs.isLoggedIn||!cs.isLoggedIn())return null;
    const profile=window.ProfileManager&&ProfileManager.getActiveProfileId?ProfileManager.getActiveProfileId():null;
    let plan=null;try{plan=DB._activePlanId();}catch(_){}
    const uid=cs.session&&cs.session.user&&cs.session.user.id;return uid&&profile&&plan?{uid,profile:String(profile),plan:String(plan)}:null;
  },
  _bytesToB64(bytes){const b=AnkiMediaStore._u8(bytes);let s='';const N=0x8000;for(let i=0;i<b.length;i+=N)s+=String.fromCharCode(...b.subarray(i,i+N));return btoa(s);},
  _b64ToBytes(v){const s=atob(String(v||'')),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;},
  async _pushMedia(rec){
    const ctx=this._mediaContext();if(!ctx||!rec||this._mediaApplying)return false;
    const row={profile_id:ctx.profile,plan_id:ctx.plan,media_name:String(rec.name||''),mime:String(rec.mime||''),fingerprint:String(rec.fingerprint||''),size_bytes:AnkiMediaStore._u8(rec.bytes||[]).length,content_b64:rec.trashedAt?null:this._bytesToB64(rec.bytes||[]),deleted_at:rec.trashedAt?new Date(rec.trashedAt).toISOString():null,updated_at:new Date(Number(rec.updatedAt)||Date.now()).toISOString()};
    const {error}=await CloudStore.client.from('study_anki_media').upsert(row,{onConflict:'profile_id,plan_id,media_name'});if(error)throw error;return true;
  },
  async syncMedia(show){
    if(this._mediaSyncing)return false;const ctx=this._mediaContext();if(!ctx){if(show)showToast('Entre na conta para sincronizar mídia');return false;}
    this._mediaSyncing=true;
    try{
      const {data,error}=await CloudStore.client.from('study_anki_media').select('profile_id,plan_id,media_name,mime,fingerprint,size_bytes,content_b64,deleted_at,updated_at').eq('profile_id',ctx.profile).eq('plan_id',ctx.plan);
      if(error)throw error;const remote=new Map((data||[]).map(x=>[String(x.media_name),x])),local=await AnkiMediaStore.all(true),localMap=new Map(local.map(x=>[String(x.name),x]));
      for(const l of local){const r=remote.get(String(l.name));if(!r||Number(l.updatedAt||0)>Date.parse(r.updated_at||0)+500)await this._pushMedia(l);}
      this._mediaApplying=true;
      try{
        for(const r of (data||[])){
          const l=localMap.get(String(r.media_name)),rt=Date.parse(r.updated_at||0),lt=Number(l&&l.updatedAt||0);if(l&&lt>rt+500)continue;
          if(r.deleted_at){if(l&&!l.trashedAt)await AnkiMediaStore._setTrash(r.media_name,true);continue;}
          if(!r.content_b64)continue;
          const bytes=this._b64ToBytes(r.content_b64),fp=AnkiMediaStore.fingerprint(bytes);
          if(!l||l.fingerprint!==fp||l.trashedAt){const rec=await AnkiMediaStore.put(r.media_name,bytes,r.mime||'');rec.updatedAt=rt||Date.now();const db=await AnkiMediaStore._open();if(db)await new Promise(resolve=>{const tx=db.transaction(AnkiMediaStore.STORE,'readwrite');tx.objectStore(AnkiMediaStore.STORE).put(rec);tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();});}
        }
      }finally{this._mediaApplying=false;}
      if(show)showToast('Mídia sincronizada ✓');return true;
    }catch(e){console.warn('Media sync',e);if(show)showToast('Falha ao sincronizar mídia');return false;}
    finally{this._mediaSyncing=false;}
  },
  _installMediaSync(){
    if(typeof AnkiMediaStore==='undefined')return;
    const oldPut=AnkiMediaStore.put.bind(AnkiMediaStore);AnkiMediaStore.put=async(...args)=>{const rec=await oldPut(...args);if(!this._mediaApplying)this._pushMedia(rec).catch(e=>console.warn('Media upload',e));return rec;};
    const oldTrash=AnkiMediaStore._setTrash.bind(AnkiMediaStore);AnkiMediaStore._setTrash=async(name,value)=>{const ok=await oldTrash(name,value);if(ok&&!this._mediaApplying){const rec=(await AnkiMediaStore.all(true)).find(x=>x.name===String(name));if(rec)this._pushMedia(rec).catch(e=>console.warn('Media tombstone',e));}return ok;};
    queueMicrotask(()=>{
      if(typeof CloudStore==='undefined')return;
      if(typeof CloudStore.syncNow==='function'&&!CloudStore.syncNow.__ankiMedia){const old=CloudStore.syncNow.bind(CloudStore);const self=this;CloudStore.syncNow=async(...a)=>{const ok=await old(...a);if(ok)await self.syncMedia(false);return ok;};CloudStore.syncNow.__ankiMedia=true;}
      if(typeof CloudStore.syncOnFocus==='function'&&!CloudStore.syncOnFocus.__ankiMedia){const old=CloudStore.syncOnFocus.bind(CloudStore);const self=this;CloudStore.syncOnFocus=async(...a)=>{const ok=await old(...a);if(ok)await self.syncMedia(false);return ok;};CloudStore.syncOnFocus.__ankiMedia=true;}
      setTimeout(()=>this.syncMedia(false),1200);
    });
  },

  /* ───────────────── EXTENSION API / ADD-ON WEB EQUIVALENT ───────────────── */
  _installExtensions(){
    if(window.AnkiStudyExtensions)return;
    const hooks=new Map(),installed=new Map(),api={
      on(name,fn){if(typeof fn!=='function')throw new TypeError('hook precisa ser função');if(!hooks.has(name))hooks.set(name,new Set());hooks.get(name).add(fn);return()=>hooks.get(name).delete(fn);},
      emit(name,payload){for(const fn of [...(hooks.get(name)||[])]){try{fn(payload);}catch(e){console.warn('Anki extension hook',name,e);}}},
      filter(name,value,ctx){let v=value;for(const fn of [...(hooks.get(name)||[])]){try{const n=fn(v,ctx);if(n!==undefined)v=n;}catch(e){console.warn('Anki extension filter',name,e);}}return v;},
      register(manifest){if(!manifest||!manifest.id)throw new Error('Extensão sem id');installed.set(String(manifest.id),Object.assign({},manifest));api.emit('extension:registered',manifest);return manifest;},
      list(){return [...installed.values()].map(x=>Object.assign({},x));},
      hooks(){return [...hooks.keys()].sort();}
    };
    window.AnkiStudyExtensions=api;api.register({id:'studynomentor.core-parity',name:'StudyNoMentor Anki Parity',version:'1',builtIn:true});
  },
  _extensionsKey(){try{return AnkiParity._entityKey('extensions','sources');}catch(_){return 'snm-anki-extensions';}},
  _extensionSources(){try{const x=JSON.parse(localStorage.getItem(this._extensionsKey())||'[]');return Array.isArray(x)?x:[];}catch(_){return [];}},
  _saveExtensionSources(x){try{DB.setRaw(this._extensionsKey(),JSON.stringify(x||[]));}catch(_){localStorage.setItem(this._extensionsKey(),JSON.stringify(x||[]));}},
  _loadUserExtensions(){
    const api=window.AnkiStudyExtensions;if(!api)return;for(const x of this._extensionSources().filter(x=>x.enabled)){try{new Function('api','"use strict";\n'+String(x.source||''))(api);api.register({id:x.id,name:x.name||x.id,version:x.version||'user',user:true});}catch(e){console.warn('Extensão '+x.name,e);}}
  },
  openExtensions(){
    let m=document.getElementById('anki-extensions-modal');if(!m){const d=document.createElement('div');d.innerHTML='<div id="anki-extensions-modal" class="cards-modal" style="display:none"><div class="cards-modal-box cards-modal-lg"><div class="cards-modal-head"><div><h2>🧩 Extensões dos Cards</h2><p class="sub">API de hooks do Study. Extensões locais executam código escolhido por você; mantenha desativado o que não conhece.</p></div><button class="icon-btn" id="anki-ext-close">✕</button></div><div class="cards-modal-body"><div id="anki-ext-list"></div><input id="anki-ext-file" type="file" accept=".js,text/javascript" hidden></div><div class="cards-modal-foot"><button class="btn-secondary" id="anki-ext-import">Importar .js</button><span style="flex:1"></span><button class="btn-primary" id="anki-ext-done">Fechar</button></div></div></div>';document.body.appendChild(d);m=document.getElementById('anki-extensions-modal');document.getElementById('anki-ext-close').onclick=document.getElementById('anki-ext-done').onclick=()=>m.style.display='none';document.getElementById('anki-ext-import').onclick=()=>document.getElementById('anki-ext-file').click();document.getElementById('anki-ext-file').onchange=e=>this._importExtensionFile(e.target.files&&e.target.files[0]);}
    this._renderExtensions();m.style.display='flex';
  },
  _renderExtensions(){
    const box=document.getElementById('anki-ext-list');if(!box)return;const rows=this._extensionSources();box.innerHTML='<div class="anki-ext-row built"><strong>StudyNoMentor Anki Parity</strong><span>Integrada · ativa</span></div>'+rows.map(x=>'<div class="anki-ext-row"><label><input type="checkbox" data-ext-toggle="'+this.esc(x.id)+'" '+(x.enabled?'checked':'')+'> <strong>'+this.esc(x.name||x.id)+'</strong></label><button class="icon-btn danger" data-ext-del="'+this.esc(x.id)+'">×</button></div>').join('')+(rows.length?'':'<p class="hint">Nenhuma extensão local importada.</p>');
    box.querySelectorAll('[data-ext-toggle]').forEach(cb=>cb.onchange=()=>{const xs=this._extensionSources(),x=xs.find(y=>String(y.id)===String(cb.dataset.extToggle));if(x){x.enabled=cb.checked;this._saveExtensionSources(xs);showToast('Recarregue a página para aplicar a extensão.');}});
    box.querySelectorAll('[data-ext-del]').forEach(b=>b.onclick=()=>{this._saveExtensionSources(this._extensionSources().filter(x=>String(x.id)!==String(b.dataset.extDel)));this._renderExtensions();});
  },
  _importExtensionFile(file){
    if(!file)return;const r=new FileReader();r.onload=()=>{const src=String(r.result||''),id='user-'+Date.now().toString(36),rows=this._extensionSources();rows.push({id,name:file.name.replace(/\.js$/i,''),source:src,enabled:false});this._saveExtensionSources(rows);this._renderExtensions();showToast('Extensão importada desativada por segurança');};r.readAsText(file);
  },

  /* ───────────────── CUSTOM SCHEDULING OPT-IN ───────────────── */
  _customKey(){try{return AnkiParity._entityKey('custom-scheduling','config');}catch(_){return 'snm-anki-custom-scheduling';}},
  _customCfg(){try{return Object.assign({enabled:false,source:''},JSON.parse(localStorage.getItem(this._customKey())||'{}')||{});}catch(_){return {enabled:false,source:''};}},
  _saveCustomCfg(v){try{DB.setRaw(this._customKey(),JSON.stringify(v));}catch(_){localStorage.setItem(this._customKey(),JSON.stringify(v));}},
  _validateSchedulePatch(base,out){
    if(!out||typeof out!=='object')return base;const p=Object.assign({},base),allowed=['due','dueTs','intervalo','_kind','_val','customData','status','ease'];
    for(const k of allowed)if(Object.prototype.hasOwnProperty.call(out,k))p[k]=out[k];
    if(p.dueTs!=null&&!Number.isFinite(Number(p.dueTs)))p.dueTs=base.dueTs;
    if(p.intervalo!=null&&!Number.isFinite(Number(p.intervalo)))p.intervalo=base.intervalo;
    if(p._val!=null&&!Number.isFinite(Number(p._val)))p._val=base._val;
    if(p.ease!=null&&(!Number.isFinite(Number(p.ease))||Number(p.ease)<1.3))p.ease=base.ease;
    if(p.due&&!/^\d{4}-\d{2}-\d{2}$/.test(String(p.due)))p.due=base.due;
    return p;
  },
  _customGradeKey(grade){
    const g=String(grade||'bom').toLowerCase();return g==='errei'||g==='naosei'?'again':g==='dificil'?'hard':g==='facil'?'easy':'good';
  },
  _customPhase(card,patch){
    const p=String(patch&&patch.phase||card&&card.phase||'review').toLowerCase();
    if(p==='new')return 'new';if(p==='learning')return 'learning';if(p==='relearning')return 'relearning';return 'review';
  },
  _stateLeaf(card,patch){
    patch=patch||{};const kind=patch._kind||((patch.dueTs!=null)?'min':'day'),val=Number(patch._val!=null?patch._val:patch.intervalo)||0;
    const leaf={customData:patch.customData==null?(card&&card.customData||''):patch.customData};
    if(kind==='min')leaf.scheduledSecs=Math.max(0,Math.round(val*60));
    else leaf.scheduledDays=Math.max(0,Math.round(val));
    const ease=Number(patch.ease!=null?patch.ease:card&&card.ease);if(Number.isFinite(ease))leaf.easeFactor=ease;
    if(card&&card.s!=null&&card.d!=null)leaf.memoryState={stability:Number(card.s),difficulty:Number(card.d)};
    return leaf;
  },
  _buildSchedulingStates(card,scheduler){
    const defs=[['again','errei'],['hard','dificil'],['good','bom'],['easy','facil']],states={},patches={};
    for(const [key,grade] of defs){
      const patch=scheduler(card,grade),phase=this._customPhase(card,patch),leaf=this._stateLeaf(card,patch);patches[key]=patch;
      if(card&&card.originalDeckId){
        states[key]={filtered:(card.filteredReschedule===false?{previewing:{[phase]:leaf}}:{rescheduling:{originalState:{[phase]:leaf}}})};
      }else states[key]={normal:{[phase]:leaf}};
    }
    return {states,patches};
  },
  _stateLeafFor(states,key,card,phase){
    const root=states&&states[key];if(!root)return null;
    if(card&&card.originalDeckId){
      if(root.filtered&&root.filtered.rescheduling&&root.filtered.rescheduling.originalState)return root.filtered.rescheduling.originalState[phase]||Object.values(root.filtered.rescheduling.originalState)[0]||null;
      if(root.filtered&&root.filtered.previewing)return root.filtered.previewing[phase]||Object.values(root.filtered.previewing)[0]||null;
    }
    return root.normal&&(root.normal[phase]||Object.values(root.normal)[0])||null;
  },
  _applyStateLeaf(base,leaf){
    if(!leaf||typeof leaf!=='object')return base;const out=Object.assign({},base),now=Date.now(),today=(typeof todayCards==='function'?todayCards():String(base.due||'').slice(0,10));
    if(Number.isFinite(Number(leaf.scheduledSecs))){
      const secs=Math.max(0,Number(leaf.scheduledSecs));out.dueTs=now+Math.round(secs*1000);out.due=today;out._kind='min';out._val=secs/60;
    }else if(Number.isFinite(Number(leaf.scheduledDays))){
      const days=Math.max(0,Math.round(Number(leaf.scheduledDays)));out.intervalo=days;out.dueTs=null;out.due=CardEngine.addDays(today,days);out._kind='day';out._val=days;
    }
    if(Number.isFinite(Number(leaf.easeFactor)))out.ease=Number(leaf.easeFactor);
    if(Object.prototype.hasOwnProperty.call(leaf,'customData'))out.customData=leaf.customData;
    return this._validateSchedulePatch(base,out);
  },
  _runCustomScheduling(card,grade,patch){
    const cfg=this._customCfg();if(!cfg.enabled||!String(cfg.source||'').trim())return patch;
    try{
      const bundle=this._buildSchedulingStates(card,this._baseScheduler||((c,g)=>patch)),states=bundle.states,key=this._customGradeKey(grade),phase=this._customPhase(card,patch);
      const fn=new Function('states','card','grade','patch','config','"use strict";\n'+String(cfg.source||'')+'\n;return states;');
      const out=fn(states,this.clone(card),grade,this.clone(patch),this.clone(CardsConfig.forDeck(card.originalDeckId||card.deckId)));
      // Compatibilidade com scripts antigos do Study que retornavam um patch.
      if(out&&typeof out==='object'&&!out.again&&!out.hard&&!out.good&&!out.easy)return this._validateSchedulePatch(patch,out);
      const finalStates=(out&&typeof out==='object')?out:states,leaf=this._stateLeafFor(finalStates,key,card,phase);
      return this._applyStateLeaf(patch,leaf);
    }catch(e){if(!this._customSchedulingErrorShown){this._customSchedulingErrorShown=true;console.warn('Custom Scheduling',e);showToast('Custom Scheduling falhou; o agendamento padrão foi preservado.');}return patch;}
  },
  _installCustomScheduling(){
    if(typeof CardEngine==='undefined'||typeof CardEngine.schedule!=='function'||CardEngine.schedule.__ankiCustom)return;
    const old=CardEngine.schedule.bind(CardEngine),self=this;this._baseScheduler=old;
    CardEngine.schedule=function(card,grade){let p=old(card,grade);p=window.AnkiStudyExtensions?window.AnkiStudyExtensions.filter('schedule:after',p,{card,grade,config:CardsConfig.forDeck(card.originalDeckId||card.deckId)}):p;return self._runCustomScheduling(card,grade,p);};CardEngine.schedule.__ankiCustom=true;
  },
  openCustomScheduling(){
    const c=this._customCfg();UI.prompt([
      {key:'enabled',label:'Ativar Custom Scheduling',type:'select',value:c.enabled?'1':'0',options:[{value:'0',label:'Desativado'},{value:'1',label:'Ativado'}],hint:'Compatível com a variável states do Custom Scheduling atual do Anki. Em erro ou saída inválida, o agendamento padrão é preservado.'},
      {key:'source',label:'Código JavaScript',type:'textarea',rows:14,value:c.source||'',hint:'Ex.: if (states.hard.normal?.learning) states.hard.normal.learning.scheduledSecs = 123 * 60; Também aceita o formato legado do Study com return { intervalo, _val, due... }.'}
    ],{title:'🧪 Custom Scheduling',okText:'Salvar'}).then(v=>{if(!v)return;this._saveCustomCfg({enabled:v.enabled==='1',source:String(v.source||'')});this._customSchedulingErrorShown=false;showToast('Custom Scheduling salvo');});
  },

  _installMenu(){
    const menu=document.getElementById('cards-more-menu');if(!menu)return;
    const add=(id,label,fn)=>{if(document.getElementById(id))return;const b=document.createElement('button');b.type='button';b.id=id;b.setAttribute('role','menuitem');b.textContent=label;b.onclick=()=>{menu.classList.remove('open');fn();};menu.appendChild(b);};
    add('cards-custom-scheduling-btn','🧪 Custom Scheduling',()=>this.openCustomScheduling());
    add('cards-extensions-btn','🧩 Extensões dos Cards',()=>this.openExtensions());
    this._loadUserExtensions();
  }
};
queueMicrotask(()=>AnkiTotalParity.install());
