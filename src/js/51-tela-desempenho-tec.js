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
/* A decisão de prioridade vive exclusivamente em MotorSugestao.
   Esta tela mantém apenas importação, fatos do TEC e apresentação. */



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
/* O acompanhamento das atividades do Motor vive em MotorCiclo. */



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
    motor: { t: '🧭 Ajustes do Motor', s: 'Uma régua simples: meta, amostra mínima e tamanho fixo do reforço.' }
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
      p.push(['amostra mínima', m.minAmostra + ' questões']);
      p.push(['reforço', m.alvoQuestoes + ' questões']);
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
    /* O ciclo é iterativo: um retrato realmente novo recalcula TODAS as
       disciplinas. Quem saiu do grupo prioritário libera a vaga; quem continua
       entre as maiores lacunas permanece elegível para a próxima rodada. */
    try {
      const ultimo = snaps[snaps.length - 1] || {};
      const sel = String(ultimo.id || '') + '|' + String(ultimo.endDate || ultimo.date || ultimo.startDate || '');
      if (this._cicloSel !== sel) {
        this._cicloSel = sel;
        const rc = MotorCiclo.conciliar();
        if (rc.fechadas.length) {
          const partes = [];
          if (rc.resolvidas.length) partes.push(rc.resolvidas.length + ' lacuna(s) fechada(s)');
          if (rc.rotacionadas.length) partes.push(rc.rotacionadas.length + ' matéria(s) rotacionada(s)');
          if (rc.rodadas.length) partes.push(rc.rodadas.length + ' rodada(s) concluída(s)');
          showToast('🧭 Motor recalculado pelo novo retrato' + (partes.length ? ' · ' + partes.join(' · ') : ''));
        }
      }
    } catch (e) { _quiet(e, 'motor-ciclo-conciliar'); }
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
      const antiga = p.banca && p.banca !== '__todas__' ? p.banca : null;
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
  /* O antigo filtro "matérias fora do Plano" foi removido junto com o Plano
     legado. O recorte do Motor é exclusivamente o seletor de disciplinas do
     próprio Motor de Sugestão. */
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
    this._motorRefC = null;
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
        DB.deleteTecSnapshot(id);
        this.selectedSnapIds.delete(id);
        this._scopedC = null;
        this._motorRefC = null;
        showToast('Retrato excluído');
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
  // ---- Atividades do único Motor de Sugestão ----
  _motorRef() {
    const agora = Date.now();
    if (this._motorRefC && agora - this._motorRefC.t < 1500) return this._motorRefC.r;
    const r = MotorSugestao.calcular();
    this._motorRefC = { t: agora, r };
    return r;
  },
  _casaTopico(origem, nome, disciplina) {
    if (!origem || ReforcoEngine.norm(origem.topico || '') !== ReforcoEngine.norm(nome || '')) return false;
    const a = ReforcoEngine.norm(origem.disciplina || ''), b = ReforcoEngine.norm(disciplina || '');
    return (!a || !b) ? true : a === b;
  },
  _casaUnidade(origem, item) {
    return !!(typeof MotorSugestao !== 'undefined' && MotorSugestao.mesmaUnidade(origem, item));
  },
  _unidadeDoMotor(topico, disciplina) {
    const r = this._motorRef();
    return [].concat((r && r.todos) || [], (r && r.itens) || [])
      .find(t => this._casaTopico({ topico: t.nome, disciplina: t.disciplina }, topico, disciplina)) || null;
  },
  async _confirmarSobreposicao(topico, disciplina) {
    const u = this._unidadeDoMotor(topico, disciplina);
    const so = MotorCiclo.atividadeSobreposta(topico, disciplina, u && u.membros);
    if (!so) return true;
    const dela = so.extra.titulo || so.noDela;
    return !!(await UI.confirm(
      'Já existe uma atividade aberta na mesma disciplina/escopo: <b>' + escapeHtml(dela) + '</b>.<br><br>'
      + 'O Motor trabalha com uma frente ativa por disciplina em cada rodada. '
      + 'Finalize ou aguarde o próximo retrato recalcular essa matéria antes de abrir outra.',
      { title: 'Frente já em andamento', okText: 'Voltar', html: true }));
  },
  criarExtraDoMotor(topico, disciplina, alvo, motivo, lote, sugerido) {
    const item = sugerido || this._unidadeDoMotor(topico, disciplina) || { nome: topico, disciplina: disciplina || '' };
    const kd = ReforcoEngine.norm(disciplina || '');
    const ativaNaDisc = DB.getExtras().find(e => {
      if (e.status === 'concluida' || typeof MotorCiclo === 'undefined') return false;
      const o = MotorCiclo.origemDe(e);
      return o && ReforcoEngine.norm(o.disciplina || '') === kd;
    });
    if (ativaNaDisc) {
      if (!lote) showToast('Esta disciplina já tem uma frente do Motor em andamento');
      return false;
    }
    if (MotorCiclo.atividadeSobreposta(topico, disciplina, item.membros)) return false;
    const e = DB.addExtra({
      titulo: MotorCiclo.titulo(topico, item.membros),
      tipo: 'questoes',
      disciplina: disciplina || '',
      unidade: 'questoes',
      alvo: Math.max(1, parseInt(alvo, 10) || MotorSugestao.prefs().alvoQuestoes),
      periodo: 'unica',
      contaMetricas: false,
      obs: 'Gerado pelo Motor de sugestão. Um novo retrato recalcula o ranking e decide se esta matéria continua na rodada.'
    });
    if (!e) return false;
    DB.updateExtra(e.id, { origemMotor: MotorCiclo.origem(topico, disciplina, item) });
    if (!lote) {
      showToast('Atividade do Motor criada: ' + topico);
      if (this.tecTab === 'motor') this.renderMotor();
    }
    return true;
  },
  /* Filtro do Motor: estado próprio, compartilhado com o Puxar do Motor.
     Vazio significa "todas". Trocar uma caixa repinta o resultado, mas reabre
     o mesmo painel, no mesmo scroll e com a mesma busca — multiseleção não pode
     parecer um formulário que reinicia a cada clique. */
  _motorDiscFilterHtml(disciplinas, prefs) {
    const lista = (disciplinas || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const sel = (prefs && Array.isArray(prefs.disciplinasSel)) ? prefs.disciplinasSel : [];
    const set = new Set(sel.map(ReforcoEngine.norm));
    const rot = !sel.length ? 'Todas as disciplinas'
      : sel.length === 1 ? sel[0]
      : sel.length + ' disciplinas selecionadas';
    return '<div class="ms-disc-filter">'
      + '<div class="ms-disc-filter-label"><b>Disciplinas que o Motor pode sugerir</b><small>Vazio = todas. Este mesmo recorte vale no Puxar do Motor em Atividades Extras.</small></div>'
      + '<button type="button" class="ms-disc-filter-btn" aria-expanded="false"><span>' + escapeHtml(rot) + '</span><i>▾</i></button>'
      + '<div class="ms-disc-filter-panel" hidden>'
      + '<button type="button" class="ms-disc-filter-all ' + (!sel.length ? 'is-active' : '') + '" data-ms-disc-all>'
      + '<span class="ms-disc-all-mark">✓</span><span><b>Todas as disciplinas</b><small>Deixar o Motor considerar qualquer matéria do escopo TEC</small></span></button>'
      + '<label class="ms-disc-filter-search"><span>⌕</span><input type="search" placeholder="Buscar disciplina" autocomplete="off"></label>'
      + '<div class="ms-disc-filter-list">'
      + lista.map(d => '<label class="ms-disc-filter-item" data-s="' + escapeHtml(ReforcoEngine.norm(d)) + '">'
        + '<input type="checkbox" value="' + escapeHtml(d) + '" ' + (set.has(ReforcoEngine.norm(d)) ? 'checked' : '') + '>'
        + '<span>' + escapeHtml(d) + '</span></label>').join('')
      + '</div>'
      + '<div class="ms-disc-filter-foot"><span>' + (sel.length ? sel.length + ' no recorte' : lista.length + ' disponíveis') + '</span></div>'
      + '</div></div>';
  },
  _bindMotorDiscFilter(host) {
    const wrap = host && host.querySelector('.ms-disc-filter');
    if (!wrap) return;
    const btn = wrap.querySelector('.ms-disc-filter-btn');
    const panel = wrap.querySelector('.ms-disc-filter-panel');
    const search = wrap.querySelector('input[type="search"]');
    const list = wrap.querySelector('.ms-disc-filter-list');
    const abrir = () => {
      panel.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true');
      if (search) search.focus({ preventScroll: true });
    };
    const fechar = () => { panel.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); };
    btn.onclick = e => {
      e.stopPropagation();
      if (panel.hasAttribute('hidden')) abrir(); else fechar();
    };
    panel.onclick = e => e.stopPropagation();
    const aplicar = lista => {
      this._motorDiscUiRestore = {
        open: true,
        y: list ? list.scrollTop : 0,
        busca: search ? search.value : ''
      };
      MotorSugestao.salvar({ disciplinasSel: lista });
      this.renderMotor();
    };
    panel.querySelectorAll('.ms-disc-filter-item input').forEach(ch => ch.onchange = () => {
      aplicar([...panel.querySelectorAll('.ms-disc-filter-item input:checked')].map(x => x.value));
    });
    const all = panel.querySelector('[data-ms-disc-all]');
    if (all) all.onclick = () => aplicar([]);
    if (search) search.oninput = () => {
      const q = ReforcoEngine.norm(search.value);
      panel.querySelectorAll('.ms-disc-filter-item').forEach(item => {
        item.style.display = !q || (item.dataset.s || '').includes(q) ? '' : 'none';
      });
    };
    const st = this._motorDiscUiRestore;
    if (st && st.open) {
      this._motorDiscUiRestore = null;
      abrir();
      if (search) {
        search.value = st.busca || '';
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      requestAnimationFrame(() => { if (list) list.scrollTop = st.y || 0; });
    }
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
    /* Os campos da folha de Ajustes (piso, alvo, frentes, meta) nascem com o
       valor de fábrica gravado no HTML. Sem isto, reabrir o app (ou só trocar
       de aba e voltar) mostrava sempre 20/25/3/90 mesmo com outro valor salvo
       — o ajuste continuava valendo por baixo, mas a tela mentia que "voltou
       ao padrão". O campo focado não é tocado: o usuário pode estar digitando. */
    ['motor-amostra', 'motor-alvo', 'motor-frentes', 'motor-meta'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || document.activeElement === el) return;
      const val = String(p[el.dataset.cfgKey]);
      if (el.value !== val) el.value = val;
    });
    if (fase) {
      const b = (k, rot, sub) => `<button type="button" data-fase="${k}" class="${p.fase === k ? 'active' : ''}" aria-pressed="${p.fase === k}"><b>${rot}</b><span>${sub}</span></button>`;
      fase.innerHTML = b('pre', 'Pré-edital', 'Maior lacuna até a meta primeiro')
        + b('pos', 'Pós-edital', 'Lacuna × incidência histórica da banca');
    }
    try { TecAjustes.sincronizar('motor'); } catch (e) { _quiet(e, 'motor-resumo'); }
    /* A folha de Ajustes do Motor existe no DOM o tempo todo, só escondida — mas
       o seletor de bancas dentro dela (seção 🏛️ Banca) só nasce quando algo
       manda desenhá-lo. Nada mandava: a seção ficava eternamente vazia, mesmo
       com bancas importadas, porque só o seletor da aba Incidência era pintado.
       Aqui, sempre que o Motor repinta, o seletor da sua própria folha também. */
    try { this.renderBancaPicker('motor-banca-pick'); } catch (e) { _quiet(e, 'motor-banca-pick'); }

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
    const filterHtml = this._motorDiscFilterHtml(r.disciplinasDisponiveis || [], r.prefs || p);
    if (!r.itens.length) {
      host.innerHTML = filterHtml + `<div class="ms-empty-honesto"><span>🧭</span><div><b>Nenhuma lacuna válida neste recorte</b><p>O Motor usa uma regra simples: percentual abaixo da meta e pelo menos ${r.prefs.minAmostra} questões no nível analisado. Amplie o recorte ou acumule mais questões.</p></div></div>`;
      this._bindMotorDiscFilter(host);
      return;
    }

    const fmt1 = v => Math.round(Number(v || 0) * 10) / 10;
    const tom = x => {
      const e = Number(x && x.taxaErro || 0);
      return e >= 50 ? 'critico' : e >= 35 ? 'alto' : e >= 20 ? 'medio' : 'leve';
    };
    const emoji = x => ({ critico: '🚨', alto: '🔥', medio: '⚠️', leve: '📌' }[tom(x)]);

    /* CADA CARTÃO MOSTRA QUATRO NÚMEROS, NUNCA SEIS ─────────────────────────
       A versão anterior repetia a mesma questão sob dois nomes (histórico e
       amostra) e mostrava o piso da régua — igual em toda a rodada — dentro de
       cada cartão. Erro também não é dado novo: é 100 − acerto. O que sobra
       depois de tirar as três repetições é exatamente o que muda de cartão
       para cartão: acerto, lacuna, amostra e — conforme a fase — nível ou
       incidência. Um quarto estável em vez de seis desalinhados. */
    const linhas = r.itens.map((x, i) => {
      const trilha = [x.disciplina].concat(x.caminho || []).filter(Boolean);
      const deGrupo = x.motivoNivel === 'pior-do-grupo';
      const porQue = deGrupo
        ? `Este subtópico tem só ${x.questoes} questão(ões) própria(s) — abaixo do piso de ${r.prefs.minAmostra} —, mas está entre ${x.grupoTamanho} irmãos igualmente fracos sob “${x.pai || 'o mesmo tópico'}” que juntos somam ${x.grupoQuestoes} questões, confirmando que a área é fraca de verdade. Miramos só nele, com o caderno cheio, para não diluir o esforço entre os irmãos: assim ele acumula amostra própria mais rápido e pode “se formar” sozinho no próximo retrato. Os demais continuam na fila.`
        : x.motivoNivel === 'subnivel-insuficiente'
          ? `Mesmo reunindo os subtópicos fracos, o nível abaixo não alcançou ${r.prefs.minAmostra} questões. Só então o motor subiu até este tópico.`
          : `Este nível tem pelo menos ${r.prefs.minAmostra} questões e pode ser usado diretamente.`;
      const quarto = r.fase === 'pos'
        ? `<span><b>${x.peso}</b><i>Incidência</i></span>`
        : `<span><b>Nível ${x.nivel}</b><i>Profundidade</i></span>`;
      return `
        <article class="ms-suggestion-card tone-${tom(x)}" data-i="${i}">
          <div class="ms-suggestion-head">
            <div class="ms-suggestion-rank"><span>${i + 1}</span><i>${emoji(x)}</i></div>
            <div class="ms-suggestion-title">
              <small>${trilha.map(escapeHtml).join(' › ')}</small>
              <h3>${escapeHtml(x.nome)}${deGrupo ? ' <span class="ms-selo">pior de ' + x.grupoTamanho + '</span>' : ''}</h3>
            </div>
            <div class="ms-dose"><b>${x.dose}</b><small>questões</small></div>
          </div>
          <div class="ms-action-context">
            <b>${escapeHtml(x.disciplina)}</b>
            <span>${fmt1(x.disciplinaTaxa)}% geral</span>
            <span>lacuna ${fmt1(x.disciplinaLacuna)}pp</span>
            ${r.fase === 'pos' ? '<span>incidência ' + fmt1(x.disciplinaIncidencia) + ' · prioridade ' + fmt1(x.disciplinaPrioridade) + '</span>' : ''}
          </div>
          <div class="ms-suggestion-metrics">
            <span><b>${fmt1(x.taxa)}%</b><i>Acerto</i></span>
            <span><b>${fmt1(x.gapMeta)}pp</b><i>lacuna p/ meta</i></span>
            <span><b>${x.questoes} q</b><i>Amostra</i></span>
            ${quarto}
          </div>
          <div class="ms-why"><span>💡</span><p><b>Por que este nível?</b> ${escapeHtml(porQue)}</p></div>
          <div class="ms-suggestion-action">
            <button type="button" class="btn-primary" data-motor-extra="${i}">Criar reforço de ${x.dose} questões</button>
          </div>
        </article>`;
    }).join('');

    /* RANKING E FILA VIRAM SANFONA, NÃO CAIXA COM SCROLL PRÓPRIO ─────────────
       Uma caixa de altura fixa com barra de rolagem própria, dentro de uma
       página que já rola, é a receita clássica do "scroll preso": o dedo
       entra na caixa pequena e a página grande para de responder. Aqui cada
       matéria vira seu próprio <details> — fecha por padrão, ocupando uma
       linha só — e quando o que estiver aberto passa da tela, é a PÁGINA que
       rola, do jeito que qualquer rolagem no celular deveria se comportar. */
    /* NENHUMA MATÉRIA FICA COM UM "—" MUDO ───────────────────────────────────
       Lacuna real (a matéria está no ranking) e recorte executável (existe um
       tópico ou grupo de irmãos que vira atividade) são coisas diferentes, e
       há dois motivos distintos para o segundo faltar mesmo quando a matéria
       aparece com lacuna: (1) a matéria inteira ainda tem pouca amostra — já
       avisado abaixo — ou (2) a amostra é suficiente, mas está pulverizada
       entre subtópicos: o agrupamento só junta IRMÃOS do mesmo pai, então uma
       fraqueza espalhada por ramos diferentes nunca fecha o piso de questões,
       por maior que seja a soma. Sem esta linha, as duas situações pareciam
       o mesmo "—" indistinto — e a segunda, em especial, parece um bug. */
    const discRank = (r.disciplinas || []).map((d, i) => {
      const t = d.melhorTopico;
      const statusAmostra = d.amostraMinima
        ? d.questoes + ' q'
        : d.questoes + ' q na matéria — ainda sem recorte executável';
      const entrada = t
        ? escapeHtml(t.nome) + ' (' + fmt1(t.taxa) + '%)'
        : d.amostraMinima
          ? '⚠️ ' + d.questoes + ' q na matéria, mas espalhadas: nenhum tópico ou grupo de irmãos do mesmo pai reúne as ' + r.prefs.minAmostra + ' q exigidas'
          : '—';
      return `<li><span>${emoji({ taxaErro: d.taxaErro })}</span><div>
        <b>${i + 1}. ${escapeHtml(d.nome)}</b>
        <small>${fmt1(d.taxa)}% geral · lacuna ${fmt1(d.lacunaDisc)}pp · ${statusAmostra}${r.fase === 'pos' ? ' · incidência ' + fmt1(d.incidenciaDisc) + ' · prioridade ' + fmt1(d.score) : ''}</small>
        <small>entrada: ${entrada} · ${(d.fila || []).length} frente(s) na fila</small>
      </div></li>`;
    }).join('');

    /* A TRILHA MOSTRA A FRONTEIRA ENTRE RAMOS ────────────────────────────────
       A fila NUNCA ordena as folhas todas juntas pelo próprio percentual — ela
       mantém cada ramo (mesmo tópico-pai) contíguo, e só decide a ordem ENTRE
       ramos pelo ramo inteiro, não pela folha isolada. Sem mostrar de qual pai
       cada item vem, essa regra é invisível: um 44% aparecendo antes de um
       42% parece erro de ordenação quando na verdade são famílias diferentes.
       O caminho (curto, só até o pai imediato) é o que deixa essa fronteira
       visível sem enfeite. */
    const filas = (r.disciplinas || []).map(d => {
      const itens = (d.fila || []).slice(0, 15).map((x, i) => {
        const trilha = (x.caminho || []).filter(Boolean);
        return `<li><span>${emoji(x)}</span><div><b>${i + 1}. ${escapeHtml(x.nome)}</b>`
          + (trilha.length ? `<small class="ms-item-trilha">${trilha.map(escapeHtml).join(' › ')}</small>` : '')
          + `<small>${fmt1(x.taxa)}% acerto · lacuna ${fmt1(x.gapMeta)}pp · ${x.questoes} q · nível ${x.nivel}${x.motivoNivel === 'pior-do-grupo' ? ' · pior de ' + x.grupoTamanho : ''}</small></div></li>`;
      }).join('');
      return `<details class="ms-queue-item"><summary><span>${emoji(d.melhorTopico || {})}</span><b>${escapeHtml(d.nome)}</b><small>${(d.fila || []).length} frente(s)</small><i class="ms-chevron"></i></summary><ol>${itens}</ol></details>`;
    }).join('');

    const somaDose = r.itens.reduce((s, x) => s + Number(x.dose || 0), 0);
    host.innerHTML = filterHtml + `
      <div class="ms-rule-summary">
        <span>🧭 ${r.itens.length} MATÉRIAS NA RODADA</span>
        <span>🧩 1 FRENTE DE CADA</span>
        <span>📚 ${r.prefs.alvoQuestoes} QUESTÕES POR ATIVIDADE</span>
        <span>🧪 PISO ${r.prefs.minAmostra} Q/NÍVEL</span>
        <span>🎯 META ${r.prefs.metaAcerto}%</span>
        <span>🛡️ MATÉRIA, DEPOIS TÓPICO</span>
      </div>

      <section class="ms-stage ms-stage-action">
        <header><span>1</span><div><b>Rodada recomendada agora</b><small>${r.fase === 'pos'
          ? 'No pós-edital, o Motor usa uma conta curta e visível: lacuna pessoal × relevância histórica da banca. Depois entra em cada matéria pela frente fraca mais relevante para essa banca.'
          : 'No pré-edital, o Motor ordena somente pela distância até a meta. Depois entra em cada matéria pelo pior tópico que tenha amostra suficiente.'}</small></div></header>
        <div class="ms-suggestion-list">${linhas}</div>
        <p class="ms-round-total">🏁 Se executar a rodada inteira: <b>${somaDose} questões</b> em ${r.itens.length} matéria(s), ${r.prefs.alvoQuestoes} por atividade.</p>
      </section>

      <div class="ms-rankings">
        <details class="ms-rank-panel">
          <summary><span>📊 Por que estas matérias?</span><small>${r.fase === 'pos' ? 'lacuna × relevância histórica da banca' : 'ranking por lacuna simples'}</small><i class="ms-chevron"></i></summary>
          <ol class="ms-rank-list">${discRank}</ol>
        </details>
        <details class="ms-rank-panel">
          <summary><span>🧬 O que vem depois em cada matéria?</span><small>toque numa matéria para abrir a fila</small><i class="ms-chevron"></i></summary>
          <div class="ms-queue-wrap">${filas}</div>
        </details>
      </div>
      <p class="hint ms-nota">📐 Regra estrutural: percentual simples do período selecionado + piso de amostra apenas para a frente executável.${r.fase === 'pos' ? ' A incidência é normalizada dentro da banca selecionada e multiplica a lacuna; sem regressão, intervalo de confiança ou fórmula estatística difícil.' : ''} O Motor só sobe ao pai quando não resta alternativa granular suficiente.</p>`;

    this._bindMotorDiscFilter(host);
    host.querySelectorAll('[data-motor-extra]').forEach(b => b.addEventListener('click', () => {
      const x = r.itens[Number(b.dataset.motorExtra)];
      if (!x) return;
      this.criarExtraDoMotor(x.nome, x.disciplina, x.dose, 'reforco', false, x);
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
    const indent = 10 + Math.min(Math.max(0, level), 8) * 14;
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
      <div class="tnode lvl${lvl}" data-level="${level}" data-haskids="${hasKids ? '1' : '0'}" style="--tec-level-hue:${hue};--tec-indent:${Math.min(Math.max(0, level) * 5, 30)}px">
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
  ['motor-amostra', 'motor-alvo', 'motor-frentes', 'motor-meta'].forEach(id => {
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
let _tecRelationalLoadToken = 0;
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen !== 'desempenhotec') return;
  const id = window.ProfileManager && ProfileManager.getActiveProfileId
    ? ProfileManager.getActiveProfileId() : null;
  if (!window.RelationalStore || !id || RelationalStore.isHeavyReady(id)) {
    DesempenhoTecScreen.render();
    return;
  }

  const token = ++_tecRelationalLoadToken;
  const tela = document.getElementById('screen-desempenhotec');
  if (tela) tela.setAttribute('aria-busy', 'true');
  try { if (typeof showToast === 'function') showToast('Carregando dados do TEC…'); } catch (e) { _quiet(e, 'tec-heavy-toast'); }

  RelationalStore.ensureHeavyData(id, { reason: 'screen-desempenhotec' })
    .then(() => {
      if (token !== _tecRelationalLoadToken) return;
      const atual = document.getElementById('screen-desempenhotec');
      if (atual && atual.classList.contains('active')) DesempenhoTecScreen.render();
    })
    .catch((err) => {
      _quiet(err, 'tec-relational-heavy');
      if (typeof showToast === 'function') showToast('Não foi possível carregar os dados do TEC agora.');
    })
    .finally(() => {
      if (token !== _tecRelationalLoadToken) return;
      if (tela) tela.removeAttribute('aria-busy');
    });
});
