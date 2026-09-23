/* ============================================================================
   ESCOPO GLOBAL DO PERFIL
   ----------------------------------------------------------------------------
   Planejamento = estratégia. Histórico/conhecimento = memória do perfil.

   A persistência antiga continua intacta e plan-scoped para não fazer migração
   destrutiva. Esta camada agrega os dados do perfil e conserva _planId/_planNome
   para rotear qualquer mutação ao planejamento de origem.

   Primeiro uso real: Cards de Revisão (coleção global + filtro por banca).
   Histórico/Evolução já possuem "Este planejamento / Todos os planejamentos".
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__studyGlobalScopeV1) return;
  if (typeof DB === 'undefined' || typeof PlanManager === 'undefined') return;
  window.__studyGlobalScopeV1 = true;

  const norm = (s) => String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\s+/g, ' ').trim();
  const clone = (x) => {
    try { return JSON.parse(JSON.stringify(x)); } catch (_) { return Object.assign({}, x); }
  };

  const S = {
    KEY: 'study-global-scope-v1',
    BANKS_KEY: 'cards-bancas-global-v1',
    ANKI_KEY: 'anki-bank-filter-v1',
    defaults: Object.freeze({ cardsScope: 'all', cardsBancas: [] }),

    _key() { return DB._profilePrefix() + this.KEY; },
    _banksKey() { return DB._profilePrefix() + this.BANKS_KEY; },
    _ankiKey() { return DB._profilePrefix() + this.ANKI_KEY; },
    activePlanId() { return PlanManager.getActivePlanId() || DB._activePlanId(); },
    plans() {
      const list = PlanManager.getPlans() || [];
      const active = this.activePlanId();
      if (list.some(p => String(p.id) === String(active))) return list;
      return active ? [{ id: active, nome: 'Planejamento atual' }].concat(list) : list;
    },
    operationalPlans() {
      const list = this.plans();
      return list.filter(p => !(PlanManager.isPaused && PlanManager.isPaused(p.id)));
    },
    planName(id) {
      const p = this.plans().find(x => String(x.id) === String(id));
      return p ? (p.nome || p.name || String(id)) : String(id || '');
    },
    prefs() {
      let p = null;
      try { p = JSON.parse(localStorage.getItem(this._key()) || 'null'); } catch (_) {}
      p = Object.assign({}, this.defaults, p && typeof p === 'object' ? p : {});
      p.cardsScope = p.cardsScope === 'plan' ? 'plan' : 'all';
      if (!Array.isArray(p.cardsBancas)) p.cardsBancas = [];
      p.cardsBancas = [...new Set(p.cardsBancas.map(x => String(x || '').trim()).filter(Boolean))];
      return p;
    },
    save(patch) {
      const next = Object.assign({}, this.prefs(), patch || {});
      if (next.cardsScope !== 'plan' && next.cardsScope !== 'all') next.cardsScope = 'all';
      if (!Array.isArray(next.cardsBancas)) next.cardsBancas = [];
      next.cardsBancas = [...new Set(next.cardsBancas.map(x => String(x || '').trim()).filter(Boolean))];
      DB.setRaw(this._key(), JSON.stringify(next));
      return next;
    },
    cardsScope() { return this.prefs().cardsScope; },
    setCardsScope(v) { return this.save({ cardsScope: v === 'plan' ? 'plan' : 'all' }); },
    selectedBanks() { return this.prefs().cardsBancas; },
    setSelectedBanks(v) { return this.save({ cardsBancas: Array.isArray(v) ? v : [] }); },

    _rows(planId, suffix) {
      const k = DB.keysForPlan(planId);
      return DB._get(k[suffix], []);
    },
    _tag(planId, rows) {
      const nome = this.planName(planId);
      return (Array.isArray(rows) ? rows : []).map(x => Object.assign({}, x, {
        _planId: planId, _planNome: nome
      }));
    },
    allBy(suffix) {
      const out = [];
      this.plans().forEach(p => out.push(...this._tag(p.id, this._rows(p.id, suffix))));
      return out;
    },
    operationalAllBy(suffix) {
      const out = [];
      this.operationalPlans().forEach(p => out.push(...this._tag(p.id, this._rows(p.id, suffix))));
      return out;
    },
    forScope(suffix, scope) {
      const sc = scope || this.cardsScope();
      return sc === 'all' ? this.allBy(suffix) : this._tag(this.activePlanId(), this._rows(this.activePlanId(), suffix));
    },
    cards(scope) {
      const rows = this.forScope('cards', scope);
      const seen = new Set();
      return rows.filter(c => {
        const k = String(c && c.id);
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });
    },
    decks(scope) {
      const rows = this.forScope('decks', scope);
      const seen = new Set();
      return rows.filter(d => {
        const k = String(d && d.id);
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });
    },
    extras(scope) {
      const sc = scope || this.cardsScope();
      return sc === 'all' ? this.operationalAllBy('extras') : this.forScope('extras', sc);
    },
    laws(scope) { return this.forScope('leis', scope); },
    links(scope) { return this.forScope('links', scope); },
    tec(scope) {
      const sc = scope || this.cardsScope();
      return sc === 'all' ? this.operationalAllBy('tec') : this.forScope('tec', sc);
    },
    incidence(scope) {
      const sc = scope || this.cardsScope();
      return sc === 'all' ? this.operationalAllBy('incidencia') : this.forScope('incidencia', sc);
    },

    findRecord(suffix, id) {
      const active = this.activePlanId();
      const ids = [active].concat(this.plans().map(p => p.id).filter(x => String(x) !== String(active)));
      for (const pid of ids) {
        const list = this._rows(pid, suffix);
        const idx = list.findIndex(x => String(x && x.id) === String(id));
        if (idx >= 0) return { planId: pid, list, index: idx, row: list[idx] };
      }
      return null;
    },
    findCardRecord(id) {
      const active = this.activePlanId();
      const ids = [active].concat(this.plans().map(p => p.id).filter(x => String(x) !== String(active)));
      for (const pid of ids) {
        const list = this._rows(pid, 'cards');
        const idx = list.findIndex(c => String(c.id) === String(id));
        if (idx >= 0) return { planId: pid, list, index: idx, card: list[idx] };
      }
      return null;
    },
    sourcePlanForCard(id) {
      const r = this.findCardRecord(id);
      return r ? r.planId : null;
    },
    cardPosition(id) {
      const r = this.findCardRecord(id);
      return r ? r.index + 1 : 1;
    },
    deckRecord(id) {
      for (const p of this.plans()) {
        const list = this._rows(p.id, 'decks');
        const d = list.find(x => String(x.id) === String(id));
        if (d) return { planId: p.id, deck: d };
      }
      return null;
    },
    deckForCard(card) {
      if (!card || !card.deckId) return null;
      const pid = card._planId || this.sourcePlanForCard(card.id);
      if (pid) {
        const d = this._rows(pid, 'decks').find(x => String(x.id) === String(card.deckId));
        if (d) return Object.assign({}, d, { _planId: pid, _planNome: this.planName(pid) });
      }
      const any = this.deckRecord(card.deckId);
      return any ? Object.assign({}, any.deck, { _planId: any.planId, _planNome: this.planName(any.planId) }) : null;
    },

    planIdsForScope(scope) {
      const sc = scope || this.cardsScope(), active = this.activePlanId();
      if (sc !== 'all') return active ? [active] : [];
      return this.plans().map(p => p.id).filter((id, i, a) => id && a.findIndex(x => String(x) === String(id)) === i);
    },
    entityKeyForPlan(planId, kind, id) {
      return DB._profilePrefix() + 'p:' + String(planId) + ':cards-' + String(kind) + ':' + String(id == null ? '' : id);
    },
    _entityRows(planId, kind) {
      const prefix = this.entityKeyForPlan(planId, kind, ''), out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i); if (!k || !String(k).startsWith(prefix)) continue;
          try {
            const v = JSON.parse(localStorage.getItem(k) || 'null');
            if (v && typeof v === 'object') out.push(Object.assign({}, v, { _planId: planId, _planNome: this.planName(planId) }));
          } catch (_) {}
        }
      } catch (_) {}
      return out;
    },
    ankiEntities(kind, scope) {
      const out = [];
      this.planIdsForScope(scope).forEach(pid => out.push(...this._entityRows(pid, kind)));
      const seen = new Set();
      return out.filter(x => {
        const k = String(x._planId) + '|' + String(x.id);
        if (seen.has(k)) return false; seen.add(k); return true;
      });
    },
    ankiEntity(kind, id, planId) {
      const ids = planId != null ? [planId] : [this.activePlanId()].concat(this.plans().map(p => p.id));
      const seen = new Set();
      for (const pid of ids) {
        if (!pid || seen.has(String(pid))) continue; seen.add(String(pid));
        const row = this._entityRows(pid, kind).find(x => String(x.id) === String(id) || String(x.ankiId) === String(id));
        if (row) return row;
      }
      return null;
    },
    ankiEntityEntries(planId) {
      const prefix = DB._profilePrefix() + 'p:' + String(planId) + ':cards-', rows = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i); if (k && String(k).startsWith(prefix)) rows.push([k, localStorage.getItem(k)]);
        }
      } catch (_) {}
      return rows;
    },

    bankCatalog() {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(this._banksKey()) || 'null'); } catch (_) {}
      const hadSaved = Array.isArray(saved);
      const all = hadSaved ? saved.slice() : [];
      (DB.DEFAULT_BANCAS_CARDS || []).forEach(x => all.push(x));
      this.plans().forEach(p => {
        // A lista antiga de cada planejamento é usada só na primeira migração.
        // Depois disso o catálogo global manda; bancas novas continuam entrando
        // automaticamente quando algum card efetivamente as usa.
        if (!hadSaved) this._rows(p.id, 'bancasCards').forEach(x => all.push(x));
        this._rows(p.id, 'cards').forEach(c => { if (c && c.banca) all.push(c.banca); });
      });
      const clean = [...new Set(all.map(x => String(x || '').trim()).filter(Boolean))]
        .sort((a,b)=>a.localeCompare(b,'pt-BR'));
      if (!hadSaved || JSON.stringify(saved) !== JSON.stringify(clean))
        DB.setRaw(this._banksKey(), JSON.stringify(clean));
      return clean;
    },
    saveBankCatalog(list) {
      const clean = [...new Set((list || []).map(x => String(x || '').trim()).filter(Boolean))]
        .sort((a,b)=>a.localeCompare(b,'pt-BR'));
      DB.setRaw(this._banksKey(), JSON.stringify(clean));
      return clean;
    },
    filterCardsByBanca(cards) {
      const banks = this.selectedBanks();
      if (!banks.length) return cards || [];
      const set = new Set(banks.map(norm));
      return (cards || []).filter(c => set.has(norm(c && c.banca)));
    },

    _revlogForPlan(planId) {
      const keys = DB.keysForPlan(planId), k = keys.revlog;
      if (DB._revlogMem && DB._revlogMem.has(k)) return DB._revlogMem.get(k);
      const base = DB._get(k, []);
      const fora = [];
      const n = Math.max(0, Number(DB._get(keys.revlogArquivo, 0)) || 0);
      for (let i = 0; i < n; i++) {
        const lote = DB._get(k + '-arquivo:' + i, []);
        if (Array.isArray(lote)) fora.push(...lote);
      }
      const pend = DB._get(keys.revlogPendente, []);
      if (Array.isArray(pend)) fora.push(...pend);
      const out = Array.isArray(base) ? base.slice() : [];
      const seen = new Set(out.map(r => DB._chaveRevisao(r)));
      fora.forEach(r => {
        const x = DB._normalizarReviewId(r, false), key = DB._chaveRevisao(x);
        if (!seen.has(key)) { seen.add(key); out.push(x); }
      });
      out.forEach(r => DB._normalizarReviewId(r, false));
      if (DB._revlogMem) DB._revlogMem.set(k, out);
      return out;
    },
    revlogForPlan(planId) { return this._revlogForPlan(planId); },
    revlog(scope) {
      const sc = scope || this.cardsScope();
      if (sc !== 'all') return this._revlogForPlan(this.activePlanId());
      const out = [];
      this.plans().forEach(p => this._revlogForPlan(p.id).forEach(r => out.push(Object.assign({}, r, {
        _planId: p.id, _planNome: this.planName(p.id)
      }))));
      return out;
    },
    revlogForCard(id) {
      const pid = this.sourcePlanForCard(id);
      return pid ? this._revlogForPlan(pid) : [];
    },
    _savePending(planId, row) {
      const keys = DB.keysForPlan(planId), list = DB._get(keys.revlogPendente, []);
      const pend = Array.isArray(list) ? list : [];
      if (row) pend.push(row);
      if (pend.length < (DB.LOTE_REVLOG || 50)) return DB._set(keys.revlogPendente, pend);
      const n = Math.max(0, Number(DB._get(keys.revlogArquivo, 0)) || 0);
      if (!DB._set(keys.revlog + '-arquivo:' + n, pend)) return false;
      if (!DB._set(keys.revlogArquivo, n + 1)) return false;
      return DB._set(keys.revlogPendente, []);
    },
    confirmReview(planId, reviewId) {
      const alvo = String(reviewId || ''); if (!alvo) return false;
      const keys = DB.keysForPlan(planId);
      let changed = false;
      const filt = arr => (Array.isArray(arr) ? arr : []).filter(r => {
        DB._normalizarReviewId(r, false);
        if (String(r.reviewId || '') === alvo) { changed = true; return false; }
        return true;
      });
      const pend = filt(DB._get(keys.revlogPendente, []));
      if (changed) DB._set(keys.revlogPendente, pend);
      const n = Math.max(0, Number(DB._get(keys.revlogArquivo, 0)) || 0);
      for (let i = 0; i < n; i++) {
        const kk = keys.revlog + '-arquivo:' + i, before = DB._get(kk, []), after = filt(before);
        if (after.length !== (Array.isArray(before) ? before.length : 0)) DB._set(kk, after);
      }
      return changed;
    },
    replaceRevlogPlan(planId, list) {
      const keys = DB.keysForPlan(planId), k = keys.revlog, v = Array.isArray(list) ? list : [];
      v.forEach(r => DB._normalizarReviewId(r, false));
      if (DB._revlogMem) DB._revlogMem.set(k, v);
      try {
        if (DB._bancoRelacionalPronto && DB._bancoRelacionalPronto() && window.RelationalStore && RelationalStore.queueRevlogReplace)
          RelationalStore.queueRevlogReplace(k, v);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'global-revlog-replace'); }
      const n = Math.max(0, Number(DB._get(keys.revlogArquivo, 0)) || 0);
      for (let i = 0; i < n; i++) DB.delRaw(k + '-arquivo:' + i);
      DB._set(keys.revlogArquivo, 0); DB._set(keys.revlogPendente, []);
      return DB._set(k, v);
    },
    removeRevlogPlan(planId, ts) {
      const l = this._revlogForPlan(planId);
      let idx = -1;
      for (let i = l.length - 1; i >= 0; i--) if (l[i].ts === ts) { idx = i; break; }
      if (idx < 0) return true;
      const row = l[idx]; DB._normalizarReviewId(row, false); l.splice(idx, 1);
      const key = DB.keysForPlan(planId).revlog;
      try {
        const ctx = DB._reviewContext(key);
        ReviewJournal.put({
          id: row.reviewId + ':delete', reviewId: row.reviewId, type: 'delete',
          key, profileId: ctx.profileId, planId: ctx.planId,
          row: clone(row), createdAt: Date.now()
        }).catch(e => { if (typeof _quiet === 'function') _quiet(e, 'global-review-journal-delete'); });
      } catch (_) {}
      try {
        if (DB._bancoRelacionalPronto && DB._bancoRelacionalPronto() && window.RelationalStore && RelationalStore.queueRevlogDelete)
          RelationalStore.queueRevlogDelete(key, row);
      } catch (_) {}
      const keys = DB.keysForPlan(planId), pend = DB._get(keys.revlogPendente, []);
      const target = DB._chaveRevisao(row), arr = Array.isArray(pend) ? pend : [];
      const pi = arr.map(r => DB._chaveRevisao(r)).lastIndexOf(target);
      if (pi >= 0) { arr.splice(pi, 1); return DB._set(keys.revlogPendente, arr); }
      return this.replaceRevlogPlan(planId, l);
    },

    deleteCards(ids) {
      const set = ids instanceof Set ? ids : new Set(ids || []);
      const notes = new Set();
      set.forEach(id => {
        const r = this.findCardRecord(id); if (!r) return;
        const nk = String(r.planId) + '|' + String(r.card.noteId || r.card.id);
        if (notes.has(nk)) return; notes.add(nk);
        DB.deleteNoteByCard(id);
      });
    },
    moveCards(ids, deckId) {
      const set = ids instanceof Set ? ids : new Set(ids || []);
      const target = deckId ? this.deckRecord(deckId) : null;
      let moved = 0, skipped = 0;
      set.forEach(id => {
        const r = this.findCardRecord(id); if (!r) return;
        if (target && String(target.planId) !== String(r.planId)) { skipped++; return; }
        if (DB.updateCard(id, { deckId: deckId || null }) !== false) moved++;
      });
      if (skipped && typeof showToast === 'function')
        showToast(moved + ' card(s) movido(s); ' + skipped + ' mantido(s) porque o baralho pertence a outro planejamento.');
      return { moved, skipped };
    },

    zeroCardsProgress(scope) {
      const pids=this.planIdsForScope(scope),targetIds=new Set(),out={cards:0,revlog:0};
      pids.forEach(pid=>{
        const cards=this._rows(pid,'cards'),rows=this._revlogForPlan(pid);out.cards+=cards.length;out.revlog+=rows.length;
        cards.forEach(c=>{
          targetIds.add(String(c.id));c.phase='new';c.learnStep=0;c.due=todayCards();c.dueTs=null;
          c.intervalo=0;c.reps=0;c.lapses=0;c.ease=2.5;c.s=null;c.d=null;c.lastReview=null;
          c.status='pendente';c.leech=false;c.suspenso=false;c.enterradoAte=null;c.buryKind=null;c.updatedAt=new Date().toISOString();
        });
        DB._set(DB.keysForPlan(pid).cards,cards);this.replaceRevlogPlan(pid,[]);
      });
      try {
        const d=CardsConfig._daily();
        if((scope||this.cardsScope())==='all'){d.newIds=[];d.revIds=[];d.usage=[];}
        else{
          d.newIds=(d.newIds||[]).filter(id=>!targetIds.has(String(id)));
          d.revIds=(d.revIds||[]).filter(id=>!targetIds.has(String(id)));
          d.usage=(d.usage||[]).filter(x=>!targetIds.has(String(x&&x.id)));
        }
        CardsConfig._saveDaily(d);
      } catch (_) {}
      return out;
    },
    cleanOrphanRevlog(scope) {
      let removed=0;
      this.planIdsForScope(scope).forEach(pid=>{
        const ids=new Set(this._rows(pid,'cards').map(c=>String(c.id)));
        const before=this._revlogForPlan(pid),after=before.filter(r=>ids.has(String(r.cardId)));
        removed+=before.length-after.length;if(after.length!==before.length)this.replaceRevlogPlan(pid,after);
      });
      return removed;
    },

    _ankiState() {
      try { return Object.assign({ filteredDeckId: null, previousDeckId: null }, JSON.parse(localStorage.getItem(this._ankiKey()) || '{}')); }
      catch (_) { return { filteredDeckId: null, previousDeckId: null }; }
    },
    _saveAnkiState(v) { DB.setRaw(this._ankiKey(), JSON.stringify(v || {})); },
    _ankiTag(b) { return String(b || '').trim().replace(/\s+/g, '_').replace(/"/g, ''); },
    async applyAnkiBankFilter(refresh) {
      if (!window.AnkiOfficial || !AnkiOfficial.request || !AnkiOfficial.token || !AnkiOfficial.token()) return false;
      const banks = this.selectedBanks();
      const st = this._ankiState();
      const decks = await AnkiOfficial.request('/api/anki/decks');
      const current = Number(decks.current_deck_id || 0);
      if (!banks.length) {
        if (st.filteredDeckId) {
          try { await AnkiOfficial.request('/api/anki/filtered-deck/' + Number(st.filteredDeckId) + '/empty', { method: 'POST' }); } catch (_) {}
          const back = Number(st.previousDeckId || 0);
          if (back && back !== Number(st.filteredDeckId)) {
            try {
              await AnkiOfficial.request('/api/anki/decks/select', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deck_id: back })
              });
            } catch (_) {}
          }
        }
        this._saveAnkiState({ filteredDeckId: st.filteredDeckId || null, previousDeckId: null });
        if (refresh && AnkiOfficial.view === 'review') await AnkiOfficial.renderReviewer();
        return true;
      }

      const fdId = Number(st.filteredDeckId || 0);
      const data = await AnkiOfficial.request('/api/anki/filtered-deck/' + fdId);
      const deck = data.deck || {}, cfg = deck.config || {};
      const query = '(' + ['is:due','is:new','is:learn'].join(' OR ') + ') (' +
        banks.map(b => 'tag:"' + this._ankiTag(b) + '"').join(' OR ') + ')';
      const payload = {
        id: Number(deck.id || fdId || 0),
        name: 'Study · Bancas',
        config: Object.assign({}, cfg, {
          reschedule: true,
          search_terms: [{ search: query, limit: 999999, order: 0 }]
        }),
        allow_empty: true
      };
      const saved = await AnkiOfficial.request('/api/anki/filtered-deck/' + Number(deck.id || fdId || 0), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const did = Number(saved.deck_id || deck.id || 0);
      await AnkiOfficial.request('/api/anki/filtered-deck/' + did + '/rebuild', { method: 'POST' });
      await AnkiOfficial.request('/api/anki/decks/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deck_id: did })
      });
      this._saveAnkiState({
        filteredDeckId: did,
        previousDeckId: (current && current !== did) ? current : (st.previousDeckId || null)
      });
      if (refresh && AnkiOfficial.view === 'review') await AnkiOfficial.renderReviewer();
      return true;
    },

    refreshCards() {
      try {
        if (!window.CardsScreen) return;
        CardsScreen.invalidateReviewQueue();
        CardsScreen.populateFilterOptions();
        CardsScreen.renderContent();
        CardsScreen.updateFavCount();
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'global-cards-refresh'); }
    },
    bankLabel() {
      const s = this.selectedBanks();
      if (!s.length) return 'Todas as bancas';
      if (s.length === 1) return s[0];
      return s.length + ' bancas selecionadas';
    },
    renderBankPicker(host, opts) {
      if (!host) return;
      const catalog = this.bankCatalog(), selected = new Set(this.selectedBanks().map(norm));
      host.innerHTML = '<button type="button" class="banca-pick-btn global-bank-btn" aria-expanded="false"><span>🏛️ ' +
        escapeHtml(this.bankLabel()) + '</span><span class="chev">▾</span></button>' +
        '<div class="banca-pick-panel global-bank-panel" hidden>' +
          '<button type="button" class="banca-pick-all ' + (!selected.size ? 'is-active' : '') + '" data-global-bank-all>' +
            '<span class="banca-pick-all-mark">✓</span><span><b>Todas as bancas</b><small>Não restringir a revisão</small></span></button>' +
          '<label class="global-bank-search"><span>⌕</span><input type="search" placeholder="Buscar banca" autocomplete="off"></label>' +
          '<div class="global-bank-list">' + catalog.map(b => '<label class="global-bank-item" data-bank-n="' + escapeHtml(norm(b)) + '">' +
            '<input type="checkbox" value="' + escapeHtml(b) + '" ' + (selected.has(norm(b)) ? 'checked' : '') + '><span>' + escapeHtml(b) + '</span></label>').join('') + '</div>' +
          '<p class="hint global-bank-hint">Vazio = todas. A seleção vale para Cards e Anki Oficial.</p>' +
        '</div>';
      const btn = host.querySelector('.global-bank-btn'), panel = host.querySelector('.global-bank-panel');
      const search = host.querySelector('.global-bank-search input');
      const close = () => { panel.setAttribute('hidden',''); btn.setAttribute('aria-expanded','false'); };
      btn.onclick = e => {
        e.stopPropagation();
        const open = panel.hasAttribute('hidden');
        document.querySelectorAll('.global-bank-panel').forEach(x => x.setAttribute('hidden',''));
        if (open) { panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded','true'); if (search) setTimeout(()=>search.focus(),20); }
        else close();
      };
      panel.onclick = e => e.stopPropagation();
      if (search) search.oninput = () => {
        const q = norm(search.value);
        host.querySelectorAll('.global-bank-item').forEach(x => x.style.display = !q || (x.dataset.bankN || '').includes(q) ? '' : 'none');
      };
      const apply = () => {
        const vals = [...host.querySelectorAll('.global-bank-item input:checked')].map(x => x.value);
        this.setSelectedBanks(vals);
        document.querySelectorAll('[data-global-bank-host]').forEach(h => this.renderBankPicker(h, { anki: h.dataset.globalBankHost === 'anki' }));
        this.refreshCards();
        if (document.getElementById('screen-anki') && document.getElementById('screen-anki').classList.contains('active')) {
          this.applyAnkiBankFilter(true).catch(e => {
            if (window.AnkiOfficial && AnkiOfficial.alert) AnkiOfficial.alert('Filtro de banca: ' + (e.message || e), 'error');
          });
        }
      };
      host.querySelectorAll('.global-bank-item input').forEach(x => x.onchange = apply);
      const all = host.querySelector('[data-global-bank-all]');
      if (all) all.onclick = () => { host.querySelectorAll('.global-bank-item input').forEach(x => x.checked = false); apply(); };
    },

    installCardsUi() {
      const body = document.getElementById('cards-filter-body');
      if (!body || document.getElementById('cards-global-scope-row')) return;
      const row = document.createElement('div');
      row.id = 'cards-global-scope-row';
      row.className = 'global-scope-row';
      row.innerHTML = '<div class="field global-scope-field"><label>Escopo dos cards</label>' +
        '<div class="scope-toggle" id="cards-scope-toggle">' +
          '<button type="button" data-scope="plan">Este planejamento</button>' +
          '<button type="button" data-scope="all">Todos os planejamentos</button>' +
        '</div></div>' +
        '<div class="field global-scope-field"><label>Banca da revisão</label><div class="global-bank-host" data-global-bank-host="cards"></div></div>';
      const fg = body.querySelector('.field-group');
      if (fg) body.insertBefore(row, fg); else body.prepend(row);
      const sync = () => row.querySelectorAll('#cards-scope-toggle [data-scope]').forEach(b =>
        b.classList.toggle('active', b.dataset.scope === this.cardsScope()));
      row.querySelectorAll('#cards-scope-toggle [data-scope]').forEach(b => b.onclick = () => {
        this.setCardsScope(b.dataset.scope); sync(); this.refreshCards();
      });
      sync();
      this.renderBankPicker(row.querySelector('[data-global-bank-host="cards"]'));
    },

    installAnkiUi() {
      const root = document.getElementById('anki-official-alert');
      const screen = document.getElementById('screen-anki');
      if (!root || !screen || document.getElementById('anki-global-bank-card')) return;
      const card = document.createElement('div');
      card.id = 'anki-global-bank-card';
      card.className = 'card anki-global-bank-card';
      card.innerHTML = '<div class="global-anki-bank-row"><div><b>🏛️ Bancas na revisão</b><span>O filtro usa as tags de banca da coleção e mantém o scheduler oficial.</span></div>' +
        '<div class="global-bank-host" data-global-bank-host="anki"></div></div>';
      screen.insertBefore(card, root);
      this.renderBankPicker(card.querySelector('[data-global-bank-host="anki"]'), { anki: true });
    },

    installStyle() {
      if (document.getElementById('study-global-scope-style')) return;
      const st = document.createElement('style'); st.id = 'study-global-scope-style';
      st.textContent = [
        '.global-scope-row{display:grid;grid-template-columns:minmax(260px,1fr) minmax(260px,1fr);gap:14px;margin:10px 0 14px}',
        '.global-scope-field{margin:0}.global-bank-host{position:relative}',
        '.global-bank-panel{min-width:min(360px,88vw);max-height:360px;overflow:auto;z-index:80}',
        '.global-bank-search{display:flex;align-items:center;gap:7px;padding:7px 8px;position:sticky;top:0;background:var(--surface);z-index:2}',
        '.global-bank-search input{width:100%}.global-bank-list{display:grid;gap:2px;padding:4px 6px 8px}',
        '.global-bank-item{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;cursor:pointer}',
        '.global-bank-item:hover{background:var(--surface-2)}.global-bank-item input{accent-color:var(--accent)}',
        '.global-bank-hint{padding:6px 10px 10px;margin:0}',
        '.anki-global-bank-card{margin-bottom:14px}.global-anki-bank-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 16px}',
        '.global-anki-bank-row>div:first-child{display:flex;flex-direction:column;gap:2px}.global-anki-bank-row span{font-size:12px;color:var(--text-faint)}',
        '@media(max-width:680px){.global-scope-row{grid-template-columns:1fr}.global-anki-bank-row{align-items:stretch;flex-direction:column}.global-bank-btn{width:100%}}'
      ].join('');
      document.head.appendChild(st);
    }
  };

  window.StudyGlobalScope = S;

  /* Catálogo de bancas passa a ser do perfil, não do planejamento. */
  const oldGetBancas = DB.getCardBancas ? DB.getCardBancas.bind(DB) : null;
  DB.getCardBancas = () => S.bankCatalog();
  DB.saveCardBancas = list => S.saveBankCatalog(list);
  DB.addCardBanca = nome => {
    const n = String(nome || '').trim(); if (!n) return null;
    const list = S.bankCatalog(); if (list.some(x => norm(x) === norm(n))) return null;
    list.push(n); S.saveBankCatalog(list); return n;
  };
  DB.removeCardBanca = nome => S.saveBankCatalog(S.bankCatalog().filter(x => norm(x) !== norm(nome)));

  /* Helpers públicos de leitura global. Mantêm o padrão já usado por Histórico
     e Evolução: o caller escolhe atual ou todos; o dado nunca é duplicado. */
  DB.getCardsForPlan = id => S._tag(id, S._rows(id, 'cards'));
  DB.getDecksForPlan = id => S._tag(id, S._rows(id, 'decks'));
  DB.getRevlogForPlan = id => S._revlogForPlan(id);
  DB.addDeckForPlan = function(id, nome) {
    if (!id || String(id) === String(S.activePlanId())) return O.addDeck(nome);
    const prevGet=DB.getDecks,prevSave=DB.saveDecks;
    DB.getDecks=()=>S._rows(id,'decks');
    DB.saveDecks=list=>DB._set(DB.keysForPlan(id).decks,(list||[]).map(x=>{const d=clone(x);delete d._planId;delete d._planNome;return d;}));
    try {
      const d=O.addDeck(nome);
      return d?Object.assign({},d,{_planId:id,_planNome:S.planName(id)}):d;
    } finally { DB.getDecks=prevGet;DB.saveDecks=prevSave; }
  };
  DB.addCardForPlan = function(id, data) {
    if (!id || String(id) === String(S.activePlanId())) return O.addCard(data || {});
    const prevGet=DB.getCards,prevSave=DB.saveCards;
    DB.getCards=()=>S._rows(id,'cards');
    DB.saveCards=list=>DB._set(DB.keysForPlan(id).cards,(list||[]).map(x=>{const c=clone(x);delete c._planId;delete c._planNome;return c;}));
    try {
      const c=O.addCard(data||{});
      return c?Object.assign({},c,{_planId:id,_planNome:S.planName(id)}):c;
    } finally { DB.getCards=prevGet;DB.saveCards=prevSave; }
  };
  DB.saveCardsForPlan = (id, list) => DB._set(DB.keysForPlan(id).cards, (list || []).map(x => {
    const c=clone(x);if(c){delete c._planId;delete c._planNome;}return c;
  }));
  DB.saveDecksForPlan = (id, list) => DB._set(DB.keysForPlan(id).decks, (list || []).map(x => {
    const d=clone(x);if(d){delete d._planId;delete d._planNome;}return d;
  }));
  DB.getAllCardsTagged = () => S.cards('all');
  DB.getAllDecksTagged = () => S.decks('all');
  DB.getAllRevlogTagged = () => S.revlog('all');
  DB.getAllExtrasTagged = () => S.operationalAllBy('extras');
  DB.getAllSavedGradesTagged = () => S.allBy('savedGrades');
  DB.copySavedGradeToActive = function(sourcePlanId, id) {
    const active = S.activePlanId();
    if (!sourcePlanId || String(sourcePlanId) === String(active)) return null;
    const src = S._rows(sourcePlanId, 'savedGrades').find(x => String(x && x.id) === String(id));
    if (!src) return null;
    const list = DB.getSavedGrades();
    const item = {
      id: DB._uid(),
      nome: String(src.nome || 'Grade salva').slice(0, 40),
      grade: clone(src.grade || {}),
      sessions: Number(src.sessions) || 3,
      createdAt: new Date().toISOString()
    };
    list.push(item);
    if (DB.saveSavedGrades(list) === false) return false;
    return Object.assign({}, item, { _planId: active, _planNome: S.planName(active) });
  };
  DB.getAllLeisTagged = () => S.allBy('leis');
  DB.copyLawToActive = function(sourcePlanId, id) {
    const active = S.activePlanId();
    if (!sourcePlanId || String(sourcePlanId) === String(active)) return DB.getLei(id);
    const src = S._rows(sourcePlanId, 'leis').find(x => String(x && x.id) === String(id));
    if (!src) return null;
    const origem = { planId: String(sourcePlanId), lawId: String(id) };
    const existente = DB.getLeis().find(x => x && x.origemCopia
      && String(x.origemCopia.planId) === origem.planId
      && String(x.origemCopia.lawId) === origem.lawId);
    if (existente) return Object.assign({}, existente, { _alreadyCopied: true });
    const now = new Date().toISOString();
    const item = {
      id: DB._uid(),
      titulo: src.titulo || 'Sem título',
      referencia: src.referencia || '',
      materia: src.materia || '',
      texto: src.texto || '',
      marcacoes: clone(src.marcacoes || []),
      suppressed: clone(src.suppressed || []),
      opts: clone(src.opts || { ressalvas:true, restricoes:true, competencias:true, prazos:true, efeitos:true, relacoes:true }),
      bookmark: src.bookmark == null ? null : src.bookmark,
      bookmarkTxt: src.bookmarkTxt || null,
      origemCopia: origem,
      createdAt: now,
      updatedAt: now
    };
    const list = DB.getLeis();
    list.push(item);
    if (DB.saveLeis(list) === false) return false;
    return item;
  };
  DB.getAllLinksTagged = () => {
    let out = S.allBy('links');
    // Perfil realmente novo: preserva a semeadura dos atalhos padrão, mas só
    // uma vez no planejamento ativo; depois a leitura passa a ser global.
    if (!out.length && DB.getLinks) out = S._tag(S.activePlanId(), DB.getLinks());
    return out;
  };
  DB.getAllTecSnapshotsTagged = () => {
    try { if (DB._kickRelationalHeavy) DB._kickRelationalHeavy('db-tec-global'); } catch (_) {}
    return S.operationalAllBy('tec').map(s => {
      const x = Object.assign({}, s);
      if (!x.startDate) x.startDate = x.date || (typeof todayLocal === 'function' ? todayLocal() : '');
      if (!x.endDate) x.endDate = x.date || x.startDate;
      return x;
    }).sort((a,b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))
      || String(a.endDate || '').localeCompare(String(b.endDate || '')));
  };
  DB.getAllIncidenciaTagged = () => S.operationalAllBy('incidencia');

  /* Memória realizada/conhecimento pertence ao PERFIL. A persistência continua
     separada por planejamento para compatibilidade e sincronização, mas leitura
     global e mutações são roteadas de volta à origem. */

  const EO = {
    getEntry: DB.getEntry.bind(DB),
    updateEntry: DB.updateEntry.bind(DB),
    deleteEntry: DB.deleteEntry.bind(DB)
  };
  DB.getEntry = function(id) {
    const local = EO.getEntry(id);
    if (local) return local;
    const r = S.findRecord('entries', id);
    return r ? Object.assign({}, r.row, { _planId: r.planId, _planNome: S.planName(r.planId) }) : null;
  };
  DB.updateEntry = function(id, patch) {
    // Registros de outro planejamento são somente leitura no contexto atual.
    if (!EO.getEntry(id)) return null;
    return EO.updateEntry(id, patch);
  };
  DB.deleteEntry = function(id) {
    if (!EO.getEntry(id)) return false;
    return EO.deleteEntry(id);
  };

  const LO = {
    getLei: DB.getLei.bind(DB),
    updateLei: DB.updateLei.bind(DB),
    deleteLei: DB.deleteLei.bind(DB)
  };
  DB.getLei = function(id) {
    const local = LO.getLei(id);
    if (local) return local;
    const r = S.findRecord('leis', id);
    return r ? Object.assign({}, r.row, { _planId: r.planId, _planNome: S.planName(r.planId) }) : null;
  };
  DB.updateLei = function(id, patch) {
    if (!LO.getLei(id)) return null;
    return LO.updateLei(id, patch);
  };
  DB.deleteLei = function(id) {
    if (!LO.getLei(id)) return false;
    return LO.deleteLei(id);
  };

  const LKO = {
    updateLink: DB.updateLink.bind(DB),
    deleteLink: DB.deleteLink.bind(DB)
  };
  DB.updateLink = function(id, patch) {
    const active = S._rows(S.activePlanId(), 'links');
    if (!active.some(x => String(x.id) === String(id))) return null;
    return LKO.updateLink(id, patch);
  };
  DB.deleteLink = function(id) {
    const active = S._rows(S.activePlanId(), 'links');
    if (!active.some(x => String(x.id) === String(id))) return false;
    return LKO.deleteLink(id);
  };

  const TO = {
    deleteTecSnapshot: DB.deleteTecSnapshot.bind(DB),
    updateTecSnapshot: DB.updateTecSnapshot.bind(DB),
    tecOverlap: DB.tecOverlap.bind(DB)
  };
  DB.deleteTecSnapshot = function(id) {
    const active = S._rows(S.activePlanId(), 'tec');
    if (!active.some(x => String(x.id) === String(id))) return false;
    return TO.deleteTecSnapshot(id);
  };
  DB.updateTecSnapshot = function(id, patch) {
    const active = S._rows(S.activePlanId(), 'tec');
    if (!active.some(x => String(x.id) === String(id))) return null;
    return TO.updateTecSnapshot(id, patch);
  };
  DB.tecOverlap = function(start, end, ignoreId) {
    // Sobreposição só é conflito dentro do MESMO planejamento. Dois planos
    // podem representar recortes diferentes (ex.: multibanca e CESGRANRIO)
    // nas mesmas datas sem um bloquear a importação do outro.
    return TO.tecOverlap(start, end, ignoreId);
  };

  /* Roteamento de card global para o planejamento onde ele nasceu. */
  const O = {
    getCard: DB.getCard.bind(DB),
    updateCard: DB.updateCard.bind(DB),
    updateCardNote: DB.updateCardNote.bind(DB),
    deleteCard: DB.deleteCard.bind(DB),
    deleteNoteByCard: DB.deleteNoteByCard.bind(DB),
    addRevlogDurable: DB.addRevlogDurable.bind(DB),
    cancelarRevlogDurable: DB.cancelarRevlogDurable.bind(DB),
    removeRevlog: DB.removeRevlog.bind(DB),
    addRevlog: DB.addRevlog.bind(DB),
    renameDeck: DB.renameDeck.bind(DB),
    deleteDeck: DB.deleteDeck.bind(DB),
    addCard: DB.addCard.bind(DB),
    addDeck: DB.addDeck.bind(DB)
  };
  DB.renameDeck = function(id, nome) {
    if (DB.getDecks().some(d=>String(d.id)===String(id))) return O.renameDeck(id,nome);
    const r=S.deckRecord(id);if(!r)return null;
    const list=S._rows(r.planId,'decks'),d=list.find(x=>String(x.id)===String(id));if(!d)return null;
    d.nome=String(nome||'').trim();
    return DB._set(DB.keysForPlan(r.planId).decks,list)===false?false:d;
  };
  DB.deleteDeck = function(id) {
    if (DB.getDecks().some(d=>String(d.id)===String(id))) return O.deleteDeck(id);
    const r=S.deckRecord(id);if(!r)return;
    const decks=S._rows(r.planId,'decks').filter(d=>String(d.id)!==String(id));
    const cards=S._rows(r.planId,'cards');cards.forEach(c=>{if(String(c.deckId)===String(id)){c.deckId=null;c.updatedAt=new Date().toISOString();}});
    DB._set(DB.keysForPlan(r.planId).decks,decks);DB._set(DB.keysForPlan(r.planId).cards,cards);
  };

  DB.getCard = function(id) {
    const local = O.getCard(id); if (local) return local;
    const r = S.findCardRecord(id); return r ? Object.assign({}, r.card, { _planId: r.planId, _planNome: S.planName(r.planId) }) : null;
  };
  DB.updateCard = function(id, patch) {
    if (O.getCard(id)) return O.updateCard(id, patch);
    const r = S.findCardRecord(id); if (!r) return null;
    let p = DB._semTransitorios ? DB._semTransitorios(patch) : patch;
    if (p && ('frente' in p || 'verso' in p)) {
      p = Object.assign({}, p);
      if ('frente' in p) p.frente = _sanCard(p.frente);
      if ('verso' in p) p.verso = _sanCard(p.verso);
    }
    const c = r.list[r.index];
    Object.assign(c, p || {}); c.updatedAt = new Date().toISOString(); c.ankiMod = Math.floor(Date.now()/1000);
    return DB._set(DB.keysForPlan(r.planId).cards, r.list) === false ? false
      : Object.assign({}, c, { _planId: r.planId, _planNome: S.planName(r.planId) });
  };
  DB.updateCardNote = function(id, data) {
    if (O.getCard(id)) return O.updateCardNote(id, data);
    const r = S.findCardRecord(id); if (!r) return null;
    const atual = r.card, noteId = atual.noteId || atual.id, canonical = Object.assign({}, data || {});
    if (atual.template === 'reverse') { const f = canonical.frente; canonical.frente = canonical.verso; canonical.verso = f; }
    const comuns = ['deckId','materia','assunto','materiaTec','banca','kind'], now = new Date().toISOString();
    r.list.forEach(c => {
      if (String(c.noteId || c.id) !== String(noteId)) return;
      const p = {}; comuns.forEach(k => { if (Object.prototype.hasOwnProperty.call(canonical,k)) p[k]=canonical[k]; });
      if ('frente' in canonical || 'verso' in canonical) {
        if (c.template === 'reverse') {
          if ('verso' in canonical) p.frente = _sanCard(canonical.verso);
          if ('frente' in canonical) p.verso = _sanCard(canonical.frente);
        } else {
          if ('frente' in canonical) p.frente = _sanCard(canonical.frente);
          if ('verso' in canonical) p.verso = _sanCard(canonical.verso);
        }
      }
      Object.assign(c,p); c.updatedAt=now; c.ankiMod=Math.floor(Date.now()/1000);
    });
    if (DB._set(DB.keysForPlan(r.planId).cards, r.list) === false) return false;
    return DB.getCard(id);
  };
  DB.deleteCard = function(id) {
    if (O.getCard(id)) return O.deleteCard(id);
    const r = S.findCardRecord(id); if (!r) return;
    DB._set(DB.keysForPlan(r.planId).cards, r.list.filter(c => String(c.id) !== String(id)));
    S.replaceRevlogPlan(r.planId, S._revlogForPlan(r.planId).filter(x => String(x.cardId) !== String(id)));
    try { CardsConfig.forgetCardId(id); } catch (_) {}
  };
  DB.deleteNoteByCard = function(id) {
    if (O.getCard(id)) return O.deleteNoteByCard(id);
    const r = S.findCardRecord(id); if (!r) return 0;
    const nid = String(r.card.noteId || r.card.id);
    const ids = new Set(r.list.filter(c => String(c.noteId || c.id) === nid).map(c => String(c.id)));
    if (DB._set(DB.keysForPlan(r.planId).cards, r.list.filter(c => !ids.has(String(c.id)))) === false) return false;
    S.replaceRevlogPlan(r.planId, S._revlogForPlan(r.planId).filter(x => !ids.has(String(x.cardId))));
    try { ids.forEach(cid => CardsConfig.forgetCardId(cid)); } catch (_) {}
    return ids.size;
  };

  DB.addRevlog = function(entry) {
    const pid = S.sourcePlanForCard(entry && entry.cardId);
    if (!pid || String(pid) === String(S.activePlanId())) return O.addRevlog(entry);
    const l = S._revlogForPlan(pid), last = l.length ? l[l.length - 1] : null;
    const pos = Math.max(l.length, Number(last && last._position) || 0) + 1;
    const row = DB._normalizarReviewId(Object.assign({ _position: pos }, entry), true);
    l.push(row);
    const key = DB.keysForPlan(pid).revlog;
    try {
      if (DB._bancoRelacionalPronto && DB._bancoRelacionalPronto() && window.RelationalStore && RelationalStore.queueRevlogAppend)
        RelationalStore.queueRevlogAppend(key, row);
    } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'global-revlog-append'); }
    if (S._savePending(pid, row) === false) {
      const i = l.findIndex(x => x && x.reviewId === row.reviewId); if (i >= 0) l.splice(i, 1);
      return false;
    }
    return row;
  };

  DB.addRevlogDurable = async function(entry, cardAfter, cardPosition) {
    const pid = S.sourcePlanForCard(entry && entry.cardId);
    if (!pid || String(pid) === String(S.activePlanId())) return O.addRevlogDurable(entry, cardAfter, cardPosition);
    const l = S._revlogForPlan(pid), last = l.length ? l[l.length-1] : null;
    const pos = Math.max(l.length, Number(last && last._position)||0) + 1;
    const row = DB._normalizarReviewId(Object.assign({ _position: pos }, entry), true);
    l.push(row);
    const key = DB.keysForPlan(pid).revlog, ctx = DB._reviewContext(key);
    const after = cardAfter ? clone(cardAfter) : null;
    if (after) { delete after._planId; delete after._planNome; }
    const op = {
      id: row.reviewId + ':append', reviewId: row.reviewId, type: 'append',
      key, profileId: ctx.profileId, planId: ctx.planId, row: clone(row),
      cardAfter: after, cardPosition: Number(cardPosition)||1, createdAt: Date.now()
    };
    let journaled = false;
    try { journaled = await ReviewJournal.put(op); } catch (_) {}
    if (!journaled && S._savePending(pid, row) === false) {
      const i = l.findIndex(x => x && x.reviewId === row.reviewId); if (i >= 0) l.splice(i,1);
      return false;
    }
    return row;
  };
  DB.cancelarRevlogDurable = async function(row) {
    const pid = S.sourcePlanForCard(row && row.cardId);
    if (!pid || String(pid) === String(S.activePlanId())) return O.cancelarRevlogDurable(row);
    const l = S._revlogForPlan(pid), i = l.findIndex(x => x && x.reviewId === row.reviewId);
    if (i >= 0) l.splice(i,1);
    try { await ReviewJournal.remove(String(row.reviewId)+':append'); } catch (_) {}
    S.confirmReview(pid,row.reviewId); return true;
  };
  DB.removeRevlog = function(ts) {
    const active = DB.getRevlog();
    if (active.some(r => r.ts === ts)) return O.removeRevlog(ts);
    for (const p of S.plans()) {
      if (String(p.id) === String(S.activePlanId())) continue;
      if (S._revlogForPlan(p.id).some(r => r.ts === ts)) return S.removeRevlogPlan(p.id, ts);
    }
    return true;
  };

  /* Enterrar irmãos precisa olhar os irmãos do MESMO planejamento de origem. */
  if (window.AnkiParity && AnkiParity.autoBurySiblings) {
    AnkiParity.autoBurySiblings = function(card) {
      if (!card || !card.noteId) return [];
      const cfg=CardsConfig.forDeck(card.originalDeckId||card.deckId), nid=String(card.noteId), buried=[];
      const pid=card._planId||S.sourcePlanForCard(card.id), cards=pid?S._tag(pid,S._rows(pid,'cards')):DB.getCards();
      cards.forEach(s=>{
        if(String(s.id)===String(card.id)||String(s.noteId||s.id)!==nid||s.suspenso)return;
        const ph=s.phase||(((s.reps||0)>0&&(s.intervalo||0)>0)?'review':'new'),inter=(ph==='learning'||ph==='relearning')&&!s.dueTs;
        const bury=(ph==='new'&&cfg.buryNew)||(ph==='review'&&cfg.buryReviews)||(inter&&cfg.buryInterdayLearning);
        if(bury&&CardEngine.isDue(s)){DB.buryCard(s.id,'scheduler');buried.push(s.id);}
      });
      return buried;
    };
  }

  /* Notes/NoteTypes continuam persistidos por planejamento para compatibilidade
     com sync/backup, mas passam a formar uma coleção virtual única quando Cards
     está em "Todos os planejamentos". Escritas retornam sempre à origem. */
  S.installAnkiEntityScope = function() {
    const AP = window.AnkiParity;
    if (!AP || AP.__globalEntityScope) return;
    AP.__globalEntityScope = true;
    const old = {
      planPrefix: AP._planPrefix,
      getNote: AP.getNote, saveNote: AP.saveNote, notes: AP.notes,
      getNotetype: AP.getNotetype, saveNotetype: AP.saveNotetype, noteTypes: AP.noteTypes,
      stockNotetype: AP.stockNotetype, ensureCanonicalNotes: AP.ensureCanonicalNotes,
      ensureIdentities: AP.ensureIdentities, specialField: AP._specialField
    };
    const withPrefix = (pid, fn) => {
      const prev = AP._planPrefix;
      AP._planPrefix = () => DB._profilePrefix() + 'p:' + String(pid) + ':';
      try { return fn(); } finally { AP._planPrefix = prev; }
    };
    const withOriginalEntities = (pid, fn) => {
      const names=['getNote','saveNote','notes','getNotetype','saveNotetype','noteTypes','stockNotetype'];
      const prev={}; names.forEach(n=>{prev[n]=AP[n];AP[n]=old[n];});
      try { return withPrefix(pid, fn); } finally { names.forEach(n=>{AP[n]=prev[n];}); }
    };
    const clean = x => { const y=clone(x); if (y) { delete y._planId; delete y._planNome; } return y; };

    AP.getNote = function(id, planId) {
      if (planId != null) return withPrefix(planId, () => {
        const x=old.getNote.call(AP,id); return x?Object.assign({},x,{_planId:planId,_planNome:S.planName(planId)}):null;
      });
      return S.ankiEntity('note', id);
    };
    AP.getNotetype = function(id, planId) {
      if (planId != null) return withPrefix(planId, () => {
        const x=old.getNotetype.call(AP,id); return x?Object.assign({},x,{_planId:planId,_planNome:S.planName(planId)}):null;
      });
      return S.ankiEntity('notetype', id);
    };
    AP.notes = function(){ return S.ankiEntities('note'); };
    AP.noteTypes = function(){ return S.ankiEntities('notetype').sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))); };
    AP.saveNote = function(note) {
      const pid=(note&&note._planId)||S.activePlanId(), x=clean(note);
      const saved=withOriginalEntities(pid,()=>old.saveNote.call(AP,x));
      return saved?Object.assign({},saved,{_planId:pid,_planNome:S.planName(pid)}):saved;
    };
    AP.saveNotetype = function(nt) {
      const pid=(nt&&nt._planId)||S.activePlanId(), x=clean(nt);
      const saved=withOriginalEntities(pid,()=>old.saveNotetype.call(AP,x));
      return saved?Object.assign({},saved,{_planId:pid,_planNome:S.planName(pid)}):saved;
    };
    AP.stockNotetype = function(kind, planId) {
      const pid=planId||S.activePlanId();
      const saved=withOriginalEntities(pid,()=>old.stockNotetype.call(AP,kind));
      return saved?Object.assign({},saved,{_planId:pid,_planNome:S.planName(pid)}):saved;
    };
    AP.ensureCanonicalNotes = function(cards) {
      const source=Array.isArray(cards)?cards:S.cards(), groups=new Map();
      source.forEach(c=>{
        const pid=c&&c._planId||S.sourcePlanForCard(c&&c.id)||S.activePlanId();
        if(!pid)return;if(!groups.has(String(pid)))groups.set(String(pid),{pid,rows:[]});
        groups.get(String(pid)).rows.push(clean(c));
      });
      let notes=0,created=0,changed=false;
      groups.forEach(g=>{
        const prevSave=DB.saveCards;
        DB.saveCards=list=>DB._set(DB.keysForPlan(g.pid).cards,(list||[]).map(clean));
        try {
          const r=withOriginalEntities(g.pid,()=>old.ensureCanonicalNotes.call(AP,g.rows))||{};
          notes+=Number(r.notes)||0;created+=Number(r.created)||0;changed=changed||!!r.cardsChanged;
        } finally { DB.saveCards=prevSave; }
      });
      return {notes,created,cardsChanged:changed};
    };
    AP.ensureIdentities = function() {
      let cards=false,decks=false;
      S.planIdsForScope().forEach(pid=>{
        const prev={getCards:DB.getCards,getDecks:DB.getDecks,saveCards:DB.saveCards,saveDecks:DB.saveDecks};
        DB.getCards=()=>S._rows(pid,'cards');DB.getDecks=()=>S._rows(pid,'decks');
        DB.saveCards=list=>DB._set(DB.keysForPlan(pid).cards,(list||[]).map(clean));
        DB.saveDecks=list=>DB._set(DB.keysForPlan(pid).decks,(list||[]).map(clean));
        try { const r=old.ensureIdentities.call(AP)||{};cards=cards||!!r.cards;decks=decks||!!r.decks; }
        finally { Object.assign(DB,prev); }
      });
      return {cards,decks};
    };
    AP._specialField = function(name,nt,note,tmpl,card) {
      const n=String(name||'').trim();
      if ((n==='Deck'||n==='Subdeck') && card) {
        const d=S.deckForCard(card); if(!d)return '';
        if(n==='Deck')return String(d.nome||'');
        const p=String(d.nome||'').split('::');return p[p.length-1]||'';
      }
      return old.specialField.call(AP,name,nt,note,tmpl,card);
    };

    if (window.AnkiProductParity && !AnkiProductParity.__globalCardsForNote) {
      AnkiProductParity.__globalCardsForNote=true;
      AnkiProductParity._cardsForNote=function(id){
        const k=String(id);return S.cards().filter(c=>String(AP.noteId(c))===k);
      };
    }

    if (window.AnkiTotalParity && !AnkiTotalParity.__globalUndoScope) {
      const T=AnkiTotalParity, oldSnapshot=T._snapshot.bind(T), oldRestore=T._restoreSnapshot.bind(T);
      T.__globalUndoScope=true;
      T._snapshot=function(label){
        if(S.cardsScope()!=='all')return oldSnapshot(label);
        return {label:String(label||'Ação'),ts:Date.now(),globalScope:true,plans:S.planIdsForScope('all').map(pid=>({
          planId:pid,cards:clone(S._rows(pid,'cards')),decks:clone(S._rows(pid,'decks')),
          revlog:clone(S._revlogForPlan(pid)),entities:S.ankiEntityEntries(pid)
        }))};
      };
      T._restoreSnapshot=function(snap){
        if(!snap||!snap.globalScope)return oldRestore(snap);
        this._restoring=true;
        try{
          (snap.plans||[]).forEach(p=>{
            DB._set(DB.keysForPlan(p.planId).cards,clone(p.cards||[]));
            DB._set(DB.keysForPlan(p.planId).decks,clone(p.decks||[]));
            S.replaceRevlogPlan(p.planId,clone(p.revlog||[]));
            const prefix=DB._profilePrefix()+'p:'+String(p.planId)+':cards-',kill=[];
            for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&String(k).startsWith(prefix))kill.push(k);}
            kill.forEach(k=>localStorage.removeItem(k));(p.entities||[]).forEach(([k,v])=>localStorage.setItem(k,v));
          });
          CardEngine.invalidateDueCache();
          if(window.CardsScreen&&CardsScreen.render)CardsScreen.render();
          if(window.AnkiProductParity&&document.getElementById('anki-browser-modal')&&document.getElementById('anki-browser-modal').style.display==='flex')AnkiProductParity.renderBrowser();
          return true;
        }finally{this._restoring=false;this._syncUndoButtons();}
      };
    }
  };

  const boot = () => {
    S.installAnkiEntityScope(); S.installStyle(); S.bankCatalog(); S.installCardsUi(); S.installAnkiUi();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
  window.addEventListener('screen:activated', e => {
    const s = e && e.detail && e.detail.screen;
    if (s === 'cards') { S.installCardsUi(); S.refreshCards(); }
    if (s === 'anki') {
      S.installAnkiUi();
      if (S.selectedBanks().length) S.applyAnkiBankFilter(false).catch(err => {
        if (window.AnkiOfficial && AnkiOfficial.alert) AnkiOfficial.alert('Filtro de banca: ' + (err.message || err), 'error');
      });
    }
  });
})();
