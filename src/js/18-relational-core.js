/* RELATIONAL STORE — Supabase/Postgres é a única fonte de verdade dos dados do perfil. */
const RelationalStore = {
  enabled:true,_profileId:null,_applying:false,_loaded:false,_channel:null,_channelProfile:null,
  _resubTimer:null,_refreshTimers:Object.create(null),_lastChangeId:0,_pendingKeys:new Map(),
  _flushPromise:null,_syncing:false,_lastError:null,_lastSyncAt:null,
  TABLES:['study_plans','study_subjects','study_methods','study_phases','study_modes','study_statuses',
    'study_entries','study_links','study_custom_siglas','study_cards','study_review_log','study_laws',
    'study_law_keywords','study_extras','study_saved_grades','study_track_items','study_cycle_history',
    'study_tec_snapshots','study_tec_snapshot_rows','study_incidence','study_plan_state','study_profile_settings','study_decks'],
  isActive(){return !!(this.enabled&&window.CloudStore&&CloudStore.client&&CloudStore.isLoggedIn&&CloudStore.isLoggedIn());},
  _client(){if(!this.isActive())throw new Error('Nuvem indisponível: os dados de estudo exigem conexão com a conta.');return CloudStore.client;},
  _prefix(id){return 'diario-estudos:u:'+id+':';},
  _legacyId(v){if(v==null)return v;const s=String(v);return /^\d{10,16}$/.test(s)?Number(s):s;},
  _num(v){return v==null||v===''?null:Number(v);},
  _iso(v){return v==null?null:String(v).replace(' ','T').replace(/\+00$/,'+00:00');},
  _raw(v){if(v==null)return 'null';if(typeof v==='string')return v;if(typeof v==='number'||typeof v==='boolean')return String(v);return JSON.stringify(v);},
  _put(id,sub,v){localStorage.setItem(this._prefix(id)+sub,this._raw(v));},
  _clearMem(id){const p=this._prefix(id),ks=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(p))ks.push(k);}ks.forEach(k=>localStorage.removeItem(k));},
  _plansInMemory(id){try{return (JSON.parse(localStorage.getItem(this._prefix(id)+'planejamentos')||'[]')||[]).map(p=>String(p.id));}catch(_){return[];}},
  _group(rows,key){const m=Object.create(null);(rows||[]).forEach(r=>{const k=String(r[key]);(m[k]||(m[k]=[])).push(r);});return m;},
  async _select(table,id,order){let q=this._client().from(table).select('*').eq('profile_id',id);if(order)q=q.order(order,{ascending:true});const {data,error}=await q;if(error)throw error;return data||[];},
  async _profileRow(id){const {data,error}=await this._client().from('study_profiles').select('id,active_plan_id,profile_name,avatar,color,updated_at').eq('id',id).single();if(error)throw error;return data;},
  async _maxChange(id){const {data,error}=await this._client().from('study_change_log').select('change_id').eq('profile_id',id).order('change_id',{ascending:false}).limit(1);if(error)throw error;return data&&data.length?Number(data[0].change_id)||0:0;},
  async _loadDatasets(id,names){
    const wanted=names||this.TABLES,out=Object.create(null);
    await Promise.all(wanted.map(async table=>{
      let order=null;
      if(/^(study_plans|study_subjects|study_methods|study_phases|study_modes|study_statuses|study_entries|study_links|study_custom_siglas|study_cards|study_extras|study_saved_grades|study_cycle_history|study_tec_snapshots|study_incidence|study_track_items|study_decks)$/.test(table))order='position';
      if(table==='study_review_log')order='review_pk';
      if(table==='study_tec_snapshot_rows')order='row_no';
      out[table]=await this._select(table,id,order);
    }));
    return out;
  },
  _entry(r){return{id:this._legacyId(r.entry_id),date:r.study_date,subject:r.subject||'',lesson:r.lesson||'',method:r.method||'',durationMin:Number(r.duration_min||0),correct:Number(r.correct||0),total:Number(r.total||0),pageStart:this._num(r.page_start),pageEnd:this._num(r.page_end),videoStart:this._num(r.video_start),videoEnd:this._num(r.video_end),comment:r.comment||'',createdAt:this._iso(r.created_at)};},
  _card(r){return Object.assign({},r.extra||{},{id:this._legacyId(r.card_id),deckId:r.deck_id||null,materia:r.subject||'',topico:r.topic||'',tipo:r.card_type||null,frente:r.front||'',verso:r.back||'',favorito:!!r.favorite,status:r.status||null,banca:r.banca||null,kind:r.kind||null,due:r.due||null,dueTs:r.due_ts==null?null:Number(r.due_ts),ease:this._num(r.ease),intervalo:this._num(r.interval_value),lapses:Number(r.lapses||0),learnStep:r.learn_step==null?null:Number(r.learn_step),reps:Number(r.reps||0),phase:r.phase||null,reversedOf:r.reversed_of||null,d:this._num(r.d),s:this._num(r.s),algo:r.algo||null,lastReview:r.last_review||null,createdAt:this._iso(r.created_at),updatedAt:this._iso(r.updated_at)});},
  _review(r){return Object.assign({},r.extra||{},{cardId:this._legacyId(r.card_id),ts:r.ts==null?null:Number(r.ts),date:r.review_date||null,acerto:r.correct,grade:this._num(r.grade),elapsed:this._num(r.elapsed),phase:r.phase||null,intervalo:this._num(r.interval_value),d:this._num(r.d),s:this._num(r.s)});},
  _law(r){return Object.assign({},r.extra||{},{id:this._legacyId(r.law_id),titulo:r.title||'',referencia:r.reference||'',materia:r.subject||'',texto:r.body||'',bookmark:r.bookmarked,bookmarkTxt:r.bookmark_text||null,createdAt:this._iso(r.created_at),updatedAt:this._iso(r.updated_at),opts:r.options||{},marcacoes:r.markings||[],suppressed:r.suppressed,rodizio:r.rotation});},
  _extra(r){return Object.assign({},r.extra||{},r.provenance||{},{id:this._legacyId(r.extra_id),titulo:r.title||'',tipo:r.type||'',unidade:r.unit||'',marcador:r.marker||null,disciplina:r.discipline||null,alvo:this._num(r.target),progresso:this._num(r.progress),status:r.status||null,periodo:r.period||null,dataInicio:r.start_date||null,dataFim:r.end_date||null,contaMetricas:r.counts_metrics,createdAt:this._iso(r.created_at),updatedAt:this._iso(r.updated_at),concluidasEm:r.completed_dates||[],datas:r.dates||[],historico:r.history||[]});},
  _cycle(r){return Object.assign({},r.extra||{},{id:this._legacyId(r.cycle_id),startDate:r.start_date||null,endDate:r.end_date||null,closedAt:this._iso(r.closed_at),sessions:r.sessions,weeklyHours:this._num(r.weekly_hours),finalizadas:r.completed_subjects,pctCumprido:this._num(r.completion_pct),totalSubjects:r.total_subjects,totalTargetMin:r.total_target_min,totalStudiedMin:r.total_studied_min,avgPerformancePct:this._num(r.avg_performance_pct),avgPerformance:this._num(r.avg_performance_legacy),grade:r.grade||{},subjects:r.subjects||[]});},
  _incidence(r){return Object.assign({},r.extra||{},{id:this._legacyId(r.incidence_id),pct:this._num(r.pct),banca:r.banca||null,depth:r.depth==null?null:Number(r.depth),codigo:r.code||null,topico:r.topic||'',disciplina:r.discipline||'',incidencia:this._num(r.incidence)});},
  _tecRow(r){return Object.assign({},r.extra||{},{nome:r.name||'',peso:this._num(r.weight),depth:r.depth==null?null:Number(r.depth),codigo:r.code||null,acertos:r.correct==null?null:Number(r.correct),questoes:r.questions==null?null:Number(r.questions),pctAcerto:this._num(r.accuracy_pct),disciplina:r.discipline||''});},
  _track(r){const mk=(t,c)=>({total:t==null?null:Number(t),acertos:c==null?null:Number(c)});return Object.assign({},r.extra||{},{id:this._legacyId(r.item_id),type:r.item_type,label:r.label||undefined,text:r.item_text||undefined,status:r.status_id||undefined,r1:mk(r.r1_total,r.r1_correct),rCheck:mk(r.rcheck_total,r.rcheck_correct),rRev:mk(r.rrev_total,r.rrev_correct),resumo:r.summary||undefined});},
  _applySimpleByPlan(id,rows,suffix,conv){const grouped=this._group(rows,'plan_id'),plans=this._plansInMemory(id),all=new Set(plans.concat(Object.keys(grouped)));all.forEach(plan=>this._put(id,'p:'+plan+':'+suffix,(grouped[plan]||[]).map(conv)));},
  _applyDatasets(id,ds,full){
    this._applying=true;
    try{
      if(full)this._clearMem(id);
      if(ds.study_plans){const plans=ds.study_plans.slice().sort((a,b)=>(a.position||0)-(b.position||0)).filter(r=>!r.hidden).map(r=>({id:r.plan_id,nome:r.name,tipo:r.plan_type||'Outro',createdAt:this._iso(r.created_at)}));this._put(id,'planejamentos',plans);}
      if(ds._profile)this._put(id,'active-plan',ds._profile.active_plan_id||((ds.study_plans&&ds.study_plans[0])?ds.study_plans[0].plan_id:''));
      if(ds.study_profile_settings)ds.study_profile_settings.forEach(r=>this._put(id,r.key,r.value));
      if(ds.study_plan_state)ds.study_plan_state.forEach(r=>this._put(id,'p:'+r.plan_id+':'+r.key,r.value));
      if(ds.study_subjects)this._applySimpleByPlan(id,ds.study_subjects,'subjects',r=>({id:r.subject_id,nome:r.name,fase:r.phase,dificuldade:r.difficulty,ativo:r.active,modo:r.mode}));
      if(ds.study_methods)this._applySimpleByPlan(id,ds.study_methods,'methods',r=>({id:r.method_id,nome:r.name,ativo:r.active}));
      if(ds.study_phases)this._applySimpleByPlan(id,ds.study_phases,'phases',r=>({id:r.phase_id,nome:r.name,ativo:r.active}));
      if(ds.study_modes)this._applySimpleByPlan(id,ds.study_modes,'modes',r=>({id:r.mode_id,nome:r.name,ativo:r.active}));
      if(ds.study_statuses)this._applySimpleByPlan(id,ds.study_statuses,'statuses',r=>({id:r.status_id,nome:r.name,color:r.color,bg:r.background,done:r.done,ativo:r.active}));
      if(ds.study_entries)this._applySimpleByPlan(id,ds.study_entries,'entries',r=>this._entry(r));
      if(ds.study_links)this._applySimpleByPlan(id,ds.study_links,'links',r=>({id:r.link_id,nome:r.name,categoria:r.category,url:r.url,cor:r.color,logo:r.logo,createdAt:this._iso(r.created_at)}));
      if(ds.study_custom_siglas)this._applySimpleByPlan(id,ds.study_custom_siglas,'custom-siglas',r=>({id:r.sigla_id,nome:r.name,sigla:r.sigla,color:r.color}));
      if(ds.study_cards)this._applySimpleByPlan(id,ds.study_cards,'cards',r=>this._card(r));
      if(ds.study_review_log)this._applySimpleByPlan(id,ds.study_review_log,'revlog',r=>this._review(r));
      if(ds.study_laws)this._applySimpleByPlan(id,ds.study_laws,'leis',r=>this._law(r));
      if(ds.study_law_keywords)this._applySimpleByPlan(id,ds.study_law_keywords,'lei-keywords',r=>({t:r.term,cat:r.category,def:r.is_default}));
      if(ds.study_extras)this._applySimpleByPlan(id,ds.study_extras,'extras',r=>this._extra(r));
      if(ds.study_saved_grades)this._applySimpleByPlan(id,ds.study_saved_grades,'saved-grades',r=>({id:r.grade_id,nome:r.name,sessions:r.sessions,grade:r.grade,createdAt:this._iso(r.created_at)}));
      if(ds.study_cycle_history)this._applySimpleByPlan(id,ds.study_cycle_history,'cycle-history',r=>this._cycle(r));
      if(ds.study_incidence)this._applySimpleByPlan(id,ds.study_incidence,'incidencia',r=>this._incidence(r));
      if(ds.study_track_items){const byPlan=this._group(ds.study_track_items,'plan_id'),plans=new Set(this._plansInMemory(id).concat(Object.keys(byPlan)));plans.forEach(plan=>{const obj=Object.create(null);(byPlan[plan]||[]).forEach(r=>(obj[r.subject_name]||(obj[r.subject_name]=[])).push(this._track(r)));this._put(id,'p:'+plan+':tracks',obj);});}
      if(ds.study_tec_snapshots||ds.study_tec_snapshot_rows){const snaps=ds.study_tec_snapshots||[],rows=ds.study_tec_snapshot_rows||[],bySnap=Object.create(null);rows.forEach(r=>{const k=r.plan_id+'\u0000'+r.snapshot_id;(bySnap[k]||(bySnap[k]=[])).push(r);});const byPlan=this._group(snaps,'plan_id'),plans=new Set(this._plansInMemory(id).concat(Object.keys(byPlan)));plans.forEach(plan=>{const arr=(byPlan[plan]||[]).map(s=>({id:this._legacyId(s.snapshot_id),date:s.snapshot_date,startDate:s.start_date,endDate:s.end_date,label:s.label,importedAt:this._iso(s.imported_at),bancas:s.bancas||[],rows:(bySnap[plan+'\u0000'+s.snapshot_id]||[]).map(r=>this._tecRow(r))}));this._put(id,'p:'+plan+':tec',arr);});}
      if(ds.study_decks)this._applySimpleByPlan(id,ds.study_decks,'decks',r=>({id:r.deck_id,nome:r.name,createdAt:this._iso(r.created_at)}));
    }finally{this._applying=false;}
  },
  async hydrateProfile(id){
    if(!id)throw new Error('Perfil ausente');
    const ds=await this._loadDatasets(id);ds._profile=await this._profileRow(id);
    this._applyDatasets(id,ds,true);this._profileId=id;this._loaded=true;
    this._lastChangeId=await this._maxChange(id);this._lastSyncAt=Date.now();this._lastError=null;
    this.subscribe(id);
    try{if(window.__purgeProfileDataFromIDB)await window.__purgeProfileDataFromIDB(id);}catch(e){_quiet(e,'purge-idb-profile');}
    this._notifyVisible('hydrate');return{ok:true,mudou:1,origem:'relational'};
  },
  async _refreshTables(tables){
    const id=this._profileId;if(!id||!this.isActive())return false;
    const set=new Set(tables||[]);if(set.has('study_tec_snapshot_rows')||set.has('study_tec_snapshots')){set.add('study_tec_snapshot_rows');set.add('study_tec_snapshots');}
    const ds=await this._loadDatasets(id,Array.from(set).filter(t=>this.TABLES.includes(t)));if(set.has('study_plans'))ds._profile=await this._profileRow(id);
    this._applyDatasets(id,ds,false);this._lastSyncAt=Date.now();this._lastError=null;this._notifyVisible(Array.from(set).join(','));return true;
  },
  _notifyVisible(reason){
    try{
      if(window.AppSettings&&AppSettings.invalidar)AppSettings.invalidar();
      if(window.RegistrarScreen){if(RegistrarScreen.refreshSubjectSelect)RegistrarScreen.refreshSubjectSelect();if(RegistrarScreen.refreshMethodSelect)RegistrarScreen.refreshMethodSelect(false);if(RegistrarScreen.renderRecent)RegistrarScreen.renderRecent();}
      window.dispatchEvent(new CustomEvent('data:relational-changed',{detail:{reason}}));
      window.dispatchEvent(new CustomEvent('data:entry-changed',{detail:{reason}}));
      const active=document.querySelector('.screen.active');if(active&&active.id&&active.id.startsWith('screen-'))window.dispatchEvent(new CustomEvent('screen:activated',{detail:{screen:active.id.slice(7),reason:'relational'}}));
      if(window.CloudUI)CloudUI.refreshSyncBtn();
    }catch(e){_quiet(e,'relational-notify');}
  },
  subscribe(id){
    if(!this.isActive()||!id)return;if(this._channel&&this._channelProfile===id)return;this.unsubscribe();this._channelProfile=id;
    const name='study-change-log:'+id+':'+Math.random().toString(36).slice(2,8);
    try{this._channel=this._client().channel(name).on('postgres_changes',{event:'INSERT',schema:'public',table:'study_change_log',filter:'profile_id=eq.'+id},p=>this._onChange(p&&p.new)).subscribe(status=>{
      if(status==='SUBSCRIBED'){clearTimeout(this._resubTimer);this._resubTimer=null;this.canonicalCheck();}
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')this._scheduleResub();
    });}catch(e){this._lastError=e;this._scheduleResub();}
  },
  unsubscribe(){clearTimeout(this._resubTimer);this._resubTimer=null;if(this._channel&&window.CloudStore&&CloudStore.client){try{CloudStore.client.removeChannel(this._channel);}catch(_){}}this._channel=null;this._channelProfile=null;},
  _scheduleResub(){if(this._resubTimer)return;this._resubTimer=setTimeout(()=>{this._resubTimer=null;if(this._profileId){this.unsubscribe();this.subscribe(this._profileId);}},1500);},
  _onChange(row){
    if(!row||String(row.profile_id)!==String(this._profileId))return;this._lastChangeId=Math.max(this._lastChangeId||0,Number(row.change_id)||0);
    const table=String(row.table_name||'');if(!this.TABLES.includes(table)&&table!=='study_profiles')return;
    const key=table==='study_profiles'?'study_plans':table;clearTimeout(this._refreshTimers[key]);this._refreshTimers[key]=setTimeout(()=>{
      this._refreshTables(table==='study_profiles'?['study_plans']:[table]).catch(e=>{this._lastError=e;if(window.CloudUI)CloudUI.setStatus('error','Falha ao atualizar da nuvem');});
    },120);
  },
  async canonicalCheck(){if(!this._profileId||!this.isActive())return false;try{const max=await this._maxChange(this._profileId);if(max>(this._lastChangeId||0)){await this.hydrateProfile(this._profileId);return true;}return false;}catch(e){this._lastError=e;return false;}},
  async syncNow(){await this.flushPending();await this.canonicalCheck();this._lastSyncAt=Date.now();this._lastError=null;if(window.CloudUI)CloudUI.setStatus('ok','Sincronizado');return true;},
  async syncOnFocus(){if(!this.isActive()||!this._profileId)return false;await this.flushPending();return this.canonicalCheck();}
};
window.RelationalStore=RelationalStore;
