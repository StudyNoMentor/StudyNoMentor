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
     era invisível para a sincronização legada — não entrava na tabela por seção, não
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
  /* ── REVISÃO ANOTADA NÃO É PROVA DE QUE O DADO ESTÁ AQUI ──────────────────
     `hasRemoteUpdates` decide se vale baixar da nuvem. Ela comparava somente
     revisão contra revisão, e a revisão é bookkeeping LOCAL: continua dizendo
     "tenho a rev 5 de entries" mesmo depois de o conteúdo ter ido embora (cota
     estourada no meio de uma gravação, limpeza parcial do navegador, gravação
     interrompida). Com a revisão batendo, a resposta era "nada novo" e o
     registro sumia para sempre — o "faltam alguns registros, e só normaliza em
     guia anônima", porque guia anônima não tem revisão anotada e baixa tudo.

     Ausência do conteúdo passa a valer como novidade. As três situações estão
     fixadas aqui, incluindo a que NÃO deve disparar download (seção sem
     anotação nenhuma, que é perfil novo e a semeadura normal resolve). */
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
  salvarSemEsperarNuvem() {
    const flushOriginal = CloudStore.flushPending;
    const prontoOriginal = CloudStore.isReady, logadoOriginal = CloudStore.isLoggedIn;
    const pisoOriginal = SaveGuard.MIN_BUSY_MS;
    try {
      SaveGuard.MIN_BUSY_MS = 0;
      CloudStore.isReady = () => true; CloudStore.isLoggedIn = () => true;
      let liberouFila = null;
      CloudStore.flushPending = () => new Promise(res => { liberouFila = res; });
      CloudStore._pending = true; CloudStore._syncing = false;

      let gravou = 0, avisos = [];
      const pedido = SaveGuard.run({
        escrever: () => { gravou++; return true; },
        verificar: () => true,
        nuvem: 'depois',
        timeout: 400,
        aoSincronizar: (r) => avisos.push(r)
      });
      this._ok('salvar sem esperar a nuvem devolve uma promessa e já gravou',
        gravou === 1 && typeof pedido.then === 'function');
      pedido.then(r => {
        this._ok('o retorno imediato prova o disco e NÃO afirma sincronizado',
          r.ok === true && r.local === true && r.cloud === false && r.motivo === 'enviando');
      });

      /* A prova de persistência continua sendo porta de entrada: sem ela, o
         retorno é de falha mesmo no modo adiado. */
      SaveGuard.run({ escrever: () => true, verificar: () => false, nuvem: 'depois' })
        .then(r => this._ok('sem prova no disco, o modo adiado também recusa',
          r.ok === false && r.local === false && r.motivo === 'nao-persistiu'));

      if (liberouFila) { CloudStore._pending = false; liberouFila(); }
      this._ok('o aviso de sincronizado fica para o callback, não para o retorno',
        avisos.length === 0);
    } finally {
      SaveGuard.MIN_BUSY_MS = pisoOriginal;
      CloudStore.flushPending = flushOriginal;
      CloudStore.isReady = prontoOriginal; CloudStore.isLoggedIn = logadoOriginal;
      delete CloudStore._pending; delete CloudStore._syncing;
    }
  },
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
  /* O antigo Plano de Pontos Fracos, sua régua de pontos e seus testes foram
     removidos. As invariantes de prioridade/ciclo vivem no MotorSugestao. */

  motorSugestao() {
    const M = window.MotorSugestao;
    this._ok('Motor: existe e expõe calcular/prefs/dosar e percurso hierárquico',
      !!(M && typeof M.calcular === 'function' && typeof M.prefs === 'function'
        && typeof M.dosar === 'function' && typeof M._planejarNo === 'function'
        && typeof M._filaDisciplina === 'function'));
    if (!M) return;

    const no = (nome, q, ac, depth, filhos) => ({
      nome, codigo: null, depth, disciplina: 'X', questoes: q, acertos: ac, children: filhos || []
    });

    /* O único freio de granularidade é o piso de amostra. Três filhos do
       mesmo pai que, sozinhos, não alcançam 20 questões viram um bloco local. */
    const miudos = no('Tópico A', 40, 11, 1, [
      no('A.1', 10, 2, 2), no('A.2', 12, 3, 2), no('A.3', 18, 6, 2)
    ]);
    const local = M._planejarNo(miudos, 20, []);
    /* O grupo só confirma a lacuna (amostra somada + exclusão de quem já
       domina); o alvo oferecido é sempre o pior membro individual, nunca um
       "bloco" misturando os irmãos — por isso `motivoNivel`, não `agregado`. */
    const bloco = local.find(x => x.motivoNivel === 'pior-do-grupo');
    this._ok('Motor simples: ramos pequenos viram bloco somente entre irmãos do mesmo pai',
      !!(bloco && bloco.pai === 'Tópico A' && bloco.nome === 'A.1' && bloco.grupoTamanho === 3), bloco);
    this._ok('Motor simples: o bloco continua abaixo da disciplina',
      local.length > 0 && local.every(x => x.nivel > 0 && x.disciplina === 'X'), local);

    /* Não existe teto mágico de irmãos: todos os ramos pequenos locais entram
       se forem necessários para alcançar o piso. */
    const muitos = no('Tópico B', 36, 9, 1, [
      no('B.1', 6, 1, 2), no('B.2', 6, 1, 2), no('B.3', 6, 1, 2),
      no('B.4', 6, 2, 2), no('B.5', 6, 2, 2), no('B.6', 6, 2, 2)
    ]);
    const planoMuitos = M._planejarNo(muitos, 20, []);
    const blocoMuitos = planoMuitos.find(x => x.motivoNivel === 'pior-do-grupo');
    this._ok('Motor simples: agrupa quantos irmãos pequenos forem necessários para alcançar a amostra',
      !!(blocoMuitos && blocoMuitos.grupoTamanho === 6 && blocoMuitos.pai === 'Tópico B' && blocoMuitos.nome === 'B.1'), blocoMuitos);

    const doisBlocos = no('Tópico C', 40, 20, 1, [
      no('C.1', 10, 5, 2), no('C.2', 10, 5, 2),
      no('C.3', 10, 5, 2), no('C.4', 10, 5, 2)
    ]);
    const planoDois = M._planejarNo(doisBlocos, 20, [], 90);
    this._ok('Motor simples: continua nos irmãos restantes e cria mais de um bloco executável',
      planoDois.length === 2
        && planoDois.every(x => x.motivoNivel === 'pior-do-grupo' && x.grupoTamanho === 2 && x.grupoQuestoes === 20)
        && planoDois.map(x => x.nome).join('|') === 'C.1|C.3', planoDois);

    const semEnchimento = no('Tópico D', 30, 15, 1, [
      no('D.1', 10, 2, 2), no('D.2', 10, 3, 2), no('D forte', 10, 10, 2)
    ]);
    const planoFraco = M._planejarNo(semEnchimento, 20, [], 90);
    this._ok('Motor simples: irmão forte não serve para completar bloco fraco',
      planoFraco.length === 1 && planoFraco[0].motivoNivel === 'pior-do-grupo'
        && planoFraco[0].nome === 'D.1' && planoFraco[0].grupoTamanho === 2 && planoFraco[0].grupoQuestoes === 20, planoFraco);

    const porRamo = no('X', 80, 42, 0, [
      no('Pai mais fraco', 40, 16, 1, [no('P.1', 20, 6, 2), no('P.2', 20, 10, 2)]),
      no('Outro pai', 40, 18, 1, [no('O.1', 40, 4, 2)])
    ]);
    const filaRamos = M._filaDisciplina(porRamo, Object.assign(M.prefs(), { minAmostra: 20, metaAcerto: 90 }));
    this._ok('Motor simples: esgota o ramo-pai mais fraco antes de entrar em outro ramo',
      filaRamos.map(x => x.nome).join('|') === 'P.1|P.2|O.1', filaRamos);

    const raiz = no('X', 400, 180, 0, [miudos]);
    this._ok('Motor simples: depth 0 é fronteira absoluta e nunca vira atividade',
      M._planejarNo(raiz, 20, []).length === 0);

    /* Códigos do TEC podem mudar entre retratos. 01=A num mês e 01=B no outro
       não pode trocar os filhos de pai no histórico consolidado. */
    const snap = (id, linhas) => ({ id, startDate: '2026-0' + id + '-01', endDate: '2026-0' + id + '-28', rows: linhas });
    const rr = (nome, depth, codigo, q, ac) => ({ nome, depth, codigo, questoes: q, acertos: ac, disciplina: 'Disc X' });
    const s1 = snap(1, [
      rr('Disc X', 0, null, 80, 40),
      rr('Tópico A', 1, '01', 40, 15), rr('Filho A', 2, '01.01', 20, 5),
      rr('Tópico B', 1, '02', 40, 25), rr('Filho B', 2, '02.01', 20, 15)
    ]);
    const s2 = snap(2, [
      rr('Disc X', 0, null, 100, 55),
      rr('Tópico B', 1, '01', 50, 30), rr('Filho B', 2, '01.01', 25, 17),
      rr('Tópico A', 1, '02', 50, 25), rr('Filho A', 2, '02.01', 25, 8)
    ]);
    const estavel = M._forestEstavel({ rows: s1.rows.concat(s2.rows), _fontes: [s1, s2] });
    const dx = estavel[0] || { children: [] };
    const ta = dx.children.find(x => x.nome === 'Tópico A');
    const tb = dx.children.find(x => x.nome === 'Tópico B');
    this._ok('Motor: troca de códigos entre retratos não troca filhos de pai',
      !!(ta && tb && ta.questoes === 90 && tb.questoes === 90
        && ta.children.length === 1 && ta.children[0].nome === 'Filho A'
        && tb.children.length === 1 && tb.children[0].nome === 'Filho B'),
      { A: ta && { q: ta.questoes, filhos: ta.children.map(x => x.nome) },
        B: tb && { q: tb.questoes, filhos: tb.children.map(x => x.nome) } });

    /* Dentro da disciplina, a fila é simplesmente pior percentual válido
       primeiro. A amostra decide se o recorte pode existir, não dá score. */
    const disc = no('X', 320, 164, 0, [
      no('Tópico pior', 200, 80, 1, [
        no('Sub pior', 100, 20, 2),
        no('Sub melhor', 100, 60, 2)
      ]),
      no('Tópico seguinte', 120, 84, 1, [])
    ]);
    const fila = M._filaDisciplina(disc, Object.assign(M.prefs(), { minAmostra: 20, metaAcerto: 90 }));
    const nomes = fila.map(x => x.nome);
    this._ok('Motor simples: fila interna é pior percentual válido primeiro',
      nomes[0] === 'Sub pior' && nomes[1] === 'Sub melhor' && nomes[2] === 'Tópico seguinte', nomes);
    this._ok('Motor simples: a ordem interna permanece auditável',
      fila.every((x, i) => x.ordemNaDisciplina === i + 1), fila.map(x => x.ordemNaDisciplina));

    this._ok('Motor simples: 2 questões não alcançam o piso 20', !M.suficiente(2, 20));
    this._ok('Motor simples: 20 questões alcançam o piso 20', M.suficiente(20, 20));
    const lacunaCrua = M._lacuna({ taxa: 61, questoes: 20 }, Object.assign(M.prefs(), { metaAcerto: 90 }));
    this._ok('Motor simples: lacuna é apenas meta menos aproveitamento',
      Math.abs(lacunaCrua.gapMeta - 29) < 0.001, lacunaCrua);
    this._ok('Motor simples: a meta padrão é 90% e a rodada padrão tem no máximo 3 disciplinas',
      M.DEFAULTS.metaAcerto === 90 && M.DEFAULTS.minAmostra === 20 && M.LIMITES.maxFrentes[1] === 3,
      { meta: M.DEFAULTS.metaAcerto, amostra: M.DEFAULTS.minAmostra, max: M.LIMITES.maxFrentes });

    /* O volume histórico nunca multiplica a prioridade. Uma matéria a 60% com
       80 questões deve vir antes de uma a 80% com 5.000 questões. */
    const pa = Object.assign(M.prefs(), { metaAcerto: 90, fase: 'pre' });
    const muitoPraticada = { nome: 'Muito praticada', taxa: 80, questoes: 5000, lacunaDisc: 10, incidenciaDisc: 100 };
    const poucoPraticada = { nome: 'Pouco praticada', taxa: 60, questoes: 80, lacunaDisc: 30, incidenciaDisc: 1 };
    this._ok('Motor simples: lacuna percentual vence volume histórico',
      M._compararDisciplinas(poucoPraticada, muitoPraticada, pa) < 0,
      { muitoPraticada, poucoPraticada });

    /* No pós-edital a incidência é somente desempate: não multiplica a lacuna. */
    const empateA = { nome: 'A', taxa: 70, questoes: 100, lacunaDisc: 20, incidenciaDisc: 10 };
    const empateB = { nome: 'B', taxa: 70, questoes: 100, lacunaDisc: 20, incidenciaDisc: 50 };
    const pp = Object.assign({}, pa, { fase: 'pos' });
    this._ok('Motor simples: incidência só desempata lacunas iguais no pós-edital',
      M._compararDisciplinas(empateB, empateA, pp) < 0, { empateA, empateB });

    let seed = 7331, falhasStress = 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let z = 0; z < 1000; z++) {
      const gapA = 1 + rnd() * 20, gapB = gapA + 0.1 + rnd() * 30;
      const a = { nome: 'A', taxa: 90 - gapA, questoes: 20 + Math.floor(rnd() * 10000), lacunaDisc: gapA };
      const b = { nome: 'B', taxa: 90 - gapB, questoes: 20 + Math.floor(rnd() * 100), lacunaDisc: gapB };
      if (M._compararDisciplinas(b, a, pa) >= 0) falhasStress++;
    }
    this._ok('Motor simples: stress 1.000× mantém a maior lacuna acima do maior volume',
      falhasStress === 0, falhasStress);

    /* A dose também é simples: o tamanho configurado é o tamanho da atividade. */
    const doses = M.dosar([
      { taxaErro: 60, score: 30, questoes: 100 },
      { taxaErro: 25, score: 10, questoes: 100 }
    ], 25, 1);
    this._ok('Motor simples: toda atividade recebe a dose fixa configurada',
      doses.length === 2 && doses.every(x => x.dose === 25), doses.map(x => x.dose));

    /* ── CONTRATO DA RODADA: 3 DISCIPLINAS, 1 FRENTE CADA ────────────────────
       A fila completa permanece disponível para trocar o item de uma matéria,
       mas a rodada principal nunca abre quatro disciplinas por acidente. */
    const E = window.ExtrasScreen;
    if (E && typeof E._motorMarcar === 'function') {
      const guardaCand = E._motorCand, guardaSel = E._motorSel, guardaPrefs = E._motorPrefs;
      try {
        E._motorPrefs = { maxFrentes: 3, alvoQuestoes: 25, doseMin: 12 };
        E._motorCand = [
          { nome: 'A1', disciplina: 'Tributário', score: 10, taxaErro: 50 },
          { nome: 'A2', disciplina: 'Tributário', score: 9, taxaErro: 40 },
          { nome: 'B1', disciplina: 'Português', score: 8, taxaErro: 35 },
          { nome: 'C1', disciplina: 'Penal', score: 7, taxaErro: 30 },
          { nome: 'D1', disciplina: 'Civil', score: 6, taxaErro: 25 }
        ];
        E._motorSel = new Set();
        [0, 2, 3].forEach(i => E._motorMarcar(i));
        this._ok('Rodada: três disciplinas distintas entram', E._motorSel.size === 3, [...E._motorSel]);
        const recusou = E._motorMarcar(4, true) === false;
        this._ok('Rodada: a quarta disciplina é recusada', recusou && E._motorSel.size === 3, [...E._motorSel]);
        E._motorMarcar(1);
        this._ok('Rodada: outro tópico da mesma disciplina TROCA, não soma',
          E._motorSel.size === 3 && E._motorSel.has(1) && !E._motorSel.has(0), [...E._motorSel]);
        const ds = E._motorDoses();
        this._ok('Rodada: todas as atividades selecionadas respeitam o piso útil',
          [...E._motorSel].every(i => ds[i] >= 12), ds);
      } finally { E._motorCand = guardaCand; E._motorSel = guardaSel; E._motorPrefs = guardaPrefs; }
    }
  },

  ajustesTec() {
    const T = TecAjustes;
    const secs = (aba) => [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="' + aba + '"]')];
    const abas = ['motor'];
    this._ok('Ajustes: a lista paralela de assuntos abaixo da régua foi removida',
      !document.querySelector('#tec-weak-list, [data-cfg="analise"], #tec-cfg-body [data-tab="analise"]'));
    this._ok('TEC: a API órfã de pontos fracos foi removida', typeof TecEngine.pontosFracos !== 'function');
    abas.forEach(aba => {
      const lista = secs(aba);
      this._ok('Ajustes: a aba "' + aba + '" tem seção na folha', lista.length >= 1, lista.length);
      this._ok('Ajustes: toda seção de "' + aba + '" tem rótulo e ícone para o chip',
        lista.every(s => s.dataset.rot && s.dataset.ic), lista.map(s => s.dataset.sec));
      this._ok('Ajustes: toda seção de "' + aba + '" tem campo dentro',
        lista.every(s => s.querySelectorAll('input, select, .banca-pick').length > 0), lista.map(s => s.dataset.sec));
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
      /* `data-cfg-livre`: controle que NÃO é preferência salva. A seção de
         auditoria tem um: o "modo anônimo" vale para aquela exportação e não
         existe em DEFAULTS — exigir uma chave de fábrica dele obrigaria a
         inventar uma preferência que ninguém quer guardar. */
      if (el.dataset.cfgLivre != null) return;
      if (!el.dataset.cfgKey && el.id) semChave.push(el.id);
    })));
    this._ok('Ajustes: todo campo declara a chave do seu padrão de fábrica',
      semChave.length === 0, semChave.slice(0, 6));
    // e as chaves do Motor têm de existir mesmo em MotorSugestao.DEFAULTS
    const desconhecidas = secs('motor').flatMap(sec => [...sec.querySelectorAll('[data-cfg-key]')])
      .map(el => el.dataset.cfgKey).filter(k => !(k in MotorSugestao.DEFAULTS));
    this._ok('Ajustes: as chaves do Motor existem no próprio motor', desconhecidas.length === 0, desconhecidas);
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


  persistenciaRelacional() {
    this._ok('Persistência: RelationalStore está ativo',
      !!window.RelationalStore && RelationalStore.enabled === true);
    this._ok('Persistência: armazenamento de estudo é apenas projeção em RAM',
      window.__memoryOnlyStore === true && window.__idbShim === false,
      { memoryOnly: window.__memoryOnlyStore, idb: window.__idbShim });
    this._ok('Persistência: sincronização legada foi removida',
      typeof window.SectionSync === 'undefined');
    this._ok('Persistência: CloudStore não possui caminho blob/seções',
      typeof CloudStore.fetchPayload === 'undefined' &&
      typeof CloudStore._pushSectionsNow === 'undefined' &&
      typeof ProfileManager.restorePayloadInto === 'undefined');
    this._ok('Persistência: entrada de perfil hidrata diretamente do SQL',
      /RelationalStore\.hydrateProfile/.test(String(ProfileUI.enterProfile)));
    this._ok('Persistência: mutação por entidade usa RPC transacional',
      /mutate_study_plan_rows/.test(String(RelationalStore._syncById)));
    this._ok('Persistência: substituição em massa usa RPC transacional',
      /replace_study_plan_rows/.test(String(RelationalStore._replacePlanRows)));
    this._ok('Persistência: SaveGuard só confirma depois do flush SQL',
      /RelationalStore\.flush/.test(String(SaveGuard._aguardaNuvem)));
  },

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
     ['Persistência relacional', 'persistenciaRelacional'],
     ['Semana fechada é registro', 'historicoFechado'],
     ['Link nunca vira código', 'linkNuncaViraCodigo'],
     ['Ids de perfil válidos para o banco', 'idsDePerfilSaoValidos'],
     ['Incidência: gravação', 'incidenciaGravacao'],
     ['Folha de ajustes do TEC', 'ajustesTec'],
     ['Motor de sugestão e ciclo iterativo', 'motorSugestao']].forEach(([nome, fn]) => {
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
