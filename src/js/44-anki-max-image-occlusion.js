/* ============================================================
   PARIDADE MÁXIMA — IMAGE OCCLUSION TOOLS
   Seleção, mover/redimensionar, zoom, histórico, duplicar,
   agrupar/desagrupar, alinhamento e opacidade.
   ============================================================ */
const AnkiMaxImageOcclusion = {
  install(){
    if(this._installed||typeof AnkiImageOcclusion==='undefined')return;
    this._installed=true;
    this._injectTools();
    this._patchLifecycle();
    this._patchPointerModel();
    this._patchRender();
    this._bindShortcuts();
  },

  _clone(v){return JSON.parse(JSON.stringify(v));},
  _ensureState(){
    const s=AnkiImageOcclusion.state;
    if(!Array.isArray(s.selected))s.selected=[];
    if(!Array.isArray(s.undoStack))s.undoStack=[];
    if(!Array.isArray(s.redoStack))s.redoStack=[];
    if(!(Number(s.zoom)>0))s.zoom=1;
    if(s.translucent==null)s.translucent=false;
    if(!s.maskColor)s.maskColor='#ff8e8e';
    return s;
  },
  _snapshot(){
    const s=this._ensureState();return {shapes:this._clone(s.shapes||[]),polygon:this._clone(s.polygon||[]),selected:(s.selected||[]).slice(),occludeInactive:!!s.occludeInactive,groupOrdinal:s.groupOrdinal||1};
  },
  _restore(x){
    if(!x)return;const s=this._ensureState();s.shapes=this._clone(x.shapes||[]);s.polygon=this._clone(x.polygon||[]);s.selected=(x.selected||[]).filter(i=>i>=0&&i<s.shapes.length);s.occludeInactive=!!x.occludeInactive;s.groupOrdinal=x.groupOrdinal||1;
    const oi=document.getElementById('anki-io-occlude-inactive');if(oi)oi.checked=s.occludeInactive;AnkiImageOcclusion._renderEditor();this._syncButtons();
  },
  _push(){
    const s=this._ensureState();s.undoStack.push(this._snapshot());if(s.undoStack.length>60)s.undoStack.shift();s.redoStack=[];this._syncButtons();
  },
  undo(){
    const s=this._ensureState();if(!s.undoStack.length)return;s.redoStack.push(this._snapshot());this._restore(s.undoStack.pop());
  },
  redo(){
    const s=this._ensureState();if(!s.redoStack.length)return;s.undoStack.push(this._snapshot());this._restore(s.redoStack.pop());
  },

  _injectTools(){
    const tb=document.querySelector('#anki-io-modal .anki-io-toolbar');if(!tb||document.getElementById('anki-io-select'))return;
    const first=tb.firstElementChild;
    const sel=document.createElement('button');sel.type='button';sel.className='btn-secondary io-tool';sel.id='anki-io-select';sel.dataset.tool='select';sel.textContent='↖ Selecionar';tb.insertBefore(sel,first);
    const extra=document.createElement('div');extra.className='anki-io-max-tools';extra.innerHTML=
      '<button type="button" class="btn-secondary" id="anki-io-redo" title="Refazer">↷</button>'+
      '<button type="button" class="btn-secondary" id="anki-io-duplicate" title="Duplicar seleção">⧉</button>'+
      '<button type="button" class="btn-secondary" id="anki-io-delete-selected" title="Excluir seleção">⌫</button>'+
      '<button type="button" class="btn-secondary" id="anki-io-group" title="Agrupar máscaras no mesmo card">⛓ Agrupar</button>'+
      '<button type="button" class="btn-secondary" id="anki-io-ungroup" title="Desagrupar máscaras">⛓‍💥</button>'+
      '<button type="button" class="btn-secondary" id="anki-io-align" title="Alinhar seleção">≡ Alinhar</button>'+
      '<button type="button" class="btn-secondary" id="anki-io-opacity" title="Alternar transparência">◐</button>'+
      '<label class="anki-io-color" title="Cor das máscaras"><input id="anki-io-color" type="color" value="#ff8e8e"></label>'+
      '<span class="anki-io-zoom"><button type="button" class="btn-secondary" id="anki-io-zoom-out">−</button><button type="button" class="btn-secondary" id="anki-io-zoom-reset">100%</button><button type="button" class="btn-secondary" id="anki-io-zoom-in">＋</button></span>';
    tb.appendChild(extra);

    document.getElementById('anki-io-redo').addEventListener('click',()=>this.redo());
    document.getElementById('anki-io-duplicate').addEventListener('click',()=>this.duplicate());
    document.getElementById('anki-io-delete-selected').addEventListener('click',()=>this.deleteSelected());
    document.getElementById('anki-io-group').addEventListener('click',()=>this.group());
    document.getElementById('anki-io-ungroup').addEventListener('click',()=>this.ungroup());
    document.getElementById('anki-io-align').addEventListener('click',()=>this.alignPrompt());
    document.getElementById('anki-io-opacity').addEventListener('click',()=>{const s=this._ensureState();s.translucent=!s.translucent;AnkiImageOcclusion._renderEditor();this._syncButtons();});
    document.getElementById('anki-io-color').addEventListener('input',e=>{this._ensureState().maskColor=e.target.value;AnkiImageOcclusion._renderEditor();});
    document.getElementById('anki-io-zoom-out').addEventListener('click',()=>this.zoomBy(1/1.2));
    document.getElementById('anki-io-zoom-in').addEventListener('click',()=>this.zoomBy(1.2));
    document.getElementById('anki-io-zoom-reset').addEventListener('click',()=>this.setZoom(1));

    const undo=document.getElementById('anki-io-undo');if(undo){undo.textContent='↶ Desfazer';undo.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();this.undo();},true);}
    const clear=document.getElementById('anki-io-clear');if(clear)clear.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const s=this._ensureState();if(!s.shapes.length)return;this._push();s.shapes=[];s.selected=[];s.polygon=[];AnkiImageOcclusion._renderEditor();},true);
  },

  _patchLifecycle(){
    const oldOpen=AnkiImageOcclusion.openEditor.bind(AnkiImageOcclusion);
    AnkiImageOcclusion.openEditor=(noteId,deckId)=>{
      oldOpen(noteId,deckId);const s=this._ensureState();s.selected=[];s.undoStack=[];s.redoStack=[];s.zoom=1;s.translucent=false;s.maskColor='#ff8e8e';s.drag=null;
      const c=document.getElementById('anki-io-color');if(c)c.value=s.maskColor;this._syncButtons();AnkiImageOcclusion._renderEditor();
    };
    const oldSelect=AnkiImageOcclusion._selectTool.bind(AnkiImageOcclusion);
    AnkiImageOcclusion._selectTool=(tool)=>{
      oldSelect(tool);const s=this._ensureState();if(tool!=='select')s.drag=null;this._syncButtons();
    };
    const oldFinish=AnkiImageOcclusion._finishPolygon.bind(AnkiImageOcclusion);
    AnkiImageOcclusion._finishPolygon=()=>{const s=this._ensureState();if(s.polygon.length>=3)this._push();oldFinish();};
  },

  _bounds(shape){
    if(!shape)return {left:0,top:0,right:0,bottom:0,width:0,height:0};
    if(shape.type==='polygon'&&shape.points&&shape.points.length){
      const xs=shape.points.map(p=>p.x),ys=shape.points.map(p=>p.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);return {left,top,right,bottom,width:right-left,height:bottom-top};
    }
    const left=Number(shape.left)||0,top=Number(shape.top)||0,width=Math.max(.005,Number(shape.width)||.02),height=Math.max(.005,Number(shape.height)||.02);
    return {left,top,right:left+width,bottom:top+height,width,height};
  },
  _pointInPolygon(p,pts){
    let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const a=pts[i],b=pts[j],hit=((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/((b.y-a.y)||1e-9)+a.x);if(hit)inside=!inside;
    }return inside;
  },
  _hit(p){
    const shapes=this._ensureState().shapes||[];
    for(let i=shapes.length-1;i>=0;i--){const s=shapes[i],b=this._bounds(s);
      if(s.type==='polygon'){if(this._pointInPolygon(p,s.points||[]))return i;}
      else if(p.x>=b.left&&p.x<=b.right&&p.y>=b.top&&p.y<=b.bottom)return i;
    }return -1;
  },
  _nearResize(p,shape){
    const b=this._bounds(shape),tol=.018/Math.max(.5,this._ensureState().zoom||1);return Math.abs(p.x-b.right)<=tol&&Math.abs(p.y-b.bottom)<=tol;
  },
  _shiftShape(shape,dx,dy){
    if(shape.type==='polygon'&&shape.points)shape.points.forEach(p=>{p.x=Math.max(0,Math.min(1,p.x+dx));p.y=Math.max(0,Math.min(1,p.y+dy));});
    else{shape.left=Math.max(0,Math.min(1-(shape.width||0),Number(shape.left||0)+dx));shape.top=Math.max(0,Math.min(1-(shape.height||0),Number(shape.top||0)+dy));}
  },

  _patchPointerModel(){
    const oldDown=AnkiImageOcclusion._pointerDown.bind(AnkiImageOcclusion),oldMove=AnkiImageOcclusion._pointerMove.bind(AnkiImageOcclusion),oldUp=AnkiImageOcclusion._pointerUp.bind(AnkiImageOcclusion);
    AnkiImageOcclusion._pointerDown=(e)=>{
      const s=this._ensureState();if(!s.img)return;
      if(s.tool!=='select'){
        if(s.tool==='rect'||s.tool==='ellipse')this._push();
        if(s.tool==='text'){
          const p=AnkiImageOcclusion._canvasPoint(e);UI.prompt([{key:'txt',label:'Texto',type:'text',value:''}],{title:'Texto sobre a imagem',okText:'Adicionar'}).then(v=>{if(v&&v.txt){this._push();s.shapes.push({type:'text',ordinal:0,oi:false,left:p.x,top:p.y,width:.1,height:.05,text:v.txt});s.selected=[s.shapes.length-1];AnkiImageOcclusion._renderEditor();}});return;
        }
        return oldDown(e);
      }
      const p=AnkiImageOcclusion._canvasPoint(e),idx=this._hit(p);
      if(idx<0){if(!e.shiftKey)s.selected=[];s.drag=null;AnkiImageOcclusion._renderEditor();return;}
      if(e.shiftKey){const at=s.selected.indexOf(idx);if(at>=0)s.selected.splice(at,1);else s.selected.push(idx);AnkiImageOcclusion._renderEditor();return;}
      if(!s.selected.includes(idx))s.selected=[idx];
      this._push();
      const primary=s.shapes[idx],resize=s.selected.length===1&&primary.type!=='polygon'&&this._nearResize(p,primary);
      s.drag={mode:resize?'resize':'move',start:p,selected:s.selected.slice(),original:s.selected.map(i=>({i,shape:this._clone(s.shapes[i])}))};
      e.currentTarget.setPointerCapture&&e.currentTarget.setPointerCapture(e.pointerId);AnkiImageOcclusion._renderEditor();
    };
    AnkiImageOcclusion._pointerMove=(e)=>{
      const s=this._ensureState();if(s.tool!=='select'||!s.drag)return oldMove(e);
      const p=AnkiImageOcclusion._canvasPoint(e),dx=p.x-s.drag.start.x,dy=p.y-s.drag.start.y;
      s.drag.original.forEach(({i,shape})=>{s.shapes[i]=this._clone(shape);if(s.drag.mode==='move')this._shiftShape(s.shapes[i],dx,dy);else{const x=s.shapes[i];x.width=Math.max(.005,Math.min(1-(x.left||0),(Number(shape.width)||.02)+dx));x.height=Math.max(.005,Math.min(1-(x.top||0),(Number(shape.height)||.02)+dy));}});
      AnkiImageOcclusion._renderEditor();
    };
    AnkiImageOcclusion._pointerUp=(e)=>{
      const s=this._ensureState();if(s.tool!=='select'||!s.drag)return oldUp(e);s.drag=null;AnkiImageOcclusion._renderEditor();this._syncButtons();
    };
  },

  _patchRender(){
    const oldRender=AnkiImageOcclusion._renderEditor.bind(AnkiImageOcclusion);
    AnkiImageOcclusion._drawShape=(ctx,s,w,h,preview)=>{
      const st=this._ensureState();ctx.save();
      const maskColor=preview?'rgba(78,136,255,.35)':(s.ordinal===0?'rgba(255,255,255,.72)':st.maskColor||'#ff8e8e');
      ctx.globalAlpha=preview?1:(st.translucent?.4:1);ctx.fillStyle=maskColor;ctx.strokeStyle=s.ordinal===0?'#333':'#b22';ctx.lineWidth=Math.max(1,w/500);
      if(s.type==='rect'||s.type==='ellipse'){
        const x=s.left*w,y=s.top*h,ww=s.width*w,hh=s.height*h;ctx.beginPath();if(s.type==='ellipse')ctx.ellipse(x+ww/2,y+hh/2,ww/2,hh/2,0,0,Math.PI*2);else ctx.rect(x,y,ww,hh);ctx.fill();ctx.stroke();
      }else if(s.type==='polygon'&&s.points&&s.points.length){
        ctx.beginPath();s.points.forEach((p,i)=>(i?ctx.lineTo(p.x*w,p.y*h):ctx.moveTo(p.x*w,p.y*h)));ctx.closePath();ctx.fill();ctx.stroke();
      }else if(s.type==='text'){
        ctx.globalAlpha=1;ctx.fillStyle='#111';ctx.font=Math.max(12,w/35)+'px sans-serif';ctx.fillText(s.text||'',s.left*w,s.top*h);
      }
      ctx.restore();
    };
    AnkiImageOcclusion._renderEditor=()=>{
      oldRender();const s=this._ensureState(),c=document.getElementById('anki-io-canvas');if(!c)return;
      if(s.img){c.style.width=(100*s.zoom)+'%';c.style.maxWidth='none';const ctx=c.getContext('2d');ctx.save();ctx.strokeStyle='#2563eb';ctx.fillStyle='#2563eb';ctx.lineWidth=Math.max(2,c.width/450);ctx.setLineDash([6,4]);
        (s.selected||[]).forEach(i=>{const sh=s.shapes[i];if(!sh)return;const b=this._bounds(sh),x=b.left*c.width,y=b.top*c.height,w=b.width*c.width,h=b.height*c.height;ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);ctx.fillRect(x+w-5,y+h-5,10,10);ctx.setLineDash([6,4]);});
        ctx.restore();
      }
      const list=document.getElementById('anki-io-mask-list');if(list)list.querySelectorAll('[data-io-del]').forEach((b,i)=>{const row=b.parentElement;if(row)row.classList.toggle('is-selected',(s.selected||[]).includes(i));});
      this._syncButtons();
    };
  },

  _syncButtons(){
    const s=this._ensureState(),has=s.selected.length>0,multi=s.selected.length>1;
    const set=(id,dis)=>{const b=document.getElementById(id);if(b)b.disabled=!!dis;};
    set('anki-io-redo',!s.redoStack.length);set('anki-io-undo',!s.undoStack.length);set('anki-io-duplicate',!has);set('anki-io-delete-selected',!has);set('anki-io-group',!multi);set('anki-io-ungroup',!has);set('anki-io-align',!multi);
    const op=document.getElementById('anki-io-opacity');if(op)op.classList.toggle('active',!!s.translucent);
    const zr=document.getElementById('anki-io-zoom-reset');if(zr)zr.textContent=Math.round((s.zoom||1)*100)+'%';
  },
  setZoom(v){const s=this._ensureState();s.zoom=Math.max(.25,Math.min(4,Number(v)||1));AnkiImageOcclusion._renderEditor();},
  zoomBy(f){this.setZoom(this._ensureState().zoom*f);},

  duplicate(){
    const s=this._ensureState();if(!s.selected.length)return;this._push();const added=[];
    s.selected.forEach(i=>{const x=this._clone(s.shapes[i]);this._shiftShape(x,.015,.015);s.shapes.push(x);added.push(s.shapes.length-1);});s.selected=added;AnkiImageOcclusion._renderEditor();
  },
  deleteSelected(){
    const s=this._ensureState();if(!s.selected.length)return;this._push();const bad=new Set(s.selected);s.shapes=s.shapes.filter((_,i)=>!bad.has(i));s.selected=[];AnkiImageOcclusion._renderEditor();
  },
  group(){
    const s=this._ensureState(),ids=s.selected.filter(i=>s.shapes[i]&&s.shapes[i].type!=='text');if(ids.length<2)return;this._push();
    const ords=ids.map(i=>Number(s.shapes[i].ordinal)).filter(n=>n>0),ord=ords.length?Math.min(...ords):AnkiImageOcclusion._nextOrdinal();ids.forEach(i=>s.shapes[i].ordinal=ord);AnkiImageOcclusion._renderEditor();
  },
  ungroup(){
    const s=this._ensureState(),ids=s.selected.filter(i=>s.shapes[i]&&s.shapes[i].type!=='text');if(!ids.length)return;this._push();let next=AnkiImageOcclusion._nextOrdinal();ids.forEach(i=>s.shapes[i].ordinal=next++);AnkiImageOcclusion._renderEditor();
  },
  alignPrompt(){
    UI.prompt([{key:'mode',label:'Alinhamento',type:'select',value:'left',options:[
      {value:'left',label:'Esquerda'},{value:'hcenter',label:'Centro horizontal'},{value:'right',label:'Direita'},
      {value:'top',label:'Topo'},{value:'vcenter',label:'Centro vertical'},{value:'bottom',label:'Base'}
    ]}],{title:'≡ Alinhar máscaras',okText:'Alinhar'}).then(v=>{if(v)this.align(v.mode);});
  },
  align(mode){
    const s=this._ensureState(),ids=s.selected.filter(i=>s.shapes[i]);if(ids.length<2)return;this._push();const bs=ids.map(i=>this._bounds(s.shapes[i])),all={left:Math.min(...bs.map(b=>b.left)),right:Math.max(...bs.map(b=>b.right)),top:Math.min(...bs.map(b=>b.top)),bottom:Math.max(...bs.map(b=>b.bottom))};all.cx=(all.left+all.right)/2;all.cy=(all.top+all.bottom)/2;
    ids.forEach((id,k)=>{const sh=s.shapes[id],b=bs[k];let dx=0,dy=0;if(mode==='left')dx=all.left-b.left;if(mode==='right')dx=all.right-b.right;if(mode==='hcenter')dx=all.cx-(b.left+b.right)/2;if(mode==='top')dy=all.top-b.top;if(mode==='bottom')dy=all.bottom-b.bottom;if(mode==='vcenter')dy=all.cy-(b.top+b.bottom)/2;this._shiftShape(sh,dx,dy);});AnkiImageOcclusion._renderEditor();
  },

  _bindShortcuts(){
    document.addEventListener('keydown',e=>{
      const modal=document.getElementById('anki-io-modal');if(!modal||modal.style.display!=='flex')return;
      const tag=String(e.target&&e.target.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea'||tag==='select')return;
      if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'&&!e.shiftKey){e.preventDefault();this.undo();return;}
      if((e.ctrlKey||e.metaKey)&&(e.code==='KeyY'||(e.shiftKey&&e.code==='KeyZ'))){e.preventDefault();this.redo();return;}
      if((e.ctrlKey||e.metaKey)&&e.code==='KeyD'){e.preventDefault();this.duplicate();return;}
      if((e.ctrlKey||e.metaKey)&&e.code==='KeyG'&&!e.shiftKey){e.preventDefault();this.group();return;}
      if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.code==='KeyG'){e.preventDefault();this.ungroup();return;}
      if(e.code==='Delete'||e.code==='Backspace'){e.preventDefault();this.deleteSelected();return;}
      if((e.ctrlKey||e.metaKey)&&e.code==='KeyA'){e.preventDefault();const s=this._ensureState();s.selected=s.shapes.map((_,i)=>i);AnkiImageOcclusion._selectTool('select');AnkiImageOcclusion._renderEditor();}
    });
  }
};
queueMicrotask(()=>AnkiMaxImageOcclusion.install());
