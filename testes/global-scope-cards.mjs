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
  entries:keyFor(pid,'entries'),cycleHistory:keyFor(pid,'cycle-history'),
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
put(keysForPlan('A').entries,[{id:'eA',date:'2026-09-20',subject:'A',durationMin:30}]);
put(keysForPlan('B').entries,[{id:'eB',date:'2026-09-21',subject:'B',durationMin:45}]);
put(keysForPlan('A').leis,[{id:'lA',titulo:'Lei A',updatedAt:'2026-09-20'}]);
put(keysForPlan('B').leis,[{id:'lB',titulo:'Lei B',updatedAt:'2026-09-21'}]);
put(keysForPlan('A').links,[{id:'kA',nome:'Link A',url:'https://a.test'}]);
put(keysForPlan('B').links,[{id:'kB',nome:'Link B',url:'https://b.test'}]);
put(keysForPlan('A').tec,[{id:1,startDate:'2026-08-01',endDate:'2026-08-31'}]);
put(keysForPlan('B').tec,[{id:2,startDate:'2026-09-01',endDate:'2026-09-30'}]);

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
  _mesmoId:(a,b)=>String(a)===String(b),
  getEntries(){return parse(keysForPlan(active).entries,[])},
  getEntry(id){return this.getEntries().find(x=>String(x.id)===String(id))||null},
  updateEntry(id,patch){const l=this.getEntries(),x=l.find(e=>String(e.id)===String(id));if(!x)return null;Object.assign(x,patch);this._set(keysForPlan(active).entries,l);return x},
  deleteEntry(id){return this._set(keysForPlan(active).entries,this.getEntries().filter(x=>String(x.id)!==String(id)))},
  getLeis(){return parse(keysForPlan(active).leis,[])},
  getLei(id){return this.getLeis().find(x=>String(x.id)===String(id))||null},
  updateLei(id,patch){const l=this.getLeis(),x=l.find(e=>String(e.id)===String(id));if(!x)return null;Object.assign(x,patch);this._set(keysForPlan(active).leis,l);return x},
  deleteLei(id){return this._set(keysForPlan(active).leis,this.getLeis().filter(x=>String(x.id)!==String(id)))},
  getLinks(){return parse(keysForPlan(active).links,[])},
  updateLink(id,patch){const l=this.getLinks(),x=l.find(e=>String(e.id)===String(id));if(!x)return null;Object.assign(x,patch);this._set(keysForPlan(active).links,l);return x},
  deleteLink(id){return this._set(keysForPlan(active).links,this.getLinks().filter(x=>String(x.id)!==String(id)))},
  urlSegura:u=>String(u||''),
  deleteTecSnapshot(id){return this._set(keysForPlan(active).tec,parse(keysForPlan(active).tec,[]).filter(x=>String(x.id)!==String(id)))},
  updateTecSnapshot(id,patch){const l=parse(keysForPlan(active).tec,[]),x=l.find(e=>String(e.id)===String(id));if(!x)return null;Object.assign(x,patch);this._set(keysForPlan(active).tec,l);return x},
  tecOverlap(start,end,ignoreId=null){return parse(keysForPlan(active).tec,[]).find(s=>String(s.id)!==String(ignoreId)&&start<=s.endDate&&end>=s.startDate)||null},
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
  setTimeout:()=>{},CustomEvent:class{},addEventListener:()=>{}
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

