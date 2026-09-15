#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(d,e.name)):[join(d,e.name)]);
const build=readFileSync(join(ROOT,'build.mjs'),'utf8');
const declarados=[...build.matchAll(/['"]((?:html|css|js)\/[^'"]+)['"]/g)].map(m=>m[1]);
const duplicados=declarados.filter((x,i)=>declarados.indexOf(x)!==i);
assert.deepEqual([...new Set(duplicados)],[],'build.mjs não pode carregar a mesma fonte duas vezes');

const fontes=walk(join(ROOT,'src')).filter(f=>/\.(?:js|css|html)$/.test(f)).map(f=>relative(join(ROOT,'src'),f).replaceAll('\\','/')).sort();
const noBuild=[...new Set(declarados)].sort();
assert.deepEqual(noBuild,fontes,'todo JS/CSS/HTML de src deve participar exatamente do build publicado');

const proibidos=[
  'audit.html','audit-runner.cjs','audit-tests.js','audit-browser.js','audit-results.json','audit-browser-results.json',
  'testes/rodar-auditoria-browser.mjs','testes/stress-extras-tec.mjs','testes/resultado-stress-extras-tec.json',
  'testes/plano-robusto-v4.mjs','testes/plano-robusto-foco-questoes-v7.mjs'
];
for(const p of proibidos)assert.equal(existsSync(join(ROOT,p)),false,`artefato obsoleto voltou: ${p}`);
assert.equal(existsSync(join(ROOT,'testes','evidencias')),false,'evidências geradas não devem ser versionadas');

const raizGerados=['audit-results.json','audit-browser-results.json'];
for(const p of raizGerados)assert.equal(existsSync(join(ROOT,p)),false,`resultado gerado não deve ficar versionado: ${p}`);

console.log(`OK: higiene do repositório — ${fontes.length} fontes publicadas, nenhuma órfã/duplicada e nenhum artefato obsoleto conhecido.`);
