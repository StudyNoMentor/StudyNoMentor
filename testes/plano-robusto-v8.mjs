import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url))),mem=new Map();
const clone=x=>JSON.parse(JSON.stringify(x));
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const semComentarios=src=>src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n\r]*/g,'$1');
let plan={id:'p1',tipo:'Pré-edital',nome:'Base'},extras=[],subjects=[{nome:'NOME DO CICLO QUE NAO CASA',peso:99}],inc=[];
const mkRows=(rod=0)=>['Auditoria','Contabilidade Geral','Direito Tributário','AFO','Economia'].flatMap((disc,di)=>Array.from({length:4},(_,ti)=>{const q=30+rod*5,taxa=45+di*5+ti*5+rod*2,ac=Math.round(q*taxa/100);return{codigo:`${di+1}.${ti+1}`,depth:1,disciplina:disc,nome:`${disc} T${ti+1}`,questoes:q,acertos:ac,pctAcerto:ac/q*100};}));
const snaps=[0,1,2].map(i=>({id:'s'+i,date:`2026-0${7+i}-01`,rows:mkRows(i)}));
for(const disc of ['Auditoria','Contabilidade Geral','Direito Tributário','AFO','Economia'])for(let t=1;t<=4;t++)inc.push({banca:'FGV',disciplina:disc,topico:`${disc} T${t}`,incidencia:5+t*10});
const I={norm,esc:s=>String(s??''),snapshot:()=>({...clone(snaps[2]),_fontes:clone(snaps)}),linhasTec:s=>(s&&s.rows)||[],q:r=>Number(r?.questoes)||0,taxa:r=>Number.isFinite(Number(r?.pctAcerto))?Number(r.pctAcerto):(Number(r?.acertos)||0)/Math.max(1,Number(r?.questoes)||1)*100,disciplinasBloqueadas:()=>new Set(),incidencia:()=>clone(inc),bancas:()=>['FGV']};
const ctx={console,JSON,Math,Date,Set,Map,Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL(){}},document:{createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},CSS:{escape:s=>String(s)},localStorage:{getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)},DB:{_profilePrefix:()=> 'u:',setRaw:(k,v)=>mem.set(k,String(v)),delRaw:k=>mem.delete(k),getExtras:()=>clone(extras),getTecSnapshots:()=>clone(snaps),getActiveSubjects:()=>clone(subjects)},PlanManager:{getActivePlan:()=>plan,updatePlan:(id,patch)=>Object.assign(plan,clone(patch))},PlanoSugestoesInfraV2:I,showToast(){},_quiet(){},window:{}};ctx.window=ctx;vm.createContext(ctx);
for(const f of ['src/js/84b-reforco-tec-extras-v8.js','src/js/88-plano-sugestoes-robusto-v8.js'])vm.runInContext(readFileSync(join(ROOT,f),'utf8'),ctx,{filename:f});
const X=ctx.ReforcoTecExtrasV8,R=ctx.PlanoSugestoesRobustoV8;assert(X&&R,'V8 deve publicar prescricao e motor');assert.equal(R.VERSAO,8);assert.equal(R.MOTOR,'robusto-v8');
const src=semComentarios(readFileSync(join(ROOT,'src/js/88-plano-sugestoes-robusto-v8.js'),'utf8'));
const depsProibidas=[
  ['PlanoEngine',/\bPlanoEngine\s*[.(\[]|window\.PlanoEngine\b/],
  ['Mentor90',/\bMentor90(?:V\d+)?\s*[.(\[]|window\.Mentor90\w*\b/],
  ['PlanoRobustoConfig',/\bPlanoRobustoConfig\w*\s*[.(\[]|window\.PlanoRobustoConfig\w*\b/],
  ['PlanoRobustoRouter',/\bPlanoRobustoRouter\w*\s*[.(\[]|window\.PlanoRobustoRouter\w*\b/],
  ['PlanoRobustoOptimizer',/\bPlanoRobustoOptimizer\w*\s*[.(\[]|window\.PlanoRobustoOptimizer\w*\b/]
];
for(const [nome,re] of depsProibidas)assert(!re.test(src),`Robusto V8 nao pode executar ${nome}`);
const p0=R.prefs();assert.equal(p0.meta,90);assert.equal(p0.minAmostra,20);const a=R.posterior(75,20,90,{...p0,forcaPrior:.5}),b=R.posterior(75,20,90,{...p0,forcaPrior:20});assert.notEqual(Math.round(a.media*1000),Math.round(b.media*1000),'forca do prior deve realmente regularizar');
let pre=R.calcular();assert.equal(pre.erro,undefined);assert.equal(pre.fase,'pre');assert.equal(pre.itens.length,3);assert.equal(new Set(pre.itens.map(x=>x.disciplina)).size,3);assert(pre.disciplinas.every(x=>x.peso===1),'Pre deve impor peso 1 para todas as disciplinas');assert(pre.itens.every(x=>x.quantidadeRecomendada>=p0.doseMin&&x.quantidadeRecomendada<=p0.doseMax));assert(pre.itens.every(x=>x.topicosOrdenados.length>=2));
const sig=()=>R.calcular().itens.map(x=>[x.disciplina,x.nome,Math.round(x.score*1000),x.quantidadeRecomendada]);const s0=clone(sig());subjects=[{nome:'QUALQUER OUTRO NOME',peso:.1},{nome:'Auditoria ciclo',peso:200}];assert.deepEqual(clone(sig()),s0,'nome/peso do ciclo regular jamais pode alterar o Robusto');
// Tempo: somente historico diretamente registrado em Extras do reforco.
const alvoPre=pre.itens[0];
extras=[{id:'e1',disciplina:alvoPre.disciplina,status:'concluida',alvo:20,historico:[{quantidade:20,minutos:80}],origemPlano:{topico:alvoPre.nome,sugestao:{motor:'robusto-v8',modoInterface:'robusto'},veredito:{ganhoPP:5,questoes:20}}}];
let tempo=X.tempo(alvoPre.disciplina,alvoPre.nome,15,{minQuestoesTempo:30});assert.equal(tempo.confiavel,false,'20q ainda ficam abaixo do piso padrao de 30q');
tempo=X.tempo(alvoPre.disciplina,alvoPre.nome,15,{minQuestoesTempo:20});assert.equal(tempo.confiavel,true);assert.equal(tempo.fonte,'extras-topico');assert.equal(Math.round(tempo.segundosPorQuestao),240);
R.salvar({minQuestoesTempoExtras:20});const rTempo=R.calcular();for(const item of rTempo.itens){const t=item.prescricao.tempo;if(t.confiavel)assert.match(t.fonte,/^extras-(topico|disciplina)$/,'tempo confiavel deve vir somente de Extras vinculados');}
// Atribuicao observacional: mesmo Extra, mas TEC com 100q, deve valer menos que TEC com 20q.
let obs=X._obs(extras[0]);assert.equal(obs.atribuicao.causal,false);assert(obs.atribuicao.pesoCalibracao>.8);extras[0].origemPlano.veredito.questoes=100;obs=X._obs(extras[0]);assert(obs.atribuicao.pesoCalibracao<.4,'contaminacao por questoes externas deve reduzir peso');
// Pos-edital: configuracao deve usar nomes canonicos do TEC e exigir selecao manual.
plan={id:'p1',tipo:'Pós-edital',nome:'Edital'};let pos=R.calcular();assert.equal(pos.erro,'post-pesos-pendentes');const ds={};for(const d of R._tecDisciplinas(I.snapshot()))ds[norm(d)]={nome:d,ativo:true,peso:d==='Economia'?5:1};R.salvarPostConfig({configurado:true,disciplinas:ds});pos=R.calcular();assert.equal(pos.erro,undefined);assert(pos.disciplinas.every(x=>x.peso>0));assert(pos.disciplinas.find(x=>x.disciplina==='Economia').peso===5);assert.equal(pos.arquitetura.naoUsa.includes('peso/nome do ciclo regular'),true);
// Peso manual deve ter efeito, mas nao pode inventar disciplina que nao existe no TEC.
const antes=pos.disciplinas.map(x=>[x.disciplina,x.score]);const ds2=clone(ds);ds2[norm('AFO')].peso=20;R.salvarPostConfig({configurado:true,disciplinas:ds2});const depois=R.calcular().disciplinas;assert(depois.find(x=>x.disciplina==='AFO').score>antes.find(x=>x[0]==='AFO')[1]);
const recomendacoes=JSON.stringify(R.calcular().itens);assert(!/lei seca|flashcard|anki|teoria focal|roteador pedagogico/i.test(recomendacoes),'V8 nao deve prescrever metodo de estudo');
console.log('OK: Robusto V8 — TEC canonico, 3 disciplinas, ranking de topicos, dose TEC+Extras, confusao observacional e pesos Pos manuais validados.');
