/* ============================================================================
   CENTRAL DE CONFIGURAÇÃO DOS MOTORES — DESEMPENHO TEC V1
   Extras escolhe/executa; Desempenho TEC configura. Uma única fonte de verdade.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoMotoresCentralTecV1) return;
  const G=window.PlanoMotoresGovernancaV5,C=window.PlanoSugestoesV2,S=window.PlanoSugestoesSimplificadoV2,R=window.PlanoSugestoesRobustoV4||window.PlanoSugestoesRobustoV2,I=window.PlanoSugestoesInfraV2,DT=window.DesempenhoTecScreen;
  if(!G||!C||!S||!R||!I||!DT)return;
  window.__planoMotoresCentralTecV1=true;
  const esc=I.esc||((s)=>String(s??''));

  const M={
    VERSAO:1,
    _origCab:C._cabecalho?.bind(C),
    _origSwitch:DT.switchTecTab?.bind(DT),

    _semConfiguracaoDoModal(html){
      if(typeof document==='undefined'||!document.createElement)return String(html||'').replace(/<div class="ps-settings"[\s\S]*?<div class="ps-rule">/,'<div class="ps-rule">').replace(/<div class="rv4-wrap"[\s\S]*?<div class="ps-rule">/,'<div class="ps-rule">');
      const t=document.createElement('template');t.innerHTML=String(html||'');
      t.content.querySelectorAll('.ps-settings,.rv4-wrap').forEach(n=>n.remove());
      const note=document.createElement('div');note.className='ps-config-location';note.innerHTML='<span>⚙</span><div><b>Ajustes centralizados</b><small>Parâmetros dos motores ficam em Desempenho TEC › Motores. Aqui você apenas escolhe a estratégia e as frentes.</small></div>';
      const chooser=t.content.querySelector('.ps-engine-chooser,.ps-single-engine');
      if(chooser)chooser.after(note);else t.content.prepend(note);
      return t.innerHTML;
    },

    instalarModal(){
      if(this._modalInstalled||!this._origCab)return;this._modalInstalled=true;
      const self=this;C._cabecalho=function(p,res){return self._semConfiguracaoDoModal(self._origCab(p,res));};
    },

    _bancas(atual){
      const bs=I.bancas?I.bancas():[];
      return `<option value="__todas__" ${atual==='__todas__'?'selected':''}>Selecionar automaticamente</option>`+bs.map(b=>`<option value="${esc(b)}" ${b===atual?'selected':''}>${esc(b)}</option>`).join('');
    },

    _simpleHtml(){
      const p=S.prefs(),fase=S.fase?S.fase(p):(p.fase||'auto');
      return `<section class="pmc-engine-card" data-pmc-engine="simplificado"><header><div class="pmc-engine-id"><span>⚡</span><div><small>MOTOR ATIVO</small><h3>Simplificado</h3><p>Leitura direta do TEC, com poucos parâmetros e decisão transparente.</p></div></div><span class="pmc-pill">Direto</span></header><div class="pmc-simple-grid"><label><span>Fase</span><select data-pmc-simple="fase"><option value="auto" ${p.fase==='auto'?'selected':''}>Automática</option><option value="pre" ${p.fase==='pre'?'selected':''}>Pré-edital</option><option value="pos" ${p.fase==='pos'?'selected':''}>Pós-edital</option></select><small>Define se o motor usa apenas seu histórico ou cruza banca + planejamento.</small></label><label><span>Meta desejada</span><div class="pmc-suffix"><input data-pmc-simple="meta" type="number" min="50" max="100" value="${p.meta}"><em>%</em></div><small>Assuntos abaixo desta régua entram na disputa.</small></label><label><span>Amostra mínima</span><input data-pmc-simple="minAmostra" type="number" min="1" max="500" value="${p.minAmostra}"><small>Evita priorizar taxas sustentadas por poucas questões.</small></label><label><span>Questões por frente</span><input data-pmc-simple="alvoQuestoes" type="number" min="5" max="200" value="${p.alvoQuestoes}"><small>Alvo operacional do reforço criado pelo Simplificado.</small></label><label class="${fase==='pos'?'':'pmc-hidden'}"><span>Banca</span><select data-pmc-simple="banca">${this._bancas(p.banca)}</select><small>No Pós, define a incidência usada no cruzamento.</small></label></div><footer><span>Configuração salva por perfil.</span><b>O Extras apenas consome este estado.</b></footer></section>`;
    },

    _robustHtml(){
      const cfg=R.config?R.config():null,rot=cfg?.resumo?.rotulo||'Estratégia atual';
      return `<section class="pmc-engine-card pmc-robusto" data-pmc-engine="robusto"><header><div class="pmc-engine-id"><span>🧠</span><div><small>MOTOR ATIVO</small><h3>Robusto</h3><p>Plano + Mentor 90+, com roteador pedagógico, tempo, aprendizado e otimização global.</p></div></div><span class="pmc-pill">${esc(rot)}</span></header><div class="pmc-robust-summary"><b>Perfil detectado automaticamente pelo Plano</b><span>Os ajustes abaixo valem apenas para o modo robusto e para o perfil de ataque atual.</span></div><div data-pmc-rv4-host>${R.painelConfigHtml?R.painelConfigHtml():''}</div></section>`;
    },

    _panelHtml(){
      const e=G.estado(),ativos=Number(e.simplificado)+Number(e.robusto);
      return `<div class="pmc-shell"><section class="pmc-intro"><div><small>CENTRAL DOS MODELOS</small><h2>Configure os motores onde os dados são analisados</h2><p>Desempenho TEC é a única tela autorizada a editar os parâmetros dos motores. Extras fica limpo para decidir e executar.</p></div><div class="pmc-state"><b>${ativos}</b><span>${ativos===1?'motor ativo':'motores ativos'}</span></div></section>${e.simplificado?this._simpleHtml():''}${e.robusto?this._robustHtml():''}${ativos===0?'<div class="pmc-empty"><b>Nenhum motor habilitado</b><span>Ative Simplificado ou Robusto em Configurações para liberar esta central.</span></div>':''}</div>`;
    },

    _bindPanel(){
      const panel=document.getElementById('tec-panel-motores');if(!panel)return;
      panel.querySelectorAll('[data-pmc-simple]').forEach(el=>el.addEventListener('change',()=>{
        const k=el.dataset.pmcSimple,v=el.type==='number'?Number(el.value):el.value;S.salvar({[k]:v});
        if(k==='fase')this.renderPanel();else if(typeof showToast==='function')showToast('Ajuste do Simplificado salvo ✓');
      }));
      const host=panel.querySelector('[data-pmc-rv4-host]');
      if(host&&R.bindConfig)R.bindConfig(host,()=>{if(typeof showToast==='function')showToast('Ajuste do Robusto salvo ✓');this.renderPanel();});
    },

    ensureUi(){
      if(typeof document==='undefined')return;
      const tabs=document.getElementById('tec-subtabs');if(!tabs)return;
      let btn=tabs.querySelector('.tec-subtab[data-tectab="motores"]');
      if(!btn){btn=document.createElement('button');btn.type='button';btn.className='tec-subtab';btn.dataset.tectab='motores';btn.textContent='⚙ Motores';tabs.appendChild(btn);btn.addEventListener('click',()=>DT.switchTecTab('motores'));}
      let panel=document.getElementById('tec-panel-motores');
      if(!panel){panel=document.createElement('div');panel.id='tec-panel-motores';panel.style.display='none';const first=document.getElementById('tec-panel-analise');if(first?.parentNode)first.parentNode.insertBefore(panel,first);else tabs.insertAdjacentElement('afterend',panel);}
      this.syncVisibility();this.renderPanel();
    },

    renderPanel(){
      if(typeof document==='undefined')return;const panel=document.getElementById('tec-panel-motores');if(!panel)return;
      panel.innerHTML=this._panelHtml();this._bindPanel();
    },

    syncVisibility(){
      if(typeof document==='undefined')return;const e=G.estado(),algum=e.simplificado||e.robusto,btn=document.querySelector('.tec-subtab[data-tectab="motores"]'),panel=document.getElementById('tec-panel-motores');
      if(btn){btn.hidden=!algum;btn.setAttribute('aria-hidden',algum?'false':'true');}
      if(!algum&&DT.tecTab==='motores'){if(this._origSwitch)this._origSwitch('analise');else DT.tecTab='analise';}
      if(panel&&!algum)panel.style.display='none';
    },

    instalarTabs(){
      if(this._tabsInstalled)return;this._tabsInstalled=true;const self=this;
      if(this._origSwitch)DT.switchTecTab=function(tab){
        if(tab==='motores'){
          self.ensureUi();const e=G.estado();if(!e.simplificado&&!e.robusto)return self._origSwitch('analise');
          this.tecTab='motores';document.querySelectorAll('#tec-subtabs .tec-subtab').forEach(b=>b.classList.toggle('active',b.dataset.tectab==='motores'));
          document.querySelectorAll('[id^="tec-panel-"]').forEach(el=>{el.style.display=el.id==='tec-panel-motores'?'block':'none';});self.renderPanel();return;
        }
        const out=self._origSwitch(tab);const p=document.getElementById('tec-panel-motores');if(p)p.style.display='none';return out;
      };
    },

    init(){this.instalarModal();this.instalarTabs();this.ensureUi();window.addEventListener('plano:motores-change',()=>{this.ensureUi();this.renderPanel();});}
  };
  window.PlanoMotoresCentralTecV1=M;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>M.init(),{once:true});else M.init();
})();
