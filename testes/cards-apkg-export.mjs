#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const require=createRequire(import.meta.url);
const initSqlJs=require(join(ROOT,'src/vendor/sqljs-1.2.1/sql-asm.js'));
assert.equal(typeof initSqlJs,'function','vendor sql.js deve exportar initSqlJs');
const SQL=await initSqlJs();

const W=[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542];
const cfg={
  retention:.9,learnSteps:[1,10],relearnSteps:[10],weights:W,newPerDay:20,revPerDay:200,
  buryNew:false,buryReviews:false,buryInterdayLearning:false,initialEase:2.5,
  graduatingIntervalGood:1,graduatingIntervalEasy:4,easyMultiplier:1.3,intervalMultiplier:1,
  maxInterval:36500,hardMultiplier:1.2,leechAction:'tag',leechThreshold:8,minimumLapseInterval:1,
  lapseMultiplier:0,newMix:'misturar',newPerDayMinimum:0,interdayMix:'misturar',reviewOrder:'day',
  newSortOrder:'template',newGatherOrder:'deck',newInsertOrder:'sequencial',ignoreRevlogsBefore:'',
  easyDays:[1,1,1,1,1,1,1],historicalRetention:.9,paramSearch:''
};
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';
const decks=[{id:'d1',ankiId:1700000000101,nome:'Fiscal',createdAt:'2026-09-01T12:00:00.000Z',configId:'default'}];
const cards=[
  {id:'c1',ankiId:1700000000201,ankiNoteId:1700000000301,ankiTemplateOrd:0,ankiMod:1780000000,
   deckId:'d1',phase:'review',due:'2026-09-25',intervalo:12,reps:4,lapses:1,ease:2.5,
   s:11.23456,d:5.6789,lastReview:'2026-09-20',createdAt:'2026-09-01T12:00:00.000Z',updatedAt:'2026-09-22T08:00:00.000Z',
   materia:'Direito Tributário',assunto:'ICMS',banca:'FCC',tipo:'lei',flag:2},
  {id:'c2',ankiId:1700000000202,ankiNoteId:1700000000302,ankiTemplateOrd:0,ankiMod:1780000001,
   deckId:'d1',phase:'new',due:'2026-09-22',intervalo:0,reps:0,lapses:0,ease:2.5,posicaoNova:7,
   createdAt:'2026-09-02T12:00:00.000Z',updatedAt:'2026-09-22T08:01:00.000Z',kind:'cloze',clozeOrd:1}
];
const nts=[
  {id:1700000000401,ankiId:1700000000401,name:'Basic',kind:'normal',createdAt:'2026-09-01T12:00:00.000Z',
   fields:[{name:'Front'},{name:'Back'}],
   templates:[{name:'Card 1',qfmt:'{{Front}}',afmt:'{{FrontSide}}<hr id=answer>{{Back}}'}],
   css:'.card { font-family: arial; }'},
  {id:1700000000402,ankiId:1700000000402,name:'Cloze',kind:'cloze',createdAt:'2026-09-01T12:00:00.000Z',
   fields:[{name:'Text'},{name:'Back Extra'}],
   templates:[{name:'Cloze',qfmt:'{{cloze:Text}}',afmt:'{{cloze:Text}}<br>{{Back Extra}}'}],
   css:'.card { font-family: arial; }.cloze { font-weight:bold; }'}
];
const notes=new Map([
  ['1700000000301',{id:1700000000301,ankiId:1700000000301,notetypeId:1700000000401,guid:'g-basic',
    fields:{Front:'Pergunta <img src="data:image/png;base64,'+pixel+'">',Back:'Resposta <audio src="data:audio/mpeg;base64,SUQz"></audio>'},tags:['original'],
    createdAt:'2026-09-01T12:00:00.000Z',updatedAt:'2026-09-22T08:00:00.000Z'}],
  ['1700000000302',{id:1700000000302,ankiId:1700000000302,notetypeId:1700000000402,guid:'g-cloze',
    fields:{Text:'O {{c1::ICMS}} é estadual.','Back Extra':'CF/88'},tags:[],
    createdAt:'2026-09-02T12:00:00.000Z',updatedAt:'2026-09-22T08:01:00.000Z'}]
]);
const revlog=[
  {ts:1758300000000,cardId:'c1',grade:3,phase:'learning',intervalo:0},
  {ts:1758386400000,cardId:'c1',grade:3,phase:'review',intervalo:1},
  {ts:1758472800000,cardId:'c1',grade:2,phase:'review',intervalo:5}
];

