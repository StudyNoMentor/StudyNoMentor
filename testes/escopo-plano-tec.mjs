#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(raiz, 'src/js/51-tela-desempenho-tec.js'), 'utf8');
const camada = readFileSync(join(raiz, 'src/js/51a-tec-scope-consistency.js'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FALHA:', msg);
    process.exit(1);
  }
}
const ids = (x) => JSON.stringify(x);

/* ── 1. Contrato estrutural no código real ─────────────────────────────── */
assert(core.includes('aplicarMudancaEscopo()'), 'a tela não possui uma operação única de mudança de escopo');
assert((core.match(/\.aplicarMudancaEscopo\(\);/g) || []).length >= 5,
  'nem todos os controles de período/seleção convergem para aplicarMudancaEscopo()');
assert(!core.includes('if (this.selectedSnapIds.size === 0) snaps.forEach'),
  'seleção vazia ainda é convertida silenciosamente em todos os retratos');
assert(!core.includes('this.scopedSnapshot() || ReforcoEngine.currentSnapshot()'),
  'Reforço ainda cai para o retrato global quando o escopo fica vazio');
assert(!camada.includes("#tec-scope-select input[data-snap]"),
  'camada de consistência voltou a duplicar listeners de escopo da tela');
assert(!camada.includes(".tec-range-quick"),
  'camada de consistência voltou a interceptar atalhos de período');

/* Defaults: mantemos os valores bons e testamos as relações fundamentais. */
for (const trecho of ['metaDominio: 85', 'tetoDominio: 90', 'minAmostra: 20', 'amostraAlvo: 50', 'validadeDias: 120']) {
  assert(core.includes(trecho), 'default esperado desapareceu: ' + trecho);
}
assert(core.includes("estrat: 50") && core.includes("gran: 50") && core.includes("minq: 10"),
  'defaults neutros do Reforço foram alterados sem contrato explícito');

/* ── 2. Dados sintéticos que denunciam vazamento de escopo ─────────────── */
const todos = [
  { id: 1, startDate: '2026-07-01', endDate: '2026-07-31', materias: { A: 10, B: 20 }, q: 30, ac: 18 },
  { id: 2, startDate: '2026-08-01', endDate: '2026-08-31', materias: { A: 900, B: 1 }, q: 901, ac: 400 },
  { id: 3, startDate: '2026-09-01', endDate: '2026-09-07', materias: { A: 10, B: 30 }, q: 40, ac: 34 }
];
const DB = {
  getTecSnapshots: () => todos,
  setRaw() {},
  _profilePrefix: () => 't:'
};

const elementos = new Map();
const listeners = { clickCapture: [] };
const document = {
  addEventListener(tipo, fn, captura) { if (tipo === 'click' && captura) listeners.clickCapture.push(fn); },
  getElementById(id) { return elementos.get(id) || null; },
  createElement() { return { style: {}, appendChild() {}, textContent: '', className: '', id: '' }; }
};

const PlanoPontos = {
  esforcoPorMateria() {
    const visto = DB.getTecSnapshots();
    const soma = { A: 0, B: 0 };
    visto.forEach(s => Object.entries(s.materias || {}).forEach(([k, q]) => { soma[k] = (soma[k] || 0) + q; }));
    const total = Object.values(soma).reduce((a, b) => a + b, 0);
    const linhas = Object.entries(soma)
      .map(([nome, q]) => ({ nome, q, shareEsforco: total ? q / total * 100 : 0 }))
      .sort((a, b) => b.q - a.q);
    return { idsVistos: visto.map(s => s.id), linhas, seuTotal: total };
  }
};

const PlanoEngine = {
  DEFAULTS: { metaDominio: 85, tetoDominio: 90, faixaCritico: 50, faixaFragil: 65, minAmostra: 20, amostraAlvo: 50, pisoSerie: 5, consolidarEm: 2, validadeDias: 120, janelaMax: 365, cadenciaDias: 30, sensTendencia: 3, custoPiso: 50, custoPorPonto: 2, limite: 10, ritmoSemanal: null },
  _agrC: { antiga: true },
  _prefs: {},
  prefs() { return Object.assign({}, this.DEFAULTS, this._prefs); },
  salvarPrefs(p) { this._prefs = Object.assign({}, this._prefs, p || {}); return this.prefs(); },
  calcular(scoped) {
    return { idsVistos: DB.getTecSnapshots().map(s => s.id), fontes: scoped?._fontes?.map(s => s.id) || [] };
  },
  ritmoRecente(snaps) { return (snaps || []).map(s => s.id); }
};

const DesempenhoTecScreen = {
  scopeMode: 'select', selectedSnapIds: new Set([1, 3]), rangeStart: null, rangeEnd: null,
  tecTab: 'plano', _planoRefC: {}, _fatias: {},
  activeSnapshots() {
    const snaps = DB.getTecSnapshots();
    if (this.scopeMode === 'select') return snaps.filter(s => this.selectedSnapIds.has(s.id));
    if (this.scopeMode === 'range') return snaps.filter(s => s.startDate <= this.rangeEnd && s.endDate >= this.rangeStart);
    return snaps;
  },
  scopedSnapshot() {
    const a = this.activeSnapshots();
    return a.length ? { _fontes: a, q: a.reduce((s, x) => s + x.q, 0), ac: a.reduce((s, x) => s + x.ac, 0) } : null;
  },
  renderPlano() {
    return { historico: DB.getTecSnapshots().map(s => s.id), ritmo: PlanoEngine.ritmoRecente(DB.getTecSnapshots().slice().reverse()), quadro: PlanoPontos.esforcoPorMateria() };
  },
  renderPlanoConteudo() { return this.renderPlano(); },
  renderIncidencia() { return 'incidencia'; }
};

