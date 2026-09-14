import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src=fs.readFileSync(new URL('../src/js/59-reforco-adaptativo.js',import.meta.url),'utf8');
const mem=new Map();let fechados=[];
const ctx={console,setTimeout,clearTimeout,localStorage:{getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v))},DB:{_profilePrefix:()=> 't:',setRaw:(k,v)=>mem.set(k,String(v)),getTecSnapshots:()=>[{id:'s1'}],getExtras:()=>[],saveExtras:()=>{},_selarCicloDoPlano(){},addExtraProgress(){}},PlanoEngine:{prefs:()=>({metaDominio:85,minAmostra:20,faixaCritico:50,sensTendencia:3}),qParaMedir:(taxa,margem=10)=>{const p=Math.min(.95,Math.max(.05,(taxa??50)/100)),e=Math.max(2,margem)/100;return Math.ceil(3.8416*p*(1-p)/(e*e));},calcular:()=>({erro:'sem-retrato'})},PlanoCiclo:{fechados:()=>fechados,origem:()=>({}),avaliar:()=>null,conciliar:()=>({})},ReforcoEngine:{norm:s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()},window:{},_quiet:()=>{}};
vm.createContext(ctx);vm.runInContext(src,ctx,{filename:'59-reforco-adaptativo.js'});const RA=ctx.window.ReforcoAdaptativo;assert(RA,'motor não exportado');
assert.equal(RA.prefs().ativo,false,'opt-in deve nascer desligado');
mem.set('t:reforco-adaptativo-prefs',JSON.stringify({ativo:true}));
const rPre={meta:85,modoEdital:'pre',itens:[]},rPos={meta:85,modoEdital:'pos',itens:[]};
const item=(o={})=>Object.assign({nome:'Tópico',disciplina:'Disciplina',taxa:60,qJanela:80,qHist:80,incid:20,custoQ:60,pontosGanho:1,pontosPorQuestao:1},o);

// Probabilidade: taxa e amostra devem se comportar de forma monotônica.
let ant=0;for(const t of [60,70,80,90,95]){const p=RA.posterior(t,120,85,5).pMeta;assert(p>=ant-1e-12);ant=p;}
assert(RA.posterior(90,300,85,5).pMeta>RA.posterior(90,10,85,5).pMeta);
assert(RA.posterior(65,300,85,5).pMeta<.001,'lacuna grande não pode ser encerrada');

// Casos dirigidos.
let z=RA.prescrever(item({taxa:95,qJanela:250}),rPre);assert.equal(z.dose,0);assert(z.confiouMeta);
z=RA.prescrever(item({taxa:42,qJanela:100}),rPre);assert(z.dose>=10&&z.dose<=20);assert(z.teoriaPrimeiro);
z=RA.prescrever(item({taxa:55,qJanela:6}),rPre);assert.equal(z.objetivo,'diagnosticar');assert(z.dose>=10&&z.dose<=20);
const alto=item({nome:'Alto',taxa:68,qJanela:100,incid:80,pontosGanho:4,pontosPorQuestao:3,custoQ:40});
const baixo=item({nome:'Baixo',taxa:55,qJanela:100,incid:2,pontosGanho:.2,pontosPorQuestao:.15,custoQ:100});
const rp={meta:85,modoEdital:'pos',itens:[alto,baixo]};RA.enriquecer(rp);assert(alto.prescricaoAdaptativa.score>baixo.prescricaoAdaptativa.score,'pós deve premiar pontos/incidência/eficiência');
const pouco=item({nome:'Pouco',taxa:58,qJanela:6,incid:0,pontosGanho:0,pontosPorQuestao:0,custoQ:60});
const muito=item({nome:'Muito',taxa:58,qJanela:180,incid:0,pontosGanho:0,pontosPorQuestao:0,custoQ:60});
const rb={meta:85,modoEdital:'pre',itens:[pouco,muito]};RA.enriquecer(rb);assert.equal(pouco.prescricaoAdaptativa.objetivo,'diagnosticar');assert.equal(muito.prescricaoAdaptativa.objetivo,'intervir');
fechados=[{disciplina:'Disciplina',topico:'Tópico',questoes:20,ganhoPP:1,tipo:'naoFuncionou'},{disciplina:'Disciplina',topico:'Tópico',questoes:22,ganhoPP:.5,tipo:'naoFuncionou'}];z=RA.prescrever(item({taxa:58,qJanela:100}),rPre);assert(z.teoriaPrimeiro,'baixa resposta deve mudar intervenção');fechados=[];

