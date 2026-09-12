#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   FIDELIDADE DA IMPORTAÇÃO DO TEC — o que entra é exatamente o que o arquivo diz
   ───────────────────────────────────────────────────────────────────────────
   Este recurso é a fonte de TODO número do Desempenho TEC e do Plano: se a
   importação erra uma contagem, erra o domínio, a fila de ataque, o custo, a
   nota projetada e a decisão do aluno — em silêncio, porque não há com o que
   comparar depois. Por isso ele tem um teste próprio, fora do navegador, que
   parte dos BYTES de um .xlsx e vai até os totais.

   Os arquivos são GERADOS aqui, com a mesma estrutura dos exports reais do
   TecConcursos (conferida contra três arquivos de verdade: dois de desempenho,
   de 434 e 201 linhas, e um índice de caderno de 1.663 linhas):

     DESEMPENHO   Hierarquia | índice | Questões Resolvidas | Acertos (%) |
                  Quantidade de acertos | Erros (%) | Quantidade de erros | Peso
       · a linha da DISCIPLINA vem com a Hierarquia VAZIA;
       · os tópicos têm código hierárquico (01, 01.02, 01.02.01);
       · o pai já contém a SOMA dos filhos — somar tudo conta 3× o mesmo acerto;
       · cada disciplina termina com "Sem Classificação", também SEM código:
         as questões dela que não têm assunto atribuído;
       · a coluna "Acertos (%)" é ARREDONDADA; as duas contagens são exatas.

     INCIDÊNCIA   Hierarquia | Índice | Quantidade | Porcentagem
       · mesma hierarquia, e o pai também é a soma dos filhos;
       · a primeira linha pode sair como "0 1 2 3" (índices de coluna);
       · "Sem Classificação" aqui vem COM código, como tópico da disciplina.

   As invariantes cobradas são as que sustentam todo o resto:
     1. nada some: cada linha do arquivo vira uma linha no app, com os mesmos
        números, o mesmo código e a mesma profundidade;
     2. o total NÃO dupla-conta: Σ(disciplinas) = Σ(folhas) = total do arquivo;
     3. a taxa de acerto vem das CONTAGENS, nunca da % arredondada do arquivo;
     4. "Sem Classificação" conta para a disciplina dela — nem como disciplina
        nova (inflava o total), nem descartada (sumia do Plano);
     5. a incidência por disciplina soma o caderno inteiro, uma vez só.

   Uso:  node testes/fidelidade-tec.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import vm from 'node:vm';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(RAIZ, 'src', 'js', f), 'utf8');

/* ── Dublês mínimos: os dois módulos de importação são PUROS de propósito ──
   Se um dia algum deles passar a depender do DOM ou do armazenamento, este
   teste quebra — e isso é a intenção. */
const ctx = {
  console, Math, Date, Array, Object, JSON, isFinite, isNaN, parseInt, parseFloat,
  Number, String, Set, Map, RegExp, Error, Promise, Intl, window: {},
  TextDecoder, TextEncoder, Uint8Array, DataView, Blob, Response, DecompressionStream,
  _quiet: () => {}, escapeHtml: (s) => String(s == null ? '' : s),
  DB: { getTecSnapshots: () => [], getIncidencia: () => [] },
};
vm.createContext(ctx);
vm.runInContext(src('16-planilhas-e-tec.js') + '\n;globalThis.__M=MiniXLSX; globalThis.__T=TecEngine;', ctx);
vm.runInContext(src('17-reforco.js') + '\n;globalThis.__R=ReforcoEngine;', ctx);
const MiniXLSX = ctx.__M, TecEngine = ctx.__T, ReforcoEngine = ctx.__R;

let falhas = 0, checagens = 0;
const ok = (m) => console.log('  ✓ ' + m);
const ck = (nome, obtido, esperado) => {
  checagens++;
  const passa = (typeof obtido === 'number' && typeof esperado === 'number')
    ? Math.abs(obtido - esperado) < 1e-9 : obtido === esperado;
  if (passa) ok(`${nome} (${obtido})`);
  else { falhas++; console.error(`  ✗ ${nome}: app=${JSON.stringify(obtido)} esperado=${JSON.stringify(esperado)}`); }
};

