/* ============================================================
   PARIDADE MÁXIMA — REVIEWER + BROWSER + BUSCA
   Camada aditiva sobre AnkiProductParity. Mantém o fluxo atual
   do Study e aproxima as operações do Anki/AnkiDroid 26.09.
   ============================================================ */
const AnkiMaxParity = {
  _voiceUrl:null,_voiceStream:null,_voiceRecorder:null,_voiceChunks:[],_previousCardId:null,

  install(){
    if(this._installed||typeof AnkiProductParity==='undefined'||typeof AnkiParity==='undefined'||typeof CardsScreen==='undefined')return;
    this._installed=true;
    this._enhanceBrowser();
    this._enhanceReviewer();
    this._injectVoiceModal();
  },

  /* A gramática de busca pertence exclusivamente a Collection.find_cards/find_notes
     no backend oficial. Este módulo não instala parser local. */

  /* ───────────────────────── BROWSER ───────────────────────── */
  _browserPrefsKey(){try{return AnkiParity._entityKey('browser','prefs');}catch(_){return 'snm-anki-browser-prefs';}},
  _loadBrowserPrefs(){
    let p={};try{p=JSON.parse(localStorage.getItem(this._browserPrefsKey())||'{}')||{};}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-max-reviewer-browser'); }
    const b=AnkiProductParity.browser;
    b.mode=p.mode==='cards'?'cards':'notes';
    b.columns=Array.isArray(p.columns)?p.columns.slice():null;
    b.sort=p.sort||b.sort||'sortField';b.sortDir=p.sortDir==='desc'?'desc':'asc';
  },
  _saveBrowserPrefs(){
    const b=AnkiProductParity.browser;try{localStorage.setItem(this._browserPrefsKey(),JSON.stringify({mode:b.mode,columns:b.columns,sort:b.sort,sortDir:b.sortDir}));}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-max-reviewer-browser'); }
  },
  _columnDefs(){
    const both=['notes','cards'];
    return {
      sortField:{label:'Classificar campo',modes:both},
      question:{label:'Pergunta',modes:both},answer:{label:'Resposta',modes:both},
      deck:{label:'Baralho',modes:both},notetype:{label:'Tipo de nota',modes:both},
      template:{label:'Card(s)',modes:both},due:{label:'Vencimento',modes:both},
      interval:{label:'(Méd.) Intervalo',modes:both},ease:{label:'(Méd.) Facilidade',modes:both},
      stability:{label:'(Méd.) Estabilidade',modes:both},difficulty:{label:'(Méd.) Dificuldade',modes:both},
      retrievability:{label:'(Méd.) Recuperabilidade',modes:both},reps:{label:'Revisões',modes:both},
      lapses:{label:'Lapsos',modes:both},position:{label:'Posição',modes:both},
      flag:{label:'Bandeira',modes:both},tags:{label:'Etiquetas',modes:both},
      cards:{label:'Cards',modes:both},created:{label:'Criada',modes:both},
      modified:{label:'Nota modificada',modes:both},cardModified:{label:'Card modificado',modes:both},
      noteId:{label:'ID nota',modes:both},cardId:{label:'ID card',modes:both}
    };
  },
  _defaultColumns(mode){return mode==='cards'?['question','deck','due','interval','stability','difficulty']:['sortField','notetype','cards','tags'];},
  _availableColumns(mode){const d=this._columnDefs();return Object.keys(d).filter(k=>d[k].modes.includes(mode));},
  _selectedColumns(){
    const b=AnkiProductParity.browser,available=new Set(this._availableColumns(b.mode));
    let cols=(Array.isArray(b.columns)?b.columns:[]).filter(c=>available.has(c));
    if(!cols.length)cols=this._defaultColumns(b.mode);return cols;
  },
  _isSortableColumn(key){return key!=='question'&&key!=='answer';},
  _reorderColumns(from,to){
    const b=AnkiProductParity.browser,cols=this._selectedColumns(),a=cols.indexOf(String(from)),z=cols.indexOf(String(to));
    if(a<0||z<0||a===z)return false;
    const [moved]=cols.splice(a,1);cols.splice(z,0,moved);b.columns=cols;this._saveBrowserPrefs();AnkiProductParity.renderBrowser();return true;
  },
  _officialBrowserCards(row){
    const data=row&&row._officialBrowser;
    if(!data)return [];
    return Array.isArray(data.cards)?data.cards:[data];
  },
  _officialStats(row){
    return this._officialBrowserCards(row).map(x=>x&&x.stats).filter(Boolean);
  },
  _officialAverage(row,read){
    const xs=this._officialStats(row).map(read).map(Number).filter(Number.isFinite);
    return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
  },
  _renderSides(row){
    const c=this._officialBrowserCards(row)[0];if(!c)return {q:'',a:''};
    const q=AnkiProductParity.plain(c.question||''),a=AnkiProductParity.plain(c.answer||'');
    return {q,a};
  },
  plain(v){return AnkiProductParity.plain(v);},
  _colValue(row,key){
    const noteMode=AnkiProductParity.browser.mode==='notes',official=this._officialBrowserCards(row),first=official[0]||null,
      stats=first&&first.stats||{},allStats=official.map(x=>x&&x.stats).filter(Boolean),sides=(key==='question'||key==='answer')?this._renderSides(row):null,
      avg=fn=>{const xs=allStats.map(fn).map(Number).filter(Number.isFinite);return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;};
    if(key==='sortField')return row.field||'';
    if(key==='question')return sides.q;
    if(key==='answer')return sides.a;
    if(key==='deck'){
      const names=[...new Set(allStats.map(x=>String(x.deck||'')).filter(Boolean))];
      return names.length===1?names[0]:(names.length?names.length:'');
    }
    if(key==='notetype')return String(stats.notetype||'');
    if(key==='template'||key==='cards')return noteMode?official.length:String(stats.card_type||'');
    if(key==='due'){
      const dates=allStats.map(x=>Number(x.due_date)).filter(x=>Number.isFinite(x)&&x>0);
      return dates.length?Math.min(...dates)*1000:'';
    }
    if(key==='interval')return avg(x=>x.interval);
    if(key==='ease')return avg(x=>Number(x.ease)/1000);
    if(key==='stability')return avg(x=>x.memory_state&&x.memory_state.stability);
    if(key==='difficulty')return avg(x=>x.memory_state&&x.memory_state.difficulty);
    if(key==='retrievability')return avg(x=>x.fsrs_retrievability);
    if(key==='reps')return allStats.reduce((n,x)=>n+(Number(x.reviews)||0),0);
    if(key==='lapses')return allStats.reduce((n,x)=>n+(Number(x.lapses)||0),0);
    if(key==='position'){
      const pos=allStats.map(x=>Number(x.due_position)).filter(Number.isFinite);return pos.length?Math.min(...pos):0;
    }
    if(key==='flag')return official.reduce((m,x)=>Math.max(m,Number(x&&x.flag)||0),0);
    if(key==='tags'){
      const tags=row&&row._officialBrowser&&Array.isArray(row._officialBrowser.tags)?row._officialBrowser.tags:(row.tags||[]);
      return tags.join(' ');
    }
    if(key==='created'){
      const ts=allStats.map(x=>Number(x.added)).filter(x=>Number.isFinite(x)&&x>0);return ts.length?Math.min(...ts)*1000:'';
    }
    if(key==='modified')return String(row.note&&row.note.updatedAt||'');
    if(key==='cardModified'){
      const cards=row.cards||[];return noteMode?cards.reduce((m,x)=>String(x.updatedAt||'')>m?String(x.updatedAt||''):m,''):String((row.card&&row.card.updatedAt)||'');
    }
    if(key==='noteId')return String((first&&first.note_id)||(row.note&&row.note.id)||'');
    if(key==='cardId')return String((first&&first.id)||(row.card&&row.card.id)||'');
    return '';
  },
  _formatCol(row,key){
    const v=this._colValue(row,key),c=row.card||(row.cards&&row.cards[0]);
    if(key==='due'&&v){if(typeof v==='number')return new Date(v).toLocaleString('pt-BR');return String(v);}
    if(key==='interval')return v?Number(v).toFixed(AnkiProductParity.browser.mode==='notes'?1:0)+'d':'—';
    if(key==='ease')return v?Number(v).toFixed(2):'—';
    if(key==='stability')return v?Number(v).toFixed(2)+'d':'—';
    if(key==='difficulty')return v?Number(v).toFixed(2):'—';
    if(key==='retrievability')return v?(Number(v)*100).toFixed(1)+'%':'—';
    if(key==='flag')return v&&DB.FLAGS[v]?'● '+DB.FLAGS[v].nome:'—';
    if(key==='created'||key==='modified'||key==='cardModified')return v?String(v).slice(0,10):'—';
    return String(v==null||v===''?'—':v);
  },

  _selectionKey(row){
    const card=AnkiProductParity.browser.mode==='cards'?row.card:null,obj=card||row.note,id=String(card?card.id:row.note.id),
      pid=(obj&&obj._planId)||(row.note&&row.note._planId)||'';
    return (card?'c:':'n:')+(pid?encodeURIComponent(String(pid))+'::'+encodeURIComponent(id):id);
  },
  _parseSelectionRef(raw){
    if(raw&&typeof raw==='object')return {kind:'note',id:String(raw.id||''),planId:raw._planId||null,note:raw};
    const s=String(raw||''),kind=s.startsWith('c:')?'card':'note',body=(s.startsWith('c:')||s.startsWith('n:'))?s.slice(2):s,cut=body.indexOf('::');
    if(cut<0)return {kind,id:body,planId:null,note:null};
    let planId=body.slice(0,cut),id=body.slice(cut+2);
    try{planId=decodeURIComponent(planId);id=decodeURIComponent(id);}catch(_){/* legado */ }
    return {kind,id,planId,note:null};
  },
  _resolveSelection(ids){
    const cards=[],notes=[],noteIds=new Set(),noteSeen=new Set();
    const addNote=n=>{if(!n)return;const k=String(n._planId||'')+'|'+String(n.id);if(noteSeen.has(k))return;noteSeen.add(k);notes.push(n);noteIds.add(String(n.id));};
    (ids||[]).forEach(raw=>{
      const ref=this._parseSelectionRef(raw);
      if(ref.note){
        addNote(ref.note);cards.push(...AnkiProductParity._cardsForNote(ref.note,ref.planId));return;
      }
      if(ref.kind==='card'){
        let c=null;
        if(ref.planId&&DB.getCardsForPlan){
          const x=(DB.getCardsForPlan(ref.planId)||[]).find(v=>String(v.id)===String(ref.id));
          if(x)c=Object.assign({},x,{_planId:ref.planId,_planNome:window.StudyGlobalScope&&StudyGlobalScope.planName?StudyGlobalScope.planName(ref.planId):String(ref.planId)});
        }else c=DB.getCard(ref.id);
        if(c){cards.push(c);const n=AnkiParity.noteForCard?AnkiParity.noteForCard(c):AnkiParity.getNote(AnkiProductParity.noteId(c),ref.planId||undefined);addNote(n);}
      }else{
        const n=ref.planId?AnkiParity.getNote(ref.id,ref.planId):AnkiParity.getNote(ref.id);
        addNote(n);cards.push(...AnkiProductParity._cardsForNote(n||ref.id,ref.planId));
      }
    });
    const uniqueCards=[...new Map(cards.map(c=>[String(c._planId||'')+'|'+String(c.id),c])).values()];
    return {cards:uniqueCards,noteIds:[...noteIds],notes};
  },

  _searchKind(term){
    const t=String(term||'').replace(/^-+/,'').trim(),m=/^([a-z][\w-]*):/i.exec(t);
    return m?m[1].toLowerCase():null;
  },
  _applyBrowserSearchTerm(term,ev){
    const b=AnkiProductParity.browser,input=document.getElementById('anki-browser-search');
    let t=String(term||'').trim();if(!t)return;
    const alt=!!(ev&&ev.altKey),shift=!!(ev&&ev.shiftKey),ctrl=!!(ev&&(ev.ctrlKey||ev.metaKey));
    if(alt&&!t.startsWith('-'))t='-'+t;
    let q=String(b.query||'').trim();
    if(ctrl&&shift){
      const kind=this._searchKind(t);
      if(kind){
        const safeKind=kind.replace(/[.*+?^$(){}|[\]\\]/g,'\\$&');
        const rx=new RegExp('(^|\\s)-?'+safeKind+':(?:"[^"]*"|\\S+)','gi');
        let changed=false;
        q=q.replace(rx,(m,lead)=>{changed=true;return lead+t;}).replace(/\\s+/g,' ').trim();
        if(!changed)q=q?(q+' '+t):t;
      }else q=t;
    }else if(shift)q=q?'('+q+') or '+t:t;
    else if(ctrl)q=q?(q+' '+t):t;
    else q=t;
    b.query=q;b.page=0;b.selected.clear();b._selectionAnchor=null;b._currentSelection=null;
    if(input)input.value=q;AnkiProductParity.renderBrowser();
  },
  _selectBrowserRow(key,ev){
    const b=AnkiProductParity.browser,rows=AnkiProductParity._browserRows(),keys=rows.map(r=>this._selectionKey(r)),idx=keys.indexOf(String(key));
    if(idx<0)return;
    const shift=!!(ev&&ev.shiftKey),ctrl=!!(ev&&(ev.ctrlKey||ev.metaKey));
    if(shift&&b._selectionAnchor&&keys.includes(b._selectionAnchor)){
      const a=keys.indexOf(b._selectionAnchor),lo=Math.min(a,idx),hi=Math.max(a,idx);
      if(!ctrl)b.selected.clear();
      for(let i=lo;i<=hi;i++)b.selected.add(keys[i]);
    }else if(ctrl){
      if(b.selected.has(key))b.selected.delete(key);else b.selected.add(key);
      b._selectionAnchor=key;
    }else{
      b.selected.clear();b.selected.add(key);b._selectionAnchor=key;
    }
    b._currentSelection=key;
  },

  _enhanceBrowser(){
    this._loadBrowserPrefs();
    const toolbar=document.querySelector('#anki-browser-modal .anki-browser-toolbar');if(!toolbar)return;
    const search=document.getElementById('anki-browser-search');
    const mode=document.createElement('select');mode.id='anki-browser-mode';mode.innerHTML='<option value="notes">Notas</option><option value="cards">Cards</option>';mode.value=AnkiProductParity.browser.mode;search.insertAdjacentElement('afterend',mode);
    const dir=document.createElement('button');dir.type='button';dir.className='btn-secondary anki-browser-sort-dir';dir.id='anki-browser-sort-dir';toolbar.appendChild(dir);
    const details=document.createElement('details');details.id='anki-browser-columns';details.className='anki-browser-columns';details.innerHTML='<summary>Colunas</summary><div id="anki-browser-columns-menu"></div>';toolbar.appendChild(details);
    const title=document.querySelector('#anki-browser-modal .cards-modal-head h2');if(title)title.textContent='🗃️ Navegador';
    const sub=document.querySelector('#anki-browser-modal .cards-modal-head .sub');if(sub)sub.textContent='Modos Cards/Notas, busca Anki, colunas configuráveis e operações em massa.';
    const searchTools=document.createElement('div');searchTools.id='anki-browser-search-tools';searchTools.className='anki-browser-search-tools';
    searchTools.innerHTML='<span class="hint">Busca rápida:</span>'+
      [['is:new','Novos'],['is:learn','Aprendendo'],['is:review','Revisão'],['is:due','Vencidos'],['is:suspended','Suspensos'],['tag:marked','Marcados']]
      .map(x=>'<button type="button" class="btn-secondary" data-browser-term="'+x[0]+'">'+x[1]+'</button>').join('');
    toolbar.insertAdjacentElement('afterend',searchTools);
    searchTools.addEventListener('click',e=>{const b=e.target.closest('[data-browser-term]');if(!b)return;this._applyBrowserSearchTerm(b.dataset.browserTerm,e);});
    searchTools.title='Clique substitui · Ctrl/Cmd = AND · Shift = OR · Alt = negar · Ctrl/Cmd+Shift = substituir o mesmo tipo';

    const renderControls=()=>{
      const b=AnkiProductParity.browser,defs=this._columnDefs(),avail=this._availableColumns(b.mode),cols=new Set(this._selectedColumns());
      document.getElementById('anki-browser-mode').value=b.mode;
      const sort=document.getElementById('anki-browser-sort'),sortable=avail.filter(k=>this._isSortableColumn(k));sort.innerHTML=sortable.map(k=>'<option value="'+k+'">'+AnkiProductParity.esc(defs[k].label)+'</option>').join('');
      if(!sortable.includes(b.sort))b.sort=this._defaultColumns(b.mode).find(k=>this._isSortableColumn(k))||sortable[0]||'sortField';sort.value=b.sort;
      dir.textContent=b.sortDir==='desc'?'↓':'↑';dir.title=b.sortDir==='desc'?'Decrescente':'Crescente';
      document.getElementById('anki-browser-columns-menu').innerHTML=avail.map(k=>'<label><input type="checkbox" data-col="'+k+'" '+(cols.has(k)?'checked':'')+'> '+AnkiProductParity.esc(defs[k].label)+'</label>').join('');
      this._saveBrowserPrefs();
    };
    this._renderBrowserControls=renderControls;renderControls();

    mode.addEventListener('change',e=>{const b=AnkiProductParity.browser;b.mode=e.target.value==='cards'?'cards':'notes';b.columns=null;b.sort=this._defaultColumns(b.mode)[0];b.page=0;b.selected.clear();b._selectionAnchor=null;b._currentSelection=null;renderControls();AnkiProductParity.renderBrowser();});
    dir.addEventListener('click',()=>{const b=AnkiProductParity.browser;b.sortDir=b.sortDir==='desc'?'asc':'desc';renderControls();AnkiProductParity.renderBrowser();});
    details.addEventListener('change',e=>{const cb=e.target.closest('[data-col]');if(!cb)return;const b=AnkiProductParity.browser,cols=new Set(this._selectedColumns());cb.checked?cols.add(cb.dataset.col):cols.delete(cb.dataset.col);b.columns=[...cols];this._saveBrowserPrefs();AnkiProductParity.renderBrowser();});
    document.getElementById('anki-browser-sort').addEventListener('change',()=>{AnkiProductParity.browser.sortDir='asc';this._saveBrowserPrefs();renderControls();});

    const list=document.getElementById('anki-browser-list');
    list.addEventListener('click',e=>{
      const row=e.target.closest('.anki-browser-row');if(!row||e.target.closest('.anki-browser-row-check'))return;
      e.preventDefault();e.stopImmediatePropagation();
      this._selectBrowserRow(row.dataset.note,e);
      const r=this._resolveSelection([row.dataset.note]);
      const cardOpen=e.target.closest('[data-card-open]'),noteOpen=e.target.closest('[data-note-open]');
      AnkiProductParity.renderBrowser();
      if(cardOpen)this.previewCard(r.cards[0]||cardOpen.dataset.cardOpen);
      else if(noteOpen&&r.notes[0])AnkiProductParity.previewNote(r.notes[0]);
      else if(AnkiProductParity.browser.mode==='cards'&&r.cards[0])this.previewCard(r.cards[0]);
      else if(r.notes[0])AnkiProductParity.previewNote(r.notes[0]);
    },true);
    list.addEventListener('keydown',e=>{
      const row=e.target.closest('.anki-browser-row');if(!row||(e.key!=='ArrowUp'&&e.key!=='ArrowDown'&&e.key!==' '))return;
      e.preventDefault();e.stopImmediatePropagation();
      if(e.key===' '){this._selectBrowserRow(row.dataset.note,e);AnkiProductParity.renderBrowser();return;}
      const els=[...list.querySelectorAll('.anki-browser-row')],i=els.indexOf(row),j=e.key==='ArrowUp'?i-1:i+1;
      if(j<0||j>=els.length)return;const next=els[j];this._selectBrowserRow(next.dataset.note,e);AnkiProductParity.renderBrowser();
      const focus=[...list.querySelectorAll('.anki-browser-row')].find(x=>x.dataset.note===next.dataset.note);if(focus){focus.focus();focus.scrollIntoView({block:'nearest'});}
    },true);
    list.addEventListener('dblclick',e=>{const row=e.target.closest('.anki-browser-row');if(!row)return;e.preventDefault();e.stopImmediatePropagation();const r=this._resolveSelection([row.dataset.note]);if(r.notes[0])AnkiProductParity.openNoteEditor(r.notes[0]);},true);
    document.getElementById('anki-browser-select-all').addEventListener('change',e=>{e.stopImmediatePropagation();const rows=AnkiProductParity._browserRows(),b=AnkiProductParity.browser;b.selected.clear();if(e.target.checked)rows.forEach(r=>b.selected.add(this._selectionKey(r)));b._selectionAnchor=null;b._currentSelection=null;AnkiProductParity.renderBrowser();},true);

    this._overrideBrowserRender();
    this._overrideBrowserBulk();
  },

  _overrideBrowserRows(){
    /* A ordem e o pertencimento das linhas vêm do cache hidratado por
       CardsOfficialBridge._refreshOfficialBrowser(). */
  },

  _overrideBrowserRender(){
    AnkiProductParity.renderBrowser=()=>{
      const b=AnkiProductParity.browser,rows=AnkiProductParity._browserRows(),end=Math.min(rows.length,(b.page+1)*AnkiProductParity.PAGE),shown=rows.slice(0,end),list=document.getElementById('anki-browser-list'),defs=this._columnDefs(),cols=this._selectedColumns();
      if(this._renderBrowserControls)this._renderBrowserControls();
      document.getElementById('anki-browser-summary').textContent=rows.length.toLocaleString('pt-BR')+' '+(b.mode==='cards'?'card(s)':'nota(s)')+' exibido(s)';
      const head=document.querySelector('.anki-browser-table-head'),grid='34px '+cols.map(()=> 'minmax(110px,1fr)').join(' ')+' 54px';
      head.style.gridTemplateColumns=grid;head.innerHTML='<span></span>'+cols.map(k=>{const sortable=this._isSortableColumn(k);return '<button type="button" draggable="true" class="anki-browser-col-head '+(sortable?'':'is-unsortable')+'" data-col-drag="'+k+'" '+(sortable?'data-sort-col="'+k+'"':'aria-disabled="true"')+' title="'+(sortable?'Clique para ordenar · arraste para reordenar':'Arraste para reordenar · esta coluna não ordena no Anki')+'">'+AnkiProductParity.esc(defs[k].label)+(b.sort===k?(b.sortDir==='desc'?' ↓':' ↑'):'')+'</button>';}).join('')+'<span></span>';
      head.querySelectorAll('[data-sort-col]').forEach(x=>x.addEventListener('click',()=>{if(b.sort===x.dataset.sortCol)b.sortDir=b.sortDir==='desc'?'asc':'desc';else{b.sort=x.dataset.sortCol;b.sortDir='asc';}this._saveBrowserPrefs();AnkiProductParity.renderBrowser();}));
      head.querySelectorAll('[data-col-drag]').forEach(x=>{
        x.addEventListener('dragstart',e=>{this._dragColumn=x.dataset.colDrag;x.classList.add('is-dragging');if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',this._dragColumn);}});
        x.addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';});
        x.addEventListener('drop',e=>{e.preventDefault();const from=(e.dataTransfer&&e.dataTransfer.getData('text/plain'))||this._dragColumn;this._reorderColumns(from,x.dataset.colDrag);});
        x.addEventListener('dragend',()=>{this._dragColumn=null;x.classList.remove('is-dragging');});
        x.addEventListener('keydown',e=>{if(!e.altKey||(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'))return;const cs=this._selectedColumns(),i=cs.indexOf(x.dataset.colDrag),j=e.key==='ArrowLeft'?i-1:i+1;if(j<0||j>=cs.length)return;e.preventDefault();this._reorderColumns(cs[i],cs[j]);});
      });
      list.innerHTML=shown.map(r=>{
        const sk=this._selectionKey(r),nid=String(r.note.id),sel=b.selected.has(sk),open=r.card?'data-card-open="'+AnkiProductParity.esc(r.card.id)+'"':'data-note-open="'+AnkiProductParity.esc(nid)+'"';
        const cells=cols.map((k,i)=>'<button type="button" class="anki-browser-cell '+(i===0?'anki-browser-field':'')+'" '+(i===0?open:'')+' title="'+AnkiProductParity.esc(this._formatCol(r,k))+'">'+AnkiProductParity.esc(this._formatCol(r,k))+'</button>').join('');
        return '<div class="anki-browser-row '+(sel?'is-sel':'')+'" tabindex="0" role="row" aria-selected="'+(sel?'true':'false')+'" style="grid-template-columns:'+grid+'" data-note="'+AnkiProductParity.esc(sk)+'" data-noteid="'+AnkiProductParity.esc(nid)+'">'+
          '<label><input class="anki-browser-row-check" type="checkbox" '+(sel?'checked':'')+'></label>'+cells+
          '<span class="anki-browser-state">'+(r.suspended?'⏸':'')+(r.marked?' ★':'')+'</span></div>';
      }).join('')||'<div class="empty-state"><h3>Nenhum resultado</h3><p>Ajuste a busca ou os filtros.</p></div>';
      const more=document.getElementById('anki-browser-more');more.innerHTML=end<rows.length?'<button type="button" class="btn-secondary" id="anki-browser-more-btn">Carregar mais '+Math.min(AnkiProductParity.PAGE,rows.length-end)+'</button>':'';
      const mb=document.getElementById('anki-browser-more-btn');if(mb)mb.addEventListener('click',()=>{b.page++;AnkiProductParity.renderBrowser();});
      const del=document.getElementById('anki-browser-delete-btn');if(del)del.textContent='Excluir notas';
      AnkiProductParity._syncBrowserBulk(rows);
    };
  },

  previewCard(cardId){
    const c=cardId&&typeof cardId==='object'?cardId:DB.getCard(cardId);
    if(!c){const box=document.getElementById('anki-browser-preview');if(box)box.innerHTML='<p class="hint">Card não encontrado.</p>';return;}
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.previewBrowserCard!=='function'){showToast('Prévia não renderizada: Anki oficial indisponível.');return;}
    void CardsOfficialBridge.previewBrowserCard(c).catch(e=>showToast('Prévia oficial indisponível: '+(e&&e.message?e.message:String(e))));
  },

  _officialBrowserCall(name,ids){
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge[name]!=='function'){
      showToast('Ação não executada: Browser oficial do Anki indisponível.');return;
    }
    return CardsOfficialBridge[name](ids);
  },
  _overrideBrowserBulk(){
    AnkiProductParity.toggleSuspend=(ids)=>this._officialBrowserCall('_browserToggleSuspend',ids);
    AnkiProductParity.bulkFlag=(ids)=>this._officialBrowserCall('_browserBulkFlag',ids);
    AnkiProductParity.bulkMark=(ids)=>this._officialBrowserCall('_browserBulkMark',ids);
    AnkiProductParity.editTags=(ids)=>this._officialBrowserCall('_browserEditTags',ids);
    AnkiProductParity.bulkFindReplace=(ids)=>this._officialBrowserCall('_browserFindReplace',ids);
    AnkiProductParity.deleteNotes=(ids)=>this._officialBrowserCall('_browserDeleteNotes',ids);
    AnkiProductParity.openChangeType=(ids)=>this._officialBrowserCall('_openOfficialChangeType',ids);
    AnkiProductParity.browserBulkActions=(ids)=>{
      if(!ids||!ids.length)return;
      UI.prompt([{key:'action',label:'Ação',type:'select',value:'mark',options:[
        {value:'mark',label:'★ Marcar/desmarcar notas'},{value:'deck',label:'📁 Mover para baralho'},{value:'due',label:'📅 Definir vencimento'},
        {value:'forget',label:'↺ Esquecer / tornar novos'},{value:'reposition',label:'🔢 Reposicionar novos'},{value:'replace',label:'🔁 Localizar e substituir'}
      ]}],{title:'⋯ Ações do navegador',okText:'Continuar'}).then(v=>{
        if(!v)return;
        const map={mark:'_browserBulkMark',deck:'_browserMove',due:'_browserSetDue',forget:'_browserForget',reposition:'_browserReposition',replace:'_browserFindReplace'};
        this._officialBrowserCall(map[v.action],ids);
      });
    };
  },
  _bulkCardsMove(ids){return this._officialBrowserCall('_browserMove',ids);},
  _bulkCardsDue(ids){return this._officialBrowserCall('_browserSetDue',ids);},
  _bulkCardsForget(ids){return this._officialBrowserCall('_browserForget',ids);},
  _bulkCardsReposition(ids){return this._officialBrowserCall('_browserReposition',ids);},

  /* ───────────────────────── REVIEWER ───────────────────────── */
  _enhanceReviewer(){
    const oldDecorate=AnkiProductParity.decorateReviewer.bind(AnkiProductParity);
    AnkiProductParity.decorateReviewer=()=>{oldDecorate();this._decorateReviewerExact();};

    AnkiProductParity.openReviewerActions=(cardHint)=>this.openReviewerActions(cardHint);

    const oldAnswer=CardsScreen.answer.bind(CardsScreen);
    CardsScreen.answer=async(grade)=>{
      const current=AnkiProductParity._currentReviewCard(),id=(CardsScreen._reviewQueue||[])[CardsScreen._reviewIdx]||null;
      const previous=current?Object.assign({},current):null,ok=await oldAnswer(grade);
      if(ok===true&&id){this._previousCardId=id;this._previousCardRef=previous||id;}
      return ok;
    };

    const oldKey=CardsScreen.onKey.bind(CardsScreen);
    CardsScreen.onKey=(e)=>{if(this._handleReviewerKey(e))return;return oldKey(e);};
  },
  _isMarkedNote(note){return !!note&&(note.tags||[]).some(t=>String(t).toLowerCase()==='marked');},
  _toggleMarkedNote(){
    if(window.CardsOfficialBridge&&CardsOfficialBridge.review&&CardsOfficialBridge.review.card){void CardsOfficialBridge.mark();return true;}
    showToast('Marcação não alterada: Reviewer oficial indisponível.');return false;
  },
  _decorateReviewerExact(){
    const c=AnkiProductParity._currentReviewCard();if(!c)return;const pid=c._planId||(window.StudyGlobalScope&&StudyGlobalScope.sourcePlanForCard?StudyGlobalScope.sourcePlanForCard(c):null),nid=AnkiProductParity.noteId(c),note=AnkiParity.getNote(nid,pid),mark=document.getElementById('cards-act-mark');
    if(mark){
      const on=this._isMarkedNote(note);mark.textContent=on?'★ Marcada':'☆ Marcar';mark.title='Marcar/desmarcar nota (*)';
      mark.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();if(window.CardsOfficialBridge&&CardsOfficialBridge.review&&CardsOfficialBridge.review.card)void CardsOfficialBridge.mark();else showToast('Marcação não alterada: Reviewer oficial indisponível.');},true);
    }
    const bar=document.querySelector('.cards-flagbar');
    if(bar){
      bar.title='Bandeiras (Ctrl+1..7, Ctrl+0 remove)';
      [5,6,7].forEach(n=>{if(bar.querySelector('[data-flag="'+n+'"]'))return;const b=document.createElement('button');b.type='button';b.className='cards-flag '+((c.flag||0)===n?'on':'');b.dataset.flag=String(n);b.style.setProperty('--fl',DB.FLAGS[n].cor);b.title=DB.FLAGS[n].nome+' (Ctrl+'+n+')';b.addEventListener('click',()=>{const v=(c.flag||0)===n?0:n;if(window.CardsOfficialBridge&&CardsOfficialBridge.review&&CardsOfficialBridge.review.card)void CardsOfficialBridge.action('flag',v);else showToast('Bandeira não alterada: Reviewer oficial indisponível.');});bar.appendChild(b);});
    }
  },
  _reviewActive(e){
    const scr=document.getElementById('screen-cards');if(!scr||!scr.classList.contains('active')||CardsScreen.tab!=='revisar')return false;
    const tag=String(e.target&&e.target.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea'||(e.target&&e.target.isContentEditable))return false;
    return true;
  },
  _handleReviewerKey(e){
    if(!this._reviewActive(e))return false;const c=AnkiProductParity._currentReviewCard();
    if((e.ctrlKey||e.metaKey)&&/^Digit[5-7]$/.test(e.code)&&c){e.preventDefault();const v=Number(e.code.slice(5));if(window.CardsOfficialBridge&&CardsOfficialBridge.review&&CardsOfficialBridge.review.card)void CardsOfficialBridge.action('flag',v);else showToast('Bandeira não alterada: Reviewer oficial indisponível.');return true;}
    if(!e.ctrlKey&&!e.metaKey&&!e.altKey){
      if(e.key==='='){e.preventDefault();this.buryNote(c);return true;}
      if(e.key==='!'){e.preventDefault();this.suspendNote(c);return true;}
      if(e.code==='KeyH'){e.preventDefault();this.showHints(false);return true;}
      if(e.code==='KeyG'){e.preventDefault();this.showHints(true);return true;}
      if(e.code==='KeyR'){e.preventDefault();if(window.CardsOfficialBridge)void CardsOfficialBridge.replayCurrentAv();else showToast('Mídia oficial indisponível.');return true;}
      if(e.code==='Digit5'){e.preventDefault();if(window.CardsOfficialBridge&&CardsOfficialBridge.pauseAv)CardsOfficialBridge.pauseAv();return true;}
      if(e.code==='Digit6'){e.preventDefault();if(window.CardsOfficialBridge&&CardsOfficialBridge.seekAv)CardsOfficialBridge.seekAv(-5);return true;}
      if(e.code==='Digit7'){e.preventDefault();if(window.CardsOfficialBridge&&CardsOfficialBridge.seekAv)CardsOfficialBridge.seekAv(5);return true;}
      if(e.code==='KeyV'&&e.shiftKey){e.preventDefault();this.openVoiceRecorder();return true;}
      if(e.code==='KeyV'){e.preventDefault();this.replayOwnVoice();return true;}
      if(e.code==='KeyB'){e.preventDefault();AnkiProductParity.openBrowser();return true;}
      if(e.code==='KeyT'){e.preventDefault();const t=document.querySelector('.cards-tab[data-ctab="stats"]');if(t)t.click();return true;}
      if(e.code==='KeyA'&&!e.shiftKey){e.preventDefault();CardsScreen.openCardModal();return true;}
    }
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.code==='KeyI'){e.preventDefault();this.previousCardInfo();return true;}
    return false;
  },

  _officialReviewerCardsForNote(card){
    return card?AnkiProductParity._cardsForNote(AnkiProductParity.noteId(card),card._planId):[];
  },
  buryNote(card){
    if(!window.CardsOfficialBridge){showToast('Anki oficial indisponível.');return;}
    const cards=this._officialReviewerCardsForNote(card);void CardsOfficialBridge.actionCards('bury',cards).then(()=>showToast('Nota enterrada pelo Anki oficial ✓')).catch(e=>showToast(e.message||String(e)));
  },
  suspendNote(card){
    if(!window.CardsOfficialBridge){showToast('Anki oficial indisponível.');return;}
    const cards=this._officialReviewerCardsForNote(card);void CardsOfficialBridge.actionCards('suspend',cards).then(()=>showToast('Nota suspensa pelo Anki oficial ✓')).catch(e=>showToast(e.message||String(e)));
  },
  suspendCard(card){
    if(!window.CardsOfficialBridge){showToast('Anki oficial indisponível.');return;}
    void CardsOfficialBridge.actionCards('suspend',[card]).then(()=>showToast('Card suspenso pelo Anki oficial ✓')).catch(e=>showToast(e.message||String(e)));
  },
  buryCard(card){
    if(!window.CardsOfficialBridge){showToast('Anki oficial indisponível.');return;}
    void CardsOfficialBridge.actionCards('bury',[card]).then(()=>showToast('Card enterrado pelo Anki oficial ✓')).catch(e=>showToast(e.message||String(e)));
  },
  showHints(all){
    const list=[...document.querySelectorAll('#cards-content details.hint')];if(!list.length){showToast('Nenhuma dica neste lado do card');return;}if(all)list.forEach(x=>x.open=true);else list[0].open=true;
  },
  previousCardInfo(){if(!this._previousCardRef&&!this._previousCardId){showToast('Nenhum card anterior nesta sessão');return;}CardsScreen.cardInfo(this._previousCardRef||this._previousCardId);},

  openReviewerActions(cardHint){
    const c=cardHint||AnkiProductParity._currentReviewCard();if(!c)return;const opts=[];
    if((CardsScreen._redoStack||[]).length)opts.push({value:'redo',label:'↷ Refazer última ação'});
    opts.push(
      {value:'mark',label:'★ Marcar/desmarcar nota'},{value:'tags',label:'🏷 Editar etiquetas'},
      {value:'buryCard',label:'⤓ Enterrar card'},{value:'buryNote',label:'⤓ Enterrar nota'},
      {value:'suspendCard',label:'🚫 Suspender card'},{value:'suspendNote',label:'🚫 Suspender nota'},
      {value:'hint',label:'💡 Mostrar dica'},{value:'allHints',label:'💡 Mostrar todas as dicas'},
      {value:'media',label:'▶ Repetir mídia'},{value:'tts',label:'🎙 Texto para voz'},
      {value:'recordVoice',label:'🎤 Gravar própria voz'},{value:'replayVoice',label:'🔊 Reproduzir própria voz'},
      {value:'whiteboard',label:'✍ Quadro'},{value:'infoPrev',label:'ℹ Informações do card anterior'},
      {value:'add',label:'＋ Adicionar nota'},{value:'browse',label:'🗃 Navegador'},
      {value:'stats',label:'📊 Estatísticas'},{value:'type',label:'🧩 Mudar tipo de nota'},{value:'deck',label:'⚙ Opções de baralho'}
    );
    UI.prompt([{key:'action',label:'Ação',type:'select',value:opts[0].value,options:opts}],{title:'⋯ Mais ações',okText:'Abrir'}).then(v=>{
      if(!v)return;const nid=AnkiProductParity.noteId(c),a=v.action;
      if(a==='redo')CardsScreen.redoAnswer();else if(a==='mark'){if(window.CardsOfficialBridge)void CardsOfficialBridge.mark();else showToast('Anki oficial indisponível.');}
      else if(a==='tags'){if(window.CardsOfficialBridge)AnkiProductParity.editTags(['n:'+nid]);else showToast('Anki oficial indisponível.');}else if(a==='buryCard')this.buryCard(c);else if(a==='buryNote')this.buryNote(c);
      else if(a==='suspendCard')this.suspendCard(c);else if(a==='suspendNote')this.suspendNote(c);else if(a==='hint')this.showHints(false);else if(a==='allHints')this.showHints(true);
      else if(a==='media'){if(window.CardsOfficialBridge)void CardsOfficialBridge.replayCurrentAv();else showToast('Mídia oficial indisponível.');}else if(a==='tts'){if(window.CardsOfficialBridge)void CardsOfficialBridge.speakCurrentTts();else showToast('TTS oficial indisponível.');}else if(a==='recordVoice')this.openVoiceRecorder();else if(a==='replayVoice')this.replayOwnVoice();
      else if(a==='whiteboard')AnkiProductParity.openWhiteboard();else if(a==='infoPrev')this.previousCardInfo();else if(a==='add')CardsScreen.openCardModal();else if(a==='browse')AnkiProductParity.openBrowser();
      else if(a==='stats'){const t=document.querySelector('.cards-tab[data-ctab="stats"]');if(t)t.click();}else if(a==='type'){const n=AnkiParity.noteForCard?AnkiParity.noteForCard(c):null;AnkiProductParity.openChangeType([n||('n:'+nid)]);}else if(a==='deck')CardsScreen.openAlgoConfigFor(c.deckId||null);
    });
  },

  /* ───────────────────────── VOZ PRÓPRIA ───────────────────────── */
  _injectVoiceModal(){
    if(document.getElementById('anki-own-voice-modal'))return;const d=document.createElement('div');d.innerHTML='<div id="anki-own-voice-modal" class="cards-modal anki-product-modal" style="display:none"><div class="cards-modal-box" style="max-width:430px"><div class="cards-modal-head"><div><h2>🎤 Própria voz</h2><p class="sub">Gravação temporária da sessão, como a ação de voz do reviewer.</p></div><button class="icon-btn" id="anki-voice-close">✕</button></div><div class="cards-modal-body"><p id="anki-voice-status" class="hint">Pronto para gravar.</p></div><div class="cards-modal-foot"><button class="btn-secondary" id="anki-voice-record">● Gravar</button><button class="btn-secondary" id="anki-voice-stop" disabled>■ Parar</button><button class="btn-primary" id="anki-voice-replay" disabled>▶ Reproduzir</button></div></div></div>';document.body.appendChild(d);
    document.getElementById('anki-voice-close').onclick=()=>{document.getElementById('anki-own-voice-modal').style.display='none';};
    document.getElementById('anki-voice-record').onclick=()=>this.startOwnVoice();document.getElementById('anki-voice-stop').onclick=()=>this.stopOwnVoice();document.getElementById('anki-voice-replay').onclick=()=>this.replayOwnVoice();
  },
  openVoiceRecorder(){document.getElementById('anki-own-voice-modal').style.display='flex';},
  async startOwnVoice(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){showToast('Gravação de voz indisponível neste navegador');return;}
    try{
      this._voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});this._voiceChunks=[];this._voiceRecorder=new MediaRecorder(this._voiceStream);
      this._voiceRecorder.ondataavailable=e=>{if(e.data&&e.data.size)this._voiceChunks.push(e.data);};
      this._voiceRecorder.onstop=()=>{if(this._voiceUrl)URL.revokeObjectURL(this._voiceUrl);const blob=new Blob(this._voiceChunks,{type:this._voiceRecorder.mimeType||'audio/webm'});this._voiceUrl=URL.createObjectURL(blob);this._voiceStream&&this._voiceStream.getTracks().forEach(t=>t.stop());this._voiceStream=null;document.getElementById('anki-voice-status').textContent='Gravação pronta.';document.getElementById('anki-voice-replay').disabled=false;};
      this._voiceRecorder.start();document.getElementById('anki-voice-status').textContent='Gravando…';document.getElementById('anki-voice-record').disabled=true;document.getElementById('anki-voice-stop').disabled=false;
    }catch(e){showToast('Não foi possível acessar o microfone');}
  },
  stopOwnVoice(){
    if(this._voiceRecorder&&this._voiceRecorder.state!=='inactive')this._voiceRecorder.stop();document.getElementById('anki-voice-record').disabled=false;document.getElementById('anki-voice-stop').disabled=true;
  },
  replayOwnVoice(){if(!this._voiceUrl){showToast('Nenhuma gravação de voz nesta sessão');return;}try{new Audio(this._voiceUrl).play().catch(()=>showToast('Não foi possível reproduzir a gravação'));}catch(_){showToast('Não foi possível reproduzir a gravação');}}
};
window.AnkiMaxParity=AnkiMaxParity;
queueMicrotask(()=>AnkiMaxParity.install());
