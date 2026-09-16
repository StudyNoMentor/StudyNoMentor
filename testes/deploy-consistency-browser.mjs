import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
  const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;
  try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}
  catch{res.writeHead(404).end('nao encontrado');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource|autoSave/.test(m.text()))errors.push(m.text());});

try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.DeployConsistency&&window.SectionSync&&window.ProfileManager&&window.__idbShim===true,{timeout:30000});

  const first=await page.evaluate(async()=>{
    const id='33333333-3333-4333-8333-333333333333';
    const pfx=`diario-estudos:u:${id}:`;
    const plans=JSON.stringify([{id:'pl',nome:'Plano íntegro'}]);
    const oldEntries=JSON.stringify([{id:'antigo'}]);
    const newEntries=JSON.stringify([{id:'novo'}]);
    const cards=JSON.stringify([{id:'card-1'}]);

    ProfileManager.saveProfiles([{id,nome:'Teste deploy',avatar:'📘',cor:'#000',createdAt:new Date().toISOString()}]);
    ProfileManager.setActiveProfile(id);
    try { ProfileManager._setOwner(id,'user-test'); } catch {}
    sessionStorage.setItem('diario-estudos:entered',id);
    localStorage.setItem(pfx+'planejamentos',plans);
    localStorage.setItem(pfx+'p:pl:entries',oldEntries);
    localStorage.removeItem(pfx+'p:pl:cards');
    SectionSync._dirty.clear();
    SectionSync._saveRevs({
      planejamentos:{rev:2,hash:SectionSync._hash(plans),len:plans.length},
      'p:pl:entries':{rev:1,hash:SectionSync._hash(oldEntries),len:oldEntries.length},
      __manifest:{rev:4,hash:'old'}
    },id);
    localStorage.removeItem(pfx+'__secpend');
    localStorage.removeItem(pfx+'__secdel');

    const remoteRows=[
      {section:'__manifest',data:{v:2,sections:['planejamentos','p:pl:entries','p:pl:cards']},rev:5,updated_at:new Date().toISOString()},
      {section:'planejamentos',data:JSON.parse(plans),rev:2},
      {section:'p:pl:entries',data:JSON.parse(newEntries),rev:2},
      {section:'p:pl:cards',data:JSON.parse(cards),rev:1}
    ];
    const meta={sections:['planejamentos','p:pl:entries','p:pl:cards'],revs:{planejamentos:2,'p:pl:entries':2,'p:pl:cards':1,__manifest:5},manifestRev:5,updatedAt:new Date().toISOString()};

    CloudStore.session={user:{id:'user-test'}};
    CloudStore.isReady=()=>true;
    CloudStore.isLoggedIn=()=>true;
    CloudStore._pending=false; CloudStore._syncing=false; CloudStore._debounce=null;
    CloudStore._rearm=()=>{};
    CloudStore.fetchPayload=async()=>({payload:{data:{planejamentos:plans,'p:pl:entries':newEntries,'p:pl:cards':cards}},rev:9});
    DeployConsistency.ProfileConsistency._remoteMeta=async()=>meta;
    DeployConsistency.ProfileConsistency._fetchRemoteSections=async(_id,names)=>Object.fromEntries(names.map(sec=>{
      const row=remoteRows.find(r=>r.section===sec);
      return [sec,{raw:SectionSync._decode(row.data),rev:row.rev}];
    }));
    SectionSync.fetchAllSections=async()=>remoteRows;
    if (window.TecDataReset) TecDataReset.applyRemoteResetIfNeeded=async()=>false;
    let snapshots=0,trashed=0;
    if (window.BackupHistory) BackupHistory.snapshot=async()=>{snapshots++; return true;};
    if (window.Lixeira) Lixeira.guardar=()=>{trashed++; return true;};
    window.__snmSoftRefresh=()=>{};

    const r=await DeployConsistency.ProfileConsistency.run(id,{force:true});
    return {
      r,
      entries:localStorage.getItem(pfx+'p:pl:entries'),
      cards:localStorage.getItem(pfx+'p:pl:cards'),
      plans:localStorage.getItem(pfx+'planejamentos'),
      snapshots,trashed,
      revs:SectionSync._getRevs(id)
    };
  });

  assert.equal(first.r.ok,true,'autorreparo deve concluir sem conflito');
  assert.equal(first.entries,JSON.stringify([{id:'novo'}]),'seção remota mais nova deve reparar a cópia local');
  assert.equal(first.cards,JSON.stringify([{id:'card-1'}]),'seção ausente deve reaparecer sem logout');
  assert.equal(first.plans,JSON.stringify([{id:'pl',nome:'Plano íntegro'}]),'seção íntegra não deve ser alterada');
  assert.ok(first.snapshots>=1,'deve criar snapshot antes de sobrescrever conteúdo');
  assert.ok(first.trashed>=1,'conteúdo substituído deve ficar recuperável na lixeira');
  assert.equal(first.revs['p:pl:entries'].rev,2,'bookkeeping deve acompanhar a revisão reparada');

  const second=await page.evaluate(async()=>{
    const id='33333333-3333-4333-8333-333333333333';
    const pfx=`diario-estudos:u:${id}:`;
    const localEdit=JSON.stringify([{id:'edicao-local-nao-enviada'}]);
    const cloudNew=JSON.stringify([{id:'nuvem-mais-nova'}]);
    localStorage.setItem(pfx+'p:pl:entries',localEdit);
    SectionSync._dirty.add('p:pl:entries');
    SectionSync._savePend();
    const meta={sections:['planejamentos','p:pl:entries','p:pl:cards'],revs:{planejamentos:2,'p:pl:entries':3,'p:pl:cards':1,__manifest:6},manifestRev:6,updatedAt:new Date().toISOString()};
    DeployConsistency.ProfileConsistency._remoteMeta=async()=>meta;
    DeployConsistency.ProfileConsistency._fetchRemoteSections=async()=>({'p:pl:entries':{raw:cloudNew,rev:3}});
    const r=await DeployConsistency.ProfileConsistency.run(id,{force:true});
    return {r,entries:localStorage.getItem(pfx+'p:pl:entries'),pending:SectionSync.pendingSections(id)};
  });

  assert.equal(second.entries,JSON.stringify([{id:'edicao-local-nao-enviada'}]),'alteração local pendente nunca pode ser sobrescrita');
  assert.ok(second.pending.includes('p:pl:entries'),'alteração local continua durável na fila');
  assert.ok(second.r.protected.some(x=>x.section==='p:pl:entries'),'auditoria deve declarar a seção protegida');
  assert.equal(errors.length,0,'sem erros no navegador: '+errors.join(' | '));

  console.log('DEPLOY CONSISTENCY BROWSER OK — seção ausente foi restaurada e edição local pendente foi preservada.');
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
