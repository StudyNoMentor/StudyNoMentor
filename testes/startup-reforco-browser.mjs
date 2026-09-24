/* SQL_RELATIONAL_VERIFICATION */
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
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
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

  /* 2. Arquitetura relacional: navegador não é fonte persistente. */
  const storage=await page.evaluate(()=>{
    const k='diario-estudos:u:00000000-0000-0000-0000-000000000000:p:pl:entries';
    localStorage.setItem(k,'[{"id":"ram"}]');
    const facade=localStorage.getItem(k);
    const native=window.__nativeLS ? window.__nativeLS.getItem(k) : null;
    localStorage.removeItem(k);
    return {memoryOnly:!!window.__memoryOnlyStore,idb:!!window.__idbShim,facade,native};
  });
  ok(storage.memoryOnly,'dados do app devem usar somente projeção volátil em memória');
  eq(storage.idb,false,'IndexedDB não pode ser a persistência canônica');
  eq(storage.facade,'[{"id":"ram"}]','fachada em RAM precisa continuar compatível com telas síncronas');
  eq(storage.native,null,'dados de perfil não podem ser gravados no localStorage nativo');

  /* 2b. O mecanismo legado profile_sections deve estar operacionalmente aposentado. */
  const retired=await page.evaluate(()=>({
    sectionSync:typeof window.SectionSync,
    sessionLock:typeof window.SessionLock,
    sessionGuard:typeof window.SessionGuard
  }));
  eq(retired.sectionSync,'undefined','SectionSync deve ter sido removido do bundle');
  eq(retired.sessionLock,'undefined','SessionLock deve ter sido removido do bundle');
  eq(retired.sessionGuard,'undefined','SessionGuard deve ter sido removido do bundle');

  /* 2c. Entrar em perfil sempre hidrata do SQL; não há fast path por cache. */
  const gate=await page.evaluate(()=>({
    enter:String(ProfileUI.enterProfile),
    refresh:String(ProfileUI.refreshStage)
  }));
  ok(/RelationalStore\.hydrateProfile/.test(gate.enter),'entrada deve executar SELECTs relacionais');
  ok(!/fastPathIntegrity/.test(gate.refresh),'gate não pode liberar cache local por fast path');

  /* 2d. Voltar foco = confirmar fila SQL + SELECT canônico. */
  const focus=await page.evaluate(async()=>{
    const keep={
      ready:CloudStore.isReady,logged:CloudStore.isLoggedIn,active:ProfileManager.getActiveProfileId,
      flush:RelationalStore.flush,catchUp:RelationalStore.catchUp,last:RelationalStore._lastSyncAt
    };
    let flush=0,catchUp=0,reason='';
    CloudStore.isReady=()=>true;CloudStore.isLoggedIn=()=>true;ProfileManager.getActiveProfileId=()=> 'p-rel';
    RelationalStore.flush=async()=>{flush++;return true;};
    RelationalStore.catchUp=async(id,r)=>{catchUp++;reason=r;return true;};
    RelationalStore._lastSyncAt=Date.now();
    const ok=await CloudStore.syncOnFocus();
    CloudStore.isReady=keep.ready;CloudStore.isLoggedIn=keep.logged;ProfileManager.getActiveProfileId=keep.active;
    RelationalStore.flush=keep.flush;RelationalStore.catchUp=keep.catchUp;RelationalStore._lastSyncAt=keep.last;
    return {ok,flush,catchUp,reason};
  });
  ok(focus.ok,'syncOnFocus deve concluir com banco disponível');
  eq(focus.flush,1,'syncOnFocus deve confirmar operações SQL em andamento');
  eq(focus.catchUp,1,'syncOnFocus deve fazer consulta canônica ao banco');
  eq(focus.reason,'focus','consulta de foco deve ser identificável');

  /* 2e. SaveGuard só declara sucesso depois da confirmação SQL. */
  const guard=await page.evaluate(async()=>{
    const keep={flush:RelationalStore.flush,pending:RelationalStore.pendingCount,err:RelationalStore._lastError,
      active:ProfileManager.getActiveProfileId,hydrate:RelationalStore.hydrateProfile,
      ready:CloudStore.isReady,logged:CloudStore.isLoggedIn};
    let flush=0;
    CloudStore.isReady=()=>true;CloudStore.isLoggedIn=()=>true;
    // Conta só o flush do próprio SaveGuard: com a sessão simulada como logada,
    // a reconciliação de fundo também pode chamar flush() nesta janela (≥400 ms).
    RelationalStore.flush=async()=>{if(/_aguardaNuvem/.test(new Error().stack||''))flush++;};
    RelationalStore.pendingCount=()=>0;RelationalStore._lastError=null;
    const r=await SaveGuard.run({escrever:async()=>true,verificar:()=>true});
    RelationalStore.flush=keep.flush;RelationalStore.pendingCount=keep.pending;RelationalStore._lastError=keep.err;
    ProfileManager.getActiveProfileId=keep.active;RelationalStore.hydrateProfile=keep.hydrate;
    CloudStore.isReady=keep.ready;CloudStore.isLoggedIn=keep.logged;
    return {r,flush};
  });
  ok(guard.r.ok&&guard.r.cloud,'SaveGuard deve devolver sucesso cloud somente após SQL');
  eq(guard.flush,1,'SaveGuard deve aguardar a fila relacional');

  /* 2f. Realtime usa o log de mudanças SQL, inclusive para DELETE físico. */
  const rt=await page.evaluate(()=>({
    subscribe:String(RelationalStore.subscribeProfile),
    hydrate:String(RelationalStore.hydrateProfile),
    coreSpecs:String(RelationalStore._coreSpecs),
    loadCore:String(RelationalStore._loadCoreBundle),
    catchUp:String(RelationalStore.catchUp),
    // A mídia do Anki embrulha syncNow; o contrato vale para a implementação de base.
    cloudSync:String(CloudStore.syncNow.__original||CloudStore.syncNow)
  }));
  ok(/study_change_log/.test(rt.subscribe),'Realtime deve assinar study_change_log');
  ok(/postgres_changes/.test(rt.subscribe),'Realtime deve usar eventos do Postgres');
  ok(/catchUp/.test(rt.subscribe),'assinatura deve fazer catch-up canônico após conectar/receber evento');
  ok(/study_entries/.test(rt.coreSpecs),'núcleo relacional deve incluir study_entries');
  ok(/read_study_profile_core/.test(rt.loadCore),'núcleo deve preferir pacote SQL em uma chamada');
  ok(/_changeSummary/.test(rt.catchUp),'catch-up deve consultar resumo incremental antes de reidratar');
  ok(!/profile_sections/.test(rt.hydrate+rt.coreSpecs+rt.loadCore),'hidratação não pode consultar profile_sections');
  ok(/RelationalStore/.test(rt.cloudSync),'spinner manual deve delegar ao RelationalStore');

  /* 2g. Indicador visual não pode afirmar "salvo no aparelho". */
  const syncText=await page.evaluate(()=>{
    const rs=window.RelationalStore,cs=window.CloudStore;
    const keep={ready:cs.isReady,logged:cs.isLoggedIn,pending:rs.pendingCount,err:rs._lastError,last:rs._lastSyncAt};
    cs.isReady=()=>true;cs.isLoggedIn=()=>true;rs.pendingCount=()=>0;rs._lastError=null;rs._lastSyncAt=Date.now();
    CloudUI.refreshSyncBtn();
    const b=document.getElementById('cloud-sync-btn');
    const title=b&&b.title;
    cs.isReady=keep.ready;cs.isLoggedIn=keep.logged;rs.pendingCount=keep.pending;rs._lastError=keep.err;rs._lastSyncAt=keep.last;
    return title||'';
  });
  ok(/Banco sincronizado/i.test(syncText),'spinner verde deve indicar confirmação do banco');
  ok(!/aparelho|local/i.test(syncText),'spinner não pode usar armazenamento local como garantia');

  ok(errors.length===0,'sem erros no navegador: '+errors.join(' | '));
  console.log(`STARTUP/LOADERS OK — ${checks} invariantes.`);
} finally {
  await browser.close(); await new Promise(r=>server.close(r));
}
