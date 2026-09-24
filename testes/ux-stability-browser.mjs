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
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[];let checks=0;
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text());});
const ok=(v,m)=>{checks++;assert.ok(v,m)};const eq=(a,b,m)=>{checks++;assert.equal(a,b,m)};

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&window.ExtrasScreen&&window.UXStability&&window.ExtrasModern,{timeout:30000});
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

  /* ── A FILEIRA DE ACOES NAO PODE CASCATEAR ─────────────────────────────
     Tres camadas de CSS disputavam esta barra e a decoracao ainda embrulhava
     os botoes num <div> extra — as regras de largura miravam o involucro e os
     cinco botoes desciam um por linha, cada um com altura propria. Foi esse o
     "deixou os botoes cascateados, feio e sem alinhamento".

     O que este caso trava: nenhum involucro entre a fileira e os botoes, todos
     com a MESMA altura, e no desktop uma linha so. */
  const medirFileira=()=>page.evaluate(()=>{
    const bar=document.querySelector('#screen-extras .extras-toolbar');
    const acts=bar&&bar.querySelector('.uxv3-toolbar-actions');
    /* Botao escondido pela preferencia (💡 Sugerir nasce desligado) nao tem
       caixa: medir a altura dele contaria um zero como "outra altura". */
    const bts=acts?[...acts.querySelectorAll(':scope > button')].filter(b=>b.offsetParent!==null):[];
    return {temFileira:!!acts,n:bts.length,
      aninhados:acts?[...acts.children].filter(c=>c.tagName!=='BUTTON').length:null,
      linhas:new Set(bts.map(b=>Math.round(b.getBoundingClientRect().top))).size,
      alturas:new Set(bts.map(b=>Math.round(b.getBoundingClientRect().height))).size,
      larguras:bts.map(b=>Math.round(b.getBoundingClientRect().width)),
      overflow:bar?Math.max(0,bar.scrollWidth-bar.clientWidth):null};
  });
  const fileiraMob=await medirFileira();
  ok(fileiraMob.temFileira,'a barra de Extras deve ter a fileira de acoes');
  ok(fileiraMob.n>=3,`a fileira deve conter os botoes de acao (recebeu ${fileiraMob.n})`);
  eq(fileiraMob.aninhados,0,'a fileira nao pode ter involucro entre ela e os botoes');
  eq(fileiraMob.alturas,1,`os botoes devem ter a mesma altura (recebeu ${fileiraMob.alturas} alturas)`);
  ok(fileiraMob.linhas<fileiraMob.n,`em 390px os botoes nao podem descer um por linha (${fileiraMob.linhas} linhas para ${fileiraMob.n} botoes)`);
  eq(fileiraMob.overflow,0,'a barra de Extras nao pode transbordar na horizontal');
  /* A fileira tem quatro botões e nenhuma preferência para escondê-los: o
     antigo 💡 Sugerir saiu com o segundo motor que o alimentava, e com ele a
     caixa de "mostrar o botão" que só existia para negociar a duplicata. */
  await page.setViewportSize({width:1280,height:900});
  await page.waitForTimeout(140);
  const fileiraDesk=await medirFileira();
  eq(fileiraDesk.linhas,1,`no desktop os botoes devem caber numa linha (recebeu ${fileiraDesk.linhas})`);
  eq(new Set(fileiraDesk.larguras||[0]).size,1,'no desktop os botoes devem ter a mesma largura');
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(140);
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
    UXStability.decorateLawList();const h=host.querySelector('.lr-law-wrap'),out={in:h.textContent.includes('Incluída nos Extras automáticos'),next:h.textContent.includes('Linha 31'),sub:h.textContent.includes('Pode gerar a leitura do dia')};
    DB.getLei=oldGet;LeiRodizio.cfgLei=oldCfg;LeiRodizio.prefs=oldPrefs;LeiRodizio._bookmark=oldBm;host.remove();return out;
  });
  ok(lawStatus.in&&lawStatus.next&&lawStatus.sub,'estado do rodízio deve explicar inclusão e próxima leitura');

  /* TEC: escopo fecha na primeira abertura e Central mantém grade legível. */
  await page.evaluate(()=>{UXStability._tecFirstOpen=true;switchScreen('desempenhotec');try{DesempenhoTecScreen.render();}catch(_){}});
  await page.waitForTimeout(160);
  ok(await page.locator('#tec-scope-body').evaluate(el=>el.hidden),'Escopo da análise deve abrir recolhido');
  ok(await page.locator('#screen-desempenhotec .tp-command.uxv3-tec-command').count()===1,'Central TEC deve receber layout v3');
  const tecOverflow=await page.locator('#screen-desempenhotec').evaluate(el=>el.scrollWidth-el.clientWidth);
  ok(tecOverflow<=4,`TEC não deve criar overflow horizontal (${tecOverflow}px)`);

  /* Falha automática de renovação não pode jogar formulário na frente do estudo. */
  const autoCloud=await page.evaluate(async()=>{
    UXStability._cloudUserAt=0;
    const s=document.createElement('div');s.className='cloud-scrim';const m=document.createElement('div');m.className='cloud-menu';
    s.addEventListener('click',()=>{s.remove();m.remove();});document.body.appendChild(s);document.body.appendChild(m);
    await new Promise(r=>setTimeout(r,80));return {menu:document.querySelectorAll('.cloud-menu').length,scrim:document.querySelectorAll('.cloud-scrim').length};
  });
  eq(autoCloud.menu,0,'menu de relogin automático não deve interromper o usuário');
  eq(autoCloud.scrim,0,'scrim automático também deve ser removido');

  /* ── O CARTAO DE REFORCOS EM CURSO ──────────────────────────────────────
     O cabeçalho de Reforços em curso precisa continuar estável mesmo com a receita do Motor — piso de
     ~610px com os vaos. Num telefone de 390px ele transbordava e o titulo saia
     pela esquerda, atras das caixas de missao. Havia correcao numa folha
     posterior, mas presa a uma classe que o JS aplica dois quadros depois: no
     intervalo, e em qualquer repintura que a perdesse, o piso voltava.

     E o rodape do cartao de MODELO tinha o mesmo tipo de defeito ao contrario:
     `flex: 1 1 260px` num container que virava `flex-direction:column` abaixo
     de 720px — ali o 260px deixa de ser largura e vira ALTURA, e uma linha de
     texto abria um vao de 260px antes do botao "Configurar". */
  const curso=await page.evaluate(()=>{
    DB.saveSubjects([{id:'uxc1',nome:'Economia e Finanças Públicas',ativo:true,peso:1}]);
    const e=DB.addExtra({titulo:'Reforçar: Curvas de Phillips',tipo:'questoes',disciplina:'Economia e Finanças Públicas',
      unidade:'questoes',alvo:10,periodo:'unica',contaMetricas:false});
    DB.updateExtra(e.id,{origemMotor:{motor:'sugestao',versao:3,topico:'Curvas de Phillips',
      disciplina:'Economia e Finanças Públicas',criadoEm:todayLocal(),taxaInicial:44,qBase:16,
      metaAlvo:90,alvoQuestoes:10,nivel:1,caminho:[],membros:null,
      escopo:{tipo:'no',membros:['Curvas de Phillips']},fase:'pre',minAmostra:20,
      filtroTec:{versao:1,disciplina:'Economia e Finanças Públicas',nivel:1,tipo:'no',agregado:false,
        caminho:[],selecoes:['Curvas de Phillips'],trilha:['Economia e Finanças Públicas','Curvas de Phillips'],quantidade:10}}});
    /* Este caso mede somente layout. O Motor real exige retrato TEC atual para
       calcular emCurso(); a suíte visual não importa retratos. Mantemos uma
       atividade real do Motor e isolamos apenas a leitura dinâmica do retrato. */
    const emCursoReal=MotorCiclo.emCurso;
    MotorCiclo.emCurso=()=>[{
      extra:DB.getExtra(e.id),origem:DB.getExtra(e.id).origemMotor,atual:null,disciplinaAtual:null,
      rank:1,lacunaDisc:46,noGrupo:true,novoRetrato:false,alvo:10,feito:0,falta:10,pct:0,
      taxa:44,meta:90,delta:0,estado:'andamento'
    }];
    switchScreen('extras');ExtrasScreen.render();
    try{UXStability.decorateCourse();}catch(_){}
    const card=document.getElementById('extras-curso');
    const head=card&&card.querySelector('.exc-head');
    const tit=head&&head.querySelector('.exc-tit');
    const res=head&&head.querySelector('.exc-resumo');
    const chev=head&&head.querySelector('.chev');
    const cruza=(a,b)=>{if(!a||!b)return false;const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
      return !(x.right<=y.left+.5||y.right<=x.left+.5||x.bottom<=y.top+.5||y.bottom<=x.top+.5);};
    const out={temCabecalho:!!head,
      transbordaCartao:card?Math.max(0,card.scrollWidth-card.clientWidth):null,
      transbordaCabecalho:head?Math.max(0,head.scrollWidth-head.clientWidth):null,
      tituloForaDaTela:tit?tit.getBoundingClientRect().x< -0.5:null,
      tituloXresumo:cruza(tit,res),tituloXchev:cruza(tit,chev),resumoXchev:cruza(res,chev)};
    MotorCiclo.emCurso=emCursoReal;
    return out;
  });
  ok(curso.temCabecalho,'o cartao de reforcos em curso deve existir');
  eq(curso.transbordaCartao,0,'o cartao de reforcos nao pode transbordar na horizontal');
  eq(curso.transbordaCabecalho,0,'o cabecalho do cartao nao pode transbordar');
  eq(curso.tituloForaDaTela,false,'o titulo "Reforcos em curso" nao pode ser empurrado para fora da tela');
  ok(!curso.tituloXresumo&&!curso.tituloXchev&&!curso.resumoXchev,
    `nada no cabecalho pode se sobrepor: ${JSON.stringify(curso)}`);

  /* ── OS CARTOES DA LISTA DE LEIS SECAS ──────────────────────────────────
     A acao do cartao passou a NOMEAR o que faz ("Começar / Continuar / Reler"
     + a linha), mas a forma antiga dela — um disco de 34x34 com um "→" dentro
     — continuava valendo em 07-ux-layout.css. Tres filhos empurrados para
     dentro de 34px: na tela lia-se "meçar linha 1", com o inicio do rotulo
     cortado fora da caixa. Era esse o "bug visual" da lei seca.

     O que este caso trava: a acao cabe no que ela mostra, tem a mesma largura
     nos tres estados (as caixas terminam no mesmo prumo em toda a lista) e a
     faixa de estado a esquerda continua pintada tambem dentro do involucro do
     rodizio, onde `border:0!important` a apagava. */
  const leis=await page.evaluate(()=>{
    DB.saveLeis([
      {id:'ux-l1',titulo:'Lei 8.112/1990 — Regime Juridico',referencia:'Lei 8.112/90',materia:'Direito Administrativo',
       texto:Array.from({length:300},(_,i)=>`Art. ${i+1}. Texto ${i+1}.`).join('\n')},
      {id:'ux-l2',titulo:'Constituicao Federal de 1988',referencia:'CF/88',materia:'Direito Constitucional',bookmark:137,
       texto:Array.from({length:600},(_,i)=>`Art. ${i+1}. Disposicao ${i+1}.`).join('\n')},
      {id:'ux-l3',titulo:'Codigo Tributario Nacional',referencia:'Lei 5.172/66',materia:'Direito Tributario',bookmark:599,
       texto:Array.from({length:600},(_,i)=>`Art. ${i+1}. Norma ${i+1}.`).join('\n')}
    ]);
    switchScreen('leis'); LeisScreen.render();
    const cards=[...document.querySelectorAll('#screen-leis .lei-card')];
    return cards.map((c)=>{
      const go=c.querySelector('.lei-card-go'), b=go&&go.querySelector('b');
      const gr=go&&go.getBoundingClientRect(), br=b&&b.getBoundingClientRect(), cs=getComputedStyle(c);
      return {estado:(c.className.match(/is-(nova|lendo|fim)/)||[])[0]||null,
        rotulo:b?(b.textContent||'').trim():null,
        largura:gr?Math.round(gr.width):null,
        cortado: gr&&br? (br.left<gr.left-0.5||br.right>gr.right+0.5||br.bottom>gr.bottom+0.5) : null,
        transbordaAcao: go?Math.max(0,go.scrollWidth-go.clientWidth):null,
        transbordaCartao: Math.max(0,c.scrollWidth-c.clientWidth),
        faixa: cs.borderLeftStyle};
    });
  });
  await page.waitForTimeout(120);
  ok(leis.length>=3,`a lista de leis deve ter os tres cartoes (recebeu ${leis.length})`);
  eq(leis.filter(x=>x.cortado).length,0,`nenhum rotulo de acao pode ficar cortado: ${JSON.stringify(leis)}`);
  eq(leis.filter(x=>x.transbordaAcao>0).length,0,'a caixa de acao nao pode transbordar o proprio conteudo');
  eq(leis.filter(x=>x.transbordaCartao>0).length,0,'o cartao de lei nao pode transbordar na horizontal');
  eq(new Set(leis.map(x=>x.largura)).size,1,`a acao deve ter a mesma largura nos tres estados: ${JSON.stringify(leis.map(x=>x.largura))}`);
  eq(leis.filter(x=>x.faixa==='none').length,0,'a faixa de estado a esquerda do cartao deve estar pintada');
  ok(leis.some(x=>x.rotulo==='Começar')&&leis.some(x=>x.rotulo==='Continuar')&&leis.some(x=>x.rotulo==='Reler'),
    `os tres estados devem nomear a propria acao: ${JSON.stringify(leis.map(x=>x.rotulo))}`);
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();});
  await page.waitForTimeout(160);

  /* Mobile: principais blocos permanecem dentro do viewport. */
  await page.setViewportSize({width:360,height:800});
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();});await page.waitForTimeout(100);
  const ov=await page.locator('#screen-extras').evaluate(el=>el.scrollWidth-el.clientWidth);ok(ov<=4,`Extras mobile sem overflow (${ov}px)`);

  ok(errors.length===0,'sem erros no navegador: '+errors.join(' | '));
  console.log(`UX STABILITY OK — ${checks} invariantes.`);
} finally { await browser.close(); await new Promise(r=>server.close(r)); }