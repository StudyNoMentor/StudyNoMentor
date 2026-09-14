import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const mem=new Map();
const extras=[];
const baseItems=[
  {nome:'A pior',disciplina:'A',taxa:40,qJanela:100,custoQ:90,incid:30,pontosMateria:20,pontosGanho:3.6,diasDesdeMedicao:20},
  {nome:'A segunda',disciplina:'A',taxa:55,qJanela:120,custoQ:70,incid:70,pontosMateria:20,pontosGanho:4.9,diasDesdeMedicao:8},
  {nome:'B principal',disciplina:'B',taxa:60,qJanela:80,custoQ:65,incid:80,pontosMateria:15,pontosGanho:3.6,diasDesdeMedicao:50},
  {nome:'C principal',disciplina:'C',taxa:70,qJanela:90,custoQ:55,incid:40,pontosMateria:10,pontosGanho:0.8,diasDesdeMedicao:130,vencido:true},
  {nome:'D curta',disciplina:'D',taxa:20,qJanela:8,custoQ:100,incid:90,pontosMateria:25,pontosGanho:8,diasDesdeMedicao:5}
];
const clone=x=>JSON.parse(JSON.stringify(x));
const ctx={
  console,setTimeout:(fn)=>{fn();return 1;},clearTimeout(){},Date,Math,JSON,Set,Map,Promise,
  localStorage:{getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v))},
  document:{getElementById:()=>null},
  window:{},
  escapeHtml:s=>String(s),showToast(){},
  _quiet(){},todayLocal:()=> '2026-09-14',
  ReforcoEngine:{norm:s=>String(s||'').toLowerCase().trim()},
  DB:{
    _profilePrefix:()=> 'p:',setRaw:(k,v)=>mem.set(k,String(v)),getBancas:()=>['FGV'],
    getExtras:()=>extras,getTecSnapshots:()=>[],
    addExtra:data=>{const e={id:'e'+(extras.length+1),status:'ativa',historico:[],...clone(data)};extras.push(e);return e;},
    updateExtra:(id,patch)=>{const e=extras.find(x=>x.id===id);Object.assign(e,clone(patch));return e;}
  },
  PlanoEngine:{
    prefs:()=>({metaDominio:85,tetoDominio:90,minAmostra:20,banca:'FGV',validadeDias:120}),
    calcular:()=>({meta:85,validadeDias:120,itens:clone(baseItems),pequenas:[]}),
    atividadeSobreposta:()=>false
  },
  DesempenhoTecScreen:{scopedSnapshot:()=>({id:1}),bancaFiltro:()=> 'FGV',_casaUnidade:()=>false},
  PlanoPontos:{temComposicao:()=>true,modo:()=> 'pos',composicao:()=>[],anexarPontos:()=>true,_casarNomes:()=>({})},
  PlanoCiclo:{
    titulo:(n)=>'Reforçar: '+n,
    origem:(n,d,item)=>({topico:n,disciplina:d,taxaInicial:item.taxa,qBase:0,qBaseNo:0,metaAlvo:90,custoEstimado:item.custoQ,escopo:{tipo:'no',membros:[n]}})
  },
  ExtrasScreen:{puxarDoPlano(){return 'legacy';},render(){ctx.__renders=(ctx.__renders||0)+1;}},
  Mentor90V5:{
    dominio:x=>({nivel:x.taxa>=93?'elite':'em_aquisicao',rotulo:x.taxa>=93?'90%+ consolidado':'Em aquisição',pCompetitiva:Math.max(0,Math.min(1,(x.taxa-50)/50)),vencido:!!x.vencido}),
    calibracaoHierarquica:x=>({ganho100:x.disciplina==='C'?1:5,n:6,confianca:.55,baixaResposta:false}),
    incidenciaNormalizada:x=>({pct:x.incid/10,confianca:.95,bancas:1}),
    velocidade:()=>({confiavel:true,segundosPorQuestao:120,escopo:'global'}),
    intervencao:(item,rx,dom,cal,dose)=>({tipo:'questoes_dirigidas',rotulo:'Questões dirigidas',passos:[{tipo:'questoes',quantidade:dose}],motivo:'Teste',exigeNovaMedicao:true})
  },
  UI:{_open(){},_resolve:null,_mode:null}
};
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT,'src/js/86-plano-sugestoes-v1.js'),'utf8'),ctx,{filename:'86-plano-sugestoes-v1.js'});
vm.runInContext(readFileSync(join(ROOT,'src/js/87-plano-sugestoes-governanca-v1.js'),'utf8'),ctx,{filename:'87-plano-sugestoes-governanca-v1.js'});
const E=ctx.PlanoSugestoesV1;
assert(E,'motor dual não exportado');

const def=E.prefs();
assert.equal(def.modo,'robusto');assert.equal(def.meta,90);assert.equal(def.minAmostra,20);

