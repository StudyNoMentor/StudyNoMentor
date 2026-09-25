/* Pausa por período: meta do ciclo, sequência de dias e aviso no topo. */
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
const page=await browser.newPage({viewport:{width:412,height:900},isMobile:true,hasTouch:true});
const erros=[];page.on('pageerror',e=>erros.push(e.message));
let n=0;const ok=(v,m)=>{n++;assert.ok(v,m);};
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&window.RegistrarScreen,{timeout:30000});
  const r=await page.evaluate(async()=>{
    try{ProfileUI.hideGate();}catch(_){}
    const w=ms=>new Promise(r=>setTimeout(r,ms)),out={};
    const dia=o=>{const d=new Date();d.setDate(d.getDate()+o);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    // Outro planejamento garante a cobertura exigida para pausar o atual.
    const atual=PlanManager.createPlan({nome:'Concurso com nome bem longo para testar quebra',tipo:'Pós-edital'});
    PlanManager.createPlan({nome:'Reserva',tipo:'Pré-edital'});
    PlanManager.setActivePlan(atual);
    [-6,-5,-4,0].forEach(o=>DB.saveEntry({id:'e'+o,date:dia(o),subject:'Português',durationMin:60}));
    // Sem pausa: -3..-1 vazios quebram a sequência.
    switchScreen('conquistas');await w(400);
    const seq=()=>[...document.querySelectorAll('#conquistas-body .conq-mini')].map(x=>x.innerText.replace(/\s+/g,' ').trim());
    out.antes=seq();
    out.metaSem=CycleEngine.progressoSemana([{nome:'Português',definidoMin:700}],dia(-6),dia(0)).totalTargetMin;
    // Pausa retroativa de -3 a hoje (retorno hoje): três dias congelados.
    out.pausa=PlanManager.pausePlan(atual,{from:dia(-3),until:dia(0)});
    out.ativo=PlanManager.getActivePlanId()===atual;
    switchScreen('conquistas');await w(400);
    out.depois=seq();
    const prog=CycleEngine.progressoSemana([{nome:'Português',definidoMin:700}],dia(-6),dia(0));
    out.metaCom=prog.totalTargetMin;out.fator=prog.fatorPausa;
    out.aviso0=!!document.getElementById('pausa-aviso');
    // Pausa agendada em 3 dias: aviso aparece fora de Planejamentos e leva até lá.
    out.agenda=PlanManager.pausePlan(atual,{from:dia(3),until:dia(6)});
    switchScreen('registrar');await w(200);
    const av=document.getElementById('pausa-aviso');
    out.aviso=av?av.innerText.replace(/\s+/g,' '):'';
    const b=av&&av.getBoundingClientRect();out.largura=b?Math.round(b.right):0;
    av&&av.querySelector('.pa-btn').click();await w(300);
    out.tela=document.querySelector('.screen.active').id;
    out.avisoEmPlan=!!document.getElementById('pausa-aviso');
    PlanManager.resumePlan(atual,{from:dia(3)});
    switchScreen('registrar');await w(200);
    out.avisoCancelado=!!document.getElementById('pausa-aviso');
    return out;
  });
  const val=(l,k)=>((l.find(x=>x.includes(k))||'').match(/^(\d+)/)||[])[1];
  ok(r.pausa.ok,'pausa retroativa aceita: '+JSON.stringify(r.pausa));
  ok(r.ativo,'retorno hoje mantém o planejamento em uso');
  ok(val(r.antes,'sequência atual')==='1','sem pausa a sequência atual é 1 ('+r.antes.join(' / ')+')');
  ok(val(r.depois,'sequência atual')==='4','dias pausados não quebram a sequência ('+r.depois.join(' / ')+')');
  ok(val(r.depois,'maior sequência')==='4','maior sequência atravessa a pausa');
  ok(r.metaSem===700&&r.metaCom===400,'meta semanal vale só pelos dias ativos ('+r.metaSem+' → '+r.metaCom+')');
  ok(Math.abs(r.fator-4/7)<1e-9,'fator de pausa 4/7');
  ok(!r.aviso0,'sem pausa vigente nem próxima, sem aviso');
  ok(r.agenda.ok&&r.agenda.scheduled,'pausa agendada aceita');
  ok(/Pausa agendada em 3 dias/.test(r.aviso),'aviso da pausa agendada ('+r.aviso+')');
  ok(r.largura<=412,'aviso cabe na largura do celular');
  ok(r.tela==='screen-planejamentos'&&!r.avisoEmPlan,'"Gerenciar" abre Planejamentos, sem aviso repetido lá');
  ok(!r.avisoCancelado,'cancelar a pausa agendada remove o aviso');
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`PAUSA NAS MÉTRICAS (NAVEGADOR) OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
