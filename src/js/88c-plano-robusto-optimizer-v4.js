/* ============================================================================
   ROBUSTO — OTIMIZADOR GLOBAL V6
   O score estratégico do motor é a única função de valor. O otimizador apenas
   aplica restrições operacionais (tempo, diversidade e dose), sem criar um
   segundo cérebro com pesos concorrentes.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoRobustoOptimizerV6) return;
  window.__planoRobustoOptimizerV6 = true;
  window.__planoRobustoOptimizerV5 = true;
  window.__planoRobustoOptimizerV4 = true;
  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const O={
    VERSAO:6,
    _u(c){return Math.max(0,Math.min(1,n(c&&c.score)/100));},
    _tempoInfo(c,cfg){
      const w=cfg.otimizador||{},rec=cfg.recursos||{},iv=c.intervencaoV5||c.intervencaoV4||c.intervencao,t=c.mentor&&c.mentor.tempo,floor=Math.max(1,n(w.minFrenteMin,10)),budget=Math.max(1,n(w.orcamentoMin,90)),cap=Math.max(floor,budget*n(w.maxFrentePct,45)/100);
      let bruto,fonte='piso-configurado',confiavel=false;
      if(iv&&n(iv.minutosEstimados)>0&&(iv.tempoConfiavel||iv.tempoFonte==='fallback-configurado')){bruto=n(iv.minutosEstimados);fonte=iv.tempoFonte||'intervencao';confiavel=!!iv.tempoConfiavel;}
      else if(rec.tempoPessoalAtivo&&t&&t.confiavel&&n(t.segundosPorQuestao)>0){const q=Math.max(1,n(c.doseDiaria,12));bruto=Math.max(floor,q*n(t.segundosPorQuestao)/60+n(iv&&iv.minutosFixos));fonte='tempo-pessoal';confiavel=true;}
      else if(rec.fallbackTempoAtivo){const q=Math.max(1,n(c.doseDiaria,12));bruto=Math.max(floor,q*n(w.fallbackSegQuestao,120)/60+n(iv&&iv.minutosFixos));fonte='fallback-configurado';}
      else bruto=Math.max(floor,floor+n(iv&&iv.minutosFixos));
      const planejado=Math.max(floor,Math.min(cap,bruto));
      return{minutosBrutos:bruto,minutos:planejado,cap,fonte,confiavel};
    },
    _enriquecer(todos,cfg){return(todos||[]).map(c=>{const util=this._u(c),ti=this._tempoInfo(c,cfg),ef=util/Math.max(1,ti.minutos);return{c,util,mins:ti.minutos,minsBrutos:ti.minutosBrutos,cap:ti.cap,tempoFonte:ti.fonte,tempoConfiavel:ti.confiavel,ef};}).sort((a,b)=>b.ef-a.ef||b.util-a.util);},
    _candidatos(todos,cfg){
      const w=cfg.otimizador||{},lim=Math.max(6,Math.round(n(w.maxCandidatos,24))),all=this._enriquecer(todos,cfg),best=new Map();
      for(const z of all){const d=norm(z.c.disciplina);if(d&&!best.has(d))best.set(d,z);}
      const reservas=[...best.values()].sort((a,b)=>b.ef-a.ef||b.util-a.util).slice(0,Math.min(3,best.size,lim));
      const out=[],seen=new Set();
      for(const z of reservas){out.push(z);seen.add(z);}
      for(const z of all){if(out.length>=lim)break;if(seen.has(z))continue;out.push(z);seen.add(z);}
      return out;
    },
    _combos(arr,k=3,lim=6000){const out=[],LIM=Math.max(100,Math.round(n(lim,6000)));const rec=(ini,sel,discs)=>{if(out.length>=LIM)return;if(sel.length===k){out.push(sel.slice());return;}for(let i=ini;i<arr.length&&out.length<LIM;i++){const d=norm(arr[i].c.disciplina);if(!d||discs.has(d))continue;const nd=new Set(discs);nd.add(d);sel.push(arr[i]);rec(i+1,sel,nd);sel.pop();}};rec(0,[],new Set());return out;},
    selecionar(todos,cfg){
      const rec=cfg.recursos||{},w=cfg.otimizador||{};
      if(!rec.otimizadorAtivo)return{itens:(todos||[]).slice().sort((a,b)=>n(b.score)-n(a.score)).filter((x,i,a)=>a.findIndex(y=>norm(y.disciplina)===norm(x.disciplina))===i).slice(0,3),meta:{ativo:false,motivo:'desligado',valorCanonico:'score estratégico',restricoes:['3 disciplinas distintas','alvo global imutável']}};
      const arr=this._candidatos(todos,cfg),discN=new Set(arr.map(x=>norm(x.c.disciplina)).filter(Boolean)).size,k=Math.min(3,discN);if(!k)return{itens:[],meta:{ativo:true,motivo:'sem-candidatos'}};
      const combos=this._combos(arr,k,w.maxCombinacoes),budget=Math.max(1,n(w.orcamentoMin,90));let best=null;
      for(const combo of combos){const tempo=combo.reduce((s,x)=>s+x.mins,0),util=combo.reduce((s,x)=>s+x.util,0),ex=Math.max(0,tempo-budget)/budget,obj=util-n(w.penalidadeExcesso,1.5)*ex+(combo.length===3?n(w.bonusDiversidade,.04)*combo.length:0);if(!best||obj>best.obj)best={combo,tempo,util,obj,ex};}
      if(!best){const itens=arr.slice(0,k).map(x=>x.c);return{itens,meta:{ativo:true,motivo:'fallback-guloso',valorCanonico:'score estratégico'}};}
      const itens=best.combo.map(z=>{const c=Object.assign({},z.c),vel=c.mentor&&c.mentor.tempo,aloc=z.mins;let dose=Math.max(1,n(c.doseDiaria,1));if(rec.tempoPessoalAtivo&&vel&&vel.confiavel&&n(vel.segundosPorQuestao)>0)dose=Math.max(1,Math.min(dose,n(c.alvo,999),Math.floor(aloc*60/n(vel.segundosPorQuestao))));else if(rec.fallbackTempoAtivo)dose=Math.max(1,Math.min(dose,n(c.alvo,999),Math.floor(aloc*60/n(w.fallbackSegQuestao,120))));c.doseDiaria=dose;c.otimizacaoV5={versao:6,utilidade:Math.round(z.util*10000)/10000,eficienciaMinuto:Math.round(z.ef*10000)/10000,minutosEstimadosBrutos:Math.round(z.minsBrutos),minutosPlanejados:Math.round(z.mins),minutosAlocados:Math.round(aloc),capFrenteMin:Math.round(z.cap),tempoFonte:z.tempoFonte,tempoConfiavel:z.tempoConfiavel,orcamentoMin:budget,valorCanonico:'score estratégico'};c.otimizacaoV4=c.otimizacaoV5;return c;});
      return{itens,meta:{ativo:true,versao:6,orcamentoMin:budget,tempoPlanejadoMin:Math.round(best.tempo),objetivo:Math.round(best.obj*10000)/10000,utilidade:Math.round(best.util*10000)/10000,excessoPct:Math.round(best.ex*1000)/10,combinacoesAvaliadas:combos.length,candidatosConsiderados:arr.length,valorCanonico:'score estratégico após aprendizado/redutores',pesosEfetivos:null,pesosLegadosIgnorados:true,restricoes:['até 3 disciplinas distintas','1 tópico por disciplina','alvo global imutável','score estratégico é a única função de valor','tempo do objetivo = tempo que pode ser alocado','3 disciplinas preservadas antes do corte de candidatos','dose diária não aumenta acima da prescrição-base','sem inventar ritmo quando fallback está desligado']}};
    }
  };
  window.PlanoRobustoOptimizerV6=O;
  window.PlanoRobustoOptimizerV5=O;
  window.PlanoRobustoOptimizerV4=O;
})();
