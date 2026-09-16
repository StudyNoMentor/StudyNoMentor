import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{const raw=(req.url||'/').split('?')[0],name=raw==='/'?'/index.html':raw;try{const body=readFileSync(join(ROOT,decodeURIComponent(name).replace(/^\/+/,'')));res.writeHead(200,{'Content-Type':MIME[extname(name)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404).end('nao encontrado');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/index.html`;

const walk = dir => readdirSync(dir).flatMap(name=>{const p=join(dir,name);return statSync(p).isDirectory()?walk(p):[p]});
const sourceFiles=[...walk(join(ROOT,'src')), ...walk(join(ROOT,'companion','src'))].filter(p=>/\.(?:css|html|js)$/.test(p));
const cssFiles=sourceFiles.filter(p=>p.endsWith('.css'));
const htmlFiles=sourceFiles.filter(p=>p.endsWith('.html'));
const jsFiles=sourceFiles.filter(p=>p.endsWith('.js'));

const staticAudit={files:sourceFiles.length,css:cssFiles.length,html:htmlFiles.length,js:jsFiles.length,inlineStyles:[],opacityRules:[],tinyPx:[],heavyBorders:[],hardcodedFonts:[]};
for(const file of sourceFiles){
  const raw=readFileSync(file,'utf8'), rel=relative(ROOT,file).replaceAll('\\','/');
  if(file.endsWith('.html')){
    const ms=[...raw.matchAll(/\sstyle="([^"]+)"/g)];
    if(ms.length) staticAudit.inlineStyles.push({file:rel,count:ms.length});
  }
  if(file.endsWith('.js')){
    const count=(raw.match(/\.style\.cssText\s*=|setAttribute\(\s*['"]style['"]|\.style\.[a-zA-Z]+\s*=/g)||[]).length;
    if(count) staticAudit.inlineStyles.push({file:rel,count});
  }
  if(file.endsWith('.css')){
    const op=[...raw.matchAll(/opacity\s*:\s*(0?\.\d+|[01])\s*!?important?/gi)].map(m=>Number(m[1])).filter(n=>n>0&&n<.78);
    if(op.length) staticAudit.opacityRules.push({file:rel,count:op.length,min:Math.min(...op)});
    const tiny=[...raw.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(m=>Number(m[1])).filter(n=>n<10.5);
    if(tiny.length) staticAudit.tinyPx.push({file:rel,count:tiny.length,min:Math.min(...tiny)});
    const borders=[...raw.matchAll(/border(?:-(?:top|right|bottom|left))?\s*:\s*(\d+(?:\.\d+)?)px\s+solid/gi)].map(m=>Number(m[1])).filter(n=>n>2);
    if(borders.length) staticAudit.heavyBorders.push({file:rel,count:borders.length,max:Math.max(...borders)});
    const fonts=[...raw.matchAll(/font-family\s*:\s*([^;}{]+)/gi)].map(m=>m[1].trim()).filter(v=>!/var\(--ui-font\)|Inter|system-ui|ui-monospace|Space Mono|monospace/i.test(v));
    if(fonts.length) staticAudit.hardcodedFonts.push({file:rel,count:fonts.length,sample:fonts.slice(0,3)});
  }
}

console.log(`STATIC VISUAL INVENTORY — ${staticAudit.files} arquivos (${staticAudit.css} CSS, ${staticAudit.html} HTML, ${staticAudit.js} JS).`);
console.log(`  estilos inline/dinâmicos: ${staticAudit.inlineStyles.reduce((a,x)=>a+x.count,0)} em ${staticAudit.inlineStyles.length} arquivo(s)`);
console.log(`  regras legadas de opacidade < .78: ${staticAudit.opacityRules.reduce((a,x)=>a+x.count,0)} em ${staticAudit.opacityRules.length} CSS`);
console.log(`  font-size literal legado < 10.5px: ${staticAudit.tinyPx.reduce((a,x)=>a+x.count,0)} em ${staticAudit.tinyPx.length} CSS`);
console.log(`  bordas sólidas legadas > 2px: ${staticAudit.heavyBorders.reduce((a,x)=>a+x.count,0)} em ${staticAudit.heavyBorders.length} CSS`);

const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const consoleErrors=[];
page.on('pageerror',e=>consoleErrors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!/net::|ERR_|favicon|Failed to load resource/.test(m.text()))consoleErrors.push(m.text());});

const screens=['registrar','ciclo','grade','estudonovo','leis','cards','extras','links','historico','evolucao','conquistas','desempenhotec','integracaotec','ferramentas','config'];
const viewports=[
  {name:'desktop',width:1440,height:1000},
  {name:'notebook',width:1180,height:820},
  {name:'tablet',width:768,height:900},
  {name:'mobile',width:390,height:844},
  {name:'mobile-small',width:360,height:740}
];
const findings=[];

try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.switchScreen&&document.querySelectorAll('.screen').length>=15,{timeout:30000});
  await page.evaluate(()=>{
    try{if(window.ProfileUI&&ProfileUI.hideGate)ProfileUI.hideGate();}catch(_){}
    const g=document.getElementById('profile-gate');if(g)g.style.display='none';
    const l=document.getElementById('app-loading');if(l)l.style.display='none';
  });

  for(const vp of viewports){
    await page.setViewportSize({width:vp.width,height:vp.height});
    for(const name of screens){
      await page.evaluate(n=>{try{switchScreen(n);}catch(_){}},name);
      await page.waitForTimeout(90);
      const report=await page.evaluate(({name})=>{
        const screen=document.getElementById('screen-'+name);if(!screen)return{missing:true};
        const visible=el=>{
          if(!el||el.closest('[hidden]'))return false;
          const cs=getComputedStyle(el),r=el.getBoundingClientRect();
          return cs.display!=='none'&&cs.visibility!=='hidden'&&Number(cs.opacity)>0&&r.width>.5&&r.height>.5;
        };
        const hasText=el=>((el.innerText||'').replace(/\s+/g,' ').trim().length>0);
        const cls=el=>String(el.className||'').slice(0,140);
        const sig=el=>({tag:el.tagName.toLowerCase(),id:el.id||'',class:cls(el),text:(el.innerText||'').replace(/\s+/g,' ').trim().slice(0,90)});
        const issues=[];
        const delta=screen.scrollWidth-screen.clientWidth;
        if(delta>5)issues.push({type:'screen-overflow',delta});
        const header=screen.querySelector(':scope > .page-header,.content-wrap > .page-header,.page-header');
        if(header&&visible(header)){
          const hs=getComputedStyle(header);
          const border=Math.max(parseFloat(hs.borderTopWidth)||0,parseFloat(hs.borderRightWidth)||0,parseFloat(hs.borderBottomWidth)||0,parseFloat(hs.borderLeftWidth)||0);
          if(border>.1)issues.push({type:'framed-page-header',border});
        }
        const all=[...screen.querySelectorAll('*')].filter(visible);
        for(const el of all){
          const cs=getComputedStyle(el),r=el.getBoundingClientRect(), text=hasText(el);
          if(r.right>window.innerWidth+6 && !el.closest('[class*="table-wrap"],.table-scroll,#ciclo-grade,.track-table-wrap,.tec-import-table-wrap,[style*="overflow"]')) issues.push({type:'viewport-overflow',...sig(el),right:Math.round(r.right),vw:window.innerWidth});
          if(text && !el.matches('script,style,pre,code,kbd,samp') && !el.closest('pre,code,kbd,samp,.sr-only,[aria-hidden="true"]')){
            const fs=parseFloat(cs.fontSize)||0, op=parseFloat(cs.opacity)||1, lh=parseFloat(cs.lineHeight)||0;
            if(fs>0&&fs<9.75&&!el.matches('.tab-icon,.gf-ico,.app-loading-spin'))issues.push({type:'tiny-font',...sig(el),fontSize:fs});
            if(op<.72&&!el.matches(':disabled,[disabled]')&&!el.closest('[disabled],[aria-disabled="true"]'))issues.push({type:'faded-text',...sig(el),opacity:op});
            const txt=(el.innerText||'').replace(/\s+/g,' ').trim();
            if(txt.length>=12&&r.width<38&&lh>0&&r.height>lh*2.5)issues.push({type:'vertical-text-break',...sig(el),w:Math.round(r.width),h:Math.round(r.height),lineHeight:Math.round(lh)});
            if(fs>44&&!/(hero|display|big|value|score|gauge|metric|number|count|stat)/i.test(cls(el)))issues.push({type:'oversized-text',...sig(el),fontSize:fs});
          }
          if(el.matches('button,input,select,textarea,[role="button"]')&&!el.matches('[type="hidden"]')){
            const fs=parseFloat(cs.fontSize)||0, label=(el.innerText||el.value||el.getAttribute('aria-label')||'').trim();
            const compact=el.matches('.info-dot,.toggle-switch,.status-swatch,.icon-btn,.btn-icon,.reg-act-btn,.a-menor,.a-maior,[role="switch"]');
            if(!compact && label.length>1 && r.height<30)issues.push({type:'small-control',...sig(el),h:Math.round(r.height)});
            if(!compact && label.length>1 && fs>0&&fs<10.5)issues.push({type:'tiny-control-font',...sig(el),fontSize:fs});
          }
          const cardLike=el.matches('.card,[class$="-card"],[class*=" card"],[class*="panel"],[class*="-box"],article');
          if(cardLike && text && !el.matches('.app-loading-spin')){
            const op=parseFloat(cs.opacity)||1;
            if(op<.9)issues.push({type:'faded-surface',...sig(el),opacity:op});
            const bw=Math.max(parseFloat(cs.borderTopWidth)||0,parseFloat(cs.borderRightWidth)||0,parseFloat(cs.borderBottomWidth)||0,parseFloat(cs.borderLeftWidth)||0);
            if(bw>2.1)issues.push({type:'heavy-frame',...sig(el),borderWidth:bw});
          }
        }
        return{missing:false,issues,count:all.length,scrollWidth:screen.scrollWidth,clientWidth:screen.clientWidth};
      },{name});
      if(report.missing)findings.push({viewport:vp.name,screen:name,type:'missing-screen'});
      else for(const issue of report.issues)findings.push({viewport:vp.name,screen:name,...issue});
    }
  }

  const counts=findings.reduce((m,x)=>(m[x.type]=(m[x.type]||0)+1,m),{});
  console.log('RUNTIME VISUAL FINDINGS:',JSON.stringify(counts));
  const grouped={};
  for(const f of findings){(grouped[f.screen]||(grouped[f.screen]=[])).push(f)}
  for(const [screen,rows] of Object.entries(grouped)){
    console.log(`\n[${screen}] ${rows.length} ocorrência(s)`);
    for(const r of rows.slice(0,20))console.log(' ',JSON.stringify(r));
    if(rows.length>20)console.log(`  ... +${rows.length-20}`);
  }

  assert.equal(consoleErrors.length,0,'erros no navegador: '+consoleErrors.join(' | '));
  const structural=new Set(['screen-overflow','viewport-overflow','vertical-text-break','framed-page-header']);
  const visual=new Set(['tiny-font','tiny-control-font','faded-text','faded-surface','oversized-text','small-control','heavy-frame']);
  assert.equal(findings.filter(x=>structural.has(x.type)).length,0,'há quebras estruturais/overflow/moldura indevida no layout');
  assert.equal(findings.filter(x=>visual.has(x.type)).length,0,'há inconsistências críticas de tipografia/opacidade/controles/bordas');
  console.log(`\nSITE VISUAL AUDIT OK — ${screens.length} telas × ${viewports.length} viewports; ${sourceFiles.length} arquivos-fonte inventariados.`);
} finally {
  await browser.close();
  await new Promise(r=>server.close(r));
}
