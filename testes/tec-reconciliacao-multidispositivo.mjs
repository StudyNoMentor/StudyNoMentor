import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../src/js/99p-tec-reconciliacao-multidispositivo.js',import.meta.url),'utf8');
const window={};
const document={readyState:'complete',addEventListener(){}};
const context=vm.createContext({window,document,console,setTimeout:()=>0,clearTimeout(){},Date,JSON,Math,Object,Array,String,Number,Set,Map,RegExp});
vm.runInContext(code,context,{filename:'99p-tec-reconciliacao-multidispositivo.js'});
const R=window.TecReconciliationV3;
assert.ok(R,'API de reconciliação deve ser publicada');

const base={bookId:'100',questionId:'200',acertou:true,marcada:'C',correta:'C',tecAccount:'conta-nao-identificada',accountConfidence:'unknown'};
const live={...base,eventId:'live-random',resolvedAt:'2026-09-16T14:03:04.000Z',localDate:'2026-09-16',datePrecision:'instant',dateSource:'client-capture'};
const recon={...base,eventId:'recon-random',resolvedAt:'2026-09-16T12:00:00',localDate:'2026-09-16',datePrecision:'day',dateSource:'tec-gabarito'};
assert.equal(R.findMatch([live],recon),live,'Gabarito do mesmo dia deve reconciliar com a captura ao vivo já existente');

const merged=R.mergeEvent(live,recon);
assert.equal(merged.eventId,'live-random');
assert.equal(merged.resolvedAt,'2026-09-16T14:03:04.000Z','data diária do Gabarito não deve destruir horário exato já capturado');
assert.equal(merged.localDate,'2026-09-16');
assert.equal(merged.datePrecision,'instant');
assert.match(merged.dateSource,/tec-gabarito/);

const again=R.findMatch([merged],{...recon,eventId:'outra-reconstrucao'});
assert.equal(again,merged,'reconstruir novamente o mesmo caderno deve ser idempotente');

const phone={...base,questionId:'201',eventId:'phone',resolvedAt:'2026-09-15T12:00:00',localDate:'2026-09-15',datePrecision:'day',dateSource:'tec-gabarito'};
assert.equal(R.findMatch([merged],phone),null,'questão feita em outro dispositivo deve entrar como novo fato quando ainda não existe');

const otherBook={...recon,bookId:'101'};
assert.equal(R.findMatch([live],otherBook),null,'mesma questão/data em outro caderno nunca pode ser fundida');

const exact1={...base,resolvedAt:'2026-09-16T10:00:00Z',datePrecision:'instant'};
const exact2={...base,resolvedAt:'2026-09-16T10:05:00Z',datePrecision:'instant'};
assert.equal(R.findMatch([exact1],exact2),null,'duas tentativas com timestamps exatos distintos devem permanecer distintas');

const exactNear={...base,resolvedAt:'2026-09-16T10:00:12Z',datePrecision:'instant'};
assert.equal(R.findMatch([exact1],exactNear),exact1,'captura e timestamp TEC muito próximos devem reconciliar');

const strongA={...live,tecAccount:'tec_a',accountConfidence:'strong'};
const strongB={...recon,tecAccount:'tec_b',accountConfidence:'strong'};
assert.equal(R.findMatch([strongA],strongB),null,'contas TEC comprovadamente diferentes não podem ser fundidas');
const unknown={...recon,tecAccount:'conta-nao-identificada',accountConfidence:'unknown'};
assert.equal(R.findMatch([strongA],unknown),strongA,'conta desconhecida não pode gerar cópia artificial do mesmo fato');

const ref1={...base,resolutionRef:'resolucao-xyz',resolvedAt:'2026-09-16T10:00:00Z',datePrecision:'instant'};
const ref2={...base,resolutionRef:'resolucao-xyz',resolvedAt:'2026-09-16T10:07:00Z',datePrecision:'instant'};
assert.equal(R.canonicalKey(ref1),R.canonicalKey(ref2),'ID oficial de resolução deve dominar diferenças de representação temporal');
assert.equal(R.findMatch([ref1],ref2),ref1);

const dayA={...base,resolvedAt:'16/09/2026',localDate:'',datePrecision:'day'};
const dayB={...base,resolvedAt:'2026-09-16T12:00:00',localDate:'2026-09-16',datePrecision:'day'};
assert.equal(R.canonicalKey(dayA),R.canonicalKey(dayB),'DD/MM/AAAA e ISO diário devem produzir a mesma identidade canônica');

/* Fuzz determinístico: a mesma tentativa reconstruída N vezes nunca cresce. */
let seed=0x6d2b79f5;
const rnd=()=>{seed=(Math.imul(seed^seed>>>15,1|seed)+0x6d2b79f5)|0;seed^=seed+Math.imul(seed^seed>>>7,61|seed);return((seed^seed>>>14)>>>0)/4294967296;};
for(let i=0;i<50000;i++){
  const book=String(1000+Math.floor(rnd()*20)),qid=String(2000000+Math.floor(rnd()*500));
  const correct=['A','B','C','D','E'][Math.floor(rnd()*5)],ok=rnd()>.35;
  let marked=correct;if(!ok){do{marked=['A','B','C','D','E'][Math.floor(rnd()*5)];}while(marked===correct);}
  const day=`2026-09-${String(1+Math.floor(rnd()*16)).padStart(2,'0')}`;
  const a={bookId:book,questionId:qid,acertou:ok,marcada:marked,correta:correct,resolvedAt:`${day}T12:00:00`,localDate:day,datePrecision:'day',tecAccount:'conta-nao-identificada'};
  const b={...a,resolvedAt:day.split('-').reverse().join('/'),eventId:'nova-copia'};
  assert.equal(R.canonicalKey(a),R.canonicalKey(b));
}

console.log('TEC RECONCILIAÇÃO MULTIDISPOSITIVO V3 OK — 50.000 identidades + cenários de captura/reconstrução validados.');
