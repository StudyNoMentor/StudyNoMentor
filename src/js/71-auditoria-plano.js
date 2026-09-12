/* ═══════════════════════════════════════════════════════════════════════════
   AUDITORIA DO PLANO — o retrato que prova (ou desmente) que o módulo funciona
   ───────────────────────────────────────────────────────────────────────────
   Este arquivo não calcula nada. Ele COLETA: junta num único JSON tudo que é
   preciso para alguém de fora reproduzir cada número da tela do Plano, julgar
   se ele está ajudando de verdade e apontar onde evoluir.

   A regra que define o conteúdo: um dado só entra se, faltando ele, uma
   pergunta de auditoria ficaria sem resposta.

     · os PARÂMETROS entram porque sem eles nenhum número é reproduzível —
       "domínio 78%" não quer dizer nada sem saber a meta, o teto, o piso de
       amostra e a janela que o produziram;
     · a SÉRIE entra porque evolução é a única pergunta que um retrato isolado
       não responde;
     · o CICLO DAS ATIVIDADES entra porque é a única evidência CAUSAL do
       módulo: o Plano mandou atacar, a pessoa atacou, e a medição seguinte
       disse se funcionou. Sem isso, tudo o mais é correlação;
     · a QUALIDADE DO DADO entra porque metade dos diagnósticos errados do
       Plano não são erro de conta: são amostra curta demais para sustentar a
       conta. Um auditor que não vê a mediana de questões por assunto vai
       culpar a fórmula;
     · as INVARIANTES entram porque o arquivo precisa se auto-conferir. Se o
       acumulado não fecha com o domínio mais os ganhos NA HORA DA EXPORTAÇÃO,
       o resto do arquivo não merece confiança, e isso tem de vir escrito;
     · o LEDGER de exportações anteriores entra porque a tendência não pode
       depender de a pessoa ter guardado todos os arquivos.

   O que NÃO entra: nome do perfil, e-mail, qualquer credencial. O arquivo é
   feito para ser enviado a outra pessoa — o que ele carrega é o estudo, não
   a identidade de quem estuda. Quem quiser esconder até os nomes das matérias
   exporta em modo anônimo, e os nomes viram apelidos estáveis (o mesmo assunto
   recebe o mesmo apelido em toda exportação, para dar para comparar).
   ═══════════════════════════════════════════════════════════════════════════ */
