import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const mem=new Map(), extras=[];
const clone=x=>JSON.parse(JSON.stringify(x));
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const semComentarios=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n\r]*/g,'$1');
const discs=['A','B','C','D'];
const rows=discs.flatMap((d,di)=>Array.from({length:3},(_,ti)=>{const q=30,t=45+di*7+ti*6,ac=Math.round(q*t/100);return{codigo:`${di+1}.${ti+1}`,depth:1,disciplina:d,nome:`${d} T${ti+1}`,questoes:q,acertos:ac,pctAcerto:ac/q*100};}));
const snap={id:1,date:'2026-09-14',rows};
const inc=rows.map((r,i)=>({banca:'FGV',disciplina:r.disciplina,topico:r.nome,incidencia:10+(i%3)*20}));
const I={
  num:(v,d=0)=>Number.isFinite(Number(v))?Number(v):d,
  clamp:(v,a,b)=>Math.max(a,Math.min(b,Number(v))),norm,esc:s=>String(s??''),
  fasePlano:()=> 'pre',bancas:()=>['FGV'],snapshot:()=>clone(snap),linhasTec:s=>(s&&s.rows)||[],
  q:r=>Number(r?.questoes)||0,taxa:r=>Number(r?.pctAcerto),disciplinasBloqueadas:()=>new Set(),
  incidencia:()=>clone(inc),materias:()=>[],atividadesAbertas:()=>[]
};
let plan={id:'p1',tipo:'Pré-edital'};
const ctx={
  console,setTimeout:(fn)=>{fn();return 1;},clearTimeout(){},JSON,Math,Date,Set,Map,Promise,
  localStorage:{getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)},
  DB:{_profilePrefix:()=> 'p:',setRaw:(k,v)=>mem.set(k,String(v)),delRaw:k=>mem.delete(k),getExtras:()=>extras,getTecSnapshots:()=>[clone(snap)],getIncidencia:()=>clone(inc),getBancas:()=>['FGV'],getActiveSubjects:()=>[],addExtra:data=>{const e={id:'e'+(extras.length+1),status:'ativa',historico:[],...clone(data)};extras.push(e);return e;},updateExtra:(id,p)=>Object.assign(extras.find(x=>x.id===id),clone(p))},
  PlanManager:{getActivePlan:()=>plan,updatePlan:(id,p)=>Object.assign(plan,clone(p))},
  PlanoSugestoesInfra:I,
  PlanoCiclo:{titulo:n=>'Reforçar: '+n,origem:(nome,disc,item)=>({topico:nome,disciplina:disc,taxaInicial:item.taxa})},
  ExtrasScreen:{puxarDoPlano(){return'legacy';},render(){}},UI:{_open(){},_resolve:null,_mode:null},
  escapeHtml:s=>String(s),showToast(){},_quiet(){},window:{addEventListener(){},dispatchEvent(){}}
};
ctx.window=Object.assign(ctx.window,ctx);
vm.createContext(ctx);
const load=f=>vm.runInContext(readFileSync(join(ROOT,f),'utf8'),ctx,{filename:f});
load('src/js/84b-reforco-tec-extras.js');
// No navegador clássico, propriedades de window também resolvem como identificadores globais.
// O vm do Node usa um objeto window separado, então reproduzimos explicitamente esse contrato.
ctx.ReforcoTecExtras=ctx.window.ReforcoTecExtras;
load('src/js/87-plano-sugestoes-simplificado.js');
load('src/js/88-plano-sugestoes-robusto.js');
load('src/js/89-plano-sugestoes-controller.js');

const W=ctx.window;
const S=W.PlanoSugestoesSimplificado||W.PlanoSugestoesSimplificado;
const R=W.PlanoSugestoesRobusto;
const C=W.PlanoSugestoes;
assert(S&&R&&C,'motores e controller devem publicar APIs no window');

