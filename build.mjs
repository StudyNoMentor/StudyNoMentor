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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const ler = (p) => readFileSync(join(RAIZ, 'src', p), 'utf8');

/* A ordem abaixo é a ordem FÍSICA no index.html. Os separadores estruturais
   (as próprias tags <style>/<script> que embrulham os blocos) moram aqui, e não
   nos módulos, para que cada arquivo de src/ seja CSS ou JS puro — editável com
   realce de sintaxe e verificável com `node --check`. */
const PARTES = [
  ler('html/00-cabecalho.html'),
  '\n<style>\n',            ler('css/01-base.css'),
  '\n</style>\n\n<style id="study-report-styles">\n', ler('css/02-relatorio.css'),
  '\n</style>\n\n',         ler('html/03-corpo.html'),
  '\n    <style>\n',        ler('css/04-tec-inline.css'),
  '\n  </style>\n',         ler('html/05-corpo-cont.html'),
  '\n<style id="ux-v47">\n', ler('css/06-ux-v47.css'),
  '\n</style>\n\n<style id="ux-v48">\n', ler('css/07-ux-v48.css'),
  '\n</style>\n\n<script id="app-code" type="application/x-diario-inert">\n',
  // ── código do app: um único escopo global, na ordem de dependência ──
  ...[
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
    'js/52-tela-planejamentos.js',
    'js/53-portao-de-acesso.js',
    'js/60-cloud-store.js',
    'js/61-session-guard.js',
    'js/62-section-sync.js',
    'js/63-cloud-ui.js',
    'js/64-info-tips.js',
    'js/70-relatorio.js',
    'js/80-ajustes-finais.js',
  ].map(ler).join('\n'),
  '\n',
  ler('html/90-rodape.html'),
];

const montado = PARTES.join('');
const destino = join(RAIZ, 'index.html');

if (process.argv.includes('--check')) {
  const atual = readFileSync(destino, 'utf8');
  if (atual === montado) {
    console.log(`OK: src/ monta exatamente o index.html atual (${montado.length} bytes).`);
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
console.log(`index.html gravado a partir de src/ (${montado.length} bytes).`);
