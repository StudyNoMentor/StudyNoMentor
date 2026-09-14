import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url))),mem=new Map();
const ctx={console,JSON,Math,Date,Set,Map,window:{},document:{createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL(){}},localStorage:{getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)},DB:{_profilePrefix:()=> 'p:',setRaw:(k,v)=>mem.set(k,String(v)),delRaw:k=>mem.delete(k)},PlanoEngine:{prefs:()=>({ordenar:'pior',incluirPequenas:false,minAmostra:20})},PlanoPontos:{modo:()=> 'pre'},_quiet(){}};ctx.window=ctx;vm.createContext(ctx);
for(const f of ['src/js/88a-plano-robusto-config-v4.js','src/js/88b-plano-robusto-router-v4.js','src/js/88c-plano-robusto-optimizer-v4.js'])vm.runInContext(readFileSync(join(ROOT,f),'utf8'),ctx,{filename:f});
ctx.PlanoSugestoesRobustoV6={VERSAO:6,REVISAO_AUDITORIA:6,MOTOR:'robusto-v5',arquitetura(){return{motor:this.MOTOR};}};
vm.runInContext(readFileSync(join(ROOT,'src/js/89z-robusto-foco-questoes-v7.js'),'utf8'),ctx,{filename:'89z'});
const R=ctx.PlanoRobustoRouterV7,E=ctx.PlanoSugestoesRobustoV7,C=ctx.PlanoRobustoConfigV5;
assert(R&&E&&C,'V7 deve publicar roteador e motor');assert.equal(R.VERSAO,7);assert.equal(E.VERSAO,7);assert.equal(E.REVISAO_AUDITORIA,7);
const cfg=C.prefs('base');
const mk=(o={})=>({disciplina:'Direito Tributário',nome:'Responsabilidade',taxa:52,qJanela:80,minAmostra:20,alvo:60,doseDiaria:15,item:{},mentor:{dominio:{nivel:'em_aquisicao',vencido:false},calibracao:{nivel:'disciplina'},tempo:{confiavel:true,segundosPorQuestao:120,escopo:'disciplina'}},...o});
for(const c of [mk(),mk({taxa:35}),mk({disciplina:'Direito Constitucional'}),mk({mentor:{dominio:{nivel:'competitivo',vencido:false},calibracao:{},tempo:{confiavel:true,segundosPorQuestao:120,escopo:'disciplina'}},item:{deltaTaxa:-8}})]){
  const iv=R.decidir(c,cfg);assert.equal(iv.tipo,'questoes_aprofundadas');assert.deepEqual(iv.passos.map(x=>x.tipo),['questoes']);assert(!/teoria|lei|anki|flashcard|resumo/i.test(iv.rotulo));assert(iv.quantidadeQuestoes>=1&&iv.quantidadeQuestoes<=c.alvo);
}
let iv=R.decidir(mk(),cfg);assert.equal(iv.quantidadeQuestoes,15);assert.equal(iv.minutosEstimados,30,'15 questões a 120 s/q devem estimar 30 min');assert.equal(iv.tempoFonte,'tempo-pessoal');assert.equal(iv.tempoConfiavel,true);
iv=R.decidir(mk({qJanela:5,doseDiaria:15}),cfg);assert.equal(iv.contexto,'medicao');assert.equal(iv.quantidadeQuestoes,15,'5/20 deve pedir 15 questões para completar a amostra');
iv=R.decidir(mk({mentor:{dominio:{nivel:'em_aquisicao'},calibracao:{},tempo:{confiavel:false}},doseDiaria:12}),cfg);assert.equal(iv.minutosEstimados,null,'sem tempo confiável e fallback desligado não pode inventar minutos');assert.equal(iv.tempoFonte,'indisponivel');
const arq=E.arquitetura();assert.equal(arq.modusOperandi,'questoes-aprofundadas');assert(arq.decide.includes('quantidadeQuestoes'));assert(arq.decide.includes('tempoQuandoConfiavel'));for(const k of ['teoria','lei-seca','anki','resumo','metodo-de-estudo'])assert(arq.naoDecide.includes(k));
const html=C.html('base');assert.match(html,/ROBUSTO V7 · PRIORIDADE, DOSE E TEMPO/);assert.match(html,/questões aprofundadas/i);console.log('OK: Robusto V7 — decide alvo, dose e tempo sem inferir método de estudo.');
