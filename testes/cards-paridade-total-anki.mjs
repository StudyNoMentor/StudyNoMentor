#!/usr/bin/env node
import assert from 'node:assert/strict';
import { criarAmbiente } from '../audit/cards-20260921-v2/harness.mjs';

let checks=0;
const eq=(a,b,m)=>{checks++;assert.deepEqual(structuredClone(a),structuredClone(b),m);};
const ok=(v,m)=>{checks++;assert.ok(v,m);};
const A=criarAmbiente().reset();
const {DB,CardsConfig,CardEngine,CardsScreen,AnkiParity,FSRS}=A;

// ── Campos ricos: mídia sem texto continua sendo conteúdo válido ──────────
ok(CardEngine.hasContent('<img src="data:image/png;base64,AA==">'),'imagem sozinha deve contar como conteúdo');
ok(CardEngine.hasContent('<audio src="a.mp3"></audio>'),'áudio sozinho deve contar como conteúdo');
ok(CardEngine.hasContent('<svg viewBox="0 0 1 1"></svg>'),'SVG sozinho deve contar como conteúdo');
ok(CardEngine.hasContent('[sound:voz.mp3]'),'tag [sound:] deve contar como conteúdo');
ok(CardEngine.hasContent('<div style="background-image:url(img.png)"></div>'),'background visual deve contar como conteúdo');
eq(CardEngine.hasContent('<div><br></div>'),false,'HTML estrutural vazio não pode contar como conteúdo');
const telaSrc=A.source?A.source('src/js/44-tela-cards.js'):null;
if(telaSrc) ok(telaSrc.includes('CardEngine.hasContent(frente)')&&telaSrc.includes('CardEngine.hasContent(verso)'),'salvamento simples deve validar mídia, não só texto');

// ── Sessão do reviewer: cache de fila como Collection.state.card_queues ───
A.reset({newPerDay:99,revPerDay:99});
const rq1=DB.addCard({frente:'Q1',verso:'A1',phase:'new',due:A.hoje(),posicaoNova:1});
DB.addCard({frente:'Q2',verso:'A2',phase:'new',due:A.hoje(),posicaoNova:2});
const realBuild=CardsScreen.buildQueue.bind(CardsScreen);
let queueBuilds=0;
CardsScreen.buildQueue=()=>{queueBuilds++;return realBuild();};
CardsScreen._reviewQueue=[];CardsScreen._reviewIdx=0;
CardsScreen.renderRevisar({innerHTML:''});
eq(queueBuilds,1,'primeira entrada no reviewer constrói a fila');
eq(CardsScreen._reviewQueue[CardsScreen._reviewIdx],rq1.id,'primeiro card esperado fica no topo');
CardsScreen.renderRevisar({innerHTML:''});
eq(queueBuilds,1,'rerender com fila ativa não reconstrói CardQueues');
eq(CardsScreen._reviewQueue[CardsScreen._reviewIdx],rq1.id,'rerender preserva exatamente o card atual');
CardsScreen.invalidateReviewQueue();
CardsScreen.renderRevisar({innerHTML:''});
eq(queueBuilds,2,'invalidação explícita reconstrói a fila');
CardsScreen.buildQueue=realBuild;

// ── RNG oficial: rand_core seed_from_u64 + StdRng/ChaCha12 ────────────────
for(const [seed,a,b] of [
  [0n,0xCD2C6F7F,0xBB2A3FB2],
  [1n,0xD3301861,0xF9681A64],
  [1775264032847n,0xC1B92DED,0x1B785743],
  [0xFFFFFFFFFFFFFFFFn,0x2E3D5FB8,0x0FA79848],
]){
  const r=AnkiParity.rng(seed);
  eq(r.nextU32(),a,'StdRng primeiro u32 seed '+seed);
  eq(r.nextU32(),b,'StdRng segundo u32 seed '+seed);
}
eq(AnkiParity.randomRangeU32(AnkiParity.rng(0n),0,15),12,'Uniform<u32> Canon seed 0');
eq(AnkiParity.uniformF32(AnkiParity.rng(0n),0,1),0.8014591932296753,'Uniform<f32> seed 0');
eq(AnkiParity.uniformF32(AnkiParity.rng(12345n),0,10),5.326814651489258,'Uniform<f32> escala 10');
eq(AnkiParity.weightedIndex([1,1,1,1],999n),2,'WeightedIndex f32');
eq(AnkiParity.weightedIndex([0.001,0.001,1,0.001],42n),2,'WeightedIndex peso dominante');

