/* ============================================================
   ANKI PACKAGE EXPORT — schema11 importável pelo Anki 26.09.2
   Gera .apkg offline no legado atual do Anki: meta + collection.anki21 + media, sem CDN.
   ============================================================ */
const AnkiExport = {
  SCHEMA11: [
    'CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);',
    'CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);',
    'CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);',
    'CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);',
    'CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);',
    'CREATE INDEX ix_notes_usn ON notes (usn);',
    'CREATE INDEX ix_cards_usn ON cards (usn);',
    'CREATE INDEX ix_revlog_usn ON revlog (usn);',
    'CREATE INDEX ix_cards_nid ON cards (nid);',
    'CREATE INDEX ix_cards_sched ON cards (did, queue, due);',
    'CREATE INDEX ix_revlog_cid ON revlog (cid);',
    'CREATE INDEX ix_notes_csum ON notes (csum);',
    "INSERT INTO col VALUES (1,0,0,0,0,0,0,0,'{}','{}','{}','{}','{}');"
  ].join('\n'),

  _enc: new TextEncoder(),
  _u8(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return this._enc.encode(String(v == null ? '' : v));
  },
  _concat(parts) {
    const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
    let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  },
  _le16(n) { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n >>> 0, true); return a; },
  _le32(n) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n >>> 0, true); return a; },
  _crcTable: null,
  _crc32(bytes) {
    if (!this._crcTable) {
      this._crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        this._crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (const b of bytes) c = this._crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  },
  _dos(d) {
    d = d || new Date();
    const year = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) | 0),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  },
  zipStore(entries) {
    const locals = [], centrals = [], stamp = this._dos(new Date());
    let offset = 0;
    for (const e of entries) {
      const name = this._u8(e.name), data = this._u8(e.data), crc = this._crc32(data), flags = 0x800;
      const local = this._concat([
        this._le32(0x04034b50), this._le16(20), this._le16(flags), this._le16(0),
        this._le16(stamp.time), this._le16(stamp.date), this._le32(crc),
        this._le32(data.length), this._le32(data.length), this._le16(name.length), this._le16(0), name, data
      ]);
      const central = this._concat([
        this._le32(0x02014b50), this._le16(20), this._le16(20), this._le16(flags), this._le16(0),
        this._le16(stamp.time), this._le16(stamp.date), this._le32(crc),
        this._le32(data.length), this._le32(data.length), this._le16(name.length), this._le16(0),
        this._le16(0), this._le16(0), this._le16(0), this._le32(0), this._le32(offset), name
      ]);
      locals.push(local); centrals.push(central); offset += local.length;
    }
    const central = this._concat(centrals);
    const end = this._concat([
      this._le32(0x06054b50), this._le16(0), this._le16(0), this._le16(entries.length),
      this._le16(entries.length), this._le32(central.length), this._le32(offset), this._le16(0)
    ]);
    return this._concat(locals.concat([central, end]));
  },

  _varint(n) {
    let x = BigInt(Math.max(0, Number(n) || 0)), out = [];
    do { let b = Number(x & 0x7fn); x >>= 7n; if (x) b |= 0x80; out.push(b); } while (x);
    return Uint8Array.from(out);
  },
  _pbBytes(field, data) {
    data = this._u8(data);
    return this._concat([this._varint((Number(field) << 3) | 2), this._varint(data.length), data]);
  },
  _pbU32(field, n) {
    return this._concat([this._varint((Number(field) << 3) | 0), this._varint(Number(n) >>> 0)]);
  },
  _pbVar(field, n) {
    return this._concat([this._varint((Number(field) << 3) | 0), this._varint(n)]);
  },
  _pbFloat(field, n) {
    const a=new Uint8Array(4);new DataView(a.buffer).setFloat32(0,Number(n)||0,true);
    return this._concat([this._varint((Number(field)<<3)|5),a]);
  },
  _pbString(field, v) {
    return this._pbBytes(field,this._enc.encode(String(v==null?'':v)));
  },
  _pbBool(field, v) {
    return this._pbU32(field,v?1:0);
  },
  _sha1Bytes(input) {
    const bytes = this._u8(input), ml = bytes.length * 8;
    const total = ((bytes.length + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
    buf.set(bytes); buf[bytes.length] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, ml >>> 0, false);
    dv.setUint32(total - 8, Math.floor(ml / 0x100000000), false);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80), rol = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let ff, k;
        if (i < 20) { ff = (b & c) | ((~b) & d); k = 0x5a827999; }
        else if (i < 40) { ff = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { ff = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { ff = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (rol(a, 5) + ff + e + k + w[i]) >>> 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    const out = new Uint8Array(20), odv = new DataView(out.buffer);
    [h0,h1,h2,h3,h4].forEach((v,i)=>odv.setUint32(i*4,v,false));
    return out;
  },
  // Encoder Zstandard mínimo e válido: frame single-segment + blocos RAW.
  // O Anki aceita qualquer frame Zstd válido; não é necessário comprimir para
  // obter interoperabilidade, e assim evitamos CDN/WASM/codec externo.
  _zstdStore(input) {
    const data = this._u8(input), n = data.length, head = [0x28,0xb5,0x2f,0xfd];
    if (n < 256) head.push(0x20, n);
    else if (n < 65792) { const v=n-256; head.push(0x60, v&255, (v>>>8)&255); }
    else { head.push(0xa0, n&255, (n>>>8)&255, (n>>>16)&255, (n>>>24)&255); }
    const blocks=[], MAX=128*1024;
    if (!n) blocks.push(Uint8Array.from([1,0,0]));
    for (let off=0; off<n; off+=MAX) {
      const size=Math.min(MAX,n-off), last=(off+size>=n)?1:0, bh=(size<<3)|last;
      blocks.push(this._concat([Uint8Array.from([bh&255,(bh>>>8)&255,(bh>>>16)&255]),data.slice(off,off+size)]));
    }
    return this._concat([Uint8Array.from(head),...blocks]);
  },
  _mediaEntriesProto(items) {
    const rows=(items||[]).map(m=>{
      const body=this._concat([
        this._pbBytes(1,this._enc.encode(String(m.name||''))),
        this._pbU32(2,(m.bytes||[]).length),
        this._pbBytes(3,this._sha1Bytes(m.bytes||new Uint8Array()))
      ]);
      return this._pbBytes(1,body);
    });
    return this._concat(rows);
  },
  _tsvField(v) {
    let x=String(v==null?'':v).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    return /["\t\n]/.test(x) ? '"'+x.replace(/"/g,'""')+'"' : x;
  },

  _base64Bytes(s) {
    if (typeof atob === 'function') {
      const bin = atob(String(s).replace(/\s+/g, '')), out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(s), 'base64'));
    throw new Error('Decodificador base64 indisponível');
  },
  _mediaExt(mime) {
    const m=String(mime||'').toLowerCase().split(';')[0].trim();
    return ({
      'image/png':'png','image/jpeg':'jpg','image/jpg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp','image/svg+xml':'svg',
      'audio/mpeg':'mp3','audio/mp3':'mp3','audio/ogg':'ogg','audio/wav':'wav','audio/x-wav':'wav','audio/mp4':'m4a','audio/aac':'aac','audio/flac':'flac',
      'video/mp4':'mp4','video/webm':'webm','video/ogg':'ogv',
      'text/css':'css','text/javascript':'js','application/javascript':'js','application/json':'json',
      'font/woff':'woff','font/woff2':'woff2','font/ttf':'ttf','font/otf':'otf','application/pdf':'pdf'
    })[m] || ((m.split('/')[1]||'bin').replace(/[^a-z0-9.+-]/g,'').replace(/^x-/,'')||'bin');
  },
  _storeMedia(bytes, mime, media) {
    bytes=this._u8(bytes);
    const ext=this._mediaExt(mime),key=this._crc32(bytes).toString(16).padStart(8,'0')+'-'+bytes.length;
    let item=media.byKey.get(key);
    if(!item){
      item={name:'studynomentor_'+key+'.'+ext,bytes,mime:String(mime||'application/octet-stream')};
      media.byKey.set(key,item);media.items.push(item);
    }
    return item;
  },
  extractMedia(content, media) {
    let src=String(content||'');
    const store=(mime,b64)=>{
      try{return this._storeMedia(this._base64Bytes(b64),mime,media).name;}catch(_){return null;}
    };
    // Atributos de qualquer tag: img/audio/video/source/script/link/poster etc.
    src=src.replace(/\b(src|href|poster)=(["'])data:([^;,"']+)(?:;charset=[^;,"']+)?;base64,([^"']+)\2/gi,
      (m,attr,q,mime,b64)=>{const name=store(mime,b64);return name?attr+'='+q+name+q:m;});
    src=src.replace(/url\(\s*(["']?)data:([^;,)"']+)(?:;charset=[^;,)"']+)?;base64,([^)"']+)\1\s*\)/gi,
      (m,q,mime,b64)=>{const name=store(mime,b64);return name?'url("'+name+'")':m;});
    src=src.replace(/@import\s+(["'])data:([^;,"']+)(?:;charset=[^;,"']+)?;base64,([^"']+)\1/gi,
      (m,q,mime,b64)=>{const name=store(mime,b64);return name?'@import '+q+name+q:m;});
    return src;
  },

  _sha1First32(text) {
    const bytes = this._enc.encode(String(text || '')), ml = bytes.length * 8;
    const total = ((bytes.length + 9 + 63) >> 6) << 6, buf = new Uint8Array(total);
    buf.set(bytes); buf[bytes.length] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, ml >>> 0, false);
    dv.setUint32(total - 8, Math.floor(ml / 0x100000000), false);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Uint32Array(80), rol = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
      for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | ((~b) & d); k = 0x5a827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
        else { f = b ^ c ^ d; k = 0xca62c1d6; }
        const t = (rol(a, 5) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return h0 >>> 0;
  },
  _plain(html) {
    return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  },
  _mod(v) {
    const ms = Date.parse(v || '');
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
  },
  _dayMs(iso) {
    const s = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
    const a = s.split('-').map(Number);
    return new Date(a[0], a[1] - 1, a[2]).getTime();
  },
  _collectionEpoch(cards) {
    try { const crt = CardsConfig.get().ankiCrt; if (crt) return crt; } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'anki-crt'); }
    let min = Date.now();
    for (const c of cards || []) for (const v of [c.createdAt, c.due, c.originalDue]) {
      const ms = this._dayMs(v); if (Number.isFinite(ms)) min = Math.min(min, ms);
    }
    const d = new Date(min); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 1);
    return Math.floor(d.getTime() / 1000);
  },
  _dueDay(iso, crtSec) {
    const ms = this._dayMs(iso);
    if (!Number.isFinite(ms)) return Math.max(0, Math.floor((Date.now() / 1000 - crtSec) / 86400));
    return Math.max(0, Math.round((ms - crtSec * 1000) / 86400000));
  },
  _round(v, p) {
    const n = Number(v); if (!Number.isFinite(n)) return null;
    const f = 10 ** p; return Math.round(n * f) / f;
  },
  cardData(card, cfg) {
    const out = {};
    if ((card.phase || 'new') === 'new' && Number.isFinite(Number(card.posicaoNova))) out.pos = Math.max(0, Math.round(Number(card.posicaoNova)));
    if (card.s != null) out.s = this._round(card.s, 4);
    if (card.d != null) out.d = this._round(card.d, 3);
    if (cfg && cfg.retention != null) out.dr = this._round(cfg.retention, 2);
    const lr = card.lastReview ? this._dayMs(card.lastReview) : NaN;
    if (Number.isFinite(lr)) out.lrt = Math.floor(lr / 1000);
    return JSON.stringify(out);
  },
  _homeState(card) {
    if (!card || !card.originalDeckId) return card;
    return Object.assign({}, card, {
      deckId: card.originalDeckId,
      due: card.originalDue || card.due,
      dueTs: card.originalDueTs == null ? null : card.originalDueTs,
      phase: card.originalPhase || card.phase
    });
  },
  cardSchedule(card, crtSec, newPos) {
    const c = this._homeState(card), phase = String(c.phase || 'new');
    let type = 0, queue = 0;
    let due = Number.isFinite(Number(c.posicaoNova)) ? Math.max(0, Math.round(Number(c.posicaoNova))) : Math.max(1, newPos);
    const dueTs = c.dueTs != null ? Number(c.dueTs) : (c.dueTsAntesEnterrar != null ? Number(c.dueTsAntesEnterrar) : NaN);
    if (phase === 'learning') {
      type = 1; queue = Number.isFinite(dueTs) ? 1 : 3;
      due = Number.isFinite(dueTs) ? Math.floor(dueTs / 1000) : this._dueDay(c.due, crtSec);
    } else if (phase === 'review') {
      type = 2; queue = 2; due = this._dueDay(c.due, crtSec);
    } else if (phase === 'relearning') {
      type = 3; queue = Number.isFinite(dueTs) ? 1 : 3;
      due = Number.isFinite(dueTs) ? Math.floor(dueTs / 1000) : this._dueDay(c.due, crtSec);
    }
    if (c.suspenso) queue = -1;
    else if (c.enterradoAte && String(c.enterradoAte) >= String(todayCards())) {
      // CardQueue moderno: SchedBuried=-2, UserBuried=-3.
      queue = c.buryKind === 'user' ? -3 : -2;
    }
    const cfg = CardsConfig.forDeck(c.deckId);
    const steps = phase === 'relearning' ? (cfg.relearnSteps || []) : (cfg.learnSteps || []);
    const left = (phase === 'learning' || phase === 'relearning') ? Math.max(0, steps.length - (Number(c.learnStep) || 0)) * 1000 : 0;
    return { type, queue, due, left };
  },

  _fieldSchema(f, i) {
    return {
      name: String(f && f.name || ('Field ' + (i + 1))), ord: i, sticky: !!(f && f.sticky), rtl: !!(f && f.rtl),
      font: String(f && (f.fontName || f.font) || 'Arial'), size: Math.max(1, Number(f && (f.fontSize || f.size)) || 20),
      description: String(f && f.description || ''), plainText: !!(f && f.plainText), collapsed: !!(f && f.collapsed),
      excludeFromSearch: !!(f && f.excludeFromSearch), id: f && f.id != null ? Number(f.id) : null,
      tag: f && f.tag != null ? Number(f.tag) : null, preventDeletion: !!(f && f.preventDeletion)
    };
  },
  _templateSchema(t, i) {
    return {
      name: String(t && t.name || ('Card ' + (i + 1))), ord: i, qfmt: String(t && t.qfmt || ''),
      afmt: String(t && t.afmt || ''), bqfmt: String(t && t.bqfmt || ''), bafmt: String(t && t.bafmt || ''),
      did: t && t.did != null && t.did !== '' ? Number(t.did) : null, bfont: String(t && t.bfont || ''), bsize: Number(t && t.bsize) || 0, id: t && t.id != null ? Number(t.id) : null
    };
  },
  _reqFor(nt) {
    if (nt.kind === 'cloze') return [[0, 'any', [0]]];
    const names = (nt.fields || []).map(f => String(f.name || '')), out = [];
    (nt.templates || []).forEach((t, i) => {
      const q = String(t.qfmt || ''), ords = [];
      names.forEach((name, j) => {
        const esc = name.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
        if (new RegExp('\\{\\{(?:[#^]|type:)?' + esc + '\\}\\}', 'i').test(q)) ords.push(j);
      });
      out.push([i, 'any', ords.length ? ords : [0]]);
    });
    return out;
  },
  modelSchema(nt) {
    const id = Number(nt.ankiId || nt.id), fields = nt.fields || [], tmpls = nt.templates || [];
    return {
      id, name: String(nt.name || 'Note Type'), type: nt.kind === 'cloze' ? 1 : 0,
      mod: this._mod(nt.updatedAt || nt.createdAt), usn: -1, sortf: Math.max(0, Number(nt.sortf) || 0),
      did: nt.did != null && nt.did !== '' ? Number(nt.did) : null,
      tmpls: tmpls.map((t, i) => this._templateSchema(t, i)),
      flds: fields.map((f, i) => this._fieldSchema(f, i)),
      css: String(nt.css || '.card { font-family: arial; font-size: 20px; text-align: center; }'),
      latexPre: String(nt.latexPre || ''), latexPost: String(nt.latexPost || ''), latexsvg: !!nt.latexsvg,
      req: this._reqFor(nt), originalStockKind: Number(nt.originalStockKind) || 0,
      originalId: nt.originalId == null ? null : Number(nt.originalId)
    };
  },

  _reviewOrder(v) {
    return ({ day:0, dayThenDeck:1, deckThenDay:2, intervalsAsc:3, intervalsDesc:4, easeAsc:5, easeDesc:6,
      retrievabilityAsc:7, random:8, added:9, reverseAdded:10, retrievabilityDesc:11, relativeOverdueness:12 })[v] ?? 0;
  },
  _mix(v) { return v === 'depois' ? 1 : (v === 'antes' ? 2 : 0); },
  _gather(v) {
    return ({deck:0,posicao:1,posicaoDesc:2,randomNotes:3,randomCards:4,deckRandomNotes:5})[v] ?? 0;
  },
  _sortNew(v) {
    return ({template:0,coleta:1,templateRandom:2,randomNoteTemplate:3,randomCard:4})[v] ?? 0;
  },
  deckConfigSchema(id, name, cfg) {
    const weights = (typeof FSRS !== 'undefined' && FSRS.migrarW) ? (FSRS.migrarW(cfg.weights) || FSRS.DEFAULT_W) : (cfg.weights || []);
    return {
      id, mod: Math.floor(Date.now() / 1000), name: String(name || 'Default'), usn: -1,
      maxTaken: Math.max(0,Math.round(Number(cfg.capAnswerTimeToSecs)||60)),
      autoplay: !cfg.disableAutoplay, timer: cfg.showTimer?1:0, replayq: !cfg.skipQuestionWhenReplayingAnswer,
      new: {
        bury: !!cfg.buryNew, delays: (cfg.learnSteps || []).map(Number), initialFactor: Math.round((Number(cfg.initialEase) || 2.5) * 1000),
        ints: [Number(cfg.graduatingIntervalGood) || 1, Number(cfg.graduatingIntervalEasy) || 4, 0],
        order: cfg.newInsertOrder === 'aleatoria' ? 1 : 0, perDay: Math.max(0, Math.round(Number(cfg.newPerDay) || 0))
      },
      rev: {
        bury: !!cfg.buryReviews, ease4: Number(cfg.easyMultiplier) || 1.3, ivlFct: Number(cfg.intervalMultiplier) || 1,
        maxIvl: Math.max(1, Math.round(Number(cfg.maxInterval) || 36500)), perDay: Math.max(0, Math.round(Number(cfg.revPerDay) || 0)),
        hardFactor: Number(cfg.hardMultiplier) || 1.2
      },
      lapse: {
        delays: (cfg.relearnSteps || []).map(Number), leechAction: cfg.leechAction === 'suspend' ? 0 : 1,
        leechFails: Math.max(0, Math.round(Number(cfg.leechThreshold) || 0)), minInt: Math.max(1, Math.round(Number(cfg.minimumLapseInterval) || 1)),
        mult: Number(cfg.lapseMultiplier) || 0
      },
      dyn: false, newMix: this._mix(cfg.newMix), newPerDayMinimum: Math.max(0, Math.round(Number(cfg.newPerDayMinimum) || 0)),
      interdayLearningMix: this._mix(cfg.interdayMix), reviewOrder: this._reviewOrder(cfg.reviewOrder),
      newSortOrder: this._sortNew(cfg.newSortOrder), newGatherPriority: this._gather(cfg.newGatherOrder),
      buryInterdayLearning: !!cfg.buryInterdayLearning, fsrsWeights: [], fsrsParams5: [], fsrsParams6: Array.from(weights || [], Number),
      desiredRetention: Number(cfg.retention) || 0.9, ignoreRevlogsBeforeDate: String(cfg.ignoreRevlogsBefore || ''),
      easyDaysPercentages: (cfg.easyDays || []).map(x => Number(x) * 100),
      disableAutoplay: !!cfg.disableAutoplay,
      capAnswerTimeToSecs: Math.max(0,Math.round(Number(cfg.capAnswerTimeToSecs)||60)),
      showTimer: !!cfg.showTimer,
      stopTimerOnAnswer: !!cfg.stopTimerOnAnswer,
      secondsToShowQuestion: Math.max(0,Number(cfg.secondsToShowQuestion)||0),
      secondsToShowAnswer: Math.max(0,Number(cfg.secondsToShowAnswer)||0),
      questionAction: Math.max(0,Math.min(1,Math.round(Number(cfg.questionAction)||0))),
      answerAction: Math.max(0,Math.min(4,Math.round(Number(cfg.answerAction)||0))),
      waitForAudio: cfg.waitForAudio!==false,
      skipQuestionWhenReplayingAnswer: !!cfg.skipQuestionWhenReplayingAnswer,
      sm2Retention: Number(cfg.historicalRetention) || 0.9, weightSearch: String(cfg.paramSearch || '')
    };
  },
  _presetMap(decks) {
    const shared = (typeof AnkiParity !== 'undefined' && AnkiParity.sharedPresets) ? AnkiParity.sharedPresets() : {};
    const keys = new Map([['default', 1]]), used = new Set([1]); let seq = 1800000000000;
    const keyFor = d => String(d && d.configId || ((CardsConfig.hasDeckPreset && CardsConfig.hasDeckPreset(d.id)) ? 'legacy:' + d.id : 'default'));
    for (const d of decks) {
      const k = keyFor(d); if (keys.has(k)) continue;
      let n = /^\d+$/.test(k) ? Number(k) : 0;
      if (!Number.isSafeInteger(n) || n <= 0 || used.has(n)) { while (used.has(seq)) seq++; n = seq++; }
      keys.set(k, n); used.add(n);
    }
    const configs = { '1': this.deckConfigSchema(1, 'Default', CardsConfig.get()) };
    for (const pair of keys) {
      const k = pair[0], id = pair[1]; if (k === 'default') continue;
      const d = decks.find(x => keyFor(x) === k), cfg = d ? CardsConfig.forDeck(d.id) : CardsConfig.get();
      const name = (shared[k] && shared[k].name) || (d && d.nome) || 'Preset';
      configs[String(id)] = this.deckConfigSchema(id, name, cfg);
    }
    return { keys, configs, keyFor };
  },
  _deckJson(decks, options) {
    options=Object.assign({withScheduling:true,withDeckConfigs:true},options||{});
    const p=this._presetMap(decks),obj={};
    obj['1']={
      id:1,mod:Math.floor(Date.now()/1000),name:'Default',usn:-1,
      lrnToday:[0,0],revToday:[0,0],newToday:[0,0],timeToday:[0,0],
      collapsed:false,browserCollapsed:false,desc:'',dyn:0,conf:1,extendNew:0,extendRev:0
    };
    for(const d of decks){
      const id=Number(d.ankiId),cfg=CardsConfig.forDeck(d.id);
      const cfgId=options.withDeckConfigs?(p.keys.get(p.keyFor(d))||1):1;
      obj[String(id)]={
        id,mod:this._mod(d.updatedAt||d.createdAt),name:String(d.nome||'Deck'),usn:-1,
        lrnToday:[0,0],revToday:[0,0],newToday:[0,0],timeToday:[0,0],
        collapsed:!!d.collapsed,browserCollapsed:!!d.browserCollapsed,desc:String(d.desc||''),
        dyn:0,conf:cfgId,extendNew:0,extendRev:0,desiredRetention:Math.round((Number(cfg.retention)||.9)*100)
      };
    }
    let dconf;
    if(!options.withDeckConfigs){
      dconf={'1':this.deckConfigSchema(1,'Default',CardsConfig.get())};
    }else{
      dconf=structuredClone(p.configs);
      if(!options.withScheduling){
        // O Anki remove parâmetros FSRS ao exportar presets sem agendamento.
        for(const c of Object.values(dconf)){c.fsrsWeights=[];c.fsrsParams5=[];c.fsrsParams6=[];}
      }
    }
    return {decks:obj,dconf};
  },
  _deckIdMap(decks) { const m = new Map(); for (const d of decks) m.set(String(d.id), Number(d.ankiId)); return m; },

  _encodeNotetypeConfig(m) {
    const parts=[
      this._pbU32(1,Number(m.type)||0),
      this._pbU32(2,Number(m.sortf)||0),
      this._pbString(3,m.css||''),
      this._pbString(5,m.latexPre||''),
      this._pbString(6,m.latexPost||''),
      this._pbBool(7,!!m.latexsvg)
    ];
    const kind={none:0,any:1,all:2};
    for(const r of (m.req||[])){
      const body=[this._pbU32(1,Number(r[0])||0),this._pbU32(2,kind[String(r[1]||'any')]??1)];
      for(const o of (r[2]||[]))body.push(this._pbU32(3,Number(o)||0));
      parts.push(this._pbBytes(8,this._concat(body)));
    }
    if(Number(m.originalStockKind))parts.push(this._pbU32(9,Number(m.originalStockKind)));
    if(m.originalId!=null)parts.push(this._pbVar(10,Number(m.originalId)));
    return this._concat(parts);
  },
  _encodeFieldConfig(f) {
    const p=[
      this._pbBool(1,!!f.sticky),this._pbBool(2,!!f.rtl),this._pbString(3,f.font||'Arial'),
      this._pbU32(4,Number(f.size)||20),this._pbString(5,f.description||''),
      this._pbBool(6,!!f.plainText),this._pbBool(7,!!f.collapsed),this._pbBool(8,!!f.excludeFromSearch)
    ];
    if(f.id!=null)p.push(this._pbVar(9,Number(f.id)));
    if(f.tag!=null)p.push(this._pbU32(10,Number(f.tag)));
    if(f.preventDeletion)p.push(this._pbBool(11,true));
    return this._concat(p);
  },
  _encodeTemplateConfig(t) {
    const p=[
      this._pbString(1,t.qfmt||''),this._pbString(2,t.afmt||''),
      this._pbString(3,t.bqfmt||''),this._pbString(4,t.bafmt||'')
    ];
    if(t.did!=null)p.push(this._pbVar(5,Number(t.did)));
    if(t.bfont)p.push(this._pbString(6,t.bfont));
    if(Number(t.bsize))p.push(this._pbU32(7,Number(t.bsize)));
    if(t.id!=null)p.push(this._pbVar(8,Number(t.id)));
    return this._concat(p);
  },
  _encodeDeckCommon(d) {
    const p=[];
    if(d.collapsed)p.push(this._pbBool(1,true));
    if(d.browserCollapsed)p.push(this._pbBool(2,true));
    return this._concat(p);
  },
  _encodeDeckKind(d) {
    const normal=[
      this._pbVar(1,Number(d.conf)||1),
      this._pbU32(2,Number(d.extendNew)||0),
      this._pbU32(3,Number(d.extendRev)||0),
      this._pbString(4,d.desc||'')
    ];
    const dr=Number(d.desiredRetention);
    if(Number.isFinite(dr)&&dr>0)normal.push(this._pbFloat(10,dr>1?dr/100:dr));
    return this._pbBytes(1,this._concat(normal));
  },
  _encodeDeckConfig(c) {
    const p=[],pushFloatList=(field,xs)=>{for(const x of (xs||[]))p.push(this._pbFloat(field,Number(x)||0));};
    pushFloatList(1,c.new&&c.new.delays);
    pushFloatList(2,c.lapse&&c.lapse.delays);
    pushFloatList(4,c.easyDaysPercentages);
    pushFloatList(6,c.fsrsParams6);
    p.push(this._pbU32(9,Number(c.new&&c.new.perDay)||0));
    p.push(this._pbU32(10,Number(c.rev&&c.rev.perDay)||0));
    p.push(this._pbFloat(11,(Number(c.new&&c.new.initialFactor)||2500)/1000));
    p.push(this._pbFloat(12,Number(c.rev&&c.rev.ease4)||1.3));
    p.push(this._pbFloat(13,Number(c.rev&&c.rev.hardFactor)||1.2));
    p.push(this._pbFloat(14,Number(c.lapse&&c.lapse.mult)||0));
    p.push(this._pbFloat(15,Number(c.rev&&c.rev.ivlFct)||1));
    p.push(this._pbU32(16,Number(c.rev&&c.rev.maxIvl)||36500));
    p.push(this._pbU32(17,Number(c.lapse&&c.lapse.minInt)||1));
    const ints=(c.new&&c.new.ints)||[];
    p.push(this._pbU32(18,Number(ints[0])||1));
    p.push(this._pbU32(19,Number(ints[1])||4));
    p.push(this._pbU32(20,Number(c.new&&c.new.order)||0));
    p.push(this._pbU32(21,Number(c.lapse&&c.lapse.leechAction)||0));
    p.push(this._pbU32(22,Number(c.lapse&&c.lapse.leechFails)||8));
    p.push(this._pbBool(23,!!c.disableAutoplay));
    p.push(this._pbU32(24,Math.max(0,Math.round(Number(c.capAnswerTimeToSecs)||60))));
    p.push(this._pbBool(25,!!c.showTimer));
    p.push(this._pbBool(26,!!c.skipQuestionWhenReplayingAnswer));
    p.push(this._pbBool(27,!!(c.new&&c.new.bury)));
    p.push(this._pbBool(28,!!(c.rev&&c.rev.bury)));
    p.push(this._pbBool(29,!!c.buryInterdayLearning));
    p.push(this._pbU32(30,Number(c.newMix)||0));
    p.push(this._pbU32(31,Number(c.interdayLearningMix)||0));
    p.push(this._pbU32(32,Number(c.newSortOrder)||0));
    p.push(this._pbU32(33,Number(c.reviewOrder)||0));
    p.push(this._pbU32(34,Number(c.newGatherPriority)||0));
    p.push(this._pbU32(35,Number(c.newPerDayMinimum)||0));
    p.push(this._pbU32(36,Number(c.questionAction)||0));
    p.push(this._pbFloat(37,Number(c.desiredRetention)||.9));
    p.push(this._pbBool(38,!!c.stopTimerOnAnswer));
    p.push(this._pbFloat(40,Number(c.sm2Retention)||.9));
    p.push(this._pbFloat(41,Number(c.secondsToShowQuestion)||0));
    p.push(this._pbFloat(42,Number(c.secondsToShowAnswer)||0));
    p.push(this._pbU32(43,Number(c.answerAction)||0));
    p.push(this._pbBool(44,c.waitForAudio!==false));
    if(c.weightSearch)p.push(this._pbString(45,c.weightSearch));
    if(c.ignoreRevlogsBeforeDate)p.push(this._pbString(46,c.ignoreRevlogsBeforeDate));
    return this._concat(p);
  },
  _upgradeToSchema18(db, models, dj) {
    const ddl=[
      'CREATE TABLE deck_config (id integer PRIMARY KEY NOT NULL,name text NOT NULL,mtime_secs integer NOT NULL,usn integer NOT NULL,config blob NOT NULL);',
      'CREATE TABLE config (key text NOT NULL PRIMARY KEY,usn integer NOT NULL,mtime_secs integer NOT NULL,val blob NOT NULL) WITHOUT ROWID;',
      'CREATE TABLE tags (tag text NOT NULL PRIMARY KEY,usn integer NOT NULL) WITHOUT ROWID;',
      'CREATE TABLE fields (ntid integer NOT NULL,ord integer NOT NULL,name text NOT NULL,config blob NOT NULL,PRIMARY KEY (ntid,ord)) WITHOUT ROWID;',
      'CREATE UNIQUE INDEX idx_fields_name_ntid ON fields (name,ntid);',
      'CREATE TABLE templates (ntid integer NOT NULL,ord integer NOT NULL,name text NOT NULL,mtime_secs integer NOT NULL,usn integer NOT NULL,config blob NOT NULL,PRIMARY KEY (ntid,ord)) WITHOUT ROWID;',
      'CREATE UNIQUE INDEX idx_templates_name_ntid ON templates (name,ntid);',
      'CREATE INDEX idx_templates_usn ON templates (usn);',
      'CREATE TABLE notetypes (id integer NOT NULL PRIMARY KEY,name text NOT NULL,mtime_secs integer NOT NULL,usn integer NOT NULL,config blob NOT NULL);',
      'CREATE UNIQUE INDEX idx_notetypes_name ON notetypes (name);',
      'CREATE INDEX idx_notetypes_usn ON notetypes (usn);',
      'CREATE TABLE decks (id integer PRIMARY KEY NOT NULL,name text NOT NULL,mtime_secs integer NOT NULL,usn integer NOT NULL,common blob NOT NULL,kind blob NOT NULL);',
      'CREATE UNIQUE INDEX idx_decks_name ON decks (name);',
      'CREATE INDEX idx_notes_mid ON notes (mid);',
      'CREATE INDEX idx_cards_odid ON cards (odid) WHERE odid != 0;',
      // A coleção nasce nova: graves está vazia. Recriá-la diretamente evita
      // ALTER TABLE RENAME, que quebra no sql.js 1.2.1 asm vendorado.
      'DROP TABLE graves;',
      'CREATE TABLE graves (oid integer NOT NULL,type integer NOT NULL,usn integer NOT NULL,PRIMARY KEY (oid,type)) WITHOUT ROWID;',
      'CREATE INDEX idx_graves_pending ON graves (usn);'
    ];
    ddl.forEach(sql=>db.run(sql));

    const nt=db.prepare('INSERT INTO notetypes VALUES (?,?,?,?,?)');
    const fld=db.prepare('INSERT INTO fields VALUES (?,?,?,?)');
    const tmpl=db.prepare('INSERT INTO templates VALUES (?,?,?,?,?,?)');
    for(const m of Object.values(models||{})){
      nt.run([Number(m.id),String(m.name||'Note Type'),Number(m.mod)||0,Number(m.usn)||-1,this._encodeNotetypeConfig(m)]);
      for(const f of (m.flds||[]))fld.run([Number(m.id),Number(f.ord)||0,String(f.name||''),this._encodeFieldConfig(f)]);
      for(const t of (m.tmpls||[]))tmpl.run([Number(m.id),Number(t.ord)||0,String(t.name||''),Number(m.mod)||0,-1,this._encodeTemplateConfig(t)]);
    }
    nt.free();fld.free();tmpl.free();

    const ds=db.prepare('INSERT INTO decks VALUES (?,?,?,?,?,?)');
    for(const d of Object.values((dj&&dj.decks)||{})){
      ds.run([Number(d.id),String(d.name||'Default'),Number(d.mod)||0,Number(d.usn)||-1,this._encodeDeckCommon(d),this._encodeDeckKind(d)]);
    }
    ds.free();

    const dc=db.prepare('INSERT INTO deck_config VALUES (?,?,?,?,?)');
    for(const c of Object.values((dj&&dj.dconf)||{})){
      dc.run([Number(c.id),String(c.name||'Default'),Number(c.mod)||0,Number(c.usn)||-1,this._encodeDeckConfig(c)]);
    }
    dc.free();

    // Schema 14 normalizou as preferências de col.conf em registros JSON.
    let conf={};try{const row=db.exec('select conf from col where id=1');conf=JSON.parse(row[0]&&row[0].values[0]&&row[0].values[0][0]||'{}')||{};}catch(_){ if (typeof _quiet === 'function') _quiet(_, '34-anki-export'); }
    const cf=db.prepare('INSERT OR REPLACE INTO config VALUES (?,?,?,?)');
    for(const [k,v] of Object.entries(conf))cf.run([k,0,0,this._enc.encode(JSON.stringify(v))]);
    cf.free();

    // A tabela normalizada de tags é índice auxiliar; as tags continuam também
    // no campo notes.tags. Preenchê-la evita uma coleção estruturalmente vazia.
    const allTags=new Set();
    try{
      const rows=db.exec('select tags from notes');
      for(const row of (rows[0]&&rows[0].values||[]))for(const t of String(row[0]||'').trim().split(/\s+/))if(t)allTags.add(t);
    }catch(_){ if (typeof _quiet === 'function') _quiet(_, '34-anki-export'); }
    const ts=db.prepare('INSERT OR IGNORE INTO tags VALUES (?,?)');
    for(const tag of allTags)ts.run([tag,-1]);ts.free();

    db.run("UPDATE col SET ver=18,conf='',models='',decks='',dconf='',tags='' WHERE id=1");
  },
  _tagsFor(note, cards, options) {
    options=options||{};
    const tags=[].concat(note&&Array.isArray(note.tags)?note.tags:[]);
    for(const c of cards||[])for(const v of [c.materia,c.assunto,c.materiaTec,c.banca,c.tipo,c.leech?'leech':null,c.favorito?'marked':null])if(v)tags.push(String(v));
    let out=Array.from(new Set(tags.map(t=>t.trim().replace(/\s+/g,'_')).filter(Boolean)));
    if(options.withScheduling===false)out=out.filter(t=>!/^(marked|leech)$/i.test(t));
    return out;
  },
  _revKind(r) {
    const k = (typeof AnkiParity !== 'undefined' && AnkiParity._trainingKind) ? AnkiParity._trainingKind(r) : String(r.phase || 'review');
    return ({ learning: 0, review: 1, relearning: 2, filtered: 3, manual: 4, rescheduled: 5 })[k] ?? 1;
  },
  _revRows(cards, revlog) {
    const byCard = new Map(cards.map(c => [String(c.id), c])), group = new Map();
    for (const r of revlog || []) { const k = String(r.cardId); if (!group.has(k)) group.set(k, []); group.get(k).push(r); }
    const rows = []; let uniqueLast = 0;
    for (const pair of group) {
      const sid = pair[0], logs = pair[1], card = byCard.get(sid); if (!card) continue;
      logs.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0)); let prevExportIvl = 0;
      for (let i = 0; i < logs.length; i++) {
        const r = logs[i], kind = this._revKind(r), lastIvl = Number(r.intervalo) || prevExportIvl || 0;
        let ivl;
        if (r.ankiIvlSemantica === 2 && r.ankiInterval != null && r.ankiLastInterval != null) {
          // Linha gravada já na semântica do Anki: exporta exatamente o que foi registrado.
          let id2 = Math.max(1, Math.round(Number(r.ts) || Date.now())); if (id2 <= uniqueLast) id2 = uniqueLast + 1; uniqueLast = id2;
          rows.push([id2, Number(card.ankiId), -1, Math.min(4, Math.max(0, Math.round(Number(r.grade) || 0))), Math.round(Number(r.ankiInterval) || 0),
            Math.round(Number(r.ankiLastInterval) || 0), Math.max(0, Math.round(Number(r.easeFactor) || 0)), Math.max(0, Math.round(Number(r.time) || 0)), kind]);
          prevExportIvl = Number(r.ankiInterval) || 0;
          continue;
        }
        if (kind === 0 || kind === 2) {
          const next = logs[i + 1];
          const sec = next ? Math.max(1, Math.round(((Number(next.ts) || 0) - (Number(r.ts) || 0)) / 1000))
            : (card.dueTs ? Math.max(1, Math.round((Number(card.dueTs) - (Number(r.ts) || 0)) / 1000)) : 0);
          ivl = sec > 0 ? -sec : (Number(card.intervalo) || 0);
        } else {
          const next = logs[i + 1]; ivl = next ? (Number(next.intervalo) || 0) : (Number(card.intervalo) || 0);
          ivl = Math.max(0, Math.round(ivl));
        }
        let id = Math.max(1, Math.round(Number(r.ts) || Date.now())); if (id <= uniqueLast) id = uniqueLast + 1; uniqueLast = id;
        const ease = Math.min(4, Math.max(1, Math.round(Number(r.grade) || 3))), rawEase = Number(card.ease) || 2.5;
        rows.push([id, Number(card.ankiId), -1, ease, ivl, Math.round(lastIvl), Math.round(rawEase < 10 ? rawEase * 1000 : rawEase),
          Math.max(0, Math.round(Number(r.time) || 0)), kind]);
        prevExportIvl = ivl;
      }
    }
    return rows.sort((a, b) => a[0] - b[0]);
  },

  async _loadSqlJs() {
    if (typeof globalThis.initSqlJs === 'function') return globalThis.initSqlJs();
    if (typeof document === 'undefined') throw new Error('sql.js requer ambiente de navegador');
    await new Promise((resolve, reject) => {
      const old = document.querySelector('script[data-snm-sqljs]');
      if (old) {
        if (typeof globalThis.initSqlJs === 'function') { resolve(); return; }
        old.addEventListener('load', resolve, { once: true }); old.addEventListener('error', reject, { once: true }); return;
      }
      const s = document.createElement('script'); s.src = './src/vendor/sqljs-1.2.1/sql-asm.js'; s.dataset.snmSqljs = '1';
      s.onload = resolve; s.onerror = () => reject(new Error('Falha ao carregar sql.js local')); document.head.appendChild(s);
    });
    if (typeof globalThis.initSqlJs !== 'function') throw new Error('sql.js local não inicializou');
    return globalThis.initSqlJs();
  },

  _sourceCards() {
    try { if (typeof window !== 'undefined' && window.StudyGlobalScope && StudyGlobalScope.cards) return StudyGlobalScope.cards(); } catch (_) { if (typeof _quiet === 'function') _quiet(_, '34-anki-export'); }
    return DB.getCards();
  },
  _sourceDecks() {
    try { if (typeof window !== 'undefined' && window.StudyGlobalScope && StudyGlobalScope.decks) return StudyGlobalScope.decks(); } catch (_) { if (typeof _quiet === 'function') _quiet(_, '34-anki-export'); }
    return DB.getDecks();
  },
  _sourceRevlog() {
    try { if (typeof window !== 'undefined' && window.StudyGlobalScope && StudyGlobalScope.revlog) return StudyGlobalScope.revlog(); } catch (_) { if (typeof _quiet === 'function') _quiet(_, '34-anki-export'); }
    return DB.getRevlog();
  },

  _cardsForLimit(options) {
    options=options||{};const all=this._sourceCards().slice(),limit=options.limit||{};
    if(limit.deckId!=null){
      const decks=this._sourceDecks(),root=decks.find(d=>String(d.id)===String(limit.deckId));
      if(!root)return [];
      const prefix=String(root.nome||'')+'::',ids=new Set(decks.filter(d=>String(d.id)===String(root.id)||String(d.nome||'').startsWith(prefix)).map(d=>String(d.id)));
      return all.filter(c=>ids.has(String(c.originalDeckId||c.deckId)));
    }
    if(Array.isArray(limit.noteIds)){const ids=new Set(limit.noteIds.map(String));return all.filter(c=>ids.has(String(AnkiParity.noteId(c))));}
    if(Array.isArray(limit.cardIds)){const ids=new Set(limit.cardIds.map(String));return all.filter(c=>ids.has(String(c.id))||ids.has(String(c.ankiId)));}
    return all;
  },
  _decksForCards(cards,allDecks) {
    const byId=new Map(allDecks.map(d=>[String(d.id),d])),keep=new Set();
    const addAncestors=(d)=>{
      if(!d)return;keep.add(String(d.id));
      const parts=String(d.nome||'').split('::');
      for(let i=1;i<parts.length;i++){
        const name=parts.slice(0,i).join('::'),p=allDecks.find(x=>String(x.nome||'')===name);
        if(p)keep.add(String(p.id));
      }
    };
    cards.forEach(c=>addAncestors(byId.get(String(c.originalDeckId||c.deckId))));
    return allDecks.filter(d=>keep.has(String(d.id))&&!AnkiParity.isFilteredDeck(d));
  },

  buildTextNotes(options) {
    options=Object.assign({withHtml:true,withTags:true,withDeck:true,withNotetype:true,withGuid:true},options||{});
    if(typeof AnkiParity==='undefined')throw new Error('Camada de paridade Anki indisponível');
    AnkiParity.ensureIdentities();AnkiParity.ensureCanonicalNotes();
    const cards=this._cardsForLimit(options),decks=this._sourceDecks(),deckById=new Map(decks.map(d=>[String(d.id),String(d.nome||'')]));
    const noteIds=new Set(cards.map(c=>String(AnkiParity.noteId(c)))),notes=AnkiParity.notes().filter(n=>noteIds.has(String(n.id))||noteIds.has(String(n.ankiId))),types=AnkiParity.noteTypes(),typeById=new Map(types.map(nt=>[String(nt.id),nt]));
    const siblings=new Map();
    cards.forEach(c=>{const nid=String(AnkiParity.noteId(c));if(!siblings.has(nid))siblings.set(nid,[]);siblings.get(nid).push(c);});
    const maxFields=Math.max(0,...types.map(nt=>Array.isArray(nt.fields)?nt.fields.length:0));
    const headers=['#separator:tab','#html:'+String(!!options.withHtml)];
    let col=0;
    if(options.withGuid)headers.push('#guid column:'+(++col));
    if(options.withNotetype)headers.push('#notetype column:'+(++col));
    if(options.withDeck)headers.push('#deck column:'+(++col));
    const fieldStart=col+1; // documentação/depuração
    col+=maxFields;
    if(options.withTags)headers.push('#tags column:'+(++col));
    const rows=[];
    for(const note of notes){
      const nt=typeById.get(String(note.notetypeId));if(!nt)continue;
      const sib=siblings.get(String(note.id))||siblings.get(String(note.ankiId))||[];
      const first=sib[0]||null,vals=[];
      if(options.withGuid)vals.push(note.guid||('snm-'+Number(note.id).toString(36)));
      if(options.withNotetype)vals.push(nt.name||'');
      if(options.withDeck)vals.push(first?deckById.get(String(first.originalDeckId||first.deckId))||'':'');
      const fields=Array.isArray(nt.fields)?nt.fields:[];
      for(let i=0;i<maxFields;i++){
        const name=fields[i]&&fields[i].name,raw=name&&note.fields?String(note.fields[name]??''):'';
        vals.push(options.withHtml?raw:this._plain(raw));
      }
      if(options.withTags)vals.push((note.tags||[]).join(' '));
      rows.push(vals.map(v=>this._tsvField(v)).join('\t'));
    }
    return {text:headers.join('\n')+'\n'+rows.join('\n'),notes:rows.length,fieldColumns:maxFields,fieldStart};
  },
  buildTextCards(options) {
    options=Object.assign({withHtml:true},options||{});
    if(typeof AnkiParity==='undefined')throw new Error('Camada de paridade Anki indisponível');
    AnkiParity.ensureIdentities();AnkiParity.ensureCanonicalNotes();
    const rows=[];
    const exportCards=this._cardsForLimit(options).slice().sort((a,b)=>Number(a.ankiId||a.id)-Number(b.ankiId||b.id));
    for(const card of exportCards){
      const note=AnkiParity.getNote(AnkiParity.noteId(card));if(!note)continue;
      const nt=AnkiParity.noteTypes().find(x=>String(x.id)===String(note.notetypeId));if(!nt)continue;
      const ord=Number(card.ankiTemplateOrd)||0;
      const q=AnkiParity.renderTemplate(nt,note,ord,'question',card,'');
      let a=AnkiParity.renderTemplate(nt,note,ord,'answer',card,q);
      a=String(a).replace(/^.*?<hr\s+id=["']?answer["']?\s*\/?>\s*/is,'');
      const vals=[q,a].map(v=>options.withHtml?String(v):this._plain(v));
      rows.push(vals.map(v=>this._tsvField(v)).join('\t'));
    }
    return {text:'#separator:tab\n#html:'+String(!!options.withHtml)+'\n'+rows.join('\n'),cards:rows.length};
  },

  async buildCollection(options) {
    options=Object.assign({schema:11,withScheduling:true,withDeckConfigs:true},options||{});
    if (typeof AnkiParity === 'undefined') throw new Error('Camada de paridade Anki indisponível');
    AnkiParity.ensureIdentities(); AnkiParity.ensureCanonicalNotes();
    const cards = this._cardsForLimit(options), allDecks = this._sourceDecks().slice();
    const decks = this._decksForCards(cards,allDecks), crt = this._collectionEpoch(cards);
    const deckMap=this._deckIdMap(decks),dj=this._deckJson(decks,options),media={items:[],byKey:new Map()};
    const notesById = new Map(), siblings = new Map(), usedNt = new Set();
    for (const c of cards) {
      const nid = String(AnkiParity.noteId(c)); if (!siblings.has(nid)) siblings.set(nid, []); siblings.get(nid).push(c);
    }
    for (const pair of siblings) {
      const nid = pair[0], sibs = pair[1]; let note = AnkiParity.getNote(nid);
      if (!note) { AnkiParity.ensureCanonicalNotes(sibs); note = AnkiParity.getNote(nid); }
      if (!note) continue; notesById.set(nid, note); usedNt.add(String(note.notetypeId));
    }
    const models = {};
    for (const nt of AnkiParity.noteTypes()) if (usedNt.has(String(nt.id))) {
      const model=this.modelSchema(nt);
      model.css=this.extractMedia(model.css,media);
      model.latexPre=this.extractMedia(model.latexPre||'',media);
      model.latexPost=this.extractMedia(model.latexPost||'',media);
      for(const t of model.tmpls||[])for(const k of ['qfmt','afmt','bqfmt','bafmt'])t[k]=this.extractMedia(t[k]||'',media);
      models[String(nt.id)] = model;
    }

    const SQL = await this._loadSqlJs(), db = new SQL.Database(); db.run(this.SCHEMA11);
    const nowMs = Date.now(), conf = {
      activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: Math.round(((typeof CardsConfig !== 'undefined' && CardsConfig.get().learnAheadMin != null) ? Number(CardsConfig.get().learnAheadMin) : 20) * 60), timeLim: 0, estTimes: true, dueCounts: true,
      curModel: null, nextPos: Math.max(1, ...cards.map(c => (Number(c.posicaoNova) || 0) + 1)),
      sortType: 'noteFld', sortBackwards: false, addToCur: true, dayLearnFirst: false, schedVer: 2,
      creationOffset: null, sched2021: true
    };
    db.run('UPDATE col SET crt=?,mod=?,scm=?,ver=11,dty=0,usn=-1,ls=0,conf=?,models=?,decks=?,dconf=?,tags=? WHERE id=1',
      [crt, nowMs, nowMs, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(dj.decks), JSON.stringify(dj.dconf), '{}']);

    const ns = db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const pair of notesById) {
      const nid = pair[0], note = pair[1], nt = models[String(note.notetypeId)]; if (!nt) continue;
      const sibs = siblings.get(nid) || [], fields = [];
      for (const f of nt.flds) {
        const raw = note.fields && Object.prototype.hasOwnProperty.call(note.fields, f.name) ? note.fields[f.name] : '';
        fields.push(this.extractMedia(raw, media));
      }
      const sfld=this._plain(fields[Number(nt.sortf)||0]||fields[0]||''),tags=this._tagsFor(note,sibs,options);
      ns.run([Number(note.ankiId || note.id), String(note.guid || ('snm-' + Number(note.id).toString(36))), Number(note.notetypeId),
        this._mod(note.updatedAt || note.createdAt), -1, tags.length ? ' ' + tags.join(' ') + ' ' : '', fields.join('\x1f'),
        sfld, this._sha1First32(sfld), 0, '']);
    }
    ns.free();

    const cs=db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');let newPos=1;
    for(const original of cards){
      const c=this._homeState(original),did=deckMap.get(String(c.deckId))||1,cfg=CardsConfig.forDeck(c.deckId);
      const keep=options.withScheduling!==false,sched=keep?this.cardSchedule(original,crt,newPos):{type:0,queue:0,due:newPos,left:0};
      const rawEase=keep?(Number(c.ease)||2.5):0,factor=keep?Math.round(rawEase<10?rawEase*1000:rawEase):0;
      const ivl=keep?Math.max(0,Math.round(Number(c.intervalo)||0)):0;
      const reps=keep?Math.max(0,Math.round(Number(c.reps)||0)):0,lapses=keep?Math.max(0,Math.round(Number(c.lapses)||0)):0;
      const flags=keep?Math.max(0,Math.min(7,Math.round(Number(c.flag)||0))):0;
      const data=keep?this.cardData(c,cfg):JSON.stringify({pos:Math.max(0,newPos-1)});
      cs.run([Number(original.ankiId),Number(original.ankiNoteId),did,Math.max(0,Number(original.ankiTemplateOrd)||0),
        Number(original.ankiMod)||this._mod(original.updatedAt||original.createdAt),-1,sched.type,sched.queue,sched.due,
        ivl,factor,reps,lapses,sched.left,0,0,flags,data]);
      newPos++;
    }
    cs.free();

    const rs=db.prepare('INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)');
    const revRows=options.withScheduling===false?[]:this._revRows(cards,this._sourceRevlog());
    for (const row of revRows) rs.run(row);
    rs.free();
    if(Number(options.schema)===18)this._upgradeToSchema18(db,models,dj);
    const bytes = db.export(); db.close();
    return { bytes, schema:Number(options.schema)===18?18:11, media: media.items, cards: cards.length, notes: notesById.size, decks: decks.length, revlog: revRows.length };
  },

  async buildPackage(options) {
    options=Object.assign({legacy:true,withMedia:true,withScheduling:true,withDeckConfigs:true},options||{});
    const legacy=options.legacy!==false,collectionOpts={
      withScheduling:options.withScheduling!==false,withDeckConfigs:options.withDeckConfigs!==false,limit:options.limit||{}
    };
    const col=await this.buildCollection(Object.assign({schema:legacy?11:18},collectionOpts)),mediaMap={},mediaEntries=[];
    const compatibility=legacy?col:await this.buildCollection(Object.assign({schema:11},collectionOpts));
    const exportedMedia=options.withMedia===false?[]:col.media;
    exportedMedia.forEach((m,i)=>{mediaMap[String(i)]=m.name;});
    let entries;
    if(legacy){
      exportedMedia.forEach((m,i)=>mediaEntries.push({name:String(i),data:m.bytes}));
      entries=[
        {name:'meta',data:new Uint8Array([0x08,0x02])},
        {name:'collection.anki21',data:col.bytes},
        {name:'collection.anki2',data:compatibility.bytes},
        {name:'media',data:JSON.stringify(mediaMap)},
        ...mediaEntries
      ];
    }else{
      const mediaProto=this._mediaEntriesProto(exportedMedia);
      exportedMedia.forEach((m,i)=>mediaEntries.push({name:String(i),data:this._zstdStore(m.bytes)}));
      entries=[
        {name:'meta',data:new Uint8Array([0x08,0x03])},
        {name:'collection.anki21b',data:this._zstdStore(col.bytes)},
        {name:'collection.anki2',data:compatibility.bytes},
        {name:'media',data:this._zstdStore(mediaProto)},
        ...mediaEntries
      ];
    }
    return Object.assign({},col,{bytes:this.zipStore(entries),legacy,withMedia:options.withMedia!==false,
      withScheduling:collectionOpts.withScheduling,withDeckConfigs:collectionOpts.withDeckConfigs});
  },
  async buildCollectionPackage(options) {
    // ExportCollectionPackageRequest do Anki 26.09.2 só expõe include_media e legacy:
    // coleção inteira + agendamento + configs são obrigatórios.
    options=options||{};
    return this.buildPackage({
      legacy:options.legacy!==false,
      withMedia:options.withMedia!==false,
      withScheduling:true,
      withDeckConfigs:true,
      limit:{wholeCollection:true}
    });
  }
};
