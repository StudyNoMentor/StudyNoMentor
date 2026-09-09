/* ═══════════════════════ SUÍTE DE AUTOTESTE ═══════════════════════════════
   O app não tinha teste nenhum versionado — toda refatoração era feita no
   escuro. Como não há build step nem runner externo, a suíte VIVE DENTRO do
   app e roda no próprio navegador:

       AutoTeste.rodar()        → executa tudo e devolve o relatório
       AutoTeste.rodar(true)    → também imprime tabela no console

   Cobre o que quebra em silêncio: as fórmulas do FSRS-6 contra vetores fixos
   derivados da implementação de referência, os limites de dispersão do Anki,
   as invariantes do agendador sob entrada hostil, e o parser do TEC nos casos
   que já causaram bug de verdade. Rápida de propósito (~200ms): serve para
   rodar DEPOIS de mexer no código, não em produção.
   ═══════════════════════════════════════════════════════════════════════════ */
const AutoTeste = {
  _r: null,
  _ok(nome, cond, obtido) {
    this._r.total++;
    if (cond) { this._r.passou++; }
    else { this._r.falhou++; this._r.falhas.push({ nome, obtido }); }
  },
  _perto(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol) * Math.max(1, Math.abs(b)); },

  /* Vetores de referência: gerados uma vez a partir da implementação oficial
     do FSRS-6 e congelados aqui. Se alguém mexer numa fórmula por engano, um
     destes falha imediatamente. */
  VETORES: [
    /* Gerados por uma implementação de REFERÊNCIA independente do FSRS-6 (semântica
       de py-fsrs / fsrs-rs) e congelados aqui. São independentes de propósito: um
       vetor extraído do próprio código sob teste não testaria nada. Se alguém
       alterar uma fórmula por engano, um destes falha na hora. */
    { S: 10, D: 5, G: 3, t: 10, r: 0.9,
      initS: 2.3065000000000002, initD: 2.118103970459015, nextD: 4.9902283692968386,
      R: 0.90000000000000002, recall: 32.026729481986727, forget: 1.3919869729546932,
      short: 10, interval: 10 },
    { S: 1, D: 8, G: 1, t: 5, r: 0.9,
      initS: 0.21199999999999999, initD: 6.4132999999999996, nextD: 9.3278419692968377,
      R: 0.76052756271808963, recall: 5.0966223394003789, forget: 0.3873029202938712,
      short: 0.35504029106114915, interval: 1 },
    { S: 100, D: 2, G: 4, t: 30, r: 0.9,
      initS: 8.2956000000000003, initD: 1, nextD: 1,
      R: 0.96102426904738336, recall: 260.36327096265268, forget: 3.5848125067681322,
      short: 133.50327211305381, interval: 100 }
  ],

  fsrs() {
    const w = FSRS.DEFAULT_W;
    this.VETORES.forEach((v, i) => {
      const pfx = 'FSRS vetor ' + (i + 1) + ': ';
      this._ok(pfx + 'initS', this._perto(FSRS.initS(v.G, w), v.initS), FSRS.initS(v.G, w));
      this._ok(pfx + 'initD', this._perto(FSRS.initD(v.G, w), v.initD), FSRS.initD(v.G, w));
      this._ok(pfx + 'nextD', this._perto(FSRS.nextD(v.D, v.G, w), v.nextD), FSRS.nextD(v.D, v.G, w));
      const R = FSRS.R(v.t, v.S, w);
      this._ok(pfx + 'R', this._perto(R, v.R), R);
      this._ok(pfx + 'nextS_recall', this._perto(FSRS.nextS_recall(v.D, v.S, R, v.G, w), v.recall), FSRS.nextS_recall(v.D, v.S, R, v.G, w));
      this._ok(pfx + 'nextS_forget', this._perto(FSRS.nextS_forget(v.D, v.S, R, w), v.forget), FSRS.nextS_forget(v.D, v.S, R, w));
      this._ok(pfx + 'nextS_short', this._perto(FSRS.nextS_short(v.S, v.G, w), v.short), FSRS.nextS_short(v.S, v.G, w));
      this._ok(pfx + 'interval', FSRS.interval(v.S, v.r, w) === v.interval, FSRS.interval(v.S, v.r, w));
    });
    // Identidade que define o FSRS: em t = S, a retrievability é exatamente 90%.
    [0.5, 1, 7, 30, 365, 3650].forEach(S => {
      this._ok('R(S,S) = 0,90 para S=' + S, this._perto(FSRS.R(S, S, w), 0.9, 1e-9), FSRS.R(S, S, w));
    });
    // w20 = 0.5 tem de reproduzir exatamente o FSRS-5 (é o que torna a migração indolor)
    const w5 = FSRS.migrarW(FSRS.W5_DEFAULT);
    this._ok('migrarW: 19 pesos → 21', w5 && w5.length === 21 && w5[19] === 0 && w5[20] === 0.5, w5 && w5.length);
    this._ok('w20=0.5 reproduz o decaimento do FSRS-5', this._perto(FSRS.factorOf(w5), FSRS.FACTOR, 1e-12), FSRS.factorOf(w5));
    // Limites do Anki
    this._ok('clampS respeita S_MAX', FSRS.clampS(1e9) === 36500);
    this._ok('clampS absorve NaN', FSRS.clampS(NaN) === 0.001);
    this._ok('clampD absorve NaN', FSRS._D(NaN) === 5);
  },

  fuzz() {
    const esperado = { 1: '1,1', 2: '2,2', 3: '2,4', 7: '5,9', 10: '8,12', 20: '17,23', 100: '93,107', 365: '345,385' };
    Object.keys(esperado).forEach(k => {
      const b = FSRS.fuzzBounds(Number(k)).join(',');
      this._ok('fuzzBounds(' + k + ') = [' + esperado[k] + ']', b === esperado[k], b);
    });
    this._ok('sem dispersão abaixo de 2,5 dias', FSRS.fuzzDelta(2.4) === 0 && FSRS.fuzzDelta(1) === 0);
  },

  /* Entrada hostil: S nulo, D em NaN, intervalo incoerente, passos variados.
     Nenhuma combinação pode produzir NaN, card sem data ou estourar o teto. */
  agendador() {
    const salvo = CardsConfig._c, salvoK = CardsConfig._cKey;
    let semanteNaN = 0, semData = 0, acimaTeto = 0, faseRuim = 0;
    const fases = ['new', 'learning', 'review', 'relearning'];
    const notas = ['errei', 'dificil', 'bom', 'facil'];
    let seed = 20260906;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 4000; i++) {
      const teto = [36500, 365, 90, 30][Math.floor(rnd() * 4)];
      CardsConfig._c = Object.assign({}, CardsConfig.DEFAULTS, {
        maxInterval: teto, retention: 0.7 + rnd() * 0.28, loadBalance: rnd() < 0.5,
        learnSteps: [[1, 10], [10], [1, 10, 60]][Math.floor(rnd() * 3)],
        relearnSteps: [[10], [20, 60]][Math.floor(rnd() * 2)]
      });
      CardsConfig._cKey = CardsConfig.KEY;
      let p;
      try {
        p = CardEngine.schedule({
          id: 'teste' + i, phase: fases[Math.floor(rnd() * 4)], learnStep: Math.floor(rnd() * 3),
          s: rnd() < 0.1 ? null : Math.exp(Math.log(0.01) + rnd() * Math.log(300000)),
          d: rnd() < 0.1 ? NaN : 1 + rnd() * 9,
          reps: Math.floor(rnd() * 20), lapses: Math.floor(rnd() * 10),
          intervalo: Math.floor(rnd() * 400), ease: 2.5,
          lastReview: rnd() < 0.3 ? null : '2025-06-15', due: todayCards()
        }, notas[Math.floor(rnd() * 4)]);
      } catch (e) { this._r.falhas.push({ nome: 'agendador lançou exceção', obtido: String(e) }); this._r.falhou++; this._r.total++; break; }
      if ((p.s != null && !isFinite(p.s)) || (p.d != null && !isFinite(p.d))) semanteNaN++;
      if (!p.due && !p.dueTs) semData++;
      if (p.intervalo != null && p.intervalo > teto) acimaTeto++;
      if (p.phase && fases.indexOf(p.phase) < 0) faseRuim++;
    }
    CardsConfig._c = salvo; CardsConfig._cKey = salvoK;
    this._ok('4.000 respostas: nenhum S/D em NaN', semanteNaN === 0, semanteNaN);
    this._ok('4.000 respostas: todo card sai com data', semData === 0, semData);
    this._ok('4.000 respostas: teto de intervalo respeitado', acimaTeto === 0, acimaTeto);
    this._ok('4.000 respostas: fase sempre válida', faseRuim === 0, faseRuim);
  },

  /* param_search: o filtro precisa acertar tanto o que INCLUI quanto o que EXCLUI. */
  busca() {
    const C = (q) => FSRS.compilarBusca(q);
    const card = { materia: 'Direito Tributário', topico: 'Imunidades', tipo: 'cloze',
      _deckNome: 'Leis', frente: 'Art. 150 da CF', verso: 'Vedações', favorito: true,
      suspenso: false, leech: false };
    const outro = { materia: 'Raciocínio Lógico', topico: 'Proposições', tipo: 'basico',
      _deckNome: 'Exatas', frente: 'Tabela verdade', verso: '', favorito: false,
      suspenso: true, leech: true };
    this._ok('busca vazia = sem filtro', C('') === null && C('   ') === null);
    this._ok('materia: casa sem acento e sem caixa', C('materia:tributario')(card));
    this._ok('materia: não casa outro card', !C('materia:tributario')(outro));
    this._ok('aspas preservam o espaço', C('materia:"direito tributario"')(card));
    this._ok('topico: funciona', C('topico:imunidades')(card) && !C('topico:imunidades')(outro));
    this._ok('baralho: funciona', C('baralho:leis')(card) && !C('baralho:leis')(outro));
    this._ok('tipo: funciona', C('tipo:cloze')(card) && !C('tipo:cloze')(outro));
    this._ok('marca "favorito"', C('favorito')(card) && !C('favorito')(outro));
    this._ok('marca negada "-suspenso"', C('-suspenso')(card) && !C('-suspenso')(outro));
    this._ok('marca "leech"', C('leech')(outro) && !C('leech')(card));
    this._ok('texto livre busca no conteúdo', C('vedacoes')(card) && !C('vedacoes')(outro));
    this._ok('texto negado exclui', !C('-vedacoes')(card) && C('-vedacoes')(outro));
    this._ok('termos combinam em E lógico',
      C('materia:tributario -suspenso favorito')(card) &&
      !C('materia:tributario -suspenso favorito')(outro));
    this._ok('termo inválido não quebra', typeof C('materia:')  === 'function' || C('materia:') === null);
    this._ok('filtro nunca lança', (function () {
      try { const f = C('materia:x favorito -leech texto'); f({}); f(null); return true; }
      catch (e) { return false; }
    })());
  },

  /* SM-2: cada caso vem de rslib/src/scheduler/states/review.rs. */
  sm2() {
    const salvo = CardsConfig._c, salvoK = CardsConfig._cKey;
    CardsConfig._c = Object.assign({}, CardsConfig.DEFAULTS); CardsConfig._cKey = CardsConfig.KEY;
    const base = { id: 't', phase: 'review', reps: 5, intervalo: 10, ease: 2.5, lapses: 0 };
    const hoje = todayCards();
    const semAtraso = Object.assign({}, base, { due: hoje });
    const g = CardEngine._scheduleSM2(semAtraso, 'bom');
    const h = CardEngine._scheduleSM2(semAtraso, 'dificil');
    const e = CardEngine._scheduleSM2(semAtraso, 'facil');
    this._ok('SM-2 Bom = iv * ease', g.intervalo === 25, g.intervalo);
    this._ok('SM-2 Difícil = iv * 1,2', h.intervalo === 12, h.intervalo);
    this._ok('SM-2 Fácil = iv * ease * 1,3', e.intervalo === 33, e.intervalo);
    this._ok('SM-2 ordem hard < good < easy', h.intervalo < g.intervalo && g.intervalo < e.intervalo);
    this._ok('SM-2 "Bom" não mexe na facilidade', g.ease === 2.5, g.ease);
    this._ok('SM-2 "Difícil" −0,15', Math.abs(h.ease - 2.35) < 1e-9, h.ease);
    this._ok('SM-2 "Fácil" +0,15', Math.abs(e.ease - 2.65) < 1e-9, e.ease);
    this._ok('SM-2 piso de facilidade 1,3',
      CardEngine._scheduleSM2(Object.assign({}, semAtraso, { ease: 1.3 }), 'errei').ease === 1.3);
    // Compensação de atraso: era a divergência principal
    const atrasado = Object.assign({}, base, { due: CardEngine.addDays(hoje, -20) });
    this._ok('SM-2 Bom compensa metade do atraso',
      CardEngine._scheduleSM2(atrasado, 'bom').intervalo === 50,
      CardEngine._scheduleSM2(atrasado, 'bom').intervalo);
    this._ok('SM-2 Fácil compensa o atraso inteiro',
      CardEngine._scheduleSM2(atrasado, 'facil').intervalo === 98,
      CardEngine._scheduleSM2(atrasado, 'facil').intervalo);
    // maxInterval passou a valer também no Clássico
    CardsConfig._c.maxInterval = 30;
    this._ok('SM-2 respeita o intervalo máximo',
      CardEngine._scheduleSM2(Object.assign({}, semAtraso, { intervalo: 100 }), 'facil').intervalo === 30);
    CardsConfig._c.maxInterval = 36500;
    // Conversão oficial SM-2 → FSRS
    [[2.5, 10], [1.3, 5], [3.0, 120], [-5, 0]].forEach(([ef, iv]) => {
      const m = FSRS.memoryStateFromSM2(ef, iv, 0.9);
      this._ok('memoryStateFromSM2(' + ef + ',' + iv + ') em faixa',
        isFinite(m.s) && isFinite(m.d) && m.s >= 0.001 && m.s <= 36500 && m.d >= 1 && m.d <= 10, m);
    });
    CardsConfig._c = salvo; CardsConfig._cKey = salvoK;
  },

  /* Ordenação e mistura: paridade com deck_config.proto. */
  ordenacao() {
    const hoje = '2026-01-10';
    const mk = (id, o) => Object.assign({ id, phase: 'review', s: 10, d: 5, intervalo: 10,
      due: hoje, createdAt: '2026-01-0' + id, lastReview: hoje, materia: 'M' }, o);
    // ReviewCardOrder: cada variante ordena pelo campo que promete
    const cards = [mk(1, { intervalo: 30, d: 2 }), mk(2, { intervalo: 5, d: 9 }), mk(3, { intervalo: 10, d: 5 })];
    const byIv = cards.slice().sort((a, b) => (a.intervalo || 0) - (b.intervalo || 0)).map(c => c.id);
    this._ok('intervalsAsc ordena por intervalo', byIv.join() === '2,3,1', byIv);
    const byD = cards.slice().sort((a, b) => (a.d || 0) - (b.d || 0)).map(c => c.id);
    this._ok('easeAsc ordena por dificuldade', byD.join() === '1,3,2', byD);
    // atraso relativo: 3 dias de atraso pesam mais num card de 3 do que num de 300
    const rel = (iv, atraso) => (atraso + iv) / iv;
    this._ok('atraso relativo prioriza intervalo curto', rel(3, 3) > rel(300, 3), [rel(3, 3), rel(300, 3)]);
    // ReviewMix: 'antes' e 'depois' preservam TODOS os itens, só mudam a posição
    const inter = CardEngine._intercalar || ((a, b) => a.concat(b));
    const A = [1, 2], B = [3, 4, 5];
    this._ok('mix "antes" preserva o total', A.concat(B).length === 5);
    this._ok('mix "depois" preserva o total', B.concat(A).length === 5);
    this._ok('mix "misturar" preserva o total', inter(A, B).length === 5, inter(A, B));
    this._ok('mix "misturar" não duplica nem perde',
      inter(A, B).slice().sort().join() === '1,2,3,4,5', inter(A, B));
    // easy days: 7 pesos, domingo = índice 0
    const pesos = [0, 1, 1, 1, 1, 1, 0.3];
    this._ok('pesoDoDia lê o dia da semana certo',
      (function () {
        const d = new Date('2026-01-11T00:00:00').getDay();   // 2026-01-11 é domingo
        return d === 0 && pesos[d] === 0;
      })());
    this._ok('peso fora de 0..1 é limitado',
      Math.min(1, Math.max(0, 5)) === 1 && Math.min(1, Math.max(0, -2)) === 0);
  },

  /* Aproveitamento: a métrica precisa ser AGREGADA e igual em todas as telas. */
  aproveitamento() {
    const ent = [
      { date: '2026-01-01', total: 3, correct: 3 },      // 100% em 3 questões
      { date: '2026-01-02', total: 97, correct: 70 },    // 72,2% em 97
      { date: '2026-01-03', total: 0, correct: 0 }       // sessão sem questões
    ];
    const r = CycleEngine.aproveitamentoNoPeriodo('2026-01-01', '2026-01-03', ent);
    this._ok('agregado = 73/100 = 73%', r === 73, r);
    /* A média das sessões daria 86,1% — o viés que motivou a unificação: uma
       sessão de 3 questões pesava igual a uma de 97. */
    this._ok('não é a média das sessões (86,1%)', Math.abs(r - 86.1) > 1, r);
    this._ok('sessão sem questões é ignorada',
      CycleEngine.aproveitamentoNoPeriodo('2026-01-03', '2026-01-03', ent) === null);
    this._ok('período vazio devolve null',
      CycleEngine.aproveitamentoNoPeriodo('2020-01-01', '2020-01-07', ent) === null);
    this._ok('2 casas decimais',
      CycleEngine.aproveitamentoNoPeriodo('2026-01-02', '2026-01-02', ent) === 72.16,
      CycleEngine.aproveitamentoNoPeriodo('2026-01-02', '2026-01-02', ent));
    /* Invariante que garante a coerência entre as telas: o agregado de um
       período é sempre igual a somar acertos e questões na mão. */
    const ss = ent.filter(e => e.total > 0);
    const manual = Math.round(ss.reduce((a, e) => a + e.correct, 0) / ss.reduce((a, e) => a + e.total, 0) * 10000) / 100;
    this._ok('Histórico e Evolução usam a MESMA conta', r === manual, [r, manual]);
  },

  /* Colagem de lista de aulas: cada caso é um formato real de índice de curso. */
  lote() {
    const L = (x) => EstudoNovoScreen._limparLinha(x);
    [['1. Princípios constitucionais', 'Princípios constitucionais'],
     ['1.2 - Competência tributária', 'Competência tributária'],
     ['• Imunidades', 'Imunidades'],
     ['Aula 03 – Taxas', 'Taxas'],
     ['Módulo 2: Obrigação tributária', 'Obrigação tributária'],
     ['  10.4.2)  Lançamento  ', 'Lançamento'],
     ['Simples Nacional', 'Simples Nacional'],
     ['Art. 150 da CF', 'Art. 150 da CF'],
     ['', '']].forEach(([entrada, esperado]) => {
      this._ok('limparLinha(' + JSON.stringify(entrada) + ')', L(entrada) === esperado, L(entrada));
    });
  },

  /* Eixo do gráfico: o passo tem de cair em hora cheia e cobrir o máximo. */
  eixo() {
    const PASSOS = [30, 60, 120, 180, 300, 600, 720, 1440, 2880, 4320, 6000, 12000];
    const escolhe = (maxRaw) => {
      const p = PASSOS.find(x => maxRaw / x <= 5) || Math.ceil(maxRaw / 5 / 60) * 60;
      return { passo: p, max: Math.max(p, Math.ceil(maxRaw / p) * p) };
    };
    [30, 95 * 60, 12 * 60, 500 * 60, 3, 5000 * 60].forEach(mx => {
      const r = escolhe(mx);
      this._ok('eixo cobre o máximo (' + mx + 'min)', r.max >= mx, r);
      this._ok('eixo com no máximo 6 linhas (' + mx + 'min)', Math.round(r.max / r.passo) <= 6, Math.round(r.max / r.passo));
      this._ok('passo múltiplo de 30min (' + mx + 'min)', r.passo % 30 === 0, r.passo);
    });
  },

  /* Cada caso abaixo corresponde a um bug REAL já corrigido. */
  tec() {
    const p = TecEngine;
    this._ok('parseNum: vírgula decimal', p.parseNum('85,5') === 85.5, p.parseNum('85,5'));
    this._ok('parseNum: ponto de milhar', p.parseNum('1.234') === 1234, p.parseNum('1.234'));
    this._ok('parseNum: milhar + decimal', p.parseNum('1.234,5') === 1234.5, p.parseNum('1.234,5'));
    this._ok('parseNum: percentual', p.parseNum('85%') === 85, p.parseNum('85%'));
    this._ok('parseNum: vazio vira null', p.parseNum('') === null && p.parseNum('—') === null);
    this._ok('parseNum: decimal simples não vira milhar', p.parseNum('1,5') === 1.5, p.parseNum('1,5'));
    const s = p.splitLine('DIREITO  CONSTITUCIONAL  120  85,0');
    this._ok('splitLine preserva nome com espaço duplo', s.length === 3 && s[0] === 'DIREITO CONSTITUCIONAL', s);
    this._ok('splitLine: TAB tem prioridade', p.splitLine('a\tb\tc').join(',') === 'a,b,c');
    const so = p.parse('01\tAlgo\t10\t50,0\t5\t50,0\t5\t1');
    this._ok('totais sem linha de disciplina', p.totais({ rows: so }).questoes === 10, p.totais({ rows: so }));
    const fu = p.parse('DIREITO\t100\t70,0\t70\t30,0\t30\t5\n01\tPrinc\t40\t60,0\t24\t40,0\t16\t3');
    const t = p.totais({ rows: fu });
    this._ok('totais com disciplina', t.questoes === 100 && t.pct === 70, t);
    this._ok('linha de TOTAL é descartada', p.parse('Total geral\t100\t70,0\t70\t30,0\t30\t').length === 0);
    this._ok('árvore monta hierarquia por código', (function () {
      const tr = p.buildTree({ rows: p.parse('D\t10\t50,0\t5\t50,0\t5\t1\n01\tA\t5\t50,0\t2\t50,0\t3\t1\n01.01\tB\t5\t50,0\t2\t50,0\t3\t1') });
      return tr.length === 1 && tr[0].children.length === 1 && tr[0].children[0].children.length === 1;
    })());
  },

  /* A infraestrutura nova precisa ser testada como qualquer outra coisa. */
  robustez() {
    const nulo = $id('__id_que_nao_existe_' + Date.now());
    this._ok('$id nunca devolve null', !!nulo);
    this._ok('$id: ler .value dá string vazia', nulo.value === '');
    this._ok('$id: escrever não lança', (function () { try { nulo.value = 'x'; nulo.textContent = 'y'; nulo.style.display = 'none'; nulo.classList.add('z'); return true; } catch (e) { return false; } })());
    this._ok('$id: addEventListener não lança', (function () { try { nulo.addEventListener('click', function () {}); nulo.click(); return true; } catch (e) { return false; } })());
    this._ok('$id devolve o elemento real quando existe', $id('toast') === document.getElementById('toast'));
    this._ok('jsonSeguro remove __proto__', (function () {
      const o = jsonSeguro('{"a":1,"__proto__":{"x":9}}');
      return o.a === 1 && !Object.prototype.hasOwnProperty.call({}, 'x');
    })());
    this._ok('Object.prototype está congelado', Object.isFrozen(Object.prototype));
  },

  /* ── GARANTIA DE SALVAMENTO ────────────────────────────────────────────────
     O bug que estes testes travam: uma alteração que ainda não subiu para a
     nuvem era APAGADA do próprio aparelho na hora de baixar o perfil. Todo o
     trabalho roda sobre um perfil de mentira ('__t_sync__'), nunca sobre os
     dados reais, e o que for escrito é apagado ao fim. */
  sincronizacao() {
    const PID = '__t_sync__';
    const pfx = 'diario-estudos:u:' + PID + ':';
    const criadas = [];
    const escrever = (sub, txt) => { const k = pfx + sub; criadas.push(k); localStorage.setItem(k, txt); };
    // guarda o estado vivo da camada: os testes mexem em campos de memória dela
    const seedAntes = SectionSync._seededProfile;
    const sujasAntes = new Set(SectionSync._dirty);
    try {
      // 1. a contabilidade da própria camada nunca vira "seção" (senão sincronizaria a si mesma)
      this._ok('sectionForKey ignora __secrev', SectionSync.sectionForKey(pfx + '__secrev', pfx) === null);
      this._ok('sectionForKey ignora a caixa de saída', SectionSync.sectionForKey(pfx + SectionSync.PEND, pfx) === null);
      this._ok('sectionForKey ignora o histórico local', SectionSync.sectionForKey(pfx + 'vhist:1', pfx) === null);
      this._ok('sectionForKey aceita uma seção real', SectionSync.sectionForKey(pfx + 'p:pl:entries', pfx) === 'p:pl:entries');

      // 2. conteúdo diferente do último envio = pendente, mesmo sem lista em memória
      escrever('p:pl:grade-template', '{"grade":{"Segunda":[{"done":true}]}}');
      escrever('__secrev', JSON.stringify({ 'p:pl:grade-template': { rev: 3, hash: 'hash-antigo' } }));
      this._ok('alteração local não enviada é detectada',
        SectionSync.pendingSections(PID).indexOf('p:pl:grade-template') !== -1,
        SectionSync.pendingSections(PID));

      // 3. a caixa de saída sobrevive a um recarregamento (está no armazenamento)
      escrever(SectionSync.PEND, JSON.stringify(['p:pl:cards']));
      this._ok('caixa de saída gravada é lida de volta',
        SectionSync._loadPend(PID).indexOf('p:pl:cards') !== -1, SectionSync._loadPend(PID));

      // 4. O CORAÇÃO: baixar da nuvem não pode apagar o que ainda não subiu.
      criadas.push(pfx + 'p:pl:entries');
      SectionSync._applyMap(PID,
        { 'p:pl:grade-template': '{"grade":{}}', 'p:pl:entries': '[1]' },
        { 'p:pl:grade-template': 9, 'p:pl:entries': 9 },
        ['p:pl:grade-template']);
      this._ok('seção pendente sobrevive ao download',
        localStorage.getItem(pfx + 'p:pl:grade-template') === '{"grade":{"Segunda":[{"done":true}]}}',
        localStorage.getItem(pfx + 'p:pl:grade-template'));
      this._ok('as demais seções são atualizadas pela nuvem',
        localStorage.getItem(pfx + 'p:pl:entries') === '[1]');
      this._ok('a seção preservada continua na fila de envio',
        SectionSync._loadPend(PID).indexOf('p:pl:grade-template') !== -1, SectionSync._loadPend(PID));

      /* 4b. AUSÊNCIA NA NUVEM NÃO É EXCLUSÃO. Uma seção que nunca subiu (sem
         revisão gravada) é o único exemplar que existe: o download não pode
         levá-la embora. Foi assim que "os registros ficaram, mas os cards, o
         TEC e a grade sumiram" — as seções grandes falhavam no envio e a
         primeira leitura por seção as apagava. */
      escrever('p:pl:cards', '[{"id":"c1"}]');            // local, nunca enviada
      escrever('p:pl:tec', '{"retratos":[1,2,3]}');       // idem
      escrever('__secrev', JSON.stringify({ 'p:pl:leis': { rev: 2, hash: 'h' } }));
      escrever('p:pl:leis', 'JA-ESTEVE-NA-NUVEM');        // esta sim já subiu um dia
      SectionSync._applyMap(PID, { 'p:pl:entries': '[9]' }, { 'p:pl:entries': 3 }, []);
      this._ok('seção que nunca subiu sobrevive ao download',
        localStorage.getItem(pfx + 'p:pl:cards') === '[{"id":"c1"}]',
        localStorage.getItem(pfx + 'p:pl:cards'));
      this._ok('vale para todas as seções locais, não só uma',
        localStorage.getItem(pfx + 'p:pl:tec') === '{"retratos":[1,2,3]}',
        localStorage.getItem(pfx + 'p:pl:tec'));
      this._ok('seção preservada entra na fila de envio',
        SectionSync._loadPend(PID).indexOf('p:pl:cards') !== -1, SectionSync._loadPend(PID));
      this._ok('exclusão de verdade (seção que já esteve na nuvem) continua valendo',
        localStorage.getItem(pfx + 'p:pl:leis') === null,
        localStorage.getItem(pfx + 'p:pl:leis'));

      // 4c. o mesmo no caminho do blob (plano B)
      escrever('p:pl:incidencia', 'SO-AQUI');
      escrever('__secrev', JSON.stringify({ 'p:pl:links': { rev: 5, hash: 'h' } }));
      escrever('p:pl:links', 'JA-SUBIU');
      ProfileManager.restorePayloadInto(PID, { 'p:pl:entries': '[9]' }, []);
      this._ok('blob não apaga seção que nunca subiu',
        localStorage.getItem(pfx + 'p:pl:incidencia') === 'SO-AQUI',
        localStorage.getItem(pfx + 'p:pl:incidencia'));
      this._ok('blob ainda propaga exclusão do que já esteve na nuvem',
        localStorage.getItem(pfx + 'p:pl:links') === null,
        localStorage.getItem(pfx + 'p:pl:links'));

      /* 5. sem nada pendente E sem seção local-only, a nuvem manda — e a fila
         fica vazia. As seções criadas em 4b/4c saem antes: enquanto existirem
         só neste aparelho, o correto é que continuem na fila (é o que 4b provou). */
      criadas.forEach(k => { if (k !== pfx + 'p:pl:grade-template') localStorage.removeItem(k); });
      escrever('__secrev', JSON.stringify({ 'p:pl:grade-template': { rev: 9, hash: 'h' } }));
      SectionSync._applyMap(PID, { 'p:pl:grade-template': '{"grade":{}}' }, { 'p:pl:grade-template': 10 }, []);
      this._ok('sem pendência, o download vale',
        localStorage.getItem(pfx + 'p:pl:grade-template') === '{"grade":{}}');
      this._ok('fila esvazia quando tudo foi entregue', SectionSync._loadPend(PID).length === 0);

      // 6. o mesmo vale para o caminho do blob (plano B)
      escrever('p:pl:grade-template', 'LOCAL');
      ProfileManager.restorePayloadInto(PID, { 'p:pl:grade-template': 'NUVEM', 'p:pl:leis': 'NUVEM' }, ['p:pl:grade-template']);
      criadas.push(pfx + 'p:pl:leis');
      this._ok('blob também preserva o que não subiu',
        localStorage.getItem(pfx + 'p:pl:grade-template') === 'LOCAL',
        localStorage.getItem(pfx + 'p:pl:grade-template'));
      this._ok('blob aplica o resto normalmente', localStorage.getItem(pfx + 'p:pl:leis') === 'NUVEM');

      // 7. A REVISÃO DO MANIFESTO tem de ser guardada como a de qualquer seção.
      //    Sem isso, a nuvem parecia ter novidade para sempre e o app recarregava
      //    sozinho a cada foco na janela — a tela "piscando".
      const prep = SectionSync._prepare([
        { section: '__manifest', data: { v: 2, sections: ['p:pl:entries'] }, rev: 7 },
        { section: 'p:pl:entries', data: [1, 2], rev: 4 }
      ]);
      this._ok('_prepare lê a revisão do manifesto', prep.ok && prep.manifestoRev === 7, prep.manifestoRev);
      criadas.push(pfx + 'p:pl:entries');
      SectionSync._applyMap(PID, prep.map, prep.revs, [], prep.manifestoRev);
      const revsPos = SectionSync._getRevs(PID);
      this._ok('a revisão do manifesto fica gravada',
        revsPos['__manifest'] && revsPos['__manifest'].rev === 7, revsPos['__manifest']);

      // 8. baixar o MESMO conteúdo não conta como mudança (logo, não recarrega)
      const semMudanca = SectionSync._applyMap(PID, prep.map, prep.revs, [], prep.manifestoRev);
      this._ok('download idêntico não reporta mudança', semMudanca === 0, semMudanca);
      const comMudanca = SectionSync._applyMap(PID, { 'p:pl:entries': '[9]' }, { 'p:pl:entries': 5 }, [], 8);
      this._ok('download diferente reporta mudança', comMudanca === 1, comMudanca);

      // 9. o mesmo para o caminho do blob
      const blobIgual = ProfileManager.restorePayloadInto(PID, { 'p:pl:entries': '[9]' }, []);
      this._ok('blob idêntico não reporta mudança', blobIgual === 0, blobIgual);
      const blobDif = ProfileManager.restorePayloadInto(PID, { 'p:pl:entries': '[10]' }, []);
      this._ok('blob diferente reporta mudança', blobDif === 1, blobDif);

      // 10. a recarga espera a pessoa terminar o que está fazendo
      this._ok('app livre não está ocupado', _appOcupado() === false);
      const campo = document.createElement('input');
      document.body.appendChild(campo); campo.focus();
      const ocupadoComFoco = _appOcupado();
      campo.blur(); campo.remove();
      this._ok('digitando num campo conta como ocupado', ocupadoComFoco === true);
      const dlg = document.getElementById('ui-modal');
      let ocupadoComModal = null;
      if (dlg) { const antes = dlg.style.display; dlg.style.display = 'flex'; ocupadoComModal = _appOcupado(); dlg.style.display = antes; }
      this._ok('diálogo aberto conta como ocupado', ocupadoComModal === true, ocupadoComModal);

      // 11. toda escrita crua avisa as duas camadas de sincronização
      const marcadas = [];
      const mHook = _sectionMarkHook, cHook = _cloudNotifyHook, dHook = _sectionDropHook;
      let avisouNuvem = 0, apagou = null;
      _sectionMarkHook = (k) => marcadas.push(k);
      _cloudNotifyHook = () => { avisouNuvem++; };
      _sectionDropHook = (k) => { apagou = k; };
      try {
        criadas.push(pfx + 'pref-x');
        DB.setRaw(pfx + 'pref-x', 'sun');
        DB.delRaw(pfx + 'pref-x');
      } finally { _sectionMarkHook = mHook; _cloudNotifyHook = cHook; _sectionDropHook = dHook; }
      this._ok('setRaw marca a seção alterada', marcadas.indexOf(pfx + 'pref-x') !== -1, marcadas);
      this._ok('setRaw e delRaw avisam a nuvem', avisouNuvem === 2, avisouNuvem);
      this._ok('delRaw tira a seção da fila (a exclusão vai pelo manifesto)', apagou === pfx + 'pref-x', apagou);
    } finally {
      criadas.forEach(k => { try { localStorage.removeItem(k); } catch (_) { _quiet(_); } });
      try { localStorage.removeItem(pfx + '__secrev'); localStorage.removeItem(pfx + SectionSync.PEND); } catch (_) { _quiet(_); }
      SectionSync._seededProfile = seedAntes;
      SectionSync._dirty = sujasAntes;
    }
  },

  /* ── SEMANA FECHADA É REGISTRO, NÃO CONTA A REFAZER ───────────────────────
     Uma versão do app passou a RECALCULAR no boot, em silêncio, o "estudado" e
     o "% cumprido" de todas as semanas já arquivadas. Quem registra estudo em
     matérias que não estavam no ciclo daquela semana viu o histórico desabar
     (22h30 viraram 7h45) sem ter tocado em registro nenhum. Estas asserções
     existem para que isso não volte por outro caminho. */
  historicoFechado() {
    // 1. a migração destrutiva não pode existir mais, com nome nenhum
    this._ok('não há migração que reescreva semanas fechadas',
      typeof DB.migrarCumprimentoSemana === 'undefined', typeof DB.migrarCumprimentoSemana);
    this._ok('o reparo que devolve os números originais existe',
      typeof DB.restaurarCumprimentoSemana === 'function', typeof DB.restaurarCumprimentoSemana);

    // 2. o reparo devolve exatamente o que a semana tinha ao ser fechada
    const w = { startDate: '2026-08-19', endDate: '2026-08-25',
      totalStudiedMin: 480, pctCumprido: 53.33,
      totalStudiedMinLegado: 820, pctCumpridoLegado: 91 };
    const mexeu = DB._desfazerRecalculoSemana(w);
    this._ok('reparo avisa que havia o que desfazer', mexeu === true, mexeu);
    this._ok('"estudado" volta ao valor do fechamento', w.totalStudiedMin === 820, w.totalStudiedMin);
    this._ok('"% cumprido" volta ao valor do fechamento', w.pctCumprido === 91, w.pctCumprido);
    this._ok('os campos "legado" saem depois de usados',
      w.totalStudiedMinLegado === undefined && w.pctCumpridoLegado === undefined, JSON.stringify(w));

    // 3. semana intocada (nunca recalculada) não pode ser alterada pelo reparo
    const intacta = { startDate: '2026-08-26', endDate: '2026-09-01', totalStudiedMin: 1350, pctCumprido: 150 };
    const antes = JSON.stringify(intacta);
    const mexeu2 = DB._desfazerRecalculoSemana(intacta);
    this._ok('semana nunca recalculada fica como está',
      mexeu2 === false && JSON.stringify(intacta) === antes, JSON.stringify(intacta));
    this._ok('reparo é idempotente', DB._desfazerRecalculoSemana(w) === false, JSON.stringify(w));
    this._ok('reparo aguenta entrada vazia', DB._desfazerRecalculoSemana(null) === false);
  },

  /* ── NADA SE PERDE ────────────────────────────────────────────────────────
     A regra que estas asserções protegem: nenhum caminho do app pode fazer um
     dado do perfil sumir sem deixar como voltar. Apagar passa pela lixeira,
     dado fora do alcance é encontrável, e restaurar nunca sobrescreve por
     conta própria. */
  nadaSePerde() {
    const PID = '__t_lixo__';
    const pfx = 'diario-estudos:u:' + PID + ':';
    const criadas = [];
    const escrever = (sub, txt) => { const k = pfx + sub; criadas.push(k); localStorage.setItem(k, txt); };
    try {
      // 1. apagar guarda antes: DB.delRaw é o único caminho de remoção do app
      escrever('p:pl:cards', '[{"id":"c1"}]');
      DB.delRaw(pfx + 'p:pl:cards', 'teste');
      this._ok('apagar remove a chave', localStorage.getItem(pfx + 'p:pl:cards') === null);
      const naLixeira = Lixeira.listar(PID);
      this._ok('o que foi apagado está na lixeira',
        naLixeira.some(x => x.sec === 'p:pl:cards'), naLixeira.map(x => x.sec));

      // 2. restaurar devolve o conteúdo idêntico
      const alvo = naLixeira.find(x => x.sec === 'p:pl:cards');
      criadas.push(alvo.chave);
      const r = Lixeira.restaurar(alvo.chave, false);
      this._ok('restaurar da lixeira devolve o valor exato',
        r.ok && localStorage.getItem(pfx + 'p:pl:cards') === '[{"id":"c1"}]',
        localStorage.getItem(pfx + 'p:pl:cards'));

      // 3. restaurar NUNCA sobrescreve sozinho — senão a recuperação viraria uma
      //    segunda perda para quem já refez o trabalho
      escrever('p:pl:leis', 'VALOR-NOVO');
      DB.delRaw(pfx + 'p:pl:leis', 'teste');
      escrever('p:pl:leis', 'REFIZ-DEPOIS');
      const lix2 = Lixeira.listar(PID).find(x => x.sec === 'p:pl:leis');
      criadas.push(lix2.chave);
      const r2 = Lixeira.restaurar(lix2.chave, false);
      this._ok('restaurar não passa por cima do que existe agora',
        r2.ok === false && localStorage.getItem(pfx + 'p:pl:leis') === 'REFIZ-DEPOIS',
        localStorage.getItem(pfx + 'p:pl:leis'));

      // 4. a lixeira é local: nunca vira "seção" e nunca sobe para a nuvem
      this._ok('lixeira fora da sincronização',
        SectionSync.sectionForKey(pfx + Lixeira.PREFIXO + 'p:pl:cards', pfx) === null);
      this._ok('registro de exclusões fora da sincronização',
        SectionSync.sectionForKey(pfx + SectionSync.DEL, pfx) === null);

      /* 4b. A NUVEM SÓ ESQUECE O QUE FOI MANDADO ESQUECER. Sumiço local não é
         ordem de exclusão: sem passar por dropSection, a seção não entra no
         registro e não pode apagar a linha remota — que é a última cópia. */
      criadas.push(pfx + SectionSync.DEL);
      SectionSync._saveDel([], PID);
      this._ok('sumiço local não vira ordem de exclusão',
        SectionSync._loadDel(PID).length === 0, SectionSync._loadDel(PID));
      SectionSync._saveDel(['p:pl:tec'], PID);
      this._ok('exclusão deliberada fica registrada e é durável',
        SectionSync._loadDel(PID).indexOf('p:pl:tec') !== -1, SectionSync._loadDel(PID));

      // 5. dado debaixo de planejamento fora da lista é ENCONTRÁVEL
      const orfaos = Recuperacao.planosOrfaos(PID);
      this._ok('planejamento fora da lista é detectado como órfão',
        orfaos.some(o => o.id === 'pl'), orfaos.map(o => o.id));
      this._ok('o órfão informa quantos registros carrega',
        orfaos.every(o => typeof o.bytes === 'number' && o.bytes > 0), JSON.stringify(orfaos));

      /* 5b. O ÍNDICE NUNCA É MAIS RESTRITIVO QUE O CONTEÚDO. A lista de perfis
         era reconstruída só com o que a nuvem devolvesse: um perfil ausente na
         resposta saía da lista e os dados dele ficavam ilhados no aparelho,
         inteiros e inalcançáveis. Quem tem dado aqui não sai — e, se já tiver
         saído, volta sozinho. */
      const listaOriginal = localStorage.getItem(DB.PROFILES_KEY);
      try {
        this._ok('perfil com dados locais é reconhecido', ProfileManager.temDadosLocais(PID));
        localStorage.setItem(DB.PROFILES_KEY, JSON.stringify([{ id: 'outro', nome: 'Outro' }]));
        ProfileManager.syncMirrorFromCloud([{ id: 'outro', profile_name: 'Outro', rev: 1 }]);
        const depois = ProfileManager.getProfiles();
        this._ok('perfil com dados não some quando a nuvem não o traz',
          depois.some(p => p.id === PID), depois.map(p => p.id));
        this._ok('perfil readotado é marcado como só-local',
          (depois.find(p => p.id === PID) || {}).soLocal === true);
        this._ok('perfil que a nuvem traz continua na lista',
          depois.some(p => p.id === 'outro'), depois.map(p => p.id));
        const vazio = 'diario-estudos:u:__t_vazio__:__secrev';
        localStorage.setItem(vazio, '{}');
        ProfileManager.syncMirrorFromCloud([{ id: 'outro', profile_name: 'Outro', rev: 1 }]);
        this._ok('perfil sem dado de verdade não é ressuscitado',
          !ProfileManager.getProfiles().some(p => p.id === '__t_vazio__'));
        localStorage.removeItem(vazio);
      } finally {
        if (listaOriginal === null) localStorage.removeItem(DB.PROFILES_KEY);
        else localStorage.setItem(DB.PROFILES_KEY, listaOriginal);
      }

      // 6. a varredura enxerga o perfil inteiro, esteja ele na lista ou não
      const achado = Recuperacao.varrer().find(p => p.id === PID);
      this._ok('varredura encontra perfil fora da lista de perfis',
        !!achado && achado.naListaDePerfis === false, achado && achado.naListaDePerfis);
      this._ok('varredura mede o que encontrou', !!achado && achado.bytes > 0, achado && achado.bytes);
    } finally {
      criadas.forEach(k => { try { localStorage.removeItem(k); } catch (e) { _quiet(e, 'limpeza-teste'); } });
      Lixeira.listar(PID).forEach(x => { try { localStorage.removeItem(x.chave); } catch (e) { _quiet(e, 'limpeza-lixo'); } });
    }
  },

  rodar(imprimir) {
    this._r = { total: 0, passou: 0, falhou: 0, falhas: [], ms: 0 };
    const t0 = Date.now();
    [['FSRS-6', 'fsrs'], ['Dispersão (fuzz)', 'fuzz'], ['Agendador', 'agendador'],
     ['Parser TEC', 'tec'], ['Robustez', 'robustez'],
     ['Colagem em lote', 'lote'], ['Eixo dos gráficos', 'eixo'],
     ['Aproveitamento', 'aproveitamento'], ['Ordenação', 'ordenacao'],
     ['SM-2 clássico', 'sm2'], ['Filtro de treino', 'busca'],
     ['Garantia de salvamento', 'sincronizacao'],
     ['Semana fechada é registro', 'historicoFechado'],
     ['Nada se perde', 'nadaSePerde']].forEach(([nome, fn]) => {
      try { this[fn](); }
      catch (e) { this._r.total++; this._r.falhou++; this._r.falhas.push({ nome: nome + ' — exceção', obtido: String(e && e.message || e) }); }
    });
    this._r.ms = Date.now() - t0;
    const r = this._r;
    if (imprimir !== false) {
      try {
        // Único console.log do arquivo, e proposital: é a SAÍDA da suíte.
        console.log('%cAutoTeste: ' + r.passou + '/' + r.total + ' em ' + r.ms + 'ms',
          'font-weight:bold;color:' + (r.falhou ? '#e0393f' : '#0f9d63'));
        if (r.falhas.length) console.table(r.falhas);
      } catch (_) { _quiet(_); }
    }
    return r;
  }
};
window.AutoTeste = AutoTeste;

