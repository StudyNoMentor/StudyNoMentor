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

async function config(){await page.evaluate(()=>{switchScreen('config');ConfigScreen.render();});await page.waitForSelector('#cfg-plano-motores-card');}
async function extras(){await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});}
async function abrir(){await extras();await page.locator('#extras-plano-btn').click();await page.waitForFunction(()=>document.getElementById('ui-modal')?.style.display==='flex'&&!!document.querySelector('.ps-engine-chooser,.ps-single-engine'),null,{timeout:8000});}
async function fechar(){if(await page.locator('#ui-modal-cancel').isVisible().catch(()=>false))await page.locator('#ui-modal-cancel').click();}
async function overflow(sel){return page.locator(sel).evaluate(el=>Math.max(0,el.scrollWidth-el.clientWidth));}

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchScreen==='function'&&typeof PlanoMotoresGovernancaV5==='object'&&typeof PlanoMotoresCentralTecV1==='object'&&typeof PlanoSugestoesV2==='object'&&typeof ExtrasScreen==='object'&&typeof DesempenhoTecScreen==='object',{timeout:30000});
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
    PlanoMotoresGovernancaV5.restaurar();PlanoSugestoesV2.salvar({modo:'robusto',fase:'pre',meta:90,minAmostra:20,alvoQuestoes:30});
  });

  // 1) Ambos ativos: governança global + decisão limpa em Extras.
  await config();
  assert.equal(await page.locator('[data-pmg-toggle]').count(),2,'Configurações deve expor exatamente os dois motores');
  assert.equal(await page.locator('[data-pmg-toggle="simplificado"]').isChecked(),true);
  assert.equal(await page.locator('[data-pmg-toggle="robusto"]').isChecked(),true);
  assert.match(await page.locator('.pmg-status').textContent(),/2 motores ativos|Comparar fica disponível/i);
  assert.ok((await overflow('#cfg-plano-motores-card'))<=4,'card de governança não pode vazar horizontalmente');
  await abrir();
  assert.equal(await page.locator('.ps-engine-card').count(),2,'ambos ativos devem mostrar duas escolhas principais');
  assert.equal(await page.locator('.ps-compare-launch').count(),1,'Comparar deve aparecer separado das duas escolhas principais');
  assert.match(await page.locator('.ps-engine-chooser').textContent(),/Como quer escolher estas 3 frentes/i);
  assert.equal(await page.locator('#ui-modal-body [data-ps-meta],#ui-modal-body [data-rv4-toggle],#ui-modal-body [data-rv4-field]').count(),0,'Extras deve estar livre de parâmetros dos motores');
  assert.ok((await overflow('#ui-modal-body'))<=4,'seletor dual não pode ter overflow');
  await fechar();

  // 2) Apenas Robusto: Simplificado e Comparar somem; abre direto no Robusto sem painel de configuração.
  await config();
  await page.locator('[data-pmg-toggle="simplificado"]').uncheck();
  await page.waitForFunction(()=>window.PlanoMotoresGovernancaV5?.estado().simplificado===false);
  assert.match(await page.locator('.pmg-status').textContent(),/1 motor ativo.*Robusto/i);
  await extras();
  assert.equal(await page.locator('#extras-plano-btn').isVisible(),true,'Puxar continua disponível com Robusto ativo');
  await abrir();
  assert.equal(await page.locator('.ps-engine-chooser').count(),0,'com um único motor não deve haver etapa de escolha');
  assert.match(await page.locator('.ps-single-engine').textContent(),/Robusto/i);
  assert.equal(await page.locator('[data-ps-modo]').count(),0,'Simplificado/Comparar não podem continuar escondidos no DOM do modal');
  assert.equal(await page.locator('#ui-modal-body [data-rv4-toggle],#ui-modal-body [data-rv4-field]').count(),0,'configurações robustas devem existir somente no Desempenho TEC');
  await fechar();

  // 3) Apenas Simplificado: aba Plano/Robusto some do TEC e modal abre direto sem parâmetros.
  await config();
  await page.locator('[data-pmg-toggle="simplificado"]').check();
  await page.locator('[data-pmg-toggle="robusto"]').uncheck();
  await page.waitForFunction(()=>{const e=PlanoMotoresGovernancaV5.estado();return e.simplificado&&!e.robusto;});
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();PlanoMotoresGovernancaV5.syncVisibility();PlanoMotoresCentralTecV1.ensureUi();});
  assert.equal(await page.locator('.tec-subtab[data-tectab="plano"]').isVisible(),false,'Plano Robusto deve desaparecer do Desempenho TEC');
  assert.equal(await page.locator('.tec-subtab[data-tectab="motores"]').isVisible(),true,'central deve continuar disponível para o Simplificado');
  await extras();
  assert.equal(await page.locator('#extras-plano-btn').isVisible(),true,'Puxar continua disponível com Simplificado ativo');
  await abrir();
  assert.equal(await page.locator('.ps-engine-chooser').count(),0);
  assert.match(await page.locator('.ps-single-engine').textContent(),/Simplificado/i);
  assert.equal(await page.locator('#ui-modal-body [data-rv4-toggle],#ui-modal-body [data-ps-meta],#ui-modal-body [data-ps-alvo]').count(),0,'Extras não pode configurar nenhum motor');
  await fechar();

  // 4) Ambos desligados: nenhuma entrada, nenhum cálculo oculto e histórico não é limpo.
  const extrasAntes=await page.evaluate(()=>DB.getExtras().length);
  await config();
  await page.locator('[data-pmg-toggle="simplificado"]').uncheck();
  await page.waitForFunction(()=>{const e=PlanoMotoresGovernancaV5.estado();return !e.simplificado&&!e.robusto;});
  assert.match(await page.locator('.pmg-status').textContent(),/Nenhum motor ativo|Puxar do Plano ficará oculto/i);
  await extras();
  assert.equal(await page.locator('#extras-plano-btn').isVisible(),false,'Puxar deve desaparecer de Extras sem motores ativos');
  await page.evaluate(()=>{switchScreen('desempenhotec');PlanoMotoresGovernancaV5.syncVisibility();PlanoMotoresCentralTecV1.ensureUi();});
  assert.equal(await page.locator('.tec-subtab[data-tectab="plano"]').isVisible(),false);
  assert.equal(await page.locator('.tec-subtab[data-tectab="motores"]').isVisible(),false,'central deve sumir sem motores habilitados');
  const off=await page.evaluate(()=>PlanoSugestoesV2.calcular({modo:'robusto'}));
  assert.equal(off.erro,'motores-desabilitados','nem chamada programática deve executar um motor desligado');
  assert.equal(await page.evaluate(()=>DB.getExtras().length),extrasAntes,'desabilitar motores não pode apagar atividades existentes');

  // 5) Restaurar traz tudo de volta e preferência válida continua íntegra.
  await config();await page.locator('[data-pmg-reset]').click();
  await page.waitForFunction(()=>{const e=PlanoMotoresGovernancaV5.estado();return e.simplificado&&e.robusto;});
  await page.evaluate(()=>PlanoSugestoesV2.salvar({modo:'comparar'}));
  assert.equal(await page.evaluate(()=>PlanoSugestoesV2.prefs().modo),'comparar');
  await extras();assert.equal(await page.locator('#extras-plano-btn').isVisible(),true);
  await page.evaluate(()=>{switchScreen('desempenhotec');PlanoMotoresGovernancaV5.syncVisibility();PlanoMotoresCentralTecV1.ensureUi();});
  assert.equal(await page.locator('.tec-subtab[data-tectab="plano"]').isVisible(),true);
  assert.equal(await page.locator('.tec-subtab[data-tectab="motores"]').isVisible(),true);

  await page.setViewportSize({width:360,height:640});
  await config();assert.ok((await overflow('#cfg-plano-motores-card'))<=4,'governança deve caber em 360px');
  await abrir();assert.ok((await overflow('#ui-modal-body'))<=4,'Puxar dual deve caber em 360px');await fechar();

  assert.deepEqual(errors,[],`erros no navegador: ${errors.join(' | ')}`);
  console.log('OK: governança global + central de configuração no Desempenho TEC, com Extras sem parâmetros.');
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
