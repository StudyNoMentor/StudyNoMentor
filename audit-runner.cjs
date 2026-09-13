const fs=require('fs'),vm=require('vm');
const data=new Map(),els=new Map();
function el(id){if(!els.has(id))els.set(id,{value:'',style:{},disabled:false,textContent:'',addEventListener(){},classList:{add(){},remove(){},toggle(){}}});return els.get(id);}
const ctx={console,Date,Math,Map,Set,Object,Array,JSON,Number,String,RegExp,Intl,Promise,Uint8Array,DataView,TextDecoder,TextEncoder,Blob,Response,DecompressionStream,performance,parseInt,parseFloat,isFinite,isNaN,setTimeout,clearTimeout,
 localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)},
 document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},$id:el,window:{},
 todayLocal:()=> '2026-09-12',formatDateShort:x=>x,escapeHtml:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'),_quiet:()=>{},showToast:()=>{},
 DB:{KEYS:{tec:'tec'},_profilePrefix:()=> 'audit:',_get:(k,d)=>data.has(k)?JSON.parse(data.get(k)):d,_set:(k,v)=>data.set(k,JSON.stringify(v)),setRaw:(k,v)=>data.set(k,v),delRaw:k=>data.delete(k),getTecSnapshots:()=>[],getIncidencia:()=>[],getActiveSubjects:()=>[],getSubjects:()=>[],getEntries:()=>[],getExtras:()=>[],getTrack:()=>[],getCycle:()=>[],getTecLinks:()=>({})},
 planCycleMode:()=> 'pre'};
vm.createContext(ctx);
for(const f of ['16-planilhas-e-tec.js','17-reforco.js','51-tela-desempenho-tec.js']){let s=fs.readFileSync('src/js/'+f,'utf8');if(f.startsWith('51'))s=s.split('// Um toque fora fecha o seletor')[0];vm.runInContext(s,ctx,{filename:f});}
vm.runInContext(fs.readFileSync('audit-tests.js','utf8'),ctx);
const result=vm.runInContext('runTecAudit()',ctx,{timeout:120000});
fs.writeFileSync('audit-results.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({total:result.tests.length,passed:result.tests.filter(t=>t.pass).length,failed:result.tests.filter(t=>!t.pass),benchmarks:result.benchmarks},null,2));
