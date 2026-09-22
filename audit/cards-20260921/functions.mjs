import fs from 'node:fs';import vm from 'node:vm';
const root=new URL('../../',import.meta.url),out=new URL('./',import.meta.url);let raw=new Map(),download;let n=0;
const elem={value:'',style:{},innerHTML:'',addEventListener:()=>{}};
const ctx={console,Date,Math,_quiet:()=>{},_sanCard:x=>String(x||''),todayCards:()=> '2026-09-21',todayLocal:()=> '2026-09-21',proximaViradaTs:()=>Date.now()+864e5,localStorage:{getItem:k=>raw.get(k)||null,setItem:(k,v)=>raw.set(k,v)},window:{},document:{getElementById:()=>elem,querySelectorAll:()=>[]},$id:()=>elem,showToast:()=>{}};vm.createContext(ctx);
for(const [file,name] of [['11-db.js','DB'],['30-fsrs.js','FSRS'],['31-cards-config.js','CardsConfig'],['32-card-engine.js','CardEngine'],['44-tela-cards.js','CardsScreen']])vm.runInContext(fs.readFileSync(new URL('src/js/'+file,root),'utf8')+'\nglobalThis.'+name+'='+name,ctx);
const {DB:D,CardsConfig:C,CardEngine:E,CardsScreen:S}=ctx;const data=new Map();D._get=(k,def)=>data.get(k)||def;D._set=(k,v)=>data.set(k,v);D.setRaw=(k,v)=>raw.set(k,v);D._uid=()=> 'id'+(++n);S.render=()=>{};S._download=(file,content)=>{download={file,content};};let tests=[];
const check=(name,pass,detail)=>tests.push({name,pass:!!pass,detail});
D.saveCards(Array.from({length:6000},(_,i)=>({id:'card'+i,frente:'F'+i,verso:'V'+i,phase:'review',s:30,d:5,reps:20,intervalo:30,due:'2026-10-01',lastReview:'2026-09-01',status:'sei',favorito:i%3===0,deckId:null})));
const total=180000;for(let i=0;i<total;i++)D.addRevlog({ts:i+1,cardId:'card'+i%6000,grade:3,date:'2026-09-21',elapsed:5});
check('Yearly history retained: 6000 cards x 30 answers',D.getRevlog().length===total,{written:total,retained:D.getRevlog().length,lost:total-D.getRevlog().length,firstRetained:D.getRevlog()[0].ts});
S.exportJson();let exported=JSON.parse(download.content);check('Card backup includes revlog',Array.isArray(exported.revlog),{keys:Object.keys(exported)});
D.saveCards([]);S._importParsed={kind:'json',cards:exported.cards,decks:[]};await S.doImport();let imported=D.getCards();check('Backup round trip preserves 6000 contents',imported.length===6000&&imported.every((c,i)=>c.frente==='F'+i&&c.verso==='V'+i),{cards:imported.length});
check('Backup round trip preserves learning state',imported.every(c=>c.phase==='review'&&c.s===30&&c.reps===20&&c.due==='2026-10-01'),{first:imported[0]});
const id=imported[0].id;C.markIntroduced('new',id);D.addRevlog({ts:180001,cardId:id,grade:3});D.deleteCard(id);check('Deletion cleans card log and daily counter',!D.getCard(id)&&!D.getRevlog().some(r=>r.cardId===id)&&C.newDoneToday()===0,{});
const c=imported[1];D.updateCard(c.id,{phase:'learning',dueTs:Date.now()+600000});D.buryCard(c.id);check('Bury removes card until tomorrow',!E.isDue(D.getCard(c.id)),{});D.unburyCard(c.id);check('Unbury preserves learning timestamp',D.getCard(c.id).dueTs!=null,{actual:D.getCard(c.id).dueTs});
D.updateCard(c.id,{suspenso:true});S.currentFilteredCards=()=>D.getCards();check('Suspended excluded from queue',!S.buildQueue().includes(c.id),{});
D.setFlag(c.id,3);check('Flag persists',D.getCard(c.id).flag===3,{});
D.forgetCard(c.id);check('Forget resets memory',D.getCard(c.id).s===null&&D.getCard(c.id).phase==='new',{});
const parsed=S.parseAnkiText('"front, with comma",back,tag');check('CSV quoted delimiter preserved',parsed[0]?.frente==='front, with comma'&&parsed[0]?.verso==='back',{actual:parsed});
const tsv=Array.from({length:6000},(_,i)=>'F'+i+'\tV'+i+'\ttag').join('\n');check('TSV 6000 rows parsed',S.parseAnkiText(tsv).length===6000,{});
D.saveCards([{id:'rich',frente:'<b>Bold</b><img src="image.png">',verso:'<audio src="a.mp3"></audio>',phase:'new'}]);S.exportAnki();check('Anki export preserves rich media',download.content.includes('image.png')&&download.content.includes('a.mp3'),{actual:download.content});
// Same-timestamp undo collision on production DB methods.
// O histórico deixou de morar num JSON único do localStorage: esvaziá-lo agora
// é DB.replaceRevlog([]), e não uma escrita direta na chave. A verificação em
// si não mudou — continua exigindo que o undo retire a revisão mais recente.
D.replaceRevlog([]);D.addRevlog({ts:1,cardId:'A'});D.addRevlog({ts:1,cardId:'B'});D.removeRevlog(1);check('Undo removes latest log when timestamps collide',D.getRevlog()[0]?.cardId==='A',{remaining:D.getRevlog()});
raw.set(D.ACTIVE_PROFILE_KEY,'alice');C.set({retention:.85});raw.set(D.ACTIVE_PROFILE_KEY,'bob');C.set({retention:.95});raw.set(D.ACTIVE_PROFILE_KEY,'alice');check('Profile config isolation',C.get().retention===.85,{actual:C.get().retention});
C.set({revPerDay:200,newPerDay:20,interdayMix:'misturar'});
D.saveCards([...Array.from({length:4},(_,i)=>({id:'review'+i,phase:'review',due:ctx.todayCards(),intervalo:10,s:10,d:5})),{id:'learn-now',phase:'learning',due:ctx.todayCards(),dueTs:Date.now()-1000}]);
check('Due intraday learning priority over four reviews',S.buildQueue()[0]==='learn-now',{actual:S.buildQueue()});
C.set({algo:'sm2'});const fresh={id:'sm2-phase',phase:'new',reps:0,intervalo:0,due:ctx.todayCards()};const updated={...fresh,...E.schedule(fresh,'facil')};check('SM2 Easy graduates phase out of new',updated.phase==='review',{actual:updated.phase,bucket:S._bucket(updated)});
fs.writeFileSync(new URL('functions.json',out),JSON.stringify({scope:'Production DB methods, config, imports/export; low-level storage and DOM doubled. No real network.',tests},null,2));console.log(JSON.stringify(tests,null,2));if(tests.some(t=>!t.pass))process.exitCode=1;
