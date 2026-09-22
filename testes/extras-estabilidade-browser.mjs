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

async function abrirApp(){
  let ultimoErro;
  for(let tentativa=0;tentativa<2;tentativa++){
    try {
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
      return;
    } catch(e) {
      ultimoErro=e;
      if(tentativa===0){
        await page.goto('about:blank',{waitUntil:'domcontentloaded',timeout:10000}).catch(()=>{});
        await page.waitForTimeout(250);
      }
    }
  }
  throw ultimoErro;
}

async function caixa(sel,label){
  const g=await page.locator(sel).evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,sw:el.scrollWidth,cw:el.clientWidth};});
  const vp=page.viewportSize();
  assert.ok(g.x>=-1&&g.y>=-1&&g.right<=vp.width+1&&g.bottom<=vp.height+1,`${label} fora do viewport: ${JSON.stringify(g)}`);
  assert.ok(g.sw<=g.cw+3,`${label} com overflow horizontal: ${g.sw}/${g.cw}`);
}

async function fecharCentral(){
  if(await page.locator('.xsc-overlay').count()){
    await page.locator('.xsc-close').first().click();
    await page.locator('.xsc-overlay').waitFor({state:'detached',timeout:3000});
  }
}

async function auditarCentral(width,height){
  await page.setViewportSize({width,height});
  await fecharCentral();
  await page.locator('#extras-settings-btn').click();
  await page.locator('.xsc-overlay').waitFor({state:'visible'});
  /* A aba "Visao geral" saiu da central: era uma quinta aba com atalhos para as
     outras tres, que ja estao na mesma fita. Este laco ainda clicava nela e
     ficava 30s esperando um seletor que nao existe mais. */
  assert.equal(await page.locator('[data-xsc-tab="geral"]').count(),0,'a aba Visão geral não deve mais existir');
  for(const tab of ['reforcos','lei','manuais']){
    await page.locator(`[data-xsc-tab="${tab}"]`).click();
    await page.waitForTimeout(40);
    await caixa('.xsc-modal',`Central/${tab} ${width}x${height}`);
    const bodyOverflow=await page.locator('.xsc-body').evaluate(el=>el.scrollWidth-el.clientWidth);
    assert.ok(bodyOverflow<=3,`Central/${tab} vazou ${bodyOverflow}px horizontalmente`);
  }
  if(width<=560){
    const g=await page.locator('.xsc-modal').evaluate(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height,vw:innerWidth,vh:innerHeight}));
    assert.ok(Math.abs(g.w-g.vw)<=1&&Math.abs(g.h-g.vh)<=1,'Central deve usar viewport inteiro em celular estreito');
  }
}

