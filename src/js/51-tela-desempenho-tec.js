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
    /* ── O FOCO: UMA OU VÁRIAS MATÉRIAS, UM ESTADO SÓ ──────────────────────
       O filtro era de UMA disciplina, e o quadro "Onde atacar primeiro" existe
       justamente para dizer que TRÊS ou QUATRO matérias concentram metade do
       que está em jogo. Escolher uma por vez obriga a pessoa a desfazer e
       refazer o filtro para montar a semana que o próprio quadro acabou de
       propor.

       `foco` é lista, e é a ÚNICA verdade: `disciplina` continua existindo
       porque o select e o "restaurar padrões" falam por ela, mas ela passa a
       ser DERIVADA (o foco de uma, ou `__todas__`). Dois estados para a mesma
       pergunta é o erro que este arquivo já pagou caro — aqui não se repete. */
    foco: [],
    /* ── GRANULARIDADE: O PISO DE VOLUME DE UMA UNIDADE ────────────────────
       A árvore do TecConcursos é irregular de propósito: há matéria que termina
       no segundo nível e matéria que desce até o sexto. Medido no histórico
       real deste app: a lente de folha dá 317 unidades com MEDIANA DE 1
       QUESTÃO — zero medível contra o piso de amostra de 20. Fixar um nível não
       resolve (o nível 1 deixa 57% do volume sem medição em algumas matérias e
       esmaga outras num único número); o que resolve é um PISO: átomo que não
       junta volume suficiente para ser medido sozinho é somado ao vizinho mais
       próximo — o ancestral comum — e o bloco é medido como uma unidade.

       Zero = desligado, e é o padrão: a lente existente continua sendo a de
       quem não pediu nada. Com piso 10, o mesmo histórico dá 33 unidades com
       93% do volume medível. Nada é escondido nem duplicado em nenhum valor —
       a soma do índice é a mesma com qualquer piso (invariante `granularidade`
       da auditoria). */
    granPiso: 0,
    /* Matérias que o Plano NÃO deve enxergar (ver `excluidasSet`). Lista de
       nomes, nunca um apagamento: sai da conta e volta inteira ao desmarcar. */
    excluidas: [],
    /* 10, não 30. Trinta linhas de assunto são ~2.000px de rolagem antes do
       primeiro bloco de ação, e quem abre a tela não lê trinta — lê as
       primeiras e desiste. O resto não some: abre com um toque, no passo que
       você configurar aqui. */
    limite: 10, ordenar: 'pior',
    // Ciclo contínuo de sugestões: quantas matérias ficam em ataque simultâneo
    // e quantos tópicos de cada uma podem ocupar o ciclo.
    sugestoesDisciplinas: 3, sugestoesTopicosDisc: 1,
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
  sanearPrefs(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = Object.assign({}, this.DEFAULTS);
    const specs = {
      metaDominio: [30, 100], tetoDominio: [50, 100], minAmostra: [0, 500, true],
      custoFixo: [10, 1000], custoFator: [0.1, 100], custoPiso: [10, 500],
      custoPorPonto: [0, 20], granPiso: [0, 100, true], limite: [3, 200, true],
      faixaCritico: [0, 100], faixaFragil: [0, 100], pisoSerie: [1, 100, true],
      sensTendencia: [1, 30], consolidarEm: [1, 10, true], validadeDias: [30, 720, true],
      amostraAlvo: [10, 2000, true], janelaMax: [30, 1825, true], cadenciaDias: [7, 365, true],
      pesoBanca: [0, 12], sugestoesDisciplinas: [1, 12, true], sugestoesTopicosDisc: [1, 5, true],
      migracao: [1, 4, true]
    };
    const limpaNum = (k, v, fallback) => {
      const s = specs[k], n = Number(v);
      if (!s || !Number.isFinite(n)) return fallback;
      const limitado = Math.max(s[0], Math.min(s[1], n));
      return s[2] ? Math.round(limitado) : limitado;
    };
    Object.keys(specs).forEach(k => { out[k] = limpaNum(k, src[k], out[k]); });
    const enums = {
      ponderacao: ['igual', 'volume', 'ambas'],
      custoModo: ['lacuna', 'fixo', 'proporcional'],
      ordenar: ['pontos', 'pior', 'ganhoGeral', 'banca', 'rendimento', 'queda']
    };
    Object.keys(enums).forEach(k => { if (enums[k].includes(src[k])) out[k] = src[k]; });
    ['incluirPequenas', 'apenasFolhas'].forEach(k => {
      if (typeof src[k] === 'boolean') out[k] = src[k];
    });
    ['disciplina', 'banca'].forEach(k => {
      if (typeof src[k] === 'string' && src[k].length <= 300) out[k] = src[k];
    });
    ['foco', 'excluidas'].forEach(k => {
      if (Array.isArray(src[k])) out[k] = [...new Set(src[k].filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().slice(0, 300)))];
    });
    if (src.ritmoSemanal == null || src.ritmoSemanal === '') out.ritmoSemanal = null;
    else {
      const ritmo = Number(src.ritmoSemanal);
      out.ritmoSemanal = Number.isFinite(ritmo) ? Math.max(1, Math.min(2000, ritmo)) : null;
    }
    // Opções internas não são persistidas, mas precisam atravessar chamadas do motor.
    if (Array.isArray(src._snapshots)) out._snapshots = src._snapshots;
    if (src._mapa && typeof src._mapa === 'object') out._mapa = src._mapa;
    if (src._volume && typeof src._volume === 'object') out._volume = src._volume;
    if (src._semExclusao === true) out._semExclusao = true;
    return out;
  },
  prefs() {
    try {
      const v = JSON.parse(localStorage.getItem(DB._profilePrefix() + this.KEY_PREF));
      const p = this.sanearPrefs(v);
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
      return this.sanearPrefs(p);
    } catch (_) { return this.sanearPrefs(null); }
  },
  salvarPrefs(patch) {
    const v = this.sanearPrefs(Object.assign({}, this.prefs(), patch || {}));
    delete v._snapshots; delete v._mapa; delete v._volume; delete v._semExclusao;
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
  /* ── QUEM ESTÁ NO RECORTE ─────────────────────────────────────────────────
     Um lugar só responde "esta matéria entra?", e todo consumidor passa por
     aqui: a lista, o domínio, a trajetória, o segundo plano e a auditoria.
     Aceita o estado novo (`foco`) e o antigo (`disciplina`) porque perfil salvo
     e chamada de teste vêm das duas formas — mas nunca deixa os dois valerem ao
     mesmo tempo: `foco` manda, e `disciplina` só é lida quando ele está vazio. */
  MAX_FOCO: 12,
  focoSet(opts) {
    const lista = (opts && Array.isArray(opts.foco) && opts.foco.length)
      ? opts.foco
      : ((opts && opts.disciplina && opts.disciplina !== '__todas__') ? [opts.disciplina] : []);
    const nomes = [], set = Object.create(null);
    lista.slice(0, this.MAX_FOCO).forEach(n => {
      const k = ReforcoEngine.norm(String(n == null ? '' : n));
      if (!k || set[k]) return;
      set[k] = true; nomes.push(String(n));
    });
    return nomes.length ? { nomes, set, n: nomes.length } : null;
  },
  noFoco(disciplina, foco) {
    if (!foco) return true;
    return !!foco.set[ReforcoEngine.norm(String(disciplina == null ? '' : disciplina))];
  },
  /* O rótulo que o número grande usa para dizer de quem ele é. Com muitas
     matérias, nomear todas viraria um parágrafo no lugar de um rótulo — então
     duas e a contagem do resto, que é o que se lê de relance. */
  focoRotulo(foco) {
    if (!foco) return '';
    if (foco.n === 1) return foco.nomes[0];
    if (foco.n === 2) return foco.nomes[0] + ' e ' + foco.nomes[1];
    return foco.nomes[0] + ', ' + foco.nomes[1] + ' e mais ' + (foco.n - 2);
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
      /* A MESMA LENTE DO PLANO. Pinar `apenasFolhas: true` aqui fazia a caixa
         contar 137 "assuntos" enquanto o Plano mostrava 33 unidades — as
         questões batiam, a contagem não, e é assim que o usuário deixa de
         confiar nos dois números. A caixa fala da lente ativa. */
      const idx = this.totalHistorico(Object.assign({}, this.prefs(), { _semExclusao: true }));
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
  /* ── A MARGEM NÃO PODE SER ZERO ───────────────────────────────────────────
     A fórmula de Wald — 1,96·√(p(1−p)/n) — COLAPSA nos extremos: com p = 0 ou
     p = 1 ela devolve exatamente zero, e a tela passava a afirmar certeza
     absoluta a partir de vinte questões. "0% ±0pp" em 0/20, quando a verdade é
     de 0% a 16%. E não é caso raro: numa jornada simulada de oito importações
     sobre um índice fino, 1.167 linhas exibiram margem zero — porque assunto de
     duas ou três questões acerta todas ou erra todas, e aí p é 0 ou 1.

     Pior: é a PRIMEIRA linha que o aluno lê, porque "pior acerto primeiro"
     ordena 0% no topo. O app promete transformar "confiável" de opinião em
     número e entregava o oposto exatamente ali.

     Wilson resolve: o intervalo nunca degenera, é assimétrico perto das bordas
     (que é a verdade — de 0% só se pode subir) e converge para Wald quando a
     amostra cresce. Como a interface escreve um único valor com “±”, a margem
     precisa cobrir o lado mais distante do intervalo assimétrico; meia-largura
     subestimava 0/20 como ±8pp quando o limite superior é 16pp. */
  Z95: 1.96,
  intervalo(pct, n) {
    if (!n || n < 1) return null;
    const z = this.Z95, p = Math.min(1, Math.max(0, pct / 100));
    const d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d;
    const h = (z / d) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return [Math.max(0, (c - h) * 100), Math.min(100, (c + h) * 100)];
  },
  margemErro(pct, n) {
    if (!n || n < 2) return null;
    const iv = this.intervalo(pct, n);
    // A API histórica desta função é uma margem simétrica (±pp). O intervalo
    // Wilson completo continua disponível em `intervalo`; aqui devolvemos sua
    // meia-largura para que empate técnico e demais consumidores comparem a
    // mesma grandeza nos dois lados.
    return iv ? (iv[1] - iv[0]) / 2 : null;
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
  /* Mesmo colapso, mesma consequência: dois assuntos a 0% davam erro-padrão
     zero, o guarda `se > 0` devolvia false e a tela afirmava que a amostra os
     SEPARA — justamente no regime de amostra curta onde o empate é a verdade.
     Agresti-Coull (somar dois acertos e dois erros de cada lado) nunca degenera
     e é o ajuste padrão para o teste de duas proporções com amostra pequena. */
  empateTecnico(a, b) {
    const na = a && a.qJanela, nb = b && b.qJanela;
    if (!na || !nb || a.taxa == null || b.taxa == null) return false;
    const aj = (taxa, n) => { const nn = n + 4; return { p: (taxa / 100 * n + 2) / nn, n: nn }; };
    const A = aj(a.taxa, na), B = aj(b.taxa, nb);
    const se = Math.sqrt(A.p * (1 - A.p) / A.n + B.p * (1 - B.p) / B.n);
    if (!(se > 0)) return false;
    return Math.abs(A.p - B.p) <= this.Z95 * se;
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
    /* Índice pai→filhos em uma passada. A versão anterior procurava todos os
       descendentes em `rows` para cada linha (O(n²)); com milhares de tópicos e
       doze retratos, só esta etapa fazia dezenas de milhões de comparações. */
    const porDisc = new Map(), filhos = new Map();
    rows.forEach(r => {
      if (!r.codigo) return;
      const d = String(r.disciplina || '');
      if (!porDisc.has(d)) porDisc.set(d, new Map());
      const cod = String(r.codigo);
      if (!porDisc.get(d).has(cod)) porDisc.get(d).set(cod, r);
    });
    rows.forEach(r => {
      if (!r.codigo) return;
      const d = String(r.disciplina || ''), mapa = porDisc.get(d);
      let pai = String(r.codigo);
      while (pai.includes('.')) {
        pai = pai.slice(0, pai.lastIndexOf('.'));
        if (!mapa.has(pai)) continue;
        const chave = d + '\u0000' + pai;
        if (!filhos.has(chave)) filhos.set(chave, []);
        filhos.get(chave).push(r);
        break;
      }
    });
    const out = [];
    rows.forEach(r => {
      if (!r.codigo) { out.push(r); return; }
      /* Cada nó foi ligado ao ancestral existente mais próximo. Isso preserva
         árvores irregulares sem subtrair neto e pai ao mesmo tempo. */
      const base = filhos.get(String(r.disciplina || '') + '\u0000' + String(r.codigo)) || [];
      if (!base.length) { out.push(r); return; }
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
  /* ── O AGRUPAMENTO É DECIDIDO NO HISTÓRICO INTEIRO, UMA VEZ ───────────────
     Duas escolhas aqui não são estéticas, são a diferença entre um recorte e
     uma bagunça:

     · O ancestral é resolvido pelo NOME, nunca pelo código. Código do TEC é
       POSICIONAL — `01.01` é um assunto num export e outro no seguinte. Agrupar
       por código faria o mesmo átomo cair em blocos diferentes a cada
       importação, e a comparação entre retratos morreria em silêncio.
     · O volume que decide "é fino?" é o ACUMULADO de todos os retratos, não o
       do retrato da vez. Assim o mapa de blocos é o MESMO para todos os
       retratos do histórico — é isso que deixa a janela adaptativa, a série e o
       progresso de uma atividade continuarem falando do mesmo objeto.

     Duas travas: bloco de UM membro não existe (renomear um assunto que já
     mede sozinho seria mudar a chave de algo que funciona), e átomo que já
     alcança o piso nunca é agrupado. */
  _agrupamento(opts) {
    const piso = Math.max(0, parseInt((opts && opts.granPiso) || 0, 10) || 0);
    if (!piso || !opts || opts.apenasFolhas === false) return null;
    const snaps = (Array.isArray(opts._snapshots) ? opts._snapshots : DB.getTecSnapshots()) || [];
    if (!snaps.length) return null;
    const sel = snaps.map(s => [s.id, s.startDate, s.endDate, (s.rows || []).length].join(':')).join('|') + ':' + piso;
    if (this._agrC && this._agrC.sel === sel) return this._agrC.v;
    /* 1. VOLUME ACUMULADO POR ÁTOMO E O ANCESTRAL DE CADA UM, pelo NOME. */
    const acum = Object.create(null), pai = Object.create(null);
    snaps.forEach(s => {
      const porCod = Object.create(null);
      (s.rows || []).forEach(r => {
        if (r.codigo) porCod[ReforcoEngine.norm(r.disciplina || '') + '|' + r.codigo] = r;
      });
      const dk = (r) => ReforcoEngine.norm(r.disciplina || '');
      /* O ANCESTRAL DE TODO NÓ, não só das folhas. A escalada sobe consultando o
         pai do nível em que a unidade está — e se só as folhas tivessem pai, a
         segunda volta não acharia nada e a unidade pularia direto para a
         disciplina, grossa demais sem precisar. Com a cadeia inteira mapeada ela
         sobe um degrau de verdade por volta. */
      (s.rows || []).forEach(r => {
        if (!r.codigo || !((r.depth || 0) > 0)) return;
        let cod = String(r.codigo), anc = null;
        while (cod.indexOf('.') > 0) {
          cod = cod.slice(0, cod.lastIndexOf('.'));
          const up = porCod[dk(r) + '|' + cod];
          if (up && up.nome) { anc = up.nome; break; }
        }
        /* Um ancestral REAL vence a ausência dele, e entre dois reais vence o do
           retrato mais novo (o laço é cronológico). O mesmo nome pode aparecer
           com código num retrato e no balde "Sem Classificação" no seguinte —
           deixar o balde apagar o tópico-pai conhecido jogaria a unidade no
           bloco genérico sem motivo. */
        if (anc) pai[ReforcoEngine.chaveInc(r.disciplina || '', r.nome)] = anc;
      });
      this._folhas(s, true).forEach(r => {
        const k = ReforcoEngine.chaveInc(r.disciplina || '', r.nome);
        const c = acum[k] || { q: 0, nome: r.nome, disciplina: r.disciplina || '' };
        c.q += (r.questoes || 0); acum[k] = c;
      });
    });
    /* 2. A ESCALADA. Cada unidade começa como um átomo. A cada volta, as que
       não alcançam o piso sobem um nível e se juntam às vizinhas sob o mesmo
       ancestral. Quem já alcança O PISO nunca é tocado — e como o piso que a
       tela recomenda é a própria amostra mínima, na trilha padrão nada do que
       já mede muda de nome. Piso ACIMA da amostra mínima é escolha explícita de
       quem quer unidades maiores e mais confiáveis: ali duas unidades de 25 que
       já mediam viram uma de 50, e é isso que foi pedido. O que a auditoria
       cobra em toda exportação não é a contagem de unidades, é que o VOLUME
       medível nunca diminua. Unidade de um membro só também
       conserva o nome dela: o que avança é o nível de agrupamento, para que ela
       possa encontrar companhia mais acima em vez de ficar órfã para sempre.

       Por que subir, e não parar num nível: medido numa jornada simulada de oito
       importações sobre uma árvore de até cinco níveis, o corte de um nível só
       deixava 0% do volume medível no primeiro retrato e 17% no segundo — a
       lente não fazia nada justamente quando mais precisava. A escalada dá 96% e
       100%, e se REFINA sozinha conforme o volume chega: 8 unidades grossas no
       primeiro mês, 387 de 1,8 tópico no oitavo. É a mesma ideia da janela
       adaptativa, aplicada ao eixo do assunto em vez do tempo. */
    const unid = Object.keys(acum).map(k => ({
      membros: [k], q: acum[k].q, base: acum[k].nome, disc: acum[k].disciplina
    }));
    let atual = unid;
    for (let volta = 0; volta < 10; volta++) {
      const finas = atual.filter(u => u.q < piso);
      if (!finas.length) break;
      const grupos = Object.create(null);
      finas.forEach(u => {
        const acima = pai[ReforcoEngine.chaveInc(u.disc, u.base)] || null;
        const gk = ReforcoEngine.norm(u.disc) + '\u0002' + ReforcoEngine.norm(acima || '\u0003raiz');
        const g = grupos[gk] || (grupos[gk] = { disc: u.disc, base: acima, unidades: [] });
        g.unidades.push(u);
      });
      const proximas = atual.filter(u => u.q >= piso);
      let juntou = false;
      Object.keys(grupos).forEach(gk => {
        const g = grupos[gk];
        if (g.unidades.length > 1) {
          juntou = true;
          proximas.push({
            membros: g.unidades.reduce((a, u) => a.concat(u.membros), []),
            q: g.unidades.reduce((a, u) => a + u.q, 0),
            base: g.base || g.disc, disc: g.disc
          });
        } else {
          /* Sozinha neste nível: sobe o nível de agrupamento sem virar bloco nem
             mudar de nome, para procurar companhia na volta seguinte. Sem
             ancestral acima, ela é o que é — e fica. */
          const u = g.unidades[0];
          if (g.base) { juntou = true; proximas.push(Object.assign({}, u, { base: g.base })); }
          else proximas.push(u);
        }
      });
      atual = proximas;
      if (!juntou) break;
    }
    /* 3. SÓ AS UNIDADES DE VÁRIOS MEMBROS VIRAM BLOCO. Renomear uma unidade de
       um membro seria trocar a chave de algo que já funciona. */
    const mapa = Object.create(null), blocos = Object.create(null);
    let atomos = 0;
    atual.forEach(u => {
      if (u.membros.length < 2) return;
      const nome = u.base + ' · bloco';
      const bk = ReforcoEngine.chaveInc(u.disc, nome);
      if (acum[bk] || blocos[bk]) return;   // o nome já é de um assunto real
      blocos[bk] = { nome, disciplina: u.disc, base: u.base, qAcum: u.q,
        membros: u.membros.map(k => acum[k].nome) };
      u.membros.forEach(k => { mapa[k] = bk; });
      atomos += u.membros.length;
    });
    const v = Object.keys(blocos).length
      ? { mapa, blocos, piso, atomos, nBlocos: Object.keys(blocos).length } : null;
    this._agrC = { sel, v };
    return v;
  },
  /* Reagrupa um índice já montado. Puro: entra índice por assunto, sai índice
     por unidade — com a soma de `q` e de `ac` intacta, sempre. */
  _agrupar(m, lente) {
    const ag = this._agrupamento(lente);
    if (!ag) return m;
    const out = Object.create(null);
    Object.keys(m).forEach(k => {
      const bk = ag.mapa[k];
      if (!bk) { out[k] = m[k]; return; }
      const b = ag.blocos[bk];
      const c = out[bk] || { q: 0, ac: 0, nome: b.nome, disciplina: b.disciplina,
        _bloco: b.membros.length, _membros: b.membros, _base: b.base };
      c.q += (m[k].q || 0); c.ac += (m[k].ac || 0); out[bk] = c;
    });
    Object.keys(out).forEach(k => { out[k].pct = out[k].q > 0 ? out[k].ac / out[k].q * 100 : null; });
    return out;
  },
  /* `lente` aceita o objeto de preferências (o caminho normal, que carrega o
     piso de granularidade) ou o booleano antigo de `apenasFolhas` — os testes e
     a auditoria chamam das duas formas, e a leitura crua não pode depender de
     qual. */
  _indice(snap, lente) {
    const L = (lente && typeof lente === 'object') ? lente : { apenasFolhas: lente !== false, granPiso: 0 };
    const apenasFolhas = L.apenasFolhas !== false;
    const fontesChave = Array.isArray(L._snapshots)
      ? L._snapshots.map(s => [s.id, (s.rows || []).length].join(':')).join(',') : '';
    const cacheKey = (apenasFolhas ? '1' : '0') + '|' + (parseInt(L.granPiso || 0, 10) || 0) + '|' + fontesChave;
    if (snap && typeof snap === 'object') {
      this._indiceC = this._indiceC || new WeakMap();
      const ja = this._indiceC.get(snap);
      if (ja && ja.has(cacheKey)) return ja.get(cacheKey);
    }
    const guardar = (v) => {
      if (!snap || typeof snap !== 'object') return v;
      let mapa = this._indiceC.get(snap);
      if (!mapa) { mapa = new Map(); this._indiceC.set(snap, mapa); }
      mapa.set(cacheKey, v);
      return v;
    };
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
      return guardar(this._agrupar(m, L));
    }
    const m = {};
    this._folhas(snap, apenasFolhas).forEach(r => {
      const k = ReforcoEngine.chaveInc(r.disciplina || '', r.nome);
      const c = m[k] || { q: 0, ac: 0, nome: r.nome, disciplina: r.disciplina };
      c.q += (r.questoes || 0); c.ac += (r.acertos || 0);
      m[k] = c;
    });
    Object.values(m).forEach(v => { v.pct = v.q > 0 ? v.ac / v.q * 100 : null; });
    return guardar(this._agrupar(m, L));
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
    opts = this.sanearPrefs(Object.assign({}, this.prefs(), opts || {}));
    const fora = (opts && opts._semExclusao) ? null : this.excluidasSet(opts);
    const temFora = !!(fora && Object.keys(fora).length);
    const m = {};
    const snaps = Array.isArray(opts._snapshots) ? opts._snapshots : (DB.getTecSnapshots() || []);
    snaps.forEach(s => {
      const idx = this._indice(s, opts);
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
    const o = this.sanearPrefs(Object.assign({}, this.prefs(), opts || {}));
    // matéria fora do Plano não tem taxa PARA O PLANO: nem null forçado, nem
    // número velho de um concurso que passou julgando uma atividade de hoje
    if (this.foraDoPlano(disciplina, this.excluidasSet(o))) return null;
    const todos = Array.isArray(o._snapshots) ? o._snapshots : DB.getTecSnapshots();
    if (!todos.length) return null;
    const desc = todos.slice().reverse().map(s => { s._idx = this._indice(s, o); return s; });
    const a = this._taxaAdaptativa(ReforcoEngine.chaveInc(disciplina || '', nome), desc, o);
    return a ? a.pct : null;
  },
  qHistDe(disciplina, nome, opts) {
    const m = (opts && opts._mapa) || this.totalHistorico(opts);
    const v = m[ReforcoEngine.chaveInc(disciplina || '', nome)];
    return v ? v.q : 0;
  },
  /* ── O VOLUME DE UM NÓ NÃO PODE DEPENDER DA LENTE ─────────────────────────
     `qHistDe` e `taxaAtualDe` leem o ÍNDICE do Plano — e o índice é uma LENTE:
     muda com `apenasFolhas` e passará a mudar com qualquer controle de
     granularidade. Medir uma atividade por ali significa que mexer na lente
     reescreve o progresso de um trabalho JÁ FEITO: a barra anda para trás, o
     veredito vira, e um assunto que só existe como átomo fino pode sair do
     índice e ser declarado "órfão" — atividade viva, encerrada por mudança de
     configuração. Nenhuma dessas três coisas é aceitável.

     O nó tem volume PRÓPRIO, e ele não depende de lente nenhuma: no export do
     TecConcursos a linha do pai é, ao centavo, a soma dos filhos (conferido em
     dois arquivos reais: 241 tópicos-pai, zero divergências). Então o volume de
     um nó é a PRÓPRIA LINHA dele em cada retrato — nada de somar filhos
     (dobraria), nada de descontar resíduo (esconderia o que foi praticado no
     detalhe). Uma leitura, exata, imune a qualquer recorte que o Plano venha a
     oferecer depois.

     A exclusão continua valendo: matéria fora do Plano não tem volume PARA O
     PLANO — a mesma regra de `totalHistorico` e de `taxaAtualDe`. */
  volumeDoNo(disciplina, nome, opts) {
    return this.volumeDoEscopo({ tipo: 'no', membros: [nome] }, disciplina, opts);
  },
  /* O ESCOPO de uma atividade: um nó (um nome) ou um bloco (vários nomes
     irmãos medidos juntos). Dois membros em que um é ancestral do outro contam
     UMA vez — o ancestral já carrega o descendente, e somar os dois seria a
     contagem dobrada que o resto do motor passou a última revisão eliminando. */
  volumeDoEscopo(escopo, disciplina, opts) {
    const o = this.sanearPrefs(Object.assign({}, this.prefs(), opts || {}));
    const vazio = { q: 0, ac: 0, pct: null, porRetrato: [], fora: false, retratos: 0 };
    const membros = ((escopo && escopo.membros) || []).map(n => ReforcoEngine.norm(n)).filter(Boolean);
    if (!membros.length) return vazio;
    if (this.foraDoPlano(disciplina, this.excluidasSet(o))) return Object.assign({}, vazio, { fora: true });
    const dk = ReforcoEngine.norm(disciplina || '');
    const alvo = Object.create(null);
    membros.forEach(k => { alvo[k] = true; });
    let q = 0, ac = 0;
    const porRetrato = [];
    const snaps = Array.isArray(o._snapshots) ? o._snapshots : (DB.getTecSnapshots() || []);
    /* O índice cru é compartilhado por todas as atividades do Plano. Sem ele,
       2.000 reforços varriam todas as linhas de todos os retratos 2.000 vezes. */
    const assinatura = snaps.map(s => [s.id, s.startDate, s.endDate, (s.rows || []).length].join(':')).join('|');
    if (!this._volumeIdxC || this._volumeIdxC.assinatura !== assinatura) {
      this._volumeIdxC = {
        assinatura,
        retratos: snaps.map(s => {
          const porNome = new Map();
          (s.rows || []).forEach(r => {
            if (!((r.depth || 0) > 0)) return;
            const k = ReforcoEngine.norm(r.disciplina || '') + ReforcoEngine.SEP + ReforcoEngine.norm(r.nome || '');
            if (!porNome.has(k)) porNome.set(k, []);
            porNome.get(k).push(r);
          });
          return { snap: s, porNome };
        })
      };
    }
    this._volumeIdxC.retratos.forEach(reg => {
      const s = reg.snap, linhas = [];
      membros.forEach(nome => {
        const achadas = reg.porNome.get(dk + ReforcoEngine.SEP + nome);
        if (achadas) linhas.push(...achadas);
      });
      if (!linhas.length) return;
      const cods = linhas.map(r => (r.codigo ? String(r.codigo) : null));
      let sq = 0, sac = 0;
      linhas.forEach((r, i) => {
        const c = cods[i];
        if (c && cods.some((outro, j) => j !== i && outro && c.indexOf(outro + '.') === 0)) return;
        sq += (r.questoes || 0); sac += (r.acertos || 0);
      });
      if (sq <= 0) return;
      q += sq; ac += sac;
      porRetrato.push({ startDate: s.startDate, endDate: s.endDate || s.date, q: sq, ac: sac });
    });
    return { q, ac, pct: q > 0 ? ac / q * 100 : null, porRetrato, fora: false, retratos: porRetrato.length };
  },
  /* A taxa do nó pela MESMA janela adaptativa que a lista usa — só que
     alimentada pelas linhas cruas em vez do índice. Monta um histórico
     sintético de uma chave só e reusa o cálculo original: uma régua, dois
     caminhos até ela. Duplicar a lógica aqui seria criar a segunda régua que a
     revisão anterior acabou de eliminar. */
  taxaDoNo(escopo, disciplina, opts) {
    const o = this.sanearPrefs(Object.assign({}, this.prefs(), opts || {}));
    const v = (opts && opts._volume) || this.volumeDoEscopo(escopo, disciplina, o);
    if (!v || !v.q) return null;
    const desc = v.porRetrato.slice().reverse()
      .map(x => ({ startDate: x.startDate, _idx: { __no__: { q: x.q, ac: x.ac } } }));
    return this._taxaAdaptativa('__no__', desc, o) || null;
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
    opts = this.sanearPrefs(Object.assign({}, this.prefs(), opts || {}));
    const snaps = Array.isArray(opts._snapshots) ? opts._snapshots : DB.getTecSnapshots();
    const pontos = [];
    // a trajetória segue o MESMO recorte do número grande (ver `focoSet`)
    const foco = this.focoSet(opts);
    /* A trajetória tem de excluir as MESMAS matérias que o domínio do topo.
       Sem isto, o número grande dizia 80,3% e o último ponto do gráfico logo
       abaixo dizia 74,9% — a mesma média, com e sem a matéria descartada. */
    const fora = this.excluidasSet(opts);
    let ant = null, antPct = null;
    snaps.forEach(s => {
      const idx = this._indice(s, opts);
      const chaves = Object.keys(idx).filter(k => idx[k].q >= (opts.pisoSerie || this.PISO_SERIE) &&
        !this.foraDoPlano(idx[k].disciplina || '', fora) &&
        this.noFoco(idx[k].disciplina || '', foco));
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
    const snaps = Array.isArray(opts._snapshots) ? opts._snapshots : DB.getTecSnapshots();
    const porTopico = {};
    snaps.forEach(s => {
      const idx = this._indice(s, opts);
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
  /* O menor piso de agrupamento que faz o Plano voltar a existir — e o que ele
     custa em número de unidades. Roda sobre o dado real, não sobre faixas
     inventadas: sem um piso que sirva, devolve null e a tela não promete nada. */
  _melhorPiso(scoped, opts) {
    try {
      if (opts.apenasFolhas === false) return null;
      const alvo = Math.max(1, opts.minAmostra);
      for (const piso of [10, 20, 30, 50]) {
        if (piso <= (parseInt(opts.granPiso || 0, 10) || 0)) continue;
        const L = Object.assign({}, opts, { granPiso: piso });
        this._agrC = null;
        const idx = this._indice(scoped, L);
        const ag = this._agrupamento(L);
        this._agrC = null;
        if (!ag) continue;
        const qualificam = Object.keys(idx).filter(k => (idx[k].q || 0) >= alvo).length;
        if (qualificam > 0) {
          return { piso, unidades: Object.keys(idx).length, qualificam,
            blocos: ag.nBlocos, topicos: ag.atomos };
        }
      }
      return null;
    } catch (e) { _quiet(e, 'plano-melhor-piso'); return null; }
  },
  /* ── A UNIDADE AGRUPADA TAMBÉM CAI NA PROVA ───────────────────────────────
     `incidenciaDe` casa por NOME, e "Licitações · bloco" não existe no índice
     da banca: todo bloco vinha com incidência ZERO. O efeito era o pior
     possível — a lente que existe para dar amostra ao assunto fino tirava dele
     o peso de prova, e na ordem "fraqueza × incidência" o bloco ia para o fim
     da fila sem que nada na tela explicasse. A auditoria via (a taxa de
     casamento caía), a tela não.

     A incidência do bloco é a SOMA dos membros. Eles são folhas irmãs do mesmo
     tópico-pai, então são disjuntas e somar não conta questão duas vezes —
     diferente de usar a incidência do PAI, que carregaria também os irmãos
     gordos que ficaram fora do bloco. */
  /* ── DUAS ATIVIDADES MEDINDO AS MESMAS QUESTÕES ───────────────────────────
     Desde que a atividade passou a medir o nó pelas LINHAS CRUAS (é o que a
     torna imune à lente), uma atividade em "Atos" conta tudo que você resolve
     nos subtópicos dele — inclusive o que uma segunda atividade, em "Atos ▸
     Elementos", também está contando. Antes isso não acontecia: uma media só o
     resíduo do pai, a outra só a folha.

     Nas barras de progresso a dobra é defensável — cada atividade mede o escopo
     que ela declarou. Na CALIBRAGEM não é: o mesmo volume entra duas vezes no
     total e o "questões por ponto" sai subestimado, o que rebaixa o custo de
     todo assunto do Plano. Então a criação avisa.

     O parentesco é resolvido pelo CÓDIGO DENTRO DE UM MESMO RETRATO — é ali que
     o código do TEC é válido, porque entre retratos ele é posicional. Basta um
     retrato afirmar a relação para o volume se sobrepor de fato. */
  atividadeSobreposta(topico, disciplina, membros) {
    try {
      const dk = ReforcoEngine.norm(disciplina || '');
      const alvos = ((membros && membros.length) ? membros : [topico])
        .map(n => ReforcoEngine.norm(n)).filter(Boolean);
      if (!alvos.length) return null;
      const abertas = (DB.getExtras() || []).filter(e =>
        e.origemPlano && e.origemPlano.topico && e.status !== 'concluida');
      if (!abertas.length) return null;
      /* Um passo só pelos retratos, montando nome → códigos POR retrato. Sem
         isto a conferência varria as linhas uma vez por par de nomes, e o
         "criar em série" faria isso dezenas de vezes num clique. */
      const porRetrato = (DB.getTecSnapshots() || []).map(sn => {
        const m = Object.create(null);
        (sn.rows || []).forEach(r => {
          if (!((r.depth || 0) > 0) || !r.codigo) return;
          if (dk && ReforcoEngine.norm(r.disciplina || '') !== dk) return;
          const k = ReforcoEngine.norm(r.nome || '');
          (m[k] = m[k] || []).push(String(r.codigo));
        });
        return m;
      });
      const contem = (pai, filho) => porRetrato.some(m => {
        const a = m[pai], b = m[filho];
        return !!(a && b && a.some(x => b.some(y => y.indexOf(x + '.') === 0)));
      });
      for (let i = 0; i < abertas.length; i++) {
        const o = abertas[i].origemPlano;
        const od = ReforcoEngine.norm(o.disciplina || '');
        if (dk && od && od !== dk) continue;
        const seus = (o.escopo && o.escopo.membros && o.escopo.membros.length)
          ? o.escopo.membros : [o.topico];
        for (let j = 0; j < seus.length; j++) {
          const m = ReforcoEngine.norm(seus[j]);
          if (!m) continue;
          for (let k = 0; k < alvos.length; k++) {
            if (contem(m, alvos[k])) return { extra: abertas[i], noDela: seus[j], relacao: 'cobre' };
            if (contem(alvos[k], m)) return { extra: abertas[i], noDela: seus[j], relacao: 'dentro' };
          }
        }
      }
      return null;
    } catch (e) { _quiet(e, 'sobreposicao'); return null; }
  },
  _incidDaUnidade(incMap, x) {
    if (!incMap) return 0;
    if (x && x.membros && x.membros.length > 1) {
      return x.membros.reduce((a, n) =>
        a + (ReforcoEngine.incidenciaDe(incMap, n, x.disciplina).valor || 0), 0);
    }
    return ReforcoEngine.incidenciaDe(incMap, x.nome, x.disciplina).valor || 0;
  },
  calcular(scoped, opts) {
    opts = this.sanearPrefs(Object.assign({}, this.prefs(), opts || {}));
    if (!scoped) return { erro: 'sem-retrato' };
    /* Toda conta temporal acompanha o escopo que produziu o retrato virtual.
       Antes, a lista recebia o recorte selecionado, mas taxa, sequência e nota
       projetada voltavam a consultar todos os retratos do perfil. */
    const fontesEscopo = (scoped._fontes && scoped._fontes.length) ? scoped._fontes : null;
    const historico = fontesEscopo || (DB.getTecSnapshots() || []);
    // Agregados reais carregam `_fontes` e ficam rigorosamente presos ao escopo.
    // Snapshots unitários/sintéticos não carregam essa propriedade; nesses casos
    // o histórico do DB é necessário para delta, sequência e consolidação.
    const todos = (historico.length ? historico : [scoped]).slice();
    if (!todos.length) return { erro: 'sem-retrato' };
    opts._snapshots = todos;
    // do mais novo para o mais antigo, cada um com seu índice de assuntos
    const snapsDesc = todos.slice().reverse().map(s => {
      return Object.assign({}, s, { _idx: this._indice(s, opts) });
    });
    const mHist = this._indice(scoped, opts);
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
    const foco = this.focoSet(opts);
    if (foco) chaves = chaves.filter(k => this.noFoco(mHist[k].disciplina || '', foco));
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
      const a = this._taxaAdaptativa(k, snapsDesc, opts);
      if (!a) return null;
      const taxa = a.pct;
      const amostraFraca = a.q < opts.minAmostra;
      const peso = (opts.ponderacao === 'volume') ? a.q : 1;
      const lacunaPP = Math.max(0, teto * 100 - taxa);
      const sq = seqs[k] || { seq: 0, medicoes: 0, diasDesde: null, serie: [] };
      return {
        nome: h.nome, disciplina: h.disciplina || '',
        /* Uma unidade agrupada carrega os tópicos que ela cobre — é o que a
           tela mostra no "i" e o que a atividade grava como escopo. Assunto
           comum vem com `membros` nulo e segue idêntico ao que sempre foi. */
        membros: h._membros || null, nAtomos: h._bloco || 0, baseBloco: h._base || null,
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
    }).filter(Boolean);
    if (!brutos.length) return { erro: 'janela', janelaMax: opts.janelaMax };
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
        qualificamNaSugestao: amostras.filter(q => q >= sug).length,
        /* Baixar a régua compra cobertura pagando em margem de erro — é a
           saída, não a boa saída. Juntar os átomos finos compra a MESMA
           cobertura pagando em granularidade, e margem de erro é o que
           invalida um diagnóstico; granularidade só o deixa mais grosso.
           Então a tela precisa saber se existe um piso que resolve, e com
           quantas unidades — senão continua oferecendo só a régua. */
        granSugerida: this._melhorPiso(scoped, opts) };
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
      x.incid = temIncid ? this._incidDaUnidade(incMap, x) : null;
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
      _snapshots: todos,
      dominioPct, meta, jaAtinge: dominioPct >= meta, falta: Math.max(0, meta - dominioPct),
      assuntos: usados.length, ignorados: brutos.length - usados.length,
      excluidasAtivas, excluidasAssuntos, excluidasQ,
      qTotal: usados.reduce((a, x) => a + x.qJanela, 0),
      idxMeta, qAteMeta: idxMeta >= 0 ? qAteMeta : null, caminho, equivalentes,
      equivalentesConfiaveis: plano.length >= 5,
      custoModo: opts.custoModo, custoPiso: opts.custoPiso, custoPorPonto: opts.custoPorPonto,
      pesoBanca: opts.pesoBanca, minAmostra: opts.minAmostra,
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
      // o recorte, como o topo da tela precisa dizê-lo
      foco: foco ? foco.nomes.slice() : [], focoRotulo: this.focoRotulo(foco),
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
    const p = PlanoEngine.sanearPrefs(Object.assign({}, PlanoEngine.prefs(), opts || {}));
    const teto = Math.max(50, Math.min(100, p.tetoDominio)) / 100;
    const norm = (x) => ReforcoEngine.norm(x);
    const fontes = Array.isArray(p._snapshots) ? p._snapshots : (DB.getTecSnapshots() || []);
    /* A taxa da matéria é montada retrato por retrato e passa pela mesma janela
       adaptativa do ranking. Somar a vida inteira aqui fazia a nota dizer 50%
       enquanto o assunto exibido pelo Plano já estava em 80%. */
    const nomesMateria = new Set();
    const desc = fontes.slice().reverse().map(s => {
      const idx = PlanoEngine._indice(s, p), por = Object.create(null);
      Object.keys(idx).forEach(k => {
        const disc = norm(idx[k].disciplina || k.split(ReforcoEngine.SEP)[0]);
        if (!disc) return;
        nomesMateria.add(disc);
        const c = por[disc] || { q: 0, ac: 0 };
        c.q += idx[k].q || 0; c.ac += idx[k].ac || 0; por[disc] = c;
      });
      return { startDate: s.startDate, endDate: s.endDate || s.date, _idx: por };
    });
    /* O EDITAL VOCÊ DIGITA; O HISTÓRICO VEM DA BANCA. Sem casar os dois, uma
       matéria cujo nome não bate exatamente cai em `semDado` e some da conta —
       e some para MENOS: a nota projetada fica menor do que a verdade, sem
       nenhum aviso de que faltou gente. É o mesmo casamento conservador do
       quadro de esforço, aplicado onde o erro custa mais caro. */
    const casado = this._casarNomes(comp.map(m => norm(m.nome)), [...nomesMateria]);
    let valorTotal = 0, hoje = 0, potencial = 0, semDado = [];
    const linhas = comp.map(m => {
      const chave = casado[norm(m.nome)] || norm(m.nome);
      const v = PlanoEngine._taxaAdaptativa(chave, desc, p);
      const taxa = v ? v.pct : null;
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
        const idx = PlanoEngine._indice(s, p);
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
    /* O ESCOPO é o que a atividade mede, dito em nomes de nó — não em chaves de
       índice. É ele que torna o progresso independente da lente do Plano: um
       item que hoje é um assunto e amanhã vira parte de um bloco continua sendo
       o mesmo trabalho, medido pelo mesmo lugar. Bloco vindo do Plano traz os
       membros; nó comum é ele mesmo. */
    /* Os dois portões (a lista do Plano e o "Puxar do Plano" da tela de
       Atividades) passam o ITEM do Plano — então ler os membros dele aqui é o
       que impede os dois de divergirem outra vez. */
    const mb = (opts && opts.escopo) || (item && item.membros ? { tipo: 'bloco', membros: item.membros } : null);
    const escopo = (mb && mb.membros && mb.membros.length)
      ? { tipo: mb.tipo || 'bloco', membros: mb.membros.slice() }
      : { tipo: 'no', membros: [topico] };
    return {
      topico, disciplina: disciplina || '',
      motivo: (opts && opts.motivo) || 'reforco',
      criadoEm: todayLocal(),
      taxaInicial: (item && item.taxa != null) ? item.taxa : null,
      // o contador do assunto no instante zero: é a régua do progresso
      qBase: PlanoEngine.qHistDe(disciplina, topico, p),
      escopo,
      // a MESMA régua, lida nas linhas cruas — a que o progresso usa de fato
      qBaseNo: PlanoEngine.volumeDoEscopo(escopo, disciplina, p).q,
      /* A META É A DO MOTOR NO DIA DA CRIAÇÃO, gravada aqui: mudar a régua
         depois não pode reescrever o veredito de quem já está correndo. */
      metaAlvo: this._metaDoMotor(),
      custoEstimado: (item && item.dose) || (item && item.custoQ) || null,
      /* Quem decidiu, e pensando em quê. Com um motor só, o que a etiqueta da
         atividade precisa dizer é a FASE — pré e pós escolhem por razões
         diferentes, e seis meses depois isso é o que explica a escolha. */
      sugestao: this._assinaturaDoMotor(item)
    };
  },
  _metaDoMotor() {
    try { return MotorSugestao.prefs().metaAcerto; }
    catch (e) { _quiet(e, 'ciclo-meta'); return 90; }
  },
  _assinaturaDoMotor(item) {
    try {
      const p = MotorSugestao.prefs();
      return {
        motor: 'motor', fase: p.fase, criadoEm: todayLocal(),
        margemMax: p.margemMax,
        margem: (item && item.margem != null) ? Math.round(item.margem * 10) / 10 : null,
        bloco: !!(item && item.agregado)
      };
    } catch (e) { _quiet(e, 'ciclo-assinatura'); return null; }
  },
  /* ── A LENTE LEGADA, PINADA ───────────────────────────────────────────────
     Atividade criada antes do escopo não tem `qBaseNo`, e o `qBase` dela foi
     escrito pelo índice com `apenasFolhas: true` — o padrão de fábrica.
     Medi-la com a lente de HOJE seria trocar a régua no meio do trabalho;
     medi-la pelas linhas cruas inflaria o progresso do nó que virou pai depois
     da criação (o `qBase` dele é resíduo, o volume cru é o ramo inteiro).
     Então ela continua exatamente na régua em que nasceu — e pinada, não
     herdada das preferências: qualquer controle de granularidade que entre
     depois tem de deixar esta leitura parada. `migrarEscopos` promove a
     atividade para a régua nova sem mover o número. */
  LENTE_LEGADA: { apenasFolhas: true, granPiso: 0 },
  /* ── O TÍTULO QUE A PESSOA LÊ ─────────────────────────────────────────────
     A unidade agrupada se chama "Licitações · bloco" — nome de máquina, bom
     para casar chaves e ruim na lista de atividades da semana. O título diz o
     que é em português; `origemPlano.topico` continua sendo o nome da unidade,
     porque é ele que o resto do motor casa. Os dois portões de criação chamam
     daqui: eram duas cópias desta linha, já com o risco de divergirem. */
  titulo(nome, motivo, membros) {
    const base = (membros && membros.length > 1)
      ? String(nome).replace(/\s*·\s*bloco\s*$/i, '') + ' (bloco de ' + membros.length + ' tópicos)'
      : String(nome);
    return (motivo === 'diagnostico' ? 'Diagnosticar: ' : 'Reforçar: ') + base;
  },
  _pLegada(p) { return Object.assign({}, p || PlanoEngine.prefs(), this.LENTE_LEGADA); },
  _escopoDe(o) {
    return (o && o.escopo && o.escopo.membros && o.escopo.membros.length) ? o.escopo : null;
  },
  /* O retrato de uma atividade AGORA. Não grava nada: quem decide escrever é
     `conciliar`. Separar as duas coisas é o que deixa a tela desenhar o estado
     a cada repintura sem efeito colateral nenhum. */
  avaliar(extra, r, mapa) {
    const o = extra && extra.origemPlano;
    if (!o || !o.topico) return null;
    const p = PlanoEngine.prefs();
    if (r && Array.isArray(r._snapshots)) p._snapshots = r._snapshots;
    const alvo = Math.max(1, extra.alvo || o.custoEstimado || 1);
    /* Com escopo, a medição vem das linhas cruas (`volumeDoEscopo`) e não muda
       se a lente do Plano mudar. Sem escopo, a atividade fica na lente legada
       pinada — `mapa` chega pinado pelos chamadores por isso. */
    const esc = this._escopoDe(o);
    const vol = esc ? PlanoEngine.volumeDoEscopo(esc, o.disciplina, p) : null;
    const qAgora = vol ? vol.q
      : PlanoEngine.qHistDe(o.disciplina, o.topico, Object.assign({}, this._pLegada(p), { _mapa: mapa }));
    const qBase = (vol && o.qBaseNo != null) ? o.qBaseNo : o.qBase;
    const medido = (qBase != null) ? Math.max(0, qAgora - qBase) : 0;
    const manual = DB.extraProgressoPeriodo ? DB.extraProgressoPeriodo(extra) : (extra.progresso || 0);
    const feito = Math.max(manual, medido);
    // o assunto, como o Plano o vê hoje
    const linhas = [].concat((r && r.itens) || [], (r && r.pequenas) || []);
    const at = linhas.find(x => DesempenhoTecScreen._casaUnidade(o, x));
    /* Sumiu da lista do Plano por dois motivos OPOSTOS: ou passou do teto (foi
       resolvido) ou o assunto sumiu do TEC. `qAgora` desempata: sem questão
       nenhuma no histórico, não é vitória — é um assunto que não existe mais. */
    const orfa = qAgora === 0;
    /* A taxa vem SEMPRE da janela adaptativa, esteja o assunto na lista ou
       não. Ler `at.taxa` quando ele está e a média histórica quando não está
       eram duas réguas para a mesma pergunta — e a segunda reprovava assunto
       resolvido, porque carrega o desempenho velho que a janela já descartou. */
    const aNo = (orfa || !vol) ? null : PlanoEngine.taxaDoNo(esc, o.disciplina, Object.assign({}, p, { _volume: vol }));
    const taxa = orfa ? null
      : (vol ? (aNo ? aNo.pct : null) : PlanoEngine.taxaAtualDe(o.disciplina, o.topico, this._pLegada(p)));
    const meta = (o.metaAlvo != null) ? o.metaAlvo : p.metaDominio;
    const delta = (taxa != null && o.taxaInicial != null) ? Math.round((taxa - o.taxaInicial) * 10) / 10 : null;
    const cumpriu = feito >= alvo;
    const bateu = (taxa != null) && (taxa >= meta);
    /* ── UM DIAGNÓSTICO NÃO PROMETE ACERTO, PROMETE AMOSTRA ─────────────────
       `avaliar` nunca lia `motivo`, e julgava pela régua do reforço tudo que
       fosse atividade do Plano. Consequência: o diagnóstico criado justamente
       para descobrir se um assunto de 6 questões é fraqueza real — e que
       cumpria o alvo e revelava 40% — era encerrado como "⚠️ volume não
       resolveu" e entrava no histórico como fracasso. Ele fez exatamente o que
       foi pedido: produziu medição.

       O desfecho de um diagnóstico é o assunto passar a MEDIR (alcançar a
       amostra mínima). O que a medição revelou é a informação, não a nota. */
    const diag = o.motivo === 'diagnostico';
    const mediu = diag && qAgora >= Math.max(1, p.minAmostra || 20);
    let estado = 'andamento';
    if (orfa) estado = 'orfa';
    else if (diag) estado = mediu ? 'mediu' : 'andamento';
    else if (bateu) estado = 'funcionou';
    else if (cumpriu) estado = (delta != null && delta >= (p.sensTendencia || 3)) ? 'subiu' : 'naoFuncionou';
    return {
      extra, origem: o, alvo, feito, medido, manual, qAgora, qBase, diag, mediu,
      escopo: esc, lenteCrua: !!vol, retratosMedidos: vol ? vol.retratos : null,
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
    if (!snaps.length) return { fechadas: [], vereditos: [], promovidas: 0 };
    /* A promoção vem ANTES e não depende do cálculo do Plano: ele pode falhar
       por amostra insuficiente, e uma atividade não pode ficar presa à lente
       antiga porque o ranking não fechou. */
    const promovidas = this.migrarEscopos().promovidas;
    const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
    if (!r || r.erro) return { fechadas: [], vereditos: [], promovidas };
    const mapa = PlanoEngine.totalHistorico(this.LENTE_LEGADA);
    const ultimo = snaps[snaps.length - 1];
    const fechadas = [], vereditos = [];
    DB.getExtras().forEach(e => {
      if (!e.origemPlano || !e.origemPlano.topico) return;
      if (e.status === 'concluida' || e.origemPlano.veredito) return;
      const v = this.avaliar(e, r, mapa);
      if (!v || (v.estado !== 'funcionou' && v.estado !== 'naoFuncionou' && v.estado !== 'mediu')) return;
      const veredito = {
        tipo: v.estado, em: todayLocal(), retrato: ultimo.id,
        taxaInicial: v.origem.taxaInicial, taxaFinal: v.taxa,
        /* Diagnóstico não tem ganho a reivindicar: ele foi medir, não melhorar.
           `ganhoPP: null` mantém a calibragem limpa — ela só aprende com ciclo
           que prometeu subir a taxa (ver `calibragem`). */
        ganhoPP: (v.estado === 'mediu') ? null : v.delta,
        questoes: v.feito, alvo: v.alvo
      };
      DB.updateExtra(e.id, { status: 'concluida', origemPlano: Object.assign({}, e.origemPlano, { veredito }) });
      fechadas.push(e.id); vereditos.push(veredito);
    });
    return { fechadas, vereditos, promovidas };
  },
  /* ── PROMOÇÃO DA RÉGUA, SEM MOVER O NÚMERO ────────────────────────────────
     A atividade antiga é medida pela lente legada e, por isso, voltaria a ficar
     exposta a qualquer mexida no índice. A promoção resolve de uma vez: grava o
     escopo e um `qBaseNo` CALIBRADO — o volume cru de hoje MENOS o progresso
     que a lente legada está medindo agora. O resultado é aritmético e não
     opinativo: no instante da promoção o progresso é o mesmo número que já
     estava na tela, e daí em diante ele é imune à lente.

     Idempotente de propósito: só toca em quem ainda não tem escopo, e nunca em
     ciclo já julgado — veredito é história, não se recalcula. */
  migrarEscopos() {
    const snaps = DB.getTecSnapshots();
    if (!snaps.length) return { promovidas: 0 };
    const p = PlanoEngine.prefs();
    const pLeg = this._pLegada(p);
    const mapa = PlanoEngine.totalHistorico(pLeg);
    let n = 0;
    DB.getExtras().forEach(e => {
      const o = e.origemPlano;
      if (!o || !o.topico || o.veredito || this._escopoDe(o)) return;
      const escopo = { tipo: 'no', membros: [o.topico] };
      const vol = PlanoEngine.volumeDoEscopo(escopo, o.disciplina, p);
      const qLeg = PlanoEngine.qHistDe(o.disciplina, o.topico, Object.assign({}, pLeg, { _mapa: mapa }));
      const medido = (o.qBase != null) ? Math.max(0, qLeg - o.qBase) : 0;
      DB.updateExtra(e.id, { origemPlano: Object.assign({}, o, { escopo, qBaseNo: Math.max(0, vol.q - medido) }) });
      n++;
    });
    return { promovidas: n };
  },
  /* ── ENCERRAR NA MÃO NÃO PODE SAIR DO CICLO EM SILÊNCIO ───────────────────
     Duas portas concluem uma atividade sem passar por `conciliar`: o botão
     "Concluir" do painel de reforços e o lançamento manual que alcança o alvo
     (`DB.addExtraProgress` marca `concluida` sozinho quando `periodo` é única).
     Nas duas, `conciliar` passava a ignorá-la para sempre — `status` já era
     concluída — e o ciclo terminava sem veredito: fora do histórico, invisível
     para a calibragem. O app deixava de aprender exatamente com quem usou o
     botão que ele mesmo oferece.

     A trava que importa: `ganhoPP` só existe quando houve medição NOVA depois da
     criação. Sem ela, encerrar na mão gravaria "0pp por N questões" e faria a
     calibragem concluir que volume não rende nada — envenenar o aprendizado é
     pior que perder o registro. Sem medição nova, o veredito é `encerradaPorVoce`
     com `ganhoPP: null`, e `calibragem` o descarta sozinha. */
  vereditoManual(extra) {
    const o = extra && extra.origemPlano;
    if (!o || !o.topico || o.veredito) return null;
    let v = null;
    try { v = this.avaliar(extra, { itens: [], pequenas: [] }, null); } catch (e) { _quiet(e, 'veredito-manual'); }
    if (!v) return null;
    const snaps = DB.getTecSnapshots() || [];
    const sens = PlanoEngine.prefs().sensTendencia || 3;
    const comMedicao = v.medido > 0 && v.taxa != null && o.taxaInicial != null;
    const tipo = v.diag ? (v.mediu ? 'mediu' : 'encerradaPorVoce')
      : (v.bateu ? 'funcionou'
        : (comMedicao ? (v.delta != null && v.delta >= sens ? 'subiu' : 'naoFuncionou') : 'encerradaPorVoce'));
    const veredito = {
      tipo, em: todayLocal(), retrato: snaps.length ? snaps[snaps.length - 1].id : null,
      taxaInicial: o.taxaInicial, taxaFinal: v.taxa,
      ganhoPP: (comMedicao && tipo !== 'mediu') ? v.delta : null,
      questoes: v.feito, alvo: v.alvo, porMao: true, semMedicaoNova: !comMedicao
    };
    DB.updateExtra(extra.id, { origemPlano: Object.assign({}, o, { veredito }) });
    return veredito;
  },
  /* ── APAGAR UM RETRATO NÃO PODE APAGAR O SEU TRABALHO ─────────────────────
     `qBaseNo` é gravado uma vez, na criação. Apagar um retrato derruba o volume
     de hoje abaixo dessa linha de base, e `medido = max(0, qAgora − qBaseNo)`
     vira ZERO: reproduzido em harness, uma atividade com 120 questões medidas
     caía para 0 ao apagar um retrato ANTIGO, que não era nem o que continha o
     progresso. O número na barra some sem nada na tela explicar.

     A dupla abaixo re-pina a linha de base preservando o progresso medido — a
     mesma aritmética de `migrarEscopos`. Apagar um retrato é higiene de dado,
     não uma declaração de que o estudo não aconteceu; e o app já decidiu, no
     `max(digitado, medido)`, que importar só empurra a barra para cima. */
  fotoDoProgresso() {
    const foto = Object.create(null);
    try {
      (DB.getExtras() || []).forEach(e => {
        if (!e.origemPlano || !e.origemPlano.topico || e.status === 'concluida') return;
        if (!this._escopoDe(e.origemPlano)) return;      // legado: não tem o que re-pinar
        const v = this.avaliar(e, { itens: [], pequenas: [] }, null);
        if (v) foto[e.id] = v.medido;
      });
    } catch (e) { _quiet(e, 'foto-progresso'); }
    return foto;
  },
  repinarProgresso(foto) {
    if (!foto) return 0;
    let n = 0;
    try {
      const p = PlanoEngine.prefs();
      (DB.getExtras() || []).forEach(e => {
        if (foto[e.id] == null) return;
        const o = e.origemPlano, esc = this._escopoDe(o);
        if (!o || !esc) return;
        const vol = PlanoEngine.volumeDoEscopo(esc, o.disciplina, p);
        const novo = Math.max(0, vol.q - foto[e.id]);
        if (novo === o.qBaseNo) return;
        DB.updateExtra(e.id, { origemPlano: Object.assign({}, o, { qBaseNo: novo }) });
        n++;
      });
    } catch (e) { _quiet(e, 'repinar-progresso'); }
    return n;
  },
  // as atividades do Plano ainda abertas, já avaliadas
  emCurso(r) {
    const lente = Object.assign({}, this.LENTE_LEGADA,
      r && Array.isArray(r._snapshots) ? { _snapshots: r._snapshots } : {});
    const mapa = PlanoEngine.totalHistorico(lente);
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
   ids — nada foi duplicado nem reescrito; cada tela segue lendo os campos
   que realmente usa.

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
    return [...document.querySelectorAll('#tec-cfg-body .tec-cfg-sec[data-tab="' + (aba || this.aba) + '"]')];
  },
  TITULOS: {
    motor: { t: '🧭 Ajustes do Motor', s: 'A margem que decide até onde descer na árvore e o tamanho do caderno que o motor reparte.' }
  },
  /* Padrão de fábrica de cada seção: é com isto que o ponto no chip sabe se
     você mexeu ali. Ler os defaults do motor (e não uma cópia) é o que impede
     o ponto de mentir quando um padrão mudar. */
  PADROES: {
    motor: () => Object.assign({}, MotorSugestao.DEFAULTS)
  },
  abrir(aba) {
    const modal = document.getElementById('tec-cfg-modal');
    if (!modal || !this.TITULOS[aba]) return;
    this.aba = aba;
    const secs = this._secoes(aba);
    if (!secs.length) return;
    const rot = this.TITULOS[aba];
    document.getElementById('tec-cfg-title').textContent = rot.t;
    document.getElementById('tec-cfg-sub').textContent = rot.s;
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
    /* Esconde TODAS as seções, não só as da aba corrente: as abas dividem o
       mesmo corpo, e ocultar apenas as irmãs deixava a seção da aba anterior
       aparecendo por baixo. */
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
        /* Campo escondido pelo escopo desta porta não acende o ponto dela: o
           ponto quer dizer "você mexeu em algo AQUI DENTRO". */
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
    const p = [];
    if (aba === 'motor') {
      const m = MotorSugestao.prefs();
      p.push(['fase', m.fase === 'pos' ? 'pós-edital' : 'pré-edital']);
      if (m.fase === 'pos') {
        let b = ''; try { b = ReforcoEngine.rotuloBancas(m.banca); } catch (e) { _quiet(e, 'cfg-bancas'); }
        p.push([/ e /.test(b) ? 'bancas' : 'banca', b.replace(/^todas as bancas$/, 'todas')]);
      }
      p.push(['margem', '±' + m.margemMax + 'pp']);
      p.push(['base/reforço', m.alvoQuestoes + ' questões']);
      p.push(['disciplinas agora', String(m.maxFrentes)]);
      p.push(['meta', m.metaAcerto + '%']);
    }
    return p.filter(x => x[1]);
  },
  // chamado pelas telas a cada repintura: o resumo nunca pode ficar velho
  sincronizar(aba) {
    const alvos = aba ? [aba] : ['motor'];
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
  /* ═══ TODA ABA PESADA MERECE O MESMO TRATAMENTO ═════════════════════════
     O adiamento com esqueleto existia só para o Plano. As outras três abas
     chamavam o render direto do `click`, e cada uma faz trabalho pesado sobre
     o mesmo conjunto de retratos: Análise soma totais e monta o
     quadro por disciplina; Incidência monta uma floresta por banca;
     Reforço cruza incidência com erro em toda a árvore. Num perfil com dez
     retratos e centenas de assuntos, o clique no chip simplesmente não
     respondia por um tempo visível — a aba antiga continuava na tela, sem
     nenhum sinal, e o app parecia ter travado. Era isso que se sentia ao
     alternar entre 📊 Análise, 🏛️ Incidência, 🏁 Plano e ⚙ Modelos.

     A correção é a mesma do Plano, generalizada: o que é barato (marcar o chip
     ativo e trocar qual painel está visível) acontece no MESMO quadro do
     toque, um sinal de trabalho aparece junto, e o cálculo roda no quadro
     seguinte. O tempo total não muda — deixa de ser tempo mudo.

     `switchTecTab` continua síncrona de propósito: quem a chama por código (e
     a suíte de verificação) espera a tela pintada ao retornar. O adiamento
     pertence ao clique, não à API. */
  ABAS_TEC: ['analise', 'incidencia', 'motor'],
  /* Painéis cujo corpo é GERADO por inteiro podem receber o esqueleto no
     lugar do conteúdo. Os demais têm HTML estático (cartões, filtros) que não
     pode ser descartado — neles o sinal é o estado ocupado do próprio painel. */
  ESQUELETO_ABA: { motor: 'motor-lista' },
  ROTULO_ABA: {
    analise: 'Somando os seus retratos…',
    incidencia: 'Montando a árvore da banca…',
    motor: 'Achando o nível certo de cada ramo…'
  },
  _pintarTrocaDeAba(alvo) {
    this.tecTab = alvo;
    document.querySelectorAll('#tec-subtabs .tec-subtab')
      .forEach(x => x.classList.toggle('active', x.dataset.tectab === alvo));
    document.querySelectorAll('[id^="tec-panel-"]').forEach(el => {
      const mostrar = (el.id === 'tec-panel-' + alvo) ? 'block' : 'none';
      if (el.style.display !== mostrar) el.style.display = mostrar;
    });
  },
  trocarAbaPeloToque(alvo) {
    if (!alvo || this.ABAS_TEC.indexOf(alvo) < 0) return;
    this._pintarTrocaDeAba(alvo);
    const skelId = this.ESQUELETO_ABA[alvo];
    const skel = skelId ? document.getElementById(skelId) : null;
    if (skel) { pintarDepois(skel, this.ROTULO_ABA[alvo], () => this.switchTecTab(alvo)); return; }
    const painel = document.getElementById('tec-panel-' + alvo);
    if (painel) { painel.setAttribute('aria-busy', 'true'); painel.classList.add('tec-aba-ocupada'); }
    const soltar = () => {
      if (!painel) return;
      painel.removeAttribute('aria-busy');
      painel.classList.remove('tec-aba-ocupada');
    };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { this.switchTecTab(alvo); }
      catch (e) { _quiet(e, 'tec-troca-aba'); }
      finally { soltar(); }
    }));
  },
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
  render() {
    // Uma abertura do TEC consulta os mesmos retratos em escopo, análise, série,
    // árvore e Plano. Desserializar 8× milhares de linhas a cada chamada era
    // trabalho repetido. A fotografia dura somente este render.
    DB._tecReadSnapshot = null;
    this._scopeSigC = new WeakMap();
    const snaps = DB.getTecSnapshots();
    DB._tecReadSnapshot = snaps;
    const emptyEl = document.getElementById('tec-empty');
    const importEl = document.getElementById('tec-import');
    const analysisEl = document.getElementById('tec-analysis');
    importEl.style.display = 'none';
    if (snaps.length === 0) {
      emptyEl.style.display = 'block';
      analysisEl.style.display = 'none';
      DB._tecReadSnapshot = null;
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
    if (['fracos', 'fortes', 'indice'].includes(_p.treeOrdem)) this.treeOrdem = _p.treeOrdem;
    if (this.discFilters === null) {
      const salvas = Array.isArray(_p.discFilters) ? _p.discFilters : [];
      this.discFilters = [...new Set(salvas.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))];
      // compatibilidade com chamadas antigas que ainda leem discFilter
      this.discFilter = this.discFilters.length === 1 ? this.discFilters[0] : '__todas__';
    }
    // Na primeira abertura, restaura inclusive []: "Limpar" é um estado válido.
    if (this.selectedSnapIds === null) {
      const salvos = Array.isArray(_p.selectedSnapIds) ? _p.selectedSnapIds : null;
      this.selectedSnapIds = salvos
        ? new Set(salvos.map(id => Number.isFinite(Number(id)) ? Number(id) : id))
        : new Set(snaps.map(s => s.id));
    }
    // remove apenas ids que realmente deixaram de existir; seleção vazia permanece vazia
    [...this.selectedSnapIds].forEach(id => { if (!snaps.find(s => s.id === id)) this.selectedSnapIds.delete(id); });
    if (!this.rangeStart && _p.rangeStart) this.rangeStart = _p.rangeStart;
    if (!this.rangeEnd && _p.rangeEnd) this.rangeEnd = _p.rangeEnd;
    if (!this.rangeStart || !this.rangeEnd) {
      this.rangeStart = snaps[0].startDate;
      this.rangeEnd = snaps[snaps.length - 1].endDate;
    }
    this.renderScopeControls(snaps);
    this.switchTecTab(this.tecTab || 'analise'); // reaplica e renderiza só a aba ativa
    this.applyCfgHidden();
    this.applyEnxuto();
    DB._tecReadSnapshot = null;
  },
  /* A Análise não tem mais um painel de ajuste de exibição. Estes métodos
     ficam apenas como compatibilidade com perfis antigos e sempre limpam os
     estados que escondiam conteúdo. */
  applyCfgHidden() {
    const wrap = document.getElementById('tec-analysis');
    if (wrap) wrap.classList.remove('hide-cfg', 'hide-heads');
  },
  applyEnxuto() {
    const tela = document.getElementById('screen-desempenhotec');
    const wrap = document.getElementById('tec-analysis');
    if (tela) tela.classList.remove('tec-enxuto');
    if (wrap) wrap.classList.remove('hide-heads');
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
  setBancas(lista, opcoes) {
    this.savePrefs({ bancasSel: Array.isArray(lista) ? lista : [] });
    try { if (typeof PlanoEngine !== 'undefined') PlanoEngine.salvarPrefs({ banca: '__todas__' }); } catch (e) { _quiet(e, 'banca-plano'); }
    ['motor-banca-pick', 'incid-banca-pick'].forEach(id => this._sincronizarBancaPicker(document.getElementById(id)));
    const painel = opcoes && opcoes.painel;
    const y = painel ? painel.scrollTop : 0;
    if (this.tecTab === 'motor') this.renderMotor();
    else if (this.tecTab === 'incidencia') this.renderIncidencia({ preservarBancaPicker: true });
    if (painel && document.body.contains(painel)) {
      painel.removeAttribute('hidden'); painel.scrollTop = y;
      const btn = painel.parentElement && painel.parentElement.querySelector('.banca-pick-btn');
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }
  },
  renderBancaPickers() {
    ['motor-banca-pick', 'incid-banca-pick'].forEach(id => this.renderBancaPicker(id));
  },
  _sincronizarBancaPicker(host) {
    if (!host) return false;
    const bancas = DB.getBancas();
    const sel = this.bancasSelecionadas();
    const painel = host.querySelector('.banca-pick-panel');
    const btn = host.querySelector('.banca-pick-btn');
    if (!painel || !btn) return false;
    const set = new Set(sel.map(ReforcoEngine.norm));
    painel.querySelectorAll('input[data-banca]').forEach(ch => {
      ch.checked = set.has(ReforcoEngine.norm(ch.value));
    });
    const todas = painel.querySelector('[data-acao="todas"]');
    if (todas) {
      todas.classList.toggle('is-active', sel.length === 0);
      todas.setAttribute('aria-pressed', sel.length === 0 ? 'true' : 'false');
    }
    const rot = !bancas.length ? 'Nenhuma banca importada'
      : !sel.length ? '🏛️ Todas as bancas'
      : sel.length === 1 ? '🏛️ ' + sel[0]
      : '🏛️ ' + sel.length + ' bancas';
    const alvo = btn.querySelector('span:not(.chev)');
    if (alvo) alvo.textContent = rot;
    const nota = painel.querySelector('.banca-pick-nota');
    if (nota) nota.textContent = sel.length ? sel.length + ' banca(s) selecionada(s).' : 'Todas as bancas estão na conta.';
    return true;
  },
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
        <button type="button" class="banca-pick-all ${sel.length ? '' : 'is-active'}" data-acao="todas" aria-pressed="${sel.length ? 'false' : 'true'}">
          <span class="banca-pick-all-mark">✓</span><span><b>Todas as bancas</b><small>Somar todo o histórico importado</small></span>
        </button>
        <p class="banca-pick-topo">Ou marque somente as bancas do seu concurso.</p>
        <div class="banca-pick-list">
          ${bancas.map(b => `<label class="banca-pick-item">
            <input type="checkbox" data-banca value="${escapeHtml(b)}" ${marcada(b) ? 'checked' : ''}>
            <span><b>${escapeHtml(b)}</b><small>${escapeHtml(resumo(b))}</small></span>
          </label>`).join('')}
        </div>
        <div class="banca-pick-acoes"><span class="banca-pick-nota">${sel.length ? sel.length + ' banca(s) selecionada(s).' : 'Todas as bancas estão na conta.'}</span></div>
      </div>`;
    const btn = host.querySelector('.banca-pick-btn');
    const painel = host.querySelector('.banca-pick-panel');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = painel.hasAttribute('hidden');
      document.querySelectorAll('.banca-pick-panel,.tec-disc-pick-panel').forEach(p2 => { if (p2 !== painel) p2.setAttribute('hidden', ''); });
      document.querySelectorAll('.banca-pick-btn,.tec-disc-pick-btn').forEach(b2 => { if (b2 !== btn) b2.setAttribute('aria-expanded', 'false'); });
      if (abrir) { painel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
      else { painel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); }
    });
    painel.addEventListener('click', (e) => e.stopPropagation());
    painel.querySelectorAll('input[data-banca]').forEach(ch => ch.addEventListener('change', () => {
      this.setBancas([...painel.querySelectorAll('input[data-banca]:checked')].map(x => x.value), { painel });
    }));
    const all = painel.querySelector('[data-acao="todas"]');
    if (all) all.addEventListener('click', () => this.setBancas([], { painel }));
  },
  /* ── A CAIXA DO QUE FICA DE FORA ──────────────────────────────────────────
     Mesma mecânica da caixa de bancas, e pelo mesmo motivo: a resposta certa é
     MAIS DE UMA, e numa lista suspensa a segunda escolha desfaz a primeira.
     Cada linha mostra o tamanho do que sai da conta (assuntos e questões do
     histórico), porque "excluir Legislação do RN" tem consequências muito
     diferentes se ela vale 40 questões ou 2.400. */
  /* ── O RÓTULO E O PÉ MUDAM; A LISTA NÃO ─────────────────────────────────
     Marcar uma matéria muda exatamente duas coisas dentro desta caixa: o
     texto do botão ("🚫 5 matérias fora") e a linha de ações no pé ("↺ Trazer
     todas de volta" aparece a partir da primeira marcada). Os nomes, a ordem
     e o volume de cada linha são os mesmos — eles vêm do histórico, não da
     marcação.

     Reconstruir o `innerHTML` inteiro para atualizar esses dois pedaços é o
     que fazia a caixa "voltar para o início da lista": um painel novo nasce
     com `scrollTop = 0`, e com trinta matérias você era devolvido ao topo a
     cada clique — além de pagar `materiasExcluiveis()` (que varre todos os
     retratos para contar assuntos e questões) de novo, o que é a travada que
     se sentia junto. Agora só os dois pedaços são reescritos, no lugar. */
  _sincronizarExcluidasPicker(host) {
    if (!host) return false;
    const btn = host.querySelector('.banca-pick-btn');
    const painel = host.querySelector('.banca-pick-panel');
    const acoes = painel && painel.querySelector('.banca-pick-acoes');
    if (!btn || !painel || !acoes) return false;
    const marcadas = [...painel.querySelectorAll('input[type="checkbox"]:checked')].length;
    const total = painel.querySelectorAll('input[type="checkbox"]').length;
    const rot = !total ? 'Nenhuma matéria conhecida'
      : marcadas === 0 ? '✅ Todas as matérias no Plano'
      : marcadas === 1 ? '🚫 1 matéria fora'
      : `🚫 ${marcadas} matérias fora`;
    const alvo = btn.querySelector('span:not(.chev)');
    if (alvo && alvo.textContent !== rot) alvo.textContent = rot;
    const acoesHtml = marcadas
      ? '<button type="button" data-acao="nenhuma">↺ Trazer todas de volta</button>'
      : '<span class="banca-pick-nota">Nenhuma matéria excluída — o Plano está vendo tudo.</span>';
    if (acoes.innerHTML !== acoesHtml) {
      acoes.innerHTML = acoesHtml;
      const b = acoes.querySelector('[data-acao]');
      if (b) b.addEventListener('click', () => this.setExcluidas([]));
    }
    return true;
  },
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
    /* Uma matéria que acabou de sair do Plano não pode continuar no recorte:
       o Plano ficaria filtrado por algo que ele não enxerga mais, e a lista
       viria vazia sem dizer por quê. Vale para o foco inteiro, não só para o
       filtro de uma. */
    const pAtual = PlanoEngine.prefs();
    const focoLimpo = (Array.isArray(pAtual.foco) ? pAtual.foco : []).filter(n => !PlanoEngine.foraDoPlano(n, fora));
    patch.foco = focoLimpo;
    patch.disciplina = (focoLimpo.length === 1) ? focoLimpo[0] : '__todas__';
    PlanoEngine.salvarPrefs(patch);
    this._planoRefC = null;
    /* `renderPlano()` reconstrói TODOS os campos da folha, inclusive o select
       de disciplina e a própria caixa que você acabou de tocar — e era isso
       que fazia a caixa fechar e a página saltar a cada matéria marcada. Aqui
       só duas coisas mudaram de verdade: a lista de disciplinas oferecidas no
       filtro e o conteúdo do Plano. */
    this._sincronizarFiltroDisc();
    /* Atualização no lugar. Se por algum motivo a caixa não estiver montada
       (primeira pintura, id trocado), cai na reconstrução completa — mas
       guardando e devolvendo a rolagem do painel, que é o que se perdia. */
    const host = document.getElementById('plano-excluidas-pick');
    if (!this._sincronizarExcluidasPicker(host)) {
      const painelAntes = host && host.querySelector('.banca-pick-panel');
      const y = painelAntes ? painelAntes.scrollTop : 0;
      this.renderExcluidasPicker('plano-excluidas-pick');
      const painelDepois = host && host.querySelector('.banca-pick-panel');
      if (painelDepois && y) painelDepois.scrollTop = y;
    }
    /* ── O RECÁLCULO ESPERA O ÚLTIMO CLIQUE ─────────────────────────────────
       `agendarPlano(true)` roda o motor inteiro AGORA. Quem abre esta caixa
       raramente tira uma matéria só: marcar cinco disparava cinco cálculos
       completos em sequência, e cada um deles é o motor varrendo todos os
       retratos. Era a travada de meio segundo a cada caixinha.

       Uma caixa de seleção não é uma rajada de teclas, mas é uma rajada de
       CLIQUES — e aqui o resultado só importa depois do último. O pedido passa
       a ser agendado, como o dos campos numéricos: o sinal de "processando"
       aparece na hora e o cálculo acontece uma vez. */
    this.agendarPlano(false);
  },
  /* A lista do filtro de disciplina depende do que está excluído — é o único
     campo da folha que a exclusão precisa mexer. Extraído de `renderPlano`
     para que marcar uma matéria não obrigue a reconstruir os outros vinte. */
  /* O select é a VISTA do foco, não um segundo estado: Todas, uma matéria, ou
     "N em foco" quando o quadro carregou várias. Escolher `__varias__` de novo é
     um no-op de propósito — ela existe para MOSTRAR, não para significar algo
     que nenhuma outra opção já diga. */
  _sincronizarFiltroDisc() {
    const ds = document.getElementById('plano-disc');
    if (!ds) return;
    const p = PlanoEngine.prefs();
    const fora = PlanoEngine.excluidasSet(p);
    const discs = PlanoEngine.disciplinas(this.scopedSnapshot()).filter(d => !PlanoEngine.foraDoPlano(d, fora));
    const foco = PlanoEngine.focoSet(p);
    const uma = (foco && foco.n === 1) ? foco.nomes[0] : null;
    ds.innerHTML = `<option value="__todas__">📚 Todas</option>`
      + ((foco && foco.n > 1) ? `<option value="__varias__">🎯 ${foco.n} matérias em foco</option>` : '')
      + discs.map(d => `<option value="${escapeHtml(d)}"${uma && ReforcoEngine.norm(d) === ReforcoEngine.norm(uma) ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('');
    if (foco && foco.n > 1) ds.value = '__varias__';
    else if (!uma || ![...ds.options].some(o => ReforcoEngine.norm(o.value) === ReforcoEngine.norm(uma))) ds.value = '__todas__';
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
    let perfil = '';
    try { perfil = DB._profilePrefix(); } catch (_) { _quiet(_); }
    /* O cache precisa representar CONTEÚDO, não só envelope. Reimportar/corrigir
       um retrato pode preservar id, datas e quantidade de linhas enquanto muda
       acertos/questões (ou a árvore). Sem esta assinatura, Análise/Plano podem
       reutilizar silenciosamente o agregado anterior. FNV-1a é barato, estável
       e percorre exatamente os campos que alteram a consolidação. */
    const assinar = (snap) => {
      // scopedSnapshot pode ser consultado por totais, evolução, filtros e Plano
      // na mesma pintura. O objeto do retrato é imutável durante esse render;
      // portanto sua assinatura também é. Evita percorrer milhares de linhas
      // várias vezes só para confirmar a mesma chave de cache.
      if (!this._scopeSigC) this._scopeSigC = new WeakMap();
      const memo = this._scopeSigC.get(snap);
      if (memo) return memo;
      let h = 2166136261 >>> 0;
      const mix = (v) => {
        const t = String(v == null ? '' : v);
        for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
        h = Math.imul(h ^ 31, 16777619) >>> 0;
      };
      mix(snap.id); mix(snap.startDate); mix(snap.endDate); mix(snap.importedAt || '');
      (snap.rows || []).forEach(r => {
        mix(r.codigo); mix(r.nome); mix(r.disciplina); mix(r.depth);
        mix(r.questoes); mix(r.acertos);
      });
      const sig = h.toString(36);
      this._scopeSigC.set(snap, sig);
      return sig;
    };
    const chave = perfil + '|' + this.scopeMode + '|' + snaps.map(s => assinar(s)).join('|');
    if (this._scopedC && this._scopedC.chave === chave) return this._scopedC.valor;
    const valor = this.aggregate(snaps);
    this._scopedC = { chave, valor };
    return valor;
  },
  _scopePrefsPatch() {
    return {
      scopeMode: this.scopeMode,
      selectedSnapIds: this.selectedSnapIds ? [...this.selectedSnapIds] : [],
      rangeStart: this.rangeStart || null,
      rangeEnd: this.rangeEnd || null
    };
  },
  /* Mudança de escopo: em cliques de retrato, o painel permanece no DOM e
     na mesma posição. O mini-spinner pinta antes do cálculo pesado. */
  _invalidarEscopo() {
    this.savePrefs(this._scopePrefsPatch());
    this._scopedC = null;
    this._planoRefC = null;
    if (typeof PlanoEngine !== 'undefined') {
      PlanoEngine._agrC = null;
      PlanoEngine._tecScopeSignature = null;
      PlanoEngine._indiceC = new WeakMap();
    }
  },
  _escopoBusy(on) {
    const box = document.getElementById('tec-scope-select');
    if (!box) return;
    box.classList.toggle('is-busy', !!on);
    box.setAttribute('aria-busy', on ? 'true' : 'false');
    const el = box.querySelector('.tec-scope-busy');
    if (el) el.hidden = !on;
  },
  _sincronizarScopeSelectState(snaps) {
    const box = document.getElementById('tec-scope-select');
    if (!box) return;
    const todos = (snaps || []).length > 0 && this.selectedSnapIds.size === (snaps || []).length;
    box.querySelectorAll('input[data-snap]').forEach(cb => {
      const raw = cb.dataset.snap;
      const id = Number.isFinite(Number(raw)) ? Number(raw) : raw;
      cb.checked = this.selectedSnapIds.has(id);
    });
    const all = box.querySelector('input[data-snap-all]');
    if (all) all.checked = todos;
    const count = box.querySelector('[data-scope-count]');
    if (count) count.textContent = `${this.selectedSnapIds.size} de ${(snaps || []).length} selecionado(s)`;
  },
  _syncScopeMeta() {
    try { if (window.PainelRecolhivel) PainelRecolhivel.sincronizar('tec-escopo'); }
    catch (e) { _quiet(e, 'resumo-escopo-tec'); }
    const active = this.activeSnapshots();
    const meta = document.getElementById('tec-snap-meta');
    if (!meta) return;
    if (active.length === 0) meta.textContent = 'Nenhum retrato no escopo atual — ajuste a seleção ou o intervalo.';
    else if (active.length === 1) {
      const s = active[0];
      meta.textContent = `1 retrato · período ${this.rangeLabel(s)}` + (s.label ? ` · ${s.label}` : '');
    } else {
      const starts = active.map(s => s.startDate).sort();
      const ends = active.map(s => s.endDate).sort();
      meta.textContent = `${active.length} retratos consolidados · de ${formatDateShort(starts[0])} a ${formatDateShort(ends[ends.length - 1])} · questões e acertos somados, % recalculado`;
    }
  },
  aplicarMudancaEscopo(opcoes) {
    const opts = opcoes || {};
    this._invalidarEscopo();
    const snaps = DB.getTecSnapshots();
    const pintar = () => {
      if (opts.preservarLista && this.scopeMode === 'select') {
        this._sincronizarScopeSelectState(snaps);
        this._syncScopeMeta();
      } else this.renderScopeControls(snaps);
      this.renderAnalysis();
      if (this.tecTab === 'motor') this.renderMotor();
      else if (this.tecTab === 'incidencia') this.renderIncidencia();
    };
    if (!opts.suave) {
      if (this._scopeRenderTimer) { clearTimeout(this._scopeRenderTimer); this._scopeRenderTimer = null; }
      pintar(); return;
    }
    /* Checkbox de retrato é uma rajada de cliques, não vários pedidos
       independentes de recálculo. O estado visual muda na hora; o cálculo espera
       140 ms após o último clique. Isso mantém a lista/scroll intactos, deixa o
       spinner realmente animar e evita três varreduras completas quando a pessoa
       marca três retratos em sequência. */
    const token = (this._scopeRenderToken || 0) + 1;
    this._scopeRenderToken = token;
    this._escopoBusy(true);
    if (this._scopeRenderTimer) clearTimeout(this._scopeRenderTimer);
    this._scopeRenderTimer = setTimeout(() => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (token !== this._scopeRenderToken) return;
        this._scopeRenderTimer = null;
        try { pintar(); } finally { this._escopoBusy(false); }
      }));
    }, 140);
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
    this._importDataValid = false;
    this._importReadToken = (this._importReadToken || 0) + 1;
    this._fileReading = false;
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
      else {
        warn.style.display = 'none';
        saveBtn.disabled = !!this._fileReading || this._importDataValid === false;
        saveBtn.style.opacity = saveBtn.disabled ? '0.5' : '';
      }
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
    const token = (this._importReadToken || 0) + 1;
    this._importReadToken = token;
    this._fileReading = true;
    this._parsedRows = null;
    this._importDataValid = false;
    this.validateRange();
    const fnEl = document.getElementById('tec-file-name');
    const prev = document.getElementById('tec-import-preview');
    fnEl.style.display = 'inline-flex';
    fnEl.textContent = '📎 ' + file.name;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const ativa = () => this._importReadToken === token;
    const encerraLeitura = () => {
      if (!ativa()) return false;
      this._fileReading = false;
      this.validateRange();
      return true;
    };
    const falhar = (msg, erro) => {
      if (!encerraLeitura()) return;
      this._parsedRows = null;
      this._importDataValid = false;
      this.validateRange();
      if (erro) console.error(erro);
      prev.textContent = msg;
      prev.style.color = 'var(--bad)';
    };
    const finish = (rows) => {
      if (!encerraLeitura()) return;
      this._parsedRows = rows;
      const discs = TecEngine.disciplinas({ rows });
      const val = TecEngine.validarDesempenho(rows);
      this._importDataValid = val.ok && discs.length > 0;
      this.validateRange();
      if (!val.ok) {
        prev.textContent = '⚠ Importação bloqueada: ' + val.erros[0]
          + (val.erros.length > 1 ? ` · mais ${val.erros.length - 1} erro(s)` : '') + '.';
        prev.style.color = 'var(--bad)';
      } else if (discs.length === 0) {
        prev.textContent = '⚠ As linhas foram lidas, mas nenhuma disciplina foi reconhecida. Confira a coluna Hierarquia.';
        prev.style.color = 'var(--bad)';
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
      reader.onerror = () => falhar('⚠ Não consegui ler o arquivo CSV. Tente exportá-lo novamente.');
      reader.readAsText(file);
      return;
    }
    // Fallback via SheetJS (usado só se o leitor embutido falhar OU para .xls antigo).
    // Carrega a biblioteca SOB DEMANDA (não vem no caminho crítico da abertura).
    const trySheetJS = async () => {
      if (!ativa()) return;
      prev.textContent = 'Carregando leitor de planilha…'; prev.style.color = 'var(--text-faint)';
      const ok = await ensureSheetJS();
      if (!ativa()) return;
      if (!ok || typeof XLSX === 'undefined') {
        falhar((ext === 'xls')
          ? '⚠ Formato .xls antigo requer internet. No Excel/Calc, salve como .xlsx e reenvie.'
          : '⚠ Não consegui ler a planilha. Exporte como .csv ou cole os dados manualmente.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        if (!ativa()) return;
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
          falhar('⚠ Erro ao ler o arquivo. Tente exportar como .csv ou cole os dados manualmente.', err);
        }
      };
      reader.onerror = () => falhar('⚠ Não consegui acessar o conteúdo da planilha.');
      reader.readAsArrayBuffer(file);
    };
    if (ext === 'xls') { trySheetJS(); return; } // .xls binário antigo: só via SheetJS
    if (ext === 'xlsx') {
      // Leitor .xlsx EMBUTIDO como PRIMÁRIO: funciona offline e ignora o <dimension>
      // incorreto que faz o SheetJS ler só o cabeçalho (0 linhas). SheetJS vira fallback.
      prev.textContent = 'Lendo planilha…'; prev.style.color = 'var(--text-faint)';
      MiniXLSX.readFirstSheet(file)
        .then((res) => {
          if (!ativa()) return;
          const rows = TecEngine.parseCellRows(res.rows);
          if (rows.length === 0) { trySheetJS(); return; }  // embutido não achou linhas → tenta SheetJS sob demanda
          finish(rows);
        })
        .catch((err) => { if (!ativa()) return; console.error(err); trySheetJS(); });
      return;
    }
    // txt/tsv: lê como texto e usa o parser de colagem
    const reader = new FileReader();
    reader.onload = (e) => finish(TecEngine.parse(e.target.result));
    reader.onerror = () => falhar('⚠ Não consegui ler o arquivo de texto.');
    reader.readAsText(file);
  },
  updateImportPreview() {
    // digitar no textarea descarta o arquivo carregado (a colagem passa a valer)
    this._importReadToken = (this._importReadToken || 0) + 1;
    this._fileReading = false;
    this._parsedRows = null;
    this._importDataValid = false;
    const fn = document.getElementById('tec-file-name');
    fn.style.display = 'none'; fn.textContent = '';
    $id('tec-file-input').value = '';
    const text = $id('tec-import-text').value;
    const rows = TecEngine.parse(text);
    const discs = TecEngine.disciplinas({ rows });
    const prev = document.getElementById('tec-import-preview');
    const val = TecEngine.validarDesempenho(rows);
    if (text.trim() && !val.ok && val.erros.length) {
      prev.textContent = '⚠ Importação bloqueada: ' + val.erros[0]
        + (val.erros.length > 1 ? ` · mais ${val.erros.length - 1} erro(s)` : '') + '.';
      prev.style.color = 'var(--bad)';
      this.validateRange();
      return;
    }
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
      this.validateRange();
      return;
    }
    const tot = TecEngine.totais({ rows });
    if (discs.length === 0) {
      prev.textContent = '⚠ ' + rows.length + ' linha(s) lida(s), mas nenhuma DISCIPLINA foi reconhecida. '
        + 'No export do TecConcursos a linha da disciplina vem com a coluna "Hierarquia" VAZIA — só os tópicos têm código (01, 01.01). '
        + 'Verifique se essa coluna foi copiada junto.';
      prev.style.color = 'var(--bad)';
      this.validateRange();
      return;
    }
    if (tot.questoes === 0) {
      prev.textContent = '⚠ ' + discs.length + ' disciplina(s) reconhecida(s), mas nenhuma questão. '
        + 'Confira se as colunas de "Questões Resolvidas" e "% de acertos" vieram no que foi colado.';
      prev.style.color = 'var(--bad)';
      this.validateRange();
      return;
    }
    this._importDataValid = true;
    this.validateRange();
    prev.textContent = `✓ ${discs.length} disciplina(s), ${rows.length} linha(s) · ${tot.questoes.toLocaleString('pt-BR')} questões · ${tot.pct}% de acerto geral`;
    prev.style.color = 'var(--good)';
  },
  saveImport() {
    if (this._fileReading) { showToast('Aguarde o término da leitura do arquivo'); return; }
    if (!this.validateRange()) { showToast('Ajuste o intervalo de datas antes de salvar'); return; }
    // usa os dados do arquivo, se houver; senão o texto colado
    const rows = Array.isArray(this._parsedRows)
      ? this._parsedRows
      : TecEngine.parse($id('tec-import-text').value);
    if (!rows || rows.length === 0) { showToast('Envie um arquivo válido ou cole os dados'); return; }
    const val = TecEngine.validarDesempenho(rows);
    const discs = TecEngine.disciplinas({ rows });
    if (!val.ok || !discs.length) {
      showToast('Importação bloqueada: ' + (val.erros[0] || 'nenhuma disciplina reconhecida'));
      return;
    }
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
    this._importDataValid = false;
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
    document.querySelectorAll('#tec-scope-toggle button').forEach(b =>
      b.classList.toggle('active', b.dataset.scope === this.scopeMode));
    const selPanel = document.getElementById('tec-scope-select');
    const rangePanel = document.getElementById('tec-scope-range');
    selPanel.style.display = this.scopeMode === 'select' ? 'block' : 'none';
    rangePanel.style.display = this.scopeMode === 'range' ? 'block' : 'none';
    if (this.scopeMode === 'select') this.renderScopeSelectPanel(snaps);
    if (this.scopeMode === 'range') this.syncRangeInputs(snaps);
    this._syncScopeMeta();
  },
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
    const todos = snaps.length > 0 && this.selectedSnapIds.size === snaps.length;
    box.innerHTML = `
      <div class="tec-scope-actions">
        <span class="tec-scope-busy" hidden><i></i> Atualizando análise…</span>
        <span class="hint" data-scope-count style="margin:0 0 0 auto;">${this.selectedSnapIds.size} de ${snaps.length} selecionado(s)</span>
      </div>
      <div class="tec-scope-list">
        <label class="tec-snap-pick tec-snap-all">
          <input type="checkbox" data-snap-all ${todos ? 'checked' : ''}>
          <span class="tsp-main"><b>Todos os retratos</b><small>Usar todo o histórico importado</small></span>
          <span class="tsp-stats">${snaps.length} retrato(s)</span>
        </label>
        ${rows}
      </div>`;
    const list = box.querySelector('.tec-scope-list');
    box.querySelectorAll('input[data-snap]').forEach(cb => cb.addEventListener('change', () => {
      const raw = cb.dataset.snap;
      const id = Number.isFinite(Number(raw)) ? Number(raw) : raw;
      if (cb.checked) this.selectedSnapIds.add(id); else this.selectedSnapIds.delete(id);
      this._sincronizarScopeSelectState(snaps);
      this.aplicarMudancaEscopo({ preservarLista: true, suave: true });
    }));
    const all = box.querySelector('input[data-snap-all]');
    if (all) all.addEventListener('change', () => {
      if (all.checked) snaps.forEach(s => this.selectedSnapIds.add(s.id)); else this.selectedSnapIds.clear();
      this._sincronizarScopeSelectState(snaps);
      this.aplicarMudancaEscopo({ preservarLista: true, suave: true });
    });
    box.querySelectorAll('.tsp-del').forEach(btn => btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = parseInt(btn.closest('.tec-snap-pick').dataset.id, 10);
      const s = DB.getTecSnapshots().find(x => x.id === id);
      if (!s) return;
      UI.confirm(`Excluir o retrato do período ${this.rangeLabel(s)}${s.label ? ' (' + s.label + ')' : ''}? Essa ação não pode ser desfeita.`, { title: 'Excluir retrato', okText: 'Excluir', danger: true }).then(ok => {
        if (!ok) return;
        const foto = PlanoCiclo.fotoDoProgresso();
        DB.deleteTecSnapshot(id);
        this.selectedSnapIds.delete(id);
        PlanoEngine._agrC = null;
        const repin = PlanoCiclo.repinarProgresso(foto);
        showToast('Retrato excluído' + (repin ? ' · progresso de ' + repin + ' atividade(s) preservado' : ''));
        this.render();
      });
    }));
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
      if (wrap) wrap.querySelectorAll('#tec-totais, #tec-disc-list').forEach(el => { if (el) el.innerHTML = ''; });
      const t = document.getElementById('tec-totais'); if (t) t.innerHTML = '<div class="evo-empty-mini" style="grid-column:1/-1;">Nenhum retrato no escopo atual. Ajuste a seleção ou o intervalo de datas acima.</div>';
      return;
    }
    this.renderTotais(snap);
    this.renderDisciplinas(snap);
  },
  // ---- Abas (Análise / Incidência / Reforço) ----
  tecTab: 'analise',
  switchTecTab(tab) {
    this.tecTab = tab;
    document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(b => b.classList.toggle('active', b.dataset.tectab === tab));
    ['analise', 'incidencia', 'motor'].forEach(t => {
      const el = document.getElementById('tec-panel-' + t);
      if (el) el.style.display = (t === tab) ? 'block' : 'none';
    });
    if (tab === 'analise') this.renderAnalysis();
    if (tab === 'incidencia') this.renderIncidencia();
    if (tab === 'motor') this.renderMotor();
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
  /* ── A ATIVIDADE E A UNIDADE PODEM TER TAMANHOS DIFERENTES ────────────────
     Casar por nome exato basta enquanto unidade e assunto são a mesma coisa.
     Com o agrupamento ligado deixam de ser: a atividade nasceu em "Dispensa" e
     a linha da tela agora se chama "Licitações · bloco". Sem este casamento a
     tela mostraria "+ Atividade" numa unidade que JÁ tem atividade aberta, e a
     segunda nasceria duplicando o trabalho da primeira — o mesmo assunto
     contado duas vezes na sua semana. Vale nos dois sentidos, porque a lente
     pode ter mudado depois da criação. */
  _casaUnidade(origem, item) {
    if (!origem || !item) return false;
    if (this._casaTopico(origem, item.nome, item.disciplina)) return true;
    const a = ReforcoEngine.norm(origem.disciplina || ''), b = ReforcoEngine.norm(item.disciplina || '');
    if (a && b && a !== b) return false;
    const kt = ReforcoEngine.norm(origem.topico || '');
    if (item.membros && item.membros.length > 1 && item.membros.some(n => ReforcoEngine.norm(n) === kt)) return true;
    const mb = (origem.escopo && origem.escopo.membros) || null;
    const kn = ReforcoEngine.norm(item.nome || '');
    return !!(mb && mb.length > 1 && mb.some(n => ReforcoEngine.norm(n) === kn));
  },
  /* A unidade do Plano correspondente a um nome — é dela que saem os membros de
     um bloco e o custo estimado. Um lugar só: a busca estava escrita duas vezes
     dentro da mesma função, e agora serve também o portão de confirmação. */
  _unidadeDoPlano(topico, disciplina) {
    const r0 = this._planoRef();
    return [].concat((r0 && r0.itens) || [], (r0 && r0.pequenas) || [])
      .find(t => this._casaTopico({ topico: t.nome, disciplina: t.disciplina }, topico, disciplina)) || null;
  },
  /* ── O PORTÃO DA SOBREPOSIÇÃO ─────────────────────────────────────────────
     Bloquear seria errado: atacar um subtópico específico dentro de uma frente
     já aberta é estudo normal. Criar em silêncio também: a dobra de volume
     rebaixa a calibragem e, com ela, o custo de TODO assunto do Plano. Então a
     tela pergunta, dizendo qual atividade cobre qual e o que a dobra custa. */
  async _confirmarSobreposicao(topico, disciplina) {
    const u = this._unidadeDoPlano(topico, disciplina);
    const so = PlanoEngine.atividadeSobreposta(topico, disciplina, u && u.membros);
    if (!so) return true;
    const dela = so.extra.titulo || so.noDela;
    const frase = (so.relacao === 'cobre')
      ? `A atividade aberta <b>${escapeHtml(dela)}</b> mede <b>${escapeHtml(so.noDela)}</b>, que <b>contém</b> "${escapeHtml(topico)}".`
      : `A atividade aberta <b>${escapeHtml(dela)}</b> mede <b>${escapeHtml(so.noDela)}</b>, que está <b>dentro</b> de "${escapeHtml(topico)}".`;
    return !!(await UI.confirm(
      frase + ' As questões que você resolver vão contar nas <b>duas</b>.<br><br>'
      + 'Nas barras de progresso isso é justo — cada uma mede o escopo que declarou. '
      + 'Na <b>calibragem</b> não: o mesmo volume entra duas vezes no total, e o '
      + '"questões por ponto" que o Plano aprende com você sai <b>subestimado</b>, '
      + 'rebaixando o custo estimado de todo assunto.<br><br>'
      + 'Se a ideia é mesmo afunilar, considere encerrar a atividade mais ampla primeiro.',
      { title: 'Duas atividades, as mesmas questões', okText: 'Criar assim mesmo', html: true }));
  },
  // `lote` = criação em série: sem aviso por item e sem repintar a cada um.
  // Devolve true quando a atividade nasceu, para o chamador contar.
  /* `sugerido` é a frente como o Motor a devolveu (margem, bloco, membros).
     Ela é opcional: o portão continua servindo a quem cria uma atividade
     direto de um nó da árvore, sem passar pela fila. */
  criarExtraDoPlano(topico, disciplina, alvo, motivo, lote, sugerido) {
    /* Só uma atividade ABERTA bloqueia. Uma já encerrada é história: o assunto
       pode ter voltado a cair — e no caso do veredito "não funcionou" ele
       PRECISA de um ataque novo, de outro tipo. Recusar por causa dela
       trancava justamente o assunto que mais pede uma segunda tentativa. */
    /* A unidade do Plano vem ANTES da trava: é dela que sai a lista de tópicos
       que um bloco cobre, e sem ela a trava não veria a atividade aberta em um
       membro. Ela também é o item que a origem lê para gravar o escopo. */
    const alvoTop = sugerido || this._unidadeDoPlano(topico, disciplina);
    const unidade = alvoTop || { nome: topico, disciplina: disciplina || '' };
    const jaTem = DB.getExtras().find(e => e.status !== 'concluida' && this._casaUnidade(e.origemPlano, unidade));
    if (jaTem) { if (!lote) showToast('Já existe uma atividade em aberto para "' + topico + '"'); return false; }
    /* SOBREPOSIÇÃO DE ESCOPO. Em série a regra é a da duplicata: não cria e o
       chamador conta. No clique, quem decide é a pessoa — e ela decide ANTES,
       no portão de confirmação (`_confirmarSobreposicao`), porque aqui não há
       como esperar por um diálogo sem tornar toda a criação assíncrona. */
    if (lote && PlanoEngine.atividadeSobreposta(topico, disciplina, unidade.membros)) return false;
    const diag = motivo === 'diagnostico';
    const e = DB.addExtra({
      titulo: PlanoCiclo.titulo(topico, motivo, unidade.membros),
      tipo: 'questoes',
      disciplina: disciplina || '',
      unidade: 'questoes',
      alvo: Math.max(1, parseInt(alvo, 10) || 30),
      periodo: 'unica',
      contaMetricas: false,
      obs: diag
        ? 'Gerado pelo Motor: amostra insuficiente. Resolva estas questões para saber se é fraqueza real.'
        : 'Gerado pelo Motor de sugestão. Ao importar o próximo retrato do TEC, a métrica dirá se o assunto saiu da fila.'
    });
    if (e) {
      // um só lugar monta a origem: os dois portões gravam exatamente o mesmo
      DB.updateExtra(e.id, { origemPlano: PlanoCiclo.origem(topico, disciplina, alvoTop, { motivo: motivo || 'reforco' }) });
      if (!lote) {
        showToast('Atividade criada: ' + (diag ? 'diagnosticar ' : 'reforçar ') + topico);
        if (this.tecTab === 'motor') this.renderMotor();
      }
      return true;
    }
    return false;
  },
  /* ── A ABA DO MOTOR ──────────────────────────────────────────────────────
     A leitura agora é deliberadamente em DOIS PASSOS:
       1) quais matérias concentram a maior lacuna mensurável;
       2) dentro de cada uma, qual tópico é o melhor filtro executável.
     Disciplina é contexto de prioridade; atividade sempre nasce em tópico ou
     subtópico. Isso evita transformar "matéria fraca" em caderno da matéria
     inteira e deixa a decisão auditável contra a árvore da Análise. */
  renderMotor() {
    const host = document.getElementById('motor-lista');
    const fase = document.getElementById('motor-fase');
    if (!host) return;
    const p = MotorSugestao.prefs();
    if (fase) {
      const b = (k, rot, sub) => `<button type="button" data-fase="${k}" class="${p.fase === k ? 'active' : ''}" aria-pressed="${p.fase === k}"><b>${rot}</b><span>${sub}</span></button>`;
      fase.innerHTML = b('pre', 'Pré-edital', 'Pior recorte mensurável primeiro')
        + b('pos', 'Pós-edital', 'Fraqueza ponderada pela incidência');
    }
    try { TecAjustes.sincronizar('motor'); } catch (e) { _quiet(e, 'motor-resumo'); }

    let r = null;
    try { r = MotorSugestao.calcular(); } catch (e) { _quiet(e, 'motor-calcular'); }
    if (!r || r.erro) {
      const msg = {
        'sem-retrato': 'Importe um retrato do TecConcursos na aba 📊 Análise para o motor ter o que ler.',
        'sem-arvore': 'O retrato em escopo não tem árvore de tópicos.',
        'sem-incidencia': 'O pós-edital precisa da incidência da banca. Importe-a na aba 🏛️ Incidência ou volte para o pré-edital.'
      }[(r && r.erro) || ''] || 'Não foi possível calcular agora.';
      host.innerHTML = `<p class="wd-empty" style="padding:18px 0;">${escapeHtml(msg)}</p>`;
      return;
    }
    if (!r.itens.length) {
      host.innerHTML = `<div class="ms-empty-honesto"><span>🧭</span><div><b>Nenhum recorte confiável para atacar agora</b><p>O motor não vai transformar uma disciplina inteira em tarefa. Com a margem atual de ±${r.prefs.margemMax}pp, nenhum tópico abaixo da meta de ${r.prefs.metaAcerto}% tem amostra suficiente. Acumule mais questões ou revise a régua em ⚙ Ajustes.</p></div></div>`;
      return;
    }

    const fmt1 = v => Math.round(Number(v || 0) * 10) / 10;
    const tom = x => {
      const e = Number(x && x.taxaErro || 0);
      return e >= 50 ? 'critico' : e >= 35 ? 'alto' : e >= 20 ? 'medio' : 'leve';
    };
    const emoji = x => ({ critico: '🚨', alto: '🔥', medio: '⚠️', leve: '📌' }[tom(x)]);
    const discTop = (r.disciplinas || []).slice(0, r.itens.length);

    const disciplinasHtml = discTop.map((d, i) => {
      const top = d.melhorTopico;
      const ac = d.taxa == null ? '—' : fmt1(d.taxa) + '%';
      return `
        <article class="ms-priority-card tone-${tom(top)}">
          <div class="ms-priority-icon">${emoji(top)}</div>
          <div class="ms-priority-body">
            <div class="ms-priority-eyebrow">Prioridade ${i + 1} · ${escapeHtml(r.criterioDisciplinas || '')}</div>
            <h3>${escapeHtml(d.nome)}</h3>
            <p>Pior recorte acionável: <b>${escapeHtml(top ? top.nome : '—')}</b> · ${top ? fmt1(top.taxa) + '% de acerto' : '—'}</p>
            <div class="ms-priority-meta">
              <span><i>disciplina</i><b>${ac}</b></span>
              <span><i>resolvidas</i><b>${d.questoes.toLocaleString('pt-BR')}</b></span>
              <span><i>fila</i><b>${(d.fila || []).length} frente(s)</b></span>
            </div>
          </div>
        </article>`;
    }).join('');

    const linhas = r.itens.map((x, i) => {
      const erroPct = fmt1(x.taxaErro);
      const margem = x.margem == null ? '—' : '±' + fmt1(x.margem) + 'pp';
      const trilha = [x.disciplina].concat(x.caminho || []).filter(Boolean);
      const porQue = x.agregado
        ? `Agrupamento local de ${x.membros.length} irmãos sob “${x.pai || 'o mesmo tópico'}”. Separados, eram pequenos demais; juntos sustentam a medida.`
        : x.motivoNivel === 'subnivel-insuficiente'
          ? 'O nível abaixo ficou pequeno demais para medir com segurança. O motor subiu somente até este tópico.'
          : 'A amostra deste nível já sustenta o percentual; não há motivo estatístico para subir a árvore.';
      const membros = x.agregado
        ? `<div class="ms-members">${x.membros.map(n => `<span>${escapeHtml(n)}</span>`).join('')}</div>`
        : '';
      const peso = r.fase === 'pos'
        ? `<span><i>incidência</i><b>${x.peso}</b></span>`
        : `<span><i>amostra</i><b>${x.questoes}</b></span>`;
      return `
        <article class="ms-suggestion-card tone-${tom(x)}" data-i="${i}">
          <div class="ms-suggestion-head">
            <div class="ms-suggestion-rank"><span>${i + 1}</span><i>${emoji(x)}</i></div>
            <div class="ms-suggestion-title">
              <small>${trilha.map(escapeHtml).join(' › ')}</small>
              <h3>${escapeHtml(x.nome)}</h3>
              <div class="ms-level-badges">
                <span>Nível ${x.nivel}</span>
                ${x.agregado ? '<span class="is-group">bloco de irmãos</span>' : '<span>recorte direto</span>'}
              </div>
            </div>
            <div class="ms-dose"><b>${x.dose}</b><small>questões</small></div>
          </div>
          ${membros}
          <div class="ms-suggestion-metrics">
            <span><i>acerto</i><b>${fmt1(x.taxa)}%</b></span>
            <span><i>erro</i><b>${erroPct}%</b></span>
            <span><i>histórico</i><b>${x.questoes} q</b></span>
            <span><i>margem</i><b>${margem}</b></span>
            ${peso}
          </div>
          <div class="ms-why"><span>💡</span><p><b>Por que este nível?</b> ${escapeHtml(porQue)}</p></div>
          <div class="ms-suggestion-action">
            <button type="button" class="btn-primary" data-motor-extra="${i}">Criar reforço de ${x.dose} questões</button>
          </div>
        </article>`;
    }).join('');

    const discRank = (r.disciplinas || []).map((d, i) => {
      const t = d.melhorTopico;
      return `<li><span>${i + 1}</span><div><b>${escapeHtml(d.nome)}</b><small>${t ? fmt1(t.taxa) + '% no pior recorte · ' + escapeHtml(t.nome) : 'sem recorte acionável'} · ${(d.fila || []).length} frente(s) na fila</small></div></li>`;
    }).join('');

    const filas = (r.disciplinas || []).map(d => {
      const itens = (d.fila || []).slice(0, 15).map((x, i) =>
        `<li><span>${i + 1}</span><div><b>${escapeHtml(x.nome)}</b><small>${fmt1(x.taxa)}% acerto · nível ${x.nivel}${x.agregado ? ' · bloco de ' + x.membros.length + ' irmãos' : ''}</small></div></li>`
      ).join('');
      return `<section class="ms-queue-group"><h4>${escapeHtml(d.nome)}</h4><ol>${itens}</ol></section>`;
    }).join('');

    const somaDose = r.itens.reduce((s, x) => s + Number(x.dose || 0), 0);
    host.innerHTML = `
      <div class="ms-rule-summary">
        <span>🧭 ${r.itens.length} disciplinas agora</span>
        <span>🧩 1 frente de cada</span>
        <span>📚 ${r.prefs.doseMin}+ questões por atividade</span>
        <span>📏 margem ±${r.prefs.margemMax}pp</span>
        <span>🎯 meta ${r.prefs.metaAcerto}%</span>
      </div>

      <section class="ms-stage">
        <header><span>1</span><div><b>Onde entrar primeiro</b><small>Disciplinas ordenadas pela regra do motor. A disciplina só escolhe a porta; nunca vira atividade.</small></div></header>
        <div class="ms-priority-list">${disciplinasHtml}</div>
      </section>

      <section class="ms-stage">
        <header><span>2</span><div><b>Atacar agora</b><small>O primeiro recorte da fila hierárquica de cada disciplina, sempre do pior para o melhor.</small></div></header>
        <div class="ms-suggestion-list">${linhas}</div>
        <p class="ms-round-total">Se executar as ${r.itens.length} sugestões: <b>${somaDose} questões</b>. Nenhuma atividade pode nascer com menos de ${r.prefs.doseMin}.</p>
      </section>

      <div class="ms-rankings">
        <details>
          <summary><span>📊 Ranking de disciplinas</span><small>${(r.disciplinas || []).length} com frente acionável</small><i>⌄</i></summary>
          <ol class="ms-rank-list">${discRank}</ol>
        </details>
        <details>
          <summary><span>🧬 Filas hierárquicas por disciplina</span><small>pior → melhor, sem misturar árvores</small><i>⌄</i></summary>
          <div class="ms-queue-wrap">${filas}</div>
        </details>
      </div>
      <p class="hint ms-nota">Regra estrutural: subtópicos pequenos só podem ser agrupados com irmãos do mesmo pai. Se esse bloco ainda não for confiável, o motor sobe um nível dentro da matéria. A fronteira da disciplina nunca é atravessada.</p>`;

    host.querySelectorAll('[data-motor-extra]').forEach(b => b.addEventListener('click', () => {
      const x = r.itens[Number(b.dataset.motorExtra)];
      if (!x) return;
      this.criarExtraDoPlano(x.nome, x.disciplina, x.dose, 'reforco', false, x);
    }));
  },
  _incidParsed: null,
  renderIncidencia(opcoes) {
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
    const preservarBancaPicker = !!(opcoes && opcoes.preservarBancaPicker);
    const bancaHost = document.getElementById('incid-banca-pick');
    if (!preservarBancaPicker || !bancaHost || !bancaHost.querySelector('.banca-pick-panel')) this.renderBancaPicker('incid-banca-pick');
    else this._sincronizarBancaPicker(bancaHost);
    /* A lista mostra as bancas ESCOLHIDAS. Com mais de uma marcada, o resumo do
       topo soma as duas — é o número que o Reforço e o Plano vão usar, e vê-lo
       aqui é a única forma de conferir se a soma faz sentido. */
    const sel = this.bancasSelecionadas();
    const filtro = ReforcoEngine.filtroBanca(this.bancaFiltro());
    const bancas = sel.length ? todasBancas.filter(b => ReforcoEngine._daBanca(filtro, b)) : todasBancas;
    const resumoEl = document.getElementById('incid-selecao-resumo');
    if (resumoEl) {
      if (!sel.length) {
        resumoEl.innerHTML = `<p class="incid-selecao">Somando <b>todas as ${todasBancas.length} bancas</b> importadas. Marque as suas no seletor acima para o 🧭 Motor, no pós-edital, priorizar só o que elas cobram.</p>`;
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
    const erros = Math.max(0, (node.questoes || 0) - (node.acertos || 0));
    const pctErro = Math.round((100 - pct) * 10) / 10;
    const lvl = Math.min(5, Math.max(0, level)); // classe só preserva compatibilidade de espaçamento
    const hue = (255 + Math.max(0, level) * 47) % 360; // 47 evita repetir tons nos níveis seguintes
    return `
      <div class="tnode lvl${lvl}" data-level="${level}" data-haskids="${hasKids ? '1' : '0'}" style="--tec-level-hue:${hue}">
        <div class="tnode-row ${hasKids ? 'has-kids' : ''}" style="padding-left:${indent}px;">
          ${caret}
          <span class="${nameCls}" title="${escapeHtml(node.nome)}"><span class="tnode-label">${escapeHtml(node.nome)}</span>${delta}</span>
          <span class="tnode-q" title="Questões resolvidas"><b>${node.questoes}</b><small>questões</small></span>
          <div class="tnode-track" title="${pct}% de acerto · ${pctErro}% de erro"><div class="tnode-fill" style="width:${pct}%;"></div></div>
          <span class="tnode-pct">
            <span class="tnode-stat is-good"><b>${pct}%</b><i>${node.acertos} ac.</i></span>
            <span class="tnode-stat is-bad"><b>${pctErro}%</b><i>${erros} er.</i></span>
          </span>
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
    const kids = this._ordenarNos(reg.node.children);
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
  discFilter: '__todas__', // compatibilidade: uma seleção = nome; várias/nenhuma = __todas__
  discFilters: null,           // [] = todas; [a,b,...] = recorte múltiplo persistido
  /* ── A ORDEM VALE PARA A ÁRVORE INTEIRA ─────────────────────────────────
     Ordenar só o primeiro nível responde "qual disciplina vai mal" e para aí:
     para saber O QUE nela vai mal é preciso abrir e ler tópico por tópico.
     Aplicando a mesma ordem em cada nível, abrir a disciplina mais fraca leva
     direto ao tópico mais fraco dela, e dali ao subtópico. */
  treeOrdem: 'fracos',
  _ordenarNos(arr) {
    const lista = (arr || []).slice();
    if (this.treeOrdem === 'indice') {
      return lista.sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true }));
    }
    const dir = this.treeOrdem === 'fortes' ? -1 : 1;
    return lista.sort((a, b) => dir * (this.nodePct(a) - this.nodePct(b)) || b.questoes - a.questoes);
  },
  _discSelecionadas(forest) {
    const nomes = new Map((forest || []).map(d => [ReforcoEngine.norm(d.nome), d.nome]));
    const base = Array.isArray(this.discFilters) ? this.discFilters : [];
    const limpas = [];
    const vistos = new Set();
    base.forEach(n => {
      const real = nomes.get(ReforcoEngine.norm(n));
      const k = real && ReforcoEngine.norm(real);
      if (!real || vistos.has(k)) return;
      vistos.add(k); limpas.push(real);
    });
    this.discFilters = limpas;
    this.discFilter = limpas.length === 1 ? limpas[0] : '__todas__';
    return limpas;
  },
  _sincronizarDiscPicker(host, selecionadas) {
    if (!host) return false;
    const btn = host.querySelector('.tec-disc-pick-btn');
    const panel = host.querySelector('.tec-disc-pick-panel');
    if (!btn || !panel) return false;
    const selNorm = new Set((selecionadas || []).map(ReforcoEngine.norm));
    panel.querySelectorAll('input[type="checkbox"]').forEach(ch => {
      ch.checked = selNorm.has(ReforcoEngine.norm(ch.value));
    });
    const rot = !selecionadas.length ? 'Todas as disciplinas'
      : selecionadas.length === 1 ? selecionadas[0]
      : selecionadas.length + ' disciplinas selecionadas';
    const label = btn.querySelector('.tec-disc-pick-label');
    if (label) label.textContent = rot;
    const count = btn.querySelector('.tec-disc-pick-count');
    if (count) {
      count.textContent = selecionadas.length ? String(selecionadas.length) : 'Todas';
      count.classList.toggle('is-all', !selecionadas.length);
    }
    const todas = panel.querySelector('[data-disc-acao="todas"]');
    if (todas) {
      todas.classList.toggle('is-active', !selecionadas.length);
      todas.setAttribute('aria-pressed', !selecionadas.length ? 'true' : 'false');
    }
    const foot = panel.querySelector('.tec-disc-pick-foot');
    if (foot) foot.innerHTML = '<span>' + (selecionadas.length
      ? selecionadas.length + ' disciplina(s) no recorte.'
      : 'Todas as disciplinas estão visíveis.') + '</span>';
    return true;
  },
  _setDiscFilters(lista, panel) {
    const limpa = [...new Set((lista || []).filter(Boolean))];
    this.discFilters = limpa;
    this.discFilter = limpa.length === 1 ? limpa[0] : '__todas__';
    this.savePrefs({ discFilters: limpa });
    const host = document.getElementById('tec-disc-pick');
    const y = panel ? panel.scrollTop : 0;
    this._sincronizarDiscPicker(host, limpa);
    const snap = this.scopedSnapshot();
    if (snap) this.renderDisciplinas(snap, { preservarPicker: true });
    if (panel) {
      panel.removeAttribute('hidden');
      const btn = host && host.querySelector('.tec-disc-pick-btn');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      panel.scrollTop = y;
    }
  },
  renderDiscPicker(alpha, selecionadas) {
    const host = document.getElementById('tec-disc-pick');
    if (!host) return;
    const marcada = n => (selecionadas || []).some(x => ReforcoEngine.norm(x) === ReforcoEngine.norm(n));
    host.innerHTML = `
      <button type="button" class="tec-disc-pick-btn" aria-expanded="false">
        <span class="tec-disc-pick-main"><span class="tec-disc-pick-label"></span><small>combine várias matérias sem sair da lista</small></span>
        <span class="tec-disc-pick-count"></span><span class="chev">▾</span>
      </button>
      <div class="tec-disc-pick-panel" hidden>
        <div class="tec-disc-pick-search-wrap">
          <span>⌕</span><input type="search" class="tec-disc-pick-search" placeholder="Buscar disciplina" autocomplete="off">
        </div>
        <div class="tec-disc-pick-list">
          <button type="button" class="tec-disc-pick-all ${selecionadas.length ? '' : 'is-active'}" data-disc-acao="todas" aria-pressed="${selecionadas.length ? 'false' : 'true'}">
            <span class="tec-disc-all-mark">✓</span><span><b>Todas as disciplinas</b><small>Exibir a árvore completa</small></span>
          </button>
          ${alpha.map(d => `<label class="tec-disc-pick-item" data-s="${escapeHtml(ReforcoEngine.norm(d.nome))}">
            <input type="checkbox" value="${escapeHtml(d.nome)}" ${marcada(d.nome) ? 'checked' : ''}>
            <span><b>${escapeHtml(d.nome)}</b><small>${d.questoes.toLocaleString('pt-BR')} questões · ${this.nodePct(d)}% de acerto</small></span>
          </label>`).join('')}
        </div>
        <div class="tec-disc-pick-foot"></div>
      </div>`;
    const btn = host.querySelector('.tec-disc-pick-btn');
    const panel = host.querySelector('.tec-disc-pick-panel');
    const search = host.querySelector('.tec-disc-pick-search');
    btn.onclick = (e) => {
      e.stopPropagation();
      const abrir = panel.hasAttribute('hidden');
      document.querySelectorAll('.banca-pick-panel,.tec-disc-pick-panel').forEach(p => {
        if (p !== panel) p.setAttribute('hidden', '');
      });
      document.querySelectorAll('.banca-pick-btn,.tec-disc-pick-btn').forEach(b => {
        if (b !== btn) b.setAttribute('aria-expanded', 'false');
      });
      if (abrir) { panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); if (search) search.focus({ preventScroll: true }); }
      else { panel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); }
    };
    panel.onclick = e => e.stopPropagation();
    panel.onchange = e => {
      if (!e.target.matches('input[type="checkbox"]')) return;
      const lista = [...panel.querySelectorAll('.tec-disc-pick-item input[type="checkbox"]:checked')].map(x => x.value);
      this._setDiscFilters(lista, panel);
    };
    const todas = panel.querySelector('[data-disc-acao="todas"]');
    if (todas) todas.onclick = () => this._setDiscFilters([], panel);
    if (search) search.oninput = () => {
      const q = ReforcoEngine.norm(search.value);
      panel.querySelectorAll('.tec-disc-pick-item').forEach(item => {
        item.style.display = !q || (item.dataset.s || '').includes(q) ? '' : 'none';
      });
    };
    this._sincronizarDiscPicker(host, selecionadas || []);
  },
  renderDisciplinas(snap, opcoes) {
    const preservarPicker = !!(opcoes && opcoes.preservarPicker);
    const container = document.getElementById('tec-disc-list');
    const focusEl = document.getElementById('tec-disc-focus');
    const pickerHost = document.getElementById('tec-disc-pick');
    let forest = this._ordenarNos(TecEngine.buildTree(snap));
    const prevIdx = this.parIndices();
    if (forest.length === 0) {
      focusEl.innerHTML = '';
      container.innerHTML = `<p class="wd-empty" style="padding:12px 0;">Sem dados neste retrato.</p>`;
      if (pickerHost) pickerHost.innerHTML = '<button class="tec-disc-pick-btn" disabled><span class="tec-disc-pick-main"><span class="tec-disc-pick-label">Sem disciplinas</span></span></button>';
      return;
    }

    const alpha = forest.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const selecionadas = this._discSelecionadas(forest);
    if (!preservarPicker || !pickerHost || !pickerHost.querySelector('.tec-disc-pick-panel')) this.renderDiscPicker(alpha, selecionadas);
    else this._sincronizarDiscPicker(pickerHost, selecionadas);

    const selNorm = new Set(selecionadas.map(ReforcoEngine.norm));
    const focused = selecionadas.length > 0;
    const shown = focused ? forest.filter(d => selNorm.has(ReforcoEngine.norm(d.nome))) : forest;

    if (selecionadas.length === 1 && shown.length) {
      const d = shown[0];
      const pct = this.nodePct(d);
      const tone = this.toneOf(pct);
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
          </div>
        </div>`;
    } else if (selecionadas.length > 1) {
      focusEl.innerHTML = `<div class="tec-focus-multi"><b>${selecionadas.length} disciplinas no recorte</b><span>${selecionadas.map(escapeHtml).join(' · ')}</span></div>`;
    } else {
      focusEl.innerHTML = '';
    }

    const toolbar = `
      <div class="tec-tree-toolbar">
        <span class="tec-tree-hint">${selecionadas.length === 1 ? 'Detalhamento por tópico · ' : selecionadas.length > 1 ? selecionadas.length + ' disciplinas combinadas · ' : 'Clique para abrir/fechar cada nível · '}</span>
        <button type="button" class="tec-tree-btn" id="tec-expand-all">⊞ Expandir tudo</button>
        <button type="button" class="tec-tree-btn" id="tec-collapse-all">⊟ Recolher tudo</button>
      </div>`;
    this._lazyReg.clear();
    container.innerHTML = toolbar + `<div class="tec-tree">${shown.map(d => this.treeNodeHtml(d, prevIdx, 0)).join('')}</div>`;
    if (selecionadas.length === 1) container.querySelectorAll('.tnode.lvl0[data-haskids="1"]').forEach(n => {
      n.classList.add('open');
      this._hydrate(n.querySelector(':scope > .tnode-children'));
    });

    // O contêiner é persistente; atribuir o handler evita acumular listeners a cada filtro.
    container.onclick = (e) => {
      const exp = e.target.closest('#tec-expand-all');
      if (exp) {
        this._hydrateAll(container);
        container.querySelectorAll('.tnode[data-haskids="1"]').forEach(n => n.classList.add('open'));
        return;
      }
      const col = e.target.closest('#tec-collapse-all');
      if (col) {
        container.querySelectorAll('.tnode[data-haskids="1"]').forEach(n => n.classList.remove('open'));
        return;
      }
      const row = e.target.closest('.tnode-row.has-kids');
      if (!row || !container.contains(row)) return;
      e.stopPropagation();
      const nodeEl = row.closest('.tnode');
      const box = nodeEl.querySelector(':scope > .tnode-children');
      if (!nodeEl.classList.contains('open')) this._hydrate(box);
      nodeEl.classList.toggle('open');
    };
  }
};

// Um toque fora fecha os seletores flutuantes sem reconstruí-los.
document.addEventListener('click', () => {
  document.querySelectorAll('.banca-pick-panel,.tec-disc-pick-panel').forEach(p => p.setAttribute('hidden', ''));
  document.querySelectorAll('.banca-pick-btn,.tec-disc-pick-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
});

// Listeners da tela Desempenho TEC
$id('tec-btn-first-import').addEventListener('click', () => DesempenhoTecScreen.openImport());
$id('tec-btn-new-import').addEventListener('click', () => DesempenhoTecScreen.openImport());
$id('tec-import-cancel').addEventListener('click', () => DesempenhoTecScreen.render());
$id('tec-import-save').addEventListener('click', () => DesempenhoTecScreen.saveImport());
$id('tec-import-text').addEventListener('input', () => DesempenhoTecScreen.updateImportPreview());
// validação do intervalo de datas (sem sobreposição)
$id('tec-import-start').addEventListener('change', () => DesempenhoTecScreen.validateRange());
$id('tec-import-end').addEventListener('change', () => DesempenhoTecScreen.validateRange());
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
  DesempenhoTecScreen.aplicarMudancaEscopo();
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
    DesempenhoTecScreen.aplicarMudancaEscopo();
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
  DesempenhoTecScreen.aplicarMudancaEscopo();
}));
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
  /* A fita de abas usa UM ouvinte delegado, não um por botão: a aba
     ⚙ Modelos é criada depois desta linha rodar (a central dos motores a
     injeta), e um ouvinte por botão simplesmente não a alcançava — ela ficava
     com o clique síncrono próprio, a única sem o adiamento. */
  const fita = document.getElementById('tec-subtabs');
  if (fita) fita.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest('.tec-subtab') : null;
    if (!b || !fita.contains(b) || !b.dataset.tectab) return;
    DT.trocarAbaPeloToque(b.dataset.tectab);
  });
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

  /* Ordem de exibição da árvore: um clique, um atributo, uma repintura. Ela
     não é um ajuste da folha porque é a pergunta que se troca o tempo todo
     enquanto se lê a lista — esconder isso atrás de ⚙ seria escondê-la. */
  const ordem = document.getElementById('tec-ordem');
  if (ordem) ordem.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ordem]');
    if (!b) return;
    DT.treeOrdem = b.dataset.ordem;
    DT.savePrefs({ treeOrdem: b.dataset.ordem });
    ordem.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    const snap = DT.scopedSnapshot();
    if (snap) DT.renderDisciplinas(snap);
  });

  // Motor de sugestão: fase no painel, parâmetros na folha de ajustes.
  const mf = document.getElementById('motor-fase');
  if (mf) mf.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fase]');
    if (!b) return;
    MotorSugestao.salvar({ fase: b.dataset.fase });
    DT.renderMotor();
  });
  ['motor-margem', 'motor-alvo', 'motor-dosemin', 'motor-frentes', 'motor-meta'].forEach(id => {
    on(id, 'change', (e) => {
      const el = e.target;
      MotorSugestao.salvar({ [el.dataset.cfgKey]: el.value });
      DT.renderMotor();
    });
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
  /* RESTAURAR PADRÕES vale somente para os ajustes do Motor. */
  const reset = document.getElementById('tec-cfg-reset');
  if (reset) reset.addEventListener('click', async () => {
    if (TecAjustes.aba !== 'motor') return;
    if (!await UI.confirm('Voltar todos os ajustes do Motor de sugestão aos valores padrão?', { title: 'Restaurar padrões' })) return;
    MotorSugestao.restaurar();
    TecAjustes.restaurarCampos('motor');
    DT.renderMotor();
    TecAjustes.aplicarCondicionais();
    TecAjustes.sincronizar();
    TecAjustes.marcarPersonalizadas();
    showToast('Ajustes restaurados ✓');
  });
})();
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen !== 'desempenhotec') return;
  DesempenhoTecScreen.render();
});
