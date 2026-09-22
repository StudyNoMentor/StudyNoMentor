import assert from 'node:assert/strict';
import fs from 'node:fs';
import { criarAmbiente } from '../audit/cards-20260921-v2/harness.mjs';

const ROOT = new URL('../', import.meta.url);
let checks = 0;
const eq = (a,b,m) => { checks++; assert.deepEqual(a,b,m); };
const ok = (v,m) => { checks++; assert.ok(v,m); };

const a = criarAmbiente().reset();
const { CardsConfig, CardEngine } = a;

// Defaults que o Anki 26.09.2 realmente usa.
eq(CardsConfig.DEFAULTS.reviewOrder, 'day', 'review padrão deve ser Due date, then random');
eq(CardsConfig.DEFAULTS.newGatherOrder, 'deck', 'gather padrão deve ser Deck');
eq(CardsConfig.DEFAULTS.newSortOrder, 'template', 'sort padrão deve ser Template');

// O liga/desliga do FSRS é global no Anki; preset pode variar retenção/parâmetros.
CardsConfig.set({ algo: 'fsrs' });
CardsConfig.setDeckPreset('deck-x', { algo: 'sm2', retention: 0.95 });
eq(CardsConfig.forDeck('deck-x').algo, 'fsrs', 'preset não pode trocar FSRS por SM-2');
eq(CardsConfig.forDeck('deck-x').retention, 0.95, 'preset continua podendo variar retenção');

// Sem passos, Again não pode virar estatística de "Sei".
CardsConfig.set({ algo: 'sm2', learnSteps: [], relearnSteps: [] });
let p = CardEngine.schedule({
  id:'novo-sem-passos', deckId:null, phase:'new', reps:0, lapses:0, intervalo:0,
  due:a.hoje(), ease:2.5
}, 'errei');
eq(p.phase, 'review', 'SM-2 sem learning steps gradua direto');
eq(p.status, 'naosei', 'Again em card novo sem passos continua sendo falha');

p = CardEngine.schedule({
  id:'relearn-sem-passos', deckId:null, phase:'relearning', reps:5, lapses:1,
  intervalo:1, due:a.hoje(), ease:2.3, learnStep:0
}, 'errei');
eq(p.phase, 'review', 'SM-2 sem relearning steps sai para review');
eq(p.status, 'naosei', 'Again em relearning sem passos continua sendo falha');

// O save de configuração não pode disparar callback para método inexistente.
const ui = fs.readFileSync(new URL('../src/js/44-tela-cards.js', import.meta.url), 'utf8');
ok(!/CardsScreen\.openFsrsTools\s*\(/.test(ui), 'não pode chamar openFsrsTools inexistente');

// FSRS é global também na superfície de configuração: o campo algoritmo só existe no escopo global.
ok(ui.includes("...(!isDeck ? [{\n      key: 'algo'"), 'seletor de algoritmo deve ser global');

console.log(`CERTIFICAÇÃO ANKI: ${checks}/${checks} contratos estruturais válidos.`);
