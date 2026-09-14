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

async function config(){await page.evaluate(()=>{switchScreen('config');ConfigScreen.render();});await page.waitForSelector('#cfg-plano-motores-card');}
async function extras(){await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});}
async function abrir(){await extras();await page.locator('#extras-plano-btn').click();await page.waitForFunction(()=>document.getElementById('ui-modal')?.style.display==='flex'&&!!document.querySelector('.ps-engine-chooser,.ps-single-engine'),null,{timeout:8000});}
async function fechar(){if(await page.locator('#ui-modal-cancel').isVisible().catch(()=>false))await page.locator('#ui-modal-cancel').click();}
async function overflow(sel){return page.locator(sel).evaluate(el=>Math.max(0,el.scrollWidth-el.clientWidth));}

try{
  const response=await page.goto(url,{waitUntil:'commit',timeout:10000});
  await page.waitForFunction(()=>!!document.documentElement,{timeout:5000});
  await page.waitForTimeout(1200);
  await page.waitForFunction(()=>typeof switchScreen==='function'||document.readyState==='complete',{timeout:10000}).catch(()=>{});
  await page.waitForTimeout(300);
  const boot=await page.evaluate(()=>({switchScreen:typeof switchScreen,governanca:typeof PlanoMotoresGovernancaV5,central:typeof PlanoMotoresCentralTecV2,controller:typeof PlanoSugestoesV3,extras:typeof ExtrasScreen,tec:typeof DesempenhoTecScreen,config:typeof ConfigScreen}));
  const diag=`status=${response?.status?.()} boot=${JSON.stringify(boot)} errors=${errors.join(' | ')}`;
  assert.equal(boot.switchScreen,'function',`bootstrap base ausente: ${diag}`);
  for(const [k,v] of Object.entries(boot)){if(k==='switchScreen')continue;assert.equal(v,'object',`bootstrap V5 ausente: ${k}=${v}; ${diag}`);}

  await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(e){if(typeof _quiet==='function')_quiet(e,'gov-test-gate');}
    const hoje=new Date(),dia=off=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);};
    const discs=['Auditoria','Contabilidade','Direito Tributário','AFO'];
    DB.saveSubjects(discs.map((nome,i)=>({id:`gov-${i}`,nome,ativo:true,peso:1,qtdQuestoes:20-i,pontosPorQuestao:1,minimoPct:50})));
    const rows=discs.flatMap((disc,di)=>Array.from({length:8},(_,ti)=>{const q=30,taxa=.42+di*.06+ti*.025,ac=Math.round(q*taxa);return{codigo:`${di+1}.${ti+1}`,nome:`${disc} Tópico ${ti+1}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};}));
    const snaps=Array.from({length:3},(_,i)=>({id:7700+i,startDate:dia(-60+i*30),endDate:dia(-60+i*30),date:dia(-60+i*30),label:`Gov ${i+1}`,rows}));
    DB._set(DB.KEYS.tec,snaps);DB.saveExtras([]);
    PlanoEngine.salvarPrefs({...PlanoEngine.DEFAULTS,migracao:4,minAmostra:20,limite:100,sugestoesDisciplinas:3,sugestoesTopicosDisc:1});
    DesempenhoTecScreen.scopeMode='consolidado';DesempenhoTecScreen.selectedSnapIds=new Set(snaps.map(s=>s.id));DesempenhoTecScreen.rangeStart=null;DesempenhoTecScreen.rangeEnd=null;DesempenhoTecScreen._scopedC=null;DesempenhoTecScreen._planoRefC=null;PlanoEngine._agrC=null;PlanoEngine._tecScopeSignature=null;PlanoEngine._indiceC=new WeakMap();
    PlanoMotoresGovernancaV5.restaurar();PlanoSugestoesV3.salvar({modo:'robusto'});
  });

  await config();
  assert.equal(await page.locator('[data-pmg-toggle]').count(),2);
  assert.equal(await page.locator('[data-pmg-toggle="simplificado"]').isChecked(),true);
  assert.equal(await page.locator('[data-pmg-toggle="robusto"]').isChecked(),true);
  assert.match(await page.locator('.pmg-status').textContent(),/2 motores ativos|Comparar fica disponível/i);
  assert.ok((await overflow('#cfg-plano-motores-card'))<=4);
  await abrir();
  assert.equal(await page.locator('.ps-engine-card').count(),2);
  assert.equal(await page.locator('.ps-compare-launch').count(),1);
  assert.equal(await page.locator('#ui-modal-body [data-ps-meta],#ui-modal-body [data-rv4-field],#ui-modal-body [data-rv5-field]').count(),0,'Extras deve estar livre de parâmetros');
  await fechar();

  await config();await page.locator('[data-pmg-toggle="simplificado"]').uncheck();
  await page.waitForFunction(()=>PlanoMotoresGovernancaV5.estado().simplificado===false);
  assert.match(await page.locator('.pmg-status').textContent(),/1 motor ativo.*Robusto/i);
  await abrir();assert.equal(await page.locator('.ps-engine-chooser').count(),0);assert.match(await page.locator('.ps-single-engine').textContent(),/Robusto/i);assert.equal(await page.locator('[data-ps-modo]').count(),0);await fechar();

  await config();await page.locator('[data-pmg-toggle="simplificado"]').check();await page.locator('[data-pmg-toggle="robusto"]').uncheck();
  await page.waitForFunction(()=>{const e=PlanoMotoresGovernancaV5.estado();return e.simplificado&&!e.robusto;});
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();PlanoMotoresGovernancaV5.syncVisibility();PlanoMotoresCentralTecV2.ensureUi();});
  assert.equal(await page.locator('.tec-subtab[data-tectab="plano"]').isVisible(),false);
  const tabMotores=page.locator('.tec-subtab[data-tectab="motores"]');assert.equal(await tabMotores.isVisible(),true,'central deve permanecer visível com Simplificado ativo');assert.equal(await tabMotores.evaluate(el=>el.classList.contains('ux-off')),false);
  await abrir();assert.equal(await page.locator('.ps-engine-chooser').count(),0);assert.match(await page.locator('.ps-single-engine').textContent(),/Simplificado/i);assert.equal(await page.locator('#ui-modal-body [data-ps-meta],[data-rv5-field]').count(),0);await fechar();

  const extrasAntes=await page.evaluate(()=>DB.getExtras().length);
  await config();await page.locator('[data-pmg-toggle="simplificado"]').uncheck();
  await page.waitForFunction(()=>{const e=PlanoMotoresGovernancaV5.estado();return !e.simplificado&&!e.robusto;});
  await extras();assert.equal(await page.locator('#extras-plano-btn').isVisible(),false);
  await page.evaluate(()=>{switchScreen('desempenhotec');PlanoMotoresGovernancaV5.syncVisibility();PlanoMotoresCentralTecV2.ensureUi();});
  assert.equal(await page.locator('.tec-subtab[data-tectab="plano"]').isVisible(),false);assert.equal(await page.locator('.tec-subtab[data-tectab="motores"]').isVisible(),false);
  const off=await page.evaluate(()=>PlanoSugestoesV3.calcular({modo:'robusto'}));assert.equal(off.erro,'motores-desabilitados');assert.equal(await page.evaluate(()=>DB.getExtras().length),extrasAntes);

  await config();await page.locator('[data-pmg-reset]').click();await page.waitForFunction(()=>{const e=PlanoMotoresGovernancaV5.estado();return e.simplificado&&e.robusto;});
  await page.evaluate(()=>PlanoSugestoesV3.salvar({modo:'comparar'}));assert.equal(await page.evaluate(()=>PlanoSugestoesV3.prefs().modo),'comparar');
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();PlanoMotoresCentralTecV2.ensureUi();});
  assert.equal(await page.locator('.tec-subtab[data-tectab="plano"]').isVisible(),true);assert.equal(await page.locator('.tec-subtab[data-tectab="motores"]').isVisible(),true);

  await page.setViewportSize({width:360,height:640});await config();assert.ok((await overflow('#cfg-plano-motores-card'))<=4);await abrir();assert.ok((await overflow('#ui-modal-body'))<=4);await fechar();
  assert.deepEqual(errors,[],`erros no navegador: ${errors.join(' | ')}`);
  console.log('OK: governança V5 no navegador — quatro estados, central visível e Extras sem parâmetros.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
