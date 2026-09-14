import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const mem=new Map();
const extras=[];
const clone=x=>JSON.parse(JSON.stringify(x));
let planPrefs={metaDominio:85,tetoDominio:90,minAmostra:20,banca:'FGV',validadeDias:120};
const baseItems=[
  {nome:'A pior',disciplina:'A',taxa:40,qJanela:100,qHist:100,custoQ:90,incid:30,pontosMateria:20,pontosGanho:3.6,diasDesdeMedicao:20},
  {nome:'A segunda',disciplina:'A',taxa:55,qJanela:120,qHist:120,custoQ:70,incid:70,pontosMateria:20,pontosGanho:4.9,diasDesdeMedicao:8},
  {nome:'B principal',disciplina:'B',taxa:60,qJanela:80,qHist:80,custoQ:65,incid:80,pontosMateria:15,pontosGanho:3.6,diasDesdeMedicao:50},
  {nome:'C principal',disciplina:'C',taxa:70,qJanela:90,qHist:90,custoQ:55,incid:40,pontosMateria:10,pontosGanho:.8,diasDesdeMedicao:130,vencido:true},
  {nome:'D curta',disciplina:'D',taxa:20,qJanela:8,qHist:8,custoQ:100,incid:90,pontosMateria:25,pontosGanho:8,diasDesdeMedicao:5}
];
const rows=baseItems.map((x,i)=>({codigo:`${i+1}.1`,nome:x.nome,disciplina:x.disciplina,depth:1,questoes:x.qJanela,acertos:Math.round(x.qJanela*x.taxa/100),pctAcerto:x.taxa}));
const incidencia=baseItems.map(x=>({banca:'FGV',disciplina:x.disciplina,topico:x.nome,incidencia:x.incid}));
const subjects=[['A',20],['B',15],['C',10],['D',25]].map(([nome,q])=>({nome,qtdQuestoes:q,pontosPorQuestao:1,peso:1,ativo:true}));
const ctx={
  console,setTimeout:(fn)=>{fn();return 1;},clearTimeout(){},Date,Math,JSON,Set,Map,Promise,
  localStorage:{getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v))},
  document:{getElementById:()=>null},window:{},escapeHtml:s=>String(s),showToast(){},_quiet(){},todayLocal:()=> '2026-09-14',
  ReforcoEngine:{norm:s=>String(s||'').toLowerCase().trim()},
  DB:{
    _profilePrefix:()=> 'p:',setRaw:(k,v)=>mem.set(k,String(v)),getBancas:()=>['FGV'],getIncidencia:()=>clone(incidencia),getActiveSubjects:()=>clone(subjects),getExtras:()=>extras,getTecSnapshots:()=>[],
    addExtra:data=>{const e={id:'e'+(extras.length+1),status:'ativa',historico:[],...clone(data)};extras.push(e);return e;},
    updateExtra:(id,patch)=>{const e=extras.find(x=>x.id===id);Object.assign(e,clone(patch));return e;}
  },
  PlanoEngine:{prefs:()=>({...planPrefs}),calcular:()=>({meta:planPrefs.metaDominio,validadeDias:planPrefs.validadeDias,itens:clone(baseItems),pequenas:[]}),atividadeSobreposta:()=>false},
  DesempenhoTecScreen:{scopedSnapshot:()=>({id:1,rows:clone(rows)})},
  PlanoPontos:{temComposicao:()=>true,modo:()=> 'pos',composicao:()=>subjects.map(m=>({nome:m.nome,q:m.qtdQuestoes,pts:1,peso:1,valor:m.qtdQuestoes,minimo:null})),anexarPontos:()=>true},
  PlanoCiclo:{titulo:n=>'Reforçar: '+n,origem:(n,d,item)=>({topico:n,disciplina:d,taxaInicial:item.taxa,qBase:0,qBaseNo:0,metaAlvo:90,custoEstimado:item.custoQ,escopo:{tipo:'no',membros:[n]}})},
  ExtrasScreen:{puxarDoPlano(){return 'legacy';},render(){ctx.__renders=(ctx.__renders||0)+1;}},
  Mentor90V5:{
    MIN_CICLOS_PERSONALIZAR:5,MINUTOS_BLOCO:30,
    dominio:x=>({nivel:x.taxa>=93?'elite':'em_aquisicao',rotulo:x.taxa>=93?'90%+ consolidado':'Em aquisição',pCompetitiva:Math.max(0,Math.min(1,(x.taxa-50)/50)),vencido:!!x.vencido}),
    calibracaoHierarquica:x=>({ganho100:x.disciplina==='C'?1:5,n:3,nTopico:3,nDisciplina:3,confianca:.38,baixaResposta:x.disciplina==='C'}),
    incidenciaNormalizada:x=>({pct:x.incid/10,confianca:.95,bancas:1}),
    velocidade:()=>({confiavel:true,segundosPorQuestao:120,escopo:'global'}),
    doseDiaria:x=>Math.max(5,Math.min(x.custoQ||20,15)),
    intervencao:(item,rx,dom,cal,dose)=>({tipo:cal.baixaResposta?'revisao_questoes':'questoes_dirigidas',rotulo:cal.baixaResposta?'Revisão dirigida → questões':'Questões dirigidas',passos:[{tipo:'questoes',quantidade:dose}],motivo:'Teste',exigeNovaMedicao:true})
  },
  UI:{_open(){},_resolve:null,_mode:null}
};
ctx.window=ctx;
vm.createContext(ctx);
const files=['src/js/85-mentor90-policy-v6.js','src/js/86-plano-sugestoes-infra-v2.js','src/js/87-plano-sugestoes-simplificado-v2.js','src/js/88-plano-sugestoes-robusto-v2.js','src/js/89-plano-sugestoes-controller-v2.js'];
for(const f of files) vm.runInContext(readFileSync(join(ROOT,f),'utf8'),ctx,{filename:f});
assert(ctx.Mentor90V6,'Mentor90 V6 deve estar disponível para o Robusto');
const I=ctx.PlanoSugestoesInfraV2,S=ctx.PlanoSugestoesSimplificadoV2,R=ctx.PlanoSugestoesRobustoV2,C=ctx.PlanoSugestoesV2;
assert(I&&S&&R&&C,'módulos V2 devem exportar APIs próprias');

