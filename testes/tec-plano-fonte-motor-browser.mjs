import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end('nao encontrado');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`,browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});await page.route(/^https:\/\//,r=>r.abort());
const overflow=sel=>page.locator(sel).evaluate(el=>Math.max(0,el.scrollWidth-el.clientWidth));
try{
  await page.goto(url,{waitUntil:'commit',timeout:10000});await page.waitForFunction(()=>!!document.body,{timeout:5000});await page.waitForTimeout(1400);
  const boot=await page.evaluate(()=>({fonte:typeof TecPlanoFonteMotor,robusto:typeof PlanoSugestoesRobusto,controller:typeof PlanoSugestoes,gov:typeof PlanoMotoresGovernanca,tec:typeof DesempenhoTecScreen}));for(const[k,v]of Object.entries(boot))assert.equal(v,'object',`bootstrap ausente ${k}: ${JSON.stringify(boot)}`);
  await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(e){if(typeof _quiet==='function')_quiet(e,'tpm-gate');}
    const ap=PlanManager.getActivePlan();if(ap)PlanManager.updatePlan(ap.id,{tipo:'Pré-edital',robustoTecPost:null});
    const hoje=new Date(),dia=off=>{const d=new Date(hoje);d.setDate(d.getDate()+off);return d.toISOString().slice(0,10);},discs=['Auditoria','Contabilidade Geral','Direito Tributário','AFO'];
    const rows=rod=>discs.flatMap((disc,di)=>Array.from({length:8},(_,ti)=>{const q=30+rod*3,taxa=Math.min(.90,.42+di*.055+ti*.022+rod*.012),ac=Math.round(q*taxa);return{codigo:`${di+1}.${ti+1}`,nome:`${disc} Tópico ${ti+1}`,depth:1,disciplina:disc,questoes:q,acertos:ac,pctAcerto:ac/q*100};}));
    const snaps=Array.from({length:3},(_,i)=>({id:9900+i,startDate:dia(-60+i*30),endDate:dia(-60+i*30),date:dia(-60+i*30),label:`Motor ${i+1}`,rows:rows(i)}));DB._set(DB.KEYS.tec,snaps);DB.saveExtras([]);
    DesempenhoTecScreen.scopeMode='consolidado';DesempenhoTecScreen.selectedSnapIds=new Set(snaps.map(s=>s.id));DesempenhoTecScreen.rangeStart=null;DesempenhoTecScreen.rangeEnd=null;DesempenhoTecScreen._scopedC=null;DesempenhoTecScreen._planoRefC=null;
    PlanoMotoresGovernanca.restaurar();PlanoSugestoesRobusto.restaurar();TecPlanoFonteMotor.salvar('robusto');
  });
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.render();});await page.waitForSelector('[data-tpm-entry]');
  assert.equal(await page.locator('[data-tpm-entry] [data-tpm-source="robusto"]').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('[data-tpm-entry] [data-tpm-source="simplificado"]').count(),1);assert.match(await page.locator('[data-tpm-entry]').textContent(),/MODELO DAS SUGESTÕES/i);
  await page.locator('[data-tpm-entry] [data-tpm-source="simplificado"]').click();await page.waitForFunction(()=>TecPlanoFonteMotor.fonte()==='simplificado');assert.equal(await page.evaluate(()=>PlanoSugestoes.prefs().modo),'simplificado');
  await page.locator('[data-tpm-entry] [data-tpm-source="robusto"]').click();await page.waitForFunction(()=>TecPlanoFonteMotor.fonte()==='robusto');assert.equal(await page.evaluate(()=>PlanoSugestoes.prefs().modo),'robusto');

  /* ── UM SELETOR DE MOTOR, NAO DOIS ──────────────────────────────────────
     Havia duas caixas identicas na mesma tela: `[data-tpm-entry]`
     ("MODELO DAS SUGESTOES", acima das abas) e `[data-tpm-selector]`
     ("FONTE DA DECISAO", dentro do Plano) — mesmos dois botoes, mesmo estado,
     textos diferentes. A duplicata de dentro do Plano saiu; a de cima ficou,
     porque vale para todas as abas e e onde a escolha se faz. Quem informa o
     motor em vigor dentro do Plano e o `[data-tpm-panorama]`. */
  await page.evaluate(()=>DesempenhoTecScreen.switchTecTab('plano'));await page.waitForSelector('[data-tpm-panorama]');await page.waitForSelector('[data-tpm-output][data-tpm-model="robusto"]');
  assert.equal(await page.locator('[data-tpm-selector]').count(),0,'a segunda caixa de escolha de motor dentro do Plano nao deve existir');
  let cards=page.locator('[data-tpm-output] [data-tpm-rec]');assert.ok(await cards.count()>=1&&await cards.count()<=3,'Robusto deve sugerir até 3 frentes de ataque');const rdiscs=await cards.evaluateAll(xs=>xs.map(x=>x.dataset.disciplina));assert.equal(new Set(rdiscs).size,rdiscs.length,'Robusto deve usar disciplinas distintas no TOP 3');
  const txtR=await page.locator('[data-tpm-output]').textContent();assert.match(txtR,/questões recomendadas/i);assert.match(txtR,/Sem tempo direto suficiente nos reforços de Extras/i,'sem histórico vinculado o Robusto não deve inventar minutos');assert.match(txtR,/O algoritmo para aqui/i);
  assert.equal(await page.locator('[data-tpm-output] :is([data-rv8],[data-rv8-post-active],[data-pmc-simple])').count(),0,'Plano exibe recomendação, não configuração');
  const hero=page.locator('#plano-proj .pl-hero');assert.equal(await hero.isVisible(),false,'com motores ativos o card legado deve ceder lugar ao panorama TEC');
  const panorama=page.locator('[data-tpm-panorama]');assert.equal(await panorama.isVisible(),true,'panorama dos motores deve ficar visível no Plano TEC');assert.match(await panorama.textContent(),/Panorama TEC — dois motores ativos/i);assert.equal(await panorama.locator('details').getAttribute('open'),null,'explicação secundária deve iniciar recolhida');
  await page.evaluate(()=>UXHierarchy.decorateTec());assert.equal(await panorama.isVisible(),true,'reaplicar a hierarquia não pode classificar/ocultar o panorama novo como legado');
  for(const sel of ['#plano-lista>.pl-hoje','#plano-lista>.pl-ciclo.pl-tempo','#plano-lista>.pl-ordem','#plano-lista>.pl-porque','#plano-lista>.pl-item','#plano-lista>.pl-segundo']){const l=page.locator(sel);if(await l.count())assert.equal(await l.first().isVisible(),false,`decisão legada deve ficar oculta: ${sel}`);}
  const caminho=page.locator('#plano-proj .tpm-legacy-decision');if(await caminho.count())assert.equal(await caminho.isVisible(),false,'caminho curto legado não deve competir com motor');

  let ranking=page.locator('[data-tpm-ranking-item]');
  const totalRobusto=await page.evaluate(()=>TecPlanoFonteMotor.calcular('robusto').todos.length);
  assert.ok(totalRobusto>20,`fixture precisa de ranking robusto maior que 20, recebeu ${totalRobusto}`);
  assert.equal(await ranking.count(),10,'ranking completo do Robusto deve abrir exatamente em 10');
  assert.match(await page.locator('[data-tpm-ranking]').textContent(),/10 de \d+/i);
  await page.locator('[data-tpm-rank-more]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-tpm-ranking-item]').length===20);ranking=page.locator('[data-tpm-ranking-item]');assert.equal(await ranking.count(),20,'primeiro avanço deve abrir mais 10');
  await page.locator('[data-tpm-rank-more]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-tpm-ranking-item]').length===30);assert.equal(await page.locator('[data-tpm-ranking-item]').count(),30,'segundo avanço deve abrir mais 10');
  const all=page.locator('[data-tpm-rank-all]');if(await all.count()){await all.click();await page.waitForFunction(total=>document.querySelectorAll('[data-tpm-ranking-item]').length===total,totalRobusto);assert.equal(await page.locator('[data-tpm-ranking-item]').count(),totalRobusto,'mostrar todos deve revelar a fila completa do motor');}
  /* ── A FILA COMPLETA, AGRUPADA POR DISCIPLINA ───────────────────────────
     Era uma lista plana de mais de cem linhas, com os assuntos de uma mesma
     materia espalhados por toda a ordem do motor: "o que tenho aberto em CADA
     materia?" so se respondia rolando e contando a mao.

     O agrupamento nao reordena: as materias saem pela melhor posicao que
     alcancaram na fila DO MOTOR, e cada linha mantem o numero da posicao
     GLOBAL. E o que este caso trava — se o agrupamento reordenar, as posicoes
     deixam de ser 1..N em sequencia. */
  const grupos=await page.evaluate(()=>{
    const sec=document.querySelector('[data-tpm-ranking]');
    const gs=[...sec.querySelectorAll('.tpm-rank-grupo')];
    return {n:gs.length, itens:sec.querySelectorAll('[data-tpm-ranking-item]').length,
      cabecalho:sec.querySelector('header>span').textContent.trim(),
      discPorGrupo:gs.map(g=>new Set([...g.querySelectorAll('[data-tpm-ranking-item]')].map(x=>x.dataset.disciplina)).size),
      melhor:gs.map(g=>Number((g.querySelector('header>em').textContent.match(/#(\d+)/)||[])[1])),
      posicoes:[...sec.querySelectorAll('.tpm-ranking-rank')].map(x=>Number(x.textContent)),
      posPorGrupo:gs.map(g=>[...g.querySelectorAll('.tpm-ranking-rank')].map(x=>Number(x.textContent))),
      discRepetida:[...sec.querySelectorAll('.tpm-rank-grupo-itens .tpm-ranking-head small')].filter(x=>x.offsetParent!==null).length,
      metricasIguais:[...sec.querySelectorAll('.tpm-ranking-metrics')].slice(0,5)
        .every(m=>new Set([...m.children].map(c=>Math.round(c.getBoundingClientRect().width))).size<=1)};
  });
  assert.ok(grupos.n>=2,`a fila deve vir agrupada por disciplina (recebeu ${grupos.n} grupos)`);
  assert.ok(grupos.discPorGrupo.every(x=>x===1),`cada grupo deve conter uma disciplina so: ${JSON.stringify(grupos.discPorGrupo)}`);
  /* As posicoes de uma pagina aberta sao exatamente 1..N — cada uma uma vez.
     Elas NAO saem em sequencia na tela, e nao deveriam: agrupar por disciplina
     junta as posicoes de cada materia (1,2,3,9,13... depois 4,7,10...). O que
     tem de valer e que dentro de cada grupo a ordem do motor e preservada. */
  assert.deepEqual(grupos.posicoes.slice().sort((a,b)=>a-b),Array.from({length:grupos.itens},(_,i)=>i+1),
    `toda posicao da pagina aberta deve aparecer exatamente uma vez: ${JSON.stringify(grupos.posicoes)}`);
  grupos.posPorGrupo.forEach((ps,gi)=>assert.deepEqual(ps,ps.slice().sort((a,b)=>a-b),
    `dentro do grupo ${gi} a ordem do motor deve ser preservada: ${JSON.stringify(ps)}`));
  grupos.posPorGrupo.forEach((ps,gi)=>assert.equal(ps[0],grupos.melhor[gi],
    `"melhor #" do grupo ${gi} deve ser a primeira posicao dele (${ps[0]} x ${grupos.melhor[gi]})`));
  assert.deepEqual(grupos.melhor,grupos.melhor.slice().sort((a,b)=>a-b),'as disciplinas devem sair pela melhor posicao que alcancaram no motor');
  assert.equal(grupos.discRepetida,0,'dentro do grupo a disciplina nao deve ser repetida em cada linha');
  assert.ok(grupos.metricasIguais,'as metricas de cada linha devem ter colunas de largura igual');
  assert.match(grupos.cabecalho,/\d+ de \d+ assuntos/,`o cabecalho deve contar disciplinas e assuntos: "${grupos.cabecalho}"`);

  /* A ordem dos proximos assuntos da disciplina vinha como <ol> com marcador:
     o numero ficava fora da caixa e as tres medidas numa frase separada por
     pontos, entao nada se comparava de uma linha para a outra. */
  const ordem=await page.evaluate(()=>{
    const d=document.querySelector('#plano-lista .tpm-topic-order'); if(!d)return null;
    d.open=true; const lis=[...d.querySelectorAll('ol>li')];
    return {n:lis.length, transborda:lis.filter(l=>l.scrollWidth-l.clientWidth>1).length,
      colunas:new Set(lis.map(l=>[...l.children].map(c=>Math.round(c.getBoundingClientRect().left)).join(','))).size};
  });
  assert.ok(ordem&&ordem.n>=2,'a ordem dos proximos assuntos da disciplina deve existir');
  assert.equal(ordem.transborda,0,'nenhuma linha da ordem pode transbordar');
  assert.equal(ordem.colunas,1,`as colunas da ordem devem coincidir em todas as linhas (recebeu ${ordem&&ordem.colunas} arranjos)`);

  await page.locator('[data-tpm-rank-reset]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-tpm-ranking-item]').length===10);assert.equal(await page.locator('[data-tpm-ranking-item]').count(),10,'voltar a 10 deve recolher a fila sem alterar preferências');

  await page.locator('[data-tpm-entry] [data-tpm-source="simplificado"]').click();await page.waitForSelector('[data-tpm-output][data-tpm-model="simplificado"]');assert.equal(await page.evaluate(()=>TecPlanoFonteMotor.fonte()),'simplificado');const txtS=await page.locator('[data-tpm-output]').textContent();assert.match(txtS,/O Simplificado não modela tempo/i);assert.doesNotMatch(txtS,/min\/questão/i,'Simplificado não pode emprestar relógio do Robusto');cards=page.locator('[data-tpm-output] [data-tpm-rec]');const sdiscs=await cards.evaluateAll(xs=>xs.map(x=>x.dataset.disciplina));assert.equal(new Set(sdiscs).size,sdiscs.length,'TOP 3 do Simplificado continua em disciplinas distintas');
  const totalSimplificado=await page.evaluate(()=>TecPlanoFonteMotor.calcular('simplificado').todos.length);assert.ok(totalSimplificado>10);assert.equal(await page.locator('[data-tpm-ranking-item]').count(),10,'troca de motor deve abrir a fila do novo motor em 10');
  assert.equal(await page.locator('#plano-lista>.pl-item:visible').count(),0,'ranking completo não pode ressuscitar a lista decisória do PlanoEngine legado');

  /* ── "🎯 ATACAR AGORA" TEM DE CRIAR A ATIVIDADE ─────────────────────────
     O quadro dizia onde atacar e nao dava como: o rodape mandava a pessoa a
     outra tela, reabrir o mesmo calculo num modal e reencontrar ali a
     recomendacao que ja estava na frente dela. Nao havia botao nenhum — era
     literalmente isso o "o botao atacar agora nao funciona".

     O que este caso prova: o botao existe, cria UMA atividade com a dose que
     ESTE motor recomendou, grava a procedencia (motor/fase/score) pela mesma
     porta do modal, e o quadro repinta apontando o proximo alvo. */
  await page.evaluate(()=>{TecPlanoFonteMotor.salvar('robusto');DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');});
  await page.waitForSelector('[data-tpm-output][data-tpm-model="robusto"] .tpm-atacar');
  const atacar=await page.evaluate(async()=>{
    const bt=document.querySelector('#plano-lista .tpm-atacar');
    const alvo=document.querySelector('#plano-lista .tpm-rec .tpm-head b').textContent.trim();
    const dose=Number((bt.textContent.match(/(\d+)\s*q/)||[])[1])||null;
    const antes=DB.getExtras().length;
    bt.click();
    await new Promise(r=>setTimeout(r,1200));
    const ex=DB.getExtras(),novo=ex[ex.length-1],sug=(novo&&novo.origemPlano&&novo.origemPlano.sugestao)||{};
    return {alvo,dose,antes,depois:ex.length,titulo:novo&&novo.titulo,alvoQ:novo&&novo.alvo,
      motor:sug.motor||null,fase:sug.fase||null,temScore:Number.isFinite(Number(sug.score)),
      nomesDepois:[...document.querySelectorAll('#plano-lista .tpm-rec .tpm-head b')].map(x=>x.textContent.trim())};
  });
  assert.equal(atacar.depois,atacar.antes+1,'🎯 Atacar agora deve criar exatamente uma atividade');
  assert.ok(String(atacar.titulo||'').includes(atacar.alvo),`a atividade criada deve ser do assunto do cartao (${atacar.titulo})`);
  assert.equal(atacar.alvoQ,atacar.dose,`a meta da atividade deve ser a dose do motor (${atacar.dose} q), nao um padrao do Plano legado`);
  assert.equal(atacar.motor,'plano-robusto','a atividade deve nascer com a procedencia do motor gravada');
  assert.ok(['pre','pos'].includes(atacar.fase),'a fase do motor deve ser gravada junto');
  assert.ok(atacar.temScore,'o score do motor deve ser gravado junto');
  assert.ok(!atacar.nomesDepois.includes(atacar.alvo),'depois de atacar, o quadro deve apontar o PROXIMO alvo (o atacado sai da lista)');

  /* ALINHAMENTO POR ESTRUTURA. O recuo de 49px a mao (repetido em seis regras,
     com valor diferente por faixa de tela) deixava cada bloco novo do cartao
     fora do prumo: explicador e acao comecavam na borda enquanto titulo,
     metricas e contexto comecavam 49px adentro. */
  const prumos=await page.evaluate(()=>{
    const m=document.querySelector('#plano-lista .tpm-rec .tpm-main');
    return [...m.children].map(c=>Math.round(c.getBoundingClientRect().left));
  });
  assert.ok(prumos.length>=4,`o cartao deve ter os blocos de conteudo (recebeu ${prumos.length})`);
  assert.equal(new Set(prumos).size,1,`todo bloco do cartao deve comecar no mesmo prumo, recebeu ${JSON.stringify(prumos)}`);

  const tab=page.locator('.tec-subtab[data-tectab="plano"]');
  await page.evaluate(()=>PlanoMotoresGovernanca.salvar({robusto:false,simplificado:true}));await page.evaluate(()=>{DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');});assert.equal(await tab.isVisible(),true,'Plano deve continuar disponível com apenas Simplificado');assert.equal(await page.locator('[data-tpm-source="robusto"]').count(),0);assert.equal(await page.locator('[data-tpm-output]').getAttribute('data-tpm-model'),'simplificado');assert.match(await page.locator('[data-tpm-panorama]').textContent(),/Panorama TEC \+ Simplificado/i,'1 motor deve mostrar panorama específico do Simplificado');assert.equal(await hero.isVisible(),false,'1 motor ativo ainda deve ocultar o card legado');
  await page.evaluate(()=>PlanoMotoresGovernanca.salvar({robusto:true,simplificado:false}));await page.evaluate(()=>{DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');});assert.equal(await tab.isVisible(),true,'Plano deve continuar disponível com apenas Robusto');assert.equal(await page.locator('[data-tpm-source="simplificado"]').count(),0);assert.equal(await page.locator('[data-tpm-output]').getAttribute('data-tpm-model'),'robusto');assert.match(await page.locator('[data-tpm-panorama]').textContent(),/Panorama TEC \+ Robusto/i,'1 motor deve mostrar panorama específico do Robusto');assert.equal(await hero.isVisible(),false,'1 motor ativo ainda deve ocultar o card legado');
  await page.evaluate(()=>PlanoMotoresGovernanca.salvar({robusto:false,simplificado:false}));await page.evaluate(()=>DesempenhoTecScreen.render());await page.evaluate(()=>UXHierarchy.decorateTec());assert.equal(await tab.isVisible(),true,'sem motores o Plano legado deve voltar');assert.equal(await page.locator('[data-tpm-entry]').count(),0,'sem motores não deve existir seletor de fonte');assert.equal(await page.locator('[data-tpm-panorama]').count(),0,'sem motores não deve existir panorama dos motores');assert.equal(await hero.isVisible(),true,'com 0 motores o panorama legado deve voltar mesmo após reaplicar a hierarquia de UX');
  await page.evaluate(()=>{PlanoMotoresGovernanca.restaurar();TecPlanoFonteMotor.salvar('robusto');DesempenhoTecScreen.render();DesempenhoTecScreen.switchTecTab('plano');});
  await page.setViewportSize({width:360,height:640});assert.ok(await overflow('#tec-panel-plano')<=4,'seletor/recomendação deve caber em 360px');assert.ok(await overflow('[data-tpm-entry]')<=4,'seletor de abertura deve caber em 360px');assert.ok(await overflow('[data-tpm-ranking]')<=4,'ranking completo deve caber em 360px');assert.ok(await overflow('[data-tpm-panorama]')<=4,'panorama dos motores deve caber em 360px');assert.deepEqual(errors,[],`erros no navegador: ${errors.join(' | ')}`);
  console.log('OK: Desempenho TEC — panorama 0/1/2 motores + TOP 3 prescritivo + ranking completo paginado de 10 em 10, sem reativar o PlanoEngine legado.');
}finally{await browser.close();await new Promise(r=>server.close(r));}