// Anki Oficial: a mesma seleção de banca vira um baralho filtrado oficial,
// preservando o baralho anterior e restaurando-o quando o filtro é limpo.
const ankiCalls=[];
ctx.AnkiOfficial={
  view:'review',token:()=> 'token',
  request:async (path,opts={})=>{
    const body=opts.body?JSON.parse(opts.body):null;
    ankiCalls.push({path,method:opts.method||'GET',body});
    if(path==='/api/anki/decks') return {current_deck_id: ankiCalls.some(x=>x.path==='/api/anki/decks/select')?99:42};
    if(path==='/api/anki/filtered-deck/0') return {deck:{id:99,name:'',config:{reschedule:true,search_terms:[]}}};
    if(path==='/api/anki/filtered-deck/99'&&opts.method==='PUT') return {ok:true,deck_id:99};
    return {ok:true};
  },
  renderReviewer:async()=>true,
  alert:()=>{}
};
await S.applyAnkiBankFilter(false);
const putFilter=ankiCalls.find(x=>x.path==='/api/anki/filtered-deck/99'&&x.method==='PUT');
assert.ok(putFilter,'filtro de banca deve configurar baralho filtrado oficial');
assert.match(putFilter.body.config.search_terms[0].search,/tag:"CEBRASPE"/,'query oficial deve conter a banca selecionada');
assert.ok(ankiCalls.some(x=>x.path==='/api/anki/filtered-deck/99/rebuild'),'baralho filtrado deve ser reconstruído');
assert.ok(ankiCalls.some(x=>x.path==='/api/anki/decks/select'&&x.body.deck_id===99),'baralho de banca deve virar o selecionado');

S.setSelectedBanks([]);
ankiCalls.length=0;
ctx.AnkiOfficial.request=async (path,opts={})=>{
  const body=opts.body?JSON.parse(opts.body):null;
  ankiCalls.push({path,method:opts.method||'GET',body});
  if(path==='/api/anki/decks') return {current_deck_id:99};
  return {ok:true};
};
await S.applyAnkiBankFilter(false);
assert.ok(ankiCalls.some(x=>x.path==='/api/anki/filtered-deck/99/empty'),'limpar banca deve esvaziar o baralho filtrado');
assert.ok(ankiCalls.some(x=>x.path==='/api/anki/decks/select'&&x.body.deck_id===42),'limpar banca deve restaurar o baralho anterior');

assert.deepEqual(Array.from(S.allBy('entries'),x=>x.id),['eA','eB'],'registros realizados devem ser legíveis no perfil inteiro');
assert.equal(ctx.DB.getEntry('eB')._planId,'B','registro antigo deve preservar a origem');
ctx.DB.updateEntry('eB',{durationMin:50});
assert.equal(parse(keysForPlan('B').entries,[])[0].durationMin,50,'edição de registro global deve voltar à origem');
assert.equal(parse(keysForPlan('A').entries,[])[0].durationMin,30,'edição de registro global não pode vazar ao plano ativo');

assert.deepEqual(Array.from(ctx.DB.getAllLeisTagged(),x=>x.id),['lA','lB'],'leis devem ser globais no perfil');
assert.equal(ctx.DB.getLei('lB')._planId,'B','lei de outro plano deve ser encontrada');
ctx.DB.updateLei('lB',{titulo:'Lei B editada'});
assert.equal(parse(keysForPlan('B').leis,[])[0].titulo,'Lei B editada','edição de lei deve voltar à origem');

assert.deepEqual(Array.from(ctx.DB.getAllLinksTagged(),x=>x.id),['kA','kB'],'links devem ser globais no perfil');
ctx.DB.updateLink('kB',{nome:'Link B editado'});
assert.equal(parse(keysForPlan('B').links,[])[0].nome,'Link B editado','edição de link deve voltar à origem');

assert.deepEqual(Array.from(ctx.DB.getAllTecSnapshotsTagged(),x=>x.id),[1,2],'histórico TEC deve ser global');
ctx.DB.updateTecSnapshot(2,{label:'Setembro'});
assert.equal(parse(keysForPlan('B').tec,[])[0].label,'Setembro','edição de retrato TEC deve voltar à origem');
assert.equal(ctx.DB.tecOverlap('2026-09-15','2026-09-20').id,2,'sobreposição TEC deve considerar outros planejamentos');

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

console.log('OK: memória global do perfil, banca e roteamento de mutações/revisões por origem.');
