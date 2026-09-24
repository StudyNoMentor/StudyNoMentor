/* Repete no módulo Cards, com o relógio do harness, a sessão real de
   sessao_oficial.py e compara a ordem de apresentação card a card. */
import { readFileSync } from 'node:fs';
import { criarAmbiente } from '../cards-20260921-v2/harness.mjs';
import vm from 'node:vm';
const S = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const a = criarAmbiente({ now: Math.round(S.t0 * 1000) });
try {
  const src = readFileSync(new URL('../../src/js/44-anki-max-stats-media.js', import.meta.url), 'utf8');
  if (!a.ctx.queueMicrotask) a.ctx.queueMicrotask = queueMicrotask;
  vm.runInContext(src + '\n;globalThis.AnkiMaxStatsMedia = AnkiMaxStatsMedia;', a.ctx, { filename: 'stats' });
} catch (e) { console.log('(módulo de estatísticas não carregou no harness:', e.message, ')'); }
a.reset({ algo: 'fsrs', retention: 0.9, loadBalance: true, learnSteps: [0.1, 0.2], relearnSteps: [0.1] });
const { DB, CardEngine, CardsScreen } = a, HOJE = a.hoje(), add = n => CardEngine.addDays(HOJE, n);
// Mesma numeração de dias da coleção oficial (sched.today): posições de novos no LoadBalancer.
a.ctx.CardsConfig.set({ ankiCrt: Date.parse(HOJE + 'T00:00:00') / 1000 - S.today * 86400 });
CardsScreen.LEARN_AHEAD_MIN = (S.ahead || 5) / 60;
DB.saveDecks([{ id: '1', nome: 'Default', createdAt: '2026-01-01T00:00:00Z' }]);
DB.saveCards(S.cards.map(c => {
  const base = { id: 'c' + c.id, ankiId: c.id, ankiMod: c.mod, noteId: 'n' + c.nid, ankiNoteId: c.nid, ankiTemplateOrd: c.ord, deckId: '1',
    reps: c.reps, lapses: 0, ease: 2.5, createdAt: new Date(c.id).toISOString(), updatedAt: new Date(c.mod * 1000).toISOString(), frente: 'q', verso: 'a' };
  if (c.queue === 0) return Object.assign(base, { phase: 'new', posicaoNova: c.due, due: HOJE, dueTs: null, intervalo: 0, s: null, d: null });
  return Object.assign(base, { phase: 'review', due: add(c.due - S.today), dueTs: null, intervalo: c.ivl, s: c.s, d: c.d,
    lastReview: add(-c.ivl), lastReviewTs: c.lastReview * 1000 });
}));
CardsScreen.filters = { materias: new Set(['deck:1']) };
CardsScreen._reviewQueue = CardsScreen.buildQueue(); CardsScreen._reviewIdx = 0; CardsScreen._aprendAnki = null;
const G = ['', 'errei', 'dificil', 'bom', 'facil'];
let iguais = 0; const linha = [];
for (const p of S.passos) {
  a.irPara(Math.round((S.t0 + p.t) * 1000));
  // Fila vazia: o temporizador da tela de fim renova o corte (counts() no Anki).
  if (CardsScreen._reviewIdx >= CardsScreen._reviewQueue.length) CardsScreen._ordenarComoAnki(null);
  const atual = CardsScreen._reviewQueue[CardsScreen._reviewIdx];
  const ok = atual === 'c' + p.id; if (ok) iguais++;
  linha.push(ok ? '.' : 'X');
  if (!ok) { console.log("divergiu no passo", linha.length, "anki", p.id, "app", atual, "t", p.t); CardsScreen._reviewQueue.slice(CardsScreen._reviewIdx).forEach(id => { const c = DB.getCard(id); console.log("   ", id, c.phase, c.reps, c.dueTs ? ((c.dueTs - a.agora()) / 1000).toFixed(2) + "s" : c.due); }); console.log("   esperado:", JSON.stringify(DB.getCard("c" + p.id)), "agora", a.agora()); break; }
  a.irPara(Math.round((S.t0 + p.ta) * 1000));
  CardsScreen._flipped = true;
  await CardsScreen.answer(G[p.grade]);
  if (p.desfez) CardsScreen.undoAnswer();
  if (process.env.DBG) console.log('pos', linha.length, 'id', String(p.id).slice(-3), 'g', p.grade, 'fila', CardsScreen._reviewQueue.slice(CardsScreen._reviewIdx).map(x => String(x).slice(-3)).join(','), 'dues', CardsScreen._reviewQueue.slice(CardsScreen._reviewIdx).map(x => { const c = DB.getCard(x); return String(x).slice(-3) + ':' + (c.dueTs ? ((c.dueTs - S.t0 * 1000) / 1000).toFixed(1) : '-') + 'r' + c.reps; }).join(' '));
}
if (S.estat && iguais === S.passos.length) {
  const E = S.estat, M = globalThis.__M || a.ctx.AnkiMaxStats || a.ctx.AnkiMaxParity;
  const T = CardsScreen, per = { today: 1, yesterday: 'ontem', week: 7, month: 30, year: 365, all_time: null };
  const falhas = [];
  // Hoje
  const td = a.ctx.AnkiMaxStatsMedia ? a.ctx.AnkiMaxStatsMedia._todayData() : null;
  if (td) for (const k of Object.keys(E.today)) if (k !== 'answerMillis' && td[k] !== E.today[k]) falhas.push(`hoje.${k}: app=${td[k]} anki=${E.today[k]}`);
  // Contagem de cards (card_counts.rs, excluding_inactive)
  if (a.ctx.AnkiMaxStatsMedia) { const cc = a.ctx.AnkiMaxStatsMedia._cardCountsData(), m = { newCards: 'new', learn: 'learn', relearn: 'relearn', young: 'young', mature: 'mature', suspended: 'suspended', buried: 'buried' };
    for (const [k, v] of Object.entries(E.contagem)) if (cc[m[k]] !== v) falhas.push(`contagem.${k}: app=${cc[m[k]]} anki=${v}`); }
  // Retenção real
  for (const [k, d] of Object.entries(per)) {
    const t = T.trueRetention(d), [yp, yf, mp, mf] = E.retencao[k];
    const app = [t.jovem.acertos, t.jovem.total - t.jovem.acertos, t.maduro.acertos, t.maduro.total - t.maduro.acertos];
    if (JSON.stringify(app) !== JSON.stringify([yp, yf, mp, mf])) falhas.push(`retenção.${k}: app=${app} anki=${[yp, yf, mp, mf]}`);
  }
  // Revlog na semântica do Anki (ease, ivl, lastIvl, type)
  const TIPO = { learning: 0, review: 1, relearning: 2, filtered: 3 };
  const rl = DB.getRevlog().slice().sort((x, y) => x.ts - y.ts);
  const ak = E.revlog;
  let rok = 0;
  ak.forEach((r, i) => { const x = rl[i]; if (!x) return; const app = [x.grade, x.ankiInterval, x.ankiLastInterval, TIPO[x.ankiReviewKind]];
    const anki = [r[2], r[3], r[4], r[6]];
    // O ivl de passos intradiários tem fuzz no due, mas o revlog grava o passo puro nos dois lados.
    if (JSON.stringify(app) === JSON.stringify(anki)) rok++; else if (falhas.length < 12) falhas.push(`revlog#${i}: app=${app} anki=${anki}`); });
  console.log(`ESTATÍSTICAS: hoje/contagem/retenção ${falhas.filter(f => !f.startsWith('revlog')).length ? 'DIVERGEM' : 'idênticos'}; revlog ${rok}/${ak.length} linhas idênticas (ease, ivl, lastIvl, tipo)`);
  falhas.forEach(f => console.log('   ', f));
}
console.log(`SESSÃO${S.passos.some(p => p.desfez) ? ' c/ desfazer (' + S.passos.filter(p => p.desfez).length + ')' : ''}: ${iguais}/${S.passos.length} apresentações na mesma ordem do Anki 26.09.2  ${linha.join('')}`);
