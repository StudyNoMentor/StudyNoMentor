/* 2ª auditoria dos cards — verificações funcionais endurecidas.
   Roda contra os módulos de produção, com armazenamento e relógio reais do
   harness. Cada verificação afirma uma INVARIANTE do código, não o que um
   comentário diz que o código faz. Sai com código 1 quando alguma falha.   */
import { criarAmbiente, criarRelatorio } from './harness.mjs';

const R = criarRelatorio('Módulos de produção 11-db / 30-fsrs / 31-cards-config / 32-card-engine / 44-tela-cards; DOM, download e rede dublados; armazenamento serializado de verdade.');
const A = criarAmbiente();
const { DB, CardsConfig: C, CardEngine: E, CardsScreen: S, FSRS } = A;
const check = (...a) => R.check(...a);
const finito = (x) => typeof x === 'number' && Number.isFinite(x);
const dataIso = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x));

// ─────────────────────────────────────────────────────────────────────────────
// A. ESCALA E PERSISTÊNCIA REAIS
// A 1ª rodada substituiu DB._get/_set por um Map de objetos vivos. Com isso o
// custo de serializar o histórico inteiro a cada resposta — e o limite de
// tamanho do localStorage — sumiram do teste. Aqui o armazenamento é real.
// ─────────────────────────────────────────────────────────────────────────────
{
  // Mede o custo REAL de gravar o histórico em dois pontos (N e 2N). Se a
  // gravação fosse O(1) amortizada, dobrar as entradas dobraria os bytes
  // escritos. Se reescrever o histórico inteiro a cada resposta, quadruplica.
  const medir = (n) => {
    A.reset();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      DB.addRevlog({ ts: A.agora() + i, cardId: 'card' + (i % 600), grade: 3, date: A.hoje(), elapsed: 5, intervalo: 10, s: 10, d: 5, acerto: true, phase: 'review' });
    }
    return { n, guardado: A.bytes(), escrito: A.estado.bytesEscritos, ms: performance.now() - t0 };
  };
  const m1 = medir(1500), m2 = medir(3000);
  const razao = m2.escrito / Math.max(1, m1.escrito);
  check('A1', 'Dobrar o histórico dobra o custo de gravação (O(1) amortizado), não quadruplica',
    razao < 3, { n1: m1.n, bytesEscritos1: m1.escrito, n2: m2.n, bytesEscritos2: m2.escrito, razao: Math.round(razao * 100) / 100, esperadoSeLinear: 2, esperadoSeQuadratico: 4 });

  const amplificacao = m2.escrito / Math.max(1, m2.guardado);
  check('A2', 'Gravar uma resposta não reescreve o histórico inteiro',
    amplificacao < 50, { entradas: m2.n, bytesGuardados: m2.guardado, bytesEscritos: m2.escrito, amplificacao: Math.round(amplificacao) });

  const porEntrada = m2.guardado / m2.n;
  check('A3', 'Sem banco relacional, a rede de segurança local do histórico cresce em lotes, não num blob único',
    m2.escrito < m2.guardado * 80, { bytesPorEntrada: Math.round(porEntrada), bytesGuardados: m2.guardado, bytesEscritos: m2.escrito });
}
{
  /* ── A PEGADA LOCAL NÃO PODE CRESCER COM O HISTÓRICO ─────────────────────
     O histórico é a única coleção sem teto: um ano de uso são ~180.000 linhas,
     que num único JSON dariam ~27 MB contra os ~5 MB de cota típica do
     localStorage — o limite chegaria por volta de 33.000 revisões. Com o banco
     relacional como dono do histórico, o armazenamento do navegador guarda
     apenas o que o banco ainda não confirmou. Esta verificação exige isso: o
     que fica gravado localmente tem de ser do tamanho do LOTE, não do ano. */
  const B = criarAmbiente();
  // Banco relacional disponível e em dia, que é o modo normal do app.
  // A confirmação é EXPLÍCITA por reviewId — pendingCount=0 sozinho não vale.
  B.ctx.RelationalStore = { enabled: true, isReady: () => true, pendingCount: () => 0,
    queueRevlogAppend: () => true, queueRevlogDelete: () => true, queueRevlogReplace: () => true };
  B.reset();
  const N = 6000;
  for (let i = 0; i < N; i++) {
    B.DB.addRevlog({ ts: B.agora() + i, cardId: 'card' + (i % 600), grade: 3, date: B.hoje(), elapsed: 5, intervalo: 10, s: 10, d: 5, acerto: true, phase: 'review' });
    const gravada = B.DB.getRevlog()[B.DB.getRevlog().length - 1];
    B.DB.confirmarRevlog(gravada.reviewId);
  }
  const guardadoLocal = B.bytes();
  const noLote = B.DB.LOTE_REVLOG * 300;   // teto generoso: LOTE linhas de ~300 B
  check('A4', 'Com o banco relacional ativo, o armazenamento local não cresce com o histórico',
    guardadoLocal <= noLote, { revisoes: N, bytesLocais: guardadoLocal, tetoDoLote: noLote, emRam: B.DB.getRevlog().length });
  check('A5', 'O histórico completo continua disponível para o app mesmo sem ficar no armazenamento local',
    B.DB.getRevlog().length === N, { emRam: B.DB.getRevlog().length, esperado: N });

  // Regressão do antigo falso ACK: uma fila vazia NÃO prova sucesso remoto.
  const antesSemAck = B.DB.getRevlogPendentes().length;
  B.DB.addRevlog({ ts: B.agora() + N + 1, cardId: 'sem-ack', grade: 3, date: B.hoje(), acerto: true, phase: 'review' });
  const depoisSemAck = B.DB.getRevlogPendentes().length;
  check('A5b', 'pendingCount=0 sem ACK explícito não apaga a revisão pendente',
    depoisSemAck === antesSemAck + 1, { antesSemAck, depoisSemAck });
}
{
  // Cota estourada: o app avisa, mas a resposta AVANÇA a fila mesmo sem ter
  // sido gravada. O que se perde não é o aviso — é a revisão.
  const Q = criarAmbiente({ quotaBytes: 120 * 1024 });
  Q.reset();
  const erroOriginal = console.error; console.error = () => {};
  const q = Q.CardsScreen;
  Q.DB.saveCards([{ id: 'q1', frente: 'F', verso: 'V', phase: 'review', s: 10, d: 5, reps: 3, intervalo: 10, due: Q.hoje(), lastReview: Q.CardEngine.addDays(Q.hoje(), -10) }]);
  let excecaoVazou = false;
  try { for (let i = 0; i < 4000; i++) Q.DB.addRevlog({ ts: i, cardId: 'q1', grade: 3, date: Q.hoje(), elapsed: 5, intervalo: 10, s: 10, d: 5, acerto: true, phase: 'review' }); }
  catch (_) { excecaoVazou = true; }
  const logsAntes = Q.DB.getRevlog().length;
  const cartaoAntes = JSON.stringify(Q.DB.getCard('q1'));
  q._reviewQueue = ['q1']; q._reviewIdx = 0; q._undoStack = []; q._seenThisSession = new Set();
  await q.answer('bom');
  console.error = erroOriginal;
  const gravou = cartaoAntes !== JSON.stringify(Q.DB.getCard('q1'));
  const avancou = q._reviewIdx > 0;
  check('A6', 'Com a cota do navegador estourada, a resposta não é dada por concluída sem ter sido gravada',
    gravou || !avancou, { excecaoVazou, revlogParado: logsAntes, agendamentoGravado: gravou, filaAvancou: avancou, desfazerEmpilhado: (q._undoStack || []).length, avisos: Q.estado.toasts.slice(-2) });
  check('A7', 'A escrita rejeitada pela cota não é reportada como sucesso por DB._set',
    Q.DB._set(Q.DB.KEYS.revlog, Q.DB.getRevlog().concat(Array.from({ length: 4000 }, (_, i) => ({ ts: 1e9 + i, cardId: 'q1', grade: 3 })))) === false,
    { nota: 'DB._set deve devolver false quando o localStorage recusa a gravação' });
}

