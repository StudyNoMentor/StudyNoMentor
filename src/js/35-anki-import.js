/* ============================================================
   IMPORTAÇÃO ANKI / MNEMOSYNE — interoperabilidade 26.09.2
   ============================================================ */
const AnkiImport = {
  _enc:new TextEncoder(), _dec:new TextDecoder(),
  _u8(v){return v instanceof Uint8Array?v:(v instanceof ArrayBuffer?new Uint8Array(v):this._enc.encode(String(v==null?'':v)));},
  _text(v){return this._dec.decode(this._u8(v));},
  _b64(bytes){
    bytes=this._u8(bytes);let s='';
    for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return typeof btoa==='function'?btoa(s):(typeof Buffer!=='undefined'?Buffer.from(bytes).toString('base64'):'');
  },
  _mime(name){
    const e=String(name||'').split('.').pop().toLowerCase();
    return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',svg:'image/svg+xml',
      mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',
      mp4:'video/mp4',webm:'video/webm'})[e]||'application/octet-stream';
  },
  _varint(bytes,pos){
    let x=0n,s=0n,i=pos;
    for(;i<bytes.length;i++){const b=BigInt(bytes[i]);x|=(b&127n)<<s;if(!(b&128n))return [x,i+1];s+=7n;if(s>70n)break;}
    throw new Error('protobuf varint inválido');
  },
  _proto(bytes){
    bytes=this._u8(bytes);const out={};let p=0;
    while(p<bytes.length){
      const [tag,np]=this._varint(bytes,p);p=np;const field=Number(tag>>3n),wire=Number(tag&7n);
      let value;
      if(wire===0){[value,p]=this._varint(bytes,p);}
      else if(wire===1){if(p+8>bytes.length)break;value=bytes.slice(p,p+8);p+=8;}
      else if(wire===2){let n;[n,p]=this._varint(bytes,p);n=Number(n);value=bytes.slice(p,p+n);p+=n;}
      else if(wire===5){if(p+4>bytes.length)break;value=bytes.slice(p,p+4);p+=4;}
      else throw new Error('protobuf wire '+wire+' não suportado');
      (out[field]||(out[field]=[])).push({wire,value});
    }
    return out;
  },
  _pFirst(m,n){return m&&m[n]&&m[n][0]?m[n][0]:null;},
  _pNum(m,n,def=0){const f=this._pFirst(m,n);return f&&f.wire===0?Number(f.value):def;},
  _pStr(m,n,def=''){const f=this._pFirst(m,n);return f&&f.wire===2?this._text(f.value):def;},
  _pFloat(m,n,def=0){const f=this._pFirst(m,n);if(!f)return def;if(f.wire===5)return new DataView(f.value.buffer,f.value.byteOffset,4).getFloat32(0,true);return def;},
  _findEOCD(bytes){
    const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    for(let p=Math.max(0,bytes.length-65557);p<=bytes.length-22;p++){
      if(dv.getUint32(p,true)===0x06054b50)return p;
    }
    return -1;
  },
  async _inflateRaw(bytes){
    if(typeof DecompressionStream==='undefined')throw new Error('Navegador sem suporte a DEFLATE para pacote Anki.');
    const ds=new DecompressionStream('deflate-raw');
    const ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(ab);
  },
  async _loadFzstd(){
    if(globalThis.fzstd&&typeof globalThis.fzstd.decompress==='function')return globalThis.fzstd;
    if(typeof document==='undefined')return null;
    await new Promise((resolve,reject)=>{
      const old=document.querySelector('script[data-snm-fzstd]');
      if(old){if(globalThis.fzstd&&typeof globalThis.fzstd.decompress==='function')return resolve();old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return;}
      const s=document.createElement('script');s.src='./src/vendor/fzstd-0.1.1/fzstd.js';s.dataset.snmFzstd='1';
      s.onload=resolve;s.onerror=()=>reject(new Error('Falha ao carregar decoder zstd local'));document.head.appendChild(s);
    });
    return globalThis.fzstd||null;
  },
  async _zstd(bytes){
    if(globalThis.fzstd&&typeof globalThis.fzstd.decompress==='function')return globalThis.fzstd.decompress(bytes);
    if(typeof DecompressionStream!=='undefined'){
      try{
        const ds=new DecompressionStream('zstd');
        const ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
        return new Uint8Array(ab);
      }catch(_){}
    }
    const mod=await this._loadFzstd();
    if(mod&&typeof mod.decompress==='function')return mod.decompress(bytes);
    throw new Error('Decoder Zstandard local indisponível para pacote Anki atual.');
  },
  async unzip(bytes){
    bytes=this._u8(bytes);const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),eocd=this._findEOCD(bytes);
    if(eocd<0)throw new Error('ZIP/APKG inválido: diretório central ausente');
    const count=dv.getUint16(eocd+10,true),cdOff=dv.getUint32(eocd+16,true),files=new Map();let p=cdOff;
    for(let i=0;i<count;i++){
      if(dv.getUint32(p,true)!==0x02014b50)throw new Error('ZIP inválido: entrada central');
      const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),usize=dv.getUint32(p+24,true);
      const nlen=dv.getUint16(p+28,true),xlen=dv.getUint16(p+30,true),clen=dv.getUint16(p+32,true),loff=dv.getUint32(p+42,true);
      const name=this._text(bytes.slice(p+46,p+46+nlen));
      if(dv.getUint32(loff,true)!==0x04034b50)throw new Error('ZIP inválido: cabeçalho local');
      const ln=dv.getUint16(loff+26,true),lx=dv.getUint16(loff+28,true),start=loff+30+ln+lx,packed=bytes.slice(start,start+csize);
      let data;if(method===0)data=packed;else if(method===8)data=await this._inflateRaw(packed);else throw new Error('ZIP usa método '+method+' não suportado');
      if(usize&&data.length!==usize)throw new Error('ZIP truncado em '+name);
      files.set(name,data);p+=46+nlen+xlen+clen;
    }
    return files;
  },
  _mediaEntriesProto(bytes){
    const top=this._proto(bytes),arr=top[1]||[],out=[];
    for(const f of arr){
      if(f.wire!==2)continue;const m=this._proto(f.value),name=this._pStr(m,1,'');
      if(name)out.push({name,size:this._pNum(m,2,0)});
    }
    return out;
  },
  async _package(file){
    const bytes=new Uint8Array(await file.arrayBuffer()),files=await this.unzip(bytes);
    let version=files.has('collection.anki21b')?3:(files.has('collection.anki21')?2:1);
    if(files.has('meta')){try{const m=this._proto(files.get('meta'));version=this._pNum(m,1,version);}catch(_){}}
    const colName=version===3?'collection.anki21b':(version===2?'collection.anki21':'collection.anki2');
    if(!files.has(colName))throw new Error('Pacote Anki sem '+colName);
    const collection=version===3?await this._zstd(files.get(colName)):files.get(colName);
    let media=new Map();
    if(files.has('media')){
      if(version===3){
        const mapBytes=await this._zstd(files.get('media')),entries=this._mediaEntriesProto(mapBytes);
        for(let i=0;i<entries.length;i++)if(files.has(String(i)))media.set(entries[i].name,await this._zstd(files.get(String(i))));
      }else{
        let map={};try{map=JSON.parse(this._text(files.get('media')))||{};}catch(_){}
        for(const k of Object.keys(map))if(files.has(String(k)))media.set(String(map[k]),files.get(String(k)));
      }
    }
    return {version,collection,media,files};
  },
  async _SQL(){return AnkiExport&&typeof AnkiExport._loadSqlJs==='function'?AnkiExport._loadSqlJs():Promise.reject(new Error('sql.js indisponível'));},
  _rows(db,sql,params){
    const st=db.prepare(sql);if(params)st.bind(params);const out=[];while(st.step())out.push(st.getAsObject());st.free();return out;
  },
  _has(db,name){
    try{return this._rows(db,"select 1 as x from sqlite_master where type='table' and name=?",[name]).length>0;}catch(_){return false;}
  },
  _replaceMedia(html,media){
    let s=String(html==null?'':html);if(!media||!media.size)return s;
    const cache=new Map(),dataFor=(name)=>{
      if(cache.has(name))return cache.get(name);const b=media.get(name);if(!b)return null;
      const u='data:'+this._mime(name)+';base64,'+this._b64(b);cache.set(name,u);return u;
    };
    s=s.replace(/(<(?:img|audio|video)\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi,(m,a,n,z)=>a+(dataFor(n)||n)+z);
    s=s.replace(/\[sound:([^\]]+)\]/gi,(m,n)=>{const u=dataFor(n);return u?'<audio controls preload="none" src="'+u+'"></audio>':m;});
    return s;
  },
  _legacyMetadata(db){
    const c=this._rows(db,'select ver,models,decks,dconf from col where id=1')[0]||{};
    let models={},decks={},dconf={};try{models=JSON.parse(c.models||'{}');}catch(_){}try{decks=JSON.parse(c.decks||'{}');}catch(_){}try{dconf=JSON.parse(c.dconf||'{}');}catch(_){}
    return {ver:Number(c.ver)||11,models,decks,dconf};
  },
  _modernMetadata(db){
    const models={},decks={},dconf={};
    if(this._has(db,'notetypes')){
      for(const r of this._rows(db,'select id,name,config from notetypes')){
        const cm=this._proto(r.config||new Uint8Array()),fields=[],tmpls=[];
        if(this._has(db,'fields'))for(const f of this._rows(db,'select ord,name,config from fields where ntid=? order by ord',[r.id])){
          const x=this._proto(f.config||new Uint8Array());fields.push({name:f.name,ord:Number(f.ord),sticky:!!this._pNum(x,1),rtl:!!this._pNum(x,2),font:this._pStr(x,3,'Arial'),size:this._pNum(x,4,20),description:this._pStr(x,5,''),plainText:!!this._pNum(x,6),collapsed:!!this._pNum(x,7)});
        }
        if(this._has(db,'templates'))for(const t of this._rows(db,'select ord,name,config from templates where ntid=? order by ord',[r.id])){
          const x=this._proto(t.config||new Uint8Array());tmpls.push({name:t.name,ord:Number(t.ord),qfmt:this._pStr(x,1,''),afmt:this._pStr(x,2,''),bqfmt:this._pStr(x,3,''),bafmt:this._pStr(x,4,''),did:this._pNum(x,5,0)||null,bfont:this._pStr(x,6,''),bsize:this._pNum(x,7,0),id:this._pNum(x,8,0)||null});
        }
        models[String(r.id)]={id:Number(r.id),name:r.name,mod:Number(r.mtime_secs)||0,type:this._pNum(cm,1,0),sortf:this._pNum(cm,2,0),css:this._pStr(cm,3,''),latexPre:this._pStr(cm,5,''),latexPost:this._pStr(cm,6,''),latexsvg:!!this._pNum(cm,7),flds:fields,tmpls};
      }
    }
    if(this._has(db,'decks'))for(const r of this._rows(db,'select id,name,common,kind from decks')){
      let conf=1,dyn=0,desc='';try{const kc=this._proto(r.kind||new Uint8Array());if(kc[1]&&kc[1][0]){const n=this._proto(kc[1][0].value);conf=this._pNum(n,1,1);desc=this._pStr(n,4,'');}else if(kc[2])dyn=1;}catch(_){}
      decks[String(r.id)]={id:Number(r.id),name:r.name,conf,dyn,desc};
    }
    if(this._has(db,'deck_config'))for(const r of this._rows(db,'select id,name,config from deck_config')){
      const x=this._proto(r.config||new Uint8Array()),floats=(n)=>(x[n]||[]).filter(f=>f.wire===5).map(f=>new DataView(f.value.buffer,f.value.byteOffset,4).getFloat32(0,true));
      dconf[String(r.id)]={id:Number(r.id),name:r.name,new:{perDay:this._pNum(x,9,20),delays:floats(1)},rev:{perDay:this._pNum(x,10,200)},lapse:{delays:floats(2),leechFails:this._pNum(x,22,8),leechAction:this._pNum(x,21,1)},maxIvl:this._pNum(x,16,36500),fsrsParams6:floats(6),desiredRetention:this._pFloat(x,37,.9),easyDaysPercentages:floats(4)};
    }
    return {ver:18,models,decks,dconf};
  },
  _toNotetype(m){
    const fields=(m.flds||m.fields||[]).map((f,i)=>({name:f.name||('Field '+(i+1)),ord:i,sourceOrd:Number.isFinite(Number(f.ord))?Number(f.ord):i,id:f.id==null?null:Number(f.id),sticky:!!f.sticky,rtl:!!f.rtl,fontName:f.font||f.fontName||'Arial',fontSize:Number(f.size||f.fontSize)||20,description:f.description||'',plainText:!!f.plainText,collapsed:!!f.collapsed,excludeFromSearch:!!f.excludeFromSearch,tag:f.tag==null?null:Number(f.tag),preventDeletion:!!f.preventDeletion}));
    const templates=(m.tmpls||m.templates||[]).map((t,i)=>({name:t.name||('Card '+(i+1)),ord:i,sourceOrd:Number.isFinite(Number(t.ord))?Number(t.ord):i,qfmt:t.qfmt||'',afmt:t.afmt||'',bqfmt:t.bqfmt||'',bafmt:t.bafmt||'',did:t.did||null,bfont:t.bfont||'',bsize:Number(t.bsize)||0,id:t.id==null?null:Number(t.id)}));
    return {id:Number(m.id),ankiId:Number(m.id),originalId:m.originalId==null?Number(m.id):Number(m.originalId),name:m.name||'Imported',kind:Number(m.type)===1?'cloze':'normal',css:m.css||'',fields,templates,latexPre:m.latexPre||'',latexPost:m.latexPost||'',latexsvg:!!m.latexsvg,originalStockKind:Number(m.originalStockKind)||0,updatedAt:m.mod?new Date(Number(m.mod)*1000).toISOString():undefined,ankiMtime:m.mod?new Date(Number(m.mod)*1000).toISOString():undefined};
  },
  _deckCfg(d){
    const w=Array.isArray(d.fsrsParams6)&&d.fsrsParams6.length===21?d.fsrsParams6:null;
    return {newPerDay:Number(d.new&&d.new.perDay)||20,revPerDay:Number(d.rev&&d.rev.perDay)||200,
      learnSteps:Array.isArray(d.new&&d.new.delays)?d.new.delays:[1,10],relearnSteps:Array.isArray(d.lapse&&d.lapse.delays)?d.lapse.delays:[10],
      leechThreshold:Number(d.lapse&&d.lapse.leechFails)||8,leechAction:Number(d.lapse&&d.lapse.leechAction)===0?'suspend':'tag',
      maxInterval:Number(d.maxIvl)||36500,weights:w,retention:Number(d.desiredRetention)||.9,
      easyDays:Array.isArray(d.easyDaysPercentages)&&d.easyDaysPercentages.length===7?d.easyDaysPercentages.map(x=>Number(x)>1?Number(x)/100:Number(x)):undefined};
  },
  async inspectPackage(file){
    const pkg=await this._package(file),SQL=await this._SQL(),db=new SQL.Database(pkg.collection);
    const legacy=this._legacyMetadata(db),meta=(Object.keys(legacy.models).length||Object.keys(legacy.decks).length)?legacy:this._modernMetadata(db);
    const counts={notes:this._rows(db,'select count(*) as n from notes')[0].n,cards:this._rows(db,'select count(*) as n from cards')[0].n,revlog:this._has(db,'revlog')?this._rows(db,'select count(*) as n from revlog')[0].n:0};
    db.close();return {kind:'anki-package',file,pkg,meta,counts,format:file.name.toLowerCase().endsWith('.colpkg')?'colpkg':'apkg'};
  },
  async inspectMnemosyne(file){
    const SQL=await this._SQL(),db=new SQL.Database(new Uint8Array(await file.arrayBuffer()));
    const facts=this._rows(db,'select facts._id as id,data_for_fact.key as key,data_for_fact.value as value from facts join data_for_fact on facts._id=data_for_fact._fact_id');
    const cards=this._rows(db,'select _fact_id as fact_id,fact_view_id,tags,next_rep,last_rep,easiness,(acq_reps+ret_reps) as reps,lapses from cards');
    db.close();return {kind:'mnemosyne',file,facts,cards,counts:{notes:new Set(facts.map(x=>x.id)).size,cards:cards.length,revlog:0}};
  },
  parseText(text,name,overrides){
    overrides=overrides||{};const src=String(text||'').replace(/^\uFEFF/,'');
    const raw=src.split(/\r?\n/),headers={},dataLines=[];let quoted=false;
    for(const line of raw){
      if(!quoted&&/^#/.test(line)){
        const h=line.slice(1),i=h.indexOf(':');if(i>0)headers[h.slice(0,i).trim().toLowerCase()]=h.slice(i+1).trim();
        continue;
      }
      dataLines.push(line);
      for(let i=0;i<line.length;i++)if(line[i]==='"'){if(quoted&&line[i+1]==='"')i++;else quoted=!quoted;}
    }
    const smap={tab:'\t',pipe:'|',semicolon:';',colon:':',comma:',',space:' '};
    let delimiter=overrides.delimiter||smap[String(headers.separator||'').toLowerCase()]||null;
    const data=dataLines.join('\n');
    const countOutside=(ch)=>{let n=0,q=false;for(let i=0;i<data.length;i++){if(data[i]==='"'){if(q&&data[i+1]==='"'){i++;continue;}q=!q;continue;}if(!q&&data[i]===ch)n++;}return n;};
    if(!delimiter){
      const cand=['\t','|',';',':',',',' '].map(ch=>[ch,countOutside(ch)]).sort((x,y)=>y[1]-x[1]);
      delimiter=(cand[0]&&cand[0][1]>0)?cand[0][0]:(String(name||'').toLowerCase().endsWith('.tsv')?'\t':',');
    }
    const rows=[];let row=[],field='',q=false;
    const push=()=>{row.push(field);field='';if(row.some(x=>String(x).length))rows.push(row);row=[];};
    for(let i=0;i<data.length;i++){
      const ch=data[i];
      if(q){if(ch==='"'){if(data[i+1]==='"'){field+='"';i++;}else q=false;}else field+=ch;continue;}
      if(ch==='"'&&field.length===0){q=true;continue;}
      if(ch===delimiter){row.push(field);field='';continue;}
      if(ch==='\n'){push();continue;}
      if(ch!=='\r')field+=ch;
    }
    if(field.length||row.length)push();
    const colRaw=String(headers.columns||'');
    const columns=colRaw?colRaw.split(delimiter).map(s=>s.trim()):[];
    const hcol=(k)=>Math.max(0,Math.floor(Number(headers[k])||0));
    return {kind:'text',headers,rows,columns,delimiter,isHtml:/^(true|1)$/i.test(headers.html||''),source:src,
      globalTags:String(headers.tags||'').split(/\s+/).filter(Boolean),globalDeck:String(headers.deck||''),globalNotetype:String(headers.notetype||''),
      deckColumn:hcol('deck column'),notetypeColumn:hcol('notetype column'),tagsColumn:hcol('tags column'),guidColumn:hcol('guid column')};
  },
  async inspectFile(file){
    const n=String(file&&file.name||'').toLowerCase();
    if(/\.(apkg|colpkg|zip)$/.test(n))return this.inspectPackage(file);
    if(/\.db$/.test(n))return this.inspectMnemosyne(file);
    if(/\.(txt|csv|tsv)$/.test(n))return this.parseText(await file.text(),n);
    return null;
  },
  _phase(type,queue){type=Number(type);queue=Number(queue);if(type===0)return 'new';if(type===1||queue===1||queue===3)return 'learning';if(type===3)return 'relearning';return 'review';},
  _dueDate(crt,due){
    const d=new Date(Number(crt||0)*1000+Number(due||0)*86400000);if(!isFinite(d))return todayCards();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  },
  _shouldUpdate(mode,incomingSec,existingIso){
    mode=String(mode||'if-newer');if(mode==='always')return true;if(mode==='never')return false;
    const old=Date.parse(existingIso||'')/1000;return !Number.isFinite(old)||Number(incomingSec||0)>old;
  },
  _schemaEqual(a,b){
    if(!a||!b||a.kind!==b.kind)return false;
    const af=a.fields||[],bf=b.fields||[],at=a.templates||[],bt=b.templates||[];
    return af.length===bf.length&&at.length===bt.length&&
      af.every((x,i)=>this._sameSchemaItem(x,bf[i],i,i))&&
      at.every((x,i)=>this._sameSchemaItem(x,bt[i],i,i));
  },
  _itemOrd(x,i){
    const v=x&&x.sourceOrd!=null?Number(x.sourceOrd):(x&&x.ord!=null?Number(x.ord):Number(i));
    return Number.isFinite(v)?v:Number(i);
  },
  _sameSchemaItem(a,b,ai,bi){
    const aid=a&&a.id!=null&&Number.isFinite(Number(a.id))?Number(a.id):null;
    const bid=b&&b.id!=null&&Number.isFinite(Number(b.id))?Number(b.id):null;
    if(aid!=null&&bid!=null)return aid===bid;
    const ao=this._itemOrd(a,ai),bo=this._itemOrd(b,bi);
    if(Number.isFinite(ao)&&Number.isFinite(bo))return ao===bo;
    return String(a&&a.name||'').trim().toLowerCase()===String(b&&b.name||'').trim().toLowerCase();
  },
  _identity(x,i){
    if(x&&x.id!=null&&Number.isFinite(Number(x.id)))return 'id:'+Number(x.id);
    return 'ord:'+this._itemOrd(x,i);
  },
  _mergeNotetype(existing,incoming,preferIncoming){
    if(existing.kind!==incoming.kind)throw new Error('Não é possível mesclar tipo Cloze com tipo Normal.');
    const mergeList=(oldList,newList)=>{
      const out=(oldList||[]).map(x=>Object.assign({},x)),incomingMap=[];
      (newList||[]).forEach((x,i)=>{
        const at=out.findIndex((y,j)=>this._sameSchemaItem(y,x,j,i));
        if(at>=0){
          if(preferIncoming)out[at]=Object.assign({},out[at],x,{ord:at});
          incomingMap[i]=at;
        }else{
          const ni=out.length;out.push(Object.assign({},x,{ord:ni}));incomingMap[i]=ni;
        }
      });
      out.forEach((x,i)=>{x.ord=i;});
      return {out,incomingMap};
    };
    const fm=mergeList(existing.fields,incoming.fields),tm=mergeList(existing.templates,incoming.templates);
    const base=preferIncoming?Object.assign({},existing,incoming):Object.assign({},incoming,existing);
    base.id=existing.id;base.ankiId=existing.ankiId||existing.id;base.originalId=existing.originalId||incoming.originalId||incoming.id;
    base.fields=fm.out;base.templates=tm.out;
    const fieldNames=fm.incomingMap.map(i=>base.fields[i]&&base.fields[i].name);
    return {notetype:base,fieldNames,templateOrd:tm.incomingMap};
  },
  _migrateNotesForMergedNotetype(existing,merged){
    const old=existing.fields||[],next=merged.fields||[];
    for(const note of AnkiParity.notes().filter(n=>String(n.notetypeId)===String(existing.id))){
      const fields=Object.assign({},note.fields||{}),nf={};
      next.forEach((f,i)=>{
        const pi=old.findIndex((x,j)=>this._sameSchemaItem(x,f,j,i)),prev=pi>=0?old[pi]:null;
        nf[f.name]=prev&&Object.prototype.hasOwnProperty.call(fields,prev.name)?fields[prev.name]:(Object.prototype.hasOwnProperty.call(fields,f.name)?fields[f.name]:'');
      });
      AnkiParity.saveNote(Object.assign({},note,{fields:nf}));
    }
  },
  _resolveTextNotetype(value,fallbackId){
    const all=AnkiParity.noteTypes(),v=String(value==null?'':value).trim();
    let nt=v?all.find(x=>String(x.id)===v||String(x.ankiId||'')===v||String(x.name||'').toLowerCase()===v.toLowerCase()):null;
    if(!nt&&fallbackId!=null)nt=all.find(x=>String(x.id)===String(fallbackId)||String(x.ankiId||'')===String(fallbackId));
    return nt||AnkiParity.stockNotetype('basic');
  },
  _resolveTextDeck(value,fallbackId){
    const v=String(value==null?'':value).trim(),all=DB.getDecks();
    if(v){
      let d=all.find(x=>String(x.id)===v||String(x.ankiId||'')===v||String(x.nome||'')===v);
      if(!d)d=DB.addDeck(v);
      if(d)return d.id;
    }
    return fallbackId||null;
  },
  _noteDeckIds(noteId){
    return new Set(DB.getCards().filter(c=>String(c.noteId||c.ankiNoteId||'')===String(noteId)).map(c=>String(c.originalDeckId||c.deckId||'')));
  },
  _ensureCardsForTextNote(note,nt,deckId){
    const all=DB.getCards(),existing=all.filter(c=>String(c.noteId||c.ankiNoteId||'')===String(note.id)),made=[];
    const targetDeck=(tmpl)=>{
      if(tmpl&&tmpl.did!=null){
        const hit=DB.getDecks().find(d=>String(d.ankiId||'')===String(tmpl.did)||String(d.id)===String(tmpl.did));
        if(hit)return hit.id;
      }
      return deckId;
    };
    if(nt.kind==='cloze'){
      const ords=new Set();Object.values(note.fields||{}).forEach(v=>AnkiParity.clozeOrdinals(v).forEach(o=>ords.add(o)));
      [...ords].sort((a,b)=>a-b).forEach(o=>{
        let card=existing.find(c=>Number(c.clozeOrd||((c.template||'').match(/^cloze:(\d+)$/)||[])[1])===o);
        if(!card){card=DB.addCard({deckId:targetDeck((nt.templates||[])[0]),noteId:note.id,ankiNoteId:note.id,notetypeId:nt.id,kind:'cloze',template:'cloze:'+o,clozeOrd:o,frente:'',verso:''});made.push(card);}
        const q=AnkiParity.renderTemplate(nt,note,0,'question',card,''),a=AnkiParity.renderTemplate(nt,note,0,'answer',card,q);
        DB.updateCard(card.id,{deckId:card.deckId||targetDeck((nt.templates||[])[0]),noteId:note.id,ankiNoteId:note.id,notetypeId:nt.id,ankiTemplateOrd:o-1,kind:'cloze',template:'cloze:'+o,clozeOrd:o,frente:q,verso:a});
      });
    }else{
      (nt.templates||[]).forEach((tmpl,ord)=>{
        const probe={noteId:note.id,ankiTemplateOrd:ord,deckId:targetDeck(tmpl)},q=AnkiParity.renderTemplate(nt,note,ord,'question',probe,'');
        if(!AnkiParity._fieldNonempty(q))return;
        let card=existing.find(c=>Number(c.ankiTemplateOrd||0)===ord);
        if(!card){card=DB.addCard({deckId:targetDeck(tmpl),noteId:note.id,ankiNoteId:note.id,notetypeId:nt.id,kind:'basic',template:ord===1?'reverse':'forward',frente:'',verso:''});made.push(card);}
        const a=AnkiParity.renderTemplate(nt,note,ord,'answer',card,q);
        DB.updateCard(card.id,{deckId:card.deckId||targetDeck(tmpl),noteId:note.id,ankiNoteId:note.id,notetypeId:nt.id,ankiTemplateOrd:ord,kind:'basic',template:ord===1?'reverse':'forward',frente:q,verso:a});
      });
    }
    return made;
  },
  _clearCanonicalCardEntities(){
    try{
      const p=AnkiParity._planPrefix();
      const keys=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&(k.startsWith(p+'cards-note:')||k.startsWith(p+'cards-notetype:')))keys.push(k);}
      keys.forEach(k=>localStorage.removeItem(k));
      localStorage.removeItem(AnkiParity._presetKey());
      if(typeof CardsConfig!=='undefined'){
        localStorage.removeItem(CardsConfig.PKEY);localStorage.removeItem(CardsConfig.DKEY);
        CardsConfig._c=null;CardsConfig._cKey=null;
      }
    }catch(_){}
  },
  async importCollectionPackage(parsed){
    if(!parsed||parsed.format!=='colpkg')throw new Error('Collection Package inválido');
    DB.saveCards([]);DB.saveDecks([]);DB.replaceRevlog([]);this._clearCanonicalCardEntities();
    if(parsed.meta&&parsed.meta.dconf&&parsed.meta.dconf['1'])CardsConfig.set(this._deckCfg(parsed.meta.dconf['1']));
    return this.importPackage(parsed,{withScheduling:true,withDeckConfigs:true,mergeNotetypes:false,updateNotes:'always',updateNotetypes:'always'});
  },
  async importPackage(parsed,opts){
    opts=opts||{};const SQL=await this._SQL(),db=new SQL.Database(parsed.pkg.collection),meta=parsed.meta;
    const col=this._rows(db,'select crt from col where id=1')[0]||{},deckMap=new Map(),cardMap=new Map(),ntMap=new Map(),ntFieldMaps=new Map(),ntTemplateMaps=new Map(),noteMap=new Map();
    const existingDecks=DB.getDecks().slice();
    for(const d of Object.values(meta.decks||{})){
      if(Number(d.dyn||0))continue;
      let hit=existingDecks.find(x=>Number(x.ankiId)===Number(d.id)||String(x.nome)===String(d.name));
      if(!hit){hit={id:DB._uid(),ankiId:Number(d.id),nome:String(d.name||'Default'),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),configId:String(d.conf||'default')};existingDecks.push(hit);}
      else {hit.ankiId=Number(d.id);hit.nome=String(d.name||hit.nome);hit.configId=String(d.conf||hit.configId||'default');hit.updatedAt=new Date().toISOString();}
      deckMap.set(String(d.id),hit.id);
      if(opts.withDeckConfigs!==false&&meta.dconf&&meta.dconf[String(d.conf)])CardsConfig.setDeckPreset(hit.id,this._deckCfg(meta.dconf[String(d.conf)]));
    }
    DB.saveDecks(existingDecks);

    const currentTypes=AnkiParity.noteTypes();
    for(const m of Object.values(meta.models||{})){
      const incoming=this._toNotetype(m),sourceId=String(m.id);
      let existing=currentTypes.find(x=>Number(x.id)===Number(m.id));
      if(!existing)existing=currentTypes.find(x=>Number(x.originalId)===Number(m.id)&&this._schemaEqual(x,incoming));
      if(existing&&opts.mergeNotetypes!==false){
        const prefer=this._shouldUpdate(opts.updateNotetypes,Number(m.mod)||0,existing.ankiMtime||existing.updatedAt),merged=this._mergeNotetype(existing,incoming,prefer);
        this._migrateNotesForMergedNotetype(existing,merged.notetype);
        AnkiParity.saveNotetype(merged.notetype);ntMap.set(sourceId,existing.id);ntFieldMaps.set(sourceId,merged.fieldNames);ntTemplateMaps.set(sourceId,merged.templateOrd);
      }else if(existing&&this._schemaEqual(existing,incoming)){
        ntMap.set(sourceId,existing.id);
        ntFieldMaps.set(sourceId,(incoming.fields||[]).map((f,i)=>(existing.fields||[])[i]&&existing.fields[i].name||f.name));
        ntTemplateMaps.set(sourceId,(incoming.templates||[]).map((_,i)=>i));
        if(this._shouldUpdate(opts.updateNotetypes,Number(m.mod)||0,existing.ankiMtime||existing.updatedAt)){
          incoming.id=existing.id;incoming.ankiId=existing.ankiId||existing.id;AnkiParity.saveNotetype(Object.assign({},existing,incoming));
        }
      }else{
        let id=Number(m.id);if(existing||currentTypes.some(x=>Number(x.id)===id))id=AnkiParity._allocId();
        incoming.id=id;incoming.ankiId=Number(m.id);incoming.originalId=Number(m.id);AnkiParity.saveNotetype(incoming);currentTypes.push(incoming);
        ntMap.set(sourceId,id);ntFieldMaps.set(sourceId,(incoming.fields||[]).map(f=>f.name));ntTemplateMaps.set(sourceId,(incoming.templates||[]).map((_,i)=>i));
      }
    }

    const existingNotes=AnkiParity.notes(),notes=this._rows(db,'select id,guid,mid,mod,tags,flds from notes');
    for(const n of notes){
      const srcNt=(meta.models||{})[String(n.mid)]||{id:n.mid,name:'Imported',flds:[{name:'Front'},{name:'Back'}],tmpls:[{qfmt:'{{Front}}',afmt:'{{Back}}'}]};
      const localNtid=ntMap.get(String(n.mid))||Number(n.mid),nt=AnkiParity.noteTypes().find(x=>String(x.id)===String(localNtid))||this._toNotetype(srcNt);
      const srcFields=(srcNt.flds||srcNt.fields||[]),vals=String(n.flds||'').split('\x1f'),fields={},mappedNames=ntFieldMaps.get(String(n.mid))||[];
      srcFields.forEach((f,i)=>fields[mappedNames[i]||f.name||('Field '+(i+1))]=this._replaceMedia(vals[i]||'',parsed.pkg.media));
      let existing=existingNotes.find(x=>String(x.guid||'')===String(n.guid||''))||existingNotes.find(x=>Number(x.ankiId||x.id)===Number(n.id));
      if(existing){
        noteMap.set(String(n.id),existing.id);
        if(this._shouldUpdate(opts.updateNotes,Number(n.mod)||0,existing.ankiMtime||existing.updatedAt)){
          const mergedFields=Object.assign({},existing.fields||{});
          for(const f of (nt.fields||[]))if(Object.prototype.hasOwnProperty.call(fields,f.name))mergedFields[f.name]=fields[f.name];
          AnkiParity.saveNote(Object.assign({},existing,{notetypeId:localNtid,fields:mergedFields,tags:String(n.tags||'').trim().split(/\s+/).filter(Boolean),guid:n.guid,ankiId:existing.ankiId||Number(n.id),ankiMtime:new Date(Number(n.mod||0)*1000).toISOString()}));
        }
      }else{
        const note=AnkiParity.saveNote({id:Number(n.id),ankiId:Number(n.id),guid:n.guid,notetypeId:localNtid,fields,tags:String(n.tags||'').trim().split(/\s+/).filter(Boolean),createdAt:new Date(Number(n.id)).toISOString(),ankiMtime:new Date(Number(n.mod||0)*1000).toISOString()});
        existingNotes.push(note);noteMap.set(String(n.id),note.id);
      }
    }

    const cards=this._rows(db,'select id,nid,did,ord,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data,mod from cards');
    for(const ac of cards){
      const localNid=noteMap.get(String(ac.nid))||Number(ac.nid),note=AnkiParity.getNote(localNid);if(!note)continue;
      const nt=AnkiParity.noteTypes().find(x=>String(x.id)===String(note.notetypeId));if(!nt)continue;
      const sourceNote=this._rows(db,'select mid from notes where id=?',[ac.nid])[0]||{},localOrd=(ntTemplateMaps.get(String(sourceNote.mid))||[])[Number(ac.ord)]??Number(ac.ord);
      const stub={clozeOrd:Number(ac.ord)+1,ankiTemplateOrd:localOrd,deckId:deckMap.get(String(ac.did))||opts.deckId||null};
      const front=AnkiParity.renderTemplate(nt,note,localOrd,'question',stub,''),back=AnkiParity.renderTemplate(nt,note,localOrd,'answer',stub,front);
      let c=DB.getCards().find(x=>Number(x.ankiId)===Number(ac.id));
      if(!c)c=DB.addCard({deckId:stub.deckId,noteId:localNid,ankiNoteId:localNid,ankiId:Number(ac.id),kind:nt.kind==='cloze'?'cloze':'basic',template:nt.kind==='cloze'?'cloze:'+(Number(ac.ord)+1):'forward',clozeOrd:nt.kind==='cloze'?Number(ac.ord)+1:null,frente:front,verso:back});
      else DB.updateCard(c.id,{deckId:stub.deckId,noteId:localNid,ankiNoteId:localNid,ankiTemplateOrd:localOrd||0,frente:front,verso:back,kind:nt.kind==='cloze'?'cloze':'basic'});
      const patch={ankiId:Number(ac.id),ankiNoteId:localNid,ankiTemplateOrd:localOrd||0,ankiMod:Number(ac.mod)||0,flag:Math.max(0,Math.min(7,Number(ac.flags)||0))};
      if(opts.withScheduling!==false){
        const data=(()=>{try{return JSON.parse(ac.data||'{}')}catch(_){return {}}})(),phase=this._phase(ac.type,ac.queue);
        Object.assign(patch,{phase,intervalo:Math.max(0,Number(ac.ivl)||0),ease:(Number(ac.factor)||2500)/1000,reps:Number(ac.reps)||0,lapses:Number(ac.lapses)||0,s:data.s==null?null:Number(data.s),d:data.d==null?null:Number(data.d),dueTs:null});
        if(phase==='new')patch.posicaoNova=Number(ac.due)||0;else if(Number(ac.queue)===1||Number(ac.queue)===3)patch.dueTs=Number(ac.due)*1000;else patch.due=this._dueDate(col.crt,ac.due);
        if(Number(ac.queue)===-1)patch.suspenso=true;if(Number(ac.queue)===-2||Number(ac.queue)===-3){patch.enterradoAte=CardEngine.addDays(todayCards(),1);patch.buryKind=Number(ac.queue)===-3?'user':'scheduler';}
      }
      DB.updateCard(c.id,patch);cardMap.set(String(ac.id),c.id);
    }
    if(opts.withScheduling!==false&&this._has(db,'revlog')){
      const old=DB.getRevlog().slice(),known=new Set(old.map(r=>String(r.reviewId||r.id||'')+'|'+String(r.cardId))),rr=this._rows(db,'select id,cid,ease,ivl,lastIvl,factor,time,type from revlog order by id');
      for(const r of rr){const cid=cardMap.get(String(r.cid));if(!cid)continue;const key='anki-'+r.id+'|'+cid;if(known.has(key))continue;known.add(key);old.push({id:'anki-'+r.id,reviewId:'anki-'+r.id,cardId:cid,ts:Number(r.id),date:new Date(Number(r.id)).toISOString().slice(0,10),grade:Number(r.ease),intervalo:Number(r.lastIvl)||0,time:Number(r.time)||0,ankiInterval:Number(r.ivl)||0,ankiReviewKind:Number(r.type)});}
      DB.replaceRevlog(old);
    }
    db.close();AnkiParity.ensureCanonicalNotes();CardEngine.invalidateDueCache();
    return {cards:cards.length,notes:notes.length,decks:deckMap.size};
  },

  importMnemosyne(parsed,opts){
    opts=opts||{};const facts=new Map();for(const r of parsed.facts){if(!facts.has(r.id))facts.set(r.id,{});facts.get(r.id)[r.key]=String(r.value||'');}
    const byFact=new Map();for(const c of parsed.cards){if(!byFact.has(c.fact_id))byFact.set(c.fact_id,[]);byFact.get(c.fact_id).push(c);}
    let n=0;for(const [id,f] of facts){const cs=(byFact.get(id)||[]).sort((a,b)=>String(a.fact_view_id).localeCompare(String(b.fact_view_id))),fv=String(cs[0]&&cs[0].fact_view_id||'1.1');
      let front=f.f||f.text||'',back=f.b||'';front=front.replace(/\r?\n/g,'<br>').replace(/<audio src="([^"]+)">(?:<\/audio>)?/gi,'[sound:$1]');
      back=back.replace(/\r?\n/g,'<br>').replace(/<audio src="([^"]+)">(?:<\/audio>)?/gi,'[sound:$1]');
      const noteId=DB._uid(),base=DB.addCard({deckId:opts.deckId||null,noteId,frente:front,verso:back,kind:fv.startsWith('5.1')?'cloze':'basic'});
      const rows=cs.length?cs:[null];rows.forEach((mc,i)=>{const c=i===0?base:DB.addCard({deckId:opts.deckId||null,noteId,frente:i?back:front,verso:i?front:back,template:i?'reverse':'forward',reversedOf:i?base.id:null});
        if(mc&&Number(mc.last_rep)!==-1)DB.updateCard(c.id,{phase:'review',reps:Number(mc.reps)||0,lapses:Number(mc.lapses)||0,ease:Number(mc.easiness)||2.5,intervalo:Math.max(1,Math.floor((Number(mc.next_rep)-Number(mc.last_rep))/86400)),due:new Date(Number(mc.next_rep)*1000).toISOString().slice(0,10)});n++;});
    }return {cards:n,notes:facts.size};
  },
  importText(parsed,opts){
    opts=opts||{};const rows=parsed.rows||[],html=opts.forceIsHtml?!!opts.isHtml:(parsed.headers&&Object.prototype.hasOwnProperty.call(parsed.headers,'html')?parsed.isHtml:(opts.isHtml!=null?!!opts.isHtml:parsed.isHtml));
    const dupe=String(opts.dupeResolution||'update').toLowerCase(),match=String(opts.matchScope||'notetype').toLowerCase();
    const deckCol=Math.max(0,Number(opts.deckColumn!=null?opts.deckColumn:parsed.deckColumn)||0),ntCol=Math.max(0,Number(opts.notetypeColumn!=null?opts.notetypeColumn:parsed.notetypeColumn)||0);
    const tagsCol=Math.max(0,Number(opts.tagsColumn!=null?opts.tagsColumn:parsed.tagsColumn)||0),guidCol=Math.max(0,Number(opts.guidColumn!=null?opts.guidColumn:parsed.guidColumn)||0);
    const globalNt=this._resolveTextNotetype(opts.notetypeId||parsed.globalNotetype,null),special=new Set([deckCol,ntCol,tagsCol,guidCol].filter(Boolean));
    const regular=(row)=>row.map((_,i)=>i+1).filter(i=>!special.has(i));
    const clean=v=>html?String(v||''):escapeHtml(String(v||'')).replace(/\n/g,'<br>');
    const report={cards:0,notes:0,updated:0,duplicates:0,preserved:0,conflicting:0};
    for(const row of rows){
      const at=n=>n>0?String(row[n-1]||''):'',nt=this._resolveTextNotetype(ntCol?at(ntCol):(opts.notetypeId||parsed.globalNotetype),globalNt.id);
      const deckId=this._resolveTextDeck(deckCol?at(deckCol):parsed.globalDeck,opts.deckId||null);
      const regs=regular(row),fields={},maps=Array.isArray(opts.fieldColumns)?opts.fieldColumns.map(Number):null;
      (nt.fields||[]).forEach((f,i)=>{
        let col=maps&&maps[i]?maps[i]:0;
        if(!col&&parsed.columns&&parsed.columns.length){const hit=parsed.columns.findIndex((x,j)=>!special.has(j+1)&&String(x).trim().toLowerCase()===String(f.name).trim().toLowerCase());if(hit>=0)col=hit+1;}
        if(!col)col=regs[i]||0;fields[f.name]=clean(at(col));
      });
      const firstName=nt.fields&&nt.fields[0]&&nt.fields[0].name,first=String(fields[firstName]||''),guid=at(guidCol).trim();
      let tags=[].concat(parsed.globalTags||[],at(tagsCol).trim().split(/\s+/).filter(Boolean));
      tags=[...new Set(tags.map(String).filter(Boolean))];
      const notes=AnkiParity.notes();
      let existing=guid?notes.find(n=>String(n.guid||'')===guid):null;
      if(!existing&&first){
        existing=notes.find(n=>{
          if(String(n.notetypeId)!==String(nt.id))return false;
          if(String((n.fields||{})[firstName]||'')!==first)return false;
          if(match!=='notetype-and-deck'&&match!=='notetype_deck'&&match!=='deck')return true;
          return this._noteDeckIds(n.id).has(String(deckId||''));
        });
      }
      if(existing){
        if(guid||dupe==='update'){
          const merged=Object.assign({},existing.fields||{},fields);
          const saved=AnkiParity.saveNote(Object.assign({},existing,{notetypeId:nt.id,fields:merged,tags:[...new Set([...(existing.tags||[]),...tags])],guid:guid||existing.guid}));
          this._ensureCardsForTextNote(saved,nt,deckId);report.updated++;continue;
        }
        if(dupe==='preserve'||dupe==='ignore'){report.preserved++;continue;}
        report.duplicates++;
      }
      const id=AnkiParity._allocId(),note=AnkiParity.saveNote({id,ankiId:id,guid:guid||('snm-'+Number(id).toString(36)),notetypeId:nt.id,fields,tags});
      const made=this._ensureCardsForTextNote(note,nt,deckId);report.cards+=made.length;report.notes++;
    }
    CardEngine.invalidateDueCache();return report;
  }

};
try{globalThis.AnkiImport=AnkiImport;}catch(_){}
