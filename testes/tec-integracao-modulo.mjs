import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const nav = read('src/html/03-corpo.html');
const body = read('src/html/05-corpo-cont.html');
const build = read('build.mjs');
const js = read('src/js/94-tec-integracao.js');

const checks = [
  ['item de menu', nav.includes('data-screen="integracaotec"')],
  ['tela acessível', body.includes('id="screen-integracaotec"') && body.includes('role="region"')],
  ['estado da conexão', body.includes('id="tec-connect-status"')],
  ['métricas isoladas', ['questions','errors','books','pending'].every(x => body.includes(`id="tec-connect-${x}"`))],
  ['módulo incluído no build', build.includes("'js/94-tec-integracao.js'")],
  ['estilo incluído no build', build.includes("S('css/28-tec-integracao.css')")],
  ['ativação sob demanda', js.includes("screen === 'integracaotec'")],
  ['estado por perfil', js.includes('DB._profilePrefix()')]
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  failed.forEach(([name]) => console.error('FALHOU:', name));
  process.exit(1);
}
console.log(`INTEGRAÇÃO TEC: ${checks.length}/${checks.length} contratos do módulo válidos.`);
