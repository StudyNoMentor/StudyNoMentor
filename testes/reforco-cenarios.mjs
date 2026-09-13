import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HOJE = '2026-09-13';
const prefMem = new Map();
let tecSnaps = [{ id: 'snap-1' }];
let planPrefs = { sugestoesDisciplinas: 3, sugestoesTopicosDisc: 1, excluidas: [] };
const localStorage = { getItem(k) { return prefMem.has(k) ? prefMem.get(k) : null; }, setItem(k, v) { prefMem.set(k, String(v)); } };
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const DB = {
  _data: [],
  _profilePrefix() { return 'p:'; }, setRaw(k, v) { localStorage.setItem(k, v); },
  getExtras() { return this._data; }, saveExtras(list) { this._data = list; }, getExtra(id) { return this._data.find(x => x.id === id) || null; },
  getTecSnapshots() { return tecSnaps; }, extraRecorrente() { return false; }, extraConcluidaEm(e) { return e.status === 'concluida'; }, toggleExtraData() {},
  setConcluidaDia(id, _dia, on) { const e = this.getExtra(id); if (e) e.status = on ? 'concluida' : 'ativa'; return e; },
  addExtraProgress(id, quantidade, _min, opts = {}) { const e = this.getExtra(id); if (!e) return null; const q = Math.max(0, Number(quantidade) || 0); e.progresso = (e.progresso || 0) + q; e.historico ||= []; e.historico.push({ data: opts.data || HOJE, quantidade: q }); if (e.progresso >= e.alvo) e.status = 'concluida'; return e; },
  updateExtra(id, patch) { const e = this.getExtra(id); if (e) Object.assign(e, patch); return e; }
};
const ExtrasScreen = { render() {}, occurrencesForDay() { return []; }, cardHtml() { return ''; }, renderEmCurso() {}, puxarDoPlano() {}, _planoBind() {}, _planoRenderLista() {} };
const PlanoCiclo = { avaliar(e) { const alvo = Math.max(1, Number(e.alvo) || 1); const feito = Math.max(0, Number(e.progresso) || 0); return { extra: e, alvo, feito, taxa: e.origemPlano?.taxaInicial ?? 999, pct: Math.min(100, Math.round(feito / alvo * 100)), bateu: false, mediu: false, cumpriu: feito >= alvo, estado: feito >= alvo ? 'naoFuncionou' : 'andamento' }; } };
const PlanoPontos = { linhas: ['B', 'D', 'A', 'C', 'E'], esforcoPorMateria() { return { linhas: this.linhas.map(nome => ({ nome })) }; } };
const PlanoEngine = {
  calcular() { return null; }, prefs() { return planPrefs; },
  excluidasSet(p) { const o = Object.create(null); for (const n of (p?.excluidas || [])) o[norm(n)] = true; return o; },
  foraDoPlano(d, fora) { return !!fora?.[norm(d)]; }
};
const ctx = { window: {}, DB, ExtrasScreen, PlanoCiclo, PlanoPontos, PlanoEngine, localStorage,
  DesempenhoTecScreen: { scopedSnapshot() { return null; } }, ReforcoEngine: { norm }, todayLocal() { return HOJE; },
  showToast() {}, formatDateShort(s) { return s; }, UI: { async confirm() { return true; } }, document: { getElementById() { return null; } },
  setTimeout(fn) { fn(); }, clearTimeout() {}, console, _quiet() {} };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../src/js/54-reforco-fila.js', import.meta.url), 'utf8'), ctx, { filename: '54-reforco-fila.js' });
const F = ctx.ReforcoFila;

