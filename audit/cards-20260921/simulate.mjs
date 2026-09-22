import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const R=createRequire(import.meta.url)('../../testes/referencia-anki.js');
const output=new URL('./',import.meta.url);
const root=new URL('../../',import.meta.url);
let now=Date.parse('2025-01-01T12:00:00Z'),seed=9212026;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const math=Object.create(Math); math.random=random;
class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
const today=()=>new Date(now-4*3600e3).toISOString().slice(0,10);
let cards=[],logs=[];const storage=new Map();
const DB={_profilePrefix:()=> 'audit:',setRaw:(k,v)=>storage.set(k,v),getCards:()=>cards,getCard:id=>cards.find(c=>c.id===id),getDecks:()=>[],getRevlog:()=>logs,updateCard:(id,p)=>Object.assign(DB.getCard(id),p),addRevlog:r=>logs.push(r),async addRevlogDurable(r){const row={...r,reviewId:'sim-'+(logs.length+1),_position:logs.length+1};logs.push(row);return row;},async cancelarRevlogDurable(row){logs=logs.filter(r=>r.reviewId!==row.reviewId);return true;},kickRevlogDuravel:()=>{},removeRevlog:ts=>{logs=logs.filter(r=>r.ts!==ts);}};
const ctx={console,Math:math,Date:Clock,window:{},_quiet:()=>{},todayCards:today,proximaViradaTs:()=>Date.parse(today()+'T04:00:00Z')+864e5,DB,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},showToast:()=>{},document:{getElementById:()=>({innerHTML:'',addEventListener:()=>{}})},clearTimeout:()=>{},setTimeout:()=>0};
vm.createContext(ctx);
for(const [file,name] of [['30-fsrs.js','FSRS'],['31-cards-config.js','CardsConfig'],['32-card-engine.js','CardEngine'],['44-tela-cards.js','CardsScreen']]) vm.runInContext(fs.readFileSync(new URL('src/js/'+file,root),'utf8')+'\n;globalThis.'+name+'='+name+';',ctx);
const {FSRS:F,CardsConfig:C,CardEngine:E,CardsScreen:S}=ctx;
const reset=(cfg={})=>{storage.clear();C._c=null;C._cKey=null;C._presets=null;C._presetsKey=null;C.set({...C.DEFAULTS,loadBalance:false,...cfg});E.invalidateDueCache();S.filters={};S.currentFilteredCards=()=>cards;};
const checks=[];const check=(name,ok,detail)=>checks.push({name,pass:!!ok,detail});
reset();
// Characterization tests deliberately FAIL on divergences. No product changes.
cards=[{id:'new',phase:'new',reps:0,due:today()}];C.set({algo:'sm2'});
for(const [g,secs] of [['errei',60],['dificil',330],['bom',600]]){let p=E.schedule(cards[0],g);check('SM2 new '+g+' learning step',p._kind==='min'&&p._val*60===secs,p);}
let p=E.schedule(cards[0],'facil');check('SM2 new Easy keeps initial ease',p.ease===2.5,{actual:p.ease,expected:2.5});
reset({relearnSteps:[]});check('Empty relearning steps preserved',C.get().relearnSteps.length===0,{actual:C.get().relearnSteps});
reset({revPerDay:0});check('Review limit zero blocks new by default',S.buildQueue().length===0,{actual:S.buildQueue()});
reset({revPerDay:1});cards=Array.from({length:10},(_,i)=>({id:'l'+i,phase:'learning',due:today(),dueTs:null}));check('Interday learning obeys review limit',S.buildQueue().length<=1,{actual:S.buildQueue().length});
reset();cards=[{id:'buried',phase:'learning',due:today(),dueTs:now+600e3,enterradoAte:E.addDays(today(),1)}];check('Learn ahead excludes buried cards',S._learnAheadQueue().length===0,{actual:S._learnAheadQueue()});
reset({newPerDay:20});C.setDeckPreset('tiny',{newPerDay:1});cards=Array.from({length:20},(_,i)=>({id:'n'+i,deckId:'tiny',phase:'new',due:today()}));check('Deck new limit respected',S.buildQueue().length===1,{actual:S.buildQueue().length});
reset();cards=[{id:'rv',phase:'review',due:today(),s:10,d:5,intervalo:10,lastReview:E.addDays(today(),-10)},{id:'lr',phase:'learning',due:today(),dueTs:now-1000}];check('Due intraday learning precedes review',S.buildQueue()[0]==='lr',{actual:S.buildQueue()});
reset();const initial={id:'undo',phase:'review',reps:9,lapses:7,s:10,d:5,intervalo:10,lastReview:E.addDays(today(),-10),due:today(),suspenso:false};cards=[{...initial}];logs=[];S._reviewQueue=['undo'];S._reviewIdx=0;S._undoStack=[];S._seenThisSession=new Set();S.renderReviewCard=()=>{};S.atualizarFoco=()=>{};S.updateFavCount=()=>{};S._skipNotDue=()=>{};
await S.answer('errei');S.undoAnswer();check('Undo restores scheduling fields and daily counts',Object.keys(initial).every(k=>cards[0][k]===initial[k])&&logs.length===0&&C.revDoneToday()===0,{card:cards[0],logs:logs.length,revDone:C.revDoneToday()});
check('Cloze hints are rendered as hints',E.clozeRender('{{c1::Paris::capital}}',false).includes('capital'),{actual:E.clozeRender('{{c1::Paris::capital}}',false)});
// Simulation: real engine + real queue + real config; storage and clock are doubles.
const scenarios=[];const vectors=[];
for(const [name,algo,retention,loadBalance] of [['fsrs-default','fsrs',.9,false],['fsrs-balance-95','fsrs',.95,true],['sm2','sm2',.9,false]]){
 now=Date.parse('2025-01-01T12:00:00Z');reset({algo,retention,loadBalance,newPerDay:30,revPerDay:300});logs=[];
 cards=Array.from({length:6000},(_,i)=>({id:String(100000+i),phase:'new',reps:0,lapses:0,due:today(),posicaoNova:i,status:'pendente',frente:'Question '+i,verso:'Answer '+i}));
 const memories=new Map();let answers=0,invalid=0,memoryMismatch=0,previewMismatch=0,maxS=0,activeDays=0,distinct=new Set(),maxDaily=0;const days=[];
 const started=performance.now();
 for(let day=0;day<365;day++){
  const start=Date.parse('2025-01-01T12:00:00Z')+day*864e5;now=start;
  if((day>=80&&day<94)||(day>=200&&day<221)) {days.push({day,answers:0,absence:true});continue;}
  activeDays++;E.invalidateDueCache();let daily=0;let queue=S.buildQueue();
  // At most 4 hours/session, no early learning. Flush due learning after main queue.
  for(let round=0;round<25;round++){
   for(const id of queue){let c=DB.getCard(id);if(c.suspenso||E.estaEnterrado(c)||!E.isDue(c))continue;
    const u=random(),profile=Number(id)%5,fail=[.06,.12,.23,.35,.48][profile];
    const g=u<fail?1:u<fail+.12?2:u<.94?3:4;const grade=['','errei','dificil','bom','facil'][g];
    const elapsed=c.lastReview?E._daysBetween(c.lastReview,today()):0;
    const preview=E.previewIntervals(c)[grade];const patch=E.schedule(c,grade);
    if(preview.kind!==patch._kind||preview.val!==patch._val)previewMismatch++;
    if(algo==='fsrs'){
      const ref=R.step(F.DEFAULT_W,elapsed,g,memories.get(id)||{stability:0,difficulty:0},memories.has(id)?1:0);memories.set(id,ref);
      if(Math.abs(ref.stability-patch.s)>1e-9*Math.max(1,ref.stability)||Math.abs(ref.difficulty-patch.d)>1e-9)memoryMismatch++;
      maxS=Math.max(maxS,patch.s);
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(patch.due)||!Number.isFinite(Date.parse(patch.due))||(patch.dueTs!=null&&!Number.isFinite(patch.dueTs))||(algo==='fsrs'&&(!Number.isFinite(patch.s)||!Number.isFinite(patch.d))))invalid++;
    const bucket=S._bucket(c);if(bucket==='new'||bucket==='review')C.markIntroduced(bucket,id);
    Object.assign(c,patch);E.invalidateDueCache();distinct.add(id);answers++;daily++;
   }
   const waiting=cards.filter(c=>!c.suspenso&&c.dueTs&&c.dueTs>now&&c.dueTs<=start+4*3600e3);
   if(!waiting.length)break;now=Math.min(...waiting.map(c=>c.dueTs));queue=waiting.filter(c=>c.dueTs<=now).map(c=>c.id);
  }
  // Serialize and restore every week, including config cache reset.
  if(day%7===0){cards=JSON.parse(JSON.stringify(cards));C._c=null;C._cKey=null;}
  maxDaily=Math.max(maxDaily,daily);days.push({day,answers:daily,due:cards.filter(c=>!c.suspenso&&E.isDue(c)).length});
 }
 const summary={name,algo,retention,loadBalance,cards:cards.length,days:365,activeDays,answers,distinctReviewed:distinct.size,invalid,memoryMismatchVsLocalPort:memoryMismatch,previewMismatch,maxDaily,maxStability:maxS,leechCards:cards.filter(c=>c.leech).length,seconds:+((performance.now()-started)/1000).toFixed(2),daysDetail:days};scenarios.push(summary);console.log(JSON.stringify({...summary,daysDetail:undefined}));
 if(name==='fsrs-default') for(const c of cards){if(c.phase==='review') vectors.push({card:c,elapsed:E._daysBetween(c.lastReview,today()),patches:Object.fromEntries(['errei','dificil','bom','facil'].map(g=>[g,E.schedule(c,g)]))});}
}
const report={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),seed:9212026,scope:'Engine/queue/config with simulated clock and storage; no cloud or UI claims. Local port is NOT official backend.',checks,scenarios};
fs.writeFileSync(new URL('simulation.json',output),JSON.stringify(report,null,2));fs.writeFileSync(new URL('vectors.json',output),JSON.stringify(vectors));console.log('CHARACTERIZATION',JSON.stringify(checks));
if(scenarios.some(s=>s.invalid||s.memoryMismatchVsLocalPort||s.previewMismatch||s.distinctReviewed<5001)||checks.some(c=>!c.pass))process.exitCode=1;