// ─────────────────────────────────────────────────────────────────────────────
// B. CONFIGURAÇÃO VÁLIDA QUE O AGENDADOR NÃO SUPORTA
// A 1ª rodada só checou que CardsConfig PRESERVA passos vazios. Nunca mandou
// um card por esse caminho. Preservar uma configuração que o agendador não
// sabe executar é pior do que rejeitá-la.
// ─────────────────────────────────────────────────────────────────────────────
const agendamentoValido = (p) => dataIso(p.due) && (p.dueTs == null || finito(p.dueTs)) && (p._val == null || finito(p._val));
for (const algo of ['fsrs', 'sm2']) {
  A.reset({ algo, learnSteps: [], relearnSteps: [] });
  check('B1.' + algo, `${algo.toUpperCase()}: passos de aprendizado vazios — card novo com "Errei" recebe agendamento válido`,
    agendamentoValido(E.schedule({ id: 'b1', phase: 'new', reps: 0, due: A.hoje() }, 'errei')),
    E.schedule({ id: 'b1', phase: 'new', reps: 0, due: A.hoje() }, 'errei'));
  const rev = { id: 'b2', phase: 'review', reps: 9, s: 12, d: 6, intervalo: 30, due: A.hoje(), lastReview: E.addDays(A.hoje(), -30) };
  check('B2.' + algo, `${algo.toUpperCase()}: passos de reaprendizado vazios — revisão com "Errei" recebe agendamento válido`,
    agendamentoValido(E.schedule(rev, 'errei')), E.schedule(rev, 'errei'));
  const prev = E.previewIntervals({ id: 'b3', phase: 'new', reps: 0, due: A.hoje() });
  check('B3.' + algo, `${algo.toUpperCase()}: prévia dos quatro botões nunca devolve valor não numérico`,
    Object.values(prev).every((v) => finito(v.val)), prev);
  const rotulos = Object.values(prev).map((v) => E.fmtInterval(v));
  check('B4.' + algo, `${algo.toUpperCase()}: rótulo do botão nunca exibe NaN/undefined/null`,
    rotulos.every((t) => !/NaN|undefined|null/.test(t)), rotulos);
}
{
  // Progresso garantido: "Errei" repetido não pode deixar o card preso em um
  // estado que nunca vence nem nunca gradua.
  A.reset({ algo: 'fsrs', learnSteps: [], relearnSteps: [] });
  let c = { id: 'b5', phase: 'new', reps: 0, due: A.hoje() };
  let travou = false;
  for (let i = 0; i < 40; i++) {
    const p = E.schedule(c, 'errei');
    c = Object.assign({}, c, p);
    if (!agendamentoValido(p)) { travou = true; break; }
  }
  check('B5', 'FSRS sem passos: 40 "Errei" seguidos não travam o card em estado sem agendamento',
    !travou && c.phase === 'review' || agendamentoValido(c), { fase: c.phase, due: c.due, dueTs: c.dueTs, val: c._val });
}

