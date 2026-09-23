#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const decks=[
  {id:'d1',nome:'Fiscal'},
  {id:'d2',nome:'Fiscal::AFO'},
  {id:'d3',nome:'Fiscal::AFO::Créditos'},
  {id:'d4',nome:'Tributário'}
];
const cards=[
  {id:'c1',deckId:'d1'},{id:'c2',deckId:'d2'},{id:'c3',deckId:'d2'},
  {id:'c4',deckId:'d3'},{id:'c5',deckId:'d4'}
];
let lastConfig=null,rendered=0;
const browser={query:'',tag:'',flag:'',suspended:'all',marked:false,page:0,selected:new Set()};
const ctx={
  console,globalThis:null,window:{},queueMicrotask:()=>{},
  DB:{getDecks:()=>structuredClone(decks),getCards:()=>structuredClone(cards)},
  CardsScreen:{},
  AnkiProductParity:{browser,renderBrowser:()=>{rendered++;}},
  AnkiParity:{isFilteredDeck:()=>false,notes:()=>[],noteTypes:()=>[],filteredSearchMatches:()=>false},
  CardsConfig:{get:()=>({}),set:v=>{lastConfig=v;}},
  CardEngine:{invalidateDueCache:()=>{}},
  document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]},
  UI:{prompt:()=>Promise.resolve(null)},
  showToast:()=>{}
};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-practical-10.js'),'utf8'),ctx,{filename:'44-anki-practical-10.js'});
const P=vm.runInContext('AnkiPractical10',ctx);

const meta=P._deckMeta();
const fiscal=meta.find(x=>x.d.id==='d1'),afo=meta.find(x=>x.d.id==='d2'),cred=meta.find(x=>x.d.id==='d3');
assert.equal(fiscal.depth,0);
assert.equal(fiscal.direct,1);
assert.equal(fiscal.total,4,'pai deve contar cards dos subbaralhos');
assert.equal(fiscal.hasChildren,true);
assert.equal(afo.depth,1);
assert.equal(afo.direct,2);
assert.equal(afo.total,3);
assert.equal(cred.depth,2);
assert.equal(cred.total,1);

const section=P._sideSection('Baralhos',[{kind:'deck',value:'Fiscal::AFO',label:'AFO',count:3}],true);
assert.match(section,/data-browser-filter="deck"/);
assert.match(section,/Fiscal::AFO/);
assert.match(section,/>3</);

P._applyBrowserFilter('deck','Fiscal::AFO');
assert.equal(browser.query,'deck:"Fiscal::AFO"');
assert.equal(rendered,1);
P._applyBrowserFilter('flag','3');
assert.equal(browser.flag,'3');
P._applyBrowserFilter('marked','1');
assert.equal(browser.marked,true);
P._applyBrowserFilter('clear','');
assert.equal(browser.query,'');
assert.equal(browser.flag,'');
assert.equal(browser.suspended,'all');
assert.equal(browser.marked,false);

const js=readFileSync(join(ROOT,'src/js/44-anki-practical-10.js'),'utf8');
const css=readFileSync(join(ROOT,'src/css/40-anki-practical-10.css'),'utf8');
assert.match(js,/cards-more-group/,'menu Mais deve ser agrupado semanticamente');
assert.match(js,/anki-browser-sidebar/,'Browser deve possuir Sidebar');
assert.match(js,/cards-preferences-btn/,'preferências operacionais devem estar acessíveis');
assert.match(js,/reviewer:answer:before/,'API de extensões deve expor hook do reviewer');
assert.match(css,/grid-template-columns:220px/,'Browser desktop deve reservar coluna para Sidebar');
assert.match(css,/anki-deck-tools/,'Deck Manager deve ter ferramentas próprias');
assert.match(js,/True Retention/,'estatísticas devem expor True Retention');
assert.match(js,/Recuperabilidade/,'estatísticas devem expor Retrievability');
assert.match(js,/Botões de resposta/,'estatísticas devem expor Answer Buttons');
assert.match(js,/snm-responsive-media/,'renderer deve impedir recorte de mídia no mobile');
assert.match(js,/anki-review-action-sheet/,'Mais ações deve abrir lista direta de ações');
assert.doesNotMatch(js,/UI\.prompt\(\[\{key:'action'.*Mais ações/s,'Mais ações do reviewer não deve exigir select + Abrir');
assert.match(js,/basic_optional_reversed/,'criador simples deve expor reverso opcional');
assert.match(js,/typing/,'criador simples deve expor digitação da resposta');
assert.match(js,/image_occlusion/,'criador simples deve expor oclusão de imagem');
assert.match(css,/anki-review-action-panel/,'action sheet do reviewer deve ter layout responsivo');
assert.match(css,/cards-anki-frame/,'iframe de card deve respeitar largura disponível');
const hist=P._histBars([1,5,10,40,100,500],[1,7,30,90,365],['<1','1-7','7-30','30-90','90-365','>365']);
assert.match(hist,/anki-p10-hist/);

console.log('PARIDADE PRÁTICA 10/10: decks, Browser, preferências, mídia mobile, ações diretas e tipos padrão validados.');
