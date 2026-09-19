/* ============================================================
   DESEMPENHO TEC — performance, auditoria de parâmetros e UX premium
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__tecPremium) return;
  if (typeof window !== 'undefined') window.__tecPremium = true;
  if (typeof DesempenhoTecScreen === 'undefined') return;
  const DT = DesempenhoTecScreen;

  const TecPremium = {
    tempos: {},
    /* Todo parâmetro que decide alguma coisa mora no Motor, e o Motor tem um
       campo para cada um. Esta auditoria confere justamente isso: que nenhum
       default do motor esteja sem controle na interface. */
    PARAM_MOTOR: {
      margemMax: 'motor-margem', alvoQuestoes: 'motor-alvo',
      doseMin: 'motor-dosemin', maxFrentes: 'motor-frentes'
    },
    DERIVADOS: ['fase'],
    medir(nome, fn) {
      const ini=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();
      try{return fn();}finally{const fim=(typeof performance!=='undefined'&&performance.now)?performance.now():Date.now();this.tempos[nome]=Math.round((fim-ini)*10)/10;this.atualizarComando();}
    },
    auditoriaParametros() {
      const defaults=(typeof MotorSugestao!=='undefined'&&MotorSugestao.DEFAULTS)||{}, faltantes=[];
      Object.keys(defaults).forEach(k=>{if(this.DERIVADOS.includes(k))return;const id=this.PARAM_MOTOR[k];if(!id||!document.getElementById(id))faltantes.push(k);});
      const tabs={motor:[],analise:[]};
      document.querySelectorAll('#tec-cfg-body [data-tab] [data-cfg-key]').forEach(el=>{const sec=el.closest('[data-tab]');if(sec&&tabs[sec.dataset.tab])tabs[sec.dataset.tab].push(el.dataset.cfgKey);});
      const duplicadas={};Object.keys(tabs).forEach(t=>{const s=new Set();duplicadas[t]=tabs[t].filter(k=>{if(s.has(k))return true;s.add(k);return false;});});
      return{faltantes,tabs,duplicadas,ok:faltantes.length===0&&Object.values(duplicadas).every(a=>a.length===0)};
    },
    escopoResumo() {
      let snaps=[];try{snaps=DT.activeSnapshots?DT.activeSnapshots():DB.getTecSnapshots();}catch(_){snaps=[];}
      let all=[];try{all=DB.getTecSnapshots();}catch(_){all=[];}
      const ultimo=snaps.length?snaps[snaps.length-1]:null, modo=DT.scopeMode==='all'?'Todos os retratos':DT.scopeMode==='range'?'Intervalo':'Retratos selecionados';
      return{ativos:snaps.length,total:all.length,modo,ultimo:ultimo&&(ultimo.endDate||ultimo.date||ultimo.startDate)||null};
    },
    tabNome(tab){return({analise:'Análise',motor:'Motor de sugestão',incidencia:'Incidência',importar:'Importar'})[tab]||tab||'Análise';},
    garantirComando() {
      const screen=document.getElementById('screen-desempenhotec');if(!screen)return null;let box=screen.querySelector('.tp-command');if(box)return box;
      box=document.createElement('section');box.className='tp-command';const head=screen.querySelector('.page-header');if(head)head.insertAdjacentElement('afterend',box);else screen.prepend(box);return box;
    },
    /* Quem está decidindo AGORA. Com um motor só, a resposta é a FASE em que
       ele está pensando — é ela que troca a fonte do peso. */
    fonteAtual() {
      try {
        const f = window.MotorSugestao ? MotorSugestao.prefs().fase : null;
        if (f === 'pos') return { rot: '🧭 Motor · pós-edital', det: 'peso pela incidência da banca' };
        if (f === 'pre') return { rot: '🧭 Motor · pré-edital', det: 'peso pelo seu volume no TEC' };
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tp-fonte'); }
      return { rot: '—', det: 'motor indisponível' };
    },
    /* ═══ UM CABEÇALHO QUE RESPONDE, EM VEZ DE SE APRESENTAR ════════════════
       Esta faixa trazia quatro azulejos: retratos no escopo, retratos salvos,
       última medição e "parâmetros auditados" — mais um cronômetro em
       milissegundos e um botão de Diagnóstico. Três problemas de uma vez:

       · os dois primeiros azulejos repetiam, palavra por palavra, o que o
         cartão "ESCOPO DA ANÁLISE" logo abaixo já mostra;
       · "parâmetros auditados" e os milissegundos são instrumentação de quem
         DESENVOLVE a tela, apresentados como métrica de quem a usa — e um
         "251.7 ms" no cabeçalho não sustenta nenhuma decisão de estudo;
       · o parágrafo descrevia a arquitetura da tela ("cálculos pesados só
         rodam quando a informação necessária mudou"), não o estado dela.

       Sobra o que só esta faixa pode dizer: em que aba você está, QUAL MODELO
       está decidindo agora, e se o retrato que sustenta tudo isso está
       velho. A auditoria e o cronômetro continuam existindo, inteiros, dentro
       do Diagnóstico — que é o lugar deles. */
    atualizarComando() {
      const box=this.garantirComando();if(!box)return;
      const s=this.escopoResumo(),tab=DT.tecTab||'analise',fonte=this.fonteAtual();
      const dataUlt=s.ultimo&&/^\d{4}-\d{2}-\d{2}/.test(String(s.ultimo))?String(s.ultimo).slice(0,10).split('-').reverse().join('/'):(s.ultimo||'—');
      let idade=null;
      try { if (s.ultimo && /^\d{4}-\d{2}-\d{2}/.test(String(s.ultimo))) idade=Math.floor((new Date(todayLocal()+'T00:00:00')-new Date(String(s.ultimo).slice(0,10)+'T00:00:00'))/86400000); }
      catch(e){ if(typeof _quiet==='function')_quiet(e,'tp-idade-retrato'); }
      let cadencia=30;
      try { cadencia=Number((PlanoEngine.prefs()||{}).cadenciaDias)||30; }
      catch(e){ if(typeof _quiet==='function')_quiet(e,'tp-cadencia'); }
      const velho=idade!=null&&idade>cadencia;
      const esc=(v)=>typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v);
      box.innerHTML=`<div class="tp-main"><div class="tp-eyebrow">DESEMPENHO TEC</div>`
        +`<div class="tp-title"><strong>${esc(this.tabNome(tab))}</strong><span>${esc(s.modo)} · ${s.ativos} de ${s.total}</span></div>`
        +`<p>Quem decide a fila desta tela agora é <b>${esc(fonte.rot)}</b> — ${esc(fonte.det)}.</p></div>`
        +`<div class="tp-metrics"><span class="${velho?'warn':'ok'}"><b>${esc(dataUlt)}</b>`
        +`<small>${idade==null?'última medição':(idade===0?'medido hoje':idade===1?'medido ontem':'medido há '+idade+' dias')}${velho?' · retrato vencido':''}</small></span></div>`
        +`<div class="tp-actions"><button type="button" class="btn-primary" data-tp-settings>⚙ Ajustes de ${esc(this.tabNome(tab))}</button>`
        +`<button type="button" class="btn-secondary" data-tp-audit title="Integridade dos parâmetros, escopo efetivo e tempo de cálculo desta sessão">◎ Diagnóstico</button></div>`;
      box.querySelector('[data-tp-settings]').onclick=()=>{if(typeof TecAjustes!=='undefined'&&['analise','plano','reforco'].includes(tab))TecAjustes.abrir(tab);else if(tab==='motores'){if(window.PlanoMotoresCentralTec)showToast('Escolha o modelo para configurar no painel abaixo');}else{const b=document.querySelector(`.tec-cfg-open[data-cfg="${tab}"]`);if(b)b.click();else showToast('Esta aba não possui ajustes específicos');}};
      box.querySelector('[data-tp-audit]').onclick=()=>this.abrirDiagnostico();
    },
    abrirDiagnostico() {
      const a=this.auditoriaParametros(),s=this.escopoResumo(),ov=document.createElement('div');ov.className='tp-overlay';
      ov.innerHTML=`<div class="tp-modal"><div class="tp-modal-head"><div><small>DIAGNÓSTICO DO DESEMPENHO TEC</small><h3>Integridade, parâmetros e desempenho</h3></div><button type="button" aria-label="Fechar">×</button></div><div class="tp-audit-grid"><article><b>${a.ok?'✓ Completo':'⚠ Revisar'}</b><span>Parâmetros do Motor</span><small>${a.faltantes.length?`Sem controle: ${a.faltantes.join(', ')}`:'Todos os parâmetros operacionais possuem controle ou rota deliberadamente derivada.'}</small></article><article><b>${s.ativos}/${s.total}</b><span>Escopo efetivo</span><small>${s.modo}. É este mesmo recorte que alimenta a Análise, a Incidência e o Motor.</small></article><article><b>${this.tempos.motor!=null?this.tempos.motor+' ms':'—'}</b><span>Último Motor</span><small>Tempo observado nesta sessão, da poda da árvore até a fila dosada.</small></article><article><b>${this.tempos.analise!=null?this.tempos.analise+' ms':'—'}</b><span>Última Análise</span><small>A Análise oculta não é mais calculada só para depois ser descartada.</small></article><article><b>${['analise','motor','incidencia'].map(t=>this.tempos[t]).filter(v=>v!=null).length}</b><span>Áreas medidas nesta sessão</span><small>${['analise','motor','incidencia'].filter(t=>this.tempos[t]!=null).map(t=>this.tabNome(t)+': '+this.tempos[t]+' ms').join(' · ')||'Nada medido ainda nesta sessão.'} O cronômetro saiu do cabeçalho da tela e vive aqui: é instrumentação de manutenção, não métrica de estudo.</small></article></div><div class="tp-audit-body"><h4>Cobertura dos ajustes</h4>${['motor','analise'].map(t=>`<div><strong>${this.tabNome(t)}</strong><span>${a.tabs[t].length} controle(s) configurável(is)</span><em>${a.duplicadas[t].length?'chaves duplicadas: '+a.duplicadas[t].join(', '):'sem chaves duplicadas'}</em></div>`).join('')}<p>A fase (pré/pós-edital) não aparece aqui porque o controle dela é o par de botões no alto da aba, e não um campo da folha de ajustes.</p></div></div>`;
      document.body.appendChild(ov);ov.querySelector('.tp-modal-head button').onclick=()=>ov.remove();
    },
    instalarPerformance() {
      if(DT._tpPerfInstalled)return;DT._tpPerfInstalled=true;const self=this;
      const originalAnalysis=DT.renderAnalysis;DT.renderAnalysis=function(){this._tpAnalysisDirty=false;return self.medir('analise',()=>originalAnalysis.apply(this,arguments));};
      const originalMotor=DT.renderMotor;DT.renderMotor=function(){return self.medir('motor',()=>originalMotor.apply(this,arguments));};
      const originalInc=DT.renderIncidencia;DT.renderIncidencia=function(){return self.medir('incidencia',()=>originalInc.apply(this,arguments));};
      const originalRender=DT.render;DT.render=function(){const tab=this.tecTab||'analise';if(tab==='analise')return originalRender.apply(this,arguments);const ra=this.renderAnalysis;this.renderAnalysis=()=>{this._tpAnalysisDirty=true;};try{return originalRender.apply(this,arguments);}finally{this.renderAnalysis=ra;self.atualizarComando();}};
      const originalSwitch=DT.switchTecTab;DT.switchTecTab=function(tab){const r=originalSwitch.apply(this,arguments);if(tab==='analise'&&this._tpAnalysisDirty){this._tpAnalysisDirty=false;this.renderAnalysis();}self.atualizarComando();return r;};
      if(typeof DT.aplicarMudancaEscopo==='function'){const base=DT.aplicarMudancaEscopo;DT.aplicarMudancaEscopo=function(){this._tpAnalysisDirty=true;return base.apply(this,arguments);};}
    },
    instalar(){this.instalarPerformance();this.atualizarComando();}
  };
  TecPremium.instalar();
  if(typeof window!=='undefined')window.TecPremium=TecPremium;
})();
