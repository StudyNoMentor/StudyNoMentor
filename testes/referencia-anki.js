/* ═══════════════════════════════════════════════════════════════════════════
   REFERÊNCIA — porte direto do Anki, para o teste diferencial
   ───────────────────────────────────────────────────────────────────────────
   Este arquivo NÃO faz parte do aplicativo. Ele é uma segunda implementação,
   escrita a partir do código-fonte do Anki, contra a qual o agendador do app é
   comparado em `testes/paridade-anki.mjs`.

   Por que uma segunda implementação em vez de vetores fixos: um vetor copiado
   do próprio app não testa nada — ele congela o bug junto. Duas implementações
   independentes que concordam em dezenas de milhares de pontos, sim.

   Traduzido linha a linha de:
     open-spaced-repetition/fsrs-rs  →  src/model.rs
                                        src/parameter_clipper.rs
     ankitects/anki                  →  rslib/src/scheduler/states/fuzz.rs

   REGRA: ao atualizar, traduza o Rust de novo — nunca "ajuste até bater com o
   app". Se os dois divergirem, quem está errado é o app até prova em contrário.
   ═══════════════════════════════════════════════════════════════════════════ */
const F=Math.fround;   // fsrs-rs calcula em f32: cada operação arredonda para f32.
const S_MIN=0.001,S_MAX=36500,D_MIN=1,D_MAX=10;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const W=w=>w.map(x=>F(x));
const fac=w=>{const decay=F(-w[20]);return F(F(Math.exp(F(F(Math.log(F(0.9)))/decay)))-1);};
const pfc=(w,t,s)=>{w=W(w);const decay=F(-w[20]);return F(Math.pow(F(F(F(F(t)/F(s))*fac(w))+1),decay));};
const nextInterval=(w,s,dr)=>{w=W(w);const decay=F(-w[20]);return F(F(F(s)/fac(w))*F(F(Math.pow(F(dr),F(1/decay)))-1));};
const initS=(w,r)=>F(w[Math.min(3,Math.max(0,r-1))]);
const initD=(w,r)=>{w=W(w);return F(F(w[4]-F(Math.exp(F(w[5]*F(r-1)))))+1);};
const meanRev=(w,nd)=>{w=W(w);nd=F(nd);return F(F(w[7]*F(initD(w,4)-nd))+nd);};
const linDamp=(dd,od)=>F(F(F(10-F(od))*F(dd))/9);
const nextD=(w,d,r)=>{w=W(w);d=F(d);return F(d+linDamp(F(F(-w[6])*F(r-3)),d));};
const sSucc=(w,ls,ld,r,rat)=>{w=W(w);ls=F(ls);ld=F(ld);r=F(r);const hp=rat===2?w[15]:1,eb=rat===4?w[16]:1;
  let a=F(Math.exp(w[8]));a=F(a*F(11-ld));a=F(a*F(Math.pow(ls,F(-w[9]))));a=F(a*F(F(Math.exp(F(F(1-r)*w[10])))-1));
  a=F(a*hp);a=F(a*eb);return F(ls*F(a+1));};
const sFail=(w,ls,ld,r)=>{w=W(w);ls=F(ls);ld=F(ld);r=F(r);let ns=F(w[11]*F(Math.pow(ld,F(-w[12]))));
  ns=F(ns*F(F(Math.pow(F(ls+1),w[13]))-1));ns=F(ns*F(Math.exp(F(F(1-r)*w[14]))));
  return Math.min(ns, F(ls/F(Math.exp(F(w[17]*w[18])))));};
const sShort=(w,ls,rat)=>{w=W(w);ls=F(ls);const sinc=F(F(Math.exp(F(w[17]*F(F(rat-3)+w[18]))))*F(Math.pow(ls,F(-w[19]))));
  return F(ls*(rat>=2?Math.max(sinc,1):sinc));};
function step(w,deltaT,rating,state,nth){
  const lastS=clamp(F(state.stability),F(S_MIN),S_MAX), lastD=clamp(F(state.difficulty),D_MIN,D_MAX);
  const r=pfc(w,deltaT,lastS);
  let newS = rating===1 ? sFail(w,lastS,lastD,r) : sSucc(w,lastS,lastD,r,rating);
  if(deltaT===0) newS=sShort(w,lastS,rating);
  let newD=clamp(meanRev(w,nextD(w,lastD,rating)),D_MIN,D_MAX);
  if(nth===0 && state.stability===0){const ir=clamp(rating,1,4);newS=initS(w,ir);newD=clamp(initD(w,ir),D_MIN,D_MAX);}
  if(rating===0){newS=lastS;newD=lastD;}
  return {stability:clamp(newS,F(S_MIN),S_MAX),difficulty:newD};
}
// fuzz.rs
const FUZZ=[[2.5,7,0.15],[7,20,0.1],[20,Number.MAX_VALUE,0.05]];
const f32round=x=>Math.sign(x)*Math.floor(Math.abs(x)+0.5);
function fuzzDelta(iv){if(iv<2.5)return 0;return FUZZ.reduce((d,[a,b,f])=>d+f*Math.max(0,Math.min(iv,b)-a),1.0);}
function fuzzBounds(iv){const d=fuzzDelta(iv);return [f32round(iv-d),f32round(iv+d)];}
function constrainedFuzzBounds(iv,minimum,maximum){
  minimum=Math.min(minimum,maximum); iv=clamp(iv,minimum,maximum);
  let [lo,hi]=fuzzBounds(iv); lo=clamp(lo,minimum,maximum); hi=clamp(hi,minimum,maximum);
  if(hi===lo&&hi>2&&hi<maximum) hi=lo+1; return [lo,hi];
}
function minimumReviewFuzzInterval(iv,prev,maxIv){
  const rounded=f32round(iv); const [,hi]=constrainedFuzzBounds(iv,1,maxIv);
  if(rounded>prev) return prev+1;
  if(prev<=hi) return prev;
  return 0;
}
// parameter_clipper.rs
function clipParams(p,nRelearn,shortTerm){
  const ceil17 = nRelearn>1
    ? Math.min(2.0, Math.sqrt(Math.max(0.01, -(Math.log(p[11])+Math.log(Math.pow(2,p[13])-1)+p[14]*0.3)/nRelearn)))
    : 2.0;
  const w19f = shortTerm?0.01:0.0;
  const C=[[0.001,100],[0.001,100],[0.001,100],[0.001,100],[1,10],[0.001,4],[0.001,4],[0.001,0.75],
    [0,4.5],[0,0.8],[0.001,3.5],[0.001,5],[0.001,0.25],[0.001,0.9],[0,4],[0,1],[1,6],
    [0,ceil17],[0,ceil17],[w19f,0.8],[0.1,0.8]];
  return p.map((v,i)=>clamp(v,C[i][0],C[i][1]));
}
module.exports={pfc,nextInterval,initS,initD,nextD,meanRev,sSucc,sFail,sShort,step,
  fuzzDelta,fuzzBounds,constrainedFuzzBounds,minimumReviewFuzzInterval,clipParams,clamp,S_MIN,S_MAX};