const DB={getCards:()=>structuredClone(cards),getDecks:()=>structuredClone(decks),getRevlog:()=>structuredClone(revlog)};
const CardsConfig={get:()=>structuredClone(cfg),forDeck:()=>structuredClone(cfg),hasDeckPreset:()=>false};
const FSRS={DEFAULT_W:W,migrarW:v=>Array.isArray(v)&&v.length===21?v:null};
const AnkiParity={
  ensureIdentities(){},ensureCanonicalNotes(){},
  isFilteredDeck:d=>!!(d&&d.filtered),
  noteId:c=>Number(c.ankiNoteId),
  getNote:id=>structuredClone(notes.get(String(id))||null),
  noteTypes:()=>structuredClone(nts),
  notes:()=>structuredClone([...notes.values()]),
  renderTemplate(nt,note,ord,side,card,frontSide){
    const tmpl=(nt.templates||[])[nt.kind==='cloze'?0:(Number(ord)||0)]||{},fields=note.fields||{};
    let src=String(side==='answer'?tmpl.afmt:tmpl.qfmt||'').replace(/\{\{FrontSide\}\}/g,String(frontSide||''));
    src=src.replace(/\{\{cloze:([^}]+)\}\}/g,(_,name)=>{
      const raw=String(fields[name]||''),target=Number(card&&card.clozeOrd)||1;
      return raw.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g,(m,n,val,hint)=>Number(n)===target?(side==='answer'?val:'['+(hint||'...')+']'):val);
    });
    src=src.replace(/\{\{([^}:]+)\}\}/g,(_,name)=>String(fields[name]??''));
    return src;
  },
  sharedPresets:()=>({}),
  _trainingKind(r){
    const p=String(r&&r.phase||'').toLowerCase();
    if(p==='new'||p==='learning'||p==='learn')return 'learning';
    if(p==='relearning'||p==='relearn')return 'relearning';
    return 'review';
  }
};

const context={
  console,TextEncoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,Map,Set,Date,JSON,Math,Number,String,Boolean,RegExp,
  Error,Promise,Buffer,structuredClone,atob:globalThis.atob,
  DB,CardsConfig,FSRS,AnkiParity,todayCards:()=> '2026-09-22'
};
context.globalThis=context;
vm.createContext(context);
const source=readFileSync(join(ROOT,'src/js/34-anki-export.js'),'utf8');
vm.runInContext(source+'\n;globalThis.AnkiExport=AnkiExport;',context,{filename:'34-anki-export.js'});
const fzstdSource=readFileSync(join(ROOT,'src/vendor/fzstd-0.1.1/fzstd.js'),'utf8');
vm.runInContext(fzstdSource,context,{filename:'fzstd.js'});
const X=context.AnkiExport;
X._loadSqlJs=async()=>SQL;

// Contratos puros antes da integração SQLite.
assert.equal(X._sha1First32('abc'),0xa9993e36,'checksum Anki deve usar os 32 bits iniciais do SHA-1');
const fsrs=JSON.parse(X.cardData(cards[0],cfg));
assert.deepEqual(fsrs,{s:11.2346,d:5.679,dr:.9,lrt:Math.floor(new Date(2026,8,20).getTime()/1000)});
const mediaProbe={items:[],byKey:new Map()};
const rewritten=X.extractMedia('<img src="data:image/png;base64,'+pixel+'"><img src="data:image/png;base64,'+pixel+'">',mediaProbe);
assert.equal(mediaProbe.items.length,1,'mídia idêntica deve ser deduplicada');
assert.ok(!rewritten.includes('data:image/'),'HTML exportado não deve carregar data URI dentro do SQLite');

const buryBase={deckId:'d1',phase:'review',due:'2026-09-22',intervalo:3,reps:2,ease:2.5,enterradoAte:'2026-09-23'};
assert.equal(X.cardSchedule({...buryBase,buryKind:'scheduler'},Math.floor(new Date(2026,7,31).getTime()/1000),1).queue,-2,
  'enterro automático de irmãos deve exportar SchedBuried');
assert.equal(X.cardSchedule({...buryBase,buryKind:'user'},Math.floor(new Date(2026,7,31).getTime()/1000),1).queue,-3,
  'enterro manual deve exportar UserBuried');

const sw=readFileSync(join(ROOT,'sw.js'),'utf8');
for(const runtime of [
  './src/vendor/fsrs-6.6.2/fsrs_optimizer.js',
  './src/vendor/fsrs-6.6.2/fsrs_optimizer_bg.wasm',
  './src/vendor/sqljs-1.2.1/sql-asm.js'
]) assert.ok(sw.includes(runtime),'PWA deve pré-cachear runtime dinâmico: '+runtime);

