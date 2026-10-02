/* ============================================================================
   CARDS -> ANKI OFICIAL 26.09.3
   ----------------------------------------------------------------------------
   O Cards preserva a UI/escopo/metadados do Study, mas scheduler, fila,
   rendering, type-answer, revlog e ações acadêmicas são executados na coleção
   isolada /api/cards-official, pelo pacote upstream anki==26.09.3.

   Regra: quando esta ponte está ativa NÃO existe fallback para CardEngine nas
   operações acadêmicas certificadas. Falha do backend aparece ao usuário e a
   resposta não avança.
   ========================================================================== */
(function(){
'use strict';

const CardsOfficialBridge = {
  enabled:true,
  ready:false,
  dirty:true,
  review:null,
  counts:{new:0,learning:0,review:0},
  timing:null,
  _bootPromise:null,
  _answering:false,
  _sessionAnswered:0,
  _sessionStartTotal:null,
  _blobUrls:[],
  _avToken:0,
  _activeAudio:null,
  _avPlaying:false,
  _undo:[],
  _redo:[],
  _autoAdvanceEnabled:false,
  _autoTimer:null,
  _timerTick:null,
  _autoToken:0,
  _reviewSessionId:null,
  _reviewSessionVersion:null,
  _renderEpoch:0,
  _orig:{},

  api(){
    if(!window.AnkiOfficial||typeof AnkiOfficial.request!=='function')throw new Error('Bridge oficial do Anki indisponível.');
    return AnkiOfficial;
  },
  request(path,opts){return this.api().request(path,opts);},
  _reviewSession(){
    if(!this._reviewSessionId){
      const random=(window.crypto&&typeof window.crypto.randomUUID==='function')
        ?window.crypto.randomUUID()
        :Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
      this._reviewSessionId='cards-review-'+random;
    }
    return this._reviewSessionId;
  },
  _screenActive(tab){
    const screen=document.getElementById('screen-cards');
    return !!(screen&&screen.classList.contains('active')&&window.CardsScreen&&CardsScreen.tab===tab);
  },
  _renderStillCurrent(token,tab,box){
    return token===this._renderEpoch&&this._screenActive(tab)&&(!box||box===document.getElementById('cards-content'));
  },
  cancelPendingRender(){
    this._renderEpoch++;
    if(typeof this._clearReviewerAutomation==='function')this._clearReviewerAutomation();
  },
  invalidate(reason){
    this.cancelPendingRender();
    this.dirty=true;this.ready=false;this.review=null;this.timing=null;this._reviewSessionVersion=null;
    this._sessionAnswered=0;this._sessionStartTotal=null;
    this._undo=[];this._redo=[];
    if(reason&&typeof _quiet==='function')_quiet(new Error('Cards official invalidated: '+reason),'cards-official-invalidate');
  },
  _allCards(){
    try{if(window.StudyGlobalScope&&StudyGlobalScope.allBy)return StudyGlobalScope.allBy('cards');}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-all');}
    return DB.getCards();
  },
  _scopeCards(){
    try{if(window.StudyGlobalScope&&StudyGlobalScope.cards)return StudyGlobalScope.cards();}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-scope');}
    return DB.getCards();
  },
  _reviewScopePayload(deckId=0){
    const global=window.StudyGlobalScope,
      mode=global&&global.cardsScope?global.cardsScope():'plan',
      label=mode==='all'?'Todos os planejamentos':(global&&global.planName?global.planName(this._activePlanId()):'Planejamento atual'),
      source=window.CardsScreen&&typeof CardsScreen.currentFilteredCards==='function'?CardsScreen.currentFilteredCards():this._scopeCards(),
      ids=[...new Set(source.map(c=>this._officialId(c)).filter(Boolean))];
    return {session_id:this._reviewSession(),deck_id:deckId,card_ids:ids,label};
  },
  async _syncReviewScope(deckId=0){
    if(deckId&&!this._scopeCards().some(c=>{
      const deck=window.StudyGlobalScope&&StudyGlobalScope.deckForCard?StudyGlobalScope.deckForCard(c):null;
      return deck&&Number(deck.ankiId||deck.id)===Number(deckId);
    }))deckId=0;
    const payload=this._reviewScopePayload(deckId);
    const review=await this.request('/api/cards-official/reviewer/scope',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    this._sessionAnswered=0;this._sessionStartTotal=null;
    this._reviewSessionVersion=review&&review.review_session?review.review_session.version:null;
    this._applyReviewer(review);
    return review;
  },
  _officialId(card){
    const n=Number(card&&card.ankiId!=null?card.ankiId:card&&card.id);
    return Number.isFinite(n)&&n>0?n:null;
  },
  _addDays(iso,days){
    const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m)return String(iso||'');
    const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
    d.setUTCDate(d.getUTCDate()+(Number(days)||0));
    return d.toISOString().slice(0,10);
  },
  _dayOffset(iso,base){
    const parse=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])):null;},
      a=parse(iso),b=parse(base||((typeof todayCards==='function')?todayCards():new Date().toISOString().slice(0,10)));
    return a==null||b==null?null:Math.round((a-b)/86400000);
  },
  _replicas(officialId){
    const key=String(officialId);
    return this._allCards().filter(c=>String(this._officialId(c))===key);
  },
  _deckReplicas(officialId){
    const key=String(officialId),out=[],seen=new Set(),
      plans=window.StudyGlobalScope&&StudyGlobalScope.plans?StudyGlobalScope.plans():[{id:this._activePlanId()}];
    for(const p of plans){
      const pid=p&&p.id!=null?p.id:null,
        rows=pid!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(pid,'decks'):DB.getDecks();
      for(const d of rows||[]){
        const oid=String(d&&d.ankiId!=null?d.ankiId:d&&d.id);
        if(oid!==key)continue;
        const k=String(pid==null?'':pid)+'|'+String(d.id);if(seen.has(k))continue;seen.add(k);
        out.push(Object.assign({},d,pid==null?{}:{_planId:pid}));
      }
    }
    return out;
  },
  _localForOfficialId(officialId){
    const key=String(officialId),scope=this._scopeCards();
    let hit=scope.find(c=>String(this._officialId(c))===key);
    if(hit)return hit;
    const active=window.StudyGlobalScope&&StudyGlobalScope.activePlanId?StudyGlobalScope.activePlanId():null;
    hit=this._replicas(officialId).find(c=>active!=null&&String(c._planId||'')===String(active));
    return hit||this._replicas(officialId)[0]||null;
  },
  _localDeckId(ankiDeckId,planId,fallback){
    if(!ankiDeckId)return null;
    try{
      const rows=window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(planId,'decks'):DB.getDecks();
      const d=(rows||[]).find(x=>String(x.ankiId!=null?x.ankiId:x.id)===String(ankiDeckId));
      if(d)return d.id;
    }catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-deck-map');}
    return fallback==null?null:fallback;
  },
  _clearBlobUrls(){
    while(this._blobUrls.length){const u=this._blobUrls.pop();try{URL.revokeObjectURL(u);}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-blob');}}
  },
  async _fetchMedia(name){
    const api=this.api(),base=api.apiBase(),t=api.token();
    const r=await fetch(base+'/api/cards-official/media/'+encodeURIComponent(name),{headers:t?{Authorization:'Bearer '+t}:{}});
    if(!r.ok)throw new Error('Mídia oficial não encontrada: '+name);
    return r.blob();
  },
  async uploadOfficialMedia(blobOrFile,filename){
    await this.bootstrap(false);
    const blob=blobOrFile instanceof Blob?blobOrFile:new Blob([blobOrFile]),
      name=String(filename||blob.name||('media-'+Date.now())).replace(/[\\/]+/g,'_'),
      fd=new FormData();
    fd.append('file',blob,name);
    const out=await this.request('/api/cards-official/editor/media',{method:'POST',body:fd});
    if(!out||!out.filename)throw new Error('O Media Manager oficial não confirmou o arquivo.');
    return out;
  },
  async _externalizeDataMedia(html,prefix){
    let out=String(html==null?'':html),seq=0;
    const re=/\b(src|poster)=(["'])data:([^;,"']+)(?:;charset=[^;,"']+)?;base64,([^"']+)\2/gi;
    const matches=[...out.matchAll(re)];
    for(const m of matches){
      const dataUrl='data:'+m[3]+';base64,'+m[4],
        blob=await fetch(dataUrl).then(r=>r.blob()),
        ext=(String(m[3]).split('/')[1]||'bin').replace(/[^a-z0-9]+/gi,'').replace(/^jpeg$/i,'jpg')||'bin',
        uploaded=await this.uploadOfficialMedia(blob,String(prefix||'pasted')+'-'+Date.now()+'-'+(++seq)+'.'+ext),
        replacement=m[1]+'='+m[2]+uploaded.filename+m[2];
      out=out.replace(m[0],replacement);
    }
    return out;
  },
  async _externalizeDataMediaFields(fields,prefix){
    const out=Object.assign({},fields||{});
    for(const key of Object.keys(out)){
      out[key]=await this._externalizeDataMedia(out[key],String(prefix||'field')+'-'+String(key).replace(/[^A-Za-z0-9_-]+/g,'_'));
    }
    return out;
  },
  async officialCsvMetadata(file,delimiter){
    await this.bootstrap(false);if(!file)throw new Error('Arquivo de texto ausente.');
    const qs=new URLSearchParams();if(delimiter)qs.set('delimiter',delimiter);
    const fd=new FormData();fd.append('file',file,file.name||'import.txt');
    const out=await this.request('/api/cards-official/import/csv/metadata'+(qs.toString()?'?'+qs.toString():''),{method:'POST',body:fd});
    if(!out||!out.metadata)throw new Error('O Anki oficial não devolveu CsvMetadata.');
    return out.metadata;
  },
  async importOfficialMnemosyne(file,deckId){
    await this.bootstrap(false);if(!file)throw new Error('Arquivo Mnemosyne ausente.');
    const qs=new URLSearchParams();
    if(deckId!=null){const ctx=this._deckContext(deckId);qs.set('deck_id',String(ctx.officialId));}
    const fd=new FormData();fd.append('file',file,file.name||'mnemosyne.db');
    const out=await this.request('/api/cards-official/import/mnemosyne'+(qs.toString()?'?'+qs.toString():''),{method:'POST',body:fd});
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou a importação Mnemosyne.');
    return out;
  },
  async importOfficialCsv(file,metadata){
    await this.bootstrap(false);if(!file)throw new Error('Arquivo de texto ausente.');
    const fd=new FormData();fd.append('file',file,file.name||'import.txt');fd.append('metadata_json',JSON.stringify(metadata||{}));
    const out=await this.request('/api/cards-official/import/csv',{method:'POST',body:fd});
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou a importação de texto.');
    return out;
  },
  async exportOfficialText(kind,options){
    kind=kind==='notes'?'notes':'cards';options=options||{};await this.bootstrap(false);
    const qs=new URLSearchParams({with_html:String(options.withHtml!==false)}),localDeck=options.limit&&options.limit.deckId;
    if(localDeck!=null){const ctx=this._deckContext(localDeck);qs.set('deck_id',String(ctx.officialId));}
    if(kind==='notes'){
      qs.set('with_tags',String(options.withTags!==false));qs.set('with_deck',String(options.withDeck!==false));
      qs.set('with_notetype',String(options.withNotetype!==false));qs.set('with_guid',String(options.withGuid!==false));
    }
    const api=this.api(),token=api.token(),response=await fetch(api.apiBase()+'/api/cards-official/export/'+kind+'-text?'+qs.toString(),{headers:token?{Authorization:'Bearer '+token}:{}});
    if(!response.ok){let message='Falha na exportação oficial de texto';try{const b=await response.json();if(b&&b.detail)message=b.detail;}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-text-export-error');}throw new Error(message);}
    return {blob:await response.blob(),count:Number(response.headers.get(kind==='notes'?'X-Anki-Exported-Notes':'X-Anki-Exported-Cards'))||0,kind};
  },
  async exportOfficialPackage(kind,options){
    kind=kind==='colpkg'?'colpkg':'apkg';options=options||{};
    await this.bootstrap(false);
    const qs=new URLSearchParams({
      with_media:String(options.withMedia!==false),
      legacy:String(!!options.legacy)
    });
    if(kind==='apkg'){
      qs.set('with_scheduling',String(options.withScheduling!==false));
      qs.set('with_deck_configs',String(options.withDeckConfigs!==false));
      const localDeck=options.limit&&options.limit.deckId;
      if(localDeck!=null){
        const ctx=this._deckContext(localDeck);qs.set('deck_id',String(ctx.officialId));
      }
    }
    const api=this.api(),base=api.apiBase(),token=api.token(),
      response=await fetch(base+'/api/cards-official/export/'+kind+'?'+qs.toString(),{headers:token?{Authorization:'Bearer '+token}:{}});
    if(!response.ok){
      let message='Falha na exportação oficial .'+kind;
      try{const body=await response.json();if(body&&body.detail)message=body.detail;}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-export-error-body');}
      throw new Error(message);
    }
    return {
      blob:await response.blob(),
      cards:Number(response.headers.get('X-Anki-Exported-Cards'))||null,
      kind,legacy:!!options.legacy
    };
  },
  async importOfficialPackage(file,options){
    options=options||{};if(!file)throw new Error('Arquivo de importação ausente.');
    await this.bootstrap(false);
    const kind=options.kind==='colpkg'?'colpkg':'apkg',qs=new URLSearchParams();
    if(kind==='apkg'){
      qs.set('with_scheduling',String(options.withScheduling!==false));
      qs.set('with_deck_configs',String(options.withDeckConfigs!==false));
      qs.set('merge_notetypes',String(options.mergeNotetypes!==false));
      qs.set('update_notes',String(options.updateNotes||'if-newer'));
      qs.set('update_notetypes',String(options.updateNotetypes||'if-newer'));
    }
    const fd=new FormData();fd.append('package',file,file.name||('import.'+kind));
    const out=await this.request('/api/cards-official/import/'+kind+(qs.toString()?'?'+qs.toString():''),{method:'POST',body:fd});
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou a importação.');
    return out;
  },
  async _syncOfficialFullState(state,planId){
    if(!state||!Array.isArray(state.notetypes)||!Array.isArray(state.notes))throw new Error('Snapshot integral da Collection oficial ausente.');
    const pid=planId!=null?planId:this._activePlanId(),
      officialNotes=new Set((state.notes||[]).map(x=>String(x.id))),
      officialNotetypes=new Set((state.notetypes||[]).map(x=>String(x&&x.notetype&&x.notetype.id)).filter(Boolean)),
      officialCards=new Set((state.cards||[]).map(x=>String(x.id))),
      officialDecks=new Set((state.decks||[]).map(x=>String(x&&x.id)).filter(Boolean)),
      noteTargets=new Map(),deckTargets=new Map(),ntTargets=new Map(),touchedPlans=new Set(),
      planKey=x=>String(x==null?'':x),
      addPlan=(map,key,targetPlan,value)=>{
        key=String(key==null?'':key);if(!map.has(key))map.set(key,new Map());
        const bucket=map.get(key),pk=planKey(targetPlan);
        if(!bucket.has(pk)||value!=null)bucket.set(pk,{planId:targetPlan,value:value==null?null:value});
        touchedPlans.add(pk);
      };

    // A Collection é global; a projeção Study não é. O espelho persistente do
    // Study registra em quais planejamentos cada card aparece; o Anki conserva
    // apenas o estado acadêmico. Isso torna reload e migração idempotentes sem
    // recalcular nenhuma decisão acadêmica nem abusar de card.custom_data.
    for(const cs of state.cards||[]){
      const targets=this._studyTargetsForState(cs,pid);
      for(const target of targets){
        addPlan(noteTargets,cs.note_id,target.planId,null);
        addPlan(deckTargets,cs.deck_id,target.planId,target.seed&&target.seed.deckId);
      }
    }
    for(const ns of state.notes||[]){
      const plans=noteTargets.get(String(ns.id));
      if(!plans||!plans.size)addPlan(noteTargets,ns.id,pid,null);
      const resolved=noteTargets.get(String(ns.id));
      for(const target of resolved.values())addPlan(ntTargets,ns.notetype_id,target.planId,null);
    }
    if(!touchedPlans.size)touchedPlans.add(planKey(pid));

    const deckRows=new Map((state.decks||[]).filter(Boolean).map(row=>[String(row.id),row]));
    for(const row of state.decks||[]){
      if(!row)continue;
      const targets=deckTargets.get(String(row.id));
      if(targets&&targets.size){
        for(const target of targets.values()){
          if(row.filtered)this._saveFilteredDeckMirror(row,target.planId,target.value);
          else this._saveNormalDeckMirror(row,target.planId,target.value);
        }
      }else{
        // Baralhos vazios não têm card do qual inferir o plano. Eles continuam
        // visíveis no planejamento que solicitou o snapshot.
        if(row.filtered)this._saveFilteredDeckMirror(row,pid,null);
        else this._saveNormalDeckMirror(row,pid,null);
        touchedPlans.add(planKey(pid));
      }
    }

    const ntRows=new Map((state.notetypes||[]).filter(x=>x&&x.notetype).map(x=>[String(x.notetype.id),x]));
    for(const [ntid,targets] of ntTargets){
      const row=ntRows.get(String(ntid));if(!row)continue;
      this._syncNotetypesIntoPlans([row],[...targets.values()].map(x=>x.planId));
    }
    // Tipos sem nota continuam acessíveis no planejamento ativo (como os stock
    // NoteTypes recém-criados pelo Anki), mas não são replicados artificialmente
    // para todos os planejamentos.
    for(const row of state.notetypes||[]){
      if(!row||!row.notetype||ntTargets.has(String(row.notetype.id)))continue;
      this._syncNotetypesIntoPlans([row],[pid]);
    }

    for(const ns of state.notes||[]){
      const targets=noteTargets.get(String(ns.id))||new Map([[planKey(pid),{planId:pid}]]);
      for(const target of targets.values()){
        const fallback=this._localNotetypeId(ns.notetype_id,target.planId,null);
        this._materializeOfficialNote(ns,target.planId,fallback);
      }
    }
    await this._reconcileOfficialCardSet(state.notes,state.cards||[]);

    // Poda somente espelhos que possuem identidade oficial. Registros legados
    // ainda não mapeados jamais são apagados por um snapshot parcial/falha de
    // migração. Entidades locais órfãs sem identidade são removidas apenas
    // quando nenhum card do mesmo planejamento ainda as referencia.
    const plans=[...touchedPlans].map(k=>k===''?null:k);
    for(const targetPlan of plans){
      const cardRows=targetPlan!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(targetPlan,'cards'):DB.getCards(),
        keptCards=(cardRows||[]).filter(card=>{
          const oid=Number(card&&card.ankiId);
          return !(Number.isFinite(oid)&&oid>0)||officialCards.has(String(oid));
        }),
        clean=x=>{const y=Object.assign({},x);delete y._planId;delete y._planNome;return y;};
      if(targetPlan!=null&&DB.saveCardsForPlan)DB.saveCardsForPlan(targetPlan,keptCards.map(clean));
      else DB.saveCards(keptCards.map(clean));

      const referencedNotes=new Set(keptCards.map(c=>String(c&&c.noteId)).filter(Boolean)),
        notes=AnkiParity.notes(targetPlan==null?undefined:targetPlan);
      for(const note of notes){
        const oid=Number(note&&note.ankiId);
        const staleOfficial=Number.isFinite(oid)&&oid>0&&!officialNotes.has(String(oid));
        const orphanLocal=!(Number.isFinite(oid)&&oid>0)&&!referencedNotes.has(String(note&&note.id));
        if(!staleOfficial&&!orphanLocal)continue;
        try{localStorage.removeItem(AnkiParity._entityKey('note',note.id,targetPlan==null?undefined:targetPlan));}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-full-prune-note');}
      }

      const remainingNotes=AnkiParity.notes(targetPlan==null?undefined:targetPlan),
        referencedTypes=new Set(remainingNotes.map(n=>String(n&&n.notetypeId)).filter(Boolean));
      for(const nt of AnkiParity.noteTypes(targetPlan==null?undefined:targetPlan)){
        const oid=Number(nt&&nt.ankiId);
        const staleOfficial=Number.isFinite(oid)&&oid>0&&!officialNotetypes.has(String(oid));
        const orphanLocal=!(Number.isFinite(oid)&&oid>0)&&!referencedTypes.has(String(nt&&nt.id));
        if(!staleOfficial&&!orphanLocal)continue;
        try{localStorage.removeItem(AnkiParity._entityKey('notetype',nt.id,targetPlan==null?undefined:targetPlan));}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-full-prune-notetype');}
      }

      const deckRowsLocal=targetPlan!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(targetPlan,'decks'):DB.getDecks(),
        keptDecks=(deckRowsLocal||[]).filter(deck=>{
          const oid=Number(deck&&deck.ankiId);
          return !(Number.isFinite(oid)&&oid>0)||officialDecks.has(String(oid));
        });
      if(targetPlan!=null)DB._set(DB.keysForPlan(targetPlan).decks,keptDecks.map(clean));
      else DB.saveDecks(keptDecks.map(clean));
    }

    await this._syncCollectionState(state,pid,null);
    if(state.reviewer)this._applyReviewer(state.reviewer);
    this.ready=true;this.dirty=false;this._browserCache=[];CardsScreen.invalidateReviewQueue();
    return state;
  },
  async syncOfficialPackageImport(out){
    if(!out||!out.state)return out;
    await this._syncOfficialFullState(out.state,this._activePlanId());
    return out;
  },
  async getOfficialPreferences(){
    await this.bootstrap(false);
    return this.request('/api/cards-official/preferences');
  },
  async updateOfficialPreferences(patch){
    await this.bootstrap(false);
    const out=await this.request('/api/cards-official/preferences',{
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch||{})
    });
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou as preferências.');
    if(out.state)await this._syncCollectionState(out.state,this._activePlanId(),null);
    this.dirty=false;
    this.preferences=out.preferences||{};
    return this.preferences;
  },

  async historyStatus(){
    await this.bootstrap(false);
    return this.request('/api/cards-official/history/status');
  },
  async undoCollectionOfficial(){
    await this.bootstrap(false);
    const out=await this.request('/api/cards-official/history/undo',{method:'POST'});
    if(!out||!out.state)throw new Error('O Anki oficial não devolveu o estado após desfazer.');
    await this._syncOfficialFullState(out.state,this._activePlanId());
    CardsScreen.render();if(window.AnkiProductParity&&AnkiProductParity.renderBrowser)AnkiProductParity.renderBrowser();
    return out;
  },
  async redoCollectionOfficial(){
    await this.bootstrap(false);
    const out=await this.request('/api/cards-official/history/redo',{method:'POST'});
    if(!out||!out.state)throw new Error('O Anki oficial não devolveu o estado após refazer.');
    await this._syncOfficialFullState(out.state,this._activePlanId());
    CardsScreen.render();if(window.AnkiProductParity&&AnkiProductParity.renderBrowser)AnkiProductParity.renderBrowser();
    return out;
  },
  async findOfficialDuplicates(field,search){
    await this.bootstrap(false);
    const qs=new URLSearchParams({field:String(field||''),search:String(search||'')});
    return this.request('/api/cards-official/browser/duplicates?'+qs.toString());
  },
  async htmlWithMedia(html){
    this._clearBlobUrls();
    const doc=new DOMParser().parseFromString(String(html||''),'text/html');
    const dark=document.documentElement.getAttribute('data-theme')==='dark';
    doc.documentElement.classList.toggle('nightMode',dark);
    doc.body.classList.add('card');doc.body.classList.toggle('nightMode',dark);
    const css=Array.from(doc.querySelectorAll('style')).map(s=>s.textContent||'').join('\n').replace(/\/\*[\s\S]*?\*\//g,'');
    if(dark&&!/\.night_?mode\b[^{}]*\{[^}]*\bbackground(?:-color)?\s*:/i.test(css)){
      const style=doc.createElement('style');style.textContent='html.nightMode body.card{background:transparent;color:#e8eaed}';doc.head.appendChild(style);
    }
    const cache=new Map();
    const resolveLocal=async(raw)=>{
      let src=String(raw==null?'':raw).trim().replace(/^['"]|['"]$/g,'');
      if(!src||/^(?:https?:|data:|blob:|about:|#)/i.test(src))return null;
      src=src.replace(/^\.\//,'');
      try{src=decodeURIComponent(src);}catch(_){/* nome já utilizável */}
      if(!src||src.includes('/')||src.includes('\\'))return null;
      if(cache.has(src))return cache.get(src);
      try{
        const blob=await this._fetchMedia(src),url=URL.createObjectURL(blob);
        this._blobUrls.push(url);cache.set(src,url);return url;
      }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-media');cache.set(src,null);return null;}
    };
    for(const attr of ['src','poster']){
      for(const el of Array.from(doc.querySelectorAll('['+attr+']'))){
        const url=await resolveLocal(el.getAttribute(attr));if(url)el.setAttribute(attr,url);
      }
    }
    for(const el of Array.from(doc.querySelectorAll('[srcset]'))){
      const parts=String(el.getAttribute('srcset')||'').split(',');
      const mapped=[];
      for(const part of parts){
        const m=part.trim().match(/^(\S+)(\s+.*)?$/);if(!m){mapped.push(part);continue;}
        const url=await resolveLocal(m[1]);mapped.push((url||m[1])+(m[2]||''));
      }
      el.setAttribute('srcset',mapped.join(', '));
    }
    const rewriteCss=async(text)=>{
      let out=String(text||''),matches=[...out.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^)"']+))\s*\)/gi)];
      for(const m of matches){
        const raw=String(m[2]!=null?m[2]:m[3]||'').trim(),url=await resolveLocal(raw);
        if(url)out=out.replace(m[0],'url("'+url+'")');
      }
      return out;
    };
    for(const style of Array.from(doc.querySelectorAll('style')))style.textContent=await rewriteCss(style.textContent||'');
    for(const el of Array.from(doc.querySelectorAll('[style]')))el.setAttribute('style',await rewriteCss(el.getAttribute('style')||''));
    return '<!doctype html>'+doc.documentElement.outerHTML;
  },
  _officialTtsVoice(tag){
    if(typeof speechSynthesis==='undefined'||!speechSynthesis.getVoices)return null;
    const voices=speechSynthesis.getVoices()||[],wanted=Array.isArray(tag&&tag.voices)?tag.voices.map(String):[],
      lang=String(tag&&tag.lang||'').toLowerCase();
    for(const name of wanted){
      const hit=voices.find(v=>String(v.name||'')===name);if(hit)return hit;
    }
    if(lang){
      const exact=voices.find(v=>String(v.lang||'').toLowerCase()===lang);if(exact)return exact;
      const prefix=lang.split('-')[0],near=voices.find(v=>String(v.lang||'').toLowerCase().split('-')[0]===prefix);if(near)return near;
    }
    return null;
  },
  _setAvPlaying(active){
    this._avPlaying=!!active;
    if(!this._avPlaying&&CardsScreen._resumeAutoAdvanceIfReady){
      try{CardsScreen._resumeAutoAdvanceIfReady();}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-av-resume');}
    }
  },
  isAvPlaying(){return !!this._avPlaying;},
  stopAv(){
    this._avToken++;
    try{if(this._activeAudio){this._activeAudio.pause();this._activeAudio=null;}}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-av-stop');}
    try{if(typeof speechSynthesis!=='undefined')speechSynthesis.cancel();}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-tts-stop');}
    this._setAvPlaying(false);
  },
  pauseAv(){
    try{
      if(this._activeAudio){
        if(this._activeAudio.paused){const p=this._activeAudio.play();if(p&&p.catch)p.catch(()=>{});}
        else this._activeAudio.pause();
        return true;
      }
      if(typeof speechSynthesis!=='undefined'){
        if(speechSynthesis.paused)speechSynthesis.resume();else speechSynthesis.pause();
        return true;
      }
    }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-av-pause');}
    return false;
  },
  seekAv(seconds){
    try{
      if(!this._activeAudio)return false;
      this._activeAudio.currentTime=Math.max(0,(this._activeAudio.currentTime||0)+(Number(seconds)||0));
      return true;
    }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-av-seek');return false;}
  },
  async _playOfficialTts(tag,token){
    if(typeof speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined')return false;
    const text=String(tag&&tag.field_text||'');if(!text)return false;
    return new Promise(resolve=>{
      if(token!==this._avToken)return resolve(false);
      const u=new SpeechSynthesisUtterance(text),voice=this._officialTtsVoice(tag);
      if(tag&&tag.lang)u.lang=String(tag.lang);
      if(voice)u.voice=voice;
      const speed=Number(tag&&tag.speed);if(Number.isFinite(speed)&&speed>0)u.rate=Math.max(.1,Math.min(10,speed));
      u.onend=u.onerror=()=>resolve(true);
      try{speechSynthesis.speak(u);}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-tts');resolve(false);}
    });
  },
  async playAv(tags){
    this.stopAv();
    const list=Array.isArray(tags)?tags:[],token=++this._avToken;
    if(!list.length)return false;
    this._setAvPlaying(true);
    try{
      for(const tag of list){
        if(token!==this._avToken)break;
        if(tag.kind==='tts'){await this._playOfficialTts(tag,token);continue;}
        if(tag.kind!=='media'||!tag.filename)continue;
        try{
          const blob=await this._fetchMedia(tag.filename),url=URL.createObjectURL(blob);this._blobUrls.push(url);
          await new Promise(resolve=>{
            if(token!==this._avToken)return resolve();
            const a=new Audio(url);this._activeAudio=a;
            const done=()=>{if(this._activeAudio===a)this._activeAudio=null;resolve();};
            a.onended=done;a.onerror=done;
            const p=a.play();if(p&&p.catch)p.catch(done);
          });
        }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-av');}
      }
    }finally{
      if(token===this._avToken)this._setAvPlaying(false);
    }
    return true;
  },
  _officialCardInfoValue(value){
    if(value==null||value==='')return '—';
    if(typeof value==='number')return Number.isFinite(value)?String(value):'—';
    if(typeof value==='object')return escapeHtml(JSON.stringify(value));
    return escapeHtml(String(value));
  },
  _officialCardInfoDate(value){
    const n=Number(value);if(!Number.isFinite(n)||n<=0)return '—';
    const ms=n<1e12?n*1000:n;
    try{return new Date(ms).toLocaleString('pt-BR');}catch(_){return String(value);}
  },
  async openCardInfo(ref){
    await this.bootstrap(false);
    const local=ref&&typeof ref==='object'?ref:(CardsScreen.collectionCards().find(c=>String(c.id)===String(ref))||DB.getCard(ref));
    if(!local)throw new Error('Card não encontrado.');
    const oid=this._officialId(local);if(oid==null)throw new Error('Card sem identidade Anki canônica.');
    const info=await this.request('/api/cards-official/card-info/'+encodeURIComponent(oid));
    const row=(label,value)=>'<tr><td style="padding:4px 10px 4px 0;color:var(--text-faint)">'+escapeHtml(label)+'</td><td style="padding:4px 0;font-family:Space Mono,monospace">'+value+'</td></tr>',
      ms=info.memory_state||{},rev=Array.isArray(info.revlog)?info.revlog:[],
      body='<table style="width:100%;font-size:12.5px;border-collapse:collapse">'+
        row('Baralho',this._officialCardInfoValue(info.deck))+
        row('Baralho original',this._officialCardInfoValue(info.original_deck))+
        row('Tipo de nota',this._officialCardInfoValue(info.notetype))+
        row('Tipo de card',this._officialCardInfoValue(info.card_type))+
        row('Preset',this._officialCardInfoValue(info.preset))+
        row('Adicionado',this._officialCardInfoDate(info.added))+
        row('Primeira revisão',this._officialCardInfoDate(info.first_review))+
        row('Última revisão',this._officialCardInfoDate(info.latest_review))+
        row('Vencimento',this._officialCardInfoDate(info.due_date))+
        row('Posição',this._officialCardInfoValue(info.due_position))+
        row('Intervalo',this._officialCardInfoValue(info.interval))+
        row('Facilidade',this._officialCardInfoValue(info.ease))+
        row('Revisões',this._officialCardInfoValue(info.reviews))+
        row('Lapsos',this._officialCardInfoValue(info.lapses))+
        row('Estabilidade',this._officialCardInfoValue(ms.stability))+
        row('Dificuldade',this._officialCardInfoValue(ms.difficulty))+
        row('Recuperabilidade',this._officialCardInfoValue(info.fsrs_retrievability))+
        row('Retenção desejada',this._officialCardInfoValue(info.desired_retention))+
        row('Tempo médio (s)',this._officialCardInfoValue(info.average_secs))+
        row('Tempo total (s)',this._officialCardInfoValue(info.total_secs))+
      '</table>'+
      '<p style="margin:14px 0 6px;font-weight:700;font-size:12.5px">Histórico oficial ('+rev.length+')</p>'+
      (rev.length?'<div style="max-height:260px;overflow:auto"><table style="width:100%;font-size:12px;border-collapse:collapse">'+
        rev.map(x=>'<tr style="border-top:1px solid var(--border)">'+
          '<td style="padding:4px 8px 4px 0;color:var(--text-faint)">'+this._officialCardInfoDate(x.time)+'</td>'+
          '<td style="padding:4px 8px 4px 0">rating '+this._officialCardInfoValue(x.button_chosen)+'</td>'+
          '<td style="padding:4px 8px 4px 0">kind '+this._officialCardInfoValue(x.review_kind)+'</td>'+
          '<td style="padding:4px 0;color:var(--text-faint)">'+this._officialCardInfoValue(x.last_interval)+' → '+this._officialCardInfoValue(x.interval)+'</td>'+
        '</tr>').join('')+'</table></div>':'<p class="hint">Nenhuma revisão registrada pelo Anki.</p>');
    await UI.alert(body,{title:'ℹ Card Info · Anki oficial',html:true,okText:'Fechar'});
    return info;
  },
  async previewBrowserCard(ref,opts){
    opts=opts||{};await this.bootstrap(false);
    const local=ref&&typeof ref==='object'?ref:(CardsScreen.collectionCards().find(c=>String(c.id)===String(ref))||DB.getCard(ref));
    const box=document.getElementById('anki-browser-preview');
    if(!local){if(box)box.innerHTML='<p class="hint">Card não encontrado.</p>';return false;}
    const oid=this._officialId(local);if(oid==null)throw new Error('Card sem identidade Anki canônica.');
    const state=await this.request('/api/cards-official/card/'+encodeURIComponent(oid)+'/state'),
      pid=local._planId!=null?local._planId:this._activePlanId(),
      note=opts.note||((AnkiParity.noteForCard&&AnkiParity.noteForCard(local))||AnkiParity.getNote(local.noteId||local.id,pid==null?undefined:pid)),
      siblings=note&&window.AnkiProductParity?AnkiProductParity._cardsForNote(note,pid):[local],
      stats=state.stats||{};
    if(!box)return state;
    box.innerHTML='<div class="anki-preview-head"><strong>'+escapeHtml(stats.notetype||'Tipo de nota')+'</strong><span>'+escapeHtml(stats.card_type||'Card')+' · '+siblings.length+' card(s)</span></div>'+
      '<div class="anki-preview-label">Pergunta · renderer oficial</div><iframe id="anki-preview-question-frame" class="anki-study-card-frame" sandbox="allow-scripts" title="Pergunta Anki"></iframe>'+
      '<div class="anki-preview-label">Resposta · renderer oficial</div><iframe id="anki-preview-answer-frame" class="anki-study-card-frame" sandbox="allow-scripts" title="Resposta Anki"></iframe>'+
      '<div class="anki-preview-actions"><button type="button" class="btn-primary" id="anki-preview-edit">✎ Editar nota</button><button type="button" class="btn-secondary" id="anki-preview-info">ℹ Info do card</button></div>';
    const [q,a]=await Promise.all([this.htmlWithMedia(state.question||''),this.htmlWithMedia(state.answer||'')]),
      qf=document.getElementById('anki-preview-question-frame'),af=document.getElementById('anki-preview-answer-frame');
    if(qf)qf.srcdoc=q;if(af)af.srcdoc=a;
    const edit=document.getElementById('anki-preview-edit');if(edit&&note)edit.onclick=()=>AnkiProductParity.openNoteEditor(note);
    const info=document.getElementById('anki-preview-info');if(info)info.onclick=()=>CardsScreen.cardInfo(local);
    return state;
  },

  async openOfficialCheck(){
    await this.bootstrap(false);
    const modal=document.getElementById('anki-check-modal'),body=document.getElementById('anki-check-body');
    if(modal)modal.style.display='flex';
    if(body)body.innerHTML='<div class="anki-check-status"><strong>Collection oficial do Anki</strong><span>Use “Verificar/Reparar” para executar Collection.fix_integrity().</span></div><p class="hint">Nenhum diagnóstico acadêmico é calculado pelo Study.</p>';
  },
  _installOfficialCheck(){
    if(!window.AnkiProductParity)return;
    const self=this;AnkiProductParity.openCheck=()=>void self.openOfficialCheck().catch(e=>showToast('Verificação oficial indisponível: '+(e.message||e)));
    const safe=document.getElementById('anki-check-safe');
    if(safe){
      const clean=safe.cloneNode(true);safe.replaceWith(clean);clean.textContent='🛠 Verificar/Reparar · Anki oficial';
      clean.addEventListener('click',async()=>{
        clean.disabled=true;const old=clean.textContent;clean.textContent='⏳ Executando…';
        try{
          const out=await self.checkOfficialDatabase(),body=document.getElementById('anki-check-body');
          if(body)body.innerHTML='<div class="anki-check-status '+(out.ok?'ok':'warn')+'"><strong>'+escapeHtml(out.ok?'Verificação concluída':'O Anki reportou problemas')+'</strong><span>'+escapeHtml(out.message||'')+'</span></div><p class="hint">Resultado produzido por Collection.fix_integrity() do Anki oficial.</p>';
          CardsScreen.render();
        }catch(e){showToast('Verificação oficial falhou: '+(e.message||e));}
        finally{clean.disabled=false;clean.textContent=old;}
      });
    }
    const empty=document.getElementById('anki-check-empty');
    if(empty){
      const clean=empty.cloneNode(true);empty.replaceWith(clean);clean.textContent='🧹 Empty Cards · Anki oficial';
      clean.addEventListener('click',()=>void self.openEmptyCards());
    }
  },
  async checkOfficialMedia(){
    await this.bootstrap(false);
    return this.request('/api/cards-official/media/check');
  },
  async trashOfficialMedia(files){
    await this.bootstrap(false);
    return this.request('/api/cards-official/media/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:[...new Set((files||[]).map(String).filter(Boolean))]})});
  },
  async restoreOfficialMediaTrash(){
    await this.bootstrap(false);
    return this.request('/api/cards-official/media/restore-trash',{method:'POST'});
  },
  async emptyOfficialMediaTrash(){
    await this.bootstrap(false);
    return this.request('/api/cards-official/media/empty-trash',{method:'POST'});
  },
  async tagOfficialMissingMedia(noteIds){
    await this.bootstrap(false);
    return this.request('/api/cards-official/media/tag-missing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note_ids:[...new Set((noteIds||[]).map(Number).filter(x=>Number.isFinite(x)&&x>0))]})});
  },
  async renderOfficialLatexMedia(){
    await this.bootstrap(false);
    return this.request('/api/cards-official/media/render-latex',{method:'POST'});
  },
  async checkOfficialDatabase(){
    await this.bootstrap(false);
    const out=await this.request('/api/cards-official/database/check',{method:'POST'});
    if(out&&out.state)await this._syncCollectionState(out.state,this._activePlanId(),null);
    return out;
  },
  async optimizeOfficialDatabase(){
    await this.bootstrap(false);
    return this.request('/api/cards-official/database/optimize',{method:'POST'});
  },

  _legacyScopedKey(kind,planId,id){
    return String(kind||'x')+':'+encodeURIComponent(String(planId==null?'':planId))+'::'+encodeURIComponent(String(id==null?'':id));
  },
  _legacyCanonicalKey(kind,value,planId,id){
    const n=Number(value);
    return Number.isFinite(n)&&n>0?String(kind||'x')+':anki:'+String(n):this._legacyScopedKey(kind,planId,id);
  },
  _legacyGuid(key){
    const s=String(key||''),mix=(seed,mul)=>{
      let h=seed>>>0;
      for(let i=0;i<s.length;i++)h=Math.imul((h^s.charCodeAt(i))>>>0,mul)>>>0;
      return h.toString(36);
    };
    return 'snm'+mix(0x811c9dc5,16777619)+mix(0x9e3779b9,2246822519);
  },
  _legacyPlanRows(planId,suffix){
    if(window.StudyGlobalScope&&StudyGlobalScope._rows&&planId!=null)return StudyGlobalScope._rows(planId,suffix)||[];
    if(suffix==='cards')return DB.getCards()||[];
    if(suffix==='decks')return DB.getDecks()||[];
    if(suffix==='revlog')return DB.getRevlog()||[];
    return [];
  },
  _legacyPlans(){
    const rows=window.StudyGlobalScope&&StudyGlobalScope.plans?StudyGlobalScope.plans():[],
      active=this._activePlanId(),out=[],seen=new Set();
    for(const p of rows||[]){
      const id=p&&p.id!=null?p.id:null,k=String(id==null?'':id);
      if(seen.has(k))continue;seen.add(k);out.push({id,name:p&&((p.nome||p.name))||k});
    }
    if(active!=null&&!seen.has(String(active)))out.unshift({id:active,name:window.StudyGlobalScope&&StudyGlobalScope.planName?StudyGlobalScope.planName(active):String(active)});
    if(!out.length)out.push({id:active,name:'Planejamento atual'});
    return out;
  },
  _legacyDateDelta(date){
    const raw=String(date||'').slice(0,10),today=typeof todayCards==='function'?todayCards():new Date().toISOString().slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)||!/^\d{4}-\d{2}-\d{2}$/.test(today))return 0;
    const a=Date.parse(raw+'T12:00:00Z'),b=Date.parse(today+'T12:00:00Z');
    return Number.isFinite(a)&&Number.isFinite(b)?Math.round((a-b)/86400000):0;
  },
  _legacyTemplateOrd(card){
    const direct=card&&card.ankiTemplateOrd!=null&&card.ankiTemplateOrd!==''?Number(card.ankiTemplateOrd):NaN;
    if(Number.isFinite(direct)&&direct>=0)return Math.floor(direct);
    const co=Number(card&&card.clozeOrd);
    if(Number.isFinite(co)&&co>0)return Math.floor(co)-1;
    const t=String(card&&card.template||'');
    const m=/^cloze:(\d+)$/i.exec(t);if(m)return Math.max(0,Number(m[1])-1);
    return t==='reverse'||card&&card.reversedOf?1:0;
  },
  _legacyScheduleRow(card,timingToday){
    const phase=String(card&&card.phase||(((Number(card&&card.reps)||0)>0&&(Number(card&&card.intervalo)||0)>0)?'review':'new')).toLowerCase();
    const numberOrMissing=value=>value==null||value===''?NaN:Number(value);
    let type=numberOrMissing(card&&card.ankiType),queue=numberOrMissing(card&&card.ankiQueue);
    if(!Number.isFinite(type))type=({learning:1,review:2,relearning:3})[phase]||0;
    if(!Number.isFinite(queue))queue=({learning:1,review:2,relearning:1})[phase]||0;
    if(card&&card.suspenso)queue=-1;
    else if(card&&card.enterradoAte)queue=card.buryKind==='scheduler'?-2:-3;
    let due=numberOrMissing(card&&card.ankiDue);
    if(type===2&&/^\d{4}-\d{2}-\d{2}$/.test(String(card&&card.due||'')))due=Math.max(0,(Number(timingToday)||0)+this._legacyDateDelta(card.due));
    if(!Number.isFinite(due)){
      if(type===0)due=Math.max(1,Number(card&&card.posicaoNova)||1);
      else if(queue===1||queue===4)due=Math.max(0,Math.floor((Number(card&&card.dueTs)||0)/1000));
      else due=Math.max(0,(Number(timingToday)||0)+this._legacyDateDelta(card&&card.due));
    }
    let odue=numberOrMissing(card&&card.ankiOriginalDue);
    if(!Number.isFinite(odue)){
      if(card&&card.originalDueTs)odue=Math.max(0,Math.floor(Number(card.originalDueTs)/1000));
      else if(card&&card.originalDue)odue=Math.max(0,(Number(timingToday)||0)+this._legacyDateDelta(card.originalDue));
      else odue=0;
    }
    return {type,queue,due,odue};
  },
  _legacyMigrationSnapshot(timingToday){
    const plans=this._legacyPlans(),payload={decks:[],notetypes:[],notes:[],cards:[],revlog:[]},
      deckRefs=new Map(),cardRefs=new Map(),noteRefs=new Map(),deckKeyByLocal=new Map(),cardKeyByLocal=new Map(),
      deckRows=new Map(),cardGroups=new Map(),notetypeRows=new Map(),noteGroups=new Map(),
      localKey=(pid,id)=>String(pid==null?'':pid)+'|'+String(id==null?'':id),
      clone=x=>{try{return JSON.parse(JSON.stringify(x));}catch(_){return Object.assign({},x);}},
      addRef=(map,key,ref)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(ref);};

    for(const p of plans){
      const pid=p.id;
      for(const d0 of this._legacyPlanRows(pid,'decks')){
        if(!d0||d0.id==null)continue;
        const d=Object.assign({},d0,pid==null?{}:{_planId:pid}),
          key=this._legacyCanonicalKey('deck',d.ankiId,pid,d.id);
        deckKeyByLocal.set(localKey(pid,d.id),key);addRef(deckRefs,key,{planId:pid,localId:d.id,row:d});
        if(!deckRows.has(key))deckRows.set(key,{id:key,name:String(d.nome||d.name||'Baralho')});
      }
      for(const c0 of this._legacyPlanRows(pid,'cards')){
        if(!c0||c0.id==null)continue;
        const c=Object.assign({},c0,pid==null?{}:{_planId:pid}),
          key=this._legacyCanonicalKey('card',c.ankiId,pid,c.id),ref={planId:pid,localId:c.id,card:c},
          lk=localKey(pid,c.id);
        cardKeyByLocal.set(lk,key);addRef(cardRefs,key,ref);
        let g=cardGroups.get(key);
        if(!g){g={key,representative:ref,refs:cardRefs.get(key)};cardGroups.set(key,g);}
        else{
          const a=Date.parse(g.representative.card.updatedAt||g.representative.card.createdAt||0)||0,
            b=Date.parse(c.updatedAt||c.createdAt||0)||0;
          if(b>a)g.representative=ref;
          g.refs=cardRefs.get(key);
        }
      }
    }

    for(const row of deckRows.values())payload.decks.push(row);

    const registerNotetype=(nt,pid,fallbackKind)=>{
      if(!nt){
        const kind=fallbackKind||'basic',key='stock:'+kind;
        if(!notetypeRows.has(key))notetypeRows.set(key,{
          id:key,name:kind==='cloze'?'Study Legacy Cloze':kind==='basic_reversed'?'Study Legacy Basic (and reversed card)':'Study Legacy Basic',
          stock_kind:kind,kind:kind==='cloze'?'cloze':'normal'
        });
        return key;
      }
      const key=this._legacyCanonicalKey('notetype',nt.ankiId,pid,nt.id||nt.name||fallbackKind||'basic');
      if(!notetypeRows.has(key)){
        const fields=(nt.fields||[]).map((f,i)=>({
          name:String(f&&f.name||('Field '+(i+1))),font:f&&f.font!=null?f.font:(f&&f.fontName)||'Arial',
          size:Number(f&&f.size!=null?f.size:f&&f.fontSize)||20,rtl:!!(f&&f.rtl),sticky:!!(f&&f.sticky),
          collapsed:!!(f&&f.collapsed),excludeFromSearch:!!(f&&f.excludeFromSearch),tag:f&&f.tag!=null?Number(f.tag):null
        }));
        const templates=(nt.templates||[]).map((t,i)=>({
          name:String(t&&t.name||('Card '+(i+1))),qfmt:String(t&&t.qfmt||''),afmt:String(t&&t.afmt||''),
          bqfmt:String(t&&t.bqfmt||''),bafmt:String(t&&t.bafmt||''),did:t&&t.did||null,bfont:String(t&&t.bfont||''),bsize:Number(t&&t.bsize)||0
        }));
        notetypeRows.set(key,{
          id:key,name:String(nt.name||'Study Legacy Note Type'),stock_kind:String(nt.stockKind||fallbackKind||(nt.kind==='cloze'?'cloze':'basic')),
          kind:nt.kind==='cloze'?'cloze':'normal',sortf:Math.max(0,Number(nt.sortf)||0),css:String(nt.css||''),fields,templates
        });
      }
      return key;
    };

    for(const group of cardGroups.values()){
      const rep=group.representative,card=rep.card,pid=rep.planId,
        nid=card.noteId||card.id,
        noteKey=this._legacyCanonicalKey('note',card.ankiNoteId,pid,nid);
      group.noteKey=noteKey;
      if(!noteGroups.has(noteKey))noteGroups.set(noteKey,{key:noteKey,cardGroups:[],refs:[]});
      const ng=noteGroups.get(noteKey);ng.cardGroups.push(group);
      for(const ref of group.refs){
        if(!ng.refs.some(x=>String(x.planId==null?'':x.planId)===String(ref.planId==null?'':ref.planId)&&String(x.localId)===String(ref.localId)))ng.refs.push(ref);
      }
      addRef(noteRefs,noteKey,rep);
    }

    const noteKind=ng=>{
      const cards=ng.cardGroups.map(g=>g.representative.card);
      if(cards.some(c=>String(c.kind||'').toLowerCase()==='cloze'||/^cloze:/i.test(String(c.template||''))))return'cloze';
      if(cards.some(c=>String(c.template||'')==='reverse'||c.reversedOf))return'basic_reversed';
      return'basic';
    };

    for(const ng of noteGroups.values()){
      const refs=ng.refs,first=refs[0],pid=first&&first.planId,kind=noteKind(ng);
      let localNote=null,localNt=null;
      for(const ref of refs){
        try{
          const c=ref.card,nid=c.noteId||c.id;
          localNote=AnkiParity.getNote(nid,ref.planId==null?undefined:ref.planId)||null;
          if(localNote){
            localNt=AnkiParity.getNotetype(localNote.notetypeId,ref.planId==null?undefined:ref.planId)||null;
            if(localNt)break;
          }
        }catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-legacy-note');}
      }
      const ntKey=registerNotetype(localNt,pid,kind),
        cards=ng.cardGroups.map(g=>g.representative.card),
        forward=cards.find(c=>String(c.template||'')!=='reverse')||cards[0]||{},
        fields=localNote&&localNote.fields&&Object.keys(localNote.fields).length?clone(localNote.fields):
          (kind==='cloze'?{Text:String(forward.frente||''),'Back Extra':String(forward.verso||'')}:{Front:String(forward.frente||''),Back:String(forward.verso||'')}),
        tags=localNote&&Array.isArray(localNote.tags)?localNote.tags.slice():[];
      if(cards.some(c=>c.favorito)&&!tags.some(t=>String(t).toLowerCase()==='marked'))tags.push('marked');
      payload.notes.push({id:ng.key,notetype_id:ntKey,guid:String(localNote&&localNote.guid||this._legacyGuid(ng.key)),fields,tags:[...new Set(tags.map(String).filter(Boolean))]});
    }
    payload.notetypes=[...notetypeRows.values()];

    for(const group of cardGroups.values()){
      const rep=group.representative,card=rep.card,pid=rep.planId,
        sched=this._legacyScheduleRow(card,timingToday),
        deckKey=card.deckId==null?'':(deckKeyByLocal.get(localKey(pid,card.deckId))||this._legacyScopedKey('deck',pid,card.deckId)),
        originalDeckKey=card.originalDeckId==null?'':(deckKeyByLocal.get(localKey(pid,card.originalDeckId))||this._legacyScopedKey('deck',pid,card.originalDeckId));
      payload.cards.push({
        id:group.key,note_id:group.noteKey,deck_id:deckKey,template_idx:this._legacyTemplateOrd(card),
        anki_type:sched.type,anki_queue:sched.queue,anki_due:sched.due,anki_original_due:sched.odue,
        original_deck_id:originalDeckKey,new_position:card.posicaoNova,due_ts:Number(card.dueTs)||0,
        interval:Math.max(0,Number(card.intervalo)||0),ease:Number(card.ease)||2.5,
        ease_factor:Number(card.easeFactor)||0,reps:Math.max(0,Number(card.reps)||0),lapses:Math.max(0,Number(card.lapses)||0),
        remaining_steps:Math.max(0,Number(card.ankiRemainingSteps!=null?card.ankiRemainingSteps:card.remainingSteps)||0),
        flag:Math.max(0,Math.min(7,Number(card.flag)||0)),s:card.s==null?null:Number(card.s),d:card.d==null?null:Number(card.d)
      });
    }

    const revSeen=new Set(),kindMap={learning:0,review:1,relearning:2,filtered:3,manual:4,rescheduled:5};
    for(const p of plans){
      const pid=p.id,rows=pid!=null&&DB.getRevlogForPlan?DB.getRevlogForPlan(pid):this._legacyPlanRows(pid,'revlog');
      for(const r of rows||[]){
        const semantic=Number(r&&r.ankiIvlSemantica!=null?r.ankiIvlSemantica:r&&r.anki_ivl_semantica);
        if(semantic!==2)continue;
        const cardKey=cardKeyByLocal.get(localKey(pid,r.cardId));if(!cardKey)continue;
        const revKey=String(r.reviewId||'')+'|'+cardKey+'|'+String(r.ts||'')+'|'+String(r.grade||'');
        if(revSeen.has(revKey))continue;revSeen.add(revKey);
        const rawKind=r.ankiReviewKind!=null?r.ankiReviewKind:r.anki_review_kind,
          reviewKind=Number.isFinite(Number(rawKind))?Number(rawKind):(kindMap[String(rawKind||'review').toLowerCase()]??1);
        payload.revlog.push({
          card_id:cardKey,ts:Math.max(1,Number(r.ts)||Date.now()),grade:Math.max(0,Math.min(4,Number(r.grade)||0)),
          anki_interval:Number(r.ankiInterval!=null?r.ankiInterval:r.anki_interval)||0,
          anki_last_interval:Number(r.ankiLastInterval!=null?r.ankiLastInterval:r.anki_last_interval)||0,
          ease_factor:Math.max(0,Number(r.easeFactor!=null?r.easeFactor:r.ease_factor)||0),
          time:Math.max(0,Number(r.time)||0),anki_review_kind:reviewKind,anki_ivl_semantica:2
        });
      }
    }
    return {payload,cardRefs,deckRefs,noteRefs};
  },
  _studyMetaFromState(state){
    try{
      const raw=state&&state.custom_data;if(!raw)return{};
      const parsed=typeof raw==='string'?JSON.parse(raw):raw;
      return parsed&&parsed.study&&typeof parsed.study==='object'?parsed.study:{};
    }catch(_){return{};}
  },
  _studyTargetsForState(state,fallbackPlanId){
    const meta=this._studyMetaFromState(state),out=[],seen=new Set(),push=(planId,seed)=>{
      const pid=planId!=null?planId:fallbackPlanId,k=String(pid==null?'':pid);
      if(seen.has(k))return;seen.add(k);out.push({planId:pid,seed:seed||{}});
    };
    for(const rep of this._replicas(state&&state.id)||[])push(rep._planId,Object.assign({},rep));
    // Compatibilidade somente de leitura com experiências antigas que tenham
    // gravado um payload Study pequeno em custom_data. Novas migrações nunca
    // escrevem metadados da casca nesse campo do Anki (<100 bytes).
    if(Array.isArray(meta.replicas)){
      for(const r of meta.replicas||[])if(r&&typeof r==='object')push(r.planId,{
        localId:r.localId,deckId:r.localDeckId,materia:r.materia||null,assunto:r.assunto||'',materiaTec:r.materiaTec||'',banca:r.banca||'',tipo:r.tipo||'',favorito:!!r.favorito
      });
    }
    if(!out.length)push(fallbackPlanId,{
      materia:meta.materia||null,assunto:meta.assunto||'',materiaTec:meta.materiaTec||'',banca:meta.banca||'',tipo:meta.tipo||'',favorito:!!meta.favorito
    });
    return out;
  },
  _studySeedForState(state,planId){
    const target=this._studyTargetsForState(state,planId).find(x=>String(x.planId==null?'':x.planId)===String(planId==null?'':planId));
    return target?target.seed:{};
  },
  async _recoverLegacyIdentityFromOfficialState(state){
    const allLocal=window.StudyGlobalScope&&StudyGlobalScope.allBy?StudyGlobalScope.allBy('cards'):(this._scopeCards()||[]),
      officialIds=new Set((state&&state.cards||[]).map(card=>String(card.id))),
      pending=(allLocal||[]).filter(card=>!officialIds.has(String(card&&card.ankiId)));
    if(!pending.length||!state||!Array.isArray(state.notes)||!Array.isArray(state.cards))return 0;
    const timingToday=Number(state.reviewer&&state.reviewer.timing&&state.reviewer.timing.today)||0,
      snapshot=this._legacyMigrationSnapshot(timingToday),
      legacyNotes=new Map((snapshot.payload.notes||[]).map(n=>[String(n.id),n])),
      officialNotesByGuid=new Map((state.notes||[]).filter(n=>n&&n.guid).map(n=>[String(n.guid),n])),
      officialCardsByNoteOrd=new Map((state.cards||[]).map(card=>[String(card.note_id)+'|'+String(Number(card.template_idx)||0),card])),
      claimed=new Map();
    let recovered=0;
    for(const row of snapshot.payload.cards||[]){
      const refs=(snapshot.cardRefs.get(row.id)||[]).filter(ref=>!officialIds.has(String(ref&&ref.card&&ref.card.ankiId)));
      if(!refs.length)continue;
      const legacyNote=legacyNotes.get(String(row.note_id)),
        officialNote=legacyNote&&officialNotesByGuid.get(String(legacyNote.guid||'')),
        officialCard=officialNote&&officialCardsByNoteOrd.get(String(officialNote.id)+'|'+String(Number(row.template_idx)||0));
      if(!officialCard)continue;
      const claim=claimed.get(String(officialCard.id));
      if(claim&&claim!==String(row.id))throw new Error('Recuperação da migração oficial ambígua para o card '+officialCard.id+'.');
      claimed.set(String(officialCard.id),String(row.id));
      for(const ref of refs){
        const patch={ankiId:Number(officialCard.id),ankiNoteId:Number(officialNote.id),ankiTemplateOrd:Number(officialCard.template_idx)||0};
        const saved=window.StudyGlobalScope&&StudyGlobalScope.updateCardScoped
          ?StudyGlobalScope.updateCardScoped(ref.card,patch,ref.planId):DB.updateCard(ref.localId,patch);
        if(saved===false)throw new Error('Falha ao recuperar identidade oficial do card legado '+String(ref.localId)+'.');
        recovered++;
      }
    }
    return recovered;
  },

  async _applyLegacyMigration(out,snapshot){
    if(!out||!out.ok||!out.state)throw new Error('O Anki oficial não confirmou a migração dos Cards legados.');
    this.timing=out.state.reviewer&&out.state.reviewer.timing||this.timing||null;
    const decksById=new Map((out.state.decks||[]).map(x=>[String(x.id),x])),
      cardsById=new Map((out.state.cards||[]).map(x=>[String(x.id),x]));
    for(const [legacy,oid] of Object.entries(out.deck_map||{})){
      const row=decksById.get(String(oid));if(!row)continue;
      for(const ref of snapshot.deckRefs.get(legacy)||[])this._saveNormalDeckMirror(row,ref.planId,ref.localId);
    }
    for(const [legacy,oid] of Object.entries(out.card_map||{})){
      const state=cardsById.get(String(oid));if(!state)continue;
      for(const ref of snapshot.cardRefs.get(legacy)||[]){
        const patch=Object.assign(this._statePatch(state,ref.card),{noteId:Number(state.note_id),ankiNoteId:Number(state.note_id),ankiId:Number(state.id)});
        const saved=window.StudyGlobalScope&&StudyGlobalScope.updateCardScoped
          ?StudyGlobalScope.updateCardScoped(ref.card,patch,ref.planId):DB.updateCard(ref.localId,patch);
        if(saved===false)throw new Error('Falha ao vincular card legado '+ref.localId+' ao card oficial '+oid+'.');
      }
    }
    await this._syncOfficialFullState(out.state,this._activePlanId());
    return out;
  },
  async _migrateLegacyCollection(){
    const emptyState=await this.request('/api/cards-official/collection/state'),
      timingToday=Number(emptyState&&emptyState.reviewer&&emptyState.reviewer.timing&&emptyState.reviewer.timing.today)||0,
      snapshot=this._legacyMigrationSnapshot(timingToday);
    if(!snapshot.payload.cards.length)return null;
    const out=await this.request('/api/cards-official/migrate/legacy',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot.payload)
    });
    await this._applyLegacyMigration(out,snapshot);
    return out;
  },

  async bootstrap(force){
    if(this._bootPromise)return this._bootPromise;
    if(this.ready&&!this.dirty&&!force)return this.review;
    this._bootPromise=(async()=>{
      if(!this.api().token())throw new Error('Entre na conta do Study para usar o motor oficial do Anki.');
      const status=await this.request('/api/cards-official/status'),
        localCount=window.StudyGlobalScope&&StudyGlobalScope.allBy?StudyGlobalScope.allBy('cards').length:(this._scopeCards()||[]).length,
        officialCount=Math.max(Number(status&&status.cards)||0,Number(status&&status.notes)||0);
      let state=null;
      if(!officialCount&&localCount){
        const migrated=await this._migrateLegacyCollection();
        state=migrated&&migrated.state||null;
        if(!state)throw new Error('A migração oficial dos Cards legados não devolveu o snapshot da Collection.');
      }else{
        state=await this.request('/api/cards-official/collection/full-state');
        if(localCount){
          await this._recoverLegacyIdentityFromOfficialState(state);
          const timingToday=Number(state.reviewer&&state.reviewer.timing&&state.reviewer.timing.today)||0,
            snapshot=this._legacyMigrationSnapshot(timingToday),
            officialIds=new Set((state.cards||[]).map(card=>String(card.id))),
            pending=(snapshot.payload.cards||[]).filter(row=>(snapshot.cardRefs.get(row.id)||[]).some(ref=>!officialIds.has(String(ref.card.ankiId)))),
            pendingNotes=new Set(pending.map(row=>String(row.note_id)));
          if(pending.length){
            snapshot.payload.cards=pending;
            snapshot.payload.notes=snapshot.payload.notes.filter(row=>pendingNotes.has(String(row.id)));
            snapshot.payload.reconcile=true;
            const reconciled=await this.request('/api/cards-official/migrate/legacy',{
              method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot.payload)
            });
            await this._applyLegacyMigration(reconciled,snapshot);
            state=reconciled.state;
          }
        }
      }
      this.preferences=await this.request('/api/cards-official/preferences');
      await this._syncOfficialFullState(state,this._activePlanId());
      this.ready=true;this.dirty=false;this._sessionAnswered=0;this._sessionStartTotal=null;
      this._undo=[];this._redo=[];this._applyReviewer(state.reviewer||{finished:true,counts:{},queue_ids:[]});
      return this.review;
    })().finally(()=>{this._bootPromise=null;});
    return this._bootPromise;
  },

  _applyReviewer(q){
    this.review=q||{finished:true,counts:{},queue_ids:[]};
    this.counts=Object.assign({new:0,learning:0,review:0},this.review.counts||{});
    this.timing=this.review.timing||this.timing||null;
    const mapped=[];
    for(const oid of this.review.queue_ids||[]){
      const local=this._localForOfficialId(oid);
      if(!local)throw new Error('Fila oficial retornou card '+oid+' sem identidade correspondente no Study.');
      mapped.push(local.id);
    }
    CardsScreen._reviewQueue=mapped;
    CardsScreen._reviewIdx=0;
    CardsScreen._flipped=false;
    CardsScreen._reviewCardId=mapped[0]||null;
    CardsScreen._reviewStartedAt=Date.now();
    CardsScreen._answerShownAt=null;
    const remaining=Number(this.counts.new||0)+Number(this.counts.learning||0)+Number(this.counts.review||0);
    if(this._sessionStartTotal==null)this._sessionStartTotal=Math.max(1,remaining);
    this._sessionStartTotal=Math.max(this._sessionStartTotal,this._sessionAnswered+remaining);
  },

  async renderRevisar(box){
    if(!box)return;
    const token=++this._renderEpoch;
    if(!this._renderStillCurrent(token,'revisar',box))return;
    if(!CardsScreen.collectionCards().length){
      box.innerHTML=CardsScreen.emptyState('Nenhum card ainda','Clique em <strong>＋ Criar card</strong> no topo para começar.');
      return;
    }
    box.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">⏳</div><h3>Preparando revisão oficial…</h3><p>Fila, rendering e intervalos vêm do Anki 26.09.3.</p></div></div>';
    try{
      await this.bootstrap(false);if(!this._renderStillCurrent(token,'revisar',box))return;
      await this._syncReviewScope(this.review&&this.review.review_scope&&!this.review.review_scope.all_decks?Number(this.review.review_scope.selected_deck_id):0);
      if(!this._renderStillCurrent(token,'revisar',box))return;
      await this.renderCurrent(box,token);
    }catch(e){
      if(!this._renderStillCurrent(token,'revisar',box))return;
      console.error('Cards official bridge:',e);
      box.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">⚠</div><h3>Motor oficial indisponível</h3><p>'+
        escapeHtml(e&&e.message?e.message:String(e))+'</p><p class="hint">O Anki não caiu para um scheduler aproximado.</p>'+
        '<button type="button" class="btn-secondary" id="cards-official-retry">Tentar novamente</button></div></div>';
      const b=document.getElementById('cards-official-retry');if(b)b.onclick=()=>{this.invalidate('retry');void this.renderRevisar(box);};
    }
  },

  async _frame(html,token){
    const frame=document.getElementById('cards-official-frame');if(!frame)return;
    const epoch=token==null?this._renderEpoch:token,srcdoc=await this.htmlWithMedia(html);
    if(!this._renderStillCurrent(epoch,'revisar',document.getElementById('cards-content')))return;
    const current=document.getElementById('cards-official-frame');if(current)current.srcdoc=srcdoc;
  },
  _flagButtons(flag){
    const colors=['','#e0393f','#d97a12','#0f9d63','#2563eb','#7c3aed','#db2777','#06b6d4'];
    return [1,2,3,4,5,6,7].map(n=>'<button type="button" class="anki-study-flag '+(Number(flag)===n?'on':'')+
      '" data-cards-official-flag="'+n+'" style="--fl:'+colors[n]+'" title="Bandeira '+n+'"></button>').join('');
  },
  _clearReviewerAutomation(){
    this._autoToken++;
    clearTimeout(this._autoTimer);clearInterval(this._timerTick);
    this._autoTimer=null;this._timerTick=null;
  },
  _elapsedMs(auto){
    auto=auto||{};
    const start=Number(CardsScreen._reviewStartedAt)||Date.now(),
      end=(auto.stop_timer_on_answer&&CardsScreen._answerShownAt)?Number(CardsScreen._answerShownAt):Date.now();
    let ms=Math.max(0,end-start),cap=Math.max(0,Number(auto.max_answer_seconds)||0)*1000;
    if(cap>0)ms=Math.min(ms,cap);
    return Math.round(ms);
  },
  _reviewUiActive(cardId,sessionVersion){
    return this._screenActive('revisar')&&!!this.review&&!!this.review.card&&
      Number(this.review.card.id)===Number(cardId)&&
      (!sessionVersion||sessionVersion===this._reviewSessionVersion);
  },
  _runWhenAudioReady(auto,token,cardId,sessionVersion,fn){
    if(token!==this._autoToken||!this._autoAdvanceEnabled||!this._reviewUiActive(cardId,sessionVersion))return;
    if(auto&&auto.wait_for_audio&&this.isAvPlaying()){
      this._autoTimer=setTimeout(()=>this._runWhenAudioReady(auto,token,cardId,sessionVersion,fn),250);return;
    }
    if(this._reviewUiActive(cardId,sessionVersion))fn();
  },
  _armReviewerAutomation(oc,answerSide){
    this._clearReviewerAutomation();if(!oc)return;
    const auto=oc.auto_advance||{},token=this._autoToken,cardId=Number(oc.id),sessionVersion=this._reviewSessionVersion,timer=document.getElementById('cards-review-timer');
    if(timer&&auto.show_timer){
      const tick=()=>{if(token===this._autoToken)timer.textContent=(this._elapsedMs(auto)/1000).toFixed(1)+'s';};
      tick();this._timerTick=setInterval(tick,250);
    }
    const btn=document.getElementById('cards-auto-advance');
    if(btn){btn.classList.toggle('on',this._autoAdvanceEnabled);btn.setAttribute('aria-pressed',String(this._autoAdvanceEnabled));btn.textContent=this._autoAdvanceEnabled?'⏩ Auto ligado':'⏩ Auto';}
    if(!this._autoAdvanceEnabled)return;
    const seconds=Number(answerSide?auto.seconds_to_show_answer:auto.seconds_to_show_question)||0;
    if(!(seconds>0))return;
    this._autoTimer=setTimeout(()=>this._runWhenAudioReady(auto,token,cardId,sessionVersion,()=>{
      if(token!==this._autoToken||!this._reviewUiActive(cardId,sessionVersion))return;
      if(!answerSide){
        if(Number(auto.question_action)===0)void this.showAnswer();
        else showToast('⏰ Lembrete do Auto Advance');
        return;
      }
      switch(Number(auto.answer_action)){
        case 0:void this.action('bury');break;
        case 1:void this.answer(1);break;
        case 2:void this.answer(3);break;
        case 3:void this.answer(2);break;
        default:showToast('⏰ Lembrete do Auto Advance');
      }
    }),seconds*1000);
  },
  toggleAutoAdvance(force){
    this._autoAdvanceEnabled=typeof force==='boolean'?force:!this._autoAdvanceEnabled;
    if(!this._autoAdvanceEnabled)this._clearReviewerAutomation();
    const oc=this.review&&this.review.card;if(oc)this._armReviewerAutomation(oc,!!CardsScreen._flipped);
    showToast(this._autoAdvanceEnabled?'⏩ Auto Advance ligado':'⏸ Auto Advance desligado');
    return this._autoAdvanceEnabled;
  },

  async renderCurrent(box,token){
    box=box||document.getElementById('cards-content');if(!box)return;
    if(token==null)token=++this._renderEpoch;
    if(!this._renderStillCurrent(token,'revisar',box))return;
    const q=this.review,scope=q&&q.review_scope||{},decks=scope.decks||[];
    const inventory=scope.inventory||{};
    const scopeHtml='<div class="card cards-review-scope"><div class="cards-review-scope-switch"><button type="button" class="btn-secondary" data-review-plan-scope="plan">Este planejamento</button><button type="button" class="btn-secondary" data-review-plan-scope="all">Todos os planejamentos</button></div><label for="cards-review-deck">Baralho da revisão</label><select id="cards-review-deck">'+
      '<option value="0"'+(scope.all_decks?' selected':'')+'>Todos os baralhos — continuar nos próximos</option>'+
      decks.map(d=>'<option value="'+Number(d.deck_id)+'"'+(!scope.all_decks&&Number(d.deck_id)===Number(scope.selected_deck_id)?' selected':'')+'>'+escapeHtml(d.name)+' · '+Number(d.total_including_children||0)+' cards</option>').join('')+'</select>'+
      '<p class="cards-review-scope-label">'+escapeHtml(scope.label||'Planejamento atual')+'</p>'+
      '<div class="cards-review-totals"><span><strong>'+Number(scope.total_cards||0)+'</strong> cards no escopo</span><span><strong>'+Number(inventory.new||0)+'</strong> novos</span><span><strong>'+Number(inventory.learning||0)+'</strong> em aprendizado</span><span><strong>'+Number(inventory.review||0)+'</strong> em revisão</span></div></div>';
    const bindScope=()=>{
      box.querySelectorAll('[data-review-plan-scope]').forEach(button=>{
        button.classList.toggle('active',StudyGlobalScope.cardsScope()===button.dataset.reviewPlanScope);
        button.setAttribute('aria-pressed',String(StudyGlobalScope.cardsScope()===button.dataset.reviewPlanScope));
        button.onclick=async()=>{
          try{StudyGlobalScope.setCardsScope(button.dataset.reviewPlanScope);document.querySelectorAll('#cards-scope-toggle [data-scope]').forEach(b=>b.classList.toggle('active',b.dataset.scope===StudyGlobalScope.cardsScope()));await this._syncReviewScope(0);await this.renderCurrent(box);}
          catch(e){showToast(e.message);}
        };
      });
      const select=document.getElementById('cards-review-deck');
      if(select)select.onchange=async()=>{
        try{
          const review=await this._syncReviewScope(Number(select.value));
          this._applyReviewer(review);await this.renderCurrent(box);
        }catch(e){showToast(e.message);}
      };
    };
    if(!q||q.finished||!q.card){
      CardsScreen._reviewQueue=[];CardsScreen._reviewIdx=0;CardsScreen._flipped=false;
      const answered=Number(this._sessionAnswered)||0;
      box.innerHTML=scopeHtml+'<div class="card"><div class="cards-review-done"><div class="big">'+(answered?'🎉':'📚')+'</div><h3>'+(answered?'Sessão concluída!':'Nenhum card disponível agora')+'</h3>'+
        '<p>'+answered+' respondidos · 0 disponíveis agora.</p><p>'+(answered?'A fila oficial do Anki não possui mais cards disponíveis agora.':'O baralho selecionado não tem cards disponíveis na fila oficial. Datas de revisão, limites diários, suspensão e enterramento podem limitar a fila.')+'</p>'+
        '<button type="button" class="btn-primary" id="cards-official-restart">Ver se há mais</button></div></div>';
      const rb=document.getElementById('cards-official-restart');if(rb)rb.onclick=async()=>{try{
        const qs=new URLSearchParams({session_id:this._reviewSession()});
        const next=await this.request('/api/cards-official/reviewer/next?'+qs.toString());
        this._reviewSessionVersion=next&&next.review_session?next.review_session.version:this._reviewSessionVersion;
        this._applyReviewer(next);await this.renderCurrent(box);
      }catch(e){showToast(e.message);}};
      bindScope();CardsScreen.updateFavCount();CardsScreen.atualizarFoco();return;
    }
    const oc=q.card,local=this._localForOfficialId(oc.id);
    if(!local)throw new Error('Card oficial '+oc.id+' não foi localizado no Study.');
    const remaining=Number(this.counts.new||0)+Number(this.counts.learning||0)+Number(this.counts.review||0);
    const pct=Math.max(0,Math.min(100,Math.round((this._sessionAnswered/Math.max(1,this._sessionStartTotal||remaining||1))*100)));
    const typeInput=oc.type_answer&&oc.type_answer.enabled
      ? '<div class="anki-type-answer-input-wrap"><input id="cards-official-type-answer" type="text" autocomplete="off" spellcheck="false" placeholder="Digite a resposta"></div>' : '';
    box.innerHTML=scopeHtml+'<div class="card cards-review-wrap anki-study-review-card">'+
      '<div class="cards-review-progress"><span>'+this._sessionAnswered+' respondidos · '+remaining+' restantes · '+pct+'%</span>'+
      '<div class="cards-review-bar"><div style="width:'+pct+'%"></div></div>'+
      '<span class="cards-limit-chip cards-due-counts" title="Disponíveis agora na fila oficial">Novos: '+this.counts.new+' · Aprendizado: '+this.counts.learning+' · Revisões: '+this.counts.review+'</span>'+
      ((oc.auto_advance||{}).show_timer?'<span class="cards-limit-chip" id="cards-review-timer">0.0s</span>':'')+'</div>'+
      '<div class="cards-review-meta"><span class="lei-tag mat">'+escapeHtml(CardsScreen.materiaLabel(local))+'</span>'+
      (local.assunto?'<span class="lei-tag ref">'+escapeHtml(local.assunto)+'</span>':'')+
      (local.tipo?'<span class="cards-type-tag">'+escapeHtml(local.tipo)+'</span>':'')+
      '<button type="button" class="cards-fav-star '+(oc.marked?'on':'')+'" id="cards-act-mark" title="Marcar/desmarcar nota">'+(oc.marked?'★':'☆')+'</button></div>'+
      '<div class="cards-face cards-front anki-study-review-face" id="cards-official-face"><iframe class="anki-study-card-frame" id="cards-official-frame" sandbox="allow-scripts" title="Card Anki"></iframe></div>'+
      typeInput+
      '<div class="cards-review-actions anki-study-review-actions" id="cards-review-actions"><button type="button" class="btn-primary cards-flip" id="cards-flip">Mostrar resposta <kbd>Espaço</kbd></button></div>'+
      '<div class="cards-review-nav">'+
        '<button type="button" class="icon-btn cards-review-edit" id="cards-review-edit">✎ Editar</button>'+
        '<button type="button" class="icon-btn" id="cards-act-bury">⤓ Enterrar</button>'+
        '<button type="button" class="icon-btn" id="cards-act-susp">🚫 Suspender</button>'+
        '<button type="button" class="icon-btn" id="cards-act-forget">↺ Esquecer</button>'+
        '<button type="button" class="icon-btn" id="cards-act-due">📅 Data</button>'+
        '<button type="button" class="icon-btn" id="cards-act-info">ℹ Info</button>'+
        '<button type="button" class="icon-btn" id="cards-auto-advance" aria-pressed="'+String(this._autoAdvanceEnabled)+'">'+(this._autoAdvanceEnabled?'⏩ Auto ligado':'⏩ Auto')+'</button>'+
        '<span class="cards-flagbar">'+this._flagButtons(oc.flag)+'</span>'+
      '</div>'+
      '<div class="cards-kbd-hint-row"><span class="cards-kbd-hint"><kbd>Espaço</kbd> resposta · <kbd>1</kbd>–<kbd>4</kbd> avaliar · <kbd>Ctrl+Z</kbd> desfazer</span></div>'+
    '</div>';

    bindScope();
    const question=(oc.type_answer&&oc.type_answer.enabled&&oc.type_answer.question_html)||oc.question||'';
    await this._frame(question,token);
    void this.playAv(oc.question_av_tags||[]);
    const flip=document.getElementById('cards-flip');if(flip)flip.onclick=()=>void this.showAnswer();
    const edit=document.getElementById('cards-review-edit');if(edit)edit.onclick=()=>CardsScreen.openCardModal(local.id);
    const info=document.getElementById('cards-act-info');if(info)info.onclick=()=>CardsScreen.cardInfo(local);
    const autoBtn=document.getElementById('cards-auto-advance');if(autoBtn)autoBtn.onclick=()=>this.toggleAutoAdvance();
    const bury=document.getElementById('cards-act-bury');if(bury)bury.onclick=()=>void this.action('bury');
    const susp=document.getElementById('cards-act-susp');if(susp)susp.onclick=()=>void this.action('suspend');
    const forget=document.getElementById('cards-act-forget');if(forget)forget.onclick=()=>void this.action('forget');
    const due=document.getElementById('cards-act-due');if(due)due.onclick=()=>void this.setDue();
    const mark=document.getElementById('cards-act-mark');if(mark)mark.onclick=()=>void this.mark();
    box.querySelectorAll('[data-cards-official-flag]').forEach(b=>b.onclick=()=>void this.action('flag',Number(b.dataset.cardsOfficialFlag)));
    const ti=document.getElementById('cards-official-type-answer');if(ti)setTimeout(()=>{try{ti.focus();}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-type-answer-focus');}},0);
    CardsScreen.atualizarFoco();this._armReviewerAutomation(oc,false);
  },

  async showAnswer(){
    if(!this.review||!this.review.card||CardsScreen._flipped)return;
    const oc=this.review.card;let html=oc.answer||'';
    if(oc.type_answer&&oc.type_answer.enabled){
      const inp=document.getElementById('cards-official-type-answer'),provided=inp?inp.value:'';
      const cmp=await this.request('/api/cards-official/reviewer/type-answer/'+encodeURIComponent(oc.id),{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provided})
      });
      if(cmp&&cmp.answer_html!=null)html=cmp.answer_html;
    }
    CardsScreen._flipped=true;CardsScreen._answerShownAt=Date.now();
    const face=document.getElementById('cards-official-face');if(face){face.classList.remove('cards-front');face.classList.add('cards-back');}
    const ti=document.getElementById('cards-official-type-answer');if(ti)ti.style.display='none';
    await this._frame(html);
    const actions=document.getElementById('cards-review-actions');
    if(actions){
      const names=['Errei','Difícil','Bom','Fácil'],classes=['a-errei','a-dificil','a-bom','a-facil'];
      actions.innerHTML=(oc.buttons||[]).map(b=>'<button type="button" class="cards-ans4 '+(classes[b.rating-1]||'')+'" data-g="'+b.rating+'">'+
        '<span class="a-kbd">'+b.rating+'</span><strong>'+(names[b.rating-1]||b.rating)+'</strong><span>'+escapeHtml(b.label||'')+'</span></button>').join('');
      actions.querySelectorAll('[data-g]').forEach(b=>b.onclick=()=>void this.answer(Number(b.dataset.g)));
    }
    void this.playAv(oc.answer_av_tags||[]);this._armReviewerAutomation(oc,true);
  },

  _phase(type,queue){
    type=Number(type);queue=Number(queue);
    if(type===0)return'new';if(type===3)return'relearning';if(type===1)return'learning';return'review';
  },
  _statePatch(state,local){
    const queue=Number(state.queue),phase=this._phase(state.type,queue),mem=state.memory_state||{},timing=this.timing||{};
    const planId=local&&local._planId!=null?local._planId:(window.StudyGlobalScope&&StudyGlobalScope.sourcePlanForCard?StudyGlobalScope.sourcePlanForCard(local.id):null);
    const patch={
      ankiId:Number(state.id),ankiNoteId:Number(state.note_id),ankiTemplateOrd:Number(state.template_idx)||0,
      ankiMod:Number(state.mtime_secs)||Math.floor(Date.now()/1000),ankiDue:Number(state.due)||0,
      ankiType:Number(state.type)||0,ankiQueue:Number(state.queue)||0,
      ankiRemainingSteps:Number(state.remaining_steps)||0,ankiOriginalDue:Number(state.original_due)||0,
      phase,intervalo:Math.max(0,Number(state.interval)||0),ease:(Number(state.ease_factor)||2500)/1000,
      reps:Math.max(0,Number(state.reps)||0),lapses:Math.max(0,Number(state.lapses)||0),
      s:mem.stability==null?null:Number(mem.stability),d:mem.difficulty==null?null:Number(mem.difficulty),
      flag:Math.max(0,Math.min(7,Number(state.flag)||0)),dueTs:null,
      frente:state.question==null?local.frente:String(state.question),verso:state.answer==null?local.verso:String(state.answer),
      suspenso:queue===-1,enterradoAte:null,buryKind:null,
      lastReviewTs:state.last_review_time?Number(state.last_review_time)*1000:null
    };
    patch.deckId=this._localDeckId(state.deck_id,planId,local.deckId)||local.deckId;
    if(state.original_deck_id){
      patch.originalDeckId=this._localDeckId(state.original_deck_id,planId,local.originalDeckId||local.deckId);
      patch.filteredDeckId=patch.deckId;patch.originalPhase=this._phase(state.type,state.queue);
    }else{
      patch.originalDeckId=null;patch.filteredDeckId=null;patch.originalPhase=null;patch.originalDueTs=null;
    }
    if(patch.lastReviewTs){
      patch.lastReview=typeof diaDeEstudoDe==='function'?diaDeEstudoDe(patch.lastReviewTs):new Date(patch.lastReviewTs).toISOString().slice(0,10);
      if(!local.firstReviewAt)patch.firstReviewAt=new Date(patch.lastReviewTs).toISOString();
    }
    if(phase==='new'){
      patch.posicaoNova=Number(state.due)||0;patch.due=todayCards();
    }else if(queue===1||queue===4){
      patch.dueTs=Math.max(0,Number(state.due)||0)*1000;patch.due=todayCards();
    }else{
      const delta=Number(state.due)-(Number(timing.today)||0);
      patch.due=this._addDays(todayCards(),Number.isFinite(delta)?delta:0);
    }
    if(queue===-2||queue===-3){
      patch.enterradoAte=this._addDays(todayCards(),1);
      patch.buryKind=queue===-2?'scheduler':'user';
    }
    if(state.original_due){
      if(Number(state.type)===0){
        patch.originalDue=todayCards();patch.posicaoNova=Math.max(0,Number(state.original_due)||0);patch.originalDueTs=null;
      }else if(queue===1||queue===3||queue===4){
        patch.originalDue=todayCards();patch.originalDueTs=Math.max(0,Number(state.original_due)||0)*1000;
      }else{
        const delta=Number(state.original_due)-(Number(timing.today)||0);
        patch.originalDue=this._addDays(todayCards(),Number.isFinite(delta)?delta:0);patch.originalDueTs=null;
      }
    }else patch.originalDue=null;
    return patch;
  },
  _ivlFromSeconds(sec){
    sec=Math.max(0,Math.round(Number(sec)||0));
    if(sec&&sec%86400===0)return sec/86400;
    return sec?-sec:0;
  },
  _revKind(n){return({0:'learning',1:'review',2:'relearning',3:'filtered',4:'manual',5:'rescheduled'})[Number(n)]||'review';},
  _revEntry(entry,local){
    if(!entry)return null;
    const ts=Math.max(0,Number(entry.time)||0)*1000,kind=this._revKind(entry.review_kind),mem=entry.memory_state||{};
    return {
      _planId:local._planId,ts:ts||Date.now(),date:typeof diaDeEstudoDe==='function'?diaDeEstudoDe(ts||Date.now()):new Date(ts||Date.now()).toISOString().slice(0,10),
      cardId:local.id,grade:Number(entry.button_chosen)||0,acerto:Number(entry.button_chosen)>1,
      phase:kind,time:Math.round((Number(entry.taken_secs)||0)*1000),elapsed:Math.max(0,Number(local.intervalo)||0),
      intervalo:this._ivlFromSeconds(entry.last_interval),lastInterval:this._ivlFromSeconds(entry.last_interval),
      ankiInterval:this._ivlFromSeconds(entry.interval),ankiLastInterval:this._ivlFromSeconds(entry.last_interval),
      ankiReviewKind:kind,ankiIvlSemantica:2,easeFactor:Number(entry.ease)||2500,
      s:mem.stability==null?null:Number(mem.stability),d:mem.difficulty==null?null:Number(mem.difficulty),
      officialReviewTime:Number(entry.time)||0
    };
  },
  async _persistAnswered(state,recordUndo){
    const replicas=this._replicas(state.id);
    if(!replicas.length)throw new Error('Resposta oficial sem réplica local para '+state.id+'.');
    const entry=state.review_logs&&state.review_logs[0],txn={officialId:Number(state.id),items:[],rows:[]};
    try{
      for(const replica of replicas){
        const before=JSON.parse(JSON.stringify(replica)),patch=this._statePatch(state,replica);
        const after=Object.assign({},replica,patch,{updatedAt:new Date().toISOString()});
        const pos=window.StudyGlobalScope&&StudyGlobalScope.cardPosition?StudyGlobalScope.cardPosition(replica.id,replica._planId):1;
        const rev=this._revEntry(entry,replica);
        let row=null;
        if(rev){
          row=await DB.addRevlogDurable(rev,after,pos);
          if(row===false)throw new Error('Falha ao journalar a revisão oficial.');
          txn.rows.push(row);
        }
        const saved=window.StudyGlobalScope&&StudyGlobalScope.updateCardScoped
          ?StudyGlobalScope.updateCardScoped(replica,patch,replica._planId):DB.updateCard(replica.id,patch);
        if(saved===false)throw new Error('Falha ao persistir o estado oficial no Study.');
        txn.items.push({replica,before,patch});
      }
      DB.kickRevlogDuravel();
      if(recordUndo!==false){this._undo.push(txn);if(this._undo.length>50)this._undo.shift();this._redo=[];}
      return txn;
    }catch(e){
      for(const row of txn.rows)try{await DB.cancelarRevlogDurable(row);}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-cancel');}
      for(const it of txn.items)try{StudyGlobalScope.updateCardScoped(it.replica,it.before,it.replica._planId);}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-rollback');}
      throw e;
    }
  },
  async _syncStates(states){
    for(const state of states||[]){
      for(const replica of this._replicas(state.id)){
        const patch=this._statePatch(state,replica);
        const saved=window.StudyGlobalScope&&StudyGlobalScope.updateCardScoped
          ?StudyGlobalScope.updateCardScoped(replica,patch,replica._planId):DB.updateCard(replica.id,patch);
        if(saved===false)throw new Error('Falha ao sincronizar ação oficial no Study.');
      }
    }
  },


  _activePlanId(){
    try{return window.StudyGlobalScope&&StudyGlobalScope.activePlanId?StudyGlobalScope.activePlanId():DB._activePlanId();}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-active-plan');return null;}
  },
  _filteredConfigFromOfficial(row){
    const f=row&&row.filtered_deck?row.filtered_deck:row||{},cfg=f.config||{};
    return {
      reschedule:cfg.reschedule!==false,
      searchTerms:(cfg.search_terms||[]).map(t=>({
        search:String(t&&t.search||''),
        limit:Math.max(0,Math.round(Number(t&&t.limit)||0)),
        order:Math.max(0,Math.round(Number(t&&t.order)||0))
      })),
      delays:Array.isArray(cfg.delays)?cfg.delays.map(Number).filter(Number.isFinite):[],
      previewDelay:Math.max(0,Math.round(Number(cfg.preview_delay)||0)),
      previewAgainSecs:Math.max(0,Math.round(Number(cfg.preview_again_secs)||0)),
      previewHardSecs:Math.max(0,Math.round(Number(cfg.preview_hard_secs)||0)),
      previewGoodSecs:Math.max(0,Math.round(Number(cfg.preview_good_secs)||0))
    };
  },
  _saveNormalDeckMirror(row,planId,preferredLocalId){
    if(!row||row.filtered)return null;
    const oid=Number(row.id||row.deck_id);if(!Number.isFinite(oid)||oid<=0)throw new Error('Baralho oficial sem identidade válida.');
    const pid=planId!=null?planId:this._activePlanId(),
      raw=pid!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(pid,'decks'):DB.getDecks(),
      list=(raw||[]).map(x=>Object.assign({},x)),
      clean=x=>{const y=DB._semTransitorios?DB._semTransitorios(x):Object.assign({},x);delete y._planId;delete y._planNome;return y;};
    let deck=list.find(x=>String(x.ankiId!=null?x.ankiId:x.id)===String(oid));
    if(!deck&&preferredLocalId!=null)deck=list.find(x=>String(x.id)===String(preferredLocalId));
    const now=new Date().toISOString();
    if(!deck){deck={id:DB._uid(),createdAt:now};list.push(deck);}
    Object.assign(deck,{ankiId:oid,nome:String(row.name||deck.nome||'Baralho'),kind:'normal',filtered:false,updatedAt:now});
    delete deck.filteredConfig;
    const saved=pid!=null?DB._set(DB.keysForPlan(pid).decks,list.map(clean)):DB.saveDecks(list.map(clean));
    if(saved===false)throw new Error('Falha ao persistir o baralho oficial no Study.');
    return Object.assign({},deck,pid==null?{}:{_planId:pid});
  },
  _removeLocalDeckMirror(localDeckId,planId){
    const pid=planId!=null?planId:this._activePlanId(),
      raw=pid!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(pid,'decks'):DB.getDecks(),
      list=(raw||[]).filter(x=>String(x.id)!==String(localDeckId)).map(x=>{const y=Object.assign({},x);delete y._planId;delete y._planNome;return y;});
    const saved=pid!=null?DB._set(DB.keysForPlan(pid).decks,list):DB.saveDecks(list);
    if(saved===false)throw new Error('Falha ao remover o espelho local do baralho.');
    return true;
  },
  async createOfficialDeck(name,planId){
    await this.bootstrap(false);const pid=planId!=null?planId:this._activePlanId(),out=await this.request('/api/cards-official/decks',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:String(name||'').trim()})
    });
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou a criação do baralho.');
    const row=(out.state&&out.state.decks||[]).find(x=>Number(x.id||x.deck_id)===Number(out.deck_id));
    if(!row)throw new Error('O Anki oficial não devolveu o baralho criado.');
    const deck=this._saveNormalDeckMirror(row,pid,null);
    this.dirty=false;return {out,deck};
  },
  async renameOfficialDeck(localDeckId,name){
    await this.bootstrap(false);const ctx=this._deckContext(localDeckId),out=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId),{
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:String(name||'').trim()})
    });
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou o novo nome.');
    const row=(out.state&&out.state.decks||[]).find(x=>Number(x.id||x.deck_id)===Number(ctx.officialId));
    if(!row)throw new Error('Baralho renomeado não retornou no snapshot oficial.');
    const deck=row.filtered?this._saveFilteredDeckMirror(row,ctx.planId,localDeckId):this._saveNormalDeckMirror(row,ctx.planId,localDeckId);
    this.dirty=false;return {out,deck};
  },
  async deleteOfficialDeck(localDeckId){
    await this.bootstrap(false);const ctx=this._deckContext(localDeckId),out=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId),{method:'DELETE'});
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou a exclusão do baralho.');
    for(const nid of out.deleted_note_ids||[]){
      for(const note of this._noteReplicas(nid)){
        if(window.StudyGlobalScope&&typeof StudyGlobalScope._removeProjectedNote==='function')StudyGlobalScope._removeProjectedNote(note);
        else{
          const cards=AnkiProductParity._cardsForNote(note,note._planId==null?undefined:note._planId);
          if(cards.length)DB.deleteNoteByCard(cards[0].id,note._planId==null?undefined:note._planId);
        }
      }
    }
    const deletedNotes=new Set((out.deleted_note_ids||[]).map(String));
    for(const cid of out.deleted_card_ids||[]){
      for(const card of this._replicas(cid)){
        if(deletedNotes.has(String(card.ankiNoteId||card.noteId)))continue;
        DB.deleteCard(card.id,card._planId==null?undefined:card._planId);
      }
    }
    this._removeLocalDeckMirror(localDeckId,ctx.planId);
    await this._syncCollectionState(out.state,ctx.planId,null);
    this.dirty=false;this._browserCache=[];CardsScreen.invalidateReviewQueue();
    return out;
  },

  _saveFilteredDeckMirror(row,planId,preferredLocalId){
    if(!row||!row.filtered)return null;
    const oid=Number(row.id||row.deck_id||(row.filtered_deck&&row.filtered_deck.id));
    if(!Number.isFinite(oid)||oid<=0)throw new Error('Filtered deck oficial sem identidade válida.');
    const pid=planId!=null?planId:this._activePlanId(),
      raw=window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(pid,'decks'):DB.getDecks(),
      list=(raw||[]).map(x=>Object.assign({},x)),
      clean=x=>{const y=DB._semTransitorios?DB._semTransitorios(x):Object.assign({},x);delete y._planId;delete y._planNome;return y;};
    let deck=list.find(x=>String(x.ankiId!=null?x.ankiId:x.id)===String(oid));
    if(!deck&&preferredLocalId!=null)deck=list.find(x=>String(x.id)===String(preferredLocalId));
    if(!deck)deck=list.find(x=>AnkiParity.isFilteredDeck&&AnkiParity.isFilteredDeck(x)&&String(x.nome||'')===String(row.name||''));
    const now=new Date().toISOString();
    if(!deck){deck={id:DB._uid(),createdAt:now};list.push(deck);}
    Object.assign(deck,{
      ankiId:oid,nome:String(row.name||(row.filtered_deck&&row.filtered_deck.name)||deck.nome||'Baralho filtrado'),
      kind:'filtered',filtered:true,configId:null,filteredConfig:this._filteredConfigFromOfficial(row),updatedAt:now
    });
    const saved=pid!=null?DB._set(DB.keysForPlan(pid).decks,list.map(clean)):DB.saveDecks(list.map(clean));
    if(saved===false)throw new Error('Falha ao persistir o filtered deck oficial no Study.');
    return Object.assign({},deck,pid==null?{}:{_planId:pid});
  },
  async _syncCollectionState(state,preferredPlanId,preferredLocalDeckId){
    if(!state)return null;
    const decks=Array.isArray(state.decks)?state.decks:[],cards=Array.isArray(state.cards)?state.cards:[],
      mirrors=new Map();
    for(const row of decks.filter(x=>x&&x.filtered)){
      const oid=Number(row.id||row.deck_id),planIds=new Set();
      for(const cs of cards)if(Number(cs.deck_id)===oid){
        for(const replica of this._replicas(cs.id))if(replica&&replica._planId!=null)planIds.add(String(replica._planId));
      }
      if(preferredPlanId!=null)planIds.add(String(preferredPlanId));
      if(!planIds.size){
        const active=this._activePlanId();if(active!=null)planIds.add(String(active));
      }
      for(const pid of planIds){
        const mirror=this._saveFilteredDeckMirror(row,pid,preferredLocalDeckId);
        if(mirror)mirrors.set(String(pid)+'::'+String(oid),mirror);
      }
    }
    await this._syncStates(cards);
    if(state.reviewer)this._applyReviewer(state.reviewer);
    return {mirrors,decks,cards,reviewer:state.reviewer||null};
  },

  _answerRequestId(card){
    const key=['snm-cards-answer',Number(card&&card.id)||0,Number(card&&card.reps)||0,
      Number(card&&card.mtime_secs)||0,Number(card&&card.due)||0].join(':');
    let id='';
    try{id=sessionStorage.getItem(key)||'';}catch(_){/* storage opcional */}
    if(!id){
      const random=(window.crypto&&typeof window.crypto.randomUUID==='function')
        ?window.crypto.randomUUID()
        :Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
      id='answer-'+random;
      try{sessionStorage.setItem(key,id);}catch(_){/* memória da página ainda protege clique/retry imediato */}
    }
    return {id,key};
  },
  _finishAnswerRequest(attempt){
    if(!attempt)return;
    try{if(sessionStorage.getItem(attempt.key)===attempt.id)sessionStorage.removeItem(attempt.key);}catch(_){/* opcional */}
  },
  async answer(grade){
    if(this._answering)return false;
    const rating=typeof grade==='number'?grade:({errei:1,dificil:2,bom:3,facil:4})[grade];
    if(!rating||!this.review||!this.review.card||!this._screenActive('revisar'))return false;
    this._answering=true;this._clearReviewerAutomation();
    const current=this.review.card,attempt=this._answerRequestId(current),requestId=attempt.id;
    try{
      const ms=this._elapsedMs((current&&current.auto_advance)||{});
      const out=await this.request('/api/cards-official/reviewer/answer',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          session_id:this._reviewSession(),session_version:String(this._reviewSessionVersion||''),request_id:requestId,card_id:Number(current.id),
          rating,milliseconds_taken:Math.max(0,Math.round(ms||0))
        })
      });
      let txn=null;
      try{
        txn=await this._persistAnswered(out.answered,true);
        if(txn){
          txn.undoStep=Number(out.undo_status&&out.undo_status.last_step)||null;
          txn.undoLabel=String(out.undo_status&&out.undo_status.undo||'');
        }
      }catch(localError){
        try{await this.request('/api/cards-official/history/undo',{method:'POST'});}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-compensate');}
        try{await this._syncReviewScope(0);}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-compensate-rescope');}
        throw localError;
      }
      this._sessionAnswered++;
      if(out.reviewer){
        this._reviewSessionVersion=out.reviewer.review_session?out.reviewer.review_session.version:this._reviewSessionVersion;
        this._applyReviewer(out.reviewer);
      }else await this._syncReviewScope(0);
      this._finishAnswerRequest(attempt);
      if(this._screenActive('revisar'))await this.renderCurrent(document.getElementById('cards-content'));
      CardsScreen.updateFavCount();return true;
    }catch(e){
      const msg=String(e&&e.message||e||'');
      const stale=Number(e&&e.status)===409&&(
        /sessão de revisão (?:expirada|foi atualizada)/i.test(msg)||
        /card atual (?:desta sessão|da fila)/i.test(msg)||
        /agendamento deste card mudou/i.test(msg)||
        /fila oficial dos Cards não possui card atual/i.test(msg)
      );
      if(stale){
        // Conflito acadêmico não é erro de transporte: nenhuma resposta foi
        // aplicada. Recria o snapshot e obriga o usuário a conferir o card
        // atual antes de avaliar, em vez de deixá-lo preso num retry impossível.
        const answered=this._sessionAnswered,startTotal=this._sessionStartTotal,
          deckId=this.review&&this.review.review_scope&&!this.review.review_scope.all_decks
            ?Number(this.review.review_scope.selected_deck_id||0):0;
        try{
          await this._syncReviewScope(deckId);
          this._sessionAnswered=answered;
          const remaining=Number(this.counts.new||0)+Number(this.counts.learning||0)+Number(this.counts.review||0);
          this._sessionStartTotal=Math.max(Number(startTotal)||0,answered+remaining);
          this._finishAnswerRequest(attempt);
          if(this._screenActive('revisar'))await this.renderCurrent(document.getElementById('cards-content'));
          showToast('A fila de revisão mudou e foi atualizada. Confira o card atual antes de responder.');
        }catch(recoveryError){
          showToast('A fila mudou e não pôde ser atualizada agora: '+(recoveryError.message||recoveryError));
        }
        return false;
      }
      // Uma perda de resposta de rede pode ocorrer DEPOIS da gravação. A mesma
      // request_id é segura para retry: o backend devolve o recibo sem responder
      // o card uma segunda vez.
      showToast('Resposta não confirmada: '+msg+' · tente novamente com o mesmo card.');
      return false;
    }finally{this._answering=false;}
  },

  async action(action,value){
    if(!this.review||!this.review.card)return false;
    this._clearReviewerAutomation();
    try{
      const out=await this.request('/api/cards-official/cards/action',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,card_ids:[Number(this.review.card.id)],value:value==null?null:value})
      });
      await this._syncStates(out.cards||[]);
      await this._syncReviewScope(0);
      if(this._screenActive('revisar'))await this.renderCurrent(document.getElementById('cards-content'));
      return true;
    }catch(e){showToast('Ação não aplicada: '+(e.message||e));return false;}
  },
  async actionCards(action,refs,value){
    const locals=(refs||[]).map(ref=>ref&&typeof ref==='object'?ref:(CardsScreen.collectionCards().find(c=>String(c.id)===String(ref))||DB.getCard(ref))).filter(Boolean),
      ids=[...new Set(locals.map(x=>this._officialId(x)).filter(x=>x!=null).map(Number))];
    if(!ids.length)throw new Error('Nenhum card com identidade oficial.');
    const out=await this.request('/api/cards-official/cards/action',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action,card_ids:ids,value:value==null?null:value})
    });
    await this._syncStates(out.cards||[]);
    if(out.reviewer)this._applyReviewer(out.reviewer);
    await this.renderCurrent(document.getElementById('cards-content'));
    return out;
  },
  async deleteCurrentNote(){
    if(!this.review||!this.review.card)return false;
    const local=this._localForOfficialId(this.review.card.id);if(!local)throw new Error('Card atual não localizado no Study.');
    const pid=local._planId!=null?local._planId:this._activePlanId(),
      note=AnkiParity.noteForCard?AnkiParity.noteForCard(local):AnkiParity.getNote(local.noteId||local.id,pid==null?undefined:pid);
    if(!note)throw new Error('Nota canônica não encontrada.');
    const siblings=AnkiProductParity._cardsForNote(note,pid);
    const ok=await UI.confirm(siblings.length>1?'Excluir esta nota e seus '+siblings.length+' cards?':'Excluir esta nota?',{
      title:'🗑 Excluir nota · Anki oficial',okText:'Excluir',danger:true
    });
    if(!ok)return false;
    const out=await this.deleteOfficialNote(note);
    if(out&&out.reviewer)this._applyReviewer(out.reviewer);
    await this.renderCurrent(document.getElementById('cards-content'));
    CardsScreen.updateFavCount();
    showToast('Nota excluída pelo Anki oficial ✓');
    return true;
  },
  async replayCurrentAv(){
    if(!this.review||!this.review.card)return false;
    const card=this.review.card,tags=CardsScreen._flipped?card.answer_av_tags:card.question_av_tags;
    await this.playAv(tags||[]);return true;
  },
  async speakCurrentTts(){
    if(!this.review||!this.review.card)return false;
    const card=this.review.card,tags=(CardsScreen._flipped?card.answer_av_tags:card.question_av_tags)||[],
      tts=tags.filter(x=>x&&x.kind==='tts');
    if(!tts.length){showToast('Nenhum TTS fornecido pelo renderer oficial neste lado do card.');return false;}
    await this.playAv(tts);return true;
  },
  async setDue(){
    const v=await UI.prompt([{key:'due',label:'Dias / intervalo do Anki',type:'text',value:'1',hint:'Ex.: 5 ou 5-7'}],{title:'📅 Definir vencimento',okText:'Aplicar'});
    if(v&&String(v.due||'').trim())await this.action('set_due',String(v.due).trim());
  },
  async mark(){
    if(!this.review||!this.review.card)return;
    const oc=this.review.card;
    try{
      const out=await this.request('/api/cards-official/cards/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'mark',card_ids:[Number(oc.id)],value:null})});
      await this._syncOfficialNotes(out.notes||[]);
      this._applyReviewer(out.reviewer);await this.renderCurrent(document.getElementById('cards-content'));CardsScreen.updateFavCount();
    }catch(e){showToast(e.message||String(e));}
  },

  async undo(){
    const txn=this._undo[this._undo.length-1]||null;
    try{
      const before=await this.historyStatus(),matches=!!txn&&txn.undoStep!=null&&Number(before&&before.last_step)===Number(txn.undoStep);
      const out=await this.request('/api/cards-official/history/undo',{method:'POST'});
      if(!out||!out.state)throw new Error('O Anki oficial não devolveu o estado após desfazer.');
      await this._syncOfficialFullState(out.state,this._activePlanId());
      if(matches){
        this._undo.pop();
        for(const row of txn.rows)await DB.cancelarRevlogDurable(row);
        for(const it of txn.items)StudyGlobalScope.updateCardScoped(it.replica,it.before,it.replica._planId);
        txn.redoLabel=String(out.status&&out.status.redo||txn.undoLabel||'');
        this._redo.push(txn);this._sessionAnswered=Math.max(0,this._sessionAnswered-1);
      }
      await this._syncReviewScope(0);
      if(this._screenActive('revisar'))await this.renderCurrent(document.getElementById('cards-content'));
      showToast(matches?'Revisão desfeita ↶':'Última operação oficial desfeita ↶');return true;
    }catch(e){showToast('Não foi possível desfazer: '+(e.message||e));return false;}
  },
  async redo(){
    const txn=this._redo[this._redo.length-1]||null;
    try{
      const before=await this.historyStatus(),label=String(before&&before.redo||''),
        matches=!!txn&&(!txn.redoLabel||!label||label===txn.redoLabel);
      const out=await this.request('/api/cards-official/history/redo',{method:'POST'});
      if(!out||!out.state)throw new Error('O Anki oficial não devolveu o estado após refazer.');
      await this._syncOfficialFullState(out.state,this._activePlanId());
      if(matches){
        this._redo.pop();
        const state=await this.request('/api/cards-official/card/'+encodeURIComponent(txn.officialId)+'/state');
        const replayTxn=await this._persistAnswered(state,false);
        replayTxn.undoStep=Number(out.status&&out.status.last_step)||null;
        replayTxn.undoLabel=String(out.status&&out.status.undo||txn.undoLabel||'');
        this._undo.push(replayTxn);if(this._undo.length>50)this._undo.shift();this._sessionAnswered++;
      }
      await this._syncReviewScope(0);
      if(this._screenActive('revisar'))await this.renderCurrent(document.getElementById('cards-content'));
      showToast(matches?'Revisão refeita ↷':'Última operação oficial refeita ↷');return true;
    }catch(e){showToast('Não foi possível refazer: '+(e.message||e));return false;}
  },


  _statsScopeIds(){
    const cards=window.CardsScreen&&typeof CardsScreen.currentFilteredCards==='function'?CardsScreen.currentFilteredCards():this._scopeCards();
    return [...new Set((cards||[]).map(c=>this._officialId(c)).filter(Boolean).map(Number))];
  },
  _statsSearch(){
    const M=window.AnkiMaxStatsMedia,st=M&&M._statsState?M._statsState:{scope:'collection',history:'year',search:''};
    if(st.scope==='search')return String(st.search||'').trim();
    if(st.scope!=='deck')return '';
    const did=M&&M._statsSelectedDeckId?M._statsSelectedDeckId():'';
    if(!did)return '';
    const d=CardsScreen.collectionDecks().find(x=>String(x.id)===String(did));
    return d&&d.nome?'deck:"'+String(d.nome).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"':'';
  },
  _statsDays(){
    const M=window.AnkiMaxStatsMedia,st=M&&M._statsState?M._statsState:null;
    return st&&st.history==='all'?0:365;
  },
  _statsMap(map){
    return Object.entries(map||{}).map(([k,v])=>[Number(k),Number(v)||0]).filter(x=>Number.isFinite(x[0])).sort((a,b)=>a[0]-b[0]);
  },
  _statsBars(map,maxBars){
    const rows=this._statsMap(map);if(!rows.length)return'<p class="hint">Sem dados.</p>';
    const n=Math.max(1,Number(maxBars)||36),step=Math.max(1,Math.ceil(rows.length/n)),grouped=[];
    for(let i=0;i<rows.length;i+=step){
      const part=rows.slice(i,i+step),sum=part.reduce((a,x)=>a+x[1],0);
      grouped.push([part[0][0],sum]);
    }
    const mx=Math.max(1,...grouped.map(x=>x[1]));
    return '<div class="anki-stat-bars">'+grouped.map(([k,v])=>'<div title="'+escapeHtml(String(k))+': '+v+'"><i style="height:'+Math.max(v?3:0,Math.round(v/mx*100))+'%"></i><span>'+escapeHtml(String(k))+'</span></div>').join('')+'</div>';
  },
  _statsNestedBars(map,maxBars){
    const flat={};for(const [k,row] of Object.entries(map||{}))flat[k]=Object.values(row||{}).reduce((a,v)=>a+(Number(v)||0),0);
    return this._statsBars(flat,maxBars);
  },
  _statsRetentionRow(label,x){
    x=x||{};const pass=Number(x.young_passed||0)+Number(x.mature_passed||0),
      fail=Number(x.young_failed||0)+Number(x.mature_failed||0),tot=pass+fail;
    return '<tr><td>'+escapeHtml(label)+'</td><td>'+tot+'</td><td>'+pass+'</td><td>'+(tot?(pass/tot*100).toFixed(1)+'%':'—')+'</td></tr>';
  },
  _statsHours(hours){
    const rows=Array.isArray(hours&&hours.all_time)?hours.all_time:[];
    if(!rows.length)return'<p class="hint">Sem dados.</p>';
    return '<div class="anki-stat-table-wrap"><table><thead><tr><th>Hora</th><th>Respostas</th><th>Corretas</th><th>Acerto</th></tr></thead><tbody>'+
      rows.map((x,i)=>{const total=Number(x.total)||0,correct=Number(x.correct)||0;return'<tr><td>'+String(i).padStart(2,'0')+'h</td><td>'+total+'</td><td>'+correct+'</td><td>'+(total?(correct/total*100).toFixed(1)+'%':'—')+'</td></tr>';}).join('')+
      '</tbody></table></div>';
  },
  _statsButtons(buttons){
    const periods=[['Último mês','one_month'],['3 meses','three_months'],['1 ano','one_year'],['Todo histórico','all_time']];
    return '<div class="anki-stat-table-wrap"><table><thead><tr><th>Período</th><th>Learning 1–4</th><th>Jovens 1–4</th><th>Maduros 1–4</th></tr></thead><tbody>'+
      periods.map(([label,key])=>{const x=buttons&&buttons[key]||{},fmt=a=>(Array.isArray(a)?a:[0,0,0,0]).map(Number).join(' · ');return'<tr><td>'+label+'</td><td>'+fmt(x.learning)+'</td><td>'+fmt(x.young)+'</td><td>'+fmt(x.mature)+'</td></tr>';}).join('')+
      '</tbody></table></div>';
  },
  _statsOfficialDayMap(map,isTime){
    const src=map||{},keys=Object.keys(src).map(Number).filter(Number.isFinite),
      min=Math.min(-13,...keys),max=Math.max(0,...keys),out=new Map();
    for(let off=min;off<=max;off++){
      const x=src[String(off)]||src[off]||{},
        learn=Number(x.learn)||0,relearn=Number(x.relearn)||0,
        young=Number(x.young)||0,mature=Number(x.mature)||0,filtered=Number(x.filtered)||0,
        raw=learn+relearn+young+mature+filtered;
      out.set(this._addDays(todayCards(),off),{
        count:isTime?raw/60000:raw,
        learning:isTime?learn/60000:learn,
        relearning:isTime?relearn/60000:relearn,
        review:isTime?(young+mature)/60000:(young+mature),
        filtered:isTime?filtered/60000:filtered
      });
    }
    return out;
  },
  _statsOfficialSeriesHtml(map,isTime){
    const M=window.AnkiMaxStatsMedia,m=this._statsOfficialDayMap(map,isTime),
      serie=M&&M._serie?M._serie([...m.entries()],x=>x[1].count>0):null;
    if(!serie||!serie.grupos||!serie.grupos.length)return'<div class="stat-body"><p class="hint">Sem dados.</p></div>';
    const sum=k=>g=>g.itens.reduce((a,x)=>a+(Number(x[k])||0),0),fmt=n=>Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:isTime?1:0});
    return M._serieHtml(serie,sum('count'),
      [['learn',sum('learning')],['review',sum('review')],['relearn',sum('relearning')],['filtered',sum('filtered')]],
      fmt,isTime?'min':'');
  },
  _statsOfficialCalendarHtml(map){
    const m=this._statsOfficialDayMap(map,false),vals=[...m.entries()],tail=vals.slice(Math.max(0,vals.length-371)),
      max=Math.max(1,...tail.map(x=>Number(x[1].count)||0)),first=tail.findIndex(x=>x[1].count>0),
      dias=tail.slice(first<0?Math.max(0,tail.length-84):Math.max(0,Math.min(first,tail.length-84)));
    const safe=dias.length?dias:[[todayCards(),{count:0}]],pad=new Date(safe[0][0]+'T00:00:00').getDay(),
      cells=Array.from({length:pad},()=>'<span class="anki-cal-day vazio"></span>').concat(safe.map(([d,x])=>{
        const n=Number(x.count)||0,lvl=n?Math.max(1,Math.ceil(n/max*4)):0;
        return '<span class="anki-cal-day l'+lvl+'" title="'+escapeHtml(d)+': '+n+' revisão(ões)"></span>';
      })),weeks=Math.max(1,Math.ceil(cells.length/7)),active=safe.filter(x=>Number(x[1].count)>0).length,
      dm=iso=>String(iso).slice(8,10)+'/'+String(iso).slice(5,7);
    return '<section class="card stat-card anki-max-calendar"><div class="card-header"><div><h2>🗓 Calendário</h2><p class="sub">'+active+' dia(s) com revisão · '+dm(safe[0][0])+' a '+dm(safe[safe.length-1][0])+'</p></div></div>'+
      '<div class="stat-body"><div class="anki-calendar-grid" style="--sem:'+weeks+';grid-template-columns:repeat('+weeks+',minmax(0,1fr))">'+cells.join('')+'</div>'+
      '<div class="anki-cal-leg"><span>menos</span><span class="anki-cal-day l0"></span><span class="anki-cal-day l1"></span><span class="anki-cal-day l2"></span><span class="anki-cal-day l3"></span><span class="anki-cal-day l4"></span><span>mais</span></div></div></section>';
  },
  _statsOfficialCountsHtml(counts){
    const c=Object.assign({newCards:0,learn:0,relearn:0,young:0,mature:0,suspended:0,buried:0},counts||{}),
      items=[['Novos',c.newCards,'var(--text-faint)'],['Aprendendo',c.learn,'var(--warn)'],['Reaprendendo',c.relearn,'var(--bad)'],['Jovens',c.young,'var(--accent)'],['Maduros',c.mature,'var(--good)'],['Suspensos',c.suspended,'#e8b400'],['Enterrados',c.buried,'#8a8f98']],
      total=items.reduce((a,x)=>a+(Number(x[1])||0),0),denom=Math.max(1,total),
      pct=n=>(Number(n||0)/denom*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
    return '<section class="card stat-card"><div class="card-header"><div><h2>🧮 Contagem de cards</h2><p class="sub">Estado oficial atual · '+total+' card(s)</p></div></div><div class="stat-body">'+
      '<div class="stat-mat-bar">'+items.filter(x=>Number(x[1])>0).map(x=>'<span style="flex:'+Number(x[1])+';background:'+x[2]+'" title="'+x[0]+': '+Number(x[1])+'"></span>').join('')+'</div>'+
      '<div class="anki-counts">'+items.map(x=>'<div class="'+(Number(x[1])?'':'zero')+'"><i style="background:'+x[2]+'"></i><span>'+x[0]+'</span><b>'+Number(x[1]||0)+'</b><em>'+pct(x[1])+'</em></div>').join('')+'</div></div></section>';
  },
  _statsOfficialTodayHtml(today){
    const t=today||{},answers=Number(t.answer_count)||0,ms=Number(t.answer_millis)||0,correct=Number(t.correct_count)||0,
      mature=Number(t.mature_count)||0,matureCorrect=Number(t.mature_correct)||0;
    return '<section class="card stat-card"><div class="card-header"><div><h2>☀️ Hoje</h2><p class="sub">StatsService oficial · dados desde a virada do Anki.</p></div></div>'+
      '<div class="stat-body anki-today"><p>Estudados: '+answers+' card(s) em '+(ms/60000).toLocaleString('pt-BR',{maximumFractionDigits:1})+' min.</p>'+
      '<p>Corretas: '+correct+'/'+answers+(answers?' ('+(correct/answers*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%)':'')+'.</p>'+
      '<p>Aprendidos: '+Number(t.learn_count||0)+', Revisados: '+Number(t.review_count||0)+', Reaprendidos: '+Number(t.relearn_count||0)+', Filtrados: '+Number(t.early_review_count||0)+'.</p>'+
      '<p>'+(mature?'Resposta correta de cards maduros: '+matureCorrect+'/'+mature+' ('+(matureCorrect/mature*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%).':'Nenhum card maduro estudado hoje.')+'</p></div></section>';
  },
  _statsOfficialHistHtml(title,map,sub){
    const rows=Object.entries(map||{}).map(([k,v])=>[String(k),Number(v)||0]),mx=Math.max(1,...rows.map(x=>x[1]));
    return '<section class="card stat-card"><div class="card-header"><div><h2>'+title+'</h2>'+(sub?'<p class="sub">'+escapeHtml(sub)+'</p>':'')+'</div></div>'+
      '<div class="stat-body"><div class="anki-mini-hist" style="grid-template-columns:repeat('+Math.max(1,rows.length)+',minmax(0,1fr))">'+
      (rows.length?rows.map(([k,v])=>'<div title="'+escapeHtml(k)+': '+v+'"><b>'+v+'</b><div class="mh-bar"><i style="height:'+(v?Math.max(3,Math.round(v/mx*100)):0)+'%"></i></div><span>'+escapeHtml(k)+'</span></div>').join(''):'<p class="hint">Sem dados.</p>')+
      '</div></div></section>';
  },
  _statsOfficialHoursHtml(hours){
    const rows=Array.isArray(hours&&hours.all_time)?hours.all_time:[],max=Math.max(1,...rows.map(x=>Number(x.total)||0));
    return '<section class="card stat-card"><div class="card-header"><div><h2>🕒 Distribuição por hora</h2><p class="sub">Respostas e acertos por horário · fonte oficial.</p></div></div>'+
      '<div class="stat-body"><div class="anki-hourly">'+Array.from({length:24},(_,i)=>{const x=rows[i]||{},n=Number(x.total)||0,ok=Number(x.correct)||0;return'<div class="anki-hour" title="'+i+'h · '+n+' revisões · '+(n?Math.round(ok/n*100):0)+'% acerto"><div class="anki-hour-fill" style="height:'+(n?Math.max(4,Math.round(n/max*100)):0)+'%"></div></div>';}).join('')+
      '</div><div class="anki-hour-eixo"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div></div></section>';
  },
  _statsOfficialRetentionHtml(ret){
    return '<section class="card stat-card"><div class="card-header"><div><h2>✓ Retenção real (True Retention)</h2><p class="sub">Again = falha; Hard/Good/Easy = acerto · cálculo oficial.</p></div></div>'+
      '<div class="stat-body"><div class="anki-stat-table-wrap"><table><thead><tr><th>Período</th><th>Respostas</th><th>Corretas</th><th>Retenção</th></tr></thead><tbody>'+
      this._statsRetentionRow('Hoje',ret&&ret.today)+this._statsRetentionRow('Ontem',ret&&ret.yesterday)+this._statsRetentionRow('Semana',ret&&ret.week)+this._statsRetentionRow('Mês',ret&&ret.month)+this._statsRetentionRow('Ano',ret&&ret.year)+this._statsRetentionRow('Tudo',ret&&ret.all_time)+
      '</tbody></table></div></div></section>';
  },
  _statsOfficialButtonsHtml(buttons){
    return '<section class="card stat-card"><div class="card-header"><div><h2>🔢 Botões de resposta</h2><p class="sub">Distribuição 1–4 por maturidade e período · fonte oficial.</p></div></div><div class="stat-body">'+this._statsButtons(buttons||{})+'</div></section>';
  },
  _statsOfficialAddedHtml(map){
    const M=window.AnkiMaxStatsMedia,src=map||{},keys=Object.keys(src).map(Number).filter(Number.isFinite),
      min=Math.min(-13,...keys),max=Math.max(0,...keys),m=new Map();
    for(let off=min;off<=max;off++)m.set(this._addDays(todayCards(),off),Number(src[String(off)]||src[off]||0));
    const serie=M&&M._serie?M._serie([...m.entries()],x=>Number(x[1])>0):null;
    const body=serie&&serie.grupos&&serie.grupos.length?M._serieHtml(serie,g=>g.itens.reduce((a,b)=>a+Number(b||0),0),[['review',g=>g.itens.reduce((a,b)=>a+Number(b||0),0)]],n=>Number(n||0).toLocaleString('pt-BR'),''):'<div class="stat-body"><p class="hint">Sem dados.</p></div>';
    return '<section class="card stat-card"><div class="card-header"><div><h2>➕ Adicionados</h2><p class="sub">Cards adicionados por período · fonte oficial.</p></div></div>'+body+'</section>';
  },
  async renderStats(box){
    box=box||document.getElementById('cards-content');if(!box)return;
    const token=++this._renderEpoch;
    if(!this._renderStillCurrent(token,'stats',box))return;
    if(!CardsScreen.collectionCards().length){box.innerHTML=CardsScreen.emptyState('Sem estatísticas ainda','Crie e revise alguns cards para ver seus dados.');return;}
    box.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">📊</div><h3>Calculando estatísticas oficiais…</h3><p>O GraphsService do Anki 26.09.3 está processando a coleção do Anki.</p></div></div>';
    try{
      await this.bootstrap(false);if(!this._renderStillCurrent(token,'stats',box))return;
      const data=await this.request('/api/cards-official/stats/graphs/scoped',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({search:this._statsSearch(),days:this._statsDays(),card_ids:this._statsScopeIds()})
        }),

        counts=data.card_counts&&data.card_counts.excluding_inactive||{},reviews=data.reviews||{},fsrs=!!data.fsrs,
        controls=window.AnkiMaxStatsMedia&&AnkiMaxStatsMedia._statsControlsHtml?AnkiMaxStatsMedia._statsControlsHtml():'';
      if(!this._renderStillCurrent(token,'stats',box))return;
      box.innerHTML='<div class="stats-page cards-official-stats">'+controls+
        this._statsOfficialTodayHtml(data.today||{})+
        '<div class="stat-grid">'+this._statsOfficialCountsHtml(counts)+this._statsOfficialCalendarHtml(reviews.count||{})+'</div>'+
        '<div class="stat-grid">'+
          '<section class="card stat-card"><div class="card-header"><div><h2>📚 Revisões</h2><p class="sub">Learning, relearning, jovens, maduras e filtradas · GraphsService.</p></div></div>'+this._statsOfficialSeriesHtml(reviews.count||{},false)+'</section>'+
          '<section class="card stat-card"><div class="card-header"><div><h2>⏱ Tempo de revisão</h2><p class="sub">Minutos por período · GraphsService.</p></div></div>'+this._statsOfficialSeriesHtml(reviews.time||{},true)+'</section>'+
        '</div>'+
        this._statsOfficialRetentionHtml(data.true_retention||{})+
        '<div class="stat-grid">'+this._statsOfficialButtonsHtml(data.buttons||{})+this._statsOfficialHoursHtml(data.hours||{})+'</div>'+
        '<div class="stat-grid">'+
          this._statsOfficialHistHtml('↔ Intervalos',(data.intervals||{}).intervals||{},'Intervalos oficiais dos cards em estudo.')+
          this._statsOfficialHistHtml(fsrs?'🧠 Recuperabilidade':'🙂 Facilidade',fsrs?((data.retrievability||{}).retrievability||{}):((data.eases||{}).eases||{}),fsrs?'Buckets oficiais de retrievability.':'Buckets oficiais de ease.')+
        '</div>'+
        (fsrs?'<div class="stat-grid">'+
          this._statsOfficialHistHtml('🧬 Estabilidade',(data.stability||{}).intervals||{},'Buckets oficiais de estabilidade FSRS.')+
          this._statsOfficialHistHtml('🧩 Dificuldade',(data.difficulty||{}).eases||{},'Buckets oficiais de dificuldade FSRS.')+
        '</div>':'')+
        this._statsOfficialAddedHtml((data.added||{}).added||{})+
        (window.AnkiMaxStatsMedia&&AnkiMaxStatsMedia._simCardHtml?AnkiMaxStatsMedia._simCardHtml():'')+
      '</div>';
      if(window.AnkiMaxStatsMedia&&AnkiMaxStatsMedia._bindStatsUi)AnkiMaxStatsMedia._bindStatsUi();
    }catch(e){
      if(!this._renderStillCurrent(token,'stats',box))return;
      console.error('Cards official stats:',e);
      box.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">⚠</div><h3>Estatísticas oficiais indisponíveis</h3><p>'+escapeHtml(e&&e.message?e.message:String(e))+'</p><p class="hint">Nenhum cálculo local foi usado como fallback.</p><button type="button" class="btn-secondary" id="cards-official-stats-retry">Tentar novamente</button></div></div>';
      const b=document.getElementById('cards-official-stats-retry');if(b)b.onclick=()=>void this.renderStats(box);
    }
  },

  _browserSortKey(key){
    return ({
      sortField:'noteFld',deck:'deck',notetype:'note',template:'template',due:'cardDue',
      interval:'cardIvl',ease:'cardEase',stability:'stability',difficulty:'difficulty',
      retrievability:'retrievability',reps:'cardReps',lapses:'cardLapses',
      position:'originalPosition',tags:'noteTags',created:'noteCrt',modified:'noteMod',
      cardModified:'cardMod'
    })[String(key||'')]||'';
  },
  _browserQuery(st){
    const parts=[],esc=v=>String(v==null?'':v).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
    const raw=String(st&&st.query||'').trim();if(raw)parts.push('('+raw+')');
    if(st&&st.tag)parts.push('tag:"'+esc(st.tag)+'"');
    if(st&&st.flag!=='')parts.push('flag:'+Math.max(0,Math.min(7,Number(st.flag)||0)));
    if(st&&st.suspended==='yes')parts.push('is:suspended');
    else if(st&&st.suspended==='no')parts.push('-is:suspended');
    if(st&&st.marked)parts.push('tag:marked');
    return parts.join(' ');
  },
  _browserBaseRows(){
    if(!this._origBrowserRows)return[];
    const b=AnkiProductParity.browser,saved={
      query:b.query,tag:b.tag,flag:b.flag,suspended:b.suspended,marked:b.marked,
      sort:b.sort,sortDir:b.sortDir,page:b.page
    };
    b.query='';b.tag='';b.flag='';b.suspended='all';b.marked=false;
    try{return this._origBrowserRows();}
    finally{Object.assign(b,saved);}
  },
  _browserRowOfficialId(row,mode){
    if(mode==='cards')return this._officialId(row&&row.card);
    const note=row&&row.note,n=Number(note&&note.ankiId!=null?note.ankiId:note&&note.id);
    return Number.isFinite(n)&&n>0?n:null;
  },
  async _refreshOfficialBrowser(){
    const seq=++this._browserSeq;
    try{
      await this.bootstrap(false);
      const b=AnkiProductParity.browser,mode=b.mode==='cards'?'cards':'notes',
        query=this._browserQuery(b),sortKey=this._browserSortKey(b.sort),
        qs=new URLSearchParams({mode,q:query,sort_key:sortKey,reverse:b.sortDir==='desc'?'true':'false'});
      const out=await this.request('/api/cards-official/browser/ids?'+qs.toString());
      if(seq!==this._browserSeq)return;
      const base=this._browserBaseRows(),map=new Map(),active=window.StudyGlobalScope&&StudyGlobalScope.activePlanId?StudyGlobalScope.activePlanId():null;
      for(const row of base){
        const id=this._browserRowOfficialId(row,mode);if(id==null)continue;
        const prev=map.get(String(id));
        const plan=(row.card&&row.card._planId)||(row.note&&row.note._planId)||null;
        if(!prev||(active!=null&&String(plan)===String(active)))map.set(String(id),row);
      }
      const ids=out.ids||[],visibleCount=Math.min(ids.length,Math.max(Number(AnkiProductParity.PAGE)||50,((Number(b.page)||0)+1)*(Number(AnkiProductParity.PAGE)||50))),
        visibleIds=ids.slice(0,visibleCount),
        officialRows=visibleIds.length?await this.request('/api/cards-official/browser/rows',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,ids:visibleIds})
        }):{rows:[]},
        officialMap=new Map((officialRows.rows||[]).map(x=>[String(x.id),x])),
        rows=[],missing=[];
      for(const id of ids){
        const row=map.get(String(id));
        if(row){row._officialBrowser=officialMap.get(String(id))||null;rows.push(row);}else missing.push(id);
      }
      if(missing.length)throw new Error('Browser oficial retornou '+missing.length+' ID(s) sem objeto local correspondente: '+missing.slice(0,5).join(', '));
      this._browserCache=rows;this._browserTotal=Number(out.total)||rows.length;this._browserError=null;
      if(this._origBrowserRender)this._origBrowserRender();
    }catch(e){
      if(seq!==this._browserSeq)return;
      this._browserError=e;this._browserCache=[];
      const list=document.getElementById('anki-browser-list'),summary=document.getElementById('anki-browser-summary');
      if(summary)summary.textContent='Busca oficial indisponível';
      if(list)list.innerHTML='<div class="empty-state"><h3>Não foi possível consultar o Browser oficial</h3><p>'+escapeHtml(e&&e.message?e.message:String(e))+'</p></div>';
    }
  },
  _scheduleOfficialBrowser(){
    clearTimeout(this._browserTimer);
    this._browserTimer=setTimeout(()=>{void this._refreshOfficialBrowser();},90);
  },
  async _loadOfficialBrowserFacets(){
    try{
      await this.bootstrap(false);
      const out=await this.request('/api/cards-official/browser/facets'),sel=document.getElementById('anki-browser-tag');
      if(sel){
        const current=AnkiProductParity.browser.tag||'';
        sel.innerHTML='<option value="">Todas as tags</option>'+(out.tags||[]).map(t=>'<option value="'+AnkiProductParity.esc(t)+'">'+AnkiProductParity.esc(t)+'</option>').join('');
        sel.value=current;
      }
      this._officialBrowserFacets=out;this._officialBrowserFacetsError=null;
    }catch(e){this._officialBrowserFacetsError=e;if(typeof _quiet==='function')_quiet(e,'cards-official-browser-facets');}
    if(window.AnkiPractical10&&AnkiPractical10._renderBrowserSidebar)AnkiPractical10._renderBrowserSidebar();
  },
  _officialNoteId(note){
    const n=Number(note&&note.ankiId!=null?note.ankiId:note&&note.id);
    return Number.isFinite(n)&&n>0?n:null;
  },
  _resolveBrowserSelection(ids){
    if(!window.AnkiMaxParity||typeof AnkiMaxParity._resolveSelection!=='function')return{cards:[],notes:[],noteIds:[]};
    return AnkiMaxParity._resolveSelection(ids||[]);
  },
  _browserOfficialSelection(ids){
    const sel=this._resolveBrowserSelection(ids),cardIds=[],noteIds=[],cs=new Set(),ns=new Set();
    for(const card of sel.cards||[]){const id=this._officialId(card);if(id!=null&&!cs.has(id)){cs.add(id);cardIds.push(id);}}
    for(const note of sel.notes||[]){const id=this._officialNoteId(note);if(id!=null&&!ns.has(id)){ns.add(id);noteIds.push(id);}}
    return {local:sel,cardIds,noteIds};
  },
  _officialDeckId(localDeckId,planId){
    try{
      const rows=planId!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(planId,'decks'):DB.getDecks();
      const d=(rows||[]).find(x=>String(x.id)===String(localDeckId));
      const n=Number(d&&d.ankiId!=null?d.ankiId:d&&d.id);
      return Number.isFinite(n)&&n>0?n:null;
    }catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-deck-id');return null;}
  },
  _noteReplicas(officialId){
    const out=[],seen=new Set(),plans=window.StudyGlobalScope&&StudyGlobalScope.plans?StudyGlobalScope.plans():[{id:null}];
    for(const p of plans){
      const pid=p&&p.id!=null?p.id:null,notes=AnkiParity.notes(pid==null?undefined:pid);
      for(const n of notes){
        if(String(this._officialNoteId(n))!==String(officialId))continue;
        const k=String(pid||'')+'|'+String(n.id);if(seen.has(k))continue;seen.add(k);
        out.push(Object.assign({},n,pid==null?{}:{_planId:pid}));
      }
    }
    return out;
  },
  _localNotetypeId(officialId,planId,fallback){
    const all=AnkiParity.noteTypes(planId==null?undefined:planId),
      hit=all.find(nt=>String(Number(nt.ankiId!=null?nt.ankiId:nt.id))===String(officialId));
    return hit?hit.id:fallback;
  },
  async _syncOfficialNotes(states){
    for(const state of states||[]){
      const reps=this._noteReplicas(state.id);
      for(const note of reps){
        const pid=note._planId!=null?note._planId:null,
          patch=Object.assign({},note,{
            fields:Object.assign({},state.fields||{}),tags:Array.isArray(state.tags)?state.tags.slice():[],
            notetypeId:this._localNotetypeId(state.notetype_id,pid,note.notetypeId)
          }),
          saved=AnkiParity.saveNote(patch,pid==null?undefined:pid);
        if(!saved)throw new Error('Falha ao sincronizar nota oficial '+state.id+'.');
        const marked=(state.tags||[]).some(t=>String(t).toLowerCase()==='marked');
        const cards=AnkiProductParity._cardsForNote(saved,pid);
        for(const card of cards){
          if(window.StudyGlobalScope&&StudyGlobalScope.updateCardScoped)StudyGlobalScope.updateCardScoped(card,{favorito:marked},pid);
        }
      }
    }
  },
  async _browserBulk(ids,action,extra){
    await this.bootstrap(false);
    const sel=this._browserOfficialSelection(ids),payload=Object.assign({
      action,card_ids:sel.cardIds,note_ids:sel.noteIds
    },extra||{});
    const out=await this.request('/api/cards-official/browser/bulk',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    await this._syncStates(out.cards||[]);
    await this._syncOfficialNotes(out.notes||[]);
    await this._reconcileOfficialCardSet(out.notes||[],out.cards||[]);
    if(out.reviewer)this._applyReviewer(out.reviewer);
    this._browserCache=[];this._scheduleOfficialBrowser();CardsScreen.updateFavCount();
    return {out,selection:sel};
  },
  async _browserToggleSuspend(ids){
    const sel=this._browserOfficialSelection(ids),should=(sel.local.cards||[]).some(c=>!c.suspenso);
    if(!sel.cardIds.length)return;
    await this._browserBulk(ids,should?'suspend_cards':'unsuspend_cards');
    showToast(should?'Card(s) suspenso(s) ✓':'Card(s) reativado(s) ✓');
  },
  async _browserBulkFlag(ids){
    const v=await UI.prompt([{key:'flag',label:'Bandeira',type:'select',value:'0',options:[0,1,2,3,4,5,6,7].map(n=>({value:String(n),label:n===0?'Sem bandeira':DB.FLAGS[n].nome}))}],{title:'🚩 Definir bandeira',okText:'Aplicar'});
    if(!v)return;await this._browserBulk(ids,'flag',{flag:Number(v.flag)||0});showToast('Bandeiras atualizadas ✓');
  },
  async _browserBulkMark(ids){
    const sel=this._browserOfficialSelection(ids),should=(sel.local.notes||[]).some(n=>!(n.tags||[]).some(t=>String(t).toLowerCase()==='marked'));
    if(!sel.noteIds.length)return;await this._browserBulk(ids,'mark',{marked:should});showToast(should?'Notas marcadas ✓':'Marcação removida ✓');
  },
  async _browserEditTags(ids){
    const v=await UI.prompt([{key:'add',label:'Adicionar tags',type:'text',value:'',hint:'Separe por espaço.'},{key:'remove',label:'Remover tags',type:'text',value:'',hint:'Separe por espaço.'}],{title:'🏷 Editar etiquetas',okText:'Aplicar'});
    if(!v)return;const add=String(v.add||'').trim(),remove=String(v.remove||'').trim();
    if(add)await this._browserBulk(ids,'tags_add',{tags:add});
    if(remove)await this._browserBulk(ids,'tags_remove',{tags:remove});
    showToast('Tags atualizadas ✓');
  },
  async _browserFindReplace(ids){
    const v=await UI.prompt([{key:'find',label:'Localizar',type:'text',value:''},{key:'replace',label:'Substituir por',type:'text',value:''}],{title:'🔁 Localizar e substituir',okText:'Substituir'});
    if(!v||!String(v.find||''))return;
    await this._browserBulk(ids,'find_replace',{search:String(v.find),replacement:String(v.replace||''),regex:false,match_case:false});
    showToast('Localizar/substituir aplicado pelo Anki oficial ✓');
  },
  async _browserDeleteNotes(ids){
    const sel=this._browserOfficialSelection(ids);if(!sel.noteIds.length)return;
    const ok=await UI.confirm('Excluir '+sel.noteIds.length+' nota(s) e os cards correspondentes?',{title:'🗑 Excluir notas',okText:'Excluir',danger:true});
    if(!ok)return;
    await this._browserBulk(ids,'delete_notes');
    for(const note of sel.local.notes||[]){
      const pid=note._planId!=null?note._planId:null,cards=AnkiProductParity._cardsForNote(note,pid);
      if(cards.length)DB.deleteNoteByCard(cards[0].id,pid);
      try{localStorage.removeItem(AnkiParity._entityKey('note',note.id,pid==null?undefined:pid));}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-delete-note');}
    }
    AnkiProductParity.browser.selected.clear();this.invalidate('delete-notes');
    showToast('Notas excluídas pelo Anki oficial ✓');
  },
  _localCardsFromRefs(refs){
    const source=CardsScreen.collectionCards?CardsScreen.collectionCards():this._scopeCards(),
      wanted=new Set((refs||[]).map(x=>String(x&&typeof x==='object'?x.id:x)));
    return (source||[]).filter(c=>wanted.has(String(c.id)));
  },
  async deleteNotesForCardRefs(refs){
    await this.bootstrap(false);
    const cards=this._localCardsFromRefs(refs);
    if(!cards.length)return {deletedNotes:0,deletedCards:0};
    const byNote=new Map();
    for(const card of cards){
      const pid=card._planId!=null?card._planId:this._activePlanId(),
        note=AnkiParity.noteForCard?AnkiParity.noteForCard(card):AnkiParity.getNote(card.noteId||card.id,pid==null?undefined:pid),
        oid=this._officialNoteId(note);
      if(note&&oid!=null&&!byNote.has(String(oid)))byNote.set(String(oid),{note,oid,reps:this._noteReplicas(oid)});
    }
    const noteIds=[...byNote.values()].map(x=>x.oid);
    if(!noteIds.length)throw new Error('Seleção sem identidade oficial de nota.');
    const out=await this.request('/api/cards-official/browser/bulk',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'delete_notes',card_ids:[],note_ids:noteIds})
    });
    for(const row of byNote.values()){
      for(const rep of row.reps){
        const pid=rep._planId!=null?rep._planId:null,siblings=AnkiProductParity._cardsForNote(rep,pid);
        if(siblings.length)DB.deleteNoteByCard(siblings[0].id,pid==null?undefined:pid);
        try{localStorage.removeItem(AnkiParity._entityKey('note',rep.id,pid==null?undefined:pid));}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-bulk-delete');}
      }
    }
    if(out.reviewer)this._applyReviewer(out.reviewer);
    this.dirty=false;this._browserCache=[];CardsScreen.updateFavCount();
    return {deletedNotes:noteIds.length,deletedCards:cards.length,out};
  },
  async moveCardRefsToDeck(refs,localDeckId,planId){
    await this.bootstrap(false);
    const cards=this._localCardsFromRefs(refs),cardIds=[...new Set(cards.map(c=>this._officialId(c)).filter(x=>x!=null))];
    if(!cardIds.length)throw new Error('Seleção sem identidade oficial de card.');
    const did=this._officialDeckId(localDeckId,planId);
    if(did==null)throw new Error('Baralho de destino sem identidade Anki canônica.');
    const out=await this.request('/api/cards-official/browser/bulk',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'move_deck',card_ids:cardIds,note_ids:[],deck_id:did})
    });
    await this._syncStates(out.cards||[]);
    if(out.reviewer)this._applyReviewer(out.reviewer);
    this.dirty=false;this._browserCache=[];
    return {moved:cardIds.length,out};
  },
  async _browserMove(ids){
    const sel=this._browserOfficialSelection(ids),cards=sel.local.cards||[];if(!cards.length)return;
    const origins=new Set(cards.map(c=>String(c._planId||(window.StudyGlobalScope&&StudyGlobalScope.sourcePlanForCard?StudyGlobalScope.sourcePlanForCard(c.id):'')||'')).filter(Boolean));
    if(origins.size>1){showToast('Para mover em lote, selecione cards do mesmo planejamento de origem.');return;}
    const pid=origins.size?[...origins][0]:null,decks=(pid&&DB.getDecksForPlan?DB.getDecksForPlan(pid):DB.getDecks()).filter(d=>!(AnkiParity.isFilteredDeck&&AnkiParity.isFilteredDeck(d)));
    if(!decks.length)return;
    const v=await UI.prompt([{key:'deck',label:'Baralho de destino',type:'select',value:String(decks[0].id),options:decks.map(d=>({value:String(d.id),label:d.nome}))}],{title:'📁 Mover cards',okText:'Mover'});
    if(!v)return;const did=this._officialDeckId(v.deck,pid);if(did==null)throw new Error('Baralho sem identidade Anki canônica.');
    await this._browserBulk(ids,'move_deck',{deck_id:did});showToast(cards.length+' card(s) movido(s) ✓');
  },
  async _browserSetDue(ids){
    const v=await UI.prompt([{key:'spec',label:'Vencimento',type:'text',value:'1',placeholder:'ex.: 10, 60-90 ou 60-90!',hint:'Sintaxe interpretada diretamente pelo Anki.'}],{title:'📅 Definir vencimento',okText:'Agendar'});
    if(!v||!String(v.spec||'').trim())return;
    await this._browserBulk(ids,'set_due',{days:String(v.spec).trim()});showToast('Vencimento aplicado pelo Anki oficial ✓');
  },
  async _browserForget(ids){
    const v=await UI.prompt([{key:'restore',label:'Restaurar posição original?',type:'select',value:'no',options:[{value:'no',label:'Não'},{value:'yes',label:'Sim'}]},{key:'counts',label:'Zerar repetições e lapsos?',type:'select',value:'no',options:[{value:'no',label:'Não'},{value:'yes',label:'Sim'}]}],{title:'↺ Resetar cards',okText:'Resetar'});
    if(!v)return;await this._browserBulk(ids,'forget',{restore_position:v.restore==='yes',reset_counts:v.counts==='yes'});showToast('Cards resetados pelo Anki oficial ✓');
  },
  async _browserReposition(ids){
    const sel=this._browserOfficialSelection(ids),newIds=(sel.local.cards||[]).filter(c=>(c.phase||'new')==='new').map(c=>this._officialId(c)).filter(Boolean);
    if(!newIds.length){showToast('Nenhum card novo na seleção.');return;}
    const v=await UI.prompt([{key:'start',label:'Posição inicial',type:'number',value:'1'},{key:'step',label:'Passo',type:'number',value:'1'}],{title:'🔢 Reposicionar novos',okText:'Aplicar'});
    if(!v)return;
    const fakeIds=ids,extra={starting_from:Math.max(0,Math.round(Number(v.start)||0)),step_size:Math.max(1,Math.round(Number(v.step)||1)),randomize:false,shift_existing:false};
    await this.bootstrap(false);
    const out=await this.request('/api/cards-official/browser/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({action:'reposition',card_ids:[...new Set(newIds)],note_ids:[]},extra))});
    await this._syncStates(out.cards||[]);if(out.reviewer)this._applyReviewer(out.reviewer);this._browserCache=[];this._scheduleOfficialBrowser();
    showToast(newIds.length+' card(s) reposicionado(s) ✓');
  },


  _notetypePlanIds(extra){
    const ids=[];
    if(window.StudyGlobalScope&&StudyGlobalScope.planIdsForScope){
      ids.push(...StudyGlobalScope.planIdsForScope());
    }else{
      const pid=this._activePlanId();if(pid!=null)ids.push(pid);
    }
    for(const x of extra||[])if(x!=null)ids.push(x);
    return [...new Set(ids.map(String))];
  },
  _localNotetypeReplicas(officialId){
    const out=[],seen=new Set(),pids=this._notetypePlanIds();
    for(const pid of pids){
      for(const nt of AnkiParity.noteTypes(pid)){
        const oid=Number(nt&&nt.ankiId!=null?nt.ankiId:nt&&nt.id);
        if(String(oid)!==String(officialId))continue;
        const k=String(pid)+'|'+String(nt.id);if(seen.has(k))continue;seen.add(k);
        out.push(Object.assign({},nt,{_planId:pid}));
      }
    }
    return out;
  },
  _removeLocalNotetypeReplicas(officialId){
    let removed=0;
    for(const nt of this._localNotetypeReplicas(officialId)){
      const pid=nt._planId,key=window.StudyGlobalScope&&StudyGlobalScope.entityKeyForPlan
        ?StudyGlobalScope.entityKeyForPlan(pid,'notetype',nt.id)
        :AnkiParity._entityKey('notetype',nt.id,pid);
      try{
        localStorage.removeItem(key);removed++;
      }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-notetype-delete');}
    }
    return removed;
  },
  _stockNotetypeKind(base){
    return ({basic:0,basic_reversed:1,basic_optional_reversed:2,typing:3,cloze:4,image_occlusion:5})[String(base||'basic')]??0;
  },
  async createOfficialNotetype(base,name){
    await this.bootstrap(false);
    const out=await this.request('/api/cards-official/notetypes/stock',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:this._stockNotetypeKind(base),name:String(name||'').trim()})
    });
    if(!out||!out.notetype)throw new Error('O Anki oficial não devolveu o novo tipo de nota.');
    const pids=this._notetypePlanIds();
    this._syncNotetypesIntoPlans([{notetype:out.notetype,use_count:out.use_count||0}],pids);
    await this._syncCollectionState(out.state,this._activePlanId(),null);
    this._browserCache=[];this.dirty=false;
    if(window.AnkiProductParity&&AnkiProductParity.renderNotetypes)AnkiProductParity.renderNotetypes();
    return out;
  },
  async copyOfficialNotetype(nt,name){
    await this.bootstrap(false);
    const oid=Number(nt&&nt.ankiId!=null?nt.ankiId:nt&&nt.id);
    if(!Number.isFinite(oid)||oid<=0)throw new Error('Tipo de nota sem identidade oficial.');
    const out=await this.request('/api/cards-official/notetypes/'+encodeURIComponent(oid)+'/copy',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:String(name||'').trim()})
    });
    if(!out||!out.notetype)throw new Error('O Anki oficial não devolveu a cópia do tipo de nota.');
    this._syncNotetypesIntoPlans([{notetype:out.notetype,use_count:out.use_count||0}],this._notetypePlanIds());
    await this._syncCollectionState(out.state,this._activePlanId(),null);
    this._browserCache=[];this.dirty=false;
    if(window.AnkiProductParity&&AnkiProductParity.renderNotetypes)AnkiProductParity.renderNotetypes();
    return out;
  },
  async updateOfficialNotetype(old,nt,notes,meta){
    await this.bootstrap(false);
    const oid=Number(old&&old.ankiId!=null?old.ankiId:old&&old.id);
    if(!Number.isFinite(oid)||oid<=0)throw new Error('Tipo de nota sem identidade oficial.');
    meta=meta||{};
    const fields=(nt.fields||[]).map((f,i)=>({
        name:String(f&&f.name||'').trim(),
        source_name:meta.fieldSources&&meta.fieldSources[i]!=null?String(meta.fieldSources[i]):null
      })),
      templates=(nt.templates||[]).map((t,i)=>({
        name:String(t&&t.name||'').trim(),
        qfmt:String(t&&t.qfmt||''),
        afmt:String(t&&t.afmt||''),
        source_ord:meta.templateSources&&meta.templateSources[i]!=null?Number(meta.templateSources[i]):null
      })),
      edit={name:String(nt.name||'').trim(),css:String(nt.css||''),fields,templates};
    const out=await this.request('/api/cards-official/notetypes/'+encodeURIComponent(oid),{
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({edit})
    });
    if(!out||!out.notetype)throw new Error('O Anki oficial não devolveu o NoteType atualizado.');
    const pids=this._notetypePlanIds((notes||[]).map(n=>n&&n._planId).filter(x=>x!=null));
    this._syncNotetypesIntoPlans([{notetype:out.notetype,use_count:out.use_count||0}],pids);
    await this._syncOfficialNotes(out.notes||[]);
    await this._reconcileOfficialCardSet(out.notes||[],out.cards||[]);
    await this._syncCollectionState(out.state,this._activePlanId(),null);
    this._browserCache=[];this.dirty=false;
    const modal=document.getElementById('anki-nt-edit-modal');if(modal)modal.style.display='none';
    if(window.AnkiProductParity){
      if(AnkiProductParity.renderNotetypes)AnkiProductParity.renderNotetypes();
      if(AnkiProductParity.renderBrowser)AnkiProductParity.renderBrowser();
    }
    CardsScreen.render();CardsScreen.updateFavCount();
    return out;
  },
  async deleteOfficialNotetype(nt){
    await this.bootstrap(false);
    const oid=Number(nt&&nt.ankiId!=null?nt.ankiId:nt&&nt.id);
    if(!Number.isFinite(oid)||oid<=0)throw new Error('Tipo de nota sem identidade oficial.');
    const out=await this.request('/api/cards-official/notetypes/'+encodeURIComponent(oid),{method:'DELETE'});
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou a exclusão.');
    this._removeLocalNotetypeReplicas(oid);
    await this._syncCollectionState(out.state,this._activePlanId(),null);
    this._browserCache=[];this.dirty=false;
    if(window.AnkiProductParity&&AnkiProductParity.renderNotetypes)AnkiProductParity.renderNotetypes();
    return out;
  },
  async restoreOfficialNotetype(nt,forceKind){
    await this.bootstrap(false);
    const oid=Number(nt&&nt.ankiId!=null?nt.ankiId:nt&&nt.id);
    if(!Number.isFinite(oid)||oid<=0)throw new Error('Tipo de nota sem identidade oficial.');
    const out=await this.request('/api/cards-official/notetypes/'+encodeURIComponent(oid)+'/restore-stock',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({force_kind:forceKind==null?null:Number(forceKind)})
    });
    if(!out||!out.notetype)throw new Error('O Anki oficial não devolveu o NoteType restaurado.');
    this._syncNotetypesIntoPlans([{notetype:out.notetype,use_count:out.use_count||0}],this._notetypePlanIds());
    await this._syncOfficialNotes(out.notes||[]);
    await this._reconcileOfficialCardSet(out.notes||[],out.cards||[]);
    await this._syncCollectionState(out.state,this._activePlanId(),null);
    this._browserCache=[];this.dirty=false;
    return out;
  },

  _stockName(kind){
    return ({basic:'Basic',basic_reversed:'Basic (and reversed card)',basic_optional_reversed:'Basic (optional reversed card)',typing:'Basic (type in the answer)',cloze:'Cloze',image_occlusion:'Image Occlusion'})[String(kind||'basic')]||'Basic';
  },
  async _ensureOfficialNotetype(nt,planId){
    if(!nt)throw new Error('Tipo de nota ausente.');
    await this.bootstrap(false);
    const oid=Number(nt.ankiId!=null?nt.ankiId:nt.id);
    let rows=await this._officialNotetypes(),row=rows.find(x=>Number(x&&x.notetype&&x.notetype.id)===oid);
    if(!row){
      this.invalidate('notetype-not-in-official-collection');
      await this.bootstrap(true);
      rows=await this._officialNotetypes();
      row=rows.find(x=>Number(x&&x.notetype&&x.notetype.id)===oid);
    }
    if(!row)throw new Error('Tipo de nota não existe na coleção oficial do Anki.');
    this._syncNotetypesIntoPlans([row],[planId]);
    const local=AnkiParity.noteTypes(planId==null?undefined:planId).find(x=>String(Number(x.ankiId!=null?x.ankiId:x.id))===String(oid))||nt;
    return {officialId:oid,local,row};
  },
  async _ensureOfficialStockNotetype(kind,planId){
    const name=this._stockName(kind),types=AnkiParity.noteTypes(planId==null?undefined:planId);
    let local=types.find(x=>x.stockKind===kind)||types.find(x=>String(x.name||'')===name);
    await this.bootstrap(false);
    let rows=await this._officialNotetypes(),row=null;
    if(local){
      const oid=Number(local.ankiId!=null?local.ankiId:local.id);
      row=rows.find(x=>Number(x&&x.notetype&&x.notetype.id)===oid);
    }
    if(!row)row=rows.find(x=>String(x&&x.notetype&&x.notetype.name||'')===name);
    if(!row){
      const out=await this.request('/api/cards-official/notetypes/stock',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({kind:this._stockNotetypeKind(kind),name})
      });
      if(!out||!out.notetype)throw new Error('O Anki oficial não criou o tipo de nota '+name+'.');
      row={notetype:out.notetype,use_count:out.use_count||0};
    }
    this._syncNotetypesIntoPlans([row],[planId]);
    const oid=Number(row.notetype.id);
    local=AnkiParity.noteTypes(planId==null?undefined:planId).find(x=>String(Number(x.ankiId!=null?x.ankiId:x.id))===String(oid));
    if(!local)throw new Error('Falha ao espelhar o tipo de nota oficial no planejamento.');
    if(!local.stockKind)local=AnkiParity.saveNotetype(Object.assign({},local,{stockKind:kind}),planId==null?undefined:planId)||local;
    return {officialId:oid,local,row};
  },
  async ensureOfficialStandardNotetypes(planId){
    const pid=planId!=null?planId:this._activePlanId(),out=[];
    for(const kind of ['basic','basic_reversed','basic_optional_reversed','typing','cloze']){
      out.push(await this._ensureOfficialStockNotetype(kind,pid));
    }
    out.push(await this.ensureOfficialImageOcclusionNotetype(pid));
    return out;
  },
  _fieldsForSimple(kind,nt,data){
    const names=(nt&&nt.fields||[]).map(f=>String(f.name||'')).filter(Boolean),fields={};
    const choose=(preferred,index)=>names.includes(preferred)?preferred:(names[index]||preferred);
    if(kind==='cloze'){
      fields[choose('Text',0)]=String(data.frente||'');
      if(names.length>1)fields[choose('Back Extra',1)]=String(data.verso||'');
    }else{
      fields[choose('Front',0)]=String(data.frente||'');
      if(names.length>1)fields[choose('Back',1)]=String(data.verso||'');
      if(kind==='basic_optional_reversed'&&names.length>2)fields[choose('Add Reverse',2)]=data._addReverse?'1':'';
    }
    return fields;
  },
  _materializeOfficialNote(state,planId,fallbackNotetypeId){
    if(!state||state.id==null)throw new Error('Estado oficial da nota ausente.');
    const pid=planId!=null?planId:this._activePlanId(),
      ntid=this._localNotetypeId(state.notetype_id,pid,fallbackNotetypeId),
      existing=this._noteReplicas(state.id).find(n=>String(n._planId==null?'':n._planId)===String(pid==null?'':pid)),
      base=existing||{id:Number(state.id),ankiId:Number(state.id),guid:String(state.guid||('snm-'+Number(state.id).toString(36))),notetypeId:ntid,fields:{},tags:[]};
    const saved=AnkiParity.saveNote(Object.assign({},base,{
      id:base.id||Number(state.id),ankiId:Number(state.id),guid:String(state.guid||base.guid||''),
      notetypeId:ntid,fields:Object.assign({},state.fields||{}),tags:Array.isArray(state.tags)?state.tags.slice():[]
    }),pid==null?undefined:pid);
    if(!saved)throw new Error('Falha ao materializar nota oficial '+state.id+' no Study.');
    return saved;
  },
  _cardSeed(data,planId,notetypeId){
    data=data||{};
    const out={deckId:data.deckId||null,kind:data.kind==='cloze'?'cloze':'basic',notetypeId:notetypeId||null};
    if(planId!=null)out._planId=planId;
    for(const k of ['materia','assunto','materiaTec','banca','tipo','favorito']){
      if(Object.prototype.hasOwnProperty.call(data,k))out[k]=data[k];
    }
    return out;
  },
  async addOfficialNote(opts){
    opts=opts||{};
    const pid=opts.planId!=null?opts.planId:this._activePlanId(),nt=await this._ensureOfficialNotetype(opts.notetype,pid),
      did=opts.deckId?this._officialDeckId(opts.deckId,pid):1;
    if(opts.deckId&&did==null)throw new Error('Baralho sem identidade Anki canônica.');
    const officialFields=await this._externalizeDataMediaFields(opts.fields||{},'note');
    const out=await this.request('/api/cards-official/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deck_id:Number(did||1),notetype_id:Number(nt.officialId),fields:officialFields,tags:opts.tags||[]})});
    if(!out||!out.note)throw new Error('O Anki oficial não devolveu a nota criada.');
    const note=this._materializeOfficialNote(out.note,pid,nt.local.id),seeds={};
    seeds[String(out.note.id)]=Object.assign({},opts.seed||{},{notetypeId:nt.local.id});
    await this._reconcileOfficialCardSet([out.note],out.cards||[],seeds);
    if(out.reviewer)this._applyReviewer(out.reviewer);
    this.dirty=false;this._browserCache=[];
    return {out,note,cards:AnkiProductParity._cardsForNote(note,pid)};
  },
  async updateOfficialNote(note,fields,tags,opts){
    opts=opts||{};if(!note)throw new Error('Nota não encontrada.');
    await this.bootstrap(false);
    const pid=note._planId!=null?note._planId:(opts.planId!=null?opts.planId:this._activePlanId()),oid=this._officialNoteId(note);
    if(oid==null)throw new Error('Nota sem identidade Anki canônica.');
    const officialFields=await this._externalizeDataMediaFields(fields||{},'note');
    const out=await this.request('/api/cards-official/note/'+encodeURIComponent(oid),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields:officialFields,tags:Array.isArray(tags)?tags:[]})});
    if(!out||!out.note)throw new Error('O Anki oficial não devolveu a nota atualizada.');
    const saved=this._materializeOfficialNote(out.note,pid,note.notetypeId),seeds={};seeds[String(out.note.id)]=Object.assign({},opts.seed||{});
    await this._reconcileOfficialCardSet([out.note],out.cards||[],seeds);
    if(out.reviewer)this._applyReviewer(out.reviewer);
    this.dirty=false;this._browserCache=[];
    return {out,note:saved,cards:AnkiProductParity._cardsForNote(saved,pid)};
  },
  async deleteOfficialNote(note){
    if(!note)throw new Error('Nota não encontrada.');
    await this.bootstrap(false);
    const oid=this._officialNoteId(note);if(oid==null)throw new Error('Nota sem identidade Anki canônica.');
    const reps=this._noteReplicas(oid),out=await this.request('/api/cards-official/note/'+encodeURIComponent(oid),{method:'DELETE'});
    if(!out||!out.ok)throw new Error('O Anki oficial não confirmou a exclusão da nota.');
    for(const rep of reps){
      const pid=rep._planId!=null?rep._planId:null,cards=AnkiProductParity._cardsForNote(rep,pid);
      if(cards.length)DB.deleteNoteByCard(cards[0].id,pid==null?undefined:pid);
      try{localStorage.removeItem(AnkiParity._entityKey('note',rep.id,pid==null?undefined:pid));}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-delete-note');}
    }
    if(out.reviewer)this._applyReviewer(out.reviewer);
    this.dirty=false;this._browserCache=[];return out;
  },
  async deleteNoteForCard(ref,ask){
    const card=ref&&typeof ref==='object'?ref:(CardsScreen.collectionCards().find(c=>String(c.id)===String(ref))||DB.getCard(ref));
    if(!card)throw new Error('Card não encontrado.');
    const pid=card._planId!=null?card._planId:this._activePlanId(),
      note=AnkiParity.noteForCard?AnkiParity.noteForCard(card):AnkiParity.getNote(card.noteId||card.id,pid==null?undefined:pid);
    if(!note)throw new Error('Nota canônica não encontrada.');
    const siblings=AnkiProductParity._cardsForNote(note,pid),msg=siblings.length>1?'Excluir esta nota e seus '+siblings.length+' cards?':'Excluir esta nota?';
    if(ask!==false&&!await UI.confirm(msg,{title:'Excluir nota',okText:'Excluir',danger:true}))return false;
    const out=await this.deleteOfficialNote(note);
    CardsScreen.render();CardsScreen.updateFavCount();
    return out;
  },
  async _changeNoteToNotetype(note,target,pid){
    const oldNt=AnkiParity.getNotetype(note.notetypeId,pid==null?undefined:pid),
      oldId=Number(oldNt&&oldNt.ankiId!=null?oldNt.ankiId:oldNt&&oldNt.id),newId=Number(target&&target.officialId);
    if(oldId===newId)return note;
    const qs=new URLSearchParams({old_notetype_id:String(oldId),new_notetype_id:String(newId)}),
      info=await this.request('/api/cards-official/notetypes/change-info?'+qs.toString()),input=JSON.parse(JSON.stringify(info.input||{}));
    input.note_ids=[Number(this._officialNoteId(note))];
    const out=await this.request('/api/cards-official/notetypes/change',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const ns=(out.notes||[]).find(x=>String(x.id)===String(this._officialNoteId(note)));
    if(!ns)throw new Error('O Anki oficial não devolveu a nota após a mudança de tipo.');
    const saved=this._materializeOfficialNote(ns,pid,target.local.id);
    await this._reconcileOfficialCardSet(out.notes||[],out.cards||[]);
    return saved;
  },
  async saveSimpleCard(closeAfter){
    const data=CardsScreen._readCardForm();if(!data)return false;
    const reversed=!!data._reversed;delete data._reversed;
    const editId=CardsScreen._editingId,editPlan=CardsScreen._editingPlanId;
    let pid=data.deckId?this._deckContext(data.deckId).planId:(editPlan!=null?editPlan:this._activePlanId());
    if(!editId&&data._newDeckName){
      const created=await this.createOfficialDeck(data._newDeckName,pid);
      if(!created||!created.deck)throw new Error('O Anki oficial não devolveu o baralho padrão criado.');
      data.deckId=created.deck.id;delete data._newDeckName;pid=created.deck._planId!=null?created.deck._planId:pid;
      const dest=document.getElementById('card-destino');if(dest)dest.value='deck:'+data.deckId;
    }
    if(editId){
      const card=CardsScreen.collectionCards().find(c=>String(c.id)===String(editId)&&(editPlan==null||String(c._planId||'')===String(editPlan)))||DB.getCard(editId);
      if(!card)throw new Error('Card não encontrado.');
      let note=AnkiParity.noteForCard?AnkiParity.noteForCard(card):AnkiParity.getNote(card.noteId||card.id,pid==null?undefined:pid);
      if(!note)throw new Error('Nota canônica do card não encontrada.');
      const currentNt=AnkiParity.getNotetype(note.notetypeId,pid==null?undefined:pid),
        currentStock=String(currentNt&&currentNt.stockKind||''),
        desiredKind=data.kind==='cloze'?'cloze':(['basic_reversed','basic_optional_reversed','typing'].includes(currentStock)?currentStock:'basic'),
        target=await this._ensureOfficialStockNotetype(desiredKind,pid),
        fields=this._fieldsForSimple(desiredKind,target.local,data),seed=this._cardSeed(data,pid,target.local.id);
      // O editor simples de Cloze não expõe Back Extra. Ausência de campo no
      // PUT significa "preservar", enquanto enviar "" apagaria conteúdo válido.
      if(desiredKind==='cloze'){
        const names=(target.local.fields||[]).map(f=>String(f.name||''));
        const extra=names.includes('Back Extra')?'Back Extra':names[1];
        if(extra)delete fields[extra];
      }
      note=await this._changeNoteToNotetype(note,target,pid);
      const res=await this.updateOfficialNote(note,fields,note.tags||[],{planId:pid,seed});
      CardsScreen.closeCardModal();CardsScreen.render();CardsScreen.updateFavCount();showToast('Card atualizado pelo Anki oficial ✓');return res;
    }
    const requested=['basic_reversed','basic_optional_reversed','typing'].includes(data.kind)?data.kind:(data.kind==='cloze'?'cloze':'basic'),
      desiredKind=reversed?'basic_reversed':requested,
      target=await this._ensureOfficialStockNotetype(desiredKind,pid),
      fields=this._fieldsForSimple(desiredKind,target.local,data),seed=this._cardSeed(data,pid,target.local.id),
      res=await this.addOfficialNote({planId:pid,deckId:data.deckId,notetype:target.local,fields,tags:[],seed});
    CardsScreen.render();CardsScreen.updateFavCount();
    const n=res.cards.length;showToast(n+(n===1?' card criado':' cards criados')+' pelo Anki oficial ✓');
    if(closeAfter)CardsScreen.closeCardModal();else{
      const fr=document.getElementById('card-frente'),ve=document.getElementById('card-verso');if(fr)fr.innerHTML='';if(ve)ve.innerHTML='';if(fr)fr.focus();
    }
    return res;
  },
  async deleteSimpleCard(){
    if(!CardsScreen._editingId)return false;
    const id=CardsScreen._editingId,pid=CardsScreen._editingPlanId,
      card=CardsScreen.collectionCards().find(c=>String(c.id)===String(id)&&(pid==null||String(c._planId||'')===String(pid)))||DB.getCard(id);
    if(!card)throw new Error('Card não encontrado.');
    const note=AnkiParity.noteForCard?AnkiParity.noteForCard(card):AnkiParity.getNote(card.noteId||card.id,pid==null?undefined:pid);
    if(!note)throw new Error('Nota canônica não encontrada.');
    const siblings=AnkiProductParity._cardsForNote(note,pid),msg=siblings.length>1?'Excluir esta nota e seus '+siblings.length+' cards?':'Excluir esta nota?';
    if(!await UI.confirm(msg))return false;
    const out=await this.deleteOfficialNote(note);
    CardsScreen.closeCardModal();CardsScreen.render();CardsScreen.updateFavCount();showToast('Nota excluída pelo Anki oficial ✓');return out;
  },

  async ensureOfficialImageOcclusionNotetype(planId){
    await this.bootstrap(false);
    const out=await this.request('/api/cards-official/image-occlusion/setup',{method:'POST'});
    const rows=(out&&out.notetypes||[]).map(x=>({notetype:x.notetype,use_count:x.use_count||0})).filter(x=>x.notetype);
    if(!rows.length)throw new Error('O Anki oficial não disponibilizou o tipo Image Occlusion.');
    this._syncNotetypesIntoPlans(rows,[planId]);
    const chosen=rows[0].notetype,oid=Number(chosen.id),
      local=AnkiParity.noteTypes(planId==null?undefined:planId).find(x=>String(Number(x.ankiId!=null?x.ankiId:x.id))===String(oid));
    if(!local)throw new Error('Falha ao espelhar Image Occlusion no planejamento.');
    return {officialId:oid,local,row:rows[0]};
  },
  async uploadOfficialImageOcclusionImage(src,filename){
    const raw=String(src||'');if(!raw)throw new Error('Imagem ausente.');
    let blob;
    try{blob=await fetch(raw).then(r=>{if(!r.ok&& !raw.startsWith('data:')&&!raw.startsWith('blob:'))throw new Error('imagem inacessível');return r.blob();});}
    catch(e){throw new Error('Não foi possível preparar a imagem para o Anki oficial.');}
    const type=blob.type||'image/png',ext=type.includes('jpeg')?'.jpg':type.includes('webp')?'.webp':type.includes('gif')?'.gif':'.png',
      safe=String(filename||('image-occlusion-'+Date.now()+ext)).replace(/[^A-Za-z0-9._-]+/g,'_'),
      fd=new FormData();fd.append('image',blob,safe);
    const out=await this.request('/api/cards-official/image-occlusion/image',{method:'POST',body:fd});
    if(!out||!out.filename)throw new Error('O Media Manager oficial não confirmou a imagem.');
    return out;
  },
  async saveOfficialImageOcclusion(state,payload){
    payload=payload||{};state=state||{};
    const pid=state.planId!=null?state.planId:this._activePlanId(),
      deckId=payload.deckId||state.deckId||null,seed={deckId};
    await this.bootstrap(false);
    if(state.noteId){
      const note=AnkiParity.getNote(state.noteId,pid==null?undefined:pid);
      if(!note)throw new Error('Nota de oclusão não encontrada.');
      const oid=this._officialNoteId(note);if(oid==null)throw new Error('Nota de oclusão sem identidade oficial.');
      const out=await this.request('/api/cards-official/image-occlusion/note/'+encodeURIComponent(oid),{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({occlusions:payload.occlusions,header:payload.header,back_extra:payload.backExtra,comments:payload.comments,tags:payload.tags||[]})
      });
      if(!out||!out.note)throw new Error('O Anki oficial não devolveu a oclusão atualizada.');
      const saved=this._materializeOfficialNote(out.note,pid,note.notetypeId),seeds={};seeds[String(out.note.id)]=seed;
      await this._reconcileOfficialCardSet([out.note],out.cards||[],seeds);
      if(out.reviewer)this._applyReviewer(out.reviewer);
      this.dirty=false;this._browserCache=[];
      return {out,note:saved,cards:AnkiProductParity._cardsForNote(saved,pid)};
    }
    const nt=await this.ensureOfficialImageOcclusionNotetype(pid),
      did=deckId?this._officialDeckId(deckId,pid):1;
    if(deckId&&did==null)throw new Error('Baralho sem identidade Anki canônica.');
    const media=await this.uploadOfficialImageOcclusionImage(payload.imageData,payload.imageFileName);
    const out=await this.request('/api/cards-official/image-occlusion/note',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        notetype_id:Number(nt.officialId),deck_id:Number(did||1),image_path:String(media.filename),
        occlusions:String(payload.occlusions||''),header:String(payload.header||''),back_extra:String(payload.backExtra||''),
        comments:String(payload.comments||''),tags:Array.isArray(payload.tags)?payload.tags:[]
      })
    });
    if(!out||!out.note)throw new Error('O Anki oficial não devolveu a nova nota de oclusão.');
    const saved=this._materializeOfficialNote(out.note,pid,nt.local.id),seeds={};seeds[String(out.note.id)]=seed;
    await this._reconcileOfficialCardSet([out.note],out.cards||[],seeds);
    if(out.reviewer)this._applyReviewer(out.reviewer);
    this.dirty=false;this._browserCache=[];
    return {out,note:saved,cards:AnkiProductParity._cardsForNote(saved,pid),media};
  },

  async _officialNotetypes(){
    await this.bootstrap(false);
    const out=await this.request('/api/cards-official/notetypes/full');
    return Array.isArray(out&&out.notetypes)?out.notetypes:[];
  },
  _syncNotetypesIntoPlans(rows,planIds){
    if(typeof AnkiImport==='undefined'||typeof AnkiImport._toNotetype!=='function')throw new Error('Adaptador de NoteType indisponível.');
    const ids=[...new Set((planIds||[]).map(x=>x==null?null:String(x)))];
    for(const row of rows||[]){
      const raw=row&&row.notetype;if(!raw||raw.id==null)continue;
      const converted=AnkiImport._toNotetype(raw);
      for(const key of ids){
        const pid=key==null||key==='null'?null:key;
        AnkiParity.saveNotetype(converted,pid==null?undefined:pid);
      }
    }
  },
  _officialNotetypeId(note){
    const pid=note&&note._planId!=null?note._planId:null,
      nt=note&&AnkiParity.getNotetype(note.notetypeId,pid==null?undefined:pid),
      n=Number(nt&&nt.ankiId!=null?nt.ankiId:nt&&nt.id);
    return Number.isFinite(n)&&n>0?n:null;
  },
  async _renderOfficialChangeTypeMap(oldId,newId){
    const box=document.getElementById('anki-change-type-map');if(!box)return;
    box.innerHTML='<p class="hint">Consultando mapeamento oficial do Anki…</p>';
    const qs=new URLSearchParams({old_notetype_id:String(oldId),new_notetype_id:String(newId)});
    const info=await this.request('/api/cards-official/notetypes/change-info?'+qs.toString());
    this._changeTypeInfo=info;
    const input=info.input||{},fields=info.new_field_names||[],oldFields=info.old_field_names||[],
      tmpls=info.new_template_names||[],oldTmpls=info.old_template_names||[],
      fMap=Array.isArray(input.new_fields)?input.new_fields:[],tMap=Array.isArray(input.new_templates)?input.new_templates:[];
    let html='<p class="hint">Mapeamento produzido por <code>change_notetype_info()</code>. “Descartar” envia -1 ao protobuf oficial.</p>';
    html+='<h3 class="anki-section-title">Campos</h3>';
    html+=fields.map((name,i)=>'<div class="field"><label>'+AnkiProductParity.esc(name)+'</label><select class="anki-official-field-map" data-index="'+i+'">'+
      '<option value="-1">— descartar / vazio —</option>'+oldFields.map((old,j)=>'<option value="'+j+'" '+(Number(fMap[i])===j?'selected':'')+'>'+AnkiProductParity.esc(old)+'</option>').join('')+'</select></div>').join('');
    if(tmpls.length){
      html+='<h3 class="anki-section-title">Cards / templates</h3>';
      html+=tmpls.map((name,i)=>'<div class="field"><label>'+AnkiProductParity.esc(name)+'</label><select class="anki-official-template-map" data-index="'+i+'">'+
        '<option value="-1">— novo card —</option>'+oldTmpls.map((old,j)=>'<option value="'+j+'" '+(Number(tMap[i])===j?'selected':'')+'>'+AnkiProductParity.esc(old)+'</option>').join('')+'</select></div>').join('');
    }
    box.innerHTML=html;
  },
  async _openOfficialChangeType(ids){
    const sel=this._browserOfficialSelection(ids);if(!sel.noteIds.length)return;
    const oldIds=[...new Set((sel.local.notes||[]).map(n=>this._officialNotetypeId(n)).filter(Boolean))];
    if(oldIds.length!==1){showToast('Como no Anki, selecione notas de um único tipo de origem.');return;}
    const planIds=(sel.local.notes||[]).map(n=>n._planId!=null?n._planId:null),
      rows=await this._officialNotetypes();
    this._syncNotetypesIntoPlans(rows,planIds);
    this._changeTypeSelection=sel;this._changeTypeRows=rows;this._changeTypeOldId=oldIds[0];
    const select=document.getElementById('anki-change-type-target');
    select.innerHTML=rows.map(r=>'<option value="'+AnkiProductParity.esc(r.notetype.id)+'">'+AnkiProductParity.esc(r.notetype.name||('NoteType '+r.notetype.id))+'</option>').join('');
    select.value=String(oldIds[0]);
    select.onchange=()=>{void this._renderOfficialChangeTypeMap(oldIds[0],Number(select.value));};
    await this._renderOfficialChangeTypeMap(oldIds[0],Number(select.value));
    document.getElementById('anki-change-type-modal').style.display='flex';
  },
  async _saveOfficialChangeType(){
    const sel=this._changeTypeSelection,info=this._changeTypeInfo;if(!sel||!info)return;
    const input=JSON.parse(JSON.stringify(info.input||{}));
    input.note_ids=sel.noteIds.slice();
    input.new_fields=[...document.querySelectorAll('#anki-change-type-map .anki-official-field-map')].map(x=>Number(x.value));
    const templates=[...document.querySelectorAll('#anki-change-type-map .anki-official-template-map')];
    if(templates.length)input.new_templates=templates.map(x=>Number(x.value));
    const out=await this.request('/api/cards-official/notetypes/change',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)
    });
    const targetId=Number(input.new_notetype_id),planIds=(sel.local.notes||[]).map(n=>n._planId!=null?n._planId:null);
    this._syncNotetypesIntoPlans(this._changeTypeRows||[],planIds);
    await this._syncOfficialNotes(out.notes||[]);
    await this._reconcileOfficialCardSet(out.notes||[],out.cards||[]);
    if(out.reviewer)this._applyReviewer(out.reviewer);
    document.getElementById('anki-change-type-modal').style.display='none';
    this._browserCache=[];this._scheduleOfficialBrowser();CardsScreen.render();CardsScreen.updateFavCount();
    showToast('Tipo de nota alterado pelo Anki oficial ✓');
    this._changeTypeSelection=null;this._changeTypeInfo=null;
  },
  async _reconcileOfficialCardSet(noteStates,cardStates,seedByNote){
    const byNote=new Map();
    for(const state of cardStates||[]){
      const k=String(state.note_id);if(!byNote.has(k))byNote.set(k,[]);byNote.get(k).push(state);
    }
    for(const ns of noteStates||[]){
      const officialCards=byNote.get(String(ns.id))||[],keep=new Set(officialCards.map(s=>String(s.id))),
        noteReps=this._noteReplicas(ns.id);
      for(const note of noteReps){
        const pid=note._planId!=null?note._planId:null,nt=AnkiParity.getNotetype(note.notetypeId,pid==null?undefined:pid),
          current=pid!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(pid,'cards'):DB.getCards(),
          same=current.filter(c=>String(c.ankiNoteId||c.noteId)===String(ns.id)||String(c.noteId)===String(note.id)),
          externalSeed=seedByNote&&seedByNote[String(ns.id)]||{},
          existingByOfficial=new Map(same.map(c=>[String(this._officialId(c)),Object.assign({},c,pid==null?{}:{_planId:pid})]));
        for(const state of officialCards){
          const studySeed=this._studySeedForState(state,pid),
            seed=Object.assign({},studySeed,same[0]||{},externalSeed);
          let card=existingByOfficial.get(String(state.id));
          if(!card){
            const data={
              ankiId:Number(state.id),ankiNoteId:Number(state.note_id),noteId:note.id,notetypeId:note.notetypeId,
              ankiTemplateOrd:Number(state.template_idx)||0,
              deckId:this._localDeckId(state.deck_id,pid,seed.deckId)||seed.deckId||null,
              materia:seed.materia||null,assunto:seed.assunto||'',materiaTec:seed.materiaTec||'',banca:seed.banca||'',tipo:seed.tipo||'',
              kind:nt&&nt.kind==='cloze'?'cloze':'basic',
              template:nt&&nt.kind==='cloze'?'cloze:'+(Number(state.template_idx)+1):(Number(state.template_idx)===1?'reverse':'forward'),
              clozeOrd:nt&&nt.kind==='cloze'?Number(state.template_idx)+1:null,frente:'',verso:''
            };
            card=pid!=null&&DB.addCardForPlan?DB.addCardForPlan(pid,data):DB.addCard(data);
            if(!card)throw new Error('Falha ao criar réplica do card oficial '+state.id+'.');
          }
          const patch=Object.assign(this._statePatch(state,card),{
            notetypeId:note.notetypeId,ankiNoteId:Number(state.note_id),ankiTemplateOrd:Number(state.template_idx)||0,
            kind:nt&&nt.kind==='cloze'?'cloze':'basic',
            template:nt&&nt.kind==='cloze'?'cloze:'+(Number(state.template_idx)+1):(Number(state.template_idx)===1?'reverse':'forward'),
            clozeOrd:nt&&nt.kind==='cloze'?Number(state.template_idx)+1:null
          });
          const metaSeed=Object.assign({},this._studySeedForState(state,pid),externalSeed);
          for(const k of ['deckId','materia','assunto','materiaTec','banca','tipo','favorito']){
            if(Object.prototype.hasOwnProperty.call(metaSeed,k))patch[k]=metaSeed[k];
          }
          if(window.StudyGlobalScope&&StudyGlobalScope.updateCardScoped)StudyGlobalScope.updateCardScoped(card,patch,pid);
          else DB.updateCard(card.id,patch);
        }
        const fresh=pid!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(pid,'cards'):DB.getCards(),
          filtered=fresh.filter(c=>{
            const isNote=String(c.ankiNoteId||c.noteId)===String(ns.id)||String(c.noteId)===String(note.id);
            return !isNote||keep.has(String(this._officialId(c)));
          });
        if(pid!=null&&DB.saveCardsForPlan)DB.saveCardsForPlan(pid,filtered);else DB.saveCards(filtered);
      }
    }
  },

  _installOfficialBrowser(){
    if(!window.AnkiProductParity||!window.AnkiMaxParity||this._browserInstalled)return;
    this._browserInstalled=true;this._browserSeq=0;this._browserCache=[];
    this._origBrowserRows=AnkiProductParity._browserRows.bind(AnkiProductParity);
    this._origBrowserRender=AnkiProductParity.renderBrowser.bind(AnkiProductParity);
    this._origOpenBrowser=AnkiProductParity.openBrowser.bind(AnkiProductParity);
    const self=this;
    AnkiProductParity._browserRows=()=>self._browserCache||[];
    AnkiProductParity.renderBrowser=()=>{
      const list=document.getElementById('anki-browser-list'),summary=document.getElementById('anki-browser-summary');
      if(summary)summary.textContent='Consultando busca oficial do Anki…';
      if(list&&!self._browserCache.length)list.innerHTML='<div class="empty-state"><h3>Consultando…</h3><p>A gramática e a ordem vêm do Anki oficial.</p></div>';
      self._scheduleOfficialBrowser();
    };
    AnkiProductParity.openBrowser=function(){
      const out=self._origOpenBrowser.apply(this,arguments);
      void self._loadOfficialBrowserFacets();
      return out;
    };
    AnkiProductParity.previewNote=(ref)=>{
      const note=ref&&typeof ref==='object'?ref:AnkiParity.getNote(ref);
      if(!note){showToast('Nota não encontrada.');return;}
      const cards=AnkiProductParity._cardsForNote(note,note._planId);
      if(!cards.length){showToast('A nota não possui card para pré-visualizar.');return;}
      void self.previewBrowserCard(cards[0],{note}).catch(e=>showToast('Prévia oficial indisponível: '+(e.message||e)));
    };
    AnkiProductParity.toggleSuspend=ids=>void self._browserToggleSuspend(ids);
    AnkiProductParity.bulkFlag=ids=>void self._browserBulkFlag(ids);
    AnkiProductParity.bulkMark=ids=>void self._browserBulkMark(ids);
    AnkiProductParity.editTags=ids=>void self._browserEditTags(ids);
    AnkiProductParity.bulkFindReplace=ids=>void self._browserFindReplace(ids);
    AnkiProductParity.deleteNotes=ids=>void self._browserDeleteNotes(ids);
    AnkiProductParity.openChangeType=ids=>void self._openOfficialChangeType(ids);
    const oldChangeSave=document.getElementById('anki-change-type-save');
    if(oldChangeSave){
      const clean=oldChangeSave.cloneNode(true);oldChangeSave.replaceWith(clean);
      clean.addEventListener('click',()=>void self._saveOfficialChangeType().catch(e=>showToast('Mudança de tipo não aplicada: '+(e.message||e))));
    }
    AnkiMaxParity._bulkCardsMove=ids=>void self._browserMove(ids);
    AnkiMaxParity._bulkCardsDue=ids=>void self._browserSetDue(ids);
    AnkiMaxParity._bulkCardsForget=ids=>void self._browserForget(ids);
    AnkiMaxParity._bulkCardsReposition=ids=>void self._browserReposition(ids);
    const sortable=key=>!!self._browserSortKey(key);
    AnkiMaxParity._isSortableColumn=sortable;
  },


  _deckContext(localDeckId){
    const d=CardsScreen.collectionDecks().find(x=>String(x.id)===String(localDeckId)),
      pid=d&&d._planId!=null?d._planId:this._activePlanId(),
      oid=this._officialDeckId(localDeckId,pid);
    if(!d)throw new Error('Baralho local não encontrado.');
    if(oid==null)throw new Error('Baralho sem identidade Anki canônica.');
    return {deck:d,planId:pid,officialId:oid};
  },
  _mirrorByOfficialDeck(officialId,planId){
    const rows=planId!=null&&window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(planId,'decks'):DB.getDecks();
    const d=(rows||[]).find(x=>String(x.ankiId!=null?x.ankiId:x.id)===String(officialId));
    return d?Object.assign({},d,planId==null?{}:{_planId:planId}):null;
  },
  async _loadCustomStudyDefaults(){
    const el=document.getElementById('cards-custom-deck');if(!el||!el.value)return;
    try{
      await this.bootstrap(false);
      const ctx=this._deckContext(el.value),data=await this.request('/api/cards-official/custom-study/defaults/'+ctx.officialId),
        mode=(document.getElementById('cards-custom-mode')||{}).value||'forgot',
        value=document.getElementById('cards-custom-value');
      if(value&&mode==='newLimitDelta')value.value=String(Math.max(0,Number(data.extend_new)||0));
      if(value&&mode==='reviewLimitDelta')value.value=String(Math.max(0,Number(data.extend_review)||0));
      const tags=Array.isArray(data.tags)?data.tags:[],
        inc=tags.filter(x=>x&&x.include).map(x=>x.name),exc=tags.filter(x=>x&&x.exclude).map(x=>x.name),
        ie=document.getElementById('cards-custom-tags-in'),ee=document.getElementById('cards-custom-tags-out');
      if(ie&&inc.length)ie.value=inc.join(', ');if(ee&&exc.length)ee.value=exc.join(', ');
    }catch(e){showToast('Padrões oficiais do Estudo Personalizado indisponíveis: '+(e.message||e));}
  },
  openCustomStudy(){
    this._orig.openCustomStudy.call(CardsScreen);
    const deck=document.getElementById('cards-custom-deck'),mode=document.getElementById('cards-custom-mode');
    if(deck&&!deck.dataset.officialDefaults){
      deck.dataset.officialDefaults='1';deck.addEventListener('change',()=>void this._loadCustomStudyDefaults());
    }
    if(mode&&!mode.dataset.officialDefaults){
      mode.dataset.officialDefaults='1';mode.addEventListener('change',()=>void this._loadCustomStudyDefaults());
    }
    void this._loadCustomStudyDefaults();
  },
  _customStudyPayload(ctx){
    const kind=(document.getElementById('cards-custom-mode')||{}).value||'forgot',
      value=Math.max(0,Math.round(Number((document.getElementById('cards-custom-value')||{}).value)||0)),
      payload={deck_id:Number(ctx.officialId)};
    if(kind==='newLimitDelta')payload.new_limit_delta=value;
    else if(kind==='reviewLimitDelta')payload.review_limit_delta=value;
    else if(kind==='forgot')payload.forgot_days=value;
    else if(kind==='ahead')payload.review_ahead_days=value;
    else if(kind==='preview')payload.preview_days=value;
    else if(kind==='cram'){
      const ck=(document.getElementById('cards-custom-cram-kind')||{}).value||'due',
        kindMap={due:0,new:1,review:2,all:3},
        tags=id=>String((document.getElementById(id)||{}).value||'').split(',').map(x=>x.trim()).filter(Boolean);
      payload.cram={
        kind:kindMap[ck]==null?0:kindMap[ck],
        card_limit:Math.max(0,Math.round(Number((document.getElementById('cards-custom-limit')||{}).value)||0)),
        tags_to_include:tags('cards-custom-tags-in'),tags_to_exclude:tags('cards-custom-tags-out')
      };
    }else throw new Error('Modo de Estudo Personalizado desconhecido.');
    return {kind,payload};
  },
  async runCustomStudy(){
    const deckId=(document.getElementById('cards-custom-deck')||{}).value;
    if(!deckId){showToast('Escolha o baralho de origem');return;}
    try{
      await this.bootstrap(false);
      const ctx=this._deckContext(deckId),req=this._customStudyPayload(ctx),
        out=await this.request('/api/cards-official/custom-study',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req.payload)
        }),
        synced=await this._syncCollectionState(out.state,ctx.planId,null);
      const modal=document.getElementById('cards-custom-modal');if(modal)modal.style.display='none';
      this.dirty=false;this._browserCache=[];
      if(req.kind==='newLimitDelta'||req.kind==='reviewLimitDelta'){
        CardsScreen.render();showToast('Limite de hoje atualizado pelo Anki oficial ✓');return;
      }
      const state=out.state||{},filtered=(state.decks||[]).filter(x=>x&&x.filtered),
        withCards=filtered.map(d=>({d,count:(state.cards||[]).filter(c=>Number(c.deck_id)===Number(d.id)).length})).sort((a,b)=>b.count-a.count),
        chosen=withCards[0]&&withCards[0].d,mirror=chosen&&this._mirrorByOfficialDeck(chosen.id,ctx.planId);
      CardsScreen.populateFilterOptions();CardsScreen.renderDeckList();
      if(mirror)CardsScreen.irParaBaralho(mirror.id,'revisar');else CardsScreen.render();
      showToast('Estudo Personalizado executado pelo Anki oficial'+(withCards[0]?' · '+withCards[0].count+' card(s)':'')+' ✓');
      return synced;
    }catch(e){showToast('Estudo Personalizado não aplicado: '+(e.message||e));}
  },
  _fillFilteredForm(deck){
    if(!deck)return;
    const cfg=this._filteredConfigFromOfficial({filtered_deck:deck}),terms=cfg.searchTerms||[],
      t1=terms[0]||{search:'',limit:100,order:1},t2=terms[1]||{search:'',limit:100,order:1};
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v==null?'':String(v);};
    set('cards-filtered-name',deck.name||'Baralho filtrado');set('cards-filtered-search1',t1.search||'');set('cards-filtered-limit1',t1.limit==null?100:t1.limit);
    set('cards-filtered-search2',t2.search||'');set('cards-filtered-limit2',t2.limit==null?100:t2.limit);
    const o1=document.getElementById('cards-filtered-order1'),o2=document.getElementById('cards-filtered-order2');
    if(o1)o1.innerHTML=CardsScreen._filteredOrderOptions(t1.order);if(o2)o2.innerHTML=CardsScreen._filteredOrderOptions(t2.order);
    const res=document.getElementById('cards-filtered-reschedule');if(res)res.checked=!!cfg.reschedule;
    set('cards-filtered-again',cfg.previewAgainSecs);set('cards-filtered-hard',cfg.previewHardSecs);set('cards-filtered-good',cfg.previewGoodSecs);
    CardsScreen.updateFilteredDeckUI();
  },
  async openFilteredDeckModal(deckId){
    this._orig.openFilteredDeckModal.call(CardsScreen,deckId);
    try{
      await this.bootstrap(false);
      const officialId=deckId?this._deckContext(deckId).officialId:0,
        out=await this.request('/api/cards-official/filtered-deck/'+officialId);
      this._fillFilteredForm(out.deck);
    }catch(e){
      const modal=document.getElementById('cards-filtered-modal');if(modal)modal.style.display='none';
      showToast('Baralho filtrado oficial indisponível: '+(e.message||e));
    }
  },
  _filteredPayload(base,id,name){
    const cfg=Object.assign({},base&&base.config||{}),
      term=n=>({
        search:String((document.getElementById('cards-filtered-search'+n)||{}).value||'').trim(),
        limit:Math.max(0,Math.round(Number((document.getElementById('cards-filtered-limit'+n)||{}).value)||0)),
        order:Math.max(0,Math.round(Number((document.getElementById('cards-filtered-order'+n)||{}).value)||0))
      }),
      a=term(1),b=term(2),terms=[a];if(b.search||b.limit)terms.push(b);
    Object.assign(cfg,{
      reschedule:!!(document.getElementById('cards-filtered-reschedule')||{}).checked,
      search_terms:terms,
      preview_again_secs:Math.max(0,Math.round(Number((document.getElementById('cards-filtered-again')||{}).value)||0)),
      preview_hard_secs:Math.max(0,Math.round(Number((document.getElementById('cards-filtered-hard')||{}).value)||0)),
      preview_good_secs:Math.max(0,Math.round(Number((document.getElementById('cards-filtered-good')||{}).value)||0))
    });
    return {id:Number(id),name:String(name),config:cfg,allow_empty:true};
  },
  async saveFilteredDeckModal(){
    const localId=(document.getElementById('cards-filtered-id')||{}).value||null,
      name=String((document.getElementById('cards-filtered-name')||{}).value||'').trim();
    if(!name){showToast('Informe o nome do baralho');return;}
    try{
      await this.bootstrap(false);
      const local=localId?CardsScreen.collectionDecks().find(x=>String(x.id)===String(localId)):null,
        pid=local&&local._planId!=null?local._planId:this._activePlanId();
      let oid=localId?this._officialDeckId(localId,pid):0,
        current=await this.request('/api/cards-official/filtered-deck/'+(oid||0));
      oid=Number(current&&current.deck&&current.deck.id)||oid;
      if(!oid)throw new Error('O Anki não forneceu a identidade do novo filtered deck.');
      const payload=this._filteredPayload(current.deck,oid,name);
      await this.request('/api/cards-official/filtered-deck/'+oid,{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      });
      const out=await this.request('/api/cards-official/filtered-deck/'+oid+'/rebuild',{method:'POST'}),
        synced=await this._syncCollectionState(out.state,pid,localId),
        mirror=this._mirrorByOfficialDeck(oid,pid),count=(out.state&&out.state.cards||[]).filter(c=>Number(c.deck_id)===oid).length;
      const modal=document.getElementById('cards-filtered-modal');if(modal)modal.style.display='none';
      this.dirty=false;this._browserCache=[];CardsScreen.populateFilterOptions();CardsScreen.renderDeckList();
      if(mirror)CardsScreen.irParaBaralho(mirror.id,'revisar');else CardsScreen.render();
      showToast('Baralho filtrado reconstruído pelo Anki oficial: '+count+' card(s) ✓');
      return synced;
    }catch(e){showToast('Baralho filtrado não reconstruído: '+(e.message||e));}
  },


  _deckOptionEnum(kind,value){
    const maps={
      reviewOrder:{day:0,dayThenDeck:1,deckThenDay:2,intervalsAsc:3,intervalsDesc:4,easeAsc:5,easeDesc:6,retrievabilityAsc:7,random:8,added:9,reverseAdded:10,retrievabilityDesc:11,relativeOverdueness:12},
      newGatherOrder:{deck:0,posicao:1,posicaoDesc:2,randomNotes:3,randomCards:4,deckRandomNotes:5},
      newSortOrder:{template:0,coleta:1,templateRandom:2,randomNoteTemplate:3,randomCard:4},
      mix:{misturar:0,depois:1,antes:2}
    };
    const map=maps[kind]||{};return Object.prototype.hasOwnProperty.call(map,value)?map[value]:0;
  },
  _deckOptionUiEnum(kind,value){
    const maps={
      reviewOrder:['day','dayThenDeck','deckThenDay','intervalsAsc','intervalsDesc','easeAsc','easeDesc','retrievabilityAsc','random','added','reverseAdded','retrievabilityDesc','relativeOverdueness'],
      newGatherOrder:['deck','posicao','posicaoDesc','randomNotes','randomCards','deckRandomNotes'],
      newSortOrder:['template','coleta','templateRandom','randomNoteTemplate','randomCard'],
      mix:['misturar','depois','antes']
    };
    const map=maps[kind]||[],idx=Number(value);
    return Number.isInteger(idx)&&map[idx]!=null?map[idx]:map[0];
  },
  _officialDeckOptionsUi(options,isDeck){
    options=options||{};
    const all=Array.isArray(options.all_config)?options.all_config:[],
      currentId=Number(options.current_deck&&options.current_deck.config_id)||1,
      entry=all.find(x=>Number(x&&x.config&&x.config.id)===currentId)
        ||all.find(x=>Number(x&&x.config&&x.config.id)===1)
        ||{config:options.defaults||{}},
      row=entry.config||options.defaults||{},c=row.config||{},
      cfg={
        weights:Array.isArray(c.fsrs_params_6)?c.fsrs_params_6.map(Number).filter(Number.isFinite):[],
        learnSteps:Array.isArray(c.learn_steps)?c.learn_steps.map(Number).filter(Number.isFinite):[],
        relearnSteps:Array.isArray(c.relearn_steps)?c.relearn_steps.map(Number).filter(Number.isFinite):[],
        newPerDay:Math.max(0,Number(c.new_per_day)||0),revPerDay:Math.max(0,Number(c.reviews_per_day)||0),
        initialEase:Number(c.initial_ease)||2.5,easyMultiplier:Number(c.easy_multiplier)||1.3,
        hardMultiplier:Number(c.hard_multiplier)||1.2,lapseMultiplier:Number(c.lapse_multiplier)||0,
        intervalMultiplier:Number(c.interval_multiplier)||1,maxInterval:Math.max(1,Number(c.maximum_review_interval)||36500),
        minimumLapseInterval:Math.max(1,Number(c.minimum_lapse_interval)||1),
        graduatingIntervalGood:Math.max(1,Number(c.graduating_interval_good)||1),
        graduatingIntervalEasy:Math.max(1,Number(c.graduating_interval_easy)||4),
        newInsertOrder:Number(c.new_card_insert_order)===1?'aleatoria':'sequencial',
        newGatherOrder:this._deckOptionUiEnum('newGatherOrder',c.new_card_gather_priority),
        newSortOrder:this._deckOptionUiEnum('newSortOrder',c.new_card_sort_order),
        newMix:this._deckOptionUiEnum('mix',c.new_mix),reviewOrder:this._deckOptionUiEnum('reviewOrder',c.review_order),
        interdayMix:this._deckOptionUiEnum('mix',c.interday_learning_mix),
        leechAction:Number(c.leech_action)===0?'suspend':'tag',leechThreshold:Math.max(0,Number(c.leech_threshold)||0),
        disableAutoplay:!!c.disable_autoplay,capAnswerTimeToSecs:Math.max(0,Number(c.cap_answer_time_to_secs)||0),
        showTimer:!!c.show_timer,stopTimerOnAnswer:!!c.stop_timer_on_answer,
        secondsToShowQuestion:Math.max(0,Number(c.seconds_to_show_question)||0),
        secondsToShowAnswer:Math.max(0,Number(c.seconds_to_show_answer)||0),
        questionAction:Math.max(0,Math.min(1,Number(c.question_action)||0)),
        answerAction:Math.max(0,Math.min(4,Number(c.answer_action)||0)),
        waitForAudio:c.wait_for_audio!==false,skipQuestionWhenReplayingAnswer:!!c.skip_question_when_replaying_answer,
        buryNew:!!c.bury_new,buryReviews:!!c.bury_reviews,buryInterdayLearning:!!c.bury_interday_learning,
        retention:Math.max(.7,Math.min(.99,Number(c.desired_retention)||.9)),
        ignoreRevlogsBefore:String(c.ignore_revlogs_before_date||''),
        easyDays:Array.isArray(c.easy_days_percentages)&&c.easy_days_percentages.length===7?c.easy_days_percentages.map(Number):[1,1,1,1,1,1,1],
        historicalRetention:Math.max(.5,Math.min(.99,Number(c.historical_retention)||.9)),
        paramSearch:String(c.param_search||'')
      },
      global={
        algo:options.fsrs===false?'sm2':'fsrs',
        newCardsIgnoreReviewLimit:!!options.new_cards_ignore_review_limit,
        applyAllParentLimits:!!options.apply_all_parent_limits
      };
    return {config:cfg,global,hasPreset:!!isDeck&&currentId!==1,currentId,entry,options};
  },
  async getDeckOptionsUi(deckId){
    await this.bootstrap(false);
    const isDeck=deckId!=null&&deckId!=='',
      ctx=isDeck?this._deckContext(deckId):{officialId:1,planId:this._activePlanId(),deck:null},
      options=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId)+'/options');
    return Object.assign(this._officialDeckOptionsUi(options,isDeck),{ctx,isDeck});
  },
  async officialFsrsScopes(){
    const out=[],seen=new Set(),global=await this.getDeckOptionsUi(null);
    if(global.global.algo!=='fsrs')return out;
    out.push({deckId:null,configId:global.currentId});seen.add(String(global.currentId));
    for(const deck of (CardsScreen.collectionDecks?CardsScreen.collectionDecks():[])){
      if(!deck||deck.id==null)continue;
      try{
        const row=await this.getDeckOptionsUi(deck.id),key=String(row.currentId);
        if(seen.has(key))continue;
        seen.add(key);out.push({deckId:deck.id,configId:row.currentId});
      }catch(_){ if(typeof _quiet==='function')_quiet(_,'cards-official-fsrs-scopes'); }
    }
    return out;
  },
  _officialDeckConfigFromLocal(base,cfg,deckId,identity){
    const row=JSON.parse(JSON.stringify(base||{})),c=Object.assign({},row.config||{}),
      weights=Array.isArray(cfg&&cfg.weights)?cfg.weights:(Array.isArray(c.fsrs_params_6)?c.fsrs_params_6:[]);
    row.id=Number(identity&&identity.id!=null?identity.id:(row.id||0));
    if(identity&&identity.name!=null)row.name=String(identity.name);
    Object.assign(c,{
      learn_steps:Array.isArray(cfg.learnSteps)?cfg.learnSteps.map(Number).filter(Number.isFinite):[],
      relearn_steps:Array.isArray(cfg.relearnSteps)?cfg.relearnSteps.map(Number).filter(Number.isFinite):[],
      fsrs_params_6:Array.isArray(weights)?weights.map(Number).filter(Number.isFinite):[],
      new_per_day:Math.max(0,Math.round(Number(cfg.newPerDay)||0)),
      reviews_per_day:Math.max(0,Math.round(Number(cfg.revPerDay)||0)),
      initial_ease:Number(cfg.initialEase)||2.5,
      easy_multiplier:Number(cfg.easyMultiplier)||1.3,
      hard_multiplier:Number(cfg.hardMultiplier)||1.2,
      lapse_multiplier:Number(cfg.lapseMultiplier)||0,
      interval_multiplier:Number(cfg.intervalMultiplier)||1,
      maximum_review_interval:Math.max(1,Math.round(Number(cfg.maxInterval)||36500)),
      minimum_lapse_interval:Math.max(1,Math.round(Number(cfg.minimumLapseInterval)||1)),
      graduating_interval_good:Math.max(1,Math.round(Number(cfg.graduatingIntervalGood)||1)),
      graduating_interval_easy:Math.max(1,Math.round(Number(cfg.graduatingIntervalEasy)||4)),
      new_card_insert_order:cfg.newInsertOrder==='aleatoria'?1:0,
      new_card_gather_priority:this._deckOptionEnum('newGatherOrder',cfg.newGatherOrder),
      new_card_sort_order:this._deckOptionEnum('newSortOrder',cfg.newSortOrder),
      new_mix:this._deckOptionEnum('mix',cfg.newMix),
      review_order:this._deckOptionEnum('reviewOrder',cfg.reviewOrder),
      interday_learning_mix:this._deckOptionEnum('mix',cfg.interdayMix),
      leech_action:cfg.leechAction==='suspend'?0:1,
      leech_threshold:Math.max(0,Math.round(Number(cfg.leechThreshold)||0)),
      disable_autoplay:!!cfg.disableAutoplay,
      cap_answer_time_to_secs:Math.max(0,Math.round(Number(cfg.capAnswerTimeToSecs)||0)),
      show_timer:!!cfg.showTimer,
      stop_timer_on_answer:!!cfg.stopTimerOnAnswer,
      seconds_to_show_question:Math.max(0,Number(cfg.secondsToShowQuestion)||0),
      seconds_to_show_answer:Math.max(0,Number(cfg.secondsToShowAnswer)||0),
      question_action:Math.max(0,Math.min(1,Math.round(Number(cfg.questionAction)||0))),
      answer_action:Math.max(0,Math.min(4,Math.round(Number(cfg.answerAction)||0))),
      wait_for_audio:cfg.waitForAudio!==false,
      skip_question_when_replaying_answer:!!cfg.skipQuestionWhenReplayingAnswer,
      bury_new:!!cfg.buryNew,
      bury_reviews:!!cfg.buryReviews,
      bury_interday_learning:!!cfg.buryInterdayLearning,
      desired_retention:Math.max(.7,Math.min(.99,Number(cfg.retention)||.9)),
      ignore_revlogs_before_date:String(cfg.ignoreRevlogsBefore||''),
      easy_days_percentages:Array.isArray(cfg.easyDays)&&cfg.easyDays.length===7?cfg.easyDays.map(x=>Math.max(0,Math.min(1,Number(x)||0))):[1,1,1,1,1,1,1],
      historical_retention:Math.max(.5,Math.min(.99,Number(cfg.historicalRetention)||.9)),
      param_search:String(cfg.paramSearch||'')
    });
    row.config=c;return row;
  },
  _saveDeckConfigIdentity(localDeckId,planId,configId){
    if(localDeckId==null||!Number.isFinite(Number(configId))||Number(configId)<=0)return;
    const pid=planId!=null?planId:this._activePlanId(),
      raw=window.StudyGlobalScope&&StudyGlobalScope._rows?StudyGlobalScope._rows(pid,'decks'):DB.getDecks(),
      list=(raw||[]).map(x=>Object.assign({},x)),
      hit=list.find(x=>String(x.id)===String(localDeckId));
    if(!hit)return;
    hit.configId=Number(configId);hit.updatedAt=new Date().toISOString();
    const clean=x=>{const y=DB._semTransitorios?DB._semTransitorios(x):Object.assign({},x);delete y._planId;delete y._planNome;return y;},
      saved=pid!=null?DB._set(DB.keysForPlan(pid).decks,list.map(clean)):DB.saveDecks(list.map(clean));
    if(saved===false)throw new Error('Falha ao persistir a identidade oficial do preset.');
  },
  async updateDeckOptions(deckId,cfg,opts){
    opts=Object.assign({hadPreset:false,fsrsReschedule:false,deckName:''},opts||{});
    await this.bootstrap(false);
    const isDeck=deckId!=null&&deckId!=='',
      ctx=isDeck?this._deckContext(deckId):{officialId:1,planId:this._activePlanId(),deck:null},
      current=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId)+'/options'),
      all=Array.isArray(current.all_config)?current.all_config:[],
      currentId=Number(current.current_deck&&current.current_deck.config_id)||1;
    let targetId=isDeck?(opts.forceCurrentPreset?currentId:(opts.hadPreset?currentId:0)):1,
      baseEntry=all.find(x=>Number(x&&x.config&&x.config.id)===Number(targetId||currentId))
        ||all.find(x=>Number(x&&x.config&&x.config.id)===currentId)
        ||{config:current.defaults||{}},
      base=baseEntry.config||current.defaults||{},
      name=isDeck&&!opts.hadPreset?String(opts.deckName||ctx.deck&&ctx.deck.nome||'Preset'):String(base.name||(!isDeck?'Default':opts.deckName||'Preset')),
      conf=this._officialDeckConfigFromLocal(base,cfg,isDeck?deckId:null,{id:targetId,name});
    const globalCfg=isDeck?{
        newCardsIgnoreReviewLimit:!!current.new_cards_ignore_review_limit,
        algo:current.fsrs===false?'sm2':'fsrs',
        applyAllParentLimits:!!current.apply_all_parent_limits
      }:cfg,
      payload={
        target_deck_id:Number(ctx.officialId),
        configs:[conf],
        removed_config_ids:[],
        mode:0,
        card_state_customizer:String(current.card_state_customizer||''),
        limits:Object.assign({},current.current_deck&&current.current_deck.limits||{}),
        new_cards_ignore_review_limit:!!globalCfg.newCardsIgnoreReviewLimit,
        fsrs:String(globalCfg.algo||'fsrs')!=='sm2',
        apply_all_parent_limits:!!globalCfg.applyAllParentLimits,
        fsrs_reschedule:!!opts.fsrsReschedule,
        fsrs_health_check:false
      },
      out=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId)+'/options',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      });
    if(!out||!out.options)throw new Error('O Anki oficial não devolveu Deck Options após salvar.');
    const selectedId=Number(out.options.current_deck&&out.options.current_deck.config_id)||0;
    if(isDeck)this._saveDeckConfigIdentity(deckId,ctx.planId,selectedId);
    await this._syncCollectionState(out.state,ctx.planId,null);
    this.dirty=false;this._browserCache=[];
    return out;
  },





  _fsrsRelearningStepsInDay(steps){
    let count=0,total=0;
    for(const step of Array.isArray(steps)?steps:[]){
      total+=Number(step)||0;if(total>=1440)break;count++;
    }
    return count;
  },
  _fsrsIgnoreBeforeMs(date){
    const raw=String(date||'').trim();if(!raw)return 0;
    const ms=new Date(raw+'T00:00:00').getTime();return Number.isFinite(ms)?ms:0;
  },
  async computeFsrsParams(deckId,healthCheck){
    await this.bootstrap(false);
    const isDeck=deckId!=null&&deckId!=='',
      ctx=isDeck?this._deckContext(deckId):{officialId:1,planId:this._activePlanId(),deck:null},
      options=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId)+'/options'),
      currentId=Number(options.current_deck&&options.current_deck.config_id)||1,
      entry=(options.all_config||[]).find(x=>Number(x&&x.config&&x.config.id)===currentId);
    if(!entry||!entry.config)throw new Error('Preset oficial atual não encontrado para otimização FSRS.');
    const preset=entry.config,pc=preset.config||{},presetName=String(preset.name||'Default').replace(/\\/g,'\\\\').replace(/"/g,'\\"'),
      search=String(pc.param_search||'').trim()||('preset:"'+presetName+'" -is:suspended'),
      payload={
        search,
        current_params:Array.isArray(pc.fsrs_params_6)?pc.fsrs_params_6:[],
        ignore_revlogs_before_ms:this._fsrsIgnoreBeforeMs(pc.ignore_revlogs_before_date),
        num_of_relearning_steps:this._fsrsRelearningStepsInDay(pc.relearn_steps),
        health_check:!!healthCheck
      },
      out=await this.request('/api/cards-official/fsrs/optimize',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
      });
    return {out,options,entry,ctx,isDeck,search,currentId};
  },
  async optimizeFsrsPreset(deckId){
    const r=await this.computeFsrsParams(deckId,false),params=Array.isArray(r.out&&r.out.params)?r.out.params.map(Number).filter(Number.isFinite):[],
      before=Array.isArray(r.entry.config.config&&r.entry.config.config.fsrs_params_6)?r.entry.config.config.fsrs_params_6.map(Number):[],
      same=params.length===before.length&&params.every((x,i)=>Math.abs(x-before[i])<0.00005);
    if(!params.length||same)return {params:params.length?params:before,fsrsItems:Number(r.out&&r.out.fsrs_items)||0,alreadyOptimal:true,search:r.search};
    const ui=await this.getDeckOptionsUi(deckId==null?null:deckId),desired=Object.assign({},ui.config,{weights:params});
    await this.updateDeckOptions(deckId,desired,{
      hadPreset:ui.hasPreset,
      forceCurrentPreset:true,fsrsReschedule:false,
      deckName:r.entry.config.name||''
    });
    return {params,fsrsItems:Number(r.out&&r.out.fsrs_items)||0,alreadyOptimal:false,search:r.search};
  },
  async fsrsHealthCheck(deckId){
    const r=await this.computeFsrsParams(deckId,true);
    return {
      fsrsItems:Number(r.out&&r.out.fsrs_items)||0,
      passed:r.out&&Object.prototype.hasOwnProperty.call(r.out,'health_check_passed')?!!r.out.health_check_passed:null,
      params:Array.isArray(r.out&&r.out.params)?r.out.params.slice():[],
      search:r.search
    };
  },



  async simulateFsrsPreset(deckId,days,retention,opts,mode){
    opts=opts||{};mode=mode||'review';
    await this.bootstrap(false);
    const isDeck=deckId!=null&&deckId!=='',
      ctx=isDeck?this._deckContext(deckId):{officialId:1,planId:this._activePlanId(),deck:null},
      options=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId)+'/options'),
      currentId=Number(options.current_deck&&options.current_deck.config_id)||1,
      entry=(options.all_config||[]).find(x=>Number(x&&x.config&&x.config.id)===currentId);
    if(!entry||!entry.config)throw new Error('Preset oficial atual não encontrado para o simulador FSRS.');
    const preset=entry.config,pc=preset.config||{},presetName=String(preset.name||'Default').replace(/\\/g,'\\\\').replace(/"/g,'\\"'),
      search=String(pc.param_search||'').trim()||('preset:"'+presetName+'" -is:suspended'),
      payload={
        params:Array.isArray(pc.fsrs_params_6)?pc.fsrs_params_6:[],
        desired_retention:Math.max(.7,Math.min(.99,Number(retention)||.9)),
        deck_size:Math.max(0,Math.min(100000,Math.round(Number(opts.additionalNew)||0))),
        days_to_simulate:Math.max(1,Math.min(3650,Math.round(Number(days)||365))),
        new_limit:Math.max(0,Math.round(opts.newLimit==null?Number(pc.new_per_day)||0:Number(opts.newLimit)||0)),
        review_limit:Math.max(0,Math.round(opts.reviewLimit==null?Number(pc.reviews_per_day)||0:Number(opts.reviewLimit)||0)),
        max_interval:Math.max(1,Math.min(36500,Math.round(opts.maxInterval==null?Number(pc.maximum_review_interval)||36500:Number(opts.maxInterval)||36500))),
        search,
        new_cards_ignore_review_limit:!!options.new_cards_ignore_review_limit,
        easy_days_percentages:Array.isArray(pc.easy_days_percentages)&&pc.easy_days_percentages.length===7?pc.easy_days_percentages:[1,1,1,1,1,1,1],
        review_order:Number.isFinite(Number(pc.review_order))?Number(pc.review_order):0,
        historical_retention:Math.max(.5,Math.min(.99,Number(pc.historical_retention)||.9)),
        learning_step_count:Array.isArray(pc.learn_steps)?pc.learn_steps.length:0,
        relearning_step_count:Array.isArray(pc.relearn_steps)?pc.relearn_steps.length:0
      };
    if(Number(pc.leech_action)===0&&Number(pc.leech_threshold)>0)payload.suspend_after_lapse_count=Math.round(Number(pc.leech_threshold));
    const out=await this.request('/api/cards-official/fsrs/simulate?mode='+encodeURIComponent(mode),{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    return {out,payload,search,presetName,currentId};
  },

  async inheritDeckOptions(deckId){
    await this.bootstrap(false);
    const ctx=this._deckContext(deckId),
      current=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId)+'/options'),
      all=Array.isArray(current.all_config)?current.all_config:[],
      defaultEntry=all.find(x=>Number(x&&x.config&&x.config.id)===1),
      conf=JSON.parse(JSON.stringify(defaultEntry&&defaultEntry.config||current.defaults||{}));
    if(!conf||!Object.keys(conf).length)throw new Error('Preset global oficial não encontrado.');
    conf.id=Number(conf.id)||1;
    const globalCfg={
      newCardsIgnoreReviewLimit:!!current.new_cards_ignore_review_limit,
      algo:current.fsrs===false?'sm2':'fsrs',
      applyAllParentLimits:!!current.apply_all_parent_limits
    },payload={
      target_deck_id:Number(ctx.officialId),
      configs:[conf],
      removed_config_ids:[],
      mode:0,
      card_state_customizer:String(current.card_state_customizer||''),
      limits:Object.assign({},current.current_deck&&current.current_deck.limits||{}),
      new_cards_ignore_review_limit:!!globalCfg.newCardsIgnoreReviewLimit,
      fsrs:String(globalCfg.algo||'fsrs')!=='sm2',
      apply_all_parent_limits:!!globalCfg.applyAllParentLimits,
      fsrs_reschedule:false,
      fsrs_health_check:false
    };
    const out=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId)+'/options',{
      method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
    });
    const selectedId=Number(out&&out.options&&out.options.current_deck&&out.options.current_deck.config_id)||0;
    if(selectedId!==Number(conf.id))throw new Error('O Anki oficial não confirmou a troca para o preset global.');
    this._saveDeckConfigIdentity(deckId,ctx.planId,selectedId);
    await this._syncCollectionState(out.state,ctx.planId,null);
    this.dirty=false;this._browserCache=[];
    return out;
  },


  _emptyCardsPlainReport(html){
    const raw=String(html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:p|div|li|tr)>/gi,'\n');
    try{
      const doc=new DOMParser().parseFromString(raw,'text/html');
      return String(doc.body&&doc.body.textContent||'').replace(/\[anki:nid:(\d+)\]/g,'Nota $1:').replace(/\n{3,}/g,'\n\n').trim();
    }catch(_){
      if(typeof _quiet==='function')_quiet(_,'cards-official-empty-report');
      return raw.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    }
  },
  _applyEmptyCardsDeletion(report,deletedIds){
    const deleted=new Set((deletedIds||[]).map(x=>String(x))),handledNotes=new Set();
    for(const row of report&&report.notes||[]){
      const rowIds=(row.card_ids||[]).map(x=>String(x)),allDeleted=rowIds.length&&rowIds.every(id=>deleted.has(id));
      if(row.will_delete_note&&allDeleted){
        for(const note of this._noteReplicas(row.note_id)){
          const key=String(note._planId==null?'':note._planId)+'::'+String(note.id);
          if(handledNotes.has(key))continue;handledNotes.add(key);
          if(window.StudyGlobalScope&&typeof StudyGlobalScope._removeProjectedNote==='function')StudyGlobalScope._removeProjectedNote(note);
          else{
            const cards=AnkiProductParity._cardsForNote(note,note._planId==null?undefined:note._planId);
            if(cards.length)DB.deleteNoteByCard(cards[0].id,note._planId==null?undefined:note._planId);
          }
        }
        continue;
      }
      for(const oid of rowIds){
        if(!deleted.has(oid))continue;
        for(const card of this._replicas(oid)){
          const pid=card._planId==null?undefined:card._planId;
          DB.deleteCard(card.id,pid);
        }
      }
    }
  },
  async openEmptyCards(){
    try{
      await this.bootstrap(false);
      const report=await this.request('/api/cards-official/empty-cards'),notes=Array.isArray(report&&report.notes)?report.notes:[];
      if(!notes.length){showToast('Nenhum card vazio encontrado pelo Anki oficial ✓');return;}
      const total=notes.reduce((n,row)=>n+(Array.isArray(row.card_ids)?row.card_ids.length:0),0),
        doomedNotes=notes.filter(row=>row&&row.will_delete_note).length,
        plain=this._emptyCardsPlainReport(report.report);
      const v=await UI.prompt([
        {key:'keep',label:'Preservar notas que ficariam sem nenhum card?',type:'select',value:'no',
          options:[{value:'no',label:'Não — excluir a nota se todos os cards estiverem vazios'},{value:'yes',label:'Sim — manter um card vazio para preservar a nota'}],
          hint:'Mesma opção “Preserve notes” da ferramenta Empty Cards do Anki.'},
        {key:'report',label:'Relatório oficial',type:'textarea',rows:10,value:plain||('Cards vazios: '+total),
          hint:'Gerado por Collection.get_empty_cards() do Anki 26.09.3.'}
      ],{title:'🧹 Cards vazios · Anki oficial',okText:'Continuar',
        sub:total+' card(s) vazio(s) em '+notes.length+' nota(s)'+(doomedNotes?' · '+doomedNotes+' nota(s) ficariam sem cards':'')});
      if(!v)return;
      const ids=[];
      for(const row of notes){
        const cardIds=(row.card_ids||[]).map(Number).filter(x=>Number.isFinite(x)&&x>0);
        if(v.keep==='yes'&&row.will_delete_note)ids.push(...cardIds.slice(1));else ids.push(...cardIds);
      }
      const unique=[...new Set(ids)];
      if(!unique.length){showToast('Nenhum card precisa ser excluído para preservar as notas.');return;}
      const ok=await UI.confirm('Excluir '+unique.length+' card(s) vazio(s) detectado(s) pelo Anki oficial? O histórico existente permanece conforme as operações da Collection.',{
        title:'🗑 Excluir cards vazios',okText:'Excluir',danger:true
      });
      if(!ok)return;
      const out=await this.request('/api/cards-official/empty-cards/delete',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_ids:unique})
      });
      if(!out||!out.ok)throw new Error('O Anki oficial não confirmou a exclusão.');
      this._applyEmptyCardsDeletion(out.report_before||report,out.deleted_card_ids||unique);
      await this._syncCollectionState(out.state,this._activePlanId(),null);
      this.dirty=false;this._browserCache=[];CardsScreen.invalidateReviewQueue();CardsScreen.render();CardsScreen.updateFavCount();
      showToast((out.deleted_card_ids||unique).length+' card(s) vazio(s) excluído(s) pelo Anki oficial ✓');
      return out;
    }catch(e){showToast('Cards vazios não processados: '+(e&&e.message?e.message:String(e)));}
  },

  _wrapInvalidator(name){
    const fn=CardsScreen[name];if(typeof fn!=='function'||fn.__cardsOfficialWrapped)return;
    const self=this;
    const wrapped=function(){self.invalidate(name);return fn.apply(this,arguments);};
    wrapped.__cardsOfficialWrapped=true;CardsScreen[name]=wrapped;
  },
  install(){
    if(!window.CardsScreen||this._installed)return;this._installed=true;
    this._orig.renderRevisar=CardsScreen.renderRevisar;
    this._orig.renderStats=CardsScreen.renderStats;
    this._orig.answer=CardsScreen.answer;
    this._orig.flip=CardsScreen.flip;
    this._orig.undoAnswer=CardsScreen.undoAnswer;
    this._orig.redoAnswer=CardsScreen.redoAnswer;
    this._orig.openCustomStudy=CardsScreen.openCustomStudy;
    this._orig.openFilteredDeckModal=CardsScreen.openFilteredDeckModal;
    this._orig.saveCard=CardsScreen.saveCard;
    this._orig.deleteCard=CardsScreen.deleteCard;
    CardsScreen.renderRevisar=(box)=>{void this.renderRevisar(box);};
    CardsScreen.renderStats=(box)=>{void this.renderStats(box);};
    CardsScreen.answer=(grade)=>this.answer(grade);
    CardsScreen.flip=()=>{void this.showAnswer();};
    CardsScreen.undoAnswer=()=>{void this.undo();};
    CardsScreen.redoAnswer=()=>{void this.redo();};
    CardsScreen.cardInfo=(ref)=>{void this.openCardInfo(ref).catch(e=>showToast('Card Info oficial indisponível: '+(e&&e.message?e.message:String(e))));};
    CardsScreen.saveCard=(closeAfter)=>{void this.saveSimpleCard(closeAfter).catch(e=>showToast('Card não salvo: '+(e&&e.message?e.message:String(e))));};
    CardsScreen.deleteCard=()=>{void this.deleteSimpleCard().catch(e=>showToast('Nota não excluída: '+(e&&e.message?e.message:String(e))));};
    CardsScreen.openCustomStudy=()=>this.openCustomStudy();
    CardsScreen.runCustomStudy=()=>{void this.runCustomStudy();};
    CardsScreen.openFilteredDeckModal=(deckId)=>{void this.openFilteredDeckModal(deckId);};
    CardsScreen.saveFilteredDeckModal=()=>{void this.saveFilteredDeckModal();};
    this._installOfficialBrowser();
    this._installOfficialCheck();

    // Alterações de conteúdo/config invalidam a coleção oficial isolada. A
    // próxima entrada em Revisar faz novo bootstrap; respostas oficiais NÃO
    // passam por estes métodos e, portanto, não causam rebuild em loop.
    ['addDeck','doImport','reposicionarNovos','resetCardStats']
      .forEach(n=>this._wrapInvalidator(n));

    window.addEventListener('screen:activated',ev=>{
      const screen=ev.detail&&ev.detail.screen;
      if(screen!=='cards'||CardsScreen.tab!=='revisar'){
        this.cancelPendingRender();
        return;
      }
      if(this.dirty){
        const box=document.getElementById('cards-content');if(box)void this.renderRevisar(box);
      }
    });
  }
};

window.CardsOfficialBridge=CardsOfficialBridge;
// As camadas de UI instalam seus controles em microtasks. A ponte deve ser a
// última a registrar ações acadêmicas, para nenhum wrapper posterior restaurar
// uma operação local ou capturar uma referência intermediária do Browser.
queueMicrotask(()=>CardsOfficialBridge.install());
})();
