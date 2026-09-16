import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync,readdirSync,statSync } from 'node:fs';
import { extname,join,dirname,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{const p=(req.url||'/').split('?')[0],f=p==='/'?'/index.html':p;try{res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(readFileSync(join(ROOT,decodeURIComponent(f).replace(/^\/+/,''))))}catch{res.writeHead(404).end('x')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;

const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?walk(p):[p]});
const files=[...walk(join(ROOT,'src')),...walk(join(ROOT,'companion','src'))].filter(p=>/\.(css|html|js)$/.test(p));
const stat={css:0,html:0,js:0,inline:0,tiny:0,opacity:0,heavy:0};
for(const f of files){const raw=readFileSync(f,'utf8');if(f.endsWith('.css')){stat.css++;stat.tiny+=([...raw.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)].filter(m=>+m[1]<10.5)).length;stat.opacity+=([...raw.matchAll(/opacity\s*:\s*(0?\.\d+)/gi)].filter(m=>+m[1]>0&&+m[1]<.78)).length;stat.heavy+=([...raw.matchAll(/border(?:-(?:top|right|bottom|left))?\s*:\s*(\d+(?:\.\d+)?)px\s+solid/gi)].filter(m=>+m[1]>2)).length}else if(f.endsWith('.html')){stat.html++;stat.inline+=(raw.match(/\sstyle="/g)||[]).length}else{stat.js++;stat.inline+=(raw.match(/\.style\.cssText\s*=|setAttribute\(\s*['"]style['"]|\.style\.[a-zA-Z]+\s*=/g)||[]).length}}
console.log('STATIC VISUAL INVENTORY',JSON.stringify({files:files.length,...stat}));

const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))errors.push(m.text())});
const screens=['registrar','ciclo','grade','estudonovo','leis','cards','extras','links','historico','evolucao','conquistas','desempenhotec','integracaotec','ferramentas','config'];
const vps=[['desktop',1440,1000],['notebook',1180,820],['tablet',768,900],['mobile',390,844],['mobile-small',360,740]];
const findings=[];
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.switchScreen&&document.querySelectorAll('.screen').length>=15,{timeout:30000});
 await page.evaluate(()=>{try{ProfileUI?.hideGate?.()}catch(_){};for(const id of ['profile-gate','app-loading']){const e=document.getElementById(id);if(e)e.style.display='none'}});
 for(const [vp,w,h] of vps){await page.setViewportSize({width:w,height:h});for(const name of screens){await page.evaluate(n=>{try{switchScreen(n)}catch(_){}},name);await page.waitForTimeout(90);const rows=await page.evaluate(name=>{
  const s=document.getElementById('screen-'+name);if(!s)return[{type:'missing-screen'}];const out=[];
  const vis=e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return !e.closest('[hidden]')&&c.display!=='none'&&c.visibility!=='hidden'&&+c.opacity>0&&r.width>.5&&r.height>.5};
  const sig=e=>({tag:e.tagName.toLowerCase(),id:e.id||'',class:String(e.className||'').slice(0,120),text:(e.innerText||'').replace(/\s+/g,' ').trim().slice(0,80)});
  if(s.scrollWidth>s.clientWidth+5)out.push({type:'screen-overflow',delta:s.scrollWidth-s.clientWidth});
  const hdr=s.querySelector('.page-header');if(hdr&&vis(hdr)){const c=getComputedStyle(hdr),bw=Math.max(parseFloat(c.borderTopWidth)||0,parseFloat(c.borderRightWidth)||0,parseFloat(c.borderBottomWidth)||0,parseFloat(c.borderLeftWidth)||0);if(bw>.1)out.push({type:'framed-page-header',border:bw})}
  for(const e of [...s.querySelectorAll('*')].filter(vis)){const c=getComputedStyle(e),r=e.getBoundingClientRect(),txt=(e.innerText||'').replace(/\s+/g,' ').trim();
   if(r.right>innerWidth+6&&!e.closest('[class*="table-wrap"],.table-scroll,#ciclo-grade,.track-table-wrap,.tec-import-table-wrap,[style*="overflow"]'))out.push({type:'viewport-overflow',...sig(e),right:Math.round(r.right),vw:innerWidth});
   if(txt&&!e.closest('pre,code,kbd,samp,.sr-only,[aria-hidden="true"]')){const fs=parseFloat(c.fontSize)||0,op=parseFloat(c.opacity)||1,lh=parseFloat(c.lineHeight)||0;if(fs&&fs<9.75)out.push({type:'tiny-font',...sig(e),fontSize:fs});if(op<.72&&!e.matches(':disabled,[disabled]')&&!e.closest('[disabled],[aria-disabled="true"]'))out.push({type:'faded-text',...sig(e),opacity:op});if(txt.length>=12&&r.width<38&&lh&&r.height>lh*2.5)out.push({type:'vertical-text-break',...sig(e),w:Math.round(r.width),h:Math.round(r.height)});if(fs>44&&!/(hero|display|big|value|score|gauge|metric|number|count|stat)/i.test(String(e.className||'')))out.push({type:'oversized-text',...sig(e),fontSize:fs})}
   if(e.matches('button,input,select,textarea,[role="button"]')&&!e.matches('[type="hidden"]')){const fs=parseFloat(c.fontSize)||0,label=(e.innerText||e.value||e.getAttribute('aria-label')||'').trim(),compact=e.matches('.info-dot,.toggle-switch,.status-swatch,.icon-btn,.btn-icon,.reg-act-btn,.a-menor,.a-maior,[role="switch"],input[type="checkbox"],input[type="radio"]');if(!compact&&label.length>1&&r.height<30)out.push({type:'small-control',...sig(e),h:Math.round(r.height)});if(!compact&&label.length>1&&fs&&fs<10.5)out.push({type:'tiny-control-font',...sig(e),fontSize:fs})}
   if(e.matches('.card,[class$="-card"],[class*=" card"],[class*="panel"],[class*="-box"],article')&&txt){const op=parseFloat(c.opacity)||1,bw=Math.max(parseFloat(c.borderTopWidth)||0,parseFloat(c.borderRightWidth)||0,parseFloat(c.borderBottomWidth)||0,parseFloat(c.borderLeftWidth)||0);if(op<.9)out.push({type:'faded-surface',...sig(e),opacity:op});if(bw>2.1)out.push({type:'heavy-frame',...sig(e),borderWidth:bw})}
  }
  return out;
 },name);for(const x of rows)findings.push({viewport:vp,screen:name,...x})}}
 const counts=findings.reduce((m,x)=>(m[x.type]=(m[x.type]||0)+1,m),{});console.log('RUNTIME VISUAL FINDINGS',JSON.stringify(counts));
 const grouped={};for(const x of findings)(grouped[x.screen]||(grouped[x.screen]=[])).push(x);for(const [k,v] of Object.entries(grouped)){console.log(`\n[${k}] ${v.length}`);for(const x of v.slice(0,24))console.log(JSON.stringify(x));if(v.length>24)console.log(`... +${v.length-24}`)}
 assert.equal(errors.length,0,'erros no navegador: '+errors.join(' | '));
 const structural=new Set(['screen-overflow','viewport-overflow','vertical-text-break','framed-page-header','missing-screen']);const visual=new Set(['tiny-font','tiny-control-font','faded-text','faded-surface','oversized-text','small-control','heavy-frame']);
 assert.equal(findings.filter(x=>structural.has(x.type)).length,0,'quebras estruturais/overflow/molduras');assert.equal(findings.filter(x=>visual.has(x.type)).length,0,'tipografia/opacidade/controles/bordas');
 console.log(`SITE VISUAL AUDIT OK — ${screens.length} telas × ${vps.length} viewports; ${files.length} arquivos-fonte.`);
}finally{await browser.close();await new Promise(r=>server.close(r))}