// learning fuzz: range [0, 15) para um passo de 60s
const fuzzExpected=new Map([[0n,12],[1n,12],[1775264032847n,11],[0xFFFFFFFFFFFFFFFFn,2]]);
for(const [seed,off] of fuzzExpected){
  const card={ankiId:Number(seed<=BigInt(Number.MAX_SAFE_INTEGER)?seed:0n),id:Number(seed<=BigInt(Number.MAX_SAFE_INTEGER)?seed:0n),reps:0};
  if(seed===0xFFFFFFFFFFFFFFFFn){
    eq(AnkiParity.randomRangeU32(AnkiParity.rng(seed),0,15),off,'learning fuzz max-u64');
  }else{
    eq(AnkiParity.randomRangeU32(AnkiParity.rng(seed),0,15),off,'learning fuzz seed '+seed);
  }
}

// review fuzz: acima de 90d o Load Balancer cai no fuzz normal, não em round().
A.reset({loadBalance:true});
const cF={id:'f',ankiId:999,reps:0,deckId:null,phase:'review',due:A.hoje(),intervalo:100,s:100,d:5};
eq(FSRS.loadBalance(100,()=>0,36500,1,AnkiParity.fuzzSeed(cF),cF),
   FSRS.fuzzed(100,AnkiParity.fuzzSeed(cF),36500,1),
   'load balancing >90d deve cair no review fuzz');
eq(AnkiParity.loadBalance(10,36500,1,999n,cF),10,'load balancer: janela vazia + seed 999 escolhe centro');

// ── FNV-1a i64 usado pelo SQLite do Anki ─────────────────────────────────
const signed=AnkiParity.reviewTie({ankiId:123456789,ankiMod:1700000000});
ok(typeof signed==='bigint','fnvhash retorna BigInt');
ok(signed>=-(1n<<63n)&&signed<(1n<<63n),'fnvhash segue ordem signed i64 do SQLite');


// ── Ordem dos novos: mesmos hashes/salts do rslib, sem Math.random() ───────
const legacyReverse={ankiId:22,ankiNoteId:2,template:'reverse'};
const legacyForward={ankiId:11,ankiNoteId:1,template:'forward'};
eq(AnkiParity.stableNewSort([legacyReverse,legacyForward],'template').map(c=>c.ankiId),
   [11,22],'template ordinal ausente cai para forward=0/reverse=1, sem NaN');

A.reset({newPerDay:99,revPerDay:99,newGatherOrder:'posicao',newSortOrder:'randomCard'});
for(let i=0;i<8;i++) DB.addCard({frente:'N'+i,verso:'A'+i,phase:'new',due:A.hoje(),posicaoNova:i+1});
AnkiParity.ensureIdentities();
const novosOrdenacao=DB.getCards().filter(c=>(c.phase||'new')==='new');
const esperadoRandom=AnkiParity.stableNewSort(novosOrdenacao,'randomCard').map(c=>c.id);
const filaRandom1=CardsScreen.buildQueue();
const filaRandom2=CardsScreen.buildQueue();
eq(filaRandom1,esperadoRandom,'newSortOrder=randomCard usa o hash determinístico oficial');
eq(filaRandom2,filaRandom1,'reconstruir a fila preserva a ordem pseudoaleatória dos novos');

CardsConfig.set({newSortOrder:'aleatoria',newGatherOrder:'materiaRodizio'});
eq(CardsConfig.get().newSortOrder,'template','modo legado de sort volta ao default oficial');
eq(CardsConfig.get().newGatherOrder,'deck','modo legado de gather volta ao default oficial');

// ── Cloze oficial: ordinais, múltiplos, hints e aninhamento ───────────────
const strip=s=>String(s).replace(/<[^>]+>/g,'');
eq(Array.from(AnkiParity.clozeOrdinals('test')),[],'sem cloze');
eq(Array.from(AnkiParity.clozeOrdinals('{{c2::te}}{{c1::s}}t{{')),[1,2],'ordinais fora de ordem');
eq(Array.from(AnkiParity.clozeOrdinals('{{c0::te}}s{{c2::t}}s')),[2],'c0 não gera card');
eq(Array.from(AnkiParity.clozeOrdinals('{{c1,1,2::test}}')),[1,2],'ordinais múltiplos deduplicados');
eq(strip(AnkiParity.revealCloze('{{c1,2::shared}} word and {{c1::first}} vs {{c2::second}}',1,true)),
   '[...] word and [...] vs second','cloze múltiplo card 1 pergunta');
eq(strip(AnkiParity.revealCloze('{{c1,2::shared}} word and {{c1::first}} vs {{c2::second}}',2,true)),
   '[...] word and first vs [...]','cloze múltiplo card 2 pergunta');
eq(strip(AnkiParity.revealCloze('foo {{c1::bar::baz}}',1,true)),'foo [baz]','hint no cloze');
eq(strip(AnkiParity.revealCloze('foo {{c1::bar {{c2::baz}}::qux}}',2,true)),'foo bar [...]','cloze aninhado filho');
eq(strip(AnkiParity.revealCloze('foo {{c1::bar {{c2::baz}}::qux}}',1,true)),'foo [qux]','cloze aninhado pai');
eq(AnkiParity.clozeOnly('{{c1::foo}} {{c1::bar}}',1,false),'foo, bar','cloze only');
eq(AnkiParity.clozeOnly('foo {{c1::bar::baz}}',1,true),'baz','cloze only hint');

