import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../src/js/99l-tec-reconstrucao-caderno.js',import.meta.url),'utf8');
const ackV2=readFileSync(new URL('../companion/src/study-reconstruct-ack-v2.js',import.meta.url),'utf8');
const pressureV2=readFileSync(new URL('../companion/src/tec-reconstruct-backpressure-v2.js',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('../companion/manifest.json',import.meta.url),'utf8'));
const context={
  console,Date,Math,JSON,Promise,Number,String,Array,Object,Map,Set,RegExp,
  crypto:{randomUUID:()=> 'test-uuid'},
  setTimeout:()=>1,clearTimeout:()=>{},
  localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
  document:{readyState:'loading',addEventListener:()=>{},getElementById:()=>null},
  window:{addEventListener:()=>{},CloudStore:null,TecRealtime:null,TecIntegracaoScreen:null}
};
vm.createContext(context);
vm.runInContext(source,context,{filename:'99l-tec-reconstrucao-caderno.js'});
const H=context.window.TecHistoricalReconstruction;

function ok(cond,msg){if(!cond)throw new Error(msg);}

ok(H,'módulo não publicou TecHistoricalReconstruction');
ok(H.parseBookId('123456')==='123456','não aceitou ID numérico');
ok(H.parseBookId('https://www.tecconcursos.com.br/questoes/cadernos/987654')==='987654','não extraiu ID do link do caderno');
ok(H.parseBookId('https://example.com/987654')===null,'aceitou URL alheia como caderno');

/* Contrato V2: ACK só existe junto de verificação + backpressure no runner. */
ok(ackV2.includes("type:'tec-reconstruct-batch-ack'"),'guard V2 não emite ACK de persistência');
ok(ackV2.includes('verifyQuestions(payload)'),'guard V2 não verifica persistência antes do ACK');
ok(ackV2.includes('tec-reconstruct-applied-batches-v2'),'guard V2 não possui ledger idempotente de lotes');
ok(pressureV2.includes("kind:'tec-reconstruct-batch-state'"),'runner V2 não consulta estado do lote');
ok(pressureV2.includes('ACK_TIMEOUT_MS'),'runner V2 não possui timeout contra loop');
const isolatedTec=manifest.content_scripts.find(row=>Array.isArray(row.js)&&row.js.includes('src/tec-reconstruct.js'));
ok(isolatedTec,'manifest não carrega runner de reconstrução');
ok(isolatedTec.js.indexOf('src/tec-reconstruct-backpressure-v2.js')>=0&&isolatedTec.js.indexOf('src/tec-reconstruct-backpressure-v2.js')<isolatedTec.js.indexOf('src/tec-reconstruct.js'),'backpressure precisa carregar antes do runner');
const mainStudy=manifest.content_scripts.find(row=>row.world==='MAIN'&&Array.isArray(row.js)&&row.js.includes('src/study-reconstruct-ack-v2.js'));
ok(mainStudy,'manifest não carrega ACK V2 no MAIN world do Study');

const q={id:'40001',materia:'Direito Tributário',assunto:'Crédito tributário',banca:'CEBRASPE',concurso:'SEFAZ'};
const day=H.makeEvent({account:'tec_1',bookId:'10',question:q,acertou:true,marcada:'B',correta:'B',date:'15/09/2026',attemptKey:'latest',source:'test'});
ok(day&&day.localDate==='2026-09-15','data BR não foi normalizada');
ok(day.resolvedAt==='2026-09-15T12:00:00','dia sem horário não recebeu marcador neutro de meio-dia');
ok(day.integrity?.datePrecision==='day','precisão diária não foi explicitada');
ok(day.integrity?.status==='verified'&&day.integrity?.confidence==='high','evento coerente não ficou verificado');

const same=H.makeEvent({account:'tec_1',bookId:'10',question:q,acertou:true,marcada:'B',correta:'B',date:'15/09/2026',attemptKey:'latest',source:'test'});
ok(same.eventId===day.eventId,'event_id reconstruído não é determinístico');
ok(H.makeEvent({account:'tec_1',bookId:'10',question:q,acertou:true,marcada:'A',correta:'B',date:'15/09/2026',attemptKey:'x'})===null,'resultado incoerente virou evento');
ok(H.makeEvent({account:'tec_1',bookId:'10',question:q,acertou:false,marcada:null,correta:'B',date:'15/09/2026',attemptKey:'x'})===null,'resposta marcada ausente virou evento');
ok(H.makeEvent({account:'tec_1',bookId:'10',question:q,acertou:false,marcada:'A',correta:'B',date:null,attemptKey:'x'})===null,'tentativa sem data virou evento');

const built=H.eventsFromRow({
  question:{...q,correta:'B'},
  history:{
    total:3,acertos:1,erros:2,
    attempts:[
      {index:0,acertou:true,alternativa:'B',resolvedAt:'2026-09-15T10:30:00'},
      {index:1,acertou:false,alternativa:'A',resolvedAt:null},
      {index:2,acertou:false,alternativa:null,resolvedAt:'2026-09-10T12:00:00'}
    ]
  }
},'tec_1','10');
ok(built.events.length===1,'tentativas sem evidência suficiente foram promovidas');
ok(built.undated===1,'tentativa sem data não foi contabilizada como não datada');
ok(built.unverifiable===1,'tentativa datada sem alternativa não foi classificada como não verificável');
ok(built.events[0].resolvedAt.startsWith('2026-09-15T10:30:00'),'timestamp individual foi perdido');
ok(built.events[0].integrity.datePrecision==='instant','timestamp individual não preservou precisão instantânea');

const legacy=H.rowsFromLegacyJSON({
  cadernoId:'10',contaTec:'tec_1',
  resultados:{'40001':{acertou:false,dataResolucao:'14/09/2026'}},
  resultadosOficiais:{},
  desempenhoQuestoes:{'40001':{total:7,acertos:4,erros:3,ultimoResultado:'erro',ultimaAlternativa:'A',consistente:true}},
  questoes:[{...q,marcada:'A',correta:'B',acertou:false}]
});
ok(legacy.length===1,'JSON legado não gerou linha de reconstrução');
ok(legacy[0].history?.total===7&&legacy[0].history?.erros===3,'desempenhoQuestoes do Tampermonkey foi perdido');
ok(legacy[0].question.integrity?.status==='verified','JSON com marcada+gabarito coerentes não foi verificado');
ok(legacy[0].latest?.dataResolucao==='14/09/2026','data oficial do JSON não foi preservada');

console.log('RECONSTRUÇÃO TEC V2: link/ID, ACK persistente, backpressure, contratos factuais, datas e JSON legado válidos.');
