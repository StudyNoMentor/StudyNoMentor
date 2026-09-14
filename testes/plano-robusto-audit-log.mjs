import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url))),mem=new Map(),extras=[];
const clone=x=>JSON.parse(JSON.stringify(x));
let createSeq=0;
const robustResult={
  modo:'robusto',fase:'pre',explicacao:'Robusto V6 observacional',configPlano:{metaOperacional:85,minAmostra:20},
  politica:{n:18,aprendida:true,outcome:'ganho-pp-hora'},
  itens:[
    {disciplina:'Auditoria',nome:'Amostragem',score:88.5,taxa:61,qJanela:80,qHist:160,alvo:45,doseDiaria:18,meta:90,minAmostra:20,fase:'pre',componentes:{lacuna:.8,evidencia:.7,recencia:.3},mentor:{dominio:{nivel:'em_aquisicao',pCompetitiva:.2},calibracao:{nivel:'disciplina',n:7,ganho100:4.5},tempo:{confiavel:true,segundosPorQuestao:90,q:120,escopo:'disciplina'}},intervencao:{tipo:'revisao_questoes',rotulo:'Revisão + questões'},otimizacaoV5:{minutosAlocados:27},auditoria:{robustoV6:true,revisaoAuditoria:6}},
    {disciplina:'Contabilidade',nome:'Estoques',score:76,taxa:68,qJanela:90,qHist:180,alvo:40,doseDiaria:16,meta:90,minAmostra:20,fase:'pre',componentes:{lacuna:.65,evidencia:.8,recencia:.2},mentor:{dominio:{nivel:'em_aquisicao'},calibracao:{nivel:'global',n:20},tempo:{confiavel:false}},intervencao:{tipo:'questoes_direcionadas',rotulo:'Questões direcionadas'},otimizacaoV5:{minutosAlocados:24}},
    {disciplina:'Direito Tributário',nome:'Crédito tributário',score:70,taxa:72,qJanela:70,qHist:140,alvo:35,doseDiaria:14,meta:90,minAmostra:20,fase:'pre',componentes:{lacuna:.55,evidencia:.75,recencia:.5},mentor:{dominio:{nivel:'em_aquisicao'},calibracao:{nivel:'global',n:20},tempo:{confiavel:false}},intervencao:{tipo:'lei_seca_questoes',rotulo:'Lei seca + questões'},otimizacaoV5:{minutosAlocados:22}}
  ]
};
robustResult.todos=[...robustResult.itens,{disciplina:'AFO',nome:'Receita pública',score:64,taxa:75,qJanela:60,alvo:30,doseDiaria:12,componentes:{lacuna:.4,evidencia:.7,recencia:.3}}];

const controller={
  prefs:()=>({modo:'robusto'}),
  robusto:()=>clone(robustResult),
  criar(){
    const c=robustResult.itens[0],id='e'+(++createSeq),extra={id,status:'ativa',disciplina:c.disciplina,alvo:c.alvo,progresso:0,historico:[],createdAt:'2026-09-14T18:00:00-03:00',origemPlano:{disciplina:c.disciplina,topico:c.nome,qBase:80,qBaseNo:80,taxaInicial:c.taxa,sugestao:{motor:'robusto-v5',modoInterface:'robusto',fase:'pre',score:c.score,alvoGlobal:c.alvo,doseDiaria:c.doseDiaria,componentes:clone(c.componentes),intervencao:clone(c.intervencao),otimizacaoV5:clone(c.otimizacaoV5),configRobusto:{modo:'base',revisaoAuditoria:6},criadoEm:'2026-09-14'}}};extras.push(extra);return 1;
  }
};
const robust={MOTOR:'robusto-v5',VERSAO:6,REVISAO_AUDITORIA:6,modoAtaque:()=> 'base'};
const config={detectarModo:()=> 'base',prefs:()=>({aprendizado:{minCiclos:12},dominio:{metaCompetitiva:90},tempo:{minQConfiavel:50},scoringPre:{lacuna:.5,evidencia:.5}})};
const ctx={console,Date,Math,JSON,Set,Map,Promise,setTimeout:(fn)=>{fn();return 1;},clearTimeout(){},crypto:{randomUUID:()=> '00000000-0000-4000-8000-'+String(Math.random()).slice(2,14).padEnd(12,'0')},
  localStorage:{getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)},
  DB:{_profilePrefix:()=> 'p:',setRaw:(k,v)=>mem.set(k,String(v)),getExtras:()=>extras,getTecSnapshots:()=>[{id:77,endDate:'2026-09-12'}]},
  DesempenhoTecScreen:{scopeMode:'consolidado',selectedSnapIds:new Set([1,2]),rangeStart:null,rangeEnd:null},
  document:{querySelector:()=>({content:'vteste'}),createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},
  URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Blob:class{},todayLocal:()=> '2026-09-14',_quiet(){},
  window:{addEventListener(){},PlanoSugestoesV4:controller,PlanoSugestoesRobustoV6:robust,PlanoRobustoConfigV6:config}
};ctx.window=Object.assign(ctx.window,ctx);vm.createContext(ctx);
const path='src/js/89a-plano-robusto-audit-log-v1.js',src=readFileSync(join(ROOT,path),'utf8');vm.runInContext(src,ctx,{filename:path});
const A=ctx.window.PlanoRobustoAuditV1,C=ctx.window.PlanoSugestoesV4;assert(A&&C,'logger deve instalar');
assert.equal(A.SCHEMA,'studynomentor.robusto-audit.v1');assert.equal(A.VERSAO,1);
assert(!/PlanoSugestoesSimplificado/.test(src),'logger do Robusto não pode depender do Simplificado');
assert(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/.test(src),'logger local não pode criar transporte de rede');

