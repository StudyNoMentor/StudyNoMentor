/* Gera estados aleatórios e as respostas do agendador do módulo Cards
   (CardEngine.schedule) para os 4 botões. O oráculo (oficial.py) aplica os
   MESMOS estados no anki==26.09.2 e comparar.py confronta botão a botão.
   A identidade Anki do card (ankiId) é a mesma dos dois lados, então o fuzz
   (StdRng semeado por id+reps) tem de coincidir EXATAMENTE. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = f => readFileSync(join(RAIZ, 'src', 'js', f), 'utf8');
// Dia de estudo e próxima virada iguais aos do Anki (rode com TZ=America/Fortaleza).
const virada = new Date(); virada.setHours(4, 0, 0, 0); if (virada.getTime() <= Date.now()) virada.setDate(virada.getDate() + 1);
const VIRADA_TS = virada.getTime();
const HOJE = (() => { const d = new Date(VIRADA_TS - 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
let FUNDO = [];
let CFG = null;
const mem = new Map();
const ctx = {
  console, Math, Date, Array, Object, JSON, isFinite, parseInt, parseFloat, Number, String, Set, Map, BigInt,
  window: {}, _quiet: () => {}, todayCards: () => HOJE, proximaViradaTs: () => VIRADA_TS,
  localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) },
  DB: { getCards: () => FUNDO, getDecks: () => [], getRevlog: () => [], _profilePrefix: () => 'x:' },
  CardsConfig: { DEFAULTS: {}, forDeck: () => CFG, get: () => CFG, weightsFor: () => ctx.__F.DEFAULT_W, weights: () => ctx.__F.DEFAULT_W },
};
vm.createContext(ctx);
vm.runInContext(src('30-fsrs.js') + '\n;globalThis.__F = FSRS;', ctx);
vm.runInContext(src('32-card-engine.js') + '\n;globalThis.__CE = CardEngine;', ctx);
vm.runInContext(src('44-anki-parity.js') + '\n;globalThis.AnkiParity = AnkiParity;', ctx);
const CE = ctx.__CE;

const BASE = { retention: 0.9, maxInterval: 36500, leechThreshold: 8, leechAction: 'tag', loadBalance: false, weights: null,
  easyDays: [1,1,1,1,1,1,1], initialEase: 2.5, hardMultiplier: 1.2, easyMultiplier: 1.3, lapseMultiplier: 0,
  intervalMultiplier: 1, minimumLapseInterval: 1, graduatingIntervalGood: 1, graduatingIntervalEasy: 4, historicalRetention: 0.9 };
const CONFIGS = {
  fsrs_padrao: { algo: 'fsrs', learnSteps: [1, 10], relearnSteps: [10] },
  fsrs_um_passo: { algo: 'fsrs', learnSteps: [10], relearnSteps: [], retention: 0.85, maxInterval: 365 },
  fsrs_sem_passos: { algo: 'fsrs', learnSteps: [], relearnSteps: [10, 1440], retention: 0.95 },
  fsrs_passos_longos: { algo: 'fsrs', learnSteps: [1, 10, 60, 1440], relearnSteps: [5, 30], retention: 0.8, maxInterval: 30 },
  sm2_padrao: { algo: 'sm2', learnSteps: [1, 10], relearnSteps: [10] },
  sm2_custom: { algo: 'sm2', learnSteps: [5], relearnSteps: [], initialEase: 2.3, hardMultiplier: 1.0, easyMultiplier: 1.5,
    lapseMultiplier: 0.5, intervalMultiplier: 1.2, minimumLapseInterval: 2, graduatingIntervalGood: 2, graduatingIntervalEasy: 5, maxInterval: 200 },
  sm2_passos_longos: { algo: 'sm2', learnSteps: [1, 10, 1440], relearnSteps: [10, 60] },
  // Balanceamento de carga ligado (a configuração do usuário), com carga de fundo idêntica nos dois lados.
  fsrs_balanceado: { algo: 'fsrs', learnSteps: [1, 10], relearnSteps: [10], loadBalance: true, fundo: true },
  fsrs_balanceado_easydays: { algo: 'fsrs', learnSteps: [1, 10], relearnSteps: [10], loadBalance: true, fundo: true, easyDays: [0, 1, 1, 0.5, 1, 1, 0.5] },
  sm2_balanceado: { algo: 'sm2', learnSteps: [1, 10], relearnSteps: [10], loadBalance: true, fundo: true },
};
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = a => a[Math.floor(rnd() * a.length)];
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const GR = ['errei', 'dificil', 'bom', 'facil'];
let nextId = 1700000000000;
const out = [];
const N = Number(process.argv[2] || 400);
for (const [nome, extra] of Object.entries(CONFIGS)) {
  CFG = Object.assign({}, BASE, extra);
  const fsrs = CFG.algo === 'fsrs';
  let fundo = [];
  if (CFG.fundo) {
    // 400 cards vencendo nos próximos 95 dias; 10% suspensos e 5% em aprendizado entre dias.
    for (let k = 0; k < 400; k++) {
      const off = Math.floor(Math.pow(rnd(), 1.6) * 96), t = rnd();
      fundo.push({ id: 'f' + k, ankiId: nextId++, deckId: 'd', phase: t < 0.05 ? 'learning' : 'review', suspenso: t >= 0.05 && t < 0.15,
        reps: 3, intervalo: 5, due: addDays(HOJE, off), dueTs: null, offset: off });
    }
  }
  for (let i = 0; i < N; i++) {
    const tipo = pick(['new', 'learning', 'review', 'review', 'review', 'relearning']);
    const steps = tipo === 'relearning' ? CFG.relearnSteps : CFG.learnSteps;
    if ((tipo === 'learning' || tipo === 'relearning') && !steps.length) { i--; continue; }
    const c = { id: 'u' + i, ankiId: nextId++, deckId: 'd', phase: tipo, reps: 0, lapses: 0, learnStep: 0, ease: 2.5, intervalo: 0 };
    let elapsed = 0;
    if (tipo !== 'new') {
      c.reps = 1 + Math.floor(rnd() * 30);
      c.lapses = tipo === 'relearning' ? 1 + Math.floor(rnd() * 9) : tipo === 'learning' ? 0 : Math.floor(rnd() * 6);
      c.ease = fsrs ? 2.5 : Math.round((1.3 + rnd() * 1.9) * 1000) / 1000;
      // Mesmo arredondamento que o Anki aplica ao GRAVAR o estado (S 4 casas, D 3 casas, f32).
      if (fsrs) { c.s = Math.fround(Math.round(Math.exp(Math.log(0.05) + rnd() * (Math.log(400) - Math.log(0.05))) * 1e4) / 1e4); c.d = Math.fround(Math.round((1 + rnd() * 9) * 1e3) / 1e3); }
    }
    if (tipo === 'learning' || tipo === 'relearning') {
      c.learnStep = Math.floor(rnd() * steps.length);
      elapsed = rnd() < 0.8 ? 0 : 1 + Math.floor(rnd() * 3);
      if (tipo === 'relearning') c.intervalo = 1 + Math.floor(rnd() * 60);
      if (fsrs && tipo === 'learning') c.s = Math.min(c.s, 5);
      if (tipo === 'learning') c.ease = 2.5;
    }
    if (tipo === 'review') {
      c.intervalo = Math.max(1, Math.round(fsrs ? c.s * (0.4 + rnd() * 1.4) : Math.exp(rnd() * Math.log(400))));
      c.intervalo = Math.min(c.intervalo, CFG.maxInterval);
      const r = rnd();
      elapsed = r < 0.15 ? Math.floor(rnd() * c.intervalo) : r < 0.6 ? c.intervalo : c.intervalo + Math.floor(rnd() * c.intervalo * 1.5);
      if (rnd() < 0.05) elapsed = 0;
    }
    if (tipo !== 'new') {
      c.lastReview = addDays(HOJE, -elapsed);
      c.due = tipo === 'review' ? addDays(c.lastReview, c.intervalo) : HOJE;
    }
    FUNDO = fundo.concat([c]);
    const resp = {};
    for (const g of GR) {
      const p0 = CE.schedule(Object.assign({}, c), g), p = Object.assign({}, c, p0);
      p._kind = p0._kind; p._val = p0._val;
      resp[g] = { kind: p._kind, val: p._val, phase: p.phase, learnStep: p.learnStep, intervalo: p.intervalo, s: p.s, d: p.d,
        ease: p.ease, lapses: p.lapses, reps: p.reps, leech: !!p.leech, suspenso: !!p.suspenso, due: p.due };
    }
    out.push({ config: nome, cfg: Object.assign({}, CFG, { fundo: i === 0 ? fundo : !!CFG.fundo }), card: c, elapsed, resp });
  }
}
writeFileSync(process.argv[3] || 'estados.json', JSON.stringify(out));
console.log('estados gerados:', out.length);
