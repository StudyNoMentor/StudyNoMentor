/* ============================================================================
   MOTOR DE SUGESTÃO — único motor de decisão do app
   ----------------------------------------------------------------------------
   A Análise mostra os fatos e a Incidência guarda o histórico da banca; nenhum
   dos dois calcula nada. Toda a decisão — onde atacar, em que nível da árvore e
   com quantas questões — mora aqui, e cabe em duas contas:

   ① ATÉ ONDE DESCER (poda). O TecConcursos deixa filtrar em qualquer nível, mas
     quanto mais fundo, menos questões por nó — e "100% de erro" em duas questões
     não é diagnóstico, é ruído. O corte não é um número fixo de questões (que
     significa coisas diferentes em cada granularidade): é a MARGEM DE ERRO da
     proporção, que o app já calcula por Wilson em `PlanoEngine.margemErro`. Um
     nó só é aberto se os filhos couberem na margem tolerada. Quem não couber
     não some: junta-se aos irmãos miúdos num agregado do próprio nível, que é
     exatamente o "sobe um degrau" — o nó grosso o bastante para medir, fino o
     bastante para ser um caderno. A régua se ajusta sozinha: taxa perto de 0%
     ou 100% fecha com poucas questões, taxa perto de 50% exige mais.

   ② QUANTO IMPORTA (score). `peso × taxa de erro`. No pré-edital o peso é o
     volume do próprio nó, e o produto é literalmente o NÚMERO DE ERROS ali. No
     pós-edital o peso é a incidência histórica da banca, e o produto vira o
     erro esperado NA PROVA. É a mesma conta com a fonte do peso trocada — não
     há segunda fórmula, nem modelo, nem parâmetro escondido.

   O que este arquivo NÃO faz: não lê peso digitado à mão, não modela tempo, não
   estima ganho futuro e não pontua método de estudo.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__motorSugestao) return;
  if (typeof DB === 'undefined' || typeof DesempenhoTecScreen === 'undefined') return;
  window.__motorSugestao = true;

  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, num(v, a)));
  const norm = (s) => {
    try { if (typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm) return ReforcoEngine.norm(s || ''); }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-norm'); }
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };

  const M = {
    KEY: 'motor-sugestao-v1',
    /* `margemMax` é o ÚNICO parâmetro de régua do motor, e é em pontos
       percentuais de propósito: "confio num número com ±15pp" é uma frase que
       se responde olhando a tela. "Mínimo de 20 questões" não é — vale coisas
       diferentes num tópico de nível 2 e num de nível 5. */
    DEFAULTS: Object.freeze({
      fase: 'pre',            // 'pre' = só o seu desempenho · 'pos' = cruza com a incidência
      margemMax: 15,          // pp de margem tolerada para abrir um nível
      alvoQuestoes: 25,       // tamanho do caderno que o motor distribui
      doseMin: 5,             // piso por frente: caderno de 2 questões não mede nada
      /* TRÊS DISCIPLINAS, UM TÓPICO CADA. O número não é estético: é o que
         cabe numa semana de execução real, e o motor abre no máximo uma frente
         por disciplina justamente para que a rodada não vire três recortes da
         mesma matéria. */
      maxFrentes: 3,
      metaAcerto: 85          // acima disso a atividade é dada por resolvida
    }),
    LIMITES: Object.freeze({
      margemMax: [5, 40], alvoQuestoes: [5, 300], doseMin: [1, 50],
      maxFrentes: [1, 12], metaAcerto: [50, 100]
    }),
    _key() { return DB._profilePrefix() + this.KEY; },
    prefs() {
      const d = Object.assign({}, this.DEFAULTS);
      let z = null;
      try { z = JSON.parse(localStorage.getItem(this._key()) || 'null'); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-prefs'); }
      if (!z || typeof z !== 'object') return d;
      if (z.fase === 'pre' || z.fase === 'pos') d.fase = z.fase;
      Object.keys(this.LIMITES).forEach(k => {
        if (z[k] == null) return;
        const [lo, hi] = this.LIMITES[k];
        d[k] = Math.round(clamp(z[k], lo, hi));
      });
      return d;
    },
    salvar(patch) {
      const p = Object.assign(this.prefs(), patch || {});
      const limpo = { fase: p.fase === 'pos' ? 'pos' : 'pre' };
      Object.keys(this.LIMITES).forEach(k => {
        const [lo, hi] = this.LIMITES[k];
        limpo[k] = Math.round(clamp(p[k], lo, hi));
      });
      try {
        const raw = JSON.stringify(limpo);
        if (DB.setRaw) DB.setRaw(this._key(), raw); else localStorage.setItem(this._key(), raw);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-save'); }
      try { window.dispatchEvent(new CustomEvent('motor-sugestao:change', { detail: limpo })); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-event'); }
      return limpo;
    },
    restaurar() { return this.salvar(Object.assign({}, this.DEFAULTS)); },

    /* ── A RÉGUA ────────────────────────────────────────────────────────────
       Wilson, já implementado e usado pela Análise. Um nó é LEGÍVEL quando a
       margem do seu percentual cabe no que você tolera; abaixo de duas questões
       não existe margem e o nó nunca é legível sozinho. */
    margem(q, ac) {
      if (!(q > 0)) return null;
      const pct = clamp(ac / q * 100, 0, 100);
      try { return PlanoEngine.margemErro(pct, q); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-margem'); return null; }
    },
    legivel(q, ac, margemMax) {
      const m = this.margem(q, ac);
      return m != null && m <= margemMax;
    },

    /* ── PODA ADAPTATIVA ────────────────────────────────────────────────────
       Desce um nível de cada vez. O filho que a margem sustenta continua sendo
       aberto; os que não sustentam viram UM agregado do nível, com os nomes que
       o compõem guardados em `membros` — é assim que o caderno vira um filtro
       real no TecConcursos em vez de um tópico de três questões.

       O RESÍDUO do pai (o que ele mede e os filhos não explicam) entra nesse
       mesmo agregado. Sem isso, o volume praticado direto no nível de cima
       sumiria da conta — e some em silêncio, que é pior. */
    _folhasEfetivas(node, margemMax, saida) {
      const kids = (node.children || []).filter(c => num(c.questoes) > 0);
      const qKids = kids.reduce((a, c) => a + num(c.questoes), 0);
      const acKids = kids.reduce((a, c) => a + num(c.acertos), 0);
      const residQ = Math.max(0, num(node.questoes) - qKids);
      const residAc = Math.max(0, Math.min(residQ, num(node.acertos) - acKids));
      if (!kids.length) { saida.push(this._item(node, null)); return saida; }

      const miudos = [];
      kids.forEach(c => {
        if (this.legivel(num(c.questoes), num(c.acertos), margemMax)) this._folhasEfetivas(c, margemMax, saida);
        else miudos.push(c);
      });
      if (!miudos.length && residQ <= 0) return saida;

      /* Um miúdo sozinho e sem resíduo não vira agregado: embrulhar um nó em um
         grupo de um membro só trocaria o nome dele sem juntar volume nenhum. */
      if (miudos.length === 1 && residQ <= 0) { saida.push(this._item(miudos[0], null)); return saida; }

      const q = miudos.reduce((a, c) => a + num(c.questoes), 0) + residQ;
      const ac = miudos.reduce((a, c) => a + num(c.acertos), 0) + residAc;
      if (q <= 0) return saida;
      saida.push(this._item({
        nome: node.nome, codigo: node.codigo, depth: node.depth, disciplina: node.disciplina,
        questoes: q, acertos: ac
      }, miudos.map(c => c.nome).filter(Boolean), residQ));
      return saida;
    },
    /* `residuo` é o volume que o nó mede e os filhos não explicam. Ele existe de
       verdade — são questões praticadas no nível de cima, sem detalhe de
       subtópico — e por isso conta; mas a tela precisa dizer isso, senão a linha
       parece falar do ramo inteiro quando fala só do que sobrou dele. */
    _item(node, membros, residuo) {
      const q = num(node.questoes), ac = Math.max(0, Math.min(q, num(node.acertos)));
      const taxa = q > 0 ? ac / q * 100 : null;
      const temMembros = !!(membros && membros.length);
      const resid = Math.max(0, num(residuo));
      return {
        nome: node.nome, codigo: node.codigo || null, nivel: num(node.depth),
        disciplina: node.disciplina || '', questoes: q, acertos: ac, erros: q - ac,
        taxa, taxaErro: taxa == null ? null : 100 - taxa,
        margem: this.margem(q, ac),
        agregado: temMembros || resid > 0,
        residuo: resid,
        membros: temMembros ? membros.slice() : null
      };
    },

    /* ── O PESO ─────────────────────────────────────────────────────────────
       Pré-edital: o volume do próprio nó. Não é opinião nem chute — é quanto o
       banco de questões cobra aquilo, que é a melhor leitura de importância
       disponível antes de existir um edital.
       Pós-edital: a incidência histórica que você importou na aba Incidência,
       somada pelos nomes que compõem o nó. Nó sem casamento na incidência fica
       com peso zero e sai da fila: o pós-edital só promete o que a banca cobra. */
    _peso(item, fase, incMap) {
      if (fase !== 'pos') return item.questoes;
      if (!incMap) return 0;
      const nomes = item.membros && item.membros.length ? item.membros : [item.nome];
      let soma = 0;
      nomes.forEach(n => {
        try { soma += num(ReforcoEngine.incidenciaDe(incMap, n, item.disciplina).valor); }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-incid'); }
      });
      return soma;
    },

    /* ── A DOSE ─────────────────────────────────────────────────────────────
       Primeiro reserva o piso de TODA frente escolhida e só depois reparte o
       restante pelo score. Assim um caderno de 25 com três frentes e piso 5
       entrega três frentes de verdade; a conta antiga podia dar 3/9/13 e
       eliminar justamente a terceira disciplina depois de tê-la escolhido. */
    dosar(itens, alvo, doseMin) {
      const maxCabem = Math.floor(alvo / Math.max(1, doseMin));
      const ativos = (itens || []).slice(0, Math.max(0, maxCabem));
      if (!ativos.length) return [];
      const total = ativos.reduce((a, x) => a + Math.max(0, x.score), 0);
      let restante = alvo - ativos.length * doseMin;
      ativos.forEach((x, i) => {
        const extra = i === ativos.length - 1
          ? restante
          : Math.max(0, Math.min(restante, Math.round((alvo - ativos.length * doseMin) * (total > 0 ? x.score / total : 1 / ativos.length))));
        x.dose = doseMin + extra;
        restante -= extra;
      });
      return ativos;
    },

    /* Resultado único do motor. `itens` é a fila executável (já dosada);
       `todos` é o ranking inteiro, para a tela poder mostrar o que ficou de fora
       e por quê. */
    calcular(opts) {
      const p = Object.assign(this.prefs(), opts || {});
      let snap = null;
      try { snap = DesempenhoTecScreen.scopedSnapshot(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-snap'); }
      if (!snap || !(snap.rows || []).length) return { erro: 'sem-retrato', fase: p.fase, prefs: p, itens: [], todos: [] };

      let forest = [];
      try { forest = TecEngine.buildTree(snap) || []; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-arvore'); }
      if (!forest.length) return { erro: 'sem-arvore', fase: p.fase, prefs: p, itens: [], todos: [] };

      /* A BANCA É UMA SÓ NO APP INTEIRO. Ela é escolhida no seletor de bancas
         do escopo, que a Incidência e a Análise já leem — um segundo campo aqui
         criaria duas respostas para "qual é a minha prova". */
      let banca = '__todas__';
      try { banca = DesempenhoTecScreen.bancaFiltro(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-banca'); }
      let incMap = null;
      if (p.fase === 'pos') {
        try { incMap = ReforcoEngine.incidenceMap(banca); }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-mapa'); }
        if (!incMap || !Object.keys(incMap).length) {
          return { erro: 'sem-incidencia', fase: p.fase, prefs: p, itens: [], todos: [] };
        }
      }

      /* DISCIPLINA É CONTEXTO, NUNCA FILTRO EXECUTÁVEL.
         A falha anterior nascia aqui: a poda começava na raiz (depth 0). Se os
         tópicos fossem pequenos, eles eram agregados no pai e o pai se chamava
         "Contabilidade Geral" — logo a disciplina inteira virava "tópico".
         Agora a poda começa NOS FILHOS da disciplina. Ela pode subir de um
         subtópico miúdo para o tópico-pai, mas jamais atravessa a fronteira da
         matéria. É exatamente o comportamento do filtro do TEC: escolhemos o
         nível mais alto necessário DENTRO da disciplina, não a disciplina. */
      const folhas = [];
      forest.forEach(d => {
        (d.children || []).filter(x => num(x.questoes) > 0)
          .forEach(top => this._folhasEfetivas(top, p.margemMax, folhas));
      });

      const todos = folhas
        .filter(x => x.nivel > 0 && x.questoes > 0 && x.taxaErro > 0)
        .map(x => {
          x.peso = this._peso(x, p.fase, incMap);
          x.score = x.peso * (x.taxaErro / 100);
          x.legivel = x.margem != null && x.margem <= p.margemMax;
          return x;
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || b.questoes - a.questoes);

      /* PRIMEIRO RANQUEIA MATÉRIAS, DEPOIS ESCOLHE UM TÓPICO DE CADA.
         O score da disciplina é a soma das lacunas MEDÍVEIS dos seus tópicos;
         assim a prioridade da matéria e a prioridade do tópico falam a mesma
         língua. Uma matéria sem nenhum tópico confiável aparece no ranking
         completo, mas não vira atividade inventando precisão. */
      const porDisc = new Map();
      todos.forEach(x => {
        const k = norm(x.disciplina);
        if (!porDisc.has(k)) porDisc.set(k, []);
        porDisc.get(k).push(x);
      });
      const disciplinasTodas = forest.map(d => {
        const cand = (porDisc.get(norm(d.nome)) || []).slice().sort((a, b) => b.score - a.score || b.questoes - a.questoes);
        const mediveis = cand.filter(x => x.legivel);
        const q = num(d.questoes), ac = Math.max(0, Math.min(q, num(d.acertos)));
        const taxa = q > 0 ? ac / q * 100 : null;
        return {
          nome: d.nome,
          questoes: q,
          acertos: ac,
          taxa,
          taxaErro: taxa == null ? null : 100 - taxa,
          margem: this.margem(q, ac),
          score: mediveis.reduce((s, x) => s + x.score, 0),
          topicosMediveis: mediveis.length,
          melhorTopico: mediveis[0] || null
        };
      }).sort((a, b) => {
        const aOk = a.melhorTopico ? 1 : 0, bOk = b.melhorTopico ? 1 : 0;
        return bOk - aOk || b.score - a.score || (b.taxaErro || 0) - (a.taxaErro || 0) || b.questoes - a.questoes;
      });
      const disciplinas = disciplinasTodas.filter(d => d.melhorTopico);
      disciplinas.forEach((d, i) => { d.rank = i + 1; });

      const fila = disciplinas.slice(0, p.maxFrentes).map((d, i) => {
        const x = Object.assign({}, d.melhorTopico);
        x.disciplinaRank = i + 1;
        x.disciplinaScore = d.score;
        return x;
      });

      return {
        fase: p.fase, prefs: p, erro: null,
        banca: p.fase === 'pos' ? banca : null,
        itens: this.dosar(fila, p.alvoQuestoes, p.doseMin),
        disciplinas,
        disciplinasTodas,
        todos
      };
    }
  };

  window.MotorSugestao = M;
})();
