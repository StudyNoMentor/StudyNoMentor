#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {criarAmbiente} from '../audit/cards-20260921-v2/harness.mjs';

const expectedPath=process.env.SNM_ANKI_SEARCH_EXPECTED;
assert.ok(expectedPath&&fs.existsSync(expectedPath),'SNM_ANKI_SEARCH_EXPECTED ausente');
const oracle=JSON.parse(fs.readFileSync(expectedPath,'utf8'));
const A=criarAmbiente().reset({newPerDay:999,revPerDay:999});
const {ctx,DB,AnkiParity,CardEngine}=A;
ctx.queueMicrotask=()=>{};
ctx.AnkiProductParity={browser:{mode:'notes',selected:new Set()},noteId:c=>String(c.noteId||c.id),plain:s=>String(s).replace(/<[^>]*>/g,''),esc:String};
ctx.window.AnkiProductParity=ctx.AnkiProductParity;
const src=fs.readFileSync(new URL('../src/js/44-anki-max-reviewer-browser.js',import.meta.url),'utf8');
vm.runInContext(src+'\n;globalThis.AnkiMaxParity=AnkiMaxParity;',ctx,{filename:'44-anki-max-reviewer-browser.js'});
ctx.AnkiMaxParity._patchSearch();

const alpha=DB.addDeck('Alpha'),child=DB.addDeck('Alpha::Child'),beta=DB.addDeck('Beta');
const basic=AnkiParity.stockNotetype('basic'),cloze=AnkiParity.stockNotetype('cloze');
const byMarker=new Map();
function addNote(marker,text,back,tags,deck,kind='basic'){
  const nt=kind==='cloze'?cloze:basic,id=AnkiParity._allocId(),fields=kind==='cloze'?{Text:marker+' '+text,'Back Extra':back}:{Front:marker+' '+text,Back:back};
  AnkiParity.saveNote({id,notetypeId:nt.id,fields,tags});
  const make=(ord,extra={})=>DB.addCard({noteId:id,ankiNoteId:id,notetypeId:nt.id,ankiTemplateOrd:ord,deckId:deck.id,kind:kind==='cloze'?'cloze':'basic',clozeOrd:kind==='cloze'?ord+1:null,frente:fields[kind==='cloze'?'Text':'Front'],verso:back,phase:'new',due:A.hoje(),...extra});
  const cards=kind==='cloze'?[make(0),make(1)]:[make(0)];byMarker.set(marker,cards);return cards;
}
addNote('A_PARIS','Paris capital France','Seine',['geo','lang::fr'],alpha);
addNote('B_UBER','Über café','accent',['lang::de'],child);
addNote('C_PLAIN','plain dog','animal',[],beta);
addNote('D_REGEX','alpha-123','omega',['code'],beta);
addNote('E_CLOZE','{{c1::mn}}{{c2::e}}monic','extra',['cloze'],child,'cloze');
addNote('F_TAG','nesting','tag',['parent::child'],alpha);
const [g]=addNote('G_REVIEW','scheduled review','review',['sched'],alpha);
const [h]=addNote('H_SUSP','suspended card','suspend',['state'],beta);
const [i]=addNote('I_BURIED','buried card','bury',['state'],beta);
const [j]=addNote('J_FLAG','flagged card','flag',['state'],alpha);
DB.updateCard(g.id,{phase:'review',intervalo:30,reps:5,lapses:2,ease:2.5,due:A.hoje(),lastReview:CardEngine.addDays(A.hoje(),-30)});
DB.updateCard(h.id,{suspenso:true});
DB.updateCard(i.id,{enterradoAte:CardEngine.addDays(A.hoje(),1),buryKind:'user'});
DB.updateCard(j.id,{flag:3});
AnkiParity.ensureIdentities();

function label(card){
  const note=AnkiParity.getNote(AnkiParity.noteId(card)),first=String(Object.values(note.fields||{})[0]||''),marker=first.split(' ',1)[0];
  return marker+'#'+(Number(card.ankiTemplateOrd)||0);
}
const cards=DB.getCards(),fail=[];
for(const row of oracle.queries){
  if(row.error)continue;
  const actual=cards.filter(c=>AnkiParity.filteredSearchMatches(c,row.query)).map(label).sort();
  try{assert.deepEqual(actual,row.labels,row.query);}catch(e){fail.push({query:row.query,expected:row.labels,actual});}
}
if(fail.length){
  console.error(JSON.stringify(fail.slice(0,30),null,2));
  assert.fail('Busca Study divergiu do Anki oficial em '+fail.length+' / '+oracle.queries.length+' consultas');
}
console.log('BUSCA DIFERENCIAL ANKI 26.09.2: '+oracle.queries.length+' consultas idênticas, 0 divergências.');
