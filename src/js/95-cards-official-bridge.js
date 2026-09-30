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
  _undo:[],
  _redo:[],
  _orig:{},

  api(){
    if(!window.AnkiOfficial||typeof AnkiOfficial.request!=='function')throw new Error('Bridge oficial do Anki indisponível.');
    return AnkiOfficial;
  },
  request(path,opts){return this.api().request(path,opts);},
  invalidate(reason){
    this.dirty=true;this.ready=false;this.review=null;this.timing=null;
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
  _officialId(card){
    const n=Number(card&&card.ankiId!=null?card.ankiId:card&&card.id);
    return Number.isFinite(n)&&n>0?n:null;
  },
  _replicas(officialId){
    const key=String(officialId);
    return this._allCards().filter(c=>String(this._officialId(c))===key);
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
  async htmlWithMedia(html){
    this._clearBlobUrls();
    const doc=new DOMParser().parseFromString(String(html||''),'text/html');
    for(const el of Array.from(doc.querySelectorAll('[src]'))){
      const src=(el.getAttribute('src')||'').trim();
      if(!src||/^(?:https?:|data:|blob:|about:|#)/i.test(src))continue;
      const name=src.replace(/^\.\//,'');
      if(!name||name.includes('/')||name.includes('\\'))continue;
      try{
        const blob=await this._fetchMedia(name),url=URL.createObjectURL(blob);
        this._blobUrls.push(url);el.setAttribute('src',url);
      }catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-media');}
    }
    return '<!doctype html>'+doc.documentElement.outerHTML;
  },
  async playAv(tags){
    for(const tag of tags||[]){
      if(tag.kind==='tts'){
        // A engine oficial fornece a fila/voz pedida; não inventamos outra voz
        // como fallback. A superfície web de TTS será certificada separadamente.
        continue;
      }
      if(tag.kind!=='media'||!tag.filename)continue;
      try{
        const blob=await this._fetchMedia(tag.filename),url=URL.createObjectURL(blob);this._blobUrls.push(url);
        await new Promise(resolve=>{const a=new Audio(url);a.onended=resolve;a.onerror=resolve;const p=a.play();if(p&&p.catch)p.catch(resolve);});
      }catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-av');}
    }
  },

  async bootstrap(force){
    if(this._bootPromise)return this._bootPromise;
    if(this.ready&&!this.dirty&&!force)return this.review;
    this._bootPromise=(async()=>{
      if(!this.api().token())throw new Error('Entre na conta do Study para usar o motor oficial dos Cards.');
      if(typeof AnkiExport==='undefined'||typeof AnkiExport.buildCollectionPackage!=='function')throw new Error('Exportador canônico dos Cards indisponível.');
      if(typeof AnkiParity!=='undefined'){
        if(AnkiParity.ensureIdentities)AnkiParity.ensureIdentities();
        if(AnkiParity.ensureCanonicalNotes)AnkiParity.ensureCanonicalNotes();
      }
      const pkg=await AnkiExport.buildCollectionPackage({
        legacy:false,withMedia:true,withScheduling:true,withDeckConfigs:true,
        canonicalAnkiIds:true,preserveFiltered:true
      });
      const fd=new FormData();
      fd.append('package',new Blob([pkg.bytes],{type:'application/octet-stream'}),'study-cards.colpkg');
      const out=await this.request('/api/cards-official/bootstrap',{method:'POST',body:fd});
      if(!out||!out.ok)throw new Error('O Anki oficial não confirmou o bootstrap dos Cards.');
      this.ready=true;this.dirty=false;this._sessionAnswered=0;this._sessionStartTotal=null;
      this._undo=[];this._redo=[];this._applyReviewer(out.reviewer||{finished:true,counts:{},queue_ids:[]});
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
    if(!CardsScreen.collectionCards().length){
      box.innerHTML=CardsScreen.emptyState('Nenhum card ainda','Clique em <strong>＋ Criar card</strong> no topo para começar.');
      return;
    }
    box.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">⏳</div><h3>Preparando revisão oficial…</h3><p>Fila, rendering e intervalos vêm do Anki 26.09.3.</p></div></div>';
    try{
      await this.bootstrap(false);
      await this.renderCurrent(box);
    }catch(e){
      console.error('Cards official bridge:',e);
      box.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">⚠</div><h3>Motor oficial indisponível</h3><p>'+
        escapeHtml(e&&e.message?e.message:String(e))+'</p><p class="hint">O Cards não caiu para um scheduler aproximado.</p>'+
        '<button type="button" class="btn-secondary" id="cards-official-retry">Tentar novamente</button></div></div>';
      const b=document.getElementById('cards-official-retry');if(b)b.onclick=()=>{this.invalidate('retry');void this.renderRevisar(box);};
    }
  },

  async _frame(html){
    const frame=document.getElementById('cards-official-frame');if(!frame)return;
    frame.srcdoc=await this.htmlWithMedia(html);
  },
  _flagButtons(flag){
    const colors=['','#e0393f','#d97a12','#0f9d63','#2563eb','#7c3aed','#db2777','#06b6d4'];
    return [1,2,3,4,5,6,7].map(n=>'<button type="button" class="anki-study-flag '+(Number(flag)===n?'on':'')+
      '" data-cards-official-flag="'+n+'" style="--fl:'+colors[n]+'" title="Bandeira '+n+'"></button>').join('');
  },
  async renderCurrent(box){
    box=box||document.getElementById('cards-content');if(!box)return;
    const q=this.review;
    if(!q||q.finished||!q.card){
      CardsScreen._reviewQueue=[];CardsScreen._reviewIdx=0;CardsScreen._flipped=false;
      box.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">🎉</div><h3>Sessão concluída!</h3>'+
        '<p>A fila oficial do Anki não possui mais cards disponíveis agora.</p>'+
        '<button type="button" class="btn-primary" id="cards-official-restart">Ver se há mais</button></div></div>';
      const rb=document.getElementById('cards-official-restart');if(rb)rb.onclick=async()=>{try{this._applyReviewer(await this.request('/api/cards-official/reviewer/next'));await this.renderCurrent(box);}catch(e){showToast(e.message);}};
      CardsScreen.updateFavCount();CardsScreen.atualizarFoco();return;
    }
    const oc=q.card,local=this._localForOfficialId(oc.id);
    if(!local)throw new Error('Card oficial '+oc.id+' não foi localizado no Study.');
    const remaining=Number(this.counts.new||0)+Number(this.counts.learning||0)+Number(this.counts.review||0);
    const pct=Math.max(0,Math.min(100,Math.round((this._sessionAnswered/Math.max(1,this._sessionStartTotal||remaining||1))*100)));
    const typeInput=oc.type_answer&&oc.type_answer.enabled
      ? '<div class="anki-type-answer-input-wrap"><input id="cards-official-type-answer" type="text" autocomplete="off" spellcheck="false" placeholder="Digite a resposta"></div>' : '';
    box.innerHTML='<div class="card cards-review-wrap anki-study-review-card">'+
      '<div class="cards-review-progress"><span>'+this._sessionAnswered+' respondidos</span>'+
      '<div class="cards-review-bar"><div style="width:'+pct+'%"></div></div>'+
      '<span class="cards-limit-chip cards-due-counts" title="Contagens calculadas pelo scheduler oficial">🆕 '+this.counts.new+' · 🧠 '+this.counts.learning+' · 🔄 '+this.counts.review+'</span></div>'+
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
        '<span class="cards-flagbar">'+this._flagButtons(oc.flag)+'</span>'+
      '</div>'+
      '<div class="cards-kbd-hint-row"><span class="cards-kbd-hint"><kbd>Espaço</kbd> resposta · <kbd>1</kbd>–<kbd>4</kbd> avaliar · <kbd>Ctrl+Z</kbd> desfazer</span></div>'+
    '</div>';

    const question=(oc.type_answer&&oc.type_answer.enabled&&oc.type_answer.question_html)||oc.question||'';
    await this._frame(question);
    void this.playAv(oc.question_av_tags||[]);
    const flip=document.getElementById('cards-flip');if(flip)flip.onclick=()=>void this.showAnswer();
    const edit=document.getElementById('cards-review-edit');if(edit)edit.onclick=()=>CardsScreen.openCardModal(local.id);
    const info=document.getElementById('cards-act-info');if(info)info.onclick=()=>CardsScreen.cardInfo(local);
    const bury=document.getElementById('cards-act-bury');if(bury)bury.onclick=()=>void this.action('bury');
    const susp=document.getElementById('cards-act-susp');if(susp)susp.onclick=()=>void this.action('suspend');
    const forget=document.getElementById('cards-act-forget');if(forget)forget.onclick=()=>void this.action('forget');
    const due=document.getElementById('cards-act-due');if(due)due.onclick=()=>void this.setDue();
    const mark=document.getElementById('cards-act-mark');if(mark)mark.onclick=()=>void this.mark();
    box.querySelectorAll('[data-cards-official-flag]').forEach(b=>b.onclick=()=>void this.action('flag',Number(b.dataset.cardsOfficialFlag)));
    const ti=document.getElementById('cards-official-type-answer');if(ti)setTimeout(()=>{try{ti.focus();}catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-type-answer-focus');}},0);
    CardsScreen.atualizarFoco();
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
    void this.playAv(oc.answer_av_tags||[]);
  },

  _phase(type,queue){
    if(typeof AnkiImport!=='undefined'&&AnkiImport._phase)return AnkiImport._phase(type,queue);
    type=Number(type);queue=Number(queue);
    if(type===0)return'new';if(type===1||queue===1||queue===3)return'learning';if(type===3)return'relearning';return'review';
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
      patch.due=CardEngine.addDays(todayCards(),Number.isFinite(delta)?delta:0);
    }
    if(queue===-2||queue===-3){
      patch.enterradoAte=CardEngine.addDays(todayCards(),1);
      patch.buryKind=queue===-2?'scheduler':'user';
    }
    if(state.original_due){
      if(Number(state.type)===0){
        patch.originalDue=todayCards();patch.posicaoNova=Math.max(0,Number(state.original_due)||0);patch.originalDueTs=null;
      }else if(queue===1||queue===3||queue===4){
        patch.originalDue=todayCards();patch.originalDueTs=Math.max(0,Number(state.original_due)||0)*1000;
      }else{
        const delta=Number(state.original_due)-(Number(timing.today)||0);
        patch.originalDue=CardEngine.addDays(todayCards(),Number.isFinite(delta)?delta:0);patch.originalDueTs=null;
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

  async answer(grade){
    if(this._answering)return false;
    const rating=typeof grade==='number'?grade:({errei:1,dificil:2,bom:3,facil:4})[grade];
    if(!rating||!this.review||!this.review.card)return false;
    this._answering=true;
    try{
      const local=this._localForOfficialId(this.review.card.id);
      const ms=local&&CardsScreen._reviewElapsedMs?CardsScreen._reviewElapsedMs(CardsConfig.forDeck(local.deckId)):0;
      const out=await this.request('/api/cards-official/reviewer/answer',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({card_id:Number(this.review.card.id),rating,milliseconds_taken:Math.max(0,Math.round(ms||0))})
      });
      try{await this._persistAnswered(out.answered,true);}
      catch(localError){
        try{await this.request('/api/cards-official/undo',{method:'POST'});}catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-compensate');}
        throw localError;
      }
      this._sessionAnswered++;
      this._applyReviewer(out.reviewer);
      await this.renderCurrent(document.getElementById('cards-content'));
      CardsScreen.updateFavCount();return true;
    }catch(e){showToast('Resposta não gravada: '+(e.message||e));return false;}
    finally{this._answering=false;}
  },

  async action(action,value){
    if(!this.review||!this.review.card)return false;
    try{
      const out=await this.request('/api/cards-official/cards/action',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,card_ids:[Number(this.review.card.id)],value:value==null?null:value})
      });
      await this._syncStates(out.cards||[]);
      this._applyReviewer(out.reviewer);
      await this.renderCurrent(document.getElementById('cards-content'));
      return true;
    }catch(e){showToast('Ação não aplicada: '+(e.message||e));return false;}
  },
  async setDue(){
    const v=await UI.prompt([{key:'due',label:'Dias / intervalo do Anki',type:'text',value:'1',hint:'Ex.: 5 ou 5-7'}],{title:'📅 Definir vencimento',okText:'Aplicar'});
    if(v&&String(v.due||'').trim())await this.action('set_due',String(v.due).trim());
  },
  async mark(){
    if(!this.review||!this.review.card)return;
    const oc=this.review.card,replicas=this._replicas(oc.id),next=!oc.marked;
    try{
      const out=await this.request('/api/cards-official/cards/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'mark',card_ids:[Number(oc.id)],value:null})});
      for(const r of replicas)StudyGlobalScope.updateCardScoped(r,{favorito:next},r._planId);
      this._applyReviewer(out.reviewer);await this.renderCurrent(document.getElementById('cards-content'));CardsScreen.updateFavCount();
    }catch(e){showToast(e.message||String(e));}
  },

  async undo(){
    const txn=this._undo.pop();if(!txn){showToast('Nada para desfazer');return false;}
    try{
      const out=await this.request('/api/cards-official/undo',{method:'POST'});
      for(const row of txn.rows)await DB.cancelarRevlogDurable(row);
      for(const it of txn.items)StudyGlobalScope.updateCardScoped(it.replica,it.before,it.replica._planId);
      this._redo.push(txn);this._sessionAnswered=Math.max(0,this._sessionAnswered-1);
      this._applyReviewer(out.reviewer);await this.renderCurrent(document.getElementById('cards-content'));showToast('Revisão desfeita ↶');return true;
    }catch(e){this._undo.push(txn);showToast('Não foi possível desfazer: '+(e.message||e));return false;}
  },
  async redo(){
    const txn=this._redo.pop();if(!txn){showToast('Nada para refazer');return false;}
    try{
      const out=await this.request('/api/cards-official/redo',{method:'POST'});
      const state=await this.request('/api/cards-official/card/'+encodeURIComponent(txn.officialId)+'/state');
      const replayTxn=await this._persistAnswered(state,false);this._undo.push(replayTxn);if(this._undo.length>50)this._undo.shift();this._sessionAnswered++;
      this._applyReviewer(out.reviewer);await this.renderCurrent(document.getElementById('cards-content'));showToast('Revisão refeita ↷');return true;
    }catch(e){this._redo.push(txn);showToast('Não foi possível refazer: '+(e.message||e));return false;}
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
  async renderStats(box){
    box=box||document.getElementById('cards-content');if(!box)return;
    if(!CardsScreen.collectionCards().length){box.innerHTML=CardsScreen.emptyState('Sem estatísticas ainda','Crie e revise alguns cards para ver seus dados.');return;}
    box.innerHTML='<div class="card"><div class="cards-review-done"><div class="big">📊</div><h3>Calculando estatísticas oficiais…</h3><p>O GraphsService do Anki 26.09.3 está processando a coleção dos Cards.</p></div></div>';
    try{
      await this.bootstrap(false);
      const qs=new URLSearchParams({search:this._statsSearch(),days:String(this._statsDays())}),
        data=await this.request('/api/cards-official/stats/graphs?'+qs.toString()),
        counts=data.card_counts&&data.card_counts.excluding_inactive||{},today=data.today||{},ret=data.true_retention||{},
        controls=window.AnkiMaxStatsMedia&&AnkiMaxStatsMedia._statsControlsHtml?AnkiMaxStatsMedia._statsControlsHtml():'',
        reviews=data.reviews||{},fsrs=!!data.fsrs;
      box.innerHTML='<div class="stats-page cards-official-stats">'+controls+
        '<div class="stat-kpis">'+
          '<div class="stat-kpi"><div class="stat-kpi-v accent">'+Number(counts.newCards||0).toLocaleString('pt-BR')+'</div><div class="stat-kpi-l">Novos</div></div>'+
          '<div class="stat-kpi"><div class="stat-kpi-v">'+(Number(counts.learn||0)+Number(counts.relearn||0)).toLocaleString('pt-BR')+'</div><div class="stat-kpi-l">Aprendendo</div></div>'+
          '<div class="stat-kpi"><div class="stat-kpi-v good">'+Number(counts.mature||0).toLocaleString('pt-BR')+'</div><div class="stat-kpi-l">Maduros</div></div>'+
          '<div class="stat-kpi"><div class="stat-kpi-v">'+Number(counts.suspended||0).toLocaleString('pt-BR')+'</div><div class="stat-kpi-l">Suspensos</div></div>'+
        '</div>'+
        '<section class="card stat-card"><div class="card-header"><div><h2>Hoje</h2><p class="sub">Dados produzidos pelo StatsService oficial · virada '+String(data.rollover_hour==null?'—':data.rollover_hour)+'h.</p></div></div>'+
          '<div class="stat-kpis"><div class="stat-kpi"><div class="stat-kpi-v">'+Number(today.answer_count||0)+'</div><div class="stat-kpi-l">Respostas</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+((Number(today.answer_millis||0)/60000)||0).toFixed(1)+'m</div><div class="stat-kpi-l">Tempo</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+Number(today.correct_count||0)+'</div><div class="stat-kpi-l">Corretas</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+Number(today.mature_count||0)+'</div><div class="stat-kpi-l">Maduros respondidos</div></div></div></section>'+
        '<div class="stat-grid">'+
          '<section class="card stat-card"><div class="card-header"><div><h2>📆 Future Due</h2><p class="sub">Carga futura calculada pelo scheduler.</p></div></div>'+this._statsBars((data.future_due||{}).future_due,32)+'</section>'+
          '<section class="card stat-card"><div class="card-header"><div><h2>🔥 Revisões</h2><p class="sub">Learning, relearning, jovens, maduras e filtradas.</p></div></div>'+this._statsNestedBars(reviews.count,32)+'</section>'+
          '<section class="card stat-card"><div class="card-header"><div><h2>⏱ Tempo de revisão</h2><p class="sub">Tempo por dia, separado pelas classes oficiais.</p></div></div>'+this._statsNestedBars(reviews.time,32)+'</section>'+
          '<section class="card stat-card"><div class="card-header"><div><h2>＋ Adicionados</h2><p class="sub">Cards adicionados por dia.</p></div></div>'+this._statsBars((data.added||{}).added,32)+'</section>'+
        '</div>'+
        '<div class="stat-grid">'+
          '<section class="card stat-card"><div class="card-header"><div><h2>↔ Intervalos</h2></div></div>'+this._statsBars((data.intervals||{}).intervals,28)+'</section>'+
          (fsrs?'<section class="card stat-card"><div class="card-header"><div><h2>🧠 Estabilidade</h2></div></div>'+this._statsBars((data.stability||{}).intervals,28)+'</section>':'')+
          (fsrs?'<section class="card stat-card"><div class="card-header"><div><h2>🎯 Recuperabilidade</h2><p class="sub">Média '+Number((data.retrievability||{}).average||0).toFixed(2)+'</p></div></div>'+this._statsBars((data.retrievability||{}).retrievability,28)+'</section>':'')+
          '<section class="card stat-card"><div class="card-header"><div><h2>'+(fsrs?'🧩 Dificuldade':'🙂 Facilidade')+'</h2><p class="sub">Média '+Number(((fsrs?data.difficulty:data.eases)||{}).average||0).toFixed(2)+'</p></div></div>'+this._statsBars(((fsrs?data.difficulty:data.eases)||{}).eases,28)+'</section>'+
        '</div>'+
        '<section class="card stat-card"><div class="card-header"><div><h2>✓ True Retention</h2><p class="sub">Again = falha; Hard/Good/Easy = acerto. Cálculo oficial.</p></div></div><div class="anki-stat-table-wrap"><table><thead><tr><th>Período</th><th>Respostas</th><th>Corretas</th><th>Retenção</th></tr></thead><tbody>'+
          this._statsRetentionRow('Hoje',ret.today)+this._statsRetentionRow('Ontem',ret.yesterday)+this._statsRetentionRow('Semana',ret.week)+this._statsRetentionRow('Mês',ret.month)+this._statsRetentionRow('Ano',ret.year)+this._statsRetentionRow('Tudo',ret.all_time)+
        '</tbody></table></div></section>'+
        '<div class="stat-grid"><section class="card stat-card"><div class="card-header"><div><h2>🕒 Por hora</h2></div></div>'+this._statsHours(data.hours||{})+'</section>'+
        '<section class="card stat-card"><div class="card-header"><div><h2>🔢 Botões</h2><p class="sub">Distribuição 1–4 por maturidade e período.</p></div></div>'+this._statsButtons(data.buttons||{})+'</section></div>'+
      '</div>';
      if(window.AnkiMaxStatsMedia&&AnkiMaxStatsMedia._bindStatsUi)AnkiMaxStatsMedia._bindStatsUi();
    }catch(e){
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
      const rows=[],missing=[];
      for(const id of out.ids||[]){
        const row=map.get(String(id));if(row)rows.push(row);else missing.push(id);
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
      this._officialBrowserFacets=out;
    }catch(e){if(typeof _quiet==='function')_quiet(e,'cards-official-browser-facets');}
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
  async _syncOfficialNotes(states,opts){
    opts=opts||{};
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
        if(!opts.skipReconcile)try{
          const nt=AnkiParity.getNotetype(saved.notetypeId,pid==null?undefined:pid);
          if(nt&&window.AnkiProductParity&&AnkiProductParity.reconcileNote)AnkiProductParity.reconcileNote(saved,nt);
        }catch(_){if(typeof _quiet==='function')_quiet(_,'cards-official-note-reconcile');}
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
    await this._syncOfficialNotes(out.notes||[],{skipReconcile:true});
    await this._reconcileOfficialCardSet(out.notes||[],out.cards||[]);
    if(out.reviewer)this._applyReviewer(out.reviewer);
    document.getElementById('anki-change-type-modal').style.display='none';
    this._browserCache=[];this._scheduleOfficialBrowser();CardsScreen.render();CardsScreen.updateFavCount();
    showToast('Tipo de nota alterado pelo Anki oficial ✓');
    this._changeTypeSelection=null;this._changeTypeInfo=null;
  },
  async _reconcileOfficialCardSet(noteStates,cardStates){
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
          seed=same[0]||{},existingByOfficial=new Map(same.map(c=>[String(this._officialId(c)),Object.assign({},c,pid==null?{}:{_planId:pid})]));
        for(const state of officialCards){
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
    if(!deckId)return;
    try{
      await this.bootstrap(false);
      const ctx=this._deckContext(deckId),out=await this.request('/api/cards-official/filtered-deck/'+ctx.officialId);
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
  _officialDeckConfigFromLocal(base,cfg,deckId,identity){
    const row=JSON.parse(JSON.stringify(base||{})),c=Object.assign({},row.config||{}),
      weights=(window.CardsConfig&&CardsConfig.weightsFor)?CardsConfig.weightsFor(deckId==null?null:deckId):(cfg.weights||[]);
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
    let targetId=isDeck?(opts.hadPreset?currentId:0):1,
      baseEntry=all.find(x=>Number(x&&x.config&&x.config.id)===Number(targetId||currentId))
        ||all.find(x=>Number(x&&x.config&&x.config.id)===currentId)
        ||{config:current.defaults||{}},
      base=baseEntry.config||current.defaults||{},
      name=isDeck&&!opts.hadPreset?String(opts.deckName||ctx.deck&&ctx.deck.nome||'Preset'):String(base.name||(!isDeck?'Default':opts.deckName||'Preset')),
      conf=this._officialDeckConfigFromLocal(base,cfg,isDeck?deckId:null,{id:targetId,name});
    const globalCfg=isDeck?CardsConfig.get():cfg,
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



  async inheritDeckOptions(deckId){
    await this.bootstrap(false);
    const ctx=this._deckContext(deckId),
      current=await this.request('/api/cards-official/deck/'+encodeURIComponent(ctx.officialId)+'/options'),
      all=Array.isArray(current.all_config)?current.all_config:[],
      defaultEntry=all.find(x=>Number(x&&x.config&&x.config.id)===1),
      conf=JSON.parse(JSON.stringify(defaultEntry&&defaultEntry.config||current.defaults||{}));
    if(!conf||!Object.keys(conf).length)throw new Error('Preset global oficial não encontrado.');
    conf.id=Number(conf.id)||1;
    const globalCfg=CardsConfig.get(),payload={
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
          if(window.StudyGlobalScope&&typeof StudyGlobalScope.deleteNoteScoped==='function')StudyGlobalScope.deleteNoteScoped(note);
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
    CardsScreen.renderRevisar=(box)=>{void this.renderRevisar(box);};
    CardsScreen.renderStats=(box)=>{void this.renderStats(box);};
    CardsScreen.answer=(grade)=>this.answer(grade);
    CardsScreen.flip=()=>{void this.showAnswer();};
    CardsScreen.undoAnswer=()=>{void this.undo();};
    CardsScreen.redoAnswer=()=>{void this.redo();};
    CardsScreen.openCustomStudy=()=>this.openCustomStudy();
    CardsScreen.runCustomStudy=()=>{void this.runCustomStudy();};
    CardsScreen.openFilteredDeckModal=(deckId)=>{void this.openFilteredDeckModal(deckId);};
    CardsScreen.saveFilteredDeckModal=()=>{void this.saveFilteredDeckModal();};
    this._installOfficialBrowser();

    // Alterações de conteúdo/config invalidam a coleção oficial isolada. A
    // próxima entrada em Revisar faz novo bootstrap; respostas oficiais NÃO
    // passam por estes métodos e, portanto, não causam rebuild em loop.
    ['saveCard','deleteCard','addDeck','doImport','reposicionarNovos','resetCardStats']
      .forEach(n=>this._wrapInvalidator(n));

    window.addEventListener('screen:activated',ev=>{
      if(ev.detail&&ev.detail.screen==='cards'&&CardsScreen.tab==='revisar'&&this.dirty){
        const box=document.getElementById('cards-content');if(box)void this.renderRevisar(box);
      }
    });
  }
};

window.CardsOfficialBridge=CardsOfficialBridge;
CardsOfficialBridge.install();
})();