// ─────────────────────────────────────────────────────────────────────────────
// C. INVARIANTES DO AGENDADOR SOBRE UMA MATRIZ GRANDE (property-based)
// A 1ª rodada testou 12 configurações inválidas. Aqui a matriz é de
// configurações VÁLIDAS, que é onde o usuário de verdade vive.
// ─────────────────────────────────────────────────────────────────────────────
{
  const CONFIGS = [];
  for (const algo of ['fsrs', 'sm2'])
    for (const learnSteps of [[1, 10], [25], [1, 10, 60, 1440], [0.5, 5]])
      for (const relearnSteps of [[10], [20, 1440], [1440 * 3]])
        for (const maxInterval of [36500, 365, 7, 1])
          for (const loadBalance of [false, true])
            CONFIGS.push({ algo, learnSteps, relearnSteps, maxInterval, loadBalance, retention: 0.9 });
  const FASES = ['new', 'learning', 'relearning', 'review'];
  const NOTAS = ['errei', 'dificil', 'bom', 'facil'];
  const ordemAbsoluta = (p, hoje) => (p.dueTs != null && Number.isFinite(p.dueTs))
    ? p.dueTs
    : Date.parse(p.due + 'T00:00:00') + 1e9;   // dias sempre depois de qualquer passo do dia
  let invalidos = 0, foraDoTeto = 0, foraDeOrdem = 0, repsRuim = 0, lapsesRuim = 0, previaDivergente = 0, total = 0, ordenaveis = 0, patologicos = 0;
  const exemplos = [];
  for (const cfg of CONFIGS) {
    A.reset(cfg);
    const hoje = A.hoje();
    for (const fase of FASES) {
      for (const atraso of [0, 1, 45]) {
        const base = {
          id: 'm-' + fase + '-' + atraso, phase: fase, reps: fase === 'new' ? 0 : 7,
          lapses: fase === 'new' ? 0 : 2, learnStep: fase === 'new' ? 0 : 1,
          s: fase === 'new' ? null : 14.5, d: fase === 'new' ? null : 6.2, ease: 2.5,
          intervalo: fase === 'review' ? 30 : 0,
          lastReview: fase === 'new' ? null : E.addDays(hoje, -Math.max(1, atraso)),
          due: E.addDays(hoje, -atraso), dueTs: null
        };
        DB.saveCards([base]);
        E.invalidateDueCache();
        const previa = E.previewIntervals(base);
        const patches = {};
        for (const g of NOTAS) {
          const p = E.schedule(base, g); patches[g] = p; total++;
          if (!dataIso(p.due) || (p.dueTs != null && !finito(p.dueTs)) || (cfg.algo === 'fsrs' && p.phase !== 'new' && (!finito(p.s) || !finito(p.d)))) {
            invalidos++; if (exemplos.length < 6) exemplos.push({ cfg, fase, atraso, g, p });
          }
          if (finito(p.intervalo) && p.intervalo > cfg.maxInterval) foraDoTeto++;
          /* Um patch que NÃO traz a chave significa "campo inalterado": o app
             faz Object.assign sobre o card. Comparar o patch cru marcaria como
             regressão todo campo simplesmente não tocado — foi assim que a 1ª
             leitura destes números inventou 3.168 falhas inexistentes. */
          const res = Object.assign({}, base, p);
          if ((res.reps || 0) !== (base.reps || 0) + 1) repsRuim++;
          if ((res.lapses || 0) < (base.lapses || 0)) lapsesRuim++;
          const pv = previa[g];
          if (!pv || pv.kind !== (p._kind || 'day') || pv.val !== (p._val != null ? p._val : p.intervalo)) previaDivergente++;
        }
        /* Um patch já contado como INVÁLIDO não pode ser contado de novo como
           fora de ordem: seria o mesmo defeito relatado duas vezes, com dois
           números diferentes. A ordem só é julgada onde os quatro são válidos. */
        const quatroValidos = NOTAS.every((g) => agendamentoValido(patches[g]));
        const t = NOTAS.map((g) => ordemAbsoluta(patches[g], hoje));
        /* Um passo de reaprendizado MAIOR que o intervalo máximo inverte a ordem
           por definição: "Errei" agenda pelo passo (3 dias), "Fácil" é cortado
           pelo teto (1 dia). O Anki oficial faz o mesmo — passo de aprendizado
           não passa pelo maximum_review_interval. Isso é patologia de
           configuração, não defeito do app, e é contado à parte para não
           contaminar a invariante. */
        /* A invariante só é exigível onde TODOS os passos cabem dentro de um
           dia. Com passo de vários dias, "Errei" agenda pelo passo e "Bom"
           gradua para o intervalo pós-lapso, que é menor — a inversão vem da
           configuração, e o backend oficial do Anki faz exatamente o mesmo
           (verificado em oficial.py, caso "passo longo"). Contar isso como
           defeito do app seria inventar um achado. */
        const passoLongo = Math.max(...cfg.learnSteps.concat(cfg.relearnSteps)) >= 1440;
        if (quatroValidos && !passoLongo) ordenaveis++;
        if (quatroValidos && passoLongo) patologicos++;
        if (quatroValidos && !passoLongo && !(t[0] <= t[1] && t[1] <= t[2] && t[2] <= t[3])) {
          foraDeOrdem++;
          if (exemplos.length < 12) exemplos.push({ cfg, fase, atraso, ordem: NOTAS.map((g, i) => [g, patches[g]._kind, patches[g]._val, t[i]]) });
        }
      }
    }
  }
  check('C1', 'Nenhuma configuração válida produz agendamento inválido (due NaN, dueTs NaN, S/D não finitos)', invalidos === 0, { total, invalidos, exemplos: exemplos.slice(0, 3) });
  check('C2', 'Nenhum intervalo ultrapassa o intervalo máximo configurado', foraDoTeto === 0, { total, foraDoTeto });
  check('C3', 'Os quatro botões ficam sempre em ordem crescente de tempo (Errei ≤ Difícil ≤ Bom ≤ Fácil)', foraDeOrdem === 0, { casosJulgados: ordenaveis, foraDeOrdem, excluidosPorPassoDeDiasInteiros: patologicos, exemplos: exemplos.filter((x) => x.ordem).slice(0, 3) });
  check('C4', 'reps incrementa exatamente 1 e lapses nunca decresce em toda a matriz', repsRuim === 0 && lapsesRuim === 0, { repsRuim, lapsesRuim });
  check('C5', 'A prévia do botão é idêntica ao que será gravado (inclusive com balanceamento ligado)', previaDivergente === 0, { total, previaDivergente });
}

