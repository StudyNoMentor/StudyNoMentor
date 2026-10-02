/* Cards em "Todos os planejamentos": baralhos de outros planos aparecem em
   todas as listas. Filtros próprios do Study preservam OR dentro de uma
   dimensão, AND entre dimensões e a interação em telas pequenas. */
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
    DB.saveCardsForPlan(B,[{id:'cB1',deckId:'dkB',frente:'cache B',verso:'cache resposta B',phase:'new',kind:'basic'}]);

    switchScreen('cards');
    const out={};
    CardsScreen.openDeckModal();
    out.lista=[...document.querySelectorAll('#deck-list .deck-row')].map(r=>r.querySelector('.deck-name').value+'|'+r.querySelector('.deck-count').textContent);
    document.getElementById('deck-modal').style.display='none';
    CardsScreen.openCardModal();
    out.destino=[...document.getElementById('card-destino').options].map(o=>o.value);
    document.getElementById('card-modal').style.display='none';

    // Regressão dos filtros múltiplos: duas disciplinas/baralhos e dois assuntos.
    const dC=DB.addDeck('Deck C');
    DB.addCard({deckId:dA.id,materia:'Disciplina Um',assunto:'Assunto Alfa',frente:'Filtro A',verso:'1',kind:'basic'});
    DB.addCard({deckId:dC.id,materia:'Disciplina Dois',assunto:'Assunto Beta',frente:'Filtro B',verso:'2',kind:'cloze'});
    CardsScreen.filters.materias=new Set();CardsScreen.filters.assuntos=new Set();CardsScreen.filters.assunto='';
    CardsScreen.render();
    document.getElementById('cards-filter-body').style.display='block';

    const matHost=document.getElementById('cards-f-materia-multi');
    const assHost=document.getElementById('cards-f-assunto-multi');
    out.multiHosts=!!(matHost&&assHost&&matHost.querySelector('.cards-multi-filter-btn')&&assHost.querySelector('.cards-multi-filter-btn'));

    matHost.querySelector('.cards-multi-filter-btn').click();
    const matChecks=[...matHost.querySelectorAll('input[data-filter-value]')];
    const ckA=matChecks.find(x=>x.dataset.filterValue==='deck:'+dA.id);
    const ckC=matChecks.find(x=>x.dataset.filterValue==='deck:'+dC.id);
    ckA.click();ckC.click();
    const deckFiltered=CardsScreen.currentFilteredCards();
    out.multiDeck={
      size:CardsScreen.filters.materias.size,
      badge:matHost.querySelector('.cards-multi-filter-badge')?.textContent||'',
      onlyChosen:deckFiltered.length>=2&&deckFiltered.every(c=>[String(dA.id),String(dC.id)].includes(String(c.deckId)))
    };

    matHost.querySelector('.cards-multi-filter-clear').click();
    const d1=[...matHost.querySelectorAll('input[data-filter-value]')].find(x=>x.dataset.filterValue==='Disciplina Um');
    const d2=[...matHost.querySelectorAll('input[data-filter-value]')].find(x=>x.dataset.filterValue==='Disciplina Dois');
    d1.click();d2.click();
    const discFiltered=CardsScreen.currentFilteredCards();
    out.multiDisc=discFiltered.length===2&&discFiltered.every(c=>['Disciplina Um','Disciplina Dois'].includes(c.materia));

    assHost.querySelector('.cards-multi-filter-btn').click();
    const assChecks=[...assHost.querySelectorAll('input[data-filter-value]')];
    assChecks.find(x=>x.dataset.filterValue==='Assunto Alfa').click();
    assChecks.find(x=>x.dataset.filterValue==='Assunto Beta').click();
    const bothFiltered=CardsScreen.currentFilteredCards();
    out.multiAssunto={
      size:CardsScreen.filters.assuntos.size,
      badge:assHost.querySelector('.cards-multi-filter-badge')?.textContent||'',
      andSemantics:bothFiltered.length===2&&bothFiltered.every(c=>['Disciplina Um','Disciplina Dois'].includes(c.materia)&&['Assunto Alfa','Assunto Beta'].includes(c.assunto))
    };

    // O filtro visível de assunto deve alterar o recorte real, não só o rótulo.
    assHost.querySelector('.cards-multi-filter-clear').click();
    matHost.querySelector('.cards-multi-filter-clear').click();
    const alpha=[...assHost.querySelectorAll('input[data-filter-value]')].find(x=>x.dataset.filterValue==='Assunto Alfa');
    alpha.click();
    const singleAssunto=CardsScreen.currentFilteredCards();
    out.singleAssunto=singleAssunto.length===1&&singleAssunto[0].assunto==='Assunto Alfa';

    // "Tipo" usa o formato canônico (kind). "tipo" é campo legado e não é mais
    // gravado pela criação/edição atual.
    assHost.querySelector('.cards-multi-filter-clear').click();
    const typeSel=document.getElementById('cards-f-tipo');
    out.typeOptions=[...typeSel.options].map(o=>({value:o.value,label:o.textContent}));
    typeSel.value='cloze';typeSel.dispatchEvent(new Event('change',{bubbles:true}));
    const clozeFiltered=CardsScreen.currentFilteredCards();
    CardsScreen.render();
    out.typeFilter={
      onlyCloze:clozeFiltered.length===1&&clozeFiltered[0].kind==='cloze',
      selectedPersists:document.getElementById('cards-f-tipo').value==='cloze'
    };
    CardsScreen.filters.tipo='';document.getElementById('cards-f-tipo').value='';

    matHost.querySelector('.cards-multi-filter-btn').click();
    const search=matHost.querySelector('.cards-multi-filter-search');
    search.value='Deck C';search.dispatchEvent(new Event('input',{bubbles:true}));
    const visible=[...matHost.querySelectorAll('.cards-multi-filter-option')].filter(x=>!x.hidden);
    out.searchWorks=visible.length===1&&visible[0].textContent.includes('Deck C');

    document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    out.outsideCloses=matHost.querySelector('.cards-multi-filter-panel').hidden;
    matHost.querySelector('.cards-multi-filter-btn').click();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    out.escapeCloses=matHost.querySelector('.cards-multi-filter-panel').hidden;

    return out;
  });
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.evaluate(()=>{
    CardsScreen.render();
    document.getElementById('cards-filter-body').style.display='block';
    const host=document.getElementById('cards-f-assunto-multi');
    host.querySelector('.cards-multi-filter-btn').click();
    const panel=host.querySelector('.cards-multi-filter-panel');
    const cs=getComputedStyle(panel),rect=panel.getBoundingClientRect(),
      probe=document.elementFromPoint(Math.min(innerWidth-20,rect.left+24),Math.max(rect.top+20,rect.bottom-24)),
      filterCard=document.getElementById('cards-filter-card');
    return {
      position:cs.position,left:cs.left,right:cs.right,bottom:cs.bottom,
      overflow:getComputedStyle(host.querySelector('.cards-multi-filter-options')).overflowY,
      filterOpacity:getComputedStyle(filterCard).opacity,
      panelOnTop:!!(probe&&panel.contains(probe)),
      navGap:Math.round(innerHeight-rect.bottom)
    };
  });
  ok(r.lista.some(x=>x.startsWith('Deck B|')&&x.includes('Plano B')),'Meus baralhos mostra baralho de outro plano com o nome do plano');
  ok(r.lista.some(x=>x.startsWith('Deck Ativo|')),'Meus baralhos mantém o baralho do plano ativo');
  ok(r.destino.includes('deck:dkB'),'Criar card oferece baralho de outro plano');
  ok(r.multiHosts,'filtros de disciplina/baralho e assunto usam controles múltiplos');
  ok(r.multiDeck.size===2&&r.multiDeck.badge==='2'&&r.multiDeck.onlyChosen,'dois baralhos são combinados por OR e exibem contador');
  ok(r.multiDisc,'duas disciplinas podem ser selecionadas simultaneamente');
  ok(r.multiAssunto.size===2&&r.multiAssunto.badge==='2'&&r.multiAssunto.andSemantics,'assuntos usam OR interno e AND com disciplinas');
  ok(r.singleAssunto,'selecionar um assunto altera efetivamente o recorte dos cards');
  ok(r.typeOptions.some(x=>x.value==='basic')&&r.typeOptions.some(x=>x.value==='cloze'),'Tipo lista os formatos canônicos atuais');
  ok(r.typeFilter.onlyCloze&&r.typeFilter.selectedPersists,'Tipo filtra por kind e preserva a seleção após render');
  ok(r.searchWorks,'busca interna reduz as opções sem alterar a seleção');
  ok(r.outsideCloses,'dropdown fecha ao clicar fora');
  ok(r.escapeCloses,'dropdown fecha pela tecla Escape');
  ok(mobile.position==='fixed'&&mobile.bottom!=='auto'&&mobile.overflow==='auto','dropdown móvel fica preso à viewport e mantém rolagem interna');
  ok(mobile.filterOpacity==='1','card de filtros aberto não cria stacking context por opacidade');
  ok(mobile.panelOnTop,'dropdown móvel fica acima do card de revisão no hit-test real');
  ok(mobile.navGap>=70,'dropdown móvel termina acima da navegação inferior');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`CARDS MULTI-PLANEJAMENTO OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
