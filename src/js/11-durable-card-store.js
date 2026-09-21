/* ============================================================
   DURABLE CARD STORE + OUTBOX
   ------------------------------------------------------------
   PostgreSQL continua sendo a fonte de verdade. Esta camada existe para duas
   coisas apenas:
   1) manter a API síncrona dos cards sem serializar a coleção inteira a cada
      resposta;
   2) garantir um WAL/outbox local pequeno e durável enquanto o PostgreSQL não
      confirmou uma mutação.

   O cache durável é por REGISTRO (IndexedDB). O localStorage nativo guarda só
   envelopes pendentes, nunca a coleção completa. A fachada localStorage usada
   pelo app continua sendo apenas memória.
   ============================================================ */
const DurableStudyStore = {
  DB_NAME: 'studynomentor-card-safety-v1',
  DB_VERSION: 1,
  CARD_STORE: 'cards',
  OUTBOX_STORE: 'outbox',
  NATIVE_PREFIX: 'diario-estudos:__durable_outbox__:',
  _dbp: null,
  _pending: new Set(),

  _native() {
    try {
      if (typeof window !== 'undefined' && window.__nativeLS) return window.__nativeLS;
      return localStorage;
    } catch (_) { return null; }
  },

  _pk(kind, scope, id) { return kind + '\u0000' + scope + '\u0000' + id; },
  _nativeKey(kind, scope, id) {
    return this.NATIVE_PREFIX + encodeURIComponent(kind) + ':' +
      encodeURIComponent(scope) + ':' + encodeURIComponent(id);
  },

  _track(p) {
    if (!p || typeof p.then !== 'function') return p;
    this._pending.add(p);
    p.finally(() => this._pending.delete(p)).catch(() => {});
    return p;
  },

  async flush() {
    const ps = Array.from(this._pending);
    if (ps.length) await Promise.allSettled(ps);
    return true;
  },

  _open() {
    if (this._dbp) return this._dbp;
    if (typeof indexedDB === 'undefined' || !indexedDB || !indexedDB.open) {
      return Promise.resolve(null);
    }
    this._dbp = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(this.DB_NAME, this.DB_VERSION); }
      catch (_) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.CARD_STORE)) {
          const s = db.createObjectStore(this.CARD_STORE, { keyPath: 'pk' });
          s.createIndex('scope', 'scope', { unique: false });
        }
        if (!db.objectStoreNames.contains(this.OUTBOX_STORE)) {
          const s = db.createObjectStore(this.OUTBOX_STORE, { keyPath: 'pk' });
          s.createIndex('scope', 'scope', { unique: false });
          s.createIndex('kind', 'kind', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return this._dbp;
  },

  _nativePut(kind, scope, id, payload) {
    const ls = this._native();
    if (!ls) return false;
    try {
      ls.setItem(this._nativeKey(kind, scope, id), JSON.stringify(payload));
      return true;
    } catch (e) {
      try { console.error('[durable-outbox] native put', e); } catch (_) {}
      return false;
    }
  },

  _nativeGet(kind, scope, id) {
    const ls = this._native();
    if (!ls) return null;
    try {
      const raw = ls.getItem(this._nativeKey(kind, scope, id));
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  },

  _nativeDelete(kind, scope, id) {
    const ls = this._native();
    if (!ls) return;
    try { ls.removeItem(this._nativeKey(kind, scope, id)); } catch (_) {}
  },

  _nativeList(kind, scope) {
    const ls = this._native();
    if (!ls) return [];
    const out = [];
    try {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!k || k.indexOf(this.NATIVE_PREFIX) !== 0) continue;
        let v = null;
        try { v = JSON.parse(ls.getItem(k)); } catch (_) { v = null; }
        if (!v) continue;
        if (kind && v.kind !== kind) continue;
        if (scope && v.scope !== scope) continue;
        out.push(v);
      }
    } catch (_) {}
    return out;
  },

  putOutbox(payload) {
    if (!payload || !payload.kind || !payload.scope || !payload.id) return false;
    payload.pk = this._pk(payload.kind, payload.scope, payload.id);
    if (!this._nativePut(payload.kind, payload.scope, payload.id, payload)) return false;
    this._track((async () => {
      const db = await this._open(); if (!db) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(this.OUTBOX_STORE, 'readwrite');
          tx.objectStore(this.OUTBOX_STORE).put(payload);
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => resolve();
        } catch (_) { resolve(); }
      });
    })());
    return true;
  },

  deleteOutbox(kind, scope, id) {
    this._nativeDelete(kind, scope, id);
    this._track((async () => {
      const db = await this._open(); if (!db) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(this.OUTBOX_STORE, 'readwrite');
          tx.objectStore(this.OUTBOX_STORE).delete(this._pk(kind, scope, id));
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => resolve();
        } catch (_) { resolve(); }
      });
    })());
  },

  listOutbox(kind, scope) { return this._nativeList(kind, scope); },

  putCard(scope, card, position) {
    if (!scope || !card || !card.id) return;
    const value = {
      pk: this._pk('card-cache', scope, card.id), scope, id: String(card.id),
      position: Number(position) || 0, card: JSON.parse(JSON.stringify(card)),
      updatedAt: card.updatedAt || null
    };
    this._track((async () => {
      const db = await this._open(); if (!db) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(this.CARD_STORE, 'readwrite');
          tx.objectStore(this.CARD_STORE).put(value);
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => resolve();
        } catch (_) { resolve(); }
      });
    })());
  },

  deleteCard(scope, id) {
    this._track((async () => {
      const db = await this._open(); if (!db) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(this.CARD_STORE, 'readwrite');
          tx.objectStore(this.CARD_STORE).delete(this._pk('card-cache', scope, id));
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => resolve();
        } catch (_) { resolve(); }
      });
    })());
  },

  replaceCards(scope, list) {
    const arr = Array.isArray(list) ? list : [];
    this._track((async () => {
      const db = await this._open(); if (!db) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(this.CARD_STORE, 'readwrite');
          const s = tx.objectStore(this.CARD_STORE);
          const idx = s.index('scope');
          const req = idx.getAllKeys(IDBKeyRange.only(scope));
          req.onsuccess = () => {
            (req.result || []).forEach(k => s.delete(k));
            arr.forEach((card, i) => {
              if (!card || !card.id) return;
              s.put({
                pk: this._pk('card-cache', scope, card.id), scope, id: String(card.id),
                position: i, card: JSON.parse(JSON.stringify(card)),
                updatedAt: card.updatedAt || null
              });
            });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => resolve();
        } catch (_) { resolve(); }
      });
    })());
  },

  async readCards(scope) {
    const db = await this._open(); if (!db) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.CARD_STORE, 'readonly');
        const req = tx.objectStore(this.CARD_STORE).index('scope').getAll(IDBKeyRange.only(scope));
        req.onsuccess = () => resolve((req.result || []).sort((a,b)=>(a.position||0)-(b.position||0)));
        req.onerror = () => resolve([]);
      } catch (_) { resolve([]); }
    });
  },

  clearScopeOutbox(kind, scope) {
    this._nativeList(kind, scope).forEach(x => this._nativeDelete(kind, scope, x.id));
    this._track((async () => {
      const db = await this._open(); if (!db) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(this.OUTBOX_STORE, 'readwrite');
          const s = tx.objectStore(this.OUTBOX_STORE);
          const req = s.index('scope').getAll(IDBKeyRange.only(scope));
          req.onsuccess = () => (req.result || []).forEach(x => {
            if (!kind || x.kind === kind) s.delete(x.pk);
          });
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => resolve();
        } catch (_) { resolve(); }
      });
    })());
  }
};