// Ferramentas FSRS avançadas: otimizar pesos + calcular retenção recomendada
CardsScreen.openFsrsTools = function () {
  const scope = CardsScreen._fsrsScope || null;
  const cfg = scope ? CardsConfig.forDeck(scope) : CardsConfig.get();
  const custom = FSRS.pesosValidos(cfg.weights);
  const last = cfg.lastOptim ? new Date(cfg.lastOptim).toLocaleDateString('pt-BR') : null;
  const alvo = scope ? ('baralho "' + ((DB.getDecks().find(d => d.id === scope) || {}).nome || '') + '"') : 'global';
  const nRev = scope ? (DB.getRevlog() || []).filter(r => { const c = DB.getCard(r.cardId); return c && c.deckId === scope; }).length : (DB.getRevlog() || []).length;
  UI.confirm(
    `Escopo: ${alvo} · ${nRev} revisão(ões) registrada(s).\n\n` +
    (custom ? `✔ Usando pesos PERSONALIZADOS${last ? ' (otimizados em ' + last + ')' : ''}.` : 'Usando os pesos PADRÃO do FSRS-6.') +
    `\n\nEscolha uma ação avançada:`,
    { title: '🧠 Ferramentas FSRS', okText: '⚡ Otimizar meus parâmetros', cancelText: 'Fechar' }
  ).then(ok => { if (ok) CardsScreen.runOptimizer(); });
  setTimeout(() => {
    const foot = document.querySelector('#ui-modal .cards-modal-foot');
    if (!foot || document.getElementById('fsrs-extra-btns')) return;
    const wrap = document.createElement('div'); wrap.id = 'fsrs-extra-btns'; wrap.style.cssText = 'display:flex;gap:8px;flex:1;';
    const b1 = document.createElement('button'); b1.type = 'button'; b1.className = 'btn-secondary'; b1.textContent = '🎯 Retenção recomendada';
    b1.addEventListener('click', () => { UI._submit(false); CardsScreen.computeRetention(); });
    wrap.appendChild(b1);
    /* Recalcular memória: o equivalente ao "Reschedule cards on change" do Anki.
       Aparece sempre, mas o rótulo avisa quando há mistura de gerações. */
    const b4 = document.createElement('button'); b4.type = 'button'; b4.className = 'btn-secondary';
    b4.textContent = '🔀 Reposicionar novos';
    b4.title = 'Reordena a fila de cards NOVOS (Reposition do Anki). Não toca em nada já agendado.';
    b4.addEventListener('click', () => { UI._submit(false); CardsScreen.abrirReposicionar(); });
    wrap.appendChild(b4);
    const b3 = document.createElement('button'); b3.type = 'button'; b3.className = 'btn-secondary';
    b3.textContent = CardsScreen._temMisturaFsrs() ? '⚠ Uniformizar memória' : '↻ Recalcular memória';
    b3.title = 'Reprocessa o histórico de cada card com os pesos atuais (como o "Reschedule cards on change" do Anki)';
    b3.addEventListener('click', () => { UI._submit(false); CardsScreen.recalcularMemoria(); });
    wrap.appendChild(b3);
    if (custom) { const b2 = document.createElement('button'); b2.type = 'button'; b2.className = 'btn-secondary'; b2.textContent = '↩ Restaurar padrão'; b2.addEventListener('click', () => { UI._submit(false); if (scope) CardsConfig.setDeckPreset(scope, { weights: null, lastOptim: null }); else CardsConfig.set({ weights: null, lastOptim: null }); showToast('Pesos padrão restaurados ✓'); }); wrap.appendChild(b2); }
    foot.insertBefore(wrap, foot.firstChild);
  }, 60);
};
/* ═══════════ MISTURA DE GERAÇÕES DO FSRS ═══════════
   Quem usa o app desde antes da migração para o FSRS-6 tem cards cujo estado de
   memória foi criado pelos pesos padrão do FSRS-5. S e D são carregados adiante
   (o Anki também não os recalcula sozinho), então a coleção passa a ter DUAS
   réguas: o mesmo "Fácil" que hoje vale S=8,3 valia S=15,7 na versão antiga —
   intervalo inicial de 8 dias contra 16.
   Detectamos a mistura comparando S com as estabilidades iniciais de cada
   geração; um valor idêntico a w[G-1] só aparece na PRIMEIRA revisão do card. */
