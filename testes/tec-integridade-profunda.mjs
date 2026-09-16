import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const guard = read('companion/src/tec-integrity-guard.js');
const capture = read('companion/src/tec-capture-v2.js');
const site = read('src/js/99j-tec-hardening-api.js');
const cloud = read('src/js/99k-tec-cloud-ledger-v2.js');
const background = read('companion/src/background-v2.js');
const entry = read('companion/src/background-entry.js');
const proxy = read('companion/src/study-ai-proxy.js');
const chatgpt = read('companion/src/chatgpt-content.js');
const edge = read('supabase/functions/tec-ai/index.ts');
const build = read('build.mjs');
const manifest = JSON.parse(read('companion/manifest.json'));

function fakeNode({ txt='', cls='', letter=null, selected=false, correct=false, wrong=false }={}) {
  return {
    textContent:txt, className:cls, offsetParent:{}, isConnected:true,
    getAttribute(name) {
      if (name==='data-letter'||name==='value') return letter;
      if (name==='aria-checked') return selected?'true':null;
      if (name==='aria-pressed'||name==='aria-label') return null;
      return null;
    },
    matches(sel) { return selected && sel==='input:checked'; },
    querySelector(sel) {
      if (selected && sel.includes('input:checked')) return {};
      if (correct && (sel.includes('correct')||sel.includes('corret')||sel.includes('glyphicon-ok-sign')||sel.includes('fa-check'))) return {};
      if (wrong && (sel.includes('incorrect')||sel.includes('errad')||sel.includes('glyphicon-remove')||sel.includes('fa-times'))) return {};
      return null;
    },
    closest() { return this; }
  };
}

const altB=fakeNode({txt:'B) Minha alternativa',letter:'B',selected:true,wrong:true});
const altC=fakeNode({txt:'C) Alternativa correta',letter:'C',correct:true});
const banner=fakeNode({txt:'Resposta correta: C'});
const docGuard={
  body:{innerText:'Questão ID: 3872602'},
  querySelectorAll(selector) {
    if (selector.includes('.jm44ow')) return [banner];
    if (selector.startsWith('[data-question-id]')) return [];
    if (selector.startsWith('label,button')) return [altB,altC];
    if (selector.includes('a[href]')) return [];
    return [];
  },
  addEventListener(){}
};
const chrome={
  runtime:{ sendMessage(){ return Promise.resolve({accepted:true}); } },
  storage:{ local:{ set(){ return Promise.resolve(); } } }
};
const gctx={window:null,document:docGuard,chrome,location:{origin:'https://tecconcursos.com.br',href:'https://tecconcursos.com.br/questoes/3872602'},
  getComputedStyle:()=>({position:'static'}),Date,Map,Set,Object,Array,String,Number,RegExp,Promise,console};
gctx.window=gctx; gctx.addEventListener=()=>{};
vm.createContext(gctx); vm.runInContext(guard,gctx,{filename:'tec-integrity-guard.js'});

const env={type:'resolution',payload:{resolution:{questionId:'3872602',acertou:true},question:{id:'3872602',acertou:true,alternativas:[
  {letra:'B',texto:'Minha alternativa'},{letra:'C',texto:'Alternativa correta'}
]}}};
gctx.window.__snmTecIntegrity.normalizeEnvelope(env);
if (env.payload.resolution.marcada!=='B'||env.payload.resolution.correta!=='C') throw new Error('Marcada/gabarito não foram extraídos de evidências independentes.');
if (env.payload.resolution.acertou!==false) throw new Error('B marcada x C correta precisa ser ERRO, mesmo se o legado reportou acerto.');
if (env.payload.resolution.integrity.status!=='verified'||env.payload.resolution.integrity.confidence!=='high') throw new Error('B/C verificáveis não produziram confiança alta.');
if (env.payload.resolution.integrity.conflict!==false||env.payload.resolution.integrity.conflictResolved!==true) throw new Error('Conflito reconciliado ficou aberto indevidamente.');
if (gctx.window.__snmTecIntegrity.bannerEvidence().explicitResult===true) throw new Error('"Resposta correta" continua sendo interpretada como acerto do aluno.');

/* Sem qualquer seleção independente, gabarito + booleano legado não pode virar
   resposta marcada sintética nem evidência prescritiva. */