/* ── ESCRITOR MÍNIMO DE .XLSX ──────────────────────────────────────────────
   Escreve um ZIP de verdade (deflate-raw, como o Excel) com uma planilha de
   strings inline. Existe para o teste começar nos BYTES: testar só o parser
   deixaria de fora o leitor embutido, que é quem lê o arquivo de verdade —
   e foi ele que já precisou lidar com <dimension> errado e célula sem tipo. */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function zip(arquivos) {
  const locais = [], centrais = [];
  let off = 0;
  for (const { nome, texto } of arquivos) {
    const cru = Buffer.from(texto, 'utf8');
    const comp = deflateRawSync(cru);
    const crc = CRC(cru), nomeB = Buffer.from(nome, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(cru.length, 22);
    lh.writeUInt16LE(nomeB.length, 26); lh.writeUInt16LE(0, 28);
    locais.push(lh, nomeB, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(cru.length, 24);
    ch.writeUInt16LE(nomeB.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(off, 42);
    centrais.push(ch, nomeB);
    off += lh.length + nomeB.length + comp.length;
  }
  const cd = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(arquivos.length, 8); eocd.writeUInt16LE(arquivos.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locais, cd, eocd]));
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function planilha(linhas) {
  const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const corpo = linhas.map((cels, i) => '<row r="' + (i + 1) + '">' + cels.map((v, j) =>
    `<c r="${LET[j]}${i + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('') + '</row>').join('');
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A1"/><sheetData>${corpo}</sheetData></worksheet>`;
  return zip([
    { nome: '[Content_Types].xml', texto: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    { nome: 'xl/workbook.xml', texto: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Desempenho" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { nome: 'xl/_rels/workbook.xml.rels', texto: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { nome: 'xl/worksheets/sheet1.xml', texto: sheet },
  ]);
}

/* ── O RETRATO DE DESEMPENHO, COM A ESTRUTURA DO ARQUIVO REAL ─────────────
   Três disciplinas: uma com três níveis de aninhamento, uma rasa e uma que só
   tem questões sem classificação. Os números são escolhidos para que NENHUMA
   soma errada passe por coincidência (folhas 7+5+3+2+9+4+6 não bate com
   nenhuma outra combinação dos totais). */
const CAB_DES = ['Hierarquia', 'índice', 'Questões Resolvidas', 'Acertos (%)',
  'Quantidade de acertos', 'Erros (%)', 'Quantidade de erros', 'Peso'];
// [código, nome, questões, acertos]  — a % é derivada, como no arquivo
const FOLHAS = [
  ['01.01.01', 'Princípios Orçamentários', 7, 5],
  ['01.01.02', 'PPA', 5, 1],
  ['01.02', 'Créditos Adicionais', 3, 3],
  ['02.01', 'Receita Pública', 2, 0],
];
const DES = [
  [null, 'AFO e Contabilidade Pública', 19, 10],      // 7+5+3+2 folhas + 2 sem classificação
  ['01', 'Orçamento Público', 15, 9],                  // 7+5+3
  ['01.01', 'Instrumentos Orçamentários', 12, 6],      // 7+5
  FOLHAS[0], FOLHAS[1], FOLHAS[2],
  ['02', 'Receita e Despesa', 2, 0],
  FOLHAS[3],
  [null, 'Sem Classificação', 2, 1],                   // pertence a AFO
  [null, 'Auditoria', 9, 8],
  ['01', 'Auditoria Independente', 9, 8],
  ['01.01', 'Amostragem', 9, 8],
  [null, 'Direito Penal', 4, 1],
  [null, 'Sem Classificação', 4, 1],                   // disciplina inteira sem assunto
];
function linhaDes([cod, nome, q, ac]) {
  const pct = q > 0 ? Math.round(ac / q * 100) : 0;      // arredondada, como no arquivo
  return [cod == null ? '' : cod, nome, String(q), String(pct), String(ac), String(100 - pct), String(q - ac), '1'];
}
const TOTAL_Q = 19 + 9 + 4, TOTAL_AC = 10 + 8 + 1;       // Σ das três disciplinas
const FOLHAS_Q = 7 + 5 + 3 + 2 + 9 + 2 + 4;              // folhas + os dois baldes sem classificação
const FOLHAS_AC = 5 + 1 + 3 + 0 + 8 + 1 + 1;

console.log('\n1) desempenho: cada linha do arquivo, com os números do arquivo');
{
  const u8 = planilha([CAB_DES, ...DES.map(linhaDes)]);
  const { rows: cells } = await MiniXLSX.readFirstSheet(u8);
  ck('o leitor embutido devolve todas as linhas', cells.length, DES.length + 1);
  const rows = TecEngine.parseCellRows(cells);
  ck('linhas reconhecidas (sem o cabeçalho)', rows.length, DES.length);
  ck('disciplinas reconhecidas', rows.filter(r => r.depth === 0).length, 3);
  ck('profundidade do código 01.01.01', (rows.find(r => r.codigo === '01.01.01') || {}).depth, 3);
  ck('peso lido da 8ª coluna', rows[0].peso, 1);
  // cada linha, valor a valor e na ordem
  let dif = 0;
  DES.forEach((d, i) => {
    const r = rows[i], semCl = /^sem classifica/i.test(d[1]);
    const codEsp = d[0] == null ? null : d[0];
    const depthEsp = d[0] == null ? (semCl ? 1 : 0) : d[0].split('.').length;
    if (!r || r.codigo !== codEsp || r.nome !== d[1] || r.questoes !== d[2] || r.acertos !== d[3] || r.depth !== depthEsp) {
      dif++; console.error(`    ✗ linha ${i}: ${JSON.stringify(r)} ≠ ${JSON.stringify(d)} (depth esperado ${depthEsp})`);
    }
  });
  ck('nenhuma linha divergente', dif, 0);
}

console.log('\n2) o total não dupla-conta (o pai já é a soma dos filhos)');
{
  const rows = TecEngine.parseCellRows(await lerCelulas([CAB_DES, ...DES.map(linhaDes)]));
  const t = TecEngine.totais({ rows });
  ck('TOTAL questões = Σ das disciplinas', t.questoes, TOTAL_Q);
  ck('TOTAL acertos = Σ das disciplinas', t.acertos, TOTAL_AC);
  ck('% geral vem das contagens', t.pct, Math.round(TOTAL_AC / TOTAL_Q * 1000) / 10);
  ck('disciplinas contadas', t.disciplinas, 3);
  const cru = rows.reduce((a, r) => a + r.questoes, 0);
  ck('a soma CRUA de todas as linhas é maior (a armadilha existe)', cru > TOTAL_Q, true);
  // as FOLHAS — é o que o Plano usa — têm de fechar com o total
  const folhas = rows.filter(r => r.depth > 0).filter(r => {
    if (!r.codigo) return true;
    return !rows.some(o => o !== r && o.disciplina === r.disciplina && o.codigo &&
      String(o.codigo).startsWith(String(r.codigo) + '.'));
  });
  ck('Σ folhas = questões do arquivo', folhas.reduce((a, r) => a + r.questoes, 0), FOLHAS_Q);
  ck('Σ folhas = TOTAL (o Plano vê o mesmo volume da Análise)', folhas.reduce((a, r) => a + r.questoes, 0), TOTAL_Q);
  ck('Σ acertos das folhas = TOTAL', folhas.reduce((a, r) => a + r.acertos, 0), TOTAL_AC);
  ck('acertos das folhas conferem com o arquivo', folhas.reduce((a, r) => a + r.acertos, 0), FOLHAS_AC);
}

console.log('\n3) "Sem Classificação" é assunto da disciplina, não disciplina nova');
{
  const rows = TecEngine.parseCellRows(await lerCelulas([CAB_DES, ...DES.map(linhaDes)]));
  const sem = rows.filter(r => /^sem classifica/i.test(r.nome));
  ck('as duas linhas continuam no retrato', sem.length, 2);
  ck('nenhuma virou disciplina', sem.filter(r => r.depth === 0).length, 0);
  ck('a primeira pertence à disciplina que a precede', sem[0].disciplina, 'AFO e Contabilidade Pública');
  ck('a segunda também', sem[1].disciplina, 'Direito Penal');
  ck('entram sem código (são folhas)', sem.every(r => r.codigo == null), true);
  // e a disciplina seguinte NÃO herda o nome do balde
  ck('a disciplina depois do balde é lida corretamente', rows.find(r => r.nome === 'Auditoria').depth, 0);
  ck('os tópicos depois do balde pertencem à disciplina certa',
    rows.find(r => r.nome === 'Amostragem').disciplina, 'Auditoria');
  // sem disciplina anterior, o balde continua sendo o que o arquivo diz
  const sozinho = TecEngine.parseCellRows(await lerCelulas([CAB_DES, linhaDes([null, 'Sem Classificação', 3, 2])]));
  ck('balde sem disciplina antes dele não é descartado', sozinho.length, 1);
  ck('e continua contando no total', TecEngine.totais({ rows: sozinho }).questoes, 3);
}

console.log('\n4) a taxa vem das contagens, não da % arredondada do arquivo');
{
  // 13 de 22 é 59,0909…%; o arquivo escreve 59
  const rows = TecEngine.parseCellRows(await lerCelulas([CAB_DES,
    ['', 'Matéria', '22', '59', '13', '41', '9', '1'],
    ['01', 'Assunto', '22', '59', '13', '41', '9', '1']]));
  ck('pctAcerto é a taxa exata', rows[0].pctAcerto, Math.round(13 / 22 * 1000) / 10);
  ck('e não o 59 do arquivo', rows[0].pctAcerto === 59, false);
  ck('a % crua da coluna fica guardada à parte', rows[0].pctColuna, 59);
  // sem a coluna de quantidade, a % do arquivo é a única fonte
  const semQtd = TecEngine.parseCellRows(await lerCelulas([
    ['Hierarquia', 'índice', 'Questões Resolvidas', 'Acertos (%)'],
    ['', 'Matéria', '10', '70']]));
  ck('sem "Quantidade de acertos", os acertos saem da %', semQtd[0].acertos, 7);
  ck('e a taxa segue coerente com eles', semQtd[0].pctAcerto, 70);
}

console.log('\n5) as colunas se ligam pelo CABEÇALHO (e não pela posição)');
{
  // mesma planilha com as colunas em outra ordem
  const rows = TecEngine.parseCellRows(await lerCelulas([
    ['Peso', 'Quantidade de acertos', 'índice', 'Questões Resolvidas', 'Hierarquia', 'Acertos (%)'],
    ['1', '13', 'Matéria', '22', '', '59'],
    ['1', '4', 'Assunto', '9', '01', '44']]));
  ck('disciplina lida na coluna certa', rows[0].nome, 'Matéria');
  ck('questões lidas na coluna certa', rows[0].questoes, 22);
  ck('acertos lidos na coluna certa', rows[0].acertos, 13);
  ck('código lido na coluna certa', rows[1].codigo, '01');
  ck('profundidade a partir do código', rows[1].depth, 1);
  // célula vazia no meio não desloca mais a linha inteira
  const comBuraco = TecEngine.parseCellRows(await lerCelulas([CAB_DES,
    ['', 'Matéria', '', '59', '13', '41', '9', '1']]));
  ck('questões ausentes não puxam a % para o lugar delas', comBuraco[0].acertos, 13);
  ck('e a linha não vira "59 questões"', comBuraco[0].questoes, 0);
}

console.log('\n6) linhas que não são dados: total, resumo e índice de coluna');
{
  const rows = TecEngine.parseCellRows(await lerCelulas([
    ['0', '1', '2', '3'],                                  // índices de coluna (export do TEC)
    ['Hierarquia', 'Índice', 'Quantidade', 'Porcentagem'],
    ['', 'Matéria', '10', '5%'],
    ['01', 'Assunto', '10', '5%'],
    ['', 'Total geral', '10', '5%'],
  ]));
  ck('a linha "0 1 2 3" não vira tópico', rows.filter(r => r.nome === '1').length, 0);
  ck('a linha de total não vira disciplina', rows.filter(r => /total/i.test(r.nome)).length, 0);
  ck('sobram só as duas linhas de dados', rows.length, 2);
}

/* ── INCIDÊNCIA ─────────────────────────────────────────────────────────── */
console.log('\n7) incidência: o índice do caderno, uma vez só');
const INC = [
  [null, 'Direito Tributário', 36, 1.00],
  ['01', 'Obrigação Tributária', 30, 0.83],
  ['01.01', 'Fato Gerador', 18, 0.50],
  ['01.02', 'Sujeição Passiva', 12, 0.33],
  ['02', 'Sem Classificação', 6, 0.17],
  [null, 'Administração Geral', 4, 0.11],
  ['01', 'Planejamento', 4, 0.11],
];
{
  const linhas = [['0', '1', '2', '3'], ['Hierarquia', 'Índice', 'Quantidade', 'Porcentagem'],
    ...INC.map(([c, n, q, p]) => [c == null ? '' : c, n, q.toFixed(1), p.toFixed(2) + '%'])];
  const cells = await lerCelulas(linhas);
  ck('o modelo "índice do caderno" é reconhecido', ReforcoEngine._looksLikeIndiceCaderno(cells), true);
  const recs = ReforcoEngine.parseIncidenciaCells(cells, 'FGV');
  ck('registros = linhas de dados', recs.length, INC.length);
  ck('nenhum registro fantasma da linha de índices', recs.filter(r => r.topico === '1').length, 0);
  ck('a incidência é a coluna "Quantidade"', recs.find(r => r.topico === 'Fato Gerador').incidencia, 18);
  ck('a % do caderno é preservada', recs.find(r => r.depth === 0).pct, 1);
  ck('"Sem Classificação" COM código continua tópico', recs.find(r => /sem classifica/i.test(r.topico)).depth, 1);
  ctx.DB.getIncidencia = () => recs;
  ReforcoEngine._incidCache = null;
  const porDisc = ReforcoEngine.incidPorDisciplina('__todas__');
  ck('cada disciplina vale a RAIZ dela (não a soma da árvore)', porDisc['Direito Tributário'], 36);
  ck('e a outra também', porDisc['Administração Geral'], 4);
  ck('o caderno inteiro, sem dupla contagem', Object.values(porDisc).reduce((a, v) => a + v, 0), 40);
  ck('disciplinas no mapa', Object.keys(porDisc).length, 2);
  const mapa = ReforcoEngine.incidenceMap('__todas__');
  // `incidenciaDe` devolve { valor, viaNome }: viaNome=false significa que casou
  // pela chave disciplina+tópico, sem precisar da queda por nome solto.
  const achado = ReforcoEngine.incidenciaDe(mapa, 'Fato Gerador', 'Direito Tributário');
  ck('o mapa casa por disciplina + tópico', achado.valor, 18);
  ck('e casou pela chave exata, não pela queda por nome', achado.viaNome, false);
  ck('o mesmo tópico de outra disciplina não soma junto',
    ReforcoEngine.incidenciaDe(mapa, 'Planejamento', 'Administração Geral').valor, 4);
}

async function lerCelulas(linhas) {
  return (await MiniXLSX.readFirstSheet(planilha(linhas))).rows;
}

console.log('');
if (falhas) { console.error(`FALHOU: ${falhas} de ${checagens} checagens.`); process.exit(1); }
console.log(`OK: ${checagens} checagens de fidelidade da importação.`);
