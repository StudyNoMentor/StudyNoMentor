/* ============================================================
   ANKI — BARALHOS COMPARTILHADOS
   ------------------------------------------------------------
   O catálogo permanece no AnkiWeb oficial. Esta camada só abre o
   catálogo e entrega o .apkg/.colpkg escolhido ao importador oficial
   já conectado à Collection do backend.
   ============================================================ */
const AnkiFinalParity = {
  _installed:false,

  install(){
    if(this._installed||typeof CardsScreen==='undefined'||typeof AnkiProductParity==='undefined')return;
    this._installed=true;
    this._injectSharedDecks();
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
      '<strong>2. Importar o pacote</strong><p class="hint">Clique ou arraste um .apkg/.colpkg aqui. O arquivo segue pelo importador oficial do Anki.</p>'+
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
window.AnkiFinalParity=AnkiFinalParity;
queueMicrotask(()=>AnkiFinalParity.install());
