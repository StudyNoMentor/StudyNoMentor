#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const read=p=>readFileSync(join(ROOT,p),'utf8');

// Executa somente o objeto PlanManager, com DB mínimo e determinístico.
const src=read('src/js/12-planos-perfis.js');
const start=src.indexOf('const PlanManager = {');
const marker='\n};\n\n/* ============================================================\n   PERFIS DE ACESSO';
const end=src.indexOf(marker,start);
assert.ok(start>=0&&end>start,'PlanManager deve ser localizável');

const mem=new Map();
const pfx='diario-estudos:u:u1:';
mem.set(pfx+'planejamentos',JSON.stringify([
  {id:'A',nome:'Atual',tipo:'Pós-edital',createdAt:'2026-09-23T00:00:00.000Z'},
  {id:'B',nome:'Antigo',tipo:'Pré-edital',createdAt:'2026-01-01T00:00:00.000Z'}
]));
mem.set(pfx+'active-plan','A');

const localStorage={
  getItem:k=>mem.has(String(k))?mem.get(String(k)):null,
  setItem:(k,v)=>mem.set(String(k),String(v)),
  removeItem:k=>mem.delete(String(k)),
  get length(){return mem.size;},
  key:i=>[...mem.keys()][i]??null
};
const DB={
  DEFAULT_METHODS:[],DEFAULT_PHASES:[],DEFAULT_STATUSES:[],DEFAULT_MODES:[],
  _profilePrefix:()=>pfx,
  _get:(k,d)=>{const r=localStorage.getItem(k);if(r==null)return d;try{return JSON.parse(r);}catch{return d;}},
  _set:(k,v)=>{localStorage.setItem(k,JSON.stringify(v));return true;},
  setRaw:(k,v)=>{localStorage.setItem(k,String(v));return true;},
  delRaw:(k)=>{localStorage.removeItem(k);return true;},
  _vendo:null,
  _planoEmVisualizacao(){const id=this._vendo;return id&&ctx.PlanManager.isPaused(id)?id:null;},
  _setPlanoEmVisualizacao(id){this._vendo=id||null;},
  _activePlanIdGravado:()=>localStorage.getItem(pfx+'active-plan')||'default',
  _activePlanId(){return this._planoEmVisualizacao()||this._activePlanIdGravado();},
  keysForPlan:id=>{
    const b=pfx+'p:'+id+':';
    return {
      entries:b+'entries',decks:b+'decks',cards:b+'cards',bancasCards:b+'bancas-cards',
      links:b+'links',revlog:b+'revlog',revlogPendente:b+'revlog-pendente',revlogArquivo:b+'revlog-arquivo'
    };
  },
  invalidarRevlogMemoria(){},
  withPausedPlanWrite:fn=>fn(),
  _uid:()=>String(Date.now())
};
const ctx={
  DB,localStorage,console,Date,Math,JSON,Object,Array,String,Boolean,Number,
  CustomEvent:class{constructor(type,init){this.type=type;this.detail=init&&init.detail;}},
  window:{dispatchEvent(){}},
  _quiet(){}
};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(src.slice(start,end+3)+'\n;globalThis.PlanManager=PlanManager;',ctx,{filename:'PlanManager'});
const P=ctx.PlanManager;

assert.equal(P.getOperationalPlans().length,2);
let r=P.pausePlan('B');
assert.equal(r.ok,true,'plano antigo deve poder ser pausado');
assert.equal(P.isPaused('B'),true);
assert.ok(P.pauseInfo('B').pausedAt,'pausa deve registrar data de congelamento');
assert.deepEqual(Array.from(P.getOperationalPlans(),x=>x.id),['A'],'plano pausado não pode permanecer operacional');
assert.equal(P.setActivePlan('B'),false,'plano pausado não pode virar contexto ativo');
assert.equal(P.getActivePlanId(),'A');