const PlanoAuditoria = {
  VERSAO: 1,
  KEY_LEDGER: 'plano-auditoria-ledger',
  MAX_ASSUNTOS: 500,
  MAX_LEDGER: 60,

  _apelido(s) {
    const t = String(s == null ? '' : s);
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
    return 'a' + h.toString(36);
  },
  _num(v, casas) {
    if (v == null || typeof v !== 'number' || !isFinite(v)) return null;
    const f = Math.pow(10, casas == null ? 2 : casas);
    return Math.round(v * f) / f;
  },
  _ledger() { try { return DB._get(this.KEY_LEDGER, []) || []; } catch (e) { _quiet(e, 'aud-ledger'); return []; } },

  /* ── A CONFERÊNCIA DA FONTE ───────────────────────────────────────────────
     O arquivo dizia tudo sobre o que o Plano CALCULOU e nada sobre o que ele
     RECEBEU. Era o ponto cego mais caro: uma importação que conta a mesma
     questão duas vezes produz um domínio, um custo e uma fila inteiramente
     plausíveis — e nenhum número do arquivo denunciaria isso.

     Foi o que aconteceu de verdade. No export do TecConcursos cada disciplina
     termina com uma linha "Sem Classificação" sem código, igual à linha da
     própria disciplina: ela era lida como disciplina NOVA e as questões dela
     entravam duas vezes no total (uma no total da disciplina, que já as inclui,
     e outra como disciplina própria). Medido em dois arquivos reais: 409
     questões no lugar de 400, e 28 disciplinas no lugar de 20. Ao mesmo tempo,
     o Plano só olha linhas de profundidade > 0 e simplesmente não via esse
     volume — a Análise dizia 409 e o Plano trabalhava com 391.

     Daí estes três números por retrato: o total das DISCIPLINAS, o total das
     FOLHAS e a soma CRUA de todas as linhas. Os dois primeiros têm de ser
     iguais; o terceiro é a armadilha (nos arquivos reais ele dá 3,2× o total) e
     vem escrito para que ninguém precise descobrir isso de novo. */
  _conferirImportacao(snaps, nm) {
    const N = (v) => this._num(v, 0);
    return (snaps || []).map(s => {
      const rows = (s && s.rows) || [];
      const discs = rows.filter(r => (r.depth || 0) === 0);
      let folhas = [];
      try { folhas = PlanoEngine._folhas(s, true) || []; } catch (e) { _quiet(e, 'aud-folhas'); }
      const somaQ = (arr) => arr.reduce((a, r) => a + (r.questoes || 0), 0);
      const somaAc = (arr) => arr.reduce((a, r) => a + (r.acertos || 0), 0);
      const qDisc = somaQ(discs), acDisc = somaAc(discs);
      const qFolha = somaQ(folhas), acFolha = somaAc(folhas);
      const chaves = discs.map(r => ReforcoEngine.norm(r.nome || ''));
      /* A taxa de cada linha tem de ser reproduzível a partir das duas
         contagens. A coluna "Acertos (%)" do arquivo é arredondada para
         exibição; se ela vazar para o cálculo, o corte dos pontos fracos passa
         a comparar limiares contra um número que não é o número. */
      /* Só as linhas que DECLARAM uma taxa entram: ausência não é divergência.
         Um retrato guardado por uma versão antiga (ou vindo do backup) pode não
         ter o campo, e acusar isso como erro de dado ensinaria o auditor a
         ignorar a invariante — que existe para pegar taxa ERRADA, não taxa
         ausente. */
      const naoReproduzivel = rows.filter(r => (r.questoes || 0) > 0 && typeof r.pctAcerto === 'number'
        && Math.abs(r.pctAcerto - Math.round((r.acertos || 0) / r.questoes * 1000) / 10) > 0.051).length;
      return {
        rotulo: nm(s.label || '') || null,
        de: s.startDate || null, ate: s.endDate || s.date || null,
        importadoEm: s.importedAt || null,
        linhas: rows.length,
        disciplinas: discs.length,
        disciplinasRepetidas: chaves.length - new Set(chaves).size,
        questoesNasDisciplinas: N(qDisc), acertosNasDisciplinas: N(acDisc),
        questoesNasFolhas: N(qFolha), acertosNasFolhas: N(acFolha),
        fechaEntreDisciplinasEFolhas: (qDisc === qFolha && acDisc === acFolha),
        somaCruaDeTodasAsLinhas: N(somaQ(rows)),
        assuntosSemCodigo: rows.filter(r => (r.depth || 0) > 0 && !r.codigo).length,
        profundidadeMaxima: rows.reduce((a, r) => Math.max(a, r.depth || 0), 0),
        linhasComTaxaNaoReproduzivel: naoReproduzivel
      };
    });
  },
  /* ── O ÍNDICE DE INCIDÊNCIA, E O QUANTO ELE CASA ─────────────────────────
     A ordem "fraqueza × incidência" e o peso de cada matéria no quadro "Onde
     atacar primeiro" saem daqui. Duas coisas podem estar erradas sem aparecer
     em número nenhum da tela: o total do caderno contado em dobro (a árvore
     soma pai e filho) e o CASAMENTO — quantos assuntos do seu desempenho
     acharam incidência, e quantos acharam só pela queda por nome solto, que é
     o canal silencioso de erro (dois "Princípios" de matérias diferentes). */
  _conferirIncidencia(itens, nm) {
    let sel = '__todas__';
    try { sel = DesempenhoTecScreen.bancaFiltro(); } catch (e) { _quiet(e, 'aud-banca'); }
    const todas = (function () { try { return DB.getIncidencia() || []; } catch (e) { return []; } })();
    if (!todas.length) return { temIndice: false };
    let porDisc = {}, mapa = null;
    try { porDisc = ReforcoEngine.incidPorDisciplina(sel) || {}; } catch (e) { _quiet(e, 'aud-inc-disc'); }
    try { mapa = ReforcoEngine.incidenceMap(sel); } catch (e) { _quiet(e, 'aud-inc-mapa'); }
    const bancas = [...new Set(todas.map(r => r.banca).filter(Boolean))];
    let casados = 0, viaNome = 0, semIncid = 0;
    (itens || []).forEach(x => {
      if (!mapa) return;
      let achado = null;
      try { achado = ReforcoEngine.incidenciaDe(mapa, x.nome, x.disciplina); } catch (e) { _quiet(e, 'aud-inc-de'); }
      if (!achado || !achado.valor) { semIncid++; return; }
      casados++;
      if (achado.viaNome) viaNome++;
    });
    return {
      temIndice: true,
      bancasImportadas: bancas.map(nm),
      bancasNoFiltro: (sel === '__todas__') ? null : (Array.isArray(sel) ? sel.map(nm) : [nm(sel)]),
      linhasNoIndice: todas.length,
      disciplinasNoIndice: Object.keys(porDisc).length,
      /* Soma das RAÍZES: é assim que o peso da prova é calculado. A soma crua
         de todas as linhas vem ao lado porque é a conta errada mais provável —
         nos índices reais ela dá mais de 3× o caderno. */
      questoesNoCaderno: this._num(Object.values(porDisc).reduce((a, v) => a + (v || 0), 0), 0),
      somaCruaDeTodasAsLinhas: this._num(todas.reduce((a, r) => a + (r.incidencia || 0), 0), 0),
      assuntosDoPlanoComIncidencia: casados,
      assuntosDoPlanoSemIncidencia: semIncid,
      casadosApenasPeloNome: viaNome,
      taxaDeCasamentoPct: (casados + semIncid) > 0 ? this._num(casados / (casados + semIncid) * 100, 1) : null
    };
  },
  /* As invariantes são as mesmas que a suíte roda no navegador de
     desenvolvimento — só que aqui elas rodam SOBRE OS DADOS REAIS de quem
     exportou. É a diferença entre "o código está certo" e "o seu arquivo está
     coerente". */
  _invariantes(r, tm, imp, inc, cons, gran) {
    const inv = [];
    const push = (nome, ok, detalhe) => inv.push({ nome, ok: !!ok, aplicavel: true, detalhe: detalhe == null ? null : detalhe });
    /* UMA INVARIANTE SEM PRÉ-CONDIÇÃO NÃO É UMA FALHA. Sem incidência nem
       edital importados não existe peso de prova, e "o peso soma 100%" passa a
       cobrar uma conta que ninguém tinha o que fazer. Reprovar aí ensinaria o
       auditor a ignorar o bloco inteiro — que é o oposto do que ele serve.
       Então o estado é três: passou, falhou, ou não se aplica (e por quê). */
    const naoSeAplica = (nome, porque) => inv.push({ nome, ok: true, aplicavel: false, detalhe: { porque } });
    try {
      const itens = r.itens || [];
      if (itens.length) {
        const somaG = itens.reduce((a, x) => a + (x.ganhoPP || 0), 0);
        const ult = itens[itens.length - 1];
        push('acumulado = domínio + soma dos ganhos',
          Math.abs(ult.acumulado - (r.dominioPct + somaG)) < 0.01,
          { acumulado: this._num(ult.acumulado), esperado: this._num(r.dominioPct + somaG) });
        let degrau = true, ant = r.dominioPct;
        itens.forEach(x => { if (Math.abs(x.acumulado - ant - x.ganhoPP) > 1e-6) degrau = false; ant = x.acumulado; });
        push('cada degrau do acumulado é o ganho daquele assunto', degrau);
        const chaves = itens.concat(r.pequenas || []).map(x => (x.disciplina || '') + '|' + x.nome);
        push('nenhum assunto na lista e no segundo plano ao mesmo tempo',
          new Set(chaves).size === chaves.length);
      }
      if (r.caminho && r.caminho.itens) {
        const g = r.caminho.itens.reduce((a, x) => a + (x.ganhoPP || 0), 0);
        push('o caminho mais curto cobre a falta até a meta',
          r.dominioPct + g >= r.meta - 1e-6, { chega: this._num(r.dominioPct + g), meta: r.meta });
        push('e não custa mais que a ordem exibida',
          r.qAteMeta == null || r.caminho.q <= r.qAteMeta, { curto: r.caminho.q, exibida: r.qAteMeta });
        push('e não conta o mesmo assunto duas vezes',
          new Set(r.caminho.itens.map(x => (x.disciplina || '') + '|' + x.nome)).size === r.caminho.n);
      }
      /* A exclusão é a única preferência capaz de mudar todo número do Plano
         sem deixar rastro nos números: um domínio de 80,3% e outro de 74,9%,
         do mesmo perfil e do mesmo dia, são reconciliáveis só por aqui. A
         invariante cobra COERÊNCIA — nenhum assunto de matéria excluída pode
         ter sobrevivido na lista ou no segundo plano. */
      if (r.excluidasAtivas && r.excluidasAtivas.length) {
        const foraN = r.excluidasAtivas.map(d => ReforcoEngine.norm(d));
        const vazou = (r.itens || []).concat(r.pequenas || [])
          .filter(x => foraN.indexOf(ReforcoEngine.norm(x.disciplina || '')) >= 0);
        push('nenhum assunto de matéria excluída aparece na lista', vazou.length === 0,
          { fora: r.excluidasAtivas.length, vazaram: vazou.length });
      } else {
        naoSeAplica('nenhum assunto de matéria excluída aparece na lista',
          'nenhuma matéria está marcada como fora do Plano neste recorte');
      }
      if (tm && tm.linhas && tm.linhas.length) {
        const sp = tm.linhas.reduce((a, l) => a + (l.sharePeso || 0), 0);
        const se = tm.linhas.reduce((a, l) => a + (l.shareEsforco || 0), 0);
        if (tm.fontePeso) push('o peso das matérias soma 100%', Math.abs(sp - 100) < 0.5, { soma: this._num(sp) });
        else naoSeAplica('o peso das matérias soma 100%', 'sem incidência de banca nem edital declarado, não há peso de prova para somar');
        if (tm.seuTotal > 0) push('o esforço das matérias soma 100%', Math.abs(se - 100) < 0.5, { soma: this._num(se) });
        else naoSeAplica('o esforço das matérias soma 100%', 'nenhuma questão medida no TEC até aqui');
        push('a tabela de matérias está ordenada por pontos em jogo',
          tm.linhas.filter(l => l.ganho > 0).every((l, i, a) => i === 0 || a[i - 1].ganho >= l.ganho));
      } else {
        naoSeAplica('as contas do quadro de matérias', 'o quadro de matérias não produziu linhas neste retrato');
      }
      /* ── AS INVARIANTES DA FONTE ────────────────────────────────────────
         As anteriores conferem a CONTA; estas conferem o DADO que entrou nela.
         Uma conta impecável sobre um total contado em dobro é o pior caso
         possível: tudo parece certo. */
      if (imp && imp.length) {
        const naoFecham = imp.filter(i => !i.fechaEntreDisciplinasEFolhas);
        push('em cada retrato, as folhas somam o mesmo que as disciplinas',
          naoFecham.length === 0,
          naoFecham.length ? naoFecham.map(i => ({ ate: i.ate, disciplinas: i.questoesNasDisciplinas, folhas: i.questoesNasFolhas })) : { retratos: imp.length });
        const repetidas = imp.filter(i => i.disciplinasRepetidas > 0);
        push('nenhum retrato tem disciplina repetida',
          repetidas.length === 0,
          repetidas.length ? repetidas.map(i => ({ ate: i.ate, repetidas: i.disciplinasRepetidas })) : null);
        const naoRepro = imp.filter(i => i.linhasComTaxaNaoReproduzivel > 0);
        push('a taxa de cada linha é reproduzível pelas contagens (acertos ÷ questões)',
          naoRepro.length === 0,
          naoRepro.length ? naoRepro.map(i => ({ ate: i.ate, linhas: i.linhasComTaxaNaoReproduzivel })) : null);
      } else {
        naoSeAplica('as conferências da importação', 'nenhum retrato importado neste perfil');
      }
      /* A invariante mais importante do agrupamento: ele é um
         REPARTICIONAMENTO. Toda questão continua em exatamente uma unidade —
         nem some ao ser somada no bloco, nem é contada no átomo E no bloco. */
      if (gran && gran.piso > 0) {
        push('agrupar átomos finos não muda o volume, só o recorte',
          gran.somaPreservada,
          { questoes: gran.questoes, semAgrupar: gran.questoesSemAgrupar,
            acertos: gran.acertos, semAgrupar_acertos: gran.acertosSemAgrupar });
        push('o agrupamento só junta o que não media sozinho',
          gran.medemSozinhas >= gran.medemSozinhasSemAgrupar,
          { com: gran.medemSozinhas, sem: gran.medemSozinhasSemAgrupar, piso: gran.piso });
      } else {
        naoSeAplica('as conferências do agrupamento de átomos finos',
          gran && gran.apenasFolhas === false
            ? 'a opção "só assuntos específicos" está desligada, e o agrupamento não se aplica à lente aberta'
            : 'o piso de granularidade está em zero: cada assunto do TEC é uma unidade, como sempre foi');
      }
      if (cons && PlanoEngine.prefs().apenasFolhas === false) {
        /* Com "só assuntos específicos" DESLIGADO o pai e o filho entram os
           dois, de propósito: o mesmo acerto é contado em cada nível. A
           reconciliação deixa de fazer sentido — cobrá-la aqui transformaria
           uma escolha do usuário em falha do arquivo. O que o auditor precisa
           saber é que a escolha está ativa e o que ela custa. */
        naoSeAplica('o Plano vê todas as questões que a Análise soma no escopo',
          'a opção "só assuntos específicos" está desligada: tópicos-pai e filhos entram os dois, '
          + 'então a soma do Plano (' + cons.questoesNoIndiceDoPlano + ') passa do total do escopo ('
          + cons.questoes + ') de propósito');
      } else if (cons) {
        push('o Plano vê todas as questões que a Análise soma no escopo',
          !!cons.fechaComOPlano,
          { escopo: cons.questoes, plano: cons.questoesNoIndiceDoPlano,
            retratos: cons.retratosNoEscopo, assuntos: cons.assuntosNoIndice });
      } else {
        naoSeAplica('a reconciliação do escopo', 'nenhum retrato no escopo atual');
      }
      if (inc && inc.temIndice) {
        push('o total do caderno vem da raiz de cada disciplina, não da soma da árvore',
          inc.somaCruaDeTodasAsLinhas >= inc.questoesNoCaderno,
          { caderno: inc.questoesNoCaderno, somaCrua: inc.somaCruaDeTodasAsLinhas });
        push('a ordem por banca tem casamento suficiente para significar algo',
          r.ordenar !== 'banca' || (inc.taxaDeCasamentoPct != null && inc.taxaDeCasamentoPct >= 10),
          { ordem: r.ordenar, casamentoPct: inc.taxaDeCasamentoPct, apenasPeloNome: inc.casadosApenasPeloNome });
      } else {
        naoSeAplica('as conferências do índice de incidência', 'nenhum índice de caderno importado');
      }
    } catch (e) { push('a coleta das invariantes terminou', false, String(e && e.message || e)); }
    return inv;
  },

  gerar(opts) {
    opts = opts || {};
    const anon = !!opts.anonimo;
    const nm = (s) => anon ? this._apelido(s) : (s == null ? null : String(s));
    const N = (v, c) => this._num(v, c);
    const p = PlanoEngine.prefs();
    const snaps0 = DB.getTecSnapshots() || [];
    /* ── O RECORTE DE RETRATOS ENTRA NO ARQUIVO, E NÃO PODE IMPEDI-LO ────────
       A tela do TEC pode estar com um recorte ativo (retratos escolhidos a
       dedo, ou um intervalo de datas). Duas consequências, e as duas
       importam para quem audita:

       · os números do Plano passam a ser DAQUELE recorte, e um arquivo que
         não diz isso leva o auditor a comparar peras com maçãs entre duas
         exportações;
       · se o recorte não casa com nada (seleção vazia, intervalo fora das
         datas), `scopedSnapshot()` devolve null e a exportação simplesmente
         se recusava a existir — justo quando a pessoa mais precisa mandar o
         arquivo para alguém entender o que houve.

       Então: grava o recorte, e quando ele não produz retrato nenhum, cai no
       consolidado e DECLARA a queda no próprio arquivo. */
    let recorte = null, caiuNoConsolidado = false;
    try {
      recorte = { modo: DesempenhoTecScreen.scopeMode || 'consolidado' };
      if (recorte.modo === 'select') recorte.retratosEscolhidos = (DesempenhoTecScreen.selectedSnapIds || { size: 0 }).size;
      if (recorte.modo === 'range') { recorte.de = DesempenhoTecScreen.rangeStart || null; recorte.ate = DesempenhoTecScreen.rangeEnd || null; }
    } catch (e) { _quiet(e, 'aud-recorte'); }
    let snap = null;
    try { snap = DesempenhoTecScreen.scopedSnapshot(); } catch (e) { _quiet(e, 'aud-snap'); }
    if (!snap && snaps0.length) {
      caiuNoConsolidado = true;
      try { snap = DesempenhoTecScreen.aggregate(snaps0); } catch (e) { _quiet(e, 'aud-agg'); }
    }
    const r0 = PlanoEngine.calcular(snap, Object.assign({}, p, { limite: this.MAX_ASSUNTOS }));
    /* ── O ARQUIVO TEM DE EXISTIR JUSTAMENTE QUANDO A TELA NÃO CALCULA ───────
       `calcular` recusa o retrato em três casos: sem retrato importado, todas
       as matérias excluídas, ou nenhum assunto com amostra suficiente. A
       exportação devolvia só o código do erro — e é o pior momento possível
       para não haver arquivo: a tela está vazia e a pessoa quer exatamente
       mandar o retrato para alguém entender por quê.

       O caso não é raro. O índice do TecConcursos é fino: num export real de
       400 questões havia 391 assuntos atômicos, cerca de UMA questão cada, e
       nenhum chegava à amostra mínima de 20. O Plano inteiro desaparecia com o
       retrato na mão — e a auditoria desaparecia com ele.

       Sem retrato nenhum não há o que exportar. Nos outros dois casos o arquivo
       sai com tudo que NÃO depende do cálculo (parâmetros, o que foi importado,
       o índice de incidência, os modos) e com o erro declarado no topo. */
    if (!r0 || r0.erro === 'sem-retrato') return { erro: (r0 && r0.erro) || 'sem-retrato' };
    const semCalculo = !!r0.erro;
    const r = r0;
    let tm = null;
    try { tm = PlanoPontos.esforcoPorMateria(p); } catch (e) { _quiet(e, 'aud-materias'); }
    let proj = null;
    try { proj = PlanoPontos.projecao(p); } catch (e) { _quiet(e, 'aud-proj'); }
    let cal = null, fechados = [], curso = [];
    try { cal = PlanoCiclo.calibragem(); } catch (e) { _quiet(e, 'aud-cal'); }
    try { fechados = PlanoCiclo.fechados() || []; } catch (e) { _quiet(e, 'aud-fech'); }
    if (!semCalculo) { try { curso = PlanoCiclo.emCurso(r) || []; } catch (e) { _quiet(e, 'aud-curso'); } }
    const snaps = snaps0;

    /* Qualidade do dado: metade dos "erros do Plano" que alguém reporta é
       amostra curta, não conta errada. Quem audita precisa ver isso ANTES de
       olhar as fórmulas. */
    const qs = (r.itens || []).map(x => x.qJanela || 0).filter(q => q > 0).sort((a, b) => a - b);
    const mediana = qs.length ? qs[Math.floor((qs.length - 1) / 2)] : 0;
    const deltaMed = (r.itens || []).map(x => x.deltaMinimo).filter(v => v != null).sort((a, b) => a - b);

    /* A fonte, conferida: o que cada retrato importado diz, e o quanto o índice
       de incidência casa com ele. Ver `_conferirImportacao`. */
    const importacao = this._conferirImportacao(snaps, nm);
    /* O escopo consolidado é o PADRÃO da tela, e é onde a conta pode divergir
       sem que nenhum retrato isolado esteja errado: os códigos do TEC são
       posicionais, então a árvore de um mês não é a do outro. A reconciliação
       do agregado é a que responde "o Plano está vendo todas as questões que a
       Análise soma?" — a resposta era não, por 40 questões em 533. */
    const consolidado = (function (self) {
      try {
        if (!snap) return null;
        const t = TecEngine.totais({ rows: snap.rows || [] });
        const folhas = PlanoEngine._folhas(snap, p.apenasFolhas) || [];
        const qF = folhas.reduce((a, x) => a + (x.questoes || 0), 0);
        const acF = folhas.reduce((a, x) => a + (x.acertos || 0), 0);
        /* No agregado o índice é somado retrato por retrato (ver `_indice`), e
           é ELE que o Plano usa — então é ele que tem de fechar. */
        const idx = PlanoEngine._indice(snap, p) || {};
        const qI = Object.keys(idx).reduce((a, k) => a + (idx[k].q || 0), 0);
        const acI = Object.keys(idx).reduce((a, k) => a + (idx[k].ac || 0), 0);
        return {
          retratosNoEscopo: snap._fontes ? snap._fontes.length : 1,
          questoes: t.questoes, acertos: t.acertos, disciplinas: t.disciplinas,
          questoesNasFolhas: qF, acertosNasFolhas: acF,
          assuntosNoIndice: Object.keys(idx).length,
          questoesNoIndiceDoPlano: qI, acertosNoIndiceDoPlano: acI,
          fechaComOPlano: (qI === t.questoes && acI === t.acertos)
        };
      } catch (e) { _quiet(e, 'aud-consol'); return null; }
    })(this);
    const incidencia = this._conferirIncidencia(r.itens || [], nm);
    /* ── A LENTE, DECLARADA ────────────────────────────────────────────────
       O piso de granularidade muda os NOMES e a contagem de unidades do Plano
       sem mudar uma questão do total. Dois arquivos do mesmo dia, do mesmo
       perfil, com 317 unidades e com 33, são reconciliáveis só por aqui — e a
       conferência que importa é a de que o volume é o MESMO nas duas lentes.
       Ela roda com o dado real, no ato, e não com um exemplo. */
    const granularidade = (function () {
      try {
        if (!snap) return null;
        const soma = (idx) => Object.keys(idx || {}).reduce((a, k) => a + (idx[k].q || 0), 0);
        const somaAc = (idx) => Object.keys(idx || {}).reduce((a, k) => a + (idx[k].ac || 0), 0);
        const cru = PlanoEngine._indice(snap, Object.assign({}, p, { granPiso: 0 })) || {};
        const comLente = PlanoEngine._indice(snap, p) || {};
        const ag = PlanoEngine._agrupamento(p);
        return {
          piso: parseInt(p.granPiso || 0, 10) || 0,
          apenasFolhas: p.apenasFolhas !== false,
          unidadesSemAgrupar: Object.keys(cru).length,
          unidadesComAgrupamento: Object.keys(comLente).length,
          blocos: ag ? ag.nBlocos : 0,
          atomosAgrupados: ag ? ag.atomos : 0,
          medemSozinhas: Object.keys(comLente).filter(k => (comLente[k].q || 0) >= p.minAmostra).length,
          medemSozinhasSemAgrupar: Object.keys(cru).filter(k => (cru[k].q || 0) >= p.minAmostra).length,
          questoes: soma(comLente), questoesSemAgrupar: soma(cru),
          acertos: somaAc(comLente), acertosSemAgrupar: somaAc(cru),
          /* O que o agrupamento PROMETE: reparticionar, nunca criar nem
             esconder. Se este campo vier false, todo número do Plano está
             suspeito e o arquivo tem de dizer isso na cara. */
          somaPreservada: soma(comLente) === soma(cru) && somaAc(comLente) === somaAc(cru),
          exemplos: ag ? Object.keys(ag.blocos).slice(0, 8).map(k => ({
            unidade: nm(ag.blocos[k].nome), disciplina: nm(ag.blocos[k].disciplina),
            topicos: ag.blocos[k].membros.length, questoes: ag.blocos[k].qAcum
          })) : []
        };
      } catch (e) { _quiet(e, 'aud-gran'); return null; }
    })();

    const payload = {
      formato: 'studynomentor/plano-auditoria',
      versao: this.VERSAO,
      geradoEm: new Date().toISOString(),
      cadencia: opts.cadencia || 'avulsa',
      anonimo: anon,
      /* A versão sai do carimbo que o montador grava no <meta>: `APP_VERSION`
         nunca existiu no app, então este campo ia null em todo arquivo — e um
         retrato de auditoria sem dizer qual build o produziu não permite
         atribuir uma mudança de número a uma mudança de código. */
      app: {
        versao: (function () {
          try { const m = document.querySelector('meta[name="diario-versao"]'); return (m && m.content) || null; }
          catch (e) { return null; }
        })(),
        build: (window.BUILD_ID || null)
      },

      /* Sem os parâmetros, nenhum número deste arquivo é reproduzível.
         A lista de matérias excluídas é nome próprio: no modo anônimo vai o
         apelido estável, como todo o resto — mas ela NÃO pode simplesmente
         sumir, porque é ela que explica por que o domínio deste arquivo não
         bate com o de outro gerado no mesmo dia. */
      parametros: Object.assign({}, p, {
        excluidas: (Array.isArray(p.excluidas) ? p.excluidas : []).map(nm),
        /* O FOCO É NOME PRÓPRIO, como a exclusão — e como ela, não pode
           simplesmente sumir no modo anônimo: é ele que explica por que o
           domínio deste arquivo não bate com o de outro do mesmo dia. Vai pelo
           apelido estável, igual ao resto. */
        foco: (Array.isArray(p.foco) ? p.foco : []).map(nm)
      }),

      contexto: {
        modo: (function () { try { return PlanoPontos.modo(); } catch (e) { return null; } })(),
        disciplinaFiltro: p.disciplina === '__todas__' ? null : nm(p.disciplina),
        /* O recorte REALMENTE aplicado, como o motor o resolveu — `disciplina`
           acima é a vista do select e pode ser `__todas__` com três matérias em
           foco. Sem este campo, dois arquivos do mesmo dia com domínios
           diferentes ficariam irreconciliáveis. */
        materiasEmFoco: (r.foco || []).map(nm),
        materiasEmFocoN: (r.foco || []).length,
        /* O que o motor DE FATO deixou de fora neste retrato — que pode ser
           menos que a lista marcada (uma matéria excluída sem retrato nenhum
           não tira nada da conta) e nunca mais. */
        materiasForaDoPlano: (r.excluidasAtivas || []).map(nm),
        assuntosForaDoPlano: r.excluidasAssuntos || 0,
        questoesForaDoPlano: r.excluidasQ || 0,
        fontePeso: tm ? tm.fontePeso : null,
        bancas: (function () { try { return DesempenhoTecScreen.bancasSelecionadas() || []; } catch (e) { return []; } })().map(nm),
        temIncidencia: (function () { try { return !!(ReforcoEngine.hasIncidencia && ReforcoEngine.hasIncidencia()); } catch (e) { return null; } })(),
        temEdital: (function () { try { return PlanoPontos.temComposicao(); } catch (e) { return null; } })(),
        recorteDeRetratos: recorte,
        caiuNoConsolidado: caiuNoConsolidado,
        retratos: snaps.length,
        primeiroRetrato: snaps.length ? (snaps[0].endDate || snaps[0].date) : null,
        ultimoRetrato: snaps.length ? (snaps[snaps.length - 1].endDate || snaps[snaps.length - 1].date) : null
      },

      /* O erro do cálculo é um CAMPO do arquivo, não a ausência dele. Quando
         ele está preenchido, os blocos que dependem do cálculo vêm nulos e o
         diagnóstico diz o que faltou. */
      erroDoCalculo: semCalculo ? {
        codigo: r.erro,
        assuntosNoRetrato: r.assuntosNoRetrato != null ? r.assuntosNoRetrato : null,
        maiorAmostra: r.maiorAmostra != null ? r.maiorAmostra : null,
        medianaAmostra: r.medianaAmostra != null ? r.medianaAmostra : null,
        amostraMinimaExigida: r.minAmostra != null ? r.minAmostra : p.minAmostra,
        sugestaoDeAmostraMinima: r.sugestaoMinAmostra != null ? r.sugestaoMinAmostra : null,
        assuntosQueQualificamNaSugestao: r.qualificamNaSugestao != null ? r.qualificamNaSugestao : null,
        materiasForaDoPlano: (r.excluidasAtivas || []).map(nm)
      } : null,

      retrato: semCalculo ? null : {
        dominioPct: N(r.dominioPct), meta: r.meta, teto: r.teto,
        falta: N(r.falta), jaAtinge: r.jaAtinge,
        assuntosMedidos: r.assuntos, semDiagnostico: r.ignorados,
        questoesNaAmostra: r.qTotal, janelaMediaDias: r.janelaMedia,
        ritmoSemanal: r.ritmo, ritmoMedido: r.ritmoMedido,
        defasado: r.defasado, diasDesdeUltimoRetrato: r.idadeUltimo,
        caminhoMaisCurto: r.caminho ? { assuntos: r.caminho.n, questoes: r.caminho.q, semanas: N(r.semanas, 1) } : null,
        questoesNaOrdemExibida: r.qAteMeta,
        solidos: r.solidosAtuais, solidosVencidos: r.solidosVencidos,
        recemCorrigidos: r.recentes, comDadoVencido: r.vencidos,
        melhorando: r.melhorando, piorando: r.piorando,
        empatadosNoTopo: r.empatados, medianaJanela: r.medianaJanela,
        ordem: r.ordenar, ponderacao: r.ponderacao, custoModo: r.custoModo,
        ordensGemeas: r.equivalentes || []
      },

      /* A série é a única coisa aqui que responde "está melhorando?". O
         `deltaComparavel` é o que vale: o bruto compara conjuntos diferentes
         de assuntos a cada importação. */
      serie: (r.serie || (semCalculo ? PlanoEngine.serieHistorica(p) : []) || []).map(x => ({
        data: x.data, nome: anon ? null : x.nome,
        dominio: N(x.dominio), assuntos: x.assuntos, questoes: x.questoes,
        deltaBruto: N(x.delta), deltaComparavel: N(x.deltaComp),
        assuntosComuns: x.comuns, questoesComuns: x.qComuns,
        rendimento: N(x.rendimento, 4)
      })),

      materias: tm ? {
        emJogoPP: N(tm.emJogo, 1), materiasNoCorte: tm.nCorte, acoes: tm.acoes,
        linhas: (tm.linhas || []).map(l => ({
          nome: nm(l.nome), questoesSuas: l.q,
          esforcoPct: N(l.shareEsforco), pesoPct: N(l.sharePeso),
          nivelPct: N(l.taxa), medido: l.medido,
          emJogoPP: N(l.ganho), estimado: !!l.estimado,
          razaoEsforcoPeso: N(l.razao), sobra: !!l.sobra,
          veredito: l.veredito, noCorte: !!l.noCorte, naFila: !!l.naFila, resumo: l.resumo || null
        }))
      } : null,

      assuntos: semCalculo ? null : (r.itens || []).map((x, i) => ({
        pos: i + 1, disciplina: nm(x.disciplina), nome: nm(x.nome),
        taxaPct: N(x.taxa), margemPP: N(x.margem), confiabilidade: x.conf ? x.conf.nivel : null,
        questoesNaJanela: x.qJanela, questoesNoTotal: x.qHist, diasDaJanela: x.diasJanela,
        retratosNaJanela: x.retratosJanela, atingiuAlvoDeAmostra: !!x.atingiuAlvo,
        taxaAnteriorPct: N(x.pctAntes), questoesAntes: x.qAntes,
        deltaPP: N(x.delta), deltaMinimoComprovavelPP: N(x.deltaMinimo), deltaFirme: !!x.deltaFirme,
        faixa: x.status ? x.status.rot : null, conselho: x.status ? x.status.acao : null,
        lacunaPP: N(x.lacunaPP), custoQuestoes: x.custoQ, amplitude: N(x.amplitude),
        questoesParaMedir: x.qMedir, questoesParaProvar: x.qProvar,
        ganhoDominioPP: N(x.ganhoDominio, 3), ganhoGeralPP: N(x.ganhoGeral, 3),
        ganhoUsadoPP: N(x.ganhoPP, 3), acumuladoPct: N(x.acumulado),
        incidencia: x.incid, sequenciaNaMeta: x.seq, medicoes: x.medicoes,
        diasDesdeMedicao: x.diasDesdeMedicao, vencido: !!x.vencido,
        temAtividade: !!x.extra
      })),

      segundoPlano: semCalculo ? null : (r.pequenas || []).map(x => ({
        disciplina: nm(x.disciplina), nome: nm(x.nome),
        taxaPct: N(x.taxa), questoesNaJanela: x.qJanela, questoesNoTotal: x.qHist
      })),

      /* A EVIDÊNCIA CAUSAL. Tudo o mais neste arquivo é observação; isto aqui é
         o experimento: o Plano mandou atacar, a pessoa atacou, e a medição
         seguinte julgou. Um módulo que não mostra ganho aqui não está
         funcionando, por mais bonitos que sejam os outros números. */
      atividades: {
        emCurso: (curso || []).map(c => ({
          disciplina: nm(c.disciplina || (c.extra && c.extra.origemPlano && c.extra.origemPlano.disciplina)),
          topico: nm(c.topico || (c.extra && c.extra.origemPlano && c.extra.origemPlano.topico)),
          feito: c.feito, medido: c.medido, manual: c.manual,
          taxaPct: N(c.taxa), deltaPP: N(c.delta), estado: c.estado
        })),
        fechadas: (fechados || []).map(v => ({
          disciplina: nm(v.disciplina), topico: nm(v.topico),
          em: v.em, questoes: v.questoes,
          taxaInicialPct: N(v.taxaInicial), taxaFinalPct: N(v.taxaFinal),
          ganhoPP: N(v.ganhoPP), resultado: v.resultado || v.estado || null
        })),
        calibragem: cal
      },

      projecaoDePontos: proj ? {
        valorTotal: N(proj.valorTotal), notaHoje: N(proj.hoje), notaPotencial: N(proj.potencial),
        pctHoje: N(proj.pctHoje), pctPotencial: N(proj.pctPotencial),
        corte: proj.corte, faltaCorte: N(proj.faltaCorte), passaHoje: proj.passaHoje,
        materiasSemDado: (proj.semDado || []).map(nm),
        abaixoDoMinimo: (proj.eliminatorias || []).map(l => nm(l.nome)),
        linhas: (proj.linhas || []).map(l => ({ nome: nm(l.nome), questoes: l.q, pontosPorQuestao: l.pts,
          peso: l.peso, valor: N(l.valor), taxaPct: N(l.taxa), medido: l.medido, minimoPct: l.minimo }))
      } : null,

      qualidadeDoDado: {
        medianaQuestoesPorAssunto: mediana,
        assuntosQueAtingemOAlvo: r.comAlvo, maiorAmostra: r.maiorAmostra,
        alvoDeAmostra: r.amostraAlvo, alvoInviavel: !!r.alvoInviavel, alvoSugerido: r.alvoSugerido,
        deltaMinimoMedianoPP: deltaMed.length ? N(deltaMed[Math.floor((deltaMed.length - 1) / 2)]) : null,
        empatadosNoTopo: r.empatados,
        assuntosComIncidencia: r.comIncid, assuntosListados: (r.itens || []).length,
        materiasSemPeso: tm ? (tm.linhas || []).filter(l => l.sharePeso == null || l.sharePeso <= 0).length : null,
        materiasSemEsforco: tm ? (tm.linhas || []).filter(l => !l.q).length : null,
        janelaMaxDias: p.janelaMax, minimoDeAmostra: p.minAmostra
      },

      /* ── O QUE ENTROU, ANTES DO QUE SAIU ──────────────────────────────
         Um retrato por importação, com a reconciliação entre o total das
         disciplinas e o total das folhas. É o bloco que torna visível um erro
         de importação — a classe de erro que produz números plausíveis. */
      importacao: importacao,
      importacaoNoEscopo: consolidado,
      incidencia: incidencia,
      /* Os cinco presets como estão AGORA (com os ajustes do usuário já
         aplicados) e quais foram personalizados: sem isso, dois arquivos do
         mesmo perfil com ordens diferentes não têm explicação. */
      modosDeAtaque: (function () {
        const out = {};
        try {
          Object.keys(PlanoEngine.MODOS).forEach(k => {
            out[k] = { aplica: PlanoEngine.modoPatch(k), personalizado: PlanoEngine.modoEditado(k) };
          });
          out._emVigor = PlanoEngine.modoAtivo();
        } catch (e) { _quiet(e, 'aud-modos'); }
        return out;
      })(),

      granularidade,
      invariantes: this._invariantes(r, tm, importacao, incidencia, consolidado, granularidade),
      historicoDeAuditorias: this._ledger()
    };
    payload.resumo = this.resumo(payload);
    return payload;
  },

  /* Um parágrafo que a pessoa lê antes de mandar o arquivo — e que o auditor lê
     antes de abrir o resto. Se ele e os números do arquivo discordarem, o
     arquivo está quebrado. */
  resumo(a) {
    const r = a.retrato, m = a.materias, at = a.atividades;
    const ok = (a.invariantes || []).filter(i => !i.ok).length;
    const na = (a.invariantes || []).filter(i => i.aplicavel === false).length;
    const fech = (at && at.fechadas) || [];
    const bons = fech.filter(f => (f.ganhoPP || 0) > 0).length;
    const s = [];
    /* ── O RESUMO DO ARQUIVO SEM CÁLCULO ─────────────────────────────────────
       Quando o Plano não conseguiu calcular, a primeira linha tem de dizer O
       QUE FALTOU e com que números — é a informação que faz o arquivo valer a
       pena mesmo sem domínio nenhum dentro. */
    const e = a.erroDoCalculo;
    if (e) {
      const nomes = { amostra: 'nenhum assunto atingiu a amostra mínima',
        'tudo-excluido': 'todas as matérias com retrato estão marcadas como fora do Plano' };
      s.push('O Plano NÃO calculou: ' + (nomes[e.codigo] || e.codigo) + '.');
      if (e.codigo === 'amostra') {
        s.push('São ' + (e.assuntosNoRetrato || 0) + ' assuntos no retrato, maior amostra de '
          + (e.maiorAmostra || 0) + ' questão(ões) e mediana de ' + (e.medianaAmostra || 0)
          + ', contra a régua de ' + e.amostraMinimaExigida + '.'
          + (e.sugestaoDeAmostraMinima ? ' Com a régua em ' + e.sugestaoDeAmostraMinima + ', entrariam '
            + (e.assuntosQueQualificamNaSugestao || 0) + ' assuntos.' : ''));
      }
      if (e.codigo === 'tudo-excluido' && (e.materiasForaDoPlano || []).length) {
        s.push((e.materiasForaDoPlano || []).length + ' matéria(s) fora do Plano.');
      }
      s.push('O que este arquivo ainda prova: o que foi importado, o índice de incidência, os parâmetros e os modos em vigor.');
    }
    if (r) s.push('Domínio ' + r.dominioPct + '% em ' + r.assuntosMedidos + ' assuntos (meta ' + r.meta + '%, faltam ' + r.falta + ').');
    if (a.contexto.disciplinaFiltro) s.push('ATENÇÃO: filtrado por "' + a.contexto.disciplinaFiltro + '" — estes números são só dessa matéria.');
    if (a.contexto.recorteDeRetratos && a.contexto.recorteDeRetratos.modo && a.contexto.recorteDeRetratos.modo !== 'consolidado') s.push('ATENÇÃO: recorte de retratos "' + a.contexto.recorteDeRetratos.modo + '" ativo.');
    if (a.contexto.caiuNoConsolidado) s.push('O recorte escolhido não cobria retrato nenhum: os números caíram no consolidado.');
    if (r && r.caminhoMaisCurto) s.push('Caminho mais curto: ' + r.caminhoMaisCurto.assuntos + ' assuntos, ' + r.caminhoMaisCurto.questoes + ' questões, ~' + r.caminhoMaisCurto.semanas + ' semanas a ' + r.ritmoSemanal + '/sem.');
    if (m) s.push(m.emJogoPP + 'pp da prova em jogo; ' + m.materiasNoCorte + ' matéria(s) concentram metade.');
    if (r) s.push('Amostra: mediana de ' + a.qualidadeDoDado.medianaQuestoesPorAssunto + ' questões por assunto; ' + r.empatadosNoTopo + ' empatados no topo.');
    s.push('Ciclos fechados: ' + fech.length + (fech.length ? ' (' + bons + ' com ganho).' : '.'));
    s.push('Retratos: ' + a.contexto.retratos + (a.serie.length > 1 ? ', variação comparável acumulada de ' + this._num(a.serie.reduce((x, p) => x + (p.deltaComparavel || 0), 0), 1) + 'pp.' : '.'));
    /* A FONTE ENTRA NO RESUMO. Um erro de importação produz números plausíveis:
       se o total das disciplinas e o das folhas discordam, nada abaixo disso
       merece leitura, e isso tem de estar na primeira linha que alguém lê. */
    const imp = a.importacao || [];
    const naoFecham = imp.filter(i => !i.fechaEntreDisciplinasEFolhas).length;
    if (imp.length) {
      const ult = imp[imp.length - 1];
      s.push('Último retrato importado: ' + ult.linhas + ' linhas, ' + ult.disciplinas + ' disciplinas, '
        + ult.questoesNasDisciplinas + ' questões (folhas: ' + ult.questoesNasFolhas + ').'
        + (naoFecham ? ' ⚠️ ' + naoFecham + ' retrato(s) com disciplinas e folhas em desacordo.' : ''));
    }
    if (a.incidencia && a.incidencia.temIndice) {
      s.push('Índice de incidência: ' + a.incidencia.questoesNoCaderno + ' questões no caderno, '
        + a.incidencia.disciplinasNoIndice + ' disciplinas, casamento de '
        + (a.incidencia.taxaDeCasamentoPct == null ? '—' : a.incidencia.taxaDeCasamentoPct + '%')
        + ' com os assuntos do Plano'
        + (a.incidencia.casadosApenasPeloNome ? ' (' + a.incidencia.casadosApenasPeloNome + ' só pelo nome)' : '') + '.');
    }
    s.push(ok ? ('⚠️ ' + ok + ' invariante(s) FALHARAM — confira antes de confiar nos números.')
      : ('Invariantes: todas fecham' + (na ? ' (' + na + ' não se aplicam a este retrato).' : '.')));
    return s.join(' ');
  },

  _registrar(a) {
    try {
      const l = this._ledger();
      l.push({
        em: a.geradoEm, cadencia: a.cadencia,
        dominio: a.retrato.dominioPct, assuntos: a.retrato.assuntosMedidos,
        questoes: a.retrato.questoesNaAmostra, retratos: a.contexto.retratos,
        emJogo: a.materias ? a.materias.emJogoPP : null,
        fechadas: a.atividades.fechadas.length,
        comGanho: a.atividades.fechadas.filter(f => (f.ganhoPP || 0) > 0).length,
        invariantesFalhas: (a.invariantes || []).filter(i => !i.ok).length
      });
      DB._set(this.KEY_LEDGER, l.slice(-this.MAX_LEDGER));
    } catch (e) { _quiet(e, 'aud-registrar'); }
  },

  exportar(cadencia, anonimo) {
    const a = this.gerar({ cadencia: cadencia, anonimo: anonimo });
    if (a.erro) { showToast('Sem retrato do TEC para auditar'); return null; }
    this._registrar(a);
    const hoje = todayLocal();
    const nome = 'plano-auditoria-' + (cadencia || 'avulsa') + '-' + hoje + '.json';
    try {
      const blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const el = document.createElement('a');
      el.href = url; el.download = nome;
      document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Auditoria exportada ✓');
    } catch (e) { _quiet(e, 'aud-download'); showToast('Não consegui gerar o arquivo'); }
    return a;
  }
};
window.PlanoAuditoria = PlanoAuditoria;
