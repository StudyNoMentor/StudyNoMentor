/* ============================================================
   TELA: CARDS DE REVISÃO
   ============================================================ */
const CardsScreen = {
  tab: 'revisar',
  filters: { busca: '', materias: new Set(), assuntos: new Set(), assunto: '', tipo: '', status: 'todos', favorito: false },
  _editingId: null,
  _editingPlanId: null, // origem do card global em edição; novo card usa o plano ativo
  _reviewQueue: [], _reviewIdx: 0, _flipped: false,
  _importParsed: null,

  render() {
    this.populateFilterOptions();
    this.renderContent();
    this.updateFavCount();
  },
  // ---- opções de filtro (matérias + baralhos, tópicos, tipos) ----
  collectionCards() {
    try { if (window.StudyGlobalScope && StudyGlobalScope.cards) return StudyGlobalScope.cards(); } catch (_) { if (typeof _quiet === 'function') _quiet(_, '44-tela-cards'); }
    return DB.getCards();
  },
  collectionDecks() {
    try { if (window.StudyGlobalScope && StudyGlobalScope.decks) return StudyGlobalScope.decks(); } catch (_) { if (typeof _quiet === 'function') _quiet(_, '44-tela-cards'); }
    return DB.getDecks();
  },
  materiaFilterOptions() {
    const cards = this.collectionCards();
    const nomes = [...new Set([].concat(
      DB.getActiveSubjects().map(s => s.nome),
      cards.map(c => c.materia).filter(Boolean)
    ))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }));
    const subjects = nomes.map(nome => ({ value: nome, label: nome, group: 'Disciplinas' }));
    const decks = this.collectionDecks()
      .slice()
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { numeric: true, sensitivity: 'base' }))
      .map(d => ({
        value: 'deck:' + d.id,
        label: '📁 ' + String(d.nome || '') + (d._planNome ? ' · ' + String(d._planNome) : ''),
        group: 'Baralhos'
      }));
    return subjects.concat(decks);
  },
  assuntoFilterOptions() {
    return [...new Set(this.collectionCards().map(c => c.assunto).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' }))
      .map(t => ({ value: String(t), label: String(t), group: 'Assuntos' }));
  },
  materiaOptionsHtml(selectedValue) {
    const opts = this.materiaFilterOptions();
    const html = (group) => opts.filter(o => o.group === group).map(o =>
      `<option value="${escapeHtml(o.value)}"${selectedValue === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
    ).join('');
    return { subs: html('Disciplinas'), decks: html('Baralhos') };
  },
  _filterSet(kind) {
    if (kind === 'materia') {
      if (!(this.filters.materias instanceof Set)) this.filters.materias = new Set(this.filters.materias || []);
      return this.filters.materias;
    }
    if (!(this.filters.assuntos instanceof Set)) {
      const legacy = this.filters.assunto ? [this.filters.assunto] : [];
      this.filters.assuntos = new Set(legacy);
    }
    return this.filters.assuntos;
  },
  _filterSummary(kind, options, allLabel) {
    const selected = this._filterSet(kind);
    if (!selected.size) return { text: allLabel, count: 0, title: allLabel };
    const labels = new Map(options.map(o => [String(o.value), String(o.label)]));
    const picked = [...selected].map(v => labels.get(String(v)) || String(v));
    if (picked.length === 1) return { text: picked[0], count: 1, title: picked[0] };
    return {
      text: picked.length + ' selecionados',
      count: picked.length,
      title: picked.join(', ')
    };
  },
  _closeMultiFilters(except) {
    document.querySelectorAll('#cards-filter-card .cards-multi-filter.open').forEach(host => {
      if (except && host === except) return;
      host.classList.remove('open');
      const btn = host.querySelector('.cards-multi-filter-btn');
      const panel = host.querySelector('.cards-multi-filter-panel');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (panel) panel.hidden = true;
    });
  },
  _syncNativeFilter(kind) {
    const selected = this._filterSet(kind);
    const el = document.getElementById(kind === 'materia' ? 'cards-f-materia' : 'cards-f-assunto');
    if (el) el.value = selected.size === 1 ? String([...selected][0]) : '';
    if (kind === 'assunto') this.filters.assunto = selected.size === 1 ? String([...selected][0]) : '';
  },
  _renderMultiFilter(kind, hostId, options, allLabel, searchPlaceholder) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const selected = this._filterSet(kind);
    const summary = this._filterSummary(kind, options, allLabel);
    const rows = [];
    let lastGroup = null;
    options.forEach(o => {
      if (o.group !== lastGroup) {
        lastGroup = o.group;
        rows.push(`<div class="cards-multi-filter-group">${escapeHtml(o.group || '')}</div>`);
      }
      const checked = selected.has(o.value);
      const norm = String(o.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      rows.push(`<label class="cards-multi-filter-option${checked ? ' selected' : ''}" data-filter-search="${escapeHtml(norm)}">
        <input type="checkbox" data-filter-value="${escapeHtml(o.value)}"${checked ? ' checked' : ''}>
        <span class="cards-multi-filter-check" aria-hidden="true">✓</span>
        <span class="cards-multi-filter-option-label">${escapeHtml(o.label)}</span>
      </label>`);
    });

    host.innerHTML = `
      <button type="button" class="cards-multi-filter-btn" aria-haspopup="listbox" aria-expanded="false" title="${escapeHtml(summary.title)}">
        <span class="cards-multi-filter-btn-label">${escapeHtml(summary.text)}</span>
        ${summary.count > 1 ? `<span class="cards-multi-filter-badge">${summary.count}</span>` : ''}
        <span class="cards-multi-filter-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="cards-multi-filter-panel" hidden>
        <div class="cards-multi-filter-search-wrap">
          <span aria-hidden="true">⌕</span>
          <input type="search" class="cards-multi-filter-search" autocomplete="off" placeholder="${escapeHtml(searchPlaceholder)}" aria-label="${escapeHtml(searchPlaceholder)}">
        </div>
        <div class="cards-multi-filter-tools">
          <span class="cards-multi-filter-selected">${selected.size ? selected.size + ' selecionado(s)' : 'Todos'}</span>
          <button type="button" class="cards-multi-filter-clear"${selected.size ? '' : ' disabled'}>Limpar seleção</button>
        </div>
        <div class="cards-multi-filter-options" role="listbox" aria-multiselectable="true">
          ${rows.join('') || '<div class="cards-multi-filter-empty">Nenhuma opção disponível.</div>'}
          <div class="cards-multi-filter-empty cards-multi-filter-empty-search" hidden>Nenhuma opção encontrada.</div>
        </div>
      </div>`;

    const btn = host.querySelector('.cards-multi-filter-btn');
    const panel = host.querySelector('.cards-multi-filter-panel');
    const search = host.querySelector('.cards-multi-filter-search');
    const clear = host.querySelector('.cards-multi-filter-clear');
    const optionsBox = host.querySelector('.cards-multi-filter-options');

    const refreshTrigger = () => {
      const now = this._filterSummary(kind, options, allLabel);
      const label = btn.querySelector('.cards-multi-filter-btn-label');
      const oldBadge = btn.querySelector('.cards-multi-filter-badge');
      if (label) label.textContent = now.text;
      btn.title = now.title;
      if (now.count > 1) {
        if (oldBadge) oldBadge.textContent = now.count;
        else {
          const badge = document.createElement('span');
          badge.className = 'cards-multi-filter-badge';
          badge.textContent = String(now.count);
          btn.insertBefore(badge, btn.querySelector('.cards-multi-filter-chevron'));
        }
      } else if (oldBadge) oldBadge.remove();
      const counter = host.querySelector('.cards-multi-filter-selected');
      if (counter) counter.textContent = selected.size ? selected.size + ' selecionado(s)' : 'Todos';
      if (clear) clear.disabled = !selected.size;
    };
    const apply = () => {
      this._syncNativeFilter(kind);
      this._reviewIdx = 0;
      this._meusMostrando = 0;
      this.invalidateReviewQueue();
      refreshTrigger();
      this.renderContent();
    };

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const opening = panel.hidden;
      this._closeMultiFilters(host);
      panel.hidden = !opening;
      host.classList.toggle('open', opening);
      btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) setTimeout(() => search && search.focus(), 0);
    });

    if (search) search.addEventListener('input', () => {
      const q = String(search.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      let shown = 0;
      host.querySelectorAll('.cards-multi-filter-option').forEach(row => {
        const hit = !q || String(row.dataset.filterSearch || '').includes(q);
        row.hidden = !hit;
        if (hit) shown++;
      });
      host.querySelectorAll('.cards-multi-filter-group').forEach(group => {
        let next = group.nextElementSibling, any = false;
        while (next && !next.classList.contains('cards-multi-filter-group')) {
          if (next.classList.contains('cards-multi-filter-option') && !next.hidden) any = true;
          next = next.nextElementSibling;
        }
        group.hidden = !any;
      });
      const empty = host.querySelector('.cards-multi-filter-empty-search');
      if (empty) empty.hidden = shown > 0 || options.length === 0;
    });

    if (optionsBox) optionsBox.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-filter-value]');
      if (!cb) return;
      const value = cb.dataset.filterValue;
      if (cb.checked) selected.add(value); else selected.delete(value);
      const row = cb.closest('.cards-multi-filter-option');
      if (row) row.classList.toggle('selected', cb.checked);
      apply();
    });

    if (clear) clear.addEventListener('click', () => {
      if (!selected.size) return;
      selected.clear();
      host.querySelectorAll('input[type="checkbox"][data-filter-value]').forEach(cb => { cb.checked = false; });
      host.querySelectorAll('.cards-multi-filter-option.selected').forEach(row => row.classList.remove('selected'));
      apply();
    });

    if (!this._multiFilterOutsideBound) {
      this._multiFilterOutsideBound = true;
      const closeOutside = (e) => {
        const open = [...document.querySelectorAll('#cards-filter-card .cards-multi-filter.open')];
        if (open.length && !open.some(item => item.contains(e.target))) this._closeMultiFilters();
      };
      // pointerdown fecha antes de qualquer mudança de foco; click é fallback
      // para navegadores/webviews que sintetizam clique sem Pointer Events.
      document.addEventListener('pointerdown', closeOutside, true);
      document.addEventListener('click', closeOutside, true);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.querySelector('#cards-filter-card .cards-multi-filter.open')) {
          this._closeMultiFilters();
        }
      }, true);
    }
  },
  populateFilterOptions() {
    const mSel = document.getElementById('cards-f-materia');
    const matterOptions = this.materiaFilterOptions();
    const selectedMatter = this._filterSet('materia');
    const oneMatter = selectedMatter.size === 1 ? String([...selectedMatter][0]) : '';
    const { subs, decks } = this.materiaOptionsHtml(oneMatter);
    mSel.innerHTML = `<option value="">Todas as disciplinas/baralhos</option>` + subs + decks;
    mSel.value = oneMatter;

    const assuntoOptions = this.assuntoFilterOptions();
    const selectedAssuntos = this._filterSet('assunto');
    const oneAssunto = selectedAssuntos.size === 1 ? String([...selectedAssuntos][0]) : '';
    const assuntoSel = $id('cards-f-assunto');
    assuntoSel.innerHTML = `<option value="">Todos os assuntos</option>` + assuntoOptions.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
    assuntoSel.value = oneAssunto;
    this.filters.assunto = oneAssunto;

    const tipos=[...new Set(this.collectionCards().map(c=>c.tipo).filter(Boolean))]
      .sort((a,b)=>String(a).localeCompare(String(b),'pt-BR',{numeric:true,sensitivity:'base'}));
    $id('cards-f-tipo').innerHTML = `<option value="">Todos os tipos</option>` + tipos.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

    this._renderMultiFilter('materia', 'cards-f-materia-multi', matterOptions, 'Todas as disciplinas/baralhos', 'Buscar disciplina ou baralho…');
    this._renderMultiFilter('assunto', 'cards-f-assunto-multi', assuntoOptions, 'Todos os assuntos', 'Buscar assunto…');
  },
  destinationDecks(planId) {
    // Card global continua pertencendo ao planejamento onde nasceu. Ao editá-lo
    // de outra visão, o seletor precisa enxergar os baralhos DA ORIGEM; usar
    // DB.getDecks() aqui mostrava somente o plano atual e fazia o destino sumir.
    if (planId && DB.getDecksForPlan) {
      const list = DB.getDecksForPlan(planId);
      if (Array.isArray(list)) return list;
    }
    return DB.getDecks();
  },
  destinoOptionsHtml(selected, planId, todosOsPlanos) {
    // O destino de um card novo é sempre um baralho ("deck:id") — a disciplina
    // ficou pro campo Matéria (Tec), texto livre, sem duplicar o que já é feito
    // aqui pelo baralho. Em edição global, usa o catálogo do plano de origem.
    // Card NOVO pode nascer em qualquer baralho visível: é gravado no
    // planejamento dono do baralho escolhido (saveCard). Edição e importação
    // continuam presas ao plano de origem/ativo.
    const lista = todosOsPlanos
      ? this.collectionDecks().filter(d => !(typeof AnkiParity !== 'undefined' && AnkiParity.isFilteredDeck(d)))
          .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { numeric: true, sensitivity: 'base' }))
      : this.destinationDecks(planId);
    const deckOpts = lista.map(d =>
      `<option value="deck:${d.id}"${selected === 'deck:' + d.id ? ' selected' : ''}>📁 ${escapeHtml(d.nome)}${d._planNome && String(d._planId) !== String(PlanManager.getActivePlanId()) ? ' · ' + escapeHtml(d._planNome) : ''}</option>`
    ).join('');
    // Cards antigos podiam ter uma disciplina como destino, sem baralho nenhum
    // ("sub:Nome"). Editar um desses não pode fazer o destino atual sumir da
    // lista sozinho — mantém só essa opção, sem reoferecer as outras disciplinas.
    const legadoOpt = (selected && selected.indexOf('sub:') === 0)
      ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected.slice(4))} (disciplina, sem baralho)</option>` : '';
    /* BUG CORRIGIDO — perfil novo não conseguia criar o PRIMEIRO card.
       Sem baralho criado, este seletor vinha só com o texto de instrução. Ao
       salvar, o app pedia "Escolha o destino" apontando para uma lista vazia:
       beco sem saída, achado simulando o uso real. O Anki resolve isso tendo
       SEMPRE um baralho "Padrão". É o que fazemos: quando não há nenhum
       baralho, oferecemos "📁 Padrão", criado na hora em que o card for salvo. */
    if (!deckOpts && !legadoOpt) {
      return `<option value="">Escolha onde este card fica...</option>`
        + `<option value="novo:Padrão"${selected === 'novo:Padrão' ? ' selected' : ''}>📁 Padrão</option>`;
    }
    return `<option value="">Escolha onde este card fica...</option>` + legadoOpt + deckOpts;
  },
  currentFilteredCards() {
    const f=this.filters||{},busca=String(f.busca||'').trim().toLowerCase(),
      materias=f.materias instanceof Set?f.materias:new Set(Array.isArray(f.materias)?f.materias:[]),
      assuntos=f.assuntos instanceof Set?f.assuntos:new Set(Array.isArray(f.assuntos)?f.assuntos:[]);
    let out=this.collectionCards().filter(c=>{
      if(materias.size&&!(c.materia&&materias.has(c.materia))&&!(c.deckId&&materias.has('deck:'+c.deckId)))return false;
      if(assuntos.size?!assuntos.has(c.assunto||''):(f.assunto&&(c.assunto||'')!==f.assunto))return false;
      if(f.tipo&&(c.tipo||'')!==f.tipo)return false;
      if(f.status&&f.status!=='todos'&&(c.status||'pendente')!==f.status)return false;
      if(f.favorito&&!c.favorito)return false;
      if(busca){
        const hay=((c.frente||'')+' '+(c.verso||'')+' '+(c.assunto||'')+' '+(c.materia||'')+' '+(c.materiaTec||''))
          .toLowerCase().replace(/<[^>]+>/g,' ');
        if(!hay.includes(busca))return false;
      }
      return true;
    });
    try { if (window.StudyGlobalScope && StudyGlobalScope.filterCardsByBanca) out = StudyGlobalScope.filterCardsByBanca(out); } catch (_) { if (typeof _quiet === 'function') _quiet(_, '44-tela-cards'); }
    return out;
  },
  updateFavCount() {
    const n = this.collectionCards().filter(c => c.favorito).length;
    const el = document.getElementById('cards-fav-count'); if (el) el.textContent = n;
  },

  _mirrorRevlog() {
    try{if(window.StudyGlobalScope&&StudyGlobalScope.revlog)return StudyGlobalScope.revlog();}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-mirror-revlog');}
    return DB.getRevlog()||[];
  },

  // ---- conteúdo (revisar ou meus cards) ----  // ---- conteúdo (revisar ou meus cards) ----
  renderContent() {
    const box = document.getElementById('cards-content');
    if (this.tab !== 'revisar' && this._autoAdvanceEnabled) this._disableAutoAdvanceSilently();
    if (this.tab === 'revisar') this.renderRevisar(box);
    else if (this.tab === 'stats') this.renderStats(box);
    else this.renderMeus(box);
  },
  invalidateReviewQueue(){
    this._reviewQueue=[];this._reviewIdx=0;this._reviewCardId=null;this._flipped=false;
  },
  materiaLabel(c){
    if(c.deckId){
      let d=null;try{d=window.StudyGlobalScope&&StudyGlobalScope.deckForCard?StudyGlobalScope.deckForCard(c):null;}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-materia-label');}
      if(!d)d=DB.getDecks().find(x=>x.id===c.deckId);
      return d?'📁 '+d.nome:'📁 (baralho removido)';
    }
    return c.materia||'Sem disciplina';
  },
  _bucket(c){
    const ph=c.phase||(((c.reps||0)>0&&(c.intervalo||0)>0)?'review':'new');
    if(ph==='new')return'new';if(ph==='learning'||ph==='relearning')return'learn';return'review';
  },
  buildQueue(){
    const bridge=window.CardsOfficialBridge;if(!bridge||!bridge.review)return[];
    return (bridge.review.queue_ids||[]).map(id=>bridge._localForOfficialId(id)).filter(Boolean).map(c=>c.id);
  },
  renderRevisar(box) {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.renderRevisar==='function'){void CardsOfficialBridge.renderRevisar(box);return;}
    if(box)box.innerHTML=this.emptyState('Motor oficial indisponível','A revisão não usa fila local como fallback.');
  },
  // ===== Painel de estatísticas FSRS (retenção real, previsão, maturidade) =====
  renderStats(box) {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.renderStats==='function'){void CardsOfficialBridge.renderStats(box);return;}
    if(box)box.innerHTML=this.emptyState('Estatísticas oficiais indisponíveis','Nenhum cálculo local foi usado como fallback.');
  },
  _reviewElapsedMs(){
    return window.CardsOfficialBridge&&typeof CardsOfficialBridge._elapsedMs==='function'
      ?CardsOfficialBridge._elapsedMs((CardsOfficialBridge.review&&CardsOfficialBridge.review.card&&CardsOfficialBridge.review.card.auto_advance)||{})
      :0;
  },
  _disableAutoAdvanceSilently(){
    if(window.CardsOfficialBridge){
      CardsOfficialBridge._autoAdvanceEnabled=false;
      if(typeof CardsOfficialBridge._clearReviewerAutomation==='function')CardsOfficialBridge._clearReviewerAutomation();
    }
  },
  toggleAutoAdvance(force){
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.toggleAutoAdvance==='function')return CardsOfficialBridge.toggleAutoAdvance(force);
    showToast('Auto Advance oficial indisponível.');return false;
  },

  renderReviewCard(box) {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.renderCurrent==='function'){void CardsOfficialBridge.renderCurrent(box);return;}
    if(box)box.innerHTML=this.emptyState('Motor oficial indisponível','O reviewer local está desativado.');
  },
  // Casca de compatibilidade: a revisão real é renderizada pelo bridge oficial.
  // Se algum fluxo legado chamar este método, ele consome somente os estados
  // já calculados por get_queued_cards()/describe_next_states() no backend.
  renderActions(box, c) {
    const el=document.getElementById('cards-review-actions');if(!el)return;
    const bridge=window.CardsOfficialBridge,review=bridge&&bridge.review,official=review&&review.card;
    if(!this._flipped){
      el.innerHTML='<button type="button" class="btn-primary cards-flip" id="cards-flip">Mostrar resposta <kbd>Espaço</kbd></button>';
      const b=document.getElementById('cards-flip');if(b)b.addEventListener('click',()=>bridge&&bridge.showAnswer?void bridge.showAnswer():showToast('Motor oficial do Anki indisponível.'));
      return;
    }
    const names=['Errei','Difícil','Bom','Fácil'],classes=['a-errei','a-dificil','a-bom','a-facil'],buttons=official&&Array.isArray(official.buttons)?official.buttons:[];
    if(!buttons.length){el.innerHTML='<span class="hint">Intervalos oficiais indisponíveis.</span>';return;}
    el.innerHTML=buttons.map(b=>'<button type="button" class="cards-ans4 '+(classes[Number(b.rating)-1]||'')+'" data-g="'+Number(b.rating)+'"><span class="a-kbd">'+Number(b.rating)+'</span>'+names[Number(b.rating)-1]+'<span>'+escapeHtml(b.label||'')+'</span></button>').join('');
    el.querySelectorAll('[data-g]').forEach(b=>b.addEventListener('click',()=>bridge&&bridge.answer?void bridge.answer(Number(b.dataset.g)):showToast('Motor oficial do Anki indisponível.')));
  },
  cardInfo(ref){
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.openCardInfo==='function'){
      void CardsOfficialBridge.openCardInfo(ref).catch(e=>showToast('Card Info oficial indisponível: '+(e&&e.message?e.message:String(e))));
      return;
    }
    showToast('Card Info oficial indisponível.');
  },
  flip() { if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.showAnswer==='function')void CardsOfficialBridge.showAnswer(); },
  // atalhos de teclado durante a revisão
  onKey(e) {
    // só na tela de cards, aba revisar, com um card na tela e sem modal aberto
    const scr = document.getElementById('screen-cards');
    if (!scr || !scr.classList.contains('active')) return;
    if (this.tab !== 'revisar') return;
    const anyModalOpen = ['card-modal', 'deck-modal', 'cards-import-modal', 'cards-export-modal']
      .some(id => { const m = document.getElementById(id); return m && m.style.display === 'flex'; });
    if (anyModalOpen) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    // Sair do foco é uma ação de navegação, não uma ação da fila. Precisa
    // funcionar mesmo quando o planejamento novo ainda não tem cards, quando a
    // fila terminou ou quando os filtros deixaram zero itens.
    if ((e.key === 'Escape' || e.code === 'Escape') && this.emFoco()) {
      e.preventDefault(); this.sairFoco(); return;
    }
    if (!this._reviewQueue || this._reviewIdx >= this._reviewQueue.length) return;
    const box = document.getElementById('cards-content');
    // Undo/Redo do reviewer, como Anki/AnkiDroid.
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) {
      e.preventDefault(); this.redoAnswer(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); this.undoAnswer(); return; }
    /* Atalhos do reviewer do Anki (qt/aqt/reviewer.py::_shortcutKeys) */
    const idAtual = (this._reviewQueue || [])[this._reviewIdx];
    const clique = (bid) => { const b = document.getElementById(bid); if (b) b.click(); };
    if (e.code === 'KeyU' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.undoAnswer(); return; }   // u = desfazer
    if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); clique('cards-review-edit'); return; }
    if (e.shiftKey && e.code === 'KeyA' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.toggleAutoAdvance(); return; }
    if (e.code === 'KeyI' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); clique('cards-act-info'); return; }
    if (e.key === '-') { e.preventDefault(); clique('cards-act-bury'); return; }
    if (e.key === '@' || (e.shiftKey && e.code === 'Digit2')) { e.preventDefault(); clique('cards-act-susp'); return; }
    if (e.key === '*' || (e.shiftKey && e.code === 'Digit8')) { e.preventDefault(); clique('cards-act-mark'); return; }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyN') { e.preventDefault(); clique('cards-act-forget'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); clique('cards-act-due'); return; }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); clique('cards-act-del'); return; }
    if ((e.ctrlKey || e.metaKey) && /^Digit[0-4]$/.test(e.code)) {   // bandeiras
      e.preventDefault();
      const n = Number(e.code.slice(5));
      if (window.CardsOfficialBridge && CardsOfficialBridge.review && CardsOfficialBridge.review.card) {
        void CardsOfficialBridge.action('flag', n);
      } else {
        showToast('Bandeira não alterada: Reviewer oficial indisponível.');
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!this._flipped) this.flip(box);
      return;
    }
    // ← volta ao card anterior; → avança para o próximo card
    // → NÃO pula: o Anki não permite passar um card sem avaliar. Para tirar o
    // card da frente, use ENTERRAR (-) ou SUSPENDER (@), como no original.
    // ← NÃO faz nada: o Anki não tem "card anterior". A única forma de mudar uma
    // avaliação é DESFAZER (Ctrl+Z), e é assim que fica aqui.
    if (!this._flipped) return;
    const map = { Digit1: 'errei', Numpad1: 'errei', Digit2: 'dificil', Numpad2: 'dificil', Digit3: 'bom', Numpad3: 'bom', Digit4: 'facil', Numpad4: 'facil' };
    if (map[e.code]) { e.preventDefault(); this.answer(map[e.code]); }
  },
  // pula (rotacionando para o fim) cards cujo passo de aprendizado ainda não venceu,
  // desde que exista outro card disponível agora
  /* Iterador do Anki (queue/mod.rs::iter): aprendizado intradiário JÁ vencido →
     fila principal (revisões/novos/entre dias) → aprendizado que vence dentro do
     "aprender adiantado". O aprendizado vive numa lista própria (a deque
     intraday_learning do Anki), ordenada por cmp_by_reps_then_due e alimentada
     por inserção com a MESMA busca binária do Rust (binary_search_by): no
     empate, o recém-inserido cai antes. requeue_learning_entry: com a fila
     principal vazia, o card recém-respondido não passa à frente do próximo de
     aprendizado (o vencimento da ENTRADA vira o dele + 1 s). O corte "agora" é
     o instante da resposta (update_learning_cutoff_and_count). */
  _iniciarAprendAnki(){ this._aprendAnki=null; },
  _inserirAprendAnki(){},
  _ordenarComoAnki(){},
  _skipNotDue(){},
  entrarFoco() {
    this.tab = 'revisar';
    document.querySelectorAll('.cards-tab').forEach(t => t.classList.toggle('active', t.dataset.ctab === 'revisar'));
    // Modos foco são mutuamente exclusivos. Uma classe antiga do Anki Oficial
    // ou da Lei Seca não pode deixar duas barras sobrepostas capturando o toque.
    document.body.classList.remove('anki-foco', 'leis-foco');
    document.body.classList.add('cards-foco');
    this.renderContent();
    this.atualizarFoco();
    window.scrollTo({ top: 0 });
    showToast('Modo foco · Espaço vira · 1-4 avaliam · Esc sai');
  },
  sairFoco() {
    document.body.classList.remove('cards-foco');
    this.renderContent();
  },
  emFoco() { return document.body.classList.contains('cards-foco'); },
  atualizarFoco() {
    if (!this.emFoco()) return;
    const el = document.getElementById('foco-info');
    if (!el) return;
    const total = (this._reviewQueue || []).length;
    const c = total ? DB.getCard(this._reviewQueue[this._reviewIdx]) : null;
    const onde = c ? (c.materia || ((window.StudyGlobalScope && StudyGlobalScope.deckForCard ? StudyGlobalScope.deckForCard(c) : null) || DB.getDecks().find(d => d.id === c.deckId) || {}).nome || '') : '';
    el.textContent = total
      ? `${Math.min(this._reviewIdx + 1, total)} de ${total}${onde ? ' · ' + onde : ''}`
      : 'Nada para revisar agora';
    const u = document.getElementById('foco-undo');
    if (u) u.disabled = !(this._undoStack || []).length;
  },
  // navega entre os cards da fila sem avaliar (pular)
  undoAnswer() {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.undo==='function')void CardsOfficialBridge.undo();
  },
  async redoAnswer() {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.redo==='function')return CardsOfficialBridge.redo();
    return false;
  },
  async answer(grade) {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.answer==='function')return CardsOfficialBridge.answer(grade);
    showToast('Motor oficial do Anki indisponível. A resposta não foi gravada.');
    return false;
  },
  // Quantos cards a lista mostra por vez. Antes ela montava TODOS os cards
  // filtrados de uma vez — cada um com o HTML rico completo, imagens em base64
  // incluídas — e refazia a lista inteira a cada clique numa estrela. Com alguns
  // milhares de cards isso congelava a tela por segundos.
  PAGINA_CARDS: 60,
  _meusMostrando: 0,
  miniCardHtml(c) {
    // saneado no preview também: a lista é HTML rico como a tela de revisão
    const frenteSan = _sanCard(c.frente);
    return `
        <div class="mini-card" data-id="${c.id}">
          <div class="mini-card-top">
            <label class="mini-card-sel" title="Selecionar este card">
              <input type="checkbox" class="mini-sel" data-id="${c.id}">
            </label>
            <span class="mini-card-badges">
              <span class="lei-tag mat">${escapeHtml(this.materiaLabel(c))}</span>
              ${c.assunto ? `<span class="lei-tag ref">${escapeHtml(c.assunto)}</span>` : ''}
              ${c.materiaTec ? `<span class="lei-tag" title="Matéria (Tec)">📚 ${escapeHtml(c.materiaTec)}</span>` : ''}
              ${c.banca ? `<span class="lei-tag" style="background:var(--accent);color:#fff;" title="Banca">🏛️ ${escapeHtml(c.banca)}</span>` : ''}
            </span>
            <button type="button" class="cards-fav-star ${c.favorito ? 'on' : ''}" data-fav="${c.id}" title="Favoritar">${c.favorito ? '★' : '☆'}</button>
          </div>
          <div class="mini-card-front">${frenteSan || '<em style="color:var(--text-faint)">(vazio)</em>'}</div>
          <div class="mini-card-foot">
            <span class="cards-status-dot ${c.status || 'pendente'}"></span>
            <span class="mini-card-status">${c.status === 'sei' ? 'Sei' : c.status === 'naosei' ? 'Não sei' : 'Pendente'}</span>
            ${c.kind === 'cloze' ? `<span class="cards-type-tag" style="color:var(--accent)">Cloze</span>` : ''}
            ${c.reversedOf ? `<span class="cards-type-tag" title="Cartão invertido">⇄</span>` : ''}
            ${c.tipo ? `<span class="cards-type-tag">${escapeHtml(c.tipo)}</span>` : ''}
            ${c.suspenso ? `<span class="cards-type-tag" style="color:var(--bad);border-color:var(--bad)" title="Suspenso após ${c.lapses || 0} erros — clique em ▶ para reativar">🚫 Suspenso</span>`
              : (c.leech ? `<span class="cards-type-tag" style="color:var(--warn);border-color:var(--warn)" title="${c.lapses || 0} erros acumulados">⚠ Difícil</span>` : '')}
            <span style="flex:1"></span>
            ${c.suspenso ? `<button type="button" class="icon-btn" data-unsusp="${c.id}" title="Reativar card" aria-label="Reativar card">▶</button>` : ''}
            <button type="button" class="icon-btn mini-edit" data-edit="${c.id}" title="Editar" aria-label="Editar">✎</button>
            <button type="button" class="icon-btn danger mini-del" data-del="${c.id}" title="Excluir nota" aria-label="Excluir nota">×</button>
          </div>
        </div>`;
  },
  renderMeus(box) {
    const filtered = this.currentFilteredCards().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (this.collectionCards().length === 0) {
      box.innerHTML = this.emptyState('Você ainda não criou nenhum card', 'Clique em <strong>＋ Criar card</strong> no topo pra começar.');
      return;
    }
    if (filtered.length === 0) {
      box.innerHTML = this.emptyState('Nenhum card nos filtros', 'Ajuste a busca ou os filtros acima.');
      return;
    }
    const st={pendente:0,sei:0,naosei:0,suspensos:0};
    filtered.forEach(c=>{const k=c.status||'pendente';st[k]=(st[k]||0)+1;if(c.suspenso)st.suspensos++;});
    // Ao voltar de uma edição, mantém a quantidade que já estava aberta — senão a
    // lista "encolheria" sozinha depois de você carregar mais e mexer num card.
    // O teto existe para que um re-render nunca volte a montar milhares de cards
    // de uma vez, mesmo que você tenha clicado muito em "Carregar mais".
    const jaAberto = Math.min(240, Math.max(this.PAGINA_CARDS, this._meusMostrando || 0));
    let n = Math.min(jaAberto, filtered.length);
    this._meusMostrando = n;

    box.innerHTML = `
      <div class="cards-count-bar">${filtered.length} card(s) · <span style="color:var(--good)">${st.sei} sei</span> · <span style="color:var(--bad)">${st.naosei} não sei</span> · <span style="color:var(--text-soft)">${st.pendente} pendente(s)</span>${st.suspensos ? ` · <span style="color:var(--bad)">🚫 ${st.suspensos} suspenso(s)</span>` : ''}</div>
      <!-- Ações em massa: agem sobre os cards DO FILTRO ATUAL, não sobre o baralho
           inteiro. É isso que torna a exclusão em lote útil e segura — você filtra
           por matéria, deck ou busca e apaga só aquele recorte. -->
      <div class="cards-bulk">
        <label class="cards-select-toggle" title="Selecionar ou limpar todos os cards exibidos pelo filtro atual">
          <input type="checkbox" id="cards-sel-toggle">
          <span id="cards-sel-toggle-label">Selecionar todos</span>
        </label>
        <span class="cards-bulk-count" id="cards-sel-count"></span>
        <button type="button" class="btn-secondary" id="cards-mover-sel" style="display:none;">📁 Mover p/ baralho</button>
        <button type="button" class="btn-danger" id="cards-del-sel" style="display:none;">Excluir selecionados</button>
      </div>
      <div class="cards-grid" id="cards-grid-meus">${filtered.slice(0, n).map(c => this.miniCardHtml(c)).join('')}</div>
      <div id="cards-mais-wrap" style="text-align:center;padding:14px 0;"></div>`;

    const grid = box.querySelector('#cards-grid-meus');
    const maisWrap = box.querySelector('#cards-mais-wrap');

    /* ── SELECAO EM MASSA ──────────────────────────────────────────────────
       O conjunto vive em memoria (nao no card), entao mudar de filtro ou sair
       da tela limpa a selecao — nao existe risco de apagar algo marcado em
       outro contexto. "Selecionar todos" cobre o FILTRO ATUAL, inclusive os
       cards ainda nao renderizados pela paginacao. */
    const sel = new Set();
    const selToggle = box.querySelector('#cards-sel-toggle');
    const selToggleLabel = box.querySelector('#cards-sel-toggle-label');
    const btnDel = box.querySelector('#cards-del-sel');
    const btnMover = box.querySelector('#cards-mover-sel');
    const lblSel = box.querySelector('#cards-sel-count');
    const syncSel = () => {
      lblSel.textContent = sel.size ? sel.size + ' selecionado(s)' : '';
      btnDel.style.display = sel.size ? '' : 'none';
      btnMover.style.display = sel.size ? '' : 'none';
      const todos = filtered.length > 0 && sel.size === filtered.length;
      selToggle.checked = todos;
      selToggle.indeterminate = sel.size > 0 && !todos;
      selToggleLabel.textContent = todos ? 'Limpar seleção' : 'Selecionar todos';
      grid.querySelectorAll('.mini-card').forEach(mc => {
        const marcado = sel.has(mc.dataset.id);
        mc.classList.toggle('is-sel', marcado);
        const cb = mc.querySelector('.mini-sel');
        if (cb) cb.checked = marcado;
      });
    };
    grid.addEventListener('change', (e) => {
      const cb = e.target.closest('.mini-sel');
      if (!cb) return;
      if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id);
      syncSel();
    });
    // clique no checkbox nao deve abrir o card para edicao
    grid.addEventListener('click', (e) => { if (e.target.closest('.mini-card-sel')) e.stopPropagation(); }, true);
    selToggle.addEventListener('change', () => {
      if (selToggle.checked) filtered.forEach(c => sel.add(c.id)); else sel.clear();
      syncSel();
    });
    btnDel.addEventListener('click', () => {
      const qtd = sel.size;
      if (!qtd) return;
      // Exclusao em lote e irreversivel: a confirmacao diz o NUMERO exato e avisa
      // que nao ha como desfazer, em vez de um "tem certeza?" generico.
      UI.confirm(
        'Excluir ' + qtd + ' card(s)? Esta ação não pode ser desfeita.',
        { title: '🗑 Excluir cards', okText: 'Excluir ' + qtd, danger: true }
      ).then(async(ok) => {
        if (!ok) return;
        if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.deleteNotesForCardRefs!=='function'){
          showToast('Exclusão não executada: Collection oficial indisponível.');return;
        }
        try{
          const out=await CardsOfficialBridge.deleteNotesForCardRefs([...sel]);
          sel.clear();this._meusMostrando=0;this.render();
          showToast(out.deletedNotes+' nota(s) excluída(s) pelo Anki oficial ✓');
        }catch(e){showToast('Exclusão não executada: '+(e&&e.message?e.message:String(e)));}
      });
    });
    // Mover em massa: reatribui o baralho dos cards selecionados — sem tocar
    // em assunto, banca ou histórico de revisão.
    btnMover.addEventListener('click', () => {
      const qtd = sel.size;
      if (!qtd) return;
      const selecionados=this.collectionCards().filter(c=>sel.has(c.id));
      const origins=new Set(selecionados.map(c=>c._planId||
        (window.StudyGlobalScope&&StudyGlobalScope.sourcePlanForCard?StudyGlobalScope.sourcePlanForCard(c.id):null)||
        (window.PlanManager&&PlanManager.getActivePlanId?PlanManager.getActivePlanId():null)).filter(Boolean).map(String));
      if(origins.size>1){showToast('Para mover em lote, selecione cards do mesmo planejamento de origem.');return;}
      const sourcePlanId=origins.size?[...origins][0]:null;
      const decks=this.destinationDecks(sourcePlanId);
      if (!decks.length) { showToast('Crie um baralho primeiro no planejamento de origem'); return; }
      const opts = decks.map(d => ({ value: d.id, label: '📁 ' + d.nome + (d._planNome?' · '+d._planNome:'') }));
      UI.prompt([{ key: 'deck', label: 'Mover ' + qtd + ' card(s) para qual baralho?', type: 'select', value: opts[1].value, options: opts }],
        { title: '📁 Mover para baralho', okText: 'Mover' }
      ).then(async(v) => {
        if (!v) return;
        if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.moveCardRefsToDeck!=='function'){
          showToast('Movimentação não executada: Collection oficial indisponível.');return;
        }
        try{
          const out=await CardsOfficialBridge.moveCardRefsToDeck([...sel],v.deck,sourcePlanId);
          sel.clear();this._meusMostrando=0;this.render();
          showToast(out.moved+' card(s) movido(s) pelo Anki oficial ✓');
        }catch(e){showToast('Movimentação não executada: '+(e&&e.message?e.message:String(e)));}
      });
    });
    syncSel();
    const pintarMais = () => {
      if (n >= filtered.length) {
        maisWrap.innerHTML = filtered.length > this.PAGINA_CARDS
          ? `<span class="hint">Fim da lista · ${filtered.length} card(s).</span>` : '';
        return;
      }
      const restam = filtered.length - n;
      maisWrap.innerHTML = `<button type="button" class="btn-secondary" id="cards-carregar-mais">Carregar mais ${Math.min(this.PAGINA_CARDS, restam)} (restam ${restam})</button>`;
      maisWrap.querySelector('#cards-carregar-mais').addEventListener('click', () => {
        const lote = filtered.slice(n, n + this.PAGINA_CARDS);
        grid.insertAdjacentHTML('beforeend', lote.map(c => this.miniCardHtml(c)).join(''));
        n += lote.length; this._meusMostrando = n;
        pintarMais();
      });
    };
    pintarMais();

    // Um listener para a lista inteira, em vez de quatro por card. Além de mais
    // barato, é o que faz os cards carregados depois já nascerem funcionando.
    grid.addEventListener('click', async (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        const c = DB.getCard(fav.dataset.fav);
        if (!c) return;
        const novo = !c.favorito;
        DB.updateCard(c.id, { favorito: novo });
        this.updateFavCount();
        // Atualiza SÓ a estrela clicada. Antes, favoritar refazia a lista toda —
        // e ainda fazia a página saltar de volta para o topo.
        fav.classList.toggle('on', novo);
        fav.textContent = novo ? '★' : '☆';
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) { this.openCardModal(ed.dataset.edit); return; }
      const un = e.target.closest('[data-unsusp]');
      if (un) {
        if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.actionCards!=='function'){showToast('Scheduler oficial do Anki indisponível.');return;}
        try{await CardsOfficialBridge.actionCards('unsuspend',[un.dataset.unsusp]);showToast('Card reativado pelo Anki oficial ✓');this.renderMeus(box);}
        catch(err){showToast('Card não reativado: '+(err&&err.message?err.message:String(err)));}
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.deleteNoteForCard!=='function'){showToast('Collection oficial do Anki indisponível.');return;}
        try{const out=await CardsOfficialBridge.deleteNoteForCard(del.dataset.del,true);if(out)showToast('Nota excluída pelo Anki oficial ✓');}
        catch(err){showToast('Nota não excluída: '+(err&&err.message?err.message:String(err)));}
      }
    });
  },
  emptyState(title, sub) {
    return `<div class="card"><div class="empty-state" style="padding:40px 20px;"><div class="big">🗂️</div><h3 style="margin:4px 0;">${title}</h3><p style="color:var(--text-faint)">${sub}</p></div></div>`;
  },

  // ---- modal criar/editar card ----
  // ajusta a UI conforme o formato (básico / invertido / cloze)
  applyKindUI() {
    const kind = $id('card-kind').value;
    const isCloze = kind === 'cloze';
    ['card-cloze-btn', 'card-cloze-same-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = isCloze ? 'inline-block' : 'none';
    });
    $id('card-verso-field').style.display = isCloze ? 'none' : 'block';
    $id('card-frente-label').innerHTML = isCloze ? 'Texto Cloze <span class="req">*</span>' : 'Frente (pergunta) <span class="req">*</span>';
    const hint = document.getElementById('card-kind-hint');
    if (isCloze) hint.innerHTML = '<strong>Novo card</strong> usa c1, c2, c3… e cada número vira um card de revisão diferente. <strong>Mesmo card</strong> repete o maior número e esconde os trechos juntos na mesma revisão.';
    else if (kind === 'basic_reversed') hint.innerHTML = 'Serão criados <strong>2 cards</strong>: um frente→verso e outro verso→frente.';
    else hint.innerHTML = 'Card simples: você vê a frente e revela o verso.';
  },
  // Seletor único de banca (busca + marca com ✓), reaproveitando o visual do
  // banca-pick já usado no Motor/Incidência. Guarda o valor num input oculto
  // #card-banca, então _readCardForm()/cardTemConteudo() continuam lendo
  // $id('card-banca').value normalmente, sem saber que não é mais um <input>.
  renderCardBancaPicker(valorAtual) {
    const host = document.getElementById('card-banca-pick');
    if (!host) return;
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const cadastradas = DB.getCardBancas();
    const usadas = this.collectionCards().map(c => c.banca).filter(Boolean);
    const extra = (valorAtual && !cadastradas.includes(valorAtual)) ? [valorAtual] : [];
    const opcoes = [...new Set([...cadastradas, ...usadas, ...extra])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    host.innerHTML = `
      <input type="hidden" id="card-banca" value="${escapeHtml(valorAtual || '')}">
      <button type="button" class="banca-pick-btn" id="card-banca-btn" aria-expanded="false">
        <span>${valorAtual ? '🏛️ ' + escapeHtml(valorAtual) : '— Nenhuma —'}</span><span class="chev">▾</span>
      </button>
      <div class="banca-pick-panel" hidden>
        <input type="text" class="banca-pick-search" placeholder="Buscar banca…">
        <div class="banca-pick-list">
          <button type="button" class="banca-pick-all ${valorAtual ? '' : 'is-active'}" data-banca-op="">
            <span class="banca-pick-all-mark">✓</span><span><b>— Nenhuma —</b></span>
          </button>
          ${opcoes.map(b => `<button type="button" class="banca-pick-all ${valorAtual === b ? 'is-active' : ''}" data-banca-op="${escapeHtml(b)}" data-banca-norm="${escapeHtml(norm(b))}">
            <span class="banca-pick-all-mark">✓</span><span><b>${escapeHtml(b)}</b></span>
          </button>`).join('')}
        </div>
        ${opcoes.length ? '' : '<p class="hint" style="margin:6px 2px 0;">Nenhuma banca cadastrada — adicione em ⚙ Algoritmo → Gerenciar bancas.</p>'}
      </div>`;
    const btn = host.querySelector('#card-banca-btn');
    const painel = host.querySelector('.banca-pick-panel');
    const search = host.querySelector('.banca-pick-search');
    const label = btn.querySelector('span:not(.chev)');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = painel.hasAttribute('hidden');
      document.querySelectorAll('.banca-pick-panel').forEach(p2 => { if (p2 !== painel) p2.setAttribute('hidden', ''); });
      if (abrir) {
        painel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true');
        search.value = ''; host.querySelectorAll('[data-banca-op]').forEach(o => o.style.display = '');
        setTimeout(() => search.focus(), 30);
      } else { painel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); }
    });
    painel.addEventListener('click', (e) => e.stopPropagation());
    search.addEventListener('input', () => {
      const q = norm(search.value);
      host.querySelectorAll('.banca-pick-list [data-banca-op]:not([data-banca-op=""])').forEach(o => {
        o.style.display = !q || (o.dataset.bancaNorm || '').indexOf(q) >= 0 ? '' : 'none';
      });
    });
    host.querySelectorAll('[data-banca-op]').forEach(opt => opt.addEventListener('click', () => {
      const v = opt.dataset.bancaOp || '';
      $id('card-banca').value = v;
      label.textContent = v ? '🏛️ ' + v : '— Nenhuma —';
      host.querySelectorAll('[data-banca-op]').forEach(o => o.classList.toggle('is-active', (o.dataset.bancaOp || '') === v));
      painel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false');
    }));
  },
  openCardModal(id) {
    this._editingId = id || null;
    this._editingPlanId = null;
    const isEdit = !!id;
    $id('card-modal-title').textContent = isEdit ? '✎ Editar card' : '＋ Criar card';
    $id('card-del-btn').style.display = isEdit ? 'inline-block' : 'none';
    $id('card-save-another').style.display = isEdit ? 'none' : 'inline-block';
    let destSel = '', assunto = '', materiaTec = '', banca = '', frente = '', verso = '', kind = 'basic';
    if (isEdit) {
      if (DB.normalizeCardNotesInPlace) DB.normalizeCardNotesInPlace();
      const c = DB.getCard(id);
      if (!c) { showToast('Card não encontrado'); this._editingId = null; return; }
      try {
        this._editingPlanId = c._planId ||
          (window.StudyGlobalScope && StudyGlobalScope.sourcePlanForCard ? StudyGlobalScope.sourcePlanForCard(c.id) : null) ||
          PlanManager.getActivePlanId();
      } catch (_) { this._editingPlanId = PlanManager.getActivePlanId(); }
      destSel = c.deckId ? 'deck:' + c.deckId : (c.materia ? 'sub:' + c.materia : '');
      assunto = c.assunto || ''; materiaTec = c.materiaTec || ''; banca = c.banca || ''; frente = c.frente || ''; verso = c.verso || ''; kind = c.kind || 'basic';
    }
    $id('card-destino').innerHTML = this.destinoOptionsHtml(destSel, this._editingPlanId, !isEdit);
    $id('card-assunto').value = assunto;
    const tops = [...new Set(this.collectionCards().map(c => c.assunto).filter(Boolean))].sort();
    $id('card-assunto-list').innerHTML = tops.map(t => `<option value="${escapeHtml(t)}">`).join('');
    // Matéria (Tec): sugere as disciplinas já importadas na Incidência + as já usadas em outros cards
    $id('card-materia-tec').value = materiaTec;
    const discImport = (DB.getIncidencia ? [...new Set(DB.getIncidencia().map(r => r.disciplina).filter(Boolean))] : []);
    const materiaTecCards = this.collectionCards().map(c => c.materiaTec).filter(Boolean);
    const materiaTecOpts = [...new Set([...discImport, ...materiaTecCards])].sort();
    $id('card-materia-tec-list').innerHTML = materiaTecOpts.map(t => `<option value="${escapeHtml(t)}">`).join('');
    // Banca: seletor único com busca, entre as cadastradas em ⚙ Algoritmo → Gerenciar bancas
    this.renderCardBancaPicker(banca);
    // ao editar, o formato invertido não é reofertado (já são 2 cards); mostra básico/cloze
    const kindSel = document.getElementById('card-kind');
    kindSel.querySelector('option[value="basic_reversed"]').style.display = isEdit ? 'none' : '';
    kindSel.value = (kind === 'cloze') ? 'cloze' : 'basic';
    $id('card-frente').innerHTML = frente;
    $id('card-verso').innerHTML = verso;
    this.applyKindUI();
    $id('card-modal').style.display = 'flex';
    setTimeout(() => $id('card-destino').focus(), 50);
  },
  closeCardModal() { $id('card-modal').style.display = 'none'; this._editingId = null; this._editingPlanId = null; },
  // Há algo que se perderia ao fechar? Para as áreas ricas olha o innerHTML, não o
  // innerText: um card com apenas uma IMAGEM colada tem texto vazio e seria
  // descartado como se estivesse em branco.
  _plainRich(html){
    const box=document.createElement('div');box.innerHTML=String(html||'');
    return String(box.textContent||'').replace(/\u00a0/g,' ').trim();
  },
  _richHasContent(html){
    const raw=String(html||'');
    if(this._plainRich(raw))return true;
    return /\[sound:[^\]]+\]/i.test(raw)||/<(?:img|picture|audio|video|svg|canvas|object|embed|iframe|math)\b/i.test(raw)
      ||/\b(?:src|poster)\s*=\s*["'][^"']+["']/i.test(raw)||/url\(\s*["']?[^)"']+/i.test(raw);
  },
  cardTemConteudo() {
    const rico = (id) => {
      const e = document.getElementById(id);
      return !!(e && this._richHasContent(e.innerHTML || ''));
    };
    const campo = (id) => { const e = document.getElementById(id); return !!(e && (e.value || '').trim()); };
    return rico('card-frente') || rico('card-verso') || campo('card-assunto') || campo('card-materia-tec') || campo('card-banca');
  },
  // Fecha pedindo confirmação quando há conteúdo não salvo
  async fecharCardComAviso() {
    if (this.cardTemConteudo()) {
      const ok = await UI.confirm('Descartar este card? O que você escreveu será perdido.',
        { title: 'Fechar sem salvar', okText: 'Descartar', danger: true });
      if (!ok) return;
    }
    this.closeCardModal();
  },
  _readCardForm() {
    const dest = $id('card-destino').value;
    // "novo:Nome" declara a intenção de criar o destino. A criação em si
    // pertence ao DeckManager oficial e acontece no CardsOfficialBridge.
    const newDeckName=dest.startsWith('novo:')?String(dest.slice(5)||'').trim():'';
    const kind = $id('card-kind').value;
    let frente = $id('card-frente').innerHTML.trim();
    const verso = $id('card-verso').innerHTML.trim();
    if (!dest) { showToast('Escolha o baralho'); return null; }
    if (kind === 'cloze') {
      if (!this._richHasContent(frente)) { showToast('Escreva o texto do cloze'); return null; }
      // A casca não tokeniza nem normaliza Cloze: {{cN::...}} segue intacto
      // para o NoteType/gerador de cards oficial decidir o conjunto resultante.
    } else {
      if (!this._richHasContent(frente)) { showToast('Preencha a frente'); return null; }
      if (!this._richHasContent(verso)) { showToast('Preencha o verso'); return null; }
    }
    const data = {
      assunto: $id('card-assunto').value,
      materiaTec: $id('card-materia-tec').value,
      banca: $id('card-banca').value,
      // "tipo" (Categoria) não tem mais campo na criação/edição — omitido de
      // propósito, para não apagar o valor de cards antigos que já tinham um.
      kind: ['basic_reversed','basic_optional_reversed','typing'].includes(kind) ? kind : (kind === 'cloze' ? 'cloze' : 'basic'),
      frente, verso: kind === 'cloze' ? '' : verso, deckId: null, materia: null,
      _reversed: kind === 'basic_reversed',
      _addReverse: kind === 'basic_optional_reversed' && !!(document.getElementById('card-add-reverse')||{}).checked
    };
    if (dest.startsWith('deck:')) data.deckId = dest.slice(5);
    else if (dest.startsWith('sub:')) data.materia = dest.slice(4);
    if(newDeckName)data._newDeckName=newDeckName;
    return data;
  },
  saveCard(closeAfter) {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.saveSimpleCard==='function'){
      void CardsOfficialBridge.saveSimpleCard(closeAfter).catch(e=>showToast('Card não salvo: '+(e&&e.message?e.message:String(e))));
      return;
    }
    showToast('Card não salvo: Anki oficial indisponível.');
  },
  async deleteCard() {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.deleteSimpleCard==='function'){
      try{return await CardsOfficialBridge.deleteSimpleCard();}
      catch(e){showToast('Nota não excluída: '+(e&&e.message?e.message:String(e)));return false;}
    }
    showToast('Nota não excluída: Anki oficial indisponível.');return false;
  },

  // ---- baralhos ----
  openDeckModal() { this.renderDeckList(); $id('deck-modal').style.display = 'flex'; },
  // Baralhos e cards no mesmo escopo da tela (padrão: todos os planejamentos).
  // Antes a lista lia só o planejamento ativo e escondia os demais baralhos.
  _deckScope() { return { decks: this.collectionDecks(), cards: this.collectionCards() }; },
  // Planejamento dono do baralho e execução de operações dentro dele.
  _planDoBaralho(deckId) {
    const G = window.StudyGlobalScope;
    return (G && G.planForDeck) ? G.planForDeck(deckId) : null;
  },
  _noPlanoDoBaralho(deckId, fn) {
    const G = window.StudyGlobalScope, pid = this._planDoBaralho(deckId);
    return (G && G.inPlan && pid) ? G.inPlan(pid, fn) : fn();
  },
  // Rótulo "Baralho · Plano" quando a visão junta mais de um planejamento.
  _rotuloBaralho(d, decks) {
    const planos = new Set((decks || []).map(x => String(x._planId || ''))).size;
    return String(d.nome || '') + (planos > 1 && d._planNome ? ' · ' + d._planNome : '');
  },
  renderDeckList() {
    const box = document.getElementById('deck-list');
    const { decks, cards } = this._deckScope();
    if (decks.length === 0) { box.innerHTML = `<p class="hint">Nenhum baralho ainda. Crie o primeiro acima.</p>`; return; }
    box.innerHTML = decks.map(d => {
      const n = cards.filter(c => String(c.deckId) === String(d.id)).length;
      const filtrado = typeof AnkiParity !== 'undefined' && AnkiParity.isFilteredDeck(d);
      return `<div class="deck-row" data-id="${d.id}">
        <input type="text" class="deck-name" value="${escapeHtml(d.nome)}">
        <span class="deck-count">${filtrado ? '🔎 ' : ''}${n} card(s)</span>
        ${filtrado ? '<button type="button" class="icon-btn deck-filter-edit" title="Editar e reconstruir baralho filtrado" aria-label="Editar baralho filtrado">⚙</button>' : ''}
        <button type="button" class="icon-btn deck-ver" title="Ver os cards deste baralho" aria-label="Ver os cards deste baralho">👁</button>
        <button type="button" class="icon-btn deck-revisar" title="Revisar só este baralho" aria-label="Revisar só este baralho">▶</button>
        <button type="button" class="icon-btn danger deck-del" title="Excluir baralho" aria-label="Excluir baralho">×</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.deck-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.deck-name').addEventListener('change', async (e) => {
        const value=String(e.target.value||'').trim();
        if(!value){this.renderDeckList();return;}
        if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.renameOfficialDeck!=='function'){showToast('Backend oficial do Anki indisponível.');this.renderDeckList();return;}
        try{await CardsOfficialBridge.renameOfficialDeck(id,value);this.renderDeckList();this.render();showToast('Baralho renomeado pelo Anki oficial ✓');}
        catch(err){showToast('Baralho não renomeado: '+(err&&err.message?err.message:String(err)));this.renderDeckList();}
      });
      const fed = row.querySelector('.deck-filter-edit');
      if (fed) fed.addEventListener('click', () => this.openFilteredDeckModal(id));
      row.querySelector('.deck-ver').addEventListener('click', () => this.irParaBaralho(id, 'meus'));
      row.querySelector('.deck-revisar').addEventListener('click', () => this.irParaBaralho(id, 'revisar'));
      row.querySelector('.deck-del').addEventListener('click', async () => {
        const filtrado = typeof AnkiParity !== 'undefined' && AnkiParity.isFilteredDeck(id),
          n=cards.filter(c=>String(c.deckId)===String(id)||String(c.originalDeckId||'')===String(id)).length,
          msg=filtrado
            ? 'Excluir este baralho filtrado? O Anki devolverá os cards aos baralhos de origem.'
            : 'Excluir este baralho? Como no Anki, os '+n+' card(s) nele e notas que ficarem órfãs serão excluídos.';
        if (!await UI.confirm(msg,{title:'Excluir baralho',okText:'Excluir',danger:true})) return;
        if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.deleteOfficialDeck!=='function'){showToast('Backend oficial do Anki indisponível.');return;}
        try{await CardsOfficialBridge.deleteOfficialDeck(id);this.renderDeckList();this.render();showToast('Baralho excluído pela Collection oficial do Anki ✓');}
        catch(err){showToast('Baralho não excluído: '+(err&&err.message?err.message:String(err)));}
      });
    });
  },
  // Fecha o modal de baralhos e abre a aba pedida (Meus cards ou Revisar) já
  // filtrada só por este baralho — o filtro fica valendo até ser trocado.
  irParaBaralho(deckId, aba) {
    $id('deck-modal').style.display = 'none';
    this.tab = aba;
    this.filters.materias = new Set(['deck:' + deckId]);
    this._meusMostrando = 0;
    this.invalidateReviewQueue();
    document.querySelectorAll('.cards-tab').forEach(t => t.classList.toggle('active', t.dataset.ctab === aba));
    this.render();
    const mSel = document.getElementById('cards-f-materia');
    if (mSel) mSel.value = 'deck:' + deckId;
  },
  async addDeck() {
    const inp=document.getElementById('deck-new-input'),name=String(inp&&inp.value||'').trim();
    if(!name){showToast('Digite um nome');return;}
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.createOfficialDeck!=='function'){showToast('Backend oficial do Anki indisponível.');return;}
    try{await CardsOfficialBridge.createOfficialDeck(name);inp.value='';this.renderDeckList();this.render();showToast('Baralho criado pela Collection oficial do Anki ✓');}
    catch(err){showToast('Baralho não criado: '+(err&&err.message?err.message:String(err)));}
  },

  // ---- Estudo Personalizado / Baralhos Filtrados (Anki 26.09.2) ----
  _normalDeckOptions(selected) {
    const decks = this.collectionDecks().filter(d => !(typeof AnkiParity !== 'undefined' && AnkiParity.isFilteredDeck(d)))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { numeric: true, sensitivity: 'base' }));
    return decks.map(d => '<option value="'+escapeHtml(String(d.id))+'"'+(String(selected)===String(d.id)?' selected':'')+'>'+escapeHtml(this._rotuloBaralho(d, decks))+'</option>').join('');
  },
  openCustomStudy() {
    const sel = document.getElementById('cards-custom-deck');
    if (sel) sel.innerHTML = this._normalDeckOptions('');
    const mode = document.getElementById('cards-custom-mode'); if (mode) mode.value='forgot';
    const value = document.getElementById('cards-custom-value'); if (value) value.value='7';
    const cram = document.getElementById('cards-custom-cram-kind'); if (cram) cram.value='due';
    const limit = document.getElementById('cards-custom-limit'); if (limit) limit.value='100';
    const inc = document.getElementById('cards-custom-tags-in'); if (inc) inc.value='';
    const exc = document.getElementById('cards-custom-tags-out'); if (exc) exc.value='';
    this.updateCustomStudyUI();
    const modal=document.getElementById('cards-custom-modal');if(modal)modal.style.display='flex';
  },
  updateCustomStudyUI() {
    const mode=(document.getElementById('cards-custom-mode')||{}).value||'forgot';
    const cram=document.getElementById('cards-custom-cram-fields');
    const days=document.getElementById('cards-custom-days-field');
    const delta=document.getElementById('cards-custom-delta-hint');
    if(cram)cram.style.display=mode==='cram'?'block':'none';
    if(days)days.style.display=mode==='cram'?'none':'block';
    if(delta)delta.textContent=(mode==='newLimitDelta'||mode==='reviewLimitDelta')?'Quantidade a acrescentar hoje':'Dias';
  },
  runCustomStudy() {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.runCustomStudy==='function')return CardsOfficialBridge.runCustomStudy();
    showToast('Estudo Personalizado exige o motor oficial do Anki.');
  },
  _filteredOrderOptions(selected) {
    const vals=[
      [0,'Mais antigos revisados primeiro'],[1,'Aleatória'],[2,'Intervalo crescente'],
      [3,'Intervalo decrescente'],[4,'Mais lapsos'],[5,'Adicionados primeiro'],
      [6,'Vencimento'],[7,'Adicionados por último primeiro'],[8,'Menor recuperabilidade'],
      [9,'Maior recuperabilidade'],[10,'Maior atraso relativo']
    ];
    return vals.map(x=>'<option value="'+x[0]+'"'+(Number(selected)===x[0]?' selected':'')+'>'+x[1]+'</option>').join('');
  },
  openFilteredDeckModal(deckId) {
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v==null?'':String(v);};
    set('cards-filtered-id',deckId||'');set('cards-filtered-name','Baralho filtrado');
    set('cards-filtered-search1','');set('cards-filtered-limit1',100);set('cards-filtered-search2','');set('cards-filtered-limit2',100);
    const o1=document.getElementById('cards-filtered-order1'),o2=document.getElementById('cards-filtered-order2');
    if(o1)o1.innerHTML=this._filteredOrderOptions(1);if(o2)o2.innerHTML=this._filteredOrderOptions(1);
    const res=document.getElementById('cards-filtered-reschedule');if(res)res.checked=false;
    set('cards-filtered-again',60);set('cards-filtered-hard',600);set('cards-filtered-good',0);
    const modal=document.getElementById('cards-filtered-modal');if(modal)modal.style.display='flex';
    this.updateFilteredDeckUI();
  },
  updateFilteredDeckUI() {
    const res=!!(document.getElementById('cards-filtered-reschedule')||{}).checked;
    const p=document.getElementById('cards-filtered-preview-fields');if(p)p.style.display=res?'none':'block';
  },
  saveFilteredDeckModal() {
    if(window.CardsOfficialBridge&&typeof CardsOfficialBridge.saveFilteredDeckModal==='function')return CardsOfficialBridge.saveFilteredDeckModal();
    showToast('Baralho filtrado exige o motor oficial do Anki.');
  },

  // ---- bancas (lista oferecida no seletor "Banca" da criação de card) ----
  openBancasModal() { this.renderBancasList(); $id('bancas-modal').style.display = 'flex'; },
  renderBancasList() {
    const box = document.getElementById('banca-list');
    const bancas = DB.getCardBancas();
    if (bancas.length === 0) { box.innerHTML = `<p class="hint">Nenhuma banca cadastrada. Adicione a primeira acima.</p>`; return; }
    box.innerHTML = bancas.map(b => {
      const n = this.collectionCards().filter(c => c.banca === b).length;
      return `<div class="deck-row" data-nome="${escapeHtml(b)}">
        <span class="deck-name" style="padding:8px 10px;border-radius:8px;">${escapeHtml(b)}</span>
        <span class="deck-count">${n} card(s)</span>
        <button type="button" class="icon-btn danger banca-del" title="Remover banca" aria-label="Remover banca">×</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.deck-row').forEach(row => {
      const nome = row.dataset.nome;
      row.querySelector('.banca-del').addEventListener('click', async () => {
        if (!await UI.confirm('Remover "' + nome + '" da lista de bancas? Os cards que já usam essa banca não são alterados.')) return;
        DB.removeCardBanca(nome); this.renderBancasList();
      });
    });
  },
  addBanca() {
    const inp = document.getElementById('banca-new-input');
    const nome = DB.addCardBanca(inp.value);
    if (!nome) { showToast('Digite um nome (ou a banca já existe)'); return; }
    inp.value = ''; this.renderBancasList(); showToast('Banca adicionada ✓');
  },

  // ---- exportar ----
  openExportModal() {
    const cards=this.collectionCards(),decks=this.collectionDecks(),body=document.getElementById('cards-export-body');
    if(!cards.length){body.innerHTML=`<p class="hint">Você ainda não criou nenhum card.</p>`;}
    else{
      body.innerHTML=`
        <p style="font-size:14px;margin-top:0;">Você tem <strong>${cards.length} card(s)</strong>. Os formatos abaixo seguem os exportadores atuais do Anki.</p>
        <div class="field" style="margin:8px 0 12px;"><label for="cards-export-scope">Escopo de .apkg e texto</label>
          <select id="cards-export-scope"><option value="all">Coleção inteira</option>${decks.filter(d=>!(typeof AnkiParity!=='undefined'&&AnkiParity.isFilteredDeck&&AnkiParity.isFilteredDeck(d))).map(d=>'<option value="deck:'+escapeHtml(String(d.id))+'">'+escapeHtml(String(d.nome||'Baralho')+(d._planNome?' · '+d._planNome:''))+'</option>').join('')}</select>
          <p class="hint" style="margin:4px 0 0;">Ao escolher um baralho, o .apkg inclui esse baralho e todos os subbaralhos, como o ExportLimit do Anki. .colpkg sempre representa a coleção inteira.</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:12px;">
          <fieldset style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;">
            <legend style="font-weight:700;font-size:13px;">Pacote .apkg / .colpkg</legend>
            <label class="check-label"><input type="checkbox" id="cards-export-scheduling" checked> Agendamento + histórico</label>
            <label class="check-label"><input type="checkbox" id="cards-export-deckconfigs" checked> Presets/configurações</label>
            <label class="check-label"><input type="checkbox" id="cards-export-media" checked> Mídia incorporada</label>
            <label class="check-label" title="Use apenas para versões antigas do Anki"><input type="checkbox" id="cards-export-legacy"> Compatibilidade antiga (Legacy / schema 11)</label>
            <p class="hint" style="margin:7px 0 0;">Desmarcado = pacote moderno do Anki: <code>collection.anki21b</code>, Zstandard e schema 18.</p>
          </fieldset>
          <fieldset style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;">
            <legend style="font-weight:700;font-size:13px;">Texto .txt</legend>
            <label class="check-label"><input type="checkbox" id="cards-export-html" checked> Manter HTML</label>
            <label class="check-label"><input type="checkbox" id="cards-export-tags" checked> Tags (Notas)</label>
            <label class="check-label"><input type="checkbox" id="cards-export-deck" checked> Baralho (Notas)</label>
            <label class="check-label"><input type="checkbox" id="cards-export-notetype" checked> Tipo de nota (Notas)</label>
            <label class="check-label"><input type="checkbox" id="cards-export-guid" checked> GUID (Notas)</label>
          </fieldset>
        </div>
        <p class="hint" style="margin:10px 0 0;"><strong>.colpkg:</strong> representa a coleção inteira de Cards do StudyNoMentor; ao importar no Anki, esse formato é destinado à substituição/restauração da coleção.</p>`;
    }
    $id('cards-export-modal').style.display='flex';
  },
  _download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async exportAudit() {
    try {
      const bridge=window.CardsOfficialBridge;
      if(!bridge||typeof bridge.request!=='function')throw new Error('Collection oficial do Anki indisponível.');
      await bridge.bootstrap(false);
      const [state,status,preferences]=await Promise.all([
        bridge.request('/api/cards-official/collection/full-state'),
        bridge.request('/api/cards-official/status'),
        bridge.getOfficialPreferences()
      ]);
      const scope=(window.StudyGlobalScope&&StudyGlobalScope.cardsScope)?StudyGlobalScope.cardsScope():'plan',
        mirrors=(scope==='all'&&window.StudyGlobalScope&&StudyGlobalScope.allBy)?StudyGlobalScope.allBy('cards'):this.collectionCards(),
        localDecks=(scope==='all'&&window.StudyGlobalScope&&StudyGlobalScope.allBy)?StudyGlobalScope.allBy('decks'):this.collectionDecks(),
        activePlan=(typeof PlanManager!=='undefined'&&PlanManager.getActivePlan)?PlanManager.getActivePlan():null,
        activePlanId=activePlan?activePlan.id:null,
        officialCards=Array.isArray(state.cards)?state.cards:[],
        officialNotes=Array.isArray(state.notes)?state.notes:[],
        officialDecks=Array.isArray(state.decks)?state.decks:[],
        reviewer=state.reviewer||{finished:true,counts:{},queue_ids:[]},
        cardIds=new Set(officialCards.map(c=>String(c.id))),
        noteIds=new Set(officialNotes.map(n=>String(n.id))),
        queueIds=(reviewer.queue_ids||[]).map(Number);

      const mirrorByOfficial=new Map();
      mirrors.forEach(c=>{
        const oid=bridge._officialId?bridge._officialId(c):Number(c&&c.ankiId);
        if(!Number.isFinite(Number(oid))||Number(oid)<=0)return;
        const key=String(oid);
        if(!mirrorByOfficial.has(key))mirrorByOfficial.set(key,[]);
        mirrorByOfficial.get(key).push({
          localId:c.id,
          planId:c._planId||activePlanId||null,
          planName:c._planNome||null,
          materia:c.materia||null,
          assunto:c.assunto||null,
          banca:c.banca||null,
          favorito:!!c.favorito
        });
      });

      const deckOptions=[];
      await Promise.all(officialDecks.filter(d=>!d.filtered).map(async d=>{
        try{
          const raw=await bridge.request('/api/cards-official/deck/'+encodeURIComponent(d.id)+'/options'),
            ui=bridge._officialDeckOptionsUi(raw,true);
          deckOptions.push({
            deckId:Number(d.id),deckName:d.name||null,currentConfigId:ui.currentId,
            hasOwnPreset:ui.hasPreset,global:ui.global,config:ui.config,raw
          });
        }catch(e){
          deckOptions.push({deckId:Number(d.id),deckName:d.name||null,error:e&&e.message?e.message:String(e)});
        }
      }));
      deckOptions.sort((a,b)=>Number(a.deckId)-Number(b.deckId));

      const officialWithoutMirror=officialCards
        .filter(c=>!mirrorByOfficial.has(String(c.id)))
        .map(c=>({cardId:c.id,noteId:c.note_id,deckId:c.deck_id}));
      const mirrorWithoutOfficial=[];
      mirrorByOfficial.forEach((rows,id)=>{
        if(!cardIds.has(id))mirrorWithoutOfficial.push({officialCardId:Number(id),mirrors:rows});
      });
      const queueUnknownIds=queueIds.filter(id=>!cardIds.has(String(id)));
      const noteCardMissing=[];
      officialNotes.forEach(n=>(n.card_ids||[]).forEach(id=>{
        if(!cardIds.has(String(id)))noteCardMissing.push({noteId:n.id,cardId:id});
      }));
      const cardsWithMissingNote=officialCards
        .filter(c=>!noteIds.has(String(c.note_id)))
        .map(c=>({cardId:c.id,noteId:c.note_id}));

      const rawReviewLog=[];
      officialCards.forEach(c=>(c.review_logs||[]).forEach(r=>{
        rawReviewLog.push(Object.assign({_official_card_id:c.id},r));
      }));
      rawReviewLog.sort((a,b)=>Number(a.id||a.review_time||0)-Number(b.id||b.review_time||0));

      const planIds=[...new Set([]
        .concat(mirrors.map(c=>c&&c._planId),localDecks.map(d=>d&&d._planId))
        .filter(x=>x!=null&&String(x)!==''))];
      const includedPlans=planIds.map(pid=>({
        id:pid,
        name:(window.StudyGlobalScope&&StudyGlobalScope.planName)?StudyGlobalScope.planName(pid):(String(pid)===String(activePlanId)&&activePlan?activePlan.nome:null),
        paused:!!(typeof PlanManager!=='undefined'&&PlanManager.isPaused&&PlanManager.isPaused(pid)),
        cardMirrors:mirrors.filter(c=>String(c._planId||activePlanId||'')===String(pid)).length,
        deckMirrors:localDecks.filter(d=>String(d._planId||activePlanId||'')===String(pid)).length
      }));

      const anomalies=[];
      officialWithoutMirror.forEach(x=>anomalies.push(Object.assign({type:'official_card_without_study_mirror'},x)));
      mirrorWithoutOfficial.forEach(x=>anomalies.push(Object.assign({type:'study_mirror_without_official_card'},x)));
      queueUnknownIds.forEach(id=>anomalies.push({type:'official_queue_unknown_card',cardId:id}));
      noteCardMissing.forEach(x=>anomalies.push(Object.assign({type:'official_note_references_missing_card'},x)));
      cardsWithMissingNote.forEach(x=>anomalies.push(Object.assign({type:'official_card_references_missing_note'},x)));
      deckOptions.filter(x=>x.error).forEach(x=>anomalies.push({type:'official_deck_options_unreadable',deckId:x.deckId,error:x.error}));

      const payload={
        schema:'studynomentor-cards-official-audit',
        version:5,
        exportedAt:new Date().toISOString(),
        appDate:todayCards(),
        purpose:'Fotografia forense da Collection oficial do Anki usada pelos Cards, com metadados de espelho do Study.',
        authority:{
          academicState:'Anki official Collection',
          studyRole:'UI/shell + metadados de planejamento',
          pinnedVersion:status&&status.pinned_version||'26.09.3',
          runtimeVersion:status&&status.runtime_version||null,
          collection:status&&status.collection||'study-cards',
          schedulerReplay:'disabled',
          note:'Nenhum estado acadêmico deste arquivo é recalculado por uma implementação local.'
        },
        scope:{
          mode:scope,
          label:scope==='all'?'Todos os planejamentos':'Este planejamento',
          activePlanId,
          activePlanName:activePlan?activePlan.nome:null,
          includedPlanIds:planIds,
          includedPlans
        },
        environment:{
          userAgent:navigator.userAgent,
          language:navigator.language,
          timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
          online:navigator.onLine
        },
        official:{
          status,
          preferences,
          reviewer,
          decks:officialDecks,
          deckOptions,
          notetypes:Array.isArray(state.notetypes)?state.notetypes:[],
          notes:officialNotes,
          cards:officialCards,
          rawReviewLog
        },
        studyMirror:{
          cards:mirrors.map(c=>({
            localId:c.id,
            officialCardId:bridge._officialId?bridge._officialId(c):Number(c&&c.ankiId)||null,
            planId:c._planId||activePlanId||null,
            planName:c._planNome||null,
            materia:c.materia||null,
            assunto:c.assunto||null,
            banca:c.banca||null,
            favorito:!!c.favorito
          })),
          decks:localDecks.map(d=>({
            localId:d.id,
            officialDeckId:Number(d&&d.ankiId!=null?d.ankiId:d&&d.id)||null,
            planId:d._planId||activePlanId||null,
            planName:d._planNome||null,
            nome:d.nome||null
          })),
          replicas:[...mirrorByOfficial.entries()].map(([officialCardId,rows])=>({officialCardId:Number(officialCardId),mirrors:rows}))
        },
        consistency:{
          source:'identity/linkage checks only; scheduling truth is not recomputed',
          officialCards:officialCards.length,
          officialNotes:officialNotes.length,
          officialDecks:officialDecks.length,
          revisionEntries:rawReviewLog.length,
          queueCount:queueIds.length,
          queueCounts:Object.assign({new:0,learning:0,review:0},reviewer.counts||{}),
          officialWithoutMirror,
          mirrorWithoutOfficial,
          queueUnknownIds,
          noteCardMissing,
          cardsWithMissingNote,
          anomalies
        }
      };
      const sufixo=scope==='all'?'todos-planejamentos':'planejamento-atual',
        serialized=JSON.stringify(payload);
      this._download('auditoria-cards_'+sufixo+'_'+todayLocal()+'.json.txt',serialized,'text/plain;charset=utf-8');
      showToast('Auditoria oficial exportada em texto (JSON compacto) ✓');
    } catch(err) {
      console.error('Falha ao exportar auditoria oficial dos cards:',err);
      showToast('Não foi possível exportar. Detalhe: '+(err&&err.message?err.message:'erro desconhecido'));
    }
  },
  _exportChecked(id, fallback) {
    const el=document.getElementById(id);
    return el ? !!el.checked : !!fallback;
  },
  _ankiExportLimit() {
    const el=document.getElementById('cards-export-scope'),v=el?String(el.value||'all'):'all';
    return v.startsWith('deck:')?{deckId:v.slice(5)}:{wholeCollection:true};
  },
  _ankiPackageOptions() {
    return {
      legacy:this._exportChecked('cards-export-legacy',false),
      withScheduling:this._exportChecked('cards-export-scheduling',true),
      withDeckConfigs:this._exportChecked('cards-export-deckconfigs',true),
      withMedia:this._exportChecked('cards-export-media',true),
      limit:this._ankiExportLimit()
    };
  },
  _ankiTextOptions() {
    return {
      withHtml:this._exportChecked('cards-export-html',true),
      withTags:this._exportChecked('cards-export-tags',true),
      withDeck:this._exportChecked('cards-export-deck',true),
      withNotetype:this._exportChecked('cards-export-notetype',true),
      withGuid:this._exportChecked('cards-export-guid',true),
      limit:this._ankiExportLimit()
    };
  },
  async exportAnkiNotes() {
    if(!this.collectionCards().length){showToast('Nenhum card para exportar');return;}
    try{
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.exportOfficialText!=='function')throw new Error('Backend oficial do Anki indisponível.');
      const out=await CardsOfficialBridge.exportOfficialText('notes',this._ankiTextOptions());
      this._download('notas-anki_'+todayLocal()+'.txt',out.blob,'text/plain;charset=utf-8');
      showToast('Notas exportadas pela Collection oficial do Anki: '+out.count.toLocaleString('pt-BR')+' ✓');
      $id('cards-export-modal').style.display='none';
    }catch(err){
      console.error('Falha ao exportar notas pelo Anki oficial:',err);
      showToast('Não foi possível exportar as notas. Detalhe: '+(err&&err.message?err.message:String(err)));
    }
  },
  async exportAnki() {
    if(!this.collectionCards().length){showToast('Nenhum card para exportar');return;}
    try{
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.exportOfficialText!=='function')throw new Error('Backend oficial do Anki indisponível.');
      const out=await CardsOfficialBridge.exportOfficialText('cards',{withHtml:this._exportChecked('cards-export-html',true),limit:this._ankiExportLimit()});
      this._download('cards-anki_'+todayLocal()+'.txt',out.blob,'text/plain;charset=utf-8');
      showToast('Cards exportados pela Collection oficial do Anki: '+out.count.toLocaleString('pt-BR')+' ✓');
      $id('cards-export-modal').style.display='none';
    }catch(err){
      console.error('Falha ao exportar cards pelo Anki oficial:',err);
      showToast('Não foi possível exportar os cards. Detalhe: '+(err&&err.message?err.message:String(err)));
    }
  },
  async _exportAnkiPackage(kind) {
    const cards=this.collectionCards();if(!cards.length){showToast('Nenhum card para exportar');return;}
    kind=kind==='colpkg'?'colpkg':'apkg';
    const btn=document.getElementById(kind==='colpkg'?'cards-export-colpkg':'cards-export-apkg'),old=btn?btn.textContent:'';
    if(btn){btn.disabled=true;btn.textContent='⏳ Exportando pelo Anki oficial…';}
    try{
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.exportOfficialPackage!=='function')throw new Error('Backend oficial do Anki indisponível.');
      const opts=this._ankiPackageOptions(),out=await CardsOfficialBridge.exportOfficialPackage(kind,opts);
      this._download('cards-anki_'+todayLocal()+'.'+kind,out.blob,'application/octet-stream');
      const count=out.cards==null
        ?(kind==='apkg'&&opts.limit&&opts.limit.deckId
          ?cards.filter(c=>String(c.originalDeckId||c.deckId)===String(opts.limit.deckId)).length
          :cards.length)
        :out.cards;
      showToast('.'+kind+' exportado pela Collection oficial do Anki · '+Number(count||0).toLocaleString('pt-BR')+' card(s) ✓');
      $id('cards-export-modal').style.display='none';
    }catch(err){
      console.error('Falha ao exportar .'+kind+' pelo Anki oficial:',err);
      showToast('Não foi possível gerar o .'+kind+'. Detalhe: '+(err&&err.message?err.message:String(err)));
    }finally{
      if(btn){btn.disabled=false;btn.textContent=old||(kind==='colpkg'?'Coleção (.colpkg)':'Anki (.apkg)');}
    }
  },
  exportApkg() { return this._exportAnkiPackage('apkg'); },
  exportColpkg() { return this._exportAnkiPackage('colpkg'); },
  exportJson() {
    const scope=(window.StudyGlobalScope&&StudyGlobalScope.cardsScope)?StudyGlobalScope.cardsScope():'plan';
    const payload = { app: 'diario-estudos', kind: 'cards-backup', version: 3, exportedAt: new Date().toISOString(), scope, decks: this.collectionDecks(), cards: this.collectionCards(), revlog: this._mirrorRevlog() };
    this._download('cards-backup_' + todayLocal() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    showToast('Backup exportado ✓');
    $id('cards-export-modal').style.display = 'none';
  },

  // ---- importar ----
  openImportModal() {
    this._importParsed = null;
    this._importFile = null;
    this._officialCsvMetadata = null;
    const textOpts=document.getElementById('cards-import-text-options');if(textOpts)textOpts.style.display='none';
    const mapBox=document.getElementById('cards-import-field-mapping');if(mapBox)mapBox.innerHTML='';
    const globalTags=document.getElementById('cards-import-global-tags');if(globalTags)globalTags.value='';
    const updatedTags=document.getElementById('cards-import-updated-tags');if(updatedTags)updatedTags.value='';
    $id('cards-import-destino').innerHTML = this.destinoOptionsHtml('');
    $id('cards-import-preview').textContent = 'Aguardando arquivo...';
    $id('cards-import-preview').style.color = 'var(--text-faint)';
    const fn = document.getElementById('cards-import-name'); fn.style.display = 'none';
    $id('cards-import-file').value = '';
    $id('cards-import-modal').style.display = 'flex';
  },
  _textColumnLabels(parsed) {
    const n=Math.max((parsed.columns||[]).length,...(parsed.rows||[]).map(r=>r.length),0);
    return Array.from({length:n},(_,i)=>(parsed.columns&&parsed.columns[i])?String(parsed.columns[i]):('Coluna '+(i+1)));
  },
  renderTextImportOptions(parsed) {
    const box=document.getElementById('cards-import-text-options'),ntSel=document.getElementById('cards-import-notetype'),mapBox=document.getElementById('cards-import-field-mapping');
    if(!box||!ntSel||!mapBox)return;box.style.display=parsed&&parsed.kind==='text'?'block':'none';if(!parsed||parsed.kind!=='text')return;
    const globalTags=document.getElementById('cards-import-global-tags'),updatedTags=document.getElementById('cards-import-updated-tags');
    if(globalTags)globalTags.value=(parsed.globalTags||[]).join(' ');if(updatedTags)updatedTags.value='';
    const types=typeof AnkiParity!=='undefined'?AnkiParity.noteTypes():[],labels=this._textColumnLabels(parsed);
    ntSel.innerHTML=types.map(nt=>'<option value="'+escapeHtml(String(nt.id))+'">'+escapeHtml(String(nt.name||'Tipo de nota'))+'</option>').join('');
    let wanted=String(parsed.globalNotetype||'').trim(),hit=types.find(nt=>String(nt.id)===wanted||String(nt.ankiId||'')===wanted||String(nt.name||'').toLowerCase()===wanted.toLowerCase());
    if(hit)ntSel.value=String(hit.id);else if(types.length)ntSel.value=String(types[0].id);
    const render=()=>{
      const nt=types.find(x=>String(x.id)===String(ntSel.value))||types[0],opt=(selected)=>'<option value="0">— nenhuma —</option>'+labels.map((x,i)=>'<option value="'+(i+1)+'" '+(Number(selected)===i+1?'selected':'')+'>'+escapeHtml((i+1)+': '+x)+'</option>').join('');
      const regularSpecial=new Set([parsed.deckColumn,parsed.notetypeColumn,parsed.tagsColumn,parsed.guidColumn].filter(Boolean));
      let regular=labels.map((_,i)=>i+1).filter(i=>!regularSpecial.has(i)),html='<p class="hint" style="margin:0 0 7px;"><strong>Colunas especiais</strong></p><div class="field-group">';
      html+='<div class="field"><label>Tipo por coluna</label><select id="cards-import-col-notetype">'+opt(parsed.notetypeColumn)+'</select></div>';
      html+='<div class="field"><label>Baralho por coluna</label><select id="cards-import-col-deck">'+opt(parsed.deckColumn)+'</select></div>';
      html+='<div class="field"><label>Tags por coluna</label><select id="cards-import-col-tags">'+opt(parsed.tagsColumn)+'</select></div>';
      html+='<div class="field"><label>GUID por coluna</label><select id="cards-import-col-guid">'+opt(parsed.guidColumn)+'</select></div></div>';
      if(nt&&!(parsed.notetypeColumn>0)){
        html+='<p class="hint" style="margin:10px 0 7px;"><strong>Mapeamento para os campos de '+escapeHtml(String(nt.name||''))+'</strong></p><div class="field-group">';
        (nt.fields||[]).forEach((field,i)=>{
          let selected=0;const byName=labels.findIndex(x=>String(x).trim().toLowerCase()===String(field.name||'').trim().toLowerCase());if(byName>=0&&!regularSpecial.has(byName+1))selected=byName+1;else selected=regular[i]||0;
          html+='<div class="field"><label>'+escapeHtml(String(field.name||('Campo '+(i+1))))+'</label><select class="cards-import-field-col" data-field-ord="'+i+'">'+opt(selected)+'</select></div>';
        });html+='</div>';
      }else if(parsed.notetypeColumn>0)html+='<p class="hint" style="margin:10px 0 0;">Com “notetype column”, os campos regulares são mapeados por ordem para cada tipo de nota, exatamente como no Anki.</p>';
      mapBox.innerHTML=html;
    };
    ntSel.onchange=render;render();
  },
  async handleImportFile(file) {
    if (!file) return;
    this._importFile = file;
    const fn = document.getElementById('cards-import-name');
    fn.style.display = 'inline-flex'; fn.textContent = '📎 ' + file.name;
    const prev = document.getElementById('cards-import-preview');
    prev.textContent = '⏳ Lendo e validando o arquivo...'; prev.style.color = 'var(--text-faint)';
    try {
      let parsed = null;
      if (/\.json$/i.test(file.name)) {
        const text = await file.text();
        const obj = jsonSeguro(text);
        if (obj && obj.kind === 'cards-backup' && Array.isArray(obj.cards)) {
          parsed = { kind: 'json', cards: obj.cards, decks: obj.decks || [], revlog: Array.isArray(obj.revlog) ? obj.revlog : [] };
        } else throw new Error('JSON não é um backup de cards válido.');
      } else {
        if (typeof AnkiImport === 'undefined') throw new Error('Importador Anki não foi carregado.');
        parsed = await AnkiImport.inspectFile(file);
        if (!parsed) throw new Error('Formato não reconhecido.');
      }
      this._importParsed = parsed;
      let n = 0, detalhe = '';
      if (parsed.kind === 'json') n = parsed.cards.length;
      else if (parsed.kind === 'text') {
        n = parsed.rows.length;
        this._officialCsvMetadata=parsed.metadata;
        const html = document.getElementById('cards-import-html');
        if (html && parsed.headers && Object.prototype.hasOwnProperty.call(parsed.headers, 'html')) html.checked = !!parsed.isHtml;
        this.renderTextImportOptions(parsed);
        detalhe = parsed.columns && parsed.columns.length ? ' · colunas: ' + parsed.columns.join(', ') : '';
      } else if (parsed.counts) {
        const tbox=document.getElementById('cards-import-text-options');if(tbox)tbox.style.display='none';
        n = Number(parsed.counts.cards) || 0;
        detalhe = ' · ' + (Number(parsed.counts.notes)||0) + ' nota(s)' + (parsed.counts.revlog ? ' · ' + parsed.counts.revlog + ' revisão(ões)' : '');
      }
      if(parsed.inspectionDeferred){prev.textContent='✓ Arquivo selecionado. O Anki oficial fará a validação e a importação.';prev.style.color='var(--ok)';}
      else if(parsed.previewOnly){prev.textContent='✓ Prévia oficial: '+n+' linha(s) na amostra.'+detalhe;prev.style.color='var(--ok)';}
      else if (!n) { prev.textContent = '⚠ Nenhum card reconhecido no arquivo.'; prev.style.color = 'var(--warn)'; }
      else { prev.textContent = '✓ ' + n + ' card(s) reconhecido(s)' + detalhe + '.'; prev.style.color = 'var(--good)'; }
    } catch (err) {
      this._importParsed = null;
      prev.textContent = '⚠ ' + (err && err.message ? err.message : String(err));
      prev.style.color = 'var(--bad)';
    }
  },
  async doImport() {
    if (!this._importParsed) { showToast('Escolha um arquivo primeiro'); return; }
    const dest = $id('cards-import-destino').value;
    let deckId = null, materia = null;
    if (dest.startsWith('deck:')) deckId = dest.slice(5);
    else if (dest.startsWith('sub:')) materia = dest.slice(4);
    const withScheduling = !!(document.getElementById('cards-import-scheduling') || {}).checked;
    const withDeckConfigs = !!(document.getElementById('cards-import-deck-configs') || {}).checked;
    const mergeNotetypes = !!(document.getElementById('cards-import-merge-notetypes') || {}).checked;
    const updateNotes = (document.getElementById('cards-import-update-notes') || {}).value || 'if-newer';
    const updateNotetypes = (document.getElementById('cards-import-update-notetypes') || {}).value || 'if-newer';
    const isHtml = !!(document.getElementById('cards-import-html') || {}).checked;
    const delimiterName=(document.getElementById('cards-import-delimiter')||{}).value||'',delims={tab:'\t',pipe:'|',semicolon:';',colon:':',comma:',',space:' '};
    const dupeResolution=(document.getElementById('cards-import-dupe')||{}).value||'update',matchScope=(document.getElementById('cards-import-match-scope')||{}).value||'notetype';
    const splitTags=id=>String((document.getElementById(id)||{}).value||'').trim().split(/\s+/).filter(Boolean);
    const globalTags=splitTags('cards-import-global-tags'),updatedTags=splitTags('cards-import-updated-tags');
    const notetypeId=(document.getElementById('cards-import-notetype')||{}).value||null;
    const readCol=id=>Math.max(0,Number((document.getElementById(id)||{}).value)||0);
    const fieldColumns=[...document.querySelectorAll('.cards-import-field-col')].sort((a,b)=>Number(a.dataset.fieldOrd)-Number(b.dataset.fieldOrd)).map(x=>Number(x.value)||0);
    let count = 0;
    if (this._importParsed.kind === 'json') {
      throw new Error('Importação de backup JSON legado foi desativada nos Cards: ela alterava agendamento fora da Collection oficial. Use .apkg/.colpkg ou TXT/CSV pelo importador oficial do Anki.');
    } else if (this._importParsed.kind === 'anki-package') {
      if(!this._importFile)throw new Error('Arquivo original do pacote não está mais disponível.');
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.importOfficialPackage!=='function')throw new Error('Backend oficial do Anki indisponível.');
      const kind=this._importParsed.format==='colpkg'?'colpkg':'apkg',
        official=await CardsOfficialBridge.importOfficialPackage(this._importFile,{
          kind,withScheduling,withDeckConfigs,mergeNotetypes,updateNotes,updateNotetypes
        });
      await CardsOfficialBridge.syncOfficialPackageImport(official);
      count = Number(official.cards) || Number(official.state&&official.state.cards&&official.state.cards.length) || 0;
    } else if (this._importParsed.kind === 'mnemosyne') {
      if(!this._importFile)throw new Error('Arquivo Mnemosyne original não está mais disponível.');
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.importOfficialMnemosyne!=='function')throw new Error('Backend oficial do Anki indisponível.');
      const official=await CardsOfficialBridge.importOfficialMnemosyne(this._importFile,deckId);
      await CardsOfficialBridge.syncOfficialPackageImport(official);
      count = Number(official.state&&official.state.cards&&official.state.cards.length) || 0;
    } else if (this._importParsed.kind === 'text') {
      if(!this._importFile)throw new Error('Arquivo original de texto não está mais disponível.');
      if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.importOfficialCsv!=='function')throw new Error('Backend oficial do Anki indisponível.');
      const meta=JSON.parse(JSON.stringify(this._officialCsvMetadata||{})),
        delimiterMap={tab:0,pipe:1,semicolon:2,colon:3,comma:4,space:5},
        nt=notetypeId?AnkiParity.getNotetype(notetypeId):null,
        ntOfficial=nt?Number(nt.ankiId!=null?nt.ankiId:nt.id):null,
        deckOfficial=deckId?CardsOfficialBridge._officialDeckId(deckId):null,
        ntCol=readCol('cards-import-col-notetype'),deckCol=readCol('cards-import-col-deck'),
        tagsCol=readCol('cards-import-col-tags'),guidCol=readCol('cards-import-col-guid');
      if(delimiterName){meta.delimiter=delimiterMap[delimiterName];meta.force_delimiter=true;}
      meta.is_html=!!isHtml;meta.force_is_html=true;meta.global_tags=globalTags;meta.updated_tags=updatedTags;
      meta.dupe_resolution=dupeResolution==='preserve'?1:(dupeResolution==='duplicate'?2:0);
      meta.match_scope=matchScope==='notetype-and-deck'?1:0;meta.tags_column=tagsCol;meta.guid_column=guidCol;
      delete meta.global_notetype;delete meta.notetype_column;
      if(ntCol>0)meta.notetype_column=ntCol;
      else if(ntOfficial)meta.global_notetype={id:ntOfficial,field_columns:fieldColumns};
      delete meta.deck_id;delete meta.deck_column;delete meta.deck_name;
      if(deckCol>0)meta.deck_column=deckCol;else if(deckOfficial)meta.deck_id=Number(deckOfficial);
      const official=await CardsOfficialBridge.importOfficialCsv(this._importFile,meta);
      await CardsOfficialBridge.syncOfficialPackageImport(official);
      count = Number(official.state&&official.state.cards&&official.state.cards.length) || 0;
    }
    $id('cards-import-modal').style.display = 'none';
    this.render();
    showToast(count + ' card(s) importado(s) ✓');
  }
};
// Passo 1: escolher o ESCOPO (global ou um baralho específico) — como o Anki (presets por baralho)
CardsScreen.openAlgoConfig = function () {
  const decks = CardsScreen.collectionDecks().slice()
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { numeric: true, sensitivity: 'base' }));
  const opts = [{ value: '__global__', label: '🌐 Global (padrão de todos)' }].concat(
    decks.map(d => ({ value: d.id, label: '📁 ' + CardsScreen._rotuloBaralho(d, decks) }))
  );
  opts.push({ value: '__bancas__', label: '🏛️ Gerenciar bancas…' });
  opts.push({ value: '__empty__', label: '🧹 Cards vazios · ferramenta oficial Anki…' });
  UI.prompt([{ key: 'scope', label: '⚙ Configurar qual conjunto?', type: 'select', value: '__global__', options: opts,
    hint: 'Como no Anki: FSRS/SM-2 é global. Retenção, passos, limites e demais parâmetros podem variar por preset/baralho.' }],
    { title: '⚙ Parâmetros do Anki', okText: 'Continuar' }).then(v => {
      if (!v) return;
      if (v.scope === '__bancas__') { CardsScreen.openBancasModal(); return; }
      if (v.scope === '__empty__') {
        if (window.CardsOfficialBridge && typeof CardsOfficialBridge.openEmptyCards === 'function') void CardsOfficialBridge.openEmptyCards();
        else showToast('Ferramenta Empty Cards oficial indisponível.');
        return;
      }
      void CardsScreen.openAlgoConfigFor(v.scope === '__global__' ? null : v.scope);
    });
};