// Uma nota Cloze gera um card por ordinal, com agendamento independente.
A.reset();
const base=DB.addCard({kind:'cloze',frente:'A {{c1::um}} B {{c2::dois}}',verso:'',deckId:null});
AnkiParity.ensureIdentities();
eq(AnkiParity.syncClozeSiblings(base.id),2,'dois ordinais geram dois cards');
let sib=DB.getCards().filter(c=>String(c.noteId||c.id)===String(base.noteId||base.id));
eq(sib.length,2,'nota Cloze tem dois irmãos');
eq(sib.map(c=>c.clozeOrd).sort((a,b)=>a-b),[1,2],'irmãos preservam ordinal');
ok(new Set(sib.map(c=>c.ankiNoteId)).size===1,'irmãos compartilham ankiNoteId');
const c2=sib.find(c=>c.clozeOrd===2);
DB.updateCard(c2.id,{phase:'review',s:50,d:4,intervalo:50,reps:9});
DB.addRevlog({cardId:c2.id,ts:Date.now(),grade:3,phase:'review',intervalo:50});
DB.updateCardNote(base.id,{kind:'cloze',frente:'A {{c1::um}}',verso:'',deckId:null,materia:null,assunto:'',materiaTec:'',banca:''});
AnkiParity.syncClozeSiblings(base.id);
eq(DB.getCards().filter(c=>String(c.noteId||c.id)===String(base.noteId||base.id)).length,2,'remover ordinal mantém o card Cloze vazio até Empty Cards');
ok(AnkiParity.emptyCardIds().map(String).includes(String(c2.id)),'ordinal Cloze removido aparece em Empty Cards');
eq(DB.getRevlog().filter(r=>String(r.cardId)===String(c2.id)).length,1,'Empty Card preserva histórico antes da limpeza explícita');
eq(AnkiParity.deleteEmptyCards(),1,'Empty Cards remove somente o card que deixou de gerar pergunta');
eq(DB.getCards().filter(c=>String(c.noteId||c.id)===String(base.noteId||base.id)).length,1,'Empty Cards preserva o irmão Cloze ainda válido');
eq(DB.getRevlog().filter(r=>String(r.cardId)===String(c2.id)).length,0,'Empty Cards remove o revlog do card efetivamente excluído');

// ── Sibling bury/suspend ─────────────────────────────────────────────────
A.reset({buryNew:true,buryReviews:true,buryInterdayLearning:true});
const note='n';
const s1=DB.addCard({noteId:note,template:'forward',kind:'basic',frente:'Q',verso:'A'});
const s2=DB.addCard({noteId:note,template:'reverse',kind:'basic',frente:'A',verso:'Q'});
const buried=AnkiParity.autoBurySiblings(s1);
eq(Array.from(buried),[s2.id],'responder enterra irmão elegível');
ok(CardEngine.estaEnterrado(DB.getCard(s2.id)),'irmão enterrado sai da fila');
eq(DB.getCard(s2.id).buryKind,'scheduler','auto-bury de irmão preserva SchedBuried');
DB.buryCard(s1.id);
eq(DB.getCard(s1.id).buryKind,'user','enterro explícito preserva UserBuried');

// Anki atual possui sete bandeiras; a barra compacta pode mostrar menos sem perder o estado.
DB.setFlag(s1.id,7);
eq(DB.getCard(s1.id).flag,7,'bandeira 7 precisa ser persistida');
eq(DB.FLAGS[7].nome,'Roxa','metadados das sete bandeiras devem existir');
DB.setFlag(s1.id,0);
eq(DB.getCard(s1.id).flag,0,'flag 0 remove a bandeira');
DB.unburyCard(s1.id);
ok(!DB.getCard(s1.id).buryKind,'desenterrar limpa origem do bury');
AnkiParity.suspendCard(s2.id);
ok(DB.getCard(s2.id).suspenso,'suspender ativa suspensão');
ok(!DB.getCard(s2.id).enterradoAte,'suspender remove bury como no Anki');
ok(!DB.getCard(s2.id).buryKind,'suspender limpa tipo de bury');