// Fuzz massivo de combinações realistas.
let seed=0x51A7F00D;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=seed;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
const N=20000;let stops=0,falseStops=0,criticalNoTheory=0,outRange=0,nans=0;
for(let i=0;i<N;i++){
  const fase=rnd()<.48?'pre':'pos',n=Math.floor(rnd()*301),taxa=Math.round((25+rnd()*72)*10)/10;
  const x=item({nome:'T'+i,disciplina:'D'+(i%37),taxa,qJanela:n,qHist:n,incid:Math.floor(rnd()*90),custoQ:15+Math.floor(rnd()*150),pontosGanho:rnd()*5,pontosPorQuestao:rnd()*4});
  const r={meta:85,modoEdital:fase,itens:[x]},rx=RA.prescrever(x,r),p=RA.prefs(),mi=fase==='pos'?p.dosePosMin:p.dosePreMin,ma=fase==='pos'?p.dosePosMax:p.dosePreMax;
  if(!Number.isFinite(rx.score)||!Number.isFinite(rx.estatistica.pMeta)||!Number.isFinite(rx.estatistica.lo)||!Number.isFinite(rx.estatistica.hi))nans++;
  if(rx.dose!==0&&(rx.dose<mi||rx.dose>ma))outRange++;
  if(rx.confiouMeta){stops++;if(taxa<75)falseStops++;}
  if(taxa<50&&n>=20&&!rx.teoriaPrimeiro)criticalNoTheory++;
  assert(rx.estatistica.lo<=rx.estatistica.media+1e-9&&rx.estatistica.media<=rx.estatistica.hi+1e-9);
}
assert.equal(nans,0);assert.equal(outRange,0);assert.equal(criticalNoTheory,0);assert.equal(falseStops,0);

// Monte Carlo: observa se o critério de parada distingue domínio baixo/alto.
function bin(n,p){let a=0;for(let i=0;i<n;i++)if(rnd()<p)a++;return a;}
let lowStop=0,hiStop=0;const M=4000;
for(let i=0;i<M;i++){let n=30+Math.floor(rnd()*170),ac=bin(n,.68),rx=RA.prescrever(item({taxa:100*ac/n,qJanela:n}),rPos);if(rx.confiouMeta)lowStop++;}
for(let i=0;i<M;i++){let n=30+Math.floor(rnd()*170),ac=bin(n,.92),rx=RA.prescrever(item({taxa:100*ac/n,qJanela:n}),rPos);if(rx.confiouMeta)hiStop++;}
assert(lowStop/M<.01,`falso stop Monte Carlo alto: ${(100*lowStop/M).toFixed(2)}%`);assert(hiStop/M>.75,`reconhecimento de domínio baixo: ${(100*hiStop/M).toFixed(1)}%`);

// Sanitização: preferências impossíveis não podem quebrar dose.
mem.set('t:reforco-adaptativo-prefs',JSON.stringify({dosePreMin:99,dosePreBase:-4,dosePreMax:5,confiancaMeta:500,diasAteProva:-2,preLacuna:-10,posPontos:999}));
const ps=RA.prefs();assert(ps.dosePreMin<=ps.dosePreBase&&ps.dosePreBase<=ps.dosePreMax);assert(ps.confiancaMeta<=99.9);assert(ps.diasAteProva>=1);assert(ps.preLacuna>=0&&ps.posPontos<=100);

console.log(`OK: ${N.toLocaleString('pt-BR')} prescrições aleatórias + ${2*M} cenários Monte Carlo.`);
console.log(`Encerramentos coerentes: ${stops}; falsos encerramentos graves: ${falseStops}.`);
console.log(`Monte Carlo: falso stop ${(100*lowStop/M).toFixed(2)}% · reconhecimento de domínio ${(100*hiStop/M).toFixed(1)}%.`);

/* ── MENTOR 90+ V5: contrato de negócio canônico ────────────────────────── */
const srcV5=fs.readFileSync(new URL('../src/js/84-reforco-continuity-core-v4.js',import.meta.url),'utf8');
vm.runInContext(srcV5,ctx,{filename:'84-reforco-continuity-core-v4.js'});
const M90=ctx.window.Mentor90V5;assert(M90,'Mentor90 V5 não exportado');
assert.equal(RA.prefs().ativo,true,'V5 deve nascer canônica para perfis sem opt-out explícito');