const CardStore = {
  _scopes: new Map(),
  _inflight: new Map(),
  _opSeq: 0,

  _clone(v) {
    if (v == null) return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  },

  _outbox(scope, id) { return DurableStudyStore._nativeGet('card', scope, String(id)); },

  _scope(scope, fallback) {
    let s = this._scopes.get(scope);
    if (s) return s;
    let base = [];
    try { base = typeof fallback === 'function' ? fallback() : []; } catch (_) { base = []; }
    base = Array.isArray(base) ? base : [];
    s = { list: base, byId: new Map(), remoteApplied: false, idbLoading: false };
    base.forEach(c => { if (c && c.id != null) s.byId.set(String(c.id), c); });
    this._scopes.set(scope, s);
    this._applyPendingToScope(scope, s);
    this._hydrateIdb(scope, s);
    return s;
  },

  _hydrateIdb(scope, s) {
    if (s.idbLoading) return;
    s.idbLoading = true;
    DurableStudyStore.readCards(scope).then(rows => {
      if (!rows.length || s.remoteApplied) return;
      // IDB é cache de recuperação, nunca substitui snapshot SQL já recebido.
      if (!s.list.length) {
        s.list = rows.map(x => x.card).filter(Boolean);
        s.byId = new Map(s.list.map(c => [String(c.id), c]));
        this._applyPendingToScope(scope, s);
        try {
          if (typeof CardsScreen !== 'undefined' && CardsScreen.render) CardsScreen.render();
        } catch (_) {}
      }
    }).catch(() => {}).finally(() => { s.idbLoading = false; });
  },

  _applyPendingToScope(scope, s) {
    DurableStudyStore.listOutbox('card', scope).forEach(m => this._applyMutationToScope(s, m));
  },

  _applyMutationToScope(s, m) {
    if (!m || !m.id) return;
    const id = String(m.id);
    if (m.action === 'delete') {
      const old = s.byId.get(id);
      if (old) {
        const i = s.list.indexOf(old); if (i >= 0) s.list.splice(i, 1);
        s.byId.delete(id);
      }
      return;
    }
    const card = this._clone(m.card);
    if (!card) return;
    const old = s.byId.get(id);
    if (old) {
      const i = s.list.indexOf(old);
      if (i >= 0) s.list[i] = card;
    } else {
      const p = Math.max(0, Math.min(s.list.length, Number(m.position)));
      if (Number.isFinite(p)) s.list.splice(p, 0, card); else s.list.push(card);
    }
    s.byId.set(id, card);
  },

  getCards(scope, fallback) { return this._scope(scope, fallback).list; },
  getCard(scope, id, fallback) { return this._scope(scope, fallback).byId.get(String(id)) || null; },

  replaceAll(scope, list, persistProjection) {
    const arr = Array.isArray(list) ? list : [];
    if (typeof persistProjection === 'function' && persistProjection(arr) === false) return false;
    DurableStudyStore.clearScopeOutbox('card', scope);
    const s = { list: arr, byId: new Map(), remoteApplied: false, idbLoading: false };
    arr.forEach(c => { if (c && c.id != null) s.byId.set(String(c.id), c); });
    this._scopes.set(scope, s);
    DurableStudyStore.replaceCards(scope, arr);
    return true;
  },

  _newOp(patch, context, updatedAt) {
    return {
      id: 'op-' + Date.now().toString(36) + '-' + (++this._opSeq).toString(36),
      patch: this._clone(patch || {}),
      context: this._clone(context || null),
      updatedAt: updatedAt || new Date().toISOString()
    };
  },

  _applyOps(base, ops) {
    let card = this._clone(base) || {};
    for (const op of (Array.isArray(ops) ? ops : [])) {
      let patch = op.patch || {};
      try {
        if (op.context && op.context.kind === 'review' && op.context.grade &&
            typeof CardEngine !== 'undefined' && CardEngine.schedule) {
          patch = CardEngine.schedule(card, op.context.grade);
          if (typeof DB !== 'undefined' && DB._semTransitorios) patch = DB._semTransitorios(patch);
        }
      } catch (_) {}
      Object.assign(card, this._clone(patch || {}));
      card.updatedAt = op.updatedAt || card.updatedAt || new Date().toISOString();
    }
    return card;
  },

  upsert(scope, card, base, patch, position, context) {
    if (!card || card.id == null) return false;
    const id = String(card.id);
    const existing = this._outbox(scope, id);
    const op = this._newOp(patch, context, card.updatedAt);
    let m;
    if (existing && existing.action === 'upsert') {
      m = existing;
      m.ops = Array.isArray(m.ops) ? m.ops : [];
      m.ops.push(op);
      m.card = this._clone(card);
      m.position = Number(position) || 0;
      m.updatedAt = new Date().toISOString();
    } else {
      m = {
        kind: 'card', scope, id, action: 'upsert',
        base: this._clone(base), ops: [op], card: this._clone(card),
        position: Number(position) || 0, createdAt: new Date().toISOString()
      };
    }
    if (!DurableStudyStore.putOutbox(m)) return false;
    const s = this._scope(scope, () => []);
    this._applyMutationToScope(s, m);
    DurableStudyStore.putCard(scope, card, position);
    this._sendCard(scope, id);
    return s.byId.get(id) || card;
  },

  remove(scope, id, base, position, context) {
    id = String(id);
    const existing = this._outbox(scope, id);
    const m = {
      kind: 'card', scope, id, action: 'delete',
      base: existing && existing.base !== undefined ? existing.base : this._clone(base),
      position: Number(position) || 0,
      context: this._clone(context || null),
      createdAt: existing && existing.createdAt || new Date().toISOString()
    };
    if (!DurableStudyStore.putOutbox(m)) return false;
    const s = this._scope(scope, () => []);
    this._applyMutationToScope(s, m);
    DurableStudyStore.deleteCard(scope, id);
    this._sendCard(scope, id);
    return true;
  },

  _relReady() {
    try {
      return typeof RelationalStore !== 'undefined' && RelationalStore &&
        RelationalStore.queueCardMutation && RelationalStore.isReady && RelationalStore.isReady();
    } catch (_) { return false; }
  },

  _sendCard(scope, id) {
    const key = scope + '\u0000' + id;
    if (this._inflight.has(key) || !this._relReady()) return null;
    const current = this._outbox(scope, id);
    if (!current) return null;
    const snapshot = this._clone(current);
    let p;
    try { p = RelationalStore.queueCardMutation(scope, snapshot); }
    catch (_) { return null; }
    if (!p || typeof p.then !== 'function') return null;
    let succeeded = false;
    const tracked = p.then((ack) => {
      succeeded = true;
      const now = this._outbox(scope, id);
      if (!now) return true;
      if (snapshot.action === 'delete') {
        if (now.action === 'delete') DurableStudyStore.deleteOutbox('card', scope, id);
      } else if (now.action === 'upsert') {
        const done = new Set((snapshot.ops || []).map(x => x.id));
        now.ops = (now.ops || []).filter(x => !done.has(x.id));
        const confirmed = ack && ack.card ? this._clone(ack.card) : this._clone(snapshot.card);
        if (!now.ops.length) {
          DurableStudyStore.deleteOutbox('card', scope, id);
          if (confirmed) {
            const s = this._scope(scope, () => []);
            const m = { id, action:'upsert', card:confirmed, position:now.position };
            this._applyMutationToScope(s, m);
            DurableStudyStore.putCard(scope, confirmed, now.position);
          }
        } else {
          now.base = confirmed;
          now.card = this._applyOps(now.base, now.ops);
          DurableStudyStore.putOutbox(now);
          const s = this._scope(scope, () => []);
          this._applyMutationToScope(s, now);
          DurableStudyStore.putCard(scope, now.card, now.position);
        }
      }
      return true;
    }).catch(() => false).finally(() => {
      this._inflight.delete(key);
      // Só encadeia automaticamente mutações que surgiram ENQUANTO a anterior
      // era confirmada. Em erro, o WAL fica parado para replay no próximo
      // flush/foco/reconexão — sem loop de rede infinito.
      const again = this._outbox(scope, id);
      if (succeeded && again && this._relReady()) this._sendCard(scope, id);
    });
    this._inflight.set(key, tracked);
    return tracked;
  },

  rebasePending(scope, id, remoteCard) {
    const m = this._outbox(scope, id);
    if (!m || m.action !== 'upsert') return null;
    m.base = this._clone(remoteCard);
    m.card = this._applyOps(m.base, m.ops);
    DurableStudyStore.putOutbox(m);
    const s = this._scope(scope, () => []);
    this._applyMutationToScope(s, m);
    DurableStudyStore.putCard(scope, m.card, m.position);
    return this._clone(m);
  },

  applyRemoteSnapshot(scope, rows) {
    const remote = (Array.isArray(rows) ? rows : []).map(x => this._clone(x));
    const s = { list: remote, byId: new Map(), remoteApplied: true, idbLoading: false };
    remote.forEach(c => { if (c && c.id != null) s.byId.set(String(c.id), c); });
    this._applyPendingToScope(scope, s);
    this._scopes.set(scope, s);
    DurableStudyStore.replaceCards(scope, s.list);
    return s.list;
  },

  invalidateScope(scope) { this._scopes.delete(scope); },
  invalidatePrefix(prefix) {
    for (const k of Array.from(this._scopes.keys())) if (String(k).indexOf(prefix) === 0) this._scopes.delete(k);
  },
  resetForTests() { this._scopes.clear(); this._inflight.clear(); },

  replayAll() {
    if (!this._relReady()) return Promise.resolve(false);
    const pending = DurableStudyStore.listOutbox('card');
    const ps = [];
    pending.forEach(m => {
      const p = this._sendCard(m.scope, m.id);
      if (p && typeof p.then === 'function') ps.push(p);
    });
    if (typeof ReviewOutbox !== 'undefined') {
      const r = ReviewOutbox.replayAll();
      if (r && typeof r.then === 'function') ps.push(r);
    }
    return Promise.allSettled(ps).then(() => true);
  },

  pendingCount() { return DurableStudyStore.listOutbox('card').length; }
};

