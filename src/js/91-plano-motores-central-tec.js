/* ============================================================================
   CENTRAL DOS MOTORES — DESEMPENHO TEC
   Configuracao mora no TEC; Extras apenas executa.
   ============================================================================ */
(() => {
  if(typeof window==='undefined'||window.__planoMotoresCentralTec)return;
  window.__planoMotoresCentralTec=true;
  const G=window.PlanoMotoresGovernanca,C=window.PlanoSugestoes,S=window.PlanoSugestoesSimplificado,R=window.PlanoSugestoesRobusto,I=window.PlanoSugestoesInfra,A=window.PlanoRobustoAudit;
  const DT=(typeof DesempenhoTecScreen!=='undefined'&&DesempenhoTecScreen)||window.DesempenhoTecScreen;
  if(!G||!C||!S||!R||!I||!DT)return;
  const esc=I.esc||((s)=>String(s??''));

  const M={
    _origSwitch:DT.switchTecTab?.bind(DT),_origRender:DT.render?.bind(DT),_tabObserver:null,_renderQueued:false,
    _scheduleRenderPanel(){if(this._renderQueued)return;this._renderQueued=true;const run=()=>{this._renderQueued=false;this.renderPanel();};if(typeof queueMicrotask==='function')queueMicrotask(run);else Promise.resolve().then(run);},
    _bancas(atual){const bs=I.bancas?I.bancas():[];return `<option value="__todas__" ${atual==='__todas__'?'selected':''}>Selecionar automaticamente</option>`+bs.map(b=>`<option value="${esc(b)}" ${b===atual?'selected':''}>${esc(b)}</option>`).join('');},
    _simpleHtml(){const p=S.prefs(),fase=S.fase?S.fase(p):(p.fase||'auto');return `<section class="pmc-engine-card" data-pmc-engine="simplificado"><header><div class="pmc-engine-id"><span>⚡</span><div><small>MOTOR DISPONÍVEL</small><h3>Simplificado</h3><p>Leitura direta e transparente do TEC. Serve como baseline independente para confrontar o Robusto.</p></div></div><span class="pmc-pill">Direto</span></header><div class="pmc-grupo"><h5>1 · Recorte da prova</h5><p>Em que fase o motor raciocina e quantas frentes ele abre de uma vez.</p><div class="pmc-simple-grid"><label><span>Fase</span><select data-pmc-simple="fase"><option value="auto" ${p.fase==='auto'?'selected':''}>Automática — segue o planejamento ativo</option><option value="pre" ${p.fase==='pre'?'selected':''}>Pré-edital</option><option value="pos" ${p.fase==='pos'?'selected':''}>Pós-edital</option></select><small>Hoje valendo: <b>${fase==='pre'?'Pré-edital':'Pós-edital'}</b>${p.fase==='auto'?' (derivada do planejamento)':' (fixada por você)'}. Pré usa TEC direto; Pós cruza com a incidência da banca.</small></label><label><span>Disciplinas por vez</span><input data-pmc-simple="maxDisciplinas" type="number" min="1" max="8" value="${p.maxDisciplinas}"><small>Quantas frentes distintas entram na força-tarefa. Era fixo em 3.</small></label><label class="${fase==='pos'?'':'pmc-hidden'}"><span>Banca</span><select data-pmc-simple="banca">${this._bancas(p.banca)}</select><small>Incidência usada pelo Simplificado Pós.</small></label></div></div><div class="pmc-grupo"><h5>2 · Régua</h5><p>O corte que decide quem disputa a fila.</p><div class="pmc-simple-grid"><label><span>Meta desejada</span><div class="pmc-suffix"><input data-pmc-simple="meta" type="number" min="50" max="100" value="${p.meta}"><em>%</em></div><small>Assuntos abaixo da régua entram na disputa.</small></label><label><span>Amostra mínima</span><input data-pmc-simple="minAmostra" type="number" min="1" max="500" value="${p.minAmostra}"><small>Piso operacional; não significa alta precisão estatística.</small></label></div></div><div class="pmc-grupo"><h5>3 · Dose de questões</h5><p>O tamanho do bloco recomendado por frente.</p><div class="pmc-simple-grid"><label><span>Questões por frente</span><input data-pmc-simple="alvoQuestoes" type="number" min="5" max="200" value="${p.alvoQuestoes}"><small>Dose fixa deste motor — o Simplificado não modela tempo nem recalibra.</small></label></div></div><footer><span>Configuração própria e isolada.</span><b>Não lê parâmetros do Robusto.</b><button type="button" data-pmc-simple-reset>↺ Restaurar padrões</button></footer></section>`;},
    _auditHtml(){if(!A)return'';return `<section class="pmc-audit-card" data-pmc-robust-audit><header><div><small>AUDITORIA HUMANA · LOCAL</small><h4>Flight recorder do Robusto</h4><p>Registra decisão → reforço → execução → estado TEC posterior. Como o TEC pode incluir questões do ciclo regular, a evolução é tratada como observacional e recebe peso de atribuição conservador.</p></div><span class="pmc-audit-local">local-only</span></header><div data-pmc-audit-stats>${A.statsHtml()}</div><div class="pmc-audit-actions"><button type="button" class="btn-secondary" data-pmc-audit-refresh>↻ Atualizar leitura</button><button type="button" class="btn-primary" data-pmc-audit-export>⇩ Exportar auditoria .json</button></div><footer>O JSON exporta somente métricas do TEC, reforços em Extras, dose, tempo diretamente registrado no reforço e qualidade de atribuição. Não registra método subjetivo de estudo.</footer></section>`;},
    _robustHtml(){const cfg=R.config(),rot=cfg?.resumo?.rotulo||'TEC';return `<section class="pmc-engine-card pmc-robusto" data-pmc-engine="robusto"><header><div class="pmc-engine-id"><span>🧠</span><div><small>MOTOR DISPONÍVEL</small><h3>Robusto</h3><p>Motor estatístico focado em três decisões: qual disciplina atacar, qual tópico priorizar e quantas questões fazer. Usa TEC, incidência e reforços em Extras.</p></div></div><span class="pmc-pill">${esc(rot)}</span></header><div class="pmc-robust-summary"><b>Prioridade e dose</b><span>Sem nomes/pesos/tempo do ciclo regular. Pré-edital usa peso 1; Pós-edital vincula manualmente pesos aos nomes canônicos do TEC.</span></div><div data-pmc-robusto-host>${R.painelConfigHtml()}</div></section>`;},
    /* ═══ PANORAMA NA ABA, PARÂMETROS NA JANELA ═══════════════════════════
       A aba despejava as duas configurações inteiras, abertas, uma embaixo da
       outra: dezesseis campos do Robusto, cinco do Simplificado, a tabela de
       pesos do Pós-edital e o painel de auditoria — tudo no mesmo rolo, sem
       fronteira entre "o que este motor é" e "o que eu posso mexer nele". Ler
       de cima para baixo não respondia nem a primeira pergunta ("qual motor
       está decidindo agora?"), e mexer num campo exigia achá-lo no meio de
       outros vinte iguais.

       A aba passa a responder só o que se olha de relance: cada motor, em um
       cartão, com o que ele decide, a fase valendo, as frentes que abre e a
       régua. Os parâmetros ficam a um clique, numa janela por motor — uma
       coisa por vez, com as seções numeradas que o motor já usa internamente
       (recorte → régua → dose). A auditoria, que não é configuração, ganha o
       seu próprio cartão no fim. */
    _resumoSimples(){
      const p=S.prefs(),fase=S.fase?S.fase(p):(p.fase||'auto');
      return [['Fase',fase==='pos'?'Pós-edital':'Pré-edital',p.fase==='auto'?'derivada do planejamento':'fixada por você'],
        ['Frentes por vez',String(p.maxDisciplinas),'disciplinas distintas'],
        ['Régua',p.meta+'%','meta de domínio'],
        ['Dose',p.alvoQuestoes+'q','fixa por frente']];
    },
    _resumoRobusto(){
      const p=R.prefs(),fase=R.fase?R.fase(p):'pre';
      return [['Fase',fase==='pos'?'Pós-edital':'Pré-edital',p.fase==='auto'?'derivada do planejamento':'fixada por você'],
        ['Frentes por vez',String(p.maxDisciplinas),(p.topicosPorDisciplina||1)+' tópico(s) por disciplina'],
        ['Régua',p.meta+'%','meta · amostra mínima '+p.minAmostra],
        ['Dose',p.doseMin+'–'+p.doseMax+'q','base '+p.doseBase+', recalibrada por Extras']];
    },
    _cardMotor(k){
      const emUso=(window.TecPlanoFonteMotor&&TecPlanoFonteMotor.fonte&&TecPlanoFonteMotor.fonte())===k;
      const rob=k==='robusto';
      const resumo=rob?this._resumoRobusto():this._resumoSimples();
      const decide=rob
        ?'Escolhe disciplinas, ordena os tópicos de cada uma e calcula a dose. Lê TEC, incidência da banca e o resultado observado dos reforços em Extras.'
        :'Ordena pela distância até a meta, com amostra mínima e sem sobrepor tópico-pai e tópico-filho. Leitura direta do TEC.';
      const naoLe=rob
        ?'nomes, pesos ou tempo do ciclo regular · método de estudo · PlanoEngine'
        :'o motor Robusto · persistência · tendência · histórico de reforços';
      return `<section class="pmc-engine-card${rob?' pmc-robusto':''}${emUso?' is-em-uso':''}" data-pmc-engine="${k}">`
        +`<header><div class="pmc-engine-id"><span>${rob?'🧠':'⚡'}</span><div><small>${emUso?'DECIDINDO AGORA':'MOTOR DISPONÍVEL'}</small><h3>${rob?'Robusto':'Simplificado'}</h3><p>${esc(decide)}</p></div></div>`
        +`<span class="pmc-pill${emUso?' is-on':''}">${emUso?'em uso':(rob?'Estatístico':'Direto')}</span></header>`
        +`<div class="pmc-resumo">${resumo.map(([rot,val,det])=>`<span><small>${esc(rot)}</small><b>${esc(val)}</b><em>${esc(det)}</em></span>`).join('')}</div>`
        +`<footer class="pmc-engine-foot"><span><b>Não lê:</b> ${esc(naoLe)}</span>`
        +`<button type="button" class="btn-primary" data-pmc-config="${k}">⚙ Configurar o ${rob?'Robusto':'Simplificado'}</button></footer></section>`;
    },
    _panelHtml(){
      const e=G.estado(),ativos=Number(e.simplificado)+Number(e.robusto);
      return `<div class="pmc-shell"><section class="pmc-intro"><div><small>CENTRAL DOS MODELOS</small><h2>Quem decide as suas sugestões</h2><p>Os seus acertos, o histórico e as métricas do TEC são <b>fatos</b> e não mudam aqui. Um modelo é a regra que transforma esses fatos em prioridade — e cada um tem regra, régua e dose próprias, sem ler nada do outro. Qual deles está valendo na tela você escolhe no alto do Desempenho TEC.</p></div><div class="pmc-state"><b>${ativos}</b><span>${ativos===1?'modelo ativo':'modelos ativos'}</span></div></section>`
        +`${e.simplificado?this._cardMotor('simplificado'):''}${e.robusto?this._cardMotor('robusto'):''}`
        +`${e.robusto?this._auditHtml():''}`
        +`${ativos===0?'<div class="pmc-empty"><b>Nenhum modelo habilitado</b><span>Ative Simplificado ou Robusto em Configurações › Estudo › Motores do Plano. Sem nenhum ativo, o Plano volta a usar a leitura analítica legada.</span></div>':''}</div>`;
    },
    /* ── A JANELA DE UM MOTOR ────────────────────────────────────────────── */
    _modal:null,
    abrirConfig(k){
      this.fecharConfig();
      const rob=k==='robusto';
      const ov=document.createElement('div');
      ov.className='pmc-overlay';
      ov.innerHTML=`<div class="pmc-modal" role="dialog" aria-modal="true" aria-label="Configuração do ${rob?'Robusto':'Simplificado'}">`
        +`<header class="pmc-modal-head"><div><small>CONFIGURAÇÃO DO MODELO</small><h3>${rob?'🧠 Robusto':'⚡ Simplificado'}</h3>`
        +`<p>${rob?'Só TEC, incidência da banca e o resultado observado dos reforços em Extras. Nada aqui lê o ciclo regular nem o seu método de estudo.':'Regra direta sobre o TEC, com poucos parâmetros. Serve de baseline independente para confrontar o Robusto.'}</p></div>`
        +`<button type="button" class="pmc-modal-x" aria-label="Fechar">×</button></header>`
        +`<main class="pmc-modal-body" data-pmc-modal-body></main>`
        +`<footer class="pmc-modal-foot"><span>Alterações valem na hora e só para este modelo.</span><button type="button" class="btn-primary" data-pmc-modal-ok>Concluir</button></footer></div>`;
      document.body.appendChild(ov);
      this._modal=ov;
      document.body.style.overflow='hidden';
      const fechar=()=>this.fecharConfig();
      ov.querySelector('.pmc-modal-x').addEventListener('click',fechar);
      ov.querySelector('[data-pmc-modal-ok]').addEventListener('click',fechar);
      ov.addEventListener('click',(ev)=>{if(ev.target===ov)fechar();});
      this._escFecha=(ev)=>{if(ev.key==='Escape')fechar();};
      document.addEventListener('keydown',this._escFecha);
      this._pintarModal(k);
    },
    _pintarModal(k){
      const body=this._modal&&this._modal.querySelector('[data-pmc-modal-body]');
      if(!body)return;
      body.innerHTML=k==='robusto'?this._robustHtml():this._simpleHtml();
      this._bindMotor(body,k,()=>{this._pintarModal(k);this._scheduleRenderPanel();});
    },
    fecharConfig(){
      if(this._escFecha){document.removeEventListener('keydown',this._escFecha);this._escFecha=null;}
      if(this._modal){this._modal.remove();this._modal=null;document.body.style.overflow='';}
    },
    /* Os campos de um motor, onde quer que estejam montados (hoje, dentro da
       janela; o painel fica só com os botões de abrir e a auditoria). Um lugar
       só, para os dois motores não divergirem na primeira correção. */
    _bindMotor(root,k,onChange){
      if(!root)return;
      if(k==='simplificado'){
        root.querySelectorAll('[data-pmc-simple]').forEach(el=>el.addEventListener('change',()=>{
          const campo=el.dataset.pmcSimple,v=el.type==='number'?Number(el.value):el.value;
          S.salvar({[campo]:v});
          if(typeof showToast==='function')showToast('Simplificado atualizado ✓');
          if(onChange)onChange();
        }));
        root.querySelector('[data-pmc-simple-reset]')?.addEventListener('click',()=>{
          S.restaurar?.();
          if(typeof showToast==='function')showToast('Simplificado restaurado aos padrões ✓');
          if(onChange)onChange();
        });
        return;
      }
      const host=root.querySelector('[data-pmc-robusto-host]')||root;
      R.bindConfig(host,()=>{if(typeof showToast==='function')showToast('Robusto atualizado ✓');if(onChange)onChange();});
    },
    _bindPanel(){
      const panel=document.getElementById('tec-panel-motores');
      if(!panel)return;
      panel.querySelectorAll('[data-pmc-config]').forEach(b=>b.addEventListener('click',()=>this.abrirConfig(b.dataset.pmcConfig)));
      panel.querySelector('[data-pmc-audit-refresh]')?.addEventListener('click',()=>{A?.reconciliar();if(typeof showToast==='function')showToast('Auditoria do Robusto atualizada ✓');this._scheduleRenderPanel();});
      panel.querySelector('[data-pmc-audit-export]')?.addEventListener('click',()=>{try{const r=A.exportar(),d=r.payload?.diagnostico;if(typeof showToast==='function')showToast(`Auditoria exportada · ${d?.resultadosMedidos||0} resultado(s) TEC ✓`);}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-audit-ui-export');if(typeof showToast==='function')showToast('Não foi possível exportar a auditoria');}});
    },
    _aplicarVisibilidadeTab(btn,visivel){if(!btn)return;if(visivel){if(btn.classList.contains('ux-off'))btn.classList.remove('ux-off');if(btn.hidden)btn.hidden=false;if(btn.style.display)btn.style.removeProperty('display');if(btn.getAttribute('aria-hidden')!=='false')btn.setAttribute('aria-hidden','false');}else{if(!btn.hidden)btn.hidden=true;if(btn.style.display!=='none')btn.style.display='none';if(btn.getAttribute('aria-hidden')!=='true')btn.setAttribute('aria-hidden','true');}},
    _protegerTab(btn){if(!btn)return;const corrigir=()=>{const e=G.estado(),algum=e.simplificado||e.robusto;if(algum)this._aplicarVisibilidadeTab(btn,true);};corrigir();if(this._tabObserver)this._tabObserver.disconnect();this._tabObserver=new MutationObserver(()=>corrigir());this._tabObserver.observe(btn,{attributes:true,attributeFilter:['class','hidden','style','aria-hidden']});},
    ensureUi(){if(typeof document==='undefined')return;const tabs=document.getElementById('tec-subtabs');if(!tabs)return;let btn=tabs.querySelector('.tec-subtab[data-tectab="motores"]');if(!btn){btn=document.createElement('button');btn.type='button';btn.className='tec-subtab pmc-tab';btn.dataset.tectab='motores';btn.textContent='⚙ Motores';tabs.appendChild(btn);/* Sem ouvinte próprio: a fita `#tec-subtabs` tem um ouvinte DELEGADO que cobre qualquer chip, inclusive os injetados depois. Um ouvinte aqui faria o clique em Modelos disparar a troca duas vezes — e a segunda, síncrona, desfazia o adiamento que existe justamente para a aba não congelar. */if(typeof DT.trocarAbaPeloToque!=='function')btn.addEventListener('click',()=>DT.switchTecTab('motores'));}let panel=document.getElementById('tec-panel-motores');if(!panel){panel=document.createElement('div');panel.id='tec-panel-motores';panel.style.display='none';const first=document.getElementById('tec-panel-analise');if(first?.parentNode)first.parentNode.insertBefore(panel,first);else tabs.insertAdjacentElement('afterend',panel);}this._protegerTab(btn);this.syncVisibility();this.renderPanel();},
    renderPanel(){if(typeof document==='undefined')return;const panel=document.getElementById('tec-panel-motores');if(!panel)return;panel.innerHTML=this._panelHtml();this._bindPanel();},
    syncVisibility(){if(typeof document==='undefined')return;const e=G.estado(),algum=e.simplificado||e.robusto,btn=document.querySelector('.tec-subtab[data-tectab="motores"]'),panel=document.getElementById('tec-panel-motores');this._aplicarVisibilidadeTab(btn,algum);if(!algum&&DT.tecTab==='motores'){if(this._origSwitch)this._origSwitch('analise');else DT.tecTab='analise';}if(panel&&!algum&&panel.style.display!=='none')panel.style.display='none';},
    instalarTabs(){if(this._tabsInstalled)return;this._tabsInstalled=true;const self=this;if(this._origSwitch)DT.switchTecTab=function(tab){if(tab==='motores'){self.ensureUi();const e=G.estado();if(!e.simplificado&&!e.robusto)return self._origSwitch('analise');this.tecTab='motores';document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(b=>b.classList.toggle('active',b.dataset.tectab==='motores'));document.querySelectorAll('[id^="tec-panel-"]').forEach(el=>{const alvo=el.id==='tec-panel-motores'?'block':'none';if(el.style.display!==alvo)el.style.display=alvo;});self.renderPanel();self.syncVisibility();return;}const out=self._origSwitch(tab);const p=document.getElementById('tec-panel-motores');if(p&&p.style.display!=='none')p.style.display='none';self.syncVisibility();return out;};},
    instalarRenderHook(){if(this._renderInstalled||!this._origRender)return;this._renderInstalled=true;const self=this;DT.render=function(){const r=self._origRender();self.ensureUi();self.syncVisibility();return r;};},
    init(){this.instalarTabs();this.instalarRenderHook();this.ensureUi();window.addEventListener('plano:motores-change',()=>{this.ensureUi();this.renderPanel();});}
  };
  window.PlanoMotoresCentralTec=M;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>M.init(),{once:true});else M.init();
})();