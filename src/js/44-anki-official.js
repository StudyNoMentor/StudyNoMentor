/* ═══════════════════════════════════════════════════════════════════════════
   ANKI OFICIAL — cliente fino para anki==26.09.2
   ---------------------------------------------------------------------------
   Regra arquitetural: este módulo NÃO usa FSRS/CardEngine/CardsConfig/DB cards
   do Study. Toda mutação acadêmica passa pelo backend oficial do Anki.
   ═══════════════════════════════════════════════════════════════════════════ */
const AnkiOfficial = {
  view: 'review',
  status: null,
  review: null,
  reviewStartedAt: 0,
  _sessionAnswered: 0,
  _sessionStartTotal: null,
  _answerShown: false,
  _blobUrls: [],

  apiBase() {
    const fallback = 'https://anki-official-production.up.railway.app';
    const raw = (window.ANKI_OFFICIAL_API_URL || localStorage.getItem('ankiOfficialApiUrl') || fallback).trim();
    return raw.replace(/\/$/, '');
  },

  token() {
    try { return window.CloudStore && CloudStore.session && CloudStore.session.access_token || ''; }
    catch (_) { return ''; }
  },

  headers(extra) {
    const h = Object.assign({}, extra || {});
    const t = this.token();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  },

  async request(path, opts) {
    const base = this.apiBase();
    if (!base) throw new Error('Backend do Anki Oficial ainda não foi configurado.');
    const o = Object.assign({}, opts || {});
    o.headers = this.headers(o.headers);
    const r = await fetch(base + path, o);
    const ct = r.headers.get('content-type') || '';
    const body = ct.includes('application/json') ? await r.json() : await r.text();
    if (!r.ok) {
      const msg = body && typeof body === 'object' ? (body.detail || JSON.stringify(body)) : body;
      throw new Error(msg || ('HTTP ' + r.status));
    }
    return body;
  },

  async fetchBlob(path) {
    const base = this.apiBase();
    if (!base) throw new Error('Backend do Anki Oficial ainda não foi configurado.');
    const r = await fetch(base + path, { headers: this.headers() });
    if (!r.ok) {
      let msg = '';
      try { const x = await r.json(); msg = x.detail || ''; } catch (_) {}
      throw new Error(msg || ('HTTP ' + r.status));
    }
    return r.blob();
  },

  esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  root() { return document.getElementById('anki-official-root'); },
  badge() { return document.getElementById('anki-official-engine-badge'); },

  alert(msg, kind) {
    const el = document.getElementById('anki-official-alert');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; el.className = 'anki-official-alert'; return; }
    el.hidden = false;
    el.textContent = msg;
    el.className = 'anki-official-alert' + (kind ? ' ' + kind : '');
  },

  clearMediaUrls() {
    for (const url of this._blobUrls.splice(0)) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
  },

  async htmlWithMedia(html) {
    this.clearMediaUrls();
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const nodes = Array.from(doc.querySelectorAll('[src]'));
    for (const el of nodes) {
      const src = (el.getAttribute('src') || '').trim();
      if (!src || /^(?:https?:|data:|blob:|about:|#)/i.test(src)) continue;
      const name = src.replace(/^\.\//, '');
      if (!name || name.includes('/') || name.includes('\\')) continue;
      try {
        const blob = await this.fetchBlob('/api/anki/media/' + encodeURIComponent(name));
        const url = URL.createObjectURL(blob);
        this._blobUrls.push(url);
        el.setAttribute('src', url);
      } catch (_) { /* o HTML continua; Check Media explica ausências */ }
    }
    return '<!doctype html>' + doc.documentElement.outerHTML;
  },

  setApiUrl() {
    const atual = this.apiBase();
    const val = prompt('URL HTTPS do backend Anki Oficial:', atual || 'https://');
    if (val == null) return;
    const limpo = val.trim().replace(/\/$/, '');
    if (!limpo) localStorage.removeItem('ankiOfficialApiUrl');
    else localStorage.setItem('ankiOfficialApiUrl', limpo);
    this.status = null;
    void this.activate();
  },

  renderDisconnected(error) {
    const root = this.root();
    const badge = this.badge();
    if (badge) {
      badge.textContent = 'Engine não conectada';
      badge.classList.remove('ok'); badge.classList.add('bad');
    }
    if (!root) return;
    const detail = error ? '<p class="hint">' + this.esc(error.message || error) + '</p>' : '';
    root.innerHTML = `
      <div class="card">
        <div class="cards-review-done">
          <div class="big">⚠</div>
          <h3>Não foi possível abrir o Anki Oficial</h3>
          <p>O Study não usa um motor alternativo nesta área. A coleção precisa ser aberta pelo backend oficial.</p>
          ${detail}
          <button type="button" class="btn-primary" id="anki-official-set-api">Configurar servidor</button>
        </div>
      </div>`;
    const b = document.getElementById('anki-official-set-api');
    if (b) b.onclick = () => this.setApiUrl();
  },

  async ensureStatus() {
    if (!this.apiBase()) { this.renderDisconnected(); return false; }
    if (!this.token()) {
      this.renderDisconnected(new Error('Entre na sua conta do Study para abrir sua coleção Anki privada.'));
      return false;
    }
    try {
      this.status = await this.request('/api/anki/status');
      const badge = this.badge();
      if (badge) {
        badge.textContent = 'Engine: Anki ' + (this.status.runtime_version || this.status.pinned_version || '26.09.2');
        badge.classList.remove('bad'); badge.classList.add('ok');
      }
      return true;
    } catch (e) {
      this.renderDisconnected(e);
      return false;
    }
  },

  setView(view) {
    this.view = view || 'review';
    document.querySelectorAll('#screen-anki .cards-tab[data-anki-view]').forEach(x => {
      x.classList.toggle('active', x.dataset.ankiView === this.view);
    });
    const sub = document.querySelector('#screen-anki .page-subtitle');
    const labels = {
      review: 'Revise com o scheduler oficial do Anki 26.09.2.',
      browser: 'Pesquise e edite sua coleção real com a busca oficial do Anki.',
      decks: 'Escolha o baralho e veja as contagens calculadas pelo scheduler oficial.',
      add: 'Adicione uma nota diretamente à coleção Anki.',
      options: 'Edite as opções do baralho fornecidas pelo backend oficial.',
      tools: 'Ferramentas de manutenção e diagnóstico da coleção oficial.'
    };
    if (sub) sub.textContent = labels[this.view] || labels.review;
  },

  async activate() {
    this.bindStatic();
    this.setView(this.view);
    if (!await this.ensureStatus()) return;
    await this.renderView();
  },

  bindStatic() {
    document.querySelectorAll('#screen-anki [data-anki-view]').forEach(btn => {
      if (btn.dataset.boundAnki) return;
      btn.dataset.boundAnki = '1';
      btn.addEventListener('click', () => {
        this.closeMore();
        this.setView(btn.dataset.ankiView || 'review');
        void this.renderView();
      });
    });

    const input = document.getElementById('anki-official-import');
    if (input && !input.dataset.boundAnki) {
      input.dataset.boundAnki = '1';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) void this.importPackage(file);
        input.value = '';
      });
    }
    const importTrigger = document.getElementById('anki-import-trigger');
    if (importTrigger && !importTrigger.dataset.boundAnki) {
      importTrigger.dataset.boundAnki='1';
      importTrigger.onclick=()=>{ this.closeMore(); if(input) input.click(); };
    }

    const more = document.getElementById('anki-more-btn');
    const menu = document.getElementById('anki-more-menu');
    if (more && !more.dataset.boundAnki) {
      more.dataset.boundAnki='1';
      more.onclick=(e)=>{
        e.stopPropagation();
        const open=!menu.classList.contains('open');
        menu.classList.toggle('open',open);
        more.classList.toggle('open',open);
        more.setAttribute('aria-expanded',open?'true':'false');
      };
    }

    const focus = document.getElementById('anki-foco-btn');
    if (focus && !focus.dataset.boundAnki) {
      focus.dataset.boundAnki='1';
      focus.onclick=()=>{ this.setView('review'); document.body.classList.add('anki-foco'); void this.renderReviewer(); };
    }
    const focusExit = document.getElementById('anki-foco-sair');
    if (focusExit && !focusExit.dataset.boundAnki) {
      focusExit.dataset.boundAnki='1';
      focusExit.onclick=()=>document.body.classList.remove('anki-foco');
    }
    const focusUndo = document.getElementById('anki-foco-undo');
    if (focusUndo && !focusUndo.dataset.boundAnki) {
      focusUndo.dataset.boundAnki='1';
      focusUndo.onclick=()=>void this.simplePost('/api/anki/undo');
    }

    const apkg = document.getElementById('anki-official-export-apkg');
    if (apkg && !apkg.dataset.boundAnki) { apkg.dataset.boundAnki='1'; apkg.onclick=()=>{this.closeMore();void this.download('/api/anki/export/apkg','StudyNoMentor-Anki.apkg');}; }
    const colpkg = document.getElementById('anki-official-export-colpkg');
    if (colpkg && !colpkg.dataset.boundAnki) { colpkg.dataset.boundAnki='1'; colpkg.onclick=()=>{this.closeMore();void this.download('/api/anki/export/colpkg','StudyNoMentor-Anki.colpkg');}; }
    const undo = document.getElementById('anki-official-undo');
    if (undo && !undo.dataset.boundAnki) { undo.dataset.boundAnki='1'; undo.onclick=()=>{this.closeMore();void this.simplePost('/api/anki/undo');}; }
    const redo = document.getElementById('anki-official-redo');
    if (redo && !redo.dataset.boundAnki) { redo.dataset.boundAnki='1'; redo.onclick=()=>{this.closeMore();void this.simplePost('/api/anki/redo');}; }

    if (!this._docBound) {
      this._docBound=true;
      document.addEventListener('click', e=>{
        if (!e.target.closest('#screen-anki .cards-more-wrap')) this.closeMore();
      });
      document.addEventListener('keydown', e=>this.onKey(e));
    }
  },

  closeMore() {
    const menu=document.getElementById('anki-more-menu');
    const btn=document.getElementById('anki-more-btn');
    if(menu) menu.classList.remove('open');
    if(btn){btn.classList.remove('open');btn.setAttribute('aria-expanded','false');}
  },

  async simplePost(path) {
    try { await this.request(path, {method:'POST'}); this.alert('Concluído no backend oficial do Anki.'); await this.renderView(); }
    catch(e) { this.alert(e.message, 'error'); }
  },

  async download(path, filename) {
    try {
      this.alert('Gerando pacote pelo exportador oficial do Anki…');
      const blob = await this.fetchBlob(path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 30000);
      this.alert('Pacote gerado pelo Anki oficial.');
    } catch(e) { this.alert(e.message, 'error'); }
  },

  async importPackage(file) {
    try {
      const ext = file.name.toLowerCase().endsWith('.colpkg') ? 'colpkg' : 'apkg';
      this.alert('Importando pelo importador oficial do Anki…');
      const form = new FormData(); form.append('package', file, file.name);
      await this.request('/api/anki/import/' + ext, {method:'POST', body:form});
      this.status = null;
      this.alert('Importação concluída pelo Anki oficial.');
      await this.activate();
    } catch(e) { this.alert(e.message, 'error'); }
  },

  async renderView() {
    this.alert('');
    this.setView(this.view);
    if (this.view === 'review') return this.renderReviewer();
    if (this.view === 'browser') return this.renderBrowser();
    if (this.view === 'add') return this.renderAdd();
    if (this.view === 'options') return this.renderOptions();
    if (this.view === 'tools') return this.renderTools();
    return this.renderDecks();
  },

  async renderDecks() {
    const root=this.root(); if(!root) return;
    root.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">⏳</div><h3>Carregando baralhos…</h3></div></div>';
    try {
      const data=await this.request('/api/anki/decks');
      const tree=data.deck_tree||{};
      const roots=(Number(tree.deck_id||0)>0) ? [tree] : (tree.children||[]);
      const fallback=(data.decks||[]).map(d=>({
        deck_id:d.id,name:d.name,level:0,children:[],
        new_count:0,learn_count:0,review_count:0,filtered:false,collapsed:false
      }));
      const nodes=roots.length?roots:fallback;
      const flatten=(arr)=>arr.flatMap(x=>[x,...flatten(x.children||[])]);
      const flat=flatten(nodes);
      const totalNew=flat.reduce((s,d)=>s+Number(d.new_count||0),0);
      const totalLearn=flat.reduce((s,d)=>s+Number(d.learn_count||0),0);
      const totalReview=flat.reduce((s,d)=>s+Number(d.review_count||0),0);

      const renderNode=(d,depth=0)=>{
        const id=Number(d.deck_id||d.id||0);
        const children=d.children||[];
        const hasChildren=children.length>0;
        const current=id===Number(data.current_deck_id);
        return `
          <div class="anki-study-deck-node" data-deck-node="${id}">
            <div class="deck-row anki-study-deck-row ${current?'current':''}" style="--deck-depth:${Math.max(0,Number(d.level??depth))}">
              <button type="button" class="anki-study-deck-toggle ${hasChildren && !d.collapsed?'open':''}" data-deck-expand="${id}" ${hasChildren?'':'disabled'} title="${hasChildren?'Expandir/recolher':'Sem subbaralhos'}">›</button>
              <button type="button" class="anki-study-deck-name" data-anki-deck="${id}">${this.esc(d.name||'Baralho')}${d.filtered?' · filtrado':''}</button>
              <span class="anki-study-deck-counts">
                <span class="anki-study-count-new" title="Novos">${Number(d.new_count||0)}</span>
                <span class="anki-study-count-learn" title="Aprendendo">${Number(d.learn_count||0)}</span>
                <span class="anki-study-count-review" title="Revisão">${Number(d.review_count||0)}</span>
              </span>
              <button type="button" class="btn-secondary anki-study-deck-study" data-anki-deck="${id}">Estudar</button>
            </div>
            ${hasChildren?`<div class="anki-study-deck-children" ${d.collapsed?'hidden':''}>${children.map(ch=>renderNode(ch,depth+1)).join('')}</div>`:''}
          </div>`;
      };

      root.innerHTML=`
        <section class="card anki-study-decks-card">
          <div class="card-header">
            <div>
              <h2>📁 Baralhos</h2>
              <p class="sub">Hierarquia e contagens fornecidas pelo scheduler oficial do Anki.</p>
            </div>
            <button type="button" class="btn-primary" id="anki-create-deck">＋ Criar baralho</button>
          </div>
          <div class="anki-study-deck-summary" style="padding:0 18px 14px">
            <span>Novos <b class="anki-study-count-new">${totalNew}</b></span>
            <span>Aprendendo <b class="anki-study-count-learn">${totalLearn}</b></span>
            <span>Revisão <b class="anki-study-count-review">${totalReview}</b></span>
          </div>
          <div class="anki-study-deck-list">${nodes.length?nodes.map(n=>renderNode(n)).join(''):'<div class="anki-study-empty">Nenhum baralho. Importe um pacote ou crie o primeiro baralho.</div>'}</div>
        </section>`;

      root.querySelectorAll('[data-anki-deck]').forEach(b=>b.onclick=async()=>{
        try{
          await this.request('/api/anki/decks/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck_id:Number(b.dataset.ankiDeck)})});
          this._sessionAnswered=0;this._sessionStartTotal=null;
          this.setView('review');
          await this.renderReviewer();
        }catch(e){this.alert(e.message,'error');}
      });
      root.querySelectorAll('[data-deck-expand]').forEach(b=>b.onclick=()=>{
        const node=b.closest('.anki-study-deck-node');
        const box=node&&node.querySelector(':scope > .anki-study-deck-children');
        if(!box)return;
        box.hidden=!box.hidden;
        b.classList.toggle('open',!box.hidden);
      });
      const create=document.getElementById('anki-create-deck');
      if(create) create.onclick=()=>void this.createDeck();
    } catch(e){ this.alert(e.message,'error'); }
  },

  async createDeck() {
    const name=prompt('Nome do novo baralho:');
    if(name==null||!name.trim()) return;
    try{
      await this.request('/api/anki/decks/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});
      this.alert('Baralho criado pelo Anki oficial.');
      await this.renderDecks();
    }catch(e){this.alert(e.message,'error');}
  },

  async renderReviewer(data) {
    const root=this.root(); if(!root) return;
    root.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">⏳</div><h3>Preparando revisão…</h3><p>Consultando a fila oficial do Anki.</p></div></div>';
    try {
      const q=data || await this.request('/api/anki/reviewer/next');
      this.review=q; this.reviewStartedAt=Date.now(); this._answerShown=false;
      if(q.finished){
        root.innerHTML=`<div class="card"><div class="cards-review-done"><div class="big">✅</div><h3>Tudo em dia por aqui!</h3><p>Não há cards disponíveis neste baralho agora.</p><button type="button" class="btn-secondary" id="anki-review-decks">Ver baralhos</button></div></div>`;
        const back=document.getElementById('anki-review-decks');
        if(back) back.onclick=()=>{this.setView('decks');void this.renderDecks();};
        return;
      }

      const card=q.card;
      const remaining=Number(q.counts.new||0)+Number(q.counts.learning||0)+Number(q.counts.review||0);
      if(this._sessionStartTotal==null) this._sessionStartTotal=Math.max(1,remaining);
      this._sessionStartTotal=Math.max(this._sessionStartTotal,this._sessionAnswered+remaining);
      const pct=Math.max(0,Math.min(100,Math.round((this._sessionAnswered/Math.max(1,this._sessionStartTotal))*100)));
      const srcdoc=await this.htmlWithMedia(card.question);
      const flagColors=['','#e0393f','#d97a12','#0f9d63','#2563eb','#7c3aed','#db2777','#06b6d4'];
      const flags=[1,2,3,4,5,6,7].map(n=>`<button type="button" class="anki-study-flag ${Number(card.flag)===n?'on':''}" data-anki-flag="${n}" style="--fl:${flagColors[n]}" title="Bandeira ${n}"></button>`).join('');

      root.innerHTML=`
        <div class="card cards-review-wrap anki-study-review-card">
          <div class="cards-review-progress">
            <span>${this._sessionAnswered} respondidos</span>
            <div class="cards-review-bar"><div style="width:${pct}%"></div></div>
            <span class="cards-limit-chip" title="Contagens da fila oficial">🆕 ${q.counts.new} · ⏳ ${q.counts.learning} · 🔄 ${q.counts.review}</span>
          </div>

          <div class="cards-review-meta">
            <span class="cards-type-tag">📁 ${this.esc(card.deck_name||('Deck '+card.deck_id))}</span>
            ${card.notetype_name?`<span class="cards-type-tag">${this.esc(card.notetype_name)}</span>`:''}
            <span class="anki-study-review-meta-spacer"></span>
            <button type="button" class="cards-fav-star ${card.marked?'on':''}" id="anki-review-mark" title="Marcar/desmarcar nota">${card.marked?'★':'☆'}</button>
          </div>

          <div class="cards-face cards-front anki-study-review-face" id="anki-study-review-face">
            <iframe class="anki-study-card-frame" id="anki-official-card-frame" sandbox="allow-scripts" title="Card Anki"></iframe>
          </div>

          <div class="cards-review-actions anki-study-review-actions" id="anki-official-answer-buttons">
            <button type="button" class="btn-primary cards-flip" id="anki-official-show-answer">Mostrar resposta <kbd>Espaço</kbd></button>
          </div>

          <div class="cards-review-nav">
            <div class="anki-study-review-nav-left">
              <button type="button" class="icon-btn" id="anki-review-edit">✎ Editar</button>
              <button type="button" class="icon-btn" data-anki-card-action="bury">⤓ Enterrar</button>
              <button type="button" class="icon-btn" data-anki-card-action="suspend">🚫 Suspender</button>
              <button type="button" class="icon-btn" data-anki-card-action="forget">↺ Esquecer</button>
              <button type="button" class="icon-btn" id="anki-review-due">📅 Data</button>
              <button type="button" class="icon-btn" id="anki-review-info">ℹ Info</button>
              <button type="button" class="icon-btn" id="anki-review-delete">🗑</button>
            </div>
            <span class="cards-flagbar" title="Bandeiras do Anki">${flags}</span>
          </div>

          <div class="cards-kbd-hint-row">
            <span class="cards-kbd-hint">
              <kbd>Espaço</kbd> resposta · <kbd>1</kbd>–<kbd>4</kbd> avaliar ·
              <kbd>E</kbd> editar · <kbd>-</kbd> enterrar · <kbd>@</kbd> suspender ·
              <kbd>*</kbd> marcar · <kbd>I</kbd> info · <kbd>Ctrl+Z</kbd> desfazer
            </span>
          </div>
        </div>`;

      const face=document.getElementById('anki-study-review-face');
      const frame=document.getElementById('anki-official-card-frame');
      if(frame) frame.srcdoc=srcdoc;
      const focusInfo=document.getElementById('anki-foco-info');
      if(focusInfo) focusInfo.textContent='Anki Oficial · '+(card.deck_name||'Revisão');
      void this.playAv(card.question_av_tags||[]);

      const show=document.getElementById('anki-official-show-answer');
      if(show) show.onclick=()=>void this.showAnswer();

      root.querySelectorAll('[data-anki-card-action]').forEach(btn=>btn.onclick=()=>void this.cardAction(btn.dataset.ankiCardAction,card.id,true));
      root.querySelectorAll('[data-anki-flag]').forEach(btn=>btn.onclick=()=>void this.setFlag(card.id,Number(btn.dataset.ankiFlag)));
      const mark=document.getElementById('anki-review-mark'); if(mark) mark.onclick=()=>void this.toggleMark(card.id);
      const edit=document.getElementById('anki-review-edit'); if(edit) edit.onclick=()=>void this.openEditNote(card.id);
      const due=document.getElementById('anki-review-due'); if(due) due.onclick=()=>void this.setDue(card.id);
      const info=document.getElementById('anki-review-info'); if(info) info.onclick=()=>void this.showCardInfo(card.id);
      const del=document.getElementById('anki-review-delete'); if(del) del.onclick=()=>void this.deleteCard(card.id);
    } catch(e){ this.alert(e.message,'error'); }
  },

  async showAnswer() {
    if(!this.review||!this.review.card||this._answerShown) return;
    const card=this.review.card;
    const frame=document.getElementById('anki-official-card-frame');
    const face=document.getElementById('anki-study-review-face');
    const actions=document.getElementById('anki-official-answer-buttons');
    try{
      const answerDoc=await this.htmlWithMedia(card.answer);
      if(frame) frame.srcdoc=answerDoc;
      if(face){face.classList.remove('cards-front');face.classList.add('cards-back');}
      this._answerShown=true;
      if(actions){
        const names=['Errei','Difícil','Bom','Fácil'];
        const classes=['a-errei','a-dificil','a-bom','a-facil'];
        actions.innerHTML=(card.buttons||[]).map(b=>`
          <button type="button" class="cards-ans4 ${classes[b.rating-1]||''}" data-rating="${b.rating}">
            <span class="a-kbd">${b.rating}</span>
            <strong>${names[b.rating-1]||b.rating}</strong>
            <small>${this.esc(b.label||'')}</small>
          </button>`).join('');
        actions.querySelectorAll('[data-rating]').forEach(btn=>btn.onclick=()=>void this.answer(Number(btn.dataset.rating)));
      }
      void this.playAv(card.answer_av_tags||[]);
    }catch(e){this.alert(e.message,'error');}
  },

  async answer(rating) {
    if(!this.review || !this.review.card) return;
    try {
      const next=await this.request('/api/anki/reviewer/answer',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({card_id:this.review.card.id,rating,milliseconds_taken:Math.max(0,Date.now()-this.reviewStartedAt)})
      });
      this._sessionAnswered++;
      await this.renderReviewer(next);
    } catch(e){ this.alert(e.message,'error'); }
  },

  async cardAction(action, cardId, advance) {
    try {
      await this.request('/api/anki/cards/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,card_ids:[cardId]})});
      if(advance) await this.renderReviewer();
      else if(this.review) await this.renderReviewer(this.review);
    } catch(e){ this.alert(e.message,'error'); }
  },

  async toggleMark(cardId) {
    try{
      await this.request('/api/anki/cards/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'mark',card_ids:[cardId]})});
      if(this.review&&this.review.card){this.review.card.marked=!this.review.card.marked;await this.renderReviewer(this.review);}
    }catch(e){this.alert(e.message,'error');}
  },

  async setFlag(cardId, flag) {
    try{
      const current=this.review&&this.review.card?Number(this.review.card.flag||0):0;
      const value=current===flag?0:flag;
      await this.request('/api/anki/cards/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'flag',card_ids:[cardId],value})});
      if(this.review&&this.review.card){this.review.card.flag=value;await this.renderReviewer(this.review);}
    }catch(e){this.alert(e.message,'error');}
  },

  async setDue(cardId) {
    const value=prompt('Nova data relativa do Anki (ex.: 5 ou 5-7):','5');
    if(value==null||!value.trim())return;
    try{
      await this.request('/api/anki/cards/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_due',card_ids:[cardId],value:value.trim()})});
      this.alert('Data atualizada pelo scheduler oficial.');
      await this.renderReviewer();
    }catch(e){this.alert(e.message,'error');}
  },

  async deleteCard(cardId) {
    if(!confirm('Excluir a nota deste card da coleção Anki?')) return;
    try{
      await this.request('/api/anki/cards/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete_notes',card_ids:[cardId]})});
      this.alert('Nota excluída da coleção Anki.');
      await this.renderReviewer();
    }catch(e){this.alert(e.message,'error');}
  },

  openModal(title, subtitle, bodyHtml, footHtml) {
    this.closeModal();
    const modal=document.createElement('div');
    modal.className='cards-modal';
    modal.id='anki-study-modal';
    modal.innerHTML=`<div class="cards-modal-box cards-modal-lg">
      <div class="cards-modal-head"><div><h2>${this.esc(title)}</h2><p class="sub">${this.esc(subtitle||'')}</p></div><button type="button" class="icon-btn" id="anki-modal-close">✕</button></div>
      <div class="cards-modal-body">${bodyHtml}</div>
      <div class="cards-modal-foot">${footHtml||'<button type="button" class="btn-secondary" id="anki-modal-ok">Fechar</button>'}</div>
    </div>`;
    document.body.appendChild(modal);
    const close=()=>this.closeModal();
    document.getElementById('anki-modal-close').onclick=close;
    const ok=document.getElementById('anki-modal-ok');if(ok)ok.onclick=close;
    modal.addEventListener('click',e=>{if(e.target===modal)close();});
    return modal;
  },

  closeModal() {
    const m=document.getElementById('anki-study-modal');if(m)m.remove();
  },

  async openEditNote(cardId) {
    try{
      const detail=await this.request('/api/anki/card/'+cardId+'/detail');
      const fields=Object.entries(detail.fields||{}).map(([name,value])=>`<div class="field"><label>${this.esc(name)}</label><textarea data-anki-edit-field="${this.esc(name)}">${this.esc(value)}</textarea></div>`).join('');
      this.openModal('Editar nota',detail.notetype_name||'Anki Oficial',
        `<div class="anki-study-modal-fields">${fields}<div class="field"><label>Tags</label><input id="anki-edit-tags" value="${this.esc((detail.tags||[]).join(' '))}"></div></div>`,
        '<button type="button" class="btn-secondary" id="anki-edit-cancel">Cancelar</button><button type="button" class="btn-primary" id="anki-edit-save">Salvar</button>');
      document.getElementById('anki-edit-cancel').onclick=()=>this.closeModal();
      document.getElementById('anki-edit-save').onclick=async()=>{
        const values={};
        document.querySelectorAll('#anki-study-modal [data-anki-edit-field]').forEach(el=>values[el.dataset.ankiEditField]=el.value);
        const tags=(document.getElementById('anki-edit-tags').value||'').split(/\s+/).filter(Boolean);
        try{
          await this.request('/api/anki/note/'+detail.note_id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:values,tags})});
          this.closeModal();this.alert('Nota atualizada pelo Anki oficial.');
          if(this.view==='review') await this.renderReviewer(); else await this.renderBrowser();
        }catch(e){this.alert(e.message,'error');}
      };
    }catch(e){this.alert(e.message,'error');}
  },

  async showCardInfo(cardId) {
    try{
      const [detail,stats]=await Promise.all([
        this.request('/api/anki/card/'+cardId+'/detail'),
        this.request('/api/anki/card/'+cardId+'/stats')
      ]);
      const rows=[
        ['Card',detail.card_id],['Nota',detail.note_id],['Baralho',detail.deck_name],
        ['Tipo',detail.notetype_name],['Intervalo',detail.interval],['Repetições',detail.reps],
        ['Lapses',detail.lapses],['Due',detail.due],['Fila',detail.queue],['Flag',detail.flag||0]
      ].map(([k,v])=>`<dt>${this.esc(k)}</dt><dd>${this.esc(v)}</dd>`).join('');
      this.openModal('Informações do card','Dados lidos diretamente da coleção Anki',
        `<dl class="anki-study-info-grid">${rows}</dl><details style="margin-top:14px"><summary>Dados oficiais completos</summary><pre class="hint" style="white-space:pre-wrap">${this.esc(JSON.stringify(stats,null,2))}</pre></details>`);
    }catch(e){this.alert(e.message,'error');}
  },

  onKey(e) {
    const screen=document.getElementById('screen-anki');
    if(!screen||!screen.classList.contains('active')) return;
    if(e.target&&/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if(e.key==='Escape'&&document.body.classList.contains('anki-foco')){e.preventDefault();document.body.classList.remove('anki-foco');return;}
    if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();void this.simplePost('/api/anki/undo');return;}
    if(this.view!=='review'||!this.review||!this.review.card)return;
    const click=id=>{const b=document.getElementById(id);if(b)b.click();};
    if(e.code==='Space'){e.preventDefault();if(!this._answerShown)click('anki-official-show-answer');return;}
    if(this._answerShown&&/^Digit[1-4]$/.test(e.code)){
      e.preventDefault();const b=document.querySelector('#anki-official-answer-buttons [data-rating="'+e.code.slice(5)+'"]');if(b)b.click();return;
    }
    if(e.code==='KeyE'){e.preventDefault();click('anki-review-edit');return;}
    if(e.code==='KeyI'){e.preventDefault();click('anki-review-info');return;}
    if(e.key==='-'){e.preventDefault();const b=document.querySelector('#anki-official-root [data-anki-card-action="bury"]');if(b)b.click();return;}
    if(e.key==='@'||(e.shiftKey&&e.code==='Digit2')){e.preventDefault();const b=document.querySelector('#anki-official-root [data-anki-card-action="suspend"]');if(b)b.click();return;}
    if(e.key==='*'||(e.shiftKey&&e.code==='Digit8')){e.preventDefault();click('anki-review-mark');}
  },

  async playAv(tags) {
    for(const tag of tags||[]){
      if(tag.kind==='tts'){
        this.alert('Este card contém TTS. O backend oficial fornece a fila TTS, mas o player Qt/vozes do Desktop não existe no navegador.', 'warn');
        continue;
      }
      if(tag.kind!=='media' || !tag.filename) continue;
      try {
        const blob=await this.fetchBlob('/api/anki/media/'+encodeURIComponent(tag.filename));
        const url=URL.createObjectURL(blob); this._blobUrls.push(url);
        await new Promise(resolve=>{
          const a=new Audio(url); a.onended=resolve; a.onerror=resolve;
          const p=a.play(); if(p&&p.catch) p.catch(resolve);
        });
      } catch(_) {}
    }
  },

  async renderBrowser() {
    const root=this.root(); if(!root) return;
    root.innerHTML=`
      <div class="anki-official-browser-head">
        <input id="anki-official-search" type="search" placeholder="Busca oficial do Anki: deck:, tag:, is:due, prop:…">
        <button type="button" class="btn-primary" id="anki-official-search-btn">Buscar</button>
      </div>
      <div class="anki-official-browser-list" id="anki-official-browser-list"></div>`;
    const run=async()=>{
      const q=document.getElementById('anki-official-search').value||'';
      try {
        const data=await this.request('/api/anki/browser/search?q='+encodeURIComponent(q)+'&limit=200');
        const list=document.getElementById('anki-official-browser-list');
        list.innerHTML=(data.cards||[]).map(c=>`
          <div class="anki-official-browser-row">
            <div><div class="anki-official-browser-question">${this.esc((new DOMParser().parseFromString(c.question||'','text/html').body.textContent||'').trim())}</div>
            <div class="hint">Card ${c.card_id} · Nota ${c.note_id}</div></div>
            <div class="anki-official-browser-meta">ivl ${c.interval} · reps ${c.reps} · lapses ${c.lapses}</div>
          </div>`).join('') || '<div class="card"><div class="card-body">Nenhum resultado.</div></div>';
      } catch(e){ this.alert(e.message,'error'); }
    };
    document.getElementById('anki-official-search-btn').onclick=()=>void run();
    document.getElementById('anki-official-search').addEventListener('keydown',e=>{if(e.key==='Enter') void run();});
    void run();
  },

  async renderAdd() {
    const root=this.root(); if(!root) return;
    try {
      const [decks,nts]=await Promise.all([this.request('/api/anki/decks'),this.request('/api/anki/notetypes')]);
      const notetypes=nts.notetypes||[];
      root.innerHTML=`
        <div class="anki-official-form">
          <div class="field"><label>Baralho</label><select id="anki-add-deck">${(decks.decks||[]).map(d=>`<option value="${d.id}" ${Number(d.id)===Number(decks.current_deck_id)?'selected':''}>${this.esc(d.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Tipo de nota</label><select id="anki-add-nt">${notetypes.map(n=>`<option value="${n.id}">${this.esc(n.name)}</option>`).join('')}</select></div>
          <div id="anki-add-fields"></div>
          <div class="field"><label>Tags</label><input id="anki-add-tags" placeholder="tag1 tag2"></div>
          <button type="button" class="btn-primary" id="anki-add-save">Adicionar com o Anki oficial</button>
        </div>`;

      const ntSelect=document.getElementById('anki-add-nt');
      const fieldsBox=document.getElementById('anki-add-fields');
      const renderFields=()=>{
        const nt=notetypes.find(n=>String(n.id)===String(ntSelect.value)) || notetypes[0];
        const fields=(nt&&nt.fields)||[];
        fieldsBox.innerHTML=fields.map((name,i)=>`
          <div class="field">
            <label>${this.esc(name)}</label>
            <textarea data-anki-add-field="${i}" data-anki-field-name="${this.esc(name)}"></textarea>
          </div>`).join('') || '<p class="hint">Este tipo de nota não expôs campos editáveis.</p>';
      };
      ntSelect.addEventListener('change', renderFields);
      renderFields();

      document.getElementById('anki-add-save').onclick=async()=>{
        try{
          const fields={};
          fieldsBox.querySelectorAll('[data-anki-field-name]').forEach(el=>{
            fields[el.dataset.ankiFieldName]=el.value;
          });
          const body={
            deck_id:Number(document.getElementById('anki-add-deck').value),
            notetype_id:Number(ntSelect.value),
            fields,
            tags:(document.getElementById('anki-add-tags').value||'').split(/\s+/).filter(Boolean)
          };
          await this.request('/api/anki/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          this.alert('Nota adicionada pelo backend oficial do Anki.');
          fieldsBox.querySelectorAll('textarea').forEach(el=>{el.value='';});
        }catch(e){this.alert(e.message,'error');}
      };
    } catch(e){this.alert(e.message,'error');}
  },

  async renderOptions() {
    const root=this.root(); if(!root) return;
    try {
      const decks=await this.request('/api/anki/decks');
      const did=Number(decks.current_deck_id);
      const current=(decks.decks||[]).find(d=>Number(d.id)===did);
      const data=await this.request('/api/anki/deck/'+did+'/options');
      const presets=Array.isArray(data.all_config)?data.all_config.length:0;
      root.innerHTML=`
        <div class="ankidroid-settings-page">
          <div class="ankidroid-settings-title">Baralho atual</div>
          <div class="ankidroid-settings-card">
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">▤</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">${this.esc(current&&current.name||'Baralho')}</div><div class="ankidroid-setting-desc">Configuração fornecida pelo backend oficial do Anki.</div></div>
              <div class="ankidroid-setting-value">ID ${did}</div>
            </div>
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">◔</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">FSRS</div><div class="ankidroid-setting-desc">Estado do scheduler para este conjunto de opções.</div></div>
              <div class="ankidroid-setting-value ${data.fsrs?'ankidroid-status-good':''}">${data.fsrs?'Ativado':'Desativado'}</div>
            </div>
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">⚙</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">Presets</div><div class="ankidroid-setting-desc">Configurações retornadas por DeckConfigsForUpdate.</div></div>
              <div class="ankidroid-setting-value">${presets}</div>
            </div>
          </div>
          <details class="ankidroid-advanced">
            <summary>Opções avançadas oficiais</summary>
            <div class="ankidroid-advanced-body">
              <p class="hint">Edição integral do objeto oficial. O Study não recalcula nem interpreta os parâmetros.</p>
              <textarea class="anki-official-json" id="anki-options-json">${this.esc(JSON.stringify(data,null,2))}</textarea>
              <div class="ankidroid-settings-actions"><button type="button" class="btn-primary" id="anki-options-save">Salvar no Anki oficial</button></div>
            </div>
          </details>
        </div>`;
      document.getElementById('anki-options-save').onclick=async()=>{
        try{
          const payload=JSON.parse(document.getElementById('anki-options-json').value);
          const saved=await this.request('/api/anki/deck/'+did+'/options',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          document.getElementById('anki-options-json').value=JSON.stringify(saved,null,2);
          this.alert('Opções salvas pelo Anki oficial.');
        }catch(e){this.alert(e.message,'error');}
      };
    }catch(e){this.alert(e.message,'error');}
  },

  async renderTools() {
    const root=this.root(); if(!root) return;
    try {
      const [st,media,cols]=await Promise.all([
        this.request('/api/anki/status'),
        this.request('/api/anki/media/check'),
        this.request('/api/anki/browser/columns')
      ]);
      const missing=(media.missing||media.missing_files||[]).length||0;
      const unused=(media.unused||media.unused_files||[]).length||0;
      root.innerHTML=`
        <div class="ankidroid-settings-page">
          <div class="ankidroid-settings-title">Anki</div>
          <div class="ankidroid-settings-card">
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">★</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">Engine oficial</div><div class="ankidroid-setting-desc">Coleção ${this.esc(st.collection_path)} · ${st.cards} cards · ${st.notes} notas</div></div>
              <div class="ankidroid-setting-value ankidroid-status-good">${this.esc(st.runtime_version)}</div>
            </div>
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">▧</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">Navegador</div><div class="ankidroid-setting-desc">Colunas expostas pelo backend oficial.</div></div>
              <div class="ankidroid-setting-value">${(cols.columns||[]).length}</div>
            </div>
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">♪</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">Mídia</div><div class="ankidroid-setting-desc">Resultado do Check Media oficial.</div></div>
              <div class="ankidroid-setting-value ${missing?'ankidroid-status-warn':'ankidroid-status-good'}">${missing} faltando · ${unused} sem uso</div>
            </div>
          </div>

          <div class="ankidroid-settings-title">Manutenção</div>
          <div class="ankidroid-settings-card">
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">✓</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">Verificar banco</div><div class="ankidroid-setting-desc">Executa o Check Database oficial e reconstrói caches quando necessário.</div></div>
              <button type="button" class="btn-secondary" id="anki-db-check">Executar</button>
            </div>
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">↻</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">Otimizar coleção</div><div class="ankidroid-setting-desc">Executa VACUUM/ANALYZE pela Collection oficial.</div></div>
              <button type="button" class="btn-secondary" id="anki-db-optimize">Otimizar</button>
            </div>
            <div class="ankidroid-setting-row">
              <div class="ankidroid-setting-icon">⌁</div>
              <div class="ankidroid-setting-main"><div class="ankidroid-setting-name">Servidor da engine</div><div class="ankidroid-setting-desc">${this.esc(this.apiBase())}</div></div>
              <button type="button" class="btn-secondary" id="anki-official-change-api">Alterar</button>
            </div>
          </div>

          <div class="anki-official-boundary">
            <strong>Arquitetura web</strong>
            Scheduler, FSRS, coleção, busca e operações são do Anki oficial. Recursos que dependem do processo Qt/PyQt do Desktop continuam fora desta interface web.
          </div>
        </div>`;
      document.getElementById('anki-official-change-api').onclick=()=>this.setApiUrl();
      document.getElementById('anki-db-check').onclick=async()=>{
        try{
          const out=await this.request('/api/anki/database/check',{method:'POST'});
          this.alert((out.ok?'Banco íntegro. ':'Foram encontrados/reparados problemas. ')+(out.message||''));
        }catch(e){this.alert(e.message,'error');}
      };
      document.getElementById('anki-db-optimize').onclick=async()=>{
        try{
          await this.request('/api/anki/database/optimize',{method:'POST'});
          this.alert('Banco otimizado pelo Anki oficial.');
        }catch(e){this.alert(e.message,'error');}
      };
    }catch(e){this.alert(e.message,'error');}
  }
};

window.AnkiOfficial = AnkiOfficial;
window.addEventListener('screen:activated', (ev) => {
  const screen = ev.detail && ev.detail.screen;
  document.body.classList.toggle('anki-mobile-immersive', screen === 'anki');
  if (screen === 'anki') void AnkiOfficial.activate();
});
