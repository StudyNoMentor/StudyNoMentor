/* "✨ Sugerir grade" no app real + sessões da grade preenchidas pelos
   registros de estudo da semana. */
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
  await page.waitForFunction(()=>window.switchScreen&&window.GradeGerador&&window.GradeGerador.abrir&&window.GradeScreen&&GradeScreen.progresso,{timeout:30000});
  const r=await page.evaluate(async()=>{
    try{ProfileUI.hideGate();}catch(_){}
    const M=[['Direito Tributário',180],['Contabilidade Geral',120],['Direito Civil',60],['Estatística Básica',60]];
    M.forEach(([x])=>DB.upsertSubjectName(x));
    const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const h=new Date(),ini=new Date(h.getFullYear(),h.getMonth(),h.getDate()-((h.getDay()+6)%7)),fim=new Date(ini.getFullYear(),ini.getMonth(),ini.getDate()+6);
    DB.saveCurrentCycle({startDate:iso(ini),endDate:iso(fim),weeklyHours:7,mode:'pre',subjects:M.map(([nome,m])=>({nome,definidoMin:m,sugeridoMin:m})),grade:{},sessions:3});
    // grade anterior: deve ir para "Grades salvas" ao aplicar
    DB.saveGradeTemplate({grade:{Segunda:[{subject:'Direito Civil',minutes:60,done:false}]},sessions:1});
    switchScreen('grade');
    const out={};
    // ⚙ Opções → Prioridades e cálculo: nada vem marcado sozinho
    document.getElementById('grade-gear-btn').click();
    document.getElementById('btn-grade-prioridades').click();
    await new Promise(r=>setTimeout(r,100));
    const gp=document.getElementById('grade-prioridades-modal');
    out.gpAberto=getComputedStyle(gp).display!=='none';
    out.gpInicial=[...gp.querySelectorAll('[data-gp-calc],[data-gp-pri]')].some(x=>x.checked);
    document.getElementById('gp-sugerir-calc').click();
    out.gpSugestao=[...gp.querySelectorAll('[data-gp-calc]')].map(x=>x.checked);
    const pDT=gp.querySelector('[data-gp-pri="0"]');pDT.checked=true;pDT.dispatchEvent(new Event('change',{bubbles:true}));
    out.gpResumo=document.getElementById('gp-resumo').textContent;
    document.getElementById('gp-ok').click();
    document.getElementById('btn-grade-sugerir').click();
    await new Promise(r=>setTimeout(r,100));
    out.aberto=getComputedStyle(document.getElementById('grade-gerador-modal')).display!=='none';
    out.materias=document.querySelectorAll('#gg-mats .gg-mat').length;
    out.calcPalpite=[...document.querySelectorAll('[data-mat-calc]')].map(x=>x.checked);
    out.priHerdada=document.querySelector('[data-mat-pri="0"]').checked;
    out.prev=document.querySelectorAll('#gg-prev .gg-cel').length;
    out.overflow=document.querySelector('#grade-gerador-modal .siglas-modal-box').scrollWidth-document.querySelector('#grade-gerador-modal .siglas-modal-box').clientWidth;
    UI.confirm=()=>Promise.resolve(true);
    const salvasAntes=DB.getSavedGrades().length;
    document.getElementById('gg-aplicar').click();
    await new Promise(r=>setTimeout(r,200));
    const t=DB.getGradeTemplate(),cel=[];
    Object.keys(t.grade).forEach(d=>(t.grade[d]||[]).forEach((c,i)=>{if(c)cel.push({d,i,s:c.subject,m:c.minutes});}));
    out.celulas=cel;out.salvas=DB.getSavedGrades().length-salvasAntes;
    out.primeiroDT=cel.filter(c=>c.s==='Direito Tributário').every(c=>c.i===0);
    out.prefs=!!localStorage.getItem(DB._profilePrefix()+'p:'+DB._activePlanId()+':grade-gerador');
    // registros da semana preenchem a grade
    const dt=cel.filter(c=>c.s==='Direito Tributário');
    DB.saveEntry({id:'e1',date:iso(ini),subject:'Direito Tributário',durationMin:90,method:'Teoria'});
    GradeScreen.render();await new Promise(r=>setTimeout(r,100));
    const p=GradeScreen.progresso().mapa;
    out.prog=dt.map(c=>p[c.d+'|'+c.i]);
    const chips=[...document.querySelectorAll('.grade-cell-drop .subject-chip[data-subject="Direito Tributário"]')];
    out.autoDone=chips.filter(x=>x.classList.contains('auto-done')).length;
    out.parcial=chips.filter(x=>x.classList.contains('parcial')).length;
    // atalho: registrar a partir da sessão
    GradeScreen.registrarSessao('Contabilidade Geral',60);
    await new Promise(r=>setTimeout(r,300));
    out.reg={s:(document.getElementById('subject')||{}).value,h:(document.getElementById('duration-h')||{}).value,m:(document.getElementById('duration-m')||{}).value};
    return out;
  });
  ok(r.aberto,'janela abre pelo botão ✨ Sugerir grade');
  ok(r.materias===4,'lista as matérias do ciclo');
  ok(r.gpAberto,'Prioridades e cálculo abre pelo menu ⚙ Opções');
  ok(!r.gpInicial,'nenhuma matéria vem marcada sozinha (vale para qualquer área)');
  ok(r.gpSugestao.join()==='false,true,false,true','"Sugerir pelo nome" marca as prováveis de cálculo');
  ok(r.gpResumo.startsWith('1 prioritária')&&r.gpResumo.includes('2 de cálculo'),'resumo das marcações');
  ok(r.priHerdada&&r.calcPalpite.join()==='false,true,false,true','Sugerir grade usa as marcações das Opções');
  ok(r.prev===7,'prévia com 7 sessões (3+2+1+1)');
  ok(r.overflow<=1,'janela sem rolagem horizontal no celular');
  ok(r.celulas.length===7&&r.celulas.every(c=>c.m===60),'grade aplicada com sessões de 60 min');
  ok(r.salvas===1,'grade anterior guardada em Grades salvas');
  ok(r.primeiroDT,'prioritária no primeiro horário');
  ok(r.prefs,'preferências da janela lembradas por planejamento');
  ok(r.prog.filter(x=>x.completo).length===1&&r.prog.some(x=>x.feito===30),'90 min registrados = 1 sessão completa + 30/60 na seguinte');
  ok(r.autoDone===1&&r.parcial===1,'chips mostram concluída pelos registros e parcial');
  ok(r.reg.s==='Contabilidade Geral'&&r.reg.h==='1'&&r.reg.m==='0','Registrar estudo aberto já preenchido');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`GRADE GERADOR (NAVEGADOR) OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