try {
  await abrirApp();
  await page.waitForFunction(()=>window.switchScreen&&window.ExtrasCentral&&window.ExtrasOverlayStack,{timeout:30000});
  await page.evaluate(()=>{try{ProfileUI.hideGate();}catch(_){} switchScreen('extras'); if(window.ExtrasScreen?.render)ExtrasScreen.render();});
  await page.waitForTimeout(200);

  /* Todas as áreas da Central precisam caber tanto no desktop quanto no celular. */
  await auditarCentral(1440,1000);
  await auditarCentral(390,844);

  /* A Central continua sendo a porta unica das configuracoes de Extras: ela
     abre, mostra as secoes e sai sem deixar overlay orfao. O editor do reforco
     adaptativo saiu com o motor que o alimentava. */
  await page.locator('[data-xsc-tab="reforcos"]').click();
  await page.locator('.xsc-overlay').waitFor({state:'visible'});
  const camada=await page.locator('.xsc-overlay').evaluate(el=>({z:Number(getComputedStyle(el).zIndex||0),toast:Number(getComputedStyle(document.documentElement).getPropertyValue('--z-toast'))||3000,block:Number(getComputedStyle(document.documentElement).getPropertyValue('--z-bloqueio'))||9999}));
  assert.ok(camada.z<camada.toast&&camada.z<camada.block,`modal de Extras não pode superar toast/bloqueio global: ${JSON.stringify(camada)}`);

  /* Histórico/gerenciamento também participa do mesmo contrato de viewport. */
  await fecharCentral();
  await page.evaluate(()=>ReforcoGovernanca.abrirHistorico('reforco'));
  await page.locator('.rg-overlay').waitFor({state:'visible'});
  await caixa('.rg-modal','Histórico de reforços mobile');
  await page.keyboard.press('Escape');
  await page.locator('.rg-overlay').waitFor({state:'detached',timeout:3000});

  /* Caso genérico de modal sobre modal: topo ganha interação, fundo fica inert,
     Tab não escapa e fechar o filho reativa o pai imediatamente. */
  await page.evaluate(()=>{
    const pai=document.createElement('div');pai.className='xsc-overlay';pai.innerHTML='<div class="xsc-modal" role="dialog"><button id="p-first">pai 1</button><button id="p-last" class="xsc-close">fechar pai</button></div>';pai.querySelector('.xsc-close').onclick=()=>pai.remove();document.body.appendChild(pai);
    const filho=document.createElement('div');filho.className='ra-overlay';filho.innerHTML='<div class="ra-modal" role="dialog"><button id="c-first">filho 1</button><button id="c-last" class="ra-x">fechar filho</button></div>';filho.querySelector('.ra-x').onclick=()=>filho.remove();document.body.appendChild(filho);
  });
  await page.waitForTimeout(50);
  let stack=await page.evaluate(()=>{const a=[...document.querySelectorAll('.xsc-overlay,.ra-overlay')].slice(-2);return{z:a.map(x=>Number(getComputedStyle(x).zIndex||0)),inert:a.map(x=>!!x.inert),toast:Number(getComputedStyle(document.documentElement).getPropertyValue('--z-toast'))||3000,locked:document.documentElement.classList.contains('extras-modal-open')&&getComputedStyle(document.body).overflow==='hidden'};});
  assert.ok(stack.z[1]>stack.z[0]&&stack.z[1]<stack.toast,'pilha deve crescer só dentro da faixa de modal');
  assert.deepEqual(stack.inert,[true,false],'apenas o modal superior pode receber interação');
  assert.equal(stack.locked,true,'fundo deve ficar sem scroll enquanto houver modal');

  await page.locator('#c-last').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'c-first','Tab deve ciclar dentro do modal superior');
  await page.evaluate(()=>document.getElementById('p-first').focus()); await page.waitForTimeout(20);
  assert.ok(await page.evaluate(()=>document.querySelector('.ra-overlay')?.contains(document.activeElement)),'foco programático não pode atravessar para modal de fundo');
  await page.keyboard.press('Escape'); await page.locator('.ra-overlay').waitFor({state:'detached'});
  assert.equal(await page.locator('.xsc-overlay').evaluate(el=>!!el.inert),false,'pai deve reativar imediatamente após filho fechar');
  await page.keyboard.press('Escape'); await page.locator('.xsc-overlay').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('extras-modal-open')),false,'scroll deve ser restaurado quando a pilha zera');

  /* Repetidas aberturas não podem fazer z-index crescer até superar toast ou
     bloqueio de sessão. */
  const drift=await page.evaluate(()=>{
    for(let i=0;i<150;i++){const o=document.createElement('div');o.className='ra-overlay';o.innerHTML='<div class="ra-modal"></div>';document.body.appendChild(o);ExtrasOverlayStack.register(o);o.remove();ExtrasOverlayStack.sync();}
    const o=document.createElement('div');o.className='ra-overlay';o.innerHTML='<div class="ra-modal"></div>';document.body.appendChild(o);ExtrasOverlayStack.register(o);
    const z=Number(getComputedStyle(o).zIndex||0),toast=Number(getComputedStyle(document.documentElement).getPropertyValue('--z-toast'))||3000;o.remove();ExtrasOverlayStack.sync();return{z,toast};
  });
  assert.ok(drift.z<drift.toast,`z-index derivou após reaberturas: ${JSON.stringify(drift)}`);

  assert.deepEqual(errors,[],'não deve haver erro de página/console no fluxo');
  console.log('OK: Extras desktop/mobile — todas as abas sem overflow, histórico estável, foco/ESC/scroll protegidos e z-index sem deriva.');
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