/* A antiga ação local “zerar estatísticas” foi removida: o Study não apaga/recria
   agendamento ou revlog fora das operações expostas pelo Anki oficial. */
CardsScreen.optimizeFsrsOfficial = async function (deckId) {
  if (!window.CardsOfficialBridge || typeof CardsOfficialBridge.optimizeFsrsPreset !== 'function')
    throw new Error('Otimizador oficial do Anki indisponível.');
  const ui=await CardsOfficialBridge.getDeckOptionsUi(deckId==null?null:deckId);
  if(ui.global.algo!=='fsrs')throw new Error('Ative o FSRS no Anki antes de otimizar parâmetros.');
  return CardsOfficialBridge.optimizeFsrsPreset(deckId == null ? null : deckId);
};

CardsScreen.optimizeAllFsrsPresets = async function(){
  if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.officialFsrsScopes!=='function')throw new Error('Otimizador oficial do Anki indisponível.');
  const scopes=await CardsOfficialBridge.officialFsrsScopes(),results=[];
  if(!scopes.length)throw new Error('Ative o FSRS no Anki antes de otimizar parâmetros.');
  for(const scope of scopes){
    const deckId=scope.deckId;
    try{
      const out=await CardsOfficialBridge.optimizeFsrsPreset(deckId);
      results.push({deckId,configId:scope.configId,fsrsItems:out.fsrsItems,alreadyOptimal:out.alreadyOptimal,ok:true});
    }catch(e){results.push({deckId,configId:scope.configId,ok:false,error:e&&e.message?e.message:String(e)});}
  }
  return results;
};
CardsScreen.fsrsHealthCheck = async function(deckId){
  if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.fsrsHealthCheck!=='function')throw new Error('Health Check oficial do Anki indisponível.');
  const ui=await CardsOfficialBridge.getDeckOptionsUi(deckId==null?null:deckId);
  if(ui.global.algo!=='fsrs')throw new Error('Ative o FSRS no Anki antes do Health Check.');
  return CardsOfficialBridge.fsrsHealthCheck(deckId==null?null:deckId);
};
/* Reagendamento FSRS local removido. Reschedule Cards on Change é executado
   exclusivamente pelo update_deck_configs/scheduler do Anki oficial. */
