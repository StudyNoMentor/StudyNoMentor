import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const guard = read('companion/src/tec-integrity-guard.js');
const site = read('src/js/99i-tec-integridade-auditoria.js');
const bgEntry = read('companion/src/background-entry.js');
const chatgpt = read('companion/src/chatgpt-content.js');
const manifest = JSON.parse(read('companion/manifest.json'));
const css = read('src/css/32-tec-integridade-auditoria.css');

function fakeNode({ txt='', cls='', letter=null, selected=false, correct=false, wrong=false }={}) {
  return {
    textContent:txt, className:cls, offsetParent:{}, isConnected:true,
    getAttribute(name) {
      if (name==='data-letter') return letter;
      if (name==='aria-checked') return selected?'true':null;
      if (name==='aria-pressed') return null;
      if (name==='aria-label') return '';
      if (name==='value') return letter;
      return null;
    },
    matches(sel) { return selected && sel==='input:checked'; },
    querySelector(sel) {
      if (selected && sel.includes('input:checked')) return {};
      if (correct && (sel.includes('correct') || sel.includes('corret') || sel.includes('glyphicon-ok-sign') || sel.includes('fa-check'))) return {};
      if (wrong && (sel.includes('incorrect') || sel.includes('errad') || sel.includes('glyphicon-remove') || sel.includes('fa-times'))) return {};
      return null;
    },
    closest() { return this; },
    getBoundingClientRect() { return { width:100,height:20 }; }
  };
}

const altB=fakeNode({txt:'B) Minha alternativa',letter:'B',selected:true,wrong:true});
const altC=fakeNode({txt:'C) Alternativa correta',letter:'C',correct:true});
const banner=fakeNode({txt:'Resposta correta: C'});
const listeners={};
const documentGuard={
  body:{innerText:'Questão ID: 3872602'},
  querySelectorAll(selector) {
    if (selector.includes('.jm44ow')) return [banner];
    if (selector.startsWith('[data-question-id]')) return [];
    if (selector.startsWith('label,button')) return [altB,altC];
    return [];
  },
  addEventListener(type,fn){ listeners[type]=fn; }
};
const chrome={
  runtime:{ sendMessage(){ return Promise.resolve({accepted:true}); } },
  storage:{ local:{ set(){ return Promise.resolve(); } } }
};
const guardCtx={ window:null,document:documentGuard,chrome,location:{origin:'https://tecconcursos.com.br',href:'https://tecconcursos.com.br/questoes/3872602'},
  getComputedStyle:()=>({position:'static'}), Date,Map,Set,Object,Array,String,Number,RegExp,Promise,console,setTimeout,clearTimeout };
guardCtx.window=guardCtx;
guardCtx.addEventListener=()=>{};
vm.createContext(guardCtx);
vm.runInContext(guard,guardCtx,{filename:'tec-integrity-guard.js'});

const env={type:'resolution',payload:{resolution:{questionId:'3872602',acertou:true},question:{id:'3872602',acertou:true,alternativas:[
  {letra:'B',texto:'Minha alternativa',marcadaPorMim:true},{letra:'C',texto:'Alternativa correta',correta:true}
]}}};
guardCtx.window.__snmTecIntegrity.normalizeEnvelope(env);
if (env.payload.resolution.acertou !== false) throw new Error('BUG CRÍTICO: B marcada x C correta ainda foi registrada como acerto.');
if (env.payload.resolution.marcada !== 'B' || env.payload.resolution.correta !== 'C') throw new Error('Resposta marcada/gabarito não sobreviveram à normalização.');
if (!env.payload.resolution.integrity || env.payload.resolution.integrity.confidence !== 'high') throw new Error('Resolução reconciliada não recebeu evidência de alta confiança.');
if (!env.payload.resolution.integrity.conflict) throw new Error('Conflito com resultado legado não foi auditado.');

/* A frase "Resposta correta" não pode, sozinha, ser tratada como "você acertou". */
const onlyBanner=guardCtx.window.__snmTecIntegrity.bannerEvidence();
if (onlyBanner.explicitResult === true) throw new Error('"Resposta correta" continua sendo interpretada como acerto do aluno.');
if (onlyBanner.correct !== 'C') throw new Error('Letra do gabarito não foi extraída do banner informativo.');

