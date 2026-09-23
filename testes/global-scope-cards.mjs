#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const mem=new Map();
const ls={
  getItem:k=>mem.has(k)?mem.get(k):null,
  setItem:(k,v)=>mem.set(k,String(v)),
  removeItem:k=>mem.delete(k),
  get length(){return mem.size;},
  key:i=>[...mem.keys()][i]??null
};
const active='A';
const pfx='u:';
const keyFor=(pid,s)=>pfx+'p:'+pid+':'+s;
const keysForPlan=pid=>({
  cards:keyFor(pid,'cards'),decks:keyFor(pid,'decks'),bancasCards:keyFor(pid,'bancas-cards'),
  revlog:keyFor(pid,'revlog'),revlogPendente:keyFor(pid,'revlog-pendente'),revlogArquivo:keyFor(pid,'revlog-arquivo'),
  extras:keyFor(pid,'extras'),leis:keyFor(pid,'leis'),links:keyFor(pid,'links'),tec:keyFor(pid,'tec'),incidencia:keyFor(pid,'incidencia')
});
const put=(k,v)=>ls.setItem(k,JSON.stringify(v));
put(keysForPlan('A').cards,[{id:'a1',deckId:'da',banca:'FGV',frente:'A',verso:'1'}]);
put(keysForPlan('B').cards,[{id:'b1',deckId:'db',banca:'CEBRASPE',frente:'B',verso:'2'}]);
put(keysForPlan('A').decks,[{id:'da',nome:'Deck A'}]);
put(keysForPlan('B').decks,[{id:'db',nome:'Deck B'}]);
put(keysForPlan('A').revlog,[]);
put(keysForPlan('B').revlog,[]);
put(keysForPlan('A').bancasCards,['FGV']);
put(keysForPlan('B').bancasCards,['CEBRASPE']);

let seq=0;
const parse=(k,d)=>{try{const x=ls.getItem(k);return x==null?d:JSON.parse(x);}catch{return d;}};
const DB={
  DEFAULT_BANCAS_CARDS:['FCC'],
  _profilePrefix:()=>pfx,_activePlanId:()=>active,keysForPlan,
  _get:parse,_set:(k,v)=>{put(k,v);return true;},setRaw:(k,v)=>{ls.setItem(k,String(v));return true;},delRaw:k=>{ls.removeItem(k);return true;},
  _uid:()=>String(++seq),_revlogMem:new Map(),_bancoRelacionalPronto:()=>false,
  _semTransitorios:x=>Object.assign({},x||{}),
  _normalizarReviewId:(r,novo)=>{if(!r.reviewId)r.reviewId='rv_'+(++seq);return r;},
  _chaveRevisao:r=>String(r.reviewId||r.ts||''),
  _reviewContext:key=>({profileId:'p1',planId:(key.match(/p:([^:]+):/)||[])[1]||active}),
  getCards(){return parse(keysForPlan(active).cards,[])},
  saveCards(v){return this._set(keysForPlan(active).cards,v)},
  getCard(id){return this.getCards().find(x=>String(x.id)===String(id))||null},
  updateCard(id,patch){const l=this.getCards(),x=l.find(c=>c.id===id);if(!x)return null;Object.assign(x,patch);this.saveCards(l);return x},
  updateCardNote(id,data){return this.updateCard(id,data)},
  deleteCard(id){this.saveCards(this.getCards().filter(x=>x.id!==id))},
  deleteNoteByCard(id){this.deleteCard(id);return 1},
  getRevlog(){return parse(keysForPlan(active).revlog,[])},
  addRevlogDurable:async r=>r,cancelarRevlogDurable:async()=>true,removeRevlog:()=>true,
  getCardBancas(){return parse(keysForPlan(active).bancasCards,[])},saveCardBancas(v){return this._set(keysForPlan(active).bancasCards,v)}
};
const journal=[];
const document={readyState:'loading',addEventListener:()=>{},getElementById:()=>null,querySelectorAll:()=>[],head:{appendChild:()=>{}},createElement:()=>({})};
const ctx={
  console,DB,localStorage:ls,document,
  PlanManager:{getActivePlanId:()=>active,getPlans:()=>[{id:'A',nome:'Plano A'},{id:'B',nome:'Plano B'}]},
  ReviewJournal:{put:async op=>{journal.push(op);return true;},remove:async()=>true},
  CardsConfig:{forgetCardId:()=>{},forDeck:()=>({buryNew:false,buryReviews:false,buryInterdayLearning:false})},
  CardEngine:{isDue:()=>true},_sanCard:x=>String(x??''),escapeHtml:x=>String(x??''),showToast:()=>{},_quiet:()=>{},
  setTimeout:()=>{},CustomEvent:class{}
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/js/94-global-scope.js','utf8'),ctx);

const S=ctx.StudyGlobalScope;
assert.ok(S,'camada global deve ser instalada');
assert.equal(S.cardsScope(),'all','Cards nasce global por padrão');
assert.deepEqual(Array.from(S.cards(),x=>x.id),['a1','b1']);
S.setCardsScope('plan');
assert.deepEqual(Array.from(S.cards(),x=>x.id),['a1']);
S.setCardsScope('all');

const banks=S.bankCatalog();
assert.ok(banks.includes('FGV')&&banks.includes('CEBRASPE')&&banks.includes('FCC'),'catálogo de bancas deve unir planejamentos');
S.setSelectedBanks(['CEBRASPE']);
assert.deepEqual(Array.from(S.filterCardsByBanca(S.cards()),x=>x.id),['b1'],'filtro de banca deve restringir a coleção global');

const b=ctx.DB.getCard('b1');
assert.equal(b._planId,'B','card de outro planejamento precisa manter origem');
ctx.DB.updateCard('b1',{favorito:true});
assert.equal(parse(keysForPlan('B').cards,[])[0].favorito,true,'edição deve voltar ao plano de origem');
assert.equal(parse(keysForPlan('A').cards,[])[0].favorito,undefined,'edição global não pode vazar ao plano ativo');

await ctx.DB.addRevlogDurable({ts:1,date:'2026-09-23',cardId:'b1',grade:3},{id:'b1',favorito:true},1);
assert.equal(S.revlogForPlan('B').length,1,'revisão global deve ficar ligada ao card de origem');
assert.equal(S.revlogForPlan('A').length,0,'revisão global não pode cair no planejamento ativo');
assert.equal(journal[0].planId,'B','journal durável deve carregar planId de origem');

ctx.DB.deleteCard('b1');
assert.equal(parse(keysForPlan('B').cards,[]).length,0,'exclusão deve ocorrer na origem');
assert.equal(parse(keysForPlan('A').cards,[]).length,1,'exclusão global não pode tocar outro plano');

console.log('OK: coleção global, filtro de banca e roteamento de mutações/revisões por origem.');
