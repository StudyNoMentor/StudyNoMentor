/* ============================================================
   PARIDADE FINAL — AÇÕES CONFIGURÁVEIS + SHARED DECKS
   Camada aditiva: não substitui os atalhos canônicos do reviewer.
   Permite atalhos extras por perfil e traz o fluxo de baralhos
   compartilhados para dentro do Study até a etapa de importação.
   ============================================================ */
const AnkiFinalParity = {
  _installed:false,
  _customBindings:null,

  ACTIONS:[
    {id:'mark',label:'Marcar/desmarcar nota'},
    {id:'buryCard',label:'Enterrar card'},
    {id:'buryNote',label:'Enterrar nota'},
    {id:'suspendCard',label:'Suspender card'},
    {id:'suspendNote',label:'Suspender nota'},
    {id:'hint',label:'Mostrar dica'},
    {id:'allHints',label:'Mostrar todas as dicas'},
    {id:'media',label:'Repetir mídia'},
    {id:'tts',label:'Texto para voz'},
    {id:'recordVoice',label:'Gravar própria voz'},
    {id:'replayVoice',label:'Reproduzir própria voz'},
    {id:'previousInfo',label:'Informações do card anterior'},
    {id:'add',label:'Adicionar nota'},
    {id:'browse',label:'Abrir navegador'},
    {id:'stats',label:'Abrir estatísticas'},
    {id:'undo',label:'Desfazer revisão'},
    {id:'redo',label:'Refazer revisão'}
  ],

  install(){
    if(this._installed||typeof CardsScreen==='undefined'||typeof AnkiProductParity==='undefined'||typeof AnkiMaxParity==='undefined')return;
    this._installed=true;
    this._injectSharedDecks();
    this._installBindingsEntry();
    this._patchCustomBindings();
  },

  _bindingsKey(){
    try{return AnkiParity._entityKey('reviewer','custom-bindings-v1');}
    catch(_){
      try{return (DB._profilePrefix?DB._profilePrefix():'')+'anki-reviewer-custom-bindings-v1';}
      catch(__){return 'anki-reviewer-custom-bindings-v1';}
    }
  },
  _normalizeShortcut(raw){
    const src=String(raw||'').trim();
    if(!src)return '';
    const aliases={control:'Ctrl',ctrl:'Ctrl',cmd:'Meta',command:'Meta',meta:'Meta',option:'Alt',alt:'Alt',shift:'Shift',
      esc:'Escape',escape:'Escape',space:'Space',spacebar:'Space',del:'Delete',delete:'Delete',backspace:'Backspace',
      enter:'Enter',return:'Enter',left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',down:'ArrowDown'};
    const mods=new Set(),keys=[];
    src.split('+').map(x=>x.trim()).filter(Boolean).forEach(part=>{
      const low=part.toLowerCase(),a=aliases[low];
      if(a&&['Ctrl','Alt','Shift','Meta'].includes(a))mods.add(a);
      else if(a)keys.push(a);
      else if(/^key[a-z]$/i.test(part))keys.push(part.slice(3).toUpperCase());
      else if(/^digit[0-9]$/i.test(part))keys.push(part.slice(5));
      else if(part.length===1)keys.push(/[a-z]/i.test(part)?part.toUpperCase():part);
      else keys.push(part);
    });
    if(keys.length!==1)return '';
    return ['Ctrl','Alt','Shift','Meta'].filter(x=>mods.has(x)).concat(keys[0]).join('+');
  },
  _eventShortcut(e){
    if(!e)return '';
    let key='';
    if(e.code&&/^Key[A-Z]$/.test(e.code))key=e.code.slice(3);
    else if(e.code&&/^Digit[0-9]$/.test(e.code))key=e.code.slice(5);
    else if(e.code&&/^Numpad[0-9]$/.test(e.code))key=e.code;
    else if(['Space','Escape','Delete','Backspace','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code))key=e.code;
    else if(typeof e.key==='string'&&e.key.length===1)key=/[a-z]/i.test(e.key)?e.key.toUpperCase():e.key;
    else key=String(e.key||e.code||'');
    if(!key)return '';
    const symbol=/^[^A-Za-z0-9]$/.test(key);
    const mods=[];
    if(e.ctrlKey)mods.push('Ctrl');
    if(e.altKey)mods.push('Alt');
    if(e.shiftKey&&!symbol)mods.push('Shift');
    if(e.metaKey)mods.push('Meta');
    return mods.concat(key).join('+');
  },
  _readBindings(){
    if(this._customBindings)return this._customBindings;
    let raw={};try{raw=JSON.parse(localStorage.getItem(this._bindingsKey())||'{}')||{};}catch(_){}
    const out={};
    this.ACTIONS.forEach(a=>{const v=this._normalizeShortcut(raw[a.id]);if(v)out[a.id]=v;});
    this._customBindings=out;return out;
  },
  _saveBindings(map){
    const out={},used=new Map();
    for(const a of this.ACTIONS){
      const v=this._normalizeShortcut(map&&map[a.id]);
      if(!v)continue;
      if(used.has(v))throw new Error('O atalho '+v+' está repetido em '+used.get(v)+' e '+a.label+'.');
      used.set(v,a.label);out[a.id]=v;
    }
    localStorage.setItem(this._bindingsKey(),JSON.stringify(out));
    this._customBindings=out;return out;
  },
  _actionForEvent(e){
    const sig=this._eventShortcut(e),b=this._readBindings();
    return this.ACTIONS.find(a=>b[a.id]===sig)?.id||'';
  },
  _dispatchAction(action){
    const c=AnkiProductParity._currentReviewCard&&AnkiProductParity._currentReviewCard();
    if(!c&& !['undo','redo','browse','stats','add'].includes(action))return false;
    const nid=c?AnkiProductParity.noteId(c):null;
    if(action==='mark'){const on=AnkiMaxParity._toggleMarkedNote(nid);CardsScreen.renderReviewCard(document.getElementById('cards-content'));showToast(on?'★ Nota marcada':'Marcação removida');}
    else if(action==='buryCard')AnkiMaxParity.buryCard(c);
    else if(action==='buryNote')AnkiMaxParity.buryNote(c);
    else if(action==='suspendCard')AnkiMaxParity.suspendCard(c);
    else if(action==='suspendNote')AnkiMaxParity.suspendNote(c);
    else if(action==='hint')AnkiMaxParity.showHints(false);
    else if(action==='allHints')AnkiMaxParity.showHints(true);
    else if(action==='media')AnkiProductParity.replayMedia(c);
    else if(action==='tts')AnkiProductParity.speakCard(c);
    else if(action==='recordVoice')AnkiMaxParity.openVoiceRecorder();
    else if(action==='replayVoice')AnkiMaxParity.replayOwnVoice();
    else if(action==='previousInfo')AnkiMaxParity.previousCardInfo();
    else if(action==='add')CardsScreen.openCardModal();
    else if(action==='browse')AnkiProductParity.openBrowser();
    else if(action==='stats'){const t=document.querySelector('.cards-tab[data-ctab="stats"]');if(t)t.click();}
    else if(action==='undo')CardsScreen.undoAnswer();
    else if(action==='redo')CardsScreen.redoAnswer();
    else return false;
    return true;
  },
  _patchCustomBindings(){
    const old=CardsScreen.onKey.bind(CardsScreen);
    CardsScreen.onKey=(e)=>{
      if(AnkiMaxParity._reviewActive&&AnkiMaxParity._reviewActive(e)){
        const action=this._actionForEvent(e);
        if(action){e.preventDefault();e.stopPropagation&&e.stopPropagation();if(this._dispatchAction(action))return;}
      }
      return old(e);
    };
  },
  _installBindingsEntry(){
    const menu=document.getElementById('cards-more-menu');if(!menu||document.getElementById('cards-reviewer-bindings-btn'))return;
    const b=document.createElement('button');b.type='button';b.id='cards-reviewer-bindings-btn';b.setAttribute('role','menuitem');b.textContent='⌨ Atalhos personalizados';
    b.addEventListener('click',()=>{menu.classList.remove('open');this.openBindings();});
    const before=document.getElementById('cards-check-collection-btn');if(before&&before.parentNode===menu)menu.insertBefore(b,before);else menu.appendChild(b);
  },
  openBindings(){
    const current=this._readBindings();
    const fields=this.ACTIONS.map(a=>({key:a.id,label:a.label,type:'text',value:current[a.id]||'',placeholder:'Ex.: Ctrl+Shift+H'}));
    UI.prompt(fields,{title:'⌨ Atalhos personalizados do reviewer',okText:'Salvar'}).then(v=>{
      if(!v)return;
      try{
        const saved=this._saveBindings(v);
        const n=Object.keys(saved).length;
        showToast(n?n+' atalho(s) personalizado(s) salvo(s) ✓':'Atalhos personalizados limpos ✓');
      }catch(err){showToast(err&&err.message?err.message:String(err));}
    });
  },

  _injectSharedDecks(){
    if(document.getElementById('anki-shared-decks-modal'))return;
    const wrap=document.createElement('div');
    wrap.innerHTML='<div id="anki-shared-decks-modal" class="cards-modal anki-product-modal" style="display:none">'+
      '<div class="cards-modal-box" style="max-width:620px"><div class="cards-modal-head"><div><h2>🌐 Baralhos compartilhados</h2>'+
      '<p class="sub">Pesquise no catálogo público do AnkiWeb e importe o pacote baixado sem sair do fluxo de Cards.</p></div>'+
      '<button type="button" class="icon-btn" id="anki-shared-close">✕</button></div>'+
      '<div class="cards-modal-body"><div class="card" style="padding:16px"><strong>1. Encontrar baralho</strong>'+
      '<p class="hint">O catálogo continua no AnkiWeb; o Study não replica nem raspa o serviço externo.</p>'+
      '<button type="button" class="btn-primary" id="anki-shared-open-web">Abrir catálogo do AnkiWeb</button></div>'+
      '<div id="anki-shared-drop" class="card" style="padding:20px;margin-top:12px;text-align:center;border-style:dashed;cursor:pointer">'+
      '<strong>2. Importar o pacote</strong><p class="hint">Clique ou arraste um .apkg/.colpkg aqui. O arquivo segue pelo importador Anki completo do Study.</p>'+
      '<button type="button" class="btn-secondary" id="anki-shared-choose">Escolher pacote</button>'+
      '<input id="anki-shared-file" type="file" accept=".apkg,.colpkg" style="display:none"></div></div></div></div>';
    document.body.appendChild(wrap);
    const modal=document.getElementById('anki-shared-decks-modal'),inp=document.getElementById('anki-shared-file'),drop=document.getElementById('anki-shared-drop');
    document.getElementById('anki-shared-close').onclick=()=>{modal.style.display='none';};
    document.getElementById('anki-shared-open-web').onclick=()=>{
      const w=window.open('https://ankiweb.net/shared/decks/','_blank','noopener,noreferrer');
      if(!w)showToast('Permita abrir nova aba para acessar os baralhos compartilhados do AnkiWeb.');
    };
    document.getElementById('anki-shared-choose').onclick=e=>{e.stopPropagation();inp.click();};
    drop.addEventListener('click',e=>{if(e.target.id!=='anki-shared-choose')inp.click();});
    inp.addEventListener('change',()=>this._startSharedImport(inp.files&&inp.files[0]));
    ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('is-drag');}));
    ['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('is-drag');}));
    drop.addEventListener('drop',e=>this._startSharedImport(e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]));
    AnkiProductParity.openSharedDecks=()=>{inp.value='';modal.style.display='flex';};
  },
  _startSharedImport(file){
    if(!file)return false;
    const name=String(file.name||'').toLowerCase();
    if(!/\.(apkg|colpkg)$/.test(name)){showToast('Escolha um pacote Anki .apkg ou .colpkg.');return false;}
    const modal=document.getElementById('anki-shared-decks-modal');if(modal)modal.style.display='none';
    CardsScreen.openImportModal();
    Promise.resolve(CardsScreen.handleImportFile(file)).catch(err=>showToast('Falha ao ler pacote: '+(err&&err.message?err.message:String(err))));
    return true;
  }
};
queueMicrotask(()=>AnkiFinalParity.install());
