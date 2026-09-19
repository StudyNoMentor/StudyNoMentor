import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let hoje = '2026-09-14';
const mem = new Map();
const localStorage = { getItem:k => mem.has(k) ? mem.get(k) : null, setItem:(k,v) => mem.set(k,String(v)), removeItem:k=>mem.delete(k) };
let leis = [];
let extras = [];
let seq = 0;
const DB = {
  _profilePrefix(){ return 'u:'; }, _activePlanId(){ return 'p1'; }, setRaw(k,v){ localStorage.setItem(k,v); },
  getLeis(){ return leis; }, getLei(id){ return leis.find(x=>x.id===id)||null; },
  updateLei(id,patch){ const x=this.getLei(id); if(x) Object.assign(x,patch); return x; },
  getExtras(){ return extras; }, getExtra(id){ return extras.find(x=>x.id===id)||null; }, saveExtras(v){ extras=v; },
  addExtra(d){ const e={ id:'e'+(++seq), titulo:d.titulo, tipo:d.tipo, disciplina:d.disciplina, unidade:d.unidade, alvo:d.alvo, periodo:d.periodo, datas:d.datas||[], marcador:d.marcador||'', progresso:0, status:'ativa', historico:[], concluidasEm:[] }; extras.push(e); return e; },
  updateExtra(id,patch){ const e=this.getExtra(id); if(e) Object.assign(e,patch); return e; },
  addExtraProgress(id,q,_m,opt={}){ const e=this.getExtra(id); if(!e) return null; const n=Number(q)||0; e.progresso+=n; e.historico.push({data:opt.data||hoje,quantidade:n}); if(e.progresso>=e.alvo) e.status='concluida'; return e; },
  setConcluidaDia(id,_dia,on){ const e=this.getExtra(id); if(e) e.status=on?'concluida':'ativa'; return e; },
  deleteExtra(id){ extras=extras.filter(x=>x.id!==id); },
  saveIncidencia(){}, saveTecSnapshots(){}
};
const LawEngine = {
  lines(raw){ return String(raw||'').split(/\r?\n/).filter(x=>x.trim()); },
  resolveBookmark(l){ return l.bookmark == null ? -1 : l.bookmark; }
};
const snap = { id:'snap', rows:[1] };
let calcCalls = 0;
const PlanoEngine = {
  calcular(_s,p){ calcCalls++; return { itens:[{disciplina:'A'}], prefs:p }; },
  prefs(){ return { ordenar:'pior', meta:85 }; }, salvarPrefs(){}
};
const DesempenhoTecScreen = { scopedSnapshot(){ return snap; } };
const ReforcoFila = {
  _norm(s){ return String(s||'').toLowerCase(); },
  _cmpSug(a,b){ return a.i-b.i; }, _planoRef(){ return null; }
};
const ExtrasScreen = {
  puxarDoPlano(){ PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()); this._planoRecalc=()=>PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()); },
  render(){ PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()); },
};
const LeisScreen = { renderCards(){}, openReader(){} };
const document = { querySelector(){ return null; }, querySelectorAll(){ return []; }, getElementById(){ return null; } };
const ctx = { window:{}, DB, LawEngine, PlanoEngine, DesempenhoTecScreen, ReforcoFila, ExtrasScreen, LeisScreen, localStorage, document,
  todayLocal(){ return hoje; }, setTimeout(fn){ fn(); }, console, _quiet(){}, showToast(){}, escapeHtml:s=>String(s), switchScreen(){} };
ctx.window=ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../src/js/56-leis-rodizio.js', import.meta.url),'utf8'),ctx,{filename:'56-leis-rodizio.js'});

/* 1) O caminho quente usa o mesmo cálculo do Plano enquanto snapshot/prefs não
   mudam. O "Puxar do Motor" saiu deste caminho: ele lê o Motor de sugestão, que
   percorre a árvore do retrato e não passa por `PlanoEngine.calcular`. O que
   ainda compartilha o cálculo é a leitura de PROGRESSO — a tela de Atividades e
   a fila diária —, e é ela que este teste protege. */
ctx.ExtrasScreen.render();
ctx.ExtrasScreen.render();
ctx.ReforcoFila._planoRef();
assert.equal(calcCalls,1,'mesmo retrato/prefs deve executar PlanoEngine.calcular uma única vez');
DB.saveIncidencia([]);
ctx.ReforcoFila._planoRef();
assert.equal(calcCalls,2,'mudança de incidência deve invalidar o cache');

// 2) Rodízio: gera exatamente a faixa a partir do marcador e não duplica no mesmo dia.
leis = [
  {id:'l1',titulo:'CTN',materia:'Tributário',texto:Array.from({length:100},(_,i)=>'Linha '+(i+1)).join('\n'),bookmark:10,bookmarkTxt:'Linha 10',rodizio:{apta:true,prioridade:4}},
  {id:'l2',titulo:'CF',materia:'Constitucional',texto:Array.from({length:80},(_,i)=>'Art '+(i+1)).join('\n'),bookmark:20,bookmarkTxt:'Art 20',rodizio:{apta:true,prioridade:3}}
];
extras=[]; seq=0; mem.delete('u:lei-rodizio-prefs-v1');
let r=ctx.LeiRodizio.sincronizarHoje();
assert.equal(r.criadas,1);
assert.equal(extras.length,1);
assert.equal(extras[0].origemLei.deLinha,10);
assert.equal(extras[0].origemLei.ateLinha,39);
ctx.LeiRodizio.sincronizarHoje();
assert.equal(extras.length,1,'não duplica missão já gerada hoje');

