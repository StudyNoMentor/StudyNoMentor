/* ============================================================
   PARIDADE DE PRODUTO ANKI/ANKIDROID — CAMADA ADITIVA
   Mantém o fluxo/visual atual do Study como padrão e adiciona
   Browser de Notas, Note Types, manutenção e ações do reviewer.
   ============================================================ */
const AnkiProductParity = {
  browser: { query:'', sort:'field', tag:'', flag:'', suspended:'all', marked:false, selected:new Set(), page:0 },
  PAGE: 80,

  esc(v){ return escapeHtml(String(v==null?'':v)); },
  plain(v){ try{return AnkiParity._stripHtml(String(v==null?'':v)).replace(/\s+/g,' ').trim();}catch(_){return String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();} },
  noteId(card){ try{return String(AnkiParity.noteId(card));}catch(_){return String(card&&card.noteId||card&&card.id||'');} },
  ensure(){ try{AnkiParity.ensureCanonicalNotes();}catch(e){console.warn('Falha ao normalizar notas',e);} },

  install(){
    if(this._installed||typeof CardsScreen==='undefined'||typeof AnkiParity==='undefined')return;
    this._installed=true;
    this.ensure();
    this._injectModals();
    this._installMenu();
    this._installReviewerLayer();
  },

  _injectModals(){
    if(document.getElementById('anki-browser-modal'))return;
    const wrap=document.createElement('div');
    wrap.innerHTML=`
      <div id="anki-browser-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box anki-browser-box">
          <div class="cards-modal-head"><div><h2>🗃️ Navegador de notas</h2><p class="sub">Visão por nota, sem substituir “Meus cards”.</p></div><button type="button" class="icon-btn" data-ap-close="anki-browser-modal">✕</button></div>
          <div class="cards-modal-body anki-browser-body">
            <div class="anki-browser-toolbar">
              <input id="anki-browser-search" type="search" placeholder="Buscar em campos, tags ou tipo de nota…">
              <select id="anki-browser-sort">
                <option value="field">Classificar campo</option><option value="notetype">Tipo de nota</option>
                <option value="cards">Quantidade de cards</option><option value="tags">Etiquetas</option><option value="updated">Atualização</option>
              </select>
              <select id="anki-browser-tag"><option value="">Todas as tags</option></select>
              <select id="anki-browser-flag"><option value="">Todas as bandeiras</option><option value="0">Sem bandeira</option><option value="1">Vermelha</option><option value="2">Laranja</option><option value="3">Verde</option><option value="4">Azul</option><option value="5">Rosa</option><option value="6">Turquesa</option><option value="7">Roxa</option></select>
              <select id="anki-browser-suspended"><option value="all">Suspensas e ativas</option><option value="yes">Somente suspensas</option><option value="no">Somente ativas</option></select>
              <label class="check-label anki-browser-marked"><input id="anki-browser-marked" type="checkbox"> Marcadas</label>
            </div>
            <div class="anki-browser-summary" id="anki-browser-summary"></div>
            <div class="anki-browser-layout">
              <div class="anki-browser-list-wrap">
                <div class="anki-browser-bulk">
                  <label class="cards-select-toggle"><input type="checkbox" id="anki-browser-select-all"><span>Selecionar todos</span></label>
                  <span id="anki-browser-selected" class="cards-bulk-count"></span>
                  <button type="button" class="btn-secondary" id="anki-browser-tags-btn" disabled>🏷 Tags</button>
                  <button type="button" class="btn-secondary" id="anki-browser-type-btn" disabled>🧩 Mudar tipo</button>
                  <button type="button" class="btn-secondary" id="anki-browser-suspend-btn" disabled>⏸ Suspender/ativar</button>
                  <button type="button" class="btn-secondary" id="anki-browser-flag-btn" disabled>🚩 Bandeira</button>
                  <button type="button" class="btn-secondary" id="anki-browser-actions-btn" disabled>⋯ Ações</button>
                  <button type="button" class="btn-danger" id="anki-browser-delete-btn" disabled>Excluir notas</button>
                </div>
                <div class="anki-browser-table-head"><span></span><span>Classificar campo</span><span>Tipo de nota</span><span>Cards</span><span>Etiquetas</span></div>
                <div id="anki-browser-list" class="anki-browser-list"></div>
                <div id="anki-browser-more" class="anki-browser-more"></div>
              </div>
              <aside id="anki-browser-preview" class="anki-browser-preview"><p class="hint">Selecione uma nota para pré-visualizar.</p></aside>
            </div>
          </div>
          <div class="cards-modal-foot"><button type="button" class="btn-secondary" id="anki-browser-notetypes">🧩 Gerenciar tipos de nota</button><span style="flex:1"></span><button type="button" class="btn-primary" data-ap-close="anki-browser-modal">Fechar</button></div>
        </div>
      </div>

      <div id="anki-note-edit-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box cards-modal-lg">
          <div class="cards-modal-head"><div><h2 id="anki-note-edit-title">✎ Editar nota</h2><p class="sub" id="anki-note-edit-sub"></p></div><button type="button" class="icon-btn" data-ap-close="anki-note-edit-modal">✕</button></div>
          <div class="cards-modal-body" id="anki-note-edit-body"></div>
          <div class="cards-modal-foot"><button type="button" class="btn-secondary" id="anki-note-change-type">🧩 Mudar tipo</button><span style="flex:1"></span><button type="button" class="btn-secondary" data-ap-close="anki-note-edit-modal">Cancelar</button><button type="button" class="btn-primary" id="anki-note-save">Salvar</button></div>
        </div>
      </div>

      <div id="anki-change-type-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box cards-modal-lg">
          <div class="cards-modal-head"><div><h2>🧩 Mudar tipo de nota</h2><p class="sub">O agendamento dos cards correspondentes é preservado; cards que deixam de ser gerados viram “cards vazios”, como no Anki.</p></div><button type="button" class="icon-btn" data-ap-close="anki-change-type-modal">✕</button></div>
          <div class="cards-modal-body">
            <div class="field"><label>Tipo de destino</label><select id="anki-change-type-target"></select></div>
            <div id="anki-change-type-map"></div>
          </div>
          <div class="cards-modal-foot"><button type="button" class="btn-secondary" data-ap-close="anki-change-type-modal">Cancelar</button><button type="button" class="btn-primary" id="anki-change-type-save">Mudar tipo</button></div>
        </div>
      </div>

      <div id="anki-notetypes-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box cards-modal-lg">
          <div class="cards-modal-head"><div><h2>🧩 Tipos de nota</h2><p class="sub">Campos, templates e CSS, sem alterar o visual padrão do Study.</p></div><button type="button" class="icon-btn" data-ap-close="anki-notetypes-modal">✕</button></div>
          <div class="cards-modal-body">
            <div class="anki-nt-toolbar"><button type="button" class="btn-primary" id="anki-nt-add">＋ Adicionar</button></div>
            <div id="anki-nt-list"></div>
          </div>
          <div class="cards-modal-foot"><button type="button" class="btn-primary" data-ap-close="anki-notetypes-modal">Fechar</button></div>
        </div>
      </div>

      <div id="anki-nt-edit-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box anki-nt-editor-box">
          <div class="cards-modal-head"><div><h2>🧩 Editar tipo de nota</h2><p class="sub" id="anki-nt-edit-sub"></p></div><button type="button" class="icon-btn" data-ap-close="anki-nt-edit-modal">✕</button></div>
          <div class="cards-modal-body">
            <div class="field"><label>Nome</label><input id="anki-nt-name" type="text"></div>
            <h3 class="anki-section-title">Campos</h3><div id="anki-nt-fields"></div><button type="button" class="btn-secondary" id="anki-nt-add-field">＋ Campo</button>
            <h3 class="anki-section-title">Templates / cartões</h3><div id="anki-nt-templates"></div><button type="button" class="btn-secondary" id="anki-nt-add-template">＋ Template</button>
            <h3 class="anki-section-title">CSS</h3><textarea id="anki-nt-css" class="anki-code-area" spellcheck="false"></textarea>
          </div>
          <div class="cards-modal-foot"><button type="button" class="btn-secondary" data-ap-close="anki-nt-edit-modal">Cancelar</button><button type="button" class="btn-primary" id="anki-nt-save">Salvar tipo</button></div>
        </div>
      </div>

      <div id="anki-check-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box cards-modal-lg">
          <div class="cards-modal-head"><div><h2>🛠 Verificar coleção</h2><p class="sub">Banco, mídia, notas/cards e resíduos de histórico.</p></div><button type="button" class="icon-btn" data-ap-close="anki-check-modal">✕</button></div>
          <div class="cards-modal-body" id="anki-check-body"></div>
          <div class="cards-modal-foot"><button type="button" class="btn-secondary" id="anki-check-safe">🩹 Reparos seguros</button><button type="button" class="btn-secondary" id="anki-check-empty">🧹 Cards vazios</button><span style="flex:1"></span><button type="button" class="btn-primary" data-ap-close="anki-check-modal">Fechar</button></div>
        </div>
      </div>

      <div id="anki-whiteboard-modal" class="cards-modal anki-product-modal" style="display:none">
        <div class="cards-modal-box anki-whiteboard-box">
          <div class="cards-modal-head"><div><h2>✍ Quadro</h2><p class="sub">Rascunho temporário da revisão. Não altera o card.</p></div><button type="button" class="icon-btn" data-ap-close="anki-whiteboard-modal">✕</button></div>
          <div class="cards-modal-body"><canvas id="anki-whiteboard"></canvas></div>
          <div class="cards-modal-foot"><button type="button" class="btn-secondary" id="anki-whiteboard-undo">↶ Desfazer</button><button type="button" class="btn-secondary" id="anki-whiteboard-redo">↷ Refazer</button><button type="button" class="btn-secondary" id="anki-whiteboard-clear">Limpar</button><span style="flex:1"></span><button type="button" class="btn-primary" data-ap-close="anki-whiteboard-modal">Fechar</button></div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    document.querySelectorAll('[data-ap-close]').forEach(b=>b.addEventListener('click',()=>{const m=document.getElementById(b.dataset.apClose);if(m)m.style.display='none';}));
    this._bindBrowser();
    this._bindNoteEdit();
    this._bindChangeType();
    this._bindNotetypes();
    this._bindCheck();
    this._bindWhiteboard();
  },

  _installMenu(){
    const menu=document.getElementById('cards-more-menu');if(!menu)return;
    const insert=(id,label,fn,beforeId)=>{
      if(document.getElementById(id))return;
      const b=document.createElement('button');b.type='button';b.id=id;b.setAttribute('role','menuitem');b.textContent=label;b.addEventListener('click',()=>{menu.classList.remove('open');fn();});
      const before=beforeId&&document.getElementById(beforeId);if(before&&before.parentNode===menu)menu.insertBefore(b,before);else menu.appendChild(b);
    };
    insert('cards-browser-btn','🗃️ Navegador de notas',()=>this.openBrowser(),'cards-stats-btn');
    insert('cards-shared-decks-btn','🌐 Baralhos compartilhados',()=>this.openSharedDecks(),'cards-import-btn');
    insert('cards-notetypes-btn','🧩 Tipos de nota',()=>this.openNotetypes(),'cards-import-btn');
    insert('cards-check-collection-btn','🛠 Verificar coleção',()=>this.openCheck(),'cards-empty-btn');
  },

  openSharedDecks(){
    const url='https://ankiweb.net/shared/decks/';
    const w=window.open(url,'_blank','noopener,noreferrer');
    if(!w)showToast('Permita abrir nova aba para acessar os baralhos compartilhados do AnkiWeb.');
    else showToast('Baixe o .apkg no AnkiWeb e use ↑ Importar no Study.');
  },

  _cardsForNote(id){ const k=String(id),cards=AnkiParity._scopeCards?AnkiParity._scopeCards():DB.getCards();return cards.filter(c=>this.noteId(c)===k); },
  _typeFor(note){ return AnkiParity.noteTypes().find(t=>String(t.id)===String(note&&note.notetypeId))||null; },
  _sortField(note,nt){ const f=(nt&&nt.fields||[])[Number(nt&&nt.sortf)||0]||(nt&&nt.fields||[])[0];return this.plain(note&&note.fields&&f?note.fields[f.name]:''); },

  _browserRows(){
    this.ensure();
    const st=this.browser,types=AnkiParity.noteTypes(),typeMap=new Map(types.map(t=>[String(t.id),t]));
    let rows=AnkiParity.notes().map(note=>{
      const cards=this._cardsForNote(note.id),nt=typeMap.get(String(note.notetypeId));
      const tags=(note.tags||[]).slice(),marked=tags.some(t=>String(t).toLowerCase()==='marked')||cards.some(c=>c.favorito);
      return {note,cards,nt,field:this._sortField(note,nt),tags,flag:cards.reduce((m,c)=>Math.max(m,Number(c.flag)||0),0),suspended:cards.some(c=>c.suspenso),marked};
    });
    const rawQuery=st.query.trim(),q=rawQuery.toLowerCase();
    if(q)rows=rows.filter(r=>{
      if(/[\w-]+:/.test(rawQuery)&&typeof AnkiParity.filteredSearchMatches==='function'){
        return r.cards.some(c=>{try{return AnkiParity.filteredSearchMatches(c,rawQuery);}catch(_){return false;}});
      }
      return [r.field,r.nt&&r.nt.name,(r.tags||[]).join(' '),...Object.values(r.note.fields||{}).map(x=>this.plain(x))].join(' ').toLowerCase().includes(q);
    });
    if(st.tag)rows=rows.filter(r=>r.tags.some(t=>String(t)===st.tag||String(t).startsWith(st.tag+'::')));
    if(st.flag!=='')rows=rows.filter(r=>Number(r.flag)===Number(st.flag));
    if(st.suspended==='yes')rows=rows.filter(r=>r.suspended);else if(st.suspended==='no')rows=rows.filter(r=>!r.suspended);
    if(st.marked)rows=rows.filter(r=>r.marked);
    const cmp=(a,b)=>{
      if(st.sort==='notetype')return String(a.nt&&a.nt.name||'').localeCompare(String(b.nt&&b.nt.name||''),'pt-BR');
      if(st.sort==='cards')return b.cards.length-a.cards.length;
      if(st.sort==='tags')return a.tags.join(' ').localeCompare(b.tags.join(' '),'pt-BR');
      if(st.sort==='updated')return String(b.note.updatedAt||'').localeCompare(String(a.note.updatedAt||''));
      return a.field.localeCompare(b.field,'pt-BR',{numeric:true,sensitivity:'base'});
    };
    return rows.sort(cmp);
  },

  openBrowser(){
    this.ensure();
    this.browser.page=0;this.browser.selected.clear();
    const tags=[...new Set(AnkiParity.notes().flatMap(n=>n.tags||[]).map(String).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const sel=document.getElementById('anki-browser-tag');sel.innerHTML='<option value="">Todas as tags</option>'+tags.map(t=>'<option value="'+this.esc(t)+'">'+this.esc(t)+'</option>').join('');
    document.getElementById('anki-browser-search').value=this.browser.query;
    document.getElementById('anki-browser-sort').value=this.browser.sort;
    document.getElementById('anki-browser-flag').value=this.browser.flag;
    document.getElementById('anki-browser-suspended').value=this.browser.suspended;
    document.getElementById('anki-browser-marked').checked=this.browser.marked;
    document.getElementById('anki-browser-modal').style.display='flex';
    this.renderBrowser();
  },

  renderBrowser(){
    const rows=this._browserRows(),end=Math.min(rows.length,(this.browser.page+1)*this.PAGE),shown=rows.slice(0,end),list=document.getElementById('anki-browser-list');
    document.getElementById('anki-browser-summary').textContent=rows.length.toLocaleString('pt-BR')+' nota(s) exibida(s)';
    list.innerHTML=shown.map(r=>{
      const id=String(r.note.id),sel=this.browser.selected.has(id),tags=r.tags.length?r.tags.join(' '):'—';
      return '<div class="anki-browser-row '+(sel?'is-sel':'')+'" data-note="'+this.esc(id)+'">'+
        '<label><input class="anki-browser-row-check" type="checkbox" '+(sel?'checked':'')+'></label>'+
        '<button type="button" class="anki-browser-field" data-note-open="'+this.esc(id)+'">'+this.esc(r.field||'(vazio)')+'</button>'+
        '<span class="anki-browser-nt">'+this.esc(r.nt&&r.nt.name||'(tipo ausente)')+'</span>'+
        '<span class="anki-browser-count">'+r.cards.length+'</span>'+
        '<span class="anki-browser-tags" title="'+this.esc(tags)+'">'+this.esc(tags)+'</span>'+
        (r.suspended?'<span class="anki-browser-state" title="Há card suspenso">⏸</span>':'')+(r.marked?'<span class="anki-browser-state" title="Marcada">★</span>':'')+
      '</div>';
    }).join('')||'<div class="empty-state"><h3>Nenhuma nota encontrada</h3><p>Ajuste os filtros acima.</p></div>';
    const more=document.getElementById('anki-browser-more');
    more.innerHTML=end<rows.length?'<button type="button" class="btn-secondary" id="anki-browser-more-btn">Carregar mais '+Math.min(this.PAGE,rows.length-end)+'</button>':'';
    const mb=document.getElementById('anki-browser-more-btn');if(mb)mb.addEventListener('click',()=>{this.browser.page++;this.renderBrowser();});
    this._syncBrowserBulk(rows);
  },

  _syncBrowserBulk(rows){
    const n=this.browser.selected.size,all=n&&n===rows.length;
    const sa=document.getElementById('anki-browser-select-all');sa.checked=!!all;sa.indeterminate=n>0&&!all;
    document.getElementById('anki-browser-selected').textContent=n?n+' selecionada(s)':'';
    ['anki-browser-tags-btn','anki-browser-type-btn','anki-browser-suspend-btn','anki-browser-flag-btn','anki-browser-actions-btn','anki-browser-delete-btn'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!n;});
  },

  _bindBrowser(){
    const by=id=>document.getElementById(id);
    by('anki-browser-search').addEventListener('input',e=>{this.browser.query=e.target.value;this.browser.page=0;this.browser.selected.clear();this.renderBrowser();});
    by('anki-browser-sort').addEventListener('change',e=>{this.browser.sort=e.target.value;this.browser.page=0;this.renderBrowser();});
    by('anki-browser-tag').addEventListener('change',e=>{this.browser.tag=e.target.value;this.browser.page=0;this.browser.selected.clear();this.renderBrowser();});
    by('anki-browser-flag').addEventListener('change',e=>{this.browser.flag=e.target.value;this.browser.page=0;this.browser.selected.clear();this.renderBrowser();});
    by('anki-browser-suspended').addEventListener('change',e=>{this.browser.suspended=e.target.value;this.browser.page=0;this.browser.selected.clear();this.renderBrowser();});
    by('anki-browser-marked').addEventListener('change',e=>{this.browser.marked=e.target.checked;this.browser.page=0;this.browser.selected.clear();this.renderBrowser();});
    by('anki-browser-list').addEventListener('change',e=>{const row=e.target.closest('.anki-browser-row');if(!row||!e.target.classList.contains('anki-browser-row-check'))return;const id=row.dataset.note;if(e.target.checked)this.browser.selected.add(id);else this.browser.selected.delete(id);this.renderBrowser();});
    by('anki-browser-list').addEventListener('click',e=>{const open=e.target.closest('[data-note-open]');if(open){this.previewNote(open.dataset.note);}});
    by('anki-browser-list').addEventListener('dblclick',e=>{const row=e.target.closest('.anki-browser-row');if(row)this.openNoteEditor(row.dataset.note);});
    by('anki-browser-select-all').addEventListener('change',e=>{const rows=this._browserRows();this.browser.selected.clear();if(e.target.checked)rows.forEach(r=>this.browser.selected.add(String(r.note.id)));this.renderBrowser();});
    by('anki-browser-tags-btn').addEventListener('click',()=>this.editTags([...this.browser.selected]));
    by('anki-browser-type-btn').addEventListener('click',()=>this.openChangeType([...this.browser.selected]));
    by('anki-browser-suspend-btn').addEventListener('click',()=>this.toggleSuspend([...this.browser.selected]));
    by('anki-browser-flag-btn').addEventListener('click',()=>this.bulkFlag([...this.browser.selected]));
    by('anki-browser-actions-btn').addEventListener('click',()=>this.browserBulkActions([...this.browser.selected]));
    by('anki-browser-delete-btn').addEventListener('click',()=>this.deleteNotes([...this.browser.selected]));
    by('anki-browser-notetypes').addEventListener('click',()=>this.openNotetypes());
  },

  previewNote(id){
    const note=AnkiParity.getNote(id),box=document.getElementById('anki-browser-preview');if(!note){box.innerHTML='<p class="hint">Nota não encontrada.</p>';return;}
    const nt=this._typeFor(note),cards=this._cardsForNote(id),card=cards[0]||{id:'preview',ankiTemplateOrd:0,clozeOrd:1,deckId:null};
    let front='',back='';try{front=AnkiParity.renderTemplate(nt,note,Number(card.ankiTemplateOrd)||0,'question',card,'');back=AnkiParity.renderTemplate(nt,note,Number(card.ankiTemplateOrd)||0,'answer',card,front);}catch(e){front='Erro de template';back=this.esc(e.message||e);}
    const frame=(html,side)=>typeof AnkiRuntime!=='undefined'?AnkiRuntime.renderFrame(nt,html,side,card,true,note,CardsConfig.forDeck(card.deckId)):'<div class="cards-face">'+_sanCard(html)+'</div>';
    box.innerHTML='<div class="anki-preview-head"><strong>'+this.esc(nt&&nt.name||'Tipo de nota')+'</strong><span>'+cards.length+' card(s)</span></div>'+
      '<div class="anki-preview-label">Frente</div>'+frame(front,'question')+'<div class="anki-preview-label">Verso</div>'+frame(back,'answer')+
      '<div class="anki-preview-actions"><button type="button" class="btn-primary" id="anki-preview-edit">✎ Editar nota</button><button type="button" class="btn-secondary" id="anki-preview-type">🧩 Mudar tipo</button></div>';
    document.getElementById('anki-preview-edit').addEventListener('click',()=>this.openNoteEditor(id));
    document.getElementById('anki-preview-type').addEventListener('click',()=>this.openChangeType([String(id)]));
  },

  openNoteEditor(id){
    const note=AnkiParity.getNote(id);if(!note)return;const nt=this._typeFor(note);this._editingNoteId=String(id);
    document.getElementById('anki-note-edit-title').textContent='✎ Editar nota';
    document.getElementById('anki-note-edit-sub').textContent=(nt&&nt.name||'Tipo de nota')+' · '+this._cardsForNote(id).length+' card(s)';
    const body=document.getElementById('anki-note-edit-body');
    body.innerHTML=(nt&&nt.fields||[]).map((f,i)=>'<div class="field"><label>'+this.esc(f.name)+'</label><textarea class="anki-note-field anki-code-area" data-field="'+this.esc(f.name)+'" rows="4">'+this.esc(note.fields&&note.fields[f.name]||'')+'</textarea></div>').join('')+
      '<div class="field"><label>Tags</label><input id="anki-note-tags" type="text" value="'+this.esc((note.tags||[]).join(' '))+'" placeholder="tag1 tag2::subtag"></div>';
    document.getElementById('anki-note-edit-modal').style.display='flex';
  },

  _bindNoteEdit(){
    document.getElementById('anki-note-save').addEventListener('click',()=>{
      const note=AnkiParity.getNote(this._editingNoteId);if(!note)return;const nt=this._typeFor(note),fields={};
      document.querySelectorAll('#anki-note-edit-body .anki-note-field').forEach(t=>fields[t.dataset.field]=t.value);
      const tags=String(document.getElementById('anki-note-tags').value||'').split(/\s+/).filter(Boolean);
      const saved=AnkiParity.saveNote(Object.assign({},note,{fields,tags}));this.reconcileNote(saved,nt);
      document.getElementById('anki-note-edit-modal').style.display='none';this.renderBrowser();this.previewNote(saved.id);CardsScreen.render();showToast('Nota atualizada ✓');
    });
    document.getElementById('anki-note-change-type').addEventListener('click',()=>{if(this._editingNoteId)this.openChangeType([this._editingNoteId]);});
  },

  reconcileNote(note,nt){
    if(!note||!nt)return {created:0,updated:0,emptied:0};
    const existing=this._cardsForNote(note.id),planId=note._planId||(existing[0]&&existing[0]._planId)||
      (existing[0]&&window.StudyGlobalScope&&StudyGlobalScope.sourcePlanForCard?StudyGlobalScope.sourcePlanForCard(existing[0].id):null),
      sourceDecks=planId&&DB.getDecksForPlan?DB.getDecksForPlan(planId):(AnkiParity._scopeDecks?AnkiParity._scopeDecks():DB.getDecks()),
      deckId=(existing.find(c=>c.deckId)||{}).deckId||(sourceDecks[0]||{}).id||null;
    const desired=[];let created=0,updated=0,emptied=0;
    if(nt.kind==='cloze'){
      const ords=new Set();Object.values(note.fields||{}).forEach(v=>AnkiParity.clozeOrdinals(v).forEach(o=>ords.add(o)));
      [...ords].sort((a,b)=>a-b).forEach(o=>desired.push({key:'c'+o,ord:o-1,cloze:o,tmpl:0}));
    }else{
      (nt.templates||[]).forEach((t,ord)=>{const probe={noteId:note.id,ankiNoteId:note.id,notetypeId:nt.id,ankiTemplateOrd:ord,deckId},gera=AnkiParity.templateGeraCard?AnkiParity.templateGeraCard(nt,note,ord):AnkiParity._fieldNonempty(AnkiParity.renderTemplate(nt,note,ord,'question',probe,''));if(gera)desired.push({key:'t'+ord,ord,tmpl:ord});});
    }
    const used=new Set();
    for(const d of desired){
      let card=existing.find(c=>nt.kind==='cloze'?Number(c.clozeOrd||0)===d.cloze:Number(c.ankiTemplateOrd||0)===d.ord);
      if(!card){
        const data={deckId,noteId:note.id,ankiNoteId:note.id,notetypeId:nt.id,kind:nt.kind==='cloze'?'cloze':'basic',template:nt.kind==='cloze'?'cloze:'+d.cloze:(d.ord===1?'reverse':'forward'),clozeOrd:d.cloze||null,ankiTemplateOrd:d.ord,frente:'',verso:''};
        card=planId&&DB.addCardForPlan?DB.addCardForPlan(planId,data):DB.addCard(data);created++;
      }
      used.add(String(card.id));
      const q=AnkiParity.renderTemplate(nt,note,d.tmpl,'question',card,''),a=AnkiParity.renderTemplate(nt,note,d.tmpl,'answer',card,q);
      DB.updateCard(card.id,{noteId:note.id,ankiNoteId:note.id,notetypeId:nt.id,ankiTemplateOrd:d.ord,kind:nt.kind==='cloze'?'cloze':'basic',template:nt.kind==='cloze'?'cloze:'+d.cloze:(d.ord===1?'reverse':'forward'),clozeOrd:d.cloze||null,frente:q,verso:a});updated++;
    }
    existing.forEach(c=>{if(!used.has(String(c.id))){DB.updateCard(c.id,{notetypeId:nt.id,frente:'',verso:''});emptied++;}});
    CardEngine.invalidateDueCache();return {created,updated,emptied};
  },

  openChangeType(ids){
    ids=(ids||[]).map(String).filter(Boolean);if(!ids.length)return;
    const notes=ids.map(id=>AnkiParity.getNote(id)).filter(Boolean),origins=new Set(notes.map(n=>String(n._planId||'')).filter(Boolean));
    if(origins.size>1){showToast('Mude o tipo de notas de um planejamento por vez.');return;}
    this._changeTypeIds=ids;this._changeTypePlanId=origins.size?[...origins][0]:null;
    const types=(this._changeTypePlanId&&window.StudyGlobalScope&&StudyGlobalScope._entityRows)
      ? StudyGlobalScope._entityRows(this._changeTypePlanId,'notetype') : AnkiParity.noteTypes(),
      sel=document.getElementById('anki-change-type-target');sel.innerHTML=types.map(t=>'<option value="'+this.esc(t.id)+'">'+this.esc(t.name)+'</option>').join('');
    const first=AnkiParity.getNote(ids[0]);if(first)sel.value=String(first.notetypeId);
    const render=()=>this._renderTypeMap(types.find(t=>String(t.id)===String(sel.value)));sel.onchange=render;render();
    document.getElementById('anki-change-type-modal').style.display='flex';
  },

  _renderTypeMap(target){
    const box=document.getElementById('anki-change-type-map');if(!target){box.innerHTML='';return;}
    const source=AnkiParity.getNote((this._changeTypeIds||[])[0]),srcNt=this._typeFor(source),srcFields=(srcNt&&srcNt.fields||[]).map(f=>f.name);
    box.innerHTML='<p class="hint">Mapeamento dos campos da primeira nota. Em seleção mista, nomes iguais têm prioridade e a posição é usada como fallback.</p>'+
      (target.fields||[]).map((f,i)=>'<div class="field"><label>'+this.esc(f.name)+'</label><select class="anki-type-map" data-target="'+this.esc(f.name)+'"><option value="">— vazio —</option>'+
        srcFields.map((n,j)=>'<option value="'+this.esc(n)+'" '+((n===f.name||(!srcFields.includes(f.name)&&j===i))?'selected':'')+'>'+this.esc(n)+'</option>').join('')+'</select></div>').join('');
  },

  _bindChangeType(){
    document.getElementById('anki-change-type-save').addEventListener('click',()=>{
      const target=AnkiParity.getNotetype(document.getElementById('anki-change-type-target').value);if(!target)return;
      const map={};document.querySelectorAll('#anki-change-type-map .anki-type-map').forEach(s=>map[s.dataset.target]=s.value);
      let changed=0;
      for(const id of this._changeTypeIds||[]){
        const note=AnkiParity.getNote(id);if(!note)continue;const srcNt=this._typeFor(note),srcNames=(srcNt&&srcNt.fields||[]).map(f=>f.name),fields={};
        (target.fields||[]).forEach((f,i)=>{const explicit=map[f.name],src=explicit||(note.fields&&Object.prototype.hasOwnProperty.call(note.fields,f.name)?f.name:srcNames[i]);fields[f.name]=src&&note.fields?note.fields[src]||'':'';});
        if(target.kind==='cloze'&&!Object.values(fields).some(v=>/\{\{c\d+(?:,\d+)*::/.test(String(v||'')))){showToast('Para mudar para Cloze, a nota precisa conter ao menos uma omissão {{c1::…}}.');return;}
        if(Number(target.originalStockKind)===6||target.stockKind==='image_occlusion'){
          const oc=(target.fields||[]).find(f=>Number(f.tag)===0),im=(target.fields||[]).find(f=>Number(f.tag)===1);
          if(!oc||!im||!/image-occlusion:/.test(String(fields[oc.name]||''))||!AnkiParity._fieldNonempty(fields[im.name])){showToast('Use o editor de Oclusão de Imagem para criar ou converter este tipo de nota.');return;}
        }
        const saved=AnkiParity.saveNote(Object.assign({},note,{notetypeId:target.id,fields}));this.reconcileNote(saved,target);changed++;
      }
      document.getElementById('anki-change-type-modal').style.display='none';document.getElementById('anki-note-edit-modal').style.display='none';this.renderBrowser();CardsScreen.render();showToast(changed+' nota(s) alterada(s) ✓');
    });
  },

  editTags(ids){
    if(!ids.length)return;UI.prompt([{key:'add',label:'Adicionar tags',type:'text',value:'',hint:'Separe por espaço.'},{key:'remove',label:'Remover tags',type:'text',value:'',hint:'Separe por espaço.'}],{title:'🏷 Editar etiquetas',okText:'Aplicar'}).then(v=>{
      if(!v)return;const add=String(v.add||'').split(/\s+/).filter(Boolean),rem=new Set(String(v.remove||'').split(/\s+/).filter(Boolean));
      ids.forEach(id=>{const n=AnkiParity.getNote(id);if(!n)return;n.tags=[...new Set([...(n.tags||[]),...add])].filter(t=>!rem.has(t));AnkiParity.saveNote(n);});
      this.openBrowser();showToast('Tags atualizadas ✓');
    });
  },

  toggleSuspend(ids){
    const cards=ids.flatMap(id=>this._cardsForNote(id)),shouldSuspend=cards.some(c=>!c.suspenso);
    cards.forEach(c=>shouldSuspend?AnkiParity.suspendCard(c.id):DB.updateCard(c.id,{suspenso:false}));
    CardEngine.invalidateDueCache();this.renderBrowser();CardsScreen.render();showToast(shouldSuspend?'Notas suspensas ✓':'Notas reativadas ✓');
  },

  bulkFlag(ids){
    UI.prompt([{key:'flag',label:'Bandeira',type:'select',value:'0',options:[0,1,2,3,4,5,6,7].map(n=>({value:String(n),label:n===0?'Sem bandeira':(['','Vermelha','Laranja','Verde','Azul','Rosa','Turquesa','Roxa'][n])}))}],{title:'🚩 Definir bandeira',okText:'Aplicar'}).then(v=>{
      if(!v)return;ids.flatMap(id=>this._cardsForNote(id)).forEach(c=>DB.setFlag(c.id,Number(v.flag)||0));this.renderBrowser();CardsScreen.render();showToast('Bandeiras atualizadas ✓');
    });
  },

  browserBulkActions(ids){
    if(!ids.length)return;
    UI.prompt([{key:'action',label:'Ação',type:'select',value:'mark',options:[
      {value:'mark',label:'★ Marcar/desmarcar notas'},{value:'deck',label:'📁 Mover para baralho'},
      {value:'due',label:'📅 Definir vencimento'},{value:'forget',label:'↺ Esquecer / tornar novos'},
      {value:'reposition',label:'🔢 Reposicionar cards novos'},{value:'replace',label:'🔁 Localizar e substituir nos campos'}
    ]}],{title:'⋯ Ações do navegador',okText:'Continuar'}).then(v=>{
      if(!v)return;
      if(v.action==='mark')this.bulkMark(ids);
      else if(v.action==='deck')this.bulkMoveDeck(ids);
      else if(v.action==='due')this.bulkSetDue(ids);
      else if(v.action==='forget')this.bulkForget(ids);
      else if(v.action==='reposition')this.bulkReposition(ids);
      else if(v.action==='replace')this.bulkFindReplace(ids);
    });
  },

  bulkMark(ids){
    const notes=ids.map(id=>AnkiParity.getNote(id)).filter(Boolean);
    const shouldMark=notes.some(n=>!(n.tags||[]).some(t=>String(t).toLowerCase()==='marked'));
    notes.forEach(n=>{
      let tags=(n.tags||[]).filter(t=>String(t).toLowerCase()!=='marked');
      if(shouldMark)tags.push('marked');
      AnkiParity.saveNote(Object.assign({},n,{tags:[...new Set(tags)]}));
    });
    this.renderBrowser();CardsScreen.render();showToast(shouldMark?'Notas marcadas ✓':'Marcação removida ✓');
  },

  bulkMoveDeck(ids){
    const cards=ids.flatMap(id=>this._cardsForNote(id)),origins=new Set(cards.map(c=>String(c._planId||
      (window.StudyGlobalScope&&StudyGlobalScope.sourcePlanForCard?StudyGlobalScope.sourcePlanForCard(c.id):'')||'')).filter(Boolean));
    if(origins.size>1){showToast('Para mover em lote, selecione notas do mesmo planejamento de origem.');return;}
    const pid=origins.size?[...origins][0]:null,decks=(pid&&DB.getDecksForPlan?DB.getDecksForPlan(pid):DB.getDecks()).filter(d=>!(AnkiParity.isFilteredDeck&&AnkiParity.isFilteredDeck(d)));
    if(!decks.length){showToast('Crie um baralho antes de mover.');return;}
    UI.prompt([{key:'deck',label:'Baralho de destino',type:'select',value:String(decks[0].id),options:decks.map(d=>({value:String(d.id),label:d.nome}))}],{title:'📁 Mover cards',okText:'Mover'}).then(v=>{
      if(!v)return;let n=0;
      ids.flatMap(id=>this._cardsForNote(id)).forEach(c=>{
        if(c.filteredDeckId||c.originalDeckId){DB.updateCard(c.id,{originalDeckId:v.deck});}
        else DB.updateCard(c.id,{deckId:v.deck});
        n++;
      });
      CardEngine.invalidateDueCache();this.renderBrowser();CardsScreen.render();showToast(n+' card(s) movido(s) ✓');
    });
  },

  bulkSetDue(ids){
    UI.prompt([{key:'days',label:'Vencer daqui a quantos dias?',type:'number',value:'1',hint:'0 = hoje. Aplica a todos os cards das notas selecionadas.'}],{title:'📅 Definir vencimento',okText:'Agendar'}).then(v=>{
      if(!v)return;const days=Math.max(0,Math.round(Number(v.days)||0));let n=0;
      ids.flatMap(id=>this._cardsForNote(id)).forEach(c=>{DB.setDueDays(c.id,days);n++;});
      CardEngine.invalidateDueCache();this.renderBrowser();CardsScreen.render();showToast(n+' card(s) reagendado(s) ✓');
    });
  },

  bulkForget(ids){
    const cards=ids.flatMap(id=>this._cardsForNote(id));UI.confirm('Esquecer '+cards.length+' card(s)? Eles voltam ao estado de novos; o conteúdo das notas é preservado.',{title:'↺ Esquecer cards',okText:'Esquecer',danger:true}).then(ok=>{
      if(!ok)return;cards.forEach(c=>DB.forgetCard(c.id));CardEngine.invalidateDueCache();this.renderBrowser();CardsScreen.render();showToast(cards.length+' card(s) voltaram a ser novos ✓');
    });
  },

  bulkReposition(ids){
    const cards=ids.flatMap(id=>this._cardsForNote(id)).filter(c=>(c.phase||'new')==='new');
    if(!cards.length){showToast('Nenhum card novo na seleção.');return;}
    UI.prompt([{key:'start',label:'Posição inicial',type:'number',value:'1'},{key:'step',label:'Passo',type:'number',value:'1'}],{title:'🔢 Reposicionar novos',okText:'Aplicar'}).then(v=>{
      if(!v)return;const start=Math.max(0,Math.round(Number(v.start)||0)),step=Math.max(1,Math.round(Number(v.step)||1));
      cards.sort((a,b)=>(Number(a.posicaoNova)||0)-(Number(b.posicaoNova)||0)||String(a.id).localeCompare(String(b.id))).forEach((c,i)=>DB.updateCard(c.id,{posicaoNova:start+i*step,ankiDue:start+i*step}));
      CardEngine.invalidateDueCache();this.renderBrowser();CardsScreen.render();showToast(cards.length+' card(s) reposicionado(s) ✓');
    });
  },

  bulkFindReplace(ids){
    UI.prompt([{key:'find',label:'Localizar',type:'text',value:''},{key:'replace',label:'Substituir por',type:'text',value:''}],{title:'🔁 Localizar e substituir',okText:'Substituir'}).then(v=>{
      if(!v||!String(v.find||''))return;const needle=String(v.find),replacement=String(v.replace||'');let notesChanged=0,fieldsChanged=0;
      ids.forEach(id=>{const note=AnkiParity.getNote(id);if(!note)return;const fields=Object.assign({},note.fields||{});let changed=false;
        Object.keys(fields).forEach(k=>{const before=String(fields[k]||'');if(before.includes(needle)){fields[k]=before.split(needle).join(replacement);fieldsChanged++;changed=true;}});
        if(changed){const saved=AnkiParity.saveNote(Object.assign({},note,{fields}));this.reconcileNote(saved,this._typeFor(saved));notesChanged++;}
      });
      this.renderBrowser();CardsScreen.render();showToast(notesChanged+' nota(s), '+fieldsChanged+' campo(s) alterado(s) ✓');
    });
  },

  deleteNotes(ids){
    if(!ids.length)return;UI.confirm('Excluir '+ids.length+' nota(s) e todos os seus cards/históricos? Não há como desfazer.',{title:'🗑 Excluir notas',okText:'Excluir',danger:true}).then(ok=>{
      if(!ok)return;ids.forEach(id=>{const cards=this._cardsForNote(id);cards.forEach(c=>DB.deleteNoteByCard(c.id));try{localStorage.removeItem(AnkiParity._entityKey('note',id));}catch(_){};});
      this.browser.selected.clear();this.renderBrowser();CardsScreen.render();showToast('Notas excluídas');
    });
  },

  openNotetypes(){ this.ensure();document.getElementById('anki-notetypes-modal').style.display='flex';this.renderNotetypes(); },
  renderNotetypes(){
    const notes=AnkiParity.notes(),list=document.getElementById('anki-nt-list');
    list.innerHTML=AnkiParity.noteTypes().map(nt=>{const n=notes.filter(x=>String(x.notetypeId)===String(nt.id)).length;return '<div class="anki-nt-row" data-nt="'+this.esc(nt.id)+'"><div><strong>'+this.esc(nt.name)+'</strong><span>'+n+' nota(s) · '+(nt.fields||[]).length+' campo(s) · '+(nt.templates||[]).length+' template(s)</span></div><div><button class="icon-btn anki-nt-edit" title="Editar">✎</button><button class="icon-btn anki-nt-copy" title="Duplicar">⧉</button><button class="icon-btn danger anki-nt-delete" title="Excluir">×</button></div></div>';}).join('')||'<p class="hint">Nenhum tipo de nota.</p>';
  },

  _bindNotetypes(){
    document.getElementById('anki-nt-add').addEventListener('click',()=>{
      UI.prompt([{key:'base',label:'Base',type:'select',value:'basic',options:[
        {value:'basic',label:'Básico'},{value:'basic_reversed',label:'Básico (e cartão invertido)'},{value:'basic_optional_reversed',label:'Básico (cartão invertido opcional)'},{value:'typing',label:'Básico (digite a resposta)'},{value:'cloze',label:'Omissão de palavras'},{value:'image_occlusion',label:'Oclusão de imagem'}
      ]},{key:'name',label:'Nome',type:'text',value:'Novo tipo de nota'}],{title:'＋ Tipo de nota',okText:'Criar'}).then(v=>{
        if(!v)return;const def=JSON.parse(JSON.stringify(AnkiParity._stockNotetypeDef(v.base)));def.id=AnkiParity._allocId();def.name=String(v.name||'Novo tipo de nota').trim()||'Novo tipo de nota';def.sourceStockKind=def.stockKind;delete def.stockKind;AnkiParity.saveNotetype(def);this.renderNotetypes();showToast('Tipo criado ✓');
      });
    });
    document.getElementById('anki-nt-list').addEventListener('click',e=>{
      const row=e.target.closest('.anki-nt-row');if(!row)return;const nt=AnkiParity.getNotetype(row.dataset.nt);if(!nt)return;
      if(e.target.closest('.anki-nt-edit'))this.openNotetypeEditor(nt.id);
      else if(e.target.closest('.anki-nt-copy')){const x=JSON.parse(JSON.stringify(nt));x.id=AnkiParity._allocId();x.name=nt.name+' copy';delete x.stockKind;AnkiParity.saveNotetype(x);this.renderNotetypes();showToast('Tipo duplicado ✓');}
      else if(e.target.closest('.anki-nt-delete'))this.deleteNotetype(nt.id);
    });
    document.getElementById('anki-nt-add-field').addEventListener('click',()=>this._appendFieldRow('',null));
    document.getElementById('anki-nt-add-template').addEventListener('click',()=>this._appendTemplateRow({name:'Card '+(document.querySelectorAll('#anki-nt-templates .anki-template-editor').length+1),qfmt:'',afmt:'{{FrontSide}}'},null));
    document.getElementById('anki-nt-fields').addEventListener('click',e=>this._moveOrDelete(e,'.anki-field-row'));
    document.getElementById('anki-nt-templates').addEventListener('click',e=>this._moveOrDelete(e,'.anki-template-editor'));
    document.getElementById('anki-nt-save').addEventListener('click',()=>this.saveNotetypeEditor());
  },

  _moveOrDelete(e,selector){
    const row=e.target.closest(selector);if(!row)return;const parent=row.parentNode;
    if(e.target.closest('[data-move="up"]')&&row.previousElementSibling)parent.insertBefore(row,row.previousElementSibling);
    else if(e.target.closest('[data-move="down"]')&&row.nextElementSibling)parent.insertBefore(row.nextElementSibling,row);
    else if(e.target.closest('[data-remove]'))row.remove();
  },

  openNotetypeEditor(id){
    const nt=AnkiParity.getNotetype(id);if(!nt)return;this._editingNtId=String(id);this._editingNtOriginal=JSON.parse(JSON.stringify(nt));
    document.getElementById('anki-nt-edit-sub').textContent=(AnkiParity.notes().filter(n=>String(n.notetypeId)===String(id)).length)+' nota(s) usam este tipo';
    document.getElementById('anki-nt-name').value=nt.name||'';
    const fb=document.getElementById('anki-nt-fields');fb.innerHTML='';(nt.fields||[]).forEach(f=>this._appendFieldRow(f.name,f.name));
    const tb=document.getElementById('anki-nt-templates');tb.innerHTML='';(nt.templates||[]).forEach((t,i)=>this._appendTemplateRow(t,i));
    document.getElementById('anki-nt-css').value=nt.css||'';
    document.getElementById('anki-nt-edit-modal').style.display='flex';
  },

  _appendFieldRow(name,source){
    const d=document.createElement('div');d.className='anki-field-row';d.dataset.source=source==null?'':source;d.innerHTML='<span class="anki-drag-actions"><button type="button" class="icon-btn" data-move="up">↑</button><button type="button" class="icon-btn" data-move="down">↓</button></span><input type="text" value="'+this.esc(name)+'" placeholder="Nome do campo"><button type="button" class="icon-btn danger" data-remove>×</button>';document.getElementById('anki-nt-fields').appendChild(d);
  },

  _appendTemplateRow(t,sourceOrd){
    const d=document.createElement('div');d.className='anki-template-editor';d.dataset.sourceOrd=sourceOrd==null?'':sourceOrd;d.innerHTML='<div class="anki-template-head"><input class="anki-template-name" type="text" value="'+this.esc(t.name||'Card')+'"><span><button type="button" class="icon-btn" data-move="up">↑</button><button type="button" class="icon-btn" data-move="down">↓</button><button type="button" class="icon-btn danger" data-remove>×</button></span></div><label>Frente</label><textarea class="anki-code-area anki-qfmt" spellcheck="false">'+this.esc(t.qfmt||'')+'</textarea><label>Verso</label><textarea class="anki-code-area anki-afmt" spellcheck="false">'+this.esc(t.afmt||'')+'</textarea>';document.getElementById('anki-nt-templates').appendChild(d);
  },

  saveNotetypeEditor(){
    const old=this._editingNtOriginal;if(!old)return;
    const fieldRows=[...document.querySelectorAll('#anki-nt-fields .anki-field-row')],templateRows=[...document.querySelectorAll('#anki-nt-templates .anki-template-editor')];
    const names=fieldRows.map(r=>String(r.querySelector('input').value||'').trim());
    if(!names.length||names.some(x=>!x)){showToast('Todo tipo precisa de ao menos um campo com nome.');return;}
    if(new Set(names.map(x=>x.toLowerCase())).size!==names.length){showToast('Os nomes dos campos precisam ser únicos.');return;}
    if(!templateRows.length){showToast('Todo tipo precisa de ao menos um template.');return;}
    const nt=JSON.parse(JSON.stringify(old));nt.name=String(document.getElementById('anki-nt-name').value||'').trim()||old.name;
    nt.fields=fieldRows.map((r,i)=>{
      const source=r.dataset.source||'',base=(old.fields||[]).find(f=>f.name===source)||{};
      return Object.assign({},JSON.parse(JSON.stringify(base)),{name:names[i],ord:i,_source:source});
    });
    nt.templates=templateRows.map((r,i)=>{
      const sourceOrd=r.dataset.sourceOrd,base=(old.templates||[]).find((t,j)=>String(t.ord==null?j:t.ord)===String(sourceOrd))||{};
      return Object.assign({},JSON.parse(JSON.stringify(base)),{name:String(r.querySelector('.anki-template-name').value||('Card '+(i+1))).trim(),ord:i,qfmt:r.querySelector('.anki-qfmt').value,afmt:r.querySelector('.anki-afmt').value,_sourceOrd:sourceOrd});
    });
    nt.css=document.getElementById('anki-nt-css').value;
    const notes=AnkiParity.notes().filter(n=>String(n.notetypeId)===String(nt.id));
    const removed=(old.fields||[]).filter(f=>!nt.fields.some(nf=>nf._source===f.name));
    const dataLoss=removed.some(f=>notes.some(n=>AnkiParity._fieldNonempty(n.fields&&n.fields[f.name])));
    const proceed=()=>this._applyNotetypeEdit(old,nt,notes);
    if(dataLoss)UI.confirm('Há conteúdo em campo(s) removido(s). Salvar apagará esse conteúdo das notas que usam o tipo.',{title:'⚠ Campo com conteúdo',okText:'Salvar mesmo assim',danger:true}).then(ok=>{if(ok)proceed();});else proceed();
  },

  _applyNotetypeEdit(old,nt,notes){
    const cleanFields=nt.fields.map(({_source,...x})=>x),cleanTemplates=nt.templates.map(({_sourceOrd,...x})=>x),fieldSource=nt.fields.map(x=>x._source),templateSource=nt.templates.map(x=>x._sourceOrd);
    nt.fields=cleanFields;nt.templates=cleanTemplates;
    // Mesmas validações do Anki ao salvar o tipo de nota (mensagem oficial em pt-BR).
    const erroNt=AnkiParity.erroNotetype?AnkiParity.erroNotetype(nt):null;
    if(erroNt){UI.alert(erroNt.replace(/<br>/g,'\n'),{title:'⚠ Tipo de nota inválido',okText:'Corrigir'});return;}
    const savedNt=AnkiParity.saveNotetype(nt);
    for(const note of notes){
      const fields={};savedNt.fields.forEach((f,i)=>{const src=fieldSource[i];fields[f.name]=src&&note.fields?note.fields[src]||'':'';});
      const cards=this._cardsForNote(note.id);
      cards.forEach(c=>{const oldOrd=Number(c.ankiTemplateOrd)||0,newOrd=templateSource.findIndex(x=>String(x)===String(oldOrd));if(newOrd>=0)DB.updateCard(c.id,{ankiTemplateOrd:newOrd});});
      const saved=AnkiParity.saveNote(Object.assign({},note,{fields}));this.reconcileNote(saved,savedNt);
    }
    document.getElementById('anki-nt-edit-modal').style.display='none';this.renderNotetypes();this.renderBrowser();CardsScreen.render();showToast('Tipo de nota atualizado ✓');
  },

  deleteNotetype(id){
    const used=AnkiParity.notes().filter(n=>String(n.notetypeId)===String(id)).length;if(used){showToast('Este tipo ainda é usado por '+used+' nota(s). Mude o tipo delas antes de excluir.');return;}
    UI.confirm('Excluir este tipo de nota sem uso?',{title:'Excluir tipo de nota',okText:'Excluir',danger:true}).then(ok=>{if(!ok)return;
      const nt=AnkiParity.getNotetype(id),key=(nt&&nt._planId&&window.StudyGlobalScope&&StudyGlobalScope.entityKeyForPlan)
        ? StudyGlobalScope.entityKeyForPlan(nt._planId,'notetype',id):AnkiParity._entityKey('notetype',id);
      localStorage.removeItem(key);this.renderNotetypes();showToast('Tipo excluído');});
  },

  scanCollection(){
    this.ensure();const cards=AnkiParity._scopeCards?AnkiParity._scopeCards():DB.getCards(),notes=AnkiParity.notes(),types=AnkiParity.noteTypes(),
      decks=AnkiParity._scopeDecks?AnkiParity._scopeDecks():DB.getDecks(),rev=AnkiParity._scopeRevlog?AnkiParity._scopeRevlog():DB.getRevlog(),
      noteIds=new Set(notes.map(n=>String(n.id))),typeIds=new Set(types.map(t=>String(t.id))),deckIds=new Set(decks.map(d=>String(d.id))),cardIds=new Set(cards.map(c=>String(c.id)));
    const issues={missingNote:[],missingType:[],typeMismatch:[],missingDeck:[],orphanRevlog:[],invalidSchedule:[],empty:AnkiParity.emptyCardIds(),suspendedBuried:[],duplicateGuid:[],missingMedia:[]};
    cards.forEach(c=>{
      const nid=this.noteId(c),n=AnkiParity.getNote(nid);if(!n)issues.missingNote.push(c.id);else if(!typeIds.has(String(n.notetypeId)))issues.missingType.push(n.id);else if(String(c.notetypeId||'')!==String(n.notetypeId))issues.typeMismatch.push(c.id);
      if(c.deckId!=null&&!deckIds.has(String(c.deckId)))issues.missingDeck.push(c.id);
      if(c.suspenso&&(c.enterradoAte||c.buryKind))issues.suspendedBuried.push(c.id);
      const ph=c.phase||'new';if((ph==='review'||ph==='learning'||ph==='relearning')&&!c.due&&!c.dueTs)issues.invalidSchedule.push(c.id);
      if(c.s!=null&&(!Number.isFinite(Number(c.s))||Number(c.s)<=0))issues.invalidSchedule.push(c.id);
      if(c.d!=null&&(!Number.isFinite(Number(c.d))||Number(c.d)<1||Number(c.d)>10))issues.invalidSchedule.push(c.id);
    });
    rev.forEach(r=>{if(!cardIds.has(String(r.cardId)))issues.orphanRevlog.push(r);});
    const g=new Map();notes.forEach(n=>{if(!n.guid)return;const k=String(n.guid);if(!g.has(k))g.set(k,[]);g.get(k).push(n.id);});g.forEach(v=>{if(v.length>1)issues.duplicateGuid.push(...v);});
    const scanText=(text,where)=>{
      const s=String(text||''),refs=[];let m;const re=/(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;while((m=re.exec(s)))refs.push(m[1]);
      const sr=/\[sound:([^\]]+)\]/gi;while((m=sr.exec(s)))refs.push(m[1]);
      refs.forEach(x=>{const v=String(x).trim();if(!v||/^(data:|blob:|https?:|#|mailto:|javascript:)/i.test(v))return;issues.missingMedia.push({where,ref:v});});
    };
    notes.forEach(n=>Object.entries(n.fields||{}).forEach(([k,v])=>scanText(v,'Nota '+n.id+' / '+k)));
    types.forEach(t=>{scanText(t.css,'Tipo '+t.name+' / CSS');(t.templates||[]).forEach(x=>{scanText(x.qfmt,'Tipo '+t.name+' / '+x.name+' frente');scanText(x.afmt,'Tipo '+t.name+' / '+x.name+' verso');});});
    return issues;
  },

  openCheck(){ document.getElementById('anki-check-modal').style.display='flex';this.renderCheck(); },
  renderCheck(){
    const x=this.scanCollection(),rows=[
      ['Cards sem nota',x.missingNote.length],['Notas sem tipo',x.missingType.length],['Tipo divergente no card',x.typeMismatch.length],
      ['Cards em baralho inexistente',x.missingDeck.length],['Revlogs órfãos',x.orphanRevlog.length],['Agendamento inválido',x.invalidSchedule.length],
      ['Cards vazios',x.empty.length],['Suspenso + enterrado',x.suspendedBuried.length],['GUID duplicado',x.duplicateGuid.length],['Referências de mídia locais sem arquivo incorporado',x.missingMedia.length]
    ];
    const total=rows.reduce((a,x)=>a+x[1],0);document.getElementById('anki-check-body').innerHTML='<div class="anki-check-status '+(total?'warn':'ok')+'"><strong>'+(total?'Encontrados pontos para revisar':'Coleção consistente')+'</strong><span>'+total+' ocorrência(s)</span></div>'+
      '<div class="anki-check-grid">'+rows.map(r=>'<div><span>'+this.esc(r[0])+'</span><strong>'+r[1]+'</strong></div>').join('')+'</div>'+
      (x.missingMedia.length?'<details><summary>Referências de mídia</summary><div class="anki-check-details">'+x.missingMedia.slice(0,50).map(m=>'<div>'+this.esc(m.where)+' → <code>'+this.esc(m.ref)+'</code></div>').join('')+'</div></details>':'')+
      '<p class="hint">“Reparos seguros” normaliza relações Nota↔Card, remove enterramento de cards suspensos e limpa revlogs que apontam para cards já excluídos. Não apaga cards vazios nem conteúdo de notas.</p>';
  },

  _bindCheck(){
    document.getElementById('anki-check-safe').addEventListener('click',()=>{
      this.ensure();const x=this.scanCollection();let fixed=0;
      const scopedCards=AnkiParity._scopeCards?AnkiParity._scopeCards():DB.getCards();
      scopedCards.forEach(c=>{const n=AnkiParity.getNote(this.noteId(c));if(n&&String(c.notetypeId||'')!==String(n.notetypeId)){DB.updateCard(c.id,{notetypeId:n.notetypeId});fixed++;}if(c.suspenso&&(c.enterradoAte||c.buryKind)){DB.updateCard(c.id,{enterradoAte:null,buryKind:null,dueTsAntesEnterrar:null});fixed++;}});
      if(x.orphanRevlog.length){
        const scope=(window.StudyGlobalScope&&StudyGlobalScope.cardsScope)?StudyGlobalScope.cardsScope():'plan';
        fixed+=(window.StudyGlobalScope&&StudyGlobalScope.cleanOrphanRevlog)?StudyGlobalScope.cleanOrphanRevlog(scope):0;
        if(!(window.StudyGlobalScope&&StudyGlobalScope.cleanOrphanRevlog)){
          const ids=new Set(DB.getCards().map(c=>String(c.id))),before=DB.getRevlog();DB.replaceRevlog(before.filter(r=>ids.has(String(r.cardId))));fixed+=before.length-DB.getRevlog().length;
        }
      }
      CardEngine.invalidateDueCache();this.renderCheck();CardsScreen.render();showToast(fixed?fixed+' reparo(s) seguro(s) aplicado(s) ✓':'Nada para reparar');
    });
    document.getElementById('anki-check-empty').addEventListener('click',()=>{
      const n=AnkiParity.emptyCardIds().length;if(!n){showToast('Nenhum card vazio');return;}
      UI.confirm('Excluir '+n+' card(s) vazio(s)? As notas são preservadas.',{title:'🧹 Cards vazios',okText:'Excluir cards vazios',danger:true}).then(ok=>{if(!ok)return;const done=AnkiParity.deleteEmptyCards();this.renderCheck();CardsScreen.render();showToast(done+' card(s) vazio(s) removido(s) ✓');});
    });
  },

  _installReviewerLayer(){
    const original=CardsScreen.renderReviewCard.bind(CardsScreen);
    CardsScreen.renderReviewCard=(box)=>{const out=original(box);try{this.decorateReviewer();}catch(e){console.warn('Reviewer parity layer',e);}return out;};
  },

  decorateReviewer(){
    const nav=document.querySelector('.cards-review-nav');if(!nav||document.getElementById('anki-review-more'))return;
    const b=document.createElement('button');b.type='button';b.className='icon-btn';b.id='anki-review-more';b.textContent='⋯ Mais ações';b.title='Ações adicionais do AnkiDroid';
    b.addEventListener('click',()=>this.openReviewerActions());nav.appendChild(b);
  },

  _currentReviewCard(){
    const id=(CardsScreen._reviewQueue||[])[CardsScreen._reviewIdx];return id?DB.getCard(id):null;
  },

  openReviewerActions(){
    const c=this._currentReviewCard();if(!c)return;
    const opts=[
      {value:'tags',label:'🏷 Editar etiquetas'},{value:'media',label:'▶ Repetição de mídia'},{value:'tts',label:'🎙 Reproduzir voz'},
      {value:'whiteboard',label:'✍ Quadro'},{value:'type',label:'🧩 Mudar tipo de nota'},{value:'deck',label:'⚙ Opções de baralho'}
    ];
    if((CardsScreen._redoStack||[]).length)opts.unshift({value:'redo',label:'↷ Refazer última ação'});
    UI.prompt([{key:'action',label:'Ação',type:'select',value:opts[0].value,options:opts}],{title:'⋯ Mais ações',okText:'Abrir'}).then(v=>{
      if(!v)return;const nid=this.noteId(c);
      if(v.action==='redo')CardsScreen.redoAnswer();
      else if(v.action==='tags')this.editTags([nid]);
      else if(v.action==='media')this.replayMedia(c);
      else if(v.action==='tts')this.speakCard(c);
      else if(v.action==='whiteboard')this.openWhiteboard();
      else if(v.action==='type')this.openChangeType([nid]);
      else if(v.action==='deck')CardsScreen.openAlgoConfigFor(c.deckId||null);
    });
  },

  _visibleCardHtml(c){
    const note=AnkiParity.getNote(this.noteId(c)),nt=this._typeFor(note);if(note&&nt){const q=AnkiParity.renderTemplate(nt,note,Number(c.ankiTemplateOrd)||0,'question',c,''),a=AnkiParity.renderTemplate(nt,note,Number(c.ankiTemplateOrd)||0,'answer',c,q);return CardsScreen._flipped?a:q;}return CardsScreen._flipped?(c.verso||''):(c.frente||'');
  },

  async replayMedia(c){
    if(!c)return false;
    let parts=[];
    try{
      const note=AnkiParity.getNote(this.noteId(c)),nt=this._typeFor(note),ord=Number(c.ankiTemplateOrd)||0;
      if(note&&nt){
        const q=AnkiParity.renderTemplate(nt,note,ord,'question',c,''),a=AnkiParity.renderTemplate(nt,note,ord,'answer',c,q);
        const answerOnly=(q&&String(a).includes(String(q)))?String(a).replace(String(q),''):String(a);
        const cfg=CardsConfig.forDeck(c.deckId);
        parts=CardsScreen._flipped?(cfg.skipQuestionWhenReplayingAnswer?[answerOnly]:[q,answerOnly]):[q];
      }
    }catch(_){}
    if(!parts.length)parts=[this._visibleCardHtml(c)];
    if(typeof AnkiRuntime!=='undefined'&&AnkiRuntime.playMarkupQueue){
      const ok=await AnkiRuntime.playMarkupQueue(parts);
      if(!ok)showToast('Nenhuma mídia reproduzível encontrada neste lado do card');
      return ok;
    }
    const html=parts.join(''),urls=[];let m;const re=/(?:src|href)\s*=\s*["'](data:(?:audio|video)\/[^"']+|blob:[^"']+|https?:\/\/[^"']+)["']/gi;while((m=re.exec(html)))urls.push(m[1]);
    if(!urls.length){showToast('Nenhuma mídia reproduzível encontrada neste lado do card');return false;}
    try{for(const u of urls){const a=new Audio(u);await a.play();await new Promise(r=>{a.onended=a.onerror=r;});}return true;}catch(_){showToast('Não foi possível reproduzir a mídia');return false;}
  },

  speakCard(c){
    if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){showToast('Síntese de voz indisponível neste navegador');return;}
    const text=this.plain(this._visibleCardHtml(c));if(!text){showToast('Não há texto para reproduzir');return;}
    speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=document.documentElement.lang||navigator.language||'pt-BR';speechSynthesis.speak(u);
  },

  openWhiteboard(){
    this._wbUndo=[];this._wbRedo=[];
    const modal=document.getElementById('anki-whiteboard-modal');modal.style.display='flex';requestAnimationFrame(()=>{this._resizeWhiteboard(true);this._syncWhiteboardButtons();});
  },

  _wbSnapshot(c,ctx){try{return ctx.getImageData(0,0,c.width,c.height);}catch(_){return null;}},
  _wbPushUndo(c,ctx){
    const snap=this._wbSnapshot(c,ctx);if(!snap)return;
    (this._wbUndo=this._wbUndo||[]).push(snap);if(this._wbUndo.length>30)this._wbUndo.shift();
    this._wbRedo=[];this._syncWhiteboardButtons();
  },
  _wbRestore(stack,target,c,ctx){
    const snap=stack&&stack.pop();if(!snap)return;
    const cur=this._wbSnapshot(c,ctx);if(cur)(target=target||[]).push(cur);
    if(snap.width===c.width&&snap.height===c.height)ctx.putImageData(snap,0,0);
    this._syncWhiteboardButtons();
  },
  _syncWhiteboardButtons(){
    const u=document.getElementById('anki-whiteboard-undo'),r=document.getElementById('anki-whiteboard-redo');
    if(u)u.disabled=!(this._wbUndo||[]).length;if(r)r.disabled=!(this._wbRedo||[]).length;
  },

  _bindWhiteboard(){
    const c=document.getElementById('anki-whiteboard'),ctx=c.getContext('2d');let draw=false,last=null;
    const pos=e=>{const r=c.getBoundingClientRect(),p=e.touches?e.touches[0]:e;return {x:(p.clientX-r.left)*c.width/r.width,y:(p.clientY-r.top)*c.height/r.height};};
    const start=e=>{this._wbPushUndo(c,ctx);draw=true;last=pos(e);e.preventDefault();},move=e=>{if(!draw)return;const p=pos(e);ctx.lineWidth=Math.max(2,c.width/300);ctx.lineCap='round';ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--text').trim()||'#111';ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;e.preventDefault();},end=()=>{draw=false;last=null;this._syncWhiteboardButtons();};
    c.addEventListener('pointerdown',start);c.addEventListener('pointermove',move);window.addEventListener('pointerup',end);
    document.getElementById('anki-whiteboard-undo').addEventListener('click',()=>this._wbRestore(this._wbUndo,this._wbRedo,c,ctx));
    document.getElementById('anki-whiteboard-redo').addEventListener('click',()=>this._wbRestore(this._wbRedo,this._wbUndo,c,ctx));
    document.getElementById('anki-whiteboard-clear').addEventListener('click',()=>{this._wbPushUndo(c,ctx);ctx.clearRect(0,0,c.width,c.height);this._syncWhiteboardButtons();});
    window.addEventListener('resize',()=>{if(document.getElementById('anki-whiteboard-modal').style.display==='flex'){this._resizeWhiteboard(false);this._wbUndo=[];this._wbRedo=[];this._syncWhiteboardButtons();}});
  },

  _resizeWhiteboard(clear){
    const c=document.getElementById('anki-whiteboard');if(!c)return;const r=c.parentElement.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1),old=clear?null:c.toDataURL();
    c.width=Math.max(300,Math.floor(r.width*dpr));c.height=Math.max(280,Math.floor(Math.min(window.innerHeight*.62,600)*dpr));c.style.width='100%';c.style.height=(c.height/dpr)+'px';
    if(old){const img=new Image();img.onload=()=>c.getContext('2d').drawImage(img,0,0,c.width,c.height);img.src=old;}
  }
};

queueMicrotask(()=>AnkiProductParity.install());