function extra(id, disciplina, alvo = 60, taxa = 30) { return { id, titulo: id, tipo: 'questoes', unidade: 'questoes', disciplina, alvo, progresso: 0, periodo: 'unica', status: 'ativa', datas: [], concluidasEm: [], historico: [], origemPlano: { topico: id, disciplina, taxaInicial: taxa, criadoEm: HOJE } }; }
const candidatos = () => [
  { nome: 'A1', disciplina: 'A', taxa: 20, incid: 2, qJanela: 20 }, { nome: 'A2', disciplina: 'A', taxa: 35, incid: 8, qJanela: 50 },
  { nome: 'B1', disciplina: 'B', taxa: 10, incid: 3, qJanela: 15 }, { nome: 'B2', disciplina: 'B', taxa: 30, incid: 7, qJanela: 45 },
  { nome: 'C1', disciplina: 'C', taxa: 5, incid: 9, qJanela: 60 }, { nome: 'C2', disciplina: 'C', taxa: 25, incid: 4, qJanela: 30 },
  { nome: 'D1', disciplina: 'D', taxa: 40, incid: 10, qJanela: 80 }, { nome: 'D2', disciplina: 'D', taxa: 50, incid: 1, qJanela: 10 },
  { nome: 'E1', disciplina: 'E', taxa: 15, incid: 5, qJanela: 25 }
];
function reset() { DB._data = []; prefMem.clear(); tecSnaps = [{ id: 'snap-1' }]; planPrefs = { sugestoesDisciplinas: 3, sugestoesTopicosDisc: 1, excluidas: [] }; PlanoPontos.linhas = ['B', 'D', 'A', 'C', 'E']; F._assinaturaAnterior = ''; }
const resultados = [];
function caso(nome, fn) { reset(); fn(); resultados.push({ nome, ok: true }); }

