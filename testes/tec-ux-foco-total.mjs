import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const guard = readFileSync(new URL('../src/js/99g-ux-tec-guards.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/css/31-ux-foco-total.css', import.meta.url), 'utf8');

for (const token of [
  '#screen-leis .lei-card', '#screen-extras', '.sidebar-footer-row', '#screen-conquistas',
  '#screen-desempenhotec .pl-edital', '#tec-realtime-card .trt-kpis', '.trt-badge.confirmed::before'
]) {
  if (!css.includes(token)) throw new Error(`Camada visual final não cobre: ${token}`);
}

const storage = new Map();
const localStorage = {
  getItem: k => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k)
};

const assignment = {
  id: 'lac_1', topicKey: 'auditoria¦materialidade', disciplina: 'Auditoria', assunto: 'Materialidade',
  status: 'pending', target: 3, progress: 0, mirrorObserved: true, mirrorExtraIds: ['extra-removido'],
  createdAt: '2026-01-01T08:00:00.000Z'
};
const state = { schema: 1, days: { '2026-09-15': { day: '2026-09-15', assignments: [assignment] } } };
let originalMirrorCreated = 0;
let saved = 0;
const L = {
  currentSubjects: () => ['Auditoria'],
  relevantToCurrentPlan: d => d === 'Auditoria',
  state: () => state,
  save: () => { saved++; return true; },
  allPlanExtras: () => [],
  topicForAssignment: () => ({ lastError: '2026-01-01T07:00:00.000Z' }),
  mirrorTodayToExtras: st => {
    const a = st.days['2026-09-15'].assignments[0];
    if (a.status === 'pending') originalMirrorCreated++;
  },
  candidates: () => [
    { key: 'auditoria¦materialidade', lastError: '2026-01-01T07:00:00.000Z' },
    { key: 'tributario¦credito', lastError: '2026-09-15T11:00:00.000Z' }
  ],
  todayAssignments: () => state.days['2026-09-15'].assignments
};

let extraSeq = 0;
const createdExtras = [];
const DB = {
  _profilePrefix: () => 'diario-estudos:test:',
  setRaw: (k, v) => { localStorage.setItem(k, v); return true; },
  getExtras: () => [],
  addExtra: data => { const row = { id: `e${++extraSeq}`, ...data }; createdExtras.push(row); return row; },
  updateExtra: () => true
};

const robustGroup = {
  disciplina: 'Auditoria', assunto: 'Materialidade', uniqueIds: 2, errors: 2,
  ids: new Set(['101', '102']), robust: { scoreTopico: 90, taxa: 45 }
};
const R = {
  attack: () => ({ old: true }),
  range: () => ({ from: '2026-09-15', to: '2026-09-15', label: 'Hoje' }),
  rows: () => [{ questionId: '101' }, { questionId: '102' }],
  groups: () => [robustGroup],
  activeAccount: () => 'tec-test',
  dose: () => 5
};

const PlanoEngine = { lacunasDoEdital: () => ({ sem: [{ nome: 'Auditoria' }], pouca: [], medidas: 0, total: 1 }) };
const context = {
  window: null, localStorage, DB, PlanoEngine, TecLacunasContinuas: L, TecRealtime: R,
  ReforcoFila: { sincronizar() {} }, ExtrasScreen: { render() {} },
  showToast() {}, _quiet() {}, todayLocal: () => '2026-09-15',
  Date, Math, JSON, String, Number, Object, Array, Map, Set, RegExp, console
};
context.window = context;
vm.createContext(context);
vm.runInContext(guard, context, { filename: '99g-ux-tec-guards.js' });

if (PlanoEngine.lacunasDoEdital().sem.length !== 0) throw new Error('Cruzamento nominal Ciclo × TEC continuou ativo.');
if (L.currentSubjects().length !== 0 || L.relevantToCurrentPlan('Qualquer disciplina') !== true) throw new Error('A taxonomia TEC ainda depende do planejamento semanal.');

L.mirrorTodayToExtras(state);
if (assignment.status !== 'dismissed' || !assignment.userDismissedAt) throw new Error('Extra removido não virou dispensa persistente.');
if (originalMirrorCreated !== 0) throw new Error('Espelho removido foi recriado no mesmo refresh.');
if (!saved) throw new Error('Dispensa do reforço não foi persistida.');
if (L.todayAssignments().length !== 0) throw new Error('Atribuição dispensada continuou aparecendo como tarefa de hoje.');
const candidates = L.candidates(state);
if (candidates.some(x => x.key === assignment.topicKey)) throw new Error('Tópico dispensado voltou sem nova evidência TEC.');

const first = R.attack();
const second = R.attack();
if (first.created !== 1 || createdExtras.length !== 1) throw new Error('Ataque confirmado deveria criar exatamente um reforço.');
if (second.created !== 0 || second.skipped < 1 || createdExtras.length !== 1) throw new Error('Mesma evidência recriou reforço após já ter sido tratada.');

console.log('TEC UX FOCO TOTAL: taxonomia independente, exclusão sem loop, ataque idempotente e cobertura visual validados.');
