import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const main = read('src/js/99-tec-lacunas-continuas.js');
const guards = read('src/js/99b-tec-lacunas-guardas.js');

const store = new Map();
const events = {};
const libraryQuestions = {};
let activeSubjects = ['Auditoria','Contabilidade Geral','Tecnologia da Informação','Direito Administrativo','Direito Tributário'];

const localStorage = {
  getItem:k => store.has(k) ? store.get(k) : null,
  setItem:(k,v) => store.set(k,String(v)),
  removeItem:k => store.delete(k)
};
const document = {
  readyState:'loading', hidden:false,
  addEventListener(){}, querySelector(){return null;}
};
const DB = {
  _profilePrefix:()=> 'diario-estudos:u:test:',
  _activePlanId:()=> 'pre',
  getActiveSubjects:()=> activeSubjects.map(nome=>({nome,ativo:true})),
  getCurrentCycle:()=>({subjects:['Auditoria',{nome:'Contabilidade Geral'},'Tecnologia da Informação','Direito Administrativo','Direito Tributário']}),
  keysForPlan:id=>({extras:`p:${id}:extras`}),
  _get:()=>[], setRaw:(k,v)=>{localStorage.setItem(k,v);return true;},
  addExtra:()=>null, updateExtra:()=>null
};
const TecRealtime = {
  state:()=>({events}),
  motorContext:()=>null,
  ingest:()=>({ok:true})
};
const TecIntegracaoScreen = { state:()=>({questions:libraryQuestions}) };
const PlanManager = { getPlans:()=>[{id:'pre'},{id:'pos'}] };

const context = {
  window:{}, document, localStorage, DB, TecRealtime, TecIntegracaoScreen, PlanManager,
  console, Date, Math, JSON, String, Number, Object, Array, Map, Set, RegExp,
  encodeURIComponent, decodeURIComponent,
  setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  todayLocal:()=> '2026-09-15',
  escapeHtml:s=>String(s),
  _quiet(){}, showToast(){},
  globalThis:null
};
context.globalThis=context;
context.window=context;
vm.createContext(context);
vm.runInContext(main, context, {filename:'99-tec-lacunas-continuas.js'});
vm.runInContext(guards, context, {filename:'99b-tec-lacunas-guardas.js'});
const L=context.TecLacunasContinuas;
if (!L) throw new Error('Motor não foi exposto.');

function add({id,qid,materia,assunto,acertou,at,book='base',favorite=false}) {
  events[id]={eventId:id,questionId:String(qid),tecAccount:'tec_test',bookId:book,resolvedAt:at,localDate:at.slice(0,10),acertou,materia,assunto,banca:'FGV',concurso:'Teste',favorite};
}

// Mesma questão em base + favoritas: continua 1 ID, mas cada erro mede resistência.
add({id:'e1',qid:101,materia:'Direito Tributário',assunto:'Isenção',acertou:false,at:'2026-09-15T08:00:00',book:'base'});
add({id:'e2',qid:101,materia:'Direito Tributário',assunto:'Isenção',acertou:false,at:'2026-09-15T08:20:00',book:'favoritas',favorite:true});
add({id:'e3',qid:101,materia:'Direito Tributário',assunto:'Isenção',acertou:true,at:'2026-09-15T09:00:00',book:'erradas-favoritas'});
add({id:'e4',qid:102,materia:'Direito Tributário',assunto:'Isenção',acertou:true,at:'2026-09-10T10:00:00',book:'base'});

// Três matérias abertas para o rodízio.
add({id:'e5',qid:201,materia:'Auditoria',assunto:'Materialidade',acertou:false,at:'2026-09-15T10:00:00'});
add({id:'e6',qid:301,materia:'Contabilidade Geral',assunto:'Custos',acertou:false,at:'2026-09-15T10:10:00'});
add({id:'e7',qid:401,materia:'Tecnologia da Informação',assunto:'Segurança',acertou:false,at:'2026-09-15T10:20:00'});

