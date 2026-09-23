#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const file=process.env.SNM_ANKI_TYPEANSWER_EXPECTED;
assert.ok(file,'SNM_ANKI_TYPEANSWER_EXPECTED ausente');
const rows=JSON.parse(readFileSync(file,'utf8'));
const ctx={console,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-runtime.js'),'utf8'),ctx,{filename:'44-anki-runtime.js'});
const R=ctx.AnkiRuntime;
const canon=s=>String(s)
  .replace(/id="([^"]+)"/g,'id=$1').replace(/class="([^"]+)"/g,'class=$1')
  .replace(/&quot;/g,'"');
const fail=[];
for(const row of rows){
  const actual=R._typeCompareHtml(row.expected,row.typed,!row.combining);
  if(canon(actual)!==canon(row.html))fail.push({...row,actual,actualCanon:canon(actual),expectedCanon:canon(row.html)});
}
if(fail.length){console.error(JSON.stringify(fail.slice(0,20),null,2));assert.fail('Type Answer divergiu do Anki oficial em '+fail.length+' / '+rows.length+' casos');}
console.log('TYPE ANSWER DIFERENCIAL ANKI 26.09.3: '+rows.length+' casos, 0 divergências.');