// ── Identidade Anki paralela e presets compartilhados ────────────────────
A.reset();
DB.saveDecks([{id:'d1',nome:'Fiscal::Tributário',createdAt:new Date().toISOString()},{id:'d2',nome:'Fiscal::Contabilidade',createdAt:new Date().toISOString()}]);
const x=DB.addCard({deckId:'d1',frente:'x',verso:'y'});
AnkiParity.ensureIdentities();
ok(Number.isSafeInteger(DB.getCard(x.id).ankiId),'card recebe ankiId numérico');
ok(Number.isSafeInteger(DB.getCard(x.id).ankiNoteId),'nota recebe ankiNoteId numérico');
const pid=AnkiParity.createPreset('Fiscal',{retention:.93,newPerDay:11,revPerDay:111});
AnkiParity.assignPreset('d1',pid);AnkiParity.assignPreset('d2',pid);
eq(CardsConfig.forDeck('d1').retention,.93,'preset compartilhado deck 1');
eq(CardsConfig.forDeck('d2').newPerDay,11,'preset compartilhado deck 2');
eq(Array.from(AnkiParity.deckAncestors('d1'),d=>d.nome),[],'pai ausente não é inventado');
DB.saveDecks([{id:'p',nome:'Fiscal',createdAt:new Date().toISOString()},...DB.getDecks()]);
eq(Array.from(AnkiParity.deckAncestors('d1'),d=>d.nome),['Fiscal'],'hierarquia :: encontra pai real');


// ── Escopo e busca do otimizador oficial FSRS ────────────────────────────
A.reset();
DB.saveDecks([
  {id:'root',nome:'Fiscal',createdAt:new Date().toISOString()},
  {id:'child',nome:'Fiscal::Tributário',createdAt:new Date().toISOString()},
  {id:'other',nome:'Outra',createdAt:new Date().toISOString()}
]);
const tr1=DB.addCard({deckId:'child',materia:'Direito Tributário',assunto:'ICMS',tipo:'lei',banca:'FCC',frente:'Q1',verso:'A1'});
const tr2=DB.addCard({deckId:'child',materia:'Contabilidade',assunto:'Estoques',tipo:'conceito',frente:'Q2',verso:'A2'});
DB.updateCard(tr2.id,{suspenso:true});
DB.addCard({deckId:'other',materia:'Direito Tributário',assunto:'ICMS',tipo:'lei',frente:'Q3',verso:'A3'});
eq(FSRS.trainingCardsForScope('root',{paramSearch:'materia:"Direito Tributário" -suspenso'}).map(c=>c.id),
   [tr1.id],'otimizador respeita deck+filhos e param_search documentado');
ok(AnkiParity.filteredSearchMatches(DB.getCard(tr1.id),'assunto:ICMS tipo:lei banca:FCC'),
   'param_search aceita assunto/tipo/banca');
ok(!AnkiParity.filteredSearchMatches(DB.getCard(tr2.id),'-suspenso'),
   'param_search negativo exclui suspensos');
ok(typeof CardsScreen.optimizeFsrsOfficial==='function','UI expõe otimizador oficial FSRS');
CardsScreen._reviewStartedAt=1000;CardsScreen._answerShownAt=2500;
eq(CardsScreen._reviewElapsedMs({stopTimerOnAnswer:true,capAnswerTimeToSecs:60}),1500,'timer para ao revelar resposta quando configurado');
CardsScreen._reviewStartedAt=A.agora()-5000;CardsScreen._answerShownAt=null;
eq(CardsScreen._reviewElapsedMs({stopTimerOnAnswer:false,capAnswerTimeToSecs:1}),1000,'tempo do revlog respeita o teto do preset');

// ── Limites hierárquicos: pai/filhos + novos consomem review ──────────────
A.reset({newPerDay:99,revPerDay:99,newCardsIgnoreReviewLimit:false,applyAllParentLimits:false});
DB.saveDecks([
  {id:'lp',nome:'Fiscal',createdAt:new Date().toISOString()},
  {id:'lc1',nome:'Fiscal::Tributário',createdAt:new Date().toISOString()},
  {id:'lc2',nome:'Fiscal::Contabilidade',createdAt:new Date().toISOString()}
]);
const pp=AnkiParity.createPreset('pai',{newPerDay:1,revPerDay:1});
const pc=AnkiParity.createPreset('filhos',{newPerDay:10,revPerDay:10});
AnkiParity.assignPreset('lp',pp);AnkiParity.assignPreset('lc1',pc);AnkiParity.assignPreset('lc2',pc);
const ln1=DB.addCard({deckId:'lc1',frente:'n1',verso:'a1',phase:'new',due:A.hoje()});
const ln2=DB.addCard({deckId:'lc2',frente:'n2',verso:'a2',phase:'new',due:A.hoje()});
CardsScreen.filters.materias=new Set(['deck:lp']);
let q=CardsScreen.buildQueue();
eq(q.length,1,'estudar o pai: limite de 1 novo vale para a soma dos filhos');