r=P.resumePlan('B');
assert.equal(r.ok,true);
assert.equal(P.isPaused('B'),false);
assert.equal(P.setActivePlan('B'),true,'reativado pode voltar a ser ativo');
assert.equal(P.getActivePlanId(),'B');

r=P.pausePlan('B');
assert.equal(r.ok,true);
assert.equal(P.getActivePlanId(),'A','pausar o ativo deve migrar para outro operacional');
r=P.pausePlan('A');
assert.equal(r.ok,false);
assert.equal(r.reason,'last-operational','nunca pode deixar o perfil sem planejamento operacional');
assert.equal(P.deletePlan('A'),false,'não pode excluir o último operacional enquanto só restarem pausados');
assert.equal(P.getActivePlanId(),'A','proteção de exclusão deve preservar o contexto operacional');

// Excluir um planejamento pausado NÃO pode apagar conhecimento global.
const kb=DB.keysForPlan('B'),ka=DB.keysForPlan('A');
DB._set(kb.decks,[{id:'dB',nome:'Direito'}]);
DB._set(kb.cards,[{id:'cB',ankiId:301,deckId:'dB',noteId:101,ankiNoteId:101,notetypeId:201,frente:'F',verso:'V'}]);
DB._set(kb.revlog,[{reviewId:'rB',cardId:'cB',ts:1}]);
DB._set(kb.links,[{id:'lB',nome:'TEC',url:'https://example.test'}]);
DB.setRaw(pfx+'p:B:cards-notetype:201',JSON.stringify({id:201,ankiId:201,name:'Basic',kind:'normal'}));
DB.setRaw(pfx+'p:B:cards-note:101',JSON.stringify({id:101,ankiId:101,notetypeId:201,fields:{Front:'F',Back:'V'}}));
DB.setRaw(pfx+'p:B:cards-future:xyz',JSON.stringify({future:true,payload:'preservar'}));
assert.equal(P.deletePlan('B'),true,'plano pausado deve poder ser excluído com migração prévia');
assert.equal(P.getPlans().some(x=>x.id==='B'),false);
assert.equal(DB._get(ka.cards,[]).length,1,'card deve sobreviver no planejamento operacional');
assert.equal(DB._get(ka.decks,[]).length,1,'deck deve sobreviver');
assert.equal(DB._get(ka.revlog,[]).length,1,'revlog deve sobreviver');
assert.equal(DB._get(ka.links,[]).length,1,'link global deve sobreviver');
assert.ok(localStorage.getItem(pfx+'p:A:cards-note:101'),'Note deve ser migrada');
assert.ok(localStorage.getItem(pfx+'p:A:cards-notetype:201'),'NoteType deve ser migrado');
assert.equal(JSON.parse(localStorage.getItem(pfx+'p:A:cards-future:xyz')).future,true,'entidade cards-* futura deve sobreviver sem conhecimento prévio da versão');
assert.equal(localStorage.getItem(pfx+'p:B:cards-note:101'),null,'entidade antiga deve sair da origem excluída');
assert.equal(localStorage.getItem(pfx+'p:B:cards-future:xyz'),null,'entidade futura migrada deve sair da origem excluída');

// ── Pausa DATADA: janela [from, until) escolhida pela pessoa ───────────────
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dia=n=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+n);return iso(d);};
const hoje=dia(0);
P.savePlans(P.getPlans().concat([
  {id:'C',nome:'Agendado',tipo:'Outro',createdAt:'2026-01-01T00:00:00.000Z'},
  {id:'D',nome:'Retroativo',tipo:'Outro',createdAt:'2026-01-01T00:00:00.000Z'}
]));
assert.equal(P.getActivePlanId(),'A');

