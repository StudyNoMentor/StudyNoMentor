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
  await page.waitForFunction(()=>window.UX&&window.LoaderUX&&window.ProfileUI,{timeout:30000});
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
    const buildKey=UX.buildReconcileKey(id), build=UX.currentBuild();
    if(build) localStorage.setItem(buildKey,build); // este caso testa o fast path, não a barreira de build
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
    localStorage.removeItem(buildKey);
    return {hidden,elapsed,remoteCalls,localVisible:trace.some(x=>x.etapa==='perfil-local-visivel')};
  });
  ok(localFirst.hidden,'perfil local seguro deve liberar a interface imediatamente');
  ok(localFirst.elapsed<250,`entrada local-first não pode aguardar rede (${localFirst.elapsed.toFixed(1)}ms)`);
  ok(localFirst.localVisible,'telemetria deve registrar quando o perfil local ficou visível');
  ok(localFirst.remoteCalls>=1,'reconciliação remota deve continuar em segundo plano');

  /* 2b. ABRIR DIRETO (recarregamento da mesma aba) TAMBEM CONFERE A NUVEM.
     `ProfileUI.boot()` tem um atalho: se `sessionStorage[SESSION_KEY]` aponta
     para o perfil ativo e ha dado local, ele fecha o portao e retorna — sem
     ler a nuvem. E sessionStorage SOBREVIVE a um recarregamento. Como o
     marcador que agendava a reconciliacao (RECON_KEY) e posto so no
     `enterProfile` e consumido na primeira conferencia, toda recarga seguinte
     — inclusive a que uma versao nova dispara — abria com o localStorage e
     mais nada: dados atrasados e registros de outro aparelho ausentes, que so
     "normalizavam" em guia anonima ou entrando/saindo da conta.

     Este teste reproduz exatamente esse estado (SESSION_KEY posto, RECON_KEY
     ausente) e exige que a conferencia em segundo plano aconteca. */
  const entradaDireta=await page.evaluate(async()=>{
    const id='uxv4-perfil-direto';
    const keep={
      logged:CloudStore.isLoggedIn,ready:CloudStore.isReady,session:CloudStore.session,
      active:ProfileManager.getActiveProfileId,rev:ProfileManager.getRev,
      pending:SectionSync.pendingQuick,remote:SectionSync.hasRemoteUpdates,kick:SectionSync.kick,
      flush:CloudStore.flushPending
    };
    let remoteCalls=0;
    CloudStore.isLoggedIn=()=>true;CloudStore.isReady=()=>true;CloudStore.session={user:{id:'uxv4-user'}};
    ProfileManager.getActiveProfileId=()=>id;ProfileManager.getRev=()=>1;
    SectionSync.pendingQuick=()=>0;SectionSync.hasRemoteUpdates=async()=>{remoteCalls++;return false;};
    SectionSync.kick=()=>{};CloudStore.flushPending=async()=>{};
    // o estado de uma recarga apos entrada direta: sessao da aba sim, agendamento nao
    const buildKey=UX.buildReconcileKey(id), build=UX.currentBuild();
    if(build) localStorage.setItem(buildKey,build); // 2b isola o agendamento; 2c testa a barreira nova
    sessionStorage.setItem(ProfileUI.SESSION_KEY,id);
    sessionStorage.removeItem('diario-estudos:uxv4-reconcile');
    ProfileUI._uxv4LocalFirst=false;          // permite reinstalar o gancho de abertura
    UX.installLocalFirst();
    await new Promise(r=>setTimeout(r,900));  // scheduleReconcile espera a sessao
    const trace=StartupTrace.last();
    CloudStore.isLoggedIn=keep.logged;CloudStore.isReady=keep.ready;CloudStore.session=keep.session;
    ProfileManager.getActiveProfileId=keep.active;ProfileManager.getRev=keep.rev;
    SectionSync.pendingQuick=keep.pending;SectionSync.hasRemoteUpdates=keep.remote;SectionSync.kick=keep.kick;
    CloudStore.flushPending=keep.flush;
    try{sessionStorage.removeItem(ProfileUI.SESSION_KEY);}catch(_){}
    localStorage.removeItem(buildKey);
    return {remoteCalls,marcou:trace.some(x=>x.etapa==='reconciliacao-entrada-direta')};
  });
  ok(entradaDireta.remoteCalls>=1,'abrir direto (recarga da mesma aba) tambem precisa conferir a nuvem');
  ok(entradaDireta.marcou,'a telemetria deve registrar a reconciliacao da entrada direta');

  /* 2c. TROCOU A VERSAO DO APP: revisão local não basta.
     A primeira abertura do build novo precisa hidratar TODAS as seções uma vez,
     mesmo quando a checagem barata diria "nada novo". Depois de confirmada, a
     mesma versão volta à checagem leve e não repete o download completo. */
  const buildBarrier=await page.evaluate(async()=>{
    const id='uxv4-build-barrier';
    const build=UX.currentBuild();
    const key=UX.buildReconcileKey(id);
    const keep={
      logged:CloudStore.isLoggedIn,ready:CloudStore.isReady,session:CloudStore.session,
      active:ProfileManager.getActiveProfileId,rev:ProfileManager.getRev,
      pending:SectionSync.pendingQuick,explicit:SectionSync.explicitPendingSections,
      hydrate:SectionSync.hydrateAfterAppUpdate,remote:SectionSync.hasRemoteUpdates,kick:SectionSync.kick,
      flush:CloudStore.flushPending,read:SectionSync.readEnabled
    };
    let hydrateCalls=0,remoteCalls=0;
    CloudStore.isLoggedIn=()=>true;CloudStore.isReady=()=>true;CloudStore.session={user:{id:'uxv4-user'}};
    ProfileManager.getActiveProfileId=()=>id;ProfileManager.getRev=()=>1;
    SectionSync.readEnabled=true;SectionSync.pendingQuick=()=>0;SectionSync.explicitPendingSections=()=>[];
    SectionSync.hydrateAfterAppUpdate=async()=>{hydrateCalls++;return {ok:true,mudou:0,seções:8};};
    SectionSync.hasRemoteUpdates=async()=>{remoteCalls++;return false;};SectionSync.kick=()=>{};
    CloudStore.flushPending=async()=>{};
    localStorage.removeItem(key);
    await UX.reconcileProfile(id);
    const marcado=localStorage.getItem(key);
    await UX.reconcileProfile(id);
    const out={build,marcado,hydrateCalls,remoteCalls};
    localStorage.removeItem(key);
    CloudStore.isLoggedIn=keep.logged;CloudStore.isReady=keep.ready;CloudStore.session=keep.session;
    ProfileManager.getActiveProfileId=keep.active;ProfileManager.getRev=keep.rev;
    SectionSync.pendingQuick=keep.pending;SectionSync.explicitPendingSections=keep.explicit;
    SectionSync.hydrateAfterAppUpdate=keep.hydrate;SectionSync.hasRemoteUpdates=keep.remote;SectionSync.kick=keep.kick;
    SectionSync.readEnabled=keep.read;CloudStore.flushPending=keep.flush;
    return out;
  });
  ok(!!buildBarrier.build,'o build publicado precisa ter identificador');
  eq(buildBarrier.hydrateCalls,1,'cada build deve fazer uma unica hidratação completa de segurança');
  eq(buildBarrier.marcado,buildBarrier.build,'a hidratação confirmada deve carimbar o build localmente');
  ok(buildBarrier.remoteCalls>=1,'depois da barreira do build, a mesma versão volta à checagem leve');

  /* 2d. Uma sincronização que começou com upload pendente também deve conferir
     a nuvem NA MESMA rodada depois que o envio for confirmado. */
  const pushPull=await page.evaluate(async()=>{
    const id='uxv4-push-pull';
    const keep={
      logged:CloudStore.isLoggedIn,ready:CloudStore.isReady,active:ProfileManager.getActiveProfileId,
      flush:CloudStore.flushPending,pull:CloudStore.pullActiveAndReload,
      pending:CloudStore._pending,debounce:CloudStore._debounce,syncing:CloudStore._syncing,
      quick:SectionSync.pendingQuick,explicit:SectionSync.explicitPendingSections,
      remote:SectionSync.hasRemoteUpdates,read:SectionSync.readEnabled
    };
    let flushCalls=0,pullCalls=0,remoteCalls=0;
    CloudStore.isLoggedIn=()=>true;CloudStore.isReady=()=>true;ProfileManager.getActiveProfileId=()=>id;
    CloudStore._pending=true;CloudStore._debounce=null;CloudStore._syncing=false;
    CloudStore.flushPending=async()=>{flushCalls++;CloudStore._pending=false;};
    CloudStore.pullActiveAndReload=async()=>{pullCalls++;return true;};
    SectionSync.readEnabled=true;SectionSync.pendingQuick=()=>0;SectionSync.explicitPendingSections=()=>[];
    SectionSync.hasRemoteUpdates=async()=>{remoteCalls++;return true;};
    sessionStorage.setItem('diario-estudos:entered',id);
    await CloudStore.syncOnFocus();
    try{sessionStorage.removeItem('diario-estudos:entered');}catch(_){}
    CloudStore.isLoggedIn=keep.logged;CloudStore.isReady=keep.ready;ProfileManager.getActiveProfileId=keep.active;
    CloudStore.flushPending=keep.flush;CloudStore.pullActiveAndReload=keep.pull;
    CloudStore._pending=keep.pending;CloudStore._debounce=keep.debounce;CloudStore._syncing=keep.syncing;
    SectionSync.pendingQuick=keep.quick;SectionSync.explicitPendingSections=keep.explicit;
    SectionSync.hasRemoteUpdates=keep.remote;SectionSync.readEnabled=keep.read;
    return {flushCalls,pullCalls,remoteCalls};
  });
  eq(pushPull.flushCalls,1,'syncOnFocus deve concluir o envio pendente');
  eq(pushPull.remoteCalls,1,'syncOnFocus deve conferir a nuvem logo após o envio');
  eq(pushPull.pullCalls,1,'syncOnFocus deve baixar novidade na mesma rodada');

  ok(errors.length===0,'sem erros no navegador: '+errors.join(' | '));
  console.log(`STARTUP/LOADERS OK — ${checks} invariantes.`);
} finally {
  await browser.close(); await new Promise(r=>server.close(r));
}
