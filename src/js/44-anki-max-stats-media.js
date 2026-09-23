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
    const m=new Map(),today=todayCards();for(let i=days-1;i>=0;i--)m.set(CardEngine.addDays(today,-i),{count:0,time:0,learning:0,review:0,relearning:0,filtered:0,good:0,total:0});
    for(const r of DB.getRevlog()){const d=this._revDate(r),x=m.get(d);if(!x)continue;x.count++;x.time+=Math.max(0,Number(r.time)||0);const ph=String(r.phase||'review');if(ph==='learning')x.learning++;else if(ph==='relearning')x.relearning++;else if(Number(r.ankiReviewKind)===3)x.filtered++;else x.review++;if(Number(r.grade)>=2)x.good++;x.total++;}
    return m;
  },
  _calendarHtml(){
    const m=this._dayMap(365),vals=[...m.entries()],max=Math.max(1,...vals.map(x=>x[1].count));
    return '<div class="card stat-card anki-max-calendar"><div class="card-header"><div><h2>🗓 Calendário</h2><p class="sub">Atividade de revisão nos últimos 365 dias</p></div></div><div class="anki-calendar-grid">'+vals.map(([d,x])=>{const lvl=x.count?Math.max(1,Math.ceil(x.count/max*4)):0;return '<span class="anki-cal-day l'+lvl+'" title="'+d+': '+x.count+' revisão(ões)"></span>';}).join('')+'</div></div>';
  },
  _hourlyHtml(){
    const h=Array.from({length:24},()=>({n:0,ok:0,time:0}));for(const r of DB.getRevlog()){const ts=Number(r.ts)||0;if(!ts)continue;const d=new Date(ts),x=h[d.getHours()];x.n++;x.time+=Number(r.time)||0;if(Number(r.grade)>=2)x.ok++;}
    const max=Math.max(1,...h.map(x=>x.n));
    return '<div class="card stat-card"><div class="card-header"><div><h2>🕒 Distribuição por hora</h2><p class="sub">Quantidade e retenção por horário das revisões registradas</p></div></div><div class="anki-hourly">'+h.map((x,i)=>'<div class="anki-hour" title="'+i+'h · '+x.n+' revisões · '+(x.n?Math.round(x.ok/x.n*100):0)+'% acerto"><div class="anki-hour-fill" style="height:'+Math.max(x.n?4:0,Math.round(x.n/max*100))+'%"></div><span>'+String(i).padStart(2,'0')+'</span></div>').join('')+'</div></div>';
  },
  _reviewsHtml(){
    const m=this._dayMap(30),xs=[...m.entries()],max=Math.max(1,...xs.map(x=>x[1].count));
    return '<div class="card stat-card"><div class="card-header"><div><h2>📚 Revisões</h2><p class="sub">30 dias · learning, review, relearning e filtradas</p></div></div><div class="anki-review-bars">'+xs.map(([d,x])=>{const H=Math.round(x.count/max*100),part=k=>x.count?Math.round(x[k]/x.count*H):0;return '<div class="anki-review-day" title="'+d+' · '+x.count+'"><div class="anki-stack"><i class="learn" style="height:'+part('learning')+'%"></i><i class="review" style="height:'+part('review')+'%"></i><i class="relearn" style="height:'+part('relearning')+'%"></i><i class="filtered" style="height:'+part('filtered')+'%"></i></div></div>';}).join('')+'</div><div class="anki-stat-legend"><span>Aprendendo</span><span>Revisão</span><span>Reaprendendo</span><span>Filtrado</span></div></div>';
  },
  _futureHtml(){
    const cards=DB.getCards().filter(c=>!c.suspenso&&(c.phase||'new')!=='new'&&!c.dueTs),today=todayCards(),weeks=Array.from({length:13},()=>0),backlog=cards.filter(c=>String(c.due||today)<today).length;
    cards.forEach(c=>{const n=CardEngine._daysBetween(today,c.due||today);if(String(c.due||today)<today)return;const w=Math.floor(n/7);if(w>=0&&w<weeks.length)weeks[w]++;});
    const max=Math.max(1,...weeks);
    return '<div class="card stat-card"><div class="card-header"><div><h2>📅 Vencimentos futuros</h2><p class="sub">Próximos 90 dias por semana'+(backlog?' · '+backlog+' atrasado(s)':'')+'</p></div></div><div class="anki-future-bars">'+weeks.map((n,i)=>'<div title="Semana '+(i+1)+': '+n+'"><i style="height:'+Math.max(n?4:0,Math.round(n/max*100))+'%"></i><span>'+(i+1)+'</span></div>').join('')+'</div></div>';
  },
  _memoryHtml(){
    const cards=DB.getCards().filter(c=>Number.isFinite(Number(c.s))&&Number(c.s)>0),rBins=[0,0,0,0,0],iBins=[0,0,0,0,0,0],today=todayCards();
    cards.forEach(c=>{const R=CardEngine.retrievabilityDe(c,today,CardsConfig.weightsFor(c.originalDeckId||c.deckId)),ri=Math.min(4,Math.max(0,Math.floor(R*5)));rBins[ri]++;const iv=Number(c.intervalo)||0,ii=iv<1?0:iv<7?1:iv<30?2:iv<90?3:iv<365?4:5;iBins[ii]++;});
    const bars=(arr,labels)=>{const mx=Math.max(1,...arr);return '<div class="anki-mini-hist">'+arr.map((n,i)=>'<div title="'+labels[i]+': '+n+'"><i style="height:'+Math.max(n?3:0,Math.round(n/mx*100))+'%"></i><span>'+labels[i]+'</span></div>').join('')+'</div>';};
    return '<div class="stat-grid anki-memory-grid"><div class="card stat-card"><div class="card-header"><div><h2>🧠 Recuperabilidade</h2><p class="sub">'+cards.length+' cards FSRS</p></div></div>'+bars(rBins,['0–20','20–40','40–60','60–80','80–100'])+'</div><div class="card stat-card"><div class="card-header"><div><h2>↔ Intervalos</h2></div></div>'+bars(iBins,['<1d','1–7','7–30','30–90','90–365','>1a'])+'</div></div>';
  },
  statsHtml(){
    return '<div class="anki-max-stats">'+this._calendarHtml()+'<div class="stat-grid">'+this._reviewsHtml()+this._hourlyHtml()+'</div><div class="stat-grid">'+this._futureHtml()+'<div class="card stat-card anki-sim-card"><div class="card-header"><div><h2>🧪 Simulador FSRS</h2><p class="sub">Projeta carga usando os estados S/D reais, parâmetros e retenção desejada.</p></div></div><button type="button" class="btn-primary" id="anki-open-simulator">Abrir simulador</button></div></div>'+this._memoryHtml()+'</div>';
  },
  _bindStatsUi(){const b=document.getElementById('anki-open-simulator');if(b)b.onclick=()=>this.openSimulator();},

  _ratingModel(){
    const logs=DB.getRevlog().filter(r=>Number(r.grade)>=1&&Number(r.grade)<=4),first=[.1,.12,.68,.1],review=[.08,.1,.72,.1],cost=[8,8,8,8];
    const calc=(sub,fallback)=>{if(sub.length<20)return fallback;const n=[0,0,0,0];sub.forEach(r=>n[Number(r.grade)-1]++);return n.map(x=>x/sub.length);};
    const reviewLogs=logs.filter(r=>String(r.phase||'review')==='review'),firstLogs=logs.filter(r=>String(r.phase||'')==='learning');
    for(let g=1;g<=4;g++){const xs=logs.filter(r=>Number(r.grade)===g&&Number(r.time)>0);if(xs.length)cost[g-1]=xs.reduce((a,r)=>a+Number(r.time),0)/xs.length/1000;}
    return {first:calc(firstLogs,first),review:calc(reviewLogs,review),cost};
  },
  _rnd(seed){let x=FSRS._hash(String(seed))>>>0;x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;},
  _pick(probs,u){let a=0;for(let i=0;i<probs.length;i++){a+=probs[i];if(u<a)return i+1;}return 3;},
  _sampleCards(max=1500){const all=DB.getCards().filter(c=>!c.suspenso);if(all.length<=max)return all.map(c=>structuredClone(c));const step=all.length/max,out=[];for(let i=0;i<max;i++)out.push(structuredClone(all[Math.floor(i*step)]));return out;},
  simulate(days,retention,opts){
    opts=opts||{};days=Math.max(1,Math.min(3650,Math.round(Number(days)||365)));retention=Math.max(.7,Math.min(.99,Number(retention)||.9));
    const live=DB.getCards().filter(c=>!c.suspenso),allCount=live.length,sample=this._sampleCards(opts.sample||1500);
    const scale=allCount&&sample.length?allCount/sample.length:1,model=this._ratingModel(),today=todayCards(),
      w=CardsConfig.get().weights&&FSRS.pesosValidos(CardsConfig.get().weights)?CardsConfig.get().weights:FSRS.DEFAULT_W,
      maxIvl=Math.max(1,Math.round(opts.maxInterval==null?(Number(CardsConfig.get().maxInterval)||36500):Number(opts.maxInterval)||36500));
    const newLimit=Math.max(0,Math.round(opts.newLimit==null?CardsConfig.get().newPerDay:Number(opts.newLimit))),
      reviewLimit=Math.max(0,Math.round(opts.reviewLimit==null?CardsConfig.get().revPerDay:Number(opts.reviewLimit))),
      additionalNew=Math.max(0,Math.round(Number(opts.additionalNew)||0));
    let pendingNew=sample.filter(c=>(c.phase||'new')==='new'),
      active=sample.filter(c=>(c.phase||'new')!=='new').map(c=>({id:c.id,s:Number(c.s)||Math.max(1,Number(c.intervalo)||1),d:Number(c.d)||5,last:-(Math.max(0,Number(c.intervalo)||1)),due:Math.max(0,String(c.due||today)<today?0:CardEngine._daysBetween(today,c.due||today)),lapses:Number(c.lapses)||0}));
    const synthetic=Math.ceil(additionalNew/Math.max(1,scale));
    for(let i=0;i<synthetic;i++)pendingNew.push({id:'__sim_new_'+i,phase:'new'});
    const reviews=[],news=[],time=[],memorized=[];let introduced=0;
    for(let day=0;day<days;day++){
      const add=Math.min(pendingNew.length,Math.ceil(newLimit/Math.max(1,scale))),todayNew=pendingNew.splice(0,add);let nNew=0,nRev=0,sec=0;
      for(const c of todayNew){const G=this._pick(model.first,this._rnd('n:'+c.id+':'+day)),s=FSRS.initS(G,w),d=FSRS.initD(G,w),iv=Math.max(1,Math.min(maxIvl,FSRS.interval(s,retention,w)));active.push({id:c.id,s,d,last:day,due:day+iv,lapses:0});nNew++;sec+=model.cost[G-1]*Math.max(1,(CardsConfig.get().learnSteps||[]).length||1);introduced++;}
      const due=active.filter(c=>c.due<=day).sort((a,b)=>a.due-b.due).slice(0,Math.ceil(reviewLimit/Math.max(1,scale)));
      for(const c of due){
        const elapsed=Math.max(0,day-c.last),R=FSRS.R(elapsed,c.s,w),forgot=this._rnd('r:'+c.id+':'+day+':'+c.lapses)>R;let G;
        if(forgot)G=1;else{const ok=model.review.slice();ok[0]=0;const z=ok.reduce((a,b)=>a+b,0)||1;G=this._pick(ok.map(x=>x/z),this._rnd('g:'+c.id+':'+day));if(G===1)G=3;}
        const oldS=c.s;c.s=G===1?FSRS.nextS_forget(c.d,oldS,R,w):FSRS.nextS_recall(c.d,oldS,R,G,w);c.d=FSRS.nextD(c.d,G===1?1:G,w);c.last=day;if(G===1)c.lapses++;
        const iv=Math.max(1,Math.min(maxIvl,FSRS.interval(c.s,retention,w)));c.due=day+iv;nRev++;sec+=model.cost[G-1]*(G===1?Math.max(1,(CardsConfig.get().relearnSteps||[]).length+1):1);
      }
      reviews.push(Math.round(nRev*scale));news.push(Math.round(nNew*scale));time.push(sec*scale);
      let mem=0;for(const c of active)mem+=FSRS.R(Math.max(0,day-c.last),c.s,w);memorized.push(mem*scale);
    }
    return {days,retention,reviews,news,time,memorized,introduced:Math.round(introduced*scale),sample:sample.length,scale,additionalNew,newLimit,reviewLimit,maxInterval:maxIvl};
  },

  _injectSimulator(){
    if(document.getElementById('anki-fsrs-simulator'))return;const cfg=CardsConfig.get(),d=document.createElement('div');d.innerHTML='<div id="anki-fsrs-simulator" class="cards-modal anki-product-modal" style="display:none"><div class="cards-modal-box cards-modal-lg"><div class="cards-modal-head"><div><h2>🧪 Simulador FSRS</h2><p class="sub">Estimativa de carga com os mesmos controles documentados no Anki atual.</p></div><button class="icon-btn" id="anki-sim-close">✕</button></div><div class="cards-modal-body">'+
      '<div class="field-group"><div class="field"><label>Dias a simular</label><input id="anki-sim-days" type="number" min="1" max="3650" value="365"></div><div class="field"><label>Retenção desejada (%)</label><input id="anki-sim-retention" type="number" min="70" max="99" value="'+Math.round((cfg.retention||.9)*100)+'"></div></div>'+
      '<div class="field-group"><div class="field"><label>Cards novos adicionais</label><input id="anki-sim-additional" type="number" min="0" max="1000000" value="0"></div><div class="field"><label>Novos por dia</label><input id="anki-sim-new-limit" type="number" min="0" max="999999" value="'+Math.max(0,Number(cfg.newPerDay)||0)+'"></div></div>'+
      '<div class="field-group"><div class="field"><label>Máximo de revisões/dia</label><input id="anki-sim-review-limit" type="number" min="0" max="999999" value="'+Math.max(0,Number(cfg.revPerDay)||0)+'"></div><div class="field"><label>Intervalo máximo (dias)</label><input id="anki-sim-max-interval" type="number" min="1" max="36500" value="'+Math.max(1,Number(cfg.maxInterval)||36500)+'"></div></div>'+
      '<div class="anki-sim-actions"><button class="btn-primary" id="anki-sim-run">Simular</button></div><div id="anki-sim-result"></div></div></div></div>';document.body.appendChild(d);
    document.getElementById('anki-sim-close').onclick=()=>document.getElementById('anki-fsrs-simulator').style.display='none';document.getElementById('anki-sim-run').onclick=()=>this.runSimulator();
  },
  openSimulator(){document.getElementById('anki-fsrs-simulator').style.display='flex';},
  _simBars(arr,maxBars=90){
    const group=Math.max(1,Math.ceil(arr.length/maxBars)),xs=[];for(let i=0;i<arr.length;i+=group)xs.push(arr.slice(i,i+group).reduce((a,b)=>a+b,0)/Math.min(group,arr.length-i));const mx=Math.max(1,...xs);return '<div class="anki-sim-bars">'+xs.map((n,i)=>'<i style="height:'+Math.max(n?3:0,Math.round(n/mx*100))+'%" title="Período '+(i+1)+': '+Math.round(n)+'"></i>').join('')+'</div>';
  },
  runSimulator(){
    const days=Number(document.getElementById('anki-sim-days').value)||365,r=(Number(document.getElementById('anki-sim-retention').value)||90)/100,
      opts={additionalNew:Number(document.getElementById('anki-sim-additional').value)||0,newLimit:Number(document.getElementById('anki-sim-new-limit').value)||0,reviewLimit:Number(document.getElementById('anki-sim-review-limit').value)||0,maxInterval:Number(document.getElementById('anki-sim-max-interval').value)||36500},
      sim=this.simulate(days,r,opts),total=sim.reviews.reduce((a,b)=>a+b,0)+sim.news.reduce((a,b)=>a+b,0),secs=sim.time.reduce((a,b)=>a+b,0);
    document.getElementById('anki-sim-result').innerHTML='<div class="stat-kpis"><div class="stat-kpi"><div class="stat-kpi-v">'+Math.round(total/days)+'</div><div class="stat-kpi-l">respostas/dia</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+(secs/60/days).toFixed(1)+'m</div><div class="stat-kpi-l">tempo/dia</div></div><div class="stat-kpi"><div class="stat-kpi-v">'+Math.round(sim.memorized.at(-1)||0)+'</div><div class="stat-kpi-l">memorizados ao final</div></div></div><h3>Carga projetada</h3>'+this._simBars(sim.reviews.map((x,i)=>x+sim.news[i]))+'<p class="hint">Usa estados reais de dificuldade/estabilidade, parâmetros FSRS, retenção desejada, novos/dia, revisões/dia, intervalo máximo e cards adicionais. A projeção usa amostragem determinística de '+sim.sample+' card(s) quando a coleção é grande.</p>';
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
    const cards=DB.getCards(),notes=AnkiParity.notes(),types=AnkiParity.noteTypes(),deckIds=new Set(DB.getDecks().map(d=>String(d.id))),cardAnki=new Map(),orphanNotes=[],badOrd=[],badFiltered=[],badTypes=[];
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
