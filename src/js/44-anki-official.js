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
    const raw = (window.ANKI_OFFICIAL_API_URL || fallback).trim();
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

  async _fetchResponse(path, opts) {
    const base = this.apiBase();
    if (!base) throw new Error('Backend do Anki Oficial ainda não foi configurado.');
    const raw = Object.assign({}, opts || {});
    const method = String(raw.method || 'GET').toUpperCase();
    const timeoutMs = Math.max(1000, Number(raw.timeoutMs || (method === 'GET' || method === 'HEAD' ? 12000 : 30000)));
    const retries = Math.max(0, Number(raw.retries != null ? raw.retries : ((method === 'GET' || method === 'HEAD') ? 1 : 0)));
    delete raw.timeoutMs; delete raw.retries;
    const upstreamSignal = raw.signal; delete raw.signal;
    raw.headers = this.headers(raw.headers);
    if ((method === 'GET' || method === 'HEAD') && raw.cache == null) raw.cache = 'no-store';

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const o = Object.assign({}, raw);
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timer = null;
      if (ac) {
        if (upstreamSignal) {
          if (upstreamSignal.aborted) ac.abort();
          else upstreamSignal.addEventListener('abort', () => ac.abort(), { once: true });
        }
        o.signal = ac.signal;
        timer = setTimeout(() => ac.abort(), timeoutMs);
      } else if (upstreamSignal) o.signal = upstreamSignal;
      try {
        const r = await fetch(base + path, o);
        if (attempt < retries && (method === 'GET' || method === 'HEAD') && [502, 503, 504].includes(r.status)) {
          await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
          continue;
        }
        return r;
      } catch (e) {
        lastError = e;
        const retryable = attempt < retries && (method === 'GET' || method === 'HEAD') &&
          (e && (e.name === 'TypeError' || e.name === 'AbortError'));
        if (retryable) {
          await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
          continue;
        }
        if (e && e.name === 'AbortError') {
          const err = new Error('O backend do Anki excedeu o tempo limite da operação.');
          err.code = 'ANKI_TIMEOUT';
          throw err;
        }
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw lastError || new Error('Falha de rede no backend do Anki.');
  },

  async request(path, opts) {
    const r = await this._fetchResponse(path, opts);
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
