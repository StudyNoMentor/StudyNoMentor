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
  console,globalThis:null,queueMicrotask:()=>{},atob:globalThis.atob,btoa:globalThis.btoa,
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

const totalParitySource=readFileSync(join(ROOT,'src/js/44-anki-total-parity.js'),'utf8');
assert.ok(!/_installCustomScheduling/.test(totalParitySource),'Study não pode instalar hook sobre CardEngine.schedule');
assert.ok(!/CardEngine\.schedule\s*=/.test(totalParitySource),'Study não pode substituir o scheduler do Anki');
assert.ok(!/_runCustomScheduling/.test(totalParitySource),'não pode existir engine local de Custom Scheduling');
assert.ok(!/cards-custom-scheduling-btn/.test(totalParitySource),'Custom Scheduling local não pode ser exposto na UI');
assert.match(totalParitySource,/card_state_customizer oficial do Anki/,'arquivo deve documentar que Custom Scheduling pertence ao runtime oficial');

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


const menuSrc=readFileSync(join(ROOT,'src/js/46-sanitizacao-e-editor.js'),'utf8');
const menuCss=readFileSync(join(ROOT,'src/css/01-base.css'),'utf8');
assert.match(menuSrc,/menu\.addEventListener\('click'/,'menu Mais deve fechar por delegação para alcançar itens injetados depois');
assert.match(menuSrc,/btn\.setAttribute\('aria-expanded', 'false'\)/,'fechamento deve sincronizar aria-expanded');
assert.match(menuSrc,/ArrowDown/,'menu Mais deve permitir navegação por setas');
assert.match(menuSrc,/Home/,'menu Mais deve suportar Home/End');
assert.match(menuCss,/\.cards-more-menu[\s\S]*?overflow-y:\s*auto/,'menu Mais deve rolar dentro do viewport');

console.log('PARIDADE TOTAL: Browser profundo, ausência de Custom Scheduling local, integridade e codec de media sync validados.');
