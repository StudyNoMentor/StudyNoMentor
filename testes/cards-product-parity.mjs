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
    deleteCard(id){const i=cards.findIndex(c=>String(c.id)===String(id));if(i>=0)cards.splice(i,1);},
    saveCards:()=>{},replaceRevlog(arr){logs.splice(0,logs.length,...arr);},deleteNoteByCard:()=>{},setFlag:()=>{},
    _uid:()=>++uid
  },
  AnkiParity:{
    ensureCanonicalNotes:()=>({}),noteId:c=>c.ankiNoteId||c.noteId||c.id,
    notes:()=>[...notes.values()],noteTypes:()=>[type],getNote:id=>notes.get(String(id))||null,getNotetype:id=>String(id)==='t1'?type:null,
    saveNote(n){notes.set(String(n.id),structuredClone(n));return n;},
    _stripHtml:s=>String(s).replace(/<[^>]*>/g,''),_fieldNonempty:s=>String(s||'').trim().length>0,
    renderTemplate(nt,note,ord,side){const t=nt.templates[nt.kind==='cloze'?0:ord]||nt.templates[0];let src=side==='answer'?t.afmt:t.qfmt;return src.replace(/\{\{(?:cloze:)?([^}]+)\}\}/g,(_,n)=>note.fields[n]||'');},
    clozeOrdinals:text=>[...String(text||'').matchAll(/\{\{c(\d+)(?:,\d+)*::/g)].map(m=>Number(m[1])).filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b),
    emptyCardIds:()=>[],suspendCard:id=>{ctx.DB.updateCard(id,{suspenso:true,enterradoAte:null,buryKind:null});},
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

// Mudar tipo: mesma semântica do Anki 26.09.3 (notetypechange.rs).
// O mapeamento padrão casa nomes antes de consumir os campos restantes.
assert.deepEqual(Array.from(P._defaultIndexMap(
  [{name:'Front'},{name:'Back'},{name:'Text'}],
  [{name:'Text'},{name:'Back Extra'}]
)),[2,0],'mapa padrão deve casar nome exato e só depois usar o primeiro campo antigo livre');

// Basic -> Basic (and reversed): o card existente pode ser remapeado para o
// segundo template e deve manter o próprio agendamento; o forward nasce novo.
const basic={id:'tb',name:'Basic',kind:'normal',fields:[{name:'Front'},{name:'Back'}],templates:[
  {name:'Card 1',qfmt:'{{Front}}',afmt:'{{Back}}'}
]};
const reversed={id:'tr',name:'Basic (and reversed card)',kind:'normal',fields:[{name:'Front'},{name:'Back'}],templates:[
  {name:'Card 1',qfmt:'{{Front}}',afmt:'{{Back}}'},
  {name:'Card 2',qfmt:'{{Back}}',afmt:'{{Front}}'}
]};
const single={id:'ts',name:'Single',kind:'normal',fields:[{name:'Front'},{name:'Back'}],templates:[
  {name:'Only',qfmt:'{{Front}}',afmt:'{{Back}}'}
]};
const cloze={id:'tc',name:'Cloze',kind:'cloze',fields:[{name:'Text'},{name:'Back Extra'}],templates:[
  {name:'Cloze',qfmt:'{{cloze:Text}}',afmt:'{{cloze:Text}}{{Back Extra}}'}
]};
notes.set('nx',{id:'nx',notetypeId:'tb',fields:{Front:'F',Back:'B'},tags:[]});
const keep={id:'cx',noteId:'nx',ankiNoteId:'nx',notetypeId:'tb',ankiTemplateOrd:0,deckId:'d1',phase:'review',intervalo:37,reps:9,lapses:1,frente:'F',verso:'B'};
cards.push(keep);
P._applyChangeNotetype(notes.get('nx'),basic,reversed,{Front:'F',Back:'B'},[null,0]);
let nx=cards.filter(c=>String(c.ankiNoteId||c.noteId) === 'nx');
assert.equal(nx.length,2,'Basic -> reversed deve gerar o template novo');
assert.equal(cards.find(c=>c.id==='cx').ankiTemplateOrd,1,'card existente deve ser remapeado para o template escolhido');
assert.deepEqual(
  {intervalo:cards.find(c=>c.id==='cx').intervalo,reps:cards.find(c=>c.id==='cx').reps,lapses:cards.find(c=>c.id==='cx').lapses},
  {intervalo:37,reps:9,lapses:1},
  'remapeamento de template não pode zerar o agendamento'
);

// Reversed -> tipo de um template, mapeando o antigo Card 2: Card 1 antigo é
// removido; Card 2 vira ordinal 0 e conserva seu histórico.
P._applyChangeNotetype(notes.get('nx'),reversed,single,{Front:'F',Back:'B'},[1]);
nx=cards.filter(c=>String(c.ankiNoteId||c.noteId) === 'nx');
assert.equal(nx.length,1,'template antigo não mapeado deve ser removido na mudança de tipo');
assert.equal(nx[0].id,'cx','o card mapeado deve sobreviver à mudança');
assert.equal(nx[0].ankiTemplateOrd,0,'template mapeado deve receber o novo ordinal');
assert.equal(nx[0].intervalo,37,'card sobrevivente deve preservar o agendamento');

// Normal -> Cloze: o Anki não remapeia templates e deixa os cards existentes
// no lugar, mesmo que a nota ainda não tenha uma omissão válida.
notes.set('ny',{id:'ny',notetypeId:'tr',fields:{Front:'texto sem cloze',Back:'extra'},tags:[]});
cards.push(
  {id:'cy0',noteId:'ny',ankiNoteId:'ny',notetypeId:'tr',ankiTemplateOrd:0,deckId:'d1',phase:'review',intervalo:8,reps:3,frente:'a',verso:'b'},
  {id:'cy1',noteId:'ny',ankiNoteId:'ny',notetypeId:'tr',ankiTemplateOrd:1,deckId:'d1',phase:'review',intervalo:13,reps:4,frente:'b',verso:'a'}
);
P._applyChangeNotetype(notes.get('ny'),reversed,cloze,{Text:'texto sem cloze','Back Extra':'extra'},null);
let ny=cards.filter(c=>String(c.ankiNoteId||c.noteId) === 'ny');
assert.equal(ny.length,2,'normal -> Cloze deve deixar os cards existentes, como o Anki');
assert.deepEqual(ny.map(c=>c.id).sort(),['cy0','cy1'],'normal -> Cloze não deve substituir IDs/agendamentos');

// Cloze -> normal de um template: ordinais acima dos templates disponíveis são
// removidos antes da regeneração.
P._applyChangeNotetype(notes.get('ny'),cloze,single,{Front:'texto',Back:'extra'},null);
ny=cards.filter(c=>String(c.ankiNoteId||c.noteId) === 'ny');
assert.equal(ny.length,1,'Cloze -> normal deve remover card acima do ordinal disponível');
assert.equal(ny[0].id,'cy0','primeiro ordinal deve conservar o card/agendamento');
assert.equal(ny[0].intervalo,8,'Cloze -> normal deve preservar o agendamento do card sobrevivente');

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

// "Marked" no Anki é propriedade da nota via tag; favoritos legados continuam aceitos.
notes.get('n2').tags=['marked'];
P.browser.marked=true;
const markedRows=P._browserRows();
assert.deepEqual(Array.from(markedRows,x=>String(x.note.id)),['n2']);
P.browser.marked=false;

console.log('PARIDADE DE PRODUTO: browser por notas, reconciliação sem perder agendamento e manutenção segura validados.');
