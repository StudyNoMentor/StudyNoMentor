import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const nav = read('src/html/03-corpo.html');
const body = read('src/html/05-corpo-cont.html');
const build = read('build.mjs');
const js = read('src/js/94-tec-integracao.js');
const realtime = read('src/js/95-tec-companion.js');
const diagnostics = read('src/js/96-tec-capture-diagnostics.js');
const css = read('src/css/28-tec-integracao.css');
const head = read('src/html/00-cabecalho.html');
const edge = read('supabase/functions/tec-ai/index.ts');
const manifest = JSON.parse(read('companion/manifest.json'));
const bg = read('companion/src/background.js');
const tec = read('companion/src/tec-content.js');
const pageBridge = read('companion/src/tec-page.js');
const bridge = read('companion/src/study-bridge.js');

const contentMatches = (manifest.content_scripts || []).flatMap(x => x.matches || []);
const mainWorldTec = (manifest.content_scripts || []).find(x => x.world === 'MAIN' && (x.js || []).includes('src/tec-page.js'));
const isolatedTec = (manifest.content_scripts || []).find(x => (x.js || []).includes('src/tec-content.js'));
const studyBridgeScript = (manifest.content_scripts || []).find(x => (x.js || []).includes('src/study-bridge.js'));
const checks = [
  ['item de menu', nav.includes('data-screen="integracaotec"')],
  ['tela acessível', body.includes('id="screen-integracaotec"') && body.includes('role="region"')],
  ['estado da conexão', body.includes('id="tec-connect-status"')],
  ['métricas isoladas', ['questions','errors','books','pending'].every(x => body.includes(`id="tec-connect-${x}"`))],
  ['módulo integração incluído', build.includes("'js/94-tec-integracao.js'")],
  ['módulo realtime incluído depois da integração', build.indexOf("'js/95-tec-companion.js'") > build.indexOf("'js/94-tec-integracao.js'")],
  ['diagnóstico incluído depois do realtime', build.indexOf("'js/96-tec-capture-diagnostics.js'") > build.indexOf("'js/95-tec-companion.js'")],
  ['diagnóstico mostra etapas reais da captura', diagnostics.includes('question_id_not_detected') && diagnostics.includes('result_not_detected') && diagnostics.includes("status === 'queued'") && diagnostics.includes('mainWorldContext')],
  ['console técnico mantém ring buffer local', diagnostics.includes('MAX_LOG = 300') && diagnostics.includes('tec-capture-log-v1') && diagnostics.includes('pushLog(')],
  ['console técnico pode ser copiado e limpo', diagnostics.includes('Copiar log') && diagnostics.includes('Limpar log') && diagnostics.includes('StudyNoMentorTecCaptureDiagnostic')],
  ['console técnico não usa observer recursivo de DOM', !diagnostics.includes('new MutationObserver')],
  ['estilo incluído no build', build.includes("S('css/28-tec-integracao.css')")],
  ['ativação sob demanda', js.includes("screen === 'integracaotec'")],
  ['estado por perfil', js.includes('DB._profilePrefix()') && realtime.includes('DB._profilePrefix()')],
  ['TEC permitido no quadro', head.includes('frame-src https://www.tecconcursos.com.br')],
  ['quadro incorporado', body.includes('id="tec-workspace-frame"')],
  ['importação JSON', body.includes('id="tec-connect-file"') && js.includes('importJSON(file)')],
  ['origem da ponte validada', js.includes("event.origin !== this.TEC_ORIGIN") && js.includes('event.source !== frame.contentWindow')],
  ['proteção contra duplicidade da biblioteca', js.includes('questionKey(account, book, id)')],
  ['cache pedagógico V2', js.includes("PROMPT_VERSION: 'tec-pedagogico-v2'")],
  ['seis abas do assistente', ['diagnostico','revisao','flashcards','quiz','reforco','professor'].every(x => body.includes(`data-section="${x}"`))],
  ['chave só no servidor', edge.includes("Deno.env.get('OPENAI_API_KEY')") && !js.includes('OPENAI_API_KEY')],
  ['backend autenticado e limitado', edge.includes('tokenSubject') && edge.includes('limited(userId)')],
  ['saída estruturada', edge.includes("type: 'json_schema'")],
  ['reforço em atividades extras', js.includes('DB.addExtra') || realtime.includes('DB.addExtra')],
  ['sincronização por seção', js.includes('SectionSync.markDirty') || realtime.includes('DB.setRaw')],

  ['workbench prioriza TEC', css.includes('.tec-workspace-card') && css.includes('order:1') && css.includes('calc(100vh - 175px)')],
  ['modo foco mantém iframe no Study', js.includes('toggleFocus(force)') && css.includes('.tec-focus-mode .tec-workspace-card') && js.includes("'tec-workspace-focus'")],
  ['workspace tem recarga e abertura separada', js.includes('reloadEmbedded()') && js.includes('tec-workspace-open-external')],
  ['copy legado é corrigido para Companion', js.includes('StudyNoMentor Companion') && js.includes('Companion ativo: resolva normalmente no TEC')],
  ['prompts antigos migrados nativamente', ['erro','acerto','teoria','flashcards'].every(k => js.includes(`${k}:`)) && js.includes('DEFAULT_PROMPTS')],
  ['prompts novos cobrem teste e reforço', js.includes('quiz:') && js.includes('reforco:')],
  ['placeholders pedagógicos preservados', ['{{QUESTAO}}','{{MINHA_RESPOSTA}}','{{GABARITO}}','{{RESULTADO}}'].every(x => js.includes(x))],
  ['editor de prompts tem histórico e restauração', js.includes('PROMPT_HISTORY_LIMIT: 20') && js.includes('tec-prompt-history') && js.includes('restorePromptVersion') && js.includes('resetPromptEditor')],
  ['análise essencial replica tríade antiga', /\['diagnostico','revisao','flashcards'\]/.test(js)],
  ['erro e acerto escolhem prompts diferentes', js.includes("q && q.acertou === true ? 'acerto'") && js.includes("q && q.acertou === false ? 'erro'")],
  ['prompts personalizados vão ao backend', js.includes('customPrompts:this.customPromptsFor') && edge.includes('customPrompts(body?.customPrompts)')],
  ['backend limita prompts do cliente', edge.includes('MAX_CUSTOM_PROMPT = 12000') && edge.includes('PROMPT_SECTIONS')],
  ['backend mantém precedência de rigor', edge.includes('regras superiores de rigor') && edge.includes('sem inventar normas')],

  ['Companion usa Manifest V3', manifest.manifest_version === 3],
  ['Companion está na versão 1.1.0', manifest.version === '1.1.0'],
  ['Companion injeta no TEC', contentMatches.some(x => /tecconcursos/.test(x))],
  ['Companion injeta no Study', contentMatches.some(x => /studynomentor\.github\.io/.test(x))],
  ['Companion tem armazenamento sem cota curta', (manifest.permissions || []).includes('unlimitedStorage')],
  ['ponte MAIN world instalada no TEC', !!mainWorldTec && (mainWorldTec.matches || []).some(x => /tecconcursos/.test(x))],
  ['ponte MAIN world roda também no iframe TEC', !!mainWorldTec && mainWorldTec.all_frames === true],
  ['content script isolado roda também no iframe TEC', !!isolatedTec && isolatedTec.all_frames === true],
  ['bridge do Study permanece apenas no frame principal', !!studyBridgeScript && studyBridgeScript.all_frames !== true],
  ['ponte MAIN world lê contexto Angular sem credencial', pageBridge.includes('angular.element') && pageBridge.includes("type:'question-context'") && !/authorization|bearer/i.test(pageBridge)],
  ['content script solicita e recebe contexto MAIN world', tec.includes("PAGE_SOURCE = 'StudyMentorTecPage'") && tec.includes("type:'context-request'") && tec.includes("msg.type !== 'question-context'")],
  ['ID da questão tem fallback Angular/DOM', tec.includes('return pageQuestionId()') && pageBridge.includes('extractAngularContext()') && pageBridge.includes('extractDomContext()')],
  ['resultado tem fallback visual das alternativas', tec.includes('.wk7j7j,.bz2gcz') && tec.includes("source:'alternatives'")],
  ['clique não é descartado quando ID ainda não chegou', /qid\s*:\s*qid\s*\?\s*String\(qid\)\s*:\s*null/.test(tec) && /if\s*\(!tx\.qid\s*&&\s*liveId\)/.test(tec)],
  ['fila da extensão é durável', bg.includes('chrome.storage.local') && bg.includes('QUEUE_KEY') && bg.includes("msg.type === 'ack'")],
  ['fila só baixa por ACK', bg.includes('async function ack') && bridge.includes("msg.type==='ack'")],
  ['captura transacional acorda o worker', /chrome\.runtime\.sendMessage\(\{\s*kind:'capture'/.test(tec) && /msg\.kind\s*!==\s*'capture'/.test(bg)],
  ['captura só é aceita após enqueue', /await enqueue\(env\)/.test(bg) && /accepted:\s*!!result\.ok/.test(bg)],
  ['estágio local protege contra reinício/reload', tec.includes("STAGE_PREFIX = 'snmTecStageV1:'") && tec.includes('stageEnvelope(env)') && tec.includes('replayStaged()')],
  ['estágio só baixa após accepted', tec.includes('response && response.accepted') && tec.includes('await unstageEnvelope(env.messageId)')],
  ['fila cheia não descarta evento silenciosamente', bg.includes("reason:'queue_full'") && !bg.includes('rows.shift()')],
  ['saúde da fila atravessa a ponte', bg.includes("kind:'health'") && bridge.includes("'companion-health'")],
  ['ponte sinaliza reconexão', bridge.includes("'companion-disconnected'")],
  ['BFCache tratado nos dois lados', tec.includes("addEventListener('pageshow'") && tec.includes("addEventListener('pagehide'") && bridge.includes("addEventListener('pageshow'") && bridge.includes("addEventListener('pagehide'")],
  ['runtime.lastError de desconexão é consumido', tec.includes('chrome.runtime.lastError') && bridge.includes('chrome.runtime.lastError') && bg.includes('chrome.runtime.lastError')],
  ['status informa ciclo de vida e port', tec.includes('portConnected:!!port') && tec.includes('lifecycle') && tec.includes('visibility:document.visibilityState')],
  ['Radar recebe saúde e reconexão', realtime.includes("m.type === 'companion-health'") && realtime.includes("m.type === 'companion-disconnected'")],
  ['conexão expira se o heartbeat parar', realtime.includes('STALE_MS = 45000') && realtime.includes('isConnected(connection)')],
  ['contas TEC não são misturadas por padrão', realtime.includes('activeAccount()') && realtime.includes("id=\"trt-account\"") && realtime.includes('e.tecAccount === account')],
  ['captura pelo Resolver questão', tec.includes('Resolver\\s+quest') && tec.includes('function envelope(')],
  ['evento traz data local e ID', tec.includes('questionId') && tec.includes('localDate') && tec.includes('eventId')],
  ['site mantém log append-only', realtime.includes("KEY = 'tec-realtime:eventos-v1'") && realtime.includes('state.events[ev.eventId]')],
  ['deduplicação de transportes', realtime.includes('recentDuplicate') && realtime.includes('DUP_WINDOW_MS')],
  ['mapeamento conservador', realtime.includes('Fraqueza confirmada') && realtime.includes('Nenhuma fraqueza confirmada')],
  ['força-tarefa usa motor existente', realtime.includes('PlanoSugestoesRobusto') && realtime.includes('ReforcoTecExtras') && realtime.includes('PlanoCiclo.origem')],
  ['fila passa a suportar 3 disciplinas', realtime.includes('MAX_TAREFAS_DIA') && realtime.includes("disciplinasDia:3")],
  ['exportação de dados reais', realtime.includes('StudyNoMentorTecRealtimeExport') && realtime.includes('resolutions:rows')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`INTEGRAÇÃO TEC + COMPANION: ${checks.length}/${checks.length} contratos válidos.`);
