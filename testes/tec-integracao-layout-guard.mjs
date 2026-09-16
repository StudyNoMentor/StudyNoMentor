import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css=readFileSync(new URL('../src/css/34-tec-integracao-layout-guard.css',import.meta.url),'utf8');
assert.match(css,/tec-reconstruction-card[\s\S]*grid-column:\s*1\s*\/\s*-1\s*!important/);
assert.match(css,/tec-history-manager-card[\s\S]*grid-column:\s*1\s*\/\s*-1\s*!important/);
assert.match(css,/\.tec-connect-grid\s*>\s*\.card:not\([\s\S]*grid-column:\s*1\s*\/\s*-1/);
assert.match(css,/@media\s*\(max-width:\s*980px\)[\s\S]*grid-template-columns:\s*minmax\(0,1fr\)\s*!important/);
assert.match(css,/#tec-reconstruction-input[\s\S]*min-width:\s*0\s*!important/);
console.log('TEC LAYOUT GUARD: contrato estrutural validado.');
