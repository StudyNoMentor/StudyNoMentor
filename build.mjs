#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   MONTADOR — src/  ->  index.html
   ───────────────────────────────────────────────────────────────────────────
   O que é publicado continua sendo UM arquivo: index.html, sem build step para
   quem só quer usar o app. Este montador existe para quem vai MANTER o código.

   Regra que torna isto seguro: a montagem é uma CONCATENAÇÃO LITERAL. Nada é
   minificado, transpilado, reordenado ou reescrito. O index.html gerado é
   BYTE A BYTE igual ao que já estava no repositório — `node build.mjs --check`
   prova isso e falha se alguém quebrar a equivalência.

   Uso:
     node build.mjs            monta src/ -> index.html
     node build.mjs --check    monta em memória e compara com o index.html atual
                               (não escreve nada; sai com código 1 se divergir)

   Por que NÃO viramos módulos ES de verdade (<script type="module" src=...>):
     1) o app tem de abrir por file:// — módulos ES são bloqueados por CORS aí;
     2) seriam ~45 requisições em vez de 1, e o app é offline-first;
     3) a CSP teria de afrouxar;
     4) o escopo global compartilhado é premissa do código atual — converter
        para import/export seria uma reescrita, não uma reorganização.
   A separação em src/ dá a manutenção sem pagar nenhum desses preços.
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const ler = (p) => readFileSync(join(RAIZ, 'src', p), 'utf8');

/* A montagem também produz o MAPA (src/manifesto.json): qual faixa de linhas do
   index.html veio de qual arquivo. Ele existe para quem precisa ir de uma linha
   do arquivo publicado até a fonte dela — e um mapa desatualizado é pior que
   nenhum, porque manda a pessoa para o lugar errado. Por isso ele é gerado
   AQUI, junto com o index.html, em vez de mantido à mão. */
const SEGMENTOS = [];
const S = (p) => { const t = ler(p); SEGMENTOS.push({ arquivo: p, texto: t }); return t; };
const SEP = (t) => { SEGMENTOS.push({ texto: t }); return t; };

/* A ordem abaixo é a ordem FÍSICA no index.html. Os separadores estruturais
   (as próprias tags <style>/<script> que embrulham os blocos) moram aqui, e não
   nos módulos, para que cada arquivo de src/ seja CSS ou JS puro — editável com
   realce de sintaxe e verificável com `node --check`. */
const PARTES = [
  S('html/00-cabecalho.html'),
  SEP('\n<style>\n'),            S('css/01-base.css'),
  SEP('\n</style>\n\n<style id="study-report-styles">\n'), S('css/02-relatorio.css'),
  SEP('\n</style>\n\n'),         S('html/03-corpo.html'),
  SEP('\n    <style>\n'),        S('css/04-tec-inline.css'),
  SEP('\n  </style>\n'),         S('html/05-corpo-cont.html'),
  SEP('\n<style id="ux-v47">\n'), S('css/06-ux-v47.css'),
  SEP('\n</style>\n\n<style id="ux-v48">\n'), S('css/07-ux-v48.css'),
  SEP('\n</style>\n\n<style id="ux-v49">\n'), S('css/08-ux-v49.css'),
  SEP('\n</style>\n\n<script id="app-code" type="application/x-diario-inert">\n'),
  // ── código do app: um único escopo global, na ordem de dependência ──
  [
    'js/10-infra.js',
    'js/11-db.js',
    'js/12-planos-perfis.js',
    'js/13-historico-versoes.js',
    'js/14-navegacao-e-dialogos.js',
    'js/15-saveguard.js',
    'js/16-planilhas-e-tec.js',
    'js/17-reforco.js',
    'js/20-tela-registrar.js',
    'js/21-tela-ciclo.js',
    'js/22-leis-engine.js',
    'js/30-fsrs.js',
    'js/31-cards-config.js',
    'js/32-card-engine.js',
    'js/33-tela-grade.js',
    'js/40-tela-historico.js',
    'js/41-tela-evolucao.js',
    'js/42-tela-estudo-novo.js',
    'js/43-tela-leis.js',
    'js/44-tela-cards.js',
    'js/45-autoteste.js',
    'js/46-sanitizacao-e-editor.js',
    'js/47-tela-extras.js',
    'js/48-tela-links.js',
    'js/49-tela-config.js',
    'js/50-tela-ferramentas.js',
    'js/51-tela-desempenho-tec.js',
    'js/51a-tec-scope-consistency.js',
    'js/51b-reforco-agenda-auto.js',
    'js/52-tela-planejamentos.js',
    'js/53-portao-de-acesso.js',
    'js/60-cloud-store.js',
    'js/61-session-guard.js',
    'js/62-section-sync.js',
    'js/63-cloud-ui.js',
    'js/64-info-tips.js',
    'js/65-recuperacao.js',
    'js/66-backup-nuvem.js',
    'js/67-atualizacao.js',
    'js/70-relatorio.js',
    'js/71-auditoria-plano.js',
    'js/80-ajustes-finais.js',
  ].map((m, i, todos) => { const t = S(m); if (i < todos.length - 1) SEP('\n'); return t; }).join('\n'),
  SEP('\n'),
  S('html/90-rodape.html'),
];

