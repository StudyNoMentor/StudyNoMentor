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
      mp4:'video/mp4',webm:'video/webm',ogv:'video/ogg',
      css:'text/css',js:'text/javascript',mjs:'text/javascript',json:'application/json',
      woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',
      pdf:'application/pdf'})[e]||'application/octet-stream';
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
  /* Tetos de descompactação: um arquivo-bomba (poucos KB que viram GB) derrubava
     a aba. O teto vale para o que SAI do descompressor, lido em fatias — o
     tamanho declarado no ZIP não é confiável. */
  ZIP_TETO_ENTRADA:512*1024*1024,
  ZIP_TETO_TOTAL:1024*1024*1024,
  async _lerComTeto(stream,teto,nome){
    const reader=stream.getReader(),partes=[];let n=0;
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      n+=value.length;
      if(n>teto){try{await reader.cancel();}catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }throw new Error('Arquivo compactado grande demais'+(nome?' ('+nome+')':'')+': passa de '+Math.round(teto/1048576)+' MB descompactado.');}
      partes.push(value);
    }
    const out=new Uint8Array(n);let o=0;for(const p of partes){out.set(p,o);o+=p.length;}return out;
  },
  async _inflateRaw(bytes,teto,nome){
    if(typeof DecompressionStream==='undefined')throw new Error('Navegador sem suporte a DEFLATE para pacote Anki.');
    const ds=new DecompressionStream('deflate-raw');
    return this._lerComTeto(new Blob([bytes]).stream().pipeThrough(ds),teto||this.ZIP_TETO_ENTRADA,nome);
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
      }catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }
    }
    const mod=await this._loadFzstd();
    if(mod&&typeof mod.decompress==='function')return mod.decompress(bytes);
    throw new Error('Decoder Zstandard local indisponível para pacote Anki atual.');
  },
  async unzip(bytes){
    bytes=this._u8(bytes);const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),eocd=this._findEOCD(bytes);
    if(eocd<0)throw new Error('ZIP/APKG inválido: diretório central ausente');
    const count=dv.getUint16(eocd+10,true),cdOff=dv.getUint32(eocd+16,true),files=new Map();let p=cdOff,total=0;
    for(let i=0;i<count;i++){
      if(dv.getUint32(p,true)!==0x02014b50)throw new Error('ZIP inválido: entrada central');
      const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),usize=dv.getUint32(p+24,true);
      const nlen=dv.getUint16(p+28,true),xlen=dv.getUint16(p+30,true),clen=dv.getUint16(p+32,true),loff=dv.getUint32(p+42,true);
      const name=this._text(bytes.slice(p+46,p+46+nlen));
      if(dv.getUint32(loff,true)!==0x04034b50)throw new Error('ZIP inválido: cabeçalho local');
      const ln=dv.getUint16(loff+26,true),lx=dv.getUint16(loff+28,true),start=loff+30+ln+lx,packed=bytes.slice(start,start+csize);
      const resta=this.ZIP_TETO_TOTAL-total;
      let data;if(method===0)data=packed;else if(method===8)data=await this._inflateRaw(packed,Math.min(this.ZIP_TETO_ENTRADA,resta),name);else throw new Error('ZIP usa método '+method+' não suportado');
      if(usize&&data.length!==usize)throw new Error('ZIP truncado em '+name);
      total+=data.length;if(total>this.ZIP_TETO_TOTAL)throw new Error('Pacote grande demais: passa de '+Math.round(this.ZIP_TETO_TOTAL/1048576)+' MB descompactado.');
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
    if(files.has('meta')){try{const m=this._proto(files.get('meta'));version=this._pNum(m,1,version);}catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }}
    const colName=version===3?'collection.anki21b':(version===2?'collection.anki21':'collection.anki2');
    if(!files.has(colName))throw new Error('Pacote Anki sem '+colName);
    const collection=version===3?await this._zstd(files.get(colName)):files.get(colName);
    let media=new Map();
    if(files.has('media')){
      if(version===3){
        const mapBytes=await this._zstd(files.get('media')),entries=this._mediaEntriesProto(mapBytes);
        for(let i=0;i<entries.length;i++)if(files.has(String(i)))media.set(entries[i].name,await this._zstd(files.get(String(i))));
      }else{
        let map={};try{map=JSON.parse(this._text(files.get('media')))||{};}catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }
        for(const k of Object.keys(map))if(files.has(String(k)))media.set(String(map[k]),files.get(String(k)));
      }
    }
    return {version,collection,media,files};
  },
  async _SQL(){
    if(typeof globalThis.initSqlJs==='function')return globalThis.initSqlJs();
    if(typeof document==='undefined')throw new Error('sql.js requer ambiente de navegador');
    await new Promise((resolve,reject)=>{
      const old=document.querySelector('script[data-snm-sqljs]');
      if(old){
        if(typeof globalThis.initSqlJs==='function'){resolve();return;}
        old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return;
      }
      const s=document.createElement('script');s.src='./src/vendor/sqljs-1.2.1/sql-asm.js';s.dataset.snmSqljs='1';
      s.onload=resolve;s.onerror=()=>reject(new Error('Falha ao carregar sql.js local'));document.head.appendChild(s);
    });
    if(typeof globalThis.initSqlJs!=='function')throw new Error('sql.js local não inicializou');
    return globalThis.initSqlJs();
  },
  _rows(db,sql,params){
    const st=db.prepare(sql);if(params)st.bind(params);const out=[];while(st.step())out.push(st.getAsObject());st.free();return out;
  },
  _has(db,name){
    try{return this._rows(db,"select 1 as x from sqlite_master where type='table' and name=?",[name]).length>0;}catch(_){return false;}
  },
  _replaceMedia(content,media){
    let s=String(content==null?'':content);if(!media||!media.size)return s;
    const cache=new Map(),dataFor=(raw)=>{
      let name=String(raw||'').trim();
      if(/^data:|^https?:|^blob:|^#|^mailto:/i.test(name))return null;
      try{name=decodeURIComponent(name);}catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }
      if(cache.has(name))return cache.get(name);
      const b=media.get(name);if(!b)return null;
      const u='data:'+this._mime(name)+';base64,'+this._b64(b);cache.set(name,u);return u;
    };
    // Qualquer recurso estático do template: img/audio/video/source/script/link,
    // poster e afins. A substituição é pelo NOME presente no media manifest.
    s=s.replace(/\b(src|href|poster)=(["'])([^"']+)\2/gi,(m,attr,q,n)=>{
      const u=dataFor(n);return u?attr+'='+q+u+q:m;
    });
    s=s.replace(/\bsrcset=(["'])([^"']+)\1/gi,(m,q,v)=>{
      const parts=v.split(',').map(x=>{const a=x.trim().split(/\s+/),u=dataFor(a[0]);if(u)a[0]=u;return a.join(' ');});
      return 'srcset='+q+parts.join(', ')+q;
    });
    // CSS de Note Type, inclusive @font-face e background-image.
    s=s.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi,(m,q,n)=>{const u=dataFor(n);return u?'url("'+u+'")':m;});
    s=s.replace(/@import\s+(["'])([^"']+)\1/gi,(m,q,n)=>{const u=dataFor(n);return u?'@import '+q+u+q:m;});
    s=s.replace(/\[sound:([^\]]+)\]/gi,(m,n)=>{const u=dataFor(n);return u?'<audio controls preload="none" src="'+u+'"></audio>':m;});
    return s;
  },
  _materializeNotetype(nt,media){
    nt=Object.assign({},nt||{});
    nt.css=this._replaceMedia(nt.css||'',media);
    nt.latexPre=this._replaceMedia(nt.latexPre||'',media);
    nt.latexPost=this._replaceMedia(nt.latexPost||'',media);
    nt.fields=(nt.fields||[]).map(f=>Object.assign({},f));
    nt.templates=(nt.templates||[]).map(t=>{
      const x=Object.assign({},t);
      for(const k of ['qfmt','afmt','bqfmt','bafmt'])x[k]=this._replaceMedia(x[k]||'',media);
      return x;
    });
    return nt;
  },
  _legacyMetadata(db){
    const c=this._rows(db,'select ver,models,decks,dconf from col where id=1')[0]||{};
    let models={},decks={},dconf={};try{models=JSON.parse(c.models||'{}');}catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }try{decks=JSON.parse(c.decks||'{}');}catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }try{dconf=JSON.parse(c.dconf||'{}');}catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }
    return {ver:Number(c.ver)||11,models,decks,dconf};
  },
  _modernMetadata(db){
    const models={},decks={},dconf={};
    if(this._has(db,'notetypes')){
      for(const r of this._rows(db,'select id,name,config from notetypes')){
        const cm=this._proto(r.config||new Uint8Array()),fields=[],tmpls=[];
        if(this._has(db,'fields'))for(const f of this._rows(db,'select ord,name,config from fields where ntid=? order by ord',[r.id])){
          const x=this._proto(f.config||new Uint8Array());fields.push({name:f.name,ord:Number(f.ord),sticky:!!this._pNum(x,1),rtl:!!this._pNum(x,2),font:this._pStr(x,3,'Arial'),size:this._pNum(x,4,20),description:this._pStr(x,5,''),plainText:!!this._pNum(x,6),collapsed:!!this._pNum(x,7),excludeFromSearch:!!this._pNum(x,8),id:this._pNum(x,9,0)||null,tag:x[10]?this._pNum(x,10,0):null,preventDeletion:!!this._pNum(x,11)});
        }
        if(this._has(db,'templates'))for(const t of this._rows(db,'select ord,name,config from templates where ntid=? order by ord',[r.id])){
          const x=this._proto(t.config||new Uint8Array());tmpls.push({name:t.name,ord:Number(t.ord),qfmt:this._pStr(x,1,''),afmt:this._pStr(x,2,''),bqfmt:this._pStr(x,3,''),bafmt:this._pStr(x,4,''),did:this._pNum(x,5,0)||null,bfont:this._pStr(x,6,''),bsize:this._pNum(x,7,0),id:this._pNum(x,8,0)||null});
        }
        models[String(r.id)]={id:Number(r.id),name:r.name,mod:Number(r.mtime_secs)||0,type:this._pNum(cm,1,0),sortf:this._pNum(cm,2,0),css:this._pStr(cm,3,''),latexPre:this._pStr(cm,5,''),latexPost:this._pStr(cm,6,''),latexsvg:!!this._pNum(cm,7),originalStockKind:this._pNum(cm,9,0),originalId:this._pNum(cm,10,0)||null,flds:fields,tmpls};
      }
    }
    if(this._has(db,'decks'))for(const r of this._rows(db,'select id,name,common,kind from decks')){
      let conf=1,dyn=0,desc='';try{const kc=this._proto(r.kind||new Uint8Array());if(kc[1]&&kc[1][0]){const n=this._proto(kc[1][0].value);conf=this._pNum(n,1,1);desc=this._pStr(n,4,'');}else if(kc[2])dyn=1;}catch(_){ if (typeof _quiet === 'function') _quiet(_, '35-anki-import'); }
      decks[String(r.id)]={id:Number(r.id),name:r.name,conf,dyn,desc};
    }
    if(this._has(db,'deck_config'))for(const r of this._rows(db,'select id,name,config from deck_config')){
      const x=this._proto(r.config||new Uint8Array()),floats=(n)=>(x[n]||[]).filter(f=>f.wire===5).map(f=>new DataView(f.value.buffer,f.value.byteOffset,4).getFloat32(0,true));
      dconf[String(r.id)]={id:Number(r.id),name:r.name,new:{perDay:this._pNum(x,9,20),delays:floats(1)},rev:{perDay:this._pNum(x,10,200)},lapse:{delays:floats(2),leechFails:this._pNum(x,22,8),leechAction:this._pNum(x,21,1)},maxIvl:this._pNum(x,16,36500),fsrsParams6:floats(6),desiredRetention:this._pFloat(x,37,.9),easyDaysPercentages:floats(4),
        disableAutoplay:!!this._pNum(x,23,0),capAnswerTimeToSecs:this._pNum(x,24,60),showTimer:!!this._pNum(x,25,0),
        skipQuestionWhenReplayingAnswer:!!this._pNum(x,26,0),questionAction:this._pNum(x,36,0),stopTimerOnAnswer:!!this._pNum(x,38,0),
        secondsToShowQuestion:this._pFloat(x,41,0),secondsToShowAnswer:this._pFloat(x,42,0),answerAction:this._pNum(x,43,0),waitForAudio:!!this._pNum(x,44,1)};
    }
    return {ver:18,models,decks,dconf};
  },
  _toNotetype(m){
    const fields=(m.flds||m.fields||[]).map((f,i)=>({name:f.name||('Field '+(i+1)),ord:i,sourceOrd:Number.isFinite(Number(f.ord))?Number(f.ord):i,id:f.id==null?null:Number(f.id),sticky:!!f.sticky,rtl:!!f.rtl,fontName:f.font||f.fontName||'Arial',fontSize:Number(f.size||f.fontSize)||20,description:f.description||'',plainText:!!f.plainText,collapsed:!!f.collapsed,excludeFromSearch:!!f.excludeFromSearch,tag:f.tag==null?null:Number(f.tag),preventDeletion:!!f.preventDeletion}));
    const templates=(m.tmpls||m.templates||[]).map((t,i)=>({name:t.name||('Card '+(i+1)),ord:i,sourceOrd:Number.isFinite(Number(t.ord))?Number(t.ord):i,qfmt:t.qfmt||'',afmt:t.afmt||'',bqfmt:t.bqfmt||'',bafmt:t.bafmt||'',did:t.did||null,bfont:t.bfont||'',bsize:Number(t.bsize)||0,id:t.id==null?null:Number(t.id)}));
    return {id:Number(m.id),ankiId:Number(m.id),originalId:m.originalId==null?Number(m.id):Number(m.originalId),name:m.name||'Imported',kind:Number(m.type)===1?'cloze':'normal',sortf:Math.max(0,Number(m.sortf)||0),did:m.did==null?null:Number(m.did),css:m.css||'',fields,templates,latexPre:m.latexPre||'',latexPost:m.latexPost||'',latexsvg:!!m.latexsvg,originalStockKind:Number(m.originalStockKind)||0,updatedAt:m.mod?new Date(Number(m.mod)*1000).toISOString():undefined,ankiMtime:m.mod?new Date(Number(m.mod)*1000).toISOString():undefined};
  },
  _deckCfg(d){
    const w=Array.isArray(d.fsrsParams6)&&d.fsrsParams6.length===21?d.fsrsParams6:null;
    return {newPerDay:Number(d.new&&d.new.perDay)||20,revPerDay:Number(d.rev&&d.rev.perDay)||200,
      learnSteps:Array.isArray(d.new&&d.new.delays)?d.new.delays:[1,10],relearnSteps:Array.isArray(d.lapse&&d.lapse.delays)?d.lapse.delays:[10],
      leechThreshold:Number(d.lapse&&d.lapse.leechFails)||8,leechAction:Number(d.lapse&&d.lapse.leechAction)===0?'suspend':'tag',
      maxInterval:Number(d.maxIvl)||36500,weights:w,retention:Number(d.desiredRetention)||.9,
      easyDays:Array.isArray(d.easyDaysPercentages)&&d.easyDaysPercentages.length===7?d.easyDaysPercentages.map(x=>Number(x)>1?Number(x)/100:Number(x)):undefined,
      disableAutoplay:d.disableAutoplay!=null?!!d.disableAutoplay:(d.autoplay===false),
      capAnswerTimeToSecs:Number(d.capAnswerTimeToSecs!=null?d.capAnswerTimeToSecs:d.maxTaken)||60,
      showTimer:d.showTimer!=null?!!d.showTimer:!!d.timer,
      stopTimerOnAnswer:!!d.stopTimerOnAnswer,
      secondsToShowQuestion:Number(d.secondsToShowQuestion)||0,secondsToShowAnswer:Number(d.secondsToShowAnswer)||0,
      questionAction:Number(d.questionAction)||0,answerAction:Number(d.answerAction)||0,
      waitForAudio:d.waitForAudio!==false,
      skipQuestionWhenReplayingAnswer:!!d.skipQuestionWhenReplayingAnswer};
  },
  _isCollectionPackageName(name){
    const n=String(name||'').toLowerCase().split(/[\\/]/).pop()||'';
    return n.endsWith('.colpkg')||n==='collection.apkg'||(n.startsWith('backup-')&&n.endsWith('.apkg'));
  },
  async inspectPackage(file){
    const pkg=await this._package(file),SQL=await this._SQL(),db=new SQL.Database(pkg.collection);
    const legacy=this._legacyMetadata(db),meta=(Object.keys(legacy.models).length||Object.keys(legacy.decks).length)?legacy:this._modernMetadata(db);
    const counts={notes:this._rows(db,'select count(*) as n from notes')[0].n,cards:this._rows(db,'select count(*) as n from cards')[0].n,revlog:this._has(db,'revlog')?this._rows(db,'select count(*) as n from revlog')[0].n:0};
    db.close();return {kind:'anki-package',file,pkg,meta,counts,format:this._isCollectionPackageName(file&&file.name)?'colpkg':'apkg'};
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
  }
};