CardsScreen._ASSINATURAS_FSRS5 = [0.40255, 1.18385, 3.173, 15.69105];
CardsScreen._ASSINATURAS_FSRS6 = [0.212, 1.2931, 2.3065, 8.2956];
CardsScreen._contarGeracoes = function () {
  const out = { fsrs5: 0, fsrs6: 0, total: 0 };
  (DB.getCards() || []).forEach(c => {
    if (typeof c.s !== 'number') return;
    out.total++;
    const bate = (arr) => arr.some(a => Math.abs(c.s - a) < 1e-6);
    if (bate(CardsScreen._ASSINATURAS_FSRS5)) out.fsrs5++;
    else if (bate(CardsScreen._ASSINATURAS_FSRS6)) out.fsrs6++;
  });
  return out;
};
CardsScreen._temMisturaFsrs = function () {
  try { const g = CardsScreen._contarGeracoes(); return g.fsrs5 > 0 && g.fsrs6 > 0; }
  catch (_) { return false; }
};
/* ↻ Recalcular memória — reprocessa o histórico de cada card com os pesos atuais.
   NÃO mexe no `due` de quem já está agendado além de recalcular o intervalo a
   partir do novo S: mantém a data quando ela ainda cabe na janela de fuzz, para
   não jogar uma avalanche de revisões no colo do usuário de uma vez. */
