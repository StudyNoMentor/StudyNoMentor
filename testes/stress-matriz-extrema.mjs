#!/usr/bin/env node
/* Matriz extrema adicional: cenarios combinatorios e carga real em Chromium. */
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART = join(RAIZ, 'artifacts', 'stress-matriz-extrema');
mkdirSync(ART, { recursive: true });
const TIPOS={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const servidor=createServer((req,res)=>{
  const u=new URL(req.url||'/','http://127.0.0.1');
  const nome=u.pathname==='/'?'/index.html':u.pathname;
  try{const corpo=readFileSync(join(RAIZ,decodeURIComponent(nome).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':TIPOS[extname(nome)]||'application/octet-stream','Cache-Control':'no-store'});res.end(corpo);}catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('nao encontrado');}
});
await new Promise(r=>servidor.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${servidor.address().port}/index.html?extremo=${Date.now()}`;
const rel={inicio:new Date().toISOString(),cenarios:[],falhas:[],artefatos:[]};
let browser;

function addFalha(nome,msg,det){rel.falhas.push({cenario:nome,msg,det:det??null});}
async function paginaNova(viewport={width:1440,height:1000}){
  const ctx=await browser.newContext({viewport,locale:'pt-BR'});
  const page=await ctx.newPage();
  const erros=[];
  page.on('pageerror',e=>erros.push('pageerror: '+e.message));
  page.on('console',m=>{const t=m.text();if(m.type()==='error'&&!/ERR_|net::|Failed to load resource/i.test(t))erros.push('console: '+t.slice(0,400));});
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof DesempenhoTecScreen!=='undefined'&&typeof PlanoEngine!=='undefined'&&typeof ExtrasScreen!=='undefined'&&!!window.ReforcoAgendaAuto,null,{timeout:30000});
  await page.addScriptTag({path:join(RAIZ,'test','jornada-dados.js')});
  await page.evaluate(()=>{try{ProfileUI.hideGate();}catch(_){}});
  return {ctx,page,erros};
}

try{
  browser=await chromium.launch({headless:true});

  // 1) Ordem, volume, sobreposicao e idempotencia das importacoes/Plano.
  {
    const nome='importacoes-ordem-sobreposicao';
    const {ctx,page,erros}=await paginaNova();
    const r=await page.evaluate(()=>{
      const falhas=[],A=(c,m,d)=>{if(!c)falhas.push({m,d:d??null});};
      const assinaturaPlano=p=>JSON.stringify([...(p.itens||[]),...(p.pequenas||[])].slice(0,40).map(x=>[x.disciplina,x.nome,x.custoQ,x.faltaAmostra,x.score,x.prioridade]));
      const snaps=SIM.retratos(48).map((s,i)=>{
        const z=JSON.parse(JSON.stringify(s));z.id='mx-'+i;z.label='Matriz '+i;
        if(i>0&&i%5===0){z.startDate=snaps?.[i-1]?.startDate||z.startDate;}
        return z;
      });
      // Permutacao deterministica sem depender da ordem original.
      const ordem=snaps.map((_,i)=>i).sort((a,b)=>((a*17)%53)-((b*17)%53));
      ordem.forEach(i=>DB.saveTecSnapshot(snaps[i]));
      const l1=DB.getTecSnapshots();
      A(l1.length===48,'quantidade de retratos divergiu',l1.length);
      A(l1.every((x,i)=>i===0||l1[i-1].startDate<=x.startDate),'getTecSnapshots nao ordenou por inicio');
      const ag1=DesempenhoTecScreen.aggregate(l1),t1=TecEngine.totais(ag1);
      A(t1.questoes>0&&t1.acertos>=0&&t1.acertos<=t1.questoes,'totais invalidos apos carga',t1);
      PlanoEngine.salvarPrefs({minAmostra:5,amostraAlvo:30,granPiso:10,incluirPequenas:true,metaDominio:85,tetoDominio:90,limite:30,foco:[],disciplina:'__todas__'});
      const p1=PlanoEngine.calcular(ag1,PlanoEngine.prefs());
      A(p1&&!p1.erro,'Plano falhou na carga de 48 retratos',p1&&p1.erro);
      const sig=assinaturaPlano(p1);
      for(let i=0;i<12;i++){const px=PlanoEngine.calcular(ag1,PlanoEngine.prefs());A(assinaturaPlano(px)===sig,'Plano nao deterministico na repeticao',i);}
      // Mesmos dados em ordem inversa devem produzir os mesmos totais agregados.
      DB._set(DB.KEYS.tec,[]);
      [...snaps].reverse().forEach(s=>DB.saveTecSnapshot(s));
      const ag2=DesempenhoTecScreen.aggregate(DB.getTecSnapshots()),t2=TecEngine.totais(ag2);
      A(JSON.stringify(t1)===JSON.stringify(t2),'ordem de importacao alterou totais',{t1,t2});
      const inc=SIM.incidencia(),a1=DB.addIncidenciaRows('CESPE',inc,true),n1=DB.getIncidencia().length,a2=DB.addIncidenciaRows('CESPE',inc,false),n2=DB.getIncidencia().length,a3=DB.addIncidenciaRows('CESPE',inc,false),n3=DB.getIncidencia().length;
      A(n1===n2&&n2===n3,'reimportacao de incidencia alterou cardinalidade',{n1,n2,n3,a1,a2,a3});
      A(a2.repetidas===inc.length&&a3.repetidas===inc.length,'repetidas de incidencia nao reconhecidas',{a2,a3,esperado:inc.length});
      return {falhas,metricas:{retratos:l1.length,questoes:t1.questoes,acertos:t1.acertos,incidencia:n3,itensPlano:(p1.itens||[]).length,pequenas:(p1.pequenas||[]).length}};
    });
    rel.cenarios.push({nome,...r,erros});r.falhas.forEach(f=>addFalha(nome,f.m,f.d));erros.forEach(e=>addFalha(nome,e));await ctx.close();
  }

  // 2) 180 reforcos do Plano + 120 manuais, parcial, excesso, idempotencia e isolamento.
  {
    const nome='agenda-plano-manual-anki';
    const {ctx,page,erros}=await paginaNova();
    const r=await page.evaluate(()=>{
      const falhas=[],A=(c,m,d)=>{if(!c)falhas.push({m,d:d??null});},hoje=todayLocal();
      const addDias=(iso,n)=>{const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return DB._isoDia(d);};
      const norm=s=>String(s||'').trim().toLocaleLowerCase('pt-BR');
      const planos=[];
      for(let i=0;i<180;i++){
        const disc='Disc '+String(i%18).padStart(2,'0'),alvo=[17,25,31,44,60][i%5];
        const e=DB.addExtra({titulo:'Reforco massivo '+i,tipo:'questoes',disciplina:disc,unidade:'questoes',alvo,periodo:'unica',datas:[hoje],contaMetricas:true,origemPlano:{topico:'Topico '+i,disciplina:disc,metaCicloQ:alvo,metaSessaoQ:15}});planos.push(e.id);
      }
      const manuais=[];
      for(let i=0;i<120;i++){
        const tipos=['anki','questoes','leitura','video','revisao','livre'],tipo=tipos[i%tipos.length];
        const e=DB.addExtra({titulo:'Manual '+i,tipo,disciplina:'Disc '+String(i%18).padStart(2,'0'),unidade:tipo==='anki'?'cards':tipo==='questoes'?'questoes':tipo==='leitura'?'paginas':tipo==='video'?'min':'itens',alvo:5+(i%35),periodo:i%4===0?'diaria':i%4===1?'semanal':i%4===2?'mensal':'unica',dataInicio:hoje,dataFim:addDias(hoje,180),datas:i%4===3?[hoje]:[],contaMetricas:i%3!==0});manuais.push(e.id);
      }
      const manualAntes=JSON.stringify(DB.getExtras().filter(e=>manuais.includes(e.id)).map(e=>({id:e.id,titulo:e.titulo,tipo:e.tipo,disciplina:e.disciplina,alvo:e.alvo,historico:e.historico,origemPlano:e.origemPlano,datas:e.datas,status:e.status,progresso:e.progresso})));
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:false});
      function assinatura(){return JSON.stringify(DB.getExtras().filter(e=>planos.includes(e.id)).map(e=>[e.id,Object.entries((e.origemPlano&&e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{}).map(([d,s])=>[d,s.alvo,s.estado,s.rodada])]));}
      const sig0=assinatura();
      for(let k=0;k<20;k++){ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});A(assinatura()===sig0,'replanejamento nao idempotente',k);}
      const porDia={};
      DB.getExtras().filter(e=>planos.includes(e.id)&&e.status!=='concluida').forEach(e=>Object.entries(e.origemPlano.agendaAuto.sessoes||{}).forEach(([d,s])=>{if(s.estado!=='concluida'&&d>=hoje)(porDia[d]=porDia[d]||[]).push(e);}));
      Object.entries(porDia).forEach(([d,g])=>{A(g.length<=3,'mais de 3 reforcos no dia',{d,n:g.length});A(new Set(g.map(e=>e.id)).size===g.length,'frente duplicada no dia',d);A(new Set(g.map(e=>norm(e.disciplina))).size===g.length,'disciplina duplicada no dia',{d,disc:g.map(e=>e.disciplina)});});
      DB.getExtras().filter(e=>planos.includes(e.id)).forEach(e=>Object.values(e.origemPlano.agendaAuto.sessoes||{}).forEach(s=>A(s.alvo>=1&&s.alvo<=15,'sessao fora de 1..15',{id:e.id,s})));
      // Parciais em 30 ciclos, metade fechada explicitamente.
      for(let i=0;i<30;i++){
        let e=DB.getExtra(planos[i]);const s=e.origemPlano.agendaAuto.sessoes[hoje];if(!s)continue;
        const q=Math.max(1,Math.min(7,s.alvo-1));DB.addExtraProgress(e.id,q,10+i,{data:hoje,acertos:Math.max(0,q-1)});if(i%2===0)ReforcoAgendaAuto.concluirSessao(e.id,hoje);
        e=DB.getExtra(e.id);A(Number.isFinite(Number(e.progresso))&&Number(e.progresso)>=0,'progresso parcial invalido',{id:e.id,p:e.progresso});A(Number(e.progresso)<Number(e.alvo)?e.status!=='concluida':true,'parcial encerrou ciclo antes da meta',{id:e.id,p:e.progresso,a:e.alvo,status:e.status});
      }
      // Excesso deliberado: nunca pode deixar NaN nem ciclo aberto quando a meta foi superada.
      for(let i=30;i<35;i++){let e=DB.getExtra(planos[i]);DB.addExtraProgress(e.id,Number(e.alvo)+5,20,{data:hoje,acertos:Number(e.alvo)});e=DB.getExtra(e.id);A(Number.isFinite(Number(e.progresso)),'overfill gerou NaN',{id:e.id,p:e.progresso});A(e.status==='concluida'||DB.extraConcluidaEm(e,hoje),'overfill nao concluiu o ciclo',{id:e.id,p:e.progresso,a:e.alvo,status:e.status});}
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});
      const manualDepois=JSON.stringify(DB.getExtras().filter(e=>manuais.includes(e.id)).map(e=>({id:e.id,titulo:e.titulo,tipo:e.tipo,disciplina:e.disciplina,alvo:e.alvo,historico:e.historico,origemPlano:e.origemPlano,datas:e.datas,status:e.status,progresso:e.progresso})));
      A(manualAntes===manualDepois,'agenda do Plano alterou extras manuais/Anki');
      return {falhas,metricas:{planos:planos.length,manuais:manuais.length,diasAgenda:Object.keys(porDia).length,abertos:DB.getExtras().filter(e=>planos.includes(e.id)&&e.status!=='concluida').length}};
    });
    rel.cenarios.push({nome,...r,erros});r.falhas.forEach(f=>addFalha(nome,f.m,f.d));erros.forEach(e=>addFalha(nome,e));await ctx.close();
  }

  // 3) Coexistencia direta: manual/Anki da mesma disciplina nao pode ser capturado pela agenda do Plano.
  {
    const nome='coexistencia-mesma-disciplina';
    const {ctx,page,erros}=await paginaNova();
    const r=await page.evaluate(()=>{
      const falhas=[],A=(c,m,d)=>{if(!c)falhas.push({m,d:d??null});},hoje=todayLocal();
      const manualQ=DB.addExtra({titulo:'Topico X',tipo:'questoes',disciplina:'Tributario',unidade:'questoes',alvo:40,periodo:'unica',datas:[hoje],contaMetricas:true});
      const anki=DB.addExtra({titulo:'Anki Tributario',tipo:'anki',disciplina:'Tributario',unidade:'cards',alvo:80,periodo:'diaria',dataInicio:hoje,dataFim:hoje,contaMetricas:true});
      const plano=DB.addExtra({titulo:'Reforcar Topico X',tipo:'questoes',disciplina:'Tributario',unidade:'questoes',alvo:25,periodo:'unica',datas:[hoje],contaMetricas:true,origemPlano:{topico:'Topico X',disciplina:'Tributario',metaCicloQ:25,metaSessaoQ:15}});
      const m0=JSON.stringify(DB.getExtra(manualQ.id)),a0=JSON.stringify(DB.getExtra(anki.id));
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:false});
      const p=DB.getExtra(plano.id),m1=DB.getExtra(manualQ.id),a1=DB.getExtra(anki.id);
      A(!!(p.origemPlano&&p.origemPlano.agendaAuto&&Object.keys(p.origemPlano.agendaAuto.sessoes||{}).length),'reforco do Plano ficou sem agenda');
      A(JSON.stringify(m1)===m0,'questoes manuais da mesma disciplina foram alteradas');
      A(JSON.stringify(a1)===a0,'Anki da mesma disciplina foi alterado');
      DB.addExtraProgress(manualQ.id,20,25,{data:hoje,acertos:15});DB.addExtraProgress(anki.id,50,30,{data:hoje});
      const pAntes=JSON.stringify(DB.getExtra(plano.id));ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});const pDepois=JSON.stringify(DB.getExtra(plano.id));
      A(pAntes===pDepois,'progresso manual/Anki contaminou agenda do Plano');
      return {falhas,metricas:{manual:DB.getExtra(manualQ.id).progresso,anki:DB.getExtra(anki.id).progresso,planoSessoes:Object.keys(DB.getExtra(plano.id).origemPlano.agendaAuto.sessoes||{}).length}};
    });
    rel.cenarios.push({nome,...r,erros});r.falhas.forEach(f=>addFalha(nome,f.m,f.d));erros.forEach(e=>addFalha(nome,e));await ctx.close();
  }

  // 4) Volume bruto + renderizacao + mobile + reload real.
  {
    const nome='carga-bruta-render-reload';
    const {ctx,page,erros}=await paginaNova();
    const r=await page.evaluate(()=>{
      const falhas=[],A=(c,m,d)=>{if(!c)falhas.push({m,d:d??null});},hoje=todayLocal();
      const addDias=(iso,n)=>{const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return DB._isoDia(d);};
      const extras=[];for(let i=0;i<800;i++)extras.push({id:'mx-extra-'+i,titulo:'Extra '+i,tipo:['anki','questoes','leitura','video','revisao','livre'][i%6],disciplina:'D'+(i%30),unidade:['cards','questoes','paginas','min','sessoes','itens'][i%6],alvo:5+(i%50),periodo:i%3===0?'diaria':i%3===1?'semanal':'unica',dataInicio:hoje,dataFim:addDias(hoje,365),datas:i%3===2?[addDias(hoje,(i%11)-5)]:[],progresso:i%7,status:'ativa',concluidasEm:[],historico:i%4===0?[{data:addDias(hoje,-(i%20)),quantidade:i%7,minutos:5+(i%40)}]:[],contaMetricas:i%2===0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      DB.saveExtras(extras);
      const decks=[];for(let i=0;i<20;i++)decks.push(DB.addDeck('MX Deck '+i));
      const cards=[];for(let i=0;i<6000;i++)cards.push({id:'mx-card-'+i,deckId:decks[i%20].id,materia:'D'+(i%30),topico:'T'+(i%200),tipo:'stress',kind:'basic',reversedOf:null,frente:'Pergunta '+i,verso:'Resposta '+i,favorito:false,status:i%5===0?'sei':'pendente',ease:2.5,intervalo:i%5===0?1+(i%100):0,due:todayCards(),reps:i%15,lapses:i%4,phase:i%5===0?'review':'new',learnStep:0,s:i%5===0?10+(i%100):null,d:i%5===0?5:null,dueTs:null,posicaoNova:i,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});DB.saveCards(cards);
      const rev=Array.from({length:24000},(_,i)=>({cardId:cards[i%cards.length].id,ts:Date.now()-i*30000,rating:1+(i%4),elapsed:i%18000,scheduledDays:i%120,date:addDias(hoje,-(i%730))}));DB._set(DB.KEYS.revlog,rev);
      SIM.retratos(36).forEach((s,i)=>DB.saveTecSnapshot(Object.assign({},s,{id:'mxr-'+i,label:'MXR '+i})));
      const t=performance.now();try{switchScreen('extras');}catch(_){}ExtrasScreen.selDay=hoje;ExtrasScreen.render();const renderMs=Math.round(performance.now()-t);
      const host=document.getElementById('screen-extras');A(DB.getExtras().length===800,'extras massivos nao persistiram',DB.getExtras().length);A(DB.getCards().length===6000,'cards massivos nao persistiram',DB.getCards().length);A(DB.getRevlog().length===24000,'revlog massivo nao persistiu',DB.getRevlog().length);A(DB.getTecSnapshots().length===36,'retratos massivos nao persistiram',DB.getTecSnapshots().length);A(renderMs<10000,'renderizacao de Extras excedeu 10s',renderMs);if(host)A(host.scrollWidth<=host.clientWidth+3,'overflow desktop',{sw:host.scrollWidth,cw:host.clientWidth});
      return {falhas,metricas:{extras:800,cards:6000,revlog:24000,retratos:36,renderMs,uiHoje:document.querySelectorAll('#extras-list .exd').length},antes:{extras:DB.getExtras().length,cards:DB.getCards().length,revlog:DB.getRevlog().length,retratos:DB.getTecSnapshots().length}};
    });
    await page.waitForTimeout(150);const desk=join(ART,'carga-desktop.png');await page.screenshot({path:desk,fullPage:false});rel.artefatos.push('artifacts/stress-matriz-extrema/carga-desktop.png');
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{ExtrasScreen.render();});await page.waitForTimeout(150);const mob=await page.evaluate(()=>{const h=document.getElementById('screen-extras');return {sw:h&&h.scrollWidth,cw:h&&h.clientWidth};});if(mob.sw>mob.cw+3)r.falhas.push({m:'overflow mobile 390',d:mob});const sm=join(ART,'carga-mobile-390.png');await page.screenshot({path:sm,fullPage:false});rel.artefatos.push('artifacts/stress-matriz-extrema/carga-mobile-390.png');
    await page.reload({waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>typeof DB!=='undefined'&&typeof ExtrasScreen!=='undefined',null,{timeout:30000});await page.waitForTimeout(800);const apos=await page.evaluate(()=>({extras:DB.getExtras().length,cards:DB.getCards().length,revlog:DB.getRevlog().length,retratos:DB.getTecSnapshots().length}));for(const k of Object.keys(r.antes))if(apos[k]!==r.antes[k])r.falhas.push({m:'reload divergiu em '+k,d:{antes:r.antes[k],apos:apos[k]}});r.apos=apos;
    rel.cenarios.push({nome,...r,erros});r.falhas.forEach(f=>addFalha(nome,f.m,f.d));erros.forEach(e=>addFalha(nome,e));await ctx.close();
  }

  rel.fim=new Date().toISOString();
  writeFileSync(join(ART,'relatorio.json'),JSON.stringify(rel,null,2));
  console.log('\nMATRIZ EXTREMA:',JSON.stringify(rel.cenarios.map(c=>({nome:c.nome,falhas:c.falhas.length,metricas:c.metricas})),null,2));
  if(rel.falhas.length){console.error(`\nMATRIZ EXTREMA FALHOU: ${rel.falhas.length} problema(s)`);rel.falhas.slice(0,50).forEach((f,i)=>console.error(`${i+1}. [${f.cenario}] ${f.msg}${f.det!=null?' · '+JSON.stringify(f.det):''}`));process.exitCode=1;}else console.log('\nOK: matriz extrema passou sem falhas.');
}catch(e){rel.falhas.push({cenario:'estrutural',msg:String(e&&e.stack||e)});rel.fim=new Date().toISOString();try{writeFileSync(join(ART,'relatorio.json'),JSON.stringify(rel,null,2));}catch{}console.error(e&&e.stack||e);process.exitCode=1;}finally{try{if(browser)await browser.close();}catch{}await new Promise(r=>servidor.close(r));}