// ─────────────────────────────────────────────────────────────────────────────
// D. FILA E LIMITES DIÁRIOS
// ─────────────────────────────────────────────────────────────────────────────
{
  A.reset({ newPerDay: 20, revPerDay: 200 });
  C.setDeckPreset('d-novo', { newPerDay: 3 });
  C.setDeckPreset('d-rev', { revPerDay: 2 });
  const hoje = A.hoje();
  const cards = [];
  for (let i = 0; i < 20; i++) cards.push({ id: 'n' + i, deckId: 'd-novo', phase: 'new', due: hoje, posicaoNova: i });
  for (let i = 0; i < 20; i++) cards.push({ id: 'r' + i, deckId: 'd-rev', phase: 'review', due: hoje, intervalo: 10, s: 10, d: 5, reps: 4, lastReview: E.addDays(hoje, -10) });
  DB.saveCards(cards); E.invalidateDueCache();
  const q = S.buildQueue();
  const novosNaFila = q.filter((x) => x.startsWith('n')).length;
  const revsNaFila = q.filter((x) => x.startsWith('r')).length;
  check('D1', 'Limite de novos por baralho é respeitado', novosNaFila === 3, { esperado: 3, obtido: novosNaFila });
  check('D2', 'Limite de revisões por baralho é respeitado', revsNaFila === 2, { esperado: 2, obtido: revsNaFila });
  check('D3', 'A fila nunca repete um id', new Set(q).size === q.length, { tamanho: q.length, distintos: new Set(q).size });
}
{
  A.reset({ newPerDay: 50, revPerDay: 5 });
  const hoje = A.hoje();
  const cards = [];
  for (let i = 0; i < 10; i++) cards.push({ id: 'i' + i, phase: 'learning', due: hoje, dueTs: null, learnStep: 1, s: 2, d: 5, reps: 2 });
  for (let i = 0; i < 10; i++) cards.push({ id: 'r' + i, phase: 'review', due: hoje, intervalo: 10, s: 10, d: 5, reps: 4, lastReview: E.addDays(hoje, -10) });
  DB.saveCards(cards); E.invalidateDueCache();
  const q = S.buildQueue();
  const inter = q.filter((x) => x.startsWith('i')).length, rev = q.filter((x) => x.startsWith('r')).length;
  check('D4', 'Aprendizado entre dias divide o MESMO teto de revisões (Anki), não um teto próprio',
    inter + rev <= 5, { interday: inter, review: rev, teto: 5 });
  check('D5', 'Com o teto de revisões esgotado, os novos param por padrão (newCardsIgnoreReviewLimit=false)',
    q.filter((x) => x.startsWith('n')).length === 0, { fila: q.length });
}
{
  A.reset({ newPerDay: 50, revPerDay: 5, newCardsIgnoreReviewLimit: true });
  const hoje = A.hoje();
  DB.saveCards([...Array.from({ length: 10 }, (_, i) => ({ id: 'n' + i, phase: 'new', due: hoje, posicaoNova: i })),
                ...Array.from({ length: 10 }, (_, i) => ({ id: 'r' + i, phase: 'review', due: hoje, intervalo: 10, s: 10, d: 5, reps: 4, lastReview: E.addDays(hoje, -10) }))]);
  E.invalidateDueCache();
  const q = S.buildQueue();
  check('D6', 'newCardsIgnoreReviewLimit=true libera os novos mesmo com revisões esgotadas',
    q.filter((x) => x.startsWith('n')).length === 10, { novos: q.filter((x) => x.startsWith('n')).length });
}
{
  // O piso de novos só se aplica quando o teto de revisões já está esgotado;
  // com saldo de revisões sobrando, o limite de novos continua sendo newPerDay.
  A.reset({ newPerDay: 50, revPerDay: 0, newPerDayMinimum: 4 });
  const hoje = A.hoje();
  DB.saveCards([...Array.from({ length: 10 }, (_, i) => ({ id: 'n' + i, phase: 'new', due: hoje, posicaoNova: i })),
                ...Array.from({ length: 30 }, (_, i) => ({ id: 'r' + i, phase: 'review', due: hoje, intervalo: 10, s: 10, d: 5, reps: 4, lastReview: E.addDays(hoje, -10) }))]);
  E.invalidateDueCache();
  const q = S.buildQueue();
  check('D7', 'newPerDayMinimum garante o piso de novos mesmo com acúmulo de revisões',
    q.filter((x) => x.startsWith('n')).length === 4, { novos: q.filter((x) => x.startsWith('n')).length, esperado: 4 });
}
{
  A.reset({ newPerDay: 20, revPerDay: 200 });
  const hoje = A.hoje();
  DB.saveCards([
    { id: 'susp', phase: 'review', due: hoje, suspenso: true, intervalo: 5, s: 5, d: 5, reps: 2, lastReview: E.addDays(hoje, -5) },
    { id: 'ent', phase: 'review', due: hoje, enterradoAte: E.addDays(hoje, 1), intervalo: 5, s: 5, d: 5, reps: 2, lastReview: E.addDays(hoje, -5) },
    { id: 'futuro', phase: 'review', due: E.addDays(hoje, 3), intervalo: 5, s: 5, d: 5, reps: 2, lastReview: hoje },
    { id: 'passo', phase: 'learning', due: hoje, dueTs: A.agora() + 9 * 60000, learnStep: 0 },
    { id: 'ok', phase: 'review', due: hoje, intervalo: 5, s: 5, d: 5, reps: 2, lastReview: E.addDays(hoje, -5) }
  ]);
  E.invalidateDueCache();
  const q = S.buildQueue();
  check('D8', 'A fila exclui suspenso, enterrado, vencimento futuro e passo ainda não vencido',
    q.length === 1 && q[0] === 'ok', { fila: q });
  check('D9', '"Learn ahead" (20 min) traz o passo pendente e continua excluindo o enterrado',
    S._learnAheadQueue().join(',') === 'passo', { antecipados: S._learnAheadQueue() });
}
{
  // Intercalador proporcional: vetores do próprio Anki (intersperser.rs).
  A.reset();
  DB.saveCards([]); S.buildQueue();
  const inter = E._intercalar;
  const casos = [
    [['a'], ['1', '2', '3', '4'], 5],
    [['a', 'b'], ['1', '2', '3', '4', '5', '6'], 8],
    [[], ['1', '2'], 2],
    [['a', 'b'], [], 2]
  ];
  let ok = true, saidas = [];
  for (const [um, dois, n] of casos) {
    const out = inter(um, dois); saidas.push(out.join(''));
    if (out.length !== n || new Set(out).size !== n) ok = false;
    // todo item de `um` aparece exatamente uma vez e nunca em bloco no fim
    if (um.length && dois.length && out.slice(-um.length).every((x) => um.includes(x))) ok = false;
  }
  check('D10', 'Mistura de novos com revisões é proporcional (não amontoa no fim nem sorteia)', ok, { saidas });
}
{
  // Sessão real via CardsScreen.answer(): o limite diário tem de valer durante
  // a sessão inteira, não só na montagem da fila.
  A.reset({ newPerDay: 5, revPerDay: 0, algo: 'fsrs' });
  const hoje = A.hoje();
  DB.saveCards(Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, frente: 'F' + i, verso: 'V' + i, phase: 'new', due: hoje, posicaoNova: i, status: 'pendente' })));
  E.invalidateDueCache();
  S._reviewQueue = S.buildQueue(); S._reviewIdx = 0; S._undoStack = []; S._seenThisSession = new Set();
  let tentativas = 0, confirmadas = 0;
  while (S._reviewIdx < S._reviewQueue.length && tentativas < 400) {
    const ok = await S.answer(['bom', 'errei', 'facil', 'dificil'][tentativas % 4]);
    tentativas++;
    if (ok === true) confirmadas++;
  }
  const introduzidos = C.newDoneToday();
  check('D11', 'Ao longo de uma sessão real, o limite de novos do dia é respeitado e realmente exercitado',
    introduzidos === 5 && confirmadas > 0, { introduzidosHoje: introduzidos, limite: 5, tentativas, confirmadas });
  check('D12', 'Nenhum card confirmado foi gravado com agendamento inválido durante a sessão real',
    confirmadas > 0 && DB.getCards().every((c) => dataIso(c.due) && (c.dueTs == null || finito(c.dueTs))),
    { confirmadas, ruins: DB.getCards().filter((c) => !dataIso(c.due) || (c.dueTs != null && !finito(c.dueTs))).slice(0, 3) });
  check('D13', 'A sessão real grava exatamente uma linha de histórico por resposta CONFIRMADA',
    confirmadas > 0 && DB.getRevlog().length === confirmadas,
    { revlog: DB.getRevlog().length, tentativas, confirmadas });
  const ids = DB.getRevlog().map(r => r.reviewId).filter(Boolean);
  check('D14', 'Cada revisão confirmada tem identidade estável e única para replay idempotente',
    ids.length === confirmadas && new Set(ids).size === ids.length,
    { ids: ids.length, unicos: new Set(ids).size, confirmadas });
}

