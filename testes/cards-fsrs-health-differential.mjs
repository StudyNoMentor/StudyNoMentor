#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const expectedPath=process.env.SNM_FSRS_HEALTH_EXPECTED;
assert.ok(expectedPath,'SNM_FSRS_HEALTH_EXPECTED deve apontar para o oracle nativo');
const expected=JSON.parse(readFileSync(expectedPath,'utf8'));

const mod=await import(pathToFileURL(join(ROOT,'src/vendor/fsrs-6.6.2/fsrs_optimizer.js')).href);
mod.initSync(readFileSync(join(ROOT,'src/vendor/fsrs-6.6.2/fsrs_optimizer_bg.wasm')));

const items=[],card_ids=[];
for(let c=0;c<64;c++){
  for(let k=2;k<=7;k++){
    const reviews=[{rating:3,delta_t:0}];
    for(let i=1;i<k;i++){
      reviews.push({
        rating:(i+c)%11===0?1:((i+c)%7===0?2:3),
        delta_t:Math.max(1,Math.round(Math.pow(1.7,i-1)))
      });
    }
    items.push({reviews});
    card_ids.push(100000+c);
  }
}
const actual=JSON.parse(mod.health_check_json(JSON.stringify({
  items,card_ids,num_relearning_steps:1
})));

assert.equal(actual.fsrs_items,expected.fsrs_items,'mesmo número de itens');
assert.equal(actual.passed,expected.passed,'decisão Health Check deve coincidir com fsrs-rs nativo');

for(const key of ['log_loss','rmse_bins','adjusted_log_loss','adjusted_rmse']){
  const delta=Math.abs(Number(actual[key])-Number(expected[key]));
  assert.ok(delta<=1e-5,key+' divergência '+delta+' > 1e-5; wasm='+actual[key]+' native='+expected[key]);
}

console.log(
  'FSRS HEALTH DIFFERENTIAL: '+items.length+
  ' itens · 5 folds · log_loss/RMSE/decisão equivalentes ao fsrs-rs 6.6.2 nativo.'
);