// Pausa futura: o plano segue operando até lá; os dias da janela já contam como pausados.
r=P.pausePlan('C',{from:dia(5)});
assert.equal(r.ok,true); assert.equal(r.scheduled,true);
assert.equal(P.isPaused('C'),false,'pausa agendada não congela hoje');
assert.equal(P.scheduledPause('C').from,dia(5));
assert.equal(P.isPausedOn('C',dia(4)),false);
assert.equal(P.isPausedOn('C',dia(5)),true);
assert.equal(P.isDayPaused(dia(30),'C'),true,'sem retorno a pausa é indefinida');
assert.equal(P.nextOperationalDay(dia(6),'C'),null,'pausa indefinida não tem próximo dia operacional');
assert.equal(P.nextOperationalDay(dia(2),'C'),dia(2));
// Retorno agendado dentro da pausa agendada.
r=P.resumePlan('C',{from:dia(9)});
assert.equal(r.ok,true);
assert.equal(P.nextOperationalDay(dia(6),'C'),dia(9),'retorno definido reabre a agenda');
assert.equal(P.pausedDaysBetween(dia(0),dia(20),'C'),4,'4 dias congelados: +5..+8');
assert.equal(P.operationalDaysBetween(dia(0),dia(6),'C'),5);
// Reagendar substitui a pausa futura; cancelar remove.
r=P.pausePlan('C',{from:dia(7),until:dia(8)});
assert.equal(r.ok,true);
assert.deepEqual(Array.from(P.pauseWindows('C'),w=>[w.from,w.until]),[[dia(7),dia(8)]]);
assert.equal(P.cancelScheduledPause('C').ok,true);
assert.equal(P.pauseWindows('C').length,0);
assert.equal(P.pausePlan('C',{from:dia(3),until:dia(3)}).reason,'until-before-from');

// Pausa retroativa: congela desde a data escolhida.
r=P.pausePlan('D',{from:dia(-10)});
assert.equal(r.ok,true); assert.equal(r.scheduled,false);
assert.equal(P.isPaused('D'),true,'pausa retroativa já está vigente');
assert.equal(P.pauseInfo('D').from,dia(-10));
assert.equal(P.pausedDaysBetween(dia(-12),hoje,'D'),11);
assert.equal(P.isPausedOn('D',dia(-11)),false,'dia anterior à pausa continua contando');
// Retorno anterior ao início é recusado; retorno retroativo reabre desde a data.
assert.equal(P.resumePlan('D',{from:dia(-11)}).reason,'before-pause');
r=P.resumePlan('D',{from:dia(-3)});
assert.equal(r.ok,true); assert.equal(r.scheduled,false);
assert.equal(P.isPaused('D'),false);
assert.equal(P.isPausedOn('D',dia(-5)),true,'janela encerrada continua valendo para métricas e atrasos');
assert.equal(P.isPausedOn('D',dia(-3)),false,'dia do retorno volta a contar');
assert.equal(P.pausePlan('D',{from:dia(-6)}).reason,'overlap','nova pausa não pode sobrepor a anterior');
// Retorno agendado: segue pausado até a data.
r=P.pausePlan('D',{from:dia(-1)});
assert.equal(r.ok,true);
r=P.resumePlan('D',{from:dia(2)});
assert.equal(r.ok,true); assert.equal(r.scheduled,true);
assert.equal(P.isPaused('D'),true,'retorno futuro mantém a pausa até lá');
assert.equal(P.pauseInfo('D').until,dia(2));
assert.equal(P.pauseWindows('D').length,2,'histórico de pausas preservado');
// Retorno no próprio dia de início desfaz a janela inteira.
r=P.resumePlan('D',{from:dia(-1)});
assert.equal(r.ok,true); assert.equal(r.cancelled,true);
assert.equal(P.pauseWindows('D').length,1);

// Cobertura: não pode ficar dia algum sem planejamento operacional.
P.pausePlan('C',{from:dia(3)});
P.pausePlan('D',{from:dia(4)});
assert.equal(P.pausePlan('A',{from:dia(10)}).reason,'last-operational','pausas indefinidas nos demais não cobrem o futuro');
P.cancelScheduledPause('C'); P.cancelScheduledPause('D');

