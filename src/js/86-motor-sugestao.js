/* ============================================================================
   MOTOR DE SUGESTÃO — fechamento simples de lacunas do TEC
   ----------------------------------------------------------------------------
   Regra deliberadamente simples e auditável:

     1) disciplina: maior distância percentual até a meta vem primeiro, sem
        excluir matéria por volume;
     2) amostra: só decide se um tópico/subtópico é executável;
     3) tópico: dentro da matéria, pior percentual válido vem primeiro;
     4) subtópico pequeno: forma quantos grupos locais forem necessários,
        sempre dos piores para os melhores e sem misturar ramos já fortes;
        só sobe um nível quando não existir mais frente granular executável;
     5) pós-edital: a incidência da banca apenas desempata matérias com a mesma
        lacuna; ela não multiplica nem cria um score escondido.

   Não há intervalo de confiança, margem, "déficit seguro" nem multiplicação
   pelo volume histórico. Questões resolvidas servem para validar o recorte,
   não para dar mais prioridade a quem já foi mais praticado.
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
      minAmostra: 20,         // único freio: abaixo disso o nível é pequeno demais
      alvoQuestoes: 25,       // tamanho fixo de cada atividade
      doseMin: 12,            // compatibilidade com atividades antigas
      maxFrentes: 3,          // disciplinas distintas na rodada
      metaAcerto: 90,
      disciplinasSel: []      // vazio = todas; filtro compartilhado com Extras
    }),
    LIMITES: Object.freeze({
      minAmostra: [5, 200],
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

    suficiente(q, minAmostra) {
      return num(q) >= Math.max(1, num(minAmostra, this.DEFAULTS.minAmostra));
    },
    _pct(node) {
      const q = num(node && node.questoes);
      return q > 0 ? clamp(num(node.acertos) / q * 100, 0, 100) : 100;
    },
    _ordenarFracos(arr) {
      return (arr || []).slice().sort((a, b) =>
        this._pct(a) - this._pct(b) ||
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

    _dataRetrato(s) {
      return String((s && (s.endDate || s.date || s.startDate)) || '');
    },
    retratoAtual() {
      /* A decisão precisa reproduzir o percentual que o aluno está vendo no
         recorte selecionado. Usar apenas o último arquivo fazia um filtro de
         janeiro a setembro decidir somente pela última semana de setembro. */
      try {
        if (DesempenhoTecScreen.scopedSnapshot) {
          const scoped = DesempenhoTecScreen.scopedSnapshot();
          if (scoped) return scoped;
        }
        const snaps = (DesempenhoTecScreen.activeSnapshots
          ? DesempenhoTecScreen.activeSnapshots() : DB.getTecSnapshots()) || [];
        if (!snaps.length) return null;
        if (DesempenhoTecScreen.aggregate) return DesempenhoTecScreen.aggregate(snaps);
        return snaps.length === 1 ? snaps[0] : {
          id: '__motor_scope__', aggregated: true,
          startDate: snaps.map(s => s.startDate || s.date || '').sort()[0],
          endDate: snaps.map(s => s.endDate || s.date || '').sort().slice(-1)[0],
          rows: snaps.flatMap(s => s.rows || []), _fontes: snaps.slice()
        };
      } catch (e) {
        if (typeof _quiet === 'function') _quiet(e, 'motor-retrato-atual');
        return null;
      }
    },

    disciplinasDisponiveis() {
      let snap = null;
      try { snap = this.retratoAtual(); }
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

    /* Planeja um ramo usando apenas um piso de questões.
       - desce primeiro até a menor granularidade executável;
       - um filho suficiente segue sozinho (ou aprofunda nos próprios filhos);
       - irmãos pequenos e fracos formam vários blocos locais, dos piores para
         os melhores; uma sobra pequena é absorvida pelo último bloco para não
         criar uma frente inviável;
       - irmãos que já atingiram a meta não entram para "encher" amostra;
       - o pai só aparece quando TODO o nível inferior fraco, somado, continua
         insuficiente e não existe outra frente granular naquele ramo. */
    _planejarNo(node, minAmostra, caminho, metaAcerto) {
      if (!node || num(node.depth) <= 0) return [];
      const piso = Math.max(1, num(minAmostra, this.DEFAULTS.minAmostra));
      const meta = clamp(metaAcerto == null ? this.DEFAULTS.metaAcerto : metaAcerto, 0, 100);
      const proprioSuficiente = this.suficiente(node.questoes, piso);
      const kids = this._ordenarFracos((node.children || []).filter(x => num(x.questoes) > 0));
      const aqui = (caminho || []).concat([node.nome]).filter(Boolean);

      if (!kids.length) {
        return proprioSuficiente && this._pct(node) < meta
          ? [this._item(node, { caminho: aqui.slice(0, -1) })] : [];
      }

      /* Cada filho direto abre um ramo. As sugestões de um ramo permanecem
         contíguas: não reordenamos folhas de pais diferentes pelo percentual
         individual, pois isso faria o caderno saltar pela árvore do TEC. */
      const ordemKid = new Map(kids.map((x, i) => [x, i]));
      const unidades = [];
      kids.filter(x => this.suficiente(x.questoes, piso)).forEach(filho => {
        const fundo = this._planejarNo(filho, piso, aqui, meta);
        if (fundo.length) unidades.push({ ordem: ordemKid.get(filho), itens: fundo });
        else if (this._pct(filho) < meta) {
          unidades.push({ ordem: ordemKid.get(filho), itens: [
            this._item(filho, { caminho: aqui, motivoNivel: 'subnivel-sem-frente-fraca' })
          ] });
        }
      });

      const pequenos = kids.filter(x => !this.suficiente(x.questoes, piso) && this._pct(x) < meta);
      const qPequenos = pequenos.reduce((sum, x) => sum + num(x.questoes), 0);
      if (qPequenos >= piso) {
        let grupo = [], qGrupo = 0, restante = qPequenos;
        pequenos.forEach(filho => {
          grupo.push(filho);
          qGrupo += num(filho.questoes);
          restante -= num(filho.questoes);
          /* Só fecha o bloco se a sobra também conseguir formar outro. Caso
             contrário, absorve a cauda e evita uma sugestão órfã < piso. */
          if (qGrupo >= piso && (restante === 0 || restante >= piso)) {
            unidades.push({ ordem: ordemKid.get(grupo[0]), itens: [this._grupo(node, grupo, caminho)] });
            grupo = []; qGrupo = 0;
          }
        });
        if (grupo.length && qGrupo >= piso) {
          unidades.push({ ordem: ordemKid.get(grupo[0]), itens: [this._grupo(node, grupo, caminho)] });
        }
      }

      const plano = unidades.sort((a, b) => num(a.ordem) - num(b.ordem)).flatMap(x => x.itens);
      if (!plano.length && proprioSuficiente && this._pct(node) < meta) {
        return [this._item(node, {
          caminho: (caminho || []).slice(),
          motivoNivel: 'subnivel-insuficiente'
        })];
      }
      return plano;
    },

    _filaDisciplina(disc, p) {
      const tops = this._ordenarFracos((disc.children || []).filter(x => num(x.questoes) > 0));
      const fila = [];
      tops.forEach(top => {
        const plano = this._planejarNo(top, p.minAmostra, [], p.metaAcerto);
        plano.forEach(x => {
          if (!x || x.taxa == null || x.taxa >= p.metaAcerto || x.nivel <= 0) return;
          Object.assign(x, this._lacuna(x, p));
          x.score = x.gapMeta;
          x.prioridade = x.gapMeta;
          x.legivel = this.suficiente(x.questoes, p.minAmostra);
          fila.push(x);
        });
      });
      /* `tops` já está do pior pai para o melhor e cada plano veio em travessia
         hierárquica. Uma ordenação global aqui misturaria ramos distintos. */
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
      const gapMeta = Math.max(0, num(p.metaAcerto, this.DEFAULTS.metaAcerto) - taxa);
      return { taxa, gapMeta, lacuna: gapMeta };
    },
    _dose(item, p) {
      const piso = Math.max(this.DEFAULTS.doseMin, num(p.doseMin, this.DEFAULTS.doseMin));
      const base = Math.max(piso, num(p.alvoQuestoes, this.DEFAULTS.alvoQuestoes));
      return base;
    },
    dosar(itens, alvo, doseMin) {
      const p = Object.assign(this.prefs(), {
        alvoQuestoes: Math.max(num(alvo, this.DEFAULTS.alvoQuestoes), num(doseMin, this.DEFAULTS.doseMin)),
        doseMin: Math.max(this.DEFAULTS.doseMin, num(doseMin, this.DEFAULTS.doseMin))
      });
      return (itens || []).map(x => Object.assign(x, { dose: this._dose(x, p) }));
    },
    _casarNome(alvoBruto, candidatosBrutos) {
      const alvo = norm(alvoBruto);
      const candidatos = (candidatosBrutos || []).map(x => ({ bruto: x, n: norm(x) })).filter(x => x.n);
      const exato = candidatos.find(x => x.n === alvo);
      if (exato) return exato.bruto;
      const tokens = alvo.split(' ').filter(t => t.length >= 3);
      if (!tokens.length) return null;
      const compativeis = candidatos.filter(x => {
        const ts = x.n.split(' ').filter(t => t.length >= 3);
        return tokens.every(t => ts.some(u => u === t || (t.length >= 4 && u.startsWith(t)) || (u.length >= 4 && t.startsWith(u))));
      });
      return compativeis.length === 1 ? compativeis[0].bruto : null;
    },
    _incidenciaDisciplina(nome, mapa) {
      if (!mapa) return 0;
      const porNorm = Object.create(null);
      const brutoPorNorm = Object.create(null);
      Object.keys(mapa).forEach(k => {
        const nk = norm(k);
        porNorm[nk] = (porNorm[nk] || 0) + num(mapa[k]);
        if (!brutoPorNorm[nk]) brutoPorNorm[nk] = k;
      });
      const alvo = norm(nome);
      if (porNorm[alvo] != null) return porNorm[alvo];
      const casado = this._casarNome(nome, Object.keys(mapa));
      return casado ? num(mapa[casado]) : 0;
    },

    /* A ordem da matéria é a conta que o aluno faria de cabeça:
       meta - aproveitamento. Volume não multiplica prioridade. No pós-edital,
       incidência só desempata lacunas iguais. */
    _compararDisciplinas(a, b, p) {
      const A = a || {}, B = b || {};
      const porLacuna = num(B.lacunaDisc) - num(A.lacunaDisc);
      if (porLacuna) return porLacuna;
      if ((p && p.fase) === 'pos') {
        const porIncidencia = num(B.incidenciaDisc) - num(A.incidenciaDisc);
        if (porIncidencia) return porIncidencia;
      }
      return num(A.taxa, 100) - num(B.taxa, 100)
        || String(A.nome || '').localeCompare(String(B.nome || ''), 'pt-BR');
    },

    estadoAtual(origem, opts) {
      const o = origem || {};
      let snap = null;
      try { snap = this.retratoAtual(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-estado-snap'); }
      if (!snap || !(snap.rows || []).length) return null;
      const forest = this._forestEstavel(snap);
      const kd = norm(o.disciplina || '');
      const disc = forest.find(d => norm(d.nome) === kd) || null;
      if (!disc) return null;

      const nodes = [];
      const walk = (n, caminho) => {
        const atual = (caminho || []).concat([n.nome]).filter(Boolean);
        if (num(n.depth) > 0) nodes.push({ n, caminho: atual });
        (n.children || []).forEach(ch => walk(ch, atual));
      };
      (disc.children || []).forEach(ch => walk(ch, []));

      const membros = (o.escopo && Array.isArray(o.escopo.membros) && o.escopo.membros.length)
        ? o.escopo.membros : (Array.isArray(o.membros) ? o.membros : null);
      if (membros && membros.length > 1) {
        const set = new Set(membros.map(norm));
        const encontrados = nodes.filter(x => set.has(norm(x.n.nome)));
        if (!encontrados.length) return null;
        const q = encontrados.reduce((a, x) => a + num(x.n.questoes), 0);
        const ac = encontrados.reduce((a, x) => a + num(x.n.acertos), 0);
        return {
          disciplina: disc.nome,
          nome: o.topico || o.nome || encontrados.map(x => x.n.nome).join(' + '),
          questoes: q, acertos: ac, taxa: q > 0 ? ac / q * 100 : null,
          nivel: Math.max(...encontrados.map(x => num(x.n.depth))),
          membros: encontrados.map(x => x.n.nome),
          agregado: true
        };
      }

      const alvo = norm(o.topico || o.nome || '');
      let candidatos = nodes.filter(x => norm(x.n.nome) === alvo);
      const caminhoOrig = Array.isArray(o.caminho) ? o.caminho.map(norm).filter(Boolean) : [];
      if (candidatos.length > 1 && caminhoOrig.length) {
        const porCaminho = candidatos.filter(x => {
          const c = x.caminho.slice(0, -1).map(norm);
          return caminhoOrig.every((k, i) => c[i] === k);
        });
        if (porCaminho.length) candidatos = porCaminho;
      }
      const achou = candidatos.sort((a, b) => num(b.n.questoes) - num(a.n.questoes))[0];
      if (!achou) return null;
      const q = num(achou.n.questoes), ac = num(achou.n.acertos);
      return {
        disciplina: disc.nome, nome: achou.n.nome, questoes: q, acertos: ac,
        taxa: q > 0 ? ac / q * 100 : null, nivel: num(achou.n.depth),
        caminho: achou.caminho.slice(0, -1), membros: null, agregado: false
      };
    },
    mesmaUnidade(origem, item) {
      if (!origem || !item) return false;
      if (norm(origem.disciplina || '') && norm(item.disciplina || '')
          && norm(origem.disciplina) !== norm(item.disciplina)) return false;
      const ko = norm(origem.topico || origem.nome || '');
      if (ko && ko === norm(item.nome || '')) return true;
      const a = (origem.escopo && origem.escopo.membros) || origem.membros || [];
      const b = item.membros || [];
      const sa = new Set(a.map(norm)), sb = new Set(b.map(norm));
      if (sa.size && sb.size) return [...sa].some(x => sb.has(x));
      if (sa.size && sa.has(norm(item.nome || ''))) return true;
      if (sb.size && sb.has(ko)) return true;
      return false;
    },

    calcular(opts) {
      const p = Object.assign(this.prefs(), opts || {});
      p.disciplinasSel = Array.isArray(p.disciplinasSel) ? p.disciplinasSel.slice() : [];
      p.doseMin = Math.max(this.DEFAULTS.doseMin, num(p.doseMin, this.DEFAULTS.doseMin));
      p.alvoQuestoes = Math.max(p.doseMin, num(p.alvoQuestoes, this.DEFAULTS.alvoQuestoes));
      p.maxFrentes = Math.min(3, Math.max(1, num(p.maxFrentes, 3)));

      let snap = null;
      try { snap = this.retratoAtual(); }
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
          x.peso = this._peso(x, p.fase, incMap); // explicação; não vira score
        });

        const q = num(d.questoes), ac = Math.max(0, Math.min(q, num(d.acertos)));
        const taxa = q > 0 ? ac / q * 100 : null;
        /* A amostra mínima governa somente a granularidade da frente. Uma
           matéria com poucas questões continua no ranking pelo percentual do
           TEC; quantidade não pesa nem exclui a disciplina. */
        const amostraValida = q > 0;
        const amostraMinima = this.suficiente(q, p.minAmostra);
        const lacunaDisc = (amostraValida && taxa != null)
          ? Math.max(0, num(p.metaAcerto) - taxa)
          : 0;
        const incidenciaDisc = p.fase === 'pos' ? this._incidenciaDisciplina(d.nome, incDisc) : null;
        const melhor = fila[0] || null;
        return {
          nome: d.nome, questoes: q, acertos: ac, taxa,
          taxaErro: taxa == null ? null : 100 - taxa,
          amostraValida, amostraMinima,
          lacunaDisc,
          incidenciaDisc,
          fila,
          melhorTopico: melhor,
          score: lacunaDisc
        };
      });

      const disciplinas = disciplinasTodas.filter(d =>
        d.lacunaDisc > 0 && (p.fase !== 'pos' || d.incidenciaDisc > 0)
      ).sort((a, b) => this._compararDisciplinas(a, b, p));

      disciplinas.forEach((d, i) => {
        d.rank = i + 1;
        d.fila.forEach((x, j) => { x.disciplinaRank = i + 1; x.ordemNaDisciplina = j + 1; });
      });

      const disciplinasAcionaveis = disciplinas.filter(d => d.melhorTopico);
      disciplinasAcionaveis.forEach((d, i) => {
        d.rankAcionavel = i + 1;
        d.fila.forEach(x => { x.disciplinaRankAcionavel = i + 1; });
      });
      const escolhidas = disciplinasAcionaveis.slice(0, p.maxFrentes);
      const itens = escolhidas.map(d => Object.assign({}, d.melhorTopico, {
        disciplinaTaxa: d.taxa,
        disciplinaLacuna: d.lacunaDisc,
        disciplinaAmostraValida: d.amostraValida,
        disciplinaIncidencia: d.incidenciaDisc
      }));
      itens.forEach(x => { x.dose = this._dose(x, p); });

      const todos = [];
      disciplinas.forEach(d => d.fila.forEach(x => todos.push(x)));

      return {
        fase: p.fase, prefs: p, erro: null,
        banca: p.fase === 'pos' ? banca : null,
        criterioDisciplinas: p.fase === 'pos'
          ? 'maior lacuna para a meta; incidência desempata'
          : 'maior lacuna para a meta',
        itens, disciplinas, disciplinasAcionaveis, disciplinasTodas, todos, disciplinasDisponiveis,
        filtroDisciplinas: p.disciplinasSel.slice()
      };

    }
  };

  window.MotorSugestao = M;
})();
