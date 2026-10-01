#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const ctx={
  console,globalThis:null,queueMicrotask:()=>{},
  AnkiParity:{_escAttr:s=>String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')},
  AnkiProductParity:{},
  document:{},window:{}
};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-image-occlusion.js'),'utf8'),ctx,{filename:'44-anki-image-occlusion.js'});
const IO=vm.runInContext('AnkiImageOcclusion',ctx);


const decks=[];
ctx.escapeHtml=s=>String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
ctx.AnkiParity.isFilteredDeck=()=>false;
ctx.DB={
  getDecks:()=>decks,
  addDeck:()=>{throw new Error('baralho local não pode ser criado');}
};
const officialCalls=[];
ctx.CardsOfficialBridge=ctx.window.CardsOfficialBridge={async createOfficialDeck(nome,planId){
  officialCalls.push({nome,planId});const deck={id:'deck-padrao',nome};decks.push(deck);return {deck};
}};
assert.match(IO._deckOptions(''),/value="__default__"/,'perfil sem baralho deve oferecer Padrão no editor avançado');
assert.equal(await IO._resolveDeck('__default__','pl-1'),'deck-padrao','Padrão deve ser criado no Anki ao salvar');
assert.deepEqual(officialCalls,[{nome:'Padrão',planId:'pl-1'}]);
assert.equal(await IO._resolveDeck('deck-padrao','pl-1'),'deck-padrao');
assert.equal(officialCalls.length,1,'baralho existente não deve ser recriado');
assert.equal(decks.length,1);
assert.match(IO._deckOptions('deck-padrao'),/deck-padrao/,'após criar, o baralho real deve substituir o placeholder');

const officialTypes=[{id:6,originalStockKind:6}];
ctx.CardsOfficialBridge.ensureOfficialStandardNotetypes=async planId=>{assert.equal(planId,'pl-1');};
ctx.AnkiParity.noteTypes=()=>officialTypes;
assert.equal(await IO._allTypes('pl-1'),officialTypes,'tipos devem vir do snapshot oficial');
assert.equal(IO.isType(officialTypes[0]),true);

const rect={type:'rect',ordinal:1,oi:false,left:.1,top:.1,width:.2,height:.2};
assert.equal(IO.serializeShape(rect),'{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2}}<br>');
IO.state.occludeInactive=true;
const withInactive=IO.serializeShape({...rect,ordinal:2,oi:true});
assert.match(withInactive,/\:oi=1\}\}/,'occludeInactive é opção global no exportShapesToClozeDeletions do upstream');
IO.state.occludeInactive=false;
assert.equal(IO._fmt(0),'.0000','floatToDisplay oficial mantém zero como .0000');
assert.equal(IO.serializeShape({type:'ellipse',ordinal:2,left:.2,top:.3,width:.1,height:.2}),
  '{{c2::image-occlusion:ellipse:left=.2:top=.3:rx=.05:ry=.1}}<br>',
  'ellipse oficial usa rx/ry, sem width/height');

const parsed=IO.parse('{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4}}<br>{{c2::image-occlusion:ellipse:left=.2:top=.3:rx=.05:ry=.1:oi=1}}');
assert.equal(parsed.length,2);
assert.equal(parsed[0].type,'rect');assert.equal(parsed[0].ordinal,1);
assert.equal(parsed[1].type,'ellipse');assert.equal(parsed[1].ordinal,2);assert.equal(parsed[1].oi,true);

ctx.CardsOfficialBridge.createOfficialDeck=async()=>{throw new Error('offline');};
decks.length=0;
await assert.rejects(()=>IO._resolveDeck('__default__','pl-1'),/offline/);
assert.equal(decks.length,0,'falha oficial não cria baralho local');

// Uso touch: o canvas precisa capturar o gesto do editor e limpar qualquer drag
// quando o navegador cancela o pointer (rotação, gesto do SO, perda de captura).
const maxIoSrc=readFileSync(join(ROOT,'src/js/44-anki-max-image-occlusion.js'),'utf8');
const cardsCss=readFileSync(join(ROOT,'src/css/44-telas-cards.css'),'utf8');
assert.match(maxIoSrc,/addEventListener\('pointercancel'/,'camada avançada deve tratar pointercancel');
assert.match(maxIoSrc,/s\.drag=null;s\.drawing=null/,'pointercancel deve encerrar desenho e arraste');
assert.match(cardsCss,/#anki-io-canvas\{touch-action:none/,'canvas IO deve reservar gestos touch ao editor');


console.log('IMAGE OCCLUSION: tipos/baralhos oficiais, serialização de máscaras e gestos touch validados.');
