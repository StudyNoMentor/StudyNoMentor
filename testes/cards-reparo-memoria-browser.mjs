/* Reparo único da memória (S/D/repetições) pelo histórico, como o "recalcular
   estados de memória" do Anki: corrige resíduos de bugs antigos sem mexer em
   nenhuma data, roda uma vez por perfil e não toca predefinições com pesos
   otimizados. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer((req,res)=>{const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end('nao encontrado');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
const page=await browser.newPage();
const erros=[];page.on('pageerror',e=>erros.push(e.message));
let n=0;const ok=(v,m)=>{n++;assert.ok(v,m);};
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&typeof CardsScreen!=='undefined'&&CardsScreen._reparoMemoriaUnico,{timeout:30000});
  const r=await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(_){}
    localStorage.removeItem(DB._profilePrefix()+CardsScreen._REPARO_MEMORIA_KEY);
    const d1=DB.addDeck('Padrão'),d2=DB.addDeck('Otimizado');
    CardsConfig.setDeckPreset(d2.id,{weights:FSRS.DEFAULT_W.map((x,i)=>i===0?x*1.5:x)});
    const H=3600000,base=Date.now()-3*86400000;
    const mk=(deck,s,reps)=>{const c=DB.addCard({deckId:deck,frente:'Q',verso:'A',kind:'basic'});
      DB.updateCard(c.id,{phase:'review',reps,intervalo:3,s,d:5,due:CardEngine.addDays(todayCards(),2),lastReview:CardEngine.addDays(todayCards(),-1)});return c.id;};
    const a=mk(d1.id,0.0801,2),b=mk(d2.id,0.0801,3),ok=mk(d1.id,null,3);
    const log=[];
    [a,b,ok].forEach(id=>{log.push({cardId:id,ts:base+10*H,grade:3,phase:'new',intervalo:0,elapsed:0});
      log.push({cardId:id,ts:base+10.2*H,grade:2,phase:'learning',intervalo:0,elapsed:0});
      log.push({cardId:id,ts:base+24*H+10*H,grade:3,phase:'review',intervalo:1,elapsed:1});});
    DB.replaceRevlog(log);
    const esperado=FSRS.recomputarMemoria(log.filter(x=>x.cardId===a),FSRS.DEFAULT_W);
    DB.updateCard(ok,{s:esperado.s,d:esperado.d});
    const antes=id=>{const c=DB.getCard(id);return {due:c.due,intervalo:c.intervalo,s:c.s,d:c.d,reps:c.reps};};
    const A0=antes(a),B0=antes(b),O0=antes(ok);
    switchScreen('cards');CardsScreen.render();
    const A1=antes(a),B1=antes(b),O1=antes(ok);
    const flag=localStorage.getItem(DB._profilePrefix()+CardsScreen._REPARO_MEMORIA_KEY);
    DB.updateCard(a,{s:0.0801});CardsScreen.render();
    return {esperado,A0,A1,B0,B1,O0,O1,flag,segunda:DB.getCard(a).s};
  });
  ok(Math.abs(r.A1.s-r.esperado.s)<1e-9&&Math.abs(r.A1.d-r.esperado.d)<1e-9,'S/D reconstruídos pelo histórico');
  ok(r.A1.reps===3,'repetições alinhadas ao histórico');
  ok(r.A1.due===r.A0.due&&r.A1.intervalo===r.A0.intervalo,'nenhuma data ou intervalo muda');
  ok(r.B1.s===r.B0.s&&r.B1.reps===r.B0.reps,'predefinição com pesos otimizados fica intacta');
  ok(r.O1.s===r.O0.s&&r.O1.d===r.O0.d,'card já correto não é tocado');
  ok(!!r.flag&&JSON.parse(r.flag).cards===1,'reparo registrado uma vez por perfil');
  ok(r.segunda===0.0801,'o reparo automático não roda de novo');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`CARDS REPARO DE MEMÓRIA OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
