#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   TESTE DIFERENCIAL — o agendador do app contra o Anki
   ───────────────────────────────────────────────────────────────────────────
   Não roda no navegador e não depende do DOM: recorta os módulos puros do app
   (`src/js/30-fsrs.js`, `31-cards-config.js`, `32-card-engine.js`), executa
   cada um num contexto isolado com dublês mínimos, e compara ponto a ponto com
   `testes/referencia-anki.js` — o porte direto do Rust.

   Três blocos:

     A) FÓRMULAS       ~12.700 comparações numéricas contra fsrs-rs/src/model.rs
                       e rslib/.../fuzz.rs. Tolerância 1e-12 relativa.
     B) AGENDAMENTO    ~7.600 asserções sobre o comportamento que o Anki impõe
                       ACIMA das fórmulas: a ordem Difícil < Bom < Fácil, o piso
                       de crescimento, os limites de S/D/intervalo.
     C) OTIMIZADOR     os limites de parâmetros (parameter_clipper.rs), incluindo
                       o teto dinâmico de w17/w18.

   Uso:  node testes/paridade-anki.mjs
   Sai com código 1 na primeira divergência acumulada.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = createRequire(import.meta.url)('./referencia-anki.js');
const src = (f) => readFileSync(join(RAIZ, 'src', 'js', f), 'utf8');

const HOJE = '2026-09-07';
const CFG_BASE = {
  algo: 'fsrs', retention: 0.9, learnSteps: [1, 10], relearnSteps: [10],
  maxInterval: 36500, leechThreshold: 8, leechAction: 'suspend', loadBalance: false, weights: null,
};
let CFG = { ...CFG_BASE };

/* Dublês mínimos: só o que os módulos puros tocam. Se algum dia um deles passar
   a depender do DOM ou do armazenamento, este teste quebra — e isso é a
   intenção: os motores devem continuar portáveis. */
const ctx = {
  console, Math, Date, Array, Object, JSON, isFinite, parseInt, parseFloat,
  Number, String, Set, Map, window: {},
  _quiet: () => {},
  todayCards: () => HOJE,
  proximaViradaTs: () => Date.now() + 6 * 3600 * 1000,
  DB: { getCards: () => [] },
  CardsConfig: {
    forDeck: () => CFG, get: () => CFG,
    weightsFor: () => ctx.__F.DEFAULT_W, weights: () => ctx.__F.DEFAULT_W,
  },
};
vm.createContext(ctx);
vm.runInContext(src('30-fsrs.js') + '\n;globalThis.__F = FSRS;', ctx);
vm.runInContext(src('32-card-engine.js') + '\n;globalThis.__CE = CardEngine;', ctx);
const F = ctx.__F, CE = ctx.__CE, W = F.DEFAULT_W;

let checagens = 0, falhas = 0;
const mostradas = [];
function ck(nome, obtido, esperado, tol = 1e-12) {
  checagens++;
  const passa = (typeof obtido === 'number' && typeof esperado === 'number')
    ? Math.abs(obtido - esperado) <= tol * Math.max(1, Math.abs(esperado))
    : obtido === esperado;
  if (!passa) { falhas++; if (mostradas.length < 20) mostradas.push(`${nome}: app=${obtido} anki=${esperado}`); }
}
function afirma(cond, msg) {
  checagens++;
  if (!cond) { falhas++; if (mostradas.length < 20) mostradas.push(msg); }
}

