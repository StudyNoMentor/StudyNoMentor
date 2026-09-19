import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HOJE = '2026-09-13';
const data = [];
const prefMem = new Map();
let tecSnaps = [{ id: 'snap-1' }];
const localStorage = { getItem(k) { return prefMem.has(k) ? prefMem.get(k) : null; }, setItem(k, v) { prefMem.set(k, String(v)); } };
const DB = {
  _data: data,
  _profilePrefix() { return 'p:'; },
  setRaw(k, v) { localStorage.setItem(k, v); },
  getExtras() { return this._data; },
  getTecSnapshots() { return tecSnaps; },
  saveExtras(list) { this._data = list; },
  getExtra(id) { return this._data.find(x => x.id === id) || null; },
  extraRecorrente() { return false; },
  extraConcluidaEm(e) { return e.status === 'concluida'; },
  setConcluidaDia(id, _dia, on) {
    const e = this.getExtra(id); if (e) e.status = on ? 'concluida' : 'ativa'; return e;
  },
  addExtraProgress(id, quantidade, _minutos, opts = {}) {
    const e = this.getExtra(id); if (!e) return null;
    const q = Math.max(0, Number(quantidade) || 0);
    e.progresso = (e.progresso || 0) + q;
    e.historico ||= [];
    e.historico.push({ data: opts.data || HOJE, quantidade: q });
    if (e.progresso >= e.alvo) e.status = 'concluida';
    return e;
  },
  updateExtra(id, patch) { const e = this.getExtra(id); if (e) Object.assign(e, patch); return e; },
  toggleExtraData() {}
};

const ExtrasScreen = {
  render() {},
  occurrencesForDay() { return []; },
  cardHtml() { return ''; },
  renderEmCurso() {},
  puxarDoPlano() {},
  _planoBind() {}
};

const MotorCiclo = {
  origemDe(e) { return e && e.origemMotor || null; },
  avaliar(e) {
    const origem = this.origemDe(e);
    const alvo = Math.max(1, Number(e.alvo) || 1);
    const feito = Math.max(0, Number(e.progresso) || 0);
    return {
      extra: e, origem, alvo, feito, manual: feito, medido: 0,
      taxa: e.taxaAtual ?? origem?.taxaInicial ?? 999,
      pct: Math.min(100, Math.round(feito / alvo * 100)),
      estado: feito >= alvo ? 'aguardando' : 'andamento'
    };
  }
};
const ctx = {
  window: {}, DB, ExtrasScreen, MotorCiclo, localStorage,
  DesempenhoTecScreen: { scopedSnapshot() { return null; } },
  ReforcoEngine: { norm(s) { return String(s || '').toLowerCase().trim(); } },
  todayLocal() { return HOJE; },
  showToast() {},
  formatDateShort(s) { return s; },
  UI: { async confirm() { return true; } },
  document: { getElementById() { return null; } },
  setTimeout(fn) { fn(); },
  clearTimeout() {},
  console,
  _quiet() {}
};
ctx.window = ctx;
vm.createContext(ctx);
const codigo = readFileSync(new URL('../src/js/54-reforco-fila.js', import.meta.url), 'utf8');
vm.runInContext(codigo, ctx, { filename: '54-reforco-fila.js' });
const F = ctx.ReforcoFila;
assert.ok(F, 'ReforcoFila deve ser exposta no window');

function extra(id, disciplina, alvo, taxa = 40) {
  return {
    id, titulo: 'Reforçar: ' + id, tipo: 'questoes', unidade: 'questoes', disciplina,
    alvo, progresso: 0, periodo: 'unica', status: 'ativa', datas: [], concluidasEm: [], historico: [],
    origemMotor: { motor: 'sugestao', topico: id, disciplina, taxaInicial: taxa, criadoEm: HOJE, alvoQuestoes: alvo }
  };
}

DB._data = [
  extra('A1', 'A', 100, 30),
  extra('B1', 'B', 61, 35),
  extra('C1', 'C', 47, 40),
  extra('D1', 'D', 35, 45),
  extra('A2', 'A', 33, 20)
];
// A1 nasceu menos crítico que A2, mas HOJE é mais crítico. O rodízio deve usar
// a leitura atual quando ela existir, não congelar a prioridade da criação.
DB.getExtra('A1').taxaAtual = 10;
DB.getExtra('A2').taxaAtual = 15;

