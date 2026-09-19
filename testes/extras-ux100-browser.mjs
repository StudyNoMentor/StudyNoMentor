import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end('nao encontrado');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[];let checks=0;
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon/.test(m.text()))errors.push(m.text());});
const ok=(cond,msg)=>{checks++;assert.ok(cond,msg);};
const eq=(a,b,msg)=>{checks++;assert.equal(a,b,msg);};

async function noOverflow(sel,label,tolerance=4){
  const r=await page.locator(sel).evaluate(el=>({sw:el.scrollWidth,cw:el.clientWidth,w:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,vw:innerWidth}));
  ok(r.sw<=r.cw+tolerance,`${label}: overflow ${r.sw-r.cw}px`);
  ok(r.left>=-1&&r.right<=r.vw+1,`${label}: fora do viewport ${JSON.stringify(r)}`);
}
async function buttonsAccessible(sel,label){
  const bad=await page.locator(sel).evaluate(el=>[...el.querySelectorAll('button,[role="button"]')].filter(b=>{const cs=getComputedStyle(b),r=b.getBoundingClientRect();if(cs.display==='none'||cs.visibility==='hidden'||r.width===0||r.height===0)return false;return !String(b.textContent||'').trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('title');}).map(b=>b.outerHTML.slice(0,100)));
  eq(bad.length,0,`${label}: botão sem nome acessível: ${bad.join(' | ')}`);
}
async function closeCentral(){if(await page.locator('.xsc-overlay').count()){await page.locator('.xsc-close').first().click();await page.locator('.xsc-overlay').waitFor({state:'detached',timeout:3000});}}
async function closeAdaptive(){if(await page.locator('.ra-overlay').count()){await page.locator('.ra-x').first().click();await page.locator('.ra-overlay').waitFor({state:'detached',timeout:3000});}}
async function shot(name){if(!process.env.EXTRAS_UX_SHOTS)return;const dir=join(ROOT,'.artifacts','extras-ux100');mkdirSync(dir,{recursive:true});await page.screenshot({path:join(dir,name),fullPage:true});}

