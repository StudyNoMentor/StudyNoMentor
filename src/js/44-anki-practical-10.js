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
    this._installReviewerMobileParity();
    this._installSimpleNoteTypeParity();
    this._installStatsCompleteness();
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
    const sc=CardsScreen._deckScope?CardsScreen._deckScope():{decks:DB.getDecks(),cards:DB.getCards()};
    const decks=sc.decks.slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR',{numeric:true,sensitivity:'base'}));
    const cards=sc.cards,mesmoPlano=(a,b)=>String(a._planId||'')===String(b._planId||'');
    return decks.map(d=>{
      const name=String(d.nome||''),parts=name.split('::'),prefix=name+'::';
      const direct=cards.filter(c=>String(c.deckId)===String(d.id)).length;
      const descendantIds=new Set(decks.filter(x=>mesmoPlano(x,d)&&String(x.nome||'').startsWith(prefix)).map(x=>String(x.id)));
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
        const planos=new Set(meta.map(x=>String(x.d._planId||''))).size;
        count.textContent=(AnkiParity.isFilteredDeck&&AnkiParity.isFilteredDeck(m.d)?'🔎 ':'')+(m.hasChildren?(m.direct+' direto · '+m.total+' total'):(m.direct+' card(s)'))+(planos>1&&m.d._planNome?' · '+m.d._planNome:'');
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
    const d=(CardsScreen._deckScope?CardsScreen._deckScope().decks:DB.getDecks()).find(x=>String(x.id)===String(id));if(!d)return;
    UI.prompt([{key:'name',label:'Nome do subbaralho',type:'text',value:'',placeholder:'Ex.: Capítulo 1'}],{title:'＋ Criar subbaralho',okText:'Criar'}).then(async v=>{
      const leaf=String(v&&v.name||'').trim();if(!leaf)return;
      if(leaf.includes('::')){showToast('Use apenas o nome do nível; a hierarquia é criada automaticamente.');return;}
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.createOfficialDeck!=='function'){showToast('DeckManager oficial indisponível.');return;}
      try{
        await CardsOfficialBridge.createOfficialDeck(String(d.nome)+'::'+leaf,d._planId);
        CardsScreen.renderDeckList();CardsScreen.render();showToast('Subbaralho criado pelo Anki oficial ✓');
      }catch(e){showToast('Não foi possível criar o subbaralho: '+(e&&e.message?e.message:String(e)));}
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
    const a=document.getElementById('anki-browser-sidebar');if(!a)return;
    const bridge=window.CardsOfficialBridge,facets=bridge&&bridge._officialBrowserFacets;
    if(!facets){
      a.innerHTML='<div class="anki-browser-side-head"><strong>Sidebar</strong></div><p class="hint">Consultando facetas do Anki oficial…</p>';
      if(bridge&&typeof bridge._loadOfficialBrowserFacets==='function')void bridge._loadOfficialBrowserFacets().then(()=>this._renderBrowserSidebar());
      return;
    }
    const saved=typeof AnkiTotalParity!=='undefined'?AnkiTotalParity._savedSearches():[],
      deckItems=(facets.decks||[]).slice().sort((x,y)=>String(x.name||'').localeCompare(String(y.name||''),'pt-BR')).map(d=>({kind:'deck',value:d.name,label:'📁 '+d.name})),
      typeItems=(facets.notetypes||[]).slice().sort((x,y)=>String(x.name||'').localeCompare(String(y.name||''),'pt-BR')).map(t=>({kind:'notetype',value:t.name,label:'🧩 '+t.name})),
      tagItems=(facets.tags||[]).slice().sort((a,b)=>String(a).localeCompare(String(b),'pt-BR')).slice(0,80).map(t=>({kind:'tag',value:t,label:'🏷 '+t})),
      stateItems=[
        {kind:'query',value:'is:due',label:'Vencidos'},{kind:'query',value:'is:new',label:'Novos'},
        {kind:'suspended',value:'yes',label:'Suspensos'},{kind:'marked',value:'1',label:'Marcados'}
      ],
      flagItems=[1,2,3,4,5,6,7].map(n=>({kind:'flag',value:String(n),label:'Bandeira '+n})),
      savedItems=saved.map(x=>({kind:'saved',value:String(x.id),label:'★ '+x.name}));
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
      const b=document.createElement('button');b.type='button';b.id='cards-preferences-btn';b.setAttribute('role','menuitem');b.textContent='⚙ Preferências dos Cards';b.onclick=()=>void this.openPreferences();
      const advanced=menu.querySelector('.cards-more-group[data-group="advanced"]');if(advanced)advanced.appendChild(b);else menu.appendChild(b);
    }
  },
  async openPreferences(){
    let m=document.getElementById('anki-cards-preferences');if(!m){
      const w=document.createElement('div');w.innerHTML='<div id="anki-cards-preferences" class="cards-modal" style="display:none"><div class="cards-modal-box cards-modal-lg"><div class="cards-modal-head"><div><h2>⚙ Preferências dos Cards</h2><p class="sub">Preferências globais da Collection oficial + aparência do Browser no Study.</p></div><button class="icon-btn" id="anki-pref-close">✕</button></div><div class="cards-modal-body" id="anki-pref-body"></div><div class="cards-modal-foot"><button class="btn-secondary" id="anki-pref-algo">Opções de baralho / presets</button><button class="btn-secondary" id="anki-pref-sync">Verificar mídia</button><span style="flex:1"></span><button class="btn-primary" id="anki-pref-save">Salvar</button></div></div></div>';document.body.appendChild(w);m=document.getElementById('anki-cards-preferences');
      document.getElementById('anki-pref-close').onclick=()=>m.style.display='none';
      document.getElementById('anki-pref-algo').onclick=()=>{m.style.display='none';CardsScreen.openAlgoConfig();};
      document.getElementById('anki-pref-sync').onclick=()=>{m.style.display='none';AnkiProductParity.openCheck();};
      document.getElementById('anki-pref-save').onclick=()=>void this._savePreferences();
    }
    const local=CardsConfig.get(),b=AnkiProductParity.browser;let rollover=Number(local.rolloverHour)||4,learnAhead=Math.max(0,Number(local.learnAheadMin==null?20:local.learnAheadMin));
    try{
      if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.getOfficialPreferences==='function'){
        const prefs=await CardsOfficialBridge.getOfficialPreferences(),s=prefs&&prefs.scheduling||{};
        if(Number.isFinite(Number(s.rollover)))rollover=Number(s.rollover);
        if(Number.isFinite(Number(s.learnAheadSecs)))learnAhead=Number(s.learnAheadSecs)/60;
        else if(Number.isFinite(Number(s.learn_ahead_secs)))learnAhead=Number(s.learn_ahead_secs)/60;
      }
    }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-preferences-load');}
    document.getElementById('anki-pref-body').innerHTML=
      '<h3 class="anki-section-title">Agendamento · Anki oficial</h3><div class="field-group">'+
      '<div class="field"><label>Início do novo dia</label><input id="pref-rollover" type="number" min="0" max="23" value="'+Math.round(rollover)+'"></div>'+
      '<div class="field"><label>Limite para aprender adiantado (min)</label><input id="pref-learn-ahead" type="number" min="0" max="1440" value="'+Math.round(learnAhead)+'"></div>'+
      '</div><p class="hint">Autoplay, cronômetro, Auto Advance e tempo máximo pertencem ao preset do baralho no Anki e ficam em <strong>Opções de baralho / presets</strong>.</p>'+
      '<h3 class="anki-section-title">Browser · casca Study</h3><div class="field-group">'+
      '<div class="field"><label>Modo inicial</label><select id="pref-browser-mode"><option value="notes" '+(b.mode!=='cards'?'selected':'')+'>Notas</option><option value="cards" '+(b.mode==='cards'?'selected':'')+'>Cards</option></select></div>'+
      '<div class="field"><label>Ordenação</label><select id="pref-browser-dir"><option value="asc" '+(b.sortDir!=='desc'?'selected':'')+'>Crescente</option><option value="desc" '+(b.sortDir==='desc'?'selected':'')+'>Decrescente</option></select></div>'+
      '</div><p class="hint">A mídia é centralizada no MediaManager oficial do Anki; não há cópia binária paralela no Study.</p>';
    m.style.display='flex';
  },
  _prefSelect(id,label,value){return '<div class="field"><label>'+label+'</label><select id="'+id+'"><option value="1" '+(value==='1'?'selected':'')+'>Sim</option><option value="0" '+(value==='0'?'selected':'')+'>Não</option></select></div>';},
  async _savePreferences(){
    const val=id=>String((document.getElementById(id)||{}).value||''),
      rollover=Math.max(0,Math.min(23,Number(val('pref-rollover'))||0)),
      learnAhead=Math.max(0,Math.min(1440,Number(val('pref-learn-ahead'))||0));
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.updateOfficialPreferences!=='function'){
      showToast('Preferences oficial do Anki indisponível.');return;
    }
    try{
      await CardsOfficialBridge.updateOfficialPreferences({scheduling:{rollover,learn_ahead_secs:Math.round(learnAhead*60)}});
      // Estes dois campos locais são apenas espelho para partes visuais ainda
      // carregadas antes do backend; a decisão de fila pertence à Collection.
      CardsConfig.set({rolloverHour:rollover,learnAheadMin:learnAhead});
      AnkiProductParity.browser.mode=val('pref-browser-mode')==='cards'?'cards':'notes';
      AnkiProductParity.browser.sortDir=val('pref-browser-dir')==='desc'?'desc':'asc';
      if(typeof AnkiMaxParity!=='undefined')AnkiMaxParity._saveBrowserPrefs();
      document.getElementById('anki-cards-preferences').style.display='none';
      showToast('Preferências salvas pela Collection oficial do Anki ✓');
    }catch(e){showToast('Preferências não salvas: '+(e&&e.message?e.message:String(e)));}
  }


  /* ───────────────── REVIEWER / MOBILE 10/10 ─────────────────
     Três ajustes de produto na camada final:
     1) mídia de templates Anki nunca é recortada no viewport;
     2) "Mais ações" abre a lista inteira em um toque;
     3) o criador simples expõe todos os tipos padrão do Anki. */
  _installReviewerMobileParity(){
    this._patchResponsiveCardFrames();
    this._installReviewerActionSheet();
  },
  _patchResponsiveCardFrames(){
    if(typeof AnkiRuntime==='undefined'||AnkiRuntime.__p10ResponsiveMedia)return;
    const oldBuild=AnkiRuntime.buildSrcdoc.bind(AnkiRuntime);
    AnkiRuntime.buildSrcdoc=(...args)=>{
      let doc=oldBuild(...args);
      const responsive='<style id="snm-responsive-media">'+
        'html,body{max-width:100%!important;min-width:0!important;box-sizing:border-box}'+
        'body{overflow-x:auto!important;overflow-y:hidden;overflow-wrap:anywhere;word-break:break-word}'+
        'img,video,svg{max-width:100%!important;height:auto!important;object-fit:contain}'+
        'canvas,iframe,object,embed{max-width:100%!important}'+
        'pre{max-width:100%!important;overflow-x:auto!important;white-space:pre-wrap}'+
        'mjx-container,.MathJax,.MathJax_Display{max-width:100%!important;overflow-x:auto!important;overflow-y:hidden}'+
        '</style>';
      if(!doc.includes('id="snm-responsive-media"'))doc=doc.replace('</head>',responsive+'</head>');
      return doc;
    };
    const oldFrame=AnkiRuntime.renderFrame.bind(AnkiRuntime);
    AnkiRuntime.renderFrame=(...args)=>{
      let frame=oldFrame(...args);
      frame=frame.replace(' scrolling="no"',' scrolling="auto"');
      frame=frame.replace('style="display:block;width:100%;min-height:',
        'style="display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box;min-height:');
      return frame;
    };
    AnkiRuntime.__p10ResponsiveMedia=true;
  },

  _installReviewerActionSheet(){
    if(typeof AnkiMaxParity==='undefined'||AnkiMaxParity.__p10DirectActions)return;
    this._ensureReviewerActionSheet();
    const open=()=>this.openReviewerActionSheet();
    AnkiProductParity.openReviewerActions=open;
    AnkiMaxParity.openReviewerActions=open;
    AnkiMaxParity.__p10DirectActions=true;
  },
  _ensureReviewerActionSheet(){
    let sheet=document.getElementById('anki-review-action-sheet');if(sheet)return sheet;
    const host=document.createElement('div');
    host.innerHTML='<div id="anki-review-action-sheet" class="anki-review-action-sheet" aria-hidden="true">'+
      '<button type="button" class="anki-review-action-scrim" aria-label="Fechar Mais ações"></button>'+
      '<section class="anki-review-action-panel" role="dialog" aria-modal="true" aria-labelledby="anki-review-action-title">'+
      '<div class="anki-review-action-head"><div><h2 id="anki-review-action-title">⋯ Mais ações</h2><p class="sub">Toque na ação — sem etapa intermediária.</p></div>'+
      '<button type="button" class="icon-btn anki-review-action-close" aria-label="Fechar">✕</button></div>'+
      '<div class="anki-review-flag-row" aria-label="Bandeira do card"></div>'+
      '<div class="anki-review-action-list"></div></section></div>';
    sheet=host.firstElementChild;document.body.appendChild(sheet);
    sheet.querySelector('.anki-review-action-scrim').addEventListener('click',()=>this.closeReviewerActionSheet());
    sheet.querySelector('.anki-review-action-close').addEventListener('click',()=>this.closeReviewerActionSheet());
    sheet.querySelector('.anki-review-action-list').addEventListener('click',e=>{
      const b=e.target.closest('[data-review-action]');if(!b)return;
      const action=b.dataset.reviewAction;this.closeReviewerActionSheet();this._runReviewerSheetAction(action);
    });
    sheet.querySelector('.anki-review-flag-row').addEventListener('click',e=>{
      const b=e.target.closest('[data-review-flag]');if(!b)return;
      const c=AnkiProductParity._currentReviewCard();if(!c)return;
      const n=Number(b.dataset.reviewFlag)||0;this.closeReviewerActionSheet();
      if(window.CardsOfficialBridge&&CardsOfficialBridge.review&&CardsOfficialBridge.review.card)void CardsOfficialBridge.action('flag',n);
      else showToast('Bandeira não alterada: Reviewer oficial indisponível.');
    });
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&sheet.classList.contains('open')){e.preventDefault();this.closeReviewerActionSheet();}
    });
    return sheet;
  },
  _reviewerSheetActions(){
    const out=[];
    if((CardsScreen._undoStack||[]).length)out.push({g:'Revisão',id:'undo',label:'↶ Desfazer última revisão'});
    if((CardsScreen._redoStack||[]).length)out.push({g:'Revisão',id:'redo',label:'↷ Refazer última revisão'});
    out.push(
      {g:'Card e nota',id:'mark',label:'★ Marcar/desmarcar nota'},
      {g:'Card e nota',id:'tags',label:'🏷 Editar etiquetas'},
      {g:'Card e nota',id:'info',label:'ℹ Informações do card'},
      {g:'Agendamento',id:'buryCard',label:'⤓ Enterrar card'},
      {g:'Agendamento',id:'buryNote',label:'⤓ Enterrar nota'},
      {g:'Agendamento',id:'suspendCard',label:'🚫 Suspender card'},
      {g:'Agendamento',id:'suspendNote',label:'🚫 Suspender nota'},
      {g:'Agendamento',id:'forget',label:'↺ Esquecer / tornar novo'},
      {g:'Agendamento',id:'due',label:'📅 Definir vencimento'},
      {g:'Conteúdo e mídia',id:'hint',label:'💡 Mostrar dica'},
      {g:'Conteúdo e mídia',id:'allHints',label:'💡 Mostrar todas as dicas'},
      {g:'Conteúdo e mídia',id:'media',label:'▶ Repetir mídia'},
      {g:'Conteúdo e mídia',id:'tts',label:'🎙 Texto para voz'},
      {g:'Conteúdo e mídia',id:'recordVoice',label:'🎤 Gravar própria voz'},
      {g:'Conteúdo e mídia',id:'replayVoice',label:'🔊 Reproduzir própria voz'},
      {g:'Conteúdo e mídia',id:'whiteboard',label:'✍ Quadro'},
      {g:'Navegação e edição',id:'infoPrev',label:'ℹ Informações do card anterior'},
      {g:'Navegação e edição',id:'add',label:'＋ Adicionar nota'},
      {g:'Navegação e edição',id:'browse',label:'🗃 Navegador'},
      {g:'Navegação e edição',id:'stats',label:'📊 Estatísticas'},
      {g:'Navegação e edição',id:'type',label:'🧩 Mudar tipo de nota'},
      {g:'Navegação e edição',id:'deck',label:'⚙ Opções de baralho'},
      {g:'Navegação e edição',id:'delete',label:'🗑 Excluir nota',danger:true}
    );
    return out;
  },
  openReviewerActionSheet(){
    const c=AnkiProductParity._currentReviewCard();if(!c)return;
    const sheet=this._ensureReviewerActionSheet(),list=sheet.querySelector('.anki-review-action-list');
    let group='';
    list.innerHTML=this._reviewerSheetActions().map(a=>{
      const head=a.g!==group?(group=a.g,'<div class="anki-review-action-group">'+this.esc(a.g)+'</div>'):'';
      return head+'<button type="button" class="anki-review-action-item '+(a.danger?'danger':'')+'" data-review-action="'+this.esc(a.id)+'">'+this.esc(a.label)+'</button>';
    }).join('');
    const flags=sheet.querySelector('.anki-review-flag-row');
    flags.innerHTML='<span>Bandeira</span>'+
      '<button type="button" data-review-flag="0" title="Sem bandeira" aria-label="Remover bandeira">×</button>'+
      [1,2,3,4,5,6,7].map(n=>'<button type="button" class="'+((c.flag||0)===n?'on':'')+'" data-review-flag="'+n+'" title="'+this.esc(DB.FLAGS[n].nome)+'" aria-label="'+this.esc(DB.FLAGS[n].nome)+'" style="--fl:'+this.esc(DB.FLAGS[n].cor)+'"></button>').join('');
    sheet.classList.add('open');sheet.setAttribute('aria-hidden','false');
    document.documentElement.classList.add('anki-review-sheet-open');
    requestAnimationFrame(()=>{const first=list.querySelector('[data-review-action]');if(first)first.focus({preventScroll:true});});
  },
  closeReviewerActionSheet(){
    const sheet=document.getElementById('anki-review-action-sheet');if(!sheet)return;
    sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true');document.documentElement.classList.remove('anki-review-sheet-open');
  },
  _runReviewerSheetAction(a){
    const c=AnkiProductParity._currentReviewCard();if(!c&& !['undo','redo','add','browse','stats'].includes(a))return;
    const nid=c?AnkiProductParity.noteId(c):null;
    if(a==='undo')CardsScreen.undoAnswer();
    else if(a==='redo')CardsScreen.redoAnswer();
    else if(a==='mark'){if(window.CardsOfficialBridge)void CardsOfficialBridge.mark();else showToast('Anki oficial indisponível.');}
    else if(a==='tags'){if(window.CardsOfficialBridge)AnkiProductParity.editTags(['n:'+nid]);else showToast('Anki oficial indisponível.');}
    else if(a==='info')document.getElementById('cards-act-info')?.click();
    else if(a==='buryCard')AnkiMaxParity.buryCard(c);
    else if(a==='buryNote')AnkiMaxParity.buryNote(c);
    else if(a==='suspendCard')AnkiMaxParity.suspendCard(c);
    else if(a==='suspendNote')AnkiMaxParity.suspendNote(c);
    else if(a==='forget')document.getElementById('cards-act-forget')?.click();
    else if(a==='due')document.getElementById('cards-act-due')?.click();
    else if(a==='hint')AnkiMaxParity.showHints(false);
    else if(a==='allHints')AnkiMaxParity.showHints(true);
    else if(a==='media'){if(window.CardsOfficialBridge)void CardsOfficialBridge.replayCurrentAv();else showToast('Mídia oficial indisponível.');}
    else if(a==='tts'){if(window.CardsOfficialBridge)void CardsOfficialBridge.speakCurrentTts();else showToast('TTS oficial indisponível.');}
    else if(a==='recordVoice')AnkiMaxParity.openVoiceRecorder();
    else if(a==='replayVoice')AnkiMaxParity.replayOwnVoice();
    else if(a==='whiteboard')AnkiProductParity.openWhiteboard();
    else if(a==='infoPrev')AnkiMaxParity.previousCardInfo();
    else if(a==='add')CardsScreen.openCardModal();
    else if(a==='browse')AnkiProductParity.openBrowser();
    else if(a==='stats'){const t=document.querySelector('.cards-tab[data-ctab="stats"]');if(t)t.click();}
    else if(a==='type'){const n=AnkiParity.noteForCard?AnkiParity.noteForCard(c):null;AnkiProductParity.openChangeType([n||('n:'+nid)]);}
    else if(a==='deck')CardsScreen.openAlgoConfigFor(c.deckId||null);
    else if(a==='delete'){if(window.CardsOfficialBridge)void CardsOfficialBridge.deleteCurrentNote();else showToast('Anki oficial indisponível.');}
  },

  /* ───────────────── TIPOS DE NOTA PADRÃO DO ANKI ───────────────── */
  _installSimpleNoteTypeParity(){
    if(this._simpleNoteTypesInstalled)return;this._simpleNoteTypesInstalled=true;
    this._ensureSimpleNoteTypes();this._injectSimpleTypeFields();

    const oldApply=CardsScreen.applyKindUI.bind(CardsScreen);
    CardsScreen.applyKindUI=()=>{this._ensureSimpleNoteTypes();oldApply();this._applySimpleNoteTypeUI();};

    const oldOpen=CardsScreen.openCardModal.bind(CardsScreen);
    CardsScreen.openCardModal=(id)=>{
      let card=null,note=null,nt=null,kind=null;
      this._simpleEditCanonical=null;
      if(id){
        card=DB.getCard(id);note=card&&(AnkiParity.noteForCard?AnkiParity.noteForCard(card):AnkiParity.getNote(AnkiProductParity.noteId(card)));
        nt=note&&(AnkiParity.notetypeForCard?AnkiParity.notetypeForCard(card,note):AnkiParity.getNotetype(note.notetypeId));kind=nt&&nt.stockKind;
        /* O formulário simples só sabe gravar os tipos stock Basic/Cloze.
           Tipos invertidos, typing, image occlusion e tipos importados/custom
           editam diretamente os CAMPOS da Note canônica. */
        const simples=kind==='basic'||kind==='cloze';
        if(note&&nt&&(!simples||['basic_reversed','basic_optional_reversed','typing','image_occlusion'].includes(kind))){
          if(kind==='image_occlusion'&&typeof AnkiImageOcclusion!=='undefined')AnkiImageOcclusion.openEditor(note,card.deckId||null);
          else AnkiProductParity.openNoteEditor(note);
          return;
        }
      }
      this._ensureSimpleNoteTypes();this._injectSimpleTypeFields();
      const out=oldOpen(id);
      /* O cache card.frente/verso pode ser HTML já renderizado pelo template
         (especialmente depois de "Mudar tipo") ou uma cópia antiga. Ao editar
         Basic/Cloze stock, a fonte de verdade é a Note. */
      if(id&&note&&nt&&(kind==='basic'||kind==='cloze')){
        const front=document.getElementById('card-frente'),back=document.getElementById('card-verso'),sel=document.getElementById('card-kind');
        if(kind==='cloze'){
          if(front)front.innerHTML=String(note.fields&&note.fields.Text||'');
          if(back)back.innerHTML='';
          if(sel)sel.value='cloze';
          this._simpleEditCanonical={noteId:note.id,planId:note._planId||CardsScreen._editingPlanId||null,kind,backExtra:String(note.fields&&note.fields['Back Extra']||'')};
        }else{
          if(front)front.innerHTML=String(note.fields&&note.fields.Front||'');
          if(back)back.innerHTML=String(note.fields&&note.fields.Back||'');
          if(sel)sel.value='basic';
          this._simpleEditCanonical={noteId:note.id,planId:note._planId||CardsScreen._editingPlanId||null,kind,backExtra:''};
        }
      }
      this._applySimpleNoteTypeUI();return out;
    };

    const oldSave=CardsScreen.saveCard.bind(CardsScreen);
    CardsScreen.saveCard=(closeAfter)=>{
      const sel=document.getElementById('card-kind'),kind=sel&&sel.value;
      if(kind==='image_occlusion'){void this._launchSimpleImageOcclusion();return;}
      this._simpleEditCanonical=null;
      return oldSave(closeAfter);
    };

    const sel=document.getElementById('card-kind');
    if(sel&&!sel.dataset.ankiParityKinds){sel.dataset.ankiParityKinds='1';sel.addEventListener('change',()=>CardsScreen.applyKindUI());}
  },
  _ensureSimpleNoteTypes(){
    const sel=document.getElementById('card-kind');if(!sel)return;
    const value=sel.value||'basic';
    const defs=[
      ['basic','Básico (frente e verso)'],
      ['basic_reversed','Básico (e cartão invertido)'],
      ['basic_optional_reversed','Básico (cartão invertido opcional)'],
      ['typing','Básico (digitar a resposta)'],
      ['cloze','Cloze — omissão de palavras {{ }}'],
      ['image_occlusion','Oclusão de imagem']
    ];
    const label=sel.closest('.field')&&sel.closest('.field').querySelector('label[for="card-kind"]');if(label)label.textContent='Tipo de nota';
    const sig=defs.map(x=>x[0]).join('|');
    if(sel.dataset.ankiKindsSig!==sig){
      sel.innerHTML=defs.map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('');
      sel.dataset.ankiKindsSig=sig;
    }
    if(defs.some(x=>x[0]===value))sel.value=value;
  },
  _injectSimpleTypeFields(){
    const verso=document.getElementById('card-verso-field');if(!verso)return;
    if(!document.getElementById('card-add-reverse-field')){
      const f=document.createElement('div');f.id='card-add-reverse-field';f.className='field anki-simple-extra-field';f.style.display='none';
      f.innerHTML='<label class="anki-simple-check"><input type="checkbox" id="card-add-reverse"> <span>Adicionar cartão invertido</span></label>'+
        '<p class="hint">Equivale ao campo “Add Reverse” do tipo padrão opcional do Anki.</p>';
      verso.insertAdjacentElement('afterend',f);
    }
    if(!document.getElementById('card-image-occlusion-field')){
      const f=document.createElement('div');f.id='card-image-occlusion-field';f.className='anki-simple-io-launch';f.style.display='none';
      f.innerHTML='<strong>Oclusão de imagem</strong><p class="hint">Selecione a imagem e desenhe as máscaras no editor dedicado.</p>'+
        '<button type="button" class="btn-primary" id="card-image-occlusion-open">Abrir editor de oclusão</button>';
      document.getElementById('card-add-reverse-field').insertAdjacentElement('afterend',f);
      document.getElementById('card-image-occlusion-open').addEventListener('click',()=>this._launchSimpleImageOcclusion());
    }
  },
  _applySimpleNoteTypeUI(){
    const sel=document.getElementById('card-kind');if(!sel)return;this._injectSimpleTypeFields();
    const kind=sel.value,isCloze=kind==='cloze',isIO=kind==='image_occlusion';
    const front=document.getElementById('card-frente'),frontField=front&&front.closest('.field'),verso=document.getElementById('card-verso-field');
    const opt=document.getElementById('card-add-reverse-field'),io=document.getElementById('card-image-occlusion-field'),hint=document.getElementById('card-kind-hint');
    if(frontField)frontField.style.display=isIO?'none':'block';
    if(verso)verso.style.display=(isCloze||isIO)?'none':'block';
    if(opt)opt.style.display=kind==='basic_optional_reversed'?'block':'none';
    if(io)io.style.display=isIO?'block':'none';
    const clozeBtn=document.getElementById('card-cloze-btn');if(clozeBtn)clozeBtn.style.display=isCloze?'inline-block':'none';
    if(hint){
      if(kind==='basic_reversed')hint.innerHTML='Gera <strong>2 cards</strong> da mesma nota: frente→verso e verso→frente.';
      else if(kind==='basic_optional_reversed')hint.innerHTML='O segundo card só é criado quando <strong>Adicionar cartão invertido</strong> estiver marcado.';
      else if(kind==='typing')hint.innerHTML='Na revisão, você <strong>digita a resposta</strong> antes de comparar com o verso.';
      else if(kind==='image_occlusion')hint.innerHTML='Crie máscaras diretamente sobre uma imagem, como no tipo padrão <strong>Image Occlusion</strong> do Anki.';
    }
    const another=document.getElementById('card-save-another'),close=document.getElementById('card-save-close');
    if(close)close.style.display=isIO?'none':'';
    if(another)another.style.display=isIO?'none':(CardsScreen._editingId?'none':'inline-block');
  },
  async _simpleDestination(){
    const el=document.getElementById('card-destino');let dest=String(el&&el.value||''),planId=CardsScreen._editingPlanId||null;
    if(!dest){showToast('Escolha o baralho');return null;}
    if(dest.startsWith('novo:')){
      const nome=String(dest.slice(5)||'').trim();
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.createOfficialDeck!=='function'){showToast('DeckManager oficial indisponível.');return null;}
      const created=await CardsOfficialBridge.createOfficialDeck(nome,planId);
      if(!created||!created.deck){showToast('O Anki oficial não devolveu o baralho criado.');return null;}
      dest='deck:'+created.deck.id;planId=created.deck._planId!=null?created.deck._planId:planId;if(el)el.value=dest;
    }
    const deckId=dest.startsWith('deck:')?dest.slice(5):null;
    if(deckId&&window.StudyGlobalScope&&StudyGlobalScope.deckRecord){
      const r=StudyGlobalScope.deckRecord(deckId);if(r)planId=r.planId;
    }
    if(!planId)planId=(window.StudyGlobalScope&&StudyGlobalScope.activePlanId)?StudyGlobalScope.activePlanId():PlanManager.getActivePlanId();
    return {raw:dest,deckId,materia:dest.startsWith('sub:')?dest.slice(4):null,planId};
  },
  _saveCanonicalSimpleType(kind,closeAfter){
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.saveSimpleCard!=='function'){showToast('Card não salvo: Anki oficial indisponível.');return false;}
    return CardsOfficialBridge.saveSimpleCard(closeAfter);
  },

  async _launchSimpleImageOcclusion(){
    if(typeof AnkiImageOcclusion==='undefined'||typeof AnkiImageOcclusion.openEditor!=='function'){showToast('Editor de Oclusão de Imagem indisponível');return false;}
    const dst=await this._simpleDestination();if(!dst)return false;
    if(!dst.deckId){showToast('Escolha um baralho para criar a Oclusão de Imagem');return false;}
    CardsScreen.closeCardModal();AnkiImageOcclusion.openEditor(null,dst.deckId);return true;
  },

  /* ───────────────────── STATS COMPLETAS ───────────────────── */
  _histBars(values,bins,labels){
    const out=Array.from({length:labels.length},()=>0);
    values.forEach(raw=>{const v=Number(raw);if(!Number.isFinite(v))return;let i=0;while(i<bins.length&&v>=bins[i])i++;out[Math.min(i,out.length-1)]++;});
    const max=Math.max(1,...out);return '<div class="anki-p10-hist">'+out.map((n,i)=>'<div title="'+this.esc(labels[i])+': '+n+'"><i style="height:'+Math.max(n?4:0,Math.round(n/max*100))+'%"></i><span>'+this.esc(labels[i])+'</span></div>').join('')+'</div>';
  },
  /* Intervalos, recuperabilidade, botões de resposta e True Retention já estão
     na página única de estatísticas (CardsScreen.renderStats); anexar outra
     cópia aqui duplicava os painéis. */
  _installStatsCompleteness(){},

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
    if(typeof AnkiTotalParity!=='undefined')wrap(AnkiTotalParity,'syncMedia','media:sync:before','media:sync:after');
  }
};
queueMicrotask(()=>AnkiPractical10.install());