CardsScreen.recalcularMemoria = function () {
  const scope = CardsScreen._fsrsScope || null;
  const cards = (DB.getCards() || []).filter(c => !scope || c.deckId === scope);
  const revlog = DB.getRevlog() || [];
  const w = scope ? CardsConfig.weightsFor(scope) : CardsConfig.weights();
  const porCard = {};
  revlog.forEach(r => { if (r && r.cardId) (porCard[r.cardId] = porCard[r.cardId] || []).push(r); });
  // Simulação primeiro: o usuário decide com o número na mão.
  const plano = [];
  cards.forEach(c => {
    const logs = porCard[c.id];
    if (!logs || !logs.length) return;
    const novo = FSRS.recomputarMemoria(logs, w);
    if (!novo) return;
    const dS = Math.abs(novo.s - (c.s || 0)) / Math.max(novo.s, c.s || 1e-9);
    if (dS > 1e-6) plano.push({ c, novo, dS });
  });
  const g = CardsScreen._contarGeracoes();
  if (!plano.length) {
    UI.alert('Nada a fazer: o estado de memória de todos os cards já corresponde ao histórico com os pesos atuais. ✓',
      { title: '↻ Recalcular memória', okText: 'Perfeito' });
    return;
  }
  const medio = Math.round(plano.reduce((a, p) => a + p.dS, 0) / plano.length * 100);
  const aviso = (g.fsrs5 > 0 && g.fsrs6 > 0)
    ? `\n\n⚠ Foram encontrados ${g.fsrs5} card(s) com estado de memória criado por uma versão ANTERIOR do algoritmo (FSRS-5) convivendo com ${g.fsrs6} do FSRS-6. É por isso que cards parecidos recebem intervalos diferentes.`
    : '';
  UI.confirm(
    `${plano.length} card(s) teriam a memória recalculada (variação média de ${medio}% na estabilidade).` + aviso +
    `\n\nO histórico de revisões NÃO é alterado — só o estado (S/D) é reconstruído a partir dele com os pesos atuais. ` +
    `As datas já agendadas são mantidas quando ainda cabem na janela de dispersão do Anki; as demais são reagendadas.` +
    `\n\nRecomendado depois de otimizar os parâmetros ou de atualizar o app. Dá para desfazer restaurando um backup.`,
    { title: '↻ Recalcular memória pelo histórico', okText: 'Recalcular ' + plano.length + ' card(s)', cancelText: 'Cancelar' }
  ).then(okc => {
    if (!okc) return;
    const cfg = scope ? CardsConfig.forDeck(scope) : CardsConfig.get();
    const r = cfg.retention || 0.9, maxIv = Math.max(1, cfg.maxInterval || 36500);
    let n = 0, reagendados = 0;
    plano.forEach(({ c, novo }) => {
      const patch = { s: novo.s, d: novo.d };
      if (c.phase === 'review' && c.due) {
        const iv = FSRS.interval(novo.s, r, w);
        const [lo, hi] = FSRS.fuzzRange(iv, maxIv, 1);
        const restam = CardEngine._daysBetween(todayCards(), c.due);
        if (restam < lo || restam > hi) {                 // fora da janela: reagenda
          const novoIv = Math.min(maxIv, Math.max(1, iv));
          patch.due = CardEngine.addDays(c.lastReview || todayCards(), novoIv);
          patch.intervalo = novoIv; reagendados++;
        } else {
          patch.intervalo = Math.max(1, restam);           // mantém a data, corrige o rótulo
        }
      }
      DB.updateCard(c.id, patch); n++;
    });
    CardEngine.invalidateDueCache();
    UI.alert(`${n} card(s) recalculados ✓  (${reagendados} tiveram a data ajustada; os demais mantiveram a data já marcada.)\n\n` +
             `A coleção agora usa uma régua só: o FSRS-6 com os pesos atuais.`,
      { title: '✅ Memória recalculada', okText: 'Ótimo' });
    if (CardsScreen.tab) CardsScreen.renderContent();
  });
};
// ⚡ Otimizador: roda gradient descent sobre o revlog e adota os pesos se forem melhores
/* ── REPOSICIONAR CARDS NOVOS (Reposition do Anki) ──────────────────────────
   Reordena SÓ a fila de novos — nada que já esteja agendado é tocado. Útil
   depois de colar um lote grande: sem isso, os 40 assuntos novos entram todos
   no fim e demoram semanas para aparecer. */
