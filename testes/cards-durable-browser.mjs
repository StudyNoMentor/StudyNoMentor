import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
  const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;
  try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}
  catch{res.writeHead(404).end('nao encontrado');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.CardStore&&window.DurableStudyStore&&window.ReviewOutbox&&window.GenericOutbox,{timeout:30000});
  await page.evaluate(()=>{try{ProfileUI.hideGate();}catch{}});

  const first=await page.evaluate(async()=>{
    const scope='diario-estudos:u:audit-profile:p:audit-plan:cards';
    const revScope='diario-estudos:u:audit-profile:p:audit-plan:revlog';
    const cfgKey='diario-estudos:u:audit-profile:cards-daily';
    const keepReady=RelationalStore.isReady;
    RelationalStore.isReady=()=>false;

    const cards=Array.from({length:6000},(_,i)=>({
      id:'c-'+i,frente:'F'+i,verso:'V'+i,phase:'review',reps:10,lapses:1,
      s:20,d:5,intervalo:20,due:'2026-09-21',lastReview:'2026-09-01',
      createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-09-20T00:00:00.000Z'
    }));
    const projection=(arr)=>{
      const applying=RelationalStore._applying;
      RelationalStore._applying=true;
      try{localStorage.setItem(scope,JSON.stringify(arr));return true;}
      finally{RelationalStore._applying=applying;}
    };
    if(CardStore.replaceAll(scope,cards,projection)===false)throw new Error('replaceAll falhou');
    await DurableStudyStore.flush();

    const base=JSON.parse(JSON.stringify(CardStore.getCard(scope,'c-1234',()=>[])));
    const next={...base,reps:11,intervalo:25,updatedAt:'2026-09-21T12:00:00.000Z'};
    if(CardStore.upsert(scope,next,base,{reps:11,intervalo:25},1234,{kind:'edit'})===false)throw new Error('upsert falhou');

    if(ReviewOutbox.append(revScope,{_position:1,ts:123456,cardId:'c-1234',grade:3,date:'2026-09-21'})===false)throw new Error('revlog WAL falhou');
    if(GenericOutbox.put(cfgKey,null,JSON.stringify({date:'2026-09-21',newIds:['c-1'],revIds:[]}))===false)throw new Error('generic WAL falhou');

    await DurableStudyStore.flush();
    const cached=await DurableStudyStore.readCards(scope);
    const cardOut=DurableStudyStore.listOutbox('card',scope);
    const revOut=DurableStudyStore.listOutbox('revlog',revScope);
    const generic=DurableStudyStore.listOutbox('storage','storage');
    const nativeMain=window.__nativeLS.getItem(scope);
    const safety=[];
    for(let i=0;i<window.__nativeLS.length;i++){
      const k=window.__nativeLS.key(i);
      if(k&&k.startsWith(DurableStudyStore.NATIVE_PREFIX))safety.push([k,(window.__nativeLS.getItem(k)||'').length]);
    }
    RelationalStore.isReady=keepReady;
    return {
      scope,revScope,cfgKey,cached:cached.length,
      cachedReps:cached.find(x=>x.id==='c-1234')?.card?.reps,
      cardOut:cardOut.length,revOut:revOut.length,generic:generic.filter(x=>x.key===cfgKey).length,
      nativeMain,largestSafety:Math.max(0,...safety.map(x=>x[1])),
      facadeReps:CardStore.getCard(scope,'c-1234',()=>[])?.reps
    };
  });

  assert.equal(first.cached,6000,'IndexedDB deve manter cache por registro de 6.000 cards');
  assert.equal(first.cachedReps,11,'apenas o card alterado deve refletir a mutacao');
  assert.equal(first.cardOut,1,'uma mutacao de card deve gerar um envelope, nao a colecao inteira');
  assert.equal(first.revOut,1,'revlog offline deve ter WAL duravel');
  assert.equal(first.generic,1,'contador/config offline deve ter WAL generico');
  assert.equal(first.nativeMain,null,'colecao de cards nao pode voltar ao localStorage nativo');
  assert.equal(first.facadeReps,11,'API sincrona deve enxergar a mutacao imediatamente');
  assert.ok(first.largestSafety<30000,'nenhum envelope de uma unica resposta pode serializar milhares de cards');

  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.CardStore&&window.DurableStudyStore&&window.ReviewOutbox&&window.GenericOutbox,{timeout:30000});

  const second=await page.evaluate(async({scope,revScope,cfgKey})=>{
    const cardOut=DurableStudyStore.listOutbox('card',scope);
    const revOut=DurableStudyStore.listOutbox('revlog',revScope);
    const generic=DurableStudyStore.listOutbox('storage','storage').filter(x=>x.key===cfgKey);
    const cached=await DurableStudyStore.readCards(scope);

    // Hidratação canônica deliberadamente traz versão antiga; WAL precisa vencer.
    const merged=CardStore.applyRemoteSnapshot(scope,[{
      id:'c-1234',frente:'F1234',verso:'V1234',phase:'review',reps:10,intervalo:20,
      due:'2026-09-21',updatedAt:'2026-09-20T00:00:00.000Z'
    }]);
    RelationalStore._memSet(cfgKey,JSON.stringify({date:'2026-09-21',newIds:[],revIds:[]}));
    GenericOutbox.overlayPending('audit-profile');
    return {
      cardOut:cardOut.length,revOut:revOut.length,generic:generic.length,cached:cached.length,
      cachedReps:cached.find(x=>x.id==='c-1234')?.card?.reps,
      mergedReps:merged.find(x=>x.id==='c-1234')?.reps,
      cfg:JSON.parse(localStorage.getItem(cfgKey)||'null')
    };
  },first);

  assert.equal(second.cardOut,1,'reload nao pode apagar mutacao de card sem ACK');
  assert.equal(second.revOut,1,'reload nao pode apagar revisao sem ACK');
  assert.equal(second.generic,1,'reload nao pode apagar mutacao generica sem ACK');
  assert.equal(second.cached,6000,'cache por registro deve sobreviver ao reload');
  assert.equal(second.cachedReps,11,'card alterado deve sobreviver ao reload');
  assert.equal(second.mergedReps,11,'snapshot remoto antigo nao pode sobrescrever WAL pendente');
  assert.deepEqual(second.cfg.newIds,['c-1'],'config/contador pendente deve ser reaplicado apos hidratar');
  assert.equal(errors.length,0,'sem erros no navegador: '+errors.join(' | '));

  console.log('CARDS DURABLE OK — 6000 cards, reload, WAL card/revlog/generico e overlay de hidratacao.');
}finally{
  await browser.close();
  await new Promise(r=>server.close(r));
}
