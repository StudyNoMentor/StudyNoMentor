/* ============================================================
   RUNTIME ANKI — templates avançados isolados do app
   CSS/JS/HTML do note type rodam em iframe sandboxado SEM
   allow-same-origin: scripts do card não acessam DOM/storage
   do StudyNoMentor, mas continuam funcionais dentro do card.
   ============================================================ */
const AnkiRuntime = {
  _typedAnswers:new Map(),
  _avActive:new Set(),
  isAvPlaying(){return this._avActive.size>0;},
  _frameById(id){return [...document.querySelectorAll('iframe[data-anki-frame-id]')].find(f=>f.dataset.ankiFrameId===String(id))||null;},
  _postFrame(frame,msg){try{if(frame&&frame.contentWindow)frame.contentWindow.postMessage(msg,'*');}catch(_){}},
  replayVisible(includeQuestion){
    const frames=[...document.querySelectorAll('iframe[data-anki-frame-id]')];
    const answer=frames.find(f=>/-answer$/.test(f.dataset.ankiFrameId||'')),question=frames.find(f=>/-question$/.test(f.dataset.ankiFrameId||''));
    if(answer){if(includeQuestion&&question)this._postFrame(question,{type:'snm-anki-replay'});this._postFrame(answer,{type:'snm-anki-replay'});return true;}
    if(question){this._postFrame(question,{type:'snm-anki-replay'});return true;}return false;
  },
  controlVisible(type,value){for(const f of document.querySelectorAll('iframe[data-anki-frame-id]'))this._postFrame(f,{type,value});},
  _parentAvToken:0,_parentAudio:null,_parentUtterance:null,
  _setParentAv(active){
    if(active)this._avActive.add('__parent');else this._avActive.delete('__parent');
    if(!this._avActive.size)try{if(typeof CardsScreen!=='undefined'&&CardsScreen._resumeAutoAdvanceIfReady)CardsScreen._resumeAutoAdvanceIfReady();}catch(_){}
  },
  stopParentAv(){
    this._parentAvToken++;try{if(this._parentAudio){this._parentAudio.pause();this._parentAudio=null;}}catch(_){}
    try{if(typeof speechSynthesis!=='undefined')speechSynthesis.cancel();}catch(_){}
    this._parentUtterance=null;this._setParentAv(false);
  },
  _collectMarkupAv(html){
    if(typeof DOMParser==='undefined')return [];
    const doc=new DOMParser().parseFromString('<body>'+this._ttsMarkup(String(html||''))+'</body>','text/html'),out=[];
    for(const el of doc.body.querySelectorAll('[data-anki-tts],audio,video')){
      if(el.matches('[data-anki-tts]'))out.push({kind:'tts',text:el.textContent||'',spec:el.getAttribute('data-anki-tts')||''});
      else{
        const src=el.getAttribute('src')||(el.querySelector('source')&&el.querySelector('source').getAttribute('src'))||'';
        if(src)out.push({kind:'media',src});
      }
    }
    return out;
  },
  _playParentTts(item,token){
    return new Promise(resolve=>{
      if(token!==this._parentAvToken||typeof speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined')return resolve();
      const u=new SpeechSynthesisUtterance(item.text||''),spec=String(item.spec||''),lm=spec.match(/(?:^|\s)lang=([^\s]+)/i);
      if(lm)u.lang=lm[1];const vm=spec.match(/voices=([^\s]+)/i);
      if(vm&&speechSynthesis.getVoices){const want=vm[1].split(',').map(x=>x.trim().toLowerCase());const v=speechSynthesis.getVoices().find(x=>want.includes(String(x.name||'').toLowerCase()));if(v)u.voice=v;}
      u.onend=u.onerror=()=>{if(this._parentUtterance===u)this._parentUtterance=null;resolve();};this._parentUtterance=u;
      try{speechSynthesis.speak(u);}catch(_){resolve();}
    });
  },
  _playParentMedia(item,token){
    return new Promise(resolve=>{
      if(token!==this._parentAvToken||typeof Audio==='undefined')return resolve();
      let a;try{a=new Audio(item.src);}catch(_){return resolve();}this._parentAudio=a;
      const done=()=>{try{a.removeEventListener('ended',done);a.removeEventListener('error',done);a.removeEventListener('abort',done);}catch(_){}if(this._parentAudio===a)this._parentAudio=null;resolve();};
      a.addEventListener('ended',done,{once:true});a.addEventListener('error',done,{once:true});a.addEventListener('abort',done,{once:true});
      try{const p=a.play();if(p&&p.catch)p.catch(done);}catch(_){done();}
    });
  },
  async playMarkupQueue(markups){
    const items=(Array.isArray(markups)?markups:[markups]).flatMap(x=>this._collectMarkupAv(x));
    this.stopParentAv();if(!items.length)return false;const token=++this._parentAvToken;this._setParentAv(true);
    for(const item of items){if(token!==this._parentAvToken)break;if(item.kind==='tts')await this._playParentTts(item,token);else await this._playParentMedia(item,token);}
    if(token===this._parentAvToken)this._setParentAv(false);return true;
  },
  pauseAv(){
    this.controlVisible('snm-anki-pause');try{if(this._parentAudio)this._parentAudio.paused?this._parentAudio.play():this._parentAudio.pause();else if(typeof speechSynthesis!=='undefined')speechSynthesis.paused?speechSynthesis.resume():speechSynthesis.pause();}catch(_){}
  },
  seekAv(seconds){
    this.controlVisible('snm-anki-seek',Number(seconds)||0);try{if(this._parentAudio)this._parentAudio.currentTime=Math.max(0,(this._parentAudio.currentTime||0)+(Number(seconds)||0));}catch(_){}
  },
  _cardKey(card){return String(card&&(card.ankiId||card.id)||'');},
  clearTyped(card){
    const prefix=this._cardKey(card)+'|';
    for(const k of [...this._typedAnswers.keys()])if(k.startsWith(prefix))this._typedAnswers.delete(k);
  },
  _plain(v){
    if(typeof AnkiParity!=='undefined'&&AnkiParity._stripHtml)return AnkiParity._stripHtml(v);
    return String(v==null?'':v).replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ');
  },
  _escAttr(v) {
    return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },
  _ttsMarkup(html) {
    return String(html || '').replace(/\[anki:tts\s+([^\]]*)\]([\s\S]*?)\[\/anki:tts\]/gi,
      (m, attrs, body) => '<span class="snm-anki-tts" data-anki-tts="' + this._escAttr(attrs) + '">' + body + '</span>');
  },
  _latexMarkup(html) {
    return String(html || '').replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi,(m,x)=>'\\['+x+'\\]')
      .replace(/\[\$\]([\s\S]*?)\[\/\$\]/gi,(m,x)=>'\\('+x+'\\)');
  },
  _needsMath(html) {
    const s=String(html||'');
    return /\\(?:\(|\[|begin\{)/.test(s)||s.includes('$$')||/<anki-mathjax\b/i.test(s);
  },
  _typeKey(v,ignoreDiacritics){
    let s=String(v==null?'':v).normalize('NFC');
    if(ignoreDiacritics)s=s.normalize('NFD').replace(/\p{M}/gu,'').normalize('NFC');
    return s;
  },
  _typeUnits(v,ignoreDiacritics){
    const out=[];
    for(const ch of Array.from(String(v==null?'':v).normalize('NFC'))){
      if(/\p{M}/u.test(ch)&&out.length){
        out[out.length-1].display+=ch;
        out[out.length-1].key=this._typeKey(out[out.length-1].display,ignoreDiacritics);
      }else out.push({display:ch,key:this._typeKey(ch,ignoreDiacritics)});
    }
    return out;
  },
  _typeDiff(typed,correct,ignoreDiacritics){
    const a=this._typeUnits(String(typed||'').trim(),ignoreDiacritics),b=this._typeUnits(String(correct||'').trim(),ignoreDiacritics);
    const normalizedA=a.map(x=>x.key).join(''),normalizedB=b.map(x=>x.key).join('');
    if(normalizedA===normalizedB)return '<span class="typeGood">'+this._escAttr(String(typed||'').trim()||String(correct||'').trim())+'</span>';
    if(a.length>1200||b.length>1200){
      return (a.length?'<span class="typeBad">'+this._escAttr(a.map(x=>x.display).join(''))+'</span>':'')+
        (b.length?'<span class="typeMissed">'+this._escAttr(b.map(x=>x.display).join(''))+'</span>':'');
    }
    const cols=b.length+1,dp=new Uint16Array((a.length+1)*cols);
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--){
      dp[i*cols+j]=a[i].key===b[j].key?dp[(i+1)*cols+j+1]+1:Math.max(dp[(i+1)*cols+j],dp[i*cols+j+1]);
    }
    const ops=[];let i=0,j=0;
    const push=(kind,text)=>{if(!text)return;const last=ops[ops.length-1];if(last&&last.kind===kind)last.text+=text;else ops.push({kind,text});};
    while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i].key===b[j].key){push('typeGood',a[i].display);i++;j++;continue;}
      if(i<a.length&&(j>=b.length||dp[(i+1)*cols+j]>=dp[i*cols+j+1])){push('typeBad',a[i].display);i++;continue;}
      if(j<b.length){push('typeMissed',b[j].display);j++;}
    }
    return ops.map(x=>'<span class="'+x.kind+'">'+this._escAttr(x.text)+'</span>').join('');
  },
  _typeMarkup(html,side,card,note){
    const self=this,key=this._cardKey(card),fields=note&&note.fields||{};
    return String(html||'').replace(/\[\[type:(?:(cloze|nc):)?([^\]]+)\]\]/gi,(m,mode,field)=>{
      field=String(field||'').trim();const mapKey=key+'|'+field,typed=self._typedAnswers.get(mapKey)||'',typeMode=String(mode||'').toLowerCase();
      let correct=String(fields[field]??'');
      if(typeMode==='cloze'&&typeof AnkiParity!=='undefined'&&AnkiParity.clozeOnly){
        const ord=Number(card&&card.clozeOrd)||Number(card&&card.ankiTemplateOrd)+1||1;
        correct=AnkiParity.clozeOnly(correct,ord,false);
      }
      correct=self._plain(correct);
      if(side!=='answer')return '<input id="typeans" class="snm-anki-type-input" data-anki-type-key="'+self._escAttr(key)+'" data-anki-type-field="'+self._escAttr(field)+'" autocomplete="off" spellcheck="false" value="'+self._escAttr(typed)+'">';
      const ignoreDiacritics=typeMode==='nc',same=self._typeKey(typed.trim(),ignoreDiacritics)===self._typeKey(correct.trim(),ignoreDiacritics);
      return '<code id="typeans" class="snm-anki-type-result '+(same?'is-correct':'is-different')+'">'+self._typeDiff(typed,correct,ignoreDiacritics)+'</code>';
    });
  },
  buildSrcdoc(nt, html, side, card, note, options) {
    nt=nt||{}; card=card||{};
    const body=this._typeMarkup(this._latexMarkup(this._ttsMarkup(html)),side,card,note);
    const css=String(nt.css||'.card { font-family: Arial, sans-serif; font-size: 20px; text-align: center; }');
    // Anki 26.09.2 empacota MathJax 3.2.2 e usa o componente tex-chtml-full.
    // A URL é versionada e o service worker a pré-carrega para revisão offline.
    const math=this._needsMath(body)?'<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml-full.js"><\/script>':'';
    const frameId='anki-'+String(card.ankiId||card.id||'')+'-'+String(side||'question');
    const autoPlay=!(options&&options.disableAutoplay);
    const bootstrap='<script>(function(){'+
      'const FRAME_ID='+JSON.stringify(frameId)+';const AUTO_PLAY='+JSON.stringify(autoPlay)+';'+
      'function resize(){try{const h=Math.max(document.documentElement.scrollHeight||0,document.body&&document.body.scrollHeight||0,80);parent.postMessage({type:"snm-anki-frame-height",id:FRAME_ID,height:h},"*");}catch(_){}}'+
      'function voiceFor(spec){const m=String(spec||"").match(/voices=([^\\s]+)/i);if(!m||!window.speechSynthesis)return null;const wanted=m[1].split(",").map(x=>x.trim().toLowerCase());return speechSynthesis.getVoices().find(v=>wanted.includes(String(v.name||"").toLowerCase()))||null;}'+
      'let AV_TOKEN=0,CURRENT_MEDIA=null;function avState(active){try{parent.postMessage({type:"snm-anki-av-state",id:FRAME_ID,active:!!active},"*");}catch(_){}}'+
      'function stopAv(){AV_TOKEN++;try{if(window.speechSynthesis)speechSynthesis.cancel();}catch(_){};try{if(CURRENT_MEDIA){CURRENT_MEDIA.pause();CURRENT_MEDIA=null;}}catch(_){}avState(false);}'+
      'function ttsPromise(el,token){return new Promise(resolve=>{if(token!==AV_TOKEN||!window.speechSynthesis||!window.SpeechSynthesisUtterance)return resolve();const spec=el.getAttribute("data-anki-tts")||"";const u=new SpeechSynthesisUtterance(el.textContent||"");const lm=spec.match(/(?:^|\\s)lang=([^\\s]+)/i);if(lm)u.lang=lm[1];const v=voiceFor(spec);if(v)u.voice=v;u.onend=u.onerror=()=>resolve();try{speechSynthesis.speak(u);}catch(_){resolve();}});}'+
      'function mediaPromise(el,token){return new Promise(resolve=>{if(token!==AV_TOKEN||!el||!el.play)return resolve();CURRENT_MEDIA=el;try{el.currentTime=0;}catch(_){}const done=()=>{el.removeEventListener("ended",done);el.removeEventListener("error",done);el.removeEventListener("abort",done);if(CURRENT_MEDIA===el)CURRENT_MEDIA=null;resolve();};el.addEventListener("ended",done,{once:true});el.addEventListener("error",done,{once:true});el.addEventListener("abort",done,{once:true});try{const p=el.play();if(p&&p.catch)p.catch(done);}catch(_){done();}});}'+
      'function avNodes(){return [...document.querySelectorAll("[data-anki-tts],audio,video")];}'+
      'async function playQueue(nodes){stopAv();const token=++AV_TOKEN;if(!nodes.length)return;avState(true);for(const el of nodes){if(token!==AV_TOKEN)break;if(el.matches&&el.matches("[data-anki-tts]"))await ttsPromise(el,token);else await mediaPromise(el,token);}if(token===AV_TOKEN)avState(false);}'+
      'function replay(){playQueue(avNodes());}'+
      'function initAv(){for(const el of document.querySelectorAll("[data-anki-tts]"))el.addEventListener("click",()=>playQueue([el]));if(AUTO_PLAY)setTimeout(replay,0);}'+
      'function initType(){for(const el of document.querySelectorAll("[data-anki-type-key]")){const send=()=>parent.postMessage({type:"snm-anki-typed",id:FRAME_ID,key:el.dataset.ankiTypeKey,field:el.dataset.ankiTypeField,value:el.value},"*");el.addEventListener("input",send);el.addEventListener("change",send);el.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();send();parent.postMessage({type:"snm-anki-show-answer",id:FRAME_ID,key:el.dataset.ankiTypeKey},"*");}});}}'+      'window.pycmd=function(cmd,cb){try{parent.postMessage({type:"snm-anki-pycmd",id:FRAME_ID,cmd:String(cmd||"")},"*");if(typeof cb==="function")cb(null);}catch(_){}return false;};window.bridgeCommand=window.pycmd;'+
      'addEventListener("message",e=>{const d=e.data||{};if(d.type==="snm-anki-replay")replay();else if(d.type==="snm-anki-pause"){try{if(CURRENT_MEDIA){CURRENT_MEDIA.paused?CURRENT_MEDIA.play():CURRENT_MEDIA.pause();}else if(window.speechSynthesis){speechSynthesis.paused?speechSynthesis.resume():speechSynthesis.pause();}}catch(_){}}else if(d.type==="snm-anki-seek"){try{if(CURRENT_MEDIA)CURRENT_MEDIA.currentTime=Math.max(0,(CURRENT_MEDIA.currentTime||0)+Number(d.value||0));}catch(_){}}});'+
      'addEventListener("load",()=>{initAv();initType();resize();setTimeout(resize,100);setTimeout(resize,500);});addEventListener("beforeunload",stopAv);addEventListener("resize",resize);if(window.ResizeObserver)new ResizeObserver(resize).observe(document.documentElement);new MutationObserver(resize).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});})();<\/script>';
    const csp="default-src data: blob: https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: blob: https:; style-src 'unsafe-inline' data: blob: https:; script-src 'unsafe-inline' data: blob: https:; connect-src https:; frame-src data: blob: https:";
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<meta http-equiv="Content-Security-Policy" content="'+this._escAttr(csp)+'"><base target="_blank">'+
      '<style>html,body{margin:0;padding:0;background:transparent;color:inherit}body{overflow-wrap:anywhere}.snm-anki-tts{cursor:pointer}.snm-anki-type-input{box-sizing:border-box;max-width:100%;padding:.4em .55em;font:inherit}.snm-anki-type-result{display:block;margin:.5em 0;text-align:left;white-space:pre-wrap;font-family:monospace}.snm-anki-type-result.is-correct{outline:1px solid currentColor;padding:.4em}.typeGood{color:#0a0}.typeBad{color:#c62828;text-decoration:line-through}.typeMissed{color:#c62828;text-decoration:underline}</style><style>'+css+'</style>'+math+
      '</head><body class="card '+this._escAttr(side||'question')+'">'+body+bootstrap+'</body></html>';
  },
  renderFrame(nt, html, side, card, visible, note, options) {
    // Iframe oculto ainda executaria JS/TTS. O Anki só executa o lado da
    // resposta quando ela é revelada, então o lado invisível nem é criado.
    if(!visible)return '<div class="cards-anki-frame-placeholder" aria-hidden="true"></div>';
    const id='anki-'+String(card&&(card.ankiId||card.id)||'')+'-'+String(side||'question');
    const srcdoc=this.buildSrcdoc(nt,html,side,card,note,options);
    return '<iframe class="cards-anki-frame" data-anki-frame-id="'+this._escAttr(id)+'" sandbox="allow-scripts allow-forms allow-popups allow-modals" referrerpolicy="no-referrer" title="Card Anki" scrolling="no" srcdoc="'+this._escAttr(srcdoc)+'" style="display:block;width:100%;min-height:96px;border:0;background:transparent"></iframe>';
  },
  _handlePycmd(cmd,frame){
    if(cmd==='ans'){if(typeof CardsScreen!=='undefined'&&!CardsScreen._flipped)CardsScreen.flip(document.getElementById('cards-content'));return true;}
    if(/^ease[1-4]$/.test(cmd)&&typeof CardsScreen!=='undefined'){
      const map={ease1:'errei',ease2:'dificil',ease3:'bom',ease4:'facil'};if(!CardsScreen._flipped)CardsScreen.flip(document.getElementById('cards-content'));else CardsScreen.answer(map[cmd]);return true;
    }
    if(cmd==='edit'){document.getElementById('cards-act-edit')?.click();return true;}
    if(cmd==='more'){if(typeof AnkiPractical10!=='undefined'&&AnkiPractical10.openReviewerActionSheet)AnkiPractical10.openReviewerActionSheet();else document.getElementById('anki-review-more')?.click();return true;}
    if(/^play:[qa]:\d+$/.test(cmd)){
      const [,side,raw]=cmd.split(':'),idx=Math.max(0,Number(raw)||0),id=(CardsScreen._reviewQueue||[])[CardsScreen._reviewIdx],card=id&&DB.getCard(id);
      if(!card||typeof AnkiProductParity==='undefined')return false;
      try{
        const note=AnkiParity.getNote(AnkiProductParity.noteId(card)),nt=note&&AnkiProductParity._typeFor(note),ord=Number(card.ankiTemplateOrd)||0;
        if(!note||!nt)return false;const q=AnkiParity.renderTemplate(nt,note,ord,'question',card,''),a=AnkiParity.renderTemplate(nt,note,ord,'answer',card,q),
          html=side==='q'?q:a,items=this._collectMarkupAv(html),item=items[idx];if(item)this._playSingleParentItem(item);return !!item;
      }catch(_){return false;}
    }
    if(cmd==='repaintNeeded'||cmd==='updateToolbar'||cmd==='statesMutated')return true;
    try{if(globalThis.AnkiStudyExtensions)globalThis.AnkiStudyExtensions.emit('pycmd',{cmd,cardId:(CardsScreen._reviewQueue||[])[CardsScreen._reviewIdx]||null});}catch(_){}
    return false;
  },
  async _playSingleParentItem(item){
    this.stopParentAv();const token=++this._parentAvToken;this._setParentAv(true);
    if(item.kind==='tts')await this._playParentTts(item,token);else await this._playParentMedia(item,token);
    if(token===this._parentAvToken)this._setParentAv(false);
  },
  init() {
    if(typeof window==='undefined'||!window.addEventListener)return;
    window.addEventListener('message',(ev)=>{const d=ev&&ev.data;if(!d||!d.id)return;const frames=document.querySelectorAll('iframe[data-anki-frame-id]');let trusted=false,frame=null;for(const f of frames){if(f.contentWindow===ev.source&&f.dataset.ankiFrameId===String(d.id)){trusted=true;frame=f;break;}}if(!trusted)return;if(d.type==='snm-anki-frame-height'){const h=Math.max(80,Math.min(12000,Number(d.height)||0));if(h&&frame)frame.style.height=h+'px';}else if(d.type==='snm-anki-typed'&&d.key&&d.field){this._typedAnswers.set(String(d.key)+'|'+String(d.field),String(d.value||''));}else if(d.type==='snm-anki-show-answer'){try{if(typeof CardsScreen!=='undefined'&&!CardsScreen._flipped)CardsScreen.flip(document.getElementById('cards-content'));}catch(_){}}else if(d.type==='snm-anki-av-state'){if(d.active)this._avActive.add(String(d.id));else this._avActive.delete(String(d.id));if(!this._avActive.size)try{if(typeof CardsScreen!=='undefined'&&CardsScreen._resumeAutoAdvanceIfReady)CardsScreen._resumeAutoAdvanceIfReady();}catch(_){}}else if(d.type==='snm-anki-pycmd'){this._handlePycmd(String(d.cmd||''),frame);}});
  }
};
AnkiRuntime.init();
try{globalThis.AnkiRuntime=AnkiRuntime;}catch(_){}
