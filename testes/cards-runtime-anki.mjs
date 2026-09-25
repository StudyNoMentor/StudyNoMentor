#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const ctx={console,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/44-anki-runtime.js'),'utf8'),ctx,{filename:'44-anki-runtime.js'});
const R=ctx.AnkiRuntime;
assert.ok(R,'runtime Anki deve ser exportado');
const nt={css:'@font-face{font-family:X;src:url(data:font/woff2;base64,AA==)} .card{font-family:X;color:red}'};
const html='<details open><summary>Dica</summary><b>Resposta</b></details><script>document.body.dataset.js="ok"<\/script>[anki:tts lang=pt-BR voices=Maria]Olá[/anki:tts]\\(x^2\\)';
const doc=R.buildSrcdoc(nt,html,'question',{id:123});
assert.match(doc,/@font-face/,'CSS do Note Type precisa entrar no documento do card');
assert.match(doc,/<details open>/,'HTML expansível deve permanecer intacto');
assert.match(doc,/<script>document\.body\.dataset\.js=/,'JavaScript do template deve ser preservado no sandbox');
assert.match(doc,/data-anki-tts="lang=pt-BR voices=Maria"/,'marcador TTS deve virar elemento executável');
assert.match(doc,/mathjax@3\.2\.2\/es5\/tex-chtml-full\.js/,'MathJax deve usar o mesmo 3.2.2/bundle do Anki 26.09.2');
const noAuto=R.buildSrcdoc(nt,html,'question',{id:123},null,{disableAutoplay:true});
assert.match(noAuto,/const AUTO_PLAY=false/,'preset com autoplay desativado deve chegar ao runtime do card');
const frame=R.renderFrame(nt,html,'question',{id:123},true);
assert.match(frame,/sandbox="allow-scripts allow-forms allow-popups"/);
assert.doesNotMatch(frame,/allow-modals/,'template não pode abrir alert/confirm em série');
assert.doesNotMatch(frame,/allow-same-origin/,'sandbox nunca pode compartilhar a origem do Study');
assert.match(frame,/srcdoc=/);
const typedQ=R.buildSrcdoc(nt,'[[type:Front]]','question',{id:123},{fields:{Front:'Correta'}});
assert.match(typedQ,/snm-anki-type-input/,'type:Field precisa virar campo de digitação');
R._typedAnswers.set('123|Front','Correta');
const typedA=R.buildSrcdoc(nt,'[[type:Front]]','answer',{id:123},{fields:{Front:'Correta'}});
assert.match(typedA,/typeGood/,'resposta digitada correta precisa sobreviver ao flip e usar a classe oficial typeGood');
assert.match(typedA,/<code id="typeans"/,'comparação deve usar code#typeans como o Anki');
R._typedAnswers.set('123|Front','Coreta');
const typedDiff=R.buildSrcdoc(nt,'[[type:Front]]','answer',{id:123},{fields:{Front:'Correta'}});
assert.match(typedDiff,/typeBad/,'caractere digitado incorreto deve ser destacado');
assert.match(typedDiff,/typeMissed/,'caractere ausente deve ser destacado como no Anki');
R._typedAnswers.set('123|Front','elite');
const typedNc=R.buildSrcdoc(nt,'[[type:nc:Front]]','answer',{id:123},{fields:{Front:'élite'}});
assert.match(typedNc,/<span class="typeGood">élite<\/span>/,'type:nc deve ignorar diacríticos e preservar os sinais na resposta esperada');
assert.doesNotMatch(typedNc,/<span class="typeBad">/,'diferença apenas de diacrítico não pode ser marcada como erro');
// Vetores copiados dos testes do rslib/src/typeanswer.rs do Anki 26.09.2.
assert.equal(R._typeCompareHtml('123','',false),'<code id="typeans">123</code>');
assert.equal(R._typeCompareHtml('123','123',false),'<code id="typeans"><span class="typeGood">123</span></code>');
assert.equal(R._typeCompareHtml('123','1123',false),'<code id="typeans"><span class="typeBad">1</span><span class="typeGood">123</span><br><span id="typearrow">&darr;</span><br><span class="typeGood">123</span></code>');
assert.equal(R._typeCompareHtml('12','1',false),'<code id="typeans"><span class="typeGood">1</span><span class="typeMissed">-</span><br><span id="typearrow">&darr;</span><br><span class="typeGood">1</span><span class="typeMissed">2</span></code>');
assert.equal(R._typeCompareHtml('<div>123</div>','123',false),'<code id="typeans"><span class="typeGood">123</span></code>');
assert.equal(R._typeCompareHtml('[sound:foo.mp3]<b>1</b> &nbsp;2','1  2',false),'<code id="typeans"><span class="typeGood">1  2</span></code>');
assert.match(typedQ,/snm-anki-show-answer/,'Enter no campo digitado deve revelar a resposta');
assert.match(typedQ,/window\.pycmd/,'template sandbox deve expor bridge pycmd compatível');
assert.match(typedQ,/playQueue\(avNodes\(\)\)/,'runtime deve reproduzir fila AV inteira em ordem');
assert.match(typedQ,/snm-anki-av-state/,'runtime deve reportar estado AV ao Auto Advance');
R.clearTyped({id:123});
assert.equal(R._typedAnswers.has('123|Front'),false,'resposta digitada deve ser limpa ao avançar o card');
assert.equal(R._needsMath('Preço: R$ 100'),false,'valor monetário não deve carregar MathJax');
const hidden=R.renderFrame(nt,html,'answer',{id:123},false);
assert.doesNotMatch(hidden,/<iframe/,'lado oculto não pode executar JS/TTS antes do flip');

