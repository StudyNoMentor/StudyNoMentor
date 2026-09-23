/* ═══════════════════════════════════════════════════════════════════════════
   ANKI OFICIAL — cliente fino para anki==26.09.2
   ---------------------------------------------------------------------------
   Regra arquitetural: este módulo NÃO usa FSRS/CardEngine/CardsConfig/DB cards
   do Study. Toda mutação acadêmica passa pelo backend oficial do Anki.
   ═══════════════════════════════════════════════════════════════════════════ */
const AnkiOfficial = {
  view: 'decks',
  status: null,
  review: null,
  reviewStartedAt: 0,
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
      badge.textContent = 'Engine: não conectada';
      badge.classList.remove('ok'); badge.classList.add('bad');
    }
    if (!root) return;
    const detail = error ? '<p class="hint">' + this.esc(error.message || error) + '</p>' : '';
    root.innerHTML = `
      <div class="card"><div class="card-body">
        <h3>Anki 26.09.2 oficial</h3>
        <p>O módulo está instalado no Study, mas precisa do serviço nativo Python/Rust para abrir a coleção <code>.anki2</code>.</p>
        ${detail}
        <button type="button" class="btn-primary" id="anki-official-set-api">Configurar URL do backend</button>
        <div class="anki-official-boundary">
          <strong>Sem fallback.</strong>
          Enquanto o backend oficial não estiver disponível, esta área não usa o scheduler, FSRS ou banco de Cards do Study.
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

  async activate() {
    this.bindStatic();
    if (!await this.ensureStatus()) return;
    await this.renderView();
  },

  bindStatic() {
    document.querySelectorAll('[data-anki-view]').forEach(btn => {
      if (btn.dataset.boundAnki) return;
      btn.dataset.boundAnki = '1';
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-anki-view]').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        this.view = btn.dataset.ankiView || 'decks';
        void this.renderView();
      });
    });
    const input = document.getElementById('anki-official-import');
    if (input && !input.dataset.boundAnki) {
      input.dataset.boundAnki = '1';
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (f) void this.importPackage(f);
        input.value = '';
      });
    }
    const apkg = document.getElementById('anki-official-export-apkg');
    if (apkg && !apkg.dataset.boundAnki) { apkg.dataset.boundAnki='1'; apkg.onclick=()=>void this.download('/api/anki/export/apkg','StudyNoMentor-Anki.apkg'); }
    const colpkg = document.getElementById('anki-official-export-colpkg');
    if (colpkg && !colpkg.dataset.boundAnki) { colpkg.dataset.boundAnki='1'; colpkg.onclick=()=>void this.download('/api/anki/export/colpkg','StudyNoMentor-Anki.colpkg'); }
    const undo = document.getElementById('anki-official-undo');
    if (undo && !undo.dataset.boundAnki) { undo.dataset.boundAnki='1'; undo.onclick=()=>void this.simplePost('/api/anki/undo'); }
    const redo = document.getElementById('anki-official-redo');
    if (redo && !redo.dataset.boundAnki) { redo.dataset.boundAnki='1'; redo.onclick=()=>void this.simplePost('/api/anki/redo'); }
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
    if (this.view === 'review') return this.renderReviewer();
    if (this.view === 'browser') return this.renderBrowser();
    if (this.view === 'add') return this.renderAdd();
    if (this.view === 'options') return this.renderOptions();
    if (this.view === 'tools') return this.renderTools();
    return this.renderDecks();
  },

  async renderDecks() {
    const root=this.root(); if(!root) return;
    root.innerHTML='<div class="card"><div class="card-body">Carregando baralhos do Anki…</div></div>';
    try {
      const data=await this.request('/api/anki/decks');
      const list=(data.decks||[]).map(d=>`
        <div class="anki-official-deck ${Number(d.id)===Number(data.current_deck_id)?'current':''}">
          <div class="anki-official-deck-name">${this.esc(d.name)}</div>
          <button type="button" class="btn-secondary" data-anki-deck="${this.esc(d.id)}">Estudar</button>
        </div>`).join('');
      root.innerHTML=`<div class="anki-official-grid">${list || '<div class="card"><div class="card-body">Nenhum baralho.</div></div>'}</div>`;
      root.querySelectorAll('[data-anki-deck]').forEach(b=>b.onclick=async()=>{
        try {
          await this.request('/api/anki/decks/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck_id:Number(b.dataset.ankiDeck)})});
          this.view='review';
          document.querySelectorAll('[data-anki-view]').forEach(x=>x.classList.toggle('active',x.dataset.ankiView==='review'));
          await this.renderReviewer();
        } catch(e){ this.alert(e.message,'error'); }
      });
    } catch(e){ this.alert(e.message,'error'); }
  },

  async renderReviewer(data) {
    const root=this.root(); if(!root) return;
    root.innerHTML='<div class="card"><div class="card-body">Consultando a fila oficial…</div></div>';
    try {
      const q=data || await this.request('/api/anki/reviewer/next');
      this.review=q; this.reviewStartedAt=Date.now();
      if(q.finished){
        root.innerHTML=`<div class="card anki-official-finished"><div class="card-body"><h3>Parabéns!</h3><p>A fila oficial deste baralho terminou.</p></div></div>`;
        return;
      }
      const c=q.card;
      const srcdoc=await this.htmlWithMedia(c.question);
      root.innerHTML=`
        <div class="anki-official-review-shell">
          <div class="anki-official-counts"><span>Novos: ${q.counts.new}</span><span>Aprendendo: ${q.counts.learning}</span><span>Revisão: ${q.counts.review}</span></div>
          <iframe class="anki-official-card-frame" id="anki-official-card-frame" sandbox="allow-scripts" title="Card Anki"></iframe>
          <button type="button" class="btn-primary anki-official-reveal" id="anki-official-show-answer">Mostrar resposta</button>
          <div class="anki-official-review-actions" id="anki-official-answer-buttons" hidden></div>
          <div class="anki-official-card-tools">
            <button type="button" class="btn-secondary" data-anki-card-action="bury">Enterrar</button>
            <button type="button" class="btn-secondary" data-anki-card-action="suspend">Suspender</button>
            <button type="button" class="btn-secondary" data-anki-card-action="forget">Esquecer</button>
          </div>
        </div>`;
      const frame=document.getElementById('anki-official-card-frame'); if(frame) frame.srcdoc=srcdoc;
      void this.playAv(c.question_av_tags||[]);
      const show=document.getElementById('anki-official-show-answer');
      if(show) show.onclick=async()=>{
        const answerDoc=await this.htmlWithMedia(c.answer);
        if(frame) frame.srcdoc=answerDoc;
        show.hidden=true;
        const box=document.getElementById('anki-official-answer-buttons');
        if(box){
          box.hidden=false;
          box.innerHTML=(c.buttons||[]).map(b=>`<button type="button" class="btn-secondary" data-rating="${b.rating}"><strong>${['Novamente','Difícil','Bom','Fácil'][b.rating-1]||b.rating}</strong><br><small>${this.esc(b.label)}</small></button>`).join('');
          box.querySelectorAll('[data-rating]').forEach(btn=>btn.onclick=()=>void this.answer(Number(btn.dataset.rating)));
        }
        void this.playAv(c.answer_av_tags||[]);
      };
      root.querySelectorAll('[data-anki-card-action]').forEach(btn=>btn.onclick=()=>void this.cardAction(btn.dataset.ankiCardAction,c.id));
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
      const data=await this.request('/api/anki/deck/'+did+'/options');
      root.innerHTML=`
        <p class="hint">Objeto oficial <code>DeckConfigsForUpdate</code> do Anki. Alterações são enviadas ao <code>update_deck_configs()</code> oficial.</p>
        <textarea class="anki-official-json" id="anki-options-json">${this.esc(JSON.stringify(data,null,2))}</textarea>
        <div style="margin-top:10px"><button type="button" class="btn-primary" id="anki-options-save">Salvar no Anki oficial</button></div>`;
      document.getElementById('anki-options-save').onclick=async()=>{
        try{
          const payload=JSON.parse(document.getElementById('anki-options-json').value);
          const saved=await this.request('/api/anki/deck/'+did+'/options',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          document.getElementById('anki-options-json').value=JSON.stringify(saved,null,2);
          this.alert('Deck Options salvas pelo Anki oficial.');
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
      root.innerHTML=`
        <div class="anki-official-grid">
          <div class="card"><div class="card-body"><h3>Engine</h3>
            <dl class="anki-official-kv"><dt>Versão</dt><dd>${this.esc(st.runtime_version)}</dd><dt>Cards</dt><dd>${st.cards}</dd><dt>Notas</dt><dd>${st.notes}</dd><dt>Coleção</dt><dd>${this.esc(st.collection_path)}</dd></dl>
          </div></div>
          <div class="card"><div class="card-body"><h3>Check Media oficial</h3><pre class="hint" style="white-space:pre-wrap">${this.esc(JSON.stringify(media,null,2))}</pre></div></div>
          <div class="card"><div class="card-body"><h3>Browser oficial</h3><p>${(cols.columns||[]).length} colunas expostas pelo backend do Anki.</p></div></div>
        </div>
        <div class="anki-official-actions">
          <button type="button" class="btn-secondary" id="anki-db-check">Check Database oficial</button>
          <button type="button" class="btn-secondary" id="anki-db-optimize">Otimizar banco</button>
          <button type="button" class="btn-secondary" id="anki-official-change-api">Configurar URL do backend</button>
        </div>
        <div class="anki-official-boundary">
          <strong>Limite real desta arquitetura web</strong>
          O backend/scheduler/coleção são oficiais. A GUI Qt/PyQt do Anki Desktop, seu player TTS nativo e add-ons Python/Qt tradicionais só existem dentro de um processo Anki Desktop; não podem ser executados diretamente por uma página web sem rodar o Desktop real.
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
  if (ev.detail && ev.detail.screen === 'anki') void AnkiOfficial.activate();
});
