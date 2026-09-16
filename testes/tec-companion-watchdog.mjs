import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('companion/manifest.json'));
const watchdog = read('companion/src/tec-capture-watchdog.js');
const main = read('companion/src/tec-content.js');
const integrity = read('companion/src/tec-integrity-guard.js');

const tecScript = (manifest.content_scripts || []).find(x => (x.matches || []).some(m => m.includes('tecconcursos.com.br')) && (x.js || []).includes('src/tec-content.js'));
const order = tecScript ? tecScript.js || [] : [];
const checks = [
  ['Companion mantém versão de compatibilidade', manifest.version === '1.1.1'],
  ['guarda de integridade é carregada antes do capturador', !!tecScript && order.indexOf('src/tec-integrity-guard.js') >= 0 && order.indexOf('src/tec-integrity-guard.js') < order.indexOf('src/tec-content.js')],
  ['watchdog é carregado depois do capturador principal', !!tecScript && order.indexOf('src/tec-content.js') >= 0 && order.indexOf('src/tec-capture-watchdog.js') > order.indexOf('src/tec-content.js')],
  ['watchdog roda em todos os frames TEC', !!tecScript && tecScript.all_frames === true],
  ['guarda reconcilia marcada x gabarito', integrity.includes("source = 'marked-vs-gabarito'") && integrity.includes('canonical = marked === correct')],
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
