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
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon/.test(m.text()))errors.push(m.text());});

async function esperarPlano(){
  await page.waitForFunction(()=>{const l=document.getElementById('plano-lista');return !!l&&!/Calculando o seu plano/i.test(l.textContent||'')&&!!l.querySelector('.pl-item,.pl-hoje,.pl-mais,.pl-empty,.pl-sem-dados');},null,{timeout:10000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function esperarLivre(){await page.waitForFunction(()=>!document.querySelector('.ui-work-hud,.ui-working'),null,{timeout:10000});}
async function auditarControles(root,label){
  const r=await page.evaluate(sel=>{
    const host=document.querySelector(sel);if(!host)return{ausente:true,vazios:[],stale:[],overflow:0};
    const vis=e=>{const cs=getComputedStyle(e),b=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&b.width>0&&b.height>0};
    const botoes=[...host.querySelectorAll('button,[role="button"]')].filter(vis);
    return{
      ausente:false,
      vazios:botoes.filter(b=>!String(b.textContent||'').trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('title')).map(b=>b.id||b.className||b.outerHTML.slice(0,80)),
      stale:botoes.filter(b=>!b.classList.contains('ui-working')&&/^(processando|carregando|filtrando|recalculando|criando|concluindo|registrando|abrindo)/i.test(String(b.textContent||'').trim())).map(b=>(b.textContent||'').trim()),
      overflow:Math.max(0,host.scrollWidth-host.clientWidth)
    };
  },root);
  assert.equal(r.ausente,false,`${label}: raiz ausente`);
  assert.deepEqual(r.vazios,[],`${label}: botão visível sem nome acessível`);
  assert.deepEqual(r.stale,[],`${label}: rótulo transitório ficou preso`);
  assert.ok(r.overflow<=4,`${label}: overflow horizontal ${r.overflow}px`);
}

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchScreen==='function'&&typeof DesempenhoTecScreen==='object'&&typeof PlanoEngine==='object'&&typeof ExtrasScreen==='object'&&typeof WorkFeedback==='object',{timeout:30000});
  await page.evaluate(()=>{ WorkFeedback.forceDeferred=true; });

  const volume=await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(e){if(typeof _quiet==='function')_quiet(e,'teste-fluidez-hide-gate');}
    const DT=DesempenhoTecScreen,PE=PlanoEngine,hoje=new Date();
    const dia=off=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);};
    const disciplinas=Array.from({length:10},(_,i)=>`Matéria Fluxo ${String(i+1).padStart(2,'0')}`);
    DB.saveSubjects(disciplinas.map((nome,i)=>({id:`flux-disc-${i}`,nome,ativo:true,peso:1,qtdQuestoes:100,pontosPorQuestao:1,minimoPct:50})));
    const linhas=rodada=>disciplinas.flatMap((disc,di)=>{
      const folhas=Array.from({length:100},(_,ti)=>{const q=25+((ti+rodada)%6)*5,taxa=Math.max(.18,Math.min(.94,.34+(ti%20)*.022+rodada*.018+di*.002)),ac=Math.round(q*taxa);return{codigo:String(ti+1).padStart(3,'0'),nome:`Tópico ${String(ti+1).padStart(3,'0')}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};});
      const q=folhas.reduce((s,x)=>s+x.questoes,0),ac=folhas.reduce((s,x)=>s+x.acertos,0);return[{codigo:null,nome:disc,depth:0,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100},...folhas];
    });
    const snaps=Array.from({length:8},(_,i)=>({id:9300+i,startDate:dia(-210+i*30),endDate:dia(-210+i*30),date:dia(-210+i*30),label:`Retrato fluxo ${i+1}`,rows:linhas(i)}));
    DB._set(DB.KEYS.tec,snaps);
    DB.saveIncidencia(disciplinas.flatMap((disc,di)=>[{banca:'BANCA FLUXO',disciplina:disc,topico:disc,codigo:null,depth:0,incidencia:1200-di*20},...Array.from({length:100},(_,ti)=>({banca:'BANCA FLUXO',disciplina:disc,topico:`Tópico ${String(ti+1).padStart(3,'0')}`,codigo:String(ti+1).padStart(3,'0'),depth:1,incidencia:120-(ti%60)}))]));
    DB.saveExtras([]);
    PE.salvarPrefs({...PE.DEFAULTS,migracao:4,limite:10,minAmostra:20,incluirPequenas:false,granPiso:0,foco:[],disciplina:'__todas__'});
    DT.scopeMode='consolidado';DT.selectedSnapIds=new Set(snaps.map(s=>s.id));DT.rangeStart=null;DT.rangeEnd=null;DT._scopedC=null;DT._planoRefC=null;DT._fatias=null;PE._agrC=null;PE._tecScopeSignature=null;PE._indiceC=new WeakMap();
    return{snapshots:snaps.length,disciplinas:disciplinas.length,topicos:1000,linhas:snaps.reduce((s,x)=>s+x.rows.length,0)};
  });

  // Regressão do bug relatado: concluir/reabrir não pode trocar o nome do
  // botão por “Processando…” nem deixar estado transitório preso no card novo.
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
  const rotulo=await page.evaluate(()=>{
    const e=DB.addExtra({titulo:'Extra de rótulo estável',tipo:'livre',alvo:1,periodo:'unica'});
    ExtrasScreen.render();
    const b=document.querySelector(`.exd[data-id="${e.id}"] .exd-check`),t=performance.now();
    const antes=(b.textContent||'').trim();b.click();
    return{id:e.id,antes,imediato:(b.textContent||'').trim(),sync:performance.now()-t,busy:b.classList.contains('ui-working')};
  });
  assert.equal(rotulo.antes,'Concluir','atividade nova deve começar em Concluir');
  assert.equal(rotulo.imediato,'Concluir','feedback não pode substituir o rótulo por Processando');
  assert.ok(rotulo.sync<100,`concluir bloqueou o clique por ${rotulo.sync.toFixed(0)}ms`);
  assert.equal(rotulo.busy,true,'concluir deve sinalizar processamento sem reescrever o rótulo');
  await esperarLivre();
  const aposConcluir=await page.evaluate(id=>{const b=document.querySelector(`.exd[data-id="${id}"] .exd-check`);return{txt:(b?.textContent||'').trim(),busy:!!b?.classList.contains('ui-working'),status:DB.getExtra(id)?.status};},rotulo.id);
  assert.equal(aposConcluir.txt,'Reabrir','card concluído deve terminar com rótulo Reabrir');
  assert.equal(aposConcluir.busy,false,'card novo não pode herdar estado busy');
  assert.equal(aposConcluir.status,'concluida');
  const reabrirRotulo=await page.evaluate(id=>{const b=document.querySelector(`.exd[data-id="${id}"] .exd-check`),t=performance.now();const antes=(b.textContent||'').trim();b.click();return{antes,imediato:(b.textContent||'').trim(),sync:performance.now()-t};},rotulo.id);
  assert.equal(reabrirRotulo.antes,'Reabrir');
  assert.equal(reabrirRotulo.imediato,'Reabrir','reabrir também preserva o rótulo durante o spinner');
  await esperarLivre();
  assert.equal(await page.evaluate(id=>(document.querySelector(`.exd[data-id="${id}"] .exd-check`)?.textContent||'').trim(),rotulo.id),'Concluir');
  await auditarControles('#screen-extras','Extras desktop');

  // Extras → Puxar do Plano: feedback precisa pintar ANTES do cálculo.
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
  const abrir=await page.evaluate(()=>{const b=document.getElementById('extras-plano-btn'),t=performance.now();b.click();return{sync:performance.now()-t,busy:b.classList.contains('ui-working'),hud:!!document.querySelector('.ui-work-hud')};});
  assert.ok(abrir.sync<100,`Puxar do Plano bloqueou o clique por ${abrir.sync.toFixed(0)}ms`);
  assert.ok(abrir.busy&&abrir.hud,'Puxar do Plano deve mostrar processamento imediatamente');
  const tModal=Date.now();
  await page.waitForFunction(()=>document.getElementById('ui-modal')?.style.display==='flex'&&/Puxar do Plano/i.test(document.getElementById('ui-modal-title')?.textContent||''),null,{timeout:5000});
  const modalWall=Date.now()-tModal;
  assert.ok(modalWall<3000,`modal Puxar do Plano levou ${modalWall}ms`);
  await esperarLivre();
  await page.evaluate(()=>document.getElementById('ui-modal-cancel')?.click());

  // Plano e modo Base ampla: resposta imediata + trabalho depois da pintura.
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.switchTecTab('plano');});
  await esperarPlano();
  const modo=await page.evaluate(()=>{const b=document.querySelector('.pl-modo[data-modo="base"]');if(!b)return null;const t=performance.now();b.click();return{sync:performance.now()-t,busy:b.classList.contains('ui-working'),hud:!!document.querySelector('.ui-work-hud')};});
  assert.ok(modo,'modo Base ampla deve existir');
  assert.ok(modo.sync<100,`Base ampla bloqueou o clique por ${modo.sync.toFixed(0)}ms`);
  assert.ok(modo.busy,'Base ampla deve sinalizar processamento antes do recálculo');
  await esperarLivre();
  await esperarPlano();

  // Atacar: o botão não pode congelar nem deixar os botões de foco sem texto.
  const ataque=await page.evaluate(()=>{const b=document.querySelector('[data-atacar]');if(!b)return null;const nome=b.dataset.atacar,t=performance.now();b.click();return{nome,sync:performance.now()-t,busy:b.classList.contains('ui-working')};});
  assert.ok(ataque,'o cenário de teste deve oferecer matéria para atacar');
  assert.ok(ataque.sync<100,`Atacar bloqueou o clique por ${ataque.sync.toFixed(0)}ms`);
  assert.ok(ataque.busy,'Atacar deve mostrar processamento imediatamente');
  await esperarLivre();
  await esperarPlano();
  const focos=await page.evaluate(()=>[...document.querySelectorAll('.pl-foco-bt')].map(b=>({txt:(b.textContent||'').trim(),cor:getComputedStyle(b).color,op:getComputedStyle(b).opacity,fs:parseFloat(getComputedStyle(b).fontSize)||0,nome:b.dataset.foco||''})));
  assert.ok(focos.length>0,'deve existir ao menos um botão Focar');
  assert.ok(focos.every(x=>x.txt&&x.cor!=='rgba(0, 0, 0, 0)'&&x.op!=='0'&&x.fs>0),`botão Focar inválido: ${JSON.stringify(focos.filter(x=>!x.txt||x.cor==='rgba(0, 0, 0, 0)'||x.op==='0'||x.fs<=0))}`);

  // Criar atividades marcadas: lote responde imediatamente e grava Extras.
  const antes=await page.evaluate(()=>DB.getExtras().length);
  const lotePrep=await page.evaluate(()=>{const cs=[...document.querySelectorAll('.pl-hoje-sel:not(:disabled)')].slice(0,2);cs.forEach(c=>{c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));});const b=document.getElementById('plano-lote');return{n:cs.length,disabled:!!b?.disabled,txt:b?.textContent||''};});
  assert.ok(lotePrep.n>0&&!lotePrep.disabled,`lote indisponível: ${JSON.stringify(lotePrep)}`);
  const lote=await page.evaluate(()=>{const b=document.getElementById('plano-lote'),t=performance.now();b.click();return{sync:performance.now()-t,busy:b.classList.contains('ui-working'),hud:!!document.querySelector('.ui-work-hud')};});
  assert.ok(lote.sync<100,`criação em lote bloqueou o clique por ${lote.sync.toFixed(0)}ms`);
  assert.ok(lote.busy&&lote.hud,'criação em lote deve mostrar feedback de processamento');
  await esperarLivre();
  await esperarPlano();
  const depois=await page.evaluate(()=>DB.getExtras().length);
  assert.ok(depois>antes,'criação em lote deve gerar pelo menos uma Extra');

  // Concluir e reabrir: reabre status E ciclo/veredito do Plano.
  const fechado=await page.evaluate(()=>{
    const e=DB.getExtras().find(x=>x.origemPlano&&x.origemPlano.topico);if(!e)return null;
    // O checkbox do card é conclusão da MISSÃO DIÁRIA para reforços gerenciados.
    // Para testar uma conclusão global acidental usamos a mesma porta do botão
    // “Encerrar ciclo”, que sela o veredito e pode depois ser desfeita.
    ReforcoFila.encerrarCiclo(e.id);
    const f=DB.getExtra(e.id);
    return{id:e.id,status:f.status,veredito:!!f.origemPlano?.veredito,feito:f.progresso||0,alvo:f.alvo};
  });
  assert.ok(fechado&&fechado.status==='concluida'&&fechado.veredito,`encerramento global da Extra do Plano deve selar o ciclo antes de testar a reabertura: ${JSON.stringify(fechado)}`);
  await page.evaluate(id=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();const b=document.querySelector(`.exd[data-id="${id}"] .exd-check`);if(!b)throw new Error('card concluído não encontrado para reabrir');b.click();},fechado.id);
  await esperarLivre();
  const reaberto=await page.evaluate(id=>{const e=DB.getExtra(id);return{status:e.status,veredito:!!e.origemPlano?.veredito,auditoria:!!e.origemPlano?.ultimoVereditoReaberto};},fechado.id);
  assert.equal(reaberto.status,'ativa','Reabrir deve voltar a atividade para ativa');
  assert.equal(reaberto.veredito,false,'Reabrir deve retirar o veredito ativo do ciclo');
  assert.equal(reaberto.auditoria,true,'Reabrir deve preservar o veredito anterior para auditoria');

  // Gerenciador: concluída precisa ter ação explícita de reabrir.
  const manual=await page.evaluate(()=>{const e=DB.addExtra({titulo:'Extra concluída de teste',tipo:'livre',alvo:1,periodo:'unica'});DB.setConcluidaDia(e.id,todayLocal(),true);ExtrasScreen.manageOpen();return e.id;});
  await page.waitForFunction(id=>!!document.querySelector(`.exm-row[data-id="${id}"] .exm-reopen`),manual,{timeout:3000});
  await page.evaluate(id=>document.querySelector(`.exm-row[data-id="${id}"] .exm-reopen`)?.click(),manual);
  await esperarLivre();
  assert.equal(await page.evaluate(id=>DB.getExtra(id)?.status,manual),'ativa','Gerenciador deve reabrir a Extra concluída');

  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.switchTecTab('plano');});
  await esperarPlano();
  await auditarControles('#tec-panel-plano','Plano TEC desktop');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
  await auditarControles('#screen-extras','Extras mobile');
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.switchTecTab('plano');});
  await esperarPlano();
  await auditarControles('#tec-panel-plano','Plano TEC mobile');
  assert.deepEqual(errors,[],'fluxos de Extras/Plano não devem gerar erro de página ou console');
  console.log(`OK_FLUIDEZ volume=${JSON.stringify(volume)} modalPlano=${modalWall}ms extras=${antes}->${depois} focos=${focos.length}`);
}finally{
  await browser.close();
  await new Promise(r=>server.close(r));
}
