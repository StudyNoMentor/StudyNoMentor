#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const fixture=process.env.SNM_ANKI_OFFICIAL_OUT; assert.ok(fixture,'SNM_ANKI_OFFICIAL_OUT ausente');
const require=createRequire(import.meta.url); const init=require(join(ROOT,'src/vendor/sqljs-1.2.1/sql-asm.js')); const SQL=await init();
const state={decks:[],cards:[],notes:new Map(),types:[],revlog:[],next:9000000000000};
const DB={
 _uid:()=>++state.next,getDecks:()=>state.decks,saveDecks:x=>{state.decks=x;},getCards:()=>state.cards,
 addCard:x=>{const c={id:'c'+(++state.next),...structuredClone(x)};state.cards.push(c);return c;},
 updateCard:(id,p)=>{const c=state.cards.find(x=>String(x.id)===String(id));Object.assign(c,structuredClone(p));return c;},
 getRevlog:()=>state.revlog,replaceRevlog:x=>{state.revlog=structuredClone(x);}
};
const CardsConfig={setDeckPreset(){},forDeck(){return {};},get(){return {};}};
const todayCards=()=> '2026-09-22';
const CardEngine={addDays:(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);},invalidateDueCache(){}};
const escapeHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const AnkiParity={
 noteTypes:()=>state.types,saveNotetype(nt){const i=state.types.findIndex(x=>String(x.id)===String(nt.id));const x=structuredClone(nt);if(i>=0)state.types[i]=x;else state.types.push(x);return x;},
 notes:()=>[...state.notes.values()],saveNote(n){const x=structuredClone(n);state.notes.set(String(x.id),x);return x;},getNote:id=>structuredClone(state.notes.get(String(id))||null),
 _allocId:()=>++state.next,ensureCanonicalNotes(){return {notes:state.notes.size};},
 renderTemplate(nt,note,ord,side,card,front){const t=(nt.templates||[])[nt.kind==='cloze'?0:(Number(ord)||0)]||{},fields=note.fields||{};let src=String(side==='answer'?t.afmt:t.qfmt||'').replace(/\{\{FrontSide\}\}/g,String(front||''));src=src.replace(/\{\{cloze:([^}]+)\}\}/g,(_,name)=>{const raw=String(fields[name]||''),target=Number(card&&card.clozeOrd)||1;return raw.replace(/\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/g,(m,n,val,hint)=>Number(n)===target?(side==='answer'?val:'['+(hint||'...')+']'):val);});return src.replace(/\{\{([^{}:]+)\}\}/g,(_,name)=>String(fields[name]??''));},
 _fieldNonempty:v=>String(v||'').replace(/<[^>]+>/g,'').trim().length>0,clozeOrdinals:text=>[...new Set([...String(text||'').matchAll(/\{\{c(\d+)::/g)].map(m=>Number(m[1])))].sort((a,b)=>a-b)
};
const ctx={console,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,Map,Set,Date,JSON,Math,Number,String,Boolean,RegExp,Error,Promise,Blob,Response,DecompressionStream,structuredClone,atob:globalThis.atob,btoa:globalThis.btoa,Buffer,initSqlJs:async()=>SQL,DB,CardsConfig,CardEngine,AnkiParity,todayCards,escapeHtml,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
for(const p of ['src/js/34-anki-export.js','src/js/35-anki-import.js'])vm.runInContext(readFileSync(join(ROOT,p),'utf8'),ctx,{filename:p});
vm.runInContext('globalThis.I=AnkiImport;globalThis.X=AnkiExport;',ctx);ctx.X._loadSqlJs=async()=>SQL;
const bytes=readFileSync(fixture); const file={name:'official.apkg',async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};
const parsed=await ctx.I.inspectPackage(file); assert.equal(parsed.pkg.version,3,'fixture oficial deve ser Latest');
await ctx.I.importPackage(parsed,{withScheduling:true,withDeckConfigs:true,mergeNotetypes:true,updateNotes:'always',updateNotetypes:'always'});
assert.ok(state.decks.some(d=>d.nome==='Official Advanced'),'deck oficial precisa entrar');
assert.ok(state.cards.length>=3,'Basic + dois Cloze devem gerar ao menos 3 cards');
const basic=state.types.find(t=>t.name==='Basic'); assert.ok(basic);
assert.match(basic.css,/data:font\/woff2;base64,/,'fonte do CSS oficial precisa ser materializada');
assert.match(basic.templates[0].qfmt,/<details open>/,'details/summary do template oficial precisa ser preservado');
assert.match(basic.templates[0].qfmt,/src="data:text\/javascript;base64,/,'script de mídia oficial precisa ser materializado');
const anyImage=[...state.notes.values()].some(n=>Object.values(n.fields||{}).some(v=>/data:image\/svg\+xml;base64,/.test(String(v))));assert.ok(anyImage,'imagem da fixture oficial precisa virar data URI');
assert.ok(state.types.some(t=>t.kind==='cloze'),'Cloze oficial precisa manter note type');
console.log('IMPORT OFICIAL: APKG Latest gerado pelo Anki 26.09.2 entrou no Study com CSS/fonte/JS/details/mídia/Cloze.');
