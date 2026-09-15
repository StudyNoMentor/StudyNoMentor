import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const manifest = JSON.parse(read('companion/manifest.json'));
const background = read('companion/src/background.js');
const study = read('companion/src/study-bridge.js');
const proxy = read('companion/src/study-ai-proxy.js');
const chatgpt = read('companion/src/chatgpt-content.js');

const scripts = manifest.content_scripts || [];
const plusScript = scripts.find(x => (x.matches || []).includes('https://chatgpt.com/*'));
const proxyScript = scripts.find(x => (x.js || []).includes('src/study-ai-proxy.js'));

const checks = [
  ['manifest libera apenas host ChatGPT necessário', (manifest.host_permissions || []).includes('https://chatgpt.com/*')],
  ['manifest possui permissão de tabs para aba dedicada', (manifest.permissions || []).includes('tabs')],
  ['executor ChatGPT é content script isolado', !!plusScript && (plusScript.js || []).includes('src/chatgpt-content.js')],
  ['proxy da IA roda no MAIN world do Study', !!proxyScript && proxyScript.world === 'MAIN' && proxyScript.run_at === 'document_start'],
  ['proxy intercepta somente tec-ai', proxy.includes('/\\/functions\\/v1\\/tec-ai') && proxy.includes("transport: 'chatgpt-plus-browser'")],
  ['proxy não chama API da OpenAI', !proxy.includes('api.openai.com') && !proxy.includes('OPENAI_API_KEY')],
  ['background mantém jobs Plus duráveis', background.includes("const PLUS_JOBS_KEY = 'snmPlusAiJobsV1'") && background.includes('async function plusState')],
  ['background restringe mensagens ao chatgpt.com', background.includes('const isChatGPT') && background.includes("msg.kind==='plus-ai-claim' && isChatGPT(url)")],
  ['resultado Plus persiste até ACK do Study', background.includes('async function ackPlus') && background.includes("job.status==='complete'")],
  ['Study encaminha request e ACK da IA', study.includes("kind:'plus-ai-request'") && study.includes("type:'plus-ai-ack'")],
  ['executor exige sessão web e não tenta exportar cookies', chatgpt.includes("throw new Error('LOGIN_REQUIRED')") && !/cookie|authorization|bearer/i.test(chatgpt)],
  ['executor usa caixa oficial da interface como primeira opção', chatgpt.includes("document.querySelector('#prompt-textarea')")],
  ['executor reconhece respostas do assistant', chatgpt.includes('[data-message-author-role="assistant"]')],
  ['executor aguarda estabilidade antes de devolver', chatgpt.includes('STABLE_TICKS') && chatgpt.includes('generationInProgress()')],
  ['nenhum arquivo da bridge referencia chave OpenAI', ![background,study,proxy,chatgpt].some(x=>x.includes('OPENAI_API_KEY'))]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`COMPANION CHATGPT PLUS: ${checks.length}/${checks.length} contratos válidos.`);
