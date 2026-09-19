/* ============================================================================
   MOTOR DE SUGESTÃO — percurso hierárquico do TEC
   ----------------------------------------------------------------------------
   O motor replica a forma de leitura do índice do TecConcursos:

     disciplina → pior tópico → pior subtópico → ... → próximo irmão.

   A estatística não escolhe uma árvore diferente. Ela responde apenas:
   "até que nível dá para confiar no percentual?". Quando um filho é pequeno
   demais, ele pode ser combinado SOMENTE com irmãos consecutivos do mesmo pai.
   Se nem um pequeno grupo local sustenta a medida, sobe-se UM nível. A raiz
   (disciplina) é uma fronteira absoluta: nunca vira atividade.

   Pré-edital: a ordem entre disciplinas segue o pior recorte acionável.
   Pós-edital: a incidência da banca entra como peso entre disciplinas, sem
   alterar a ordem fraco→forte DENTRO de cada árvore.

   Cada atividade recebe sua própria dose. O total não é repartido até produzir
   "1 questão": reforço abaixo do piso não existe.
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
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };

  const M = {
    KEY: 'motor-sugestao-v1',
    DEFAULTS: Object.freeze({
      fase: 'pre',
      margemMax: 15,
      alvoQuestoes: 25,       // tamanho-base DE CADA atividade
      doseMin: 12,            // piso real: atividade simbólica não entra
      maxFrentes: 3,          // disciplinas distintas na rodada
      metaAcerto: 90
    }),
    LIMITES: Object.freeze({
      margemMax: [5, 40],
      alvoQuestoes: [10, 100],
      doseMin: [10, 50],
      maxFrentes: [1, 3],
      metaAcerto: [50, 100]
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
      // Uma preferência antiga podia deixar o piso em 1–5. Migração silenciosa:
      // daqui para frente nenhum reforço nasce abaixo do piso novo.
      d.doseMin = Math.max(this.DEFAULTS.doseMin, d.doseMin);
      d.alvoQuestoes = Math.max(d.doseMin, d.alvoQuestoes);
      return d;
    },
    salvar(patch) {
      const p = Object.assign(this.prefs(), patch || {});
      const limpo = { fase: p.fase === 'pos' ? 'pos' : 'pre' };
      Object.keys(this.LIMITES).forEach(k => {
        const [lo, hi] = this.LIMITES[k];
        limpo[k] = Math.round(clamp(p[k], lo, hi));
      });
      limpo.doseMin = Math.max(this.DEFAULTS.doseMin, limpo.doseMin);
      limpo.alvoQuestoes = Math.max(limpo.doseMin, limpo.alvoQuestoes);
      try {
        const raw = JSON.stringify(limpo);
        if (DB.setRaw) DB.setRaw(this._key(), raw); else localStorage.setItem(this._key(), raw);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-save'); }
      try { window.dispatchEvent(new CustomEvent('motor-sugestao:change', { detail: limpo })); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-event'); }
      return limpo;
    },
    restaurar() { return this.salvar(Object.assign({}, this.DEFAULTS)); },

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
    _pct(node) {
      const q = num(node && node.questoes);
      return q > 0 ? clamp(num(node.acertos) / q * 100, 0, 100) : 100;
    },
    _ordenarFracos(arr) {
      return (arr || []).slice().sort((a, b) =>
        this._pct(a) - this._pct(b) ||
        num(b.questoes) - num(a.questoes) ||
        String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true })
      );
    },

    _item(node, meta) {
      meta = meta || {};
      const q = num(node.questoes);
      const ac = Math.max(0, Math.min(q, num(node.acertos)));
      const taxa = q > 0 ? ac / q * 100 : null;
      const membros = Array.isArray(meta.membros) ? meta.membros.filter(Boolean) : null;
      return {
        nome: meta.nome || node.nome,
        codigo: node.codigo || null,
        nivel: Math.max(1, num(node.depth, 1)),
        disciplina: node.disciplina || meta.disciplina || '',
        questoes: q,
        acertos: ac,
        erros: q - ac,
        taxa,
        taxaErro: taxa == null ? null : 100 - taxa,
        margem: this.margem(q, ac),
        agregado: !!(membros && membros.length > 1),
        membros: membros && membros.length ? membros.slice() : null,
        residuo: 0,
        pai: meta.pai || null,
        caminho: Array.isArray(meta.caminho) ? meta.caminho.slice() : [],
        motivoNivel: meta.motivoNivel || 'amostra-propria'
      };
    },

    _grupo(pai, filhos, caminho) {
      const q = filhos.reduce((s, x) => s + num(x.questoes), 0);
      const ac = filhos.reduce((s, x) => s + num(x.acertos), 0);
      const nomes = filhos.map(x => x.nome).filter(Boolean);
      const base = {
        nome: (pai.nome || 'Bloco') + ' · bloco',
        codigo: pai.codigo || null,
        depth: Math.max(1, num(pai.depth, 1) + 1),
        disciplina: pai.disciplina || '',
        questoes: q,
        acertos: ac
      };
      return this._item(base, {
        nome: base.nome,
        membros: nomes,
        pai: pai.nome || null,
        caminho: (caminho || []).concat([pai.nome || '']).filter(Boolean),
        motivoNivel: 'irmaos-agrupados'
      });
    },

    /* Planeja UM ramo sem atravessar o pai.
       - filho confiável: tenta descer;
       - filho pequeno: procura OUTROS irmãos pequenos do mesmo pai, na ordem
         pior→melhor, até a soma sustentar a margem;
       - não existe limite arbitrário de "4 irmãos": quem encerra o grupo é a
         suficiência estatística;
       - irmãos que já são confiáveis sozinhos não são engolidos pelo bloco;
       - se nem todos os pequenos juntos fecham a amostra, volta ao próprio nó;
       - nunca sobe para depth 0. */
    _planejarNo(node, margemMax, caminho) {
      if (!node || num(node.depth) <= 0) return [];
      const q = num(node.questoes), ac = num(node.acertos);
      const proprioLegivel = this.legivel(q, ac, margemMax);
      const kids = this._ordenarFracos((node.children || []).filter(x => num(x.questoes) > 0));
      const aqui = (caminho || []).concat([node.nome]).filter(Boolean);

      if (!kids.length) {
        return proprioLegivel ? [this._item(node, { caminho: aqui.slice(0, -1) })] : [];
      }

      const plano = [];
      const usados = new Set();
      for (let i = 0; i < kids.length; i++) {
        if (usados.has(i)) continue;
        const filho = kids[i];
        if (this.legivel(num(filho.questoes), num(filho.acertos), margemMax)) {
          const fundo = this._planejarNo(filho, margemMax, aqui);
          plano.push(...(fundo.length ? fundo : [this._item(filho, { caminho: aqui })]));
          continue;
        }

        // O primeiro ramo pequeno lidera um bloco só de ramos pequenos. Irmão
        // mensurável fica fora: ele merece sua própria posição na fila.
        const grupo = [filho], idxs = [i];
        let qg = num(filho.questoes), ag = num(filho.acertos);
        for (let j = i + 1; j < kids.length && !this.legivel(qg, ag, margemMax); j++) {
          if (usados.has(j)) continue;
          const cand = kids[j];
          if (this.legivel(num(cand.questoes), num(cand.acertos), margemMax)) continue;
          grupo.push(cand); idxs.push(j);
          qg += num(cand.questoes); ag += num(cand.acertos);
        }
        if (grupo.length >= 2 && this.legivel(qg, ag, margemMax)) {
          idxs.slice(1).forEach(k => usados.add(k));
          plano.push(this._grupo(node, grupo, caminho));
          continue;
        }

        // Se até a soma de todos os irmãos pequenos continua imprecisa, misturar
        // pai e filhos produziria escopos sobrepostos. O recorte honesto é o pai.
        return proprioLegivel
          ? [this._item(node, { caminho: (caminho || []).slice(), motivoNivel: 'subnivel-insuficiente' })]
          : [];
      }
      return plano;
    },

    _filaDisciplina(disc, p) {
      const tops = this._ordenarFracos((disc.children || []).filter(x => num(x.questoes) > 0));
      const fila = [];
      tops.forEach(top => {
        const plano = this._planejarNo(top, p.margemMax, []);
        plano.forEach(x => {
          if (x && x.taxa != null && x.taxa < p.metaAcerto && x.nivel > 0) fila.push(x);
        });
      });
      // A travessia já é depth-first e pior→melhor. O índice explícito deixa a
      // tela e os testes auditarem essa ordem sem reordenar por score.
      fila.forEach((x, i) => { x.ordemNaDisciplina = i + 1; });
      return fila;
    },

    _peso(item, fase, incMap) {
      if (fase !== 'pos') return item.questoes;
      if (!incMap) return 0;
      const nomes = item.membros && item.membros.length ? item.membros : [item.nome.replace(/\s*·\s*bloco\s*$/i, '')];
      let soma = 0;
      nomes.forEach(n => {
        try { soma += num(ReforcoEngine.incidenciaDe(incMap, n, item.disciplina).valor); }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-incid'); }
      });
      return soma;
    },

    _lacuna(item, p) {
      const taxa = item && item.taxa != null ? num(item.taxa) : 100 - num(item && item.taxaErro);
      const margem = Math.max(0, num(item && item.margem));
      const gapMeta = Math.max(0, num(p.metaAcerto, this.DEFAULTS.metaAcerto) - taxa);
      // "Lacuna confiável": o que ainda falta mesmo no extremo OTIMISTA da
      // margem de erro. Assim amostra pequena não ganha prioridade só por ter
      // produzido um percentual assustador.
      const gapConfiavel = Math.max(0, gapMeta - margem);
      const lacunaMeta = Math.max(0, Math.round(num(item && item.questoes) * gapMeta / 100));
      return { taxa, margem, gapMeta, gapConfiavel, lacunaMeta };
    },
    _dose(item, p) {
      const piso = Math.max(this.DEFAULTS.doseMin, num(p.doseMin, this.DEFAULTS.doseMin));
      const base = Math.max(piso, num(p.alvoQuestoes, this.DEFAULTS.alvoQuestoes));
      const l = this._lacuna(item, p);
      /* Dose contínua, não quatro degraus arbitrários:
         - lacuna confiável 0pp => ~45% da base, limitado pelo piso;
         - +10pp => ~67% da base;
         - +20pp => ~89% da base;
         - +25pp ou mais => base inteira.
         O tamanho responde à necessidade de treino, mas nunca vira 1–5 questões. */
      const fator = clamp(0.45 + l.gapConfiavel / 45, 0.45, 1);
      return Math.max(piso, Math.min(base, Math.round(base * fator)));
    },
    dosar(itens, alvo, doseMin) {
      const p = Object.assign(this.prefs(), {
        alvoQuestoes: Math.max(num(alvo, this.DEFAULTS.alvoQuestoes), num(doseMin, this.DEFAULTS.doseMin)),
        doseMin: Math.max(this.DEFAULTS.doseMin, num(doseMin, this.DEFAULTS.doseMin))
      });
      return (itens || []).map(x => Object.assign(x, { dose: this._dose(x, p) }));
    },
    _compararDisciplinas(a, b, p) {
      const A = a && a.melhorTopico || {}, B = b && b.melhorTopico || {};
      if ((p && p.fase) === 'pos') {
        return (num(B.gapConfiavel) * num(B.peso)) - (num(A.gapConfiavel) * num(A.peso))
          || (num(B.gapMeta) * num(B.peso)) - (num(A.gapMeta) * num(A.peso))
          || num(B.gapConfiavel) - num(A.gapConfiavel)
          || num(B.gapMeta) - num(A.gapMeta)
          || num(B.lacunaMeta) - num(A.lacunaMeta)
          || num(B.questoes) - num(A.questoes);
      }
      return num(B.gapConfiavel) - num(A.gapConfiavel)
        || num(B.gapMeta) - num(A.gapMeta)
        || num(B.lacunaMeta) - num(A.lacunaMeta)
        || num(B.questoes) - num(A.questoes);
    },

    calcular(opts) {
      const p = Object.assign(this.prefs(), opts || {});
      p.doseMin = Math.max(this.DEFAULTS.doseMin, num(p.doseMin, this.DEFAULTS.doseMin));
      p.alvoQuestoes = Math.max(p.doseMin, num(p.alvoQuestoes, this.DEFAULTS.alvoQuestoes));

      let snap = null;
      try { snap = DesempenhoTecScreen.scopedSnapshot(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-snap'); }
      if (!snap || !(snap.rows || []).length) return { erro: 'sem-retrato', fase: p.fase, prefs: p, itens: [], todos: [], disciplinas: [] };

      let forest = [];
      try { forest = TecEngine.buildTree(snap) || []; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-arvore'); }
      if (!forest.length) return { erro: 'sem-arvore', fase: p.fase, prefs: p, itens: [], todos: [], disciplinas: [] };

      let banca = '__todas__';
      try { banca = DesempenhoTecScreen.bancaFiltro(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-banca'); }
      let incMap = null;
      if (p.fase === 'pos') {
        try { incMap = ReforcoEngine.incidenceMap(banca); }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-mapa'); }
        if (!incMap || !Object.keys(incMap).length) {
          return { erro: 'sem-incidencia', fase: p.fase, prefs: p, itens: [], todos: [], disciplinas: [] };
        }
      }

      const disciplinasTodas = forest.map(d => {
        const fila = this._filaDisciplina(d, p);
        fila.forEach(x => {
          const l = this._lacuna(x, p);
          x.gapMeta = l.gapMeta;
          x.gapConfiavel = l.gapConfiavel;
          x.lacunaMeta = l.lacunaMeta;
          x.peso = this._peso(x, p.fase, incMap);
          // score fica como número de compatibilidade para telas auxiliares.
          // A ordem interna NÃO lê esse score: continua sendo a árvore do TEC.
          x.score = p.fase === 'pos' ? x.gapMeta * x.peso : x.gapMeta;
          x.prioridade = p.fase === 'pos' ? x.gapConfiavel * x.peso : x.gapConfiavel;
          x.legivel = x.margem != null && x.margem <= p.margemMax;
        });
        const acionaveis = fila.filter(x => x.legivel && (p.fase !== 'pos' || x.peso > 0));
        const q = num(d.questoes), ac = Math.max(0, Math.min(q, num(d.acertos)));
        const taxa = q > 0 ? ac / q * 100 : null;
        const melhor = acionaveis[0] || null;
        return {
          nome: d.nome,
          questoes: q,
          acertos: ac,
          taxa,
          taxaErro: taxa == null ? null : 100 - taxa,
          margem: this.margem(q, ac),
          fila: acionaveis,
          melhorTopico: melhor,
          prioridade: melhor ? melhor.prioridade : -1,
          score: acionaveis.reduce((s, x) => s + num(x.score), 0)
        };
      });

      /* ENTRE disciplinas, não usamos o percentual cru:
         1) maior lacuna que continua existindo mesmo no extremo otimista da margem;
         2) maior distância observada para a meta;
         3) maior volume estimado de déficit naquele recorte.
         No pós-edital, a incidência pesa as duas primeiras chaves. Dentro de cada
         disciplina nada disso reordena a fila: a travessia hierárquica manda. */
      const disciplinas = disciplinasTodas.filter(d => d.melhorTopico)
        .sort((a, b) => this._compararDisciplinas(a, b, p));
      disciplinas.forEach((d, i) => {
        d.rank = i + 1;
        d.fila.forEach((x, j) => { x.disciplinaRank = i + 1; x.ordemNaDisciplina = j + 1; });
      });

      const escolhidas = disciplinas.slice(0, p.maxFrentes);
      const itens = escolhidas.map(d => Object.assign({}, d.melhorTopico));
      itens.forEach(x => { x.dose = this._dose(x, p); });

      // Ranking de tópicos NÃO é uma sopa global de score: segue a disciplina
      // ordenada e, dentro dela, a travessia hierárquica pior→melhor.
      const todos = [];
      disciplinas.forEach(d => d.fila.forEach(x => todos.push(x)));

      return {
        fase: p.fase,
        prefs: p,
        erro: null,
        banca: p.fase === 'pos' ? banca : null,
        criterioDisciplinas: p.fase === 'pos' ? 'lacuna confiável × incidência' : 'lacuna confiável do pior recorte',
        itens,
        disciplinas,
        disciplinasTodas,
        todos
      };
    }
  };

  window.MotorSugestao = M;
})();