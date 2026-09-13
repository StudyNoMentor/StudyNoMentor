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
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon/.test(m.text()))errors.push(m.text());});

async function esperarPlano(){
  await page.waitForFunction(()=>{
    const l=document.getElementById('plano-lista');
    if(!l)return false;
    const txt=l.textContent||'';
    return !/Calculando o seu plano/i.test(txt) && !!l.querySelector('.pl-item,.pl-hoje,.pl-mais,.pl-empty,.pl-sem-dados');
  },null,{timeout:10000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}

try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchScreen==='function'&&typeof DesempenhoTecScreen==='object'&&typeof PlanoEngine==='object'&&typeof ReforcoAdaptativo==='object',{timeout:30000});

  const volume=await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(e){if(typeof _quiet==='function')_quiet(e,'teste-plano-hide-gate');}
    const DT=DesempenhoTecScreen, PE=PlanoEngine;
    const hoje=new Date();
    const dia=(off)=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);};
    const disciplinas=Array.from({length:10},(_,i)=>`Matéria Perf ${String(i+1).padStart(2,'0')}`);
    DB.saveSubjects(disciplinas.map((nome,i)=>({id:`perf-disc-${i}`,nome,ativo:true,peso:1,qtdQuestoes:100,pontosPorQuestao:1,minimoPct:50})));
    const linhas=(rodada)=>disciplinas.flatMap((disc,di)=>{
      const folhas=Array.from({length:100},(_,ti)=>{
        const q=25+((ti+rodada)%6)*5;
        const taxa=Math.max(.18,Math.min(.94,.35+(ti%20)*.022+rodada*.018+di*.002));
        const ac=Math.round(q*taxa);
        return {codigo:String(ti+1).padStart(3,'0'),nome:`Tópico ${String(ti+1).padStart(3,'0')}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};
      });
      const q=folhas.reduce((s,x)=>s+x.questoes,0),ac=folhas.reduce((s,x)=>s+x.acertos,0);
      return [{codigo:null,nome:disc,depth:0,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100},...folhas];
    });
    const snaps=Array.from({length:8},(_,i)=>({id:9100+i,startDate:dia(-210+i*30),endDate:dia(-210+i*30),date:dia(-210+i*30),label:`Retrato perf ${i+1}`,rows:linhas(i)}));
    DB._set(DB.KEYS.tec,snaps);
    DB.saveIncidencia(disciplinas.flatMap((disc,di)=>[
      {banca:'BANCA PERF',disciplina:disc,topico:disc,codigo:null,depth:0,incidencia:1200-di*20},
      ...Array.from({length:100},(_,ti)=>({banca:'BANCA PERF',disciplina:disc,topico:`Tópico ${String(ti+1).padStart(3,'0')}`,codigo:String(ti+1).padStart(3,'0'),depth:1,incidencia:120-(ti%60)}))
    ]));
    PE.salvarPrefs({...PE.DEFAULTS,migracao:4,limite:10,minAmostra:20,incluirPequenas:false,granPiso:0,foco:[],disciplina:'__todas__'});
    ReforcoAdaptativo.save({ativo:true});
    DT.scopeMode='consolidado';DT.selectedSnapIds=new Set(snaps.map(s=>s.id));DT.rangeStart=null;DT.rangeEnd=null;
    DT._scopedC=null;DT._planoRefC=null;DT._fatias=null;PE._agrC=null;PE._tecScopeSignature=null;PE._indiceC=new WeakMap();
    DT.tecTab='analise';
    switchScreen('desempenhotec');
    DT.render();
    DT.switchTecTab('analise');

    window.__planoPerf={calls:0,durations:[],longTasks:[]};
    const base=PE.calcular;
    PE.calcular=function(){const t=performance.now();try{return base.apply(this,arguments);}finally{window.__planoPerf.calls++;window.__planoPerf.durations.push(performance.now()-t);}};
    if(typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask')){
      const po=new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__planoPerf.longTasks.push(e.duration)));
      po.observe({entryTypes:['longtask']});window.__planoPerfObserver=po;
    }
    return {snapshots:snaps.length,disciplinas:disciplinas.length,topicos:disciplinas.length*100,linhas:snaps.reduce((s,x)=>s+x.rows.length,0)};
  });

  const tab=page.locator('#tec-subtabs .tec-subtab[data-tectab="plano"]');
  await tab.waitFor({state:'visible',timeout:5000});

  const clickSync=await page.evaluate(()=>{const b=document.querySelector('#tec-subtabs .tec-subtab[data-tectab="plano"]');const t=performance.now();b.click();return performance.now()-t;});
  assert.ok(clickSync<250,`clique no Plano bloqueou ${clickSync.toFixed(0)}ms antes de devolver o controle`);
  await page.waitForFunction(()=>/Calculando o seu plano/i.test(document.getElementById('plano-lista')?.textContent||''),null,{timeout:1500});
  const tFirst=Date.now();
  await esperarPlano();
  const firstWall=Date.now()-tFirst;
  const first=await page.evaluate(()=>({calls:__planoPerf.calls,durations:__planoPerf.durations.slice(),longTasks:__planoPerf.longTasks.slice()}));
  assert.ok(first.calls<=2,`abrir Plano executou ${first.calls} cálculos completos`);
  assert.ok(Math.max(0,...first.durations)<5000,`um cálculo do Plano bloqueou ${Math.max(...first.durations).toFixed(0)}ms`);

  await page.evaluate(()=>{DesempenhoTecScreen.switchTecTab('analise');__planoPerf.calls=0;__planoPerf.durations=[];__planoPerf.longTasks=[];});
  await page.waitForTimeout(80);
  const repeatStart=Date.now();
  const repeatClick=await page.evaluate(()=>{const b=document.querySelector('#tec-subtabs .tec-subtab[data-tectab="plano"]');const t=performance.now();b.click();return performance.now()-t;});
  await esperarPlano();
  const repeatWall=Date.now()-repeatStart;
  const repeat=await page.evaluate(()=>({calls:__planoPerf.calls,durations:__planoPerf.durations.slice(),longTasks:__planoPerf.longTasks.slice()}));
  assert.ok(repeatClick<250,`segundo clique no Plano bloqueou ${repeatClick.toFixed(0)}ms antes de devolver o controle`);
  assert.ok(repeat.calls<=2,`reabrir Plano executou ${repeat.calls} cálculos completos`);
  assert.ok(repeatWall<6000,`reabrir Plano levou ${repeatWall}ms no perfil de estresse`);

  const adapt=await page.evaluate(()=>{
    const r=PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(),PlanoEngine.prefs());
    const todos=[...(r?.itens||[]),...(r?.pequenas||[])];
    return {tem:todos.some(x=>x.prescricaoAdaptativa),n:todos.length};
  });
  assert.ok(adapt.tem||adapt.n===0,'otimizações do Plano não podem remover a prescrição adaptativa');
  assert.deepEqual(errors,[],'não deve haver erro de página/console no fluxo Desempenho TEC → Plano');

  const max1=Math.round(Math.max(0,...first.durations));
  const max2=Math.round(Math.max(0,...repeat.durations));
  const lt1=Math.round(Math.max(0,...first.longTasks));
  const lt2=Math.round(Math.max(0,...repeat.longTasks));
  console.log(`PERF_PLANO volume=${JSON.stringify(volume)} click=${clickSync.toFixed(1)}ms primeiro=${firstWall}ms calc=${max1}ms calls=${first.calls} long=${lt1}ms repetir=${repeatWall}ms calc2=${max2}ms calls2=${repeat.calls} long2=${lt2}ms`);
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