let d90=M90.dominio(item({taxa:55,qJanela:6}),{meta:85,minAmostra:20,validadeDias:120});
assert.equal(d90.nivel,'nao_medido','amostra curta deve pedir diagnóstico, não rotular fraqueza');
d90=M90.dominio(item({taxa:96,qJanela:500,medicoes:3,diasDesdeMedicao:10}),{meta:85,minAmostra:20,validadeDias:120});
assert.equal(d90.nivel,'elite','90%+ com confiança, repetição e recência deve consolidar domínio');

const incidTeste=[
  {banca:'FGV',disciplina:'Disciplina',nome:'Tópico',incidencia:100},
  {banca:'FGV',disciplina:'Disciplina',nome:'Outro',incidencia:900},
  {banca:'CEBRASPE',disciplina:'Disciplina',nome:'Tópico',incidencia:20},
  {banca:'CEBRASPE',disciplina:'Disciplina',nome:'Outro',incidencia:80}
];
ctx.DB.getIncidencia=()=>incidTeste;
ctx.ReforcoEngine.incidenceMap=b=>({b});
ctx.ReforcoEngine.incidenciaDe=(m,n,d)=>({valor:incidTeste.filter(x=>x.banca===m.b&&x.disciplina===d&&x.nome===n).reduce((s,x)=>s+x.incidencia,0),viaNome:false});
ctx.ReforcoEngine.incidPorDisciplina=b=>({Disciplina:incidTeste.filter(x=>x.banca===b).reduce((s,x)=>s+x.incidencia,0)});
const inorm=M90.incidenciaNormalizada(item(),{banca:['FGV','CEBRASPE']});
assert(Math.abs(inorm.pct-15)<1e-9,'multi-banca deve normalizar 10% e 20% para média 15%, não somar bases brutas');
assert.equal(inorm.confianca,.95,'casamento disciplina+tópico deve manter alta confiança');

ctx.DB.getExtras=()=>[{disciplina:'Disciplina',historico:[{quantidade:30,minutos:90},{quantidade:30,minutos:90}]}];
const vel=M90.velocidade('Disciplina');assert(vel.confiavel);assert.equal(Math.round(vel.segundosPorQuestao),180,'tempo real deve virar custo por questão');
ctx.DB.getExtras=()=>[];

fechados=[
  {disciplina:'Disciplina',topico:'Tópico',questoes:20,ganhoPP:1,tipo:'subiu'},
  {disciplina:'Disciplina',topico:'Tópico',questoes:20,ganhoPP:1,tipo:'subiu'},
  {disciplina:'Disciplina',topico:'Tópico',questoes:20,ganhoPP:1,tipo:'subiu'},
  {disciplina:'Disciplina',topico:'Outro A',questoes:20,ganhoPP:1,tipo:'subiu'},
  {disciplina:'Disciplina',topico:'Outro B',questoes:20,ganhoPP:1,tipo:'subiu'},
  {disciplina:'Disciplina',topico:'Outro C',questoes:20,ganhoPP:1,tipo:'subiu'}
];
const cal90=M90.calibracaoHierarquica(item());assert.equal(cal90.nivel,'topico');assert(cal90.confianca>0,'calibração deve fazer shrinkage, não confiar cegamente em poucos ciclos');

const bloquear=item({taxa:86,qJanela:200,qHist:200,medicoes:1,diasDesdeMedicao:10});
bloquear.prescricaoAdaptativa={dose:0,fase:'pre',score:65,objetivo:'encerrar',confiouMeta:true,continuidade:{estado:'aguardar-medicao'},estatistica:{pLacuna:.1}};
const rr={meta:85,minAmostra:20,validadeDias:120,modoEdital:'pre',banca:['FGV'],itens:[bloquear],pequenas:[]};
M90.enriquecerResultado(rr);assert.equal(bloquear.prescricaoAdaptativa.dose,0,'régua 90+ nunca pode furar cooldown ou exigência de nova medição');
assert.equal(bloquear.prescricaoAdaptativa.motorCanonico,'mentor90-v5');
assert(bloquear.prescricaoAdaptativa.intervencao,'toda decisão canônica deve carregar uma intervenção explícita');

fechados=[];
console.log('OK: Mentor90 V5 — domínio 90+, incidência normalizada, tempo, shrinkage e cooldown.');