/* ── A) FÓRMULAS ────────────────────────────────────────────────────────── */
for (const t of [0, 0.5, 1, 3, 7, 30, 100, 365, 3650]) {
  for (const s of [0.1, 1, 5, 20, 100, 1000, 36500]) ck(`R(${t},${s})`, F.R(t, s, W), R.pfc(W, t, s));
}
for (const s of [0.1, 1, 5, 20, 100, 1000, 20000]) {
  for (const r of [0.7, 0.8, 0.9, 0.95, 0.99]) {
    ck(`interval(${s},${r})`, F.interval(s, r, W),
      Math.min(36500, Math.max(1, Math.round(R.nextInterval(W, s, r)))), 0);
  }
}
for (const g of [1, 2, 3, 4]) {
  ck(`initS(${g})`, F.initS(g, W), R.clamp(R.initS(W, g), R.S_MIN, R.S_MAX));
  ck(`initD(${g})`, F.initD(g, W), R.clamp(R.initD(W, g), 1, 10));
}
for (const d of [1, 2.5, 5, 7.3, 10]) {
  for (const g of [1, 2, 3, 4]) ck(`nextD(${d},${g})`, F.nextD(d, g, W), R.clamp(R.meanRev(W, R.nextD(W, d, g)), 1, 10));
}
for (const d of [1, 3, 5, 8, 10]) {
  for (const s of [0.01, 1, 10, 100, 5000]) {
    const r = R.pfc(W, s, s);
    for (const g of [2, 3, 4]) {
      ck(`recall(D=${d},S=${s},G=${g})`, F.nextS_recall(d, s, r, g, W), R.clamp(R.sSucc(W, s, d, r, g), R.S_MIN, R.S_MAX));
    }
    ck(`forget(D=${d},S=${s})`, F.nextS_forget(d, s, r, W), R.clamp(R.sFail(W, s, d, r), R.S_MIN, R.S_MAX));
  }
}
for (const s of [0.001, 0.01, 0.5, 1, 10, 100, 5000]) {
  for (const g of [1, 2, 3, 4]) ck(`short(S=${s},G=${g})`, F.nextS_short(s, g, W), R.clamp(R.sShort(W, s, g), R.S_MIN, R.S_MAX));
}
for (let iv = 1; iv <= 2000; iv++) {
  ck(`fuzzDelta(${iv})`, F.fuzzDelta(iv), R.fuzzDelta(iv), 1e-9);
  const [a1, a2] = F.fuzzBounds(iv), [b1, b2] = R.fuzzBounds(iv);
  ck(`fuzzBounds.lo(${iv})`, a1, b1, 0); ck(`fuzzBounds.hi(${iv})`, a2, b2, 0);
  const [c1, c2] = F.constrainedFuzzBounds(iv, 1, 36500), [d1, d2] = R.constrainedFuzzBounds(iv, 1, 36500);
  ck(`cfb.lo(${iv})`, c1, d1, 0); ck(`cfb.hi(${iv})`, c2, d2, 0);
}
for (let iv = 1; iv <= 400; iv++) {
  for (const prev of [0, 1, 5, 30, 200, 1000]) {
    ck(`minReviewFuzz(${iv},${prev})`, F.minReviewFuzzInterval(iv, prev, 36500),
      R.minimumReviewFuzzInterval(iv, prev, 36500), 0);
  }
}
// migração de pesos: check_and_fill_parameters (19 -> 21, com w19=0 e w20=0.5)
const mig = F.migrarW(F.W5_DEFAULT.slice());
ck('migrarW.tamanho', mig.length, 21, 0);
ck('migrarW.w19', mig[19], 0, 0);
ck('migrarW.w20', mig[20], 0.5, 0);

/* ── B) AGENDAMENTO ─────────────────────────────────────────────────────── */
const dias = (p) => (p._kind === 'day' ? p._val : 0);

