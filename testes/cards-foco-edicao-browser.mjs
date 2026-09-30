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

  /* 3) Auditoria matricial de TODOS os tipos: cadastro, edição canônica,
        mudança de tipo e roteamento multi-planejamento. */
  const audit=await page.evaluate(()=>{
    if(CardsScreen.emFoco())CardsScreen.sairFoco();
    StudyGlobalScope.setCardsScope('all');
    const active=StudyGlobalScope.activePlanId(),B=PlanManager.createPlan({nome:'Auditoria Tipos B',tipo:'Outro'}),deckB='audit-tipos-b';
    DB.saveDecksForPlan(B,[{id:deckB,nome:'Deck Tipos B'}]);
    const kinds=['basic','basic_reversed','basic_optional_reversed','typing','cloze','image_occlusion'],types={};
    kinds.forEach(k=>types[k]=AnkiParity.stockNotetype(k,B));
    const onePx='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lS8AAAAASUVORK5CYII=';
    const fieldsFor=(kind,label)=>{
      if(kind==='cloze')return {Text:'SRC-'+label+' {{c1::TOKEN}}','Back Extra':'BACK-'+label};
      if(kind==='image_occlusion')return {
        Occlusion:'{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2}}<br>',
        Image:'<img src="'+onePx+'">',Header:'SRC-'+label,'Back Extra':'BACK-'+label,Comments:'C'
      };
      const x={Front:'SRC-'+label+' {{c1::TOKEN}}',Back:'BACK-'+label};
      if(kind==='basic_optional_reversed')x['Add Reverse']='1';
      return x;
    };
    const make=(kind,label)=>{
      const id=AnkiParity._allocId(),nt=types[kind],
        note=AnkiParity.saveNote({id,ankiId:id,guid:'audit-'+id,notetypeId:nt.id,fields:fieldsFor(kind,label),tags:[],_planId:B},B);
      AnkiProductParity.reconcileNote(note,nt);
      AnkiProductParity._cardsForNote(note,B).forEach(c=>DB.updateCard(c.id,{deckId:deckB}));
      return AnkiParity.getNote(id,B);
    };
    const liveFaces=(note)=>{
      CardsScreen._flipped=false;
      const cards=AnkiProductParity._cardsForNote(note,B),live=cards.filter(c=>!AnkiParity.isEmptyGeneratedCard(c));
      return {cards:cards.length,live:live.length,blank:live.filter(c=>String(CardsScreen.faceHtml(c)).includes('A frente deste cartão está em branco')).length};
    };
    const out={B,active,registrations:[],edits:{},matrix:[],advanced:null};

    // Cadastro real pelo modal simples: todos os tipos oferecidos nessa tela.
    const simpleCases=[
      ['basic',false],['basic_reversed',false],['basic_optional_reversed',false],
      ['basic_optional_reversed',true],['typing',false],['cloze',false]
    ];
    for(const [kind,reverse] of simpleCases){
      const b0=DB.getCardsForPlan(B).length,a0=DB.getCards().length;
      CardsScreen.openCardModal();
      document.getElementById('card-destino').value='deck:'+deckB;
      document.getElementById('card-kind').value=kind;CardsScreen.applyKindUI();
      document.getElementById('card-frente').innerHTML=kind==='cloze'?'CAD '+kind+' {{c1::X}}':'CAD '+kind;
      document.getElementById('card-verso').innerHTML='RESP '+kind;
      const rev=document.getElementById('card-add-reverse');if(rev)rev.checked=!!reverse;
      CardsScreen.saveCard(true);
      out.registrations.push({kind,reverse,deltaB:DB.getCardsForPlan(B).length-b0,deltaActive:DB.getCards().length-a0});
    }

    // Basic: cache renderizado não pode contaminar o editor; editar usa Front/Back crus.
    const nb=make('basic','EDIT-BASIC'),cb=AnkiProductParity._cardsForNote(nb,B)[0];
    CardsScreen.openCardModal(cb.id);
    out.edits.basicBefore={front:document.getElementById('card-frente').innerHTML,back:document.getElementById('card-verso').innerHTML};
    document.getElementById('card-frente').innerHTML='BASIC-NOVO';document.getElementById('card-verso').innerHTML='BASIC-BACK-NOVO';CardsScreen.saveCard(true);
    const nb2=AnkiParity.getNote(nb.id,B);out.edits.basic={fields:nb2.fields,face:liveFaces(nb2)};

    // Cloze: o editor precisa ler Text cru e preservar Back Extra invisível.
    const nc=make('cloze','EDIT-CLOZE'),cc=AnkiProductParity._cardsForNote(nc,B)[0];
    CardsScreen.openCardModal(cc.id);
    out.edits.clozeBefore=document.getElementById('card-frente').innerHTML;
    document.getElementById('card-frente').innerHTML='CLOZE-NOVO {{c1::NOVO}}';CardsScreen.saveCard(true);
    const nc2=AnkiParity.getNote(nc.id,B);out.edits.cloze={fields:nc2.fields,face:liveFaces(nc2)};

    // Tipos que obrigatoriamente editam os campos da Note canônica.
    for(const kind of ['basic_reversed','basic_optional_reversed','typing']){
      const note=make(kind,'EDIT-'+kind),card=AnkiProductParity._cardsForNote(note,B)[0];
      CardsScreen.openCardModal(card.id);
      const f=document.querySelector('#anki-note-edit-body .anki-note-field[data-field="Front"]'),
        bk=document.querySelector('#anki-note-edit-body .anki-note-field[data-field="Back"]');
      if(f)f.innerHTML='RICH-'+kind;if(bk)bk.innerHTML='RICH-BACK-'+kind;
      AnkiMaxEditor._saveRichNote();
      const after=AnkiParity.getNote(note.id,B);out.edits[kind]={fields:after.fields,face:liveFaces(after)};
    }

    // Tipo custom/importado também passa sempre pelo editor de campos.
    const customNt=AnkiParity.saveNotetype({id:AnkiParity._allocId(),name:'Custom audit',kind:'normal',
      fields:[{name:'Prompt'},{name:'Answer'}],templates:[{name:'Card 1',qfmt:'<b>{{Prompt}}</b>',afmt:'{{FrontSide}}<hr id=answer>{{Answer}}'}],css:'',_planId:B},B);
    const customId=AnkiParity._allocId(),custom=AnkiParity.saveNote({id:customId,notetypeId:customNt.id,fields:{Prompt:'CUSTOM-OLD',Answer:'A'},tags:[],_planId:B},B);
    AnkiProductParity.reconcileNote(custom,customNt);AnkiProductParity._cardsForNote(custom,B).forEach(c=>DB.updateCard(c.id,{deckId:deckB}));
    CardsScreen.openCardModal(AnkiProductParity._cardsForNote(custom,B)[0].id);
    const pf=document.querySelector('#anki-note-edit-body .anki-note-field[data-field="Prompt"]');if(pf)pf.innerHTML='CUSTOM-NEW';
    AnkiMaxEditor._saveRichNote();
    const customAfter=AnkiParity.getNote(customId,B);out.edits.custom={fields:customAfter.fields,face:liveFaces(customAfter)};

    // Image Occlusion: criação/edição dedicada, sem ler Note de outro plano.
    const nio=make('image_occlusion','EDIT-IO'),cio=AnkiProductParity._cardsForNote(nio,B)[0];
    CardsScreen.openCardModal(cio.id);
    AnkiImageOcclusion.state.imageData=onePx;
    document.getElementById('anki-io-header').value='IO-HEADER-NOVO';
    document.getElementById('anki-io-back').value='IO-BACK-NOVO';
    AnkiImageOcclusion.save();
    const nio2=AnkiParity.getNote(nio.id,B);out.edits.image_occlusion={fields:nio2.fields,face:liveFaces(nio2)};

    // Adição avançada: tipo pode vir do plano ativo, mas Note+NoteType precisam
    // ser materializados no plano do baralho escolhido.
    const activeNt=AnkiParity.saveNotetype({id:AnkiParity._allocId(),name:'Advanced active',kind:'normal',
      fields:[{name:'Q'},{name:'A'}],templates:[{name:'Card 1',qfmt:'{{Q}}',afmt:'{{FrontSide}}<hr id=answer>{{A}}'}],css:''});
    const beforeNotes=new Set(StudyGlobalScope._entityRows(B,'note').map(x=>String(x.id)));
    AnkiImageOcclusion.openAdvancedAdd();
    const tsel=document.getElementById('anki-advanced-type'),dsel=document.getElementById('anki-advanced-deck');
    tsel.value=String(activeNt.id);tsel.dispatchEvent(new Event('change',{bubbles:true}));
    dsel.value=deckB;
    const q=document.querySelector('#anki-advanced-fields .anki-advanced-field-max[data-field="Q"]'),
      a=document.querySelector('#anki-advanced-fields .anki-advanced-field-max[data-field="A"]');
    if(q)q.innerHTML='ADV-Q';if(a)a.innerHTML='ADV-A';
    AnkiMaxEditor._saveAdvancedRich();
    const newAdvanced=StudyGlobalScope._entityRows(B,'note').find(x=>!beforeNotes.has(String(x.id))&&String(x.notetypeId)===String(activeNt.id));
    out.advanced={created:!!newAdvanced,typeInB:!!AnkiParity.getNotetype(activeNt.id,B),noteInActive:newAdvanced?!!AnkiParity.getNote(newAdvanced.id,active):false,
      cards:newAdvanced?AnkiProductParity._cardsForNote(newAdvanced,B).length:0,selectedType:tsel.value,selectedDeck:dsel.value,
      notesB:StudyGlobalScope._entityRows(B,'note').map(x=>({id:String(x.id),nt:String(x.notetypeId)})),
      typesB:StudyGlobalScope._entityRows(B,'notetype').map(x=>String(x.id))};

    // 6x6: todas as mudanças de tipo. Conversão genérica PARA Image Occlusion
    // é deliberadamente bloqueada, exceto IO→IO; todas as demais devem persistir.
    for(const src of kinds)for(const dst of kinds){
      const note=make(src,'M-'+src+'-'+dst),before=String(note.notetypeId);
      AnkiProductParity.openChangeType([note]);
      const sel=document.getElementById('anki-change-type-target');sel.value=String(types[dst].id);sel.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('anki-change-type-save').click();
      const after=AnkiParity.getNote(note.id,B),blocked=dst==='image_occlusion'&&src!=='image_occlusion',
        face=liveFaces(after),typeExists=!!AnkiParity.getNotetype(after.notetypeId,B);
      out.matrix.push({src,dst,before,after:String(after.notetypeId),expected:String(types[dst].id),blocked,face,typeExists});
      document.getElementById('anki-change-type-modal').style.display='none';
    }
    return out;
  });

  ok(audit.registrations.every(x=>x.deltaB>0&&x.deltaActive===0),'todos os tipos do cadastro simples gravam no planejamento do baralho, nunca no ativo errado: '+JSON.stringify(audit.registrations));
  ok(audit.edits.basicBefore.front==='SRC-EDIT-BASIC {{c1::TOKEN}}'&&audit.edits.basicBefore.back==='BACK-EDIT-BASIC','Basic abre Front/Back canônicos crus, não cache/template renderizado');
  ok(audit.edits.basic.fields.Front==='BASIC-NOVO'&&audit.edits.basic.fields.Back==='BASIC-BACK-NOVO'&&audit.edits.basic.face.live>0&&audit.edits.basic.face.blank===0,'edição Basic sincroniza Note e reviewer sem frente vazia');
  ok(audit.edits.clozeBefore.includes('{{c1::TOKEN}}')&&audit.edits.cloze.fields.Text.includes('{{c1::NOVO}}')&&audit.edits.cloze.fields['Back Extra']==='BACK-EDIT-CLOZE'&&audit.edits.cloze.face.blank===0,'edição Cloze usa Text cru, preserva Back Extra e não gera leitura vazia');
  ok(['basic_reversed','basic_optional_reversed','typing'].every(k=>audit.edits[k].fields.Front==='RICH-'+k&&audit.edits[k].fields.Back==='RICH-BACK-'+k&&audit.edits[k].face.live>0&&audit.edits[k].face.blank===0),'invertido/opcional/typing editam a Note canônica e atualizam todos os cards');
  ok(audit.edits.custom.fields.Prompt==='CUSTOM-NEW'&&audit.edits.custom.face.live>0&&audit.edits.custom.face.blank===0,'tipo custom/importado edita campos canônicos sem cache desatualizado');
  ok(audit.edits.image_occlusion.fields.Header==='IO-HEADER-NOVO'&&audit.edits.image_occlusion.fields['Back Extra']==='IO-BACK-NOVO'&&audit.edits.image_occlusion.face.live>0&&audit.edits.image_occlusion.face.blank===0,'Image Occlusion edita a Note correta e mantém cards válidos');
  ok(audit.advanced.created&&audit.advanced.typeInB&&!audit.advanced.noteInActive&&audit.advanced.cards>0,'cadastro avançado copia o NoteType e grava a Note no planejamento do baralho: '+JSON.stringify(audit.advanced));
  const bad=audit.matrix.filter(x=>x.blocked?(x.after!==x.before):(x.after!==x.expected||!x.typeExists||x.face.live<1||x.face.blank>0));
  ok(bad.length===0,'matriz 6×6 de mudança de tipos sem referência vazia/desatualizada; bloqueios de IO respeitados: '+JSON.stringify(bad));

  /* 4) Uso real mobile: Mais ações e Set Due avançado precisam caber na tela,
        abrir por interação normal e produzir revlog Manual. */
  await page.setViewportSize({width:390,height:844});
  const mobile=await page.evaluate(()=>{
    StudyGlobalScope.setCardsScope('plan');StudyGlobalScope.installAnkiUsabilityParity();
    const d=DB.addDeck('UX mobile');
    const c=DB.addCard({deckId:d.id,frente:'UX frente',verso:'UX verso',kind:'basic',phase:'review',
      status:'sei',due:todayCards(),intervalo:12,reps:3,lapses:1,ease:2.5,s:12,d:5,ankiId:AnkiParity._allocId()});
    AnkiParity.ensureCanonicalNotes();
    CardsScreen.filters={materias:new Set(['deck:'+d.id])};CardsScreen.invalidateReviewQueue();CardsScreen.entrarFoco();
    return {id:c.id,pid:StudyGlobalScope.activePlanId()};
  });
  await esperar(300);
  ok(await page.locator('#anki-review-more').isVisible(),'Mais ações fica acessível no reviewer mobile');
  await page.click('#anki-review-more');await esperar(120);
  const reviewerMenu=await page.evaluate(()=>({
    values:[...document.getElementById('uip_action').options].map(o=>o.value),
    overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    box:document.querySelector('#ui-modal .cards-modal-box').getBoundingClientRect().toJSON()
  }));
  ok(['reset','due','copy','pauseMedia','backMedia','forwardMedia'].every(x=>reviewerMenu.values.includes(x)),
    'Mais ações expõe Reset, Set Due, Criar cópia e controles de áudio');
  ok(!reviewerMenu.overflow&&reviewerMenu.box.width<=390,'modal Mais ações não estoura a largura mobile');
  await page.click('#ui-modal-cancel');await esperar(80);

  await page.evaluate(({id,pid})=>StudyGlobalScope.bulkSetDueUi(['c:'+encodeURIComponent(pid)+'::'+encodeURIComponent(id)]),mobile);
  await esperar(100);
  await page.fill('#uip_spec','3-5!');
  await page.click('#ui-modal-ok');await esperar(180);
  const dueResult=await page.evaluate(({id})=>{
    const c=DB.getCard(id),logs=DB.getRevlog().filter(r=>String(r.cardId)===String(id));
    return {intervalo:c.intervalo,due:c.due,last:logs.at(-1),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
  },mobile);
  ok(dueResult.intervalo>=3&&dueResult.intervalo<=5,'Set Due mobile aplica faixa 3-5! no intervalo');
  ok(dueResult.last&&dueResult.last.grade===0&&dueResult.last.ankiReviewKind==='manual','Set Due mobile grava evento Manual rating 0');
  ok(!dueResult.overflow,'fluxo Set Due não cria overflow horizontal mobile');

  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`CARDS FOCO/EDIÇÃO OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
