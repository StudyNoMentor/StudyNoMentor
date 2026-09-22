/* ============================================================
   RUNTIME ANKI — templates avançados isolados do app
   CSS/JS/HTML do note type rodam em iframe sandboxado SEM
   allow-same-origin: scripts do card não acessam DOM/storage
   do StudyNoMentor, mas continuam funcionais dentro do card.
   ============================================================ */
const AnkiRuntime = {
  _escAttr(v) {
    return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },
  _ttsMarkup(html) {
    return String(html || '').replace(/\[anki:tts\s+([^\]]*)\]([\s\S]*?)\[\/anki:tts\]/gi,
      (m, attrs, body) => '<span class="snm-anki-tts" data-anki-tts="' + this._escAttr(attrs) + '">' + body + '</span>');
  },
  _latexMarkup(html) {
    return String(html || '').replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi,(m,x)=>'\\\\['+x+'\\\\]')
      .replace(/\[\$\]([\s\S]*?)\[\/\$\]/gi,(m,x)=>'\\\\('+x+'\\\\)');
  },
  _needsMath(html) {
    return /(?:\\\\\(|\\\\\[|\$\$|\\\\begin\{|<anki-mathjax\b)/.test(String(html || ''));
  },
  buildSrcdoc(nt, html, side, card) {
    nt=nt||{}; card=card||{};
    const body=this._latexMarkup(this._ttsMarkup(html));
    const css=String(nt.css||'.card { font-family: Arial, sans-serif; font-size: 20px; text-align: center; }');
    const math=this._needsMath(body)?'<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"><\/script>':'';
    const frameId='anki-'+String(card.ankiId||card.id||'')+'-'+String(side||'question');
    const bootstrap='<script>(function(){'+
      'const FRAME_ID='+JSON.stringify(frameId)+';'+
      'function resize(){try{const h=Math.max(document.documentElement.scrollHeight||0,document.body&&document.body.scrollHeight||0,80);parent.postMessage({type:"snm-anki-frame-height",id:FRAME_ID,height:h},"*");}catch(_){}}'+
      'function voiceFor(spec){const m=String(spec||"").match(/voices=([^\\s]+)/i);if(!m||!window.speechSynthesis)return null;const wanted=m[1].split(",").map(x=>x.trim().toLowerCase());return speechSynthesis.getVoices().find(v=>wanted.includes(String(v.name||"").toLowerCase()))||null;}'+
      'function speak(el){if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return;const spec=el.getAttribute("data-anki-tts")||"";const u=new SpeechSynthesisUtterance(el.textContent||"");const lm=spec.match(/(?:^|\\s)lang=([^\\s]+)/i);if(lm)u.lang=lm[1];const v=voiceFor(spec);if(v)u.voice=v;speechSynthesis.speak(u);}'+
      'function initTts(){const nodes=[...document.querySelectorAll("[data-anki-tts]")];nodes.forEach(el=>el.addEventListener("click",()=>speak(el)));if(nodes.length)setTimeout(()=>speak(nodes[0]),0);}'+
      'addEventListener("load",()=>{initTts();resize();setTimeout(resize,100);setTimeout(resize,500);});addEventListener("resize",resize);if(window.ResizeObserver)new ResizeObserver(resize).observe(document.documentElement);new MutationObserver(resize).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});})();<\/script>';
    const csp="default-src data: blob: https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: blob: https:; style-src 'unsafe-inline' data: blob: https:; script-src 'unsafe-inline' data: blob: https:; connect-src https:; frame-src data: blob: https:";
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<meta http-equiv="Content-Security-Policy" content="'+this._escAttr(csp)+'"><base target="_blank">'+
      '<style>html,body{margin:0;padding:0;background:transparent;color:inherit}body{overflow-wrap:anywhere}.snm-anki-tts{cursor:pointer}</style><style>'+css+'</style>'+math+
      '</head><body class="card '+this._escAttr(side||'question')+'">'+body+bootstrap+'</body></html>';
  },
  renderFrame(nt, html, side, card, visible) {
    // Iframe oculto ainda executaria JS/TTS. O Anki só executa o lado da
    // resposta quando ela é revelada, então o lado invisível nem é criado.
    if(!visible)return '<div class="cards-anki-frame-placeholder" aria-hidden="true"></div>';
    const id='anki-'+String(card&&(card.ankiId||card.id)||'')+'-'+String(side||'question');
    const srcdoc=this.buildSrcdoc(nt,html,side,card);
    return '<iframe class="cards-anki-frame" data-anki-frame-id="'+this._escAttr(id)+'" sandbox="allow-scripts allow-forms allow-popups allow-modals" referrerpolicy="no-referrer" title="Card Anki" scrolling="no" srcdoc="'+this._escAttr(srcdoc)+'" style="display:block;width:100%;min-height:96px;border:0;background:transparent"></iframe>';
  },
  init() {
    if(typeof window==='undefined'||!window.addEventListener)return;
    window.addEventListener('message',(ev)=>{const d=ev&&ev.data;if(!d||d.type!=='snm-anki-frame-height'||!d.id)return;const frames=document.querySelectorAll('iframe[data-anki-frame-id]');for(const f of frames){if(f.contentWindow===ev.source&&f.dataset.ankiFrameId===String(d.id)){const h=Math.max(80,Math.min(12000,Number(d.height)||0));if(h)f.style.height=h+'px';break;}}});
  }
};
AnkiRuntime.init();
try{globalThis.AnkiRuntime=AnkiRuntime;}catch(_){}
