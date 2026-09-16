import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('companion/manifest.json'));
const tec = read('companion/src/tec-capture-v2.js');
const page = read('companion/src/tec-page.js');
const reconstruct = read('companion/src/tec-reconstruct.js');
const reconstructPressure = read('companion/src/tec-reconstruct-backpressure-v2.js');
const reconstructBg = read('companion/src/background-reconstruct.js');
const reconstructBridge = read('companion/src/study-reconstruct-bridge.js');

const scripts = manifest.content_scripts || [];
const normalMain = scripts.find(x => (x.js || []).includes('src/tec-page.js'));
const normalCapture = scripts.find(x => (x.js || []).includes('src/tec-capture-v2.js'));
const reconstructMain = scripts.find(x => (x.js || []).includes('src/tec-reconstruct-page.js'));

const checks = [
  ['Companion está na versão 1.4.1', manifest.version === '1.4.1'],
  ['captura TEC normal continua em todos os frames', normalMain?.all_frames === true && normalCapture?.all_frames === true],
  ['leitor MAIN da reconstrução fica no frame principal', !!reconstructMain && reconstructMain.world === 'MAIN' && reconstructMain.all_frames !== true],
  ['reconstrutor bloqueia captura normal na aba técnica', reconstruct.includes('window.__snmTecCompanionV2 = true') && reconstruct.includes('window.__snmTecCaptureWatchdog = true')],
  ['reconstrução aplica backpressure antes de continuar lotes', reconstructPressure.includes("kind:'tec-reconstruct-batch-state'") && reconstructPressure.includes('ACK_TIMEOUT_MS')],
  ['gatilho reconhece controles de resolução', tec.includes('ACTION_RX') && tec.includes("beginCapture('action')")],
  ['click/change preservam resposta efetivamente marcada', tec.includes("addEventListener('click'") && tec.includes("addEventListener('change'") && tec.includes('selectedByQuestion')],
  ['resultado factual espera evidência', tec.includes('awaitResult') && tec.includes("source='marked-vs-gabarito'")],
  ['rótulos alternativos são reconhecidos', tec.includes('Enviar\\s+resposta') && tec.includes('Corrigir') && tec.includes('Finalizar')],
  ['MAIN world busca contexto por controles genéricos', page.includes('[ng-click]') && page.includes('[data-ng-click]') && page.includes('candidateButtons()')],
  ['MAIN world faz leitura rápida e tardia sem cancelamento mútuo', page.includes('scheduleClick(120)') && page.includes('scheduleClick(450)') && page.includes('observerTimer')],
  ['captura segue transacional', tec.includes("chrome.runtime.sendMessage({kind:'capture'") && tec.includes('stage(env)') && tec.includes('replayStaged()')],
  ['reconstrução usa lote durável + ACK/replay', reconstructBg.includes('BATCHES_KEY') && reconstructBg.includes('awaiting-persistence') && reconstructBg.includes('replayBatches') && reconstructBridge.includes('reconstruct-batch-ack')],
  ['conta não identificada não fabrica identidade aleatória', reconstruct.includes("id:'conta-nao-identificada'") && reconstruct.includes("confidence:'unknown'")]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`COMPANION GATILHO V4.1: ${checks.length}/${checks.length} contratos válidos.`);
