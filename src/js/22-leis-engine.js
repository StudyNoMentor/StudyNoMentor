/* ============================================================
   LAW ENGINE — formatação estruturada + destaque de "pegadinhas"
   de lei seca (por regras, offline). Não é IA: são padrões
   consagrados de cobrança em prova. O usuário liga/desliga
   categorias e ainda pode marcar trechos manualmente.
   ============================================================ */
const LawEngine = {
  // escape puro (não depende do DOM) — seguro para o caminho de renderização de texto
  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
  normalize(raw) {
    return String(raw || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },
  // Categorias de destaque automático (classes CSS: lawmark-<chave>)
  categories: {
    // 1) Ressalvas, Exceções e Condicionantes
    ressalvas: { label: 'Ressalvas / Exceções', cls: 'lawmark-ressalvas',
      re: /(salvo\s+se|salvo(?:\s+disposi[çc][ãa]o[^,.;\n]*)?|com\s+exce[çc][ãa]o|excetuad[oa]s?|exceto|ressalvad[oa]s?|sem\s+preju[íi]zo|desde\s+que|sob\s+condi[çc][ãa]o|n[ãa]o\s+obstante|(?:^|[\s(,;])se(?=\s))/giu },
    // 2) Restrições e Exclusividade
    restricoes: { label: 'Restrições / Exclusiv.', cls: 'lawmark-restricoes',
      re: /(exclusivamente|exclusiv[oa]s?|somente|apenas|vedad[oa]s?|veda[çc][ãa]o|proibid[oa]s?|imposs[íi]vel|independentemente|independe|integralmente|integral|restrit[oa]s?|(?:^|[\s(,])s[óo](?=[\s,.;]))/giu },
    // 3) Poder, Dever e Competência
    competencias: { label: 'Poder / Dever / Comp.', cls: 'lawmark-competencias',
      re: /(dever[ãa]o|dever[áa]|deve(?=[\s,.;:])|poder[ãa]o|poder[áa]|pode(?=[\s,.;:])|é\s+facultado|facultativ[oa]s?|facultad[oa]s?|compet[êe]ncia|compete(?=[\s,.;:])|privativamente|privativ[ao]s?|indeleg[áa]vel|deleg[áa]vel|vinculad[oa]s?|obrigat[óo]ri[ao]s?|dispensad[oa]s?|dispens[áa]vel|inexig[íi]vel)/giu },
    // 4) Prazos, Tempo e Eficácia
    prazos: { label: 'Prazos / Tempo', cls: 'lawmark-prazos',
      re: /(\d{1,3}(?:\.\d{3})*(?:,\d+)?\s?%|\d+\s?\/\s?\d+|\d+\s?(?:dias?|horas?|meses|m[êe]s|anos?|semanas?|minutos?)|(?:um|dois|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta|sessenta|noventa)\s+(?:dias?|horas?|meses|anos?)|maioria\s+absoluta|maioria\s+simples|dois\s+ter[çc]os|tr[êe]s\s+quintos|metade\s+mais\s+um|[úu]teis|corridos|cont[íi]nuos|exerc[íi]cio\s+seguinte|exerc[íi]cio\s+financeiro|em\s+vigor|vig[êe]ncia|vigor|anteriormente|posteriormente|anterior|posterior|imediatamente|imediat[ao]|tr[âa]nsito\s+em\s+julgado|transitad[ao]\s+em\s+julgado|decad[êe]ncia|decai|prescri[çc][ãa]o|prescreve)/giu },
    // 5) Validade, Sanções e Efeitos do Ato
    efeitos: { label: 'Validade / Sanções', cls: 'lawmark-efeitos',
      re: /(nulidade|nul[oa]s?|anul[áa]vel|anula[çc][ãa]o|inefic[áa]z|inefic[áa]cia|suspens[ãa]o|suspende|extin[çc][ãa]o|extingue|exclus[ãa]o|exclui|revoga[çc][ãa]o|revogad[oa]s?|revoga|presume-se|presun[çc][ãa]o|penalidade|multa|san[çc][ãa]o|infra[çc][ãa]o|contraven[çc][ãa]o|improbidade|crime)/giu },
    // 6) Causalidade e Subordinação
    relacoes: { label: 'Causalidade / Subord.', cls: 'lawmark-relacoes',
      re: /(subsidiariamente|subsidi[áa]ri[ao]|supletivamente|supletiv[ao]|solidariamente|solid[áa]ri[ao]|pessoalmente|pessoal|diretamente|indiretamente|conjuntamente)/giu }
  },
  // Constrói os spans de destaque de UMA linha (offsets locais).
  // suppressed: itens apagados pelo usuário. Aceita texto puro (formato antigo = vale para a
  // lei inteira) ou { t, l } = apagar SÓ na linha l — apagar um "deve" não some com todos.
  _spansForLine(line, opts, manualList, suppressed, ln, keywords) {
    const spans = [];
    let suppGlobal = null, suppLinha = null;
    if (suppressed && suppressed.length) {
      suppGlobal = []; suppLinha = [];
      suppressed.forEach(s => {
        if (typeof s === 'string') suppGlobal.push(s.toLowerCase());
        else if (s && s.t != null && (s.l == null || s.l === ln)) suppLinha.push(String(s.t).toLowerCase());
      });
    }
    const autoOff = opts && opts._auto === false; // interruptor mestre desligado
    // DESTAQUE AUTOMÁTICO por LISTA DE PALAVRAS gerenciável (o que está no gerenciador
    // é exatamente o que acende). Respeita os toggles por categoria e a supressão.
    if (!autoOff && keywords && keywords.length) {
      const low = line.toLowerCase();
      keywords.forEach(kw => {
        const cat = kw.cat || 'competencias';
        if (opts && opts[cat] === false) return;        // categoria desligada na barra
        const needle = String(kw.t || '').toLowerCase();
        if (needle.length < 2) return;
        if (suppGlobal && (suppGlobal.includes(needle) || suppLinha.includes(needle))) return;
        const catMeta = this.categories[cat];
        const cls = (catMeta && catMeta.cls) || 'lawmark-manual';
        const iniPal = /[\wÀ-ÿ]/.test(needle[0]);
        const fimPal = /[\wÀ-ÿ]/.test(needle[needle.length - 1]);
        let from = 0, i;
        while ((i = low.indexOf(needle, from)) !== -1) {
          const antes = i > 0 ? low[i - 1] : '';
          const depois = (i + needle.length) < low.length ? low[i + needle.length] : '';
          const okI = !iniPal || !/[\wÀ-ÿ]/.test(antes);
          const okF = !fimPal || !/[\wÀ-ÿ]/.test(depois);
          if (okI && okF) spans.push({ start: i, end: i + needle.length, cls });
          from = i + needle.length;
        }
      });
    }
    // manuais:
    //  • Marca ANCORADA {t,l,s} → acende SÓ a ocorrência exata que o usuário marcou.
    //    (é o comportamento correto: marcar uma palavra não deve acender todas as iguais).
    //  • String (legado) → mantém o modo antigo: todas as ocorrências na linha,
    //    respeitando limites de palavra (marcar "do" não acende o "do" de "servidor").
    (manualList || []).forEach(sub => {
      if (sub && typeof sub === 'object') {
        if (sub.l !== ln) return;
        const t = String(sub.t || '');
        if (!t) return;
        let s = sub.s;
        // valida a âncora; se o texto foi editado e a posição não bate mais,
        // reencontra a 1ª ocorrência na linha para o destaque não se perder.
        if (!(typeof s === 'number' && s >= 0 && line.substr(s, t.length).toLowerCase() === t.toLowerCase())) {
          const idx = line.toLowerCase().indexOf(t.toLowerCase());
          if (idx === -1) return;
          s = idx;
        }
        spans.push({ start: s, end: s + t.length, cls: 'lawmark-manual' });
        return;
      }
      if (!sub || sub.length < 2) return;
      const low = line.toLowerCase(), needle = String(sub).toLowerCase();
      const inicioPal = /[\wÀ-ÿ]/.test(needle[0]);
      const fimPal = /[\wÀ-ÿ]/.test(needle[needle.length - 1]);
      let from = 0, i;
      while ((i = low.indexOf(needle, from)) !== -1) {
        const antes = i > 0 ? low[i - 1] : '';
        const depois = (i + needle.length) < low.length ? low[i + needle.length] : '';
        const okIni = !inicioPal || !/[\wÀ-ÿ]/.test(antes);
        const okFim = !fimPal || !/[\wÀ-ÿ]/.test(depois);
        if (okIni && okFim) spans.push({ start: i, end: i + sub.length, cls: 'lawmark-manual' });
        from = i + sub.length;
      }
    });
    return spans;
  },
  // Renderiza uma linha aplicando os spans (trata sobreposições via fronteiras).
  _renderLine(line, spans) {
    if (!spans.length) return this._esc(line);
    const bounds = new Set([0, line.length]);
    spans.forEach(s => { bounds.add(Math.max(0, s.start)); bounds.add(Math.min(line.length, s.end)); });
    const pts = [...bounds].sort((a, b) => a - b);
    let out = '';
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a >= b) continue;
      const seg = line.slice(a, b);
      const cls = [...new Set(spans.filter(s => s.start <= a && s.end >= b).map(s => s.cls))];
      out += cls.length ? `<mark class="${cls.join(' ')}">${this._esc(seg)}</mark>` : this._esc(seg);
    }
    return out;
  },
  // Regex compiladas uma vez (antes eram recriadas 6x POR LINHA — custo alto em leis grandes)
  _re(key) {
    this._reCache = this._reCache || {};
    if (!this._reCache[key]) { const c = this.categories[key]; this._reCache[key] = new RegExp(c.re.source, c.re.flags); }
    const r = this._reCache[key]; r.lastIndex = 0; return r;
  },
  // Classifica a estrutura de uma linha para dar hierarquia visual.
  _classify(line) {
    const t = line.trim();
    if (!t) return null;
    if (/^(t[íi]tulo|cap[íi]tulo|se[çc][ãa]o|subse[çc][ãa]o|livro)\b/i.test(t)) return 'law-head';
    if (/^art(?:\.|igo)\s*\d+/i.test(t)) return 'law-art';
    if (/^§\s*\d+/.test(t) || /^par[áa]grafo\s+[úu]nico/i.test(t)) return 'law-par';
    // ALÍNEA antes de inciso: com o teste romano em maiúsculas+minúsculas, as alíneas
    // c) d) i) l) m) v) x) eram lidas como algarismos romanos e viravam incisos.
    if (/^[a-z]\)/.test(t)) return 'law-ali';
    if (/^[IVXLCDM]+\s*[-–—.)]/.test(t)) return 'law-inc';
    return 'law-line';
  },
  // Reencontra a linha do marcador quando o texto foi editado. Guardamos um trecho da
  // linha ("bookmarkTxt"); se ela mudou de posição, o pin acompanha em vez de apontar errado.
  resolveBookmark(lei) {
    const alvo = (lei.bookmark != null) ? lei.bookmark : -1;
    const ref = lei.bookmarkTxt;
    if (alvo < 0 || !ref) return alvo;
    const linhas = this.normalize(lei.texto).split('\n').filter(l => l.trim());
    if (linhas[alvo - 1] && linhas[alvo - 1].trim().startsWith(ref)) return alvo;
    const i = linhas.findIndex(l => l.trim().startsWith(ref));
    return i >= 0 ? i + 1 : alvo;
  },
  // Gera o HTML final estruturado + destacado de uma lei.
  // keywords: lista gerenciável de palavras a destacar (padrão: DB.getLeiKeywords()).
  toHtml(lei, keywords) {
    const text = this.normalize(lei.texto);
    const opts = lei.opts || {};
    const manual = lei.marcacoes || [];
    const suppressed = lei.suppressed || [];
    const kw = keywords || (typeof DB !== 'undefined' && DB.getLeiKeywords ? DB.getLeiKeywords() : []);
    const lines = text.split('\n');
    const bookmark = this.resolveBookmark(lei);
    const buf = [];
    let ln = 0; // contador de linhas de conteúdo (ignora linhas em branco)
    lines.forEach(line => {
      if (!line.trim()) { buf.push('<div class="law-gap"></div>'); return; }
      ln++;
      const cls = this._classify(line);
      const spans = this._spansForLine(line, opts, manual, suppressed, ln, kw);
      const isBk = (ln === bookmark);
      buf.push(`<div class="law-block ${cls} ${isBk ? 'law-bookmarked' : ''}" data-line="${ln}">` +
        `<span class="law-lnum" data-line="${ln}" title="Clique para marcar aqui (onde parei)">${ln}</span>` +
        `<span class="law-content">${this._renderLine(line, spans)}</span>` +
        (isBk ? '<span class="law-pin" title="Você parou aqui">📌</span>' : '') +
        `</div>`);
    });
    return buf.join('');
  },
  // Estatísticas rápidas para o cabeçalho do leitor.
  stats(lei) {
    const text = this.normalize(lei.texto);
    // Conta só as linhas que INICIAM um artigo. Antes, cada citação ("nos termos do
    // art. 5º") era contada como um artigo novo e o total saía inflado.
    const arts = text.split('\n').filter(l => /^\s*art(?:\.|igo)?\s*\d+/i.test(l)).length;
    const palavras = (text.match(/\S+/g) || []).length;
    return { artigos: arts, palavras, marcacoes: (lei.marcacoes || []).length };
  }
};
