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
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];let checks=0;
const ok=(v,m)=>{checks++;assert.ok(v,m);};
const eq=(a,b,m)=>{checks++;assert.equal(a,b,m);};
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon/.test(m.text()))errors.push(m.text());});

async function esperarPlano(){await page.waitForFunction(()=>{const l=document.getElementById('plano-lista');return !!l&&!/Calculando o seu plano/i.test(l.textContent||'')&&!!l.querySelector('.pl-hoje,.pl-item,.pl-empty,.pl-sem-dados');},null,{timeout:12000});await page.waitForTimeout(160);}
async function snap(nome){if(process.env.TEC_UX_SHOTS!=='1')return;const dir=join(ROOT,'.artifacts','tec-ux100');mkdirSync(dir,{recursive:true});await page.screenshot({path:join(dir,nome),fullPage:true});}

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchScreen==='function'&&typeof DesempenhoTecScreen==='object'&&typeof PlanoEngine==='object'&&typeof TecAuditoria==='object'&&typeof ExtrasScreen==='object',{timeout:30000});

  const setup=await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(_){}
    const hoje=new Date(),dia=off=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);};
    const discs=['AFO Auditoria','Contabilidade Geral','Direito Tributário','Estatística'];
    DB.saveSubjects(discs.map((nome,i)=>({id:`ux2-${i}`,nome,ativo:true,peso:1,qtdQuestoes:100,pontosPorQuestao:1,minimoPct:50})));
    const linhas=rod=>discs.flatMap((disc,di)=>{
      const folhas=Array.from({length:28},(_,ti)=>{const q=30+((ti+rod)%4)*5;const base=[.32,.49,.56,.68][di];const taxa=Math.min(.94,base+(ti%12)*.012+rod*.012);const ac=Math.round(q*taxa);return{codigo:String(ti+1).padStart(3,'0'),nome:`${disc} · Tópico ${String(ti+1).padStart(2,'0')}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};});
      const q=folhas.reduce((s,x)=>s+x.questoes,0),ac=folhas.reduce((s,x)=>s+x.acertos,0);return[{codigo:null,nome:disc,depth:0,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100},...folhas];
    });
    const snaps=Array.from({length:6},(_,i)=>({id:9700+i,startDate:dia(-150+i*30),endDate:dia(-150+i*30),date:dia(-150+i*30),label:`Retrato UX2 ${i+1}`,rows:linhas(i)}));
    DB._set(DB.KEYS.tec,snaps);DB.saveExtras([]);
    PlanoEngine.salvarPrefs({...PlanoEngine.DEFAULTS,migracao:4,limite:10,minAmostra:20,incluirPequenas:false,granPiso:0,foco:discs.slice(0,3),disciplina:'__todas__',sugestoesDisciplinas:3,sugestoesTopicosDisc:1});
    DesempenhoTecScreen.scopeMode='consolidado';DesempenhoTecScreen.selectedSnapIds=new Set(snaps.map(s=>s.id));DesempenhoTecScreen.rangeStart=snaps[0].startDate;DesempenhoTecScreen.rangeEnd=snaps.at(-1).endDate;
    DesempenhoTecScreen._scopedC=null;DesempenhoTecScreen._planoRefC=null;DesempenhoTecScreen._fatias=null;PlanoEngine._agrC=null;PlanoEngine._tecScopeSignature=null;PlanoEngine._indiceC=new WeakMap();
    switchScreen('desempenhotec');DesempenhoTecScreen.tecTab='plano';DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');
    TecAuditoria._renderedScopeKey=TecAuditoria.scopeKey();
    return{snaps:snaps.length,discs};
  });
  await esperarPlano();

  const bloco=await page.evaluate(()=>{const cs=[...document.querySelectorAll('#plano-lista .pl-hoje-sel:checked:not(:disabled)')];return{n:cs.length,discs:[...new Set(cs.map(c=>c.dataset.disc))],txt:document.querySelector('.tec-v2-diversidade')?.textContent||''};});
  const diagBloco=await page.evaluate(()=>({prefs:PlanoEngine.prefs(),last:(TecAuditoria._lastPlanResult?.itens||[]).slice(0,80).map(x=>({d:x.disciplina,n:x.nome,q:x.custoQ,open:!!x.extraAberta})),pool:(TecAuditoria._poolC?.itens||[]).slice(0,240).map(x=>({d:x.disciplina,n:x.nome,q:x.custoQ,open:!!x.extraAberta})),dom:[...document.querySelectorAll('#plano-lista .pl-hoje-sel')].map(x=>({d:x.dataset.disc,n:x.dataset.topico,on:x.checked,off:x.disabled}))}));
  console.log('DIAG_BLOCO',JSON.stringify(diagBloco));
  await snap('00-diag-plano-multifoco.png');
  eq(bloco.n,3,'3 disciplinas × 1 tópico deve gerar bloco inicial de 3 assuntos');
  eq(bloco.discs.length,3,'o próximo bloco deve distribuir uma prioridade por disciplina');
  ok(/Rodízio ativo/i.test(bloco.txt),'o bloco deve explicar a regra de diversidade');
  await snap('01-plano-multifoco-mobile.png');

  const seletor=await page.evaluate(()=>{
    const itens=[...Array.from({length:5},(_,i)=>({nome:`A${i}`,disciplina:'A'})),{nome:'B1',disciplina:'B'},{nome:'C1',disciplina:'C'}];
    return TecPlanDiversity.selecionar(itens,{foco:['A','B','C'],sugestoesDisciplinas:3,sugestoesTopicosDisc:1}).map(x=>x.disciplina);
  });
  eq(new Set(seletor).size,3,'seletor compartilhado deve alcançar as 3 disciplinas mesmo quando a primeira domina o ranking');

  const noop=await page.evaluate(()=>{
    const D=DesempenhoTecScreen;window.__ux2={a:0,p:0};const a=D.renderAnalysis,p=D.renderPlano;D.renderAnalysis=function(){__ux2.a++;return a.apply(this,arguments)};D.renderPlano=function(){__ux2.p++;return p.apply(this,arguments)};
    D.scopeMode='select';D.selectedSnapIds=new Set(DB.getTecSnapshots().map(s=>s.id));const t=performance.now();D.aplicarMudancaEscopo();return performance.now()-t;
  });
  ok(noop<120,`troca de modo sem mudar dados deve devolver o controle rapidamente (${noop.toFixed(1)}ms)`);
  await page.waitForTimeout(220);
  const c0=await page.evaluate(()=>window.__ux2);
  eq(c0.a,0,'escopo equivalente não pode recalcular Análise escondida');
  eq(c0.p,0,'escopo equivalente não pode recalcular Plano');

  const coalesce=await page.evaluate(()=>{const D=DesempenhoTecScreen,ids=DB.getTecSnapshots().map(s=>s.id);const t=performance.now();D.selectedSnapIds=new Set(ids.slice(0,5));D.aplicarMudancaEscopo();D.selectedSnapIds=new Set(ids.slice(0,4));D.aplicarMudancaEscopo();D.selectedSnapIds=new Set(ids.slice(0,3));D.aplicarMudancaEscopo();return performance.now()-t;});
  ok(coalesce<160,`3 mudanças rápidas de retrato não podem bloquear o toque (${coalesce.toFixed(1)}ms)`);
  await page.waitForTimeout(900);await esperarPlano();
  const c1=await page.evaluate(()=>window.__ux2);
  eq(c1.a,0,'seleção de retratos no Plano não pode calcular Análise escondida');
  eq(c1.p,1,'mudanças rápidas devem ser coalescidas em um único recálculo do Plano');

  const rangeSync=await page.evaluate(()=>{const D=DesempenhoTecScreen,s=DB.getTecSnapshots();D.scopeMode='range';D.rangeStart=s[1].startDate;D.rangeEnd=s[4].endDate;const t=performance.now();D.aplicarMudancaEscopo();return performance.now()-t;});
  ok(rangeSync<120,`intervalo de datas deve devolver o controle rapidamente (${rangeSync.toFixed(1)}ms)`);
  await page.waitForTimeout(900);await esperarPlano();
  eq((await page.evaluate(()=>window.__ux2)).a,0,'intervalo no Plano continua sem render oculto de Análise');

  await page.evaluate(()=>TecAjustes.abrir('plano'));
  await page.waitForTimeout(120);
  const modalGeom=await page.evaluate(()=>{const body=document.getElementById('tec-cfg-body');const root=body?.closest('[role="dialog"],.modal,.tec-cfg-modal')||body?.parentElement;return{body:!!body,overflow:body?Math.max(0,body.scrollWidth-body.clientWidth):999,rootOverflow:root?Math.max(0,root.scrollWidth-root.clientWidth):999};});
  ok(modalGeom.body,'Ajustes do Plano deve abrir');ok(modalGeom.overflow<=4,`Ajustes do Plano sem overflow horizontal (${modalGeom.overflow}px)`);ok(modalGeom.rootOverflow<=4,`modal de Ajustes sem overflow (${modalGeom.rootOverflow}px)`);
  await snap('02-ajustes-plano-mobile.png');
  await page.keyboard.press('Escape');await page.waitForTimeout(80);

  // Regressão: ocorrência FUTURA já concluída continua visível e pode ser reaberta.
  const fut=await page.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+2);const day=d.toISOString().slice(0,10);const e=DB.addExtra({titulo:'Extra futuro reabrível',tipo:'questoes',alvo:18,unidade:'questoes',periodo:'unica',datas:[day]});const all=DB.getExtras();const legacy=all.find(x=>x.id===e.id);legacy.status='concluida';DB.saveExtras(all);switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();return{id:e.id,day};});
  await page.waitForTimeout(180);
  const futureCard=page.locator(`.exd[data-id="${fut.id}"][data-day="${fut.day}"]`);
  ok(await futureCard.count()===1,'Extra futuro concluído não pode desaparecer da visão Próximas');
  eq((await futureCard.locator('.exd-check').getAttribute('aria-label')),'Reabrir atividade','Extra futuro concluído deve oferecer reabertura');
  // A UX v3 deixa “Próximas” deliberadamente minimizada no overview. O teste
  // continua cobrando a reabertura real, mas expande o painel antes de interagir.
  let prox=page.locator('details.exm-section-proximas');
  if(await prox.count() && !(await prox.getAttribute('open'))) await prox.locator('summary').click();
  await futureCard.locator('.exd-check').click();await page.waitForTimeout(160);
  eq(await page.evaluate(({id,day})=>DB.extraConcluidaEm(DB.getExtra(id),day),fut),false,'reabrir deve remover conclusão futura preservando a atividade');
  await snap('03-extra-futuro-reaberto.png');

  // Futuro não concluído continua protegido contra conclusão antecipada. O
  // rerender fecha Próximas novamente por design, então reabrimos o painel.
  prox=page.locator('details.exm-section-proximas');
  if(await prox.count() && !(await prox.getAttribute('open'))) await prox.locator('summary').click();
  await page.locator(`.exd[data-id="${fut.id}"][data-day="${fut.day}"] .exd-check`).click();await page.waitForTimeout(100);
  eq(await page.evaluate(({id,day})=>DB.extraConcluidaEm(DB.getExtra(id),day),fut),false,'não deve ser possível concluir antecipadamente uma ocorrência futura aberta');

  // Auditoria geométrica em cinco larguras: bordas, overflow, botões e hit-area.
  for(const width of [360,390,430,768,1280]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.switchTecTab('plano');});await esperarPlano();
    const audit=await page.evaluate(()=>{
      const root=document.getElementById('screen-desempenhotec');const vis=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'};
      const btns=[...root.querySelectorAll('button')].filter(vis);const cards=[...root.querySelectorAll('.card,.pl-item,.pl-mat,.pl-hoje,.tp-command,.tpm-entry-selector,.tpm-selector,.tpm-output,.tpm-rec')].filter(vis);
      return{overflow:Math.max(0,root.scrollWidth-root.clientWidth),empty:btns.filter(b=>!String(b.textContent||'').trim()&&!b.getAttribute('aria-label')&&!b.title).length,tiny:btns.filter(b=>{const r=b.getBoundingClientRect();return r.width<28||r.height<28}).length,badBorder:cards.filter(c=>getComputedStyle(c).borderStyle==='none').length,buttons:btns.length,cards:cards.length};
    });
    ok(audit.overflow<=4,`${width}px: Desempenho TEC sem overflow (${audit.overflow}px)`);
    eq(audit.empty,0,`${width}px: nenhum botão visível sem nome acessível`);
    eq(audit.tiny,0,`${width}px: nenhum botão visível com hit-area menor que 28px`);
    ok(audit.cards>=8,`${width}px: superfície de Plano deve manter cards estruturados`);
    ok(audit.badBorder<=Math.max(2,Math.floor(audit.cards*.2)),`${width}px: separadores visuais devem continuar perceptíveis`);
    // 15 invariantes semânticos por largura para tornar a auditoria transversal.
    const sem=await page.evaluate(()=>({guide:!!document.querySelector('.tl2-guide'),summary:!!document.querySelector('.tl2-summary-strip'),hero:!!document.querySelector('.pl-hero'),prio:!!document.querySelector('.pl-tempo'),hoje:!!document.querySelector('.pl-hoje'),lote:!!document.getElementById('plano-lote'),settings:!!document.querySelector('[data-tp-settings]'),audit:!!document.querySelector('[data-tp-audit]'),tabs:document.querySelectorAll('#tec-subtabs button,.tec-subtab').length,scope:!!document.getElementById('tec-scope-toggle'),busy:document.getElementById('screen-desempenhotec')?.getAttribute('aria-busy')==='false',items:document.querySelectorAll('.pl-item').length,mats:document.querySelectorAll('.pl-mat').length,div:!!document.querySelector('.tec-v2-diversidade'),checked:new Set([...document.querySelectorAll('.pl-hoje-sel:checked')].map(x=>x.dataset.disc)).size}));
    for(const [k,v] of Object.entries(sem)){ if(k==='tabs'||k==='items'||k==='mats'||k==='checked') ok(v>0,`${width}px: ${k} presente`); else ok(!!v,`${width}px: ${k} presente`); }
    if(width===390||width===1280)await snap(`04-plano-${width}.png`);
  }

  assert.deepEqual(errors,[],'auditoria TEC/Extras não deve gerar erros de página/console');checks++;
  ok(checks>=100,`auditoria deve atravessar ao menos 100 invariantes (executou ${checks})`);
  console.log(`TEC_UX100_OK checks=${checks} snapshots=${setup.snaps} disciplinas=${setup.discs.length}`);
} finally {await browser.close();await new Promise(r=>server.close(r));}