/* ============================================================
   PARIDADE MÁXIMA — REVIEWER + BROWSER + BUSCA
   Camada aditiva sobre AnkiProductParity. Mantém o fluxo atual
   do Study e aproxima as operações do Anki/AnkiDroid 26.09.
   ============================================================ */
const AnkiMaxParity = {
  _voiceUrl:null,_voiceStream:null,_voiceRecorder:null,_voiceChunks:[],_previousCardId:null,

  install(){
    if(this._installed||typeof AnkiProductParity==='undefined'||typeof AnkiParity==='undefined'||typeof CardsScreen==='undefined')return;
    this._installed=true;
    this._patchSearch();
    this._enhanceBrowser();
    this._enhanceReviewer();
    this._injectVoiceModal();
  },

  /* ───────────────────────── BUSCA ANKI ───────────────────────── */
  _norm(v){return String(v==null?'':v).toLowerCase();},
  _noCombining(v){
    return String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'s').replace(/ẞ/g,'S');
  },
  _stripClozes(v){
    return String(v==null?'':v).replace(/\{\{c\d+(?:,\d+)*::([\s\S]*?)(?:::[\s\S]*?)?\}\}/gi,'$1');
  },
  _escapeRxChar(ch){return String(ch).replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&');},
  _wildcardRegex(pattern,{anchored=false,word=false}={}){
    const p=String(pattern==null?'':pattern);let out='',esc=false;
    for(const ch of p){
      if(esc){out+=this._escapeRxChar(ch);esc=false;continue;}
      if(ch==='\\'){esc=true;continue;}
      if(ch==='*')out+='.*';
      else if(ch==='_')out+='.';
      else out+=this._escapeRxChar(ch);
    }
    if(esc)out+='\\\\';
    if(word){
      const left=p.startsWith('*')?'':'(?:^|[^\\p{L}\\p{N}_])';
      const right=p.endsWith('*')?'':'(?=$|[^\\p{L}\\p{N}_])';
      return new RegExp(left+'('+out+')'+right,'iu');
    }
    return new RegExp((anchored?'^':'')+out+(anchored?'$':''),'iu');
  },
  _wildMatch(text,pattern,anchored=false){
    try{return this._wildcardRegex(pattern,{anchored}).test(String(text==null?'':text));}catch(_){return false;}
  },
  _noteText(card,{stripCloze=false,noCombining=false}={}){
    const note=AnkiParity.getNote(AnkiParity.noteId(card)),nt=note&&AnkiParity.getNotetype(note.notetypeId),chunks=[];
    if(note){
      (nt&&nt.fields||[]).forEach(f=>{if(f.excludeFromSearch)return;chunks.push(String(note.fields&&note.fields[f.name]||''));});
      if(!nt)chunks.push(...Object.values(note.fields||{}).map(String));
    }else chunks.push(card.frente||'',card.verso||'');
    let s=chunks.join(' ').replace(/<[^>]+>/g,' ');
    if(stripCloze)s=this._stripClozes(s);if(noCombining)s=this._noCombining(s);return s;
  },
  _customData(card){
    if(card&&card.customData&&typeof card.customData==='object')return card.customData;
    if(card&&card.ankiCustomData&&typeof card.ankiCustomData==='object')return card.ankiCustomData;
    if(card&&typeof card.ankiData==='object'&&card.ankiData)return card.ankiData;
    return {};
  },

  _patchSearch(){
    const originalTerm=AnkiParity._filteredTermMatches.bind(AnkiParity);
    AnkiParity._filteredTermMatches=(card,term)=>{
      term=AnkiParity._stripOuterParens(String(term||'').trim());if(!term)return true;
      if(term[0]==='-')return !AnkiParity._filteredTermMatches(card,term.slice(1));
      if(/^not:/i.test(term))return !AnkiParity._filteredTermMatches(card,term.slice(4));

      const m=term.match(/^([^:]+):(.*)$/),key=m?m[1].toLowerCase():'',raw=m?m[2]:'';
      const val=String(raw||'').replace(/^"(.*)"$/,'$1');

      if(key==='w'){
        try{return AnkiMaxParity._wildcardRegex(val,{word:true}).test(AnkiMaxParity._noteText(card));}catch(_){return false;}
      }
      if(key==='nc')return AnkiMaxParity._wildMatch(AnkiMaxParity._noCombining(AnkiMaxParity._noteText(card)),AnkiMaxParity._noCombining(val),false);
      if(key==='sc')return AnkiMaxParity._wildMatch(AnkiMaxParity._stripClozes(AnkiMaxParity._noteText(card)),val,false);
      if(key==='has-cd')return Object.prototype.hasOwnProperty.call(AnkiMaxParity._customData(card),val);
      if(key==='tag'){
        const tags=AnkiParity._noteTagsForCard(card);
        if(val.toLowerCase()==='none')return tags.length===0;
        return tags.some(t=>AnkiMaxParity._wildMatch(t,val,false)||String(t).toLowerCase().startsWith(String(val).toLowerCase()+'::'));
      }
      if(key==='deck'&&val.toLowerCase()==='filtered')return !!(card.filteredDeckId||card.originalDeckId);
      if(key==='is'){
        const v=val.toLowerCase();
        if(v==='buried-sibling')return CardEngine.estaEnterrado(card)&&String(card.buryKind||'')==='scheduler';
        if(v==='buried-manually')return CardEngine.estaEnterrado(card)&&String(card.buryKind||'')==='user';
      }
      if(key==='prop'){
        let pm=val.match(/^cdn:([^<>=!]+)(<=|>=|!=|=|<|>)(-?\d+(?:\.\d+)?)$/i);
        if(pm){
          const a=Number(AnkiMaxParity._customData(card)[pm[1]]),b=Number(pm[3]),op=pm[2];if(!Number.isFinite(a))return false;
          return op==='<='?a<=b:op==='>='?a>=b:op==='!='?a!==b:op==='<'?a<b:op==='>'?a>b:a===b;
        }
        pm=val.match(/^cds:([^=]+)=(.*)$/i);
        if(pm)return AnkiMaxParity._wildMatch(String(AnkiMaxParity._customData(card)[pm[1]]??''),pm[2],true);
      }

      const builtin=new Set(['materia','subject','assunto','topic','tipo','type','banca','favorito','favorite','suspenso','suspended','leech','deck','baralho','is','added','rated','tag','note','card','flag','edited','introduced','nid','cid','preset','re','prop']);
      if(m&&!builtin.has(key)){
        const note=AnkiParity.getNote(AnkiParity.noteId(card)),fields=note&&note.fields||{},names=Object.keys(fields);
        const matchingNames=names.filter(n=>AnkiMaxParity._wildMatch(n,key,true));
        if(matchingNames.length){
          return matchingNames.some(n=>{
            let txt=String(fields[n]??''),needle=val,mode='normal';
            if(/^re:/i.test(needle)){mode='regex';needle=needle.slice(3);}
            else if(/^nc:/i.test(needle)){mode='nc';needle=needle.slice(3);txt=AnkiMaxParity._noCombining(txt);needle=AnkiMaxParity._noCombining(needle);}
            if(mode==='regex'){try{return new RegExp(needle,'iu').test(txt);}catch(_){return false;}}
            if(needle==='*')return true;
            if(needle==='_ *'.replace(' ',''))return txt.length>0;
            if(needle==='')return txt.length===0;
            return AnkiMaxParity._wildMatch(txt,needle,true);
          });
        }
      }

      if(!m&&/[*_]/.test(term))return AnkiMaxParity._wildMatch(AnkiMaxParity._noteText(card),term,false);
      return originalTerm(card,term);
    };

    const originalSearch=AnkiParity.filteredSearchMatches.bind(AnkiParity);
    AnkiParity.filteredSearchMatches=function(card,expr){
      expr=String(expr||'').trim();if(!expr)return true;
      expr=expr.replace(/\s+and\s+/ig,' ');
      try{return originalSearch(card,expr);}catch(_){return false;}
    };
  },

  /* ───────────────────────── BROWSER ───────────────────────── */
  _browserPrefsKey(){try{return AnkiParity._entityKey('browser','prefs');}catch(_){return 'snm-anki-browser-prefs';}},
  _loadBrowserPrefs(){
    let p={};try{p=JSON.parse(localStorage.getItem(this._browserPrefsKey())||'{}')||{};}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-max-reviewer-browser'); }
    const b=AnkiProductParity.browser;
    b.mode=p.mode==='cards'?'cards':'notes';
    b.columns=Array.isArray(p.columns)?p.columns.slice():null;
    b.sort=p.sort||b.sort||'sortField';b.sortDir=p.sortDir==='desc'?'desc':'asc';
  },
  _saveBrowserPrefs(){
    const b=AnkiProductParity.browser;try{localStorage.setItem(this._browserPrefsKey(),JSON.stringify({mode:b.mode,columns:b.columns,sort:b.sort,sortDir:b.sortDir}));}catch(_){ if (typeof _quiet === 'function') _quiet(_, '44-anki-max-reviewer-browser'); }
  },
  _columnDefs(){
    const both=['notes','cards'];
    return {
      sortField:{label:'Classificar campo',modes:both},
      question:{label:'Pergunta',modes:both},answer:{label:'Resposta',modes:both},
      deck:{label:'Baralho',modes:both},notetype:{label:'Tipo de nota',modes:both},
      template:{label:'Card(s)',modes:both},due:{label:'Vencimento',modes:both},
      interval:{label:'(Méd.) Intervalo',modes:both},ease:{label:'(Méd.) Facilidade',modes:both},
      stability:{label:'(Méd.) Estabilidade',modes:both},difficulty:{label:'(Méd.) Dificuldade',modes:both},
      retrievability:{label:'(Méd.) Recuperabilidade',modes:both},reps:{label:'Revisões',modes:both},
      lapses:{label:'Lapsos',modes:both},position:{label:'Posição',modes:both},
      flag:{label:'Bandeira',modes:both},tags:{label:'Etiquetas',modes:both},
      cards:{label:'Cards',modes:both},created:{label:'Criada',modes:both},
      modified:{label:'Nota modificada',modes:both},cardModified:{label:'Card modificado',modes:both},
      noteId:{label:'ID nota',modes:both},cardId:{label:'ID card',modes:both}
    };
  },
  _defaultColumns(mode){return mode==='cards'?['question','deck','due','interval','stability','difficulty']:['sortField','notetype','cards','tags'];},
  _availableColumns(mode){const d=this._columnDefs();return Object.keys(d).filter(k=>d[k].modes.includes(mode));},
  _selectedColumns(){
    const b=AnkiProductParity.browser,available=new Set(this._availableColumns(b.mode));
    let cols=(Array.isArray(b.columns)?b.columns:[]).filter(c=>available.has(c));
    if(!cols.length)cols=this._defaultColumns(b.mode);return cols;
  },
  _isSortableColumn(key){return key!=='question'&&key!=='answer';},
  _reorderColumns(from,to){
    const b=AnkiProductParity.browser,cols=this._selectedColumns(),a=cols.indexOf(String(from)),z=cols.indexOf(String(to));
    if(a<0||z<0||a===z)return false;
    const [moved]=cols.splice(a,1);cols.splice(z,0,moved);b.columns=cols;this._saveBrowserPrefs();AnkiProductParity.renderBrowser();return true;
  },
  _deckName(card){const id=card&&(card.originalDeckId||card.deckId),ds=AnkiParity._decksForCardPlan?AnkiParity._decksForCardPlan(card):DB.getDecks(),d=ds.find(x=>String(x.id)===String(id));return d?String(d.nome||''):'';},
  _templateName(row){
    const c=row.card||(row.cards&&row.cards[0]);if(!c||!row.nt)return '';const i=Number(c.ankiTemplateOrd)||0;return String(row.nt.templates&&row.nt.templates[i]&&row.nt.templates[i].name||('Card '+(i+1)));
  },
  _renderSides(row){
    const c=row.card||(row.cards&&row.cards[0]);if(!c||!row.note||!row.nt)return {q:'',a:''};
    try{
      const q=AnkiProductParity.plain(AnkiParity.renderTemplate(row.nt,row.note,Number(c.ankiTemplateOrd)||0,'question',c,''));
      let a=AnkiProductParity.plain(AnkiParity.renderTemplate(row.nt,row.note,Number(c.ankiTemplateOrd)||0,'answer',c,q));
      // Igual ao Browser do Anki: se a resposta começa repetindo a pergunta,
      // a coluna Answer mostra somente o trecho adicional.
      if(q&&a.startsWith(q))a=a.slice(q.length).trim();
      return {q,a};
    }catch(_){return {q:'',a:''};}
  },
  plain(v){return AnkiProductParity.plain(v);},
  _eligibleNoteCards(row){return (row.cards||[]).filter(c=>!c.suspenso&&!CardEngine.estaEnterrado(c)&&!c.originalDeckId);},
  _avgCard(row,fn,filter){
    const xs=(row.cards||[]).filter(c=>!filter||filter(c)).map(fn).map(Number).filter(Number.isFinite);
    return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
  },
  _colValue(row,key){
    const noteMode=AnkiProductParity.browser.mode==='notes',cards=row.cards||[],c=row.card||cards[0],sides=(key==='question'||key==='answer')?this._renderSides(row):null;
    if(key==='sortField')return row.field||'';
    if(key==='question')return sides.q;if(key==='answer')return sides.a;
    if(key==='deck'){
      if(!noteMode)return this._deckName(c);
      const names=[...new Set(cards.map(x=>this._deckName(x)).filter(Boolean))];return names.length===1?names[0]:names.length;
    }
    if(key==='notetype')return String(row.nt&&row.nt.name||'');
    if(key==='template')return noteMode?cards.length:this._templateName(row);
    if(key==='cards')return noteMode?cards.length:this._templateName(row);
    if(key==='due'){
      if(!noteMode)return c?(c.dueTs?Number(c.dueTs):String(c.due||'')):'';
      const eligible=this._eligibleNoteCards(row).filter(x=>(x.phase||'new')!=='new');
      if(!eligible.length)return '';
      const score=x=>x.dueTs!=null?Number(x.dueTs):(Date.parse(String(x.due||'')+'T00:00:00')||Infinity);
      return eligible.slice().sort((a,b)=>score(a)-score(b))[0].dueTs||eligible.slice().sort((a,b)=>score(a)-score(b))[0].due||'';
    }
    if(key==='interval')return noteMode?this._avgCard(row,x=>x.intervalo,x=>['review','relearning'].includes(String(x.phase||''))):Number(c&&c.intervalo)||0;
    if(key==='ease')return noteMode?this._avgCard(row,x=>x.ease,x=>String(x.phase||'new')!=='new'):Number(c&&c.ease)||0;
    if(key==='stability')return noteMode?this._avgCard(row,x=>x.s,x=>x.s!=null):Number(c&&c.s)||0;
    if(key==='difficulty')return noteMode?this._avgCard(row,x=>x.d,x=>x.d!=null):Number(c&&c.d)||0;
    if(key==='retrievability'){
      const rv=x=>{try{return Number(CardEngine.retrievabilityDe(x,todayCards(),CardsConfig.weightsFor(x.originalDeckId||x.deckId)))||0;}catch(_){return 0;}};
      return noteMode?this._avgCard(row,rv,x=>x.s!=null):(c?rv(c):0);
    }
    if(key==='reps')return noteMode?cards.reduce((n,x)=>n+(Number(x.reps)||0),0):Number(c&&c.reps)||0;
    if(key==='lapses')return noteMode?cards.reduce((n,x)=>n+(Number(x.lapses)||0),0):Number(c&&c.lapses)||0;
    if(key==='position'){
      if(!noteMode)return Number(c&&(c.posicaoNova||c.ankiDue))||0;
      const ns=cards.filter(x=>String(x.phase||'new')==='new').map(x=>Number(x.posicaoNova||x.ankiDue)).filter(Number.isFinite);return ns.length?Math.min(...ns):0;
    }
    if(key==='flag')return noteMode?cards.reduce((m,x)=>Math.max(m,Number(x.flag)||0),0):Number(c&&c.flag)||0;
    if(key==='tags')return (row.tags||[]).join(' ');
    if(key==='created')return String((row.note&&row.note.createdAt)||(c&&c.createdAt)||'');
    if(key==='modified')return String(row.note&&row.note.updatedAt||'');
    if(key==='cardModified')return noteMode?cards.reduce((m,x)=>String(x.updatedAt||'')>m?String(x.updatedAt||''):m,''):String(c&&c.updatedAt||'');
    if(key==='noteId')return String(row.note&&row.note.id||'');if(key==='cardId')return String(c&&c.id||'');return '';
  },
  _formatCol(row,key){
    const v=this._colValue(row,key),c=row.card||(row.cards&&row.cards[0]);
    if(key==='due'&&v){if(typeof v==='number')return new Date(v).toLocaleString('pt-BR');return String(v);}
    if(key==='interval')return v?Number(v).toFixed(AnkiProductParity.browser.mode==='notes'?1:0)+'d':'—';
    if(key==='ease')return v?Number(v).toFixed(2):'—';
    if(key==='stability')return v?Number(v).toFixed(2)+'d':'—';
    if(key==='difficulty')return v?Number(v).toFixed(2):'—';
    if(key==='retrievability')return v?(Number(v)*100).toFixed(1)+'%':'—';
    if(key==='flag')return v&&DB.FLAGS[v]?'● '+DB.FLAGS[v].nome:'—';
    if(key==='created'||key==='modified'||key==='cardModified')return v?String(v).slice(0,10):'—';
    return String(v==null||v===''?'—':v);
  },

  _selectionKey(row){return (AnkiProductParity.browser.mode==='cards'?'c:':'n:')+String(row.card?row.card.id:row.note.id);},
  _resolveSelection(ids){
    const cards=[],noteIds=new Set();
    (ids||[]).forEach(raw=>{
      const s=String(raw);
      if(s.startsWith('c:')){const c=DB.getCard(s.slice(2));if(c){cards.push(c);noteIds.add(AnkiProductParity.noteId(c));}}
      else {const nid=s.startsWith('n:')?s.slice(2):s;noteIds.add(String(nid));cards.push(...AnkiProductParity._cardsForNote(nid));}
    });
    const uniqueCards=[...new Map(cards.map(c=>[String(c.id),c])).values()];
    return {cards:uniqueCards,noteIds:[...noteIds]};
  },

  _enhanceBrowser(){
    this._loadBrowserPrefs();
    const toolbar=document.querySelector('#anki-browser-modal .anki-browser-toolbar');if(!toolbar)return;
    const search=document.getElementById('anki-browser-search');
    const mode=document.createElement('select');mode.id='anki-browser-mode';mode.innerHTML='<option value="notes">Notas</option><option value="cards">Cards</option>';mode.value=AnkiProductParity.browser.mode;search.insertAdjacentElement('afterend',mode);
    const dir=document.createElement('button');dir.type='button';dir.className='btn-secondary anki-browser-sort-dir';dir.id='anki-browser-sort-dir';toolbar.appendChild(dir);
    const details=document.createElement('details');details.id='anki-browser-columns';details.className='anki-browser-columns';details.innerHTML='<summary>Colunas</summary><div id="anki-browser-columns-menu"></div>';toolbar.appendChild(details);
    const title=document.querySelector('#anki-browser-modal .cards-modal-head h2');if(title)title.textContent='🗃️ Navegador';
    const sub=document.querySelector('#anki-browser-modal .cards-modal-head .sub');if(sub)sub.textContent='Modos Cards/Notas, busca Anki, colunas configuráveis e operações em massa.';

    const renderControls=()=>{
      const b=AnkiProductParity.browser,defs=this._columnDefs(),avail=this._availableColumns(b.mode),cols=new Set(this._selectedColumns());
      document.getElementById('anki-browser-mode').value=b.mode;
      const sort=document.getElementById('anki-browser-sort'),sortable=avail.filter(k=>this._isSortableColumn(k));sort.innerHTML=sortable.map(k=>'<option value="'+k+'">'+AnkiProductParity.esc(defs[k].label)+'</option>').join('');
      if(!sortable.includes(b.sort))b.sort=this._defaultColumns(b.mode).find(k=>this._isSortableColumn(k))||sortable[0]||'sortField';sort.value=b.sort;
      dir.textContent=b.sortDir==='desc'?'↓':'↑';dir.title=b.sortDir==='desc'?'Decrescente':'Crescente';
      document.getElementById('anki-browser-columns-menu').innerHTML=avail.map(k=>'<label><input type="checkbox" data-col="'+k+'" '+(cols.has(k)?'checked':'')+'> '+AnkiProductParity.esc(defs[k].label)+'</label>').join('');
      this._saveBrowserPrefs();
    };
    this._renderBrowserControls=renderControls;renderControls();

    mode.addEventListener('change',e=>{const b=AnkiProductParity.browser;b.mode=e.target.value==='cards'?'cards':'notes';b.columns=null;b.sort=this._defaultColumns(b.mode)[0];b.page=0;b.selected.clear();renderControls();AnkiProductParity.renderBrowser();});
    dir.addEventListener('click',()=>{const b=AnkiProductParity.browser;b.sortDir=b.sortDir==='desc'?'asc':'desc';renderControls();AnkiProductParity.renderBrowser();});
    details.addEventListener('change',e=>{const cb=e.target.closest('[data-col]');if(!cb)return;const b=AnkiProductParity.browser,cols=new Set(this._selectedColumns());cb.checked?cols.add(cb.dataset.col):cols.delete(cb.dataset.col);b.columns=[...cols];this._saveBrowserPrefs();AnkiProductParity.renderBrowser();});
    document.getElementById('anki-browser-sort').addEventListener('change',()=>{AnkiProductParity.browser.sortDir='asc';this._saveBrowserPrefs();renderControls();});

    const list=document.getElementById('anki-browser-list');
    list.addEventListener('click',e=>{const x=e.target.closest('[data-card-open]');if(!x)return;e.preventDefault();e.stopImmediatePropagation();this.previewCard(x.dataset.cardOpen);},true);
    list.addEventListener('dblclick',e=>{const row=e.target.closest('.anki-browser-row');if(!row)return;e.preventDefault();e.stopImmediatePropagation();const nid=row.dataset.noteid;if(nid)AnkiProductParity.openNoteEditor(nid);},true);
    document.getElementById('anki-browser-select-all').addEventListener('change',e=>{e.stopImmediatePropagation();const rows=AnkiProductParity._browserRows();AnkiProductParity.browser.selected.clear();if(e.target.checked)rows.forEach(r=>AnkiProductParity.browser.selected.add(this._selectionKey(r)));AnkiProductParity.renderBrowser();},true);

    this._overrideBrowserRows();
    this._overrideBrowserRender();
    this._overrideBrowserBulk();
  },

  _overrideBrowserRows(){
    AnkiProductParity._browserRows=()=>{
      AnkiProductParity.ensure();const st=AnkiProductParity.browser,types=AnkiParity.noteTypes(),typeMap=new Map(types.map(t=>[String(t.id),t])),rows=[];
      for(const note of AnkiParity.notes()){
        const cards=AnkiProductParity._cardsForNote(note.id),nt=typeMap.get(String(note.notetypeId)),tags=(note.tags||[]).slice(),marked=tags.some(t=>String(t).toLowerCase()==='marked'),field=AnkiProductParity._sortField(note,nt);
        if(st.mode==='cards'){
          for(const card of cards)rows.push({note,cards:[card],card,nt,field,tags,flag:Number(card.flag)||0,suspended:!!card.suspenso,marked});
        }else rows.push({note,cards,card:null,nt,field,tags,flag:cards.reduce((m,c)=>Math.max(m,Number(c.flag)||0),0),suspended:cards.some(c=>c.suspenso),marked});
      }
      const raw=String(st.query||'').trim(),q=raw.toLowerCase();
      let out=rows;
      if(q)out=out.filter(r=>{
        const cs=r.card?[r.card]:(r.cards.length?r.cards:[{noteId:r.note.id,ankiNoteId:r.note.id,frente:Object.values(r.note.fields||{}).join(' '),verso:''}]);
        if(/[\w*-]+:/.test(raw)||/\b(?:or|and)\b/i.test(raw)||/[()]/.test(raw)||/[*_]/.test(raw))return cs.some(c=>{try{return AnkiParity.filteredSearchMatches(c,raw);}catch(_){return false;}});
        return [r.field,r.nt&&r.nt.name,(r.tags||[]).join(' '),...Object.values(r.note.fields||{}).map(x=>AnkiProductParity.plain(x))].join(' ').toLowerCase().includes(q);
      });
      if(st.tag)out=out.filter(r=>r.tags.some(t=>String(t)===st.tag||String(t).startsWith(st.tag+'::')));
      if(st.flag!=='')out=out.filter(r=>Number(r.flag)===Number(st.flag));
      if(st.suspended==='yes')out=out.filter(r=>r.suspended);else if(st.suspended==='no')out=out.filter(r=>!r.suspended);
      if(st.marked)out=out.filter(r=>r.marked);
      const sortable=this._availableColumns(st.mode).filter(k=>this._isSortableColumn(k)),key=sortable.includes(st.sort)?st.sort:(this._defaultColumns(st.mode).find(k=>this._isSortableColumn(k))||sortable[0]),dir=st.sortDir==='desc'?-1:1;
      out.sort((a,b)=>{
        const av=this._colValue(a,key),bv=this._colValue(b,key);let z;
        if(typeof av==='number'&&typeof bv==='number')z=av-bv;else z=String(av).localeCompare(String(bv),'pt-BR',{numeric:true,sensitivity:'base'});
        if(!z)z=String(a.card&&a.card.id||a.note.id).localeCompare(String(b.card&&b.card.id||b.note.id),undefined,{numeric:true});return z*dir;
      });
      return out;
    };
  },

  _overrideBrowserRender(){
    AnkiProductParity.renderBrowser=()=>{
      const b=AnkiProductParity.browser,rows=AnkiProductParity._browserRows(),end=Math.min(rows.length,(b.page+1)*AnkiProductParity.PAGE),shown=rows.slice(0,end),list=document.getElementById('anki-browser-list'),defs=this._columnDefs(),cols=this._selectedColumns();
      if(this._renderBrowserControls)this._renderBrowserControls();
      document.getElementById('anki-browser-summary').textContent=rows.length.toLocaleString('pt-BR')+' '+(b.mode==='cards'?'card(s)':'nota(s)')+' exibido(s)';
      const head=document.querySelector('.anki-browser-table-head'),grid='34px '+cols.map(()=> 'minmax(110px,1fr)').join(' ')+' 54px';
      head.style.gridTemplateColumns=grid;head.innerHTML='<span></span>'+cols.map(k=>{const sortable=this._isSortableColumn(k);return '<button type="button" draggable="true" class="anki-browser-col-head '+(sortable?'':'is-unsortable')+'" data-col-drag="'+k+'" '+(sortable?'data-sort-col="'+k+'"':'aria-disabled="true"')+' title="'+(sortable?'Clique para ordenar · arraste para reordenar':'Arraste para reordenar · esta coluna não ordena no Anki')+'">'+AnkiProductParity.esc(defs[k].label)+(b.sort===k?(b.sortDir==='desc'?' ↓':' ↑'):'')+'</button>';}).join('')+'<span></span>';
      head.querySelectorAll('[data-sort-col]').forEach(x=>x.addEventListener('click',()=>{if(b.sort===x.dataset.sortCol)b.sortDir=b.sortDir==='desc'?'asc':'desc';else{b.sort=x.dataset.sortCol;b.sortDir='asc';}this._saveBrowserPrefs();AnkiProductParity.renderBrowser();}));
      head.querySelectorAll('[data-col-drag]').forEach(x=>{
        x.addEventListener('dragstart',e=>{this._dragColumn=x.dataset.colDrag;x.classList.add('is-dragging');if(e.dataTransfer){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',this._dragColumn);}});
        x.addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';});
        x.addEventListener('drop',e=>{e.preventDefault();const from=(e.dataTransfer&&e.dataTransfer.getData('text/plain'))||this._dragColumn;this._reorderColumns(from,x.dataset.colDrag);});
        x.addEventListener('dragend',()=>{this._dragColumn=null;x.classList.remove('is-dragging');});
        x.addEventListener('keydown',e=>{if(!e.altKey||(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'))return;const cs=this._selectedColumns(),i=cs.indexOf(x.dataset.colDrag),j=e.key==='ArrowLeft'?i-1:i+1;if(j<0||j>=cs.length)return;e.preventDefault();this._reorderColumns(cs[i],cs[j]);});
      });
      list.innerHTML=shown.map(r=>{
        const sk=this._selectionKey(r),nid=String(r.note.id),sel=b.selected.has(sk),open=r.card?'data-card-open="'+AnkiProductParity.esc(r.card.id)+'"':'data-note-open="'+AnkiProductParity.esc(nid)+'"';
        const cells=cols.map((k,i)=>'<button type="button" class="anki-browser-cell '+(i===0?'anki-browser-field':'')+'" '+(i===0?open:'')+' title="'+AnkiProductParity.esc(this._formatCol(r,k))+'">'+AnkiProductParity.esc(this._formatCol(r,k))+'</button>').join('');
        return '<div class="anki-browser-row '+(sel?'is-sel':'')+'" style="grid-template-columns:'+grid+'" data-note="'+AnkiProductParity.esc(sk)+'" data-noteid="'+AnkiProductParity.esc(nid)+'">'+
          '<label><input class="anki-browser-row-check" type="checkbox" '+(sel?'checked':'')+'></label>'+cells+
          '<span class="anki-browser-state">'+(r.suspended?'⏸':'')+(r.marked?' ★':'')+'</span></div>';
      }).join('')||'<div class="empty-state"><h3>Nenhum resultado</h3><p>Ajuste a busca ou os filtros.</p></div>';
      const more=document.getElementById('anki-browser-more');more.innerHTML=end<rows.length?'<button type="button" class="btn-secondary" id="anki-browser-more-btn">Carregar mais '+Math.min(AnkiProductParity.PAGE,rows.length-end)+'</button>':'';
      const mb=document.getElementById('anki-browser-more-btn');if(mb)mb.addEventListener('click',()=>{b.page++;AnkiProductParity.renderBrowser();});
      const del=document.getElementById('anki-browser-delete-btn');if(del)del.textContent='Excluir notas';
      AnkiProductParity._syncBrowserBulk(rows);
    };
  },

  previewCard(cardId){
    const c=DB.getCard(cardId),box=document.getElementById('anki-browser-preview');if(!c||!box)return;
    const note=AnkiParity.getNote(AnkiProductParity.noteId(c)),nt=note?AnkiProductParity._typeFor(note):null;
    if(!note||!nt){box.innerHTML='<p class="hint">Card sem nota/tipo.</p>';return;}
    let q='',a='';try{q=AnkiParity.renderTemplate(nt,note,Number(c.ankiTemplateOrd)||0,'question',c,'');a=AnkiParity.renderTemplate(nt,note,Number(c.ankiTemplateOrd)||0,'answer',c,q);}catch(e){a=AnkiProductParity.esc(e.message||e);}
    const frame=(html,side)=>typeof AnkiRuntime!=='undefined'?AnkiRuntime.renderFrame(nt,html,side,c,true,note,CardsConfig.forDeck(c.deckId)):'<div class="cards-face">'+_sanCard(html)+'</div>';
    box.innerHTML='<div class="anki-preview-head"><strong>'+AnkiProductParity.esc(nt.name)+'</strong><span>'+AnkiProductParity.esc(this._templateName({card:c,nt}))+'</span></div>'+
      '<div class="anki-preview-label">Pergunta</div>'+frame(q,'question')+'<div class="anki-preview-label">Resposta</div>'+frame(a,'answer')+
      '<div class="anki-preview-actions"><button type="button" class="btn-primary" id="anki-preview-edit">✎ Editar nota</button><button type="button" class="btn-secondary" id="anki-preview-info">ℹ Info do card</button></div>';
    document.getElementById('anki-preview-edit').onclick=()=>AnkiProductParity.openNoteEditor(note.id);document.getElementById('anki-preview-info').onclick=()=>CardsScreen.cardInfo(c.id);
  },

  _overrideBrowserBulk(){
    const original={
      editTags:AnkiProductParity.editTags.bind(AnkiProductParity),openChangeType:AnkiProductParity.openChangeType.bind(AnkiProductParity),
      deleteNotes:AnkiProductParity.deleteNotes.bind(AnkiProductParity),bulkMark:AnkiProductParity.bulkMark.bind(AnkiProductParity),
      bulkFindReplace:AnkiProductParity.bulkFindReplace.bind(AnkiProductParity)
    };
    AnkiProductParity.editTags=(ids)=>original.editTags(this._resolveSelection(ids).noteIds);
    AnkiProductParity.openChangeType=(ids)=>original.openChangeType(this._resolveSelection(ids).noteIds);
    AnkiProductParity.deleteNotes=(ids)=>original.deleteNotes(this._resolveSelection(ids).noteIds);
    AnkiProductParity.bulkMark=(ids)=>original.bulkMark(this._resolveSelection(ids).noteIds);
    AnkiProductParity.bulkFindReplace=(ids)=>original.bulkFindReplace(this._resolveSelection(ids).noteIds);

    AnkiProductParity.toggleSuspend=(ids)=>{
      const r=this._resolveSelection(ids),cards=r.cards,should=cards.some(c=>!c.suspenso);
      cards.forEach(c=>should?AnkiParity.suspendCard(c.id):DB.updateCard(c.id,{suspenso:false}));CardEngine.invalidateDueCache();AnkiProductParity.renderBrowser();CardsScreen.render();showToast(should?'Card(s) suspenso(s) ✓':'Card(s) reativado(s) ✓');
    };
    AnkiProductParity.bulkFlag=(ids)=>{
      const cards=this._resolveSelection(ids).cards;
      UI.prompt([{key:'flag',label:'Bandeira',type:'select',value:'0',options:[0,1,2,3,4,5,6,7].map(n=>({value:String(n),label:n===0?'Sem bandeira':DB.FLAGS[n].nome}))}],{title:'🚩 Definir bandeira',okText:'Aplicar'}).then(v=>{if(!v)return;cards.forEach(c=>DB.setFlag(c.id,Number(v.flag)||0));AnkiProductParity.renderBrowser();CardsScreen.render();showToast('Bandeiras atualizadas ✓');});
    };
    AnkiProductParity.browserBulkActions=(ids)=>{
      if(!ids.length)return;UI.prompt([{key:'action',label:'Ação',type:'select',value:'mark',options:[
        {value:'mark',label:'★ Marcar/desmarcar notas'},{value:'deck',label:'📁 Mover para baralho'},{value:'due',label:'📅 Definir vencimento'},
        {value:'forget',label:'↺ Esquecer / tornar novos'},{value:'reposition',label:'🔢 Reposicionar novos'},{value:'replace',label:'🔁 Localizar e substituir'}
      ]}],{title:'⋯ Ações do navegador',okText:'Continuar'}).then(v=>{
        if(!v)return;if(v.action==='mark')AnkiProductParity.bulkMark(ids);else if(v.action==='replace')AnkiProductParity.bulkFindReplace(ids);
        else if(v.action==='deck')this._bulkCardsMove(ids);else if(v.action==='due')this._bulkCardsDue(ids);else if(v.action==='forget')this._bulkCardsForget(ids);else if(v.action==='reposition')this._bulkCardsReposition(ids);
      });
    };
  },
  _bulkCardsMove(ids){
    const cards=this._resolveSelection(ids).cards;if(!cards.length)return;
    const origins=new Set(cards.map(c=>String(c._planId||(window.StudyGlobalScope&&StudyGlobalScope.sourcePlanForCard?StudyGlobalScope.sourcePlanForCard(c.id):'')||'')).filter(Boolean));
    if(origins.size>1){showToast('Para mover em lote, selecione cards do mesmo planejamento de origem.');return;}
    const pid=origins.size?[...origins][0]:null,decks=(pid&&DB.getDecksForPlan?DB.getDecksForPlan(pid):DB.getDecks()).filter(d=>!(AnkiParity.isFilteredDeck&&AnkiParity.isFilteredDeck(d)));if(!decks.length)return;
    UI.prompt([{key:'deck',label:'Baralho de destino',type:'select',value:String(decks[0].id),options:decks.map(d=>({value:String(d.id),label:d.nome}))}],{title:'📁 Mover cards',okText:'Mover'}).then(v=>{if(!v)return;cards.forEach(c=>DB.updateCard(c.id,c.originalDeckId?{originalDeckId:v.deck}:{deckId:v.deck}));CardEngine.invalidateDueCache();AnkiProductParity.renderBrowser();CardsScreen.render();showToast(cards.length+' card(s) movido(s) ✓');});
  },
  _bulkCardsDue(ids){
    const cards=this._resolveSelection(ids).cards;if(!cards.length)return;UI.prompt([{key:'days',label:'Vencer daqui a quantos dias?',type:'number',value:'1'}],{title:'📅 Definir vencimento',okText:'Agendar'}).then(v=>{if(!v)return;const d=Math.max(0,Math.round(Number(v.days)||0));cards.forEach(c=>DB.setDueDays(c.id,d));CardEngine.invalidateDueCache();AnkiProductParity.renderBrowser();CardsScreen.render();showToast(cards.length+' card(s) reagendado(s) ✓');});
  },
  _bulkCardsForget(ids){
    const cards=this._resolveSelection(ids).cards;if(!cards.length)return;UI.confirm('Esquecer '+cards.length+' card(s)?',{title:'↺ Esquecer cards',okText:'Esquecer',danger:true}).then(ok=>{if(!ok)return;cards.forEach(c=>DB.forgetCard(c.id));CardEngine.invalidateDueCache();AnkiProductParity.renderBrowser();CardsScreen.render();showToast(cards.length+' card(s) voltaram a ser novos ✓');});
  },
  _bulkCardsReposition(ids){
    const cards=this._resolveSelection(ids).cards.filter(c=>(c.phase||'new')==='new');if(!cards.length){showToast('Nenhum card novo na seleção.');return;}
    UI.prompt([{key:'start',label:'Posição inicial',type:'number',value:'1'},{key:'step',label:'Passo',type:'number',value:'1'}],{title:'🔢 Reposicionar novos',okText:'Aplicar'}).then(v=>{if(!v)return;const start=Math.max(0,Math.round(Number(v.start)||0)),step=Math.max(1,Math.round(Number(v.step)||1));cards.sort((a,b)=>(Number(a.posicaoNova)||0)-(Number(b.posicaoNova)||0)).forEach((c,i)=>DB.updateCard(c.id,{posicaoNova:start+i*step,ankiDue:start+i*step}));CardEngine.invalidateDueCache();AnkiProductParity.renderBrowser();CardsScreen.render();showToast(cards.length+' card(s) reposicionado(s) ✓');});
  },

  /* ───────────────────────── REVIEWER ───────────────────────── */
  _enhanceReviewer(){
    const oldDecorate=AnkiProductParity.decorateReviewer.bind(AnkiProductParity);
    AnkiProductParity.decorateReviewer=()=>{oldDecorate();this._decorateReviewerExact();};

    AnkiProductParity.openReviewerActions=()=>this.openReviewerActions();

    const oldAnswer=CardsScreen.answer.bind(CardsScreen);
    CardsScreen.answer=async(grade)=>{const id=(CardsScreen._reviewQueue||[])[CardsScreen._reviewIdx]||null,ok=await oldAnswer(grade);if(ok===true&&id)this._previousCardId=id;return ok;};

    const oldKey=CardsScreen.onKey.bind(CardsScreen);
    CardsScreen.onKey=(e)=>{if(this._handleReviewerKey(e))return;return oldKey(e);};
  },
  _isMarkedNote(note){return !!note&&(note.tags||[]).some(t=>String(t).toLowerCase()==='marked');},
  _toggleMarkedNote(noteId){
    const n=AnkiParity.getNote(noteId);if(!n)return false;const on=!this._isMarkedNote(n),tags=(n.tags||[]).filter(t=>String(t).toLowerCase()!=='marked');if(on)tags.push('marked');AnkiParity.saveNote(Object.assign({},n,{tags}));return on;
  },
  _decorateReviewerExact(){
    const c=AnkiProductParity._currentReviewCard();if(!c)return;const nid=AnkiProductParity.noteId(c),note=AnkiParity.getNote(nid),mark=document.getElementById('cards-act-mark');
    if(mark){
      const on=this._isMarkedNote(note);mark.textContent=on?'★ Marcada':'☆ Marcar';mark.title='Marcar/desmarcar nota (*)';
      mark.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const now=this._toggleMarkedNote(nid);CardsScreen.renderReviewCard(document.getElementById('cards-content'));showToast(now?'★ Nota marcada':'Marcação removida');},true);
    }
    const bar=document.querySelector('.cards-flagbar');
    if(bar){
      bar.title='Bandeiras (Ctrl+1..7, Ctrl+0 remove)';
      [5,6,7].forEach(n=>{if(bar.querySelector('[data-flag="'+n+'"]'))return;const b=document.createElement('button');b.type='button';b.className='cards-flag '+((c.flag||0)===n?'on':'');b.dataset.flag=String(n);b.style.setProperty('--fl',DB.FLAGS[n].cor);b.title=DB.FLAGS[n].nome+' (Ctrl+'+n+')';b.addEventListener('click',()=>{DB.setFlag(c.id,(c.flag||0)===n?0:n);CardsScreen.renderReviewCard(document.getElementById('cards-content'));});bar.appendChild(b);});
    }
  },
  _reviewActive(e){
    const scr=document.getElementById('screen-cards');if(!scr||!scr.classList.contains('active')||CardsScreen.tab!=='revisar')return false;
    const tag=String(e.target&&e.target.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea'||(e.target&&e.target.isContentEditable))return false;
    return true;
  },
  _handleReviewerKey(e){
    if(!this._reviewActive(e))return false;const c=AnkiProductParity._currentReviewCard();
    if((e.ctrlKey||e.metaKey)&&/^Digit[5-7]$/.test(e.code)&&c){e.preventDefault();DB.setFlag(c.id,Number(e.code.slice(5)));CardsScreen.renderReviewCard(document.getElementById('cards-content'));return true;}
    if(!e.ctrlKey&&!e.metaKey&&!e.altKey){
      if(e.key==='='){e.preventDefault();this.buryNote(c);return true;}
      if(e.key==='!'){e.preventDefault();this.suspendNote(c);return true;}
      if(e.code==='KeyH'){e.preventDefault();this.showHints(false);return true;}
      if(e.code==='KeyG'){e.preventDefault();this.showHints(true);return true;}
      if(e.code==='KeyR'){e.preventDefault();AnkiProductParity.replayMedia(c);return true;}
      if(e.code==='Digit5'){e.preventDefault();if(typeof AnkiRuntime!=='undefined'&&AnkiRuntime.pauseAv)AnkiRuntime.pauseAv();return true;}
      if(e.code==='Digit6'){e.preventDefault();if(typeof AnkiRuntime!=='undefined'&&AnkiRuntime.seekAv)AnkiRuntime.seekAv(-5);return true;}
      if(e.code==='Digit7'){e.preventDefault();if(typeof AnkiRuntime!=='undefined'&&AnkiRuntime.seekAv)AnkiRuntime.seekAv(5);return true;}
      if(e.code==='KeyV'&&e.shiftKey){e.preventDefault();this.openVoiceRecorder();return true;}
      if(e.code==='KeyV'){e.preventDefault();this.replayOwnVoice();return true;}
      if(e.code==='KeyB'){e.preventDefault();AnkiProductParity.openBrowser();return true;}
      if(e.code==='KeyT'){e.preventDefault();const t=document.querySelector('.cards-tab[data-ctab="stats"]');if(t)t.click();return true;}
      if(e.code==='KeyA'&&!e.shiftKey){e.preventDefault();CardsScreen.openCardModal();return true;}
    }
    if((e.ctrlKey||e.metaKey)&&e.altKey&&e.code==='KeyI'){e.preventDefault();this.previousCardInfo();return true;}
    return false;
  },

  _advanceRemoved(ids){
    const bad=new Set((ids||[]).map(String));CardsScreen._reviewQueue=(CardsScreen._reviewQueue||[]).filter(id=>!bad.has(String(id)));CardsScreen._reviewIdx=Math.min(CardsScreen._reviewIdx,CardsScreen._reviewQueue.length);CardEngine.invalidateDueCache();CardsScreen.renderReviewCard(document.getElementById('cards-content'));
  },
  buryNote(card){
    if(!card)return;const cards=AnkiProductParity._cardsForNote(AnkiProductParity.noteId(card));cards.forEach(c=>DB.buryCard(c.id));this._advanceRemoved(cards.map(c=>c.id));showToast('Nota enterrada até amanhã');
  },
  suspendNote(card){
    if(!card)return;const cards=AnkiProductParity._cardsForNote(AnkiProductParity.noteId(card));cards.forEach(c=>AnkiParity.suspendCard(c.id));this._advanceRemoved(cards.map(c=>c.id));showToast('Nota suspensa');
  },
  suspendCard(card){
    if(!card)return;AnkiParity.suspendCard(card.id);this._advanceRemoved([card.id]);showToast('Card suspenso');
  },
  buryCard(card){
    if(!card)return;DB.buryCard(card.id);this._advanceRemoved([card.id]);showToast('Card enterrado até amanhã');
  },
  showHints(all){
    const list=[...document.querySelectorAll('#cards-content details.hint')];if(!list.length){showToast('Nenhuma dica neste lado do card');return;}if(all)list.forEach(x=>x.open=true);else list[0].open=true;
  },
  previousCardInfo(){if(!this._previousCardId){showToast('Nenhum card anterior nesta sessão');return;}CardsScreen.cardInfo(this._previousCardId);},

  openReviewerActions(){
    const c=AnkiProductParity._currentReviewCard();if(!c)return;const opts=[];
    if((CardsScreen._redoStack||[]).length)opts.push({value:'redo',label:'↷ Refazer última ação'});
    opts.push(
      {value:'mark',label:'★ Marcar/desmarcar nota'},{value:'tags',label:'🏷 Editar etiquetas'},
      {value:'buryCard',label:'⤓ Enterrar card'},{value:'buryNote',label:'⤓ Enterrar nota'},
      {value:'suspendCard',label:'🚫 Suspender card'},{value:'suspendNote',label:'🚫 Suspender nota'},
      {value:'hint',label:'💡 Mostrar dica'},{value:'allHints',label:'💡 Mostrar todas as dicas'},
      {value:'media',label:'▶ Repetir mídia'},{value:'tts',label:'🎙 Texto para voz'},
      {value:'recordVoice',label:'🎤 Gravar própria voz'},{value:'replayVoice',label:'🔊 Reproduzir própria voz'},
      {value:'whiteboard',label:'✍ Quadro'},{value:'infoPrev',label:'ℹ Informações do card anterior'},
      {value:'add',label:'＋ Adicionar nota'},{value:'browse',label:'🗃 Navegador'},
      {value:'stats',label:'📊 Estatísticas'},{value:'type',label:'🧩 Mudar tipo de nota'},{value:'deck',label:'⚙ Opções de baralho'}
    );
    UI.prompt([{key:'action',label:'Ação',type:'select',value:opts[0].value,options:opts}],{title:'⋯ Mais ações',okText:'Abrir'}).then(v=>{
      if(!v)return;const nid=AnkiProductParity.noteId(c),a=v.action;
      if(a==='redo')CardsScreen.redoAnswer();else if(a==='mark'){const on=this._toggleMarkedNote(nid);CardsScreen.renderReviewCard(document.getElementById('cards-content'));showToast(on?'★ Nota marcada':'Marcação removida');}
      else if(a==='tags')AnkiProductParity.editTags(['n:'+nid]);else if(a==='buryCard')this.buryCard(c);else if(a==='buryNote')this.buryNote(c);
      else if(a==='suspendCard')this.suspendCard(c);else if(a==='suspendNote')this.suspendNote(c);else if(a==='hint')this.showHints(false);else if(a==='allHints')this.showHints(true);
      else if(a==='media')AnkiProductParity.replayMedia(c);else if(a==='tts')AnkiProductParity.speakCard(c);else if(a==='recordVoice')this.openVoiceRecorder();else if(a==='replayVoice')this.replayOwnVoice();
      else if(a==='whiteboard')AnkiProductParity.openWhiteboard();else if(a==='infoPrev')this.previousCardInfo();else if(a==='add')CardsScreen.openCardModal();else if(a==='browse')AnkiProductParity.openBrowser();
      else if(a==='stats'){const t=document.querySelector('.cards-tab[data-ctab="stats"]');if(t)t.click();}else if(a==='type')AnkiProductParity.openChangeType(['n:'+nid]);else if(a==='deck')CardsScreen.openAlgoConfigFor(c.deckId||null);
    });
  },

  /* ───────────────────────── VOZ PRÓPRIA ───────────────────────── */
  _injectVoiceModal(){
    if(document.getElementById('anki-own-voice-modal'))return;const d=document.createElement('div');d.innerHTML='<div id="anki-own-voice-modal" class="cards-modal anki-product-modal" style="display:none"><div class="cards-modal-box" style="max-width:430px"><div class="cards-modal-head"><div><h2>🎤 Própria voz</h2><p class="sub">Gravação temporária da sessão, como a ação de voz do reviewer.</p></div><button class="icon-btn" id="anki-voice-close">✕</button></div><div class="cards-modal-body"><p id="anki-voice-status" class="hint">Pronto para gravar.</p></div><div class="cards-modal-foot"><button class="btn-secondary" id="anki-voice-record">● Gravar</button><button class="btn-secondary" id="anki-voice-stop" disabled>■ Parar</button><button class="btn-primary" id="anki-voice-replay" disabled>▶ Reproduzir</button></div></div></div>';document.body.appendChild(d);
    document.getElementById('anki-voice-close').onclick=()=>{document.getElementById('anki-own-voice-modal').style.display='none';};
    document.getElementById('anki-voice-record').onclick=()=>this.startOwnVoice();document.getElementById('anki-voice-stop').onclick=()=>this.stopOwnVoice();document.getElementById('anki-voice-replay').onclick=()=>this.replayOwnVoice();
  },
  openVoiceRecorder(){document.getElementById('anki-own-voice-modal').style.display='flex';},
  async startOwnVoice(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){showToast('Gravação de voz indisponível neste navegador');return;}
    try{
      this._voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});this._voiceChunks=[];this._voiceRecorder=new MediaRecorder(this._voiceStream);
      this._voiceRecorder.ondataavailable=e=>{if(e.data&&e.data.size)this._voiceChunks.push(e.data);};
      this._voiceRecorder.onstop=()=>{if(this._voiceUrl)URL.revokeObjectURL(this._voiceUrl);const blob=new Blob(this._voiceChunks,{type:this._voiceRecorder.mimeType||'audio/webm'});this._voiceUrl=URL.createObjectURL(blob);this._voiceStream&&this._voiceStream.getTracks().forEach(t=>t.stop());this._voiceStream=null;document.getElementById('anki-voice-status').textContent='Gravação pronta.';document.getElementById('anki-voice-replay').disabled=false;};
      this._voiceRecorder.start();document.getElementById('anki-voice-status').textContent='Gravando…';document.getElementById('anki-voice-record').disabled=true;document.getElementById('anki-voice-stop').disabled=false;
    }catch(e){showToast('Não foi possível acessar o microfone');}
  },
  stopOwnVoice(){
    if(this._voiceRecorder&&this._voiceRecorder.state!=='inactive')this._voiceRecorder.stop();document.getElementById('anki-voice-record').disabled=false;document.getElementById('anki-voice-stop').disabled=true;
  },
  replayOwnVoice(){if(!this._voiceUrl){showToast('Nenhuma gravação de voz nesta sessão');return;}try{new Audio(this._voiceUrl).play().catch(()=>showToast('Não foi possível reproduzir a gravação'));}catch(_){showToast('Não foi possível reproduzir a gravação');}}
};
queueMicrotask(()=>AnkiMaxParity.install());
