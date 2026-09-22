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
    if(!card||!card.noteId)return 0;const cfg=CardsConfig.forDeck(card.originalDeckId||card.deckId),nid=String(card.noteId);let n=0;
    const buried=[];
    DB.getCards().forEach(s=>{
      if(String(s.id)===String(card.id)||String(s.noteId||s.id)!==nid||s.suspenso)return;
      const ph=s.phase||(((s.reps||0)>0&&(s.intervalo||0)>0)?'review':'new'),inter=(ph==='learning'||ph==='relearning')&&!s.dueTs;
      const bury=(ph==='new'&&cfg.buryNew)||(ph==='review'&&cfg.buryReviews)||(inter&&cfg.buryInterdayLearning);
      if(bury&&CardEngine.isDue(s)){DB.buryCard(s.id,'scheduler');buried.push(s.id);}
    });return buried;
  },
  suspendCard(id){
    const c=DB.getCard(id);if(!c)return false;const p={suspenso:true,enterradoAte:null,buryKind:null};
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


/* ── NOTAS / NOTE TYPES / CAMPOS / TEMPLATES ─────────────────────────────
   O Anki agenda CARDS, mas o conteúdo pertence a uma NOTE. Uma nota aponta
   para um NOTE TYPE que define campos e templates; os cards são derivados.
   Guardamos cada entidade em uma chave própria do PLANO. Assim ela entra no
   study_plan_state e sincroniza sem transformar toda a coleção em um blob. */
AnkiParity._planPrefix=function(){
  try{return DB._profilePrefix()+'p:'+DB._activePlanId()+':';}
  catch(_){return 'diario-estudos:p:default:';}
};
AnkiParity._entityKey=function(kind,id){return this._planPrefix()+'cards-'+kind+':'+String(id);};
AnkiParity._scanEntities=function(kind){
  const prefix=this._entityKey(kind,''),out=[];
  try{
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);if(!k||!String(k).startsWith(prefix))continue;
      try{const v=JSON.parse(localStorage.getItem(k)||'null');if(v&&typeof v==='object')out.push(v);}catch(_){}
    }
  }catch(_){}
  return out;
};
AnkiParity.getNotetype=function(id){
  try{return JSON.parse(localStorage.getItem(this._entityKey('notetype',id))||'null');}catch(_){return null;}
};
AnkiParity.saveNotetype=function(nt){
  if(!nt||!nt.id)return false;
  const now=new Date().toISOString(),x=JSON.parse(JSON.stringify(nt));
  x.id=this._validId(x.id)||this._allocId();x.ankiId=x.id;
  x.name=String(x.name||'Note Type');x.kind=x.kind==='cloze'?'cloze':'normal';
  x.fields=Array.isArray(x.fields)?x.fields.map((f,i)=>Object.assign({
    name:'Field '+(i+1),ord:i,sticky:false,rtl:false,fontName:'Arial',fontSize:20,description:'',plainText:false
  },f||{},{ord:i})):[];
  x.templates=Array.isArray(x.templates)?x.templates.map((t,i)=>Object.assign({
    name:'Card '+(i+1),ord:i,qfmt:'',afmt:'{{FrontSide}}'
  },t||{},{ord:i})):[];
  x.css=String(x.css==null?'.card {\n    font-family: arial;\n    font-size: 20px;\n    line-height: 1.5;\n    text-align: center;\n    color: black;\n    background-color: white;\n}\n':x.css);
  x.updatedAt=now;if(!x.createdAt)x.createdAt=now;
  DB.setRaw(this._entityKey('notetype',x.id),JSON.stringify(x));return x;
};
AnkiParity.noteTypes=function(){return this._scanEntities('notetype').sort((a,b)=>String(a.name).localeCompare(String(b.name)));};
AnkiParity._stockNotetypeDef=function(kind){
  const css='.card {\n    font-family: arial;\n    font-size: 20px;\n    line-height: 1.5;\n    text-align: center;\n    color: black;\n    background-color: white;\n}\n';
  if(kind==='basic_reversed')return {
    stockKind:'basic_reversed',name:'Basic (and reversed card)',kind:'normal',css,
    fields:[{name:'Front'},{name:'Back'}],
    templates:[
      {name:'Card 1',qfmt:'{{Front}}',afmt:'{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}'},
      {name:'Card 2',qfmt:'{{Back}}',afmt:'{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}'}
    ]
  };
  if(kind==='typing')return {
    stockKind:'typing',name:'Basic (type in the answer)',kind:'normal',css,
    fields:[{name:'Front'},{name:'Back'}],
    templates:[{name:'Card 1',qfmt:'{{Front}}\n\n{{type:Back}}',afmt:'{{Front}}\n\n<hr id=answer>\n\n{{type:Back}}'}]
  };
  if(kind==='cloze')return {
    stockKind:'cloze',name:'Cloze',kind:'cloze',
    css:css+'.cloze {\n    font-weight: bold;\n    color: blue;\n}\n.nightMode .cloze {\n    color: lightblue;\n}\n',
    fields:[{name:'Text'},{name:'Back Extra'}],
    templates:[{name:'Cloze',qfmt:'{{cloze:Text}}',afmt:'{{cloze:Text}}<br>\n{{Back Extra}}'}]
  };
  return {
    stockKind:'basic',name:'Basic',kind:'normal',css,
    fields:[{name:'Front'},{name:'Back'}],
    templates:[{name:'Card 1',qfmt:'{{Front}}',afmt:'{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}'}]
  };
};
AnkiParity.stockNotetype=function(kind){
  kind=kind||'basic';
  const found=this.noteTypes().find(x=>x.stockKind===kind);if(found)return found;
  const def=this._stockNotetypeDef(kind);def.id=this._allocId();return this.saveNotetype(def);
};
AnkiParity.getNote=function(id){
  try{return JSON.parse(localStorage.getItem(this._entityKey('note',id))||'null');}catch(_){return null;}
};
AnkiParity.saveNote=function(note){
  if(!note||!note.id)return false;
  const now=new Date().toISOString(),x=JSON.parse(JSON.stringify(note));
  x.id=this._validId(x.id)||this._allocId();x.ankiId=x.id;
  x.notetypeId=this._validId(x.notetypeId)||this.stockNotetype('basic').id;
  x.fields=x.fields&&typeof x.fields==='object'&&!Array.isArray(x.fields)?x.fields:{};
  x.tags=Array.isArray(x.tags)?[...new Set(x.tags.map(String).filter(Boolean))]:[];
  x.updatedAt=now;if(!x.createdAt)x.createdAt=now;
  x.revision=Math.max(1,Number(x.revision)||0)+1;
  DB.setRaw(this._entityKey('note',x.id),JSON.stringify(x));return x;
};
AnkiParity.notes=function(){return this._scanEntities('note');};
AnkiParity._fieldNonempty=function(v){
  return String(v==null?'':v).replace(/<!--[\s\S]*?-->/g,'').replace(/<(br|div)\b[^>]*>/gi,'').replace(/<\/div>/gi,'').replace(/[ \t\r\n\f]+/g,'').length>0;
};
AnkiParity._renderConditionals=function(tpl,fields){
  let out=String(tpl||''),last=null,guard=0;
  while(out!==last&&guard++<50){
    last=out;
    out=out.replace(/\{\{#([^{}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,(m,n,body)=>this._fieldNonempty(fields[String(n).trim()])?body:'');
    out=out.replace(/\{\{\^([^{}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,(m,n,body)=>this._fieldNonempty(fields[String(n).trim()])?'':body);
  }
  return out;
};
AnkiParity.renderTemplate=function(nt,note,ord,side,card,frontSide){
  nt=nt||{};note=note||{};const fields=note.fields||{},tmpl=(nt.templates||[])[Number(ord)||0]||{};
  let src=String(side==='answer'?tmpl.afmt:tmpl.qfmt||'');
  src=this._renderConditionals(src,fields);
  src=src.replace(/\{\{FrontSide\}\}/g,String(frontSide||''));
  src=src.replace(/\{\{cloze:([^{}]+)\}\}/g,(m,n)=>{
    const value=fields[String(n).trim()]||'',o=Number(card&&card.clozeOrd)||1;
    return this.revealCloze(value,o,side!=='answer');
  });
  src=src.replace(/\{\{type:([^{}]+)\}\}/g,(m,n)=>{
    const value=String(fields[String(n).trim()]||'');
    return side==='answer'?value:'<span class="typeans" data-field="'+this._escAttr(String(n).trim())+'"></span>';
  });
  src=src.replace(/\{\{([^{}:]+)\}\}/g,(m,n)=>String(fields[String(n).trim()]??''));
  return src;
};
AnkiParity._inferLegacyNote=function(siblings){
  siblings=(siblings||[]).slice();const first=siblings[0]||{};
  let stock='basic',fields={Front:first.frente||'',Back:first.verso||''};
  if(siblings.some(c=>c.kind==='cloze')){
    stock='cloze';fields={Text:first.frente||'', 'Back Extra':first.verso||''};
  }else if(siblings.some(c=>c.template==='reverse'||c.reversedOf)){
    stock='basic_reversed';
    const f=siblings.find(c=>c.template==='forward')||siblings.find(c=>c.template!=='reverse')||first;
    fields={Front:f.frente||'',Back:f.verso||''};
  }
  return {stock,fields};
};
AnkiParity.ensureCanonicalNotes=function(cards){
  cards=Array.isArray(cards)?cards:DB.getCards();const groups=new Map();let changed=false,created=0;
  cards.forEach(c=>{const nid=this.noteId(c);if(!nid)return;const k=String(nid);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);});
  groups.forEach((sibs,key)=>{
    let note=this.getNote(key);
    if(!note){
      const inf=this._inferLegacyNote(sibs),nt=this.stockNotetype(inf.stock);
      note=this.saveNote({id:Number(key),notetypeId:nt.id,fields:inf.fields,tags:[]});created++;
    }
    sibs.forEach((c,i)=>{
      if(c.notetypeId!==note.notetypeId){c.notetypeId=note.notetypeId;changed=true;}
      if(c.ankiTemplateOrd==null){
        let ord=0;
        if(c.kind==='cloze')ord=Math.max(0,(Number(c.clozeOrd)||1)-1);
        else if(c.template==='reverse')ord=1;
        c.ankiTemplateOrd=ord;changed=true;
      }
    });
  });
  if(changed)DB.saveCards(cards);
  return {notes:groups.size,created,cardsChanged:changed};
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
      // No Anki, quando "new cards ignore review limit" está desligado,
      // INTRODUZIR um novo também consome uma vaga do limite de reviews.
      // O estado inicial já desconta os novos vistos hoje; aqui descontamos
      // os novos que entram NESTA fila para que os reviews seguintes vejam
      // exatamente o saldo restante em cada nó da árvore.
      if(kind==='new'&&r.capNewToReview)r.review=Math.max(0,r.review-1);
      if(r.capNewToReview)r.new=Math.min(r.new,r.review);
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


/* ── FSRS TRAINING SET: espelho de rslib/scheduler/fsrs/params.rs ──────────
   O otimizador NÃO recebe "uma linha por revisão". O Anki transforma o
   histórico em prefixos crescentes por card e depois ordena TODOS os prefixos
   pelo RevlogId. Essa ordem e os card_ids alinhados fazem parte do treino. */
AnkiParity._trainingKind=function(r){
  const explicit=String(r&&(
    r.ankiReviewKind!=null?r.ankiReviewKind:
    r.reviewKind!=null?r.reviewKind:''
  )).toLowerCase();
  if(explicit==='filtered'||explicit==='cram'||explicit==='3')return 'filtered';
  if(explicit==='manual'||explicit==='4')return 'manual';
  if(explicit==='rescheduled'||explicit==='5')return 'rescheduled';
  if(explicit==='reset'||explicit==='reset-card')return 'reset';
  const ph=String(r&&r.phase||'').toLowerCase();
  if(ph==='new'||ph==='learning'||ph==='learn')return 'learning';
  if(ph==='relearning'||ph==='relearn')return 'relearning';
  return 'review';
};
AnkiParity._trainingHasRating=function(r){
  const g=Number(r&&r.grade);return Number.isInteger(g)&&g>=1&&g<=4;
};
AnkiParity._trainingAffectsScheduling=function(r){
  const k=this._trainingKind(r);
  return this._trainingHasRating(r)&&k!=='manual'&&k!=='rescheduled'&&k!=='reset'&&k!=='filtered';
};
AnkiParity._trainingInterval=function(r){
  if(r&&r.ankiInterval!=null)return Number(r.ankiInterval)||0;
  if(r&&r.intervalo!=null)return Number(r.intervalo)||0;
  return 0;
};
AnkiParity._trainingDaysElapsed=function(tsMs,nextDayAtSec){
  const sec=Math.floor((Number(tsMs)||0)/1000);
  return Math.max(0,Math.floor((Number(nextDayAtSec)-sec)/86400));
};
AnkiParity._reviewsForFsrsTraining=function(entries,nextDayAtSec,ignoreBeforeMs){
  const arr=(entries||[]).slice().sort((a,b)=>(Number(a.ts)||0)-(Number(b.ts)||0));
  if(!arr.length)return null;
  let firstOfLastLearn=null,firstUserGrade=null;

  // Mesmo walk reverso de reviews_for_fsrs(..., training=true).
  for(let index=arr.length-1;index>=0;index--){
    const e=arr[index],kind=this._trainingKind(e);
    if(kind==='filtered')continue;
    const within=(Number(e.ts)||0)>Number(ignoreBeforeMs||0);
    const user=this._trainingHasRating(e);
    const iv=this._trainingInterval(e);
    const interday=iv>=1||iv<=-86400;
    if(user&&within&&interday)firstUserGrade=index;

    if(user&&kind==='learning'){
      firstOfLastLearn=index;
    }else if(kind==='reset'){
      if(firstOfLastLearn!=null)break;
      if(firstUserGrade!=null)break;
      return null;
    }else if(firstOfLastLearn!=null){
      break;
    }
  }

  // Em treino, a learning inicial do último bloco tem de estar dentro do corte.
  if(firstOfLastLearn!=null){
    if((Number(arr[firstOfLastLearn].ts)||0)<Number(ignoreBeforeMs||0))return null;
    if(firstOfLastLearn>0)arr.splice(0,firstOfLastLearn);
  }else{
    // O rslib não treina cards cujo histórico não contém learning.
    return null;
  }

  const kept=arr.filter(e=>this._trainingAffectsScheduling(e));
  if(kept.length<2)return null;

  const delta=[];
  for(let i=0;i<kept.length;i++){
    if(i===0){delta.push(0);continue;}
    const prev=this._trainingDaysElapsed(kept[i-1].ts,nextDayAtSec);
    const cur=this._trainingDaysElapsed(kept[i].ts,nextDayAtSec);
    delta.push(Math.max(0,prev-cur));
  }

  const prefixes=[],current=[];
  for(let i=0;i<kept.length;i++){
    current.push({rating:Number(kept[i].grade),delta_t:delta[i]});
    if(i>=1&&delta[i]>0){
      prefixes.push({
        revlogId:Number(kept[i].ts)||0,
        reviews:current.map(x=>({rating:x.rating,delta_t:x.delta_t}))
      });
    }
  }
  return prefixes.length?{prefixes,filteredRevlogs:kept}:null;
};
AnkiParity.fsrsTrainingData=function(revlog,opts){
  opts=opts||{};
  const nextDayAtSec=Number(opts.nextDayAtSec)||
    Math.floor((typeof proximaViradaTs==='function'?proximaViradaTs():Date.now()+86400000)/1000);
  const ignoreBeforeMs=Number(opts.ignoreBeforeMs)||0;
  const cards=Array.isArray(opts.cards)?opts.cards:(typeof DB!=='undefined'?DB.getCards():[]);
  const cardByStudyId=new Map((cards||[]).map(c=>[String(c.id),c]));
  const grouped=new Map();
  (revlog||[]).forEach(r=>{
    if(!r||r.cardId==null)return;
    const k=String(r.cardId);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(r);
  });

  const rows=[];let reviewCount=0;
  grouped.forEach((entries,studyCardId)=>{
    const built=this._reviewsForFsrsTraining(entries,nextDayAtSec,ignoreBeforeMs);
    if(!built)return;
    reviewCount+=built.filteredRevlogs.length;
    const card=cardByStudyId.get(studyCardId);
    const ankiCardId=card?this.cardId(card):this._validId(studyCardId);
    if(!ankiCardId)return;
    built.prefixes.forEach(p=>rows.push({
      revlogId:p.revlogId,
      cardId:ankiCardId,
      item:{reviews:p.reviews}
    }));
  });

  // Rust usa sort_by_key(RevlogId), estável; JS moderno também garante sort estável.
  rows.sort((a,b)=>a.revlogId-b.revlogId);
  return {
    items:rows.map(x=>x.item),
    cardIds:rows.map(x=>x.cardId),
    reviewCount,
    nextDayAtSec,
    ignoreBeforeMs
  };
};


/* ── FILTERED DECKS / CUSTOM STUDY (Anki 26.09.2) ─────────────────────────
   Contratos espelhados de rslib/src/scheduler/filtered/{mod,card,custom_study}.rs.
   Um card levado a um baralho filtrado guarda o baralho/vencimento de origem.
   Com reschedule=true, a primeira resposta o devolve ao baralho original com o
   NOVO agendamento. Com reschedule=false, Again/Hard podem repetir em preview,
   e Good/Easy (ou atraso 0) devolvem o estado original sem alterar a memória. */
AnkiParity.FILTERED_ORDERS={
  OLDEST_REVIEWED_FIRST:0,RANDOM:1,INTERVALS_ASCENDING:2,INTERVALS_DESCENDING:3,
  LAPSES:4,ADDED:5,DUE:6,REVERSE_ADDED:7,RETRIEVABILITY_ASCENDING:8,
  RETRIEVABILITY_DESCENDING:9,RELATIVE_OVERDUENESS:10
};
AnkiParity.filteredDefaults=function(){
  return {
    reschedule:true,
    searchTerms:[{search:'',limit:100,order:this.FILTERED_ORDERS.RANDOM}],
    delays:[],previewDelay:10,previewAgainSecs:60,previewHardSecs:600,previewGoodSecs:0
  };
};
AnkiParity.isFilteredDeck=function(deckOrId){
  const d=(deckOrId&&typeof deckOrId==='object')?deckOrId:
    DB.getDecks().find(x=>String(x.id)===String(deckOrId));
  return !!(d&&(d.filtered===true||d.kind==='filtered'||d.filteredConfig));
};
AnkiParity.filteredConfig=function(deckOrId){
  const d=(deckOrId&&typeof deckOrId==='object')?deckOrId:
    DB.getDecks().find(x=>String(x.id)===String(deckOrId));
  if(!this.isFilteredDeck(d))return null;
  const raw=d.filteredConfig||{},def=this.filteredDefaults();
  const terms=Array.isArray(raw.searchTerms)?raw.searchTerms:
    (Array.isArray(raw.search_terms)?raw.search_terms:def.searchTerms);
  return Object.assign({},def,raw,{
    searchTerms:terms.slice(0,2).map(t=>({
      search:String(t&&t.search||''),
      limit:Math.max(0,Math.floor(Number(t&&t.limit)||0)),
      order:Number.isInteger(Number(t&&t.order))?Number(t.order):this.FILTERED_ORDERS.RANDOM
    }))
  });
};
AnkiParity._clearFilteredFields=function(patch){
  Object.assign(patch,{
    originalDeckId:null,originalDue:null,originalDueTs:null,originalPhase:null,
    filteredPosition:null,filteredReschedule:null,filteredDeckId:null
  });
  return patch;
};
AnkiParity._restoreFilteredCardPatch=function(card){
  const p={
    deckId:card.originalDeckId||null,
    due:card.originalDue||todayCards(),
    dueTs:card.originalDueTs==null?null:card.originalDueTs,
    phase:card.originalPhase||card.phase
  };
  return this._clearFilteredFields(p);
};
AnkiParity.emptyFilteredDeck=function(deckId){
  if(!this.isFilteredDeck(deckId))return 0;
  const cards=DB.getCards();let n=0;
  cards.forEach(card=>{
    if(String(card.deckId)!==String(deckId)||!card.originalDeckId)return;
    Object.assign(card,this._restoreFilteredCardPatch(card));card.updatedAt=new Date().toISOString();n++;
  });
  if(n)DB.saveCards(cards);
  CardEngine.invalidateDueCache();
  return n;
};
AnkiParity.removeFromFilteredAfterReschedule=function(card,patch){
  if(!card||!card.originalDeckId)return patch||{};
  const deck=DB.getDecks().find(d=>String(d.id)===String(card.deckId));
  const cfg=this.filteredConfig(deck);
  if(!cfg||!cfg.reschedule)return patch||{};
  const out=Object.assign({},patch||{},{deckId:card.originalDeckId});
  return this._clearFilteredFields(out);
};
AnkiParity._noteTagsForCard=function(card){
  const note=this.getNote(this.noteId(card));
  const tags=(note&&Array.isArray(note.tags))?note.tags:(Array.isArray(card&&card.tags)?card.tags:[]);
  return tags.map(String);
};
AnkiParity._splitSearchTop=function(expr,mode){
  expr=String(expr||'').trim();const out=[];let cur='',depth=0,quote=false;
  const flush=()=>{const x=cur.trim();if(x)out.push(x);cur='';};
  for(let i=0;i<expr.length;i++){
    const ch=expr[i];
    if(ch==='"'){quote=!quote;cur+=ch;continue;}
    if(!quote){
      if(ch==='('){depth++;cur+=ch;continue;}
      if(ch===')'){depth=Math.max(0,depth-1);cur+=ch;continue;}
      if(depth===0&&mode==='or'&&expr.slice(i,i+4).toUpperCase()===' OR '){flush();i+=3;continue;}
      if(depth===0&&mode==='and'&&/\s/.test(ch)){flush();while(i+1<expr.length&&/\s/.test(expr[i+1]))i++;continue;}
    }
    cur+=ch;
  }
  flush();return out;
};
AnkiParity._stripOuterParens=function(s){
  s=String(s||'').trim();
  while(s[0]==='('&&s[s.length-1]===')'){
    let d=0,q=false,ok=true;
    for(let i=0;i<s.length;i++){
      if(s[i]==='"')q=!q;
      if(q)continue;
      if(s[i]==='(')d++;else if(s[i]===')')d--;
      if(d===0&&i<s.length-1){ok=false;break;}
    }
    if(!ok)break;s=s.slice(1,-1).trim();
  }
  return s;
};
AnkiParity._filteredTermMatches=function(card,term){
  term=this._stripOuterParens(term);
  if(!term)return true;
  if(term[0]==='-')return !this._filteredTermMatches(card,term.slice(1));
  if(/^not:/i.test(term))return !this._filteredTermMatches(card,term.slice(4));
  const m=term.match(/^([^:]+):(.*)$/),key=m?m[1].toLowerCase():'',raw=m?m[2]:'';
  const val=String(raw||'').replace(/^"(.*)"$/,'$1');
  const homeId=card.originalDeckId||card.deckId;
  const lc=x=>String(x==null?'':x).toLowerCase();
  const includes=(x,w)=>lc(x).includes(lc(w));
  if(!m){
    const bare=lc(term.replace(/^"|"$/g,''));
    if(bare==='favorito'||bare==='favorite')return !!card.favorito;
    if(bare==='suspenso'||bare==='suspended')return !!card.suspenso;
    if(bare==='leech')return !!card.leech||this._noteTagsForCard(card).some(t=>lc(t)==='leech');
  }
  if(key==='materia'||key==='subject')return includes(card.materia,val)||includes(card.materiaTec,val);
  if(key==='assunto'||key==='topic')return includes(card.assunto,val);
  if(key==='tipo'||key==='type')return includes(card.tipo||card.kind,val);
  if(key==='banca')return includes(card.banca,val);
  if(key==='favorito'||key==='favorite'){
    const v=lc(val);return v===''||v==='1'||v==='true'||v==='sim'?!!card.favorito:!card.favorito;
  }
  if(key==='suspenso'||key==='suspended'){
    const v=lc(val);return v===''||v==='1'||v==='true'||v==='sim'?!!card.suspenso:!card.suspenso;
  }
  if(key==='leech'){
    const hit=!!card.leech||this._noteTagsForCard(card).some(t=>lc(t)==='leech');
    const v=lc(val);return v===''||v==='1'||v==='true'||v==='sim'?hit:!hit;
  }
  if(key==='deck'||key==='baralho'){
    const ds=DB.getDecks(),d=ds.find(x=>String(x.id)===String(homeId));
    if(!d)return false;const n=String(d.nome||'').toLowerCase(),want=val.toLowerCase();
    return n===want||n.startsWith(want+'::');
  }
  if(key==='is'){
    const ph=String(card.originalPhase||card.phase||(((card.reps||0)>0&&(card.intervalo||0)>0)?'review':'new')).toLowerCase();
    const v=val.toLowerCase();
    if(v==='new')return ph==='new';
    if(v==='review')return ph==='review';
    if(v==='learn'||v==='learning')return ph==='learning'||ph==='relearning';
    if(v==='suspended')return !!card.suspenso;
    if(v==='buried')return CardEngine.estaEnterrado(card);
    if(v==='due')return ph!=='new'&&(
      card.originalDueTs?card.originalDueTs<=Date.now():(card.originalDue||card.due||todayCards())<=todayCards()
    );
  }
  if(key==='added'){
    const days=Math.max(0,Number(val)||0),ts=Date.parse(card.createdAt||'');
    return Number.isFinite(ts)&&ts>=Date.now()-days*86400000;
  }
  if(key==='rated'){
    const bits=val.split(':'),days=Math.max(0,Number(bits[0])||0),grade=bits.length>1?Number(bits[1]):null;
    const cutoff=Date.now()-days*86400000;
    return DB.getRevlog().some(r=>String(r.cardId)===String(card.id)&&(Number(r.ts)||0)>=cutoff&&(grade==null||Number(r.grade)===grade));
  }
  if(key==='tag'){
    const want=val.toLowerCase();
    return this._noteTagsForCard(card).some(t=>{const x=t.toLowerCase();return x===want||x.startsWith(want+'::');});
  }
  if(key==='prop'){
    const pm=val.match(/^due\s*(<=|>=|=|<|>)\s*(-?\d+)$/i);
    if(pm){
      const due=card.originalDue||card.due||todayCards(),delta=CardEngine._daysBetween(todayCards(),due);
      const n=Number(pm[2]),op=pm[1];
      return op==='<='?delta<=n:op==='>='?delta>=n:op==='<'?delta<n:op==='>'?delta>n:delta===n;
    }
  }
  const needle=term.replace(/^"|"$/g,'').toLowerCase();
  const hay=[card.frente,card.verso,card.assunto,card.materia,card.materiaTec,card.banca].filter(Boolean).join(' ').replace(/<[^>]+>/g,' ').toLowerCase();
  return hay.includes(needle);
};
AnkiParity.filteredSearchMatches=function(card,expr){
  expr=this._stripOuterParens(expr);if(!expr)return true;
  const ors=this._splitSearchTop(expr,'or');
  if(ors.length>1)return ors.some(x=>this.filteredSearchMatches(card,x));
  const ands=this._splitSearchTop(expr,'and');
  if(ands.length>1)return ands.every(x=>this.filteredSearchMatches(card,x));
  return this._filteredTermMatches(card,expr);
};
AnkiParity._filteredSort=function(cards,order){
  const xs=cards.slice(),lastReview=(c)=>{
    let max=0;DB.getRevlog().forEach(r=>{if(String(r.cardId)===String(c.id))max=Math.max(max,Number(r.ts)||0);});return max;
  };
  const overdue=(c)=>{
    const iv=Math.max(1,Number(c.intervalo)||1),due=c.originalDue||c.due||todayCards();
    const late=Math.max(0,CardEngine._daysBetween(due,todayCards()));return (late+iv)/iv;
  };
  const R=c=>CardEngine.retrievabilityDe(c,todayCards(),CardsConfig.weightsFor(c.originalDeckId||c.deckId));
  switch(Number(order)){
    case 0:xs.sort((a,b)=>lastReview(a)-lastReview(b));break;
    case 1:for(let i=xs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[xs[i],xs[j]]=[xs[j],xs[i]];}break;
    case 2:xs.sort((a,b)=>(a.intervalo||0)-(b.intervalo||0));break;
    case 3:xs.sort((a,b)=>(b.intervalo||0)-(a.intervalo||0));break;
    case 4:xs.sort((a,b)=>(b.lapses||0)-(a.lapses||0));break;
    case 5:xs.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));break;
    case 6:xs.sort((a,b)=>String(a.originalDue||a.due||'').localeCompare(String(b.originalDue||b.due||'')));break;
    case 7:xs.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));break;
    case 8:xs.sort((a,b)=>R(a)-R(b));break;
    case 9:xs.sort((a,b)=>R(b)-R(a));break;
    case 10:xs.sort((a,b)=>overdue(b)-overdue(a));break;
  }
  return xs;
};
AnkiParity.rebuildFilteredDeck=function(deckId){
  const deck=DB.getDecks().find(d=>String(d.id)===String(deckId));
  const cfg=this.filteredConfig(deck);if(!cfg)return 0;
  this.emptyFilteredDeck(deckId);
  try{this.ensureIdentities();this.ensureCanonicalNotes();}catch(_){}
  const all=DB.getCards(),picked=[],seen=new Set();
  for(const term of cfg.searchTerms.slice(0,2)){
    const candidates=all.filter(card=>{
      if(card.suspenso||CardEngine.estaEnterrado(card)||card.originalDeckId)return false;
      if(String(card.deckId)===String(deckId))return false;
      return this.filteredSearchMatches(card,term.search);
    });
    const ordered=this._filteredSort(candidates,term.order);
    const lim=Math.max(0,Number(term.limit)||0);
    for(const card of ordered.slice(0,lim)){
      if(seen.has(String(card.id)))continue;seen.add(String(card.id));picked.push(card);
    }
  }
  picked.forEach((card,i)=>{
    card.originalDeckId=card.deckId;
    card.originalDue=card.due||todayCards();
    card.originalDueTs=card.dueTs==null?null:card.dueTs;
    card.originalPhase=card.phase||(((card.reps||0)>0&&(card.intervalo||0)>0)?'review':'new');
    card.filteredPosition=-100000+i;
    card.filteredReschedule=!!cfg.reschedule;card.filteredDeckId=deck.id;
    card.deckId=deck.id;card.due=todayCards();card.dueTs=null;card.updatedAt=new Date().toISOString();
  });
  if(picked.length)DB.saveCards(all);
  CardEngine.invalidateDueCache();
  return picked.length;
};
AnkiParity.saveFilteredDeck=function(input){
  input=input||{};const decks=DB.getDecks(),id=input.id||DB._uid(),old=decks.find(d=>String(d.id)===String(id));
  const cfg=Object.assign(this.filteredDefaults(),input.config||input.filteredConfig||{});
  cfg.searchTerms=(cfg.searchTerms||[]).slice(0,2);
  const deck=Object.assign(old||{},{
    id,nome:String(input.nome||input.name||(old&&old.nome)||'Baralho filtrado').trim()||'Baralho filtrado',
    kind:'filtered',filtered:true,filteredConfig:cfg,configId:null,
    createdAt:(old&&old.createdAt)||new Date().toISOString(),updatedAt:new Date().toISOString()
  });
  if(old)Object.assign(old,deck);else decks.push(deck);
  DB.saveDecks(decks);
  const count=this.rebuildFilteredDeck(id);
  if(count===0&&!input.allowEmpty){
    if(!old)DB.saveDecks(DB.getDecks().filter(d=>String(d.id)!==String(id)));
    else DB.saveDecks(decks);
    return {ok:false,count:0,deck:null};
  }
  return {ok:true,count,deck};
};
AnkiParity.previewFilteredAnswer=function(card,grade){
  if(!card||!card.originalDeckId)return null;
  const deck=DB.getDecks().find(d=>String(d.id)===String(card.deckId)),cfg=this.filteredConfig(deck);
  if(!cfg||cfg.reschedule)return null;
  const g=String(grade||'bom');
  const secs=g==='errei'||g==='naosei'?Number(cfg.previewAgainSecs)||0:
    g==='dificil'?Number(cfg.previewHardSecs)||0:
    g==='bom'||g==='sei'?Number(cfg.previewGoodSecs)||0:0;
  if(secs<=0)return Object.assign(this._restoreFilteredCardPatch(card),{_filteredPreview:true,_filteredFinished:true});
  const delay=(typeof this.learningFuzzSeconds==='function')?this.learningFuzzSeconds(card,secs):secs;
  return {
    deckId:card.deckId,due:todayCards(),dueTs:Date.now()+delay*1000,
    phase:card.phase,status:card.status,_filteredPreview:true,_filteredFinished:false
  };
};
AnkiParity.customStudy=function(input){
  input=input||{};const deckId=input.deckId;
  const home=DB.getDecks().find(d=>String(d.id)===String(deckId));if(!home||this.isFilteredDeck(home))return {ok:false,count:0,error:'normal-deck-required'};
  const name='Estudo Personalizado',kind=String(input.kind||''),days=Math.max(0,Number(input.days)||0);
  const esc=String(home.nome||'').replace(/"/g,'\\"');
  if(kind==='newLimitDelta'||kind==='reviewLimitDelta'){
    const key=kind==='newLimitDelta'?'newPerDay':'revPerDay',delta=Number(input.delta)||0;
    const cfg=CardsConfig.forDeck(deckId),next=Math.max(0,(Number(cfg[key])||0)+delta);
    const existing=CardsConfig.getDeckPreset?CardsConfig.getDeckPreset(deckId):{};
    CardsConfig.setDeckPreset(deckId,Object.assign({},existing||{},{[key]:next}));
    return {ok:true,count:0,limitOnly:true};
  }
  let cfg=this.filteredDefaults(),term={search:'deck:"'+esc+'"',limit:99999,order:this.FILTERED_ORDERS.RANDOM};
  if(kind==='forgot'){
    term.search+=' rated:'+days+':1';cfg.reschedule=false;term.order=this.FILTERED_ORDERS.RANDOM;
  }else if(kind==='ahead'){
    term.search+=' prop:due<='+days+' -is:new';cfg.reschedule=true;term.order=this.FILTERED_ORDERS.DUE;
  }else if(kind==='preview'){
    term.search+=' is:new added:'+days;cfg.reschedule=false;term.order=this.FILTERED_ORDERS.ADDED;
  }else if(kind==='cram'){
    const ck=String(input.cramKind||'due'),limit=Math.max(0,Number(input.limit)||0);
    cfg.reschedule=ck!=='all';term.limit=limit;
    if(ck==='new'){term.search+=' is:new';term.order=this.FILTERED_ORDERS.ADDED;}
    else if(ck==='due'){term.search+=' is:due';term.order=this.FILTERED_ORDERS.DUE;}
    else if(ck==='review'){term.search+=' -is:new';term.order=this.FILTERED_ORDERS.RANDOM;}
    else {term.order=this.FILTERED_ORDERS.RANDOM;}
    const inc=(input.includeTags||[]).map(String).filter(Boolean),exc=(input.excludeTags||[]).map(String).filter(Boolean);
    if(inc.length)term.search+=' ('+inc.map(t=>'tag:"'+t.replace(/"/g,'\\"')+'"').join(' OR ')+')';
    if(exc.length)term.search+=' '+exc.map(t=>'-tag:"'+t.replace(/"/g,'\\"')+'"').join(' ');
  }else return {ok:false,count:0,error:'unknown-kind'};
  cfg.searchTerms=[term];cfg.previewDelay=10;cfg.previewAgainSecs=60;cfg.previewHardSecs=600;cfg.previewGoodSecs=0;
  const existing=DB.getDecks().find(d=>String(d.nome||'').toLowerCase()===name.toLowerCase());
  if(existing&&!this.isFilteredDeck(existing))return {ok:false,count:0,error:'name-conflict'};
  return this.saveFilteredDeck({id:existing&&existing.id,nome:name,config:cfg,allowEmpty:false});
};

AnkiParity.installConfigParity();
try{if(typeof window!=='undefined')window.AnkiParity=AnkiParity;}catch(e){_quiet(e,'anki-parity-global');}
