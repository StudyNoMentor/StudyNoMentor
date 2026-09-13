import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HOJE = '2026-09-13';
const data = [];
const DB = {
  _data: data,
  getExtras() { return this._data; },
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

const PlanoCiclo = {
  avaliar(e) {
    const alvo = Math.max(1, Number(e.alvo) || 1);
    const feito = Math.max(0, Number(e.progresso) || 0);
    return {
      extra: e, origem: e.origemPlano, alvo, feito, manual: feito, medido: 0,
      pct: Math.min(100, Math.round(feito / alvo * 100)),
      bateu: false, mediu: false, cumpriu: feito >= alvo, estado: feito >= alvo ? 'naoFuncionou' : 'andamento'
    };
  }
};

const ctx = {
  window: {}, DB, ExtrasScreen, PlanoCiclo,
  PlanoEngine: { calcular() { return null; }, prefs() { return {}; } },
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
    origemPlano: { topico: id, disciplina, taxaInicial: taxa, criadoEm: HOJE }
  };
}

DB._data = [
  extra('A1', 'A', 100, 20),
  extra('B1', 'B', 61, 35),
  extra('C1', 'C', 47, 40),
  extra('D1', 'D', 35, 45),
  extra('A2', 'A', 33, 25)
];

// 1) Planejamento: no máximo três frentes e nunca duas da mesma disciplina no dia.
F.sincronizar();
const agenda = new Map();
for (const e of DB._data) {
  assert.ok(e.reforcoFila, 'reforço aberto do Plano deve ser adotado pela fila');
  for (const [dia, q] of Object.entries(e.reforcoFila.alvosPorDia)) {
    if (!agenda.has(dia)) agenda.set(dia, []);
    agenda.get(dia).push({ e, q });
  }
}
for (const [dia, itens] of agenda) {
  assert.ok(itens.length <= 3, `${dia}: fila não pode passar de 3 tarefas`);
  const disciplinas = itens.map(x => x.e.disciplina);
  assert.equal(new Set(disciplinas).size, disciplinas.length, `${dia}: disciplinas devem ser diferentes`);
}
const hojeItens = agenda.get(HOJE) || [];
assert.equal(hojeItens.length, 3, 'com pelo menos 3 disciplinas, hoje deve ser preenchido com 3 frentes');
assert.equal(hojeItens.find(x => x.e.disciplina === 'A')?.e.id, 'A1',
  'havendo dois assuntos da mesma disciplina, o mais crítico deve entrar primeiro');

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

// 5) Migração: fechamento manual antigo, parcial e comprovadamente incompleto é recuperado.
const legado = extra('LEG', 'E', 50, 20);
legado.progresso = 10;
legado.status = 'concluida';
legado.origemPlano.veredito = { tipo: 'encerradaPorVoce', em: HOJE, porMao: true, questoes: 10, alvo: 50 };
DB._data.push(legado);
F._assinaturaAnterior = '';
F.sincronizar();
assert.equal(legado.status, 'ativa', 'parcial fechado pela lógica antiga deve ser reaberto');
assert.equal(legado.origemPlano.veredito, undefined, 'veredito prematuro não pode contaminar o histórico/calibragem');
assert.ok(legado.concluidasEm.includes(HOJE), 'a parcela antiga permanece registrada como concluída no dia');
assert.equal(Object.entries(legado.reforcoFila.alvosPorDia).filter(([d]) => d > HOJE).reduce((s, [, q]) => s + q, 0), 40,
  'saldo do parcial legado deve voltar integralmente à fila');

console.log('OK: fila diária do reforço preserva ciclo, rodízio e saldo.');