/* ── CARIMBO DE VERSÃO ─────────────────────────────────────────────────────
   O nome do cache do service worker era fixo ("diario-v2") e nunca mudava
   entre publicações. O efeito prático: a limpeza de caches antigos, que roda na
   ativação e apaga tudo que não começa com a versão atual, NUNCA tinha o que
   apagar — o cache velho continuava com o mesmo nome do novo. Era daí que vinha
   "atualizei e o app ficou estranho": ativos de duas versões convivendo no mesmo
   balde, e código novo esbarrando em resto de código velho.

   A versão passa a ser um resumo do conteúdo de src/. Ela muda sozinha a cada
   alteração real, dá um nome NOVO ao cache (o antigo é descartado na ativação,
   sem ninguém precisar pedir) e aparece no diagnóstico, para que "qual versão
   está rodando aqui?" tenha resposta.

   O resumo é calculado sobre a MONTAGEM SEM O CARIMBO — assim ele não depende
   de si mesmo, e `--check` reproduz o mesmo byte a byte. */
const semCarimbo = PARTES.join('');
const VERSAO = 'v' + createHash('sha256').update(semCarimbo).digest('hex').slice(0, 10);
const montado = semCarimbo.replace('<meta name="diario-versao" content="dev">',
                                   `<meta name="diario-versao" content="${VERSAO}">`);
const destino = join(RAIZ, 'index.html');

/* O sw.js não é montado a partir de src/ (ele é servido como arquivo próprio),
   então o carimbo é gravado nele por substituição de linha. */
function carimbarServiceWorker() {
  const swPath = join(RAIZ, 'sw.js');
  let sw;
  try { sw = readFileSync(swPath, 'utf8'); } catch { return null; }
  const novo = sw.replace(/^const VERSAO = '[^']*';$/m, `const VERSAO = '${VERSAO}';`);
  if (novo === sw) return sw;      // já estava igual
  writeFileSync(swPath, novo, 'utf8');
  return novo;
}

/* Faixas de linha: "de" é a primeira linha que o arquivo ocupa no index.html e
   "ate" a última. A contagem acompanha as quebras de linha acumuladas, então os
   separadores estruturais entram na conta sem virar entradas do mapa. */
function montarManifesto() {
  const out = [];
  let nl = 0;
  for (const seg of SEGMENTOS) {
    const linhas = seg.texto.split('\n').length;
    // um arquivo que termina em quebra de linha não "ocupa" a linha vazia
    // seguinte: ela já pertence ao que vem depois dele.
    const ate = nl + linhas - (seg.texto.endsWith('\n') ? 1 : 0);
    if (seg.arquivo) out.push({ arquivo: seg.arquivo, de: nl + 1, ate });
    nl += linhas - 1;
  }
  return JSON.stringify(out, null, 1) + '\n';
}

if (process.argv.includes('--check')) {
  const atual = readFileSync(destino, 'utf8');
  // o sw.js publicado tem de carregar a MESMA versão do index.html publicado —
  // um carimbo defasado ali significa cache com nome errado
  const swAtual = readFileSync(join(RAIZ, 'sw.js'), 'utf8');
  const swVersao = (swAtual.match(/^const VERSAO = '([^']*)';$/m) || [])[1];
  if (swVersao !== VERSAO) {
    console.error(`DIVERGENCIA: sw.js carimbado como "${swVersao}", src/ monta "${VERSAO}".`);
    console.error('Rode `node build.mjs` para recarimbar.');
    process.exit(1);
  }
  if (atual === montado) {
    console.log(`OK: src/ monta exatamente o index.html atual (${montado.length} bytes, ${VERSAO}).`);
    process.exit(0);
  }
  // Diagnóstico útil: aponta a PRIMEIRA linha divergente, não só "difere".
  const a = atual.split('\n'), b = montado.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.error('DIVERGENCIA entre src/ e index.html.');
  console.error(`  primeira linha diferente: ${i + 1}`);
  console.error(`  index.html : ${JSON.stringify((a[i] ?? '<fim do arquivo>').slice(0, 140))}`);
  console.error(`  src/       : ${JSON.stringify((b[i] ?? '<fim do arquivo>').slice(0, 140))}`);
  console.error(`  (${a.length} linhas no index.html, ${b.length} montadas)`);
  console.error('\nSe a mudanca foi feita direto no index.html, leve-a para src/.');
  console.error('Se foi feita em src/, rode `node build.mjs` para regravar o index.html.');
  process.exit(1);
}

writeFileSync(destino, montado, 'utf8');
writeFileSync(join(RAIZ, 'src', 'manifesto.json'), montarManifesto(), 'utf8');
carimbarServiceWorker();
console.log(`index.html gravado a partir de src/ (${montado.length} bytes, ${VERSAO}) + src/manifesto.json + sw.js.`);
