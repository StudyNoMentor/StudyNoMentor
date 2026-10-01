#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const dir=join(root,'anki-oficial');
const read=name=>JSON.parse(readFileSync(join(dir,name),'utf8'));
const lock=read('UPSTREAM.lock.json');
const contracts=read('cards-contracts.json');
const audit=read('audit-status.json');
const submodules=read('inventario/submodules.json');
assert.equal(submodules.upstream_commit,lock.release_commit);
assert.equal(submodules.submodules.length,4);
assert.equal(new Set(submodules.submodules.map(s=>s.path)).size,4);
for(const s of submodules.submodules){
  assert.match(s.commit,/^[a-f0-9]{40}$/);
  assert.match(s.repository,/^ankitects\/[a-zA-Z0-9-]+$/);
  assert.equal(s.cards_scope,'OUTSIDE_CARDS_RUNTIME');
}
const chunks=readdirSync(join(dir,'inventario')).filter(p=>/^\d{4}-\d{4}\.json$/.test(p)).sort();
const files=chunks.flatMap(p=>read('inventario/'+p).files);
assert.equal(audit.schema,'studynomentor-anki-file-audit-v1');
assert.equal(audit.upstream_commit,lock.release_commit);
assert.equal(contracts.upstream_commit,lock.release_commit);
assert.equal(files.length,lock.total_files);
const byPath=new Map(files.map(f=>[f.path,f]));
assert.equal(byPath.size,files.length,'arquivo upstream duplicado');
for(const [i,f] of files.entries()){
  assert.equal(f.index,i+1);
  assert.match(f.blob_sha,/^[a-f0-9]{40}$/);
  assert.ok(['CARDS_RUNTIME','OUTSIDE_CARDS_RUNTIME'].includes(f.cards_scope));
  if(f.cards_scope==='CARDS_RUNTIME')assert.ok(contracts.categories[f.cards_category],f.path+' sem contrato');
}
const runtime=files.filter(f=>f.cards_scope==='CARDS_RUNTIME');
assert.equal(runtime.length,lock.cards_runtime_files);
assert.equal(files.length-runtime.length,lock.outside_cards_runtime_files);
assert.equal(contracts.total_runtime_files,runtime.length);
for(const [category,c] of Object.entries(contracts.categories)){
  assert.equal(runtime.filter(f=>f.cards_category===category).length,c.official_files,category);
  assert.ok(c.study_adapters.includes('anki_official_backend/app.py'),category+' sem backend oficial');
  assert.ok(c.study_adapters.includes('src/js/95-cards-official-bridge.js'),category+' sem ponte Cards');
}
assert.ok(audit.entries&&typeof audit.entries==='object'&&!Array.isArray(audit.entries));
for(const [path,entry] of Object.entries(audit.entries)){
  const file=byPath.get(path);
  assert.ok(file&&file.cards_scope==='CARDS_RUNTIME','evidência fora do escopo: '+path);
  assert.ok(['IN_REVIEW','CERTIFIED'].includes(entry.status),'status inválido: '+path);
  assert.equal(entry.blob_sha,file.blob_sha,'evidência de outra versão: '+path);
  if(entry.status==='CERTIFIED'){
    assert.ok(Array.isArray(entry.evidence)&&entry.evidence.length,'certificação sem evidência: '+path);
    for(const e of entry.evidence){
      assert.equal(e.upstream_commit,lock.release_commit);
      assert.match(e.study_commit,/^[a-f0-9]{40}$/);
      assert.ok(contracts.categories[file.cards_category].differential_tests.includes(e.test),'teste fora do contrato: '+path);
      assert.equal(e.result,'PASSED');
      assert.ok(Number.isInteger(e.cases)&&e.cases>0);
      for(const facet of ['state','result','persistence','error','common','edge']){
        assert.ok(e.covers?.includes(facet),'evidência não cobre '+facet+': '+path);
      }
      assert.ok(typeof e.artifact==='string'&&e.artifact.startsWith('anki-oficial/auditorias/')&&!e.artifact.includes('..'));
      assert.ok(existsSync(join(root,e.artifact)),'relatório de execução ausente: '+path);
    }
  }
}
const status=f=>f.cards_scope==='OUTSIDE_CARDS_RUNTIME'?'FORA DO ESCOPO CARDS':audit.entries[f.path]?.status||'PENDING';
const certified=runtime.filter(f=>status(f)==='CERTIFIED').length;
const reviewed=runtime.filter(f=>status(f)==='IN_REVIEW').length;
const bar=(done,total)=>'█'.repeat(Math.floor(20*done/total))+'░'.repeat(20-Math.floor(20*done/total));
const escape=s=>String(s).replaceAll('|','&#124;').replaceAll('`','&#96;');
const official=f=>'https://github.com/'+lock.repository+'/blob/'+lock.release_commit+'/'+f.path.split('/').map(encodeURIComponent).join('/');
const link=p=>'['+escape(p)+'](../'+p+')';
const lines=[
  '# Auditoria por arquivo — Cards × Anki '+lock.release,
  '',
  'Gerado por `node tools/anki-audit-report.mjs`. Não editar este relatório diretamente.',
  '',
  '**Alvo:** `'+lock.repository+'@'+lock.release_commit+'`. O `main` posterior é radar; não altera esta referência.',
  '',
  '**Inventário:** `'+bar(files.length,lock.total_files)+'` '+files.length+'/'+lock.total_files+' caminhos com SHA oficial registrado.',
  '**Certificação por arquivo:** `'+bar(certified,runtime.length)+'` '+certified+'/'+runtime.length+' arquivos de Cards certificados; '+reviewed+' em revisão.',
  '',
  'Inventariar, declarar um adapter ou passar um teste de categoria não prova paridade de cada arquivo. PENDING significa que ainda falta uma auditoria específica com evidência rastreável. FORA DO ESCOPO CARDS é uma classificação, não um selo de paridade.',
  '',
  'O gitlink `upstream` aponta o repositório oficial inteiro. Ele preserva o código literal; apenas os componentes efetivamente chamados pelo backend ou integrados à interface são executados pelos Cards. Componentes Qt/Svelte inventariados não passam a executar no navegador pela existência do submodule.',
  '',
  'Os adapters abaixo são pontos de inspeção. A semântica deve vir de `anki=='+lock.release+'` via backend/ponte. Superfícies visuais, interação, persistência e propagação entre planejamentos continuam exigindo validação própria.',
  '',
  '## Contratos e pontos de inspeção',
  '',
  '| Categoria | Arquivos oficiais | Certificados | Adapters Study a inspecionar | Testes declarados (não são prova de execução) |',
  '| --- | ---: | ---: | --- | --- |'
];
for(const [name,c] of Object.entries(contracts.categories)){
  const done=runtime.filter(f=>f.cards_category===name&&status(f)==='CERTIFIED').length;
  lines.push('| '+name+' | '+c.official_files+' | '+done+' | '+c.study_adapters.map(link).join('<br>')+' | '+c.differential_tests.map(link).join('<br>')+' |');
}
lines.push('','## Checklist integral — '+files.length+' arquivos','','Cada linha conserva o SHA do blob upstream. A categoria aponta o contrato acima. Estados e evidências individuais são mantidos em `audit-status.json`.','','| # | Concluído | Arquivo oficial | SHA do blob | Categoria | Estado |','| ---: | :---: | --- | --- | --- | --- |');
for(const f of files){
  const state=status(f);
  lines.push('| '+f.index+' | '+(state==='CERTIFIED'?'[x]':'[ ]')+' | ['+escape(f.path)+']('+official(f)+') | `'+f.blob_sha+'` | '+(f.cards_category||'—')+' | '+state+' |');
}
lines.push('','## Submódulos internos do upstream','','Além dos 2.107 blobs, o Anki aponta estes quatro repositórios. Seus arquivos internos não estão incluídos na contagem de blobs acima; os commits são preservados por `git submodule update --init --recursive`. Traduções e instaladores são registrados como fora do escopo Cards.','','| Caminho | Repositório | Commit oficial |','| --- | --- | --- |');
for(const s of submodules.submodules)lines.push('| '+s.path+' | ['+s.repository+'](https://github.com/'+s.repository+'/tree/'+s.commit+') | `'+s.commit+'` |');
lines.push('','## Critério para certificar um arquivo','','Exige comportamento upstream identificado, caminho de execução oficial ou comparação diferencial, estado/resultado/persistência/erro e casos comuns/extremos, sem fallback silencioso. O registro deve fixar SHA upstream, SHA Study, teste, quantidade de casos e relatório de execução versionado. Uma pessoa ainda deve conferir se a evidência cobre o arquivo inteiro; o gate valida a rastreabilidade, não substitui essa análise.','','Os detalhes de UI que o Study adapta precisam de equivalência de ações e resultados. Usar o motor oficial não certifica automaticamente todos os arquivos de editor, reviewer, browser, estatísticas ou Image Occlusion.','');
const report=lines.join('\n');
const out=join(dir,'AUDITORIA-POR-ARQUIVO.md');
if(process.argv.includes('--check'))assert.equal(readFileSync(out,'utf8'),report,'relatório desatualizado: execute node tools/anki-audit-report.mjs');
else writeFileSync(out,report);
console.log('ANKI FILE AUDIT: '+files.length+' arquivos mapeados; '+certified+'/'+runtime.length+' certificados; relatório '+(process.argv.includes('--check')?'conferido':'gerado')+'.');