// Formato legado ({pausedAt,resumedAt}) continua lido.
assert.equal(P.pausedOnFromRecord({pausedAt:new Date(Date.now()-86400000*2).toISOString(),resumedAt:null},hoje),true);
assert.equal(P.pausedOnFromRecord({pausedAt:new Date(Date.now()-86400000*2).toISOString(),resumedAt:new Date().toISOString()},hoje),false);

// Contrato transversal: operação congela; conhecimento Anki continua global.
const db=read('src/js/11-db.js');
assert.match(db,/_blockedByPlanPause\(key\)/,'DB deve proteger escrita operacional');
assert.match(db,/suffix === 'cards'/,'Cards devem ser exceção explícita do congelamento');
assert.match(db,/suffix === 'decks'/,'Decks Anki devem continuar disponíveis');
assert.match(db,/suffix === 'revlog'/,'revisões Anki devem continuar graváveis');
assert.match(db,/suffix === 'links'/,'Links Úteis globais devem continuar editáveis com origem pausada');
assert.match(db,/suffix\.startsWith\('cards-'\)/,'Note\/NoteType e entidades Anki devem continuar graváveis');

const scope=read('src/js/94-global-scope.js');
assert.match(scope,/DB\.getAllCardsTagged = \(\) => S\.cards\('all'\)/,'Cards globais devem incluir origens pausadas');
assert.match(scope,/DB\.getAllExtrasTagged = \(opts\).*operationalAllBy\('extras'\)/,'Extras pausados não podem entrar em visão operacional');
assert.match(scope,/opts && opts\.includePaused.*S\.allBy\('extras'\)/,'trajetória deve conseguir incluir Extras pausados');
assert.match(scope,/S\.operationalAllBy\('tec'\)/,'TEC pausado não pode contaminar métrica global');
assert.match(scope,/S\.operationalAllBy\('incidencia'\)/,'incidência pausada não pode contaminar motor pós-edital');

const hist=read('src/js/40-tela-historico.js');
assert.match(hist,/getAllCycleHistoryTagged\(\{ includePaused: true \}\)/,'histórico deve continuar consultando planos pausados');

const fila=read('src/js/54-reforco-fila.js');
const leis=read('src/js/56-leis-rodizio.js');
const motor=read('src/js/86-motor-sugestao.js');
assert.match(fila,/isActivePlanPaused/,'fila de Extras deve parar no plano pausado');
assert.match(leis,/isActivePlanPaused/,'rodízio de Lei Seca deve parar no plano pausado');
assert.match(motor,/erro: 'plano-pausado'/,'Motor não deve gerar sugestão para plano pausado');
assert.match(motor,/planSettingRaw/,'preferências do Motor devem ser por planejamento');
assert.match(fila,/planSettingRaw/,'preferências de Reforço devem ser por planejamento');
assert.match(leis,/planSettingRaw/,'preferências de Lei Seca devem ser por planejamento');
const tecScreen=read('src/js/51-tela-desempenho-tec.js');
assert.match(tecScreen,/planSettingRaw\('tec-prefs'\)/,'preferências estratégicas do TEC devem ser por planejamento');

const evo=read('src/js/41-tela-evolucao.js');
assert.match(evo,/getAllEntriesTagged\(\{ includePaused: true \}\)/,'Conquistas devem preservar toda a trajetória');
assert.match(evo,/scope: 'active'/,'Evolução deve abrir no escopo operacional ativo');
assert.match(evo,/includePaused: this\.scope === 'all'/,'Toda a trajetória deve incluir pausados explicitamente');

const report=read('src/js/70-relatorio.js');
assert.match(report,/cfg\.scope==='active'/,'Relatório deve distinguir planejamentos ativos');
assert.match(report,/includePaused:cfg\.scope==='all'/,'Relatório de toda trajetória deve incluir pausados');