const ReviewOutbox = {
  _inflight: new Map(),
  _seq: 0,

  _id(row) {
    if (row && row._eventId) return String(row._eventId);
    const id = 'rev-' + Date.now().toString(36) + '-' + (++this._seq).toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
    if (row) row._eventId = id;
    return id;
  },

  append(scope, row) {
    const id = this._id(row);
    const m = { kind:'revlog', scope, id, action:'append', row: JSON.parse(JSON.stringify(row)), createdAt:new Date().toISOString() };
    if (!DurableStudyStore.putOutbox(m)) return false;
    this._send(scope, id);
    return true;
  },

  remove(scope, row) {
    const id = this._id(row);
    const existing = DurableStudyStore._nativeGet('revlog', scope, id);
    if (existing && existing.action === 'append' && !this._inflight.has(scope + '\u0000' + id)) {
      // Undo antes do envio: cancela o append; nada precisa ir ao servidor.
      DurableStudyStore.deleteOutbox('revlog', scope, id);
      return true;
    }
    const m = { kind:'revlog', scope, id, action:'delete', row: JSON.parse(JSON.stringify(row)), createdAt:new Date().toISOString() };
    if (!DurableStudyStore.putOutbox(m)) return false;
    this._send(scope, id);
    return true;
  },

  _ready() {
    try {
      return typeof RelationalStore !== 'undefined' && RelationalStore &&
        RelationalStore.isReady && RelationalStore.isReady() &&
        RelationalStore.queueRevlogAppend && RelationalStore.queueRevlogDelete;
    } catch (_) { return false; }
  },

  _send(scope, id) {
    const k = scope + '\u0000' + id;
    if (this._inflight.has(k) || !this._ready()) return null;
    const m = DurableStudyStore._nativeGet('revlog', scope, id);
    if (!m) return null;
    let p;
    try {
      p = m.action === 'delete'
        ? RelationalStore.queueRevlogDelete(scope, m.row)
        : RelationalStore.queueRevlogAppend(scope, m.row);
    } catch (_) { return null; }
    if (!p || typeof p.then !== 'function') return null;
    let succeeded = false;
    const tracked = p.then((ack) => {
      succeeded = true;
      if (m.action === 'append' && ack && Number.isFinite(Number(ack.position))) {
        try {
          if (typeof DB !== 'undefined' && DB.rebaseRevlogPosition) {
            DB.rebaseRevlogPosition(scope, id, Number(ack.position));
          }
        } catch (_) {}
      }
      const now = DurableStudyStore._nativeGet('revlog', scope, id);
      if (now && now.action === m.action) DurableStudyStore.deleteOutbox('revlog', scope, id);
      return true;
    }).catch(() => false).finally(() => {
      this._inflight.delete(k);
      if (succeeded && DurableStudyStore._nativeGet('revlog', scope, id) && this._ready()) this._send(scope, id);
    });
    this._inflight.set(k, tracked);
    return tracked;
  },

  replayAll() {
    if (!this._ready()) return Promise.resolve(false);
    const ps = [];
    DurableStudyStore.listOutbox('revlog').forEach(m => {
      const p = this._send(m.scope, m.id);
      if (p && typeof p.then === 'function') ps.push(p);
    });
    return Promise.allSettled(ps).then(() => true);
  },

  pendingRows(scope) {
    return DurableStudyStore.listOutbox('revlog', scope)
      .filter(m => m.action === 'append' && m.row).map(m => m.row);
  },

  pendingCount() { return DurableStudyStore.listOutbox('revlog').length; }
};

try {
  if (typeof window !== 'undefined') {
    window.DurableStudyStore = DurableStudyStore;
    window.CardStore = CardStore;
    window.ReviewOutbox = ReviewOutbox;
    window.__cardSafetyStore = true;
  }
} catch (_) {}