// Auditoria estática: cada motor deve ser compilável e não pode executar o outro cérebro.
const simpleSrc=readFileSync(join(ROOT,'src/js/87-plano-sugestoes-simplificado-v2.js'),'utf8');
const robustSrc=readFileSync(join(ROOT,'src/js/88-plano-sugestoes-robusto-v2.js'),'utf8');
const controllerSrc=readFileSync(join(ROOT,'src/js/89-plano-sugestoes-controller-v2.js'),'utf8');
const infraSrc=readFileSync(join(ROOT,'src/js/86-plano-sugestoes-infra-v2.js'),'utf8');
assert(!/PlanoEngine\s*[.(]|Mentor90V5\s*[.(]|PlanoSugestoesRobustoV2\s*[.(]/.test(simpleSrc),'Simplificado não pode executar PlanoEngine/Mentor90/Robusto');
assert(!/PlanoSugestoesSimplificadoV2|plano-simplificado-v2/.test(robustSrc),'Robusto não pode depender do módulo/estado Simplificado');
assert(/PlanoSugestoesSimplificadoV2/.test(controllerSrc)&&/PlanoSugestoesRobustoV2/.test(controllerSrc),'somente o orquestrador deve conhecer os dois motores');
assert(!/scoreBruto|politicaAprendida|lacunaPP|pontosGanho/.test(infraSrc),'infraestrutura neutra não pode carregar fórmula de prioridade');

const sp={...S.prefs(),fase:'pre',meta:90,minAmostra:20,alvoQuestoes:30,banca:'FGV'};
const pre=S.calcular(sp);
assert.equal(pre.erro,undefined);assert.equal(pre.itens.length,3);assert.equal(new Set(pre.itens.map(x=>x.disciplina)).size,3);
assert.equal(pre.itens.find(x=>x.disciplina==='A').nome,'A pior');assert(pre.itens.every(x=>x.qJanela>=20));
const pos=S.calcular({...sp,fase:'pos'});
assert.equal(pos.erro,undefined);assert.equal(pos.itens.length,3);assert.equal(pos.itens.find(x=>x.disciplina==='A').nome,'A segunda');
assert(pos.itens.every(x=>x.componentes.pesoMateria>0&&x.componentes.incidenciaDiscPct>0));

const rob=R.calcular();
assert.equal(rob.erro,undefined);assert.equal(rob.itens.length,3);assert.equal(new Set(rob.itens.map(x=>x.disciplina)).size,3);
assert.equal(rob.configPlano.metaOperacional,85);assert.equal(rob.configPlano.minAmostra,20);
assert(rob.itens.every(x=>x.alvo>=x.doseDiaria));assert(rob.itens.every(x=>x.componentes&&Object.keys(x.componentes).length>=5));
assert(rob.itens.every(x=>x.intervencao&&x.intervencao.tipo));
assert(rob.itens.every(x=>x.auditoria.calibracaoConfiavel===false),'3 ciclos não podem personalizar resposta/intervenção');
assert(rob.itens.every(x=>x.mentor.calibracao.baixaResposta===false),'V6 deve neutralizar baixa resposta com menos de 5 ciclos');
assert(rob.itens.every(x=>x.intervencao.tipo!=='revisao_questoes'),'baixa resposta com só 3 ciclos não pode disparar revisão teórica');

// Isolamento runtime: quebrar um motor não altera o outro.
const preSignature=pre.itens.map(x=>[x.disciplina,x.nome,Math.round(x.score*1000)]);
const robustOriginal=R.calcular;
R.calcular=()=>{throw new Error('robusto indisponível');};
assert.deepEqual(S.calcular(sp).itens.map(x=>[x.disciplina,x.nome,Math.round(x.score*1000)]),preSignature);
R.calcular=robustOriginal;
const robSignature=rob.itens.map(x=>[x.disciplina,x.nome,Math.round(x.score*1000)]);
const simpleOriginal=S.calcular;
S.calcular=()=>{throw new Error('simplificado indisponível');};
assert.deepEqual(R.calcular().itens.map(x=>[x.disciplina,x.nome,Math.round(x.score*1000)]),robSignature);
S.calcular=simpleOriginal;

// Configurações independentes: preferências do Simplificado não mexem no Robusto e vice-versa.
S.salvar({meta:99,minAmostra:2,alvoQuestoes:77,fase:'pre'});
const rob2=R.calcular();assert.equal(rob2.configPlano.metaOperacional,85);assert.equal(rob2.configPlano.minAmostra,20);
assert(rob2.itens.every(x=>x.alvo!==77),'alvo simples não pode contaminar alvo robusto');
const simpleBefore=S.calcular({...S.prefs(),fase:'pre'}).itens.map(x=>[x.disciplina,x.nome,x.alvo]);
planPrefs={...planPrefs,metaDominio:72,minAmostra:7};
const robustChanged=R.calcular();assert.equal(robustChanged.configPlano.metaOperacional,72);assert.equal(robustChanged.configPlano.minAmostra,7);
assert.deepEqual(S.calcular({...S.prefs(),fase:'pre'}).itens.map(x=>[x.disciplina,x.nome,x.alvo]),simpleBefore,'mudar PlanoEngine não pode alterar Simplificado');
planPrefs={...planPrefs,metaDominio:85,minAmostra:20};

// Comparar não mistura escalas: usa posição de cada motor + consenso.
S.salvar({meta:90,minAmostra:20,alvoQuestoes:30,fase:'pre'});
const comp=C.comparar();
assert.equal(comp.itens.length,3);assert(comp.itens.every(x=>x.simplificado||x.robusto));
assert(comp.itens.every(x=>!Object.hasOwn(x,'scoreMath')&&Number.isFinite(x.pontosComparacao)),'Comparar não pode comparar scores matemáticos heterogêneos');

// Aprendizado conservador: exige 12 ciclos e só altera sinal que se repete nas duas metades.
for(let i=0;i<11;i++) extras.push({id:'h'+i,status:'concluida',origemPlano:{sugestao:{motor:'robusto-v3',componentes:{pontos:i/11,ppm:i/12,lacuna:1-i/20,incidencia:(i%5)/5,recencia:(i%4)/4,resposta:i/15}},veredito:{ganhoPP:1+i*.2,questoes:20+i}}});
let pol=R.politicaAprendida('pos');assert.equal(pol.aprendida,false);
extras.push({id:'h11',status:'concluida',origemPlano:{sugestao:{motor:'robusto-v3',componentes:{pontos:1,ppm:.92,lacuna:.45,incidencia:.2,recencia:.75,resposta:.73}},veredito:{ganhoPP:3.4,questoes:31}}});
pol=R.politicaAprendida('pos');assert.equal(pol.aprendida,true);assert.equal(pol.n,12);assert.equal(pol.validacao,'duas-metades-sinal-estavel');
assert(Math.abs(Object.values(pol.pesos).reduce((a,b)=>a+b,0)-1)<1e-9);assert(Object.values(pol.pesos).every(v=>v>0&&v<.6));

// Execução única + metadados do motor escolhido + bloqueio transversal de disciplina aberta.
const escolhido=R.calcular().itens[0], antes=extras.length;
const n=C.criar(ctx.ExtrasScreen,{modo:'robusto'},{modo:'robusto',itens:[escolhido]});
assert.equal(n,1);const novo=extras.at(-1);assert.equal(extras.length,antes+1);assert.equal(novo.alvo,escolhido.alvo);
assert.equal(novo.origemPlano.sugestao.motor,'robusto-v3');assert.equal(novo.origemPlano.sugestao.arquitetura.usaSimplificado,false);
assert.equal(novo.origemPlano.sugestao.meta,85);
assert((S.calcular({...S.prefs(),fase:'pre'}).itens||[]).every(x=>x.disciplina!==escolhido.disciplina));

console.log('OK: motores V2 independentes — dados, estado, fórmulas, aprendizado e falhas isolados; Comparar só orquestra saídas públicas.');
