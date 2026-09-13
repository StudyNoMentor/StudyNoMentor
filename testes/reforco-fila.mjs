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

const PlanoCiclo = {
  avaliar(e) {
    const alvo = Math.max(1, Number(e.alvo) || 1);
    const feito = Math.max(0, Number(e.progresso) || 0);
    return {
      extra: e, origem: e.origemPlano, alvo, feito, manual: feito, medido: 0,
      taxa: e.taxaAtual ?? e.origemPlano?.taxaInicial ?? 999,
      pct: Math.min(100, Math.round(feito / alvo * 100)),
      bateu: false, mediu: false, cumpriu: feito >= alvo, estado: feito >= alvo ? 'naoFuncionou' : 'andamento'
    };
  }
};

let planPrefs = { sugestoesDisciplinas: 3, sugestoesTopicosDisc: 1 };
const PlanoPontos = {
  linhas: ['A', 'B', 'C', 'D'],
  esforcoPorMateria() { return { linhas: this.linhas.map(nome => ({ nome })) }; }
};
const ctx = {
  window: {}, DB, ExtrasScreen, PlanoCiclo, PlanoPontos, localStorage,
  PlanoEngine: { calcular() { return null; }, prefs() { return planPrefs; } },
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
  assert.ok(e.reforcoFila, 'reforço aberto do Plano deve ser adotado pela fila');
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

// 5) Migração: fechamento manual antigo, parcial e comprovadamente incompleto é recuperado.
const legado = extra('LEG', 'E', 50, 20);
legado.progresso = 10;
legado.historico = [{ data: HOJE, quantidade: 10 }];
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

// 6) Segurança da migração: um ciclo antigo encerrado manualmente não é reaberto.
const antigo = extra('OLD', 'F', 50, 18);
antigo.progresso = 10;
antigo.historico = [{ data: '2026-09-12', quantidade: 10 }];
antigo.status = 'concluida';
antigo.origemPlano.veredito = { tipo: 'encerradaPorVoce', em: '2026-09-12', porMao: true, questoes: 10, alvo: 50 };
DB._data.push(antigo);
F._assinaturaAnterior = '';
F.sincronizar();
assert.equal(antigo.status, 'concluida', 'migração não pode ressuscitar encerramentos históricos deliberados');

console.log('OK: fila diária do reforço preserva ciclo, rodízio, criticidade e saldo.');


// 7) Seleção do Plano: primeiro ranqueia DISCIPLINAS pelo próprio Plano;
// depois pega o pior tópico disponível dentro de cada uma.
DB._data = [];
planPrefs = { sugestoesDisciplinas: 3, sugestoesTopicosDisc: 1 };
PlanoPontos.linhas = ['B', 'D', 'A', 'C'];
ExtrasScreen._planoCand = [
  { nome: 'A mediano', disciplina: 'A', taxa: 50, incid: 8, qJanela: 30 },
  { nome: 'A crítico', disciplina: 'A', taxa: 20, incid: 3, qJanela: 20 },
  { nome: 'B mediano', disciplina: 'B', taxa: 40, incid: 5, qJanela: 40 },
  { nome: 'B crítico', disciplina: 'B', taxa: 10, incid: 2, qJanela: 15 },
  { nome: 'C crítico', disciplina: 'C', taxa: 5, incid: 9, qJanela: 50 },
  { nome: 'D crítico', disciplina: 'D', taxa: 60, incid: 10, qJanela: 80 }
];
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel), [0, 1, 2],
  'as sugestões automáticas devem ser movidas para o topo e continuar pré-selecionadas');
assert.deepEqual(Array.from(ExtrasScreen._planoCand.slice(0, 3), x => x.disciplina).sort(), ['A', 'B', 'D'],
  'o bloco superior deve conter exatamente as três matérias prioritárias A/B/D');
assert.deepEqual(Array.from(ExtrasScreen._planoCand.slice(0, 3), x => x.nome).sort(), ['A crítico', 'B crítico', 'D crítico'],
  'cada matéria prioritária deve levar seu pior tópico');

// 8) Slots contínuos: atividades abertas ocupam vagas. Quando uma termina,
// a próxima MATÉRIA entra; a recém-concluída aguarda um retrato TEC novo.
const abertaA = extra('aberta-A', 'A', 40, 20);
const abertaB = extra('aberta-B', 'B', 40, 10);
DB._data = [abertaA, abertaB];
PlanoPontos.linhas = ['A', 'B', 'C', 'D'];
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel), [0],
  'a vaga restante deve ficar no topo e pré-selecionada');
assert.equal(ExtrasScreen._planoCand[0].disciplina, 'C',
  'com A e B ocupando duas das três vagas, C deve preencher a vaga restante');

// Simula que a sugestão C foi aceita antes de B terminar.
const abertaC = extra('aberta-C', 'C', 40, 5);
DB._data.push(abertaC);
abertaB.status = 'concluida';
abertaB.origemPlano.veredito = { tipo: 'funcionou', retrato: 'snap-1', em: HOJE };
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel), [0],
  'a nova vaga deve permanecer no topo e pré-selecionada');
assert.equal(ExtrasScreen._planoCand[0].disciplina, 'D',
  'B recém-concluída não pode se reciclar com o mesmo retrato: a vaga passa para D');

// Chegou informação nova e B continua fraca: agora ela pode voltar legitimamente.
tecSnaps = [{ id: 'snap-1' }, { id: 'snap-2' }];
abertaC.status = 'concluida';
abertaC.origemPlano.veredito = { tipo: 'funcionou', retrato: 'snap-1', em: HOJE };
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel), [0, 1],
  'duas vagas liberadas devem ficar no topo e pré-selecionadas');
assert.deepEqual(Array.from(ExtrasScreen._planoCand.slice(0, 2), x => x.disciplina).sort(), ['B', 'C'],
  'com retrato novo, B e C podem ser reavaliadas e voltar se ainda estiverem na fila de fraquezas');

// 9) A configuração do Plano também controla quantos tópicos cabem por matéria.
DB._data = [];
planPrefs = { sugestoesDisciplinas: 2, sugestoesTopicosDisc: 2 };
PlanoPontos.linhas = ['B', 'A', 'C', 'D'];
const sel22 = F.selecionarSugestoesPlano(ExtrasScreen._planoCand);
const sel22Itens = Array.from(sel22.indices).map(i => ExtrasScreen._planoCand[i]);
const sel22Cont = sel22Itens.reduce((m, x) => (m[x.disciplina] = (m[x.disciplina] || 0) + 1, m), {});
assert.deepEqual(sel22Cont, { B: 2, A: 2 },
  '2 disciplinas × 2 tópicos deve preencher B e A com dois tópicos cada, sem puxar C/D');

console.log('OK: fila diária, espaçamento e ciclo contínuo de sugestões do Plano preservados.');