const links=read('src/js/48-tela-links.js');
assert.match(links,/local\(l\) \{ return !!l; \}/,'Links devem ser editáveis globalmente');

const grade=read('src/js/33-tela-grade.js');
assert.match(grade,/PlanManager\.isPaused\(x\.plan\.id\) \? '⏸ '/,'origem pausada deve ser sinalizada ao copiar ciclo');

// Regras datadas aplicadas em todo o site.
const extrasScreen=read('src/js/47-tela-extras.js');
assert.match(extrasScreen,/_diaPausado\(day\)/,'agenda de Extras não gera ocorrência em dia pausado');
assert.match(read('src/js/55-extras-ui-moderna.js'),/_diaPausado\(d\)/,'dia pausado nunca vira atraso');
assert.match(fila,/nextOperationalDay\(dia\)/,'fila de reforço pula a pausa agendada');
assert.match(read('src/js/58-extras-governanca.js'),/nextOperationalDay\(dia\)/,'rebalanceamento pula a pausa agendada');
assert.match(leis,/isDayPaused\(dia\)/,'rodízio de Lei Seca não agenda dia pausado');
assert.match(read('src/js/60-relational-store.js'),/pausedOnFromRecord/,'hidratação usa a mesma regra datada');
assert.match(read('src/js/33-tela-grade.js'),/operationalDaysBetween/,'ritmo da semana ignora dias pausados');
assert.match(read('src/js/70-relatorio.js'),/pausedDaysBetween/,'frequência do relatório ignora dias pausados');

// Consulta de planejamento pausado: somente leitura, sem mexer no ponteiro gravado.
{
  if(!P.getPlans().some(p=>P.isPaused(p.id))){
    const alvo=P.getPlans().find(p=>String(p.id)!==String(DB._activePlanIdGravado()));
    assert.equal(P.pausePlan(alvo.id).ok,true,'prepara um planejamento pausado');
  }
  const pausado=P.getPlans().find(p=>P.isPaused(p.id));
  assert.ok(pausado,'há um planejamento pausado para consultar');
  {
    const gravado=DB._activePlanIdGravado();
    assert.equal(P.viewPausedPlan(pausado.id),true,'planejamento pausado deve abrir para consulta');
    assert.equal(P.getActivePlanId(),pausado.id,'contexto de leitura passa a ser o pausado');
    assert.equal(DB._activePlanIdGravado(),gravado,'ponteiro gravado continua no operacional');
    assert.equal(P._garantirAtivoOperacional(),null,'consulta não troca o planejamento gravado');
    assert.equal(P.exitPausedPlanView(),true,'sair da consulta');
    assert.equal(P.getActivePlanId(),gravado,'volta ao planejamento em uso');
  }
  const operacional=P.getOperationalPlans()[0];
  assert.equal(P.viewPausedPlan(operacional.id),false,'operacional não entra em modo consulta');
}

const ui=read('src/js/52-tela-planejamentos.js');
assert.match(ui,/btn-view-plan/,'planejamento pausado deve poder ser visualizado');
assert.match(read('src/js/11-db.js'),/_planoEmVisualizacao\(\)/,'contexto de leitura considera a consulta');
assert.match(ui,/btn-pause-plan/,'gestão deve expor botão Pausar');
assert.match(ui,/btn-resume-plan/,'gestão deve expor botão Reativar');
assert.match(ui,/type: 'date'/,'pausa e reativação devem permitir escolher a data');
assert.match(ui,/btn-cancel-pause-plan/,'pausa agendada deve poder ser cancelada');
assert.match(ui,/Cards\/Anki e Links Úteis continuam disponíveis globalmente/,'UI deve explicar o conhecimento global preservado');

console.log('COERÊNCIA ENTRE PLANEJAMENTOS: pausa, trajetória, ajustes por plano e preservação de conhecimento validados.');