// Integração real: gera o Legacy2 do Anki 26.09.2 e reabre o collection.anki21 com o MESMO sql.js vendorado.
const pkg=await X.buildPackage();
assert.equal(pkg.cards,2);
assert.equal(pkg.notes,2);
assert.equal(pkg.decks,1);
assert.equal(pkg.revlog,3);

function unzipStored(bytes){
  const files=new Map(),dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let p=0;
  while(p+30<=bytes.length&&dv.getUint32(p,true)===0x04034b50){
    const method=dv.getUint16(p+8,true),size=dv.getUint32(p+18,true),nlen=dv.getUint16(p+26,true),xlen=dv.getUint16(p+28,true);
    assert.equal(method,0,'APKG interno usa ZIP store determinístico');
    const name=new TextDecoder().decode(bytes.slice(p+30,p+30+nlen));
    const start=p+30+nlen+xlen;files.set(name,bytes.slice(start,start+size));p=start+size;
  }
  assert.ok(files.size>=2,'ZIP deve conter coleção e manifest de mídia');
  assert.equal(dv.getUint32(bytes.length-22,true),0x06054b50,'ZIP deve terminar com EOCD válido');
  return files;
}
const files=unzipStored(pkg.bytes);
assert.ok(files.has('meta'),'APKG Legacy2 deve declarar PackageMetadata');
assert.deepEqual(Array.from(files.get('meta')),[0x08,0x02],'meta protobuf deve declarar VERSION_LEGACY_2');
assert.ok(files.has('collection.anki21'),'APKG Legacy2 do Anki 26.09.2 deve conter collection.anki21');
assert.ok(files.has('media'),'APKG deve conter media manifest');
assert.ok(files.has('0'),'imagem incorporada deve virar arquivo de mídia numerado');
assert.ok(files.has('1'),'áudio incorporado deve virar arquivo de mídia numerado');
assert.ok(files.has('collection.anki2'),'pacote deve carregar a coleção de compatibilidade Legacy1');
const media=JSON.parse(new TextDecoder().decode(files.get('media')));
assert.match(media['0'],/^studynomentor_[0-9a-f]{8}-\d+\.png$/);
assert.match(media['1'],/^studynomentor_[0-9a-f]{8}-\d+\.mp3$/);

const db=new SQL.Database(files.get('collection.anki21'));
const scalar=sql=>db.exec(sql)[0].values[0][0];
assert.equal(scalar('select count(*) from notes'),2);
assert.equal(scalar('select count(*) from cards'),2);
assert.equal(scalar('select count(*) from revlog'),3);
assert.equal(scalar("select count(*) from sqlite_master where type='table' and name='col'"),1);

const col=db.exec('select ver,models,decks,dconf from col where id=1')[0].values[0];
assert.equal(col[0],11,'coleção exportada usa schema11 legado suportado pelo importador atual');
const models=JSON.parse(col[1]),deckJson=JSON.parse(col[2]),dconf=JSON.parse(col[3]);
assert.equal(Object.keys(models).length,2,'note types usados devem viajar no pacote');
assert.equal(deckJson['1700000000101'].name,'Fiscal');
assert.deepEqual(dconf['1'].fsrsParams6,W,'parâmetros FSRS-6 devem viajar no DeckConfig');
assert.equal(dconf['1'].desiredRetention,.9);

const cardRows=db.exec('select id,nid,did,type,queue,ivl,flags,data from cards order by id')[0].values;
assert.equal(cardRows[0][2],1700000000101,'card deve manter baralho');
assert.equal(cardRows[0][3],2,'card review deve manter type REVIEW');
assert.equal(cardRows[0][4],2,'card review deve manter queue REVIEW');
assert.equal(cardRows[0][5],12,'intervalo atual deve ser preservado');
assert.equal(cardRows[0][6],2,'flag deve ser preservada');
assert.equal(JSON.parse(cardRows[0][7]).s,11.2346,'estabilidade FSRS deve sobreviver');
assert.equal(cardRows[1][3],0,'card novo deve continuar NEW');

const fields=db.exec('select flds,tags from notes where id=1700000000301')[0].values[0];
assert.ok(fields[0].includes(media['0']),'campo da nota deve apontar para mídia empacotada');
assert.ok(!fields[0].includes('data:image/'));
assert.ok(fields[1].includes('Direito_Tributário')&&fields[1].includes('ICMS')&&fields[1].includes('FCC'),
  'taxonomia do StudyNoMentor deve viajar como tags Anki');

