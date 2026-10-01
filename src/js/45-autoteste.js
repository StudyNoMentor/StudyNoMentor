/* Autotestes das regras próprias do Study. O motor Anki é validado pelo
   smoke que executa o pacote oficial, sem vetores de reimplementação local. */
const AutoTeste = {
  _r: null,
  _ok(nome, cond, obtido) {
    this._r.total++;
    if (cond) { this._r.passou++; }
    else { this._r.falhou++; this._r.falhas.push({ nome, obtido }); }
  },
  _perto(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol) * Math.max(1, Math.abs(b)); },

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
    /* O ID persistente não é mais validado/gerado pelo ProfileManager.
       CloudStore.createRow() omite `id` no INSERT e recebe do PostgreSQL o UUID
       definitivo. O helper local existe só para a projeção em RAM. */
    const criar = String(CloudStore.createRow);
    this._ok('perfil persistente deixa o PostgreSQL gerar o UUID',
      /\.insert\s*\(\s*\{/.test(criar) &&
      !/\n\s*id\s*:/.test(criar) &&
      /\.select\(['"]id,created_at['"]\)/.test(criar));
    const criado = ProfileManager.createProfile({ nome: '__t_projection__' });
    try {
      this._ok('createProfile cria apenas a projeção local necessária às telas',
        !!criado && ProfileManager.getProfiles().some(p => p.id === criado), criado);
    } finally {
      ProfileManager.saveProfiles(ProfileManager.getProfiles().filter(p => p.id !== criado));
    }
  },

  /* ── TUDO O QUE VOCÊ DIGITA ENTRA NA PERSISTÊNCIA RELACIONAL ─────────────
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
      typeof window.SectionSync === 'undefined' &&
      typeof window.__idbFalhouAoGravar === 'undefined' &&
      typeof window._cloudNotifyHook === 'undefined');
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

  /* ── SANDBOX: TESTE NUNCA ENCOSTA NO DADO DE VERDADE ───────────────────────
     O AutoTeste roda no app de produção (o próprio CONTRIBUINDO manda rodar no
     console). O teste de incidência apagava e regravava a incidência do
     planejamento ATIVO — e cada gravação ia para o banco por substituição: se o
     bloco pesado não estivesse carregado, o "restaurar" final gravava vazio.
     Agora o teste roda num planejamento fictício, com a persistência desligada,
     e tudo que ele criou é removido da RAM no fim. */
  _sandboxPlano(fn) {
    const PLANO = '__autoteste__';
    const RS = (typeof RelationalStore !== 'undefined') ? RelationalStore : null;
    const antes = { plano: DB._activePlanId, pronto: DB.heavyPronto, applying: RS ? RS._applying : false };
    DB._activePlanId = () => PLANO;
    DB.heavyPronto = () => true;
    if (RS) RS._applying = true;
    try { return fn(); }
    finally {
      DB._activePlanId = antes.plano;
      DB.heavyPronto = antes.pronto;
      try {
        const lixo = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf(PLANO) >= 0) lixo.push(k);
        }
        lixo.forEach(k => localStorage.removeItem(k));
      } catch (e) { _quiet(e, 'autoteste-sandbox'); }
      if (RS) RS._applying = antes.applying;
    }
  },
  incidenciaGravacao() {
    return this._sandboxPlano(() => this._incidenciaGravacao());
  },
  _incidenciaGravacao() {
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
    }
  },

  rodar(imprimir) {
    this._r = { total: 0, passou: 0, falhou: 0, falhas: [], ms: 0 };
    const t0 = Date.now();
    [['Parser TEC', 'tec'], ['Robustez', 'robustez'],
     ['Colagem em lote', 'lote'], ['Eixo dos gráficos', 'eixo'],
     ['Aproveitamento', 'aproveitamento'],
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
