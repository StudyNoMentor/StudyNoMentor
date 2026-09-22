#!/usr/bin/env node
import assert from 'node:assert/strict';
import { criarAmbiente } from '../audit/cards-20260921-v2/harness.mjs';

let checks=0;
const eq=(a,b,m)=>{checks++;assert.deepEqual(a,b,m);};
const ok=(v,m)=>{checks++;assert.ok(v,m);};
const A=criarAmbiente().reset();
const {DB,CardsConfig,CardEngine,CardsScreen,AnkiParity,FSRS}=A;

// ── RNG oficial: rand_core seed_from_u64 + StdRng/ChaCha12 ────────────────
for(const [seed,a,b] of [
  [0n,0xCD2C6F7F,0xBB2A3FB2],
  [1n,0xD3301861,0xF9681A64],
  [1775264032847n,0xC1B92DED,0x1B785743],
  [0xFFFFFFFFFFFFFFFFn,0x2E3D5FB8,0x0FA79848],
]){
  const r=AnkiParity.rng(seed);
  eq(r.nextU32(),a,'StdRng primeiro u32 seed '+seed);
  eq(r.nextU32(),b,'StdRng segundo u32 seed '+seed);
}
eq(AnkiParity.randomRangeU32(AnkiParity.rng(0n),0,15),12,'Uniform<u32> Canon seed 0');
eq(AnkiParity.uniformF32(AnkiParity.rng(0n),0,1),0.8014591932296753,'Uniform<f32> seed 0');
eq(AnkiParity.uniformF32(AnkiParity.rng(12345n),0,10),5.326814651489258,'Uniform<f32> escala 10');
eq(AnkiParity.weightedIndex([1,1,1,1],999n),2,'WeightedIndex f32');
eq(AnkiParity.weightedIndex([0.001,0.001,1,0.001],42n),2,'WeightedIndex peso dominante');

// learning fuzz: range [0, 15) para um passo de 60s
const fuzzExpected=new Map([[0n,12],[1n,12],[1775264032847n,11],[0xFFFFFFFFFFFFFFFFn,2]]);
for(const [seed,off] of fuzzExpected){
  const card={ankiId:Number(seed<=BigInt(Number.MAX_SAFE_INTEGER)?seed:0n),id:Number(seed<=BigInt(Number.MAX_SAFE_INTEGER)?seed:0n),reps:0};
  if(seed===0xFFFFFFFFFFFFFFFFn){
    eq(AnkiParity.randomRangeU32(AnkiParity.rng(seed),0,15),off,'learning fuzz max-u64');
  }else{
    eq(AnkiParity.randomRangeU32(AnkiParity.rng(seed),0,15),off,'learning fuzz seed '+seed);
  }
}

// review fuzz: acima de 90d o Load Balancer cai no fuzz normal, não em round().
A.reset({loadBalance:true});
const cF={id:'f',ankiId:999,reps:0,deckId:null,phase:'review',due:A.hoje(),intervalo:100,s:100,d:5};
eq(FSRS.loadBalance(100,()=>0,36500,1,AnkiParity.fuzzSeed(cF),cF),
   FSRS.fuzzed(100,AnkiParity.fuzzSeed(cF),36500,1),
   'load balancing >90d deve cair no review fuzz');
eq(AnkiParity.loadBalance(10,36500,1,999n,cF),10,'load balancer: janela vazia + seed 999 escolhe centro');

// ── FNV-1a i64 usado pelo SQLite do Anki ─────────────────────────────────
const signed=AnkiParity.reviewTie({ankiId:123456789,ankiMod:1700000000});
ok(typeof signed==='bigint','fnvhash retorna BigInt');
ok(signed>=-(1n<<63n)&&signed<(1n<<63n),'fnvhash segue ordem signed i64 do SQLite');

// ── Cloze oficial: ordinais, múltiplos, hints e aninhamento ───────────────
const strip=s=>String(s).replace(/<[^>]+>/g,'');
eq(Array.from(AnkiParity.clozeOrdinals('test')),[],'sem cloze');
eq(Array.from(AnkiParity.clozeOrdinals('{{c2::te}}{{c1::s}}t{{')),[1,2],'ordinais fora de ordem');
eq(Array.from(AnkiParity.clozeOrdinals('{{c0::te}}s{{c2::t}}s')),[2],'c0 não gera card');
eq(Array.from(AnkiParity.clozeOrdinals('{{c1,1,2::test}}')),[1,2],'ordinais múltiplos deduplicados');
eq(strip(AnkiParity.revealCloze('{{c1,2::shared}} word and {{c1::first}} vs {{c2::second}}',1,true)),
   '[...] word and [...] vs second','cloze múltiplo card 1 pergunta');
eq(strip(AnkiParity.revealCloze('{{c1,2::shared}} word and {{c1::first}} vs {{c2::second}}',2,true)),
   '[...] word and first vs [...]','cloze múltiplo card 2 pergunta');
