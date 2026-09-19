import fs from 'node:fs';
import assert from 'node:assert/strict';

const extras = fs.readFileSync('src/js/59-extras-central-ui.js','utf8');
const cssExtras = fs.readFileSync('src/css/13-extras-central.css','utf8');
const build = fs.readFileSync('build.mjs','utf8');

assert.match(extras,/extras-settings-btn/,'deve criar botão central de configurações');
assert.match(extras,/\['reforcos',\s*'🎯',\s*'Reforços'/,'deve declarar a seção de reforços');
assert.match(extras,/\['lei',\s*'📚',\s*'Lei seca'/,'deve declarar a seção de lei seca');
assert.match(extras,/\['manuais',\s*'✍️',\s*'Manuais'/,'deve declarar a seção de manuais');
assert.match(extras,/data-xsc-tab="\$\{id\}"/,'navegação deve materializar as seções dinamicamente');
assert.match(extras,/data-xsc-law-mode/,'lei seca deve permitir meta por linhas ou tempo');
assert.match(extras,/data-xsc-law-preset="leve"/,'deve oferecer cenários rápidos');
assert.match(extras,/ReforcoGovernanca\.abrirPolitica/,'central deve reutilizar governança existente');
assert.match(cssExtras,/#extras-agenda \.lr-panel/,'painel de lei seca não deve ficar solto na agenda');
assert.match(cssExtras,/\.xsc-info/,'ajustes devem ter ajuda contextual');

/* A camada visual que decorava o Plano legado saiu com ele. O que continua
   valendo para a tela de decisao esta na propria aba do Motor, e a folha de
   estilo dela tem de estar no build. */
const cssMotor = fs.readFileSync('src/css/22-motor-sugestao.css','utf8');
assert.match(cssMotor,/\.ms-fase/,'a fase pre/pos precisa de estilo proprio');
assert.match(cssMotor,/\.ms-item/,'cada frente da fila precisa de estilo proprio');
assert.match(cssMotor,/\.tec-ordem/,'a ordem de exibicao da arvore precisa de estilo proprio');
assert.match(cssMotor,/@media \(max-width: 560px\)/,'layout deve tratar mobile explicitamente');

assert.match(build,/css\/13-extras-central\.css/,'build deve incluir CSS da central');
assert.match(build,/css\/22-motor-sugestao\.css/,'build deve incluir CSS do Motor');
assert.match(build,/js\/59-extras-central-ui\.js/,'build deve incluir JS da central');
assert.match(build,/js\/86-motor-sugestao\.js/,'build deve incluir o Motor de sugestao');

console.log('OK: organização de Extras e superfície do Motor cobertas.');
