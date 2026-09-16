import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('companion/manifest.json'));
const watchdog = read('companion/src/tec-capture-watchdog.js');
const main = read('companion/src/tec-content.js');

const tecScript = (manifest.content_scripts || []).find(x => (x.matches || []).some(m => m.includes('tecconcursos.com.br')) && (x.js || []).includes('src/tec-content.js'));
const checks = [
  ['Companion foi versionado após correção', manifest.version === '1.1.1'],
  ['watchdog é carregado depois do capturador principal', !!tecScript && JSON.stringify(tecScript.js) === JSON.stringify(['src/tec-content.js','src/tec-capture-watchdog.js'])],
  ['watchdog roda em todos os frames TEC', !!tecScript && tecScript.all_frames === true],
  ['watchdog observa transição de resultado', watchdog.includes('checkTransition') && watchdog.includes('MutationObserver')],
  ['watchdog dá janela ao capturador principal', watchdog.includes('GRACE_MS') && watchdog.includes('mainCaptureStatus')],
  ['watchdog respeita status já capturado', watchdog.includes("['queued','staged','deduplicated']")],
  ['watchdog respeita captura em andamento', watchdog.includes("['waiting-result']") && watchdog.includes('WAITING_GRACE_MS')],
  ['fallback usa a mesma fila durável', watchdog.includes("const STAGE_PREFIX = 'snmTecStageV1:'") && watchdog.includes("kind:'capture'")],
  ['fallback preserva resposta marcada quando erro é visual', watchdog.includes('!acertou&&errado&&errado.letra')],
  ['fallback publica status diagnóstico', watchdog.includes("type:'watchdog'") && watchdog.includes("reportStatus(ok?'queued':'staged'")],
  ['capturador principal continua presente', main.includes('async function processPending') && main.includes('armPending')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`COMPANION WATCHDOG: ${checks.length}/${checks.length} contratos válidos.`);
