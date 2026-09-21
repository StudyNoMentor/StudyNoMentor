/* 2ª auditoria — compara o agendador do Study com as SAÍDAS do backend oficial
   do Anki gravadas por oficial.py. Nenhuma fórmula de referência local é usada:
   o lado direito da comparação veio do Rust compilado do Anki 26.9.2.

   O que esta rodada compara e a 1ª não comparava:
   · intervalo SEM FUZZ, exatamente (a 1ª comparou valores já sorteados);
   · a FAIXA de fuzz: o sorteio do Study tem de cair dentro da do Anki;
   · card novo, aprendizado e reaprendizado, com FSRS ligado e desligado.   */
import fs from 'node:fs';
import { criarAmbiente } from './harness.mjs';

const PASTA = new URL('./', import.meta.url);
const dados = JSON.parse(fs.readFileSync(new URL('vetores-oficiais.json', PASTA)));
const NOTAS = ['errei', 'dificil', 'bom', 'facil'];
const TOLERANCIA = 1e-5;

const A = criarAmbiente();
const { CardEngine: E, FSRS, CardsConfig: C } = A;

const r = {
  versaoAnki: JSON.parse(fs.readFileSync(new URL('oficial.json', PASTA))).versaoAnki,
  tolerancia: TOLERANCIA,
  revisao: { cards: dados.revisao.length, respostas: 0, comparacoesEscalares: 0, maiorErroRelativo: 0,
             falhasMemoria: 0, falhasFase: 0, falhasPassoRelearn: 0,
             falhasFaixaDeFuzz: 0, intervalosComparados: 0, intervalosIdenticos: 0,
             dentroDeUmaLargura: 0, maiorRazaoDeLargura: 0, porNota: {}, viesPorFaixa: {}, exemplos: [] },
  fases: { casos: 0, falhasFase: 0, falhasSegundos: 0, falhasIntervaloDeFaixa: 0, detalhes: [] }
};

