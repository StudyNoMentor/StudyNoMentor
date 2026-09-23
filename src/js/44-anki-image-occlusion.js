/* ============================================================
   IMAGE OCCLUSION / CRIAÇÃO AVANÇADA — formato oficial Anki
   ============================================================ */
const AnkiImageOcclusion = {
  state:{noteId:null,deckId:null,imageData:'',img:null,shapes:[],tool:'rect',drawing:null,polygon:[],occludeInactive:false,groupMode:'each',groupOrdinal:1},

  isType(nt){return !!nt&&(Number(nt.originalStockKind)===6||nt.stockKind==='image_occlusion');},
  stockDef(){
    const q='{{#Header}}<div>{{Header}}</div>{{/Header}}\n<div style="display:none">{{cloze:Occlusion}}</div>\n<div id="err"></div>\n<div id="image-occlusion-container">\n{{Image}}\n<canvas id="image-occlusion-canvas"></canvas>\n</div>\n<script>try { anki.imageOcclusion.setup(); } catch (exc) { document.getElementById("err").innerHTML = "Error loading image occlusion.<br><br>" + exc; }<\/script>';
    return {
      stockKind:'image_occlusion',originalStockKind:6,name:'Image Occlusion',kind:'cloze',
      css:'#image-occlusion-canvas{--inactive-shape-color:#ffeba2;--active-shape-color:#ff8e8e;--inactive-shape-border:1px #212121;--active-shape-border:1px #212121;--highlight-shape-color:#ff8e8e00;--highlight-shape-border:1px #ff8e8e}.card{font-family:arial;font-size:20px;text-align:center;color:black;background-color:white}',
      fields:[
        {name:'Occlusion',tag:0,preventDeletion:true},{name:'Image',tag:1,preventDeletion:true},
        {name:'Header',tag:2,preventDeletion:true},{name:'Back Extra',tag:3,preventDeletion:true},{name:'Comments',tag:4,preventDeletion:false}
      ],
      templates:[{name:'Image Occlusion',qfmt:q,afmt:q+'\n<div><button id="toggle">Toggle Masks</button></div>\n{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}'}]
    };
  },

  install(){
    if(this._installed||typeof AnkiParity==='undefined'||typeof AnkiProductParity==='undefined')return;
    this._installed=true;
    this._patchStock();
    this._patchRenderer();
    this._injectUi();
    this._installMenu();
    this._protectIoType();
  },

  _patchStock(){
    const orig=AnkiParity._stockNotetypeDef.bind(AnkiParity);
    AnkiParity._stockNotetypeDef=function(kind){if(kind==='image_occlusion')return AnkiImageOcclusion.stockDef();return orig(kind);};
  },

  _patchRenderer(){
    const orig=AnkiParity.renderTemplate.bind(AnkiParity);
    AnkiParity.renderTemplate=function(nt,note,ord,side,card,frontSide){
      if(AnkiImageOcclusion.isType(nt))return AnkiImageOcclusion.render(nt,note,side,card);
      return orig(nt,note,ord,side,card,frontSide);
    };
  },

  _fieldByTag(nt,note,tag,fallback){
    const f=(nt.fields||[]).find(x=>Number(x.tag)===Number(tag))||(nt.fields||[])[fallback];return f?String((note.fields||{})[f.name]||''):'';
  },

  _splitProps(raw){
    const out=[];let part='',esc=false;
    for(const ch of String(raw||'')){if(esc){part+=ch;esc=false;continue;}if(ch==='\\'){esc=true;part+=ch;continue;}if(ch===':'){out.push(part);part='';}else part+=ch;}
    out.push(part);return out;
  },
  _unescape(v){return String(v||'').replace(/\\:/g,':').replace(/\\\\/g,'\\');},
  parse(text){
    const out=[],re=/\{\{c([\d,]+)::image-occlusion:([^}]+)\}\}/g;let m;
    while((m=re.exec(String(text||'')))){
      const ords=m[1].split(',').map(Number).filter(n=>Number.isInteger(n)),parts=this._splitProps(m[2]),type=parts.shift(),props={};
      parts.forEach(p=>{const i=p.indexOf('=');if(i>0)props[p.slice(0,i)]=this._unescape(p.slice(i+1));});
      out.push({type,ordinals:ords,ordinal:ords.find(n=>n>0)||0,oi:String(props.oi||'')==='1',props});
    }
    return out;
  },
  _num(v){const n=Number(v);return Number.isFinite(n)?n:0;},
  _pct(v){const n=this._num(v);return Math.abs(n)<=1?((n*100)+'%'):(n+'px');},
  _polygon(v){return String(v||'').trim().split(/\s+/).map(p=>{const [x,y]=p.split(',').map(Number);return (Number.isFinite(x)?x*100:0)+'% '+(Number.isFinite(y)?y*100:0)+'%';}).join(',');},

  render(nt,note,side,card){
    const occ=this._fieldByTag(nt,note,0,0),image=this._fieldByTag(nt,note,1,1),header=this._fieldByTag(nt,note,2,2),back=this._fieldByTag(nt,note,3,3);
    const active=Number(card&&card.clozeOrd)||((Number(card&&card.ankiTemplateOrd)||0)+1),shapes=this.parse(occ),answer=side==='answer';
    const shapeHtml=shapes.map((s,i)=>{
      if(s.type==='text'){
        const left=this._pct(s.props.left),top=this._pct(s.props.top),txt=AnkiParity._escAttr(s.props.text||'');
        return '<div class="snm-io-text" style="left:'+left+';top:'+top+'">'+txt+'</div>';
      }
      const isActive=s.ordinals.includes(active),show=!answer?(isActive||s.oi):(isActive||s.oi);
      if(!show)return '';
      const cls=isActive?(answer?'snm-io-mask snm-io-highlight':'snm-io-mask snm-io-active'):'snm-io-mask snm-io-inactive';
      if(s.type==='polygon')return '<div class="'+cls+'" data-io-mask style="clip-path:polygon('+this._polygon(s.props.points)+');left:0;top:0;width:100%;height:100%"></div>';
      const left=this._pct(s.props.left),top=this._pct(s.props.top),w=this._pct(s.props.width),h=this._pct(s.props.height),radius=s.type==='ellipse'?'50%':'4px';
      return '<div class="'+cls+'" data-io-mask style="left:'+left+';top:'+top+';width:'+w+';height:'+h+';border-radius:'+radius+'"></div>';
    }).join('');
    const toggle=answer?'<button type="button" class="snm-io-toggle" onclick="document.querySelectorAll(\'[data-io-mask]\').forEach(x=>x.classList.toggle(\'snm-io-hidden\'))">Mostrar/ocultar máscaras</button>':'';
    return (header?'<div class="snm-io-header">'+header+'</div>':'')+
      '<div class="snm-io-stage">'+image+shapeHtml+'</div>'+toggle+(answer&&back?'<div class="snm-io-back">'+back+'</div>':'')+
      '<style>.snm-io-stage{position:relative;display:inline-block;max-width:100%}.snm-io-stage img{display:block;max-width:100%;height:auto}.snm-io-mask,.snm-io-text{position:absolute;box-sizing:border-box;z-index:4}.snm-io-active{background:#ff8e8e;border:1px solid #212121}.snm-io-inactive{background:#ffeba2;border:1px solid #212121}.snm-io-highlight{background:rgba(255,142,142,.05);border:2px solid #ff5f5f}.snm-io-hidden{display:none!important}.snm-io-text{transform:translate(-0%,-0%);color:#111;background:rgba(255,255,255,.7);padding:1px 3px}.snm-io-toggle{margin-top:10px}.snm-io-back{margin-top:12px}</style>';
  },

  _injectUi(){
    if(document.getElementById('anki-advanced-add-modal'))return;
    const host=document.createElement('div');host.innerHTML=`
      <div id="anki-advanced-add-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box cards-modal-lg">
          <div class="cards-modal-head"><div><h2>＋ Adicionar nota avançada</h2><p class="sub">O “Criar card” atual continua igual; esta tela expõe todos os tipos de nota.</p></div><button class="icon-btn" data-io-close="anki-advanced-add-modal">✕</button></div>
          <div class="cards-modal-body">
            <div class="field-group"><div class="field"><label>Tipo de nota</label><select id="anki-advanced-type"></select></div><div class="field"><label>Baralho</label><select id="anki-advanced-deck"></select></div></div>
            <div id="anki-advanced-fields"></div>
            <div class="field"><label>Tags</label><input id="anki-advanced-tags" type="text" placeholder="tag1 tag2::subtag"></div>
          </div>
          <div class="cards-modal-foot"><button class="btn-secondary" data-io-close="anki-advanced-add-modal">Cancelar</button><button class="btn-primary" id="anki-advanced-save">Adicionar nota</button></div>
        </div>
      </div>
      <div id="anki-io-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box anki-io-box">
          <div class="cards-modal-head"><div><h2>🖼 Oclusão de imagem</h2><p class="sub">Máscaras salvas no formato oficial <code>image-occlusion</code> do Anki.</p></div><button class="icon-btn" data-io-close="anki-io-modal">✕</button></div>
          <div class="cards-modal-body">
            <div class="field-group"><div class="field"><label>Baralho</label><select id="anki-io-deck"></select></div><div class="field"><label>Imagem</label><input id="anki-io-file" type="file" accept="image/*"><p class="hint">Arquivo ou imagem colada da área de transferência (Ctrl/⌘+V).</p></div></div>
            <div class="anki-io-toolbar">
              <button class="btn-secondary io-tool active" data-tool="rect">▭ Retângulo</button>
              <button class="btn-secondary io-tool" data-tool="ellipse">◯ Elipse</button>
              <button class="btn-secondary io-tool" data-tool="polygon">⬡ Polígono</button>
              <button class="btn-secondary io-tool" data-tool="text">T Texto</button>
              <button class="btn-secondary" id="anki-io-finish-poly" disabled>Fechar polígono</button>
              <button class="btn-secondary" id="anki-io-undo">↶ Última</button>
              <button class="btn-secondary" id="anki-io-clear">Limpar máscaras</button>
            </div>
            <div class="anki-io-options">
              <label class="check-label"><input id="anki-io-occlude-inactive" type="checkbox"> Ocultar também as máscaras inativas</label>
              <label>Novas máscaras <select id="anki-io-group-mode"><option value="each">cada uma gera um card</option><option value="same">mesmo card/grupo</option></select></label>
              <button class="btn-secondary" id="anki-io-new-group">Novo grupo</button>
            </div>
            <div class="anki-io-stage-editor"><canvas id="anki-io-canvas"></canvas><p id="anki-io-empty" class="hint">Escolha uma imagem e desenhe as máscaras.</p></div>
            <div id="anki-io-mask-list" class="anki-io-mask-list"></div>
            <div class="field-group"><div class="field"><label>Cabeçalho</label><textarea id="anki-io-header" rows="2"></textarea></div><div class="field"><label>Verso extra</label><textarea id="anki-io-back" rows="2"></textarea></div></div>
            <div class="field-group"><div class="field"><label>Comentários</label><textarea id="anki-io-comments" rows="2"></textarea></div><div class="field"><label>Tags</label><input id="anki-io-tags" type="text"></div></div>
          </div>
          <div class="cards-modal-foot"><span id="anki-io-count" class="hint"></span><span style="flex:1"></span><button class="btn-secondary" data-io-close="anki-io-modal">Cancelar</button><button class="btn-primary" id="anki-io-save">Salvar oclusões</button></div>
        </div>
      </div>
    `;document.body.appendChild(host);
    document.querySelectorAll('[data-io-close]').forEach(b=>b.addEventListener('click',()=>{const m=document.getElementById(b.dataset.ioClose);if(m)m.style.display='none';}));
    this._bindAdvanced();this._bindEditor();
  },

  _installMenu(){
    const menu=document.getElementById('cards-more-menu');if(!menu||document.getElementById('cards-advanced-add-btn'))return;
    const b=document.createElement('button');b.type='button';b.id='cards-advanced-add-btn';b.setAttribute('role','menuitem');b.textContent='＋ Adicionar nota avançada';
    b.addEventListener('click',()=>{menu.classList.remove('open');this.openAdvancedAdd();});
    const browser=document.getElementById('cards-browser-btn');if(browser)menu.insertBefore(b,browser);else menu.prepend(b);
  },

  _allTypes(){
    ['basic','basic_reversed','basic_optional_reversed','typing','cloze','image_occlusion'].forEach(k=>AnkiParity.stockNotetype(k));
    return AnkiParity.noteTypes();
  },
  _normalDecks(planId){return (planId&&DB.getDecksForPlan?DB.getDecksForPlan(planId):DB.getDecks()).filter(d=>!AnkiParity.isFilteredDeck(d));},
  _deckOptions(sel,planId){
    const decks=this._normalDecks(planId);
    if(!decks.length)return '<option value="__default__" selected>📁 Padrão</option>';
    return decks.map(d=>'<option value="'+escapeHtml(String(d.id))+'" '+(String(sel||'')===String(d.id)?'selected':'')+'>'+escapeHtml(d.nome)+'</option>').join('');
  },
  _resolveDeck(value,planId){
    if(value&&value!=='__default__')return String(value);
    const first=this._normalDecks(planId)[0];if(first)return String(first.id);
    const created=planId&&DB.addDeckForPlan?DB.addDeckForPlan(planId,'Padrão'):DB.addDeck('Padrão');
    return created&&created.id!=null?String(created.id):null;
  },

  openAdvancedAdd(){
    const types=this._allTypes(),ts=document.getElementById('anki-advanced-type'),ds=document.getElementById('anki-advanced-deck');
    ts.innerHTML=types.map(t=>'<option value="'+escapeHtml(String(t.id))+'">'+escapeHtml(t.name)+'</option>').join('');
    ds.innerHTML=this._deckOptions((this._normalDecks()[0]||{}).id);document.getElementById('anki-advanced-tags').value='';
    ts.onchange=()=>this._renderAdvancedFields();this._renderAdvancedFields();document.getElementById('anki-advanced-add-modal').style.display='flex';
  },
  _renderAdvancedFields(){
    const nt=AnkiParity.getNotetype(document.getElementById('anki-advanced-type').value),box=document.getElementById('anki-advanced-fields');if(!nt)return;
    if(this.isType(nt)){box.innerHTML='<div class="card" style="padding:12px"><strong>Oclusão de imagem</strong><p class="hint">Use o editor de máscaras para gerar cards independentes a partir da imagem.</p><button type="button" class="btn-primary" id="anki-advanced-open-io">Abrir editor de máscaras</button></div>';document.getElementById('anki-advanced-save').style.display='none';document.getElementById('anki-advanced-open-io').onclick=()=>{document.getElementById('anki-advanced-add-modal').style.display='none';this.openEditor(null,document.getElementById('anki-advanced-deck').value);};return;}
    document.getElementById('anki-advanced-save').style.display='';
    box.innerHTML=(nt.fields||[]).map(f=>'<div class="field"><label>'+escapeHtml(f.name)+'</label><textarea class="anki-advanced-field anki-code-area" data-field="'+escapeHtml(f.name)+'" rows="3"></textarea></div>').join('');
  },
  _bindAdvanced(){
    document.getElementById('anki-advanced-save').addEventListener('click',()=>{
      const nt=AnkiParity.getNotetype(document.getElementById('anki-advanced-type').value);if(!nt)return;const fields={};
      document.querySelectorAll('.anki-advanced-field').forEach(x=>fields[x.dataset.field]=x.value);
      if(nt.kind==='cloze'&&!Object.values(fields).some(v=>/\{\{c\d+(?:,\d+)*::/.test(String(v||'')))){showToast('Adicione ao menos uma omissão Cloze, como {{c1::texto}}.');return;}
      const deck=this._resolveDeck(document.getElementById('anki-advanced-deck').value);
      if(!deck){showToast('Não foi possível preparar o baralho Padrão.');return;}
      const id=AnkiParity._allocId(),note=AnkiParity.saveNote({id,ankiId:id,guid:'snm-'+Number(id).toString(36),notetypeId:nt.id,fields,tags:String(document.getElementById('anki-advanced-tags').value||'').split(/\s+/).filter(Boolean)});
      AnkiProductParity.reconcileNote(note,nt);AnkiProductParity._cardsForNote(note.id).forEach(c=>DB.updateCard(c.id,{deckId:deck}));
      document.getElementById('anki-advanced-add-modal').style.display='none';CardsScreen.render();showToast('Nota adicionada · '+AnkiProductParity._cardsForNote(note.id).length+' card(s) ✓');
    });
  },

  openEditor(noteId,deckId){
    const existing=noteId?AnkiParity.getNote(noteId):null;
    let planId=existing&&existing._planId||null;
    if(!planId&&deckId&&window.StudyGlobalScope&&StudyGlobalScope.deckRecord){const r=StudyGlobalScope.deckRecord(deckId);if(r)planId=r.planId;}
    const nt=(existing&&AnkiProductParity._typeFor(existing))||AnkiParity.stockNotetype('image_occlusion',planId);
    this.state={noteId:noteId?String(noteId):null,planId:planId||null,deckId:deckId||null,imageData:'',img:null,shapes:[],tool:'rect',drawing:null,polygon:[],occludeInactive:false,groupMode:'each',groupOrdinal:1};
    document.getElementById('anki-io-deck').innerHTML=this._deckOptions(deckId||(this._normalDecks(planId)[0]||{}).id,planId);
    document.getElementById('anki-io-header').value='';document.getElementById('anki-io-back').value='';document.getElementById('anki-io-comments').value='';document.getElementById('anki-io-tags').value='';document.getElementById('anki-io-file').value='';
    if(noteId){
      const note=AnkiParity.getNote(noteId),type=AnkiProductParity._typeFor(note)||nt;if(note){
        const occ=this._fieldByTag(type,note,0,0),image=this._fieldByTag(type,note,1,1);this.state.shapes=this.parse(occ).map(s=>this._shapeFromParsed(s));this.state.occludeInactive=this.state.shapes.some(s=>s.oi);
        document.getElementById('anki-io-header').value=this._fieldByTag(type,note,2,2);document.getElementById('anki-io-back').value=this._fieldByTag(type,note,3,3);document.getElementById('anki-io-comments').value=this._fieldByTag(type,note,4,4);document.getElementById('anki-io-tags').value=(note.tags||[]).join(' ');
        const cards=AnkiProductParity._cardsForNote(noteId),d=cards.find(c=>c.deckId);if(d)this.state.deckId=d.deckId;
        document.getElementById('anki-io-deck').innerHTML=this._deckOptions(this.state.deckId,this.state.planId);
        const m=/\bsrc=["']([^"']+)["']/i.exec(image);if(m)this._loadImageSrc(m[1]);
      }
    }
    document.getElementById('anki-io-occlude-inactive').checked=this.state.occludeInactive;document.getElementById('anki-io-group-mode').value=this.state.groupMode;
    document.getElementById('anki-io-modal').style.display='flex';this._selectTool('rect');this._renderEditor();
  },
  _shapeFromParsed(s){
    const p=s.props||{},base={type:s.type,ordinal:s.ordinal||0,oi:!!s.oi};
    if(s.type==='polygon')return {...base,points:String(p.points||'').trim().split(/\s+/).map(x=>{const a=x.split(',').map(Number);return{x:a[0]||0,y:a[1]||0};})};
    return {...base,left:this._num(p.left),top:this._num(p.top),width:this._num(p.width),height:this._num(p.height),text:p.text||''};
  },

  _bindEditor(){
    const file=document.getElementById('anki-io-file');file.addEventListener('change',()=>{const f=file.files&&file.files[0];if(f)this._loadImageFile(f);});
    const modal=document.getElementById('anki-io-modal');
    modal.addEventListener('paste',e=>{
      const dt=e.clipboardData;if(!dt)return;let img=null;
      for(const item of [...(dt.items||[])]){if(String(item.type||'').startsWith('image/')){img=item.getAsFile();break;}}
      if(!img)img=[...(dt.files||[])].find(x=>String(x.type||'').startsWith('image/'))||null;
      if(!img)return;e.preventDefault();this._loadImageFile(img);showToast('Imagem colada ✓');
    });
    document.querySelectorAll('.io-tool').forEach(b=>b.addEventListener('click',()=>this._selectTool(b.dataset.tool)));
    document.getElementById('anki-io-occlude-inactive').addEventListener('change',e=>{this.state.occludeInactive=e.target.checked;this.state.shapes.forEach(s=>s.oi=this.state.occludeInactive);this._renderEditor();});
    document.getElementById('anki-io-group-mode').addEventListener('change',e=>{this.state.groupMode=e.target.value;});
    document.getElementById('anki-io-new-group').addEventListener('click',()=>{this.state.groupOrdinal=this._nextOrdinal();showToast('Novo grupo: card '+this.state.groupOrdinal);});
    document.getElementById('anki-io-undo').addEventListener('click',()=>{this.state.shapes.pop();this._renderEditor();});
    document.getElementById('anki-io-clear').addEventListener('click',()=>{this.state.shapes=[];this.state.polygon=[];this._renderEditor();});
    document.getElementById('anki-io-finish-poly').addEventListener('click',()=>this._finishPolygon());
    document.getElementById('anki-io-save').addEventListener('click',()=>this.save());
    document.getElementById('anki-io-mask-list').addEventListener('click',e=>{const b=e.target.closest('[data-io-del]');if(!b)return;this.state.shapes.splice(Number(b.dataset.ioDel),1);this._renderEditor();});
    const c=document.getElementById('anki-io-canvas');
    c.addEventListener('pointerdown',e=>this._pointerDown(e));c.addEventListener('pointermove',e=>this._pointerMove(e));c.addEventListener('pointerup',e=>this._pointerUp(e));c.addEventListener('pointercancel',()=>{this.state.drawing=null;});
  },
  _selectTool(tool){this.state.tool=tool;document.querySelectorAll('.io-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));document.getElementById('anki-io-finish-poly').disabled=tool!=='polygon'||this.state.polygon.length<3;},
  _loadImageFile(file){
    if(!file||!String(file.type||'').startsWith('image/'))return false;
    const r=new FileReader();r.onload=()=>this._loadImageSrc(String(r.result||''));r.readAsDataURL(file);return true;
  },
  _loadImageSrc(src){this.state.imageData=src;const img=new Image();img.onload=()=>{this.state.img=img;this._renderEditor();};img.src=src;},
  _canvasPoint(e){const c=document.getElementById('anki-io-canvas'),r=c.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};},
  _ordinalForNew(){if(this.state.tool==='text')return 0;if(this.state.groupMode==='same')return Math.max(1,this.state.groupOrdinal||1);return this._nextOrdinal();},
  _nextOrdinal(){return Math.max(0,...this.state.shapes.map(s=>Number(s.ordinal)||0))+1;},
  _pointerDown(e){
    if(!this.state.img)return;const p=this._canvasPoint(e);
    if(this.state.tool==='polygon'){this.state.polygon.push(p);document.getElementById('anki-io-finish-poly').disabled=this.state.polygon.length<3;this._renderEditor();return;}
    if(this.state.tool==='text'){UI.prompt([{key:'txt',label:'Texto',type:'text',value:''}],{title:'Texto sobre a imagem',okText:'Adicionar'}).then(v=>{if(v&&v.txt){this.state.shapes.push({type:'text',ordinal:0,oi:false,left:p.x,top:p.y,width:.1,height:.05,text:v.txt});this._renderEditor();}});return;}
    this.state.drawing={type:this.state.tool,start:p,end:p,ordinal:this._ordinalForNew(),oi:this.state.occludeInactive};e.currentTarget.setPointerCapture&&e.currentTarget.setPointerCapture(e.pointerId);this._renderEditor();
  },
  _pointerMove(e){if(!this.state.drawing)return;this.state.drawing.end=this._canvasPoint(e);this._renderEditor();},
  _pointerUp(e){
    const d=this.state.drawing;if(!d)return;d.end=this._canvasPoint(e);const l=Math.min(d.start.x,d.end.x),t=Math.min(d.start.y,d.end.y),w=Math.abs(d.end.x-d.start.x),h=Math.abs(d.end.y-d.start.y);this.state.drawing=null;
    if(w>.01&&h>.01)this.state.shapes.push({type:d.type,ordinal:d.ordinal,oi:d.oi,left:l,top:t,width:w,height:h});this._renderEditor();
  },
  _finishPolygon(){if(this.state.polygon.length<3)return;this.state.shapes.push({type:'polygon',ordinal:this._ordinalForNew(),oi:this.state.occludeInactive,points:this.state.polygon.slice()});this.state.polygon=[];document.getElementById('anki-io-finish-poly').disabled=true;this._renderEditor();},
  _drawShape(ctx,s,w,h,preview){
    ctx.save();const active=preview?'rgba(78,136,255,.35)':(s.ordinal===0?'rgba(255,255,255,.7)':'rgba(255,142,142,.58)');ctx.fillStyle=active;ctx.strokeStyle=s.ordinal===0?'#333':'#b22';ctx.lineWidth=Math.max(1,w/500);
    if(s.type==='rect'||s.type==='ellipse'){const x=s.left*w,y=s.top*h,ww=s.width*w,hh=s.height*h;ctx.beginPath();if(s.type==='ellipse')ctx.ellipse(x+ww/2,y+hh/2,ww/2,hh/2,0,0,Math.PI*2);else ctx.rect(x,y,ww,hh);ctx.fill();ctx.stroke();}
    else if(s.type==='polygon'&&s.points&&s.points.length){ctx.beginPath();s.points.forEach((p,i)=>(i?ctx.lineTo(p.x*w,p.y*h):ctx.moveTo(p.x*w,p.y*h)));ctx.closePath();ctx.fill();ctx.stroke();}
    else if(s.type==='text'){ctx.fillStyle='#111';ctx.font=Math.max(12,w/35)+'px sans-serif';ctx.fillText(s.text||'',s.left*w,s.top*h);}
    ctx.restore();
  },
  _renderEditor(){
    const c=document.getElementById('anki-io-canvas'),empty=document.getElementById('anki-io-empty'),img=this.state.img;if(!c)return;
    if(!img){c.width=900;c.height=460;c.style.width='100%';c.style.height='320px';c.getContext('2d').clearRect(0,0,c.width,c.height);empty.style.display='block';return;}
    empty.style.display='none';const maxW=1000,scale=Math.min(1,maxW/img.naturalWidth),w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));c.width=w;c.height=h;c.style.width='100%';c.style.height='auto';const ctx=c.getContext('2d');ctx.clearRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
    this.state.shapes.forEach(s=>this._drawShape(ctx,s,w,h,false));if(this.state.drawing){const d=this.state.drawing,l=Math.min(d.start.x,d.end.x),t=Math.min(d.start.y,d.end.y),ww=Math.abs(d.end.x-d.start.x),hh=Math.abs(d.end.y-d.start.y);this._drawShape(ctx,{type:d.type,left:l,top:t,width:ww,height:hh,ordinal:d.ordinal},w,h,true);}
    if(this.state.polygon.length){this._drawShape(ctx,{type:'polygon',points:this.state.polygon,ordinal:1},w,h,true);}
    const count=this.state.shapes.filter(s=>s.ordinal>0).length,ords=new Set(this.state.shapes.filter(s=>s.ordinal>0).map(s=>s.ordinal));document.getElementById('anki-io-count').textContent=count+' máscara(s) · '+ords.size+' card(s)';
    document.getElementById('anki-io-mask-list').innerHTML=this.state.shapes.map((s,i)=>'<div><span>'+escapeHtml(s.type)+' · '+(s.ordinal?'card '+s.ordinal:'anotação')+'</span><button class="icon-btn danger" data-io-del="'+i+'">×</button></div>').join('');
  },
  _fmt(n){return (Math.round(Number(n)*10000)/10000).toString().replace(/^0\./,'.');},
  _escProp(v){return String(v||'').replace(/\\/g,'\\\\').replace(/:/g,'\\:');},
  serializeShape(s){
    const oi=s.oi?':oi=1':'';
    if(s.type==='polygon')return '{{c'+s.ordinal+'::image-occlusion:polygon:points='+s.points.map(p=>this._fmt(p.x)+','+this._fmt(p.y)).join(' ')+oi+'}}<br>';
    if(s.type==='text')return '{{c0::image-occlusion:text:left='+this._fmt(s.left)+':top='+this._fmt(s.top)+':text='+this._escProp(s.text)+oi+'}}<br>';
    let data='left='+this._fmt(s.left)+':top='+this._fmt(s.top)+':width='+this._fmt(s.width)+':height='+this._fmt(s.height);
    if(s.type==='ellipse')data+=':rx='+this._fmt(s.width/2)+':ry='+this._fmt(s.height/2);
    return '{{c'+s.ordinal+'::image-occlusion:'+s.type+':'+data+oi+'}}<br>';
  },
  serialize(){return this.state.shapes.map(s=>this.serializeShape(s)).join('');},

  save(){
    if(!this.state.imageData){showToast('Escolha uma imagem');return;}if(!this.state.shapes.some(s=>Number(s.ordinal)>0)){showToast('Desenhe ao menos uma máscara');return;}
    const oldNote=this.state.noteId?AnkiParity.getNote(this.state.noteId):null,
      nt=(oldNote&&AnkiProductParity._typeFor(oldNote))||AnkiParity.stockNotetype('image_occlusion',this.state.planId),
      byTag=(tag,fallback)=>(nt.fields||[]).find(f=>Number(f.tag)===tag)||(nt.fields||[])[fallback],fields={};
    fields[byTag(0,0).name]=this.serialize();fields[byTag(1,1).name]='<img src="'+AnkiParity._escAttr(this.state.imageData)+'">';fields[byTag(2,2).name]=document.getElementById('anki-io-header').value;fields[byTag(3,3).name]=document.getElementById('anki-io-back').value;fields[byTag(4,4).name]=document.getElementById('anki-io-comments').value;
    const tags=String(document.getElementById('anki-io-tags').value||'').split(/\s+/).filter(Boolean),deck=this._resolveDeck(document.getElementById('anki-io-deck').value,this.state.planId);let note;
    if(!deck){showToast('Não foi possível preparar o baralho Padrão.');return;}
    if(this.state.noteId){note=AnkiParity.saveNote(Object.assign({},oldNote,{notetypeId:nt.id,fields,tags}));}
    else{const id=AnkiParity._allocId();note=AnkiParity.saveNote({id,ankiId:id,guid:'snm-io-'+Number(id).toString(36),notetypeId:nt.id,fields,tags,_planId:this.state.planId||undefined});}
    AnkiProductParity.reconcileNote(note,nt);AnkiProductParity._cardsForNote(note.id).forEach(c=>DB.updateCard(c.id,{deckId:deck}));document.getElementById('anki-io-modal').style.display='none';CardsScreen.render();showToast('Oclusão salva · '+AnkiProductParity._cardsForNote(note.id).filter(c=>AnkiParity._fieldNonempty(c.frente)).length+' card(s) ✓');
  },

  _protectIoType(){
    const oldEdit=AnkiProductParity.openNoteEditor.bind(AnkiProductParity);AnkiProductParity.openNoteEditor=(id)=>{const note=AnkiParity.getNote(id),nt=AnkiProductParity._typeFor(note);if(this.isType(nt)){this.openEditor(id,(AnkiProductParity._cardsForNote(id).find(c=>c.deckId)||{}).deckId);return;}oldEdit(id);};
    const oldNt=AnkiProductParity.openNotetypeEditor.bind(AnkiProductParity);AnkiProductParity.openNotetypeEditor=(id)=>{oldNt(id);const nt=AnkiParity.getNotetype(id);if(!this.isType(nt))return;requestAnimationFrame(()=>{const rows=[...document.querySelectorAll('#anki-nt-fields .anki-field-row')];(nt.fields||[]).forEach((f,i)=>{if(f.preventDeletion&&rows[i]){const b=rows[i].querySelector('[data-remove]');if(b){b.disabled=true;b.title='Campo estrutural do Image Occlusion';}}});});};
  }
};
queueMicrotask(()=>AnkiImageOcclusion.install());
