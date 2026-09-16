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
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});

try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__idbShim===true&&window.DB,{timeout:30000});

  const seeded=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('diario-estudos-db',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const ativo='11111111-1111-4111-8111-111111111111';
    const frio='22222222-2222-4222-8222-222222222222';
    const big=JSON.stringify({blob:'x'.repeat(6*1024*1024)});
    const backup=JSON.stringify([{em:Date.now(),dados:'y'.repeat(3*1024*1024)}]);
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('kv','readwrite'),s=tx.objectStore('kv');
      s.clear();
      s.put(ativo,'diario-estudos:active-profile');
      s.put(JSON.stringify([{id:ativo,nome:'Ativo',avatar:'📘',cor:'#000'},{id:frio,nome:'Frio',avatar:'📗',cor:'#111'}]),'diario-estudos:profiles');
      s.put(JSON.stringify([{id:'pl_a',nome:'Plano ativo',tipo:'Pré-edital'}]),`diario-estudos:u:${ativo}:planejamentos`);
      s.put('pl_a',`diario-estudos:u:${ativo}:active-plan`);
      s.put(JSON.stringify([{id:'e1',subject:'Auditoria',durationMin:60}]),`diario-estudos:u:${ativo}:p:pl_a:entries`);
      s.put(big,`diario-estudos:u:${frio}:p:pl_f:tec`);
      s.put(backup,`diario-estudos:vhist:${frio}`);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    try {
      const n=window.__nativeLS;
      n.setItem('diario-estudos:active-profile',ativo);
      n.removeItem(`diario-estudos:u:${frio}:p:pl_f:tec`);
      n.removeItem(`diario-estudos:vhist:${frio}`);
    } catch {}
    db.close();
    return {ativo,frio,bigLen:big.length};
  });

  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__idbStartupStats&&window.__idbStartupStats.visibleMs>0&&!document.getElementById('app-loading'),{timeout:30000});

  const before=await page.evaluate(({frio})=>({
    stats:window.__idbStartupStats,
    coldTec:localStorage.getItem(`diario-estudos:u:${frio}:p:pl_f:tec`),
    coldKnown:window.__idbHasProfileNamespace&&window.__idbHasProfileNamespace(frio),
    coldIds:window.__idbColdProfileIds?window.__idbColdProfileIds():[]
  }),seeded);

  assert.ok(before.stats.totalKeys>=7,'índice deve enxergar dados quentes e frios');
  assert.ok(before.stats.coldKeys>=2,'payload volumoso de outro perfil deve ficar fora do caminho crítico');
  assert.equal(before.coldTec,null,'perfil frio não deve ter payload clonado antes de ser aberto');
  assert.equal(before.coldKnown,true,'índice deve saber que o perfil frio existe');
  assert.ok(before.coldIds.includes(seeded.frio),'perfil frio deve permanecer identificável');
  assert.ok(before.stats.visibleMs<3000,`app deve ficar visível rapidamente mesmo com ~9 MB frios (${before.stats.visibleMs}ms)`);

  const after=await page.evaluate(async({frio,bigLen})=>{
    await window.__idbHydrateProfile(frio);
    const v=localStorage.getItem(`diario-estudos:u:${frio}:p:pl_f:tec`);
    return {len:v?v.length:0,stillCold:window.__idbColdProfileIds().includes(frio)};
  },seeded);
  assert.equal(after.len,seeded.bigLen,'abrir o perfil deve materializar integralmente seu payload');
  assert.equal(after.stillCold,false,'perfil deixa de ser frio depois da hidratação');
  assert.equal(errors.length,0,'sem erros no navegador: '+errors.join(' | '));

  console.log(`STARTUP HOT HYDRATION BROWSER OK — visível em ${before.stats.visibleMs}ms; ${before.stats.hotKeys}/${before.stats.totalKeys} chaves no caminho crítico.`);
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
