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
    limite: 30, ordenar: 'pior',
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
      porque: 'Todo assunto pesa igual e o pior acerto vem primeiro: nada se esconde atrás de pouco volume, e nenhuma banca decide por você antes da hora.',
      patch: { ponderacao: 'igual', ordenar: 'pior', metaDominio: 85, tetoDominio: 90, custoModo: 'lacuna', limite: 30, incluirPequenas: false }
    },
    edital: {
      rot: '🎯 Edital publicado', fase: 'pós-edital',
      quando: 'Edital na mão, banca definida. A pergunta muda para "o que me dá ponto NESTA prova?".',
      porque: 'Ordena por fraqueza × incidência na banca e pesa por volume: assunto que cai muito e que você erra sobe ao topo, mesmo que não seja o seu pior acerto absoluto.',
      patch: { ponderacao: 'volume', ordenar: 'banca', metaDominio: 85, tetoDominio: 90, custoModo: 'lacuna', limite: 20, incluirPequenas: false },
      exige: 'incidencia'
    },
    curto: {
      rot: '⏱️ Tempo curto', fase: 'qualquer fase',
      quando: 'Poucas semanas até a prova e muito a fazer. A pergunta é "o que rende mais por questão resolvida?".',
      porque: 'Ordena por ganho ÷ custo com o custo medido pela lacuna: assunto muito distante da meta perde para outro que fecha rápido — em tempo curto, dois assuntos resolvidos valem mais que um começado.',
      patch: { ponderacao: 'igual', ordenar: 'rendimento', custoModo: 'lacuna', limite: 10, incluirPequenas: false }
    },
    manutencao: {
      rot: '🛡️ Manutenção', fase: 'véspera / nível bom',
      quando: 'Você já está no nível e o risco agora é PERDER o que ganhou.',
      porque: 'Ordena pela maior queda recente e destaca o que está sem medição nova: aqui o inimigo é o esquecimento, não a ignorância.',
      patch: { ponderacao: 'igual', ordenar: 'queda', custoModo: 'lacuna', limite: 15, incluirPequenas: false }
    },
    diagnostico: {
      rot: '🔍 Diagnóstico', fase: 'plano novo / poucos dados',
      quando: 'Poucas importações, muita coisa sem amostra. A pergunta é "onde eu estou, afinal?".',
      porque: 'Traz para o cálculo os assuntos de amostra pequena e ordena pelo pior acerto: aqui o objetivo não é atacar fraqueza, é produzir dado para saber qual fraqueza é real.',
      patch: { ponderacao: 'igual', ordenar: 'pior', incluirPequenas: true, minAmostra: 5, limite: 40, custoModo: 'lacuna' }
    }
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
    return Object.assign({}, base, custom);
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
    Object.keys(atual).forEach(c => {
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
    if (patch.limite != null) partes.push(patch.limite + ' assuntos');
    if (patch.incluirPequenas) partes.push('inclui amostra pequena');
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
      if (p.migracao !== 2) {
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
      return p;
    } catch (_) { return Object.assign({}, this.DEFAULTS); }
  },
  salvarPrefs(patch) {
    const v = Object.assign(this.prefs(), patch || {});
    DB.setRaw(DB._profilePrefix() + this.KEY_PREF, JSON.stringify(v));
    return v;
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
  // Folhas do retrato: assuntos atômicos, sem somar pai e filho duas vezes
  _folhas(snap, apenasFolhas) {
    const rows = (snap && snap.rows || []).filter(r => r.depth > 0 && (r.questoes || 0) > 0);
    if (!apenasFolhas) return rows;
    return rows.filter(r => {
      if (!r.codigo) return true;
      return !rows.some(o => o !== r && o.disciplina === r.disciplina && o.codigo &&
        String(o.codigo).startsWith(String(r.codigo) + '.'));
    });
  },
  _indice(snap, apenasFolhas) {
    const m = {};
    this._folhas(snap, apenasFolhas).forEach(r => {
      const k = ReforcoEngine.norm(r.nome);
      const c = m[k] || { q: 0, ac: 0, nome: r.nome, disciplina: r.disciplina };
      c.q += (r.questoes || 0); c.ac += (r.acertos || 0);
      m[k] = c;
    });
    Object.values(m).forEach(v => { v.pct = v.q > 0 ? v.ac / v.q * 100 : null; });
    return m;
  },
  // ── SÉRIE HISTÓRICA: domínio em cada importação ─────────────────────────
  // Responde "está funcionando?" — a pergunta que nenhum número isolado responde.
  // Usa um piso baixo de amostra (a intenção é tendência, não precisão pontual).
  PISO_SERIE: 5,
  serieHistorica(opts) {
    opts = Object.assign({}, this.prefs(), opts || {});
    const snaps = DB.getTecSnapshots();
    const pontos = [];
    let ant = null;
    snaps.forEach(s => {
      const idx = this._indice(s, opts.apenasFolhas);
      const chaves = Object.keys(idx).filter(k => idx[k].q >= (opts.pisoSerie || this.PISO_SERIE) &&
        (opts.disciplina === '__todas__' || ReforcoEngine.norm(idx[k].disciplina || '') === ReforcoEngine.norm(opts.disciplina)));
      if (!chaves.length) return;
      const peso = (k) => (opts.ponderacao === 'volume') ? idx[k].q : 1;
      const univ = chaves.reduce((a, k) => a + peso(k), 0);
      const dom = chaves.reduce((a, k) => a + peso(k) * idx[k].pct / 100, 0) / univ * 100;
      const qTotal = chaves.reduce((a, k) => a + idx[k].q, 0);
      const p = {
        data: s.endDate || s.date, nome: s.nome || '', dominio: dom,
        assuntos: chaves.length, questoes: qTotal,
        delta: ant ? dom - ant.dominio : null,
        // retorno do esforço: pontos de domínio ganhos a cada 100 questões do período
        rendimento: (ant && qTotal > 0) ? (dom - ant.dominio) / qTotal * 100 : null
      };
      pontos.push(p); ant = p;
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
  ritmoRecente(snapsDesc, dias) {
    let q = 0, ini = null, fim = null;
    for (const s of snapsDesc) {
      if (this._diasDesde(s.endDate || s.date) > dias) break;
      q += (s.rows || []).filter(r => r.depth > 0).reduce((a, r) => a + (r.questoes || 0), 0);
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
    if (!materias.length) return null;
    const norm = (x) => DB._normSubj ? DB._normSubj(x) : String(x || '').toLowerCase().trim();
    const vol = {};
    (DB.getTecSnapshots() || []).forEach(s => {
      (s.rows || []).filter(r => r.depth > 0 && (r.questoes || 0) > 0).forEach(r => {
        const k = norm(r.disciplina || '');
        if (!k) return;
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
     lacuna discretizada em décimos de ponto — exato dentro dessa resolução,
     alguns milissegundos para centenas de assuntos, com uma saída pelo guloso
     se a entrada for grande demais para valer a pena. */
  _caminhoMinimo(itens, falta) {
    if (!(falta > 0)) return null;                    // a meta já está batida
    const uteis = itens.filter(x => x.ganhoPP > 0.049 && x.custoQ > 0);
    if (!uteis.length) return null;
    /* Arredondar o alvo para CIMA e cada ganho para baixo rejeitava o caso
       exato (três assuntos que somam exatamente a lacuna perdiam por 0,1pp).
       Os dois lados arredondam igual: o erro fica em 0,05pp por assunto, longe
       de qualquer decisão real. */
    const alvo = Math.max(1, Math.round(falta * 10));  // décimos de ponto percentual
    const somaTudo = uteis.reduce((a, x) => a + Math.round(x.ganhoPP * 10), 0);
    if (somaTudo < alvo) return null;                 // nem levando tudo ao teto chega lá
    const montar = (lista) => ({
      q: lista.reduce((a, x) => a + x.custoQ, 0), n: lista.length,
      itens: lista.slice().sort((a, b) => (b.ganhoPP / b.custoQ) - (a.ganhoPP / a.custoQ))
    });
    const guloso = () => {
      const ord = uteis.slice().sort((a, b) => (b.ganhoPP / b.custoQ) - (a.ganhoPP / a.custoQ));
      const esc = []; let ac = 0;
      for (const x of ord) { esc.push(x); ac += x.ganhoPP; if (ac >= falta) break; }
      return ac >= falta ? montar(esc) : null;
    };
    const N = uteis.length, W = alvo + 1;
    // Entrada grande demais para a mochila exata valer o tempo e a memória.
    if (N > 400 || W > 1201) return guloso();
    const INF = Infinity;
    let ant = new Float64Array(W).fill(INF), atual = new Float64Array(W);
    ant[0] = 0;
    /* `usou` diz se o assunto i MELHOROU aquele estado (é o que desempata a
       reconstrução: o valor final ou veio da linha anterior, e então o assunto
       não entra, ou veio de usar este assunto); `veioDe` guarda de qual estado.
       Sem esses dois, uma DP feita no mesmo vetor devolve conjuntos com o mesmo
       assunto duas vezes — e um "caminho mais curto" que conta o mesmo assunto
       duas vezes é exatamente o tipo de número errado que ninguém confere. */
    const usou = new Uint8Array(N * W);
    const veioDe = new Int16Array(N * W).fill(-1);
    for (let i = 0; i < N; i++) {
      const g = Math.round(uteis[i].ganhoPP * 10), c = uteis[i].custoQ;
      atual.set(ant);
      if (g > 0) {
        for (let j = 0; j < W; j++) {
          if (ant[j] === INF) continue;
          const nj = Math.min(alvo, j + g);
          const novo = ant[j] + c;
          if (novo < atual[nj]) { atual[nj] = novo; usou[i * W + nj] = 1; veioDe[i * W + nj] = j; }
        }
      }
      const t = ant; ant = atual; atual = t;          // `ant` passa a ser a linha i
    }
    if (ant[alvo] === INF) return guloso();
    const escolhidos = [];
    let j = alvo;
    for (let i = N - 1; i >= 0 && j > 0; i--) {
      if (usou[i * W + j]) { escolhidos.push(uteis[i]); j = veioDe[i * W + j]; }
    }
    return escolhidos.length ? montar(escolhidos) : guloso();
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
          ? Math.round((a.pct - a.pctAntes) * 10) / 10 : null
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
    if (!usados.length) return { erro: 'amostra' };
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
      const bloco = Math.min(30, Math.max(10, Math.round(x.custoQ / 4)));
      if (t < opts.faixaCritico) x.status = { rot: '🔴 Crítico', tom: 'bad',
        acao: 'Você acerta ' + t.toFixed(0) + '%: erra mais do que acerta. ' +
          (caindo ? 'E caiu ' + queda + 'pp contra o período anterior. ' : '') +
          'Resolver mais questões agora só repete o erro — retome a teoria deste assunto e volte ao banco depois.' };
      else if (t < opts.faixaFragil) x.status = { rot: '🔴 Frágil', tom: 'bad',
        acao: 'A base existe (' + t.toFixed(0) + '%), mas falha em pontos específicos, e faltam ' + faltaMeta + ' até a meta. ' +
          (caindo ? 'A queda de ' + queda + 'pp sugere revisão atrasada. ' : '') +
          'Vá pelo caminho do erro: um bloco de ~' + bloco + ' questões, anote o que errou e revise só esses pontos antes do bloco seguinte.' };
      else if (t < opts.metaDominio) x.status = { rot: '🟠 Em desenvolvimento', tom: 'warn',
        acao: caindo
          ? 'Estava melhor antes e caiu. Antes de aumentar o volume, verifique se o assunto mudou de banca ou se você deixou de revisar — reforce a revisão.'
          : 'Faltam ' + faltaMeta + ' pontos para a meta. Aqui volume resolve: bata questões e revise apenas o que errar, sem voltar à teoria inteira.' };
      /* "Consolidado" e "dado vencido" apareciam juntos no mesmo assunto: a
         tela dizia "está resolvido" e "sem medição nova há 8 meses" lado a
         lado, e cabia à pessoa decidir em qual acreditar. Sustentar a meta em
         medições ANTIGAS não é sustentar a meta hoje — é uma terceira
         situação, com ação própria: remedir antes de confiar. */
      else if (x.seq >= alvoSeq && x.vencido) x.status = { rot: '🟠 Sólido, sem medição nova', tom: 'warn', seq: x.seq,
        acao: 'Sustentou a meta em ' + x.seq + ' importações, mas a última tem ' + x.diasDesdeMedicao + ' dias. Antes de riscar da lista, resolva um bloco pequeno e reimporte: consolidado com dado velho é lembrança, não medição.' };
      else if (x.seq >= alvoSeq) x.status = { rot: '🟢 Consolidado', tom: 'good', seq: x.seq,
        acao: 'Sustenta a meta há ' + x.seq + ' importações seguidas. Está resolvido: só revisão espaçada. Tempo extra aqui rende menos que em qualquer assunto acima.' };
      else x.status = { rot: '🟡 Recém-corrigido', tom: 'warn', seq: x.seq,
        acao: 'Passou da meta em ' + x.seq + ' de ' + alvoSeq + ' importações necessárias. Ainda não provou que fixou — mantenha um volume pequeno e constante até sustentar na próxima importação.' };
    });
    const ordem = {
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
    const caminho = this._caminhoMinimo(plano, meta - dominioPct);
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
    const ritmo = opts.ritmoSemanal || this.ritmoRecente(snapsDesc, 120) || 0;
    const idadeUltimo = this._diasDesde(todos[todos.length - 1].endDate || todos[todos.length - 1].date);
    const sens = opts.sensTendencia;
    const melhorando = usados.filter(x => x.delta != null && x.delta >= sens).length;
    const piorando = usados.filter(x => x.delta != null && x.delta <= -sens).length;
    const janelaMedia = Math.round(usados.filter(x => x.diasJanela).reduce((a, x) => a + x.diasJanela, 0) / Math.max(1, usados.filter(x => x.diasJanela).length));
    return {
      dominioPct, meta, jaAtinge: dominioPct >= meta, falta: Math.max(0, meta - dominioPct),
      assuntos: usados.length, ignorados: brutos.length - usados.length,
      qTotal: usados.reduce((a, x) => a + x.qJanela, 0),
      idxMeta, qAteMeta: idxMeta >= 0 ? qAteMeta : null, caminho, equivalentes,
      equivalentesConfiaveis: plano.length >= 5,
      custoModo: opts.custoModo, custoPiso: opts.custoPiso, custoPorPonto: opts.custoPorPonto,
      pesoBanca: opts.pesoBanca, minAmostra: opts.minAmostra, modo: this.modoAtivo(opts),
      ritmo, ritmoMedido: this.ritmoRecente(snapsDesc, 120),
      // a previsão em semanas acompanha o caminho CURTO, não a ordem exibida
      semanas: (caminho && ritmo > 0) ? caminho.q / ritmo : null,
      amostraAlvo: opts.amostraAlvo, janelaMax: opts.janelaMax, janelaMedia,
      // Se quase ninguém alcança o alvo, o problema é a CONFIGURAÇÃO, não o seu estudo.
      maiorAmostra: usados.reduce((m, x) => Math.max(m, x.qJanela), 0),
      alvoInviavel: usados.length > 0 && (usados.filter(x => x.atingiuAlvo).length / usados.length) < 0.25,
      teto: Math.round(teto * 100),
      comAlvo: usados.filter(x => x.atingiuAlvo).length,
      melhorando, piorando, ordenar: opts.ordenar,
      temIncid, banca: opts.banca,
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
      itens: plano.slice(0, opts.limite),
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

const DesempenhoTecScreen = {
  currentSnapId: null,
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
      date: starts[0], rows: agrupadas
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
  // `lote` = criação em série: sem aviso por item e sem repintar a cada um.
  // Devolve true quando a atividade nasceu, para o chamador contar.
  criarExtraDoPlano(topico, disciplina, alvo, motivo, lote) {
    const jaTem = DB.getExtras().find(e => e.origemPlano &&
      ReforcoEngine.norm(e.origemPlano.topico) === ReforcoEngine.norm(topico));
    if (jaTem) { if (!lote) showToast('Já existe uma atividade para "' + topico + '"'); return false; }
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
        .find(t => ReforcoEngine.norm(t.nome) === ReforcoEngine.norm(topico));
      DB.updateExtra(e.id, { origemPlano: { topico, disciplina: disciplina || '', motivo: motivo || 'reforco',
        criadoEm: todayLocal(), taxaInicial: alvoTop && alvoTop.taxa != null ? alvoTop.taxa : null } });
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
      os_.innerHTML = Object.keys(PlanoEngine.ORDENS).map(k => {
        const o = PlanoEngine.ORDENS[k];
        return `<option value="${k}" title="${escapeHtml(o.quando)}"${k === p.ordenar ? ' selected' : ''}>${escapeHtml(o.rot)}</option>`;
      }).join('');
      if (![...os_.options].some(o => o.value === p.ordenar)) os_.value = 'pior';
    }
    set('plano-janelamax', p.janelaMax); set('plano-consolidar', p.consolidarEm); set('plano-validade', p.validadeDias);
    set('plano-critico', p.faixaCritico); set('plano-fragil', p.faixaFragil);
    set('plano-piso', p.pisoSerie); set('plano-sens', p.sensTendencia);
    const desc = DB.getTecSnapshots().slice().reverse();
    set('plano-ritmo', p.ritmoSemanal || PlanoEngine.ritmoRecente(desc, 120) || 25);
    const ds = document.getElementById('plano-disc');
    if (ds) {
      const discs = PlanoEngine.disciplinas(this.scopedSnapshot());
      ds.innerHTML = `<option value="__todas__">📚 Todas</option>` +
        discs.map(d => `<option value="${escapeHtml(d)}" ${d === p.disciplina ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
      if (![...ds.options].some(o => o.value === p.disciplina)) ds.value = '__todas__';
    }
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
    const ordens = Object.keys(PlanoEngine.ORDENS).map(x => ({ value: x, label: PlanoEngine.ORDENS[x].rot }));
    const r = await UI.prompt([
      { key: 'ordenar', label: 'Ordem de ataque', type: 'select', value: p.ordenar, options: ordens },
      { key: 'metaDominio', label: 'Meta de domínio (%)', type: 'number', value: p.metaDominio, min: 30, max: 100 },
      { key: 'tetoDominio', label: 'Acerto máximo realista (%)', type: 'number', value: p.tetoDominio, min: 50, max: 100 },
      { key: 'ponderacao', label: 'Como pesar cada assunto', type: 'select', value: p.ponderacao, options: [
        { value: 'igual', label: '⚖️ Todo assunto pesa igual' },
        { value: 'volume', label: '📊 Pelo volume de questões' },
        { value: 'ambas', label: '🔀 Mostrar as duas' }] },
      { key: 'custoModo', label: 'Como estimar o custo', type: 'select', value: p.custoModo, options: [
        { value: 'lacuna', label: '📐 Pela lacuna até o máximo realista' },
        { value: 'fixo', label: 'Número fixo de questões' },
        { value: 'proporcional', label: 'Proporcional ao praticado' }] },
      { key: 'limite', label: 'Mostrar até (assuntos)', type: 'number', value: p.limite, min: 5, max: 200 },
      { key: 'incluirPequenas', label: 'Incluir amostra pequena', type: 'select', value: p.incluirPequenas ? '1' : '0', options: [
        { value: '0', label: 'Não — amostra curta vai para o segundo plano' },
        { value: '1', label: 'Sim — entra no cálculo (modo diagnóstico)' }] },
      { key: 'restaurar', label: 'Restaurar o padrão deste modo', type: 'select', value: '0',
        hint: 'Descarta os seus ajustes SÓ deste modo e volta ao padrão de fábrica.',
        options: [{ value: '0', label: 'Não, salvar o que está acima' }, { value: '1', label: '↺ Sim, voltar ao padrão' }] }
    ], { title: 'Ajustar ' + m.rot, sub: m.quando, okText: 'Salvar modo' });
    if (!r) return;
    if (String(r.restaurar) === '1') {
      PlanoEngine.restaurarModo(k);
      showToast(m.rot + ' voltou ao padrão ✓');
    } else {
      const num = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
      /* Só os campos que a pessoa REALMENTE mexeu entram no modo. Gravar todos
         faria um modo herdar decisões que ele não quis tomar, e um "salvar"
         sem alteração nenhuma marcaria o modo como personalizado. */
      const novo = {
        ordenar: r.ordenar,
        metaDominio: Math.max(30, Math.min(100, num(r.metaDominio, p.metaDominio))),
        tetoDominio: Math.max(50, Math.min(100, num(r.tetoDominio, p.tetoDominio))),
        ponderacao: r.ponderacao,
        custoModo: r.custoModo,
        limite: Math.max(5, Math.min(200, num(r.limite, p.limite))),
        incluirPequenas: String(r.incluirPequenas) === '1'
      };
      const mudou = {};
      Object.keys(novo).forEach(c => { if (String(novo[c]) !== String(p[c])) mudou[c] = novo[c]; });
      if (Object.keys(mudou).length) { PlanoEngine.salvarModo(k, mudou); showToast(m.rot + ' ajustado ✓'); }
      else showToast('Nada mudou neste modo');
    }
    if (eraAtivo) PlanoEngine.salvarPrefs(PlanoEngine.modoPatch(k));
    this.renderPlano();
  },
  renderPlanoConteudo() {
    const proj = document.getElementById('plano-proj');
    const lista = document.getElementById('plano-lista');
    if (!proj || !lista) return;
    // com os ajustes recolhidos, o cabecalho mostra o que esta valendo
    try { if (window.PainelRecolhivel) PainelRecolhivel.sincronizar('plano-filtros'); }
    catch (e) { _quiet(e, 'resumo-plano'); }
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
      limite: Math.max(5, num('plano-limite', 30)),
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
    const medido = PlanoEngine.ritmoRecente(descSnaps, 120) || 25;
    const digitado = Math.max(1, num('plano-ritmo', medido));
    opts.ritmoSemanal = (digitado === medido) ? null : digitado;
    PlanoEngine.salvarPrefs(opts);
    // ajuste novo invalida o retrato em cache usado ao criar atividades
    this._planoRefC = null;
    opts.ritmoSemanal = opts.ritmoSemanal || medido;
    const r = PlanoEngine.calcular(this.scopedSnapshot(), opts);
    // liga cada assunto à atividade extra já criada para ele (ciclo de acompanhamento)
    if (r && r.itens) {
      const extras = DB.getExtras().filter(e => e.origemPlano && e.origemPlano.topico);
      const casar = (x) => extras.find(e => ReforcoEngine.norm(e.origemPlano.topico) === ReforcoEngine.norm(x.nome));
      [].concat(r.itens, r.pequenas || []).forEach(x => {
        const e = casar(x);
        if (!e) return;
        x.extra = e; x.extraAlvo = e.alvo || 0;
        x.extraFeito = DB.extraProgressoPeriodo ? DB.extraProgressoPeriodo(e) : (e.progresso || 0);
        x.extraConcluida = e.status === 'concluida' || (e.alvo > 0 && x.extraFeito >= e.alvo);
      });
    }
    if (r.erro === 'sem-retrato') {
      proj.innerHTML = `<p class="hint" style="padding:18px 0;">Importe ao menos um retrato de desempenho em <strong>📊 Análise</strong>.</p>`;
      lista.innerHTML = ''; return;
    }
    if (r.erro === 'amostra') {
      proj.innerHTML = `<p class="hint" style="padding:18px 0;">Nenhum assunto atingiu a amostra mínima de <strong>${opts.minAmostra}</strong> questões. Reduza esse valor nos ajustes avançados ou resolva mais questões.</p>`;
      lista.innerHTML = ''; return;
    }
    const tom = r.jaAtinge ? 'good' : (r.falta <= 8 ? 'warn' : 'bad');
    const pond = r.ponderacao === 'volume' ? 'peso pelo volume praticado' : 'todo assunto com o mesmo peso';
    const aviso = (txt, cor) => `<p class="pl-aviso" style="border-color:var(--${cor});background:var(--${cor}-soft);color:var(--${cor}-text);">${txt}</p>`;
    proj.innerHTML = `
      <div class="pl-hero">
        <div class="pl-hero-top">
          <span class="pl-hero-num tone-${tom}">${r.dominioPct.toFixed(1)}%</span>
          <span class="pl-hero-uni">de domínio</span>
        </div>
        <p class="pl-hero-sub">
          Média de acerto nos <strong>${r.assuntos}</strong> ${r.assuntos === 1 ? 'assunto' : 'assuntos'} com amostra suficiente ·
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

        <div class="pl-chips">
          <span class="pl-chip res" style="border-color:var(--good);color:var(--good-text);" title="Sustentaram a meta em ${r.consolidarEm}+ importações seguidas, com medição recente">🟢 ${r.solidosAtuais} sólidos</span>
          ${r.solidosVencidos ? `<span class="pl-chip res" style="border-color:var(--warn);color:var(--warn-text);" title="Sustentaram a meta, mas a última medição tem mais de ${r.validadeDias} dias — remeça antes de riscar da lista">🟠 ${r.solidosVencidos} sólidos sem medição nova</span>` : ''}
          ${r.recentes ? `<span class="pl-chip res" style="border-color:var(--warn);color:var(--warn-text);" title="Cruzaram a meta há pouco — ainda não provaram que fixaram">🟡 ${r.recentes} recém-corrigidos</span>` : ''}
          ${(r.melhorando || r.piorando) ? `<span class="pl-chip res" style="border-color:var(--${r.melhorando >= r.piorando ? 'good' : 'bad'});color:var(--${r.melhorando >= r.piorando ? 'good' : 'bad'}-text);" title="Variação acima de ${r.sensTendencia}pp contra o histórico">📊 ${r.melhorando} melhorando · ${r.piorando} piorando</span>` : ''}
          ${r.vencidos ? `<span class="pl-chip res" style="border-color:var(--bad);color:var(--bad-text);" title="Sem medição nova há mais de ${r.validadeDias} dias">⏳ ${r.vencidos} com dado vencido</span>` : ''}
          ${r.ignorados ? `<span class="pl-chip res" style="border-color:var(--warn);color:var(--warn-text);" title="Sem amostra suficiente — veja o segundo plano no fim">🕳️ ${r.ignorados} sem diagnóstico</span>` : ''}
        </div>
        <div class="pl-chips" style="margin-top:6px;">
          <span class="pl-chip cfg">amostra-alvo ${r.amostraAlvo}q</span>
          <span class="pl-chip cfg">ritmo ${r.ritmo}/sem${r.ritmoMedido === r.ritmo ? ' (medido)' : ''}</span>
          <span class="pl-chip cfg">${pond}</span>
        </div>

        ${r.ignorados >= r.assuntos * 0.5 ? aviso(
          `📐 Este ${r.dominioPct.toFixed(0)}% descreve só os <strong>${r.assuntos}</strong> assuntos medidos. Outros <strong>${r.ignorados}</strong> ainda não têm dado — bater a meta aqui não é dominar a disciplina inteira.`, 'warn') : ''}
        ${r.alvoInviavel ? aviso(
          `⚙ Alvo de amostra alto para o seu volume: só ${r.comAlvo} de ${r.assuntos} chegam a ${r.amostraAlvo} questões (o maior tem ${r.maiorAmostra}). Experimente <strong>${r.maiorAmostra >= 100 ? 100 : r.maiorAmostra >= 50 ? 50 : 30}</strong> em "Amostra confiável".`, 'warn') : ''}
        ${r.defasado ? aviso(
          `⏳ Última importação há <strong>${r.idadeUltimo} dias</strong> — você definiu ${r.cadenciaDias}. Importe um novo período para a leitura refletir seu nível de hoje.`, 'warn') : ''}
      </div>`;

    // ── Trajetória do domínio a cada importação ──
    const S = r.serie || [];
    let grafico = '';
    if (S.length >= 2) {
      const W = 100, H = 34;
      const lo = Math.max(0, Math.min(...S.map(p => p.dominio), r.meta) - 6);
      const hi = Math.min(100, Math.max(...S.map(p => p.dominio), r.meta) + 6);
      const px = (i) => (S.length === 1 ? W / 2 : i / (S.length - 1) * W);
      const py = (v) => H - (v - lo) / Math.max(1, hi - lo) * H;
      const pts = S.map((p, i) => `${px(i).toFixed(1)},${py(p.dominio).toFixed(1)}`).join(' ');
      const yMeta = py(r.meta).toFixed(1);
      const ganho = S[S.length - 1].dominio - S[0].dominio;
      const rend = S.filter(p => p.rendimento != null);
      const rendMedio = rend.length ? rend.reduce((a, p) => a + p.rendimento, 0) / rend.length : null;
      const ultimo = S[S.length - 1];
      grafico = `
        <div class="card" style="background:var(--surface-sunken);box-shadow:var(--shadow-sm);border:1.5px solid var(--border);margin:0 0 16px;">
          <div style="padding:14px 16px;">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;">
              <strong style="font-size: var(--fs-sm);">📈 Sua trajetória</strong>
              <span class="reforco-tag ${ganho >= 0 ? 'tone-good' : 'tone-bad'}">${ganho >= 0 ? '+' : ''}${ganho.toFixed(1)}pp em ${S.length} importações</span>
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
            ${rendMedio != null ? `<p class="pl-prosa" style="margin:10px 0 0;">
              <strong>Retorno do seu esforço:</strong> ${rendMedio.toFixed(1)}pp de domínio a cada 100 questões resolvidas.
              ${S[S.length - 1].rendimento != null ? 'No último período foram ' + S[S.length - 1].rendimento.toFixed(1) + 'pp por 100 questões' +
                (S[S.length - 1].rendimento < rendMedio * 0.5 ? ' — bem abaixo da sua média, sinal de que só aumentar o volume parou de funcionar neste momento.' : '.') : ''}
            </p>` : ''}
          </div>
        </div>`;
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
    const linhas = r.itens.map((x, i) => {
      const sens = r.sensTendencia || 3;
      /* O ▲▼ agora compara a janela com o período ANTERIOR a ela. Quando não
         existe período anterior, a tela diz isso — antes simplesmente não
         mostrava nada, e "sem seta" era lido como "estável". */
      const seta = x.delta == null
        ? (x.qAntes === 0 ? `<span class="reforco-tag" title="Não há período anterior a esta janela para comparar: é a primeira medição do assunto.">🆕 primeira medição</span>` : '')
        : x.delta >= sens ? `<span class="reforco-tag tone-good" title="Acima do que você fazia no período anterior a esta janela">▲ ${x.delta}pp</span>` :
          x.delta <= -sens ? `<span class="reforco-tag tone-bad" title="Abaixo do que você fazia no período anterior a esta janela">▼ ${x.delta}pp</span>` : '';
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
      // Caixinhas numéricas (leitura rápida do status).
      const metricas = `
        <div class="pl-metrics">
          <div class="plm"><b class="tone-${x.conf.tom}">${x.taxa.toFixed(0)}%</b><span>acerto${x.margem != null ? ' ±' + x.margem.toFixed(0) : ''}</span></div>
          <div class="plm"><b class="tone-${dirTom}">${faltaMeta > 0 ? faltaMeta.toFixed(0) : '✓'}</b><span>pts p/ meta</span></div>
          <div class="plm"><b>${x.custoQ}</b><span>questões (custo)</span></div>
          <div class="plm"><b>${x.qJanela}</b><span>na amostra</span></div>
        </div>`;
      // Guia expansível (orientação completa) — aberta só nos primeiros itens (prioridade).
      const abreGuia = (r.idxMeta < 0 || i <= Math.max(r.idxMeta, 2));
      const guia = `
        <details class="pl-guia" ${abreGuia ? 'open' : ''}>
          <summary>💡 Por que está aqui, e o que fazer <span class="chev">▾</span></summary>
          <div class="pl-guia-body">
            <p class="pl-porque-item">${escapeHtml(motivoDaPosicao(x, i))}</p>
            <p class="pl-base">Máximo realista ${r.teto}% · faltam <b>${(r.teto - x.taxa).toFixed(0)} pts</b> até lá · medido em <b>${x.qJanela}</b> questões${x.diasJanela ? ' dos últimos <b>' + x.diasJanela + '</b> dias' : ''}${x.qHist > x.qJanela ? ' (de <b>' + x.qHist + '</b> no total)' : ''}${x.pctAntes != null ? ' · antes dessa janela você fazia <b>' + x.pctAntes.toFixed(0) + '%</b>' : ''}.</p>
            <p class="pl-base">Custo estimado de <b>${x.custoQ}</b> questões${r.custoModo === 'lacuna' ? ' = ' + r.custoPiso + ' para remedir + ' + Math.round(r.custoPorPonto * x.lacunaPP * x.amplitude) + ' pela lacuna de ' + x.lacunaPP.toFixed(0) + ' pontos' + (Math.abs(x.amplitude - 1) > 0.08 ? ' num assunto ' + (x.amplitude > 1 ? 'mais amplo' : 'mais estreito') + ' que a sua média (×' + x.amplitude.toFixed(1).replace('.', ',') + ')' : '') : ''}.</p>
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
            <p class="pl-direcao tone-${dirTom}"><span class="seta">➜</span><span>${escapeHtml(x.status.acao)}</span></p>
            ${metricas}
            ${guia}
            <div class="pl-rodape">
              ${x.extra
                ? `<span class="reforco-tag ${x.extraConcluida ? 'tone-good' : 'incid'}">${x.extraConcluida ? '✓ meta batida' : '▶ ' + x.extraFeito + '/' + x.extraAlvo}</span>`
                : `<button type="button" class="btn-secondary plano-nova-extra" style="padding:6px 12px;font-size: var(--fs-2xs);white-space:nowrap;" data-topico="${escapeHtml(x.nome)}"
                     data-disc="${escapeHtml(x.disciplina || '')}" data-alvo="${x.custoQ}" data-motivo="reforco">+ Atividade</button>`}
            </div>
          </div>
        </div>${marca}`;
    }).join('');
    const pequenas = r.pequenas.length ? `
      <div style="margin-top:22px;padding-top:16px;border-top:2px solid var(--border);">
        <p class="section-label" style="margin:0 0 4px;">🕳️ Segundo plano — assuntos sem diagnóstico</p>
        <p class="pl-prosa" style="margin:0 0 12px;">
          Menos de ${opts.minAmostra} questões resolvidas: ainda não dá para afirmar que é fraqueza.
          Ficam fora da média de domínio de propósito — com amostra assim pequena a taxa real pode variar dezenas de pontos.
          <strong>Aqui a ação é outra:</strong> resolver questões para descobrir onde você está.
        </p>
        ${r.pequenas.slice(0, 15).map((x, i) => `
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
      </div>` : '';
    /* COMO LER — enxugado de oito parágrafos para três. Os outros cinco viraram
       "i" no lugar exato onde o termo aparece: explicação que só existe num
       texto de apoio no fim da tela é explicação que ninguém lê na hora da
       dúvida. Este bloco fica no RODAPÉ agora, como referência, e não como a
       primeira coisa entre você e a sua lista. */
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
        if (bloco.length >= 5 || somaQ >= capacidade) break;
        bloco.push(x); somaQ += x.custoQ;
      }
      const semanasBloco = Math.max(1, Math.round(somaQ / capacidade));
      // os próximos da fila, para escolher ou apenas enxergar o que vem depois
      const proximos = r.itens.slice(bloco.length, bloco.length + 8);
      const linhaHoje = (x, dentro) => `
        <li class="${dentro ? '' : 'fora'}">
          <label class="pl-hoje-check">
            <input type="checkbox" class="pl-hoje-sel" ${dentro ? 'checked' : ''} ${x.extra ? 'disabled' : ''}
              data-topico="${escapeHtml(x.nome)}" data-disc="${escapeHtml(x.disciplina || '')}" data-alvo="${x.custoQ}">
            <span class="pl-hoje-nome">${escapeHtml(x.nome)}</span>
          </label>
          <span class="pl-hoje-num tone-${x.conf.tom}">${x.taxa.toFixed(0)}%</span>
          <span class="pl-hoje-q">${x.custoQ}q</span>
          ${x.extra ? `<span class="reforco-tag ${x.extraConcluida ? 'tone-good' : 'incid'}">${x.extraConcluida ? '✓' : x.extraFeito + '/' + x.extraAlvo}</span>` : ''}
        </li>`;
      hoje = `
        <div class="pl-hoje">
          <div class="pl-hoje-top">
            <strong>🎯 O seu próximo bloco</strong>
            <span>${bloco.length} ${bloco.length === 1 ? 'assunto' : 'assuntos'} · ${somaQ.toLocaleString('pt-BR')} questões · ≈${semanasBloco} ${semanasBloco === 1 ? 'semana' : 'semanas'} no seu ritmo de ${capacidade}/sem</span>
          </div>
          <ol class="pl-hoje-lista">
            ${bloco.map(x => linhaHoje(x, true)).join('')}
            ${proximos.length ? `<li class="pl-hoje-sep">depois destes, a fila segue com:</li>` + proximos.map(x => linhaHoje(x, false)).join('') : ''}
          </ol>
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
      edital = `
        <div class="pl-edital">
          <p class="section-label" style="margin:0 0 4px;">🚧 Do seu planejamento, sem medição no TEC</p>
          <p class="pl-prosa" style="margin:0 0 10px;">
            O Plano só enxerga o que você praticou. Estas disciplinas estão no seu planejamento e
            <strong>não têm questões suficientes</strong> para entrar em nenhuma conta desta tela —
            não aparecem como fracas porque não aparecem de jeito nenhum.
            ${lac.medidas} de ${lac.total} disciplinas do plano estão medidas.
          </p>
          ${lac.sem.length ? `<p class="pl-edital-linha"><b>Nunca praticadas:</b> ${lac.sem.map(d => chip(d, '')).join('')}</p>` : ''}
          ${lac.pouca.length ? `<p class="pl-edital-linha"><b>Quase sem dado:</b> ${lac.pouca.map(d => chip(d, ' · ' + d.q + 'q')).join('')}</p>` : ''}
          ${lac.naoCasaram.length ? `<p class="pl-prosa" style="margin:10px 0 0;color:var(--text-faint);">
            O cruzamento é pelo NOME da disciplina. Estas existem no TEC e não em nenhuma disciplina do seu planejamento —
            se alguma for a mesma coisa com outro nome, renomeie para o app parar de contá-la à parte:
            ${lac.naoCasaram.map(n => escapeHtml(n)).join(' · ')}</p>` : ''}
        </div>`;
    }

    lista.innerHTML = (linhas
      ? hoje + grafico + ordemNota + porQue + linhas
      : `<p class="hint" style="padding:18px 0;">Nenhum assunto abaixo do máximo realista — você já domina tudo que pratica.</p>`) + pequenas + edital + comoLer;
    lista.querySelectorAll('.plano-nova-extra').forEach(b => b.addEventListener('click', () => {
      this.criarExtraDoPlano(b.dataset.topico, b.dataset.disc, b.dataset.alvo, b.dataset.motivo);
    }));
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
  document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(b => b.addEventListener('click', () => DT.switchTecTab(b.dataset.tectab)));
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
    const aplicar = () => {
      if (id === 'plano-pesobanca') {
        const v = document.getElementById('plano-pesobanca');
        const l = document.getElementById('plano-pesobanca-label');
        if (v && l) l.textContent = (parseInt(v.value, 10) === 0) ? '0 — banca ignorada' : v.value;
      }
      DT.renderPlanoConteudo();
      DT.renderModosDeAtaque();
    };
    on(id, 'change', aplicar);
    on(id, 'input', aplicar);
  });
  /* Ajustes do Plano recolhidos por padrao. O resumo traz os tres que mudam a
     leitura da lista: a disciplina, a ordenacao e a meta de dominio. */
  PainelRecolhivel.registrar({
    id: 'plano-filtros',
    corpo: 'plano-filtros-body',
    botao: 'plano-filtros-collapse',
    texto: 'plano-filtros-collapse-txt',
    resumo: 'plano-filtros-resumo',
    rotuloAberto: 'Ocultar ajustes',
    rotuloFechado: 'Mostrar ajustes',
    calcResumo() {
      const sel = (id) => { const e = document.getElementById(id); return e && e.options && e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : ''; };
      const num = (id) => { const e = document.getElementById(id); return e && e.value ? e.value : ''; };
      const disc = sel('plano-disc') || 'Todas';
      // a ordenacao vem com emoji no rotulo; aqui so o texto interessa
      const ord = (sel('plano-ordenar') || '').replace(/^[^\p{L}]+/u, '').split(' — ')[0];
      const meta = num('plano-meta');
      return [disc, ord, meta ? 'meta ' + meta + '%' : ''].filter(Boolean).join(' · ');
    },
  });

  on('plano-reset', 'click', async () => {
    if (!await UI.confirm('Voltar todos os ajustes do Plano aos valores padrão?', { title: 'Restaurar padrões' })) return;
    DB.delRaw(DB._profilePrefix() + PlanoEngine.KEY_PREF);
    PlanoEngine._c = null;
    DT.renderPlano();
    showToast('Ajustes restaurados ✓');
  });
  on('plano-adv-btn', 'click', () => {
    const box = document.getElementById('plano-advanced');
    const btn = document.getElementById('plano-adv-btn');
    if (!box || !btn) return;
    const aberto = !box.hasAttribute('hidden');
    if (aberto) box.setAttribute('hidden', ''); else box.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', aberto ? 'false' : 'true');
    const ch = btn.querySelector('.chev'); if (ch) ch.textContent = aberto ? '▸' : '▾';
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
  // painel de ajustes avançados (recolhível)
  const advBtn = document.getElementById('reforco-adv-btn');
  const advPanel = document.getElementById('reforco-advanced');
  if (advBtn && advPanel) advBtn.addEventListener('click', () => {
    const open = advPanel.hasAttribute('hidden');
    if (open) advPanel.removeAttribute('hidden'); else advPanel.setAttribute('hidden', '');
    advBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'desempenhotec') DesempenhoTecScreen.render();
});
