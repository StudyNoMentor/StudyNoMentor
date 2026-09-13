#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const src = fs.readFileSync('src/js/58-extras-governanca.js','utf8');
const HOJE = '2026-09-13';
let extras = [];
let prefs = { disciplinasDia: 1, blocoMin: 10, blocoMax: 25 };

const addDays = (iso,n) => { const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const ctx = {
  console, Date, setTimeout, clearTimeout,
  window: {},
  todayLocal: () => HOJE,
  escapeHtml: x => String(x ?? ''),
  formatDateShort: x => x,
  showToast: () => {}, _quiet: () => {},
  document: { addEventListener(){}, querySelector(){return null;}, querySelectorAll(){return [];} },
  UI: { confirm: async()=>true, prompt: async()=>null },
  ExtrasScreen: { renderManageList(){}, render(){} },
  DB: {
    getExtras: () => extras,
    saveExtras: list => { extras=list; return list; },
    getExtra: id => extras.find(e=>e.id===id)||null,
    getLei: () => null,
    updateExtra: () => null,
    addExtraProgress: () => null
  },
  ReforcoFila: {
    prefs: () => ({...prefs}),
    salvarPrefs(patch){ prefs={...prefs,...patch}; return this.sincronizar(); },
    ePlano: e => !!(e&&e.origemPlano&&e.origemPlano.topico&&e.periodo==='unica'),
    eGerenciado: e => !!(e&&e.reforcoFila&&e.reforcoFila.auto!==false),
    _meta(e){ if(!e.reforcoFila)e.reforcoFila={auto:true,alvosPorDia:{}}; if(!e.reforcoFila.alvosPorDia)e.reforcoFila.alvosPorDia={}; return e.reforcoFila; },
    _sanearLimites(mi,ma){ mi=Math.max(1,Math.round(Number(mi)||10)); ma=Math.max(1,Math.round(Number(ma)||25)); if(mi>ma)mi=ma; return {min:mi,max:ma}; },
    limitesBloco(e){ const m=e&&e.reforcoFila||{}; return {min:Number(m.blocoMin)||prefs.blocoMin,max:Number(m.blocoMax)||prefs.blocoMax,personalizado:Number.isFinite(Number(m.blocoMin))}; },
    limiteDisciplinasDia: () => prefs.disciplinasDia,
    _norm: s => String(s||'').toLowerCase(),
    _planoRef: () => null,
    saldo: e => ({restante:e._remaining||0,avaliacao:{taxa:e._taxa??50}}),
    alvoNoDia: (e,d) => { const v=e.reforcoFila&&e.reforcoFila.alvosPorDia&&e.reforcoFila.alvosPorDia[d]; return v==null?null:Number(v); },
    feitoNoDia: (e,d) => (e.historico||[]).filter(h=>h.data===d).reduce((s,h)=>s+(Number(h.quantidade)||0),0),
    _ultimoDia: e => Object.keys((e.reforcoFila&&e.reforcoFila.alvosPorDia)||{}).sort().at(-1)||'',
    tamanhoBloco(rest,e){ const m=e.reforcoFila||{}, max=Number(m.blocoMax)||prefs.blocoMax; return Math.min(Math.ceil(rest),max); },
    sincronizar: () => ({mudou:false})
  }
};
ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'58-extras-governanca.js'});
const G=ctx.window.ReforcoGovernanca;
assert.ok(G,'governança precisa ser exportada');

const mk=(id,disc,dens,target,feito=0)=>({
  id,titulo:id,periodo:'unica',status:'ativa',disciplina:disc,_remaining:30,
  origemPlano:{topico:'Top '+id,disciplina:disc,taxaInicial:45},
  reforcoFila:{auto:true,alvosPorDia:target==null?{}:{[HOJE]:target},...(dens?{disciplinasDia:dens}:{})},
  datas:target==null?[]:[HOJE],concluidasEm:[],historico:feito?[{data:HOJE,quantidade:feito}]:[]
});

// 1) Uma frente configurada 1/dia que já começou hoje bloqueia compartilhamento.
extras=[mk('A','Disc A',1,10,4),mk('B','Disc B',2,10,0),mk('C','Disc C',2,null,0)];
G.aplicarPolitica(['B'],{disciplinasDia:2,blocoMin:12,blocoMax:12,escopo:'hoje-futuro',salvarPadrao:false});
assert.equal(ctx.ReforcoFila.alvoNoDia(extras[0],HOJE),10,'missão iniciada deve conservar a meta de hoje');
assert.equal(ctx.ReforcoFila.feitoNoDia(extras[0],HOJE),4,'histórico executado não pode ser reescrito');
assert.equal(ctx.ReforcoFila.alvoNoDia(extras[1],HOJE),null,'frente 2/dia não pode invadir dia ocupado por frente 1/dia');
assert.ok(extras[1].datas.some(d=>d>HOJE),'frente removida de hoje deve ser reagendada no futuro');

// 2) Se a frente já iniciada aceita 2/dia, outra frente 2/dia pode ocupar a segunda vaga.
extras=[mk('A','Disc A',2,10,4),mk('B','Disc B',2,10,0)];
G.aplicarPolitica(['B'],{disciplinasDia:2,blocoMin:12,blocoMax:12,escopo:'hoje-futuro',salvarPadrao:false});
assert.equal(ctx.ReforcoFila.alvoNoDia(extras[0],HOJE),10);
assert.equal(ctx.ReforcoFila.alvoNoDia(extras[1],HOJE),12,'segunda vaga deve ser reaproveitada quando ambas aceitam 2/dia');

// 3) Alterar o padrão não altera silenciosamente um reforço ativo não selecionado.
prefs={disciplinasDia:1,blocoMin:10,blocoMax:25};
extras=[mk('A','Disc A',null,null,0),mk('B','Disc B',null,null,0)];
G.aplicarPolitica(['B'],{disciplinasDia:2,blocoMin:15,blocoMax:20,escopo:'futuro',salvarPadrao:true});
assert.deepEqual(prefs,{disciplinasDia:2,blocoMin:15,blocoMax:20},'novo padrão global precisa ser salvo');
assert.equal(extras[0].reforcoFila.disciplinasDia,1,'não selecionado deve congelar densidade anterior');
assert.equal(extras[0].reforcoFila.blocoMin,10,'não selecionado deve congelar mínimo anterior');
assert.equal(extras[0].reforcoFila.blocoMax,25,'não selecionado deve congelar máximo anterior');
assert.equal(extras[1].reforcoFila.disciplinasDia,2);
assert.equal(extras[1].reforcoFila.blocoMin,15);
assert.equal(extras[1].reforcoFila.blocoMax,20);
assert.ok(Array.isArray(extras[1].reforcoFila.configHistorico)&&extras[1].reforcoFila.configHistorico.length,'mudança selecionada deve ficar auditável');

// 4) Fechados são reconhecidos e podem sair da gestão operacional sem serem apagados.
const fechado=mk('Z','Disc Z',1,null,0); fechado.status='concluida'; fechado.origemPlano.veredito={em:addDays(HOJE,-1)}; extras.push(fechado);
assert.equal(G.eFechado(fechado),true);
assert.ok(G.fechados().some(e=>e.id==='Z'),'histórico deve preservar reforço concluído');

console.log('OK: rebalanceamento seletivo preserva execução, compatibilidade e padrão por reforço.');
