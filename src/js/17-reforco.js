/* ============================================================
   REFORÇO INTELIGENTE — cruza seus pontos fracos (TEC) com a
   incidência da banca para sugerir onde você GANHA MAIS PONTOS.
   ============================================================ */
const ReforcoEngine = {
  norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  },
  // Parseia uma tabela de incidência colada/enviada. Se 'bancaFixa' for informada,
  // as colunas são [Disciplina, Tópico, Incidência]; senão a 1ª coluna é a Banca.
  parseIncidencia(text, bancaFixa) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\u00a0/g, ' ')).filter(l => l.trim() !== '');
    // detecta separador: TAB > ; > , > 2+ espaços (fallback via TecEngine.splitLine)
    const split = (l) => {
      if (l.includes('\t')) return l.split('\t').map(c => c.trim());
      if (l.includes(';')) return l.split(';').map(c => c.trim());
      if ((l.match(/,/g) || []).length >= 2) return l.split(',').map(c => c.trim());
      return TecEngine.splitLine(l);
    };
    return this.parseIncidenciaCells(lines.map(split), bancaFixa);
  },
  // Detecta o modelo "Índice do Caderno" do TecConcursos (planilha de incidência da banca):
  //   Hierarquia | Índice | Quantidade encontrada | Porcentagem | Qtd no caderno | Porcentagem | Freq. Acumulada
  // Nesse modelo a 1ª coluna é o código (01, 01.01...), a 2ª é o nome do tópico e a 3ª ("Quantidade
  // encontrada") é a INCIDÊNCIA (nº de questões do tópico no histórico da banca).
  _looksLikeIndiceCaderno(cellRows) {
    let codigoRows = 0;
    for (let i = 0; i < cellRows.length && i < 60; i++) {
      const cells = (cellRows[i] || []).map(c => String(c == null ? '' : c).trim());
      const joined = this.norm(cells.join(' '));
      if (/quantidade encontrada|frequencia acumulada|indice do caderno/.test(joined)) return true;
      if (/\bhierarquia\b/.test(joined) && /\bindice\b/.test(joined)) return true;
      // modelo curto (novo histórico de cobrança): "Hierarquia · Índice · Quantidade · Porcentagem"
      if (/\bquantidade\b/.test(joined) && /\bporcentagem\b/.test(joined)) return true;
      if (/\bindice\b/.test(joined) && /\bporcentagem\b/.test(joined)) return true;
      // sinal estrutural: código na 1ª coluna + nome (não numérico) na 2ª
      if (cells.length >= 3 && /^\d+(\.\d+)*$/.test(cells[0]) && cells[1] && TecEngine.parseNum(cells[1]) === null) codigoRows++;
    }
    return codigoRows >= 3;
  },
  // Converte o modelo hierárquico em registros de incidência, reaproveitando o MESMO parser
  // hierárquico do Desempenho (código col A, nome col B, números a partir de C).
  // Linhas de TOTAL/RESUMO do índice do caderno que NÃO são disciplinas
  // (ex.: "Total assuntos por relevância", "Total geral"). Se entrassem, virariam
  // uma "disciplina" fantasma e o pai passaria a somar tudo → contagem e reforço quebrados.
  _isTotalRow(nome) {
    const k = this.norm(nome);
    return /^total\b/.test(k) || /total\s+(assunto|geral|de\s+assunto|por\s+relev)/.test(k)
        || /frequencia\s+acumulada/.test(k) || /^indice\s+do\s+caderno$/.test(k);
  },
  // "Sem Classificação" é um balde genérico do índice do TEC (questões sem assunto próprio).
  // Não é um tópico acionável de estudo — marcamos para rebaixar no ranking.
  _isSemClass(nome) {
    const k = this.norm(nome);
    return /sem\s+classifica/.test(k) || /nao\s+classificad/.test(k) || /outros\s*$/.test(k);
  },
  _parseIndiceCaderno(cellRows, bancaFixa) {
    const banca = (bancaFixa || 'X');
    const rows = TecEngine.parseCellRows(cellRows); // r.questoes = 1º número = "Quantidade encontrada"
    const out = [];
    for (const r of rows) {
      const incid = r.questoes; // Quantidade encontrada = incidência da banca
      if (!r.nome || incid == null) continue;
      // ignora linhas de total/resumo (só quando NÃO têm código — disciplina/raiz)
      if ((r.codigo == null || r.codigo === '') && this._isTotalRow(r.nome)) continue;
      out.push({
        banca: banca.trim(),
        disciplina: (r.depth === 0 ? r.nome : (r.disciplina || '')).trim(),
        topico: r.nome.trim(),
        incidencia: Math.max(0, incid),
        codigo: r.codigo || null,
        depth: r.depth,
        // % do assunto na prova (col "Porcentagem"). Serve p/ reconstruir o total do
        // caderno quando houver questões "sem classificação" fora do índice.
        pct: (r.pctAcerto != null ? r.pctAcerto : null)
      });
    }
    return out;
  },
  parseIncidenciaCells(cellRows, bancaFixa) {
    // 1) Modelo hierárquico "Índice do Caderno" (planilha padrão de incidência da banca)
    if (this._looksLikeIndiceCaderno(cellRows)) {
      return this._parseIndiceCaderno(cellRows, bancaFixa);
    }
    // 2) Formato plano/colado: [Disciplina, Tópico, Incidência] ou [Banca, Disciplina, Tópico, Incidência]
    const out = [];
    let skippedHeader = false;
    for (let cells of cellRows) {
      cells = (cells || []).map(c => String(c == null ? '' : c).trim());
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (cells.length < 2) continue;
      const joined = cells.join(' ').toLowerCase();
      if (!skippedHeader && /(disciplina|t[óo]pico|incid[êe]ncia|banca|mat[ée]ria)/.test(joined) && !/^\d/.test(cells[cells.length - 1])) {
        skippedHeader = true; continue;
      }
      let banca, disciplina, topico, incid;
      if (bancaFixa) {
        banca = bancaFixa;
        if (cells.length >= 3) { disciplina = cells[0]; topico = cells[1]; incid = TecEngine.parseNum(cells[2]); }
        else { disciplina = ''; topico = cells[0]; incid = TecEngine.parseNum(cells[1]); }
      } else {
        if (cells.length >= 4) { banca = cells[0]; disciplina = cells[1]; topico = cells[2]; incid = TecEngine.parseNum(cells[3]); }
        else if (cells.length === 3) { banca = cells[0]; disciplina = ''; topico = cells[1]; incid = TecEngine.parseNum(cells[2]); }
        else continue;
      }
      if (!topico || incid == null) continue;
      out.push({ banca: (banca || '').trim(), disciplina: (disciplina || '').trim(), topico: topico.trim(), incidencia: Math.max(0, incid) });
    }
    return out;
  },
  // Mapa normKey(topico) -> incidência total, para a banca escolhida ('__todas__' soma tudo)
  incidenceMap(banca) {
    const map = {};
    DB.getIncidencia().forEach(r => {
      if (banca && banca !== '__todas__' && this.norm(r.banca) !== this.norm(banca)) return;
      const k = this.norm(r.topico);
      map[k] = (map[k] || 0) + (r.incidencia || 0);
    });
    return map;
  },
  hasIncidencia() { return DB.getIncidencia().length > 0; },
  // O retrato TEC mais recente é considerado "nível atual" se for dos últimos 90 dias.
  currentSnapshot() {
    const snaps = DB.getTecSnapshots();
    if (!snaps.length) return null;
    return snaps[snaps.length - 1]; // já vêm ordenados por data
  },
  isFresh(snap, days) {
    if (!snap) return false;
    const ref = snap.endDate || snap.date || snap.startDate;
    if (!ref) return true;
    const d = (Date.now() - new Date(ref + 'T00:00:00').getTime()) / 86400000;
    return d <= (days || 90);
  },
  // pesos estatísticos
  confianca(questoes) { return questoes / (questoes + 8); }, // shrinkage: pouca amostra pesa menos
  zonaVirada(pctAcerto) {
    // ganho marginal maior na "zona de virada" (~55% de acerto); nunca zera de todo
    const a = pctAcerto / 100;
    const w = Math.exp(-Math.pow(a - 0.55, 2) / (2 * 0.22 * 0.22));
    return 0.6 + 0.4 * w;
  },
  // Gera as sugestões de reforço, ranqueadas.
  // opts: { banca, estrategia(0..1), minQuestoes, limite, apenasFolhas }
  suggest(snap, opts) {
    opts = opts || {};
    if (!snap) return { fresh: false, items: [], semIncidencia: 0 };
    const banca = opts.banca || '__todas__';
    const s = (opts.estrategia != null) ? opts.estrategia : 0.5;
    const minQ = opts.minQuestoes || 5;
    const apenasFolhas = opts.apenasFolhas !== false;
    const map = this.incidenceMap(banca);
    const hasAnyIncid = Object.keys(map).length > 0;
    const wE = 1.3 - 0.8 * s; // peso do erro
    const wI = 0.5 + 0.8 * s; // peso da incidência

    // tópicos-folha com volume mínimo
    let rows = snap.rows.filter(r => r.depth > 0 && r.questoes >= minQ);
    if (apenasFolhas) {
      rows = rows.filter(r => {
        if (!r.codigo) return true;
        return !snap.rows.some(o => o !== r && o.disciplina === r.disciplina && o.codigo && o.codigo.startsWith(r.codigo + '.'));
      });
    }
    let semIncidencia = 0;
    const items = rows.map(r => {
      const taxaErro = Math.max(0, 1 - (r.pctAcerto || 0) / 100);
      const key = this.norm(r.nome);
      const incidReal = map[key];
      const temIncid = incidReal != null;
      if (!temIncid) semIncidencia++;
      // incidência efetiva p/ o score: real, ou baseline 1 quando não há dado do tópico
      const incidEff = temIncid ? incidReal : 1;
      const conf = this.confianca(r.questoes);
      const zona = this.zonaVirada(r.pctAcerto || 0);
      const score = Math.pow(incidEff, wI) * Math.pow(taxaErro + 0.001, wE) * conf * zona;
      const pontosRecuperaveis = Math.round((temIncid ? incidReal : 0) * taxaErro * 10) / 10;
      return {
        codigo: r.codigo, nome: r.nome, disciplina: r.disciplina,
        questoes: r.questoes, acertos: r.acertos, pctAcerto: r.pctAcerto,
        erros: r.questoes - r.acertos, taxaErro: Math.round(taxaErro * 1000) / 10,
        incidencia: temIncid ? incidReal : null, temIncid,
        pontosRecuperaveis, score
      };
    }).filter(it => it.taxaErro > 0) // só faz sentido reforçar onde há erro
      .sort((a, b) => b.score - a.score);
    const limite = opts.limite || items.length;
    return {
      fresh: this.isFresh(snap, 90), snapDate: snap.endDate || snap.date,
      hasAnyIncid, semIncidencia,
      items: items.slice(0, limite), totalCandidatos: items.length
    };
  },
  // ============================================================================
  // REFORÇO POR FRONTEIRA ADAPTATIVA  (modelo validado com dados reais)
  // Cruza a INCIDÊNCIA da banca (árvore hierárquica: pai = soma dos filhos) com o
  // DESEMPENHO (retrato do escopo). Para cada RAMO escolhe a MELHOR granularidade.
  //   • Partição LIMPA (0 sobreposição pai↔filho) → sem dupla contagem de questões.
  //   • Casamento por: código TEC → nome normalizado → dicionário de equivalência.
  //   • Separa 🔥 pontos fracos (amostra real) de 🕳️ pontos cegos (pouca prática)
  //     e ⚖️ sobre-investimento (esforço >> peso na banca).
  // ============================================================================
  // Dicionário de equivalência de nomes de disciplina/tópico (variações comuns)
  SINONIMOS: {
    'portugues': 'lingua portuguesa',
    'lingua portuguesa portugues': 'lingua portuguesa',
    'dir tributario': 'direito tributario',
    'dir constitucional': 'direito constitucional',
    'dir administrativo': 'direito administrativo',
    'afo': 'administracao financeira e orcamentaria',
    'conta geral': 'contabilidade geral',
    'rlm': 'raciocinio logico matematico'
  },
  _canon(nome) {
    const k = this.norm(nome);
    return this.SINONIMOS[k] || k;
  },
  _depth(codigo) { return (codigo == null || codigo === '') ? 0 : String(codigo).split('.').length; },
  // Índice do desempenho por nome canônico → { q, ac, err, pac }
  _perfIndex(snap) {
    const idx = {};
    (snap && snap.rows || []).forEach(r => {
      const k = this._canon(r.nome);
      const cur = idx[k] || { q: 0, ac: 0 };
      cur.q += (r.questoes || 0); cur.ac += (r.acertos || 0);
      idx[k] = cur;
    });
    Object.values(idx).forEach(v => { v.err = v.q > 0 ? (v.q - v.ac) / v.q : 0; v.pac = v.q > 0 ? v.ac / v.q : 0; });
    return idx;
  },
  // Incidência agrupada por disciplina (uma banca), normalizando o campo de nome (topico)
  _incidByDisc(banca) {
    const by = {};
    DB.getIncidencia().forEach(r => {
      if (banca && banca !== '__todas__' && this.norm(r.banca) !== this.norm(banca)) return;
      const row = {
        codigo: (r.codigo == null || r.codigo === '') ? null : String(r.codigo),
        nome: r.topico || r.nome || '',
        disciplina: r.disciplina,
        incidencia: (r.incidencia != null ? r.incidencia : 0)
      };
      (by[r.disciplina] = by[r.disciplina] || []).push(row);
    });
    return by;
  },
  _children(rows, code) {
    if (code == null) return rows.filter(r => r.codigo && this._depth(r.codigo) === 1).sort((a, b) => a.codigo.localeCompare(b.codigo));
    const d = this._depth(code);
    return rows.filter(r => r.codigo && r.codigo.indexOf(code + '.') === 0 && this._depth(r.codigo) === d + 1).sort((a, b) => a.codigo.localeCompare(b.codigo));
  },
  _leavesUnder(rows, code) {
    // folhas atômicas (sem filhos) sob um nó — usadas p/ os "pontos recuperáveis" sem dupla contagem
    return rows.filter(r => {
      if (r.codigo == null) return false;
      const under = (code == null) ? true : (r.codigo === code || r.codigo.indexOf(code + '.') === 0);
      if (!under) return false;
      return !rows.some(o => o.codigo && o.codigo !== r.codigo && o.codigo.indexOf(r.codigo + '.') === 0);
    });
  },
  _smoothErr(q, err, mbar, ebar) { mbar = mbar || 8; ebar = (ebar != null ? ebar : 0.30); return (err * q + ebar * mbar) / (q + mbar); },
  _zona(pac) { const w = Math.exp(-Math.pow(pac - 0.55, 2) / (2 * 0.22 * 0.22)); return 0.6 + 0.4 * w; },
  /* suggestFrontier(snap, opts)
     opts: banca, estrategia(0..1), granularidade(0..1), minQuestoes, incidMin, limite */
  suggestFrontier(snap, opts) {
    opts = opts || {};
    if (!snap) return { fresh: false, items: [], blindSpots: [], overinvest: [], hasAnyIncid: false, semIncidencia: 0, projAtual: 0, projPotencial: 0, cobertura: 0, totalErros: 0, totalCegos: 0, totalUnidades: 0 };
    const s = (opts.estrategia != null) ? opts.estrategia : 0.5;
    const g = (opts.granularidade != null) ? opts.granularidade : 0.5;
    const Qmin = opts.minQuestoes || 10;
    const Imin = opts.incidMin || 5;
    const limite = opts.limite || 12;
    const banca = opts.banca || '__todas__';

    const byDisc = this._incidByDisc(banca);
    const hasAnyIncid = Object.keys(byDisc).length > 0;
    const perf = this._perfIndex(snap);
    const qOf = (n) => { const v = perf[this._canon(n)]; return v ? v.q : 0; };
    const errOf = (n) => { const v = perf[this._canon(n)]; return v ? v.err : null; };
    const pacOf = (n) => { const v = perf[this._canon(n)]; return v ? v.pac : 0; };

    // granularidade → profundidade máx. e "avidez" de descida
    //   g≈0  (Disciplina) → maxDepth 0  → nunca desce: unidades = disciplinas
    //   g≈0.5(Assunto)    → maxDepth 2  → desce até assunto (adaptativo por ramo)
    //   g≈1  (Tópico)     → maxDepth 3  → desce até o tópico específico
    const maxDepth = Math.round(g * 3);
    const splitQ = (2 - g) * Qmin;   // no meio, só desce quando há amostra suficiente
    const splitN = (2 - g) * Imin;   // e incidência relevante no filho

    // ---- FRONTEIRA: partição limpa (cada folha pertence a UMA só unidade) ----
    const units = [];
    Object.keys(byDisc).forEach(disc => {
      const rows = byDisc[disc];
      const discRow = rows.find(r => r.codigo == null) || { codigo: null, nome: disc, disciplina: disc, incidencia: rows.reduce((a, r) => a + (r.incidencia || 0), 0) };
      const rec = (node) => {
        const code = (node.codigo == null || node.codigo === '') ? null : node.codigo;
        const dep = this._depth(code);
        const ch = this._children(rows, code);
        const q = qOf(node.nome);
        const split = dep < maxDepth && ch.length && q >= splitQ && (node.incidencia || 0) >= splitN;
        if (split) ch.forEach(rec);
        else units.push({ disciplina: disc, codigo: code, nome: node.nome, N: (node.incidencia || 0), _rows: rows });
      };
      rec(discRow);
    });

    // métricas por unidade
    units.forEach(u => {
      u.q = qOf(u.nome); const e = errOf(u.nome);
      u.err = e; u.pac = pacOf(u.nome);
      u.errS = this._smoothErr(u.q, e == null ? 0.30 : e);
    });
    const totalN = units.reduce((a, u) => a + u.N, 0) || 1;
    const totalQ = units.reduce((a, u) => a + u.q, 0) || 1;
    units.forEach(u => { u.shareBanca = u.N / totalN; u.shareEsforco = u.q / totalQ; });

    // score mesclado — slider erro↔incidência preservado
    const wE = 1.3 - 0.8 * s, wI = 0.5 + 0.8 * s;
    const score = (u) => Math.pow(Math.max(u.N, 0.001), wI) * Math.pow(u.errS + 0.001, wE) * this._zona(u.pac);

    // pontos recuperáveis (teto 90%) somando as folhas cobertas sob a unidade — sem dupla contagem
    const CEIL = 0.90;
    const recuperaveis = (u) => {
      const leaves = this._leavesUnder(u._rows, u.codigo);
      let g2 = 0;
      leaves.forEach(lf => { const p = pacOf(lf.nome); if (qOf(lf.nome) > 0) g2 += lf.incidencia * Math.max(0, CEIL - p); });
      // fallback: se a unidade é folha/sem filhos cobertos, usa a própria
      if (g2 === 0 && u.q > 0) g2 = u.N * Math.max(0, CEIL - u.pac);
      return g2;
    };

    // ---- 3 grupos ----
    const mainPool = units.filter(u => u.q >= Qmin && u.err != null && u.err > 0);
    const blindPool = units.filter(u => u.q < Qmin && u.N >= Imin).sort((a, b) => b.N - a.N);
    const overinvest = units.filter(u => u.q >= Qmin && u.shareEsforco > 2 * u.shareBanca + 0.005)
      .sort((a, b) => (b.shareEsforco - b.shareBanca) - (a.shareEsforco - a.shareBanca));

    // "share" de erro e de incidência da unidade (para descobrir o FATOR DOMINANTE na ordem)
    const maxErr = Math.max(0.01, ...mainPool.map(u => u.errS));
    const maxN = Math.max(1, ...mainPool.map(u => u.N));
    // constrói um item padronizado (com motivo #3 e flag sem-classificação #4)
    const buildItem = (u) => {
      const rec = recuperaveis(u);
      const relErro = u.errS / maxErr;   // 0..1 — quão forte é o erro deste tópico
      const relIncid = u.N / maxN;       // 0..1 — quão forte é a incidência
      // motivo: o que mais "puxou" o item para cima (com o peso atual da estratégia)
      const contribErro = Math.pow(relErro, wE);
      const contribIncid = Math.pow(relIncid, wI);
      let motivo = 'equilibrio';
      if (contribIncid > contribErro * 1.35) motivo = 'incidencia';
      else if (contribErro > contribIncid * 1.35) motivo = 'erro';
      return {
        codigo: u.codigo, nome: u.nome, disciplina: u.disciplina,
        incidencia: u.N, questoes: u.q, acertos: Math.round(u.pac * u.q),
        erros: Math.round((1 - u.pac) * u.q),
        taxaErro: Math.round((u.err || 0) * 1000) / 10,
        pctAcerto: Math.round(u.pac * 1000) / 10,
        pontosRecuperaveis: Math.round(rec * 10) / 10,
        score: score(u),
        selo: (u.err >= 0.30 ? 'fraco' : (u.err >= 0.15 ? 'atencao' : 'ok')),
        nivel: this._depth(u.codigo),
        temIncid: u.N > 0,
        motivo,                                   // #3 fator dominante
        semClass: this._isSemClass(u.nome)        // #4 "Sem Classificação"
      };
    };
    // ordenação conforme #1: 'oportunidade' (score) | 'erro' | 'incidencia'
    const ordenarPor = opts.ordenarPor || 'oportunidade';
    // desempate final ESTÁVEL (nome) para ordem 100% determinística entre recálculos
    const tie = (a, b) => (a.nome || '').localeCompare((b.nome || ''), 'pt-BR');
    const sortFn = (a, b) => {
      // "Sem Classificação" sempre por último (é um balde genérico, pouco acionável)
      if (a.semClass !== b.semClass) return a.semClass ? 1 : -1;
      if (ordenarPor === 'erro') return b.taxaErro - a.taxaErro || b.incidencia - a.incidencia || tie(a, b);
      if (ordenarPor === 'incidencia') return b.incidencia - a.incidencia || b.taxaErro - a.taxaErro || tie(a, b);
      return b.score - a.score || b.incidencia - a.incidencia || tie(a, b); // oportunidade (padrão)
    };
    const allItems = mainPool.map(buildItem).sort(sortFn);
    const items = allItems.slice(0, limite);

    // ---- agrupa POR DISCIPLINA (para a visão direcionada) ----
    const topPorDisc = opts.topPorDisc || 5;
    const discMap = {};
    // acumula estatísticas da disciplina a partir das UNIDADES cobertas (média ponderada correta)
    covered_forEach: {
      units.forEach(u => {
        const d = u.disciplina || '—';
        const g = discMap[d] || (discMap[d] = { disciplina: d, incidencia: 0, questoes: 0, acertos: 0, itens: [], cegos: [], over: [], pontosRec: 0 });
        g.incidencia += u.N;
        if (u.q > 0) { g.questoes += u.q; g.acertos += u.pac * u.q; }
      });
    }
    allItems.forEach(it => { const g = discMap[it.disciplina]; if (g) { g.itens.push(it); g.pontosRec += it.pontosRecuperaveis; } });
    blindPool.forEach(u => { const g = discMap[u.disciplina]; if (g) g.cegos.push({ nome: u.nome, incidencia: u.N, questoes: u.q }); });
    overinvest.forEach(u => { const g = discMap[u.disciplina]; if (g) g.over.push({ nome: u.nome, fatiaEsforco: Math.round(u.shareEsforco * 1000) / 10, fatiaBanca: Math.round(u.shareBanca * 1000) / 10 }); });
    const porDisciplina = Object.values(discMap).map(g => ({
      disciplina: g.disciplina,
      incidencia: g.incidencia,
      questoes: g.questoes,
      pctAcerto: g.questoes > 0 ? Math.round((g.acertos / g.questoes) * 1000) / 10 : null,
      nFracos: g.itens.filter(it => it.selo !== 'ok').length,
      pontosRec: Math.round(g.pontosRec * 10) / 10,
      cobertura: g.incidencia > 0 ? Math.round((g.questoes > 0 ? Math.min(1, g.itens.reduce((s, it) => s + it.incidencia, 0) / g.incidencia) : 0) * 100) : 0,
      itens: g.itens.slice(0, topPorDisc),
      nItens: g.itens.length,
      cegos: g.cegos.slice(0, 5),
      over: g.over.slice(0, 3)
    })).sort((a, b) => {
      // ordena as disciplinas conforme o mesmo critério escolhido
      if (ordenarPor === 'erro') return (a.pctAcerto == null ? 999 : a.pctAcerto) - (b.pctAcerto == null ? 999 : b.pctAcerto) || b.pontosRec - a.pontosRec;
      if (ordenarPor === 'incidencia') return b.incidencia - a.incidencia || b.pontosRec - a.pontosRec;
      return b.pontosRec - a.pontosRec || b.incidencia - a.incidencia; // oportunidade
    });

    // projeção da média (sobre a parte coberta) e potencial se dominar o TOP
    const covered = units.filter(u => u.q > 0);
    const cN = covered.reduce((a, u) => a + u.N, 0) || 1;
    const projAtual = covered.reduce((a, u) => a + u.N * u.pac, 0) / cN;
    const ganhoTop = items.reduce((a, it) => a + it.pontosRecuperaveis, 0);
    const projPotencial = projAtual + ganhoTop / cN;
    const cobertura = Math.round(cN / totalN * 100);
    // confiança da projeção: quanto da prova está coberto por amostra real
    const conf = cobertura >= 70 ? 'alta' : cobertura >= 45 ? 'media' : 'baixa';

    return {
      fresh: this.isFresh(snap, 90), snapDate: snap.endDate || snap.date,
      hasAnyIncid,
      projAtual: Math.round(projAtual * 1000) / 10,
      projPotencial: Math.round(projPotencial * 1000) / 10,
      cobertura, confianca: conf,
      ordenarPor,
      items, porDisciplina,
      blindSpots: blindPool.slice(0, 8).map(u => ({ nome: u.nome, disciplina: u.disciplina, incidencia: u.N, questoes: u.q })),
      overinvest: overinvest.slice(0, 6).map(u => ({ nome: u.nome, disciplina: u.disciplina, questoes: u.q, incidencia: u.N, fatiaEsforco: Math.round(u.shareEsforco * 1000) / 10, fatiaBanca: Math.round(u.shareBanca * 1000) / 10 })),
      totalUnidades: units.length, totalErros: mainPool.length, totalCegos: blindPool.length,
      semIncidencia: hasAnyIncid ? 0 : items.length
    };
  },
  // sugestão de quantidade de tópicos conforme a carga horária semanal do ciclo
  sugerirLimite() {
    const cyc = DB.getCurrentCycle();
    const horas = cyc && cyc.weeklyHours ? cyc.weeklyHours : 20;
    return Math.max(5, Math.min(30, Math.round(horas / 3))); // ~1 tópico por 3h
  }
};
