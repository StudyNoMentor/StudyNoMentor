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
assert.ok(out.params.every(x=>x>0),'parâmetros retornados devem respeitar domínio positivo esperado');
console.log('OTIMIZADOR FSRS: WASM fsrs-rs 6.6.2 executou '+items.length+' itens e devolveu 21 parâmetros válidos.');