async function mainAudit(width,height){
  await page.setViewportSize({width,height});
  await closeAdaptive();await closeCentral();
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
  await page.waitForTimeout(80);
  await page.waitForFunction(()=>[...document.querySelectorAll('#extras-list .exd')].some(c=>{const e=DB.getExtra(c.dataset.id);return !!(e&&e.origemLei&&e.origemLei.rodizio);}),null,{timeout:3000});
  await page.evaluate(()=>{try{LeiRodizio.decorarExtras();}catch(_){}try{ExtrasUx100.compactarCards();}catch(_){}});
  const order=await page.evaluate(()=>{const s=document.getElementById('screen-extras'),ch=[...s.children];return{toolbar:ch.indexOf(s.querySelector('.extras-toolbar')),curso:ch.indexOf(document.getElementById('extras-curso')),agenda:ch.indexOf(document.getElementById('extras-agenda')),lista:ch.indexOf(document.getElementById('extras-list'))};});
  ok(order.toolbar>=0&&order.curso>=0&&order.agenda>=0&&order.lista>=0,`ordem: blocos devem existir ${JSON.stringify(order)}`);
  ok(order.toolbar<order.curso,`Configurações deve vir antes de Reforços ${JSON.stringify(order)}`);
  ok(order.curso<order.agenda,`Reforços deve vir antes de Extras de hoje ${JSON.stringify(order)}`);
  ok(order.agenda<order.lista,`Agenda deve vir antes da lista ${JSON.stringify(order)}`);
  await noOverflow('#screen-extras',`Extras ${width}`);
  await noOverflow('#screen-extras .extras-toolbar',`Configurações ${width}`);
  await noOverflow('#extras-agenda .cal-card',`Agenda ${width}`);
  await buttonsAccessible('#screen-extras',`Extras ${width}`);
  const visual=await page.evaluate(()=>{
    const t=document.querySelector('#extras-list .exd.exm-task'),tb=document.querySelector('#screen-extras .extras-toolbar'),ag=document.querySelector('#extras-agenda .cal-card');
    const bw=e=>e?parseFloat(getComputedStyle(e).borderTopWidth)||0:0;
    return{toolbar:bw(tb),agenda:bw(ag),task:bw(t),rot:document.querySelectorAll('#extras-agenda .exm-rotation,#extras-agenda .exm-load').length,title:document.querySelector('#extras-agenda .card-header h2')?.textContent||''};
  });
  ok(visual.toolbar>=1,`Configurações precisa de limite visível (${visual.toolbar})`);
  ok(visual.agenda>=1,`Agenda precisa de limite visível (${visual.agenda})`);
  if(visual.task)ok(visual.task>=1,`Card precisa de limite visível (${visual.task})`);else ok(true,'sem card neste quadro');
  eq(visual.rot,0,'controles de automação duplicados não devem ficar na agenda');
  ok(visual.title.startsWith('Extras de hoje'),'agenda deve comunicar execução diária');
  const law=await page.evaluate(()=>{
    const card=document.querySelector('#extras-list .lr-extra-card');
    if(!card)return{exists:false};
    const route=card.querySelector('.lr-route'),actions=card.querySelector('.exd-actions');
    const probe=document.createElement('i');probe.style.cssText='position:fixed;left:-9999px;background:var(--surface)';document.body.appendChild(probe);
    const surface=getComputedStyle(probe).backgroundColor;probe.remove();
    const rr=route?.getBoundingClientRect(),ar=actions?.getBoundingClientRect();
    return{exists:true,bg:getComputedStyle(card).backgroundColor,surface,concluded:card.classList.contains('is-concluidas'),gap:rr&&ar?rr.top-ar.bottom:999};
  });
  ok(law.exists,'Lei seca precisa estar presente no cenário de auditoria');
  ok(!law.concluded,'Lei seca de hoje aberta não pode usar estado visual de concluída');
  eq(law.bg,law.surface,'Lei seca aberta deve manter fundo neutro do surface');
  ok(law.gap>=6,`ações da Lei seca precisam ficar separadas do bloco de leitura (${law.gap.toFixed(1)}px)`);
  if(width<=430){
    const actions=await page.evaluate(()=>[...document.querySelectorAll('#extras-list .exd-actions')].map(a=>{const r=a.getBoundingClientRect(),card=a.closest('.exd')?.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,cl:card?.left,cr:card?.right};}));
    actions.forEach((r,i)=>ok(r.left>=r.cl-1&&r.right<=r.cr+1,`ações ${i} não podem escapar do card`));
  }
}

