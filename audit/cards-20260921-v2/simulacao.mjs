/* 2ª auditoria — simulação anual e medição de degradação real.
   Duas partes, com escopos diferentes e declarados:

   (1) SIMULAÇÃO ANUAL (6.000 cards × 365 dias × 3 cenários) sobre o agendador,
       a fila e a configuração reais, com relógio e armazenamento do harness.
       Serve para invariantes de agendamento em volume, e gera os vetores de
       estado final usados na comparação com o backend oficial do Anki.

   (2) DEGRADAÇÃO MEDIDA: uma sessão que passa por CardsScreen.answer() com o
       DB de produção e o localStorage serializado de verdade. A 1ª rodada
       trocou DB._get/_set por um Map de objetos vivos e, com isso, não podia
       medir nada disto.                                                      */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { criarAmbiente } from './harness.mjs';

const REF = createRequire(import.meta.url)('../../testes/referencia-anki.js');
const SAIDA = new URL('./', import.meta.url);
const RAIZ = new URL('../../', import.meta.url);
const SEMENTE_INICIAL = 21092026;
const DIA0 = Date.parse('2025-09-21T12:00:00Z');

let semente = SEMENTE_INICIAL;
const sorteio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };

const A = criarAmbiente({ now: DIA0 });
const { DB, FSRS, CardsConfig: C, CardEngine: E, CardsScreen: S } = A;
// O fuzz do app usa Math.random para o passo intradiário: prendemos a semente
// para a simulação ser reproduzível de ponta a ponta.
A.ctx.Math = Object.create(Math); A.ctx.Math.random = sorteio;

const finito = (x) => typeof x === 'number' && Number.isFinite(x);
const dataIso = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x));

