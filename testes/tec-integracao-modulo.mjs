import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const nav = read('src/html/03-corpo.html');
const body = read('src/html/05-corpo-cont.html');
const build = read('build.mjs');
const js = read('src/js/94-tec-integracao.js');
const head = read('src/html/00-cabecalho.html');
const edge = read('supabase/functions/tec-ai/index.ts');

const checks = [
  ['item de menu', nav.includes('data-screen="integracaotec"')],
  ['tela acessível', body.includes('id="screen-integracaotec"') && body.includes('role="region"')],
  ['estado da conexão', body.includes('id="tec-connect-status"')],
  ['métricas isoladas', ['questions','errors','books','pending'].every(x => body.includes(`id="tec-connect-${x}"`))],
  ['módulo incluído no build', build.includes("'js/94-tec-integracao.js'")],
  ['estilo incluído no build', build.includes("S('css/28-tec-integracao.css')")],
  ['ativação sob demanda', js.includes("screen === 'integracaotec'")],
  ['estado por perfil', js.includes('DB._profilePrefix()')],
  ['TEC permitido no quadro', head.includes('frame-src https://www.tecconcursos.com.br')],
  ['quadro incorporado', body.includes('id="tec-workspace-frame"')],
  ['importação JSON', body.includes('id="tec-connect-file"') && js.includes('importJSON(file)')],
  ['origem da ponte validada', js.includes("event.origin !== this.TEC_ORIGIN") && js.includes('event.source !== frame.contentWindow')],
  ['proteção contra duplicidade', js.includes('questionKey(account, book, id)')],
  ['cache por versão', js.includes("PROMPT_VERSION: 'tec-pedagogico-v1'")],
  ['seis abas do assistente', ['diagnostico','revisao','flashcards','quiz','reforco','professor'].every(x => body.includes(`data-section="${x}"`))],
  ['chave só no servidor', edge.includes("Deno.env.get('OPENAI_API_KEY')") && !js.includes('OPENAI_API_KEY')],
  ['backend autenticado e limitado', edge.includes('tokenSubject') && edge.includes('limited(userId)')],
  ['saída estruturada', edge.includes("type: 'json_schema'")],
  ['reforço em atividades extras', js.includes('DB.addExtra')],
  ['sincronização por seção', js.includes('SectionSync.markDirty')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`INTEGRAÇÃO TEC: ${checks.length}/${checks.length} contratos do módulo válidos.`);
