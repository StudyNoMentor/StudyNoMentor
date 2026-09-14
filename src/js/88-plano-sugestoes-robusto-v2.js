/* ============================================================================
   MOTOR ROBUSTO V2 — PlanoEngine + Mentor 90+, independente do Simplificado
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoSugRobustoV2) return;
  window.__planoSugRobustoV2 = true;
  const I = window.PlanoSugestoesInfraV2, M90 = window.Mentor90V6 || window.Mentor90V5;
  if (!I || typeof PlanoEngine === 'undefined') return;
  const { num, clamp, norm } = I;

  const R = {
    VERSAO: 2,
    MOTOR: 'robusto-v3',
    deps: Object.freeze(['PlanoEngine','Mentor90V6','PlanoPontos','historico-extras']),
    _casar(nome, candidatos) {
      const raiz=t=>{let r=t;for(let i=0;i<2;i++){if(r.length>4&&/[aos]$/.test(r))r=r.slice(0,-1);else break;}return r;};
      const vazias=new Set(['de','do','da','dos','das','e','em','no','na','nos','nas','para','com','a','o','as','os']);
      const toks=x=>norm(x).split(' ').filter(t=>t&&!vazias.has(t)).map(raiz), alvo=norm(nome), lista=(candidatos||[]).filter(Boolean);
      const ex=lista.filter(x=>norm(x)===alvo); if(ex.length===1)return{nome:ex[0],confianca:1,via:'exato'};
      const ta=toks(nome); if(!ta.length)return null;
      const sub=lista.filter(x=>{const tb=toks(x);if(!tb.length)return false;const c=ta.length<=tb.length?ta:tb,g=ta.length<=tb.length?tb:ta;return c.every(t=>g.includes(t));});
      if(sub.length===1)return{nome:sub[0],confianca:.8,via:'tokens'};if(sub.length>1)return null;
      const abr=lista.filter(x=>{const tb=toks(x);if(tb.length!==ta.length)return false;return ta.every((t,i)=>{const u=tb[i],c=t.length<=u.length?t:u,g=t.length<=u.length?u:t;return c.length>=3&&g.startsWith(c);});});
      return abr.length===1?{nome:abr[0],confianca:.72,via:'abreviacao'}:null;
    },
    _top3(cands) {
      const usados=new Set(),out=[];
      cands.slice().sort((a,b)=>num(b.score)-num(a.score)||num(a.taxa,999)-num(b.taxa,999)).forEach(c=>{const d=norm(c.disciplina);if(!d||usados.has(d)||out.length>=3)return;usados.add(d);out.push(c);});
      return out;
    },
    _pearson(xs,ys) {
      const n=Math.min(xs.length,ys.length);if(n<4)return 0;
      const mx=xs.reduce((s,v)=>s+v,0)/n,my=ys.reduce((s,v)=>s+v,0)/n;let a=0,b=0,c=0;
      for(let i=0;i<n;i++){const dx=xs[i]-mx,dy=ys[i]-my;a+=dx*dy;b+=dx*dx;c+=dy*dy;}
      return b>0&&c>0?clamp(a/Math.sqrt(b*c),-1,1):0;
    },
    politicaAprendida(fase) {
      const base=fase==='pos'?{pontos:.34,ppm:.24,lacuna:.14,incidencia:.10,recencia:.10,resposta:.08}:{lacuna:.34,evidencia:.22,incidencia:.12,recencia:.12,resposta:.12,eficiencia:.08};
      let hist=[];
      try {
        hist=(DB.getExtras?DB.getExtras():[]).filter(e=>{const s=e&&e.origemPlano&&e.origemPlano.sugestao,m=s&&s.motor;return(m==='robusto-v2'||m==='robusto-v3')&&e.origemPlano.veredito&&Number.isFinite(Number(e.origemPlano.veredito.ganhoPP))&&num(e.origemPlano.veredito.questoes)>0;});
      } catch(e) { if(typeof _quiet==='function')_quiet(e,'plano-robusto-v2-learning'); }
      const n=hist.length;
      if(n<12)return{pesos:base,n,aprendida:false,shrink:0,validacao:'amostra-insuficiente'};
      const ys=hist.map(e=>num(e.origemPlano.veredito.ganhoPP)/Math.max(1,num(e.origemPlano.veredito.questoes))*100),meio=Math.floor(n/2),shrink=Math.min(.45,n/(n+40)),pesos={},sinais={};
      Object.keys(base).forEach(k=>{
        const xs=hist.map(e=>num(e.origemPlano.sugestao.componentes&&e.origemPlano.sugestao.componentes[k]));
        const c1=this._pearson(xs.slice(0,meio),ys.slice(0,meio)),c2=this._pearson(xs.slice(meio),ys.slice(meio));
        const estavel=Math.sign(c1)===Math.sign(c2)&&Math.min(Math.abs(c1),Math.abs(c2))>=.10,corr=estavel?(c1+c2)/2:0;
        const mult=1+clamp(corr,-.5,.5)*.25*shrink;pesos[k]=base[k]*mult;sinais[k]={c1:Math.round(c1*1000)/1000,c2:Math.round(c2*1000)/1000,estavel};
      });
      const soma=Object.values(pesos).reduce((s,v)=>s+v,0)||1;Object.keys(pesos).forEach(k=>pesos[k]/=soma);
      return{pesos,n,aprendida:true,shrink,validacao:'duas-metades-sinal-estavel',sinais};
    },
    _completarPontos(r,opts) {
      if(!r||r.erro||typeof PlanoPontos==='undefined'||!PlanoPontos.temComposicao||!PlanoPontos.temComposicao())return;
      try {
        const itens=[...(r.itens||[]),...(r.pequenas||[])],comp=PlanoPontos.composicao?PlanoPontos.composicao():[];if(!itens.length||!comp.length)return;
        const discTec=[...new Set(itens.map(x=>norm(x.disciplina)).filter(Boolean))],peso=new Map();
        comp.forEach(m=>{const cas=this._casar(m.nome,discTec);if(!cas)return;const k=norm(cas.nome);peso.set(k,(peso.get(k)||0)+Math.max(0,num(m.valor)));});
        const denInc=new Map(),denQ=new Map();
        itens.forEach(x=>{const d=norm(x.disciplina);denInc.set(d,(denInc.get(d)||0)+Math.max(0,num(x.incid)));denQ.set(d,(denQ.get(d)||0)+Math.max(0,num(x.qHist,x.qJanela)));});
        const teto=Math.max(50,Math.min(100,num(opts.tetoDominio,90)));
        itens.forEach(x=>{const d=norm(x.disciplina),pm=Math.max(0,num(x.pontosMateria,peso.get(d)||0));if(!(pm>0))return;if(!(num(x.pontosMateria)>0))x.pontosMateria=pm;if(!(num(x.pontosGanho)>0)){const inc=Math.max(0,num(x.incid)),q=Math.max(0,num(x.qHist,x.qJanela)),share=(denInc.get(d)||0)>0?inc/denInc.get(d):(denQ.get(d)||0)>0?q/denQ.get(d):0,ganho=pm*share*Math.max(0,teto-num(x.taxa,teto))/100;x.pontosGanho=ganho;x.pontosPorQuestao=ganho/Math.max(1,num(x.custoQ,1));}});
      } catch(e) { if(typeof _quiet==='function')_quiet(e,'plano-robusto-v2-pontos'); }
    },
    _pool(r,p) {
      const bloqueadas=I.disciplinasBloqueadas(),vistos=new Set(),out=[];
      for(const x of [...(r.itens||[]),...(r.pequenas||[])]){
        const d=norm(x&&x.disciplina),k=d+'\u0001'+norm(x&&x.nome);
        if(!x||!x.nome||!d||bloqueadas.has(d)||vistos.has(k)||num(x.qJanela)<Math.max(1,num(p.minAmostra,20)))continue;
        let sobre=false;try{sobre=!!(PlanoEngine.atividadeSobreposta&&PlanoEngine.atividadeSobreposta(x.nome,x.disciplina,x.membros));}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-v2-sobreposicao');}
        if(sobre)continue;vistos.add(k);out.push(x);
      }
      return out;
    },
    calcular() {
      let p={};try{p=PlanoEngine.prefs?PlanoEngine.prefs():{};}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-v2-prefs');}
      const fase=I.fasePlano(),banca=p.banca&&p.banca!=='__todas__'?p.banca:'__todas__',snapshot=I.snapshot();
      if(!snapshot)return{erro:'sem-retrato',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};
      const opts=Object.assign({},p,{disciplina:'__todas__',limite:200,ordenar:fase==='pos'?'pontos':'rendimento'});let r;
      try{r=PlanoEngine.calcular(snapshot,opts);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-v2-calcular');return{erro:'sem-plano',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};}
      if(!r||r.erro)return{erro:(r&&r.erro)||'sem-plano',modo:'robusto',fase,itens:[],arquitetura:this.arquitetura()};
      if(typeof PlanoPontos!=='undefined'&&PlanoPontos.anexarPontos){try{PlanoPontos.anexarPontos(r,opts);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-v2-anexar');}}
      this._completarPontos(r,opts);
      const pool=this._pool(r,p);if(!pool.length)return{erro:'sem-candidatos',modo:'robusto',fase,itens:[],r,arquitetura:this.arquitetura()};
      const raw=pool.map(x=>{
        const dom=M90&&M90.dominio?M90.dominio(x,Object.assign({},r,{meta:p.metaDominio})):null;
        const cal0=M90&&M90.calibracaoHierarquica?M90.calibracaoHierarquica(x):null,cal=cal0?Object.assign({},cal0):null;
        const inc=M90&&M90.incidenciaNormalizada?M90.incidenciaNormalizada(x,Object.assign({},r,{banca})):null;
        const vel=M90&&M90.velocidade?M90.velocidade(x.disciplina):{confiavel:false};
        const calN=cal?Math.max(num(cal.nTopico),num(cal.nDisciplina),num(cal.n)):0,calConfiavel=calN>=Math.max(5,num(M90&&M90.MIN_CICLOS_PERSONALIZAR,5));
        if(cal&&!calConfiavel)cal.baixaResposta=false;
        const gap90=clamp((90-num(x.taxa,90))/90,0,1);
        const evidencia=dom?clamp(1-num(dom.pCompetitiva),0,1):clamp((num(p.metaDominio,85)-num(x.taxa,num(p.metaDominio,85)))/Math.max(1,num(p.metaDominio,85)),0,1);
        const incid=inc&&inc.pct!=null?Math.max(0,num(inc.pct)*num(inc.confianca,1)):Math.max(0,num(x.incid));
        const recencia=x.vencido?1:clamp(num(x.diasDesdeMedicao)/Math.max(1,num(r.validadeDias,p.validadeDias||120)),0,1);
        const resposta=cal&&calConfiavel?clamp((num(cal.ganho100,2.5)+2)/12,0,1):.5;
        const alvo=Math.max(1,Math.round(num(x.custoQ,20))),minutos=vel&&vel.confiavel?alvo*num(vel.segundosPorQuestao)/60:null,pontos=Math.max(0,num(x.pontosGanho));
        const ppm=minutos&&minutos>0?pontos/minutos:0,eficiencia=minutos&&minutos>0?gap90/minutos:1/Math.max(1,alvo);
        return{x,dom,cal,calConfiavel,inc,vel,gap90,evidencia,incid,recencia,resposta,alvo,minutos,pontos,ppm,eficiencia};
      });
      const mx=k=>Math.max(0,...raw.map(z=>Math.max(0,num(z[k])))),maxInc=mx('incid'),maxPts=mx('pontos'),maxPpm=mx('ppm'),maxEff=mx('eficiencia'),pol=this.politicaAprendida(fase),cands=[];
      raw.forEach(z=>{
        const comp=fase==='pos'?{pontos:maxPts?z.pontos/maxPts:0,ppm:maxPpm?z.ppm/maxPpm:0,lacuna:z.gap90,incidencia:maxInc?z.incid/maxInc:0,recencia:z.recencia,resposta:z.resposta}:{lacuna:z.gap90,evidencia:z.evidencia,incidencia:maxInc?z.incid/maxInc:0,recencia:z.recencia,resposta:z.resposta,eficiencia:maxEff?z.eficiencia/maxEff:0};
        let score=Object.keys(pol.pesos).reduce((s,k)=>s+num(pol.pesos[k])*num(comp[k]),0)*100;
        if(z.x.eliminatoria)score=Math.max(score,97);if(z.dom&&z.dom.nivel==='elite'&&!z.dom.vencido)score*=.2;else if(z.dom&&z.dom.nivel==='competitivo'&&!z.dom.vencido)score*=.45;
        let dose=null;if(M90&&M90.doseDiaria){try{dose=M90.doseDiaria(z.x,z.x.prescricaoAdaptativa,z.vel,z.dom||{nivel:'em_aquisicao'});}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-v2-dose');}}
        if(!(dose>0)&&z.vel&&z.vel.confiavel)dose=Math.max(5,Math.min(z.alvo,Math.floor((num(M90&&M90.MINUTOS_BLOCO,30)*60)/num(z.vel.segundosPorQuestao,120))));
        let interv=null;if(M90&&M90.intervencao&&z.dom&&z.cal){try{interv=M90.intervencao(z.x,z.x.prescricaoAdaptativa,z.dom,z.cal,Math.max(0,Math.round(num(dose,Math.min(z.alvo,12)))));}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-robusto-v2-intervencao');}}
        cands.push({
          item:z.x,disciplina:z.x.disciplina,nome:z.x.nome,taxa:num(z.x.taxa),qJanela:num(z.x.qJanela),modo:'robusto',fase,
          scoreBruto:score,score:clamp(score,0,100),alvo:z.alvo,doseDiaria:dose||null,meta:num(p.metaDominio,85),minAmostra:num(p.minAmostra,20),banca:fase==='pos'?banca:null,
          motivo:fase==='pos'?`${z.pontos.toFixed(2)} ponto(s) recuperáveis${z.minutos?` · ~${Math.max(1,Math.round(z.minutos))} min para o alvo global`:''}${z.x.eliminatoria?' · risco eliminatório':''}`:`${(z.gap90*100).toFixed(0)}% de lacuna competitiva · evidência ${(z.evidencia*100).toFixed(0)}%${z.dom?` · ${z.dom.rotulo}`:''}`,
          componentes:comp,mentor:{dominio:z.dom,calibracao:z.cal,incidencia:z.inc,tempo:z.vel},intervencao:interv,
          politica:{n:pol.n,aprendida:pol.aprendida,shrink:pol.shrink,validacao:pol.validacao,sinais:pol.sinais||null},
          configPlano:{metaOperacional:num(p.metaDominio,85),metaCompetitiva:90,minAmostra:num(p.minAmostra,20),banca,fase},
          auditoria:{formula:fase==='pos'?'pontos+ppm+lacuna+incidencia+recencia+resposta':'lacuna+evidencia+incidencia+recencia+resposta+eficiencia',fonte:'PlanoEngine + Mentor90',calibracaoConfiavel:z.calConfiavel,limiarCiclos:Math.max(5,num(M90&&M90.MIN_CICLOS_PERSONALIZAR,5))}
        });
      });
      const cfg={metaOperacional:num(p.metaDominio,85),metaCompetitiva:90,minAmostra:num(p.minAmostra,20),banca,fase};
      return{modo:'robusto',fase,banca:fase==='pos'?banca:null,itens:this._top3(cands),todos:cands,r,politica:pol,configPlano:cfg,arquitetura:this.arquitetura(),explicacao:'Plano atual + Mentor 90+ + custo temporal + resposta histórica. Não consome parâmetros nem score do Simplificado.'};
    },
    arquitetura(){return{motor:this.MOTOR,independente:true,usaSimplificado:false,deps:this.deps.slice()};}
  };
  window.PlanoSugestoesRobustoV2=R;
})();
