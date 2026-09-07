/* ============================================================
   CARD ENGINE — repetição espaçada (SM-2 simplificado) + filtros
   ============================================================ */
/* ============================================================
   FSRS-6 — Free Spaced Repetition Scheduler (o algoritmo padrão do Anki 25.07+).
   Mesma versão que roda hoje no Anki desktop, AnkiWeb e AnkiDroid.
   Modela a memória por card com Dificuldade (D) e Estabilidade (S) e agenda
   cada card no dia em que sua chance de lembrar cai para a RETENÇÃO-ALVO.
   ============================================================ */
const FSRS = {
  VERSAO: 6,
  N_W: 21,                       // FSRS-6 usa 21 parâmetros (o FSRS-5 usava 19)
  // Pesos padrão oficiais do FSRS-6 (open-spaced-repetition), treinados sobre
  // centenas de milhões de revisões reais.
  DEFAULT_W: [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001,
    1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729,
    0.5425, 0.0912, 0.0658, 0.1542],
  // Pesos padrão do FSRS-5, mantidos só para migrar quem tinha pesos antigos.
  W5_DEFAULT: [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
    1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621],

  /* ── CURVA DE ESQUECIMENTO PERSONALIZÁVEL (a grande novidade do FSRS-6) ────
     No FSRS-5 o decaimento era FIXO em -0,5 para todo mundo: assumia-se que
     todas as pessoas esquecem no mesmo formato de curva, variando só a
     velocidade. No FSRS-6 o formato virou o parâmetro treinável w20, então a
     curva se molda ao SEU padrão de esquecimento.
       decay  = -w20
       factor = 0.9^(-1/w20) - 1   (garante R = 90% quando t = S)
     Com w20 = 0.5 a conta cai exatamente no comportamento do FSRS-5 — é isso
     que torna a migração de pesos antigos indolor. */
  DECAY_PADRAO: 0.5,
  _w20(w) {
    const v = (w && w.length > 20) ? w[20] : this.DECAY_PADRAO;
    // Sem "apertar" a faixa aqui: a referência usa w20 como veio. Quem limita é o
    // otimizador (LO/HI). Aqui só nos protegemos de valor ausente/inválido, que
    // faria a curva virar NaN.
    return (isFinite(v) && v > 0) ? v : this.DECAY_PADRAO;
  },
  decayOf(w) { return -this._w20(w); },
  factorOf(w) { return Math.pow(0.9, -1 / this._w20(w)) - 1; },
  // Compatibilidade: código antigo que lia FSRS.DECAY / FSRS.FACTOR continua funcionando
  get DECAY() { return -this.DECAY_PADRAO; },
  get FACTOR() { return Math.pow(0.9, 1 / this.DECAY) - 1; }, // ≈ 0.234568
  clampD(d) { return Math.min(10, Math.max(1, d)); },
  // Limites idênticos aos do Anki (fsrs-rs: S_MIN 0.001, S_MAX 36500, D 1..10).
  // O TETO de 36500 dias faltava aqui: sem ele, uma sequência longa de "Fácil"
  // podia empurrar a estabilidade para valores absurdos e, no limite, para
  // Infinity — que contaminaria todo cálculo seguinte com NaN.
  S_MIN: 0.001,
  S_MAX: 36500,
  clampS(s) { return Math.min(this.S_MAX, Math.max(this.S_MIN, isFinite(s) ? s : this.S_MIN)); },
  /* ── SANEAMENTO DAS ENTRADAS ──────────────────────────────────────────────
     O fsrs-rs limita S e D logo na entrada de cada passo (step()), e por um bom
     motivo: se um card chega com S=NaN — por importação estragada, sincronização
     interrompida ou divisão por zero antiga — todo cálculo seguinte vira NaN e o
     card fica INAGENDÁVEL PARA SEMPRE, sem erro visível. Aqui a entrada ruim é
     absorvida e o card volta a um estado válido em vez de morrer em silêncio. */
  _S(s) { return this.clampS(s); },
  _D(d) { return this.clampD(isFinite(d) ? d : 5); },
  _t(t) { return (isFinite(t) && t > 0) ? t : 0; },
  _r(r) { return (isFinite(r) && r > 0 && r < 1) ? r : 0.9; },
  // R e interval agora recebem os pesos para usar a curva personalizada.
  // Sem w, caem no decaimento padrão — nenhum chamador antigo quebra.
  R(t, S, w) {
    const dec = this.decayOf(w), fac = this.factorOf(w);
    const v = Math.pow(1 + fac * this._t(t) / this._S(S), dec);
    return isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  },
  interval(S, r, w) {
    const dec = this.decayOf(w), fac = this.factorOf(w);
    const v = Math.round((this._S(S) / fac) * (Math.pow(this._r(r), 1 / dec) - 1));
    return isFinite(v) ? Math.min(this.S_MAX, Math.max(1, v)) : 1;
  },
  // Converte pesos do FSRS-5 (19) para FSRS-6 (21). w19=0 anula o termo S^(-w19)
  // e w20=0.5 reproduz o decaimento fixo antigo: o agendamento sai IDÊNTICO ao
  // que você já tinha, até rodar o otimizador de novo. Migração oficial do projeto.
  migrarW(w) {
    if (!Array.isArray(w)) return null;
    if (w.length === this.N_W) return w.slice();
    if (w.length === 19) return w.concat([0.0, 0.5]);
    return null;
  },
  pesosValidos(w) { return Array.isArray(w) && (w.length === this.N_W || w.length === 19); },
  initS(G, w) { return this.clampS(w[G - 1]); },
  D0(G, w) { return w[4] - Math.exp(w[5] * (G - 1)) + 1; },
  initD(G, w) { return this.clampD(this.D0(G, w)); },
  nextD(D, G, w) { const d0 = this._D(D); const dp = d0 - w[6] * (G - 3) * (10 - d0) / 9; return this.clampD(w[7] * this.D0(4, w) + (1 - w[7]) * dp); },
  nextS_recall(D, S, R, G, w) {
    const S0 = this._S(S), D0 = this._D(D), R0 = isFinite(R) ? Math.min(1, Math.max(0, R)) : 0.9;
    const hard = (G === 2) ? w[15] : 1, easy = (G === 4) ? w[16] : 1;
    return this.clampS(S0 * (1 + Math.exp(w[8]) * (11 - D0) * Math.pow(S0, -w[9]) * (Math.exp(w[10] * (1 - R0)) - 1) * hard * easy));
  },
  /* ── ESTABILIDADE APÓS ESQUECER (post-lapse) ──────────────────────────────
     O teto NÃO é S, é S / e^(w17·w18). Parece detalhe, mas é uma correção que o
     próprio projeto FSRS aplicou ("consider short term params when clipping
     post-lapse stability"): o teto tem de considerar os parâmetros de curto
     prazo, senão errar um card podia deixar a estabilidade alta demais.
     Com os pesos padrão, e^(0.5425·0.0912) ≈ 1.0507 — ou seja, o teto real é
     ~95,2% de S, não 100%. */
  nextS_forget(D, S, R, w) {
    const S0 = this._S(S), D0 = this._D(D), R0 = isFinite(R) ? Math.min(1, Math.max(0, R)) : 0.9;
    const longo = w[11] * Math.pow(D0, -w[12]) * (Math.pow(S0 + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R0));
    const tetoCurto = S0 / Math.exp(w[17] * w[18]);
    return this.clampS(Math.min(longo, tetoCurto));
  },
  /* ── MEMÓRIA DE CURTO PRAZO (revisões no MESMO dia) ───────────────────────
     Usada nos passos de aprendizado/reaprendizado — é o que acontece quando um
     card volta 10min/1h depois na mesma sessão.

     FSRS-5:  S' = S · e^(w17·(G-3+w18))
     FSRS-6:  S' = S · e^(w17·(G-3+w18)) · S^(-w19)

     O termo S^(-w19) faz a estabilidade subir MAIS rápido quando ela é pequena
     e mais devagar quando já é grande — antes, repetir um card maduro no mesmo
     dia inflava S tanto quanto repetir um card novo, o que era irreal.

     A trava SInc >= 1 para G >= 3 é exigida pela especificação: Bom e Fácil
     nunca podem DIMINUIR a estabilidade. Só Errei e Difícil podem. */
  nextS_short(S, G, w) {
    // ATENÇÃO: S entra CRU na fórmula. Limitá-lo antes (eu limitava a 0.01)
    // distorcia cards de estabilidade muito baixa — justo os que estão em
    // aprendizado, que é onde esta fórmula mais atua. A referência só limita
    // o RESULTADO. Isso valeu 413 divergências no teste diferencial.
    const S0 = this._S(S);
    const w17 = w[17], w18 = w[18], w19 = (w.length > 19 && isFinite(w[19])) ? w[19] : 0;
    let sInc = Math.exp(w17 * (G - 3 + w18)) * Math.pow(S0, -w19);
    // Trava: Difícil, Bom e Fácil (G >= 2) não podem REDUZIR a estabilidade.
    // A wiki do projeto diz "G >= 3", mas tanto a implementação de referência
    // (py-fsrs) quanto o Rust que o Anki roda usam G >= 2. Seguimos o código,
    // que é o que define o comportamento real do Anki.
    if (G >= 2) sInc = Math.max(1, sInc);
    return this.clampS(S0 * sInc);
  },

  // ---- FUZZ (dispersão) — mesma fórmula do Anki: delta acumulado por faixa ----
  fuzzDelta(iv) {
    // Guarda do Anki (fuzz_delta): intervalos curtos NAO recebem fuzz.
    // Antes isso vivia dentro de fuzzRange; ao replicar constrained_fuzz_bounds
    // a guarda precisa estar AQUI, que e onde o Anki a coloca.
    if (iv < 2.5) return 0.0;
    let delta = 1.0;
    [[2.5, 7, 0.15], [7, 20, 0.1], [20, Infinity, 0.05]].forEach(([a, b, f]) => {
      delta += f * Math.max(0, Math.min(iv, b) - a);
    });
    return delta;
  },
  // f32::round do Rust arredonda "meio para longe do zero"; aqui iv é sempre >= 0.
  _arred(x) { return Math.floor(x + 0.5); },
  // Réplica de fuzz_bounds (rslib/src/scheduler/states/fuzz.rs)
  fuzzBounds(iv) { const d = this.fuzzDelta(iv); return [this._arred(iv - d), this._arred(iv + d)]; },
  /* Réplica de constrained_fuzz_bounds. Antes o app devolvia [iv, iv] sem arredondar
     para iv < 2.5 e usava piso fixo 2 — o Anki arredonda e respeita o "minimum"
     recebido. Na prática place() já arredondava antes de chamar, então isto não
     mudava agendamento; agora a função é correta mesmo se chamada isolada. */
  constrainedFuzzBounds(iv, minimum, maximum) {
    const max = Math.max(1, maximum || 36500);
    const min = Math.min(Math.max(1, minimum || 1), max);
    const v = Math.min(max, Math.max(min, iv));
    let [lo, hi] = this.fuzzBounds(v);
    lo = Math.min(max, Math.max(min, lo));
    hi = Math.min(max, Math.max(min, hi));
    if (hi === lo && hi > 2 && hi < max) hi = lo + 1;
    return [lo, hi];
  },
  fuzzRange(iv, maxIv, minIv) { return this.constrainedFuzzBounds(iv, minIv || 1, maxIv || 36500); },
  /* Réplica de minimum_review_fuzz_interval — REGRA QUE FALTAVA NO APP.
     No Anki, acertar uma revisão nunca pode resultar num intervalo menor ou igual
     ao anterior: se o novo intervalo cresceu, o piso vira "anterior + 1", e o fuzz
     não pode desfazer esse crescimento. Sem isso, um card de 30 dias respondido
     como "Bom" podia ser reagendado para 28 dias pelo fuzz ou pelo balanceador de
     carga — comportamento que o Anki impede. Devolve 0 quando o intervalo
     realmente encolheu (troca de parâmetros ou de retenção-alvo). */
  minReviewFuzzInterval(iv, previo, maxIv) {
    const arred = this._arred(iv);
    const [, hi] = this.constrainedFuzzBounds(iv, 1, maxIv || 36500);
    const prev = Math.max(0, previo || 0);
    if (arred > prev) return prev + 1;
    if (prev <= hi) return prev;
    return 0;
  },
  // Fuzz DETERMINÍSTICO (semeado pelo card+nota): a prévia do botão bate com o que é agendado.
  _hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; },
  fuzzed(iv, seed, maxIv, minIv) {
    const [lo, hi] = this.fuzzRange(iv, maxIv, minIv);
    if (hi <= lo) return lo;
    return lo + Math.floor(this._hash(String(seed)) * (hi - lo + 1));
  },

  // ---- OTIMIZADOR (personaliza os 21 pesos a partir do seu histórico) ----
  // Reconstrói sequências (elapsed, grade) por card e minimiza o log-loss por gradient descent.
  _buildSequences(revlog) {
    const byCard = {};
    revlog.slice().sort((a, b) => a.ts - b.ts).forEach(r => {
      if (!r.cardId || !r.grade) return;
      (byCard[r.cardId] = byCard[r.cardId] || []).push({ grade: r.grade, elapsed: Math.max(0, r.elapsed || 0) });
    });
    return Object.values(byCard).filter(s => s.length >= 2);
  },
  /* ── PERDA (log-loss) ─────────────────────────────────────────────────────
     BUG CORRIGIDO: a perda evoluía o estado SEMPRE pelas fórmulas de longo prazo
     (nextS_recall/nextS_forget), mesmo quando a revisão era do MESMO DIA. Mas o
     agendador real usa nextS_short quando days_since_last_review < 1. Ou seja: o
     otimizador treinava um modelo DIFERENTE do que roda em produção.
     No histórico real auditado isso atingia 44% das transições de treino.

     Duas consequências:
       1) o estado divergia do real logo na 2ª revisão de cada card;
       2) com elapsed≈0, R≈0,999 → a amostra não contribuía com gradiente nenhum,
          então quase metade dos dados era ruído mudo puxando w para os limites.
     Agora as transições intradiárias evoluem o estado pela fórmula certa e ficam
     FORA da perda (o Anki também não treina a curva de esquecimento com elas). */
  _logLoss(w, seqs) {
    let loss = 0, n = 0; const EPS = 1e-6;
    for (const seq of seqs) {
      let S = this.initS(seq[0].grade, w), D = this.initD(seq[0].grade, w);
      for (let i = 1; i < seq.length; i++) {
        const G = seq[i].grade;
        const dt = seq[i].elapsed;
        if (dt < 1) {
          // mesmo dia: memória de curto prazo, sem entrar na perda
          S = this.nextS_short(S, G, w); D = this.nextD(D, G, w);
          continue;
        }
        const R = this.R(dt, S, w), y = G >= 2 ? 1 : 0;
        const p = Math.min(1 - EPS, Math.max(EPS, R));
        loss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); n++;
        if (G >= 2) { S = this.nextS_recall(D, S, R, G, w); D = this.nextD(D, G, w); }
        else { S = this.nextS_forget(D, S, R, w); D = this.nextD(D, 1, w); }
      }
    }
    return n ? loss / n : Infinity;
  },
  /* Quantas transições REALMENTE treináveis existem (as de longo prazo). É esse
     número que o Anki usa para decidir quanto do modelo dá para personalizar. */
  contarTreinaveis(seqs) {
    let n = 0;
    for (const seq of seqs) for (let i = 1; i < seq.length; i++) if (seq[i].elapsed >= 1) n++;
    return n;
  },
  /* ── DESBLOQUEIO PROGRESSIVO DE PARÂMETROS (comportamento do Anki) ─────────
     O Anki 24.06+ não exige mais um mínimo de revisões, mas NÃO treina os 21
     parâmetros com pouco dado: ele decide quais otimizar conforme o volume.
     Sem isso, o otimizador daqui empurrava w0 e w20 para os LIMITES já com ~86
     transições — sinal clássico de sobreajuste, e um w20 no piso distorce a
     curva de esquecimento de TODA a coleção.
     Faixas conservadoras: quanto menos dado, menos graus de liberdade. */
  parametrosTreinaveis(n) {
    if (n < 32) return [];                                   // nada confiável: fica no padrão
    if (n < 128) return [4, 5, 6, 8, 10];                    // só dificuldade + ganho de estabilidade
    if (n < 400) return [0, 1, 2, 3, 4, 5, 6, 8, 9, 10];     // + estabilidades iniciais
    if (n < 1000) return [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
    return null;                                              // null = todos os 21
  },
  optimize(revlog, opts) {
    opts = opts || {};
    /* ignore_revlogs_before_date: descarta revisões anteriores a uma data. Serve
       para quando o histórico antigo não representa mais você — mudou de método,
       importou um baralho de terceiros, ou passou meses sem estudar e as
       respostas daquele período distorcem o ajuste. */
    if (opts.ignorarAntesDe) {
      const corte = String(opts.ignorarAntesDe);
      revlog = (revlog || []).filter(r => String(r.date || '') >= corte);
    }
    const seqs = this._buildSequences(revlog);
    const reviews = seqs.reduce((a, s) => a + (s.length - 1), 0);
    // Só as transições de LONGO PRAZO treinam a curva; as intradiárias não.
    const treinaveis = this.contarTreinaveis(seqs);
    // Se vier peso antigo de 19 posições, migra antes de otimizar
    const w0 = (this.migrarW(opts.startW) || this.DEFAULT_W).slice();
    const livres = this.parametrosTreinaveis(treinaveis);
    if (livres && livres.length === 0) {
      return { w: w0, lossBefore: null, lossAfter: null, improved: false,
               reviews, treinaveis, livres: 0, reason: 'few' };
    }
    // Limites OFICIAIS do FSRS-6 (LOWER/UPPER_BOUNDS_PARAMETERS da implementação
    // de referência). Antes eu usava faixas próprias, aproximadas, que divergiam
    // em 6 posições — o otimizador podia produzir pesos que o Anki recusaria.
    const LO = [0.001, 0.001, 0.001, 0.001, 1.0, 0.001, 0.001, 0.001, 0.0, 0.0, 0.001,
                0.001, 0.001, 0.001, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.1];
    const HI = [100, 100, 100, 100, 10.0, 4.0, 4.0, 0.75, 4.5, 0.8, 3.5,
                5.0, 0.25, 0.9, 4.0, 1.0, 6.0, 2.0, 2.0, 0.8, 0.8];
    /* ── DOIS LIMITES DO ANKI QUE SÃO DINÂMICOS, NÃO FIXOS ─────────────────────
       Conferido contra parameter_clipper.rs do fsrs-rs: o teto de w17/w18 e o
       piso de w19 dependem da configuração. Usar valores fixos deixava o
       otimizador produzir pesos que o Anki recusaria.

       · w17/w18 — o teto garante que a estabilidade pós-lapso, depois de
         percorrer TODOS os passos de reaprendizado, não ultrapasse a
         estabilidade anterior:
             teto = sqrt( -[ln(w11) + ln(2^w13 - 1) + w14*0,3] / n_passos )
         preso em [0,01 ; 2,0]. Com 0 ou 1 passo continua 2,0 — só aperta com 2+.
       · w19 — piso 0,01 quando o modelo de curto prazo está ativo. O app SEMPRE
         usa nextS_short, então o piso é sempre 0,01 aqui. */
    try {
      const nRe = ((CardsConfig.get() || {}).relearnSteps || []).length;
      if (nRe > 1) {
        const b = this.migrarW(opts.startW) || this.DEFAULT_W;
        /* A ordem das operacoes e a da referencia: `.max(0.01).sqrt().min(2.0)`.
           Aplicar o piso 0,01 DEPOIS da raiz (como estava) dava 0,01 onde o Anki
           da 0,1 — divergencia real sempre que o radicando fica abaixo de 0,01
           (inclusive negativo, alcancavel com w11/w13/w14 altos no otimizador). */
        const teto = Math.min(2.0, Math.sqrt(Math.max(0.01,
          -(Math.log(b[11]) + Math.log(Math.pow(2, b[13]) - 1) + b[14] * 0.3) / nRe)));
        HI[17] = teto; HI[18] = teto;
      }
    } catch (e) { _quiet(e, 'teto-w17-w18'); }
    LO[19] = 0.01;
    const N = this.N_W;
    const clampW = (w) => {
      const out = w.slice(0, N);
      while (out.length < N) out.push(this.DEFAULT_W[out.length]);
      return out.map((v, i) => Math.min(HI[i], Math.max(LO[i], isFinite(v) ? v : this.DEFAULT_W[i])));
    };
    let w = clampW(w0);
    const lossBefore = this._logLoss(w0, seqs);
    let cur = this._logLoss(w, seqs);
    const lr = opts.lr || 0.03, iters = opts.iters || 50, h = 1e-4;
    // Índices que podem se mover nesta rodada (o resto fica no valor de partida).
    const mexe = livres ? new Set(livres) : null;
    for (let it = 0; it < iters; it++) {
      const grad = new Array(N).fill(0);
      for (let k = 0; k < N; k++) {
        if (mexe && !mexe.has(k)) continue;              // congelado: gradiente 0
        const wp = w.slice(); wp[k] += h; const wm = w.slice(); wm[k] -= h;
        grad[k] = (this._logLoss(wp, seqs) - this._logLoss(wm, seqs)) / (2 * h);
      }
      const gnorm = Math.sqrt(grad.reduce((a, g) => a + g * g, 0)) || 1;
      const next = clampW(w.map((v, k) => v - lr * grad[k] / gnorm));
      const nl = this._logLoss(next, seqs);
      if (nl < cur - 1e-6) { w = next; cur = nl; } else break;
    }
    const improved = cur < lossBefore - 1e-4;
    const wFinal = improved ? w : w0;
    /* Diagnóstico honesto: quais parâmetros encostaram no limite. Encostar é o
       sintoma clássico de sobreajuste — vale avisar em vez de fingir precisão. */
    const noLimite = [];
    wFinal.forEach((v, i) => {
      if (Math.abs(v - LO[i]) < 1e-3 || Math.abs(v - HI[i]) < 1e-3) noLimite.push(i);
    });
    return { w: wFinal, lossBefore, lossAfter: cur, improved, reviews,
             treinaveis, livres: livres ? livres.length : N, noLimite,
             confiavel: treinaveis >= 400 && noLimite.length === 0 };
  },
  /* ── RECOMPUTAR MEMÓRIA A PARTIR DO HISTÓRICO ──────────────────────────────
     Equivale ao "Reschedule cards on change" do Anki. Reproduz a sequência de
     revisões de um card com os pesos ATUAIS e devolve o (S, D) que ele teria se
     sempre tivesse sido agendado por eles.

     Por que isso importa aqui: quem usa o app desde antes da migração para o
     FSRS-6 tem cards com estado gravado pelo FSRS-5. Como S e D são carregados
     adiante (o Anki também não os recalcula sozinho), a coleção fica com DUAS
     réguas convivendo — na auditoria real, 23 cards com S inicial do FSRS-5 e 25
     com o do FSRS-6. Efeito prático: o mesmo "Fácil" virava 16 dias na era antiga
     e 8 dias na nova. Isto não é um defeito do agendador; é herança de dados. E é
     exatamente para isso que existe o recálculo.

     Devolve null quando não há histórico suficiente (aí o estado atual é mantido). */
  recomputarMemoria(revlogDoCard, w) {
    const logs = (revlogDoCard || []).slice()
      .filter(r => r && r.grade >= 1 && r.grade <= 4)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (!logs.length) return null;
    w = this.migrarW(w) || this.DEFAULT_W;
    let S = this.initS(logs[0].grade, w), D = this.initD(logs[0].grade, w);
    for (let i = 1; i < logs.length; i++) {
      const G = logs[i].grade;
      const dt = Math.max(0, logs[i].elapsed || 0);
      if (dt < 1) { S = this.nextS_short(S, G, w); D = this.nextD(D, G, w); continue; }
      const R = this.R(dt, S, w);
      S = (G === 1) ? this.nextS_forget(D, S, R, w) : this.nextS_recall(D, S, R, G, w);
      D = this.nextD(D, G === 1 ? 1 : G, w);
    }
    return { s: this.clampS(S), d: this.clampD(D), revisoes: logs.length };
  },

  /* ── EASY DAYS ────────────────────────────────────────────────────────────
     easy_days_percentages do Anki: um multiplicador por dia da semana (índice
     0 = domingo) dizendo QUANTO da carga normal aquele dia aceita. 1 = normal,
     0,5 = metade, 0 = evitar por completo.

     Serve para quem não estuda em algum dia fixo. Não é uma proibição: se o dia
     zerado for o ÚNICO da janela de dispersão, ele ainda é usado — o Anki
     prefere agendar num dia ruim a violar o intervalo do algoritmo. O peso só
     empurra a escolha para outro dia quando existe alternativa. */
  /* ── param_search: FILTRO DE CARDS PARA O TREINO ───────────────────────────
     Por que existe: os parâmetros do FSRS descrevem COMO VOCÊ esquece. Se o
     histórico mistura coisas de naturezas diferentes — lei seca decorada ao
     lado de raciocínio lógico, ou um baralho importado de terceiros que você
     mal revisou — o ajuste vira uma média de perfis que não descreve nenhum
     deles. Restringir o treino ao que é homogêneo produz pesos melhores que
     treinar em tudo.

     Sintaxe aceita (tudo opcional, separado por espaço, tudo em E lógico):
       materia:tributário     campo começa com o texto (sem acento, sem caixa)
       topico:imunidades      idem
       tipo:cloze             idem
       baralho:leis           idem
       favorito · suspenso · leech         exige a marca
       -favorito · -suspenso · -leech      exige a AUSÊNCIA da marca
       qualquer outra palavra              busca em frente/verso/matéria/tópico
       -palavra                            exclui quem contém a palavra

     Termo com aspas mantém o espaço: materia:"direito tributário".
     Entrada vazia = todos os cards (comportamento anterior). */
  compilarBusca(consulta) {
    const norm = (x) => String(x == null ? '' : x)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const q = String(consulta || '').trim();
    if (!q) return null;                       // sem filtro
    // divide respeitando aspas
    const termos = (q.match(/-?\w+:"[^"]*"|-?"[^"]*"|\S+/g) || []);
    const testes = [];
    const CAMPOS = { materia: 'materia', topico: 'topico', tipo: 'tipo', baralho: '_deckNome' };
    const MARCAS = { favorito: 'favorito', suspenso: 'suspenso', leech: 'leech' };
    termos.forEach(bruto => {
      let t = bruto, neg = false;
      if (t[0] === '-') { neg = true; t = t.slice(1); }
      t = t.replace(/"/g, '');
      if (!t) return;
      const dp = t.indexOf(':');
      if (dp > 0) {
        const campo = CAMPOS[norm(t.slice(0, dp))];
        const valor = norm(t.slice(dp + 1));
        if (campo && valor) {
          testes.push(c => { const v = norm(c[campo]); const bate = v.indexOf(valor) === 0 || v.indexOf(valor) >= 0; return neg ? !bate : bate; });
          return;
        }
      }
      const marca = MARCAS[norm(t)];
      if (marca) { testes.push(c => (neg ? !c[marca] : !!c[marca])); return; }
      const alvo = norm(t);
      testes.push(c => {
        const blob = norm(c.frente) + ' ' + norm(c.verso) + ' ' + norm(c.materia) + ' ' + norm(c.topico);
        const bate = blob.indexOf(alvo) >= 0;
        return neg ? !bate : bate;
      });
    });
    if (!testes.length) return null;
    return (card) => testes.every(f => { try { return f(card); } catch (e) { return false; } });
  },

  /* ── CONVERSÃO SM-2 → FSRS (fsrs-rs: memory_state_from_sm2) ────────────────
     Traduz um card agendado pelo algoritmo clássico para um estado de memória
     do FSRS, invertendo a curva de esquecimento. Usada ao migrar cards antigos
     e ao trocar o algoritmo de um baralho. */
  memoryStateFromSM2(easeFactor, intervalo, sm2Retention) {
    const w = CardsConfig.weights();
    const decay = -this._w20(w);
    const fator = Math.pow(0.9, 1 / decay) - 1;
    const ret = Math.min(0.99, Math.max(0.5, sm2Retention || 0.9));
    const S = Math.max(this.S_MIN, intervalo || 1) * fator / (Math.pow(ret, 1 / decay) - 1);
    const D = 11 - (easeFactor - 1) /
      (Math.exp(w[8]) * Math.pow(S, -w[9]) * (Math.exp((1 - ret) * w[10]) - 1));
    // Entrada absurda (ease negativo, intervalo zero) não pode virar NaN no card.
    return {
      s: isFinite(S) ? this.clampS(S) : this.clampS(Math.max(1, intervalo || 1)),
      d: isFinite(D) ? this.clampD(D) : 5
    };
  },

  addDaysISO(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + (n || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  pesoDoDia(iso) {
    try {
      const cfg = CardsConfig.get();
      const dias = cfg.easyDays;
      if (!Array.isArray(dias) || dias.length !== 7) return 1;
      const d = new Date(iso + 'T00:00:00').getDay();      // 0 = domingo
      const p = Number(dias[d]);
      return isFinite(p) ? Math.min(1, Math.max(0, p)) : 1;
    } catch (e) { _quiet(e, 'peso-dia'); return 1; }
  },

  // ---- LOAD BALANCING: dentro da MESMA janela de fuzz do Anki, escolhe o dia de menor carga ----
  /* ── BALANCEADOR DE CARGA (rslib/scheduler/states/load_balancer.rs) ─────────
     Duas diferencas reais em relacao ao Anki foram corrigidas aqui:

     1) TETO DE 90 DIAS. O Anki so balanceia intervalos ate 90 dias
        (MAX_LOAD_BALANCE_INTERVAL). Acima disso ele nao mexe. O app balanceava
        qualquer intervalo, inclusive de anos, onde isso nao faz sentido nenhum.

     2) SORTEIO PONDERADO, nao o minimo. O app escolhia sempre o dia MAIS VAZIO
        da janela. Isso e deterministico e se auto-destroi: todos os cards da
        rodada caem no mesmo dia, que deixa de ser o mais vazio. O Anki sorteia
        com peso, e o comentario do proprio codigo explica a formula:
            peso = (1/qtd_cards)^2.15 * (1/intervalo)^3
        (dia vazio recebe peso 1,0). O termo do intervalo inclina levemente para
        datas mais cedo, senao o balanceador puxa tudo para o fim da janela.
     Modificadores de irmaos e "easy days" nao se aplicam: o app nao tem notas
     com varios cards nem dias de carga reduzida. */
  MAX_LOAD_BALANCE_INTERVAL: 90,
  loadBalance(iv, dueCountByDay, maxIv, minIv) {
    const [lo, hi] = this.fuzzRange(iv, maxIv, minIv);
    if (hi <= lo) return lo;
    // acima de 90 dias o Anki nao balanceia: devolve o proprio intervalo
    if (iv > this.MAX_LOAD_BALANCE_INTERVAL || (minIv || 1) > this.MAX_LOAD_BALANCE_INTERVAL) {
      return Math.min(hi, Math.max(lo, Math.round(iv)));
    }
    const dias = [], pesos = [];
    let soma = 0;
    const hojeLB = todayCards();
    for (let d = lo; d <= hi; d++) {
      const n = dueCountByDay(d) || 0;
      let peso = (n === 0) ? 1.0 : Math.pow(1 / n, 2.15) * Math.pow(1 / d, 3);
      /* easy_days_percentages: multiplica o peso do dia pelo percentual de carga
         que aquele dia da semana aceita. Um dia zerado sai do sorteio — mas veja
         o fallback abaixo: se TODOS os dias da janela estiverem zerados, voltamos
         aos pesos originais. O Anki prefere marcar num dia ruim a violar o
         intervalo que o algoritmo calculou. */
      peso *= this.pesoDoDia(this.addDaysISO(hojeLB, d));
      dias.push(d); pesos.push(peso); soma += peso;
    }
    if (!(soma > 0)) {
      // todos os dias da janela são "leves": ignora o modificador nesta rodada
      soma = 0;
      for (let k = 0; k < dias.length; k++) {
        const d = dias[k], n = dueCountByDay(d) || 0;
        pesos[k] = (n === 0) ? 1.0 : Math.pow(1 / n, 2.15) * Math.pow(1 / d, 3);
        soma += pesos[k];
      }
    }
    if (!(soma > 0)) return lo;
    let alvo = Math.random() * soma;
    for (let i = 0; i < dias.length; i++) { alvo -= pesos[i]; if (alvo <= 0) return dias[i]; }
    return dias[dias.length - 1];
  },
  // ---- RETENÇÃO RECOMENDADA: custo de revisões por retenção-alvo (menor custo = ótimo) ----
  recommendRetention(nCards, minutesPerDay, opts) {
    opts = opts || {}; const w = opts.w || this.DEFAULT_W;
    const horizon = opts.horizon || 365, secPerReview = opts.secPerReview || 9;
    const capacity = (minutesPerDay * 60) / secPerReview;
    const curve = [];
    const costPerCard = (r) => {
      let S = this.initS(3, w), D = this.initD(3, w), day = 0, reviews = 0, guard = 0;
      while (day < horizon && guard++ < 2000) {
        const iv = this.interval(S, r, w); day += iv; if (day > horizon) break;
        reviews++; const R = this.R(iv, S, w);
        if (Math.random() < R) { S = this.nextS_recall(D, S, R, 3, w); D = this.nextD(D, 3, w); }
        else { S = this.nextS_forget(D, S, R, w); D = this.nextD(D, 1, w); reviews += 1; }
      }
      return reviews;
    };
    for (let rr = 0.80; rr <= 0.97 + 1e-9; rr += 0.01) {
      let sum = 0; const K = 12; for (let k = 0; k < K; k++) sum += costPerCard(rr);
      const perCardYear = sum / K, reviewsPerDay = (perCardYear * nCards) / horizon;
      curve.push({ retention: Math.round(rr * 100) / 100, reviewsPerDay: Math.round(reviewsPerDay * 10) / 10 });
    }
    let best = curve[0]; curve.forEach(c => { if (c.reviewsPerDay < best.reviewsPerDay) best = c; });
    let rec = best.retention;
    if (best.reviewsPerDay > capacity) { const feas = curve.filter(c => c.reviewsPerDay <= capacity); if (feas.length) rec = feas[feas.length - 1].retention; }
    return { recommended: rec, optimal: best.retention, capacity: Math.round(capacity), curve };
  }
};

// Configuração dos Cards (algoritmo, retenção-alvo, passos de aprendizado) — global, por dispositivo.