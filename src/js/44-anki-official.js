/* ═══════════════════════════════════════════════════════════════════════════
   TRANSPORTE HTTP DA COLLECTION OFICIAL
   ---------------------------------------------------------------------------
   A antiga tela "Anki Oficial" foi consolidada na tela única #screen-cards.
   Este arquivo permanece somente como transporte autenticado para o backend.
   Toda regra acadêmica vive no pacote Anki validado pelo servidor; não existe
   scheduler, renderer, browser ou estado de revisão alternativo neste cliente.
   ═══════════════════════════════════════════════════════════════════════════ */
const AnkiOfficial = {
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
      const err = new Error(msg || ('HTTP ' + r.status));
      err.status = r.status;
      err.body = body;
      throw err;
    }
    return body;
  }
};

window.AnkiOfficial = AnkiOfficial;
