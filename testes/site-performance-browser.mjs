import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json' };
const server = createServer((req,res) => {
  const raw=(req.url||'/').split('?')[0], name=raw==='/'?'/index.html':raw;
  try { const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,''))); res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body); }
  catch { res.writeHead(404).end('nao encontrado'); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{ if(m.type()==='error'&&!/net::|ERR_|favicon/.test(m.text())) errors.push(m.text()); });

const instalarLongTasks = async (nome='__globalPerf') => page.evaluate((n)=>{
  window[n]={longTasks:[]};
  if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
    const po=new PerformanceObserver(l=>l.getEntries().forEach(e=>window[n].longTasks.push({name:e.name,duration:e.duration,start:e.startTime})));
    po.observe({entryTypes:['longtask']});
  }
},nome);

try {
  const startupIni=Date.now();
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchScreen==='function'&&typeof DB==='object',{timeout:30000});
  const startupNormalMs=Date.now()-startupIni;
  const volume=await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch{}
    const hoje=new Date();
    const dia=(off)=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);};
    const instante=(offMs)=>new Date(Date.now()-offMs).toISOString();
    const disciplinas=Array.from({length:12},(_,i)=>`Matéria Global ${String(i+1).padStart(2,'0')}`);
    DB.saveSubjects(disciplinas.map((nome,i)=>({id:`glob-${i}`,nome,ativo:true,peso:1,qtdQuestoes:100,pontosPorQuestao:1,minimoPct:50,cor:'#456789'})));
    const linhas=(rodada)=>disciplinas.flatMap((disc,di)=>{
      const folhas=Array.from({length:80},(_,ti)=>{
        const q=20+((ti+rodada)%5)*5, taxa=Math.max(.2,Math.min(.95,.34+(ti%18)*.025+rodada*.015+di*.002));
        const ac=Math.round(q*taxa);
        return {codigo:String(ti+1).padStart(3,'0'),nome:`Tópico ${String(ti+1).padStart(3,'0')}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};
      });
      const q=folhas.reduce((s,x)=>s+x.questoes,0),ac=folhas.reduce((s,x)=>s+x.acertos,0);
      return [{codigo:null,nome:disc,depth:0,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100},...folhas];
    });
    const snaps=Array.from({length:8},(_,i)=>({id:9500+i,startDate:dia(-210+i*30),endDate:dia(-210+i*30),date:dia(-210+i*30),label:`Retrato global ${i+1}`,rows:linhas(i)}));
    DB._set(DB.KEYS.tec,snaps);
    DB._set(DB.KEYS.extras,Array.from({length:180},(_,i)=>({id:`extra-${i}`,titulo:`Atividade Extra ${i+1}`,descricao:'Carga de auditoria',tipo:i%3===0?'questoes':'teoria',disciplina:disciplinas[i%disciplinas.length],qtd:20+(i%30),feito:i%4===0,status:i%4===0?'concluida':'ativa',createdAt:instante(i*86400000),updatedAt:instante(i*3600000)})));
    DB._set(DB.KEYS.links,Array.from({length:250},(_,i)=>({id:`link-${i}`,titulo:`Link ${i+1}`,url:'https://example.com/'+i,categoria:'Referência',updatedAt:instante(i*60000)})));
    DB._set(DB.KEYS.leis,Array.from({length:120},(_,i)=>({id:`lei-${i}`,titulo:`Lei ${i+1}`,nome:`Lei ${i+1}`,texto:'Art. 1º Texto de teste. '.repeat(20),updatedAt:instante(i*1000)})));
    DB._set(DB.KEYS.entries,Array.from({length:2400},(_,i)=>({id:`ent-${i}`,date:dia(-(i%240)),data:dia(-(i%240)),subject:disciplinas[i%disciplinas.length],disciplina:disciplinas[i%disciplinas.length],minutes:30+(i%90),minutos:30+(i%90),durationMin:30+(i%90),questions:20+(i%40),questoes:20+(i%40),total:20+(i%40),correct:10+(i%20),acertos:10+(i%20),method:'Questões',metodo:'Questões'})));
    try{ DesempenhoTecScreen.scopeMode='consolidado'; DesempenhoTecScreen.selectedSnapIds=new Set(snaps.map(s=>s.id)); DesempenhoTecScreen._scopedC=null; DesempenhoTecScreen._planoRefC=null; }catch{}
    return {snapshots:snaps.length,disciplinas:disciplinas.length,topicos:disciplinas.length*80,linhas:snaps.reduce((s,x)=>s+x.rows.length,0),entries:2400,extras:180,links:250,leis:120};
  });
  await instalarLongTasks();

  const telas=await page.evaluate(()=>[...new Set([...document.querySelectorAll('[data-screen]')].map(b=>b.dataset.screen).filter(Boolean))]);
  const resultados=[];
  for(const tela of telas){
    await page.evaluate(()=>{ __globalPerf.longTasks=[]; });
    const sync=await page.evaluate((t)=>{const ini=performance.now();switchScreen(t);return performance.now()-ini;},tela);
    const ini=Date.now();
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.waitForTimeout(120);
    const wall=Date.now()-ini;
    const info=await page.evaluate((t)=>({active:document.getElementById('screen-'+t)?.classList.contains('active')||false,longTasks:__globalPerf.longTasks.slice(),text:(document.getElementById('screen-'+t)?.textContent||'').trim().length}),tela);
    const maxLong=Math.max(0,...info.longTasks.map(x=>x.duration));
    resultados.push({tela,syncMs:+sync.toFixed(1),settleMs:wall,maxLongMs:+maxLong.toFixed(1),longTasks:info.longTasks.length,texto:info.text,active:info.active});
  }
  resultados.sort((a,b)=>Math.max(b.syncMs,b.maxLongMs)-Math.max(a.syncMs,a.maxLongMs));
  console.log('PERF_SITE_STARTUP normalMs='+startupNormalMs);
  console.log('PERF_SITE volume='+JSON.stringify(volume));
  console.log('PERF_SITE_RANKING '+JSON.stringify(resultados));

  // Segunda passagem conservadora: CPU 4x mais lenta, aproximadamente o cenário
  // em que um atraso de 250ms no desktop vira travamento percebido no celular.
  // Runners compartilhados podem sofrer jitter isolado. Mantemos o limite de 6s,
  // mas fazemos uma única contraprova apenas quando a primeira medição o excede.
  // Uma regressão real tende a se repetir; um pico de infraestrutura, não.
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const startupSlowAttempts=[];
  for(let tentativa=0; tentativa<2; tentativa++){
    const slowIni=Date.now();
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>typeof switchScreen==='function'&&typeof DB==='object',{timeout:30000});
    startupSlowAttempts.push(Date.now()-slowIni);
    if(startupSlowAttempts.at(-1)<6000) break;
  }
  const startupSlowMs=Math.min(...startupSlowAttempts);
  await page.evaluate(()=>{ try{ProfileUI.hideGate();}catch{} });
  await instalarLongTasks('__slowPerf');
  const pesadas=['extras','desempenhotec','evolucao','conquistas','leis'];
  const slow=[];
  for(const tela of pesadas){
    await page.evaluate(()=>{ __slowPerf.longTasks=[]; try{ if(typeof DesempenhoTecScreen!=='undefined'){DesempenhoTecScreen._scopedC=null;DesempenhoTecScreen._planoRefC=null;} if(typeof PlanoEngine!=='undefined') PlanoEngine._agrC=null; }catch{} });
    const sync=await page.evaluate((t)=>{const ini=performance.now();switchScreen(t);return performance.now()-ini;},tela);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.waitForTimeout(180);
    const info=await page.evaluate((t)=>({active:document.getElementById('screen-'+t)?.classList.contains('active')||false,longTasks:__slowPerf.longTasks.slice()}),tela);
    slow.push({tela,syncMs:+sync.toFixed(1),maxLongMs:+Math.max(0,...info.longTasks.map(x=>x.duration)).toFixed(1),longTasks:info.longTasks.length,active:info.active});
  }
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  console.log('PERF_SITE_SLOW4X startupMs='+startupSlowMs+' attempts='+JSON.stringify(startupSlowAttempts)+' ranking='+JSON.stringify(slow));

  assert.ok(resultados.every(x=>x.active),'todas as telas devem ativar corretamente');
  assert.ok(resultados.every(x=>x.syncMs<1000),'nenhuma troca de tela pode bloquear >1s antes de devolver o controle: '+JSON.stringify(resultados.filter(x=>x.syncMs>=1000)));
  assert.ok(resultados.every(x=>x.maxLongMs<1500),'nenhuma tela pode gerar long task >1,5s: '+JSON.stringify(resultados.filter(x=>x.maxLongMs>=1500)));
  assert.ok(startupSlowMs<6000,'startup com CPU 4x não pode ultrapassar 6s em duas medições: '+JSON.stringify(startupSlowAttempts));
  assert.ok(slow.every(x=>x.active),'telas pesadas devem ativar sob CPU 4x');
  assert.ok(slow.every(x=>x.syncMs<2200),'nenhuma tela pesada pode bloquear >2,2s sob CPU 4x: '+JSON.stringify(slow.filter(x=>x.syncMs>=2200)));
  assert.deepEqual(errors,[],'não deve haver erro de página/console durante a varredura global');
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}