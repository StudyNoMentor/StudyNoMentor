#!/usr/bin/env node
/* ============================================================================
   STRESS REAL — Atividades Extras + reforços do Plano em Chromium
   Abre o produto publicado, usa o armazenamento/telas reais e deixa evidência
   visual. O bootstrap cria um perfil de TESTE pelas APIs do próprio produto;
   só então recolhe o gate de perfis para que os cliques testados abaixo sejam
   cliques normais, nunca force:true nem chamada artificial do handler.
   ============================================================================ */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium } from 'playwright';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const OUT=join(ROOT,'test-artifacts','stress-extras');
rmSync(OUT,{recursive:true,force:true}); mkdirSync(OUT,{recursive:true});
const pad=n=>String(n).padStart(2,'0');
const TODAY=new Date().toLocaleDateString('en-CA',{timeZone:'America/Fortaleza'});
const addDays=(iso,n)=>{const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
let checks=0; const ck=(v,m)=>{checks++;if(!v)throw new Error('STRESS FALHOU: '+m);};
const report={hoje:TODAY,checks:0,fuzz:{},browser:{},screenshots:[],consoleErrors:[],pageErrors:[]};
function rng(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const ri=(r,a,b)=>a+Math.floor(r()*(b-a+1));

/* 1) 3.500 cenários contra o MESMO motor que roda no navegador. */
const agendaSrc=readFileSync(join(ROOT,'src/js/51b-reforco-agenda-auto.js'),'utf8');
let fakeExtras=[],fakeToday=TODAY;
const fakeDB={
  getExtras:()=>fakeExtras,saveExtras:x=>{fakeExtras=x;},getExtra:id=>fakeExtras.find(x=>x.id===id)||null,
  extraConcluidaEm:(e,d)=>!!(e&&((e.concluidasEm||[]).includes(d)||e.status==='concluida')),
  setConcluidaDia:(id,d,on)=>{const e=fakeExtras.find(x=>x.id===id);if(e)e.status=on?'concluida':'ativa';return e||null;},
  addExtraProgress:(id,q,min,o)=>{const e=fakeExtras.find(x=>x.id===id);if(!e)return null;const data=o?.data||fakeToday;e.progresso=(+e.progresso||0)+(+q||0);(e.historico=e.historico||[]).push({data,quantidade:+q||0,minutos:+min||0});if(e.progresso>=e.alvo)e.status='concluida';return e;},
  undoExtraProgressDay:(id,d)=>{const e=fakeExtras.find(x=>x.id===id);if(!e)return null;for(let i=(e.historico||[]).length-1;i>=0;i--)if(e.historico[i].data===d){const z=e.historico.splice(i,1)[0];e.progresso=Math.max(0,(+e.progresso||0)-(+z.quantidade||0));return z;}return null;},
  undoExtraProgress:id=>{const e=fakeExtras.find(x=>x.id===id);if(!e||!e.historico?.length)return null;const z=e.historico.pop();e.progresso=Math.max(0,(+e.progresso||0)-(+z.quantidade||0));return z;}
};
const vctx={console,Date,Math,JSON,Number,String,Array,Object,Set,Map,Intl,DB:fakeDB,ExtrasScreen:{_planoRefCard:null,_planoRefOperacional:()=>null,render:()=>{}},todayLocal:()=>fakeToday,_quiet:()=>{},showToast:()=>{},PlanoCiclo:{avaliar:e=>({feito:+e.progresso||0})}};
vctx.globalThis=vctx; vm.createContext(vctx); vm.runInContext(agendaSrc,vctx,{filename:'51b-reforco-agenda-auto.js'});
const A=vctx.ReforcoAgendaAuto; ck(A?.maxPorDia===3&&A?.maxSessao===15,'API da agenda não subiu');
let blocos=0; const FUZZ=3500;
for(let seed=1;seed<=FUZZ;seed++){
  const r=rng(seed*2654435761),n=ri(r,1,28),nd=ri(r,1,Math.min(12,n));
  const itens=Array.from({length:n},(_,i)=>({id:`${seed}-${i}`,disciplina:`D${i%nd}`,restante:ri(r,1,180),minDia:addDays(TODAY,ri(r,0,5)),ordem:i}));
  const m=A.planejarModelo(itens,TODAY,{horizonteDias:720});
  const m2=A.planejarModelo(itens,TODAY,{horizonteDias:720});
  ck(JSON.stringify(m.porId)===JSON.stringify(m2.porId),`não determinístico seed ${seed}`);
  for(const it of itens){const ss=m.porId[it.id]||[];blocos+=ss.length;ck(ss.reduce((s,x)=>s+x.alvo,0)===it.restante,`perdeu saldo ${seed}/${it.id}`);ck(ss.every(x=>x.alvo>=1&&x.alvo<=15),`bloco >15 ${seed}/${it.id}`);ck(new Set(ss.map(x=>x.data)).size===ss.length,`mesma frente no dia ${seed}/${it.id}`);for(let j=1;j<ss.length;j++)ck(ss[j].data>ss[j-1].data,`ordem temporal ${seed}/${it.id}`);}
  for(const [d,occ] of Object.entries(m.ocupacao)){ck(occ.length<=3,`>3 no dia ${d} seed ${seed}`);ck(new Set(occ.map(x=>x.id)).size===occ.length,`id repetido ${d}`);ck(new Set(occ.map(x=>String(x.disciplina).toLowerCase())).size===occ.length,`disciplina repetida ${d}`);}
}
for(const qtd of [30,60,120]){const itens=Array.from({length:qtd},(_,i)=>({id:`sat-${qtd}-${i}`,disciplina:'Única',restante:30,ordem:i}));const m=A.planejarModelo(itens,TODAY,{horizonteDias:900});ck(Object.values(m.ocupacao).every(v=>v.length<=1),`saturação ${qtd} empilhou disciplina`);ck(itens.every(it=>(m.porId[it.id]||[]).reduce((s,x)=>s+x.alvo,0)===30),`saturação ${qtd} perdeu saldo`);}
report.fuzz={casos:FUZZ,blocosPlanejados:blocos,saturacoes:[30,60,120]};

/* 2) Produto real em Chromium. */
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server=createServer((req,res)=>{try{const u=new URL(req.url,'http://127.0.0.1');let p=decodeURIComponent(u.pathname);if(p==='/')p='/index.html';const f=join(ROOT,p.replace(/^\/+/,''));if(!f.startsWith(ROOT)||!existsSync(f)){res.writeHead(404);return res.end('404');}res.writeHead(200,{'content-type':MIME[extname(f)]||'application/octet-stream','cache-control':'no-store'});res.end(readFileSync(f));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r)); const BASE=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true});
async function abrir(viewport,nome){const ctx=await browser.newContext({viewport});const page=await ctx.newPage();page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(`${nome}: ${m.text()}`);});page.on('pageerror',e=>report.pageErrors.push(`${nome}: ${e.message}`));await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof ProfileManager!=='undefined'&&typeof PlanManager!=='undefined'&&typeof ExtrasScreen!=='undefined'&&typeof ReforcoAgendaAuto!=='undefined'&&typeof TecEngine!=='undefined',null,{timeout:30000});return{ctx,page};}
async function prepararPerfil(page){await page.evaluate(()=>{try{localStorage.clear();}catch(_){}const pid=ProfileManager.createProfile({nome:'Stress QA',avatar:'🧪',cor:'#4f46e5'});ProfileManager.setActiveProfile(pid);PlanManager.init();DB.saveExtras([]);DB._set(DB.KEYS.tec,[]);DB._set(DB.KEYS.incidencia,[]);const gate=document.getElementById('profile-gate');if(gate){gate.style.display='none';gate.setAttribute('aria-hidden','true');}const screen=document.getElementById('screen-extras');if(screen){screen.classList.add('active');screen.style.display='block';screen.style.visibility='visible';}document.querySelectorAll('.screen').forEach(s=>{if(s!==screen)s.classList.remove('active');});});}
async function seedBase(page){return page.evaluate(({today})=>{
  const add=(iso,n)=>{const d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const header=['Hierarquia','índice','Questões Resolvidas','Acertos (%)','Quantidade de acertos','Erros (%)','Quantidade de erros','Peso'],disciplines=Array.from({length:14},(_,i)=>`Disciplina ${String(i+1).padStart(2,'0')}`),snaps=[];
  for(let s=0;s<16;s++){const cells=[header];disciplines.forEach((disc,di)=>{const filhos=[];let tq=0,ta=0;for(let t=0;t<24;t++){const q=8+((s*7+di*11+t*13)%28),pct=32+((di*9+t*5+s*3)%58),ac=Math.max(0,Math.min(q,Math.round(q*pct/100)));tq+=q;ta+=ac;filhos.push([String(t+1).padStart(2,'0'),`Assunto ${di+1}.${t+1}`,String(q),String(Math.round(ac/q*100)),String(ac),String(100-Math.round(ac/q*100)),String(q-ac),'1']);}cells.push(['',disc,String(tq),String(Math.round(ta/tq*100)),String(ta),String(100-Math.round(ta/tq*100)),String(tq-ta),'1'],...filhos);});const end=add(today,-(15-s)*7),start=add(end,-6);snaps.push({id:`stress-${s}`,startDate:start,endDate:end,label:`Stress ${s+1}`,rows:TecEngine.parseCellRows(cells),importedAt:new Date().toISOString()});}
  DB._set(DB.KEYS.tec,[]);snaps.forEach(s=>DB.saveTecSnapshot(s));
  const mkPlano=(disc,topico,alvo,taxa)=>{const e=DB.addExtra({titulo:`Reforçar: ${topico}`,tipo:'questoes',disciplina:disc,unidade:'questoes',alvo,periodo:'unica',contaMetricas:true});const item={nome:topico,topico,taxa,n:40,questoes:40,acertos:Math.round(40*taxa/100),metaCicloQ:alvo,metaSessaoQ:15,qMedirAlvo:95,custoEstimadoQ:236,custoQ:236};let origem={topico,disciplina:disc,taxaInicial:taxa,metaCicloQ:alvo,metaSessaoQ:15,qMedirAlvo:95,custoEstimadoQ:236};try{if(typeof PlanoCiclo!=='undefined'&&PlanoCiclo.origem)origem=Object.assign(origem,PlanoCiclo.origem(topico,disc,item,{motivo:'reforco'}));}catch(_){}Object.assign(origem,{topico,disciplina:disc,metaCicloQ:alvo,metaSessaoQ:15});DB.updateExtra(e.id,{origemPlano:origem});return e.id;};
  const planos=[mkPlano('Disciplina 01','Assunto 1.1',25,35),mkPlano('Disciplina 02','Assunto 2.2',30,42),mkPlano('Disciplina 03','Assunto 3.3',20,48),mkPlano('Disciplina 04','Assunto 4.4',18,51),mkPlano('Disciplina 05','Assunto 5.5',15,57)];
  const man=[];man.push(DB.addExtra({titulo:'Anki diário — 120 cards',tipo:'anki',disciplina:'Revisão Geral',unidade:'cards',alvo:120,periodo:'diaria',dataInicio:today,dataFim:add(today,45)}).id);man.push(DB.addExtra({titulo:'Lei seca — CTN',tipo:'leitura',disciplina:'Direito Tributário',unidade:'paginas',alvo:12,periodo:'diaria',dataInicio:today,dataFim:add(today,30)}).id);man.push(DB.addExtra({titulo:'Revisão semanal',tipo:'revisao',disciplina:'Contabilidade',unidade:'sessoes',alvo:3,periodo:'semanal',dataInicio:today,dataFim:add(today,50)}).id);man.push(DB.addExtra({titulo:'Questões avulsas',tipo:'questoes',disciplina:'Auditoria',unidade:'questoes',alvo:40,periodo:'unica',datas:[today]}).id);man.push(DB.addExtra({titulo:'Aula complementar',tipo:'video',disciplina:'Economia',unidade:'min',alvo:45,periodo:'unica',datas:[add(today,1)],contaMetricas:false}).id);
  ReforcoAgendaAuto.replanejar(today);ExtrasScreen.selDay=today;ExtrasScreen._calStart=ExtrasScreen._addDays(today,-3);ExtrasScreen.render();return{planos,manual:man,snapshots:snaps.length,rows:snaps.reduce((n,s)=>n+s.rows.length,0)};
},{today:TODAY});}
async function estado(page){return page.evaluate(({today})=>{const es=DB.getExtras(),planos=es.filter(e=>e.origemPlano?.topico&&e.tipo==='questoes'),byDay={};planos.filter(e=>e.status!=='concluida').forEach(e=>{const ss=e.origemPlano.agendaAuto?.sessoes||{};Object.entries(ss).forEach(([d,s])=>{if(s.estado==='concluida')return;(byDay[d]=byDay[d]||[]).push({id:e.id,disc:String(e.disciplina||'').toLowerCase(),alvo:+s.alvo||0});});});return{planCount:planos.length,manualCount:es.length-planos.length,total:es.length,anki:es.some(e=>e.tipo==='anki'),byDay,cycles:planos.map(e=>{const rem=Math.max(0,(+e.alvo||0)-(+e.progresso||0)),ss=e.origemPlano.agendaAuto?.sessoes||{},fut=Object.entries(ss).filter(([d,s])=>d>=today&&s.estado!=='concluida');return{id:e.id,status:e.status,progress:+e.progresso||0,target:+e.alvo||0,remaining:rem,futureSum:fut.reduce((n,[,s])=>n+(+s.alvo||0),0),maxBlock:fut.reduce((m,[,s])=>Math.max(m,+s.alvo||0),0)};})};},{today:TODAY});}
function assertAgenda(st,label){for(const[d,a]of Object.entries(st.byDay)){ck(a.length<=3,`${label}: ${d} tem ${a.length}`);ck(new Set(a.map(x=>x.id)).size===a.length,`${label}: frente repetida ${d}`);ck(new Set(a.map(x=>x.disc)).size===a.length,`${label}: disciplina repetida ${d}`);}for(const c of st.cycles){if(c.status==='concluida')continue;ck(c.futureSum===c.remaining,`${label}: ${c.id} futuro ${c.futureSum} saldo ${c.remaining}`);ck(c.maxBlock<=15,`${label}: bloco ${c.maxBlock}`);}}

const desk=await abrir({width:1440,height:1000},'desktop');await prepararPerfil(desk.page);const seeded=await seedBase(desk.page);let st=await estado(desk.page);assertAgenda(st,'base');ck(st.manualCount===5&&st.anki,'base não preservou 5 extras/Anki');const screen=desk.page.locator('#screen-extras');await screen.screenshot({path:join(OUT,'01-desktop-base.png')});report.screenshots.push('01-desktop-base.png');

/* parcial pelo DOM real: registra 7 e clica o botão que o usuário clica. */
const partial=await desk.page.evaluate(({today})=>{const e=DB.getExtras().find(x=>x.origemPlano?.topico&&x.status!=='concluida'&&x.datas?.includes(today));if(!e)return null;DB.addExtraProgress(e.id,7,11,{data:today});ExtrasScreen.selDay=today;ExtrasScreen.render();return{id:e.id,target:e.alvo};},{today:TODAY});ck(partial,'sem reforço para parcial');const card=desk.page.locator(`#extras-list .exd[data-id="${partial.id}"]`);ck(await card.count()===1,'card parcial ausente');await card.locator('.exd-check').click();await desk.page.waitForTimeout(100);st=await estado(desk.page);const pc=st.cycles.find(x=>x.id===partial.id);ck(pc&&pc.status!=='concluida'&&pc.progress===7,'fechar parcial encerrou/alterou pai');assertAgenda(st,'parcial');await screen.screenshot({path:join(OUT,'02-desktop-parcial.png')});report.screenshots.push('02-desktop-parcial.png');

/* nova frente durante ciclos abertos: o dia inteiro, inclusive sessão já feita,
   continua sujeito ao teto de 3. */
await desk.page.evaluate(({today})=>{const top='Assunto 6.6',disc='Disciplina 06',alvo=30,e=DB.addExtra({titulo:`Reforçar: ${top}`,tipo:'questoes',disciplina:disc,unidade:'questoes',alvo,periodo:'unica'});DB.updateExtra(e.id,{origemPlano:{topico:top,disciplina:disc,taxaInicial:31,metaCicloQ:alvo,metaSessaoQ:15,qMedirAlvo:95,custoEstimadoQ:210}});ReforcoAgendaAuto.replanejar(today);ExtrasScreen.render();},{today:TODAY});st=await estado(desk.page);assertAgenda(st,'nova frente');const totalHoje=await desk.page.evaluate(({today})=>DB.getExtras().filter(e=>e.origemPlano?.topico&&e.origemPlano.agendaAuto?.sessoes?.[today]).length,{today:TODAY});ck(totalHoje<=3,`teto diário furou ao contar sessão já fechada: ${totalHoje}`);

/* dívida fantasma: ocorrência vencida, sem execução, deve ser destruída e saldo refeito. */
await desk.page.evaluate(({today})=>{const e=DB.getExtras().find(x=>x.origemPlano?.topico&&x.status!=='concluida'),d=new Date(today+'T12:00:00');d.setDate(d.getDate()-1);const y=d.toISOString().slice(0,10);e.origemPlano.agendaAuto=e.origemPlano.agendaAuto||{versao:1,sessoes:{}};e.origemPlano.agendaAuto.sessoes[y]={alvo:15,estado:'planejada'};e.datas=[...new Set([...(e.datas||[]),y])].sort();DB.saveExtras(DB.getExtras());ReforcoAgendaAuto.replanejar(today,{preservarHoje:false});ExtrasScreen.render();},{today:TODAY});const stale=await desk.page.evaluate(({today})=>DB.getExtras().filter(e=>e.origemPlano?.topico&&e.status!=='concluida').flatMap(e=>Object.entries(e.origemPlano.agendaAuto?.sessoes||{}).filter(([d,s])=>d<today&&s.estado==='planejada'&&!(e.historico||[]).some(h=>h.data===d))),{today:TODAY});ck(stale.length===0,'sobrou dívida vencida fantasma');

/* desfaz lançamento: saldo deve voltar sem destruir o ciclo. */
await desk.page.evaluate(({id,today})=>{DB.undoExtraProgressDay(id,today);ReforcoAgendaAuto.replanejar(today,{preservarHoje:false});ExtrasScreen.render();},{id:partial.id,today:TODAY});st=await estado(desk.page);assertAgenda(st,'undo');ck(st.cycles.find(x=>x.id===partial.id)?.progress===0,'undo não voltou progresso');

/* Carga brutal: +90 ciclos e +360 extras externos. */
const mass=await desk.page.evaluate(({today})=>{const before=DB.getExtras().filter(e=>!e.origemPlano).length;for(let i=0;i<90;i++){const disc=`Massa ${String((i%24)+1).padStart(2,'0')}`,top=`Tópico massivo ${i+1}`,alvo=15+(i%16),e=DB.addExtra({titulo:`Reforçar: ${top}`,tipo:'questoes',disciplina:disc,unidade:'questoes',alvo,periodo:'unica'});DB.updateExtra(e.id,{origemPlano:{topico:top,disciplina:disc,taxaInicial:30+(i%40),metaCicloQ:alvo,metaSessaoQ:15,qMedirAlvo:95,custoEstimadoQ:220}});}for(let i=0;i<120;i++)DB.addExtra({titulo:`Anki massa ${i}`,tipo:'anki',disciplina:`Deck ${i%12}`,unidade:'cards',alvo:80+(i%50),periodo:'diaria',dataInicio:today,dataFim:today});for(let i=0;i<120;i++)DB.addExtra({titulo:`Questões manuais ${i}`,tipo:'questoes',disciplina:`Manual ${i%18}`,unidade:'questoes',alvo:20+(i%30),periodo:'unica',datas:[today]});for(let i=0;i<120;i++)DB.addExtra({titulo:`Revisão manual ${i}`,tipo:'revisao',disciplina:`Revisão ${i%10}`,unidade:'sessoes',alvo:2+(i%4),periodo:'unica',datas:[today]});const t0=performance.now();ReforcoAgendaAuto.replanejar(today);const t1=performance.now();ExtrasScreen.selDay=today;ExtrasScreen.render();const t2=performance.now();return{before,after:DB.getExtras().filter(e=>!e.origemPlano).length,total:DB.getExtras().length,replanMs:t1-t0,renderMs:t2-t1};},{today:TODAY});ck(mass.after-mass.before===360,'massa alterou extras externos');st=await estado(desk.page);assertAgenda(st,'massa');ck(st.manualCount===mass.after,'replanejamento mexeu em Anki/manuais');ck(report.pageErrors.length===0,'pageerror na massa: '+report.pageErrors.join(' | '));await screen.screenshot({path:join(OUT,'03-desktop-massa.png')});report.screenshots.push('03-desktop-massa.png');

/* Mesma massa em 390x844: render real, não cálculo. */
await desk.page.setViewportSize({width:390,height:844});await desk.page.evaluate(()=>ExtrasScreen.render());const lay=await desk.page.evaluate(()=>{const s=document.getElementById('screen-extras'),c=document.getElementById('extras-curso'),l=document.getElementById('extras-list');return{screen:[s.scrollWidth,s.clientWidth],curso:[c.scrollWidth,c.clientWidth],lista:[l.scrollWidth,l.clientWidth],cards:document.querySelectorAll('#extras-list .exd').length};});ck(lay.screen[0]<=lay.screen[1]+2,`mobile screen vazou ${lay.screen[0]-lay.screen[1]}px`);ck(lay.curso[0]<=lay.curso[1]+2,`mobile curso vazou ${lay.curso[0]-lay.curso[1]}px`);ck(lay.lista[0]<=lay.lista[1]+2,`mobile lista vazou ${lay.lista[0]-lay.lista[1]}px`);await screen.screenshot({path:join(OUT,'04-mobile-massa.png')});report.screenshots.push('04-mobile-massa.png');

/* Mobile limpo: garante que a massa não esteja escondendo um problema de estado. */
const mob=await abrir({width:390,height:844},'mobile-limpo');await prepararPerfil(mob.page);await seedBase(mob.page);const mScreen=mob.page.locator('#screen-extras');const ml=await mob.page.evaluate(()=>{const s=document.getElementById('screen-extras');return{sw:s.scrollWidth,cw:s.clientWidth,planHoje:DB.getExtras().filter(e=>e.origemPlano?.topico&&e.datas?.includes(todayLocal())).length,anki:DB.getExtras().some(e=>e.tipo==='anki')};});ck(ml.sw<=ml.cw+2,'mobile limpo tem overflow');ck(ml.planHoje<=3,'mobile limpo >3 reforços hoje');ck(ml.anki,'mobile limpo perdeu Anki');await mScreen.screenshot({path:join(OUT,'05-mobile-base-limpa.png')});report.screenshots.push('05-mobile-base-limpa.png');

report.browser={seed:seeded,massa:mass,layoutMobileMassivo:lay,layoutMobileLimpo:ml};report.checks=checks;writeFileSync(join(OUT,'report.json'),JSON.stringify(report,null,2));
await mob.ctx.close();await desk.ctx.close();await browser.close();await new Promise(r=>server.close(r));
if(report.consoleErrors.length)throw new Error('console.error no Chromium: '+report.consoleErrors.join(' | '));
console.log(`OK STRESS EXTRAS: ${checks} invariantes; ${FUZZ} cenários; ${blocos} blocos; ${seeded.snapshots} importações/${seeded.rows} linhas TEC; ${mass.total} atividades; desktop + mobile; ${report.screenshots.length} screenshots.`);
