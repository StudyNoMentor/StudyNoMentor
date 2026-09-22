/* ============================================================
   Paridade prática 10/10 — superfícies web equivalentes ao Anki
   Camada aditiva: Deck Manager, Browser Sidebar, preferências
   operacionais e hooks. Não altera FSRS/scheduler.
   ============================================================ */
const AnkiPractical10 = {
  _installed:false,

  install(){
    if(this._installed||typeof CardsScreen==='undefined'||typeof AnkiProductParity==='undefined')return;
    this._installed=true;
    this._groupMoreMenu();
    this._enhanceDeckManager();
    this._enhanceBrowserSidebar();
    this._installPreferences();
    this._installHooks();
  },
  esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},

  /* ───────────────────────── MAIS ───────────────────────── */
  _groupMoreMenu(){
    const menu=document.getElementById('cards-more-menu');if(!menu||menu.dataset.grouped==='1')return;
    menu.dataset.grouped='1';
    const defs=[
      ['study','Estudo',['cards-custom-btn','cards-filtered-btn']],
      ['content','Conteúdo',['cards-advanced-add-btn','cards-browser-btn','cards-shared-decks-btn','cards-notetypes-btn']],
      ['io','Entrada e saída',['cards-import-btn','cards-export-btn']],
      ['maintenance','Manutenção',['cards-reviewer-bindings-btn','cards-check-collection-btn','cards-empty-btn','cards-audit-export-btn']],
      ['advanced','Avançado',['cards-algo-btn','cards-custom-scheduling-btn','cards-extensions-btn','cards-preferences-btn']]
    ];
    defs.forEach(([key,label,ids])=>{
      const buttons=ids.map(id=>document.getElementById(id)).filter(b=>b&&b.parentNode===menu);
      if(!buttons.length)return;
      const g=document.createElement('div');g.className='cards-more-group';g.dataset.group=key;g.setAttribute('role','group');g.setAttribute('aria-label',label);
      const h=document.createElement('div');h.className='cards-more-group-label';h.textContent=label;g.appendChild(h);
      buttons.forEach(b=>g.appendChild(b));menu.appendChild(g);
    });
  },
  _regroupLater(){queueMicrotask(()=>this._groupMoreMenu());},

  /* ─────────────────────── DECK MANAGER ─────────────────────── */
  _enhanceDeckManager(){
    const modal=document.getElementById('deck-modal'),body=modal&&modal.querySelector('.cards-modal-body');if(!body)return;
    if(!document.getElementById('deck-search')){
      const tools=document.createElement('div');tools.className='anki-deck-tools';tools.innerHTML=
        '<input id="deck-search" type="search" placeholder="Buscar baralho ou subbaralho…" aria-label="Buscar baralho">'+
        '<button type="button" class="btn-secondary" id="deck-collapse-all">Recolher árvore</button>';
      const list=document.getElementById('deck-list');body.insertBefore(tools,list);
      document.getElementById('deck-search').addEventListener('input',()=>this._filterDeckRows());
      document.getElementById('deck-collapse-all').addEventListener('click',()=>{
        const rows=[...document.querySelectorAll('#deck-list .deck-row')],allCollapsed=rows.every(r=>r.dataset.collapsed==='1'||!r.dataset.hasChildren);
        rows.forEach(r=>{if(r.dataset.hasChildren)r.dataset.collapsed=allCollapsed?'0':'1';});
        this._applyDeckCollapse();
        document.getElementById('deck-collapse-all').textContent=allCollapsed?'Recolher árvore':'Expandir árvore';
      });
    }
    const old=CardsScreen.renderDeckList.bind(CardsScreen);
    CardsScreen.renderDeckList=()=>{const out=old();this._decorateDeckRows();return out;};
    const oldOpen=CardsScreen.openDeckModal.bind(CardsScreen);
    CardsScreen.openDeckModal=()=>{const out=oldOpen();const s=document.getElementById('deck-search');if(s)s.value='';this._decorateDeckRows();return out;};
  },
  _deckMeta(){
    const decks=DB.getDecks().slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR',{numeric:true,sensitivity:'base'}));
    const cards=DB.getCards();
    return decks.map(d=>{
      const name=String(d.nome||''),parts=name.split('::'),prefix=name+'::';
      const direct=cards.filter(c=>String(c.deckId)===String(d.id)).length;
      const descendantIds=new Set(decks.filter(x=>String(x.nome||'').startsWith(prefix)).map(x=>String(x.id)));
      const descendants=cards.filter(c=>descendantIds.has(String(c.deckId))).length;
      return {d,name,parts,depth:Math.max(0,parts.length-1),direct,total:direct+descendants,hasChildren:descendantIds.size>0};
    });
  },
  _decorateDeckRows(){
    const list=document.getElementById('deck-list');if(!list)return;
    const meta=this._deckMeta(),map=new Map(meta.map(x=>[String(x.d.id),x]));
    const rows=[...list.querySelectorAll('.deck-row')];
    rows.sort((a,b)=>(map.get(String(a.dataset.id))?.name||'').localeCompare(map.get(String(b.dataset.id))?.name||'','pt-BR',{numeric:true,sensitivity:'base'})).forEach(r=>list.appendChild(r));
    rows.forEach(row=>{
      const m=map.get(String(row.dataset.id));if(!m)return;
      row.dataset.deckName=m.name;row.dataset.depth=String(m.depth);row.dataset.hasChildren=m.hasChildren?'1':'';
      row.style.setProperty('--deck-depth',String(m.depth));
      const count=row.querySelector('.deck-count');if(count){
        count.textContent=(m.hasChildren?(m.direct+' direto · '+m.total+' total'):(m.direct+' card(s)'));
        count.title=m.hasChildren?'Inclui cards dos subbaralhos':'Cards diretamente neste baralho';
      }
      if(!row.querySelector('.anki-deck-tree-toggle')){
        const input=row.querySelector('.deck-name');
        const t=document.createElement('button');t.type='button';t.className='icon-btn anki-deck-tree-toggle';t.setAttribute('aria-label','Expandir/recolher subbaralhos');t.textContent=m.hasChildren?'▾':'·';t.disabled=!m.hasChildren;
        input.insertAdjacentElement('beforebegin',t);
        t.addEventListener('click',()=>{row.dataset.collapsed=row.dataset.collapsed==='1'?'0':'1';t.textContent=row.dataset.collapsed==='1'?'▸':'▾';this._applyDeckCollapse();});
        const sub=document.createElement('button');sub.type='button';sub.className='icon-btn anki-deck-sub';sub.title='Criar subbaralho';sub.setAttribute('aria-label','Criar subbaralho');sub.textContent='＋';
        sub.addEventListener('click',()=>this._addSubdeck(m.d.id));
        const opt=document.createElement('button');opt.type='button';opt.className='icon-btn anki-deck-options';opt.title='Opções / preset deste baralho';opt.setAttribute('aria-label','Opções do baralho');opt.textContent='⚙';
        opt.addEventListener('click',()=>CardsScreen.openAlgoConfigFor(m.d.id));
        const firstAction=row.querySelector('.deck-ver');if(firstAction){row.insertBefore(sub,firstAction);row.insertBefore(opt,firstAction);}
      } else {
        const t=row.querySelector('.anki-deck-tree-toggle');t.disabled=!m.hasChildren;t.textContent=m.hasChildren?(row.dataset.collapsed==='1'?'▸':'▾'):'·';
      }
    });
    this._filterDeckRows();this._applyDeckCollapse();
  },
  _addSubdeck(id){
    const d=DB.getDecks().find(x=>String(x.id)===String(id));if(!d)return;
    UI.prompt([{key:'name',label:'Nome do subbaralho',type:'text',value:'',placeholder:'Ex.: Capítulo 1'}],{title:'＋ Criar subbaralho',okText:'Criar'}).then(v=>{
      const leaf=String(v&&v.name||'').trim();if(!leaf)return;
      if(leaf.includes('::')){showToast('Use apenas o nome do nível; a hierarquia é criada automaticamente.');return;}
      const created=DB.addDeck(String(d.nome)+'::'+leaf);if(!created){showToast('Não foi possível criar o subbaralho');return;}
      CardsScreen.renderDeckList();CardsScreen.render();showToast('Subbaralho criado ✓');
    });
  },
  _filterDeckRows(){
    const q=String((document.getElementById('deck-search')||{}).value||'').trim().toLocaleLowerCase('pt-BR');
    document.querySelectorAll('#deck-list .deck-row').forEach(r=>{r.dataset.searchHidden=q&&!String(r.dataset.deckName||'').toLocaleLowerCase('pt-BR').includes(q)?'1':'';});
    this._applyDeckCollapse();
  },
  _applyDeckCollapse(){
    const rows=[...document.querySelectorAll('#deck-list .deck-row')],collapsed=rows.filter(r=>r.dataset.collapsed==='1').map(r=>String(r.dataset.deckName||'')+'::');
    rows.forEach(r=>{
      const name=String(r.dataset.deckName||''),byParent=collapsed.some(p=>name.startsWith(p)),bySearch=r.dataset.searchHidden==='1';
      r.style.display=(byParent||bySearch)?'none':'';
    });
  },

  /* ───────────────────── BROWSER SIDEBAR ───────────────────── */
  _enhanceBrowserSidebar(){
    const layout=document.querySelector('#anki-browser-modal .anki-browser-layout');if(!layout||document.getElementById('anki-browser-sidebar'))return;
    const aside=document.createElement('aside');aside.id='anki-browser-sidebar';aside.className='anki-browser-sidebar';aside.setAttribute('aria-label','Navegação do Browser');
    layout.insertBefore(aside,layout.firstChild);
    aside.addEventListener('click',e=>{const b=e.target.closest('[data-browser-filter]');if(!b)return;this._applyBrowserFilter(b.dataset.browserFilter,b.dataset.value||'');});
    const oldOpen=AnkiProductParity.openBrowser.bind(AnkiProductParity);
    AnkiProductParity.openBrowser=(...args)=>{const out=oldOpen(...args);this._renderBrowserSidebar();return out;};
    const oldRender=AnkiProductParity.renderBrowser.bind(AnkiProductParity);
    AnkiProductParity.renderBrowser=(...args)=>{const out=oldRender(...args);this._renderBrowserSidebar();return out;};
    this._renderBrowserSidebar();
  },
  _sideSection(label,items,open=true){
    return '<details class="anki-browser-side-section" '+(open?'open':'')+'><summary>'+this.esc(label)+'</summary><div>'+
      items.map(x=>'<button type="button" data-browser-filter="'+this.esc(x.kind)+'" data-value="'+this.esc(x.value||'')+'" title="'+this.esc(x.title||x.label)+'"><span>'+this.esc(x.label)+'</span>'+(x.count!=null?'<small>'+Number(x.count).toLocaleString('pt-BR')+'</small>':'')+'</button>').join('')+
      '</div></details>';
  },
  _renderBrowserSidebar(){
    const a=document.getElementById('anki-browser-sidebar');if(!a||typeof AnkiParity==='undefined')return;
    const cards=DB.getCards(),notes=AnkiParity.notes(),decks=DB.getDecks(),types=AnkiParity.noteTypes();
    const saved=typeof AnkiTotalParity!=='undefined'?AnkiTotalParity._savedSearches():[];
    const tags=new Map();notes.forEach(n=>(n.tags||[]).forEach(t=>tags.set(String(t),(tags.get(String(t))||0)+1)));
    const deckItems=decks.filter(d=>!AnkiParity.isFilteredDeck(d)).sort((x,y)=>String(x.nome).localeCompare(String(y.nome),'pt-BR')).map(d=>({kind:'deck',value:d.nome,label:'📁 '+d.nome,count:cards.filter(c=>String(c.deckId)===String(d.id)).length}));
    const typeItems=types.slice().sort((x,y)=>String(x.name).localeCompare(String(y.name),'pt-BR')).map(t=>({kind:'notetype',value:t.name,label:'🧩 '+t.name,count:notes.filter(n=>String(n.notetypeId)===String(t.id)).length}));
    const tagItems=[...tags.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR')).slice(0,80).map(([t,n])=>({kind:'tag',value:t,label:'🏷 '+t,count:n}));
    const stateItems=[
      {kind:'query',value:'is:due',label:'Vencidos',count:cards.filter(c=>AnkiParity.filteredSearchMatches(c,'is:due')).length},
      {kind:'query',value:'is:new',label:'Novos',count:cards.filter(c=>AnkiParity.filteredSearchMatches(c,'is:new')).length},
      {kind:'suspended',value:'yes',label:'Suspensos',count:cards.filter(c=>c.suspenso).length},
      {kind:'marked',value:'1',label:'Marcados',count:notes.filter(n=>(n.tags||[]).some(t=>String(t).toLowerCase()==='marked')).length}
    ];
    const flagItems=[1,2,3,4,5,6,7].map(n=>({kind:'flag',value:String(n),label:'Bandeira '+n,count:cards.filter(c=>Number(c.flag)===n).length}));
    const savedItems=saved.map(x=>({kind:'saved',value:String(x.id),label:'★ '+x.name}));
    a.innerHTML='<div class="anki-browser-side-head"><strong>Sidebar</strong><button type="button" class="icon-btn" data-browser-filter="clear" title="Limpar filtros">×</button></div>'+
      (savedItems.length?this._sideSection('Buscas salvas',savedItems):'')+
      this._sideSection('Estados',stateItems)+this._sideSection('Baralhos',deckItems,false)+this._sideSection('Tipos de nota',typeItems,false)+this._sideSection('Etiquetas',tagItems,false)+this._sideSection('Bandeiras',flagItems,false);
  },
  _applyBrowserFilter(kind,value){
    const b=AnkiProductParity.browser;const set=(id,v,prop)=>{const el=document.getElementById(id);if(el){if(prop==='checked')el.checked=!!v;else el.value=v;}};
    if(kind==='saved'&&typeof AnkiTotalParity!=='undefined'){AnkiTotalParity._applySavedSearch(value);return;}
    if(kind==='clear'){Object.assign(b,{query:'',tag:'',flag:'',suspended:'all',marked:false,page:0});}
    else if(kind==='deck'){b.query='deck:"'+String(value).replace(/"/g,'\\\"')+'"';b.page=0;}
    else if(kind==='notetype'){b.query='note:"'+String(value).replace(/"/g,'\\\"')+'"';b.page=0;}
    else if(kind==='tag'){b.tag=value;b.page=0;}
    else if(kind==='flag'){b.flag=value;b.page=0;}
    else if(kind==='suspended'){b.suspended=value;b.page=0;}
    else if(kind==='marked'){b.marked=true;b.page=0;}
    else if(kind==='query'){b.query=value;b.page=0;}
    b.selected.clear();
    set('anki-browser-search',b.query);set('anki-browser-tag',b.tag);set('anki-browser-flag',b.flag);set('anki-browser-suspended',b.suspended);set('anki-browser-marked',b.marked,'checked');
    AnkiProductParity.renderBrowser();
  },

  /* ───────────────────── PREFERÊNCIAS ───────────────────── */
  _installPreferences(){
    const menu=document.getElementById('cards-more-menu');if(!menu)return;
    if(!document.getElementById('cards-preferences-btn')){
      const b=document.createElement('button');b.type='button';b.id='cards-preferences-btn';b.setAttribute('role','menuitem');b.textContent='⚙ Preferências dos Cards';b.onclick=()=>this.openPreferences();
      const advanced=menu.querySelector('.cards-more-group[data-group="advanced"]');if(advanced)advanced.appendChild(b);else menu.appendChild(b);
    }
  },
  openPreferences(){
    let m=document.getElementById('anki-cards-preferences');if(!m){
      const w=document.createElement('div');w.innerHTML='<div id="anki-cards-preferences" class="cards-modal" style="display:none"><div class="cards-modal-box cards-modal-lg"><div class="cards-modal-head"><div><h2>⚙ Preferências dos Cards</h2><p class="sub">Preferências por perfil para revisão, Browser e sincronização.</p></div><button class="icon-btn" id="anki-pref-close">✕</button></div><div class="cards-modal-body" id="anki-pref-body"></div><div class="cards-modal-foot"><button class="btn-secondary" id="anki-pref-algo">Opções avançadas / presets</button><button class="btn-secondary" id="anki-pref-sync">Sincronizar mídia agora</button><span style="flex:1"></span><button class="btn-primary" id="anki-pref-save">Salvar</button></div></div></div>';document.body.appendChild(w);m=document.getElementById('anki-cards-preferences');
      document.getElementById('anki-pref-close').onclick=()=>m.style.display='none';
      document.getElementById('anki-pref-algo').onclick=()=>{m.style.display='none';CardsScreen.openAlgoConfig();};
      document.getElementById('anki-pref-sync').onclick=()=>typeof AnkiTotalParity!=='undefined'&&AnkiTotalParity.syncMedia(true);
      document.getElementById('anki-pref-save').onclick=()=>this._savePreferences();
    }
    const c=CardsConfig.get(),bp=typeof AnkiMaxParity!=='undefined'?AnkiMaxParity._loadBrowserPrefs():null,b=AnkiProductParity.browser;
    document.getElementById('anki-pref-body').innerHTML=
      '<h3 class="anki-section-title">Revisão</h3><div class="field-group">'+
      this._prefSelect('pref-autoplay','Reproduzir áudio automaticamente',c.disableAutoplay?'0':'1')+
      this._prefSelect('pref-timer','Mostrar cronômetro',c.showTimer?'1':'0')+
      this._prefSelect('pref-stop-timer','Parar cronômetro ao responder',c.stopTimerOnAnswer?'1':'0')+
      this._prefSelect('pref-wait-audio','Aguardar áudio antes do auto-advance',c.waitForAudio?'1':'0')+
      '</div><div class="field-group">'+
      '<div class="field"><label>Tempo máximo de resposta (s)</label><input id="pref-cap-time" type="number" min="0" max="86400" value="'+Number(c.capAnswerTimeToSecs||0)+'"></div>'+
      '<div class="field"><label>Início do novo dia</label><input id="pref-rollover" type="number" min="0" max="23" value="'+Number(c.rolloverHour||0)+'"></div>'+
      '</div><h3 class="anki-section-title">Browser</h3><div class="field-group">'+
      '<div class="field"><label>Modo inicial</label><select id="pref-browser-mode"><option value="notes" '+(b.mode!=='cards'?'selected':'')+'>Notas</option><option value="cards" '+(b.mode==='cards'?'selected':'')+'>Cards</option></select></div>'+
      '<div class="field"><label>Ordenação</label><select id="pref-browser-dir"><option value="asc" '+(b.sortDir!=='desc'?'selected':'')+'>Crescente</option><option value="desc" '+(b.sortDir==='desc'?'selected':'')+'>Decrescente</option></select></div>'+
      '</div><p class="hint">Colunas e modo do Browser continuam persistidos automaticamente por perfil. Sync e backups usam a infraestrutura do Study.</p>';
    m.style.display='flex';
  },
  _prefSelect(id,label,value){return '<div class="field"><label>'+label+'</label><select id="'+id+'"><option value="1" '+(value==='1'?'selected':'')+'>Sim</option><option value="0" '+(value==='0'?'selected':'')+'>Não</option></select></div>';},
  _savePreferences(){
    const val=id=>String((document.getElementById(id)||{}).value||'');
    CardsConfig.set({
      disableAutoplay:val('pref-autoplay')!=='1',
      showTimer:val('pref-timer')==='1',
      stopTimerOnAnswer:val('pref-stop-timer')==='1',
      waitForAudio:val('pref-wait-audio')==='1',
      capAnswerTimeToSecs:Math.max(0,Number(val('pref-cap-time'))||0),
      rolloverHour:Math.max(0,Math.min(23,Number(val('pref-rollover'))||0))
    });
    if(typeof AnkiMaxParity!=='undefined'){
      AnkiProductParity.browser.mode=val('pref-browser-mode')==='cards'?'cards':'notes';
      AnkiProductParity.browser.sortDir=val('pref-browser-dir')==='desc'?'desc':'asc';
      AnkiMaxParity._saveBrowserPrefs();
    }
    CardEngine.invalidateDueCache();document.getElementById('anki-cards-preferences').style.display='none';showToast('Preferências salvas ✓');
  },

  /* ───────────────────── EXTENSION HOOKS ───────────────────── */
  _installHooks(){
    const api=window.AnkiStudyExtensions;if(!api)return;
    const wrap=(obj,name,before,after)=>{
      if(!obj||typeof obj[name]!=='function'||obj[name].__p10hook)return;const old=obj[name],self=this;
      function f(...args){api.emit(before,{target:obj,args});let out=old.apply(this,args);if(out&&typeof out.then==='function')return out.then(v=>{api.emit(after,{target:obj,args,result:v});return v;});api.emit(after,{target:obj,args,result:out});return out;}f.__p10hook=true;obj[name]=f;
    };
    wrap(CardsScreen,'answer','reviewer:answer:before','reviewer:answer:after');
    wrap(CardsScreen,'openImportModal','import:open:before','import:open:after');
    wrap(CardsScreen,'openExportModal','export:open:before','export:open:after');
    wrap(CardsScreen,'addDeck','deck:add:before','deck:add:after');
    wrap(AnkiProductParity,'openBrowser','browser:open:before','browser:open:after');
    wrap(AnkiProductParity,'openNoteEditor','editor:open:before','editor:open:after');
    wrap(AnkiProductParity,'reconcileNote','note:reconcile:before','note:reconcile:after');
    if(typeof AnkiTotalParity!=='undefined')wrap(AnkiTotalParity,'syncMedia','media:sync:before','media:sync:after');
  }
};
queueMicrotask(()=>AnkiPractical10.install());