const store=new Map();
const localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const state={questions:{},analyses:{},connection:{}};
let runSection=null;
const T={
  text:v=>String(v==null?'':v).trim(), hash:v=>'h'+String(v).length, questionKey:(a,b,id)=>[a,b,id].join('::'),
  state:()=>state, promptKindFor:(sec,q)=>sec==='diagnostico'?(q.acertou===false?'erro':'acerto'):'teoria',
  promptState:()=>({prompts:{erro:'ID {{ID}} | MARQUEI {{MINHA_RESPOSTA}} | GAB {{GABARITO}} | {{RESULTADO}}',acerto:'ok',teoria:'teoria'}}),
  DEFAULT_PROMPTS:{erro:'erro',acerto:'acerto',teoria:'teoria'},
  renderPromptTemplate(t,q){return t.replace('{{ID}}',q.id||'—').replace('{{MINHA_RESPOSTA}}',q.marcada||'—').replace('{{GABARITO}}',q.correta||'—').replace('{{RESULTADO}}',q.acertou===false?'ERROU':'ACERTOU');},
  runAI(sec){runSection=sec;return Promise.resolve(sec);}, render(){}, selectedKey:null
};
const documentSite={ readyState:'complete',querySelector(){return null;},addEventListener(){},getElementById(){return null;} };
const siteCtx={window:null,document:documentSite,TecIntegracaoScreen:T,localStorage,DB:{_profilePrefix:()=> 'p:',setRaw:(k,v)=>{localStorage.setItem(k,v);return true;}},
  Date,Map,Set,Object,Array,String,Number,RegExp,JSON,Math,Promise,console,setTimeout,clearTimeout,escapeHtml:s=>String(s),navigator:{clipboard:{writeText:async()=>{}}},location:{origin:'https://studynomentor.github.io'},addEventListener(){} };
siteCtx.window=siteCtx;
vm.createContext(siteCtx);
vm.runInContext(site,siteCtx,{filename:'99i-tec-integridade-auditoria.js'});

T.mergeInto(state,{id:'42',enunciado:'Texto','alternativas':[ {letra:'B',texto:'B',marcadaPorMim:true},{letra:'C',texto:'C',correta:true}],marcada:'B',correta:'C',acertou:true},{tecAccount:'u',bookId:'c'});
T.selectedKey='u::c::42';
if (state.questions[T.selectedKey].question.acertou !== false) throw new Error('Biblioteca não reconciliou resultado com marcada/gabarito.');
/* Uma captura posterior incompleta não pode apagar B/C. */
T.mergeInto(state,{id:'42',enunciado:'Texto atualizado',alternativas:[{letra:'B',texto:'B'},{letra:'C',texto:'C'}],acertou:true},{tecAccount:'u',bookId:'c'});
const persisted=state.questions[T.selectedKey].question;
if (persisted.marcada!=='B'||persisted.correta!=='C'||persisted.acertou!==false) throw new Error('Captura incompleta apagou/alterou fatos já persistidos.');
const local=T.localPrompt('diagnostico');
if (!/MARQUEI B/.test(local.text)||!/GAB C/.test(local.text)||!/ERROU/.test(local.text)) throw new Error('Prompt instantâneo não contém resposta marcada, gabarito e resultado reconciliado.');
await T.runAI('all');
if (runSection!=='diagnostico') throw new Error('Primeiro clique ainda dispara múltiplas análises sequenciais.');

const isolated=(manifest.content_scripts||[]).find(x=>(x.js||[]).includes('src/tec-content.js'));
if (!isolated || isolated.js[0]!=='src/tec-integrity-guard.js') throw new Error('Guarda de integridade precisa executar antes do capturador TEC.');
if (manifest.background.service_worker!=='src/background-entry.js') throw new Error('Worker reutilizável não está ativo no manifest.');
if (!bgEntry.includes("nativeQuery({ url:['https://chatgpt.com/*'] })") || !bgEntry.includes("kind:'plus-ai-wake'")) throw new Error('Background não reutiliza/reativa aba existente do ChatGPT.');
if (!chatgpt.includes("msg.kind!=='plus-ai-wake'") || !chatgpt.includes('async function pump')) throw new Error('Executor ChatGPT não aceita novos jobs na mesma aba.');
if (!site.includes("AUDIT_KEY = 'tec-resolution-audit-v1'") || !site.includes('priorityBreakdown')) throw new Error('Auditoria de resolução/prioridade não está instalada.');
for (const token of ['#tec-assistant-trust','.tec-lacunas-how','.tec-lacuna-proof-grid']) if (!css.includes(token)) throw new Error('UI de transparência ausente: '+token);

console.log('TEC INTEGRIDADE PROFUNDA: resultado, B/C, persistência, prompt local, aba reutilizável e transparência validados.');
