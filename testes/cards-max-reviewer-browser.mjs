#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const note={id:'n1',notetypeId:'t1',fields:{Front:'A {{c1::capital}} de França é Paris',Extra:'Über'},tags:['geo']};
const card={id:'c1',noteId:'n1',deckId:'d1',phase:'review',buryKind:'scheduler',enterradoAte:'2099-01-01',flag:5,customData:{d:7,v:'reschedule'}};
const ctx={
  console,globalThis:null,queueMicrotask:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}},
  AnkiProductParity:{browser:{mode:'notes',selected:new Set()},noteId:c=>String(c.noteId||c.id),_cardsForNote:()=>[card],plain:s=>String(s).replace(/<[^>]*>/g,''),esc:String},
  CardsScreen:{},DB:{getCards:()=>[card],getCard:id=>String(id)==='c1'?card:null,getDecks:()=>[{id:'d1',nome:'Deck'}],FLAGS:[null,{},{},{},{},{nome:'Rosa'}]},
  CardEngine:{estaEnterrado:c=>!!c.enterradoAte},CardsConfig:{},
  AnkiParity:{
    noteId:c=>String(c.noteId||c.id),getNote:id=>String(id)==='n1'?note:null,getNotetype:id=>String(id)==='t1'?{id:'t1',fields:[{name:'Front'},{name:'Extra'}]}:null,
    _stripOuterParens:s=>String(s).trim(),_noteTagsForCard:()=>note.tags,
    _filteredTermMatches:()=>false,
    filteredSearchMatches(card,expr){return this._filteredTermMatches(card,expr);},
    _entityKey:(k,id)=>k+':'+id
  },
  document:{},window:{},navigator:{}
};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-max-reviewer-browser.js'),'utf8'),ctx,{filename:'44-anki-max-reviewer-browser.js'});
const M=vm.runInContext('AnkiMaxParity',ctx);

assert.equal(M._wildMatch('dog','d_g',false),true);
assert.equal(M._wildMatch('dung','d*g',false),true);
assert.equal(M._wildMatch('a dog','dog',true),false,'campo sem wildcard é exato');
assert.equal(M._noCombining('Über'),'Uber');
assert.equal(M._stripClozes('A {{c1::capital}} de {{c2::França}}'),'A capital de França');

M._patchSearch();
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'w:capital'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'w:cap'),false);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'nc:uber'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'sc:capital*França'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'front:*capital*'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'front:capital'),false);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'fr*:*Paris'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'tag:none'),false);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'tag:geo'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'is:buried-sibling'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'has-cd:d'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'prop:cdn:d>5'),true);
assert.equal(ctx.AnkiParity.filteredSearchMatches(card,'prop:cds:v=resched*'),true);

const sel=M._resolveSelection(['c:c1']);
assert.equal(sel.cards.length,1);assert.deepEqual(Array.from(sel.noteIds),['n1']);

console.log('PARIDADE MÁXIMA REVIEWER/BROWSER: busca Anki, wildcards, nc/sc, custom-data e seleção Cards/Notas validados.');
