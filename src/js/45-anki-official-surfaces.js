/* ============================================================
   ANKI OFICIAL — SUPERFÍCIES AVANÇADAS
   UI integrada ao Study. Toda operação de coleção/agendamento
   abaixo é delegada ao backend anki==26.09.2.
   ============================================================ */
const AnkiOfficialSurfaces = {
  installed:false,
  A:null,
  browser:{mode:'cards',selectedCards:new Set(),selectedNotes:new Set(),offset:0,limit:100,query:'',facets:null},
  shortcuts:null,

  esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');},
  plain(v){try{return new DOMParser().parseFromString(String(v||''),'text/html').body.textContent.replace(/\s+/g,' ').trim();}catch(_){return String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}},
  api(path,opts){return this.A.request(path,opts);},
  modal(title,sub,body,foot){
    this.closeModal();
    const el=document.createElement('div');
    el.id='anki-surface-modal';el.className='cards-modal';el.style.display='flex';
    el.innerHTML=`<div class="cards-modal-box cards-modal-lg anki-surface-modal-box">
      <div class="cards-modal-head"><div><h2>${this.esc(title)}</h2><p class="sub">${this.esc(sub||'')}</p></div><button type="button" class="icon-btn" id="anki-surface-close">✕</button></div>
      <div class="cards-modal-body">${body}</div>
      <div class="cards-modal-foot">${foot||'<span style="flex:1"></span><button type="button" class="btn-secondary" id="anki-surface-ok">Fechar</button>'}</div>
    </div>`;
    document.body.appendChild(el);
    const close=()=>this.closeModal();
    document.getElementById('anki-surface-close').onclick=close;
    const ok=document.getElementById('anki-surface-ok');if(ok)ok.onclick=close;
    el.addEventListener('click',e=>{if(e.target===el)close();});
    return el;
  },
  closeModal(){const m=document.getElementById('anki-surface-modal');if(m)m.remove();},
  toast(msg,kind){this.A.alert(msg,kind);},
  async ask(fields,opts){
    if(window.UI&&typeof UI.prompt==='function') return UI.prompt(fields,opts||{});
    const out={};
    for(const f of fields){const v=prompt(f.label,String(f.value??''));if(v==null)return null;out[f.key]=v;}
    return out;
  },
  confirm(msg,opts){
    if(window.UI&&typeof UI.confirm==='function') return UI.confirm(msg,opts||{});
    return Promise.resolve(window.confirm(msg));
  },

  install(){
    if(this.installed)return;
    if(!window.AnkiOfficial){setTimeout(()=>this.install(),50);return;}
    this.installed=true;this.A=window.AnkiOfficial;
    this.injectNavigation();
    this.patchRouter();
    this.patchDecks();
    this.patchBrowser();
    this.patchReviewer();
    this.installShortcuts();
  },

  injectNavigation(){
    const tabs=document.querySelector('#screen-anki .anki-cards-tabs');
    if(tabs&&!tabs.querySelector('[data-anki-view="stats"]')){
      const b=document.createElement('button');b.type='button';b.className='cards-tab';b.dataset.ankiView='stats';b.textContent='📊 Estatísticas';tabs.appendChild(b);
    }
    const menu=document.getElementById('anki-more-menu');
    if(menu&&!document.getElementById('anki-advanced-sep')){
      const sep=document.createElement('div');sep.id='anki-advanced-sep';sep.className='anki-surface-menu-sep';menu.prepend(sep);
      const entries=[
        ['anki-custom-study','🎯 Estudo personalizado',()=>this.openCustomStudy()],
        ['anki-filtered-deck','🔎 Baralho filtrado',()=>this.openFilteredDeck()],
        ['anki-fsrs-tools','🧠 Ferramentas FSRS',()=>this.openFsrsTools()],
        ['anki-notetypes','🧩 Tipos de nota e templates',()=>this.openNotetypes()],
        ['anki-empty-cards','🧹 Cards vazios',()=>this.openEmptyCards()],
        ['anki-media-tools','🖼️ Mídia e lixeira',()=>this.openMediaTools()],
        ['anki-csv-import','↑ Importar CSV/TXT',()=>this.openCsvImport()],
        ['anki-export-text','↓ Exportar texto/CSV',()=>this.openTextExport()],
        ['anki-image-occlusion','▧ Oclusão de Imagem',()=>this.openImageOcclusion()],
        ['anki-shared-decks','🌐 Baralhos compartilhados',()=>this.openSharedDecks()],
        ['anki-shortcuts','⌨ Atalhos personalizados',()=>this.openShortcuts()]
      ];
      for(const [id,label,fn] of entries){
        const b=document.createElement('button');b.type='button';b.id=id;b.setAttribute('role','menuitem');b.textContent=label;
        b.onclick=()=>{this.A.closeMore();fn();};menu.insertBefore(b,sep);
      }
    }
    this.A.bindStatic();
  },

  patchRouter(){
    const old=this.A.renderView.bind(this.A);
    this.A.renderView=async()=>{
      this.A.alert('');
      this.A.setView(this.A.view);
      if(this.A.view==='stats')return this.renderStats();
      return old();
    };
  },

  patchDecks(){
    const old=this.A.renderDecks.bind(this.A);
    this.A.renderDecks=async(data)=>{
      await old(data);
      this.decorateDecks();
    };
  },

  decorateDecks(){
    const root=this.A.root();if(!root)return;
    const head=root.querySelector('.card-header');
    if(head&&!head.querySelector('#anki-deck-custom-study')){
      const wrap=document.createElement('div');wrap.className='anki-surface-inline-actions';
      wrap.innerHTML='<button type="button" class="btn-secondary" id="anki-deck-custom-study">🎯 Personalizado</button><button type="button" class="btn-secondary" id="anki-deck-filtered">🔎 Filtrado</button>';
      head.appendChild(wrap);
      document.getElementById('anki-deck-custom-study').onclick=()=>void this.openCustomStudy();
      document.getElementById('anki-deck-filtered').onclick=()=>void this.openFilteredDeck();
    }
    root.querySelectorAll('.anki-study-deck-row').forEach(row=>{
      if(row.querySelector('.anki-deck-manage'))return;
      const id=Number(row.closest('[data-deck-node]')?.dataset.deckNode||0);if(!id)return;
      const name=row.querySelector('.anki-study-deck-name')?.textContent?.trim()||'Baralho';
      const b=document.createElement('button');b.type='button';b.className='icon-btn anki-deck-manage';b.textContent='⋯';b.title='Gerenciar baralho';
      b.onclick=e=>{e.stopPropagation();void this.manageDeck(id,name);};
      row.appendChild(b);
    });
  },

  async manageDeck(deckId,name){
    const decks=await this.api('/api/anki/decks');
    const v=await this.ask([
      {key:'action',label:'Ação',type:'select',value:'rename',options:[
        {value:'rename',label:'Renomear'},{value:'reparent',label:'Mover para outro baralho'},{value:'unbury',label:'Desenterrar cards'},{value:'delete',label:'Excluir baralho'}
      ]}
    ],{title:'📁 '+name,okText:'Continuar'});
    if(!v)return;
    const action=v.action;
    let body={action,deck_id:deckId};
    if(action==='rename'){
      const x=await this.ask([{key:'name',label:'Novo nome',type:'text',value:name}],{title:'Renomear baralho',okText:'Salvar'});if(!x)return;body.name=x.name;
    }else if(action==='reparent'){
      const opts=[{value:'0',label:'— nível principal —'}].concat((decks.decks||[]).filter(d=>Number(d.id)!==deckId).map(d=>({value:String(d.id),label:d.name})));
      const x=await this.ask([{key:'parent_id',label:'Novo pai',type:'select',value:'0',options:opts}],{title:'Mover baralho',okText:'Mover'});if(!x)return;body.parent_id=Number(x.parent_id);
    }else if(action==='delete'){
      if(!await this.confirm('Excluir o baralho "'+name+'"? O Anki aplicará a semântica oficial de remoção.',{title:'Excluir baralho',danger:true,okText:'Excluir'}))return;
    }
    await this.api('/api/anki/decks/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    this.toast('Baralho atualizado pelo Anki oficial.');await this.A.renderDecks();
  },

  patchBrowser(){
    this.A.renderBrowser=()=>this.renderBrowser();
  },

  browserQuery(){
    const raw=(document.getElementById('anki-browser-query')?.value||this.browser.query||'').trim();
    const clauses=[raw];
    const deck=document.getElementById('anki-browser-deck')?.value;
    const tag=document.getElementById('anki-browser-tag')?.value;
    const nt=document.getElementById('anki-browser-nt')?.value;
    const state=document.getElementById('anki-browser-state')?.value;
    const flag=document.getElementById('anki-browser-flag')?.value;
    if(deck)clauses.push('deck:"'+deck.replace(/"/g,'')+'"');
    if(tag)clauses.push('tag:"'+tag.replace(/"/g,'')+'"');
    if(nt)clauses.push('note:"'+nt.replace(/"/g,'')+'"');
    if(state)clauses.push(state);
    if(flag!=='')clauses.push('flag:'+flag);
    return clauses.filter(Boolean).join(' ');
  },

  async renderBrowser(){
    const root=this.A.root();if(!root)return;
    this.browser.selectedCards.clear();this.browser.selectedNotes.clear();
    root.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">⏳</div><h3>Abrindo navegador…</h3></div></div>';
    try{
      const facets=await this.api('/api/anki/browser/facets');this.browser.facets=facets;
      root.innerHTML=`
        <section class="card anki-browser-advanced">
          <div class="card-header cards-filter-head">
            <div><h2>🔎 Navegador oficial</h2><p class="sub">Busca, filtros e operações atuam diretamente na coleção Anki.</p></div>
            <div class="anki-surface-inline-actions">
              <button type="button" class="btn-secondary active" id="anki-browser-mode-cards">Cards</button>
              <button type="button" class="btn-secondary" id="anki-browser-mode-notes">Notas</button>
              <button type="button" class="btn-secondary" id="anki-browser-dupes">Duplicatas</button>
            </div>
          </div>
          <div class="anki-browser-filters">
            <div class="field anki-browser-query-field"><label>Busca Anki</label><input id="anki-browser-query" value="${this.esc(this.browser.query)}" placeholder='deck:"Fiscal" is:due -is:suspended'></div>
            <div class="field"><label>Baralho</label><select id="anki-browser-deck"><option value="">Todos</option>${(facets.decks||[]).map(d=>'<option>'+this.esc(d.name)+'</option>').join('')}</select></div>
            <div class="field"><label>Tag</label><select id="anki-browser-tag"><option value="">Todas</option>${(facets.tags||[]).map(t=>'<option>'+this.esc(t)+'</option>').join('')}</select></div>
            <div class="field"><label>Tipo</label><select id="anki-browser-nt"><option value="">Todos</option>${(facets.notetypes||[]).map(n=>'<option>'+this.esc(n.name)+'</option>').join('')}</select></div>
            <div class="field"><label>Estado</label><select id="anki-browser-state"><option value="">Todos</option><option value="is:new">Novo</option><option value="is:learn">Aprendendo</option><option value="is:review">Revisão</option><option value="is:due">Vencido</option><option value="is:suspended">Suspenso</option><option value="is:buried">Enterrado</option></select></div>
            <div class="field"><label>Flag</label><select id="anki-browser-flag"><option value="">Todas</option>${[0,1,2,3,4,5,6,7].map(n=>'<option value="'+n+'">'+(n||'Sem flag')+'</option>').join('')}</select></div>
            <button type="button" class="btn-primary" id="anki-browser-run">Buscar</button>
          </div>
        </section>
        <div class="anki-browser-bulkbar" id="anki-browser-bulkbar">
          <label><input type="checkbox" id="anki-browser-select-all"> Selecionar visíveis</label>
          <span id="anki-browser-selected">0 selecionados</span>
          <button class="btn-secondary" id="anki-browser-bulk-action" disabled>⚡ Ações em massa</button>
        </div>
        <div class="cards-count-bar" id="anki-browser-count"></div>
        <div class="anki-browser-table-wrap" id="anki-browser-results"></div>
        <div class="anki-browser-more" id="anki-browser-more"></div>`;
      document.getElementById('anki-browser-run').onclick=()=>{this.browser.offset=0;this.browser.query=document.getElementById('anki-browser-query').value||'';void this.runBrowserSearch();};
      document.getElementById('anki-browser-query').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();document.getElementById('anki-browser-run').click();}};
      document.getElementById('anki-browser-mode-cards').onclick=()=>{this.browser.mode='cards';this.browser.offset=0;this.syncBrowserMode();void this.runBrowserSearch();};
      document.getElementById('anki-browser-mode-notes').onclick=()=>{this.browser.mode='notes';this.browser.offset=0;this.syncBrowserMode();void this.runBrowserSearch();};
      document.getElementById('anki-browser-dupes').onclick=()=>void this.openDuplicates();
      document.getElementById('anki-browser-select-all').onchange=e=>this.selectAllBrowser(e.target.checked);
      document.getElementById('anki-browser-bulk-action').onclick=()=>void this.openBulkActions();
      this.syncBrowserMode();await this.runBrowserSearch();
    }catch(e){this.toast(e.message,'error');}
  },

  syncBrowserMode(){
    document.getElementById('anki-browser-mode-cards')?.classList.toggle('active',this.browser.mode==='cards');
    document.getElementById('anki-browser-mode-notes')?.classList.toggle('active',this.browser.mode==='notes');
    this.browser.selectedCards.clear();this.browser.selectedNotes.clear();this.syncBrowserSelection();
  },

  async runBrowserSearch(append=false){
    const results=document.getElementById('anki-browser-results');if(!results)return;
    if(!append){results.innerHTML='<div class="anki-study-empty">Buscando…</div>';this.browser.offset=0;}
    const q=this.browserQuery();
    const endpoint=this.browser.mode==='notes'?'/api/anki/browser/notes':'/api/anki/browser/search';
    const data=await this.api(endpoint+'?q='+encodeURIComponent(q)+'&limit='+this.browser.limit+'&offset='+this.browser.offset);
    const rows=this.browser.mode==='notes'?(data.notes||[]):(data.cards||[]);
    if(!append)results.innerHTML='';
    if(this.browser.mode==='notes')results.insertAdjacentHTML('beforeend',rows.map(n=>this.noteRow(n)).join(''));
    else results.insertAdjacentHTML('beforeend',rows.map(c=>this.cardRow(c)).join(''));
    if(!results.children.length)results.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">🔎</div><h3>Nenhum resultado</h3><p>A busca foi executada pelo Anki oficial.</p></div></div>';
    const count=document.getElementById('anki-browser-count');if(count)count.textContent=(data.total||0).toLocaleString('pt-BR')+' resultado(s)';
    this.browser.offset+=rows.length;
    const more=document.getElementById('anki-browser-more');
    if(more)more.innerHTML=this.browser.offset<(data.total||0)?'<button class="btn-secondary" id="anki-browser-more-btn">Carregar mais</button>':'';
    const mb=document.getElementById('anki-browser-more-btn');if(mb)mb.onclick=()=>void this.runBrowserSearch(true);
    results.querySelectorAll('[data-browser-check]').forEach(x=>x.onchange=e=>this.toggleBrowserSelection(e.target));
    results.querySelectorAll('[data-browser-edit]').forEach(x=>x.onclick=e=>{e.stopPropagation();void this.A.openEditNote(Number(x.dataset.browserEdit));});
    results.querySelectorAll('[data-browser-info]').forEach(x=>x.onclick=e=>{e.stopPropagation();void this.A.showCardInfo(Number(x.dataset.browserInfo));});
    this.syncBrowserSelection();
  },

  cardRow(card){
    const text=this.plain(card.question)||'(sem texto)';
    return `<div class="anki-browser-row anki-browser-row-advanced" data-card-row="${card.card_id}">
      <label class="anki-browser-check"><input type="checkbox" data-browser-check data-card-id="${card.card_id}" data-note-id="${card.note_id}"></label>
      <div class="anki-browser-main"><strong>${this.esc(text)}</strong><span>📁 ${this.esc(card.deck_name||'')} · ${this.esc(card.notetype_name||'')} · ${this.esc((card.tags||[]).join(' '))}</span></div>
      <span class="anki-browser-num">${card.interval||0}d</span>
      <span class="anki-browser-num">${card.reps||0} reps</span>
      <span class="anki-browser-state-icons">${card.marked?'★':''}${card.flag?' 🚩'+card.flag:''}${Number(card.queue)<0?' ⏸':''}</span>
      <span class="anki-browser-row-actions"><button class="icon-btn" data-browser-info="${card.card_id}">ℹ</button><button class="icon-btn" data-browser-edit="${card.card_id}">✎</button></span>
    </div>`;
  },

  noteRow(note){
    const first=Object.values(note.fields||{})[0]||'(nota vazia)';
    const cards=note.cards||[];
    return `<div class="anki-browser-row anki-browser-row-advanced" data-note-row="${note.note_id}">
      <label class="anki-browser-check"><input type="checkbox" data-browser-check data-note-id="${note.note_id}" data-card-ids="${cards.map(c=>c.card_id).join(',')}"></label>
      <div class="anki-browser-main"><strong>${this.esc(this.plain(first))}</strong><span>${this.esc(note.notetype_name||'')} · ${this.esc((note.tags||[]).join(' '))}</span></div>
      <span class="anki-browser-num">${cards.length} card(s)</span>
      <span class="anki-browser-state-icons">${note.marked?'★':''}</span>
      <span class="anki-browser-row-actions">${cards[0]?'<button class="icon-btn" data-browser-info="'+cards[0].card_id+'">ℹ</button><button class="icon-btn" data-browser-edit="'+cards[0].card_id+'">✎</button>':''}</span>
    </div>`;
  },

  toggleBrowserSelection(input){
    const nid=Number(input.dataset.noteId||0);
    const cids=(input.dataset.cardIds?input.dataset.cardIds.split(','):[input.dataset.cardId]).map(Number).filter(Boolean);
    if(input.checked){if(nid)this.browser.selectedNotes.add(nid);cids.forEach(x=>this.browser.selectedCards.add(x));}
    else{if(nid)this.browser.selectedNotes.delete(nid);cids.forEach(x=>this.browser.selectedCards.delete(x));}
    this.syncBrowserSelection();
  },
  selectAllBrowser(on){
    document.querySelectorAll('#anki-browser-results [data-browser-check]').forEach(x=>{x.checked=on;this.toggleBrowserSelection(x);});
  },
  syncBrowserSelection(){
    const n=this.browser.mode==='notes'?this.browser.selectedNotes.size:this.browser.selectedCards.size;
    const el=document.getElementById('anki-browser-selected');if(el)el.textContent=n+' selecionado(s)';
    const b=document.getElementById('anki-browser-bulk-action');if(b)b.disabled=!n;
  },

  async openBulkActions(){
    const cards=[...this.browser.selectedCards],notes=[...this.browser.selectedNotes];
    const v=await this.ask([{key:'action',label:'Ação',type:'select',value:'move_deck',options:[
      {value:'move_deck',label:'📁 Mover cards para baralho'},
      {value:'tags_add',label:'🏷 Adicionar tags'},
      {value:'tags_remove',label:'🏷 Remover tags'},
      {value:'suspend_cards',label:'🚫 Suspender cards'},
      {value:'unsuspend_cards',label:'▶ Reativar cards'},
      {value:'bury_cards',label:'⤓ Enterrar cards'},
      {value:'bury_notes',label:'⤓ Enterrar notas'},
      {value:'forget',label:'↺ Esquecer/resetar'},
      {value:'set_due',label:'📅 Definir vencimento'},
      {value:'flag',label:'🚩 Definir bandeira'},
      {value:'reposition',label:'↕ Reposicionar novos'},
      {value:'find_replace',label:'🔁 Localizar e substituir'},
      {value:'delete_notes',label:'🗑 Excluir notas'}
    ]}],{title:'Ações em massa — Anki oficial',okText:'Continuar'});
    if(!v)return;
    const body={action:v.action,card_ids:cards,note_ids:notes};
    if(v.action==='move_deck'){
      const decks=await this.api('/api/anki/decks');const x=await this.ask([{key:'deck_id',label:'Destino',type:'select',options:(decks.decks||[]).map(d=>({value:String(d.id),label:d.name}))}],{title:'Mover cards',okText:'Mover'});if(!x)return;body.deck_id=Number(x.deck_id);
    }else if(v.action==='tags_add'||v.action==='tags_remove'){
      const x=await this.ask([{key:'tags',label:'Tags (separadas por espaço)',type:'text',value:''}],{title:'Editar tags',okText:'Aplicar'});if(!x)return;body.tags=x.tags;
    }else if(v.action==='set_due'){
      const x=await this.ask([{key:'days',label:'Dias (ex.: 5 ou 5-7)',type:'text',value:'5'}],{title:'Definir vencimento',okText:'Aplicar'});if(!x)return;body.days=x.days;
    }else if(v.action==='flag'){
      const x=await this.ask([{key:'flag',label:'Bandeira',type:'select',value:'0',options:[0,1,2,3,4,5,6,7].map(n=>({value:String(n),label:n?'Bandeira '+n:'Sem bandeira'}))}],{title:'Bandeira',okText:'Aplicar'});if(!x)return;body.flag=Number(x.flag);
    }else if(v.action==='reposition'){
      const x=await this.ask([{key:'starting_from',label:'Começar em',type:'number',value:1},{key:'step_size',label:'Passo',type:'number',value:1},{key:'randomize',label:'Aleatorizar',type:'select',value:'0',options:[{value:'0',label:'Não'},{value:'1',label:'Sim'}]},{key:'shift_existing',label:'Deslocar existentes',type:'select',value:'1',options:[{value:'1',label:'Sim'},{value:'0',label:'Não'}]}],{title:'Reposicionar novos',okText:'Aplicar'});if(!x)return;Object.assign(body,{starting_from:Number(x.starting_from),step_size:Number(x.step_size),randomize:x.randomize==='1',shift_existing:x.shift_existing==='1'});
    }else if(v.action==='find_replace'){
      const x=await this.ask([{key:'search',label:'Localizar',type:'text',value:''},{key:'replacement',label:'Substituir por',type:'text',value:''},{key:'field_name',label:'Campo (vazio = todos)',type:'text',value:''},{key:'regex',label:'Regex',type:'select',value:'0',options:[{value:'0',label:'Não'},{value:'1',label:'Sim'}]}],{title:'Localizar e substituir',okText:'Substituir'});if(!x)return;Object.assign(body,{search:x.search,replacement:x.replacement,field_name:x.field_name,regex:x.regex==='1'});
    }else if(v.action==='delete_notes'){
      if(!await this.confirm('Excluir as notas selecionadas da coleção Anki?',{title:'Excluir notas',danger:true,okText:'Excluir'}))return;
    }
    await this.api('/api/anki/browser/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    this.toast('Operação concluída pelo Anki oficial.');await this.runBrowserSearch();
  },

  async openDuplicates(){
    const v=await this.ask([{key:'field',label:'Nome do campo',type:'text',value:'Front'},{key:'search',label:'Busca adicional',type:'text',value:''}],{title:'Localizar duplicatas',okText:'Buscar'});if(!v)return;
    const data=await this.api('/api/anki/browser/duplicates?field='+encodeURIComponent(v.field)+'&search='+encodeURIComponent(v.search||''));
    const body=(data.groups||[]).map(g=>'<div class="anki-duplicate-group"><strong>'+this.esc(this.plain(g.value))+'</strong><span>'+g.note_ids.length+' notas · IDs '+g.note_ids.join(', ')+'</span></div>').join('')||'<p class="hint">Nenhuma duplicata encontrada.</p>';
    this.modal('Duplicatas','Detecção executada pela Collection.find_dupes() oficial.',body);
  },

  patchReviewer(){
    const old=this.A.renderReviewer.bind(this.A);
    this.A.renderReviewer=async(data)=>{
      await old(data);
      const root=this.A.root(),card=this.A.review&&this.A.review.card;if(!root||!card)return;
      const nav=root.querySelector('.anki-study-review-nav-left');if(!nav)return;
      const add=(id,label,fn)=>{if(document.getElementById(id))return;const b=document.createElement('button');b.type='button';b.id=id;b.className='icon-btn';b.textContent=label;b.onclick=fn;nav.appendChild(b);};
      add('anki-review-bury-note','⤓ Nota',()=>void this.bulkSingle('bury_notes',card));
      add('anki-review-replay','🔊 Mídia',()=>void this.A.playAv(this.A._answerShown?card.answer_av_tags:card.question_av_tags));
      add('anki-review-whiteboard','✎ Rascunho',()=>this.openWhiteboard());
      add('anki-review-voice','🎙 Voz',()=>this.openVoiceRecorder());
    };
  },
  async bulkSingle(action,card){
    await this.api('/api/anki/browser/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,card_ids:[card.id],note_ids:[card.note_id]})});
    await this.A.renderReviewer();
  },

  openWhiteboard(){
    const body='<div class="anki-whiteboard-wrap"><canvas id="anki-whiteboard" width="900" height="520"></canvas></div>';
    this.modal('Rascunho','Temporário desta sessão; não altera a coleção Anki.',body,'<button class="btn-secondary" id="anki-wb-clear">Limpar</button><span style="flex:1"></span><button class="btn-primary" id="anki-surface-ok">Fechar</button>');
    const cv=document.getElementById('anki-whiteboard'),ctx=cv.getContext('2d');let down=false;
    const pt=e=>{const r=cv.getBoundingClientRect();return[(e.clientX-r.left)*cv.width/r.width,(e.clientY-r.top)*cv.height/r.height];};
    cv.onpointerdown=e=>{down=true;cv.setPointerCapture(e.pointerId);const [x,y]=pt(e);ctx.beginPath();ctx.moveTo(x,y);};
    cv.onpointermove=e=>{if(!down)return;const[x,y]=pt(e);ctx.lineTo(x,y);ctx.stroke();};
    cv.onpointerup=()=>down=false;document.getElementById('anki-wb-clear').onclick=()=>ctx.clearRect(0,0,cv.width,cv.height);
    document.getElementById('anki-surface-ok').onclick=()=>this.closeModal();
  },
  openVoiceRecorder(){
    const body='<p class="hint">Gravação local para comparar sua resposta. Não entra na coleção.</p><div class="anki-voice-status" id="anki-voice-status">Pronto.</div>';
    this.modal('Gravar própria voz','Ferramenta de reviewer do cliente, sem alterar scheduling.',body,'<button class="btn-secondary" id="anki-voice-start">● Gravar</button><button class="btn-secondary" id="anki-voice-stop" disabled>■ Parar</button><button class="btn-primary" id="anki-voice-play" disabled>▶ Ouvir</button>');
    let rec,chunks=[],url='';
    document.getElementById('anki-voice-start').onclick=async()=>{
      try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});rec=new MediaRecorder(stream);chunks=[];rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=()=>{const blob=new Blob(chunks,{type:rec.mimeType});if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(blob);document.getElementById('anki-voice-play').disabled=false;stream.getTracks().forEach(t=>t.stop());};rec.start();document.getElementById('anki-voice-status').textContent='Gravando…';document.getElementById('anki-voice-stop').disabled=false;}catch(e){this.toast(e.message,'error');}
    };
    document.getElementById('anki-voice-stop').onclick=()=>{if(rec&&rec.state!=='inactive'){rec.stop();document.getElementById('anki-voice-status').textContent='Gravação pronta.';}};
    document.getElementById('anki-voice-play').onclick=()=>{if(url)new Audio(url).play();};
  },

  hist(map,max=24){
    const entries=Object.entries(map||{}).map(([k,v])=>[Number(k),Number(v)]).sort((a,b)=>a[0]-b[0]);
    if(!entries.length)return '<p class="hint">Sem dados.</p>';
    const tail=entries.slice(-max),m=Math.max(1,...tail.map(x=>x[1]));
    return '<div class="anki-stat-bars">'+tail.map(([k,v])=>'<div title="'+k+': '+v+'"><i style="height:'+Math.max(v?3:0,Math.round(v/m*100))+'%"></i><span>'+this.esc(k)+'</span></div>').join('')+'</div>';
  },
  retentionRow(label,x){
    x=x||{};const pass=Number(x.young_passed||0)+Number(x.mature_passed||0),fail=Number(x.young_failed||0)+Number(x.mature_failed||0),tot=pass+fail;
    return '<tr><td>'+label+'</td><td>'+tot+'</td><td>'+pass+'</td><td>'+(tot?(pass/tot*100).toFixed(1)+'%':'—')+'</td></tr>';
  },
  async renderStats(){
    const root=this.A.root();if(!root)return;
    root.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">📊</div><h3>Calculando estatísticas oficiais…</h3></div></div>';
    try{
      const data=await this.api('/api/anki/stats/graphs?days=365');
      const counts=(data.card_counts||{}).excluding_inactive||{};
      const ret=data.true_retention||{};
      root.innerHTML=`
        <div class="stat-kpis">
          <div class="stat-kpi"><div class="stat-kpi-v accent">${Number(counts.newCards||counts.new_cards||0).toLocaleString('pt-BR')}</div><div class="stat-kpi-l">Novos</div></div>
          <div class="stat-kpi"><div class="stat-kpi-v">${Number(counts.learn||0).toLocaleString('pt-BR')}</div><div class="stat-kpi-l">Aprendendo</div></div>
          <div class="stat-kpi"><div class="stat-kpi-v good">${Number(counts.mature||0).toLocaleString('pt-BR')}</div><div class="stat-kpi-l">Maduros</div></div>
          <div class="stat-kpi"><div class="stat-kpi-v">${Number(counts.suspended||0).toLocaleString('pt-BR')}</div><div class="stat-kpi-l">Suspensos</div></div>
        </div>
        <div class="stat-grid">
          <section class="card stat-card"><div class="card-header"><div><h2>📆 Future Due</h2><p class="sub">Vencimentos do backend oficial.</p></div></div>${this.hist((data.future_due||{}).future_due,32)}</section>
          <section class="card stat-card"><div class="card-header"><div><h2>↔ Intervalos</h2><p class="sub">Distribuição atual.</p></div></div>${this.hist((data.intervals||{}).intervals,24)}</section>
          <section class="card stat-card"><div class="card-header"><div><h2>🧠 Estabilidade</h2><p class="sub">FSRS memory state.</p></div></div>${this.hist((data.stability||{}).intervals,24)}</section>
          <section class="card stat-card"><div class="card-header"><div><h2>🎯 Recuperabilidade</h2><p class="sub">Média: ${Number((data.retrievability||{}).average||0).toFixed(2)}</p></div></div>${this.hist((data.retrievability||{}).retrievability,20)}</section>
        </div>
        <section class="card stat-card"><div class="card-header"><div><h2>✓ True Retention</h2><p class="sub">Calculada pelo StatsService oficial.</p></div></div>
          <div class="anki-stat-table-wrap"><table><thead><tr><th>Período</th><th>Respostas</th><th>Corretas</th><th>Retenção</th></tr></thead><tbody>
          ${this.retentionRow('Hoje',ret.today)}${this.retentionRow('Ontem',ret.yesterday)}${this.retentionRow('Semana',ret.week)}${this.retentionRow('Mês',ret.month)}${this.retentionRow('Ano',ret.year)}${this.retentionRow('Tudo',ret.all_time)}
          </tbody></table></div>
        </section>`;
    }catch(e){this.toast(e.message,'error');}
  },

  async openCustomStudy(){
    const decks=await this.api('/api/anki/decks');
    const did=Number(decks.current_deck_id);
    const defaults=await this.api('/api/anki/custom-study/defaults/'+did);
    const body=`<div class="field-group"><div class="field"><label>Baralho</label><select id="anki-cs-deck">${(decks.decks||[]).map(d=>'<option value="'+d.id+'" '+(Number(d.id)===did?'selected':'')+'>'+this.esc(d.name)+'</option>').join('')}</select></div>
      <div class="field"><label>Modo</label><select id="anki-cs-mode"><option value="new_limit_delta">Aumentar limite de novos</option><option value="review_limit_delta">Aumentar limite de revisão</option><option value="forgot_days">Repetir esquecidos recentemente</option><option value="review_ahead_days">Revisar adiantado</option><option value="preview_days">Pré-visualizar novos recentes</option><option value="cram">Cram / estudo por filtro</option></select></div></div>
      <div class="field"><label>Valor / dias / limite</label><input id="anki-cs-value" type="number" min="0" value="${defaults.extend_review||10}"></div>
      <div id="anki-cs-cram" hidden><div class="field"><label>Tipo do Cram</label><select id="anki-cs-cram-kind"><option value="0">Vencidos</option><option value="1">Novos</option><option value="2">Revisão</option><option value="3">Todos / aleatório / sem reagendar</option></select></div><div class="field-group"><div class="field"><label>Tags a incluir</label><input id="anki-cs-in"></div><div class="field"><label>Tags a excluir</label><input id="anki-cs-out"></div></div></div>`;
    this.modal('🎯 Estudo personalizado','CustomStudyRequest executado pelo scheduler oficial.',body,'<button class="btn-secondary" id="anki-surface-cancel">Cancelar</button><span style="flex:1"></span><button class="btn-primary" id="anki-cs-run">Criar/aplicar</button>');
    document.getElementById('anki-surface-cancel').onclick=()=>this.closeModal();
    document.getElementById('anki-cs-mode').onchange=e=>document.getElementById('anki-cs-cram').hidden=e.target.value!=='cram';
    document.getElementById('anki-cs-run').onclick=async()=>{
      const mode=document.getElementById('anki-cs-mode').value,val=Math.max(0,Number(document.getElementById('anki-cs-value').value)||0);
      const p={deck_id:Number(document.getElementById('anki-cs-deck').value)};
      if(mode==='cram')p.cram={kind:Number(document.getElementById('anki-cs-cram-kind').value),card_limit:val||100,tags_to_include:(document.getElementById('anki-cs-in').value||'').split(/[,\s]+/).filter(Boolean),tags_to_exclude:(document.getElementById('anki-cs-out').value||'').split(/[,\s]+/).filter(Boolean)};
      else p[mode]=val;
      try{await this.api('/api/anki/custom-study',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});this.closeModal();this.toast('Estudo personalizado criado pelo scheduler oficial.');this.A.setView('review');await this.A.renderReviewer();}
      catch(e){this.toast(e.message,'error');}
    };
  },

  async openFilteredDeck(){
    const data=await this.api('/api/anki/filtered-deck/0');
    const deck=data.deck||{},cfg=deck.config||{},terms=cfg.search_terms||[];
    const body=`<div class="field"><label>Nome</label><input id="anki-fd-name" value="${this.esc(deck.name||'Baralho filtrado')}"></div>
      <div class="field"><label>Filtro 1</label><input id="anki-fd-q1" value="${this.esc((terms[0]||{}).search||'is:due')}"></div>
      <div class="field-group"><div class="field"><label>Limite</label><input id="anki-fd-l1" type="number" min="0" value="${Number((terms[0]||{}).limit||100)}"></div><div class="field"><label>Ordem</label><select id="anki-fd-o1">${(data.orders||[]).map((x,i)=>'<option value="'+i+'" '+(Number((terms[0]||{}).order||0)===i?'selected':'')+'>'+this.esc(x)+'</option>').join('')}</select></div></div>
      <div class="field"><label>Filtro 2 (opcional)</label><input id="anki-fd-q2" value="${this.esc((terms[1]||{}).search||'')}"></div>
      <div class="field-group"><div class="field"><label>Limite 2</label><input id="anki-fd-l2" type="number" min="0" value="${Number((terms[1]||{}).limit||100)}"></div><div class="field"><label>Ordem 2</label><select id="anki-fd-o2">${(data.orders||[]).map((x,i)=>'<option value="'+i+'" '+(Number((terms[1]||{}).order||0)===i?'selected':'')+'>'+this.esc(x)+'</option>').join('')}</select></div></div>
      <label class="toggle-row"><input id="anki-fd-reschedule" type="checkbox" ${cfg.reschedule!==false?'checked':''}> <span>Reagendar cards com as respostas do filtered deck</span></label>`;
    this.modal('🔎 Baralho filtrado','Configuração e rebuild executados pelo scheduler oficial.',body,'<button class="btn-secondary" id="anki-surface-cancel">Cancelar</button><span style="flex:1"></span><button class="btn-primary" id="anki-fd-save">Salvar e reconstruir</button>');
    document.getElementById('anki-surface-cancel').onclick=()=>this.closeModal();
    document.getElementById('anki-fd-save').onclick=async()=>{
      const termsOut=[{search:document.getElementById('anki-fd-q1').value,limit:Number(document.getElementById('anki-fd-l1').value)||100,order:Number(document.getElementById('anki-fd-o1').value)}];
      const q2=document.getElementById('anki-fd-q2').value.trim();if(q2)termsOut.push({search:q2,limit:Number(document.getElementById('anki-fd-l2').value)||100,order:Number(document.getElementById('anki-fd-o2').value)});
      const p={id:Number(deck.id||0),name:document.getElementById('anki-fd-name').value||'Baralho filtrado',config:Object.assign({},cfg,{reschedule:document.getElementById('anki-fd-reschedule').checked,search_terms:termsOut}),allow_empty:true};
      try{const saved=await this.api('/api/anki/filtered-deck/'+Number(deck.id||0),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});await this.api('/api/anki/filtered-deck/'+saved.deck_id+'/rebuild',{method:'POST'});this.closeModal();this.toast('Baralho filtrado reconstruído pelo Anki oficial.');this.A.setView('review');await this.A.renderReviewer();}
      catch(e){this.toast(e.message,'error');}
    };
  },

  findDeep(obj,key){
    if(!obj||typeof obj!=='object')return undefined;
    if(Object.prototype.hasOwnProperty.call(obj,key))return obj[key];
    for(const v of Object.values(obj)){const x=this.findDeep(v,key);if(x!==undefined)return x;}
  },
  async openFsrsTools(){
    const decks=await this.api('/api/anki/decks'),did=Number(decks.current_deck_id),opts=await this.api('/api/anki/deck/'+did+'/options');
    const params=this.findDeep(opts,'fsrs_params')||this.findDeep(opts,'fsrsParams')||[];
    const retention=Number(this.findDeep(opts,'desired_retention')||this.findDeep(opts,'desiredRetention')||0.9);
    const body=`<div class="field"><label>Busca que entra no treino/simulação</label><input id="anki-fsrs-search" placeholder='deck:"Fiscal"' value=""></div>
      <div class="field-group"><div class="field"><label>Retenção desejada</label><input id="anki-fsrs-ret" type="number" min=".7" max=".99" step=".01" value="${retention||0.9}"></div><div class="field"><label>Dias de simulação</label><input id="anki-fsrs-days" type="number" min="1" max="36500" value="365"></div></div>
      <div class="field"><label>Parâmetros atuais</label><textarea id="anki-fsrs-params" class="anki-code-area">${this.esc((params||[]).join(' '))}</textarea></div>
      <div class="anki-surface-actions"><button class="btn-primary" id="anki-fsrs-opt">Otimizar + Health Check</button><button class="btn-secondary" id="anki-fsrs-sim">Simular reviews</button><button class="btn-secondary" id="anki-fsrs-work">Simular workload</button><button class="btn-secondary" id="anki-fsrs-optret">Help Me Decide</button></div>
      <pre class="anki-surface-result" id="anki-fsrs-result">Aguardando operação…</pre>`;
    this.modal('🧠 FSRS oficial','Optimizer, Health Check, Simulator e Optimal Retention do backend 26.09.2.',body);
    const currentParams=()=>document.getElementById('anki-fsrs-params').value.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    document.getElementById('anki-fsrs-opt').onclick=async()=>{
      try{const out=await this.api('/api/anki/fsrs/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({search:document.getElementById('anki-fsrs-search').value,current_params:currentParams(),ignore_revlogs_before_ms:0,num_of_relearning_steps:1,health_check:true})});document.getElementById('anki-fsrs-result').textContent=JSON.stringify(out,null,2);if(out.params)document.getElementById('anki-fsrs-params').value=out.params.join(' ');}catch(e){this.toast(e.message,'error');}
    };
    const sim=async mode=>{
      const st=await this.api('/api/anki/status');
      const p={params:currentParams(),desired_retention:Number(document.getElementById('anki-fsrs-ret').value)||.9,deck_size:Number(st.cards||0),days_to_simulate:Number(document.getElementById('anki-fsrs-days').value)||365,new_limit:20,review_limit:200,max_interval:36500,search:document.getElementById('anki-fsrs-search').value,new_cards_ignore_review_limit:false,easy_days_percentages:[1,1,1,1,1,1,1],review_order:0,historical_retention:.9,learning_step_count:2,relearning_step_count:1};
      try{const out=await this.api('/api/anki/fsrs/simulate?mode='+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});document.getElementById('anki-fsrs-result').textContent=JSON.stringify(out,null,2);}catch(e){this.toast(e.message,'error');}
    };
    document.getElementById('anki-fsrs-sim').onclick=()=>void sim('review');document.getElementById('anki-fsrs-work').onclick=()=>void sim('workload');document.getElementById('anki-fsrs-optret').onclick=()=>void sim('optimal');
  },

  async openNotetypes(){
    const data=await this.api('/api/anki/notetypes/full');
    const body='<div class="anki-notetype-manager"><div class="anki-surface-actions"><button class="btn-primary" id="anki-nt-new">＋ Clonar/criar tipo</button></div><div id="anki-nt-list">'+(data.notetypes||[]).map(x=>{
      const nt=x.notetype||{};return '<div class="anki-notetype-row" data-nt="'+nt.id+'"><div><strong>'+this.esc(nt.name)+'</strong><span>'+x.use_count+' nota(s) · '+(nt.flds||[]).length+' campos · '+(nt.tmpls||[]).length+' templates</span></div><button class="btn-secondary" data-nt-edit="'+nt.id+'">Editar</button><button class="btn-danger-text" data-nt-del="'+nt.id+'">Excluir</button></div>';
    }).join('')+'</div></div>';
    this.modal('🧩 Tipos de nota e templates','Campos, templates e CSS são salvos pelo NotetypeManager oficial.',body);
    document.getElementById('anki-nt-new').onclick=()=>void this.createNotetype(data.notetypes||[]);
    document.querySelectorAll('[data-nt-edit]').forEach(b=>b.onclick=()=>void this.editNotetype(Number(b.dataset.ntEdit),data.notetypes||[]));
    document.querySelectorAll('[data-nt-del]').forEach(b=>b.onclick=()=>void this.deleteNotetype(Number(b.dataset.ntDel)));
  },
  async createNotetype(rows){
    const v=await this.ask([{key:'name',label:'Nome',type:'text',value:'Meu tipo'},{key:'source_id',label:'Basear em',type:'select',options:rows.map(x=>({value:String(x.notetype.id),label:x.notetype.name}))}],{title:'Criar tipo de nota',okText:'Criar'});if(!v)return;
    await this.api('/api/anki/notetypes/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:v.name,source_id:Number(v.source_id)})});this.closeModal();this.toast('Tipo criado pelo Anki oficial.');await this.openNotetypes();
  },
  async editNotetype(id,rows){
    const row=rows.find(x=>Number(x.notetype.id)===id);if(!row)return;const nt=structuredClone(row.notetype);
    const fieldRows=()=> (nt.flds||[]).map((f,i)=>'<div class="anki-nt-field"><input data-nt-field="'+i+'" value="'+this.esc(f.name)+'"><button class="icon-btn" data-nt-field-del="'+i+'">🗑</button></div>').join('');
    const templates=()=> (nt.tmpls||[]).map((t,i)=>'<details class="anki-nt-template"><summary>'+this.esc(t.name||('Template '+(i+1)))+'</summary><div class="field"><label>Nome</label><input data-nt-t-name="'+i+'" value="'+this.esc(t.name||'')+'"></div><div class="field"><label>Frente (qfmt)</label><textarea data-nt-qfmt="'+i+'" class="anki-code-area">'+this.esc(t.qfmt||'')+'</textarea></div><div class="field"><label>Verso (afmt)</label><textarea data-nt-afmt="'+i+'" class="anki-code-area">'+this.esc(t.afmt||'')+'</textarea></div></details>').join('');
    const body='<div class="field"><label>Nome</label><input id="anki-nt-name" value="'+this.esc(nt.name)+'"></div><div class="section-divider"><span>Campos</span></div><div id="anki-nt-fields">'+fieldRows()+'</div><button class="btn-secondary" id="anki-nt-add-field">＋ Campo</button><div class="section-divider"><span>Templates</span></div><div id="anki-nt-templates">'+templates()+'</div><div class="section-divider"><span>CSS</span></div><textarea id="anki-nt-css" class="anki-code-area">'+this.esc(nt.css||'')+'</textarea>';
    this.modal('Editar tipo de nota','Alterações de schema passam pelo NotetypeManager oficial.',body,'<button class="btn-secondary" id="anki-surface-cancel">Cancelar</button><span style="flex:1"></span><button class="btn-primary" id="anki-nt-save">Salvar</button>');
    document.getElementById('anki-surface-cancel').onclick=()=>this.closeModal();
    document.getElementById('anki-nt-add-field').onclick=()=>{nt.flds=nt.flds||[];nt.flds.push({name:'Campo '+(nt.flds.length+1),ord:nt.flds.length});document.getElementById('anki-nt-fields').innerHTML=fieldRows();};
    document.getElementById('anki-nt-save').onclick=async()=>{
      nt.name=document.getElementById('anki-nt-name').value;nt.css=document.getElementById('anki-nt-css').value;
      document.querySelectorAll('[data-nt-field]').forEach(x=>{const i=Number(x.dataset.ntField);if(nt.flds[i])nt.flds[i].name=x.value;});
      document.querySelectorAll('[data-nt-t-name]').forEach(x=>{const i=Number(x.dataset.ntTName);if(nt.tmpls[i])nt.tmpls[i].name=x.value;});
      document.querySelectorAll('[data-nt-qfmt]').forEach(x=>{const i=Number(x.dataset.ntQfmt);if(nt.tmpls[i])nt.tmpls[i].qfmt=x.value;});
      document.querySelectorAll('[data-nt-afmt]').forEach(x=>{const i=Number(x.dataset.ntAfmt);if(nt.tmpls[i])nt.tmpls[i].afmt=x.value;});
      try{await this.api('/api/anki/notetypes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({notetype:nt})});this.closeModal();this.toast('Tipo atualizado pelo Anki oficial.');await this.openNotetypes();}catch(e){this.toast(e.message,'error');}
    };
  },
  async deleteNotetype(id){if(!await this.confirm('Excluir este tipo de nota? O Anki validará se a alteração de schema é permitida.',{title:'Excluir tipo',danger:true,okText:'Excluir'}))return;await this.api('/api/anki/notetypes/'+id,{method:'DELETE'});this.closeModal();this.toast('Tipo removido.');await this.openNotetypes();},

  async openEmptyCards(){
    const data=await this.api('/api/anki/empty-cards'),notes=data.notes||[];
    const ids=notes.flatMap(n=>(n.card_ids||[]).map(Number));
    const body=notes.length?'<p class="hint">'+this.esc(data.report||'')+'</p><div class="anki-empty-list">'+notes.map(n=>'<div><strong>Nota '+n.note_id+'</strong><span>Cards: '+(n.card_ids||[]).join(', ')+'</span></div>').join('')+'</div>':'<div class="cards-review-done"><div class="big">✅</div><h3>Nenhum card vazio</h3></div>';
    this.modal('🧹 Cards vazios','Relatório vindo de Collection.get_empty_cards().',body,notes.length?'<button class="btn-secondary" id="anki-surface-cancel">Cancelar</button><span style="flex:1"></span><button class="btn-danger" id="anki-empty-delete">Excluir '+ids.length+' card(s)</button>':undefined);
    const cancel=document.getElementById('anki-surface-cancel');if(cancel)cancel.onclick=()=>this.closeModal();
    const del=document.getElementById('anki-empty-delete');if(del)del.onclick=async()=>{if(!await this.confirm('Excluir os cards vazios detectados pelo Anki?',{danger:true,okText:'Excluir'}))return;await this.api('/api/anki/empty-cards/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_ids:ids})});this.closeModal();this.toast('Cards vazios removidos pelo Anki oficial.');};
  },

  async openMediaTools(){
    const data=await this.api('/api/anki/media/check'),missing=data.missing||data.missing_files||[],unused=data.unused||data.unused_files||[];
    const body='<div class="stat-kpis"><div class="stat-kpi"><div class="stat-kpi-v '+(missing.length?'bad':'good')+'">'+missing.length+'</div><div class="stat-kpi-l">Faltando</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+unused.length+'</div><div class="stat-kpi-l">Sem uso</div></div></div><div class="anki-media-lists"><details open><summary>Faltando</summary><pre>'+this.esc(missing.join('\n')||'Nenhuma')+'</pre></details><details><summary>Sem uso</summary><pre>'+this.esc(unused.join('\n')||'Nenhuma')+'</pre></details></div>';
    this.modal('🖼️ Mídia','Check Media e lixeira do MediaManager oficial.',body,'<button class="btn-secondary" id="anki-media-restore">Restaurar lixeira</button><button class="btn-danger-text" id="anki-media-empty">Esvaziar lixeira</button><span style="flex:1"></span><button class="btn-primary" id="anki-media-trash">Mover não usadas para lixeira</button>');
    document.getElementById('anki-media-trash').onclick=async()=>{await this.api('/api/anki/media/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:unused})});this.toast('Mídia não usada movida para a lixeira oficial.');this.closeModal();};
    document.getElementById('anki-media-restore').onclick=async()=>{await this.api('/api/anki/media/restore-trash',{method:'POST'});this.toast('Lixeira restaurada.');};
    document.getElementById('anki-media-empty').onclick=async()=>{if(await this.confirm('Esvaziar a lixeira de mídia?',{danger:true,okText:'Esvaziar'})){await this.api('/api/anki/media/empty-trash',{method:'POST'});this.toast('Lixeira esvaziada.');}};
  },

  openCsvImport(){
    const body='<div class="tec-dropzone anki-csv-drop" id="anki-csv-drop"><input type="file" id="anki-csv-file" accept=".csv,.tsv,.txt" hidden><strong>Escolher CSV / TSV / TXT</strong><p class="hint">A detecção de delimitador, colunas, duplicatas e importação são do ImportCsv oficial.</p></div><pre class="anki-surface-result" id="anki-csv-meta">Aguardando arquivo…</pre>';
    this.modal('↑ Importar CSV/TXT','Importador oficial do Anki.',body,'<button class="btn-secondary" id="anki-surface-cancel">Cancelar</button><span style="flex:1"></span><button class="btn-primary" id="anki-csv-do" disabled>Importar</button>');
    document.getElementById('anki-surface-cancel').onclick=()=>this.closeModal();const file=document.getElementById('anki-csv-file'),drop=document.getElementById('anki-csv-drop');let chosen=null,meta=null;
    drop.onclick=()=>file.click();file.onchange=async()=>{chosen=file.files&&file.files[0];if(!chosen)return;const fd=new FormData();fd.append('package',chosen);try{const res=await fetch(this.A.apiBase()+'/api/anki/import/csv/metadata',{method:'POST',headers:{Authorization:'Bearer '+this.A.token()},body:fd});if(!res.ok)throw new Error(await res.text());meta=await res.json();document.getElementById('anki-csv-meta').textContent=JSON.stringify(meta,null,2);document.getElementById('anki-csv-do').disabled=false;}catch(e){this.toast(e.message,'error');}};
    document.getElementById('anki-csv-do').onclick=async()=>{if(!chosen)return;const fd=new FormData();fd.append('package',chosen);fd.append('metadata_json',JSON.stringify(meta||{}));try{const res=await fetch(this.A.apiBase()+'/api/anki/import/csv',{method:'POST',headers:{Authorization:'Bearer '+this.A.token()},body:fd});if(!res.ok)throw new Error(await res.text());const out=await res.json();this.closeModal();this.toast('CSV importado pelo Anki oficial.');this.A.setView('browser');await this.A.renderView();}catch(e){this.toast(e.message,'error');}};
  },

  openTextExport(){
    const body='<p>Escolha o formato. A geração do arquivo é feita pelo exportador oficial do Anki.</p><div class="anki-surface-actions"><button class="btn-primary" id="anki-export-notes-txt">Notas + tags/deck/tipo/GUID</button><button class="btn-secondary" id="anki-export-cards-txt">Cards</button></div>';
    this.modal('↓ Exportar texto/CSV','ExportNoteCsv / ExportCardCsv oficiais.',body);
    document.getElementById('anki-export-notes-txt').onclick=()=>void this.A.download('/api/anki/export/notes.csv','StudyNoMentor-Anki-notes.txt');
    document.getElementById('anki-export-cards-txt').onclick=()=>void this.A.download('/api/anki/export/cards.csv','StudyNoMentor-Anki-cards.txt');
  },

  async openImageOcclusion(){
    const setup=await this.api('/api/anki/image-occlusion/setup'),nt=(setup.notetypes||[])[0];
    if(!nt){this.toast('O Anki não retornou um tipo Image Occlusion.','error');return;}
    const body='<div class="field"><label>Imagem</label><input type="file" id="anki-io-file" accept="image/*"></div><div class="anki-io-stage" id="anki-io-stage"><img id="anki-io-img" alt=""><div id="anki-io-overlay"></div></div><p class="hint">Arraste sobre a imagem para criar máscaras retangulares. Cada máscara vira uma cloze de Oclusão de Imagem oficial.</p><div class="field-group"><div class="field"><label>Header</label><textarea id="anki-io-header"></textarea></div><div class="field"><label>Back Extra</label><textarea id="anki-io-back"></textarea></div></div><div class="field"><label>Tags</label><input id="anki-io-tags"></div><div id="anki-io-count" class="hint">0 máscaras</div>';
    this.modal('▧ Oclusão de Imagem','Editor visual do Study salvando por ImageOcclusionService oficial.',body,'<button class="btn-secondary" id="anki-io-clear">Limpar máscaras</button><span style="flex:1"></span><button class="btn-primary" id="anki-io-save" disabled>Criar notas</button>');
    const file=document.getElementById('anki-io-file'),img=document.getElementById('anki-io-img'),overlay=document.getElementById('anki-io-overlay');let stored='',rects=[],drag=null;
    const render=()=>{overlay.innerHTML=rects.map((r,i)=>'<div class="anki-io-mask" style="left:'+(r.x*100)+'%;top:'+(r.y*100)+'%;width:'+(r.w*100)+'%;height:'+(r.h*100)+'%" data-i="'+i+'"><button type="button">×</button></div>').join('');overlay.querySelectorAll('.anki-io-mask button').forEach(b=>b.onclick=e=>{e.stopPropagation();rects.splice(Number(b.parentElement.dataset.i),1);render();});document.getElementById('anki-io-count').textContent=rects.length+' máscara(s)';document.getElementById('anki-io-save').disabled=!stored||!rects.length;};
    file.onchange=async()=>{const f=file.files&&file.files[0];if(!f)return;img.src=URL.createObjectURL(f);const fd=new FormData();fd.append('image',f);try{const res=await fetch(this.A.apiBase()+'/api/anki/image-occlusion/image',{method:'POST',headers:{Authorization:'Bearer '+this.A.token()},body:fd});if(!res.ok)throw new Error(await res.text());stored=(await res.json()).filename;render();}catch(e){this.toast(e.message,'error');}};
    const pos=e=>{const r=overlay.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
    overlay.onpointerdown=e=>{if(e.target!==overlay)return;drag=pos(e);overlay.setPointerCapture(e.pointerId);};overlay.onpointerup=e=>{if(!drag)return;const p=pos(e),x=Math.min(drag.x,p.x),y=Math.min(drag.y,p.y),w=Math.abs(p.x-drag.x),h=Math.abs(p.y-drag.y);drag=null;if(w>.01&&h>.01){rects.push({x,y,w,h});render();}};
    document.getElementById('anki-io-clear').onclick=()=>{rects=[];render();};
    document.getElementById('anki-io-save').onclick=async()=>{let occlusions='';rects.forEach((r,i)=>{occlusions+='{{c'+(i+1)+'::image-occlusion:rect:top='+r.y.toFixed(4)+':left='+r.x.toFixed(4)+':width='+r.w.toFixed(4)+':height='+r.h.toFixed(4)+'}}<br>';});try{await this.api('/api/anki/image-occlusion/note',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notetype_id:nt.id,image_path:stored,occlusions,header:document.getElementById('anki-io-header').value,back_extra:document.getElementById('anki-io-back').value,tags:(document.getElementById('anki-io-tags').value||'').split(/\s+/).filter(Boolean)})});this.closeModal();this.toast(rects.length+' oclusão(ões) criada(s) pelo Anki oficial.');}catch(e){this.toast(e.message,'error');}};
  },

  openSharedDecks(){
    const body='<p>O catálogo público continua sendo o AnkiWeb. O Study não raspa nem replica o serviço: você baixa o pacote e o importa pelo importador oficial já conectado.</p><div class="anki-surface-actions"><button class="btn-primary" id="anki-shared-open">Abrir catálogo público</button><button class="btn-secondary" id="anki-shared-import">Importar pacote baixado</button></div>';
    this.modal('🌐 Baralhos compartilhados','Catálogo externo + importação oficial.',body);
    document.getElementById('anki-shared-open').onclick=()=>window.open('https://ankiweb.net/shared/decks/','_blank','noopener,noreferrer');
    document.getElementById('anki-shared-import').onclick=()=>{this.closeModal();document.getElementById('anki-import-trigger')?.click();};
  },

  installShortcuts(){
    try{this.shortcuts=JSON.parse(localStorage.getItem('snm:anki-official:shortcuts')||'{}')||{};}catch(_){this.shortcuts={};}
    document.addEventListener('keydown',e=>{
      if(!document.getElementById('screen-anki')?.classList.contains('active'))return;
      if(e.target&&/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
      const sig=[e.ctrlKey?'Ctrl':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.metaKey?'Meta':'',e.code].filter(Boolean).join('+');
      const action=Object.keys(this.shortcuts||{}).find(k=>this.shortcuts[k]===sig);if(!action)return;
      const map={stats:()=>{this.A.setView('stats');void this.A.renderView();},browser:()=>{this.A.setView('browser');void this.A.renderView();},add:()=>{this.A.setView('add');void this.A.renderView();},custom:()=>void this.openCustomStudy(),filtered:()=>void this.openFilteredDeck(),fsrs:()=>void this.openFsrsTools()};
      if(map[action]){e.preventDefault();map[action]();}
    });
  },
  openShortcuts(){
    const actions=[['stats','Estatísticas'],['browser','Navegador'],['add','Adicionar nota'],['custom','Estudo personalizado'],['filtered','Baralho filtrado'],['fsrs','Ferramentas FSRS']];
    const body=actions.map(([k,l])=>'<div class="field"><label>'+l+'</label><input data-shortcut="'+k+'" value="'+this.esc((this.shortcuts||{})[k]||'')+'" placeholder="Ex.: Ctrl+Shift+KeyS"></div>').join('')+'<p class="hint">Formato baseado em KeyboardEvent.code: Ctrl+KeyB, Alt+Digit1, Shift+KeyF…</p>';
    this.modal('⌨ Atalhos personalizados','Preferência local da interface; não altera a coleção.',body,'<button class="btn-secondary" id="anki-shortcuts-clear">Limpar</button><span style="flex:1"></span><button class="btn-primary" id="anki-shortcuts-save">Salvar</button>');
    document.getElementById('anki-shortcuts-clear').onclick=()=>{this.shortcuts={};localStorage.removeItem('snm:anki-official:shortcuts');this.closeModal();};
    document.getElementById('anki-shortcuts-save').onclick=()=>{const x={};document.querySelectorAll('[data-shortcut]').forEach(el=>{if(el.value.trim())x[el.dataset.shortcut]=el.value.trim();});this.shortcuts=x;localStorage.setItem('snm:anki-official:shortcuts',JSON.stringify(x));this.closeModal();this.toast('Atalhos salvos.');};
  }
};
queueMicrotask(()=>AnkiOfficialSurfaces.install());