const cenarios = [];
const vetores = [];
for (const [nome, algo, retention, loadBalance] of [
  ['fsrs-padrao', 'fsrs', 0.9, false],
  ['fsrs-balanceado-95', 'fsrs', 0.95, true],
  ['sm2-classico', 'sm2', 0.9, false]
]) {
  semente = SEMENTE_INICIAL;
  A.irPara(DIA0);
  A.reset({ algo, retention, loadBalance, newPerDay: 30, revPerDay: 300, learnSteps: [1, 10], relearnSteps: [10] });
  const hoje0 = A.hoje();
  DB.saveCards(Array.from({ length: 6000 }, (_, i) => ({
    id: String(100000 + i), frente: 'Pergunta ' + i, verso: 'Resposta ' + i,
    phase: 'new', reps: 0, lapses: 0, due: hoje0, posicaoNova: i, status: 'pendente'
  })));

  const memorias = new Map();
  const res = {
    nome, algo, retention, loadBalance, cards: 6000, dias: 365,
    diasAtivos: 0, respostas: 0, distintos: 0,
    agendamentosInvalidos: 0, divergenciaMemoria: 0, previaDivergente: 0,
    limiteNovosEstourado: 0, limiteRevisoesEstourado: 0, filaComRepetido: 0,
    filaComSuspenso: 0, filaComNaoVencido: 0, regressaoDeReps: 0,
    picoDiario: 0, maiorEstabilidade: 0, leeches: 0, segundos: 0, exemplos: []
  };
  const distintos = new Set();
  const t0 = performance.now();

  for (let dia = 0; dia < 365; dia++) {
    A.irPara(DIA0 + dia * 86400e3);
    // Dois blocos de ausência, como na 1ª rodada, para exercitar acúmulo.
    if ((dia >= 80 && dia < 94) || (dia >= 200 && dia < 221)) continue;
    res.diasAtivos++;
    const hoje = A.hoje();
    const novosAntes = C.newDoneToday(), revAntes = C.revDoneToday();
    let noDia = 0;

    /* A fila do dia é montada UMA vez (é o que o app faz ao abrir a tela) e as
       invariantes são cobradas NESSE instante: depois da primeira resposta é
       legítimo que um card da fila deixe de estar vencido. As rodadas
       seguintes só recolhem os passos intradiários que forem vencendo. */
    let fila = S.buildQueue();
    if (new Set(fila).size !== fila.length) res.filaComRepetido++;
    for (const id of fila) {
      const c = DB.getCard(id);
      if (!c) continue;
      if (c.suspenso) res.filaComSuspenso++;
      if (!E.isDue(c)) res.filaComNaoVencido++;
    }

    for (let rodada = 0; rodada < 30; rodada++) {
      for (const id of fila) {
        const c = DB.getCard(id);
        if (!c || c.suspenso || !E.isDue(c)) continue;

        const u = sorteio(), perfil = Number(id) % 5;
        const erra = [0.06, 0.12, 0.23, 0.35, 0.48][perfil];
        const g = u < erra ? 1 : u < erra + 0.12 ? 2 : u < 0.94 ? 3 : 4;
        const nota = ['', 'errei', 'dificil', 'bom', 'facil'][g];

        const previa = E.previewIntervals(c)[nota];
        const decorrido = c.lastReview ? E._daysBetween(c.lastReview, hoje) : 0;
        const patch = E.schedule(c, nota);

        if (previa.kind !== (patch._kind || 'day') || previa.val !== (patch._val != null ? patch._val : patch.intervalo)) res.previaDivergente++;
        if (!dataIso(patch.due) || (patch.dueTs != null && !finito(patch.dueTs))
            || (algo === 'fsrs' && (!finito(patch.s) || !finito(patch.d)))
            || (patch._val != null && !finito(patch._val))) {
          res.agendamentosInvalidos++;
          if (res.exemplos.length < 5) res.exemplos.push({ dia, id, nota, faseAntes: c.phase, patch });
        }
        if ((patch.reps || 0) !== (c.reps || 0) + 1) res.regressaoDeReps++;
        if (algo === 'fsrs') {
          const ref = REF.step(FSRS.DEFAULT_W, decorrido, g, memorias.get(id) || { stability: 0, difficulty: 0 }, memorias.has(id) ? 1 : 0);
          memorias.set(id, ref);
          if (Math.abs(ref.stability - patch.s) > 1e-9 * Math.max(1, ref.stability) || Math.abs(ref.difficulty - patch.d) > 1e-9) res.divergenciaMemoria++;
          res.maiorEstabilidade = Math.max(res.maiorEstabilidade, patch.s);
        }
        const balde = S._bucket(c);
        if (balde === 'new' || balde === 'review') C.markIntroduced(balde, id);
        DB.updateCard(id, patch);
        E.invalidateDueCache();
        distintos.add(id); res.respostas++; noDia++;
      }
      // Sessão de até 4 h: avança o relógio até o próximo passo intradiário.
      const limite = DIA0 + dia * 86400e3 + 4 * 3600e3;
      const esperando = DB.getCards().filter((c) => !c.suspenso && c.dueTs && c.dueTs > A.agora() && c.dueTs <= limite);
      if (!esperando.length) break;
      A.irPara(Math.min(...esperando.map((c) => c.dueTs)));
      fila = esperando.filter((c) => c.dueTs <= A.agora()).map((c) => c.id);
    }
    // LIMITES: medidos por CARDS DISTINTOS introduzidos no dia, que é o que o
    // contador do app registra — repetições de passo não consomem limite.
    if (C.newDoneToday() - novosAntes > 30) res.limiteNovosEstourado++;
    if (C.revDoneToday() - revAntes > 300) res.limiteRevisoesEstourado++;
    res.picoDiario = Math.max(res.picoDiario, noDia);
    if (dia % 25 === 0) console.log(`  ${nome} dia ${dia}/365 · ${res.respostas} respostas · ${((performance.now() - t0) / 1000).toFixed(0)}s`);
    // Recarga semanal por serialização — sai e volta do armazenamento de verdade.
    if (dia % 7 === 0) { DB.saveCards(JSON.parse(JSON.stringify(DB.getCards()))); C._c = null; C._cKey = null; }
  }

  res.distintos = distintos.size;
  res.leeches = DB.getCards().filter((c) => c.leech).length;
  res.segundos = +((performance.now() - t0) / 1000).toFixed(2);
  cenarios.push(res);
  console.log(JSON.stringify(Object.assign({}, res, { exemplos: res.exemplos.length })));

  if (nome === 'fsrs-padrao') {
    for (const c of DB.getCards()) {
      if (c.phase !== 'review') continue;
      vetores.push({
        card: c,
        decorrido: E._daysBetween(c.lastReview, A.hoje()),
        patches: Object.fromEntries(['errei', 'dificil', 'bom', 'facil'].map((g) => [g, E.schedule(c, g)]))
      });
    }
  }
}

