/* Harness da 2ª auditoria dos cards.
   Diferenças deliberadas em relação ao harness de 21/09 (1ª rodada):

   1. O armazenamento é REAL: um Map<string,string> que guarda as strings que o
      app realmente serializa. A 1ª rodada trocou DB._get/DB._set por um Map de
      objetos vivos, o que apagou do teste todo o custo (e todo o limite de
      tamanho) de JSON.parse/JSON.stringify a cada resposta — exatamente onde
      mora o problema de escala do revlog.
   2. O relógio é controlável em milissegundos, então os passos intradiários,
      a virada do dia e o "learn ahead" podem ser exercitados de verdade.
   3. Nenhum módulo de produção é redefinido. Só entram dublês para DOM, toasts
      e download — o que não existe fora do navegador.                        */
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
export const MODULOS = ['11-db.js', '30-fsrs.js', '31-cards-config.js', '32-card-engine.js', '44-tela-cards.js', '44-anki-parity.js'];
const NOMES = { '11-db.js': 'DB', '30-fsrs.js': 'FSRS', '31-cards-config.js': 'CardsConfig', '32-card-engine.js': 'CardEngine', '44-tela-cards.js': 'CardsScreen', '44-anki-parity.js': 'AnkiParity' };

export function criarAmbiente(opts = {}) {
  const estado = {
    now: opts.now != null ? opts.now : Date.parse('2026-09-21T09:00:00Z'),
    rolloverHour: opts.rolloverHour != null ? opts.rolloverHour : 4,
    quotaBytes: opts.quotaBytes || Infinity,
    bytes: 0,
    escritas: 0,
    bytesEscritos: 0,
    toasts: [],
    downloads: []
  };
  const store = new Map();
  const tamanho = () => { let n = 0; for (const [k, v] of store) n += k.length + v.length; return n; };

  const localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => {
      const key = String(k), val = String(v);
      estado.escritas++; estado.bytesEscritos += val.length;
      const projetado = tamanho() - (store.has(key) ? key.length + store.get(key).length : 0) + key.length + val.length;
      if (projetado > estado.quotaBytes) {
        const err = new Error('QuotaExceededError: ' + projetado + ' > ' + estado.quotaBytes);
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(key, val);
      estado.bytes = projetado;
    },
    removeItem: (k) => { store.delete(String(k)); estado.bytes = tamanho(); },
    key: (i) => Array.from(store.keys())[i] || null,
    clear: () => { store.clear(); estado.bytes = 0; },
    get length() { return store.size; }
  };

  class Relogio extends Date {
    constructor(...a) { super(...(a.length ? a : [estado.now])); }
    static now() { return estado.now; }
  }

  // Mesma definição do app: o dia do card vira às rolloverHour horas locais.
  const diaDe = (ms) => {
    const d = new Date(ms - estado.rolloverHour * 3600e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const todayCards = () => diaDe(estado.now);
  const proximaViradaTs = () => {
    const base = new Date(estado.now - estado.rolloverHour * 3600e3);
    base.setHours(0, 0, 0, 0);
    return base.getTime() + estado.rolloverHour * 3600e3 + 86400e3;
  };

  const elemento = () => {
    const el = {
      value: '', textContent: '', innerHTML: '', disabled: false, dataset: {},
      style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {},
      querySelectorAll: () => [], querySelector: () => null, appendChild() {}, focus() {}
    };
    return el;
  };
  const doc = {
    body: { classList: { add() {}, remove() {}, contains: () => false } },
    getElementById: () => elemento(),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => elemento()
  };

  const ctx = {
    console,
    Math, JSON, Object, Array, Number, String, Boolean, Set, Map, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, performance,
    Date: Relogio,
    localStorage,
    window: { localStorage },
    document: doc,
    navigator: { userAgent: 'audit/2', language: 'pt-BR', onLine: true },
    Intl,
    $id: () => elemento(),
    _quiet: () => {},
    _sanCard: (x) => String(x == null ? '' : x),
    sanitizeHtml: (x) => String(x == null ? '' : x),
    jsonSeguro: (t) => JSON.parse(t),
    showToast: (m) => { estado.toasts.push(String(m)); },
    todayCards, todayLocal: todayCards, proximaViradaTs,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    UI: { prompt: () => Promise.resolve(null), confirm: () => Promise.resolve(false) }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const arq of MODULOS) {
    const src = fs.readFileSync(new URL('src/js/' + arq, ROOT), 'utf8');
    vm.runInContext(src + '\n;globalThis.' + NOMES[arq] + ' = ' + NOMES[arq] + ';', ctx, { filename: arq });
  }

  const api = {
    ctx, estado, store, localStorage,
    DB: ctx.DB, FSRS: ctx.FSRS, CardsConfig: ctx.CardsConfig, CardEngine: ctx.CardEngine, CardsScreen: ctx.CardsScreen, AnkiParity: ctx.AnkiParity,
    hoje: todayCards,
    // Relógio do harness. Os testes NUNCA devem usar o Date.now() do Node:
    // ele não é o relógio que os módulos enxergam.
    agora: () => estado.now,
    avancar(ms) { estado.now += ms; ctx.CardEngine.invalidateDueCache(); },
    irPara(ms) { estado.now = ms; ctx.CardEngine.invalidateDueCache(); },
    bytes: () => tamanho(),
    // Zera TUDO: armazenamento, caches de config e estado de sessão da tela.
    reset(cfg) {
      store.clear(); estado.bytes = 0; estado.toasts.length = 0; estado.downloads.length = 0;
      estado.escritas = 0; estado.bytesEscritos = 0;
      // Equivale a recarregar a página: o histórico vive em RAM e não pode
      // atravessar um reset de armazenamento.
      try { ctx.DB.invalidarRevlogMemoria(); } catch (_) { /* versões antigas */ }
      const C = ctx.CardsConfig;
      C._c = null; C._cKey = null; C._presets = null; C._pKey = null;
      ctx.CardEngine.invalidateDueCache();
      const S = ctx.CardsScreen;
      S.filters = {}; S._reviewQueue = []; S._reviewIdx = 0; S._undoStack = [];
      S._seenThisSession = new Set(); S._queueMeta = null; S._importParsed = null;
      S.currentFilteredCards = () => ctx.DB.getCards();
      if (cfg) C.set(Object.assign({}, C.DEFAULTS, cfg));
      return api;
    }
  };
  // Dublês do que não existe fora do navegador.
  ctx.CardsScreen.render = () => {};
  ctx.CardsScreen.renderContent = () => {};
  ctx.CardsScreen.renderReviewCard = () => {};
  ctx.CardsScreen.atualizarFoco = () => {};
  ctx.CardsScreen.updateFavCount = () => {};
  ctx.CardsScreen.currentFilteredCards = () => ctx.DB.getCards();
  ctx.CardsScreen._download = (file, content, mime) => { estado.downloads.push({ file, content, mime }); };
  return api;
}

// ── Relatório de verificações ────────────────────────────────────────────────
export function criarRelatorio(escopo) {
  const itens = [];
  const api = {
    escopo,
    check(id, nome, ok, detalhe) { itens.push({ id, nome, pass: !!ok, detalhe }); return !!ok; },
    itens,
    falhas: () => itens.filter((t) => !t.pass),
    imprimir() {
      for (const t of itens) console.log((t.pass ? 'PASSOU  ' : 'FALHOU  ') + t.id + '  ' + t.nome);
      const f = api.falhas();
      console.log(`\n${itens.length} verificações · ${itens.length - f.length} passaram · ${f.length} falharam`);
      for (const t of f) console.log('  ✗ ' + t.id + ' → ' + JSON.stringify(t.detalhe));
      return f.length;
    },
    gravar(url) {
      fs.writeFileSync(url, JSON.stringify({ escopo, geradoEm: new Date().toISOString(), total: itens.length, falhas: api.falhas().length, itens }, null, 2));
    }
  };
  return api;
}