const pre=E.simplificado({...def,modo:'simplificado',fase:'pre',meta:90,minAmostra:20});
assert.equal(pre.erro,undefined);assert.equal(pre.itens.length,3);
assert.equal(new Set(pre.itens.map(x=>x.disciplina)).size,3,'simplificado deve devolver 3 disciplinas distintas');
assert.equal(pre.itens.find(x=>x.disciplina==='A').nome,'A pior','pré deve escolher maior lacuna dentro da disciplina');
assert(pre.itens.every(x=>x.item.qJanela>=20),'amostra curta não pode entrar no simplificado');

const pos=E.simplificado({...def,modo:'simplificado',fase:'pos',meta:90,minAmostra:20,banca:'FGV'});
assert.equal(pos.erro,undefined);assert.equal(pos.itens.length,3);assert.equal(new Set(pos.itens.map(x=>x.disciplina)).size,3);
assert(pos.itens.every(x=>x.componentes.pesoMateria>0&&x.componentes.incidenciaDiscPct>0),'pós deve cruzar peso do edital e incidência da banca');
assert.equal(pos.itens.find(x=>x.disciplina==='A').nome,'A segunda','pós pode preferir tópico mais incidente mesmo com lacuna menor');

const rob=E.robusto({...def,modo:'robusto',fase:'pos',meta:99,minAmostra:2,banca:'FGV'});
assert.equal(rob.erro,undefined);assert.equal(rob.itens.length,3);assert.equal(new Set(rob.itens.map(x=>x.disciplina)).size,3);
assert.equal(rob.configPlano.metaOperacional,85,'Robusto deve herdar meta operacional do Plano, não o campo do Simplificado');
assert.equal(rob.configPlano.minAmostra,20,'Robusto deve herdar amostra mínima do Plano');
assert(rob.itens.every(x=>x.alvo>=x.doseDiaria),'dose diária deve ser separada do alvo global');
assert(rob.itens.every(x=>x.componentes&&Object.keys(x.componentes).length>=5),'robusto deve registrar componentes auditáveis');
assert(rob.itens.every(x=>x.intervencao&&x.intervencao.tipo),'Robusto deve carregar intervenção Mentor 90+ explícita');

const comp=E.comparar({...def,modo:'comparar',fase:'pos',meta:90,minAmostra:20,banca:'FGV'});
assert.equal(comp.itens.length,3);assert.equal(new Set(comp.itens.map(x=>x.disciplina)).size,3);
assert(comp.itens.every(x=>x.simplificado||x.robusto),'comparar deve manter pelo menos uma decisão por disciplina');

// Aprendizado conservador: só entra após 10 ciclos com metadados do próprio motor.
for(let i=0;i<12;i++) extras.push({id:'h'+i,status:'concluida',origemPlano:{sugestao:{motor:'robusto-v2',componentes:{pontos:i/11,ppm:i/12,lacuna:1-i/20,incidencia:(i%5)/5,recencia:(i%4)/4,resposta:i/15}},veredito:{ganhoPP:1+i*.2,questoes:20+i}}});
const pol=E.politicaAprendida('pos');
assert.equal(pol.aprendida,true);assert.equal(pol.n,12);assert(Math.abs(Object.values(pol.pesos).reduce((a,b)=>a+b,0)-1)<1e-9);
assert(Object.values(pol.pesos).every(v=>v>0&&v<.6),'regularização não pode produzir peso extremo');

// Criação mantém alvo global, guarda intervenção e trava a disciplina enquanto a frente estiver aberta.
const escolhido=rob.itens[0];
const antes=extras.length;
const n=E.criar(ctx.ExtrasScreen,{...def,modo:'robusto',fase:'pos'}, {modo:'robusto',itens:[escolhido]});
assert.equal(n,1);const novo=extras.at(-1);assert.equal(extras.length,antes+1);
assert.equal(novo.alvo,escolhido.alvo,'alvo da atividade deve ser global');
assert.equal(novo.origemPlano.sugestao.doseDiaria,escolhido.doseDiaria,'dose diária deve ficar separada e auditável');
assert.equal(novo.origemPlano.sugestao.motor,'robusto-v2');
assert.equal(novo.origemPlano.sugestao.meta,85,'origem deve registrar a configuração efetiva do Robusto');
assert.equal(novo.origemPlano.sugestao.intervencao.tipo,'questoes_dirigidas','intervenção recomendada deve seguir auditável na atividade');
const depois=E.simplificado({...def,modo:'simplificado',fase:'pre',meta:90,minAmostra:20});
assert((depois.itens||[]).every(x=>x.disciplina!==escolhido.disciplina),'disciplina com reforço aberto não pode entrar na rodada seguinte');

console.log('OK: Plano dual — Simplificado Pré/Pós, Robusto, Comparar, 3 disciplinas × 1 tópico, governança e aprendizado conservador.');
