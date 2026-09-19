/* Escrita relacional. Nenhum dado do perfil depende de persistência local. */
Object.assign(RelationalStore,{
  _activePlanId(){try{return(window.PlanManager&&PlanManager.getActivePlanId&&PlanManager.getActivePlanId())||'pl_inicial';}catch(_){return'pl_inicial';}},
  _entryRow(e,plan,pos){
    return{profile_id:this._profileId,plan_id:plan,entry_id:String(e.id),study_date:e.date,subject:e.subject||'',lesson:e.lesson||'',method:e.method||'',
      duration_min:Number(e.durationMin||0),correct:Number(e.correct||0),total:Number(e.total||0),
      page_start:e.pageStart==null?null:Number(e.pageStart),page_end:e.pageEnd==null?null:Number(e.pageEnd),
      video_start:e.videoStart==null?null:Number(e.videoStart),video_end:e.videoEnd==null?null:Number(e.videoEnd),comment:e.comment||'',
      created_at:e.createdAt||new Date().toISOString(),updated_at:new Date().toISOString(),position:pos==null?0:Number(pos)};
  },
  _mutateEntryMemory(plan,fn){
    const key=this._prefix(this._profileId)+'p:'+plan+':entries';let arr=[];
    try{arr=JSON.parse(localStorage.getItem(key)||'[]')||[];}catch(_){arr=[];}
    localStorage.setItem(key,JSON.stringify(fn(arr)||arr));
  },
  async insertEntry(entry){
    const plan=this._activePlanId(),pos=(window.DB&&DB.getEntries?DB.getEntries().length:0),row=this._entryRow(entry,plan,pos);
    const {error}=await this._client().from('study_entries').insert(row);if(error)throw error;
    this._mutateEntryMemory(plan,a=>{a.push(entry);return a;});this._lastSyncAt=Date.now();this._lastError=null;return entry;
  },
  async updateEntry(id,patch){
    const plan=this._activePlanId(),cur=(window.DB&&DB.getEntry)?DB.getEntry(id):null;if(!cur)return null;
    const next=Object.assign({},cur,patch||{}),row=this._entryRow(next,plan);delete row.created_at;delete row.position;delete row.profile_id;delete row.plan_id;delete row.entry_id;
    const {error}=await this._client().from('study_entries').update(row).eq('profile_id',this._profileId).eq('plan_id',plan).eq('entry_id',String(id));if(error)throw error;
    this._mutateEntryMemory(plan,a=>a.map(e=>String(e.id)===String(id)?next:e));this._lastSyncAt=Date.now();this._lastError=null;return next;
  },
  async deleteEntry(id){
    const plan=this._activePlanId();
    const {error}=await this._client().from('study_entries').delete().eq('profile_id',this._profileId).eq('plan_id',plan).eq('entry_id',String(id));if(error)throw error;
    this._mutateEntryMemory(plan,a=>a.filter(e=>String(e.id)!==String(id)));this._lastSyncAt=Date.now();this._lastError=null;return true;
  },
  queueKey(fullKey,deleted){
    if(!this.isActive()||this._applying||!fullKey||!this._profileId||!String(fullKey).startsWith(this._prefix(this._profileId)))return;
    this._pendingKeys.set(String(fullKey),!!deleted);clearTimeout(this._queueTimer);this._queueTimer=setTimeout(()=>this.flushPending().catch(()=>{}),150);
    if(window.CloudUI)CloudUI.refreshSyncBtn();
  },
  pendingCount(){return this._pendingKeys.size+(this._syncing?1:0);},
  async flushPending(){
    if(!this.isActive()||!this._pendingKeys.size)return true;if(this._flushPromise)return this._flushPromise;
    this._flushPromise=(async()=>{this._syncing=true;this._lastError=null;
      try{while(this._pendingKeys.size){const batch=Array.from(this._pendingKeys.entries());this._pendingKeys.clear();for(const[key,del]of batch)await this.persistKey(key,del);}this._lastSyncAt=Date.now();return true;}
      catch(e){this._lastError=e;console.error('[RelationalStore] persist',e);if(window.CloudUI)CloudUI.setStatus('error','Falha ao gravar no banco');throw e;}
      finally{this._syncing=false;this._flushPromise=null;if(window.CloudUI)CloudUI.refreshSyncBtn();}
    })();return this._flushPromise;
  },
  _decodeKey(k){const p=this._prefix(this._profileId);if(!String(k).startsWith(p))return null;const sub=String(k).slice(p.length),m=sub.match(/^p:([^:]+):(.+)$/);return m?{sub,planId:m[1],kind:m[2]}:{sub,planId:null,kind:sub};},
  _parseRaw(raw){if(raw==null)return null;try{return JSON.parse(raw);}catch(_){return raw;}},
  _rows(raw){const v=this._parseRaw(raw);return Array.isArray(v)?v:[];},
  _unknown(x,known){const o={};Object.keys(x||{}).forEach(k=>{if(!known.has(k)&&x[k]!==undefined)o[k]=x[k];});return o;},
  async _deletePlanRows(table,plan){const{error}=await this._client().from(table).delete().eq('profile_id',this._profileId).eq('plan_id',plan);if(error)throw error;},
  async _replaceById(table,plan,idCol,rows){
    const c=this._client(),{data:old,error:er}=await c.from(table).select(idCol).eq('profile_id',this._profileId).eq('plan_id',plan);if(er)throw er;
    if(rows.length){const{error}=await c.from(table).upsert(rows);if(error)throw error;}
    const keep=new Set(rows.map(r=>String(r[idCol]))),missing=(old||[]).map(r=>r[idCol]).filter(x=>!keep.has(String(x)));
    if(missing.length){const{error}=await c.from(table).delete().eq('profile_id',this._profileId).eq('plan_id',plan).in(idCol,missing);if(error)throw error;}
    return true;
  },
  async _replaceAll(table,plan,rows){
    await this._deletePlanRows(table,plan);for(let i=0;i<rows.length;i+=500){const{error}=await this._client().from(table).insert(rows.slice(i,i+500));if(error)throw error;}return true;
  },
  async persistKey(fullKey,deleted){
    const d=this._decodeKey(fullKey);if(!d)return true;
    const raw=deleted?null:localStorage.getItem(fullKey),val=this._parseRaw(raw),c=this._client(),pid=this._profileId,now=new Date().toISOString();
    if(d.sub==='planejamentos'){
      const arr=Array.isArray(val)?val:[],rows=arr.map((x,i)=>({profile_id:pid,plan_id:String(x.id),name:x.nome||String(x.id),plan_type:x.tipo||null,created_at:x.createdAt||now,position:i,hidden:false,legacy_orphan:false}));
      const{data:old,error:er}=await c.from('study_plans').select('plan_id').eq('profile_id',pid);if(er)throw er;if(rows.length){const{error}=await c.from('study_plans').upsert(rows);if(error)throw error;}
      const keep=new Set(rows.map(r=>r.plan_id)),missing=(old||[]).map(r=>r.plan_id).filter(x=>!keep.has(String(x)));if(missing.length){const{error}=await c.from('study_plans').delete().eq('profile_id',pid).in('plan_id',missing);if(error)throw error;}return true;
    }
    if(d.sub==='active-plan'){const{error}=await c.from('study_profiles').update({active_plan_id:raw||null,updated_at:now}).eq('id',pid);if(error)throw error;return true;}
    if(!d.planId){
      if(deleted){const{error}=await c.from('study_profile_settings').delete().eq('profile_id',pid).eq('key',d.kind);if(error)throw error;}
      else{const{error}=await c.from('study_profile_settings').upsert({profile_id:pid,key:d.kind,value:val,updated_at:now});if(error)throw error;}return true;
    }
    const plan=d.planId,arr=this._rows(raw);
    if(deleted){
      const map={subjects:'study_subjects',methods:'study_methods',phases:'study_phases',modes:'study_modes',statuses:'study_statuses',entries:'study_entries',links:'study_links','custom-siglas':'study_custom_siglas',cards:'study_cards',revlog:'study_review_log',leis:'study_laws','lei-keywords':'study_law_keywords',extras:'study_extras','saved-grades':'study_saved_grades',tracks:'study_track_items','cycle-history':'study_cycle_history',tec:'study_tec_snapshots',incidencia:'study_incidence'};
      if(map[d.kind])return this._deletePlanRows(map[d.kind],plan);
      const{error}=await c.from('study_plan_state').delete().eq('profile_id',pid).eq('plan_id',plan).eq('key',d.kind);if(error)throw error;return true;
    }
    switch(d.kind){
      case'entries':return this._replaceById('study_entries',plan,'entry_id',arr.map((x,i)=>this._entryRow(x,plan,i)));
      case'subjects':return this._replaceById('study_subjects',plan,'subject_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,subject_id:String(x.id),name:x.nome||'',phase:x.fase||null,difficulty:x.dificuldade==null?null:Number(x.dificuldade),active:x.ativo!==false,mode:x.modo||null,position:i})));
      case'methods':return this._replaceById('study_methods',plan,'method_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,method_id:String(x.id),name:x.nome||'',active:x.ativo!==false,position:i})));
      case'phases':return this._replaceById('study_phases',plan,'phase_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,phase_id:String(x.id),name:x.nome||'',active:x.ativo!==false,position:i})));
      case'modes':return this._replaceById('study_modes',plan,'mode_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,mode_id:String(x.id),name:x.nome||'',active:x.ativo!==false,position:i})));
      case'statuses':return this._replaceById('study_statuses',plan,'status_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,status_id:String(x.id),name:x.nome||'',color:x.color||null,background:x.bg||null,done:!!x.done,active:x.ativo!==false,position:i})));
      case'links':return this._replaceById('study_links',plan,'link_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,link_id:String(x.id),name:x.nome||'',category:x.categoria||null,url:x.url||'',color:x.cor||null,logo:x.logo||null,created_at:x.createdAt||null,position:i})));
      case'custom-siglas':return this._replaceById('study_custom_siglas',plan,'sigla_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,sigla_id:String(x.id),name:x.nome||null,sigla:x.sigla||'',color:x.color||null,position:i})));
      case'cards':{
        const known=new Set(['id','deckId','materia','topico','tipo','frente','verso','favorito','status','banca','kind','due','dueTs','ease','intervalo','lapses','learnStep','reps','phase','reversedOf','d','s','algo','lastReview','createdAt','updatedAt']);
        return this._replaceById('study_cards',plan,'card_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,card_id:String(x.id),deck_id:x.deckId||null,subject:x.materia||null,topic:x.topico||null,card_type:x.tipo||null,front:x.frente||'',back:x.verso||'',favorite:!!x.favorito,status:x.status||null,banca:x.banca||null,kind:x.kind||null,due:x.due||null,due_ts:x.dueTs==null?null:Number(x.dueTs),ease:x.ease==null?null:Number(x.ease),interval_value:x.intervalo==null?null:Number(x.intervalo),lapses:x.lapses==null?0:Number(x.lapses),learn_step:x.learnStep==null?null:Number(x.learnStep),reps:x.reps==null?0:Number(x.reps),phase:x.phase||null,reversed_of:x.reversedOf||null,d:x.d==null?null:Number(x.d),s:x.s==null?null:Number(x.s),algo:x.algo||null,last_review:x.lastReview||null,created_at:x.createdAt||null,updated_at:x.updatedAt||now,position:i,extra:this._unknown(x,known)})));
      }
      case'revlog':{
        const known=new Set(['cardId','ts','date','acerto','grade','elapsed','phase','intervalo','d','s']);
        return this._replaceAll('study_review_log',plan,arr.map((x,i)=>({profile_id:pid,plan_id:plan,card_id:x.cardId==null?null:String(x.cardId),ts:x.ts==null?null:Number(x.ts),review_date:x.date||null,correct:x.acerto==null?null:!!x.acerto,grade:x.grade==null?null:Number(x.grade),elapsed:x.elapsed==null?null:Number(x.elapsed),phase:x.phase||null,interval_value:x.intervalo==null?null:Number(x.intervalo),d:x.d==null?null:Number(x.d),s:x.s==null?null:Number(x.s),position:i,extra:this._unknown(x,known)})));
      }
      case'leis':{
        const known=new Set(['id','titulo','referencia','materia','texto','bookmark','bookmarkTxt','createdAt','updatedAt','opts','marcacoes','suppressed','rodizio']);
        return this._replaceById('study_laws',plan,'law_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,law_id:String(x.id),title:x.titulo||null,reference:x.referencia||null,subject:x.materia||null,body:x.texto||null,bookmarked:x.bookmark==null?null:!!x.bookmark,bookmark_text:x.bookmarkTxt||null,created_at:x.createdAt||null,updated_at:x.updatedAt||now,options:x.opts||{},markings:x.marcacoes||[],suppressed:x.suppressed||null,rotation:x.rodizio||null,position:i,extra:this._unknown(x,known)})));
      }
      case'lei-keywords':return this._replaceAll('study_law_keywords',plan,arr.map((x,i)=>({profile_id:pid,plan_id:plan,term:x.t||'',category:x.cat||'',is_default:!!x.def,position:i})));
      case'extras':{
        const prov=new Set(['origemPlano','reforcoFila','origemLacunaGlobal','origemLei']),known=new Set(['id','titulo','tipo','unidade','marcador','disciplina','alvo','progresso','status','periodo','dataInicio','dataFim','contaMetricas','createdAt','updatedAt','concluidasEm','datas','historico',...prov]);
        return this._replaceById('study_extras',plan,'extra_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,extra_id:String(x.id),title:x.titulo||null,type:x.tipo||null,unit:x.unidade||null,marker:x.marcador||null,discipline:x.disciplina||null,target:x.alvo==null?null:Number(x.alvo),progress:x.progresso==null?null:Number(x.progresso),status:x.status||null,period:x.periodo||null,start_date:x.dataInicio||null,end_date:x.dataFim||null,counts_metrics:x.contaMetricas==null?null:!!x.contaMetricas,created_at:x.createdAt||null,updated_at:x.updatedAt||now,completed_dates:x.concluidasEm||[],dates:x.datas||[],history:x.historico||[],provenance:{origemPlano:x.origemPlano,reforcoFila:x.reforcoFila,origemLacunaGlobal:x.origemLacunaGlobal,origemLei:x.origemLei},extra:this._unknown(x,known),position:i})));
      }
      case'saved-grades':return this._replaceById('study_saved_grades',plan,'grade_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,grade_id:String(x.id),name:x.nome||'',sessions:x.sessions==null?null:Number(x.sessions),grade:x.grade||{},created_at:x.createdAt||null,position:i})));
      case'cycle-history':{
        const known=new Set(['id','startDate','endDate','closedAt','sessions','weeklyHours','finalizadas','pctCumprido','totalSubjects','totalTargetMin','totalStudiedMin','avgPerformancePct','avgPerformance','grade','subjects']);
        return this._replaceById('study_cycle_history',plan,'cycle_id',arr.map((x,i)=>({profile_id:pid,plan_id:plan,cycle_id:String(x.id),start_date:x.startDate||null,end_date:x.endDate||null,closed_at:x.closedAt||null,sessions:x.sessions==null?null:Number(x.sessions),weekly_hours:x.weeklyHours==null?null:Number(x.weeklyHours),completed_subjects:x.finalizadas==null?null:Number(x.finalizadas),completion_pct:x.pctCumprido==null?null:Number(x.pctCumprido),total_subjects:x.totalSubjects==null?null:Number(x.totalSubjects),total_target_min:x.totalTargetMin==null?null:Number(x.totalTargetMin),total_studied_min:x.totalStudiedMin==null?null:Number(x.totalStudiedMin),avg_performance_pct:x.avgPerformancePct==null?null:Number(x.avgPerformancePct),avg_performance_legacy:x.avgPerformance==null?null:Number(x.avgPerformance),grade:x.grade||{},subjects:x.subjects||[],extra:this._unknown(x,known),position:i})));
      }
      case'tracks':{
        const obj=val&&typeof val==='object'&&!Array.isArray(val)?val:{},rows=[];
        Object.keys(obj).forEach(subject=>(obj[subject]||[]).forEach((x,i)=>{const known=new Set(['id','type','label','text','status','r1','rCheck','rRev','resumo']);rows.push({profile_id:pid,plan_id:plan,subject_name:subject,item_id:String(x.id),item_type:x.type||'',label:x.label||null,item_text:x.text||null,status_id:x.status||null,r1_total:x.r1&&x.r1.total!=null?Number(x.r1.total):null,r1_correct:x.r1&&x.r1.acertos!=null?Number(x.r1.acertos):null,rcheck_total:x.rCheck&&x.rCheck.total!=null?Number(x.rCheck.total):null,rcheck_correct:x.rCheck&&x.rCheck.acertos!=null?Number(x.rCheck.acertos):null,rrev_total:x.rRev&&x.rRev.total!=null?Number(x.rRev.total):null,rrev_correct:x.rRev&&x.rRev.acertos!=null?Number(x.rRev.acertos):null,summary:x.resumo==null?null:String(x.resumo),position:i,extra:this._unknown(x,known)});}));return this._replaceAll('study_track_items',plan,rows);
      }
      case'incidencia':{
        const known=new Set(['id','pct','banca','depth','codigo','topico','disciplina','incidencia']);
        return this._replaceAll('study_incidence',plan,arr.map((x,i)=>({profile_id:pid,plan_id:plan,incidence_id:x.id==null?('row-'+i):String(x.id),pct:x.pct==null?null:Number(x.pct),banca:x.banca||null,depth:x.depth==null?null:Number(x.depth),code:x.codigo||null,topic:x.topico||null,discipline:x.disciplina||null,incidence:x.incidencia==null?null:Number(x.incidencia),position:i,row_no:i+1,extra:this._unknown(x,known)})));
      }
      case'tec':{
        await this._deletePlanRows('study_tec_snapshots',plan);const snaps=[],rows=[];
        arr.forEach((s,i)=>{const sid=String(s.id),knownSnap=new Set(['id','date','startDate','endDate','importedAt','label','bancas','rows']);snaps.push({profile_id:pid,plan_id:plan,snapshot_id:sid,snapshot_date:s.date||null,start_date:s.startDate||null,end_date:s.endDate||null,imported_at:s.importedAt||null,label:s.label||null,bancas:s.bancas||[],position:i,extra:this._unknown(s,knownSnap)});
          (s.rows||[]).forEach((r,j)=>{const knownRow=new Set(['nome','peso','depth','codigo','acertos','questoes','pctAcerto','disciplina']);rows.push({profile_id:pid,plan_id:plan,snapshot_id:sid,row_no:j+1,name:r.nome||'',weight:r.peso==null?null:Number(r.peso),depth:r.depth==null?null:Number(r.depth),code:r.codigo||null,correct:r.acertos==null?null:Number(r.acertos),questions:r.questoes==null?null:Number(r.questoes),accuracy_pct:r.pctAcerto==null?null:Number(r.pctAcerto),discipline:r.disciplina||null,extra:this._unknown(r,knownRow)});});});
        if(snaps.length){const{error}=await c.from('study_tec_snapshots').insert(snaps);if(error)throw error;}for(let i=0;i<rows.length;i+=500){const{error}=await c.from('study_tec_snapshot_rows').insert(rows.slice(i,i+500));if(error)throw error;}return true;
      }
      default:{const{error}=await c.from('study_plan_state').upsert({profile_id:pid,plan_id:plan,key:d.kind,value:val,updated_at:now});if(error)throw error;return true;}
    }
  }
});
