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
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon/.test(m.text()))errors.push(m.text());});

async function abrir(){
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
  await page.locator('#extras-plano-btn').click();
  await page.waitForFunction(()=>document.getElementById('ui-modal')?.style.display==='flex'&&!!document.querySelector('.ps-mode-grid'),null,{timeout:8000});
}
async function esperarModo(modo){
  await page.waitForFunction(m=>document.querySelector(`.ps-mode[data-ps-modo="${m}"]`)?.classList.contains('active'),modo,{timeout:5000});
  await page.waitForTimeout(120);
}
async function snapshotLista(){
  return page.evaluate(()=>({
    cards:[...document.querySelectorAll('.ps-card')].map(x=>({disc:(x.querySelector('.ps-disc')?.textContent||'').trim(),nome:(x.querySelector('strong')?.textContent||'').trim(),interv:(x.querySelector('.rv4-interv')?.textContent||'').trim()})),
    compare:[...document.querySelectorAll('.ps-compare-row')].map(x=>({disc:(x.querySelector('header b')?.textContent||'').trim(),ops:x.querySelectorAll('.ps-compare-option').length,cons:/Consenso/i.test(x.textContent||''),ranks:(x.textContent||'').match(/#\d+/g)||[]})),
    overflow:Math.max(0,(document.getElementById('ui-modal-body')?.scrollWidth||0)-(document.getElementById('ui-modal-body')?.clientWidth||0))
  }));
}

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchScreen==='function'&&typeof PlanoSugestoesV2==='object'&&typeof PlanoSugestoesSimplificadoV2==='object'&&typeof PlanoSugestoesRobustoV4==='object'&&typeof PlanoRobustoConfigV4==='object'&&typeof PlanoEngine==='object'&&typeof ExtrasScreen==='object',{timeout:30000});
  await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(e){if(typeof _quiet==='function')_quiet(e,'dual-test-gate');}
    const hoje=new Date(),dia=off=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);};
    const discs=['Auditoria','Contabilidade','Direito Tributário','AFO'];
    DB.saveSubjects(discs.map((nome,i)=>({id:`dual-${i}`,nome,ativo:true,peso:1,qtdQuestoes:20-i*2,pontosPorQuestao:1,minimoPct:50})));
    const rows=rod=>discs.flatMap((disc,di)=>{
      const folhas=Array.from({length:12},(_,ti)=>{const q=28+((ti+rod)%3)*4,taxa=Math.min(.92,.38+di*.055+ti*.018+rod*.015),ac=Math.round(q*taxa);return{codigo:`${di+1}.${ti+1}`,nome:`${disc} Tópico ${String(ti+1).padStart(2,'0')}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};});
      const q=folhas.reduce((s,x)=>s+x.questoes,0),ac=folhas.reduce((s,x)=>s+x.acertos,0);return[{codigo:null,nome:disc,depth:0,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100},...folhas];
    });
    const snaps=Array.from({length:4},(_,i)=>({id:9900+i,startDate:dia(-90+i*30),endDate:dia(-90+i*30),date:dia(-90+i*30),label:`Dual ${i+1}`,rows:rows(i)}));
    DB._set(DB.KEYS.tec,snaps);DB.saveExtras([]);
    PlanoEngine.salvarPrefs({...PlanoEngine.DEFAULTS,migracao:4,limite:200,minAmostra:20,incluirPequenas:false,granPiso:0,foco:[],disciplina:'__todas__',sugestoesDisciplinas:3,sugestoesTopicosDisc:1});
    PlanoSugestoesV2.salvar({modo:'robusto',fase:'pre',meta:90,minAmostra:20,banca:'__todas__'});
    DesempenhoTecScreen.scopeMode='consolidado';DesempenhoTecScreen.selectedSnapIds=new Set(snaps.map(s=>s.id));DesempenhoTecScreen.rangeStart=null;DesempenhoTecScreen.rangeEnd=null;DesempenhoTecScreen._scopedC=null;DesempenhoTecScreen._planoRefC=null;PlanoEngine._agrC=null;PlanoEngine._tecScopeSignature=null;PlanoEngine._indiceC=new WeakMap();
  });

  await abrir();
  let snap=await snapshotLista();
  assert.equal(snap.cards.length,3,'Robusto deve abrir com exatamente 3 sugestões');
  assert.equal(new Set(snap.cards.map(x=>x.disc)).size,3,'Robusto deve usar 3 disciplinas distintas');
  assert.ok(snap.cards.every(x=>x.interv),'Robusto V4 deve explicar a intervenção de cada frente');
  assert.equal(await page.locator('[data-ps-meta]').count(),0,'Robusto não pode expor/consumir os controles do Simplificado');
  assert.equal(await page.locator('[data-rv4-toggle]').count(),1,'Robusto deve oferecer painel avançado próprio');
  assert.match(await page.locator('#ui-modal-body').textContent(),/Robusto independente/i,'a independência do Robusto deve ficar explícita');
  assert.ok(snap.overflow<=4,`modal Robusto não pode ter overflow horizontal (${snap.overflow}px)`);

  await page.locator('[data-rv4-toggle]').click();
  await page.waitForFunction(()=>document.querySelector('[data-rv4-host]')&&!document.querySelector('[data-rv4-host]').hidden);
  assert.ok(await page.locator('[data-rv4-field]').count()>20,'painel robusto deve expor recursos e parâmetros avançados');
  assert.ok(await page.locator('[data-rv4-reset]').count()>15,'cada parâmetro deve ter restauração individual');
  assert.equal(await page.locator('[data-rv4-reset-group]').count(),3,'cada grupo deve ter restaurar padrões');
  assert.equal(await page.locator('[data-rv4-reset-all]').count(),1,'modo deve ter restauração integral');
  const opt=page.locator('[data-rv4-field="recursos.otimizadorAtivo"]');
  assert.equal(await opt.isChecked(),true,'otimizador deve vir ligado no padrão Base ampla');
  await opt.uncheck();
  await page.waitForFunction(()=>/otimizador off/i.test(document.querySelector('#ui-modal-body')?.textContent||''));
  snap=await snapshotLista();assert.equal(snap.cards.length,3,'desligar otimizador deve recuar sem quebrar 3×1');
  await page.locator('[data-rv4-reset-all]').click();
  await page.waitForFunction(()=>document.querySelector('[data-rv4-field="recursos.otimizadorAtivo"]')?.checked===true);
  assert.equal(await page.locator('[data-rv4-field="recursos.otimizadorAtivo"]').isChecked(),true,'restaurar modo deve devolver default recomendado');
  assert.match(await page.locator('[data-rv4-panel]').textContent(),/Base ampla|padrões recomendados/i);
  snap=await snapshotLista();assert.ok(snap.overflow<=4,`painel robusto não pode criar overflow horizontal (${snap.overflow}px)`);

  await page.locator('.ps-mode[data-ps-modo="simplificado"]').click();await esperarModo('simplificado');
  snap=await snapshotLista();
  assert.equal(snap.cards.length,3,'Simplificado deve manter a estrutura 3×1');
  assert.equal(new Set(snap.cards.map(x=>x.disc)).size,3,'Simplificado deve usar 3 disciplinas distintas');
  assert.equal(await page.locator('[data-ps-meta]').count(),1,'Simplificado deve ter configuração própria de meta');
  assert.equal(await page.locator('[data-ps-alvo]').count(),1,'Simplificado deve ter alvo próprio de questões');
  assert.equal(await page.locator('[data-rv4-toggle]').count(),0,'painel Robusto não pode contaminar o Simplificado');
  const rule=await page.locator('.ps-rule').textContent();
  assert.match(rule,/3 disciplinas distintas/i,'a regra 3×1 deve estar explícita no modal');

  await page.locator('.ps-mode[data-ps-modo="comparar"]').click();await esperarModo('comparar');
  snap=await snapshotLista();
  assert.equal(snap.compare.length,3,'Comparar deve mostrar no máximo uma linha por cada uma das 3 disciplinas');
  assert.equal(new Set(snap.compare.map(x=>x.disc)).size,3,'Comparar não pode repetir disciplina');
  assert.ok(snap.compare.every(x=>x.ops>=1&&x.ops<=2),'cada disciplina deve mostrar uma ou duas decisões, nunca duplicar execução');
  assert.ok(snap.compare.some(x=>x.ranks.length),'Comparar deve expor posição de ranking, não misturar scores heterogêneos');
  assert.match(await page.locator('#ui-modal-body').textContent(),/Duas saídas independentes|Não usa os controles do Simplificado/i);
  assert.ok(snap.overflow<=4,`modal Comparar não pode ter overflow horizontal (${snap.overflow}px)`);

  const antes=await page.evaluate(()=>DB.getExtras().length);
  await page.locator('#ui-modal-ok').click();
  await page.waitForFunction(n=>DB.getExtras().length>n,antes,{timeout:5000});
  const criadas=await page.evaluate(()=>DB.getExtras().slice(-3).map(e=>({disc:e.disciplina,alvo:e.alvo,status:e.status,motor:e.origemPlano?.sugestao?.motor,modo:e.origemPlano?.sugestao?.modoInterface,dose:e.origemPlano?.sugestao?.doseDiaria,alvoMeta:e.origemPlano?.sugestao?.alvoGlobal,arquitetura:e.origemPlano?.sugestao?.arquitetura,config:e.origemPlano?.sugestao?.configRobusto,interv:e.origemPlano?.sugestao?.intervencao,opt:e.origemPlano?.sugestao?.otimizacaoV4})));
  assert.equal(criadas.length,3,'Comparar deve criar uma única atividade por disciplina');
  assert.equal(new Set(criadas.map(x=>x.disc)).size,3,'as três atividades criadas devem ser de disciplinas distintas');
  assert.ok(criadas.every(x=>/^(simplificado-v2|robusto-v4)$/.test(x.motor)&&x.modo==='comparar'),'a origem deve registrar o motor efetivo independente e o modo Comparar');
  assert.ok(criadas.every(x=>x.arquitetura&&x.arquitetura.independente===true),'cada atividade deve persistir a arquitetura do motor que a decidiu');
  assert.ok(criadas.every(x=>x.alvo===x.alvoMeta),'o alvo da atividade deve ser o alvo global auditado');
  assert.ok(criadas.every(x=>x.dose==null||x.dose<=x.alvo),'dose diária nunca pode substituir/superar o alvo global');
  const robustas=criadas.filter(x=>x.motor==='robusto-v4');assert.ok(robustas.length>=1,'Comparar deve manter pelo menos uma decisão Robusta neste cenário');assert.ok(robustas.every(x=>x.config&&x.config.versao===4&&x.interv&&x.interv.tipo),'Robusto deve persistir configuração e intervenção auditáveis');

  await abrir();
  const novamente=await page.evaluate(()=>[...document.querySelectorAll('.ps-card,.ps-compare-row')].map(x=>(x.textContent||'').trim()));
  const discosCriadas=criadas.map(x=>x.disc);
  assert.ok(novamente.every(txt=>!discosCriadas.some(d=>txt.startsWith(d)&&txt.includes('Tópico')))||novamente.length<3,'disciplinas com atividades abertas devem sair do próximo lote');
  await page.locator('#ui-modal-cancel').click();

  assert.deepEqual(errors,[],`erros no navegador: ${errors.join(' | ')}`);
  console.log('OK: Puxar do Plano V4 — painel Robusto, resets, motores independentes, Comparar e execução única 3×1.');
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}