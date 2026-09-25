/* Registrar, Ciclo, Grade e Estudo Novo: regressões da auditoria visual. */
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
const page=await browser.newPage({viewport:{width:412,height:900}});
const erros=[];page.on('pageerror',e=>erros.push(e.message));
let n=0;const ok=(v,m)=>{n++;assert.ok(v,m);};
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&window.RegistrarScreen&&window.GradeScreen,{timeout:30000});
  const r=await page.evaluate(async()=>{
    try{ProfileUI.hideGate();}catch(_){}
    const out={};
    const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    DB.upsertSubjectName('Direito Civil');
    const metodo=(DB.getActiveMethods()[0]||{}).nome||'Questões';
    DB.saveEntry({id:'t1',date:iso(new Date()),subject:'Direito Civil',method:metodo,durationMin:60,createdAt:new Date().toISOString()});
    // registros do plano ativo aparecem mesmo sem o plano na lista de planejamentos
    out.tagged=DB.getAllEntriesTagged().length;
    switchScreen('registrar');RegistrarScreen.refreshFromRelationalStore();
    out.cards=document.querySelectorAll('#recent-list .entry, #recent-list [data-id], #recent-list article').length||document.getElementById('recent-list').children.length;
    out.planBadge=document.querySelectorAll('#recent-list .badge-plan').length;
    // paginação: 150 registros → 60 na tela, "Mostrar mais" soma mais 60
    for(let i=0;i<149;i++)DB.saveEntry({id:'p'+i,date:iso(new Date()),subject:'Direito Civil',method:metodo,durationMin:30,createdAt:new Date().toISOString()});
    RegistrarScreen.renderRecent();
    out.pag1=document.querySelectorAll('#recent-list .recent-item').length;
    document.querySelector('#recent-list .recent-more-btn').click();
    out.pag2=document.querySelectorAll('#recent-list .recent-item').length;
    const t0=performance.now();RegistrarScreen.renderRecent();out.renderMs=performance.now()-t0;
    // ciclo sem dificuldade/fase (vindo do Motor ou de outro plano)
    const h=new Date(),ini=new Date(h.getFullYear(),h.getMonth(),h.getDate()-((h.getDay()+6)%7)),fim=new Date(ini.getFullYear(),ini.getMonth(),ini.getDate()+6);
    DB.saveCurrentCycle({startDate:iso(ini),endDate:iso(fim),weeklyHours:2,subjects:[{nome:'Direito Civil',definidoMin:120,sugeridoMin:120}],grade:{},sessions:1});
    switchScreen('ciclo');await new Promise(r=>setTimeout(r,200));
    out.undef=/undefined/i.test(document.getElementById('screen-ciclo').innerText);
    document.getElementById('btn-edit-cycle').click();await new Promise(r=>setTimeout(r,200));
    out.undefRev=/undefined/i.test(document.getElementById('screen-ciclo').innerText);
    // grade: rótulo curto da sessão e cabeçalho sem quebra
    switchScreen('grade');await new Promise(r=>setTimeout(r,200));
    out.gsn=!!document.querySelector('#ciclo-grade .gs-n');
    const th=document.querySelector('#ciclo-grade .grade-table thead th');
    out.thAltura=th?th.getBoundingClientRect().height:0;
    // estudo novo: campo da nova aula não pode ficar espremido
    switchScreen('estudonovo');await new Promise(r=>setTimeout(r,100));
    const it=document.querySelector('.en-subject-item[data-subject="Direito Civil"]');if(it)it.click();
    await new Promise(r=>setTimeout(r,200));
    const inp=document.getElementById('en-new-lesson-input');
    out.inputLarg=inp?inp.getBoundingClientRect().width:0;
    return out;
  });
  ok(r.tagged===1,'registro do planejamento ativo entra nas leituras consolidadas');
  ok(r.cards>=1,'"Todos os registros" lista o registro');
  ok(r.planBadge===0,'selo do planejamento some quando há um só planejamento');
  ok(r.pag1===60&&r.pag2===120,'lista paginada: 60 e depois 120 ('+r.pag1+'/'+r.pag2+')');
  ok(r.renderMs<500,'lista renderiza rápido ('+Math.round(r.renderMs)+'ms)');
  ok(!r.undef&&!r.undefRev,'Ciclo não mostra "dificuldade undefined"');
  ok(r.gsn,'coluna da sessão com rótulo curto no celular');
  ok(r.thAltura>0&&r.thAltura<48,'cabeçalho "Sessão" em uma linha ('+r.thAltura+'px)');
  ok(r.inputLarg>=200,'campo "Nome da aula" com largura útil ('+Math.round(r.inputLarg)+'px)');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`TELAS DE ESTUDO (NAVEGADOR) OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
