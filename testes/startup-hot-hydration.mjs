import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const footer = read('src/html/90-rodape.html');
const guard = read('src/js/99e-startup-hot-hydration.js');
const build = read('build.mjs');

const checks = [
  ['startup usa estratégia por perfil ativo', footer.includes("strategy: 'active-profile-hot-v1'") && footer.includes('isHotStartupKey')],
  ['caminho crítico não faz getAll de todos os valores', !footer.includes('store.getAll();')],
  ['índice de chaves é lido sem clonar valores frios', footer.includes('store.getAllKeys()') && footer.includes('allDiskKeys')],
  ['namespace do perfil ativo é carregado no startup', footer.includes('p === activeId') && footer.includes('hydratedProfiles[activeId] = true')],
  ['outros perfis têm hidratação sob demanda', footer.includes('window.__idbHydrateProfile = hydrateProfile')],
  ['escrita após boot não pode ser sobrescrita por hidratação tardia', footer.includes('touchedSinceBoot') && footer.includes('!touchedSinceBoot.has(key)')],
  ['índice sabe que perfil frio existe sem ler payload', footer.includes('window.__idbHasProfileNamespace') && footer.includes('window.__idbColdProfileIds')],
  ['telemetria mede hidratação e tempo visível', footer.includes('__idbStartupStats') && footer.includes('hydrateMs') && footer.includes('visibleMs')],
  ['troca de perfil hidrata antes de entrar', guard.includes('await ensureProfile(id)') && guard.includes('P.enterProfile = async function')],
  ['perfil frio continua reconhecido no espelho local', guard.includes('P.perfisComDadosLocais = function') && guard.includes('cold:true')],
  ['diagnóstico de startup está disponível', guard.includes('window.__startup = function')],
  ['guarda é o último módulo do app', build.includes("'js/99d-startup-stability-ai.js','js/99e-startup-hot-hydration.js'")]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`STARTUP HOT HYDRATION: ${checks.length}/${checks.length} contratos válidos.`);
