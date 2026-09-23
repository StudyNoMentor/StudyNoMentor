#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const TecEngine={buildTree(snap){
  const forest=[],roots={},codes={},pending=[];
  const mk=r=>({codigo:r.codigo??null,nome:r.nome,depth:r.depth,disciplina:r.disciplina,questoes:r.questoes,acertos:r.acertos,children:[]});
  for(const r of (snap&&snap.rows)||[]){
    const dk=norm(r.disciplina||r.nome);
    if(r.depth===0){if(!roots[dk]){roots[dk]=mk(r);codes[dk]={};forest.push(roots[dk]);}continue;}
    if(!roots[dk]){roots[dk]={codigo:null,nome:r.disciplina,depth:0,disciplina:r.disciplina,questoes:0,acertos:0,children:[]};codes[dk]={};forest.push(roots[dk]);}
    const n=mk(r);if(r.codigo)codes[dk][r.codigo]=n;pending.push([n,dk,r.codigo]);
  }
  for(const [n,dk,c] of pending){const parts=String(c||'').split('.'),pc=parts.slice(0,-1).join('.');(parts.length>1&&codes[dk][pc]?codes[dk][pc]:roots[dk]).children.push(n);}
  return forest;
}};

let scoped=null;
const mem=new Map();
const ctx={console,TecEngine,ReforcoEngine:{norm,incidenceMap:()=>({}),incidPorDisciplina:()=>({}),incidenciaDe:(map,nome,disc)=>({valor:Number(map[disc+'|'+nome]??map[nome]??0)})},
  DB:{_profilePrefix:()=> 'p:t:',setRaw:(k,v)=>mem.set(k,v),getTecSnapshots:()=>[]},
  DesempenhoTecScreen:{scopedSnapshot:()=>scoped,activeSnapshots:()=>[],bancaFiltro:()=>'__todas__'},
  localStorage:{getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,String(v))},
  CustomEvent:class{},_quiet:()=>{}};
ctx.window=ctx;ctx.dispatchEvent=()=>{};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/js/86-motor-sugestao.js','utf8'),ctx);
const M=ctx.MotorSugestao;
const no=(nome,q,taxa,depth=2,kids=[])=>({nome,codigo:nome,depth,disciplina:'X',questoes:q,acertos:q*taxa/100,children:kids});

// Divide toda a faixa fraca em quantas sugestões executáveis forem possíveis.
// O grupo só serve para CONFIRMAR a lacuna (amostra somada + exclusão de quem
// já domina); o alvo oferecido é sempre o pior membro individual do grupo,
// com dose cheia nele — não um "bloco" misturando os irmãos.
let p=no('Pai',40,50,1,[no('A',10,50),no('B',10,50),no('C',20,50)]);
let plano=M._planejarNo(p,20,[],90);
assert.equal(plano.length,2,'dois pequenos + um suficiente devem gerar duas sugestões');
assert.ok(plano.some(x=>x.motivoNivel==='pior-do-grupo'&&x.nome==='A'&&x.grupoTamanho===2&&x.grupoQuestoes===20));
assert.ok(plano.some(x=>x.motivoNivel!=='pior-do-grupo'&&x.nome==='C'&&x.questoes===20));

p=no('Pai',40,50,1,[no('A',10,50),no('B',10,50),no('C',10,50),no('D',10,50)]);
plano=M._planejarNo(p,20,[],90);
assert.equal(JSON.stringify(plano.map(x=>x.nome)),'["A","C"]','quatro pequenos devem virar dois grupos, cada um mirando o pior membro');
assert.ok(plano.every(x=>x.motivoNivel==='pior-do-grupo'&&x.grupoTamanho===2&&x.grupoQuestoes===20),'cada grupo deve confirmar 20 questões somadas, mesmo mirando só 10 do pior');

p=no('Pai',35,50,1,[no('A',10,50),no('B',10,50),no('C',15,50)]);
plano=M._planejarNo(p,20,[],90);
assert.equal(plano.length,1);assert.equal(plano[0].nome,'A');assert.equal(plano[0].grupoQuestoes,35);assert.equal(plano[0].grupoTamanho,3);

// Assunto forte não serve como enchimento artificial de bloco fraco — nem
// para confirmar o grupo, nem para "esconder" o pior atrás de uma média boa.
p=no('Pai',30,50,1,[no('A',10,20),no('B',10,30),no('Forte',10,100)]);
plano=M._planejarNo(p,20,[],90);
assert.equal(plano.length,1);assert.equal(plano[0].nome,'A');assert.equal(plano[0].grupoTamanho,2);assert.equal(plano[0].grupoQuestoes,20);

