#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   MONTADOR — src/  ->  index.html
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const ler = (p) => readFileSync(join(RAIZ, 'src', p), 'utf8');
const SEGMENTOS = [];
const S = (p) => { const t = ler(p); SEGMENTOS.push({ arquivo: p, texto: t }); return t; };
const SEP = (t) => { SEGMENTOS.push({ texto: t }); return t; };

const PARTES = [
  S('html/00-cabecalho.html'),
  SEP('\n<style>\n'),            S('css/01-base.css'),
  SEP('\n</style>\n\n<style id="study-report-styles">\n'), S('css/02-relatorio.css'),
  SEP('\n</style>\n\n'),         S('html/03-corpo.html'),
  SEP('\n    <style>\n'),        S('css/04-tec-inline.css'),
  SEP('\n  </style>\n'),         S('html/05-corpo-cont.html'),
  SEP('\n<style id="ux-base">\n'), S('css/06-ux-base.css'),
  SEP('\n</style>\n\n<style id="ux-layout">\n'), S('css/07-ux-layout.css'),
  SEP('\n</style>\n\n<style id="ux-components">\n'), S('css/08-ux-components.css'),
  SEP('\n</style>\n\n<style id="extras">\n'), S('css/09-extras.css'),
  SEP('\n</style>\n\n<style id="lei-rodizio">\n'), S('css/10-lei-rodizio.css'),
  SEP('\n</style>\n\n<style id="extras-governanca">\n'), S('css/11-extras-governanca.css'),
  SEP('\n</style>\n\n<style id="tec-premium">\n'), S('css/12-tec-premium.css'),
  SEP('\n</style>\n\n<style id="extras-central">\n'), S('css/13-extras-central.css'),
  SEP('\n</style>\n\n<style id="tec-layout">\n'), S('css/14-tec-layout.css'),
  SEP('\n</style>\n\n<style id="reforco-adaptativo">\n'), S('css/15-reforco-adaptativo.css'),
  SEP('\n</style>\n\n<style id="extras-stability">\n'), S('css/16-extras-stability.css'),
  SEP('\n</style>\n\n<style id="interaction-feedback">\n'), S('css/17-interaction-feedback.css'),
  SEP('\n</style>\n\n<style id="extras-ux100">\n'), S('css/18-extras-ux100.css'),
  SEP('\n</style>\n\n<style id="tec-auditoria">\n'), S('css/19-tec-auditoria.css'),
  SEP('\n</style>\n\n<style id="ux-stability">\n'), S('css/20-ux-stability.css'),
  SEP('\n</style>\n\n<style id="startup-spinners-reforco">\n'), S('css/21-startup-spinners-reforco.css'),
  SEP('\n</style>\n\n<style id="plano-sugestoes">\n'), S('css/22-plano-sugestoes.css'),
  SEP('\n</style>\n\n<style id="plano-robusto">\n'), S('css/23-plano-robusto.css'),
  SEP('\n</style>\n\n<style id="plano-motores-governanca">\n'), S('css/24-plano-motores-governanca.css'),
  SEP('\n</style>\n\n<style id="plano-motores-central-tec">\n'), S('css/25-plano-motores-central-tec.css'),
  SEP('\n</style>\n\n<style id="tec-plano-fonte-motor">\n'), S('css/26-tec-plano-fonte-motor.css'),
  SEP('\n</style>\n\n<style id="ux-hierarquia">\n'), S('css/27-ux-hierarquia.css'),
  SEP('\n</style>\n\n<style id="tec-integracao">\n'), S('css/28-tec-integracao.css'),
  SEP('\n</style>\n\n<script id="app-code" type="application/x-diario-inert">\n'),
  [
    'js/10-infra.js','js/11-db.js','js/12-planos-perfis.js','js/13-backups-locais.js','js/14-navegacao-e-dialogos.js','js/15-saveguard.js','js/16-planilhas-e-tec.js','js/17-reforco.js','js/20-tela-registrar.js','js/21-tela-ciclo.js','js/22-leis-engine.js','js/30-fsrs.js','js/31-cards-config.js','js/32-card-engine.js','js/33-tela-grade.js','js/40-tela-historico.js','js/41-tela-evolucao.js','js/42-tela-estudo-novo.js','js/43-tela-leis.js','js/44-tela-cards.js','js/45-autoteste.js','js/46-sanitizacao-e-editor.js','js/47-tela-extras.js','js/48-tela-links.js','js/49-tela-config.js','js/50-tela-ferramentas.js','js/51-tela-desempenho-tec.js','js/52-tela-planejamentos.js','js/53-portao-de-acesso.js','js/54-reforco-fila.js','js/55-extras-ui-moderna.js','js/56-leis-rodizio.js','js/57-extras-lei-fonte.js','js/58-extras-governanca.js','js/59-tec-premium.js','js/59-extras-central-ui.js','js/59-reforco-adaptativo.js','js/59-tec-layout.js','js/59-extras-stability.js','js/59-interaction-feedback.js','js/59-extras-ux100.js','js/59-tec-auditoria.js','js/60-cloud-store.js','js/61-session-guard.js','js/62-section-sync.js','js/63-cloud-ui.js','js/64-info-tips.js','js/65-recuperacao.js','js/66-backup-nuvem.js','js/67-atualizacao.js','js/70-relatorio.js','js/71-auditoria-plano.js','js/80-ajustes-finais.js','js/81-ux-stability.js','js/82-startup-spinners-reforco-continuo.js','js/83-extras-plano-continuidade.js','js/84-reforco-continuidade.js','js/84b-reforco-tec-extras.js','js/86-plano-sugestoes-infra.js','js/87-plano-sugestoes-simplificado.js','js/88-plano-sugestoes-robusto.js','js/89-plano-sugestoes-controller.js','js/89a-plano-robusto-audit-log.js','js/90-plano-motores-governanca.js','js/91-plano-motores-central-tec.js','js/92-tec-plano-fonte-motor.js','js/93-ux-hierarquia.js','js/94-tec-integracao.js','js/95-tec-companion.js','js/96-tec-capture-diagnostics.js'
  ].map((m, i, todos) => { const t = S(m); if (i < todos.length - 1) SEP('\n'); return t; }).join('\n'),
  SEP('\n'),
  S('html/90-rodape.html'),
];

