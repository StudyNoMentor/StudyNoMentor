/* ============================================================
   TEC ENGINE — parsing da planilha do TecConcursos + análise
   ============================================================ */
/* ============================================================
   MiniXLSX — leitor de planilhas .xlsx 100% OFFLINE (sem CDN)
   Um .xlsx é um ZIP de XMLs. Este leitor descompacta as entradas
   necessárias com o DecompressionStream nativo do navegador e
   extrai as linhas/células, preservando a posição das colunas
   (essencial: a 1ª coluna vem vazia nas linhas de disciplina).
   Usado como fallback quando a biblioteca SheetJS (CDN) não carrega.
   ============================================================ */

/* Carregador SOB DEMANDA do SheetJS (versão CORRIGIDA, sem o CVE do 0.18.5).
   Só é chamado quando o leitor embutido (MiniXLSX) não resolve — ex.: .xls
   binário antigo. Retorna uma Promise que resolve quando window.XLSX existe.
   Fica em cache: baixa no máximo uma vez por sessão. */
let _sheetjsPromise = null;
function ensureSheetJS() {
  if (typeof XLSX !== 'undefined') return Promise.resolve(true);
  if (_sheetjsPromise) return _sheetjsPromise;
  _sheetjsPromise = new Promise((resolve) => {
    try {
      const s = document.createElement('script');
      // CDN oficial do SheetJS com a correção do Prototype Pollution / ReDoS.
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.async = true;
      /* crossOrigin é OBRIGATÓRIO para o navegador aplicar o integrity: sem ele
         a resposta é opaca e a verificação de hash é simplesmente ignorada.
         O hash abaixo precisa ser gerado uma vez, com o arquivo em mãos:
           curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
         Enquanto ele não for preenchido, mantemos crossOrigin (sem integrity):
         a CSP já restringe a origem, e o congelamento de prototypes acima
         limita o estrago de um pacote adulterado. */
      s.crossOrigin = 'anonymous';
      if (window.__SHEETJS_SRI) s.integrity = window.__SHEETJS_SRI;
      // Timeout: sem rede, a Promise ficava pendente para sempre e a interface
      // congelava em "Carregando leitor de planilha…".
      const prazo = setTimeout(() => { _quiet(new Error('timeout'), 'sheetjs'); resolve(false); }, 15000);
      s.onload = () => { clearTimeout(prazo); resolve(typeof XLSX !== 'undefined'); };
      s.onerror = () => { _sheetjsPromise = null; resolve(false); };
      document.head.appendChild(s);
    } catch (_) { _sheetjsPromise = null; resolve(false); }
  });
  return _sheetjsPromise;
}