const rev=db.exec('select ease,type,lastIvl from revlog order by id')[0].values;
assert.deepEqual(rev.map(r=>r[0]),[3,3,2]);
assert.deepEqual(rev.map(r=>r[1]),[0,1,1],'tipos learning/review devem ser preservados no revlog');
assert.equal(rev[1][2],1,'lastIvl deve vir do intervalo anterior registrado');

db.close();

/* ── Exportadores de texto atuais do Anki ─────────────────────────────── */
const noteText=X.buildTextNotes({withHtml:true,withTags:true,withDeck:true,withNotetype:true,withGuid:true});
assert.equal(noteText.notes,2,'exportação de notas deve emitir uma linha por nota');
assert.ok(noteText.text.startsWith('#separator:tab\n#html:true\n#guid column:1\n#notetype column:2\n#deck column:3\n#tags column:6\n'),
  'cabeçalhos/índices de colunas de Notes in Plain Text devem seguir o Anki');
assert.ok(noteText.text.includes('<img src='),'Notes in Plain Text com HTML deve preservar HTML');

const cardText=X.buildTextCards({withHtml:true});
assert.equal(cardText.cards,2,'Cards in Plain Text deve emitir uma linha por card');
assert.ok(cardText.text.startsWith('#separator:tab\n#html:true\n'),'Cards in Plain Text deve usar os dois cabeçalhos oficiais');
assert.ok(!cardText.text.includes('<hr id=answer>'),'lado da resposta não deve repetir a pergunta antes do separador');

/* ── Enums modernos de Display Order não podem cair no default ────────── */
assert.equal(X._reviewOrder('dayThenDeck'),1);
assert.equal(X._reviewOrder('deckThenDay'),2);
assert.equal(X._reviewOrder('reverseAdded'),10);
assert.equal(X._gather('deckRandomNotes'),5);
assert.equal(X._gather('randomNotes'),3);
assert.equal(X._gather('randomCards'),4);
assert.equal(X._sortNew('templateRandom'),2);
assert.equal(X._sortNew('randomNoteTemplate'),3);
assert.equal(X._sortNew('randomCard'),4);

/* ── PackageMetadata VERSION_LATEST = 3 / schema 18 ───────────────────── */
const modern=await X.buildPackage({legacy:false});
const modernFiles=unzipStored(modern.bytes);
assert.deepEqual(Array.from(modernFiles.get('meta')),[0x08,0x03],'meta moderno deve declarar VERSION_LATEST');
assert.ok(modernFiles.has('collection.anki21b'),'pacote moderno deve usar collection.anki21b');
assert.ok(modernFiles.has('collection.anki2'),'pacote moderno mantém caminho Legacy1 de compatibilidade');
const modernDbBytes=context.fzstd.decompress(modernFiles.get('collection.anki21b'));
const modernDb=new SQL.Database(modernDbBytes);
assert.equal(modernDb.exec('select ver from col where id=1')[0].values[0][0],18,'collection.anki21b precisa ser schema 18 real');
for(const table of ['notetypes','fields','templates','decks','deck_config','config','tags']){
  assert.equal(modernDb.exec("select count(*) from sqlite_master where type='table' and name='"+table+"'")[0].values[0][0],1,
    'schema18 deve conter tabela normalizada '+table);
}
assert.equal(modernDb.exec('select count(*) from notetypes')[0].values[0][0],2);
assert.equal(modernDb.exec('select count(*) from decks')[0].values[0][0],2,'Default + Fiscal devem estar normalizados');
assert.ok(modernDb.exec('select length(config) from notetypes')[0].values.every(r=>r[0]>0),'note type config deve ser protobuf');
modernDb.close();

const modernMedia=context.fzstd.decompress(modernFiles.get('media'));
assert.ok(modernMedia.length>0,'manifesto moderno de mídia deve ser protobuf+Zstd');
assert.deepEqual(Array.from(context.fzstd.decompress(modernFiles.get('0'))),Array.from(files.get('0')),
  'mídia moderna deve descomprimir para os mesmos bytes do legado');

