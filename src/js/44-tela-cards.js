/* ============================================================
   TELA: CARDS DE REVISÃO
   ============================================================ */
const CardsScreen = {
  tab: 'revisar',
  filters: { busca: '', materias: new Set(), topico: '', tipo: '', status: 'todos', favorito: false },
  _editingId: null,
  _reviewQueue: [], _reviewIdx: 0, _flipped: false,
  _importParsed: null,

  render() {
    this.populateFilterOptions();
    this.populateTipoSelect();
    this.renderContent();
    this.updateFavCount();
  },
  // ---- opções de filtro (matérias + baralhos, tópicos, tipos) ----
  materiaOptionsHtml(selectedValue) {
    const subs = DB.getActiveSubjects().map(s => `<option value="${escapeHtml(s.nome)}"${selectedValue === s.nome ? ' selected' : ''}>${escapeHtml(s.nome)}</option>`).join('');
    const decks = DB.getDecks().map(d => `<option value="deck:${d.id}"${selectedValue === 'deck:' + d.id ? ' selected' : ''}>📁 ${escapeHtml(d.nome)}</option>`).join('');
    return { subs, decks };
  },
  populateFilterOptions() {
    const mSel = document.getElementById('cards-f-materia');
    const cur = mSel.value;
    const { subs, decks } = this.materiaOptionsHtml(cur);
    mSel.innerHTML = `<option value="">Todas as disciplinas/baralhos</option>` + subs + decks;
    // tópicos existentes nos cards
    const tops = [...new Set(DB.getCards().map(c => c.topico).filter(Boolean))].sort();
    $id('cards-f-topico').innerHTML = `<option value="">Todos os tópicos</option>` + tops.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    $id('cards-f-tipo').innerHTML = `<option value="">Todos os tipos</option>` + CardEngine.TIPOS.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  },
  populateTipoSelect() {
    const sel = document.getElementById('card-tipo');
    if (sel) sel.innerHTML = `<option value="">— sem tipo —</option>` + CardEngine.TIPOS.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  },
  destinoOptionsHtml(selected) {
    const { subs, decks } = this.materiaOptionsHtml();
    // para o destino, valor de matéria = "sub:Nome"; baralho = "deck:id"
    const subOpts = DB.getActiveSubjects().map(s => `<option value="sub:${escapeHtml(s.nome)}"${selected === 'sub:' + s.nome ? ' selected' : ''}>${escapeHtml(s.nome)}</option>`).join('');
    const deckOpts = DB.getDecks().map(d => `<option value="deck:${d.id}"${selected === 'deck:' + d.id ? ' selected' : ''}>📁 ${escapeHtml(d.nome)}</option>`).join('');
    /* BUG CORRIGIDO — perfil novo não conseguia criar o PRIMEIRO card.
       Sem disciplina no Plano e sem baralho criado, este seletor vinha só com o
       texto de instrução. Ao salvar, o app pedia "Escolha o destino" apontando
       para uma lista vazia: beco sem saída, achado simulando o uso real.
       O Anki resolve isso tendo SEMPRE um baralho "Padrão". É o que fazemos:
       quando não há nenhum destino, oferecemos "📁 Padrão", criado na hora em
       que o card for salvo. */
    if (!subOpts && !deckOpts) {
      return `<option value="">Escolha onde este card fica...</option>`
        + `<option value="novo:Padrão"${selected === 'novo:Padrão' ? ' selected' : ''}>📁 Padrão</option>`;
    }
    return `<option value="">Escolha onde este card fica...</option>` + subOpts + deckOpts;
  },
  currentFilteredCards() {
    return CardEngine.applyFilters(DB.getCards(), this.filters);
  },
  updateFavCount() {
    const n = DB.getCards().filter(c => c.favorito).length;
    const el = document.getElementById('cards-fav-count'); if (el) el.textContent = n;
  },

  /* ── TRUE RETENTION ───────────────────────────────────────────────────────
     A estatística que responde "a retenção que eu realmente tenho bate com a
     meta que configurei?". O Anki a separa por MATURIDADE porque as duas contam
     histórias diferentes: cards jovens (intervalo < 21 dias) ainda estão sendo
     aprendidos e erram muito; cards maduros medem retenção de verdade.
     Só contam revisões de LONGO PRAZO — repetir um card no mesmo dia não diz
     nada sobre esquecimento. */
  trueRetention(dias) {
    const revlog = DB.getRevlog() || [];
    const limite = dias ? CardEngine.addDays(todayCards(), -dias) : null;
    const acc = {
      jovem: { total: 0, acertos: 0 }, maduro: { total: 0, acertos: 0 },
      todos: { total: 0, acertos: 0 }, mesmoDia: 0
    };
    revlog.forEach(r => {
      if (!r || !r.grade) return;
      /* Só respostas dadas em REVISÃO, como no Anki (revlog do tipo Review) —
         e como o KPI "Retenção real" do topo desta mesma tela, que filtrava
         phase === 'review' enquanto esta tabela não filtrava nada. Os dois
         cartões diziam "retenção real" e mostravam números diferentes. */
      if ((r.phase || 'review') !== 'review') return;
      if (limite && String(r.date || '') < limite) return;
      if ((r.elapsed || 0) < 1) { acc.mesmoDia++; return; }   // intradiária: fora da conta
      /* Maturidade pelo intervalo que o card tinha na hora (≥ 21 dias = maduro).
         Revisões antigas não guardavam esse campo: para elas usamos o tempo
         realmente decorrido desde a última revisão, que é a melhor aproximação
         disponível — melhor que jogar todo o histórico na coluna "Jovens". */
      const ivl = (r.intervalo != null) ? r.intervalo : (r.elapsed || 0);
      const alvo = ivl >= 21 ? acc.maduro : acc.jovem;
      alvo.total++; acc.todos.total++;
      if (r.grade >= 2) { alvo.acertos++; acc.todos.acertos++; }
    });
    const pct = (o) => o.total ? Math.round((o.acertos / o.total) * 1000) / 10 : null;
    return {
      jovem: Object.assign({ pct: pct(acc.jovem) }, acc.jovem),
      maduro: Object.assign({ pct: pct(acc.maduro) }, acc.maduro),
      todos: Object.assign({ pct: pct(acc.todos) }, acc.todos),
      mesmoDia: acc.mesmoDia,
      meta: Math.round((CardsConfig.get().retention || 0.9) * 100)
    };
  },

  /* ── PREVISÃO DE CARGA ────────────────────────────────────────────────────
     Quantos cards vencem por dia daqui para a frente. Serve para responder
     "posso aumentar o limite de novos?" ANTES de aumentar e se arrepender. */
  previsaoCarga(dias) {
    dias = dias || 30;
    const hoje = todayCards();
    const mapa = {};
    for (let i = 0; i <= dias; i++) mapa[CardEngine.addDays(hoje, i)] = 0;
    let atrasados = 0;
    DB.getCards().forEach(c => {
      if (c.suspenso || !c.due) return;
      if (this._bucket(c) === 'new') return;
      if (c.due < hoje) { atrasados++; return; }
      if (mapa[c.due] !== undefined) mapa[c.due]++;
    });
    const serie = Object.keys(mapa).sort().map(d => ({ dia: d, n: mapa[d] }));
    const total = serie.reduce((a, x) => a + x.n, 0);
    return {
      serie, atrasados, total,
      media: serie.length ? Math.round(total / serie.length * 10) / 10 : 0,
      pico: serie.reduce((a, x) => Math.max(a, x.n), 0)
    };
  },

  /* ── REPOSICIONAR CARDS NOVOS ─────────────────────────────────────────────
     Equivale ao "Reposition" do Anki: reordena a fila de cards novos sem tocar
     em nada mais. Útil quando você adiciona 200 cards de uma matéria nova e
     quer intercalá-los com os que já estavam esperando, em vez de empurrar
     todos para o fim. */
  reposicionarNovos(modo, escopo) {
    const cards = DB.getCards().filter(c => this._bucket(c) === 'new' && (!escopo || c.deckId === escopo));
    if (!cards.length) return 0;
    let ordem = cards.slice();
    if (modo === 'aleatoria') {
      for (let i = ordem.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = ordem[i]; ordem[i] = ordem[j]; ordem[j] = t; }
    } else if (modo === 'inverso') {
      ordem.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    } else {
      ordem.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    }
    ordem.forEach((c, i) => DB.updateCard(c.id, { posicaoNova: i }));
    return ordem.length;
  },

  // ---- conteúdo (revisar ou meus cards) ----
  renderContent() {
    const box = document.getElementById('cards-content');
    if (this.tab === 'revisar') this.renderRevisar(box);
    else if (this.tab === 'stats') this.renderStats(box);
    else this.renderMeus(box);
  },
  materiaLabel(c) {
    if (c.deckId) { const d = DB.getDecks().find(x => x.id === c.deckId); return d ? '📁 ' + d.nome : '📁 (baralho removido)'; }
    return c.materia || 'Sem disciplina';
  },
  // classifica um card para os limites diários
  _bucket(c) {
    const ph = c.phase || (((c.reps || 0) > 0 && (c.intervalo || 0) > 0) ? 'review' : 'new');
    if (ph === 'new') return 'new';
    if (ph === 'learning' || ph === 'relearning') return 'learn';
    return 'review';
  },
  // Monta a fila do dia respeitando os LIMITES diários (novos/revisões) — como o Anki.
  buildQueue() {
    // cards suspensos (leech) ficam fora da fila, como no Anki
    const filtered = this.currentFilteredCards().filter(c => !c.suspenso);
    const due = filtered.filter(c => CardEngine.isDue(c));
    const newRem = CardsConfig.newRemaining(), revRem = CardsConfig.revRemaining();
    /* `novos` precisa ser reatribuível: o modo 'materiaRodizio' constrói uma
       lista intercalada nova em vez de ordenar no lugar. Com `const` isso
       lançava TypeError e derrubava a montagem da fila inteira. */
    let novos = []; const revisoes = [], aprend = [];
    due.forEach(c => { const b = this._bucket(c); if (b === 'new') novos.push(c); else if (b === 'review') revisoes.push(c); else aprend.push(c); });
    /* ── ORDEM DAS REVISÕES ───────────────────────────────────────────────────
       Ordena ANTES de aplicar o limite: com acúmulo, quais 200 revisões entram
       importa tanto quanto a ordem em que aparecem.
       · 'retrievability' — menor R primeiro: o que está mais perto de sumir da
         memória é revisado antes. É a ordem que o Anki deve adotar como padrão.
       · 'vencimento'     — mais atrasado primeiro (o clássico).
       · 'aleatoria'      — comportamento anterior. */
    /* ── NewCardGatherPriority ────────────────────────────────────────────────
       Decide QUAIS novos entram quando há mais candidatos que o limite diário.
       Importa mais do que parece: colar 40 assuntos de uma matéria fazia os
       próximos dias virarem monotemáticos. */
    const posDe = (c) => (typeof c.posicaoNova === 'number' ? c.posicaoNova : Number.MAX_SAFE_INTEGER);
    const criacaoDe = (c) => String(c.createdAt || '');
    const cfgQ = CardsConfig.get();
    const COLETA = {
      posicao:     (a, b) => posDe(a) - posDe(b) || criacaoDe(a).localeCompare(criacaoDe(b)),
      posicaoDesc: (a, b) => posDe(b) - posDe(a) || criacaoDe(b).localeCompare(criacaoDe(a)),
      criacao:     (a, b) => criacaoDe(a).localeCompare(criacaoDe(b)),
      // 'materiaRodizio' substitui o DECK_THEN_RANDOM do Anki: em vez de sortear
      // por baralho, faz rodízio entre MATÉRIAS, que é o eixo real aqui. Assim
      // um lote grande de uma matéria não domina os dias seguintes.
      materiaRodizio: null
    };
    const gather = cfgQ.newGatherOrder || 'posicao';
    if (gather === 'materiaRodizio') {
      const porMat = {};
      novos.slice().sort(COLETA.posicao).forEach(c => {
        const k = c.materia || '—';
        (porMat[k] = porMat[k] || []).push(c);
      });
      const filas = Object.keys(porMat).sort().map(k => porMat[k]);
      const inter = [];
      let restam = true;
      while (restam) {
        restam = false;
        filas.forEach(f => { if (f.length) { inter.push(f.shift()); restam = true; } });
      }
      novos = inter;
    } else if (COLETA[gather]) {
      novos.sort(COLETA[gather]);
    }
    // NewCardSortOrder: reordena o lote já coletado.
    if ((cfgQ.newSortOrder || 'coleta') === 'aleatoria') {
      for (let i = novos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = novos[i]; novos[i] = novos[j]; novos[j] = t;
      }
    }
    /* ── ReviewCardOrder ──────────────────────────────────────────────────────
       Réplica das variantes do Anki que fazem sentido aqui. Ficaram de fora as
       que dependem de múltiplos baralhos aninhados (DAY_THEN_DECK,
       DECK_THEN_DAY) — este app tem baralhos planos.

       'relativeOverdueness' merece nota: é a razão entre o atraso e o intervalo
       marcado. Um card de 3 dias atrasado 3 dias (razão 2,0) corre MUITO mais
       risco que um de 300 dias atrasado 3 (razão 1,01), mesmo o segundo estando
       "mais vencido" em dias absolutos. É a ordem que o Anki usa por padrão no
       agendador v3 clássico. */
    const hojeQ = todayCards(), wQ = CardsConfig.weights();
    const R = (c) => CardEngine.retrievabilityDe(c, hojeQ, wQ);
    const atrasoRel = (c) => {
      const iv = Math.max(1, c.intervalo || 1);
      const atraso = CardEngine._daysBetween(c.due || hojeQ, hojeQ);
      return (atraso + iv) / iv;                       // >1 = mais urgente
    };
    const ordemRev = CardsConfig.get().reviewOrder || 'retrievabilityAsc';
    const ORDENADORES = {
      retrievabilityAsc:  (a, b) => R(a) - R(b),                 // esquecendo primeiro
      retrievabilityDesc: (a, b) => R(b) - R(a),
      relativeOverdueness:(a, b) => atrasoRel(b) - atrasoRel(a),
      day:                (a, b) => String(a.due || '').localeCompare(String(b.due || '')),
      intervalsAsc:       (a, b) => (a.intervalo || 0) - (b.intervalo || 0),
      intervalsDesc:      (a, b) => (b.intervalo || 0) - (a.intervalo || 0),
      easeAsc:            (a, b) => (a.d || 0) - (b.d || 0),     // no FSRS a dificuldade
      easeDesc:           (a, b) => (b.d || 0) - (a.d || 0),     // faz o papel do "ease"
      added:              (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
      random:             () => Math.random() - 0.5
    };
    const cmp = ORDENADORES[ordemRev];
    if (cmp) revisoes.sort(cmp);
    /* new_per_day_minimum: garante um mínimo de cards novos por dia mesmo quando
       o limite de revisões está estourado. Sem isso, uma fila acumulada trava a
       entrada de conteúdo novo por semanas — o usuário só apaga incêndio e
       nunca avança. 0 = desligado (comportamento anterior). */
    const pisoNovos = Math.max(0, cfgQ.newPerDayMinimum || 0);
    const haAcumulo = revisoes.length > revRem;      // limite de revisões estourado
    const newRemEfetivo = (pisoNovos > 0 && haAcumulo)
      ? Math.max(newRem, Math.min(pisoNovos, novos.length))
      : newRem;
    const novosLim = novos.slice(0, newRemEfetivo), revLim = revisoes.slice(0, revRem);
    /* ── MISTURA NOVOS x REVISOES (rslib/scheduler/queue/builder/intersperser.rs) ──
       O padrao do Anki e new_mix: MixWithReviews, e a mistura NAO e aleatoria:
       os novos sao DISTRIBUIDOS proporcionalmente entre as revisoes, de modo que
       fiquem espacados por igual do inicio ao fim da sessao.

       O app embaralhava (shuffle). Com 20 novos e 200 revisoes, o acaso podia
       amontoar varios novos seguidos — cansativo, porque card novo custa muito
       mais esforco que uma revisao — ou joga-los todos para o fim.

       ratio = (len1 + 1) / (len2 + 1); a cada passo entra o item do lado cujo
       indice relativo esta "atrasado". Replica exata dos vetores de teste do Anki. */
    const intercalar = (um, dois) => {
      const n1 = um.length, n2 = dois.length;
      const ratio = (n1 + 1) / (n2 + 1);
      const out = [];
      let i1 = 0, i2 = 0;
      while (i1 < n1 || i2 < n2) {
        if (i1 < n1 && i2 < n2) {
          if (((i2 + 1) * ratio) < (i1 + 1)) out.push(dois[i2++]);
          else out.push(um[i1++]);
        } else if (i1 < n1) out.push(um[i1++]);
        else out.push(dois[i2++]);
      }
      return out;
    };
    /* ── ReviewMix ────────────────────────────────────────────────────────────
       Duas decisões independentes no Anki, ambas com três valores:
       MIX_WITH_REVIEWS (padrão) · AFTER_REVIEWS · BEFORE_REVIEWS.

       · newMix      — onde entram os cards NOVOS.
       · interdayMix — onde entram os de APRENDIZADO que atravessaram a virada
                       do dia. Antes eles vinham sempre primeiro, fixo; muita
                       gente prefere despachar as revisões antes de retomar o
                       que ficou pela metade.
       "Misturar" usa o intercalador proporcional acima, não sorteio. */
    const cfgMix = CardsConfig.get();
    const aplicarMix = (grupo, base, modo) => {
      if (!grupo.length) return base;
      if (modo === 'antes') return grupo.concat(base);
      if (modo === 'depois') return base.concat(grupo);
      return intercalar(grupo, base);
    };
    /* NÃO embaralhar aqui. O código antigo fazia shuffle() nos dois grupos
       porque não existia opção de ordenação — o acaso era a única política.
       Agora reviewOrder, newGatherOrder e newSortOrder decidem a ordem de
       propósito, e embaralhar depois ANULA as três: era o caso de
       'materiaRodizio' montar C,T,C,T e o shuffle devolver C,C,C,T,T,T.
       Quem quiser acaso escolhe 'Aleatória' nas opções. */
    let corpo = revLim.slice();
    corpo = aplicarMix(novosLim.slice(), corpo, cfgMix.newMix || 'misturar');
    corpo = aplicarMix(aprend.slice(), corpo, cfgMix.interdayMix || 'misturar');
    const queue = corpo.map(c => c.id);
    CardEngine._intercalar = intercalar;
    // cards em aprendizado cujo passo ainda não venceu (base do "learn ahead" do Anki)
    const pendentes = filtered
      .filter(c => c.dueTs && c.dueTs > Date.now() && (c.due || todayCards()) <= todayCards())
      .sort((a, b) => a.dueTs - b.dueTs);
    this._queueMeta = {
      bloqueadosNovos: Math.max(0, novos.length - novosLim.length),
      bloqueadosRev: Math.max(0, revisoes.length - revLim.length),
      proximoTs: pendentes.length ? pendentes[0].dueTs : null,
      pendentes: pendentes.length,
      suspensos: this.currentFilteredCards().filter(c => c.suspenso).length
    };
    return queue;
  },
  // Anki mostra um card de aprendizado antes da hora quando não há mais nada na fila
  // (learn ahead limit = 20 min). Fora disso, informa quanto falta.
  LEARN_AHEAD_MIN: 20,
  _learnAheadQueue() {
    const limite = Date.now() + this.LEARN_AHEAD_MIN * 60000;
    return this.currentFilteredCards()
      .filter(c => !c.suspenso && c.dueTs && c.dueTs > Date.now() && c.dueTs <= limite)
      .sort((a, b) => a.dueTs - b.dueTs)
      .map(c => c.id);
  },
  renderRevisar(box) {
    if (DB.getCards().length === 0) {
      box.innerHTML = this.emptyState('Nenhum card ainda', 'Clique em <strong>＋ Criar card</strong> no topo para começar.');
      return;
    }
    if (this._reviewIdx === 0) { this._seenThisSession = new Set(); this._undoStack = []; } // nova sessão
    const atualId = this._reviewQueue && this._reviewQueue[this._reviewIdx];
    this._reviewQueue = this.buildQueue();
    const m = this._queueMeta || {};
    if (this._reviewQueue.length === 0) {
      // "Learn ahead" do Anki: se só restam passos de aprendizado, antecipa os que estão
      // dentro de 20 min; senão, mostra quanto falta em vez de dizer que acabou.
      if (m.proximoTs) {
        const faltaMin = Math.max(0, Math.ceil((m.proximoTs - Date.now()) / 60000));
        if (faltaMin <= this.LEARN_AHEAD_MIN) this._reviewQueue = this._learnAheadQueue();
        if (!this._reviewQueue || this._reviewQueue.length === 0) {
          box.innerHTML = `<div class="card"><div class="cards-review-done"><div class="big">⏳</div><h3>Aguardando o próximo passo</h3>
            <p>Você tem <b>${m.pendentes}</b> card(s) em aprendizado. O próximo volta em <b id="cards-eta">${faltaMin} min</b>.</p>
            <button type="button" class="btn-secondary" id="cards-review-refresh">Atualizar agora</button></div></div>`;
          const rb = document.getElementById('cards-review-refresh');
          if (rb) rb.addEventListener('click', () => this.renderContent());
          clearTimeout(this._etaTimer);
          this._etaTimer = setTimeout(() => { if (this.tab === 'revisar') this.renderContent(); }, Math.min(60000, Math.max(5000, (m.proximoTs - Date.now()) + 500)));
          return;
        }
      } else {
        const extra = (m.bloqueadosNovos || m.bloqueadosRev)
          ? `<p style="margin-top:10px;color:var(--text-soft)">Você atingiu o limite diário. Restam <b>${m.bloqueadosNovos}</b> novo(s) e <b>${m.bloqueadosRev}</b> revisão(ões) para amanhã — ajuste em <strong>⚙ Algoritmo</strong> se quiser continuar.</p>` : '';
        const susp = m.suspensos ? `<p style="margin-top:10px;color:var(--text-soft)">🚫 <b>${m.suspensos}</b> card(s) suspenso(s) por excesso de erros — reative em <strong>Meus cards</strong>.</p>` : '';
        box.innerHTML = `<div class="card"><div class="cards-review-done"><div class="big">✅</div><h3>Tudo em dia por aqui!</h3><p>Não há cards para revisar agora com os filtros atuais.</p>${extra}${susp}</div></div>`;
        return;
      }
    }
    // mantém o card que estava na tela quando a fila é remontada (ex.: após editar um card)
    const iAtual = atualId ? this._reviewQueue.indexOf(atualId) : -1;
    this._reviewIdx = iAtual >= 0 ? iAtual : Math.min(this._reviewIdx, this._reviewQueue.length - 1);
    this._flipped = false;
    this.renderReviewCard(box);
    this.atualizarFoco();
  },
  // ===== Painel de estatísticas FSRS (retenção real, previsão, maturidade) =====
  renderStats(box) {
    const cards = DB.getCards();
    if (cards.length === 0) { box.innerHTML = this.emptyState('Sem estatísticas ainda', 'Crie e revise alguns cards para ver seus dados.'); return; }
    const cfg = CardsConfig.get();
    const revlog = DB.getRevlog();
    /* Os KPIs de retenção e a tabela "Retenção real" abaixo leem a MESMA
       função. Antes cada um tinha sua conta e os dois números apareciam lado a
       lado, com o mesmo rótulo e valores diferentes. */
    const trTudo = this.trueRetention(null), tr30 = this.trueRetention(30);
    const retReal = trTudo.todos.pct;
    const ret30 = tr30.todos.pct;
    const est = (c) => (c.s != null ? c.s : (c.intervalo || 0));
    const novos = cards.filter(c => this._bucket(c) === 'new').length;
    const aprend = cards.filter(c => this._bucket(c) === 'learn').length;
    const jovens = cards.filter(c => this._bucket(c) === 'review' && est(c) < 21).length;
    const maduros = cards.filter(c => this._bucket(c) === 'review' && est(c) >= 21).length;
    const prev = [];
    for (let i = 0; i < 14; i++) { const dia = CardEngine.addDays(todayCards(), i); prev.push({ dia, n: cards.filter(c => !c.dueTs && (c.due || todayCards()) === dia && this._bucket(c) === 'review').length }); }
    const maxPrev = Math.max(1, ...prev.map(p => p.n));
    const act = [];
    for (let i = 13; i >= 0; i--) { const dia = CardEngine.addDays(todayCards(), -i); act.push({ dia, n: revlog.filter(r => r.date === dia).length }); }
    const maxAct = Math.max(1, ...act.map(a => a.n));
    const dueNow = cards.filter(c => CardEngine.isDue(c)).length;
    const custom = FSRS.pesosValidos(cfg.weights);
    const kpi = (v, l, tone) => `<div class="stat-kpi"><div class="stat-kpi-v ${tone || ''}">${v}</div><div class="stat-kpi-l">${l}</div></div>`;
    const bars = (arr, max, lbl, tone, uni) => arr.map(p => { const h = Math.round((p.n / max) * 100); return `<div class="stat-bar" data-tip="${escapeHtml(formatDateShort(p.dia))}: ${p.n || 0} ${uni || ''}"><div class="stat-bar-fill ${tone}" style="height:${p.n ? Math.max(6, h) : 0}%"></div><span class="stat-bar-n">${p.n || ''}</span><span class="stat-bar-x">${lbl(p.dia)}</span></div>`; }).join('');
    const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
    const wd = (iso) => ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][new Date(iso + 'T00:00:00').getDay()];
    box.innerHTML = `
      <div class="stat-kpis">
        ${kpi(retReal != null ? retReal + '%' : '—', 'Retenção real (tudo)', retReal != null && retReal >= cfg.retention * 100 ? 'good' : (retReal != null ? 'warn' : ''))}
        ${kpi(ret30 != null ? ret30 + '%' : '—', 'Retenção (30 dias)', ret30 != null && ret30 >= cfg.retention * 100 ? 'good' : (ret30 != null ? 'warn' : ''))}
        ${kpi(Math.round(cfg.retention * 100) + '%', 'Meta configurada', 'accent')}
        ${kpi(dueNow, 'Para revisar agora', dueNow ? 'warn' : 'good')}
      </div>
      <div class="stat-grid">
        <div class="card stat-card">
          <div class="card-header"><div><h2>🧩 Maturidade dos cards</h2><p class="sub">Total: ${cards.length} · algoritmo: ${cfg.algo === 'fsrs' ? 'FSRS-6' + (custom ? ' (pesos personalizados)' : '') : 'Clássico'}</p></div></div>
          <div class="stat-mat">
            <div class="stat-mat-bar">
              <span style="flex:${novos || 0.001};background:var(--text-faint)"></span><span style="flex:${aprend || 0.001};background:var(--warn)"></span>
              <span style="flex:${jovens || 0.001};background:var(--accent)"></span><span style="flex:${maduros || 0.001};background:var(--good)"></span>
            </div>
            <div class="stat-mat-legend">
              <span><i style="background:var(--text-faint)"></i>Novos ${novos}</span><span><i style="background:var(--warn)"></i>Aprendendo ${aprend}</span>
              <span><i style="background:var(--accent)"></i>Jovens ${jovens}</span><span><i style="background:var(--good)"></i>Maduros ${maduros}</span>
            </div>
          </div>
        </div>
        <div class="card stat-card"><div class="card-header"><div><h2>📅 Previsão de carga</h2><p class="sub">${(() => {
          const p = this.previsaoCarga(30);
          return `Próximos 14 dias no gráfico · em 30 dias: ${p.total} revisão(ões), média de ${p.media}/dia, pico de ${p.pico}` +
                 (p.atrasados ? ` · <strong class="tone-warn">${p.atrasados} atrasada(s)</strong>` : '');
        })()}</p></div></div><div class="stat-chart">${bars(prev, maxPrev, dm, 'accent')}</div></div>
        <div class="card stat-card"><div class="card-header"><div><h2>🔥 Atividade recente</h2><p class="sub">Revisões feitas nos últimos 14 dias · histórico: ${revlog.length}</p></div></div><div class="stat-chart">${bars(act, maxAct, wd, 'good')}</div></div>
      </div>
      ${this._statTrueRetention()}
      ${this._statBotoes()}
      ${this._statDistribuicao()}
      ${trTudo.maduro.total < 10 ? `<p class="hint" style="text-align:center;margin-top:14px;">💡 A retenção real fica precisa após ~10 revisões de cards maduros (você tem ${trTudo.maduro.total}).</p>` : ''}`;
  },

  /* ── TRUE RETENTION (Anki: aba Estatísticas → True Retention) ──────────────
     A tabela que responde "a retenção que eu TENHO bate com a que eu PEDI?".
     Separada por maturidade porque as duas contam histórias diferentes: card
     jovem (< 21 dias) ainda está sendo aprendido e erra muito; card maduro é
     que mede retenção de verdade. Revisões do mesmo dia ficam de fora — repetir
     um card em dez minutos não diz nada sobre esquecimento. */
  _statTrueRetention() {
    const p = [];
    [[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [365, '1 ano'], [null, 'Tudo']].forEach(([d, rot]) => {
      const t = this.trueRetention(d);
      if (!t.todos.total) return;
      const cor = (v) => v == null ? '' : (v >= t.meta ? 'good' : v >= t.meta - 5 ? 'warn' : 'bad');
      const cel = (o) => o.total ? `<td class="tone-${cor(o.pct)}"><strong>${o.pct.toFixed(1)}%</strong><span class="tr-frac">${o.acertos}/${o.total}</span></td>` : '<td class="tr-vazio">—</td>';
      p.push(`<tr><th>${rot}</th>${cel(t.jovem)}${cel(t.maduro)}${cel(t.todos)}</tr>`);
    });
    if (!p.length) return '';
    const meta = this.trueRetention(null).meta;
    return `<div class="card stat-card" style="margin-top:14px">
      <div class="card-header"><div><h2>🎯 Retenção real (True Retention)</h2>
      <p class="sub">Acertos ÷ revisões de longo prazo. Meta configurada: ${meta}%. Revisões do mesmo dia não entram.</p></div></div>
      <div class="tr-wrap"><table class="tr-table"><thead><tr><th></th><th>Jovens<span class="tr-sub">&lt; 21d</span></th><th>Maduros<span class="tr-sub">≥ 21d</span></th><th>Todos</th></tr></thead><tbody>${p.join('')}</tbody></table></div>
    </div>`;
  },

  /* ── BOTÕES DE RESPOSTA (Anki: Answer Buttons) ────────────────────────────
     Quanto você aperta cada botão, separado por fase. Diagnóstico direto: muito
     "Errei" em revisão significa intervalos longos demais; muito "Fácil"
     significa o contrário — e a retenção-alvo deveria mudar, não os cards. */
  _statBotoes() {
    const revlog = DB.getRevlog() || [];
    if (revlog.length < 5) return '';
    const NOMES = { 1: 'Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' };
    const TONS = { 1: 'bad', 2: 'warn', 3: 'accent', 4: 'good' };
    const fases = { learning: 'Aprendendo', review: 'Revisão', relearning: 'Reaprendendo' };
    const linhas = [];
    Object.keys(fases).forEach(fase => {
      const sub = revlog.filter(r => (r.phase || 'review') === fase);
      if (!sub.length) return;
      const cnt = { 1: 0, 2: 0, 3: 0, 4: 0 };
      sub.forEach(r => { if (cnt[r.grade] !== undefined) cnt[r.grade]++; });
      const barras = [1, 2, 3, 4].map(g => {
        const pc = Math.round(cnt[g] / sub.length * 1000) / 10;
        return `<div class="ab-col" data-tip="${NOMES[g]}: ${cnt[g]} (${pc}%)">
          <div class="ab-bar"><div class="ab-fill tone-${TONS[g]}" style="height:${Math.max(2, pc)}%"></div></div>
          <span class="ab-pc">${pc >= 1 ? Math.round(pc) + '%' : ''}</span><span class="ab-lb">${NOMES[g]}</span></div>`;
      }).join('');
      linhas.push(`<div class="ab-grupo"><div class="ab-tit">${fases[fase]}<span>${sub.length}</span></div><div class="ab-cols">${barras}</div></div>`);
    });
    if (!linhas.length) return '';
    return `<div class="card stat-card" style="margin-top:14px">
      <div class="card-header"><div><h2>🔘 Botões de resposta</h2>
      <p class="sub">Muito "Errei" em revisão = intervalos longos demais. Muito "Fácil" = o oposto — mexa na retenção-alvo, não nos cards.</p></div></div>
      <div class="ab-wrap">${linhas.join('')}</div></div>`;
  },

  /* ── DISTRIBUIÇÃO DE ESTABILIDADE E DIFICULDADE (Anki: Card Stability /
     Card Difficulty) ─────────────────────────────────────────────────────────
     Só faz sentido com FSRS: mostra como a coleção se espalha nos dois eixos do
     modelo de memória. Uma massa concentrada em dificuldade alta indica material
     mal formulado — card difícil demais costuma ser card mal escrito. */
  _statDistribuicao() {
    const cards = DB.getCards().filter(c => typeof c.s === 'number' && typeof c.d === 'number');
    if (cards.length < 5) return '';
    const FAIXAS_S = [[0, 1, '< 1d'], [1, 7, '1–7d'], [7, 21, '7–21d'], [21, 90, '21–90d'], [90, 365, '90d–1a'], [365, Infinity, '> 1a']];
    const FAIXAS_D = [[1, 3, 'Muito fácil'], [3, 5, 'Fácil'], [5, 7, 'Médio'], [7, 9, 'Difícil'], [9, 10.01, 'Muito difícil']];
    const hist = (faixas, valor, tone) => {
      const c = faixas.map(([a, b]) => cards.filter(x => valor(x) >= a && valor(x) < b).length);
      const mx = Math.max(1, ...c);
      return faixas.map(([, , rot], i) => `<div class="hd-col" data-tip="${rot}: ${c[i]} card(s)">
        <div class="hd-bar"><div class="hd-fill ${tone}" style="height:${c[i] ? Math.max(4, Math.round(c[i] / mx * 100)) : 0}%"></div></div>
        <span class="hd-n">${c[i] || ''}</span><span class="hd-lb">${rot}</span></div>`).join('');
    };
    const medS = cards.reduce((a, c) => a + c.s, 0) / cards.length;
    const medD = cards.reduce((a, c) => a + c.d, 0) / cards.length;
    return `<div class="stat-grid" style="margin-top:14px">
      <div class="card stat-card"><div class="card-header"><div><h2>📈 Estabilidade</h2>
        <p class="sub">Quanto tempo a memória dura. Média: ${CycleEngine.fmtHM ? '' : ''}${medS < 1 ? medS.toFixed(2) + ' dia' : Math.round(medS) + ' dias'}</p></div></div>
        <div class="hd-wrap">${hist(FAIXAS_S, c => c.s, 'tone-accent')}</div></div>
      <div class="card stat-card"><div class="card-header"><div><h2>🧱 Dificuldade</h2>
        <p class="sub">Média: ${medD.toFixed(1)} de 10. Concentração no topo costuma indicar card mal formulado, não assunto difícil.</p></div></div>
        <div class="hd-wrap">${hist(FAIXAS_D, c => c.d, 'tone-warn')}</div></div>
    </div>`;
  },
  renderReviewCard(box) {
    const total = this._reviewQueue.length;
    const id = this._reviewQueue[this._reviewIdx];
    const c = DB.getCard(id);
    if (!c) { this.renderRevisar(box); return; }
    const done = this._reviewIdx; // já revisados nesta sessão
    box.innerHTML = `
      <div class="card cards-review-wrap">
        <div class="cards-review-progress"><span title="Posição atual na fila">Card ${done + 1} de ${total}</span>
          <div class="cards-review-bar"><div style="width:${((done) / total) * 100}%"></div></div>
          <span class="cards-limit-chip" title="Cards únicos respondidos hoje: novos / limite diário e revisões / limite diário">🆕 ${CardsConfig.newDoneToday()}/${CardsConfig.get().newPerDay} · 🔄 ${CardsConfig.revDoneToday()}/${CardsConfig.get().revPerDay}</span>
        </div>
        <div class="cards-review-meta">
          <span class="lei-tag mat">${escapeHtml(this.materiaLabel(c))}</span>
          ${c.topico ? `<span class="lei-tag ref">${escapeHtml(c.topico)}</span>` : ''}
          ${c.tipo ? `<span class="cards-type-tag">${escapeHtml(c.tipo)}</span>` : ''}
          <button type="button" class="cards-fav-star ${c.favorito ? 'on' : ''}" id="cards-review-fav" title="Favoritar">${c.favorito ? '★' : '☆'}</button>
        </div>
        ${this.faceHtml(c)}
        <div class="cards-review-actions" id="cards-review-actions"></div>
        <!-- Barra de ações do reviewer do Anki (qt/aqt/reviewer.py::_shortcutKeys).
             "Pular/Avançar" foi REMOVIDO: não existe no Anki. O equivalente de
             lá para tirar um card da frente é ENTERRAR, que está aqui. -->
        <div class="cards-review-nav">
          <button type="button" class="icon-btn cards-review-edit" id="cards-review-edit" title="Editar card (E)">✎ Editar</button>
          <button type="button" class="icon-btn" id="cards-act-mark" title="Marcar/desmarcar nota (*)">${c.favorito ? '★ Marcada' : '☆ Marcar'}</button>
          <button type="button" class="icon-btn" id="cards-act-bury" title="Enterrar: some da fila até amanhã (−)">⤓ Enterrar</button>
          <button type="button" class="icon-btn" id="cards-act-susp" title="Suspender: some até você reativar (@)">🚫 Suspender</button>
          <button type="button" class="icon-btn" id="cards-act-forget" title="Esquecer: volta a ser card novo (Ctrl+Alt+N)">↺ Esquecer</button>
          <button type="button" class="icon-btn" id="cards-act-due" title="Definir data de vencimento (Ctrl+Shift+D)">📅 Data</button>
          <button type="button" class="icon-btn" id="cards-act-info" title="Informações do card (I)">ℹ Info</button>
          <button type="button" class="icon-btn" id="cards-act-del" title="Excluir card (Ctrl+Del)" aria-label="Excluir card (Ctrl+Del)">🗑</button>
          <span class="cards-flagbar" title="Bandeiras (Ctrl+1..4, Ctrl+0 remove)">
            ${[1,2,3,4].map(n => `<button type="button" class="cards-flag ${(c.flag||0)===n?'on':''}" data-flag="${n}" style="--fl:${DB.FLAGS[n].cor}" title="${DB.FLAGS[n].nome} (Ctrl+${n})"></button>`).join('')}
          </span>
        </div>
        <div class="cards-kbd-hint-row">
          <span class="cards-kbd-hint">
            <span class="cards-kbd-group"><kbd>Espaço</kbd> Mostrar resposta</span>
            <span class="cards-kbd-group"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> Avaliar</span>
            <span class="cards-kbd-group"><kbd>E</kbd> Editar</span>
            <span class="cards-kbd-group"><kbd>-</kbd> Enterrar</span>
            <span class="cards-kbd-group"><kbd>@</kbd> Suspender</span>
            <span class="cards-kbd-group"><kbd>*</kbd> Marcar</span>
            <span class="cards-kbd-group"><kbd>I</kbd> Info</span>
            <span class="cards-kbd-group"><kbd>U</kbd> Desfazer</span>
          </span>
        </div>
      </div>`;
    this.renderActions(box, c);
    /* Ligações das ações do reviewer — mesmos efeitos do Anki. Todas avançam a
       fila depois de agir (o Anki também tira o card da frente ao enterrar,
       suspender ou excluir). */
    const proximo = () => {
      CardEngine.invalidateDueCache();
      this._reviewQueue = (this._reviewQueue || []).filter(x => x !== c.id);
      if (this._reviewIdx > this._reviewQueue.length) this._reviewIdx = this._reviewQueue.length;
      this.renderReviewCard(box);
    };
    const liga = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    liga('cards-act-mark', () => { DB.updateCard(c.id, { favorito: !c.favorito }); this.updateFavCount(); this.renderReviewCard(box); showToast(c.favorito ? 'Desmarcada' : '★ Marcada'); });
    liga('cards-act-bury', () => { const d2 = DB.buryCard(c.id); proximo(); showToast('⤓ Enterrado até ' + formatDateShort(d2)); });
    liga('cards-act-susp', () => { DB.updateCard(c.id, { suspenso: true }); proximo(); showToast('🚫 Suspenso — reative em Meus cards'); });
    liga('cards-act-forget', () => {
      UI.confirm('Esquecer este card? Ele volta a ser um card novo e perde o histórico de agendamento.',
        { title: '↺ Esquecer card', okText: 'Esquecer', danger: true }).then(ok => {
          if (!ok) return; DB.forgetCard(c.id); proximo(); showToast('↺ Card voltou a ser novo');
        });
    });
    liga('cards-act-due', () => {
      UI.prompt([{ key: 'd', label: 'Vencer daqui a quantos dias?', type: 'number', value: '1',
        hint: '0 = hoje. Equivale ao "Set Due Date" do Anki.' }],
        { title: '📅 Definir data', okText: 'Agendar' }).then(v => {
          if (!v) return;
          const data = DB.setDueDays(c.id, v.d);
          proximo(); showToast('📅 Agendado para ' + formatDateShort(data));
        });
    });
    liga('cards-act-info', () => this.cardInfo(c.id));
    liga('cards-act-del', () => {
      UI.confirm('Excluir este card? Não há como desfazer.', { title: '🗑 Excluir card', okText: 'Excluir', danger: true })
        .then(ok => { if (!ok) return; DB.deleteCard(c.id); proximo(); showToast('Card excluído'); });
    });
    document.querySelectorAll('.cards-flag').forEach(b => b.addEventListener('click', () => {
      const n = Number(b.dataset.flag);
      DB.setFlag(c.id, (c.flag || 0) === n ? 0 : n);
      this.renderReviewCard(box);
    }));
    $id('cards-review-fav').addEventListener('click', () => {
      DB.updateCard(c.id, { favorito: !c.favorito }); this.updateFavCount(); this.renderReviewCard(box);
    });
    $id('cards-review-edit').addEventListener('click', () => this.openCardModal(c.id));
    const nx = document.getElementById('cards-next'); if (nx) nx.addEventListener('click', () => this.navCard(1));
  },
  // renderiza as faces conforme o tipo (cloze ou básico)
  faceHtml(c) {
    // Saneia também na SAÍDA (além da entrada, em DB.addCard): assim um card que já
    // estivesse gravado de antes, ou vindo por um caminho novo, nunca executa nada.
    // Custo desprezível — é um card por vez, com memória de resultado.
    const cFrente = _sanCard(c.frente), cVerso = _sanCard(c.verso);
    if (c.kind === 'cloze') {
      const front = CardEngine.clozeRender(cFrente, false);
      const back = CardEngine.clozeRender(cFrente, true) + (CardEngine.plain(cVerso) ? `<hr style="border:none;border-top:1px solid var(--border);margin:12px 0">${cVerso}` : '');
      return `<div class="cards-face cards-front">${front || '<em>(vazio)</em>'}</div>
        <div class="cards-face cards-back" style="display:${this._flipped ? 'block' : 'none'}">${back}</div>`;
    }
    return `<div class="cards-face cards-front">${cFrente || '<em style="color:var(--text-faint)">(frente vazia)</em>'}</div>
      <div class="cards-face cards-back" style="display:${this._flipped ? 'block' : 'none'}">${cVerso || '<em style="color:var(--text-faint)">(verso vazio)</em>'}</div>`;
  },
  // renderiza os botões: "Mostrar resposta" OU os 4 botões de avaliação
  renderActions(box, c) {
    const el = document.getElementById('cards-review-actions');
    if (!this._flipped) {
      el.innerHTML = `<button type="button" class="btn-primary cards-flip" id="cards-flip">Mostrar resposta <kbd>Espaço</kbd></button>`;
      $id('cards-flip').addEventListener('click', () => this.flip(box));
      return;
    }
    /* ── FIDELIDADE AO ANKI: um card so e avaliado UMA VEZ por passagem ────────
       No Anki nao existe "card anterior": a fila avanca e voce so pode DESFAZER
       (Ctrl+Z). Aqui a navegacao para tras foi mantida — e util para reler o que
       passou — mas avaliar de novo um card ja avaliado nesta sessao criaria uma
       SEGUNDA entrada no historico. O agendamento nao quebrava (a trava de mesmo
       dia do FSRS-6 segura a estabilidade, e o contador diario ja e por ID), mas
       o revlog inflava e contaminava as estatisticas e o otimizador.
       Solucao igual a do Anki: o card ja avaliado nao reoferece as notas; oferece
       DESFAZER, que e a unica forma de mudar uma avaliacao no Anki. */
    const iv = CardEngine.previewIntervals(c);
    el.innerHTML = `
      <button type="button" class="cards-ans4 a-errei" data-g="errei"><span class="a-kbd">1</span>✗ Errei<span>${CardEngine.fmtInterval(iv.errei)}</span></button>
      <button type="button" class="cards-ans4 a-dificil" data-g="dificil"><span class="a-kbd">2</span>Difícil<span>${CardEngine.fmtInterval(iv.dificil)}</span></button>
      <button type="button" class="cards-ans4 a-bom" data-g="bom"><span class="a-kbd">3</span>Bom<span>${CardEngine.fmtInterval(iv.bom)}</span></button>
      <button type="button" class="cards-ans4 a-facil" data-g="facil"><span class="a-kbd">4</span>Fácil<span>${CardEngine.fmtInterval(iv.facil)}</span></button>`;
    el.querySelectorAll('.cards-ans4').forEach(b => b.addEventListener('click', () => this.answer(b.dataset.g)));
  },
  /* INFORMAÇÕES DO CARD (tecla I) — equivalente ao "Card Info" do Anki:
     estado atual, memória do FSRS e o histórico completo de revisões. */
  cardInfo(id) {
    const c = DB.getCard(id); if (!c) return;
    const log = DB.getRevlog().filter(r => r.cardId === id).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const NOTA = { 1: '✗ Errei', 2: 'Difícil', 3: 'Bom', 4: 'Fácil' };
    const FASE = { new: 'Novo', learning: 'Aprendendo', review: 'Revisão', relearning: 'Reaprendendo' };
    const linha = (r, v) => `<tr><td style="padding:4px 10px 4px 0;color:var(--text-faint)">${r}</td><td style="padding:4px 0;font-family:'Space Mono',monospace">${v}</td></tr>`;
    const corpo = `
      <table style="width:100%;font-size:12.5px;border-collapse:collapse">
        ${linha('Estado', FASE[c.phase] || c.phase || '—')}
        ${linha('Vencimento', c.dueTs ? new Date(c.dueTs).toLocaleString('pt-BR') : (c.due || '—'))}
        ${linha('Estabilidade (S)', c.s != null ? Number(c.s).toFixed(2) + ' dias' : '—')}
        ${linha('Dificuldade (D)', c.d != null ? Number(c.d).toFixed(2) + ' / 10' : '—')}
        ${linha('Revisões', c.reps || 0)}
        ${linha('Lapsos', c.lapses || 0)}
        ${linha('Intervalo', c.intervalo ? c.intervalo + ' dia(s)' : '—')}
        ${linha('Suspenso', c.suspenso ? 'sim' : 'não')}
        ${linha('Enterrado até', c.enterradoAte || '—')}
        ${linha('Bandeira', (c.flag && DB.FLAGS[c.flag]) ? DB.FLAGS[c.flag].nome : '—')}
        ${linha('Criado em', (c.createdAt || '').slice(0, 10) || '—')}
      </table>
      <p style="margin:14px 0 6px;font-weight:700;font-size:12.5px">Histórico (${log.length})</p>
      ${log.length ? `<div style="max-height:230px;overflow:auto">
        <table style="width:100%;font-size:12px;border-collapse:collapse">
          ${log.slice(0, 60).map(r => `<tr style="border-top:1px solid var(--border)">
            <td style="padding:4px 8px 4px 0;color:var(--text-faint)">${r.date || ''}</td>
            <td style="padding:4px 8px 4px 0">${NOTA[r.grade] || r.grade}</td>
            <td style="padding:4px 0;color:var(--text-faint)">${r.elapsed != null ? r.elapsed + 'd' : ''}</td>
          </tr>`).join('')}
        </table></div>` : '<p style="color:var(--text-faint);font-size:12px">Nenhuma revisão ainda.</p>'}`;
    UI.alert(corpo, { title: 'ℹ Informações do card', html: true, okText: 'Fechar' });
  },
  flip(box) { this._flipped = true; this.renderReviewCard(box || document.getElementById('cards-content')); },
  // atalhos de teclado durante a revisão
  onKey(e) {
    // só na tela de cards, aba revisar, com um card na tela e sem modal aberto
    const scr = document.getElementById('screen-cards');
    if (!scr || !scr.classList.contains('active')) return;
    if (this.tab !== 'revisar') return;
    const anyModalOpen = ['card-modal', 'deck-modal', 'cards-import-modal', 'cards-export-modal']
      .some(id => { const m = document.getElementById(id); return m && m.style.display === 'flex'; });
    if (anyModalOpen) return;
    if (!this._reviewQueue || this._reviewIdx >= this._reviewQueue.length) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    const box = document.getElementById('cards-content');
    // Ctrl+Z / Cmd+Z: desfazer a última avaliação (como no Anki)
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); this.undoAnswer(); return; }
    /* Atalhos do reviewer do Anki (qt/aqt/reviewer.py::_shortcutKeys) */
    const idAtual = (this._reviewQueue || [])[this._reviewIdx];
    const clique = (bid) => { const b = document.getElementById(bid); if (b) b.click(); };
    if (e.code === 'KeyU' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.undoAnswer(); return; }   // u = desfazer
    if (e.code === 'KeyE' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); clique('cards-review-edit'); return; }
    if (e.code === 'KeyI' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); clique('cards-act-info'); return; }
    if (e.key === '-') { e.preventDefault(); clique('cards-act-bury'); return; }
    if (e.key === '@' || (e.shiftKey && e.code === 'Digit2')) { e.preventDefault(); clique('cards-act-susp'); return; }
    if (e.key === '*' || (e.shiftKey && e.code === 'Digit8')) { e.preventDefault(); clique('cards-act-mark'); return; }
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyN') { e.preventDefault(); clique('cards-act-forget'); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); clique('cards-act-due'); return; }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'Delete' || e.code === 'Backspace')) { e.preventDefault(); clique('cards-act-del'); return; }
    if ((e.ctrlKey || e.metaKey) && /^Digit[0-4]$/.test(e.code)) {   // bandeiras
      e.preventDefault();
      if (idAtual) { const n = Number(e.code.slice(5)); DB.setFlag(idAtual, n); this.renderReviewCard(document.getElementById('cards-content')); }
      return;
    }
    if (e.code === 'Escape' && this.emFoco()) { e.preventDefault(); this.sairFoco(); return; }
    if (e.code === 'Space') {
      e.preventDefault();
      if (!this._flipped) this.flip(box);
      return;
    }
    // ← volta ao card anterior; → avança para o próximo card
    // → NÃO pula: o Anki não permite passar um card sem avaliar. Para tirar o
    // card da frente, use ENTERRAR (-) ou SUSPENDER (@), como no original.
    // ← NÃO faz nada: o Anki não tem "card anterior". A única forma de mudar uma
    // avaliação é DESFAZER (Ctrl+Z), e é assim que fica aqui.
    if (!this._flipped) return;
    const map = { Digit1: 'errei', Numpad1: 'errei', Digit2: 'dificil', Numpad2: 'dificil', Digit3: 'bom', Numpad3: 'bom', Digit4: 'facil', Numpad4: 'facil' };
    if (map[e.code]) { e.preventDefault(); this.answer(map[e.code]); }
  },
  // pula (rotacionando para o fim) cards cujo passo de aprendizado ainda não venceu,
  // desde que exista outro card disponível agora
  _skipNotDue() {
    const q = this._reviewQueue;
    let guard = q.length;
    while (guard-- > 0 && this._reviewIdx < q.length) {
      const c = DB.getCard(q[this._reviewIdx]);
      if (!c || !c.dueTs || c.dueTs <= Date.now()) return;
      const temOutro = q.slice(this._reviewIdx + 1).some(id => { const o = DB.getCard(id); return o && (!o.dueTs || o.dueTs <= Date.now()); });
      if (!temOutro) return; // é o único: o Anki antecipa (learn ahead)
      q.push(q.splice(this._reviewIdx, 1)[0]);
    }
  },
  // ── Modo foco: estudar só os cards, em tela cheia ──
  entrarFoco() {
    this.tab = 'revisar';
    document.querySelectorAll('.cards-tab').forEach(t => t.classList.toggle('active', t.dataset.ctab === 'revisar'));
    document.body.classList.add('cards-foco');
    this._reviewIdx = 0;
    this.renderContent();
    this.atualizarFoco();
    window.scrollTo({ top: 0 });
    showToast('Modo foco · Espaço vira · 1-4 avaliam · Esc sai');
  },
  sairFoco() {
    document.body.classList.remove('cards-foco');
    this.renderContent();
  },
  emFoco() { return document.body.classList.contains('cards-foco'); },
  atualizarFoco() {
    if (!this.emFoco()) return;
    const el = document.getElementById('foco-info');
    if (!el) return;
    const total = (this._reviewQueue || []).length;
    const c = total ? DB.getCard(this._reviewQueue[this._reviewIdx]) : null;
    const onde = c ? (c.materia || (DB.getDecks().find(d => d.id === c.deckId) || {}).nome || '') : '';
    el.textContent = total
      ? `${Math.min(this._reviewIdx + 1, total)} de ${total}${onde ? ' · ' + onde : ''}`
      : 'Nada para revisar agora';
    const u = document.getElementById('foco-undo');
    if (u) u.disabled = !(this._undoStack || []).length;
  },
  // navega entre os cards da fila sem avaliar (pular)
  navCard(dir) {
    if (!this._reviewQueue || this._reviewQueue.length === 0) return;
    /* Só AVANÇA. Voltar foi removido: no Anki não existe "card anterior" — a fila
       anda para frente e a única forma de mudar uma nota é desfazer. Enquanto
       existiu, dava para reavaliar o mesmo card em rajada; uma auditoria real
       mostrou 4 cards com 178 entradas no histórico, uma delas com 28 revisões
       do mesmo card, 164 delas com menos de 2 segundos entre si. */
    if (dir < 0) return;
    const ni = this._reviewIdx + dir;
    if (ni < 0 || ni >= this._reviewQueue.length) return;
    this._reviewIdx = ni;
    this._flipped = false;
    this.renderReviewCard(document.getElementById('cards-content'));
  },
  // DESFAZER (Anki: Ctrl+Z) — restaura o card, apaga a revisão do histórico e devolve
  // o contador diário. Substitui o antigo "Anterior", que reavaliava o card em dobro.
  undoAnswer() {
    const u = (this._undoStack || []).pop();
    if (!u) { showToast('Nada para desfazer'); return; }
    DB.updateCard(u.id, u.antes);
    CardEngine.invalidateDueCache();
    DB.removeRevlog(u.revTs);
    if (u.contou) CardsConfig.unmarkIntroduced(u.contou, u.id);
    if (this._seenThisSession && !(this._undoStack || []).some(x => x.id === u.id)) this._seenThisSession.delete(u.id);
    // desfaz a reinserção do card na fila, se houve
    const dup = this._reviewQueue.lastIndexOf(u.id);
    if (dup > u.idx) this._reviewQueue.splice(dup, 1);
    this._reviewIdx = Math.max(0, Math.min(u.idx, this._reviewQueue.length - 1));
    if (this._reviewQueue[this._reviewIdx] !== u.id) {
      const i = this._reviewQueue.indexOf(u.id);
      if (i >= 0) this._reviewIdx = i; else { this._reviewQueue.splice(this._reviewIdx, 0, u.id); }
    }
    this._flipped = false;
    showToast('Revisão desfeita ↶');
    this.renderReviewCard(document.getElementById('cards-content'));
    this.atualizarFoco();
  },
  answer(grade) {
    const id = this._reviewQueue[this._reviewIdx];
    const c = DB.getCard(id);
    /* Sem guarda de "já avaliado": ela estava ERRADA. Um card de aprendizado
       respondido com "Errei" volta em 1 minuto e PRECISA ser avaliado de novo —
       é assim que os passos do Anki funcionam. A guarda baseada no histórico de
       desfazer bloqueava justamente essa volta legítima.
       A proteção real contra reavaliar a MESMA apresentação é estrutural: sem
       "voltar" e sem "pular", não existe caminho para retornar a um card já
       avaliado na mesma posição da fila — exatamente como no Anki. */
    let patch = null;
    if (c) {
      // registra no histórico (revlog) ANTES de reagendar — base para o otimizador FSRS
      const G = CardEngine.GRADE_NUM[grade] || 3;
      const elapsed = c.lastReview ? Math.max(0, Math.round((new Date(todayCards() + 'T00:00:00') - new Date(c.lastReview + 'T00:00:00')) / 86400000)) : 0;
      const revTs = Date.now();
      /* `intervalo` = o intervalo que o card TINHA ao ser respondido (o lastIvl
         do revlog do Anki). Sem ele a tabela de Retenção Real não conseguia
         separar card jovem de card maduro: a coluna "Maduros" ficava vazia
         para sempre, porque a linha do histórico não guardava essa informação. */
      DB.addRevlog({ ts: revTs, date: todayCards(), cardId: id, grade: G, acerto: G > 1, phase: (c.phase || 'new'), elapsed, intervalo: (c.intervalo || 0), s: (c.s || null), d: (c.d || null) });
      // conta introdução no limite diário só na 1ª vez que o card aparece nesta sessão
      const bucketAntes = this._bucket(c);
      if (!this._seenThisSession) this._seenThisSession = new Set();
      const primeiraVez = !this._seenThisSession.has(id) && (bucketAntes === 'new' || bucketAntes === 'review');
      if (primeiraVez) CardsConfig.markIntroduced(bucketAntes, id);
      this._seenThisSession.add(id);
      // snapshot para o DESFAZER — capturado ANTES de gravar (Anki: Ctrl+Z)
      const antes = {};
      ['phase', 'learnStep', 's', 'd', 'due', 'dueTs', 'reps', 'lapses', 'ease', 'intervalo', 'status', 'lastReview', 'algo', 'leech', 'suspenso']
        .forEach(k => { antes[k] = c[k]; });
      patch = CardEngine.schedule(c, grade); DB.updateCard(id, patch);
      CardEngine.invalidateDueCache();
      (this._undoStack = this._undoStack || []).push({ id, antes, revTs, contou: primeiraVez ? bucketAntes : null, idx: this._reviewIdx });
      if (this._undoStack.length > 50) this._undoStack.shift();
      if (patch._leechNow) showToast(patch.suspenso ? '🚫 Card suspenso: já errou ' + patch.lapses + ' vezes' : '⚠ Card marcado como problemático (' + patch.lapses + ' erros)');
    }
    this._reviewIdx++;
    this._flipped = false;
    // Anki: cards em APRENDIZADO/REAPRENDIZADO ressurgem na mesma sessão, mas só DEPOIS
    // do passo. Passo curto volta logo; passo longo vai para o fim da fila.
    if (patch && (patch.phase === 'learning' || patch.phase === 'relearning') && !patch.suspenso) {
      const restam = this._reviewQueue.length - this._reviewIdx;
      const curto = patch.dueTs && (patch.dueTs - Date.now()) <= 3 * 60000;
      const gap = curto ? Math.min(3, restam) : restam;
      this._reviewQueue.splice(this._reviewIdx + gap, 0, id);
    }
    // não mostra um card cujo passo ainda não venceu se houver outro disponível
    this._skipNotDue();
    this.atualizarFoco();
    const box = document.getElementById('cards-content');
    if (this._reviewIdx >= this._reviewQueue.length) {
      /* ── FIDELIDADE AO ANKI: antecipados fazem parte da MESMA fila ───────────
         No Anki (rslib/src/scheduler/queue/mod.rs) a ordem de apresentação é um
         único iterador encadeado:
             aprendizado vencido AGORA → revisões e novos → aprendizado ANTECIPADO
         O "learn ahead" (padrão 1200s = 20 min) é o último elo desse mesmo
         iterador — não uma fila separada. Por isso o Anki NUNCA diz "concluído"
         para depois trazer os cards de volta: ele simplesmente continua.

         Aqui os antecipados viviam fora da fila, então ela esvaziava, aparecia o
         🎉 e os cards ressurgiam ao reabrir a tela. Mesma matemática, sensação
         completamente diferente — e era isto que destoava do Anki.
         Agora eles entram no fim da fila corrente, e o encerramento só acontece
         quando não há mais nada dentro da janela de antecipação. */
      const antecipados = (this._learnAheadQueue() || []).filter(id => {
        const c = DB.getCard(id);
        return c && !c.suspenso;
      });
      if (antecipados.length) {
        this._reviewQueue = this._reviewQueue.concat(antecipados);
        this._skipNotDue();
        this.renderReviewCard(box);
        return;
      }
      // conta CARDS DISTINTOS, não as repetições dos passos de aprendizado
      const distintos = new Set(this._reviewQueue).size;
      box.innerHTML = `<div class="card"><div class="cards-review-done"><div class="big">🎉</div><h3>Sessão concluída!</h3><p>Você revisou ${distintos} card(s). O app agendou a próxima revisão de cada um.</p><button type="button" class="btn-primary" id="cards-review-restart">Ver se há mais</button></div></div>`;
      const rb = document.getElementById('cards-review-restart');
      if (rb) rb.addEventListener('click', () => { this._reviewIdx = 0; this.renderContent(); });
      this.updateFavCount();
      // se ainda há passos de aprendizado pendentes, reabre a fila sozinho quando vencerem
      const prox = (this._queueMeta || {}).proximoTs;
      clearTimeout(this._etaTimer);
      if (prox) this._etaTimer = setTimeout(() => { if (this.tab === 'revisar') { this._reviewIdx = 0; this.renderContent(); } }, Math.max(3000, prox - Date.now() + 500));
      return;
    }
    this.renderReviewCard(box);
  },
  // Quantos cards a lista mostra por vez. Antes ela montava TODOS os cards
  // filtrados de uma vez — cada um com o HTML rico completo, imagens em base64
  // incluídas — e refazia a lista inteira a cada clique numa estrela. Com alguns
  // milhares de cards isso congelava a tela por segundos.
  PAGINA_CARDS: 60,
  _meusMostrando: 0,
  miniCardHtml(c) {
    // saneado no preview também: a lista é HTML rico como a tela de revisão
    const frenteSan = _sanCard(c.frente);
    return `
        <div class="mini-card" data-id="${c.id}">
          <div class="mini-card-top">
            <label class="mini-card-sel" title="Selecionar este card">
              <input type="checkbox" class="mini-sel" data-id="${c.id}">
            </label>
            <span class="mini-card-badges">
              <span class="lei-tag mat">${escapeHtml(this.materiaLabel(c))}</span>
              ${c.topico ? `<span class="lei-tag ref">${escapeHtml(c.topico)}</span>` : ''}
              ${c.banca ? `<span class="lei-tag" style="background:var(--accent);color:#fff;" title="Banca">🏛️ ${escapeHtml(c.banca)}</span>` : ''}
            </span>
            <button type="button" class="cards-fav-star ${c.favorito ? 'on' : ''}" data-fav="${c.id}" title="Favoritar">${c.favorito ? '★' : '☆'}</button>
          </div>
          <div class="mini-card-front">${c.kind === 'cloze' ? CardEngine.clozeRender(frenteSan, false) : (frenteSan || '<em style="color:var(--text-faint)">(vazio)</em>')}</div>
          <div class="mini-card-foot">
            <span class="cards-status-dot ${c.status || 'pendente'}"></span>
            <span class="mini-card-status">${c.status === 'sei' ? 'Sei' : c.status === 'naosei' ? 'Não sei' : 'Pendente'}</span>
            ${c.kind === 'cloze' ? `<span class="cards-type-tag" style="color:var(--accent)">Cloze</span>` : ''}
            ${c.reversedOf ? `<span class="cards-type-tag" title="Cartão invertido">⇄</span>` : ''}
            ${c.tipo ? `<span class="cards-type-tag">${escapeHtml(c.tipo)}</span>` : ''}
            ${c.suspenso ? `<span class="cards-type-tag" style="color:var(--bad);border-color:var(--bad)" title="Suspenso após ${c.lapses || 0} erros — clique em ▶ para reativar">🚫 Suspenso</span>`
              : (c.leech ? `<span class="cards-type-tag" style="color:var(--warn);border-color:var(--warn)" title="${c.lapses || 0} erros acumulados">⚠ Difícil</span>` : '')}
            <span style="flex:1"></span>
            ${c.suspenso ? `<button type="button" class="icon-btn" data-unsusp="${c.id}" title="Reativar card" aria-label="Reativar card">▶</button>` : ''}
            <button type="button" class="icon-btn mini-edit" data-edit="${c.id}" title="Editar" aria-label="Editar">✎</button>
            <button type="button" class="icon-btn danger mini-del" data-del="${c.id}" title="Excluir" aria-label="Excluir">×</button>
          </div>
        </div>`;
  },
  renderMeus(box) {
    const filtered = this.currentFilteredCards().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (DB.getCards().length === 0) {
      box.innerHTML = this.emptyState('Você ainda não criou nenhum card', 'Clique em <strong>＋ Criar card</strong> no topo pra começar.');
      return;
    }
    if (filtered.length === 0) {
      box.innerHTML = this.emptyState('Nenhum card nos filtros', 'Ajuste a busca ou os filtros acima.');
      return;
    }
    const st = CardEngine.stats(filtered);
    // Ao voltar de uma edição, mantém a quantidade que já estava aberta — senão a
    // lista "encolheria" sozinha depois de você carregar mais e mexer num card.
    // O teto existe para que um re-render nunca volte a montar milhares de cards
    // de uma vez, mesmo que você tenha clicado muito em "Carregar mais".
    const jaAberto = Math.min(240, Math.max(this.PAGINA_CARDS, this._meusMostrando || 0));
    let n = Math.min(jaAberto, filtered.length);
    this._meusMostrando = n;

    box.innerHTML = `
      <div class="cards-count-bar">${filtered.length} card(s) · <span style="color:var(--good)">${st.sei} sei</span> · <span style="color:var(--bad)">${st.naosei} não sei</span> · <span style="color:var(--text-soft)">${st.pendente} pendente(s)</span>${st.suspensos ? ` · <span style="color:var(--bad)">🚫 ${st.suspensos} suspenso(s)</span>` : ''}</div>
      <!-- Ações em massa: agem sobre os cards DO FILTRO ATUAL, não sobre o baralho
           inteiro. É isso que torna a exclusão em lote útil e segura — você filtra
           por matéria, deck ou busca e apaga só aquele recorte. -->
      <div class="cards-bulk">
        <label class="cards-select-toggle" title="Selecionar ou limpar todos os cards exibidos pelo filtro atual">
          <input type="checkbox" id="cards-sel-toggle">
          <span id="cards-sel-toggle-label">Selecionar todos</span>
        </label>
        <span class="cards-bulk-count" id="cards-sel-count"></span>
        <button type="button" class="btn-danger" id="cards-del-sel" style="display:none;">Excluir selecionados</button>
      </div>
      <div class="cards-grid" id="cards-grid-meus">${filtered.slice(0, n).map(c => this.miniCardHtml(c)).join('')}</div>
      <div id="cards-mais-wrap" style="text-align:center;padding:14px 0;"></div>`;

    const grid = box.querySelector('#cards-grid-meus');
    const maisWrap = box.querySelector('#cards-mais-wrap');

    /* ── SELECAO EM MASSA ──────────────────────────────────────────────────
       O conjunto vive em memoria (nao no card), entao mudar de filtro ou sair
       da tela limpa a selecao — nao existe risco de apagar algo marcado em
       outro contexto. "Selecionar todos" cobre o FILTRO ATUAL, inclusive os
       cards ainda nao renderizados pela paginacao. */
    const sel = new Set();
    const selToggle = box.querySelector('#cards-sel-toggle');
    const selToggleLabel = box.querySelector('#cards-sel-toggle-label');
    const btnDel = box.querySelector('#cards-del-sel');
    const lblSel = box.querySelector('#cards-sel-count');
    const syncSel = () => {
      lblSel.textContent = sel.size ? sel.size + ' selecionado(s)' : '';
      btnDel.style.display = sel.size ? '' : 'none';
      const todos = filtered.length > 0 && sel.size === filtered.length;
      selToggle.checked = todos;
      selToggle.indeterminate = sel.size > 0 && !todos;
      selToggleLabel.textContent = todos ? 'Limpar seleção' : 'Selecionar todos';
      grid.querySelectorAll('.mini-card').forEach(mc => {
        const marcado = sel.has(mc.dataset.id);
        mc.classList.toggle('is-sel', marcado);
        const cb = mc.querySelector('.mini-sel');
        if (cb) cb.checked = marcado;
      });
    };
    grid.addEventListener('change', (e) => {
      const cb = e.target.closest('.mini-sel');
      if (!cb) return;
      if (cb.checked) sel.add(cb.dataset.id); else sel.delete(cb.dataset.id);
      syncSel();
    });
    // clique no checkbox nao deve abrir o card para edicao
    grid.addEventListener('click', (e) => { if (e.target.closest('.mini-card-sel')) e.stopPropagation(); }, true);
    selToggle.addEventListener('change', () => {
      if (selToggle.checked) filtered.forEach(c => sel.add(c.id)); else sel.clear();
      syncSel();
    });
    btnDel.addEventListener('click', () => {
      const qtd = sel.size;
      if (!qtd) return;
      // Exclusao em lote e irreversivel: a confirmacao diz o NUMERO exato e avisa
      // que nao ha como desfazer, em vez de um "tem certeza?" generico.
      UI.confirm(
        'Excluir ' + qtd + ' card(s)? Esta ação não pode ser desfeita.',
        { title: '🗑 Excluir cards', okText: 'Excluir ' + qtd, danger: true }
      ).then((ok) => {
        if (!ok) return;
        const ids = new Set(sel);
        const restantes = DB.getCards().filter(c => !ids.has(c.id));
        DB.saveCards(restantes);
        CardEngine.invalidateDueCache();
        sel.clear();
        this._meusMostrando = 0;
        this.render();
        showToast(qtd + ' card(s) excluído(s) 🗑');
      });
    });
    syncSel();
    const pintarMais = () => {
      if (n >= filtered.length) {
        maisWrap.innerHTML = filtered.length > this.PAGINA_CARDS
          ? `<span class="hint">Fim da lista · ${filtered.length} card(s).</span>` : '';
        return;
      }
      const restam = filtered.length - n;
      maisWrap.innerHTML = `<button type="button" class="btn-secondary" id="cards-carregar-mais">Carregar mais ${Math.min(this.PAGINA_CARDS, restam)} (restam ${restam})</button>`;
      maisWrap.querySelector('#cards-carregar-mais').addEventListener('click', () => {
        const lote = filtered.slice(n, n + this.PAGINA_CARDS);
        grid.insertAdjacentHTML('beforeend', lote.map(c => this.miniCardHtml(c)).join(''));
        n += lote.length; this._meusMostrando = n;
        pintarMais();
      });
    };
    pintarMais();

    // Um listener para a lista inteira, em vez de quatro por card. Além de mais
    // barato, é o que faz os cards carregados depois já nascerem funcionando.
    grid.addEventListener('click', async (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        const c = DB.getCard(fav.dataset.fav);
        if (!c) return;
        const novo = !c.favorito;
        DB.updateCard(c.id, { favorito: novo });
        this.updateFavCount();
        // Atualiza SÓ a estrela clicada. Antes, favoritar refazia a lista toda —
        // e ainda fazia a página saltar de volta para o topo.
        fav.classList.toggle('on', novo);
        fav.textContent = novo ? '★' : '☆';
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) { this.openCardModal(ed.dataset.edit); return; }
      const un = e.target.closest('[data-unsusp]');
      if (un) {
        DB.updateCard(un.dataset.unsusp, { suspenso: false, due: todayCards(), dueTs: null });
        CardEngine.invalidateDueCache();
        showToast('Card reativado ✓'); this.renderMeus(box);
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!await UI.confirm('Excluir este card?')) return;
        DB.deleteCard(del.dataset.del); this.render();
      }
    });
  },
  emptyState(title, sub) {
    return `<div class="card"><div class="empty-state" style="padding:40px 20px;"><div class="big">🗂️</div><h3 style="margin:4px 0;">${title}</h3><p style="color:var(--text-faint)">${sub}</p></div></div>`;
  },

  // ---- modal criar/editar card ----
  // ajusta a UI conforme o formato (básico / invertido / cloze)
  applyKindUI() {
    const kind = $id('card-kind').value;
    const isCloze = kind === 'cloze';
    $id('card-cloze-btn').style.display = isCloze ? 'inline-block' : 'none';
    $id('card-verso-field').style.display = isCloze ? 'none' : 'block';
    $id('card-frente-label').innerHTML = isCloze ? 'Texto (use {{ }} para ocultar) <span class="req">*</span>' : 'Frente (pergunta) <span class="req">*</span>';
    const hint = document.getElementById('card-kind-hint');
    if (isCloze) hint.innerHTML = 'Selecione um trecho e clique em <strong>{{ }} Ocultar</strong> — ele será escondido na frente e revelado no verso. Ótimo para lei seca.';
    else if (kind === 'basic_reversed') hint.innerHTML = 'Serão criados <strong>2 cards</strong>: um frente→verso e outro verso→frente.';
    else hint.innerHTML = 'Card simples: você vê a frente e revela o verso.';
  },
  openCardModal(id) {
    this._editingId = id || null;
    const isEdit = !!id;
    $id('card-modal-title').textContent = isEdit ? '✎ Editar card' : '＋ Criar card';
    $id('card-del-btn').style.display = isEdit ? 'inline-block' : 'none';
    $id('card-save-another').style.display = isEdit ? 'none' : 'inline-block';
    let destSel = '', topico = '', banca = '', tipo = '', frente = '', verso = '', kind = 'basic';
    if (isEdit) {
      const c = DB.getCard(id);
      destSel = c.deckId ? 'deck:' + c.deckId : (c.materia ? 'sub:' + c.materia : '');
      topico = c.topico || ''; banca = c.banca || ''; tipo = c.tipo || ''; frente = c.frente || ''; verso = c.verso || ''; kind = c.kind || 'basic';
    }
    $id('card-destino').innerHTML = this.destinoOptionsHtml(destSel);
    $id('card-topico').value = topico;
    const tops = [...new Set(DB.getCards().map(c => c.topico).filter(Boolean))].sort();
    $id('card-topico-list').innerHTML = tops.map(t => `<option value="${escapeHtml(t)}">`).join('');
    // Banca: sugere as bancas já importadas na Incidência + as já usadas em outros cards
    $id('card-banca').value = banca;
    const bancasImport = (DB.getBancas ? DB.getBancas() : []);
    const bancasCards = DB.getCards().map(c => c.banca).filter(Boolean);
    const bancaOpts = [...new Set([...bancasImport, ...bancasCards])].sort();
    $id('card-banca-list').innerHTML = bancaOpts.map(t => `<option value="${escapeHtml(t)}">`).join('');
    $id('card-tipo').value = tipo;
    // ao editar, o formato invertido não é reofertado (já são 2 cards); mostra básico/cloze
    const kindSel = document.getElementById('card-kind');
    kindSel.querySelector('option[value="basic_reversed"]').style.display = isEdit ? 'none' : '';
    kindSel.value = (kind === 'cloze') ? 'cloze' : 'basic';
    $id('card-frente').innerHTML = frente;
    $id('card-verso').innerHTML = verso;
    this.applyKindUI();
    $id('card-modal').style.display = 'flex';
    setTimeout(() => $id('card-destino').focus(), 50);
  },
  closeCardModal() { $id('card-modal').style.display = 'none'; this._editingId = null; },
  // Há algo que se perderia ao fechar? Para as áreas ricas olha o innerHTML, não o
  // innerText: um card com apenas uma IMAGEM colada tem texto vazio e seria
  // descartado como se estivesse em branco.
  cardTemConteudo() {
    const rico = (id) => {
      const e = document.getElementById(id);
      if (!e) return false;
      const html = (e.innerHTML || '').replace(/<br\s*\/?>|&nbsp;|\s/gi, '').replace(/<div><\/div>/gi, '');
      return html.length > 0;
    };
    const campo = (id) => { const e = document.getElementById(id); return !!(e && (e.value || '').trim()); };
    return rico('card-frente') || rico('card-verso') || campo('card-topico') || campo('card-banca');
  },
  // Fecha pedindo confirmação quando há conteúdo não salvo
  async fecharCardComAviso() {
    if (this.cardTemConteudo()) {
      const ok = await UI.confirm('Descartar este card? O que você escreveu será perdido.',
        { title: 'Fechar sem salvar', okText: 'Descartar', danger: true });
      if (!ok) return;
    }
    this.closeCardModal();
  },
  _readCardForm() {
    let dest = $id('card-destino').value;
    // "novo:Nome" = baralho padrão oferecido quando o perfil ainda não tem destino
    // nenhum. Só é criado de fato agora, quando o card vai ser salvo.
    if (dest.startsWith('novo:')) {
      const nome = dest.slice(5);
      const existente = DB.getDecks().find(d => d.nome === nome);
      const deck = existente || DB.addDeck(nome);
      dest = 'deck:' + deck.id;
    }
    const kind = $id('card-kind').value;
    const frente = $id('card-frente').innerHTML.trim();
    const verso = $id('card-verso').innerHTML.trim();
    if (!dest) { showToast('Escolha o destino (disciplina ou baralho)'); return null; }
    if (kind === 'cloze') {
      if (!CardEngine.plain(frente)) { showToast('Escreva o texto do cloze'); return null; }
      if (!CardEngine.hasCloze(frente)) { showToast('Marque ao menos um trecho para ocultar com {{ }}'); return null; }
    } else {
      if (!CardEngine.plain(frente)) { showToast('Preencha a frente'); return null; }
      if (!CardEngine.plain(verso)) { showToast('Preencha o verso'); return null; }
    }
    const data = {
      topico: $id('card-topico').value,
      banca: $id('card-banca').value,
      tipo: $id('card-tipo').value,
      kind: kind === 'cloze' ? 'cloze' : 'basic',
      frente, verso: kind === 'cloze' ? '' : verso, deckId: null, materia: null,
      _reversed: kind === 'basic_reversed'
    };
    if (dest.startsWith('deck:')) data.deckId = dest.slice(5);
    else if (dest.startsWith('sub:')) data.materia = dest.slice(4);
    return data;
  },
  saveCard(closeAfter) {
    const data = this._readCardForm();
    if (!data) return;
    const reversed = data._reversed; delete data._reversed;
    if (this._editingId) {
      DB.updateCard(this._editingId, data); showToast('Card atualizado ✓'); this.closeCardModal();
    } else {
      const c = DB.addCard(data);
      if (reversed) {
        DB.addCard({ ...data, frente: data.verso, verso: data.frente, reversedOf: c.id });
        showToast('2 cards criados (normal + invertido) ✓');
      } else showToast('Card criado ✓');
      if (closeAfter) this.closeCardModal();
      else {
        $id('card-frente').innerHTML = '';
        $id('card-verso').innerHTML = '';
        $id('card-frente').focus();
      }
    }
    this.render();
  },
  async deleteCard() {
    if (!this._editingId) return;
    if (!await UI.confirm('Excluir este card?')) return;
    DB.deleteCard(this._editingId); this.closeCardModal(); this.render(); showToast('Card excluído');
  },

  // ---- baralhos ----
  openDeckModal() { this.renderDeckList(); $id('deck-modal').style.display = 'flex'; },
  renderDeckList() {
    const box = document.getElementById('deck-list');
    const decks = DB.getDecks();
    if (decks.length === 0) { box.innerHTML = `<p class="hint">Nenhum baralho ainda. Crie o primeiro acima.</p>`; return; }
    box.innerHTML = decks.map(d => {
      const n = DB.getCards().filter(c => c.deckId === d.id).length;
      return `<div class="deck-row" data-id="${d.id}">
        <input type="text" class="deck-name" value="${escapeHtml(d.nome)}">
        <span class="deck-count">${n} card(s)</span>
        <button type="button" class="icon-btn danger deck-del" title="Excluir baralho" aria-label="Excluir baralho">×</button>
      </div>`;
    }).join('');
    box.querySelectorAll('.deck-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.deck-name').addEventListener('change', (e) => { DB.renameDeck(id, e.target.value); this.render(); });
      row.querySelector('.deck-del').addEventListener('click', async () => {
        if (!await UI.confirm('Excluir este baralho? Os cards dele NÃO são apagados (ficam sem destino).')) return;
        DB.deleteDeck(id); this.renderDeckList(); this.render();
      });
    });
  },
  addDeck() {
    const inp = document.getElementById('deck-new-input');
    const d = DB.addDeck(inp.value);
    if (!d) { showToast('Digite um nome'); return; }
    inp.value = ''; this.renderDeckList(); this.render(); showToast('Baralho criado ✓');
  },

  // ---- exportar ----
  openExportModal() {
    const cards = DB.getCards();
    const body = document.getElementById('cards-export-body');
    if (cards.length === 0) { body.innerHTML = `<p class="hint">Você ainda não criou nenhum card.</p>`; }
    else {
      const st = CardEngine.stats(cards);
      body.innerHTML = `<p style="font-size:14px;">Você tem <strong>${cards.length} card(s)</strong>. Escolha o formato:</p>
        <ul style="font-size:13px; color:var(--text-soft); line-height:1.7; margin:8px 0 0; padding-left:18px;">
          <li><strong>Anki (.txt)</strong>: importe no Anki (Arquivo → Importar). Cada linha = Frente[tab]Verso[tab]Tags.</li>
          <li><strong>Backup (.json)</strong>: cópia completa para reimportar aqui depois.</li>
        </ul>`;
    }
    $id('cards-export-modal').style.display = 'flex';
  },
  _download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  exportAudit() {
    try {
    const cards = DB.getCards();
    const revlog = DB.getRevlog();
    const cfg = CardsConfig.get();
    const daily = CardsConfig._daily();
    const decks = DB.getDecks();
    const now = new Date();
    const byCard = {};
    cards.forEach(c => {
      const logs = revlog.filter(r => r.cardId === c.id).sort((a,b) => (a.ts||0) - (b.ts||0));
      byCard[c.id] = {
        id:c.id, deckId:c.deckId||null, materia:c.materia||null, topico:c.topico||null, tipo:c.tipo||null,
        createdAt:c.createdAt||null, updatedAt:c.updatedAt||null, phase:c.phase||null, learnStep:c.learnStep??null,
        due:c.due||null, dueTs:c.dueTs||null, intervalo:c.intervalo??null, reps:c.reps||0, lapses:c.lapses||0,
        ease:c.ease??null, s:c.s??null, d:c.d??null, status:c.status||null, suspenso:!!c.suspenso,
        /* lastReview FALTAVA no export — e é justamente o campo que decide
           curto vs longo prazo no agendador (days_since_last_review < 1).
           Sem ele, a auditoria não conseguia diagnosticar o próprio agendador. */
        lastReview:c.lastReview||null, algo:c.algo||null,
        leech:!!c.leech, favorito:!!c.favorito, enterradoAte:c.enterradoAte||null,
        /* "Era" do estado de memória: identifica cards cujo S inicial veio dos
           pesos padrão do FSRS-5 (app antigo) em vez do FSRS-6. */
        eraFsrs: (function(){
          if (c.s == null) return null;
          const q = (a) => Math.abs(c.s - a) < 1e-6;
          if (q(0.40255)||q(1.18385)||q(3.173)||q(15.69105)) return 'fsrs5-inicial';
          if (q(0.212)||q(1.2931)||q(2.3065)||q(8.2956)) return 'fsrs6-inicial';
          return 'derivado';
        })(),
        reviewCount:logs.length, reviewLog:logs
      };
    });
    const anomalies = [];
    cards.forEach(c => {
      if ((c.phase === 'learning' || c.phase === 'relearning') && !c.dueTs && !c.due) anomalies.push({cardId:c.id,type:'learning_without_due'});
      if (c.dueTs && Number(c.dueTs) < 0) anomalies.push({cardId:c.id,type:'negative_dueTs'});
      if ((c.reps||0) > 0 && !revlog.some(r => r.cardId === c.id)) anomalies.push({cardId:c.id,type:'reps_without_revlog',reps:c.reps});
      if (c.phase === 'review' && !(c.intervalo > 0)) anomalies.push({cardId:c.id,type:'review_sem_intervalo'});
      if (typeof c.s === 'number' && (!isFinite(c.s) || c.s < 0.001 || c.s > 36500)) anomalies.push({cardId:c.id,type:'s_fora_de_faixa',s:c.s});
      if (typeof c.d === 'number' && (!isFinite(c.d) || c.d < 1 || c.d > 10)) anomalies.push({cardId:c.id,type:'d_fora_de_faixa',d:c.d});
    });
    // Mistura de gerações: cards agendados por pesos padrão de versões diferentes
    const eras = { f5:0, f6:0 };
    cards.forEach(c => {
      if (typeof c.s !== 'number') return;
      const q = (a) => Math.abs(c.s - a) < 1e-6;
      if (q(0.40255)||q(1.18385)||q(3.173)||q(15.69105)) eras.f5++;
      else if (q(0.212)||q(1.2931)||q(2.3065)||q(8.2956)) eras.f6++;
    });
    if (eras.f5 > 0 && eras.f6 > 0) {
      anomalies.push({ type:'mistura_de_geracoes_fsrs', fsrs5:eras.f5, fsrs6:eras.f6,
        detalhe:'Cards com estado de memória de gerações diferentes do FSRS convivem na coleção. '
              + 'O mesmo desempenho gera intervalos diferentes conforme a época do card. '
              + 'Use Configurações → Cards → "Recalcular memória pelo histórico" para uniformizar.' });
    }
    const payload = {
      schema:'diario-estudos-cards-audit', version:1, exportedAt:now.toISOString(), appDate:todayCards(),
      purpose:'Diagnóstico do agendador de cards, limites diários e possíveis repetições em loop.',
      environment:{ userAgent:navigator.userAgent, language:navigator.language, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, online:navigator.onLine },
      configuration:cfg, dailyCounters:daily, decks,
      summary:{cards:cards.length, revisionEntries:revlog.length, newCards:cards.filter(c=>CardsScreen._bucket(c)==='new').length, learningCards:cards.filter(c=>CardsScreen._bucket(c)==='learn').length, reviewCards:cards.filter(c=>CardsScreen._bucket(c)==='review').length, anomalies:anomalies.length},
      queueSnapshot:{generatedAt:now.toISOString(), cardIds:(CardsScreen._reviewQueue || []).slice(), position:CardsScreen._reviewIdx, newRemaining:CardsConfig.newRemaining(), reviewRemaining:CardsConfig.revRemaining()},
      cards:byCard, rawReviewLog:revlog, detectedAnomalies:anomalies
    };
    this._download('auditoria-cards_' + todayLocal() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    showToast('Arquivo de auditoria exportado ✓');
    } catch (err) {
      console.error('Falha ao exportar auditoria dos cards:', err);
      showToast('Não foi possível exportar. Detalhe: ' + (err && err.message ? err.message : 'erro desconhecido'));
    }
  },
  exportAnki() {
    const cards = DB.getCards();
    if (cards.length === 0) { showToast('Nenhum card para exportar'); return; }
    // TSV: Frente \t Verso \t Tags (matéria/tópico/tipo viram tags)
    const lines = cards.map(c => {
      const front = CardEngine.plain(c.frente).replace(/\t/g, ' ').replace(/\n/g, '<br>');
      const back = CardEngine.plain(c.verso).replace(/\t/g, ' ').replace(/\n/g, '<br>');
      const tags = [this.materiaLabel(c).replace('📁 ', ''), c.topico, c.banca, c.tipo].filter(Boolean).map(t => t.replace(/\s+/g, '_')).join(' ');
      return `${front}\t${back}\t${tags}`;
    });
    const header = '#separator:tab\n#html:true\n#tags column:3\n';
    this._download('cards-anki_' + todayLocal() + '.txt', header + lines.join('\n'), 'text/plain');
    showToast('Arquivo do Anki exportado ✓');
    $id('cards-export-modal').style.display = 'none';
  },
  exportJson() {
    const payload = { app: 'diario-estudos', kind: 'cards-backup', version: 1, exportedAt: new Date().toISOString(), decks: DB.getDecks(), cards: DB.getCards() };
    this._download('cards-backup_' + todayLocal() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    showToast('Backup exportado ✓');
    $id('cards-export-modal').style.display = 'none';
  },

  // ---- importar ----
  openImportModal() {
    this._importParsed = null;
    $id('cards-import-destino').innerHTML = this.destinoOptionsHtml('');
    $id('cards-import-preview').textContent = 'Aguardando arquivo...';
    $id('cards-import-preview').style.color = 'var(--text-faint)';
    const fn = document.getElementById('cards-import-name'); fn.style.display = 'none';
    $id('cards-import-file').value = '';
    $id('cards-import-modal').style.display = 'flex';
  },
  handleImportFile(file) {
    if (!file) return;
    const fn = document.getElementById('cards-import-name');
    fn.style.display = 'inline-flex'; fn.textContent = '📎 ' + file.name;
    const prev = document.getElementById('cards-import-preview');
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      let parsed = null;
      if (/\.json$/i.test(file.name)) {
        try {
          const obj = JSON.parse(text);
          if (obj && obj.kind === 'cards-backup' && Array.isArray(obj.cards)) parsed = { kind: 'json', cards: obj.cards, decks: obj.decks || [] };
          else { prev.textContent = '⚠ JSON não é um backup de cards válido.'; prev.style.color = 'var(--warn)'; return; }
        } catch (err) { prev.textContent = '⚠ JSON inválido.'; prev.style.color = 'var(--bad)'; return; }
      } else {
        // texto Anki (TSV/CSV): detecta separador
        const rows = this.parseAnkiText(text);
        parsed = { kind: 'text', rows };
      }
      this._importParsed = parsed;
      const n = parsed.kind === 'json' ? parsed.cards.length : parsed.rows.length;
      if (n === 0) { prev.textContent = '⚠ Nenhum card reconhecido no arquivo.'; prev.style.color = 'var(--warn)'; }
      else { prev.textContent = `✓ ${n} card(s) reconhecido(s) para importar.`; prev.style.color = 'var(--good)'; }
    };
    reader.readAsText(file);
  },
  parseAnkiText(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      if (!line.trim() || line.trim().startsWith('#')) return; // ignora comentários/cabeçalhos do Anki
      const sep = line.includes('\t') ? '\t' : (line.includes(';') ? ';' : (line.includes(',') ? ',' : '\t'));
      const cols = line.split(sep);
      if (cols.length < 2) return;
      out.push({ frente: cols[0].trim(), verso: cols[1].trim(), tags: (cols[2] || '').trim() });
    });
    return out;
  },
  doImport() {
    if (!this._importParsed) { showToast('Escolha um arquivo primeiro'); return; }
    const dest = $id('cards-import-destino').value;
    let deckId = null, materia = null;
    if (dest.startsWith('deck:')) deckId = dest.slice(5);
    else if (dest.startsWith('sub:')) materia = dest.slice(4);
    let count = 0;
    if (this._importParsed.kind === 'json') {
      // recria baralhos ausentes por nome
      const backupDecks = this._importParsed.decks || [];
      const idMap = {};
      backupDecks.forEach(bd => { const nd = DB.addDeck(bd.nome); if (nd) idMap[bd.id] = nd.id; });
      this._importParsed.cards.forEach(c => {
        DB.addCard({ deckId: deckId || (c.deckId && idMap[c.deckId]) || null, materia: materia || c.materia || null, topico: c.topico || '', tipo: c.tipo || '', frente: c.frente || '', verso: c.verso || '' });
        count++;
      });
    } else {
      this._importParsed.rows.forEach(r => {
        DB.addCard({ deckId, materia, topico: r.tags || '', tipo: '', frente: r.frente, verso: r.verso });
        count++;
      });
    }
    $id('cards-import-modal').style.display = 'none';
    this.render();
    showToast(`${count} card(s) importado(s) ✓`);
  }
};
// Passo 1: escolher o ESCOPO (global ou um baralho específico) — como o Anki (presets por baralho)
CardsScreen.openAlgoConfig = function () {
  const decks = DB.getDecks();
  const opts = [{ value: '__global__', label: '🌐 Global (padrão de todos)' }].concat(
    decks.map(d => ({ value: d.id, label: '📁 ' + d.nome + (CardsConfig.hasDeckPreset(d.id) ? '  • personalizado' : '  • herda global') }))
  );
  opts.push({ value: '__reset__', label: '🧹 Zerar estatísticas e resíduos…' });
  UI.prompt([{ key: 'scope', label: '⚙ Configurar qual conjunto?', type: 'select', value: '__global__', options: opts,
    hint: 'Cada baralho pode ter seu próprio algoritmo/retenção (ex.: lei seca em 95%, teoria em 88%). Sem preset, o baralho herda o global.' }],
    { title: '⚙ Parâmetros dos Cards', okText: 'Continuar' }).then(v => {
      if (!v) return;
      if (v.scope === '__reset__') { CardsScreen.zerarEstatisticas(); return; }
      CardsScreen.openAlgoConfigFor(v.scope === '__global__' ? null : v.scope);
    });
};

