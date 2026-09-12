/* ============================================================
   TELA: DESEMPENHO TEC (importação e análise TecConcursos)
   ============================================================ */
// ============================================================================
// PLANO DE APROVAÇÃO — visão alternativa ao Reforço (o Reforço segue intacto).
// Responde "quanto falta e por onde começar", não só "onde você é fraca".
// Três diferenças de essência em relação ao Reforço:
//   1) TAXA RECENTE: usa o retrato mais novo, não a média da vida inteira. Um
//      assunto que você já dominou para de aparecer no topo.
//   2) ESCALA DA PROVA: converte incidência em questões da SUA prova, e compara
//      com uma nota-alvo. Existe um "pronto".
//   3) GANHO POR HORA: usa o seu ritmo real (min/questão por disciplina, tirado
//      dos seus registros) — com tempo escasso é isso que decide a ordem.
// ============================================================================
const PlanoEngine = {
  KEY_PREF: 'plano-prefs',
  // 100% PONTOS FRACOS — não usa incidência de banca. O universo é o que VOCÊ
  // pratica, medido pelo TEC. Tudo aqui é ajustável pelo usuário.
  //   ponderacao  'igual'  = todo assunto pesa o mesmo (não deixa nada se esconder)
  //               'volume' = pesa pelo quanto você já praticou (reflete sua prioridade)
  //   custoModo   'fixo'   = N questões por assunto
  //               'proporcional' = fator × questões já praticadas
  DEFAULTS: {
    // 85% é a régua padrão: numa prova disputada, 80% deixa de ser confortável.
    metaDominio: 85, tetoDominio: 90,
    ponderacao: 'igual', minAmostra: 20, incluirPequenas: false,
    /* CUSTO POR LACUNA é o padrão. Custo fixo dizia que levar um assunto de 20%
       a 90% custa o mesmo que levar outro de 85% a 90% — e, pior, fazia a ordem
       "melhor retorno" virar cópia exata de "pior acerto primeiro" (com peso
       igual, ganho e custo eram ambos função só da taxa, e a divisão entre eles
       preservava a ordem). Aqui o custo tem duas partes que se explicam em uma
       linha: um PISO para remedir o assunto na próxima importação, mais um
       tanto por ponto percentual de lacuna até o máximo realista. */
    custoModo: 'lacuna', custoFixo: 60, custoFator: 0.5,
    custoPiso: 50, custoPorPonto: 2,
    ritmoSemanal: null, apenasFolhas: true, disciplina: '__todas__',
    /* Matérias que o Plano NÃO deve enxergar (ver `excluidasSet`). Lista de
       nomes, nunca um apagamento: sai da conta e volta inteira ao desmarcar. */
    excluidas: [],
    /* 10, não 30. Trinta linhas de assunto são ~2.000px de rolagem antes do
       primeiro bloco de ação, e quem abre a tela não lê trinta — lê as
       primeiras e desiste. O resto não some: abre com um toque, no passo que
       você configurar aqui. */
    limite: 10, ordenar: 'pior',
    faixaCritico: 50,    // abaixo disso o problema é de teoria
    faixaFragil: 65,     // abaixo disso ainda precisa revisar teoria
    pisoSerie: 5,        // amostra mínima por importação p/ série e consolidação
    sensTendencia: 3,    // variação em pp para contar como melhora/piora
    consolidarEm: 2,     // importações seguidas na meta para considerar sólido
    validadeDias: 120,   // acima disso o dado do assunto é considerado vencido
    amostraAlvo: 50,     // amostra que buscamos para a taxa ser confiável (±14pp a 95%)
    janelaMax: 365,      // até onde recuar no tempo procurando essa amostra
    cadenciaDias: 30,
    banca: '__todas__',  // banca usada na ordenação "prioridade na banca" (opcional)
    /* Quanto a incidência amplifica o retorno na ordem "prioridade na banca".
       Era uma constante 6 escondida no meio da fórmula: quem lia a tela não
       tinha como saber que existia, muito menos que ela decide a ordem. */
    pesoBanca: 6,
    /* Fica em 1 DE PROPÓSITO: é o valor que um perfil sem marca herda, e é ele
       que faz prefs() rodar a migração para 2. Colocar 2 aqui faria todo perfil
       antigo já nascer "migrado" e a migração nunca aconteceria. */
    migracao: 1
  },
  /* ── MODOS DE ATAQUE ──────────────────────────────────────────────────────
     A tela oferecia sete ordenações e dezenove parâmetros, e nenhuma frase
     dizendo QUANDO usar cada coisa. Escolher entre sete ordens sem saber o que
     elas respondem não é liberdade, é sorteio.

     Cada modo é um conjunto COERENTE de ajustes com uma pergunta única. Mexer
     em qualquer campo depois devolve o rótulo "Modo livre" — o preset é um
     ponto de partida, nunca uma trava. */
  MODOS: {
    base: {
      rot: '🧱 Base ampla', fase: 'pré-edital',
      quando: 'Sem edital publicado, construindo repertório. A pergunta é "o que ainda não sei?".',
      /* A FRASE ANTIGA BRIGAVA COM O QUADRO LOGO ABAIXO. Ela prometia que
         "nenhuma banca decide por você antes da hora" enquanto "Onde atacar
         primeiro" ordenava as matérias pela incidência das bancas, na mesma
         tela. Não eram duas opiniões: são dois níveis. O preset governa a
         ordem DENTRO da matéria — ali todo assunto pesa igual, para nada se
         esconder atrás de pouco volume. Entre matérias, quem decide é o peso
         da prova, porque é a única régua que existe antes do edital. */
      porque: 'Dentro de cada matéria, todo assunto pesa igual e o pior acerto vem primeiro — nada se esconde atrás de pouco volume. Qual matéria atacar primeiro é o quadro "Onde atacar primeiro" que responde, pela incidência das bancas.',
      patch: { ponderacao: 'igual', ordenar: 'pior', metaDominio: 85, tetoDominio: 90, custoModo: 'lacuna', incluirPequenas: false }
    },
    edital: {
      rot: '🎯 Edital publicado', fase: 'pós-edital',
      quando: 'Edital na mão, banca definida. A pergunta muda para "o que me dá ponto NESTA prova?".',
      porque: 'Ordena por fraqueza × incidência na banca e pesa por volume: assunto que cai muito e que você erra sobe ao topo, mesmo que não seja o seu pior acerto absoluto.',
      patch: { ponderacao: 'volume', ordenar: 'banca', metaDominio: 85, tetoDominio: 90, custoModo: 'lacuna', incluirPequenas: false },
      exige: 'incidencia'
    },
    curto: {
      rot: '⏱️ Tempo curto', fase: 'qualquer fase',
      quando: 'Poucas semanas até a prova e muito a fazer. A pergunta é "o que rende mais por questão resolvida?".',
      porque: 'Ordena por ganho ÷ custo com o custo medido pela lacuna: assunto muito distante da meta perde para outro que fecha rápido — em tempo curto, dois assuntos resolvidos valem mais que um começado.',
      patch: { ponderacao: 'igual', ordenar: 'rendimento', custoModo: 'lacuna', incluirPequenas: false }
    },
    manutencao: {
      rot: '🛡️ Manutenção', fase: 'véspera / nível bom',
      quando: 'Você já está no nível e o risco agora é PERDER o que ganhou.',
      porque: 'Ordena pela maior queda recente e destaca o que está sem medição nova: aqui o inimigo é o esquecimento, não a ignorância.',
      patch: { ponderacao: 'igual', ordenar: 'queda', custoModo: 'lacuna', incluirPequenas: false }
    },
    diagnostico: {
      rot: '🔍 Diagnóstico', fase: 'plano novo / poucos dados',
      quando: 'Poucas importações, muita coisa sem amostra. A pergunta é "onde eu estou, afinal?".',
      porque: 'Traz para o cálculo os assuntos de amostra pequena e ordena pelo pior acerto: aqui o objetivo não é atacar fraqueza, é produzir dado para saber qual fraqueza é real.',
      patch: { ponderacao: 'igual', ordenar: 'pior', incluirPequenas: true, minAmostra: 5, custoModo: 'lacuna' }
    }
  },
  /* ── O PRESET NÃO MEXE NO PASSO DE LEITURA ───────────────────────────────
     Os cinco modos gravavam `limite` (30, 20, 10, 15 e 40). Fazia sentido
     quando `limite` era "mostrar até N" — um recorte de estratégia. Deixou de
     fazer no instante em que ele virou o PASSO com que sete listas abrem:
     escolher "Diagnóstico" passaria a despejar 40 itens de cada lista de uma
     vez, que é exatamente o que o passo de 10 veio resolver, e "Tempo curto"
     encolheria a fila de todo mundo sem ter sido pedido.

     Modo de ataque é sobre O QUE a fila otimiza. Quanto cabe na sua tela é
     decisão de leitura, e é sua — não muda quando você troca de fase. */
  /* ── AS CINCO ORDENS QUE DECIDEM ALGO ────────────────────────────────────
     Eram sete. Duas foram embora porque não eram escolha nenhuma:

       · "maior ganho no domínio" é (teto − taxa) ÷ nº de assuntos, ou seja,
         função SÓ da taxa de acerto — dava exatamente a mesma fila de "pior
         acerto primeiro", com qualquer ponderação e qualquer custo. Duas
         entradas no seletor para a mesma lista;
       · "mais questões já resolvidas" é um raio-x do passado, não uma ordem de
         ataque: responde onde você gastou tempo, não o que estudar hoje. Essa
         leitura agora vive na aba 📊 Análise, no modo "mais erros".

     As duas MÉTRICAS continuam na tela (o "🔀 mostrar as duas" segue mostrando
     ganho no domínio e no aproveitamento). O que saiu foi a opção de ordenar
     por elas — e quem tinha uma das duas salva cai em "pior acerto primeiro",
     que é a fila que ele já estava vendo.

     Cada uma das cinco responde a uma pergunta diferente. `armadilha` não é
     ressalva de rodapé: é a metade da informação que decide se aquela ordem
     serve para você hoje. */
  ORDENS: {
    pontos: {
      rot: '💰 Mais pontos na prova',
      oque: 'Quanto cada assunto vale EM PONTOS do seu edital — questões da matéria × pontos por questão × peso × o quanto daquela matéria é este assunto — dividido pelo esforço. Matéria abaixo do mínimo eliminatório vem antes de tudo.',
      quando: 'Pós-edital, sempre. É a única ordem que responde "isto me aprova?" em vez de "isto me deixa mais completo?".',
      armadilha: 'Depende da composição que você digitou no editor de matérias. Número errado ali vira recomendação errada aqui — confira a tabela que a tela mostra ao lado da projeção.',
      soPos: true
    },
    pior: {
      rot: '🔴 Pior acerto primeiro',
      oque: 'Fila crua pela taxa de acerto: o assunto em que você mais erra vem primeiro.',
      quando: 'Pré-edital, ou sempre que a prioridade for não deixar nenhum buraco para trás.',
      armadilha: 'Ignora o quanto o assunto cai na prova e o trabalho que ele dá — dá para gastar um mês no assunto mais difícil e menos cobrado do edital.'
    },
    ganhoGeral: {
      rot: '📊 Maior ganho no aproveitamento geral',
      oque: 'Ordena pelo quanto o seu aproveitamento ponderado por questão sobe: assunto com amostra grande pesa mais.',
      quando: 'Quando a prova cobra muito daquilo que você já pratica em volume, e é esse número que você acompanha.',
      armadilha: 'Assunto pequeno e mal dominado quase não aparece — e é exatamente o tipo de questão que decide desempate.'
    },
    banca: {
      rot: '🎯 Fraqueza × incidência na banca',
      oque: 'Multiplica o retorno pela frequência do assunto na banca escolhida; o quanto ela empurra está no controle "quanto a banca pesa".',
      quando: 'Pós-edital, banca conhecida. É a ordem que mais aproxima o seu estudo da prova que você vai fazer.',
      armadilha: 'Depende de incidência importada. Sem ela, vira silenciosamente a fila do melhor retorno.'
    },
    rendimento: {
      rot: '⚡ Melhor retorno (ganho ÷ custo)',
      oque: 'Divide o ganho pelo custo estimado em questões: primeiro o que fecha rápido.',
      quando: 'Tempo curto. É esta a ordem que constrói o caminho mais curto até a meta.',
      armadilha: 'Com custo FIXO a divisão não muda nada e a fila vira cópia de "pior acerto". Só faz sentido com o custo por lacuna.'
    },
    queda: {
      rot: '📉 Maior queda recente',
      oque: 'Ordena pelo tombo entre a janela recente e o período anterior a ela.',
      quando: 'Manutenção e véspera: aqui o inimigo é esquecer, não ignorar.',
      armadilha: 'Um assunto ótimo que caiu de 95% para 88% aparece acima de um crônico de 30% que nunca melhorou.'
    }
  },
  /* ── O QUE UM MODO DE ATAQUE CONTROLA ─────────────────────────────────────
     Esta lista é a ÚNICA fonte: o diálogo de editar um modo nasce dela, o
     `modoPatch` só devolve campos dela e o resumo dos chips lê os mesmos
     campos. O diálogo tinha uma lista escrita à mão, e ela já havia divergido
     nos DOIS sentidos:

       · oferecia "Assuntos por vez" (`limite`), que deixou de ser estratégia
         no instante em que virou o PASSO com que sete listas abrem. Os presets
         tinham sido limpos desse campo de propósito, e editar um modo o
         reintroduzia pela porta de trás — escolher "Diagnóstico" voltava a
         despejar 40 itens de cada lista de uma vez;
       · e NÃO oferecia justamente os parâmetros que dão nome a três dos cinco
         modos: `minAmostra` (o Diagnóstico existe para baixá-lo), `pesoBanca`
         (o Edital publicado existe para ele — a própria explicação da ordem
         manda ajustar "quanto a banca pesa") e a régua de custo
         (`custoPiso`/`custoPorPonto`, sem a qual a divisão ganho ÷ custo do
         Tempo curto não significa nada).

     Regra para entrar aqui: o campo muda O QUE A FILA OTIMIZA ou EM QUEM ela
     confia. Fica fora o que é preferência de leitura (quantos itens por vez),
     de escopo (disciplina, matérias fora do Plano) ou régua de medição
     partilhada pela tela inteira (validade, consolidação, sensibilidade,
     janela, piso da série). */
  MODO_CAMPOS: [
    { key: 'ordenar', label: 'Ordem de ataque', tipo: 'ordens',
      hint: 'A pergunta que a fila responde.' },
    { key: 'ponderacao', label: 'Como pesar cada assunto', tipo: 'select', op: [
      ['igual', '⚖️ Todo assunto pesa igual'], ['volume', '📊 Pelo volume de questões'], ['ambas', '🔀 Mostrar as duas'] ] },
    { key: 'metaDominio', label: 'Meta de domínio (%)', tipo: 'num', min: 30, max: 100,
      hint: 'A nota que você considera suficiente em cada assunto.' },
    { key: 'tetoDominio', label: 'Acerto máximo realista (%)', tipo: 'num', min: 50, max: 100,
      hint: 'Onde a lacuna de cada assunto termina — é ele que dimensiona o custo e o prêmio.' },
    // `numerico` porque as opções são números escritos como texto: sem isso o
    // modo guardaria a string "100" e a comparação com o valor em vigor (100)
    // marcaria o modo como personalizado sem ninguém ter mexido nele.
    { key: 'amostraAlvo', label: 'Amostra desejada por assunto', tipo: 'select', numerico: true, op: [
      ['30', '30 questões (±18pp)'], ['50', '50 questões (±14pp)'], ['100', '100 questões (±10pp)'], ['200', '200 questões (±7pp)'] ] },
    { key: 'minAmostra', label: 'Amostra mínima para entrar na conta', tipo: 'num', min: 1, max: 200,
      hint: 'Abaixo disso o assunto vai para o segundo plano — é este número que o modo Diagnóstico baixa.' },
    { key: 'incluirPequenas', label: 'Incluir amostra pequena no cálculo', tipo: 'bool', op: [
      ['0', 'Não — vai para o segundo plano'], ['1', 'Sim — entra no cálculo (diagnóstico)'] ] },
    { key: 'custoModo', label: 'Como estimar o custo', tipo: 'select', op: [
      ['lacuna', '📐 Pela lacuna até o máximo realista'], ['fixo', 'Número fixo de questões'], ['proporcional', 'Proporcional ao praticado'] ] },
    { key: 'custoPiso', label: 'Custo: piso para remedir (questões)', tipo: 'num', min: 0, max: 500,
      hint: 'Só com custo por lacuna: o bloco que mede o assunto de novo.' },
    { key: 'custoPorPonto', label: 'Custo: questões por ponto de lacuna', tipo: 'num', min: 0, max: 50,
      hint: 'Só com custo por lacuna. É o que a calibragem pelo seu histórico ajusta.' },
    { key: 'pesoBanca', label: 'Quanto a banca pesa na ordem', tipo: 'num', min: 0, max: 20,
      hint: 'Só na ordem "fraqueza × incidência". 0 ignora a banca.' }
  ],
  MODO_CAMPO_CHAVES: null,   // preenchido na 1ª leitura (ver `_chavesDeModo`)
  _chavesDeModo() {
    if (!this.MODO_CAMPO_CHAVES) this.MODO_CAMPO_CHAVES = this.MODO_CAMPOS.map(c => c.key);
    return this.MODO_CAMPO_CHAVES;
  },
  /* ── MODOS EDITÁVEIS ──────────────────────────────────────────────────────
     Os cinco modos são um ponto de partida, não um dogma: a meta que serve para
     um concurso não serve para outro, e quem estuda é quem sabe. Cada modo pode
     ser ajustado e guarda o SEU ajuste no perfil; `MODOS` continua sendo o
     padrão de fábrica, e cada modo pode voltar a ele sozinho, sem levar os
     outros junto.

     Os ajustes ficam no perfil, não no retrato: reimportar o TEC todo mês
     recalcula os números, nunca as suas preferências. */
  modoPatch(k) {
    const base = (this.MODOS[k] && this.MODOS[k].patch) || {};
    const custom = (this.prefs().modosCustom || {})[k] || {};
    const junto = Object.assign({}, base, custom);
    /* Filtra pelos campos declarados: um perfil que já gravou `limite` dentro
       de um modo (o diálogo antigo permitia) para de ter o passo de leitura
       trocado ao aplicar o preset, sem precisar migrar dado nenhum. */
    const ok = this._chavesDeModo();
    const out = {};
    Object.keys(junto).forEach(c => { if (ok.indexOf(c) >= 0) out[c] = junto[c]; });
    return out;
  },
  modoEditado(k) {
    const custom = (this.prefs().modosCustom || {})[k];
    if (!custom) return false;
    const base = (this.MODOS[k] && this.MODOS[k].patch) || {};
    return Object.keys(custom).some(c => String(custom[c]) !== String(base[c]));
  },
  /* Guarda só o que DIFERE do padrão de fábrica, somando ao que já estava
     ajustado. Gravar o patch inteiro fazia um "salvar" sem mexer em nada
     marcar o modo como editado — e enfiava no modo campos que ele nunca quis
     definir (um modo que não fixa a meta passava a fixá-la, mudando o que
     "aplicar" significa). Campo que volta ao valor de fábrica sai do registro;
     modo sem nenhuma diferença deixa de existir como personalizado. */
  salvarModo(k, patch) {
    const base = (this.MODOS[k] && this.MODOS[k].patch) || {};
    const m = Object.assign({}, this.prefs().modosCustom || {});
    const atual = Object.assign({}, m[k] || {}, patch || {});
    const permitidos = this._chavesDeModo();
    Object.keys(atual).forEach(c => {
      // campo que não é do modo (o passo de leitura, por exemplo) não entra:
      // guardado, ele apareceria como "modo personalizado" sem efeito nenhum
      if (permitidos.indexOf(c) < 0) { delete atual[c]; return; }
      if (base[c] !== undefined && String(atual[c]) === String(base[c])) delete atual[c];
      if (atual[c] === undefined || (typeof atual[c] === 'number' && isNaN(atual[c]))) delete atual[c];
    });
    if (Object.keys(atual).length) m[k] = atual; else delete m[k];
    this.salvarPrefs({ modosCustom: m });
  },
  restaurarModo(k) {
    const p = this.prefs();
    const m = Object.assign({}, p.modosCustom || {});
    delete m[k];
    this.salvarPrefs({ modosCustom: m });
  },
  // Um preset está "em vigor" quando TODOS os campos que ele define batem com o
  // que está valendo. Basta mexer num deles para a tela voltar a dizer livre.
  modoAtivo(p) {
    p = p || this.prefs();
    const chaves = Object.keys(this.MODOS);
    for (const k of chaves) {
      const patch = this.modoPatch(k);
      if (Object.keys(patch).every(c => String(p[c]) === String(patch[c]))) return k;
    }
    return 'livre';
  },
  // Resumo legível do que um modo aplica — é o que a tela mostra sob os chips.
  resumoModo(k) {
    /* O que vale DEPOIS de aplicar: um modo que não define a meta mantém a que
       está valendo. Lendo só o patch, o resumo escrevia "meta undefined%" nos
       três modos que não a fixam. */
    const patch = Object.assign({}, this.prefs(), this.modoPatch(k));
    const rot = (this.ORDENS[patch.ordenar] || {}).rot || patch.ordenar;
    const pond = patch.ponderacao === 'volume' ? 'peso por volume' : patch.ponderacao === 'ambas' ? 'as duas métricas' : 'peso igual';
    const custo = patch.custoModo === 'fixo' ? 'custo fixo' : patch.custoModo === 'proporcional' ? 'custo proporcional' : 'custo por lacuna';
    const partes = [rot, 'meta ' + patch.metaDominio + '%'];
    if (patch.tetoDominio != null) partes.push('teto ' + patch.tetoDominio + '%');
    partes.push(pond, custo);
    if (patch.incluirPequenas) partes.push('inclui amostra pequena');
    /* Os campos que ESTE modo define por conta própria (o patch, não o que ele
       herda): é o que distingue "Diagnóstico" de "Base ampla" quando os dois
       ordenam pelo pior acerto. `limite` saiu — passo de leitura não é modo. */
    const proprio = this.modoPatch(k);
    if (proprio.minAmostra != null) partes.push('amostra mínima ' + proprio.minAmostra);
    if (proprio.amostraAlvo != null) partes.push('alvo ' + proprio.amostraAlvo + 'q');
    if (proprio.pesoBanca != null) partes.push('banca pesa ' + proprio.pesoBanca);
    if (proprio.custoPiso != null || proprio.custoPorPonto != null) {
      partes.push('custo ' + (proprio.custoPiso != null ? proprio.custoPiso : patch.custoPiso)
        + '+' + (proprio.custoPorPonto != null ? proprio.custoPorPonto : patch.custoPorPonto) + '/pt');
    }
    return partes.join(' · ');
  },
  prefs() {
    try {
      const v = JSON.parse(localStorage.getItem(DB._profilePrefix() + this.KEY_PREF));
      const p = Object.assign({}, this.DEFAULTS, v || {});
      /* MIGRAÇÃO — um padrão novo não chega a quem já usa o app. A tela GRAVA
         todos os ajustes a cada repintura, então todo perfil existente tem
         `custoModo: 'fixo'` salvo, e um valor salvo sempre vence o padrão. Sem
         esta migração, a correção que faz "melhor retorno" deixar de ser cópia
         de "pior acerto" só valeria para quem instalasse o app amanhã.
         Quem escolheu 'proporcional' de propósito mantém a escolha — só o
         'fixo', que era o padrão antigo e não uma decisão, é substituído. */
      /* `!== 2` e não `< 2` era uma migração que NUNCA TERMINAVA. A migração
         seguinte grava `migracao: 3`, e três é diferente de dois: a partir daí
         este bloco voltava a rodar em toda leitura das preferências e forçava
         `custoPiso` e `custoPorPonto` de volta ao padrão de fábrica. O efeito
         para quem usa: os dois campos de custo dos ajustes avançados não
         guardavam nada — você digitava 4, a tela mostrava 4, e a leitura
         seguinte devolvia 2, sem aviso. Migração é degrau, não porteira: roda
         para quem ainda não passou por ela. */
      if (p.migracao < 2) {
        if (p.custoModo !== 'proporcional') p.custoModo = 'lacuna';
        p.custoPiso = this.DEFAULTS.custoPiso;
        p.custoPorPonto = this.DEFAULTS.custoPorPonto;
        p.migracao = 2;
      }
      /* MIGRAÇÃO 3 — as duas ordens que saíram. "Ganho no domínio" sempre deu a
         mesma fila de "pior acerto"; "mais questões" era raio-x do passado.
         Quem tinha uma delas salva vai para "pior acerto primeiro", que é a
         lista que já estava vendo. A meta também sobe para 85% aqui — mas só
         para quem nunca mexeu nela, porque meta é decisão de quem estuda. */
      if (p.migracao < 3) {
        if (p.ordenar === 'ganhoDominio' || p.ordenar === 'volume') p.ordenar = 'pior';
        if (v && (v.metaDominio == null || Number(v.metaDominio) === 80)) p.metaDominio = this.DEFAULTS.metaDominio;
        p.migracao = 3;
      }
      /* MIGRAÇÃO 4 — a lista passa a abrir em 10 com "mostrar mais". Só muda
         para quem nunca mexeu no campo (tinha 30, que era o padrão antigo e
         não uma decisão); quem escolheu o próprio número mantém. */
      if (p.migracao < 4) {
        if (v && (v.limite == null || Number(v.limite) === 30)) p.limite = this.DEFAULTS.limite;
        p.migracao = 4;
      }
      return p;
    } catch (_) { return Object.assign({}, this.DEFAULTS); }
  },
  salvarPrefs(patch) {
    const v = Object.assign(this.prefs(), patch || {});
    DB.setRaw(DB._profilePrefix() + this.KEY_PREF, JSON.stringify(v));
    return v;
  },
  /* ── MATÉRIAS FORA DO PLANO ───────────────────────────────────────────────
     Um edital passa; o retrato do TEC não esquece. Quem prestou um concurso
     estadual carrega "Legislação do RN" para sempre: ela continua puxando o
     domínio para baixo, ocupando vaga na fila de ataque e inflando o "faltam X
     pontos" de uma prova que não cobra uma linha dela. O filtro por disciplina
     não resolve — aquilo recorta UMA matéria por vez, e aqui se quer o oposto:
     todas MENOS algumas.

     A exclusão vale para o motor inteiro, não só para a lista: domínio,
     trajetória, quadro de esforço, lacunas do edital e nota projetada. Uma
     matéria que sumisse só da lista deixaria o número do topo contando o que a
     lista não mostra — o pior dos dois mundos.

     Nada é apagado: é preferência do perfil, e a tela diz em voz alta quantas
     matérias estão de fora, porque número que exclui em silêncio é número
     errado. */
  MAX_EXCLUIDAS: 200,
  /* O conjunto guarda o nome que você clicou. Aplicá-lo cru deixaria metade do
     trabalho feito: o nome que você digitou no edital e o nome que a banca usa
     no TEC raramente coincidem, então excluir pela lista do TEC tiraria a
     matéria do domínio e a deixaria inteira dentro da nota projetada. Antes de
     usar, o conjunto é ESTENDIDO pelos pares que o casamento conservador de
     nomes já sabe fazer — nos dois sentidos. */
  excluidasSet(opts) {
    const base = Object.create(null);
    const lista = (opts && opts.excluidas) || [];
    if (!Array.isArray(lista) || !lista.length) return base;
    lista.slice(0, this.MAX_EXCLUIDAS).forEach(n => {
      const k = ReforcoEngine.norm(String(n == null ? '' : n));
      if (k) base[k] = true;
    });
    if (!Object.keys(base).length) return base;
    try {
      const tec = this.disciplinasConhecidas().map(d => ReforcoEngine.norm(d)).filter(Boolean);
      const ed = [];
      (DB.getActiveSubjects() || []).forEach(m => { const k = m && m.nome ? ReforcoEngine.norm(m.nome) : ''; if (k) ed.push(k); });
      if (ed.length && tec.length) {
        const par = PlanoPontos._casarNomes(ed, tec);
        Object.keys(par).forEach(de => {
          const para = par[de];
          if (base[de]) base[para] = true;
          if (base[para]) base[de] = true;
        });
      }
    } catch (e) { _quiet(e, 'excluidas-nomes'); }
    return base;
  },
  foraDoPlano(disciplina, fora) {
    if (!fora) return false;
    const k = ReforcoEngine.norm(String(disciplina == null ? '' : disciplina));
    return !!(k && fora[k]);
  },
  /* Toda disciplina que já apareceu em ALGUM retrato — não só no recorte atual.
     É de onde sai a lista do que se pode deixar de fora: uma matéria de um
     concurso antigo pode não estar no retrato de hoje e ainda assim estar
     pesando no histórico que o Plano soma. */
  disciplinasConhecidas() {
    const s = Object.create(null);
    try {
      (DB.getTecSnapshots() || []).forEach(sn => {
        (sn.rows || []).forEach(r => { if (r.disciplina) s[r.disciplina] = true; });
      });
    } catch (e) { _quiet(e, 'discs-conhecidas'); }
    return Object.keys(s).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  },
  /* A lista da caixa de seleção: o que o TEC conhece MAIS o que você declarou
     no edital, sem repetir a mesma matéria por causa da grafia. */
  materiasExcluiveis() {
    const vistos = Object.create(null); const out = [];
    const add = (nome, fonte) => {
      const k = ReforcoEngine.norm(String(nome == null ? '' : nome));
      if (!k) return;
      if (vistos[k]) { if (vistos[k].fontes.indexOf(fonte) < 0) vistos[k].fontes.push(fonte); return; }
      const o = { nome: nome, chave: k, fontes: [fonte], q: 0, assuntos: 0 };
      vistos[k] = o; out.push(o);
    };
    this.disciplinasConhecidas().forEach(d => add(d, 'tec'));
    try { (DB.getActiveSubjects() || []).forEach(m => { if (m && m.nome) add(m.nome, 'edital'); }); } catch (e) { _quiet(e, 'excl-edital'); }
    // volume histórico, para a caixa dizer o tamanho do que sai da conta
    try {
      const idx = this.totalHistorico({ apenasFolhas: true, _semExclusao: true });
      const SEP = ReforcoEngine.SEP;
      Object.keys(idx).forEach(k => {
        const o = vistos[ReforcoEngine.norm(k.split(SEP)[0])];
        if (!o) return;
        o.q += idx[k].q || 0; o.assuntos++;
      });
    } catch (e) { _quiet(e, 'excl-volume'); }
    return out.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  },
  _diasDesde(iso) {
    if (!iso) return Infinity;
    return Math.floor((new Date(todayLocal() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000);
  },
  // Margem de erro da proporção a 95% de confiança (em pontos percentuais).
  // É isto que transforma "confiável" de opinião em número.
  margemErro(pct, n) {
    if (!n || n < 2) return null;
    const p = Math.min(1, Math.max(0, pct / 100));
    return 1.96 * Math.sqrt(p * (1 - p) / n) * 100;
  },
  /* ── QUANTAS QUESTÕES, E PARA QUÊ ────────────────────────────────────────
     O conselho de cada assunto dizia "um bloco de ~B questões", com B saindo
     de `custoQ / 4` — um quarto de um custo que já era estimativa. Número
     redondo sem pergunta por trás: não dava para dizer o que B comprava.

     Há DUAS perguntas diferentes, e cada uma tem fórmula fechada:

     ① MEDIR — quantas questões para a próxima medição deste assunto ter
       margem de no máximo E pontos, a 95%:  n = z²·p(1−p)/E²  (z = 1,96).
       Com 50% de acerto e E = 10pp, são 97 questões. É o bloco que responde
       "onde eu estou", e é o único número honesto para mandar depois da
       teoria: sem ele, "voltar ao banco" é voltar ao escuro.

     ② PROVAR — quantas questões para o app CRAVAR que você melhorou Δ pontos
       contra a medição de hoje. São duas amostras independentes (a janela de
       hoje e a próxima), α = 5% bilateral e poder de 80%, então z = 1,96 +
       0,84 = 2,80:  Δ = z·√(p(1−p)/n₁ + p(1−p)/n₂).

     A segunda esbarra num limite que a tela precisa dizer em voz alta: se a
     medição de hoje saiu de poucas questões, NENHUM n₂ prova a melhora — o
     que falta é base, não esforço. Nesse caso o app devolve null e a frase
     muda de "resolva M" para "a comparação ainda não fecha". Prometer um
     número impossível seria pior que não prometer nada. */
  MARGEM_ALVO: 10,
  qParaMedir(taxa, margemAlvo) {
    const p = Math.min(0.95, Math.max(0.05, (taxa == null ? 50 : taxa) / 100));
    const E = Math.max(2, margemAlvo || this.MARGEM_ALVO) / 100;
    return Math.ceil(3.8416 * p * (1 - p) / (E * E));
  },
  deltaDetectavel(taxa, n1, n2) {
    if (!(n1 > 0) || !(n2 > 0)) return null;
    const p = Math.min(0.95, Math.max(0.05, (taxa == null ? 50 : taxa) / 100));
    return 2.80 * Math.sqrt(p * (1 - p) / n1 + p * (1 - p) / n2) * 100;
  },
  qParaProvar(taxa, n1, delta) {
    if (!(n1 > 0) || !(delta > 0)) return null;
    const p = Math.min(0.95, Math.max(0.05, (taxa == null ? 50 : taxa) / 100));
    const folga = Math.pow(delta / 100 / 2.80, 2) - p * (1 - p) / n1;
    if (!(folga > 0)) return null;                 // nem com amostra infinita
    return Math.ceil(p * (1 - p) / folga);
  },
  /* ── DOIS ASSUNTOS QUE A AMOSTRA NÃO DISTINGUE ──────────────────────────
     Simulação com 40 assuntos, 400 rodadas e taxas verdadeiras conhecidas: no
     regime de amostra deste app (20 a 50 questões por assunto), a fila por
     "pior acerto" acerta apenas 55% dos cinco piores VERDADEIROS — e mesmo
     assim captura 91% do ganho disponível. Ou seja: a POSIÇÃO no topo é quase
     sorteio, mas a ESCOLHA de qualquer um dos primeiros é quase ótima.

     Calar isso faz a tela prometer uma precisão que a amostra não tem, e
     empurra o aluno a refazer a fila atrás de um primeiro lugar que não
     existe. O teste é o de diferença entre duas proporções: se ela não passa
     de 1,96 erro-padrão, os dois estão empatados e a tela diz isso.

     ENCOLHIMENTO BAYESIANO FOI MEDIDO E DESCARTADO. Nos quatro regimes
     testados (piso atual, amostra curta, "incluir pequenas" e faixa estreita)
     ele move o acerto em ±1pp e a captura de ganho em menos que isso. Não
     paga a complexidade nem mexer num número que o aluno acompanha — o que
     limita a fila é o TAMANHO da amostra, não o estimador. */
  empateTecnico(a, b) {
    const na = a && a.qJanela, nb = b && b.qJanela;
    if (!na || !nb || a.taxa == null || b.taxa == null) return false;
    const pa = a.taxa / 100, pb = b.taxa / 100;
    const se = Math.sqrt(pa * (1 - pa) / na + pb * (1 - pb) / nb);
    if (!(se > 0)) return false;
    return Math.abs(pa - pb) <= 1.96 * se;
  },
  confiabilidade(n) {
    if (n >= 100) return { nivel: 'alta', tom: 'good' };
    if (n >= 50) return { nivel: 'média', tom: 'good' };
    if (n >= 20) return { nivel: 'baixa', tom: 'warn' };
    return { nivel: 'insuficiente', tom: 'bad' };
  },
  // JANELA ADAPTATIVA: para cada assunto, recua no tempo apenas o necessário até
  // juntar a amostra-alvo. Assunto muito praticado usa uma janela curta (bem atual);
  // assunto esparso recua mais, mas para assim que a amostra basta — sem pular
  // direto para "a vida inteira".
  _taxaAdaptativa(chave, snapsDesc, opts) {
    let q = 0, ac = 0, diasJanela = 0, retratos = 0, corte = snapsDesc.length;
    for (let i = 0; i < snapsDesc.length; i++) {
      const s = snapsDesc[i];
      // o limite vale para o INÍCIO do período: "não use dado mais velho que isso"
      if (this._diasDesde(s.startDate) > opts.janelaMax) { corte = i; break; }
      const idx = s._idx[chave];
      if (idx && idx.q > 0) {
        q += idx.q; ac += idx.ac; retratos++;
        diasJanela = Math.max(diasJanela, this._diasDesde(s.startDate));
      }
      corte = i + 1;
      if (q >= opts.amostraAlvo) break;
    }
    if (!q) return null;
    const pct = ac / q * 100;
    /* ── O "ANTES" DA COMPARAÇÃO ▲▼ ─────────────────────────────────────────
       O delta comparava a janela recente com a média da VIDA INTEIRA — que
       inclui a própria janela. Comparar uma parte com o todo que a contém
       amortece qualquer evolução, e quando a janela cobria todos os retratos o
       delta dava exatamente zero: as setas sumiam da tela sem explicação, como
       se nada tivesse mudado.

       Agora o "antes" é o que ficou PARA TRÁS da janela — dois períodos que não
       se sobrepõem. Sem período anterior, o delta é null e a tela diz
       "primeira medição" em vez de fingir estabilidade. */
    let qAntes = 0, acAntes = 0;
    for (let i = corte; i < snapsDesc.length; i++) {
      const idx = snapsDesc[i]._idx[chave];
      if (idx && idx.q > 0) { qAntes += idx.q; acAntes += idx.ac; }
    }
    return { q, ac, pct, diasJanela, retratos, margem: this.margemErro(pct, q), conf: this.confiabilidade(q),
      qAntes, pctAntes: qAntes > 0 ? (acAntes / qAntes * 100) : null };
  },
  /* ── FOLHAS DO RETRATO: CADA QUESTÃO EM EXATAMENTE UMA UNIDADE ────────────
     A regra antiga era "descarte todo tópico que tenha descendente". Num
     retrato ÚNICO isso é exato: no export do TecConcursos o pai é, ao
     centavo, a soma dos filhos (conferido em dois arquivos reais: 241
     tópicos-pai, zero divergências).

     No escopo CONSOLIDADO, não. Ali as linhas de vários retratos se somam, e a
     árvore de um mês não é a do outro: um tópico que é FOLHA numa importação
     (você resolveu questões nele sem detalhe de subtópico) pode ser PAI na
     seguinte (o TEC passou a detalhar). Somadas, a linha do pai carrega as
     duas coisas — e o descarte levava embora a parte que só existia como
     folha. Medido com dois exports reais do mesmo usuário: 533 questões no
     retrato consolidado, 493 chegando ao Plano. Quarenta questões
     desapareciam em silêncio, e nenhum número da tela denunciava.

     Agora o pai não é descartado: ele entra com o RESÍDUO — o que sobra dele
     depois de tirar os filhos diretos. Resíduo zero (o caso de todo retrato
     único) mantém exatamente o comportamento anterior; resíduo positivo é
     volume real, praticado e medido, que passa a contar onde sempre deveria.
     A linha fica marcada com `_residual` para a tela poder dizer que aquele
     número é a parte não detalhada do tópico, e não o total dele. */
  _folhas(snap, apenasFolhas) {
    const rows = (snap && snap.rows || []).filter(r => r.depth > 0 && (r.questoes || 0) > 0);
    if (!apenasFolhas) return rows;
    const prof = (c) => String(c).split('.').length;
    const out = [];
    rows.forEach(r => {
      if (!r.codigo) { out.push(r); return; }
      const desc = rows.filter(o => o !== r && o.disciplina === r.disciplina && o.codigo &&
        String(o.codigo).startsWith(String(r.codigo) + '.'));
      if (!desc.length) { out.push(r); return; }
      /* Só os filhos DIRETOS entram na subtração: cada um deles já traz o
         próprio ramo. Quando o retrato não tem a linha intermediária (árvore
         irregular), cai nos descendentes que existirem — o resíduo pode sair
         menor, nunca maior, e a guarda de `> 0` fecha a conta. */
      const diretos = desc.filter(o => prof(o.codigo) === prof(r.codigo) + 1);
      const base = diretos.length ? diretos : desc;
      const q = (r.questoes || 0) - base.reduce((a, o) => a + (o.questoes || 0), 0);
      if (q <= 0) return;
      const ac = Math.max(0, Math.min(q, (r.acertos || 0) - base.reduce((a, o) => a + (o.acertos || 0), 0)));
      out.push(Object.assign({}, r, {
        questoes: q, acertos: ac,
        pctAcerto: Math.round(ac / q * 1000) / 10,
        _residual: true, _totalDoTopico: r.questoes
      }));
    });
    return out;
  },
  /* ── A CHAVE DE UM ASSUNTO É DISCIPLINA + NOME ───────────────────────────
     Era só o NOME. "Princípios" de Constitucional e "Princípios" de
     Administrativo caíam no mesmo balde e somavam: 100 questões a 90% mais 100
     a 10% viravam UMA linha a 50% — uma taxa que não é de nenhum dos dois, com
     a disciplina do primeiro que apareceu colada nela. Daí para baixo tudo
     herdava o erro: o filtro por disciplina não achava o assunto do outro lado
     (a tela dizia "sem retrato" com o retrato na mão), a sequência de
     consolidação misturava dois históricos e o assunto sólido de verdade nunca
     era contado.

     O mapa de incidência e o índice de desempenho do Reforço já separavam por
     disciplina; este era o último lugar que ainda somava homônimos — e o mais
     caro, porque é dele que saem a taxa, o ganho e o custo de cada linha do
     Plano. A chave é a MESMA do resto do motor (`chaveInc`), para que os dois
     lados casem sem tradução. */
  _indice(snap, apenasFolhas) {
    /* Retrato AGREGADO não tem hierarquia própria (ver `_fontes` em
       `aggregate`): o índice dele é a SOMA dos índices de cada retrato, cada um
       resolvido com a própria árvore. É isto que faz o volume do Plano fechar
       com o total da Análise no escopo consolidado. */
    if (snap && snap._fontes && snap._fontes.length > 1) {
      const m = {};
      snap._fontes.forEach(s => {
        const idx = this._indice(s, apenasFolhas);
        for (const k in idx) {
          const c = m[k] || { q: 0, ac: 0, nome: idx[k].nome, disciplina: idx[k].disciplina };
          c.q += idx[k].q; c.ac += idx[k].ac; m[k] = c;
        }
      });
      Object.keys(m).forEach(k => { const v = m[k]; v.pct = v.q > 0 ? v.ac / v.q * 100 : null; });
      return m;
    }
    const m = {};
    this._folhas(snap, apenasFolhas).forEach(r => {
      const k = ReforcoEngine.chaveInc(r.disciplina || '', r.nome);
      const c = m[k] || { q: 0, ac: 0, nome: r.nome, disciplina: r.disciplina };
      c.q += (r.questoes || 0); c.ac += (r.acertos || 0);
      m[k] = c;
    });
    Object.values(m).forEach(v => { v.pct = v.q > 0 ? v.ac / v.q * 100 : null; });
    return m;
  },
  /* Total histórico de questões por assunto, na MESMA chave que o resto do
     motor usa. É daqui que o ciclo de uma atividade tira o quanto você já
     resolveu — antes e depois de criá-la. */
  /* O índice histórico é a última porta por onde uma matéria excluída entrava
     no Plano: é dele que saem a nota por matéria do ciclo, o "de N no total"
     de cada linha e o julgamento de uma atividade. `_semExclusao` existe para
     UM chamador — a própria caixa de seleção, que precisa mostrar o tamanho do
     que está fora justamente porque está fora. */
  totalHistorico(opts) {
    opts = Object.assign({}, this.prefs(), opts || {});
    const fora = (opts && opts._semExclusao) ? null : this.excluidasSet(opts);
    const temFora = !!(fora && Object.keys(fora).length);
    const m = {};
    (DB.getTecSnapshots() || []).forEach(s => {
      const idx = this._indice(s, opts.apenasFolhas);
      for (const k in idx) {
        if (temFora && this.foraDoPlano(idx[k].disciplina || k.split(ReforcoEngine.SEP)[0], fora)) continue;
        const c = m[k] || { q: 0, ac: 0 }; c.q += idx[k].q; c.ac += idx[k].ac; m[k] = c;
      }
    });
    return m;
  },
  /* A taxa de um assunto AGORA, pela MESMA janela adaptativa que a lista usa.
     Existe porque um assunto que passou do teto SAI da lista do Plano — e
     quem precisa julgá-lo (o ciclo de uma atividade) não pode cair na média da
     vida inteira: 40% em duzentas questões velhas mais 92% em cento e cinquenta
     novas dá 62%, e 62% reprova um assunto que está resolvido. */
  taxaAtualDe(disciplina, nome, opts) {
    const o = Object.assign({}, this.prefs(), opts || {});
    // matéria fora do Plano não tem taxa PARA O PLANO: nem null forçado, nem
    // número velho de um concurso que passou julgando uma atividade de hoje
    if (this.foraDoPlano(disciplina, this.excluidasSet(o))) return null;
    const todos = DB.getTecSnapshots();
    if (!todos.length) return null;
    const desc = todos.slice().reverse().map(s => { s._idx = this._indice(s, o.apenasFolhas); return s; });
    const a = this._taxaAdaptativa(ReforcoEngine.chaveInc(disciplina || '', nome), desc, o);
    return a ? a.pct : null;
  },
  qHistDe(disciplina, nome, opts) {
    const m = (opts && opts._mapa) || this.totalHistorico(opts);
    const v = m[ReforcoEngine.chaveInc(disciplina || '', nome)];
    return v ? v.q : 0;
  },
  // ── SÉRIE HISTÓRICA: domínio em cada importação ─────────────────────────
  // Responde "está funcionando?" — a pergunta que nenhum número isolado responde.
  // Usa um piso baixo de amostra (a intenção é tendência, não precisão pontual).
  PISO_SERIE: 5,
  /* ── A TRAJETÓRIA COMPARA COISAS DIFERENTES E CHAMA ISSO DE EVOLUÇÃO ──────
     Cada ponto é a média dos assuntos MEDIDOS NAQUELE retrato — e o conjunto
     muda a cada importação. Quem abre frente nova entra com assunto fraco, e a
     média cai mesmo que TODO assunto tenha melhorado. Não é hipótese: com
     quatro veteranos subindo 15pp e dez assuntos novos por retrato entrando a
     35%, a manchete dizia "-32,7pp em 6 importações" com nenhum assunto tendo
     piorado. O sinal inverte, e o número que o aluno mais olha passa a mentir
     na direção que mais desanima.

     A LINHA continua sendo o nível sobre tudo que você mediu — isso é honesto
     e é o que ela promete. O que passa a ser calculado à parte é o DELTA
     COMPARÁVEL: de um retrato para o seguinte, a média da variação só dos
     assuntos presentes nos DOIS. Encadeado, ele atravessa toda a série sem
     nunca comparar um assunto com a ausência de outro. */
  /* ── A DICA TEM DE MUDAR ALGUMA COISA ────────────────────────────────────
     O aviso "alvo de amostra alto para o seu volume" derivava a sugestão do
     MAIOR assunto, em faixas fixas (≥100 → 100, ≥50 → 50, senão 30). Com o
     alvo em 50 e o maior assunto em 72, ele sugeria... 50. O aviso aparecia,
     acusava a configuração e mandava ligar exatamente o que já estava ligado.

     A sugestão passa a sair da MEDIANA das amostras: o maior valor "redondo"
     que pelo menos metade dos assuntos alcança. É auto-calibrado — quem tem
     volume recebe 100, quem não tem recebe 10 — e, por construção, só é
     oferecido quando fica ABAIXO do alvo atual. Sem valor melhor a propor, o
     aviso não aparece: reclamar sem ter o que sugerir é ruído. */
  _alvoSugerido(usados, alvoAtual) {
    const qs = usados.map(x => x.qJanela || 0).sort((a, b) => a - b);
    if (!qs.length) return null;
    const mediana = qs[Math.floor((qs.length - 1) / 2)];
    const passos = [100, 50, 30, 20, 10];
    const cand = passos.find(v => v <= mediana && v < alvoAtual);
    return cand != null ? cand : null;
  },
  serieHistorica(opts) {
    opts = Object.assign({}, this.prefs(), opts || {});
    const snaps = DB.getTecSnapshots();
    const pontos = [];
    /* A trajetória tem de excluir as MESMAS matérias que o domínio do topo.
       Sem isto, o número grande dizia 80,3% e o último ponto do gráfico logo
       abaixo dizia 74,9% — a mesma média, com e sem a matéria descartada. */
    const fora = this.excluidasSet(opts);
    let ant = null, antPct = null;
    snaps.forEach(s => {
      const idx = this._indice(s, opts.apenasFolhas);
      const chaves = Object.keys(idx).filter(k => idx[k].q >= (opts.pisoSerie || this.PISO_SERIE) &&
        !this.foraDoPlano(idx[k].disciplina || '', fora) &&
        (opts.disciplina === '__todas__' || ReforcoEngine.norm(idx[k].disciplina || '') === ReforcoEngine.norm(opts.disciplina)));
      if (!chaves.length) return;
      const peso = (k) => (opts.ponderacao === 'volume') ? idx[k].q : 1;
      const univ = chaves.reduce((a, k) => a + peso(k), 0);
      const dom = chaves.reduce((a, k) => a + peso(k) * idx[k].pct / 100, 0) / univ * 100;
      const qTotal = chaves.reduce((a, k) => a + idx[k].q, 0);
      let deltaComp = null, comuns = 0, qComuns = 0;
      if (antPct) {
        let soma = 0;
        chaves.forEach(k => {
          if (antPct[k] == null) return;
          soma += idx[k].pct - antPct[k]; comuns++; qComuns += idx[k].q;
        });
        if (comuns > 0) deltaComp = soma / comuns;
      }
      const p = {
        data: s.endDate || s.date, nome: s.nome || '', dominio: dom,
        assuntos: chaves.length, questoes: qTotal,
        delta: ant ? dom - ant.dominio : null,
        deltaComp, comuns, qComuns,
        /* O retorno do esforço sai do delta COMPARÁVEL (dividir a
           variação-artefato pelo volume só espalha o artefato por questão) e
           divide pelas questões DESSES MESMOS assuntos. Dividir o ganho medido
           num conjunto pelo volume de outro, maior, fazia o "retorno" encolher
           sozinho a cada frente nova aberta — punia justamente quem ampliou. */
        rendimento: (deltaComp != null && qComuns > 0) ? deltaComp / qComuns * 100 : null
      };
      pontos.push(p); ant = p;
      antPct = {}; chaves.forEach(k => { antPct[k] = idx[k].pct; });
    });
    return pontos;
  },
  // ── CONSOLIDAÇÃO: quantas importações SEGUIDAS o assunto ficou na meta ───
  // "Cruzou a meta" e "está sólido" são coisas diferentes. Um assunto que acabou
  // de cruzar ainda não provou que fica — tirá-lo da lista agora é abandoná-lo cedo.
  _sequencias(opts) {
    const snaps = DB.getTecSnapshots();
    const porTopico = {};
    snaps.forEach(s => {
      const idx = this._indice(s, opts.apenasFolhas);
      const dataFim = s.endDate || s.date;
      Object.keys(idx).forEach(k => {
        if (idx[k].q < (opts.pisoSerie || this.PISO_SERIE)) return;
        (porTopico[k] = porTopico[k] || []).push({ data: dataFim, pct: idx[k].pct, q: idx[k].q });
      });
    });
    const out = {};
    Object.keys(porTopico).forEach(k => {
      const linha = porTopico[k];                 // já em ordem cronológica
      let seq = 0;
      for (let i = linha.length - 1; i >= 0; i--) {  // do mais novo para trás
        if (linha[i].pct >= opts.metaDominio) seq++; else break;
      }
      out[k] = {
        seq, medicoes: linha.length,
        ultimaMedicao: linha[linha.length - 1].data,
        diasDesde: this._diasDesde(linha[linha.length - 1].data),
        serie: linha.map(x => x.pct)
      };
    });
    return out;
  },
  /* O ritmo é "quantas questões por semana ESTE Plano vê". Somar as questões
     de uma matéria que o Plano não enxerga inflava o divisor de toda previsão:
     quem resolvia 300/semana, das quais 120 de uma legislação já excluída,
     recebia um "cerca de 9 semanas" calculado sobre um ritmo que ele não vai
     aplicar a nada que está na fila. */
  ritmoRecente(snapsDesc, dias, fora) {
    const temFora = !!(fora && Object.keys(fora).length);
    let q = 0, ini = null, fim = null;
    for (const s of snapsDesc) {
      if (this._diasDesde(s.endDate || s.date) > dias) break;
      q += (s.rows || []).filter(r => r.depth > 0 && !(temFora && this.foraDoPlano(r.disciplina || '', fora)))
        .reduce((a, r) => a + (r.questoes || 0), 0);
      if (!ini || s.startDate < ini) ini = s.startDate;
      const f = s.endDate || s.date;
      if (!fim || f > fim) fim = f;
    }
    if (!q || !ini || !fim) return null;
    const sem = Math.max(1, (new Date(fim + 'T00:00:00') - new Date(ini + 'T00:00:00')) / (7 * 86400000));
    return Math.round(q / sem);
  },
  disciplinas(scoped) {
    const s = new Set();
    (scoped && scoped.rows || []).forEach(r => { if (r.disciplina) s.add(r.disciplina); });
    return [...s].sort();
  },
  /* ── O QUE O TEC NÃO PODE VER ─────────────────────────────────────────────
     O Plano media só o que você PRATICOU. Um assunto do seu edital em que você
     nunca resolveu uma questão não é forte nem fraco: é invisível — e some
     justamente da tela feita para não deixar nada se esconder. No pré-edital
     esse é o buraco que mais custa caro, porque não aparece em lugar nenhum.

     O cruzamento é por DISCIPLINA do seu planejamento (o que o app sabe de
     verdade), nunca por aula: os nomes de aula do seu cronograma e os nomes de
     assunto do TEC não coincidem, e casar por aproximação inventaria pares
     errados com cara de certeza. As disciplinas do TEC que não casaram com
     nenhuma do plano vão listadas à parte, para que a falha de casamento seja
     visível em vez de virar um "sem prática" falso. */
  lacunasDoEdital(opts) {
    opts = Object.assign({}, this.prefs(), opts || {});
    let materias = [];
    try { materias = (DB.getActiveSubjects() || []).map(m => m.nome).filter(Boolean); } catch (_) { _quiet(_, 'edital-materias'); }
    /* Matéria que você tirou do Plano não é buraco: cobrar prática de
       "Legislação do RN" seria mandar estudar justamente o que foi declarado
       irrelevante — e o aviso amarelo de "sem prática" nunca mais sairia. */
    const fora = this.excluidasSet(opts);
    materias = materias.filter(n => !this.foraDoPlano(n, fora));
    if (!materias.length) return null;
    const norm = (x) => DB._normSubj ? DB._normSubj(x) : String(x || '').toLowerCase().trim();
    const vol = {};
    (DB.getTecSnapshots() || []).forEach(s => {
      (s.rows || []).filter(r => r.depth > 0 && (r.questoes || 0) > 0).forEach(r => {
        const k = norm(r.disciplina || '');
        if (!k || this.foraDoPlano(r.disciplina || '', fora)) return;
        const c = vol[k] || { q: 0, ac: 0, nome: r.disciplina };
        c.q += (r.questoes || 0); c.ac += (r.acertos || 0);
        vol[k] = c;
      });
    });
    const doPlano = new Set(materias.map(norm));
    const sem = [], pouca = [];
    materias.forEach(nome => {
      const v = vol[norm(nome)];
      const q = v ? v.q : 0;
      if (q === 0) sem.push({ nome, q: 0, taxa: null });
      else if (q < opts.minAmostra) pouca.push({ nome, q, taxa: v.ac / v.q * 100 });
    });
    const naoCasaram = Object.keys(vol).filter(k => !doPlano.has(k)).map(k => vol[k].nome).sort();
    return {
      total: materias.length, sem, pouca, naoCasaram,
      medidas: materias.length - sem.length - pouca.length
    };
  },
  /* ── O CAMINHO REALMENTE MAIS CURTO ──────────────────────────────────────
     Pegar os assuntos por ganho ÷ custo até cruzar a meta é a resposta óbvia —
     e ela erra. Com três assuntos que rendem 10pp/110q, 13pp/210q e 2,8pp/61q,
     a fila gulosa escolhe os dois primeiros (320 questões) quando o terceiro
     mais o segundo chegam à mesma meta com 271. Guloso não é mínimo: é o
     primeiro palpite razoável. E um número chamado "caminho mais curto" que
     não é o mais curto é pior que não ter número nenhum, porque a pessoa
     PLANEJA em cima dele.

     Isto é uma mochila: escolher o subconjunto de assuntos cuja soma de ganhos
     cobre a lacuna com o MENOR total de questões. Programação dinâmica sobre a
     lacuna discretizada em décimos de ponto, alguns milissegundos para centenas
     de assuntos, com uma saída pelo guloso se a entrada for grande demais.

     DUAS COISAS QUE A DISCRETIZAÇÃO SOZINHA NÃO GARANTIA — e das quais este
     número depende inteiramente, porque é o que a tela chama de "mínimo":

     1. COBRIR A LACUNA DE VERDADE. Em décimos, a mochila devolvia conjuntos
        que somavam 42,63pp quando faltavam 42,74 — até 0,05pp de déficit por
        assunto, e a meta não fechava. Nenhum conjunto sai daqui sem passar por
        `cobre`, que soma os ganhos COMO ELES SÃO, sem grade nenhuma.
     2. NUNCA PERDER PARA A LISTA DA TELA. O mesmo arredondamento fazia a
        mochila devolver 720 questões enquanto o prefixo da ordem exibida
        chegava à meta com 660 — o "caminho mais curto" mais caro que o
        caminho longo, no mesmo cálculo. Os candidatos (mochila, guloso e os
        percursos que o chamador já conhece) disputam a mesma prova, e vence o
        mais barato que cobre. */
  _caminhoMinimo(itens, falta, alternativas) {
    if (!(falta > 0)) return null;                    // a meta já está batida
    const uteis = itens.filter(x => x.ganhoPP > 0.049 && x.custoQ > 0);
    const custoDe = (lista) => lista.reduce((a, x) => a + (x.custoQ || 0), 0);
    const montar = (lista) => ({
      q: custoDe(lista), n: lista.length,
      itens: lista.slice().sort((a, b) => (b.ganhoPP / b.custoQ) - (a.ganhoPP / a.custoQ))
    });
    /* A ÚNICA prova que vale: somar os ganhos como eles são, sem discretização.
       Um percurso que não passa aqui não é um percurso — é um arredondamento. */
    const cobre = (l) => l.reduce((a, x) => a + (x.ganhoPP || 0), 0) >= falta - 1e-9;
    const candidatos = [];
    const propor = (l) => { if (l && l.length && cobre(l)) candidatos.push(l); };
    (alternativas || []).forEach(l => propor((l || []).filter(x => x && x.custoQ > 0)));
    const fechar = () => {
      if (!candidatos.length) return null;
      let melhor = candidatos[0], melhorQ = custoDe(melhor);
      for (const c of candidatos) { const q = custoDe(c); if (q < melhorQ) { melhor = c; melhorQ = q; } }
      return montar(melhor);
    };
    if (!uteis.length) return fechar();
    // guloso: o primeiro palpite razoável, e a saída quando a mochila não cabe
    const ord = uteis.slice().sort((a, b) => (b.ganhoPP / b.custoQ) - (a.ganhoPP / a.custoQ));
    const esc = []; let ac = 0;
    for (const x of ord) { esc.push(x); ac += x.ganhoPP; if (ac >= falta) break; }
    propor(esc);
    /* A GRADE É FINA E O ARREDONDAMENTO TEM DOIS TEMPOS.

       Em décimos, um conjunto podia perder por 0,1pp: o caso do comentário
       acima (B+C somam a lacuna EXATAMENTE) era descartado, e a mochila
       devolvia 320 questões onde 271 bastavam. Em centésimos o erro cai dez
       vezes — e mesmo assim a grade sozinha não decide nada, porque:

         · ARREDONDANDO AO MAIS PRÓXIMO a mochila enxerga o empate exato e
           acha o mínimo de verdade. É a passada normal. O conjunto que ela
           devolve ainda passa por `cobre` antes de valer.
         · ARREDONDANDO PARA BAIXO nada que ela aceite pode ficar aquém da
           lacuna. Custa um pouco mais caro e só roda quando a primeira
           passada devolveu um conjunto que `cobre` recusou.

       O epsilon é contra o ponto flutuante (2,9 × 100 dá 289,999… em JS), não
       contra a regra. A grade só afrouxa quando a tabela não caberia no
       orçamento de memória — e aí o guloso e os percursos conhecidos valem. */
    const N = uteis.length;
    const ORCAMENTO = 5e6;                            // células da tabela (≈12 MB no pior caso)
    const grade = [100, 10].find(g => N <= 400 && N * (Math.ceil(falta * g) + 1) <= ORCAMENTO);
    if (!grade) return fechar();                      // entrada grande demais para a mochila exata
    const alvo = Math.max(1, Math.ceil(falta * grade - 1e-9));
    const W = alvo + 1;
    const INF = Infinity;
    const mochila = (aoGrao) => {
      const somaTudo = uteis.reduce((a, x) => a + aoGrao(x.ganhoPP), 0);
      if (somaTudo < alvo) return null;               // nem levando tudo ao teto chega lá
      let ant = new Float64Array(W).fill(INF), atual = new Float64Array(W);
      ant[0] = 0;
      /* `usou` diz se o assunto i MELHOROU aquele estado (é o que desempata a
         reconstrução: o valor final ou veio da linha anterior, e então o assunto
         não entra, ou veio de usar este assunto); `veioDe` guarda de qual estado.
         Sem esses dois, uma DP feita no mesmo vetor devolve conjuntos com o mesmo
         assunto duas vezes — e um "caminho mais curto" que conta o mesmo assunto
         duas vezes é exatamente o tipo de número errado que ninguém confere. */
      const usou = new Uint8Array(N * W);
      // `alvo` chega a 10.000 em centésimos — Int32 para o estado nunca estourar
      const veioDe = new Int32Array(N * W).fill(-1);
      for (let i = 0; i < N; i++) {
        const g = aoGrao(uteis[i].ganhoPP), c = uteis[i].custoQ;
        atual.set(ant);
        if (g > 0) {
          for (let j = 0; j < W; j++) {
            if (ant[j] === INF) continue;
            const nj = Math.min(alvo, j + g);
            const novo = ant[j] + c;
            if (novo < atual[nj]) { atual[nj] = novo; usou[i * W + nj] = 1; veioDe[i * W + nj] = j; }
          }
        }
        const t = ant; ant = atual; atual = t;        // `ant` passa a ser a linha i
      }
      /* A TABELA INTEIRA É RESPOSTA, NÃO SÓ A ÚLTIMA CASA.
         Ler apenas o estado `alvo` joga fora o conjunto que soma a lacuna
         EXATAMENTE mas cai um ou dois centésimos abaixo dela na grade — três
         assuntos de 3,3333pp somam 10,00pp e a grade lê 9,99. Era assim que o
         mínimo real (271 questões) perdia para o palpite óbvio (320). Os
         estados logo abaixo do alvo guardam justamente esses conjuntos, e
         `cobre` decide quais valem: varremos a faixa e ficamos com o mais
         barato que cobre de verdade. Custa N reconstruções de O(N). */
      const reconstruir = (j0) => {
        const esc = []; let j = j0;
        for (let i = N - 1; i >= 0 && j > 0; i--) {
          if (usou[i * W + j]) { esc.push(uteis[i]); j = veioDe[i * W + j]; }
        }
        return esc;
      };
      let melhor = null, melhorQ = INF;
      const piso = Math.max(1, alvo - Math.max(1, N));
      for (let j = alvo; j >= piso; j--) {
        const c = ant[j];
        if (c === INF || c >= melhorQ) continue;
        const set = reconstruir(j);
        if (set.length && cobre(set)) { melhor = set; melhorQ = c; }
      }
      return melhor;
    };
    const antes = candidatos.length;
    const perto = mochila((v) => Math.round(v * grade));
    propor(perto);
    // a passada ao mais próximo não cobriu: repete conservadora, que sempre cobre
    if (perto && candidatos.length === antes) propor(mochila((v) => Math.floor(v * grade + 1e-9)));
    return fechar();
  },
  calcular(scoped, opts) {
    opts = Object.assign({}, this.prefs(), opts || {});
    if (!scoped) return { erro: 'sem-retrato' };
    const todos = DB.getTecSnapshots();
    if (!todos.length) return { erro: 'sem-retrato' };
    // do mais novo para o mais antigo, cada um com seu índice de assuntos
    const snapsDesc = todos.slice().reverse().map(s => {
      s._idx = this._indice(s, opts.apenasFolhas); return s;
    });
    const mHist = this._indice(scoped, opts.apenasFolhas);
    /* Total histórico coerente com a JANELA ADAPTATIVA: soma os índices POR
       RETRATO (mesma chave por nome), em vez de usar o agregado. Sem isto,
       quando o mesmo assunto muda de código entre importações, o agregado mais
       a detecção de folha captura uma amostra MENOR que a própria janela.
       É daqui que saem o "de N no total" de cada item e a amplitude usada no
       custo — o ▲▼ não usa mais este número: ele compara a janela com o
       período anterior a ela (ver _taxaAdaptativa). */
    const mFull = {};
    for (const s of snapsDesc) { const idx = s._idx || {}; for (const k in idx) { const c = mFull[k] || { q: 0, ac: 0 }; c.q += idx[k].q; c.ac += idx[k].ac; mFull[k] = c; } }
    const _fullPct = (k, fb) => { const f = mFull[k]; return (f && f.q > 0) ? (f.ac / f.q * 100) : fb; };
    let chaves = Object.keys(mHist);
    if (opts.disciplina && opts.disciplina !== '__todas__') {
      chaves = chaves.filter(k => ReforcoEngine.norm(mHist[k].disciplina || '') === ReforcoEngine.norm(opts.disciplina));
    }
    /* As matérias que você tirou do Plano saem AQUI, antes de qualquer conta:
       o domínio, a fila, o caminho mais curto e o "faltam X pontos" nascem já
       sem elas. O que saiu é devolvido em `excluidasAtivas` para a tela poder
       dizer, no topo, de quem o número NÃO está falando. */
    const fora = this.excluidasSet(opts);
    const excluidasAtivas = []; let excluidasQ = 0, excluidasAssuntos = 0;
    if (Object.keys(fora).length) {
      const vistas = Object.create(null);
      chaves = chaves.filter(k => {
        const d = mHist[k].disciplina || '';
        if (!this.foraDoPlano(d, fora)) return true;
        excluidasAssuntos++; excluidasQ += mHist[k].q || 0;
        if (d && !vistas[d]) { vistas[d] = true; excluidasAtivas.push(d); }
        return false;
      });
      excluidasAtivas.sort((a, b) => a.localeCompare(b, 'pt-BR'));
      /* Excluir tudo é um estado legítimo (marcou demais), e precisa de um erro
         PRÓPRIO: cair em "sem-retrato" mandaria importar um retrato que já
         existe, e a saída — desmarcar — nem seria mencionada. */
      if (!chaves.length) return { erro: 'tudo-excluido', excluidasAtivas, excluidasAssuntos, excluidasQ };
    }
    if (!chaves.length) return { erro: 'sem-retrato' };

    const teto = Math.max(50, Math.min(100, opts.tetoDominio)) / 100;
    const seqs = this._sequencias(opts);
    const brutos = chaves.map(k => {
      const h = mHist[k];
      const a = this._taxaAdaptativa(k, snapsDesc, opts) || { q: h.q, ac: h.ac, pct: h.pct, diasJanela: null, retratos: 0, margem: this.margemErro(h.pct, h.q), conf: this.confiabilidade(h.q), qAntes: 0, pctAntes: null };
      const taxa = a.pct;
      const amostraFraca = a.q < opts.minAmostra;
      const peso = (opts.ponderacao === 'volume') ? a.q : 1;
      const lacunaPP = Math.max(0, teto * 100 - taxa);
      const sq = seqs[k] || { seq: 0, medicoes: 0, diasDesde: null, serie: [] };
      return {
        nome: h.nome, disciplina: h.disciplina || '',
        seq: sq.seq, medicoes: sq.medicoes, serie: sq.serie,
        diasDesdeMedicao: sq.diasDesde,
        vencido: sq.diasDesde != null && sq.diasDesde > opts.validadeDias,
        qHist: (mFull[k] ? mFull[k].q : h.q), pctHist: _fullPct(k, h.pct),
        qJanela: a.q, diasJanela: a.diasJanela, retratosJanela: a.retratos,
        margem: a.margem, conf: a.conf, atingiuAlvo: a.q >= opts.amostraAlvo,
        taxa, amostraFraca, peso, lacunaPP, custoQ: 0, amplitude: 1,
        qAntes: a.qAntes || 0, pctAntes: a.pctAntes,
        // ▲▼ compara a janela com o que ficou ANTES dela — nunca com o todo que
        // a contém. Sem período anterior com amostra útil, não há comparação.
        delta: (a.pct != null && a.pctAntes != null && (a.qAntes || 0) >= (opts.pisoSerie || this.PISO_SERIE))
          ? Math.round((a.pct - a.pctAntes) * 10) / 10 : null,
        /* ── A SETA PRECISA PASSAR EM DOIS FILTROS, NÃO UM ────────────────
           `sensTendencia` responde "vale a pena me avisar?" — é preferência,
           e é legítima. Faltava a outra pergunta: "dá para provar?". Com o
           piso de série em 5 questões, o app acendia ▲ para uma diferença de
           3pp contra uma base onde só 83pp seriam comprováveis. Medido no
           caso real: 70 questões a 88% contra 10 questões a 65% acende ▲
           +18,6pp, quando a menor subida comprovável naquele par é 31pp.

           Anunciar melhora que não se sustenta é pior que não anunciar: o
           aluno troca de estratégia por causa de ruído. A seta só fica firme
           quando a diferença passa também do mínimo detectável do par. */
        deltaMinimo: this.deltaDetectavel(a.pct, a.qAntes, a.q)
      };
    });
    /* ── CUSTO ────────────────────────────────────────────────────────────────
       Três modos, e o padrão é o único que olha a distância a vencer:
         lacuna       piso para remedir + tanto por ponto de lacuna × amplitude
         fixo         o mesmo número para todo assunto (comparação crua)
         proporcional fator × o quanto você já praticou naquele assunto

       A AMPLITUDE é o que impede o custo por lacuna de ser inútil. Se o custo
       fosse função SÓ da lacuna, dividir o ganho (também função só da lacuna)
       pelo custo daria uma ordem monótona na lacuna — ou seja, exatamente a
       mesma fila de "pior acerto primeiro", que é o problema que este modo
       existe para resolver. Fechar 30 pontos num assunto estreito não custa o
       mesmo que fechar 30 pontos num assunto que se desdobra em dez temas; sem
       essa segunda dimensão, "melhor retorno" não tem o que retornar.

       O tamanho do assunto ninguém mede direto — o app usa o proxy que tem: o
       quanto o banco de questões já te serviu ali, comparado à mediana dos seus
       assuntos, com raiz quadrada para amortecer e teto/piso para que um
       outlier não multiplique o custo por dez. É uma estimativa declarada, não
       uma medida: por isso aparece escrita no item, e não escondida na conta. */
    const qsOrdenadas = brutos.map(x => x.qHist || 0).filter(q => q > 0).sort((a, b) => a - b);
    const medianaQ = qsOrdenadas.length ? qsOrdenadas[Math.floor(qsOrdenadas.length / 2)] : 1;
    brutos.forEach(x => {
      x.amplitude = Math.min(2, Math.max(0.6, Math.sqrt((x.qHist || 1) / Math.max(1, medianaQ))));
      x.custoQ = (opts.custoModo === 'proporcional')
        ? Math.max(10, Math.round((x.qHist || 0) * opts.custoFator))
        : (opts.custoModo === 'fixo')
          ? Math.max(10, Math.round(opts.custoFixo))
          : Math.max(10, Math.round(opts.custoPiso + opts.custoPorPonto * x.lacunaPP * x.amplitude));
    });
    const usados = opts.incluirPequenas ? brutos : brutos.filter(x => !x.amostraFraca);
    /* ── O BECO SEM SAÍDA DA AMOSTRA MÍNIMA ─────────────────────────────────
       "Nenhum assunto atingiu a amostra mínima" era um fim de linha: a tela
       zerava e mandava "reduza nos ajustes avançados ou resolva mais questões",
       sem dizer para quanto reduzir nem que existe um modo feito exatamente
       para isso.

       E o caso é comum, não excepcional: o índice do TEC é muito fino. Num
       export real de 400 questões havia 391 assuntos atômicos — cerca de UMA
       questão por assunto. Nenhum deles chega a 20, e o Plano inteiro
       desaparecia com o retrato na mão.

       Agora o erro carrega o diagnóstico: quantos assuntos existem, qual a
       maior amostra encontrada e qual valor de corte aproveitaria metade
       deles — é o que a tela precisa para oferecer a saída em um toque. */
    if (!usados.length) {
      const amostras = brutos.map(x => x.qJanela || 0).filter(q => q > 0).sort((a, b) => b - a);
      const maior = amostras.length ? amostras[0] : 0;
      const mediana = amostras.length ? amostras[Math.floor((amostras.length - 1) / 2)] : 0;
      /* A sugestão precisa VALER: propor 1 é matematicamente correto e
         inútil. O corte vai onde um TERÇO dos assuntos qualifica — e a tela
         diz quantos entram, porque baixar a régua compra cobertura pagando em
         margem de erro, e isso é uma escolha, não um detalhe. */
      const sug = Math.max(2, Math.min(opts.minAmostra - 1,
        amostras.length ? amostras[Math.floor((amostras.length - 1) / 3)] : 2));
      return { erro: 'amostra', assuntosNoRetrato: brutos.length, maiorAmostra: maior,
        medianaAmostra: mediana, minAmostra: opts.minAmostra,
        sugestaoMinAmostra: sug,
        qualificamNaSugestao: amostras.filter(q => q >= sug).length };
    }
    const universo = usados.reduce((a, x) => a + x.peso, 0);
    const dominioPct = usados.reduce((a, x) => a + x.peso * x.taxa / 100, 0) / universo * 100;

    // Incidência da banca (opcional): reusa o mapa tópico→incidência já existente.
    // Não altera o domínio nem o ganho; serve para ORDENAR por "onde mais cai na prova".
    let incMap = {}, temIncid = false;
    try {
      if ((typeof ReforcoEngine !== 'undefined') && ReforcoEngine.hasIncidencia && ReforcoEngine.hasIncidencia()) {
        incMap = ReforcoEngine.incidenceMap(opts.banca || '__todas__') || {};
        temIncid = Object.keys(incMap).length > 0;
      }
    } catch (_) { _quiet(_); }
    // 1º passo: anexa a incidência de cada assunto e calcula o rendimento.
    /* DUAS MÉTRICAS DE GANHO, sempre calculadas — a escolha do usuário decide
       qual manda na ordem e o que aparece na tela.

       ganhoDominio  (peso 'igual'): quanto sobe o DOMÍNIO, onde cada assunto vale
         o mesmo. Um tópico de 4 questões a 0% rende muito aqui — é o que impede
         que assunto pequeno e mal dominado se esconda.
       ganhoGeral    (peso 'volume'): quanto sobe o APROVEITAMENTO GERAL mostrado
         no topo desta tela, que é ponderado por questão. Aqui manda o volume.

       Os dois respondem perguntas diferentes e podem discordar: 300 questões da
       amostra a 60% valem pouco domínio e muitas questões recuperadas; 4
       questões a 0% valem muito domínio e quase nenhuma questão. Nenhum está
       errado — por isso a opção "🔀 Mostrar as duas". As duas contas usam a
       AMOSTRA que mediu a taxa, e não o total histórico: é dela que a taxa
       saiu, e é sobre ela que a projeção fecha. */
    /* O PESO DO GANHO TEM DE SER O MESMO PESO DO DOMÍNIO. Aqui o universo era
       somado por `qHist` (a vida inteira) enquanto o domínio ponderado usava
       `qJanela` (a amostra que mediu a taxa). Duas réguas diferentes na mesma
       conta: o "acumulado" de cada item projetava um número que o topo da tela
       nunca alcançaria. Com o mesmo peso nos dois lados, levar um assunto ao
       máximo realista sobe o domínio EXATAMENTE o que o item promete. */
    const universoQ = usados.reduce((a, x) => a + (x.qJanela || 0), 0) || 1;
    usados.forEach(x => {
      x.ganhoDominio = Math.max(0, (teto - x.taxa / 100) / usados.length * 100);
      x.ganhoQuestoes = Math.max(0, (teto - x.taxa / 100) * (x.qJanela || 0));
      x.ganhoGeral = Math.max(0, x.ganhoQuestoes / universoQ * 100);
      x.ganhoPP = (opts.ponderacao === 'volume') ? x.ganhoGeral
        : Math.max(0, (x.peso * teto - x.peso * x.taxa / 100) / universo * 100);
      /* Aqui havia uma SEGUNDA atribuição de x.ganhoDominio, ponderada por
         x.peso, que apagava a de peso igual calculada acima. Com a ponderação
         "volume" as duas colunas do "🔀 Mostrar as duas" passavam a medir a
         mesma coisa e o rótulo "cada assunto pesa igual" ficava falso.
         ganhoDominio é sempre de peso igual; ganhoGeral é sempre por volume;
         ganhoPP é o que a ponderação escolhida manda somar no acumulado. */
      x.rendimento = x.ganhoPP / x.custoQ * 100;
      // por DISCIPLINA + tópico (com queda para só o nome): dois "Princípios" de
      // disciplinas diferentes deixam de somar no mesmo número
      x.incid = temIncid ? (ReforcoEngine.incidenciaDe(incMap, x.nome, x.disciplina).valor || 0) : null;
    });
    // Normaliza pela MAIOR incidência ENTRE OS ASSUNTOS DO PLANO (folhas), não pelo mapa
    // global — senão agregados de disciplina (ex.: 434) achatam todos os assuntos-folha.
    let incMax = 0;
    if (temIncid) usados.forEach(x => { if (x.incid > incMax) incMax = x.incid; });
    usados.forEach(x => {
      x.incidNorm = (temIncid && incMax > 0) ? (x.incid / incMax) : 0;
      // Prioridade na banca = retorno do esforço amplificado pela frequência na
      // prova. Mantém o rendimento como base (nada some), mas empurra ao topo o
      // que é fraco E cai muito. O quanto ele empurra é `pesoBanca`, agora um
      // controle na tela: 0 ignora a banca, 12 faz a incidência mandar quase
      // sozinha. Era uma constante 6 invisível decidindo a ordem.
      x.prioBanca = x.rendimento * (1 + Math.max(0, opts.pesoBanca) * x.incidNorm);
    });
    // Classificação em linguagem clara, com o que fazer em cada faixa
    // Orientação escrita para o CASO, não genérica: usa a taxa, a distância até a
    // meta e o histórico daquele assunto. Antes a mesma frase se repetia em vários.
    usados.forEach(x => {
      const t = x.taxa, alvoSeq = opts.consolidarEm;
      const faltaMeta = Math.max(0, opts.metaDominio - t).toFixed(0);
      const caindo = x.delta != null && x.delta <= -opts.sensTendencia;
      /* Duas frases fixas por faixa faziam a lista repetir a MESMA orientação
         palavra por palavra em assuntos seguidos — e texto que se repete deixa
         de ser lido. Cada faixa continua com o seu conselho, agora com os
         números daquele assunto e com a tendência, quando ela existe. */
      const queda = (x.delta != null) ? Math.abs(x.delta) : null;
      /* ── O NÚMERO DE QUESTÕES DEIXA DE SER PALPITE ──────────────────────
         Era `custoQ / 4`, um quarto de uma estimativa. `bloco` agora é a
         amostra que faz a PRÓXIMA medição deste assunto valer: n =
         z²·p(1−p)/E², com E = 10pp. E `provar` é a amostra que faz o app
         CRAVAR a melhora até a meta, num teste de duas proporções com 80% de
         poder. Quando `provar` volta null, a medição de hoje é curta demais
         para sustentar a comparação — e a frase diz isso em vez de inventar
         um número que não existe. */
      const bloco = this.qParaMedir(t);
      const lacunaMeta = Math.max(0, opts.metaDominio - t);
      const provar = this.qParaProvar(t, x.qJanela, lacunaMeta);
      x.qMedir = bloco; x.qProvar = provar;
      x.deltaMin = this.deltaDetectavel(t, x.qJanela, bloco);
      /* Uma frase só, e sempre com o número que falta: ou o bloco já prova a
         melhora, ou o app diz quantas a mais, ou avisa que a base é curta. */
      const prova = (provar == null)
        ? ' As ' + x.qJanela + ' questões que mediram este assunto são poucas para comprovar a subida até a meta: a próxima medição entra como base nova.'
        : (provar <= bloco)
          ? ' Esse bloco já basta para o app cravar a subida até a meta.'
          : ' Para o app CRAVAR a subida até a meta são ' + provar + ' questões — o bloco acima já mede onde você ficou.';
      /* ── A ORDEM E O PORQUÊ SÃO DUAS COISAS ────────────────────────────
         `acao` é o conselho inteiro: diagnóstico, ordem e a estatística que a
         sustenta. Ele está certo — e ocupava nove linhas de texto colorido em
         CADA item da lista, com o mesmo miolo repetido dez vezes seguidas.
         Medido a 390px, um único assunto passava de 490px de altura: mais que
         uma tela de celular para uma linha de lista.

         `ordem` é a MESMA decisão em uma frase imperativa. Ela fica visível;
         o conselho inteiro passa a viver na guia "Por que está aqui", que já
         existia e já é onde se vai quando a linha não basta. Nada some, nada
         é reescrito: o que muda é o que compete pela primeira leitura. */
      if (t < opts.faixaCritico) x.status = { rot: '🔴 Crítico', tom: 'bad',
        ordem: 'Teoria primeiro, depois um bloco de ' + bloco + ' questões.',
        acao: 'Você acerta ' + t.toFixed(0) + '%: erra mais do que acerta. ' +
          (caindo ? 'E caiu ' + queda + 'pp contra o período anterior. ' : '') +
          'Resolver mais questões agora só repete o erro — retome a teoria deste assunto primeiro. ' +
          'Depois volte com um bloco de ' + bloco + ' questões: é a amostra que mede o seu novo nível com ±' + this.MARGEM_ALVO + 'pp e mostra se a teoria pegou.' };
      else if (t < opts.faixaFragil) x.status = { rot: '🔴 Frágil', tom: 'bad',
        ordem: 'Bloco de ' + bloco + ' questões pelo caminho do erro: anote e revise só o que errar.',
        acao: 'A base existe (' + t.toFixed(0) + '%), mas falha em pontos específicos, e faltam ' + faltaMeta + ' até a meta. ' +
          (caindo ? 'A queda de ' + queda + 'pp sugere revisão atrasada. ' : '') +
          'Vá pelo caminho do erro: um bloco de ' + bloco + ' questões (o que dá ±' + this.MARGEM_ALVO + 'pp de margem), anote o que errou e revise só esses pontos antes do bloco seguinte.' + prova };
      else if (t < opts.metaDominio) x.status = { rot: '🟠 Em desenvolvimento', tom: 'warn',
        ordem: caindo
          ? 'Reforce a revisão e remeça com ' + bloco + ' questões.'
          : bloco + ' questões; revise apenas o que errar. Faltam ' + faltaMeta + ' pontos.',
        acao: caindo
          ? 'Estava melhor antes e caiu ' + queda + 'pp. Antes de aumentar o volume, verifique se o assunto mudou de banca ou se você deixou de revisar — reforce a revisão e remeça com ' + bloco + ' questões.'
          : 'Faltam ' + faltaMeta + ' pontos para a meta. Aqui volume resolve: ' + bloco + ' questões e revise apenas o que errar, sem voltar à teoria inteira.' + prova };
      /* "Consolidado" e "dado vencido" apareciam juntos no mesmo assunto: a
         tela dizia "está resolvido" e "sem medição nova há 8 meses" lado a
         lado, e cabia à pessoa decidir em qual acreditar. Sustentar a meta em
         medições ANTIGAS não é sustentar a meta hoje — é uma terceira
         situação, com ação própria: remedir antes de confiar. */
      else if (x.seq >= alvoSeq && x.vencido) x.status = { rot: '🟠 Sólido, sem medição nova', tom: 'warn', seq: x.seq,
        ordem: 'Remeça com ' + bloco + ' questões antes de riscar da lista — o dado tem ' + x.diasDesdeMedicao + ' dias.',
        acao: 'Sustentou a meta em ' + x.seq + ' importações, mas a última tem ' + x.diasDesdeMedicao + ' dias. Antes de riscar da lista, resolva ' + bloco + ' questões e reimporte: é o bloco que devolve uma medição com ±' + this.MARGEM_ALVO + 'pp. Consolidado com dado velho é lembrança, não medição.' };
      else if (x.seq >= alvoSeq) x.status = { rot: '🟢 Consolidado', tom: 'good', seq: x.seq,
        ordem: 'Resolvido: só revisão espaçada. Tempo extra aqui rende menos.',
        acao: 'Sustenta a meta há ' + x.seq + ' importações seguidas. Está resolvido: só revisão espaçada. Tempo extra aqui rende menos que em qualquer assunto acima.' };
      else x.status = { rot: '🟡 Recém-corrigido', tom: 'warn', seq: x.seq,
        ordem: 'Mantenha ~' + bloco + ' questões por importação até sustentar (' + x.seq + ' de ' + alvoSeq + ').',
        acao: 'Passou da meta em ' + x.seq + ' de ' + alvoSeq + ' importações necessárias. Ainda não provou que fixou — mantenha cerca de ' + bloco + ' questões por importação até sustentar, que é o mínimo para a medição seguinte ter ±' + this.MARGEM_ALVO + 'pp.' };
    });
    /* ── A ORDEM QUE APROVA ───────────────────────────────────────────────
       Só existe depois do edital, porque só aí existe prova com composição. E
       ela é a ÚNICA em que o mínimo eliminatório entra: matéria abaixo do
       mínimo não é prioridade alta, é restrição — some antes de qualquer
       otimização de pontos, porque nenhum total te salva de ser cortado. */
    const temPontos = (typeof PlanoPontos !== 'undefined') && PlanoPontos.anexarPontos({ itens: usados, pequenas: [] }, opts);
    const ordem = {
      pontos: (a, b) => (b.eliminatoria ? 1 : 0) - (a.eliminatoria ? 1 : 0) || b.pontosPorQuestao - a.pontosPorQuestao,
      rendimento: (a, b) => b.rendimento - a.rendimento,
      pior: (a, b) => a.taxa - b.taxa,
      queda: (a, b) => (a.delta == null ? 0 : a.delta) - (b.delta == null ? 0 : b.delta),
      banca: (a, b) => b.prioBanca - a.prioBanca,
      // "o que mexe mais no aproveitamento geral", sem depender do custo
      ganhoGeral: (a, b) => b.ganhoGeral - a.ganhoGeral
    };
    // Desempate ESTÁVEL por nome: duas execuções com os mesmos dados dão a mesma ordem
    // ordem desconhecida (preferência antiga, dado de fora) cai onde a migração
    // manda: "pior acerto primeiro" — nunca numa terceira fila silenciosa
    const base = ordem[opts.ordenar] || ordem.pior;
    const cmp = (a, b) => base(a, b) || (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    const plano = usados.filter(x => x.ganhoPP > 0.001).sort(cmp);
    const meta = opts.metaDominio;
    let acum = dominioPct, idxMeta = -1, qAteMeta = 0;
    plano.forEach((x, i) => {
      acum += x.ganhoPP; x.acumulado = acum;
      if (idxMeta < 0) { qAteMeta += x.custoQ; if (acum >= meta) idxMeta = i; }
    });
    /* ── O CAMINHO MAIS CURTO NÃO PODE DEPENDER DA ORDEM DA TELA ─────────────
       `qAteMeta` acumula na ordem EXIBIDA. Chamar isso de "caminho mais curto"
       só era verdade por acaso, quando a ordem escolhida era a do melhor
       retorno; ordenando por "mais questões já resolvidas", a tela seguia
       prometendo o menor esforço para o percurso mais caro.

       O caminho curto é sempre o mesmo, independente de como você prefere LER
       a lista: pegue os assuntos por ganho ÷ custo até cruzar a meta. Agora são
       dois números distintos e rotulados — o mínimo possível, e o que a sua
       ordem atual custa. */
    /* O prefixo da ordem exibida É um percurso válido até a meta — e por isso
       entra como candidato: o número que a tela chama de "mais curto" não pode
       perder para a própria lista que ela mostra logo abaixo. */
    const caminho = this._caminhoMinimo(plano, meta - dominioPct,
      idxMeta >= 0 ? [plano.slice(0, idxMeta + 1)] : []);
    /* ── ORDENS QUE DÃO A MESMA LISTA ────────────────────────────────────────
       Com custo fixo e peso igual, "pior acerto", "maior ganho no domínio" e
       "melhor retorno" produzem EXATAMENTE a mesma sequência — as três são
       função só da taxa de acerto. Escolher entre elas parecia estratégia e não
       mudava uma linha. Em vez de esconder isso, a tela passa a dizer quais
       ordens são gêmeas COM OS SEUS AJUSTES DE AGORA (muda o custo, muda o
       parentesco), o que também ensina o que cada uma realmente faz. */
    /* Com três ou quatro assuntos, duas ordens coincidirem é ACASO, não
       parentesco: qualquer critério empata numa lista curta. Avisar ali que as
       ordens "são idênticas" ensinaria a coisa errada — a lista cresce e elas
       se separam. O fato continua sendo calculado (é dele que o teste vive);
       a tela só o exibe quando a lista é grande o bastante para significar
       alguma coisa. */
    const assinatura = plano.map(x => x.nome).join('|');
    const equivalentes = Object.keys(ordem).filter(k => k !== opts.ordenar &&
      plano.slice().sort((a, b) => ordem[k](a, b) || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
        .map(x => x.nome).join('|') === assinatura);
    const ritmo = opts.ritmoSemanal || this.ritmoRecente(snapsDesc, 120, fora) || 0;
    const idadeUltimo = this._diasDesde(todos[todos.length - 1].endDate || todos[todos.length - 1].date);
    const sens = opts.sensTendencia;
    usados.forEach(x => {
      x.deltaFirme = x.delta != null && Math.abs(x.delta) >= sens
        && x.deltaMinimo != null && Math.abs(x.delta) >= x.deltaMinimo;
    });
    const melhorando = usados.filter(x => x.deltaFirme && x.delta > 0).length;
    const piorando = usados.filter(x => x.deltaFirme && x.delta < 0).length;
    const janelaMedia = Math.round(usados.filter(x => x.diasJanela).reduce((a, x) => a + x.diasJanela, 0) / Math.max(1, usados.filter(x => x.diasJanela).length));
    return {
      dominioPct, meta, jaAtinge: dominioPct >= meta, falta: Math.max(0, meta - dominioPct),
      assuntos: usados.length, ignorados: brutos.length - usados.length,
      excluidasAtivas, excluidasAssuntos, excluidasQ,
      qTotal: usados.reduce((a, x) => a + x.qJanela, 0),
      idxMeta, qAteMeta: idxMeta >= 0 ? qAteMeta : null, caminho, equivalentes,
      equivalentesConfiaveis: plano.length >= 5,
      custoModo: opts.custoModo, custoPiso: opts.custoPiso, custoPorPonto: opts.custoPorPonto,
      pesoBanca: opts.pesoBanca, minAmostra: opts.minAmostra, modo: this.modoAtivo(opts),
      ritmo, ritmoMedido: this.ritmoRecente(snapsDesc, 120, fora),
      /* Divergente quando o número travado erra a medição por mais de 50% —
         abaixo disso a previsão ainda é da mesma ordem de grandeza e o aviso
         viraria ruído; acima, ela deixa de descrever qualquer coisa. */
      ritmoDivergente: (function (m, atual) {
        if (!(m > 0) || !(atual > 0) || m === atual) return false;
        return Math.abs(atual - m) / Math.max(m, atual) > 0.5;
      })(this.ritmoRecente(snapsDesc, 120, fora), ritmo),
      // a previsão em semanas acompanha o caminho CURTO, não a ordem exibida
      semanas: (caminho && ritmo > 0) ? caminho.q / ritmo : null,
      amostraAlvo: opts.amostraAlvo, janelaMax: opts.janelaMax, janelaMedia,
      // Se quase ninguém alcança o alvo, o problema é a CONFIGURAÇÃO, não o seu estudo.
      maiorAmostra: usados.reduce((m, x) => Math.max(m, x.qJanela), 0),
      alvoInviavel: usados.length > 0 && (usados.filter(x => x.atingiuAlvo).length / usados.length) < 0.25
        && this._alvoSugerido(usados, opts.amostraAlvo) != null,
      alvoSugerido: this._alvoSugerido(usados, opts.amostraAlvo),
      teto: Math.round(teto * 100),
      comAlvo: usados.filter(x => x.atingiuAlvo).length,
      melhorando, piorando, ordenar: opts.ordenar,
      temIncid, banca: opts.banca,
      temPontos, modoEdital: (typeof PlanoPontos !== 'undefined') ? PlanoPontos.modo() : 'pre',
      projecao: (typeof PlanoPontos !== 'undefined') ? PlanoPontos.projecao(opts) : null,
      comIncid: usados.filter(x => x.incid > 0).length,
      /* `consolidados` continua sendo o TOTAL que sustentou a meta — é o que a
         tela de Conquistas conta, e mudar a régua faria uma conquista já obtida
         regredir. Para a tela, o que importa é a separação: sólido com medição
         recente é uma coisa, sólido com dado de oito meses é outra, e o chip
         verde não pode contar quem a lista mostra em laranja. */
      consolidados: usados.filter(x => x.taxa >= opts.metaDominio && x.seq >= opts.consolidarEm).length,
      solidosAtuais: usados.filter(x => x.taxa >= opts.metaDominio && x.seq >= opts.consolidarEm && !x.vencido).length,
      solidosVencidos: usados.filter(x => x.taxa >= opts.metaDominio && x.seq >= opts.consolidarEm && x.vencido).length,
      recentes: usados.filter(x => x.taxa >= opts.metaDominio && x.seq < opts.consolidarEm).length,
      vencidos: usados.filter(x => x.vencido).length,
      consolidarEm: opts.consolidarEm, validadeDias: opts.validadeDias,
      sensTendencia: opts.sensTendencia, faixaCritico: opts.faixaCritico, faixaFragil: opts.faixaFragil,
      serie: this.serieHistorica(opts),
      idadeUltimo, cadenciaDias: opts.cadenciaDias,
      defasado: idadeUltimo > opts.cadenciaDias,
      ponderacao: opts.ponderacao,
      disciplina: opts.disciplina,
      /* A fatia é só o que a TELA mostra. O tamanho real do plano vai junto,
         porque é dele que saem o "mostrando 10 de 81" e a conta de quantos
         faltam até a bandeira da meta — números que a fatia não sabe dar. */
      itens: plano.slice(0, opts.limite),
      totalItens: plano.length, limite: opts.limite,
      qRestante: plano.slice(opts.limite).reduce((a, x) => a + (x.custoQ || 0), 0),
      medianaJanela: (() => {
        const qs = usados.map(x => x.qJanela || 0).filter(q => q > 0).sort((a, b) => a - b);
        return qs.length ? qs[Math.floor((qs.length - 1) / 2)] : 0;
      })(),
      // quantos do TOPO a amostra não consegue separar do primeiro
      empatados: (() => {
        if (plano.length < 2) return 0;
        let n = 1;
        for (let i = 1; i < plano.length; i++) {
          if (this.empateTecnico(plano[0], plano[i])) n++; else break;
        }
        return n;
      })(),
      // SEGUNDO PLANO: assuntos sem amostra confiável. Ficam FORA da média (8 questões
      // a 38% podem significar de 4% a 71% — contaminaria o número), mas não somem.
      // Aqui a ação é outra: primeiro juntar dado, depois decidir se é fraqueza.
      /* Quando "incluir amostra pequena" está ligado, estes assuntos JÁ estão na
         lista principal — repeti-los aqui embaixo mostrava o mesmo assunto duas
         vezes, com números diferentes, como se fossem dois.
         E a meta de questões é a de ENTRAR NO CÁLCULO (`minAmostra`), não a
         amostra ideal: pedir 42 questões quando 12 bastavam para sair do limbo
         fazia a pessoa desistir de um diagnóstico que estava a um bloco. */
      pequenas: opts.incluirPequenas ? [] : brutos.filter(x => x.amostraFraca).map(x => Object.assign(x, {
        faltaAmostra: Math.max(1, opts.minAmostra - x.qJanela),
        faltaIdeal: Math.max(1, opts.amostraAlvo - x.qJanela)
      })).sort((a, b) => (a.taxa == null ? 999 : a.taxa) - (b.taxa == null ? 999 : b.taxa))
    };
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   A RÉGUA DE PONTOS — o que te aprova, e não o que você sabe
   ───────────────────────────────────────────────────────────────────────────
   O Plano otimizava DOMÍNIO: a média do quanto você sabe do que estuda. Isso
   não é a mesma coisa que ponto na prova, e a diferença decide aprovação.

     Um assunto de 4 questões a 20% é uma cratera de domínio e quase nada de
     aprovação. Um de 40 questões a 70% é pouca lacuna de domínio e é onde os
     pontos estão. O Plano mandava você no primeiro.

   E a composição da prova JÁ ESTAVA NO APP: no editor de matérias do ciclo, no
   modo pós-edital, você digita quantas questões cada matéria tem, quanto vale
   cada uma e o peso. O Desempenho TEC nunca olhou para lá.

   POR QUE ISSO SÓ VALE DEPOIS DO EDITAL

   Sem edital não há composição, e a conta muda de natureza: você não está
   maximizando pontos conhecidos, está encolhendo o pior caso. Qualquer matéria
   pode virar a pesada, então 60% em tudo bate 90% em metade — que é
   exatamente o que "todo assunto pesa igual" já faz. Pré-edital o Plano está
   certo como está, e a régua NÃO troca: ele herda o modo do ciclo.

   O QUE REPROVA GENTE, E QUE NENHUMA OTIMIZAÇÃO ENXERGA

   Nota mínima por matéria. Uma matéria abaixo do mínimo elimina, e isso não é
   uma questão de peso — é restrição. Um plano pode te levar ao melhor total
   possível e você ser cortado numa matéria secundária. Por isso o mínimo vem
   ANTES dos pontos na ordem de prioridade, sempre.
   ═══════════════════════════════════════════════════════════════════════════ */
const PlanoPontos = {
  // pré ou pós-edital: o mesmo interruptor do ciclo, sem conceito novo
  modo() {
    try { return (typeof planCycleMode === 'function') ? planCycleMode() : 'pre'; }
    catch (e) { _quiet(e, 'pontos-modo'); return 'pre'; }
  },
  /* A composição declarada por matéria. Devolve só quem tem questões: uma
     matéria sem `qtdQuestoes` não entra na conta em vez de entrar valendo zero
     e diluir o total — zero calado é pior que ausência declarada. */
  composicao() {
    let subs = [];
    try { subs = DB.getActiveSubjects() || []; } catch (e) { _quiet(e, 'pontos-mat'); }
    /* Uma matéria fora do Plano sai TAMBÉM do denominador da prova. Deixá-la na
       composição manteria o peso dela na nota projetada e no corte — o número
       que mais decide — enquanto a lista e o domínio já a tinham descartado. */
    const fora = PlanoEngine.excluidasSet(PlanoEngine.prefs());
    const out = [];
    subs.forEach(s => {
      const q = parseFloat(s.qtdQuestoes) || 0;
      if (!(q > 0)) return;
      if (PlanoEngine.foraDoPlano(s.nome, fora)) return;
      const pts = parseFloat(s.pontosPorQuestao) || 1;
      const peso = parseFloat(s.peso) || 1;
      out.push({ nome: s.nome, q, pts, peso, valor: q * pts * peso,
        minimo: (s.minimoPct != null && s.minimoPct !== '') ? Math.max(0, Math.min(100, parseFloat(s.minimoPct) || 0)) : null });
    });
    return out;
  },
  temComposicao() { return this.modo() === 'pos' && this.composicao().length > 0; },
  /* NOTA PROJETADA: o que você faria se a prova fosse hoje, e o que faria se
     fechasse o Plano. A taxa de cada matéria sai da MESMA janela adaptativa da
     lista — não da média da vida inteira, que carrega o desempenho que a
     janela já descartou. */
  projecao(opts) {
    const comp = this.composicao();
    if (!comp.length) return null;
    const p = Object.assign({}, PlanoEngine.prefs(), opts || {});
    const teto = Math.max(50, Math.min(100, p.tetoDominio)) / 100;
    const idx = PlanoEngine.totalHistorico(p);
    const norm = (x) => ReforcoEngine.norm(x);
    // taxa da matéria: soma as folhas dela no histórico (uma questão, uma vez)
    const porMateria = {};
    Object.keys(idx).forEach(k => {
      const disc = k.split(ReforcoEngine.SEP)[0];
      const c = porMateria[disc] || { q: 0, ac: 0 };
      c.q += idx[k].q; c.ac += idx[k].ac; porMateria[disc] = c;
    });
    /* O EDITAL VOCÊ DIGITA; O HISTÓRICO VEM DA BANCA. Sem casar os dois, uma
       matéria cujo nome não bate exatamente cai em `semDado` e some da conta —
       e some para MENOS: a nota projetada fica menor do que a verdade, sem
       nenhum aviso de que faltou gente. É o mesmo casamento conservador do
       quadro de esforço, aplicado onde o erro custa mais caro. */
    const casado = this._casarNomes(comp.map(m => norm(m.nome)), Object.keys(porMateria));
    let valorTotal = 0, hoje = 0, potencial = 0, semDado = [];
    const linhas = comp.map(m => {
      const v = porMateria[casado[norm(m.nome)] || norm(m.nome)];
      const taxa = (v && v.q > 0) ? (v.ac / v.q * 100) : null;
      valorTotal += m.valor;
      if (taxa == null) { semDado.push(m.nome); return Object.assign({}, m, { taxa: null, medido: 0 }); }
      hoje += m.valor * taxa / 100;
      potencial += m.valor * Math.max(taxa / 100, teto);
      return Object.assign({}, m, { taxa, medido: v.q,
        abaixoDoMinimo: (m.minimo != null && taxa < m.minimo) });
    });
    const corte = this._corte();
    return {
      linhas, valorTotal,
      hoje: valorTotal > 0 ? hoje : 0,
      potencial: valorTotal > 0 ? potencial : 0,
      pctHoje: valorTotal > 0 ? hoje / valorTotal * 100 : 0,
      pctPotencial: valorTotal > 0 ? potencial / valorTotal * 100 : 0,
      semDado, corte,
      faltaCorte: corte != null ? Math.max(0, corte - hoje) : null,
      passaHoje: corte != null ? hoje >= corte : null,
      eliminatorias: linhas.filter(l => l.abaixoDoMinimo)
    };
  },
  _corte() {
    try {
      const v = localStorage.getItem(DB._profilePrefix() + 'plano-corte');
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    } catch (e) { _quiet(e, 'corte'); return null; }
  },
  setCorte(v) {
    const n = parseFloat(v);
    const k = DB._profilePrefix() + 'plano-corte';
    if (isNaN(n) || n <= 0) DB.delRaw(k); else DB.setRaw(k, String(n));
  },
  /* ── ONDE O SEU ESFORÇO ESTÁ INDO ────────────────────────────────────────
     A armadilha clássica de quem estuda muito: a gente estuda o que gosta, e
     gosta do que já sabe. Ninguém nunca confronta essa escolha com o que a
     prova cobra — e é uma troca que dá para fazer por dois anos sem perceber.

     ESTE QUADRO NÃO OLHA MAIS O RELÓGIO, E É DE PROPÓSITO. A primeira versão
     comparava os MINUTOS do ciclo com o peso da banca, e as duas pontas
     falavam línguas diferentes: o ciclo você digita ("Português"), a banca
     manda "Língua Portuguesa". Casar nome digitado com nome de banca é
     adivinhação, e adivinhação num quadro de decisão só tem dois desfechos —
     número torto ou matéria sumida. Aconteceu o segundo: a matéria mais pesada
     da prova desaparecia calada e sobravam oito linhas leves.

     A moeda passou a ser a QUESTÃO, a única que os dois lados já falam: o peso
     da banca é contado em questões e o seu esforço no TEC também. Não há nome
     de ciclo para casar, não há minuto para estimar, e a cobertura é de 100%
     dos dois lados por construção. Perde-se o minuto e ganha-se a verdade — e
     o minuto era declarado, enquanto a questão é medida.

     A QUESTÃO NÃO É UM SUBSTITUTO POBRE DO MINUTO. Uma hora de vídeo-aula não
     move nada aqui, e é correto que não mova: o que a prova paga é questão
     resolvida. Duas matérias podem custar minutos diferentes por questão, e
     por isso a coluna se chama "suas questões", não "seu tempo" — o quadro
     afirma só o que mediu.

     O QUE ELE NÃO FAZ: decidir por você. Aceitar ir mal numa matéria que vale
     cinco questões é estratégia legítima. O que não pode continuar é NÃO SABER
     que a troca está sendo feita. */
  esforcoPorMateria(opts) {
    const p = Object.assign({}, PlanoEngine.prefs(), opts || {});
    const norm = (x) => ReforcoEngine.norm(x);
    const SEP = ReforcoEngine.SEP;
    /* 1) O SEU ESFORÇO, MEDIDO: questões resolvidas por matéria. Uma passada
       só pelos retratos, montando de uma vez o índice por matéria de cada um —
       é dele que saem o total (a alocação) e a taxa por janela adaptativa (o
       nível). Indexar retrato por retrato dentro de um laço de matérias faria
       o mesmo trabalho dezenas de vezes. */
    const desc = [];
    const seu = Object.create(null);
    let seuTotal = 0;
    /* O quadro de esforço responde "para onde vai o meu tempo, e a prova paga
       por isso?". Uma matéria que a prova não cobra MAIS não pode aparecer nem
       como esforço desperdiçado nem como peso: ela saiu da pergunta. */
    const fora = PlanoEngine.excluidasSet(p);
    try {
      (DB.getTecSnapshots() || []).slice().reverse().forEach(s => {
        const idx = PlanoEngine._indice(s, p.apenasFolhas);
        const agg = Object.create(null);
        for (const k in idx) {
          const d = k.split(SEP)[0];
          if (PlanoEngine.foraDoPlano(idx[k].disciplina || d, fora)) continue;
          const c = agg[d] || (agg[d] = { q: 0, ac: 0 });
          c.q += idx[k].q; c.ac += idx[k].ac;
          const t = seu[d] || (seu[d] = { q: 0, ac: 0, nome: idx[k].disciplina || d });
          t.q += idx[k].q; t.ac += idx[k].ac; seuTotal += idx[k].q;
        }
        desc.push({ startDate: s.startDate, _idx: agg });
      });
    } catch (e) { _quiet(e, 'esforco-tec'); }
    // 2) o peso da prova: composição do edital (pós) ou incidência das bancas (pré)
    const peso = Object.create(null); const pesoNome = Object.create(null);
    let pesoTotal = 0; let fontePeso = null;
    /* `composicao()` NÃO OLHA O MODO — quem olha é `temComposicao()`. Usar a
       primeira aqui fazia um edital antigo, guardado de um concurso já
       encerrado, virar o peso da prova de um usuário que voltou ao pré-edital:
       a incidência da banca, que é o peso certo ali, nem era consultada. */
    const comp = PlanoPontos.temComposicao() ? PlanoPontos.composicao() : [];
    if (comp.length) {
      fontePeso = 'edital';
      comp.forEach(m => { const k = norm(m.nome); peso[k] = (peso[k] || 0) + m.valor; pesoNome[k] = m.nome; pesoTotal += m.valor; });
    } else {
      try {
        /* Pela RAIZ de cada disciplina, não pela soma das linhas: a incidência
           é uma árvore e somar pai com filho conta a mesma questão duas vezes
           — com o agravante de o erro depender de quão fundo cada tabela foi
           colada, e não do que a banca cobra. */
        const by = ReforcoEngine.incidPorDisciplina(DesempenhoTecScreen.bancaFiltro());
        Object.keys(by).forEach(d => {
          const soma = by[d];
          if (PlanoEngine.foraDoPlano(d, fora)) return;
          if (soma > 0) { const k = norm(d); peso[k] = (peso[k] || 0) + soma; pesoNome[k] = d; pesoTotal += soma; fontePeso = 'incidencia'; }
        });
      } catch (e) { _quiet(e, 'esforco-peso'); }
    }
    /* 3) SOBROU UM NOME PARA CASAR, E SÓ UM. A incidência e o TEC vêm da mesma
       fonte, então já batem. O EDITAL, não: aquelas matérias você digitou na
       tela do ciclo. Casamos o edital com o TEC — de forma conservadora, e sem
       nunca inventar — porque aqui o erro custa caro: uma matéria do edital que
       não acha o histórico dela some da nota projetada, não só deste quadro. */
    const casado = this._casarNomes(Object.keys(peso), Object.keys(seu));
    Object.keys(casado).forEach(de => {
      const para = casado[de];
      if (de === para || peso[de] == null) return;
      peso[para] = (peso[para] || 0) + peso[de];
      if (!pesoNome[para]) pesoNome[para] = pesoNome[de];
      delete peso[de]; delete pesoNome[de];
    });
    /* 4) UMA LINHA POR MATÉRIA, E TODAS ELAS. A união das duas pontas: o que
       você resolveu e o que a prova cobra. Nada é descartado por não ter par —
       "peso alto e zero questão" é justamente o alarme que interessa. */
    const chaves = [...new Set([].concat(Object.keys(seu), Object.keys(peso)))];
    const tetoPct = Math.max(50, Math.min(100, p.tetoDominio));
    const acTotal = Object.keys(seu).reduce((a, k) => a + seu[k].ac, 0);
    const taxaGeral = seuTotal > 0 ? acTotal / seuTotal * 100 : null;
    const linhas = chaves.map(k => {
      const s = seu[k];
      const q = s ? s.q : 0;
      const shareEsforco = seuTotal > 0 ? q / seuTotal * 100 : (q > 0 ? 100 : 0);
      const sharePeso = pesoTotal > 0 ? (peso[k] || 0) / pesoTotal * 100 : null;
      /* O NÍVEL VEM DA JANELA ADAPTATIVA, NÃO DA MÉDIA DA VIDA. Quem consertou
         Contabilidade há três meses continuaria aparecendo como fraco nela: a
         média da vida inteira mente sempre na direção do passado. */
      let taxa = null, medido = 0;
      if (q > 0) {
        const a = PlanoEngine._taxaAdaptativa(k, desc, p);
        if (a) { medido = a.q; if (a.q >= (p.minAmostra || 20)) taxa = a.pct; }
      }
      /* ── PONTOS EM JOGO: O PRÊMIO, NA UNIDADE DA PROVA ──────────────────
         O peso da matéria vezes a lacuna que falta até o máximo realista. É
         quanto da prova você recupera levando ESTA matéria ao teto, e é a
         única pergunta que a decisão "onde ponho a próxima hora" responde.

         A razão esforço/peso, sozinha, respondia outra pergunta — "estou
         distribuindo bem?" — e as duas divergem com frequência: uma matéria
         que vale 12% da prova e onde você acerta 58% aparecia como
         "equilibrada" (verde, nada a fazer) enquanto tinha 3,9pp em jogo, e
         outra de 5% de peso a 84% de acerto aparecia como problema com 0,5pp
         em jogo. Verde na segunda maior oportunidade da prova é pior que não
         dizer nada.

         Quem nunca resolveu uma questão da matéria não tem lacuna medida: o
         prêmio é ESTIMADO pela sua média geral, e a linha diz isso. Estimar é
         melhor que omitir — omitir mandaria a matéria mais pesada da prova
         para o fim da fila só por falta de dado. */
      /* Sem medição da matéria, o prêmio sai da sua média geral; sem retrato
         nenhum ainda, de uma moeda ao alto (50%). O número é grosseiro nesse
         caso, mas a ORDEM não é: com um prior constante o ranking vira o peso
         puro, que é exatamente a prioridade certa para quem ainda não mediu
         nada. Zerar o prêmio, que era a alternativa, mandava a matéria mais
         pesada da prova para o fim da fila por falta de dado. */
      const base = taxa != null ? taxa : (taxaGeral != null ? taxaGeral : 50);
      const ganho = (sharePeso != null && sharePeso > 0)
        ? sharePeso * Math.max(0, tetoPct - base) / 100 : 0;
      return { chave: k, nome: (s && s.nome) || pesoNome[k] || k,
        q, shareEsforco, sharePeso, taxa, medido, ganho,
        estimado: taxa == null && sharePeso > 0,
        razao: (sharePeso > 0 && q > 0) ? shareEsforco / sharePeso : null };
    });
    // A ORDEM É O PRÊMIO. Peso desempata; quem não tem peso vai para o fim.
    linhas.sort((a, b) => b.ganho - a.ganho || (b.sharePeso || 0) - (a.sharePeso || 0) || b.shareEsforco - a.shareEsforco);
    /* ── O CORTE DE PARETO ──────────────────────────────────────────────────
       "Dezesseis matérias desalinhadas" não é um guia: é ruído com número. O
       corte responde a pergunta certa — QUAIS matérias concentram METADE de
       tudo que ainda dá para recuperar. Tipicamente três ou quatro, e é nelas
       que a próxima hora rende mais. O corte é relativo ao próprio aluno, não
       a um limiar fixo: quem já está perto do teto em tudo recebe uma lista
       curta porque sobrou pouco, e não porque baixamos a régua. */
    const emJogo = linhas.reduce((a, l) => a + l.ganho, 0);
    let acum = 0, nCorte = 0;
    linhas.forEach(l => {
      const antes = acum;
      acum += l.ganho;
      l.noCorte = l.ganho > 0 && antes < emJogo * this.CORTE_PARETO;
      /* A SEGUNDA BANDA EXISTE PARA NÃO MENTIR PARA BAIXO. Sem ela, a quarta
         maior oportunidade da prova — ainda com quase 2pp em jogo — recebia
         "mantenha: pouco a ganhar aqui", que é falso. Ela não é para atacar
         agora, mas é a próxima da fila, e dizer isso é diferente de dizer que
         não há nada ali. */
      l.naFila = l.ganho > 0 && !l.noCorte && antes < emJogo * this.FILA_PARETO;
      if (l.noCorte) nCorte++;
    });
    /* ── E SÓ AGORA A AÇÃO ──────────────────────────────────────────────────
       Cada veredito é um verbo, não um diagnóstico: a tela existe para dizer o
       que fazer amanhã de manhã. "Desalinhada" descrevia um estado e deixava a
       tradução para o aluno — que foi exatamente onde ele se perdeu. */
    linhas.forEach(l => {
      if (l.sharePeso == null || l.sharePeso <= 0) { l.veredito = l.q > 0 ? 'foraDoPeso' : null; return; }
      l.sobra = l.razao != null && l.razao >= this.SOBRA_RAZAO;
      if (l.q <= 0) { l.veredito = 'comecar'; return; }
      if (l.noCorte) { l.veredito = 'atacar'; return; }
      /* Fora do corte, o esforço desproporcional vira a informação principal:
         você gasta muito onde já não sobrou prêmio. É o único "pare" da tela. */
      if (l.naFila) { l.veredito = 'fila'; return; }
      /* O ESFORÇO DESPROPORCIONAL SÓ VIRA VERBO QUANDO NÃO HÁ MAIS PRÊMIO.
         Quando ele competia com o prêmio, a segunda maior oportunidade da
         prova — 3,9pp em jogo, acerto em 50% — recebia "reduza: sobrou pouco
         a ganhar", que é o oposto da verdade. Fora das duas bandas, aí sim
         gastar muito é o fato principal; dentro delas, a desproporção vira
         ANOTAÇÃO na linha (`sobra`), que aparece junto de qualquer veredito e
         diz outra coisa: o que você já faz aqui não está rendendo. */
      /* "REDUZA" SÓ ONDE HÁ O QUE REDUZIR. A razão sozinha mandava cortar uma
         matéria que leva 1% do seu esforço para 0,6% da prova: proporcionalmente
         é desperdício, na prática não libera nada e só gasta a atenção do
         aluno num conselho que ele não tem como executar. Abaixo do piso de
         esforço a linha volta a ser o que é — pouco prêmio, pouca urgência. */
      if (l.razao != null && l.razao >= this.SOBRA_RAZAO && l.shareEsforco >= this.SOBRA_MIN_ESFORCO) { l.veredito = 'reduzir'; return; }
      /* "Vai mal" é abaixo da faixa frágil, não abaixo da meta. Com a meta em
         85, quem acerta 84% ouvia "você vai mal" — e perdia a confiança na
         tela inteira por causa de um ponto percentual. */
      l.veredito = (l.taxa != null && l.taxa < p.faixaFragil) ? 'depois' : 'manter';
    });
    /* ── QUEM MERECE UMA LINHA SÓ SUA ──────────────────────────────────────
       Cobrir tudo é obrigação; virar parede não. Uma banca com trinta
       disciplinas produzia vinte linhas de "0% · 0 questões" que empurravam a
       decisão de verdade para fora da tela.

       Dois resumos, cada um com um motivo diferente:
       · MIÚDA (abaixo de 1% dos dois lados) é rodapé puro.
       · NÃO COMEÇADA pequena (nunca resolvida, abaixo de 5% da prova) some da
         lista mas mostra a SOMA: uma sozinha não decide nada; nove somando
         18% da prova decidem. */
    linhas.forEach(l => {
      const miuda = (l.sharePeso == null || l.sharePeso < this.MIUDA_PCT) && l.shareEsforco < this.MIUDA_PCT;
      l.miuda = miuda;
      l.resumo = miuda ? 'miuda'
        : (l.veredito === 'comecar' && (l.sharePeso || 0) < this.INTOCADA_PCT) ? 'comecar' : null;
    });
    return { linhas, seuTotal, pesoTotal, fontePeso, teto: tetoPct, taxaGeral,
      emJogo, nCorte,
      // quantas linhas pedem ação e APARECEM: a manchete não pode mandar
      // procurar uma linha que o resumo escondeu
      acoes: linhas.filter(l => !l.resumo && (l.veredito === 'atacar' || l.veredito === 'comecar')).length };
  },
  CORTE_PARETO: 0.5,
  FILA_PARETO: 0.8,
  SOBRA_RAZAO: 1.6,
  SOBRA_MIN_ESFORCO: 3,
  MIUDA_PCT: 1,
  INTOCADA_PCT: 5,
  /* CASA "PORTUGUÊS" COM "LÍNGUA PORTUGUESA" SEM INVENTAR. Duas regras, as duas
     conservadoras: igualdade exata vence sempre; na falta dela, os tokens
     significativos de um nome precisam ser subconjunto dos do outro E o
     candidato precisa ser ÚNICO. "Contabilidade Geral" nunca vira
     "Contabilidade de Custos" — nenhum é subconjunto do outro. "Direito"
     sozinho não casa com nada, porque casaria com quatro. Ambiguidade não vira
     palpite: fica de fora, e o quadro denuncia a sobra em vez de escondê-la
     dentro da linha errada. */
  _casarNomes(chavesA, chavesB) {
    const VAZIAS = ' de do da dos das e em no na nos nas para com a o as os ';
    /* "Português" e "Língua Portuguesa" são a mesma matéria e não têm um token
       igual: o gênero muda a palavra. Cortamos plural e desinência de gênero
       (no máximo duas letras, e nunca abaixo de quatro caracteres, para "atos"
       não virar "at" e casar com meio mundo). */
    const raiz = (t) => {
      let r = t;
      for (let i = 0; i < 2; i++) {
        if (r.length > 4 && /[aos]$/.test(r)) r = r.slice(0, -1); else break;
      }
      return r;
    };
    const toks = (k) => String(k).split(' ').filter(t => t && VAZIAS.indexOf(' ' + t + ' ') < 0).map(raiz);
    const setB = Object.create(null);
    chavesB.forEach(k => { setB[k] = toks(k); });
    const nomesB = Object.keys(setB);
    const out = Object.create(null);
    chavesA.forEach(a => {
      if (setB[a]) { out[a] = a; return; }                     // igualdade exata
      const ta = toks(a);
      if (!ta.length) return;
      const cands = nomesB.filter(b => {
        const tb = setB[b];
        if (!tb.length) return false;
        const curto = ta.length <= tb.length ? ta : tb;
        const longo = ta.length <= tb.length ? tb : ta;
        return curto.every(t => longo.indexOf(t) >= 0);
      });
      if (cands.length === 1) { out[a] = cands[0]; return; }
      if (cands.length) return;                                // ambíguo: não chuta
      /* 3ª REGRA — A ABREVIATURA. "Dir Adm" e "Direito Administrativo" não têm
         token em comum nem um é subconjunto do outro, e é como metade dos
         editais é digitada. Casamos só quando a forma é inequívoca: MESMA
         quantidade de palavras e cada palavra de um lado prefixo da palavra
         correspondente do outro, na ordem, com pelo menos três letras. Assim
         "Dir Adm"→"Direito Administrativo" passa e "Cont"→"Contabilidade
         Geral" não (uma palavra contra duas), e a unicidade continua valendo:
         "Dir" sozinho encontraria quatro e não casa com nenhuma. */
      const abrev = nomesB.filter(b => {
        const tb = setB[b];
        if (tb.length !== ta.length) return false;
        return ta.every((t, i) => {
          const u = tb[i];
          const [c, g] = t.length <= u.length ? [t, u] : [u, t];
          return c.length >= 3 && g.indexOf(c) === 0;
        });
      });
      if (abrev.length === 1) out[a] = abrev[0];
    });
    return out;
  },
  /* A DIFICULDADE DECLARADA VIRA MEDIDA. O ciclo pede um chute de 1 a 5 e
     distribui as suas horas por ele. O TEC sabe a resposta: 48% de acerto é
     difícil, 85% não é. Devolvemos a nota medida na mesma escala, para a tela
     poder mostrar as duas lado a lado — quem discorda continua discordando,
     mas de um número. */
  dificuldadeMedida(nomeMateria, opts) {
    const p = Object.assign({}, PlanoEngine.prefs(), opts || {});
    const idx = PlanoEngine.totalHistorico(p);
    const discs = [...new Set(Object.keys(idx).map(k => k.split(ReforcoEngine.SEP)[0]))];
    // o nome vem do ciclo, digitado; as disciplinas vêm da banca. Casa antes de somar.
    const alvo = this._casarNomes([ReforcoEngine.norm(nomeMateria || '')], discs)[ReforcoEngine.norm(nomeMateria || '')]
      || ReforcoEngine.norm(nomeMateria || '');
    let q = 0, ac = 0;
    Object.keys(idx).forEach(k => {
      if (k.split(ReforcoEngine.SEP)[0] !== alvo) return;
      q += idx[k].q; ac += idx[k].ac;
    });
    if (q < (p.minAmostra || 20)) return null;      // amostra curta não vira nota
    const taxa = ac / q * 100;
    // 5 = mais difícil. Faixas coladas nas do próprio Plano, para a escala não
    // significar uma coisa aqui e outra na lista.
    const nota = taxa < p.faixaCritico ? 5 : taxa < p.faixaFragil ? 4 : taxa < p.metaDominio ? 3 : taxa < 92 ? 2 : 1;
    return { taxa, q, nota };
  },
  /* "SÓLIDO" CORTA O PESO DA MATÉRIA PARA 20% — é a decisão mais cara do
     ciclo, e hoje é um clique sem prova. O Plano sabe quantos assuntos daquela
     matéria sustentam a meta. */
  solidezDe(nomeMateria, r) {
    if (!r || r.erro) return null;
    const base = [].concat(r.itens || [], r.pequenas || []);
    const alvoBruto = ReforcoEngine.norm(nomeMateria || '');
    const discs = [...new Set(base.map(x => ReforcoEngine.norm(x.disciplina || '')).filter(Boolean))];
    const alvo = this._casarNomes([alvoBruto], discs)[alvoBruto] || alvoBruto;
    const todos = base.filter(x => ReforcoEngine.norm(x.disciplina || '') === alvo);
    if (!todos.length) return null;
    const naMeta = todos.filter(x => x.taxa >= r.meta).length;
    return { total: todos.length, naMeta, abaixo: todos.length - naMeta };
  },
  /* QUANTO VALE, EM PONTOS, LEVAR UM ASSUNTO AO TETO. É a régua que substitui
     o ganho em domínio depois do edital.

       pontos = (questões da MATÉRIA na prova × pts × peso)
              × (participação do ASSUNTO dentro da matéria)
              × (teto − taxa do assunto)

     A participação vem da incidência da banca quando ela existe; sem ela, do
     seu próprio volume praticado — declarado na tela, porque é um proxy, não
     uma medida. */
  anexarPontos(r, opts) {
    if (!r || !r.itens || !this.temComposicao()) return false;
    const p = Object.assign({}, PlanoEngine.prefs(), opts || {});
    const comp = this.composicao();
    const porNome = {};
    comp.forEach(m => { porNome[ReforcoEngine.norm(m.nome)] = m; });
    const teto = Math.max(50, Math.min(100, p.tetoDominio)) / 100;
    const todos = [].concat(r.itens, r.pequenas || []);
    // participação de cada assunto dentro da sua matéria
    const somaDisc = {};
    todos.forEach(x => {
      const k = ReforcoEngine.norm(x.disciplina || '');
      const w = (x.incid > 0) ? x.incid : (x.qJanela || 0);
      somaDisc[k] = (somaDisc[k] || 0) + w;
    });
    todos.forEach(x => {
      const k = ReforcoEngine.norm(x.disciplina || '');
      const m = porNome[k];
      if (!m) { x.pontosGanho = 0; x.pontosMateria = null; return; }
      const w = (x.incid > 0) ? x.incid : (x.qJanela || 0);
      const parte = somaDisc[k] > 0 ? w / somaDisc[k] : 0;
      x.pontosMateria = m.valor;
      x.viaVolume = !(x.incid > 0);
      x.pontosGanho = Math.max(0, m.valor * parte * Math.max(0, teto - x.taxa / 100));
      x.pontosPorQuestao = x.custoQ > 0 ? x.pontosGanho / x.custoQ * 100 : 0;
      x.eliminatoria = !!(m.minimo != null && x.taxa < m.minimo);
    });
    return true;
  }
};
window.PlanoPontos = PlanoPontos;

/* ═══════════════════════════════════════════════════════════════════════════
   O CICLO DE UMA ATIVIDADE DO PLANO — decidi · fiz · funcionou?
   ───────────────────────────────────────────────────────────────────────────
   O app media tudo e não fechava nada. Você criava a atividade a partir do
   Plano e, dali em diante, ela perdia contato com o dado que a gerou:

   · o PROGRESSO só andava se você digitasse. Resolver 150 questões no TEC e
     importar o retrato deixava a barra em 0/120 — contabilidade dobrada, feita
     duas vezes pela mesma pessoa sobre o mesmo fato.
   · o DESFECHO não existia. O assunto subia de 40% para 95%, saía da lista do
     Plano, e a atividade continuava aberta como pendência de hoje, amanhã e
     sempre. O app sabia que tinha acabado e não dizia.
   · e o caso mais valioso não era medido em lugar nenhum: você cumpriu as 120
     questões e a taxa NÃO subiu. Isso não é fracasso da pessoa, é diagnóstico:
     volume não resolve aquele assunto, o buraco é de teoria. Nenhum ranking
     ensina isso; só o ciclo fechado ensina.

   AS TRÊS DEFINIÇÕES QUE SUSTENTAM O RESTO

   1. PROGRESSO = quantas questões daquele assunto entraram nos seus retratos
      DESDE a criação. Guardamos `qBase` (o total histórico no instante em que
      a atividade nasceu) e comparamos com o total de hoje. É exato mesmo
      quando um retrato atravessa a data de criação — datas não entram na
      conta, só o contador do assunto. E vale `max(digitado, medido)`: importar
      só empurra a barra para cima, nunca apaga o que você lançou na mão.
   2. A META É A DO DIA DA CRIAÇÃO (`metaAlvo`). Mudar a meta do Plano depois
      não pode reescrever o veredito de uma atividade que já estava correndo:
      seria mover a trave e declarar gol.
   3. A ATIVIDADE ACABA QUANDO O SEU OBJETIVO É ATINGIDO **OU** QUANDO O SEU
      TRABALHO É CUMPRIDO. São dois fins legítimos, e o veredito diz qual foi.
      Fechar só no primeiro deixaria aberta para sempre a atividade que falhou;
      fechar só no segundo ignoraria quem chegou lá com menos questões que a
      estimativa.
   ═══════════════════════════════════════════════════════════════════════════ */
const PlanoCiclo = {
  /* Campos que a atividade carrega do Plano. `criar` é o ÚNICO lugar que os
     monta — os dois portões (a lista do Plano e o "Puxar do Plano" da tela de
     Atividades) passam por aqui, e por isso não podem mais divergir: um deles
     gravava `taxaInicial` e o outro não, e metade das atividades nascia cega. */
  origem(topico, disciplina, item, opts) {
    const p = Object.assign({}, PlanoEngine.prefs(), opts || {});
    return {
      topico, disciplina: disciplina || '',
      motivo: (opts && opts.motivo) || 'reforco',
      criadoEm: todayLocal(),
      taxaInicial: (item && item.taxa != null) ? item.taxa : null,
      // o contador do assunto no instante zero: é a régua do progresso
      qBase: PlanoEngine.qHistDe(disciplina, topico, p),
      metaAlvo: p.metaDominio,
      custoEstimado: (item && item.custoQ) || null,
      tetoAlvo: p.tetoDominio
    };
  },
  /* O retrato de uma atividade AGORA. Não grava nada: quem decide escrever é
     `conciliar`. Separar as duas coisas é o que deixa a tela desenhar o estado
     a cada repintura sem efeito colateral nenhum. */
  avaliar(extra, r, mapa) {
    const o = extra && extra.origemPlano;
    if (!o || !o.topico) return null;
    const p = PlanoEngine.prefs();
    const alvo = Math.max(1, extra.alvo || o.custoEstimado || 1);
    const qAgora = PlanoEngine.qHistDe(o.disciplina, o.topico, Object.assign({}, p, { _mapa: mapa }));
    const medido = (o.qBase != null) ? Math.max(0, qAgora - o.qBase) : 0;
    const manual = DB.extraProgressoPeriodo ? DB.extraProgressoPeriodo(extra) : (extra.progresso || 0);
    const feito = Math.max(manual, medido);
    // o assunto, como o Plano o vê hoje
    const linhas = [].concat((r && r.itens) || [], (r && r.pequenas) || []);
    const at = linhas.find(x => DesempenhoTecScreen._casaTopico({ topico: x.nome, disciplina: x.disciplina }, o.topico, o.disciplina));
    /* Sumiu da lista do Plano por dois motivos OPOSTOS: ou passou do teto (foi
       resolvido) ou o assunto sumiu do TEC. `qAgora` desempata: sem questão
       nenhuma no histórico, não é vitória — é um assunto que não existe mais. */
    const orfa = qAgora === 0;
    /* A taxa vem SEMPRE da janela adaptativa, esteja o assunto na lista ou
       não. Ler `at.taxa` quando ele está e a média histórica quando não está
       eram duas réguas para a mesma pergunta — e a segunda reprovava assunto
       resolvido, porque carrega o desempenho velho que a janela já descartou. */
    const taxa = orfa ? null : PlanoEngine.taxaAtualDe(o.disciplina, o.topico, p);
    const meta = (o.metaAlvo != null) ? o.metaAlvo : p.metaDominio;
    const delta = (taxa != null && o.taxaInicial != null) ? Math.round((taxa - o.taxaInicial) * 10) / 10 : null;
    const cumpriu = feito >= alvo;
    const bateu = (taxa != null) && (taxa >= meta);
    let estado = 'andamento';
    if (orfa) estado = 'orfa';
    else if (bateu) estado = 'funcionou';
    else if (cumpriu) estado = (delta != null && delta >= (p.sensTendencia || 3)) ? 'subiu' : 'naoFuncionou';
    return {
      extra, origem: o, alvo, feito, medido, manual, qAgora,
      pct: Math.min(100, Math.round(feito / alvo * 100)),
      taxa, meta, delta, cumpriu, bateu, estado,
      // o custo que o Plano estimaria HOJE — sem alarde, só o número ao lado
      custoHoje: at ? at.custoQ : null,
      encerrada: extra.status === 'concluida'
    };
  },
  /* ── A CONCILIAÇÃO ────────────────────────────────────────────────────────
     Roda depois de cada importação. Fecha o que acabou e carimba o veredito na
     própria atividade — é dele que sai, mais tarde, a calibragem.

     Idempotente de propósito: chamar duas vezes no mesmo retrato não fecha
     nada duas vezes nem reescreve um veredito. */
  conciliar() {
    const snaps = DB.getTecSnapshots();
    if (!snaps.length) return { fechadas: [], vereditos: [] };
    const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
    if (!r || r.erro) return { fechadas: [], vereditos: [] };
    const mapa = PlanoEngine.totalHistorico();
    const ultimo = snaps[snaps.length - 1];
    const fechadas = [], vereditos = [];
    DB.getExtras().forEach(e => {
      if (!e.origemPlano || !e.origemPlano.topico) return;
      if (e.status === 'concluida' || e.origemPlano.veredito) return;
      const v = this.avaliar(e, r, mapa);
      if (!v || (v.estado !== 'funcionou' && v.estado !== 'naoFuncionou')) return;
      const veredito = {
        tipo: v.estado, em: todayLocal(), retrato: ultimo.id,
        taxaInicial: v.origem.taxaInicial, taxaFinal: v.taxa,
        ganhoPP: v.delta, questoes: v.feito, alvo: v.alvo
      };
      DB.updateExtra(e.id, { status: 'concluida', origemPlano: Object.assign({}, e.origemPlano, { veredito }) });
      fechadas.push(e.id); vereditos.push(veredito);
    });
    return { fechadas, vereditos };
  },
  // as atividades do Plano ainda abertas, já avaliadas
  emCurso(r) {
    const mapa = PlanoEngine.totalHistorico();
    return DB.getExtras()
      .filter(e => e.origemPlano && e.origemPlano.topico && e.status !== 'concluida')
      .map(e => this.avaliar(e, r, mapa))
      .filter(Boolean)
      .sort((a, b) => b.pct - a.pct || (a.taxa == null ? 999 : a.taxa) - (b.taxa == null ? 999 : b.taxa));
  },
  // os ciclos já fechados, do mais novo para o mais velho
  fechados() {
    return DB.getExtras()
      .filter(e => e.origemPlano && e.origemPlano.veredito)
      .map(e => Object.assign({ titulo: e.titulo, disciplina: e.origemPlano.disciplina, topico: e.origemPlano.topico }, e.origemPlano.veredito))
      .sort((a, b) => String(b.em).localeCompare(String(a.em)));
  },
  /* ── O APP APRENDE COM VOCÊ ───────────────────────────────────────────────
     O custo de um assunto no Plano é um palpite de fábrica: piso de 50
     questões mais 2 por ponto de lacuna. Depois de alguns ciclos fechados, o
     seu histórico responde a mesma pergunta com o SEU dado: quantos pontos
     percentuais 100 questões rendem, em média, quando você ataca um assunto.

     Com isso o Plano deixa de estimar e passa a saber — e o "caminho mais
     curto" passa a ser curto para você, não para um estudante médio que não
     existe. Três ciclos é o mínimo para a média não ser uma anedota. */
  MIN_CICLOS: 3,
  calibragem() {
    const uteis = this.fechados().filter(v => v.questoes > 0 && v.ganhoPP != null);
    if (uteis.length < this.MIN_CICLOS) return { n: uteis.length, faltam: this.MIN_CICLOS - uteis.length, pronta: false };
    const qTotal = uteis.reduce((a, v) => a + v.questoes, 0);
    const ppTotal = uteis.reduce((a, v) => a + v.ganhoPP, 0);
    if (!(qTotal > 0) || !(ppTotal > 0)) return { n: uteis.length, pronta: false, semGanho: true };
    const ppPorCem = ppTotal / qTotal * 100;
    // o inverso é exatamente a unidade do ajuste "questões por ponto de lacuna"
    const qPorPonto = Math.round(100 / ppPorCem * 10) / 10;
    const atual = PlanoEngine.prefs().custoPorPonto;
    return {
      n: uteis.length, pronta: true,
      ppPorCem: Math.round(ppPorCem * 10) / 10,
      qPorPonto: Math.max(0.5, Math.min(20, qPorPonto)),
      atual, divergente: Math.abs(qPorPonto - atual) >= 1,
      funcionaram: uteis.filter(v => v.tipo === 'funcionou').length
    };
  }
};
window.PlanoCiclo = PlanoCiclo;

/* ═══════════════════════════════════════════════════════════════════════════
   AJUSTES DO DESEMPENHO TEC — a folha suspensa
   ───────────────────────────────────────────────────────────────────────────
   As três abas com configuração tinham a mesma doença: os campos ficavam
   ABERTOS na tela, esperando um clique raro. No Plano eram sete visíveis mais
   dezenove avançados — 2.413px de formulário antes do primeiro número num
   celular de 390px, com rótulos espremidos em duas colunas e quatro grupos
   caindo em cascata. A tela abria em configuração, não em resultado.

   Agora cada aba mostra UMA linha: o que está valendo, escrito por extenso, e
   um botão que abre esta folha. Dentro dela os mesmos campos, com os MESMOS
   ids — nada foi duplicado nem reescrito, as telas seguem lendo `plano-meta`,
   `reforco-minq`, `tec-weak-minq` de onde sempre leram.

   O que a folha acrescenta, e que uma pilha de acordeões não dá:

   · UMA SEÇÃO POR VEZ, escolhida numa fita de chips. Nada cascateia.
   · O QUE ESTÁ VALENDO fica legível sem abrir nada, na própria tela.
   · UM PONTO no chip da seção que você personalizou — dá para ver de relance
     onde você saiu do padrão, em vez de conferir campo a campo.
   · APLICA AO VIVO. Mexeu, a tela atrás já mudou; "Concluir" só fecha. Não há
     estado provisório para perder, nem "salvar" que se pode esquecer.
   ═══════════════════════════════════════════════════════════════════════════ */
const TecAjustes = {
  aba: null,
  secao: null,
  _secoes(aba) {
    return [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="' + aba + '"]')];
  },
  TITULOS: {
    plano: { t: '🏁 Ajustes do Plano', s: 'O que a fila otimiza e em que dado ela confia.' },
    reforco: { t: '🎯 Ajustes do Reforço', s: 'Como a banca e o seu erro se cruzam para formar o ranking.' },
    analise: { t: '📊 Ajustes da Análise', s: 'O corte que define a lista de pontos fracos.' }
  },
  /* Padrão de fábrica de cada seção: é com isto que o ponto no chip sabe se
     você mexeu ali. Ler os defaults do motor (e não uma cópia) é o que impede
     o ponto de mentir quando um padrão mudar. */
  PADROES: {
    plano: () => Object.assign({}, PlanoEngine.DEFAULTS),
    reforco: () => ({ estrat: 50, gran: 50, minq: 10, limite: null, disc: '__todas__',
      reforcoView: 'global', reforcoOrdenar: 'oportunidade' }),
    analise: () => ({ weakOrdenar: 'taxa', weakDisc: '__todas__', weakLimiar: null, weakMinQ: 10, weakLeaves: true })
  },
  abrir(aba) {
    const modal = document.getElementById('tec-cfg-modal');
    if (!modal || !this.TITULOS[aba]) return;
    this.aba = aba;
    const secs = this._secoes(aba);
    if (!secs.length) return;
    document.getElementById('tec-cfg-title').textContent = this.TITULOS[aba].t;
    document.getElementById('tec-cfg-sub').textContent = this.TITULOS[aba].s;
    // a fita de seções nasce do próprio DOM: seção nova aparece sozinha aqui
    const nav = document.getElementById('tec-cfg-nav');
    nav.innerHTML = secs.map(sec => `<button type="button" role="tab" data-sec="${escapeHtml(sec.dataset.sec)}">` +
      `<span aria-hidden="true">${escapeHtml(sec.dataset.ic || '')}</span>${escapeHtml(sec.dataset.rot || '')}</button>`).join('');
    this.mostrar(secs[0].dataset.sec);
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    this.aplicarCondicionais();
    this.marcarPersonalizadas();
    this.estabilizarAltura();
    /* O foco cai no chip da seção, não no ✕. Abrir um painel de ajustes com o
       anel de foco no botão de FECHAR é dizer, na primeira coisa que se vê,
       que a saída é o mais importante da tela. */
    setTimeout(() => {
      const at = document.querySelector('#tec-cfg-nav button.is-active');
      if (at) { try { at.focus(); } catch (e) { _quiet(e, 'cfg-foco'); } }
    }, 80);
  },
  /* ── O ARQUIVO SE AUTO-CONFERE, E A TELA MOSTRA O VEREDITO ───────────────
     A exportação rodava as invariantes sobre os dados reais e escondia o
     resultado dentro do .json: quem exportava não tinha como saber que o
     próprio arquivo havia reprovado uma conferência. Agora o painel lista as
     que falharam (e diz quantas passaram), porque é por elas que qualquer
     análise séria começa. */
  pintarInvariantes(a) {
    const host = document.getElementById('plano-aud-inv');
    if (!host) return;
    const inv = (a && a.invariantes) || [];
    if (!inv.length) { host.innerHTML = '<p class="pl-ciclo-obs">Exporte para ver a conferência.</p>'; return; }
    const falhas = inv.filter(i => !i.ok);
    const na = inv.filter(i => i.aplicavel === false);
    const okN = inv.length - falhas.length - na.length;
    host.innerHTML = `
      <p class="pl-aud-inv-top ${falhas.length ? 'tone-bad' : 'tone-good'}">
        ${falhas.length ? '⚠ ' + falhas.length + ' conferência(s) reprovada(s)' : '✓ as ' + okN + ' conferências aplicáveis passaram'}
        ${na.length ? ' · ' + na.length + ' não se aplica(m) a este retrato' : ''}
      </p>
      ${falhas.map(i => `<p class="pl-ciclo-obs tone-bad">✗ ${escapeHtml(i.nome)}${i.detalhe ? ' — ' + escapeHtml(JSON.stringify(i.detalhe)) : ''}</p>`).join('')}
      ${na.map(i => `<p class="pl-ciclo-obs">— ${escapeHtml(i.nome)}: ${escapeHtml((i.detalhe && i.detalhe.porque) || 'não se aplica')}</p>`).join('')}`;
  },
  /* ── A FITA NÃO PODE FUGIR DO DEDO ───────────────────────────────────────
     No celular a folha é ancorada embaixo: a base fica presa na borda da tela
     e é o TOPO que se move quando o conteúdo muda de tamanho. Trocar de seção
     mexia 219px no topo — e a fita de chips, que é justamente o que se está
     tocando, subia ou descia junto. Você mira em "Régua" e o botão sai do
     lugar entre o toque e o dedo chegar.

     A altura passa a ser a da MAIOR seção da aba, não a da seção aberta. Assim
     a caixa não muda de tamanho ao navegar: cabeçalho, fita e pé ficam
     exatamente onde estavam, e o que varia é só o espaço vago abaixo do último
     campo — que ninguém percebe, ao contrário de um painel que pula.

     A medida é feita mostrando cada seção por vez e lendo a altura: cinco
     leituras, tudo dentro do mesmo quadro, então nada pisca. Só a maior aba
     (o Plano, com cinco seções) chega a cinco. */
  estabilizarAltura() {
    const body = document.getElementById('tec-cfg-body');
    if (!body || !this.aba) return;
    const secs = this._secoes(this.aba);
    if (!secs.length) return;
    const antes = secs.map(s => s.hidden);
    body.style.minHeight = '';
    /* ── O TETO NÃO SE CALCULA: MEDE-SE ─────────────────────────────────────
       A versão anterior estimava o teto do corpo como "92vh" — a altura da
       CAIXA INTEIRA. Só que o corpo é uma das quatro faixas dela (cabeçalho,
       fita de seções, corpo e pé): pedir 92vh só para o corpo pedia mais do que
       a caixa tem, e um `min-height` não encolhe. O excedente saía dos vizinhos
       — a fita perdia altura e o pé ia para fora do recorte. No celular era
       exatamente isso que se via: os chips das seções cortados e o "Concluir"
       fora da tela.

       Descontar o cromo à mão também não serve: sobra a conta das bordas e do
       arredondamento, e foi ela que deixou a folha pulando 2px. O que este laço
       lê agora é a altura REAL que o corpo recebe com cada seção aberta — já
       clampada pela própria caixa. A maior dessas alturas é, ao mesmo tempo, a
       altura da maior seção (quando ela cabe) e o espaço disponível (quando não
       cabe). É o número exato, sem nenhuma conta nossa para errar.

       A alternativa era prender o TOPO e deixar a base flutuar — a folha
       descolava da borda de baixo e quem passava a pular era o "Concluir",
       justo o botão que fica debaixo do polegar. Entre uma sobra de espaço
       abaixo do último campo e um botão que se move, a sobra é de longe o
       menor preço: é assim que toda folha de detente fixa se comporta. */
    let alvo = 0;
    for (let i = 0; i < secs.length; i++) {
      secs.forEach((o, j) => { o.hidden = (j !== i); });
      const h = body.getBoundingClientRect().height;
      if (h > alvo) alvo = h;
    }
    secs.forEach((s, i) => { s.hidden = antes[i]; });
    /* Duas casas decimais, não pixels inteiros: com a altura arredondada para
       baixo, a seção que não cabe continuava 0,5px mais alta que as outras — e
       "quase parado" ainda é um pulo para quem está com o dedo na fita. */
    if (alvo > 0) body.style.minHeight = alvo.toFixed(2) + 'px';
  },
  /* ── CAMPO QUE SÓ EXISTE QUANDO FAZ SENTIDO ──────────────────────────────
     Os três sub-campos de custo eram irmãos permanentes, rotulados "· se por
     lacuna: piso", "· se fixo: questões" — dois deles sempre inertes, e o
     rótulo pedindo desculpa por isso. Um campo que não vale para a sua
     configuração não é informação, é ruído: agora ele simplesmente não está
     lá, e o rótulo pode dizer o que o campo faz. O mesmo vale para o peso da
     banca, que só age na ordem "fraqueza × incidência". */
  /* ── RESTAURAR O PADRÃO DE FÁBRICA DOS CAMPOS ────────────────────────────
     Apagar a preferência salva não basta em duas das três abas: o Reforço e a
     Análise leem os valores DOS PRÓPRIOS CAMPOS a cada repintura, e
     `applyReforcoPrefs` ignora nulo de propósito. Zerar só o armazenamento
     deixava a tela exatamente como estava — um "Restaurar padrões" que não
     restaurava nada.

     O padrão de fábrica de um campo é o que o HTML declara nele
     (`defaultValue`, `defaultChecked`, `option[selected]`). Devolver isso e
     disparar `change` faz o caminho normal do app rodar: o mesmo ouvinte que
     atende um clique do usuário grava e repinta. */
  restaurarCampos(aba) {
    const secs = this._secoes(aba);
    secs.forEach(sec => sec.querySelectorAll('input, select').forEach(el => {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = el.defaultChecked;
      else if (el.tagName === 'SELECT') {
        const padrao = [...el.options].find(o => o.defaultSelected);
        if (padrao) el.value = padrao.value; else if (el.options.length) el.selectedIndex = 0;
      } else if (el.defaultValue !== '') el.value = el.defaultValue;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }));
  },
  aplicarCondicionais() {
    document.querySelectorAll('#tec-cfg-body [data-cfg-se]').forEach(el => {
      const [id, valores] = String(el.dataset.cfgSe).split(':');
      const fonte = document.getElementById(id);
      if (!fonte) return;
      const vale = valores.split('|').indexOf(String(fonte.value)) >= 0;
      el.hidden = !vale;
    });
  },
  fechar() {
    const modal = document.getElementById('tec-cfg-modal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    const body = document.getElementById('tec-cfg-body');
    if (body) body.style.minHeight = '';   // a próxima aba mede a sua própria altura
    this.aba = null;
    // devolve o foco para a porta por onde se entrou
    const btn = document.querySelector('.tec-cfg-open[data-cfg="' + (this._voltarPara || '') + '"]');
    if (btn) { try { btn.focus(); } catch (e) { _quiet(e, 'cfg-foco'); } }
  },
  mostrar(sec) {
    if (!this.aba) return;
    this.secao = sec;
    /* Esconde TODAS as seções, não só as da aba corrente: as três abas dividem
       o mesmo corpo, e ocultar apenas as irmãs deixava a seção da aba anterior
       aparecendo por baixo — a folha do Plano mostrando os campos do Reforço. */
    document.querySelectorAll('#tec-cfg-body .tec-cfg-sec').forEach(el => {
      el.hidden = !(el.dataset.tab === this.aba && el.dataset.sec === sec);
    });
    const nav = document.getElementById('tec-cfg-nav');
    nav.querySelectorAll('button').forEach(b => {
      const at = b.dataset.sec === sec;
      b.classList.toggle('is-active', at);
      b.setAttribute('aria-selected', at ? 'true' : 'false');
    });
    const body = document.getElementById('tec-cfg-body');
    if (body) body.scrollTop = 0;
    // com cinco seções a fita rola: o chip escolhido tem de aparecer inteiro
    const at = nav.querySelector('button.is-active');
    if (at) { try { at.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) { _quiet(e, 'cfg-fita'); } }
  },
  /* O ponto no chip: um campo daquela seção está fora do padrão de fábrica.
     Comparar por STRING evita que 85 e "85" contem como diferença — que era
     como um chip nasceria marcado sem ninguém ter tocado nele. */
  marcarPersonalizadas() {
    if (!this.aba) return;
    let padrao = {};
    try { padrao = this.PADROES[this.aba](); } catch (e) { _quiet(e, 'cfg-padrao'); }
    const nav = document.getElementById('tec-cfg-nav');
    if (!nav) return;
    this._secoes(this.aba).forEach(sec => {
      const fora = [...sec.querySelectorAll('[data-cfg-key]')].some(el => {
        const k = el.dataset.cfgKey;
        if (!(k in padrao) || padrao[k] == null) return false;
        const atual = (el.type === 'checkbox') ? el.checked : el.value;
        return String(atual) !== String(padrao[k]);
      });
      const b = nav.querySelector('button[data-sec="' + sec.dataset.sec + '"]');
      if (!b) return;
      const tem = !!b.querySelector('.dot');
      if (fora && !tem) b.insertAdjacentHTML('beforeend', '<span class="dot" title="Você ajustou algo nesta seção"></span>');
      else if (!fora && tem) b.querySelector('.dot').remove();
    });
  },
  /* O RESUMO É O QUE PERMITE FECHAR A FOLHA. Esconder ajuste sem dizer qual
     está valendo não é limpar a tela, é esconder informação — a linha abaixo
     do título tem de responder "com que régua este número foi feito?" sem
     abrir nada. */
  /* Cada item vira uma etiqueta com RÓTULO e VALOR. Uma frase corrida de
     quatro fragmentos cinzentos ("todas · pior acerto · meta 85% · até 30")
     obriga a ler tudo para achar um; a etiqueta responde de relance qual é o
     campo e o que ele está valendo. */
  resumo(aba) {
    const sel = (id) => { const e = document.getElementById(id); return (e && e.options && e.options[e.selectedIndex]) ? e.options[e.selectedIndex].text : ''; };
    const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
    const semEmoji = (t) => String(t || '').replace(/^[^\p{L}\d]+/u, '').split(' — ')[0].trim();
    const disc = (id) => { const d = semEmoji(sel(id)); return (!d || /^todas/i.test(d)) ? 'todas' : d; };
    const p = [];
    if (aba === 'plano') {
      if (val('plano-meta')) p.push(['meta', val('plano-meta') + '%']);
      p.push(['ordem', semEmoji(sel('plano-ordenar'))]);
      p.push(['disciplina', disc('plano-disc')]);
      /* A exclusão muda TODO número do Plano e mora dentro de uma caixa
         fechada. Sem ela na fita de resumo, o único lugar em que a porta dos
         ajustes diria o que está valendo seria o que ela não diz. */
      try {
        const ex = PlanoEngine.prefs().excluidas;
        if (Array.isArray(ex) && ex.length) p.push(['fora', ex.length === 1 ? ex[0] : ex.length + ' matérias']);
      } catch (e) { _quiet(e, 'cfg-excluidas'); }
      if (val('plano-limite')) p.push(['lista', val('plano-limite') + ' por vez']);
    } else if (aba === 'reforco') {
      let b = ''; try { b = ReforcoEngine.rotuloBancas(DesempenhoTecScreen.bancaFiltro()); } catch (e) { _quiet(e, 'cfg-bancas'); }
      p.push([/todas/i.test(b) ? 'bancas' : (b.indexOf(' e ') > 0 ? 'bancas' : 'banca'), b.replace(/^todas as bancas$/, 'todas')]);
      p.push(['ordem', semEmoji(sel('reforco-ordenar'))]);
      p.push(['disciplina', disc('reforco-disc')]);
      const g = val('reforco-gran');
      p.push(['nível', g === '0' ? 'disciplina' : g === '100' ? 'tópico' : 'assunto']);
    } else if (aba === 'analise') {
      if (val('tec-weak-threshold')) p.push(['fraco abaixo de', val('tec-weak-threshold') + '%']);
      p.push(['ordem', semEmoji(sel('tec-weak-ordenar'))]);
      p.push(['disciplina', disc('tec-weak-disc')]);
      if (val('tec-weak-minq')) p.push(['mín. questões', val('tec-weak-minq')]);
    }
    return p.filter(x => x[1]);
  },
  // chamado pelas telas a cada repintura: o resumo nunca pode ficar velho
  sincronizar(aba) {
    const alvos = aba ? [aba] : ['plano', 'reforco', 'analise'];
    alvos.forEach(a => {
      const el = document.getElementById(a + '-cfg-resumo');
      if (!el) return;
      el.innerHTML = this.resumo(a).map(([k, v]) =>
        `<span class="tec-cfg-pill"><i>${escapeHtml(k)}</i>${escapeHtml(String(v))}</span>`).join('');
    });
    if (this.aba) this.marcarPersonalizadas();
  }
};
window.TecAjustes = TecAjustes;

const DesempenhoTecScreen = {
  currentSnapId: null,
  /* Quanto cada lista do Plano tem ABERTO além do passo configurado (ver
     `fatiar`). Estado de leitura da sessão: qualquer mudança de ajuste zera
     tudo, porque outra configuração é outra fila. */
  _fatias: null,
  /* ── UMA REGRA DE FATIA PARA TODAS AS LISTAS DO PLANO ───────────────────
     O Plano tem sete listas, e cada uma tratava o próprio comprimento de um
     jeito: a de assuntos ia até um campo de ajuste, a de matérias não tinha
     limite, o segundo plano cortava em 15 fixos e escondia os outros 716 sem
     dizer, os ciclos fechados cortavam em 12, e as lacunas do edital
     despejavam tudo. Quatro comportamentos diferentes para a mesma pergunta —
     "cabe na tela?" — e três deles mentindo por omissão.

     Uma regra só, no passo que você configurar: abre em N, o rodapé diz de
     quantos, e um toque abre mais N. O estado de abertura é por lista e vive
     na sessão, nunca nas preferências: abrir a fila inteira uma vez não pode
     deixar a tela abrindo em 991 itens para sempre. */
  fatiar(chave, itens, passo) {
    const arr = Array.isArray(itens) ? itens : [];
    if (!this._fatias) this._fatias = Object.create(null);
    const p = Math.max(1, passo || 10);
    const vis = arr.slice(0, p + (this._fatias[chave] || 0));
    return { chave, passo: p, vis, total: arr.length, faltam: arr.length - vis.length };
  },
  /* O rodapé conta em ITENS por padrão, mas quem tem uma moeda melhor passa
     `resumo` — a tabela de matérias conta em pontos em jogo, porque é isso que
     decide se o que ficou escondido importava. */
  rodapeFatia(f, um, muitos, resumo) {
    if (!f.total) return '';
    const abertos = (this._fatias && this._fatias[f.chave]) || 0;
    const menos = `<button type="button" class="pl-hero-limpar" data-fatia="${f.chave}" data-fatia-op="menos">voltar a ${f.passo}</button>`;
    if (!f.faltam) {
      return abertos ? `<div class="pl-mais"><p class="pl-mais-nota">Fim da lista — ${f.total === 1 ? 'o único item está' : 'os <b>' + f.total + '</b> ' + muitos + ' estão'} à vista.</p><div class="pl-mais-bts">${menos}</div></div>` : '';
    }
    return `<div class="pl-mais">
        <p class="pl-mais-nota${(resumo && resumo.tom) ? ' ' + resumo.tom : ''}">Mostrando <b>${f.vis.length}</b> de <b>${f.total}</b> ${f.total === 1 ? um : muitos}${(resumo && resumo.txt) ? ' · ' + resumo.txt : ''}</p>
        <div class="pl-mais-bts">
          <button type="button" class="btn-secondary" data-fatia="${f.chave}" data-fatia-op="mais">▾ Mostrar mais ${Math.min(f.passo, f.faltam)}</button>
          ${f.faltam > f.passo ? `<button type="button" class="pl-hero-limpar" data-fatia="${f.chave}" data-fatia-op="tudo">ver ${f.total === 1 ? 'o item' : 'os ' + f.total}</button>` : ''}
          ${f.vis.length > f.passo ? menos : ''}
        </div>
      </div>`;
  },
  /* Um ouvinte para as sete listas. Abrir mais NÃO rola a tela de volta ao
     topo: a pessoa está lendo o fim de uma lista, e perder o lugar dela é o
     tipo de detalhe que faz um app parecer desleixado. */
  _ligarFatias(host) {
    if (!host) return;
    host.querySelectorAll('[data-fatia]').forEach(b => b.addEventListener('click', () => {
      const chave = b.dataset.fatia, op = b.dataset.fatiaOp;
      if (!this._fatias) this._fatias = Object.create(null);
      const marca = b.closest('.pl-mais');
      const antes = marca ? marca.getBoundingClientRect().top : null;
      if (op === 'menos') this._fatias[chave] = 0;
      else if (op === 'tudo') this._fatias[chave] = 100000;
      else this._fatias[chave] = (this._fatias[chave] || 0) + (this._passoFatia || 10);
      this.renderPlanoConteudo();
      if (op === 'menos') {
        const alvo = document.querySelector('[data-fatia="' + chave + '"]');
        if (alvo && alvo.closest('.pl-mais')) alvo.closest('.pl-mais').scrollIntoView({ block: 'center' });
        return;
      }
      const depois = document.querySelector('[data-fatia="' + chave + '"][data-fatia-op="mais"]');
      const caixa = depois && depois.closest('.pl-mais');
      if (antes != null && caixa) window.scrollBy(0, caixa.getBoundingClientRect().top - antes);
    }));
  },
  _passoFatia: 10,
  /* Quantos assuntos o "próximo bloco" marca de uma vez. Ele é do tamanho do
     seu ritmo, com este teto: cinco frentes abertas na mesma semana já é mais
     do que alguém executa, e a fila logo abaixo continua disponível para
     trocar qualquer um deles. */
  PLANO_BLOCO_MAX: 5,

  /* ═══ O PLANO NÃO PODE REPINTAR A CADA TECLA ════════════════════════════
     Cada campo dos ajustes chamava `renderPlanoConteudo` direto, no evento
     `input`. Digitar "120" num campo numérico disparava TRÊS repinturas — e
     uma repintura do Plano é o motor inteiro rodando sobre todos os retratos
     (índice por assunto, janela adaptativa, sequências, série histórica,
     quadro de matérias) mais alguns milhares de nós de HTML. Num perfil real,
     com 991 assuntos e 10 retratos, isso trava a digitação: a tecla seguinte
     espera o cálculo da anterior terminar.

     O pedido passa a ser AGENDADO. Teclas em rajada colapsam em uma repintura
     só — a última é a que vale, que é justamente o que a pessoa quis dizer.
     Um clique (caixa de seleção, botão, troca de aba) pede `imediato`, porque
     ali não existe rajada e qualquer espera é lentidão percebida.

     260ms é a janela: abaixo disso um digitador médio ainda dispara no meio da
     palavra; acima, o resultado parece ter esquecido o comando. */
  PLANO_ESPERA: 260,
  _planoTimer: null,
  agendarPlano(imediato) {
    if (this._planoTimer) { clearTimeout(this._planoTimer); this._planoTimer = null; }
    if (imediato) { this.renderPlanoConteudo(); return; }
    /* O sinal de "estou processando" tem de aparecer ANTES da espera, não
       depois: é durante a espera que a tela parece travada. */
    this._marcarPlanoOcupado(true);
    this._planoTimer = setTimeout(() => {
      this._planoTimer = null;
      this.renderPlanoConteudo();
    }, this.PLANO_ESPERA);
  },
  _marcarPlanoOcupado(on) {
    const l = document.getElementById('plano-lista');
    const p = document.getElementById('plano-proj');
    [l, p].forEach(e => { if (e) e.classList.toggle('pl-ocupado', !!on); });
  },

  /* ── REPINTAR NÃO PODE MOVER A PÁGINA DEBAIXO DO DEDO ────────────────────
     Marcar uma matéria na caixa de exclusão reescrevia `#plano-lista` inteiro.
     A lista encurta (menos assuntos), a página encurta com ela, e o navegador
     "sobe" a rolagem sozinho — com a folha de ajustes aberta na frente, o
     efeito é a barra pulando a cada clique, como se o app estivesse
     instável.

     Guardar e devolver a posição resolve os dois casos de uma vez: a folha
     aberta (onde a página atrás nem está sendo lida) e a leitura direta da
     lista (onde a âncora é o ponto em que o dedo estava). */
  _comRolagemPreservada(fn) {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    try { fn(); } finally {
      const agora = window.scrollY || document.documentElement.scrollTop || 0;
      if (Math.abs(agora - y) > 1) { try { window.scrollTo(0, y); } catch (e) { _quiet(e, 'plano-rolagem'); } }
    }
  },

  /* ── A ABA PESADA ABRE ANTES DE TERMINAR DE PENSAR ───────────────────────
     Abrir o Plano (e as Conquistas) dava uma travada e um atraso: o clique
     disparava todo o cálculo ANTES de o navegador ter pintado a troca de aba,
     então a interface ficava congelada no estado antigo sem nenhum sinal de
     que algo estava acontecendo.

     Agora a aba troca, um esqueleto aparece no mesmo quadro, e o cálculo
     acontece no quadro seguinte. O tempo total é o mesmo; o que muda é que
     ele deixa de ser tempo MUDO. Dois `requestAnimationFrame` porque um só
     ainda pode rodar antes da pintura. */
  _depoisDePintar(alvoId, fn) { pintarDepois(alvoId, 'Calculando o seu plano…', fn); },
  // ---- Escopo da análise: 'consolidado' (todos), 'select' (retratos marcados), 'range' (intervalo) ----
  scopeMode: 'consolidado',
  selectedSnapIds: null, // Set de ids marcados (modo 'select')
  rangeStart: null, rangeEnd: null, // (modo 'range')
  // ---- Persistência de filtros/seleções (lembra entre sessões, por perfil) ----
  _prefsKey() { return DB._profilePrefix() + 'tec-prefs'; },
  _loadPrefs() {
    if (this._prefs) return this._prefs;
    this._prefs = DB._get(this._prefsKey(), {}) || {};
    /* Filtros e configuracoes nascem RECOLHIDOS. A tela e densa: ao abrir, o
       que interessa sao os resultados, nao os controles que os produziram.
       Quem quiser ajustar abre pela engrenagem — e a escolha fica salva.
       Só o padrao inicial muda; quem ja escolheu mostrar continua vendo. */
    if (this._prefs.hideCfg === undefined) this._prefs.hideCfg = true;
    return this._prefs;
  },
  savePrefs(patch) {
    const p = Object.assign(this._loadPrefs(), patch || {});
    this._prefs = p;
    DB.setRaw(this._prefsKey(), JSON.stringify(p));
  },
  // aplica as preferências salvas aos controles do Reforço (chamado ao renderizar)
  applyReforcoPrefs() {
    const p = this._loadPrefs();
    if (p.reforcoView) this.reforcoView = p.reforcoView;
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
    if (p.ordenar) { const el = document.getElementById('reforco-ordenar'); if (el && [...el.options].some(o => o.value === p.ordenar)) el.value = p.ordenar; }
    if (p.estrat != null) set('reforco-estrat', p.estrat);
    if (p.gran != null) set('reforco-gran', p.gran);
    if (p.minq != null) set('reforco-minq', p.minq);
    if (p.limite != null) set('reforco-limite', p.limite);
    if (p.disc) { const el = document.getElementById('reforco-disc'); if (el && [...el.options].some(o => o.value === p.disc)) el.value = p.disc; }
  },
  render() {
    const snaps = DB.getTecSnapshots();
    const emptyEl = document.getElementById('tec-empty');
    const importEl = document.getElementById('tec-import');
    const analysisEl = document.getElementById('tec-analysis');
    importEl.style.display = 'none';
    if (snaps.length === 0) {
      emptyEl.style.display = 'block';
      analysisEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    analysisEl.style.display = 'block';
    /* O retrato novo é quem fecha os ciclos. Rodar a conciliação aqui pega
       qualquer caminho que traga dado — importar, excluir, sincronizar da
       nuvem — em vez de só o botão de importar. A marca `_cicloSel` faz isso
       acontecer UMA vez por conjunto de retratos: repintar a tela dez vezes
       não reescreve nada, e o veredito não pisca. */
    try {
      const sel = snaps.length + ':' + (snaps[snaps.length - 1] || {}).id;
      if (this._cicloSel !== sel) {
        this._cicloSel = sel;
        const rc = PlanoCiclo.conciliar();
        if (rc.fechadas.length) {
          const ok = rc.vereditos.filter(v => v.tipo === 'funcionou').length;
          const nao = rc.vereditos.length - ok;
          showToast(`🏁 ${rc.fechadas.length} atividade(s) do Plano encerrada(s) pelo retrato` +
            (ok ? ' · ' + ok + ' funcionou(ram)' : '') + (nao ? ' · ' + nao + ' não funcionou(ram)' : ''));
        }
      }
    } catch (e) { _quiet(e, 'ciclo-conciliar'); }
    // restaura o modo de escopo salvo (persistência de filtros)
    const _p = this._loadPrefs();
    if (_p.scopeMode && ['consolidado', 'select', 'range'].includes(_p.scopeMode)) this.scopeMode = _p.scopeMode;
    if (_p.reforcoView) this.reforcoView = _p.reforcoView;
    // inicializa a seleção (todos marcados) e o intervalo (cobre tudo) na 1ª vez
    if (this.selectedSnapIds === null) this.selectedSnapIds = new Set(snaps.map(s => s.id));
    // remove ids que não existem mais
    [...this.selectedSnapIds].forEach(id => { if (!snaps.find(s => s.id === id)) this.selectedSnapIds.delete(id); });
    if (this.selectedSnapIds.size === 0) snaps.forEach(s => this.selectedSnapIds.add(s.id));
    if (!this.rangeStart || !this.rangeEnd) {
      this.rangeStart = snaps[0].startDate;
      this.rangeEnd = snaps[snaps.length - 1].endDate;
    }
    this.renderScopeControls(snaps);
    this.renderAnalysis();
    this.switchTecTab(this.tecTab || 'analise'); // reaplica a aba ativa
    this.applyCfgHidden();
    this.applyEnxuto();
  },
  // Mostra/oculta todos os filtros e configurações da tela (classe .tec-cfg),
  // deixando só os resultados. Estado salvo por perfil.
  applyCfgHidden() {
    const on = !!this._loadPrefs().hideCfg;
    const wrap = document.getElementById('tec-analysis');
    // hide-cfg esconde os filtros; hide-heads enxuga tambem os subtitulos longos
    // dos cabecalhos de cartao, que so explicam o que a tela ja mostra.
    if (wrap) { wrap.classList.toggle('hide-cfg', on); wrap.classList.toggle('hide-heads', on); }
    const btn = document.getElementById('tec-toggle-cfg');
    if (btn) { btn.classList.toggle('is-active', on); btn.innerHTML = `<span class="gg-ic">🔧</span>${on ? 'Mostrar filtros' : 'Ocultar filtros'}`; }
  },
  /* MODO ENXUTO — depois que você entende a tela, textos de ajuda, legendas e
     dicas viram ruído. Este modo esconde tudo isso e deixa só o que muda de
     valor: números, barras e listas. Fica salvo por perfil. */
  applyEnxuto() {
    const on = !!this._loadPrefs().enxuto;
    const tela = document.getElementById('screen-desempenhotec');
    if (tela) tela.classList.toggle('tec-enxuto', on);
    const b = document.getElementById('tec-enxuto-btn');
    if (b) { b.classList.toggle('is-active', on); b.innerHTML = `<span class="gg-ic">🔎</span>${on ? 'Modo completo' : 'Modo enxuto'}`; }
  },
  /* ── QUAIS BANCAS SÃO AS MINHAS ───────────────────────────────────────────
     A escolha da banca existia em DOIS lugares (uma preferência no Reforço,
     outra no Plano) e em ambos era "todas" ou UMA. Quem mira dois órgãos com
     bancas diferentes não tinha como somar só as duas — e ainda precisava
     lembrar de trocar a banca em cada aba.

     Agora é UMA seleção do perfil, com quantas bancas você quiser, e as três
     abas leem dela. Lista vazia significa "todas": é o padrão, e é o que
     sobrevive a renomear ou excluir uma banca sem deixar o app apontando para
     um nome que não existe mais. */
  bancasSelecionadas() {
    const p = this._loadPrefs();
    const existentes = DB.getBancas();
    const norm = (x) => ReforcoEngine.norm(x);
    let sel = Array.isArray(p.bancasSel) ? p.bancasSel : null;
    /* MIGRAÇÃO: quem tinha uma banca escolhida no Reforço (ou no Plano) começa
       com ela marcada, em vez de ver a seleção "voltar para todas" sozinha. */
    if (!sel) {
      const antiga = p.banca && p.banca !== '__todas__' ? p.banca
        : ((typeof PlanoEngine !== 'undefined' && PlanoEngine.prefs().banca !== '__todas__') ? PlanoEngine.prefs().banca : null);
      sel = antiga ? [antiga] : [];
    }
    return sel.filter(b => existentes.some(e => norm(e) === norm(b)));
  },
  // valor pronto para o motor: '__todas__' ou a lista
  bancaFiltro() {
    const sel = this.bancasSelecionadas();
    return sel.length ? sel : '__todas__';
  },
  setBancas(lista) {
    this.savePrefs({ bancasSel: Array.isArray(lista) ? lista : [] });
    try { if (typeof PlanoEngine !== 'undefined') PlanoEngine.salvarPrefs({ banca: '__todas__' }); } catch (e) { _quiet(e, 'banca-plano'); }
    this.renderBancaPickers();
    if (this.tecTab === 'reforco') this.renderReforco();
    else if (this.tecTab === 'plano') this.renderPlanoConteudo();
    else if (this.tecTab === 'incidencia') this.renderIncidencia();
  },
  renderBancaPickers() {
    ['reforco-banca-pick', 'plano-banca-pick', 'incid-banca-pick'].forEach(id => this.renderBancaPicker(id));
  },
  /* O seletor: um botão que diz o que está valendo e um painel de caixas. Não é
     uma lista suspensa porque a resposta certa costuma ser MAIS DE UMA — e numa
     lista suspensa a segunda escolha desfaz a primeira. */
  renderBancaPicker(hostId) {
    const host = document.getElementById(hostId);
    if (!host) return;
    const bancas = DB.getBancas();
    const sel = this.bancasSelecionadas();
    const marcada = (b) => sel.some(x => ReforcoEngine.norm(x) === ReforcoEngine.norm(b));
    const linhas = DB.getIncidencia();
    const resumo = (b) => {
      const rs = linhas.filter(r => ReforcoEngine.norm(r.banca) === ReforcoEngine.norm(b));
      const raiz = rs.filter(r => r.depth === 0);
      const q = (raiz.length ? raiz : rs).reduce((a, r) => a + (r.incidencia || 0), 0);
      return `${rs.length} tópicos · ${q.toLocaleString('pt-BR')} questões`;
    };
    const rot = !bancas.length ? 'Nenhuma banca importada'
      : !sel.length ? '🏛️ Todas as bancas'
      : sel.length === 1 ? '🏛️ ' + sel[0]
      : `🏛️ ${sel.length} bancas`;
    host.innerHTML = `
      <button type="button" class="banca-pick-btn" aria-expanded="false" ${bancas.length ? '' : 'disabled'}>
        <span>${escapeHtml(rot)}</span><span class="chev">▾</span>
      </button>
      <div class="banca-pick-panel" hidden>
        <p class="banca-pick-topo">Marque as bancas do seu concurso. Sem nenhuma marcada, o app soma o histórico de todas.</p>
        ${bancas.map(b => `<label class="banca-pick-item">
          <input type="checkbox" value="${escapeHtml(b)}" ${marcada(b) ? 'checked' : ''}>
          <span><b>${escapeHtml(b)}</b><small>${escapeHtml(resumo(b))}</small></span>
        </label>`).join('')}
        <div class="banca-pick-acoes">
          ${sel.length ? '<button type="button" data-acao="todas">↺ Voltar a todas as bancas</button>' : '<span class="banca-pick-nota">Somando todas as bancas importadas.</span>'}
        </div>
      </div>`;
    const btn = host.querySelector('.banca-pick-btn');
    const painel = host.querySelector('.banca-pick-panel');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = painel.hasAttribute('hidden');
      // um painel por vez em toda a tela
      document.querySelectorAll('.banca-pick-panel').forEach(p2 => p2.setAttribute('hidden', ''));
      document.querySelectorAll('.banca-pick-btn').forEach(b2 => b2.setAttribute('aria-expanded', 'false'));
      if (abrir) { painel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    });
    painel.addEventListener('click', (e) => e.stopPropagation());
    painel.querySelectorAll('input[type="checkbox"]').forEach(c => c.addEventListener('change', () => {
      this.setBancas([...painel.querySelectorAll('input:checked')].map(x => x.value));
    }));
    painel.querySelectorAll('[data-acao]').forEach(b => b.addEventListener('click', () => this.setBancas([])));
  },
  /* ── A CAIXA DO QUE FICA DE FORA ──────────────────────────────────────────
     Mesma mecânica da caixa de bancas, e pelo mesmo motivo: a resposta certa é
     MAIS DE UMA, e numa lista suspensa a segunda escolha desfaz a primeira.
     Cada linha mostra o tamanho do que sai da conta (assuntos e questões do
     histórico), porque "excluir Legislação do RN" tem consequências muito
     diferentes se ela vale 40 questões ou 2.400. */
  renderExcluidasPicker(hostId) {
    const host = document.getElementById(hostId || 'plano-excluidas-pick');
    if (!host) return;
    /* Marcar uma matéria repinta a tela inteira — e fechar a caixa a cada
       clique obrigaria a reabri-la para excluir a segunda. Quem chega aqui
       quase nunca vem tirar uma só. */
    const jaAberto = !!host.querySelector('.banca-pick-panel:not([hidden])');
    const mats = PlanoEngine.materiasExcluiveis();
    const p = PlanoEngine.prefs();
    const fora = PlanoEngine.excluidasSet(p);
    const marcada = (m) => PlanoEngine.foraDoPlano(m.nome, fora);
    const n = mats.filter(marcada).length;
    const rot = !mats.length ? 'Nenhuma matéria conhecida'
      : n === 0 ? '✅ Todas as matérias no Plano'
      : n === 1 ? '🚫 1 matéria fora'
      : `🚫 ${n} matérias fora`;
    const origem = (m) => m.fontes.indexOf('tec') < 0 ? 'só no seu edital'
      : (m.assuntos ? `${m.assuntos} ${m.assuntos === 1 ? 'assunto' : 'assuntos'} · ${m.q.toLocaleString('pt-BR')} questões no histórico` : 'sem questões resolvidas');
    host.innerHTML = `
      <button type="button" class="banca-pick-btn" aria-expanded="false" ${mats.length ? '' : 'disabled'}>
        <span>${escapeHtml(rot)}</span><span class="chev">▾</span>
      </button>
      <div class="banca-pick-panel" hidden>
        <p class="banca-pick-topo">Marque o que o Plano deve <b>ignorar</b> — a legislação de um concurso que já passou, uma matéria que saiu do edital. Sai do domínio, da fila, da trajetória e da nota projetada. Nada é apagado: desmarque e ela volta inteira.</p>
        ${mats.map(m => `<label class="banca-pick-item">
          <input type="checkbox" value="${escapeHtml(m.nome)}" ${marcada(m) ? 'checked' : ''}>
          <span><b>${escapeHtml(m.nome)}</b><small>${escapeHtml(origem(m))}</small></span>
        </label>`).join('')}
        <div class="banca-pick-acoes">
          ${n ? '<button type="button" data-acao="nenhuma">↺ Trazer todas de volta</button>' : '<span class="banca-pick-nota">Nenhuma matéria excluída — o Plano está vendo tudo.</span>'}
        </div>
      </div>`;
    const btn = host.querySelector('.banca-pick-btn');
    const painel = host.querySelector('.banca-pick-panel');
    if (!btn || !painel) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = painel.hasAttribute('hidden');
      document.querySelectorAll('.banca-pick-panel').forEach(p2 => p2.setAttribute('hidden', ''));
      document.querySelectorAll('.banca-pick-btn').forEach(b2 => b2.setAttribute('aria-expanded', 'false'));
      if (abrir) { painel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    });
    painel.addEventListener('click', (e) => e.stopPropagation());
    painel.querySelectorAll('input[type="checkbox"]').forEach(c => c.addEventListener('change', () => {
      this.setExcluidas([...painel.querySelectorAll('input:checked')].map(x => x.value));
    }));
    painel.querySelectorAll('[data-acao]').forEach(b => b.addEventListener('click', () => this.setExcluidas([])));
    if (jaAberto) { painel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
  },
  /* Gravar a exclusão muda o RECORTE, e o recorte pode ter acabado de tirar da
     tela a disciplina que o filtro apontava. Devolver o filtro para "Todas"
     aqui evita o estado sem saída: filtro numa matéria que o motor não vê
     mais, e a tela dizendo "sem retrato" com o retrato na mão. */
  setExcluidas(lista) {
    const limpa = [];
    const vistos = Object.create(null);
    (Array.isArray(lista) ? lista : []).forEach(n => {
      const nome = String(n == null ? '' : n).trim();
      const k = ReforcoEngine.norm(nome);
      if (!nome || !k || vistos[k]) return;
      vistos[k] = true; limpa.push(nome);
    });
    const patch = { excluidas: limpa.slice(0, PlanoEngine.MAX_EXCLUIDAS) };
    const fora = PlanoEngine.excluidasSet(patch);
    const atual = PlanoEngine.prefs().disciplina;
    if (atual && atual !== '__todas__' && PlanoEngine.foraDoPlano(atual, fora)) patch.disciplina = '__todas__';
    PlanoEngine.salvarPrefs(patch);
    this._planoRefC = null; this._fatias = null;
    const sel = document.getElementById('plano-disc');
    if (sel && patch.disciplina) sel.value = '__todas__';
    /* `renderPlano()` reconstrói TODOS os campos da folha, inclusive o select
       de disciplina e a própria caixa que você acabou de tocar — e era isso
       que fazia a caixa fechar e a página saltar a cada matéria marcada. Aqui
       só duas coisas mudaram de verdade: a lista de disciplinas oferecidas no
       filtro e o conteúdo do Plano. */
    this._sincronizarFiltroDisc();
    this.renderExcluidasPicker('plano-excluidas-pick');
    this.agendarPlano(true);
  },
  /* A lista do filtro de disciplina depende do que está excluído — é o único
     campo da folha que a exclusão precisa mexer. Extraído de `renderPlano`
     para que marcar uma matéria não obrigue a reconstruir os outros vinte. */
  _sincronizarFiltroDisc() {
    const ds = document.getElementById('plano-disc');
    if (!ds) return;
    const p = PlanoEngine.prefs();
    const fora = PlanoEngine.excluidasSet(p);
    const discs = PlanoEngine.disciplinas(this.scopedSnapshot()).filter(d => !PlanoEngine.foraDoPlano(d, fora));
    ds.innerHTML = `<option value="__todas__">📚 Todas</option>` +
      discs.map(d => `<option value="${escapeHtml(d)}" ${d === p.disciplina ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
    if (![...ds.options].some(o => o.value === p.disciplina)) ds.value = '__todas__';
  },
  // normaliza texto p/ casar tópicos entre retratos (sem acento/caixa/espaços extras)
  _nk(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); },
  // Retorna os retratos ativos conforme o escopo selecionado (ordenados por período)
  activeSnapshots() {
    const snaps = DB.getTecSnapshots();
    if (this.scopeMode === 'select') {
      return snaps.filter(s => this.selectedSnapIds.has(s.id));
    }
    if (this.scopeMode === 'range') {
      const a = this.rangeStart, b = this.rangeEnd;
      // inclui retratos cujo PERÍODO [start,end] se sobrepõe ao intervalo [a,b]
      return snaps.filter(s => s.startDate <= b && s.endDate >= a);
    }
    return snaps; // consolidado
  },
  // Agrega vários retratos num "retrato virtual": soma questões e acertos por tópico
  // (casando por disciplina+código+nome) e recalcula o % de acerto (média ponderada).
  aggregate(snaps) {
    if (!snaps || snaps.length === 0) return null;
    const order = [], map = new Map();
    snaps.forEach(s => {
      (s.rows || []).forEach(r => {
        const key = (r.depth === 0)
          ? 'D::' + this._nk(r.nome)
          : this._nk(r.disciplina) + '|' + (r.codigo || '') + '|' + this._nk(r.nome);
        let agg = map.get(key);
        if (!agg) {
          agg = { codigo: r.codigo, nome: r.nome, depth: r.depth, disciplina: r.disciplina, questoes: 0, acertos: 0, peso: r.peso };
          map.set(key, agg); order.push(key);
        }
        agg.questoes += (r.questoes || 0);
        agg.acertos += (r.acertos || 0);
        if (r.peso != null && (agg.peso == null || r.peso > agg.peso)) agg.peso = r.peso;
      });
    });
    const rows = order.map(k => {
      const a = map.get(k);
      a.pctAcerto = a.questoes > 0 ? Math.round((a.acertos / a.questoes) * 1000) / 10 : 0;
      return a;
    });
    // Reagrupa por DISCIPLINA: um tópico que só apareceu no retrato mais novo entrava no
    // fim da lista e, na árvore, acabava pendurado na disciplina errada.
    const nk = this._nk.bind(this);
    const ordemDisc = [];
    rows.forEach(r => { const d = nk(r.disciplina || r.nome); if (!ordemDisc.includes(d)) ordemDisc.push(d); });
    const agrupadas = [];
    ordemDisc.forEach(d => {
      const daDisc = rows.filter(r => nk(r.disciplina || r.nome) === d);
      const raiz = daDisc.filter(r => r.depth === 0);
      const filhos = daDisc.filter(r => r.depth > 0)
        .sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true }));
      agrupadas.push(...raiz, ...filhos);
    });
    const starts = snaps.map(s => s.startDate).sort();
    const ends = snaps.map(s => s.endDate).sort();
    return {
      id: (snaps.length === 1 ? snaps[0].id : '__agg__'),
      aggregated: snaps.length > 1,
      count: snaps.length,
      startDate: starts[0], endDate: ends[ends.length - 1],
      date: starts[0], rows: agrupadas,
      /* ── DE ONDE O AGREGADO VEIO ─────────────────────────────────────────
         Os códigos do TEC são POSICIONAIS, não identificadores: o "01.01" de
         Contabilidade num mês é outro assunto no mês seguinte. Somar as linhas
         e depois decidir quem é folha pelo prefixo do código mistura duas
         árvores diferentes — e o efeito não é um número torto, é volume que
         desaparece: um tópico que era folha num retrato e virou pai no outro
         era descartado inteiro. Medido com dois exports reais do mesmo
         usuário: 533 questões no consolidado, 493 chegando ao Plano.

         Guardar as fontes deixa o índice de assuntos ser calculado retrato por
         retrato — cada um com a árvore dele — e somado depois. Ver `_indice`. */
      _fontes: snaps
    };
  },
  // Retrato efetivo usado por toda a análise (agrega o escopo atual)
  scopedSnapshot() {
    const snaps = this.activeSnapshots();
    if (snaps.length === 0) return null;
    return this.aggregate(snaps);
  },
  openImport() {
    $id('tec-empty').style.display = 'none';
    $id('tec-analysis').style.display = 'none';
    const importEl = document.getElementById('tec-import');
    importEl.style.display = 'block';
    // por padrão sugere o dia seguinte ao último período importado, para não sobrepor
    const snaps = DB.getTecSnapshots();
    const defStart = snaps.length ? this.addDays(snaps[snaps.length - 1].endDate, 1) : todayLocal();
    $id('tec-import-start').value = defStart;
    $id('tec-import-end').value = todayLocal() >= defStart ? todayLocal() : defStart;
    $id('tec-import-label').value = '';
    $id('tec-import-text').value = '';
    $id('tec-import-preview').textContent = 'Aguardando dados...';
    $id('tec-import-preview').style.color = 'var(--text-faint)';
    const fn = document.getElementById('tec-file-name');
    fn.style.display = 'none'; fn.textContent = '';
    $id('tec-file-input').value = '';
    this._parsedRows = null;
    this.validateRange();
  },
  addDays(iso, delta) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  // Valida o intervalo: início ≤ fim e sem sobreposição com retratos já existentes.
  // Retorna true se válido; atualiza a mensagem de aviso e o estado do botão Salvar.
  validateRange() {
    const start = $id('tec-import-start').value;
    const end = $id('tec-import-end').value;
    const warn = document.getElementById('tec-range-warn');
    const saveBtn = document.getElementById('tec-import-save');
    const setWarn = (msg) => {
      if (msg) { warn.textContent = msg; warn.style.display = 'block'; saveBtn.disabled = true; saveBtn.style.opacity = '0.5'; }
      else { warn.style.display = 'none'; saveBtn.disabled = false; saveBtn.style.opacity = ''; }
    };
    if (!start || !end) { setWarn('Informe o início e o fim do período.'); return false; }
    if (start > end) { setWarn('O início do período não pode ser depois do fim.'); return false; }
    const ov = DB.tecOverlap(start, end);
    if (ov) {
      setWarn(`Este intervalo se sobrepõe ao retrato de ${formatDateShort(ov.startDate)} a ${formatDateShort(ov.endDate)}${ov.label ? ' (' + ov.label + ')' : ''}. Para alterar aquele período, exclua-o antes de reimportar.`);
      return false;
    }
    setWarn(null);
    return true;
  },
  // Lê o arquivo enviado. .xlsx/.xls/.csv via SheetJS; texto puro como fallback.
  handleFile(file) {
    if (!file) return;
    const fnEl = document.getElementById('tec-file-name');
    const prev = document.getElementById('tec-import-preview');
    fnEl.style.display = 'inline-flex';
    fnEl.textContent = '📎 ' + file.name;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const finish = (rows) => {
      this._parsedRows = rows;
      const discs = TecEngine.disciplinas({ rows });
      if (rows.length === 0) {
        prev.textContent = '⚠ Não reconheci dados de desempenho neste arquivo. Confira se é a tabela de desempenho por assunto.';
        prev.style.color = 'var(--warn)';
      } else {
        const tot = TecEngine.totais({ rows });
        prev.textContent = `✓ ${discs.length} disciplina(s), ${rows.length} linha(s) · ${tot.questoes} questões · ${tot.pct}% de acerto geral`;
        prev.style.color = 'var(--good)';
      }
    };
    // CSV é texto puro: lê direto (funciona offline, sem biblioteca alguma)
    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (e) => finish(TecEngine.parse(e.target.result));
      reader.readAsText(file);
      return;
    }
    // Fallback via SheetJS (usado só se o leitor embutido falhar OU para .xls antigo).
    // Carrega a biblioteca SOB DEMANDA (não vem no caminho crítico da abertura).
    const trySheetJS = async () => {
      prev.textContent = 'Carregando leitor de planilha…'; prev.style.color = 'var(--text-faint)';
      const ok = await ensureSheetJS();
      if (!ok || typeof XLSX === 'undefined') {
        prev.textContent = (ext === 'xls')
          ? '⚠ Formato .xls antigo requer internet. No Excel/Calc, salve como .xlsx e reenvie.'
          : '⚠ Não consegui ler a planilha. Exporte como .csv ou cole os dados manualmente.';
        prev.style.color = 'var(--warn)';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          // IMPORTANTE: SheetJS type:'array' espera Uint8Array (não ArrayBuffer cru).
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array', cellDates: false });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) { finish([]); return; }
          // Corrige o bug do <dimension> incorreto (arquivos LibreOffice): recalcula o range real
          try { const ref = XLSX.utils.encode_range(XLSX.utils.decode_range(ws['!ref'])); ws['!ref'] = ref; } catch (e0) { _quiet(e0); }
          let rows = [];
          try {
            const tsv = XLSX.utils.sheet_to_csv(ws, { FS: '\t', RS: '\n', blankrows: false });
            rows = TecEngine.parse(tsv);
          } catch (e2) { rows = []; }
          if (rows.length === 0) {
            const cellRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
            rows = TecEngine.parseCellRows(cellRows);
          }
          finish(rows);
        } catch (err) {
          console.error(err);
          prev.textContent = '⚠ Erro ao ler o arquivo. Tente exportar como .csv ou cole os dados manualmente.';
          prev.style.color = 'var(--bad)';
        }
      };
      reader.readAsArrayBuffer(file);
    };
    if (ext === 'xls') { trySheetJS(); return; } // .xls binário antigo: só via SheetJS
    if (ext === 'xlsx') {
      // Leitor .xlsx EMBUTIDO como PRIMÁRIO: funciona offline e ignora o <dimension>
      // incorreto que faz o SheetJS ler só o cabeçalho (0 linhas). SheetJS vira fallback.
      prev.textContent = 'Lendo planilha…'; prev.style.color = 'var(--text-faint)';
      MiniXLSX.readFirstSheet(file)
        .then((res) => {
          const rows = TecEngine.parseCellRows(res.rows);
          if (rows.length === 0) { trySheetJS(); return; }  // embutido não achou linhas → tenta SheetJS sob demanda
          finish(rows);
        })
        .catch((err) => { console.error(err); trySheetJS(); });
      return;
    }
    // txt/tsv: lê como texto e usa o parser de colagem
    const reader = new FileReader();
    reader.onload = (e) => finish(TecEngine.parse(e.target.result));
    reader.readAsText(file);
  },
  updateImportPreview() {
    // digitar no textarea descarta o arquivo carregado (a colagem passa a valer)
    this._parsedRows = null;
    const fn = document.getElementById('tec-file-name');
    fn.style.display = 'none'; fn.textContent = '';
    $id('tec-file-input').value = '';
    const text = $id('tec-import-text').value;
    const rows = TecEngine.parse(text);
    const discs = TecEngine.disciplinas({ rows });
    const prev = document.getElementById('tec-import-preview');
    /* BUG CORRIGIDO — o preview declarava sucesso em dado inutilizavel.
       Se nenhuma DISCIPLINA e reconhecida (acontece quando a coluna Hierarquia
       vem preenchida tambem nas disciplinas, ou quando faltam colunas), o app
       exibia "✓ 0 disciplina(s)" em VERDE e deixava salvar. O retrato entrava
       zerado e a tela inteira mostrava 0% sem explicar nada.
       Agora o preview diz o que houve e como resolver — antes de salvar. */
    if (rows.length === 0) {
      prev.textContent = text.trim()
        ? '⚠ Nenhuma linha reconhecida. Confira se copiou a tabela inteira, com as colunas de questões e % de acertos.'
        : 'Aguardando dados...';
      prev.style.color = text.trim() ? 'var(--warn-text, var(--warn))' : 'var(--text-faint)';
      return;
    }
    const tot = TecEngine.totais({ rows });
    if (discs.length === 0) {
      prev.textContent = '⚠ ' + rows.length + ' linha(s) lida(s), mas nenhuma DISCIPLINA foi reconhecida. '
        + 'No export do TecConcursos a linha da disciplina vem com a coluna "Hierarquia" VAZIA — só os tópicos têm código (01, 01.01). '
        + 'Verifique se essa coluna foi copiada junto.';
      prev.style.color = 'var(--bad)';
      return;
    }
    if (tot.questoes === 0) {
      prev.textContent = '⚠ ' + discs.length + ' disciplina(s) reconhecida(s), mas nenhuma questão. '
        + 'Confira se as colunas de "Questões Resolvidas" e "% de acertos" vieram no que foi colado.';
      prev.style.color = 'var(--bad)';
      return;
    }
    prev.textContent = `✓ ${discs.length} disciplina(s), ${rows.length} linha(s) · ${tot.questoes.toLocaleString('pt-BR')} questões · ${tot.pct}% de acerto geral`;
    prev.style.color = 'var(--good)';
  },
  saveImport() {
    if (!this.validateRange()) { showToast('Ajuste o intervalo de datas antes de salvar'); return; }
    // usa os dados do arquivo, se houver; senão o texto colado
    const rows = (this._parsedRows && this._parsedRows.length)
      ? this._parsedRows
      : TecEngine.parse($id('tec-import-text').value);
    if (!rows || rows.length === 0) { showToast('Envie um arquivo válido ou cole os dados'); return; }
    const start = $id('tec-import-start').value;
    const end = $id('tec-import-end').value;
    const snap = {
      id: Date.now(),
      startDate: start,
      endDate: end,
      date: start, // compat: mantém `date` = início
      label: $id('tec-import-label').value.trim(),
      bancas: (document.getElementById('tec-import-bancas') || {}).value ? $id('tec-import-bancas').value.trim() : '',
      rows,
      importedAt: new Date().toISOString()
    };
    DB.saveTecSnapshot(snap);
    this.currentSnapId = snap.id;
    // garante que o novo retrato entre no escopo atual (marcado na seleção)
    if (this.selectedSnapIds) this.selectedSnapIds.add(snap.id);
    // amplia o intervalo para cobrir o novo período, se o modo for 'range'
    if (!this.rangeEnd || snap.endDate > this.rangeEnd) this.rangeEnd = snap.endDate;
    if (!this.rangeStart || snap.startDate < this.rangeStart) this.rangeStart = snap.startDate;
    this._parsedRows = null;
    showToast('Importação salva ✓');
    this.render();
  },
  // rótulo curto do intervalo de um retrato (ex.: "04/03 → 05/08")
  rangeLabel(s) {
    if (s.startDate === s.endDate) return `${formatDateShort(s.startDate)}`;
    return `${formatDateShort(s.startDate)} → ${formatDateShort(s.endDate)}`;
  },
  // Sincroniza os controles de escopo (botões, painéis, meta) com o estado atual
  renderScopeControls(snaps) {
    // destaca o modo ativo
    document.querySelectorAll('#tec-scope-toggle button').forEach(b =>
      b.classList.toggle('active', b.dataset.scope === this.scopeMode));
    const selPanel = document.getElementById('tec-scope-select');
    const rangePanel = document.getElementById('tec-scope-range');
    selPanel.style.display = this.scopeMode === 'select' ? 'block' : 'none';
    rangePanel.style.display = this.scopeMode === 'range' ? 'block' : 'none';
    if (this.scopeMode === 'select') this.renderScopeSelectPanel(snaps);
    if (this.scopeMode === 'range') this.syncRangeInputs(snaps);
    // com os filtros recolhidos, o cabecalho precisa dizer o que esta valendo
    try { if (window.PainelRecolhivel) PainelRecolhivel.sincronizar('tec-escopo'); }
    catch (e) { _quiet(e, 'resumo-escopo-tec'); }
    // meta (resumo do que está sendo analisado)
    const active = this.activeSnapshots();
    const meta = document.getElementById('tec-snap-meta');
    if (active.length === 0) {
      meta.textContent = 'Nenhum retrato no escopo atual — ajuste a seleção ou o intervalo.';
    } else if (active.length === 1) {
      const s = active[0];
      meta.textContent = `1 retrato · período ${this.rangeLabel(s)}` + (s.label ? ` · ${s.label}` : '');
    } else {
      const starts = active.map(s => s.startDate).sort();
      const ends = active.map(s => s.endDate).sort();
      meta.textContent = `${active.length} retratos consolidados · de ${formatDateShort(starts[0])} a ${formatDateShort(ends[ends.length - 1])} · questões e acertos somados, % recalculado`;
    }
  },
  // Lista de retratos com checkbox (marcar/desmarcar) + exclusão individual
  renderScopeSelectPanel(snaps) {
    const box = document.getElementById('tec-scope-select');
    const rows = snaps.slice().reverse().map(s => {
      const tot = TecEngine.totais(s);
      const checked = this.selectedSnapIds.has(s.id);
      const lbl = s.label ? ` · ${escapeHtml(s.label)}` : '';
      return `<label class="tec-snap-pick" data-id="${s.id}">
        <input type="checkbox" data-snap="${s.id}" ${checked ? 'checked' : ''}>
        <span class="tsp-main"><b>${this.rangeLabel(s)}</b>${lbl}</span>
        <span class="tsp-stats">${tot.questoes} q · ${tot.pct}%</span>
        <button type="button" class="icon-btn danger tsp-del" title="Excluir este retrato" aria-label="Excluir este retrato">×</button>
      </label>`;
    }).join('');
    box.innerHTML = `
      <div class="tec-scope-actions">
        <button type="button" class="tec-tree-btn" id="tec-scope-all">Marcar todos</button>
        <button type="button" class="tec-tree-btn" id="tec-scope-none">Limpar</button>
        <span class="hint" style="margin:0 0 0 auto;">${this.selectedSnapIds.size} de ${snaps.length} selecionado(s)</span>
      </div>
      <div class="tec-scope-list">${rows}</div>`;
    box.querySelectorAll('input[data-snap]').forEach(cb => cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.snap, 10);
      if (cb.checked) this.selectedSnapIds.add(id); else this.selectedSnapIds.delete(id);
      this.renderScopeControls(DB.getTecSnapshots());
      this.renderAnalysis();
    }));
    box.querySelectorAll('.tsp-del').forEach(btn => btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = parseInt(btn.closest('.tec-snap-pick').dataset.id, 10);
      const s = DB.getTecSnapshots().find(x => x.id === id);
      if (!s) return;
      UI.confirm(`Excluir o retrato do período ${this.rangeLabel(s)}${s.label ? ' (' + s.label + ')' : ''}? Essa ação não pode ser desfeita.`, { title: 'Excluir retrato', okText: 'Excluir', danger: true }).then(ok => {
        if (!ok) return;
        DB.deleteTecSnapshot(id);
        this.selectedSnapIds.delete(id);
        showToast('Retrato excluído');
        this.render();
      });
    }));
    const allBtn = box.querySelector('#tec-scope-all');
    const noneBtn = box.querySelector('#tec-scope-none');
    if (allBtn) allBtn.addEventListener('click', () => { snaps.forEach(s => this.selectedSnapIds.add(s.id)); this.renderScopeControls(DB.getTecSnapshots()); this.renderAnalysis(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { this.selectedSnapIds.clear(); this.renderScopeControls(DB.getTecSnapshots()); this.renderAnalysis(); });
  },
  syncRangeInputs(snaps) {
    const startEl = document.getElementById('tec-range-start');
    const endEl = document.getElementById('tec-range-end');
    if (startEl) startEl.value = this.rangeStart || snaps[0].startDate;
    if (endEl) endEl.value = this.rangeEnd || snaps[snaps.length - 1].endDate;
  },
  // snapshot anterior ao retrato em foco — só faz sentido quando o escopo é UM retrato.
  // Nesse caso, compara com o retrato imediatamente anterior no tempo (mostra a evolução).
  /* ── A COMPARAÇÃO QUE NUNCA APARECIA ──────────────────────────────────────
     `prevSnap` devolvia null sempre que o escopo tinha mais de um retrato — e o
     escopo padrão é "Consolidado (todos)". Resultado: o ▲▼ do aproveitamento e
     as setas de TODOS os nós da árvore só existiam para quem soubesse
     selecionar manualmente um único retrato. Para todo mundo, a evolução
     simplesmente não vinha — e "sem seta" se lê como "não mudou".

     A comparação agora é sempre entre DOIS RETRATOS: o mais novo do escopo e o
     imediatamente anterior a ele. É a única comparação honesta possível aqui —
     confrontar o agregado de cinco retratos com um retrato só compararia
     coisas de tamanhos diferentes. Por isso todo delta desta aba vem rotulado
     com o que está sendo comparado. */
  ultimoSnapDoEscopo() {
    const active = this.activeSnapshots();
    return active.length ? active[active.length - 1] : null;
  },
  prevSnap() {
    const active = this.activeSnapshots();
    if (!active.length) return null;
    if (active.length >= 2) return active[active.length - 2];
    const all = DB.getTecSnapshots();
    const idx = all.findIndex(s => s.id === active[0].id);
    return idx > 0 ? all[idx - 1] : null;
  },
  // rótulo curto do que o ▲▼ está comparando (vai no título e na legenda)
  rotuloComparacao() {
    const u = this.ultimoSnapDoEscopo(), p = this.prevSnap();
    if (!u || !p) return null;
    /* Só as datas de FIM. `rangeLabel` já devolve "início → fim" quando o
       retrato cobre um intervalo, e juntar dois desses com outra seta produzia
       "11/08 → 05/09 → 06/09 → 08/09": quatro datas e nenhuma leitura possível
       de quem é o antes e quem é o depois. */
    const fim = (s) => formatDateShort(s.endDate || s.date || s.startDate);
    return `${fim(p)} → ${fim(u)}`;
  },
  renderAnalysis() {
    const snap = this.scopedSnapshot();
    const wrap = document.getElementById('tec-panel-analise');
    if (!snap) {
      if (wrap) wrap.querySelectorAll('#tec-totais, #tec-weak-list, #tec-disc-list').forEach(el => { if (el) el.innerHTML = ''; });
      const t = document.getElementById('tec-totais'); if (t) t.innerHTML = '<div class="evo-empty-mini" style="grid-column:1/-1;">Nenhum retrato no escopo atual. Ajuste a seleção ou o intervalo de datas acima.</div>';
      return;
    }
    this.aplicarPrefsAnalise();
    this.renderTotais(snap);
    this.renderWeak(snap);
    this.renderDisciplinas(snap);
  },
  /* ── UMA RÉGUA SÓ ─────────────────────────────────────────────────────────
     O limiar de "ponto fraco" desta aba nascia com 70%, enquanto o Plano
     trabalha com meta de 80% e teto realista de 90%. O mesmo tópico podia ser
     "ponto fraco" aqui e "em desenvolvimento" lá, e nada na tela ligava um
     número ao outro. Agora o limiar NASCE da meta do Plano — e continua seu
     para mudar quando quiser, porque a partir daí a escolha fica salva.

     O mínimo de questões também sobe de 3 para 10: com três questões, uma taxa
     de acerto não é diagnóstico (ver a margem de erro que agora aparece em
     cada linha). */
  aplicarPrefsAnalise() {
    const p = this._loadPrefs();
    const metaPlano = (typeof PlanoEngine !== 'undefined') ? PlanoEngine.prefs().metaDominio : 70;
    const set = (id, v) => { const e = document.getElementById(id); if (e && v != null) e.value = v; };
    set('tec-weak-threshold', p.weakLimiar != null ? p.weakLimiar : metaPlano);
    set('tec-weak-minq', p.weakMinQ != null ? p.weakMinQ : 10);
    set('tec-weak-ordenar', p.weakOrdenar || 'taxa');
    const lv = document.getElementById('tec-weak-leaves');
    if (lv && p.weakLeaves != null) lv.checked = !!p.weakLeaves;
  },
  // ---- Abas (Análise / Incidência / Reforço) ----
  tecTab: 'analise',
  switchTecTab(tab) {
    this.tecTab = tab;
    document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(b => b.classList.toggle('active', b.dataset.tectab === tab));
    ['analise', 'incidencia', 'reforco', 'plano'].forEach(t => {
      const el = document.getElementById('tec-panel-' + t);
      if (el) el.style.display = (t === tab) ? 'block' : 'none';
    });
    if (tab === 'incidencia') this.renderIncidencia();
    if (tab === 'reforco') this.renderReforco();
    if (tab === 'plano') this.renderPlano();
    try { TecAjustes.sincronizar(); } catch (e) { _quiet(e, 'resumo-abas'); }
    this.applyCfgHidden();
  },
  // ---- Plano de pontos fracos ----
  // Cria uma Atividade Extra ligada a um assunto do plano — fecha o ciclo:
  // você resolve as questões, importa o novo retrato, e a métrica decide se acabou.
  /* Retrato do Plano reaproveitado por alguns segundos: criar sete atividades
     em lote recalculava a tela inteira sete vezes só para descobrir a taxa
     inicial de cada assunto — o mesmo número, sete vezes. */
  _planoRef() {
    const agora = Date.now();
    if (this._planoRefC && agora - this._planoRefC.t < 3000) return this._planoRefC.r;
    const r = PlanoEngine.calcular(this.scopedSnapshot(), PlanoEngine.prefs());
    this._planoRefC = { t: agora, r };
    return r;
  },
  /* ── UMA ATIVIDADE PERTENCE A UM ASSUNTO, NÃO A UM NOME ──────────────────
     O vínculo entre a linha do Plano e a atividade criada para ela era feito só
     pelo NOME do tópico. Enquanto o motor somava homônimos isso passava; agora
     que "Atos" de Administrativo e "Atos" de Constitucional são duas linhas de
     verdade, o nome sozinho junta o que o cálculo separou: criar a segunda
     atividade era recusado com "já existe", e as duas linhas exibiam o MESMO
     progresso — uma delas aparecia concluída sem que ninguém a tivesse feito.

     A disciplina entra no casamento; quando um dos lados não a registra (as
     atividades criadas antes disto), o nome ainda decide, para que nenhum
     vínculo já existente se perca. */
  _casaTopico(origem, nome, disciplina) {
    if (!origem || ReforcoEngine.norm(origem.topico) !== ReforcoEngine.norm(nome)) return false;
    const a = ReforcoEngine.norm(origem.disciplina || ''), b = ReforcoEngine.norm(disciplina || '');
    return (!a || !b) ? true : a === b;
  },
  // `lote` = criação em série: sem aviso por item e sem repintar a cada um.
  // Devolve true quando a atividade nasceu, para o chamador contar.
  criarExtraDoPlano(topico, disciplina, alvo, motivo, lote) {
    /* Só uma atividade ABERTA bloqueia. Uma já encerrada é história: o assunto
       pode ter voltado a cair — e no caso do veredito "não funcionou" ele
       PRECISA de um ataque novo, de outro tipo. Recusar por causa dela
       trancava justamente o assunto que mais pede uma segunda tentativa. */
    const jaTem = DB.getExtras().find(e => e.status !== 'concluida' && this._casaTopico(e.origemPlano, topico, disciplina));
    if (jaTem) { if (!lote) showToast('Já existe uma atividade em aberto para "' + topico + '"'); return false; }
    const diag = motivo === 'diagnostico';
    const e = DB.addExtra({
      titulo: (diag ? 'Diagnosticar: ' : 'Reforçar: ') + topico,
      tipo: 'questoes',
      disciplina: disciplina || '',
      unidade: 'questoes',
      alvo: Math.max(1, parseInt(alvo, 10) || 30),
      periodo: 'unica',
      contaMetricas: false,
      obs: diag
        ? 'Gerado pelo Plano: amostra insuficiente. Resolva estas questões para saber se é fraqueza real.'
        : 'Gerado pelo Plano de pontos fracos. Ao importar o próximo retrato do TEC, a métrica dirá se o assunto saiu da lista.'
    });
    if (e) {
      const r0 = this._planoRef();
      const alvoTop = [].concat((r0 && r0.itens) || [], (r0 && r0.pequenas) || [])
        .find(t => this._casaTopico({ topico: t.nome, disciplina: t.disciplina }, topico, disciplina));
      // um só lugar monta a origem: os dois portões gravam exatamente o mesmo
      DB.updateExtra(e.id, { origemPlano: PlanoCiclo.origem(topico, disciplina, alvoTop, { motivo: motivo || 'reforco' }) });
      if (!lote) {
        showToast('Atividade criada: ' + (diag ? 'diagnosticar ' : 'reforçar ') + topico);
        this.renderPlanoConteudo();
      }
      return true;
    }
    return false;
  },
  renderPlano() {
    const p = PlanoEngine.prefs();
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const chk = (id, v) => { const e = document.getElementById(id); if (e) e.checked = !!v; };
    set('plano-meta', p.metaDominio); set('plano-teto', p.tetoDominio);
    set('plano-ponderacao', p.ponderacao); set('plano-minamostra', p.minAmostra);
    set('plano-customodo', p.custoModo); set('plano-custofixo', p.custoFixo);
    set('plano-custofator', p.custoFator); set('plano-limite', p.limite);
    set('plano-custopiso', p.custoPiso); set('plano-custoponto', p.custoPorPonto);
    set('plano-pesobanca', p.pesoBanca);
    const lblPB = document.getElementById('plano-pesobanca-label');
    if (lblPB) lblPB.textContent = p.pesoBanca === 0 ? '0 — banca ignorada' : String(p.pesoBanca);
    chk('plano-folhas', p.apenasFolhas); chk('plano-pequenas', p.incluirPequenas);
    set('plano-amostraalvo', p.amostraAlvo); set('plano-cadencia', p.cadenciaDias); set('plano-ordenar', p.ordenar);
    /* Os rótulos das sete ordens existiam em TRÊS lugares: neste select, no
       diálogo "Puxar do Plano" e no texto que explica a ordem escolhida. Três
       cópias divergem — uma renomeada, as outras não. Agora o select nasce da
       mesma tabela que explica os cenários, e cada opção carrega o "quando
       usar" como dica. As opções do HTML continuam lá como base: se o JS não
       rodar, o campo ainda funciona. */
    const os_ = document.getElementById('plano-ordenar');
    if (os_ && typeof PlanoEngine.ORDENS === 'object') {
      /* A ordem por PONTOS só existe com edital preenchido. Oferecê-la vazia
         seria uma opção que não muda nada — e uma ordem que não ordena é a
         forma mais rápida de a pessoa perder a confiança na tela. Com o edital
         publicado e a composição em branco, ela aparece desabilitada dizendo o
         que falta, em vez de sumir sem explicação. */
      const podePontos = (typeof PlanoPontos !== 'undefined') && PlanoPontos.temComposicao();
      const ehPos = (typeof PlanoPontos !== 'undefined') && PlanoPontos.modo() === 'pos';
      os_.innerHTML = Object.keys(PlanoEngine.ORDENS).map(k => {
        const o = PlanoEngine.ORDENS[k];
        if (o.soPos && !ehPos) return '';
        const off = o.soPos && !podePontos;
        return `<option value="${k}" title="${escapeHtml(o.quando)}"${k === p.ordenar && !off ? ' selected' : ''}${off ? ' disabled' : ''}>${escapeHtml(o.rot)}${off ? ' (preencha a composição da prova)' : ''}</option>`;
      }).join('');
      if (![...os_.options].some(o => o.value === p.ordenar && !o.disabled)) os_.value = 'pior';
    }
    set('plano-janelamax', p.janelaMax); set('plano-consolidar', p.consolidarEm); set('plano-validade', p.validadeDias);
    set('plano-critico', p.faixaCritico); set('plano-fragil', p.faixaFragil);
    set('plano-piso', p.pisoSerie); set('plano-sens', p.sensTendencia);
    const desc = DB.getTecSnapshots().slice().reverse();
    set('plano-ritmo', p.ritmoSemanal || PlanoEngine.ritmoRecente(desc, 120, PlanoEngine.excluidasSet(p)) || 25);
    /* Uma matéria fora do Plano não pode continuar na lista do filtro: o motor
       já não a enxerga, e escolhê-la levaria a uma tela vazia sem explicação.
       Ela volta à lista no instante em que você a desmarcar. */
    this._sincronizarFiltroDisc();
    this.renderExcluidasPicker('plano-excluidas-pick');
    // Seletor de banca: só aparece quando há dados de incidência importados.
    // Alimenta a ordenação "🎯 Prioridade na banca".
    const bf = document.getElementById('plano-banca-field');
    if (bf) {
      const temInc = (typeof ReforcoEngine !== 'undefined') && ReforcoEngine.hasIncidencia && ReforcoEngine.hasIncidencia();
      bf.style.display = temInc ? '' : 'none';
      if (temInc) this.renderBancaPicker('plano-banca-pick');
    }
    this.renderModosDeAtaque();
    this.renderPlanoConteudo();
  },
  /* ── MODO DE ATAQUE ───────────────────────────────────────────────────────
     Um preset por pergunta, e a pergunta escrita por extenso. Antes desta faixa
     a tela oferecia sete ordenações e dezenove parâmetros sem nenhuma frase
     dizendo quando usar cada coisa — e quem não sabe escolher não escolhe:
     fica no padrão e desconfia do resultado.
     Os chips não travam nada. Mexeu num campo, o rótulo volta para "livre" e o
     modo escolhido deixa de aparecer marcado. */
  renderModosDeAtaque() {
    const box = document.getElementById('plano-modos');
    const nota = document.getElementById('plano-modo-nota');
    if (!box) return;
    const p = PlanoEngine.prefs();
    const ativo = PlanoEngine.modoAtivo(p);
    const temInc = (typeof ReforcoEngine !== 'undefined') && ReforcoEngine.hasIncidencia && ReforcoEngine.hasIncidencia();
    box.innerHTML = `<span class="pl-modos-rot">Modo de ataque</span>` +
      Object.keys(PlanoEngine.MODOS).map(k => {
        const m = PlanoEngine.MODOS[k];
        const bloqueado = m.exige === 'incidencia' && !temInc;
        const editado = PlanoEngine.modoEditado(k);
        return `<span class="pl-modo-wrap">
          <button type="button" class="pl-modo${ativo === k ? ' on' : ''}${bloqueado ? ' off' : ''}" data-modo="${k}"
            title="${escapeHtml(m.quando + ' — ' + PlanoEngine.resumoModo(k))}">${m.rot}${editado ? ' <i class="pl-modo-edit-dot" title="Ajustado por você">•</i>' : ''}<small>${m.fase}</small></button>
          <button type="button" class="pl-modo-edit" data-editar="${k}" title="Ajustar os parâmetros deste modo" aria-label="Ajustar ${escapeHtml(m.rot)}">✎</button>
        </span>`;
      }).join('') +
      /* "Livre" é ESTADO, não ação: é onde você cai ao mexer num campo, e um
         botão que não faz nada ao ser tocado ensina que a faixa toda é
         decorativa. Por isso sai como marcador, e só aparece quando é o caso. */
      (ativo === 'livre' ? `<span class="pl-modo on estado" title="Seus ajustes, do seu jeito — é o que fica valendo assim que você mexe em qualquer campo.">✏️ Livre<small>seus ajustes</small></span>` : '');
    if (nota) {
      const m = PlanoEngine.MODOS[ativo];
      nota.innerHTML = m
        ? `<p class="pl-modo-nota"><strong>${m.rot} · ${escapeHtml(m.fase)}</strong> — ${escapeHtml(m.quando)}<br><span>${escapeHtml(m.porque)}</span>
             <br><span class="pl-modo-param">Aplica: ${escapeHtml(PlanoEngine.resumoModo(ativo))}${PlanoEngine.modoEditado(ativo) ? ' · ajustado por você' : ''} — toque em ✎ para mudar.</span>
             ${(m.exige === 'incidencia' && !temInc) ? '<br><em>Sem dados de incidência importados, esta ordem não tem como funcionar: importe em 🏛️ Incidência.</em>' : ''}</p>`
        : `<p class="pl-modo-nota"><strong>✏️ Modo livre</strong> — seus ajustes não correspondem a nenhum preset. Toque num modo acima para partir de um conjunto coerente; nada do que você configurou se perde antes disso.</p>`;
    }
    box.querySelectorAll('.pl-modo').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.modo;
      if (k === 'livre') return;
      if (!PlanoEngine.MODOS[k]) return;
      PlanoEngine.salvarPrefs(PlanoEngine.modoPatch(k));
      this.renderPlano();
      showToast(PlanoEngine.MODOS[k].rot + ' aplicado');
    }));
    box.querySelectorAll('.pl-modo-edit').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.editarModo(b.dataset.editar);
    }));
    try { if (window.InfoTips) InfoTips.upgrade(); } catch (e) { _quiet(e, 'info-modos'); }
  },
  /* Editar um modo: os mesmos parâmetros do painel de ajustes, só que salvos
     COMO o modo — e com a volta ao padrão de fábrica no mesmo lugar, por modo,
     sem levar os outros quatro junto. */
  async editarModo(k) {
    const m = PlanoEngine.MODOS[k];
    if (!m) return;
    // se o modo em edição é o que está valendo agora, o ajuste tem de valer já
    const eraAtivo = (PlanoEngine.modoAtivo() === k);
    /* Valores EFETIVOS: o que vai valer se você aplicar este modo agora. Um
       modo que não fixa a meta herda a que está valendo — ler só o patch dele
       abria o diálogo com campos vazios, e salvar assim gravava NaN. */
    const p = Object.assign({}, PlanoEngine.prefs(), PlanoEngine.modoPatch(k));
    /* ── O DIÁLOGO NASCE DA LISTA DE CAMPOS DO MODO ────────────────────────
       Era uma lista escrita à mão aqui, e ela divergiu do que um modo controla:
       oferecia o passo de leitura (que os presets tinham deixado de mexer de
       propósito) e omitia a amostra mínima, o peso da banca e a régua de custo
       — os três parâmetros que dão sentido a "Diagnóstico", "Edital publicado"
       e "Tempo curto". Agora há UMA fonte (`PlanoEngine.MODO_CAMPOS`), e o que
       o diálogo mostra é exatamente o que o modo é capaz de guardar. */
    const ordens = Object.keys(PlanoEngine.ORDENS)
      .filter(x => !PlanoEngine.ORDENS[x].soPos || (typeof PlanoPontos !== 'undefined' && PlanoPontos.modo() === 'pos'))
      .map(x => ({ value: x, label: PlanoEngine.ORDENS[x].rot }));
    const campos = PlanoEngine.MODO_CAMPOS.map(c => {
      const valor = (c.tipo === 'bool') ? (p[c.key] ? '1' : '0') : p[c.key];
      if (c.tipo === 'ordens') return { key: c.key, label: c.label, type: 'select', value: valor, options: ordens, hint: c.hint };
      if (c.tipo === 'select' || c.tipo === 'bool') {
        return { key: c.key, label: c.label, type: 'select', value: String(valor),
          options: (c.op || []).map(([v, l]) => ({ value: v, label: l })), hint: c.hint };
      }
      return { key: c.key, label: c.label, type: 'number', value: valor, min: c.min, max: c.max, hint: c.hint };
    });
    campos.push({ key: 'restaurar', label: 'Restaurar o padrão deste modo', type: 'select', value: '0',
      hint: 'Descarta os seus ajustes SÓ deste modo e volta ao padrão de fábrica.',
      options: [{ value: '0', label: 'Não, salvar o que está acima' }, { value: '1', label: '↺ Sim, voltar ao padrão' }] });
    const r = await UI.prompt(campos, { title: 'Ajustar ' + m.rot, sub: m.quando, okText: 'Salvar modo' });
    if (!r) return;
    if (String(r.restaurar) === '1') {
      PlanoEngine.restaurarModo(k);
      showToast(m.rot + ' voltou ao padrão ✓');
    } else {
      /* Só os campos que a pessoa REALMENTE mexeu entram no modo. Gravar todos
         faria um modo herdar decisões que ele não quis tomar, e um "salvar"
         sem alteração nenhuma marcaria o modo como personalizado. */
      const novo = {};
      PlanoEngine.MODO_CAMPOS.forEach(c => {
        const bruto = r[c.key];
        if (bruto === undefined || bruto === null || bruto === '') return;
        if (c.tipo === 'bool') { novo[c.key] = String(bruto) === '1'; return; }
        if (c.tipo === 'num' || c.numerico) {
          const n = parseInt(bruto, 10);
          if (isNaN(n)) return;
          novo[c.key] = Math.max(c.min != null ? c.min : 0, Math.min(c.max != null ? c.max : 100000, n));
          return;
        }
        novo[c.key] = bruto;
      });
      const mudou = {};
      Object.keys(novo).forEach(c => { if (String(novo[c]) !== String(p[c])) mudou[c] = novo[c]; });
      if (Object.keys(mudou).length) { PlanoEngine.salvarModo(k, mudou); showToast(m.rot + ' ajustado ✓'); }
      else showToast('Nada mudou neste modo');
    }
    if (eraAtivo) PlanoEngine.salvarPrefs(PlanoEngine.modoPatch(k));
    this.renderPlano();
  },
  /* Texto pronto para viver dentro de um atributo `data-info`: o que vem de
     dado do usuário já passou por escapeHtml (que não deixa aspa crua), então
     só sobra fechar as aspas duplas da nossa própria redação. */
  _info(html) { return String(html == null ? '' : html).replace(/"/g, '&quot;'); },

  /* ── POR QUE ESTA MATÉRIA ESTÁ NESTA POSIÇÃO ──────────────────────────────
     A pergunta que o quadro "Onde atacar primeiro" nunca respondia — e a
     dúvida exata de quem olha a tela: "tenho matérias com percentual menor
     que aparecem muito depois; por quê?".

     A resposta não cabe numa célula de tabela, e escrevê-la em cada linha era
     o que transformava o quadro numa parede de texto. Ela vira uma análise
     completa, atrás do "i" da linha: a conta do prêmio feita com os números
     daquela matéria, quem está imediatamente acima e abaixo dela na fila, um
     CONTRAEXEMPLO tirado da própria tela (uma matéria em que você acerta menos
     e que mesmo assim aparece depois) e o que fazer a respeito.

     Devolve { titulo, html } — o `html` é montado aqui, com todo dado do
     usuário já escapado, e abre em `UI.detalhe` (ver o porquê lá). */
  _analiseMateria(l, pos, tm, VER, grandes, alvo, r) {
    const [ic, tom, rot, frase] = VER[l.veredito] || ['', '', '', ''];
    const n = grandes.length;
    const pp = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ',') + ' pp');
    const pc = (v) => (v == null ? '—' : ((v > 0 && v < 0.5) ? '<1%' : v.toFixed(0) + '%'));
    const base = l.taxa != null ? l.taxa : (tm.taxaGeral != null ? tm.taxaGeral : 50);
    const lacuna = Math.max(0, tm.teto - base);
    const acima = grandes[pos - 2], abaixo = grandes[pos];
    const b = [];
    b.push(`<p class="pl-det-lead">Das <b>${n}</b> matérias do quadro, esta é a <b>${pos}ª</b>. A fila é ordenada por <b>pontos em jogo</b> — e aqui estão <b>${pp(l.ganho)}</b> da prova inteira.</p>`);

    b.push('<p class="pl-det-rot">1 · De onde sai esse número</p>');
    if (l.sharePeso != null && l.sharePeso > 0) {
      b.push(`<p class="pl-det-conta"><b>${pc(l.sharePeso)}</b> <i>peso na prova</i> × <b>${lacuna.toFixed(0)} pontos</b> <i>de lacuna</i> = <b>${pp(l.ganho)}</b></p>`);
      b.push(`<p>A lacuna é a distância entre ${l.taxa != null ? `o seu nível medido (<b>${l.taxa.toFixed(0)}%</b>)` : `o nível estimado (<b>${base.toFixed(0)}%</b>)`} e o máximo realista que você configurou (<b>${tm.teto}%</b>). Levar esta matéria até lá recupera ${pp(l.ganho)} da prova — não da matéria, da <b>prova toda</b>.</p>`);
      if (l.estimado) {
        b.push(`<p class="pl-det-alerta">Você ainda não tem questões medidas aqui: a lacuna usa a sua média geral (<b>${base.toFixed(0)}%</b>) como palpite. O número é grosseiro, mas a posição não é — sem medição, quem manda é o peso, e este é exatamente o peso que a sua prova dá a esta matéria.</p>`);
      }
    } else {
      b.push(`<p>Esta matéria <b>não aparece no peso da sua prova</b> ${tm.fontePeso === 'edital' ? '(a composição que você declarou não a inclui)' : '(a incidência das suas bancas não a registra)'}. Sem peso não há prêmio a calcular: ela fica no fim da fila por definição, não por você ir bem nela.</p>`);
    }

    b.push('<p class="pl-det-rot">2 · Onde ela está na fila</p>');
    const viz = [];
    if (acima) viz.push(`<li>logo acima: <b>${escapeHtml(acima.nome)}</b> — ${pp(acima.ganho)}</li>`);
    viz.push(`<li><b>${escapeHtml(l.nome)}</b> — ${pp(l.ganho)} <i>(esta)</i></li>`);
    if (abaixo) viz.push(`<li>logo abaixo: <b>${escapeHtml(abaixo.nome)}</b> — ${pp(abaixo.ganho)}</li>`);
    b.push(`<ul class="pl-det-lista">${viz.join('')}</ul>`);
    b.push(`<p>No total há <b>${pp(tm.emJogo)}</b> em jogo, e as <b>${tm.nCorte}</b> primeiras concentram metade disso — é a faixa em que a próxima hora de estudo rende mais.${l.noCorte ? ' <b>Esta matéria está nessa faixa.</b>' : (l.naFila ? ' Esta está na faixa seguinte: entra assim que as de cima saírem.' : '')}</p>`);

    /* O CONTRAEXEMPLO É TIRADO DA PRÓPRIA TELA. Dizer "não é o percentual que
       ordena" em tese não convence ninguém; mostrar a matéria em que a pessoa
       acerta MENOS e que ainda assim está mais abaixo, com a conta das duas,
       responde a dúvida com o dado dela. */
    const abaixoPior = grandes.slice(pos).filter(o => o.taxa != null && l.taxa != null && o.taxa < l.taxa - 1)
      .sort((a, c) => a.taxa - c.taxa)[0];
    if (abaixoPior) {
      const pos2 = grandes.indexOf(abaixoPior) + 1;
      b.push('<p class="pl-det-rot">3 · Por que não é o seu percentual que ordena</p>');
      b.push(`<p>Em <b>${escapeHtml(abaixoPior.nome)}</b> você acerta <b>${abaixoPior.taxa.toFixed(0)}%</b> — menos que os <b>${l.taxa.toFixed(0)}%</b> daqui — e mesmo assim ela é a <b>${pos2}ª</b>. O motivo é o peso: ela vale <b>${pc(abaixoPior.sharePeso)}</b> da prova, então fechar a lacuna dela rende <b>${pp(abaixoPior.ganho)}</b>, contra os <b>${pp(l.ganho)}</b> desta.</p>`);
      b.push(`<p>É a mesma aritmética da prova: <b>ir mal numa matéria leve custa poucos pontos; ir razoavelmente numa matéria pesada custa muitos.</b> Percentual baixo dói mais no orgulho; peso alto dói mais na nota.</p>`);
    }

    b.push(`<p class="pl-det-rot">${abaixoPior ? '4' : '3'} · O seu esforço aqui</p>`);
    if (l.q > 0) {
      b.push(`<p><b>${l.q.toLocaleString('pt-BR')}</b> questões resolvidas = <b>${pc(l.shareEsforco)}</b> de tudo que você já resolveu${l.sharePeso != null ? `, para <b>${pc(l.sharePeso)}</b> da prova` : ''}${l.razao != null ? ` (razão <b>${l.razao.toFixed(1)}×</b>)` : ''}.${l.medido ? ` O nível vem da janela adaptativa: <b>${l.medido.toLocaleString('pt-BR')}</b> questões, das importações mais recentes para trás — não da sua média histórica.` : ''}</p>`);
      if (l.sobra) {
        b.push(`<p class="pl-det-alerta">Você já dedica <b>${l.razao.toFixed(1)}×</b> o peso desta matéria: proporcionalmente, é onde o seu tempo mais entra. Quando isso aparece junto de um prêmio alto, o recado não é "estude mais", é <b>estude diferente</b> — o volume que já entra aqui não está virando acerto.</p>`);
      }
    } else {
      b.push(`<p>Você <b>nunca resolveu uma questão</b> desta matéria nos retratos importados. Ela não aparece como fraca porque não aparece de jeito nenhum — e é por isso que o prêmio dela é estimado.</p>`);
    }

    b.push(`<p class="pl-det-rot">${abaixoPior ? '5' : '4'} · O que fazer</p>`);
    b.push(`<p class="pl-det-verbo"><span class="reforco-tag ${tom}">${ic} ${rot}</span> ${escapeHtml(frase)}.</p>`);
    if (l.taxa != null && r && l.taxa < r.faixaFragil) {
      b.push(`<p>O nível aqui está abaixo da sua faixa frágil (<b>${r.faixaFragil}%</b>): o caminho curto é teoria antes de volume — resolver mais questões sobre um conteúdo que ainda não assentou mede o buraco em vez de fechá-lo.</p>`);
    }
    if (alvo) {
      b.push(`<p>O botão <b>🎯 Atacar</b> desta linha filtra a lista de assuntos por <b>${escapeHtml(alvo)}</b> e leva você ao bloco de criar atividades — é o caminho da matéria para os assuntos dela.</p>`);
    } else if (l.veredito === 'manter' || l.veredito === 'foraDoPeso') {
      b.push(`<p>Não há botão de ataque nesta linha de propósito: ele convidaria a fazer exatamente o que o quadro acabou de dizer para não fazer agora.</p>`);
    }
    /* O título vai por `textContent` no diálogo: escapar aqui faria aparecer
       "&amp;" na tela de quem tem "&" no nome da matéria. */
    return { titulo: l.nome + ' — ' + pos + 'ª no prêmio', html: b.join('') };
  },
  /* ── OS NÚMEROS POR TRÁS DA TRAJETÓRIA ────────────────────────────────────
     O gráfico mostra uma linha e um crachá; os dois só se entendem com os
     volumes por trás — quantos assuntos entraram em cada importação, quantas
     questões, e qual variação é comparável. Esses volumes nunca estiveram na
     tela: o que estava eram dois parágrafos explicando números invisíveis.

     Aqui eles aparecem: a explicação primeiro, a série inteira depois. */
  _analiseTrajetoria(S, r, m) {
    if (!S || S.length < 2) return null;
    const pp = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + 'pp');
    // pt-BR: a vírgula decimal vale também aqui dentro, senão "0.7pp a cada
    // 1.000 questões" põe ponto nos dois papéis na mesma frase.
    const pc1 = (v) => (v == null ? '—' : v.toFixed(1).replace('.', ',') + '%');
    const p0 = S[0], pn = S[S.length - 1];
    const b = [];
    b.push(`<p class="pl-det-lead">São <b>${S.length}</b> importações, de <b>${escapeHtml(formatDateShort(p0.data))}</b> a <b>${escapeHtml(formatDateShort(pn.data))}</b>. Nesse intervalo o seu domínio saiu de <b>${pc1(p0.dominio)}</b> para <b>${pc1(pn.dominio)}</b>, com a cobertura indo de <b>${p0.assuntos}</b> para <b>${pn.assuntos}</b> assuntos medidos.</p>`);

    b.push('<p class="pl-det-rot">1 · O que a LINHA é</p>');
    b.push(`<p>O seu nível médio sobre <b>tudo</b> que você já tinha medido naquela data. Ela mistura duas coisas: o quanto você melhorou e o quanto você ampliou. Abrir frente nova entra na média com a taxa baixa de quem está começando — então a linha pode <b>cair</b> num período em que todo assunto individual subiu.${m.divergem ? ` Foi o que aconteceu aqui: a linha ${pn.dominio >= p0.dominio ? 'subiu só' : 'caiu'} de ${p0.dominio.toFixed(0)}% para ${pn.dominio.toFixed(0)}% enquanto a cobertura ia de ${p0.assuntos} para ${pn.assuntos} assuntos.` : ''}</p>`);

    b.push('<p class="pl-det-rot">2 · O que o número ao lado é</p>');
    if (m.comp && m.comp.length) {
      b.push(`<p>Ele não cai nessa: soma a variação <b>assunto a assunto</b>, só sobre os que aparecem em <b>dois retratos seguidos</b> — em média <b>${m.baseComp}</b> assuntos por período. Encadeado por toda a série dá <b>${pp(m.ganho)}</b>, contra <b>${pp(m.ganhoBruto)}</b> da diferença bruta entre o primeiro e o último ponto.</p>`);
      if (m.baseComp < 10) {
        b.push(`<p class="pl-det-alerta">São só <b>${m.baseComp}</b> assuntos em comum por período: é pouca base. Leia o número como <b>direção</b>, não como medida. Repetir os mesmos assuntos entre importações é o que aperta essa conta.</p>`);
      }
    } else {
      b.push(`<p>Sem assuntos repetidos entre retratos consecutivos, ele é apenas a diferença entre o primeiro e o último ponto da linha: <b>${pp(m.ganhoBruto)}</b>.</p>`);
    }

    b.push('<p class="pl-det-rot">3 · O retorno do seu esforço</p>');
    if (m.rendMedio != null) {
      const mil = Math.abs(m.rendMedio) < 0.5;
      const esc = mil ? 1000 : 100, rot = mil ? '1.000' : '100';
      const ult = pn.rendimento;
      b.push(`<p><b>${(m.rendMedio * esc / 100).toFixed(1).replace('.', ',')}pp</b> de domínio a cada <b>${rot}</b> questões resolvidas, na média da série.${ult != null ? ` No último período foram <b>${(ult * esc / 100).toFixed(1).replace('.', ',')}pp</b>${ult < m.rendMedio * 0.5 ? ' — bem abaixo da sua média, sinal de que só aumentar o volume parou de funcionar neste momento.' : '.'}` : ''}</p>`);
      b.push(`<p>A conta usa a variação comparável dividida pelas questões <b>desses mesmos assuntos</b>. Com dezenas de assuntos medidos, mover a MÉDIA em 1pp exige mover um assunto em dezenas de pontos — é por isso que a escala às vezes precisa ser por mil questões para o número não virar 0,1.</p>`);
    } else {
      b.push(`<p>Ainda não há dois retratos com assuntos em comum suficientes para medir o retorno por questão. Ele aparece assim que você reimportar mantendo parte dos mesmos assuntos.</p>`);
    }

    b.push('<p class="pl-det-rot">4 · A série, importação por importação</p>');
    b.push(`<div class="pl-det-tab-wrap"><table class="pl-det-tab"><thead><tr><th>data</th><th>domínio</th><th>assuntos</th><th>questões</th><th>Δ comp.</th></tr></thead><tbody>${
      S.slice().reverse().map(x => `<tr><td>${escapeHtml(formatDateShort(x.data))}</td><td><b>${pc1(x.dominio)}</b></td><td>${x.assuntos}</td><td>${(x.questoes || 0).toLocaleString('pt-BR')}</td><td>${x.deltaComp != null ? pp(x.deltaComp) + ' <i>(' + x.comuns + ')</i>' : '—'}</td></tr>`).join('')
    }</tbody></table></div>`);
    b.push(`<p class="pl-det-fim"><b>Δ comp.</b> é a variação daquele retrato contra o anterior, contada só sobre os assuntos presentes nos dois — o número entre parênteses é quantos são. A linha tracejada do gráfico é a sua meta de domínio (<b>${r.meta}%</b>). Só assuntos com pelo menos <b>${PlanoEngine.prefs().pisoSerie || PlanoEngine.PISO_SERIE}</b> questões no retrato entram nesta série — abaixo disso a taxa oscila demais para virar ponto de um gráfico.</p>`);
    return { titulo: 'Sua trajetória — os números', html: b.join('') };
  },
  renderPlanoConteudo() {
    /* O corpo real fica em `_pintarPlano`; esta camada só garante as duas
       coisas que TODA repintura precisa e nenhuma chamada deve ter de lembrar:
       a rolagem não se mexe, e o sinal de "processando" sempre sai. */
    if (this._planoTimer) { clearTimeout(this._planoTimer); this._planoTimer = null; }
    this._comRolagemPreservada(() => this._pintarPlano());
    this._marcarPlanoOcupado(false);
  },
  _pintarPlano() {
    const proj = document.getElementById('plano-proj');
    const lista = document.getElementById('plano-lista');
    if (!proj || !lista) return;
    // com os ajustes na folha suspensa, a linha da porta diz o que esta valendo
    try { TecAjustes.sincronizar('plano'); } catch (e) { _quiet(e, 'resumo-plano'); }
    const num = (id, d) => { const e = document.getElementById(id); const n = parseFloat(e && e.value); return isNaN(n) ? d : n; };
    const val = (id, d) => { const e = document.getElementById(id); return (e && e.value) || d; };
    const bool = (id) => { const e = document.getElementById(id); return !!(e && e.checked); };
    const opts = {
      disciplina: val('plano-disc', '__todas__'),
      metaDominio: Math.max(30, Math.min(100, num('plano-meta', 80))),
      tetoDominio: Math.max(50, Math.min(100, num('plano-teto', 90))),
      ponderacao: val('plano-ponderacao', 'igual'),
      minAmostra: Math.max(0, num('plano-minamostra', 20)),
      incluirPequenas: bool('plano-pequenas'),
      custoModo: val('plano-customodo', 'lacuna'),
      custoFixo: Math.max(10, num('plano-custofixo', 60)),
      custoFator: Math.max(0.1, num('plano-custofator', 0.5)),
      custoPiso: Math.max(10, num('plano-custopiso', 50)),
      custoPorPonto: Math.max(0, num('plano-custoponto', 2)),
      pesoBanca: Math.max(0, Math.min(12, num('plano-pesobanca', 6))),
      apenasFolhas: bool('plano-folhas'),
      limite: Math.max(3, num('plano-limite', 10)),
      amostraAlvo: Math.max(10, num('plano-amostraalvo', 50)),
      janelaMax: Math.max(30, num('plano-janelamax', 365)),
      cadenciaDias: Math.max(7, num('plano-cadencia', 30)),
      consolidarEm: Math.max(1, num('plano-consolidar', 2)),
      faixaCritico: Math.max(0, Math.min(100, num('plano-critico', 50))),
      faixaFragil: Math.max(0, Math.min(100, num('plano-fragil', 65))),
      pisoSerie: Math.max(1, num('plano-piso', 5)),
      sensTendencia: Math.max(1, num('plano-sens', 3)),
      validadeDias: Math.max(30, num('plano-validade', 120)),
      ordenar: val('plano-ordenar', 'rendimento'),
      banca: this.bancaFiltro()
    };
    // O ritmo SEGUE a medição automaticamente. Só vira manual se você digitar algo
    // diferente do medido — assim novos imports atualizam o número sozinhos.
    const descSnaps = DB.getTecSnapshots().slice().reverse();
    const medido = PlanoEngine.ritmoRecente(descSnaps, 120, PlanoEngine.excluidasSet(PlanoEngine.prefs())) || 25;
    const digitado = Math.max(1, num('plano-ritmo', medido));
    opts.ritmoSemanal = (digitado === medido) ? null : digitado;
    /* GRAVA O CONFIGURADO, DESENHA O ABERTO. O "mostrar mais" é estado de
       leitura desta sessão, não uma preferência: se ele entrasse no que é
       salvo, abrir a lista inteira uma vez deixaria a tela abrindo em 81
       assuntos para sempre — exatamente a tela extensa que o passo de 10 veio
       resolver. */
    PlanoEngine.salvarPrefs(opts);
    // o passo que TODAS as listas do Plano usam, vindo do campo único
    this._passoFatia = opts.limite;
    if (!this._fatias) this._fatias = Object.create(null);
    /* A lista de assuntos é a única fatiada pelo MOTOR — é de lá que saem
       `totalItens` e o custo do que ficou de fora. O quanto abrir, porém, vem
       do mesmo registro das outras seis, para o botão ser o mesmo botão.

       DUAS listas comem dessa mesma fila: a lista de assuntos e a fila do
       "próximo bloco". Cada uma abre no seu próprio passo, então o motor tem
       de calcular o suficiente para a MAIOR das duas — senão "mostrar mais 10"
       na fila do bloco não teria de onde tirar item, e o botão abriria nada. O
       bloco consome até `PLANO_BLOCO_MAX` itens antes de a fila começar, e é
       por isso que ele entra na conta. */
    const abreLista = this._fatias['assuntos'] || 0;
    const abreFila = (this._fatias['proximos'] || 0) + this.PLANO_BLOCO_MAX;
    opts.limite = Math.min(opts.limite + Math.max(abreLista, abreFila), 100000);
    // ajuste novo invalida o retrato em cache usado ao criar atividades
    this._planoRefC = null;
    opts.ritmoSemanal = opts.ritmoSemanal || medido;
    const r = PlanoEngine.calcular(this.scopedSnapshot(), opts);
    // liga cada assunto à atividade extra já criada para ele (ciclo de acompanhamento)
    if (r && r.itens) {
      const extras = DB.getExtras().filter(e => e.origemPlano && e.origemPlano.topico);
      const doTopico = (x) => extras.filter(e => this._casaTopico(e.origemPlano, x.nome, x.disciplina));
      const mapaQ = PlanoEngine.totalHistorico(opts);
      [].concat(r.itens, r.pequenas || []).forEach(x => {
        const meus = doTopico(x);
        if (!meus.length) return;
        /* A ABERTA manda. Se só há encerradas, a linha mostra o VEREDITO da
           última — e não um "✓" que, no caso do "não funcionou", diria o
           contrário do que aconteceu. */
        const aberta = meus.find(e => e.status !== 'concluida');
        const e = aberta || meus[meus.length - 1];
        x.extra = e; x.extraAberta = !!aberta; x.extraAlvo = e.alvo || 0;
        const v = PlanoCiclo.avaliar(e, r, mapaQ);
        x.extraFeito = v ? v.feito : (DB.extraProgressoPeriodo ? DB.extraProgressoPeriodo(e) : (e.progresso || 0));
        x.extraVeredito = (e.origemPlano && e.origemPlano.veredito) ? e.origemPlano.veredito.tipo : null;
        x.extraConcluida = !aberta;
      });
    }
    if (r.erro === 'sem-retrato') {
      proj.innerHTML = `<p class="hint" style="padding:18px 0;">Importe ao menos um retrato de desempenho em <strong>📊 Análise</strong>.</p>`;
      lista.innerHTML = ''; return;
    }
    /* Excluir tudo tem saída óbvia — e ela precisa estar AQUI, não em algum
       menu que o usuário teria de lembrar que abriu. */
    if (r.erro === 'tudo-excluido') {
      proj.innerHTML = `<p class="hint" style="padding:18px 0;">Todas as matérias com retrato estão marcadas como <strong>fora do Plano</strong>${r.excluidasAssuntos ? ` — ${r.excluidasAssuntos} ${r.excluidasAssuntos === 1 ? 'assunto' : 'assuntos'} e ${(r.excluidasQ || 0).toLocaleString('pt-BR')} questões de lado` : ''}. <button type="button" id="plano-excluidas-voltar" class="pl-hero-limpar">trazer todas de volta</button></p>`;
      lista.innerHTML = '';
      const bv = document.getElementById('plano-excluidas-voltar');
      if (bv) bv.addEventListener('click', () => this.setExcluidas([]));
      return;
    }
    if (r.erro === 'amostra') {
      /* A saída em UM TOQUE, com os números do retrato na frase. O índice do
         TEC é fino: é normal um retrato ter centenas de assuntos de uma ou
         duas questões cada, e a resposta do app para isso tem nome — o modo
         🔍 Diagnóstico, que traz a amostra pequena para o cálculo justamente
         para produzir dado. Mandar "reduza nos ajustes avançados" sem dizer
         para quanto era empurrar o problema de volta para quem não tem como
         saber. */
      const sug = r.sugestaoMinAmostra || 1;
      proj.innerHTML = `
        <p class="hint" style="padding:14px 0 6px;">
          Nenhum dos <strong>${(r.assuntosNoRetrato || 0).toLocaleString('pt-BR')}</strong> assuntos deste retrato
          atingiu a amostra mínima de <strong>${r.minAmostra}</strong> questões
          — a maior amostra é de <strong>${r.maiorAmostra || 0}</strong> ${r.maiorAmostra === 1 ? 'questão' : 'questões'}
          e a mediana é <strong>${r.medianaAmostra || 0}</strong>.
          O índice do TecConcursos é fino: com muitos assuntos de uma ou duas questões, medir assunto por assunto
          exige baixar a régua — e assumir que a taxa vai ser um indício, não uma medição.
        </p>
        <div class="pl-aud-bts" style="margin:8px 0 4px;">
          <button type="button" class="btn-primary" id="plano-modo-diag">🔍 Usar o modo Diagnóstico</button>
          <button type="button" class="btn-secondary" id="plano-baixar-min">Baixar a régua para ${sug} ${sug === 1 ? 'questão' : 'questões'}${r.qualificamNaSugestao ? ` (entram ${r.qualificamNaSugestao})` : ''}</button>
        </div>
        <p class="pl-ciclo-obs">O Diagnóstico inclui a amostra pequena no cálculo e baixa a régua de uma vez; o segundo botão só mexe na régua. Os dois ficam salvos e podem ser desfeitos em ⚙ Ajustes.</p>`;
      lista.innerHTML = '';
      const bd = document.getElementById('plano-modo-diag');
      if (bd) bd.addEventListener('click', () => {
        PlanoEngine.salvarPrefs(PlanoEngine.modoPatch('diagnostico'));
        this.renderPlano(); showToast('🔍 Diagnóstico aplicado');
      });
      const bm = document.getElementById('plano-baixar-min');
      if (bm) bm.addEventListener('click', () => {
        PlanoEngine.salvarPrefs({ minAmostra: sug });
        this.renderPlano(); showToast('Amostra mínima em ' + sug + ' questões');
      });
      return;
    }
    const tom = r.jaAtinge ? 'good' : (r.falta <= 8 ? 'warn' : 'bad');
    const pond = r.ponderacao === 'volume' ? 'peso pelo volume praticado' : 'todo assunto com o mesmo peso';
    const aviso = (txt, cor) => `<p class="pl-aviso" style="border-color:var(--${cor});background:var(--${cor}-soft);color:var(--${cor}-text);">${txt}</p>`;
    const escopo = (r.disciplina && r.disciplina !== '__todas__') ? r.disciplina : '';
    proj.innerHTML = `
      <div class="pl-hero">
        <div class="pl-hero-top">
          <span class="pl-hero-num tone-${tom}">${r.dominioPct.toFixed(1)}%</span>
          <span class="pl-hero-uni">de domínio${escopo ? ' em' : ''}</span>
        </div>
        ${/* ── O NÚMERO GRANDE PRECISA DIZER DE QUEM ELE É ────────────────────
              Com o filtro numa disciplina, TUDO neste cartão passa a ser dela:
              o domínio, os "faltam X pontos", o caminho mais curto, as
              semanas. Medido no mesmo perfil, o número saltava de 79,0% em 27
              assuntos para 65,5% em 6 sem nada na tela dizendo por quê — e o
              aluno lê o número da matéria como se fosse o geral, planeja em
              cima disso e se assusta (ou se tranquiliza) pelo motivo errado.
              O filtro vive numa folha suspensa, longe daqui; o rótulo não. */''}
        ${escopo ? `<p class="pl-hero-escopo">${escapeHtml(escopo)}<button type="button" id="plano-todas-disc" class="pl-hero-limpar">ver o geral</button></p>` : ''}
        ${/* A EXCLUSÃO NÃO SE ANUNCIA AQUI. Foi uma decisão sua, e repeti-la
              no topo de toda repintura é ruído: quem excluiu sabe o que
              excluiu, e a lista marcada está a um toque em Ajustes ▸
              Essencial. O que o topo precisa garantir é o contrário — que
              nenhum número dele tenha visto a matéria excluída. */''}
        <p class="pl-hero-sub">
          Média de acerto nos <strong>${r.assuntos}</strong> ${r.assuntos === 1 ? 'assunto' : 'assuntos'}${escopo ? ' desta matéria' : ''} com amostra suficiente ·
          ${r.qTotal.toLocaleString('pt-BR')} questões · recorte médio de ${r.janelaMedia || '—'} dias
        </p>
        <div class="pl-medidor" style="height:12px;">
          <i style="width:${Math.min(100, r.dominioPct)}%"></i>
          <u style="left:${Math.min(100, r.meta)}%"></u>
        </div>
        <p class="pl-hero-call tone-${tom}">
          ${r.jaAtinge
            ? `✓ Meta de ${r.meta}% alcançada, com folga de ${(r.dominioPct - r.meta).toFixed(1)} pontos.`
            : `Faltam <span class="pl-num">${r.falta.toFixed(1)}</span> pontos para a meta de ${r.meta}%.`}
        </p>
        ${(!r.jaAtinge && r.caminho) ? `<p class="pl-hero-sub" style="margin:6px 0 0;">
          Caminho mais curto: <strong>${r.caminho.n} ${r.caminho.n === 1 ? 'assunto' : 'assuntos'}</strong> ·
          <strong>${r.caminho.q.toLocaleString('pt-BR')} questões</strong>${r.semanas ? ` · cerca de <strong>${Math.ceil(r.semanas)} semanas</strong> no seu ritmo de ${r.ritmo}/semana` : ''}
          ${(r.qAteMeta && r.qAteMeta > r.caminho.q * 1.15) ? `<br><span class="pl-hero-alerta" data-tip="O caminho curto é sempre o mesmo: os assuntos de melhor ganho ÷ custo. A ordem que você escolheu é uma forma de LER a lista, e chega lá por um percurso mais caro.">⚠ na ordem que você escolheu são ${r.qAteMeta.toLocaleString('pt-BR')} questões — ${Math.round((r.qAteMeta / r.caminho.q - 1) * 100)}% a mais</span>` : ''}
        </p>` : ''}

        ${/* No celular o `title` de uma ficha NUNCA abre: as explicações dos
              seis contadores existiam só para quem usa mouse. Um "i" na faixa
              explica todos de uma vez, com os números desta tela dentro. */''}
        <div class="pl-chips" data-info="${this._info(
          `<b>🟢 ${r.solidosAtuais} sólidos</b> — assuntos que ficaram na meta de ${r.meta}% em <b>${r.consolidarEm}</b> importações seguidas E têm medição recente. São os que você pode riscar da lista.`
          + `<br><br><b>🟠 sólidos sem medição nova</b> — sustentaram a meta, mas a última medição passou de <b>${r.validadeDias}</b> dias. Antes de riscar, remeça: consolidado com dado velho é lembrança, não medição.`
          + `<br><br><b>🟡 recém-corrigidos</b> — cruzaram a meta há pouco e ainda não provaram que fixaram. Contam como conquista, não como assunto resolvido.`
          + `<br><br><b>📊 melhorando · piorando</b> — variação acima de <b>${r.sensTendencia}pp</b> contra o período anterior, já descontado o que a amostra não comprova.`
          + `<br><br><b>⏳ com dado vencido</b> — sem medição nova há mais de <b>${r.validadeDias}</b> dias: a taxa pode não descrever você hoje.`
          + `<br><br><b>🕳️ sem diagnóstico</b> — menos de <b>${r.minAmostra || PlanoEngine.prefs().minAmostra}</b> questões resolvidas. Ficam fora da média de propósito e esperam no <b>segundo plano</b>, no fim da tela: com amostra assim a taxa real pode variar dezenas de pontos.`)}">
          <span class="pl-chip res" style="border-color:var(--good);color:var(--good-text);" title="Sustentaram a meta em ${r.consolidarEm}+ importações seguidas, com medição recente">🟢 ${r.solidosAtuais} sólidos</span>
          ${r.solidosVencidos ? `<span class="pl-chip res" style="border-color:var(--warn);color:var(--warn-text);" title="Sustentaram a meta, mas a última medição tem mais de ${r.validadeDias} dias — remeça antes de riscar da lista">🟠 ${r.solidosVencidos} sólidos sem medição nova</span>` : ''}
          ${r.recentes ? `<span class="pl-chip res" style="border-color:var(--warn);color:var(--warn-text);" title="Cruzaram a meta há pouco — ainda não provaram que fixaram">🟡 ${r.recentes} recém-corrigidos</span>` : ''}
          ${(r.melhorando || r.piorando) ? `<span class="pl-chip res" style="border-color:var(--${r.melhorando >= r.piorando ? 'good' : 'bad'});color:var(--${r.melhorando >= r.piorando ? 'good' : 'bad'}-text);" title="Variação acima de ${r.sensTendencia}pp contra o histórico">📊 ${r.melhorando} melhorando · ${r.piorando} piorando</span>` : ''}
          ${r.vencidos ? `<span class="pl-chip res" style="border-color:var(--bad);color:var(--bad-text);" title="Sem medição nova há mais de ${r.validadeDias} dias">⏳ ${r.vencidos} com dado vencido</span>` : ''}
          ${r.ignorados ? `<span class="pl-chip res" style="border-color:var(--warn);color:var(--warn-text);" title="Sem amostra suficiente — veja o segundo plano no fim">🕳️ ${r.ignorados} sem diagnóstico</span>` : ''}
        </div>
        <div class="pl-chips" style="margin-top:6px;" data-info="${this._info(
          `Os três ajustes que mais mudam o que você lê acima — todos em <b>⚙ Ajustes</b>.`
          + `<br><br><b>amostra-alvo ${r.amostraAlvo}q</b> — para cada assunto o app parte da importação mais recente e volta no tempo só até juntar esta quantidade de questões. Maior = taxa mais confiável e dado mais antigo; menor = retrato de agora com margem maior.`
          + `<br><br><b>ritmo ${r.ritmo}/sem</b> — quantas questões você resolve por semana. ${r.ritmoMedido === r.ritmo ? 'Este veio <b>medido</b> dos seus retratos.' : `Está <b>digitado</b> por você; os seus retratos medem <b>${r.ritmoMedido}/semana</b>.`} Só afeta as previsões em semanas, nunca a ordem da fila.`
          + `<br><br><b>${pond}</b> — como cada assunto pesa na média: <em>todo assunto igual</em> impede que um tema de 400 questões esconda um de 20; <em>por volume</em> faz o que você mais pratica mandar no número.`)}">
          <span class="pl-chip cfg">amostra-alvo ${r.amostraAlvo}q</span>
          <span class="pl-chip cfg">ritmo ${r.ritmo}/sem${r.ritmoMedido === r.ritmo ? ' (medido)' : ''}</span>
          <span class="pl-chip cfg">${pond}</span>
        </div>

        ${r.ignorados >= r.assuntos * 0.5 ? aviso(
          `📐 Este ${r.dominioPct.toFixed(0)}% descreve só os <strong>${r.assuntos}</strong> assuntos medidos. Outros <strong>${r.ignorados}</strong> ainda não têm dado — bater a meta aqui não é dominar a disciplina inteira.`, 'warn') : ''}
        ${r.alvoInviavel ? aviso(
          `⚙ Alvo de amostra alto para o seu volume: só ${r.comAlvo} de ${r.assuntos} chegam a ${r.amostraAlvo} questões (o maior tem ${r.maiorAmostra}). Experimente <strong>${r.alvoSugerido}</strong> em "Amostra confiável" — metade dos seus assuntos já chega lá.`, 'warn') : ''}
        ${/* ── UM RITMO MANUAL VELHO ESTRAGA TODA PREVISÃO, E EM SILÊNCIO ───
              O campo "ritmo" segue a medição sozinho — até alguém digitar um
              número. A partir daí ele fica travado para sempre, e toda conta
              de semanas passa a dividir por ele. Visto numa auditoria real:
              ritmo digitado 30/sem contra 563/sem medidos nos últimos 120
              dias, e o "caminho mais curto" anunciando 486 semanas (nove
              anos) para um percurso que, no ritmo de verdade, leva 26.
              Um número assim não desanima só a pessoa: desacredita a tela
              inteira, e o único sinal que havia era a AUSÊNCIA da palavra
              "(medido)" ao lado do chip. Sinal por omissão não é sinal. */''}
        ${r.ritmoDivergente ? aviso(
          `⏱️ O ritmo está fixo em <strong>${r.ritmo}/semana</strong>, mas os seus retratos dos últimos 120 dias medem <strong>${r.ritmoMedido}/semana</strong>. Toda previsão em semanas está dividindo pelo número travado — o caminho mais curto sai em ${r.semanas != null ? Math.round(r.semanas) : '—'} semanas em vez de ${r.caminho && r.ritmoMedido ? Math.round(r.caminho.q / r.ritmoMedido) : '—'}. <button type="button" class="pl-hero-limpar" id="plano-ritmo-medido">usar o medido</button>`, 'warn') : ''}
        ${r.defasado ? aviso(
          `⏳ Última importação há <strong>${r.idadeUltimo} dias</strong> — você definiu ${r.cadenciaDias}. Importe um novo período para a leitura refletir seu nível de hoje.`, 'warn') : ''}
      </div>`;

    // ── Trajetória do domínio a cada importação ──
    const S = r.serie || [];
    let grafico = '';
    this._trajAnalise = null;   // sem série, não há análise a abrir
    if (S.length >= 2) {
      const W = 100, H = 34;
      const lo = Math.max(0, Math.min(...S.map(p => p.dominio), r.meta) - 6);
      const hi = Math.min(100, Math.max(...S.map(p => p.dominio), r.meta) + 6);
      const px = (i) => (S.length === 1 ? W / 2 : i / (S.length - 1) * W);
      const py = (v) => H - (v - lo) / Math.max(1, hi - lo) * H;
      const pts = S.map((p, i) => `${px(i).toFixed(1)},${py(p.dominio).toFixed(1)}`).join(' ');
      const yMeta = py(r.meta).toFixed(1);
      const ganhoBruto = S[S.length - 1].dominio - S[0].dominio;
      /* O CRACHÁ COMPARA ASSUNTO COM ASSUNTO. Encadeando as variações de cada
         par de retratos consecutivos sobre os assuntos que existem nos dois,
         a soma atravessa a série inteira sem nunca creditar (ou debitar) ao
         aluno o simples fato de ter aberto frente nova. */
      const comp = S.filter(p => p.deltaComp != null);
      const ganho = comp.length ? comp.reduce((a, p) => a + p.deltaComp, 0) : ganhoBruto;
      const baseComp = comp.length ? Math.round(comp.reduce((a, p) => a + p.comuns, 0) / comp.length) : 0;
      const divergem = comp.length > 0 && Math.abs(ganho - ganhoBruto) >= 2;
      /* A BASE DO CRACHÁ APARECE QUANDO É PEQUENA, não só quando os dois
         números divergem. Numa auditoria real o crachá dizia "+3,9pp" apoiado
         em 7 assuntos comuns por período — de 260 medidos — e a nota ficava
         escondida porque o bruto calhava de estar a 1,6pp dali. Um número
         construído sobre sete assuntos precisa dizer isso sempre; quando ele
         também discorda do bruto, aí a nota explica as duas coisas. */
      const baseFina = comp.length > 0 && baseComp < 10;
      const rend = S.filter(p => p.rendimento != null);
      const rendMedio = rend.length ? rend.reduce((a, p) => a + p.rendimento, 0) / rend.length : null;
      const ultimo = S[S.length - 1];
      grafico = `
        <div class="card" style="background:var(--surface-sunken);box-shadow:var(--shadow-sm);border:1.5px solid var(--border);margin:0 0 16px;">
          <div style="padding:14px 16px;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <strong style="font-size: var(--fs-sm);">📈 Sua trajetória<button type="button" class="info-dot pl-mat-det" data-traj-det="1" aria-label="Os números por trás da trajetória" title="Os números por trás da trajetória">i</button></strong>
              <span class="reforco-tag ${ganho >= 0 ? 'tone-good' : 'tone-bad'}" title="${comp.length ? 'Variação média assunto a assunto, só sobre os que existem em retratos consecutivos' : 'Diferença entre a primeira e a última medição'}">${ganho >= 0 ? '+' : ''}${ganho.toFixed(1)}pp em ${S.length} importações</span>
            </div>
            <div style="position:relative;height:74px;margin:10px 0 4px;">
              <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;">
                <line x1="0" y1="${yMeta}" x2="${W}" y2="${yMeta}" stroke="var(--text-faint)" stroke-width="0.4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
                <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
              </svg>
              ${/* pontos em HTML: dentro do SVG esticado eles viravam elipses */''}
              ${S.map((p, i) => `<span title="${escapeHtml(formatDateShort(p.data))}: ${p.dominio.toFixed(1)}%"
                style="position:absolute;left:${px(i).toFixed(1)}%;top:${(py(p.dominio) / H * 100).toFixed(1)}%;
                width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;
                background:var(--accent);border:2px solid var(--surface);box-sizing:border-box;"></span>`).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-family:'Inter',sans-serif;font-size: var(--fs-3xs);color:var(--text-faint);">
              <span>${escapeHtml(formatDateShort(S[0].data))} · ${S[0].dominio.toFixed(0)}%</span>
              <span style="color:var(--text-soft);font-weight:700;">linha tracejada = meta ${r.meta}%</span>
              <span>${escapeHtml(formatDateShort(ultimo.data))} · ${ultimo.dominio.toFixed(0)}%</span>
            </div>
            ${/* ── OS TEXTOS LONGOS SAÍRAM DA TELA ───────────────────────
                  Aqui moravam dois parágrafos de explicação (o artefato da
                  cobertura crescente e o retorno do esforço) que, juntos,
                  ocupavam mais altura que o próprio gráfico — e falavam de
                  números que a tela nem mostrava. Os dois viraram a ANÁLISE do
                  "i" ao lado do título, agora acompanhados da série inteira em
                  números: data, domínio, assuntos medidos, questões, variação
                  comparável e retorno de cada importação. A tela fica com o
                  desenho; quem quer os volumes por trás abre uma vez. */''}
            ${(divergem || baseFina || rendMedio != null) ? `<p class="pl-ciclo-obs" style="margin:8px 0 0;">${
              divergem ? 'A linha inclui os assuntos novos; o número ao lado compara assunto com assunto.'
              : baseFina ? `O número ao lado se apoia em <b>${baseComp}</b> assuntos por período — leia como direção, não como medida.`
              : `Retorno do seu esforço: <b>${(rendMedio * (Math.abs(rendMedio) < 0.5 ? 1000 : 100) / 100).toFixed(1)}pp</b> de domínio a cada ${Math.abs(rendMedio) < 0.5 ? '1.000' : '100'} questões.`
            } <button type="button" class="pl-ciclo-acao" data-traj-det="1">ver os números</button></p>` : ''}
          </div>
        </div>`;
      /* A análise fica guardada e abre no diálogo — a série inteira em números
         não cabe num popover de 320px, e é justamente ela que responde "de onde
         vêm esses valores". */
      this._trajAnalise = this._analiseTrajetoria(S, r, { ganho, ganhoBruto, comp, baseComp, divergem, rendMedio });
    }
    /* Por que ESTE assunto está NESTA posição. A mesma pergunta que o item do
       topo responde, para qualquer linha da lista — é o que separa uma ordem
       que ensina de uma ordem que só manda. */
    const motivoDaPosicao = (x, i) => {
      const p = [];
      if (r.ordenar === 'pior' || r.ordenar === 'ganhoDominio') p.push(`acerto de ${x.taxa.toFixed(0)}%`);
      if (r.ordenar === 'rendimento') p.push(`${x.ganhoPP.toFixed(1)}pp de ganho por cerca de ${x.custoQ} questões`);
      if (r.ordenar === 'ganhoGeral') p.push(`${x.ganhoGeral.toFixed(2)}pp no aproveitamento geral (${x.qJanela} questões na amostra)`);
      if (r.ordenar === 'volume') p.push(`${x.qJanela} questões na amostra`);
      if (r.ordenar === 'queda') p.push(x.delta != null ? `variação de ${x.delta}pp contra o período anterior` : 'sem período anterior para comparar');
      if (r.ordenar === 'banca') p.push(x.incid > 0 ? `retorno ${x.rendimento.toFixed(2)} × incidência ${x.incid} na banca` : 'sem incidência registrada — entrou só pelo retorno');
      return `${i + 1}º na ordem "${(PlanoEngine.ORDENS[r.ordenar] || {}).rot || ''}": ${p.join(' · ')}.`;
    };
    /* UM selo para os dois lugares onde a atividade aparece (a fila do bloco e
       a lista). Duas cópias divergiam: a do bloco dizia "✓" para uma atividade
       encerrada com "não funcionou". */
    const SELO_ATIV = (x) => `<span class="reforco-tag ${x.extraVeredito === 'naoFuncionou' ? 'tone-bad' : x.extraConcluida ? 'tone-good' : 'incid'}" title="${x.extraVeredito === 'naoFuncionou' ? 'Você cumpriu as questões e a taxa não subiu — o buraco é de teoria, não de volume' : x.extraConcluida ? 'Encerrada: o retrato disse que o assunto foi resolvido' : 'Em aberto — o progresso vem dos seus retratos'}">${x.extraVeredito === 'naoFuncionou' ? '⚠️ não funcionou' : x.extraConcluida ? '✓ resolvido' : '▶ ' + x.extraFeito + '/' + x.extraAlvo}</span>`;
    /* O motor pode ter calculado mais do que a lista grande deve mostrar (ver
       o cálculo do limite acima): ela continua exibindo a fatia DELA. */
    const itensVis = r.itens.slice(0, this._passoFatia + abreLista);
    const linhas = itensVis.map((x, i) => {
      const sens = r.sensTendencia || 3;
      /* O ▲▼ agora compara a janela com o período ANTERIOR a ela. Quando não
         existe período anterior, a tela diz isso — antes simplesmente não
         mostrava nada, e "sem seta" era lido como "estável". */
      const seta = x.delta == null
        ? (x.qAntes === 0 ? `<span class="reforco-tag" title="Não há período anterior a esta janela para comparar: é a primeira medição do assunto.">🆕 primeira medição</span>` : '')
        : (Math.abs(x.delta) >= sens && !x.deltaFirme)
          ? `<span class="reforco-tag semincid" title="A diferença existe na medição, mas as amostras dos dois períodos são pequenas demais para descartar acaso: aqui só ${x.deltaMinimo != null ? x.deltaMinimo.toFixed(0) : '—'}pp seriam comprováveis (${x.qAntes}q antes, ${x.qJanela}q agora).">${x.delta > 0 ? '▲' : '▼'} ${x.delta}pp · dentro da margem</span>`
        : x.delta >= sens ? `<span class="reforco-tag tone-good" title="Acima do que você fazia no período anterior a esta janela, e a diferença passa do mínimo comprovável (${x.deltaMinimo != null ? x.deltaMinimo.toFixed(0) : '—'}pp)">▲ ${x.delta}pp</span>` :
          x.delta <= -sens ? `<span class="reforco-tag tone-bad" title="Abaixo do que você fazia no período anterior a esta janela, e a diferença passa do mínimo comprovável (${x.deltaMinimo != null ? x.deltaMinimo.toFixed(0) : '—'}pp)">▼ ${x.delta}pp</span>` : '';
      const desdeAtiv = (x.extra && x.extra.origemPlano && x.extra.origemPlano.taxaInicial != null && x.taxa != null)
        ? `<span class="reforco-tag ${x.taxa - x.extra.origemPlano.taxaInicial >= 0 ? 'tone-good' : 'tone-bad'}" title="Evolução desde que você criou a atividade em ${escapeHtml(formatDateShort(x.extra.origemPlano.criadoEm))}">desde a atividade ${x.extra.origemPlano.taxaInicial.toFixed(0)}→${x.taxa.toFixed(0)}%</span>` : '';
      const marca = (i === r.idxMeta) ? `<div class="pl-marco">🏁 <b>Nesta ordem</b>, daqui para cima já basta para chegar a ${r.meta}% de domínio${r.qAteMeta ? ` — ${r.qAteMeta.toLocaleString('pt-BR')} questões` : ''}${(r.caminho && r.qAteMeta && r.qAteMeta > r.caminho.q) ? `, contra ${r.caminho.q.toLocaleString('pt-BR')} pelo caminho mais curto` : ''}</div>` : '';
      /* UMA orientação por item, não duas. A "direção curta" repetia, com outras
         palavras, o que a guia logo abaixo já dizia — e a versão curta era a
         genérica, escrita para a faixa e não para o caso. Ficou a do motor,
         que usa a taxa, a distância até a meta e o histórico daquele assunto;
         a guia passou a trazer o que faltava: por que ele está nesta posição. */
      const faltaMeta = Math.max(0, r.meta - x.taxa);
      const dirTom = x.taxa < r.faixaCritico ? 'bad' : x.taxa < r.faixaFragil ? 'bad'
        : x.taxa < r.meta ? 'warn' : (x.status.tom || 'good');
      /* ── A CAIXA QUE FALTAVA: QUANTAS QUESTÕES PARA O NÚMERO SER FIEL ────
         A tela pedia decisões a partir de uma taxa e mostrava a margem dela
         (63% ±11), mas nunca dizia o que fazer com essa margem. E a resposta é
         um número fechado: `n = z²·p(1−p)/E²`. Com a taxa deste assunto, esta
         caixa diz quantas questões AINDA faltam para a próxima medição sair com
         ±MARGEM_ALVO pontos — isto é, para a evolução medida ser evolução e não
         oscilação de amostra curta. É o número que fideliza a estatística, e
         era o único dos cinco que o aluno não tinha como calcular de cabeça. */
      const qMedir = PlanoEngine.qParaMedir(x.taxa, PlanoEngine.MARGEM_ALVO);
      const faltaMedir = Math.max(0, qMedir - x.qJanela);
      /* Quantas questões a próxima medição precisa ter para o app CRAVAR uma
         melhora do tamanho da sua sensibilidade — pode não existir resposta, e
         nesse caso o que falta é base, não esforço. */
      const qProvar = PlanoEngine.qParaProvar(x.taxa, x.qJanela, sens);
      const faixaNome = x.taxa < r.faixaCritico ? 'crítica' : x.taxa < r.faixaFragil ? 'frágil'
        : x.taxa < r.meta ? 'abaixo da meta' : x.taxa < r.teto ? 'na meta' : 'no teto';
      // Caixinhas numéricas (leitura rápida do status) — e o "i" que explica
      // cada uma DELAS, com os números deste assunto em vez de teoria.
      const explicaCaixas = this._info(
        `<b>${x.taxa.toFixed(0)}% acerto${x.margem != null ? ' ±' + x.margem.toFixed(0) : ''}</b> — a sua taxa aqui, medida em <b>${x.qJanela}</b> questões${x.diasJanela ? ' dos últimos <b>' + x.diasJanela + '</b> dias' : ''}.`
        + (x.margem != null ? ` A margem diz que o valor real está entre <b>${Math.max(0, x.taxa - x.margem).toFixed(0)}%</b> e <b>${Math.min(100, x.taxa + x.margem).toFixed(0)}%</b> (95% de confiança). Confiabilidade da amostra: <b>${x.conf.nivel}</b>.` : '')
        + `<br><br><b>${faltaMeta > 0 ? faltaMeta.toFixed(0) : '✓'} pts p/ meta</b> — quanto falta da sua taxa até a meta de <b>${r.meta}%</b>. Você está na faixa <b>${faixaNome}</b> (crítica abaixo de ${r.faixaCritico}%, frágil abaixo de ${r.faixaFragil}%, teto realista em ${r.teto}%).`
        + `<br><br><b>${x.custoQ} questões (custo)</b> — a estimativa de quanto trabalho fecha essa lacuna${r.custoModo === 'lacuna' ? `: ${r.custoPiso} para remedir + ${Math.round(r.custoPorPonto * x.lacunaPP * x.amplitude)} pela lacuna de ${x.lacunaPP.toFixed(0)} pontos` : ''}. É o alvo que vai para a atividade quando você toca em <b>+ Atividade</b>.`
        + `<br><br><b>${x.qJanela} na amostra</b> — as questões que sustentam a taxa acima.${x.qHist > x.qJanela ? ` Você resolveu <b>${x.qHist}</b> no total, mas a janela usa só as mais recentes: assunto já corrigido não pode ficar preso ao desempenho antigo.` : ''}`
        + `<br><br><b>${faltaMedir ? '+' + faltaMedir : '✓'} q p/ medir ±${PlanoEngine.MARGEM_ALVO}</b> — ${faltaMedir
            ? `faltam <b>${faltaMedir}</b> questões (de <b>${qMedir}</b> necessárias) para a próxima medição deste assunto sair com margem de ±${PlanoEngine.MARGEM_ALVO}pp. Abaixo disso a taxa balança mais que o seu progresso, e "subiu 4pp" pode ser só sorteio.`
            : `a sua amostra já passa das <b>${qMedir}</b> questões que dão margem de ±${PlanoEngine.MARGEM_ALVO}pp: a taxa daqui é medição, não palpite.`}`
        + (qProvar ? `<br><br>Para o app <b>cravar</b> uma melhora de ${sens}pp na próxima importação, esta janela precisaria de cerca de <b>${qProvar}</b> questões.` : ''));
      const metricas = `
        <div class="pl-metrics">
          <div class="plm"><b class="tone-${x.conf.tom}">${x.taxa.toFixed(0)}%</b><span>acerto${x.margem != null ? ' ±' + x.margem.toFixed(0) : ''}</span></div>
          <div class="plm"><b class="tone-${dirTom}">${faltaMeta > 0 ? faltaMeta.toFixed(0) : '✓'}</b><span>pts p/ meta</span></div>
          <div class="plm"><b>${x.custoQ}</b><span>questões (custo)</span></div>
          <div class="plm"><b>${x.qJanela}</b><span>na amostra</span></div>
          <div class="plm plm-amostra"><b class="tone-${faltaMedir ? 'warn' : 'good'}">${faltaMedir ? '+' + faltaMedir : '✓'}</b><span>q p/ medir ±${PlanoEngine.MARGEM_ALVO}</span></div>
          <div class="plm plm-info" data-info="${explicaCaixas}"></div>
        </div>`;
      /* ── A GUIA DEIXOU DE SER TRÊS PARÁGRAFOS SOLTOS ────────────────────
         Ela respondia "por que está aqui" com uma frase de ordenação e dois
         parágrafos de números corridos, sem separar a POSIÇÃO (por que este
         assunto antes daquele), o DIAGNÓSTICO (o que os números dizem sobre
         ele) e a AÇÃO (o que fazer amanhã de manhã). São três perguntas
         diferentes, e é por isso que agora são três seções rotuladas, cada uma
         com os dados que a sustentam — inclusive os que o aluno não tinha:
         o intervalo real da taxa, o empate técnico com o primeiro da fila e o
         bloco de questões que devolve uma medição confiável.

         Ela continua RECOLHIDA por padrão, e nenhuma abre sozinha. Já foram
         abertas nos três primeiros itens (e, quando a meta era inalcançável,
         em TODOS): a 390px os itens respondiam por 84% de uma página de
         20.681px, com cada cartão em 647px — quase uma tela de celular por
         assunto. O detalhe continua a um toque em qualquer linha. */
      const abreGuia = false;
      const empatouComPrimeiro = (i > 0 && r.ordenar === 'pior' && PlanoEngine.empateTecnico(itensVis[0], x));
      const guia = `
        <details class="pl-guia" ${abreGuia ? 'open' : ''}>
          <summary>💡 Por que está aqui, e o que fazer <span class="chev">▾</span></summary>
          <div class="pl-guia-body">
            <span class="pl-guia-rot">Por que nesta posição</span>
            <p class="pl-porque-item">${escapeHtml(motivoDaPosicao(x, i))}</p>
            ${empatouComPrimeiro ? `<p class="pl-base">Estatisticamente <b>empatado com o 1º</b> da fila: a diferença entre os dois cabe na margem de erro das duas amostras. Trocar um pelo outro não perde nada — a fila diz <b>onde procurar</b>, não em que ordem exata.</p>` : ''}
            ${(x.incid > 0 && r.ordenar !== 'banca') ? `<p class="pl-base">A banca cobra este assunto <b>${x.incid}</b> ${x.incid === 1 ? 'vez' : 'vezes'} no índice importado — a ordem atual não usa isso; a ordem <b>🎯 Prioridade na banca</b> usa.</p>` : ''}

            <span class="pl-guia-rot">O que os números dizem</span>
            <p class="pl-guia-num">
              <span>acerto <b>${x.taxa.toFixed(0)}%</b>${x.margem != null ? ` (real entre <b>${Math.max(0, x.taxa - x.margem).toFixed(0)}%</b> e <b>${Math.min(100, x.taxa + x.margem).toFixed(0)}%</b>)` : ''}</span>
              <span>faixa <b>${faixaNome}</b></span>
              <span>amostra <b>${x.qJanela}</b> q${x.diasJanela ? ` · <b>${x.diasJanela}</b> dias` : ''}${x.qHist > x.qJanela ? ` (de ${x.qHist} no total)` : ''}</span>
              ${x.pctAntes != null ? `<span>antes da janela <b>${x.pctAntes.toFixed(0)}%</b>${x.delta != null ? ` (${x.delta >= 0 ? '+' : ''}${x.delta}pp)` : ''}</span>` : ''}
              <span>teto realista <b>${r.teto}%</b> · faltam <b>${(r.teto - x.taxa).toFixed(0)} pts</b> até lá</span>
              ${x.vencido ? `<span class="tone-bad">última medição há <b>${x.diasDesdeMedicao}</b> dias</span>` : ''}
            </p>
            ${x.delta != null && Math.abs(x.delta) >= sens && !x.deltaFirme
              ? `<p class="pl-base">A variação de <b>${x.delta}pp</b> contra o período anterior <b>não é comprovável</b>: com ${x.qAntes}q antes e ${x.qJanela}q agora, só uma diferença de ${x.deltaMinimo != null ? x.deltaMinimo.toFixed(0) : '—'}pp escaparia do acaso. Trate como estável.</p>` : ''}
            ${faltaMedir ? `<p class="pl-base">Para a <b>próxima</b> medição deste assunto valer como medição (±${PlanoEngine.MARGEM_ALVO}pp), a janela precisa de <b>${qMedir}</b> questões — você tem ${x.qJanela}, faltam <b>${faltaMedir}</b>. É esse bloco que transforma "achei que melhorei" em número.</p>`
              : `<p class="pl-base">A amostra já passa das <b>${qMedir}</b> questões que dão ±${PlanoEngine.MARGEM_ALVO}pp de margem: o que esta linha diz sobre você é medição, não impressão.</p>`}

            <span class="pl-guia-rot">O que fazer</span>
            <p class="pl-acao pl-guia-acao tone-${x.status.tom}">${escapeHtml(x.status.acao)}</p>
            <p class="pl-base">Custo estimado de <b>${x.custoQ}</b> questões${r.custoModo === 'lacuna' ? ' = ' + r.custoPiso + ' para remedir + ' + Math.round(r.custoPorPonto * x.lacunaPP * x.amplitude) + ' pela lacuna de ' + x.lacunaPP.toFixed(0) + ' pontos' + (Math.abs(x.amplitude - 1) > 0.08 ? ' num assunto ' + (x.amplitude > 1 ? 'mais amplo' : 'mais estreito') + ' que a sua média (×' + x.amplitude.toFixed(1).replace('.', ',') + ')' : '') : ''}${r.ritmo ? (x.custoQ < r.ritmo
              ? ` — <b>menos de uma semana</b> no seu ritmo de ${r.ritmo}/semana`
              : ` — cerca de <b>${(Math.round(x.custoQ / r.ritmo * 10) / 10).toFixed(1).replace('.', ',')}</b> semanas no seu ritmo de ${r.ritmo}/semana`) : ''}.</p>
            <p class="pl-base">Fechar este assunto sozinho move o seu domínio em <b>+${x.ganhoPP.toFixed(1)}pp</b>${r.ponderacao === 'ambas' ? ` (e o aproveitamento geral em +${x.ganhoGeral.toFixed(2)}pp)` : ''} — e só o próximo retrato importado diz se funcionou: nenhuma outra coisa nesta tela diz.</p>
          </div>
        </details>`;
      return `
        <div class="pl-item">
          <div class="pl-rank">${i + 1}</div>
          <div class="pl-nome">${escapeHtml(x.nome)}</div>
          <div class="pl-ganho">
            ${r.ponderacao === 'ambas' ? `
              <b class="pl-g-dom" title="Sobe o DOMÍNIO: cada assunto pesa igual">+${x.ganhoDominio.toFixed(1)}pp</b>
              <span title="Sobe o DOMÍNIO">⚖️ domínio</span>
              <b class="pl-g-ger" title="Sobe o APROVEITAMENTO GERAL (ponderado por questão): são ${Math.round(x.ganhoQuestoes)} questões a mais acertadas nas ${x.qJanela} da amostra">+${x.ganhoGeral.toFixed(2)}pp</b>
              <span title="Aproveitamento geral desta tela">📊 geral · ${Math.round(x.ganhoQuestoes)}q na amostra</span>
            ` : `
              <b>+${x.ganhoPP.toFixed(1)}pp</b>
              <span>${r.ponderacao === 'volume' ? '📊 geral → ' : '⚖️ domínio → '}${x.acumulado.toFixed(1)}%</span>
            `}
          </div>
          <div class="pl-corpo">
            ${x.disciplina ? `<div class="pl-disc">${escapeHtml(x.disciplina)}</div>` : ''}
            <div class="pl-tags">
              <span class="reforco-tag tone-${x.status.tom}" title="${x.status.seq != null ? x.status.seq + ' importação(ões) seguidas na meta' : 'Faixa de acerto'}">${x.status.rot}${x.status.seq ? ' ' + x.status.seq + '×' : ''}</span>
              ${(x.incid > 0) ? `<span class="reforco-tag incid" title="Quantas vezes este assunto já caiu em ${escapeHtml(ReforcoEngine.rotuloBancas(r.banca))}">🎯 incidência ${x.incid}</span>` : ''}
              ${seta}${desdeAtiv}
              ${x.vencido ? `<span class="reforco-tag tone-bad" title="Sem medição nova — a taxa pode não refletir você hoje">⏳ ${x.diasDesdeMedicao}d</span>` : ''}
            </div>
            <div class="pl-medidor" title="${x.taxa.toFixed(0)}% de acerto · marcador no máximo realista de ${r.teto}%">
              <i style="width:${Math.min(100, x.taxa)}%"></i><u style="left:${Math.min(100, r.teto)}%"></u>
            </div>
            <p class="pl-direcao tone-${dirTom}"><span class="seta">➜</span><span>${escapeHtml(x.status.ordem || x.status.acao)}</span></p>
            ${metricas}
            ${guia}
            <div class="pl-rodape">
              ${x.extra
                ? SELO_ATIV(x)
                : `<button type="button" class="btn-secondary plano-nova-extra" style="padding:6px 12px;font-size: var(--fs-2xs);white-space:nowrap;" data-topico="${escapeHtml(x.nome)}"
                     data-disc="${escapeHtml(x.disciplina || '')}" data-alvo="${x.custoQ}" data-motivo="reforco">+ Atividade</button>`}
            </div>
          </div>
        </div>${marca}`;
    }).join('');
    const fPeq = this.fatiar('pequenas', r.pequenas, this._passoFatia);
    const pequenas = r.pequenas.length ? `
      <div class="pl-segundo" style="margin-top:22px;padding-top:16px;border-top:2px solid var(--border);">
        <p class="section-label" style="margin:0 0 4px;">🕳️ Segundo plano — assuntos sem diagnóstico</p>
        <p class="pl-prosa" style="margin:0 0 12px;">
          Menos de ${opts.minAmostra} questões resolvidas: ainda não dá para afirmar que é fraqueza.
          Ficam fora da média de domínio de propósito — com amostra assim pequena a taxa real pode variar dezenas de pontos.
          <strong>Aqui a ação é outra:</strong> resolver questões para descobrir onde você está.
        </p>
        ${fPeq.vis.map((x, i) => `
          <div class="pl-item">
            <div class="pl-rank" style="background:var(--surface-sunken);color:var(--text-faint)">${i + 1}</div>
            <div class="pl-nome">${escapeHtml(x.nome)}</div>
            <div class="pl-ganho"><b style="color:var(--text-faint);font-size: var(--fs-sm);">?</b></div>
            <div class="pl-corpo">
              ${x.disciplina ? `<div class="pl-disc">${escapeHtml(x.disciplina)}</div>` : ''}
              <div class="pl-tags">
                <span class="reforco-tag tone-warn" title="Margem de erro grande demais para servir de diagnóstico">
                  ${x.taxa != null ? x.taxa.toFixed(0) + '%' : '—'}${x.margem != null ? ' ±' + x.margem.toFixed(0) + 'pp' : ''} em ${x.qJanela} ${x.qJanela === 1 ? 'questão' : 'questões'}
                </span>
              </div>
              <div class="pl-rodape">
                <p class="pl-base">Resolva <b>${x.faltaAmostra}</b> ${x.faltaAmostra === 1 ? 'questão' : 'questões'} para este assunto entrar no cálculo${x.faltaIdeal > x.faltaAmostra ? ` — <b>${x.faltaIdeal}</b> para a taxa ficar confiável de verdade` : ''}.</p>
                <button type="button" class="btn-secondary plano-nova-extra" style="padding:6px 12px;font-size: var(--fs-2xs);white-space:nowrap;"
                  data-topico="${escapeHtml(x.nome)}" data-disc="${escapeHtml(x.disciplina || '')}"
                  data-alvo="${x.faltaAmostra}" data-motivo="diagnostico">+ Atividade</button>
              </div>
            </div>
          </div>`).join('')}
        ${this.rodapeFatia(fPeq, 'assunto sem diagnóstico', 'assuntos sem diagnóstico',
          fPeq.faltam ? { txt: 'todos esperam questões para entrar na conta' } : null)}
      </div>` : '';
    /* COMO LER — enxugado de oito parágrafos para três. Os outros cinco viraram
       "i" no lugar exato onde o termo aparece: explicação que só existe num
       texto de apoio no fim da tela é explicação que ninguém lê na hora da
       dúvida. Este bloco fica no RODAPÉ agora, como referência, e não como a
       primeira coisa entre você e a sua lista. */
    /* ── A PORTA DA AUDITORIA MUDOU DE LUGAR ────────────────────────────────
       Ela vivia aqui, recolhida no fim do Plano — depois de trinta assuntos, do
       segundo plano e das lacunas do edital. Quem queria auditar rolava a tela
       inteira para achar; quem não queria esbarrava nela toda vez. Agora é uma
       seção da folha de ajustes (🧪 Auditoria), junto dos parâmetros que o
       arquivo carrega, e os botões são marcação fixa: os ouvintes ficam
       registrados uma vez só, fora da repintura. */
    const comoLer = `
      <details class="rfc-advanced" style="margin:18px 0 0;padding:12px 14px;">
        <summary style="cursor:pointer;font-weight:700;font-size: var(--fs-sm);">📖 Como ler esta tela</summary>
        <div class="pl-prosa" style="margin-top:10px;line-height:1.7;">
          <p style="margin:0 0 10px;"><strong>Domínio</strong> é a sua taxa média de acerto nos assuntos que você já praticou o suficiente para medir — o número grande lá em cima, e o que deve subir. <strong>pp</strong> é <em>ponto percentual</em>: sair de 70% para 75% é ganhar 5pp.</p>
          <p style="margin:0 0 10px;"><strong>A taxa de cada assunto é sempre a mais recente possível.</strong> O app parte da última importação e só recua no tempo até juntar a amostra que você pediu — por isso um assunto já corrigido não fica preso ao desempenho antigo, e por isso cada item mostra em quantas questões e de quantos dias ele foi medido. Amostra pequena dá margem grande (63% ±11pp), e é por isso que assunto pouco praticado fica de fora da média, no segundo plano.</p>
          <p style="margin:0;"><strong>Como agir:</strong> escolha o modo de ataque que corresponde ao seu momento, comece pelo topo da lista e use <strong>+ Atividade</strong> para virar cada assunto numa tarefa com meta. Reimporte o TEC quando terminar: é a reimportação que diz se funcionou — nenhuma outra coisa nesta tela diz.</p>
        </div>
      </details>`;

    /* ── O QUE FAZER HOJE ────────────────────────────────────────────────────
       A tela terminava num diagnóstico: aqui está o seu domínio, aqui estão
       trinta assuntos em ordem. Diagnóstico não é plano. Este bloco corta a
       lista no tamanho de UMA semana do seu ritmo real e transforma o topo em
       tarefa — de uma vez, porque criar sete atividades tocando sete botões é
       uma barreira que faz a pessoa não criar nenhuma. */
    let hoje = '';
    if (r.itens.length) {
      /* O bloco é do TAMANHO DO SEU RITMO, e o rótulo diz quanto tempo ele leva
         de verdade. Prometer "esta semana" para um assunto que exige três
         semanas do seu ritmo é o mesmo erro do "caminho mais curto" que não era
         curto: um número que soa exato e planeja errado.

         E a fila não para no bloco: os próximos vêm listados junto, marcáveis.
         Fechar a lista no que cabe numa semana escondia a decisão mais comum —
         "este eu faço agora, aquele eu troco pelo seguinte" — e obrigava a
         descer a lista inteira para criar a atividade de um assunto que estava
         em quarto lugar. */
      const capacidade = Math.max(1, r.ritmo || 0);
      const bloco = [];
      let somaQ = 0;
      for (const x of r.itens) {
        if (bloco.length >= this.PLANO_BLOCO_MAX || somaQ >= capacidade) break;
        bloco.push(x); somaQ += x.custoQ;
      }
      const semanasBloco = Math.max(1, Math.round(somaQ / capacidade));
      /* ── A FILA DEPOIS DO BLOCO ABRE COMO TODAS AS OUTRAS LISTAS ────────
         Ela mostrava oito itens fixos e terminava sem dizer que terminava:
         quem quisesse trocar o quinto por um assunto que estava em décimo
         segundo lugar tinha de descer a lista inteira lá embaixo e criar a
         atividade de lá. Agora ela segue a MESMA regra das outras sete listas
         do Plano — abre no passo configurado (10 por padrão) e um toque abre
         mais 10 — com o rodapé dizendo de quantos. */
      /* O TOTAL da fila é o plano INTEIRO menos o bloco — não o que o motor
         calculou. É a mesma honestidade da lista de assuntos: sem isso o
         rodapé diria "fim da fila" com 209 assuntos esperando atrás do
         limite, que é exatamente a mentira por omissão que o passo de 10 veio
         desfazer. */
      const fProx = {
        chave: 'proximos', passo: this._passoFatia,
        vis: r.itens.slice(bloco.length, bloco.length + this._passoFatia + (this._fatias['proximos'] || 0)),
        total: Math.max(0, (r.totalItens || r.itens.length) - bloco.length)
      };
      fProx.faltam = Math.max(0, fProx.total - fProx.vis.length);
      const proximos = fProx.vis;
      const linhaHoje = (x, dentro) => `
        <li class="${dentro ? '' : 'fora'}">
          <label class="pl-hoje-check">
            <input type="checkbox" class="pl-hoje-sel" ${dentro && !x.extraAberta ? 'checked' : ''} ${x.extraAberta ? 'disabled' : ''}
              data-topico="${escapeHtml(x.nome)}" data-disc="${escapeHtml(x.disciplina || '')}" data-alvo="${x.custoQ}">
            <span class="pl-hoje-nome">${escapeHtml(x.nome)}</span>
          </label>
          <span class="pl-hoje-num tone-${x.conf.tom}">${x.taxa.toFixed(0)}%</span>
          <span class="pl-hoje-q">${x.custoQ}q</span>
          ${x.extra ? SELO_ATIV(x) : ''}
        </li>`;
      hoje = `
        <div class="pl-hoje">
          <div class="pl-hoje-top">
            <strong>🎯 O seu próximo bloco</strong>
            <span>${bloco.length} ${bloco.length === 1 ? 'assunto' : 'assuntos'} · ${somaQ.toLocaleString('pt-BR')} questões · ≈${semanasBloco} ${semanasBloco === 1 ? 'semana' : 'semanas'} no seu ritmo de ${capacidade}/sem</span>
          </div>
          ${/* A FILA PROMETE MAIS PRECISÃO DO QUE A AMOSTRA TEM. Com 20 a 50
                questões por assunto, a diferença entre o 1º e o 4º costuma
                caber dentro da margem de erro dos dois — e o aluno reordena a
                vida atrás de um primeiro lugar que o dado não sustenta. Dizer
                o empate não enfraquece a fila: liberta a escolha, porque
                qualquer um dos empatados rende praticamente o mesmo. */''}
          ${/* UM EMPATE CURTO ORIENTA; UM EMPATE LONGO DENUNCIA. Dizer "os 21
                primeiros estão empatados" é verdade e é inútil: demole a lista
                sem dizer o que fazer. Até o tamanho do bloco, o empate é uma
                permissão ("troque à vontade"). Acima disso, o que o número
                está contando é outra coisa — a amostra por assunto é curta
                demais para ordenar — e a saída não é escolher melhor, é
                concentrar volume. */''}
          ${(r.ordenar === 'pior' && r.empatados >= 2) ? (r.empatados <= bloco.length + 2
            ? `<p class="pl-ciclo-obs pl-empate">⚖️ Os <b>${r.empatados} primeiros</b> estão empatados dentro da margem de erro: marcamos os ${bloco.length} de cima, mas troque por qualquer um deles sem perda.</p>`
            : `<p class="pl-ciclo-obs pl-empate">⚖️ <b>${r.empatados} assuntos</b> do topo estão empatados dentro da margem — a mediana de ${r.medianaJanela} questões por assunto não dá para ordenar tão fino. A fila serve para dizer <b>onde procurar</b>, não em que ordem exata — a escolha que de fato pesa está no quadro acima, entre matérias.</p>`) : ''}
          <ol class="pl-hoje-lista">
            ${bloco.map(x => linhaHoje(x, true)).join('')}
            ${proximos.length ? `<li class="pl-hoje-sep">depois destes, a fila segue com:</li>` + proximos.map(x => linhaHoje(x, false)).join('') : ''}
          </ol>
          ${this.rodapeFatia(fProx, 'assunto na fila', 'assuntos na fila',
            fProx.faltam ? { txt: 'marque qualquer um: a fila não obriga a ordem' } : null)}
          <button type="button" class="btn-primary" id="plano-lote">＋ Criar as atividades marcadas</button>
          <p class="pl-hoje-nota">A fila é recalculada a cada retrato importado — marcar aqui não a congela.</p>
        </div>`;
    }

    /* ── A ORDEM ESCOLHIDA, POR EXTENSO ──────────────────────────────────────
       Inclusive as ordens GÊMEAS: com os ajustes de agora, quais outras dariam
       exatamente esta mesma lista. Antes isso aparecia num único caso e só
       quando você escolhia "melhor retorno" — nos outros, você trocava de
       cenário, via a mesma lista e concluía que a tela estava quebrada. */
    const info = PlanoEngine.ORDENS[r.ordenar] || PlanoEngine.ORDENS.pior;
    const gemeas = r.equivalentesConfiaveis ? (r.equivalentes || []).map(k => (PlanoEngine.ORDENS[k] || {}).rot).filter(Boolean) : [];
    const ordemNota = `
      <div class="pl-ordem">
        <p class="pl-ordem-tit">${info.rot} · ${r.itens.length} ${r.itens.length === 1 ? 'assunto' : 'assuntos'}</p>
        <p class="pl-ordem-txt">${escapeHtml(info.oque)}</p>
        <p class="pl-ordem-txt"><b>Quando usar:</b> ${escapeHtml(info.quando)}</p>
        <p class="pl-ordem-txt tone-warn"><b>Armadilha:</b> ${escapeHtml(info.armadilha)}</p>
        ${(r.ordenar === 'banca' && !r.temIncid)
          ? `<p class="pl-ordem-txt tone-bad"><b>Sem efeito agora:</b> nenhuma incidência importada — importe em 🎲 Incidência para esta ordem existir de verdade.</p>` : ''}
        ${(r.ordenar === 'banca' && r.temIncid)
          ? `<p class="pl-ordem-txt">${r.comIncid} dos ${r.itens.length} assuntos listados têm incidência em <b>${escapeHtml(ReforcoEngine.rotuloBancas(r.banca))}</b>; a banca pesa ${r.pesoBanca} nesta fila.</p>` : ''}
        ${gemeas.length
          ? `<p class="pl-ordem-txt tone-warn"><b>Com os seus dados e ajustes de agora, esta ordem está dando a mesma lista que:</b> ${gemeas.map(escapeHtml).join(' · ')}. Trocar entre elas não muda uma linha — para separá-las, mude o custo ou a ponderação nos ajustes avançados.</p>` : ''}
      </div>`;

    /* ── POR QUE O PRIMEIRO É O PRIMEIRO ─────────────────────────────────────
       A pergunta que a lista nunca respondia. Sem ela, a ordem é um oráculo:
       obedece-se ou desconfia-se, e nos dois casos não se aprende nada. */
    let porQue = '';
    if (r.itens.length) {
      const x = r.itens[0];
      const partes = [`acerta <b>${x.taxa.toFixed(0)}%</b> (${Math.max(0, r.meta - x.taxa).toFixed(0)} pontos abaixo da meta)`];
      if (r.ordenar === 'rendimento' || r.ordenar === 'banca') partes.push(`fecha com cerca de <b>${x.custoQ}</b> questões`);
      if (r.ordenar === 'ganhoGeral' || r.ordenar === 'volume' || r.ponderacao === 'volume') partes.push(`tem <b>${x.qJanela}</b> questões na amostra`);
      if (r.ordenar === 'queda' && x.delta != null) partes.push(`caiu <b>${Math.abs(x.delta)}pp</b> contra o período anterior`);
      if (r.ordenar === 'banca' && x.incid > 0) partes.push(`e aparece <b>${x.incid}</b> vezes na incidência da banca`);
      if (r.ordenar === 'ganhoDominio') partes.push(`e sozinho levanta <b>${x.ganhoDominio.toFixed(1)}pp</b> do seu domínio`);
      porQue = `<p class="pl-porque">👉 <b>${escapeHtml(x.nome)}</b> está em 1º porque ${partes.join(', ')}.</p>`;
    }

    /* ── O QUE O TEC NÃO MEDIU ───────────────────────────────────────────────
       Disciplina do seu planejamento sem questão resolvida não é ponto forte
       nem fraco: é um ponto cego, e some justamente da tela feita para não
       deixar nada se esconder. */
    let edital = '';
    /* Só com a tela em "Todas": este bloco fala de AMPLITUDE — o que do seu
       planejamento ficou fora de todas as contas. Filtrada numa disciplina, a
       tela responde outra pergunta, e listar as lacunas das outras ali seria
       resposta para pergunta que ninguém fez. */
    const lac = (opts.disciplina === '__todas__') ? PlanoEngine.lacunasDoEdital(opts) : null;
    if (lac && (lac.sem.length || lac.pouca.length)) {
      const chip = (d, extra) => `<span class="pl-edital-chip">${escapeHtml(d.nome)}${extra}</span>`;
      /* Fichas ocupam pouco cada uma e muito no conjunto: com um edital
         grande, "nunca praticadas" virava um parágrafo de trinta linhas antes
         do próximo bloco. Mesmo passo das outras listas. */
      const fSem = this.fatiar('edital-sem', lac.sem, this._passoFatia);
      const fPouca = this.fatiar('edital-pouca', lac.pouca, this._passoFatia);
      edital = `
        <div class="pl-edital">
          <p class="section-label" style="margin:0 0 4px;">🚧 Do seu planejamento, sem medição no TEC</p>
          <p class="pl-prosa" style="margin:0 0 10px;">
            O Plano só enxerga o que você praticou. Estas disciplinas estão no seu planejamento e
            <strong>não têm questões suficientes</strong> para entrar em nenhuma conta desta tela —
            não aparecem como fracas porque não aparecem de jeito nenhum.
            ${lac.medidas} de ${lac.total} disciplinas do plano estão medidas.
          </p>
          ${lac.sem.length ? `<p class="pl-edital-linha"><b>Nunca praticadas:</b> ${fSem.vis.map(d => chip(d, '')).join('')}</p>
            ${this.rodapeFatia(fSem, 'disciplina nunca praticada', 'disciplinas nunca praticadas')}` : ''}
          ${lac.pouca.length ? `<p class="pl-edital-linha"><b>Quase sem dado:</b> ${fPouca.vis.map(d => chip(d, ' · ' + d.q + 'q')).join('')}</p>
            ${this.rodapeFatia(fPouca, 'disciplina quase sem dado', 'disciplinas quase sem dado')}` : ''}
          ${lac.naoCasaram.length ? `<p class="pl-prosa" style="margin:10px 0 0;color:var(--text-faint);">
            O cruzamento é pelo NOME da disciplina. Estas existem no TEC e não em nenhuma disciplina do seu planejamento —
            se alguma for a mesma coisa com outro nome, renomeie para o app parar de contá-la à parte:
            ${lac.naoCasaram.map(n => escapeHtml(n)).join(' · ')}</p>` : ''}
        </div>`;
    }

    /* ── O CICLO NA TELA ──────────────────────────────────────────────────
       Três blocos que juntos respondem "está funcionando?": o que está aberto
       agora, o que os retratos já julgaram, e o que o seu histórico ensinou
       sobre o custo de virar um assunto. Sem eles a tela só sabia mandar. */
    const emCurso = PlanoCiclo.emCurso(r);
    const SELO = {
      funcionou: ['✅', 'tone-good', 'resolvido'],
      naoFuncionou: ['⚠️', 'tone-bad', 'volume não resolveu'],
      subiu: ['📈', 'tone-good', 'subindo'],
      andamento: ['▶', 'incid', 'em andamento'],
      orfa: ['❓', '', 'sem correspondência no TEC']
    };
    /* ── O PLANO NÃO GERENCIA, O PLANO DECIDE ──────────────────────────────
       O bloco completo de atividades em curso morava aqui — e transformava a
       tela de decisão em painel de gestão. Três lugares para a mesma coisa
       (aqui, a agenda do dia e a lista de pendências) não é organização, é
       dispersão: simplicidade vem de mover, não de somar. A gestão mudou para
       a tela de Atividades, onde a execução já vive; aqui fica a linha que diz
       que existe algo em curso e leva até lá.

       O detalhe continua disponível para quem quiser: o bloco abre. Só não é
       mais a primeira coisa que a tela de decisão mostra. */
    const emAlerta = emCurso.filter(v => v.estado === 'naoFuncionou' || v.estado === 'orfa').length;
    /* Ordena o que PEDE ATENÇÃO para o topo antes de fatiar: cortar uma lista
       na ordem de criação esconderia justamente o reforço que não funcionou. */
    const cursoOrd = emCurso.slice().sort((a, b) => {
      const peso = (v) => (v.estado === 'naoFuncionou' ? 0 : v.estado === 'orfa' ? 1 : 2);
      return peso(a) - peso(b) || (b.pct || 0) - (a.pct || 0);
    });
    const fCurso = this.fatiar('curso', cursoOrd, this._passoFatia);
    const blocoCurso = !emCurso.length ? '' : `
      <details class="pl-ciclo pl-ciclo-mini">
        <summary>
          <strong>📌 ${emCurso.length} ${emCurso.length === 1 ? 'reforço em curso' : 'reforços em curso'}</strong>
          <span>${emCurso.reduce((a, v) => a + v.feito, 0)}/${emCurso.reduce((a, v) => a + v.alvo, 0)} questões · o progresso vem dos seus retratos${emAlerta ? ' · <b class="tone-bad">' + emAlerta + ' pedindo atenção</b>' : ''}</span>
          <span class="chev">▾</span>
        </summary>
        <p class="pl-ciclo-obs">A gestão completa fica em <button type="button" class="pl-ciclo-acao" id="plano-ir-extras">✅ Atividades</button> — aqui é só a decisão.</p>
        <ul class="pl-ciclo-lista">
          ${fCurso.vis.map(v => {
            const [ic, tom, rot] = SELO[v.estado] || SELO.andamento;
            const evo = (v.origem.taxaInicial != null && v.taxa != null)
              ? `${v.origem.taxaInicial.toFixed(0)}% → <b class="tone-${v.delta != null && v.delta >= 0 ? 'good' : 'bad'}">${v.taxa.toFixed(0)}%</b>`
              : (v.taxa != null ? `${v.taxa.toFixed(0)}%` : 'sem medição');
            /* O alvo velho não vira alarme: fica o número de hoje ao lado, para
               quem quiser ver que a estimativa mudou. Um aviso a cada retrato
               seria ruído num dado que não muda decisão nenhuma. */
            const custo = (v.custoHoje && Math.abs(v.custoHoje - v.alvo) >= Math.max(20, v.alvo * 0.35))
              ? `<span class="pl-ciclo-obs" title="A estimativa do Plano mudou com os retratos novos. O alvo da atividade continua o que você combinou.">o Plano hoje estima ${v.custoHoje}q</span>` : '';
            return `<li data-extra="${escapeHtml(v.extra.id)}">
              <div class="pl-ciclo-top">
                <span class="pl-ciclo-nome">${escapeHtml(v.origem.topico)}</span>
                <span class="reforco-tag ${tom}">${ic} ${rot}</span>
              </div>
              <div class="pl-ciclo-barra"><i style="width:${v.pct}%"></i></div>
              <div class="pl-ciclo-nums">
                <span><b>${v.feito}</b>/${v.alvo} questões${v.medido > v.manual ? ' <span class="pl-ciclo-obs" title="Contadas a partir dos seus retratos do TEC — você não precisa lançar à mão.">medidas pelo retrato</span>' : ''}</span>
                <span>${evo}</span>
                ${custo}
              </div>
              ${v.estado === 'orfa' ? `<p class="pl-ciclo-obs">Este assunto não aparece em nenhum retrato — renomeado ou removido no TEC. <button type="button" class="pl-ciclo-acao" data-ciclo-excluir="${escapeHtml(v.extra.id)}">Excluir a atividade</button></p>` : ''}
              ${v.estado === 'naoFuncionou' ? `<p class="pl-ciclo-obs tone-bad">Você cumpriu as questões e a taxa não subiu: o buraco é de teoria, não de volume. Retome o conteúdo antes de resolver mais.</p>` : ''}
            </li>`;
          }).join('')}
        </ul>
        ${this.rodapeFatia(fCurso, 'reforço em curso', 'reforços em curso',
          fCurso.faltam ? { txt: 'os que pedem atenção vêm primeiro' } : null)}
      </details>`;

    const fTodosFech = PlanoCiclo.fechados();
    const fFech = this.fatiar('fechados', fTodosFech, this._passoFatia);
    const fechados = fFech.vis;
    const blocoFeito = !fechados.length ? '' : `
      <details class="pl-ciclo pl-ciclo-hist">
        <summary><strong>🏅 O que os retratos já julgaram</strong> <span>${fechados.length} ciclo(s) fechado(s)</span> <span class="chev">▾</span></summary>
        <ul class="pl-ciclo-lista">
          ${fechados.map(v => {
            const bom = v.tipo === 'funcionou';
            return `<li>
              <div class="pl-ciclo-top">
                <span class="pl-ciclo-nome">${escapeHtml(v.topico)}</span>
                <span class="reforco-tag ${bom ? 'tone-good' : 'tone-bad'}">${bom ? '✅ funcionou' : '⚠️ não funcionou'}</span>
              </div>
              <div class="pl-ciclo-nums">
                <span>${v.taxaInicial != null ? v.taxaInicial.toFixed(0) + '%' : '?'} → <b>${v.taxaFinal != null ? v.taxaFinal.toFixed(0) + '%' : '?'}</b>${v.ganhoPP != null ? ` (${v.ganhoPP >= 0 ? '+' : ''}${v.ganhoPP}pp)` : ''}</span>
                <span>${v.questoes} questões · ${escapeHtml(formatDateShort(v.em))}</span>
              </div>
            </li>`;
          }).join('')}
        </ul>
        ${this.rodapeFatia(fFech, 'ciclo julgado', 'ciclos julgados')}
      </details>`;

    /* A CALIBRAGEM: o custo por ponto do Plano é um palpite de fábrica até o
       seu histórico responder a mesma pergunta. Aqui ele responde. */
    /* ── A NOTA PROJETADA ─────────────────────────────────────────────────
       Um número que "estudar" não dá: onde você está em relação a passar. Vem
       com a composição à vista de propósito — a projeção é aritmética sobre o
       que VOCÊ digitou, e erro de digitação tem de virar visível em vez de
       virar recomendação errada. E o corte é declarado como estimativa sua,
       não como fato: "faltam 12 pontos" sem dizer de onde veio o 72 é pior que
       não ter número nenhum. */
    const pj = r.projecao;
    const nEliminatorias = pj ? pj.eliminatorias.length : 0;
    const blocoPontos = (!pj || !r.temPontos) ? '' : `
      <div class="pl-ciclo pl-pontos">
        <div class="pl-hoje-top">
          <strong>🎯 Se a prova fosse hoje</strong>
          <span>pela composição que você declarou no editor de matérias</span>
        </div>
        <div class="pl-pontos-nums">
          <div class="plm"><b class="tone-${pj.passaHoje === false ? 'bad' : 'good'}">${pj.hoje.toFixed(0)}</b><span>de ${pj.valorTotal.toFixed(0)} pontos hoje</span></div>
          <div class="plm"><b class="tone-good">${pj.potencial.toFixed(0)}</b><span>fechando o Plano</span></div>
          ${pj.corte != null ? `<div class="plm"><b>${pj.corte}</b><span>corte que você informou</span></div>` : ''}
        </div>
        ${pj.corte != null ? `<p class="pl-prosa">${pj.passaHoje
          ? `Você já passaria, com <b>${(pj.hoje - pj.corte).toFixed(0)}</b> pontos de folga. Fechar o Plano leva a <b>${pj.potencial.toFixed(0)}</b>.`
          : `Faltam <b>${pj.faltaCorte.toFixed(0)}</b> pontos para o corte. Fechando o Plano você chegaria a <b>${pj.potencial.toFixed(0)}</b>${pj.potencial >= pj.corte ? ' — passa.' : ' — ainda não basta: reveja o teto ou a composição.'}`}
          <span class="pl-ciclo-obs">Corte estimado por você, do concurso anterior — não é um dado do app.</span></p>` : `
          <p class="pl-prosa">Informe a nota de corte do concurso anterior para ver a distância.
            <button type="button" class="pl-ciclo-acao" id="plano-def-corte">definir o corte</button></p>`}
        ${nEliminatorias ? `<p class="pl-aviso" style="border-color:var(--bad);background:var(--bad-soft);color:var(--bad-text);">
          🚨 <b>${nEliminatorias} ${nEliminatorias === 1 ? 'matéria abaixo do mínimo' : 'matérias abaixo do mínimo'} eliminatório:</b>
          ${pj.eliminatorias.map(l => escapeHtml(l.nome) + ' (' + l.taxa.toFixed(0) + '% de ' + l.minimo + '% exigidos)').join(' · ')}.
          Isso elimina independentemente do total — vem antes de qualquer otimização de pontos.</p>` : ''}
        ${pj.semDado.length ? `<p class="pl-ciclo-obs">Sem medição no TEC: ${pj.semDado.map(escapeHtml).join(', ')} — ${pj.semDado.length === 1 ? 'esta matéria ficou' : 'estas matérias ficaram'} fora da projeção.</p>` : ''}
        <details class="pl-comp">
          <summary>a composição que estou usando <span class="chev">▾</span></summary>
          <ul class="pl-comp-lista">
            ${this.fatiar('composicao', pj.linhas, this._passoFatia).vis.map(l => `<li><span>${escapeHtml(l.nome)}</span><span>${l.q} questões × ${l.pts} pt${l.peso !== 1 ? ' × peso ' + l.peso : ''}</span><span>${l.taxa != null ? l.taxa.toFixed(0) + '%' : '—'}${l.minimo != null ? ' · mín. ' + l.minimo + '%' : ''}</span></li>`).join('')}
          </ul>
          <p class="pl-ciclo-obs">Editável em ⚙ Ciclo → matérias. Erro de digitação aqui vira recomendação errada.</p>
        </details>
      </div>`;
    /* PRÉ-EDITAL a régua NÃO troca: sem composição você não maximiza pontos
       conhecidos, encolhe o pior caso — e é isso que "todo assunto pesa igual"
       faz. A tela diz qual régua está valendo, porque a decisão muda com ela. */
    const blocoRegua = r.modoEdital === 'pos' && !r.temPontos ? `
      <p class="pl-aviso" style="border-color:var(--warn);background:var(--warn-soft);color:var(--warn-text);">
        📋 Edital publicado, mas a composição da prova está em branco. Preencha
        <b>Qtd. Q.</b> e <b>Pts/Q</b> por matéria em ⚙ Ciclo e o Plano passa a contar
        <b>pontos</b> em vez de domínio.</p>` : '';
    /* ── O QUADRO QUE RESPONDE "QUAIS MATÉRIAS EU PRIORIZO" ───────────────── */
    const tm = PlanoPontos.esforcoPorMateria(opts);
    /* Cada veredito tem DUAS redações: o VERBO, que cabe na linha, e a frase
       inteira, que explica o verbo e agora mora na análise do "i". Antes só
       existia a frase — e ela era repetida em cada linha do quadro, o que
       transformava seis matérias em seis parágrafos. */
    const VER = {
      comecar:    ['🔴', 'tone-bad',  'comece agora',     'vale ponto na sua prova e você não tem nenhuma questão resolvida aqui'],
      atacar:     ['🎯', 'tone-bad',  'ataque aqui',      'é onde mais ponto da prova ainda está em jogo'],
      reduzir:    ['🟠', 'tone-warn', 'reduza',           'você gasta muito tempo aqui e já sobrou pouco a ganhar'],
      fila:       ['🟡', 'tone-warn', 'na fila',          'entra assim que as de cima saírem'],
      depois:     ['🟡', 'tone-warn', 'fica para depois', 'você vai mal, mas esta matéria pesa pouco na sua prova'],
      manter:     ['✅', 'tone-good', 'mantenha',         'pouco a ganhar aqui — você já está perto do seu máximo realista'],
      foraDoPeso: ['⚪', 'tone-soft', 'fora do peso',     'não aparece no peso da sua prova: nem o edital que você declarou nem a incidência das suas bancas a registram']
    };
    const comVeredito = tm.linhas.filter(l => l.veredito);
    /* ── DE ONDE SAI O ALVO DO BOTÃO ───────────────────────────────────────
       Das DISCIPLINAS DO RETRATO, não da lista já filtrada. Saía de `r.itens`,
       que é o resultado do Plano com o filtro de disciplina aplicado — então,
       assim que você filtrava por uma matéria, TODAS as outras perdiam o
       botão, e sobrava exatamente uma linha com ele: a que já estava
       filtrada. O botão de "vá para outra matéria" só funcionava para a
       matéria em que você já estava. */
    const discDoPlano = {};
    try {
      PlanoEngine.disciplinas(this.scopedSnapshot()).forEach(d => {
        const k = ReforcoEngine.norm(d || '');
        if (k && !discDoPlano[k]) discDoPlano[k] = d;
      });
    } catch (e) { _quiet(e, 'atacar-discs'); }
    const grandes = comVeredito.filter(l => !l.resumo);
    const soma = (tipo) => {
      const arr = comVeredito.filter(l => l.resumo === tipo);
      return arr.length ? arr.reduce((a, l) => ({ n: a.n + 1, peso: a.peso + (l.sharePeso || 0), esf: a.esf + l.shareEsforco, ganho: a.ganho + l.ganho }), { n: 0, peso: 0, esf: 0, ganho: 0 }) : null;
    };
    const rComecar = soma('comecar');
    const rMiudas = soma('miuda');
    /* ── A TABELA DE MATÉRIAS É A MAIS LONGA DA TELA, E ERA A SEM LIMITE ───
       A lista de ASSUNTOS ganhou passo de 10; esta, que vem antes dela e é a
       primeira coisa que se vê ao rolar, continuava despejando todas as
       matérias de uma vez — 21 linhas num caso real, cada uma com três
       sublinhas, antes de o aluno chegar ao bloco de ação. Quem reclamou de
       "a tela fica muito extensa" estava olhando exatamente para cá.

       Mesmo passo da lista (o campo "Assuntos por vez"), para não existirem
       dois números de configuração dizendo a mesma coisa. O rodapé declara o
       que ficou de fora em PONTOS EM JOGO, não em linhas: esconder 12
       matérias que somam 0,4pp é economia de rolagem; esconder duas que somam
       6pp seria esconder a decisão. */
    const fMat = this.fatiar('materias', grandes, this._passoFatia);
    const matVis = fMat.vis;
    const matOcultas = grandes.slice(matVis.length);
    const ganhoOculto = matOcultas.reduce((a, l) => a + (l.ganho || 0), 0);
    const acoesOcultas = matOcultas.filter(l => l.veredito === 'atacar' || l.veredito === 'comecar').length;
    const muitoOculto = tm.emJogo > 0 && ganhoOculto >= tm.emJogo / 3;
    /* Esconder a cauda é economia de rolagem; esconder um terço do prêmio é
       esconder a decisão. A moeda deste rodapé é o PONTO EM JOGO, não a
       linha — e quando o oculto passa de um terço, a nota troca de tom. */
    const maisDasMaterias = this.rodapeFatia(fMat, 'matéria', 'matérias', fMat.faltam ? {
      tom: muitoOculto ? 'warn' : '',
      txt: `as outras somam <b>${ganhoOculto >= 0.05 ? ganhoOculto.toFixed(1) + ' pp' : 'menos de 0,1 pp'}</b> em jogo`
        + (muitoOculto ? ` — <b>${Math.round(ganhoOculto / tm.emJogo * 100)}% do prêmio está aqui embaixo</b>` : '')
        + (acoesOcultas ? ` · <b>${acoesOcultas}</b> ${acoesOcultas === 1 ? 'pede ataque' : 'pedem ataque'}` : '')
    } : null);
    /* As linhas SOMADAS (miúdas, nunca começadas) não são ação: uma linha
       discreta com o total, para o quadro não perder nada sem virar parede. */
    const linhaResumo = (rs, um, muitos, obs, tom) => !rs ? '' : `
      <li class="pl-mat is-resumo" data-peso="${rs.peso.toFixed(1)}">
        <span class="pl-mat-pos">∑</span>
        <span class="pl-mat-nome">+ ${rs.n} ${rs.n === 1 ? um : muitos}</span>
        <span class="pl-mat-jogo ${rs.ganho >= 0.05 ? '' : 'fraco'}">${rs.ganho >= 0.05 ? rs.ganho.toFixed(1).replace('.', ',') : '—'}<small>pp em jogo</small></span>
        <span class="pl-mat-acoes"></span>
        <span class="pl-mat-sub">
          <span class="reforco-tag ${tom}">somadas, para o quadro não perder nada</span>
          <span><b>${rs.peso.toFixed(0)}%</b> da prova</span>
          <span><b>${rs.esf.toFixed(0)}%</b> do seu esforço</span>
          <span>${obs}</span>
        </span>
      </li>`;
    const manchete = tm.emJogo < 0.1
      ? 'nada relevante em jogo — você está no teto no que a prova cobra'
      : `<b class="tone-bad">${tm.emJogo.toFixed(0)} pp da prova ainda em jogo</b> · ${tm.nCorte} ${tm.nCorte === 1 ? 'matéria concentra' : 'matérias concentram'} metade disso`;
    /* Abaixo de meio ponto a tela diz "<1%": "0% do seu esforço · nível 57%" é
       uma linha que se contradiz (se o nível foi medido, houve questão), e o
       zero era só arredondamento que o leitor não tinha como adivinhar. */
    const pctCurto = (v) => (v == null) ? '—' : ((v > 0 && v < 0.5) ? '<1%' : v.toFixed(0) + '%');
    /* A ANÁLISE DE CADA MATÉRIA fica guardada aqui e abre no "i" da linha. Ela
       é o motivo desta reforma: a tabela antiga tentava explicar a posição
       dentro da própria célula, e o resultado era uma parede de texto em que a
       pergunta que importa — "por que ESTA antes daquela?" — continuava sem
       resposta. Guardar o HTML num mapa (em vez de num atributo) mantém a
       linha enxuta e não paga escape de HTML dentro de atributo. */
    this._matAnalise = Object.create(null);
    const blocoTempo = (!comVeredito.length) ? '' : `
      <details class="pl-ciclo pl-tempo"${tm.acoes ? ' open' : ''}>
        <summary>
          <strong>🎯 Onde atacar primeiro</strong>
          <span>${manchete} · peso ${tm.fontePeso === 'edital' ? 'pelo edital que você declarou' : 'pela incidência das suas bancas'}</span>
          <span class="chev">▾</span>
        </summary>
        <ul class="pl-mat-lista">
          ${matVis.map((l, i) => {
            const [ic, tom, rot] = VER[l.veredito];
            /* ── DA MATÉRIA PARA O ASSUNTO, EM UM TOQUE ────────────────────
               O quadro fala de MATÉRIAS; a lista abaixo fala de ASSUNTOS, e é
               ela que vira atividade. Sem esta ponte o caminho era de cinco
               passos manuais para uma decisão que o próprio quadro acabou de
               tomar.

               O botão vai onde o quadro mandou ATACAR — e só ali. Antes ele
               nascia em "muito esforço para o peso que ela tem", ou seja,
               convidava a investir mais exatamente na matéria que a linha
               acabava de acusar de consumir demais, e que era a de MENOR
               prêmio da tela. */
            const alvo = (l.veredito === 'atacar' || l.veredito === 'comecar') ? discDoPlano[l.chave] : null;
            this._matAnalise[l.chave] = this._analiseMateria(l, i + 1, tm, VER, grandes, alvo, r);
            const classe = (l.veredito === 'atacar' || l.veredito === 'comecar') ? ' is-acao' : (l.veredito === 'fila' ? ' is-fila' : '');
            return `
          <li class="pl-mat${classe}">
            <span class="pl-mat-pos">${i + 1}</span>
            <span class="pl-mat-nome">${escapeHtml(l.nome)}<button type="button" class="info-dot pl-mat-det" data-mat-det="${escapeHtml(l.chave)}"
                aria-label="Por que ${escapeHtml(l.nome)} está nesta posição" title="Por que está nesta posição">i</button></span>
            <span class="pl-mat-jogo ${l.ganho >= 0.05 ? '' : 'fraco'}">${l.ganho >= 0.05 ? l.ganho.toFixed(1).replace('.', ',') : '—'}<small>pp em jogo</small></span>
            ${/* sem botão a célula fica VAZIA de verdade (nem um espaço), para o
                  `:empty` do CSS poder apagá-la em vez de abrir buraco */''}
            <span class="pl-mat-acoes">${alvo ? `<button type="button" class="pl-atacar-bt" data-atacar="${escapeHtml(alvo)}"
                title="Filtra a lista de assuntos por ${escapeHtml(alvo)} e leva você ao bloco de criar atividades">🎯 Atacar</button>` : ''}</span>
            <span class="pl-mat-sub">
              <span class="pl-mat-verbo"><span class="reforco-tag ${tom}">${ic} ${rot}</span></span>
              <span><b>${pctCurto(l.sharePeso)}</b> da prova</span>
              <span>nível <b class="${l.taxa == null ? '' : l.taxa >= r.meta ? 'tone-good' : l.taxa < r.faixaFragil ? 'tone-bad' : 'tone-warn'}">${l.taxa != null ? l.taxa.toFixed(0) + '%' : '—'}</b>${l.estimado ? ' (estimado)' : ''}</span>
              <span><b>${pctCurto(l.shareEsforco)}</b> do seu esforço · ${l.q.toLocaleString('pt-BR')} q</span>
              ${l.sobra ? `<span class="tone-warn">já leva ${l.razao.toFixed(1)}× o peso dela</span>` : ''}
            </span>
          </li>`;
          }).join('')}
          ${linhaResumo(rComecar, 'matéria que você ainda não começou', 'matérias que você ainda não começou', 'nenhuma questão sua, cada uma abaixo de 5% da prova', 'tone-warn')}
          ${linhaResumo(rMiudas, 'matéria miúda', 'matérias miúdas', 'abaixo de 1% dos dois lados', 'tone-soft')}
        </ul>
        ${maisDasMaterias}
        <p class="pl-ciclo-obs pl-tempo-nota" data-info="${this._info(`<b>Pontos em jogo</b> = peso da matéria na sua prova × a lacuna que falta até o seu máximo realista (${tm.teto}%). É quanto da prova INTEIRA você recupera levando aquela matéria ao teto — e é a única conta que responde &quot;onde ponho a próxima hora&quot;.<br><br>Por isso a ordem não é a do seu percentual: ir mal numa matéria que vale 3% da prova rende menos que ir razoavelmente numa que vale 13%. Toque no <b>i</b> de cada linha para ver essa conta feita com os seus números.<br><br>A moeda das outras medidas é a <b>questão</b> — a única que os dois lados falam, o que faz o quadro não depender do nome que você deu às matérias no ciclo. Ir mal numa matéria que vale pouco pode ser decisão sua; o que a tela impede é você fazer essa troca sem perceber.`)}">Ordenado por <b>pontos em jogo</b> — não pelo seu percentual de acerto.</p>
      </details>`;
    const cal = PlanoCiclo.calibragem();
    const blocoCal = (cal && cal.pronta && cal.divergente) ? `
      <div class="pl-ciclo pl-calib">
        <p class="pl-ciclo-top"><strong>🎓 O que o seu histórico ensinou</strong></p>
        <p class="pl-prosa">Nos seus <b>${cal.n}</b> ciclos fechados, 100 questões renderam em média <b>${cal.ppPorCem}pp</b> de acerto no assunto atacado — ou seja, <b>${cal.qPorPonto} questões por ponto</b>. O Plano está calculando o custo com <b>${cal.atual}</b>. Calibrar deixa o caminho mais curto ser curto <em>para você</em>, e não para uma média que não existe.</p>
        <button type="button" class="btn-secondary" id="plano-calibrar">Calibrar com o meu histórico (${cal.qPorPonto} q/ponto)</button>
      </div>` : '';

    /* ── O RESTO DA FILA NÃO PODE FICAR ATRÁS DE UM CAMPO NUMÉRICO ─────────
       A lista terminava sem dizer que terminava. O topo anunciava um caminho
       mais curto de 81 assuntos, a tela mostrava 30, e a única forma de ver o
       resto era adivinhar que existia um campo "Mostrar até" dentro de uma
       folha de ajustes. Dois números certos, lado a lado, mentindo juntos.

       Agora o fim da lista diz onde você está (10 de 81), quanto falta e —
       quando a bandeira da meta cai fora da fatia — em que posição ela está.
       Abrir é um toque, no passo que você configurou; "ver todos" existe para
       quem quer a fila inteira de uma vez. */
    const fAss = {
      chave: 'assuntos', passo: this._passoFatia, vis: itensVis,
      total: r.totalItens || itensVis.length,
      faltam: Math.max(0, (r.totalItens || 0) - itensVis.length)
    };
    /* A bandeira da meta cai fora da fatia com frequência: o caminho mais
       curto do topo pode ter 81 assuntos e a tela abrir com 10. Dizer em que
       posição ela está é o que impede os dois números de se contradizerem. */
    const marcoFora = (r.idxMeta != null && r.idxMeta >= 0 && r.idxMeta >= itensVis.length);
    const maisDaLista = !linhas ? '' : this.rodapeFatia(fAss, 'assunto', 'assuntos', fAss.faltam ? {
      txt: (marcoFora ? `<b>a meta de ${r.meta}% fecha no ${r.idxMeta + 1}º</b> desta ordem` : '')
        + (marcoFora && r.qRestante ? ' · ' : '')
        + (r.qRestante ? `${r.qRestante.toLocaleString('pt-BR')} questões nos que faltam` : '')
    } : null);

    lista.innerHTML = (linhas
      /* ── A PERGUNTA VEM ANTES DA RESPOSTA ──────────────────────────────
         "O seu próximo bloco" já vinha com quatro assuntos marcados e um botão
         grande, ANTES de "Onde atacar primeiro" dizer qual matéria importa.
         Para quem abre a tela pela primeira vez isso é começar pelo fim: ele
         cria quatro atividades sem nunca ter visto que 10pp da prova estão em
         jogo e que quatro matérias concentram metade. O quadro de matérias
         escolhe ONDE; o bloco escolhe O QUÊ. Nessa ordem. */
      ? blocoPontos + blocoRegua + blocoTempo + hoje + blocoCurso + blocoCal + grafico + blocoFeito + ordemNota + porQue + linhas
      : blocoPontos + blocoRegua + blocoCurso + blocoTempo + blocoCal + blocoFeito + `<p class="hint" style="padding:18px 0;">Nenhum assunto abaixo do máximo realista — você já domina tudo que pratica.</p>`) + maisDaLista + pequenas + edital + comoLer;
    /* As sete listas do Plano compartilham um ouvinte só. Antes eram duas
       implementações quase iguais (a de assuntos e a de matérias) e cinco
       listas sem nenhuma — o tipo de duplicação que diverge na primeira
       correção que alguém faz só de um lado. */
    this._ligarFatias(lista);
    lista.querySelectorAll('.plano-nova-extra').forEach(b => b.addEventListener('click', () => {
      this.criarExtraDoPlano(b.dataset.topico, b.dataset.disc, b.dataset.alvo, b.dataset.motivo);
    }));
    /* O "i" de cada matéria: a análise inteira num diálogo, que é onde ela cabe
       — 320px de popover não seguram cinco seções com contas. */
    lista.querySelectorAll('[data-mat-det]').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const d = (this._matAnalise || {})[b.dataset.matDet];
      if (d) UI.detalhe(d.html, { title: d.titulo });
    }));
    lista.querySelectorAll('[data-traj-det]').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const d = this._trajAnalise;
      if (d) UI.detalhe(d.html, { title: d.titulo });
    }));
    const defCorte = document.getElementById('plano-def-corte');
    if (defCorte) defCorte.addEventListener('click', async () => {
      const r2 = await UI.prompt([{ key: 'corte', label: 'Nota de corte (em pontos)', type: 'number',
        value: PlanoPontos._corte() || '', hint: 'Do concurso anterior, para a mesma vaga. É uma estimativa sua — a tela sempre dirá isso.' }],
        { title: 'Nota de corte', okText: 'Salvar' });
      if (!r2) return;
      PlanoPontos.setCorte(r2.corte);
      this.renderPlanoConteudo(); showToast('Corte registrado ✓');
    });
    lista.querySelectorAll('[data-atacar]').forEach(b => b.addEventListener('click', () => {
      const sel = document.getElementById('plano-disc');
      if (!sel) return;
      const alvo = b.dataset.atacar;
      const op = [...sel.options].find(o => ReforcoEngine.norm(o.value) === ReforcoEngine.norm(alvo));
      if (!op) { showToast('Sem assuntos medidos em ' + alvo); return; }
      sel.value = op.value;
      PlanoEngine.salvarPrefs({ disciplina: op.value });
      this.renderPlanoConteudo();
      /* Rolar até o bloco de criar atividades é metade do favor: filtrar e
         deixar a pessoa procurando onde a lista mudou não resolve nada. */
      requestAnimationFrame(() => {
        const bloco = document.querySelector('#plano-lista .pl-hoje');
        if (bloco) { try { bloco.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { _quiet(e, 'atacar-scroll'); } }
      });
      showToast('Plano filtrado por ' + op.value + ' — marque o que atacar');
    }));
    const irExtras = document.getElementById('plano-ir-extras');
    if (irExtras) irExtras.addEventListener('click', () => switchScreen('extras'));
    lista.querySelectorAll('[data-ciclo-excluir]').forEach(b => b.addEventListener('click', async () => {
      const e = DB.getExtras().find(x => x.id === b.dataset.cicloExcluir);
      if (!e) return;
      if (!await UI.confirm('Excluir "' + e.titulo + '"? O assunto não aparece mais nos seus retratos.', { title: 'Excluir atividade', okText: 'Excluir', danger: true })) return;
      DB.deleteExtra(e.id); showToast('Atividade excluída'); this.renderPlanoConteudo();
    }));
    const ritmoBtn = document.getElementById('plano-ritmo-medido');
    if (ritmoBtn) ritmoBtn.addEventListener('click', () => {
      const medido = PlanoEngine.ritmoRecente(DB.getTecSnapshots().slice().reverse(), 120, PlanoEngine.excluidasSet(PlanoEngine.prefs()));
      if (!medido) return;
      const campo = document.getElementById('plano-ritmo');
      if (campo) campo.value = medido;
      PlanoEngine.salvarPrefs({ ritmoSemanal: null });
      this._planoRefC = null;
      this.renderPlanoConteudo();
      showToast('Ritmo voltou a seguir a sua medição (' + medido + '/sem)');
    });
    const todasBtn = document.getElementById('plano-todas-disc');
    if (todasBtn) todasBtn.addEventListener('click', () => {
      const sel = document.getElementById('plano-disc');
      if (sel) sel.value = '__todas__';
      PlanoEngine.salvarPrefs({ disciplina: '__todas__' });
      this._planoRefC = null;
      this.renderPlanoConteudo();
      showToast('Mostrando o número geral, de todas as matérias');
    });
    const calBtn = document.getElementById('plano-calibrar');
    if (calBtn) calBtn.addEventListener('click', async () => {
      const c = PlanoCiclo.calibragem();
      if (!c || !c.pronta) return;
      if (!await UI.confirm('Passar o custo por ponto de ' + c.atual + ' para ' + c.qPorPonto + ' questões, com base nos seus ' + c.n + ' ciclos fechados?\n\nIsso muda o custo estimado de cada assunto — e, com ele, o caminho mais curto e a ordem "melhor retorno".', { title: 'Calibrar com o meu histórico', okText: 'Calibrar' })) return;
      PlanoEngine.salvarPrefs({ custoPorPonto: c.qPorPonto });
      this.renderPlano(); showToast('Custo calibrado com o seu histórico ✓');
    });
    const lote = document.getElementById('plano-lote');
    const sincLote = () => {
      if (!lote) return;
      const n = lista.querySelectorAll('.pl-hoje-sel:checked:not(:disabled)').length;
      lote.textContent = n === 0 ? '＋ Marque ao menos um assunto'
        : n === 1 ? '＋ Criar a atividade marcada' : `＋ Criar as ${n} atividades marcadas`;
      lote.disabled = n === 0;
    };
    lista.querySelectorAll('.pl-hoje-sel').forEach(c => c.addEventListener('change', sincLote));
    sincLote();
    if (lote) lote.addEventListener('click', () => {
      let n = 0;
      lista.querySelectorAll('.pl-hoje-sel:checked:not(:disabled)').forEach(c => {
        if (this.criarExtraDoPlano(c.dataset.topico, c.dataset.disc, c.dataset.alvo, 'reforco', true)) n++;
      });
      showToast(n ? n + (n === 1 ? ' atividade criada ✓' : ' atividades criadas ✓') : 'Nenhuma atividade nova a criar');
      this.renderPlanoConteudo();
    });
    /* Os "i" desta tela nascem de `data-info` e são montados pelo InfoTips —
       que roda na ativação da tela, muito antes desta lista existir. Sem esta
       chamada, toda explicação que a repintura acabou de criar (a régua do
       quadro de matérias, as caixas de cada assunto, a trajetória) ficaria
       escrita no atributo e invisível para quem lê no telefone. */
    try { if (window.InfoTips) InfoTips.upgrade(); } catch (e) { _quiet(e, 'info-plano'); }
  },
  // ---- Incidência ----
  _incidParsed: null,
  renderIncidencia() {
    // Render novo = árvores novas. Sem limpar, uma banca excluída (ou renomeada)
    // deixaria a floresta antiga guardada e o bloco poderia nascer com dado velho.
    this._incidForests = {};
    this._incidLazy.clear();
    // datalist de bancas
    $id('incid-banca-list').innerHTML = DB.getBancas().map(b => `<option value="${escapeHtml(b)}">`).join('');
    const todasBancas = DB.getBancas();
    const card = document.getElementById('incid-bancas-card');
    const list = document.getElementById('incid-bancas-list');
    if (todasBancas.length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    this.renderBancaPicker('incid-banca-pick');
    /* A lista mostra as bancas ESCOLHIDAS. Com mais de uma marcada, o resumo do
       topo soma as duas — é o número que o Reforço e o Plano vão usar, e vê-lo
       aqui é a única forma de conferir se a soma faz sentido. */
    const sel = this.bancasSelecionadas();
    const filtro = ReforcoEngine.filtroBanca(this.bancaFiltro());
    const bancas = sel.length ? todasBancas.filter(b => ReforcoEngine._daBanca(filtro, b)) : todasBancas;
    const resumoEl = document.getElementById('incid-selecao-resumo');
    if (resumoEl) {
      if (!sel.length) {
        resumoEl.innerHTML = `<p class="incid-selecao">Somando <b>todas as ${todasBancas.length} bancas</b> importadas. Marque as suas no seletor acima para o Reforço e o Plano priorizarem só o que elas cobram.</p>`;
      } else {
        const rs = DB.getIncidencia().filter(r => ReforcoEngine._daBanca(filtro, r.banca));
        const raiz = rs.filter(r => r.depth === 0);
        const soma = (raiz.length ? raiz : rs).reduce((a, r) => a + (r.incidencia || 0), 0);
        const topicos = new Set(rs.filter(r => r.depth !== 0).map(r => ReforcoEngine.chaveInc(r.disciplina, r.topico))).size;
        resumoEl.innerHTML = `<p class="incid-selecao on">Em vigor: <b>${escapeHtml(ReforcoEngine.rotuloBancas(sel))}</b> — ${topicos.toLocaleString('pt-BR')} tópicos distintos, ${soma.toLocaleString('pt-BR')} questões somadas. É este conjunto que o 🎯 Reforço cruza com os seus erros e que o 🏁 Plano usa na ordem por incidência.${todasBancas.length > bancas.length ? ` As outras ${todasBancas.length - bancas.length} banca(s) continuam salvas, apenas fora da conta.` : ''}</p>`;
      }
    }
    const all = DB.getIncidencia();
    const autoOpen = (bancas.length === 1); // se só há uma banca, já abre o detalhe
    list.innerHTML = bancas.map(b => {
      const rows = all.filter(r => r.banca === b);
      const nDisc = rows.filter(r => r.depth === 0).length;
      // TOTAL correto: como pai = soma dos filhos, o total é a soma das DISCIPLINAS
      // (nível 0). Sem info de nível (formato colado plano), soma tudo.
      const soma = nDisc > 0
        ? rows.filter(r => r.depth === 0).reduce((s, r) => s + (r.incidencia || 0), 0)
        : rows.reduce((s, r) => s + (r.incidencia || 0), 0);
      const nSub = rows.length - nDisc;
      const maxInc = Math.max(1, ...rows.map(r => r.incidencia || 0));
      // TOTAL DO CADERNO (quando o arquivo traz a coluna "Porcentagem"): reconstrói pelo
      // % das disciplinas — total = incidência ÷ (%/100). Se a soma das disciplinas já
      // cobre ~100% (como no novo modelo), o total é o próprio "soma".
      const discComPct = rows.filter(r => r.depth === 0 && r.pct != null && r.pct > 0);
      let cadernoTotal = null;
      if (discComPct.length) {
        const sIncid = discComPct.reduce((s, r) => s + (r.incidencia || 0), 0);
        const sPct = discComPct.reduce((s, r) => s + r.pct, 0);
        if (sPct > 0) cadernoTotal = Math.round(sIncid / (sPct / 100));
      }
      const naoClass = (cadernoTotal != null && cadernoTotal > soma + 2) ? (cadernoTotal - soma) : 0;
      const headCount = (cadernoTotal != null && naoClass > 0)
        ? `${nDisc} disc. · ~${cadernoTotal.toLocaleString('pt-BR')} questões no caderno`
        : `${nDisc} disc. · ${soma.toLocaleString('pt-BR')} questões`;
      /* Resumo em PILULAS, no lugar do paragrafo corrido de antes.
         Cada numero vira um bloco com rotulo proprio — a mesma leitura de
         relance dos cartoes da aba Analise, so que com o dado daqui. */
      const pilula = (val, rot, tom) =>
        `<span class="incid-pill ${tom || ''}"><b>${val}</b><i>${rot}</i></span>`;
      const summaryHtml = [
        pilula(nDisc.toLocaleString('pt-BR'), nDisc === 1 ? 'disciplina' : 'disciplinas', 'roxo'),
        pilula(nSub.toLocaleString('pt-BR'), nSub === 1 ? 'subtópico' : 'subtópicos', 'azul'),
        pilula((cadernoTotal != null && naoClass > 0 ? '~' + cadernoTotal.toLocaleString('pt-BR') : soma.toLocaleString('pt-BR')), 'questões', 'verde'),
        (cadernoTotal != null && naoClass > 0)
          ? pilula(naoClass.toLocaleString('pt-BR'), 'sem assunto no índice', 'cinza') : ''
      ].join('') + `<span class="incid-legend">As barras mostram o peso de cada tópico em relação ao mais cobrado do grupo.</span>`;
      // Reconstrói a HIERARQUIA (disciplina → assunto → tópico) a partir das linhas salvas
      const forest = this._buildIncidForest(rows);
      // base das barras de nível 0 = maior disciplina (barras relativas aos irmãos)
      const rootMax = Math.max(1, ...forest.map(n => n.incidencia || 0));
      // A ÁRVORE NÃO É MONTADA AQUI. Antes, o índice inteiro de TODAS as bancas
      // virava HTML já no primeiro render — inclusive o de bancas fechadas, que
      // ninguém estava olhando. Agora a floresta fica guardada e só vira HTML
      // quando o bloco da banca é aberto (e, dentro dele, nível a nível).
      this._incidForests[b] = { forest, rootMax };
      const treeHtml = forest.length
        ? `<div class="itree" data-tree-banca="${escapeHtml(b)}"></div>`
        : '<div class="incid-detail-empty">Nenhum tópico.</div>';
      return `<div class="incid-banca-block ${autoOpen ? 'open' : ''}" data-banca="${escapeHtml(b)}">
        <div class="incid-banca-row expandable">
          <span class="incid-caret">▶</span>
          <span class="incid-banca-name">${escapeHtml(b)}</span>
          <span class="incid-banca-count">${headCount}</span>
          <button type="button" class="icon-btn incid-banca-ren" title="Renomear esta banca" aria-label="Renomear esta banca">✎</button>
          <button type="button" class="icon-btn danger incid-banca-del" title="Excluir esta banca" aria-label="Excluir esta banca">×</button>
        </div>
        <div class="incid-detail">
          <div class="incid-detail-summary">${summaryHtml}</div>
          <div class="itree-toolbar">
            <select class="incid-disc-filter" style="min-width:160px; padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font-size:12.5px;">
              <option value="__todas__">📚 Todas as disciplinas</option>
              ${forest.map(n => `<option value="${escapeHtml(n.nome)}">${escapeHtml(n.nome)} (${n.incidencia})</option>`).join('')}
            </select>
            <input type="text" class="incid-detail-search" placeholder="🔎 Filtrar assuntos..." style="flex:1; min-width:140px;">
            <button type="button" class="tec-tree-btn itree-expand">⊞ Expandir</button>
            <button type="button" class="tec-tree-btn itree-collapse">⊟ Recolher</button>
          </div>
          <div class="incid-detail-list">${treeHtml}</div>
        </div>
      </div>`;
    }).join('');
    // interações: expandir/recolher a banca, excluir, filtrar, e navegar a árvore
    list.querySelectorAll('.incid-banca-block').forEach(block => {
      const head = block.querySelector('.incid-banca-row');
      const del = block.querySelector('.incid-banca-del');
      /* Renomear: "FGV" e "Fgv " viravam duas bancas e a única saída era apagar
         tudo e reimportar. O nome é só um rótulo — trocar não deve custar o
         índice inteiro. */
      const ren = block.querySelector('.incid-banca-ren');
      if (ren) ren.addEventListener('click', async (e) => {
        e.stopPropagation();
        const atual = block.dataset.banca;
        const r = await UI.prompt([{ key: 'nome', label: 'Nome da banca', value: atual }],
          { title: 'Renomear banca', sub: 'Todas as linhas importadas passam a valer sob o novo nome.', okText: 'Renomear' });
        if (!r) return;
        const alvo = String(r.nome || '').trim();
        if (!alvo || alvo === atual) return;
        const n = DB.renameIncidenciaBanca(atual, alvo);
        showToast(n ? `${n} linha(s) agora em "${alvo}" ✓` : 'Nada a renomear');
        this.renderIncidencia();
      });
      head.addEventListener('click', (e) => {
        if (e.target.closest('.incid-banca-del') || e.target.closest('.incid-banca-ren')) return;
        // monta a árvore desta banca na primeira abertura (custo pago só uma vez,
        // e só para a banca que você realmente quis ver)
        if (!block.classList.contains('open')) this._incidBuildTree(block.querySelector('.itree[data-tree-banca]'));
        block.classList.toggle('open');
      });
      // Quando há uma única banca o bloco JÁ NASCE aberto (autoOpen) — e nesse caso
      // ninguém clica no cabeçalho para disparar a montagem. Sem isto, o caso mais
      // comum de todos (um só caderno) exibiria uma árvore vazia.
      if (block.classList.contains('open')) this._incidBuildTree(block.querySelector('.itree[data-tree-banca]'));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = block.dataset.banca;
        UI.confirm(`Excluir toda a incidência da banca "${b}"?`, { title: 'Excluir incidência', okText: 'Excluir', danger: true }).then(ok => {
          if (!ok) return;
          DB.clearIncidenciaBanca(b); this.renderIncidencia();
        });
        return;
      });
      // Toggle e edição por DELEGAÇÃO: as linhas passam a nascer sob demanda, então
      // não dá mais para registrar um listener por linha no momento do render —
      // e isso também elimina milhares de listeners de uma vez só.
      block.addEventListener('click', (e) => {
        const row = e.target.closest('.itree-row.has-kids');
        if (!row || !block.contains(row) || e.target.closest('.itree-edit')) return;
        e.stopPropagation();
        const nodeEl = row.closest('.itree-node');
        if (!nodeEl.classList.contains('open')) this._incidHydrate(nodeEl.querySelector(':scope > .itree-children'));
        nodeEl.classList.toggle('open');
      });
      // editar/renomear item de incidência
      block.addEventListener('click', (e) => {
        const btn = e.target.closest('.itree-edit');
        if (btn && block.contains(btn)) {
          e.stopPropagation();
          const id = btn.dataset.id;
          const nomeAtual = btn.dataset.nome;
          const incAtual = btn.dataset.inc;
          UI.prompt([
            { key: 'nome', label: 'Nome do tópico/disciplina', type: 'text', value: nomeAtual },
            { key: 'inc', label: 'Incidência (nº de questões)', type: 'number', value: incAtual, min: 0 }
          ], { title: '✎ Editar incidência', okText: 'Salvar' }).then(v => {
            if (!v) return;
            DB.updateIncidenciaItem(id, { topico: v.nome, incidencia: v.inc });
            this.renderIncidencia();
            showToast('Incidência atualizada ✓');
          });
        }
      });
      // expandir/recolher tudo
      const setAll = (open) => {
        if (open) this._incidHydrateAll(block);   // só ao expandir vale montar a árvore inteira
        block.querySelectorAll('.itree-node').forEach(n => { if (n.querySelector(':scope > .itree-children')) n.classList.toggle('open', open); });
      };
      const exp = block.querySelector('.itree-expand'); if (exp) exp.addEventListener('click', (e) => { e.stopPropagation(); setAll(true); });
      const col = block.querySelector('.itree-collapse'); if (col) col.addEventListener('click', (e) => { e.stopPropagation(); setAll(false); });
      // busca hierárquica (mostra o nó se ele OU um descendente casar; expande os caminhos)
      const search = block.querySelector('.incid-detail-search');
      // As raízes são lidas na hora do uso (não mais fixadas no render): com a árvore
      // sob demanda, elas podem ainda não existir quando os listeners são criados.
      const getRoots = () => Array.from(block.querySelectorAll('.itree > .itree-node'));
      const filterNode = (node, q) => {
        const nameEl = node.querySelector(':scope > .itree-row .itree-label');
        const selfMatch = !q || (nameEl && nameEl.dataset.s.includes(q));
        const kids = Array.from(node.querySelectorAll(':scope > .itree-children > .itree-node'));
        let kidVisible = false;
        kids.forEach(k => { if (filterNode(k, q)) kidVisible = true; });
        const visible = selfMatch || kidVisible;
        node.style.display = visible ? '' : 'none';
        if (q && kidVisible) node.classList.add('open');
        return visible;
      };
      if (search) {
        search.addEventListener('click', (e) => e.stopPropagation());
        search.addEventListener('input', () => {
          const q = this._normSearch(search.value);
          // BUSCAR exige a árvore inteira em memória — um tópico ainda não
          // materializado seria um falso negativo. Custo pago na 1ª tecla, uma vez.
          if (q) this._incidHydrateAll(block);
          getRoots().forEach(r => filterNode(r, q));
        });
      }
      // filtro por DISCIPLINA: mostra só o ramo escolhido (ou todos)
      const discSel = block.querySelector('.incid-disc-filter');
      if (discSel) discSel.addEventListener('change', () => {
        const val = discSel.value;
        this._incidBuildTree(block.querySelector('.itree[data-tree-banca]'));
        getRoots().forEach(r => {
          const nameEl = r.querySelector(':scope > .itree-row .itree-label');
          const nome = nameEl ? nameEl.getAttribute('title') : '';
          const show = (val === '__todas__') || (nome === val);
          r.style.display = show ? '' : 'none';
          if (show && val !== '__todas__') r.classList.add('open');
        });
        if (search) search.value = '';
      });
    });
  },
  // Reconstrói a floresta hierárquica a partir das linhas salvas (código define o nível)
  _buildIncidForest(rows) {
    const forest = []; let discNode = null; let byCodigo = {};
    rows.forEach(r => {
      const node = { id: r.id, nome: r.topico, incidencia: r.incidencia || 0, codigo: r.codigo || null, depth: r.depth, children: [] };
      if (r.depth === 0) { discNode = node; byCodigo = {}; forest.push(node); }
      else if (r.codigo) {
        byCodigo[r.codigo] = node;
        const parts = r.codigo.split('.');
        const parentCod = parts.slice(0, -1).join('.');
        const parent = (parts.length > 1 && byCodigo[parentCod]) ? byCodigo[parentCod] : discNode;
        (parent ? parent.children : forest).push(node);
      } else if (discNode) { discNode.children.push(node); }
      else forest.push(node);
    });
    return forest;
  },
  // floresta de cada banca, guardada para virar HTML sob demanda
  _incidForests: {},
  _incidLazy: new Map(),
  _incidSeq: 0,
  // Monta a árvore de UMA banca (chamado ao abrir o bloco). Os níveis abaixo do
  // primeiro continuam sendo promessas até serem abertos.
  _incidBuildTree(box) {
    if (!box || box.dataset.built === '1') return;
    const b = box.getAttribute('data-tree-banca');
    const reg = this._incidForests[b];
    if (!reg) return;
    box.dataset.built = '1';
    box.innerHTML = reg.forest.map(n => this._incidNodeHtml(n, 0, reg.rootMax)).join('');
    // o nível 0 já nasce aberto (classe "open"), então os filhos dele precisam existir
    box.querySelectorAll(':scope > .itree-node.open').forEach(n =>
      this._incidHydrate(n.querySelector(':scope > .itree-children')));
  },
  _incidHydrate(box) {
    if (!box) return false;
    const lid = box.getAttribute('data-ilazy');
    if (!lid) return false;
    const reg = this._incidLazy.get(lid);
    box.removeAttribute('data-ilazy');
    this._incidLazy.delete(lid);
    if (!reg) return false;
    const childMax = Math.max(1, ...reg.node.children.map(c => c.incidencia || 0));
    box.innerHTML = reg.node.children.map(k => this._incidNodeHtml(k, reg.level + 1, childMax)).join('');
    return true;
  },
  // Materializa toda a árvore de um bloco — necessário antes de BUSCAR ou de
  // "Expandir tudo": um assunto que ainda não nasceu não poderia ser encontrado.
  _incidHydrateAll(block) {
    const box = block.querySelector('.itree[data-tree-banca]');
    if (box) this._incidBuildTree(box);
    // Por NÍVEL (ver a nota em _hydrateAll da árvore do TEC): resolver um marcador
    // por varredura completa seria O(n²) e travaria a tela no índice de um caderno grande.
    let pend = block.querySelectorAll('.itree-children[data-ilazy]');
    let nivel = 0;
    while (pend.length && nivel++ < 64) {
      pend.forEach(b => this._incidHydrate(b));
      pend = block.querySelectorAll('.itree-children[data-ilazy]');
    }
  },
  _incidNodeHtml(node, level, siblingMax) {
    const hasKids = node.children && node.children.length > 0;
    // Barra RELATIVA AOS IRMÃOS (não ao total do caderno): o maior item de cada
    // grupo enche a barra, tornando a comparação visível em todos os níveis.
    const base = siblingMax || node.incidencia || 1;
    const pct = Math.max(3, Math.round((node.incidencia / base) * 100)); // piso de 3% para não sumir
    const indent = 10 + level * 16;
    const caret = hasKids ? '<span class="itree-caret">▶</span>' : '<span class="itree-dot"></span>';
    let kids = '';
    if (hasKids) {
      const lid = 'il' + (++this._incidSeq);
      this._incidLazy.set(lid, { node, level });
      kids = `<div class="itree-children" data-ilazy="${lid}"></div>`;
    }
    const ns = this._normSearch(node.nome);
    const editBtn = node.id ? `<button type="button" class="itree-edit" data-id="${node.id}" data-nome="${escapeHtml(node.nome)}" data-inc="${node.incidencia}" title="Editar/renomear" aria-label="Editar/renomear">✎</button>` : '';
    return `<div class="itree-node ${level === 0 ? 'open' : ''}">
      <div class="itree-row ${hasKids ? 'has-kids' : ''} ${level === 0 ? 'lvl0' : ''}" style="padding-left:${indent}px;">
        <span class="itree-name">${caret}<span class="itree-label" data-s="${escapeHtml(ns)}" title="${escapeHtml(node.nome)}">${escapeHtml(node.nome)}</span></span>
        <span class="itree-bar"><span style="width:${pct}%"></span></span>
        <span class="itree-val" title="${node.incidencia} questão(ões) no histórico">${node.incidencia}</span>
        ${editBtn}
      </div>
      ${kids}
    </div>`;
  },
  _normSearch(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  },
  // Fonte dos dados: 'file' (arquivo importado) ou 'paste' (textarea). Guardamos as
  // linhas do arquivo separadamente para que digitar a banca NÃO apague a importação.
  _incidFileRows: null,
  /* ── O QUE VAI ACONTECER, ANTES DE ACONTECER ──────────────────────────────
     O preview dizia só quantas linhas foram reconhecidas. Não dizia o que elas
     fariam com o que já está salvo — e a diferença entre "entram 300 tópicos
     novos" e "300 tópicos substituem os 300 que já existem" é enorme para quem
     reimporta um caderno todo mês. Agora o aviso compara com a banca digitada:
     quantos são novos, quantos já existem, e quantos serão descartados se
     "Substituir" estiver ligado. */
  _diffIncidencia(rows) {
    const banca = $id('incid-banca').value.trim();
    if (!banca || !rows || !rows.length) return '';
    const atuais = DB.getIncidencia().filter(r => r.banca && r.banca.toLowerCase() === banca.toLowerCase());
    const substituir = (document.getElementById('incid-replace') || {}).checked;
    if (!atuais.length) return ` Banca "${banca}" ainda não tem nada salvo: tudo entra como novo.`;
    if (substituir) return ` Substituindo: as ${atuais.length} linha(s) atuais de "${banca}" serão trocadas por estas.`;
    const chaves = new Set(atuais.map(r => DB._chaveIncid(banca, r)));
    let repetidas = 0;
    rows.forEach(r => { if (chaves.has(DB._chaveIncid(banca, { disciplina: r.disciplina, topico: r.topico, codigo: r.codigo }))) repetidas++; });
    return ` Em "${banca}": ${rows.length - repetidas} novo(s), ${repetidas} já existente(s) — repetido é atualizado, nunca somado.`;
  },
  updateIncidPreview() {
    const prev = document.getElementById('incid-preview');
    const text = $id('incid-text').value;
    // Se há um arquivo importado e o textarea está vazio, mantemos as linhas do arquivo.
    if (this._incidFileRows && !text.trim()) {
      this._incidParsed = this._incidFileRows;
      prev.textContent = `✓ ${this._incidFileRows.length} tópico(s) reconhecido(s) para importar (arquivo).` + this._diffIncidencia(this._incidFileRows);
      prev.style.color = 'var(--good)';
      return;
    }
    // Caso o usuário cole texto, o textarea tem prioridade (e limpamos a fonte "arquivo").
    if (text.trim()) this._incidFileRows = null;
    const banca = $id('incid-banca').value.trim();
    this._incidParsed = ReforcoEngine.parseIncidencia(text, banca || 'X');
    if (!text.trim()) { prev.textContent = 'Aguardando dados...'; prev.style.color = 'var(--text-faint)'; return; }
    if (this._incidParsed.length === 0) { prev.textContent = '⚠ Nenhuma linha reconhecida (use Disciplina · Tópico · Incidência).'; prev.style.color = 'var(--warn)'; }
    else { prev.textContent = `✓ ${this._incidParsed.length} tópico(s) reconhecido(s).` + this._diffIncidencia(this._incidParsed); prev.style.color = 'var(--good)'; }
  },
  // Sugere a sigla da banca a partir do nome do arquivo (ex.: "fcc 10 anos fiscal.xlsx" -> "FCC")
  _bancaFromFilename(name) {
    const base = String(name || '').replace(/\.[^.]+$/, '');
    const m = base.match(/\b(fcc|fgv|cespe|cebraspe|vunesp|cespe|iades|quadrix|aocp|ibfc|consulplan|idecan|fumarc|instituto\s*aocp|esaf|cesgranrio|funrio|fundatec|ivin|selecon)\b/i);
    if (m) return m[1].toUpperCase().replace(/\s+/g, ' ');
    const first = base.split(/[\s_\-]+/)[0];
    return (first && first.length <= 12) ? first.toUpperCase() : '';
  },
  handleIncidFile(file) {
    if (!file) return;
    const fn = document.getElementById('incid-file-name');
    fn.style.display = 'inline-flex'; fn.textContent = '📎 ' + file.name;
    const prev = document.getElementById('incid-preview');
    // Autopreenche a banca pelo nome do arquivo, se o campo estiver vazio
    const bancaEl = document.getElementById('incid-banca');
    if (!bancaEl.value.trim()) {
      const guess = this._bancaFromFilename(file.name);
      if (guess) bancaEl.value = guess;
    }
    const banca = bancaEl.value.trim() || 'X';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const finish = (rows) => {
      // Guarda como fonte "arquivo" (protegido contra o input da banca) e limpa colagem
      this._incidFileRows = rows;
      this._incidParsed = rows;
      $id('incid-text').value = '';
      if (rows.length === 0) { this._incidFileRows = null; prev.textContent = '⚠ Nenhum tópico reconhecido no arquivo.'; prev.style.color = 'var(--warn)'; }
      else { prev.textContent = `✓ ${rows.length} tópico(s) reconhecido(s) para importar. Confirme a banca e clique em Salvar.`; prev.style.color = 'var(--good)'; }
    };
    // CSV é texto puro: funciona offline sem biblioteca
    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (e) => finish(ReforcoEngine.parseIncidencia(e.target.result, banca));
      reader.readAsText(file);
      return;
    }
    const trySheetJS = async () => {
      prev.textContent = 'Carregando leitor de planilha…'; prev.style.color = 'var(--text-faint)';
      const ok = await ensureSheetJS();
      if (!ok || typeof XLSX === 'undefined') {
        prev.textContent = (ext === 'xls')
          ? '⚠ Formato .xls antigo requer internet. Salve como .xlsx e reenvie.'
          : '⚠ Não consegui ler a planilha. Exporte como .csv ou cole os dados.';
        prev.style.color = 'var(--warn)';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          try { ws['!ref'] = XLSX.utils.encode_range(XLSX.utils.decode_range(ws['!ref'])); } catch (e0) { _quiet(e0); }
          const tsv = XLSX.utils.sheet_to_csv(ws, { FS: '\t', RS: '\n', blankrows: false });
          finish(ReforcoEngine.parseIncidencia(tsv, banca));
        } catch (err) { prev.textContent = '⚠ Erro ao ler o arquivo.'; prev.style.color = 'var(--bad)'; }
      };
      reader.readAsArrayBuffer(file);
    };
    if (ext === 'xls') { trySheetJS(); return; }
    if (ext === 'xlsx') {
      // Leitor embutido como PRIMÁRIO (offline + ignora <dimension> incorreto). SheetJS = fallback.
      prev.textContent = 'Lendo planilha…'; prev.style.color = 'var(--text-faint)';
      MiniXLSX.readFirstSheet(file)
        .then((res) => {
          const rows = ReforcoEngine.parseIncidenciaCells(res.rows, banca);
          if (rows.length === 0) { trySheetJS(); return; }
          finish(rows);
        })
        .catch((err) => { console.error(err); trySheetJS(); });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => finish(ReforcoEngine.parseIncidencia(e.target.result, banca));
    reader.readAsText(file);
  },
  saveIncidencia() {
    const banca = $id('incid-banca').value.trim();
    if (!banca) { showToast('Informe a banca'); return; }
    // Prioridade: linhas do arquivo importado → _incidParsed → reparse do textarea
    let rows = (this._incidFileRows && this._incidFileRows.length) ? this._incidFileRows
             : (this._incidParsed && this._incidParsed.length) ? this._incidParsed
             : ReforcoEngine.parseIncidencia($id('incid-text').value, banca);
    if (!rows || rows.length === 0) { showToast('Nenhum dado de incidência reconhecido'); return; }
    // aplica a banca do campo (o parse pode ter usado placeholder 'X')
    rows.forEach(r => r.banca = banca);
    const replace = $id('incid-replace').checked;
    const r = DB.addIncidenciaRows(banca, rows, replace);
    const n = r.novas;
    $id('incid-text').value = '';
    $id('incid-file').value = '';
    $id('incid-file-name').style.display = 'none';
    this._incidParsed = null;
    this._incidFileRows = null;
    $id('incid-preview').textContent = 'Aguardando dados...';
    $id('incid-preview').style.color = 'var(--text-faint)';
    /* O aviso conta as três coisas: o que entrou, o que já existia e foi
       atualizado, e a banca. Antes dizia só "N tópicos salvos" — o mesmo texto
       tanto para uma importação nova quanto para a mesma planilha enviada duas
       vezes. */
    showToast(r.repetidas
      ? `${n} tópico(s) novo(s) · ${r.repetidas} já existia(m) e foi(ram) atualizado(s) — ${banca} ✓`
      : `${n} tópico(s) de incidência salvos na banca ${banca} ✓`);
    this.renderIncidencia();
  },
  // ---- Reforço ----
  renderReforco() {
    const snap = this.scopedSnapshot() || ReforcoEngine.currentSnapshot();
    this.renderBancaPicker('reforco-banca-pick');
    // popula o filtro de DISCIPLINA a partir da incidência das bancas escolhidas
    const discSel = document.getElementById('reforco-disc');
    if (discSel) {
      const filtro = ReforcoEngine.filtroBanca(this.bancaFiltro());
      const discs = [...new Set(DB.getIncidencia()
        .filter(r => r.depth === 0 && ReforcoEngine._daBanca(filtro, r.banca))
        .map(r => r.topico))].sort();
      const curD = discSel.value || '__todas__';
      discSel.innerHTML = `<option value="__todas__">📚 Todas as disciplinas</option>` +
        discs.map(d => `<option value="${escapeHtml(d)}" ${d === curD ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
      if (![...discSel.options].some(o => o.value === curD)) discSel.value = '__todas__';
    }
    // sugere limite pela carga horária (só na 1ª vez); depois respeita a preferência salva
    if (!this._reforcoInit) { $id('reforco-limite').value = ReforcoEngine.sugerirLimite(); this._reforcoInit = true; }
    // restaura filtros/seleções salvos (banca, ordenação, sliders, mín. e qtd.)
    this.applyReforcoPrefs();
    this.updateEstratLabel();
    this.updateGranLabel();
    // sincroniza o alternador de visão e a visibilidade dos cards laterais
    const vt = document.getElementById('reforco-view-toggle');
    if (vt) vt.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.view === (this.reforcoView || 'global')));
    const side = document.querySelector('.reforco-side-grid');
    if (side) side.style.display = ((this.reforcoView || 'global') === 'disc') ? 'none' : '';
    this.renderReforcoList();
  },
  updateEstratLabel() {
    const v = parseInt($id('reforco-estrat').value, 10);
    const lbl = document.getElementById('reforco-estrat-label');
    lbl.textContent = v <= 25 ? 'foco no erro' : v >= 75 ? 'foco na incidência' : 'equilíbrio';
  },
  /* A granularidade era um cursor de 0 a 100 que, por dentro, virava
     `Math.round(g*3)` — quatro valores. Arrastar de 0 a 16 não mudava nada; de
     16 a 17 mudava tudo. Agora são três botões, que é o que o controle sempre
     foi; o campo escondido guarda o mesmo valor de antes, então a preferência
     salva de quem já usava continua valendo. */
  updateGranLabel() {
    const el = document.getElementById('reforco-gran');
    const tog = document.getElementById('reforco-gran-toggle');
    if (!el || !tog) return;
    const v = parseInt(el.value, 10);
    const alvo = v < 33 ? '0' : v > 66 ? '100' : '50';
    if (String(v) !== alvo) el.value = alvo;   // normaliza valores antigos do cursor
    tog.querySelectorAll('button[data-gran]').forEach(b => b.classList.toggle('active', b.dataset.gran === alvo));
  },
  renderReforcoList() {
    const list = document.getElementById('reforco-list');
    const status = document.getElementById('reforco-status');
    const projEl = document.getElementById('reforco-proj');
    const snap = this.scopedSnapshot() || ReforcoEngine.currentSnapshot();
    if (!snap) {
      list.innerHTML = `<div class="evo-empty-mini">Importe seu desempenho do TEC (aba Importar) para gerar o reforço.</div>`;
      status.textContent = ''; if (projEl) projEl.innerHTML = '';
      $id('reforco-blind-card').style.display = 'none';
      $id('reforco-over-card').style.display = 'none';
      return;
    }
    const gEl = document.getElementById('reforco-gran');
    const ordEl = document.getElementById('reforco-ordenar');
    const ordenarPor = ordEl ? ordEl.value : 'oportunidade';
    /* O teto (acerto máximo realista) era 0.90 fixo no motor, enquanto o Plano
       já expõe esse mesmo conceito como ajuste. Duas telas, dois tetos, um
       deles invisível. Agora o Reforço lê o do Plano. */
    const tetoPlano = (typeof PlanoEngine !== 'undefined') ? Math.max(50, Math.min(100, PlanoEngine.prefs().tetoDominio)) / 100 : 0.90;
    const res = ReforcoEngine.suggestFrontier(snap, {
      teto: tetoPlano,
      banca: this.bancaFiltro(),
      estrategia: parseInt($id('reforco-estrat').value, 10) / 100,
      granularidade: gEl ? parseInt(gEl.value, 10) / 100 : 0.5,
      minQuestoes: parseInt($id('reforco-minq').value, 10) || 10,
      limite: parseInt($id('reforco-limite').value, 10) || 12,
      ordenarPor
    });
    // filtro por DISCIPLINA (pós-processa o resultado, sem mexer no motor)
    const discSel = document.getElementById('reforco-disc');
    const discFiltro = discSel ? discSel.value : '__todas__';
    if (discFiltro && discFiltro !== '__todas__') {
      const nk = ReforcoEngine.norm(discFiltro);
      res.items = res.items.filter(it => ReforcoEngine.norm(it.disciplina) === nk);
      res.porDisciplina = res.porDisciplina.filter(d => ReforcoEngine.norm(d.disciplina) === nk);
      res.blindSpots = (res.blindSpots || []).filter(b => ReforcoEngine.norm(b.disciplina) === nk);
      res.overinvest = (res.overinvest || []).filter(o => ReforcoEngine.norm(o.disciplina) === nk);
    }
    // Rótulo explícito de ordenação (#2 didático)
    const olEl = document.getElementById('reforco-orderlabel');
    if (olEl) {
      const map = {
        oportunidade: ['🎯', 'Ordenado por <b>oportunidade de pontos</b> (erro × incidência × zona de virada) — do que mais rende ao que menos rende.'],
        erro: ['🔴', 'Ordenado por <b>maior erro</b> — do tópico em que você mais erra ao que menos erra.'],
        incidencia: ['🏛️', 'Ordenado por <b>maior incidência</b> — do assunto mais cobrado pela banca ao menos cobrado.']
      };
      const m = map[ordenarPor] || map.oportunidade;
      olEl.innerHTML = `<span class="oi">${m[0]}</span> <span>${m[1]}</span>`;
    }
    // Banner de projeção da média (só quando há incidência cadastrada)
    if (projEl) {
      if (res.hasAnyIncid && res.cobertura > 0) {
        const cls = res.confianca === 'alta' ? 'alta' : res.confianca === 'media' ? 'media' : 'baixa';
        projEl.innerHTML = `<div class="reforco-proj-banner">
          <div class="reforco-proj-item"><span class="pv now">${res.projAtual}%</span><span class="pl">Média projetada (banca)</span></div>
          <span class="reforco-proj-arrow">→</span>
          <div class="reforco-proj-item"><span class="pv pot">${res.projPotencial}%</span><span class="pl">Potencial (dominando o TOP)</span></div>
          <div class="reforco-proj-note">Cobertura de <b>${res.cobertura}%</b> da prova pela sua amostra<span class="reforco-conf ${cls}">confiança ${res.confianca}</span></div>
        </div>`;
      } else projEl.innerHTML = '';
    }
    // status
    const parts = [];
    if (!res.fresh && res.snapDate) parts.push(`<span style="color:var(--warn)">⚠ Retrato mais recente (${formatDateShort(res.snapDate)}) tem mais de 3 meses — reimporte para dados atuais.</span>`);
    if (!res.hasAnyIncid) parts.push(`<b>${res.totalErros}</b> assunto(s) no ranking, ordenados <b>só pelo seu erro</b> — sem incidência cadastrada não há como saber o que a prova cobra. Importe o índice da banca em <b>🏛️ Incidência</b> para a fila passar a valer pontos de prova.`);
    else parts.push(`<b>${res.totalErros}</b> unidade(s) no ranking de erros · <b>${res.totalCegos}</b> ponto(s) cego(s) · fronteira com <b>${res.totalUnidades}</b> unidade(s), sem dupla contagem.`);
    status.innerHTML = parts.join(' · ');
    /* ── NOME QUE NÃO CASOU NÃO É PONTO CEGO ─────────────────────────────────
       Uma unidade da banca sem nenhuma linha de desempenho correspondente ia
       para "🕳️ você quase não praticou" — mesmo que você tivesse trezentas
       questões resolvidas ali sob outro nome. São coisas opostas: uma pede
       estudo, a outra pede acertar o nome. */
    const avisoEl = document.getElementById('reforco-casamento');
    if (avisoEl) {
      const n = res.totalSemCasamento || 0;
      if (!n) avisoEl.innerHTML = '';
      else avisoEl.innerHTML = `<div class="rfc-casamento">
        <b>⚠ ${n} ${n === 1 ? 'assunto da banca não casou' : 'assuntos da banca não casaram'} com nenhum nome do seu desempenho.</b>
        Eles ficam fora do ranking e <b>não</b> entram como ponto cego — sem casar, o app não sabe se você praticou ou não.
        Costuma ser diferença de nome entre o índice do caderno e o seu relatório de desempenho.
        ${res.casadosPorNome ? `Outros ${res.casadosPorNome} casaram só pelo nome do tópico, sem bater a disciplina.` : ''}
        <span class="rfc-casamento-lista">${res.semCasamento.map(x => escapeHtml(x.nome) + ' (' + escapeHtml(x.disciplina || '—') + ', N=' + x.incidencia + ')').join(' · ')}</span>
      </div>`;
    }
    // Renderiza conforme a visão escolhida: global (ranking) ou por disciplina (acordeão)
    if ((this.reforcoView || 'global') === 'disc') {
      this._renderReforcoPorDisciplina(list, res);
    } else {
      this._renderReforcoGlobal(list, res);
    }
    // Na visão "por disciplina" os cards laterais já entram embutidos → escondemos aqui
    const discView = (this.reforcoView || 'global') === 'disc';
    // 🕳️ Pontos cegos (alta incidência, pouca prática) — fora do ranking de erros
    const blindCard = document.getElementById('reforco-blind-card');
    const blindList = document.getElementById('reforco-blind-list');
    if (!discView && res.blindSpots && res.blindSpots.length) {
      blindCard.style.display = 'block';
      const maxB = Math.max(1, ...res.blindSpots.map(b => b.incidencia || 0));
      blindList.innerHTML = res.blindSpots.map(b => `
        <div class="reforco-mini tone-blind">
          <div class="rm-ico">🕳️</div>
          <div class="rm-body">
            <div class="rm-name" title="${escapeHtml(b.nome)}">${escapeHtml(b.nome)}</div>
            <div class="rm-sub">${escapeHtml(b.disciplina)}</div>
            <div class="rm-bar"><span style="width:${Math.round((b.incidencia / maxB) * 100)}%"></span></div>
          </div>
          <div class="rm-val">${b.incidencia}<small>${b.questoes}q feitas</small></div>
        </div>`).join('');
    } else blindCard.style.display = 'none';
    // ⚖️ Sobre-investimento
    const overCard = document.getElementById('reforco-over-card');
    const overList = document.getElementById('reforco-over-list');
    if (!discView && res.overinvest && res.overinvest.length) {
      overCard.style.display = 'block';
      const maxO = Math.max(1, ...res.overinvest.map(o => o.fatiaEsforco || 0));
      overList.innerHTML = res.overinvest.map(o => `
        <div class="reforco-mini tone-over">
          <div class="rm-ico">⚖️</div>
          <div class="rm-body">
            <div class="rm-name" title="${escapeHtml(o.nome)}">${escapeHtml(o.nome)}</div>
            <div class="rm-sub">${escapeHtml(o.disciplina)} · esforço ${o.fatiaEsforco}% vs banca ${o.fatiaBanca}%</div>
            <div class="rm-bar"><span style="width:${Math.round((o.fatiaEsforco / maxO) * 100)}%"></span></div>
          </div>
          <div class="rm-val">${o.fatiaEsforco}%<small>seu tempo</small></div>
        </div>`).join('');
    } else overCard.style.display = 'none';
  },
  // linha de tópico reutilizável (sem botões de ação)
  _reforcoItemHtml(it, rank) {
    const tone = it.pctAcerto >= 70 ? 'good' : it.pctAcerto >= 50 ? 'warn' : 'bad';
    const seloTxt = it.selo === 'fraco' ? '🔥 fraco' : it.selo === 'atencao' ? '⚠️ atenção' : '• ok';
    // #3 — por que este item está nesta posição (fator dominante)
    const motivoMap = {
      erro: ['m-erro', '🔴 subiu pelo erro'],
      incidencia: ['m-incidencia', '🎯 subiu pela incidência'],
      equilibrio: ['m-equilibrio', '⚖️ erro + incidência']
    };
    const mv = motivoMap[it.motivo] || motivoMap.equilibrio;
    const motivoHtml = `<span class="reforco-motivo ${mv[0]}" title="Fator que mais pesou para esta posição no ranking">${mv[1]}</span>`;
    // #4 — "Sem Classificação": marca e esmaece
    const semClassTag = it.semClass ? `<span class="reforco-tag semclass" title="Balde genérico do índice do TEC — pouco acionável para estudo">sem classificação</span>` : '';
    return `
      <div class="reforco-row ${it.semClass ? 'is-semclass' : ''}">
        <div class="reforco-rank">${rank}</div>
        <div class="reforco-main">
          <div class="reforco-topico">${escapeHtml(it.nome)}</div>
          <div class="reforco-meta">
            <span class="reforco-tag selo-${it.selo}">${seloTxt}</span>
            ${motivoHtml}
            <span class="reforco-tag nivel">nível ${it.nivel}</span>
            <span class="reforco-tag tone-${tone}">${it.taxaErro}% erro · ${it.erros}/${it.questoes}</span>
            ${it.temIncid
              ? `<span class="reforco-tag incid">incidência ${it.incidencia}</span><span class="reforco-tag pts">~${it.pontosRecuperaveis} pts recuperáveis</span>`
              : (it.pontosRecuperaveis > 0
                  ? `<span class="reforco-tag pts" title="Questões que você passaria a acertar na SUA amostra ao levar este assunto ao máximo realista. Sem incidência importada não dá para falar em pontos da prova.">~${it.pontosRecuperaveis} questões recuperáveis</span>`
                  : `<span class="reforco-tag semincid">sem incidência</span>`)}
            ${semClassTag}
          </div>
        </div>
      </div>`;
  },
  _renderReforcoGlobal(list, res) {
    if (!res.items.length) {
      /* A mensagem antiga mandava baixar o mínimo de questões ou mudar a
         granularidade — conselhos que não resolvem quando a causa é outra.
         Agora o texto depende do motivo real de a lista estar vazia. */
      /* A condição anterior exigia `!res.totalUnidades` junto com unidades sem
         casamento — e uma exclui a outra: se não há unidade, não há como haver
         unidade sem casamento. A mensagem mais útil das três nunca aparecia. */
      const motivo = (res.totalSemCasamento > 0)
        ? `Nenhum assunto com amostra suficiente — e <b>${res.totalSemCasamento}</b> assunto(s) da banca não casaram com nenhum nome do seu desempenho. Comece por aí: é diferença de nome, não falta de estudo.`
        : (res.totalUnidades === 0)
          ? 'Nenhum assunto com questões resolvidas no escopo atual. Importe um retrato em <b>📊 Análise</b> ou amplie o escopo.'
          : 'Nenhum assunto passou do mínimo de questões com erro a corrigir. Baixe o "mín. de questões" nos ajustes, mude a granularidade para Disciplina, ou amplie o escopo.';
      list.innerHTML = `<div class="evo-empty-mini">${motivo}</div>`;
      return;
    }
    list.innerHTML = res.items.map((it, i) => this._reforcoItemHtml(it, i + 1)).join('');
  },
  _renderReforcoPorDisciplina(list, res) {
    const discs = (res.porDisciplina || []).filter(d => d.itens.length > 0 || d.nFracos > 0 || d.incidencia > 0);
    if (!discs.length) {
      list.innerHTML = `<div class="evo-empty-mini">Nenhuma disciplina com dados suficientes. Ajuste os filtros ou importe mais retratos.</div>`;
      return;
    }
    list.innerHTML = discs.map((d, idx) => {
      const emDia = d.itens.length === 0;
      const pct = (d.pctAcerto != null) ? d.pctAcerto + '%' : '—';
      const itensHtml = d.itens.length
        ? d.itens.map((it, i) => this._reforcoItemHtml(it, i + 1)).join('')
          + (d.nItens > d.itens.length ? `<div class="rfd-emptyline">+ ${d.nItens - d.itens.length} outro(s) ponto(s) fraco(s) nesta disciplina (aumente "Qtd. de tópicos").</div>` : '')
        : `<div class="rfd-emptyline">✓ Sem pontos fracos com amostra suficiente aqui — disciplina em dia.</div>`;
      const cegosHtml = d.cegos && d.cegos.length
        ? `<div>🕳️ <b>Pontos cegos:</b> ${d.cegos.map(c => escapeHtml(c.nome) + ' (N=' + c.incidencia + ', ' + c.questoes + 'q)').join(' · ')}</div>` : '';
      const overHtml = d.over && d.over.length
        ? `<div>⚖️ <b>Sobre-investimento:</b> ${d.over.map(o => escapeHtml(o.nome) + ' (' + o.fatiaEsforco + '% vs banca ' + o.fatiaBanca + '%)').join(' · ')}</div>` : '';
      const extra = (cegosHtml || overHtml) ? `<div class="rfd-extra">${cegosHtml}${overHtml}</div>` : '';
      return `
        <div class="rfd-card ${idx === 0 && !emDia ? 'open' : ''}" data-disc="${escapeHtml(d.disciplina)}">
          <div class="rfd-head">
            <span class="rfd-caret">▶</span>
            <div class="rfd-title">
              <div class="rfd-name">${escapeHtml(d.disciplina)}</div>
              <div class="rfd-sub">
                <span class="chip">🏛️ ${d.incidencia} na banca</span>
                <span class="chip">🎯 ${pct} acerto</span>
                ${emDia ? '<span class="rfd-badge-ok">✓ em dia</span>' : `<span class="chip">🔥 ${d.nFracos} ponto(s) fraco(s)</span>`}
              </div>
            </div>
            <div class="rfd-opp ${emDia ? 'rfd-acc-good' : ''}">
              <div class="v">${emDia ? '—' : '+' + d.pontosRec}</div>
              <div class="l">${emDia ? 'em dia' : 'pts recuperáveis'}</div>
            </div>
          </div>
          <div class="rfd-body">${itensHtml}${extra}</div>
        </div>`;
    }).join('');
    list.querySelectorAll('.rfd-head').forEach(head => {
      head.addEventListener('click', () => head.closest('.rfd-card').classList.toggle('open'));
    });
  },
  reforcoToCard(topico, disciplina) {
    if (!window.CardsScreen) { showToast('Abra a aba Cards uma vez e tente de novo'); return; }
    switchScreen('cards');
    setTimeout(() => {
      CardsScreen.openCardModal(null);
      setTimeout(() => {
        const t = document.getElementById('card-topico'); if (t) t.value = topico;
        // tenta casar a disciplina do card com uma matéria existente
        const dest = document.getElementById('card-destino');
        if (dest) {
          const opt = [...dest.options].find(o => o.textContent.trim().toLowerCase() === (disciplina || '').toLowerCase());
          if (opt) dest.value = opt.value;
        }
        const fr = document.getElementById('card-frente'); if (fr) fr.focus();
      }, 60);
    }, 60);
    showToast('Criando card de reforço de "' + topico + '"');
  },
  reforcoToCiclo(topico, disciplina) {
    // adiciona como uma trilha/tarefa: cria a matéria se não existir e registra no Estudo Novo como aula de reforço
    let subj = DB.getActiveSubjects().find(s => s.nome.toLowerCase() === (disciplina || '').toLowerCase());
    if (!subj && disciplina) subj = DB.addSubject({ nome: disciplina, dificuldade: 3, fase: 'Reforço' });
    const alvo = subj ? subj.nome : (disciplina || topico);
    if (subj) {
      DB.addTrackLesson(alvo, '⚠ Reforço: ' + topico);
      showToast('Reforço adicionado à trilha de "' + alvo + '" (Estudo Novo)');
    } else {
      showToast('Cadastre a disciplina "' + disciplina + '" em Configurações primeiro');
    }
  },
  toneOf(pct) { return pct >= 70 ? 'good' : pct >= 50 ? 'warn' : 'bad'; },
  renderTotais(snap) {
    const tot = TecEngine.totais(snap);
    /* O delta compara RETRATO com RETRATO — o último do escopo contra o
       anterior. Antes confrontava o agregado do escopo inteiro (que pode somar
       cinco retratos) com um retrato só: números de tamanhos diferentes, com
       uma seta em cima dando ares de comparação. */
    const ult = this.ultimoSnapDoEscopo();
    const prev = this.prevSnap();
    let deltaHtml = '';
    if (ult && prev) {
      const d = Math.round((TecEngine.totais(ult).pct - TecEngine.totais(prev).pct) * 10) / 10;
      const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '=';
      const rot = escapeHtml('Último retrato contra o anterior · ' + (this.rotuloComparacao() || '') + ' · p.p. = pontos percentuais');
      deltaHtml = `<span class="tec-delta ${cls}" title="${rot}">${arrow} ${d > 0 ? '+' : ''}${d} p.p.</span>`;
    }
    // cor do aproveitamento pela MESMA regra do resto do app (metas de ⚙ Metas)
    const TOM = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad, #e0393f)' };
    const corPct = tot.questoes === 0 ? 'var(--text-faint)' : (TOM[toneFor(tot.pct)] || 'var(--accent)');
    const erros = Math.max(0, tot.questoes - tot.acertos);
    $id('tec-totais').innerHTML = `
      <div class="tec-total-card hero" style="--tec-cor:${corPct};">
        <div class="tico">🎯</div>
        <div class="val">${tot.pct}%${deltaHtml}</div>
        <div class="lbl">Aproveitamento geral</div>
      </div>
      <div class="tec-total-card" style="--tec-cor: var(--accent);">
        <div class="tico">📝</div>
        <div class="val">${tot.questoes.toLocaleString('pt-BR')}</div>
        <div class="lbl">Questões resolvidas</div>
      </div>
      <div class="tec-total-card" style="--tec-cor: var(--good);">
        <div class="tico">✅</div>
        <div class="val tone-good">${tot.acertos.toLocaleString('pt-BR')}</div>
        <div class="lbl">Acertos${erros ? ' <span class="tec-total-sub">' + erros.toLocaleString('pt-BR') + ' erros</span>' : ''}</div>
      </div>
      <div class="tec-total-card" style="--tec-cor: #7c3aed;">
        <div class="tico">📚</div>
        <div class="val">${tot.disciplinas}</div>
        <div class="lbl">Disciplinas</div>
      </div>
      ${/* O que o número grande contém nunca esteve escrito: é a soma das
            DISCIPLINAS do escopo (não a média dos tópicos), e o escopo pode
            juntar vários retratos. Sem essa linha, "72%" tanto podia ser a
            vida inteira quanto o último mês. */''}
      <p class="tec-totais-legenda">
        Soma das <b>${tot.disciplinas}</b> ${tot.disciplinas === 1 ? 'disciplina' : 'disciplinas'} do escopo${snap.count > 1 ? ` — <b>${snap.count} retratos</b> juntos` : ''}${snap.startDate ? ` · ${formatDateShort(snap.startDate)} a ${formatDateShort(snap.endDate)}` : ''}.
        ${(ult && prev)
          ? `O <b>▲▼</b> compara o último retrato com o anterior (${escapeHtml(this.rotuloComparacao() || '')}) — <b>p.p.</b> é ponto percentual.`
          : 'Com um só retrato no escopo ainda não há com o que comparar: importe outro período para ver a evolução.'}
      </p>
    `;
  },
  weakDisc: '__todas__', // '__todas__' = todas (agrupadas) | nome = só aquela disciplina
  weakRowHtml(f, showDisc) {
    const tone = this.toneOf(f.pctAcerto);
    /* MARGEM DE ERRO na linha. Sem ela, "33%" em três questões e "33%" em
       trezentas tinham exatamente a mesma cara — e a lista, ordenada por
       percentual, colocava a primeira acima da segunda. A margem é a diferença
       entre um diagnóstico e um palpite, e agora está escrita ao lado do
       número que a pessoa vai usar para decidir o que estudar. */
    const m = (typeof PlanoEngine !== 'undefined') ? PlanoEngine.margemErro(f.pctAcerto, f.questoes) : null;
    const erros = Math.max(0, (f.questoes || 0) - (f.acertos || 0));
    const frouxa = m != null && m >= 15;
    return `
      <div class="weak-row">
        <div class="weak-info">
          <div class="wname">${escapeHtml(f.nome)}</div>
          ${showDisc ? `<div class="wdisc">${escapeHtml(f.disciplina)}</div>` : ''}
          <div class="wmeta">${erros} ${erros === 1 ? 'erro' : 'erros'}${m != null ? ` · ±${m.toFixed(0)}pp` : ''}${frouxa ? ' <b title="Com esta amostra a taxa real pode estar dezenas de pontos acima ou abaixo — resolva mais questões antes de tratar isto como fraqueza.">amostra curta</b>' : ''}</div>
        </div>
        <div class="weak-track"><div class="weak-fill tone-${tone}" style="width:${f.pctAcerto}%;"></div></div>
        <div class="weak-pct tone-${tone}">${f.pctAcerto}%<span class="q">${f.acertos}/${f.questoes}</span></div>
      </div>`;
  },
  renderWeak(snap) {
    const limiar = parseInt($id('tec-weak-threshold').value, 10) || 70;
    const minQ = parseInt($id('tec-weak-minq').value, 10) || 1;
    const leaves = $id('tec-weak-leaves').checked;
    const ordEl = document.getElementById('tec-weak-ordenar');
    const modo = ordEl ? ordEl.value : 'taxa';
    /* Repintar NÃO é escolher. Salvar aqui gravava, no primeiro render, o
       limiar que a tela acabara de herdar da meta do Plano — e a partir daí a
       "régua única" deixava de acompanhar o Plano em silêncio, porque um valor
       salvo sempre vence o herdado. Quem grava é o toque na tela (ver os
       listeners no fim do arquivo). */
    const container = document.getElementById('tec-weak-list');
    const sel = document.getElementById('tec-weak-disc');

    // todos os pontos fracos do retrato (já ordenados do pior para o melhor)
    const todos = TecEngine.pontosFracos(snap, { minQuestoes: minQ, limiar, apenasFolhas: leaves });
    /* DOIS MODOS DE LEITURA, porque são duas perguntas diferentes:
         taxa    — "onde eu erro mais por questão?" (a pior taxa primeiro)
         impacto — "onde eu perco mais questões?"   (o maior número de erros)
       A lista só existia no primeiro modo, e com ele um tópico de 3 questões a
       33% ficava acima de um de 300 a 45%: o topo de "onde focar" era, na
       prática, uma lista de amostras pequenas. */
    const erroDe = (f) => Math.max(0, (f.questoes || 0) - (f.acertos || 0));
    const ordenar = (lista) => lista.slice().sort((a, b) => modo === 'impacto'
      ? (erroDe(b) - erroDe(a) || a.pctAcerto - b.pctAcerto)
      : (a.pctAcerto - b.pctAcerto || b.questoes - a.questoes));

    // popula o seletor: disciplinas que possuem ao menos um ponto fraco, ordenadas pela mais fraca
    const discPct = Object.fromEntries(TecEngine.disciplinas(snap).map(d => [d.nome, this.nodePct(d)]));
    const discsComFraco = [...new Set(todos.map(f => f.disciplina))]
      .sort((a, b) => (discPct[a] ?? 100) - (discPct[b] ?? 100));
    if (this.weakDisc !== '__todas__' && !discsComFraco.includes(this.weakDisc)) this.weakDisc = '__todas__';
    sel.innerHTML = `<option value="__todas__">Todas as disciplinas (agrupado)</option>` +
      discsComFraco.map(n => {
        const c = todos.filter(f => f.disciplina === n).length;
        return `<option value="${escapeHtml(n)}" ${n === this.weakDisc ? 'selected' : ''}>${escapeHtml(n)} — ${c} ponto(s) fraco(s)</option>`;
      }).join('');

    if (todos.length === 0) {
      container.innerHTML = `<div class="empty-state" style="padding:24px;"><div class="big">🎉</div>Nenhum tópico abaixo de ${limiar}% com ao menos ${minQ} questão(ões). Mandou bem!</div>`;
      return;
    }

    // legenda: o que a lista está respondendo agora, e com que régua
    const legenda = `<p class="weak-legenda">${modo === 'impacto'
      ? 'Ordenado por <b>erros absolutos</b>: onde você perde mais questões, mesmo que a taxa não seja a pior.'
      : 'Ordenado pela <b>pior taxa de acerto</b>: onde você mais erra por questão resolvida.'}
      Entram os tópicos abaixo de <b>${limiar}%</b> com pelo menos <b>${minQ}</b> ${minQ === 1 ? 'questão' : 'questões'} — o limiar vem da meta do 🏁 Plano e pode ser mudado aqui.</p>`;

    // FILTRO: uma disciplina específica → lista plana, só dela
    if (this.weakDisc !== '__todas__') {
      const lista = ordenar(todos.filter(f => f.disciplina === this.weakDisc));
      container.innerHTML = legenda + lista.map(f => this.weakRowHtml(f, false)).join('');
      return;
    }

    // AGRUPADO: todas as disciplinas, cada uma como um grupo (mais fraca no topo),
    // e dentro dela os tópicos do pior para o melhor
    const grupos = {};
    todos.forEach(f => { (grupos[f.disciplina] = grupos[f.disciplina] || []).push(f); });
    const errosDisc = {};
    Object.keys(grupos).forEach(d => { errosDisc[d] = grupos[d].reduce((a, f) => a + erroDe(f), 0); });
    const ordemDisc = Object.keys(grupos).sort((a, b) => modo === 'impacto'
      ? (errosDisc[b] - errosDisc[a])
      : ((discPct[a] ?? 100) - (discPct[b] ?? 100)));
    container.innerHTML = legenda + ordemDisc.map(disc => {
      const itens = ordenar(grupos[disc]);
      const dp = discPct[disc];
      const tone = dp !== undefined ? this.toneOf(dp) : 'bad';
      return `
        <div class="weak-group">
          <div class="weak-group-head">
            <span class="weak-group-name">${escapeHtml(disc)}</span>
            <span class="weak-group-meta">
              ${dp !== undefined ? `<span class="weak-group-pct tone-${tone}">${dp}%</span>` : ''}
              <span class="weak-group-count">${itens.length} ponto(s) fraco(s)</span>
            </span>
          </div>
          ${itens.map(f => this.weakRowHtml(f, false)).join('')}
        </div>`;
    }).join('');
  },
  // Usa o % reportado pelo TecConcursos (fiel ao que o usuário vê no TEC);
  // só recalcula por acertos/questões quando o TEC não informou o percentual.
  nodePct(n) {
    if (n.pctAcerto !== null && n.pctAcerto !== undefined) return n.pctAcerto;
    return n.questoes > 0 ? Math.round((n.acertos / n.questoes) * 1000) / 10 : 0;
  },
  // Índice de % por chave disciplina|codigo de UM retrato
  pctIndexOf(snap) {
    if (!snap) return null;
    const idx = {};
    (snap.rows || []).forEach(r => { idx[(r.disciplina || '') + '|' + (r.codigo || '')] = this.nodePct(r); });
    return idx;
  },
  /* Os dois lados da comparação, sempre de retratos individuais. O % exibido no
     nó continua sendo o do ESCOPO (que pode agregar vários); o ▲▼ mede a
     variação entre o último retrato e o anterior — e diz isso no título, para
     que os dois números nunca sejam lidos como a mesma coisa. */
  parIndices() {
    const u = this.pctIndexOf(this.ultimoSnapDoEscopo());
    const p = this.pctIndexOf(this.prevSnap());
    return (u && p) ? { u, p, rotulo: this.rotuloComparacao() } : null;
  },
  deltaHtml(node, par) {
    if (!par) return '';
    const key = (node.disciplina || '') + '|' + (node.codigo || '');
    if (par.u[key] === undefined || par.p[key] === undefined) return '';
    const diff = Math.round((par.u[key] - par.p[key]) * 10) / 10;
    const t = escapeHtml('Último retrato contra o anterior · ' + (par.rotulo || ''));
    if (diff === 0) return `<span class="tec-delta flat" title="${t}">=</span>`;
    const cls = diff > 0 ? 'up' : 'down';
    const arrow = diff > 0 ? '▲' : '▼';
    return `<span class="tec-delta ${cls}" title="${t}">${arrow} ${diff > 0 ? '+' : ''}${diff}</span>`;
  },
  /* ── ÁRVORE SOB DEMANDA ────────────────────────────────────────────────────
     Antes, a árvore inteira do caderno virava HTML de uma vez — milhares de nós
     em disciplina → assunto → tópico → subtópico, todos montados mesmo estando
     recolhidos e invisíveis. Em cadernos grandes isso travava a tela por
     segundos a cada render.
     Agora cada nó nasce com um marcador vazio no lugar dos filhos e só se
     materializa quando você o abre. Nada muda no que você vê: o conteúdo é o
     mesmo, e "Expandir tudo" materializa a árvore completa antes de abrir. */
  _lazyReg: new Map(),   // id do marcador → { node, level }  (só o que ainda não nasceu)
  _lazySeq: 0,
  // Renderiza UM nó; os filhos ficam como promessa até serem abertos
  treeNodeHtml(node, prevIdx, level) {
    const pct = this.nodePct(node);
    const tone = this.toneOf(pct);
    const hasKids = node.children && node.children.length > 0;
    const indent = 10 + level * 18;
    const delta = this.deltaHtml(node, prevIdx);
    const nameCls = level === 0 ? 'tnode-name lvl0' : 'tnode-name';
    const caret = hasKids ? `<span class="tnode-caret">▶</span>` : `<span class="tnode-dot"></span>`;
    let kidsHtml = '';
    if (hasKids) {
      const lid = 'tl' + (++this._lazySeq);
      this._lazyReg.set(lid, { node, level, prevIdx });
      kidsHtml = `<div class="tnode-children" data-lazy="${lid}"></div>`;
    }
    return `
      <div class="tnode ${level === 0 ? 'lvl0' : ''}" data-haskids="${hasKids ? '1' : '0'}">
        <div class="tnode-row ${hasKids ? 'has-kids' : ''}" style="padding-left:${indent}px;">
          ${caret}
          <span class="${nameCls}" title="${escapeHtml(node.nome)}">${escapeHtml(node.nome)}${delta}</span>
          <div class="tnode-track"><div class="tnode-fill tone-${tone}" style="width:${pct}%;"></div></div>
          <span class="tnode-pct tone-${tone}">${pct}%<span class="q">${node.acertos}/${node.questoes}</span></span>
        </div>
        ${kidsHtml}
      </div>`;
  },
  // Materializa os filhos de UM contêiner marcado. Idempotente: se já nasceu, sai.
  _hydrate(box) {
    if (!box) return false;
    const lid = box.getAttribute('data-lazy');
    if (!lid) return false;
    const reg = this._lazyReg.get(lid);
    box.removeAttribute('data-lazy');
    this._lazyReg.delete(lid);
    if (!reg) return false;
    // ordena os filhos SEMPRE do mais fraco para o mais forte (em cada nível e subnível),
    // para que os pontos fracos fiquem no topo em qualquer profundidade
    const kids = reg.node.children.slice()
      .sort((a, b) => this.nodePct(a) - this.nodePct(b) || b.questoes - a.questoes);
    box.innerHTML = kids.map(c => this.treeNodeHtml(c, reg.prevIdx, reg.level + 1)).join('');
    return true;
  },
  // Materializa tudo o que ainda falta dentro de um contêiner (usado por "Expandir tudo"
  // e antes de qualquer operação que precise enxergar a árvore inteira).
  _hydrateAll(root) {
    // POR NÍVEL, não um a um: procurar o próximo marcador varrendo a árvore inteira
    // a cada nó custaria O(n²) — em cadernos grandes, segundos de tela travada.
    // Aqui cada rodada resolve todos os marcadores existentes de uma vez, e a
    // rodada seguinte cuida do nível que acabou de nascer.
    let pend = root.querySelectorAll('.tnode-children[data-lazy]');
    let nivel = 0;
    while (pend.length && nivel++ < 64) {
      pend.forEach(b => this._hydrate(b));
      pend = root.querySelectorAll('.tnode-children[data-lazy]');
    }
  },
  discFilter: '__todas__', // '__todas__' = todas as disciplinas | nome = focar numa
  renderDisciplinas(snap) {
    const container = document.getElementById('tec-disc-list');
    const focusEl = document.getElementById('tec-disc-focus');
    const filterSel = document.getElementById('tec-disc-filter');
    // árvore completa, ordenada do pior para o melhor aproveitamento
    // (desempate: quem tem mais questões aparece antes)
    let forest = TecEngine.buildTree(snap).sort((a, b) => this.nodePct(a) - this.nodePct(b) || b.questoes - a.questoes);
    const prevIdx = this.parIndices();
    if (forest.length === 0) {
      focusEl.innerHTML = '';
      container.innerHTML = `<p class="wd-empty" style="padding:12px 0;">Sem dados neste retrato.</p>`;
      filterSel.innerHTML = `<option>—</option>`;
      return;
    }
    // popula o seletor (ordem alfabética, mais natural para procurar)
    const alpha = forest.slice().sort((a, b) => a.nome.localeCompare(b.nome));
    // se a disciplina filtrada não existe neste retrato, volta para "todas"
    if (this.discFilter !== '__todas__' && !forest.find(d => d.nome === this.discFilter)) {
      this.discFilter = '__todas__';
    }
    filterSel.innerHTML = `<option value="__todas__">Todas as disciplinas (${forest.length})</option>` +
      alpha.map(d => `<option value="${escapeHtml(d.nome)}" ${d.nome === this.discFilter ? 'selected' : ''}>${escapeHtml(d.nome)} — ${this.nodePct(d)}%</option>`).join('');

    const focused = this.discFilter !== '__todas__';
    const shown = focused ? forest.filter(d => d.nome === this.discFilter) : forest;

    // resumo em destaque quando uma disciplina está em foco
    if (focused && shown.length) {
      const d = shown[0];
      const pct = this.nodePct(d);
      const tone = this.toneOf(pct);
      // conta tópicos-folha fracos dentro da disciplina
      const leafWeak = TecEngine.pontosFracos({ rows: snap.rows }, { minQuestoes: 1, limiar: 70, apenasFolhas: true })
        .filter(t => t.disciplina === d.nome).length;
      focusEl.innerHTML = `
        <div class="tec-focus-card">
          <div class="tec-focus-main">
            <div class="tec-focus-name">${escapeHtml(d.nome)}${this.deltaHtml(d, prevIdx)}</div>
            <div class="tec-focus-track"><div class="tec-focus-fill tone-${tone}" style="width:${pct}%;"></div></div>
          </div>
          <div class="tec-focus-stats">
            <div class="tfs"><span class="tfs-val tone-${tone}">${pct}%</span><span class="tfs-lbl">aproveitamento</span></div>
            <div class="tfs"><span class="tfs-val">${d.questoes}</span><span class="tfs-lbl">questões</span></div>
            <div class="tfs"><span class="tfs-val" style="color:var(--good)">${d.acertos}</span><span class="tfs-lbl">acertos</span></div>
            <div class="tfs"><span class="tfs-val ${leafWeak ? '' : ''}" style="color:${leafWeak ? 'var(--bad)' : 'var(--good)'}">${leafWeak}</span><span class="tfs-lbl">tópicos < 70%</span></div>
          </div>
        </div>`;
    } else {
      focusEl.innerHTML = '';
    }

    const toolbar = `
      <div class="tec-tree-toolbar">
        <span class="tec-tree-hint">${focused ? 'Detalhamento por tópico · ' : 'Clique para abrir/fechar cada nível · '}</span>
        <button type="button" class="tec-tree-btn" id="tec-expand-all">⊞ Expandir tudo</button>
        <button type="button" class="tec-tree-btn" id="tec-collapse-all">⊟ Recolher tudo</button>
      </div>`;
    // ao focar numa disciplina, já abre o primeiro nível para leitura imediata
    this._lazyReg.clear();   // render novo: descarta promessas do render anterior
    container.innerHTML = toolbar + `<div class="tec-tree">${shown.map(d => this.treeNodeHtml(d, prevIdx, 0)).join('')}</div>`;
    // ao focar numa disciplina o primeiro nível já abre — então precisa nascer agora
    if (focused) container.querySelectorAll('.tnode.lvl0[data-haskids="1"]').forEach(n => {
      n.classList.add('open');
      this._hydrate(n.querySelector(':scope > .tnode-children'));
    });

    // Toggle por DELEGAÇÃO: um único listener no contêiner, em vez de um por linha.
    // Necessário porque as linhas passam a ser criadas depois (sob demanda) — e de
    // quebra elimina milhares de listeners que antes eram registrados de uma vez.
    container.addEventListener('click', (e) => {
      const row = e.target.closest('.tnode-row.has-kids');
      if (!row || !container.contains(row)) return;
      e.stopPropagation();
      const nodeEl = row.closest('.tnode');
      const box = nodeEl.querySelector(':scope > .tnode-children');
      if (!nodeEl.classList.contains('open')) this._hydrate(box);  // abrindo: materializa
      nodeEl.classList.toggle('open');
    });
    const setAll = (open) => {
      if (open) this._hydrateAll(container);   // só ao expandir é que vale pagar a árvore toda
      container.querySelectorAll('.tnode[data-haskids="1"]').forEach(n => n.classList.toggle('open', open));
    };
    container.querySelector('#tec-expand-all').addEventListener('click', () => setAll(true));
    container.querySelector('#tec-collapse-all').addEventListener('click', () => setAll(false));
  }
};

// Um toque fora fecha o seletor de bancas (ele é o único painel flutuante desta
// tela; sem isto, ficaria aberto por cima da lista que a pessoa quer ler).
document.addEventListener('click', () => {
  document.querySelectorAll('.banca-pick-panel').forEach(p => p.setAttribute('hidden', ''));
  document.querySelectorAll('.banca-pick-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
});

// Listeners da tela Desempenho TEC
$id('tec-btn-first-import').addEventListener('click', () => DesempenhoTecScreen.openImport());
$id('tec-btn-new-import').addEventListener('click', () => DesempenhoTecScreen.openImport());
$id('tec-toggle-cfg').addEventListener('click', () => {
  const p = DesempenhoTecScreen._loadPrefs();
  DesempenhoTecScreen.savePrefs({ hideCfg: !p.hideCfg });
  DesempenhoTecScreen.applyCfgHidden();
});
$id('tec-enxuto-btn').addEventListener('click', () => {
  const p = DesempenhoTecScreen._loadPrefs();
  DesempenhoTecScreen.savePrefs({ enxuto: !p.enxuto });
  DesempenhoTecScreen.applyEnxuto();
});
$id('tec-import-cancel').addEventListener('click', () => DesempenhoTecScreen.render());
$id('tec-import-save').addEventListener('click', () => DesempenhoTecScreen.saveImport());
$id('tec-import-text').addEventListener('input', () => DesempenhoTecScreen.updateImportPreview());
// validação do intervalo de datas (sem sobreposição)
$id('tec-import-start').addEventListener('change', () => DesempenhoTecScreen.validateRange());
$id('tec-import-end').addEventListener('change', () => DesempenhoTecScreen.validateRange());
// filtro por disciplina na árvore
$id('tec-disc-filter').addEventListener('change', (e) => {
  DesempenhoTecScreen.discFilter = e.target.value;
  const snap = DesempenhoTecScreen.scopedSnapshot();
  if (snap) DesempenhoTecScreen.renderDisciplinas(snap);
});
// upload de arquivo (clique + arrastar-e-soltar)
(function () {
  const dz = document.getElementById('tec-dropzone');
  const fi = document.getElementById('tec-file-input');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', (e) => { if (e.target.files[0]) DesempenhoTecScreen.handleFile(e.target.files[0]); });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('dragover');
    if (e.dataTransfer.files[0]) DesempenhoTecScreen.handleFile(e.dataTransfer.files[0]);
  });
})();
// --- Escopo da análise: consolidado / selecionar / intervalo ---
/* Filtros de escopo recolhidos por padrao: o normal e querer ver o RESULTADO
   da analise, nao os controles. O resumo no cabecalho evita que recolher vire
   esconder — o escopo ativo continua legivel sem abrir. */
PainelRecolhivel.registrar({
  id: 'tec-escopo',
  corpo: 'tec-scope-body',
  botao: 'tec-scope-collapse',
  texto: 'tec-scope-collapse-txt',
  resumo: 'tec-scope-resumo',
  calcResumo() {
    const m = DesempenhoTecScreen.scopeMode;
    if (m === 'select') {
      const set = DesempenhoTecScreen.selectedSnapIds;
      const n = set ? set.size : 0;
      return n ? `${n} retrato(s) selecionado(s)` : 'Retratos selecionados';
    }
    if (m === 'range') {
      const a = DesempenhoTecScreen.rangeStart, b = DesempenhoTecScreen.rangeEnd;
      return (a && b) ? `${formatDateShort(a)} → ${formatDateShort(b)}` : 'Intervalo de datas';
    }
    return 'Consolidado (todos)';
  },
});

$id('tec-scope-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-scope]');
  if (!btn) return;
  DesempenhoTecScreen.scopeMode = btn.dataset.scope;
  DesempenhoTecScreen.savePrefs({ scopeMode: btn.dataset.scope });
  DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
  DesempenhoTecScreen.renderAnalysis();
  // reaplica a aba ativa (reforço também depende do escopo)
  if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();
});
// intervalo de datas: inputs manuais
['tec-range-start', 'tec-range-end'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    DesempenhoTecScreen.rangeStart = $id('tec-range-start').value || DesempenhoTecScreen.rangeStart;
    DesempenhoTecScreen.rangeEnd = $id('tec-range-end').value || DesempenhoTecScreen.rangeEnd;
    if (DesempenhoTecScreen.rangeStart > DesempenhoTecScreen.rangeEnd) {
      // corrige intervalo invertido
      const t = DesempenhoTecScreen.rangeStart; DesempenhoTecScreen.rangeStart = DesempenhoTecScreen.rangeEnd; DesempenhoTecScreen.rangeEnd = t;
    }
    DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
    DesempenhoTecScreen.renderAnalysis();
    if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();
  });
});
// atalhos de intervalo (últimos N meses / tudo)
document.querySelectorAll('.tec-range-quick').forEach(btn => btn.addEventListener('click', () => {
  const snaps = DB.getTecSnapshots();
  if (snaps.length === 0) return;
  const r = btn.dataset.range;
  if (r === 'all') {
    DesempenhoTecScreen.rangeStart = snaps[0].startDate;
    DesempenhoTecScreen.rangeEnd = snaps[snaps.length - 1].endDate;
  } else {
    const months = parseInt(r, 10);
    const end = snaps[snaps.length - 1].endDate;
    const d = new Date(end + 'T00:00:00');
    d.setMonth(d.getMonth() - months);
    DesempenhoTecScreen.rangeStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    DesempenhoTecScreen.rangeEnd = end;
  }
  DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
  DesempenhoTecScreen.renderAnalysis();
  if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();
}));
/* `input` cobre número e caixa de seleção; `change` é o que um <select>
   dispara. Sem os dois, o seletor de ordem nasceria decorativo. */
['tec-weak-threshold', 'tec-weak-minq', 'tec-weak-leaves', 'tec-weak-ordenar'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  const repintar = () => {
    // a preferência nasce AQUI, do toque de quem usa — e é isto que faz o
    // limiar seguir a meta do Plano até você decidir o contrário
    const num = (i, d) => { const e = document.getElementById(i); const n = parseInt(e && e.value, 10); return isNaN(n) ? d : n; };
    const sel = document.getElementById('tec-weak-ordenar');
    const lv = document.getElementById('tec-weak-leaves');
    DesempenhoTecScreen.savePrefs({
      weakLimiar: num('tec-weak-threshold', 85), weakMinQ: num('tec-weak-minq', 10),
      weakLeaves: !!(lv && lv.checked), weakOrdenar: (sel && sel.value) || 'taxa'
    });
    const snap = DesempenhoTecScreen.scopedSnapshot();
    if (snap) DesempenhoTecScreen.renderWeak(snap);
  };
  el.addEventListener('input', repintar);
  el.addEventListener('change', repintar);
});
$id('tec-weak-disc').addEventListener('change', (e) => {
  DesempenhoTecScreen.weakDisc = e.target.value;
  const snap = DesempenhoTecScreen.scopedSnapshot();
  if (snap) DesempenhoTecScreen.renderWeak(snap);
});
// --- Listeners das abas Incidência / Reforço ---
(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  const DT = DesempenhoTecScreen;
  /* ── O ADIAMENTO PERTENCE AO CLIQUE, NÃO À API ──────────────────────────
     Adiar dentro de `switchTecTab` deixava a função mentindo: quem a chama
     espera que, ao voltar, a tela esteja pintada — e todo o resto do app e da
     suíte de verificação faz exatamente isso. Sete verificações caíram de uma
     vez, não porque o adiamento estivesse errado, mas porque estava no lugar
     errado.

     O travamento que a pessoa sente é o do DEDO no chip: é ali que o quadro
     tem de ser liberado antes do cálculo. Chamada por código continua
     síncrona; o toque troca a aba agora e calcula no quadro seguinte. */
  document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(b => b.addEventListener('click', () => {
    const alvo = b.dataset.tectab;
    /* Reclicar o chip do Plano recalcula a tela inteira igual à primeira vez —
       então ele também merece o esqueleto, e não a lista velha congelada. */
    if (alvo !== 'plano') { DT.switchTecTab(alvo); return; }
    // pinta a troca de aba e o esqueleto agora; o motor roda no quadro seguinte
    DT.tecTab = alvo;
    document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(x => x.classList.toggle('active', x.dataset.tectab === alvo));
    ['analise', 'incidencia', 'reforco', 'plano'].forEach(t => {
      const el = document.getElementById('tec-panel-' + t);
      if (el) el.style.display = (t === alvo) ? 'block' : 'none';
    });
    DT._depoisDePintar('plano-lista', () => DT.switchTecTab(alvo));
  }));
  // Incidência
  on('incid-text', 'input', () => DT.updateIncidPreview());
  on('incid-banca', 'input', () => DT.updateIncidPreview());
  on('incid-replace', 'change', () => DT.updateIncidPreview());
  on('incid-save', 'click', () => DT.saveIncidencia());
  const idz = document.getElementById('incid-dropzone');
  if (idz) {
    idz.addEventListener('click', () => $id('incid-file').click());
    idz.addEventListener('dragover', (e) => { e.preventDefault(); idz.classList.add('dragover'); });
    idz.addEventListener('dragleave', () => idz.classList.remove('dragover'));
    idz.addEventListener('drop', (e) => { e.preventDefault(); idz.classList.remove('dragover'); if (e.dataTransfer.files[0]) DT.handleIncidFile(e.dataTransfer.files[0]); });
  }
  on('incid-file', 'change', (e) => { if (e.target.files[0]) DT.handleIncidFile(e.target.files[0]); });
  // Reforço (todos salvam a preferência para lembrar entre sessões)
  // Plano de pontos fracos
  ['plano-disc','plano-meta','plano-ritmo','plano-teto','plano-ponderacao','plano-minamostra',
   'plano-customodo','plano-custofixo','plano-custofator','plano-custopiso','plano-custoponto',
   'plano-pesobanca','plano-limite','plano-folhas','plano-pequenas',
   'plano-amostraalvo','plano-cadencia','plano-janelamax','plano-ordenar','plano-consolidar','plano-validade','plano-critico','plano-fragil','plano-piso','plano-sens'].forEach(id => {
    /* Mexer num campo pode DESFAZER um preset — e o chip aceso tem de deixar de
       estar aceso na mesma hora, senão a tela afirma um modo que não vale mais. */
    /* O RÓTULO RESPONDE NA HORA; O MOTOR ESPERA A RAJADA ACABAR. Quem arrasta
       o peso da banca precisa ver o número mudar sob o dedo — isso é barato.
       Recalcular o Plano a cada parada do arraste é que travava a tela. */
    const eco = () => {
      if (id === 'plano-pesobanca') {
        const v = document.getElementById('plano-pesobanca');
        const l = document.getElementById('plano-pesobanca-label');
        if (v && l) l.textContent = (parseInt(v.value, 10) === 0) ? '0 — banca ignorada' : v.value;
      }
      DT._fatias = null;   // outra configuração, outra fila: toda lista volta ao passo
      DT.renderModosDeAtaque();
    };
    /* `change` é o fim do gesto (soltou o select, saiu do campo): ali não há
       rajada nenhuma e esperar seria só lentidão. `input` é o meio da
       digitação, e é ele que precisa da janela. */
    on(id, 'change', () => { eco(); DT.agendarPlano(true); });
    on(id, 'input', () => { eco(); DT.agendarPlano(false); });
  });
  on('reforco-disc', 'change', (e) => { DT.savePrefs({ disc: e.target.value }); DT.renderReforcoList(); });
  on('reforco-minq', 'input', (e) => { DT.savePrefs({ minq: e.target.value }); DT.renderReforcoList(); });
  on('reforco-limite', 'input', (e) => { DT.savePrefs({ limite: e.target.value }); DT.renderReforcoList(); });
  on('reforco-estrat', 'input', (e) => { DT.savePrefs({ estrat: e.target.value }); DT.updateEstratLabel(); DT.renderReforcoList(); });
  {
    const tog = document.getElementById('reforco-gran-toggle');
    if (tog) tog.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-gran]');
      if (!b) return;
      const el = document.getElementById('reforco-gran');
      if (el) el.value = b.dataset.gran;
      DT.savePrefs({ gran: b.dataset.gran });
      DT.updateGranLabel();
      DT.renderReforcoList();
    });
  }
  on('reforco-ordenar', 'change', (e) => { DT.savePrefs({ ordenar: e.target.value }); DT.renderReforcoList(); }); // #1 Ordenar por
  // alternador de visão: ranking global x por disciplina
  const vt = document.getElementById('reforco-view-toggle');
  if (vt) vt.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (!btn) return;
    DT.reforcoView = btn.dataset.view;
    DT.savePrefs({ reforcoView: btn.dataset.view });
    vt.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    // no modo "por disciplina", os cards laterais viram redundantes (já entram em cada disciplina)
    const side = document.querySelector('.reforco-side-grid');
    if (side) side.style.display = (DT.reforcoView === 'disc') ? 'none' : '';
    DT.renderReforcoList();
  });
})();

/* ── A FOLHA DE AJUSTES: abrir, navegar, restaurar, fechar ─────────────────
   Um só ouvinte para as três abas. O clique em qualquer `.tec-cfg-open` diz
   qual aba abrir; o resto é sempre igual, e é por isso que a folha pode
   receber uma quarta aba sem nenhuma linha nova aqui. */
(function () {
  const DT = DesempenhoTecScreen;
  document.addEventListener('click', (e) => {
    const abre = e.target.closest && e.target.closest('.tec-cfg-open');
    if (abre) { TecAjustes._voltarPara = abre.dataset.cfg; TecAjustes.abrir(abre.dataset.cfg); return; }
    const chip = e.target.closest && e.target.closest('#tec-cfg-nav button');
    if (chip) { TecAjustes.mostrar(chip.dataset.sec); return; }
  });
  const fecha = () => TecAjustes.fechar();
  const x = document.getElementById('tec-cfg-x'); if (x) x.addEventListener('click', fecha);
  const ok = document.getElementById('tec-cfg-done'); if (ok) ok.addEventListener('click', fecha);
  /* Esc fecha, como em todo diálogo do app. O fundo desfocado NÃO fecha: um
     toque acidental fora da caixa apagaria o ajuste que estava sendo feito. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = document.getElementById('tec-cfg-modal');
    if (m && m.style.display === 'flex') { e.stopPropagation(); fecha(); }
  });
  /* Mexeu num campo da folha, o resumo e os pontinhos acompanham na hora. Os
     ouvintes que APLICAM cada campo continuam onde sempre estiveram — este
     aqui só mantém a folha honesta sobre o que ela mesma mostra. */
  const body = document.getElementById('tec-cfg-body');
  if (body) ['input', 'change'].forEach(ev => body.addEventListener(ev, (e) => {
    try {
      TecAjustes.aplicarCondicionais(); TecAjustes.sincronizar();
      /* Só no `change`: um campo condicional que aparece ou some muda qual é a
         maior seção. Remedir a cada tecla digitada num campo numérico seria
         cinco leituras de layout por caractere, sem nada mudar de tamanho. */
      if (e.type === 'change') TecAjustes.estabilizarAltura();
    } catch (err) { _quiet(err, 'cfg-sync'); }
  }));
  /* Girar o telefone muda o teto da caixa: a altura medida na vertical deixa a
     folha alta demais na horizontal, com o pé fora da tela. */
  window.addEventListener('resize', () => {
    if (TecAjustes.aba) { try { TecAjustes.estabilizarAltura(); } catch (e) { _quiet(e, 'cfg-resize'); } }
  });
  /* RESTAURAR PADRÕES vale para a aba aberta, e só para ela. Um botão que
     zerasse as três de uma vez seria uma armadilha: ninguém espera que mexer
     no Reforço apague a régua do Plano. */
  /* ── A AUDITORIA DENTRO DA FOLHA ────────────────────────────────────────
     Marcação fixa, ouvinte registrado uma vez: enquanto o bloco vivia dentro da
     lista repintada, cada repintura criava botões novos e precisava religá-los.
     O painel também mostra, ali mesmo, o que as invariantes disseram na última
     exportação — é a diferença entre "exportei" e "o arquivo está coerente". */
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#tec-cfg-body [data-aud]');
    if (!b) return;
    const anon = !!(document.getElementById('plano-aud-anon') || {}).checked;
    const a = PlanoAuditoria.exportar(b.dataset.aud, anon);
    const el = document.getElementById('plano-aud-resumo');
    if (el) el.textContent = (a && a.erro) ? 'Não foi possível exportar: ' + a.erro : (a ? a.resumo : '');
    TecAjustes.pintarInvariantes(a);
  });
  const reset = document.getElementById('tec-cfg-reset');
  if (reset) reset.addEventListener('click', async () => {
    const aba = TecAjustes.aba;
    if (!aba) return;
    const nome = { plano: 'do Plano', reforco: 'do Reforço', analise: 'da Análise' }[aba] || '';
    if (!await UI.confirm('Voltar todos os ajustes ' + nome + ' aos valores padrão?', { title: 'Restaurar padrões' })) return;
    if (aba === 'plano') {
      DB.delRaw(DB._profilePrefix() + PlanoEngine.KEY_PREF);
      PlanoEngine._c = null;
      DT.renderPlano();
    } else if (aba === 'reforco') {
      DT.savePrefs({ estrat: null, gran: null, minq: null, limite: null, disc: null,
        reforcoView: null, reforcoOrdenar: null });
      TecAjustes.restaurarCampos('reforco');
      DT.renderReforco();
    } else {
      DT.savePrefs({ weakOrdenar: null, weakDisc: null, weakLimiar: null, weakMinQ: null, weakLeaves: null });
      TecAjustes.restaurarCampos('analise');
      DT.render();
    }
    TecAjustes.aplicarCondicionais();
    TecAjustes.sincronizar();
    TecAjustes.marcarPersonalizadas();
    showToast('Ajustes restaurados ✓');
  });
})();
/* ── ENTRAR NA TELA COM O PLANO ABERTO TAMBÉM É TEMPO MUDO ─────────────────
   O esqueleto existia só no CHIP da aba. Mas o Plano também é a aba ativa de
   quem esteve nele e voltou pelo menu: aí a tela inteira era recalculada com o
   dedo já fora da tela e sem um único sinal de que algo acontecia — a lista
   antiga ficava plantada por algumas centenas de milissegundos e só então
   piscava para a nova. O mesmo remédio das Conquistas, no mesmo formato: troca
   agora, esqueleto no mesmo quadro, conta no quadro seguinte. */
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen !== 'desempenhotec') return;
  const DT = DesempenhoTecScreen;
  const temRetrato = (() => { try { return (DB.getTecSnapshots() || []).length > 0; } catch (_) { return false; } })();
  const painel = document.getElementById('tec-panel-plano');
  /* Só quando o painel do Plano JÁ está na tela: pintar um esqueleto dentro de
     um `display:none` é adiar a conta sem mostrar nada em troca. */
  if (DT.tecTab === 'plano' && temRetrato && painel && painel.style.display !== 'none') {
    DT._depoisDePintar('plano-lista', () => DT.render());
    return;
  }
  DT.render();
});
