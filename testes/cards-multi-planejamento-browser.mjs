/* Cards em "Todos os planejamentos": baralhos de outros planos aparecem em
   todas as listas e as operações que vivem dentro de um plano (card novo,
   estudo personalizado, excluir baralho filtrado, subbaralho) agem no plano
   dono do baralho, nunca no ativo. */
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
const page=await browser.newPage();
const erros=[];page.on('pageerror',e=>erros.push(e.message));
let n=0;const ok=(v,m)=>{n++;assert.ok(v,m);};
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&typeof CardsScreen!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.inPlan,{timeout:30000});
  const r=await page.evaluate(async()=>{
    try{ProfileUI.hideGate();}catch(_){}
    StudyGlobalScope.setCardsScope('all');
    const dA=DB.addDeck('Deck Ativo');DB.addCard({deckId:dA.id,frente:'A',verso:'1',kind:'basic'});
    const B=PlanManager.createPlan({nome:'Plano B',tipo:'Outro'});
    DB.saveDecksForPlan(B,[{id:'dkB',nome:'Deck B'}]);
    DB.saveCardsForPlan(B,[{id:'cB1',deckId:'dkB',frente:'x',verso:'y',phase:'new'}]);
    switchScreen('cards');
    const out={};
    CardsScreen.openDeckModal();
    out.lista=[...document.querySelectorAll('#deck-list .deck-row')].map(r=>r.querySelector('.deck-name').value+'|'+r.querySelector('.deck-count').textContent);
    document.getElementById('deck-modal').style.display='none';
    CardsScreen.openCardModal();
    out.destino=[...document.getElementById('card-destino').options].map(o=>o.value);
    document.getElementById('card-destino').value='deck:dkB';
    document.getElementById('card-frente').innerHTML='Nova B';document.getElementById('card-verso').innerHTML='Resp B';
    const ativosAntes=DB.getCards().length;CardsScreen.saveCard(true);
    out.cardsB=DB.getCardsForPlan(B).length;out.ativosDepois=DB.getCards().length-ativosAntes;
    CardsScreen.openCustomStudy();
    out.custom=[...document.getElementById('cards-custom-deck').options].map(o=>o.value);
    document.getElementById('cards-custom-deck').value='dkB';document.getElementById('cards-custom-mode').value='preview';document.getElementById('cards-custom-value').value='30';
    CardsScreen.runCustomStudy();
    const fB=DB.getDecksForPlan(B).find(d=>AnkiParity.isFilteredDeck(d));
    out.filtradoB=!!fB;out.filtradoAtivo=DB.getDecks().some(d=>AnkiParity.isFilteredDeck(d));
    out.movidos=DB.getCardsForPlan(B).filter(c=>c.originalDeckId).length;
    UI.confirm=()=>Promise.resolve(true);
    CardsScreen.openDeckModal();
    const row=[...document.querySelectorAll('#deck-list .deck-row')].find(x=>x.dataset.id===String(fB&&fB.id));
    out.linhaFiltrado=row?row.querySelector('.deck-count').textContent:'';
    row.querySelector('.deck-del').click();await new Promise(r=>setTimeout(r,200));
    out.aposExcluir={decks:DB.getDecksForPlan(B).map(d=>d.id),presos:DB.getCardsForPlan(B).filter(c=>c.originalDeckId||c.deckId!=='dkB').length};
    document.getElementById('deck-modal').style.display='none';
    CardsScreen.openAlgoConfig();await new Promise(r=>setTimeout(r,200));
    const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value==='__global__'));
    out.algo=s?[...s.options].map(o=>o.value):[];
    return out;
  });
  ok(r.lista.some(x=>x.startsWith('Deck B|')&&x.includes('Plano B')),'Meus baralhos mostra baralho de outro plano com o nome do plano');
  ok(r.lista.some(x=>x.startsWith('Deck Ativo|')),'Meus baralhos mantém o baralho do plano ativo');
  ok(r.destino.includes('deck:dkB'),'Criar card oferece baralho de outro plano');
  ok(r.cardsB===2&&r.ativosDepois===0,'card novo é gravado no plano dono do baralho');
  ok(r.custom.includes('dkB'),'Estudo personalizado oferece baralho de outro plano');
  ok(r.filtradoB&&!r.filtradoAtivo&&r.movidos>=1,'Estudo personalizado é criado no plano dono do baralho');
  ok(r.linhaFiltrado.startsWith('🔎'),'baralho filtrado de outro plano é reconhecido como filtrado');
  ok(r.aposExcluir.decks.join()==='dkB'&&r.aposExcluir.presos===0,'excluir filtrado de outro plano devolve os cards à origem');
  ok(r.algo.includes('dkB'),'Parâmetros dos Cards lista baralho de outro plano');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`CARDS MULTI-PLANEJAMENTO OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
