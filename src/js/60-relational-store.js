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
  _clearProfileMemory(profileId) {
    const p = this._pfx(profileId), keys=[];
    this._applying = true;
    try {
      for (let i=0;i<localStorage.length;i++) {
        const k=localStorage.key(i); if(k && k.indexOf(p)===0) keys.push(k);
      }
      keys.forEach(k=>localStorage.removeItem(k));
    } finally { this._applying=false; }
  },
  _group(rows, key='plan_id') {
    const m=new Map();
    (rows||[]).forEach(r=>{ const k=r[key]; if(!m.has(k))m.set(k,[]); m.get(k).push(r); });
    return m;
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

  async hydrateProfile(profileId, opts) {
    if (!this.isReady()) throw new Error('Banco indisponível');
    const profileQ = CloudStore.client.from('study_profiles')
      .select('id,profile_name,avatar,color,pin_hash,active_plan_id,created_at,updated_at')
      .eq('id', profileId).maybeSingle();

    const specs = [
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
      ['tracks','study_track_items',[{col:'plan_id'},{col:'subject_name'},{col:'position'}]],
      ['tecSnapshots','study_tec_snapshots',[{col:'plan_id'},{col:'position'}]],
      ['tecRows','study_tec_snapshot_rows',[{col:'plan_id'},{col:'snapshot_id'},{col:'row_no'}]],
      ['incidence','study_incidence',[{col:'plan_id'},{col:'row_no'}]]
    ];
    const [profileRes, ...loaded] = await Promise.all([
      profileQ,
      ...specs.map(s=>this._all(s[1],profileId,s[2]))
    ]);
    if (profileRes.error) throw profileRes.error;
    if (!profileRes.data) { const e=new Error('Perfil não encontrado na nuvem'); e.code='perfil-inexistente'; throw e; }
    const d={}; specs.forEach((s,i)=>d[s[0]]=loaded[i]);

    this._clearProfileMemory(profileId);
    const pfx=this._pfx(profileId);
    const visiblePlans=(d.plans||[]).filter(p=>!p.hidden);
    this._memSet(pfx+'planejamentos', JSON.stringify(visiblePlans.map(p=>({
      id:p.plan_id,nome:p.name,tipo:p.plan_type||'',createdAt:p.created_at
    }))));
    let active=profileRes.data.active_plan_id;
    if (!active || !visiblePlans.some(p=>p.plan_id===active)) active=visiblePlans[0] && visiblePlans[0].plan_id;
    if (active) this._memSet(pfx+'active-plan', active);

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
      id:this._legacyId(r.card_id),deckId:r.deck_id||null,materia:r.subject||null,topico:r.topic||null,tipo:r.card_type||null,
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

    this._lastSyncAt=Date.now(); this._lastError=null;
    this.subscribeProfile(profileId);
    try { window.dispatchEvent(new CustomEvent('data:relational-hydrated',{detail:{profileId,reason:(opts&&opts.reason)||'open'}})); } catch(_){}
    return {ok:true,mudou:1,profile:profileRes.data};
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
      try { if(window.CloudUI)CloudUI.refreshSyncBtn(); } catch(_){}
    });
    try { if(window.CloudUI)CloudUI.refreshSyncBtn('syncing','Salvando no banco…'); } catch(_){}
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
    return sub==='__secrev'||sub==='__secpend'||sub==='__secdel'||sub==='__entryops'||
      sub.indexOf('__entrycloudops')===0||sub.indexOf('vhist')===0||sub.indexOf('__lixeira:')===0;
  },
  onStorageMutation(key, oldRaw, newRaw) {
    if(this._applying || !this.enabled) return;
    const p=this._keyParts(key); if(!p) return;
    if(p.scope==='user') {
      if(p.sub==='profiles'||p.sub==='active-profile'||p.sub.indexOf('rev:')===0||p.sub.indexOf('owner:')===0||
         p.sub.indexOf('migrado-uuid:')===0||p.sub==='legacy-consumed') return;
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
    const oldIds=new Set(oldArr.filter(x=>x&&x.id!=null).map(x=>String(x.id)));
    const newIds=new Set(newArr.filter(x=>x&&x.id!=null).map(x=>String(x.id)));
    const removed=[...oldIds].filter(x=>!newIds.has(x));
    for(const ch of this._chunks(removed,300)){
      let q=CloudStore.client.from(table).delete().eq('profile_id',profileId).eq('plan_id',planId).in(idCol,ch);
      const {error}=await q;if(error)throw error;
    }
    const rows=newArr.map((x,i)=>map(x,i)).filter(Boolean);
    if(rows.length)await this._upsertChunks(table,rows,onConflict);
  },
  async _replacePlanRows(table,profileId,planId,rows,onConflict){
    const del=await CloudStore.client.from(table).delete().eq('profile_id',profileId).eq('plan_id',planId); if(del.error)throw del.error;
    if(rows.length)await this._upsertChunks(table,rows,onConflict);
  },
  _arr(raw){const v=this._parse(raw,[]);return Array.isArray(v)?v:[];},
  _obj(raw){const v=this._parse(raw,{});return v&&typeof v==='object'&&!Array.isArray(v)?v:{};},

  async _persistPlans(profileId,oldRaw,newRaw){
    const oldA=this._arr(oldRaw),newA=this._arr(newRaw);
    const oldIds=new Set(oldA.map(x=>String(x.id))), newIds=new Set(newA.map(x=>String(x.id)));
    for(const id of [...oldIds].filter(x=>!newIds.has(x))){
      const {error}=await CloudStore.client.from('study_plans').delete().eq('profile_id',profileId).eq('plan_id',id).eq('legacy_orphan',false);
      if(error)throw error;
    }
    const rows=newA.map((p,i)=>({profile_id:profileId,plan_id:String(p.id),name:p.nome||String(p.id),plan_type:p.tipo||null,created_at:p.createdAt||new Date().toISOString(),position:i+1,hidden:false,legacy_orphan:false}));
    if(rows.length)await this._upsertChunks('study_plans',rows,'profile_id,plan_id');
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
      card_id:String(x.id),deck_id:x.deckId==null?null:String(x.deckId),subject:x.materia||null,topic:x.topico||null,card_type:x.tipo||null,front:x.frente||'',back:x.verso||'',favorite:!!x.favorito,status:x.status||null,banca:x.banca||null,kind:x.kind||null,due:x.due==null?null:String(x.due),due_ts:x.dueTs==null?null:Number(x.dueTs),ease:x.ease==null?null:Number(x.ease),interval_value:x.intervalo==null?null:Number(x.intervalo),lapses:x.lapses==null?null:Number(x.lapses),learn_step:x.learnStep==null?null:Number(x.learnStep),reps:x.reps==null?null:Number(x.reps),phase:x.phase||null,reversed_of:x.reversedOf==null?null:String(x.reversedOf),d:x.d==null?null:Number(x.d),s:x.s==null?null:Number(x.s),algo:x.algo||null,last_review:x.lastReview||null,created_at:x.createdAt||null,updated_at:x.updatedAt||null,position:i+1,
      extra:Object.fromEntries(Object.entries(x).filter(([k])=>!['id','deckId','materia','topico','tipo','frente','verso','favorito','status','banca','kind','due','dueTs','ease','intervalo','lapses','learnStep','reps','phase','reversedOf','d','s','algo','lastReview','createdAt','updatedAt'].includes(k)))
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
      const del=await CloudStore.client.from('study_tec_snapshots').delete().eq('profile_id',profileId).eq('plan_id',planId);if(del.error)throw del.error;
      if(snaps.length)await this._upsertChunks('study_tec_snapshots',snaps,'profile_id,plan_id,snapshot_id');
      const rows=[];newA.forEach(x=>(x.rows||[]).forEach((r,i)=>rows.push(Object.assign(base(),{snapshot_id:String(x.id),row_no:i+1,name:r.nome||'',weight:r.peso==null?null:Number(r.peso),depth:r.depth==null?null:Number(r.depth),code:r.codigo||null,correct:r.acertos==null?null:Number(r.acertos),questions:r.questoes==null?null:Number(r.questoes),accuracy_pct:r.pctAcerto==null?null:Number(r.pctAcerto),discipline:r.disciplina||null,extra:{}}))));
      if(rows.length)await this._upsertChunks('study_tec_snapshot_rows',rows,'profile_id,plan_id,snapshot_id,row_no');
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

  async catchUp(profileId, reason) {
    const id=profileId||(window.ProfileManager&&ProfileManager.getActiveProfileId&&ProfileManager.getActiveProfileId());
    if(!id||!this.isReady())return false;
    try{await this.flush();}catch(_){}
    return this.hydrateProfile(id,{reason:reason||'catch-up'});
  },

  subscribeProfile(profileId) {
    if(!this.isReady()||!profileId)return;
    if(this._channelProfile===profileId&&this._channel)return;
    try{if(this._channel)CloudStore.client.removeChannel(this._channel);}catch(_){}
    clearTimeout(this._resubTimer);
    this._channelProfile=profileId;
    const ch=CloudStore.client.channel('study-relational-'+profileId+'-'+Date.now())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'study_change_log',filter:'profile_id=eq.'+profileId},()=>{
        clearTimeout(this._rtTimer);
        this._rtTimer=setTimeout(()=>this.catchUp(profileId,'realtime'),180);
      })
      .subscribe(status=>{
        if(status==='SUBSCRIBED'){
          /* Fecha a janela SELECT→WebSocket: qualquer commit ocorrido entre a
             hidratação e a assinatura é recuperado por uma consulta canônica. */
          clearTimeout(this._resubTimer);
          this._resubTimer=null;
          this.catchUp(profileId,'realtime-subscribed').catch(e=>{ this._lastError=e; });
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
    try{if(this._channel&&window.CloudStore&&CloudStore.client)CloudStore.client.removeChannel(this._channel);}catch(_){}
    this._channel=null;this._channelProfile=null;
  }
};
window.RelationalStore=RelationalStore;
