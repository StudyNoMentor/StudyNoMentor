#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const store=new Map();
let opened=0,handled=0,lastFile=null,toasts=[];
const ctx={
  console,globalThis:null,queueMicrotask:()=>{},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},
  document:{getElementById:()=>null,querySelector:()=>null},
  window:{open:()=>({})},
  DB:{_profilePrefix:()=> 'p:'},
  AnkiParity:{_entityKey:(k,id)=>'p:'+k+':'+id},
  CardsScreen:{
    onKey:()=>{},openImportModal(){opened++;},
    handleImportFile(file){handled++;lastFile=file;return Promise.resolve();},
    renderReviewCard:()=>{},openCardModal:()=>{},undoAnswer:()=>{},redoAnswer:()=>{}
  },
  AnkiProductParity:{_currentReviewCard:()=>null,noteId:c=>c&&c.noteId,openBrowser:()=>{}},
  AnkiMaxParity:{_reviewActive:()=>true},
  UI:{prompt:()=>Promise.resolve(null)},
  showToast:s=>toasts.push(String(s))
};
ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-10of10-final.js'),'utf8'),ctx,{filename:'44-anki-10of10-final.js'});
const F=vm.runInContext('AnkiFinalParity',ctx);

assert.equal(F._normalizeShortcut(' ctrl + shift + h '),'Ctrl+Shift+H');
assert.equal(F._normalizeShortcut('command+k'),'Meta+K');
assert.equal(F._normalizeShortcut('Ctrl+KeyB'),'Ctrl+B');
assert.equal(F._normalizeShortcut('Ctrl+Shift'),'','atalho sem tecla principal é inválido');

assert.equal(F._eventShortcut({code:'KeyH',key:'H',ctrlKey:true,altKey:false,shiftKey:true,metaKey:false}),'Ctrl+Shift+H');
assert.equal(F._eventShortcut({code:'Digit8',key:'*',ctrlKey:false,altKey:false,shiftKey:true,metaKey:false}),'*','símbolo já incorpora Shift físico');

F._saveBindings({browse:'Ctrl+Shift+B',hint:'Alt+H'});
assert.equal(F._actionForEvent({code:'KeyB',key:'b',ctrlKey:true,altKey:false,shiftKey:true,metaKey:false}),'browse');
assert.equal(F._actionForEvent({code:'KeyH',key:'h',ctrlKey:false,altKey:true,shiftKey:false,metaKey:false}),'hint');
assert.throws(()=>F._saveBindings({browse:'Ctrl+K',hint:'Ctrl+K'}),/repetido/,'não permite dois comandos no mesmo atalho');

const apkg={name:'fiscal.apkg'};
assert.equal(F._startSharedImport(apkg),true);
assert.equal(opened,1);
assert.equal(handled,1);
assert.equal(lastFile,apkg);

const bad={name:'fiscal.zip'};
assert.equal(F._startSharedImport(bad),false);
assert.equal(opened,1,'arquivo inválido não abre importador');
assert.equal(handled,1,'arquivo inválido não é processado');
assert.ok(toasts.some(x=>x.includes('.apkg')&&x.includes('.colpkg')));

console.log('PARIDADE FINAL: atalhos personalizados por perfil e entrada integrada de Shared Decks validados.');