// ── (2) DEGRADAÇÃO MEDIDA COM ARMAZENAMENTO REAL ────────────────────────────
// Uma sessão pelo caminho de produção completo: CardsScreen.answer() → DB →
// JSON.stringify → localStorage. Mede o custo POR RESPOSTA à medida que o
// histórico cresce. É o número que a 1ª rodada não podia produzir.
const degradacao = { escopo: 'CardsScreen.answer() com DB e localStorage reais', amostras: [] };
{
  const P = criarAmbiente({ now: DIA0 });
  P.reset({ algo: 'fsrs', newPerDay: 99999, revPerDay: 99999 });
  const hoje = P.hoje();
  P.DB.saveCards(Array.from({ length: 2000 }, (_, i) => ({
    id: 'p' + i, frente: 'Pergunta ' + i, verso: 'Resposta ' + i, phase: 'review',
    reps: 5, lapses: 1, s: 20, d: 5, intervalo: 10, due: hoje,
    lastReview: P.CardEngine.addDays(hoje, -10), status: 'sei'
  })));
  P.CardEngine.invalidateDueCache();
  const S2 = P.CardsScreen;
  S2._reviewQueue = S2.buildQueue(); S2._reviewIdx = 0; S2._undoStack = []; S2._seenThisSession = new Set();
  const LOTE = 250;
  let feitas = 0, t = performance.now();
  while (S2._reviewIdx < S2._reviewQueue.length && feitas < 2000) {
    S2.answer(['bom', 'facil', 'bom', 'dificil'][feitas % 4]);
    feitas++;
    if (feitas % LOTE === 0) {
      const agora = performance.now();
      degradacao.amostras.push({
        respostas: feitas,
        msPorResposta: +((agora - t) / LOTE).toFixed(3),
        revlog: P.DB.getRevlog().length,
        bytesArmazenados: P.bytes(),
        bytesEscritosAcumulados: P.estado.bytesEscritos
      });
      t = agora;
    }
  }
  const a = degradacao.amostras;
  degradacao.primeiroLote = a[0] || null;
  degradacao.ultimoLote = a.at(-1) || null;
  degradacao.fatorDeLentidao = a.length > 1 ? +(a.at(-1).msPorResposta / Math.max(1e-6, a[0].msPorResposta)).toFixed(1) : null;
  console.log('DEGRADACAO ' + JSON.stringify({ primeiro: degradacao.primeiroLote, ultimo: degradacao.ultimoLote, fator: degradacao.fatorDeLentidao }));
}

const relatorio = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RAIZ, encoding: 'utf8' }).trim(),
  semente: SEMENTE_INICIAL,
  escopo: 'Agendador, fila e configuração reais; relógio e armazenamento do harness. Não cobre navegador, nuvem, offline nem sincronização.',
  cenarios, degradacao
};
fs.writeFileSync(new URL('simulacao.json', SAIDA), JSON.stringify(relatorio, null, 2));
fs.writeFileSync(new URL('vetores.json', SAIDA), JSON.stringify(vetores));

const falhou = cenarios.some((c) => c.agendamentosInvalidos || c.divergenciaMemoria || c.previaDivergente
  || c.limiteNovosEstourado || c.limiteRevisoesEstourado || c.filaComRepetido || c.filaComSuspenso
  || c.filaComNaoVencido || c.regressaoDeReps || c.distintos < 5500);
console.log(falhou ? 'SIMULACAO: divergências encontradas' : 'SIMULACAO: todas as invariantes passaram');
process.exitCode = falhou ? 1 : 0;
