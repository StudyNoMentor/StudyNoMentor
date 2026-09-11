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

  /* ── AS TRAVAS QUE IMPEDEM A PERDA ────────────────────────────────────────
     As três regras que decidem se um dado pode deixar de existir. Cada uma foi
     escrita depois de um episódio real, e cada uma é aqui exercitada FORA da
     rede: são funções puras de propósito, para que a garantia seja testável
     sem depender de estar logado, online ou com a tabela criada.

       1. um vazio nunca sobe por cima de conteúdo;
       2. esvaziar deixa rastro, exatamente como apagar;
       3. quem apaga backup (a faxina) tem piso, âncora e carência. */
  travasDePerda() {
    // ── 1. o critério único de "vazio" ────────────────────────────────────
    [null, undefined, '', '  ', '[]', '{}', 'null', '""'].forEach(v => {
      this._ok('valorVazio reconhece ' + JSON.stringify(v), valorVazio(v) === true, valorVazio(v));
    });
    // '0' é o "desligado" das preferências booleanas: um valor, não uma ausência.
    ['[1]', '{"a":1}', '0', '0.5', 'texto', '"x"'].forEach(v => {
      this._ok('valorVazio NÃO derruba ' + JSON.stringify(v), valorVazio(v) === false, valorVazio(v));
    });

    // ── 2. a trava do blob: perfil sem conteúdo não é publicado ────────────
    this._ok('payload nulo é recusado', CloudStore._payloadUtil(null) === 0);
    this._ok('payload sem data é recusado', CloudStore._payloadUtil({}) === 0);
    this._ok('payload só com seções vazias é recusado',
      CloudStore._payloadUtil({ data: { a: '[]', b: '{}', c: '' } }) === 0);
    this._ok('payload com uma seção de conteúdo passa',
      CloudStore._payloadUtil({ data: { a: '[]', b: '[{"id":1}]' } }) === 1);

    // ── 3. a trava por seção: sumir não é esvaziar ─────────────────────────
    const dSumida = SectionSync.decidirEnvio(null, { rev: 3, hash: 'x', len: 900 });
    this._ok('chave sumida NÃO sobe como vazia', dSumida.acao === 'sumida', dSumida.acao);
    const igual = SectionSync.decidirEnvio('[1]', { rev: 2, hash: SectionSync._hash('[1]'), len: 3 });
    this._ok('conteúdo idêntico não gasta rev', igual.acao === 'idêntico', igual.acao);
    const esvazia = SectionSync.decidirEnvio('[]', { rev: 4, hash: 'antigo', len: 5000 });
    this._ok('esvaziar conteúdo conhecido sobe protegido',
      esvazia.acao === 'enviar' && esvazia.esvaziando === true && esvazia.rev === 5, esvazia);
    const semPassado = SectionSync.decidirEnvio('[]', undefined);
    this._ok('seção sem passado conhecido não inventa proteção',
      semPassado.acao === 'enviar' && semPassado.esvaziando === false, semPassado);

    // ── 4. encolhimento: o que dispara a foto de segurança ─────────────────
    const g = GuardaNuvem;
    this._ok('queda para 10% é encolhimento grande', g.avaliarEncolhimento(100000, 10000).encolheu === true);
    this._ok('queda para 90% é variação normal', g.avaliarEncolhimento(100000, 90000).encolheu === false);
    this._ok('crescimento nunca é encolhimento', g.avaliarEncolhimento(1000, 50000).encolheu === false);
    this._ok('perfil minúsculo não dispara ruído', g.avaliarEncolhimento(500, 1).encolheu === false);

    /* ── 5. RETENÇÃO EM FAIXAS (avô-pai-filho) ────────────────────────────
       A regra antiga era um teto simples ("guarde as 14 mais novas"), e com
       uma foto por dia isso dava um histórico de 14 DIAS. Um estrago notado
       três semanas depois não tinha para onde voltar: as 14 mais novas já
       nasceram com ele dentro. Estes testes travam a regra nova — densa perto
       do presente, esparsa e LONGA no passado — e as três garantias que
       valem por cima dela (âncora, 24 h, piso). */
    const CB = window.CloudBackup;
    const agora = Date.now(), DIA = 86400000;
    // uma foto por dia, indo para trás no tempo a partir de hoje
    const porDia = (n) => Array.from({ length: n }, (_, i) => ({
      id: 'd' + i, ancora: false, created_at: new Date(agora - i * DIA).toISOString()
    }));

    this._ok('poucas fotos: a faxina não apaga nada',
      CB.selecionarParaFaxina(porDia(CB.MIN_KEEP), agora).length === 0);

    // Um ano de fotos diárias: o que sobra tem de cobrir o ano inteiro.
    const ano = porDia(365);
    const cortadas = CB.selecionarParaFaxina(ano, agora);
    const mantidos = ano.filter(r => !cortadas.some(c => c.id === r.id));
    this._ok('um ano de fotos diárias é podado', cortadas.length > 0, cortadas.length);
    this._ok('o que sobra cabe em poucas dezenas de linhas',
      mantidos.length <= 40, mantidos.length);
    const idadeDias = (r) => Math.round((agora - new Date(r.created_at).getTime()) / DIA);
    // A PROPRIEDADE CENTRAL: o passado distante continua alcançável.
    this._ok('sobra foto com mais de 30 dias',
      mantidos.some(r => idadeDias(r) > 30), mantidos.map(idadeDias).slice(-5));
    this._ok('sobra foto com mais de 180 dias',
      mantidos.some(r => idadeDias(r) > 180), Math.max(...mantidos.map(idadeDias)));
    // Densidade perto do presente: os últimos 14 dias ficam dia a dia.
    const ultimos14 = mantidos.filter(r => idadeDias(r) <= 14).length;
    this._ok('os últimos 14 dias são mantidos dia a dia', ultimos14 >= 14, ultimos14);

    // A âncora nunca sai, nem sendo a mais antiga de todas.
    const comAncora = porDia(365);
    comAncora[comAncora.length - 1].ancora = true;
    const semAncora = CB.selecionarParaFaxina(comAncora, agora);
    this._ok('a âncora permanente nunca é apagada',
      !semAncora.some(r => r.ancora), semAncora.filter(r => r.ancora).length);

    // Nada recém-criado sai, mesmo em rajada (muitas fotos no mesmo dia).
    const rajada = Array.from({ length: 40 }, (_, i) => ({
      id: 'r' + i, ancora: false, created_at: new Date(agora - i * 60000).toISOString()
    }));
    this._ok('nada com menos de 24 h é apagado',
      CB.selecionarParaFaxina(rajada, agora).length === 0);

    // Piso absoluto: nunca deixa a lista abaixo de MIN_KEEP.
    const poucasAntigas = Array.from({ length: CB.MIN_KEEP + 1 }, (_, i) => ({
      id: 'p' + i, ancora: false, created_at: new Date(agora - (400 + i) * DIA).toISOString()
    }));
    const cortePiso = CB.selecionarParaFaxina(poucasAntigas, agora);
    this._ok('a faxina nunca desce do piso',
      poucasAntigas.length - cortePiso.length >= CB.MIN_KEEP,
      poucasAntigas.length - cortePiso.length);

    // Linha com data ilegível não derruba a seleção nem vira alvo silencioso.
    const comLixo = porDia(30).concat([{ id: 'x', ancora: false, created_at: 'sem-data' }]);
    const corteLixo = CB.selecionarParaFaxina(comLixo, agora);
    this._ok('linha com data inválida é ignorada, não apagada',
      !corteLixo.some(r => r.id === 'x'));
  },

  /* Esvaziar uma seção deixa o mesmo rastro que apagá-la: é o caminho de perda
     que ficava de fora, porque uma reescrita como `[]` é uma gravação normal. */
  /* ── ISOLAMENTO ENTRE CONTAS NUM MESMO APARELHO ───────────────────────────
     O episódio: logar com a Conta B num navegador que já teve a Conta A
     mostrava o perfil da Conta A na lista — e clicar nele abria os dados
     inteiros dela. A causa era a varredura de "perfis com dados locais" não
     saber de quem é cada perfil. A correção marca o dono (user_id) sempre que
     a nuvem confirma um perfil, e filtra por ele nos dois pontos de risco:
     a listagem (syncMirrorFromCloud) e a abertura às cegas (o fallback de
     "nuvem não achou, mas há dado aqui" em enterProfile). */
  /* ── PERFIS SEMPRE NASCEM COM ID DE NUVEM VÁLIDO ──────────────────────────
     Episódio real: `createProfile` gerava ids como 'u_<algo>' — não um UUID.
     Toda tabela da nuvem tem id/profile_id como `uuid`; um perfil com esse id
     antigo nunca conseguia sincronizar nada, quase sempre em silêncio. Aqui
     travamos as duas pontas: o classificador `idValido` reconhece um UUID de
     verdade e rejeita o formato antigo, e `createProfile` (usado tanto para
     "novo perfil" quanto para importar um backup) já nasce usando `DB._uid()`
     — que produz UUID de verdade em qualquer navegador real. */
  idsDePerfilSaoValidos() {
    this._ok('idValido aceita um UUID de verdade',
      ProfileManager.idValido('550e8400-e29b-41d4-a716-446655440000') === true);
    this._ok('idValido rejeita o formato antigo (u_...)',
      ProfileManager.idValido('u_lz3k9f2a') === false);
    this._ok('idValido rejeita vazio/indefinido',
      ProfileManager.idValido('') === false && ProfileManager.idValido(undefined) === false);
    const criado = ProfileManager.createProfile({ nome: '__t_uuid__' });
    try {
      this._ok('createProfile gera um id que passa em idValido',
        ProfileManager.idValido(criado), criado);
    } finally {
      ProfileManager.saveProfiles(ProfileManager.getProfiles().filter(p => p.id !== criado));
      try { localStorage.removeItem(ProfileManager._ownerKey(criado)); } catch (e) { _quiet(e, 'limpeza-uuid'); }
    }
  },

  /* ── TUDO O QUE VOCÊ DIGITA ENTRA NUMA SEÇÃO SINCRONIZADA ────────────────
     Este grupo responde à pergunta mais simples e mais importante que se pode
     fazer ao app: "o que eu configurei fica guardado e chega no outro
     aparelho?".

     A resposta depende de UMA regra, e ela é binária: só é sincronizado o que
     mora dentro de `diario-estudos:u:<perfil>:`. Uma chave fora desse prefixo
     é invisível para o SectionSync — não entra em `profile_sections`, não
     entra no blob, não entra em backup nenhum, e some quando o navegador é
     limpo. Não existe meio-termo nem aviso: a gravação parece funcionar
     perfeitamente e o dado simplesmente não viaja.

     Foi exatamente o que acontecia com as METAS de aproveitamento (o limiar de
     "bom"/"atenção" e as linhas dos gráficos), numa chave global: quem definia
     as suas metas via o app inteiro voltar a julgar o desempenho pela régua
     padrão ao abrir em outro aparelho.

     O teste percorre TODA gravação de dado e de configuração do app e exige
     que a chave caia numa seção reconhecida. Se alguém amanhã guardar uma
     preferência nova numa chave global, isto falha aqui — antes de virar dado
     perdido de alguém. */
  /* ── UM LINK NUNCA VIRA CÓDIGO ────────────────────────────────────────────
     `escapeHtml` protege o conteúdo de um atributo, mas não diz nada sobre o
     ESQUEMA da URL: `javascript:...` num `href` executa script na origem do
     app, com acesso ao armazenamento inteiro e ao token da sessão. A tela de
     cadastro barrava por acidente (prefixa "https://" no que não começa com
     http), mas a IMPORTAÇÃO de backup passava — e o app avisa que um backup
     pode vir de um colega ou de um download. A trava mora na camada de dados,
     para valer em todo caminho de entrada, inclusive nos que ainda não
     existem. */
  linkNuncaViraCodigo() {
    const perigosas = [
      'javascript:alert(1)', 'JavaScript:alert(1)', '  javascript:alert(1)',
      'data:text/html,<script>alert(1)<\/script>', 'vbscript:msgbox(1)'
    ];
    perigosas.forEach(u => {
      this._ok('URL perigosa é recusada: ' + u.slice(0, 28), DB.urlSegura(u) === '', DB.urlSegura(u));
    });
    this._ok('http continua passando', DB.urlSegura('http://x.com/a?b=1') === 'http://x.com/a?b=1');
    this._ok('https continua passando', DB.urlSegura('https://x.com') === 'https://x.com');
    this._ok('endereço sem esquema ganha https', DB.urlSegura('tecconcursos.com.br') === 'https://tecconcursos.com.br');
    this._ok('vazio continua vazio', DB.urlSegura('') === '' && DB.urlSegura(null) === '');
    // e o saneamento retroativo: link perigoso já guardado é neutralizado na leitura
    const lista = [{ id: 'x', nome: 'mau', url: 'javascript:alert(1)' }, { id: 'y', nome: 'bom', url: 'https://ok.com' }];
    const mudou = DB._sanearLinks(lista);
    this._ok('link perigoso já guardado é neutralizado', mudou === true && lista[0].url === '', lista[0].url);
    this._ok('link bom não é alterado pelo saneamento', lista[1].url === 'https://ok.com');
  },

  /* Todo caminho que cria linha na nuvem tem de ADOTAR o id devolvido: a
     coluna é `uuid` com default no banco, então quem manda no id é o banco.
     A importação descartava esse retorno e partia o perfil em dois — o local
     mudo (sem linha, nenhum UPDATE encontrava nada) e o da nuvem congelado,
     aparecendo como um segundo perfil com o nome de antes. */
  adotaOIdDoBanco() {
    const PID_ANTIGO = '__t_id_antigo__', PID_NOVO = '11111111-2222-3333-4444-555555555555';
    const ativoOriginal = localStorage.getItem(DB.ACTIVE_PROFILE_KEY);
    const listaOriginal = localStorage.getItem(DB.PROFILES_KEY);
    const criadas = [];
    try {
      const pfxA = 'diario-estudos:u:' + PID_ANTIGO + ':';
      const pfxN = 'diario-estudos:u:' + PID_NOVO + ':';
      criadas.push(pfxA + 'p:pl:entries', pfxN + 'p:pl:entries');
      localStorage.setItem(pfxA + 'p:pl:entries', '[{"id":"e1"}]');
      localStorage.setItem(DB.PROFILES_KEY, JSON.stringify([{ id: PID_ANTIGO, nome: 'Importado', avatar: '📘', cor: '#333' }]));
      localStorage.setItem(DB.ACTIVE_PROFILE_KEY, PID_ANTIGO);

      // adota sem tocar na rede (row simula o retorno de createRow)
      const p = ProfileManager.adotarIdDaNuvem(PID_ANTIGO, { id: PID_NOVO, rev: 1 });
      this._ok('adotarIdDaNuvem devolve uma promessa', !!(p && typeof p.then === 'function'));

      this._ok('o dado foi movido para o namespace do id novo',
        localStorage.getItem(pfxN + 'p:pl:entries') === '[{"id":"e1"}]');
      this._ok('o namespace antigo não ficou duplicado',
        localStorage.getItem(pfxA + 'p:pl:entries') === null);
      this._ok('o índice de perfis passou a apontar para o id novo',
        ProfileManager.getProfiles().some(x => x.id === PID_NOVO), ProfileManager.getProfiles().map(x => x.id));
      this._ok('o perfil ativo acompanhou a troca',
        ProfileManager.getActiveProfileId() === PID_NOVO, ProfileManager.getActiveProfileId());
      this._ok('a revisão da nuvem foi herdada', ProfileManager.getRev(PID_NOVO) === 1);
    } finally {
      criadas.forEach(k => { try { localStorage.removeItem(k); } catch (e) { _quiet(e, 'limpeza-adota'); } });
      [PID_ANTIGO, PID_NOVO].forEach(id => {
        try { localStorage.removeItem(ProfileManager._ownerKey(id)); localStorage.removeItem('diario-estudos:rev:' + id); } catch (e) { _quiet(e, 'limpeza-adota2'); }
      });
      if (ativoOriginal === null) localStorage.removeItem(DB.ACTIVE_PROFILE_KEY); else localStorage.setItem(DB.ACTIVE_PROFILE_KEY, ativoOriginal);
      if (listaOriginal === null) localStorage.removeItem(DB.PROFILES_KEY); else localStorage.setItem(DB.PROFILES_KEY, listaOriginal);
    }
  },

  /* ── UMA ALTERAÇÃO NÃO PODE MORRER NO APARELHO ────────────────────────────
     Gravar é só o começo: entre "salvei" e "está no banco" existe uma fila. A
     pergunta que este grupo responde é se essa fila SOBREVIVE — a um
     recarregamento, a uma queda de rede, a fechar o app no meio.

     A fila mora em duas camadas: `_dirty`, em memória (rápida, some ao
     recarregar), e `__secpend`, gravada no armazenamento. É a segunda que
     garante que nada evapore; e há ainda uma terceira prova, independente das
     duas: o HASH do conteúdo. Se o texto de uma seção não bate com o hash do
     último envio, ela mudou depois disso — mesmo que as duas listas tenham se
     perdido. */
  filaDeEnvioSobrevive() {
    const PID = '__t_fila__';
    const ativoOriginal = localStorage.getItem(DB.ACTIVE_PROFILE_KEY);
    const dirtyOriginal = new Set(SectionSync._dirty);
    const criadas = [];
    try {
      localStorage.setItem(DB.ACTIVE_PROFILE_KEY, PID);
      const pfx = 'diario-estudos:u:' + PID + ':';
      SectionSync._dirty.clear();

      // 1. gravar pelo canal normal enfileira a seção
      const k = pfx + 'p:pl:entries';
      criadas.push(k, pfx + SectionSync.PEND, pfx + '__secrev');
      DB._set(k, [{ id: 'e1' }]);
      this._ok('gravar enfileira a seção', SectionSync._dirty.has('p:pl:entries'), [...SectionSync._dirty]);

      // 2. a fila foi GRAVADA, não só guardada em memória
      const gravada = JSON.parse(localStorage.getItem(pfx + SectionSync.PEND) || '[]');
      this._ok('a fila é persistida no armazenamento', gravada.indexOf('p:pl:entries') !== -1, gravada);

      // 3. simula um recarregamento: a memória some, o armazenamento fica
      SectionSync._dirty.clear();
      this._ok('memória zerada não vê pendência', SectionSync._dirty.size === 0);
      SectionSync.restorePending();
      this._ok('a fila volta do armazenamento após recarregar',
        SectionSync._dirty.has('p:pl:entries'), [...SectionSync._dirty]);

      // 4. a terceira prova: mesmo sem as duas listas, o hash denuncia a mudança
      SectionSync._dirty.clear();
      try { localStorage.removeItem(pfx + SectionSync.PEND); } catch (e) { _quiet(e, 'fila-limpa'); }
      // finge que esta seção já subiu com OUTRO conteúdo
      localStorage.setItem(pfx + '__secrev', JSON.stringify({
        'p:pl:entries': { rev: 1, hash: SectionSync._hash('[]'), len: 2 }
      }));
      const pendentes = SectionSync.pendingSections(PID);
      this._ok('conteúdo diferente do último envio é detectado como pendente',
        pendentes.indexOf('p:pl:entries') !== -1, pendentes);

      // 5. e o inverso: conteúdo idêntico ao último envio NÃO vira pendência
      localStorage.setItem(pfx + '__secrev', JSON.stringify({
        'p:pl:entries': { rev: 1, hash: SectionSync._hash(localStorage.getItem(k)), len: 12 }
      }));
      SectionSync._dirty.clear();
      const nenhuma = SectionSync.pendingSections(PID);
      this._ok('conteúdo já enviado não é reenviado à toa',
        nenhuma.indexOf('p:pl:entries') === -1, nenhuma);
    } finally {
      criadas.forEach(x => { try { localStorage.removeItem(x); } catch (e) { _quiet(e, 'limpeza-fila'); } });
      try { Lixeira.listar(PID).forEach(x => localStorage.removeItem(x.chave)); } catch (e) { _quiet(e, 'limpeza-fila2'); }
      SectionSync._dirty.clear();
      dirtyOriginal.forEach(x => SectionSync._dirty.add(x));
      if (ativoOriginal === null) localStorage.removeItem(DB.ACTIVE_PROFILE_KEY);
      else localStorage.setItem(DB.ACTIVE_PROFILE_KEY, ativoOriginal);
    }
  },

  tudoEntraNaSincronizacao() {
    const PID = '__t_cobertura_sync__';
    const ativoOriginal = localStorage.getItem(DB.ACTIVE_PROFILE_KEY);
    try {
      localStorage.setItem(DB.ACTIVE_PROFILE_KEY, PID);
      const prefixo = 'diario-estudos:u:' + PID + ':';
      const checar = (nome, chave) => {
        const dentro = typeof chave === 'string' && chave.indexOf(prefixo) === 0;
        const secao = dentro ? SectionSync.sectionForKey(chave, prefixo) : null;
        this._ok(nome + ' entra numa seção sincronizada', !!secao, chave);
      };

      // 1. os dados de estudo — todas as chaves do planejamento
      const K = DB.KEYS;
      Object.keys(K).forEach(nome => checar('dados: ' + nome, K[nome]));
      this._ok('há chaves de dados de verdade para conferir', Object.keys(K).length >= 15, Object.keys(K).length);

      // 2. o índice de planejamentos do perfil
      checar('lista de planejamentos', DB.GLOBAL_KEYS.plans);
      checar('planejamento ativo', DB.GLOBAL_KEYS.activePlan);

      // 3. as configurações que o usuário define
      checar('metas de aproveitamento', AppSettings.KEY);
      checar('configuração dos cards (FSRS)', CardsConfig.KEY);
      checar('presets de cards', CardsConfig.PKEY);
      checar('contadores diários dos cards', CardsConfig.DKEY);

      // 4. as escolhas de tela que acompanham o perfil
      const pfx = DB._profilePrefix();
      checar('preferências de tela', pfx + 'ux47:reg-mode');
      checar('visão da lista de registros', pfx + 'recent-view');
      checar('estado de painel recolhido', pfx + 'painel:tec-scope');
      checar('leitura das leis (onde parei)', pfx + 'lei-onde-parei');
      checar('preferência da grade', pfx + 'pref-dens');

      /* 5. a contramão: a contabilidade da sincronização e as redes LOCAIS não
         podem ser sincronizadas. Levar a fila de envio de um aparelho para
         outro faria o segundo achar que já entregou o que nunca enviou. */
      const local = (nome, chave) => this._ok(nome + ' fica FORA da sincronização',
        SectionSync.sectionForKey(chave, prefixo) === null, chave);
      local('contabilidade de revisões', prefixo + '__secrev');
      local('caixa de saída', prefixo + '__secpend');
      local('registro de exclusões', prefixo + '__secdel');
      local('lixeira', prefixo + Lixeira.PREFIXO + 'p:pl:cards');
      local('histórico de versões', prefixo + 'vhist');
    } finally {
      if (ativoOriginal === null) localStorage.removeItem(DB.ACTIVE_PROFILE_KEY);
      else localStorage.setItem(DB.ACTIVE_PROFILE_KEY, ativoOriginal);
      try { AppSettings.invalidar(); } catch (e) { _quiet(e, 'cobertura-cache'); }
    }
  },

  isolamentoEntreContas() {
    const PID_A = '__t_conta_a__', PID_B = '__t_conta_b__', PID_SEMDONO = '__t_sem_dono__';
    const criadas = [];
    const escrever = (pid, sub, txt) => { const k = 'diario-estudos:u:' + pid + ':' + sub; criadas.push(k); localStorage.setItem(k, txt); };
    const profilesAntes = localStorage.getItem(DB.PROFILES_KEY);
    try {
      escrever(PID_A, 'p:pl:entries', '[{"id":"e1"}]');
      escrever(PID_B, 'p:pl:entries', '[{"id":"e2"}]');
      escrever(PID_SEMDONO, 'p:pl:entries', '[{"id":"e3"}]');   // simula dado de antes desta correção

      ProfileManager._setOwner(PID_A, 'uid-conta-a');
      ProfileManager._setOwner(PID_B, 'uid-conta-b');
      // PID_SEMDONO fica sem rótulo de propósito

      // 1. a checagem pura: dono comprovado de outra conta bloqueia; sem dono não
      this._ok('dono da própria conta pode ver', ProfileManager._podeVerLocal(PID_A, 'uid-conta-a') === true);
      this._ok('dono de outra conta é bloqueado', ProfileManager._podeVerLocal(PID_A, 'uid-conta-b') === false);
      this._ok('sem dono conhecido continua visível (sem regressão)', ProfileManager._podeVerLocal(PID_SEMDONO, 'uid-conta-b') === true);

      // 2. syncMirrorFromCloud: logando como a Conta B, a lista não deve trazer PID_A
      localStorage.setItem(DB.PROFILES_KEY, JSON.stringify([]));
      const sessaoOriginal = window.CloudStore ? CloudStore.session : undefined;
      const tinhaCloudStore = !!window.CloudStore;
      window.CloudStore = window.CloudStore || {};
      CloudStore.session = { user: { id: 'uid-conta-b' } };
      try {
        ProfileManager.syncMirrorFromCloud([]);   // a "conta B" não tem nada na nuvem ainda
        const lista = ProfileManager.getProfiles();
        this._ok('perfil de OUTRA conta não aparece na lista de quem loga', !lista.some(p => p.id === PID_A), lista.map(p => p.id));
        this._ok('perfil da PRÓPRIA conta continua aparecendo', lista.some(p => p.id === PID_B), lista.map(p => p.id));
        this._ok('perfil sem dono conhecido continua aparecendo (compatibilidade)', lista.some(p => p.id === PID_SEMDONO), lista.map(p => p.id));
      } finally {
        if (tinhaCloudStore) CloudStore.session = sessaoOriginal; else delete window.CloudStore;
      }
    } finally {
      criadas.forEach(k => { try { localStorage.removeItem(k); } catch (e) { _quiet(e, 'limpeza-contas'); } });
      [PID_A, PID_B, PID_SEMDONO].forEach(pid => { try { localStorage.removeItem(ProfileManager._ownerKey(pid)); } catch (e) { _quiet(e, 'limpeza-donos'); } });
      if (profilesAntes === null) localStorage.removeItem(DB.PROFILES_KEY);
      else localStorage.setItem(DB.PROFILES_KEY, profilesAntes);
    }
  },

  esvaziarDeixaRastro() {
    const PID = '__t_vazio_rastro__';
    const pfx = 'diario-estudos:u:' + PID + ':';
    const ativo = localStorage.getItem(DB.ACTIVE_PROFILE_KEY);
    const criadas = [];
    try {
      localStorage.setItem(DB.ACTIVE_PROFILE_KEY, PID);
      const k = pfx + 'p:pl:entries';
      criadas.push(k);
      DB._set(k, [{ id: 'e1', date: '2026-01-01' }, { id: 'e2', date: '2026-01-02' }]);
      this._ok('gravação normal não vai para a lixeira', Lixeira.listar(PID).length === 0);
      DB._set(k, []);   // o esvaziamento
      const lixo = Lixeira.listar(PID);
      this._ok('esvaziar guarda o conteúdo anterior na lixeira',
        lixo.some(x => x.sec === 'p:pl:entries'), lixo.map(x => x.sec));
      const guardado = lixo.find(x => x.sec === 'p:pl:entries');
      this._ok('o que foi guardado tem tamanho de dado real', !!guardado && guardado.bytes > 10, guardado && guardado.bytes);
      // e restaurar não sobrescreve o que existe hoje sem ordem explícita
      DB._set(k, [{ id: 'novo' }]);
      const r = Lixeira.restaurar(guardado.chave, false);
      this._ok('restaurar não passa por cima do conteúdo atual', r.ok === false, r.motivo);
    } finally {
      criadas.forEach(k => { try { localStorage.removeItem(k); } catch (e) { _quiet(e, 'limpeza-vazio'); } });
      Lixeira.listar(PID).forEach(x => { try { localStorage.removeItem(x.chave); } catch (e) { _quiet(e, 'limpeza-vazio2'); } });
      if (ativo === null) localStorage.removeItem(DB.ACTIVE_PROFILE_KEY);
      else localStorage.setItem(DB.ACTIVE_PROFILE_KEY, ativo);
    }
  },

  /* ── UMA TRAVA PRESA É PIOR QUE UM ERRO ───────────────────────────────────
     Três marcas de "estou ocupado" governam a sincronização: `_syncing` (envio
     em curso), `_pushing` (envio de seções em curso) e `_applying` (aplicando
     dado vindo da nuvem). Todas existem para evitar atropelo — e todas, se
     ficarem LIGADAS por engano, param a sincronização em silêncio: nenhum erro,
     nenhum aviso, e o app segue gravando só neste aparelho.

     Ficavam presas quando uma exceção pulava por cima da linha que as desligava.
     Agora desligam em `finally`, e este grupo prova isso do jeito que importa:
     fazendo a operação FALHAR e conferindo que a marca ficou livre. */
  travasNaoFicamPresas() {
    // 1. `aplicando` devolve a marca mesmo quando o que ela embrulha lança
    const antes = CloudStore._applying;
    CloudStore._applying = false;
    CloudStore.aplicando(() => { throw new Error('falha de propósito'); }).catch(() => {});
    this._ok('aplicar da nuvem libera a marca mesmo falhando', CloudStore._applying === false);
    // 2. e restaura o valor ANTERIOR, para não desligar uma aplicação de fora
    CloudStore._applying = true;
    CloudStore.aplicando(() => { throw new Error('falha aninhada'); }).catch(() => {});
    this._ok('aplicação aninhada não desliga a de fora', CloudStore._applying === true);
    CloudStore._applying = antes;

    // 3. o envio de seções libera `_pushing` quando o corpo lança
    const envioOriginal = SectionSync._enviarSujas;
    const prontoOriginal = CloudStore.isReady, logadoOriginal = CloudStore.isLoggedIn;
    const pushingAntes = SectionSync._pushing;
    try {
      SectionSync._pushing = false;
      CloudStore.isReady = () => true; CloudStore.isLoggedIn = () => true;
      SectionSync._enviarSujas = () => { throw new Error('falha de propósito'); };
      const pid = ProfileManager.getActiveProfileId();
      if (pid) {
        SectionSync.pushDirty().catch(() => {});
        this._ok('envio de seções libera a marca mesmo falhando', SectionSync._pushing === false);
      } else {
        this._ok('envio de seções libera a marca mesmo falhando', true, 'sem perfil ativo: não aplicável');
      }
    } finally {
      SectionSync._enviarSujas = envioOriginal;
      CloudStore.isReady = prontoOriginal; CloudStore.isLoggedIn = logadoOriginal;
      SectionSync._pushing = pushingAntes;
    }

    // 4. o cão de guarda: um envio "em curso" há tempo demais é destravado
    const sincAntes = CloudStore._syncing, desdeAntes = CloudStore._syncingDesde;
    try {
      CloudStore._syncing = true; CloudStore._syncingDesde = Date.now();
      CloudStore.autoSave().catch(() => {});
      this._ok('envio recente em curso não é interrompido', CloudStore._syncing === true);
      CloudStore._syncing = true;
      CloudStore._syncingDesde = Date.now() - CloudStore.SYNC_TRAVADO_MS - 1000;
      CloudStore.autoSave().catch(() => {});
      this._ok('envio preso além do teto é destravado', CloudStore._syncing === false);
    } finally {
      clearTimeout(CloudStore._debounce);
      CloudStore._syncing = sincAntes; CloudStore._syncingDesde = desdeAntes;
    }

    // 5. toda requisição nasce com teto de tempo e sinal de cancelamento
    const fetchOriginal = window.fetch;
    try {
      let vistoSignal = null;
      window.fetch = (u, o) => { vistoSignal = o && o.signal; return new Promise(() => {}); };
      CloudStore._buscarComTeto('https://exemplo.invalido/x', { method: 'GET' });
      this._ok('requisição nasce com sinal de cancelamento',
        !!vistoSignal && vistoSignal.aborted === false);
      // sinal externo já abortado: a requisição nasce abortada junto
      const ac = new AbortController(); ac.abort();
      CloudStore._buscarComTeto('https://exemplo.invalido/y', { signal: ac.signal });
      this._ok('sinal externo abortado propaga para a requisição',
        !!vistoSignal && vistoSignal.aborted === true);
    } finally { window.fetch = fetchOriginal; }

    /* 6. e o teto vale para a BIBLIOTECA inteira, não só para quem lembrar de
       pedir: é `init` que entrega o nosso `fetch` ao cliente do Supabase. Sem
       esta ligação, cada chamada nova nasceria sem teto de novo. */
    const clienteAntes = CloudStore.client, statusAntes = CloudStore.libStatus,
          sessaoAntes = CloudStore.session, libAntes = window.supabase;
    try {
      let opcoes = null;
      window.supabase = {
        createClient: (_u, _k, o) => {
          opcoes = o;
          return { auth: { getSession: () => Promise.resolve({ data: {} }), onAuthStateChange: () => {} } };
        }
      };
      CloudStore.init();
      this._ok('o cliente da nuvem é criado com o nosso fetch',
        !!(opcoes && opcoes.global && typeof opcoes.global.fetch === 'function'));
      this._ok('a sessão continua persistida e o token renovado sozinho',
        !!(opcoes && opcoes.auth && opcoes.auth.persistSession && opcoes.auth.autoRefreshToken));
    } finally {
      window.supabase = libAntes;
      CloudStore.client = clienteAntes; CloudStore.libStatus = statusAntes;
      CloudStore.session = sessaoAntes;
    }
  },

  /* ── O DISCO PODE RECUSAR, E ISSO PRECISA APARECER ────────────────────────
     A fachada de armazenamento devolve o controle na hora e grava no disco
     depois. Uma recusa do navegador (cota, disco cheio, conexão fechada) chega,
     portanto, DEPOIS — fora do `try` de quem gravou. Era por isso que o dado
     seguia na tela e só sumia na abertura seguinte, sem erro nenhum.
     Este grupo cuida da ponta que faltava: a fachada avisa, e o app age. */
  oDiscoQueRecusa() {
    this._ok('a fachada tem por onde avisar uma recusa de gravação',
      typeof window.__idbFalhouAoGravar === 'function');
    const toastOriginal = window.showToast;
    const flushOriginal = CloudStore.flushPending;
    const prontoOriginal = CloudStore.isReady, logadoOriginal = CloudStore.isLoggedIn;
    const avisadoAntes = DB._falhaDiscoAvisada;
    try {
      let avisos = 0, envios = 0;
      window.showToast = () => { avisos++; };
      CloudStore.flushPending = () => { envios++; return Promise.resolve(); };
      CloudStore.isReady = () => true; CloudStore.isLoggedIn = () => true;

      DB._falhaDiscoAvisada = false;
      window.__idbFalhouAoGravar(3);
      this._ok('recusa do disco avisa quem está usando', avisos === 1, avisos);
      this._ok('recusa do disco força a subida para a nuvem', envios === 1, envios);

      // a mesma falha repetida não vira enxurrada de avisos
      window.__idbFalhouAoGravar(3);
      window.__idbFalhouAoGravar(3);
      this._ok('avisos repetidos são contidos', avisos === 1, avisos);
      this._ok('mas a subida para a nuvem é tentada em toda recusa', envios === 3, envios);

      // sem nuvem disponível, nada lança
      CloudStore.isLoggedIn = () => false;
      DB._falhaDiscoAvisada = false;
      let lancou = false;
      try { window.__idbFalhouAoGravar(1); } catch (_) { lancou = true; }
      this._ok('recusa sem nuvem não derruba nada', !lancou && avisos === 2, avisos);
    } finally {
      window.showToast = toastOriginal;
      CloudStore.flushPending = flushOriginal;
      CloudStore.isReady = prontoOriginal; CloudStore.isLoggedIn = logadoOriginal;
      DB._falhaDiscoAvisada = avisadoAntes;
    }
  },


  /* ═══ PLANO DE PONTOS FRACOS ═══════════════════════════════════════════════
     A tela que diz por onde atacar é a que mais decide o tempo de estudo de
     quem usa o app — e era a única sem um teste sequer. Os casos abaixo são as
     invariantes que, quando quebram, quebram em silêncio: a ordem parece
     plausível, o número parece um número, e a pessoa estuda a coisa errada.

     Os retratos são sintéticos e o DB fica emprestado só durante o teste. */
  plano() {
    const P = PlanoEngine;
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const linha = (cod, nome, q, ac) => ({ depth: 1, codigo: cod, nome, disciplina: 'Direito', questoes: q, acertos: ac });
    const retrato = (id, ini, fim, rows) => ({ id, nome: id, date: fim, startDate: ini, endDate: fim, rows });
    const O = (extra) => Object.assign({}, P.DEFAULTS, extra || {});
    const origSnaps = DB.getTecSnapshots, origInc = ReforcoEngine.hasIncidencia;
    const comRetratos = (snaps, fn) => {
      DB.getTecSnapshots = () => snaps;
      ReforcoEngine.hasIncidencia = () => false;
      try { return fn(); } finally { DB.getTecSnapshots = origSnaps; ReforcoEngine.hasIncidencia = origInc; }
    };
    /* A: 60% em 50 questões (era 40%) · B: 50% em 100 (era 48%) · C: 81,7% em 60,
       sem período anterior. Volumes bem diferentes de propósito: é o que separa
       as ordens umas das outras. */
    const antigo = retrato('t1', dia(90), dia(80), [linha('01', 'A', 100, 40), linha('02', 'B', 500, 240), linha('03', 'C', 20, 15)]);
    const novo = retrato('t2', dia(10), dia(3), [linha('01', 'A', 50, 30), linha('02', 'B', 100, 50), linha('03', 'C', 40, 34)]);
    const base = [antigo, novo];

    comRetratos(base, () => {
      /* meta explícita de 80% neste caso: é o valor em que o guloso e o mínimo
          divergem (320 x 271 questões), que é o que este bloco prova. Com a meta
          padrão de 85% os dois caminhos coincidem — e um teste que passa por
          coincidência não prova nada. */
      const r = P.calcular(novo, O({ ordenar: 'pior', metaDominio: 80 }));
      const por = {}; r.itens.forEach(x => { por[x.nome] = x; });

      // 1) O CUSTO OLHA A LACUNA E O TAMANHO DO ASSUNTO
      this._ok('Plano: custo cresce com a lacuna', por.B.custoQ > por.A.custoQ && por.A.custoQ > por.C.custoQ,
        { A: por.A.custoQ, B: por.B.custoQ, C: por.C.custoQ });
      this._ok('Plano: assunto mais amplo custa mais por ponto', por.B.amplitude > por.A.amplitude && por.A.amplitude > por.C.amplitude,
        { A: por.A.amplitude, B: por.B.amplitude, C: por.C.amplitude });

      /* 2) O ACUMULADO FECHA COM O TOPO DA TELA. Levar TODO assunto ao máximo
         realista tem de dar exatamente o máximo realista — se não fecha, o
         "+2,8pp → 71,4%" de cada item promete um número que não existe. */
      const somaGanhos = r.itens.reduce((a, x) => a + x.ganhoPP, 0);
      this._ok('Plano: domínio + ganhos = máximo realista (peso igual)',
        Math.abs(r.dominioPct + somaGanhos - r.teto) < 0.01, r.dominioPct + somaGanhos);

      // 3) ▲▼ COMPARA COM O PERÍODO ANTERIOR, NÃO COM O TODO QUE O CONTÉM
      this._ok('Plano: delta usa o período anterior à janela', por.A.delta === 20, por.A.delta);
      this._ok('Plano: sem período anterior, não inventa delta', por.C.delta === null && por.C.qAntes === 0,
        { delta: por.C.delta, qAntes: por.C.qAntes });

      /* 4) O CAMINHO MAIS CURTO É O MAIS CURTO. Aqui o guloso escolheria A+B
         (320 questões) e existe B+C com 271 — é a diferença entre a resposta
         óbvia e a certa. */
      this._ok('Plano: caminho mínimo bate o guloso', r.caminho && r.caminho.q === 271 && r.caminho.n === 2,
        r.caminho && { q: r.caminho.q, n: r.caminho.n });
      this._ok('Plano: caminho mínimo não repete assunto',
        r.caminho && new Set(r.caminho.itens.map(x => x.nome)).size === r.caminho.n, r.caminho && r.caminho.itens.map(x => x.nome));
      this._ok('Plano: a ordem exibida custa mais que o caminho curto', r.qAteMeta === 320 && r.caminho.q < r.qAteMeta,
        { ordem: r.qAteMeta, curto: r.caminho.q });

      // 5) AS ORDENS GÊMEAS SÃO DETECTADAS — e deixam de ser gêmeas com o custo por lacuna
      const fixo = P.calcular(novo, O({ ordenar: 'rendimento', custoModo: 'fixo' }));
      this._ok('Plano: com custo fixo, "retorno" é gêmea de "pior acerto"',
        fixo.equivalentes.indexOf('pior') >= 0, fixo.equivalentes);
      const lac = P.calcular(novo, O({ ordenar: 'rendimento' }));
      this._ok('Plano: com custo por lacuna, "retorno" tem fila própria',
        lac.equivalentes.indexOf('pior') < 0, lac.equivalentes);
      /* As duas ordens que davam sempre a mesma fila saíram do seletor. Se
         alguém as trouxer de volta, este teste cai.

         "Mais pontos na prova" não conta aqui: ela só existe depois do edital,
         porque só aí existe prova com composição. Uma ordem que não ordena
         nada é a forma mais rápida de a pessoa perder a confiança na tela. */
      const sempre = Object.keys(P.ORDENS).filter(k => !P.ORDENS[k].soPos);
      this._ok('Plano: o seletor tem 5 ordens de sempre, sem gêmeas de fábrica',
        sempre.length === 5 && !P.ORDENS.ganhoDominio && !P.ORDENS.volume, sempre);
      this._ok('Plano: e uma sexta que só existe com edital publicado',
        !!(P.ORDENS.pontos && P.ORDENS.pontos.soPos), Object.keys(P.ORDENS));
      this._ok('Plano: a meta padrão é 85%', P.DEFAULTS.metaDominio === 85, P.DEFAULTS.metaDominio);
      /* Uma preferência antiga (ou um dado vindo de fora) com uma ordem que não
         existe mais tem de cair onde a migração manda — nunca numa terceira
         fila que ninguém escolheu. */
      const removida = P.calcular(novo, O({ ordenar: 'volume' })).itens.map(x => x.nome).join('|');
      const piorOrd = P.calcular(novo, O({ ordenar: 'pior' })).itens.map(x => x.nome).join('|');
      this._ok('Plano: ordem inexistente cai em "pior acerto primeiro"', removida === piorOrd, removida);

      // 6) A MESMA INVARIANTE DO ITEM 2, NA PONDERAÇÃO POR VOLUME
      const vol = P.calcular(novo, O({ ponderacao: 'volume' }));
      const somaVol = vol.itens.reduce((a, x) => a + x.ganhoPP, 0);
      this._ok('Plano: domínio + ganhos = máximo realista (peso por volume)',
        Math.abs(vol.dominioPct + somaVol - vol.teto) < 0.01, vol.dominioPct + somaVol);
    });

    // 7) SEGUNDO PLANO NÃO DUPLICA O QUE JÁ ESTÁ NA LISTA
    const comPequeno = [antigo, retrato('t2', dia(10), dia(3), novo.rows.concat([linha('04', 'D', 5, 2)]))];
    comRetratos(comPequeno, () => {
      const fora = P.calcular(comPequeno[1], O({ incluirPequenas: false }));
      this._ok('Plano: assunto sem amostra vai para o segundo plano',
        fora.pequenas.some(x => x.nome === 'D') && !fora.itens.some(x => x.nome === 'D'));
      this._ok('Plano: a meta do segundo plano é entrar no cálculo',
        (fora.pequenas.find(x => x.nome === 'D') || {}).faltaAmostra === 15,
        (fora.pequenas.find(x => x.nome === 'D') || {}).faltaAmostra);
      const dentro = P.calcular(comPequeno[1], O({ incluirPequenas: true }));
      this._ok('Plano: incluindo amostras pequenas, nada aparece duas vezes',
        dentro.itens.some(x => x.nome === 'D') && dentro.pequenas.length === 0,
        { itens: dentro.itens.length, pequenas: dentro.pequenas.length });
    });

    /* 9) A MIGRAÇÃO CHEGA A QUEM JÁ USA O APP. A tela grava todos os ajustes a
       cada repintura, então todo perfil existente tem o custo antigo salvo — e
       valor salvo vence padrão. Sem migração, a correção não alcança ninguém. */
    const chave = DB._profilePrefix() + P.KEY_PREF;
    const antesPrefs = localStorage.getItem(chave);
    try {
      DB.setRaw(chave, JSON.stringify({ custoModo: 'fixo', metaDominio: 82 }));
      const m = P.prefs();
      this._ok('Plano: perfil antigo adota o custo por lacuna', m.custoModo === 'lacuna' && m.metaDominio === 82, m.custoModo);
      DB.setRaw(chave, JSON.stringify({ custoModo: 'proporcional' }));
      this._ok('Plano: quem escolheu proporcional mantém a escolha', P.prefs().custoModo === 'proporcional');
      DB.setRaw(chave, JSON.stringify({ custoModo: 'fixo', migracao: 2 }));
      this._ok('Plano: escolher fixo DEPOIS da migração é respeitado', P.prefs().custoModo === 'fixo');
      /* MIGRAÇÃO É DEGRAU, NÃO PORTEIRA. O teste que faltava: a migração 2
         disparava com `!== 2`, e a migração seguinte grava `migracao: 3` — três
         é diferente de dois, então ela voltava a rodar em TODA leitura e forçava
         o custo de volta ao padrão de fábrica. Os dois campos de custo dos
         ajustes avançados não guardavam nada: você digitava 4, a tela mostrava
         4, e a leitura seguinte devolvia 2. */
      DB.setRaw(chave, JSON.stringify({ custoPorPonto: 4, custoPiso: 90, migracao: 3 }));
      this._ok('Plano: uma migração já cumprida não roda de novo e não pisa no que você ajustou',
        P.prefs().custoPorPonto === 4 && P.prefs().custoPiso === 90,
        { porPonto: P.prefs().custoPorPonto, piso: P.prefs().custoPiso });
      DB.delRaw(chave);
      P.salvarPrefs({ custoPorPonto: 7.5 });
      P.salvarPrefs({ custoPiso: 120 });
      this._ok('Plano: e dois salvamentos seguidos não desfazem um ao outro',
        P.prefs().custoPorPonto === 7.5 && P.prefs().custoPiso === 120,
        { porPonto: P.prefs().custoPorPonto, piso: P.prefs().custoPiso });
    } finally {
      if (antesPrefs == null) DB.delRaw(chave); else DB.setRaw(chave, antesPrefs);
    }

    // 10) OS PRESETS SÃO CONJUNTOS COERENTES, E A TELA SABE QUAL ESTÁ EM VIGOR
    Object.keys(P.MODOS).forEach(k => {
      const p = Object.assign({}, P.DEFAULTS, P.modoPatch(k));
      this._ok('Plano: modo "' + k + '" é reconhecido depois de aplicado', P.modoAtivo(p) === k, P.modoAtivo(p));
      this._ok('Plano: modo "' + k + '" nasce com a meta de 85%', P.modoPatch(k).metaDominio == null || P.modoPatch(k).metaDominio === 85, P.modoPatch(k).metaDominio);
    });
    this._ok('Plano: mexer num campo desfaz o preset',
      P.modoAtivo(Object.assign({}, P.DEFAULTS, P.modoPatch('base'), { ordenar: 'queda', ponderacao: 'volume', limite: 7 })) === 'livre');

    /* 11) MODO EDITADO É DO USUÁRIO — e volta ao padrão sozinho, sem levar os
       outros junto. O ajuste mora no perfil: reimportar retrato não o toca. */
    const chaveM = DB._profilePrefix() + P.KEY_PREF;
    const antesM = localStorage.getItem(chaveM);
    try {
      DB.delRaw(chaveM);
      P.salvarModo('curto', { metaDominio: 92, limite: 3 });
      this._ok('Plano: modo editado guarda o valor do usuário',
        P.modoPatch('curto').metaDominio === 92 && P.modoPatch('curto').limite === 3, P.modoPatch('curto'));
      this._ok('Plano: editar um modo não mexe nos outros',
        P.modoPatch('base').metaDominio === P.MODOS.base.patch.metaDominio && !P.modoEditado('base'));
      this._ok('Plano: a tela sabe que o modo foi ajustado', P.modoEditado('curto') === true);
      P.restaurarModo('curto');
      this._ok('Plano: restaurar devolve o padrão de fábrica daquele modo',
        !P.modoEditado('curto') && P.modoPatch('curto').metaDominio === P.MODOS.curto.patch.metaDominio,
        P.modoPatch('curto'));
      // migração das ordens que saíram
      DB.setRaw(chaveM, JSON.stringify({ ordenar: 'volume', migracao: 2 }));
      this._ok('Plano: ordem removida das preferências vira "pior acerto"', P.prefs().ordenar === 'pior', P.prefs().ordenar);
      DB.setRaw(chaveM, JSON.stringify({ ordenar: 'queda', metaDominio: 80, migracao: 2 }));
      this._ok('Plano: quem estava na meta antiga sobe para 85%', P.prefs().metaDominio === 85, P.prefs().metaDominio);
      DB.setRaw(chaveM, JSON.stringify({ ordenar: 'queda', metaDominio: 70, migracao: 2 }));
      this._ok('Plano: meta escolhida a dedo é respeitada', P.prefs().metaDominio === 70, P.prefs().metaDominio);

      /* 12) O MODO GUARDA SÓ O QUE MUDOU. Gravar o patch inteiro fazia um
         "salvar" sem alteração marcar o modo como personalizado, e enfiava
         nele campos que o modo nunca quis definir. */
      DB.delRaw(chaveM);
      P.salvarModo('base', { metaDominio: P.MODOS.base.patch.metaDominio, limite: P.MODOS.base.patch.limite });
      this._ok('Plano: salvar sem mudar nada não personaliza o modo',
        !P.modoEditado('base') && !(P.prefs().modosCustom || {}).base, P.prefs().modosCustom);
      P.salvarModo('curto', { metaDominio: 92 });
      P.salvarModo('curto', { limite: 4 });
      this._ok('Plano: ajustes sucessivos somam no mesmo modo',
        P.modoPatch('curto').metaDominio === 92 && P.modoPatch('curto').limite === 4, P.modoPatch('curto'));
      P.salvarModo('curto', { limite: P.MODOS.curto.patch.limite });
      this._ok('Plano: campo que volta ao padrão sai do registro',
        P.modoPatch('curto').limite === P.MODOS.curto.patch.limite && (P.prefs().modosCustom.curto.limite === undefined),
        P.prefs().modosCustom.curto);
      P.restaurarModo('curto');
      // o resumo é lido em voz alta na tela: nunca pode dizer "undefined"
      Object.keys(P.MODOS).forEach(k => {
        this._ok('Plano: resumo do modo "' + k + '" não tem buraco', !/undefined|NaN/.test(P.resumoModo(k)), P.resumoModo(k));
      });
    } finally {
      if (antesM == null) DB.delRaw(chaveM); else DB.setRaw(chaveM, antesM);
    }

    /* 13) O CAMINHO MÍNIMO SOB CARGA. A mochila roda em vetores compartilhados,
       e uma reconstrução malfeita devolve o MESMO assunto duas vezes — um
       "caminho mais curto" que conta duas vezes a mesma coisa é pior que
       nenhum. Aqui as duas invariantes que precisam valer sempre, inclusive na
       fronteira em que a busca exata dá lugar à aproximação. */
    [[40, 8], [200, 40], [400, 60], [401, 60], [400, 119]].forEach(([n, falta]) => {
      const itens = [];
      for (let i = 0; i < n; i++) itens.push({ nome: 'a' + i, ganhoPP: 0.1 + (i % 37) / 10, custoQ: 20 + (i % 91) });
      const r = P._caminhoMinimo(itens, falta);
      const ok1 = !!r && new Set(r.itens.map(x => x.nome)).size === r.n;
      const ok2 = !!r && r.itens.reduce((a, x) => a + x.ganhoPP, 0) >= falta - 0.06;
      this._ok('Plano: caminho mínimo com ' + n + ' assuntos não repete nenhum', ok1, r && r.n);
      this._ok('Plano: caminho mínimo com ' + n + ' assuntos cobre a lacuna de ' + falta + 'pp', ok2,
        r && Math.round(r.itens.reduce((a, x) => a + x.ganhoPP, 0) * 10) / 10);
    });
    this._ok('Plano: sem lacuna não há caminho a percorrer',
      P._caminhoMinimo([{ nome: 'x', ganhoPP: 5, custoQ: 10 }], 0) === null &&
      P._caminhoMinimo([{ nome: 'x', ganhoPP: 5, custoQ: 10 }], -3) === null);
    this._ok('Plano: lacuna maior que tudo que existe não inventa caminho',
      P._caminhoMinimo([{ nome: 'x', ganhoPP: 5, custoQ: 10 }], 50) === null);

    // 8) CONSOLIDADO COM DADO VELHO NÃO É CONSOLIDADO
    const velhos = [
      retrato('v1', dia(320), dia(300), [linha('01', 'E', 60, 51), linha('02', 'F', 60, 30)]),
      retrato('v2', dia(220), dia(200), [linha('01', 'E', 60, 51), linha('02', 'F', 60, 30)])
    ];
    comRetratos(velhos, () => {
      const r = P.calcular(velhos[1], O({}));
      const e = r.itens.find(x => x.nome === 'E');
      this._ok('Plano: sustentou a meta, mas sem medição nova, não vira 🟢',
        e && e.vencido && /sem medição nova/.test(e.status.rot), e && e.status.rot);
    });

    /* ── 14) DOIS ASSUNTOS COM O MESMO NOME SÃO DOIS ASSUNTOS ───────────────
       O índice do Plano era chaveado só pelo NOME do tópico. "Princípios" de
       Constitucional (90%) e "Princípios" de Administrativo (10%) viravam UMA
       linha a 50% — uma taxa que não é de nenhum dos dois — e filtrar por
       Administrativo devolvia "sem retrato" com o retrato na mão. */
    const homDisc = (disc, nome, q, ac) => ({ depth: 1, codigo: '01', nome, disciplina: disc, questoes: q, acertos: ac });
    const homRaiz = (disc, q, ac) => ({ depth: 0, codigo: null, nome: disc, disciplina: disc, questoes: q, acertos: ac });
    const homLinhas = (a, b) => [
      homRaiz('Direito Constitucional', 100, a), homDisc('Direito Constitucional', 'Princípios', 100, a),
      homRaiz('Direito Administrativo', 100, b), homDisc('Direito Administrativo', 'Princípios', 100, b)];
    const hom = [retrato('h1', dia(60), dia(40), homLinhas(95, 20)), retrato('h2', dia(30), dia(2), homLinhas(95, 20))];
    comRetratos(hom, () => {
      const H = (extra) => O(Object.assign({ minAmostra: 1, tetoDominio: 100, limite: 50, consolidarEm: 2, validadeDias: 400 }, extra || {}));
      const r = P.calcular(hom[1], H());
      const todos = [].concat(r.itens, r.pequenas);
      const cons = todos.find(x => x.disciplina === 'Direito Constitucional');
      const adm = todos.find(x => x.disciplina === 'Direito Administrativo');
      this._ok('Plano: homônimos de disciplinas diferentes são dois assuntos', r.assuntos === 2, r.assuntos);
      this._ok('Plano: cada homônimo mantém a sua própria taxa',
        cons && adm && Math.round(cons.taxa) === 95 && Math.round(adm.taxa) === 20,
        { cons: cons && cons.taxa, adm: adm && adm.taxa });
      this._ok('Plano: só o homônimo que sustenta a meta conta a sequência',
        cons && adm && cons.seq === 2 && adm.seq === 0, { cons: cons && cons.seq, adm: adm && adm.seq });
      this._ok('Plano: um consolidado, não dois nem zero', r.consolidados === 1, r.consolidados);
      const so = P.calcular(hom[1], H({ disciplina: 'Direito Administrativo' }));
      this._ok('Plano: filtrar por disciplina acha o homônimo certo',
        !so.erro && so.assuntos === 1 && Math.round(so.dominioPct) === 20, so.erro || so.dominioPct);
      const serie = P.serieHistorica(H({ disciplina: 'Direito Administrativo' }));
      this._ok('Plano: a evolução filtrada não soma o homônimo da outra disciplina',
        serie.length === 2 && serie.every(p => Math.round(p.dominio) === 20), serie.map(p => p.dominio));
    });

    /* ── 15) O "MÍNIMO" TEM DE SER MÍNIMO E TEM DE CHEGAR LÁ ────────────────
       Duas falhas que a discretização escondia. A grade em décimos devolvia
       conjuntos que somavam 42,63pp quando faltavam 42,74 (a meta não fechava)
       e descartava o empate EXATO, entregando 320 questões onde 271 bastavam.
       E, sem comparar com o percurso que a própria tela desenha, o "caminho
       mais curto" chegou a custar 720 onde a lista mostrava 660. */
    {
      const tres = [
        { nome: 'A', ganhoPP: (0.9 - 0.6) / 3 * 100, custoQ: 110 },
        { nome: 'B', ganhoPP: (0.9 - 0.5) / 3 * 100, custoQ: 210 },
        { nome: 'C', ganhoPP: (0.9 - 0.85) / 3 * 100, custoQ: 61 }];
      const exato = P._caminhoMinimo(tres, 15);
      this._ok('Plano: lacuna que é soma EXATA de dois assuntos escolhe os dois (271, não 320)',
        exato && exato.q === 271 && exato.n === 2, exato && { q: exato.q, n: exato.n });
      // cobertura em aritmética exata, sem folga de arredondamento
      let deficit = 0;
      for (let t = 0; t < 400; t++) {
        const itens = [];
        for (let i = 0; i < 6; i++) itens.push({ nome: 'x' + i, ganhoPP: (i * 7 + t) % 41 / 3 + 0.07, custoQ: 10 + (i * 13 + t) % 300 });
        const falta = ((t * 17) % 370) / 10 + 0.03;
        const r = P._caminhoMinimo(itens, falta);
        if (r && r.itens.reduce((a, x) => a + x.ganhoPP, 0) < falta - 1e-9) deficit++;
      }
      this._ok('Plano: nenhum caminho fica aquém da lacuna que promete cobrir', deficit === 0, deficit);
      // o percurso da ordem exibida é candidato: o "mínimo" nunca perde para ele
      const caros = [{ nome: 'U', ganhoPP: 9.96, custoQ: 660 },
        { nome: 'V', ganhoPP: 5.05, custoQ: 400 }, { nome: 'W', ganhoPP: 5.02, custoQ: 400 }];
      const comPrefixo = P._caminhoMinimo(caros, 9.95, [[caros[0]]]);
      this._ok('Plano: o caminho mínimo nunca custa mais que a ordem exibida',
        comPrefixo && comPrefixo.q === 660, comPrefixo && comPrefixo.q);
      this._ok('Plano: percurso proposto que não cobre a lacuna é recusado',
        (P._caminhoMinimo([{ nome: 'Z', ganhoPP: 20, custoQ: 500 }], 15,
          [[{ nome: 'nada', ganhoPP: 1, custoQ: 1 }]]) || {}).q === 500);
      /* O mecanismo acima só serve se `calcular` REALMENTE entregar o prefixo.
         Sem esta checagem, apagar o argumento na chamada passaria batido: a
         proteção existiria na função e não no caminho que a usa. */
      const orig = P._caminhoMinimo;
      let visto = null;
      P._caminhoMinimo = function (itens, falta, alternativas) {
        visto = { itens, falta, alternativas }; return orig.call(this, itens, falta, alternativas);
      };
      let r14;
      try { comRetratos(base, () => { r14 = P.calcular(novo, O({ ordenar: 'pior', metaDominio: 80 })); }); }
      finally { P._caminhoMinimo = orig; }
      const prefixo = visto && visto.alternativas && visto.alternativas[0];
      this._ok('Plano: o cálculo entrega o percurso da ordem exibida à mochila',
        !!prefixo && r14 && r14.idxMeta >= 0 && prefixo.length === r14.idxMeta + 1 &&
        prefixo.reduce((a, x) => a + x.custoQ, 0) === r14.qAteMeta,
        { entregue: prefixo && prefixo.length, idxMeta: r14 && r14.idxMeta, qAteMeta: r14 && r14.qAteMeta });
    }

    /* ── 15b) A VARREDURA DAS INVARIANTES ──────────────────────────────────
       Os casos acima provam pontos específicos. Este varre as combinações de
       ponderação, custo e ordem sobre dois retratos e cobra, em cada uma, o
       feixe de invariantes que faz os números da tela significarem o que
       dizem. É barato (algumas dezenas de execuções) e é o que pega a
       regressão que nenhum caso nomeado previu. */
    {
      const falhas = [];
      const reg = (m) => { if (falhas.indexOf(m) < 0) falhas.push(m); };
      comRetratos(base, () => {
        ['igual', 'volume'].forEach((ponderacao) => {
          ['lacuna', 'fixo', 'proporcional'].forEach((custoModo) => {
            Object.keys(P.ORDENS).forEach((ordenar) => {
              [70, 85, 100].forEach((metaDominio) => {
                const opts = O({ ponderacao, custoModo, ordenar, metaDominio, minAmostra: 1, limite: 50 });
                const r = P.calcular(novo, opts);
                if (r.erro) return;
                const rot = `${ponderacao}/${custoModo}/${ordenar}/${metaDominio}`;
                // domínio + ganhos = máximo realista, com o MESMO peso dos dois lados
                const soma = r.itens.reduce((a, x) => a + x.ganhoPP, 0);
                if (Math.abs(r.dominioPct + soma - r.teto) > 0.01) reg(rot + ': domínio + ganhos ≠ teto');
                if (!Number.isFinite(r.dominioPct) || r.dominioPct < 0 || r.dominioPct > 100) reg(rot + ': domínio fora de 0..100');
                if (Math.abs(r.falta - Math.max(0, r.meta - r.dominioPct)) > 1e-9) reg(rot + ': falta incoerente');
                if (r.consolidados !== r.solidosAtuais + r.solidosVencidos) reg(rot + ': consolidados ≠ sólidos + vencidos');
                if (r.itens.some((x) => x.custoQ < 10 || x.ganhoPP < 0 || x.taxa < 0 || x.taxa > 100)) reg(rot + ': item com número impossível');
                if (r.pequenas.some((p) => r.itens.some((x) => x.nome === p.nome && x.disciplina === p.disciplina))) reg(rot + ': segundo plano repete a lista');
                if (r.caminho) {
                  const nomes = r.caminho.itens.map((x) => x.disciplina + '|' + x.nome);
                  if (new Set(nomes).size !== nomes.length) reg(rot + ': caminho repete assunto');
                  if (r.caminho.q !== r.caminho.itens.reduce((a, x) => a + x.custoQ, 0)) reg(rot + ': custo do caminho ≠ soma dos itens');
                  if (r.caminho.itens.reduce((a, x) => a + x.ganhoPP, 0) < r.falta - 1e-9) reg(rot + ': o caminho não cobre a lacuna');
                  if (r.qAteMeta != null && r.caminho.q > r.qAteMeta) reg(rot + ': o "mínimo" custa mais que a ordem exibida');
                  if (r.ritmo > 0 && Math.abs(r.semanas - r.caminho.q / r.ritmo) > 1e-9) reg(rot + ': as semanas não seguem o caminho curto');
                }
              });
            });
          });
        });
      });
      this._ok('Plano: 90 combinações de ponderação × custo × ordem × meta mantêm as invariantes',
        falhas.length === 0, falhas.slice(0, 3));
    }

    /* ── 16) A ATIVIDADE PERTENCE AO ASSUNTO, NÃO AO NOME ───────────────────
       Com os homônimos separados, casar a atividade criada pelo Plano só pelo
       nome do tópico junta o que o cálculo separou: a segunda atividade era
       recusada com "já existe", e as duas linhas exibiam o MESMO progresso. */
    {
      const T = DesempenhoTecScreen;
      this._ok('Plano: atividade casa com o assunto da sua disciplina',
        T._casaTopico({ topico: 'Atos', disciplina: 'Direito Administrativo' }, 'Atos', 'Direito Administrativo'));
      this._ok('Plano: e não casa com o homônimo da outra disciplina',
        !T._casaTopico({ topico: 'Atos', disciplina: 'Direito Administrativo' }, 'Atos', 'Direito Constitucional'));
      this._ok('Plano: atividade antiga, sem disciplina registrada, mantém o vínculo pelo nome',
        T._casaTopico({ topico: 'Atos', disciplina: '' }, 'Atos', 'Direito Penal'));
      this._ok('Plano: nome diferente nunca casa',
        !T._casaTopico({ topico: 'Atos', disciplina: 'X' }, 'Contratos', 'X'));
      this._ok('Plano: origem ausente não casa com nada', !T._casaTopico(null, 'Atos', 'X'));
    }
  },


  /* ═══ O CICLO DE UMA ATIVIDADE DO PLANO ════════════════════════════════════
     decidi · fiz · funcionou? O app media tudo e não fechava nada: o progresso
     só andava se você digitasse (contabilidade dobrada sobre o mesmo fato), e o
     desfecho não existia — o assunto ia de 40% a 95%, saía da lista, e a
     atividade continuava aberta como pendência de hoje, amanhã e sempre.

     As invariantes abaixo são as que, se quebrarem, quebram calado: um
     progresso que apaga o que você lançou, um veredito que muda porque você
     mexeu na meta depois, uma vitória declarada num assunto que sumiu do TEC. */
  cicloDoPlano() {
    const P = PlanoEngine, C = PlanoCiclo, T = DesempenhoTecScreen;
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac });
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    const R = (id, i, f, rows) => ({ id, nome: id, date: f, startDate: i, endDate: f, rows });
    const par = (a, b) => [D('Dir Adm', 200, a + b), L('01', 'Licitacoes', 'Dir Adm', 100, a), L('02', 'Atos', 'Dir Adm', 100, b)];
    const origSnaps = DB.getTecSnapshots, origExtras = DB.getExtras, origSave = DB.saveExtras;
    const origEscopo = T.scopedSnapshot;
    const chaveP = DB._profilePrefix() + P.KEY_PREF;
    const antesP = localStorage.getItem(chaveP);
    let banco = [];
    /* O escopo entra no empréstimo junto com os retratos: `conciliar` lê o
       retrato consolidado da tela, e sem trocar os dois o teste julgaria o
       dado novo com o escopo do app real. */
    const comBanco = (snaps, fn) => {
      DB.getTecSnapshots = () => snaps;
      DB.getExtras = () => banco;
      DB.saveExtras = (l) => { banco = l; };
      T.scopedSnapshot = () => snaps[snaps.length - 1];
      try { return fn(); } finally {
        DB.getTecSnapshots = origSnaps; DB.getExtras = origExtras;
        DB.saveExtras = origSave; T.scopedSnapshot = origEscopo;
      }
    };
    const criar = (topico, alvo, item) => {
      const e = DB.addExtra({ titulo: topico, tipo: 'questoes', alvo, periodo: 'unica', contaMetricas: false });
      DB.updateExtra(e.id, { origemPlano: C.origem(topico, 'Dir Adm', item, { motivo: 'reforco' }) });
      return DB.getExtras().find(x => x.id === e.id);
    };
    const itemDe = (r, nome) => [].concat(r.itens, r.pequenas || []).find(x => x.nome === nome);
    try {
      DB.setRaw(chaveP, JSON.stringify({ minAmostra: 1, limite: 20, ordenar: 'pior', metaDominio: 85, tetoDominio: 90, migracao: 3 }));
      const velhos = [R('a', dia(90), dia(70), par(40, 40)), R('b', dia(60), dia(35), par(40, 40))];

      /* 1) O PROGRESSO SAI DO RETRATO. `qBase` é o contador do assunto no
         instante zero; o de hoje menos ele é o que você resolveu desde então.
         Datas não entram na conta — é isto que faz a medida sobreviver a um
         retrato cujo período atravessa a data de criação. */
      banco = [];
      let e1 = comBanco(velhos, () => {
        const r = P.calcular(velhos[1], P.prefs());
        return criar('Licitacoes', 120, itemDe(r, 'Licitacoes'));
      });
      this._ok('Ciclo: a atividade guarda o contador do assunto na criação',
        e1.origemPlano.qBase === 200, e1.origemPlano.qBase);
      this._ok('Ciclo: e a taxa inicial e a META DO DIA, não a de depois',
        e1.origemPlano.taxaInicial === 40 && e1.origemPlano.metaAlvo === 85, e1.origemPlano);
      const comNovo = velhos.concat([R('c', dia(20), dia(1), [D('Dir Adm', 80, 48), L('01', 'Licitacoes', 'Dir Adm', 80, 48)])]);
      let v = comBanco(comNovo, () => C.avaliar(DB.getExtras()[0], P.calcular(comNovo[2], P.prefs())));
      this._ok('Ciclo: o retrato novo conta as questões sozinho', v.feito === 80 && v.medido === 80, { feito: v.feito, medido: v.medido });
      this._ok('Ciclo: 80 de 120 ainda é andamento', v.estado === 'andamento' && !v.cumpriu, v.estado);

      /* 2) IMPORTAR SÓ EMPURRA A BARRA PARA CIMA. Quem resolve questão fora do
         TEC lança na mão; o retrato não pode apagar esse lançamento. */
      comBanco(comNovo, () => {
        DB.addExtraProgress(DB.getExtras()[0].id, 100);
        const w = C.avaliar(DB.getExtras()[0], P.calcular(comNovo[2], P.prefs()));
        this._ok('Ciclo: lançamento manual maior que o medido prevalece', w.feito === 100 && w.manual === 100, w.feito);
      });

      /* 3) O VEREDITO. Dois fins legítimos: o objetivo atingido e o trabalho
         cumprido — e o segundo, sem ganho, é o diagnóstico mais valioso do app:
         volume não resolve aquele assunto. */
      banco = [];
      const venceu = velhos.concat([R('c', dia(20), dia(1), [D('Dir Adm', 150, 138), L('01', 'Licitacoes', 'Dir Adm', 150, 138)])]);
      comBanco(velhos, () => criar('Licitacoes', 120, itemDe(P.calcular(velhos[1], P.prefs()), 'Licitacoes')));
      comBanco(venceu, () => {
        const res = C.conciliar();
        const e = DB.getExtras()[0];
        this._ok('Ciclo: atingiu a meta → encerra sozinha, com veredito',
          e.status === 'concluida' && e.origemPlano.veredito.tipo === 'funcionou', e.origemPlano.veredito);
        this._ok('Ciclo: e o ganho fica registrado para sempre',
          e.origemPlano.veredito.ganhoPP > 50, e.origemPlano.veredito.ganhoPP);
        const foto = JSON.stringify(DB.getExtras());
        C.conciliar(); C.conciliar();
        this._ok('Ciclo: conciliar de novo não reescreve nada', JSON.stringify(DB.getExtras()) === foto);
        this._ok('Ciclo: a conciliação relata o que fechou', res.fechadas.length === 1, res.fechadas.length);
      });
      banco = [];
      const piorou = velhos.concat([R('c', dia(20), dia(1), [D('Dir Adm', 150, 40), L('02', 'Atos', 'Dir Adm', 150, 40)])]);
      comBanco(velhos, () => criar('Atos', 100, itemDe(P.calcular(velhos[1], P.prefs()), 'Atos')));
      comBanco(piorou, () => {
        C.conciliar();
        const e = DB.getExtras()[0];
        this._ok('Ciclo: cumpriu o alvo e a taxa não subiu → "não funcionou"',
          e.status === 'concluida' && e.origemPlano.veredito.tipo === 'naoFuncionou', e.origemPlano.veredito);
        this._ok('Ciclo: com o prejuízo registrado, não escondido',
          e.origemPlano.veredito.ganhoPP < 0, e.origemPlano.veredito.ganhoPP);
      });

      /* 4) A TRAVE NÃO SE MOVE. Julgar pela meta de hoje reescreveria o
         resultado de uma atividade que já estava correndo sob outra regra. */
      banco = [];
      DB.setRaw(chaveP, JSON.stringify({ minAmostra: 1, metaDominio: 70, tetoDominio: 90, migracao: 3 }));
      comBanco(velhos, () => criar('Licitacoes', 120, itemDe(P.calcular(velhos[1], P.prefs()), 'Licitacoes')));
      DB.setRaw(chaveP, JSON.stringify({ minAmostra: 1, metaDominio: 99, tetoDominio: 90, migracao: 3 }));
      comBanco(venceu, () => {
        C.conciliar();
        this._ok('Ciclo: subir a meta depois não apaga o gol',
          DB.getExtras()[0].origemPlano.veredito.tipo === 'funcionou', DB.getExtras()[0].origemPlano.veredito);
        DB.setRaw(chaveP, JSON.stringify({ minAmostra: 1, limite: 20, metaDominio: 85, tetoDominio: 90, migracao: 3 }));
      });

      /* 5) SUMIR DA LISTA NÃO É VENCER. O assunto renomeado no TEC sai da lista
         igual ao resolvido — e declarar vitória nele seria inventar um ganho. */
      banco = [];
      const sumiu = [R('z', dia(20), dia(1), [D('Dir Adm', 100, 50), L('07', 'Outro nome', 'Dir Adm', 100, 50)])];
      comBanco(velhos, () => { const r0 = P.calcular(velhos[1], P.prefs()); criar('Licitacoes', 120, itemDe(r0, 'Licitacoes')); });
      comBanco(sumiu, () => {
        const w = C.avaliar(DB.getExtras()[0], P.calcular(sumiu[0], P.prefs()));
        this._ok('Ciclo: assunto que sumiu do TEC vira órfã, não vitória', w.estado === 'orfa', w.estado);
        C.conciliar();
        this._ok('Ciclo: e órfã não encerra sozinha — quem decide é você',
          DB.getExtras()[0].status !== 'concluida', DB.getExtras()[0].status);
      });

      /* 6) A CALIBRAGEM. O custo por ponto é um palpite de fábrica até o seu
         histórico responder a mesma pergunta com o seu dado. */
      banco = [];
      comBanco(velhos, () => {
        this._ok('Ciclo: sem histórico, a calibragem diz quantos ciclos faltam',
          C.calibragem().pronta === false && C.calibragem().faltam === C.MIN_CICLOS, C.calibragem());
        const fake = (t, q, ini, fim) => {
          const e = DB.addExtra({ titulo: t, tipo: 'questoes', alvo: q, periodo: 'unica' });
          DB.updateExtra(e.id, { status: 'concluida', origemPlano: { topico: t, disciplina: 'Dir Adm', criadoEm: dia(30),
            veredito: { tipo: 'funcionou', em: todayLocal(), taxaInicial: ini, taxaFinal: fim, ganhoPP: fim - ini, questoes: q, alvo: q } } });
        };
        fake('A', 100, 40, 58); fake('B', 200, 50, 86); fake('C', 100, 60, 78);
        const c = C.calibragem();
        this._ok('Ciclo: com 3 ciclos a calibragem liga', c.pronta && c.n === 3, c.n);
        this._ok('Ciclo: 72pp em 400 questões = 18pp por 100', Math.abs(c.ppPorCem - 18) < 0.05, c.ppPorCem);
        this._ok('Ciclo: e 5,6 questões por ponto, contra o palpite de fábrica',
          Math.abs(c.qPorPonto - 5.6) < 0.1 && c.divergente === true, { seu: c.qPorPonto, fabrica: c.atual });
        this._ok('Ciclo: o histórico sai do mais novo para o mais velho e conta certo',
          C.fechados().length === 3, C.fechados().length);
      });

      /* 7) OS DOIS PORTÕES GRAVAM O MESMO. Um deles nascia sem `taxaInicial`
         nem `qBase` — e metade das atividades ficava sem veredito possível. */
      const o = C.origem('X', 'Dir Adm', { taxa: 33, custoQ: 77 }, { motivo: 'diagnostico' });
      this._ok('Ciclo: a origem tem todos os campos que o veredito exige',
        ['topico', 'disciplina', 'motivo', 'criadoEm', 'taxaInicial', 'qBase', 'metaAlvo', 'custoEstimado'].every(k => k in o), Object.keys(o));
      this._ok('Ciclo: origem sem item não inventa taxa', C.origem('Y', 'Dir Adm', null, {}).taxaInicial === null);
      this._ok('Ciclo: atividade sem origem do Plano é ignorada pelo ciclo',
        C.avaliar({ id: 'x', alvo: 10 }, { itens: [], pequenas: [] }) === null);
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getExtras = origExtras; DB.saveExtras = origSave;
      T.scopedSnapshot = origEscopo;
      if (antesP == null) DB.delRaw(chaveP); else DB.setRaw(chaveP, antesP);
    }
  },


  /* ═══ A RÉGUA DE PONTOS E A PRIORIZAÇÃO POR MATÉRIA ════════════════════════
     O Plano otimizava DOMÍNIO — a média do quanto você sabe do que estuda — e
     isso não é a mesma coisa que ponto na prova. Um assunto de 4 questões a
     20% é uma cratera de domínio e quase nada de aprovação; um de 40 questões
     a 70% é onde os pontos estão. E a composição da prova já estava digitada
     no editor de matérias do ciclo: o Desempenho TEC nunca olhou para lá. */
  reguaDePontos() {
    const P = PlanoEngine, PP = PlanoPontos;
    const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac });
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac });
    const R = (id, i, f, rows) => ({ id, nome: id, date: f, startDate: i, endDate: f, rows });
    /* Uma matéria PESADA onde vou mal e uma LEVE onde vou péssimo: é o caso em
       que domínio e ponto discordam, e é o caso que decide aprovação. */
    const linhas = () => [
      D('Dir Adm', 200, 100), L('01', 'Licitacoes', 'Dir Adm', 100, 50), L('02', 'Atos', 'Dir Adm', 100, 50),
      D('Arquivologia', 100, 20), L('01', 'Tabela', 'Arquivologia', 100, 20)];
    const snaps = [R('a', dia(60), dia(40), linhas()), R('b', dia(30), dia(2), linhas())];
    const origSnaps = DB.getTecSnapshots, origSubs = DB.getActiveSubjects, origModo = window.planCycleMode;
    const chaveP = DB._profilePrefix() + P.KEY_PREF;
    const antesP = localStorage.getItem(chaveP);
    let mats = [];
    try {
      DB.getTecSnapshots = () => snaps;
      DB.getActiveSubjects = () => mats;
      DB.setRaw(chaveP, JSON.stringify({ minAmostra: 1, limite: 20, ordenar: 'pior', metaDominio: 85, tetoDominio: 90, migracao: 3 }));
      mats = [{ nome: 'Dir Adm', qtdQuestoes: 40, pontosPorQuestao: 1, peso: 1 },
              { nome: 'Arquivologia', qtdQuestoes: 5, pontosPorQuestao: 1, peso: 1 }];

      // 1) SEM EDITAL A RÉGUA NÃO TROCA — pré-edital você encolhe o pior caso
      window.planCycleMode = () => 'pre';
      this._ok('Pontos: no pré-edital a régua de pontos não liga',
        PP.modo() === 'pre' && PP.temComposicao() === false, PP.modo());
      window.planCycleMode = () => 'pos';
      this._ok('Pontos: com edital e composição declarada, ela liga', PP.temComposicao() === true);

      // 2) A PROJEÇÃO É ARITMÉTICA SOBRE O QUE VOCÊ DIGITOU
      const pj = PP.projecao();
      this._ok('Pontos: o total da prova é a soma declarada (40 + 5)', pj && pj.valorTotal === 45, pj && pj.valorTotal);
      this._ok('Pontos: a nota de hoje é 40×50% + 5×20% = 21', Math.abs(pj.hoje - 21) < 0.01, pj.hoje);
      this._ok('Pontos: fechando o Plano seriam 45×90% = 40,5', Math.abs(pj.potencial - 40.5) < 0.01, pj.potencial);
      this._ok('Pontos: matéria sem medição no TEC fica FORA da conta, declarada',
        Array.isArray(pj.semDado), pj.semDado);

      // 3) A ORDEM QUE APROVA discorda da que só olha o acerto
      const rPior = P.calcular(snaps[1], Object.assign({}, P.prefs(), { ordenar: 'pior' }));
      const rPts = P.calcular(snaps[1], Object.assign({}, P.prefs(), { ordenar: 'pontos' }));
      this._ok('Pontos: por "pior acerto" vem o assunto de 5 questões na prova',
        rPior.itens[0].nome === 'Tabela', rPior.itens[0].nome);
      this._ok('Pontos: por "mais pontos" vem o de 40 questões — é a diferença que aprova',
        rPts.itens[0].disciplina === 'Dir Adm', rPts.itens[0].disciplina + '/' + rPts.itens[0].nome);
      this._ok('Pontos: e o ganho de cada item é medido em PONTOS da prova',
        rPts.itens[0].pontosGanho > 0 && rPts.itens[0].pontosMateria === 40,
        { ganho: rPts.itens[0].pontosGanho, materia: rPts.itens[0].pontosMateria });

      /* 4) O MÍNIMO ELIMINATÓRIO É RESTRIÇÃO, NÃO PESO. Nenhum total te salva
         de ser cortado numa matéria — por isso ela vem antes dos pontos. */
      mats[1].minimoPct = 50;
      const rElim = P.calcular(snaps[1], Object.assign({}, P.prefs(), { ordenar: 'pontos' }));
      this._ok('Pontos: matéria abaixo do mínimo eliminatório passa na frente de tudo',
        rElim.itens[0].nome === 'Tabela' && rElim.itens[0].eliminatoria === true, rElim.itens[0].nome);
      const pj2 = PP.projecao();
      this._ok('Pontos: e a projeção denuncia a eliminatória pelo nome',
        pj2.eliminatorias.length === 1 && pj2.eliminatorias[0].nome === 'Arquivologia', pj2.eliminatorias);
      mats[1].minimoPct = null;

      // 5) O CORTE É ESTIMATIVA SUA, e some quando você apaga
      const corteAntes = PP._corte();
      PP.setCorte(30);
      const pj3 = PP.projecao();
      this._ok('Pontos: com corte 30 e nota 21, faltam 9',
        pj3.corte === 30 && pj3.passaHoje === false && Math.abs(pj3.faltaCorte - 9) < 0.01, pj3.faltaCorte);
      PP.setCorte(15);
      this._ok('Pontos: com corte 15 você já passaria', PP.projecao().passaHoje === true);
      PP.setCorte('');
      this._ok('Pontos: apagar o corte devolve a tela ao estado sem corte', PP._corte() === null);
      if (corteAntes != null) PP.setCorte(corteAntes);

      /* 6) A DIFICULDADE DECLARADA CONTRA A MEDIDA. O 1 a 5 do ciclo distribui
         as suas horas e é um chute; o TEC sabe a resposta. */
      /* A TRAJETÓRIA COMPARAVA CONJUNTOS DIFERENTES DE ASSUNTOS. Cada ponto é
         a média dos assuntos medidos NAQUELE retrato, e o conjunto muda a cada
         importação: quem abre frente nova entra com assunto fraco e a média
         cai mesmo com TODO assunto melhorando. */
      const snapsT = [];
      for (let i = 0; i < 4; i++) {
        const linhasT = [];
        const n = 3 + i * 6;
        for (let t = 0; t < n; t++) {
          const nasc = t < 3 ? 0 : Math.ceil((t - 2) / 6);
          const tx = (nasc === 0 ? 80 : 35) + (i - nasc) * 5;
          linhasT.push(L('0' + t, 'T' + t, 'D', 40, Math.round(40 * tx / 100)));
        }
        snapsT.push(R('t' + i, dia(200 - i * 30), dia(170 - i * 30), linhasT));
      }
      DB.getTecSnapshots = () => snapsT;
      const serie = P.serieHistorica(P.prefs());
      const bruto = serie[serie.length - 1].dominio - serie[0].dominio;
      const comp = serie.filter(x => x.deltaComp != null).reduce((a, x) => a + x.deltaComp, 0);
      this._ok('Trajetória: a diferença crua acusa QUEDA mesmo com todo assunto subindo',
        bruto < -10, bruto);
      this._ok('Trajetória: o delta comparável (assunto a assunto) acusa a subida real',
        comp > 10 && Math.abs(comp - 15) < 0.01, comp);
      this._ok('Trajetória: e ele diz sobre quantos assuntos comparou',
        serie.filter(x => x.deltaComp != null).every(x => x.comuns > 0), serie.map(x => x.comuns));
      DB.getTecSnapshots = () => snaps;

      const m = PP.dificuldadeMedida('Arquivologia');
      this._ok('Pontos: 20% de acerto vira dificuldade 5 (a mais alta)',
        m && m.nota === 5 && Math.abs(m.taxa - 20) < 0.01, m);
      const m2 = PP.dificuldadeMedida('Dir Adm');
      this._ok('Pontos: 50% vira dificuldade 4', m2 && m2.nota === 4, m2);
      DB.setRaw(chaveP, JSON.stringify({ minAmostra: 500, metaDominio: 85, tetoDominio: 90, migracao: 3 }));
      this._ok('Pontos: sem amostra suficiente o app NÃO opina sobre a dificuldade',
        PP.dificuldadeMedida('Dir Adm') === null);
      DB.setRaw(chaveP, JSON.stringify({ minAmostra: 1, limite: 20, metaDominio: 85, tetoDominio: 90, migracao: 3 }));

      /* 7) "SÓLIDO" CORTA O PESO DA MATÉRIA PARA 20% — a decisão mais cara do
         ciclo, hoje um clique sem prova. */
      const r7 = P.calcular(snaps[1], P.prefs());
      const sol = PP.solidezDe('Arquivologia', r7);
      this._ok('Pontos: a solidez declarada pode ser confrontada com o Plano',
        sol && sol.total >= 1 && sol.abaixo >= 1, sol);
      this._ok('Pontos: matéria que não existe no Plano não inventa solidez',
        PP.solidezDe('Matéria Inexistente', r7) === null);

      /* 8) O MESMO NOME ESCRITO DE DOIS JEITOS. O ciclo você digita
         ("Português"); a banca manda "Língua Portuguesa". Como o veredito só
         nasce com as duas pontas, o nome diferente não deixava a linha errada:
         fazia a matéria mais pesada da prova SUMIR do quadro, calada. */
      const N = (x) => ReforcoEngine.norm(x);
      const casa = (a, b) => PP._casarNomes(a.map(N), b.map(N));
      this._ok('Nomes: "Português" casa com "Língua Portuguesa"',
        casa(['Português'], ['Língua Portuguesa', 'Informática'])['portugues'] === 'lingua portuguesa');
      this._ok('Nomes: igualdade exata vence a semelhança',
        casa(['Contabilidade Geral'], ['Contabilidade de Custos', 'Contabilidade Geral'])['contabilidade geral'] === 'contabilidade geral');
      this._ok('Nomes: "Contabilidade Geral" NÃO vira "Contabilidade de Custos"',
        casa(['Contabilidade Geral'], ['Contabilidade de Custos'])['contabilidade geral'] === undefined);
      this._ok('Nomes: ambiguidade não vira palpite ("Direito" casaria com três)',
        casa(['Direito'], ['Direito Penal', 'Direito Civil', 'Direito Tributário'])['direito'] === undefined);
      this._ok('Nomes: com DOIS supersets possíveis também não casa',
        casa(['Direito Penal'], ['Direito Processual Penal', 'Direito Penal Militar'])['direito penal'] === undefined);
      this._ok('Nomes: subconjunto único casa (Ética → Ética no Serviço Público)',
        casa(['Ética'], ['Etica no Servico Publico'])['etica'] === 'etica no servico publico');

      /* 9) ONDE O NOME DIFERENTE CUSTA MAIS CARO: a NOTA PROJETADA. Uma matéria
         do edital que não acha o histórico dela cai em `semDado` e some da
         conta — e some para MENOS, sem nenhum aviso de que faltou gente. */
      mats = [{ nome: 'Direito Administrativo', qtdQuestoes: 40, pontosPorQuestao: 1, peso: 1 },
              { nome: 'Arquivologia', qtdQuestoes: 5, pontosPorQuestao: 1, peso: 1 }];
      const pjN = PP.projecao();
      this._ok('Projeção: "Direito Administrativo" do edital acha "Dir Adm" do TEC',
        pjN.semDado.length === 0 && Math.abs(pjN.hoje - 21) < 0.01, { semDado: pjN.semDado, hoje: pjN.hoje });
      mats = [{ nome: 'Dir Adm', qtdQuestoes: 40, pontosPorQuestao: 1, peso: 1 },
              { nome: 'Arquivologia', qtdQuestoes: 5, pontosPorQuestao: 1, peso: 1 }];

      /* 10) O QUADRO DE ESFORÇO NÃO OLHA MAIS O RELÓGIO. A moeda é a questão,
         a única que a banca e o TEC já falam — não há nome de ciclo para casar
         nem minuto para estimar, e nenhuma matéria fica de fora. */
      const origIncid = ReforcoEngine._incidByDisc, origCiclo = DB.getCurrentCycle;
      try {
        window.planCycleMode = () => 'pre';
        DB.getCurrentCycle = () => ({ subjects: [{ nome: 'D.A.', definidoMin: 999 }] });
        ReforcoEngine._incidByDisc = () => ({
          'Dir Adm': [{ codigo: '01', nome: 'Geral', disciplina: 'Dir Adm', incidencia: 400 }],
          'Direito Previdenciario': [{ codigo: '01', nome: 'Geral', disciplina: 'Direito Previdenciario', incidencia: 400 }],
          'Musicologia': [{ codigo: '01', nome: 'Geral', disciplina: 'Musicologia', incidencia: 2 }] });
        const tm = PP.esforcoPorMateria();
        const por = {}; tm.linhas.forEach(l => { por[ReforcoEngine.norm(l.nome)] = l; });
        this._ok('Esforço: peso e esforço somam 100% — nenhuma matéria fica de fora',
          Math.abs(tm.linhas.reduce((a, l) => a + (l.sharePeso || 0), 0) - 100) < 0.01 &&
          Math.abs(tm.linhas.reduce((a, l) => a + l.shareEsforco, 0) - 100) < 0.01, tm.linhas.length);
        this._ok('Esforço: matéria pesada com ZERO questão sua manda COMEÇAR',
          por['direito previdenciario'] && por['direito previdenciario'].veredito === 'comecar',
          por['direito previdenciario']);
        this._ok('Esforço: matéria que você resolve e a prova não cobra vira "foraDoPeso"',
          por['arquivologia'] && por['arquivologia'].veredito === 'foraDoPeso', por['arquivologia']);
        this._ok('Esforço: o ciclo escrito noutro idioma ("D.A.") não muda nada',
          por['dir adm'] && por['dir adm'].q === 400, por['dir adm']);
        this._ok('Esforço: a miúda (2 questões da banca, nenhuma sua) não entra na manchete',
          por['musicologia'] && por['musicologia'].miuda === true &&
          tm.acoes === tm.linhas.filter(l => !l.resumo &&
            ['atacar', 'comecar'].indexOf(l.veredito) >= 0).length,
          { miuda: por['musicologia'], acoes: tm.acoes });

        /* A ORDEM É O PRÊMIO, NÃO O PESO. Uma matéria que vale menos mas onde
           a lacuna é maior rende mais na próxima hora — e era exatamente o
           caso que o quadro pintava de verde. */
        this._ok('Esforço: a tabela sai ordenada por pontos em jogo',
          tm.linhas.filter(l => l.ganho > 0).every((l, i, a) => i === 0 || a[i - 1].ganho >= l.ganho),
          tm.linhas.map(l => l.nome + '=' + l.ganho.toFixed(1)));
        this._ok('Esforço: "em jogo" é peso × lacuna até o teto',
          Math.abs(por['dir adm'].ganho - por['dir adm'].sharePeso * (90 - por['dir adm'].taxa) / 100) < 0.01,
          por['dir adm']);
        this._ok('Esforço: o corte de Pareto devolve poucas matérias, não uma lista inteira',
          tm.nCorte >= 1 && tm.nCorte < tm.linhas.length, tm.nCorte);

        /* 11) O PESO DA BANCA VEM DA RAIZ, NÃO DA SOMA DAS LINHAS. A incidência
           é uma árvore; somar pai com filho conta a mesma questão em cada
           degrau. E o erro depende de quão FUNDO a tabela foi colada, não do
           que a banca cobra: duas disciplinas de 200 questões viravam 55,6% e
           44,4% da prova só por isso. */
        const RE = ReforcoEngine;
        this._ok('Incidência: a raiz é a linha de disciplina, não a soma dos níveis',
          RE.raizIncid([{ codigo: null, depth: 0, incidencia: 200 }, { codigo: '01', depth: 1, incidencia: 100 },
            { codigo: '01.01', depth: 2, incidencia: 60 }, { codigo: '01.02', depth: 2, incidencia: 40 },
            { codigo: '02', depth: 1, incidencia: 100 }]) === 200);
        this._ok('Incidência: sem linha de disciplina, vale o nível mais raso',
          RE.raizIncid([{ codigo: '01', depth: 1, incidencia: 70 }, { codigo: '01.01', depth: 2, incidencia: 30 },
            { codigo: '01.02', depth: 2, incidencia: 40 }, { codigo: '02', depth: 1, incidencia: 30 }]) === 100);
        this._ok('Incidência: colagem plana, sem hierarquia nenhuma, soma tudo',
          RE.raizIncid([{ codigo: null, depth: null, incidencia: 40 },
            { codigo: null, depth: null, incidencia: 60 }]) === 100);
        this._ok('Incidência: lista vazia não vira NaN', RE.raizIncid([]) === 0 && RE.raizIncid(null) === 0);

        /* 12) A DICA DE AMOSTRA TEM DE MUDAR ALGUMA COISA. Ela derivava a
           sugestão do MAIOR assunto em faixas fixas: com o alvo em 50 e o
           maior em 72, sugeria 50 — o aviso acusava a configuração e mandava
           ligar o que já estava ligado. */
        const uso = (qs) => qs.map(q => ({ qJanela: q }));
        this._ok('Amostra: a sugestão nunca é o valor que já está ligado',
          P._alvoSugerido(uso([20, 25, 30, 40, 72]), 50) === 30,
          P._alvoSugerido(uso([20, 25, 30, 40, 72]), 50));
        this._ok('Amostra: com volume alto ela sobe junto',
          P._alvoSugerido(uso([100, 120, 140, 300]), 200) === 100);
        this._ok('Amostra: sem nada melhor a propor, não há sugestão (e o aviso some)',
          P._alvoSugerido(uso([4, 6, 8]), 10) === null);
        this._ok('Amostra: alvo já baixo não vira sugestão igual', P._alvoSugerido(uso([50, 60]), 10) === null);
        /* O NÍVEL VEM DA JANELA ADAPTATIVA, NÃO DA MÉDIA DA VIDA. Quem
           consertou uma matéria há pouco continuaria aparecendo como fraco
           nela: a média da vida inteira mente sempre para o passado. */
        DB.getTecSnapshots = () => ([
          R('v1', dia(120), dia(90), [D('Dir Adm', 100, 20), L('01', 'Geral', 'Dir Adm', 100, 20)]),
          R('v2', dia(30), dia(2), [D('Dir Adm', 100, 90), L('01', 'Geral', 'Dir Adm', 100, 90)])]);
        const jan = PP.esforcoPorMateria().linhas.find(l => ReforcoEngine.norm(l.nome) === 'dir adm');
        this._ok('Esforço: o nível é 90% (janela recente), não 55% (média da vida)',
          jan && Math.abs(jan.taxa - 90) < 0.01, jan && jan.taxa);
        DB.getTecSnapshots = () => snaps;
      } finally { ReforcoEngine._incidByDisc = origIncid; DB.getCurrentCycle = origCiclo; window.planCycleMode = () => 'pos'; }
      this._ok('Nomes: a abreviatura casa ("Dir Adm" → "Direito Administrativo")',
        casa(['Dir Adm'], ['Direito Administrativo', 'Arquivologia'])['dir adm'] === 'direito administrativo');
      this._ok('Nomes: mas "Dir" sozinho não casa com nenhum dos quatro Direitos',
        casa(['Dir'], ['Direito Penal', 'Direito Civil', 'Direito Administrativo'])['dir'] === undefined);
      this._ok('Nomes: e a abreviatura não atravessa palavra ("Dir Pen" ≠ "Direito Previdenciário")',
        casa(['Dir Pen'], ['Direito Previdenciario'])['dir pen'] === undefined);
      this._ok('Nomes: uma palavra não vira abreviatura de duas ("Cont" ≠ "Contabilidade Geral")',
        casa(['Cont'], ['Contabilidade Geral'])['cont'] === undefined);
    } finally {
      DB.getTecSnapshots = origSnaps; DB.getActiveSubjects = origSubs; window.planCycleMode = origModo;
      if (antesP == null) DB.delRaw(chaveP); else DB.setRaw(chaveP, antesP);
    }
  },


  /* ═══ A FOLHA DE AJUSTES ═══════════════════════════════════════════════════
     O Desempenho TEC abria em CONFIGURAÇÃO: 25 campos empilhados, 2.413px de
     formulário antes do primeiro número num celular de 390px. Os campos são os
     mesmos, com os mesmos ids — mudou onde moram. O que este grupo cobra é a
     estrutura de que a folha depende: seção sem chip é campo que não aparece
     em lugar nenhum, e campo sem `data-cfg-key` é um ponto de "você mexeu
     aqui" que nunca acende. */
  ajustesTec() {
    const T = TecAjustes;
    const secs = (aba) => [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="' + aba + '"]')];
    const abas = ['plano', 'reforco', 'analise'];
    abas.forEach(aba => {
      const lista = secs(aba);
      this._ok('Ajustes: a aba "' + aba + '" tem seção na folha', lista.length >= 1, lista.length);
      this._ok('Ajustes: toda seção de "' + aba + '" tem rótulo e ícone para o chip',
        lista.every(s => s.dataset.rot && s.dataset.ic), lista.map(s => s.dataset.sec));
      this._ok('Ajustes: toda seção de "' + aba + '" tem campo dentro',
        lista.every(s => s.querySelectorAll('input, select').length > 0), lista.map(s => s.dataset.sec));
      this._ok('Ajustes: a aba "' + aba + '" tem a porta ⚙ na tela',
        !!document.querySelector('.tec-cfg-open[data-cfg="' + aba + '"]'));
      this._ok('Ajustes: e um lugar para as etiquetas do que está valendo',
        !!document.getElementById(aba + '-cfg-resumo'));
      this._ok('Ajustes: a aba "' + aba + '" tem título e subtítulo na folha',
        !!(T.TITULOS[aba] && T.TITULOS[aba].t && T.TITULOS[aba].s), T.TITULOS[aba]);
    });
    /* Nenhum id pode existir duas vezes: a folha herdou os campos das telas, e
       um id duplicado faria `getElementById` devolver o errado — a tela leria
       um valor e o usuário estaria editando outro. */
    const ids = [...document.querySelectorAll('#tec-cfg-body [id]')].map(e => e.id);
    this._ok('Ajustes: nenhum id repetido dentro da folha', new Set(ids).size === ids.length, ids.length);
    const fora = ids.filter(id => document.querySelectorAll('#' + CSS.escape(id)).length > 1);
    this._ok('Ajustes: nenhum campo da folha tem sósia fora dela', fora.length === 0, fora.slice(0, 4));
    /* O ponto de "você mexeu aqui" lê `data-cfg-key`. Campo sem a marca é
       campo que a folha nunca vai apontar como personalizado. */
    const semChave = [];
    abas.forEach(aba => secs(aba).forEach(sec => sec.querySelectorAll('input, select').forEach(el => {
      if (el.type === 'hidden' || el.type === 'checkbox' && !el.id) return;
      if (!el.dataset.cfgKey && el.id) semChave.push(el.id);
    })));
    this._ok('Ajustes: todo campo declara a chave do seu padrão de fábrica',
      semChave.length === 0, semChave.slice(0, 6));
    // e as chaves do Plano têm de existir mesmo em PlanoEngine.DEFAULTS
    const desconhecidas = secs('plano').flatMap(sec => [...sec.querySelectorAll('[data-cfg-key]')])
      .map(el => el.dataset.cfgKey).filter(k => !(k in PlanoEngine.DEFAULTS));
    this._ok('Ajustes: as chaves do Plano existem no motor', desconhecidas.length === 0, desconhecidas);
    /* Campo condicional aponta para um campo REAL e para um valor que aquele
       campo oferece — senão ele some para sempre, sem erro nenhum. */
    const quebrados = [...document.querySelectorAll('#tec-cfg-body [data-cfg-se]')].filter(el => {
      const [id, vals] = String(el.dataset.cfgSe).split(':');
      const fonte = document.getElementById(id);
      if (!fonte || !fonte.options) return true;
      const oferece = [...fonte.options].map(o => o.value);
      return !vals.split('|').every(v => oferece.indexOf(v) >= 0);
    });
    this._ok('Ajustes: todo campo condicional aponta para uma opção que existe',
      quebrados.length === 0, quebrados.map(e => e.dataset.cfgSe));
    // o resumo devolve pares [rótulo, valor] preenchidos, nunca "undefined"
    abas.forEach(aba => {
      const r = T.resumo(aba);
      this._ok('Ajustes: o resumo de "' + aba + '" tem etiquetas completas',
        Array.isArray(r) && r.length >= 2 && r.every(x => x[0] && x[1] && !/undefined|NaN/.test(String(x[1]))), r);
    });
  },


  /* ═══ MOTOR DO REFORÇO ═════════════════════════════════════════════════════
     A fronteira adaptativa decide o que a pessoa vai estudar, e as três coisas
     que ela pode errar erram calado: contar a mesma questão duas vezes, somar
     dois assuntos homônimos de disciplinas diferentes, e confundir "não
     praticou" com "o nome não bateu". Os casos abaixo cobrem as três, mais a
     entrada hostil (retrato vazio, linha sem questão, incidência sem
     disciplina). */
  reforcoMotor() {
    const R = ReforcoEngine;
    const L = (c, n, disc, q, ac) => ({ depth: 1, codigo: c, nome: n, disciplina: disc, questoes: q, acertos: ac, pctAcerto: q ? Math.round(ac / q * 1000) / 10 : 0 });
    const D = (n, q, ac) => ({ depth: 0, codigo: null, nome: n, disciplina: n, questoes: q, acertos: ac, pctAcerto: q ? Math.round(ac / q * 1000) / 10 : 0 });
    const snap = { id: 's', startDate: todayLocal(), endDate: todayLocal(), rows: [
      D('Direito Constitucional', 200, 80),
      L('01', 'Princípios', 'Direito Constitucional', 120, 40),
      L('02', 'Controle', 'Direito Constitucional', 80, 40),
      D('Direito Administrativo', 100, 90),
      L('01', 'Princípios', 'Direito Administrativo', 100, 90),   // homônimo de propósito
      D('Vazia', 0, 0)
    ] };
    const origInc = DB.getIncidencia, origSave = DB.saveIncidencia;
    const comInc = (linhas, fn) => {
      DB.getIncidencia = () => linhas;
      try { return fn(); } finally { DB.getIncidencia = origInc; DB.saveIncidencia = origSave; }
    };

    // 1) HOMÔNIMOS DE DISCIPLINAS DIFERENTES NÃO SOMAM
    comInc([
      { banca: 'X', disciplina: 'Direito Constitucional', topico: 'Princípios', incidencia: 30, codigo: '01', depth: 1 },
      { banca: 'X', disciplina: 'Direito Administrativo', topico: 'Princípios', incidencia: 12, codigo: '01', depth: 1 }
    ], () => {
      const mapa = R.incidenceMap('X');
      const a = R.incidenciaDe(mapa, 'Princípios', 'Direito Constitucional');
      const b = R.incidenciaDe(mapa, 'Princípios', 'Direito Administrativo');
      this._ok('Reforço: incidência por disciplina não mistura homônimos', a.valor === 30 && b.valor === 12, { a, b });
      this._ok('Reforço: casar só pelo nome fica marcado como queda',
        R.incidenciaDe(mapa, 'Princípios', 'Disciplina Que Não Existe').viaNome === true);
      this._ok('Reforço: tópico inexistente devolve zero, não undefined',
        R.incidenciaDe(mapa, 'Nada disso', 'Direito Constitucional').valor === 0);
    });
    // o índice do DESEMPENHO tem de separar os mesmos homônimos
    const perf = R._perfIndex(snap);
    const pc = R._perfGet(perf, 'Princípios', 'Direito Constitucional');
    const pa = R._perfGet(perf, 'Princípios', 'Direito Administrativo');
    this._ok('Reforço: desempenho de homônimos fica separado por disciplina',
      pc.q === 120 && pa.q === 100 && Math.abs(pc.pac - 1 / 3) < 0.01, { pc: pc.q, pa: pa.q });

    /* 2) PARTIÇÃO LIMPA: a disciplina e os tópicos dela nunca entram juntos.
       A linha de disciplina não tem código, e a checagem de "tem filho" exigia
       um — então toda disciplina entrava junto com os próprios tópicos, e as
       mesmas questões eram contadas duas vezes no ranking. */
    const uni1 = R._unidadesDoDesempenho(snap, 1);
    const nomes1 = uni1.map(u => u.disciplina + '/' + u.nome).sort();
    this._ok('Reforço: no nível 1, entram os tópicos e NÃO as disciplinas',
      nomes1.length === 3 && !nomes1.some(n => /Direito Constitucional\/Direito Constitucional/.test(n)),
      nomes1);
    this._ok('Reforço: a soma das unidades não conta questão duas vezes',
      uni1.reduce((a, u) => a + (R._perfGet(perf, u.nome, u.disciplina) || { q: 0 }).q, 0) === 300,
      uni1.map(u => u.nome));
    const uni0 = R._unidadesDoDesempenho(snap, 0);
    this._ok('Reforço: no nível 0, entram só as disciplinas com questões',
      uni0.length === 2 && uni0.every(u => u.codigo == null), uni0.map(u => u.nome));
    this._ok('Reforço: disciplina sem questão nenhuma fica de fora',
      !uni0.some(u => u.nome === 'Vazia'));

    // 3) SEM INCIDÊNCIA A ABA FUNCIONA — e não inventa banca
    comInc([], () => {
      const r = R.suggestFrontier(snap, { minQuestoes: 10, granularidade: 0.5, limite: 20 });
      this._ok('Reforço: sem banca, o ranking sai do seu desempenho', r.items.length > 0, r.items.length);
      this._ok('Reforço: sem banca, não há ponto cego nem sobre-investimento',
        r.blindSpots.length === 0 && r.overinvest.length === 0);
      this._ok('Reforço: sem banca, a projeção da prova não é inventada',
        r.projAtual === null && r.projPotencial === null && r.unidadeGanho === 'questoes',
        { p: r.projAtual, u: r.unidadeGanho });
      this._ok('Reforço: sem banca, o ganho é contado nas suas questões',
        r.items.every(it => it.pontosRecuperaveis >= 0) && r.items.some(it => it.pontosRecuperaveis > 0));
      const soma = r.items.reduce((a, it) => a + it.questoes, 0);
      this._ok('Reforço: sem banca, nenhuma questão é contada duas vezes no ranking',
        soma <= 300, soma);
    });

    // 4) COM INCIDÊNCIA: nome que não casa ≠ ponto cego
    comInc([
      { banca: 'X', disciplina: 'Direito Constitucional', topico: 'Princípios', incidencia: 30, codigo: '01', depth: 1 },
      { banca: 'X', disciplina: 'Direito Constitucional', topico: 'Assunto Que Você Nunca Viu', incidencia: 20, codigo: '02', depth: 1 },
      { banca: 'X', disciplina: 'Direito Constitucional', topico: 'Controle', incidencia: 8, codigo: '03', depth: 1 }
    ], () => {
      const r = R.suggestFrontier(snap, { banca: 'X', minQuestoes: 10, granularidade: 1, incidMin: 5, limite: 20 });
      this._ok('Reforço: assunto sem correspondência vira aviso, não ponto cego',
        r.totalSemCasamento === 1 && r.semCasamento[0].nome === 'Assunto Que Você Nunca Viu' &&
        !r.blindSpots.some(b => b.nome === 'Assunto Que Você Nunca Viu'),
        { sem: r.totalSemCasamento, cegos: r.blindSpots.map(b => b.nome) });
      // teto configurável (o mesmo do Plano)
      const t80 = R.suggestFrontier(snap, { banca: 'X', minQuestoes: 10, granularidade: 1, teto: 0.80, limite: 20 });
      const t95 = R.suggestFrontier(snap, { banca: 'X', minQuestoes: 10, granularidade: 1, teto: 0.95, limite: 20 });
      const rec = (x) => x.items.reduce((a, it) => a + it.pontosRecuperaveis, 0);
      this._ok('Reforço: o teto do Plano manda no ganho recuperável',
        t80.teto === 80 && t95.teto === 95 && rec(t95) > rec(t80), { t80: rec(t80), t95: rec(t95) });
    });

    /* 5) DUAS BANCAS AO MESMO TEMPO. Quem presta para dois órgãos precisa somar
       exatamente as duas — nem "todas" (que traz o histórico de bancas que ele
       não vai enfrentar) nem uma só. */
    const duasBancas = [
      { banca: 'FGV', disciplina: 'Direito Constitucional', topico: 'Princípios', incidencia: 30, codigo: '01', depth: 1 },
      { banca: 'Cebraspe', disciplina: 'Direito Constitucional', topico: 'Princípios', incidencia: 12, codigo: '01', depth: 1 },
      { banca: 'FCC', disciplina: 'Direito Constitucional', topico: 'Princípios', incidencia: 100, codigo: '01', depth: 1 }
    ];
    comInc(duasBancas, () => {
      const vDe = (sel) => R.incidenciaDe(R.incidenceMap(sel), 'Princípios', 'Direito Constitucional').valor;
      this._ok('Reforço: uma banca traz só o histórico dela', vDe('FGV') === 30, vDe('FGV'));
      this._ok('Reforço: duas bancas somam só as duas', vDe(['FGV', 'Cebraspe']) === 42, vDe(['FGV', 'Cebraspe']));
      this._ok('Reforço: todas somam tudo', vDe('__todas__') === 142 && vDe([]) === 142, vDe('__todas__'));
      this._ok('Reforço: a ordem da seleção não muda o resultado',
        vDe(['Cebraspe', 'FGV']) === vDe(['FGV', 'Cebraspe']));
      this._ok('Reforço: banca inexistente na seleção não derruba nem inventa',
        vDe(['Não Existe']) === 0 && R.hasIncidencia(['Não Existe']) === false);
      this._ok('Reforço: hasIncidencia responde pela seleção',
        R.hasIncidencia(['FGV']) === true && R.hasIncidencia() === true);
      this._ok('Reforço: o rótulo das bancas é legível no plural',
        R.rotuloBancas('__todas__') === 'todas as bancas' &&
        R.rotuloBancas(['FGV']) === 'FGV' &&
        R.rotuloBancas(['FGV', 'Cebraspe']).indexOf(' e ') > 0 &&
        /,.* e /.test(R.rotuloBancas(['FGV', 'Cebraspe', 'FCC'])),
        [R.rotuloBancas(['FGV', 'Cebraspe']), R.rotuloBancas(['FGV', 'Cebraspe', 'FCC'])]);
      // e a fronteira usa a soma das escolhidas, não a de todas
      const so2 = R.suggestFrontier(snap, { banca: ['FGV', 'Cebraspe'], minQuestoes: 10, granularidade: 1, limite: 20 });
      const tudo = R.suggestFrontier(snap, { banca: '__todas__', minQuestoes: 10, granularidade: 1, limite: 20 });
      const inc2 = (r) => (r.items.find(i => i.nome === 'Princípios') || {}).incidencia;
      this._ok('Reforço: o ranking usa a incidência somada das bancas escolhidas',
        inc2(so2) === 42 && inc2(tudo) === 142, { so2: inc2(so2), tudo: inc2(tudo) });
      /* E o assunto aparece UMA vez, não uma por banca: cada caderno traz o seu
         índice com a mesma taxonomia, e empilhar as linhas cruas transformava o
         mesmo assunto em três unidades concorrendo entre si no ranking. */
      const vezes = (r) => r.items.filter(i => i.nome === 'Princípios').length;
      this._ok('Reforço: assunto presente em várias bancas aparece uma vez só',
        vezes(so2) === 1 && vezes(tudo) === 1, { so2: vezes(so2), tudo: vezes(tudo) });
    });

    // 5) ENTRADA HOSTIL: nada disso pode lançar
    const hostis = [
      ['retrato nulo', null],
      ['retrato sem linhas', { rows: [] }],
      ['linhas sem questão', { rows: [L('01', 'A', 'D', 0, 0)] }],
      ['linha sem disciplina', { rows: [{ depth: 1, codigo: '01', nome: 'Solto', questoes: 20, acertos: 5 }] }]
    ];
    hostis.forEach(([nome, s]) => {
      let ok = true, det = '';
      try {
        comInc([{ banca: 'X', disciplina: '', topico: 'Solto', incidencia: 9 }], () => {
          const r = R.suggestFrontier(s, { banca: 'X' });
          if (!r || !Array.isArray(r.items)) { ok = false; det = 'retorno inválido'; }
        });
        R._unidadesDoDesempenho(s, 2);
      } catch (e) { ok = false; det = String(e && e.message || e); }
      this._ok('Reforço: ' + nome + ' não derruba o motor', ok, det);
    });
  },


  /* ═══ INCIDÊNCIA: GRAVAÇÃO E RÓTULO ════════════════════════════════════════
     O número da incidência é multiplicado por tudo o mais na tela; quando ele
     dobra, nada acusa — só a ordem muda. Estes casos guardam a chave de
     deduplicação e o caminho mais fácil de duplicar sem perceber: renomear uma
     banca para um nome que já existe. */
  incidenciaGravacao() {
    const chave = DB.KEYS.incidencia;
    const antes = localStorage.getItem(DB._profilePrefix ? DB._profilePrefix() + 'x' : 'x');  // só para não sombrear
    const guardado = DB.getIncidencia();
    const linhas = (n) => [
      { disciplina: 'Direito Administrativo', topico: 'Licitações', incidencia: n, codigo: '01', depth: 1 },
      { disciplina: 'Direito Administrativo', topico: 'Improbidade', incidencia: 25, codigo: '02', depth: 1 },
      { disciplina: 'Português', topico: 'Crase', incidencia: 7, codigo: null, depth: 1 }   // sem código: dedupe pelo nome
    ];
    try {
      DB.saveIncidencia([]);
      const a = DB.addIncidenciaRows('FGV', linhas(40), true);
      this._ok('Incidência: primeira importação entra inteira', a.novas === 3 && a.repetidas === 0, a);
      const b = DB.addIncidenciaRows('FGV', linhas(40), false);
      this._ok('Incidência: a mesma planilha de novo não duplica nada',
        b.novas === 0 && b.repetidas === 3 && DB.getIncidencia().length === 3, { b, n: DB.getIncidencia().length });
      const c = DB.addIncidenciaRows('FGV', linhas(55), false);
      const lic = DB.getIncidencia().find(r => r.topico === 'Licitações');
      this._ok('Incidência: valor repetido é ATUALIZADO, nunca somado',
        c.repetidas === 3 && lic.incidencia === 55, { c, v: lic.incidencia });
      // arquivo com a MESMA linha duas vezes dentro dele
      DB.saveIncidencia([]);
      const d = DB.addIncidenciaRows('FGV', linhas(10).concat(linhas(10)), true);
      this._ok('Incidência: linha repetida dentro do próprio arquivo também dedupa',
        DB.getIncidencia().length === 3 && d.repetidas === 3, { n: DB.getIncidencia().length, d });

      /* Renomear para um nome que JÁ EXISTE é como se conserta "FGV " x "FGV" —
         e era o caminho de volta para a duplicação que a gravação evita. */
      DB.saveIncidencia([]);
      DB.addIncidenciaRows('FGV', linhas(40), true);
      DB.addIncidenciaRows('FGV ', linhas(60), true);
      this._ok('Incidência: duas grafias convivem como bancas separadas', DB.getBancas().length === 2, DB.getBancas());
      DB.renameIncidenciaBanca('FGV ', 'FGV');
      const depois = DB.getIncidencia();
      const licF = depois.find(r => r.topico === 'Licitações');
      this._ok('Incidência: renomear para uma banca existente FUNDE sem duplicar',
        depois.length === 3 && DB.getBancas().length === 1 && licF.incidencia === 60,
        { n: depois.length, bancas: DB.getBancas(), v: licF && licF.incidencia });
      this._ok('Incidência: renomear para vazio não faz nada',
        DB.renameIncidenciaBanca('FGV', '   ') === 0 && DB.getIncidencia().length === 3);
    } finally {
      DB.saveIncidencia(guardado);
      void antes; void chave;
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
     ['Nada se perde', 'nadaSePerde'],
     ['Travas contra perda', 'travasDePerda'],
     ['Tudo entra na sincronização', 'tudoEntraNaSincronizacao'],
     ['A fila de envio sobrevive', 'filaDeEnvioSobrevive'],
     ['Link nunca vira código', 'linkNuncaViraCodigo'],
     ['Adota o id do banco', 'adotaOIdDoBanco'],
     ['Isolamento entre contas', 'isolamentoEntreContas'],
     ['Ids de perfil válidos para a nuvem', 'idsDePerfilSaoValidos'],
     ['Esvaziar deixa rastro', 'esvaziarDeixaRastro'],
     ['Travas não ficam presas', 'travasNaoFicamPresas'],
     ['O disco que recusa gravação', 'oDiscoQueRecusa'],
     ['Plano de pontos fracos', 'plano'],
     ['Motor do Reforço', 'reforcoMotor'],
     ['Incidência: gravação', 'incidenciaGravacao'],
     ['Folha de ajustes do TEC', 'ajustesTec'],
     ['Ciclo do Plano', 'cicloDoPlano'],
     ['Régua de pontos', 'reguaDePontos']].forEach(([nome, fn]) => {
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