eq(strip(AnkiParity.revealCloze('foo {{c1::bar::baz}}',1,true)),'foo [baz]','hint no cloze');
eq(strip(AnkiParity.revealCloze('foo {{c1::bar {{c2::baz}}::qux}}',2,true)),'foo bar [...]','cloze aninhado filho');
eq(strip(AnkiParity.revealCloze('foo {{c1::bar {{c2::baz}}::qux}}',1,true)),'foo [qux]','cloze aninhado pai');
eq(AnkiParity.clozeOnly('{{c1::foo}} {{c1::bar}}',1,false),'foo, bar','cloze only');
eq(AnkiParity.clozeOnly('foo {{c1::bar::baz}}',1,true),'baz','cloze only hint');

// Uma nota Cloze gera um card por ordinal, com agendamento independente.
A.reset();
const base=DB.addCard({kind:'cloze',frente:'A {{c1::um}} B {{c2::dois}}',verso:'',deckId:null});
AnkiParity.ensureIdentities();
eq(AnkiParity.syncClozeSiblings(base.id),2,'dois ordinais geram dois cards');
let sib=DB.getCards().filter(c=>String(c.noteId||c.id)===String(base.noteId||base.id));
eq(sib.length,2,'nota Cloze tem dois irmãos');
eq(sib.map(c=>c.clozeOrd).sort((a,b)=>a-b),[1,2],'irmãos preservam ordinal');
ok(new Set(sib.map(c=>c.ankiNoteId)).size===1,'irmãos compartilham ankiNoteId');
const c2=sib.find(c=>c.clozeOrd===2);
DB.updateCard(c2.id,{phase:'review',s:50,d:4,intervalo:50,reps:9});
DB.updateCardNote(base.id,{kind:'cloze',frente:'A {{c1::um}}',verso:'',deckId:null,materia:null,assunto:'',materiaTec:'',banca:''});
AnkiParity.syncClozeSiblings(base.id);
eq(DB.getCards().filter(c=>String(c.noteId||c.id)===String(base.noteId||base.id)).length,1,'remover ordinal remove card órfão');
eq(DB.getRevlog().filter(r=>String(r.cardId)===String(c2.id)).length,0,'card Cloze removido não deixa revlog órfão');

// ── Sibling bury/suspend ─────────────────────────────────────────────────
A.reset({buryNew:true,buryReviews:true,buryInterdayLearning:true});
const note='n';
const s1=DB.addCard({noteId:note,template:'forward',kind:'basic',frente:'Q',verso:'A'});
const s2=DB.addCard({noteId:note,template:'reverse',kind:'basic',frente:'A',verso:'Q'});
const buried=AnkiParity.autoBurySiblings(s1);
eq(Array.from(buried),[s2.id],'responder enterra irmão elegível');
ok(CardEngine.estaEnterrado(DB.getCard(s2.id)),'irmão enterrado sai da fila');
AnkiParity.suspendCard(s2.id);
ok(DB.getCard(s2.id).suspenso,'suspender ativa suspensão');
ok(!DB.getCard(s2.id).enterradoAte,'suspender remove bury como no Anki');

// ── Identidade Anki paralela e presets compartilhados ────────────────────
A.reset();
DB.saveDecks([{id:'d1',nome:'Fiscal::Tributário',createdAt:new Date().toISOString()},{id:'d2',nome:'Fiscal::Contabilidade',createdAt:new Date().toISOString()}]);
const x=DB.addCard({deckId:'d1',frente:'x',verso:'y'});
AnkiParity.ensureIdentities();
ok(Number.isSafeInteger(DB.getCard(x.id).ankiId),'card recebe ankiId numérico');
ok(Number.isSafeInteger(DB.getCard(x.id).ankiNoteId),'nota recebe ankiNoteId numérico');
const pid=AnkiParity.createPreset('Fiscal',{retention:.93,newPerDay:11,revPerDay:111});
AnkiParity.assignPreset('d1',pid);AnkiParity.assignPreset('d2',pid);
eq(CardsConfig.forDeck('d1').retention,.93,'preset compartilhado deck 1');
eq(CardsConfig.forDeck('d2').newPerDay,11,'preset compartilhado deck 2');
eq(AnkiParity.deckAncestors('d1').map(d=>d.nome),[],'pai ausente não é inventado');
DB.saveDecks([{id:'p',nome:'Fiscal',createdAt:new Date().toISOString()},...DB.getDecks()]);
eq(AnkiParity.deckAncestors('d1').map(d=>d.nome),['Fiscal'],'hierarquia :: encontra pai real');

console.log('PARIDADE TOTAL ANKI: '+checks+'/'+checks+' contratos de RNG/Cloze/LB/irmãos/presets válidos.');
