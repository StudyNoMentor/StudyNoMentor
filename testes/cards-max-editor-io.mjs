#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const documentStub={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};

const editorCtx={console,globalThis:null,queueMicrotask:()=>{},document:documentStub,
  AnkiProductParity:{esc:s=>String(s)},AnkiParity:{},DB:{},CardsScreen:{},sessionStorage:{getItem:()=>null,setItem:()=>{}}
};editorCtx.globalThis=editorCtx;vm.createContext(editorCtx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-max-editor.js'),'utf8'),editorCtx,{filename:'44-anki-max-editor.js'});
const E=vm.runInContext('AnkiMaxEditor',editorCtx);
const rich=E._fieldEditorHtml({name:'Resposta',ord:1,sticky:true,rtl:true,fontName:'Noto Sans',fontSize:23,description:'Ajuda'},'<b>x</b>','x');
assert.match(rich,/contenteditable="true"/);
assert.match(rich,/📌/);
assert.match(rich,/direction:rtl/);
assert.match(rich,/Noto Sans/);
assert.match(rich,/Ajuda/);
const plain=E._fieldEditorHtml({name:'Plain',ord:0,plainText:true},'<b>x</b>','p');
assert.match(plain,/<textarea/);
assert.doesNotMatch(plain,/contenteditable="true"/);

const io={
  state:{shapes:[
    {type:'rect',ordinal:2,left:.2,top:.3,width:.2,height:.1},
    {type:'rect',ordinal:3,left:.5,top:.4,width:.1,height:.1}
  ],selected:[0,1],undoStack:[],redoStack:[],zoom:1},
  _renderEditor:()=>{},_nextOrdinal(){return Math.max(0,...this.state.shapes.map(s=>Number(s.ordinal)||0))+1;}
};
const ioCtx={console,globalThis:null,queueMicrotask:()=>{},document:documentStub,AnkiImageOcclusion:io,UI:{prompt:()=>Promise.resolve(null)}};
ioCtx.globalThis=ioCtx;vm.createContext(ioCtx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-max-image-occlusion.js'),'utf8'),ioCtx,{filename:'44-anki-max-image-occlusion.js'});
const M=vm.runInContext('AnkiMaxImageOcclusion',ioCtx);

const b=M._bounds(io.state.shapes[0]);
assert.deepEqual(JSON.parse(JSON.stringify(b)),{left:.2,top:.3,right:.4,bottom:.4,width:.2,height:.1});
assert.equal(M._pointInPolygon({x:.5,y:.5},[{x:.2,y:.2},{x:.8,y:.2},{x:.5,y:.8}]),true);

M.group();
assert.equal(io.state.shapes[0].ordinal,2);
assert.equal(io.state.shapes[1].ordinal,2);
M.undo();
assert.equal(io.state.shapes[1].ordinal,3);
M.redo();
assert.equal(io.state.shapes[1].ordinal,2);
M.ungroup();
assert.notEqual(io.state.shapes[0].ordinal,io.state.shapes[1].ordinal);

io.state.selected=[0,1];M.align('left');
assert.equal(io.state.shapes[0].left,io.state.shapes[1].left);
const before=io.state.shapes.length;M.duplicate();
assert.equal(io.state.shapes.length,before+2);
assert.equal(io.state.selected.length,2);

console.log('PARIDADE MÁXIMA EDITOR/IO: metadados de campo, rich/plain editor e ferramentas estruturais de oclusão validados.');
