import fs from 'node:fs';
import assert from 'node:assert/strict';

const extras = fs.readFileSync('src/js/59-extras-central-ui.js','utf8');
const tec = fs.readFileSync('src/js/59-tec-layout-v2.js','utf8');
const cssExtras = fs.readFileSync('src/css/13-extras-central.css','utf8');
const cssTec = fs.readFileSync('src/css/14-tec-layout-v2.css','utf8');
const build = fs.readFileSync('build.mjs','utf8');

assert.match(extras,/extras-settings-btn/,'deve criar botão central de configurações');
assert.match(extras,/data-xsc-tab="reforcos"/,'deve segmentar reforços');
assert.match(extras,/data-xsc-tab="lei"/,'deve segmentar lei seca');
assert.match(extras,/data-xsc-tab="manuais"/,'deve segmentar manuais');
assert.match(extras,/data-xsc-law-mode/,'lei seca deve permitir meta por linhas ou tempo');
assert.match(extras,/data-xsc-law-preset="leve"/,'deve oferecer cenários rápidos');
assert.match(extras,/ReforcoGovernanca\.abrirPolitica/,'central deve reutilizar governança existente');
assert.match(cssExtras,/#extras-agenda \.lr-panel/,'painel de lei seca não deve ficar solto na agenda');
assert.match(cssExtras,/\.xsc-info/,'ajustes devem ter ajuda contextual');

assert.match(tec,/Do diagnóstico para a ação/,'TEC deve ter leitura guiada');
assert.match(tec,/panorama/,'TEC deve orientar panorama');
assert.match(tec,/prioridade/,'TEC deve orientar prioridades');
assert.match(tec,/acao/,'TEC deve orientar ação');
assert.doesNotMatch(tec,/PlanoEngine\.calcular|DB\.save|DB\.update/,'camada visual TEC não deve alterar motor ou dados');
assert.match(cssTec,/\.pl-mat\.is-acao/,'cards de matéria devem receber hierarquia visual');
assert.match(cssTec,/@media\(max-width:760px\)/,'layout deve tratar mobile explicitamente');

assert.match(build,/css\/13-extras-central\.css/,'build deve incluir CSS da central');
assert.match(build,/css\/14-tec-layout-v2\.css/,'build deve incluir CSS do TEC v2');
assert.match(build,/js\/59-extras-central-ui\.js/,'build deve incluir JS da central');
assert.match(build,/js\/59-tec-layout-v2\.js/,'build deve incluir JS do TEC v2');

console.log('OK: organização de Extras e apresentação TEC v2 cobertas.');
