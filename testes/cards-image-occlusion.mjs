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
  addDeck:nome=>{const d={id:'deck-padrao',nome};decks.push(d);return d;}
};
assert.match(IO._deckOptions(''),/value="__default__"/,'perfil sem baralho deve oferecer Padrão no editor avançado');
assert.equal(IO._resolveDeck('__default__'),'deck-padrao','Padrão deve ser criado somente ao salvar');
assert.equal(decks.length,1);
assert.match(IO._deckOptions('deck-padrao'),/deck-padrao/,'após criar, o baralho real deve substituir o placeholder');

const nt=IO.stockDef();
assert.equal(nt.kind,'cloze');
assert.equal(nt.originalStockKind,6,'Image Occlusion deve exportar OriginalStockKind oficial = 6');
assert.deepEqual(Array.from(nt.fields, f=>f.tag),[0,1,2,3,4]);
assert.deepEqual(Array.from(nt.fields, f=>!!f.preventDeletion),[true,true,true,true,false]);
assert.match(nt.templates[0].qfmt,/anki\.imageOcclusion\.setup/,'template exportado deve manter contrato oficial do Anki');

const rect={type:'rect',ordinal:1,oi:false,left:.1,top:.1,width:.2,height:.2};
assert.equal(IO.serializeShape(rect),'{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2}}<br>');
const withInactive=IO.serializeShape({...rect,ordinal:2,oi:true});
assert.match(withInactive,/\:oi=1\}\}/);

const parsed=IO.parse('{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4}}<br>{{c2::image-occlusion:ellipse:left=.2:top=.3:width=.1:height=.2:rx=.05:ry=.1:oi=1}}');
assert.equal(parsed.length,2);
assert.equal(parsed[0].type,'rect');assert.equal(parsed[0].ordinal,1);
assert.equal(parsed[1].type,'ellipse');assert.equal(parsed[1].ordinal,2);assert.equal(parsed[1].oi,true);

const note={fields:{
  Occlusion:'{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4}}',
  Image:'<img src="data:image/png;base64,AA==">',
  Header:'Cabeçalho','Back Extra':'Extra',Comments:'Comentário'
}};
const card={clozeOrd:1,ankiTemplateOrd:0};
const q=IO.render(nt,note,'question',card);
const a=IO.render(nt,note,'answer',card);
assert.match(q,/snm-io-active/,'frente deve ocultar a região ativa');
assert.match(a,/snm-io-highlight/,'verso deve revelar a região ativa com destaque');
assert.match(a,/Extra/,'Back Extra deve aparecer no verso');
assert.doesNotMatch(q,/Comentário/,'Comments não deve aparecer no card');

console.log('IMAGE OCCLUSION: stock kind 6, campos estruturais, serialização oficial e renderização validados.');
