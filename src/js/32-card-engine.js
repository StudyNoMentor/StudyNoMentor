const CardEngine = {
  TIPOS: ['Aplicação', 'Associação', 'Certo/Errado', 'Complete a lacuna', 'Conceito', 'Definição', 'Diferenciação', 'Múltipla escolha', 'Verdadeiro ou Falso'],
  addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  // Parâmetros do algoritmo Clássico (SM-2)
  /* review.rs: MINIMUM_EASE_FACTOR e os três deltas de facilidade.
     Não existe TETO de ease no Anki — o antigo MAX_EASE 3.2 era invenção do app
     e impedia que um card sempre respondido "Fácil" continuasse crescendo.
     Os multiplicadores e o intervalo máximo saíram daqui: agora vêm da
     configuração do baralho, como no Anki. */
  MIN_EASE: 1.3,
  EASE_AGAIN_DELTA: -0.20,
  EASE_HARD_DELTA: -0.15,
  EASE_EASY_DELTA: 0.15,
  GRADE_NUM: { errei: 1, dificil: 2, bom: 3, facil: 4, naosei: 1, sei: 3 },
  /* Retrievability atual de um card: a probabilidade estimada de você acertá-lo
     AGORA. É a mesma R do FSRS, calculada com os dias decorridos desde a última
     revisão. Card sem memória (novo) devolve 1 para ficar no fim de qualquer
     ordenação crescente — novo não corre risco de ser esquecido. */
  retrievabilityDe(c, hoje, w) {
    try {
      if (!c || typeof c.s !== 'number' || !(c.s > 0)) return 1;
      /* Cards antigos podem não ter `lastReview` gravado (versões anteriores do
         app não o salvavam). Cair para "hoje" seria o pior default possível:
         daria t=0, R=100%, e o card iria para o FIM da fila — exatamente ao
         contrário do certo, já que um card sem registro é justamente o mais
         provável de estar esquecido. Reconstruímos a data a partir de
         due − intervalo, que é a identidade do agendamento. */
      let ultima = c.lastReview;
      if (!ultima && c.due && (c.intervalo > 0)) ultima = this.addDays(c.due, -c.intervalo);
      if (!ultima) ultima = c.due || hoje;
      const t = Math.max(0, this._daysBetween(ultima, hoje));
      return FSRS.R(t, c.s, w || CardsConfig.weights());
    } catch (e) { _quiet(e, 'retrievabilidade'); return 1; }
  },

  _daysBetween(a, b) { return Math.max(0, Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)); },
  // Conta quantos cards de revisão já vencem daqui a N dias (para o Load Balancing)
  _dueCache: null,
  invalidateDueCache() { this._dueCache = null; },
  _dueCountInDays(n) {
    try {
      if (!this._dueCache || this._dueCache.day !== todayCards()) {
        const map = {};
        DB.getCards().forEach(c => {
          if (c.suspenso) return;
          if (c.dueTs) return;
          if (!(c.phase === 'review' || ((c.reps || 0) > 0 && (c.intervalo || 0) > 0))) return;
          const k = c.due || ''; map[k] = (map[k] || 0) + 1;
        });
        this._dueCache = { day: todayCards(), map };
      }
      return this._dueCache.map[this.addDays(todayCards(), n)] || 0;
    } catch (_) { return 0; }
  },
  // Migração/normalização: garante que todo card tenha estado FSRS quando o algoritmo é FSRS.
  _ensureFsrsState(card) {
    const c = Object.assign({}, card);
    if (!c.phase) {
      if ((c.reps || 0) > 0 && (c.intervalo || 0) > 0) {
        /* Card antigo do SM-2 → estado de memória do FSRS.
           Antes: S = intervalo e D por regra de três sobre a facilidade — uma
           aproximação inventada. Agora é a conversão OFICIAL do fsrs-rs
           (memory_state_from_sm2), que inverte a curva de esquecimento:
             S = iv * fator / (retencao^(1/decay) - 1)
             D = 11 - (ease - 1) / (e^w8 * S^-w9 * (e^(w10*(1-retencao)) - 1))
           A retenção histórica presumida é configurável (historical_retention,
           padrão 0,9) — é o que o Anki pergunta ao migrar de SM-2 para FSRS. */
        c.phase = 'review';
        const conv = FSRS.memoryStateFromSM2(c.ease || 2.5, c.intervalo,
          (CardsConfig.get().historicalRetention) || 0.9);
        c.s = conv.s; c.d = conv.d;
      } else { c.phase = 'new'; c.s = null; c.d = null; }
      c.learnStep = c.learnStep || 0;
    }
    return c;
  },
  // ---- Agendador FSRS (com passos de aprendizado/reaprendizado em minutos, como o Anki) ----
  _scheduleFSRS(card, G) {
    const cfg = CardsConfig.forDeck(card.deckId), w = CardsConfig.weightsFor(card.deckId), r = cfg.retention || 0.9;
    const learn = cfg.learnSteps, relearn = cfg.relearnSteps;
    const maxIv = Math.max(1, cfg.maxInterval || 36500);
    const c = this._ensureFsrsState(card);
    const nowTs = Date.now(), tdy = todayCards();
    let patch = { reps: (c.reps || 0) + 1, lastReview: tdy, algo: 'fsrs' };
    /* ── PASSO INTRADIARIO (rslib/scheduler/answering/learning.rs + states/interval_kind.rs) ──
       Duas regras do Anki que faltavam:

       1) FUZZ NO PASSO. "Adiciona ate 25% aos segundos, no maximo 5 minutos"
          (learning_ivl_with_fuzz). Sem isso, 20 cards respondidos em sequencia
          voltavam todos exatamente juntos, no mesmo segundo.

       2) PASSO QUE ATRAVESSA A VIRADA VIRA DIA (maybe_as_days). Se o passo passa
          da proxima virada (4h), o Anki para de agenda-lo por horario e passa a
          agenda-lo por DIA: ((secs - ate_virada) / 86400) + 1. Importa para quem
          usa passos longos, e para um passo curto respondido de madrugada. */
    const stepDue = (min) => {
      const segs = Math.max(0, Math.round(min * 60));
      // fuzz: [segs, segs + min(25%, 5min))
      const teto = Math.floor(Math.min(segs * 0.25, 300));
      const segsFuzz = teto > 0 ? segs + Math.floor(Math.random() * teto) : segs;
      const ateVirada = Math.max(0, Math.round((proximaViradaTs() - nowTs) / 1000));
      if (segsFuzz >= ateVirada) {
        const dias = Math.floor((segsFuzz - ateVirada) / 86400) + 1;
        return { dueTs: null, due: this.addDays(tdy, dias) };
      }
      return { dueTs: nowTs + segsFuzz * 1000, due: tdy };
    };
    // Dia de vencimento: fuzz determinístico do Anki; com Load Balancing, o dia de MENOR
    // carga dentro da mesma janela. Determinístico = a prévia do botão bate com o agendado.
    const sementeFuzz = (c.id || 'c') + '|' + (c.reps || 0);
    const place = (ivRaw, minIv) => {
      const iv = Math.max(1, Math.min(maxIv, Math.round(ivRaw)));
      const piso = Math.max(1, Math.min(maxIv, minIv || 1));
      if (cfg.loadBalance) return Math.min(maxIv, FSRS.loadBalance(iv, (d) => this._dueCountInDays(d), maxIv, piso));
      /* O Anki sorteia UM fuzz_factor por card+reps (card.get_fuzz_factor) e usa
         o MESMO para os quatro botoes. Semear por nota/intervalo, como estava,
         dava a cada botao um sorteio proprio — os intervalos podiam se cruzar
         mesmo com os pisos abaixo. Agora a semente e a mesma da resposta inteira. */
      return Math.min(maxIv, FSRS.fuzzed(iv, sementeFuzz, maxIv, piso));
    };
    // Intervalo que estava agendado antes desta resposta (base do piso do Anki).
    const ivPrevio = () => {
      if (c.intervalo > 0) return c.intervalo;
      if (c.lastReview && c.due) return this._daysBetween(c.lastReview, c.due);
      return 0;
    };
    /* ── CURTO PRAZO vs LONGO PRAZO: a regra e o TEMPO, nao a FASE ──────────────
       Antes, todo card em aprendizado usava a formula de curto prazo, qualquer que
       fosse o tempo decorrido. Mas a implementacao de referencia decide por
       "days_since_last_review < 1":

           if stability is None      -> valores iniciais
           elif dias_decorridos < 1  -> _short_term_stability
           else                      -> _next_forget/_next_recall (longo prazo)

       O caso real: voce comeca cards novos hoje, nao termina os passos, e volta
       amanha. Aqueles cards ficaram em "aprendizado" mas passou um DIA inteiro —
       ha esquecimento de verdade a considerar. Tratar isso como revisao de mesmo
       dia subestimava a estabilidade e encurtava demais os intervalos.
       Isto valia 6.267 divergencias de S em 10.550 respostas no teste diferencial. */
    const diasDesdeUltima = c.lastReview ? this._daysBetween(c.lastReview, tdy) : null;
    const shortTerm = (g) => {
      if (c.s == null) return { s: FSRS.initS(g, w), d: FSRS.initD(g, w) };
      const D2 = FSRS.nextD(c.d, g, w);
      if (diasDesdeUltima != null && diasDesdeUltima >= 1) {
        // Passou pelo menos um dia: vale a curva de esquecimento, como numa revisao.
        const R2 = FSRS.R(diasDesdeUltima, c.s, w);
        const S2 = (g === 1)
          ? FSRS.nextS_forget(c.d, c.s, R2, w)
          : FSRS.nextS_recall(c.d, c.s, R2, g, w);
        return { s: S2, d: D2 };
      }
      return { s: FSRS.nextS_short(c.s, g, w), d: D2 };
    };
    /* ── ATRASO DO "DIFICIL" (rslib/scheduler/states/steps.rs) ──────────────────
       Regra do Anki, com os tres casos que os testes dele fixam:
         [1,10] no passo 0  -> (1+10)/2 = 5,5 min
         [1,10] no passo 1  -> 10 min (o proprio passo)
         [10] passo unico   -> min(10*1,5 ; 10+1dia) = 15 min   <-- FALTAVA
       O caso do passo UNICO estava errado: o app devolvia o proprio passo (10),
       nao 15. Isso importa justamente em quem usa um so passo de aprendizado.
       maybe_round_in_days: acima de 1 dia, arredonda para dias inteiros. */
    const atrasoDificil = (passos, idx) => {
      const arredDias = (min) => (min > 1440 ? Math.round(min / 1440) * 1440 : min);
      if (idx !== 0) return passos[idx];
      if (passos.length > 1) return arredDias((passos[0] + passos[1]) / 2);
      return arredDias(Math.min(passos[0] * 1.5, passos[0] + 1440));
    };
    const graduate = (g, st) => {
      /* Ao graduar, o Anki usa min_and_max_review_intervals(1) — piso 1, sem a
         regra de crescimento (não havia intervalo anterior de revisão).

         EXCEÇÃO do "Fácil" (learning.rs::answer_easy e relearning.rs::answer_easy):
         o piso não é 1, é o intervalo do "Bom" JÁ SORTEADO + 1. Sem isso, um
         card graduado com "Fácil" podia receber intervalo IGUAL OU MENOR que o
         do "Bom" — os botões apareciam fora de ordem e o algoritmo premiava
         menos quem achou o card fácil. */
      const S = st.s, D = st.d;
      let piso = 1;
      if (g === 4) {
        const stBom = shortTerm(3);
        piso = place(FSRS.interval(stBom.s, r, w), 1) + 1;
      }
      const iv = place(FSRS.interval(S, r, w), piso);
      return Object.assign(patch, { phase: 'review', learnStep: 0, s: S, d: D, due: this.addDays(tdy, iv), dueTs: null, status: 'sei', intervalo: iv, _kind: 'day', _val: iv });
    };
    if (c.phase === 'new' || c.phase === 'learning') {
      const st = shortTerm(G);
      const cur = (c.phase === 'new' ? 0 : (c.learnStep || 0));
      if (G === 1) { Object.assign(patch, { phase: 'learning', learnStep: 0, s: st.s, d: st.d, status: 'naosei' }, stepDue(learn[0])); patch._kind = 'min'; patch._val = learn[0]; }
      else if (G === 4) { graduate(4, st); }
      else if (G === 3) {
        const next = cur + 1;
        if (next >= learn.length) graduate(3, st);
        else { Object.assign(patch, { phase: 'learning', learnStep: next, s: st.s, d: st.d, status: 'naosei' }, stepDue(learn[next])); patch._kind = 'min'; patch._val = learn[next]; }
      } else {
        // Difícil (Anki): no 1º passo = média entre o passo atual e o próximo; depois, repete o passo.
        const delay = atrasoDificil(learn, cur);
        Object.assign(patch, { phase: 'learning', learnStep: cur, s: st.s, d: st.d, status: 'naosei' }, stepDue(delay));
        patch._kind = 'min'; patch._val = delay;
      }
    } else if (c.phase === 'review') {
      /* Mesma regra do bloco de aprendizado: quem decide curto/longo prazo e o
         TEMPO, nao a nota. Antes o "mesmo dia" so valia para G > 1 — errar no
         mesmo dia caia na formula de esquecimento de longo prazo, o que nao e o
         que a referencia faz. Ela usa _short_term_stability sempre que
         days_since_last_review < 1, inclusive no Again. */
      const elapsed = this._daysBetween(c.lastReview || tdy, tdy);
      const mesmoDia = elapsed < 1;
      const D2 = FSRS.nextD(c.d, G, w);
      // A estabilidade resultante de UMA nota qualquer — precisamos das três
      // (Difícil/Bom/Fácil) para impor a ordem entre elas, mesmo gravando uma só.
      const sDaNota = (g) => {
        if (mesmoDia) return FSRS.nextS_short(c.s || 1, g, w);
        const R = FSRS.R(elapsed, c.s || 1, w);
        return (g === 1) ? FSRS.nextS_forget(c.d, c.s, R, w) : FSRS.nextS_recall(c.d, c.s, R, g, w);
      };
      const S2 = sDaNota(G);
      if (G === 1) {
        Object.assign(patch, { phase: 'relearning', learnStep: 0, s: S2, d: D2,
          lapses: (c.lapses || 0) + 1, status: 'naosei' }, stepDue(relearn[0]));
        patch._kind = 'min'; patch._val = relearn[0];
      } else {
        /* ── ORDEM GARANTIDA: Difícil < Bom < Fácil ───────────────────────────
           rslib/scheduler/states/review.rs::passing_fsrs_review_intervals calcula
           os TRÊS intervalos juntos porque o piso de cada um é o anterior + 1:

             hard = fuzz(hard.interval, piso = max(1, minFuzz(...)))
             good = fuzz(good.interval, piso = max(hard + 1, minFuzz(...)))
             easy = fuzz(easy.interval, piso = max(good + 1, minFuzz(...)))

           O app calculava só o intervalo da nota respondida, com piso 1. Como o
           fuzz sorteia dentro de uma faixa, "Fácil" podia sair IGUAL ou MENOR que
           "Bom" — os quatro botões apareciam fora de ordem e a resposta gravada
           contradizia o algoritmo. Aqui os três são calculados juntos e só o da
           nota respondida é gravado, exatamente como o Anki faz. */
        const prevIv = ivPrevio();
        const ivDaNota = (g, pisoMin) => {
          const raw = FSRS.interval(sDaNota(g), r, w);
          const piso = Math.max(pisoMin, FSRS.minReviewFuzzInterval(raw, prevIv, maxIv));
          return place(raw, piso);
        };
        const ivHard = ivDaNota(2, 1);
        const ivGood = (G === 2) ? 0 : ivDaNota(3, ivHard + 1);
        const iv = (G === 2) ? ivHard : (G === 3 ? ivGood : ivDaNota(4, ivGood + 1));
        Object.assign(patch, { phase: 'review', s: S2, d: D2, due: this.addDays(tdy, iv),
          dueTs: null, status: 'sei', intervalo: iv });
        patch._kind = 'day'; patch._val = iv;
      }
    } else if (c.phase === 'relearning') {
      const st = shortTerm(G);
      const cur = c.learnStep || 0;
      if (G === 1) { Object.assign(patch, { learnStep: 0, s: st.s, d: st.d, status: 'naosei' }, stepDue(relearn[0])); patch._kind = 'min'; patch._val = relearn[0]; }
      else if (G === 4) { graduate(4, st); }
      else if (G === 3) { const next = cur + 1; if (next >= relearn.length) graduate(3, st); else { Object.assign(patch, { learnStep: next, s: st.s, d: st.d, status: 'naosei' }, stepDue(relearn[next])); patch._kind = 'min'; patch._val = relearn[next]; } }
      else {
        const delay = atrasoDificil(relearn, cur);
        Object.assign(patch, { learnStep: cur, s: st.s, d: st.d, status: 'naosei' }, stepDue(delay));
        patch._kind = 'min'; patch._val = delay;
      }
    }
    return patch;
  },
  // ---- Agendador Clássico (SM-2) ----
  /* ── SM-2 (rslib/src/scheduler/states/review.rs) ───────────────────────────
     Quatro divergências reais em relação ao Anki foram corrigidas aqui:

     1) COMPENSAÇÃO DE ATRASO. O Anki soma o atraso ao intervalo base antes de
        multiplicar: good usa (iv + atraso/2) e easy usa (iv + atraso). Se você
        lembrou de um card 20 dias depois do previsto, essa memória vale mais que
        a de quem revisou no dia — e o intervalo tem de refletir isso. O app
        ignorava o atraso por completo.

     2) ORDEM GARANTIDA hard < good < easy. O Anki impõe pisos: good ≥ hard+1 e
        easy ≥ good+1. Sem eles, com ease baixo (1,3) e hard_multiplier 1,2, os
        botões podiam devolver o MESMO intervalo — ou pior, "Difícil" render mais
        que "Bom".

     3) TETO DE FACILIDADE. O app limitava ease a 3,2. O Anki tem apenas o piso
        (1,3) — quem acerta "Fácil" sempre num card deve poder passar disso.

     4) INTERVALO MÁXIMO. Estava cravado em 5 anos, ignorando o maxInterval que o
        usuário já configurava (e que o modo FSRS respeitava).

     Também passou a usar os multiplicadores configuráveis em vez de constantes. */
  _scheduleSM2(card, grade) {
    const cfg = CardsConfig.forDeck(card.deckId) || CardsConfig.get();
    const easeIni = cfg.initialEase != null ? cfg.initialEase : 2.5;
    const fHard = cfg.hardMultiplier != null ? cfg.hardMultiplier : 1.2;
    const fEasy = cfg.easyMultiplier != null ? cfg.easyMultiplier : 1.3;
    const fLapse = cfg.lapseMultiplier != null ? cfg.lapseMultiplier : 0.0;
    const fGlobal = cfg.intervalMultiplier != null ? cfg.intervalMultiplier : 1.0;
    const minLapse = Math.max(1, cfg.minimumLapseInterval != null ? cfg.minimumLapseInterval : 1);
    const gradGood = Math.max(1, cfg.graduatingIntervalGood != null ? cfg.graduatingIntervalGood : 1);
    const gradEasy = Math.max(1, cfg.graduatingIntervalEasy != null ? cfg.graduatingIntervalEasy : 4);
    const maxIv = Math.max(1, cfg.maxInterval || 36500);

    let ease = card.ease || easeIni, intervalo = card.intervalo || 0;
    let reps = card.reps || 0, lapses = card.lapses || 0;
    const isNew = reps === 0 || intervalo <= 0;
    let status;
    // Anki tem apenas MINIMUM_EASE_FACTOR; não existe teto.
    const clampE = (e) => Math.max(this.MIN_EASE, e);
    // constrain_passing_interval: aplica o multiplicador global e os limites.
    const constr = (dias, minimo) => {
      const v = dias * fGlobal;
      const min = Math.min(Math.max(1, minimo || 1), maxIv);
      return Math.max(min, Math.min(maxIv, Math.round(v)));
    };
    // days_late: quantos dias além do previsto você levou para revisar.
    const atraso = Math.max(0, this._daysBetween(card.due || todayCards(), todayCards()));

    if (grade === 'errei') {
      lapses += 1; reps = 0;
      ease = clampE(ease + this.EASE_AGAIN_DELTA);
      // failing_review_interval: iv * lapse_multiplier, com piso próprio
      intervalo = Math.max(minLapse, Math.min(maxIv, Math.round(Math.max(1, intervalo) * fLapse)));
      status = 'naosei';
    } else if (isNew) {
      reps += 1; status = 'sei';
      if (grade === 'facil') { intervalo = constr(gradEasy, 1); ease = clampE(ease + this.EASE_EASY_DELTA); }
      else if (grade === 'dificil') { intervalo = constr(gradGood, 1); ease = clampE(ease + this.EASE_HARD_DELTA); }
      else { intervalo = constr(gradGood, 1); }   // "Bom" não altera a facilidade
    } else {
      reps += 1; status = 'sei';
      const base = Math.max(1, intervalo);
      // Os três intervalos são calculados JUNTOS porque cada piso depende do anterior.
      const minHard = fHard <= 1.0 ? 0 : base + 1;
      const ivHard = constr(base * fHard, minHard);
      const minGood = fHard <= 1.0 ? base + 1 : ivHard + 1;
      const ivGood = constr((base + atraso / 2) * ease, minGood);
      const ivEasy = constr((base + atraso) * ease * fEasy, ivGood + 1);
      if (grade === 'dificil') { intervalo = ivHard; ease = clampE(ease + this.EASE_HARD_DELTA); }
      else if (grade === 'facil') { intervalo = ivEasy; ease = clampE(ease + this.EASE_EASY_DELTA); }
      else { intervalo = ivGood; }                 // "Bom" não altera a facilidade
    }
    intervalo = Math.max(1, Math.min(maxIv, Math.round(intervalo)));
    return { status, grade, ease, intervalo, reps, lapses, due: this.addDays(todayCards(), intervalo), dueTs: null, lastReview: todayCards(), algo: 'sm2', _kind: 'day', _val: intervalo };
  },
  // Ponto único de entrada. grade: 'errei'|'dificil'|'bom'|'facil' (ou 'sei'/'naosei')
  schedule(card, grade) {
    if (grade === 'sei') grade = 'bom';
    if (grade === 'naosei') grade = 'errei';
    const cfg = CardsConfig.forDeck(card.deckId);
    const patch = (cfg.algo === 'fsrs')
      ? this._scheduleFSRS(card, this.GRADE_NUM[grade] || 3)
      : this._scheduleSM2(card, grade);
    // LEECH (Anki, rslib/scheduler/states/review.rs::leech_threshold_met): ao
    // atingir o limite de lapsos — e a cada metade dele depois — o card é
    // marcado como problemático. O passo é ARREDONDADO PARA CIMA (ceil), não
    // para baixo: com limiar padrão 8 não fazia diferença (8/2=4 nos dois
    // casos), mas em qualquer limiar ÍMPAR editado na tela (3, 5, 7, 9, 15...)
    // floor() disparava o aviso em lapsos errados a partir da segunda rodada.
    const lim = cfg.leechThreshold || 0;
    if (lim > 0 && patch.lapses && patch.lapses > (card.lapses || 0) && patch.lapses >= lim) {
      const passo = Math.max(1, Math.ceil(lim / 2));
      if ((patch.lapses - lim) % passo === 0) {
        patch.leech = true;
        patch._leechNow = true;
        if (cfg.leechAction !== 'tag') patch.suspenso = true;
      }
    }
    return patch;
  },
  // Prévia dos 4 botões — cada um retorna { kind:'min'|'day', val }
  // A prévia roda o MESMO agendador (fuzz determinístico + balanceamento), então o número
  // mostrado no botão é exatamente o que será gravado ao clicar.
  previewIntervals(card) {
    const out = {};
    ['errei', 'dificil', 'bom', 'facil'].forEach(g => { const p = this.schedule(card, g); out[g] = { kind: p._kind || 'day', val: (p._val != null ? p._val : p.intervalo) }; });
    return out;
  },
  // Formata a prévia de um botão: aceita número (dias) ou objeto { kind, val }
  fmtInterval(v) {
    if (v && typeof v === 'object') {
      if (v.kind === 'min') { const m = v.val; return m < 60 ? m + ' min' : (Math.round(m / 60 * 10) / 10) + ' h'; }
      return this.fmtInterval(v.val);
    }
    const dias = v;
    if (dias <= 0) return 'hoje';
    if (dias === 1) return '1 dia';
    if (dias < 30) return dias + ' dias';
    // rótulos claros para não confundir "m" (mês) com minuto — estilo Anki (mo/anos)
    if (dias < 365) { const mo = Math.round(dias / 30 * 10) / 10; return mo === 1 ? '1 mês' : mo + ' meses'; }
    const an = Math.round(dias / 365 * 10) / 10; return an === 1 ? '1 ano' : an + ' anos';
  },
  // ---- Cloze / Omissão de palavras: {{texto}} ou {{c1::texto}} ----
  hasCloze(text) { return /\{\{[\s\S]*?\}\}/.test(String(text || '')); },
  // reveal=false => mostra [ ... ] no lugar; reveal=true => revela destacado
  clozeRender(html, reveal) {
    return String(html || '').replace(/\{\{(?:c\d+::)?([\s\S]*?)\}\}/g, (m, inner) =>
      reveal ? `<span class="cloze-reveal">${inner}</span>` : `<span class="cloze-blank">[&nbsp;…&nbsp;]</span>`);
  },
  // Card ENTERRADO não entra na fila até a data marcada (bury do Anki)
  estaEnterrado(card) { return !!(card && card.enterradoAte && card.enterradoAte > todayCards()); },
  isDue(card) {
    if (this.estaEnterrado(card)) return false;
    if (card.dueTs) return Date.now() >= card.dueTs;   // passo em minutos (aprendizado/reaprendizado)
    return (card.due || todayCards()) <= todayCards(); // agendamento por dia
  },
  // Aplica os filtros a uma lista de cards. f = { busca, materias:Set, topico, tipo, status, favorito, deckId }
  applyFilters(cards, f) {
    f = f || {};
    const busca = (f.busca || '').trim().toLowerCase();
    return cards.filter(c => {
      if (f.materias && f.materias.size && !(c.materia && f.materias.has(c.materia)) && !(c.deckId && f.materias.has('deck:' + c.deckId))) return false;
      if (f.topico && (c.topico || '') !== f.topico) return false;
      if (f.tipo && (c.tipo || '') !== f.tipo) return false;
      if (f.status && f.status !== 'todos' && (c.status || 'pendente') !== f.status) return false;
      if (f.favorito && !c.favorito) return false;
      if (busca) {
        const hay = ((c.frente || '') + ' ' + (c.verso || '') + ' ' + (c.topico || '') + ' ' + (c.materia || '')).toLowerCase().replace(/<[^>]+>/g, ' ');
        if (!hay.includes(busca)) return false;
      }
      return true;
    });
  },
  stats(cards) {
    const s = { total: cards.length, pendente: 0, sei: 0, naosei: 0, due: 0, favoritos: 0, suspensos: 0 };
    cards.forEach(c => {
      s[c.status || 'pendente'] = (s[c.status || 'pendente'] || 0) + 1;
      if (c.suspenso) { s.suspensos++; return; } // suspenso não entra na contagem de vencidos
      if (this.isDue(c)) s.due++;
      if (c.favorito) s.favoritos++;
    });
    return s;
  },
  // texto puro (sem HTML) para exportação/preview
  plain(html) {
    return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  }
};
