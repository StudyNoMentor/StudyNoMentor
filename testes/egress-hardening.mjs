import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const guard = read('src/js/99p-tec-reset-epoch-guard.js');
const startup = read('src/js/99e-startup-hot-hydration.js');

const checks = [
  ['modo de conteúdo é pull explícito', guard.includes("CONTENT_REALTIME_MODE = 'explicit-pull-v1'")],
  ['cliente não assina study_profiles por Realtime', guard.includes('C.subscribeRealtime = function()') && guard.includes("disconnectHeavyRealtime(this)")],
  ['cliente não assina profile_sections por Realtime', guard.includes('C.subscribeSections = function()') && guard.includes("removeChannel(this, 'secChannel')")],
  ['canal pesado existente é removido', guard.includes("removeChannel(C, 'channel')") && guard.includes("removeChannel(C, 'secChannel')")],
  ['foco possui janela mínima de dedupe', guard.includes('FOCUS_MIN_INTERVAL_MS = 15000') && guard.includes('now - lastFocusSyncAt < FOCUS_MIN_INTERVAL_MS')],
  ['pendência local força sincronização', guard.includes('const force = pendingLocal(this)') && guard.includes('if (!force && now - lastFocusSyncAt')],
  ['uma única sync de foco pode ficar em voo', guard.includes('if (focusRunning) return focusRunning')],
  ['reset TEC e consulta de revisão começam em paralelo', startup.includes('const resetPromise =') && startup.includes('const remotePromise =') && startup.includes('Promise.all([resetPromise, remotePromise])')],
  ['nenhum kick ocorre antes da barreira do reset', startup.indexOf('Promise.all([resetPromise, remotePromise])') < startup.indexOf('else if (S.kick) S.kick()')],
  ['diagnóstico de egress fica exposto', guard.includes('window.EgressGuard =') && guard.includes('heavyRealtimeConnected'))
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`EGRESS HARDENING: ${checks.length}/${checks.length} contratos válidos.`);
