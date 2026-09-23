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
    root.innerHTML='<div class="ankidroid-loading"><div class="ankidroid-spinner" aria-hidden="true"></div><span>Carregando baralhos…</span></div>';
    try {
      const data=await this.request('/api/anki/decks');
      const tree=data.deck_tree||{};
      const roots=(Number(tree.deck_id||0)>0) ? [tree] : (tree.children||[]);
      const fallback=(data.decks||[]).map(d=>({
        deck_id:d.id,name:d.name,level:0,children:[],
        new_count:null,learn_count:null,review_count:null,filtered:false,collapsed:false
      }));
      const nodes=roots.length?roots:fallback;
      const totalNew=nodes.reduce((s,d)=>s+Number(d.new_count||0),0);
      const totalLearn=nodes.reduce((s,d)=>s+Number(d.learn_count||0),0);
      const totalReview=nodes.reduce((s,d)=>s+Number(d.review_count||0),0);
      const totalDue=totalNew+totalLearn+totalReview;

      const renderNode=(d,depth=0)=>{
        const id=Number(d.deck_id||d.id||0);
        const children=d.children||[];
        const hasChildren=children.length>0;
        const current=id===Number(data.current_deck_id);
        const count=(value,kind)=>value==null?'':`<span class="ankidroid-count ${kind}">${Number(value)}</span>`;
        return `
          <div class="ankidroid-deck-node" data-deck-node="${id}">
            <div class="ankidroid-deck-row ${current?'current':''}" style="--deck-level:${Math.max(0,Number(d.level??depth))}">
              <button type="button" class="ankidroid-deck-expander" data-deck-expand="${id}" aria-expanded="${hasChildren && !d.collapsed?'true':'false'}" ${hasChildren?'':'disabled'} aria-label="${hasChildren?'Expandir ou recolher baralho':'Sem subbaralhos'}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7z"/></svg>
              </button>
              <button type="button" class="ankidroid-deck-main" data-anki-deck="${id}">
                <span class="ankidroid-deck-name">${this.esc(d.name||'Baralho')}</span>
                ${d.filtered?'<span class="ankidroid-deck-filtered">filtrado</span>':''}
              </button>
              <button type="button" class="ankidroid-deck-counts" data-anki-deck="${id}" aria-label="Estudar este baralho">
                ${count(d.new_count,'new')}${count(d.learn_count,'learn')}${count(d.review_count,'review')}
              </button>
            </div>
            ${hasChildren?`<div class="ankidroid-deck-children" ${d.collapsed?'hidden':''}>${children.map(ch=>renderNode(ch,depth+1)).join('')}</div>`:''}
          </div>`;
      };

      root.innerHTML=`
        <div class="ankidroid-decks-head">
          <strong>${totalDue?this.esc(totalDue+' cartões para hoje'):'Baralhos'}</strong>
          <span><span class="ankidroid-count new">${totalNew}</span>&nbsp;&nbsp;<span class="ankidroid-count learn">${totalLearn}</span>&nbsp;&nbsp;<span class="ankidroid-count review">${totalReview}</span></span>
        </div>
        <div class="ankidroid-deck-list">${nodes.length?nodes.map(n=>renderNode(n)).join(''):'<div class="ankidroid-deck-empty"><strong>Nenhum baralho</strong>Importe um pacote ou adicione sua primeira nota.</div>'}</div>`;

      const study=async(btn)=>{
        try {
          await this.request('/api/anki/decks/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck_id:Number(btn.dataset.ankiDeck)})});
          this.setView('review');
          await this.renderReviewer();
        } catch(e){ this.alert(e.message,'error'); }
      };
      root.querySelectorAll('[data-anki-deck]').forEach(b=>b.onclick=()=>void study(b));
      root.querySelectorAll('[data-deck-expand]').forEach(b=>b.onclick=()=>{
        const node=b.closest('.ankidroid-deck-node');
        const box=node&&node.querySelector(':scope > .ankidroid-deck-children');
        if(!box) return;
        const open=box.hidden;
        box.hidden=!open;
        b.setAttribute('aria-expanded',open?'true':'false');
      });
    } catch(e){ this.alert(e.message,'error'); }
  },

  async renderReviewer(data) {
    const root=this.root(); if(!root) return;
    root.innerHTML='<div class="ankidroid-loading"><div class="ankidroid-spinner" aria-hidden="true"></div><span>Preparando revisão…</span></div>';
    try {
      const q=data || await this.request('/api/anki/reviewer/next');
      this.review=q; this.reviewStartedAt=Date.now();
      if(q.finished){
        root.innerHTML=`<div class="anki-official-finished"><h3>Parabéns!</h3><p>Você concluiu os cards disponíveis deste baralho.</p><button type="button" class="btn-primary" data-anki-view="decks">Voltar aos baralhos</button></div>`;
        const back=root.querySelector('[data-anki-view="decks"]');
        if(back) back.onclick=()=>{this.setView('decks');void this.renderDecks();};
        return;
      }
      const card=q.card;
      const srcdoc=await this.htmlWithMedia(card.question);
      root.innerHTML=`
        <div class="anki-official-review-shell">
          <div class="ankidroid-review-top">
            <div class="anki-official-counts" aria-label="Contadores do estudo">
              <span class="new" title="Novos">${q.counts.new}</span>
              <span class="learn" title="Aprendendo">${q.counts.learning}</span>
              <span class="review" title="Revisão">${q.counts.review}</span>
            </div>
            <div class="anki-official-card-tools">
              <button type="button" data-anki-card-action="bury" title="Enterrar" aria-label="Enterrar">⌄</button>
              <button type="button" data-anki-card-action="suspend" title="Suspender" aria-label="Suspender">⏸</button>
              <button type="button" data-anki-card-action="forget" title="Redefinir progresso" aria-label="Redefinir progresso">↺</button>
            </div>
          </div>
          <iframe class="anki-official-card-frame" id="anki-official-card-frame" sandbox="allow-scripts" title="Card Anki"></iframe>
          <button type="button" class="anki-official-reveal" id="anki-official-show-answer">Mostrar resposta</button>
          <div class="anki-official-review-actions" id="anki-official-answer-buttons" hidden></div>
        </div>`;
      const frame=document.getElementById('anki-official-card-frame'); if(frame) frame.srcdoc=srcdoc;
      void this.playAv(card.question_av_tags||[]);
      const show=document.getElementById('anki-official-show-answer');
      if(show) show.onclick=async()=>{
        const answerDoc=await this.htmlWithMedia(card.answer);
        if(frame) frame.srcdoc=answerDoc;
        show.hidden=true;
        const box=document.getElementById('anki-official-answer-buttons');
        if(box){
          box.hidden=false;
          box.innerHTML=(card.buttons||[]).map(b=>`<button type="button" data-rating="${b.rating}"><small>${this.esc(b.label)}</small><strong>${['Novamente','Difícil','Bom','Fácil'][b.rating-1]||b.rating}</strong></button>`).join('');
          box.querySelectorAll('[data-rating]').forEach(btn=>btn.onclick=()=>void this.answer(Number(btn.dataset.rating)));
        }
        void this.playAv(card.answer_av_tags||[]);
      };
      root.querySelectorAll('[data-anki-card-action]').forEach(btn=>btn.onclick=()=>void this.cardAction(btn.dataset.ankiCardAction,card.id));
    } catch(e){ this.alert(e.message,'error'); }
  },

  async answer(rating) {
    if(!this.review || !this.review.card) return;
    try {
      const next=await this.request('/api/anki/reviewer/answer',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({card_id:this.review.card.id,rating,milliseconds_taken:Math.max(0,Date.now()-this.reviewStartedAt)})
      });
      await this.renderReviewer(next);
    } catch(e){ this.alert(e.message,'error'); }
  },

  async cardAction(action, cardId) {
    try {
      await this.request('/api/anki/cards/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,card_ids:[cardId]})});
      await this.renderReviewer();
    } catch(e){ this.alert(e.message,'error'); }
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
