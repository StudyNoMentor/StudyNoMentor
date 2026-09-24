/* Editar o card exibido no modo foco precisa refletir NA HORA no próprio
   reviewer, inclusive em notas de tipo importado do Anki (renderizadas a partir
   dos CAMPOS da nota, não de frente/verso). Antes: o formulário simples gravava
   só card.frente e a revisão continuava mostrando o campo antigo. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer((req,res)=>{const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end('nao encontrado');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
const page=await browser.newPage({viewport:{width:1200,height:900}});
const erros=[];page.on('pageerror',e=>erros.push(e.message));
let n=0;const ok=(v,m)=>{n++;assert.ok(v,m);};
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&typeof CardsScreen!=='undefined'&&typeof AnkiParity!=='undefined'&&typeof AnkiProductParity!=='undefined',{timeout:30000});
  await page.evaluate(()=>{try{ProfileUI.hideGate();}catch(_){}});

  const esperar=ms=>page.waitForTimeout(ms);
  const frente=()=>page.evaluate(()=>{const f=document.querySelector('#cards-content .cards-front iframe');return f?(f.getAttribute('srcdoc')||''):document.querySelector('#cards-content').innerText;});

  /* 1) Tipo de nota importado (não padrão): renderiza dos campos da nota. */
  const id=await page.evaluate(()=>{
    const d=DB.addDeck('Foco importado');
    const nt=AnkiParity.saveNotetype({id:777001,name:'Básico com dica',kind:'normal',
      fields:[{name:'Front'},{name:'Back'}],
      templates:[{name:'Card 1',qfmt:'<details open><summary>Dica</summary>{{Front}}</details>',afmt:'{{FrontSide}}<hr id=answer>{{Back}}'}],css:''});
    const note=AnkiParity.saveNote({id:777002,notetypeId:nt.id,fields:{Front:'CAMPO-ANTIGO',Back:'Verso'},tags:[]});
    const c=DB.addCard({deckId:d.id,noteId:note.id,ankiNoteId:note.id,notetypeId:nt.id,ankiTemplateOrd:0,kind:'basic',frente:'<details open><summary>Dica</summary>CAMPO-ANTIGO</details>',verso:'Verso'});
    switchScreen('cards');CardsScreen.filters={materias:new Set(['deck:'+d.id])};CardsScreen.invalidateReviewQueue();CardsScreen.entrarFoco();
    return c.id;
  });
  await esperar(300);
  ok((await frente()).includes('CAMPO-ANTIGO'),'o card importado aparece no foco');
  await page.click('#cards-review-edit');
  await esperar(150);
  ok(await page.evaluate(()=>getComputedStyle(document.getElementById('anki-note-edit-modal')).display!=='none'),'tipo importado abre o editor de CAMPOS da nota');
  const campo=page.locator('#anki-note-edit-body .anki-note-field[data-field="Front"]');
  ok(await campo.isVisible(),'campo Front visível por cima do modo foco');
  ok((await campo.innerHTML()).trim()==='CAMPO-ANTIGO','o editor mostra o campo cru, não o HTML renderizado');
  await campo.evaluate(el=>{el.innerHTML='CAMPO-NOVO';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#anki-note-save');
  await esperar(300);
  const depois=await frente();
  ok(depois.includes('CAMPO-NOVO')&&!depois.includes('CAMPO-ANTIGO'),'o reviewer do foco reflete a edição na hora');
  ok(await page.evaluate(i=>CardsScreen.emFoco()&&CardsScreen._reviewQueue[CardsScreen._reviewIdx]===i,id),'continua no foco, no mesmo card');
  ok(await page.evaluate(i=>DB.getCard(i).frente.includes('CAMPO-NOVO'),id),'a cópia renderizada do card (lista/navegador) também foi atualizada');

  /* 2) Card simples criado no app: formulário frente/verso. */
  await page.evaluate(()=>{
    const d=DB.addDeck('Foco simples');DB.addCard({deckId:d.id,frente:'SIMPLES-ANTIGO',verso:'v',kind:'basic'});
    CardsScreen.filters={materias:new Set(['deck:'+d.id])};CardsScreen.invalidateReviewQueue();CardsScreen.render();
  });
  await esperar(300);
  ok((await frente()).includes('SIMPLES-ANTIGO'),'card simples aparece no foco');
  await page.click('#cards-review-edit');
  await esperar(150);
  await page.evaluate(()=>{document.getElementById('card-frente').innerHTML='SIMPLES-NOVO';CardsScreen.saveCard(true);});
  await esperar(300);
  const s=await frente();
  ok(s.includes('SIMPLES-NOVO')&&!s.includes('SIMPLES-ANTIGO'),'card simples também reflete a edição na hora');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`CARDS FOCO/EDIÇÃO OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