// Regressão de tema: templates Anki rodam num iframe isolado e não herdam o
// data-theme do Study. No escuro, o runtime deve aplicar a classe oficial
// nightMode e neutralizar o branco/preto padrão quando o template não possui
// uma implementação noturna própria.
ctx.document={documentElement:{getAttribute:(name)=>name==='data-theme'?'dark':null}};
const darkDoc=R.buildSrcdoc({css:'.card{background-color:white;color:black}'},'Pergunta','question',{id:124});
assert.match(darkDoc,/<html class="nightMode">/,'tema escuro do Study deve chegar ao documento isolado do card');
assert.match(darkDoc,/class="card question nightMode"/,'body do card deve receber a classe nightMode compatível com Anki');
assert.match(darkDoc,/html\.nightMode body\.card\{background:transparent;color:#e8eaed\}/,'template sem nightMode deve usar fallback escuro transparente');
assert.match(darkDoc,/snm-anki-theme/,'iframe deve aceitar atualização de tema sem recarregar a sessão');
const customNight=R.buildSrcdoc({css:'.card{background:white;color:black}.nightMode{background:#111;color:#eee}'},'Pergunta','question',{id:125});
assert.doesNotMatch(customNight,/html\.nightMode body\.card\{background:transparent;color:#e8eaed\}/,'CSS nightMode do próprio template deve prevalecer');
delete ctx.document;

// Regressão visual do reviewer: no flip, a frente precisa sair do layout e o
// verso ocupar seu lugar. Antes, o iframe sumia mas o contêiner da frente
// continuava visível como um retângulo vazio acima da resposta.
const reviewer=readFileSync(join(ROOT,'src/js/44-tela-cards.js'),'utf8');
assert.match(reviewer,/const frontDisplay = this\._flipped \? 'none' : 'block';/,'frente deve ser ocultada após o flip');
assert.match(reviewer,/const backDisplay = this\._flipped \? 'block' : 'none';/,'verso deve substituir a frente no flip');
// A8 — pycmd('easeN') só responde com ativação do usuário, no card da tela e com intervalo mínimo.
{
  const respostas=[];let ativo=true;
  ctx.navigator={userActivation:{get isActive(){return ativo;}}};
  ctx.CardsScreen={_reviewQueue:['c1'],_reviewIdx:0,_flipped:true,answer(g){respostas.push(g);},flip(){}};
  ctx.DB={getCard:id=>id==='c1'?{id:'c1',ankiId:555}:null};
  ctx.document={getElementById:()=>null};
  const quadro=(id)=>({dataset:{ankiFrameId:id}});
  R._ultimoPycmdEase=0;
  ativo=false;R._handlePycmd('ease4',quadro('anki-555-answer'));
  assert.equal(respostas.length,0,'sem ativação do usuário o template não responde o card');
  ativo=true;R._handlePycmd('ease4',quadro('anki-999-answer'));
  assert.equal(respostas.length,0,'quadro de outro card não responde o card da tela');
  R._handlePycmd('ease4',quadro('anki-555-answer'));
  for(let i=0;i<20;i++)R._handlePycmd('ease4',quadro('anki-555-answer'));
  assert.deepEqual(respostas,['facil'],'laço de pycmd responde no máximo uma vez por intervalo');
}
console.log('RUNTIME ANKI: CSS, HTML expansível, JS sandboxado, TTS, MathJax e flip validados.');
