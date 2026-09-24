/* Reproduz no módulo Cards (CardsScreen.buildQueue) as coleções de fila_oficial.py
   e compara a fila do dia com a do anki==26.09.2, posição a posição. */
import { readFileSync } from 'node:fs';
import { criarAmbiente } from '../cards-20260921-v2/harness.mjs';
const dados = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const a = criarAmbiente({ now: Date.now() });
let ok = 0, total = 0, enterroOk = 0, enterroTot = 0;
for (const [nome, cen] of Object.entries(dados)) {
  a.reset(Object.assign({ algo: 'fsrs', retention: 0.9, loadBalance: false, learnSteps: [1, 10], relearnSteps: [10] }, cen.op));
  const { DB, CardEngine, CardsScreen } = a, HOJE = a.hoje(), add = (n) => CardEngine.addDays(HOJE, n);
  DB.saveDecks([{ id: '1', nome: 'Default', createdAt: '2026-01-01T00:00:00Z' }]);
  const cards = cen.cards.map(c => {
    const base = { id: 'c' + c.id, ankiId: c.id, ankiMod: c.mod, noteId: 'n' + c.nid, ankiNoteId: c.nid, ankiTemplateOrd: c.ord,
      template: c.ord ? 'reverse' : 'forward', deckId: '1', reps: c.reps, lapses: 0, ease: (c.factor || 2500) / 1000,
      createdAt: new Date(c.id).toISOString(), updatedAt: new Date(c.mod * 1000).toISOString(), frente: 'q', verso: 'a', status: 'pendente' };
    if (c.queue === 0) return Object.assign(base, { phase: 'new', posicaoNova: c.due, due: HOJE, dueTs: null, intervalo: 0, s: null, d: null });
    if (c.queue === 2) return Object.assign(base, { phase: 'review', due: add(c.due - cen.today), dueTs: null, intervalo: c.ivl, s: c.s, d: c.d,
      lastReview: add(-Math.round((Date.now() / 1000 - c.lastReview) / 86400)), lastReviewTs: c.lastReview * 1000 });
    if (c.queue === 3) return Object.assign(base, { phase: 'learning', learnStep: 1, due: add(c.due - cen.today), dueTs: null, intervalo: 0, s: c.s, d: c.d, lastReview: add(-2) });
    return Object.assign(base, { phase: 'learning', learnStep: 1, due: HOJE, dueTs: c.due * 1000, intervalo: 0, s: c.s, d: c.d, lastReview: HOJE });
  });
  DB.saveCards(cards);
  // Semente diária das ordens aleatórias = dias desde a criação da coleção.
  // O Study não é uma coleção do Anki; alinhamos a semente para comparar o ALGORITMO.
  a.AnkiParity.daysElapsed = () => cen.today;
  CardsScreen.filters = { materias: new Set(['deck:1']) };
  const fila = Array.from(CardsScreen.buildQueue()).map(id => Number(String(id).slice(1)));
  const tipo = new Map(cen.cards.map(c => [c.id, ['N', 'L', 'R', 'D'][c.queue] || '?']));
  if ((cen.enterro || []).length) {
    let ok = 0;
    for (const e of cen.enterro) {
      const card = DB.getCard('c' + e.respondido);
      const enterrados = a.AnkiParity.autoBurySiblings(card) || [];
      const app = enterrados.map(String).includes('c' + e.irmao);
      if (app === e.enterrado) ok++; else console.log('   enterro diverge', e, 'app', app, DB.getCard('c' + e.irmao).phase);
    }
    console.log(`   enterro após responder: ${ok}/${cen.enterro.length} iguais ao Anki`);
    enterroOk += ok; enterroTot += cen.enterro.length;
  }
  let iguais = 0; for (let i = 0; i < Math.max(fila.length, cen.fila.length); i++) if (fila[i] === cen.fila[i]) iguais++;
  const conj = fila.length === cen.fila.length && fila.every(x => cen.fila.includes(x));
  total++; if (iguais === cen.fila.length && fila.length === cen.fila.length) ok++;
  console.log(`${nome.padEnd(28)} anki=${cen.fila.length} app=${fila.length} mesmo_conjunto=${conj} mesma_posicao=${iguais}/${cen.fila.length}`);
  if (!conj && process.env.DET) {
    const so = (x, y) => x.filter(v => !y.includes(v)).map(v => tipo.get(v) + ':' + JSON.stringify(cen.cards.find(c => c.id === v)));
    console.log('   só anki:', so(cen.fila, fila).join(' | ')); console.log('   só app :', so(fila, cen.fila).join(' | '));
  }
  if (iguais !== cen.fila.length && process.env.DET) {
    console.log('   anki:', cen.fila.map(x => tipo.get(x)).join(''));
    console.log('   app :', fila.map(x => tipo.get(x)).join(''));
  }
}
console.log(`\nFILA: ${ok}/${total} cenários idênticos ao Anki 26.09.2; enterro após responder ${enterroOk}/${enterroTot}`);
