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


// Pacote Anki moderno: collection.anki21b/21c usa Zstandard. O decoder local
// precisa funcionar mesmo quando o navegador não oferece DecompressionStream('zstd').
vm.runInContext(readFileSync(join(ROOT,'src/vendor/fzstd-0.1.1/fzstd.js'),'utf8'),ctx,{filename:'fzstd.js'});
const zstdFixture=new Uint8Array([40,181,47,253,4,72,153,0,0,97,110,107,105,45,109,111,100,101,114,110,45,112,97,99,107,97,103,101,9,189,66,195]);
const zstdDecoded=await I._zstd(zstdFixture);
assert.equal(new TextDecoder().decode(zstdDecoded),'anki-modern-package');

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

// Contrato completo de CsvMetadata do Anki 26.09.2: colunas especiais,
// mapeamento arbitrário, duplicatas, match scope e override de separador.
const advanced=I.parseText(
  '#separator:pipe\n#html:true\n#notetype:Basic\n#deck column:3\n#tags column:4\n#guid column:5\n#columns:Back|Front|Deck|Tags|GUID\nResposta|Pergunta|Fiscal|tagA|g-adv',
  'advanced.txt'
);
assert.deepEqual(Array.from(advanced.columns),['Back','Front','Deck','Tags','GUID']);
assert.equal(advanced.deckColumn,3);assert.equal(advanced.tagsColumn,4);assert.equal(advanced.guidColumn,5);
const forced=I.parseText('#separator:comma\nA,B','forced.txt',{delimiter:'|'});
assert.equal(forced.delimiter,'|','force_delimiter precisa prevalecer sobre cabeçalho');

const state={decks:[],cards:[],notes:new Map(),next:100};
const basic={id:1,ankiId:1,name:'Basic',kind:'normal',fields:[{name:'Front'},{name:'Back'}],
  templates:[{name:'Card 1',qfmt:'{{Front}}',afmt:'{{FrontSide}}<hr id=answer>{{Back}}'}]};
ctx.escapeHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
ctx.CardEngine={invalidateDueCache(){}};
ctx.DB={
  getDecks:()=>state.decks,
  addDeck(nome){const d={id:'d'+(state.decks.length+1),nome:String(nome)};state.decks.push(d);return d;},
  getCards:()=>state.cards,
  addCard(data){const x={id:'c'+(++state.next),...structuredClone(data)};state.cards.push(x);return x;},
  updateCard(id,patch){const x=state.cards.find(c=>c.id===id);Object.assign(x,structuredClone(patch));return x;}
};
ctx.AnkiParity={
  noteTypes:()=>[basic],
  stockNotetype:()=>basic,
  notes:()=>[...state.notes.values()],
  _allocId:()=>++state.next,
  saveNote(n){const x=structuredClone(n);state.notes.set(String(x.id),x);return x;},
  renderTemplate(nt,note,ord,side,card,front){
    const t=nt.templates[ord]||nt.templates[0],fields=note.fields||{};
    return String(side==='answer'?t.afmt:t.qfmt).replace(/\{\{FrontSide\}\}/g,String(front||'')).replace(/\{\{([^{}]+)\}\}/g,(_,k)=>String(fields[k]||''));
  },
  _fieldNonempty:v=>String(v||'').replace(/<[^>]+>/g,'').trim().length>0,
  clozeOrdinals:()=>[]
};
const first=I.importText(advanced,{notetypeId:1,fieldColumns:[2,1],dupeResolution:'update',matchScope:'notetype',forceIsHtml:true,isHtml:true});
assert.equal(first.notes,1);assert.equal(state.notes.size,1);assert.equal(state.cards.length,1);
const n1=[...state.notes.values()][0];
assert.equal(n1.fields.Front,'Pergunta');assert.equal(n1.fields.Back,'Resposta');assert.deepEqual(n1.tags,['tagA']);
assert.equal(state.decks[0].nome,'Fiscal');

// GUID existente sempre atualiza; opção Duplicate não cria uma segunda nota.
const guidUpdate=I.parseText('#separator:pipe\n#notetype:Basic\n#deck column:3\n#guid column:4\nNova resposta|Pergunta|Fiscal|g-adv','x.txt');
const gu=I.importText(guidUpdate,{notetypeId:1,fieldColumns:[2,1],dupeResolution:'duplicate',forceIsHtml:true,isHtml:true});
assert.equal(state.notes.size,1);assert.equal(gu.updated,1);assert.equal([...state.notes.values()][0].fields.Back,'Nova resposta');

