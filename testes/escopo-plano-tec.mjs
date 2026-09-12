#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const codigo = readFileSync(join(raiz, 'src/js/51a-tec-scope-consistency.js'), 'utf8');

const todos = [
  { id: 1, startDate: '2026-07-01', endDate: '2026-07-31', materias: { A: 10, B: 20 } },
  { id: 2, startDate: '2026-08-01', endDate: '2026-08-31', materias: { A: 900, B: 1 } },
  { id: 3, startDate: '2026-09-01', endDate: '2026-09-07', materias: { A: 10, B: 30 } }
];
let getterAtual = () => todos;
let ultimoSalvo = null;
let renderPlano = 0;
const listeners = { clickCapture: [], click: [], change: [] };

const document = {
  addEventListener(tipo, fn, captura) {
    if (tipo === 'click' && captura) listeners.clickCapture.push(fn);
    else if (listeners[tipo]) listeners[tipo].push(fn);
  },
  getElementById() { return null; },
  createElement() { return {}; }
};

const DB = {
  getTecSnapshots: () => getterAtual(),
  setRaw: () => {},
  _profilePrefix: () => 't:'
};

const PlanoPontos = {
  esforcoPorMateria() {
    const visto = DB.getTecSnapshots();
    const soma = { A: 0, B: 0 };
    visto.forEach(s => Object.entries(s.materias || {}).forEach(([k, q]) => { soma[k] = (soma[k] || 0) + q; }));
    const total = Object.values(soma).reduce((a, b) => a + b, 0);
    const linhas = Object.entries(soma).map(([nome, q]) => ({ nome, q, shareEsforco: total ? q / total * 100 : 0 }))
      .sort((a, b) => b.q - a.q);
    return { idsVistos: visto.map(s => s.id), linhas, seuTotal: total };
  }
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
  renderPlano() {
    renderPlano++;
    return { idsVistos: DB.getTecSnapshots().map(s => s.id), quadro: PlanoPontos.esforcoPorMateria() };
  },
  renderPlanoConteudo() {
    renderPlano++;
    return {
      idsVistos: DB.getTecSnapshots().map(s => s.id),
      calculo: PlanoEngine.calcular({ _fontes: this.activeSnapshots() }, {}),
      quadro: PlanoPontos.esforcoPorMateria()
    };
  },
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
  DB, PlanoEngine, PlanoPontos, DesempenhoTecScreen, document,
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
const ids = (x) => JSON.stringify(x);

/* 1) O agregado explícito manda no motor. */
const r1 = PlanoEngine.calcular({ _fontes: [todos[0], todos[2]] }, {});
assert(ids(r1.idsVistos) === ids([1, 3]), 'PlanoEngine ainda enxergou retrato fora do scoped._fontes');
assert(DB.getTecSnapshots().length === 3, 'getter global não foi restaurado após calcular()');

/* 2) Troca de escopo invalida caches. */
PlanoEngine._agrC = { antiga: true };
PlanoEngine.calcular({ _fontes: [todos[1]] }, {});
assert(PlanoEngine._agrC === null, 'cache _agrC não foi invalidado ao trocar escopo');

/* 3) Fallback usa activeSnapshots(). */
DesempenhoTecScreen.selectedSnapIds = new Set([2]);
const r2 = PlanoEngine.calcular({}, {});
assert(ids(r2.idsVistos) === ids([2]), 'fallback do motor não respeitou activeSnapshots()');

/* 4) Regressão do bug real: o quadro de matérias fica fora de calcular().
      Com todos os retratos A vence por 920×51; no escopo [1,3], B vence 50×20. */
DesempenhoTecScreen.selectedSnapIds = new Set([1, 3]);
const quadroDireto = PlanoPontos.esforcoPorMateria();
assert(ids(quadroDireto.idsVistos) === ids([1, 3]), 'esforcoPorMateria viu retrato desmarcado');
assert(quadroDireto.linhas[0].nome === 'B' && quadroDireto.linhas[0].q === 50, 'ranking de matérias ainda incorpora retrato fora do escopo');
assert(Math.abs(quadroDireto.linhas.find(x => x.nome === 'B').shareEsforco - (50 / 70 * 100)) < 0.001, 'shareEsforco não foi recalculado só no escopo');

/* 5) A renderização INTEIRA herda o escopo, não só o motor central. */
const tela = DesempenhoTecScreen.renderPlanoConteudo();
assert(ids(tela.idsVistos) === ids([1, 3]), 'renderPlanoConteudo começou com histórico global');
assert(ids(tela.calculo.idsVistos) === ids([1, 3]), 'cálculo interno perdeu o escopo da renderização');
assert(tela.quadro.linhas[0].nome === 'B', 'quadro Onde atacar primeiro divergiu do escopo na tela');
assert(DB.getTecSnapshots().length === 3, 'getter global não foi restaurado após renderPlanoConteudo');

const telaInicial = DesempenhoTecScreen.renderPlano();
assert(ids(telaInicial.idsVistos) === ids([1, 3]), 'renderPlano inicial leu histórico global');
assert(telaInicial.quadro.linhas[0].nome === 'B', 'renderPlano inicial montou ranking com histórico global');
assert(DB.getTecSnapshots().length === 3, 'getter global não foi restaurado após renderPlano');

/* 6) Seleção persistida volta antes do render. */
DesempenhoTecScreen.selectedSnapIds = null;
DesempenhoTecScreen._prefs = { selectedSnapIds: [2], rangeStart: '2026-08-01', rangeEnd: '2026-08-31' };
const vistosNoRender = DesempenhoTecScreen.render();
assert(ids(vistosNoRender) === ids([2]), 'selectedSnapIds não foi restaurado antes do render');
assert(DesempenhoTecScreen.rangeStart === '2026-08-01' && DesempenhoTecScreen.rangeEnd === '2026-08-31', 'intervalo persistido não foi restaurado');

/* 7) O clique de ritmo medido recebe o getter escopado durante o listener
      original e o getter é devolvido no microtask seguinte. */
DesempenhoTecScreen.scopeMode = 'select';
DesempenhoTecScreen.selectedSnapIds = new Set([1, 3]);
const ritmoBtn = {
  id: 'plano-ritmo-medido',
  closest(sel) { return sel === '#plano-ritmo-medido' ? this : this; },
  matches() { return false; }
};
listeners.clickCapture.forEach(fn => fn({ target: ritmoBtn }));
assert(ids(DB.getTecSnapshots().map(s => s.id)) === ids([1, 3]), 'clique de ritmo medido ainda vê histórico global');
await Promise.resolve();
assert(DB.getTecSnapshots().length === 3, 'getter global não foi restaurado após clique de ritmo');

/* 8) Atalhos de intervalo também persistem/invalida/recalculam o Plano. */
DesempenhoTecScreen.scopeMode = 'range';
DesempenhoTecScreen.rangeStart = '2026-09-01';
DesempenhoTecScreen.rangeEnd = '2026-09-07';
const antesRender = renderPlano;
const quick = {
  id: '',
  closest() { return this; },
  matches(sel) { return sel === '.tec-range-quick'; }
};
listeners.click.forEach(fn => fn({ target: quick }));
await Promise.resolve();
assert(ultimoSalvo && ultimoSalvo.rangeStart === '2026-09-01' && ultimoSalvo.rangeEnd === '2026-09-07', 'atalho de intervalo não persistiu o novo recorte');
assert(renderPlano > antesRender, 'atalho de intervalo não recalculou o Plano visível');

console.log('OK: Plano TEC usa o mesmo escopo em motor, ranking de matérias, renderização, ritmo e atalhos.');
