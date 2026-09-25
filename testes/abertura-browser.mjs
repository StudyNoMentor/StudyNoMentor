/* Abertura: o app não espera o CDN do Supabase, o portão tem marca no celular,
   senha com "mostrar", sessão salva não pisca o login e a saída é suave. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const html=readFileSync(join(ROOT,'index.html'));
let lib=null;try{lib=readFileSync(join(ROOT,'node_modules/@supabase/supabase-js/dist/umd/supabase.js'),'utf8');}catch{}
const server=createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
let n=0;const ok=(v,m)=>{n++;assert.ok(v,m);};
const ATRASO=2500;
async function abrir(vw,{sessao=false}={}){
  const ctx=await browser.newContext({viewport:{width:vw,height:820},serviceWorkers:'block'});
  await ctx.route('https://cdn.jsdelivr.net/**',async rota=>{
    await new Promise(r=>setTimeout(r,ATRASO));
    if(lib) rota.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:lib});
    else rota.abort();
  });
  await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await ctx.route('https://*.supabase.co/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  const page=await ctx.newPage();
  const erros=[];page.on('pageerror',e=>erros.push(e.message));
  await page.addInitScript(({sessao})=>{
    if(sessao) try{localStorage.setItem('sb-teste-auth-token','{"x":1}');}catch(_){}
    window.__gateEm=0;
    new MutationObserver(()=>{const g=document.getElementById('profile-gate');if(!window.__gateEm&&g&&g.style.display==='block')window.__gateEm=performance.now();})
      .observe(document,{subtree:true,childList:true,attributes:true});
  },{sessao});
  await page.goto(url,{waitUntil:'commit'});
  await page.waitForFunction(()=>window.__gateEm>0,{timeout:20000});
  return {ctx,page,erros};
}
try{
  /* 1. CDN lento não segura a abertura; biblioteca liga a nuvem quando chega. */
  {
    const {ctx,page,erros}=await abrir(412);
    const r=await page.evaluate(()=>({gate:window.__gateEm,lib:CloudStore.libStatus,splash:!!document.getElementById('app-loading'),
      congelado:Object.isFrozen(Array.prototype),login:getComputedStyle(document.getElementById('gate-login')).display}));
    ok(r.gate<ATRASO-500,'portão aparece sem esperar o CDN ('+Math.round(r.gate)+' ms)');
    ok(r.lib==='pending','nuvem aguardando a biblioteca ('+r.lib+')');
    ok(!r.congelado,'prototypes só congelam depois da biblioteca');
    ok(r.login==='block','sem sessão salva: formulário de login');
    await page.waitForTimeout(400);
    ok(!(await page.evaluate(()=>!!document.getElementById('app-loading'))),'splash removido');
    if(lib){
      await page.waitForFunction(()=>CloudStore.libStatus==='ready',{timeout:15000});
      ok(await page.evaluate(()=>Object.isFrozen(Array.prototype)&&Object.isFrozen(Object.prototype)),'prototypes congelados após a biblioteca');
    }
    // celular: faixa de marca visível, lista de recursos oculta, cartão sem estouro
    const m=await page.evaluate(()=>{const h=document.querySelector('.gate-hero'),f=document.querySelector('.gate-hero-feats'),p=document.querySelector('.gate-panel-inner');
      return {hero:getComputedStyle(h).display,feats:getComputedStyle(f).display,dir:p.getBoundingClientRect().right,scroll:document.documentElement.scrollWidth};});
    ok(m.hero!=='none'&&m.feats==='none','celular: faixa de marca sem a lista de recursos');
    ok(m.dir<=412&&m.scroll<=412,'celular: cartão cabe na largura');
    // senha: mostrar/ocultar e Enter no e-mail leva à senha
    await page.fill('#gate-password','segredo1');
    await page.click('#gate-pass-eye');
    ok(await page.$eval('#gate-password',e=>e.type)==='text','olho mostra a senha');
    ok(await page.$eval('#gate-pass-eye',e=>e.getAttribute('aria-pressed'))==='true','olho anuncia estado');
    await page.click('#gate-pass-eye');
    ok(await page.$eval('#gate-password',e=>e.type)==='password','olho oculta de novo');
    await page.focus('#gate-email');await page.keyboard.press('Enter');
    ok(await page.evaluate(()=>document.activeElement.id)==='gate-password','Enter no e-mail vai para a senha');
    // saída do portão: véu sem clique que some sozinho
    const v=await page.evaluate(()=>{ProfileUI.hideGate();const v=document.querySelector('.gate-veu');return {existe:!!v,pe:v&&getComputedStyle(v).pointerEvents,aberto:ProfileUI.isGateOpen()};});
    ok(v.existe&&v.pe==='none'&&!v.aberto,'saída do portão com véu que não bloqueia clique');
    await page.waitForTimeout(700);
    ok(!(await page.evaluate(()=>!!document.querySelector('.gate-veu'))),'véu removido');
    ok(erros.length===0,'sem erros: '+erros.join(' | '));
    await ctx.close();
  }
  /* 2. Sessão salva: "Entrando…" em vez de piscar o login enquanto a biblioteca chega. */
  {
    const {ctx,page,erros}=await abrir(412,{sessao:true});
    const r=await page.evaluate(()=>({login:getComputedStyle(document.getElementById('gate-login')).display,entrando:getComputedStyle(document.getElementById('gate-entering')).display}));
    ok(r.login==='none'&&r.entrando==='block','sessão salva: tela "Entrando…" sem formulário');
    ok(erros.length===0,'sem erros: '+erros.join(' | '));
    await ctx.close();
  }
  /* 3. Computador: dois painéis lado a lado. */
  {
    const {ctx,page}=await abrir(1280);
    const d=await page.evaluate(()=>{const h=document.querySelector('.gate-hero').getBoundingClientRect(),p=document.querySelector('.gate-panel').getBoundingClientRect();return {lado:h.right<=p.left+1,feats:getComputedStyle(document.querySelector('.gate-hero-feats')).display};});
    ok(d.lado&&d.feats!=='none','computador: apresentação e acesso lado a lado');
    await ctx.close();
  }
  console.log(`ABERTURA (NAVEGADOR) OK — ${n} invariantes.`);
}finally{await browser.close();server.close();}
