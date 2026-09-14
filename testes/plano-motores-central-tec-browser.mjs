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
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon/.test(m.text()))errors.push(m.text());});
const overflow=sel=>page.locator(sel).evaluate(el=>Math.max(0,el.scrollWidth-el.clientWidth));

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchScreen==='function'&&typeof PlanoMotoresCentralTecV1==='object'&&typeof PlanoMotoresGovernancaV5==='object'&&typeof PlanoSugestoesV2==='object'&&typeof PlanoSugestoesSimplificadoV2==='object'&&typeof PlanoSugestoesRobustoV4==='object',{timeout:30000});
  await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(e){if(typeof _quiet==='function')_quiet(e,'central-tec-gate');}
    const hoje=new Date(),dia=off=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);};
    const discs=['Auditoria','Contabilidade','Direito Tributário','AFO'];
    DB.saveSubjects(discs.map((nome,i)=>({id:`central-${i}`,nome,ativo:true,peso:1,qtdQuestoes:20-i,pontosPorQuestao:1,minimoPct:50})));
    const rows=discs.flatMap((disc,di)=>Array.from({length:8},(_,ti)=>{const q=30,taxa=.42+di*.06+ti*.025,ac=Math.round(q*taxa);return{codigo:`${di+1}.${ti+1}`,nome:`${disc} Tópico ${ti+1}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};}));
    const snaps=Array.from({length:3},(_,i)=>({id:8800+i,startDate:dia(-60+i*30),endDate:dia(-60+i*30),date:dia(-60+i*30),label:`Central ${i+1}`,rows}));
    DB._set(DB.KEYS.tec,snaps);DB.saveExtras([]);
    PlanoEngine.salvarPrefs({...PlanoEngine.DEFAULTS,migracao:4,minAmostra:20,limite:100,sugestoesDisciplinas:3,sugestoesTopicosDisc:1});
    DesempenhoTecScreen.scopeMode='consolidado';DesempenhoTecScreen.selectedSnapIds=new Set(snaps.map(s=>s.id));DesempenhoTecScreen.rangeStart=null;DesempenhoTecScreen.rangeEnd=null;DesempenhoTecScreen._scopedC=null;DesempenhoTecScreen._planoRefC=null;PlanoEngine._agrC=null;PlanoEngine._tecScopeSignature=null;PlanoEngine._indiceC=new WeakMap();
    PlanoMotoresGovernancaV5.restaurar();PlanoSugestoesV2.salvar({modo:'robusto',fase:'pre',meta:90,minAmostra:20,alvoQuestoes:30,banca:'__todas__'});
  });

  // Central nasce/atualiza pelo render normal do Desempenho TEC: não depende de chamada manual.
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();});
  await page.waitForSelector('.tec-subtab[data-tectab="motores"]');
  assert.equal(await page.locator('.tec-subtab[data-tectab="motores"]').isVisible(),true,'central Motores deve aparecer quando existe motor ativo');
  await page.locator('.tec-subtab[data-tectab="motores"]').click();
  await page.waitForSelector('#tec-panel-motores .pmc-engine-card');
  assert.equal(await page.locator('#tec-panel-motores [data-pmc-engine="simplificado"]').count(),1,'Simplificado ativo deve ter configuração própria no TEC');
  assert.equal(await page.locator('#tec-panel-motores [data-pmc-engine="robusto"]').count(),1,'Robusto ativo deve ter configuração própria no TEC');
  assert.equal(await page.locator('#tec-panel-motores [data-pmc-simple="meta"]').count(),1,'meta do Simplificado deve existir somente na central');
  assert.ok(await page.locator('#tec-panel-motores [data-rv4-field]').count()>20,'parâmetros avançados do Robusto devem existir na central');
  assert.ok((await overflow('#tec-panel-motores'))<=4,'central dos motores não pode vazar horizontalmente');

  // Alterar Simplificado na central persiste na fonte original.
  const meta=page.locator('#tec-panel-motores [data-pmc-simple="meta"]');await meta.fill('93');await meta.dispatchEvent('change');
  assert.equal(await page.evaluate(()=>PlanoSugestoesSimplificadoV2.prefs().meta),93,'central deve gravar no storage real do Simplificado');

  // Alterar Robusto na central persiste na configuração real do modo atual.
  const opt=page.locator('#tec-panel-motores [data-rv4-field="recursos.otimizadorAtivo"]');await opt.uncheck();
  await page.waitForFunction(()=>PlanoRobustoConfigV4.prefs(PlanoRobustoConfigV4.detectarModo()).recursos.otimizadorAtivo===false);
  assert.equal(await page.locator('#tec-panel-motores [data-rv4-field="recursos.otimizadorAtivo"]').isChecked(),false);
  await page.locator('#tec-panel-motores [data-rv4-reset-all]').click();
  await page.waitForFunction(()=>PlanoRobustoConfigV4.prefs(PlanoRobustoConfigV4.detectarModo()).recursos.otimizadorAtivo===true);

  // Extras deve consumir configuração, nunca editá-la.
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
  await page.locator('#extras-plano-btn').click();
  await page.waitForFunction(()=>document.getElementById('ui-modal')?.style.display==='flex'&&!!document.querySelector('.ps-engine-chooser,.ps-single-engine'),null,{timeout:8000});
  assert.equal(await page.locator('#ui-modal-body .ps-settings').count(),0,'Extras não pode conter bloco de parâmetros do Simplificado');
  assert.equal(await page.locator('#ui-modal-body [data-ps-meta],[data-ps-min],[data-ps-alvo],[data-ps-banca],[data-ps-fase]').count(),0,'Extras não pode editar nenhum parâmetro simplificado');
  assert.equal(await page.locator('#ui-modal-body [data-rv4-toggle],[data-rv4-field],[data-rv4-reset-all]').count(),0,'Extras não pode editar nenhum parâmetro robusto');
  assert.match(await page.locator('#ui-modal-body').textContent(),/Ajustes centralizados.*Desempenho TEC|Desempenho TEC.*Motores/i);
  await page.locator('#ui-modal-cancel').click();

  // O render normal também reconcilia a governança por perfil/estado.
  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:false,simplificado:true}));
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('motores');});
  assert.equal(await page.locator('[data-pmc-engine="simplificado"]').count(),1);assert.equal(await page.locator('[data-pmc-engine="robusto"]').count(),0);
  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:true,simplificado:false}));
  await page.evaluate(()=>{DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('motores');});
  assert.equal(await page.locator('[data-pmc-engine="simplificado"]').count(),0);assert.equal(await page.locator('[data-pmc-engine="robusto"]').count(),1);
  await page.evaluate(()=>PlanoMotoresGovernancaV5.salvar({robusto:false,simplificado:false}));
  await page.evaluate(()=>DesempenhoTecScreen.render());
  assert.equal(await page.locator('.tec-subtab[data-tectab="motores"]').isVisible(),false,'sem motores ativos a central deve sumir');
  assert.notEqual(await page.evaluate(()=>DesempenhoTecScreen.tecTab),'motores','não pode ficar preso em aba desabilitada');
  await page.evaluate(()=>PlanoMotoresGovernancaV5.restaurar());

  await page.setViewportSize({width:360,height:640});
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('motores');});
  assert.ok((await overflow('#tec-panel-motores'))<=4,'central deve caber em 360px');
  assert.deepEqual(errors,[],`erros no navegador: ${errors.join(' | ')}`);
  console.log('OK: configurações dos motores centralizadas no Desempenho TEC; Extras é apenas decisão/execução; render reconcilia perfil/estado.');
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
