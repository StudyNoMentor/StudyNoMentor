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
  _cardsSource(){try{if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.cards)return StudyGlobalScope.cards();}catch(_){}return DB.getCards();},
  _decksSource(){try{if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.decks)return StudyGlobalScope.decks();}catch(_){}return DB.getDecks();},
  _revlogSource(){try{if(typeof window!=='undefined'&&window.StudyGlobalScope&&StudyGlobalScope.revlog)return StudyGlobalScope.revlog();}catch(_){}return DB.getRevlog();},
  _statsSelectedDeckId(){
    const explicit=this._statsState&&this._statsState.deckId;
    if(explicit!=null&&explicit!=='')return String(explicit);
    try{if(typeof AnkiParity!=='undefined'&&AnkiParity.selectedDeckId)return String(AnkiParity.selectedDeckId()||'');}catch(_){}
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
    return '<div class="card stat-card anki-stats-controls"><div class="card-header"><div><h2>Escopo das estatísticas</h2><p class="sub">Mesmo modelo de escopo do Anki: baralho, coleção ou pesquisa; últimos 12 meses ou todo o histórico.</p></div></div>'+
      '<div class="field-group"><div class="field"><label>Escopo</label><select id="anki-stats-scope"><option value="deck"'+(st.scope==='deck'?' selected':'')+'>Baralho</option><option value="collection"'+(st.scope==='collection'?' selected':'')+'>Coleção</option><option value="search"'+(st.scope==='search'?' selected':'')+'>Pesquisa</option></select></div>'+
      '<div class="field"><label>Histórico</label><select id="anki-stats-history"><option value="year"'+(st.history!=='all'?' selected':'')+'>Últimos 12 meses</option><option value="all"'+(st.history==='all'?' selected':'')+'>Todo o histórico</option></select></div></div>'+
      '<div class="field-group"><div class="field"><label>Baralho</label><select id="anki-stats-deck"><option value="">Baralho selecionado</option>'+decks.map(d=>'<option value="'+esc(d.id)+'"'+(String(d.id)===selected?' selected':'')+'>'+esc(d.nome)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label>Pesquisa</label><input id="anki-stats-search" type="text" value="'+esc(st.search||'')+'" placeholder="Ex.: tag:fiscal -is:suspended"></div></div></div>';
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
    const old=CardsScreen.renderStats.bind(CardsScreen);
    CardsScreen.renderStats=(box)=>{const out=old(box);try{box.insertAdjacentHTML('beforeend',this.statsHtml());this._bindStatsUi();}catch(e){console.warn('Stats parity',e);}return out;};
  },
  _revDate(r){if(r&&/^\d{4}-\d{2}-\d{2}$/.test(String(r.date||'')))return String(r.date);const ts=Number(r&&r.ts)||0;return ts?new Date(ts).toISOString().slice(0,10):'';},
  _dayMap(days){
    const span=Math.max(1,Number(days)||this._statsHistoryDays()),m=new Map(),today=todayCards();for(let i=span-1;i>=0;i--)m.set(CardEngine.addDays(today,-i),{count:0,time:0,learning:0,review:0,relearning:0,filtered:0,good:0,total:0});
    for(const r of this.statsRevlog()){const d=this._revDate(r),x=m.get(d);if(!x)continue;x.count++;x.time+=Math.max(0,Number(r.time)||0);const ph=String(r.phase||'review');if(ph==='learning')x.learning++;else if(ph==='relearning')x.relearning++;else if(Number(r.ankiReviewKind)===3)x.filtered++;else x.review++;if(Number(r.grade)>=2)x.good++;x.total++;}
    return m;
  },
  _calendarHtml(){
    const span=this._statsHistoryDays(),m=this._dayMap(span),vals=[...m.entries()],max=Math.max(1,...vals.map(x=>x[1].count));
    return '<div class="card stat-card anki-max-calendar"><div class="card-header"><div><h2>🗓 Calendário</h2><p class="sub">Atividade de revisão no período selecionado</p></div></div><div class="anki-calendar-grid">'+vals.map(([d,x])=>{const lvl=x.count?Math.max(1,Math.ceil(x.count/max*4)):0;return '<span class="anki-cal-day l'+lvl+'" title="'+d+': '+x.count+' revisão(ões)"></span>';}).join('')+'</div></div>';
  },
  _hourlyHtml(){
    const h=Array.from({length:24},()=>({n:0,ok:0,time:0}));for(const r of this.statsRevlog()){const ts=Number(r.ts)||0;if(!ts)continue;const d=new Date(ts),x=h[d.getHours()];x.n++;x.time+=Number(r.time)||0;if(Number(r.grade)>=2)x.ok++;}
    const max=Math.max(1,...h.map(x=>x.n));
    return '<div class="card stat-card"><div class="card-header"><div><h2>🕒 Distribuição por hora</h2><p class="sub">Quantidade e retenção por horário das revisões registradas</p></div></div><div class="anki-hourly">'+h.map((x,i)=>'<div class="anki-hour" title="'+i+'h · '+x.n+' revisões · '+(x.n?Math.round(x.ok/x.n*100):0)+'% acerto"><div class="anki-hour-fill" style="height:'+Math.max(x.n?4:0,Math.round(x.n/max*100))+'%"></div><span>'+String(i).padStart(2,'0')+'</span></div>').join('')+'</div></div>';
  },
  _reviewsHtml(){
    const span=this._statsHistoryDays(),m=this._dayMap(span),xs=[...m.entries()],max=Math.max(1,...xs.map(x=>x[1].count));
    return '<div class="card stat-card"><div class="card-header"><div><h2>📚 Revisões</h2><p class="sub">Período selecionado · learning, review, relearning e filtradas</p></div></div><div class="anki-review-bars">'+xs.map(([d,x])=>{const H=Math.round(x.count/max*100),part=k=>x.count?Math.round(x[k]/x.count*H):0;return '<div class="anki-review-day" title="'+d+' · '+x.count+'"><div class="anki-stack"><i class="learn" style="height:'+part('learning')+'%"></i><i class="review" style="height:'+part('review')+'%"></i><i class="relearn" style="height:'+part('relearning')+'%"></i><i class="filtered" style="height:'+part('filtered')+'%"></i></div></div>';}).join('')+'</div><div class="anki-stat-legend"><span>Aprendendo</span><span>Revisão</span><span>Reaprendendo</span><span>Filtrado</span></div></div>';
  },
  _futureHtml(){
    const cards=this.statsCards().filter(c=>!c.suspenso&&(c.phase||'new')!=='new'&&!c.dueTs),today=todayCards(),weeks=Array.from({length:13},()=>0),backlog=cards.filter(c=>String(c.due||today)<today).length;
    cards.forEach(c=>{const n=CardEngine._daysBetween(today,c.due||today);if(String(c.due||today)<today)return;const w=Math.floor(n/7);if(w>=0&&w<weeks.length)weeks[w]++;});
    const max=Math.max(1,...weeks);
    return '<div class="card stat-card"><div class="card-header"><div><h2>📅 Vencimentos futuros</h2><p class="sub">Próximos 90 dias por semana'+(backlog?' · '+backlog+' atrasado(s)':'')+'</p></div></div><div class="anki-future-bars">'+weeks.map((n,i)=>'<div title="Semana '+(i+1)+': '+n+'"><i style="height:'+Math.max(n?4:0,Math.round(n/max*100))+'%"></i><span>'+(i+1)+'</span></div>').join('')+'</div></div>';
  },
  _memoryHtml(){
    const cards=this.statsCards().filter(c=>Number.isFinite(Number(c.s))&&Number(c.s)>0),rBins=[0,0,0,0,0],iBins=[0,0,0,0,0,0],today=todayCards();
    cards.forEach(c=>{const R=CardEngine.retrievabilityDe(c,today,CardsConfig.weightsFor(c.originalDeckId||c.deckId)),ri=Math.min(4,Math.max(0,Math.floor(R*5)));rBins[ri]++;const iv=Number(c.intervalo)||0,ii=iv<1?0:iv<7?1:iv<30?2:iv<90?3:iv<365?4:5;iBins[ii]++;});
    const bars=(arr,labels)=>{const mx=Math.max(1,...arr);return '<div class="anki-mini-hist">'+arr.map((n,i)=>'<div title="'+labels[i]+': '+n+'"><i style="height:'+Math.max(n?3:0,Math.round(n/mx*100))+'%"></i><span>'+labels[i]+'</span></div>').join('')+'</div>';};
    return '<div class="stat-grid anki-memory-grid"><div class="card stat-card"><div class="card-header"><div><h2>🧠 Recuperabilidade</h2><p class="sub">'+cards.length+' cards FSRS</p></div></div>'+bars(rBins,['0–20','20–40','40–60','60–80','80–100'])+'</div><div class="card stat-card"><div class="card-header"><div><h2>↔ Intervalos</h2></div></div>'+bars(iBins,['<1d','1–7','7–30','30–90','90–365','>1a'])+'</div></div>';
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
    return '<div class="card stat-card"><div class="card-header"><div><h2>Hoje</h2></div></div>'+this._todayLines().map(l=>'<p>'+esc(l)+'</p>').join('')+'</div>';
  },
  // stats/graphs/card_counts.rs (excluding_inactive): suspensos e enterrados à parte.
  _cardCountsData(){
    const counts={new:0,learn:0,relearn:0,young:0,mature:0,suspended:0,buried:0};
    this.statsCards().forEach(c=>{if(c.suspenso){counts.suspended++;return;}if(CardEngine.estaEnterrado(c)){counts.buried++;return;}const ph=String(c.phase||'new');if(ph==='new')counts.new++;else if(ph==='learning')counts.learn++;else if(ph==='relearning')counts.relearn++;else if((Number(c.intervalo)||0)>=21)counts.mature++;else counts.young++;});
    return counts;
  },
  _cardCountsHtml(){
    const counts=this._cardCountsData();
    const items=[['New',counts.new],['Learning',counts.learn],['Relearning',counts.relearn],['Young',counts.young],['Mature',counts.mature],['Suspended',counts.suspended],['Buried',counts.buried]],mx=Math.max(1,...items.map(x=>x[1]));
    return '<div class="card stat-card"><div class="card-header"><div><h2>Card Counts</h2><p class="sub">Estado atual dos cards</p></div></div><div class="anki-mini-hist">'+items.map(([k,n])=>'<div title="'+k+': '+n+'"><i style="height:'+Math.max(n?3:0,Math.round(n/mx*100))+'%"></i><span>'+k+'</span></div>').join('')+'</div></div>';
  },
  _reviewTimeHtml(){
    const span=this._statsHistoryDays(),m=this._dayMap(span),xs=[...m.entries()],max=Math.max(1,...xs.map(x=>x[1].time));
    return '<div class="card stat-card"><div class="card-header"><div><h2>Review Time</h2><p class="sub">Tempo de revisão no período selecionado</p></div></div><div class="anki-review-bars">'+xs.map(([d,x])=>'<div class="anki-review-day" title="'+d+' · '+(x.time/60000).toFixed(1)+' min"><div class="anki-stack"><i class="review" style="height:'+Math.max(x.time?3:0,Math.round(x.time/max*100))+'%"></i></div></div>').join('')+'</div></div>';
  },
  _addedHtml(){
    const span=this._statsHistoryDays(),today=todayCards(),m=new Map();
    for(let i=span-1;i>=0;i--)m.set(CardEngine.addDays(today,-i),0);
    for(const card of this.statsCards()){
      const raw=card.createdAt||card.created_at||'',d=raw?new Date(raw):null;
      if(!d||!Number.isFinite(d.getTime()))continue;
      const key=d.toISOString().slice(0,10);if(m.has(key))m.set(key,(m.get(key)||0)+1);
    }
    const xs=[...m.entries()],max=Math.max(1,...xs.map(x=>x[1]));
    return '<div class="card stat-card" data-anki-stat-graph="added"><div class="card-header"><div><h2>➕ Adicionados</h2><p class="sub">Cards adicionados no período selecionado</p></div></div><div class="anki-review-bars">'+xs.map(([d,n])=>'<div class="anki-review-day" title="'+d+' · '+n+' card(s)"><div class="anki-stack"><i class="learn" style="height:'+Math.max(n?3:0,Math.round(n/max*100))+'%"></i></div></div>').join('')+'</div></div>';
  },

  _easeHtml(){
    const xs=this.statsCards().filter(c=>Number.isFinite(Number(c.ease))&&Number(c.ease)>0),bins=[0,0,0,0,0,0];
    xs.forEach(c=>{const e=Number(c.ease);let i=e<1.5?0:e<2?1:e<2.5?2:e<3?3:e<3.5?4:5;bins[i]++;});
    const labels=['<150%','150–199','200–249','250–299','300–349','≥350%'],mx=Math.max(1,...bins);
    return '<div class="card stat-card"><div class="card-header"><div><h2>Card Ease</h2><p class="sub">Facilidade dos cards no scheduler clássico/importado</p></div></div><div class="anki-mini-hist">'+bins.map((n,i)=>'<div title="'+labels[i]+': '+n+'"><i style="height:'+Math.max(n?3:0,Math.round(n/mx*100))+'%"></i><span>'+labels[i]+'</span></div>').join('')+'</div></div>';
  },
  statsHtml(){
    return '<div class="anki-max-stats">'+this._statsControlsHtml()+this._todayHtml()+this._calendarHtml()+
      '<div class="stat-grid">'+this._reviewsHtml()+this._reviewTimeHtml()+'</div>'+
      '<div class="stat-grid">'+this._cardCountsHtml()+this._hourlyHtml()+'</div>'+
      '<div class="stat-grid">'+this._futureHtml()+this._easeHtml()+'</div>'+
      '<div class="card stat-card anki-sim-card"><div class="card-header"><div><h2>🧪 Simulador FSRS</h2><p class="sub">Projeta carga usando os estados S/D reais, parâmetros e retenção desejada.</p></div></div><button type="button" class="btn-primary" id="anki-open-simulator">Abrir simulador</button></div>'+
      this._memoryHtml()+this._addedHtml()+'</div>';
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
    const state=this._statsState||{},deckId=state.scope==='deck'?this._statsSelectedDeckId():null,
      cfg=deckId?CardsConfig.forDeck(deckId):CardsConfig.get(),
      scoped=this.statsCards().filter(c=>!c.suspenso),today=todayCards(),
      w=(CardsConfig.weightsFor&&deckId)?CardsConfig.weightsFor(deckId):(cfg.weights&&FSRS.pesosValidos(cfg.weights)?cfg.weights:FSRS.DEFAULT_W),
      params=FSRS.migrarW(w)||FSRS.DEFAULT_W.slice(),
      newLimit=Math.max(0,Math.round(opts.newLimit==null?Number(cfg.newPerDay)||0:Number(opts.newLimit)||0)),
      reviewLimit=Math.max(0,Math.round(opts.reviewLimit==null?Number(cfg.revPerDay)||0:Number(opts.reviewLimit)||0)),
      maxInterval=Math.max(1,Math.min(36500,Math.round(opts.maxInterval==null?Number(cfg.maxInterval)||36500:Number(opts.maxInterval)||36500))),
      additionalNew=Math.max(0,Math.round(Number(opts.additionalNew)||0));
    const cardKey=new Map(),existing=[],newCards=[];
    scoped.forEach((c,i)=>{
      const cid=this._simNumericCardId(c,i);cardKey.set(String(c.id),cid);if(c.ankiId!=null)cardKey.set(String(c.ankiId),cid);
      const phase=String(c.phase||(((c.reps||0)>0&&(c.intervalo||0)>0)?'review':'new'));
      if(phase==='new'){newCards.push(c);return;}
      const stability=Number(c.s),difficulty=Number(c.d),hasMemory=stability>0&&Number.isFinite(difficulty),
        easeRaw=Number(c.easeFactor!=null?c.easeFactor:(c.ease!=null?c.ease:2.5)),
        easeFactor=Number.isFinite(easeRaw)?(easeRaw>10?easeRaw/1000:easeRaw):2.5;
      const interval=Math.max(0,Number(c.intervalo)||0);
      let due=0,lastDate=0;
      if(phase==='learning'||phase==='relearning'||c.dueTs){due=0;lastDate=0;}
      else{
        due=this._simSignedDays(today,c.due||today);
        lastDate=Math.min(0,due-Math.max(0,interval));
      }
      existing.push({id:cid,difficulty:hasMemory?difficulty:null,stability:hasMemory?stability:null,ease_factor:easeFactor,last_date:lastDate,due,interval,lapses:Math.max(0,Math.round(Number(c.lapses)||0))});
    });
    const revlogs=[],firstReviewDateByCard=new Map();
    this.statsRevlog(false).forEach((r,i)=>{
      const cid=cardKey.get(String(r.cardId==null?r.ankiCardId:r.cardId));if(cid==null)return;
      let id=Math.round(Number(r.ts)||Date.parse(String(r.date||'')+'T12:00:00')||Date.now());
      id+=i%1000;
      const iv=Math.round(Number(r.ankiInterval!=null?r.ankiInterval:(r.interval!=null?r.interval:r.intervalo))||0),
        lastIv=Math.round(Number(r.ankiLastInterval!=null?r.ankiLastInterval:(r.lastInterval!=null?r.lastInterval:(r.last_interval!=null?r.last_interval:r.intervalo)))||0),
        efRaw=Number(r.easeFactor!=null?r.easeFactor:r.ease),
        ef=Math.max(0,Math.round((Number.isFinite(efRaw)&&efRaw>0?efRaw:2.5)*(efRaw>100?1:1000))),
        taken=Math.max(0,Math.round(Number(r.time!=null?r.time:r.takenMillis)||0));
      revlogs.push({id,cid,button_chosen:Math.max(1,Math.min(4,Math.round(Number(r.grade)||1))),interval:iv,last_interval:lastIv,ease_factor:ef,taken_millis:taken,review_kind:this._simReviewKind(r)});
      const d=String(r.date||new Date(Number(r.ts)||0).toISOString().slice(0,10)).slice(0,10),k=String(r.cardId==null?r.ankiCardId:r.cardId);
      if(d&&(!firstReviewDateByCard.has(k)||d<firstReviewDateByCard.get(k)))firstReviewDateByCard.set(k,d);
    });
    const introducedToday=scoped.filter(c=>{
      const explicit=String(c.firstReviewAt||'').slice(0,10);
      const inferred=firstReviewDateByCard.get(String(c.id))||firstReviewDateByCard.get(String(c.ankiId||''));
      return (explicit||inferred||'')===today;
    }).length;
    const mod=await FSRS._loadOfficialOptimizer();
    if(typeof mod.simulate_json!=='function')throw new Error('Simulador fsrs-rs 6.6.2 oficial indisponível');
    const raw=mod.simulate_json(JSON.stringify({
      revlogs,next_day_at:this._simNextDayAtSec(cfg),params,desired_retention:retention,
      historical_retention:Math.max(.5,Math.min(.99,Number(cfg.historicalRetention)||.9)),days_to_simulate:days,
      new_card_count:newCards.length+additionalNew,introduced_today_count:introducedToday,
      new_limit:newLimit,review_limit:reviewLimit,max_interval:maxInterval,
      new_cards_ignore_review_limit:!!cfg.newCardsIgnoreReviewLimit,
      suspend_after_lapses:cfg.leechAction==='suspend'?Math.max(1,Math.round(Number(cfg.leechThreshold)||8)):null,
      learning_step_count:Array.isArray(cfg.learnSteps)?cfg.learnSteps.length:0,
      relearning_step_count:Array.isArray(cfg.relearnSteps)?cfg.relearnSteps.length:0,
      review_order:String(cfg.reviewOrder||'day'),
      load_balance:cfg.loadBalance!==false,
      easy_days:(()=>{const a=Array.isArray(cfg.easyDays)&&cfg.easyDays.length===7?cfg.easyDays:[1,1,1,1,1,1,1];return [a[1],a[2],a[3],a[4],a[5],a[6],a[0]].map(x=>x===0?0:(x===1?1:.5));})(),
      next_day_weekday_monday:(()=>{const d=new Date(this._simNextDayAtSec(cfg)*1000);return (d.getDay()+6)%7;})(),
      cards:existing
    }));
    const out=JSON.parse(raw);
    return {days,retention,reviews:out.reviews||[],news:out.news||[],time:out.time||[],memorized:out.memorized||[],
      correct:out.correct||[],introducedByDay:out.introduced||[],introduced:(out.introduced||[]).at(-1)||0,
      sample:scoped.length,scale:1,additionalNew,newLimit,reviewLimit,maxInterval,engine:'fsrs-rs '+String(out.fsrs_rs_version||'6.6.2')};
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
    out.innerHTML='<p class="hint">Simulando no fsrs-rs 6.6.2 oficial…</p>';
    try{
      const sim=await this.simulateOfficial(days,r,opts),total=sim.reviews.reduce((a,b)=>a+b,0)+sim.news.reduce((a,b)=>a+b,0),secs=sim.time.reduce((a,b)=>a+b,0);
      out.innerHTML='<div class="stat-kpis"><div class="stat-kpi"><div class="stat-kpi-v">'+Math.round(total/days)+'</div><div class="stat-kpi-l">respostas/dia</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+(secs/60/days).toFixed(1)+'m</div><div class="stat-kpi-l">tempo/dia</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+Math.round(sim.memorized.at(-1)||0)+'</div><div class="stat-kpi-l">memorizados ao final</div></div></div><h3>Carga projetada</h3>'+this._simBars(sim.reviews.map((x,i)=>x+sim.news[i]))+'<p class="hint">Motor oficial '+sim.engine+' sobre '+sim.sample+' card(s) ativos, sem amostragem/escalonamento. Usa os estados S/D, histórico, limites e parâmetros atuais.</p>';
      return sim;
    }catch(e){console.error(e);out.innerHTML='<p class="hint tone-bad">Falha ao executar o simulador oficial: '+AnkiProductParity.esc(e&&e.message||e)+'</p>';throw e;}
  },
  async runHelpMeDecide(){
    const out=document.getElementById('anki-sim-result');if(!out)return;
    const days=Number(document.getElementById('anki-sim-days').value)||365,
      opts={additionalNew:Number(document.getElementById('anki-sim-additional').value)||0,newLimit:Number(document.getElementById('anki-sim-new-limit').value)||0,reviewLimit:Number(document.getElementById('anki-sim-review-limit').value)||0,maxInterval:Number(document.getElementById('anki-sim-max-interval').value)||36500,approximate:false},
      curve=[];out.innerHTML='<p class="hint">Calculando 70%–99% sobre a coleção completa…</p>';
    for(let p=70;p<=99;p++){
      const sim=await this.simulateOfficial(days,p/100,opts),total=sim.reviews.reduce((a,b)=>a+b,0)+sim.news.reduce((a,b)=>a+b,0),secs=sim.time.reduce((a,b)=>a+b,0);
      curve.push({retention:p,reviews:total/days,minutes:secs/60/days,memorized:sim.memorized.at(-1)||0});
      if(p%3===0)await new Promise(r=>setTimeout(r,0));
    }
    out.innerHTML='<h3>Help Me Decide</h3><p class="hint">Como no Anki experimental: compare a carga prevista em diferentes retenções. Clique numa linha para levar o valor ao simulador.</p><div class="anki-p10-table-wrap"><table class="anki-p10-table"><thead><tr><th>Retenção</th><th>Respostas/dia</th><th>Min/dia</th><th>Memorizados</th></tr></thead><tbody>'+curve.map(x=>'<tr data-sim-ret="'+x.retention+'" tabindex="0"><td>'+x.retention+'%</td><td>'+Math.round(x.reviews)+'</td><td>'+x.minutes.toFixed(1)+'</td><td>'+Math.round(x.memorized)+'</td></tr>').join('')+'</tbody></table></div>';
    out.querySelectorAll('[data-sim-ret]').forEach(row=>row.onclick=()=>{document.getElementById('anki-sim-retention').value=row.dataset.simRet;void this.runSimulator();});
    return curve;
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
    const body=document.getElementById('anki-check-body');if(!body)return;const s=this.structuralIssues(),wrap=document.createElement('div');wrap.id='anki-check-extended';wrap.innerHTML='<p class="hint">Verificando inventário de mídia…</p>';body.appendChild(wrap);
    const m=await this.scanMedia();if(!document.getElementById('anki-check-extended'))return;
    wrap.innerHTML='<h3 class="anki-section-title">Verificação ampliada</h3><div class="anki-check-grid">'+
      [['Notas sem cards',s.orphanNotes.length],['Ordinais de template inválidos',s.badOrd.length],['Filtered cards sem home deck',s.badFiltered.length],['Note Types inválidos',s.badTypes.length],['IDs Anki de card duplicados',s.duplicateCardIds.length],['Mídias armazenadas',m.active.length],['Referências ausentes',m.missing.length],['Mídias não utilizadas',m.unused.length],['Duplicatas de mídia',m.duplicates.length],['Lixeira de mídia',m.trash.length]].map(r=>'<div><span>'+AnkiProductParity.esc(r[0])+'</span><strong>'+r[1]+'</strong></div>').join('')+'</div>'+
      (m.missing.length?'<details><summary>Mídia ausente</summary><div class="anki-check-details">'+m.missing.slice(0,80).map(x=>'<div>'+AnkiProductParity.esc(x.where)+' → <code>'+AnkiProductParity.esc(x.ref)+'</code></div>').join('')+'</div></details>':'')+
      '<div class="anki-media-actions"><button class="btn-secondary" id="anki-media-tag-missing" '+(!m.noteMissing.size?'disabled':'')+'>🏷 Etiquetar notas com mídia ausente</button><button class="btn-secondary" id="anki-media-trash-unused" '+(!m.unused.length?'disabled':'')+'>🗑 Mover não utilizadas para lixeira</button><button class="btn-secondary" id="anki-media-restore" '+(!m.trash.length?'disabled':'')+'>↺ Restaurar lixeira</button><button class="btn-danger" id="anki-media-empty-trash" '+(!m.trash.length?'disabled':'')+'>Esvaziar lixeira</button></div>';
    const tag=document.getElementById('anki-media-tag-missing');if(tag)tag.onclick=()=>this.tagMissing(m);
    const tr=document.getElementById('anki-media-trash-unused');if(tr)tr.onclick=()=>this.trashUnused(m);
    const rr=document.getElementById('anki-media-restore');if(rr)rr.onclick=async()=>{const n=await AnkiMediaStore.restoreAll();showToast(n+' mídia(s) restaurada(s)');AnkiProductParity.renderCheck();};
    const et=document.getElementById('anki-media-empty-trash');if(et)et.onclick=()=>UI.confirm('Excluir permanentemente as mídias da lixeira?',{title:'Esvaziar lixeira de mídia',okText:'Excluir',danger:true}).then(async ok=>{if(!ok)return;const n=await AnkiMediaStore.emptyTrash();showToast(n+' mídia(s) removida(s)');AnkiProductParity.renderCheck();});
  },
  tagMissing(scan){
    let n=0;scan.noteMissing.forEach((refs,id)=>{const note=AnkiParity.getNote(id);if(!note)return;const tags=[...(note.tags||[])];if(!tags.some(t=>String(t).toLowerCase()==='missing-media'))tags.push('missing-media');AnkiParity.saveNote(Object.assign({},note,{tags}));n++;});showToast(n+' nota(s) etiquetada(s) com missing-media');AnkiProductParity.renderCheck();
  },
  async trashUnused(scan){for(const m of scan.unused)await AnkiMediaStore.trash(m.name);showToast(scan.unused.length+' mídia(s) movida(s) para a lixeira');AnkiProductParity.renderCheck();},
  repairAdvanced(){
    const s=this.structuralIssues();let n=0;
    s.badOrd.forEach(id=>{DB.updateCard(id,{ankiTemplateOrd:0});n++;});
    s.badFiltered.forEach(id=>{const c=DB.getCard(id);if(!c)return;DB.updateCard(id,{originalDeckId:null,originalDue:null,originalDueTs:null,originalPhase:null,filteredDeckId:null,filteredPosition:null,filteredReschedule:null});n++;});
    const seen=new Set();for(const note of AnkiParity.notes()){let g=String(note.guid||'');if(!g||seen.has(g)){g='snm-'+Number(AnkiParity._allocId()).toString(36);AnkiParity.saveNote(Object.assign({},note,{guid:g}));n++;}seen.add(g);}
    CardEngine.invalidateDueCache();AnkiProductParity.renderCheck();CardsScreen.render();showToast(n?n+' reparo(s) avançado(s) aplicado(s) ✓':'Nada adicional para reparar');
  }
};
queueMicrotask(()=>AnkiMaxStatsMedia.install());
