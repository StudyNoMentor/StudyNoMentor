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
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[];let checks=0;
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});
const ok=(v,m)=>{checks++;assert.ok(v,m)};const eq=(a,b,m)=>{checks++;assert.equal(a,b,m)};

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&window.ExtrasScreen&&window.UXV3&&window.ExtrasModern,{timeout:30000});
  await page.evaluate(()=>{try{ProfileUI.hideGate();}catch(_){} });

  /* Spinner: o carregamento usa animação no compositor, inclusive se o app estiver ocupado. */
  const spin=await page.evaluate(()=>{const d=document.createElement('div');d.className='app-loading-spin';document.body.appendChild(d);const cs=getComputedStyle(d),r={name:cs.animationName,duration:cs.animationDuration,will:cs.willChange};d.remove();return r;});
  ok(spin.name!=='none','spinner global precisa estar animado');
  ok(spin.will.includes('transform'),'spinner deve usar compositor');

  /* Ícones i: tanto os antigos quanto os da Central precisam abrir explicação. */
  await page.evaluate(()=>{const b=document.createElement('button');b.type='button';b.id='uxv3-info-test';b.className='xsc-info';b.title='Explicação completa do parâmetro';b.textContent='i';Object.assign(b.style,{position:'fixed',top:'12px',left:'12px',zIndex:'2147483647',width:'36px',height:'36px'});document.body.appendChild(b);});
  await page.locator('#uxv3-info-test').click();
  await page.locator('.uxv3-info-pop.open').waitFor({state:'visible'});
  eq((await page.locator('.uxv3-info-pop').innerText()).trim(),'Explicação completa do parâmetro','ícone i deve explicar o parâmetro');
  await page.keyboard.press('Escape');
  eq(await page.locator('.uxv3-info-pop').count(),0,'Esc deve fechar explicação');

  /* Extras: barra compacta, próximas recolhidas e Lei Seca sem chips duplicados. */
  await page.evaluate(()=>{
    DB.saveExtras([]); const hoje=todayLocal(); const fut=ExtrasModern.addDays(hoje,1);
    DB.addExtra({titulo:'Atividade futura',tipo:'questoes',disciplina:'Direito Tributário',unidade:'questoes',alvo:10,periodo:'unica',datas:[fut]});
    const lei=DB.addExtra({titulo:'Lei seca · CTN',tipo:'leitura',disciplina:'',unidade:'linhas',alvo:30,periodo:'unica',datas:[hoje],marcador:'LINHAS 1–30'});
    DB.updateExtra(lei.id,{origemLei:{rodizio:true,leiId:'uxv3-lei',deLinha:1,ateLinha:30}});
    switchScreen('extras');ExtrasScreen.selDay=hoje;ExtrasScreen.render();
  });
  await page.waitForTimeout(180);
  ok(await page.locator('#screen-extras .extras-toolbar.uxv3-toolbar').count()===1,'toolbar de Extras deve usar layout v3');
  eq((await page.locator('#screen-extras .extras-global>span').innerText()).trim(),'Contar Extras marcadas na Evolução','controle global deve ter rótulo curto');
  const future=page.locator('#extras-list details.exm-section-proximas');
  ok(await future.count()===1,'Próximas deve ser um painel recolhível');
  eq(await future.getAttribute('open'),null,'Próximas deve iniciar minimizada');
  const law=page.locator('#extras-list .lr-extra-card').first();
  await law.waitFor({state:'visible'});
  const lawTags=await law.locator('.exd-tags .extra-tag').evaluateAll(ts=>ts.map(t=>(t.textContent||'').replace(/\s+/g,' ').trim().toLowerCase()));
  eq(lawTags.filter(t=>t==='lei seca').length,1,'Lei Seca deve aparecer uma única vez nos chips');
  ok(!lawTags.includes('hoje'),'card dentro da seção Hoje não deve repetir chip Hoje');
  ok(lawTags.some(t=>t.includes('linhas 1')), 'carga em linhas deve continuar visível');

  /* Reforços: recolher não pode chamar renderEmCurso / Plano de novo. */
  const fast=await page.evaluate(()=>{
    const host=document.getElementById('extras-curso');host.innerHTML='<div class="card exc-card uxv3-course-card"><button id="exc-toggle" aria-expanded="true"><span class="exc-tit">Reforços em curso</span><span class="chev">▴</span></button><div class="exc-grupo">conteúdo</div></div>';
    const antes=ExtrasScreen.renderEmCurso;let calls=0;ExtrasScreen.renderEmCurso=function(){calls++;};
    document.getElementById('exc-toggle').click();
    const card=host.querySelector('.exc-card'),r={calls,collapsed:card.classList.contains('uxv3-collapsed'),expanded:host.querySelector('#exc-toggle').getAttribute('aria-expanded')};
    ExtrasScreen.renderEmCurso=antes;return r;
  });
  eq(fast.calls,0,'recolher Reforços não deve recalcular o Plano');
  ok(fast.collapsed,'recolher deve ser instantâneo por classe');
  eq(fast.expanded,'false','aria-expanded deve acompanhar o estado');

  /* Lista de Leis: nomenclatura deixa explícito o efeito sobre Extras. */
  const lawStatus=await page.evaluate(()=>{
    const oldGet=DB.getLei,oldCfg=LeiRodizio.cfgLei,oldPrefs=LeiRodizio.prefs,oldBm=LeiRodizio._bookmark;
    const host=document.createElement('div');host.id='uxv3-law-host';host.innerHTML='<div class="lr-law-wrap"><article class="lei-card" data-id="lei-teste"></article><div class="lr-law-tools"><label class="lr-switch"><input type="checkbox" data-lr-law-on checked><span>Apta para rodízio</span></label><span class="lr-law-next">antigo</span><button data-lr-law-cfg>Ajustar</button></div></div>';
    const lawsRoot=document.getElementById('screen-leis'); if(!lawsRoot) throw new Error('screen-leis ausente'); lawsRoot.appendChild(host);
    DB.getLei=()=>({id:'lei-teste'});LeiRodizio.cfgLei=()=>({apta:true,linhasSessao:30});LeiRodizio.prefs=()=>({linhasSessao:30});LeiRodizio._bookmark=()=>31;
    UXV3.decorateLawList();const h=host.querySelector('.lr-law-wrap'),out={in:h.textContent.includes('Incluída nos Extras automáticos'),next:h.textContent.includes('Linha 31'),sub:h.textContent.includes('Pode gerar a leitura do dia')};
    DB.getLei=oldGet;LeiRodizio.cfgLei=oldCfg;LeiRodizio.prefs=oldPrefs;LeiRodizio._bookmark=oldBm;host.remove();return out;
  });
  ok(lawStatus.in&&lawStatus.next&&lawStatus.sub,'estado do rodízio deve explicar inclusão e próxima leitura');

  /* TEC: escopo fecha na primeira abertura e Central mantém grade legível. */
  await page.evaluate(()=>{UXV3._tecFirstOpen=true;switchScreen('desempenhotec');try{DesempenhoTecScreen.render();}catch(_){}});
  await page.waitForTimeout(160);
  ok(await page.locator('#tec-scope-body').evaluate(el=>el.hidden),'Escopo da análise deve abrir recolhido');
  ok(await page.locator('#screen-desempenhotec .tp-command.uxv3-tec-command').count()===1,'Central TEC deve receber layout v3');
  const tecOverflow=await page.locator('#screen-desempenhotec').evaluate(el=>el.scrollWidth-el.clientWidth);
  ok(tecOverflow<=4,`TEC não deve criar overflow horizontal (${tecOverflow}px)`);

  /* Falha automática de renovação não pode jogar formulário na frente do estudo. */
  const autoCloud=await page.evaluate(async()=>{
    UXV3._cloudUserAt=0;
    const s=document.createElement('div');s.className='cloud-scrim';const m=document.createElement('div');m.className='cloud-menu';
    s.addEventListener('click',()=>{s.remove();m.remove();});document.body.appendChild(s);document.body.appendChild(m);
    await new Promise(r=>setTimeout(r,80));return {menu:document.querySelectorAll('.cloud-menu').length,scrim:document.querySelectorAll('.cloud-scrim').length};
  });
  eq(autoCloud.menu,0,'menu de relogin automático não deve interromper o usuário');
  eq(autoCloud.scrim,0,'scrim automático também deve ser removido');

  /* Mobile: principais blocos permanecem dentro do viewport. */
  await page.setViewportSize({width:360,height:800});
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();});await page.waitForTimeout(100);
  const ov=await page.locator('#screen-extras').evaluate(el=>el.scrollWidth-el.clientWidth);ok(ov<=4,`Extras mobile sem overflow (${ov}px)`);

  ok(errors.length===0,'sem erros no navegador: '+errors.join(' | '));
  console.log(`UX STABILITY V3 OK — ${checks} invariantes.`);
} finally { await browser.close(); await new Promise(r=>server.close(r)); }