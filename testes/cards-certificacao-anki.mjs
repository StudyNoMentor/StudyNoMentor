import assert from 'node:assert/strict';
import fs from 'node:fs';
import { criarAmbiente } from '../audit/cards-20260921-v2/harness.mjs';

let checks = 0;
const eq = (a, b, m) => { checks++; assert.deepEqual(a, b, m); };
const ok = (v, m) => { checks++; assert.ok(v, m); };
const a = criarAmbiente().reset();
const { DB, CardsConfig, CardEngine, CardsScreen } = a;

// ── 1) Defaults rastreados no backend atual do Anki ─────────────────────────
eq(CardsConfig.DEFAULTS.reviewOrder, 'day', 'review padrão deve ser Due date, then random');
eq(CardsConfig.DEFAULTS.newGatherOrder, 'deck', 'gather padrão deve ser Deck');
eq(CardsConfig.DEFAULTS.newSortOrder, 'template', 'sort padrão deve ser Template');
eq(CardsConfig.DEFAULTS.newMix, 'misturar', 'novos devem misturar com reviews por padrão');
eq(CardsConfig.DEFAULTS.interdayMix, 'misturar', 'interday learning deve misturar por padrão');
eq(CardsConfig.DEFAULTS.leechAction, 'tag', 'leech padrão atual do Anki é Tag Only');
eq(CardsConfig.DEFAULTS.newPerDay, 20, '20 novos/dia é o padrão');
eq(CardsConfig.DEFAULTS.revPerDay, 200, '200 reviews/dia é o padrão');
eq(CardsConfig.DEFAULTS.maxInterval, 36500, 'intervalo máximo padrão deve ser 100 anos');
eq(CardsConfig.DEFAULTS.newCardsIgnoreReviewLimit, false, 'novos não ignoram teto de reviews por padrão');

// ── 2) Chaves realmente globais não podem vazar para presets ────────────────
CardsConfig.set({ algo: 'fsrs', newCardsIgnoreReviewLimit: false });
CardsConfig.setDeckPreset('deck-x', {
  algo: 'sm2',
  retention: 0.95,
  newCardsIgnoreReviewLimit: true
});
eq(CardsConfig.forDeck('deck-x').algo, 'fsrs', 'preset não pode trocar FSRS por SM-2');
eq(CardsConfig.forDeck('deck-x').newCardsIgnoreReviewLimit, false,
  'preset não pode sobrescrever o interruptor global do limite de reviews');
eq(CardsConfig.forDeck('deck-x').retention, 0.95, 'preset continua podendo variar retenção');

// ── 3) SM-2 sem passos: Again não pode virar acerto ─────────────────────────
CardsConfig.set({ algo: 'sm2', learnSteps: [], relearnSteps: [] });
let p = CardEngine.schedule({
  id: 'novo-sem-passos', deckId: null, phase: 'new', reps: 0, lapses: 0, intervalo: 0,
  due: a.hoje(), ease: 2.5
}, 'errei');
eq(p.phase, 'review', 'SM-2 sem learning steps gradua direto');
eq(p.status, 'naosei', 'Again em card novo sem passos continua sendo falha');

p = CardEngine.schedule({
  id: 'relearn-sem-passos', deckId: null, phase: 'relearning', reps: 5, lapses: 1,
  intervalo: 1, due: a.hoje(), ease: 2.3, learnStep: 0
}, 'errei');
eq(p.phase, 'review', 'SM-2 sem relearning steps sai para review');
eq(p.status, 'naosei', 'Again em relearning sem passos continua sendo falha');