// decisão é observada, mas recalcular a mesma proposta em seguida não polui o histórico.
C.robusto();C.robusto();let state=JSON.parse(mem.get('p:'+A.KEY));assert.equal(state.events.filter(e=>e.tipo==='decisao').length,1,'decisão idêntica deve ser deduplicada');assert.equal(Object.keys(state.configs).length,1,'configuração repetida deve ser referenciada, não duplicada');
const dec=state.events.find(e=>e.tipo==='decisao');assert.equal(dec.selecionados.length,3);assert.ok(dec.candidatos.length>=3);assert.equal(dec.escopo.retratosSelecionados,2);assert.equal(dec.selecionados[0].componentes.lacuna,.8);

// criação real em Extras deve se ligar à decisão que a originou e criar o marco inicial do outcome.
C.criar();state=JSON.parse(mem.get('p:'+A.KEY));const created=state.events.find(e=>e.tipo==='atividade_criada');assert(created,'atividade robusta criada deve entrar no log');assert.equal(created.extraId,'e1');assert.equal(created.decisionId,dec.id);assert.equal(created.componentes.lacuna,.8);assert.equal(state.events.filter(e=>e.tipo==='resultado_snapshot').length,1,'criação deve materializar snapshot inicial auditável');

// progresso humano + tempo + nova medição viram label observacional de calibração.
const e1=extras[0];e1.historico=[{data:'2026-09-15',quantidade:30,minutos:60,acertos:24,erros:6}];e1.progresso=30;e1.status='concluida';e1.updatedAt='2026-09-15T21:00:00-03:00';e1.origemPlano.veredito={ganhoPP:8,questoes:30,taxa:69,em:'2026-09-16'};
A.reconciliar();state=JSON.parse(mem.get('p:'+A.KEY));const outcomes=state.events.filter(e=>e.tipo==='resultado_snapshot');assert.equal(outcomes.length,2);const latest=outcomes.at(-1);assert.equal(latest.historico.questoes,30);assert.equal(latest.historico.minutos,60);assert.equal(latest.medicao.ganhoPP,8);
A.reconciliar();state=JSON.parse(mem.get('p:'+A.KEY));assert.equal(state.events.filter(e=>e.tipo==='resultado_snapshot').length,2,'reconciliação sem mudança não deve duplicar snapshot');

const payload=A.gerarPayload();assert.equal(payload.schema,A.SCHEMA);assert.equal(payload.meta.motor,'robusto-v5');assert.match(payload.meta.privacidade,/local-only/);assert.equal(payload.diagnostico.paresObservados,1);assert.equal(payload.diagnostico.paresComTempo,1);assert.equal(payload.diagnostico.horasExecutadas,1);assert.equal(payload.calibrationDataset.length,1);const pair=payload.calibrationDataset[0];assert.equal(pair.features.componentes.lacuna,.8);assert.equal(pair.outcome.observado,true);assert.equal(pair.outcome.ganhoPP,8);assert.equal(pair.outcome.ganhoPPHora,8);assert(Math.abs(pair.outcome.ganhoPP100q-26.6667)<.001);assert.equal(pair.outcome.concluida,true);

// Mudança posterior gera novo snapshot, mas o dataset usa somente o estado mais recente.
e1.historico.push({data:'2026-09-16',quantidade:10,minutos:20,acertos:9,erros:1});e1.origemPlano.veredito={ganhoPP:10,questoes:40,taxa:71,em:'2026-09-17'};A.reconciliar();const p2=A.gerarPayload(),pair2=p2.calibrationDataset[0];assert.equal(p2.events.filter(e=>e.tipo==='resultado_snapshot').length,3);assert.equal(pair2.outcome.ganhoPP,10);assert.equal(pair2.outcome.questoesExecutadas,40);assert.equal(pair2.outcome.minutosExecutados,80);

// Extra robusta preexistente também deve ser descoberta em uma única reconciliação.
extras.push({id:'legacy',status:'concluida',disciplina:'Contabilidade',alvo:20,progresso:20,historico:[{data:'2026-09-18',quantidade:20,minutos:30}],origemPlano:{disciplina:'Contabilidade',topico:'Estoques',taxaInicial:60,qBase:40,sugestao:{motor:'robusto-v5',fase:'pre',alvoGlobal:20,componentes:{lacuna:.6},configRobusto:{modo:'base'}},veredito:{ganhoPP:4,questoes:20,taxa:64,em:'2026-09-19'}}});
A.reconciliar();const p3=A.gerarPayload();assert(p3.events.some(e=>e.tipo==='atividade_criada'&&e.extraId==='legacy'),'reconciliação deve materializar criação legada');assert(p3.events.some(e=>e.tipo==='resultado_snapshot'&&e.extraId==='legacy'),'mesma reconciliação deve materializar resultado legado');assert.equal(p3.calibrationDataset.filter(x=>x.outcome.observado).length,2);

// Dados arbitrários de conta não podem vazar para o arquivo.
mem.set('email','humano@example.com');mem.set('token','segredo-super-sensivel');const json=JSON.stringify(A.gerarPayload());assert(!json.includes('humano@example.com'));assert(!json.includes('segredo-super-sensivel'));
console.log('OK: auditoria Robusto V1 — decisão, dedupe, criação, desfecho humano, dataset de calibração, privacidade local e reconciliação legada validados.');
