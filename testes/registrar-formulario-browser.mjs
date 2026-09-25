/* Registrar — formulário repaginado: os atalhos de toque escrevem nos MESMOS
   campos de sempre (a lógica de salvar não muda), páginas/observações abrem
   sob demanda no Compacto, o resumo acompanha o que será gravado, nada estoura
   a largura do cartão e, no celular, o botão Registrar fica sempre à mão. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer((req,res)=>{const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end('nao encontrado');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
let n=0;const ok=(v,m)=>{n++;assert.ok(v,m);};
const url=`http://127.0.0.1:${server.address().port}/index.html`;

async function preparar(page){
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&window.RegistrarScreen&&window.ProfileUI,{timeout:30000});
  await page.evaluate(()=>{
    try{ProfileUI.hideGate();}catch(_){}
    DB.saveSubjects([{id:'s1',nome:'Direito Constitucional',ativo:true},{id:'s2',nome:'Reforma Tributária',ativo:true},{id:'s3',nome:'AFO',ativo:true}]);
    DB.saveEntry({id:'r-afo',date:'2026-09-20',subject:'AFO',method:'Questões',durationMin:30,createdAt:'2026-09-20T10:00:00Z'});
    DB.saveEntry({id:'r-const',date:'2026-09-21',subject:'Direito Constitucional',method:'Questões',durationMin:30,createdAt:'2026-09-21T10:00:00Z'});
    RegistrarScreen.refreshFromRelationalStore();
    switchScreen('registrar');
    document.querySelector('#reg-mode-seg [data-m="compacto"]').click();
  });
}

try{
  // ── Desktop ──────────────────────────────────────────────────────────────
  const desk=await browser.newPage({viewport:{width:1366,height:1000}});
  const erros=[];desk.on('pageerror',e=>erros.push(e.message));
  await preparar(desk);
  const r=await desk.evaluate(async()=>{
    const w=ms=>new Promise(r=>setTimeout(r,ms)),$=s=>document.querySelector(s),out={};
    out.recentes=[...document.querySelectorAll('.reg-recentes [data-materia]')].map(b=>b.dataset.materia);
    $('.reg-recentes [data-materia="AFO"]').click();
    out.materia=$('#subject').value;
    const metodos=[...document.querySelectorAll('.reg-metodos [data-metodo]')];
    out.metodosIguais=metodos.map(b=>b.dataset.metodo).join('|')===[...$('#method').options].map(o=>o.value).join('|');
    const video=metodos.find(b=>/v[ií]deo|aula/i.test(b.dataset.metodo));
    video.click();
    out.metodo=$('#method').value===video.dataset.metodo;
    out.videoAbriu=getComputedStyle($('#video-fields')).display!=='none';
    metodos.find(b=>/quest/i.test(b.dataset.metodo)).click();
    out.questoesMarcada=$('.reg-metodos .on')&&/quest/i.test($('.reg-metodos .on').dataset.metodo);
    $('.reg-data-linha [data-dia="-1"]').click();
    const d=new Date();d.setDate(d.getDate()-1);
    out.ontem=$('#date').value===`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    $('.reg-data-linha [data-dia="0"]').click();
    out.hoje=$('#date').value===todayLocal();
    $('.reg-tempo-rapido [data-soma="60"]').click();
    $('.reg-tempo-rapido [data-soma="30"]').click();
    $('.reg-tempo-rapido [data-soma="15"]').click();
    out.tempo=[$('#duration-h').value,$('#duration-m').value];
    const c=$('#correct');c.value='18';c.dispatchEvent(new Event('input',{bubbles:true}));
    const t=$('#total');t.value='24';t.dispatchEvent(new Event('input',{bubbles:true}));
    $('#lesson').value='Créditos adicionais';
    out.resumo=$('.reg-resumo').textContent;
    out.paginasOcultas=getComputedStyle($('.reg-f-pini')).display==='none'&&getComputedStyle($('.reg-f-obs')).display==='none';
    $('.reg-extras [data-abrir="paginas"]').click();
    out.paginasAbertas=getComputedStyle($('.reg-f-pini')).display!=='none'&&document.activeElement===$('#page-start');
    // nada passa da largura do cartão
    const card=$('#screen-registrar > .card').getBoundingClientRect();
    out.estouros=[...document.querySelectorAll('#study-form *')].filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&(b.right>card.right+0.5||b.left<card.left-0.5);}).map(el=>el.id||el.className).slice(0,5);
    const perf=$('.reg-f-desemp').getBoundingClientRect();
    out.perfDentro=[...document.querySelectorAll('.reg-f-desemp input, .reg-f-desemp .gauge')].every(el=>{const b=el.getBoundingClientRect();return b.left>=perf.left-0.5&&b.right<=perf.right+0.5;});
    // grava pelo fluxo de sempre; a confirmação do banco é simulada aqui
    // (a persistência real é coberta por auditoria-correcoes-browser.mjs)
    SaveGuard.run=async({escrever,verificar})=>{const r=escrever();return {ok:r!==false&&verificar(),cloud:true};};
    const antes=DB.getEntries().length;
    $('#submit-btn').click();
    for(let i=0;i<40&&DB.getEntries().length===antes;i++)await w(50);
    for(let i=0;i<60&&$('#subject').value;i++)await w(50);
    const novo=DB.getEntries().find(e=>e.lesson==='Créditos adicionais');
    out.gravado=novo&&{subject:novo.subject,method:novo.method,durationMin:novo.durationMin,correct:novo.correct,total:novo.total};
    out.resetou=!$('#subject').value&&!$('#duration-h').value&&getComputedStyle($('.reg-f-pini')).display==='none';
    out.recentesDepois=[...document.querySelectorAll('.reg-recentes [data-materia]')].map(b=>b.dataset.materia)[0];
    // Guiado continua com a trilha numerada
    document.querySelector('#reg-mode-seg [data-m="guiado"]').click();
    out.guiadoTrilha=getComputedStyle($('#step-1 .step-num')).display!=='none'&&getComputedStyle($('#step-5')).display!=='none';
    return out;
  });
  ok(JSON.stringify(r.recentes)===JSON.stringify(['Direito Constitucional','AFO']),'matérias recentes do planejamento, mais nova primeiro: '+JSON.stringify(r.recentes));
  ok(r.materia==='AFO','tocar numa matéria recente preenche o seletor');
  ok(r.metodosIguais,'as pílulas mostram exatamente as formas de estudo cadastradas');
  ok(r.metodo&&r.videoAbriu,'pílula de vídeo seleciona o método e abre os campos de vídeo');
  ok(r.questoesMarcada,'a pílula selecionada acompanha o método');
  ok(r.ontem&&r.hoje,'Hoje/Ontem preenchem a data local');
  ok(JSON.stringify(r.tempo)===JSON.stringify(['1','45']),'atalhos somam o tempo com virada de hora: '+JSON.stringify(r.tempo));
  ok(r.resumo==='1h45 · AFO · Questões · 18/24','resumo acompanha o registro: '+r.resumo);
  ok(r.paginasOcultas&&r.paginasAbertas,'páginas e observações só aparecem quando pedidas');
  ok(r.estouros.length===0,'nenhum elemento do formulário passa da largura do cartão: '+JSON.stringify(r.estouros));
  ok(r.perfDentro,'acertos, total e o anel ficam dentro do painel de desempenho');
  ok(r.gravado&&r.gravado.subject==='AFO'&&/quest/i.test(r.gravado.method)&&r.gravado.durationMin===105&&r.gravado.correct===18&&r.gravado.total===24,'o registro é gravado com os valores dos atalhos: '+JSON.stringify(r.gravado));
  ok(r.resetou,'depois de gravar, o formulário volta ao início e recolhe as páginas');
  ok(r.recentesDepois==='AFO','a matéria recém-registrada sobe nas recentes');
  ok(r.guiadoTrilha,'o modo Guiado mantém a trilha numerada');
  ok(erros.length===0,'desktop sem erros de página: '+erros.join(' | '));
  await desk.close();

  // ── Celular ──────────────────────────────────────────────────────────────
  const mob=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errosMob=[];mob.on('pageerror',e=>errosMob.push(e.message));
  await preparar(mob);
  const m=await mob.evaluate(async()=>{
    const $=s=>document.querySelector(s);
    window.scrollTo(0,0);await new Promise(r=>setTimeout(r,200));
    const btn=$('#submit-btn').getBoundingClientRect(),tabs=$('.tabs').getBoundingClientRect();
    const larg=document.documentElement.scrollWidth<=window.innerWidth+1;
    return {botaoVisivel:btn.top>=0&&btn.bottom<=tabs.top+1,larg};
  });
  ok(m.botaoVisivel,'no celular o botão Registrar fica visível logo acima da barra de abas, sem rolar');
  ok(m.larg,'no celular nada gera rolagem horizontal');
  ok(errosMob.length===0,'celular sem erros de página: '+errosMob.join(' | '));
  await mob.close();
  console.log(`REGISTRAR — FORMULÁRIO (NAVEGADOR) OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