// Sem GUID, Duplicate cria nova nota; Preserve ignora; MatchScope inclui baralho.
const noGuid=I.parseText('#separator:pipe\n#notetype:Basic\n#deck column:3\nR2|Pergunta|Fiscal','x.txt');
I.importText(noGuid,{notetypeId:1,fieldColumns:[2,1],dupeResolution:'duplicate',matchScope:'notetype',forceIsHtml:true,isHtml:true});
assert.equal(state.notes.size,2,'Duplicate deve criar nova nota quando o match é pelo primeiro campo');
I.importText(noGuid,{notetypeId:1,fieldColumns:[2,1],dupeResolution:'preserve',matchScope:'notetype',forceIsHtml:true,isHtml:true});
assert.equal(state.notes.size,2,'Preserve deve manter a coleção sem nova duplicata');
const otherDeck=I.parseText('#separator:pipe\n#notetype:Basic\n#deck column:3\nR3|Pergunta|Outro','x.txt');
I.importText(otherDeck,{notetypeId:1,fieldColumns:[2,1],dupeResolution:'update',matchScope:'notetype-and-deck',forceIsHtml:true,isHtml:true});
assert.equal(state.notes.size,3,'MatchScope NoteType+Deck não pode casar nota em outro baralho');

// Merge de Note Types: preserva campos/templates dos dois lados e remapeia ords,
// inclusive quando um lado tem IDs modernos e o outro só ordinais legados.
const existingNt={id:10,ankiId:10,name:'Basic',kind:'normal',
  fields:[{name:'Front',ord:0},{name:'Back',ord:1},{name:'LegacyExtra',ord:2}],
  templates:[{name:'Card 1',ord:0,qfmt:'{{Front}}',afmt:'{{Back}}'}]};
const incomingNt={id:10,ankiId:10,name:'Basic',kind:'normal',
  fields:[{id:101,name:'Front Renamed',sourceOrd:0,ord:0},{id:102,name:'Back',sourceOrd:1,ord:1},{id:103,name:'IncomingExtra',sourceOrd:2,ord:2}],
  templates:[{id:201,name:'Card 1 renamed',sourceOrd:0,ord:0,qfmt:'{{Front Renamed}}',afmt:'{{Back}}'},
             {id:202,name:'Card 2',sourceOrd:1,ord:1,qfmt:'{{Back}}',afmt:'{{Front Renamed}}'}]};
const merged=I._mergeNotetype(existingNt,incomingNt,true);
assert.equal(merged.notetype.fields.length,3,'mesma posição legado↔moderno não pode duplicar campo');
assert.equal(merged.notetype.fields[0].name,'Front Renamed','versão incoming deve poder renomear campo correspondente');
assert.equal(merged.notetype.fields[2].name,'IncomingExtra','campo incoming no mesmo ordinal substitui versão correspondente');
assert.equal(merged.notetype.templates.length,2,'template adicional incoming deve ser preservado');
assert.deepEqual(Array.from(merged.templateOrd),[0,1],'ordinais incoming devem ser remapeados para o merge');
const union=I._mergeNotetype(
  {id:11,kind:'normal',fields:[{id:1,name:'Front',ord:0},{id:2,name:'Back',ord:1}],templates:[{id:9,name:'C1',ord:0}]},
  {id:11,kind:'normal',fields:[{id:1,name:'Front',ord:0},{id:3,name:'Third',ord:1}],templates:[{id:9,name:'C1',ord:0},{id:10,name:'C2',ord:1}]},
  false
);
assert.ok(union.notetype.fields.some(x=>x.name==='Back')&&union.notetype.fields.some(x=>x.name==='Third'),
  'merge por IDs deve preservar campos exclusivos dos dois lados');
assert.equal(union.notetype.templates.length,2,'merge deve preservar template exclusivo');

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

console.log('IMPORT ANKI: Zstandard, texto completo, 6 delimitadores, APKG/COLPKG Legacy2 e Mnemosyne DB validados.');