const semCarimbo = PARTES.join('');
const VERSAO = 'v' + createHash('sha256').update(semCarimbo).digest('hex').slice(0, 10);
const montado = semCarimbo.replace('<meta name="diario-versao" content="dev">', `<meta name="diario-versao" content="${VERSAO}">`);
const destino = join(RAIZ, 'index.html');

function carimbarServiceWorker() {
  const swPath = join(RAIZ, 'sw.js');
  let sw;
  try { sw = readFileSync(swPath, 'utf8'); } catch { return null; }
  const novo = sw.replace(/^const VERSAO = '[^']*';$/m, `const VERSAO = '${VERSAO}';`);
  if (novo === sw) return sw;
  writeFileSync(swPath, novo, 'utf8');
  return novo;
}
function montarManifesto() {
  const out = []; let nl = 0;
  for (const seg of SEGMENTOS) {
    const linhas = seg.texto.split('\n').length;
    const ate = nl + linhas - (seg.texto.endsWith('\n') ? 1 : 0);
    if (seg.arquivo) out.push({ arquivo: seg.arquivo, de: nl + 1, ate });
    nl += linhas - 1;
  }
  return JSON.stringify(out, null, 1) + '\n';
}
if (process.argv.includes('--check')) {
  const atual = readFileSync(destino, 'utf8');
  const swAtual = readFileSync(join(RAIZ, 'sw.js'), 'utf8');
  const swVersao = (swAtual.match(/^const VERSAO = '([^']*)';$/m) || [])[1];
  if (swVersao !== VERSAO) {
    console.error(`DIVERGENCIA: sw.js carimbado como "${swVersao}", src/ monta "${VERSAO}".`);
    console.error('Rode `node build.mjs` para recarimbar.'); process.exit(1);
  }
  if (atual === montado) { console.log(`OK: src/ monta exatamente o index.html atual (${montado.length} bytes, ${VERSAO}).`); process.exit(0); }
  const a = atual.split('\n'), b = montado.split('\n'); let i = 0;
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
