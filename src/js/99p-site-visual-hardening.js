/* ============================================================================
   VISUAL HARDENING — componentes dinâmicos
   ----------------------------------------------------------------------------
   Algumas telas criam HTML em runtime e trazem `font-size` inline/important de
   versões antigas. A camada CSS global não consegue vencer inline !important.
   Este guard aplica somente invariantes de apresentação aos nós já renderizados:
   piso de leitura para texto real e correções de opacidade conhecidas.
   Não toca dados, regras de negócio, visibilidade, conteúdo ou dimensões de layout.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__siteVisualHardeningRuntime) return;
  window.__siteVisualHardeningRuntime = true;

  const FLOOR = 10.5;
  let timer = 0;
  const textualTags = new Set(['SMALL','SPAN','B','STRONG','LABEL','BUTTON','DIV','P','EM']);
  const skip = '.sr-only,[aria-hidden="true"],pre,code,kbd,samp,.tab-icon,.gf-ico,.app-loading-spin,.status-swatch';
  const emojiOnly = /^\s*[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+\s*$/u;

  function readableText(el) {
    if (!el || !textualTags.has(el.tagName) || el.matches(skip) || el.closest('.sr-only,pre,code,kbd,samp')) return false;
    const t = String(el.innerText || el.textContent || '').replace(/\s+/g,' ').trim();
    return t.length > 1 && !emojiOnly.test(t);
  }

  function enforceFontFloor(root) {
    const nodes = root && root.matches && root.matches('.screen') ? [root, ...root.querySelectorAll('*')] : [...document.querySelectorAll('.screen.active *,.screen:not([hidden]) *')];
    for (const el of nodes) {
      if (!readableText(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const fs = parseFloat(cs.fontSize) || 0;
      if (fs > 0 && fs < 9.75) el.style.setProperty('font-size', FLOOR + 'px', 'important');
    }
  }

  function enforceKnownOpacity(root=document) {
    const q = sel => root.querySelectorAll ? root.querySelectorAll(sel) : [];
    for (const el of q('#screen-conquistas .bi,#screen-integracaotec .trt-empty,#screen-cards #cards-filter-card,#screen-extras #extras-suggest-btn')) {
      if (!el.matches(':disabled,[disabled]') && !el.closest('[disabled],[aria-disabled="true"]')) el.style.setProperty('opacity','1','important');
    }
  }

  function run(root=document) {
    try { enforceFontFloor(root); enforceKnownOpacity(root); }
    catch (e) { try { if (typeof _quiet === 'function') _quiet(e,'site-visual-hardening'); } catch (_) { void _; } }
  }

  function schedule(root=document) {
    clearTimeout(timer);
    timer = setTimeout(() => run(root), 70);
  }

  const boot = () => {
    run(document);
    const target = document.querySelector('.main-content') || document.body;
    if (!target || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(records => {
      let relevant = false;
      for (const rec of records) {
        if (rec.type === 'childList' && rec.addedNodes.length) { relevant = true; break; }
        if (rec.type === 'attributes' && ['class','style','hidden'].includes(rec.attributeName)) { relevant = true; break; }
      }
      if (relevant) schedule(document);
    });
    observer.observe(target,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
    window.addEventListener('site:screen-changed',() => schedule(document),{passive:true});
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
