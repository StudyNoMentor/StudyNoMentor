/* ============================================================
   RELATIONAL STORE — Supabase é a única fonte persistente de verdade
   ============================================================ */
const RelationalStore = {
  enabled: true,
  _applying: false,
  _tail: Promise.resolve(),
  _pending: 0,
  _lastError: null,
  _lastSyncAt: null,
  _channel: null,
  _channelProfile: null,
  _rtTimer: null,
  _resubTimer: null,
  _heavyReady: new Set(),
  _heavyDirty: new Set(),
  _heavyLoads: new Map(),
  _heavyTimers: new Map(),
  _lastChangeId: new Map(),
  _lastHydratedAt: new Map(),

  isReady() {
    return !!(this.enabled && window.CloudStore && CloudStore.client && CloudStore.isLoggedIn && CloudStore.isLoggedIn());
  },
  pendingCount() { return this._pending; },

  _pfx(profileId) { return 'diario-estudos:u:' + profileId + ':'; },
  _raw(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, '__raw__')) return String(v.__raw__);
    return JSON.stringify(v);
  },
  _parse(raw, fallback) {
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  },
  _legacyId(v) {
    const s = String(v == null ? '' : v);
    return /^\d{1,15}$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : s;
  },
  _date(v) { return v ? String(v).slice(0, 10) : null; },
  _iso(v) { return v || null; },
  _chunks(a, n) {
    const out=[]; for(let i=0;i<(a||[]).length;i+=n) out.push(a.slice(i,i+n)); return out;
  },
  async _all(table, profileId, orderCols) {
    const size = 900, out = [];
    let from = 0;
    while (true) {
      let q = CloudStore.client.from(table).select('*').eq('profile_id', profileId);
      (orderCols || []).forEach(o => { q = q.order(o.col, { ascending: o.asc !== false }); });
      q = q.range(from, from + size - 1);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      out.push(...rows);
      if (rows.length < size) break;
      from += size;
    }
    return out;
  },
  _memSet(k, v) {
    this._applying = true;
    try { localStorage.setItem(k, String(v)); }
    finally { this._applying = false; }
  },
  _memDel(k) {
    this._applying = true;
    try { localStorage.removeItem(k); }
    finally { this._applying = false; }
  },
  _isHeavyMemoryKey(profileId, key) {
    const p=this._pfx(profileId);
    if(!key || key.indexOf(p)!==0) return false;
    return /^p:[^:]+:(tec|incidencia)$/.test(key.slice(p.length));
  },
  _clearProfileMemory(profileId, opts) {
    opts=opts||{};
    const p = this._pfx(profileId), keys=[];
    this._applying = true;
    try {
      for (let i=0;i<localStorage.length;i++) {
        const k=localStorage.key(i);
        if(!k || k.indexOf(p)!==0) continue;
        if(opts.preserveHeavy && this._isHeavyMemoryKey(profileId,k)) continue;
        keys.push(k);
      }
      keys.forEach(k=>localStorage.removeItem(k));
    } finally { this._applying=false; }
  },
  _clearHeavyMemory(profileId) {
    const keys=[];
    this._applying=true;
    try {
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(this._isHeavyMemoryKey(profileId,k)) keys.push(k);
      }
      keys.forEach(k=>localStorage.removeItem(k));
    } finally { this._applying=false; }
  },
  _group(rows, key='plan_id') {
    const m=new Map();
    (rows||[]).forEach(r=>{ const k=r[key]; if(!m.has(k))m.set(k,[]); m.get(k).push(r); });
    return m;
  },


  _coreSpecs() {
    return [
      ['plans','study_plans',[{col:'position'}]],
      ['profileSettings','study_profile_settings',[{col:'key'}]],
      ['planState','study_plan_state',[{col:'plan_id'},{col:'key'}]],
      ['subjects','study_subjects',[{col:'plan_id'},{col:'position'}]],
      ['methods','study_methods',[{col:'plan_id'},{col:'position'}]],
      ['phases','study_phases',[{col:'plan_id'},{col:'position'}]],
      ['statuses','study_statuses',[{col:'plan_id'},{col:'position'}]],
      ['modes','study_modes',[{col:'plan_id'},{col:'position'}]],
      ['entries','study_entries',[{col:'plan_id'},{col:'position'}]],
      ['decks','study_decks',[{col:'plan_id'},{col:'position'}]],
      ['cards','study_cards',[{col:'plan_id'},{col:'position'}]],
      ['revlog','study_review_log',[{col:'plan_id'},{col:'position'}]],
      ['laws','study_laws',[{col:'plan_id'},{col:'position'}]],
      ['lawKeywords','study_law_keywords',[{col:'plan_id'},{col:'position'}]],
      ['links','study_links',[{col:'plan_id'},{col:'position'}]],
      ['extras','study_extras',[{col:'plan_id'},{col:'position'}]],
      ['siglas','study_custom_siglas',[{col:'plan_id'},{col:'position'}]],
      ['cycles','study_cycle_history',[{col:'plan_id'},{col:'position'}]],
      ['savedGrades','study_saved_grades',[{col:'plan_id'},{col:'position'}]],
      ['tracks','study_track_items',[{col:'plan_id'},{col:'subject_name'},{col:'position'}]]
    ];
  },
  _heavySpecs() {
    return [
      ['tecSnapshots','study_tec_snapshots',[{col:'plan_id'},{col:'position'}]],
      ['tecRows','study_tec_snapshot_rows',[{col:'plan_id'},{col:'snapshot_id'},{col:'row_no'}]],
      ['incidence','study_incidence',[{col:'plan_id'},{col:'row_no'}]]
    ];
  },
  _rpcMissing(error) {
    const code=String(error&&error.code||'');
    const msg=String(error&&error.message||'').toLowerCase();
    return code==='PGRST202'||code==='42883'||msg.includes('could not find the function')||msg.includes('does not exist');
  },
  async _rpcBundle(name, args) {
    const {data,error}=await CloudStore.client.rpc(name,args||{});
    if(error){
      if(this._rpcMissing(error)) return {missing:true,data:null};
      throw error;
    }
    return {missing:false,data};
  },
  async _loadCoreBundle(profileId) {
    const rpc=await this._rpcBundle('read_study_profile_core',{p_profile_id:profileId});
    if(!rpc.missing){
      if(!rpc.data||!rpc.data.profile){ const e=new Error('Perfil não encontrado na nuvem'); e.code='perfil-inexistente'; throw e; }
      return rpc.data;
    }
    const profileQ=CloudStore.client.from('study_profiles')
      .select('id,profile_name,avatar,color,pin_hash,active_plan_id,created_at,updated_at')
      .eq('id',profileId).maybeSingle();
    const specs=this._coreSpecs();
    const [profileRes,...loaded]=await Promise.all([profileQ,...specs.map(x=>this._all(x[1],profileId,x[2]))]);
    if(profileRes.error) throw profileRes.error;
    if(!profileRes.data){ const e=new Error('Perfil não encontrado na nuvem'); e.code='perfil-inexistente'; throw e; }
    const d={profile:profileRes.data}; specs.forEach((x,i)=>d[x[0]]=loaded[i]);
    return d;
  },
  async _loadHeavyBundle(profileId) {
    const rpc=await this._rpcBundle('read_study_profile_heavy',{p_profile_id:profileId});
    if(!rpc.missing) return rpc.data||{tecSnapshots:[],tecRows:[],incidence:[]};
    const specs=this._heavySpecs();
    const loaded=await Promise.all(specs.map(x=>this._all(x[1],profileId,x[2])));
    const d={}; specs.forEach((x,i)=>d[x[0]]=loaded[i]);
    return d;
  },
  _trace(etapa,extra) {
    try { if(window.StartupTrace&&StartupTrace.mark) StartupTrace.mark(etapa,extra||{}); } catch(e){ _quiet(e,'rel-trace'); }
  },
  async _latestChangeId(profileId) {
    const {data,error}=await CloudStore.client.from('study_change_log')
      .select('change_id').eq('profile_id',profileId)
      .order('change_id',{ascending:false}).limit(1);
    if(error) throw error;
    return data&&data[0] ? Number(data[0].change_id)||0 : 0;
  },
  async _changeSummary(profileId, after) {
    const base=Number(after)||0;
    const rpc=await this._rpcBundle('read_study_change_summary',{
      p_profile_id:profileId,p_after_change_id:base
    });
    if(!rpc.missing){
      const d=rpc.data||{};
      return {
        count:Number(d.count)||0,
        maxChangeId:Number(d.max_change_id)||base,
        tables:Array.isArray(d.tables)?d.tables.filter(Boolean):[],
        truncated:false
      };
    }
    const {data,error}=await CloudStore.client.from('study_change_log')
      .select('change_id,table_name').eq('profile_id',profileId)
      .gt('change_id',base).order('change_id',{ascending:true}).limit(1000);
    if(error) throw error;
    const rows=data||[];
    return {
      count:rows.length,
      maxChangeId:rows.length?Number(rows[rows.length-1].change_id)||base:base,
      tables:[...new Set(rows.map(x=>x.table_name).filter(Boolean))],
      truncated:rows.length>=1000
    };
  },

  async hydrateUserPreferences() {
    if (!this.isReady()) return false;
    const uid = CloudStore.session && CloudStore.session.user && CloudStore.session.user.id;
    if (!uid) return false;
    const { data, error } = await CloudStore.client.from('user_preferences').select('key,value').eq('user_id', uid);
    if (error) throw error;
    this._applying=true;
    try {
      (data||[]).forEach(r => localStorage.setItem('diario-estudos:' + r.key, this._raw(r.value)));
    } finally { this._applying=false; }
    return true;
  },

  _applyCoreBundle(profileId, d, opts) {
    opts=opts||{};
    this._clearProfileMemory(profileId,{preserveHeavy:!!opts.preserveHeavy});
    const pfx=this._pfx(profileId);
    const profile=d.profile||{};
    const visiblePlans=(d.plans||[]).filter(p=>!p.hidden);
    this._memSet(pfx+'planejamentos', JSON.stringify(visiblePlans.map(p=>({
      id:p.plan_id,nome:p.name,tipo:p.plan_type||'',createdAt:p.created_at
    }))));
    let active=profile.active_plan_id;
    if(!active||!visiblePlans.some(p=>p.plan_id===active)) active=visiblePlans[0]&&visiblePlans[0].plan_id;
    if(active) this._memSet(pfx+'active-plan',active);

    (d.profileSettings||[]).forEach(r=>this._memSet(pfx+r.key,this._raw(r.value)));
    (d.planState||[]).forEach(r=>this._memSet(pfx+'p:'+r.plan_id+':'+r.key,this._raw(r.value)));

    const putGroups=(rows,suffix,map)=>{
      this._group(rows).forEach((arr,plan)=>this._memSet(pfx+'p:'+plan+':'+suffix,JSON.stringify(arr.map(map))));
    };
    putGroups(d.subjects,'subjects',r=>({id:r.subject_id,nome:r.name,fase:r.phase,dificuldade:r.difficulty,ativo:r.active,modo:r.mode}));
    putGroups(d.methods,'methods',r=>({id:r.method_id,nome:r.name,ativo:r.active}));
    putGroups(d.phases,'phases',r=>({id:r.phase_id,nome:r.name,ativo:r.active}));
    putGroups(d.statuses,'statuses',r=>({id:r.status_id,nome:r.name,color:r.color,bg:r.background,done:r.done,ativo:r.active}));
    putGroups(d.modes,'modes',r=>({id:r.mode_id,nome:r.name,ativo:r.active}));
    putGroups(d.entries,'entries',r=>({
      id:this._legacyId(r.entry_id),date:this._date(r.study_date),subject:r.subject,lesson:r.lesson||'',method:r.method||'',
      durationMin:r.duration_min||0,correct:r.correct||0,total:r.total||0,pageStart:r.page_start==null?null:Number(r.page_start),
      pageEnd:r.page_end==null?null:Number(r.page_end),videoStart:r.video_start==null?null:Number(r.video_start),
      videoEnd:r.video_end==null?null:Number(r.video_end),comment:r.comment||'',createdAt:r.created_at
    }));
    putGroups(d.decks,'decks',r=>({id:this._legacyId(r.deck_id),nome:r.name,createdAt:r.created_at}));
    putGroups(d.cards,'cards',r=>Object.assign({},r.extra||{},{
      id:this._legacyId(r.card_id),deckId:r.deck_id||null,materia:r.subject||null,assunto:r.topic||null,tipo:r.card_type||null,
      frente:r.front||'',verso:r.back||'',favorito:!!r.favorite,status:r.status||null,banca:r.banca||null,kind:r.kind||null,
      due:r.due||null,dueTs:r.due_ts==null?null:Number(r.due_ts),ease:r.ease==null?null:Number(r.ease),
      intervalo:r.interval_value==null?null:Number(r.interval_value),lapses:r.lapses,learnStep:r.learn_step,reps:r.reps,
      phase:r.phase,reversedOf:r.reversed_of,d:r.d==null?null:Number(r.d),s:r.s==null?null:Number(r.s),algo:r.algo,
      lastReview:r.last_review,createdAt:r.created_at,updatedAt:r.updated_at
    }));
    putGroups(d.revlog,'revlog',r=>Object.assign({},r.extra||{},{
      cardId:r.card_id==null?null:this._legacyId(r.card_id),ts:r.ts==null?null:Number(r.ts),date:r.review_date,
      acerto:r.correct,grade:r.grade==null?null:Number(r.grade),elapsed:r.elapsed==null?null:Number(r.elapsed),
      phase:r.phase,intervalo:r.interval_value==null?null:Number(r.interval_value),d:r.d==null?null:Number(r.d),s:r.s==null?null:Number(r.s)
    }));
    putGroups(d.laws,'leis',r=>Object.assign({},r.extra||{},{
      id:this._legacyId(r.law_id),titulo:r.title,referencia:r.reference,materia:r.subject,texto:r.body||'',
      bookmark:r.bookmarked,bookmarkTxt:r.bookmark_text,createdAt:r.created_at,updatedAt:r.updated_at,
      opts:r.options||{},marcacoes:r.markings||[],suppressed:r.suppressed,rodizio:r.rotation
    }));
    putGroups(d.lawKeywords,'lei-keywords',r=>({t:r.term,cat:r.category,def:r.is_default}));
    putGroups(d.links,'links',r=>({id:this._legacyId(r.link_id),nome:r.name,categoria:r.category,url:r.url,cor:r.color,logo:r.logo,createdAt:r.created_at}));
    putGroups(d.extras,'extras',r=>{
      const p=r.provenance||{};
      return Object.assign({},r.extra||{},{
        id:this._legacyId(r.extra_id),titulo:r.title,tipo:r.type,unidade:r.unit,marcador:r.marker,disciplina:r.discipline,
        alvo:r.target==null?null:Number(r.target),progresso:r.progress==null?null:Number(r.progress),status:r.status,periodo:r.period,
        dataInicio:this._date(r.start_date),dataFim:this._date(r.end_date),contaMetricas:r.counts_metrics,createdAt:r.created_at,
        updatedAt:r.updated_at,concluidasEm:r.completed_dates||[],datas:r.dates||[],historico:r.history||[],
        origemPlano:p.origemPlano,reforcoFila:p.reforcoFila,origemLacunaGlobal:p.origemLacunaGlobal,origemLei:p.origemLei
      });
    });
    putGroups(d.siglas,'custom-siglas',r=>({id:this._legacyId(r.sigla_id),nome:r.name,sigla:r.sigla,color:r.color}));
    putGroups(d.cycles,'cycle-history',r=>Object.assign({},r.extra||{},{
      id:this._legacyId(r.cycle_id),startDate:this._date(r.start_date),endDate:this._date(r.end_date),closedAt:r.closed_at,
      sessions:r.sessions,weeklyHours:r.weekly_hours==null?null:Number(r.weekly_hours),finalizadas:r.completed_subjects,
      pctCumprido:r.completion_pct==null?null:Number(r.completion_pct),totalSubjects:r.total_subjects,
      totalTargetMin:r.total_target_min,totalStudiedMin:r.total_studied_min,
      avgPerformancePct:r.avg_performance_pct==null?null:Number(r.avg_performance_pct),
      avgPerformancePctLegado:r.avg_performance_legacy==null?undefined:Number(r.avg_performance_legacy),
      grade:r.grade,subjects:r.subjects
    }));
    putGroups(d.savedGrades,'saved-grades',r=>({id:this._legacyId(r.grade_id),nome:r.name,sessions:r.sessions,grade:r.grade,createdAt:r.created_at}));

    const trackGroups=new Map();
    (d.tracks||[]).forEach(r=>{
      if(!trackGroups.has(r.plan_id))trackGroups.set(r.plan_id,{});
      const obj=trackGroups.get(r.plan_id); if(!obj[r.subject_name])obj[r.subject_name]=[];
      obj[r.subject_name].push(Object.assign({},r.extra||{},{
        id:this._legacyId(r.item_id),type:r.item_type,label:r.label,text:r.item_text,status:r.status_id,resumo:r.summary,
        r1:{total:r.r1_total,acertos:r.r1_correct},rCheck:{total:r.rcheck_total,acertos:r.rcheck_correct},rRev:{total:r.rrev_total,acertos:r.rrev_correct}
      }));
    });
    trackGroups.forEach((obj,plan)=>this._memSet(pfx+'p:'+plan+':tracks',JSON.stringify(obj)));
  },

  _applyHeavyBundle(profileId, d) {
    this._clearHeavyMemory(profileId);
    const pfx=this._pfx(profileId);
    const putGroups=(rows,suffix,map)=>{
      this._group(rows).forEach((arr,plan)=>this._memSet(pfx+'p:'+plan+':'+suffix,JSON.stringify(arr.map(map))));
    };
    const tecRowsBy=new Map();
    (d.tecRows||[]).forEach(r=>{
      const k=r.plan_id+'\u0000'+r.snapshot_id;if(!tecRowsBy.has(k))tecRowsBy.set(k,[]);
      tecRowsBy.get(k).push(Object.assign({},r.extra||{},{
        nome:r.name,peso:r.weight==null?null:Number(r.weight),depth:r.depth,codigo:r.code,acertos:r.correct,questoes:r.questions,
        pctAcerto:r.accuracy_pct==null?null:Number(r.accuracy_pct),disciplina:r.discipline
      }));
    });
    putGroups(d.tecSnapshots,'tec',r=>Object.assign({},r.extra||{},{
      id:this._legacyId(r.snapshot_id),date:this._date(r.snapshot_date),startDate:this._date(r.start_date),endDate:this._date(r.end_date),
      importedAt:r.imported_at,label:r.label,bancas:r.bancas,rows:tecRowsBy.get(r.plan_id+'\u0000'+r.snapshot_id)||[]
    }));
    putGroups(d.incidence,'incidencia',r=>Object.assign({},r.extra||{},{
      id:r.incidence_id,pct:r.pct==null?null:Number(r.pct),banca:r.banca,depth:r.depth,codigo:r.code,topico:r.topic,
      disciplina:r.discipline,incidencia:r.incidence==null?null:Number(r.incidence)
    }));
  },

  isHeavyReady(profileId) {
    const id=profileId||(window.ProfileManager&&ProfileManager.getActiveProfileId&&ProfileManager.getActiveProfileId());
    return !!(id&&this._heavyReady.has(id)&&!this._heavyDirty.has(id));
  },

  async ensureHeavyData(profileId, opts) {
    opts=opts||{};
    const id=profileId||(window.ProfileManager&&ProfileManager.getActiveProfileId&&ProfileManager.getActiveProfileId());
    if(!id||!this.isReady())return false;
    const force=!!opts.force||this._heavyDirty.has(id);
    if(!force&&this._heavyReady.has(id))return {ok:true,mudou:0,cached:true};
    if(this._heavyLoads.has(id))return this._heavyLoads.get(id);
    const job=(async()=>{
      const t0=Date.now();
      this._trace('rel-heavy-inicio',{profileId:id,reason:opts.reason||'demand'});
      const d=await this._loadHeavyBundle(id);
      this._applyHeavyBundle(id,d||{});
      this._heavyReady.add(id);this._heavyDirty.delete(id);
      this._lastSyncAt=Date.now();this._lastError=null;
      this._trace('rel-heavy-ok',{profileId:id,ms:Date.now()-t0});
      try{window.dispatchEvent(new CustomEvent('data:relational-heavy-hydrated',{detail:{profileId:id,reason:opts.reason||'demand'}}));}catch(e){_quiet(e,'rel-heavy-event');}
      return {ok:true,mudou:1};
    })();
    this._heavyLoads.set(id,job);
    try{return await job;}
    catch(e){this._lastError=e;throw e;}
    finally{this._heavyLoads.delete(id);}
  },

  scheduleHeavyData(profileId, opts) {
    opts=opts||{};
    const id=profileId;if(!id||this.isHeavyReady(id)||this._heavyLoads.has(id))return false;
    try{const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if(c&&c.saveData)return false;}catch(e){_quiet(e,'rel-heavy-network-info');}
    if(this._heavyTimers.has(id))return true;
    const run=()=>{this._heavyTimers.delete(id);this.ensureHeavyData(id,{reason:opts.reason||'idle-prefetch'}).catch(e=>_quiet(e,'rel-heavy-prefetch'));};
    const delay=Math.max(300,Number(opts.delay)||2500);
    const timer=setTimeout(()=>{
      if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:2500});else run();
    },delay);
    this._heavyTimers.set(id,timer);
    return true;
  },

  async hydrateProfile(profileId, opts) {
    opts=opts||{};
    if(!this.isReady())throw new Error('Banco indisponível');
    const t0=Date.now();
    this._trace('rel-core-inicio',{profileId,reason:opts.reason||'open'});
    let watermark=this._lastChangeId.get(profileId)||0;
    if(!this._lastChangeId.has(profileId)&&!opts.skipWatermark){
      try{watermark=await this._latestChangeId(profileId);}catch(e){_quiet(e,'rel-watermark');}
    }
    const d=await this._loadCoreBundle(profileId);
    this._applyCoreBundle(profileId,d,{preserveHeavy:!!opts.preserveHeavy});
    if(!opts.preserveHeavy){this._heavyReady.delete(profileId);this._heavyDirty.add(profileId);}
    this._lastChangeId.set(profileId,Math.max(Number(this._lastChangeId.get(profileId))||0,Number(watermark)||0));
    this._lastHydratedAt.set(profileId,Date.now());
    this._lastSyncAt=Date.now();this._lastError=null;
    this.subscribeProfile(profileId);
    this._trace('rel-core-ok',{profileId,ms:Date.now()-t0});
    try{window.dispatchEvent(new CustomEvent('data:relational-hydrated',{detail:{profileId,reason:opts.reason||'open',phase:'core',heavyReady:this.isHeavyReady(profileId)}}));}catch(e){_quiet(e,'rel-hydrated-event');}
    if(opts.includeHeavy!==false)await this.ensureHeavyData(profileId,{reason:opts.reason||'hydrate',force:true});
    return {ok:true,mudou:1,profile:d.profile,heavyReady:this.isHeavyReady(profileId)};
  },

  _queue(label, task) {
    this._pending++;
    const run = async()=>{
      let last;
      for(let i=0;i<3;i++){
        try { const r=await task(); this._lastError=null; this._lastSyncAt=Date.now(); return r; }
        catch(e){ last=e; if(i<2) await new Promise(res=>setTimeout(res,[250,900][i])); }
      }
      this._lastError=last; throw last;
    };
    const p=this._tail.then(run,run);
    this._tail=p.catch(e=>{ console.error('[RelationalStore]',label,e); }).finally(()=>{
      this._pending=Math.max(0,this._pending-1);
      try { if(window.CloudUI)CloudUI.refreshSyncBtn(); } catch(e){ _quiet(e, 'rel-sync-btn-idle'); }
    });
    try { if(window.CloudUI)CloudUI.refreshSyncBtn('syncing','Salvando no banco…'); } catch(e){ _quiet(e, 'rel-sync-btn-saving'); }
    return p;
  },
  async flush() {
    await this._tail;
    if (this._lastError) throw this._lastError;
    return true;
  },

  _keyParts(key) {
    const m=/^diario-estudos:u:([^:]+):p:([^:]+):(.+)$/.exec(String(key||''));
    if(m)return {scope:'plan',profileId:m[1],planId:m[2],sub:m[3]};
    const p=/^diario-estudos:u:([^:]+):(.+)$/.exec(String(key||''));
    if(p)return {scope:'profile',profileId:p[1],sub:p[2]};
    if(String(key||'').indexOf('diario-estudos:')===0)return {scope:'user',sub:String(key).slice('diario-estudos:'.length)};
    return null;
  },
  _ignoreSub(sub) {
    /* A lixeira é projeção transitória de segurança e não vira configuração.
       Os marcadores de fila/revisão da sincronização antiga foram eliminados. */
    return sub.indexOf('__lixeira:') === 0;
  },
  onStorageMutation(key, oldRaw, newRaw) {
    if(this._applying || !this.enabled) return;
    /* O portão de acesso pode montar/medir telas antes de existir uma sessão.
       Essas escritas de UI são apenas projeção efêmera; não entram em fila e
       não viram falso erro de banco. Depois do login, isReady() permanece true
       mesmo se a rede oscilar, então mutações reais continuam sendo retentadas. */
    if(!this.isReady()) return;
    const p=this._keyParts(key); if(!p) return;
    if(p.scope==='user') {
      if(p.sub==='profiles'||p.sub==='active-profile') return;
      this._queue('user:'+p.sub,()=>this._persistUserPref(p.sub,newRaw));
      return;
    }
    if(this._ignoreSub(p.sub)) return;
    if(p.scope==='profile'){
      if(p.sub==='planejamentos') this._queue('plans',()=>this._persistPlans(p.profileId,oldRaw,newRaw));
      else if(p.sub==='active-plan') this._queue('active-plan',()=>this._persistActivePlan(p.profileId,newRaw));
      else this._queue('profile:'+p.sub,()=>this._persistProfileSetting(p.profileId,p.sub,newRaw));
      return;
    }
    this._queue('plan:'+p.sub,()=>this._persistPlanKey(p.profileId,p.planId,p.sub,oldRaw,newRaw));
  },

  async _persistUserPref(key, raw) {
    if(!this.isReady()) throw new Error('Sem conexão com o banco');
    const uid=CloudStore.session.user.id;
    if(raw==null){ const {error}=await CloudStore.client.from('user_preferences').delete().eq('user_id',uid).eq('key',key); if(error)throw error; return; }
    let value; try{value=JSON.parse(raw);}catch(_){value={__raw__:String(raw)};}
    const {error}=await CloudStore.client.from('user_preferences').upsert({user_id:uid,key,value,updated_at:new Date().toISOString()},{onConflict:'user_id,key'});
    if(error)throw error;
  },
  async _persistActivePlan(profileId, raw) {
    if(!this.isReady())throw new Error('Sem conexão com o banco');
    const planId=raw==null?null:String(raw).replace(/^"|"$/g,'');
    const {error}=await CloudStore.client.from('study_profiles').update({active_plan_id:planId,updated_at:new Date().toISOString()}).eq('id',profileId);
    if(error)throw error;
  },
  async _persistProfileSetting(profileId,key,raw) {
    if(!this.isReady())throw new Error('Sem conexão com o banco');
    if(raw==null){ const {error}=await CloudStore.client.from('study_profile_settings').delete().eq('profile_id',profileId).eq('key',key); if(error)throw error; return; }
    let value; try{value=JSON.parse(raw);}catch(_){value={__raw__:String(raw)};}
    const {error}=await CloudStore.client.from('study_profile_settings').upsert({profile_id:profileId,key,value,updated_at:new Date().toISOString()},{onConflict:'profile_id,key'});
    if(error)throw error;
  },
  async _persistPlanState(profileId,planId,key,raw) {
    if(raw==null){ const {error}=await CloudStore.client.from('study_plan_state').delete().eq('profile_id',profileId).eq('plan_id',planId).eq('key',key); if(error)throw error; return; }
    let value; try{value=JSON.parse(raw);}catch(_){value={__raw__:String(raw)};}
    const {error}=await CloudStore.client.from('study_plan_state').upsert({profile_id:profileId,plan_id:planId,key,value,updated_at:new Date().toISOString()},{onConflict:'profile_id,plan_id,key'});
    if(error)throw error;
  },
  async _upsertChunks(table, rows, onConflict) {
    for(const ch of this._chunks(rows,350)){
      const {error}=await CloudStore.client.from(table).upsert(ch,{onConflict});
      if(error)throw error;
    }
  },
  async _syncById(table, profileId, planId, idCol, oldArr, newArr, map, onConflict) {
    oldArr=Array.isArray(oldArr)?oldArr:[]; newArr=Array.isArray(newArr)?newArr:[];
    const oldById=new Map();
    oldArr.forEach((x,i)=>{ if(x&&x.id!=null) oldById.set(String(x.id),{raw:x,index:i}); });
    const newIds=new Set(newArr.filter(x=>x&&x.id!=null).map(x=>String(x.id)));
    const removed=[...oldById.keys()].filter(x=>!newIds.has(x));
    const rows=[];
    newArr.forEach((x,i)=>{
      if(!x||x.id==null)return;
      const id=String(x.id), prev=oldById.get(id);
      const changed=!prev || prev.index!==i || JSON.stringify(prev.raw)!==JSON.stringify(x);
      if(changed){ const row=map(x,i); if(row)rows.push(row); }
    });
    if(!removed.length&&!rows.length)return;
    const {error}=await CloudStore.client.rpc('mutate_study_plan_rows',{
      p_table:table,p_profile_id:profileId,p_plan_id:planId,p_delete_ids:removed,p_rows:rows
    });
    if(error)throw error;
  },
  async _replacePlanRows(table,profileId,planId,rows,onConflict){
    const {error}=await CloudStore.client.rpc('replace_study_plan_rows',{
      p_table:table,p_profile_id:profileId,p_plan_id:planId,p_rows:rows||[]
    });
    if(error)throw error;
  },
  _arr(raw){const v=this._parse(raw,[]);return Array.isArray(v)?v:[];},
  _obj(raw){const v=this._parse(raw,{});return v&&typeof v==='object'&&!Array.isArray(v)?v:{};},

  async _persistPlans(profileId,oldRaw,newRaw){
    const newA=this._arr(newRaw);
    const rows=newA.map((p,i)=>({profile_id:profileId,plan_id:String(p.id),name:p.nome||String(p.id),plan_type:p.tipo||null,created_at:p.createdAt||new Date().toISOString(),position:i+1,hidden:false,legacy_orphan:false}));
    const {error}=await CloudStore.client.rpc('mutate_study_plans',{p_profile_id:profileId,p_rows:rows});
    if(error)throw error;
  },

  async _persistPlanKey(profileId,planId,sub,oldRaw,newRaw){
    const oldA=this._arr(oldRaw),newA=this._arr(newRaw),base=(r)=>({profile_id:profileId,plan_id:planId});
    if(sub==='subjects')return this._syncById('study_subjects',profileId,planId,'subject_id',oldA,newA,(x,i)=>Object.assign(base(),{subject_id:String(x.id),name:x.nome||'',phase:x.fase||null,difficulty:x.dificuldade==null?null:Number(x.dificuldade),active:x.ativo!==false,mode:x.modo||null,position:i+1}),'profile_id,plan_id,subject_id');
    if(sub==='methods')return this._syncById('study_methods',profileId,planId,'method_id',oldA,newA,(x,i)=>Object.assign(base(),{method_id:String(x.id),name:x.nome||'',active:x.ativo!==false,position:i+1}),'profile_id,plan_id,method_id');
    if(sub==='phases')return this._syncById('study_phases',profileId,planId,'phase_id',oldA,newA,(x,i)=>Object.assign(base(),{phase_id:String(x.id),name:x.nome||'',active:x.ativo!==false,position:i+1}),'profile_id,plan_id,phase_id');
    if(sub==='statuses')return this._syncById('study_statuses',profileId,planId,'status_id',oldA,newA,(x,i)=>Object.assign(base(),{status_id:String(x.id),name:x.nome||'',color:x.color||null,background:x.bg||null,done:!!x.done,active:x.ativo!==false,position:i+1}),'profile_id,plan_id,status_id');
    if(sub==='modes')return this._syncById('study_modes',profileId,planId,'mode_id',oldA,newA,(x,i)=>Object.assign(base(),{mode_id:String(x.id),name:x.nome||'',active:x.ativo!==false,position:i+1}),'profile_id,plan_id,mode_id');
    if(sub==='entries')return this._syncById('study_entries',profileId,planId,'entry_id',oldA,newA,(x,i)=>Object.assign(base(),{entry_id:String(x.id),study_date:x.date,subject:x.subject||'',lesson:x.lesson||'',method:x.method||'',duration_min:Number(x.durationMin)||0,correct:Number(x.correct)||0,total:Number(x.total)||0,page_start:x.pageStart==null?null:Number(x.pageStart),page_end:x.pageEnd==null?null:Number(x.pageEnd),video_start:x.videoStart==null?null:Number(x.videoStart),video_end:x.videoEnd==null?null:Number(x.videoEnd),comment:x.comment||'',created_at:x.createdAt||null,updated_at:new Date().toISOString(),position:i+1}),'profile_id,plan_id,entry_id');
    if(sub==='decks')return this._syncById('study_decks',profileId,planId,'deck_id',oldA,newA,(x,i)=>Object.assign(base(),{deck_id:String(x.id),name:x.nome||'',created_at:x.createdAt||null,position:i+1}),'profile_id,plan_id,deck_id');
    if(sub==='cards')return this._syncById('study_cards',profileId,planId,'card_id',oldA,newA,(x,i)=>Object.assign(base(),{
      card_id:String(x.id),deck_id:x.deckId==null?null:String(x.deckId),subject:x.materia||null,topic:x.assunto||null,card_type:x.tipo||null,front:x.frente||'',back:x.verso||'',favorite:!!x.favorito,status:x.status||null,banca:x.banca||null,kind:x.kind||null,due:x.due==null?null:String(x.due),due_ts:x.dueTs==null?null:Number(x.dueTs),ease:x.ease==null?null:Number(x.ease),interval_value:x.intervalo==null?null:Number(x.intervalo),lapses:x.lapses==null?null:Number(x.lapses),learn_step:x.learnStep==null?null:Number(x.learnStep),reps:x.reps==null?null:Number(x.reps),phase:x.phase||null,reversed_of:x.reversedOf==null?null:String(x.reversedOf),d:x.d==null?null:Number(x.d),s:x.s==null?null:Number(x.s),algo:x.algo||null,last_review:x.lastReview||null,created_at:x.createdAt||null,updated_at:x.updatedAt||null,position:i+1,
      extra:Object.fromEntries(Object.entries(x).filter(([k])=>!['id','deckId','materia','assunto','tipo','frente','verso','favorito','status','banca','kind','due','dueTs','ease','intervalo','lapses','learnStep','reps','phase','reversedOf','d','s','algo','lastReview','createdAt','updatedAt'].includes(k)))
    }),'profile_id,plan_id,card_id');
    if(sub==='leis')return this._syncById('study_laws',profileId,planId,'law_id',oldA,newA,(x,i)=>Object.assign(base(),{law_id:String(x.id),title:x.titulo||null,reference:x.referencia||null,subject:x.materia||null,body:x.texto||'',bookmarked:x.bookmark==null?null:!!x.bookmark,bookmark_text:x.bookmarkTxt||null,created_at:x.createdAt||null,updated_at:x.updatedAt||null,options:x.opts||{},markings:x.marcacoes||[],suppressed:x.suppressed==null?null:x.suppressed,rotation:x.rodizio==null?null:x.rodizio,position:i+1,extra:{}}),'profile_id,plan_id,law_id');
    if(sub==='links')return this._syncById('study_links',profileId,planId,'link_id',oldA,newA,(x,i)=>Object.assign(base(),{link_id:String(x.id),name:x.nome||'',category:x.categoria||null,url:x.url||'',color:x.cor||null,logo:x.logo||null,created_at:x.createdAt||null,position:i+1}),'profile_id,plan_id,link_id');
    if(sub==='custom-siglas')return this._syncById('study_custom_siglas',profileId,planId,'sigla_id',oldA,newA,(x,i)=>Object.assign(base(),{sigla_id:String(x.id),name:x.nome||null,sigla:x.sigla||'',color:x.color||null,position:i+1}),'profile_id,plan_id,sigla_id');
    if(sub==='cycle-history')return this._syncById('study_cycle_history',profileId,planId,'cycle_id',oldA,newA,(x,i)=>Object.assign(base(),{cycle_id:String(x.id),start_date:x.startDate||null,end_date:x.endDate||null,closed_at:x.closedAt||null,sessions:x.sessions==null?null:Number(x.sessions),weekly_hours:x.weeklyHours==null?null:Number(x.weeklyHours),completed_subjects:x.finalizadas==null?null:Number(x.finalizadas),completion_pct:x.pctCumprido==null?null:Number(x.pctCumprido),total_subjects:x.totalSubjects==null?null:Number(x.totalSubjects),total_target_min:x.totalTargetMin==null?null:Number(x.totalTargetMin),total_studied_min:x.totalStudiedMin==null?null:Number(x.totalStudiedMin),avg_performance_pct:x.avgPerformancePct==null?null:Number(x.avgPerformancePct),avg_performance_legacy:x.avgPerformancePctLegado==null?null:Number(x.avgPerformancePctLegado),grade:x.grade||null,subjects:x.subjects||null,extra:{},position:i+1}),'profile_id,plan_id,cycle_id');
    if(sub==='saved-grades')return this._syncById('study_saved_grades',profileId,planId,'grade_id',oldA,newA,(x,i)=>Object.assign(base(),{grade_id:String(x.id),name:x.nome||'',sessions:x.sessions==null?null:Number(x.sessions),grade:x.grade||{},created_at:x.createdAt||null,position:i+1}),'profile_id,plan_id,grade_id');

    if(sub==='revlog'){
      const rows=newA.map((x,i)=>Object.assign(base(),{card_id:x.cardId==null?null:String(x.cardId),ts:x.ts==null?null:Number(x.ts),review_date:x.date||null,correct:x.acerto==null?null:!!x.acerto,grade:x.grade==null?null:Number(x.grade),elapsed:x.elapsed==null?null:Number(x.elapsed),phase:x.phase||null,interval_value:x.intervalo==null?null:Number(x.intervalo),d:x.d==null?null:Number(x.d),s:x.s==null?null:Number(x.s),position:i+1,extra:{}}));
      return this._replacePlanRows('study_review_log',profileId,planId,rows,'review_pk');
    }
    if(sub==='lei-keywords'){
      const rows=newA.map((x,i)=>Object.assign(base(),{term:x.t||'',category:x.cat||'',is_default:!!x.def,position:i+1})).filter(x=>x.term);
      return this._replacePlanRows('study_law_keywords',profileId,planId,rows,'profile_id,plan_id,term,category');
    }
    if(sub==='extras'){
      const rows=newA.map((x,i)=>Object.assign(base(),{extra_id:String(x.id),title:x.titulo||null,type:x.tipo||null,unit:x.unidade||null,marker:x.marcador||null,discipline:x.disciplina||null,target:x.alvo==null?null:Number(x.alvo),progress:x.progresso==null?null:Number(x.progresso),status:x.status||null,period:x.periodo||null,start_date:x.dataInicio||null,end_date:x.dataFim||null,counts_metrics:x.contaMetricas==null?null:!!x.contaMetricas,created_at:x.createdAt||null,updated_at:x.updatedAt||null,completed_dates:x.concluidasEm||[],dates:x.datas||[],history:x.historico||[],provenance:{origemPlano:x.origemPlano,reforcoFila:x.reforcoFila,origemLacunaGlobal:x.origemLacunaGlobal,origemLei:x.origemLei},extra:{},position:i+1}));
      return this._replacePlanRows('study_extras',profileId,planId,rows,'profile_id,plan_id,extra_id');
    }
    if(sub==='tracks'){
      const obj=this._obj(newRaw),rows=[];
      Object.keys(obj).forEach(subject=>(obj[subject]||[]).forEach((x,i)=>rows.push(Object.assign(base(),{subject_name:subject,item_id:String(x.id),item_type:x.type||'aula',label:x.label||null,item_text:x.text||null,status_id:x.status||null,r1_total:x.r1&&x.r1.total!=null?Number(x.r1.total):null,r1_correct:x.r1&&x.r1.acertos!=null?Number(x.r1.acertos):null,rcheck_total:x.rCheck&&x.rCheck.total!=null?Number(x.rCheck.total):null,rcheck_correct:x.rCheck&&x.rCheck.acertos!=null?Number(x.rCheck.acertos):null,rrev_total:x.rRev&&x.rRev.total!=null?Number(x.rRev.total):null,rrev_correct:x.rRev&&x.rRev.acertos!=null?Number(x.rRev.acertos):null,summary:x.resumo||null,position:i+1,extra:{}}))));
      return this._replacePlanRows('study_track_items',profileId,planId,rows,'profile_id,plan_id,subject_name,item_id');
    }
    if(sub==='incidencia'){
      const rows=newA.map((x,i)=>Object.assign(base(),{incidence_id:String(x.id||''),pct:x.pct==null?null:Number(x.pct),banca:x.banca||null,depth:x.depth==null?null:Number(x.depth),code:x.codigo||null,topic:x.topico||null,discipline:x.disciplina||null,incidence:x.incidencia==null?null:Number(x.incidencia),position:i+1,row_no:i+1,extra:{}}));
      return this._replacePlanRows('study_incidence',profileId,planId,rows,'profile_id,plan_id,row_no');
    }
    if(sub==='tec'){
      const snaps=newA.map((x,i)=>Object.assign(base(),{snapshot_id:String(x.id),snapshot_date:x.date||null,start_date:x.startDate||null,end_date:x.endDate||null,imported_at:x.importedAt||null,label:x.label||null,bancas:x.bancas==null?null:x.bancas,position:i+1,extra:{}}));
      const rows=[];newA.forEach(x=>(x.rows||[]).forEach((r,i)=>rows.push(Object.assign(base(),{snapshot_id:String(x.id),row_no:i+1,name:r.nome||'',weight:r.peso==null?null:Number(r.peso),depth:r.depth==null?null:Number(r.depth),code:r.codigo||null,correct:r.acertos==null?null:Number(r.acertos),questions:r.questoes==null?null:Number(r.questoes),accuracy_pct:r.pctAcerto==null?null:Number(r.pctAcerto),discipline:r.disciplina||null,extra:{}}))));
      const {error}=await CloudStore.client.rpc('replace_study_tec',{
        p_profile_id:profileId,p_plan_id:planId,p_snapshots:snaps,p_rows:rows
      });
      if(error)throw error;
      return;
    }
    return this._persistPlanState(profileId,planId,sub,newRaw);
  },


  /* Aplica um backup JSON ao modelo relacional. O arquivo continua no formato
     histórico do app, mas a persistência final é linha-a-linha no PostgreSQL.
     Em restore=true, a projeção atual do perfil é substituída; a operação é
     segura porque CloudBackup cria uma foto anterior antes de chamar este fluxo. */
  async replaceProfileFromPayload(profileId, dataObj, opts) {
    opts = opts || {};
    if (!this.isReady()) throw new Error('Banco indisponível');
    if (!profileId) throw new Error('Perfil ausente');
    const data = (dataObj && typeof dataObj === 'object') ? dataObj : {};
    const pfx = this._pfx(profileId);

    /* O backup pode ser antigo e não conter "planejamentos". Inferimos os ids
       das chaves p:<id>:... para nunca perder conteúdo importável. */
    let plans = [];
    try { plans = JSON.parse(data.planejamentos || '[]') || []; } catch (_) { plans = []; }
    const vistos = new Set(plans.map(p => String(p && p.id)).filter(Boolean));
    Object.keys(data).forEach(k => {
      const m = /^p:([^:]+):/.exec(k);
      if (!m || vistos.has(m[1])) return;
      vistos.add(m[1]);
      plans.push({ id: m[1], nome: m[1], tipo: 'Importado', createdAt: new Date().toISOString() });
    });
    if (!plans.length) plans = [{ id:'pl_inicial', nome:'Planejamento inicial', tipo:'Importado', createdAt:new Date().toISOString() }];

    /* Primeiro limpa SOMENTE a nova base relacional do perfil. O snapshot legado
       e os backups ficam intocados. FK CASCADE remove entidades dependentes. */
    const delPlans = await CloudStore.client.from('study_plans').delete().eq('profile_id', profileId);
    if (delPlans.error) throw delPlans.error;
    const delSettings = await CloudStore.client.from('study_profile_settings').delete().eq('profile_id', profileId);
    if (delSettings.error) throw delSettings.error;

    this._clearProfileMemory(profileId);
    this._applying = true;
    try {
      localStorage.setItem(pfx+'planejamentos', JSON.stringify(plans));
      const activeRaw = data['active-plan'];
      const active = activeRaw == null
        ? String(plans[0].id)
        : String(this._parse(activeRaw, activeRaw)).replace(/^"|"$/g,'');
      localStorage.setItem(pfx+'active-plan', active || String(plans[0].id));
      Object.keys(data).forEach(sub => {
        if (sub === 'planejamentos' || sub === 'active-plan') return;
        if (sub.startsWith('u:') || this._ignoreSub(sub)) return;
        localStorage.setItem(pfx+sub, String(data[sub]));
      });
    } finally { this._applying = false; }

    /* Ordem deliberada: planos -> ponteiro ativo -> settings -> conteúdo de
       cada plano. Assim as FKs sempre encontram o pai antes dos filhos. */
    await this._persistPlans(profileId, null, JSON.stringify(plans));
    await this._persistActivePlan(profileId, localStorage.getItem(pfx+'active-plan'));

    const planKeys = [], profileKeys = [];
    for (let i=0;i<localStorage.length;i++) {
      const k=localStorage.key(i);
      if (!k || !k.startsWith(pfx)) continue;
      const rel=k.slice(pfx.length);
      if (rel==='planejamentos'||rel==='active-plan'||this._ignoreSub(rel)) continue;
      const m=/^p:([^:]+):(.+)$/.exec(rel);
      if (m) planKeys.push({key:k,planId:m[1],sub:m[2]});
      else profileKeys.push({key:k,sub:rel});
    }
    for (const x of profileKeys) await this._persistProfileSetting(profileId,x.sub,localStorage.getItem(x.key));
    for (const x of planKeys) await this._persistPlanKey(profileId,x.planId,x.sub,null,localStorage.getItem(x.key));

    await this.hydrateProfile(profileId,{reason:opts.reason||'backup-restore'});
    return { ok:true, secoes:Object.keys(data).length, planos:plans.length };
  },

  async _refreshDomains(profileId, tables, reason, truncated) {
    const set=new Set((tables||[]).filter(Boolean));
    const heavyNames=new Set(['study_tec_snapshots','study_tec_snapshot_rows','study_incidence']);
    let heavy=!!truncated, core=!!truncated;
    set.forEach(t=>{if(heavyNames.has(t))heavy=true;else core=true;});
    if(core)await this.hydrateProfile(profileId,{reason:reason||'catch-up-core',includeHeavy:false,preserveHeavy:true,skipWatermark:true});
    if(heavy){
      this._heavyDirty.add(profileId);
      if(this._heavyReady.has(profileId))await this.ensureHeavyData(profileId,{reason:reason||'catch-up-heavy',force:true});
    }
    return {core,heavy};
  },

  async catchUp(profileId, reason) {
    const id=profileId||(window.ProfileManager&&ProfileManager.getActiveProfileId&&ProfileManager.getActiveProfileId());
    if(!id||!this.isReady())return false;
    try{await this.flush();}catch(e){_quiet(e,'rel-catchup-flush');}
    if(!this._lastChangeId.has(id)){
      return this.hydrateProfile(id,{reason:reason||'catch-up-bootstrap',includeHeavy:false});
    }
    const after=Number(this._lastChangeId.get(id))||0;
    const summary=await this._changeSummary(id,after);
    if(!summary.count&&!summary.truncated){
      this._lastSyncAt=Date.now();
      return {ok:true,mudou:0,changeId:after};
    }
    await this._refreshDomains(id,summary.tables,reason||'catch-up',summary.truncated);
    this._lastChangeId.set(id,Math.max(after,Number(summary.maxChangeId)||after));
    this._lastSyncAt=Date.now();this._lastError=null;
    return {ok:true,mudou:summary.count||1,changeId:this._lastChangeId.get(id),tables:summary.tables};
  },

  subscribeProfile(profileId) {
    if(!this.isReady()||!profileId)return;
    if(this._channelProfile===profileId&&this._channel)return;
    try{if(this._channel)CloudStore.client.removeChannel(this._channel);}catch(e){_quiet(e,'rel-subscribe-remove-channel');}
    clearTimeout(this._resubTimer);
    this._channelProfile=profileId;
    const ch=CloudStore.client.channel('study-relational-'+profileId+'-'+Date.now())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'study_change_log',filter:'profile_id=eq.'+profileId},()=>{
        clearTimeout(this._rtTimer);
        this._rtTimer=setTimeout(()=>this.catchUp(profileId,'realtime').catch(e=>{this._lastError=e;}),180);
      })
      .subscribe(status=>{
        if(status==='SUBSCRIBED'){
          clearTimeout(this._resubTimer);this._resubTimer=null;
          /* A assinatura não rebaixa o perfil inteiro. O change-log responde
             se algo mudou na pequena janela entre o watermark e o WebSocket. */
          this.catchUp(profileId,'realtime-subscribed').catch(e=>{this._lastError=e;});
          return;
        }
        if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
          if(this._channel===ch)this._channel=null;
          clearTimeout(this._resubTimer);
          this._resubTimer=setTimeout(()=>this.subscribeProfile(profileId),1200);
        }
      });
    this._channel=ch;
  },
  unsubscribe() {
    clearTimeout(this._rtTimer);clearTimeout(this._resubTimer);
    this._heavyTimers.forEach(t=>clearTimeout(t));this._heavyTimers.clear();
    try{if(this._channel&&window.CloudStore&&CloudStore.client)CloudStore.client.removeChannel(this._channel);}catch(e){_quiet(e,'rel-unsubscribe-remove-channel');}
    this._channel=null;this._channelProfile=null;
  }

};
window.RelationalStore=RelationalStore;
