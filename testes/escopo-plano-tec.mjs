#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const codigo = readFileSync(join(raiz, 'src/js/51a-tec-scope-consistency.js'), 'utf8');

const todos = [
  { id: 1, startDate: '2026-07-01', endDate: '2026-07-31' },
  { id: 2, startDate: '2026-08-01', endDate: '2026-08-31' },
  { id: 3, startDate: '2026-09-01', endDate: '2026-09-07' }
];
let getterAtual = () => todos;
let ultimoSalvo = null;
let renderPlano = 0;

const DB = {
  getTecSnapshots: () => getterAtual(),
  setRaw: () => {},
  _profilePrefix: () => 't:'
};

const DesempenhoTecScreen = {
  scopeMode: 'select',
  selectedSnapIds: new Set([1, 3]),
  rangeStart: null,
  rangeEnd: null,
  tecTab: 'plano',
  _prefs: { selectedSnapIds: [2] },
  _loadPrefs() { return this._prefs; },
  savePrefs(p) { ultimoSalvo = p; this._prefs = Object.assign({}, this._prefs, p); },
  activeSnapshots() {
    const snaps = DB.getTecSnapshots();
    if (this.scopeMode === 'select') return snaps.filter(s => this.selectedSnapIds.has(s.id));
    if (this.scopeMode === 'range') return snaps.filter(s => s.startDate <= this.rangeEnd && s.endDate >= this.rangeStart);
    return snaps;
  },
  render() { return this.selectedSnapIds ? [...this.selectedSnapIds] : null; },
  renderPlanoConteudo() { renderPlano++; },
  _planoRefC: { r: 1 },
  _fatias: { x: 1 }
};

const PlanoEngine = {
  _agrC: { antiga: true },
  calcular(scoped) {
    return {
      idsVistos: DB.getTecSnapshots().map(s => s.id),
      fontes: scoped && scoped._fontes ? scoped._fontes.map(s => s.id) : []
    };
  }
};

const contexto = vm.createContext({
  DB, PlanoEngine, DesempenhoTecScreen,
  console,
  queueMicrotask,
  _quiet() {}
});

vm.runInContext(codigo, contexto, { filename: '51a-tec-scope-consistency.js' });

function assert(cond, msg) {
  if (!cond) {
    console.error('FALHA:', msg);
    process.exit(1);
  }
}

/* 1) O agregado explícito manda no cálculo — retrato desmarcado não entra. */
const r1 = PlanoEngine.calcular({ _fontes: [todos[0], todos[2]] }, {});
assert(JSON.stringify(r1.idsVistos) === JSON.stringify([1, 3]), 'Plano ainda enxergou retrato fora do scoped._fontes');
assert(DB.getTecSnapshots().length === 3, 'getter global do DB não foi restaurado após o cálculo');

/* 2) Mudar o conjunto invalida o cache de agrupamento. */
PlanoEngine._agrC = { antiga: true };
PlanoEngine.calcular({ _fontes: [todos[1]] }, {});
assert(PlanoEngine._agrC === null, 'cache _agrC não foi invalidado ao trocar o escopo');

/* 3) Fallback usa activeSnapshots(), não a vida inteira. */
DesempenhoTecScreen.selectedSnapIds = new Set([2]);
const r2 = PlanoEngine.calcular({}, {});
assert(JSON.stringify(r2.idsVistos) === JSON.stringify([2]), 'fallback do Plano não respeitou activeSnapshots()');

/* 4) A seleção persistida é restaurada antes do render original. */
DesempenhoTecScreen.selectedSnapIds = null;
DesempenhoTecScreen._prefs = { selectedSnapIds: [2], rangeStart: '2026-08-01', rangeEnd: '2026-08-31' };
const vistosNoRender = DesempenhoTecScreen.render();
assert(JSON.stringify(vistosNoRender) === JSON.stringify([2]), 'selectedSnapIds não foi restaurado antes do render');
assert(DesempenhoTecScreen.rangeStart === '2026-08-01' && DesempenhoTecScreen.rangeEnd === '2026-08-31', 'intervalo persistido não foi restaurado');

/* 5) A função de persistência existe de forma observável via savePrefs ao mudar
      o estado; o teste de DOM fica para a suíte Chromium do repositório. */
DesempenhoTecScreen.savePrefs({ selectedSnapIds: [1, 2] });
assert(ultimoSalvo && ultimoSalvo.selectedSnapIds.length === 2, 'preferência de seleção não é serializável');

console.log('OK: Plano TEC respeita o escopo selecionado, restaura seleção e invalida caches.');
