import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const nav = read('src/html/03-corpo.html');
const body = read('src/html/05-corpo-cont.html');
const build = read('build.mjs');
const js = read('src/js/94-tec-integracao.js');
const realtime = read('src/js/95-tec-companion.js');
const head = read('src/html/00-cabecalho.html');
const edge = read('supabase/functions/tec-ai/index.ts');
const manifest = JSON.parse(read('companion/manifest.json'));
const bg = read('companion/src/background.js');
const tec = read('companion/src/tec-content.js');
const bridge = read('companion/src/study-bridge.js');

const contentMatches = (manifest.content_scripts || []).flatMap(x => x.matches || []);
const checks = [
  ['item de menu', nav.includes('data-screen="integracaotec"')],
  ['tela acessível', body.includes('id="screen-integracaotec"') && body.includes('role="region"')],
  ['estado da conexão', body.includes('id="tec-connect-status"')],
  ['métricas isoladas', ['questions','errors','books','pending'].every(x => body.includes(`id="tec-connect-${x}"`))],
  ['módulo integração incluído', build.includes("'js/94-tec-integracao.js'")],
  ['módulo realtime incluído depois da integração', build.indexOf("'js/95-tec-companion.js'") > build.indexOf("'js/94-tec-integracao.js'")],
  ['estilo incluído no build', build.includes("S('css/28-tec-integracao.css')")],
  ['ativação sob demanda', js.includes("screen === 'integracaotec'")],
  ['estado por perfil', js.includes('DB._profilePrefix()') && realtime.includes('DB._profilePrefix()')],
  ['TEC permitido no quadro', head.includes('frame-src https://www.tecconcursos.com.br')],
  ['quadro incorporado', body.includes('id="tec-workspace-frame"')],
  ['importação JSON', body.includes('id="tec-connect-file"') && js.includes('importJSON(file)')],
  ['origem da ponte validada', js.includes("event.origin !== this.TEC_ORIGIN") && js.includes('event.source !== frame.contentWindow')],
  ['proteção contra duplicidade da biblioteca', js.includes('questionKey(account, book, id)')],
  ['cache por versão', js.includes("PROMPT_VERSION: 'tec-pedagogico-v1'")],
  ['seis abas do assistente', ['diagnostico','revisao','flashcards','quiz','reforco','professor'].every(x => body.includes(`data-section="${x}"`))],
  ['chave só no servidor', edge.includes("Deno.env.get('OPENAI_API_KEY')") && !js.includes('OPENAI_API_KEY')],
  ['backend autenticado e limitado', edge.includes('tokenSubject') && edge.includes('limited(userId)')],
  ['saída estruturada', edge.includes("type: 'json_schema'")],
  ['reforço em atividades extras', js.includes('DB.addExtra') || realtime.includes('DB.addExtra')],
  ['sincronização por seção', js.includes('SectionSync.markDirty') || realtime.includes('DB.setRaw')],

  ['Companion usa Manifest V3', manifest.manifest_version === 3],
  ['Companion injeta no TEC', contentMatches.some(x => /tecconcursos/.test(x))],
  ['Companion injeta no Study', contentMatches.some(x => /studynomentor\.github\.io/.test(x))],
  ['Companion tem armazenamento sem cota curta', (manifest.permissions || []).includes('unlimitedStorage')],
  ['fila da extensão é durável', bg.includes('chrome.storage.local') && bg.includes('QUEUE_KEY') && bg.includes("msg.type === 'ack'")],
  ['fila só baixa por ACK', bg.includes('async function ack') && bridge.includes("msg.type === 'ack'")],
  ['captura transacional acorda o worker', tec.includes("chrome.runtime.sendMessage({ kind: 'capture'") && bg.includes("msg.kind !== 'capture'")],
  ['captura só é aceita após enqueue', bg.includes('const result = await enqueue(env)') && bg.includes('accepted: !!result.ok')],
  ['estágio local protege contra reinício/reload', tec.includes("STAGE_PREFIX = 'snmTecStageV1:'") && tec.includes('stageEnvelope(env)') && tec.includes('replayStaged()')],
  ['estágio só baixa após accepted', tec.includes('response && response.accepted') && tec.includes('await unstageEnvelope(env.messageId)')],
  ['fila cheia não descarta evento silenciosamente', bg.includes("reason: 'queue_full'") && !bg.includes('rows.shift()')],
  ['saúde da fila atravessa a ponte', bg.includes("kind: 'health'") && bridge.includes("'companion-health'")],
  ['ponte sinaliza reconexão', bridge.includes("'companion-disconnected'")],
  ['Radar recebe saúde e reconexão', realtime.includes("m.type === 'companion-health'") && realtime.includes("m.type === 'companion-disconnected'")],
  ['conexão expira se o heartbeat parar', realtime.includes('STALE_MS = 45000') && realtime.includes('isConnected(connection)')],
  ['contas TEC não são misturadas por padrão', realtime.includes('activeAccount()') && realtime.includes("id=\"trt-account\"") && realtime.includes('e.tecAccount === account')],
  ['captura pelo Resolver questão', tec.includes('Resolver\\s+quest') && tec.includes("type, payload")],
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
