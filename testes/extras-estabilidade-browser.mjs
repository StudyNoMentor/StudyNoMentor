import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json' };
const server = createServer((req,res) => {
  const raw=(req.url||'/').split('?')[0];
  const name=raw==='/'?'/index.html':raw;
  try {
    const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));
    res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);
  } catch { res.writeHead(404).end('nao encontrado'); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_/.test(m.text()))errors.push(m.text());});

try {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&window.ExtrasCentral&&window.ReforcoAdaptativo,{timeout:30000});
  await page.evaluate(()=>{try{ProfileUI.hideGate();}catch(_){} switchScreen('extras'); if(window.ExtrasScreen?.render)ExtrasScreen.render();});
  await page.waitForTimeout(200);

  const settings=page.locator('#extras-settings-btn');
  await settings.waitFor({state:'visible',timeout:5000});
  await settings.click();
  await page.locator('.xsc-overlay').waitFor({state:'visible'});
  await page.locator('[data-xsc-tab="reforcos"]').click();
  await page.locator('[data-ra-open]').waitFor({state:'visible'});

  // O editor adaptativo deve SUBSTITUIR a Central, não nascer atrás dela.
  await page.locator('[data-ra-open]').click();
  await page.locator('.ra-overlay').waitFor({state:'visible',timeout:3000});
  assert.equal(await page.locator('.xsc-overlay').count(),0,'Central de Extras deve fechar antes do editor adaptativo');
  const geom=await page.locator('.ra-modal').evaluate(el=>({
    w:el.getBoundingClientRect().width,
    right:el.getBoundingClientRect().right,
    viewport:innerWidth,
    z:Number(getComputedStyle(el.closest('.ra-overlay')).zIndex||0)
  }));
  assert.ok(geom.w>250&&geom.right<=geom.viewport+1,'editor adaptativo deve caber no viewport mobile');
  assert.ok(geom.z>=100400,'editor adaptativo deve estar na camada superior de fallback');

  // Garantia direta contra o travamento relatado: em Extras, salvar não pode
  // renderizar o Plano TEC escondido nem prender a thread principal.
  await page.evaluate(()=>{
    window.__tecRenderCount=0;
    const base=DesempenhoTecScreen.renderPlanoConteudo;
    DesempenhoTecScreen.renderPlanoConteudo=function(){window.__tecRenderCount++;return base.apply(this,arguments);};
  });
  const active=page.locator('[data-ra="ativo"]');
  if(!(await active.isChecked()))await active.check();
  const t0=Date.now();
  await page.locator('[data-save]').click();
  await page.locator('.ra-overlay').waitFor({state:'detached',timeout:3000});
  await page.locator('.xsc-overlay').waitFor({state:'visible',timeout:3000});
  const elapsed=Date.now()-t0;
  assert.ok(elapsed<3000,`salvar adaptativo demorou ${elapsed}ms`);
  assert.equal(await page.evaluate(()=>window.__tecRenderCount),0,'salvar em Extras não pode renderizar TEC escondido');
  const centralText=await page.locator('.xsc-overlay').innerText();
  assert.match(centralText,/Prescrição adaptativa[\s\S]*Ativa/,'Central deve refletir ativação após salvar');

  // Abre ajuda sobre a prescrição e confirma que a pilha dinâmica coloca o
  // filho acima e torna o anterior inerte, sem clique atravessando camadas.
  await page.evaluate(()=>{
    const a=document.createElement('div');a.className='xsc-overlay';a.innerHTML='<div class="xsc-modal">pai</div>';document.body.appendChild(a);
    const b=document.createElement('div');b.className='ra-overlay';b.innerHTML='<div class="ra-modal">filho</div>';document.body.appendChild(b);
  });
  await page.waitForTimeout(50);
  const stack=await page.evaluate(()=>{
    const all=[...document.querySelectorAll('.xsc-overlay,.rg-overlay,.ra-overlay')].slice(-2);
    return {zin:all.map(x=>Number(getComputedStyle(x).zIndex||0)), inert:all.map(x=>!!x.inert)};
  });
  assert.ok(stack.zin[1]>stack.zin[0],'modal filho deve ter z-index maior');
  assert.equal(stack.inert[0],true,'modal atrás deve ficar inerte');
  assert.equal(stack.inert[1],false,'modal da frente deve permanecer interativo');

  assert.deepEqual(errors,[],'não deve haver erro de página/console no fluxo');
  console.log(`OK: Extras no navegador — modal adaptativo sem sobreposição, ativação em ${elapsed}ms e TEC oculto não renderizado.`);
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
