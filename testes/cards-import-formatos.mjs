#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const require=createRequire(import.meta.url);
const init=require(join(ROOT,'src/vendor/sqljs-1.2.1/sql-asm.js'));
const SQL=await init();
const ctx={
  console,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,Map,Set,Date,JSON,Math,Number,String,Boolean,RegExp,Error,Promise,
  Blob,Response,DecompressionStream,structuredClone,atob:globalThis.atob,btoa:globalThis.btoa,Buffer,
  initSqlJs:async()=>SQL,globalThis:null
};
ctx.globalThis=ctx;
vm.createContext(ctx);
for(const p of ['src/js/34-anki-export.js','src/js/35-anki-import.js']){
  const src=readFileSync(join(ROOT,p),'utf8');
  vm.runInContext(src+'\n;globalThis.__loaded=1;',ctx,{filename:p});
}
vm.runInContext('globalThis.X=AnkiExport;globalThis.I=AnkiImport;',ctx);
const X=ctx.X,I=ctx.I;

// Texto Anki: cabeçalhos, HTML e campo multilinha entre aspas não podem se perder.
const txt='#separator:tab\n#html:true\n#columns:Front,Back,Tags,Deck,GUID\n#tags:global tag2\n"linha 1\n#isto continua no campo"\t"<details><summary>Dica</summary>R</details>"\ttagA\tFiscal\tg-1';
const parsed=I.parseText(txt,'cards.txt');
assert.equal(parsed.delimiter,'\t');
assert.equal(parsed.isHtml,true);
assert.deepEqual(Array.from(parsed.columns),['Front','Back','Tags','Deck','GUID']);
assert.equal(parsed.rows.length,1);
assert.equal(parsed.rows[0][0],'linha 1\n#isto continua no campo');
assert.match(parsed.rows[0][1],/<details>/);
assert.deepEqual(Array.from(parsed.globalTags),['global','tag2']);

// Todos os delimitadores expostos pelo Anki 26.09.2.
for(const [name,ch] of [['tab','\t'],['pipe','|'],['semicolon',';'],['colon',':'],['comma',','],['space',' ']]){
  const p=I.parseText('#separator:'+name+'\nA'+ch+'B','x.txt');
  assert.equal(p.delimiter,ch,name);
  assert.deepEqual(Array.from(p.rows[0]),['A','B'],name);
}

// Pacote Legacy2 real: ZIP -> collection.anki21 -> SQLite -> contagens/metadados.
const db=new SQL.Database();
db.run("CREATE TABLE col (id integer PRIMARY KEY, crt integer, ver integer, models text, decks text, dconf text)");
db.run("CREATE TABLE notes (id integer PRIMARY KEY, guid text, mid integer, mod integer, tags text, flds text)");
db.run("CREATE TABLE cards (id integer PRIMARY KEY, nid integer, did integer, ord integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text, mod integer)");
db.run("CREATE TABLE revlog (id integer PRIMARY KEY, cid integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer)");
const models={'10':{id:10,name:'Basic',type:0,flds:[{name:'Front'},{name:'Back'}],tmpls:[{name:'Card 1',qfmt:'{{Front}}',afmt:'{{Back}}'}],css:''}};
const decks={'20':{id:20,name:'Fiscal',conf:1,dyn:0}},dconf={'1':{id:1,name:'Default',new:{perDay:20,delays:[1,10]},rev:{perDay:200}}};
db.run('INSERT INTO col VALUES (1,?,?,?,?,?)',[1700000000,11,JSON.stringify(models),JSON.stringify(decks),JSON.stringify(dconf)]);
db.run("INSERT INTO notes VALUES (30,'guid',10,1700000000,' tag ','Q\x1fA')");
db.run("INSERT INTO cards VALUES (40,30,20,0,2,2,5,5,2500,2,0,0,0,0,0,'{}',1700000000)");
db.run("INSERT INTO revlog VALUES (1700000000000,40,3,5,1,2500,1200,1)");
const col=db.export();db.close();
const pkg=X.zipStore([
  {name:'meta',data:new Uint8Array([0x08,0x02])},
  {name:'collection.anki21',data:col},
  {name:'media',data:'{}'}
]);
const fake={name:'fixture.apkg',async arrayBuffer(){return pkg.buffer.slice(pkg.byteOffset,pkg.byteOffset+pkg.byteLength);}};
const inspected=await I.inspectPackage(fake);
assert.equal(inspected.pkg.version,2);
assert.equal(inspected.counts.notes,1);
assert.equal(inspected.counts.cards,1);
assert.equal(inspected.counts.revlog,1);
assert.equal(inspected.meta.models['10'].name,'Basic');
assert.equal(inspected.meta.decks['20'].name,'Fiscal');

// Colpkg passa pelo mesmo leitor de pacote, mudando apenas a intenção do formato.
const fakeCol={...fake,name:'fixture.colpkg'};
const inspectedCol=await I.inspectPackage(fakeCol);
assert.equal(inspectedCol.format,'colpkg');
assert.equal(inspectedCol.counts.cards,1);

// Mnemosyne: schema e consultas iguais ao importador oficial do Anki.
const mn=new SQL.Database();
mn.run('CREATE TABLE global_variables (key text,value text)');
mn.run("INSERT INTO global_variables VALUES ('version','3')");
mn.run('CREATE TABLE facts (_id integer primary key)');
mn.run('CREATE TABLE data_for_fact (_fact_id integer,key text,value text)');
mn.run('CREATE TABLE cards (_fact_id integer,fact_view_id text,tags text,next_rep integer,last_rep integer,easiness real,acq_reps integer,ret_reps integer,lapses integer)');
mn.run('INSERT INTO facts VALUES (1)');
mn.run("INSERT INTO data_for_fact VALUES (1,'f','Pergunta'),(1,'b','Resposta')");
mn.run("INSERT INTO cards VALUES (1,'2.1','tag',1700100000,1700000000,2.5,1,2,0)");
const mnb=mn.export();mn.close();
const mf={name:'mnemo.db',async arrayBuffer(){return mnb.buffer.slice(mnb.byteOffset,mnb.byteOffset+mnb.byteLength);}};
const mi=await I.inspectMnemosyne(mf);
assert.equal(mi.counts.notes,1);
assert.equal(mi.counts.cards,1);
assert.equal(mi.facts.length,2);

console.log('IMPORT ANKI: texto completo, 6 delimitadores, APKG/COLPKG Legacy2 e Mnemosyne DB validados.');
