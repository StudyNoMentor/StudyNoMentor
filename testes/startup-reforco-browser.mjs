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
      space:DB.checarEspaco,pending:SectionSync.pendingQuick,explicit:SectionSync.explicitPendingSections,
      remote:SectionSync.hasRemoteUpdates,kick:SectionSync.kick,flush:CloudStore.flushPending
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
    DB.checarEspaco=()=>{};SectionSync.pendingQuick=()=>0;SectionSync.explicitPendingSections=()=>[];
    SectionSync.hasRemoteUpdates=async()=>{remoteCalls++;return false;};SectionSync.kick=()=>{};CloudStore.flushPending=async()=>{};
    const t0=performance.now();await ProfileUI.enterProfile(id);const elapsed=performance.now()-t0;
    await new Promise(r=>setTimeout(r,380));
    const trace=StartupTrace.last();
    CloudStore.isLoggedIn=keep.logged;CloudStore.isReady=keep.ready;CloudStore.session=keep.session;
    ProfileManager.getActiveProfileId=keep.active;ProfileManager.setActiveProfile=keep.setActive;ProfileManager._podeVerLocal=keep.owner;ProfileManager._setOwner=keep.setOwner;
    ProfileUI._hasLocalData=keep.has;ProfileUI.setLastProfile=keep.last;ProfileUI.renderChip=keep.render;ProfileUI.hideGate=oldHide;
    DB.checarEspaco=keep.space;SectionSync.pendingQuick=keep.pending;SectionSync.explicitPendingSections=keep.explicit;
    SectionSync.hasRemoteUpdates=keep.remote;SectionSync.kick=keep.kick;CloudStore.flushPending=keep.flush;
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
      pending:SectionSync.pendingQuick,explicit:SectionSync.explicitPendingSections,
      remote:SectionSync.hasRemoteUpdates,kick:SectionSync.kick,flush:CloudStore.flushPending
    };
    let remoteCalls=0;
    CloudStore.isLoggedIn=()=>true;CloudStore.isReady=()=>true;CloudStore.session={user:{id:'uxv4-user'}};
    ProfileManager.getActiveProfileId=()=>id;ProfileManager.getRev=()=>1;
    SectionSync.pendingQuick=()=>0;SectionSync.explicitPendingSections=()=>[];
    SectionSync.hasRemoteUpdates=async()=>{remoteCalls++;return false;};
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
    SectionSync.pendingQuick=keep.pending;SectionSync.explicitPendingSections=keep.explicit;
    SectionSync.hasRemoteUpdates=keep.remote;SectionSync.kick=keep.kick;CloudStore.flushPending=keep.flush;
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
    let flushCalls=0,pullCalls=0,remoteCalls=0,pullReadOnly=false;
    CloudStore.isLoggedIn=()=>true;CloudStore.isReady=()=>true;ProfileManager.getActiveProfileId=()=>id;
    CloudStore._pending=true;CloudStore._debounce=null;CloudStore._syncing=false;
    CloudStore.flushPending=async()=>{flushCalls++;CloudStore._pending=false;};
    CloudStore.pullActiveAndReload=async(opts)=>{pullCalls++;pullReadOnly=!!(opts&&opts.readOnly);return true;};
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
    return {flushCalls,pullCalls,remoteCalls,pullReadOnly};
  });
  eq(pushPull.flushCalls,1,'syncOnFocus deve concluir o envio pendente');
  eq(pushPull.remoteCalls,1,'syncOnFocus deve conferir a nuvem logo após o envio');
  eq(pushPull.pullCalls,1,'syncOnFocus deve baixar novidade na mesma rodada');
  ok(pushPull.pullReadOnly,'pull automático após o push deve ser somente-leitura');

  /* 2e. Edição nova durante upload antigo: a confirmação velha NÃO pode limpar
     a geração mais nova da fila. */
  const generationRace=await page.evaluate(async()=>{
    const id='syncv2-generation-race',sec='tracks',key='diario-estudos:u:'+id+':'+sec;
    const keep={
      active:ProfileManager.getActiveProfileId,ready:CloudStore.isReady,logged:CloudStore.isLoggedIn,
      write:SectionSync._writeSectionCAS,manifest:SectionSync._syncManifest
    };
    ProfileManager.getActiveProfileId=()=>id;CloudStore.isReady=()=>true;CloudStore.isLoggedIn=()=>true;
    SectionSync._dirty.clear();SectionSync._dirtyGen.clear();SectionSync._lastConflict=null;
    localStorage.removeItem('diario-estudos:u:'+id+':__secrev');
    localStorage.removeItem('diario-estudos:u:'+id+':__secpend');
    localStorage.setItem(key,JSON.stringify({v:1}));
    SectionSync.markDirty(key);
    const genAntes=SectionSync._dirtyGen.get(sec)||0;
    let writes=0;
    SectionSync._syncManifest=async()=>{};
    SectionSync._writeSectionCAS=async()=>{
      writes++;
      if(writes===1){
        localStorage.setItem(key,JSON.stringify({v:2}));
        SectionSync.markDirty(key);
      }
      return {ok:true,rev:1};
    };
    await SectionSync._enviarSujas(id);
    const out={
      writes,genAntes,genDepois:SectionSync._dirtyGen.get(sec)||0,
      aindaSuja:SectionSync._dirty.has(sec),
      persistida:SectionSync._loadPend(id).includes(sec)
    };
    SectionSync._writeSectionCAS=keep.write;SectionSync._syncManifest=keep.manifest;
    ProfileManager.getActiveProfileId=keep.active;CloudStore.isReady=keep.ready;CloudStore.isLoggedIn=keep.logged;
    SectionSync._dirty.clear();SectionSync._dirtyGen.clear();
    localStorage.removeItem(key);localStorage.removeItem('diario-estudos:u:'+id+':__secrev');
    localStorage.removeItem('diario-estudos:u:'+id+':__secpend');
    return out;
  });
  eq(generationRace.writes,1,'corrida deve concluir o upload antigo uma vez');
  ok(generationRace.genDepois>generationRace.genAntes,'nova edição deve receber geração maior');
  ok(generationRace.aindaSuja,'upload antigo não pode limpar edição nova da memória');
  ok(generationRace.persistida,'upload antigo não pode limpar edição nova da outbox durável');

  /* 2f. O caminho CAS existente deve usar UPDATE condicionado por rev, nunca
     upsert incondicional sobre uma linha já conhecida. */
  const casUpdate=await page.evaluate(async()=>{
    const keep=CloudStore.client;const calls=[];
    const q={
      update(){calls.push('update');return this;},
      eq(k,v){calls.push('eq:'+k+'='+v);return this;},
      select(){calls.push('select');return Promise.resolve({data:[{rev:8}],error:null});}
    };
    CloudStore.client={from(){calls.push('from');return q;}};
    const r=await SectionSync._writeSectionCAS(
      {profile_id:'p',section:'entries',data:[],rev:8,updated_at:new Date().toISOString()},7);
    CloudStore.client=keep;
    return {calls,r};
  });
  ok(casUpdate.calls.includes('update'),'CAS de seção existente deve usar UPDATE');
  ok(casUpdate.calls.includes('eq:rev=7'),'CAS deve condicionar a escrita à revisão conhecida');
  ok(!casUpdate.calls.includes('upsert'),'CAS não pode fazer upsert cego');
  ok(casUpdate.r&&casUpdate.r.ok,'CAS condicionado deve aceitar confirmação válida');

  /* 2g. Conflito do blob não pode copiar a rev remota para o local e tentar
     novamente com autorização artificial. */
  const blobConflict=await page.evaluate(async()=>{
    const keep={save:CloudStore.saveActive,fetch:CloudStore._fetchRev,setRev:ProfileManager.setRev,active:ProfileManager.getActiveProfileId,logged:CloudStore.isLoggedIn};
    let setRevCalls=0,saveCalls=0;
    ProfileManager.getActiveProfileId=()=> 'syncv2-blob';
    CloudStore.isLoggedIn=()=>true;
    CloudStore.saveActive=async()=>{saveCalls++;return {conflict:true};};
    CloudStore._fetchRev=async()=>99;
    ProfileManager.setRev=()=>{setRevCalls++;};
    const r=await CloudStore.saveActiveWithRetry();
    CloudStore.saveActive=keep.save;CloudStore._fetchRev=keep.fetch;ProfileManager.setRev=keep.setRev;
    ProfileManager.getActiveProfileId=keep.active;CloudStore.isLoggedIn=keep.logged;
    return {setRevCalls,saveCalls,r};
  });
  eq(blobConflict.saveCalls,1,'conflito de blob não deve reenviar repetidamente');
  eq(blobConflict.setRevCalls,0,'conflito de blob não pode adulterar a revisão local');
  eq(blobConflict.r.remoteRev,99,'conflito deve apenas diagnosticar a revisão remota');

  /* 2h. O pull manual chama o caminho somente-leitura. */
  const readOnlyPull=await page.evaluate(async()=>{
    const btn=document.getElementById('cloud-pull-now');
    if(!btn)return {temBotao:false};
    const keep=CloudStore.pullActiveAndReload;let recebido=null;
    CloudStore.pullActiveAndReload=async(opts)=>{recebido=opts||{};};
    btn.click();await new Promise(r=>setTimeout(r,30));
    CloudStore.pullActiveAndReload=keep;
    return {temBotao:true,readOnly:!!(recebido&&recebido.readOnly)};
  });
  ok(readOnlyPull.temBotao,'botão baixar da nuvem deve existir');
  ok(readOnlyPull.readOnly,'baixar da nuvem deve chamar pull somente-leitura');

  /* 2i. A nova barreira do IndexedDB deve existir e só devolver sucesso depois
     de drenar a fila real da fachada. */
  const strictDisk=await page.evaluate(async()=>{
    const key='diario-estudos:test-strict-flush';
    localStorage.setItem(key,String(Date.now()));
    const before=window.__idbPendingCount?window.__idbPendingCount():-1;
    const r=window.__idbFlushStrict?await window.__idbFlushStrict(5000):null;
    localStorage.removeItem(key);
    const r2=window.__idbFlushStrict?await window.__idbFlushStrict(5000):null;
    return {tem:typeof window.__idbFlushStrict==='function',before,r,r2};
  });
  ok(strictDisk.tem,'barreira estrita de IndexedDB deve existir');
  ok(strictDisk.r&&strictDisk.r.ok,'barreira estrita deve confirmar gravação');
  eq(strictDisk.r.pending,0,'confirmação estrita só pode ocorrer com fila vazia');
  ok(strictDisk.r2&&strictDisk.r2.ok,'remoção também deve ser confirmada no disco');

  /* 2j. Manifesto também precisa de CAS; não pode voltar ao upsert cego. */
  const manifestCas=await page.evaluate(async()=>{
    const keep={
      client:CloudStore.client,localSections:SectionSync.localSections,loadDel:SectionSync._loadDel,
      write:SectionSync._writeSectionCAS
    };
    let expected=null,writes=0;
    CloudStore.client={from(){return {select(){return {eq(){return Promise.resolve({data:[{section:'__manifest',rev:3}],error:null});}};}};}};
    SectionSync.localSections=()=>['entries'];
    SectionSync._loadDel=()=>[];
    SectionSync._writeSectionCAS=async(row,exp)=>{writes++;expected=exp;return {ok:true,rev:4};};
    const revs={__manifest:{rev:3,hash:'antigo'}};
    await SectionSync._syncManifest('p-manifest',revs);
    CloudStore.client=keep.client;SectionSync.localSections=keep.localSections;SectionSync._loadDel=keep.loadDel;SectionSync._writeSectionCAS=keep.write;
    return {writes,expected,rev:revs.__manifest&&revs.__manifest.rev};
  });
  eq(manifestCas.writes,1,'manifesto alterado deve passar pelo CAS');
  eq(manifestCas.expected,3,'manifesto deve escrever a partir da revisão-base conhecida');
  eq(manifestCas.rev,4,'manifesto deve registrar apenas a revisão confirmada');

  /* 2k. Exclusão baseada em rev antiga não pode apagar uma edição remota mais nova. */
  const deletionCas=await page.evaluate(async()=>{
    const keep={
      client:CloudStore.client,localSections:SectionSync.localSections,loadDel:SectionSync._loadDel,
      saveDel:SectionSync._saveDel,write:SectionSync._writeSectionCAS,last:SectionSync._lastConflict
    };
    let deleteCalls=0,salvas=null,manifestSections=null;
    CloudStore.client={from(){return {
      select(){return {eq(){return Promise.resolve({data:[
        {section:'entries',rev:6},{section:'__manifest',rev:1}
      ],error:null});}};},
      delete(){deleteCalls++;return this;},
      eq(){return this;}
    };}};
    SectionSync.localSections=()=>[];
    SectionSync._loadDel=()=>[{section:'entries',rev:5}];
    SectionSync._saveDel=(x)=>{salvas=x;};
    SectionSync._writeSectionCAS=async(row)=>{manifestSections=(row.data&&row.data.sections)||null;return {ok:true,rev:2};};
    SectionSync._lastConflict=null;
    const revs={__manifest:{rev:1,hash:SectionSync._hash('')}};
    let falhou=false;
    try{await SectionSync._syncManifest('p-del',revs);}catch(_){falhou=true;}
    const conflito=SectionSync._lastConflict;
    CloudStore.client=keep.client;SectionSync.localSections=keep.localSections;SectionSync._loadDel=keep.loadDel;
    SectionSync._saveDel=keep.saveDel;SectionSync._writeSectionCAS=keep.write;SectionSync._lastConflict=keep.last;
    return {deleteCalls,falhou,conflito,salvas,manifestSections};
  });
  eq(deletionCas.deleteCalls,0,'exclusão velha não pode executar DELETE contra rev nova');
  ok(deletionCas.falhou,'conflito de exclusão deve manter a sincronização pendente');
  ok(deletionCas.conflito&&deletionCas.conflito.tipo==='exclusão','conflito de exclusão deve ficar diagnosticado');
  ok(Array.isArray(deletionCas.salvas)&&deletionCas.salvas.length===1,'tombstone em conflito deve permanecer durável');
  ok(Array.isArray(deletionCas.manifestSections)&&deletionCas.manifestSections.includes('entries'),
    'manifesto deve continuar expondo a seção remota mais nova quando a exclusão perde o CAS');

  /* 2l. Restaurar sessão com outro device ativo deve bloquear, não reivindicar. */
  const sessionNoTakeover=await page.evaluate(async()=>{
    const keep={
      client:CloudStore.client,ready:CloudStore.isReady,logged:CloudStore.isLoggedIn,session:CloudStore.session,
      subscribe:SessionGuard.subscribe,claim:SessionGuard.claim,taken:SessionGuard._takenBy,
      claimed:SessionGuard._claimedUid,device:SessionGuard._deviceId,enabled:SessionGuard.enabled
    };
    let claims=0,blocked=0;
    SessionGuard.enabled=true;SessionGuard._claimedUid=null;SessionGuard._deviceId='device-local';
    CloudStore.isReady=()=>true;CloudStore.isLoggedIn=()=>true;CloudStore.session={user:{id:'user-1'}};
    SessionGuard.subscribe=()=>{};
    SessionGuard.claim=async()=>{claims++;return true;};
    SessionGuard._takenBy=()=>{blocked++;};
    CloudStore.client={from(){return {select(){return {eq(){return {maybeSingle(){return Promise.resolve({data:{device_id:'device-remoto',device_label:'Outro'},error:null});}};}};}};}};
    await SessionGuard.onLogin();
    CloudStore.client=keep.client;CloudStore.isReady=keep.ready;CloudStore.isLoggedIn=keep.logged;CloudStore.session=keep.session;
    SessionGuard.subscribe=keep.subscribe;SessionGuard.claim=keep.claim;SessionGuard._takenBy=keep.taken;
    SessionGuard._claimedUid=keep.claimed;SessionGuard._deviceId=keep.device;SessionGuard.enabled=keep.enabled;
    return {claims,blocked};
  });
  eq(sessionNoTakeover.claims,0,'sessão restaurada não pode tomar posse automaticamente de outro aparelho');
  eq(sessionNoTakeover.blocked,1,'sessão restaurada deve reconhecer e bloquear diante de outro aparelho');

  /* 2m. Tombstone precisa contar como pendência mesmo após recarregar. */
  const pendingDelete=await page.evaluate(()=>{
    const id='syncv2-pending-delete',sec='entries';
    const keep=ProfileManager.getActiveProfileId;
    ProfileManager.getActiveProfileId=()=>id;
    localStorage.setItem('diario-estudos:u:'+id+':__secdel',JSON.stringify([{section:sec,rev:5}]));
    const explicit=SectionSync.explicitPendingSections(id);
    const quick=SectionSync.pendingQuick();
    localStorage.removeItem('diario-estudos:u:'+id+':__secdel');
    ProfileManager.getActiveProfileId=keep;
    return {explicit,quick};
  });
  ok(pendingDelete.explicit.includes('entries'),'exclusão durável deve aparecer como pendência explícita');
  ok(pendingDelete.quick>=1,'exclusão durável deve bloquear reconciliação rápida até ser resolvida');

  /* 2n. Se já existem linhas por seção e a validação falha, o blob antigo não
     pode ser aplicado como fallback. */
  const noStaleBlobFallback=await page.evaluate(async()=>{
    const id='syncv2-no-blob-fallback';
    const keep={
      active:ProfileManager.getActiveProfileId,pull:SectionSync.pullAndReload,last:SectionSync.lastRead,
      fetch:CloudStore.fetchPayload,readFlag:localStorage.getItem(SectionSync.READ_FLAG_KEY)
    };
    let blobFetches=0;
    ProfileManager.getActiveProfileId=()=>id;
    localStorage.setItem(SectionSync.READ_FLAG_KEY,'1');
    SectionSync.pullAndReload=async()=>false;
    SectionSync.lastRead=()=>({ok:false,motivo:'seções-faltando',linhasRemotas:7});
    CloudStore.fetchPayload=async()=>{blobFetches++;return {payload:{data:{}},rev:1};};
    const r=await CloudStore.pullActiveAndReload({readOnly:true});
    ProfileManager.getActiveProfileId=keep.active;SectionSync.pullAndReload=keep.pull;SectionSync.lastRead=keep.last;CloudStore.fetchPayload=keep.fetch;
    if(keep.readFlag===null)localStorage.removeItem(SectionSync.READ_FLAG_KEY);else localStorage.setItem(SectionSync.READ_FLAG_KEY,keep.readFlag);
    return {r,blobFetches};
  });
  eq(noStaleBlobFallback.blobFetches,0,'conjunto por seção inválido não pode cair para blob antigo');
  eq(noStaleBlobFallback.r,false,'pull deve sinalizar validação protegida sem fingir sucesso');

  /* 2o. Cache regressado: rev/hash anotados dizem "novo", conteúdo físico está
     velho e não há outbox explícita. O pull read-only deve trazer a nuvem e não
     tentar publicar o valor velho. */
  const readOnlyRepairsStaleCache=await page.evaluate(async()=>{
    const id='syncv2-stale-cache',sec='entries',pfx='diario-estudos:u:'+id+':',key=pfx+sec;
    const remoto=JSON.stringify([{v:2}]),local=JSON.stringify([{v:1}]);
    const keep={
      active:ProfileManager.getActiveProfileId,ready:CloudStore.isReady,logged:CloudStore.isLoggedIn,
      fetch:SectionSync.fetchAllSections,push:SectionSync.pushDirty,snapshot:window.BackupHistory&&BackupHistory.snapshot
    };
    let pushCalls=0;
    ProfileManager.getActiveProfileId=()=>id;CloudStore.isReady=()=>true;CloudStore.isLoggedIn=()=>true;
    SectionSync._dirty.clear();SectionSync._dirtyGen.clear();
    localStorage.setItem(key,local);
    localStorage.setItem(pfx+'__secrev',JSON.stringify({entries:{rev:2,hash:SectionSync._hash(remoto),len:remoto.length}}));
    localStorage.removeItem(pfx+'__secpend');localStorage.removeItem(pfx+'__secdel');
    SectionSync.fetchAllSections=async()=>[
      {section:sec,data:[{v:2}],rev:2,updated_at:new Date().toISOString()},
      {section:'__manifest',data:{v:2,sections:[sec]},rev:2,updated_at:new Date().toISOString()}
    ];
    SectionSync.pushDirty=async()=>{pushCalls++;};
    if(window.BackupHistory)BackupHistory.snapshot=async()=>true;
    const beforePending=SectionSync.pendingSections(id);
    const beforeExplicit=SectionSync.explicitPendingSections(id);
    const r=await SectionSync.hydrateReadOnly(id);
    const depois=localStorage.getItem(key);
    SectionSync.fetchAllSections=keep.fetch;SectionSync.pushDirty=keep.push;
    if(window.BackupHistory)BackupHistory.snapshot=keep.snapshot;
    ProfileManager.getActiveProfileId=keep.active;CloudStore.isReady=keep.ready;CloudStore.isLoggedIn=keep.logged;
    SectionSync._dirty.clear();SectionSync._dirtyGen.clear();
    localStorage.removeItem(key);localStorage.removeItem(pfx+'__secrev');localStorage.removeItem(pfx+'__secpend');localStorage.removeItem(pfx+'__secdel');
    return {beforePending,beforeExplicit,pushCalls,r,depois,remoto};
  });
  ok(readOnlyRepairsStaleCache.beforePending.includes('entries'),'hash divergente deve ser detectável como possível pendência');
  eq(readOnlyRepairsStaleCache.beforeExplicit.length,0,'cache regressado sem outbox não deve virar edição explícita');
  eq(readOnlyRepairsStaleCache.pushCalls,0,'pull read-only não pode publicar nada antes de baixar');
  ok(readOnlyRepairsStaleCache.r&&readOnlyRepairsStaleCache.r.ok,'pull read-only deve validar e aplicar seções');
  eq(readOnlyRepairsStaleCache.depois,readOnlyRepairsStaleCache.remoto,'conteúdo remoto deve corrigir cache físico regressado');

  /* 2p. Manifesto com revisão remota mais nova deve se realinhar e avançar
     sem apagar a união remota/local. */
  const manifestRebase=await page.evaluate(async()=>{
    const id='syncv2-manifest-rebase';
    const keep={
      client:CloudStore.client,localSections:SectionSync.localSections,loadDel:SectionSync._loadDel,
      saveDel:SectionSync._saveDel,write:SectionSync._writeSectionCAS,remote:SectionSync._remoteSection
    };
    let expectedSeen=[],writeCalls=0;
    CloudStore.client={from(){return {
      select(){return {eq(){return Promise.resolve({data:[
        {section:'entries',rev:4},
        {section:'__manifest',rev:7,data:{v:2,sections:['entries']}}
      ],error:null});}};}
    };}};
    SectionSync.localSections=()=>['entries','cards'];
    SectionSync._loadDel=()=>[];
    SectionSync._saveDel=()=>{};
    SectionSync._writeSectionCAS=async(row,exp)=>{
      writeCalls++;expectedSeen.push(exp);
      return {ok:true,rev:exp+1};
    };
    SectionSync._remoteSection=keep.remote;
    const revs={__manifest:{rev:3,hash:'velho'}};
    const okRun=await SectionSync._syncManifest(id,revs);
    CloudStore.client=keep.client;SectionSync.localSections=keep.localSections;SectionSync._loadDel=keep.loadDel;
    SectionSync._saveDel=keep.saveDel;SectionSync._writeSectionCAS=keep.write;SectionSync._remoteSection=keep.remote;
    return {okRun,writeCalls,expectedSeen,rev:revs.__manifest&&revs.__manifest.rev};
  });
  ok(manifestRebase.okRun,'manifesto deve sincronizar a partir da revisão remota observada');
  eq(manifestRebase.expectedSeen[0],7,'manifesto não pode usar revisão local obsoleta quando acabou de ler rev 7');
  eq(manifestRebase.rev,8,'manifesto deve avançar monotonicamente da rev remota atual');

  /* 2q. Trocar de perfil deve trocar a assinatura Realtime da tabela de seções. */
  const realtimeProfileSwitch=await page.evaluate(()=>{
    const keep={
      client:CloudStore.client,ready:CloudStore.isReady,logged:CloudStore.isLoggedIn,
      channel:CloudStore.secChannel,profile:CloudStore._secChannelProfile
    };
    const removed=[],created=[];
    function fakeChannel(name){
      const ch={name,on(){return ch;},subscribe(){return ch;}};
      created.push(name);return ch;
    }
    CloudStore.client={channel:fakeChannel,removeChannel(ch){removed.push(ch&&ch.name);}};
    CloudStore.isReady=()=>true;CloudStore.isLoggedIn=()=>true;
    CloudStore.secChannel=null;CloudStore._secChannelProfile=null;
    CloudStore.subscribeSections('perfil-a');
    const first=CloudStore._secChannelProfile;
    CloudStore.subscribeSections('perfil-b');
    const second=CloudStore._secChannelProfile;
    CloudStore.client=keep.client;CloudStore.isReady=keep.ready;CloudStore.isLoggedIn=keep.logged;
    CloudStore.secChannel=keep.channel;CloudStore._secChannelProfile=keep.profile;
    return {first,second,removed,created};
  });
  eq(realtimeProfileSwitch.first,'perfil-a','primeira assinatura realtime deve pertencer ao perfil A');
  eq(realtimeProfileSwitch.second,'perfil-b','troca de perfil deve religar realtime no perfil B');
  ok(realtimeProfileSwitch.removed.some(x=>String(x).includes('perfil-a')),'canal do perfil anterior deve ser removido');

  /* 2r. Evento realtime recebido durante upload não pode desaparecer. */
  const realtimeDuringUpload=await page.evaluate(async()=>{
    const id='syncv2-rt-busy';
    const keep={
      active:ProfileManager.getActiveProfileId,syncing:CloudStore._syncing,pending:CloudStore._pending,
      debounce:CloudStore._debounce,applying:CloudStore._applying,remotePending:CloudStore._secRemotePending,
      remote:SectionSync.hasRemoteUpdates,pull:SectionSync.pullAndReload,pushing:SectionSync._pushing
    };
    ProfileManager.getActiveProfileId=()=>id;
    SectionSync._dirtyFor(id).clear();
    SectionSync._pushing=false;
    CloudStore._pending=false;CloudStore._debounce=null;CloudStore._applying=false;
    CloudStore._secRemotePending=true;CloudStore._syncing=true;
    let remoteCalls=0,pullCalls=0,readOnly=false;
    SectionSync.hasRemoteUpdates=async()=>{remoteCalls++;return true;};
    SectionSync.pullAndReload=async(opts)=>{pullCalls++;readOnly=!!(opts&&opts.readOnly);return true;};

    await CloudStore._onSectionRealtime(id);
    const ficouPendente=CloudStore._secRemotePending;

    CloudStore._syncing=false;
    await CloudStore._onSectionRealtime(id);
    const drenou=!CloudStore._secRemotePending;

    ProfileManager.getActiveProfileId=keep.active;CloudStore._syncing=keep.syncing;CloudStore._pending=keep.pending;
    CloudStore._debounce=keep.debounce;CloudStore._applying=keep.applying;CloudStore._secRemotePending=keep.remotePending;
    SectionSync.hasRemoteUpdates=keep.remote;SectionSync.pullAndReload=keep.pull;SectionSync._pushing=keep.pushing;
    SectionSync._dirtyFor(id).clear();
    return {ficouPendente,drenou,remoteCalls,pullCalls,readOnly};
  });
  ok(realtimeDuringUpload.ficouPendente,'evento remoto durante upload deve permanecer pendente');
  ok(realtimeDuringUpload.drenou,'hint remoto deve ser drenado quando o upload termina');
  eq(realtimeDuringUpload.remoteCalls,1,'hint drenado deve conferir a revisão remota uma vez');
  eq(realtimeDuringUpload.pullCalls,1,'novidade remota deve ser aplicada após estabilizar');
  ok(realtimeDuringUpload.readOnly,'realtime nunca pode iniciar upload implícito');

  /* 2r. O espelho nativo não pode continuar guardando bookkeeping/perfil.
     A escrita pela fachada deve remover uma cópia legada pequena do nativeLS. */
  const nativeMirrorIsolation=await page.evaluate(async()=>{
    if(!window.__nativeLS)return {tem:false};
    const k='diario-estudos:syncv2-native-split';
    window.__nativeLS.setItem(k,'antigo');
    localStorage.setItem(k,'novo');
    await (window.__idbFlushStrict?window.__idbFlushStrict(5000):Promise.resolve({ok:true}));
    const native=window.__nativeLS.getItem(k);
    const facade=localStorage.getItem(k);
    localStorage.removeItem(k);
    await (window.__idbFlushStrict?window.__idbFlushStrict(5000):Promise.resolve({ok:true}));
    return {tem:true,native,facade};
  });
  ok(nativeMirrorIsolation.tem,'teste precisa acessar o armazenamento nativo preservado');
  eq(nativeMirrorIsolation.native,null,'chaves de dados/bookkeeping não podem permanecer espelhadas no localStorage nativo');
  eq(nativeMirrorIsolation.facade,'novo','fachada IndexedDB deve manter o valor canônico');

  /* 2p. Duas filas homônimas de perfis diferentes não podem compartilhar estado. */
  const profileIsolation=await page.evaluate(()=>{
    const a='syncv2-profile-a',b='syncv2-profile-b',sec='entries';
    const ka='diario-estudos:u:'+a+':'+sec,kb='diario-estudos:u:'+b+':'+sec;
    SectionSync._dirtyFor(a).clear();SectionSync._dirtyGenFor(a).clear();
    SectionSync._dirtyFor(b).clear();SectionSync._dirtyGenFor(b).clear();
    localStorage.setItem(ka,'[1]');localStorage.setItem(kb,'[2]');
    SectionSync.markDirty(ka);SectionSync.markDirty(kb);
    const antes={
      a:SectionSync._dirtyFor(a).has(sec),
      b:SectionSync._dirtyFor(b).has(sec),
      ga:SectionSync._dirtyGenFor(a).get(sec)||0,
      gb:SectionSync._dirtyGenFor(b).get(sec)||0,
      pa:SectionSync._loadPend(a).includes(sec),
      pb:SectionSync._loadPend(b).includes(sec)
    };
    SectionSync._clearDirtyIfGeneration(sec,antes.ga,a);
    SectionSync._savePend(a);
    const depois={
      a:SectionSync._dirtyFor(a).has(sec),
      b:SectionSync._dirtyFor(b).has(sec),
      pb:SectionSync._loadPend(b).includes(sec)
    };
    SectionSync._dirtySets.delete(a);SectionSync._dirtySets.delete(b);
    SectionSync._dirtyGenMaps.delete(a);SectionSync._dirtyGenMaps.delete(b);
    localStorage.removeItem(ka);localStorage.removeItem(kb);
    localStorage.removeItem('diario-estudos:u:'+a+':__secpend');
    localStorage.removeItem('diario-estudos:u:'+b+':__secpend');
    return {antes,depois};
  });
  ok(profileIsolation.antes.a&&profileIsolation.antes.b,'mesma seção deve poder ficar pendente em dois perfis');
  ok(profileIsolation.antes.pa&&profileIsolation.antes.pb,'outbox durável deve permanecer separada por perfil');
  ok(!profileIsolation.depois.a,'confirmação do perfil A deve limpar apenas A');
  ok(profileIsolation.depois.b&&profileIsolation.depois.pb,'confirmação do perfil A não pode tocar na fila do perfil B');

  ok(errors.length===0,'sem erros no navegador: '+errors.join(' | '));
  console.log(`STARTUP/LOADERS OK — ${checks} invariantes.`);
} finally {
  await browser.close(); await new Promise(r=>server.close(r));
}
