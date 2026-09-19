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
      metaAcerto: 90,
      disciplinasSel: []       // vazio = todas; filtro compartilhado com Extras
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
      const d = Object.assign({}, this.DEFAULTS, { disciplinasSel: [] });
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
      if (Array.isArray(z.disciplinasSel)) {
        const vistos = new Set();
        d.disciplinasSel = z.disciplinasSel.map(x => String(x == null ? '' : x).trim())
          .filter(x => {
            const k = norm(x);
            if (!k || vistos.has(k) || vistos.size >= 120) return false;
            vistos.add(k); return true;
          }).map(x => x.slice(0, 300));
      }
      /* Migrações de contrato, uma vez por perfil.
         - o piso antigo aceitava 1–5 questões;
         - a meta antiga de fábrica era 85%, embora o estudo esteja configurado
           para perseguir 90%. Quem ainda carrega EXATAMENTE o antigo default
           recebe 90 uma vez; depois disso qualquer escolha manual é preservada. */
      const metaMigKey = this._key() + ':meta90-migrado';
      try {
        if (!localStorage.getItem(metaMigKey)) {
          if (num(z.metaAcerto, 85) === 85) {
            d.metaAcerto = this.DEFAULTS.metaAcerto;
            z.metaAcerto = d.metaAcerto;
            if (DB.setRaw) DB.setRaw(this._key(), JSON.stringify(z));
            else localStorage.setItem(this._key(), JSON.stringify(z));
          }
          localStorage.setItem(metaMigKey, '1');
        }
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-mig-meta'); }
      d.doseMin = Math.max(this.DEFAULTS.doseMin, d.doseMin);
      d.maxFrentes = Math.min(this.LIMITES.maxFrentes[1], d.maxFrentes);
      d.alvoQuestoes = Math.max(d.doseMin, d.alvoQuestoes);
      return d;
    },
    salvar(patch) {
      const p = Object.assign(this.prefs(), patch || {});
      const limpo = { fase: p.fase === 'pos' ? 'pos' : 'pre' };
      const vistosDisc = new Set();
      limpo.disciplinasSel = (Array.isArray(p.disciplinasSel) ? p.disciplinasSel : [])
        .map(x => String(x == null ? '' : x).trim())
        .filter(x => {
          const k = norm(x);
          if (!k || vistosDisc.has(k) || vistosDisc.size >= 120) return false;
          vistosDisc.add(k); return true;
        }).map(x => x.slice(0, 300));
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
    restaurar() { return this.salvar(Object.assign({}, this.DEFAULTS, { disciplinasSel: [] })); },

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

    /* O código 01/02/03 do TEC é POSICIONAL e muda entre retratos.
       O Motor, portanto, monta cada retrato isoladamente e só depois consolida
       por identidade semântica. Nome único na matéria casa por nome; se um nome
       aparece duas vezes no mesmo retrato, o caminho completo o desambigua. */
    _forestEstavel(snap) {
      if (!snap) return [];
      const fontes = (Array.isArray(snap._fontes) && snap._fontes.length) ? snap._fontes.slice() : [snap];
      fontes.sort((a, b) => String(a.endDate || a.date || a.startDate || '').localeCompare(String(b.endDate || b.date || b.startDate || '')));
      const arvores = fontes.map(s => {
        try { return TecEngine.buildTree(s) || []; }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-tree-fonte'); return []; }
      });

      const ambiguos = new Set();
      arvores.forEach(forest => (forest || []).forEach(d => {
        const cont = Object.create(null);
        const walk = n => (n.children || []).forEach(ch => {
          const k = norm(d.nome) + '\u0001' + norm(ch.nome);
          cont[k] = (cont[k] || 0) + 1;
          walk(ch);
        });
        walk(d);
        Object.keys(cont).forEach(k => { if (cont[k] > 1) ambiguos.add(k); });
      }));

      const roots = new Map(), nodes = new Map();
      const keyNode = (disc, nome, path) => {
        const base = norm(disc) + '\u0001' + norm(nome);
        if (!ambiguos.has(base)) return base + '\u0001N';
        return norm(disc) + '\u0001P\u0001' + (path || []).map(norm).join('›');
      };
      const ensureRoot = d => {
        const dk = norm(d.nome || d.disciplina);
        let r = roots.get(dk);
        if (!r) {
          r = { codigo: null, nome: d.nome, depth: 0, disciplina: d.disciplina || d.nome,
            questoes: 0, acertos: 0, pctAcerto: 0, children: [], _semKey: 'ROOT\u0001' + dk };
          roots.set(dk, r);
        }
        r.questoes += num(d.questoes); r.acertos += num(d.acertos);
        r.nome = d.nome || r.nome; r.disciplina = d.disciplina || d.nome || r.disciplina;
        return r;
      };

      arvores.forEach((forest, fonteIdx) => (forest || []).forEach(d => {
        const raiz = ensureRoot(d);
        const walk = (n, parent, path) => (n.children || []).forEach(ch => {
          const chPath = (path || []).concat([ch.nome]);
          const key = keyNode(raiz.nome, ch.nome, chPath);
          let a = nodes.get(key);
          if (!a) {
            a = { codigo: ch.codigo || null, nome: ch.nome, depth: Math.max(1, num(ch.depth, 1)),
              disciplina: raiz.nome, questoes: 0, acertos: 0, pctAcerto: 0, children: [],
              _semKey: key, _parentKey: null, _lastFonte: -1 };
            nodes.set(key, a);
          }
          a.questoes += num(ch.questoes); a.acertos += num(ch.acertos);
          if (fonteIdx >= a._lastFonte) {
            a._lastFonte = fonteIdx;
            a.nome = ch.nome; a.codigo = ch.codigo || null; a.depth = Math.max(1, num(ch.depth, 1));
            a.disciplina = raiz.nome;
            a._parentKey = parent && parent._semKey ? parent._semKey : raiz._semKey;
          }
          walk(ch, a, chPath);
        });
        walk(d, raiz, []);
      }));

      roots.forEach(r => { r.children = []; r.pctAcerto = r.questoes > 0 ? r.acertos / r.questoes * 100 : 0; });
      nodes.forEach(n => { n.children = []; n.pctAcerto = n.questoes > 0 ? n.acertos / n.questoes * 100 : 0; });
      const rootByKey = new Map([...roots.values()].map(r => [r._semKey, r]));
      nodes.forEach(n => {
        let p = nodes.get(n._parentKey) || rootByKey.get(n._parentKey);
        if (!p || p === n) p = roots.get(norm(n.disciplina));
        if (p) p.children.push(n);
      });
      const sortRec = n => {
        n.children.sort((a, b) => String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true })
          || a.nome.localeCompare(b.nome, 'pt-BR'));
        n.children.forEach(sortRec);
      };
      roots.forEach(sortRec);
      return [...roots.values()];
    },

    disciplinasDisponiveis() {
      let snap = null;
      try { snap = DesempenhoTecScreen.scopedSnapshot(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-disc-snap'); }
      return this._forestEstavel(snap).map(d => d.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
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
          /* Evita deixar uma "cauda" minúscula sem destino. Se os irmãos
             pequenos que sobraram, SOMADOS entre si, ainda não sustentam a
             margem, eles entram neste mesmo bloco local. Assim a granularidade
             não sobe para o pai só porque sobrou um último ramo de 3–6 questões. */
          const resto = [];
          for (let k = i + 1; k < kids.length; k++) {
            if (usados.has(k) || idxs.includes(k)) continue;
            const cand = kids[k];
            if (!this.legivel(num(cand.questoes), num(cand.acertos), margemMax)) resto.push({ k, cand });
          }
          if (resto.length) {
            const qr = resto.reduce((s, o) => s + num(o.cand.questoes), 0);
            const ar = resto.reduce((s, o) => s + num(o.cand.acertos), 0);
            if (!this.legivel(qr, ar, margemMax)) {
              resto.forEach(o => { grupo.push(o.cand); idxs.push(o.k); });
            }
          }
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
          if (!x || x.taxa == null || x.taxa >= p.metaAcerto || x.nivel <= 0) return;
          const l = this._lacuna(x, p);
          Object.assign(x, l);
          // Estar abaixo de 90% no ponto estimado não basta: o extremo otimista
          // do intervalo também precisa continuar abaixo da meta.
          if (x.gapConfiavel > 0) fila.push(x);
        });
      });
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
      const deficitSeguro = Math.max(0, num(item && item.questoes) * gapConfiavel / 100);
      return { taxa, margem, gapMeta, gapConfiavel, lacunaMeta, deficitSeguro };
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
    _incidenciaDisciplina(nome, mapa) {
      if (!mapa) return 0;
      const porNorm = Object.create(null);
      Object.keys(mapa).forEach(k => {
        const nk = norm(k);
        porNorm[nk] = (porNorm[nk] || 0) + num(mapa[k]);
      });
      const alvo = norm(nome);
      if (porNorm[alvo] != null) return porNorm[alvo];
      try {
        if (typeof PlanoPontos !== 'undefined' && PlanoPontos._casarNomes) {
          const casado = PlanoPontos._casarNomes([alvo], Object.keys(porNorm));
          const k = casado && casado[alvo];
          if (k && porNorm[k] != null) return porNorm[k];
        }
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-inc-disc'); }
      return 0;
    },

    /* MATÉRIA e TÓPICO respondem perguntas diferentes.
       A matéria entra pela lacuna sistêmica da raiz. Só depois o primeiro item
       da fila diz onde entrar dentro dela. Isso impede um bolsão ruim em uma
       matéria de 88% de atropelar outra inteira em 60%. */
    _compararDisciplinas(a, b, p) {
      const A = a || {}, B = b || {};
      if (num(A.faixaPrioridade) !== num(B.faixaPrioridade)) return num(A.faixaPrioridade) - num(B.faixaPrioridade);
      if ((p && p.fase) === 'pos') {
        return num(B.prioridadeDisc) - num(A.prioridadeDisc)
          || num(B.deficitSeguro) - num(A.deficitSeguro)
          || num(B.gapConfiavelDisc) - num(A.gapConfiavelDisc)
          || num(B.questoes) - num(A.questoes);
      }
      return num(B.deficitSeguro) - num(A.deficitSeguro)
        || num(B.gapConfiavelDisc) - num(A.gapConfiavelDisc)
        || num(B.melhorTopico && B.melhorTopico.gapConfiavel) - num(A.melhorTopico && A.melhorTopico.gapConfiavel)
        || num(B.questoes) - num(A.questoes);
    },

    calcular(opts) {
      const p = Object.assign(this.prefs(), opts || {});
      p.disciplinasSel = Array.isArray(p.disciplinasSel) ? p.disciplinasSel.slice() : [];
      p.doseMin = Math.max(this.DEFAULTS.doseMin, num(p.doseMin, this.DEFAULTS.doseMin));
      p.alvoQuestoes = Math.max(p.doseMin, num(p.alvoQuestoes, this.DEFAULTS.alvoQuestoes));
      p.maxFrentes = Math.min(3, Math.max(1, num(p.maxFrentes, 3)));

      let snap = null;
      try { snap = DesempenhoTecScreen.scopedSnapshot(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-snap'); }
      if (!snap || !(snap.rows || []).length) return {
        erro: 'sem-retrato', fase: p.fase, prefs: p, itens: [], todos: [],
        disciplinas: [], disciplinasTodas: [], disciplinasDisponiveis: []
      };

      let forest = this._forestEstavel(snap);
      if (!forest.length) return {
        erro: 'sem-arvore', fase: p.fase, prefs: p, itens: [], todos: [],
        disciplinas: [], disciplinasTodas: [], disciplinasDisponiveis: []
      };
      const disciplinasDisponiveis = forest.map(d => d.nome).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const filtroDisc = new Set(p.disciplinasSel.map(norm).filter(Boolean));
      if (filtroDisc.size) forest = forest.filter(d => filtroDisc.has(norm(d.nome)));

      let banca = '__todas__';
      try { banca = DesempenhoTecScreen.bancaFiltro(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-banca'); }
      let incMap = null, incDisc = null;
      if (p.fase === 'pos') {
        try {
          incMap = ReforcoEngine.incidenceMap(banca);
          incDisc = ReforcoEngine.incidPorDisciplina(banca);
        } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-sug-mapa'); }
        if (!incMap || !Object.keys(incMap).length) {
          return {
            erro: 'sem-incidencia', fase: p.fase, prefs: p, itens: [], todos: [],
            disciplinas: [], disciplinasTodas: [], disciplinasDisponiveis
          };
        }
      }

      const disciplinasTodas = forest.map(d => {
        const fila = this._filaDisciplina(d, p);
        fila.forEach(x => {
          // A incidência de tópico aparece como explicação, mas NÃO reordena a
          // fila interna: pior→melhor da árvore continua mandando.
          x.peso = this._peso(x, p.fase, incMap);
          x.score = x.gapMeta;
          x.prioridade = x.gapConfiavel;
          x.legivel = x.margem != null && x.margem <= p.margemMax;
        });

        const q = num(d.questoes), ac = Math.max(0, Math.min(q, num(d.acertos)));
        const taxa = q > 0 ? ac / q * 100 : null;
        const margemDisc = this.margem(q, ac);
        const dl = this._lacuna({ taxa, margem: margemDisc, questoes: q }, p);
        const incidenciaDisc = p.fase === 'pos' ? this._incidenciaDisciplina(d.nome, incDisc) : null;
        const melhor = fila[0] || null;
        const deficitSeguro = dl.deficitSeguro;
        // correção sistêmica sempre vem antes de manutenção localizada
        const faixaPrioridade = deficitSeguro > 0 ? 0 : 1;
        const basePrioridade = deficitSeguro > 0 ? deficitSeguro : num(melhor && melhor.gapConfiavel);
        const prioridadeDisc = p.fase === 'pos' ? basePrioridade * num(incidenciaDisc) : basePrioridade;
        return {
          nome: d.nome, questoes: q, acertos: ac, taxa,
          taxaErro: taxa == null ? null : 100 - taxa,
          margem: margemDisc,
          gapMetaDisc: dl.gapMeta,
          gapConfiavelDisc: dl.gapConfiavel,
          deficitSeguro,
          incidenciaDisc,
          faixaPrioridade,
          prioridadeDisc,
          fila,
          melhorTopico: melhor,
          score: prioridadeDisc
        };
      });

      const disciplinas = disciplinasTodas.filter(d =>
        d.melhorTopico && (p.fase !== 'pos' || d.incidenciaDisc > 0)
      ).sort((a, b) => this._compararDisciplinas(a, b, p));

      disciplinas.forEach((d, i) => {
        d.rank = i + 1;
        d.fila.forEach((x, j) => { x.disciplinaRank = i + 1; x.ordemNaDisciplina = j + 1; });
      });

      const escolhidas = disciplinas.slice(0, p.maxFrentes);
      const itens = escolhidas.map(d => Object.assign({}, d.melhorTopico, {
        disciplinaTaxa: d.taxa,
        disciplinaMargem: d.margem,
        disciplinaGapSeguro: d.gapConfiavelDisc,
        disciplinaDeficitSeguro: d.deficitSeguro,
        disciplinaIncidencia: d.incidenciaDisc,
        categoriaPrioridade: d.faixaPrioridade === 0 ? 'correcao' : 'manutencao'
      }));
      itens.forEach(x => { x.dose = this._dose(x, p); });

      const todos = [];
      disciplinas.forEach(d => d.fila.forEach(x => todos.push(x)));

      return {
        fase: p.fase, prefs: p, erro: null,
        banca: p.fase === 'pos' ? banca : null,
        criterioDisciplinas: p.fase === 'pos'
          ? 'déficit seguro da matéria × incidência'
          : 'déficit seguro da matéria',
        itens, disciplinas, disciplinasTodas, todos, disciplinasDisponiveis,
        filtroDisciplinas: p.disciplinasSel.slice()
      };

    }
  };

  window.MotorSugestao = M;
})();