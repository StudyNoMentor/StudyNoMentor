/* Padrão visual global + Evolução, Conquistas, Ferramentas, Configurações: regressões. */
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
    const out={},w=ms=>new Promise(r=>setTimeout(r,ms));
    // "Mais": o véu fica acima do topo (seletor de planejamento)
    switchScreen('ferramentas');await w(100);
    document.querySelector('.nav-more-btn').click();await w(300);
    const zs=id=>parseInt(getComputedStyle(document.querySelector(id)).zIndex)||0;
    out.veu=zs('.nav-scrim');out.plano=zs('#plan-switcher');out.brand=zs('.sidebar-brand');
    document.querySelector('.nav-more-btn').click();await w(200);
    // Configurações: "Navegação" só em Preferências
    switchScreen('config');await w(200);
    const nav=document.getElementById('config-anki-menu-toggle').closest('.card');
    out.navGrupo=nav.closest('.cfg-group')?nav.closest('.cfg-group').id:'fora';
    out.tema=document.getElementById('cfgp-tema').value;
    // matérias: nome e ações na mesma linha
    const head=document.querySelector('#config-subjects-list .csr-head');
    if(head){const n=head.querySelector('.cfg-subj-name').getBoundingClientRect(),a=head.querySelector('.config-row-actions').getBoundingClientRect();out.mesmaLinha=Math.abs((n.top+n.bottom)/2-(a.top+a.bottom)/2)<12;}
    else out.mesmaLinha=true;
    // dicas em Inter
    out.hintFont=getComputedStyle(document.querySelector('.hint')).fontFamily;
    // Evolução: rótulos curtos, nenhuma palavra partida; "Gerar relatório" sem bolha
    switchScreen('evolucao');await w(300);
    const bts=[...document.querySelectorAll('#evo-scope-toggle button')];
    out.escopo=bts.map(b=>b.innerText.trim());
    out.escopoAltura=Math.max(...bts.map(b=>b.getBoundingClientRect().height));
    document.getElementById('study-report-open').click();await w(200);
    const bolha=document.querySelector('.tip-bolha.on');out.bolha=!!bolha;
    document.getElementById('study-report-cancel')?.click();
    // Ferramentas: abas lado a lado
    switchScreen('ferramentas');await w(100);
    const ab=[...document.querySelectorAll('#screen-ferramentas .tool-tab')].map(b=>b.getBoundingClientRect().top);
    out.abasLinha=ab.length===2&&Math.abs(ab[0]-ab[1])<2;
    // títulos das telas sem emoji
    out.titulos=[...document.querySelectorAll('.page-title')].map(h=>h.textContent.trim()).filter(t=>/^\p{Extended_Pictographic}/u.test(t));
    return out;
  });
  ok(r.veu>r.plano&&r.veu>r.brand,'"Mais": escurecimento acima do topo ('+r.veu+' > '+r.plano+'/'+r.brand+')');
  ok(r.navGrupo==='cfg-g-prefs','"Navegação" só em Preferências ('+r.navGrupo+')');
  ok(r.tema==='auto','tema sem escolha salva mostra "Seguir o sistema"');
  ok(r.mesmaLinha,'Configurações > Matérias: nome e ações na mesma linha');
  ok(/Inter/.test(r.hintFont),'dicas em Inter ('+r.hintFont.split(',')[0]+')');
  ok(r.escopo.join('|')==='Este plano|Ativos|Trajetória'&&r.escopoAltura<48,'Evolução: escopo com rótulos curtos, sem quebrar palavra ('+r.escopo.join('|')+')');
  ok(!r.bolha,'tocar em "Gerar relatório" não deixa bolha sobre a janela');
  ok(r.abasLinha,'Ferramentas: abas lado a lado');
  ok(r.titulos.length===0,'títulos das telas sem emoji: '+r.titulos.join(', '));
  ok(erros.length===0,'sem erros de página: '+erros.join(' | '));
  console.log(`PADRÃO VISUAL (NAVEGADOR) OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
