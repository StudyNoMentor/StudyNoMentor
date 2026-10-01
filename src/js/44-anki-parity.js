/* Projeção de leitura para os controles e metadados do Study.
   A Collection oficial produz os IDs, tipos, templates e estados acadêmicos.
   Nenhum scheduler, parser de busca ou renderer é implementado aqui. */
const AnkiParity = {
_validId(v) { const n=Number(v); return Number.isSafeInteger(n)&&n>0?n:null; },
cardId(card) { return card ? (this._validId(card.ankiId)||this._validId(card.id)||0) : 0; },
noteId(card) { return card ? (this._validId(card.ankiNoteId)||this.cardId(card)) : 0; },
_scopeCards() {
    try { if (typeof window!=='undefined' && window.StudyGlobalScope && StudyGlobalScope.cards) return StudyGlobalScope.cards(); } catch (_) { if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
    return DB.getCards();
  },
_planIdForCard(card) {
    try { if (card && card._planId) return card._planId; if (window.StudyGlobalScope && StudyGlobalScope.sourcePlanForCard) return StudyGlobalScope.sourcePlanForCard(card&&card.id); } catch (_) { if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
    return null;
  }
};
AnkiParity._planPrefix=function(planId){
  try{
    const pid=planId!=null&&String(planId)!==''?planId:DB._activePlanId();
    return DB._profilePrefix()+'p:'+pid+':';
  }catch(_){return 'diario-estudos:p:'+(planId!=null?String(planId):'default')+':';}
};
AnkiParity._entityKey=function(kind,id,planId){return this._planPrefix(planId)+'cards-'+kind+':'+String(id);};
AnkiParity._scanEntities=function(kind,planId){
  const prefix=this._entityKey(kind,'',planId),out=[];
  try{
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);if(!k||!String(k).startsWith(prefix))continue;
      try{const v=JSON.parse(localStorage.getItem(k)||'null');if(v&&typeof v==='object')out.push(v);}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
    }
  }catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
  return out;
};
AnkiParity._foreignEntity=function(kind,id,planId){
  try{
    if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.ankiEntity){
      return StudyGlobalScope.ankiEntity(kind,id,planId==null?undefined:planId)||null;
    }
  }catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
  return null;
};
AnkiParity.getNotetype=function(id,planId){
  try{
    const raw=localStorage.getItem(this._entityKey('notetype',id,planId));
    if(raw)return JSON.parse(raw);
    return planId==null?this._foreignEntity('notetype',id,null):null;
  }catch(_){return null;}
};
AnkiParity.saveNotetype=function(nt,planId){
  if(!nt||!nt.id)return false;
  const targetPlan=planId!=null?planId:(nt._planId!=null?nt._planId:null),now=new Date().toISOString(),x=JSON.parse(JSON.stringify(nt));
  delete x._planId;delete x._planNome;
  if(!this._validId(x.id))throw new Error("Entidade sem ID do Anki oficial.");x.ankiId=x.id;
  if(!Array.isArray(x.fields)||!Array.isArray(x.templates))throw new Error('Tipo oficial incompleto.');
  x.updatedAt=now;if(!x.createdAt)x.createdAt=now;
  DB.setRaw(this._entityKey('notetype',x.id,targetPlan),JSON.stringify(x));
  if(targetPlan!=null&&String(targetPlan)!==String(DB._activePlanId())){
    x._planId=targetPlan;
    try{if(window.StudyGlobalScope&&StudyGlobalScope.planName)x._planNome=StudyGlobalScope.planName(targetPlan);}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
  }
  return x;
};
AnkiParity.noteTypes=function(planId){return this._scanEntities('notetype',planId).sort((a,b)=>String(a.name).localeCompare(String(b.name)));};
AnkiParity.stockNotetype=function(kind,planId){
  const found=this.noteTypes(planId).find(x=>x.stockKind===String(kind||'basic'));
  if(!found)throw new Error('Tipo de nota oficial ainda não carregado.');
  return found;
};
AnkiParity.getNote=function(id,planId){
  try{
    const raw=localStorage.getItem(this._entityKey('note',id,planId));
    if(raw)return JSON.parse(raw);
    return planId==null?this._foreignEntity('note',id,null):null;
  }catch(_){return null;}
};
AnkiParity.saveNote=function(note,planId){
  if(!note||!note.id)return false;
  const targetPlan=planId!=null?planId:(note._planId!=null?note._planId:null),now=new Date().toISOString(),x=JSON.parse(JSON.stringify(note));
  delete x._planId;delete x._planNome;
  if(!this._validId(x.id))throw new Error('Nota sem ID do Anki oficial.');x.ankiId=x.id;
  if(!this._validId(x.notetypeId))throw new Error('Nota sem tipo do Anki oficial.');
  x.fields=x.fields&&typeof x.fields==='object'&&!Array.isArray(x.fields)?x.fields:{};
  x.tags=Array.isArray(x.tags)?[...new Set(x.tags.map(String).filter(Boolean))]:[];
  x.updatedAt=now;if(!x.createdAt)x.createdAt=now;
  x.revision=Math.max(1,Number(x.revision)||0)+1;
  DB.setRaw(this._entityKey('note',x.id,targetPlan),JSON.stringify(x));
  if(targetPlan!=null&&String(targetPlan)!==String(DB._activePlanId())){
    x._planId=targetPlan;
    try{if(window.StudyGlobalScope&&StudyGlobalScope.planName)x._planNome=StudyGlobalScope.planName(targetPlan);}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
  }
  return x;
};
AnkiParity.notes=function(planId){return this._scanEntities('note',planId);};
AnkiParity.noteForCard=function(card){
  if(!card)return null;
  const pid=this._planIdForCard(card),nid=this.noteId(card);
  return nid?this.getNote(nid,pid==null?undefined:pid):null;
};
AnkiParity.notetypeForCard=function(card,note){
  note=note||this.noteForCard(card);if(!note)return null;
  const pid=this._planIdForCard(card)||(note&&note._planId)||null;
  return this.getNotetype(note.notetypeId,pid==null?undefined:pid);
};
AnkiParity._stripHtml=function(v){
  return String(v==null?'':v).replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ');
};
AnkiParity._fieldNonempty=function(v){
  return !/^(?:\s|<\/?(?:br|div) ?\/?>)*$/i.test(String(v==null?'':v));
};
AnkiParity.selectedDeckId=function(){
  try{
    const set=CardsScreen.filters&&CardsScreen.filters.materias;
    if(set&&set.size===1){const v=[...set][0];if(typeof v==='string'&&v.startsWith('deck:'))return v.slice(5);}
  }catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
  return null;
};
AnkiParity._findDeckAnyPlan=function(id){
  if(id==null||id==='')return null;
  const k=String(id),local=DB.getDecks().find(x=>String(x.id)===k);if(local)return local;
  try{if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.deckRecord){const r=StudyGlobalScope.deckRecord(k);if(r)return r.deck||null;}}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-parity'); }
  return null;
};
AnkiParity.isFilteredDeck=function(deckOrId){
  const d=(deckOrId&&typeof deckOrId==='object')?deckOrId:
    this._findDeckAnyPlan(deckOrId);
  return !!(d&&(d.filtered===true||d.kind==='filtered'||d.filteredConfig));
};
window.AnkiParity=AnkiParity;
