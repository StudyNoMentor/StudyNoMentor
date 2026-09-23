#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { criarAmbiente } from '../audit/cards-20260921-v2/harness.mjs';

const file=process.env.SNM_ANKI_SCHEDULER_EXPECTED;
assert.ok(file&&fs.existsSync(file),'oracle oficial do scheduler ausente');
const oracle=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(oracle.anki_version,'26.09.3');

const A=criarAmbiente().reset({
  algo:'fsrs',retention:0.9,learnSteps:[1,10],relearnSteps:[10],
  newPerDay:999,revPerDay:999
});
const {CardEngine:E,AnkiParity:P}=A;

const close=(a,b,eps=1e-6,msg='')=>{
  assert.ok(Number.isFinite(Number(a))&&Number.isFinite(Number(b)),msg+' valores não finitos');
  assert.ok(Math.abs(Number(a)-Number(b))<=eps, msg+` esperado=${b} obtido=${a}`);
};
const mem=(state)=>{
  const n=state&&state.normal;
  if(!n)return null;
  return (n.learning&&n.learning.memory_state)
    ||(n.review&&n.review.memory_state)
    ||(n.relearning&&n.relearning.learning&&n.relearning.learning.memory_state)
    ||null;
};

const base={
  id:'real-log-regression',ankiId:Number(oracle.card_id),
  phase:'new',reps:0,lapses:0,learnStep:0,intervalo:0,
  due:A.hoje(),dueTs:null,ease:2.5,s:null,d:null,algo:'fsrs'
};

const t=A.agora();
const p1=E.schedule(base,'errei');
const m1=P.revlogMeta(base,p1,{grade:'errei',revTs:t});
const c1={...base,...p1};
assert.equal(c1.reps,oracle.after_again.reps,'Again deve incrementar reps como Anki');
assert.equal(c1.phase,'learning','New/Again deve entrar em learning');
const o1=mem(oracle.after_again.state);assert.ok(o1,'memory_state oficial após Again');
close(c1.s,o1.stability,1e-5,'S após Again');
close(c1.d,o1.difficulty,1e-5,'D após Again');
assert.equal(m1.interval,oracle.revlog[0].ivl,'revlog ivl do Again');
assert.equal(m1.lastInterval,oracle.revlog[0].lastIvl,'revlog lastIvl do Again');
assert.equal(m1.easeFactor,oracle.revlog[0].factor,'revlog factor do Again');

const p2=E.schedule(c1,'bom');
const m2=P.revlogMeta(c1,p2,{grade:'bom',revTs:t+88000});
const c2={...c1,...p2};
assert.equal(c2.reps,oracle.after_good.reps,'segunda resposta deve produzir reps=2');
assert.equal(c2.phase,'learning','Good no primeiro passo deve permanecer learning');
assert.equal(c2.learnStep,1,'Good deve avançar para o passo de 10 minutos');
const o2=mem(oracle.after_good.state);assert.ok(o2,'memory_state oficial após Good');
close(c2.s,o2.stability,1e-5,'S após Again→Good');
close(c2.d,o2.difficulty,1e-5,'D após Again→Good');
assert.equal(m2.interval,oracle.revlog[1].ivl,'revlog ivl do Good');
assert.equal(m2.lastInterval,oracle.revlog[1].lastIvl,'revlog lastIvl do Good');
assert.equal(m2.easeFactor,oracle.revlog[1].factor,'revlog factor do Good');

assert.equal(oracle.after_good.state.normal.learning.remaining_steps,1,
  'oracle confirma que resta um passo após Again→Good');

console.log('OK: caso real New/Again→Learning/Good idêntico ao Anki 26.09.3 em estado FSRS, reps e revlog.');