// ── 4) Display Order vem do BARALHO SELECIONADO, como no Anki ───────────────
a.reset({ algo: 'fsrs', loadBalance: false, reviewOrder: 'day', newPerDay: 20, revPerDay: 200 });
DB.saveDecks([{ id: 'd1', nome: 'Deck 1', createdAt: '2026-01-01T00:00:00Z' }]);
const hoje = a.hoje();
DB.saveCards([
  {
    id: 'mais-antigo', deckId: 'd1', phase: 'review', status: 'sei', due: CardEngine.addDays(hoje, -2),
    dueTs: null, intervalo: 2, reps: 10, lapses: 0, ease: 2.5, s: 10, d: 5,
    lastReview: CardEngine.addDays(hoje, -4), createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'intervalo-longo', deckId: 'd1', phase: 'review', status: 'sei', due: hoje,
    dueTs: null, intervalo: 100, reps: 10, lapses: 0, ease: 2.5, s: 100, d: 5,
    lastReview: CardEngine.addDays(hoje, -100), createdAt: '2026-01-02T00:00:00Z'
  }
]);
CardsConfig.setDeckPreset('d1', { reviewOrder: 'intervalsDesc' });
CardsScreen.filters = { materias: new Set(['deck:d1']) };
eq(CardsScreen.buildQueue()[0], 'intervalo-longo',
  'ao estudar um deck, a ordem deve vir do preset do deck selecionado');
CardsScreen.filters = { materias: new Set() };
eq(CardsScreen.buildQueue()[0], 'mais-antigo',
  'em Todos, a fila deve voltar à ordem global por vencimento');

// Também a mistura new/review precisa obedecer ao preset do deck selecionado.
// Global "novos antes" x preset "novos depois". (Com "misturar", 1 revisão e
// 1 novo, o Intersperser do Anki põe a revisão primeiro — ratio (1+1)/(1+1).)
a.reset({ algo: 'fsrs', loadBalance: false, newMix: 'antes', newPerDay: 20, revPerDay: 200 });
DB.saveDecks([{ id: 'd1', nome: 'Deck 1', createdAt: '2026-01-01T00:00:00Z' }]);
DB.saveCards([
  {
    id: 'novo', deckId: 'd1', phase: 'new', status: 'pendente', due: a.hoje(), dueTs: null,
    intervalo: 0, reps: 0, lapses: 0, ease: 2.5, s: null, d: null, posicaoNova: 0,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    id: 'review', deckId: 'd1', phase: 'review', status: 'sei', due: a.hoje(), dueTs: null,
    intervalo: 10, reps: 8, lapses: 0, ease: 2.5, s: 10, d: 5,
    lastReview: CardEngine.addDays(a.hoje(), -10), createdAt: '2026-01-02T00:00:00Z'
  }
]);
CardsConfig.setDeckPreset('d1', { newMix: 'depois' });
CardsScreen.filters = { materias: new Set(['deck:d1']) };
eq(CardsScreen.buildQueue()[0], 'review', 'preset "novos depois" precisa agir na fila do deck');
CardsScreen.filters = { materias: new Set() };
eq(CardsScreen.buildQueue()[0], 'novo', 'fora do deck, o mix global volta a valer');

// ── 5) Campo legado new_per_day_minimum NÃO atua no Anki atual ──────────────
a.reset({
  algo: 'fsrs', loadBalance: false,
  newPerDay: 20, revPerDay: 0,
  newPerDayMinimum: 99,
  newCardsIgnoreReviewLimit: false
});
DB.saveDecks([{ id: 'd1', nome: 'Deck 1', createdAt: '2026-01-01T00:00:00Z' }]);
DB.saveCards([{
  id: 'novo-bloqueado', deckId: 'd1', phase: 'new', status: 'pendente', due: a.hoje(), dueTs: null,
  intervalo: 0, reps: 0, lapses: 0, ease: 2.5, s: null, d: null, posicaoNova: 0,
  createdAt: '2026-01-01T00:00:00Z'
}]);
CardsScreen.filters = { materias: new Set() };
eq(CardsScreen.buildQueue().length, 0,
  'new_per_day_minimum é campo legado: não pode furar o teto de reviews');
CardsConfig.set({ newCardsIgnoreReviewLimit: true });
eq(Array.from(CardsScreen.buildQueue()), ['novo-bloqueado'],
  'o interruptor global oficial deve permitir novos apesar do teto de reviews');

