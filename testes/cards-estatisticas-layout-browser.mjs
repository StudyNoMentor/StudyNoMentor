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
    const r=await page.evaluate(async()=>{
      try{ProfileUI.hideGate();}catch(_){}
      // Layout é testado com um payload de GraphsService, sem depender de rede,
      // sessão ou de cálculos locais. A UI continua consumindo exatamente o
      // contrato oficial que o backend serializa.
      const reviewCount={},reviewTime={},added={};
      for(let off=-59;off<=0;off++){
        const n=1+Math.abs(off%7);
        reviewCount[off]={learn:off%5===0?1:0,relearn:off%11===0?1:0,young:n,mature:Math.max(0,n-2),filtered:off%13===0?1:0};
        reviewTime[off]={learn:12000,relearn:6000,young:n*9000,mature:n*5000,filtered:2000};
        added[off]=off%4===0?2:0;
      }
      const graph={
        fsrs:true,rollover_hour:4,
        card_counts:{excluding_inactive:{newCards:8,learn:4,relearn:2,young:21,mature:23,suspended:1,buried:1}},
        today:{answer_count:18,answer_millis:180000,correct_count:15,mature_correct:8,mature_count:9,learn_count:3,review_count:12,relearn_count:2,early_review_count:1},
        reviews:{count:reviewCount,time:reviewTime},added:{added},
        true_retention:{today:{young_passed:5,young_failed:1,mature_passed:8,mature_failed:1},yesterday:{young_passed:4,young_failed:1,mature_passed:7,mature_failed:1},week:{young_passed:30,young_failed:4,mature_passed:40,mature_failed:5},month:{young_passed:100,young_failed:12,mature_passed:140,mature_failed:15},year:{young_passed:300,young_failed:35,mature_passed:420,mature_failed:40},all_time:{young_passed:400,young_failed:45,mature_passed:600,mature_failed:55}},
        buttons:{one_month:{learning:[2,3,4,5],young:[3,5,8,4],mature:[2,6,9,5]},three_months:{learning:[5,8,11,7],young:[8,15,22,13],mature:[7,18,28,16]},one_year:{learning:[12,19,26,14],young:[20,35,51,27],mature:[18,42,63,31]},all_time:{learning:[15,24,30,18],young:[25,44,62,34],mature:[22,55,80,41]}},
        hours:{all_time:Array.from({length:24},(_,h)=>({total:h%6+1,correct:Math.max(0,h%6)}))},
        intervals:{intervals:{1:4,7:12,30:18,90:14,365:7}},
        retrievability:{retrievability:{20:2,40:5,60:12,80:25,100:18},average:.84},
        stability:{intervals:{1:3,7:8,30:15,90:20,365:10}},
        difficulty:{eases:{1:2,2:5,3:13,4:18,5:9,6:5,7:3,8:2,9:1,10:1},average:4.3}
      };
      CardsOfficialBridge.bootstrap=async()=>true;
      CardsOfficialBridge.request=async path=>{
        if(String(path).includes('/api/cards-official/stats/graphs'))return graph;
        throw new Error('endpoint inesperado no teste de layout: '+path);
      };
      switchScreen('cards');CardsScreen.tab='stats';
      const box=document.getElementById('cards-content');
      await CardsOfficialBridge.renderStats(box);
      const vw=document.documentElement.clientWidth;
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
