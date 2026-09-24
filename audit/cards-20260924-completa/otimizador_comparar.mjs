/* Mesmo histórico de otimizador_oficial.py no pipeline do Cards
   (AnkiParity.fsrsTrainingData → WASM fsrs-rs 6.6.2) e comparação dos 21
   parâmetros com os do anki==26.09.2. */
import { readFileSync } from 'node:fs';
import { criarAmbiente } from '../cards-20260921-v2/harness.mjs';
const O = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const ROOT = new URL('../../', import.meta.url).pathname;
const mod = await import(ROOT + 'src/vendor/fsrs-6.6.2/fsrs_optimizer.js');
mod.initSync({ module: readFileSync(ROOT + 'src/vendor/fsrs-6.6.2/fsrs_optimizer_bg.wasm') });
const a = criarAmbiente({ now: (O.nextDayAt - 3600) * 1000 });
a.reset({ algo: 'fsrs', learnSteps: [10, 10], relearnSteps: [10] });
const KIND = { 0: 'learning', 1: 'review', 2: 'relearning', 3: 'filtered', 4: 'manual' };
const revlog = O.revlog.map(([id, cid, ease, ivl, lastIvl, factor, time, type]) => ({
  reviewId: 'r' + id, cardId: 'c' + cid, ts: id, grade: ease, phase: KIND[type], ankiReviewKind: String(type) === '3' ? 'filtered' : undefined,
  ankiInterval: ivl, ankiLastInterval: lastIvl, easeFactor: factor, time }));
const cards = O.cards.map(cid => ({ id: 'c' + cid, ankiId: cid, deckId: null, phase: 'review' }));
const data = a.AnkiParity.fsrsTrainingData(revlog, { cards, nextDayAtSec: O.nextDayAt, ignoreBeforeMs: 0 });
let t = Date.now();
const out = JSON.parse(mod.optimize_json(JSON.stringify({ items: data.items, card_ids: data.cardIds, current_params: [], num_relearning_steps: 1 })));
const ms = Date.now() - t;
const dif = out.params.map((x, i) => Math.abs(x - O.params[i]));
console.log('itens app', data.items.length, 'anki', O.fsrs_items, '| otimizar', ms, 'ms');
console.log('app :', out.params.map(x => x.toFixed(4)).join(','));
console.log('anki:', O.params.map(x => x.toFixed(4)).join(','));
console.log('OTIMIZADOR: maior diferença', Math.max(...dif).toExponential(2), dif.every(d => d < 1e-4) ? '→ IDÊNTICO' : '→ DIVERGE');
if (process.env.SAUDE) {
  t = Date.now();
  const hc = JSON.parse(mod.health_check_json(JSON.stringify({ items: data.items, card_ids: data.cardIds, num_relearning_steps: 1 })));
  console.log('SAÚDE:', JSON.stringify(hc), Date.now() - t, 'ms | anki', O.health, JSON.stringify(O.avaliacao));
  const dl = Math.abs(hc.log_loss - O.avaliacao.log_loss), dr = Math.abs(hc.rmse_bins - O.avaliacao.rmse_bins);
  console.log('SAÚDE vs Anki: veredito', hc.passed === O.health ? 'igual' : 'DIFERENTE', '| Δlog_loss', dl.toExponential(2), '| Δrmse', dr.toExponential(2));
}
