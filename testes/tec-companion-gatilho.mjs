import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('companion/manifest.json'));
const tec = read('companion/src/tec-content.js');
const page = read('companion/src/tec-page.js');

const checks = [
  ['Companion preserva versão instalada 1.0.4 no hotfix', manifest.version === '1.0.4'],
  ['TEC continua em todos os frames', (manifest.content_scripts || []).filter(x => (x.matches || []).some(m => /tecconcursos/.test(m))).every(x => x.all_frames === true)],
  ['gatilho aceita controles além do texto Resolver', tec.includes('function interactionControl') && tec.includes('armPending') && tec.includes("armPending(resolver?'resolver':'interaction'"))],
  ['mudança e submit também armam captura', tec.includes("addEventListener('change'") && tec.includes("addEventListener('submit'"))],
  ['resultado continua sendo condição para emissão', tec.includes('if (result(null)) return false') && tec.includes("markCapture(accepted?'queued':'staged'"))],
  ['rótulos alternativos são reconhecidos', tec.includes('Enviar\\s+resposta') && tec.includes('Corrigir') && tec.includes('Finalizar')],
  ['MAIN world busca contexto por controles genéricos', page.includes('[ng-click]') && page.includes('[data-ng-click]') && page.includes('candidateButtons()')],
  ['MAIN world alinha fallback de ID com href/aria', page.includes("el.getAttribute?.('href')") && page.includes("el.getAttribute?.('aria-label')")],
  ['captura segue transacional', tec.includes("chrome.runtime.sendMessage({ kind:'capture'") && tec.includes('stageEnvelope(env)')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`COMPANION GATILHO RESILIENTE: ${checks.length}/${checks.length} contratos válidos.`);
