#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const cards=[
 {id:'c1',noteId:'n1',deckId:'d1',phase:'review',s:15,d:5,intervalo:10,due:'2026-09-22',lastReview:'2026-09-12',reps:4,lapses:0},
 {id:'c2',noteId:'n2',deckId:'d1',phase:'new',posicaoNova:1,reps:0,lapses:0},
 {id:'c3',noteId:'n3',deckId:'d1',phase:'review',s:30,d:6,intervalo:20,due:'2026-09-27',lastReview:'2026-09-07',reps:6,lapses:1}
];
const notes=[
 {id:'n1',notetypeId:'t1',fields:{Front:'<img src="data:image/png;base64,AQID">',Back:'[sound:used.mp3]'},tags:[]},
 {id:'n2',notetypeId:'t1',fields:{Front:'<img src="gone.png">',Back:'B'},tags:[]},
 {id:'n3',notetypeId:'t1',fields:{Front:'Q',Back:'A'},tags:[]}
];
const type={id:'t1',name:'Basic',kind:'normal',fields:[{name:'Front'},{name:'Back'}],templates:[{name:'Card 1',qfmt:'{{Front}}',afmt:'{{Back}}'}],css:''};
const rev=[
 {cardId:'c1',ts:new Date('2026-09-22T10:00:00Z').getTime(),date:'2026-09-22',grade:3,phase:'review',time:8000},
 {cardId:'c3',ts:new Date('2026-09-21T18:00:00Z').getTime(),date:'2026-09-21',grade:1,phase:'review',time:9000}
];
const hash=s=>{let h=2166136261;for(const ch of String(s))h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;};
const ctx={
 console,globalThis:null,queueMicrotask:()=>{},structuredClone,Map,Set,Uint8Array,ArrayBuffer,Date,Math,Promise,
 indexedDB:undefined,document:{getElementById:()=>null},window:{},
 todayCards:()=> '2026-09-22',
 DB:{getCards:()=>cards,getRevlog:()=>rev,getDecks:()=>[{id:'d1',nome:'Deck'}],getCard:id=>cards.find(c=>c.id===id),_profilePrefix:()=> 'p:',_activePlanId:()=> 'x'},
 AnkiProductParity:{noteId:c=>String(c.noteId||c.id),_typeFor:n=>type,renderCheck:()=>{}},
 AnkiParity:{notes:()=>notes,noteTypes:()=>[type],getNote:id=>notes.find(n=>String(n.id)===String(id)),getNotetype:()=>type},
 CardsScreen:{renderStats:()=>{}},
 CardsConfig:{get:()=>({retention:.9,newPerDay:20,revPerDay:200,maxInterval:36500,learnSteps:[1,10],relearnSteps:[10],weights:null}),weightsFor:()=>null},
 CardEngine:{
   addDays(iso,n){const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);},
   _daysBetween(a,b){return Math.max(0,Math.round((new Date(b+'T00:00:00Z')-new Date(a+'T00:00:00Z'))/86400000));},
   retrievabilityDe(c,day){return ctx.FSRS.R(this._daysBetween(c.lastReview||day,day),c.s||1);}
 },
 FSRS:{
   DEFAULT_W:Array(21).fill(1),pesosValidos:()=>false,_hash:hash,
   R(t,s){return Math.pow(1+0.234568*Math.max(0,t)/Math.max(.01,s),-1/0.2);},
   initS(g){return [0,1,2.5,5,8][g]||5;},initD(g){return Math.max(1,Math.min(10,7-g));},
   interval(s,r){return Math.max(1,Math.round(s*Math.max(.5,(1/r)-.05)));},
   nextS_forget(d,s){return Math.max(.1,s*.45);},nextS_recall(d,s,R,g){return s*(1+(.18+(g-3)*.04)*(1-R+.1));},
   nextD(d,g){return Math.max(1,Math.min(10,d+(3-g)*.1));}
 },
 AnkiExport:{
   _crc32(bytes){let h=0;for(const b of bytes)h=(Math.imul(h,33)+b)>>>0;return h;},
   _base64Bytes(s){return new Uint8Array(Buffer.from(String(s),'base64'));}
 }
};ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-max-stats-media.js'),'utf8'),ctx,{filename:'44-anki-max-stats-media.js'});
const Store=vm.runInContext('AnkiMediaStore',ctx),M=vm.runInContext('AnkiMaxStatsMedia',ctx);

await Store.put('used.mp3',new Uint8Array([9,8,7]),'audio/mpeg');
await Store.put('unused.bin',new Uint8Array([5,4,3]),'application/octet-stream');
let scan=await M.scanMedia();
assert.equal(scan.missing.length,1);
assert.equal(scan.missing[0].ref,'gone.png');
assert.equal(scan.unused.some(x=>x.name==='unused.bin'),true);
assert.equal(scan.noteMissing.has('n2'),true);

await Store.trash('unused.bin');
assert.equal((await Store.all(true)).filter(x=>x.trashedAt).length,1);
await Store.restoreAll();
assert.equal((await Store.all(true)).filter(x=>x.trashedAt).length,0);

const sim1=M.simulate(60,.9,{sample:100}),sim2=M.simulate(60,.9,{sample:100});
assert.equal(sim1.reviews.length,60);
assert.equal(sim1.news.length,60);
assert.deepEqual(JSON.parse(JSON.stringify(sim1.reviews)),JSON.parse(JSON.stringify(sim2.reviews)),'simulação deve ser determinística');
assert.ok(sim1.reviews.every(Number.isFinite));
assert.ok(sim1.time.every(x=>Number.isFinite(x)&&x>=0));

const opt=M.minimumRecommendedRetention(30);
assert.ok(opt.recommended>=.70&&opt.recommended<=.95);
assert.equal(opt.curve.length,26);

const structure=M.structuralIssues();
assert.equal(Array.isArray(structure.badOrd),true);
console.log('PARIDADE MÁXIMA STATS/MEDIA: inventário, lixeira, simulação determinística e retenção recomendada validados.');