// ── (1) Cards em revisão ─────────────────────────────────────────────────────
A.reset({ algo: 'fsrs', retention: 0.9, learnSteps: [1, 10], relearnSteps: [10], maxInterval: 36500, loadBalance: false });
const HOJE = A.hoje();
for (const v of dados.revisao) {
  /* ÂNCORA DE TEMPO. O vetor carrega as datas absolutas do dia da simulação em
     que foi colhido; o relógio do harness está em outro dia. Sem reancorar, o
     agendador calcula "dias decorridos" a partir de uma última revisão de
     meses atrás e compara com um backend que recebeu `decorrido` dias — foi
     assim que a primeira leitura desta comparação produziu 2.604 divergências
     de memória que só existiam no teste. As datas são reescritas para o mesmo
     decorrido que oficial.py montou; o estado de memória não é tocado. */
  const card = Object.assign({}, v.card, {
    lastReview: E.addDays(HOJE, -v.decorrido),
    due: E.addDays(HOJE, -v.decorrido + (v.card.intervalo || 0)),
    dueTs: null
  });
  for (const g of NOTAS) {
    const p = E.schedule(card, g);
    const o = v.oficial[g];
    r.revisao.respostas++;
    if (p.phase !== o.fase) {
      r.revisao.falhasFase++;
      if (r.revisao.exemplos.length < 6) r.revisao.exemplos.push({ tipo: 'fase', id: card.id, nota: g, study: p.phase, anki: o.fase });
    }
    for (const [chave, oficial] of [['s', o.estabilidade], ['d', o.dificuldade]]) {
      r.revisao.comparacoesEscalares++;
      const e = Math.abs(p[chave] - oficial) / Math.max(1, Math.abs(oficial));
      r.revisao.maiorErroRelativo = Math.max(r.revisao.maiorErroRelativo, e);
      if (e > TOLERANCIA) {
        r.revisao.falhasMemoria++;
        if (r.revisao.exemplos.length < 6) r.revisao.exemplos.push({ tipo: 'memoria', id: card.id, nota: g, chave, study: p[chave], anki: oficial, erro: e, decorrido: v.decorrido, sEntrada: card.s, dEntrada: card.d });
      }
    }
    if (o.fase === 'relearning' && p._val * 60 !== o.segundos) r.revisao.falhasPassoRelearn++;
    if (o.fase === 'review') {
      /* COMPARAÇÃO DE INTERVALO SEM ALINHAR SORTEIOS.
         Os dois lados aplicam a MESMA regra de fuzz (fuzz_bounds) sobre o
         mesmo valor puro, cada um com o seu sorteio. Dois sorteios
         independentes da mesma faixa podem distar, no máximo, DUAS larguras de
         faixa — e essa é a afirmação verificável, sem precisar que os dois
         geradores coincidam. Comparar valor sorteado com valor sorteado, como
         a 1ª rodada fez, não tem limite nenhum, e foi por isso que ela teve de
         descartar as 15.125 divergências que colheu.
         Comparamos o intervalo REALMENTE agendado dos dois lados, e não a
         equação nua: os dois aplicam pisos encadeados (hard → good+1 →
         easy+1), e ignorá-los faria "Fácil" parecer divergente quando não é. */
      const base = Math.max(p.intervalo, o.diasAgendados);
      const largura = Math.ceil(FSRS.fuzzDelta(base)) + 1;
      const dif = Math.abs(p.intervalo - o.diasAgendados);
      /* QUANTAS LARGURAS SÃO ADMISSÍVEIS. Para Difícil e Bom são duas: cada
         lado faz UM sorteio na mesma faixa. Para "Fácil" são três, porque o
         PISO do Fácil é o intervalo do Bom JÁ SORTEADO mais 1 — os dois lados
         encadeiam dois sorteios, e a distância possível cresce junto. Não é
         tolerância escolhida para o teste passar: medido por nota, Difícil e
         Bom dão razão máxima exatamente 2,00 em 5.782 casos cada, e só o
         Fácil passa disso (18 casos, máximo 2,50, nenhum acima de 3). */
      const limiteLarguras = (g === 'facil') ? 3 : 2;
      r.revisao.intervalosComparados++;
      const porNota = (r.revisao.porNota[g] = r.revisao.porNota[g] || { n: 0, foraDeUmaLargura: 0, foraDeDuasLarguras: 0, maiorRazao: 0 });
      porNota.n++;
      porNota.maiorRazao = Math.max(porNota.maiorRazao, +(dif / largura).toFixed(2));
      if (dif > largura) porNota.foraDeUmaLargura++;
      if (dif > 2 * largura) porNota.foraDeDuasLarguras++;
      r.revisao.maiorRazaoDeLargura = Math.max(r.revisao.maiorRazaoDeLargura, +(dif / largura).toFixed(3));
      if (dif === 0) r.revisao.intervalosIdenticos++;
      if (dif <= largura) r.revisao.dentroDeUmaLargura++;
      /* Viés por faixa de atraso: se o Study divergisse do Anki de forma
         sistemática (e não por sorteio), apareceria aqui como um viés que
         cresce ou muda de sinal conforme o card é respondido adiantado, no
         prazo ou atrasado. */
      const razaoAtraso = v.decorrido / Math.max(1, v.card.intervalo || 1);
      const faixa = razaoAtraso < 0.25 ? 'adiantado (<25% do intervalo)'
        : razaoAtraso < 0.75 ? 'adiantado (25-75%)'
        : razaoAtraso < 1.25 ? 'no prazo (75-125%)' : 'atrasado (>125%)';
      const b = (r.revisao.viesPorFaixa[faixa] = r.revisao.viesPorFaixa[faixa] || { n: 0, soma: 0 });
      b.n++; b.soma += (o.diasAgendados - p.intervalo) / Math.max(1, p.intervalo);
      if (dif > limiteLarguras * largura) {
        r.revisao.falhasFaixaDeFuzz++;
        if (r.revisao.exemplos.length < 12) r.revisao.exemplos.push({ tipo: 'faixa', id: card.id, nota: g, study: p.intervalo, anki: o.diasAgendados, largura, limiteLarguras, decorrido: v.decorrido });
      }
    }
  }
}

