#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const mod=await import(pathToFileURL(join(ROOT,'src/vendor/fsrs-6.6.2/fsrs_optimizer.js')).href);
const wasm=readFileSync(join(ROOT,'src/vendor/fsrs-6.6.2/fsrs_optimizer_bg.wasm'));
mod.initSync(wasm);
assert.equal(typeof mod.optimize_json,'function');
assert.equal(typeof mod.simulate_json,'function','vendor FSRS deve expor o simulador oficial');
const W=[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542];
const items=[],card_ids=[];
for(let c=0;c<64;c++){
  for(let k=2;k<=7;k++){
    const reviews=[{rating:3,delta_t:0}];
    for(let i=1;i<k;i++)reviews.push({rating:(i+c)%11===0?1:((i+c)%7===0?2:3),delta_t:Math.max(1,Math.round(Math.pow(1.7,i-1)))});
    items.push({reviews}); card_ids.push(100000+c);
  }
}
const out=JSON.parse(mod.optimize_json(JSON.stringify({items,card_ids,current_params:W,num_relearning_steps:1})));
assert.ok(Array.isArray(out.params)&&out.params.length===21,'WASM oficial deve devolver 21 parâmetros');
assert.ok(out.params.every(Number.isFinite),'todos os parâmetros otimizados devem ser finitos');
const LO=[0.001,0.001,0.001,0.001,1,0.001,0.001,0.001,0,0,0.001,0.001,0.001,0.001,0,0,1,0,0,0.01,0.1];
const HI=[100,100,100,100,10,4,4,0.75,4.5,0.8,3.5,5,0.25,0.9,4,1,6,2,2,0.8,0.8];
assert.ok(out.params.every((x,i)=>x>=LO[i]-1e-9&&x<=HI[i]+1e-9),'parâmetros devem permanecer dentro dos limites oficiais FSRS-6');

const simInput={
  revlogs:[],
  next_day_at:1893456000,
  params:W,
  desired_retention:.9,
  days_to_simulate:90,
  new_card_count:40,
  introduced_today_count:0,
  new_limit:10,
  review_limit:200,
  max_interval:36500,
  new_cards_ignore_review_limit:false,
  suspend_after_lapses:null,
  learning_step_count:2,
  relearning_step_count:1,
  review_order:'day',
  load_balance:true,
  easy_days:[1,1,1,1,1,1,1],
  next_day_weekday_monday:0,
  cards:[]
};
const simA=JSON.parse(mod.simulate_json(JSON.stringify(simInput)));
const simB=JSON.parse(mod.simulate_json(JSON.stringify(simInput)));
assert.equal(simA.fsrs_rs_version,'6.6.2','simulador deve identificar fsrs-rs 6.6.2');
for(const key of ['memorized','reviews','news','time','correct','introduced']){
  assert.equal(simA[key].length,simInput.days_to_simulate,key+' deve cobrir todo o horizonte');
}
assert.deepEqual(simA,simB,'simulador oficial deve ser determinístico com a semente padrão do fsrs-rs');
assert.ok(simA.news.reduce((a,b)=>a+b,0)>0,'simulador deve introduzir cards novos');
assert.ok(simA.reviews.reduce((a,b)=>a+b,0)>0,'simulador deve produzir revisões futuras');
const version=JSON.parse(readFileSync(join(ROOT,'src/vendor/fsrs-6.6.2/version.json'),'utf8'));
assert.equal(version.simulator,'fsrs::simulate','vendor deve declarar o motor oficial de simulação');

console.log('FSRS OFICIAL: simulador determinístico + otimizador; WASM fsrs-rs 6.6.2 executou '+items.length+' itens e devolveu 21 parâmetros válidos.');
