import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync(new URL('../src/css/34-tec-integracao-layout-guard.css',import.meta.url),'utf8');
const build=readFileSync(new URL('../build.mjs',import.meta.url),'utf8');

assert.match(build,/css\/34-tec-integracao-layout-guard\.css/,'build precisa publicar a guarda final de layout TEC');
assert.match(css,/#screen-integracaotec #tec-reconstruction-card[\s\S]*?grid-column:\s*1\s*\/\s*-1\s*!important/,'reconstrução deve ocupar o grid inteiro');
assert.match(css,/#screen-integracaotec #tec-history-manager-card[\s\S]*?grid-column:\s*1\s*\/\s*-1\s*!important/,'gestão de históricos deve ocupar o grid inteiro');
assert.match(css,/\.tec-connect-grid\s*>\s*\.card:not\([\s\S]*?grid-column:\s*1\s*\/\s*-1/,'cards futuros sem contrato próprio não podem cair em 1\/12');
assert.match(css,/@media\s*\(max-width:\s*980px\)[\s\S]*?grid-template-columns:\s*minmax\(0,1fr\)\s*!important/,'tablet/mobile deve colapsar para uma coluna real');
assert.match(css,/#tec-reconstruction-input[\s\S]*?min-width:\s*0\s*!important/,'input não pode forçar overflow horizontal');
assert.match(css,/overflow-x:\s*clip/,'screen deve impedir overflow horizontal residual');

console.log('TEC LAYOUT CONTRATO: spans, overflow e breakpoints defensivos validados.');
