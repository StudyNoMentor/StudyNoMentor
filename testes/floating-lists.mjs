#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(p,'utf8');
const infra=read('src/js/10-infra.js');
const base=read('src/css/06-ux-base.css');
const tec=read('src/css/32-ajustes-ui.css');
const tecJs=read('src/js/51-tela-desempenho-tec.js');
const grade=read('src/js/33-tela-grade.js');
const gradeCss=read('src/css/01-base.css');

assert.match(infra,/const AnchoredListViewport = \{/,'deve existir um posicionador central de listas flutuantes');
assert.match(infra,/window\.visualViewport/,'deve medir o viewport visual no mobile/teclado');
assert.match(infra,/getElementById\('tabs'\)/,'deve descontar a barra móvel fixa do Study');
assert.match(infra,/_bounds\(panel\)/,'deve considerar ancestrais que recortam conteúdo');
assert.match(infra,/[\\/\(]auto\|scroll\|hidden\|clip[\\/\)]/,'deve reconhecer containers com overflow que recortam o menu');
assert.match(infra,/ux-float-up/,'deve conseguir inverter a abertura para cima');

for (const sel of [
  '.ms-disc-filter-panel',
  '.tec-disc-pick-panel',
  '.banca-pick-panel',
  '.pl-disc-panel',
  '.cards-more-menu',
  '.grade-gear-menu',
  '#anki-browser-columns-menu',
  '.plan-switcher-menu'
]) {
  assert.ok(infra.includes(sel), sel+' deve participar da regra global de viewport');
}

assert.match(base,/\.ux-float-viewport\.ux-float-up[\s\S]*bottom:\s*calc\(100% \+ var\(--ux-float-gap/,'CSS deve ancorar menu invertido acima do botão');
assert.match(base,/\.pl-modal-field\s*\{\s*position:\s*relative/,'dropdown do Puxar do Motor precisa de containing block correto');
assert.match(base,/profile-menu,[\s\S]*cloud-menu[\s\S]*max-height:\s*calc\(100dvh - 20px\)/,'menus fixed devem ter teto físico do viewport');
assert.match(base,/profile-menu-list,[\s\S]*cloud-menu-body[\s\S]*overflow-y:\s*auto/,'conteúdo de menus fixed deve rolar internamente');

assert.match(tec,/\.ms-disc-filter-panel[\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/,'painel de matérias do Motor deve reservar uma linha rolável');
assert.match(tec,/\.ms-disc-filter-list[\s\S]*min-height:\s*0;\s*max-height:\s*none;\s*overflow-y:\s*auto/,'lista do Motor deve rolar dentro do painel');
assert.match(tec,/\.banca-pick-panel[\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/,'painel de bancas deve reservar área rolável');
assert.match(tec,/\.banca-pick-list[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto/,'lista de bancas deve rolar internamente');
assert.match(tec,/\.tec-disc-pick-list[\s\S]*overflow-y:\s*auto;[\s\S]*touch-action:\s*pan-y/,'seletor de disciplinas da Análise deve ter scroll tátil');

assert.match(tecJs,/_bindMotorDiscFilter[\s\S]*AnchoredListViewport\.schedule\(\)/,'seletor do Motor deve pedir reposicionamento ao abrir');
assert.match(tecJs,/renderBancaPicker[\s\S]*AnchoredListViewport\.schedule\(\)/,'seletor de bancas deve pedir reposicionamento');
assert.match(tecJs,/renderDiscPicker[\s\S]*AnchoredListViewport\.schedule\(\)/,'seletor da Análise deve pedir reposicionamento');
assert.match(tecJs,/banca-pick-panel,.tec-disc-pick-panel,.ms-disc-filter-panel/,'seletores TEC devem se fechar mutuamente');

assert.match(grade,/AnchoredListViewport\._viewport/,'seletor de matéria da Grade deve compartilhar a régua do viewport');
assert.match(grade,/const paraCima = natural > abaixo && acima > abaixo/,'seletor da Grade deve inverter quando faltar espaço embaixo');
assert.match(gradeCss,/\.gsp-list\s*\{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y/,'lista da Grade deve rolar por toque');

console.log('LISTAS FLUTUANTES: viewport, inversão, recorte e rolagem interna validados em todo o contrato auditado.');