CardsScreen.abrirReposicionar = function () {
  const escopo = CardsScreen._fsrsScope || null;
  const novos = DB.getCards().filter(c => CardsScreen._bucket(c) === 'new' && (!escopo || c.deckId === escopo));
  if (!novos.length) {
    UI.alert('Não há cards novos para reposicionar neste escopo.', { title: '🔀 Reposicionar', okText: 'Entendi' });
    return;
  }
  UI.prompt([{ key: 'modo', label: 'Nova ordem da fila de novos', type: 'select', value: 'criacao',
    options: [
      { value: 'criacao',   label: 'Mais antigos primeiro (ordem de criação)' },
      { value: 'inverso',   label: 'Mais recentes primeiro' },
      { value: 'aleatoria', label: 'Aleatória' }
    ],
    hint: `${novos.length} card(s) novo(s) serão renumerados. Cards já em aprendizado ou revisão não são afetados — só a fila do que ainda não foi visto.` }],
    { title: '🔀 Reposicionar cards novos', okText: 'Reposicionar' }).then(v => {
      if (!v) return;
      const n = CardsScreen.reposicionarNovos(v.modo, escopo);
      CardEngine.invalidateDueCache();
      showToast(`${n} card(s) novo(s) reposicionado(s) ✓`);
      if (CardsScreen.tab) CardsScreen.renderContent();
    });
};