// 1) Planejamento: padrão = UMA disciplina por dia e rodízio por matéria.
F.sincronizar();
const agenda = new Map();
for (const e of DB._data) {
  assert.ok(e.reforcoFila, 'reforço aberto do Motor deve ser adotado pela fila');
  for (const [dia, q] of Object.entries(e.reforcoFila.alvosPorDia)) {
    if (!agenda.has(dia)) agenda.set(dia, []);
    agenda.get(dia).push({ e, q });
  }
}
for (const [dia, itens] of agenda) {
  assert.ok(itens.length <= 1, `${dia}: padrão deve espaçar uma disciplina por dia`);
}
const diasOrdenados = [...agenda.keys()].sort();
assert.equal((agenda.get(HOJE) || []).length, 1, 'hoje deve começar com uma única frente no padrão espaçado');
assert.equal((agenda.get(HOJE) || [])[0]?.e.id, 'A1', 'o assunto mais crítico disponível abre o rodízio');
const primeirasDiscs = diasOrdenados.slice(0, 4).map(d => (agenda.get(d) || [])[0]?.e.disciplina);
assert.deepEqual(primeirasDiscs.slice(0, 4), ['A', 'B', 'C', 'D'],
  'um segundo tópico de A não pode furar B/C/D: o espaçamento é por disciplina');

// 1b) Configuração mais intensa: dois assuntos por dia, ainda sem repetir matéria.
F.salvarPrefs({ disciplinasDia: 2 });
const agenda2 = new Map();
for (const e of DB._data) {
  for (const [dia, q] of Object.entries(e.reforcoFila.alvosPorDia)) {
    if (!agenda2.has(dia)) agenda2.set(dia, []);
    agenda2.get(dia).push({ e, q });
  }
}
for (const [dia, itens] of agenda2) {
  assert.ok(itens.length <= 2, `${dia}: configuração não pode passar de 2 disciplinas`);
  assert.equal(new Set(itens.map(x => x.e.disciplina)).size, itens.length, `${dia}: não pode repetir disciplina no mesmo dia`);
}
assert.ok([...agenda2.entries()].some(([d, itens]) => d > HOJE && itens.length === 2),
  'com saldo suficiente, algum dia futuro deve usar as duas vagas configuradas');
F.salvarPrefs({ disciplinasDia: 1 });

// 2) Tamanho de bloco: balanceia em blocos úteis, sem fabricar dias de 7/8 questões.
let r = 100, blocos = [];
while (r > 0) { const q = F.tamanhoBloco(r); blocos.push(q); r -= q; }
assert.deepEqual(blocos, [25, 25, 25, 25], '100 questões devem ser balanceadas em 4 blocos de 25');
r = 61; blocos = [];
while (r > 0) { const q = F.tamanhoBloco(r); blocos.push(q); r -= q; }
assert.deepEqual(blocos, [21, 20, 20], '61 questões devem evitar microparcelas');
assert.ok(blocos.every(q => q > 8), 'nenhum bloco artificial deve cair em 7/8 questões');

// 3) Parcial + concluir o DIA: preserva o ciclo global e redistribui TODO o saldo.
const a = DB.getExtra('A1');
const alvoHoje = F.alvoNoDia(a, HOJE);
assert.equal(alvoHoje, 25, 'primeira parcela de 100 deve ser 25');
DB.addExtraProgress('A1', 10, 0, { data: HOJE });
DB.setConcluidaDia('A1', HOJE, true);
assert.equal(a.status, 'ativa', 'concluir parcela diária NÃO pode encerrar o ciclo global');
assert.ok(a.concluidasEm.includes(HOJE), 'o dia executado precisa ficar marcado no histórico');
const futuroA = Object.entries(a.reforcoFila.alvosPorDia).filter(([d]) => d > HOJE);
assert.equal(futuroA.reduce((s, [, q]) => s + q, 0), 90, 'as 90 questões restantes devem continuar agendadas');
assert.ok(futuroA.every(([, q]) => q > 8), 'saldo futuro não deve ser pulverizado em microtarefas');

// 4) Chegar ao alvo global encerra de verdade e remove promessas futuras.
DB.addExtraProgress('A1', 90, 0, { data: HOJE });
assert.equal(a.status, 'concluida', 'alvo global atingido deve encerrar o ciclo');
assert.equal(Object.keys(a.reforcoFila.alvosPorDia).filter(d => d > HOJE).length, 0, 'ciclo encerrado não pode manter parcelas futuras');

// 5) Segurança: ciclo do Motor já encerrado permanece encerrado e não volta à agenda.
const encerrado = extra('OLD', 'F', 50, 18);
encerrado.progresso = 10;
encerrado.historico = [{ data: '2026-09-12', quantidade: 10 }];
encerrado.status = 'concluida';
encerrado.origemMotor.veredito = { tipo: 'encerradaPorVoce', em: '2026-09-12', questoes: 10, alvo: 50 };
DB._data.push(encerrado);
F._assinaturaAnterior = '';
F.sincronizar();
assert.equal(encerrado.status, 'concluida', 'ciclo do Motor já encerrado não pode ser ressuscitado');
assert.equal(Object.keys(encerrado.reforcoFila?.alvosPorDia || {}).length, 0,
  'ciclo encerrado não pode ganhar agenda automática nova');

console.log('OK: fila diária do reforço preserva ciclo, rodízio, criticidade e saldo.');
