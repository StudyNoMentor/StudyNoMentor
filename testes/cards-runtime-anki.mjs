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
const frame={srcdoc:''},input={value:'Pariz',style:{}},face={classList:{remove(){},add(){}}};
const context={window:{},document:{getElementById(id){
  return {'cards-official-frame':frame,'cards-official-type-answer':input,'cards-official-face':face}[id]||null;
}},CardsScreen:{_flipped:false},console,queueMicrotask(){}};
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

console.log('CARDS RUNTIME: HTML oficial isolado, comparação oficial de type-answer, AV e falha sem fallback verificados.');