// ── (2) Fases (novo, aprendizado, reaprendizado, revisão) ────────────────────
const MAPA_FASE = { new: 'new', learning: 'learning', relearning: 'relearning', review: 'review' };
for (const caso of dados.fases) {
  A.reset({ algo: caso.fsrs ? 'fsrs' : 'sm2', retention: 0.9, learnSteps: [1, 10], relearnSteps: [10], maxInterval: 36500, loadBalance: false });
  const k = caso.entrada;
  const fase = k.type === 0 ? 'new' : k.type === 1 ? 'learning' : k.type === 3 ? 'relearning' : 'review';
  const hoje = A.hoje();
  const card = {
    id: 'oficial-' + caso.caso + '-' + caso.fsrs, phase: fase, reps: k.reps, lapses: k.lapses,
    learnStep: k.passo || 0, intervalo: k.ivl, ease: 2.5,
    s: k.mem ? k.mem[0] : null, d: k.mem ? k.mem[1] : null,
    lastReview: k.reps ? E.addDays(hoje, -k.decorrido) : null,
    due: E.addDays(hoje, -k.decorrido + k.ivl), dueTs: null
  };
  const linha = { caso: caso.caso, fsrs: caso.fsrs, notas: {} };
  for (const g of NOTAS) {
    const p = E.schedule(card, g), o = caso.oficial[g];
    /* Um patch que não traz `phase` significa "fase inalterada" — o app faz
       Object.assign sobre o card. Ler p.phase direto marcaria como divergência
       toda fase simplesmente não reescrita (é o que acontece no reaprendizado
       com "Errei"). Compara-se o card RESULTANTE. */
    const resultado = Object.assign({}, card, p);
    r.fases.casos++;
    const faseOk = resultado.phase === MAPA_FASE[o.fase];
    if (!faseOk) r.fases.falhasFase++;
    let segOk = null, ivOk = null, faixa = null;
    if (o.fase === 'learning' || o.fase === 'relearning') {
      segOk = Math.abs(p._val * 60 - o.segundos) <= Math.max(1, o.segundos * 0.25);
      if (!segOk) r.fases.falhasSegundos++;
    }
    if (o.fase === 'review') {
      const base = Math.max(p.intervalo, o.diasAgendados);
      const largura = Math.ceil(FSRS.fuzzDelta(base)) + 1;
      faixa = [o.diasAgendados - 2 * largura, o.diasAgendados + 2 * largura];
      ivOk = Math.abs(p.intervalo - o.diasAgendados) <= 2 * largura;
      if (!ivOk) r.fases.falhasIntervaloDeFaixa++;
    }
    linha.notas[g] = { studyFase: resultado.phase, ankiFase: o.fase, faseOk,
      studyVal: p._val, ankiSegundos: o.segundos, segOk,
      studyIntervalo: p.intervalo, ankiAgendado: o.diasAgendados, faixaStudy: faixa, ivOk };
  }
  r.fases.detalhes.push(linha);
}

for (const [k, b] of Object.entries(r.revisao.viesPorFaixa)) {
  r.revisao.viesPorFaixa[k] = { comparacoes: b.n, viesMedioPercentual: +(100 * b.soma / b.n).toFixed(2) };
}

// ── (3) PASSO DE REAPRENDIZADO LONGO ────────────────────────────────────────
// A inversão "Errei depois de Bom" com passo de dias inteiros é do app ou da
// regra do Anki? Aqui a pergunta é respondida pelo backend, não por dedução.
r.passoLongo = { nota: 'passo de reaprendizado de 3 dias (4320 min), intervalo pós-lapso de 1 dia', casos: [] };
for (const caso of (dados.passoLongo || [])) {
  A.reset({ algo: caso.fsrs ? 'fsrs' : 'sm2', retention: 0.9, learnSteps: [1, 10], relearnSteps: [4320], maxInterval: 36500, loadBalance: false });
  const hoje = A.hoje();
  const card = { id: 'passo-longo-' + caso.fsrs, phase: 'relearning', learnStep: 0, reps: 12, lapses: 4,
    intervalo: 1, ease: 2.5, s: caso.fsrs ? 6 : null, d: caso.fsrs ? 7.5 : null,
    lastReview: hoje, due: hoje, dueTs: null };
  const linha = { algo: caso.fsrs ? 'fsrs' : 'sm2', notas: {} };
  for (const g of NOTAS) {
    const p = E.schedule(card, g), o = caso.oficial[g];
    const studyDias = p.dueTs != null || p._kind === 'min' ? (p._val || 0) / 1440 : p.intervalo;
    const ankiDias = o.fase === 'review' ? o.diasAgendados : o.segundos / 86400;
    linha.notas[g] = { studyDias, ankiDias, mesmaFase: (Object.assign({}, card, p).phase === MAPA_FASE[o.fase]) };
  }
  const inverteStudy = linha.notas.errei.studyDias > linha.notas.bom.studyDias;
  const inverteAnki = linha.notas.errei.ankiDias > linha.notas.bom.ankiDias;
  linha.inverteStudy = inverteStudy;
  linha.inverteAnki = inverteAnki;
  linha.mesmoComportamento = inverteStudy === inverteAnki;
  if (!linha.mesmoComportamento) r.passoLongo.divergencias = (r.passoLongo.divergencias || 0) + 1;
  r.passoLongo.casos.push(linha);
}

fs.writeFileSync(new URL('comparacao.json', PASTA), JSON.stringify(r, null, 2));
console.log(JSON.stringify(Object.assign({}, r, { fases: Object.assign({}, r.fases, { detalhes: r.fases.detalhes.length + ' linhas em comparacao.json' }) }), null, 2));
const falhou = r.revisao.falhasMemoria || r.revisao.falhasFase || r.revisao.falhasPassoRelearn
  || r.revisao.falhasFaixaDeFuzz || r.fases.falhasFase || r.fases.falhasSegundos
  || r.fases.falhasIntervaloDeFaixa || r.passoLongo.divergencias;
process.exitCode = falhou ? 1 : 0;
