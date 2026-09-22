/* ============================================================
   PARIDADE MÁXIMA — EDITOR / NOTE TYPES
   Expõe metadados do schema moderno sem substituir o editor simples.
   ============================================================ */
const AnkiMaxEditor = {
  _richEditingNote:null,_recorders:new Map(),

  install(){
    if(this._installed||typeof AnkiProductParity==='undefined'||typeof AnkiParity==='undefined')return;
    this._installed=true;
    this._patchNoteTypes();
    this._patchNoteEditor();
    this._patchAdvancedAdd();
  },

  esc(v){return AnkiProductParity.esc(v);},
  _deckOptions(value){
    const ds=DB.getDecks().filter(d=>!(AnkiParity.isFilteredDeck&&AnkiParity.isFilteredDeck(d)));
    return '<option value="">— padrão do template/baralho —</option>'+ds.map(d=>'<option value="'+this.esc(d.ankiId||d.id)+'" '+(String(value||'')===String(d.ankiId||d.id)?'selected':'')+'>'+this.esc(d.nome)+'</option>').join('');
  },

  /* ───────────────── NOTE TYPES ───────────────── */
  _patchNoteTypes(){
    const modal=document.getElementById('anki-nt-edit-modal');if(!modal)return;
    const nameField=document.getElementById('anki-nt-name')&&document.getElementById('anki-nt-name').closest('.field');
    if(nameField&&!document.getElementById('anki-nt-meta')){
      const d=document.createElement('div');d.id='anki-nt-meta';d.className='anki-nt-meta';d.innerHTML=
        '<div class="field-group"><div class="field"><label>Campo de ordenação</label><select id="anki-nt-sortf"></select></div>'+
        '<div class="field"><label><input id="anki-nt-latexsvg" type="checkbox"> LaTeX em SVG</label><input id="anki-nt-stock-kind" type="text" readonly title="OriginalStockKind"></div></div>'+
        '<details><summary>Configuração LaTeX</summary><div class="field"><label>Preâmbulo LaTeX</label><textarea id="anki-nt-latex-pre" class="anki-code-area"></textarea></div>'+
        '<div class="field"><label>Pós-LaTeX</label><textarea id="anki-nt-latex-post" class="anki-code-area"></textarea></div></details>';
      nameField.insertAdjacentElement('afterend',d);
    }

    AnkiProductParity._appendFieldRow=(field,source)=>{
      const f=typeof field==='object'&&field?field:{name:String(field||'')},src=source==null?(f.name||''):source,d=document.createElement('div');
      d.className='anki-field-row anki-field-row-max';d.dataset.source=src;d.dataset.preventDeletion=f.preventDeletion?'1':'0';
      d.innerHTML=
        '<span class="anki-drag-actions"><button type="button" class="icon-btn" data-move="up">↑</button><button type="button" class="icon-btn" data-move="down">↓</button></span>'+
        '<div class="anki-field-main"><input class="anki-field-name" type="text" value="'+this.esc(f.name||'')+'" placeholder="Nome do campo">'+
        '<details class="anki-field-advanced"><summary>Opções do campo</summary><div class="anki-field-options">'+
        '<label>Descrição<input class="anki-field-description" type="text" value="'+this.esc(f.description||'')+'"></label>'+
        '<label>Fonte<input class="anki-field-font" type="text" value="'+this.esc(f.fontName||f.font||'Arial')+'"></label>'+
        '<label>Tamanho<input class="anki-field-size" type="number" min="1" max="200" value="'+this.esc(Number(f.fontSize||f.size)||20)+'"></label>'+
        '<label class="check-label"><input class="anki-field-sticky" type="checkbox" '+(f.sticky?'checked':'')+'> Sticky</label>'+
        '<label class="check-label"><input class="anki-field-rtl" type="checkbox" '+(f.rtl?'checked':'')+'> RTL</label>'+
        '<label class="check-label"><input class="anki-field-plain" type="checkbox" '+(f.plainText?'checked':'')+'> Texto simples</label>'+
        '<label class="check-label"><input class="anki-field-collapsed" type="checkbox" '+(f.collapsed?'checked':'')+'> Recolhido</label>'+
        '<label class="check-label"><input class="anki-field-exclude" type="checkbox" '+(f.excludeFromSearch?'checked':'')+'> Excluir da busca</label>'+
        '<label class="check-label"><input class="anki-field-protect" type="checkbox" '+(f.preventDeletion?'checked':'')+'> Proteger exclusão</label>'+
        '<span class="hint">ID '+this.esc(f.id==null?'—':f.id)+' · tag '+this.esc(f.tag==null?'—':f.tag)+'</span>'+
        '</div></details></div>'+
        '<button type="button" class="icon-btn danger" data-remove '+(f.preventDeletion?'disabled title="Campo protegido pelo tipo de nota"':'')+'>×</button>';
      d._ankiMeta=JSON.parse(JSON.stringify(f));document.getElementById('anki-nt-fields').appendChild(d);
    };

    AnkiProductParity._appendTemplateRow=(t,sourceOrd)=>{
      t=t||{};const d=document.createElement('div');d.className='anki-template-editor anki-template-editor-max';d.dataset.sourceOrd=sourceOrd==null?'':sourceOrd;d._ankiMeta=JSON.parse(JSON.stringify(t));
      d.innerHTML=
        '<div class="anki-template-head"><input class="anki-template-name" type="text" value="'+this.esc(t.name||'Card')+'"><span><button type="button" class="icon-btn" data-move="up">↑</button><button type="button" class="icon-btn" data-move="down">↓</button><button type="button" class="icon-btn danger" data-remove>×</button></span></div>'+
        '<div class="anki-template-grid"><div><label>Frente</label><textarea class="anki-code-area anki-qfmt" spellcheck="false">'+this.esc(t.qfmt||'')+'</textarea></div>'+
        '<div><label>Verso</label><textarea class="anki-code-area anki-afmt" spellcheck="false">'+this.esc(t.afmt||'')+'</textarea></div></div>'+
        '<details class="anki-template-advanced"><summary>Browser e propriedades avançadas</summary>'+
        '<div class="anki-template-grid"><div><label>Browser Front</label><textarea class="anki-code-area anki-bqfmt" spellcheck="false">'+this.esc(t.bqfmt||'')+'</textarea></div>'+
        '<div><label>Browser Back</label><textarea class="anki-code-area anki-bafmt" spellcheck="false">'+this.esc(t.bafmt||'')+'</textarea></div></div>'+
        '<div class="field-group"><div class="field"><label>Deck override</label><select class="anki-template-did">'+this._deckOptions(t.did)+'</select></div>'+
        '<div class="field"><label>Fonte no Browser</label><input class="anki-template-bfont" type="text" value="'+this.esc(t.bfont||'')+'"></div>'+
        '<div class="field"><label>Tamanho no Browser</label><input class="anki-template-bsize" type="number" min="0" max="200" value="'+this.esc(Number(t.bsize)||0)+'"></div></div>'+
        '<p class="hint">Template ID: '+this.esc(t.id==null?'—':t.id)+'</p></details>';
      document.getElementById('anki-nt-templates').appendChild(d);
    };

    AnkiProductParity.openNotetypeEditor=(id)=>{
      const nt=AnkiParity.getNotetype(id);if(!nt)return;AnkiProductParity._editingNtId=String(id);AnkiProductParity._editingNtOriginal=JSON.parse(JSON.stringify(nt));
      document.getElementById('anki-nt-edit-sub').textContent=AnkiParity.notes().filter(n=>String(n.notetypeId)===String(id)).length+' nota(s) usam este tipo';
      document.getElementById('anki-nt-name').value=nt.name||'';
      const fb=document.getElementById('anki-nt-fields');fb.innerHTML='';(nt.fields||[]).forEach(f=>AnkiProductParity._appendFieldRow(f,f.name));
      const tb=document.getElementById('anki-nt-templates');tb.innerHTML='';(nt.templates||[]).forEach((t,i)=>AnkiProductParity._appendTemplateRow(t,t.ord==null?i:t.ord));
      document.getElementById('anki-nt-css').value=nt.css||'';
      const sort=document.getElementById('anki-nt-sortf');sort.innerHTML=(nt.fields||[]).map((f,i)=>'<option value="'+i+'">'+this.esc(f.name)+'</option>').join('');sort.value=String(Number(nt.sortf)||0);
      document.getElementById('anki-nt-latex-pre').value=nt.latexPre||'';document.getElementById('anki-nt-latex-post').value=nt.latexPost||'';document.getElementById('anki-nt-latexsvg').checked=!!nt.latexsvg;
      document.getElementById('anki-nt-stock-kind').value='OriginalStockKind: '+(Number(nt.originalStockKind)||0);
      document.getElementById('anki-nt-edit-modal').style.display='flex';
    };

    AnkiProductParity.saveNotetypeEditor=()=>{
      const old=AnkiProductParity._editingNtOriginal;if(!old)return;
      const fieldRows=[...document.querySelectorAll('#anki-nt-fields .anki-field-row')],templateRows=[...document.querySelectorAll('#anki-nt-templates .anki-template-editor')];
      const names=fieldRows.map(r=>String(r.querySelector('.anki-field-name').value||'').trim());
      if(!names.length||names.some(x=>!x)){showToast('Todo tipo precisa de ao menos um campo com nome.');return;}
      if(new Set(names.map(x=>x.toLowerCase())).size!==names.length){showToast('Os nomes dos campos precisam ser únicos.');return;}
      if(!templateRows.length){showToast('Todo tipo precisa de ao menos um template.');return;}
      const nt=JSON.parse(JSON.stringify(old));nt.name=String(document.getElementById('anki-nt-name').value||'').trim()||old.name;
      nt.sortf=Math.max(0,Math.min(fieldRows.length-1,Number(document.getElementById('anki-nt-sortf').value)||0));
      nt.latexPre=document.getElementById('anki-nt-latex-pre').value;nt.latexPost=document.getElementById('anki-nt-latex-post').value;nt.latexsvg=document.getElementById('anki-nt-latexsvg').checked;
      nt.fields=fieldRows.map((r,i)=>{
        const base=JSON.parse(JSON.stringify(r._ankiMeta||{}));
        return Object.assign(base,{name:names[i],ord:i,_source:r.dataset.source||'',
          description:r.querySelector('.anki-field-description').value,fontName:r.querySelector('.anki-field-font').value||'Arial',
          fontSize:Math.max(1,Number(r.querySelector('.anki-field-size').value)||20),sticky:r.querySelector('.anki-field-sticky').checked,
          rtl:r.querySelector('.anki-field-rtl').checked,plainText:r.querySelector('.anki-field-plain').checked,
          collapsed:r.querySelector('.anki-field-collapsed').checked,excludeFromSearch:r.querySelector('.anki-field-exclude').checked,
          preventDeletion:r.querySelector('.anki-field-protect').checked});
      });
      nt.templates=templateRows.map((r,i)=>{
        const base=JSON.parse(JSON.stringify(r._ankiMeta||{})),did=r.querySelector('.anki-template-did').value;
        return Object.assign(base,{name:String(r.querySelector('.anki-template-name').value||('Card '+(i+1))).trim(),ord:i,_sourceOrd:r.dataset.sourceOrd,
          qfmt:r.querySelector('.anki-qfmt').value,afmt:r.querySelector('.anki-afmt').value,bqfmt:r.querySelector('.anki-bqfmt').value,bafmt:r.querySelector('.anki-bafmt').value,
          did:did?Number(did)||did:null,bfont:r.querySelector('.anki-template-bfont').value,bsize:Math.max(0,Number(r.querySelector('.anki-template-bsize').value)||0)});
      });
      nt.css=document.getElementById('anki-nt-css').value;
      const notes=AnkiParity.notes().filter(n=>String(n.notetypeId)===String(nt.id)),removed=(old.fields||[]).filter(f=>!nt.fields.some(nf=>nf._source===f.name));
      const dataLoss=removed.some(f=>notes.some(n=>AnkiParity._fieldNonempty(n.fields&&n.fields[f.name])));
      const apply=()=>AnkiProductParity._applyNotetypeEdit(old,nt,notes);
      if(dataLoss)UI.confirm('Há conteúdo em campo(s) removido(s). Salvar apagará esse conteúdo das notas que usam o tipo.',{title:'⚠ Campo com conteúdo',okText:'Salvar mesmo assim',danger:true}).then(ok=>{if(ok)apply();});else apply();
    };
  },

  /* ───────────────── RICH NOTE EDITOR ───────────────── */
  _fieldEditorHtml(f,value,prefix){
    const id=prefix+'-'+String(f.ord==null?0:f.ord),style='font-family:'+this.esc(f.fontName||'Arial')+';font-size:'+this.esc(Number(f.fontSize)||20)+'px;'+(f.rtl?'direction:rtl;text-align:right;':'');
    const hint=f.description?'<p class="hint">'+this.esc(f.description)+'</p>':'';
    if(f.plainText)return '<div class="field anki-max-field" data-field="'+this.esc(f.name)+'"><label>'+this.esc(f.name)+(f.sticky?' · 📌':'')+'</label>'+hint+'<textarea id="'+id+'" class="anki-note-field anki-max-plain" data-field="'+this.esc(f.name)+'" rows="4" style="'+style+'">'+this.esc(value||'')+'</textarea></div>';
    return '<div class="field anki-max-field '+(f.collapsed?'anki-field-collapsed':'')+'" data-field="'+this.esc(f.name)+'"><label>'+this.esc(f.name)+(f.sticky?' · 📌':'')+'</label>'+hint+
      '<div class="rte anki-max-rte" data-target="'+id+'" data-start-collapsed="'+(f.collapsed?'1':'0')+'"><div class="rte-toolbar"></div><div class="rte-area anki-note-field" id="'+id+'" data-field="'+this.esc(f.name)+'" contenteditable="true" style="'+style+'">'+String(value||'')+'</div></div></div>';
  },
  _decorateRichEditors(root){
    root.querySelectorAll('.anki-max-rte').forEach(rte=>{
      try{if(typeof buildRteToolbar==='function')buildRteToolbar(rte);}catch(e){console.warn('RTE avançado',e);}
      const tb=rte.querySelector('.rte-toolbar'),area=document.getElementById(rte.dataset.target);if(!tb||!area||tb.querySelector('.anki-extra-media'))return;
      const grp=document.createElement('div');grp.className='rte-grp anki-extra-media';grp.innerHTML=
        '<button type="button" data-anki-audio title="Inserir áudio">🔊</button><button type="button" data-anki-video title="Inserir vídeo">🎬</button>'+
        '<button type="button" data-anki-record title="Gravar áudio">🎤</button><button type="button" data-anki-math title="Inserir MathJax">∑</button><button type="button" data-anki-html title="Editar HTML">&lt;/&gt;</button>';
      tb.appendChild(grp);grp.querySelectorAll('button').forEach(b=>b.addEventListener('mousedown',e=>e.preventDefault()));
      grp.querySelector('[data-anki-audio]').onclick=()=>this._pickMedia(area,'audio/*','audio');
      grp.querySelector('[data-anki-video]').onclick=()=>this._pickMedia(area,'video/*','video');
      grp.querySelector('[data-anki-math]').onclick=()=>UI.prompt([{key:'tex',label:'MathJax / LaTeX',type:'textarea',rows:4,value:''},{key:'display',label:'Modo',type:'select',value:'inline',options:[{value:'inline',label:'Inline'},{value:'display',label:'Bloco'}]}],{title:'∑ Inserir matemática',okText:'Inserir'}).then(v=>{if(!v||!v.tex)return;this._insertHtml(area,v.display==='display'?'\\['+this.esc(v.tex)+'\\]':'\\('+this.esc(v.tex)+'\\)');});
      grp.querySelector('[data-anki-html]').onclick=()=>UI.prompt([{key:'html',label:'HTML do campo',type:'textarea',rows:12,value:area.innerHTML}],{title:'</> Editar HTML',okText:'Aplicar'}).then(v=>{if(v)area.innerHTML=String(v.html||'');});
      grp.querySelector('[data-anki-record]').onclick=()=>this._toggleRecordInto(area,grp.querySelector('[data-anki-record]'));
    });
  },
  _insertHtml(area,html){area.focus();try{document.execCommand('insertHTML',false,html);}catch(_){area.insertAdjacentHTML('beforeend',html);}},
  _pickMedia(area,accept,tag){
    const inp=document.createElement('input');inp.type='file';inp.accept=accept;inp.onchange=()=>{const f=inp.files&&inp.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const src=String(r.result||''),html=tag==='video'?'<video controls preload="metadata" src="'+this.esc(src)+'"></video>':'<audio controls preload="none" src="'+this.esc(src)+'"></audio>';this._insertHtml(area,html);};r.readAsDataURL(f);};inp.click();
  },
  async _toggleRecordInto(area,btn){
    if(this._recorders.has(area)){
      const x=this._recorders.get(area);if(x.rec.state!=='inactive')x.rec.stop();return;
    }
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){showToast('Microfone indisponível');return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true}),chunks=[],rec=new MediaRecorder(stream);this._recorders.set(area,{rec,stream,chunks});btn.textContent='■';btn.title='Parar gravação';
      rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
      rec.onstop=()=>{stream.getTracks().forEach(t=>t.stop());this._recorders.delete(area);btn.textContent='🎤';btn.title='Gravar áudio';const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'}),fr=new FileReader();fr.onload=()=>this._insertHtml(area,'<audio controls preload="none" src="'+this.esc(String(fr.result||''))+'"></audio>');fr.readAsDataURL(blob);};
      rec.start();
    }catch(_){showToast('Não foi possível acessar o microfone');}
  },

  _patchNoteEditor(){
    const save=document.getElementById('anki-note-save');if(save)save.addEventListener('click',e=>{if(!this._richEditingNote)return;e.preventDefault();e.stopImmediatePropagation();this._saveRichNote();},true);
    AnkiProductParity.openNoteEditor=(id)=>{
      const note=AnkiParity.getNote(id);if(!note)return;const nt=AnkiProductParity._typeFor(note);if(typeof AnkiImageOcclusion!=='undefined'&&AnkiImageOcclusion.isType(nt)){AnkiImageOcclusion.openEditor(id,(AnkiProductParity._cardsForNote(id).find(c=>c.deckId)||{}).deckId);return;}
      this._richEditingNote=String(id);AnkiProductParity._editingNoteId=String(id);
      document.getElementById('anki-note-edit-title').textContent='✎ Editar nota';document.getElementById('anki-note-edit-sub').textContent=(nt&&nt.name||'Tipo de nota')+' · '+AnkiProductParity._cardsForNote(id).length+' card(s)';
      const body=document.getElementById('anki-note-edit-body');
      body.innerHTML=(nt&&nt.fields||[]).map((f,i)=>this._fieldEditorHtml(Object.assign({ord:i},f),note.fields&&note.fields[f.name]||'','anki-note-'+id)).join('')+
        '<div class="field"><label>Tags</label><input id="anki-note-tags" type="text" value="'+this.esc((note.tags||[]).join(' '))+'" placeholder="tag1 tag2::subtag"></div>';
      this._decorateRichEditors(body);document.getElementById('anki-note-edit-modal').style.display='flex';
    };
  },
  _saveRichNote(){
    const id=this._richEditingNote,note=AnkiParity.getNote(id);if(!note)return;const nt=AnkiProductParity._typeFor(note),fields={};
    document.querySelectorAll('#anki-note-edit-body .anki-note-field').forEach(x=>fields[x.dataset.field]=x.isContentEditable?x.innerHTML:x.value);
    const tags=String(document.getElementById('anki-note-tags').value||'').split(/\s+/).filter(Boolean),saved=AnkiParity.saveNote(Object.assign({},note,{fields,tags}));
    AnkiProductParity.reconcileNote(saved,nt);this._richEditingNote=null;document.getElementById('anki-note-edit-modal').style.display='none';AnkiProductParity.renderBrowser();AnkiProductParity.previewNote(saved.id);CardsScreen.render();showToast('Nota atualizada ✓');
  },

  /* ───────────────── ADVANCED ADD ───────────────── */
  _stickyKey(nt){return 'snm-anki-sticky:'+String(nt&&nt.id||'');},
  _stickyRead(nt){try{return JSON.parse(sessionStorage.getItem(this._stickyKey(nt))||'{}')||{};}catch(_){return {};}},
  _stickyWrite(nt,fields){const o={};(nt.fields||[]).forEach(f=>{if(f.sticky)o[f.name]=fields[f.name]||'';});try{sessionStorage.setItem(this._stickyKey(nt),JSON.stringify(o));}catch(_){}},
  _patchAdvancedAdd(){
    const save=document.getElementById('anki-advanced-save');if(save)save.addEventListener('click',e=>{if(!document.querySelector('#anki-advanced-fields .anki-advanced-field-max'))return;e.preventDefault();e.stopImmediatePropagation();this._saveAdvancedRich();},true);
    AnkiImageOcclusion._renderAdvancedFields=()=>{
      const nt=AnkiParity.getNotetype(document.getElementById('anki-advanced-type').value),box=document.getElementById('anki-advanced-fields');if(!nt)return;
      if(AnkiImageOcclusion.isType(nt)){box.innerHTML='<div class="card" style="padding:12px"><strong>Oclusão de imagem</strong><p class="hint">Use o editor de máscaras para gerar cards independentes a partir da imagem.</p><button type="button" class="btn-primary" id="anki-advanced-open-io">Abrir editor de máscaras</button></div>';document.getElementById('anki-advanced-save').style.display='none';document.getElementById('anki-advanced-open-io').onclick=()=>{document.getElementById('anki-advanced-add-modal').style.display='none';AnkiImageOcclusion.openEditor(null,document.getElementById('anki-advanced-deck').value);};return;}
      document.getElementById('anki-advanced-save').style.display='';const sticky=this._stickyRead(nt);
      box.innerHTML=(nt.fields||[]).map((f,i)=>this._fieldEditorHtml(Object.assign({ord:i},f),f.sticky?sticky[f.name]||'':'','anki-advanced-'+nt.id).replace(/anki-note-field/g,'anki-note-field anki-advanced-field-max')).join('');
      this._decorateRichEditors(box);
    };
  },
  _saveAdvancedRich(){
    const nt=AnkiParity.getNotetype(document.getElementById('anki-advanced-type').value);if(!nt)return;const fields={};
    document.querySelectorAll('#anki-advanced-fields .anki-advanced-field-max').forEach(x=>fields[x.dataset.field]=x.isContentEditable?x.innerHTML:x.value);
    if(nt.kind==='cloze'&&!Object.values(fields).some(v=>/\{\{c\d+(?:,\d+)*::/.test(String(v||'')))){showToast('Adicione ao menos uma omissão Cloze, como {{c1::texto}}.');return;}
    const id=AnkiParity._allocId(),note=AnkiParity.saveNote({id,ankiId:id,guid:'snm-'+Number(id).toString(36),notetypeId:nt.id,fields,tags:String(document.getElementById('anki-advanced-tags').value||'').split(/\s+/).filter(Boolean)});
    AnkiProductParity.reconcileNote(note,nt);const deck=document.getElementById('anki-advanced-deck').value;AnkiProductParity._cardsForNote(note.id).forEach(c=>DB.updateCard(c.id,{deckId:deck||null}));this._stickyWrite(nt,fields);
    document.getElementById('anki-advanced-add-modal').style.display='none';CardsScreen.render();showToast('Nota adicionada · '+AnkiProductParity._cardsForNote(note.id).length+' card(s) ✓');
  }
};
queueMicrotask(()=>AnkiMaxEditor.install());
