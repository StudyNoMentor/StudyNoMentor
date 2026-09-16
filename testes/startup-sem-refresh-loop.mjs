import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('src/js/99d-startup-stability-ai.js');
const build = read('build.mjs');
const section = read('src/js/62-section-sync.js');
const gate = read('src/js/53-portao-de-acesso.js');
const sessionGuard = read('src/js/61-session-guard.js');
const footer = read('src/html/90-rodape.html');
const sw = read('sw.js');
const ai = read('src/js/94-tec-integracao.js');
const plus = read('companion/src/study-ai-proxy.js');
const chat = read('companion/src/chatgpt-content.js');

const checks = [
  ['módulo de estabilidade está no build', build.includes("'js/99d-startup-stability-ai.js'")],
  ['sincronização remota usa soft refresh', js.includes('S.pullAndReload = async function()') && js.includes("scheduleSoftRefresh('dados novos da nuvem')")],
  ['login no mesmo perfil não força reload', js.includes("why === 'entrada no perfil com dados novos'") && js.includes('current === ACTIVE_AT_LOAD')],
  ['troca real de perfil continua no caminho original', js.includes('return original(reason, opts)')],
  ['telemetria TEC fica local', js.includes("'tec-capture-log-v1'")],
  ['bookkeeping do ledger fica local', js.includes("'tec-cloud-ledger:'")],
  ['sync de foco é deduplicado', js.includes('C.__focusDedupPatched') && js.includes('if (running) return running')],
  ['soft refresh reativa a tela atual', js.includes("new CustomEvent('screen:activated'")],
  ['auth restaurada é idempotente por usuário', js.includes('__authLifecycleState') && js.includes('__startupSideEffectsUid')],
  ['session guard verifica posse antes de reivindicar', js.includes('check-before-claim') && js.includes("select('device_id,device_label')") && js.includes('if (!data || !data.device_id)')],
  ['login explícito pode reivindicar este dispositivo', js.includes('const originalSignIn = C.signIn.bind(C)') && js.includes('await Sg.claim(data.session.user.id)')],
  ['session guard troca canal ao trocar de conta', sessionGuard.includes('_subscribedUid') && sessionGuard.includes('if (this.channel) this._unsub()') && sessionGuard.includes("'sess_guard_' + uid.slice(0, 8)")],
  ['callback do session guard antigo é ignorado', sessionGuard.includes('if (this._subscribedUid !== uid) return')],
  ['realtime de seções é vinculado ao perfil confirmado', js.includes('_secProfileId') && js.includes('profileConfirmed(pid)') && js.includes("'sec_rt_' + pid.slice(0,8)")],
  ['callback realtime antigo não atua no perfil novo', js.includes('this._secProfileId !== pid') && js.includes('profileConfirmed(pid)')],
  ['hasRemoteUpdates usa revisões do id solicitado', js.includes('const locais = this._getRevs(id)')],
  ['entrada do perfil hidrata IDB antes da nuvem', js.includes('await window.__idbHydrateProfile(id)') && js.includes('const result = await original(id)')],
  ['reset TEC remoto é checado antes da hidratação', js.includes('applyRemoteResetIfNeeded(id)') && js.indexOf('applyRemoteResetIfNeeded(id)') < js.indexOf('const result = await original(id)')],
  ['reset TEC tem marcador remoto anti-ressurreição', js.includes("TEC_RESET_SECTION = '__tec_reset_epoch'") && js.includes("reason:'tec-full-reset-v1'")],
  ['reset TEC preserva outros dados do perfil', js.includes('isTecSection(section)') && js.includes("from('tec_resolution_events').delete().eq('profile_id', id)")],
  ['botão de zerar TEC é instalado no módulo', js.includes("button.textContent = 'Zerar dados TEC'") && js.includes('this.resetActive()')],
  ['SectionSync antigo ainda evita reload quando nada mudou', section.includes("if (!r.mudou) { console.info('[SectionSync] nuvem conferida: nada mudou, sem recarregar')")],
  ['gate distingue mesmo perfil de troca', gate.includes('const jaEraOAtivo = (ProfileManager.getActiveProfileId() === id)')],
  ['mirror nativo não sobrescreve chave já existente no IndexedDB', footer.includes('if (disk.has(k)) { puladasNoDisco++; continue; }') && footer.includes("strategy: 'active-profile-hot-v2-safe-mirror'")],
  ['perfil frio continua hidratado sob demanda', footer.includes('window.__idbHydrateProfile = hydrateProfile') && footer.includes('hydratedProfiles[id]')],
  ['navegação revalida HTML em vez de confiar no HTTP cache', sw.includes("new Request(req, { cache: 'reload' })") && sw.includes('TIMEOUT_NAVEGACAO = 9000')],
  ['navigation preload não concorre como segunda autoridade', sw.includes('navigationPreload.disable()') && sw.includes('buscarNavegacao(req)')],
  ['IA continua usando o endpoint tec-ai', ai.includes("'/functions/v1/tec-ai'")],
  ['proxy Plus tem timeout próprio e não chama OpenAI diretamente', plus.includes('150000') && !plus.includes('api.openai.com')],
  ['executor ChatGPT tem detecção explícita de login', chat.includes("throw new Error('LOGIN_REQUIRED')")],
  ['executor aguarda conclusão estável da resposta', chat.includes('STABLE_TICKS') && chat.includes('generationInProgress()')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`STARTUP/LOGIN/PERSISTÊNCIA: ${checks.length}/${checks.length} contratos válidos.`);