/* ── ZERAR ESTATÍSTICAS E RESÍDUOS ──────────────────────────────────────────
   Serve para começar um teste do zero: apaga o histórico de revisões, os
   contadores do dia e devolve TODOS os cards ao estado "novo" (como o
   "Esquecer"/Forget do Anki, que restaura a posição na fila de novos).
   O CONTEÚDO dos cards é preservado — frente, verso, matéria, baralho, tudo
   fica. Some só o que é progresso.
   Duas confirmações de propósito: a primeira explica o que vai acontecer, a
   segunda exige digitar ZERAR. É irreversível e não passa pelo desfazer. */
CardsScreen.zerarEstatisticas = function () {
  const nCards = DB.getCards().length;
  const nRev = DB.getRevlog().length;
  UI.confirm(
    'Isto vai:\n\n' +
    '• apagar as ' + nRev.toLocaleString('pt-BR') + ' entrada(s) do histórico de revisões\n' +
    '• devolver os ' + nCards.toLocaleString('pt-BR') + ' card(s) ao estado "novo"\n' +
    '• zerar os contadores de hoje (novos/revisões)\n' +
    '• limpar resíduos de cards já excluídos\n\n' +
    'O conteúdo dos cards NÃO é apagado — frente, verso, matéria e baralho continuam.\n' +
    'Não há como desfazer.',
    { title: '🧹 Zerar estatísticas dos cards', okText: 'Continuar', danger: true }
  ).then(ok => {
    if (!ok) return;
    UI.prompt([{ key: 'txt', label: 'Digite ZERAR para confirmar', type: 'text', value: '',
      hint: 'Confirmação extra porque a ação é irreversível.' }],
      { title: '🧹 Confirmar', okText: 'Zerar agora' }).then(v => {
        if (!v || String(v.txt || '').trim().toUpperCase() !== 'ZERAR') {
          showToast('Cancelado — nada foi alterado');
          return;
        }
        const r = DB.zerarProgressoCards();
        CardEngine.invalidateDueCache();
        CardsScreen._meusMostrando = 0;
        CardsScreen._reviewQueue = []; CardsScreen._reviewIdx = 0;
        CardsScreen._undoStack = []; CardsScreen._seenThisSession = new Set();
        CardsScreen.render();
        showToast('🧹 Zerado: ' + r.revlog + ' revisão(ões) e ' + r.cards + ' card(s) reiniciado(s)');
      });
  });
};
// Passo 2: formulário para o escopo escolhido (deckId=null → global)
CardsScreen.openAlgoConfigFor = function (deckId) {
  const isDeck = !!deckId;
  const g = CardsConfig.get();
  const cfg = isDeck ? CardsConfig.forDeck(deckId) : g;
  const deckName = isDeck ? ((DB.getDecks().find(d => d.id === deckId) || {}).nome || 'baralho') : null;
  const hasPreset = isDeck && CardsConfig.hasDeckPreset(deckId);
  const fields = [
    { key: 'algo', label: '🧠 Algoritmo de repetição espaçada', type: 'select', value: cfg.algo,
      options: [{ value: 'fsrs', label: 'FSRS-6 (recomendado — igual ao Anki atual)' }, { value: 'sm2', label: 'Clássico (SM-2)' }],
      hint: 'FSRS agenda cada card no dia exato da sua meta de retenção — 20–30% mais eficiente.' },
    { key: 'retention', label: '🎯 Retenção-alvo (%) — só FSRS', type: 'number', value: Math.round(cfg.retention * 100), min: 70, max: 97,
      hint: 'Maior = revê mais e esquece menos. Padrão do Anki: 90%.' },
    { key: 'learn', label: '⏱️ Passos de aprendizado (min)', type: 'text', value: cfg.learnSteps.join(' '), placeholder: '1 10',
      hint: 'Card novo: você o revê nesses minutos até fixar (ex.: 1 10).' },
    { key: 'relearn', label: '🔁 Passos de reaprendizado (min)', type: 'text', value: cfg.relearnSteps.join(' '), placeholder: '10',
      hint: 'Ao errar um card já aprendido, ele volta nesses minutos.' },
    { key: 'lb', label: '⚖️ Balancear carga (Load Balancing)', type: 'select', value: cfg.loadBalance ? '1' : '0',
      options: [{ value: '1', label: 'Ligado (distribui as revisões)' }, { value: '0', label: 'Desligado' }],
      hint: 'Escolhe, dentro da janela de dispersão, o dia com menos revisões marcadas.' },
    { key: 'maxInterval', label: '📆 Intervalo máximo (dias)', type: 'number', value: cfg.maxInterval || 36500, min: 1, max: 36500,
      hint: 'Teto de espera entre revisões. Padrão Anki: 36500 (100 anos).' },
    { key: 'leechThreshold', label: '🚫 Erros até marcar como problemático', type: 'number', value: cfg.leechThreshold != null ? cfg.leechThreshold : 8, min: 0, max: 99,
      hint: 'Padrão Anki: 8. Use 0 para desativar.' },
    { key: 'leechAction', label: '🚫 O que fazer com o card problemático', type: 'select', value: cfg.leechAction || 'suspend',
      options: [{ value: 'suspend', label: 'Suspender (tira da fila)' }, { value: 'tag', label: 'Só marcar (continua aparecendo)' }],
      hint: 'Suspenso some da revisão até você reativar em Meus cards.' }
  ];
  /* ── ORDENAÇÃO E MISTURA — paridade com deck_config.proto ──────────────────
     Cada rótulo diz o que a opção FAZ, não só como se chama. São escolhas cujo
     efeito só aparece depois de dias de uso, então a dica precisa explicar o
     porquê. */
  fields.push(
    { key: 'reviewOrder', label: '🔢 Ordem das revisões', type: 'select', value: cfg.reviewOrder || 'retrievabilityAsc',
      options: [
        { value: 'retrievabilityAsc',  label: 'Mais perto de esquecer primeiro (recomendado)' },
        { value: 'retrievabilityDesc', label: 'Mais bem lembrado primeiro' },
        { value: 'relativeOverdueness',label: 'Atraso relativo ao intervalo' },
        { value: 'day',                label: 'Data de vencimento (mais atrasado antes)' },
        { value: 'intervalsAsc',       label: 'Intervalo menor primeiro' },
        { value: 'intervalsDesc',      label: 'Intervalo maior primeiro' },
        { value: 'easeAsc',            label: 'Mais difíceis primeiro' },
        { value: 'easeDesc',           label: 'Mais fáceis primeiro' },
        { value: 'added',              label: 'Ordem de criação' },
        { value: 'random',             label: 'Aleatória' }
      ],
      hint: 'Com fila acumulada, isto muda muito o rendimento: revisar antes o que está prestes a sumir preserva mais memória por minuto. "Atraso relativo" prioriza quem passou mais tempo além do próprio intervalo — 3 dias de atraso num card de 3 dias é grave; num de 300, não.' },
    { key: 'newGatherOrder', label: '🆕 Quais cards novos entram primeiro', type: 'select', value: cfg.newGatherOrder || 'posicao',
      options: [
        { value: 'posicao',        label: 'Posição na fila (ordem de inserção)' },
        { value: 'posicaoDesc',    label: 'Posição invertida (mais recentes antes)' },
        { value: 'criacao',        label: 'Data de criação' },
        { value: 'materiaRodizio', label: 'Rodízio entre matérias' }
      ],
      hint: 'O rodízio evita que colar 40 assuntos de uma matéria faça os próximos dias virarem monotemáticos.' },
    { key: 'newInsertOrder', label: '🆕 Posição de um card recém-criado', type: 'select', value: cfg.newInsertOrder || 'sequencial',
      options: [
        { value: 'sequencial', label: 'No fim da fila (padrão)' },
        { value: 'aleatoria',  label: 'Posição sorteada' }
      ],
      hint: 'Decidida no momento da criação. "Sorteada" faz um lote grande se intercalar com o que já esperava, em vez de virar um bloco no fim.' },
    { key: 'newSortOrder', label: '🆕 Ordem de exibição dos novos', type: 'select', value: cfg.newSortOrder || 'coleta',
      options: [{ value: 'coleta', label: 'Manter a ordem de coleta' }, { value: 'aleatoria', label: 'Embaralhar' }],
      hint: 'Só reordena o lote do dia; não muda quais entram.' },
    { key: 'newMix', label: '🔀 Onde entram os cards NOVOS', type: 'select', value: cfg.newMix || 'misturar',
      options: [
        { value: 'misturar', label: 'Misturados com as revisões (padrão Anki)' },
        { value: 'depois',   label: 'Depois de todas as revisões' },
        { value: 'antes',    label: 'Antes de todas as revisões' }
      ],
      hint: '"Depois" é a escolha de quem prefere despachar a fila conhecida antes de gastar energia com conteúdo novo.' },
    { key: 'interdayMix', label: '🔀 Onde entra o aprendizado do dia anterior', type: 'select', value: cfg.interdayMix || 'misturar',
      options: [
        { value: 'misturar', label: 'Misturado com as revisões' },
        { value: 'depois',   label: 'Depois das revisões' },
        { value: 'antes',    label: 'Antes das revisões (padrão antigo)' }
      ],
      hint: 'Cards que você errou ontem e ficaram no meio do caminho.' },
    { key: 'easyDays', label: '📅 Dias leves (% da carga, Dom→Sáb)', type: 'text',
      value: (cfg.easyDays || [1,1,1,1,1,1,1]).map(x => Math.round(x * 100)).join(' '), placeholder: '100 100 100 100 100 100 100',
      hint: 'Sete números de 0 a 100, começando no domingo. Ex.: "50 100 100 100 100 100 30" alivia domingo e sábado. Não é proibição: se não houver alternativa dentro da janela de dispersão, o dia ainda é usado.' },
    { key: 'ignoreRevlogsBefore', label: '📜 Ignorar revisões anteriores a', type: 'text', value: cfg.ignoreRevlogsBefore || '', placeholder: 'AAAA-MM-DD',
      hint: 'Descarta o histórico antigo ao otimizar. Útil se você mudou de método ou importou baralho de terceiros. Vazio = usar tudo.' },
    { key: 'historicalRetention', label: '🕰️ Retenção histórica presumida (%)', type: 'number', value: Math.round((cfg.historicalRetention || 0.9) * 100), min: 50, max: 99,
      hint: 'Usada para converter cards antigos do SM-2 em estado de memória do FSRS. É a pergunta que o Anki faz ao migrar. Padrão: 90.' },
    { key: 'paramSearch', label: '🔎 Cards que treinam os parâmetros', type: 'text', value: cfg.paramSearch || '', placeholder: 'ex.: materia:tributário -suspenso',
      hint: 'Filtra quem entra no treino. Os parâmetros descrevem COMO VOCÊ ESQUECE — misturar lei seca com raciocínio lógico produz uma média que não descreve nenhum dos dois. Aceita materia: topico: tipo: baralho: favorito suspenso leech, texto livre e "-" para excluir. Vazio = todos.' }
  );

  /* ── PARÂMETROS DO CLÁSSICO (SM-2) ─────────────────────────────────────────
     Só fazem efeito com o algoritmo Clássico selecionado. Com FSRS o intervalo
     vem do modelo de memória e estes multiplicadores são ignorados — igual ao
     Anki, que também esconde/desabilita a seção quando o FSRS está ligado. */
  fields.push(
    { key: 'initialEase', label: '📐 [Clássico] Facilidade inicial', type: 'number', value: Math.round((cfg.initialEase != null ? cfg.initialEase : 2.5) * 100), min: 130, max: 500,
      hint: 'Em centésimos: 250 = 2,50. Multiplicador aplicado ao intervalo quando você acerta "Bom". Padrão Anki: 250.' },
    { key: 'hardMultiplier', label: '📐 [Clássico] Multiplicador do "Difícil"', type: 'number', value: Math.round((cfg.hardMultiplier != null ? cfg.hardMultiplier : 1.2) * 100), min: 50, max: 130,
      hint: 'Em centésimos: 120 = 1,20. Padrão Anki: 120.' },
    { key: 'easyMultiplier', label: '📐 [Clássico] Bônus do "Fácil"', type: 'number', value: Math.round((cfg.easyMultiplier != null ? cfg.easyMultiplier : 1.3) * 100), min: 100, max: 500,
      hint: 'Em centésimos: 130 = 1,30. Padrão Anki: 130.' },
    { key: 'lapseMultiplier', label: '📐 [Clássico] Novo intervalo após errar (%)', type: 'number', value: Math.round((cfg.lapseMultiplier != null ? cfg.lapseMultiplier : 0) * 100), min: 0, max: 100,
      hint: 'Quanto do intervalo antigo o card mantém ao ser errado. 0 = recomeça. Padrão Anki: 0.' },
    { key: 'intervalMultiplier', label: '📐 [Clássico] Multiplicador global (%)', type: 'number', value: Math.round((cfg.intervalMultiplier != null ? cfg.intervalMultiplier : 1) * 100), min: 50, max: 200,
      hint: 'Escala TODOS os intervalos. 100 = normal. Abaixo de 100 revê mais; acima, menos.' },
    { key: 'minimumLapseInterval', label: '📐 [Clássico] Intervalo mínimo após errar (dias)', type: 'number', value: cfg.minimumLapseInterval != null ? cfg.minimumLapseInterval : 1, min: 1, max: 99,
      hint: 'Piso do intervalo depois de um erro. Padrão Anki: 1.' },
    { key: 'graduatingIntervalGood', label: '📐 [Clássico] Intervalo ao formar com "Bom" (dias)', type: 'number', value: cfg.graduatingIntervalGood != null ? cfg.graduatingIntervalGood : 1, min: 1, max: 999,
      hint: 'Quando o card sai do aprendizado. Padrão Anki: 1.' },
    { key: 'graduatingIntervalEasy', label: '📐 [Clássico] Intervalo ao formar com "Fácil" (dias)', type: 'number', value: cfg.graduatingIntervalEasy != null ? cfg.graduatingIntervalEasy : 4, min: 1, max: 999,
      hint: 'Padrão Anki: 4.' }
  );

  // limites diários só no escopo global (no Anki também são por baralho, mas mantemos simples)
  if (!isDeck) {
    fields.push({ key: 'newPerDay', label: '🆕 Máx. de cards NOVOS por dia', type: 'number', value: g.newPerDay, min: 0, max: 999, hint: 'Padrão Anki: 20.' });
    fields.push({ key: 'revPerDay', label: '🔄 Máx. de REVISÕES por dia', type: 'number', value: g.revPerDay, min: 0, max: 9999, hint: 'Padrão Anki: 200.' });
    fields.push({ key: 'newPerDayMinimum', label: '🆕 Mínimo de novos mesmo com fila cheia', type: 'number', value: g.newPerDayMinimum || 0, min: 0, max: 99,
      hint: 'Sem isto, uma fila acumulada trava a entrada de conteúdo novo por semanas — você só apaga incêndio e nunca avança. 0 = desligado.' });
  }
  const title = isDeck ? ('⚙ Baralho: ' + deckName) : '⚙ Configuração Global';
  UI.prompt(fields, { title, okText: 'Salvar', sub: isDeck ? (hasPreset ? 'Este baralho usa um preset próprio.' : 'Salvar aqui cria um preset só para este baralho.') : '' }).then(v => {
    if (!v) return;
    const parseSteps = (s, def) => { const a = String(s).split(/[\s,]+/).map(x => parseFloat(x)).filter(x => x > 0); return a.length ? a : def; };
    const ret = Math.min(0.97, Math.max(0.70, (parseFloat(v.retention) || 90) / 100));
    const patch = {
      algo: v.algo === 'sm2' ? 'sm2' : 'fsrs', retention: ret,
      learnSteps: parseSteps(v.learn, [1, 10]), relearnSteps: parseSteps(v.relearn, [10]),
      loadBalance: v.lb === '1',
      maxInterval: Math.min(36500, Math.max(1, parseInt(v.maxInterval, 10) || 36500)),
      leechThreshold: Math.max(0, Math.min(99, parseInt(v.leechThreshold, 10) != null && !isNaN(parseInt(v.leechThreshold, 10)) ? parseInt(v.leechThreshold, 10) : 8)),
      leechAction: v.leechAction === 'tag' ? 'tag' : 'suspend',
      /* Novas opções de ordenação/mistura. Cada valor é validado contra a lista
         permitida: um select adulterado não pode injetar uma chave que depois
         quebraria a montagem da fila. */
      reviewOrder: ['retrievabilityAsc','retrievabilityDesc','relativeOverdueness','day',
                    'intervalsAsc','intervalsDesc','easeAsc','easeDesc','added','random']
                   .includes(v.reviewOrder) ? v.reviewOrder : 'retrievabilityAsc',
      newGatherOrder: ['posicao','posicaoDesc','criacao','materiaRodizio']
                   .includes(v.newGatherOrder) ? v.newGatherOrder : 'posicao',
      newSortOrder: v.newSortOrder === 'aleatoria' ? 'aleatoria' : 'coleta',
      newInsertOrder: v.newInsertOrder === 'aleatoria' ? 'aleatoria' : 'sequencial',
      newMix: ['misturar','depois','antes'].includes(v.newMix) ? v.newMix : 'misturar',
      interdayMix: ['misturar','depois','antes'].includes(v.interdayMix) ? v.interdayMix : 'misturar',
      /* easyDays: sete inteiros de 0 a 100 (domingo→sábado) vindos como texto.
         Qualquer entrada que não produza exatamente 7 valores volta ao neutro —
         melhor ignorar do que agendar com uma semana pela metade. */
      easyDays: (function () {
        const a = String(v.easyDays || '').split(/[\s,]+/).map(x => parseFloat(x))
          .filter(x => isFinite(x)).map(x => Math.min(1, Math.max(0, x / 100)));
        return a.length === 7 ? a : [1, 1, 1, 1, 1, 1, 1];
      })(),
      // Data no formato ISO; qualquer outra coisa é descartada.
      ignoreRevlogsBefore: /^\d{4}-\d{2}-\d{2}$/.test(String(v.ignoreRevlogsBefore || '').trim())
                   ? String(v.ignoreRevlogsBefore).trim() : '',
      historicalRetention: Math.min(0.99, Math.max(0.50, (parseFloat(v.historicalRetention) || 90) / 100)),
      paramSearch: String(v.paramSearch || '').trim().slice(0, 200),
      // Parâmetros do Clássico. Chegam em centésimos para evitar vírgula decimal
      // no campo numérico do celular, que varia de teclado para teclado.
      initialEase: Math.min(5.0, Math.max(1.3, (parseInt(v.initialEase, 10) || 250) / 100)),
      hardMultiplier: Math.min(1.3, Math.max(0.5, (parseInt(v.hardMultiplier, 10) || 120) / 100)),
      easyMultiplier: Math.min(5.0, Math.max(1.0, (parseInt(v.easyMultiplier, 10) || 130) / 100)),
      lapseMultiplier: Math.min(1.0, Math.max(0.0, (parseInt(v.lapseMultiplier, 10) || 0) / 100)),
      intervalMultiplier: Math.min(2.0, Math.max(0.5, (parseInt(v.intervalMultiplier, 10) || 100) / 100)),
      minimumLapseInterval: Math.min(99, Math.max(1, parseInt(v.minimumLapseInterval, 10) || 1)),
      graduatingIntervalGood: Math.min(999, Math.max(1, parseInt(v.graduatingIntervalGood, 10) || 1)),
      graduatingIntervalEasy: Math.min(999, Math.max(1, parseInt(v.graduatingIntervalEasy, 10) || 4))
    };
    if (isDeck) { CardsConfig.setDeckPreset(deckId, patch); showToast('Preset do baralho "' + deckName + '" salvo ✓'); }
    else {
      patch.newPerDay = Math.max(0, parseInt(v.newPerDay, 10) || 0);
      patch.revPerDay = Math.max(0, parseInt(v.revPerDay, 10) || 0);
      patch.newPerDayMinimum = Math.max(0, Math.min(99, parseInt(v.newPerDayMinimum, 10) || 0));   // gravado no escopo global
      CardsConfig.set(patch); showToast('Configuração global salva ✓');
    }
    CardEngine.invalidateDueCache();
    // ações avançadas FSRS (otimizar/retenção) — para o escopo escolhido
    if ((v.algo || 'fsrs') !== 'sm2') { CardsScreen._fsrsScope = deckId; setTimeout(() => CardsScreen.openFsrsTools(), 250); }
    if (CardsScreen.tab === 'revisar' || CardsScreen.tab === 'stats') CardsScreen.renderContent();
  });
  // botão extra "restaurar herança" quando o baralho tem preset
  if (isDeck && hasPreset) setTimeout(() => {
    const foot = document.querySelector('#ui-modal .cards-modal-foot');
    if (!foot || document.getElementById('deck-inherit-btn')) return;
    const b = document.createElement('button'); b.id = 'deck-inherit-btn'; b.type = 'button'; b.className = 'btn-secondary'; b.style.marginRight = 'auto'; b.textContent = '↩ Voltar a herdar o global';
    b.addEventListener('click', () => { UI._submit(false); CardsConfig.clearDeckPreset(deckId); showToast('Baralho "' + deckName + '" voltou a herdar o global ✓'); });
    foot.insertBefore(b, foot.firstChild);
  }, 60);
};