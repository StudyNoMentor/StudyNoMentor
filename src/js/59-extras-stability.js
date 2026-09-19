/* ============================================================
   EXTRAS — estabilidade de modais + performance do reforço adaptativo
   Corrige sobreposições e elimina recomputações quadráticas no Plano.
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__extrasStability) return;
  if (typeof window !== 'undefined') window.__extrasStability = true;

  const OVERLAY_SELECTOR = '.xsc-overlay,.rg-overlay,.ra-overlay';
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const CLOSE_SELECTOR = '.ra-x,.rg-x,.xsc-close,[data-cancel],[data-rg-cancel]';
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v)));
  const median = (a) => {
    const x = (a || []).filter(Number.isFinite).slice().sort((m,n)=>m-n);
    if (!x.length) return null;
    const i = x.length >> 1;
    return x.length % 2 ? x[i] : (x[i-1] + x[i]) / 2;
  };
  const norm = (s) => {
    try { return typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm ? ReforcoEngine.norm(s || '') : String(s || '').toLowerCase().trim(); }
    catch (_) { return String(s || '').toLowerCase().trim(); }
  };

  /* Pilha única de modais de Extras. A posição é recalculada a partir dos
     overlays PRESENTES, em vez de crescer a cada abertura: mesmo após milhares
     de usos ela permanece na faixa de modal e nunca ultrapassa toast/bloqueio. */
  const OverlayStack = {
    base: 1520,
    observer: null,
    top: null,
    openers: new WeakMap(),
    bodyState: null,
    _visible(el) {
      if (!el || el.isConnected === false) return false;
      const cs = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) return false;
      return true;
    },
    _focusables(el) {
      if (!el || !el.querySelectorAll) return [];
      return [...el.querySelectorAll(FOCUSABLE)].filter(x => {
        if (x.closest && x.closest('[inert]')) return false;
        if (typeof getComputedStyle !== 'function') return true;
        const cs=getComputedStyle(x),r=x.getBoundingClientRect();
        return cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0;
      });
    },
    _focusFirst(el) {
      const f=this._focusables(el), alvo=f[0] || el?.querySelector?.('[role="dialog"]') || el;
      if (alvo && alvo.focus) { try { alvo.focus({preventScroll:true}); } catch (_) { /* melhoria progressiva */ } }
    },
    _lock(on) {
      if (typeof document === 'undefined') return;
      const html=document.documentElement, body=document.body;
      if (on && !this.bodyState) {
        const state={overflow:body.style.overflow,paddingRight:body.style.paddingRight};
        const gap=Math.max(0,(typeof innerWidth==='number'?innerWidth:html.clientWidth)-html.clientWidth);
        if(gap>0){const atual=parseFloat(getComputedStyle(body).paddingRight)||0;body.style.paddingRight=`${atual+gap}px`;}
        body.style.overflow='hidden'; this.bodyState=state; html.classList.add('extras-modal-open');
      } else if (!on && this.bodyState) {
        body.style.overflow=this.bodyState.overflow; body.style.paddingRight=this.bodyState.paddingRight;
        this.bodyState=null; html.classList.remove('extras-modal-open');
      }
    },
    register(el) {
      if (!el || el.nodeType !== 1 || !el.matches || !el.matches(OVERLAY_SELECTOR)) return;
      if (!this.openers.has(el)) this.openers.set(el, document.activeElement);
      this.sync();
    },
    list() {
      if (typeof document === 'undefined') return [];
      return [...document.querySelectorAll(OVERLAY_SELECTOR)].filter(x => this._visible(x));
    },
    sync() {
      if (typeof document === 'undefined') return;
      const list=this.list(), novo=list[list.length-1]||null, anterior=this.top;
      list.forEach((el,i)=>{
        const active=el===novo;
        el.style.zIndex=String(this.base+i*20);
        el.classList.toggle('extras-overlay-background',!active);
        try{el.inert=!active;}catch(_){/* navegador antigo */}
        if(active)el.removeAttribute('aria-hidden');else el.setAttribute('aria-hidden','true');
      });
      this._lock(!!list.length); this.top=novo;
      if(novo!==anterior){
        const opener=anterior&&this.openers.get(anterior);
        requestAnimationFrame(()=>{
          if(this.top){
            if(opener&&opener.isConnected&&this.top.contains(opener)){try{opener.focus({preventScroll:true});}catch(e){if(typeof _quiet==='function')_quiet(e,'extras-overlay-focus');}}
            else if(!document.activeElement||!this.top.contains(document.activeElement))this._focusFirst(this.top);
          }else if(opener&&opener.isConnected){try{opener.focus({preventScroll:true});}catch(e){if(typeof _quiet==='function')_quiet(e,'extras-overlay-focus');}}
        });
      }
    },
    install() {
      if (typeof document === 'undefined') return;
      document.querySelectorAll(OVERLAY_SELECTOR).forEach(x=>this.register(x));
      if (typeof MutationObserver !== 'undefined' && !this.observer) {
        this.observer=new MutationObserver(records=>{
          records.forEach(r=>[...(r.addedNodes||[])].forEach(n=>{
            if(!n||n.nodeType!==1)return;
            if(n.matches&&n.matches(OVERLAY_SELECTOR))this.register(n);
            if(n.querySelectorAll)n.querySelectorAll(OVERLAY_SELECTOR).forEach(x=>this.register(x));
          }));
          /* síncrono na microtask: o modal-pai nunca fica inert por um frame
             depois que o filho é removido. */
          this.sync();
        });
        this.observer.observe(document.body||document.documentElement,{childList:true,subtree:true});
      }
      document.addEventListener('keydown',e=>{
        const top=this.list().pop(); if(!top)return;
        if(e.key==='Escape'){
          const btn=top.querySelector(CLOSE_SELECTOR);if(btn){e.preventDefault();e.stopPropagation();btn.click();}
          return;
        }
        if(e.key!=='Tab')return;
        const f=this._focusables(top);if(!f.length){e.preventDefault();return;}
        const first=f[0],last=f[f.length-1],act=document.activeElement;
        if(e.shiftKey&&(act===first||!top.contains(act))){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&(act===last||!top.contains(act))){e.preventDefault();first.focus();}
      },true);
      document.addEventListener('focusin',e=>{
        const top=this.list().pop();
        if(top&&!top.contains(e.target))this._focusFirst(top);
      },true);
    }
  };
  OverlayStack.install();
  if (typeof window !== 'undefined') window.ExtrasOverlayStack = OverlayStack;

})();