const contexto = vm.createContext({ DB, PlanoEngine, PlanoPontos, DesempenhoTecScreen, document, console, queueMicrotask, _quiet() {} });
vm.runInContext(camada, contexto, { filename: '51a-tec-scope-consistency.js' });

/* ── 3. Plano: motor, ranking e ritmo no mesmo recorte ────────────────── */
let calc = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), {});
assert(ids(calc.idsVistos) === ids([1, 3]), 'motor do Plano viu retrato desmarcado');
let quadro = PlanoPontos.esforcoPorMateria();
assert(ids(quadro.idsVistos) === ids([1, 3]), 'ranking de matérias viu retrato desmarcado');
assert(quadro.linhas[0].nome === 'B' && quadro.linhas[0].q === 50,
  'ranking não mudou para o resultado correto do escopo [1,3]');
assert(Math.abs(quadro.linhas.find(x => x.nome === 'B').shareEsforco - 50 / 70 * 100) < 0.001,
  'shareEsforco não foi recalculado dentro do período');
const tela = DesempenhoTecScreen.renderPlano();
assert(ids(tela.historico) === ids([1, 2, 3]), 'Plano mascarou o histórico operacional integral');
assert(ids(tela.ritmo) === ids([3, 1]), 'ritmo do Plano ignorou o período');
assert(DB.getTecSnapshots().length === 3, 'getter global vazou após renderização do Plano');

/* ── 4. Determinismo A → B → A: trocar e voltar ao escopo deve voltar aos mesmos números. */
const assinaturaPlano = () => {
  const q = PlanoPontos.esforcoPorMateria();
  const c = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), {});
  return JSON.stringify({ ids: c.idsVistos, topo: q.linhas[0]?.nome || null, total: q.seuTotal });
};
const a1 = assinaturaPlano();
DesempenhoTecScreen.selectedSnapIds = new Set([2]);
const b = assinaturaPlano();
DesempenhoTecScreen.selectedSnapIds = new Set([1, 3]);
const a2 = assinaturaPlano();
assert(a1 !== b, 'trocar os retratos não alterou o resultado analítico do Plano');
assert(a1 === a2, 'voltar ao escopo original não restaurou exatamente o resultado original');

/* ── 5. Intervalo usa sobreposição de períodos, igual ao produto real. */
DesempenhoTecScreen.scopeMode = 'range';
DesempenhoTecScreen.rangeStart = '2026-08-15';
DesempenhoTecScreen.rangeEnd = '2026-09-03';
assert(ids(DesempenhoTecScreen.activeSnapshots().map(s => s.id)) === ids([2, 3]),
  'intervalo não aplica corretamente a regra de sobreposição');
calc = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), {});
assert(ids(calc.idsVistos) === ids([2, 3]), 'Plano divergiu do activeSnapshots no modo intervalo');

/* ── 6. Escopo vazio é vazio: nunca pode ressuscitar o retrato global. */
DesempenhoTecScreen.scopeMode = 'select';
DesempenhoTecScreen.selectedSnapIds = new Set();
assert(DesempenhoTecScreen.scopedSnapshot() === null, 'escopo vazio produziu snapshot sintético');
calc = PlanoEngine.calcular(null, {});
assert(ids(calc.idsVistos) === ids([]), 'Plano caiu para histórico global com escopo vazio');
quadro = PlanoPontos.esforcoPorMateria();
assert(quadro.seuTotal === 0, 'ranking caiu para histórico global com escopo vazio');
assert(DB.getTecSnapshots().length === 3, 'escopo vazio contaminou o getter global');

/* ── 7. Invariantes dos ajustes: customização inválida é tornada coerente. */
const n = PlanoEngine._normalizarParametrosTec({
  metaDominio: 90, tetoDominio: 70, faixaCritico: 80, faixaFragil: 40,
  minAmostra: 50, amostraAlvo: 10, validadeDias: 0, janelaMax: -5,
  consolidarEm: 0, limite: 0, custoPiso: -1, custoPorPonto: -2
});
assert(n.tetoDominio >= n.metaDominio, 'teto ficou abaixo da meta');
assert(n.faixaCritico <= n.faixaFragil && n.faixaFragil <= n.metaDominio,
  'faixas crítico/frágil/meta ficaram contraditórias');
assert(n.amostraAlvo >= n.minAmostra, 'amostra-alvo ficou abaixo da amostra mínima');
assert(n.validadeDias >= 1 && n.janelaMax >= 1 && n.consolidarEm >= 1 && n.limite >= 1,
  'parâmetros positivos aceitaram zero/negativo');
assert(n.custoPiso >= 0 && n.custoPorPonto >= 0, 'custos aceitaram valores negativos');

PlanoEngine.salvarPrefs({ metaDominio: 92, tetoDominio: 70, minAmostra: 60, amostraAlvo: 10 });
const salvos = PlanoEngine.prefs();
assert(salvos.tetoDominio === 92 && salvos.amostraAlvo === 60,
  'salvarPrefs não preservou os invariantes depois de customização');

console.log('OK: contrato TEC consistente — Análise/Plano/Reforço usam o período, Incidência é externa, escopo vazio não vaza e ajustes permanecem coerentes.');