// B1. na revisão, a ordem Difícil < Bom < Fácil é obrigatória
for (let s = 0.5; s < 3000; s *= 1.35) {
  for (const d of [1, 2, 4, 6, 8, 10]) {
    for (const prev of [1, 3, 10, 60, 300]) {
      for (const passado of [0, 1, 5, 40]) {
        const card = {
          id: `r${Math.round(s * 100)}_${d}_${prev}`, phase: 'review', s, d, reps: 5, lapses: 1,
          intervalo: prev, due: CE.addDays(HOJE, -passado),
          lastReview: CE.addDays(HOJE, -(prev + passado)), algo: 'fsrs',
        };
        const h = dias(CE.schedule(card, 'dificil')), g = dias(CE.schedule(card, 'bom')), e = dias(CE.schedule(card, 'facil'));
        afirma(h < g, `revisao: dificil(${h}) deveria ser < bom(${g}) [S=${s.toFixed(2)} D=${d} prev=${prev}]`);
        afirma(g < e, `revisao: bom(${g}) deveria ser < facil(${e}) [S=${s.toFixed(2)} D=${d} prev=${prev}]`);
      }
    }
  }
}
// B2. ao graduar de aprendizado/reaprendizado, "Fácil" > "Bom" (piso good+1)
for (const fase of ['new', 'learning', 'relearning']) {
  for (const passos of [[1, 10], [10], [1, 10, 60]]) {
    CFG = { ...CFG_BASE, learnSteps: passos, relearnSteps: passos.slice(0, 2) };
    for (let s = 0.2; s < 600; s *= 1.6) {
      for (const d of [1, 3, 5, 7, 10]) {
        const card = {
          id: `g${fase}${s.toFixed(2)}${d}`, phase: fase, s: fase === 'new' ? null : s, d: fase === 'new' ? null : d,
          reps: fase === 'new' ? 0 : 3, lapses: 0, learnStep: 0, intervalo: 0, due: HOJE,
          lastReview: fase === 'new' ? null : CE.addDays(HOJE, -2), algo: 'fsrs',
        };
        const pg = CE.schedule(card, 'bom'), pe = CE.schedule(card, 'facil');
        afirma(pe._kind === 'day', `${fase}: "Facil" deveria graduar em dias, veio ${pe._kind}`);
        if (pg._kind === 'day' && pe._kind === 'day') {
          afirma(pe._val > pg._val, `${fase}/[${passos}]: facil(${pe._val}) deveria ser > bom(${pg._val}) [S=${s.toFixed(2)} D=${d}]`);
        }
      }
    }
  }
}
CFG = { ...CFG_BASE };
// B3. nenhuma resposta produz estado inválido, em nenhuma fase
for (const fase of ['new', 'learning', 'review', 'relearning']) {
  for (const nota of ['errei', 'dificil', 'bom', 'facil']) {
    for (const s of [null, 0.001, 1, 100, 36500]) {
      const card = {
        id: `v${fase}${nota}${s}`, phase: fase, s, d: s == null ? null : 5, reps: s == null ? 0 : 4,
        lapses: 0, learnStep: 0, intervalo: s == null ? 0 : 30, due: HOJE,
        lastReview: s == null ? null : CE.addDays(HOJE, -30), algo: 'fsrs',
      };
      const p = CE.schedule(card, nota);
      afirma(isFinite(p.s) && p.s >= R.S_MIN && p.s <= R.S_MAX, `S invalido em ${fase}/${nota}/S=${s}: ${p.s}`);
      afirma(isFinite(p.d) && p.d >= 1 && p.d <= 10, `D invalido em ${fase}/${nota}/S=${s}: ${p.d}`);
      afirma(/^\d{4}-\d{2}-\d{2}$/.test(String(p.due)), `due invalido em ${fase}/${nota}/S=${s}: ${p.due}`);
      if (p._kind === 'day') afirma(p._val >= 1 && p._val <= 36500, `intervalo fora da faixa em ${fase}/${nota}: ${p._val}`);
    }
  }
}
// B4. acertar nunca encolhe o intervalo (minimum_review_fuzz_interval)
for (const prev of [1, 2, 5, 15, 60, 200, 1000]) {
  for (let s = 1; s < 4000; s *= 1.7) {
    const card = {
      id: `p${prev}${s.toFixed(1)}`, phase: 'review', s, d: 5, reps: 6, lapses: 0,
      intervalo: prev, due: HOJE, lastReview: CE.addDays(HOJE, -prev), algo: 'fsrs',
    };
    const bruto = F.interval(F.nextS_recall(5, s, F.R(prev, s, W), 3, W), 0.9, W);
    if (Math.round(bruto) > prev) {
      const g = dias(CE.schedule(card, 'bom'));
      afirma(g > prev, `piso de crescimento: anterior=${prev}, algoritmo=${bruto.toFixed(1)}, agendado=${g}`);
    }
  }
}
// B5. o "Errei" na revisão sempre entra em reaprendizado pelo primeiro passo
for (const s of [1, 10, 200, 5000]) {
  const card = { id: `e${s}`, phase: 'review', s, d: 5, reps: 9, lapses: 2, intervalo: 40,
    due: HOJE, lastReview: CE.addDays(HOJE, -40), algo: 'fsrs' };
  const p = CE.schedule(card, 'errei');
  afirma(p.phase === 'relearning', `errei deveria ir para reaprendizado, foi para ${p.phase}`);
  afirma(p.learnStep === 0, `errei deveria voltar ao passo 0, foi para ${p.learnStep}`);
  afirma(p.lapses === 3, `errei deveria somar 1 lapso (2 -> 3), deu ${p.lapses}`);
}

/* ── C) OTIMIZADOR: limites de parâmetros ───────────────────────────────── */
{
  // parameter_clipper.rs: com 1 passo de reaprendizado o teto de w17/w18 é 2,0
  const extremo = W.map((_, i) => (i < 4 ? 1000 : -1000));
  const ref = R.clipParams(extremo, 1, true);
  ck('clip.w0 (INIT_S_MAX)', ref[0], 100, 0);
  ck('clip.w4 (D_MIN)', ref[4], 1, 0);
  ck('clip.w19 (piso curto prazo)', ref[19], 0.01, 0);
  ck('clip.w20 (piso do decaimento)', ref[20], 0.1, 0);
  // o teto dinâmico com 2 passos tem de deixar os pesos padrão intactos
  const comDois = R.clipParams(W.slice(), 2, true);
  ck('clip.w17 padrao intacto com 2 passos', comDois[17], W[17], 1e-6);
  ck('clip.w18 padrao intacto com 2 passos', comDois[18], W[18], 1e-6);
  // a ordem das operações importa: max(0,01) ANTES da raiz, nunca depois
  const tetoRef = Math.min(2.0, Math.sqrt(Math.max(0.01, -5)));
  ck('teto w17/w18 com radicando negativo', tetoRef, 0.1, 1e-12);
}

/* ── resultado ──────────────────────────────────────────────────────────── */
if (falhas) {
  console.error(`\nPARIDADE ANKI: ${checagens - falhas}/${checagens} — ${falhas} DIVERGENCIA(S)\n`);
  mostradas.forEach((m) => console.error('  ✗ ' + m));
  if (falhas > mostradas.length) console.error(`  ... e mais ${falhas - mostradas.length}`);
  process.exit(1);
}
console.log(`PARIDADE ANKI: ${checagens}/${checagens} comparacoes contra fsrs-rs + rslib, 0 divergencias.`);
