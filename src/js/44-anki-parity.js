/* ============================================================
   ANKI 26.09.2 — CAMADA DE PARIDADE DOS CARDS
   Implementação independente dos contratos observáveis do Anki 26.09.2.
   ============================================================ */
const AnkiParity = {
  VERSION: 'anki-26.09.2',
  _idKey() { try { return DB._profilePrefix() + 'cards-anki-last-id'; } catch (_) { return 'diario-estudos:cards-anki-last-id'; } },
  _allocId() {
    let last = 0;
    try { last = Number(localStorage.getItem(this._idKey())) || 0; } catch (_) {}
    const id = Math.max(Date.now(), last + 1);
    try { localStorage.setItem(this._idKey(), String(id)); } catch (_) {}
    return id;
  },
  _validId(v) { const n=Number(v); return Number.isSafeInteger(n)&&n>0?n:null; },
  cardId(card) { return card ? (this._validId(card.ankiId)||this._validId(card.id)||0) : 0; },
  noteId(card) { return card ? (this._validId(card.ankiNoteId)||this.cardId(card)) : 0; },
  mod(card) {
    const m=this._validId(card&&card.ankiMod); if(m)return m;
    const ms=Date.parse(card&&card.updatedAt||card&&card.createdAt||'');
    return Number.isFinite(ms)?Math.floor(ms/1000):0;
  },
  fuzzSeed(card, forReschedule) {
    let reps=Math.max(0,Number(card&&card.reps)||0);
    if(forReschedule) reps=Math.max(0,reps-1);
    return BigInt.asUintN(64,BigInt(this.cardId(card))+BigInt(reps));
  },
  ensureIdentities() {
    try {
      const cards=DB.getCards(),decks=DB.getDecks(),noteMap=new Map();
      let tc=false,td=false;
      cards.forEach(c=>{const k=String(c.noteId||c.id||''),n=this._validId(c.ankiNoteId);if(k&&n&&!noteMap.has(k))noteMap.set(k,n);});
      cards.forEach(c=>{
        if(!this._validId(c.ankiId)){c.ankiId=this._allocId();tc=true;}
        const k=String(c.noteId||c.id||'');let n=this._validId(c.ankiNoteId)||noteMap.get(k);
        if(!n){n=this._allocId();noteMap.set(k,n);}
        if(c.ankiNoteId!==n){c.ankiNoteId=n;tc=true;}
        if(!this._validId(c.ankiMod)){c.ankiMod=this.mod(c)||Math.floor(Date.now()/1000);tc=true;}
      });
      decks.forEach(d=>{
        if(!this._validId(d.ankiId)){d.ankiId=this._allocId();td=true;}
        if(!d.configId){d.configId=(CardsConfig.hasDeckPreset&&CardsConfig.hasDeckPreset(d.id))?'legacy:'+d.id:'default';td=true;}
      });
      if(tc)DB.saveCards(cards); if(td)DB.saveDecks(decks);
      return {cards:tc,decks:td};
    } catch(e){_quiet(e,'anki-identities');return {cards:false,decks:false};}
  },

  // IEEE-754 f32 helpers: WeightedIndex no rand 0.9.4 calcula em f32.
  _f32buf:new Float32Array(1),
  f32(x){this._f32buf[0]=Number(x);return this._f32buf[0];},
  _f32ToBits(x){const b=new ArrayBuffer(4),f=new Float32Array(b),u=new Uint32Array(b);f[0]=this.f32(x);return u[0]>>>0;},
  _f32FromBits(x){const b=new ArrayBuffer(4),f=new Float32Array(b),u=new Uint32Array(b);u[0]=Number(x)>>>0;return f[0];},
  _f32NextDown(x){return this._f32FromBits((this._f32ToBits(x)-1)>>>0);},

  // StdRng do rand 0.9.4: seed_from_u64 (PCG32) + ChaCha12.
  _pcg32(state){
    const s=BigInt.asUintN(64,BigInt(state)*6364136223846793005n+11634580027462260723n);
    const x=Number(BigInt.asUintN(32,((s>>18n)^s)>>27n))>>>0,rot=Number((s>>59n)&31n);
    return [s,((x>>>rot)|(x<<((32-rot)&31)))>>>0];
  },
  _seed32(seed){
    let st=BigInt.asUintN(64,BigInt(seed)),out=new Uint8Array(32);
    for(let i=0;i<8;i++){const r=this._pcg32(st);st=r[0];const v=r[1];out[i*4]=v&255;out[i*4+1]=(v>>>8)&255;out[i*4+2]=(v>>>16)&255;out[i*4+3]=(v>>>24)&255;}
    return out;
  },
  _rotl32(v,n){return ((v<<n)|(v>>>(32-n)))>>>0;},
  _qr(s,a,b,c,d){
    s[a]=(s[a]+s[b])>>>0;s[d]=this._rotl32((s[d]^s[a])>>>0,16);
    s[c]=(s[c]+s[d])>>>0;s[b]=this._rotl32((s[b]^s[c])>>>0,12);
    s[a]=(s[a]+s[b])>>>0;s[d]=this._rotl32((s[d]^s[a])>>>0,8);
    s[c]=(s[c]+s[d])>>>0;s[b]=this._rotl32((s[b]^s[c])>>>0,7);
  },
  _u32le(a,o){return (a[o]|(a[o+1]<<8)|(a[o+2]<<16)|(a[o+3]<<24))>>>0;},
  _chachaBlock(key,counter){
    const s=[0x61707865,0x3320646e,0x79622d32,0x6b206574,
      this._u32le(key,0),this._u32le(key,4),this._u32le(key,8),this._u32le(key,12),
      this._u32le(key,16),this._u32le(key,20),this._u32le(key,24),this._u32le(key,28),
      counter>>>0,0,0,0],w=s.slice();
    for(let i=0;i<6;i++){
      this._qr(w,0,4,8,12);this._qr(w,1,5,9,13);this._qr(w,2,6,10,14);this._qr(w,3,7,11,15);
      this._qr(w,0,5,10,15);this._qr(w,1,6,11,12);this._qr(w,2,7,8,13);this._qr(w,3,4,9,14);
    }
    return w.map((v,i)=>(v+s[i])>>>0);
  },
  rng(seed){
    const self=this,key=this._seed32(seed);let counter=0,buf=[],idx=16;
    return {nextU32(){if(idx>=buf.length){buf=self._chachaBlock(key,counter++);idx=0;}return buf[idx++]>>>0;}};
  },
  randomRangeU32(rng,lo,hi){
    lo=Number(lo)>>>0;hi=Number(hi)>>>0;if(!(hi>lo))throw new Error('empty u32 range');
    const size=(hi-lo)>>>0,mul=(a,b)=>{const p=BigInt(a>>>0)*BigInt(b>>>0);return [Number((p>>32n)&0xffffffffn)>>>0,Number(p&0xffffffffn)>>>0];};
    let m=mul(rng.nextU32(),size),result=m[0],low=m[1];const neg=(-size)>>>0;
    if(low>neg){const m2=mul(rng.nextU32(),size);if(BigInt(low)+BigInt(m2[0])>0xffffffffn)result=(result+1)>>>0;}
    return (lo+result)>>>0;
  },
  _uniformScale(low,high,scale){
    let s=this.f32(scale),max=this.f32(1-Math.pow(2,-23));
    while(this.f32(this.f32(s*max)+low)>high)s=this._f32NextDown(s);
    return s;
  },
  uniformF32(rng,low,high){
    low=this.f32(low);high=this.f32(high);const scale=this._uniformScale(low,high,this.f32(high-low));
    const u=rng.nextU32(),oneTwo=this._f32FromBits(((u>>>9)|(127<<23))>>>0),zeroOne=this.f32(oneTwo-1);
    return this.f32(this.f32(zeroOne*scale)+low);
  },
  weightedIndex(weights,seed){
    if(!weights||!weights.length)return null;const w=weights.map(x=>this.f32(x));let total=w[0],cum=[];
    for(let i=1;i<w.length;i++){cum.push(total);total=this.f32(total+w[i]);}
    if(!(total>0))return null;const chosen=this.uniformF32(this.rng(seed),0,total);let idx=0;
    while(idx<cum.length&&cum[idx]<=chosen)idx++;return idx;
  },
  fuzzFactor(seed){return this.uniformF32(this.rng(seed),0,1);},
  learningFuzzSeconds(card,seconds){
    const s=Math.max(0,Math.round(Number(seconds)||0)),max=Math.floor(Math.min(s*0.25,300));
    if(max<=0)return s;
    return s+this.randomRangeU32(this.rng(this.fuzzSeed(card)),0,max);
  },

  // SQLite fnvhash(id, mod): FNV-1a de i64 little-endian.
  fnvHashI64(){
    let h=0xcbf29ce484222325n;
    for(let i=0;i<arguments.length;i++){
      const x=BigInt.asUintN(64,BigInt(arguments[i]||0));
      for(let b=0;b<8;b++){h^=(x>>(BigInt(b)*8n))&255n;h=BigInt.asUintN(64,h*0x100000001b3n);}
    }
    return h;
  },
  reviewTie(card){return BigInt.asIntN(64,this.fnvHashI64(this.cardId(card),this.mod(card)));},

  configIdForDeck(deckId){
    if(deckId==null)return 'default';
    try{const d=DB.getDecks().find(x=>String(x.id)===String(deckId));return d&&d.configId?String(d.configId):((CardsConfig.hasDeckPreset&&CardsConfig.hasDeckPreset(deckId))?'legacy:'+deckId:'default');}
    catch(_){return 'default';}
  },
  cfgForCard(card){return CardsConfig.forDeck(card&&card.deckId);},
  _easyKind(v){const x=Number(v);return x===1?'normal':(x===0?'minimum':'reduced');},
  _easyLoad(k){return k==='normal'?1:(k==='minimum'?0.0001:0.5);},
  _weekdayForInterval(iv){const d=new Date(proximaViradaTs()+(Math.max(1,iv)-1)*86400000);return (d.getDay()+6)%7;},
  _easyModifiers(cfg,intervals,counts){
    const raw=Array.isArray(cfg.easyDays)&&cfg.easyDays.length===7?cfg.easyDays:[1,1,1,1,1,1,1],
      days=[raw[1],raw[2],raw[3],raw[4],raw[5],raw[6],raw[0]].map(x=>this._easyKind(x)),
      wds=intervals.map(d=>this._weekdayForInterval(d)),total=counts.reduce((a,b)=>a+b,0),
      pct=wds.reduce((a,w)=>a+this._easyLoad(days[w]),0);
    return wds.map((wd,i)=>{
      let k=days[wd];
      if(k==='reduced'){const other=total-counts[i],otherPct=pct-.5,normalized=counts[i]/.5,threshold=otherPct>0?other/otherPct:Infinity;k=normalized>threshold?'minimum':'normal';}
      return this._easyLoad(k);
    });
  },
  _siblingModifiers(card,lo,hi){
    const out=Array.from({length:hi-lo+1},()=>1);if(!card||!card.noteId)return out;
    const nid=String(card.noteId),days=new Set(),steps=[-5,-4,-3,-2,-1,0,1,2,3,4,5],mods=[1,.8,.6,.4,.2,.000001,.2,.4,.6,.8,1];
    DB.getCards().forEach(c=>{
      if(String(c.id)===String(card.id)||String(c.noteId||c.id)!==nid||c.dueTs||!c.due)return;
      const d=CardEngine._daysBetween(todayCards(),c.due);if(d>=0&&d<99)days.add(d);
    });
    days.forEach(sd=>steps.forEach((st,i)=>{const at=sd+st-lo;if(at>=0&&at<out.length)out[at]*=mods[i];}));
    return out;
  },
  loadBalance(interval,maxIv,minIv,seed,card){
    const iv=Number(interval),minimum=Math.max(1,Number(minIv)||1),maximum=Math.max(minimum,Number(maxIv)||36500);
    if(iv>90||minimum>90)return null;
    const b=FSRS.constrainedFuzzBounds(iv,minimum,maximum),lo=b[0],hi=b[1],ints=[];for(let d=lo;d<=hi;d++)ints.push(d);
    const preset=this.configIdForDeck(card&&card.deckId);
    const counts=ints.map(d=>{let n=0;DB.getCards().forEach(c=>{
      if(c.suspenso||c.dueTs||!c.due)return;const ph=c.phase||(((c.reps||0)>0&&(c.intervalo||0)>0)?'review':'new');
      if(ph!=='review'||this.configIdForDeck(c.deckId)!==preset)return;if(CardEngine._daysBetween(todayCards(),c.due)===d)n++;
    });return n;});
    const easy=this._easyModifiers(this.cfgForCard(card),ints,counts),sib=this._siblingModifiers(card,lo,hi);
    const weights=ints.map((d,i)=>counts[i]===0?1:Math.pow(1/counts[i],2.15)*Math.pow(1/d,3)*sib[i]*easy[i]);
    const idx=this.weightedIndex(weights,seed);return idx==null?null:ints[idx];
  },

  // Tokenização equivalente nos casos de Cloze do Anki: c1, c1,2, dicas e aninhamento.
  _parseOrdinals(raw){const s=new Set();String(raw||'').split(',').forEach(x=>{const n=Number(x);if(Number.isInteger(n)&&n>=0&&n<=65535)s.add(n);});return [...s].sort((a,b)=>a-b);},
  parseCloze(text){
    text=String(text||'');const root=[],stack=[];let i=0,plain='';
    const activeNodes=()=>stack.length?stack[stack.length-1].nodes:root;
    const flush=()=>{if(plain){activeNodes().push({type:'text',text:plain});plain='';}};
    while(i<text.length){
      if(text.startsWith('{{c',i)){
        const m=/^\{\{c([\d,]+)::/.exec(text.slice(i));
        if(m){const ords=this._parseOrdinals(m[1]);if(ords.length&&stack.length<10){flush();stack.push({type:'cloze',ordinals:ords,nodes:[],hint:null});i+=m[0].length;continue;}}
      }
      if(text.startsWith('}}',i)){
        if(stack.length){
          flush();const done=stack.pop();activeNodes().push(done);i+=2;continue;
        }
        plain+='}}';i+=2;continue;
      }
      if(text.startsWith('::',i)&&stack.length&&stack[stack.length-1].hint==null){
        flush();let j=i+2,h='';
        while(j<text.length&&!text.startsWith('}}',j)&&!text.startsWith('{{c',j))h+=text[j++];
        if(j>i+2){stack[stack.length-1].hint=h;i=j;continue;}
      }
      plain+=text[i++];
    }
    // O Anki descarta aberturas Cloze não fechadas; texto top-level normal fica.
    if(!stack.length)flush();
    return root;
  },
  _clozeText(n){return !n||!n.nodes?'':n.nodes.map(x=>x.type==='text'?x.text:this._clozeText(x)).join('');},
  clozeOrdinals(text){const s=new Set(),walk=nodes=>nodes.forEach(n=>{if(n.type==='cloze'){n.ordinals.forEach(o=>{if(o!==0)s.add(o);});walk(n.nodes);}});walk(this.parseCloze(text));return [...s].sort((a,b)=>a-b);},
  _escAttr(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');},
  revealCloze(text,ord,question){
    let found=false;const renderNodes=nodes=>nodes.map(render).join(''),render=n=>{
      if(n.type==='text')return n.text;const active=n.ordinals.includes(Number(ord));if(active)found=true;const os=n.ordinals.join(',');
      if(question&&active){const inner=renderNodes(n.nodes),hint=n.hint==null?'...':n.hint;return '<span class="cloze" data-cloze="'+this._escAttr(inner)+'" data-ordinal="'+os+'">['+hint+']</span>';}
      return '<span class="'+(active?'cloze':'cloze-inactive')+'" data-ordinal="'+os+'">'+renderNodes(n.nodes)+'</span>';
    };
    const out=renderNodes(this.parseCloze(text));return found?out:'';
  },
  clozeOnly(text,ord,question){
    const out=[],walk=nodes=>nodes.forEach(n=>{if(n.type!=='cloze')return;if(n.ordinals.includes(Number(ord)))out.push(question?(n.hint==null?'...':n.hint):this._clozeText(n));walk(n.nodes);});
    walk(this.parseCloze(text));return out.join(', ');
  },
  syncClozeSiblings(noteCardId){
    const all=DB.getCards(),base=all.find(c=>String(c.id)===String(noteCardId));if(!base||base.kind!=='cloze')return 0;
    const noteId=base.noteId||base.id,sibs=all.filter(c=>String(c.noteId||c.id)===String(noteId)),ords=this.clozeOrdinals(base.frente),existing=new Map();
    sibs.forEach(c=>{const o=Number(c.clozeOrd||((c.template||'').match(/^cloze:(\d+)$/)||[])[1]);if(o)existing.set(o,c);});
    let changed=false;
    if(ords.length&&!existing.size){base.clozeOrd=ords[0];base.template='cloze:'+ords[0];existing.set(ords[0],base);changed=true;}
    ords.forEach(o=>{
      if(existing.has(o))return;const now=new Date().toISOString(),id=DB._uid(),noteAnki=base.ankiNoteId||this._allocId();
      all.push(Object.assign({},base,{id,ankiId:this._allocId(),ankiNoteId:noteAnki,template:'cloze:'+o,clozeOrd:o,reversedOf:null,
        phase:'new',learnStep:0,s:null,d:null,dueTs:null,due:todayCards(),ease:2.5,intervalo:0,reps:0,lapses:0,status:'pendente',
        createdAt:now,updatedAt:now,ankiMod:Math.floor(Date.now()/1000)}));changed=true;
    });
    const keep=new Set(ords),removed=[];
    for(let i=all.length-1;i>=0;i--){const c=all[i];if(String(c.noteId||c.id)!==String(noteId)||c.kind!=='cloze')continue;
      const o=Number(c.clozeOrd||((c.template||'').match(/^cloze:(\d+)$/)||[])[1]);if(o&&!keep.has(o)){removed.push(String(c.id));all.splice(i,1);changed=true;}}
    if(changed)DB.saveCards(all);
    if(removed.length){
      const set=new Set(removed);
      try{DB.replaceRevlog(DB.getRevlog().filter(r=>!set.has(String(r.cardId))));}catch(e){_quiet(e,'cloze-remove-revlog');}
      try{removed.forEach(id=>CardsConfig.forgetCardId(id));}catch(e){_quiet(e,'cloze-remove-daily');}
    }
    return ords.length;
  },

  autoBurySiblings(card){
    if(!card||!card.noteId)return 0;const cfg=CardsConfig.forDeck(card.deckId),nid=String(card.noteId);let n=0;
    const buried=[];
    DB.getCards().forEach(s=>{
      if(String(s.id)===String(card.id)||String(s.noteId||s.id)!==nid||s.suspenso)return;
      const ph=s.phase||(((s.reps||0)>0&&(s.intervalo||0)>0)?'review':'new'),inter=(ph==='learning'||ph==='relearning')&&!s.dueTs;
      const bury=(ph==='new'&&cfg.buryNew)||(ph==='review'&&cfg.buryReviews)||(inter&&cfg.buryInterdayLearning);
      if(bury&&CardEngine.isDue(s)){DB.buryCard(s.id);buried.push(s.id);}
    });return buried;
  },
  suspendCard(id){
    const c=DB.getCard(id);if(!c)return false;const p={suspenso:true,enterradoAte:null};
    if(Object.prototype.hasOwnProperty.call(c,'dueTsAntesEnterrar')){p.dueTs=c.dueTsAntesEnterrar;p.dueTsAntesEnterrar=null;}
    DB.updateCard(id,p);return true;
  }
};

/* Presets compartilhados e hierarquia de decks.
   O armazenamento legado por-deck continua aceito, mas novos presets podem ser
   compartilhados por vários decks como DeckConfig no Anki. */
AnkiParity._presetKey=function(){try{return DB._profilePrefix()+'cards-shared-presets';}catch(_){return 'diario-estudos:cards-shared-presets';}};
AnkiParity.sharedPresets=function(){
  try{const v=JSON.parse(localStorage.getItem(this._presetKey())||'{}');return v&&typeof v==='object'?v:{};}catch(_){return {};}
};
AnkiParity._saveSharedPresets=function(v){DB.setRaw(this._presetKey(),JSON.stringify(v||{}));};
AnkiParity.createPreset=function(name,patch){
  const all=this.sharedPresets(),id=String(this._allocId());
  all[id]={id,name:String(name||'Preset'),config:Object.assign({},patch||{})};this._saveSharedPresets(all);return id;
};
AnkiParity.updatePreset=function(id,patch){
  const all=this.sharedPresets();if(!all[id])return false;all[id].config=Object.assign({},all[id].config||{},patch||{});this._saveSharedPresets(all);return true;
};
AnkiParity.assignPreset=function(deckId,configId){
  const ds=DB.getDecks(),d=ds.find(x=>String(x.id)===String(deckId));if(!d)return false;
  d.configId=String(configId||'default');DB.saveDecks(ds);return true;
};
AnkiParity.deckAncestors=function(deckId){
  const ds=DB.getDecks(),d=ds.find(x=>String(x.id)===String(deckId));if(!d)return [];
  const parts=String(d.nome||'').split('::'),out=[];
  for(let i=1;i<parts.length;i++){const name=parts.slice(0,i).join('::'),p=ds.find(x=>String(x.nome||'')===name);if(p)out.push(p);}
  return out;
};
AnkiParity.deckDescendant=function(childId,parentId){
  const ds=DB.getDecks(),c=ds.find(x=>String(x.id)===String(childId)),p=ds.find(x=>String(x.id)===String(parentId));
  if(!c||!p)return false;const pn=String(p.nome||'');return String(c.nome||'').startsWith(pn+'::');
};
AnkiParity.installConfigParity=function(){
  if(typeof CardsConfig==='undefined'||CardsConfig.__ankiParityInstalled)return;
  CardsConfig.__ankiParityInstalled=true;
  CardsConfig.DEFAULTS.applyAllParentLimits=false;
  const originalForDeck=CardsConfig.forDeck.bind(CardsConfig);
  CardsConfig.forDeck=function(deckId){
    const base=originalForDeck(deckId);
    if(!deckId)return base;
    const d=DB.getDecks().find(x=>String(x.id)===String(deckId));
    const cid=d&&d.configId;
    if(!cid||cid==='default'||String(cid).startsWith('legacy:'))return base;
    const p=AnkiParity.sharedPresets()[String(cid)];
    if(!p||!p.config)return base;
    const out=this._sanear(Object.assign({},this.get(),p.config));
    out.algo=this.get().algo;out.newCardsIgnoreReviewLimit=this.get().newCardsIgnoreReviewLimit;
    return out;
  };
};

/* ── LIMIT TREE: equivalente a rslib/decks/limits.rs ───────────────────── */
AnkiParity.deckPath=function(deckId){
  if(deckId==null)return [];
  const ds=DB.getDecks(),d=ds.find(x=>String(x.id)===String(deckId));if(!d)return [String(deckId)];
  const parts=String(d.nome||'').split('::'),out=[];
  for(let i=1;i<=parts.length;i++){
    const name=parts.slice(0,i).join('::'),hit=ds.find(x=>String(x.nome||'')===name);
    if(hit)out.push(String(hit.id));
  }
  return out.length?out:[String(deckId)];
};
AnkiParity.selectedDeckId=function(){
  try{
    const set=CardsScreen.filters&&CardsScreen.filters.materias;
    if(set&&set.size===1){const v=[...set][0];if(typeof v==='string'&&v.startsWith('deck:'))return v.slice(5);}
  }catch(_){}
  return null;
};
AnkiParity.limitState=function(selectedDeckId){
  const global=CardsConfig.get(),ignore=!!global.newCardsIgnoreReviewLimit,applyParents=!!global.applyAllParentLimits;
  const decks=DB.getDecks(),byId=new Map(decks.map(d=>[String(d.id),d])),daily=CardsConfig._daily(),usage=daily.usage||[];
  const rem=new Map();
  const stats=(id,kind)=>usage.filter(e=>e.kind===kind&&(e.path||[]).includes(String(id))).length;
  decks.forEach(d=>{
    const cfg=CardsConfig.forDeck(d.id),newDone=stats(d.id,'new'),revDone=stats(d.id,'review');
    let review=Math.max(0,(Number(cfg.revPerDay)||0)-revDone);
    let news=Math.max(0,(Number(cfg.newPerDay)||0)-newDone);
    if(!ignore){review=Math.max(0,review-newDone);news=Math.min(news,review);}
    rem.set(String(d.id),{new:news,review,capNewToReview:!ignore});
  });
  // Sem baralho: usa a config global como nó isolado.
  const nullNew=Math.max(0,(Number(global.newPerDay)||0)-CardsConfig._doneForDeck('new',null));
  let nullReview=Math.max(0,(Number(global.revPerDay)||0)-CardsConfig._doneForDeck('review',null));
  const nullNewCapped=ignore?nullNew:Math.min(nullNew,Math.max(0,nullReview-CardsConfig._doneForDeck('new',null)));
  rem.set('__none__',{new:nullNewCapped,review:ignore?nullReview:Math.max(0,nullReview-CardsConfig._doneForDeck('new',null)),capNewToReview:!ignore});

  const selected=selectedDeckId==null?null:String(selectedDeckId);
  const relevantPath=(deckId)=>{
    if(deckId==null)return ['__none__'];
    const full=AnkiParity.deckPath(deckId);
    if(!selected)return full;
    const pos=full.indexOf(selected);
    if(pos<0)return [];
    return applyParents?full:full.slice(pos);
  };
  const can=(card,kind)=>{
    const path=relevantPath(card&&card.deckId);
    if(!path.length)return false;
    return path.every(id=>{const r=rem.get(id);return !r||r[kind]>0;});
  };
  const take=(card,kind)=>{
    const path=relevantPath(card&&card.deckId);if(!path.length)return false;
    if(!can(card,kind))return false;
    path.forEach(id=>{
      const r=rem.get(id);if(!r)return;
      r[kind]=Math.max(0,r[kind]-1);
      if(kind==='review'&&r.capNewToReview)r.new=Math.min(r.new,r.review);
    });
    return true;
  };
  return {rem,can,take,relevantPath};
};
AnkiParity.filterMatchesDeck=function(cardDeckId,selectedDeckId){
  if(cardDeckId==null||selectedDeckId==null)return false;
  if(String(cardDeckId)===String(selectedDeckId))return true;
  return AnkiParity.deckDescendant(cardDeckId,selectedDeckId);
};

AnkiParity.installConfigParity();
try{if(typeof window!=='undefined')window.AnkiParity=AnkiParity;}catch(e){_quiet(e,'anki-parity-global');}
