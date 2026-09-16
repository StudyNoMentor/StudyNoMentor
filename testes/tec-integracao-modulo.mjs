import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const nav=read('src/html/03-corpo.html');
const body=read('src/html/05-corpo-cont.html');
const build=read('build.mjs');
const js=read('src/js/94-tec-integracao.js');
const realtime=read('src/js/95-tec-companion.js');
const hardening=read('src/js/99j-tec-hardening-api.js');
const cloud=read('src/js/99k-tec-cloud-ledger-hardening.js');
const diagnostics=read('src/js/96-tec-capture-diagnostics.js');
const css=read('src/css/33-tec-hardening-api.css');
const edge=read('supabase/functions/tec-ai/index.ts');
const manifest=JSON.parse(read('companion/manifest.json'));
const entry=read('companion/src/background-entry.js');
const background=read('companion/src/background-v2.js');
const capture=read('companion/src/tec-capture-v2.js');
const bridge=read('companion/src/study-bridge.js');
const proxy=read('companion/src/study-ai-proxy.js');

const scripts=manifest.content_scripts||[];
const isolated=scripts.find(x=>(x.js||[]).includes('src/tec-capture-v2.js'));
const mainWorld=scripts.find(x=>(x.js||[]).includes('src/tec-page.js'));
const study=scripts.find(x=>(x.js||[]).includes('src/study-bridge.js'));
const checks=[
  ['menu/tela existem',nav.includes('data-screen="integracaotec"')&&body.includes('id="screen-integracaotec"')],
  ['workspace TEC existe',body.includes('id="tec-workspace-frame"')&&js.includes('openEmbedded()')],
  ['módulos hardening no fim do build',build.indexOf("'js/99j-tec-hardening-api.js'")>build.indexOf("'js/99i-tec-integridade-auditoria.js'")&&build.indexOf("'js/99k-tec-cloud-ledger-hardening.js'")>build.indexOf("'js/99j-tec-hardening-api.js'")],
  ['CSS do provedor incluído',build.includes("S('css/33-tec-hardening-api.css')")&&css.includes('.tec-ai-provider-box')],
  ['Companion 1.2 MV3',manifest.manifest_version===3&&manifest.version==='1.2.0'],
  ['alarms e armazenamento durável permitidos',(manifest.permissions||[]).includes('alarms')&&(manifest.permissions||[]).includes('unlimitedStorage')],
  ['ponte MAIN roda em todos frames TEC',!!mainWorld&&mainWorld.world==='MAIN'&&mainWorld.all_frames===true],
  ['captura v2 roda depois da guarda',!!isolated&&isolated.js[0]==='src/tec-integrity-guard.js'&&isolated.js[1]==='src/tec-capture-v2.js'],
  ['bridge Study só no frame principal',!!study&&study.all_frames!==true],
  ['captura v2 bloqueia legados em runtime',capture.includes('window.__snmTecCompanion = true')&&capture.includes('window.__snmTecCaptureWatchdog = true')],
  ['captura não inventa marcada pelo gabarito',!capture.includes('if (acertou === true && correta && !marcada)')&&capture.includes("source='marked-vs-gabarito'")],
  ['conta desconhecida é sessão aleatória',capture.includes('session-random')&&!capture.includes("|| 'tec-session'" )],
  ['ID prioriza contexto estruturado',capture.indexOf('const fromPage=pageQuestionId()')<capture.indexOf("document.querySelectorAll('[data-question-id]" )],
  ['fila granular v2',background.includes("QUEUE_ITEM_PREFIX = 'snmTecQueueItemV2:'")&&background.includes('QUEUE_INDEX_KEY')],
  ['captura exige rota Study',background.includes('study_route_unbound')&&background.includes('claimRoute')],
  ['ACK verifica proprietário',background.includes('sameOwner(ctx,item.target)')],
  ['worker possui manutenção MV3',background.includes('chrome.alarms')&&background.includes('ALARM_NAME')],
  ['ChatGPT usa aba dedicada',entry.includes('snmPlusOwnedTabV2')&&entry.includes("importScripts('background-v2.js')")],
  ['bridge envia contexto de perfil',bridge.includes("type:'bind-study'")&&bridge.includes("type:'claim-capture-route'")],
  ['proxy só intercepta provedor browser',proxy.includes("BROWSER_PROVIDER = 'chatgpt-plus-browser'")&&proxy.includes("provider||'auto')!==BROWSER_PROVIDER")],
  ['TrustGate único publicado',hardening.includes('window.TecTrustGate=TecTrustGate')&&hardening.includes('TecTrustGate.prescriptive')],
  ['versão mínima Companion',hardening.includes("MIN_COMPANION = '1.2.0'")],
  ['Lacunas e Evidência Real recebem TrustGate',hardening.includes('L.events=function()')&&hardening.includes('E.events=function()')],
  ['Atacar erros recebe TrustGate',hardening.includes('R.__trustAttackWrapped')&&hardening.includes('TecTrustGate.prescriptive(ownRows.call')],
  ['provider configurável por perfil',hardening.includes('tec-ai-provider-v1')&&hardening.includes('openai-compatible')&&hardening.includes('chatgpt-plus-browser')],
  ['chaves ficam no servidor',!hardening.includes('GEMINI_API_KEY')&&!hardening.includes('OPENAI_API_KEY')],
  ['Gemini/OpenAI/custom no backend',edge.includes('callGemini')&&edge.includes('callOpenAI')&&edge.includes('callOpenAICompatible')],
  ['rate limit global via RPC',edge.includes('consume_tec_ai_quota')&&!edge.includes('const hits = new Map')],
  ['limite total do request',edge.includes('MAX_REQUEST_CHARS')&&edge.includes('413')],
  ['ledger insert-or-ignore',cloud.includes('ignoreDuplicates:true')],
  ['ledger incremental por cursor',cloud.includes("CURSOR_SUFFIX='tec-cloud-ledger:cursor-v2'")&&cloud.includes(".gte('created_at',cursor.at)")],
  ['diagnóstico continua disponível',diagnostics.includes('StudyNoMentorTecCaptureDiagnostic')&&diagnostics.includes('Copiar log')],
  ['Radar continua por perfil',realtime.includes('DB._profilePrefix()')]
];
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){failed.forEach(([name])=>console.error('FALHOU:',name));process.exit(1);}
console.log(`INTEGRAÇÃO TEC 1.2: ${checks.length}/${checks.length} contratos válidos.`);
