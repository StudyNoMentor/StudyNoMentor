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
for(const f of fontes) assert.equal(/-v\d+\.(?:js|css)$/i.test(f),false,`fonte atual não deve carregar sufixo de versão: ${f}`);
assert.deepEqual([...new Set(declarados)].sort(),fontes,'todo JS/CSS/HTML de src deve participar exatamente do build publicado');

const proibidos=[
  'audit.html','audit-runner.cjs','audit-tests.js','audit-browser.js','audit-results.json','audit-browser-results.json',
  'testes/rodar-auditoria-browser.mjs','testes/stress-extras-tec.mjs','testes/resultado-stress-extras-tec.json',
  'testes/plano-robusto-v4.mjs','testes/plano-robusto-foco-questoes-v7.mjs','testes/reforco-cenarios.mjs'
];
for(const p of proibidos)assert.equal(existsSync(join(ROOT,p)),false,`artefato obsoleto voltou: ${p}`);
assert.equal(existsSync(join(ROOT,'testes','evidencias')),false,'evidências geradas não devem ser versionadas');

const semComentarios=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n\r]*/g,'$1');
const apiVersionada=/\bMotorSugestaoV\d+\b/;
const fontesJs=fontesAbs.filter(f=>f.endsWith('.js'));
for(const f of fontesJs){
  const codigo=semComentarios(readFileSync(f,'utf8'));
  assert.equal(apiVersionada.test(codigo),false,`API técnica versionada em src/: ${relative(ROOT,f)}`);
  assert.equal(/_legacyPuxar\b/.test(codigo),false,`fallback para Puxar do Plano legado não pode voltar: ${relative(ROOT,f)}`);
}

const testeAtual=fileURLToPath(import.meta.url);
const testesJs=walk(join(ROOT,'testes')).filter(f=>/\.(?:mjs|js)$/.test(f)&&f!==testeAtual);
for(const f of testesJs){
  const codigo=semComentarios(readFileSync(f,'utf8'));
  assert.equal(apiVersionada.test(codigo),false,`teste ainda referencia API técnica versionada: ${relative(ROOT,f)}`);
}

// Todo teste executável precisa participar de uma barreira automática. Arquivo
// .mjs sem referência no workflow/verificador é teste morto: parece proteção,
// mas nunca roda e tende a apodrecer silenciosamente.
const workflow=readFileSync(join(ROOT,'.github','workflows','verificar.yml'),'utf8');
const verificador=readFileSync(join(ROOT,'verificar.mjs'),'utf8');
const cobertura=workflow+'\n'+verificador;
const mjsTopo=readdirSync(join(ROOT,'testes')).filter(n=>n.endsWith('.mjs'));
const orfaos=mjsTopo.filter(n=>!cobertura.includes(`testes/${n}`));
assert.deepEqual(orfaos,[],`testes .mjs sem execução automática: ${orfaos.join(', ')}`);

// A pasta test/ contém fixtures auxiliares carregadas pelo verificador agregado.
// Ela ficava fora da barreira acima, então um helper abandonado poderia sobreviver
// indefinidamente no repositório. Cada JS/MJS auxiliar precisa ter consumidor
// explícito no verificar.mjs; se deixar de ter, deve ser removido junto da mudança.
const auxDir=join(ROOT,'test');
if(existsSync(auxDir)){
  const auxiliares=readdirSync(auxDir).filter(n=>/\.(?:mjs|js)$/.test(n));
  const auxOrfaos=auxiliares.filter(n=>!verificador.includes(`test/${n}`));
  assert.deepEqual(auxOrfaos,[],`auxiliares de test/ sem consumidor no verificador: ${auxOrfaos.join(', ')}`);
}

console.log(`OK: higiene do repositório — ${fontes.length} fontes publicadas, nenhuma órfã/duplicada, ${mjsTopo.length} testes executáveis cobertos e nenhuma API técnica versionada.`);
