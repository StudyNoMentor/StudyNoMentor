import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('companion/manifest.json'));
const tec = read('companion/src/tec-capture-v2.js');
const page = read('companion/src/tec-page.js');

const checks = [
  ['Companion está na versão 1.2.0', manifest.version === '1.2.0'],
  ['TEC continua em todos os frames', (manifest.content_scripts || []).filter(x => (x.matches || []).some(m => /tecconcursos/.test(m))).every(x => x.all_frames === true)],
  ['gatilho reconhece controles de resolução', tec.includes('ACTION_RX') && tec.includes("beginCapture('action')")],
  ['click/change preservam resposta efetivamente marcada', tec.includes("addEventListener('click'") && tec.includes("addEventListener('change'") && tec.includes('selectedByQuestion')],
  ['resultado factual espera evidência', tec.includes('awaitResult') && tec.includes("source='marked-vs-gabarito'")],
  ['rótulos alternativos são reconhecidos', tec.includes('Enviar\\s+resposta') && tec.includes('Corrigir') && tec.includes('Finalizar')],
  ['MAIN world busca contexto por controles genéricos', page.includes('[ng-click]') && page.includes('[data-ng-click]') && page.includes('candidateButtons()')],
  ['MAIN world faz leitura rápida e tardia sem cancelamento mútuo', page.includes('scheduleClick(120)') && page.includes('scheduleClick(450)') && page.includes('observerTimer')],
  ['captura segue transacional', tec.includes("chrome.runtime.sendMessage({kind:'capture'") && tec.includes('stage(env)') && tec.includes('replayStaged()')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`COMPANION GATILHO V2: ${checks.length}/${checks.length} contratos válidos.`);
