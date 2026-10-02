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
    const activePlan=PlanManager.getActivePlanId();

    // Reproduz o defeito real: várias migrações deixaram "Default" locais sem
    // ankiId. Um deles tem card já reconhecido pela Collection; outro é órfão.
    const localDecks=DB.getDecks();
    localDecks.push({id:'defaultA-used',nome:'Default'},{id:'defaultA-orphan',nome:'Default'});
    DB.saveDecks(localDecks);
    const localCards=DB.getCards();
    localCards.push({id:'legacy-default-card',ankiId:501,deckId:'defaultA-used',frente:'legado',verso:'default',kind:'basic'});
    localCards.push({id:'legacy-default-card-2',ankiId:502,deckId:'defaultA-orphan',frente:'legado 2',verso:'default',kind:'basic'});
    DB.saveCards(localCards);

    const B=PlanManager.createPlan({nome:'Plano B',tipo:'Outro'});
    DB.saveDecksForPlan(B,[{id:'dkB',nome:'Deck B',ankiId:9001},{id:'defaultB',nome:'Default'}]);
    DB.saveCardsForPlan(B,[{id:'cB1',deckId:'dkB',frente:'cache B',verso:'cache resposta B',phase:'new',kind:'basic'}]);

    // A correção é de dados, não cosmética: o snapshot oficial vincula os
    // espelhos legados ao deck 1, remapeia cards e elimina duplicata física.
    const repaired=CardsOfficialBridge._reconcileLegacyDeckMirrors({
      decks:[{id:1,name:'Default',filtered:false}],
      cards:[{id:501,deck_id:1},{id:502,deck_id:1}]
    });
    const activeDefaults=DB.getDecks().filter(d=>Number(d.ankiId)===1);
    const planBDefaults=DB.getDecksForPlan(B).filter(d=>Number(d.ankiId)===1);
    const repairedCards=DB.getCards().filter(c=>c.id==='legacy-default-card'||c.id==='legacy-default-card-2');

    switchScreen('cards');
    const out={deckRepair:{
      bound:repaired.bound,collapsed:repaired.collapsed,remappedCards:repaired.remappedCards,
      activeCount:activeDefaults.length,planBCount:planBDefaults.length,
      cardsOnCanonical:!!(activeDefaults[0]&&repairedCards.length===2&&repairedCards.every(c=>String(c.deckId)===String(activeDefaults[0].id))),
      activePhysicalDefaults:DB.getDecks().filter(d=>String(d.nome)==='Default').length
    }};
    CardsScreen.openDeckModal();
    out.lista=[...document.querySelectorAll('#deck-list .deck-row')].map(r=>r.querySelector('.deck-name').value+'|'+r.querySelector('.deck-count').textContent);
    document.getElementById('deck-modal').style.display='none';
    StudyGlobalScope.setCardsScope('plan');
    CardsScreen.openCardModal();
    const destOptions=[...document.getElementById('card-destino').options].filter(o=>o.value).map(o=>({
      value:o.value,label:o.textContent,parsed:CardsScreen._parseDeckDestination(o.value)
    }));
    out.destino={
      values:destOptions,
      remoteVisible:destOptions.some(o=>String(o.parsed.deckId)==='dkB'&&String(o.parsed.planId)===String(B)),
      defaultCount:destOptions.filter(o=>String(o.label||'').includes('Default')).length,
      defaultUsesActive:destOptions.some(o=>String(o.label||'').includes('Default')&&String(o.parsed.planId)===String(activePlan))
    };
    const remoteOpt=destOptions.find(o=>String(o.parsed.deckId)==='dkB');
    document.getElementById('card-destino').value=remoteOpt&&remoteOpt.value||'';
    document.getElementById('card-frente').innerHTML='Frente global';
    document.getElementById('card-verso').innerHTML='Verso global';
    const globalForm=CardsScreen._readCardForm();
    out.destinoRoutesOwner=!!(globalForm&&String(globalForm.deckId)==='dkB'&&String(globalForm._deckPlanId)===String(B));
    document.getElementById('card-modal').style.display='none';
    StudyGlobalScope.setCardsScope('all');

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
    host.scrollIntoView({block:'center',inline:'nearest'});
    host.querySelector('.cards-multi-filter-btn').click();
    const panel=host._cardsMultiPanel||host.querySelector('.cards-multi-filter-panel');
    const cs=getComputedStyle(panel),rect=panel.getBoundingClientRect(),
      probe=document.elementFromPoint(Math.min(innerWidth-20,rect.left+24),Math.max(rect.top+20,rect.bottom-24)),
      filterCard=document.getElementById('cards-filter-card');
    return {
      position:cs.position,left:cs.left,right:cs.right,bottom:cs.bottom,
      overflow:getComputedStyle(panel.querySelector('.cards-multi-filter-options')).overflowY,
      filterOpacity:getComputedStyle(filterCard).opacity,
      panelOnTop:!!(probe&&panel.contains(probe)),
      hit:probe?{tag:probe.tagName,id:probe.id||'',cls:String(probe.className||'').slice(0,160)}:null,
      panelRect:{top:Math.round(rect.top),bottom:Math.round(rect.bottom),left:Math.round(rect.left),right:Math.round(rect.right)},
      navGap:Math.round(innerHeight-rect.bottom)
    };
  });
  ok(r.lista.some(x=>x.startsWith('Deck B|')&&x.includes('Plano B')),'Meus baralhos mostra baralho de outro plano com o nome do plano');
  ok(r.lista.some(x=>x.startsWith('Deck Ativo|')),'Meus baralhos mantém o baralho do plano ativo');
  ok(r.deckRepair.bound===3,'reconciliação vincula todos os espelhos Default legados à identidade oficial');
  ok(r.deckRepair.collapsed===1&&r.deckRepair.remappedCards===1,'duplicata física é consolidada e o card é remapeado para o sobrevivente');
  ok(r.deckRepair.activeCount===1&&r.deckRepair.planBCount===1&&r.deckRepair.activePhysicalDefaults===1,'cada planejamento persiste no máximo um espelho do Default oficial');
  ok(r.deckRepair.cardsOnCanonical,'todos os cards legados continuam apontando para o baralho canônico após a consolidação');
  ok(r.destino.remoteVisible,'Criar card oferece baralho de outro plano mesmo com escopo visual no planejamento atual');
  ok(r.destino.defaultCount===1,'Criar card recebe um único Default porque os dados foram reconciliados, não ocultados');
  ok(r.destino.defaultUsesActive,'quando o mesmo baralho oficial existe no plano ativo, a criação prefere esse espelho');
  ok(r.destinoRoutesOwner,'salvar em baralho de outro planejamento preserva o planejamento dono do destino');
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
  ok(mobile.panelOnTop,'dropdown móvel fica acima do card de revisão no hit-test real · '+JSON.stringify({hit:mobile.hit,panelRect:mobile.panelRect,navGap:mobile.navGap}));
  ok(mobile.navGap>=70,'dropdown móvel termina acima da navegação inferior');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`CARDS MULTI-PLANEJAMENTO OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
