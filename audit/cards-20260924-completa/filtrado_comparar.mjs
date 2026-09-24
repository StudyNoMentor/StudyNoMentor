/* Mesmas coleções de filtrado_oficial.py no Cards (AnkiParity.rebuildFilteredDeck). */
import { readFileSync } from 'node:fs';
import { criarAmbiente } from '../cards-20260921-v2/harness.mjs';
const dados = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let ok = 0, total = 0;
for (const [nome, cen] of Object.entries(dados)) {
  const a = criarAmbiente({ now: cen.agora * 1000 });
  a.reset({ algo: 'fsrs', retention: 0.9, learnSteps: [1, 10], relearnSteps: [10] });
  const { DB, CardEngine, AnkiParity } = a, HOJE = a.hoje(), add = n => CardEngine.addDays(HOJE, n);
  DB.saveDecks([{ id: '1', nome: 'Default', createdAt: '2026-01-01T00:00:00Z' }]);
  DB.saveCards(cen.cards.map(c => {
    const b = { id: 'c' + c.id, ankiId: c.id, ankiMod: c.mod, noteId: 'n' + c.nid, ankiNoteId: c.nid, ankiTemplateOrd: c.ord, deckId: '1',
      reps: c.reps, lapses: c.lapses, ease: 2.5, createdAt: new Date(c.id).toISOString(), updatedAt: new Date(c.mod * 1000).toISOString(), frente: 'q', verso: 'a' };
    if (c.queue === 0) return Object.assign(b, { phase: 'new', posicaoNova: c.due, due: HOJE, dueTs: null, intervalo: 0, s: null, d: null });
    if (c.queue === 1) return Object.assign(b, { phase: 'learning', learnStep: 1, due: HOJE, dueTs: c.due * 1000, intervalo: 0, s: c.s, d: c.d, lastReviewTs: c.lastReview * 1000 });
    return Object.assign(b, { phase: 'review', due: add(c.due - cen.today), dueTs: null, intervalo: c.ivl, s: c.s, d: c.d,
      lastReview: add(-Math.round((cen.agora - c.lastReview) / 86400)), lastReviewTs: c.lastReview * 1000 });
  }));
  DB.replaceRevlog(cen.revlog.map(([id, cid]) => ({ reviewId: 'r' + id, cardId: 'c' + cid, ts: id, grade: 3, phase: 'review' })));
  AnkiParity.daysElapsed = () => cen.today;
  const r = AnkiParity.saveFilteredDeck({ nome: 'F', config: { reschedule: true, searchTerms: cen.termos.map(([search, limit, order]) => ({ search, limit, order })) }, allowEmpty: true });
  const todos = DB.getCards().filter(c => c.filteredDeckId).sort((x, y) => x.filteredPosition - y.filteredPosition);
  const sel = todos.filter(c => !c.originalDueTs).map(c => c.ankiId), aprend = todos.filter(c => c.originalDueTs).map(c => c.ankiId).sort();
  const igual = sel.length === cen.selecionados.length && sel.every((x, i) => x === cen.selecionados[i])
    && JSON.stringify(aprend) === JSON.stringify(cen.aprendizado.slice().sort());
  total++; if (igual) ok++;
  console.log(`${nome.padEnd(26)} anki=${cen.selecionados.length} app=${sel.length} ${igual ? 'idêntico' : 'DIVERGE'}`);
  if (!igual && process.env.DET2) console.log('  app ivl', todos.map(c => String(c.ankiId).slice(-3) + ':' + c.intervalo + ':' + c.originalPhase).join(' '));
  if (!igual && process.env.DET) { console.log('  anki', cen.selecionados.map(x => String(x).slice(-3)).join(',')); console.log('  app ', sel.map(x => String(x).slice(-3)).join(',')); }
}
console.log(`\nFILTRADO: ${ok}/${total} baralhos idênticos ao Anki 26.09.2 (conjunto e ordem)`);
