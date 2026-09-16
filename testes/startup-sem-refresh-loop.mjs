import { readFileSync } from 'node:fs';

// Contratos críticos do hotfix: nenhum refresh automático em cascata e IA Plus íntegra.
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('src/js/99d-startup-stability-ai.js');
const build = read('build.mjs');
const section = read('src/js/62-section-sync.js');
const gate = read('src/js/53-portao-de-acesso.js');
const ai = read('src/js/94-tec-integracao.js');
const plus = read('companion/src/study-ai-proxy.js');
const chat = read('companion/src/chatgpt-content.js');

const checks = [
  ['módulo é carregado por último no build', build.includes("'js/99c-tec-cloud-ledger.js','js/99d-startup-stability-ai.js'")],
  ['sincronização remota usa soft refresh', js.includes('S.pullAndReload = async function()') && js.includes("scheduleSoftRefresh('dados novos da nuvem')")],
  ['login no mesmo perfil não força reload', js.includes("why === 'entrada no perfil com dados novos'") && js.includes('current === ACTIVE_AT_LOAD')],
  ['troca real de perfil continua no caminho original', js.includes('return original(reason, opts)')],
  ['telemetria TEC fica local', js.includes("'tec-capture-log-v1'")],
  ['bookkeeping do ledger fica local', js.includes("'tec-cloud-ledger:'")],
  ['sync de foco é deduplicado', js.includes('C.__focusDedupPatched') && js.includes('if (running) return running')],
  ['soft refresh reativa a tela atual', js.includes("new CustomEvent('screen:activated'")],
  ['SectionSync antigo ainda evita reload quando nada mudou', section.includes("if (!r.mudou) { console.info('[SectionSync] nuvem conferida: nada mudou, sem recarregar')")],
  ['gate distingue mesmo perfil de troca', gate.includes('const jaEraOAtivo = (ProfileManager.getActiveProfileId() === id)')],
  ['IA continua usando o endpoint interceptável tec-ai', ai.includes("'/functions/v1/tec-ai'")],
  ['proxy Plus espera resposta longa sem API paga', plus.includes('180000') && !plus.includes('api.openai.com')],
  ['executor ChatGPT tem detecção explícita de login', chat.includes("throw new Error('LOGIN_REQUIRED')")],
  ['executor aguarda conclusão estável da resposta', chat.includes('STABLE_TICKS') && chat.includes('generationInProgress()')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`STARTUP/IA: ${checks.length}/${checks.length} contratos válidos.`);
