import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = {
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json',
  '.webmanifest':'application/manifest+json'
};
const server = createServer((req,res)=>{
  const raw=(req.url||'/').split('?')[0], name=raw==='/'?'/index.html':raw;
  try {
    const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));
    res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);
  } catch { res.writeHead(404).end('nao encontrado'); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[];let checks=0;
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{ if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const ok=(v,m)=>{checks++;assert.ok(v,m)};
const eq=(a,b,m)=>{checks++;assert.equal(a,b,m)};

try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.UX&&window.LoaderUX&&window.ReforcoAdaptativo&&window.ProfileUI,{timeout:30000});
  await page.evaluate(()=>{ try{ProfileUI.hideGate();}catch(_){} });

  /* 1. Qualquer spinner criado depois do boot recebe animação real + mensagem. */
  const loader=await page.evaluate(async()=>{
    const host=document.createElement('section');host.id='screen-conquistas-uxv4';host.className='screen active';
    const box=document.createElement('div');box.className='loading-shell';box.setAttribute('role','status');
    const spin=document.createElement('div');spin.className='qualquer-spinner';box.appendChild(spin);host.appendChild(box);document.body.appendChild(host);
    LoaderUX.decorate(host);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const cs=getComputedStyle(spin),copy=box.querySelector('.uxv4-loader-copy');
    const out={ux:spin.classList.contains('uxv4-spinner'),name:cs.animationName,duration:cs.animationDuration,copy:copy&&copy.innerText,live:box.getAttribute('aria-live')};
    host.remove();return out;
  });
  ok(loader.ux,'spinner dinâmico deve receber a classe unificada');
  ok(loader.name!=='none'&&loader.duration!=='0s','spinner dinâmico precisa girar');
  ok(/conquistas|processando|atualizando/i.test(loader.copy||''),'loader precisa dizer o que está processando');
  eq(loader.live,'polite','loader deve anunciar progresso sem interromper leitura');

  const known=await page.evaluate(()=>{
    const classes=['app-loading-spin','gate-spinner','loading-spinner','tec-loading-spinner','conq-spinner','screen-loading-spinner','csb-spin'];
    return classes.map(c=>{const e=document.createElement('div');e.className=c;document.body.appendChild(e);LoaderUX.decorateSpinner(e);const cs=getComputedStyle(e);const r={c,name:cs.animationName,dur:cs.animationDuration};e.remove();return r;});
  });
  known.forEach(x=>ok(x.name!=='none'&&x.dur!=='0s',`${x.c} deve manter animação`));

  /* 2. Fast path local-first: login autenticado + mesmo perfil local NÃO espera rede. */
  const localFirst=await page.evaluate(async()=>{
    const id='uxv4-perfil-local', uid='uxv4-user';
    const keep={
      logged:CloudStore.isLoggedIn,ready:CloudStore.isReady,session:CloudStore.session,
      active:ProfileManager.getActiveProfileId,setActive:ProfileManager.setActiveProfile,
      owner:ProfileManager._podeVerLocal,setOwner:ProfileManager._setOwner,
      has:ProfileUI._hasLocalData,last:ProfileUI.setLastProfile,render:ProfileUI.renderChip,
      space:DB.checarEspaco,pending:SectionSync.pendingQuick,remote:SectionSync.hasRemoteUpdates,kick:SectionSync.kick,
      flush:CloudStore.flushPending
    };
    let hidden=false,remoteCalls=0;
    const gate=document.getElementById('profile-gate');gate.style.display='block';
    CloudStore.isLoggedIn=()=>true;CloudStore.isReady=()=>true;CloudStore.session={user:{id:uid}};
    ProfileManager.getActiveProfileId=()=>id;ProfileManager.setActiveProfile=()=>{};
    ProfileManager._podeVerLocal=()=>true;ProfileManager._setOwner=()=>{};
    ProfileUI._hasLocalData=()=>true;ProfileUI.setLastProfile=()=>{};ProfileUI.renderChip=()=>{};
    const oldHide=ProfileUI.hideGate;ProfileUI.hideGate=function(){hidden=true;gate.style.display='none';};
    DB.checarEspaco=()=>{};SectionSync.pendingQuick=()=>0;SectionSync.hasRemoteUpdates=async()=>{remoteCalls++;return false;};SectionSync.kick=()=>{};CloudStore.flushPending=async()=>{};
    const t0=performance.now();await ProfileUI.enterProfile(id);const elapsed=performance.now()-t0;
    await new Promise(r=>setTimeout(r,380));
    const trace=StartupTrace.last();
    CloudStore.isLoggedIn=keep.logged;CloudStore.isReady=keep.ready;CloudStore.session=keep.session;
    ProfileManager.getActiveProfileId=keep.active;ProfileManager.setActiveProfile=keep.setActive;ProfileManager._podeVerLocal=keep.owner;ProfileManager._setOwner=keep.setOwner;
    ProfileUI._hasLocalData=keep.has;ProfileUI.setLastProfile=keep.last;ProfileUI.renderChip=keep.render;ProfileUI.hideGate=oldHide;
    DB.checarEspaco=keep.space;SectionSync.pendingQuick=keep.pending;SectionSync.hasRemoteUpdates=keep.remote;SectionSync.kick=keep.kick;CloudStore.flushPending=keep.flush;
    return {hidden,elapsed,remoteCalls,localVisible:trace.some(x=>x.etapa==='perfil-local-visivel')};
  });
  ok(localFirst.hidden,'perfil local seguro deve liberar a interface imediatamente');
  ok(localFirst.elapsed<250,`entrada local-first não pode aguardar rede (${localFirst.elapsed.toFixed(1)}ms)`);
  ok(localFirst.localVisible,'telemetria deve registrar quando o perfil local ficou visível');
  ok(localFirst.remoteCalls>=1,'reconciliação remota deve continuar em segundo plano');

  /* 3. Continuidade adaptativa: não repete cegamente 18q e não deixa o aluno ocioso. */
  const adaptive=await page.evaluate(()=>{
    const RA=ReforcoAdaptativo, oldSnaps=DB.getTecSnapshots,oldExtras=DB.getExtras;
    const prefKey=DB._profilePrefix()+RA.KEY,oldPref=localStorage.getItem(prefKey);
    const oldFechados=PlanoCiclo.fechados;
    const dia=todayLocal(); const prev=(n)=>{const d=new Date(dia+'T00:00:00');d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);};
    let extras=[];
    DB.getTecSnapshots=()=>[{id:'snap-semanal',endDate:dia}];DB.getExtras=()=>extras;PlanoCiclo.fechados=()=>[];
    RA.save({ativo:true,fase:'pre',dosePreMin:10,dosePreBase:18,dosePreMax:25,confiancaMeta:85,confiancaLacuna:85});
    const mk=(nome,disc,taxa=58,n=100)=>({nome,disciplina:disc,taxa,qJanela:n,qHist:n,incid:20,custoQ:95,pontosGanho:1.5,pontosPorQuestao:.8});
    const calc=()=>{const r={meta:85,modoEdital:'pre',itens:[mk('Tópico A','Disciplina A'),mk('Tópico B','Disciplina B'),mk('Tópico C','Disciplina C')],pequenas:[]};RA.enriquecer(r);return r;};
    let r=calc(), a=r.itens[0],b=r.itens[1],c=r.itens[2],initial=a.prescricaoAdaptativa.dose;
    const storedRx={snapshotId:'snap-semanal',dose:initial};
    extras=[{id:'e1',titulo:'Tópico A',disciplina:'Disciplina A',alvo:initial,progresso:initial,status:'concluida',historico:[{data:dia,quantidade:initial}],origemPlano:{topico:'Tópico A',disciplina:'Disciplina A',prescricaoAdaptativa:storedRx}}];
    r=calc();const sameDay=r.itens[0].prescricaoAdaptativa,untouched=[r.itens[1].prescricaoAdaptativa.dose,r.itens[2].prescricaoAdaptativa.dose];
    extras[0]={...extras[0],historico:[{data:prev(1),quantidade:initial}],updatedAt:prev(1)+'T12:00:00'};
    r=calc();const nextDay=r.itens[0].prescricaoAdaptativa;
    extras=[1,2,3].map((n,i)=>({id:'e'+n,titulo:'Tópico A',disciplina:'Disciplina A',alvo:initial,progresso:initial,status:'concluida',historico:[{data:prev(4-i),quantidade:initial}],updatedAt:prev(4-i)+'T12:00:00',origemPlano:{topico:'Tópico A',disciplina:'Disciplina A',prescricaoAdaptativa:storedRx}}));
    r=calc();const exhausted=r.itens[0].prescricaoAdaptativa;
    extras=[{id:'ed',titulo:'Diagnóstico',disciplina:'Disciplina D',alvo:10,progresso:10,status:'concluida',historico:[{data:prev(1),quantidade:10}],origemPlano:{topico:'Diagnóstico',disciplina:'Disciplina D',prescricaoAdaptativa:{snapshotId:'snap-semanal',dose:10}}}];
    const rd={meta:85,modoEdital:'pre',itens:[mk('Diagnóstico','Disciplina D',55,6)],pequenas:[]};RA.enriquecer(rd);const diagnostic=rd.itens[0].prescricaoAdaptativa;
    DB.getTecSnapshots=oldSnaps;DB.getExtras=oldExtras;PlanoCiclo.fechados=oldFechados;
    if(oldPref===null)localStorage.removeItem(prefKey);else localStorage.setItem(prefKey,oldPref);
    return {initial,sameDay:{dose:sameDay.dose,state:sameDay.continuidade&&sameDay.continuidade.estado},untouched,nextDay:{dose:nextDay.dose,state:nextDay.continuidade&&nextDay.continuidade.estado,budget:nextDay.continuidade&&nextDay.continuidade.orcamentoSemMedicao},exhausted:{dose:exhausted.dose,state:exhausted.continuidade&&exhausted.continuidade.estado},diagnostic:{dose:diagnostic.dose,state:diagnostic.continuidade&&diagnostic.continuidade.estado}};
  });
  ok(adaptive.initial>=10&&adaptive.initial<=25,`dose inicial deve respeitar limites (${adaptive.initial})`);
  eq(adaptive.sameDay.dose,0,'mesmo tópico concluído hoje não deve receber outra dose cega');
  eq(adaptive.sameDay.state,'rodar-outro-hoje','conclusão rápida deve acionar rodízio no mesmo dia');
  ok(adaptive.untouched.every(n=>n>0),'outras fraquezas devem continuar elegíveis no mesmo retrato');
  ok(adaptive.nextDay.dose>0&&adaptive.nextDay.dose<=adaptive.initial,'no dia seguinte pode haver dose menor e controlada');
  eq(adaptive.nextDay.state,'continuar','continuidade deve ser explícita sem fingir nova medição');
  ok(adaptive.nextDay.budget>=adaptive.initial,'continuidade deve ter orçamento finito acima da dose inicial');
  eq(adaptive.exhausted.dose,0,'vários ciclos sem nova medição devem parar o reataque cego');
  eq(adaptive.exhausted.state,'aguardar-medicao','motor deve exigir novo TEC quando o orçamento do retrato acabar');
  eq(adaptive.diagnostic.dose,0,'diagnóstico concluído não deve ser repetido sem nova medição');
  eq(adaptive.diagnostic.state,'aguardar-medicao','diagnóstico deve rodar para outro tópico até novo TEC');

  ok(errors.length===0,'sem erros no navegador: '+errors.join(' | '));
  console.log(`STARTUP/LOADERS/REFORCO V4 OK — ${checks} invariantes.`);
} finally {
  await browser.close(); await new Promise(r=>server.close(r));
}
