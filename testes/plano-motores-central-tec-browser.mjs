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
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});
await page.route(/^https:\/\//,route=>route.abort());
const overflow=sel=>page.locator(sel).evaluate(el=>Math.max(0,el.scrollWidth-el.clientWidth));

try{
  const response=await page.goto(url,{waitUntil:'commit',timeout:10000});
  await page.waitForFunction(()=>!!document.documentElement,{timeout:5000});
  await page.waitForTimeout(1200);
  await page.waitForFunction(()=>typeof switchScreen==='function'||document.readyState==='complete',{timeout:10000}).catch(()=>{});
  await page.waitForTimeout(300);
  const boot=await page.evaluate(()=>({switchScreen:typeof switchScreen,central:typeof PlanoMotoresCentralTecV2,governanca:typeof PlanoMotoresGovernancaV5,controller:typeof PlanoSugestoesV3,simplificado:typeof PlanoSugestoesSimplificadoV2,robusto:typeof PlanoSugestoesRobustoV5,configRobusto:typeof PlanoRobustoConfigV5,tec:typeof DesempenhoTecScreen}));
  const diag=`status=${response?.status?.()} boot=${JSON.stringify(boot)} errors=${errors.join(' | ')}`;
  assert.equal(boot.switchScreen,'function',`bootstrap base ausente: ${diag}`);for(const[k,v]of Object.entries(boot)){if(k==='switchScreen')continue;assert.equal(v,'object',`bootstrap V5 ausente: ${k}=${v}; ${diag}`);}

  await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(e){if(typeof _quiet==='function')_quiet(e,'central-tec-gate');}
    const hoje=new Date(),dia=off=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);},discs=['Auditoria','Contabilidade','Direito Tributário','AFO'];
    DB.saveSubjects(discs.map((nome,i)=>({id:`central-${i}`,nome,ativo:true,peso:1,qtdQuestoes:20-i,pontosPorQuestao:1,minimoPct:50})));
    const rows=discs.flatMap((disc,di)=>Array.from({length:8},(_,ti)=>{const q=30,taxa=.42+di*.06+ti*.025,ac=Math.round(q*taxa);return{codigo:`${di+1}.${ti+1}`,nome:`${disc} Tópico ${ti+1}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};}));
    const snaps=Array.from({length:3},(_,i)=>({id:8800+i,startDate:dia(-60+i*30),endDate:dia(-60+i*30),date:dia(-60+i*30),label:`Central ${i+1}`,rows}));
    DB._set(DB.KEYS.tec,snaps);DB.saveExtras([]);PlanoEngine.salvarPrefs({...PlanoEngine.DEFAULTS,migracao:4,minAmostra:20,limite:100,sugestoesDisciplinas:3,sugestoesTopicosDisc:1});
    DesempenhoTecScreen.scopeMode='consolidado';DesempenhoTecScreen.selectedSnapIds=new Set(snaps.map(s=>s.id));DesempenhoTecScreen.rangeStart=null;DesempenhoTecScreen.rangeEnd=null;DesempenhoTecScreen._scopedC=null;DesempenhoTecScreen._planoRefC=null;PlanoEngine._agrC=null;PlanoEngine._tecScopeSignature=null;PlanoEngine._indiceC=new WeakMap();
    PlanoMotoresGovernancaV5.restaurar();PlanoSugestoesV3.salvar({modo:'robusto'});
  });

  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();});
  await page.waitForSelector('.tec-subtab[data-tectab="motores"]');const tab=page.locator('.tec-subtab[data-tectab="motores"]');
  assert.equal(await tab.isVisible(),true,'aba Motores deve aparecer quando ao menos um motor está ativo');assert.equal(await tab.evaluate(el=>el.classList.contains('ux-off')),false);
  await tab.click();await page.waitForSelector('#tec-panel-motores .pmc-engine-card');

  assert.equal(await page.locator('[data-pmc-engine="simplificado"]').count(),1,'Simplificado deve ter painel próprio');
  assert.equal(await page.locator('[data-pmc-engine="robusto"]').count(),1,'Robusto deve ter painel próprio');
  assert.equal(await page.locator('[data-pmc-simple="fase"]').count(),1);assert.equal(await page.locator('[data-pmc-simple="meta"]').count(),1);assert.equal(await page.locator('[data-pmc-simple="minAmostra"]').count(),1);assert.equal(await page.locator('[data-pmc-simple="alvoQuestoes"]').count(),1);
  assert.ok(await page.locator('[data-rv5-field]').count()>60,'painel Robusto V5 deve expor política completa');assert.equal(await page.locator('.rv5-section').count(),11);assert.equal(await page.locator('[data-rv5-mode]').count(),5);assert.equal(await page.locator('[data-rv5-manual]').count(),1);assert.equal(await page.locator('[data-rv5-export]').count(),1);assert.ok((await overflow('#tec-panel-motores'))<=4);

  const meta=page.locator('[data-pmc-simple="meta"]');await meta.fill('93');await meta.dispatchEvent('change');assert.equal(await page.evaluate(()=>PlanoSugestoesSimplificadoV2.prefs().meta),93);
  const opt=page.locator('[data-rv5-field="recursos.otimizadorAtivo"]');await opt.uncheck();await page.waitForFunction(()=>PlanoRobustoConfigV5.prefs(PlanoRobustoConfigV5.detectarModo()).recursos.otimizadorAtivo===false);assert.equal(await page.locator('[data-rv5-row="recursos.otimizadorAtivo"]').evaluate(el=>el.classList.contains('is-modified')),true);
  const search=page.locator('[data-rv5-search-input]');await search.fill('meta competitiva');const visiveis=page.locator('[data-rv5-row]:visible');assert.ok(await visiveis.count()>=1,'busca deve retornar ao menos um parâmetro');const buscaOk=await visiveis.evaluateAll(rows=>rows.every(r=>(r.dataset.rv5Search||'').includes('meta competitiva')));assert.equal(buscaOk,true,'toda linha visível deve corresponder ao termo pesquisado');await search.fill('');await page.locator('[data-rv5-only-mod]').check();assert.ok(await page.locator('[data-rv5-row]:visible').count()>=1);await page.locator('[data-rv5-only-mod]').uncheck();
  await page.locator('[data-rv5-reset-all]').click();await page.waitForFunction(()=>PlanoRobustoConfigV5.prefs(PlanoRobustoConfigV5.detectarModo()).recursos.otimizadorAtivo===true);
  const manual=await page.evaluate(()=>PlanoRobustoConfigV5.manualHtml(PlanoRobustoConfigV5.detectarModo()));assert.match(manual,/Manual do Módulo Robusto V5/);assert.match(manual,/Imprimir \/ Salvar em PDF/);

  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});await page.locator('#extras-plano-btn').click();await page.waitForFunction(()=>document.getElementById('ui-modal')?.style.display==='flex'&&!!document.querySelector('.ps-engine-chooser,.ps-single-engine'),null,{timeout:8000});assert.equal(await page.locator('#ui-modal-body :is([data-pmc-simple],[data-rv5-field],[data-rv5-reset-all],[data-rv4-field],[data-ps-meta],[data-ps-min],[data-ps-alvo],[data-ps-banca],[data-ps-fase])').count(),0,'Extras não pode editar parâmetros');assert.match(await page.locator('#ui-modal-body').textContent(),/Desempenho TEC.*Motores|Configuração centralizada/i);await page.locator('#ui-modal-cancel').click();

  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:false,simplificado:true}));await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('motores');});assert.equal(await tab.isVisible(),true);assert.equal(await page.locator('[data-pmc-engine="simplificado"]').count(),1);assert.equal(await page.locator('[data-pmc-engine="robusto"]').count(),0);
  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:true,simplificado:false}));await page.evaluate(()=>{DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('motores');});assert.equal(await page.locator('[data-pmc-engine="simplificado"]').count(),0);assert.equal(await page.locator('[data-pmc-engine="robusto"]').count(),1);
  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:false,simplificado:false}));await page.evaluate(()=>DesempenhoTecScreen.render());assert.equal(await tab.isVisible(),false);assert.notEqual(await page.evaluate(()=>DesempenhoTecScreen.tecTab),'motores');
  await page.evaluate(()=>PlanoMotoresGovernancaV5.restaurar());

  await page.setViewportSize({width:360,height:640});await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('motores');});assert.ok((await overflow('#tec-panel-motores'))<=4,'central V5 deve caber em 360px');
  assert.deepEqual(errors,[],`erros no navegador: ${errors.join(' | ')}`);
  console.log('OK: central TEC V2/V5 — dois painéis editáveis no TEC, Extras sem parâmetros e responsividade validada.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
