#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const html=readFileSync(join(ROOT,'index.html'),'utf8');
const tipos={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=createServer((req,res)=>{
  const u=(req.url||'/').split('?')[0];
  if(u==='/'||u==='/index.html'){res.writeHead(200,{'Content-Type':tipos['.html']});res.end(html);return;}
  try{const p=join(ROOT,decodeURIComponent(u).replace(/^\/+/,'')),b=readFileSync(p);res.writeHead(200,{'Content-Type':tipos[extname(p)]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404).end('nf');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({locale:'pt-BR',viewport:{width:1440,height:1000}});
const page=await ctx.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/favicon|ERR_/.test(m.text()))errors.push(m.text());});
await page.route('https://**/*',r=>r.abort());

const layout=async(sel,label)=>{
  const m=await page.evaluate(s=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height,sw:el.scrollWidth,cw:el.clientWidth,sh:el.scrollHeight,ch:el.clientHeight};},sel);
  assert.ok(m,`${label}: ausente`);
  const vp=page.viewportSize();
  assert.ok(m.x>=-1&&m.y>=-1&&m.right<=vp.width+1&&m.bottom<=vp.height+1,`${label}: fora do viewport ${JSON.stringify(m)}`);
  assert.ok(m.sw<=m.cw+3,`${label}: overflow horizontal ${m.sw}/${m.cw}`);
};

async function runViewport(width,height){
  await page.setViewportSize({width,height});
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();ExtrasCentral.abrir('reforcos');});
  await page.waitForSelector('.xsc-overlay');
  await layout('.xsc-modal',`central ${width}`);

  for(const tab of ['geral','reforcos','lei','manuais']){
    await page.evaluate(t=>{ExtrasCentral.tab=t;ExtrasCentral._render();},tab);
    await page.waitForTimeout(30);
    await layout('.xsc-modal',`central/${tab} ${width}`);
    const overflow=await page.evaluate(()=>{const b=document.querySelector('.xsc-body');return b?b.scrollWidth-b.clientWidth:0;});
    assert.ok(overflow<=3,`central/${tab}: conteúdo estourou ${overflow}px`);
  }

  await page.evaluate(()=>{ExtrasCentral.tab='reforcos';ExtrasCentral._render();document.querySelector('[data-ra-open]')?.click();});
  await page.waitForSelector('.ra-overlay');
  await layout('.ra-modal',`adaptativo ${width}`);
  const stack=await page.evaluate(()=>{
    const x=document.querySelector('.xsc-overlay'),r=document.querySelector('.ra-overlay');
    return{x:Number(getComputedStyle(x).zIndex),r:Number(getComputedStyle(r).zIndex),body:document.body.classList.contains('extras-modal-open'),bg:x.classList.contains('extras-layer-background'),inert:!!x.inert};
  });
  assert.ok(stack.r>stack.x,`adaptativo precisa ficar acima da central: ${stack.r} <= ${stack.x}`);
  assert.equal(stack.body,true,'body precisa bloquear scroll com modal aberto');
  assert.ok(stack.bg||stack.inert,'modal de fundo precisa ficar desativado');

  await page.keyboard.press('Escape');
  await page.waitForSelector('.ra-overlay',{state:'detached'});
  assert.ok(await page.$('.xsc-overlay'),'central deve permanecer após fechar modal filho');
  const parent=await page.evaluate(()=>{const x=document.querySelector('.xsc-overlay');return{x:!!x,inert:!!x?.inert,bg:!!x?.classList.contains('extras-layer-background')};});
  assert.equal(parent.inert,false,'central precisa voltar a ser interativa');
  assert.equal(parent.bg,false,'central precisa voltar ao topo');

  await page.keyboard.press('Escape');
  await page.waitForSelector('.xsc-overlay',{state:'detached'});
  assert.equal(await page.evaluate(()=>document.body.classList.contains('extras-modal-open')),false,'scroll precisa ser restaurado');

  await page.evaluate(()=>ReforcoGovernanca.abrirHistorico('reforco'));
  await page.waitForSelector('.rg-overlay');
  await layout('.rg-modal',`historico ${width}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.rg-overlay',{state:'detached'});
}

try{
  await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>typeof ExtrasCentral!=='undefined'&&typeof ReforcoAdaptativo!=='undefined'&&typeof ExtrasUiHardening!=='undefined'&&typeof ReforcoGovernanca!=='undefined',null,{timeout:30000});
  await runViewport(1440,1000);
  await runViewport(390,844);
  assert.deepEqual(errors,[],`erros no navegador: ${errors.join(' | ')}`);
  console.log('OK: modais de Extras sem sobreposição indevida em desktop/mobile, com pilha, ESC, scroll e overflow protegidos.');
}finally{
  await ctx.close();await browser.close();await new Promise(r=>server.close(r));
}