// A subida espera as frentes granulares; só aparece quando nenhuma é executável.
p=no('Pai',25,40,1,[no('Granular',20,50),no('Residual',5,0)]);
plano=M._planejarNo(p,20,[],90);
assert.equal(JSON.stringify(plano.map(x=>x.nome)),'["Granular"]');
p=no('Pai',25,80,1,[no('Granular',20,100),no('Residual',5,0)]);
plano=M._planejarNo(p,20,[],90);
assert.equal(plano.length,1);assert.equal(plano[0].nome,'Pai');assert.equal(plano[0].motivoNivel,'subnivel-insuficiente');

// O ramo-pai mais fraco é esgotado antes de entrar em outro ramo, ainda que
// uma folha do segundo tenha percentual isolado menor.
const disc=no('X',80,42,0,[
  no('Pai mais fraco',40,40,1,[no('P.1',20,30),no('P.2',20,50)]),
  no('Outro pai',40,45,1,[no('O.1',40,10)])
]);
const fila=M._filaDisciplina(disc,{minAmostra:20,metaAcerto:90,fase:'pre'});
assert.equal(JSON.stringify(fila.map(x=>x.nome)),'["P.1","P.2","O.1"]',
  'não pode saltar para folha de outro pai antes de esgotar o ramo mais fraco');

// O Motor usa o agregado do período selecionado, não o último retrato isolado.
const D=(nome,q,ac)=>({nome,disciplina:nome,depth:0,codigo:null,questoes:q,acertos:ac});
const T=(disc,nome,q,ac)=>({nome,disciplina:disc,depth:1,codigo:'01',questoes:q,acertos:ac});
const s1={id:'jan',startDate:'2026-01-01',endDate:'2026-01-31',rows:[D('A',20,4),T('A','TA',20,4)]};
const s2={id:'fev',startDate:'2026-02-01',endDate:'2026-02-28',rows:[D('A',20,16),T('A','TA',20,16)]};
scoped={id:'__agg__',startDate:s1.startDate,endDate:s2.endDate,rows:[...s1.rows,...s2.rows],_fontes:[s1,s2]};
let r=M.calcular({minAmostra:20,metaAcerto:90,maxFrentes:3});
assert.equal(r.disciplinas[0].questoes,40);assert.equal(r.disciplinas[0].taxa,50);
assert.equal(M.retratoAtual().id,'__agg__');

// Pouco volume não apaga a matéria do ranking; apenas impede frente inviável.
scoped={id:'pouco',startDate:'2026-03-01',endDate:'2026-03-31',rows:[D('Pouca amostra',5,1),T('Pouca amostra','T',5,1)]};
r=M.calcular({minAmostra:20,metaAcerto:90,maxFrentes:3});
assert.equal(r.disciplinas.length,1);assert.equal(r.disciplinas[0].nome,'Pouca amostra');
assert.equal(r.disciplinas[0].amostraMinima,false);assert.equal(r.itens.length,0);

// Pós-edital continua simples, mas deixa a incidência realmente mudar a ordem.
// A tem a maior lacuna (40pp), porém incidência 10/100 => prioridade 4.
// B tem lacuna 20pp e incidência 100/100 => prioridade 20, portanto vem antes.
// No pré-edital, a mesma fotografia continua ordenada só pela lacuna: A antes B.
scoped={id:'pos',startDate:'2026-04-01',endDate:'2026-04-30',rows:[
  D('A',40,20),T('A','TA',40,20),
  D('B',40,28),T('B','TB',40,28)
]};
r=M.calcular({fase:'pre',minAmostra:20,metaAcerto:90,maxFrentes:2});
assert.deepEqual(Array.from(r.disciplinas,x=>x.nome),['A','B'],'pré-edital não pode ganhar peso de banca');
ctx.ReforcoEngine.incidPorDisciplina=()=>({A:10,B:100});
ctx.ReforcoEngine.incidenceMap=()=>({'A|TA':10,'B|TB':100});
r=M.calcular({fase:'pos',minAmostra:20,metaAcerto:90,maxFrentes:2});
assert.deepEqual(Array.from(r.disciplinas,x=>x.nome),['B','A'],'pós-edital deve cruzar lacuna com incidência relativa');
assert.equal(r.disciplinas[0].score,20);
assert.equal(r.disciplinas[1].score,4);
assert.equal(r.criterioDisciplinas,'lacuna × relevância histórica da banca');

console.log('OK: pré-edital puro + pós-edital lacuna × incidência, agrupamento e subida rara protegidos.');
