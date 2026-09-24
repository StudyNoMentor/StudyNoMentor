/* Estatísticas dos Cards no celular: uma página só (sem painéis repetidos),
   nada estoura a largura da tela e todo gráfico de série tem barras visíveis
   mesmo com o histórico de 12 meses (agrupamento por dia/semana/mês). */
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
try{
  for(const largura of [360,412,1280]){
    const page=await browser.newPage({viewport:{width:largura,height:900}});
    const erros=[];page.on('pageerror',e=>erros.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.switchScreen&&typeof CardsScreen!=='undefined'&&typeof AnkiMaxStatsMedia!=='undefined',{timeout:30000});
    const r=await page.evaluate(()=>{
      try{ProfileUI.hideGate();}catch(_){}
      const d=DB.addDeck('Estatísticas'),agora=Date.now(),dia=86400000,cards=[],log=[];
      for(let i=0;i<60;i++){
        const c=DB.addCard({deckId:d.id,frente:'Q'+i,verso:'A'+i,kind:'basic'});
        DB.updateCard(c.id,{phase:'review',reps:3,intervalo:1+(i%25),s:1+(i%30),d:1+(i%9),due:CardEngine.addDays(todayCards(),1+(i%14)),lastReview:todayCards()});
        for(let k=0;k<3;k++){const ts=agora-(k*3+i%4)*dia-i*60000;log.push({cardId:c.id,ts,date:new Date(ts).toISOString().slice(0,10),grade:1+((i+k)%4),phase:k?'review':'learning',intervalo:k,elapsed:k,time:8000});}
      }
      DB.replaceRevlog(log);
      switchScreen('cards');CardsScreen.tab='stats';CardsScreen.render();
      const box=document.getElementById('cards-content'),vw=document.documentElement.clientWidth;
      const titulos=[...box.querySelectorAll('.stat-card h2')].map(h=>h.textContent.replace(/[^\p{L}\s()]/gu,'').trim());
      const estouro=[...box.querySelectorAll('*')].filter(el=>{const b=el.getBoundingClientRect();return b.width&&b.right>vw+1;}).map(el=>el.className);
      const barras=[...box.querySelectorAll('.anki-ts-bar')].map(b=>b.getBoundingClientRect()).filter(b=>b.height>0);
      const cal=box.querySelector('.anki-calendar-grid').getBoundingClientRect(),card=box.querySelector('.anki-max-calendar').getBoundingClientRect();
      // Todo conteúdo de gráfico/tabela fica recuado da borda do card.
      const colados=[...box.querySelectorAll('.stat-card .stat-body > *')].filter(el=>{const p=el.closest('.stat-card').getBoundingClientRect(),c=el.getBoundingClientRect();return c.width&&(c.left-p.left<8||p.right-c.right<8);}).length;
      return {titulos,estouro,scroll:document.documentElement.scrollWidth-vw,barrasLargura:Math.min(...barras.map(b=>b.width)),nBarras:barras.length,calDentro:cal.right<=card.right&&cal.left>=card.left,colados};
    });
    const dup=r.titulos.filter((t,i)=>r.titulos.indexOf(t)!==i);
    ok(dup.length===0,`${largura}px: painéis repetidos: ${dup.join(', ')}`);
    for(const t of ['Hoje','Contagem de cards','Calendário','Revisões','Tempo de revisão','Retenção real (True Retention)','Botões de resposta','Intervalos','Recuperabilidade','Estabilidade','Dificuldade','Distribuição por hora','Adicionados'])
      ok(r.titulos.includes(t),`${largura}px: falta o painel ${t}`);
    ok(r.scroll<=0&&r.estouro.length===0,`${largura}px: conteúdo estoura a tela: ${r.estouro.slice(0,5).join(' | ')}`);
    ok(r.nBarras>0&&r.barrasLargura>=4,`${largura}px: barras das séries finas demais (${r.barrasLargura}px)`);
    ok(r.calDentro,`${largura}px: calendário sai do card`);
    ok(r.colados===0,`${largura}px: ${r.colados} gráfico(s) colado(s) na borda do card`);
    ok(erros.length===0,`${largura}px: erros de página: ${erros.join(' | ')}`);
    await page.close();
  }
  console.log(`CARDS ESTATÍSTICAS/LAYOUT OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
