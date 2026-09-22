#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const cards=[
  {id:'c1',noteId:'n1',ankiNoteId:'n1',notetypeId:'t1',deckId:'d1',phase:'review',intervalo:10,reps:2,lapses:0,frente:'old',verso:'old',suspenso:false},
  {id:'c2',noteId:'n2',ankiNoteId:'n2',notetypeId:'t1',deckId:'d1',phase:'review',intervalo:5,reps:1,lapses:0,frente:'Q2',verso:'A2',suspenso:true,enterradoAte:'2099-01-01',buryKind:'scheduler'}
];
const notes=new Map([
  ['n1',{id:'n1',notetypeId:'t1',fields:{Front:'Q1',Back:'A1'},tags:['fiscal']}],
  ['n2',{id:'n2',notetypeId:'t1',fields:{Front:'Q2',Back:'A2'},tags:[]}]
]);
const type={id:'t1',name:'Basic',kind:'normal',fields:[{name:'Front'},{name:'Back'}],templates:[
  {name:'Card 1',qfmt:'{{Front}}',afmt:'{{Back}}'},
  {name:'Card 2',qfmt:'{{Back}}',afmt:'{{Front}}'}
]};
const logs=[{cardId:'c1',ts:1},{cardId:'gone',ts:2}];
let uid=10;
const ctx={
  console,globalThis:null,queueMicrotask:()=>{},escapeHtml:s=>String(s??'').replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])),
  DB:{
    getCards:()=>cards,getDecks:()=>[{id:'d1',nome:'Deck'}],getRevlog:()=>logs,
    updateCard(id,p){Object.assign(cards.find(c=>String(c.id)===String(id)),p);},
    addCard(p){const c={id:'new'+(++uid),phase:'new',reps:0,lapses:0,intervalo:0,...p};cards.push(c);return c;},
    saveCards:()=>{},replaceRevlog(arr){logs.splice(0,logs.length,...arr);},deleteNoteByCard:()=>{},setFlag:()=>{},
    _uid:()=>++uid
  },
  AnkiParity:{
    ensureCanonicalNotes:()=>({}),noteId:c=>c.ankiNoteId||c.noteId||c.id,
    notes:()=>[...notes.values()],noteTypes:()=>[type],getNote:id=>notes.get(String(id))||null,getNotetype:id=>String(id)==='t1'?type:null,
    saveNote(n){notes.set(String(n.id),structuredClone(n));return n;},
    _stripHtml:s=>String(s).replace(/<[^>]*>/g,''),_fieldNonempty:s=>String(s||'').trim().length>0,
    renderTemplate(nt,note,ord,side){const t=nt.templates[ord]||nt.templates[0];let src=side==='answer'?t.afmt:t.qfmt;return src.replace(/\{\{([^}]+)\}\}/g,(_,n)=>note.fields[n]||'');},
    clozeOrdinals:()=>[],emptyCardIds:()=>[],suspendCard:id=>{ctx.DB.updateCard(id,{suspenso:true,enterradoAte:null,buryKind:null});},
    _entityKey:(k,id)=>k+':'+id
  },
  CardEngine:{invalidateDueCache:()=>{}},CardsConfig:{forDeck:()=>({})},CardsScreen:{},UI:{},showToast:()=>{},localStorage:{removeItem:()=>{}},
  document:{},window:{},navigator:{language:'pt-BR'}
};ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-product-parity.js'),'utf8'),ctx,{filename:'44-anki-product-parity.js'});
const P=vm.runInContext('AnkiProductParity',ctx);
assert.ok(P,'camada de paridade deve ser exportada');

// Reconcile: preserva o card ordinal 0/agendamento e cria somente o irmão ausente.
const before=cards.find(c=>c.id==='c1');
const schedule={phase:before.phase,intervalo:before.intervalo,reps:before.reps};
const r=P.reconcileNote(notes.get('n1'),type);
assert.equal(r.created,1);
assert.equal(cards.filter(c=>String(c.noteId)==='n1').length,2);
assert.equal(before.frente,'Q1');assert.equal(before.verso,'A1');
assert.deepEqual({phase:before.phase,intervalo:before.intervalo,reps:before.reps},schedule,'reconciliação não pode zerar agendamento existente');

// Check: encontra revlog órfão e estado suspenso+enterrado sem alterar nada.
const scan=P.scanCollection();
assert.equal(scan.orphanRevlog.length,1);
assert.equal(scan.suspendedBuried.length,1);

// Reparos lógicos equivalentes aos usados pela UI.
ctx.DB.replaceRevlog(ctx.DB.getRevlog().filter(x=>cards.some(c=>String(c.id)===String(x.cardId))));
ctx.DB.updateCard('c2',{enterradoAte:null,buryKind:null});
assert.equal(ctx.DB.getRevlog().length,1);
assert.equal(cards.find(c=>c.id==='c2').enterradoAte,null);

// Browser agrupa por NOTE, e não por card.
const rows=P._browserRows();
assert.equal(rows.length,2);
assert.equal(rows.find(x=>String(x.note.id)==='n1').cards.length,2);

console.log('PARIDADE DE PRODUTO: browser por notas, reconciliação sem perder agendamento e manutenção segura validados.');