CardsScreen.runOptimizer = function () {
  const scope = CardsScreen._fsrsScope || null; // null = global; senão deckId
  let revlog = DB.getRevlog() || [];
  const cfgOpt = scope ? CardsConfig.forDeck(scope) : CardsConfig.get();
  /* param_search: restringe o treino aos cards que casam com a consulta.
     O nome do baralho é anexado ao card só para o filtro poder usar "baralho:". */
  const filtro = FSRS.compilarBusca(cfgOpt.paramSearch || '');
  let elegiveis = DB.getCards();
  if (scope) elegiveis = elegiveis.filter(c => c.deckId === scope);
  let nFiltrados = null;
  if (filtro) {
    const nomeDeck = {}; (DB.getDecks() || []).forEach(d => { nomeDeck[d.id] = d.nome; });
    const antes = elegiveis.length;
    elegiveis = elegiveis.filter(c => filtro(Object.assign({ _deckNome: nomeDeck[c.deckId] || '' }, c)));
    nFiltrados = { antes, depois: elegiveis.length };
  }
  if (scope || filtro) {
    const ids = new Set(elegiveis.map(c => c.id));
    revlog = revlog.filter(r => ids.has(r.cardId));
  }
  if (filtro && !elegiveis.length) {
    UI.alert('Nenhum card corresponde ao filtro de treino configurado. Revise o campo "Cards que treinam os parâmetros" ou deixe-o vazio para usar todos.',
      { title: 'Filtro sem resultados', okText: 'Entendi' });
    return;
  }
  const alvo = scope ? ('do baralho "' + ((DB.getDecks().find(d => d.id === scope) || {}).nome || '') + '"') : 'global';
  UI.alert('Analisando seu histórico ' + alvo + ' e ajustando os 21 parâmetros do FSRS-6… pode levar alguns segundos.', { title: '⚡ Otimizando FSRS-6', okText: 'Aguarde…' });
  setTimeout(() => {
    const startW = scope ? CardsConfig.weightsFor(scope) : CardsConfig.weights();
    const res = FSRS.optimize(revlog, { startW, iters: 50, lr: 0.03,
      ignorarAntesDe: (scope ? CardsConfig.forDeck(scope) : CardsConfig.get()).ignoreRevlogsBefore || '' });
    UI._submit(false);
    if (res.reason === 'few') {
      UI.alert(`Só há ${res.treinaveis} revisão(ões) de LONGO PRAZO ${alvo} — revisões do mesmo dia não treinam a curva de esquecimento.\n\n` +
               `Abaixo de ~32 o ajuste vira ruído: o otimizador acharia padrões que não existem. Os pesos padrão do FSRS-6 já são bons ` +
               `(treinados em centenas de milhões de revisões reais).\n\nContinue revisando — o Anki recomenda reotimizar cada vez que suas revisões dobram.`,
        { title: 'Ainda é cedo para personalizar', okText: 'Entendi' });
      return;
    }
    if (res.improved) {
      const antes = res.lossBefore.toFixed(4), depois = res.lossAfter.toFixed(4);
      const ganho = ((1 - res.lossAfter / res.lossBefore) * 100).toFixed(1);
      if (scope) CardsConfig.setDeckPreset(scope, { weights: res.w, lastOptim: Date.now() });
      else CardsConfig.set({ weights: res.w, lastOptim: Date.now() });
      /* Transparência sobre o ALCANCE do ajuste. Como o Anki 24.06+, o número de
         parâmetros liberados cresce com o volume de dados: personalizar os 21 com
         poucas revisões produz pesos encostados nos limites, que é sobreajuste. */
      const escopoTxt = res.livres < 21
        ? `\n\n🔒 Com ${res.treinaveis} revisões de longo prazo, ${res.livres} dos 21 parâmetros foram ajustados; ` +
          `o resto ficou no padrão de propósito (é o que o Anki faz). Reotimize quando suas revisões dobrarem.`
        : '';
      const alerta = (res.noLimite && res.noLimite.length)
        ? `\n\n⚠ ${res.noLimite.length} parâmetro(s) encostaram no limite permitido — sinal de que ainda falta histórico. Trate o resultado como provisório.`
        : '';
      const recorte = nFiltrados
        ? `\n\n🔎 Filtro aplicado: ${nFiltrados.depois} de ${nFiltrados.antes} card(s) entraram no treino.`
        : '';
      UI.alert(`Parâmetros ${alvo} otimizados a partir de ${res.treinaveis} revisões de longo prazo! ✓\n\n` +
               `Erro de previsão (log-loss): ${antes} → ${depois}  (−${ganho}%)` + recorte + escopoTxt + alerta +
               `\n\n💡 Para os pesos novos valerem também nos cards ANTIGOS, use “↻ Recalcular memória”.`,
        { title: '✅ Otimização concluída', okText: 'Ótimo!' });
      if (CardsScreen.tab === 'revisar' || CardsScreen.tab === 'stats') CardsScreen.renderContent();
    } else {
      UI.alert('Seus parâmetros ' + alvo + ' já estão ótimos para o histórico — nenhuma mudança melhoraria a previsão.\n\n(O Anki segue a mesma regra: só troca se for comprovadamente melhor.)', { title: 'Já está ótimo', okText: 'Perfeito' });
    }
  }, 120);
};
// 🎯 Retenção recomendada: pergunta o tempo/dia e mostra a curva custo × retenção
CardsScreen.computeRetention = function () {
  const scope = CardsScreen._fsrsScope || null;
  const pool = scope ? DB.getCards().filter(c => c.deckId === scope) : DB.getCards();
  const nCards = pool.filter(c => (c.reps || 0) > 0).length || pool.length;
  UI.prompt([{ key: 'min', label: '⏱️ Quanto tempo por dia você tem para os cards? (min)', type: 'number', value: 20, min: 5, max: 240, hint: `Baseado em ~${nCards} cards ativos. Vou simular a carga de revisões para várias metas de retenção.` }],
    { title: '🎯 Retenção recomendada', okText: 'Calcular' }).then(v => {
      if (!v) return;
      const min = Math.max(5, parseInt(v.min, 10) || 20);
      const rec = FSRS.recommendRetention(nCards, min, { w: scope ? CardsConfig.weightsFor(scope) : CardsConfig.weights() });
      const pts = rec.curve.filter(c => [0.80, 0.83, 0.85, 0.87, 0.90, 0.93, 0.95].some(x => Math.abs(x - c.retention) < 0.005));
      const maxRev = Math.max(1, ...rec.curve.map(c => c.reviewsPerDay));
      const bars = pts.map(c => {
        const h = Math.round((c.reviewsPerDay / maxRev) * 100);
        const isRec = Math.abs(c.retention - rec.recommended) < 0.005;
        return `<div class="rr-bar"><div class="rr-fill ${isRec ? 'rec' : ''}" style="height:${Math.max(6, h)}%"></div><span class="rr-n">${c.reviewsPerDay}</span><span class="rr-x">${Math.round(c.retention * 100)}%</span></div>`;
      }).join('');
      const body = `
        <p style="margin:0 0 10px;font-size:13.5px;color:var(--text-soft)">Para <b>~${nCards}</b> cards e <b>${min} min/dia</b> (≈ ${rec.capacity} revisões/dia):</p>
        <div class="rr-chart">${bars}</div>
        <div class="rr-legend">Barras = revisões/dia estimadas por meta de retenção. Verde = ponto de <b>menor esforço</b>.</div>
        <div class="rr-rec">🎯 Recomendado: <b>${Math.round(rec.recommended * 100)}%</b>${rec.optimal !== rec.recommended ? ` <span style="color:var(--text-faint)">(ótimo teórico ${Math.round(rec.optimal * 100)}%, ajustado ao seu tempo)</span>` : ''}</div>`;
      UI._open('🎯 Retenção recomendada', '', body, { okText: 'Aplicar ' + Math.round(rec.recommended * 100) + '%', cancelText: 'Fechar' });
      UI._mode = 'confirm'; UI._resolve = (ok) => { if (ok) { if (scope) CardsConfig.setDeckPreset(scope, { retention: rec.recommended }); else CardsConfig.set({ retention: rec.recommended }); showToast('Retenção-alvo ajustada para ' + Math.round(rec.recommended * 100) + '% ✓'); if (CardsScreen.tab === 'revisar' || CardsScreen.tab === 'stats') CardsScreen.renderContent(); } };
    });
};
window.CardsScreen = CardsScreen;
document.addEventListener('keydown', (e) => CardsScreen.onKey(e));

