import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end('nao encontrado');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`,browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});await page.route(/^https:\/\//,r=>r.abort());
const overflow=sel=>page.locator(sel).evaluate(el=>Math.max(0,el.scrollWidth-el.clientWidth));
try{
  await page.goto(url,{waitUntil:'commit',timeout:10000});await page.waitForFunction(()=>!!document.documentElement);await page.waitForTimeout(1500);
  const boot=await page.evaluate(()=>({fonte:typeof TecPlanoFonteMotorV1,r7:typeof PlanoSugestoesRobustoV7,router7:typeof PlanoRobustoRouterV7,controller:typeof (window.PlanoSugestoesV4||window.PlanoSugestoesV3),gov:typeof PlanoMotoresGovernancaV5,tec:typeof DesempenhoTecScreen}));for(const[k,v]of Object.entries(boot))assert.equal(v,'object',`bootstrap ausente ${k}: ${JSON.stringify(boot)}`);
  await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(e){if(typeof _quiet==='function')_quiet(e,'tpm-gate');}
    const hoje=new Date(),dia=off=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);},discs=['Auditoria','Contabilidade Geral','Direito Tributário','AFO'];
    DB.saveSubjects(discs.map((nome,i)=>({id:`tpm-${i}`,nome,ativo:true,peso:1,qtdQuestoes:24-i*2,pontosPorQuestao:1,minimoPct:50})));
    const rows=discs.flatMap((disc,di)=>Array.from({length:8},(_,ti)=>{const q=30,taxa=.44+di*.055+ti*.022,ac=Math.round(q*taxa);return{codigo:`${di+1}.${ti+1}`,nome:`${disc} Tópico ${ti+1}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};}));
    const snaps=Array.from({length:3},(_,i)=>({id:9900+i,startDate:dia(-60+i*30),endDate:dia(-60+i*30),date:dia(-60+i*30),label:`Motor ${i+1}`,rows}));DB._set(DB.KEYS.tec,snaps);
    const extras=discs.map((disc,i)=>({id:`tempo-${i}`,disciplina:disc,status:'concluida',historico:[{data:dia(-25),quantidade:30,minutos:120},{data:dia(-12),quantidade:30,minutos:120}]}));DB.saveExtras(extras);
    PlanoEngine.salvarPrefs({...PlanoEngine.DEFAULTS,migracao:4,minAmostra:20,limite:50,sugestoesDisciplinas:3,sugestoesTopicosDisc:1,ordenar:'pior'});
    DesempenhoTecScreen.scopeMode='consolidado';DesempenhoTecScreen.selectedSnapIds=new Set(snaps.map(s=>s.id));DesempenhoTecScreen.rangeStart=null;DesempenhoTecScreen.rangeEnd=null;DesempenhoTecScreen._scopedC=null;DesempenhoTecScreen._planoRefC=null;PlanoEngine._agrC=null;PlanoEngine._tecScopeSignature=null;PlanoEngine._indiceC=new WeakMap();
    PlanoMotoresGovernancaV5.restaurar();TecPlanoFonteMotorV1.salvar('robusto');
  });
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');});await page.waitForSelector('[data-tpm-selector]');await page.waitForSelector('[data-tpm-output][data-tpm-model="robusto"]');
  assert.equal(await page.locator('[data-tpm-source="robusto"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-tpm-source="simplificado"]').count(),1);
  let cards=page.locator('[data-tpm-output] [data-tpm-rec]');assert.ok(await cards.count()>=1&&await cards.count()<=3,'Robusto deve sugerir até 3 frentes');const rdiscs=await cards.evaluateAll(xs=>xs.map(x=>x.dataset.disciplina));assert.equal(new Set(rdiscs).size,rdiscs.length,'Robusto deve usar disciplinas distintas');
  const txtR=await page.locator('[data-tpm-output]').textContent();assert.match(txtR,/questões aprofundadas/i);assert.match(txtR,/min\/questão|≈ \d+ min/i,'Robusto deve usar tempo real quando há amostra suficiente');assert.doesNotMatch(txtR,/Lei seca|Flashcards|Teoria focal|Revisão dirigida/i,'Robusto V7 não deve prescrever método pedagógico');
  assert.equal(await page.locator('#plano-proj .pl-hero').isVisible(),true,'métricas observadas do Plano devem continuar visíveis');
  for(const sel of ['#plano-lista>.pl-hoje','#plano-lista>.pl-ciclo.pl-tempo','#plano-lista>.pl-ordem','#plano-lista>.pl-porque','#plano-lista>.pl-item','#plano-lista>.pl-segundo']){const l=page.locator(sel);if(await l.count())assert.equal(await l.first().isVisible(),false,`decisão legada deve ficar oculta: ${sel}`);}
  const caminho=page.locator('#plano-proj .tpm-legacy-decision');if(await caminho.count())assert.equal(await caminho.isVisible(),false,'caminho curto legado não deve competir com motor');

  await page.locator('[data-tpm-source="simplificado"]').click();await page.waitForSelector('[data-tpm-output][data-tpm-model="simplificado"]');assert.equal(await page.evaluate(()=>TecPlanoFonteMotorV1.fonte()),'simplificado');const txtS=await page.locator('[data-tpm-output]').textContent();assert.match(txtS,/Tempo não modelado pelo Simplificado/i);assert.match(txtS,/lacuna.*amostra|regra direta/i);assert.doesNotMatch(txtS,/min\/questão/i,'Simplificado não pode emprestar relógio do Robusto');
  cards=page.locator('[data-tpm-output] [data-tpm-rec]');const sdiscs=await cards.evaluateAll(xs=>xs.map(x=>x.dataset.disciplina));assert.equal(new Set(sdiscs).size,sdiscs.length);

  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:false,simplificado:true}));await page.evaluate(()=>{DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');});const tab=page.locator('.tec-subtab[data-tectab="plano"]');assert.equal(await tab.isVisible(),true,'Plano deve continuar disponível com apenas Simplificado');assert.equal(await page.locator('[data-tpm-source="robusto"]').count(),0);assert.equal(await page.locator('[data-tpm-output]').getAttribute('data-tpm-model'),'simplificado');
  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:true,simplificado:false}));await page.evaluate(()=>{DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');});assert.equal(await tab.isVisible(),true,'Plano deve continuar disponível com apenas Robusto');assert.equal(await page.locator('[data-tpm-source="simplificado"]').count(),0);assert.equal(await page.locator('[data-tpm-output]').getAttribute('data-tpm-model'),'robusto');
  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:false,simplificado:false}));await page.evaluate(()=>DesempenhoTecScreen.render());assert.equal(await tab.isVisible(),false,'sem motores o Plano deve ficar oculto');
  await page.evaluate(()=>{PlanoMotoresGovernancaV5.restaurar();TecPlanoFonteMotorV1.salvar('robusto');});
  await page.setViewportSize({width:360,height:640});await page.evaluate(()=>{DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');});assert.ok(await overflow('#tec-panel-plano')<=4,'seletor/recomendação deve caber em 360px');assert.deepEqual(errors,[],`erros no navegador: ${errors.join(' | ')}`);
  console.log('OK: Plano TEC — fonte Simplificado/Robusto explícita, decisão legada removida e Robusto V7 focado em dose/tempo.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
