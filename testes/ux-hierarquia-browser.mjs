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
  // UXHierarchy é o último módulo do bundle; quando ele existe, os módulos de tela
  // anteriores já foram avaliados. Alguns deles são bindings globais `const` e não
  // propriedades de `window`, portanto não devem ser usados como sinal de prontidão.
  await page.waitForFunction(()=>window.switchScreen&&window.UXHierarchy,{timeout:30000});
  await page.evaluate(()=>{try{ProfileUI.hideGate();}catch(_){}});

  /* Uma pergunta principal por tela: copy curto e orientado à decisão. */
  const copies=await page.evaluate(()=>({
    registrar:document.querySelector('#screen-registrar .page-subtitle')?.textContent||'',
    ciclo:document.querySelector('#screen-ciclo .page-subtitle')?.textContent||'',
    extras:document.querySelector('#screen-extras .page-subtitle')?.textContent||'',
    tec:document.querySelector('#screen-desempenhotec .page-subtitle')?.textContent||''
  }));
  ok(copies.registrar.includes('sessão atual'),'Registrar deve explicar a ação principal');
  ok(copies.ciclo.includes('semana está no ritmo'),'Ciclo deve responder se a semana está no ritmo');
  ok(copies.extras.includes('Execute hoje'),'Extras deve ser orientado à execução');
  ok(copies.tec.includes('prioridade de ataque'),'TEC deve separar medida de decisão');

  /* Ciclo: três indicadores acionáveis ganham prioridade sem apagar os demais. */
  const gauges=await page.evaluate(()=>{
    const h=document.getElementById('ciclo-overview-gauges');
    h.innerHTML=['cumprido','estudado','faltam','aproveitamento','finalizadas','por dia p/ fechar'].map((x,i)=>`<div class="mini-gauge-card"><div class="value">${i}</div><div class="label">${x}</div></div>`).join('');
    UXHierarchy.decorateCycleGauges();
    return Array.from(h.querySelectorAll('.mini-gauge-card')).map(x=>({p:x.dataset.uxPriority,o:Number(x.style.order)}));
  });
  eq(gauges.filter(x=>x.p==='primary').length,3,'Ciclo deve ter exatamente três KPIs prioritários');
  eq(gauges.filter(x=>x.p==='tertiary').length,2,'Indicadores derivados devem continuar presentes, mas terciários');
  ok(gauges.some(x=>x.p==='secondary'),'Aproveitamento deve ficar como apoio forte');

  /* Cards: Estatísticas continua disponível como aba, sem atalho duplicado no menu. */
  await page.evaluate(()=>{switchScreen('cards');UXHierarchy.decorateCards();});
  eq(await page.locator('#cards-stats-btn').getAttribute('hidden'),'','atalho duplicado de Estatísticas deve ficar oculto');
  ok(await page.locator('.cards-tab[data-ctab="stats"]').count()===1,'aba Estatísticas deve continuar disponível');

  /* Evolução: narrativa principal permanece e análises secundárias viram um único bloco recolhível. */
  await page.evaluate(()=>{switchScreen('evolucao');UXHierarchy.decorateEvolution();});
  const evo=await page.evaluate(()=>({
    details:!!document.getElementById('ux-evo-more'),
    moved:document.querySelectorAll('#ux-evo-more .ux-more-analysis-body>.card').length,
    dayDirect:document.getElementById('evolucao-day-chart')?.closest('.card')?.parentElement?.id==='evolucao-content',
    accDirect:document.getElementById('evolucao-acerto-linha')?.closest('.card')?.parentElement?.id==='evolucao-content',
    periodDisplay:getComputedStyle(document.querySelector('.evo-periodo-ctl')).display,
    gearHidden:!!document.getElementById('evo-gear-cards')?.hidden
  }));
  ok(evo.details,'Evolução deve reunir análises secundárias');
  ok(evo.moved>=4,'blocos redundantes/secundários devem ficar em Mais análises');
  ok(evo.dayDirect&&evo.accDirect,'tempo e aproveitamento devem continuar na narrativa principal');
  eq(evo.periodDisplay,'none','gráfico de tempo deve obedecer ao período global, sem segundo seletor');
  ok(evo.gearHidden,'seletor de blocos deixa de ser necessário após a hierarquia fixa');

  /* TEC: motor escolhido é a única decisão prescritiva visível; legado permanece no DOM só por compatibilidade. */
  const tec=await page.evaluate(()=>{
    switchScreen('desempenhotec');
    const s=document.getElementById('screen-desempenhotec');
    let fake=s.querySelector('[data-tpm-entry]');
    if(!fake){fake=document.createElement('section');fake.dataset.tpmEntry='';s.prepend(fake);}
    UXHierarchy.decorateTec();
    return {
      entryHidden:fake.hidden,
      modosHidden:document.getElementById('plano-modos')?.hidden!==false,
      notaHidden:document.getElementById('plano-modo-nota')?.hidden!==false,
      oldCfgHidden:document.querySelector('#tec-panel-plano .tec-cfg-bar')?.hidden!==false,
      motoresLabel:document.querySelector('.tec-subtab[data-tectab="motores"]')?.textContent||''
    };
  });
  ok(tec.entryHidden,'seletor global duplicado de motor deve ficar oculto');
  ok(tec.modosHidden&&tec.notaHidden&&tec.oldCfgHidden,'decisores legados do Plano não devem disputar com Simplificado/Robusto');
  ok(!tec.motoresLabel||tec.motoresLabel.includes('Modelos'),'nomenclatura técnica Motores deve virar Modelos na interface');

  /* Configurações: segurança e diagnóstico continuam intactos, mas deixam de competir com ajustes cotidianos. */
  await page.evaluate(()=>{switchScreen('config');UXHierarchy.decorateConfig();});
  const cfg=await page.evaluate(()=>({
    details:!!document.getElementById('ux-config-data'),
    storage:document.getElementById('cfg-storage-card')?.closest('#ux-config-data')!=null,
    recovery:document.getElementById('cfg-recuperacao-card')?.closest('#ux-config-data')!=null,
    backup:document.getElementById('cfg-cloudbk-card')?.closest('#ux-config-data')!=null
  }));
  ok(cfg.details&&cfg.storage&&cfg.recovery&&cfg.backup,'backup/recuperação devem continuar acessíveis dentro da área avançada');

  /* Leis: perfil novo nasce com leitura limpa, sem remover nenhum comando. */
  const leis=await page.evaluate(()=>{
    UXHierarchy._lawDefaultsDone=false;
    const k=LeisScreen._prefKey('tools-open'),kp=LeisScreen._prefKey('p-painel');
    localStorage.removeItem(k);localStorage.removeItem(kp);localStorage.removeItem('diario-estudos:leis-tools-open');
    UXHierarchy.configureLawDefaults();
    return {tools:LeisScreen.ferramentasAbertas(),painel:LeisScreen.prefOn('p-painel'),mark:!!document.getElementById('lei-mark-btn'),focus:!!document.getElementById('lei-foco-btn')};
  });
  eq(leis.tools,false,'bancada avançada de Leis deve nascer recolhida');
  eq(leis.painel,false,'painel duplicado de destaques deve nascer oculto');
  ok(leis.mark&&leis.focus,'ações essenciais de leitura permanecem disponíveis');

  /* Mobile: a nova hierarquia não cria overflow horizontal. */
  await page.setViewportSize({width:360,height:800});
  for(const nome of ['ciclo','evolucao','desempenhotec','extras']){
    await page.evaluate(n=>{switchScreen(n);UXHierarchy.onScreen(n);},nome);
    await page.waitForTimeout(50);
    const ov=await page.locator('#screen-'+nome).evaluate(el=>el.scrollWidth-el.clientWidth);
    ok(ov<=4,`${nome} deve permanecer sem overflow horizontal (${ov}px)`);
  }

  ok(errors.length===0,'sem erros no navegador: '+errors.join(' | '));
  console.log(`UX HIERARQUIA OK — ${checks} invariantes.`);
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
