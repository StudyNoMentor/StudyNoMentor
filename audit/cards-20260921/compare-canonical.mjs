import fs from 'node:fs';import vm from 'node:vm';
const out=new URL('./',import.meta.url),root=new URL('../../',import.meta.url);const input=JSON.parse(fs.readFileSync(new URL('canonical-vectors.json',out)));
const ctx={Date,Math,_quiet:()=>{},todayCards:()=> '2025-12-31',proximaViradaTs:()=>Date.now()+864e5,DB:{getCards:()=>[]},CardsConfig:{forDeck:()=>({algo:'fsrs',retention:.9,learnSteps:[1,10],relearnSteps:[10],maxInterval:36500,loadBalance:false}),weightsFor:()=>ctx.F.DEFAULT_W}};vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('src/js/30-fsrs.js',root),'utf8')+'\nglobalThis.F=FSRS',ctx);vm.runInContext(fs.readFileSync(new URL('src/js/32-card-engine.js',root),'utf8')+'\nglobalThis.E=CardEngine',ctx);
const r={ankiVersion:'26.9.2',cards:input.length,answers:0,scalarComparisons:0,tolerance:1e-5,memoryFailures:0,maxRelativeError:0,phaseFailures:0,stepFailures:0,exactIntervalMismatches:0,note:'Study inputs aligned to memory state actually persisted by Anki (rounding in storage); compares actual Rust outputs, no local reference equations. RNG unaligned; interval differences counted separately.'};
for(const v of input)for(const [g,a] of [['errei','again'],['dificil','hard'],['bom','good'],['facil','easy']]){
 const p=ctx.E.schedule(v.card,g),normal=v.states[a].normal,phase=Object.keys(normal)[0],state=normal[phase],mem=phase==='relearning'?state.learning.memoryState:state.memoryState;r.answers++;
 if(p.phase!==phase)r.phaseFailures++;
 if(phase==='relearning'&&p._val*60!==state.learning.scheduledSecs)r.stepFailures++;
 for(const [k,value] of [['s',mem.stability],['d',mem.difficulty]]){r.scalarComparisons++;const e=Math.abs(p[k]-value)/Math.max(1,Math.abs(value));r.maxRelativeError=Math.max(e,r.maxRelativeError);if(e>r.tolerance)r.memoryFailures++;}
 if(phase==='review'&&p.intervalo!==state.scheduledDays)r.exactIntervalMismatches++;
}
fs.writeFileSync(new URL('canonical-comparison.json',out),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));if(r.memoryFailures||r.phaseFailures||r.stepFailures)process.exitCode=1;