const MiniXLSX = {
  _dv(u8) { return new DataView(u8.buffer, u8.byteOffset, u8.byteLength); },
  // Lê o diretório central do ZIP e devolve um mapa nome -> { method, compSize, localOff }
  _readZip(u8) {
    const dv = this._dv(u8);
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('arquivo .xlsx inválido (não é um ZIP).');
    const cdOffset = dv.getUint32(eocd + 16, true);
    const total = dv.getUint16(eocd + 10, true);
    const entries = {};
    let p = cdOffset;
    for (let n = 0; n < total; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = new TextDecoder('utf-8').decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method, compSize, localOff };
      p += 46 + nameLen + extraLen + commentLen;
    }
    this._u8 = u8; this._dvAll = dv;
    return entries;
  },
  _compressedBytes(entry) {
    const dv = this._dvAll, u8 = this._u8;
    const lo = entry.localOff;
    if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('cabeçalho local do ZIP inválido.');
    const nameLen = dv.getUint16(lo + 26, true);
    const extraLen = dv.getUint16(lo + 28, true);
    const start = lo + 30 + nameLen + extraLen;
    return u8.subarray(start, start + entry.compSize);
  },
  async _inflate(entry) {
    const data = this._compressedBytes(entry);
    if (entry.method === 0) return data; // STORED (sem compressão)
    if (typeof DecompressionStream === 'undefined')
      throw new Error('seu navegador não suporta ler .xlsx offline — atualize o navegador ou cole os dados.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  },
  _xmlDecode(s) {
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  },
  _colToIdx(ref) {
    const m = /^([A-Z]+)/.exec(ref); if (!m) return 0;
    let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  },
  _parseSharedStrings(xml) {
    const out = []; const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g; let m;
    while ((m = siRe.exec(xml))) {
      let text = ''; const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let t;
      while ((t = tRe.exec(m[1]))) text += this._xmlDecode(t[1]);
      out.push(text);
    }
    return out;
  },
  _parseSheet(xml, sst) {
    const rows = []; const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while ((rm = rowRe.exec(xml))) {
      const inner = rm[1]; const cells = [];
      const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
      while ((cm = cRe.exec(inner))) {
        const attrs = cm[1] || ''; const body = cm[2] || '';
        const rMatch = /r="([A-Z]+\d+)"/.exec(attrs);
        const tMatch = /t="([^"]+)"/.exec(attrs);
        const type = tMatch ? tMatch[1] : null;
        let val = '';
        if (type === 'inlineStr') {
          let s = ''; const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g; let t;
          while ((t = tRe.exec(body))) s += this._xmlDecode(t[1]);
          val = s;
        } else {
          const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
          const raw = vMatch ? this._xmlDecode(vMatch[1]) : '';
          if (type === 's') { const idx = parseInt(raw, 10); val = (sst[idx] !== undefined ? sst[idx] : ''); }
          else val = raw;
        }
        const col = rMatch ? this._colToIdx(rMatch[1]) : cells.length;
        while (cells.length <= col) cells.push('');
        cells[col] = val;
      }
      rows.push(cells);
    }
    return rows;
  },
  // Descobre o caminho da PRIMEIRA planilha via workbook.xml + rels (com fallback para sheet1.xml)
  async _firstSheetPath(entries, getText) {
    try {
      const wb = await getText('xl/workbook.xml');
      const rels = await getText('xl/_rels/workbook.xml.rels');
      if (wb && rels) {
        const sm = /<sheet\b[^>]*>/i.exec(wb);
        let rid = null;
        if (sm) { const r = /r:id="([^"]+)"/.exec(sm[0]) || /[^:]id="([^"]+)"/.exec(sm[0]); if (r) rid = r[1]; }
        if (rid) {
          const relm = new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*>', 'i').exec(rels);
          if (relm) { const tm = /Target="([^"]+)"/.exec(relm[0]); if (tm) { let tgt = tm[1].replace(/^\//, '').replace(/^\.\//, ''); return tgt.startsWith('xl/') ? tgt : 'xl/' + tgt; } }
        }
      }
    } catch (e) { _quiet(e); }
    const names = Object.keys(entries).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)).sort();
    return names[0] || 'xl/worksheets/sheet1.xml';
  },
  // API principal: lê o arquivo e devolve { rows: [[celula,...],...] } da 1ª planilha
  async readFirstSheet(file) {
    const u8 = (file instanceof Uint8Array) ? file : new Uint8Array(await file.arrayBuffer());
    const entries = this._readZip(u8);
    const getText = async (name) => { const e = entries[name]; if (!e) return null; return new TextDecoder('utf-8').decode(await this._inflate(e)); };
    const sstXml = await getText('xl/sharedStrings.xml');
    const sst = sstXml ? this._parseSharedStrings(sstXml) : [];
    const sheetPath = await this._firstSheetPath(entries, getText);
    const sheetXml = await getText(sheetPath);
    if (sheetXml == null) throw new Error('planilha não encontrada dentro do arquivo.');
    return { rows: this._parseSheet(sheetXml, sst) };
  }
};