caso('3x1: sugestões automáticas ficam no topo e pré-selecionadas', () => {
  const p = F.prepararSugestoesPlano(candidatos());
  assert.equal(p.info.vagasSugeridas, 3);
  assert.deepEqual(p.candidatos.slice(0, 3).map(x => x.disciplina), ['B', 'D', 'A']);
  assert.deepEqual(Array.from(p.indices), [0, 1, 2]);
  assert.deepEqual(p.candidatos.slice(0, 3).map(x => x.nome), ['B1', 'D1', 'A1']);
});
caso('2x2: respeita quantidade de disciplinas e tópicos', () => {
  planPrefs.sugestoesDisciplinas = 2; planPrefs.sugestoesTopicosDisc = 2;
  const p = F.prepararSugestoesPlano(candidatos());
  assert.equal(p.info.vagasSugeridas, 4);
  assert.deepEqual(p.candidatos.slice(0, 4).map(x => x.disciplina), ['B', 'B', 'D', 'D']);
});
caso('exclusão no Plano remove disciplina da lista e das sugestões', () => {
  planPrefs.excluidas = ['B'];
  const p = F.prepararSugestoesPlano(candidatos());
  assert.ok(!p.candidatos.some(x => x.disciplina === 'B'));
  assert.ok(p.info.excluidasOcultas >= 2);
  assert.ok(!p.candidatos.slice(0, p.info.vagasSugeridas).some(x => x.disciplina === 'B'));
});
caso('vagas ocupadas reduzem novas sugestões', () => {
  DB._data = [extra('aberta-A', 'A'), extra('aberta-B', 'B')];
  const p = F.prepararSugestoesPlano(candidatos());
  assert.equal(p.info.vagasSugeridas, 1);
  assert.equal(p.candidatos[0].disciplina, 'D');
});
caso('exclusão física de uma extra libera nova vaga', () => {
  DB._data = [extra('aberta-A', 'A'), extra('aberta-B', 'B'), extra('aberta-D', 'D')];
  let p = F.prepararSugestoesPlano(candidatos()); assert.equal(p.info.vagasSugeridas, 0);
  DB._data = DB._data.filter(x => x.id !== 'aberta-D');
  p = F.prepararSugestoesPlano(candidatos()); assert.equal(p.info.vagasSugeridas, 1); assert.equal(p.candidatos[0].disciplina, 'D');
});
caso('parcial + concluir o dia preserva saldo e ciclo', () => {
  const a = extra('A1', 'A', 100, 20); DB._data = [a]; F.sincronizar();
  DB.addExtraProgress('A1', 10, 0, { data: HOJE }); DB.setConcluidaDia('A1', HOJE, true);
  assert.equal(a.status, 'ativa'); assert.ok(a.concluidasEm.includes(HOJE));
  const futuro = Object.entries(a.reforcoFila.alvosPorDia).filter(([d]) => d > HOJE).reduce((s, [, q]) => s + q, 0);
  assert.equal(futuro, 90);
});
caso('conclusão real ao alcançar o alvo encerra e limpa futuro', () => {
  const a = extra('A1', 'A', 40, 20); DB._data = [a]; F.sincronizar(); DB.addExtraProgress('A1', 40, 0, { data: HOJE });
  assert.equal(a.status, 'concluida'); assert.equal(Object.keys(a.reforcoFila.alvosPorDia).filter(d => d > HOJE).length, 0);
});
caso('cooldown impede reciclagem sem novo retrato', () => {
  const b = extra('B1-final', 'B', 40, 10); b.status = 'concluida'; b.origemPlano.veredito = { tipo: 'funcionou', retrato: 'snap-1', em: HOJE }; DB._data = [b];
  const p = F.prepararSugestoesPlano(candidatos()); assert.ok(!p.candidatos.slice(0, p.info.vagasSugeridas).some(x => x.disciplina === 'B'));
});
caso('novo retrato libera disciplina concluída para reavaliação', () => {
  const b = extra('B1-final', 'B', 40, 10); b.status = 'concluida'; b.origemPlano.veredito = { tipo: 'funcionou', retrato: 'snap-1', em: HOJE }; DB._data = [b]; tecSnaps = [{ id: 'snap-1' }, { id: 'snap-2' }];
  const p = F.prepararSugestoesPlano(candidatos()); assert.equal(p.candidatos[0].disciplina, 'B');
});
caso('padrão de carga global limita todas as parcelas futuras', () => {
  F.salvarPrefs({ disciplinasDia: 1, blocoMin: 8, blocoMax: 18 }); const a = extra('A1', 'A', 100); DB._data = [a]; F.sincronizar();
  const qs = Object.entries(a.reforcoFila.alvosPorDia).filter(([d]) => d >= HOJE).map(([, q]) => q); assert.ok(qs.length > 0); assert.ok(qs.every(q => q <= 18));
});
caso('override específico altera só um reforço', () => {
  const a = extra('A1', 'A', 100), b = extra('B1', 'B', 100); DB._data = [a, b]; F.sincronizar(); F.salvarCargaExtra('A1', 6, 12);
  assert.equal(F.limitesBloco(a).max, 12); assert.equal(F.limitesBloco(b).max, F.prefs().blocoMax);
  assert.ok(Object.entries(a.reforcoFila.alvosPorDia).filter(([d]) => d > HOJE).every(([, q]) => q <= 12));
});
caso('aplicar a todos redefine padrão e remove overrides individuais', () => {
  const a = extra('A1', 'A', 100), b = extra('B1', 'B', 100); DB._data = [a, b]; F.sincronizar(); F.salvarCargaExtra('A1', 5, 11); F.aplicarCargaTodos(9, 17);
  assert.deepEqual(F.prefs().blocoMin, 9); assert.deepEqual(F.prefs().blocoMax, 17); assert.equal(F.limitesBloco(a).personalizado, false); assert.equal(F.limitesBloco(b).personalizado, false);
});
caso('usar padrão remove apenas o override escolhido', () => {
  const a = extra('A1', 'A', 80); DB._data = [a]; F.sincronizar(); F.salvarCargaExtra('A1', 5, 13); assert.equal(F.limitesBloco(a).personalizado, true); F.usarCargaPadrao('A1'); assert.equal(F.limitesBloco(a).personalizado, false);
});

console.table(resultados);
console.log(`OK: ${resultados.length} cenários integrados de inclusão, exclusão, slots, parcial, conclusão, cooldown e carga passaram.`);