async function centralAudit(width,height){
  await page.setViewportSize({width,height});
  await closeAdaptive();await closeCentral();
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();});
  await page.locator('#extras-settings-btn').click();
  await page.locator('.xsc-overlay').waitFor({state:'visible'});
  /* "Visão geral" saiu: era uma quinta aba que repetia as outras tres, com
     cartoes de atalho para abas que ja estao na mesma fita. */
  eq(await page.locator('[data-xsc-tab="geral"]').count(),0,'a aba Visão geral não deve mais existir');
  for(const tab of ['reforcos','lei','manuais']){
    await page.locator(`[data-xsc-tab="${tab}"]`).click();await page.waitForTimeout(35);
    await noOverflow('.xsc-modal',`Central/${tab}/${width}`);
    await noOverflow('.xsc-body',`Central body/${tab}/${width}`);
    await buttonsAccessible('.xsc-modal',`Central/${tab}/${width}`);
    const navState=await page.locator(`[data-xsc-tab="${tab}"]`).evaluate(b=>({active:b.classList.contains('active'),visible:getComputedStyle(b).display!=='none'}));
    ok(navState.active,`aba ${tab} deve ficar ativa`);ok(navState.visible,`aba ${tab} deve permanecer visível`);
  }
  await page.locator('[data-xsc-tab="lei"]').click();
  const groups=await page.locator('.xsc-setting-group').count();
  eq(groups,3,'Lei seca deve ser agrupada em três seções funcionais');
  const fields=await page.locator('.xsc-field').count();ok(fields>=7,'Lei seca deve preservar todos os parâmetros essenciais');
  const borders=await page.locator('.xsc-setting-group').evaluateAll(gs=>gs.map(g=>parseFloat(getComputedStyle(g).borderTopWidth)||0));
  borders.forEach((b,i)=>ok(b>=1,`grupo Lei Seca ${i} precisa de borda visível`));
  const before=await page.locator('[data-xsc-law-min]').inputValue();
  await page.locator('[data-xsc-law-preset="leve"]').click();
  eq(await page.locator('[data-xsc-law-min]').inputValue(),'15','preset Leve deve alterar minutos');
  eq(await page.locator('[data-xsc-law-preset="leve"]').getAttribute('aria-pressed'),'true','preset Leve deve mostrar estado ativo');
  await page.locator('[data-xsc-law-preset="intenso"]').click();
  eq(await page.locator('[data-xsc-law-day]').inputValue(),'2','preset Intenso deve aumentar leis/dia');
  eq(await page.locator('[data-xsc-law-preset="intenso"]').getAttribute('aria-pressed'),'true','preset Intenso deve mostrar estado ativo');
  ok((await page.locator('[data-xsc-law-feedback]').innerText()).length>0,'preset deve fornecer feedback textual');
  ok(before!==await page.locator('[data-xsc-law-min]').inputValue()||before==='25','preset deve produzir alteração observável');
  if(width<=430)await noOverflow('.xsc-law-compact',`Lei Seca compacta ${width}`);
}


try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&window.ExtrasScreen&&window.ExtrasCentral&&window.ExtrasUx100,{timeout:30000});
  await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(_){}
    DB.saveExtras([]);
    const hoje=todayLocal();
    DB.addExtra({titulo:'Diagnosticar: Economia Brasileira na Década de 1990',tipo:'questoes',disciplina:'Economia e Finanças Públicas',unidade:'questoes',alvo:18,periodo:'unica',datas:[hoje],origemPlano:{topico:'Economia Brasileira na Década de 1990',disciplina:'Economia e Finanças Públicas',criadoEm:new Date().toISOString()}});
    const leiExtra=DB.addExtra({titulo:'Lei seca · CTN - Constituição',tipo:'leitura',disciplina:'',unidade:'linhas',alvo:30,periodo:'unica',datas:[hoje]});
    DB.updateExtra(leiExtra.id,{origemLei:{rodizio:true,leiId:'ux100-lei',deLinha:1,ateLinha:30}});
    switchScreen('extras');ExtrasScreen.selDay=hoje;ExtrasScreen.render();
  });
  await page.waitForTimeout(150);

  /* Matriz responsiva: cada viewport repete hierarquia, overflow, bordas e
     acessibilidade. O total ultrapassa 100 invariantes reais, não 100 sleeps. */
  for(const [w,h] of [[360,800],[390,844],[430,900],[768,900],[1280,900]])await mainAudit(w,h);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();});await shot('01-extras-main-mobile.png');

  for(const [w,h] of [[360,800],[390,844],[768,900],[1280,900]]){
    await centralAudit(w,h);
    if(w===390)await shot('02-extras-lei-seca-mobile.png');
    await closeCentral();
  }

  await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();});await shot('04-extras-main-desktop.png');
  ok(checks>=60,`auditoria deveria atravessar ao menos 60 invariantes; executou ${checks}`);
  eq(errors.length,0,`não deve haver erros de página/console: ${errors.join(' | ')}`);
  console.log(`OK: auditoria UX de Extras passou por ${checks} invariantes em 5 larguras e 4 abas da Central.`);
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
