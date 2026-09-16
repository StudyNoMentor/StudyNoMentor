import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const manifest=JSON.parse(read('companion/manifest.json'));
const background=read('companion/src/background-v2.js');
const entry=read('companion/src/background-entry.js');
const study=read('companion/src/study-bridge.js');
const proxy=read('companion/src/study-ai-proxy.js');
const chatgpt=read('companion/src/chatgpt-content.js');

const scripts=manifest.content_scripts||[];
const plusScript=scripts.find(x=>(x.matches||[]).includes('https://chatgpt.com/*'));
const proxyScript=scripts.find(x=>(x.js||[]).includes('src/study-ai-proxy.js'));
const checks=[
  ['manifest libera somente host ChatGPT necessário',(manifest.host_permissions||[]).includes('https://chatgpt.com/*')],
  ['manifest possui tabs e alarms',(manifest.permissions||[]).includes('tabs')&&(manifest.permissions||[]).includes('alarms')],
  ['executor ChatGPT é content script isolado',!!plusScript&&(plusScript.js||[]).includes('src/chatgpt-content.js')],
  ['proxy roda no MAIN world do Study',!!proxyScript&&proxyScript.world==='MAIN'&&proxyScript.run_at==='document_start'],
  ['proxy intercepta apenas tec-ai quando provider browser foi escolhido',/functions\\\/v1\\\/tec-ai/.test(proxy)&&proxy.includes("BROWSER_PROVIDER = 'chatgpt-plus-browser'")&&proxy.includes("provider||'auto')!==BROWSER_PROVIDER")],
  ['proxy não chama API OpenAI',!proxy.includes('api.openai.com')&&!proxy.includes('OPENAI_API_KEY')],
  ['background mantém jobs Plus duráveis',background.includes("PLUS_JOBS_KEY = 'snmPlusAiJobsV2'")&&background.includes('async function plusState')],
  ['jobs pertencem ao mesmo usuário/perfil Study',background.includes('target:{userId:target.userId,profileId:target.profileId}')&&background.includes('sameOwner')],
  ['cancelamento explícito existe',background.includes("msg.kind==='plus-ai-cancel'")&&study.includes("type:'plus-ai-cancel'")&&proxy.includes("type:'plus-ai-cancel'" )],
  ['resultado persiste até ACK',background.includes('async function ackPlus')&&background.includes("job.status==='complete'")],
  ['aba dedicada é persistida',entry.includes("OWNED_TAB_KEY = 'snmPlusOwnedTabV2'")&&!entry.includes('return reusable')],
  ['executor exige sessão web sem ler credenciais',chatgpt.includes("throw new Error('LOGIN_REQUIRED')")&&!chatgpt.includes('chrome.cookies')&&!/authorization\s*[:=]|bearer\s+/i.test(chatgpt)],
  ['cada job começa em conversa dedicada',chatgpt.includes('ensureFreshConversation')&&chatgpt.includes('snm_companion=1')],
  ['executor rejeita resposta parcial',chatgpt.includes("throw new Error('PARTIAL_RESPONSE')")],
  ['worker é acordado por alarmes',background.includes('chrome.alarms')&&background.includes('ALARM_NAME')],
  ['nenhuma bridge contém chave de provedor',[background,entry,study,proxy,chatgpt].every(x=>!x.includes('OPENAI_API_KEY')&&!x.includes('GEMINI_API_KEY'))]
];
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){failed.forEach(([name])=>console.error('FALHOU:',name));process.exit(1);}
console.log(`COMPANION CHATGPT PLUS V2: ${checks.length}/${checks.length} contratos válidos.`);