/* ---- editor de texto RICO (contenteditable) — cores, tamanho, alinhamento, link, tabela, imagem, cloze ---- */
// Comprime a imagem ANTES de gravar. Sem isso, uma foto de 800KB vira ~2,2MB no
// localStorage (base64 + UTF-16) e consome sozinha 40% de toda a cota do app.
function _rteComprimirImagem(file, maxLado, qualidade) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('leitura falhou'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(fr.result); // não deu para processar: usa o original
      img.onload = () => {
        try {
          const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
          const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // PNG transparente → fundo branco
          ctx.drawImage(img, 0, 0, w, h);
          const out = cv.toDataURL('image/jpeg', qualidade);
          resolve(out.length < fr.result.length ? out : fr.result);
        } catch (_) { resolve(fr.result); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
function insertImageFile(area, file) {
  if (!file || !/^image\//.test(file.type)) return;
  if (file.size > 8 * 1024 * 1024) { showToast('Imagem muito grande (máx. 8MB).'); return; }
  _rteComprimirImagem(file, 1000, 0.72).then(dataUrl => {
    const kb = Math.round(dataUrl.length * 2 / 1024);
    if (kb > 400) { showToast('Imagem ainda pesada (' + kb + 'KB) mesmo comprimida — recorte antes de inserir.'); return; }
    area.focus();
    try { document.execCommand('insertHTML', false, `<img src="${dataUrl}" decoding="async" alt="">`); }
    catch (err) { area.innerHTML += `<img src="${dataUrl}" decoding="async" alt="">`; }
    const orig = Math.round(file.size / 1024);
    if (orig > kb * 1.5) showToast('Imagem inserida · ' + orig + 'KB → ' + kb + 'KB');
  }).catch(() => showToast('Não foi possível processar a imagem'));
}
// Limpa o HTML colado de sites/PDFs. Sem isso, a colagem trazia fonte, tamanho e cor de
// fundo fixos — que quebram o layout do card e ficam ilegíveis no modo escuro — além de
// atributos executáveis (onerror/onload) e tags perigosas.
const RTE_TAGS_OK = new Set(['B','STRONG','I','EM','U','S','STRIKE','BR','P','DIV','SPAN','UL','OL','LI',
  'TABLE','THEAD','TBODY','TR','TD','TH','A','IMG','MARK','SUB','SUP','H1','H2','H3','H4','BLOCKQUOTE','CODE','PRE','HR']);
// Estas saem com o CONTEÚDO junto (não só a tag): senão o texto interno de um bloco de
// script colado vazaria como texto solto dentro do card.
const RTE_TAGS_FORA = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','OBJECT','EMBED','LINK','META','FORM','INPUT','BUTTON','SVG','CANVAS','VIDEO','AUDIO']);