// Passo 2: formulário para o escopo escolhido (deckId=null → global)
CardsScreen.openAlgoConfigFor = async function (deckId) {
  const isDeck = !!deckId;
  if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.getDeckOptionsUi!=='function'){
    showToast('Deck Options oficiais indisponíveis.');return;
  }
  let official;
  try{official=await CardsOfficialBridge.getDeckOptionsUi(isDeck?deckId:null);}
  catch(e){showToast('Deck Options não carregadas do Anki oficial: '+(e&&e.message?e.message:String(e)));return;}
  const g = official.global;
  const cfg = official.config;
  const deckName = isDeck ? ((CardsScreen.collectionDecks().find(d => String(d.id) === String(deckId)) || {}).nome || 'baralho') : null;
  const hasPreset = !!official.hasPreset;
  const fields = [
    ...(!isDeck ? [{
      key: 'algo', label: '🧠 Algoritmo de repetição espaçada', type: 'select', value: cfg.algo,
      options: [{ value: 'fsrs', label: 'FSRS-6 (recomendado — igual ao Anki atual)' }, { value: 'sm2', label: 'Clássico (SM-2)' }],
      hint: 'Como no Anki, esta escolha é global. Presets podem variar retenção e parâmetros, não o algoritmo ligado.'
    }] : []),
    { key: 'retention', label: '🎯 Retenção-alvo (%) — só FSRS', type: 'number', value: Math.round(cfg.retention * 100), min: 70, max: 99,
      hint: 'Faixa do Anki/FSRS: 70–99%. Padrão: 90%. Valores muito altos aumentam bastante a carga.' },
    { key: 'fsrsReschedule', label: '🔄 Reagendar cards ao salvar alterações FSRS', type: 'select', value: '0',
      options: [{value:'0',label:'Não'},{value:'1',label:'Sim — Reschedule Cards on Change'}],
      hint: 'Opção transitória como no Anki: recalcula S/D, intervalo e vencimento dos cards de revisão e grava uma entrada de histórico “rescheduled”.' },
    { key: 'learn', label: '⏱️ Passos de aprendizado (min)', type: 'text', value: cfg.learnSteps.join(' '), placeholder: '1 10',
      hint: 'Card novo: você o revê nesses minutos até fixar (ex.: 1 10).' },
    { key: 'relearn', label: '🔁 Passos de reaprendizado (min)', type: 'text', value: cfg.relearnSteps.join(' '), placeholder: '10',
      hint: 'Ao errar um card já aprendido, ele volta nesses minutos.' },
    { key: 'maxInterval', label: '📆 Intervalo máximo (dias)', type: 'number', value: cfg.maxInterval || 36500, min: 1, max: 36500,
      hint: 'Teto de espera entre revisões. Padrão Anki: 36500 (100 anos).' },
    { key: 'leechThreshold', label: '🚫 Erros até marcar como problemático', type: 'number', value: cfg.leechThreshold != null ? cfg.leechThreshold : 8, min: 0, max: 99,
      hint: 'Padrão Anki: 8. Use 0 para desativar.' },
    { key: 'leechAction', label: '🚫 O que fazer com o card problemático', type: 'select', value: cfg.leechAction || 'tag',
      options: [{ value: 'suspend', label: 'Suspender (tira da fila)' }, { value: 'tag', label: 'Só marcar (padrão Anki 26.09.2)' }],
      hint: 'Suspenso some da revisão até você reativar em Meus cards.' },
    { key: 'showTimer', label: '⏱️ Mostrar timer no reviewer', type: 'select', value: cfg.showTimer ? '1' : '0',
      options: [{ value:'0', label:'Não' }, { value:'1', label:'Sim' }],
      hint: 'Espelha show_timer do Anki. O tempo gravado no revlog respeita o teto abaixo.' },
    { key: 'capAnswerTimeToSecs', label: '⏲️ Tempo máximo contabilizado (s)', type: 'number', value: cfg.capAnswerTimeToSecs == null ? 60 : cfg.capAnswerTimeToSecs, min: 0, max: 86400,
      hint: 'Padrão Anki: 60s. 0 = sem teto.' },
    { key: 'stopTimerOnAnswer', label: '⏹️ Parar timer ao mostrar resposta', type: 'select', value: cfg.stopTimerOnAnswer ? '1' : '0',
      options: [{ value:'0', label:'Não' }, { value:'1', label:'Sim' }],
      hint: 'Se ligado, o tempo salvo termina quando o verso é revelado; senão, termina ao avaliar.' },
    { key: 'disableAutoplay', label: '🔇 Desativar reprodução automática', type: 'select', value: cfg.disableAutoplay ? '1' : '0',
      options: [{ value:'0', label:'Não' }, { value:'1', label:'Sim' }],
      hint: 'Controla áudio/TTS automático de templates importados.' },
    { key: 'secondsToShowQuestion', label: '⏭️ Mostrar resposta automaticamente após (s)', type: 'number', value: cfg.secondsToShowQuestion || 0, min: 0, max: 86400,
      hint: '0 = desligado. Quando ativo, usa a ação configurada pelo preset do Anki.' },
    { key: 'secondsToShowAnswer', label: '⏭️ Agir automaticamente na resposta após (s)', type: 'number', value: cfg.secondsToShowAnswer || 0, min: 0, max: 86400,
      hint: '0 = desligado. A ação automática importada do Anki é preservada.' },
    { key: 'questionAction', label: '⏭️ Ação ao terminar o tempo da pergunta', type: 'select', value: String(Number(cfg.questionAction)||0),
      options: [{value:'0',label:'Mostrar resposta'},{value:'1',label:'Mostrar lembrete'}],
      hint: 'Usada somente quando Auto Advance está ligado no reviewer.' },
    { key: 'answerAction', label: '⏭️ Ação ao terminar o tempo da resposta', type: 'select', value: String(Number(cfg.answerAction)||0),
      options: [{value:'0',label:'Enterrar card'},{value:'1',label:'Responder Errei'},{value:'2',label:'Responder Bom'},{value:'3',label:'Responder Difícil'},{value:'4',label:'Mostrar lembrete'}],
      hint: 'Mesma enumeração do reviewer atual do Anki.' },
    { key: 'waitForAudio', label: '🔊 Auto Advance aguarda o áudio', type: 'select', value: cfg.waitForAudio?'1':'0',
      options: [{value:'1',label:'Sim'},{value:'0',label:'Não'}],
      hint: 'Quando ligado, o timer pode expirar, mas a ação só ocorre quando a fila de áudio/TTS termina.' },
    { key: 'skipQuestionWhenReplayingAnswer', label: '🔁 Ao repetir no verso, pular áudio da pergunta', type: 'select', value: cfg.skipQuestionWhenReplayingAnswer?'1':'0',
      options: [{value:'0',label:'Não'},{value:'1',label:'Sim'}],
      hint: 'Controla se Repetir mídia no lado da resposta inclui também o áudio da pergunta.' },
    { key: 'buryNew', label: '🫥 Enterrar irmãos novos', type: 'select', value: cfg.buryNew ? '1' : '0',
      options: [{ value:'0', label:'Não (padrão 26.09.2)' }, { value:'1', label:'Sim' }],
      hint: 'Depois de responder um card, esconde até amanhã os irmãos novos da mesma nota.' },
    { key: 'buryReviews', label: '🫥 Enterrar irmãos em revisão', type: 'select', value: cfg.buryReviews ? '1' : '0',
      options: [{ value:'0', label:'Não (padrão 26.09.2)' }, { value:'1', label:'Sim' }],
      hint: 'Aplica o mesmo enterramento aos irmãos que já estão em revisão.' },
    { key: 'buryInterdayLearning', label: '🫥 Enterrar irmãos em aprendizado entre dias', type: 'select', value: cfg.buryInterdayLearning ? '1' : '0',
      options: [{ value:'0', label:'Não (padrão 26.09.2)' }, { value:'1', label:'Sim' }],
      hint: 'Controla os irmãos em learning/relearning que atravessaram a virada do dia.' }
  ];
  /* ── ORDENAÇÃO E MISTURA — paridade com deck_config.proto ──────────────────
     Cada rótulo diz o que a opção FAZ, não só como se chama. São escolhas cujo
     efeito só aparece depois de dias de uso, então a dica precisa explicar o
     porquê. */
  fields.push(
    { key: 'reviewOrder', label: '🔢 Ordem das revisões', type: 'select', value: cfg.reviewOrder || 'day',
      options: [
        { value: 'day',                label: 'Data de vencimento, depois aleatório (padrão Anki)' },
        { value: 'dayThenDeck',        label: 'Data de vencimento, depois baralho' },
        { value: 'deckThenDay',        label: 'Baralho, depois data de vencimento' },
        { value: 'retrievabilityAsc',  label: 'Mais perto de esquecer primeiro' },
        { value: 'retrievabilityDesc', label: 'Mais bem lembrado primeiro' },
        { value: 'relativeOverdueness',label: 'Atraso relativo ao intervalo' },
        { value: 'intervalsAsc',       label: 'Intervalo menor primeiro' },
        { value: 'intervalsDesc',      label: 'Intervalo maior primeiro' },
        { value: 'easeAsc',            label: 'Mais difíceis primeiro' },
        { value: 'easeDesc',           label: 'Mais fáceis primeiro' },
        { value: 'added',              label: 'Mais antigos primeiro' },
        { value: 'reverseAdded',       label: 'Mais recentes primeiro' },
        { value: 'random',             label: 'Aleatória' }
      ],
      hint: 'Com fila acumulada, isto muda muito o rendimento: revisar antes o que está prestes a sumir preserva mais memória por minuto. "Atraso relativo" prioriza quem passou mais tempo além do próprio intervalo — 3 dias de atraso num card de 3 dias é grave; num de 300, não.' },
    { key: 'newGatherOrder', label: '🆕 Quais cards novos entram primeiro', type: 'select', value: cfg.newGatherOrder || 'deck',
      options: [
        { value: 'deck',            label: 'Baralho, depois posição (padrão Anki)' },
        { value: 'deckRandomNotes', label: 'Baralho, depois notas aleatórias' },
        { value: 'posicao',         label: 'Posição crescente' },
        { value: 'posicaoDesc',     label: 'Posição decrescente' },
        { value: 'randomNotes',     label: 'Notas aleatórias' },
        { value: 'randomCards',     label: 'Cards aleatórios' }
      ],
      hint: 'Espelha NewCardGatherPriority do Anki: decide quais novos entram antes do limite diário.' },
    { key: 'newInsertOrder', label: '🆕 Posição de um card recém-criado', type: 'select', value: cfg.newInsertOrder || 'sequencial',
      options: [
        { value: 'sequencial', label: 'No fim da fila (padrão)' },
        { value: 'aleatoria',  label: 'Posição sorteada' }
      ],
      hint: 'Decidida no momento da criação. "Sorteada" faz um lote grande se intercalar com o que já esperava, em vez de virar um bloco no fim.' },
    { key: 'newSortOrder', label: '🆕 Ordem de exibição dos novos', type: 'select', value: cfg.newSortOrder || 'template',
      options: [
        { value: 'template',           label: 'Template, depois coleta (padrão Anki)' },
        { value: 'coleta',             label: 'Manter a ordem de coleta' },
        { value: 'templateRandom',     label: 'Template, depois aleatório' },
        { value: 'randomNoteTemplate', label: 'Nota aleatória, depois template' },
        { value: 'randomCard',         label: 'Card aleatório' }
      ],
      hint: 'Espelha NewCardSortOrder do Anki; o aleatório é determinístico e estável ao reconstruir a fila.' },
    { key: 'newMix', label: '🔀 Onde entram os cards NOVOS', type: 'select', value: cfg.newMix || 'misturar',
      options: [
        { value: 'misturar', label: 'Misturados com as revisões (padrão Anki)' },
        { value: 'depois',   label: 'Depois de todas as revisões' },
        { value: 'antes',    label: 'Antes de todas as revisões' }
      ],
      hint: '"Depois" é a escolha de quem prefere despachar a fila conhecida antes de gastar energia com conteúdo novo.' },
    { key: 'interdayMix', label: '🔀 Onde entra o aprendizado do dia anterior', type: 'select', value: cfg.interdayMix || 'misturar',
      options: [
        { value: 'misturar', label: 'Misturado com as revisões' },
        { value: 'depois',   label: 'Depois das revisões' },
        { value: 'antes',    label: 'Antes das revisões (padrão antigo)' }
      ],
      hint: 'Cards que você errou ontem e ficaram no meio do caminho.' },
    { key: 'easyDays', label: '📅 Easy Days (Dom→Sáb: 100/50/0)', type: 'text',
      value: (cfg.easyDays || [1,1,1,1,1,1,1]).map(x => x === 1 ? 100 : (x === 0 ? 0 : 50)).join(' '), placeholder: '100 100 100 100 100 100 100',
      hint: 'Mesma semântica do Anki: 100 = Normal, 50 = Reduced e 0 = Minimum. Sete valores, começando no domingo.' },
    { key: 'ignoreRevlogsBefore', label: '📜 Ignorar revisões anteriores a', type: 'text', value: cfg.ignoreRevlogsBefore || '', placeholder: 'AAAA-MM-DD',
      hint: 'Descarta o histórico antigo ao otimizar. Útil se você mudou de método ou importou baralho de terceiros. Vazio = usar tudo.' },
    { key: 'historicalRetention', label: '🕰️ Retenção histórica presumida (%)', type: 'number', value: Math.round((cfg.historicalRetention || 0.9) * 100), min: 50, max: 99,
      hint: 'Usada para converter cards antigos do SM-2 em estado de memória do FSRS. É a pergunta que o Anki faz ao migrar. Padrão: 90.' },
    { key: 'paramSearch', label: '🔎 Cards que treinam os parâmetros', type: 'text', value: cfg.paramSearch || '', placeholder: 'ex.: materia:tributário -suspenso',
      hint: 'Filtra quem entra no treino. Os parâmetros descrevem COMO VOCÊ ESQUECE — misturar lei seca com raciocínio lógico produz uma média que não descreve nenhum dos dois. Aceita materia: assunto: tipo: baralho: favorito suspenso leech, texto livre e "-" para excluir. Vazio = todos.' }
  );

  /* ── PARÂMETROS DO CLÁSSICO (SM-2) ─────────────────────────────────────────
     Só fazem efeito com o algoritmo Clássico selecionado. Com FSRS o intervalo
     vem do modelo de memória e estes multiplicadores são ignorados — igual ao
     Anki, que também esconde/desabilita a seção quando o FSRS está ligado. */
  fields.push(
    { key: 'initialEase', label: '📐 [Clássico] Facilidade inicial', type: 'number', value: Math.round((cfg.initialEase != null ? cfg.initialEase : 2.5) * 100), min: 130, max: 500,
      hint: 'Em centésimos: 250 = 2,50. Multiplicador aplicado ao intervalo quando você acerta "Bom". Padrão Anki: 250.' },
    { key: 'hardMultiplier', label: '📐 [Clássico] Multiplicador do "Difícil"', type: 'number', value: Math.round((cfg.hardMultiplier != null ? cfg.hardMultiplier : 1.2) * 100), min: 50, max: 130,
      hint: 'Em centésimos: 120 = 1,20. Padrão Anki: 120.' },
    { key: 'easyMultiplier', label: '📐 [Clássico] Bônus do "Fácil"', type: 'number', value: Math.round((cfg.easyMultiplier != null ? cfg.easyMultiplier : 1.3) * 100), min: 100, max: 500,
      hint: 'Em centésimos: 130 = 1,30. Padrão Anki: 130.' },
    { key: 'lapseMultiplier', label: '📐 [Clássico] Novo intervalo após errar (%)', type: 'number', value: Math.round((cfg.lapseMultiplier != null ? cfg.lapseMultiplier : 0) * 100), min: 0, max: 100,
      hint: 'Quanto do intervalo antigo o card mantém ao ser errado. 0 = recomeça. Padrão Anki: 0.' },
    { key: 'intervalMultiplier', label: '📐 [Clássico] Multiplicador global (%)', type: 'number', value: Math.round((cfg.intervalMultiplier != null ? cfg.intervalMultiplier : 1) * 100), min: 50, max: 200,
      hint: 'Escala TODOS os intervalos. 100 = normal. Abaixo de 100 revê mais; acima, menos.' },
    { key: 'minimumLapseInterval', label: '📐 [Clássico] Intervalo mínimo após errar (dias)', type: 'number', value: cfg.minimumLapseInterval != null ? cfg.minimumLapseInterval : 1, min: 1, max: 99,
      hint: 'Piso do intervalo depois de um erro. Padrão Anki: 1.' },
    { key: 'graduatingIntervalGood', label: '📐 [Clássico] Intervalo ao formar com "Bom" (dias)', type: 'number', value: cfg.graduatingIntervalGood != null ? cfg.graduatingIntervalGood : 1, min: 1, max: 999,
      hint: 'Quando o card sai do aprendizado. Padrão Anki: 1.' },
    { key: 'graduatingIntervalEasy', label: '📐 [Clássico] Intervalo ao formar com "Fácil" (dias)', type: 'number', value: cfg.graduatingIntervalEasy != null ? cfg.graduatingIntervalEasy : 4, min: 1, max: 999,
      hint: 'Padrão Anki: 4.' }
  );

  // No Anki, new/review per day pertencem ao preset; o interruptor que
  // permite novos ignorarem o teto de revisões é global.
  fields.push({ key: 'newPerDay', label: '🆕 Máx. de cards NOVOS por dia', type: 'number', value: cfg.newPerDay, min: 0, max: 999999, hint: 'Padrão Anki: 20. Faz parte do preset.' });
  fields.push({ key: 'revPerDay', label: '🔄 Máx. de REVISÕES por dia', type: 'number', value: cfg.revPerDay, min: 0, max: 999999, hint: 'Padrão Anki: 200. Faz parte do preset.' });
  if (!isDeck) {
    fields.push({ key: 'newCardsIgnoreReviewLimit', label: '🆕 Novos ignoram o limite de revisões', type: 'select',
      value: g.newCardsIgnoreReviewLimit ? '1' : '0',
      options: [{ value: '0', label: 'Não (padrão Anki)' }, { value: '1', label: 'Sim' }],
      hint: 'Global, como no Anki. Desligado: ao esgotar o limite de revisões, nenhum novo entra. Ligado: novos continuam até o próprio limite diário.' });
    fields.push({ key: 'applyAllParentLimits', label: '🗂 Limites começam do topo', type: 'select',
      value: g.applyAllParentLimits ? '1' : '0',
      options: [{ value:'0', label:'Não (padrão Anki)' }, { value:'1', label:'Sim' }],
      hint: 'Se ligado, ao estudar diretamente um subbaralho também se aplicam os limites dos baralhos-pai acima dele.' });
  }
  const title = isDeck ? ('⚙ Baralho: ' + deckName) : '⚙ Configuração Global';
  UI.prompt(fields, { title, okText: 'Salvar', sub: isDeck ? (hasPreset ? 'Este baralho usa um preset próprio.' : 'Salvar aqui cria um preset só para este baralho.') : '' }).then(async v => {
    if (!v) return;
    const parseSteps = (s, def) => {
      const raw=String(s==null?'':s).trim();
      if(!raw)return []; // vazio é configuração válida no Anki/FSRS
      const a=raw.split(/[\s,]+/).map(x=>parseFloat(x)).filter(x=>Number.isFinite(x)&&x>0);
      return a.length?a:def;
    };
    const ret = Math.min(0.99, Math.max(0.70, (parseFloat(v.retention) || 90) / 100));
    const patch = {
      retention: ret,
      learnSteps: parseSteps(v.learn, [1, 10]), relearnSteps: parseSteps(v.relearn, [10]),
      maxInterval: Math.min(36500, Math.max(1, parseInt(v.maxInterval, 10) || 36500)),
      leechThreshold: Math.max(0, Math.min(99, parseInt(v.leechThreshold, 10) != null && !isNaN(parseInt(v.leechThreshold, 10)) ? parseInt(v.leechThreshold, 10) : 8)),
      leechAction: v.leechAction === 'suspend' ? 'suspend' : 'tag',
      buryNew: v.buryNew === '1', buryReviews: v.buryReviews === '1', buryInterdayLearning: v.buryInterdayLearning === '1',
      showTimer: v.showTimer === '1',
      capAnswerTimeToSecs: Math.max(0,Math.min(86400,parseInt(v.capAnswerTimeToSecs,10)||0)),
      stopTimerOnAnswer: v.stopTimerOnAnswer === '1', disableAutoplay: v.disableAutoplay === '1',
      secondsToShowQuestion: Math.max(0,Math.min(86400,Number(v.secondsToShowQuestion)||0)),
      secondsToShowAnswer: Math.max(0,Math.min(86400,Number(v.secondsToShowAnswer)||0)),
      questionAction: Math.max(0,Math.min(1,Math.round(Number(v.questionAction)||0))),
      answerAction: Math.max(0,Math.min(4,Math.round(Number(v.answerAction)||0))),
      waitForAudio: v.waitForAudio !== '0',
      skipQuestionWhenReplayingAnswer: v.skipQuestionWhenReplayingAnswer === '1',
      newPerDay: Math.max(0, parseInt(v.newPerDay, 10) || 0),
      revPerDay: Math.max(0, parseInt(v.revPerDay, 10) || 0),
      /* Novas opções de ordenação/mistura. Cada valor é validado contra a lista
         permitida: um select adulterado não pode injetar uma chave que depois
         quebraria a montagem da fila. */
      reviewOrder: ['retrievabilityAsc','retrievabilityDesc','relativeOverdueness','day','dayThenDeck','deckThenDay',
                    'intervalsAsc','intervalsDesc','easeAsc','easeDesc','added','reverseAdded','random']
                   .includes(v.reviewOrder) ? v.reviewOrder : 'day',
      newGatherOrder: ['deck','deckRandomNotes','posicao','posicaoDesc','randomNotes','randomCards']
                   .includes(v.newGatherOrder) ? v.newGatherOrder : 'deck',
      newSortOrder: ['template','coleta','templateRandom','randomNoteTemplate','randomCard']
                   .includes(v.newSortOrder) ? v.newSortOrder : 'template',
      newInsertOrder: v.newInsertOrder === 'aleatoria' ? 'aleatoria' : 'sequencial',
      newMix: ['misturar','depois','antes'].includes(v.newMix) ? v.newMix : 'misturar',
      interdayMix: ['misturar','depois','antes'].includes(v.interdayMix) ? v.interdayMix : 'misturar',
      /* easyDays: sete inteiros de 0 a 100 (domingo→sábado) vindos como texto.
         Qualquer entrada que não produza exatamente 7 valores volta ao neutro —
         melhor ignorar do que agendar com uma semana pela metade. */
      easyDays: (function () {
        const a = String(v.easyDays || '').split(/[\s,]+/).map(x => parseFloat(x)).filter(x => isFinite(x));
        if (a.length !== 7) return [1,1,1,1,1,1,1];
        return a.map(x => x <= 0 ? 0 : (x >= 100 ? 1 : 0.5));
      })(),
      // Data no formato ISO; qualquer outra coisa é descartada.
      ignoreRevlogsBefore: /^\d{4}-\d{2}-\d{2}$/.test(String(v.ignoreRevlogsBefore || '').trim())
                   ? String(v.ignoreRevlogsBefore).trim() : '',
      historicalRetention: Math.min(0.99, Math.max(0.50, (parseFloat(v.historicalRetention) || 90) / 100)),
      paramSearch: String(v.paramSearch || '').trim().slice(0, 200),
      // Parâmetros do Clássico. Chegam em centésimos para evitar vírgula decimal
      // no campo numérico do celular, que varia de teclado para teclado.
      initialEase: Math.min(5.0, Math.max(1.3, (parseInt(v.initialEase, 10) || 250) / 100)),
      hardMultiplier: Math.min(1.3, Math.max(0.5, (parseInt(v.hardMultiplier, 10) || 120) / 100)),
      easyMultiplier: Math.min(5.0, Math.max(1.0, (parseInt(v.easyMultiplier, 10) || 130) / 100)),
      lapseMultiplier: Math.min(1.0, Math.max(0.0, (parseInt(v.lapseMultiplier, 10) || 0) / 100)),
      intervalMultiplier: Math.min(2.0, Math.max(0.5, (parseInt(v.intervalMultiplier, 10) || 100) / 100)),
      minimumLapseInterval: Math.min(99, Math.max(1, parseInt(v.minimumLapseInterval, 10) || 1)),
      graduatingIntervalGood: Math.min(999, Math.max(1, parseInt(v.graduatingIntervalGood, 10) || 1)),
      graduatingIntervalEasy: Math.min(999, Math.max(1, parseInt(v.graduatingIntervalEasy, 10) || 4))
    };
    if (!isDeck) {
      patch.algo = v.algo === 'sm2' ? 'sm2' : 'fsrs';
      patch.newCardsIgnoreReviewLimit = v.newCardsIgnoreReviewLimit === '1';
      patch.applyAllParentLimits = v.applyAllParentLimits === '1';
    }
    const desiredCfg = Object.assign({}, cfg, patch);
    const effectiveAlgo = isDeck ? g.algo : desiredCfg.algo;
    const shouldReschedule = v.fsrsReschedule === '1' && effectiveAlgo === 'fsrs';
    if (!window.CardsOfficialBridge || typeof CardsOfficialBridge.updateDeckOptions !== 'function') {
      showToast('Deck Options não salvas: backend oficial do Anki indisponível.');
      return;
    }
    try {
      await CardsOfficialBridge.updateDeckOptions(deckId, desiredCfg, {
        hadPreset: !!hasPreset,
        fsrsReschedule: shouldReschedule,
        deckName: deckName || 'Default'
      });
    } catch (e) {
      showToast('Deck Options não salvas pelo Anki oficial: ' + (e && e.message ? e.message : String(e)));
      return;
    }
    if (isDeck) showToast('Preset do baralho "' + deckName + '" salvo pelo Anki oficial ✓');
    else showToast('Configuração global salva pelo Anki oficial ✓');
    if (shouldReschedule) showToast('🔄 Reagendamento FSRS concluído pelo scheduler oficial do Anki ✓');
    if (CardsScreen.tab === 'revisar') {
      CardsScreen.invalidateReviewQueue();
      CardsScreen.renderContent();
    } else if (CardsScreen.tab === 'stats') CardsScreen.renderContent();
  });

  // O Anki expõe a otimização no próprio Deck Options. O botão abaixo chama
  // compute_fsrs_params no backend oficial e salva os parâmetros no preset oficial.
  if (g.algo === 'fsrs') setTimeout(() => {
    const foot = document.querySelector('#ui-modal .cards-modal-foot');
    if (!foot || document.getElementById('cards-optimize-fsrs-btn')) return;
    const b = document.createElement('button');
    b.id = 'cards-optimize-fsrs-btn'; b.type = 'button'; b.className = 'btn-secondary';
    b.title = 'Treina os 21 parâmetros com o fsrs-rs 6.6.2 oficial, respeitando o histórico ignorado e o filtro de treino.';
    b.textContent = '🧠 Otimizar FSRS';
    b.addEventListener('click', async () => {
      const old = b.textContent; b.disabled = true; b.textContent = '⏳ Otimizando…';
      try {
        const out = await CardsScreen.optimizeFsrsOfficial(deckId);
        showToast(out.alreadyOptimal
          ? 'FSRS: parâmetros já estão ótimos para ' + out.fsrsItems.toLocaleString('pt-BR') + ' item(ns) ✓'
          : 'FSRS otimizado pelo Anki oficial com ' + out.fsrsItems.toLocaleString('pt-BR') + ' item(ns) ✓');
        UI._submit(false);
        setTimeout(() => void CardsScreen.openAlgoConfigFor(deckId), 0);
      } catch (e) {
        b.disabled = false; b.textContent = old;
        showToast('Não foi possível otimizar FSRS: ' + (e && e.message ? e.message : String(e)));
      }
    });
    foot.insertBefore(b, foot.firstChild);
    const health=document.createElement('button');health.id='cards-fsrs-health-btn';health.type='button';health.className='btn-secondary';health.textContent='🩺 Health Check';
    health.addEventListener('click',async()=>{const old=health.textContent;health.disabled=true;health.textContent='⏳ Avaliando…';try{const h=await CardsScreen.fsrsHealthCheck(deckId);if(h.passed==null)showToast('Health Check oficial: resultado indisponível ('+h.fsrsItems+' itens)');else showToast((h.passed?'✅':'⚠')+' Health Check oficial '+(h.passed?'aprovado':'requer atenção')+' · '+h.fsrsItems.toLocaleString('pt-BR')+' item(ns)');}catch(e){showToast('Health Check falhou: '+(e&&e.message?e.message:String(e)));}finally{health.disabled=false;health.textContent=old;}});
    foot.insertBefore(health,b.nextSibling);
    const decide=document.createElement('button');decide.id='cards-fsrs-help-decide-btn';decide.type='button';decide.className='btn-secondary';decide.textContent='🤔 Help Me Decide';
    decide.addEventListener('click',()=>{try{UI._submit(false);}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-tela-cards'); };setTimeout(()=>{if(typeof AnkiMaxStatsMedia!=='undefined'&&AnkiMaxStatsMedia.openSimulator){AnkiMaxStatsMedia.openSimulator();const x=document.getElementById('anki-sim-help');if(x)x.click();}else showToast('Simulador FSRS indisponível');},0);});
    foot.insertBefore(decide,health.nextSibling);
    if(!isDeck){
      const all=document.createElement('button');all.id='cards-optimize-all-fsrs-btn';all.type='button';all.className='btn-secondary';all.textContent='🧠 Otimizar todos os presets';
      all.addEventListener('click',async()=>{const old=all.textContent;all.disabled=true;all.textContent='⏳ Otimizando presets…';try{const rs=await CardsScreen.optimizeAllFsrsPresets(),ok=rs.filter(x=>x.ok).length,fail=rs.length-ok,optimal=rs.filter(x=>x.ok&&x.alreadyOptimal).length;showToast('FSRS oficial: '+ok+' preset(s) processado(s)'+(optimal?' · '+optimal+' já ótimo(s)':'')+(fail?' · '+fail+' com erro':'')+' ✓');}catch(e){showToast('Falha ao otimizar presets: '+(e&&e.message?e.message:String(e)));}finally{all.disabled=false;all.textContent=old;}});
      foot.insertBefore(all,health.nextSibling);
    }
  }, 60);

  // botão extra "restaurar herança" quando o baralho tem preset
  if (isDeck && hasPreset) setTimeout(() => {
    const foot = document.querySelector('#ui-modal .cards-modal-foot');
    if (!foot || document.getElementById('deck-inherit-btn')) return;
    const b = document.createElement('button'); b.id = 'deck-inherit-btn'; b.type = 'button'; b.className = 'btn-secondary'; b.style.marginRight = 'auto'; b.textContent = '↩ Voltar a herdar o global';
    b.addEventListener('click', async () => {
      if (!window.CardsOfficialBridge || typeof CardsOfficialBridge.inheritDeckOptions !== 'function') {
        showToast('Preset não alterado: backend oficial do Anki indisponível.'); return;
      }
      const oldText=b.textContent;b.disabled=true;b.textContent='⏳ Aplicando…';
      try {
        await CardsOfficialBridge.inheritDeckOptions(deckId);
        UI._submit(false);
        showToast('Baralho "' + deckName + '" voltou a herdar o global pelo Anki oficial ✓');
      } catch (e) {
        b.disabled=false;b.textContent=oldText;
        showToast('Não foi possível restaurar a herança oficial: ' + (e && e.message ? e.message : String(e)));
      }
    });
    foot.insertBefore(b, foot.firstChild);
  }, 60);
};