// O novo aceito consumiu também a única vaga de review do pai.
const lr=DB.addCard({deckId:'lc1',frente:'r',verso:'a',phase:'review',due:A.hoje(),intervalo:5,reps:2,s:5,d:5});
q=CardsScreen.buildQueue();
ok(!q.includes(lr.id),'novo consome o limite de review quando ignore-review-limit=false');

// Ao estudar DIRETAMENTE o filho, pais ficam fora por padrão.
A.reset({newPerDay:99,revPerDay:99,newCardsIgnoreReviewLimit:true,applyAllParentLimits:false});
DB.saveDecks([
  {id:'lp',nome:'Fiscal',createdAt:new Date().toISOString()},
  {id:'lc1',nome:'Fiscal::Tributário',createdAt:new Date().toISOString()}
]);
const pp0=AnkiParity.createPreset('pai-zero',{newPerDay:0,revPerDay:0});
const pc9=AnkiParity.createPreset('filho-aberto',{newPerDay:9,revPerDay:9});
AnkiParity.assignPreset('lp',pp0);AnkiParity.assignPreset('lc1',pc9);
const direct=DB.addCard({deckId:'lc1',frente:'direto',verso:'ok',phase:'new',due:A.hoje()});
CardsScreen.filters.materias=new Set(['deck:lc1']);
q=CardsScreen.buildQueue();
ok(q.includes(direct.id),'filho direto ignora limite do pai por padrão');

// Com applyAllParentLimits, o mesmo pai zero bloqueia o filho.
CardsConfig.set({applyAllParentLimits:true,newCardsIgnoreReviewLimit:true});
q=CardsScreen.buildQueue();
ok(!q.includes(direct.id),'applyAllParentLimits inclui o pai ao estudar o filho');

// Custom Study: aumentar limite é Today Only, não mutação permanente do preset.
A.reset({newPerDay:5,revPerDay:7});
DB.saveDecks([{id:'today',nome:'Today',createdAt:new Date().toISOString()}]);
eq(AnkiParity.customStudy({deckId:'today',kind:'newLimitDelta',delta:3}).limit,8,'Custom Study aumenta o limite atual');
eq(CardsConfig.currentLimitForDeck('today','new'),8,'Today Only entra no limite efetivo de hoje');
eq(CardsConfig.forDeck('today').newPerDay,5,'Today Only não altera o preset permanente');
let dayState=CardsConfig._daily();dayState.date=CardEngine.addDays(A.hoje(),-1);CardsConfig._saveDaily(dayState);
eq(CardsConfig.currentLimitForDeck('today','new'),5,'Today Only expira automaticamente na virada do dia');

// ── Filtered Decks / Custom Study (Anki 26.09.2) ───────────────────────────
A.reset({newPerDay:0,revPerDay:0});
DB.saveDecks([{id:'home',nome:'Fiscal',createdAt:new Date().toISOString()}]);
const fn=DB.addCard({deckId:'home',frente:'novo',verso:'n',phase:'new',due:A.hoje(),createdAt:new Date().toISOString()});
const fr=DB.addCard({deckId:'home',frente:'review',verso:'r'});
DB.updateCard(fr.id,{phase:'review',due:CardEngine.addDays(A.hoje(),2),intervalo:10,reps:3,s:10,d:5});
const oldDue=DB.getCard(fr.id).due;
let cs=AnkiParity.customStudy({deckId:'home',kind:'ahead',days:3});
ok(cs.ok,'Custom Study review-ahead cria baralho filtrado');
eq(cs.count,1,'review-ahead seleciona apenas review nos próximos N dias');
let moved=DB.getCard(fr.id);
eq(moved.originalDeckId,'home','card filtrado preserva home deck');
eq(moved.originalDue,oldDue,'card filtrado preserva due original');
eq(moved.deckId,cs.deck.id,'card entra no deck filtrado');
CardsScreen.filters.materias=new Set(['deck:'+cs.deck.id]);
// O harness de longo prazo substitui currentFilteredCards() por "todos" para
// simular milhares de cards sem DOM. Aqui precisamos preservar o recorte que a
// tela real faria antes de chamar buildQueue().
CardsScreen.currentFilteredCards=()=>DB.getCards().filter(c=>String(c.deckId)===String(cs.deck.id));
q=CardsScreen.buildQueue();
eq(q,[fr.id],'filtered deck ignora limites diários normais já aplicados na construção');

const scheduled=CardEngine.schedule(moved,'bom');
const returned=AnkiParity.removeFromFilteredAfterReschedule(moved,scheduled);
eq(returned.deckId,'home','rescheduling filtered answer retorna ao home deck');
ok(returned.originalDeckId==null,'rescheduling limpa originalDeckId depois da resposta');
ok(returned.due!==oldDue,'rescheduling mantém o NOVO agendamento, não restaura o due antigo');

