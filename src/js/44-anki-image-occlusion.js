/* ============================================================
   IMAGE OCCLUSION / CRIAÇÃO AVANÇADA — formato oficial Anki
   ============================================================ */
const AnkiImageOcclusion = {
  state:{noteId:null,deckId:null,imageData:'',img:null,shapes:[],tool:'rect',drawing:null,polygon:[],occludeInactive:false,groupMode:'each',groupOrdinal:1},

  isType(nt){return !!nt&&(Number(nt.originalStockKind)===6||nt.stockKind==='image_occlusion');},
  install(){
    if(this._installed||typeof AnkiParity==='undefined'||typeof AnkiProductParity==='undefined')return;
    this._installed=true;
    this._injectUi();
    this._installMenu();
    this._protectIoType();
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
    b.addEventListener('click',()=>{menu.classList.remove('open');void this.openAdvancedAdd();});
    const browser=document.getElementById('cards-browser-btn');if(browser)menu.insertBefore(b,browser);else menu.prepend(b);
  },

  async _allTypes(planId){
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.ensureOfficialStandardNotetypes!=='function')
      throw new Error('Tipos de nota oficiais indisponíveis.');
    await CardsOfficialBridge.ensureOfficialStandardNotetypes(planId);
    return AnkiParity.noteTypes(planId==null?undefined:planId);
  },
  _normalDecks(planId){
    let decks;
    if(planId&&DB.getDecksForPlan)decks=DB.getDecksForPlan(planId);
    else if(window.StudyGlobalScope&&StudyGlobalScope.cardsScope&&StudyGlobalScope.cardsScope()==='all'&&StudyGlobalScope.decks)decks=StudyGlobalScope.decks('all');
    else decks=DB.getDecks();
    return (decks||[]).filter(d=>!AnkiParity.isFilteredDeck(d));
  },
  _deckOptions(sel,planId){
    const decks=this._normalDecks(planId);
    if(!decks.length)return '<option value="__default__" selected>📁 Padrão</option>';
    return decks.map(d=>'<option value="'+escapeHtml(String(d.id))+'" '+(String(sel||'')===String(d.id)?'selected':'')+'>'+escapeHtml(String(d.nome||'Baralho')+(d._planNome?' · '+d._planNome:''))+'</option>').join('');
  },
  async _resolveDeck(value,planId){
    if(value&&value!=='__default__')return String(value);
    const first=this._normalDecks(planId)[0];if(first)return String(first.id);
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.createOfficialDeck!=='function')throw new Error('Baralho oficial indisponível.');
    const created=await CardsOfficialBridge.createOfficialDeck('Padrão',planId);
    return created&&created.deck&&created.deck.id!=null?String(created.deck.id):null;
  },

  async openAdvancedAdd(){
    try{
      const planId=(window.StudyGlobalScope&&StudyGlobalScope.activePlanId)?StudyGlobalScope.activePlanId():PlanManager.getActivePlanId(),
        types=await this._allTypes(planId),ts=document.getElementById('anki-advanced-type'),ds=document.getElementById('anki-advanced-deck');
      ts.innerHTML=types.map(t=>'<option value="'+escapeHtml(String(t.id))+'">'+escapeHtml(t.name)+'</option>').join('');
      ds.innerHTML=this._deckOptions((this._normalDecks(planId)[0]||{}).id,planId);document.getElementById('anki-advanced-tags').value='';
      ts.onchange=()=>this._renderAdvancedFields();this._renderAdvancedFields();document.getElementById('anki-advanced-add-modal').style.display='flex';
    }catch(e){showToast('Tipos de nota não carregados do Anki oficial: '+(e&&e.message?e.message:String(e)));}
  },
  _renderAdvancedFields(){
    const nt=AnkiParity.getNotetype(document.getElementById('anki-advanced-type').value),box=document.getElementById('anki-advanced-fields');if(!nt)return;
    if(this.isType(nt)){box.innerHTML='<div class="card" style="padding:12px"><strong>Oclusão de imagem</strong><p class="hint">Use o editor de máscaras para gerar cards independentes a partir da imagem.</p><button type="button" class="btn-primary" id="anki-advanced-open-io">Abrir editor de máscaras</button></div>';document.getElementById('anki-advanced-save').style.display='none';document.getElementById('anki-advanced-open-io').onclick=()=>{document.getElementById('anki-advanced-add-modal').style.display='none';this.openEditor(null,document.getElementById('anki-advanced-deck').value);};return;}
    document.getElementById('anki-advanced-save').style.display='';
    box.innerHTML=(nt.fields||[]).map(f=>'<div class="field"><label>'+escapeHtml(f.name)+'</label><textarea class="anki-advanced-field anki-code-area" data-field="'+escapeHtml(f.name)+'" rows="3"></textarea></div>').join('');
  },
  _bindAdvanced(){
    document.getElementById('anki-advanced-save').addEventListener('click',async()=>{
      const rawNt=AnkiParity.getNotetype(document.getElementById('anki-advanced-type').value);if(!rawNt)return;
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.addOfficialNote!=='function'){showToast('Nota não criada: Anki oficial indisponível.');return;}
      const fields={};document.querySelectorAll('.anki-advanced-field').forEach(x=>fields[x.dataset.field]=x.value);
      const selectedDeck=document.getElementById('anki-advanced-deck').value,
        rec=selectedDeck&&window.StudyGlobalScope&&StudyGlobalScope.deckRecord?StudyGlobalScope.deckRecord(selectedDeck):null,
        planId=(rec&&rec.planId)||(window.StudyGlobalScope&&StudyGlobalScope.activePlanId?StudyGlobalScope.activePlanId():PlanManager.getActivePlanId()),
        tags=String(document.getElementById('anki-advanced-tags').value||'').split(/\s+/).filter(Boolean);
      try{
        const deck=await this._resolveDeck(selectedDeck,planId);
        if(!deck){showToast('Não foi possível preparar o baralho.');return;}
        const res=await CardsOfficialBridge.addOfficialNote({planId,deckId:deck,notetype:rawNt,fields,tags,seed:{deckId:deck}});
        document.getElementById('anki-advanced-add-modal').style.display='none';CardsScreen.render();CardsScreen.updateFavCount();
        showToast('Nota adicionada pelo Anki oficial · '+res.cards.length+' card(s) ✓');
      }catch(e){showToast('Nota não criada: '+(e&&e.message?e.message:String(e)));}
    });
  },

  openEditor(noteId,deckId){
    const supplied=noteId&&typeof noteId==='object'?noteId:null,existing=supplied||(noteId?AnkiParity.getNote(noteId):null),
      noteKey=existing?existing.id:noteId;
    let planId=existing&&existing._planId||null;
    if(!planId&&deckId&&window.StudyGlobalScope&&StudyGlobalScope.deckRecord){const r=StudyGlobalScope.deckRecord(deckId);if(r)planId=r.planId;}
    const nt=existing?AnkiProductParity._typeFor(existing):null;
    this.state={noteId:noteKey!=null?String(noteKey):null,planId:planId||null,deckId:deckId||null,imageData:'',imageFileName:'',img:null,shapes:[],tool:'rect',drawing:null,polygon:[],occludeInactive:false,groupMode:'each',groupOrdinal:1};
    document.getElementById('anki-io-deck').innerHTML=this._deckOptions(deckId||(this._normalDecks(planId)[0]||{}).id,planId);
    document.getElementById('anki-io-header').value='';document.getElementById('anki-io-back').value='';document.getElementById('anki-io-comments').value='';document.getElementById('anki-io-tags').value='';document.getElementById('anki-io-file').value='';
    if(existing){
      const note=existing,type=AnkiProductParity._typeFor(note)||nt;
      const occ=this._fieldByTag(type,note,0,0),image=this._fieldByTag(type,note,1,1);this.state.shapes=this.parse(occ).map(s=>this._shapeFromParsed(s));this.state.occludeInactive=this.state.shapes.some(s=>s.oi);
      document.getElementById('anki-io-header').value=this._fieldByTag(type,note,2,2);document.getElementById('anki-io-back').value=this._fieldByTag(type,note,3,3);document.getElementById('anki-io-comments').value=this._fieldByTag(type,note,4,4);document.getElementById('anki-io-tags').value=(note.tags||[]).join(' ');
      const cards=AnkiProductParity._cardsForNote(note,this.state.planId),d=cards.find(c=>c.deckId);if(d)this.state.deckId=d.deckId;
      document.getElementById('anki-io-deck').innerHTML=this._deckOptions(this.state.deckId,this.state.planId);
      const m=/\bsrc=["']([^"']+)["']/i.exec(image);if(m)this._loadImageSrc(m[1]);
    }
    document.getElementById('anki-io-occlude-inactive').checked=this.state.occludeInactive;document.getElementById('anki-io-group-mode').value=this.state.groupMode;
    document.getElementById('anki-io-modal').style.display='flex';this._selectTool('rect');this._renderEditor();
  },
  _shapeFromParsed(s){
    const p=s.props||{},base={type:s.type,ordinal:s.ordinal||0,oi:!!s.oi,left:this._num(p.left),top:this._num(p.top)};
    if(s.type==='polygon')return {...base,points:String(p.points||'').trim().split(/\s+/).filter(Boolean).map(x=>{const a=x.split(',').map(Number);return{x:Number.isFinite(a[0])?a[0]:0,y:Number.isFinite(a[1])?a[1]:0};})};
    if(s.type==='ellipse')return {...base,width:this._num(p.rx)*2,height:this._num(p.ry)*2};
    if(s.type==='text')return {...base,text:p.text||'',scale:this._num(p.scale)||1,fs:p.fs==null?null:this._num(p.fs)};
    return {...base,width:this._num(p.width),height:this._num(p.height)};
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
    if(this.state.noteId){showToast('No Anki, a imagem-base não é substituída ao editar uma oclusão. Crie uma nova nota para usar outra imagem.');return false;}
    this.state.imageFileName=String(file.name||'image.png');
    const r=new FileReader();r.onload=()=>this._loadImageSrc(String(r.result||''));r.readAsDataURL(file);return true;
  },
  _loadImageSrc(src){
    this.state.imageData=src;const apply=url=>{const img=new Image();img.onload=()=>{this.state.img=img;this._renderEditor();};img.src=url;};
    if(src&&!/^(?:data:|blob:|https?:)/i.test(String(src))&&window.CardsOfficialBridge&&typeof CardsOfficialBridge._fetchMedia==='function'){
      this.state.imageFileName=String(src);
      void CardsOfficialBridge._fetchMedia(String(src)).then(blob=>{const url=URL.createObjectURL(blob);if(CardsOfficialBridge._blobUrls)CardsOfficialBridge._blobUrls.push(url);apply(url);}).catch(()=>apply(src));
      return;
    }
    apply(src);
  },
  _canvasPoint(e){const c=document.getElementById('anki-io-canvas'),r=c.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};},
  _ordinalForNew(){if(this.state.tool==='text')return 0;if(this.state.groupMode==='same')return Math.max(1,this.state.groupOrdinal||1);return this._nextOrdinal();},
  _nextOrdinal(){return Math.max(0,...this.state.shapes.map(s=>Number(s.ordinal)||0))+1;},
  _pointerDown(e){
    if(!this.state.img)return;const p=this._canvasPoint(e);
    if(this.state.tool==='polygon'){this.state.polygon.push(p);document.getElementById('anki-io-finish-poly').disabled=this.state.polygon.length<3;this._renderEditor();return;}
    if(this.state.tool==='text'){UI.prompt([{key:'txt',label:'Texto',type:'text',value:''}],{title:'Texto sobre a imagem',okText:'Adicionar'}).then(v=>{if(v&&v.txt){const h=Math.max(1,this.state.img&&this.state.img.naturalHeight||1);this.state.shapes.push({type:'text',ordinal:0,oi:this.state.occludeInactive,left:p.x,top:p.y,text:v.txt,scale:1,fs:40/h});this._renderEditor();}});return;}
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
  _fmt(n){const x=Number(n);if(Number.isNaN(x)||x===0)return '.0000';return x.toFixed(4).replace(/^0+|0+$/g,'');},
  _escProp(v){return String(v||'').replace(/\\/g,'\\\\').replace(/:/g,'\\:');},
  serializeShape(s){
    // Mesmo contrato de ts/routes/image-occlusion/shapes/to-cloze.ts:
    // left/top em todos os shapes; rect usa width/height; ellipse usa rx/ry;
    // polygon usa points; texto usa text/scale/fs; oi é uma opção global.
    const oi=this.state.occludeInactive?':oi=1':'',
      base='left='+this._fmt(s.left||0)+':top='+this._fmt(s.top||0);
    if(s.type==='polygon'){
      const pts=Array.isArray(s.points)?s.points:[],left=pts.length?Math.min(...pts.map(p=>Number(p.x)||0)):0,top=pts.length?Math.min(...pts.map(p=>Number(p.y)||0)):0;
      return '{{c'+s.ordinal+'::image-occlusion:polygon:left='+this._fmt(left)+':top='+this._fmt(top)+':points='+pts.map(p=>this._fmt(p.x)+','+this._fmt(p.y)).join(' ')+oi+'}}<br>';
    }
    if(s.type==='text'){
      let data=base+':text='+this._escProp(s.text)+':scale='+this._fmt(s.scale==null?1:s.scale);
      if(s.fs!=null)data+=':fs='+this._fmt(s.fs);
      return '{{c0::image-occlusion:text:'+data+oi+'}}<br>';
    }
    if(s.type==='ellipse')return '{{c'+s.ordinal+'::image-occlusion:ellipse:'+base+':rx='+this._fmt((Number(s.width)||0)/2)+':ry='+this._fmt((Number(s.height)||0)/2)+oi+'}}<br>';
    return '{{c'+s.ordinal+'::image-occlusion:rect:'+base+':width='+this._fmt(s.width)+':height='+this._fmt(s.height)+oi+'}}<br>';
  },
  serialize(){return this.state.shapes.map(s=>this.serializeShape(s)).join('');},

  async save(){
    if(!this.state.imageData){showToast('Escolha uma imagem');return;}if(!this.state.shapes.some(s=>Number(s.ordinal)>0)){showToast('Desenhe ao menos uma máscara');return;}
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.saveOfficialImageOcclusion!=='function'){showToast('Oclusão não salva: backend oficial do Anki indisponível.');return;}
    try{
      const deck=await this._resolveDeck(document.getElementById('anki-io-deck').value,this.state.planId);
      if(!deck){showToast('Não foi possível preparar o baralho Padrão.');return;}
      const payload={
        deckId:deck,imageData:this.state.imageData,imageFileName:this.state.imageFileName,
        occlusions:this.serialize(),header:document.getElementById('anki-io-header').value,
        backExtra:document.getElementById('anki-io-back').value,comments:document.getElementById('anki-io-comments').value,
        tags:String(document.getElementById('anki-io-tags').value||'').split(/\s+/).filter(Boolean)
      };
      const res=await CardsOfficialBridge.saveOfficialImageOcclusion(this.state,payload);
      document.getElementById('anki-io-modal').style.display='none';CardsScreen.render();CardsScreen.updateFavCount();
      showToast('Oclusão salva pelo Anki oficial · '+res.cards.length+' card(s) ✓');
    }catch(e){showToast('Oclusão não salva: '+(e&&e.message?e.message:String(e)));}
  },

  _protectIoType(){
    const oldEdit=AnkiProductParity.openNoteEditor.bind(AnkiProductParity);AnkiProductParity.openNoteEditor=(id)=>{const note=id&&typeof id==='object'?id:AnkiParity.getNote(id),nt=AnkiProductParity._typeFor(note);if(this.isType(nt)){this.openEditor(note,(AnkiProductParity._cardsForNote(note,note&&note._planId).find(c=>c.deckId)||{}).deckId);return;}oldEdit(id);};
    const oldNt=AnkiProductParity.openNotetypeEditor.bind(AnkiProductParity);AnkiProductParity.openNotetypeEditor=(id)=>{oldNt(id);const nt=AnkiParity.getNotetype(id);if(!this.isType(nt))return;requestAnimationFrame(()=>{const rows=[...document.querySelectorAll('#anki-nt-fields .anki-field-row')];(nt.fields||[]).forEach((f,i)=>{if(f.preventDeletion&&rows[i]){const b=rows[i].querySelector('[data-remove]');if(b){b.disabled=true;b.title='Campo estrutural do Image Occlusion';}}});});};
  }
};
window.AnkiImageOcclusion=AnkiImageOcclusion;
queueMicrotask(()=>AnkiImageOcclusion.install());