/* ── Toggles oficiais: sem agendamento/config/mídia ────────────────────── */
const clean=await X.buildPackage({legacy:false,withScheduling:false,withDeckConfigs:false,withMedia:false});
const cleanFiles=unzipStored(clean.bytes);
const cleanDb=new SQL.Database(context.fzstd.decompress(cleanFiles.get('collection.anki21b')));
assert.equal(cleanDb.exec('select count(*) from revlog')[0].values[0][0],0,'sem scheduling não deve exportar revlog');
const reset=cleanDb.exec('select type,queue,ivl,reps,lapses,flags from cards')[0].values;
assert.ok(reset.every(r=>r.every(v=>Number(v)===0)),'sem scheduling todos os cards devem sair como novos e sem estado');
assert.equal(cleanDb.exec('select count(*) from deck_config')[0].values[0][0],1,'sem deck configs só o preset Default deve viajar');
cleanDb.close();
assert.equal([...cleanFiles.keys()].filter(k=>/^\d+$/.test(k)).length,0,'withMedia=false não deve escrever blobs de mídia');
assert.equal(typeof X.buildCollectionPackage,'function','.colpkg deve reutilizar o mesmo contêiner oficial validado');

/* ── ExportLimit oficial: deck inclui descendentes e exclui outros ───── */
decks.push(
  {id:'d2',ankiId:1700000000102,nome:'Fiscal::Sub',createdAt:'2026-09-03T12:00:00.000Z',configId:'default'},
  {id:'d3',ankiId:1700000000103,nome:'Outra',createdAt:'2026-09-03T12:00:00.000Z',configId:'default'}
);
cards.push(
  {id:'c3',ankiId:1700000000203,ankiNoteId:1700000000303,ankiTemplateOrd:0,deckId:'d2',phase:'new',due:'2026-09-22',intervalo:0,reps:0,lapses:0,ease:2.5,posicaoNova:8,createdAt:'2026-09-03T12:00:00.000Z'},
  {id:'c4',ankiId:1700000000204,ankiNoteId:1700000000304,ankiTemplateOrd:0,deckId:'d3',phase:'new',due:'2026-09-22',intervalo:0,reps:0,lapses:0,ease:2.5,posicaoNova:9,createdAt:'2026-09-03T12:00:00.000Z'}
);
notes.set('1700000000303',{id:1700000000303,ankiId:1700000000303,notetypeId:1700000000401,guid:'g-sub',fields:{Front:'Sub',Back:'A'},tags:[]});
notes.set('1700000000304',{id:1700000000304,ankiId:1700000000304,notetypeId:1700000000401,guid:'g-other',fields:{Front:'Other',Back:'A'},tags:[]});
const limited=await X.buildPackage({legacy:true,limit:{deckId:'d1'}});
assert.equal(limited.cards,3,'deck ExportLimit deve incluir pai + subdeck e excluir outros decks');
const limFiles=unzipStored(limited.bytes),limDb=new SQL.Database(limFiles.get('collection.anki21'));
assert.equal(limDb.exec('select count(*) from cards')[0].values[0][0],3);
const limDecks=JSON.parse(limDb.exec('select decks from col where id=1')[0].values[0][0]);
assert.ok(Object.values(limDecks).some(d=>d.name==='Fiscal::Sub'),'subdeck precisa viajar com o pai');
assert.ok(!Object.values(limDecks).some(d=>d.name==='Outra'),'deck fora do ExportLimit não pode vazar');
limDb.close();

/* ── Collection Package: coleção inteira e scheduling/config sempre ────── */
const colpkg=await X.buildCollectionPackage({legacy:false,withScheduling:false,withDeckConfigs:false,withMedia:false,limit:{deckId:'d1'}});
assert.equal(colpkg.cards,4,'.colpkg sempre exporta a coleção inteira, ignorando ExportLimit');
assert.equal(colpkg.withScheduling,true,'.colpkg sempre inclui scheduling');
assert.equal(colpkg.withDeckConfigs,true,'.colpkg sempre inclui deck configs');
const cpFiles=unzipStored(colpkg.bytes),cpDb=new SQL.Database(context.fzstd.decompress(cpFiles.get('collection.anki21b')));
assert.equal(cpDb.exec('select count(*) from cards')[0].values[0][0],4);
assert.equal(cpDb.exec('select count(*) from revlog')[0].values[0][0],3,'revlog não pode ser removido de collection package');
assert.ok(cpDb.exec('select count(*) from deck_config')[0].values[0][0]>=1,'collection package precisa manter configs');
cpDb.close();

console.log('APKG/COLPKG/TEXTO ANKI: ExportLimit, coleção integral, Legacy2/schema11 + Latest/schema18, Zstd, mídia, opções e texto validados.');

