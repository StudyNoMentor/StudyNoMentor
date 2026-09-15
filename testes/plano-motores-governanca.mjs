import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const mem=new Map();
let calls={simple:0,robust:0,compare:0,create:0};
let uiMode='robusto';
const doc={
  readyState:'complete',getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},createElement(){return{};}
};
const listeners=new Map();
const ctx={
  console,JSON,Math,Set,Map,Promise,setTimeout:(fn)=>{fn();return 1;},clearTimeout(){},
  localStorage:{getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v))},
  document:doc,CustomEvent:class{constructor(type,opt){this.type=type;this.detail=opt?.detail;}},
  DB:{_profilePrefix:()=> 'p:',setRaw:(k,v)=>mem.set(k,String(v))},
  _quiet(){},showToast(){},
  UI:{_open(){},_resolve:null,_mode:null},
  PlanoSugestoes:{
    KEY:'plano-sug-ui-v5',
    prefs(){return{modo:uiMode,fase:'pre',meta:90,minAmostra:20,banca:'__todas__',alvoQuestoes:30};},
    salvar(p){if(['simplificado','robusto','comparar'].includes(p?.modo))uiMode=p.modo;return this.prefs();},
    simplificado(){calls.simple++;return{modo:'simplificado',itens:[{disciplina:'A'}]};},
    robusto(){calls.robust++;return{modo:'robusto',itens:[{disciplina:'B'}]};},
    comparar(){calls.compare++;return{modo:'comparar',itens:[{disciplina:'C'}]};},
    calcular(p){return p?.modo==='simplificado'?this.simplificado(p):p?.modo==='comparar'?this.comparar(p):this.robusto();},
    criar(){calls.create++;return 1;},
    _cabecalho(){return '<div class="ps-mode-grid"></div><div class="ps-rule">ok</div>';},
    _renderModal(){},_erroTexto(){return'x';}
  },
  window:{
    addEventListener:(k,fn)=>listeners.set(k,fn),dispatchEvent:ev=>{const fn=listeners.get(ev.type);if(fn)fn(ev);}
  }
};
ctx.window=Object.assign(ctx.window,ctx);
vm.createContext(ctx);
const src=readFileSync(join(ROOT,'src/js/90-plano-motores-governanca.js'),'utf8');
vm.runInContext(src,ctx,{filename:'90-plano-motores-governanca-v5.js'});
const G=ctx.window.PlanoMotoresGovernanca,C=ctx.window.PlanoSugestoes;
assert(G&&C,'governança V6 deve instalar sobre o controller atual');

assert.deepEqual({...G.estado()},{simplificado:true,robusto:true},'compatibilidade: os dois motores devem nascer ativos');
assert.deepEqual([...G.ativos()],['simplificado','robusto','comparar']);
assert.equal(G.resolverModo('comparar'),'comparar');

G.salvar({simplificado:false,campoEstranho:true});
assert.deepEqual({...G.estado()},{simplificado:false,robusto:true},'persistência deve aceitar somente os dois booleanos');
assert.deepEqual(Object.keys(JSON.parse(mem.get('p:'+G.KEY))).sort(),['robusto','simplificado']);
assert.equal(G.resolverModo('simplificado'),'robusto','preferência velha de motor desligado deve migrar para o ativo');
assert.equal(G.resolverModo('comparar'),'robusto','Comparar não existe com um único motor');
uiMode='simplificado';
assert.equal(C.prefs().modo,'robusto','prefs do controller nunca pode devolver motor desabilitado');
const beforeSimple=calls.simple,beforeRob=calls.robust;
assert.equal(C.calcular({modo:'simplificado'}).modo,'robusto');
assert.equal(calls.simple,beforeSimple,'cálculo não pode executar Simplificado desabilitado');
assert.equal(calls.robust,beforeRob+1,'cálculo deve recuar para Robusto habilitado');

G.salvar({simplificado:true,robusto:false});
uiMode='robusto';
assert.equal(C.prefs().modo,'simplificado');
const r0=calls.robust,s0=calls.simple;
assert.equal(C.calcular({modo:'robusto'}).modo,'simplificado');
assert.equal(calls.robust,r0,'cálculo não pode executar Robusto desabilitado');
assert.equal(calls.simple,s0+1);
assert.equal(C.salvar({modo:'comparar'}).modo,'simplificado','salvar Comparar deve sanear para o único motor ativo');

G.salvar({simplificado:false,robusto:false});
assert.equal(G.resolverModo('robusto'),null);
assert.deepEqual([...G.ativos()],[]);
const c0={...calls};
const off=C.calcular({modo:'robusto'});
assert.equal(off.erro,'motores-desabilitados');
assert.equal(off.itens.length,0);
assert.deepEqual(calls,c0,'nenhum cérebro pode ser executado quando ambos estão desligados');
assert.equal(C.criar({}, {modo:'robusto'}, {itens:[{}]}),0,'execução deve ser bloqueada também no último instante');
assert.equal(calls.create,c0.create,'governança não pode delegar criação com ambos desligados');

G.restaurar();
assert.deepEqual({...G.estado()},{simplificado:true,robusto:true});
assert.equal(G.resolverModo('comparar'),'comparar');

assert(!/saveExtras|removeExtra|deleteExtra|updateExtra/.test(src),'governança não pode apagar ou reescrever atividades históricas');
assert(/tec-subtab\[data-tectab="plano"\]/.test(src)&&/extras-plano-btn/.test(src),'visibilidade deve cobrir Plano TEC e Puxar em Extras');
assert(/ConfigScreen/.test(src)&&/cfg-plano-motores-card/.test(src),'configuração global deve ser exposta na tela Configurações');
console.log('OK: governança V6 — defaults, persistência, fallback, bloqueio de execução e preservação histórica validados.');
