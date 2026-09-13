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

const PlanoEngine = {
  _agrC: { antiga: true },
  calcular(scoped) {
    return {
      idsVistos: DB.getTecSnapshots().map(s => s.id),
      fontes: scoped && scoped._fontes ? scoped._fontes.map(s => s.id) : []
    };
  },
  ritmoRecente(snaps) {
    return (snaps || []).map(s => s.id);
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
    return {
      historicoOperacional: DB.getTecSnapshots().map(s => s.id),
      ritmo: PlanoEngine.ritmoRecente(DB.getTecSnapshots().slice().reverse()),
      quadro: PlanoPontos.esforcoPorMateria()
    };
  },
  renderPlanoConteudo() {
    renderPlano++;
    return {
      historicoOperacional: DB.getTecSnapshots().map(s => s.id),
      calculo: PlanoEngine.calcular({ _fontes: this.activeSnapshots() }, {}),
      quadro: PlanoPontos.esforcoPorMateria(),
      ritmo: PlanoEngine.ritmoRecente(DB.getTecSnapshots().slice().reverse())
    };
  },
  _planoRefC: { r: 1 },
  _fatias: { x: 1 }
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
      Com todos os retratos A vence; no escopo [1,3], B deve assumir o topo. */
DesempenhoTecScreen.selectedSnapIds = new Set([1, 3]);
const quadroDireto = PlanoPontos.esforcoPorMateria();
assert(ids(quadroDireto.idsVistos) === ids([1, 3]), 'esforcoPorMateria viu retrato desmarcado');
assert(quadroDireto.linhas[0].nome === 'B' && quadroDireto.linhas[0].q === 50, 'ranking de matérias ainda incorpora retrato fora do escopo');
assert(Math.abs(quadroDireto.linhas.find(x => x.nome === 'B').shareEsforco - (50 / 70 * 100)) < 0.001, 'shareEsforco não foi recalculado só no escopo');
assert(DB.getTecSnapshots().length === 3, 'ranking de matérias vazou o getter escopado');

/* 5) A tela preserva duas fronteiras distintas:
      - motor, ranking e ritmo = escopo ativo;
      - histórico operacional/auditoria = todos os retratos. */
const tela = DesempenhoTecScreen.renderPlanoConteudo();
assert(ids(tela.historicoOperacional) === ids([1, 2, 3]), 'renderPlanoConteudo escopou indevidamente o histórico operacional');
assert(ids(tela.calculo.idsVistos) === ids([1, 3]), 'cálculo interno perdeu o escopo da análise');
assert(tela.quadro.linhas[0].nome === 'B', 'quadro Onde atacar primeiro divergiu do escopo');
assert(ids(tela.ritmo) === ids([3, 1]), 'ritmo automático ainda considerou retrato desmarcado');
assert(DB.getTecSnapshots().length === 3, 'getter global não foi restaurado após renderPlanoConteudo');

const telaInicial = DesempenhoTecScreen.renderPlano();
assert(ids(telaInicial.historicoOperacional) === ids([1, 2, 3]), 'renderPlano escopou indevidamente o histórico operacional');
assert(telaInicial.quadro.linhas[0].nome === 'B', 'renderPlano inicial montou ranking com histórico global');
assert(ids(telaInicial.ritmo) === ids([3, 1]), 'renderPlano inicial calculou ritmo com histórico global');
assert(DB.getTecSnapshots().length === 3, 'getter global não foi restaurado após renderPlano');

/* 6) Seleção persistida volta antes do render. */
DesempenhoTecScreen.selectedSnapIds = null;
DesempenhoTecScreen._prefs = { selectedSnapIds: [2], rangeStart: '2026-08-01', rangeEnd: '2026-08-31' };
const vistosNoRender = DesempenhoTecScreen.render();
assert(ids(vistosNoRender) === ids([2]), 'selectedSnapIds não foi restaurado antes do render');
assert(DesempenhoTecScreen.rangeStart === '2026-08-01' && DesempenhoTecScreen.rangeEnd === '2026-08-31', 'intervalo persistido não foi restaurado');

/* 7) O clique de "ritmo medido" escopa só ritmoRecente; o DB continua global. */
DesempenhoTecScreen.scopeMode = 'select';
DesempenhoTecScreen.selectedSnapIds = new Set([1, 3]);
const ritmoBtn = {
  id: 'plano-ritmo-medido',
  closest(sel) { return sel === '#plano-ritmo-medido' ? this : null; },
  matches() { return false; }
};
listeners.clickCapture.forEach(fn => fn({ target: ritmoBtn }));
assert(ids(DB.getTecSnapshots().map(s => s.id)) === ids([1, 2, 3]), 'clique de ritmo alterou indevidamente o getter global');
const ritmoClique = PlanoEngine.ritmoRecente(DB.getTecSnapshots().slice().reverse());
assert(ids(ritmoClique) === ids([3, 1]), 'clique de ritmo medido ainda usa retrato desmarcado');
await Promise.resolve();
const ritmoDepois = PlanoEngine.ritmoRecente(DB.getTecSnapshots().slice().reverse());
assert(ids(ritmoDepois) === ids([3, 2, 1]), 'ritmoRecente não foi restaurado após o clique');

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

console.log('OK: Plano TEC escopa motor, ranking e ritmo sem contaminar auditoria/atividades.');
