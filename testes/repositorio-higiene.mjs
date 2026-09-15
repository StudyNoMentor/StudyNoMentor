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

const fontesAbs=walk(join(ROOT,'src')).filter(f=>/\.(?:js|css|html)$/.test(f));
const fontes=fontesAbs.map(f=>relative(join(ROOT,'src'),f).replaceAll('\\','/')).sort();
const noBuild=[...new Set(declarados)].sort();
assert.deepEqual(noBuild,fontes,'todo JS/CSS/HTML de src deve participar exatamente do build publicado');

const proibidos=[
  'audit.html','audit-runner.cjs','audit-tests.js','audit-browser.js','audit-results.json','audit-browser-results.json',
  'testes/rodar-auditoria-browser.mjs','testes/stress-extras-tec.mjs','testes/resultado-stress-extras-tec.json',
  'testes/plano-robusto-v4.mjs','testes/plano-robusto-foco-questoes-v7.mjs'
];
for(const p of proibidos)assert.equal(existsSync(join(ROOT,p)),false,`artefato obsoleto voltou: ${p}`);
assert.equal(existsSync(join(ROOT,'testes','evidencias')),false,'evidências geradas não devem ser versionadas');

const semComentarios=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n\r]*/g,'$1');
const aliasesObsoletos=[
  'PlanoSugestoesSimplificadoV2','PlanoSugestoesV2','PlanoSugestoesV3','PlanoSugestoesV4',
  'PlanoMotoresGovernancaV5','PlanoMotoresCentralTecV2','PlanoMotoresCentralTecV3','PlanoMotoresCentralTecV4','TecPlanoFonteMotorV1'
];
const fontesJs=fontesAbs.filter(f=>f.endsWith('.js'));
for(const f of fontesJs){
  const codigo=semComentarios(readFileSync(f,'utf8'));
  for(const nome of aliasesObsoletos)assert.equal(new RegExp(`\\b${nome}\\b`).test(codigo),false,`alias executável obsoleto em src/: ${relative(ROOT,f)} → ${nome}`);
  assert.equal(/_legacyPuxar\b/.test(codigo),false,`fallback para Puxar do Plano legado não pode voltar: ${relative(ROOT,f)}`);
}

// Nos testes, proíbe consumo executável dos aliases antigos, mas permite que
// auditorias citem o nome em strings/regex para garantir que o legado não volte.
const testeAtual=fileURLToPath(import.meta.url);
const testesJs=walk(join(ROOT,'testes')).filter(f=>/\.(?:mjs|js)$/.test(f)&&f!==testeAtual);
for(const f of testesJs){
  const codigo=semComentarios(readFileSync(f,'utf8'));
  for(const nome of aliasesObsoletos){
    const usa=new RegExp(`(?:typeof\\s+${nome}\\b|\\b${nome}\\s*\\.|window\\.${nome}\\b|ctx\\.window\\.${nome}\\b)`);
    assert.equal(usa.test(codigo),false,`teste ainda consome alias obsoleto: ${relative(ROOT,f)} → ${nome}`);
  }
}

console.log(`OK: higiene do repositório — ${fontes.length} fontes publicadas, nenhuma órfã/duplicada e nenhum artefato/alias obsoleto conhecido.`);