// ── 6) FSRS sem passos nunca pode produzir estado/data inválidos ────────────
a.reset({ algo: 'fsrs', loadBalance: false, learnSteps: [], relearnSteps: [] });
for (const phase of ['new', 'review', 'relearning']) {
  for (const grade of ['errei', 'dificil', 'bom', 'facil']) {
    const novo = phase === 'new';
    const card = {
      id: phase + '-' + grade, deckId: null, phase,
      reps: novo ? 0 : 8, lapses: novo ? 0 : 1, learnStep: 0,
      intervalo: novo ? 0 : 30, due: a.hoje(), ease: 2.5,
      s: novo ? null : 30, d: novo ? null : 5,
      lastReview: novo ? null : CardEngine.addDays(a.hoje(), -30)
    };
    const x = CardEngine.schedule(card, grade);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(String(x.due)), 'due válida em ' + phase + '/' + grade);
    ok(Number.isFinite(x.s) && x.s > 0, 'S válida em ' + phase + '/' + grade);
    ok(Number.isFinite(x.d) && x.d >= 1 && x.d <= 10, 'D válida em ' + phase + '/' + grade);
    // Anki 26.09.2: sem passos, intervalo FSRS < 0,5 dia mantém o card em
    // (re)aprendizado pelo próprio intervalo, em segundos (learning.rs).
    if (x.phase === 'learning' || x.phase === 'relearning') {
      ok(x._kind === 'min' && Number.isFinite(x._val) && x._val > 0 && x._val < 720,
        'curto prazo sem passos válido em ' + phase + '/' + grade);
    } else {
      ok(Number.isFinite(x.intervalo) && x.intervalo >= 1 && x.intervalo <= 36500,
        'intervalo válido em ' + phase + '/' + grade);
    }
  }
}

