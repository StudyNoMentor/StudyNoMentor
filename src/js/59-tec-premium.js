/* ============================================================
   DESEMPENHO TEC — performance e cabeçalho factual
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__tecPremium) return;
  if (typeof window !== 'undefined') window.__tecPremium = true;
  if (typeof DesempenhoTecScreen === 'undefined') return;
  const DT = DesempenhoTecScreen;

  const TecPremium = {
    escopoResumo() {
      let snaps=[];try{snaps=DT.activeSnapshots?DT.activeSnapshots():DB.getTecSnapshots();}catch(_){snaps=[];}
      let all=[];try{all=DB.getTecSnapshots();}catch(_){all=[];}
      const ultimo=snaps.length?snaps[snaps.length-1]:null;
      const modo=DT.scopeMode==='all'||DT.scopeMode==='consolidado'?'Todos os retratos':DT.scopeMode==='range'?'Intervalo':'Retratos selecionados';
      return{ativos:snaps.length,total:all.length,modo,ultimo:ultimo&&(ultimo.endDate||ultimo.date||ultimo.startDate)||null};
    },
    tabNome(tab){return({analise:'Análise',motor:'Motor de sugestão',incidencia:'Incidência',importar:'Importar'})[tab]||tab||'Análise';},
    garantirComando() {
      const screen=document.getElementById('screen-desempenhotec');if(!screen)return null;
      let box=screen.querySelector('.tp-command');if(box)return box;
      box=document.createElement('section');box.className='tp-command';
      const head=screen.querySelector('.page-header');if(head)head.insertAdjacentElement('afterend',box);else screen.prepend(box);
      return box;
    },
    mensagemAba(tab) {
      if(tab==='analise') return {
        ic:'📊', rot:'Fatos do seu TEC',
        txt:'Nenhum modelo opina aqui. Esta aba mostra o seu histórico e deixa você ordenar a árvore por índice, pontos fortes ou pontos fracos.'
      };
      if(tab==='incidencia') return {
        ic:'🏛️', rot:'Fatos da banca',
        txt:'Aqui ficam apenas os dados de incidência importados. Eles entram como peso do Motor somente quando você usa o pós-edital.'
      };
      if(tab==='motor') {
        try {
          const p=window.MotorSugestao?MotorSugestao.prefs():null;
          if(p&&p.fase==='pos') return {ic:'🧭',rot:'Motor · pós-edital',txt:'Ordena as matérias pela lacuna simples até a meta; a incidência da banca apenas desempata lacunas iguais.'};
          if(p&&p.fase==='pre') return {ic:'🧭',rot:'Motor · pré-edital',txt:'Ordena as matérias pela distância simples até a meta e entra no pior tópico com amostra suficiente.'};
        } catch(e){if(typeof _quiet==='function')_quiet(e,'tp-fonte');}
        return {ic:'🧭',rot:'Motor de sugestão',txt:'Transforma os fatos do TEC em uma fila de reforço por matéria, tópico e subtópico.'};
      }
      return {ic:'📚',rot:this.tabNome(tab),txt:'Dados do Desempenho TEC.'};
    },
    /* O cabeçalho informa contexto, não oferece uma segunda camada de ajustes.
       Análise e Incidência são fatos; só o Motor decide prioridade. */
    atualizarComando() {
      const box=this.garantirComando();if(!box)return;
      // Remove qualquer sobra criada por versões antigas da sessão.
      document.querySelectorAll('.tp-overlay,[data-tp-settings],[data-tp-audit]').forEach(el=>el.remove());
      const s=this.escopoResumo(),tab=DT.tecTab||'analise',msg=this.mensagemAba(tab);
      const dataUlt=s.ultimo&&/^\d{4}-\d{2}-\d{2}/.test(String(s.ultimo))?String(s.ultimo).slice(0,10).split('-').reverse().join('/'):(s.ultimo||'—');
      let idade=null;
      try { if (s.ultimo && /^\d{4}-\d{2}-\d{2}/.test(String(s.ultimo))) idade=Math.floor((new Date(todayLocal()+'T00:00:00')-new Date(String(s.ultimo).slice(0,10)+'T00:00:00'))/86400000); }
      catch(e){ if(typeof _quiet==='function')_quiet(e,'tp-idade-retrato'); }
      let cadencia=30;
      try {
        const snaps=(DB.getTecSnapshots&&DB.getTecSnapshots())||[], gaps=[];
        const fim=x=>x&&(x.endDate||x.date||x.startDate);
        for(let i=1;i<snaps.length;i++){
          const a=fim(snaps[i-1]),b=fim(snaps[i]); if(!a||!b)continue;
          const d=Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);
          if(d>0)gaps.push(d);
        }
        gaps.sort((a,b)=>a-b); if(gaps.length)cadencia=gaps[gaps.length>>1];
      } catch(e){ if(typeof _quiet==='function')_quiet(e,'tp-cadencia'); }
      const velho=idade!=null&&idade>cadencia;
      const esc=(v)=>typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v);
      box.innerHTML=`<div class="tp-main"><div class="tp-eyebrow">${esc(msg.ic)} DESEMPENHO TEC · ${esc(msg.rot)}</div>
        <div class="tp-title"><strong>${esc(this.tabNome(tab))}</strong><span>${esc(s.modo)} · ${s.ativos} de ${s.total}</span></div>
        <p>${esc(msg.txt)}</p></div>
        <div class="tp-metrics"><span class="${velho?'warn':'ok'}"><b>${esc(dataUlt)}</b>
        <small>${idade==null?'última medição':(idade===0?'medido hoje':idade===1?'medido ontem':'medido há '+idade+' dias')}${velho?' · retrato vencido':''}</small></span></div>`;
    },
    /* O ganho real desta camada é não calcular a Análise escondida quando outra
       aba está aberta. Não há cronômetro nem diagnóstico exposto ao aluno. */
    instalarPerformance() {
      if(DT._tpPerfInstalled)return;DT._tpPerfInstalled=true;const self=this;
      const originalAnalysis=DT.renderAnalysis;
      DT.renderAnalysis=function(){this._tpAnalysisDirty=false;const r=originalAnalysis.apply(this,arguments);self.atualizarComando();return r;};
      const originalMotor=DT.renderMotor;
      DT.renderMotor=function(){const r=originalMotor.apply(this,arguments);self.atualizarComando();return r;};
      const originalInc=DT.renderIncidencia;
      DT.renderIncidencia=function(){const r=originalInc.apply(this,arguments);self.atualizarComando();return r;};
      const originalRender=DT.render;
      DT.render=function(){
        const tab=this.tecTab||'analise';
        if(tab==='analise'){const r=originalRender.apply(this,arguments);self.atualizarComando();return r;}
        const ra=this.renderAnalysis;this.renderAnalysis=()=>{this._tpAnalysisDirty=true;};
        try{return originalRender.apply(this,arguments);}
        finally{this.renderAnalysis=ra;self.atualizarComando();}
      };
      const originalSwitch=DT.switchTecTab;
      DT.switchTecTab=function(tab){const r=originalSwitch.apply(this,arguments);if(tab==='analise'&&this._tpAnalysisDirty){this._tpAnalysisDirty=false;this.renderAnalysis();}self.atualizarComando();return r;};
      if(typeof DT.aplicarMudancaEscopo==='function'){
        const base=DT.aplicarMudancaEscopo;
        DT.aplicarMudancaEscopo=function(){this._tpAnalysisDirty=true;return base.apply(this,arguments);};
      }
    },
    instalar(){this.instalarPerformance();this.atualizarComando();}
  };
  TecPremium.instalar();
  if(typeof window!=='undefined')window.TecPremium=TecPremium;
})();
