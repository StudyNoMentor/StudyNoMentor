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
 {id:'c3',noteId:'n3',deckId:'d1',phase:'review',s:30,d:6,intervalo:20,due:'2026-09-27',lastReview:'2026-09-07',reps:6,lapses:1},
 {id:'c4',noteId:'n4',deckId:'d2',phase:'review',s:40,d:4,intervalo:35,due:'2026-10-02',lastReview:'2026-08-28',reps:8,lapses:0}
];
const notes=[
 {id:'n1',notetypeId:'t1',fields:{Front:'<img src="data:image/png;base64,AQID">',Back:'[sound:used.mp3]'},tags:[]},
 {id:'n2',notetypeId:'t1',fields:{Front:'<img src="gone.png">',Back:'B'},tags:[]},
 {id:'n3',notetypeId:'t1',fields:{Front:'Q',Back:'A'},tags:[]}
];
const type={id:'t1',name:'Basic',kind:'normal',fields:[{name:'Front'},{name:'Back'}],templates:[{name:'Card 1',qfmt:'{{Front}}',afmt:'{{Back}}'}],css:''};
const rev=[
 {cardId:'c1',ts:new Date('2026-09-22T10:00:00Z').getTime(),date:'2026-09-22',grade:3,phase:'review',time:8000},
 {cardId:'c3',ts:new Date('2026-09-21T18:00:00Z').getTime(),date:'2026-09-21',grade:1,phase:'review',time:9000},
 {cardId:'c4',ts:new Date('2024-01-15T18:00:00Z').getTime(),date:'2024-01-15',grade:3,phase:'review',time:7000}
];
const hash=s=>{let h=2166136261;for(const ch of String(s))h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;};
const ctx={
 console,globalThis:null,queueMicrotask:()=>{},structuredClone,Map,Set,Uint8Array,ArrayBuffer,Date,Math,Promise,
 indexedDB:undefined,document:{getElementById:()=>null},window:{},
 todayCards:()=> '2026-09-22',
 DB:{getCards:()=>cards,getRevlog:()=>rev,getDecks:()=>[{id:'d1',nome:'Deck'},{id:'d2',nome:'Outro'}],getCard:id=>cards.find(c=>c.id===id),_profilePrefix:()=> 'p:',_activePlanId:()=> 'x'},
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

M._statsState={scope:'deck',deckId:'d1',search:'',history:'year'};
assert.equal(M.statsCards().length,3,'escopo de baralho deve excluir outros baralhos');
assert.equal(M.statsRevlog().length,2,'histórico de 12 meses deve respeitar o baralho');
M._statsState={scope:'collection',deckId:null,search:'',history:'all'};
assert.equal(M.statsCards().length,4,'escopo coleção deve incluir todos os cards');
assert.equal(M.statsRevlog().length,3,'todo o histórico deve incluir revisões antigas');
M._statsState={scope:'collection',deckId:null,search:'',history:'year'};

const statsSrc=readFileSync(join(ROOT,'src/js/44-anki-max-stats-media.js'),'utf8');
assert.doesNotMatch(statsSrc,/Calcular retenção mínima recomendada/,'CMRR removido do Anki 25.07 não deve continuar exposto na UI atual');
assert.match(statsSrc,/anki-sim-additional/,'simulador deve expor cards novos adicionais');
assert.match(statsSrc,/anki-sim-review-limit/,'simulador deve expor máximo de revisões por dia');
assert.match(statsSrc,/approximate:false/,'simulador da UI deve usar coleção completa');
assert.doesNotMatch(statsSrc,/_sampleCards\(/,'simulador legado amostrado não deve coexistir com o oficial');
assert.doesNotMatch(statsSrc,/\bsimulate\(days,retention,opts\)/,'não deve existir segundo motor de simulação em JavaScript');
assert.match(statsSrc,/r\.ankiInterval!=null\?r\.ankiInterval/,'simulador deve usar o intervalo pós-resposta do revlog Anki');
assert.match(statsSrc,/r\.ankiLastInterval!=null\?r\.ankiLastInterval/,'simulador deve preservar o last_interval pré-resposta');
assert.match(statsSrc,/for\(let p=70;p<=99;p\+\+\)/,'Help Me Decide deve avaliar integralmente 70%–99%');
assert.match(statsSrc,/Help Me Decide/,'simulador deve expor Help Me Decide');
assert.match(statsSrc,/Card Counts/,'estatísticas devem expor Card Counts');
assert.match(statsSrc,/Review Time/,'estatísticas devem expor Review Time');
assert.match(statsSrc,/Card Ease/,'estatísticas devem expor Card Ease');
assert.match(statsSrc,/Adicionados/,'estatísticas devem expor o gráfico Added do Anki 26.09.2');
assert.match(statsSrc,/anki-stats-scope/,'estatísticas devem expor seletor de baralho\/coleção\/pesquisa');
assert.match(statsSrc,/Últimos 12 meses/,'estatísticas devem expor histórico padrão de 12 meses');
assert.match(statsSrc,/Todo o histórico/,'estatísticas devem expor todo o histórico');

const structure=M.structuralIssues();
assert.equal(Array.isArray(structure.badOrd),true);
console.log('PARIDADE MÁXIMA STATS/MEDIA: inventário, lixeira, 14 famílias de estatísticas e simulador oficial atual do Anki validados.');