// ── 7) Superfície de configuração: sem callback fantasma nem opção legada ───
const ui = fs.readFileSync(new URL('../src/js/44-tela-cards.js', import.meta.url), 'utf8');
ok(!/CardsScreen\.openFsrsTools\s*\(/.test(ui), 'não pode chamar openFsrsTools inexistente');
ok(ui.includes("...(!isDeck ? [{\n      key: 'algo'"), 'seletor de algoritmo deve ser global');
ok(!ui.includes("key: 'newPerDayMinimum'"), 'campo legado sem efeito não deve ser exposto ao usuário');
ok(ui.includes("key: 'newCardsIgnoreReviewLimit'"), 'interruptor global oficial deve existir na UI');

// ── 7b) True Retention: semântica de stats/graphs/retention.rs (Anki 26.09.2) ─
// Toda resposta de revisão conta (sem deduplicar por card/dia); o reaprendizado
// intradiário (intervalo anterior em segundos) fica fora; janelas pelo horário
// da resposta a partir da próxima virada.
a.reset({ algo:'fsrs', retention:.9 });
const T0=a.agora();
DB.replaceRevlog([
  {cardId:'tr-a',ts:T0+100,date:a.hoje(),grade:1,phase:'review',intervalo:30},
  {cardId:'tr-a',ts:T0+200,date:a.hoje(),grade:3,phase:'relearning',intervalo:0},
  {cardId:'tr-b',ts:T0+110,date:a.hoje(),grade:3,phase:'review',intervalo:10},
  {cardId:'tr-b',ts:T0+300,date:a.hoje(),grade:3,phase:'review',intervalo:10},
  {cardId:'tr-c',ts:T0-86400000,date:CardEngine.addDays(a.hoje(),-1),grade:3,phase:'review',intervalo:40}
]);
const trHoje=CardsScreen.trueRetention(1);
eq(trHoje.todos.total,3,'True Retention de Hoje conta toda resposta de revisão');
eq(trHoje.todos.acertos,2,'Again falha; Hard/Good/Easy passam');
eq(trHoje.maduro.total,1,'maduro pelo intervalo anterior >= 21');
eq(trHoje.jovem.total,2,'jovem pelo intervalo anterior < 21');
eq(CardsScreen.trueRetention('ontem').todos.total,1,'janela de ontem');
eq(CardsScreen.trueRetention(7).todos.total,4,'janela de 7 dias');

// ── 8) Longo prazo: 6.000 cards, 365 dias, fila + agendador reais ────────────
// Simulação diária em lote: buildQueue() e schedule() são os módulos reais; a
// persistência é feita uma vez por dia para evitar transformar o teste em
// benchmark de JSON. Sem passos intradiários, cada resposta fecha no próximo dia.
a.reset({
  algo: 'fsrs', retention: 0.9, loadBalance: false,
  learnSteps: [], relearnSteps: [],
  newPerDay: 20, revPerDay: 200,
  newCardsIgnoreReviewLimit: true,
  leechAction: 'tag'
});
DB.saveDecks([{ id: 'long', nome: 'Longo prazo', createdAt: '2026-01-01T00:00:00Z' }]);
const iniciais = Array.from({ length: 6000 }, (_, i) => ({
  id: 'c' + i, noteId: 'c' + i, template: 'forward', deckId: 'long',
  materia: 'Auditoria', assunto: 'Longo prazo', tipo: 'Conceito',
  frente: 'F' + i, verso: 'V' + i, status: 'pendente',
  phase: 'new', learnStep: 0, due: a.hoje(), dueTs: null,
  ease: 2.5, intervalo: 0, reps: 0, lapses: 0, s: null, d: null,
  posicaoNova: i, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
}));
DB.saveCards(iniciais);
CardsScreen.filters = { materias: new Set(['deck:long']) };

let respostas = 0;
let picoFila = 0;
for (let dia = 0; dia < 365; dia++) {
  const fila = CardsScreen.buildQueue();
  picoFila = Math.max(picoFila, fila.length);
  ok(fila.length <= 220, 'fila diária não pode ultrapassar 20 novos + 200 reviews');
  const cards = DB.getCards();
  const porId = new Map(cards.map(c => [c.id, c]));
  for (const id of fila) {
    const c = porId.get(id);
    ok(!!c, 'id da fila precisa existir');
    const n = ((Number(id.slice(1)) * 1103515245 + dia * 12345 + (c.reps || 0) * 97) >>> 0) % 100;
    const grade = n < 8 ? 'errei' : (n < 18 ? 'dificil' : (n < 90 ? 'bom' : 'facil'));
    const patch = { ...CardEngine.schedule(c, grade) };
    delete patch._kind; delete patch._val; delete patch._leechNow;
    Object.assign(c, patch);
    ok(/^\d{4}-\d{2}-\d{2}$/.test(String(c.due)), 'simulação: due sempre ISO');
    ok(Number.isFinite(c.s) && c.s > 0, 'simulação: S sempre válida');
    ok(Number.isFinite(c.d) && c.d >= 1 && c.d <= 10, 'simulação: D sempre válida');
    // Curto prazo sem passos (Anki 26.09.2): card novo pode ficar em
    // aprendizado com intervalo 0 até a próxima resposta.
    const minIv = (c.phase === 'learning' || c.phase === 'relearning') ? 0 : 1;
    ok(Number.isFinite(c.intervalo) && c.intervalo >= minIv && c.intervalo <= 36500,
      'simulação: intervalo sempre válido');
    respostas++;
  }
  DB.saveCards(cards);
  a.avancar(86400000);
}
const finais = DB.getCards();
eq(finais.length, 6000, 'nenhum card pode desaparecer após um ano');
eq(finais.filter(c => (c.reps || 0) > 0).length, 6000,
  'os 6.000 cards precisam ter sido introduzidos em 365 dias');
ok(finais.filter(c => (c.reps || 0) > 1).length > 1000,
  'a simulação precisa revisar novamente uma parcela material da coleção');
ok(respostas > 6000, 'a simulação precisa conter revisões além da primeira apresentação');
ok(picoFila > 100, 'a simulação precisa produzir carga de revisão material');

console.log(`CERTIFICAÇÃO ANKI: ${checks}/${checks} contratos válidos; longo prazo = ${respostas} respostas em 6.000 cards/365 dias.`);
// Gate CI da PR #196: qualquer divergência acima bloqueia o merge.