const noSelectionDoc={...docGuard,querySelectorAll(selector){
  if (selector.includes('.jm44ow')) return [banner];
  if (selector.startsWith('[data-question-id]')||selector.includes('a[href]')) return [];
  if (selector.startsWith('label,button')) return [fakeNode({txt:'C) Alternativa correta',letter:'C',correct:true})];
  return [];
}};
const gctx2={...gctx,window:null,document:noSelectionDoc}; gctx2.window=gctx2; gctx2.addEventListener=()=>{};
vm.createContext(gctx2); vm.runInContext(guard,gctx2,{filename:'tec-integrity-guard-no-selection.js'});
const env2={type:'resolution',payload:{resolution:{questionId:'3872602',acertou:true},question:{id:'3872602',acertou:true,alternativas:[{letra:'C',texto:'C',correta:true}]}}};
gctx2.window.__snmTecIntegrity.normalizeEnvelope(env2);
if (env2.payload.resolution.marcada) throw new Error('Gabarito foi sintetizado como resposta marcada.');
if (env2.payload.resolution.integrity.status==='verified') throw new Error('Captura sem resposta marcada virou verificada.');

/* TrustGate do site: legado aparece no histórico, mas não prescreve. */
const store=new Map();
const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))};
const sessionStorage={getItem:k=>store.get('s:'+k)||null,setItem:(k,v)=>store.set('s:'+k,String(v))};
const documentSite={readyState:'complete',hidden:false,querySelector(){return null;},querySelectorAll(){return[];},getElementById(){return null;},addEventListener(){}};
const sctx={window:null,document:documentSite,localStorage,sessionStorage,location:{origin:'https://studynomentor.github.io'},
  Date,Map,Set,Object,Array,String,Number,RegExp,JSON,Math,Promise,console,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,CustomEvent:function(){},
  addEventListener(){},crypto:{randomUUID:()=> 'uuid-test'}};
sctx.window=sctx;
vm.createContext(sctx); vm.runInContext(site,sctx,{filename:'99j-tec-hardening-api.js'});
const G=sctx.window.TecTrustGate;
if (!G) throw new Error('TrustGate não foi publicado.');
if (G.isTrusted({acertou:false,marcada:'B',correta:'C'})) throw new Error('Evento legado sem envelope virou prescritivo.');
if (!G.isTrusted({acertou:false,marcada:'B',correta:'C',integrity:{schema:3,status:'verified',confidence:'high',conflict:false}})) throw new Error('Evento factual B/C foi rejeitado pelo TrustGate.');
if (G.isTrusted({acertou:false,marcada:'B',correta:'C',integrity:{schema:3,status:'verified',confidence:'high',conflict:true,conflictResolved:false}})) throw new Error('Conflito aberto atravessou o TrustGate.');

const isolated=(manifest.content_scripts||[]).find(x=>(x.js||[]).includes('src/tec-capture-v2.js'));
if (!isolated || isolated.js[0]!=='src/tec-integrity-guard.js' || isolated.js[1]!=='src/tec-capture-v2.js') throw new Error('Captura factual v2 não executa antes dos capturadores legados.');
if (manifest.version!=='1.2.0'||!(manifest.permissions||[]).includes('alarms')) throw new Error('Companion 1.2/alarms não está declarado.');
if (!capture.includes('window.__snmTecCompanion = true')||!capture.includes('window.__snmTecCaptureWatchdog = true')) throw new Error('Capturadores legados não são neutralizados pelo v2.');
if (capture.includes('if (acertou === true && correta && !marcada)')) throw new Error('Captura v2 ainda sintetiza marcada a partir do gabarito.');
if (!background.includes('study_route_unbound')||!background.includes('QUEUE_ITEM_PREFIX')||!background.includes('sameOwner')||!background.includes('chrome.alarms')) throw new Error('Fila v2 não isola perfil/rota ou não possui manutenção MV3.');
if (!entry.includes('snmPlusOwnedTabV2')||!entry.includes("importScripts('background-v2.js')")) throw new Error('ChatGPT ainda não usa aba dedicada/background v2.');
if (!proxy.includes("BROWSER_PROVIDER = 'chatgpt-plus-browser'")||!proxy.includes("provider||'auto')!==BROWSER_PROVIDER") throw new Error('Proxy ainda intercepta APIs de servidor indevidamente.');
if (!chatgpt.includes("throw new Error('PARTIAL_RESPONSE')")||!chatgpt.includes('ensureFreshConversation')) throw new Error('Executor ChatGPT aceita parcial ou reutiliza contexto anterior.');
if (!cloud.includes('ignoreDuplicates:true')||!cloud.includes("CURSOR_SUFFIX='tec-cloud-ledger:cursor-v2'")||!cloud.includes("created_at")) throw new Error('Ledger não está imutável/incremental.');
if (!edge.includes("'gemini', 'openai', 'openai-compatible'")||!edge.includes("GEMINI_API_KEY")||!edge.includes('consume_tec_ai_quota')) throw new Error('Roteador multi-provedor/rate limit não está instalado.');
if (!build.includes("'js/99j-tec-hardening-api.js','js/99k-tec-cloud-ledger-v2.js'")) throw new Error('Hardening v2 não está na ordem final do build.');

console.log('TEC HARDENING V2: fonte factual, conflito reconciliado, TrustGate, roteamento, ledger e IA multi-provedor validados.');
