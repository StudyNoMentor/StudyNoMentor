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
        /* % do assunto na prova (col "Porcentagem"). Serve p/ reconstruir o total
           do caderno quando houver questões "sem classificação" fora do índice.
           Vem de `pctColuna` — o número CRU da coluna: `pctAcerto` é recalculado
           como taxa de acerto (acertos ÷ questões), que aqui não existe. */
        pct: (r.pctColuna != null ? r.pctColuna : (r.pctAcerto != null ? r.pctAcerto : null))
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
  /* ── MAPA DE INCIDÊNCIA ────────────────────────────────────────────────────
     A chave era só o NOME do tópico. "Princípios" de Constitucional e
     "Princípios" de Administrativo caíam no mesmo balde e somavam — o número
     que sobe ao topo do Reforço e da ordem "fraqueza × incidência" do Plano
     passava a descrever dois assuntos ao mesmo tempo, e nenhum deles.

     Agora a chave principal é DISCIPLINA + TÓPICO. A chave só-por-nome continua
     no mesmo mapa, de propósito: é a queda para quando as duas fontes chamam a
     disciplina de coisas diferentes ("Português" x "Língua Portuguesa"), caso
     em que casar por nome ainda é melhor que não casar. `incidenciaDe` tenta a
     específica primeiro e diz, no retorno, qual das duas respondeu. */
  SEP: '\u0001',
  chaveInc(disciplina, topico) { return this.norm(disciplina) + this.SEP + this.norm(topico); },
  /* ── QUAIS BANCAS ─────────────────────────────────────────────────────────
     Era "todas" ou UMA. Quem presta concurso para dois órgãos com bancas
     diferentes — o caso comum de quem estuda a sério — só tinha as duas
     extremidades: somar o histórico de bancas que não vai enfrentar, ou olhar
     uma e ignorar a outra. O filtro agora aceita uma LISTA, e todo o resto do
     motor passa por aqui: um lugar só decide o que é "a minha prova".

     Formas aceitas: '__todas__' (ou vazio) · 'FGV' · ['FGV','Cebraspe'] */
  filtroBanca(sel) {
    if (sel == null || sel === '__todas__' || sel === '') return null;      // null = tudo entra
    const lista = Array.isArray(sel) ? sel : [sel];
    const set = new Set(lista.map(b => this.norm(b)).filter(Boolean));
    if (!set.size || set.has(this.norm('__todas__'))) return null;
    return set;
  },
  _daBanca(filtro, banca) { return !filtro || filtro.has(this.norm(banca)); },
  // rótulo legível da seleção, para a tela nunca falar de "banca" no singular
  // quando o número na frente soma três históricos diferentes
  rotuloBancas(sel) {
    const f = this.filtroBanca(sel);
    if (!f) return 'todas as bancas';
    const nomes = DB.getBancas().filter(b => f.has(this.norm(b)));
    if (!nomes.length) return 'nenhuma banca';
    if (nomes.length === 1) return nomes[0];
    if (nomes.length === 2) return nomes[0] + ' e ' + nomes[1];
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  },
  incidenceMap(banca) {
    const map = {};
    const filtro = this.filtroBanca(banca);
    DB.getIncidencia().forEach(r => {
      if (!this._daBanca(filtro, r.banca)) return;
      const kn = this.norm(r.topico);
      const kd = this.chaveInc(r.disciplina || '', r.topico);
      map[kn] = (map[kn] || 0) + (r.incidencia || 0);
      map[kd] = (map[kd] || 0) + (r.incidencia || 0);
    });
    return map;
  },
  // Devolve { valor, viaNome } — viaNome=true significa que só o nome casou.
  incidenciaDe(map, topico, disciplina) {
    if (!map) return { valor: 0, viaNome: false };
    const kd = this.chaveInc(disciplina || '', topico);
    if (map[kd] != null) return { valor: map[kd], viaNome: false };
    const kn = this.norm(topico);
    if (map[kn] != null) return { valor: map[kn], viaNome: true };
    return { valor: 0, viaNome: false, ausente: true };
  },
  // Com uma seleção, responde "há incidência NAS BANCAS QUE EU ESCOLHI?" — que é
  // a pergunta que a tela precisa fazer antes de prometer prioridade por prova.
  hasIncidencia(sel) {
    const filtro = this.filtroBanca(sel);
    if (!filtro) return DB.getIncidencia().length > 0;
    return DB.getIncidencia().some(r => this._daBanca(filtro, r.banca));
  },
  // O retrato TEC mais recente é o "nível atual", sem prazo de validade: quem
  // mostra o retrato exibe a data dele (o antigo comentário prometia um corte
  // de 90 dias que nunca existiu — não o criamos para não esconder dados).
  currentSnapshot() {
    const snaps = DB.getTecSnapshots();
    if (!snaps.length) return null;
    return snaps[snaps.length - 1]; // já vêm ordenados por data
  },
  /* ── O QUE A INCIDÊNCIA ENTREGA À ANÁLISE ────────────────────────────────
     Daqui para baixo mora só a LEITURA da incidência importada: a raiz de cada
     disciplina e o índice por disciplina. A antiga "fronteira adaptativa" — que
     cruzava incidência com desempenho e devolvia pontos fracos, pontos cegos e
     sobre-investimento — saiu inteira: era um segundo motor de decisão, com
     régua própria (suavização, zona de virada, teto), respondendo à mesma
     pergunta que o 🧭 Motor de sugestão responde com uma conta só. */
  _depth(codigo) { return (codigo == null || codigo === '') ? 0 : String(codigo).split('.').length; },

  _incidByDisc(banca) {
    const by = {};
    const filtro = this.filtroBanca(banca);
    const chaves = {};
    DB.getIncidencia().forEach(r => {
      if (!this._daBanca(filtro, r.banca)) return;
      const disc = r.disciplina;
      const codigo = (r.codigo == null || r.codigo === '') ? null : String(r.codigo);
      const nome = r.topico || r.nome || '';
      const k = disc + '|' + (codigo !== null ? '#' + codigo : this.norm(nome));
      const mapa = (chaves[disc] = chaves[disc] || {});
      if (mapa[k]) { mapa[k].incidencia += (r.incidencia != null ? r.incidencia : 0); return; }
      const row = { codigo, nome, disciplina: disc, incidencia: (r.incidencia != null ? r.incidencia : 0),
        depth: (r.depth != null ? r.depth : null) };
      mapa[k] = row;
      (by[disc] = by[disc] || []).push(row);
    });
    return by;
  },
  /* ── O TOTAL DE UMA DISCIPLINA NÃO É A SOMA DAS LINHAS DELA ──────────────
     A incidência vem em ÁRVORE: "Direito Civil 200", e debaixo dela "01 Parte
     Geral 100", e debaixo desta "01.01 Princípios 60" e "01.02 Fontes 40".
     Somar tudo dá 500 onde a banca cobra 200, porque conta a mesma questão em
     cada nível.

     E o erro NÃO É UNIFORME, que é o que o torna perigoso: ele depende de quão
     fundo a tabela foi colada, não do que a banca cobra. Duas disciplinas com
     200 questões cada viravam 55,6% e 44,4% da prova só porque uma foi
     importada com dois níveis e a outra com um. Como o peso é uma FATIA do
     total, a distorção vira prioridade errada — a matéria mais DETALHADA
     parece pesar mais.

     A regra já existia solta na tela de incidência ("pai = soma dos filhos,
     então o total é a soma das disciplinas"); aqui ela vira função, com o caso
     do meio que faltava: sem linha de disciplina, vale o nível mais raso que
     existir, e só quando não há hierarquia nenhuma é que somamos tudo. */

  raizIncid(rows) {
    rows = rows || [];
    const soma = xs => xs.reduce((a, r) => a + (r.incidencia || 0), 0);
    /* Linhas sem código só são RAIZ quando não declaram profundidade > 0. A
       "Sem Classificação" do TEC chega com depth=1 e codigo=null: é irmã dos
       assuntos de 1º nível, não a disciplina — contá-la como raiz somava a
       disciplina E um filho, inflando o total. */
    const semCodigo = r => r.codigo == null || r.codigo === '';
    const raiz = rows.filter(r => r.depth === 0 || (semCodigo(r) && !(Number(r.depth) > 0)));
    if (raiz.length) return soma(raiz);
    const nivel = r => { const n = this._depth(r.codigo); if (n > 0) return n; const d = Number(r.depth); return Number.isFinite(d) && d > 0 ? d : 0; };
    let raso = Infinity;
    rows.forEach(r => { const n = nivel(r); if (n > 0 && n < raso) raso = n; });
    if (raso === Infinity) return soma(rows);  // colagem plana
    return soma(rows.filter(r => nivel(r) === raso));
  },

  incidPorDisciplina(banca) {
    const by = this._incidByDisc(banca);
    const out = {};
    Object.keys(by).forEach(d => { out[d] = this.raizIncid(by[d]); });
    return out;
  }
};
