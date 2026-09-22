#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const store=new Map();
const notes=[
  {id:'n1',notetypeId:'t1',fields:{Front:'  Alpha  ',Back:'x'},tags:[]},
  {id:'n2',notetypeId:'t1',fields:{Front:'alpha',Back:'y'},tags:[]},
  {id:'n3',notetypeId:'t1',fields:{Front:'Beta',Back:'z'},tags:[]}
];
const cards=[
  {id:'c1',noteId:'n1',deckId:'d1',phase:'review',due:'2026-09-22',s:10,d:4,intervalo:10,reps:3,lapses:0,createdAt:'2026-09-01'},
  {id:'c2',noteId:'n2',deckId:'d1',phase:'new',due:'2026-09-22',createdAt:'2026-09-02'}
];
const ctx={
  console,globalThis:null,queueMicrotask:()=>{},
  localStorage:{get length(){return store.size;},key:i=>[...store.keys()][i]||null,getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
  document:{getElementById:()=>null,querySelector:()=>null,addEventListener:()=>{}},
  window:{},
  DB:{
    getCards:()=>structuredClone(cards),getRevlog:()=>[],getDecks:()=>[{id:'d1',nome:'Deck'}],
    saveCards:()=>{},saveDecks:()=>{},replaceRevlog:()=>{},setRaw:(k,v)=>store.set(k,String(v)),
    _activePlanId:()=> 'plan1'
  },
  CardsConfig:{forDeck:()=>({retention:.9})},
  CardEngine:{estaEnterrado:()=>false,addDays:(d)=>d},
  AnkiParity:{
    _entityKey:(k,id)=>'p:'+k+':'+id,
    notes:()=>structuredClone(notes),
    noteTypes:()=>[{id:'t1',fields:[{name:'Front'},{name:'Back'}]}],
    noteId:c=>c.noteId,
    getNote:id=>notes.find(n=>n.id===id)||null
  },
  AnkiProductParity:{
    esc:String,
    plain:v=>String(v??'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim(),
    browser:{query:'deck:x',mode:'notes',tag:'',flag:'',suspended:'all',marked:false,sort:'sortField',sortDir:'asc',columns:null,selected:new Set()},
    _browserRows:()=>notes.map(n=>({note:n})),
    renderBrowser:()=>{}
  },
  AnkiMediaStore:{_u8:v=>v instanceof Uint8Array?v:new Uint8Array(v||[])},
  showToast:()=>{},
  UI:{prompt:()=>Promise.resolve(null)}
};
ctx.globalThis=ctx;ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-total-parity.js'),'utf8'),ctx,{filename:'44-anki-total-parity.js'});
const T=vm.runInContext('AnkiTotalParity',ctx);

assert.equal(T._normalizeDuplicate(' <b>  ÁLpha </b> '),'álpha');
const groups=new Map();
for(const n of notes){const k=T._normalizeDuplicate(n.fields.Front);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(n.id);}
assert.deepEqual(groups.get('alpha'),['n1','n2'],'detecção de duplicatas usa normalização semântica');

const base={due:'2026-09-22',dueTs:null,intervalo:10,_kind:'day',_val:10,status:'sei',s:20};
const safe=T._validateSchedulePatch(base,{intervalo:12,_val:12,due:'2026-10-04',s:999,evil:true});
assert.equal(safe.intervalo,12);
assert.equal(safe._val,12);
assert.equal(safe.due,'2026-10-04');
assert.equal(safe.s,20,'custom scheduling não pode sobrescrever estado FSRS fora da allowlist');
assert.equal(safe.evil,undefined);
const invalid=T._validateSchedulePatch(base,{intervalo:NaN,due:'amanhã',dueTs:Infinity});
assert.equal(invalid.intervalo,10);
assert.equal(invalid.due,'2026-09-22');
assert.equal(invalid.dueTs,null);

const bytes=new Uint8Array([0,1,2,253,254,255]);
assert.deepEqual([...T._b64ToBytes(T._bytesToB64(bytes))],[...bytes],'mídia mantém bytes no round-trip base64');

const issues=T.deepIssues();
assert.deepEqual(issues.missingNotes,[]);
assert.deepEqual(issues.missingDeck,[]);
assert.equal(issues.orphanRevlog.length,0);
assert.equal(issues.invalidSchedule.length,0);

const state=T._browserState();
assert.equal(state.query,'deck:x');
assert.equal(state.mode,'notes');

console.log('PARIDADE TOTAL: Browser profundo, Custom Scheduling seguro, integridade e codec de media sync validados.');