// Questão que só existia na biblioteca/importação antiga também deve entrar.
libraryQuestions['tec_test:legacy:501']={
  key:'legacy',tecAccount:'tec_test',bookId:'legacy',receivedAt:'2026-09-14T12:00:00',
  question:{id:'501',materia:'Direito Administrativo',assunto:'Atos administrativos',acertou:false,marcada:'A',correta:'B'}
};

let topics=L.topics();
const trib=topics.find(t=>t.disciplina==='Direito Tributário'&&t.assunto==='Isenção');
if (!trib) throw new Error('Tópico tributário não encontrado.');
if (trib.uniqueWrong!==1) throw new Error(`Mesmo ID foi inflado: uniqueWrong=${trib.uniqueWrong}`);
if (trib.repeatErrors!==1) throw new Error(`Reincidência deveria ser 1, veio ${trib.repeatErrors}`);
if (!trib.naturalRecovered || trib.unresolvedWrong!==0 || trib.correctedWrong!==1) throw new Error('Zeragem natural não foi reconhecida.');
if (!trib.naturalCooldown) throw new Error('Zeragem de hoje deveria entrar em resfriamento curto.');
const poolTrib=L.questionPool(trib);
if (new Set(poolTrib.map(x=>x.id)).size!==poolTrib.length) throw new Error('Pool repetiu questionId.');
if (poolTrib.length!==2) throw new Error(`Pool do tópico deveria ter 2 IDs distintos, veio ${poolTrib.length}.`);

const legacy=L.events().find(e=>e.questionId==='501');
if (!legacy || legacy.source!=='library-backfill') throw new Error('Biblioteca antiga não entrou como backfill.');

// Com 2 matérias já usadas/concluídas hoje, só pode nascer MAIS UMA — máximo 3 no dia inteiro.
const state=L.state();
state.days['2026-09-15']={day:'2026-09-15',planId:'pre',assignments:[
  {id:'a1',disciplina:'Auditoria',assunto:'Outro',status:'completed',target:3,progress:3},
  {id:'a2',disciplina:'Contabilidade Geral',assunto:'Outro',status:'completed',target:3,progress:3}
]};
const candidates=L.candidates(state);
if (candidates.length!==1) throw new Error(`Teto diário estrito esperava 1 candidato restante, vieram ${candidates.length}.`);
if (['Auditoria','Contabilidade Geral'].includes(candidates[0]?.disciplina)) throw new Error('Rodízio tentou repetir matéria já usada hoje.');
if (candidates.some(x=>x.naturalCooldown)) throw new Error('Tópico recém-zerado entrou de novo imediatamente.');

// Progresso entre planos usa offset + progresso local, não soma cega nem perde passado.
L.allPlanExtras=()=>[
  {planId:'pre',extra:{id:'x1',progresso:2,status:'ativa',origemLacunaGlobal:{assignmentId:'global1',globalProgressBefore:0}}},
  {planId:'pos',extra:{id:'x2',progresso:1,status:'ativa',origemLacunaGlobal:{assignmentId:'global1',globalProgressBefore:2}}}
];
const p=L.assignmentProgress({id:'global1',target:5,progress:2});
if (p.progress!==3) throw new Error(`Progresso global deveria ser 3, veio ${p.progress}.`);

// A lente muda sem destruir a memória: assunto de disciplina fora do plano fica irrelevante, não some dos tópicos.
activeSubjects=['Auditoria'];
topics=L.topics();
const admin=topics.find(t=>t.disciplina==='Direito Administrativo');
if (!admin || admin.relevant!==false) throw new Error('Lente do planejamento não marcou histórico fora do plano como irrelevante.');
if (!topics.find(t=>t.disciplina==='Auditoria')?.relevant) throw new Error('Disciplina do planejamento deveria permanecer relevante.');

console.log('LACUNAS CONTÍNUAS LÓGICA: deduplicação, zeragem, backfill, teto diário, rodízio, lente e progresso global validados.');
