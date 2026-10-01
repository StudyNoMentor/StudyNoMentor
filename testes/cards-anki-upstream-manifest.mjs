#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const A=join(ROOT,'anki-oficial');
const lock=JSON.parse(readFileSync(join(A,'UPSTREAM.lock.json'),'utf8'));
const contracts=JSON.parse(readFileSync(join(A,'cards-contracts.json'),'utf8'));
const chunks=readdirSync(join(A,'inventario')).filter(x=>/^\d{4}-\d{4}\.json$/.test(x)).sort();
const files=chunks.flatMap(x=>JSON.parse(readFileSync(join(A,'inventario',x),'utf8')).files||[]);
const submodules=JSON.parse(readFileSync(join(A,'inventario/submodules.json'),'utf8'));
assert.equal(submodules.upstream_commit,lock.release_commit);
assert.equal(submodules.submodules.length,4,'submodulos internos do Anki devem ser inventariados');
execFileSync(process.execPath,[join(ROOT,'tools/anki-audit-report.mjs'),'--check'],{cwd:ROOT,stdio:'pipe'});

assert.equal(lock.schema,'studynomentor-anki-upstream-lock-v1');
assert.equal(lock.release,'26.09.3');
assert.equal(lock.release_commit,'29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba');
assert.equal(files.length,lock.total_files,'inventario nao cobre todos os arquivos');
assert.equal(files.length,2107,'quantidade do upstream 26.09.3 mudou sem atualizar o lock');

const paths=new Set();
for(let i=0;i<files.length;i++){
  const f=files[i];
  assert.equal(f.index,i+1,'indice descontinuo em '+f.path);
  assert.ok(f.path&&typeof f.path==='string','path invalido no item '+(i+1));
  assert.match(f.blob_sha,/^[0-9a-f]{40}$/,'blob SHA invalido em '+f.path);
  assert.ok(!paths.has(f.path),'path duplicado: '+f.path);
  paths.add(f.path);
}
const runtime=files.filter(f=>f.cards_scope==='CARDS_RUNTIME');
const outside=files.filter(f=>f.cards_scope==='OUTSIDE_CARDS_RUNTIME');
assert.equal(runtime.length,lock.cards_runtime_files);
assert.equal(runtime.length,571,'escopo funcional de Cards esperado: 571 arquivos');
assert.equal(outside.length,lock.outside_cards_runtime_files);
assert.equal(outside.length,1536);

for(const f of runtime){
  assert.ok(f.cards_category,'arquivo runtime sem categoria: '+f.path);
  const c=contracts.categories[f.cards_category];
  assert.ok(c,'categoria sem contrato: '+f.cards_category+' <- '+f.path);
  assert.ok(Array.isArray(c.study_adapters)&&c.study_adapters.length,'categoria sem adapter Study: '+f.cards_category);
  assert.ok(Array.isArray(c.differential_tests)&&c.differential_tests.length,'categoria sem teste: '+f.cards_category);
}
for(const [name,c] of Object.entries(contracts.categories)){
  for(const p of [...c.study_adapters,...c.differential_tests]){
    assert.ok(existsSync(join(ROOT,p)),name+' aponta arquivo Study inexistente: '+p);
  }
  const n=runtime.filter(f=>f.cards_category===name).length;
  assert.equal(n,c.official_files,'contagem divergente no contrato '+name);
}

const gm=readFileSync(join(ROOT,'.gitmodules'),'utf8');
assert.match(gm,/path = anki-oficial\/upstream/);
assert.match(gm,/url = https:\/\/github\.com\/ankitects\/anki\.git/);
const treeLine=execFileSync('git',['ls-tree','HEAD','anki-oficial/upstream'],{cwd:ROOT,encoding:'utf8'}).trim();
assert.match(treeLine,new RegExp('^160000 commit '+lock.release_commit+'\\tanki-oficial/upstream$'),'gitlink nao aponta o commit oficial travado');

const upstream=join(A,'upstream');
if(existsSync(join(upstream,'.git'))||existsSync(join(upstream,'rslib'))){
  const head=execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  assert.equal(head,lock.release_commit,'submodule checkout em commit diferente');
  const dirty=execFileSync('git',['-C',upstream,'status','--porcelain','--untracked-files=all'],{cwd:ROOT,encoding:'utf8'}).trim();
  assert.equal(dirty,'','fonte upstream deve permanecer literal, sem alterações locais');
  const ls=execFileSync('git',['-C',upstream,'ls-tree','-r','HEAD'],{cwd:ROOT,encoding:'utf8',maxBuffer:32*1024*1024}).trim().split('\n').filter(Boolean);
  const map=new Map(ls.map(line=>{
    const m=/^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(line); return m?[m[2],m[1]]:null;
  }).filter(Boolean));
  assert.equal(map.size,files.length,'submodule possui quantidade diferente de blobs');
  for(const f of files) assert.equal(map.get(f.path),f.blob_sha,'blob divergiu do inventario: '+f.path);
  const links=new Map(ls.map(line=>{
    const m=/^160000 commit ([0-9a-f]{40})\t(.+)$/.exec(line);return m?[m[2],m[1]]:null;
  }).filter(Boolean));
  assert.equal(links.size,submodules.submodules.length);
  for(const s of submodules.submodules)assert.equal(links.get(s.path),s.commit,'submodule interno divergente: '+s.path);
  console.log('ANKI UPSTREAM: 2107/2107 blobs conferidos byte-a-byte pela Git tree do submodule.');
}else{
  console.log('ANKI UPSTREAM: gitlink conferido; submodule nao inicializado, validacao blob-a-blob fica para checkout com --recurse-submodules.');
}
console.log('CARDS UPSTREAM MAP: 571/571 arquivos funcionais classificados; 1536/1536 arquivos restantes inventariados.');
console.log('CONTRATOS: '+Object.keys(contracts.categories).length+' categorias, todas com adapter e teste declarados.');