// 3) Parcial move o marcador para a próxima linha sem encerrar a sessão.
DB.addExtraProgress(extras[0].id,12,0,{data:hoje});
assert.equal(DB.getLei('l1').bookmark,22);
assert.equal(extras[0].status,'ativa');

// 4) Concluir assume a faixa inteira, avança para a próxima linha e não repõe slot no mesmo dia.
DB.setConcluidaDia(extras[0].id,hoje,true);
assert.equal(DB.getLei('l1').bookmark,40);
assert.equal(DB.getLei('l1').rodizio.ultimaConclusao,hoje);
ctx.LeiRodizio.sincronizarHoje();
assert.equal(extras.length,1,'missão concluída continua consumindo a cota do dia');

// 5) No dia seguinte entra a outra lei do rodízio circular.
hoje='2026-09-15';
ctx.LeiRodizio.sincronizarHoje();
assert.equal(extras.length,2);
const nova=extras.find(e=>e.status==='ativa');
assert.equal(nova.origemLei.leiId,'l2');
assert.equal(nova.origemLei.deLinha,20);
assert.equal(nova.origemLei.ateLinha,49);

// 6) Override individual de carga vale para a próxima missão daquela lei.
DB.setConcluidaDia(nova.id,hoje,true);
ctx.LeiRodizio.salvarCfgLei('l1',{linhasSessao:10});
hoje='2026-09-16';
ctx.LeiRodizio.sincronizarHoje();
const terceira=extras.find(e=>e.status==='ativa');
assert.equal(terceira.origemLei.leiId,'l1');
assert.equal(terceira.alvo,10);
assert.equal(terceira.origemLei.deLinha,40);
assert.equal(terceira.origemLei.ateLinha,49);

// 7) Reabrir restaura o marcador se ele ainda estiver exatamente onde a conclusão o deixou.
DB.setConcluidaDia(terceira.id,hoje,true);
assert.equal(DB.getLei('l1').bookmark,50);
DB.setConcluidaDia(terceira.id,hoje,false);
assert.equal(DB.getLei('l1').bookmark,40);
assert.equal(terceira.status,'ativa');

// 8) Excluir uma missão ativa conta como pulo: não renasce no mesmo dia.
DB.deleteExtra(terceira.id);
ctx.LeiRodizio.sincronizarHoje();
assert.ok(!extras.some(e=>e.status==='ativa' && e.origemLei?.leiId==='l1'));

console.log('OK: cache do Plano + rodízio de lei seca passaram pelos cenários críticos.');

// 9) Dias da semana são respeitados e não criam tarefa em dia bloqueado.
leis = [{id:'ld',titulo:'Lei Dias',materia:'Adm',texto:'1\n2\n3\n4\n5',bookmark:1,rodizio:{apta:true}}];
extras=[]; seq=0; hoje='2026-09-13';
ctx.LeiRodizio.salvarPrefs({ativo:true,porDia:1,linhasSessao:5,dias:[1],aoFinal:'pausar'});
assert.equal(extras.length,0,'domingo bloqueado não deve gerar missão');

// 10) Ao chegar ao fim, "pausar" desativa a lei; "reiniciar" volta à linha 1 e mantém apta.
hoje='2026-09-14';
ctx.LeiRodizio.sincronizarHoje();
assert.equal(extras.length,1);
DB.setConcluidaDia(extras[0].id,hoje,true);
assert.equal(DB.getLei('ld').rodizio.apta,false);
leis=[{id:'lr',titulo:'Lei Reinício',materia:'Adm',texto:'1\n2\n3',bookmark:1,rodizio:{apta:true,aoFinal:'reiniciar'}}];
extras=[]; seq=0; hoje='2026-09-21';
ctx.LeiRodizio.sincronizarHoje();
DB.setConcluidaDia(extras[0].id,hoje,true);
assert.equal(DB.getLei('lr').bookmark,1);
assert.equal(DB.getLei('lr').rodizio.apta,true);

// 11) Missão não concluída é carregada, sem duplicação, para o próximo dia permitido.
leis=[{id:'lc',titulo:'Lei Carry',materia:'Penal',texto:Array.from({length:20},(_,i)=>String(i+1)).join('\n'),bookmark:1,rodizio:{apta:true}}];
extras=[]; seq=0; hoje='2026-09-28';
ctx.LeiRodizio.salvarPrefs({dias:[1,2,3,4,5,6,0],linhasSessao:5,porDia:1,aoFinal:'pausar'});
ctx.LeiRodizio.sincronizarHoje();
const carryId=extras[0].id;
hoje='2026-09-29';
ctx.LeiRodizio.sincronizarHoje();
assert.equal(extras.length,1);
assert.equal(extras[0].id,carryId);
assert.deepEqual(Array.from(extras[0].datas),[hoje]);
assert.equal(extras[0].origemLei.carregadaDe,'2026-09-28');

console.log('OK adicional: dias, fim de lei e carregamento de pendência passaram.');
