import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const guard = read('src/js/99q-deploy-consistency-guard.js');
const build = read('build.mjs');

const checks = [
  ['guard é carregado depois do hardening de egress', build.includes("'js/99p-tec-reset-epoch-guard.js','js/99q-deploy-consistency-guard.js'")],
  ['checagem por build usa versão carimbada', guard.includes('VERSION_PREFIX') && guard.includes('appVersion()') && guard.includes('versionKey(id)')],
  ['auditoria profunda é limitada por geração', guard.includes("GENERATION = 'profile-integrity-v1'") && guard.includes('deepKey(id)') && guard.includes('deepNeeded')],
  ['manifesto e revisões são verificados antes de baixar conteúdo', guard.includes("select('section,rev')") && guard.includes("eq('section', S.MANIFEST)")],
  ['seção local ausente vira reparo remoto', guard.includes("reason:localStorage.getItem(pfx + sec) === null ? 'secao-local-ausente'")],
  ['alteração local pendente nunca é sobrescrita', guard.includes("reason:'alteracao-local-pendente'") && guard.includes('pending.has(sec)')],
  ['hash local divergente é reenfileirado', guard.includes("'hash-local-divergente-do-bookkeeping'") && guard.includes('S.markDirty')],
  ['conflito ambíguo usa blob como terceira fonte', guard.includes('consenso-nuvem-blob') && guard.includes('consenso-local-blob') && guard.includes('conflito-tres-fontes')],
  ['reparo faz snapshot antes de sobrescrever', guard.indexOf("BackupHistory.snapshot('antes do autorreparo") < guard.indexOf('for (const item of toRepair)')],
  ['reparo preserva cópia substituída na lixeira', guard.includes("Lixeira.guardar(key, 'substituída no autorreparo pós-atualização')")],
  ['reparo é persistido no IndexedDB antes de concluir', guard.includes('if (window.__idbFlush) await window.__idbFlush()')],
  ['versões página/controller são comparadas', guard.includes('const controller = await askWorker(navigator.serviceWorker.controller)') && guard.includes('controller === page')],
  ['worker waiting só assume se for exatamente a versão da página', guard.includes('waitingV !== page') && guard.includes("waiting.postMessage('skipWaiting')")],
  ['não existe reload cego após timeout do controller', guard.includes('Não existe reload cego') && !guard.includes('setTimeout(() => location.reload()')],
  ['pendência local impede troca automática de worker', guard.includes('if (hasLocalPending())') && guard.includes("reason:'pendencia-local'")],
  ['diagnóstico fica exposto', guard.includes('window.DeployConsistency = DeployConsistency') && guard.includes('status()')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`DEPLOY CONSISTENCY: ${checks.length}/${checks.length} contratos válidos.`);
