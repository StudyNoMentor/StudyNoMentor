/* ============================================================
   PARIDADE MÁXIMA — ESTATÍSTICAS / SIMULADOR / CHECK MEDIA
   ============================================================ */
const AnkiMediaStore = {
  DB_NAME:'studynomentor-anki-media-v1',STORE:'media',_mem:new Map(),_dbp:null,
  scope(){try{return String(DB._profilePrefix())+'p:'+String(DB._activePlanId());}catch(_){return 'default';}},
  key(name){return this.scope()+'\u0000'+String(name||'');},
  _open(){
    if(this._dbp)return this._dbp;
    if(typeof indexedDB==='undefined')return Promise.resolve(null);
    this._dbp=new Promise((resolve,reject)=>{
      const req=indexedDB.open(this.DB_NAME,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(this.STORE))db.createObjectStore(this.STORE,{keyPath:'key'});};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    }).catch(()=>null);return this._dbp;
  },
  _u8(v){if(v instanceof Uint8Array)return v;if(v instanceof ArrayBuffer)return new Uint8Array(v);return new Uint8Array(v||[]);},
  fingerprint(bytes){
    const b=this._u8(bytes);try{return AnkiExport._crc32(b).toString(16).padStart(8,'0')+'-'+b.length;}catch(_){let h=2166136261;for(const x of b)h=Math.imul(h^x,16777619);return (h>>>0).toString(16)+'-'+b.length;}
  },
  async put(name,bytes,mime){
    const b=this._u8(bytes),rec={key:this.key(name),scope:this.scope(),name:String(name||''),bytes:b,mime:String(mime||''),fingerprint:this.fingerprint(b),trashedAt:null,updatedAt:Date.now()};
    const db=await this._open();if(!db){this._mem.set(rec.key,rec);return rec;}
    await new Promise((resolve,reject)=>{const tx=db.transaction(this.STORE,'readwrite');tx.objectStore(this.STORE).put(rec);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}).catch(()=>{this._mem.set(rec.key,rec);});return rec;
  },
  async putAll(media){
    if(!media||typeof media.forEach!=='function')return 0;const rows=[];media.forEach((bytes,name)=>rows.push([name,bytes]));for(const [n,b] of rows)await this.put(n,b,'');return rows.length;
  },
  async all(includeTrash=true){
    const scope=this.scope(),db=await this._open();let rows=[];
    if(!db)rows=[...this._mem.values()].filter(x=>x.scope===scope);
    else rows=await new Promise((resolve,reject)=>{const tx=db.transaction(this.STORE,'readonly'),r=tx.objectStore(this.STORE).getAll();r.onsuccess=()=>resolve((r.result||[]).filter(x=>x.scope===scope));r.onerror=()=>reject(r.error);}).catch(()=>[...this._mem.values()].filter(x=>x.scope===scope));
    return includeTrash?rows:rows.filter(x=>!x.trashedAt);
  },
  async _setTrash(name,value){
    const rows=await this.all(true),r=rows.find(x=>x.name===String(name));if(!r)return false;r.trashedAt=value?Date.now():null;r.updatedAt=Date.now();
    const db=await this._open();if(!db){this._mem.set(r.key,r);return true;}
    return new Promise(resolve=>{const tx=db.transaction(this.STORE,'readwrite');tx.objectStore(this.STORE).put(r);tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);});
  },
  trash(name){return this._setTrash(name,true);},restore(name){return this._setTrash(name,false);},
  async restoreAll(){const xs=(await this.all(true)).filter(x=>x.trashedAt);for(const x of xs)await this.restore(x.name);return xs.length;},
  async emptyTrash(){
    const xs=(await this.all(true)).filter(x=>x.trashedAt),db=await this._open();if(!db){xs.forEach(x=>this._mem.delete(x.key));return xs.length;}
    for(const x of xs)await new Promise(resolve=>{const tx=db.transaction(this.STORE,'readwrite');tx.objectStore(this.STORE).delete(x.key);tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();});return xs.length;
  }
};

