import { readFileSync } from 'node:fs'; import vm from 'node:vm';
const [,, raiz, jsonF, replayF] = process.argv;
const ctx = { console, Math, Date, Array, Object, JSON, isFinite, parseInt, parseFloat, Number, String, Set, Map, window: {}, _quiet: () => {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(raiz + '/src/js/30-fsrs.js', 'utf8') + '\n;globalThis.__F = FSRS;', ctx);
const F = ctx.__F, d = JSON.parse(readFileSync(jsonF, 'utf8')), X = JSON.parse(readFileSync(replayF, 'utf8'));
const by = {}; d.rawReviewLog.forEach(r => (by[r.cardId] = by[r.cardId] || []).push(r));
let ok = 0, bad = [];
for (const c of X) {
  const post = c.steps[c.steps.length - 1].anki_post, m = F.recomputarMemoria(by[c.cardId], F.DEFAULT_W);
  const dS = Math.abs(m.s - post.s) / post.s, dD = Math.abs(m.d - post.d);
  if (dS < 1e-3 && dD < 2e-3) ok++; else bad.push([c.cardId.slice(0, 8), m.s, post.s, m.d, post.d]);
}
console.log('recomputarMemoria = Anki oficial:', ok + '/' + X.length, bad);