// ─────────────────────────────────────────────────────────────────────────────
// E. ENTERRAR / SUSPENDER / ESQUECER / DESFAZER
// ─────────────────────────────────────────────────────────────────────────────
{
  A.reset();
  const hoje = A.hoje(), ts = A.agora() + 600000;
  DB.saveCards([{ id: 'e1', phase: 'learning', due: hoje, dueTs: ts, learnStep: 0 }]);
  DB.buryCard('e1');
  check('E1', 'Enterrar tira o card da fila sem destruir o passo intradiário',
    !E.isDue(DB.getCard('e1')) && DB.getCard('e1').dueTsAntesEnterrar === ts, DB.getCard('e1'));
  DB.unburyCard('e1');
  check('E2', 'Desenterrar devolve o horário intradiário original', DB.getCard('e1').dueTs === ts, DB.getCard('e1'));
}
{
  A.reset();
  DB._set(DB.KEYS.revlog, []);
  DB.addRevlog({ ts: 1, cardId: 'A' }); DB.addRevlog({ ts: 1, cardId: 'B' });
  DB.removeRevlog(1);
  check('E3', 'Com timestamps colididos, desfazer remove a revisão MAIS RECENTE',
    DB.getRevlog().length === 1 && DB.getRevlog()[0].cardId === 'A', DB.getRevlog());
}
{
  // Desfazer agressivo: 60 respostas encadeadas, desfeitas até o início.
  // O estado tem de voltar IDÊNTICO — card, histórico e contadores.
  A.reset({ algo: 'fsrs', newPerDay: 999, revPerDay: 999 });
  const hoje = A.hoje();
  const inicial = Array.from({ length: 12 }, (_, i) => ({
    id: 'u' + i, frente: 'F' + i, verso: 'V' + i, phase: 'review', reps: 3, lapses: 1,
    s: 9 + i, d: 5, intervalo: 10, due: hoje, lastReview: E.addDays(hoje, -10), status: 'sei', suspenso: false
  }));
  DB.saveCards(JSON.parse(JSON.stringify(inicial)));
  E.invalidateDueCache();
  const semVolateis = (l) => JSON.stringify(l.map((c) => { const x = Object.assign({}, c); delete x.updatedAt; return x; }));
  const antes = semVolateis(DB.getCards());
  S._reviewQueue = S.buildQueue(); S._reviewIdx = 0; S._undoStack = []; S._seenThisSession = new Set();
  let n = 0;
  while (S._reviewIdx < S._reviewQueue.length && n < 60) {
    const ok = await S.answer(['errei', 'dificil', 'bom', 'facil'][n % 4]);
    if (ok !== true) break;
    n++;
  }
  while ((S._undoStack || []).length) S.undoAnswer();
  const depois = semVolateis(DB.getCards());
  check('E4', `Desfazer ${n} respostas encadeadas devolve os cards ao estado anterior (ignorando updatedAt)`,
    antes === depois, { respostas: n, diferenca: antes === depois ? null : primeiraDiferenca(JSON.parse(antes), JSON.parse(depois)) });
  const transitorios = DB.getCards().filter((c) => '_kind' in c || '_val' in c || '_leechNow' in c);
  check('E4b', 'Campos transitórios da prévia (_kind/_val/_leechNow) não são gravados no card',
    transitorios.length === 0, { cardsPoluidos: transitorios.length, exemplo: transitorios[0] });
  check('E5', 'Desfazer tudo esvazia o histórico gravado na sessão', DB.getRevlog().length === 0, { revlog: DB.getRevlog().length });
  check('E6', 'Desfazer tudo zera os contadores diários', C.newDoneToday() === 0 && C.revDoneToday() === 0, { novos: C.newDoneToday(), revisoes: C.revDoneToday() });
}
{
  A.reset();
  DB.saveCards([{ id: 'f1', phase: 'review', s: 10, d: 5, reps: 9, lapses: 4, intervalo: 40, due: A.hoje(), ease: 1.9, leech: true, status: 'sei', lastReview: E.addDays(A.hoje(), -40) }]);
  DB.forgetCard('f1');
  const c = DB.getCard('f1');
  check('E7', 'Esquecer devolve o card ao estado novo por completo',
    c.phase === 'new' && c.s === null && c.d === null && c.reps === 0 && c.lapses === 0 && c.intervalo === 0 && c.leech === false && c.lastReview === null, c);
}

