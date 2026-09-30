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
        canonicalAnkiIds:true
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
    const ti=document.getElementById('cards-official-type-answer');if(ti)setTimeout(()=>{try{ti.focus();}catch(_){ }},0);
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
      phase,intervalo:Math.max(0,Number(state.interval)||0),ease:(Number(state.ease_factor)||2500)/1000,
      reps:Math.max(0,Number(state.reps)||0),lapses:Math.max(0,Number(state.lapses)||0),
      s:mem.stability==null?null:Number(mem.stability),d:mem.difficulty==null?null:Number(mem.difficulty),
      flag:Math.max(0,Math.min(7,Number(state.flag)||0)),dueTs:null,
      suspenso:queue===-1,enterradoAte:null,buryKind:null,
      lastReviewTs:state.last_review_time?Number(state.last_review_time)*1000:null
    };
    patch.deckId=this._localDeckId(state.deck_id,planId,local.deckId)||local.deckId;
    if(state.original_deck_id)patch.originalDeckId=this._localDeckId(state.original_deck_id,planId,local.originalDeckId||local.deckId);
    else patch.originalDeckId=null;
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
      const delta=Number(state.original_due)-(Number(timing.today)||0);
      patch.originalDue=CardEngine.addDays(todayCards(),Number.isFinite(delta)?delta:0);
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
        try{
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
    AnkiMaxParity._bulkCardsMove=ids=>void self._browserMove(ids);
    AnkiMaxParity._bulkCardsDue=ids=>void self._browserSetDue(ids);
    AnkiMaxParity._bulkCardsForget=ids=>void self._browserForget(ids);
    AnkiMaxParity._bulkCardsReposition=ids=>void self._browserReposition(ids);
    const sortable=key=>!!self._browserSortKey(key);
    AnkiMaxParity._isSortableColumn=sortable;
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
    this._orig.answer=CardsScreen.answer;
    this._orig.flip=CardsScreen.flip;
    this._orig.undoAnswer=CardsScreen.undoAnswer;
    this._orig.redoAnswer=CardsScreen.redoAnswer;
    CardsScreen.renderRevisar=(box)=>{void this.renderRevisar(box);};
    CardsScreen.answer=(grade)=>this.answer(grade);
    CardsScreen.flip=()=>{void this.showAnswer();};
    CardsScreen.undoAnswer=()=>{void this.undo();};
    CardsScreen.redoAnswer=()=>{void this.redo();};
    this._installOfficialBrowser();

    // Alterações de conteúdo/config invalidam a coleção oficial isolada. A
    // próxima entrada em Revisar faz novo bootstrap; respostas oficiais NÃO
    // passam por estes métodos e, portanto, não causam rebuild em loop.
    ['saveCard','deleteCard','addDeck','runCustomStudy','saveFilteredDeckModal','doImport','reposicionarNovos','resetCardStats']
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
