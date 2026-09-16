import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const nav=read('src/html/03-corpo.html');
const body=read('src/html/05-corpo-cont.html');
const build=read('build.mjs');
const js=read('src/js/94-tec-integracao.js');
const realtime=read('src/js/95-tec-companion.js');
const hardening=read('src/js/99j-tec-hardening-api.js');
const cloud=read('src/js/99k-tec-cloud-ledger-hardening.js');
const reconstruction=read('src/js/99l-tec-reconstrucao-caderno.js');
const diagnostics=read('src/js/96-tec-capture-diagnostics.js');
const css=read('src/css/33-tec-hardening-api.css');
const edge=read('supabase/functions/tec-ai/index.ts');
const manifest=JSON.parse(read('companion/manifest.json'));
const entry=read('companion/src/background-entry.js');
const background=read('companion/src/background-v2.js');
const reconstructionBg=read('companion/src/background-reconstruct.js');
const capture=read('companion/src/tec-capture-v2.js');
const reconCapture=read('companion/src/tec-reconstruct.js');
const reconPage=read('companion/src/tec-reconstruct-page.js');
const bridge=read('companion/src/study-bridge.js');
const reconBridge=read('companion/src/study-reconstruct-bridge.js');
const proxy=read('companion/src/study-ai-proxy.js');