// ─────────────────────────────────────────────────────────────────────────────
// E7–E9. NOTAS / IRMÃOS / CARTÃO INVERTIDO
// ─────────────────────────────────────────────────────────────────────────────
{
  A.reset();
  const noteId = 'nota-par';
  const f = DB.addCard({ noteId, template:'forward', frente:'Pergunta', verso:'Resposta', kind:'basic' });
  const r = DB.addCard({ noteId, template:'reverse', frente:'Resposta', verso:'Pergunta', kind:'basic', reversedOf:f.id });
  DB.updateCard(f.id, { phase:'review', intervalo:30, s:15, d:5 });
  DB.updateCard(r.id, { phase:'review', intervalo:7, s:6, d:6 });
  const schedF = { intervalo:DB.getCard(f.id).intervalo, s:DB.getCard(f.id).s };
  const schedR = { intervalo:DB.getCard(r.id).intervalo, s:DB.getCard(r.id).s };

  DB.updateCardNote(r.id, { frente:'Resposta EDITADA', verso:'Pergunta EDITADA', assunto:'X', kind:'basic' });
  const ff = DB.getCard(f.id), rr = DB.getCard(r.id);
  check('E7', 'Normal e invertido compartilham a mesma nota e mantêm faces espelhadas ao editar qualquer irmão',
    ff.noteId === rr.noteId && ff.frente === 'Pergunta EDITADA' && ff.verso === 'Resposta EDITADA'
      && rr.frente === 'Resposta EDITADA' && rr.verso === 'Pergunta EDITADA',
    { forward:{frente:ff.frente,verso:ff.verso,noteId:ff.noteId}, reverse:{frente:rr.frente,verso:rr.verso,noteId:rr.noteId} });
  check('E8', 'Editar a nota não mistura o agendamento independente dos dois cards',
    ff.intervalo === schedF.intervalo && ff.s === schedF.s && rr.intervalo === schedR.intervalo && rr.s === schedR.s,
    { forward:{antes:schedF,depois:{intervalo:ff.intervalo,s:ff.s}}, reverse:{antes:schedR,depois:{intervalo:rr.intervalo,s:rr.s}} });

  const legacyF={id:'lf',frente:'A',verso:'B',kind:'basic'}, legacyR={id:'lr',frente:'B',verso:'A',kind:'basic',reversedOf:'lf'};
  DB.saveCards([legacyF,legacyR]);
  const normalizados=DB.normalizeCardNotesInPlace();
  const lf=DB.getCard('lf'), lr=DB.getCard('lr');
  check('E9', 'Par invertido legado é migrado para uma nota compartilhada sem recriar cards',
    normalizados > 0 && lf.noteId === lr.noteId && lf.template === 'forward' && lr.template === 'reverse' && DB.getCards().length === 2,
    { normalizados, forward:lf, reverse:lr });

  DB.addRevlog({ ts:A.agora()+1, cardId:'lf', grade:3, date:A.hoje(), acerto:true, phase:'review' });
  DB.addRevlog({ ts:A.agora()+2, cardId:'lr', grade:3, date:A.hoje(), acerto:true, phase:'review' });
  const removidos=DB.deleteNoteByCard('lr');
  check('E10', 'Excluir um card irmão pela interface lógica exclui a nota inteira, seus cards e seus revlogs',
    removidos === 2 && DB.getCard('lf') == null && DB.getCard('lr') == null
      && DB.getRevlog().every(x => x.cardId !== 'lf' && x.cardId !== 'lr'),
    { removidos, cards:DB.getCards().length, revlog:DB.getRevlog().length });
}

