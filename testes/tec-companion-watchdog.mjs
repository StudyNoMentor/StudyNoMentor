import { readFileSync } from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const manifest=JSON.parse(read('companion/manifest.json'));
const capture=read('companion/src/tec-capture-v2.js');
const reconstruct=read('companion/src/tec-reconstruct.js');
const legacy=read('companion/src/tec-capture-watchdog.js');
const integrity=read('companion/src/tec-integrity-guard.js');

const tecScript=(manifest.content_scripts||[]).find(x=>(x.matches||[]).some(m=>m.includes('tecconcursos.com.br'))&&(x.js||[]).includes('src/tec-capture-v2.js'));
const order=tecScript?tecScript.js||[]:[];
const checks=[
  ['Companion 1.3 ativo',manifest.version==='1.3.0'],
  ['guarda e reconstrutor carregam antes da captura factual',!!tecScript&&order.indexOf('src/tec-integrity-guard.js')===0&&order.indexOf('src/tec-reconstruct.js')===1&&order.indexOf('src/tec-capture-v2.js')===2],
  ['aba de reconstrução neutraliza captura normal',reconstruct.includes('window.__snmTecCompanionV2 = true')&&reconstruct.includes('window.__snmTecCaptureWatchdog = true')],
  ['legados carregam depois e são neutralizados',order.indexOf('src/tec-content.js')>order.indexOf('src/tec-capture-v2.js')&&order.indexOf('src/tec-capture-watchdog.js')>order.indexOf('src/tec-content.js')&&capture.includes('window.__snmTecCaptureWatchdog = true')],
  ['captura v2 roda em todos os frames TEC',!!tecScript&&tecScript.all_frames===true],
  ['guarda reconcilia marcada x gabarito',integrity.includes("source='marked-vs-gabarito'")&&integrity.includes('canonical=marked===correct')],
  ['watchdog v2 compartilha o mesmo parser de evidência',capture.includes('function watchdogProbe()')&&capture.includes('const ev=evidence(qid)')],
  ['watchdog aguarda capturador principal',capture.includes("setTimeout(()=>awaitResult(String(qid),ev.marked||null,'watchdog'),700)")],
  ['watchdog não fabrica resposta pelo gabarito',!capture.includes('!acertou&&errado&&errado.letra')&&!capture.includes('marcada = correta')],
  ['resultado high exige marcada e correta',capture.includes('if (marked && correct)')||capture.includes('if (marked&&correct)')],
  ['staging v2 é durável',capture.includes("const STAGE_PREFIX = 'snmTecStageV2:'")&&capture.includes("kind:'capture'")&&capture.includes('replayStaged()')],
  ['legacy continua empacotado apenas para transição',legacy.includes('window.__snmTecCaptureWatchdog')]
];
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){failed.forEach(([name])=>console.error('FALHOU:',name));process.exit(1);}
console.log(`COMPANION WATCHDOG V3: ${checks.length}/${checks.length} contratos válidos.`);