const AnkiMaxStatsMedia = {
  install(){
    if(this._installed||typeof CardsScreen==='undefined'||typeof AnkiProductParity==='undefined')return;
    this._installed=true;this._patchImportExport();this._patchStats();this._patchCheck();this._injectSimulator();
  },

  _statsState:{scope:'deck',deckId:null,search:'',history:'year'},
  _cardsSource(){try{if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.cards)return StudyGlobalScope.cards();}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-max-stats-media'); }return DB.getCards();},
  _decksSource(){try{if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.decks)return StudyGlobalScope.decks();}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-max-stats-media'); }return DB.getDecks();},
  _revlogSource(){try{if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.revlog)return StudyGlobalScope.revlog();}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-max-stats-media'); }return DB.getRevlog();},
  _statsSelectedDeckId(){
    const explicit=this._statsState&&this._statsState.deckId;
    if(explicit!=null&&explicit!=='')return String(explicit);
    try{if(typeof AnkiParity!=='undefined'&&AnkiParity.selectedDeckId)return String(AnkiParity.selectedDeckId()||'');}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-max-stats-media'); }
    return '';
  },
  _statsDeckIds(rootId){
    if(!rootId)return null;
    const decks=this._decksSource(),root=decks.find(d=>String(d.id)===String(rootId));if(!root)return new Set([String(rootId)]);
    const name=String(root.nome||''),prefix=name+'::';
    return new Set(decks.filter(d=>String(d.id)===String(rootId)||String(d.nome||'').startsWith(prefix)).map(d=>String(d.id)));
  },
  statsCards(){
    let cards=this._cardsSource();
    const st=this._statsState||{},scope=st.scope||'deck';
    if(scope==='deck'){
      const ids=this._statsDeckIds(this._statsSelectedDeckId());
      if(ids)cards=cards.filter(c=>ids.has(String(c.deckId)));
    }else if(scope==='search'&&String(st.search||'').trim()){
      const q=String(st.search).trim();
      if(typeof AnkiParity!=='undefined'&&AnkiParity.filteredSearchMatches)cards=cards.filter(c=>{try{return AnkiParity.filteredSearchMatches(c,q);}catch(_){return false;}});
    }
    return cards;
  },
  statsRevlog(applyHistory=true){
    let rows=this._revlogSource()||[];const st=this._statsState||{},scope=st.scope||'deck';
    if(scope!=='collection'){
      const ids=new Set();
      for(const c of this.statsCards()){if(c&&c.id!=null)ids.add(String(c.id));if(c&&c.ankiId!=null)ids.add(String(c.ankiId));}
      rows=rows.filter(r=>ids.has(String(r.cardId==null?r.ankiCardId:r.cardId)));
    }
    if(applyHistory&&st.history!=='all'){
      const cut=CardEngine.addDays(todayCards(),-364);
      rows=rows.filter(r=>{const d=this._revDate(r);return !d||d>=cut;});
    }
    return rows;
  },
  _statsHistoryDays(){
    if((this._statsState||{}).history!=='all')return 365;
    const rows=this.statsRevlog(false),today=todayCards();let earliest=today;
    for(const r of rows){const d=this._revDate(r);if(d&&d<earliest)earliest=d;}
    return Math.max(1,Math.min(36500,CardEngine._daysBetween(earliest,today)+1));
  },
  _statsControlsHtml(){
    const st=this._statsState||{},decks=this._decksSource().slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR')),
      selected=this._statsSelectedDeckId(),esc=(v)=>typeof AnkiProductParity!=='undefined'&&AnkiProductParity.esc?AnkiProductParity.esc(v):String(v||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    return '<div class="card stat-card anki-stats-controls"><div class="card-header"><div><h2>Escopo das estatísticas</h2><p class="sub">Como no Anki: baralho, coleção ou pesquisa; últimos 12 meses ou todo o histórico.</p></div></div>'+
      '<div class="stat-body anki-stats-fields"><div class="field-group"><div class="field"><label>Escopo</label><select id="anki-stats-scope"><option value="deck"'+(st.scope==='deck'?' selected':'')+'>Baralho</option><option value="collection"'+(st.scope==='collection'?' selected':'')+'>Coleção</option><option value="search"'+(st.scope==='search'?' selected':'')+'>Pesquisa</option></select></div>'+
      '<div class="field"><label>Histórico</label><select id="anki-stats-history"><option value="year"'+(st.history!=='all'?' selected':'')+'>Últimos 12 meses</option><option value="all"'+(st.history==='all'?' selected':'')+'>Todo o histórico</option></select></div></div>'+
      '<div class="field-group"><div class="field"><label>Baralho</label><select id="anki-stats-deck"><option value="">Baralho selecionado</option>'+decks.map(d=>'<option value="'+esc(d.id)+'"'+(String(d.id)===selected?' selected':'')+'>'+esc(d.nome)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Pesquisa</label><input id="anki-stats-search" type="text" value="'+esc(st.search||'')+'" placeholder="Ex.: tag:fiscal -is:suspended"></div></div></div></div>';
  },

  /* ───────────────── MEDIA STORE / ROUND-TRIP ───────────────── */
  _patchImportExport(){
    if(typeof AnkiImport!=='undefined'&&!AnkiImport.__mediaStorePatched){
      AnkiImport.__mediaStorePatched=true;const old=AnkiImport.importPackage.bind(AnkiImport);
      AnkiImport.importPackage=async(parsed,opts)=>{const out=await old(parsed,opts);try{if(parsed&&parsed.pkg&&parsed.pkg.media)await AnkiMediaStore.putAll(parsed.pkg.media);}catch(e){console.warn('Media store import',e);}return out;};
    }
    if(typeof AnkiExport!=='undefined'&&!AnkiExport.__mediaStorePatched){
      AnkiExport.__mediaStorePatched=true;const old=AnkiExport.buildCollection.bind(AnkiExport);
      AnkiExport.buildCollection=async(opts)=>{
        const col=await old(opts);if(opts&&opts.withMedia===false)return col;
        try{
          const stored=await AnkiMediaStore.all(false),seenName=new Set((col.media||[]).map(x=>String(x.name))),seenFp=new Set((col.media||[]).map(x=>AnkiMediaStore.fingerprint(x.bytes)));
          for(const m of stored){if(seenName.has(m.name)||seenFp.has(m.fingerprint))continue;(col.media||(col.media=[])).push({name:m.name,bytes:AnkiMediaStore._u8(m.bytes),mime:m.mime||''});seenName.add(m.name);seenFp.add(m.fingerprint);}
        }catch(e){console.warn('Media store export',e);}return col;
      };
    }
  },

  _mediaRefsFrom(text){
    const s=String(text||''),out=[];let m;
    const attr=/(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;while((m=attr.exec(s)))out.push(m[1]);
    const sound=/\[sound:([^\]]+)\]/gi;while((m=sound.exec(s)))out.push(m[1]);
    const css=/url\(\s*["']?([^)"']+)["']?\s*\)/gi;while((m=css.exec(s)))out.push(m[1]);
    return out;
  },
  _dataFingerprint(uri){
    const m=String(uri||'').match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.*)$/i);if(!m)return null;
    try{return AnkiMediaStore.fingerprint(AnkiExport._base64Bytes(m[2]));}catch(_){return null;}
  },
  async scanMedia(){
    const refs=[],embeddedFp=new Set(),noteMissing=new Map(),notes=AnkiParity.notes(),types=AnkiParity.noteTypes();
    const take=(text,where,noteId)=>{
      this._mediaRefsFrom(text).forEach(ref=>{
        ref=String(ref||'').trim();if(!ref||/^(blob:|https?:|mailto:|#|javascript:)/i.test(ref))return;
        const fp=this._dataFingerprint(ref);if(fp){embeddedFp.add(fp);refs.push({where,noteId,ref:'(incorporada)',fingerprint:fp,embedded:true});}
        else refs.push({where,noteId,ref,embedded:false});
      });
    };
    notes.forEach(n=>Object.entries(n.fields||{}).forEach(([k,v])=>take(v,'Nota '+n.id+' / '+k,n.id)));
    types.forEach(t=>{take(t.css,'Tipo '+t.name+' / CSS',null);take(t.latexPre,'Tipo '+t.name+' / LaTeX',null);take(t.latexPost,'Tipo '+t.name+' / LaTeX',null);(t.templates||[]).forEach(x=>['qfmt','afmt','bqfmt','bafmt'].forEach(k=>take(x[k],'Tipo '+t.name+' / '+x.name+' / '+k,null)));});
    const all=await AnkiMediaStore.all(true),active=all.filter(x=>!x.trashedAt),trash=all.filter(x=>x.trashedAt),byName=new Map(active.map(x=>[x.name,x]));
    const missing=refs.filter(x=>!x.embedded&&!byName.has(x.ref));
    missing.forEach(x=>{if(x.noteId!=null){const k=String(x.noteId);if(!noteMissing.has(k))noteMissing.set(k,[]);noteMissing.get(k).push(x.ref);}});
    const named=new Set(refs.filter(x=>!x.embedded).map(x=>x.ref)),usedFp=new Set(embeddedFp);
    refs.filter(x=>!x.embedded&&byName.has(x.ref)).forEach(x=>usedFp.add(byName.get(x.ref).fingerprint));
    const unused=active.filter(x=>!named.has(x.name)&&!usedFp.has(x.fingerprint));
    const dupGroups=new Map();active.forEach(x=>{if(!dupGroups.has(x.fingerprint))dupGroups.set(x.fingerprint,[]);dupGroups.get(x.fingerprint).push(x);});
    const duplicates=[...dupGroups.values()].filter(x=>x.length>1);
    return {refs,active,trash,missing,unused,duplicates,noteMissing,embeddedCount:refs.filter(x=>x.embedded).length};
  },

  /* ───────────────── ESTATÍSTICAS ───────────────── */
  _patchStats(){
    // A montagem da página é única (CardsScreen.renderStats); aqui só os controles.
    const old=CardsScreen.renderStats.bind(CardsScreen);
    CardsScreen.renderStats=(box)=>{const out=old(box);try{this._bindStatsUi();}catch(e){console.warn('Stats parity',e);}return out;};
  },
  _revDate(r){if(r&&/^\d{4}-\d{2}-\d{2}$/.test(String(r.date||'')))return String(r.date);const ts=Number(r&&r.ts)||0;return ts?(typeof diaDeEstudoDe==='function'?diaDeEstudoDe(ts):new Date(ts).toISOString().slice(0,10)):'';},
  _isAnswerRevlog(r){
    if(!r)return false;
    const kind=typeof CardsScreen!=='undefined'&&CardsScreen._revlogAnki?CardsScreen._revlogAnki(r):null;
    const k=String(kind&&kind.tipo||r.ankiReviewKind||r.phase||'review').toLowerCase();
    if(k==='manual'||k==='rescheduled'||k==='reset'||Number(r.grade)===0)return false;
    return Number(r.grade)>=1&&Number(r.grade)<=4;
  },
  _dayMap(days){
    const span=Math.max(1,Number(days)||this._statsHistoryDays()),m=new Map(),today=todayCards();for(let i=span-1;i>=0;i--)m.set(CardEngine.addDays(today,-i),{count:0,time:0,learning:0,review:0,relearning:0,filtered:0,good:0,total:0});
    for(const r of this.statsRevlog()){if(!this._isAnswerRevlog(r))continue;const d=this._revDate(r),x=m.get(d);if(!x)continue;x.count++;x.time+=Math.max(0,Number(r.time)||0);const ph=String(r.phase||'review');if(ph==='learning')x.learning++;else if(ph==='relearning')x.relearning++;else if(Number(r.ankiReviewKind)===3)x.filtered++;else x.review++;if(Number(r.grade)>=2)x.good++;x.total++;}
    return m;
  },
  /* Séries por dia: começam no primeiro dia com dado (mínimo 14 dias) e são
     agrupadas por dia, semana ou mês para caber em ~30 barras — com 365 barras
     diárias no celular cada uma tinha menos de 1 px e o gráfico sumia. */
  _serie(entries,temDado){
    const primeiro=entries.findIndex(temDado),min=14;
    let xs=primeiro<0?entries.slice(-min):entries.slice(Math.max(0,Math.min(primeiro,entries.length-min)));
    const passo=xs.length<=31?1:xs.length<=31*7?7:30,out=[];
    for(let i=0;i<xs.length;i+=passo){const g=xs.slice(i,i+passo);out.push({ini:g[0][0],fim:g[g.length-1][0],itens:g.map(x=>x[1])});}
    return {grupos:out,passo};
  },
  _dm(iso){return String(iso).slice(8,10)+'/'+String(iso).slice(5,7);},
  _serieHtml(serie,valor,pilhas,fmt,unidade){
    const {grupos,passo}=serie,vals=grupos.map(g=>valor(g)),max=Math.max(0,...vals),esc=x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const rot=g=>passo===1?this._dm(g.ini):this._dm(g.ini)+'–'+this._dm(g.fim);
    const cols=grupos.map((g,i)=>{
      const v=vals[i],h=max?Math.round(v/max*100):0;
      const partes=pilhas?pilhas.map(([cls,f])=>{const n=f(g);return n&&v?'<i class="'+cls+'" style="height:'+(n/v*100)+'%"></i>':'';}).join(''):'<i class="review" style="height:100%"></i>';
      return '<div class="anki-ts-col" title="'+esc(rot(g)+': '+fmt(v)+(unidade?' '+unidade:''))+'"><div class="anki-ts-bar" style="height:'+(v?Math.max(3,h):0)+'%">'+partes+'</div></div>';
    }).join('');
    const total=vals.reduce((a,b)=>a+b,0);
    return '<div class="stat-body"><div class="anki-ts-meta"><span>máx. '+fmt(max)+(unidade?' '+unidade:'')+(passo>1?' por '+(passo===7?'semana':'mês'):' por dia')+'</span><span>total '+fmt(total)+(unidade?' '+unidade:'')+'</span></div>'+
      '<div class="anki-ts" style="grid-template-columns:repeat('+grupos.length+',minmax(0,1fr))">'+cols+'</div>'+
      '<div class="anki-ts-eixo"><span>'+this._dm(grupos[0].ini)+'</span><span>'+(passo===1?'hoje':this._dm(grupos[grupos.length-1].fim))+'</span></div></div>';
  },
  _calendarHtml(){
    // Semanas como colunas (domingo no topo), do início da atividade até hoje.
    const span=this._statsHistoryDays(),m=this._dayMap(span),vals=[...m.entries()],max=Math.max(1,...vals.map(x=>x[1].count));
    const primeiro=vals.findIndex(x=>x[1].count>0),ini=primeiro<0?Math.max(0,vals.length-84):Math.max(0,Math.min(primeiro,vals.length-84));
    let dias=vals.slice(ini);const pad=new Date(dias[0][0]+'T00:00:00').getDay();
    const celulas=Array.from({length:pad},()=>'<span class="anki-cal-day vazio"></span>').concat(dias.map(([d,x])=>{const lvl=x.count?Math.max(1,Math.ceil(x.count/max*4)):0;return '<span class="anki-cal-day l'+lvl+'" title="'+d+': '+x.count+' revisão(ões)"></span>';}));
    const semanas=Math.ceil(celulas.length/7),ativos=dias.filter(x=>x[1].count).length;
    return '<div class="card stat-card anki-max-calendar"><div class="card-header"><div><h2>🗓 Calendário</h2><p class="sub">'+ativos+' dia(s) com revisão · '+this._dm(dias[0][0])+' a '+this._dm(dias[dias.length-1][0])+'</p></div></div>'+
      '<div class="stat-body"><div class="anki-calendar-grid" style="--sem:'+semanas+';grid-template-columns:repeat('+semanas+',minmax(0,1fr))">'+celulas.join('')+'</div>'+
      '<div class="anki-cal-leg"><span>menos</span><span class="anki-cal-day l0"></span><span class="anki-cal-day l1"></span><span class="anki-cal-day l2"></span><span class="anki-cal-day l3"></span><span class="anki-cal-day l4"></span><span>mais</span></div></div></div>';
  },
  _hourlyHtml(){
    const h=Array.from({length:24},()=>({n:0,ok:0,time:0}));for(const r of this.statsRevlog()){if(!this._isAnswerRevlog(r))continue;const ts=Number(r.ts)||0;if(!ts)continue;const d=new Date(ts),x=h[d.getHours()];x.n++;x.time+=Number(r.time)||0;if(Number(r.grade)>=2)x.ok++;}
    const max=Math.max(1,...h.map(x=>x.n)),pico=h.reduce((b,x,i)=>x.n>h[b].n?i:b,0);
    return '<div class="card stat-card"><div class="card-header"><div><h2>🕒 Distribuição por hora</h2><p class="sub">Revisões e acerto por horário'+(h[pico].n?' · pico às '+pico+'h':'')+'</p></div></div><div class="stat-body"><div class="anki-hourly">'+
      h.map((x,i)=>'<div class="anki-hour" title="'+i+'h · '+x.n+' revisões · '+(x.n?Math.round(x.ok/x.n*100):0)+'% acerto"><div class="anki-hour-fill" style="height:'+(x.n?Math.max(4,Math.round(x.n/max*100)):0)+'%"></div></div>').join('')+
      '</div><div class="anki-hour-eixo"><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span></div></div></div>';
  },
  _reviewsHtml(){
    const m=this._dayMap(this._statsHistoryDays()),serie=this._serie([...m.entries()],x=>x[1].count>0);
    const soma=k=>g=>g.itens.reduce((a,x)=>a+x[k],0);
    return '<div class="card stat-card"><div class="card-header"><div><h2>📚 Revisões</h2><p class="sub">Respostas por tipo no período</p></div></div>'+
      this._serieHtml(serie,soma('count'),[['learn',soma('learning')],['review',soma('review')],['relearn',soma('relearning')],['filtered',soma('filtered')]],n=>n.toLocaleString('pt-BR'),'')+
      '<div class="anki-stat-legend"><span><i class="learn"></i>Aprendendo</span><span><i class="review"></i>Revisão</span><span><i class="relearn"></i>Reaprendendo</span><span><i class="filtered"></i>Filtrado</span></div></div>';
  },
  _memoryHtml(){
    const cards=this.statsCards().filter(c=>Number.isFinite(Number(c.s))&&Number(c.s)>0),rBins=[0,0,0,0,0],iBins=[0,0,0,0,0,0],today=todayCards();
    cards.forEach(c=>{const R=CardEngine.retrievabilityDe(c,today,CardsConfig.weightsFor(c.originalDeckId||c.deckId)),ri=Math.min(4,Math.max(0,Math.floor(R*5)));rBins[ri]++;});
    this.statsCards().filter(c=>(c.phase||'new')!=='new').forEach(c=>{const iv=Number(c.intervalo)||0,ii=iv<1?0:iv<7?1:iv<30?2:iv<90?3:iv<365?4:5;iBins[ii]++;});
    return '<div class="stat-grid anki-memory-grid"><div class="card stat-card"><div class="card-header"><div><h2>↔ Intervalos</h2><p class="sub">Intervalo atual dos cards em estudo</p></div></div>'+this._miniHist(iBins,['<1d','1–7d','7–30d','30–90d','90d–1a','>1a'])+'</div>'+
      '<div class="card stat-card"><div class="card-header"><div><h2>🧠 Recuperabilidade</h2><p class="sub">Chance de lembrar hoje · '+cards.length+' cards FSRS</p></div></div>'+this._miniHist(rBins,['0–20%','20–40%','40–60%','60–80%','80–100%'])+'</div></div>';
  },
  _miniHist(arr,labels,cls){
    const mx=Math.max(1,...arr);
    return '<div class="stat-body"><div class="anki-mini-hist" style="grid-template-columns:repeat('+arr.length+',minmax(0,1fr))">'+arr.map((n,i)=>'<div title="'+labels[i]+': '+n+'"><b>'+n+'</b><div class="mh-bar"><i class="'+(cls||'')+'" style="height:'+(n?Math.max(3,Math.round(n/mx*100)):0)+'%"></i></div><span>'+labels[i]+'</span></div>').join('')+'</div></div>';
  },
  /* stats/graphs/today.rs + ts/routes/graphs/today.ts do Anki 26.09.2: respostas
     desde o início do dia (exceto manuais/reagendadas), acertos, maduros pelo
     intervalo ANTERIOR (>= 21) e contagem por tipo do estado antes da resposta. */
  _todayData(){
    const ini=proximaViradaTs()-86400000,d={answerCount:0,answerMillis:0,correctCount:0,matureCount:0,matureCorrect:0,learnCount:0,reviewCount:0,relearnCount:0,earlyReviewCount:0};
    this.statsRevlog(false).forEach(r=>{
      if((Number(r&&r.ts)||0)<ini)return;
      const k=CardsScreen._revlogAnki(r);if(!k||k.tipo==='manual'||k.tipo==='rescheduled'||k.tipo==='reset')return;
      const g=Number(r.grade)||0;d.answerCount++;d.answerMillis+=Math.max(0,Number(r.time)||0);if(g>1)d.correctCount++;
      if(k.last>=21){d.matureCount++;if(g>1)d.matureCorrect++;}
      if(k.tipo==='learning')d.learnCount++;else if(k.tipo==='relearning')d.relearnCount++;else if(k.tipo==='filtered')d.earlyReviewCount++;else d.reviewCount++;
    });
    return d;
  },
  // FluentNumber({maximumFractionDigits:2}) + Intl pt-BR, como ts/lib/generated/ftl-helpers.ts.
  _fnum(n){return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(n);},
  _plural(n){try{return new Intl.PluralRules('pt-BR').select(n);}catch(_){return n===1?'one':'other';}},
  _todayLines(){
    const t=this._todayData();
    if(!t.answerCount)return ['Nenhum cartão foi estudada hoje'];
    const secs=t.answerMillis/1000,unit=secs<60?'s':'m',amount=unit==='s'?secs:secs/60;
    const nome=unit==='s'?(this._plural(amount)==='one'?'segundo':'segundos'):(this._plural(amount)==='one'?'minuto':'minutos');
    const cartoes=this._plural(t.answerCount)==='one'?'cartão':'cartões';
    const estudado='Estudado(s) '+this._fnum(t.answerCount)+' '+cartoes+' em '+this._fnum(amount)+' '+nome+' hoje ('+this._fnum(secs/t.answerCount)+'s/card)';
    const again=t.answerCount-t.correctCount,pct=Math.round(again/t.answerCount*100*100)/100;
    const againTxt='Contagem de repetições: '+again+' ('+pct.toLocaleString('pt-BR')+'%)';
    const tipos='Aprendidos: '+this._fnum(t.learnCount)+', Revisados: '+this._fnum(t.reviewCount)+', Reaprendidos: '+this._fnum(t.relearnCount)+', Filtrados: '+this._fnum(t.earlyReviewCount);
    const maduro=t.matureCount?'Resposta correta de cartões antigos: '+this._fnum(t.matureCorrect)+'/'+this._fnum(t.matureCount)+' ('+this._fnum(t.matureCorrect/t.matureCount*100)+'%)':'Nenhum cartão antigo foi estudado hoje.';
    return [estudado,againTxt,tipos,maduro];
  },
  _todayHtml(){
    const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    return '<div class="card stat-card"><div class="card-header"><div><h2>☀️ Hoje</h2></div></div><div class="stat-body anki-today">'+this._todayLines().map(l=>'<p>'+esc(l)+'</p>').join('')+'</div></div>';
  },
  // stats/graphs/card_counts.rs (excluding_inactive): suspensos e enterrados à parte.
  _cardCountsData(){
    const counts={new:0,learn:0,relearn:0,young:0,mature:0,suspended:0,buried:0};
    this.statsCards().forEach(c=>{if(c.suspenso){counts.suspended++;return;}if(CardEngine.estaEnterrado(c)){counts.buried++;return;}const ph=String(c.phase||'new');if(ph==='new')counts.new++;else if(ph==='learning')counts.learn++;else if(ph==='relearning')counts.relearn++;else if((Number(c.intervalo)||0)>=21)counts.mature++;else counts.young++;});
    return counts;
  },
  // Card Counts do Anki: barra empilhada + legenda com número e porcentagem.
  _cardCountsHtml(){
    const c=this._cardCountsData(),total=Object.values(c).reduce((a,b)=>a+b,0)||1;
    const items=[['Novos',c.new,'var(--text-faint)'],['Aprendendo',c.learn,'var(--warn)'],['Reaprendendo',c.relearn,'var(--bad)'],['Jovens',c.young,'var(--accent)'],['Maduros',c.mature,'var(--good)'],['Suspensos',c.suspended,'#e8b400'],['Enterrados',c.buried,'#8a8f98']];
    const pct=n=>(n/total*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
    return '<div class="card stat-card"><div class="card-header"><div><h2>🧮 Contagem de cards</h2><p class="sub">Estado atual · '+total+' card(s)</p></div></div><div class="stat-body">'+
      '<div class="stat-mat-bar">'+items.filter(x=>x[1]).map(x=>'<span style="flex:'+x[1]+';background:'+x[2]+'" title="'+x[0]+': '+x[1]+'"></span>').join('')+'</div>'+
      '<div class="anki-counts">'+items.map(x=>'<div class="'+(x[1]?'':'zero')+'"><i style="background:'+x[2]+'"></i><span>'+x[0]+'</span><b>'+x[1]+'</b><em>'+pct(x[1])+'</em></div>').join('')+'</div></div></div>';
  },
  // Review Time do Anki: minutos por dia/semana/mês no período.
  _reviewTimeHtml(){
    const m=this._dayMap(this._statsHistoryDays()),serie=this._serie([...m.entries()],x=>x[1].time>0);
    const min=g=>g.itens.reduce((a,x)=>a+x.time,0)/60000;
    return '<div class="card stat-card"><div class="card-header"><div><h2>⏱ Tempo de revisão</h2><p class="sub">Minutos respondendo cards no período</p></div></div>'+
      this._serieHtml(serie,min,null,n=>n.toLocaleString('pt-BR',{maximumFractionDigits:1}),'min')+'</div>';
  },
  _addedHtml(){
    const span=this._statsHistoryDays(),today=todayCards(),m=new Map();
    for(let i=span-1;i>=0;i--)m.set(CardEngine.addDays(today,-i),0);
    for(const card of this.statsCards()){
      const raw=card.createdAt||card.created_at||'',d=raw?new Date(raw):null;
      if(!d||!Number.isFinite(d.getTime()))continue;
      const key=typeof diaDeEstudoDe==='function'?diaDeEstudoDe(d.getTime()):d.toISOString().slice(0,10);if(m.has(key))m.set(key,(m.get(key)||0)+1);
    }
    const serie=this._serie([...m.entries()],x=>x[1]>0);
    return '<div class="card stat-card" data-anki-stat-graph="added"><div class="card-header"><div><h2>➕ Adicionados</h2><p class="sub">Cards criados no período</p></div></div>'+
      this._serieHtml(serie,g=>g.itens.reduce((a,b)=>a+b,0),[['review',g=>g.itens.reduce((a,b)=>a+b,0)]],n=>n.toLocaleString('pt-BR'),'')+'</div>';
  },
  _simCardHtml(){
    return '<div class="card stat-card anki-sim-card"><div class="card-header"><div><h2>🧪 Simulador FSRS</h2><p class="sub">Projeta a carga futura com os estados S/D reais, os parâmetros e a retenção desejada.</p></div></div><div class="stat-body"><button type="button" class="btn-primary" id="anki-open-simulator">Abrir simulador</button></div></div>';
  },

  _easeHtml(){
    const xs=this.statsCards().filter(c=>Number.isFinite(Number(c.ease))&&Number(c.ease)>0),bins=[0,0,0,0,0,0];
    xs.forEach(c=>{const e=Number(c.ease);let i=e<1.5?0:e<2?1:e<2.5?2:e<3?3:e<3.5?4:5;bins[i]++;});
    return '<div class="card stat-card"><div class="card-header"><div><h2>🎚 Facilidade (SM-2)</h2><p class="sub">Card Ease dos cards no agendador clássico</p></div></div>'+this._miniHist(bins,['<150%','150–199','200–249','250–299','300–349','≥350%'])+'</div>';
  },
  // Compatibilidade: fragmento só da parte "Anki" (a página completa é montada em CardsScreen.renderStats).
  statsHtml(){
    return '<div class="anki-max-stats">'+this._statsControlsHtml()+this._todayHtml()+this._calendarHtml()+
      '<div class="stat-grid">'+this._reviewsHtml()+this._reviewTimeHtml()+'</div>'+
      '<div class="stat-grid">'+this._cardCountsHtml()+this._hourlyHtml()+'</div>'+
      this._memoryHtml()+this._addedHtml()+this._simCardHtml()+'</div>';
  },
  _bindStatsUi(){
    const b=document.getElementById('anki-open-simulator');if(b)b.onclick=()=>this.openSimulator();
    const rerender=()=>{if(typeof CardsScreen!=='undefined'&&CardsScreen.renderContent)CardsScreen.renderContent();};
    const scope=document.getElementById('anki-stats-scope');if(scope)scope.onchange=()=>{this._statsState.scope=scope.value;rerender();};
    const history=document.getElementById('anki-stats-history');if(history)history.onchange=()=>{this._statsState.history=history.value;rerender();};
    const deck=document.getElementById('anki-stats-deck');if(deck)deck.onchange=()=>{this._statsState.deckId=deck.value||null;this._statsState.scope='deck';rerender();};
    const search=document.getElementById('anki-stats-search');if(search){
      const apply=()=>{this._statsState.search=search.value||'';if(this._statsState.search.trim())this._statsState.scope='search';rerender();};
      search.onchange=apply;search.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();apply();}};
    }
  },

  _simNumericCardId(card,index){
    const raw=card&&card.ankiId!=null?Number(card.ankiId):NaN;
    if(Number.isSafeInteger(raw)&&raw>0)return raw;
    const key=String(card&&card.id!=null?card.id:index),h=typeof FSRS!=='undefined'&&FSRS._hash?FSRS._hash(key):index+1;
    return 1000000000+(Number(h)>>>0);
  },
  _simSignedDays(a,b){
    const x=new Date(String(a||'')+'T00:00:00'),y=new Date(String(b||'')+'T00:00:00');
    const n=Math.round((y-x)/86400000);return Number.isFinite(n)?n:0;
  },
  _simNextDayAtSec(cfg){
    const now=new Date(),cut=new Date(now),hour=Math.max(0,Math.min(23,(cfg&&cfg.rolloverHour!=null&&Number.isFinite(Number(cfg.rolloverHour)))?Number(cfg.rolloverHour):4));
    cut.setHours(hour,0,0,0);if(cut<=now)cut.setDate(cut.getDate()+1);
    return Math.floor(cut.getTime()/1000);
  },
  _simReviewKind(row){
    const explicit=row&&(row.ankiReviewKind!=null?row.ankiReviewKind:row.reviewKind);
    if(Number.isInteger(Number(explicit))&&Number(explicit)>=0&&Number(explicit)<=5)return Number(explicit);
    const k=String(explicit==null?'':explicit).toLowerCase();
    if(k==='learning')return 0;if(k==='review')return 1;if(k==='relearning')return 2;if(k==='filtered'||k==='cram')return 3;if(k==='manual')return 4;if(k==='rescheduled')return 5;
    const p=String(row&&row.phase||row&&row.kind||'review').toLowerCase();
    if(p==='learning')return 0;if(p==='relearning')return 2;if(p==='filtered'||p==='cram')return 3;if(p==='manual')return 4;if(p==='rescheduled')return 5;return 1;
  },
  async simulateOfficial(days,retention,opts){
    opts=opts||{};days=Math.max(1,Math.min(3650,Math.round(Number(days)||365)));retention=Math.max(.7,Math.min(.99,Number(retention)||.9));
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.simulateFsrsPreset!=='function')throw new Error('Simulador oficial do Anki indisponível.');
    const state=this._statsState||{},deckId=state.scope==='deck'?this._statsSelectedDeckId():null,
      r=await CardsOfficialBridge.simulateFsrsPreset(deckId,days,retention,opts,'review'),out=r.out||{},
      reviews=Array.isArray(out.daily_review_count)?out.daily_review_count:[],
      news=Array.isArray(out.daily_new_count)?out.daily_new_count:[],
      time=Array.isArray(out.daily_time_cost)?out.daily_time_cost:[],
      memorized=Array.isArray(out.accumulated_knowledge_acquisition)?out.accumulated_knowledge_acquisition:[];
    return {
      days,retention,reviews,news,time,memorized,correct:[],introducedByDay:[],
      introduced:0,sample:null,scale:1,additionalNew:Number(r.payload&&r.payload.deck_size)||0,
      newLimit:Number(r.payload&&r.payload.new_limit)||0,reviewLimit:Number(r.payload&&r.payload.review_limit)||0,
      maxInterval:Number(r.payload&&r.payload.max_interval)||36500,
      engine:'Anki 26.09.3 · simulate_fsrs_review',search:r.search,preset:r.presetName
    };
  },

  _injectSimulator(){
    if(document.getElementById('anki-fsrs-simulator'))return;const cfg=CardsConfig.get(),d=document.createElement('div');d.innerHTML='<div id="anki-fsrs-simulator" class="cards-modal anki-product-modal" style="display:none"><div class="cards-modal-box cards-modal-lg"><div class="cards-modal-head"><div><h2>🧪 Simulador FSRS</h2><p class="sub">Estimativa de carga com os mesmos controles documentados no Anki atual.</p></div><button class="icon-btn" id="anki-sim-close">✕</button></div><div class="cards-modal-body">'+
      '<div class="field-group"><div class="field"><label>Dias a simular</label><input id="anki-sim-days" type="number" min="1" max="3650" value="365"></div><div class="field"><label>Retenção desejada (%)</label><input id="anki-sim-retention" type="number" min="70" max="99" value="'+Math.round((cfg.retention||.9)*100)+'"></div></div>'+
      '<div class="field-group"><div class="field"><label>Cards novos adicionais</label><input id="anki-sim-additional" type="number" min="0" max="1000000" value="0"></div><div class="field"><label>Novos por dia</label><input id="anki-sim-new-limit" type="number" min="0" max="999999" value="'+Math.max(0,Number(cfg.newPerDay)||0)+'"></div></div>'+
      '<div class="field-group"><div class="field"><label>Máximo de revisões/dia</label><input id="anki-sim-review-limit" type="number" min="0" max="999999" value="'+Math.max(0,Number(cfg.revPerDay)||0)+'"></div><div class="field"><label>Intervalo máximo (dias)</label><input id="anki-sim-max-interval" type="number" min="1" max="36500" value="'+Math.max(1,Number(cfg.maxInterval)||36500)+'"></div></div>'+
      '<div class="anki-sim-actions"><button class="btn-primary" id="anki-sim-run">Simular</button><button class="btn-secondary" id="anki-sim-help">Help Me Decide</button></div><div id="anki-sim-result"></div></div></div></div>';document.body.appendChild(d);
    document.getElementById('anki-sim-close').onclick=()=>document.getElementById('anki-fsrs-simulator').style.display='none';document.getElementById('anki-sim-run').onclick=()=>this.runSimulator();document.getElementById('anki-sim-help').onclick=()=>this.runHelpMeDecide();
  },
  openSimulator(){document.getElementById('anki-fsrs-simulator').style.display='flex';},
  _simBars(arr,maxBars=90){
    const group=Math.max(1,Math.ceil(arr.length/maxBars)),xs=[];for(let i=0;i<arr.length;i+=group)xs.push(arr.slice(i,i+group).reduce((a,b)=>a+b,0)/Math.min(group,arr.length-i));const mx=Math.max(1,...xs);return '<div class="anki-sim-bars">'+xs.map((n,i)=>'<i style="height:'+Math.max(n?3:0,Math.round(n/mx*100))+'%" title="Período '+(i+1)+': '+Math.round(n)+'"></i>').join('')+'</div>';
  },
  async runSimulator(){
    const days=Number(document.getElementById('anki-sim-days').value)||365,r=(Number(document.getElementById('anki-sim-retention').value)||90)/100,
      opts={additionalNew:Number(document.getElementById('anki-sim-additional').value)||0,newLimit:Number(document.getElementById('anki-sim-new-limit').value)||0,reviewLimit:Number(document.getElementById('anki-sim-review-limit').value)||0,maxInterval:Number(document.getElementById('anki-sim-max-interval').value)||36500,approximate:false},
      out=document.getElementById('anki-sim-result');
    out.innerHTML='<p class="hint">Simulando pela Collection oficial do Anki 26.09.3…</p>';
    try{
      const sim=await this.simulateOfficial(days,r,opts),total=sim.reviews.reduce((a,b)=>a+b,0)+sim.news.reduce((a,b)=>a+b,0),secs=sim.time.reduce((a,b)=>a+b,0);
      out.innerHTML='<div class="stat-kpis"><div class="stat-kpi"><div class="stat-kpi-v">'+Math.round(total/days)+'</div><div class="stat-kpi-l">respostas/dia</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+(secs/60/days).toFixed(1)+'m</div><div class="stat-kpi-l">tempo/dia</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+Math.round(sim.memorized.at(-1)||0)+'</div><div class="stat-kpi-l">memorizados ao final</div></div></div><h3>Carga projetada</h3>'+this._simBars(sim.reviews.map((x,i)=>x+sim.news[i]))+'<p class="hint">Motor oficial '+AnkiProductParity.esc(sim.engine)+' · busca '+AnkiProductParity.esc(sim.search||'preset atual')+'. A Collection do Anki aplica histórico, limites, Easy Days e parâmetros do preset.</p>';
      return sim;
    }catch(e){console.error(e);out.innerHTML='<p class="hint tone-bad">Falha ao executar o simulador oficial: '+AnkiProductParity.esc(e&&e.message||e)+'</p>';throw e;}
  },
  async runHelpMeDecide(){
    const out=document.getElementById('anki-sim-result');if(!out)return;
    const days=Number(document.getElementById('anki-sim-days').value)||365,
      retention=(Number(document.getElementById('anki-sim-retention').value)||90)/100,
      opts={additionalNew:Number(document.getElementById('anki-sim-additional').value)||0,newLimit:Number(document.getElementById('anki-sim-new-limit').value)||0,reviewLimit:Number(document.getElementById('anki-sim-review-limit').value)||0,maxInterval:Number(document.getElementById('anki-sim-max-interval').value)||36500},
      state=this._statsState||{},deckId=state.scope==='deck'?this._statsSelectedDeckId():null;
    if(!window.CardsOfficialBridge||typeof CardsOfficialBridge.simulateFsrsPreset!=='function')throw new Error('Help Me Decide oficial indisponível.');
    out.innerHTML='<p class="hint">Calculando retenção ótima pela Collection oficial do Anki 26.09.3…</p>';
    try{
      const r=await CardsOfficialBridge.simulateFsrsPreset(deckId,days,retention,opts,'optimal'),
        rawOptimal=Number(r.out&&r.out.optimal_retention);
      if(!Number.isFinite(rawOptimal)||rawOptimal<=0)throw new Error('O Anki não retornou retenção ótima para estes dados.');
      const optimal=Math.max(.7,Math.min(.99,rawOptimal));
      const pct=(optimal*100).toFixed(2);
      out.innerHTML='<h3>Help Me Decide · Anki oficial</h3><div class="stat-kpis"><div class="stat-kpi"><div class="stat-kpi-v">'+pct+'%</div><div class="stat-kpi-l">retenção ótima prevista</div></div></div>'+
        '<p class="hint">Resultado de <code>compute_optimal_retention()</code> para o preset e limites atuais.</p>'+
        '<button type="button" class="btn-primary" id="anki-sim-use-optimal">Usar '+pct+'% no simulador</button>';
      const b=out.querySelector('#anki-sim-use-optimal');if(b)b.onclick=()=>{document.getElementById('anki-sim-retention').value=String(Math.round(optimal*10000)/100);void this.runSimulator();};
      return optimal;
    }catch(e){
      out.innerHTML='<p class="hint tone-bad">Help Me Decide falhou: '+AnkiProductParity.esc(e&&e.message||e)+'</p>';throw e;
    }
  },

  /* ───────────────── CHECK DATABASE / MEDIA ───────────────── */
  _patchCheck(){
    const modal=document.getElementById('anki-check-modal');if(!modal)return;
    const foot=modal.querySelector('.cards-modal-foot');if(foot&&!document.getElementById('anki-check-advanced')){
      const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.id='anki-check-advanced';b.textContent='🧰 Reparos avançados';foot.insertBefore(b,foot.firstChild);
      b.onclick=()=>this.repairAdvanced();
    }
    const old=AnkiProductParity.renderCheck.bind(AnkiProductParity);
    AnkiProductParity.renderCheck=()=>{old();this.renderExtendedCheck();};
  },
  structuralIssues(){
    const cards=this._cardsSource(),notes=AnkiParity.notes(),types=AnkiParity.noteTypes(),deckIds=new Set(this._decksSource().map(d=>String(d.id))),cardAnki=new Map(),orphanNotes=[],badOrd=[],badFiltered=[],badTypes=[];
    cards.forEach(c=>{const k=String(c.ankiId||'');if(k){if(!cardAnki.has(k))cardAnki.set(k,[]);cardAnki.get(k).push(c.id);}const n=AnkiParity.getNote(AnkiProductParity.noteId(c)),nt=n&&AnkiProductParity._typeFor(n);if(nt&&nt.kind!=='cloze'&&(Number(c.ankiTemplateOrd)||0)>=(nt.templates||[]).length)badOrd.push(c.id);if(c.originalDeckId&&!deckIds.has(String(c.originalDeckId)))badFiltered.push(c.id);});
    const used=new Set(cards.map(c=>String(AnkiProductParity.noteId(c))));notes.forEach(n=>{if(!used.has(String(n.id)))orphanNotes.push(n.id);});
    types.forEach(t=>{const names=(t.fields||[]).map(f=>String(f.name||'').toLowerCase()),dup=names.length!==new Set(names).size;if(!(t.fields||[]).length||!(t.templates||[]).length||dup)badTypes.push(t.id);});
    return {duplicateCardIds:[...cardAnki.values()].filter(x=>x.length>1),orphanNotes,badOrd,badFiltered,badTypes};
  },
  async renderExtendedCheck(){
    const body=document.getElementById('anki-check-body');if(!body)return;
    const s=this.structuralIssues(),wrap=document.createElement('div');wrap.id='anki-check-extended';
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
      wrap.innerHTML='<h3 class="anki-section-title">Verificação oficial</h3><div class="anki-check-grid">'+
        [['Notas sem cards (espelho)',s.orphanNotes.length],['Ordinais inválidos (espelho)',s.badOrd.length],['Filtered sem home deck (espelho)',s.badFiltered.length],['Note Types inválidos (espelho)',s.badTypes.length],['IDs Anki duplicados (espelho)',s.duplicateCardIds.length],['Referências ausentes',missing.length],['Mídias não utilizadas',unused.length],['Lixeira de mídia',haveTrash?1:0]]
        .map(r=>'<div><span>'+AnkiProductParity.esc(r[0])+'</span><strong>'+r[1]+'</strong></div>').join('')+'</div>'+
        (report?'<details open><summary>Relatório do Check Media</summary><pre class="anki-check-report">'+AnkiProductParity.esc(report)+'</pre></details>':'')+
        '<div class="anki-media-actions">'+
          '<button class="btn-secondary" id="anki-media-tag-missing" '+(!missingNotes.length?'disabled':'')+'>🏷 Etiquetar notas com mídia ausente</button>'+
          '<button class="btn-secondary" id="anki-media-trash-unused" '+(!unused.length?'disabled':'')+'>🗑 Excluir não utilizadas</button>'+
          '<button class="btn-secondary" id="anki-media-render-latex" '+(!missing.some(x=>String(x).startsWith('latex-'))?'disabled':'')+'>∑ Renderizar LaTeX</button>'+
          '<button class="btn-secondary" id="anki-media-restore" '+(!haveTrash?'disabled':'')+'>↺ Restaurar lixeira</button>'+
          '<button class="btn-danger" id="anki-media-empty-trash" '+(!haveTrash?'disabled':'')+'>Esvaziar lixeira</button></div>';
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
      if(out&&out.count)showToast(out.count+' nota(s) etiquetada(s) com missing-media pelo Anki oficial ✓');
      else showToast('Nenhuma nota precisava da tag missing-media');
      CardsOfficialBridge.invalidate('media-tag-missing');await CardsOfficialBridge.bootstrap(true);AnkiProductParity.renderCheck();
    }catch(e){showToast('Não foi possível etiquetar: '+(e&&e.message?e.message:String(e)));}
  },
  async trashUnusedOfficial(files){
    if(!files||!files.length)return;
    const ok=await UI.confirm('Excluir '+files.length+' mídia(s) não utilizadas? O Anki moverá os arquivos para a lixeira.',{title:'Excluir mídia não utilizada',okText:'Excluir',danger:true});
    if(!ok)return;
    try{
      await CardsOfficialBridge.trashOfficialMedia(files);showToast(files.length+' mídia(s) movida(s) para a lixeira pelo Anki oficial ✓');AnkiProductParity.renderCheck();
    }catch(e){showToast('Não foi possível excluir as mídias: '+(e&&e.message?e.message:String(e)));}
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
      if(out&&out.ok)showToast('Todo o LaTeX foi renderizado pelo Anki oficial ✓');
      else showToast('Erro de LaTeX na nota '+String(out&&out.note_id||'?')+': '+String(out&&out.error||'erro desconhecido'));
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
