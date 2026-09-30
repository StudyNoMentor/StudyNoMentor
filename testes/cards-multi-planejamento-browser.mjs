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
    DB.saveCardsForPlan(B,[{id:'cB1',deckId:'dkB',frente:'cache B',verso:'cache resposta B',phase:'new',kind:'basic'}]);

    // Regressão: Notes são entidades por planejamento. Com o mesmo ID no
    // plano ativo e no Plano B, o reviewer precisa usar a Note do DONO do card,
    // e uma edição global precisa persistir de volta na Note daquele plano.
    // ID deliberadamente derivado de B: o teste precisa de um namespace
    // inequivocamente diferente mesmo sob relógio/aleatoriedade congelados.
    const C=String(B)+'__isolado';
    const plansIso=PlanManager.getPlans();
    plansIso.push({id:C,nome:'Plano C',tipo:'Outro',createdAt:new Date().toISOString()});
    PlanManager.savePlans(plansIso);PlanManager._seedDefaults(C);
    const collisionNtId=AnkiParity._allocId(),ntDef=JSON.parse(JSON.stringify(AnkiParity._stockNotetypeDef('basic')));
    ntDef.id=collisionNtId;AnkiParity.saveNotetype(ntDef,B);AnkiParity.saveNotetype(ntDef,C);
    const collisionNoteId=AnkiParity._allocId();
    AnkiParity.saveNote({id:collisionNoteId,notetypeId:collisionNtId,fields:{Front:'',Back:''},tags:[]},C);
    AnkiParity.saveNote({id:collisionNoteId,notetypeId:collisionNtId,fields:{Front:'Frente canônica B',Back:'Resposta canônica B'},tags:[]},B);
    const seededB=DB.getCardsForPlan(B);Object.assign(seededB[0],{ankiNoteId:collisionNoteId,notetypeId:collisionNtId,ankiTemplateOrd:0});
    DB.saveCardsForPlan(B,seededB);
    const foreignBefore=DB.getCard('cB1');CardsScreen._flipped=false;
    const foreignFaceBefore=CardsScreen.faceHtml(foreignBefore);
    DB.updateCardNote('cB1',{frente:'Frente editada B',verso:'Resposta editada B',kind:'basic'});
    const foreignAfter=AnkiParity.getNote(collisionNoteId,B),otherPlanAfter=AnkiParity.getNote(collisionNoteId,C);

    switchScreen('cards');
    const foreignRef=AnkiProductParity.noteRefForCard(DB.getCard('cB1')),routedForeign=AnkiProductParity._getNote(foreignRef);
    AnkiProductParity.openNoteEditor(foreignRef);
    const editorFront=document.querySelector('#anki-note-edit-body .anki-note-field[data-field="Front"]')?.value||'';
    document.getElementById('anki-note-edit-modal').style.display='none';
    AnkiProductParity.openChangeType([foreignRef]);
    const typeOptions=[...document.getElementById('anki-change-type-target').options].map(o=>o.value);
    document.getElementById('anki-change-type-modal').style.display='none';
    const out={foreignCanonical:{
      before:foreignFaceBefore,
      after:foreignAfter&&foreignAfter.fields,
      otherPlanAfter:otherPlanAfter&&otherPlanAfter.fields,
      ref:foreignRef,
      routedPlan:routedForeign&&routedForeign._planId,
      editorFront,
      typeOptions
    }};
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

    // Regressão dos filtros múltiplos: duas disciplinas/baralhos e dois assuntos.
    const dC=DB.addDeck('Deck C');
    DB.addCard({deckId:dA.id,materia:'Disciplina Um',assunto:'Assunto Alfa',frente:'Filtro A',verso:'1',kind:'basic'});
    DB.addCard({deckId:dC.id,materia:'Disciplina Dois',assunto:'Assunto Beta',frente:'Filtro B',verso:'2',kind:'basic'});
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

    assHost.querySelector('.cards-multi-filter-clear').click();
    matHost.querySelector('.cards-multi-filter-clear').click();
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

    // Auditoria v4: o arquivo global precisa ser autossuficiente e declarar
    // corretamente que configuração/contadores pertencem ao perfil.
    // Colisão legada proposital: a tela pode deduplicar visualmente, mas a
    // auditoria global precisa preservar as duas linhas físicas e apontar o risco.
    const dupId=DB.getCards()[0].id;
    const rowsB=DB.getCardsForPlan(B).map(x=>{const y={...x};delete y._planId;delete y._planNome;return y;});
    rowsB.push({id:dupId,deckId:'dkB',frente:'Duplicado legado',verso:'B',phase:'new'});
    DB.saveCardsForPlan(B,rowsB);

    CardsConfig.set({weights:null});
    CardsConfig.setDeckPreset('dkB',{retention:0.88,weights:FSRS.DEFAULT_W.slice()});
    const oldDownload=CardsScreen._download;let auditDownload=null;
    CardsScreen._download=(name,content,mime)=>{auditDownload={name,content,mime};};
    CardsScreen.exportAudit();
    CardsScreen._download=oldDownload;
    const audit=JSON.parse(auditDownload.content);
    const cfgB=audit.configurationResolved.decks.find(x=>String(x.deckId)==='dkB');
    out.audit={
      filename:auditDownload.name,
      version:audit.version,
      configScope:audit.configurationScope,
      dailyScope:audit.dailyCountersScope,
      includedPlans:audit.scope.includedPlans,
      weights:audit.configurationResolved.profile.resolvedWeights,
      deckB:cfgB,
      historicalSnapshots:audit.format.historicalSnapshots,
      scheduler:audit.schedulerReference,
      consistency:audit.consistency,
      exportedCardKeys:Object.keys(audit.cards),
      planBId:B
    };
    return out;
  });
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.evaluate(()=>{
    CardsScreen.render();
    document.getElementById('cards-filter-body').style.display='block';
    const host=document.getElementById('cards-f-assunto-multi');
    host.querySelector('.cards-multi-filter-btn').click();
    const panel=host.querySelector('.cards-multi-filter-panel');
    const cs=getComputedStyle(panel);
    return {position:cs.position,left:cs.left,right:cs.right,bottom:cs.bottom,overflow:getComputedStyle(host.querySelector('.cards-multi-filter-options')).overflowY};
  });
  ok(r.foreignCanonical.before.includes('Frente canônica B')&&!r.foreignCanonical.before.includes('A frente deste cartão está em branco'),'reviewer resolve Note/NoteType no planejamento dono do card, mesmo com colisão de IDs');
  ok(r.foreignCanonical.after.Front==='Frente editada B'&&r.foreignCanonical.after.Back==='Resposta editada B'&&r.foreignCanonical.otherPlanAfter.Front==='','editar card global sincroniza somente a Note canônica do planejamento de origem: '+JSON.stringify(r.foreignCanonical));
  ok(r.foreignCanonical.ref.startsWith('p:')&&String(r.foreignCanonical.routedPlan)===String(r.audit.planBId)&&r.foreignCanonical.editorFront==='Frente editada B','Editor canônico resolve a identidade composta planejamento+noteId sem cair na nota homônima');
  ok(r.foreignCanonical.typeOptions.length>=5&&r.foreignCanonical.typeOptions.every(x=>x.startsWith('p:'+encodeURIComponent(String(r.audit.planBId))+':t:')),'Mudar tipo oferece NoteTypes do planejamento de origem, com referência composta');
  ok(r.lista.some(x=>x.startsWith('Deck B|')&&x.includes('Plano B')),'Meus baralhos mostra baralho de outro plano com o nome do plano');
  ok(r.lista.some(x=>x.startsWith('Deck Ativo|')),'Meus baralhos mantém o baralho do plano ativo');
  ok(r.destino.includes('deck:dkB'),'Criar card oferece baralho de outro plano');
  ok(r.cardsB===2&&r.ativosDepois===0,'card novo é gravado no plano dono do baralho');
  ok(r.custom.includes('dkB'),'Estudo personalizado oferece baralho de outro plano');
  ok(r.filtradoB&&!r.filtradoAtivo&&r.movidos>=1,'Estudo personalizado é criado no plano dono do baralho');
  ok(r.linhaFiltrado.startsWith('🔎'),'baralho filtrado de outro plano é reconhecido como filtrado');
  ok(r.aposExcluir.decks.join()==='dkB'&&r.aposExcluir.presos===0,'excluir filtrado de outro plano devolve os cards à origem');
  ok(r.algo.includes('dkB'),'Parâmetros dos Cards lista baralho de outro plano');
  ok(r.multiHosts,'filtros de disciplina/baralho e assunto usam controles múltiplos');
  ok(r.multiDeck.size===2&&r.multiDeck.badge==='2'&&r.multiDeck.onlyChosen,'dois baralhos são combinados por OR e exibem contador');
  ok(r.multiDisc,'duas disciplinas podem ser selecionadas simultaneamente');
  ok(r.multiAssunto.size===2&&r.multiAssunto.badge==='2'&&r.multiAssunto.andSemantics,'assuntos usam OR interno e AND com disciplinas');
  ok(r.searchWorks,'busca interna reduz as opções sem alterar a seleção');
  ok(r.outsideCloses,'dropdown fecha ao clicar fora');
  ok(r.escapeCloses,'dropdown fecha pela tecla Escape');
  ok(r.audit.version===4&&r.audit.filename.endsWith('.json.txt'),'auditoria exporta schema v4 no formato móvel compatível');
  ok(r.audit.configScope==='profile'&&r.audit.dailyScope==='profile','auditoria declara corretamente configuração e contadores no escopo do perfil');
  ok(Array.isArray(r.audit.weights)&&r.audit.weights.length===21,'auditoria resolve e exporta os 21 pesos FSRS efetivamente usados');
  ok(r.audit.deckB&&r.audit.deckB.weightsSource==='deck-preset'&&r.audit.deckB.effectiveConfig.retention===0.88&&r.audit.deckB.resolvedWeights.length===21,'auditoria exporta preset, configuração efetiva e pesos por baralho');
  ok(r.audit.includedPlans.some(p=>p.name==='Plano B'&&p.cards>=2),'auditoria global resume cada planejamento incluído');
  ok(String(r.audit.historicalSnapshots).includes('fotografias')&&r.audit.consistency&&r.audit.consistency.memoryReplay,'auditoria documenta snapshots históricos e inclui replay de memória');
  ok(r.audit.scheduler.fsrsRs==='6.6.2'&&r.audit.scheduler.latestCompatibleAnki==='26.09.3','auditoria identifica FSRS e referência Anki compatível');
  ok(r.audit.consistency.physicalRowsPreserved===true&&r.audit.consistency.identityCollisions.cards.length===1,'auditoria global detecta colisão legada de cardId entre planejamentos');
  ok(r.audit.exportedCardKeys.some(k=>k.startsWith(r.audit.planBId+'::'))&&new Set(r.audit.exportedCardKeys.map(k=>k.split('::')[1])).size<r.audit.exportedCardKeys.length,'auditoria preserva as duas linhas físicas usando planId::cardId');
  ok(mobile.position==='fixed'&&mobile.bottom!=='auto'&&mobile.overflow==='auto','dropdown móvel fica preso à viewport e mantém rolagem interna');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`CARDS MULTI-PLANEJAMENTO OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