const TecEngine = {
  // Converte "85.0", "85,0", "1.234" (pt), "" em número; retorna null se vazio/invalido
  parseNum(raw) {
    if (raw === undefined || raw === null) return null;
    let s = String(raw).trim();
    if (s === '' || s === '-' || s === '—') return null;
    s = s.replace(/%/g, '').replace(/\s/g, '').trim();
    if (s.includes(',') && !s.includes('.')) {
      // vírgula decimal pt-BR: 85,5 -> 85.5
      s = s.replace(',', '.');
    } else if (s.includes(',') && s.includes('.')) {
      // ponto = milhar, vírgula = decimal: 1.234,5 -> 1234.5
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      // SÓ pontos, em grupos exatos de 3: é separador de MILHAR pt-BR.
      // 1.234 -> 1234 · 1.234.567 -> 1234567 (antes virava 1.234, quebrando os totais)
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  },
  isCodigo(cell) {
    return /^\d+(\.\d+)*$/.test(String(cell || '').trim());
  },
  // Divide uma linha colada em células: tenta TAB; se não houver, cai para 2+ espaços
  splitLine(line) {
    if (line.includes('\t')) return line.split('\t').map(c => c.trim());
    /* BUG CORRIGIDO: dividir em QUALQUER corrida de 2+ espaços quebrava nomes de
       disciplina que vêm com espaço duplo ao copiar de PDF/HTML
       ("DIREITO  CONSTITUCIONAL" virava duas células e deslocava TODA a linha,
       jogando as questões para a coluna do nome).
       Regra nova: só é separador de coluna a corrida de espaços seguida de algo
       que PAREÇA dado tabular — número, percentual ou traço. Espaço duplo entre
       duas PALAVRAS continua fazendo parte do nome. */
    const partes = [];
    let buf = '';
    const re = /\s{2,}/g;
    let last = 0, m;
    while ((m = re.exec(line))) {
      const depois = line.slice(m.index + m[0].length);
      // separador de verdade: o que vem depois começa com número/%/-/— (célula numérica)
      const ehColuna = /^[-—]?\s*[\d.,]/.test(depois) || /^[-—]\s*$/.test(depois);
      if (ehColuna) {
        partes.push((buf + line.slice(last, m.index)).trim());
        buf = ''; last = m.index + m[0].length;
      } else {
        // espaço duplo DENTRO do nome: normaliza para um espaço e segue
        buf += line.slice(last, m.index) + ' ';
        last = m.index + m[0].length;
      }
    }
    partes.push((buf + line.slice(last)).trim());
    return partes.filter((c, i, arr) => !(c === '' && i === arr.length - 1));
  },
  // Parseia o texto colado (TSV) do TecConcursos numa lista hierárquica de linhas.
  // Colunas esperadas (após nome): Questões Resolvidas, Acertos %, Qtd Acertos, Erros %, Qtd Erros, Peso
  parse(text) {
    const rawLines = String(text || '').split(/\r?\n/).map(l => l.replace(/\u00a0/g, ' ')).filter(l => l.trim() !== '');
    return this.parseCellRows(rawLines.map(l => this.splitLine(l)));
  },
  // Linhas de TOTAL/RESUMO do relatório do TEC. Se entrassem, virariam uma "disciplina"
  // fantasma e os totais gerais apareceriam somados em dobro.
  _isTotalRow(nome) {
    const k = String(nome == null ? '' : nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    return /^total\b/.test(k) || /^soma\b/.test(k) || /total\s+(geral|de\s+quest|assunto)/.test(k)
        || /^resumo\b/.test(k) || /^geral$/.test(k);
  },
  /* ── A LINHA "SEM CLASSIFICAÇÃO" NÃO É UMA DISCIPLINA ────────────────────
     No export do TecConcursos cada disciplina termina com uma linha
     "Sem Classificação": as questões daquela disciplina que ainda não têm
     assunto atribuído. Ela vem com a coluna Hierarquia VAZIA — exatamente como
     a linha da própria disciplina — e por isso era lida como disciplina nova.

     O preço foi medido em dois exports reais. A planilha de 434 linhas tem
     20 disciplinas e 400 questões; o app registrava 28 disciplinas e 409
     questões, porque as 9 questões sem classificação eram contadas DUAS vezes:
     uma dentro do total da disciplina (que já as inclui) e outra como
     disciplina própria. A outra planilha virava 134 questões no lugar de 133.
     E havia um segundo erro no sentido contrário: o Plano só olha linhas de
     profundidade > 0, então esse mesmo volume simplesmente não existia para
     ele — a Análise dizia 409 e o Plano trabalhava com 391.

     Agora ela entra como ASSUNTO da disciplina corrente, sem código (como toda
     folha que não tem filhos): o total fecha, a contagem de disciplinas fica
     certa e o Plano passa a ver um volume que é praticado e medido. */
  _isSemClassificacao(nome) {
    const k = String(nome == null ? '' : nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    return /^(sem|nao) (classificac|assunto|topico|tema|definid)/.test(k);
  },
  /* ── AS COLUNAS SE LIGAM PELO CABEÇALHO, NÃO PELA POSIÇÃO ────────────────
     Ler "questões" como "a primeira célula numérica depois do nome" funciona
     até uma célula vir vazia: aí a linha inteira desliza uma casa e o app
     registra o PERCENTUAL no lugar da QUANTIDADE, sem nenhum aviso — e um
     retrato com números trocados não tem como ser percebido depois.

     Quando o cabeçalho existe — e no arquivo exportado ele existe — cada campo
     passa a ser lido pelo índice da coluna que o declara. O heurístico
     posicional continua valendo para colagens parciais, que não têm cabeçalho.

     Devolve null quando o cabeçalho não identifica ao menos NOME e QUESTÕES:
     mapa incompleto seria pior que mapa nenhum. */
  _mapaColunas(cells) {
    const norm = (x) => String(x == null ? '' : x).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
    const m = { hier: null, nome: null, questoes: null, pct: null, acertos: null, peso: null };
    cells.forEach((c, i) => {
      const k = norm(c);
      if (!k) return;
      if (m.hier == null && /^hierarquia/.test(k)) m.hier = i;
      else if (m.nome == null && /^(indice|assunto|topico|tema|materia|disciplina)/.test(k)) m.nome = i;
      else if (m.acertos == null && /(quantidade|qtd|numero|total) de acertos/.test(k)) m.acertos = i;
      else if (m.questoes == null && /quest/.test(k) && k.indexOf('%') < 0) m.questoes = i;
      else if (m.pct == null && /^acertos? ?\(?%/.test(k)) m.pct = i;
      else if (m.peso == null && /^peso/.test(k)) m.peso = i;
    });
    return (m.nome != null && m.questoes != null) ? m : null;
  },
  _isLinhaIndice(cells) {
    if (!cells || cells.length < 3) return false;
    const n = cells.map(c => this.parseNum(c));
    if (n.some(v => v === null || !Number.isInteger(v))) return false;
    if (n[0] !== 0 && n[0] !== 1) return false;
    for (let i = 1; i < n.length; i++) if (n[i] !== n[i - 1] + 1) return false;
    return true;
  },
  // Núcleo compartilhado: recebe linhas já divididas em células (de texto colado OU de planilha xlsx/csv)
  parseCellRows(cellRows) {
    const rows = [];
    let currentDisc = null;
    let skippedHeader = false;
    let mapa = null;
    for (let cells of cellRows) {
      cells = (cells || []).map(c => String(c === undefined || c === null ? '' : c).trim());
      // remove células vazias à direita
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (cells.length < 2) continue;
      /* Linha de ÍNDICE DE COLUNA ("0 1 2 3"): alguns exports do TEC saem com os
         números das colunas no lugar dos rótulos. Ela não é dado — e era lida
         como um tópico de código "0" chamado "1", com incidência 2, que entrava
         no mapa e no total do caderno. A assinatura é inconfundível: inteiros
         consecutivos começando em 0 ou 1, em toda a linha. */
      if (this._isLinhaIndice(cells)) continue;
      // pula cabeçalho (aparece uma vez, contém "Questões"/"Hierarquia"/"Acertos")
      const joined = cells.join(' ').toLowerCase();
      if (!skippedHeader && /(hierarquia|questões resolvidas|questoes resolvidas|acertos)/.test(joined) && !/^\d/.test(cells[0])) {
        skippedHeader = true;
        mapa = this._mapaColunas(cells);
        continue;
      }
      let codigo = null, nome = '', depth = 0;
      let qRaw = null, pctRaw = null, acRaw = null, pesoRaw = null;
      if (mapa) {
        const cel = (i) => (i == null || cells[i] == null) ? '' : String(cells[i]).trim();
        const hier = cel(mapa.hier);
        nome = cel(mapa.nome);
        if (!nome) continue;                       // linha sem assunto não identifica nada
        qRaw = cel(mapa.questoes); pctRaw = cel(mapa.pct);
        acRaw = cel(mapa.acertos); pesoRaw = cel(mapa.peso);
        if (this.isCodigo(hier)) { codigo = hier; depth = hier.split('.').length; }
      } else if (this.isCodigo(cells[0])) {
        // linha de tópico: código na 1ª célula, nome na 2ª, números a partir da 3ª
        codigo = cells[0];
        nome = cells[1] || '';
        depth = codigo.split('.').length;
        [qRaw, pctRaw, acRaw, pesoRaw] = this._numsPosicionais(cells.slice(2));
      } else if (cells[0] === '' && cells[1] !== '' && this.parseNum(cells[1]) === null) {
        // linha de disciplina no formato do arquivo .xlsx:
        // coluna do código (Hierarquia) vazia e o NOME na 2ª coluna → números a partir da 3ª
        nome = cells[1];
        [qRaw, pctRaw, acRaw, pesoRaw] = this._numsPosicionais(cells.slice(2));
      } else {
        // linha de disciplina no formato colado: nome na 1ª célula, números a partir da 2ª
        nome = cells[0];
        [qRaw, pctRaw, acRaw, pesoRaw] = this._numsPosicionais(cells.slice(1));
      }
      // linhas de TOTAL/RESUMO não são disciplinas
      if (depth === 0 && this._isTotalRow(nome)) { currentDisc = null; continue; }
      if (depth === 0 && currentDisc && this._isSemClassificacao(nome)) {
        depth = 1; codigo = null;                  // assunto da disciplina corrente
      } else if (depth === 0) {
        currentDisc = nome;
      }
      const questoes = this.parseNum(qRaw);
      const pctAcerto = this.parseNum(pctRaw);
      let acertos = this.parseNum(acRaw);
      // se não veio Qtd acertos mas veio % e questões, calcula
      if (acertos === null && pctAcerto !== null && questoes !== null) {
        acertos = Math.round(questoes * pctAcerto / 100);
      }
      if (questoes === null && pctAcerto === null) continue; // linha sem dados úteis
      rows.push({
        codigo, nome, depth,
        disciplina: depth === 0 ? nome : currentDisc,
        questoes: questoes || 0,
        acertos: acertos || 0,
        /* A coluna "Acertos (%)" do arquivo é ARREDONDADA para exibição (59
           para 13 de 22, que são 59,09). As duas CONTAGENS são exatas, então a
           taxa sai delas sempre que houver questão — o número do arquivo fica
           só como reserva para a linha que não traz quantidade. Sem isto, o
           corte dos pontos fracos e a ordenação da Análise comparavam limiares
           contra um valor já arredondado. */
        pctAcerto: (questoes > 0) ? Math.round((acertos || 0) / questoes * 1000) / 10
          : (pctAcerto !== null ? pctAcerto : 0),
        /* O MESMO parser serve à planilha de INCIDÊNCIA, onde a segunda coluna
           numérica não é taxa de acerto: é a fatia daquele assunto no caderno
           da banca. Recalcular ali seria apagar o dado, então o número cru da
           coluna fica guardado à parte — é dele que sai o total do caderno. */
        pctColuna: (pctAcerto !== null ? pctAcerto : null),
        peso: this.parseNum(pesoRaw)
      });
    }
    return rows;
  },
  /* Leitura POSICIONAL (sem cabeçalho): questões, % de acerto, qtd de acertos e
     peso, na ordem do relatório. Descarta as células vazias antes do primeiro
     número — ao colar a tabela, a coluna "Índice" da disciplina vem vazia e
     deslocava todos os valores uma casa. */
  _numsPosicionais(nums) {
    nums = (nums || []).slice();
    while (nums.length && String(nums[0]).trim() === '') nums.shift();
    return [nums[0], nums[1], nums[2], nums[5]];
  },
  // Resumo por disciplina (linhas depth 0) a partir de um snapshot
  disciplinas(snap) {
    if (!snap) return [];
    const base = snap.rows.filter(r => r.depth === 0);
    /* BUG CORRIGIDO: quando o usuário cola SÓ o detalhamento de uma disciplina
       (sem a linha-cabeçalho de nível 0), não havia nenhuma linha depth===0 e
       tanto disciplinas() quanto totais() devolviam ZERO — os cartões de total
       mostravam 0 questões / 0% com a tela cheia de dados. A árvore já criava a
       raiz implícita; aqui fazemos o mesmo, somando as FOLHAS de 1º nível para
       não contar o mesmo acerto duas vezes (pai e filho). */
    if (base.length) {
      return base.map(r => ({
        nome: r.nome, questoes: r.questoes, acertos: r.acertos,
        pct: r.questoes > 0 ? Math.round((r.acertos / r.questoes) * 1000) / 10 : r.pctAcerto
      }));
    }
    const porDisc = {};
    snap.rows.forEach(r => {
      if (r.depth !== 1) return;                    // só o 1º nível: evita dupla contagem
      const k = r.disciplina || '(sem disciplina)';
      const d = (porDisc[k] = porDisc[k] || { nome: k, questoes: 0, acertos: 0 });
      d.questoes += r.questoes || 0; d.acertos += r.acertos || 0;
    });
    let out = Object.values(porDisc);
    if (!out.length) {                              // nem nível 1: usa a menor profundidade que existir
      const min = Math.min.apply(null, snap.rows.map(r => r.depth));
      snap.rows.filter(r => r.depth === min).forEach(r => {
        const k = r.disciplina || '(sem disciplina)';
        const d = (porDisc[k] = porDisc[k] || { nome: k, questoes: 0, acertos: 0 });
        d.questoes += r.questoes || 0; d.acertos += r.acertos || 0;
      });
      out = Object.values(porDisc);
    }
    return out.map(d => Object.assign(d, {
      pct: d.questoes > 0 ? Math.round((d.acertos / d.questoes) * 1000) / 10 : 0
    }));
  },
  // Tópicos de uma disciplina (todas as profundidades > 0)
  topicos(snap, disciplina) {
    if (!snap) return [];
    return snap.rows.filter(r => r.depth > 0 && r.disciplina === disciplina);
  },
  // Pontos fracos: linhas (tópicos) com volume mínimo e % abaixo do limiar, ordenadas do pior p/ melhor
  pontosFracos(snap, { minQuestoes = 3, limiar = 70, apenasFolhas = true } = {}) {
    if (!snap) return [];
    let rows = snap.rows.filter(r => r.depth > 0 && r.questoes >= minQuestoes && r.pctAcerto < limiar);
    if (apenasFolhas) {
      // remove linhas que são "pai" de outra (mantém só as folhas mais específicas)
      const codigos = new Set(rows.map(r => (r.disciplina + '|' + r.codigo)));
      rows = rows.filter(r => {
        if (!r.codigo) return true;
        // é folha se nenhuma outra linha da mesma disciplina tem código que começa com "r.codigo."
        return !snap.rows.some(o => o !== r && o.disciplina === r.disciplina && o.codigo &&
          o.codigo.startsWith(r.codigo + '.'));
      });
    }
    return rows.sort((a, b) => a.pctAcerto - b.pctAcerto || b.questoes - a.questoes);
  },
  // Totais globais de um snapshot
  totais(snap) {
    if (!snap) return { questoes: 0, acertos: 0, pct: 0, disciplinas: 0 };
    const discs = this.disciplinas(snap);
    const questoes = discs.reduce((a, d) => a + d.questoes, 0);
    const acertos = discs.reduce((a, d) => a + d.acertos, 0);
    return {
      questoes, acertos,
      pct: questoes > 0 ? Math.round((acertos / questoes) * 1000) / 10 : 0,
      disciplinas: discs.length
    };
  },

  // Monta a ÁRVORE hierárquica completa (disciplina → tópico → subtópico → ...) a partir
  // dos códigos "01", "01.07", "01.07.01.01.02.06". Cada nó tem .children (cascata total).
  // O vínculo usa o campo `disciplina` de cada linha — e não a ordem em que elas aparecem —
  // porque na visão consolidada as linhas de vários retratos vêm intercaladas.
  buildTree(snap) {
    if (!snap) return [];
    const nk = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const forest = [];
    const discNodes = {};   // disciplina normalizada -> nó da disciplina
    const byCodigo = {};    // disciplina normalizada -> { codigo: nó }
    let ultimaDisc = null;
    const mkNode = (r) => ({
      codigo: r.codigo, nome: r.nome, depth: r.depth, disciplina: r.disciplina,
      questoes: r.questoes, acertos: r.acertos, pctAcerto: r.pctAcerto, peso: r.peso,
      children: []
    });
    const pendentes = [];
    snap.rows.forEach(r => {
      if (r.depth === 0) {
        const k = nk(r.nome);
        if (discNodes[k]) { ultimaDisc = k; return; } // disciplina repetida: não duplica
        const node = mkNode(r);
        discNodes[k] = node; byCodigo[k] = {}; ultimaDisc = k;
        forest.push(node);
        return;
      }
      const k = r.disciplina ? nk(r.disciplina) : ultimaDisc;
      if (!discNodes[k]) {
        // tópico de uma disciplina que não foi declarada: cria a raiz implicitamente
        const impl = { codigo: null, nome: r.disciplina || '(sem disciplina)', depth: 0, disciplina: r.disciplina, questoes: 0, acertos: 0, pctAcerto: 0, children: [] };
        discNodes[k] = impl; byCodigo[k] = {}; forest.push(impl);
      }
      const node = mkNode(r);
      if (r.codigo) byCodigo[k][r.codigo] = node;
      pendentes.push({ node, k, codigo: r.codigo });
    });
    // 2ª passada: liga cada nó ao pai pelo prefixo do código (independe da ordem de leitura)
    pendentes.forEach(({ node, k, codigo }) => {
      const disc = discNodes[k];
      if (!codigo) { disc.children.push(node); return; }
      const parts = codigo.split('.');
      const parentCodigo = parts.slice(0, -1).join('.');
      const parent = (parts.length > 1 && byCodigo[k][parentCodigo]) ? byCodigo[k][parentCodigo] : disc;
      parent.children.push(node);
    });
    // ordena os filhos pelo código, para a árvore consolidada não sair embaralhada
    const cmp = (a, b) => String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true });
    const sortRec = (n) => { n.children.sort(cmp); n.children.forEach(sortRec); };
    forest.forEach(sortRec);
    return forest;
  }
};