// ─────────────────────────────────────────────────────────────────────────────
// F. IMPORTAÇÃO / EXPORTAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
{
  A.reset();
  const hoje = A.hoje();
  const originais = Array.from({ length: 1500 }, (_, i) => ({
    id: 'c' + i, frente: '<b>F' + i + '</b>', verso: 'V' + i, phase: 'review', s: 30 + i / 100, d: 5, reps: 20,
    lapses: 2, intervalo: 30, due: '2026-10-01', lastReview: '2026-09-01', status: 'sei', favorito: i % 3 === 0,
    flag: i % 7, deckId: null, ease: 2.5, learnStep: 0, dueTs: null
  }));
  DB.saveCards(JSON.parse(JSON.stringify(originais)));
  for (let i = 0; i < 1500; i++) DB.addRevlog({ ts: 1e12 + i, cardId: 'c' + (i % 1500), grade: 3, date: hoje, elapsed: 5, intervalo: 30 });
  S.exportJson();
  const backup = JSON.parse(A.estado.downloads.at(-1).content);
  check('F1', 'O backup de cards carrega decks, cards e histórico',
    Array.isArray(backup.cards) && Array.isArray(backup.revlog) && backup.cards.length === 1500 && backup.revlog.length === 1500,
    { chaves: Object.keys(backup), cards: backup.cards?.length, revlog: backup.revlog?.length });

  // Restauração em coleção VAZIA
  A.reset();
  S._importParsed = { kind: 'json', cards: backup.cards, decks: backup.decks || [], revlog: backup.revlog };
  S.doImport();
  const rest = DB.getCards();
  const igual = rest.length === 1500 && rest.every((c, i) => {
    const o = originais[i];
    return c.frente === o.frente && c.verso === o.verso && c.phase === o.phase && c.s === o.s
      && c.reps === o.reps && c.lapses === o.lapses && c.intervalo === o.intervalo && c.due === o.due
      && c.lastReview === o.lastReview && c.favorito === o.favorito && c.flag === o.flag;
  });
  check('F2', 'Restaurar o backup preserva conteúdo, memória, agendamento, favoritos e bandeiras', igual,
    { cards: rest.length, primeiro: rest[0], esperado: originais[0] });
  check('F3', 'Restaurar o backup traz o histórico de revisões junto', DB.getRevlog().length === 1500, { revlog: DB.getRevlog().length });
  check('F4', 'As posições do histórico restaurado são estritamente crescentes e sem colisão',
    (() => { const p = DB.getRevlog().map((r) => r._position); return new Set(p).size === p.length && p.every((x, i) => i === 0 || x > p[i - 1]); })(),
    { primeiras: DB.getRevlog().slice(0, 3).map((r) => r._position) });

  // Restauração REPETIDA do MESMO backup: restaurar duas vezes não pode duplicar.
  S._importParsed = { kind: 'json', cards: backup.cards, decks: backup.decks || [], revlog: backup.revlog };
  S.doImport();
  check('F5', 'Aplicar o mesmo backup duas vezes não duplica a coleção (restauração x importação)',
    DB.getCards().length === 1500 && DB.getRevlog().length === 1500,
    { cards: DB.getCards().length, revlog: DB.getRevlog().length, nota: 'restaurar backup deve ser idempotente; importar conteúdo novo é outra operação' });
}
{
  A.reset();
  const casos = [
    ['"frente, com vírgula",verso,tag', 'frente, com vírgula', 'verso'],
    ['"aspas ""duplas"" dentro",verso,tag', 'aspas "duplas" dentro', 'verso'],
    ['"linha 1\nlinha 2",verso,tag', 'linha 1\nlinha 2', 'verso'],
    ['"tem # no meio\n#continuação",verso,tag', 'tem # no meio\n#continuação', 'verso']
  ];
  casos.forEach(([txt, f, v], i) => {
    const r = S.parseAnkiText(txt);
    check('F6.' + (i + 1), 'CSV: ' + txt.split('\n')[0].slice(0, 38) + '…', r[0]?.frente === f && r[0]?.verso === v, { obtido: r[0], esperado: { frente: f, verso: v } });
  });
  const tsv = Array.from({ length: 6000 }, (_, i) => 'F' + i + '\tV' + i + '\ttag').join('\n');
  check('F7', 'TSV de 6.000 linhas é lido por completo', S.parseAnkiText(tsv).length === 6000, { linhas: S.parseAnkiText(tsv).length });
}
{
  A.reset();
  DB.saveCards([{ id: 'rich', frente: '<b>Negrito</b><img src="imagem.png">', verso: '<audio src="a.mp3"></audio>Resposta', phase: 'new', assunto: 'Tópico' }]);
  S.exportAnki();
  const txt = A.estado.downloads.at(-1).content;
  check('F8', 'Exportar para o Anki preserva imagem, áudio e formatação',
    txt.includes('imagem.png') && txt.includes('a.mp3') && txt.includes('<b>Negrito</b>'), { conteudo: txt });
  const volta = S.parseAnkiText(txt);
  check('F9', 'Round-trip exportar→importar no formato Anki preserva frente e verso',
    volta.length === 1 && volta[0].frente === '<b>Negrito</b><img src="imagem.png">' && volta[0].verso === '<audio src="a.mp3"></audio>Resposta',
    { obtido: volta[0] });
}

// ─────────────────────────────────────────────────────────────────────────────
// G. LEECH
// ─────────────────────────────────────────────────────────────────────────────
{
  const disparos = (limiar, acao) => {
    A.reset({ algo: 'sm2', leechThreshold: limiar, leechAction: acao, relearnSteps: [] });
    let c = { id: 'g1', phase: 'review', reps: 5, lapses: 0, intervalo: 10, ease: 2.5, due: A.hoje(), lastReview: E.addDays(A.hoje(), -10) };
    const marcados = [];
    for (let i = 0; i < 30; i++) {
      const p = E.schedule(c, 'errei');
      if (p._leechNow) marcados.push(p.lapses);
      c = Object.assign({}, c, p, { suspenso: false, phase: 'review', intervalo: 10, due: A.hoje(), lastReview: E.addDays(A.hoje(), -10) });
    }
    return marcados;
  };
  check('G1', 'Limiar par (8): alerta em 8, 12, 16… (metade arredondada para cima)',
    JSON.stringify(disparos(8, 'tag').slice(0, 4)) === JSON.stringify([8, 12, 16, 20]), { obtido: disparos(8, 'tag').slice(0, 6) });
  check('G2', 'Limiar ímpar (5): alerta em 5, 8, 11… sem pular lapsos',
    JSON.stringify(disparos(5, 'tag').slice(0, 4)) === JSON.stringify([5, 8, 11, 14]), { obtido: disparos(5, 'tag').slice(0, 6) });
  A.reset({ algo: 'sm2', leechThreshold: 3, leechAction: 'tag', relearnSteps: [] });
  let c1 = { id: 'g2', phase: 'review', reps: 5, lapses: 2, intervalo: 10, ease: 2.5, due: A.hoje(), lastReview: E.addDays(A.hoje(), -10) };
  const pTag = E.schedule(c1, 'errei');
  A.reset({ algo: 'sm2', leechThreshold: 3, leechAction: 'suspender', relearnSteps: [] });
  const pSusp = E.schedule(c1, 'errei');
  check('G3', 'leechAction "tag" marca sem suspender; qualquer outra ação suspende',
    pTag.leech === true && !pTag.suspenso && pSusp.leech === true && pSusp.suspenso === true, { tag: pTag.suspenso, suspender: pSusp.suspenso });
}

