/* ============================================================
   CARDS — CASCA DE STATS / SIMULADOR / CHECK MEDIA
   ------------------------------------------------------------
   Nenhum dado acadêmico é calculado aqui. Graphs, FSRS e Media
   vêm exclusivamente da Collection oficial do Anki 26.09.3.
   ============================================================ */
const AnkiMaxStatsMedia = {
  _statsState:{scope:'deck',deckId:null,search:'',history:'year'},

  install(){
    if(this._installed||typeof CardsScreen==='undefined'||typeof AnkiProductParity==='undefined')return;
    this._installed=true;
    this._patchCheck();
    this._injectSimulator();
  },

  _decksSource(){
    try{
      if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.decks)return StudyGlobalScope.decks();
    }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-stats-decks');}
    return DB.getDecks();
  },

  _statsSelectedDeckId(){
    const explicit=this._statsState&&this._statsState.deckId;
    if(explicit!=null&&explicit!=='')return String(explicit);
    try{
      if(typeof AnkiParity!=='undefined'&&AnkiParity.selectedDeckId)return String(AnkiParity.selectedDeckId()||'');
    }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-stats-selected-deck');}
    return '';
  },

  _statsControlsHtml(){
    const st=this._statsState||{},
      decks=this._decksSource().slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR')),
      selected=this._statsSelectedDeckId(),
      esc=v=>typeof AnkiProductParity!=='undefined'&&AnkiProductParity.esc
        ?AnkiProductParity.esc(v)
        :String(v||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    return '<div class="card stat-card anki-stats-controls"><div class="card-header"><div><h2>Escopo das estatísticas</h2><p class="sub">Os dados abaixo são calculados pelo GraphsService oficial do Anki.</p></div></div>'+
      '<div class="stat-body anki-stats-fields"><div class="field-group"><div class="field"><label>Escopo</label><select id="anki-stats-scope"><option value="deck"'+(st.scope==='deck'?' selected':'')+'>Baralho</option><option value="collection"'+(st.scope==='collection'?' selected':'')+'>Coleção</option><option value="search"'+(st.scope==='search'?' selected':'')+'>Pesquisa</option></select></div>'+
      '<div class="field"><label>Histórico</label><select id="anki-stats-history"><option value="year"'+(st.history!=='all'?' selected':'')+'>Últimos 12 meses</option><option value="all"'+(st.history==='all'?' selected':'')+'>Todo o histórico</option></select></div></div>'+
      '<div class="field-group"><div class="field"><label>Baralho</label><select id="anki-stats-deck"><option value="">Baralho selecionado</option>'+decks.map(d=>'<option value="'+esc(d.id)+'"'+(String(d.id)===selected?' selected':'')+'>'+esc(d.nome)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Pesquisa</label><input id="anki-stats-search" type="text" value="'+esc(st.search||'')+'" placeholder="Ex.: tag:fiscal -is:suspended"></div></div></div></div>';
  },

  _dm(iso){return String(iso).slice(8,10)+'/'+String(iso).slice(5,7);},

  // Apenas apresentação de séries JÁ calculadas pelo GraphsService oficial.
  _serie(entries,temDado){
    const primeiro=entries.findIndex(temDado),min=14;
    let xs=primeiro<0?entries.slice(-min):entries.slice(Math.max(0,Math.min(primeiro,entries.length-min)));
    if(!xs.length)return {grupos:[],passo:1};
    const passo=xs.length<=31?1:xs.length<=31*7?7:30,out=[];
    for(let i=0;i<xs.length;i+=passo){
      const g=xs.slice(i,i+passo);
      out.push({ini:g[0][0],fim:g[g.length-1][0],itens:g.map(x=>x[1])});
    }
    return {grupos:out,passo};
  },

  _serieHtml(serie,valor,pilhas,fmt,unidade){
    const grupos=serie&&Array.isArray(serie.grupos)?serie.grupos:[],passo=Number(serie&&serie.passo)||1;
    if(!grupos.length)return '<div class="stat-body"><p class="hint">Sem dados.</p></div>';
    const vals=grupos.map(g=>valor(g)),max=Math.max(0,...vals),
      esc=x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),
      rot=g=>passo===1?this._dm(g.ini):this._dm(g.ini)+'–'+this._dm(g.fim);
    const cols=grupos.map((g,i)=>{
      const v=vals[i],h=max?Math.round(v/max*100):0,
        partes=pilhas?pilhas.map(([cls,fn])=>{const n=fn(g);return n&&v?'<i class="'+cls+'" style="height:'+(n/v*100)+'%"></i>':'';}).join(''):'<i class="review" style="height:100%"></i>';
      return '<div class="anki-ts-col" title="'+esc(rot(g)+': '+fmt(v)+(unidade?' '+unidade:''))+'"><div class="anki-ts-bar" style="height:'+(v?Math.max(3,h):0)+'%">'+partes+'</div></div>';
    }).join('');
    const total=vals.reduce((a,b)=>a+b,0);
    return '<div class="stat-body"><div class="anki-ts-meta"><span>máx. '+fmt(max)+(unidade?' '+unidade:'')+(passo>1?' por '+(passo===7?'semana':'mês'):' por dia')+'</span><span>total '+fmt(total)+(unidade?' '+unidade:'')+'</span></div>'+
      '<div class="anki-ts" style="grid-template-columns:repeat('+grupos.length+',minmax(0,1fr))">'+cols+'</div>'+
      '<div class="anki-ts-eixo"><span>'+this._dm(grupos[0].ini)+'</span><span>'+(passo===1?'hoje':this._dm(grupos[grupos.length-1].fim))+'</span></div></div>';
  },

  _simCardHtml(){
    return '<div class="card stat-card anki-sim-card"><div class="card-header"><div><h2>🧪 Simulador FSRS</h2><p class="sub">A projeção usa o backend oficial do Anki, o preset atual e a Collection real.</p></div></div><div class="stat-body"><button type="button" class="btn-primary" id="anki-open-simulator">Abrir simulador</button></div></div>';
  },

  _bindStatsUi(){
    const sim=document.getElementById('anki-open-simulator');if(sim)sim.onclick=()=>this.openSimulator();
    const rerender=()=>{if(typeof CardsScreen!=='undefined'&&CardsScreen.renderContent)CardsScreen.renderContent();};
    const scope=document.getElementById('anki-stats-scope');if(scope)scope.onchange=()=>{this._statsState.scope=scope.value;rerender();};
    const history=document.getElementById('anki-stats-history');if(history)history.onchange=()=>{this._statsState.history=history.value;rerender();};
    const deck=document.getElementById('anki-stats-deck');if(deck)deck.onchange=()=>{this._statsState.deckId=deck.value||null;this._statsState.scope='deck';rerender();};
    const search=document.getElementById('anki-stats-search');
    if(search){
      const apply=()=>{this._statsState.search=search.value||'';if(this._statsState.search.trim())this._statsState.scope='search';rerender();};
      search.onchange=apply;search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();apply();}};
    }
  },

  async simulateOfficial(days,retention,opts){
    opts=opts||{};
    days=Math.max(1,Math.min(3650,Math.round(Number(days)||365)));
    retention=Math.max(.7,Math.min(.99,Number(retention)||.9));
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.simulateFsrsPreset!=='function')throw new Error('Simulador oficial do Anki indisponível.');
    const state=this._statsState||{},deckId=state.scope==='deck'?this._statsSelectedDeckId():null,
      r=await CardsOfficialBridge.simulateFsrsPreset(deckId,days,retention,opts,'review'),out=r.out||{},
      reviews=Array.isArray(out.daily_review_count)?out.daily_review_count:[],
      news=Array.isArray(out.daily_new_count)?out.daily_new_count:[],
      time=Array.isArray(out.daily_time_cost)?out.daily_time_cost:[],
      memorized=Array.isArray(out.accumulated_knowledge_acquisition)?out.accumulated_knowledge_acquisition:[];
    return {
      days,retention,reviews,news,time,memorized,
      additionalNew:Number(r.payload&&r.payload.deck_size)||0,
      newLimit:Number(r.payload&&r.payload.new_limit)||0,
      reviewLimit:Number(r.payload&&r.payload.review_limit)||0,
      maxInterval:Number(r.payload&&r.payload.max_interval)||36500,
      engine:'Anki 26.09.3 · simulate_fsrs_review',search:r.search,preset:r.presetName
    };
  },

  _injectSimulator(){
    if(document.getElementById('anki-fsrs-simulator'))return;
    const cfg=CardsConfig.get(),d=document.createElement('div');
    d.innerHTML='<div id="anki-fsrs-simulator" class="cards-modal anki-product-modal" style="display:none"><div class="cards-modal-box cards-modal-lg"><div class="cards-modal-head"><div><h2>🧪 Simulador FSRS</h2><p class="sub">Estimativa calculada pela Collection oficial do Anki.</p></div><button class="icon-btn" id="anki-sim-close">✕</button></div><div class="cards-modal-body">'+
      '<div class="field-group"><div class="field"><label>Dias a simular</label><input id="anki-sim-days" type="number" min="1" max="3650" value="365"></div><div class="field"><label>Retenção desejada (%)</label><input id="anki-sim-retention" type="number" min="70" max="99" value="'+Math.round((cfg.retention||.9)*100)+'"></div></div>'+
      '<div class="field-group"><div class="field"><label>Cards novos adicionais</label><input id="anki-sim-additional" type="number" min="0" max="1000000" value="0"></div><div class="field"><label>Novos por dia</label><input id="anki-sim-new-limit" type="number" min="0" max="999999" value="'+Math.max(0,Number(cfg.newPerDay)||0)+'"></div></div>'+
      '<div class="field-group"><div class="field"><label>Máximo de revisões/dia</label><input id="anki-sim-review-limit" type="number" min="0" max="999999" value="'+Math.max(0,Number(cfg.revPerDay)||0)+'"></div><div class="field"><label>Intervalo máximo (dias)</label><input id="anki-sim-max-interval" type="number" min="1" max="36500" value="'+Math.max(1,Number(cfg.maxInterval)||36500)+'"></div></div>'+
      '<div class="anki-sim-actions"><button class="btn-primary" id="anki-sim-run">Simular</button><button class="btn-secondary" id="anki-sim-help">Help Me Decide</button></div><div id="anki-sim-result"></div></div></div></div>';
    document.body.appendChild(d);
    document.getElementById('anki-sim-close').onclick=()=>document.getElementById('anki-fsrs-simulator').style.display='none';
    document.getElementById('anki-sim-run').onclick=()=>void this.runSimulator();
    document.getElementById('anki-sim-help').onclick=()=>void this.runHelpMeDecide();
  },

  openSimulator(){const m=document.getElementById('anki-fsrs-simulator');if(m)m.style.display='flex';},

  _simBars(arr,maxBars=90){
    const group=Math.max(1,Math.ceil(arr.length/maxBars)),xs=[];
    for(let i=0;i<arr.length;i+=group)xs.push(arr.slice(i,i+group).reduce((a,b)=>a+b,0)/Math.min(group,arr.length-i));
    const mx=Math.max(1,...xs);
    return '<div class="anki-sim-bars">'+xs.map((n,i)=>'<i style="height:'+Math.max(n?3:0,Math.round(n/mx*100))+'%" title="Período '+(i+1)+': '+Math.round(n)+'"></i>').join('')+'</div>';
  },

  _simOptions(){
    return {
      additionalNew:Number((document.getElementById('anki-sim-additional')||{}).value)||0,
      newLimit:Number((document.getElementById('anki-sim-new-limit')||{}).value)||0,
      reviewLimit:Number((document.getElementById('anki-sim-review-limit')||{}).value)||0,
      maxInterval:Number((document.getElementById('anki-sim-max-interval')||{}).value)||36500
    };
  },

  async runSimulator(){
    const days=Number((document.getElementById('anki-sim-days')||{}).value)||365,
      retention=(Number((document.getElementById('anki-sim-retention')||{}).value)||90)/100,
      out=document.getElementById('anki-sim-result');
    if(!out)return;
    out.innerHTML='<p class="hint">Simulando pela Collection oficial do Anki 26.09.3…</p>';
    try{
      const sim=await this.simulateOfficial(days,retention,this._simOptions()),
        total=sim.reviews.reduce((a,b)=>a+b,0)+sim.news.reduce((a,b)=>a+b,0),
        secs=sim.time.reduce((a,b)=>a+b,0);
      out.innerHTML='<div class="stat-kpis"><div class="stat-kpi"><div class="stat-kpi-v">'+Math.round(total/days)+'</div><div class="stat-kpi-l">respostas/dia</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+(secs/60/days).toFixed(1)+'m</div><div class="stat-kpi-l">tempo/dia</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+Math.round(sim.memorized.at(-1)||0)+'</div><div class="stat-kpi-l">memorizados ao final</div></div></div><h3>Carga projetada</h3>'+this._simBars(sim.reviews.map((x,i)=>x+sim.news[i]))+'<p class="hint">Motor oficial '+AnkiProductParity.esc(sim.engine)+' · busca '+AnkiProductParity.esc(sim.search||'preset atual')+'.</p>';
      return sim;
    }catch(e){
      out.innerHTML='<p class="hint tone-bad">Falha ao executar o simulador oficial: '+AnkiProductParity.esc(e&&e.message||e)+'</p>';
      throw e;
    }
  },

  async runHelpMeDecide(){
    const out=document.getElementById('anki-sim-result');if(!out)return;
    const days=Number((document.getElementById('anki-sim-days')||{}).value)||365,
      retention=(Number((document.getElementById('anki-sim-retention')||{}).value)||90)/100,
      opts=this._simOptions(),
      state=this._statsState||{},deckId=state.scope==='deck'?this._statsSelectedDeckId():null;
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.simulateFsrsPreset!=='function')throw new Error('Help Me Decide oficial indisponível.');
    out.innerHTML='<p class="hint">Calculando retenção ótima pela Collection oficial do Anki 26.09.3…</p>';
    try{
      const r=await CardsOfficialBridge.simulateFsrsPreset(deckId,days,retention,opts,'optimal'),
        rawOptimal=Number(r.out&&r.out.optimal_retention);
      if(!Number.isFinite(rawOptimal)||rawOptimal<=0)throw new Error('O Anki não retornou retenção ótima para estes dados.');
      const optimal=Math.max(.7,Math.min(.99,rawOptimal)),pct=(optimal*100).toFixed(2);
      out.innerHTML='<h3>Help Me Decide · Anki oficial</h3><div class="stat-kpis"><div class="stat-kpi"><div class="stat-kpi-v">'+pct+'%</div><div class="stat-kpi-l">retenção ótima prevista</div></div></div>'+
        '<p class="hint">Resultado de <code>compute_optimal_retention()</code> no backend oficial.</p><button type="button" class="btn-primary" id="anki-sim-use-optimal">Usar '+pct+'% no simulador</button>';
      const b=out.querySelector('#anki-sim-use-optimal');if(b)b.onclick=()=>{document.getElementById('anki-sim-retention').value=String(Math.round(optimal*10000)/100);void this.runSimulator();};
      return optimal;
    }catch(e){
      out.innerHTML='<p class="hint tone-bad">Help Me Decide falhou: '+AnkiProductParity.esc(e&&e.message||e)+'</p>';
      throw e;
    }
  },

  _patchCheck(){
    const modal=document.getElementById('anki-check-modal');if(!modal)return;
    const foot=modal.querySelector('.cards-modal-foot');
    if(foot&&!document.getElementById('anki-check-advanced')){
      const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.id='anki-check-advanced';b.textContent='🧰 Reparos avançados';foot.insertBefore(b,foot.firstChild);
      b.onclick=()=>void this.repairAdvanced();
    }
    const old=AnkiProductParity.renderCheck.bind(AnkiProductParity);
    AnkiProductParity.renderCheck=()=>{old();void this.renderExtendedCheck();};
  },

  structuralIssues(){return {officialOnly:true};},

  async renderExtendedCheck(){
    const body=document.getElementById('anki-check-body');if(!body)return;
    const wrap=document.createElement('div');wrap.id='anki-check-extended';
    wrap.innerHTML='<p class="hint">Executando Check Media pela Collection oficial do Anki 26.09.3…</p>';body.appendChild(wrap);
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.checkOfficialMedia!=='function'){
      wrap.innerHTML='<p class="hint tone-bad">Backend oficial do Anki indisponível. Nenhuma verificação local foi usada como substituta.</p>';return;
    }
    try{
      const m=await CardsOfficialBridge.checkOfficialMedia();
      if(!document.getElementById('anki-check-extended'))return;
      const unused=Array.isArray(m.unused)?m.unused:[],missing=Array.isArray(m.missing)?m.missing:[],
        missingNotes=Array.isArray(m.missing_media_notes)?m.missing_media_notes:(Array.isArray(m.missingMediaNotes)?m.missingMediaNotes:[]),
        haveTrash=!!(m.have_trash!=null?m.have_trash:m.haveTrash),report=String(m.report||'');
      wrap.innerHTML='<h3 class="anki-section-title">Check Media · Anki oficial</h3><div class="anki-check-grid">'+
        [['Referências ausentes',missing.length],['Mídias não utilizadas',unused.length],['Lixeira de mídia',haveTrash?1:0]].map(r=>'<div><span>'+AnkiProductParity.esc(r[0])+'</span><strong>'+r[1]+'</strong></div>').join('')+'</div>'+
        (report?'<details open><summary>Relatório do Check Media</summary><pre class="anki-check-report">'+AnkiProductParity.esc(report)+'</pre></details>':'')+
        '<div class="anki-media-actions"><button class="btn-secondary" id="anki-media-tag-missing" '+(!missingNotes.length?'disabled':'')+'>🏷 Etiquetar notas com mídia ausente</button><button class="btn-secondary" id="anki-media-trash-unused" '+(!unused.length?'disabled':'')+'>🗑 Excluir não utilizadas</button><button class="btn-secondary" id="anki-media-render-latex" '+(!missing.some(x=>String(x).startsWith('latex-'))?'disabled':'')+'>∑ Renderizar LaTeX</button><button class="btn-secondary" id="anki-media-restore" '+(!haveTrash?'disabled':'')+'>↺ Restaurar lixeira</button><button class="btn-danger" id="anki-media-empty-trash" '+(!haveTrash?'disabled':'')+'>Esvaziar lixeira</button></div>';
      const tag=document.getElementById('anki-media-tag-missing');if(tag)tag.onclick=()=>void this.tagMissingOfficial(missingNotes);
      const tr=document.getElementById('anki-media-trash-unused');if(tr)tr.onclick=()=>void this.trashUnusedOfficial(unused);
      const latex=document.getElementById('anki-media-render-latex');if(latex)latex.onclick=()=>void this.renderLatexOfficial();
      const rr=document.getElementById('anki-media-restore');if(rr)rr.onclick=()=>void this.restoreTrashOfficial();
      const et=document.getElementById('anki-media-empty-trash');if(et)et.onclick=()=>void this.emptyTrashOfficial();
    }catch(e){
      wrap.innerHTML='<p class="hint tone-bad">Check Media oficial falhou: '+AnkiProductParity.esc(e&&e.message?e.message:String(e))+'</p><p class="hint">Nenhum scanner local foi usado como fallback.</p>';
    }
  },

  async tagMissingOfficial(noteIds){
    try{
      const out=await CardsOfficialBridge.tagOfficialMissingMedia(noteIds);
      showToast(out&&out.count?out.count+' nota(s) etiquetada(s) pelo Anki oficial ✓':'Nenhuma nota precisava da tag missing-media');
      CardsOfficialBridge.invalidate('media-tag-missing');await CardsOfficialBridge.bootstrap(true);AnkiProductParity.renderCheck();
    }catch(e){showToast('Não foi possível etiquetar: '+(e&&e.message?e.message:String(e)));}
  },

  async trashUnusedOfficial(files){
    if(!files||!files.length)return;
    const ok=await UI.confirm('Excluir '+files.length+' mídia(s) não utilizadas? O Anki moverá os arquivos para a lixeira.',{title:'Excluir mídia não utilizada',okText:'Excluir',danger:true});
    if(!ok)return;
    try{await CardsOfficialBridge.trashOfficialMedia(files);showToast(files.length+' mídia(s) movida(s) para a lixeira pelo Anki oficial ✓');AnkiProductParity.renderCheck();}
    catch(e){showToast('Não foi possível excluir as mídias: '+(e&&e.message?e.message:String(e)));}
  },

  async restoreTrashOfficial(){
    try{await CardsOfficialBridge.restoreOfficialMediaTrash();showToast('Lixeira de mídia restaurada pelo Anki oficial ✓');AnkiProductParity.renderCheck();}
    catch(e){showToast('Não foi possível restaurar a lixeira: '+(e&&e.message?e.message:String(e)));}
  },

  async emptyTrashOfficial(){
    const ok=await UI.confirm('Excluir permanentemente as mídias da lixeira?',{title:'Esvaziar lixeira de mídia',okText:'Excluir',danger:true});if(!ok)return;
    try{await CardsOfficialBridge.emptyOfficialMediaTrash();showToast('Lixeira de mídia esvaziada pelo Anki oficial ✓');AnkiProductParity.renderCheck();}
    catch(e){showToast('Não foi possível esvaziar a lixeira: '+(e&&e.message?e.message:String(e)));}
  },

  async renderLatexOfficial(){
    try{
      const out=await CardsOfficialBridge.renderOfficialLatexMedia();
      showToast(out&&out.ok?'Todo o LaTeX foi renderizado pelo Anki oficial ✓':'Erro de LaTeX na nota '+String(out&&out.note_id||'?')+': '+String(out&&out.error||'erro desconhecido'));
      AnkiProductParity.renderCheck();
    }catch(e){showToast('Não foi possível renderizar LaTeX: '+(e&&e.message?e.message:String(e)));}
  },

  async repairAdvanced(){
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.checkOfficialDatabase!=='function'){showToast('Backend oficial do Anki indisponível.');return;}
    try{
      const out=await CardsOfficialBridge.checkOfficialDatabase();
      await CardsOfficialBridge.optimizeOfficialDatabase();
      CardsScreen.render();CardsScreen.updateFavCount();AnkiProductParity.renderCheck();
      showToast((out&&out.ok?'Banco verificado':'Verificação concluída')+' pela Collection oficial do Anki ✓');
    }catch(e){showToast('Check Database falhou: '+(e&&e.message?e.message:String(e)));}
  }
};
queueMicrotask(()=>AnkiMaxStatsMedia.install());
