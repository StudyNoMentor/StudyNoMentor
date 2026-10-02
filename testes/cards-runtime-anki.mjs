#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
assert.equal(existsSync(join(ROOT,'src/js/44-anki-runtime.js')),false,'renderer local obsoleto não pode voltar');
const source=readFileSync(join(ROOT,'src/js/95-cards-official-bridge.js'),'utf8');
assert.match(source,/sandbox="allow-scripts"/,'template deve permanecer em origem isolada');
assert.doesNotMatch(source,/sandbox="[^"]*allow-same-origin/);
const frame={srcdoc:''},input={value:'Pariz',style:{}},face={classList:{remove(){},add(){}}},
  content={},screen={classList:{contains:n=>n==='active'}};
const context={window:{},document:{getElementById(id){
  return {'cards-official-frame':frame,'cards-official-type-answer':input,'cards-official-face':face,
    'cards-content':content,'screen-cards':screen}[id]||null;
}},CardsScreen:{_flipped:false,tab:'revisar'},console,queueMicrotask(){}};
context.window.CardsScreen=context.CardsScreen;
runInNewContext(source,context);
const bridge=context.window.CardsOfficialBridge;
const officialHtml='<style>.card{color:red}</style><details open><summary>Dica</summary>Resposta</details><script>window.fromTemplate=true</script>';
let received;
bridge.htmlWithMedia=async html=>{received=html;return '<!doctype html>'+html;};
await bridge._frame(officialHtml);
assert.equal(received,officialHtml,'ponte deve receber o HTML oficial sem reconstruir templates');
assert.equal(frame.srcdoc,'<!doctype html>'+officialHtml,'iframe deve consumir o documento preparado');
bridge.htmlWithMedia=async()=>{throw new Error('media indisponível');};
await assert.rejects(()=>bridge._frame(officialHtml),/media indisponível/);
assert.equal(frame.srcdoc,'<!doctype html>'+officialHtml,'falha não substitui o card por rendering local');

let releaseLate;
bridge.htmlWithMedia=()=>new Promise(resolve=>{releaseLate=()=>resolve('<!doctype html>late');});
const late=bridge._frame('late');
context.CardsScreen.tab='meus';
releaseLate();
await late;
assert.notEqual(frame.srcdoc,'<!doctype html>late','render assíncrono antigo não pode substituir outra aba');
context.CardsScreen.tab='revisar';

bridge.htmlWithMedia=async html=>html;
bridge.review={card:{id:123,answer:'resposta antes da comparação',type_answer:{enabled:true},answer_av_tags:[{kind:'sound',filename:'oficial.mp3'}]}};
const calls=[],played=[];
bridge.request=async(path,opts)=>{
  calls.push({path,body:JSON.parse(opts.body)});
  return {answer_html:'<code id="typeans"><span class="typeGood">Paris</span></code>'};
};
bridge.playAv=async tags=>played.push(tags);
bridge._armReviewerAutomation=()=>{};
await bridge.showAnswer();
assert.deepEqual(calls,[{path:'/api/cards-official/reviewer/type-answer/123',body:{provided:'Pariz'}}]);
assert.equal(frame.srcdoc,'<code id="typeans"><span class="typeGood">Paris</span></code>','comparação deve vir integralmente do Anki');
assert.equal(context.CardsScreen._flipped,true);
assert.equal(input.style.display,'none');
assert.equal(played[0],bridge.review.card.answer_av_tags,'AV deve usar as tags oficiais');
await bridge.showAnswer();
assert.equal(calls.length,1,'flip já revelado não refaz comparação');
context.CardsScreen._flipped=false;
bridge.request=async()=>{throw new Error('backend indisponível');};
await assert.rejects(()=>bridge.showAnswer(),/backend indisponível/);
assert.equal(context.CardsScreen._flipped,false,'falha oficial não revela resposta aproximada');

// Undo reconciliado: uma flag feita depois da revisão é desfeita oficialmente,
// mas NÃO cancela revlog/restaura o card da revisão no espelho.
let cancelled=0,restored=0;
context.DB={cancelarRevlogDurable:async()=>{cancelled++;}};
context.StudyGlobalScope={updateCardScoped:()=>{restored++;}};
context.showToast=()=>{};
bridge._activePlanId=()=>null;
bridge._syncOfficialFullState=async()=>{};
bridge._syncReviewScope=async()=>{};
bridge.renderCurrent=async()=>{};
bridge._undo=[{undoStep:7,undoLabel:'Review',officialId:123,rows:[{id:'r'}],items:[{replica:{id:'c'},before:{id:'c'}}]}];
bridge._redo=[];
bridge.historyStatus=async()=>({last_step:8,undo:'Set Flag'});
bridge.request=async path=>{
  if(path.endsWith('/history/undo'))return {state:{},status:{redo:'Set Flag',last_step:7}};
  throw new Error('rota inesperada '+path);
};
await bridge.undo();
assert.equal(bridge._undo.length,1,'undo de flag não consome a transação local da revisão');
assert.equal(cancelled,0,'undo de flag não cancela revlog local da revisão');
assert.equal(restored,0,'undo de flag não restaura estado anterior da revisão');
bridge.historyStatus=async()=>({last_step:7,undo:'Review'});
bridge.request=async path=>{
  if(path.endsWith('/history/undo'))return {state:{},status:{redo:'Review',last_step:6}};
  throw new Error('rota inesperada '+path);
};
await bridge.undo();
assert.equal(bridge._undo.length,0,'undo da revisão consome a transação correspondente');
assert.equal(cancelled,1,'undo da revisão cancela seu revlog local');
assert.equal(restored,1,'undo da revisão restaura seu espelho local');

console.log('CARDS RUNTIME: HTML oficial, type-answer, render tardio e undo reconciliado verificados.');