const scripts=manifest.content_scripts||[];
const isolated=scripts.find(x=>(x.js||[]).includes('src/tec-capture-v2.js'));
const mainWorld=scripts.find(x=>(x.js||[]).includes('src/tec-page.js'));
const reconMain=scripts.find(x=>(x.js||[]).includes('src/tec-reconstruct-page.js'));
const study=scripts.find(x=>(x.js||[]).includes('src/study-bridge.js'));
const checks=[
  ['menu/tela existem',nav.includes('data-screen="integracaotec"')&&body.includes('id="screen-integracaotec"')],
  ['workspace TEC existe',body.includes('id="tec-workspace-frame"')&&js.includes('openEmbedded()')],
  ['módulos hardening/reconstrução no fim do build',build.indexOf("'js/99j-tec-hardening-api.js'")>build.indexOf("'js/99i-tec-integridade-auditoria.js'")&&build.indexOf("'js/99k-tec-cloud-ledger-hardening.js'")>build.indexOf("'js/99j-tec-hardening-api.js'")&&build.indexOf("'js/99l-tec-reconstrucao-caderno.js'")>build.indexOf("'js/99k-tec-cloud-ledger-hardening.js'")],
  ['CSS do provedor incluído',build.includes("S('css/33-tec-hardening-api.css')")&&css.includes('.tec-ai-provider-box')],
  ['Companion 1.3 MV3',manifest.manifest_version===3&&manifest.version==='1.3.0'],
  ['alarms e armazenamento durável permitidos',(manifest.permissions||[]).includes('alarms')&&(manifest.permissions||[]).includes('unlimitedStorage')],
  ['ponte MAIN roda em todos frames TEC',!!mainWorld&&mainWorld.world==='MAIN'&&mainWorld.all_frames===true],
  ['ponte MAIN de reconstrução isolada',!!reconMain&&reconMain.world==='MAIN'&&(reconMain.js||[]).includes('src/tec-reconstruct-page.js')],
  ['reconstrutor bloqueia captura antes da captura v2',!!isolated&&isolated.js[0]==='src/tec-integrity-guard.js'&&isolated.js[1]==='src/tec-reconstruct.js'&&isolated.js[2]==='src/tec-capture-v2.js'],
  ['bridge Study só no frame principal',!!study&&study.all_frames!==true&&(study.js||[]).includes('src/study-reconstruct-bridge.js')],
  ['captura v2 bloqueia legados em runtime',capture.includes('window.__snmTecCompanion = true')&&capture.includes('window.__snmTecCaptureWatchdog = true')],
  ['captura não inventa marcada pelo gabarito',!capture.includes('if (acertou === true && correta && !marcada)')&&capture.includes("source='marked-vs-gabarito'")],
  ['conta desconhecida é sessão aleatória',capture.includes('session-random')&&!capture.includes("|| 'tec-session'" )],
  ['ID prioriza contexto estruturado',capture.indexOf('const fromPage=pageQuestionId()')<capture.indexOf("document.querySelectorAll('[data-question-id]" )],
  ['fila granular v2',background.includes("QUEUE_ITEM_PREFIX = 'snmTecQueueItemV2:'")&&background.includes('QUEUE_INDEX_KEY')],
  ['captura exige rota Study',background.includes('study_route_unbound')&&background.includes('claimRoute')],
  ['ACK verifica proprietário',background.includes('sameOwner(ctx,item.target)')],
  ['worker possui manutenção MV3',background.includes('chrome.alarms')&&background.includes('ALARM_NAME')],
  ['ChatGPT usa aba dedicada',entry.includes('snmPlusOwnedTabV2')&&entry.includes("importScripts('background-v2.js','background-reconstruct.js')")],
  ['bridge envia contexto de perfil',bridge.includes("type:'bind-study'")&&bridge.includes("type:'claim-capture-route'")],
  ['reconstrução roteada pelo mesmo perfil',reconstructionBg.includes('snm-study-reconstruct-v1')&&reconstructionBg.includes('sameOwner')&&reconstructionBg.includes('owner_mismatch')],
  ['reconstrução usa aba técnica própria',reconstructionBg.includes('#snm-reconstruct=')&&reconstructionBg.includes("active:false")&&reconCapture.includes('window.__snmTecCompanionV2 = true')],
  ['reconstrução percorre Gabarito/Resolvidas',reconCapture.includes('openGabarito()')&&reconCapture.includes("selectFilter('Resolvidas')")&&reconCapture.includes('loadAllRows()')],
  ['espera assíncrona não aceita Promise como sucesso prematuro',reconCapture.includes('v = await fn()')],
  ['reconstrução lê histórico real do Angular/DOM',reconPage.includes('desempenhoAluno?.resolucoes')&&reconPage.includes('historyFromDom')&&reconCapture.includes('requestSnapshot')],
  ['tentativa sem data individual não vira evento',reconstruction.includes('if (!a||!a.resolvedAt)')&&reconstruction.includes('undatedAttempts')],
  ['evento histórico exige marcada + gabarito coerentes',reconstruction.includes("status:'verified'")&&reconstruction.includes("acertou!==(marked===correct)")],
  ['histórico incompleto fica agregado, não fabricado',reconstruction.includes('unverifiableAttempts')&&reconstruction.includes('tentativa(s) sem data individual')],
  ['JSON Tampermonkey também recupera histórico',reconstruction.includes('patchJSONImport')&&reconstruction.includes('rowsFromLegacyJSON')&&reconstruction.includes('desempenhoQuestoes')],
  ['UI aceita link ou número do caderno',reconstruction.includes('tec-reconstruction-input')&&reconstruction.includes('questoes\\/cadernos')&&reconstruction.includes('Reconstruir histórico de um caderno')],
  ['reconstrução exige Companion 1.3 e timeout de ACK',reconstruction.includes("MIN_COMPANION = '1.3.0'")&&reconstruction.includes('ACK_TIMEOUT_MS')&&reconstruction.includes('chrome://extensions')],
  ['lotes acumulam estatísticas da execução',reconstruction.includes('addActiveStats')&&reconstruction.includes('stats:zeroStats()')&&reconstruction.includes('writeBook(latest.bookId')],
  ['payload reconstruído completo vai ao ledger',reconstruction.includes('TecCloudLedger')&&reconstruction.includes('C.pushPayload')&&reconstruction.includes('question:{...x.question}')&&reconstruction.includes('history:x.history||null')],
  ['bridge de reconstrução transmite lotes/progresso',reconBridge.includes('tec-reconstruct-batch')&&reconBridge.includes('tec-reconstruct-progress')&&reconBridge.includes('tec-reconstruct-result')],
  ['proxy só intercepta provedor browser',proxy.includes("BROWSER_PROVIDER = 'chatgpt-plus-browser'")&&proxy.includes("provider||'auto')!==BROWSER_PROVIDER")],
  ['TrustGate único publicado',hardening.includes('window.TecTrustGate=TecTrustGate')&&hardening.includes('TecTrustGate.prescriptive')],
  ['versão mínima geral Companion preservada',hardening.includes("MIN_COMPANION = '1.2.0'")],
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
console.log(`INTEGRAÇÃO TEC 1.3: ${checks.length}/${checks.length} contratos válidos.`);
