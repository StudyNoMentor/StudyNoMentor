/* ============================================================================
   ROBUSTO V4 — otimizador global
   Seleciona até 3 disciplinas em conjunto. Não altera alvo global; pode ajustar
   somente a dose diária sugerida para caber no orçamento da rodada.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoRobustoOptimizerV4) return;
  window.__planoRobustoOptimizerV4 = true;
  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,n(v,a)));
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const O={
    VERSAO:4,
    _u(c,w){const x=c.componentes||{};return n(w.pesoPontos)*n(x.pontos)+n(w.pesoPPM)*n(x.ppm)+n(w.pesoLacuna)*n(x.lacuna)+n(w.pesoIncidencia)*n(x.incidencia)+n(w.pesoRecencia)*n(x.recencia)+n(w.pesoResposta)*n(x.resposta)+n(w.pesoEvidencia)*n(x.evidencia)+n(w.pesoEficiencia)*n(x.eficiencia)+(c.item&&c.item.eliminatoria?n(w.bonusEliminatoria):0);},
    _tempo(c,w){const iv=c.intervencaoV4||c.intervencao;if(iv&&n(iv.minutosEstimados)>0)return n(iv.minutosEstimados);const t=c.mentor&&c.mentor.tempo;if(t&&t.confiavel&&n(t.segundosPorQuestao)>0)return Math.max(n(w.minFrenteMin,10),Math.min(n(w.orcamentoMin,90)*n(w.maxFrentePct,45)/100,n(c.doseDiaria,12)*n(t.segundosPorQuestao)/60));return Math.max(n(w.minFrenteMin,10),25);},
    _candidatos(todos,cfg){const w=cfg.otimizador||{},rec=cfg.recursos||{};return (todos||[]).map(c=>{const util=this._u(c,w),mins=this._tempo(c,w),ef=util/Math.max(1,mins);return{c,util,mins,ef};}).sort((a,b)=>b.ef-a.ef||b.util-a.util).slice(0,24);},
    _combos(arr,k=3){const out=[];const rec=(ini,sel,discs)=>{if(sel.length===k){out.push(sel.slice());return;}for(let i=ini;i<arr.length;i++){const d=norm(arr[i].c.disciplina);if(!d||discs.has(d))continue;const nd=new Set(discs);nd.add(d);sel.push(arr[i]);rec(i+1,sel,nd);sel.pop();if(out.length>6000)return;}};rec(0,[],new Set());return out;},
    selecionar(todos,cfg){
      const rec=cfg.recursos||{},w=cfg.otimizador||{};if(!rec.otimizadorAtivo)return{itens:(todos||[]).slice().sort((a,b)=>n(b.score)-n(a.score)).filter((x,i,a)=>a.findIndex(y=>norm(y.disciplina)===norm(x.disciplina))===i).slice(0,3),meta:{ativo:false,motivo:'desligado'}};
      const arr=this._candidatos(todos,cfg),discN=new Set(arr.map(x=>norm(x.c.disciplina)).filter(Boolean)).size,k=Math.min(3,discN);if(!k)return{itens:[],meta:{ativo:true,motivo:'sem-candidatos'}};
      const combos=this._combos(arr,k);let best=null;for(const combo of combos){const tempo=combo.reduce((s,x)=>s+x.mins,0),util=combo.reduce((s,x)=>s+x.util,0),ex=Math.max(0,tempo-n(w.orcamentoMin,90))/Math.max(1,n(w.orcamentoMin,90)),obj=util-n(w.penalidadeExcesso,1.5)*ex+(combo.length===3?.04*combo.length:0);if(!best||obj>best.obj)best={combo,tempo,util,obj,ex};}
      if(!best){const itens=arr.slice(0,k).map(x=>x.c);return{itens,meta:{ativo:true,motivo:'fallback-guloso'}};}
      const budget=n(w.orcamentoMin,90),cap=budget*n(w.maxFrentePct,45)/100,itens=best.combo.map(z=>{const c=Object.assign({},z.c),vel=c.mentor&&c.mentor.tempo,aloc=Math.max(n(w.minFrenteMin,10),Math.min(cap,z.mins));let dose=c.doseDiaria;if(vel&&vel.confiavel&&n(vel.segundosPorQuestao)>0)dose=Math.max(5,Math.min(n(c.alvo,999),Math.floor(aloc*60/n(vel.segundosPorQuestao))));c.doseDiaria=dose||c.doseDiaria;c.otimizacaoV4={utilidade:Math.round(z.util*10000)/10000,eficienciaMinuto:Math.round(z.ef*10000)/10000,minutosIntervencao:Math.round(z.mins),minutosAlocados:Math.round(aloc),orcamentoMin:budget};return c;});
      return{itens,meta:{ativo:true,orcamentoMin:budget,tempoEstimadoMin:Math.round(best.tempo),objetivo:Math.round(best.obj*10000)/10000,utilidade:Math.round(best.util*10000)/10000,excessoPct:Math.round(best.ex*1000)/10,combinacoesAvaliadas:combos.length,restricoes:['até 3 disciplinas distintas','1 tópico por disciplina','alvo global imutável','dose diária limitada pelo orçamento']}};
    }
  };
  window.PlanoRobustoOptimizerV4=O;
})();