const simpleExec=semComentarios(readFileSync(join(ROOT,'src/js/87-plano-sugestoes-simplificado.js'),'utf8'));
const robExec=semComentarios(readFileSync(join(ROOT,'src/js/88-plano-sugestoes-robusto.js'),'utf8'));
assert(!/\bPlanoEngine\s*[.(\[]|\bMentor90(?:V\d+)?\s*[.(\[]/.test(simpleExec),'Simplificado não deve executar PlanoEngine/Mentor90');
assert(!/\bPlanoSugestoesSimplificado\w*\s*[.(\[]|plano-simplificado/.test(robExec),'Robusto não deve conhecer Simplificado/storage dele');

S.salvar({fase:'pre',meta:90,minAmostra:20,alvoQuestoes:30,banca:'FGV'});
let s=S.calcular(), r=R.calcular();
assert.equal(s.erro,undefined);assert.equal(r.erro,undefined);
assert.equal(s.itens.length,3);assert.equal(r.itens.length,3);
assert.equal(new Set(s.itens.map(x=>x.disciplina)).size,3);
assert.equal(new Set(r.itens.map(x=>x.disciplina)).size,3);
assert(r.itens.every(x=>x.modo==='robusto'&&x.quantidadeRecomendada>=R.prefs().doseMin&&x.quantidadeRecomendada<=R.prefs().doseMax));
assert(r.itens.every(x=>Array.isArray(x.topicosOrdenados)&&x.topicosOrdenados.length>=1));

const sigS=()=>S.calcular().itens.map(x=>[x.disciplina,x.nome,Math.round(x.score*1000)]);
const sigR=()=>R.calcular().itens.map(x=>[x.disciplina,x.nome,Math.round(x.score*1000),x.quantidadeRecomendada]);
const s0=clone(sigS()),r0=clone(sigR());
R.salvar({meta:75,doseBase:25});
assert.deepEqual(clone(sigS()),s0,'config Robusto não pode alterar Simplificado');
R.restaurar();
S.salvar({meta:82,alvoQuestoes:55});
assert.deepEqual(clone(sigR()),r0,'config Simplificado não pode alterar Robusto');
S.salvar({fase:'pre',meta:90,minAmostra:20,alvoQuestoes:30});

const rOrig=R.calcular,sOrig=S.calcular;
R.calcular=()=>{throw new Error('robusto quebrado');};
assert.deepEqual(clone(sigS()),clone(S.calcular().itens.map(x=>[x.disciplina,x.nome,Math.round(x.score*1000)])));
R.calcular=rOrig;
S.calcular=()=>{throw new Error('simple quebrado');};
assert.deepEqual(clone(sigR()),r0);
S.calcular=sOrig;

/* ── COMPARAR MOSTRA O QUE CADA MOTOR ESCOLHEU ──────────────────────────────
   A ordem era dada por uma pontuacao inventada no controller:
     (4 - posNoSimplificado) + (4 - posNoRobusto) + 10 se consenso
   e depois cortada em tres. Somar posicoes de DOIS rankings que nao
   compartilham escala produz uma TERCEIRA ordem, que nao e a de nenhum dos
   motores: uma disciplina em #2 nos dois lados (2+2=4) passava na frente da
   que era #1 para um deles (3+0=3), e o corte deixava de fora recomendacoes
   que os motores realmente fizeram.

   O que passa a valer, e o que este bloco trava: toda linha visivel e o TOP 3
   de pelo menos um dos motores, com o numero DAQUELE motor; a ordem e a melhor
   posicao real alcancada; e nada e cortado — o contrato de tres vira selecao
   (`incluir`), nao censura. */
const comp=C.comparar();
assert(comp.itens.length>=1&&comp.itens.length<=6,`Comparar mostra a uniao dos dois TOP 3 (recebeu ${comp.itens.length})`);
assert(comp.itens.every(x=>x.simplificado||x.robusto));
assert(comp.itens.every(x=>!Object.hasOwn(x,'pontosComparacao')),
  'a pontuacao somada dos dois rankings nao pode voltar');
assert(comp.itens.every(x=>!Object.hasOwn(x,'scoreMath')),'Comparar não deve criar score matemático misto');

// toda linha e TOP 3 de pelo menos um motor, e o numero exibido e o dele
const topS=new Map((C.simplificado().itens||[]).map((x,i)=>[x.disciplina,i+1]));
const topR=new Map((C.robusto().itens||[]).map((x,i)=>[x.disciplina,i+1]));
comp.itens.forEach(x=>{
  const s=topS.get(x.disciplina)||null,r=topR.get(x.disciplina)||null;
  assert(s||r,`${x.disciplina} nao esta no TOP 3 de nenhum motor`);
  if(s){assert.equal(x.rankSimplificado,s,`posicao do Simplificado de ${x.disciplina}`);assert.equal(x.foraSimplificado,false);}
  if(r){assert.equal(x.rankRobusto,r,`posicao do Robusto de ${x.disciplina}`);assert.equal(x.foraRobusto,false);}
  assert.equal(x.melhorPosicao,Math.min(...[s,r].filter(Boolean)),`melhor posicao de ${x.disciplina}`);
});
// a uniao dos dois TOP 3 aparece inteira
[...topS.keys(),...topR.keys()].forEach(d=>assert(comp.itens.some(x=>x.disciplina===d),
  `${d} esta no TOP 3 de um motor e sumiu da comparacao`));
// a ordem sobe pela melhor posicao real
const pos=comp.itens.map(x=>x.melhorPosicao);
assert.deepEqual(pos,pos.slice().sort((a,b)=>a-b),'a comparacao deve subir pela melhor posicao real');
// o contrato de tres vira selecao, nao corte
assert.equal(comp.itens.filter(x=>x.incluir!==false).length,Math.min(3,comp.itens.length),
  'as tres primeiras nascem marcadas; o resto fica visivel para trocar');

C.salvar({modo:'robusto',meta:99,campoEstranho:'x'});
const rawCtrl=JSON.parse(mem.get('p:'+C.KEY));
assert.deepEqual(Object.keys(rawCtrl),['modo'],'controller persiste apenas modo');

console.log('OK: Simplificado e Robusto independentes; controller usa apenas posição/consenso e três disciplinas.');
