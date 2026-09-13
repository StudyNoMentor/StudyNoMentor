/* ============================================================
   EXTRAS — pilha única de modais, foco e bloqueio de scroll
   ============================================================ */
(() => {
  if (window.__extrasUiHardeningV1) return;
  window.__extrasUiHardeningV1 = true;

  const SEL = '.xsc-overlay,.rg-overlay,.ra-overlay';
  const CLOSE = '.xsc-close,.rg-x,.ra-x,[data-rg-cancel],[data-cancel]';
  const FOCUS = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const openers = new WeakMap();
  let top = null, bodyOverflow = '', bodyPadding = '', locked = false;

  const visible = el => {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const focusables = el => [...el.querySelectorAll(FOCUS)].filter(x => {
    if (x.closest('[inert]')) return false;
    const cs = getComputedStyle(x), r = x.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  });
  const firstFocus = el => focusables(el)[0] || el.querySelector('[role="dialog"]') || el;

  function lockBody(on) {
    if (on && !locked) {
      locked = true;
      bodyOverflow = document.body.style.overflow;
      bodyPadding = document.body.style.paddingRight;
      const gap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      if (gap > 0) {
        const atual = parseFloat(getComputedStyle(document.body).paddingRight) || 0;
        document.body.style.paddingRight = `${atual + gap}px`;
      }
      document.body.style.overflow = 'hidden';
      document.body.classList.add('extras-modal-open');
    } else if (!on && locked) {
      locked = false;
      document.body.style.overflow = bodyOverflow;
      document.body.style.paddingRight = bodyPadding;
      document.body.classList.remove('extras-modal-open');
    }
  }

  function sync() {
    const stack = [...document.querySelectorAll(SEL)].filter(visible);
    lockBody(stack.length > 0);
    stack.forEach((ov, i) => {
      const isTop = i === stack.length - 1;
      ov.style.zIndex = String(1520 + i * 20); // abaixo de --z-toast (3000)
      ov.classList.toggle('extras-layer-top', isTop);
      ov.classList.toggle('extras-layer-background', !isTop);
      if ('inert' in ov) ov.inert = !isTop;
      if (isTop) ov.removeAttribute('aria-hidden'); else ov.setAttribute('aria-hidden', 'true');
    });
    const novo = stack[stack.length - 1] || null;
    if (novo !== top) {
      const anterior = top, openerAnterior = anterior && openers.get(anterior);
      top = novo;
      requestAnimationFrame(() => {
        if (top) {
          const alvo = openerAnterior && openerAnterior.isConnected && top.contains(openerAnterior)
            ? openerAnterior : firstFocus(top);
          if (!document.activeElement || !top.contains(document.activeElement) || alvo === openerAnterior) {
            try { alvo.focus({ preventScroll: true }); } catch (_) { /* melhoria progressiva */ }
          }
        } else if (openerAnterior && openerAnterior.isConnected) {
          try { openerAnterior.focus({ preventScroll: true }); } catch (_) { /* melhoria progressiva */ }
        }
      });
    }
  }
  function markAdded(n) {
    if (!n || n.nodeType !== 1) return;
    const now = document.activeElement;
    if (n.matches?.(SEL)) openers.set(n, now);
    n.querySelectorAll?.(SEL).forEach(x => openers.set(x, now));
  }

  const mo = new MutationObserver(muts => {
    muts.forEach(m => m.addedNodes?.forEach(markAdded));
    // Inserção/remoção de overlay é rara; sincronizar já na microtask evita um
    // frame em que o modal-pai continue inert após o filho fechar.
    sync();
  });
  mo.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('keydown', e => {
    const stack = [...document.querySelectorAll(SEL)].filter(visible);
    const cur = stack[stack.length - 1];
    if (!cur) return;
    if (e.key === 'Escape') {
      const b = cur.querySelector(CLOSE);
      if (b) { e.preventDefault(); e.stopPropagation(); b.click(); }
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables(cur);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], act = document.activeElement;
    if (e.shiftKey && (act === first || !cur.contains(act))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (act === last || !cur.contains(act))) { e.preventDefault(); first.focus(); }
  }, true);

  document.addEventListener('focusin', e => {
    if (top && visible(top) && !top.contains(e.target)) {
      try { firstFocus(top).focus({ preventScroll: true }); } catch (_) { /* sem efeito funcional */ }
    }
  }, true);

  document.querySelectorAll(SEL).forEach(markAdded);
  sync();
  window.ExtrasUiHardening = { sync, selector: SEL };
})();
