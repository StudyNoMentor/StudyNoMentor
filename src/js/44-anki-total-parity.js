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
  _mediaSyncAt:new Map(),
  MEDIA_SYNC_MIN_MS:5*60*1000,
  _customSchedulingErrorShown:false,

  install(){
    if(this._installed||typeof AnkiProductParity==='undefined'||typeof AnkiParity==='undefined')return;
    this._installed=true;
    this._installExtensions();
    this._installBrowserPowerTools();
    this._installGlobalUndo();
    this._installStatsParity();
    this._installDeepCheck();
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
  _findDuplicates(){
    const names=[...new Set(AnkiParity.noteTypes().flatMap(t=>(t.fields||[]).map(f=>String(f.name||'')).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    if(!names.length){showToast('Nenhum campo disponível');return;}
    UI.prompt([{key:'field',label:'Campo',type:'select',value:names[0],options:names.map(n=>({value:n,label:n}))}],
      {title:'≡ Encontrar duplicatas · Anki oficial',okText:'Localizar'}).then(async v=>{
        if(!v)return;
        if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.findOfficialDuplicates!=='function'){showToast('Busca de duplicatas oficial indisponível.');return;}
        try{
          const out=await CardsOfficialBridge.findOfficialDuplicates(v.field,String(AnkiProductParity.browser&&AnkiProductParity.browser.query||'')),
            ids=(out.groups||[]).flatMap(g=>g.note_ids||[]).map(String);
          this._duplicateIds=new Set(ids);AnkiProductParity.browser.page=0;AnkiProductParity.browser.selected.clear();AnkiProductParity.renderBrowser();this._syncDuplicateButton();
          showToast(ids.length?ids.length+' nota(s) em grupos duplicados · Anki oficial ✓':'Nenhuma duplicata encontrada pelo Anki oficial');
        }catch(e){showToast('Busca de duplicatas falhou: '+(e&&e.message?e.message:String(e)));}
      });
  },
  _clearDuplicates(){this._duplicateIds=null;AnkiProductParity.browser.page=0;AnkiProductParity.browser.selected.clear();AnkiProductParity.renderBrowser();this._syncDuplicateButton();},
  _syncDuplicateButton(){
    const b=document.getElementById('anki-browser-clear-duplicates');if(b)b.style.display=this._duplicateIds&&this._duplicateIds.size?'':'none';
  },

  /* ───────────────── UNDO/REDO TRANSVERSAL ─────────────────
     A casca não fotografa nem restaura Cards/Revlog. O histórico pertence à
     Collection oficial e os botões abaixo chamam Collection.undo()/redo(). */
  checkpoint(){},
  async undoGlobal(){
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.undoCollectionOfficial!=='function'){showToast('Undo oficial indisponível.');return false;}
    try{await CardsOfficialBridge.undoCollectionOfficial();showToast('↶ Desfeito pelo Anki oficial ✓');await this._syncUndoButtons();return true;}
    catch(e){showToast('Nada para desfazer no Anki: '+(e&&e.message?e.message:String(e)));await this._syncUndoButtons();return false;}
  },
  async redoGlobal(){
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.redoCollectionOfficial!=='function'){showToast('Redo oficial indisponível.');return false;}
    try{await CardsOfficialBridge.redoCollectionOfficial();showToast('↷ Refeito pelo Anki oficial ✓');await this._syncUndoButtons();return true;}
    catch(e){showToast('Nada para refazer no Anki: '+(e&&e.message?e.message:String(e)));await this._syncUndoButtons();return false;}
  },
  async _syncUndoButtons(){
    const u=document.getElementById('anki-browser-global-undo'),r=document.getElementById('anki-browser-global-redo');
    if(!u&&!r)return;
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.historyStatus!=='function'){if(u)u.disabled=true;if(r)r.disabled=true;return;}
    try{
      const status=await CardsOfficialBridge.historyStatus();
      if(u){u.disabled=!status.undo;u.title=status.undo?'Desfazer: '+status.undo:'Nada para desfazer';}
      if(r){r.disabled=!status.redo;r.title=status.redo?'Refazer: '+status.redo:'Nada para refazer';}
    }catch(_){if(u)u.disabled=true;if(r)r.disabled=true;}
  },
  _wrapCheckpoint(){},
  _installGlobalUndo(){void this._syncUndoButtons();},

  /* Cards adicionados, contagem, tempo, facilidade, estabilidade e dificuldade
     já fazem parte da página única de estatísticas (CardsScreen.renderStats).
     Este módulo anexava cópias próprias — a tela repetia os mesmos gráficos. */
  _installStatsParity(){},

  /* ───────────────── CHECK COLLECTION ─────────────────
     Diagnóstico/reparo acadêmico local removido. A tela principal usa
     Collection.fix_integrity() por CardsOfficialBridge. */
  deepIssues(){return {officialOnly:true};},
  _installDeepCheck(){},

  /* ───────────────── MÍDIA CANÔNICA ─────────────────
     A mídia vive no MediaManager da Collection oficial. Não existe mais
     espelho binário IndexedDB/Supabase nem sincronização paralela no Study. */
  async syncMedia(show){
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.checkOfficialMedia!=='function'){
      if(show)showToast('MediaManager oficial do Anki indisponível.');
      return false;
    }
    if(show)AnkiProductParity.openCheck();
    return true;
  },
  _installMediaSync(){},

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
  /* ── CÓDIGO DE TERCEIROS NÃO RODA NA ORIGEM DO APP ──────────────────────
     Extensões locais e Custom Scheduling chegavam por chaves do perfil —
     sincronizadas pelo banco e importáveis por backup JSON — e eram
     executadas com new Function no MESMO contexto da sessão do Supabase.
     Isso é execução arbitrária com acesso ao token. A execução fica
     desligada; o código continua guardado (para exportar/copiar) e a API de
     hooks segue disponível para o código do próprio app. */
  EXECUCAO_DE_CODIGO_DESATIVADA:true,
  _loadUserExtensions(){
    const api=window.AnkiStudyExtensions;if(!api)return;
    const ativas=this._extensionSources().filter(x=>x.enabled);
    if(ativas.length)console.warn('Extensões locais não são executadas por segurança:',ativas.map(x=>x.name||x.id).join(', '));
  },
  openExtensions(){
    let m=document.getElementById('anki-extensions-modal');if(!m){const d=document.createElement('div');d.innerHTML='<div id="anki-extensions-modal" class="cards-modal" style="display:none"><div class="cards-modal-box cards-modal-lg"><div class="cards-modal-head"><div><h2>🧩 Extensões dos Cards</h2><p class="sub">API de hooks do Study. Extensões locais executam código escolhido por você; mantenha desativado o que não conhece.</p></div><button class="icon-btn" id="anki-ext-close">✕</button></div><div class="cards-modal-body"><div id="anki-ext-list"></div><input id="anki-ext-file" type="file" accept=".js,text/javascript" hidden></div><div class="cards-modal-foot"><button class="btn-secondary" id="anki-ext-import">Importar .js</button><span style="flex:1"></span><button class="btn-primary" id="anki-ext-done">Fechar</button></div></div></div>';document.body.appendChild(d);m=document.getElementById('anki-extensions-modal');document.getElementById('anki-ext-close').onclick=document.getElementById('anki-ext-done').onclick=()=>m.style.display='none';document.getElementById('anki-ext-import').onclick=()=>document.getElementById('anki-ext-file').click();document.getElementById('anki-ext-file').onchange=e=>this._importExtensionFile(e.target.files&&e.target.files[0]);}
    this._renderExtensions();m.style.display='flex';
  },
  _renderExtensions(){
    const box=document.getElementById('anki-ext-list');if(!box)return;const rows=this._extensionSources();box.innerHTML='<div class="anki-ext-row built"><strong>StudyNoMentor Anki Parity</strong><span>Integrada · ativa</span></div><p class="hint">🔒 Por segurança, extensões importadas não são executadas: o código rodaria com acesso à sua sessão e aos seus dados. Elas ficam guardadas apenas como referência.</p>'+rows.map(x=>'<div class="anki-ext-row"><label><input type="checkbox" data-ext-toggle="'+this.esc(x.id)+'" '+(x.enabled?'checked':'')+'> <strong>'+this.esc(x.name||x.id)+'</strong></label><button class="icon-btn danger" data-ext-del="'+this.esc(x.id)+'">×</button></div>').join('')+(rows.length?'':'<p class="hint">Nenhuma extensão local importada.</p>');
    box.querySelectorAll('[data-ext-toggle]').forEach(cb=>cb.onchange=()=>{const xs=this._extensionSources(),x=xs.find(y=>String(y.id)===String(cb.dataset.extToggle));if(x){x.enabled=cb.checked;this._saveExtensionSources(xs);showToast('Extensões locais não são executadas por segurança.');}});
    box.querySelectorAll('[data-ext-del]').forEach(b=>b.onclick=()=>{this._saveExtensionSources(this._extensionSources().filter(x=>String(x.id)!==String(b.dataset.extDel)));this._renderExtensions();});
  },
  _importExtensionFile(file){
    if(!file)return;const r=new FileReader();r.onload=()=>{const src=String(r.result||''),id='user-'+Date.now().toString(36),rows=this._extensionSources();rows.push({id,name:file.name.replace(/\.js$/i,''),source:src,enabled:false});this._saveExtensionSources(rows);this._renderExtensions();showToast('Extensão guardada — extensões locais não são executadas por segurança');};r.readAsText(file);
  },

  /* Custom Scheduling local removido. Quando exposto no Study, o código é
     persistido/executado exclusivamente pelo card_state_customizer oficial do Anki. */

  _installMenu(){
    const menu=document.getElementById('cards-more-menu');if(!menu)return;
    const add=(id,label,fn)=>{if(document.getElementById(id))return;const b=document.createElement('button');b.type='button';b.id=id;b.setAttribute('role','menuitem');b.textContent=label;b.onclick=()=>{menu.classList.remove('open');fn();};menu.appendChild(b);};
    add('cards-extensions-btn','🧩 Extensões dos Cards',()=>this.openExtensions());
    this._loadUserExtensions();
  }
};
queueMicrotask(()=>AnkiTotalParity.install());
