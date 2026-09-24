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
  _activePlanId:()=>localStorage.getItem(pfx+'active-plan')||'default',
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
assert.equal(P.deletePlan('B'),true,'plano pausado deve poder ser excluído com migração prévia');
assert.equal(P.getPlans().some(x=>x.id==='B'),false);
assert.equal(DB._get(ka.cards,[]).length,1,'card deve sobreviver no planejamento operacional');
assert.equal(DB._get(ka.decks,[]).length,1,'deck deve sobreviver');
assert.equal(DB._get(ka.revlog,[]).length,1,'revlog deve sobreviver');
assert.equal(DB._get(ka.links,[]).length,1,'link global deve sobreviver');
assert.ok(localStorage.getItem(pfx+'p:A:cards-note:101'),'Note deve ser migrada');
assert.ok(localStorage.getItem(pfx+'p:A:cards-notetype:201'),'NoteType deve ser migrado');
assert.equal(localStorage.getItem(pfx+'p:B:cards-note:101'),null,'entidade antiga deve sair da origem excluída');

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

const ui=read('src/js/52-tela-planejamentos.js');
assert.match(ui,/btn-pause-plan/,'gestão deve expor botão Pausar');
assert.match(ui,/btn-resume-plan/,'gestão deve expor botão Reativar');
assert.match(ui,/Cards\/Anki e Links Úteis continuam disponíveis globalmente/,'UI deve explicar o conhecimento global preservado');

console.log('COERÊNCIA ENTRE PLANEJAMENTOS: pausa, trajetória, ajustes por plano e preservação de conhecimento validados.');
