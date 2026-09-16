import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const p=fs.readFileSync(new URL('../src/js/99p-tec-reconciliacao-multidispositivo.js',import.meta.url),'utf8');
const q=fs.readFileSync(new URL('../src/js/99q-tec-reconciliation-guard.js',import.meta.url),'utf8');
const window={};
const document={readyState:'complete',addEventListener(){}};
const context=vm.createContext({window,document,console,setTimeout:()=>0,clearTimeout(){},Date,JSON,Math,Object,Array,String,Number,Set,Map,RegExp});
vm.runInContext(p,context,{filename:'99p-tec-reconciliacao-multidispositivo.js'});
vm.runInContext(q,context,{filename:'99q-tec-reconciliation-guard.js'});
const R=window.TecReconciliationV3;
assert.equal(R.STRICT_INSTANT_TOLERANCE_MS,5000);
assert.equal(typeof R.strictFindMatch,'function');

const base={bookId:'100',questionId:'200',acertou:true,marcada:'C',correta:'C',tecAccount:'conta-nao-identificada',accountConfidence:'unknown',datePrecision:'instant'};
const a={...base,eventId:'a',resolvedAt:'2026-09-16T10:00:00Z',localDate:'2026-09-16'};
const near={...base,eventId:'near',resolvedAt:'2026-09-16T10:00:04Z',localDate:'2026-09-16'};
const distinct={...base,eventId:'distinct',resolvedAt:'2026-09-16T10:00:12Z',localDate:'2026-09-16'};
assert.equal(R.strictFindMatch([a],near),a,'mesmo fato com diferença <=5s deve reconciliar');
assert.equal(R.strictFindMatch([a],distinct),null,'duas tentativas exatas além de 5s devem permanecer distintas');

const dayOnly={...base,eventId:'day',resolvedAt:'2026-09-16T12:00:00',localDate:'2026-09-16',datePrecision:'day'};
assert.equal(R.strictFindMatch([a],dayOnly),a,'Gabarito com precisão diária deve validar a tentativa compatível do dia');
const differentResult={...dayOnly,acertou:false,marcada:'A'};
assert.equal(R.strictFindMatch([a],differentResult),null,'resultado/alternativa diferentes nunca podem ser fundidos');
const otherBook={...dayOnly,bookId:'101'};
assert.equal(R.strictFindMatch([a],otherBook),null,'cadernos diferentes nunca podem ser reconciliados');

console.log('TEC RECONCILIATION GUARD OK — ingestão conservadora e janela exata de 5s validadas.');
