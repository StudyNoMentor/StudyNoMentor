import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/css/28-tec-integracao.css', 'utf8');
const js = readFileSync('src/js/98-tec-workbench-reforco-real.js', 'utf8');
const build = readFileSync('build.mjs', 'utf8');

// Regressão visual vista em produção: [hidden] não pode ser vencido por display:grid.
assert.match(css, /\.tec-workspace-placeholder\[hidden\]\s*\{\s*display:none\s*!important;/,
  'placeholder do TEC deve respeitar hidden explicitamente');
assert.match(css, /#tec-workspace-frame\[hidden\]\s*\{\s*display:none\s*!important;/,
  'iframe deve respeitar hidden explicitamente');

// A Integração TEC deve abrir como bancada, sem exigir um clique em um placeholder gigante.
assert.match(js, /T\.openEmbedded\(\);/,
  'workbench deve abrir o TEC automaticamente ao entrar na tela');
assert.match(js, /textContent='Resolver no TEC'/,
  'workspace deve usar título orientado à tarefa');

// O motor observacional não pode transformar um erro isolado e incerto em reforço.
assert.match(js, /const WINDOW_DAYS = 14;/,
  'janela recente deve ser explícita e auditável');
assert.match(js, /else if \(robust && g\.errors>=1\) kind='confirmed';/,
  'um erro pode virar evidência forte somente quando o Plano Robusto confirma o tópico');
assert.match(js, /else if \(g\.errors>=2\) kind='watch';/,
  'recorrência sem confirmação deve ficar apenas em observação');
assert.match(js, /lastCompleted && errorsAfter>=2/,
  'erros recorrentes após reforço concluído devem ser classificados como recaída');
assert.match(js, /activeIds:/,
  'snapshot deve identificar reforços ativos quando o contexto temporal é confiável');
assert.match(js, /completedIds:/,
  'snapshot deve identificar reforços concluídos quando o contexto temporal é confiável');
assert.match(js, /contextTemporalAccuracy:fresh \? 'near-resolution' : 'backfilled-current-state'/,
  'ledger deve diferenciar contexto capturado perto da resolução de backfill posterior');
assert.match(js, /planAtResolution:fresh \? plan : null/,
  'contexto atual não pode ser fingido como histórico em resoluções antigas');
assert.match(js, /String\(ev\.localDate\) > String\(cycle\.referenciaEm\)/,
  'sem horário preciso, erro do mesmo dia não pode ser chamado de posterior ao reforço');

// O arquivo novo precisa chegar ao index gerado.
assert.ok(build.includes("'js/98-tec-workbench-reforco-real.js'"),
  'build deve incluir o módulo de evidência real');

console.log('OK: workbench TEC e reforço por evidência real protegidos.');
