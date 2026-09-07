#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   ROBUSTEZ — configuração inválida não pode "sumir" com um card
   ───────────────────────────────────────────────────────────────────────────
   A tela de opções valida o que você digita. Mas a configuração também chega
   por caminhos que NINGUÉM valida: a sincronização na nuvem (outro aparelho,
   outra versão do app), um backup importado, o armazenamento editado à mão.

   O que este teste protege: por esses caminhos, valores como
   `learnSteps: ["abc"]` ou `maxInterval: "muito"` faziam o agendador gravar
   `due: "NaN-NaN-NaN"` ou `dueTs: NaN`. Um card com data NaN NUNCA MAIS VENCE —
   ele desaparece da fila em silêncio, sem erro no console e sem jeito de o
   usuário perceber. Eram 21 combinações (config × fase × nota).

   O teste roda a configuração pelo funil real — `CardsConfig.get()`, com o
   saneamento de `_sanear()` — e exige que NENHUMA combinação produza estado
   inválido.

   Uso:  node testes/robustez-config.mjs
   ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(RAIZ, 'src', 'js', f), 'utf8');
const HOJE='2026-09-07'; let CFG;
const ctx={console,Math,Date,Array,Object,JSON,isFinite,parseInt,parseFloat,Number,String,Set,Map,window:{},
  _quiet:()=>{}, todayCards:()=>HOJE, proximaViradaTs:()=>Date.now()+6*3600e3, DB:{getCards:()=>[]},
  CardsConfig:{forDeck:()=>CFG,get:()=>CFG,weightsFor:()=>ctx.__F.DEFAULT_W,weights:()=>ctx.__F.DEFAULT_W}};
vm.createContext(ctx);
vm.runInContext(src('30-fsrs.js')+'\n;globalThis.__F=FSRS;',ctx);
let ARMAZEM=null;
ctx.localStorage={getItem:()=>ARMAZEM,setItem:()=>{},removeItem:()=>{}};
ctx.DB._profilePrefix=()=>'p:';
vm.runInContext(src('31-cards-config.js')+'\n;globalThis.__CC=CardsConfig;',ctx);
vm.runInContext(src('32-card-engine.js')+'\n;globalThis.__CE=CardEngine;',ctx);
const CC=ctx.__CC;
CC._read=function(){ return ARMAZEM?JSON.parse(ARMAZEM):null; };
ctx.CardsConfig.get=()=>CC.get();
ctx.CardsConfig.forDeck=()=>CC.get();
ctx.CardsConfig.weights=()=>ctx.__F.migrarW(CC.get().weights)||ctx.__F.DEFAULT_W;
ctx.CardsConfig.weightsFor=()=>ctx.CardsConfig.weights();
const CE=ctx.__CE;
const BASE={algo:'fsrs',retention:0.9,learnSteps:[1,10],relearnSteps:[10],maxInterval:36500,
  leechThreshold:8,leechAction:'suspend',loadBalance:false,weights:null};
const casos=[
  ['passos com texto',        {learnSteps:['abc'],relearnSteps:['x']}],
  ['passos zero',             {learnSteps:[0],relearnSteps:[0]}],
  ['passos negativos',        {learnSteps:[-5,-1],relearnSteps:[-3]}],
  ['passos null',             {learnSteps:[null],relearnSteps:[null]}],
  ['passos Infinity',         {learnSteps:[Infinity],relearnSteps:[Infinity]}],
  ['retencao 0',              {retention:0}],
  ['retencao 1',              {retention:1}],
  ['retencao "alta"',         {retention:'alta'}],
  ['maxInterval 0',           {maxInterval:0}],
  ['maxInterval negativo',    {maxInterval:-10}],
  ['maxInterval texto',       {maxInterval:'muito'}],
  ['pesos curtos',            {weights:[1,2,3]}],
];
let ruins=0;
for(const [nome,patch] of casos){
  ARMAZEM=JSON.stringify({...BASE,...patch}); CC._c=null; CC._cKey=null;
  for(const fase of ['new','learning','review','relearning']){
    for(const g of ['errei','dificil','bom','facil']){
      const card={id:'c',phase:fase,s:fase==='new'?null:20,d:fase==='new'?null:5,
        reps:fase==='new'?0:4,lapses:0,learnStep:0,intervalo:fase==='new'?0:30,
        due:HOJE,lastReview:fase==='new'?null:CE.addDays(HOJE,-30),algo:'fsrs'};
      let p; try{ p=CE.schedule(card,g);}catch(e){ console.log(`EXCECAO  ${nome} / ${fase} / ${g}: ${e.message}`); ruins++; continue; }
      const mau=[];
      if(!isFinite(p.s))mau.push('S='+p.s);
      if(!isFinite(p.d))mau.push('D='+p.d);
      if(p.dueTs!=null&&!isFinite(p.dueTs))mau.push('dueTs='+p.dueTs);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(p.due)))mau.push('due='+p.due);
      if(p.intervalo!=null&&!isFinite(p.intervalo))mau.push('intervalo='+p.intervalo);
      if(mau.length){ console.log(`ESTADO INVALIDO  ${nome} / ${fase} / ${g}: ${mau.join(' ')}`); ruins++; }
    }
  }
}
if (ruins) {
  console.error(`\nROBUSTEZ: ${ruins} combinacao(oes) de configuracao produzem card inagendavel.`);
  process.exit(1);
}
console.log(`ROBUSTEZ: ${casos.length} configuracoes invalidas x 4 fases x 4 notas — nenhum card fica inagendavel.`);