// Preview: não altera memória/reps e Good devolve estado original.
AnkiParity.emptyFilteredDeck(cs.deck.id);
const pv=AnkiParity.saveFilteredDeck({nome:'Preview',config:{
  reschedule:false,searchTerms:[{search:'deck:"Fiscal" is:new',limit:10,order:5}],
  previewAgainSecs:60,previewHardSecs:600,previewGoodSecs:0
},allowEmpty:false});
ok(pv.ok,'filtered preview é construído');
let pcard=DB.getCard(fn.id), repsBefore=pcard.reps||0, homeDue=pcard.originalDue;
const againPreview=AnkiParity.previewFilteredAnswer(pcard,'errei');
ok(againPreview._filteredPreview&&!againPreview._filteredFinished,'Again em preview repete');
ok(againPreview.dueTs>A.agora(),'Again em preview agenda atraso em segundos');
eq(pcard.reps||0,repsBefore,'preview não incrementa reps');
const goodPreview=AnkiParity.previewFilteredAnswer(pcard,'bom');
ok(goodPreview._filteredFinished,'Good com atraso 0 encerra preview');
eq(goodPreview.deckId,'home','preview concluído volta ao home deck');
eq(goodPreview.due,homeDue,'preview concluído restaura due original');

// Busca dos filtered decks: operadores oficiais que já possuem dados locais.
AnkiParity.emptyFilteredDeck(pv.deck.id);
const searchCard=DB.getCard(fn.id);
DB.updateCard(searchCard.id,{flag:3,phase:'review',intervalo:12,reps:4,lapses:2,ease:2.4,s:15,d:6,posicaoNova:9,firstReviewAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
AnkiParity.ensureIdentities();AnkiParity.ensureCanonicalNotes();
const sc=DB.getCard(searchCard.id),sn=AnkiParity.getNote(AnkiParity.noteId(sc));
ok(AnkiParity.filteredSearchMatches(sc,'note:Basic'),'search note: resolve tipo de nota');
ok(AnkiParity.filteredSearchMatches(sc,'card:1'),'search card: aceita ordinal');
ok(AnkiParity.filteredSearchMatches(sc,'flag:3'),'search flag: usa bandeira');
ok(AnkiParity.filteredSearchMatches(sc,'nid:'+String(sc.ankiNoteId||sc.noteId)),'search nid: usa identidade Anki');
ok(AnkiParity.filteredSearchMatches(sc,'cid:'+String(sc.ankiId||sc.id)),'search cid: usa identidade Anki');
ok(AnkiParity.filteredSearchMatches(sc,'prop:ivl>=12 prop:reps=4 prop:lapses=2 prop:s>10 prop:d>=6'),'search prop: cobre estado do scheduler');
ok(AnkiParity.filteredSearchMatches(sc,'introduced:1 edited:1'),'search introduced:/edited: usa timestamps persistidos');
ok(AnkiParity.filteredSearchMatches(sc,'re:novo'),'search re: aplica regex ao conteúdo');
ok(sn&&AnkiParity.filteredSearchMatches(sc,'Front:novo'),'campo arbitrário do Note Type pode ser pesquisado');

// Dois termos, ordem e exclusão de suspensos/buried.
AnkiParity.emptyFilteredDeck(pv.deck.id);
DB.updateCard(fn.id,{suspenso:true});
const fd=AnkiParity.saveFilteredDeck({nome:'Dois filtros',config:{
  reschedule:true,
  searchTerms:[
    {search:'deck:"Fiscal" is:new',limit:10,order:5},
    {search:'deck:"Fiscal" -is:new',limit:10,order:6}
  ]
},allowEmpty:true});
eq(fd.count,1,'filtered deck exclui suspensos e combina até dois termos sem duplicar');
eq(DB.getCard(fr.id).deckId,fd.deck.id,'segundo termo captura review elegível');
DB.updateCard(fn.id,{suspenso:false});

// ── Conversão oficial do revlog para FSRSItem ─────────────────────────────
const NEXT_DAY_AT=86400*1000; // segundos; mesmo valor do teste do rslib
const ago=(days)=>(NEXT_DAY_AT-days*86400)*1000;

// Vetor oficial: [L-15, L-13, R-10, R-5] vira três prefixos,
// com delta_t [0,2], [0,2,3], [0,2,3,5].
let td=AnkiParity.fsrsTrainingData([
  {cardId:'tc1',ts:ago(15),grade:3,phase:'learning',intervalo:0},
  {cardId:'tc1',ts:ago(13),grade:3,phase:'learning',intervalo:0},
  {cardId:'tc1',ts:ago(10),grade:3,phase:'review',intervalo:3},
  {cardId:'tc1',ts:ago(5),grade:3,phase:'review',intervalo:5},
],{cards:[{id:'tc1',ankiId:101}],nextDayAtSec:NEXT_DAY_AT});
eq(td.items.map(x=>x.reviews.map(r=>r.delta_t)),[[0,2],[0,2,3],[0,2,3,5]],'FSRS treino replica prefixos/delta_t do rslib');
eq(td.cardIds,[101,101,101],'card_ids ficam alinhados aos prefixos');
eq(td.reviewCount,4,'review_count conta revlogs filtrados do card');

td=AnkiParity.fsrsTrainingData([
  {cardId:'ta',ts:ago(10),grade:3,phase:'learning',intervalo:0},
  {cardId:'ta',ts:ago(7),grade:3,phase:'review',intervalo:3},
  {cardId:'ta',ts:ago(1),grade:3,phase:'review',intervalo:6},
  {cardId:'tb',ts:ago(9),grade:3,phase:'learning',intervalo:0},
  {cardId:'tb',ts:ago(8),grade:3,phase:'review',intervalo:1},
],{cards:[{id:'ta',ankiId:1},{id:'tb',ankiId:2}],nextDayAtSec:NEXT_DAY_AT});
eq(td.cardIds,[2,1,1],'prefixos globais são ordenados por RevlogId como no Anki');
eq(td.reviewCount,5,'review_count oficial soma os históricos aproveitados');

// Histórico sem learning não entra no treino.
td=AnkiParity.fsrsTrainingData([
  {cardId:'tr',ts:ago(4),grade:3,phase:'review',intervalo:10},
  {cardId:'tr',ts:ago(1),grade:3,phase:'review',intervalo:3},
],{cards:[{id:'tr',ankiId:303}],nextDayAtSec:NEXT_DAY_AT});
eq(td.items.length,0,'card sem learning é excluído do treino oficial');

// ── Note types / Notes / Fields / Templates ───────────────────────────────
A.reset();
const nb=DB.addCard({frente:'Frente',verso:'Verso',kind:'basic'});
const nr1=DB.addCard({noteId:'rev-note',template:'forward',kind:'basic',frente:'Q',verso:'A'});
const nr2=DB.addCard({noteId:'rev-note',template:'reverse',kind:'basic',frente:'A',verso:'Q',reversedOf:nr1.id});
const nc=DB.addCard({noteId:'cl-note',kind:'cloze',template:'cloze:1',clozeOrd:1,frente:'Lei {{c1::seca}}',verso:'extra'});
AnkiParity.ensureIdentities();
const norm=AnkiParity.ensureCanonicalNotes();
eq(norm.notes,3,'três notas lógicas geram três entidades Note');
const bcard=DB.getCard(nb.id), bnote=AnkiParity.getNote(bcard.ankiNoteId), bnt=AnkiParity.getNotetype(bcard.notetypeId);
eq(bnote.fields,{Front:'Frente',Back:'Verso'},'Basic migra Front/Back para a Note');
eq(bnt.stockKind,'basic','Basic aponta para stock notetype Basic');
eq(bnt.templates[0].qfmt,'{{Front}}','template Basic preserva qfmt oficial');
eq(bnt.templates[0].afmt,'{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}','template Basic preserva afmt oficial');

const rs=DB.getCards().filter(x=>String(x.noteId)==='rev-note');
ok(rs.every(x=>x.ankiNoteId===rs[0].ankiNoteId),'irmãos forward/reverse compartilham Note');
const rnote=AnkiParity.getNote(rs[0].ankiNoteId), rnt=AnkiParity.getNotetype(rs[0].notetypeId);
eq(rnote.fields,{Front:'Q',Back:'A'},'nota reversa guarda conteúdo uma única vez');
eq(rnt.stockKind,'basic_reversed','nota reversa usa note type de dois templates');
const optNt=AnkiParity.stockNotetype('basic_optional_reversed');
eq(optNt.fields.map(f=>f.name),['Front','Back','Add Reverse'],'Optional Reversed tem os três campos oficiais');
const optNote=AnkiParity.saveNote({id:AnkiParity._allocId(),notetypeId:optNt.id,fields:{Front:'F',Back:'B','Add Reverse':'y'},tags:[]});
eq(strip(AnkiParity.renderTemplate(optNt,optNote,1,'question',{ankiTemplateOrd:1},'')),'B','Optional Reversed gera verso quando Add Reverse está preenchido');
const optOff=AnkiParity.saveNote({id:AnkiParity._allocId(),notetypeId:optNt.id,fields:{Front:'F',Back:'B','Add Reverse':''},tags:[]});
eq(strip(AnkiParity.renderTemplate(optNt,optOff,1,'question',{ankiTemplateOrd:1},'')),'','Optional Reversed omite o segundo card quando Add Reverse está vazio');
eq(rs.map(x=>x.ankiTemplateOrd).sort((a,b)=>a-b),[0,1],'cards irmãos apontam para ordinais 0/1');

const cc=DB.getCards().find(x=>String(x.noteId)==='cl-note'), cnote=AnkiParity.getNote(cc.ankiNoteId), cnt=AnkiParity.getNotetype(cc.notetypeId);
eq(cnote.fields,{Text:'Lei {{c1::seca}}','Back Extra':'extra'},'Cloze migra Text/Back Extra para a Note');
eq(cnt.stockKind,'cloze','Cloze usa note type Cloze');
eq(cnt.templates[0].qfmt,'{{cloze:Text}}','template Cloze usa filtro cloze');
eq(strip(AnkiParity.renderTemplate(cnt,cnote,0,'question',cc,'')),'Lei [...]','renderer usa ordinal do card Cloze');
ok(strip(AnkiParity.renderTemplate(cnt,cnote,0,'answer',cc,'')).includes('Lei seca'),'renderer de resposta revela Cloze');

const custom=AnkiParity.saveNotetype({
  id:AnkiParity._allocId(),name:'Fiscal custom',kind:'normal',
  fields:[{name:'Pergunta'},{name:'Resposta'},{name:'Obs'}],
  templates:[{name:'Card 1',qfmt:'{{Pergunta}}{{#Obs}} — {{Obs}}{{/Obs}}',afmt:'{{FrontSide}}<hr>{{Resposta}}{{^Obs}} sem obs{{/Obs}}'}]
});
const filterNt=AnkiParity.saveNotetype({
  id:AnkiParity._allocId(),name:'Filtros',kind:'normal',
  fields:[{name:'Reading'},{name:'Text'}],
  templates:[{name:'Card 1',
    qfmt:'{{kana:Reading}}|{{kanji:Reading}}|{{furigana:Reading}}|{{type:Text}}|{{tts en_US voices=Bob,Jane:Text}}|{{CardID}}',
    afmt:'{{Text}}'}]
});
const filterNote=AnkiParity.saveNote({id:AnkiParity._allocId(),notetypeId:filterNt.id,fields:{Reading:'東京[とうきょう] test[sound:x.mp3]',Text:'hello'},tags:[]});
const filterCard={id:'local-filter',ankiId:424242,deckId:null,ankiTemplateOrd:0};
const renderedFilters=AnkiParity.renderTemplate(filterNt,filterNote,0,'question',filterCard,'');
ok(renderedFilters.includes('とうきょう'),'filtro kana extrai leitura');
ok(renderedFilters.includes('東京'),'filtro kanji preserva ideograma');
ok(renderedFilters.includes('<ruby><rb>東京</rb><rt>とうきょう</rt></ruby>'),'filtro furigana gera ruby do Anki');
ok(renderedFilters.includes('test[sound:x.mp3]'),'filtros japoneses não desmontam sound tag');
ok(renderedFilters.includes('[[type:Text]]'),'filtro type usa marcador nativo do Anki');
ok(renderedFilters.includes('[anki:tts lang=en_US voices=Bob,Jane]hello[/anki:tts]'),'filtro TTS preserva opções/capitalização');
ok(renderedFilters.endsWith('424242'),'campo especial CardID é renderizado');

const clozeTypeNt=AnkiParity.saveNotetype({
  id:AnkiParity._allocId(),name:'Cloze type',kind:'cloze',
  fields:[{name:'Text'}],templates:[{name:'Cloze',qfmt:'{{type:cloze:Text}}',afmt:'{{cloze:Text}}'}]
});
const clozeTypeNote=AnkiParity.saveNote({id:AnkiParity._allocId(),notetypeId:clozeTypeNt.id,fields:{Text:'{{c1::um}}'},tags:[]});
eq(AnkiParity.renderTemplate(clozeTypeNt,clozeTypeNote,0,'question',{clozeOrd:1},''),'[[type:cloze:Text]]','type:cloze usa marcador oficial');

const cn=AnkiParity.saveNote({id:AnkiParity._allocId(),notetypeId:custom.id,fields:{Pergunta:'P?',Resposta:'R!',Obs:'X'},tags:['fiscal']});
eq(strip(AnkiParity.renderTemplate(custom,cn,0,'question',{},'')),'P? — X','template custom resolve campo + condicional');
const qside=AnkiParity.renderTemplate(custom,cn,0,'question',{},'');
eq(strip(AnkiParity.renderTemplate(custom,cn,0,'answer',{},qside)),'P? — XR!','FrontSide entra na resposta e inversa vazia não entra');

assert.throws(()=>FSRS.optimize([],{}),/Otimizador legado desativado/,'rota antiga do otimizador não pode voltar a ser usada');
ok(typeof FSRS.optimizeOfficial==='function','otimizador oficial fsrs-rs deve permanecer disponível');

console.log('PARIDADE TOTAL ANKI: '+checks+'/'+checks+' contratos de RNG/Cloze/LB/irmãos/presets/limites/filtered/custom-study/treino-FSRS/notas válidos.');