{
  /* Ao sair do reaprendizado, o Anki impõe "Fácil ≥ Bom + 1" — conferido no
     backend oficial (26.9.2): com passo de 3 dias e intervalo pós-lapso de
     1 dia, ele devolve Bom = 1 dia e Fácil = 2 dias. No modo Clássico o app
     devolve o MESMO intervalo para os dois: acertar com folga um card que
     estava em reaprendizado não rende nada. A invariante de ordem C3 não pega
     isto porque ela aceita empate; aqui a exigência é estrita, como no Anki. */
  const pares = [];
  for (const relearnSteps of [[10], [4320], [10, 20]]) {
    A.reset({ algo: 'sm2', learnSteps: [1, 10], relearnSteps });
    const c = { id: 'g4', phase: 'relearning', learnStep: relearnSteps.length - 1, reps: 12, lapses: 4,
      intervalo: 7, ease: 2.5, due: A.hoje(), lastReview: A.hoje() };
    pares.push({ relearnSteps, bom: E.schedule(c, 'bom').intervalo, facil: E.schedule(c, 'facil').intervalo });
  }
  check('G4', 'Sair do reaprendizado com "Fácil" rende mais do que com "Bom" (Anki: Fácil ≥ Bom + 1)',
    pares.every((x) => x.facil > x.bom), { pares, referencia: 'anki 26.9.2: bom=1 dia, facil=2 dias na mesma configuração' });
}

// ─────────────────────────────────────────────────────────────────────────────
// H. VIRADA DO DIA E PASSOS LONGOS
// ─────────────────────────────────────────────────────────────────────────────
{
  // Passo que atravessa a virada das 4h tem de virar agendamento por DIA.
  const N = criarAmbiente({ now: Date.parse('2026-09-21T02:00:00'), rolloverHour: 4 });
  N.reset({ algo: 'fsrs', learnSteps: [1, 180] });   // 180 min = 3h, cruza as 4h
  const p = N.CardEngine.schedule({ id: 'h1', phase: 'learning', learnStep: 0, reps: 1, s: 1, d: 6, due: N.hoje(), lastReview: N.hoje() }, 'bom');
  check('H1', 'Passo que ultrapassa a virada das 4h passa a ser agendado por DIA, não por horário',
    p.dueTs === null && p.due > N.hoje(), { due: p.due, dueTs: p.dueTs, hoje: N.hoje() });

  const M = criarAmbiente({ now: Date.parse('2026-09-21T09:00:00'), rolloverHour: 4 });
  M.reset({ algo: 'fsrs', learnSteps: [1, 10] });
  const q = M.CardEngine.schedule({ id: 'h2', phase: 'learning', learnStep: 0, reps: 1, s: 1, d: 6, due: M.hoje(), lastReview: M.hoje() }, 'bom');
  check('H2', 'Passo curto no meio do dia continua agendado por horário, com fuzz dentro do teto do Anki',
    q.dueTs != null && q.dueTs > Date.parse('2026-09-21T09:00:00') && q.dueTs <= Date.parse('2026-09-21T09:00:00') + (600 + 150) * 1000,
    { dueTs: q.dueTs, minimo: 600, tetoFuzz: 750 });
}
{
  // O card não pode desaparecer na virada: vence hoje às 23h, continua vencido às 3h.
  const N = criarAmbiente({ now: Date.parse('2026-09-21T23:00:00'), rolloverHour: 4 });
  N.reset();
  N.DB.saveCards([{ id: 'h3', phase: 'review', due: N.hoje(), intervalo: 5, s: 5, d: 5, reps: 3, lastReview: N.CardEngine.addDays(N.hoje(), -5) }]);
  const antes = N.CardEngine.isDue(N.DB.getCard('h3'));
  N.avancar(4 * 3600e3);   // 03:00 do dia seguinte, ainda antes da virada
  const depois = N.CardEngine.isDue(N.DB.getCard('h3'));
  check('H3', 'Card vencido às 23h continua vencido às 3h (o dia do card só vira às 4h)', antes && depois, { antes, depois, dia: N.hoje() });
}

// ─────────────────────────────────────────────────────────────────────────────
// I. CUSTO DE MONTAR A FILA
// Medição, não suposição: a fila é remontada a cada renderização da tela de
// revisão. Se o custo crescesse com o quadrado da coleção, o app travaria numa
// coleção grande sem nenhum erro aparecer.
// ─────────────────────────────────────────────────────────────────────────────
{
  const medirFila = (n) => {
    const P = criarAmbiente();
    let proj = [], idx = new Map();
    P.DB.getCards = () => proj;
    P.DB.saveCards = (l) => { proj = l; idx = new Map(proj.map((c) => [String(c.id), c])); };
    P.DB.getCard = (id) => idx.get(String(id)) || null;
    P.reset({ algo: 'fsrs', newPerDay: 30, revPerDay: 300 });
    const hoje = P.hoje();
    P.DB.saveCards(Array.from({ length: n }, (_, i) => ({ id: 'q' + i, phase: 'review', reps: 5, lapses: 0, s: 10, d: 5, intervalo: 10, due: hoje, lastReview: P.CardEngine.addDays(hoje, -10) })));
    P.CardEngine.invalidateDueCache();
    const fila = P.CardsScreen.buildQueue();
    for (let i = 0; i < 300 && i < fila.length; i++) P.CardsConfig.markIntroduced('review', fila[i]);
    const t = performance.now(); P.CardsScreen.buildQueue();
    return +(performance.now() - t).toFixed(1);
  };
  const m3 = medirFila(3000), m12 = medirFila(12000);
  check('I1', 'Montar a fila cresce de forma linear com a coleção, não quadrática',
    m12 < m3 * 8 && m12 < 400, { ms3000: m3, ms12000: m12, razao: +(m12 / Math.max(0.1, m3)).toFixed(1), esperadoSeLinear: 4, esperadoSeQuadratico: 16 });
}

function primeiraDiferenca(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = JSON.stringify(a[i]), y = JSON.stringify(b[i]);
    if (x !== y) return { indice: i, antes: a[i], depois: b[i] };
  }
  return null;
}

R.gravar(new URL('regressao.json', import.meta.url));
process.exitCode = R.imprimir() ? 1 : 0;
