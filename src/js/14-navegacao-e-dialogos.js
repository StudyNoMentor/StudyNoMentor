/* ============================================================
   NAVEGAÇÃO ENTRE TELAS
   ============================================================ */
/* Região de anúncio: leitores de tela precisam ser AVISADOS quando a tela troca.
   Numa SPA não há navegação de página, então nada é anunciado por padrão — o
   usuário de leitor de tela clicava numa aba e não recebia retorno nenhum. */
function _anunciar(texto) {
  try {
    let r = document.getElementById('sr-anuncio');
    if (!r) {
      r = document.createElement('div');
      r.id = 'sr-anuncio';
      r.setAttribute('role', 'status');
      r.setAttribute('aria-live', 'polite');
      r.setAttribute('aria-atomic', 'true');
      r.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
      document.body.appendChild(r);
    }
    r.textContent = '';
    setTimeout(() => { r.textContent = texto; }, 60);   // reescrita força o anúncio
  } catch (e) { _quiet(e, 'anunciar'); }
}
window._anunciar = _anunciar;

function switchScreen(name) {
  // Valida ANTES de desativar: com um nome inválido (link/hash quebrado), o código
  // antigo já tinha removido o 'active' de tudo e lançava erro — a tela ficava em branco.
  const alvo = document.getElementById('screen-' + name);
  if (!alvo) { console.warn('Tela inexistente:', name); return; }
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.removeAttribute('aria-hidden'); });
  /* aria-current="page" é como o leitor de tela informa QUAL item da navegação
     corresponde ao conteúdo exibido. Sem ele, todas as abas soavam idênticas e
     não havia como saber onde se estava. A classe .active é só visual. */
  document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.removeAttribute('aria-current'); });
  alvo.classList.add('active');
  const tabBtn = document.querySelector(`.tab[data-screen="${name}"]`);
  if (tabBtn) {
    tabBtn.classList.add('active');
    tabBtn.setAttribute('aria-current', 'page');
    // Só no MOBILE (barra HORIZONTAL no rodapé) centralizamos a aba ativa. No
    // desktop o menu é VERTICAL: scrollIntoView ali rolava a PÁGINA até o item
    // (era o que levava "Conquistas" para o meio/fim da tela). Restringimos.
    const tabsEl = document.getElementById('tabs');
    const isBottomBar = window.matchMedia && window.matchMedia('(max-width: 860px)').matches;
    if (isBottomBar && tabsEl && tabsEl.scrollWidth > tabsEl.clientWidth + 4) {
      try { tabBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (_) { _quiet(_); }
    }
  }
  /* Numa SPA não há navegação de página: sem isto, o leitor de tela não anuncia
     nada ao trocar de aba. O rótulo sai da própria aba (ou do título da tela). */
  try {
    const rotulo = (tabBtn && (tabBtn.querySelector('.tab-label') || {}).textContent)
      || (alvo.querySelector('h1, h2') || {}).textContent || name;
    _anunciar(String(rotulo).trim() + ' — tela aberta');
  } catch (e) { _quiet(e, 'anuncio-tela'); }
  const wrap = document.querySelector('.content-wrap');
  if (wrap) wrap.classList.toggle('wide', name === 'estudonovo' || name === 'ciclo' || name === 'grade');
  // ao sair de Registrar, remove a largura extra da visão tabela (evita "vazar" para outras telas)
  if (wrap && name !== 'registrar') wrap.classList.remove('wrap-reg-table');
  // a Grade Semanal renderiza a bandeja + grade ao ficar visível
  if (name === 'grade' && window.GradeScreen) window.GradeScreen.render();
  // dispara evento para a tela recarregar seus dados ao ficar visível
  window.dispatchEvent(new CustomEvent('screen:activated', { detail: { screen: name } }));
  // Começa SEMPRE do topo. Rola DEPOIS do render da tela (o screen:activated pode
  // inserir muito conteúdo, ex.: Conquistas) — por isso usamos rAF duplo, para o
  // scroll acontecer após o layout final. Sem isto, a página abria "no meio".
  const toTop = () => { try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) { _quiet(_); } };
  toTop();
  requestAnimationFrame(() => { toTop(); requestAnimationFrame(toTop); });
}

$id('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  switchScreen(btn.dataset.screen);
});

/* ============================================================
   TOAST util (compartilhado)
   ============================================================ */
/* ═══════════════ ACESSIBILIDADE — Aprisionamento de foco em modais ═══════════════
   WCAG 2.4.3 / 2.1.2: com um modal aberto, o Tab deve CICLAR dentro dele, o Esc
   deve fechar, e o foco deve VOLTAR para quem abriu. Em vez de tocar em cada um
   dos ~20 modais, um único observador detecta quando um contêiner de modal fica
   visível (display != none) e ativa/desativa o trap automaticamente. */
const FocusTrap = {
  _stack: [],                 // pilha de modais ativos (o topo é o que recebe o trap)
  _lastFocus: null,           // elemento que tinha o foco antes de abrir
  MODAL_SELECTOR: '.profile-modal, .cards-modal, .siglas-modal, .niv-modal, .tec-modal, .ui-modal, .report-modal, #ui-modal, .single-session-overlay, .occ-del-modal',
  FOCUSABLE: 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  // NÃO usa offsetParent: elementos position:fixed têm offsetParent=null mesmo
  // visíveis. Checa display/visibility computados e tamanho real.
  _visible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  },
  _focusables(modal) {
    return Array.from(modal.querySelectorAll(this.FOCUSABLE)).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.hasAttribute('aria-hidden');
    });
  },
  activate(modal) {
    if (this._stack.includes(modal)) return;
    if (this._stack.length === 0) this._lastFocus = document.activeElement;
    this._stack.push(modal);
    // semântica ARIA de diálogo
    if (!modal.getAttribute('role')) modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    // foca o primeiro elemento útil (ou o próprio modal)
    const f = this._focusables(modal);
    setTimeout(() => { try { (f[0] || modal).focus(); } catch (_) { _quiet(_); } }, 30);
  },
  deactivate(modal) {
    const i = this._stack.indexOf(modal);
    if (i === -1) return;
    this._stack.splice(i, 1);
    modal.removeAttribute('aria-modal');
    // restaura o foco quando não há mais modais abertos
    if (this._stack.length === 0 && this._lastFocus) {
      try { this._lastFocus.focus(); } catch (_) { _quiet(_); }
      this._lastFocus = null;
    }
  },
  _onKeydown(e) {
    const top = FocusTrap._stack[FocusTrap._stack.length - 1];
    if (!top) return;
    if (e.key === 'Tab') {
      const f = FocusTrap._focusables(top);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], act = document.activeElement;
      if (e.shiftKey && (act === first || !top.contains(act))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (act === last || !top.contains(act))) { e.preventDefault(); first.focus(); }
    }
    // Esc: fecha o modal do topo clicando no seu botão de fechar/cancelar, se houver.
    else if (e.key === 'Escape') {
      const btn = top.querySelector('[id$="-close"], [id$="-cancel"], .modal-close, [data-close]');
      if (btn) { e.stopPropagation(); btn.click(); }
    }
  },
  init() {
    document.addEventListener('keydown', this._onKeydown, true);
    // Observa mudanças de display/style em todos os contêineres de modal
    const observe = (modal) => {
      /* _visible() chama getComputedStyle + getBoundingClientRect: cada uma força
         o navegador a recalcular layout na hora. Chamar isso a cada mutação de
         atributo de cada modal era caro durante re-renderizações rápidas.
         Agrupamos num requestAnimationFrame: várias mutações no mesmo frame
         viram UMA verificação, feita quando o layout já está resolvido. */
      let agendado = false;
      const mo = new MutationObserver(() => {
        if (agendado) return;
        agendado = true;
        requestAnimationFrame(() => {
          agendado = false;
          if (this._visible(modal)) this.activate(modal); else this.deactivate(modal);
        });
      });
      mo.observe(modal, { attributes: true, attributeFilter: ['style', 'class'] });
      // estado inicial
      if (this._visible(modal)) this.activate(modal);
    };
    document.querySelectorAll(this.MODAL_SELECTOR).forEach(observe);
    // modais criados/movidos depois (ex.: profile-modal realocado) também entram
    const bodyMo = new MutationObserver((muts) => {
      muts.forEach(m => m.addedNodes && m.addedNodes.forEach(n => {
        if (n.nodeType === 1) {
          if (n.matches && n.matches(this.MODAL_SELECTOR)) observe(n);
          n.querySelectorAll && n.querySelectorAll(this.MODAL_SELECTOR).forEach(observe);
        }
      }));
    });
    bodyMo.observe(document.body, { childList: true, subtree: true });
  }
};

let _toastTimer = null;
function showToast(text) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  $id('toast-text').textContent = text;
  toast.classList.add('show');
  // BUG CORRIGIDO: o timer do toast anterior não era cancelado, então dois toasts
  // em <2,4s faziam o primeiro timer apagar o segundo antes da hora.
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ============================================================
//  UI — Diálogos bonitos (substituem confirm/prompt do navegador)
//  UI.confirm(msg, {title, okText, danger}) -> Promise<boolean>
//  UI.prompt(fields, {title, okText}) -> Promise<values|null>
//    fields: [{ key, label, type('text'|'number'|'textarea'|'select'), value, options, placeholder, hint }]
// ============================================================
const UI = {
  _resolve: null,
  _open(title, sub, bodyHtml, { okText = 'Confirmar', cancelText = 'Cancelar', danger = false, hideCancel = false } = {}) {
    const modal = document.getElementById('ui-modal');
    $id('ui-modal-title').textContent = title || '';
    const subEl = document.getElementById('ui-modal-sub');
    if (sub) { subEl.textContent = sub; subEl.style.display = 'block'; } else subEl.style.display = 'none';
    $id('ui-modal-body').innerHTML = bodyHtml || '';
    const ok = document.getElementById('ui-modal-ok');
    ok.textContent = okText;
    ok.className = 'btn-primary' + (danger ? ' btn-danger' : '');
    ok.disabled = false;   // confirmTyped desabilita; um dialogo comum sempre nasce habilitado
    const cancel = document.getElementById('ui-modal-cancel');
    cancel.textContent = cancelText;
    /* Devolve o display do CSS em vez de cravar 'inline-flex'. Num botao que e
       container flex, `text-align: center` NAO vale — o texto vai para o inicio
       da linha. Era por isso que "Cancelar" aparecia encostado a esquerda
       enquanto "Salvar", que continuou block, ficava centrado. */
    cancel.style.display = hideCancel ? 'none' : '';
    modal.style.display = 'flex';
    const first = modal.querySelector('.cards-modal-body input, .cards-modal-body textarea, .cards-modal-body select');
    if (first) setTimeout(() => first.focus(), 60);
  },
  _close() { $id('ui-modal').style.display = 'none'; },
  confirm(message, opts = {}) {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._mode = 'confirm';
      const body = `<p style="margin:0; font-size:14px; line-height:1.55; color:var(--text-soft); white-space:pre-line;">${escapeHtml(message)}</p>`;
      this._open(opts.title || 'Confirmar', opts.sub || '', body, { okText: opts.okText || 'Confirmar', danger: opts.danger });
    });
  },
  /* Confirmacao COM PALAVRA DIGITADA — para limpezas gerais (apagar a grade
     inteira, um planejamento, um perfil, os dados locais). Um toque acidental
     no botao nao basta: o usuario precisa escrever a palavra exata. O botao so
     habilita quando o texto confere, entao nao ha como "confirmar sem querer". */
  confirmTyped(message, opts = {}) {
    const palavra = String(opts.word || 'APAGAR').toUpperCase();
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._mode = 'confirm';
      const body = `
        <p style="margin:0 0 14px; font-size:14px; line-height:1.55; color:var(--text-soft); white-space:pre-line;">${escapeHtml(message)}</p>
        <div class="ui-typed">
          <label for="ui-typed-input">Para confirmar, digite <strong>${escapeHtml(palavra)}</strong></label>
          <input type="text" id="ui-typed-input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${escapeHtml(palavra)}">
          <p class="ui-typed-hint" id="ui-typed-hint">Esta ação não pode ser desfeita.</p>
        </div>`;
      this._open(opts.title || 'Confirmar limpeza', opts.sub || '', body, { okText: opts.okText || 'Confirmar', danger: true });
      const ok = document.getElementById('ui-modal-ok');
      const inp = document.getElementById('ui-typed-input');
      const hint = document.getElementById('ui-typed-hint');
      if (!ok || !inp) return;
      ok.disabled = true;
      const check = () => {
        const bate = inp.value.trim().toUpperCase() === palavra;
        ok.disabled = !bate;
        inp.classList.toggle('ok', bate);
        if (hint) hint.textContent = bate ? '✓ Confirmado — pode prosseguir.' : 'Esta ação não pode ser desfeita.';
      };
      inp.addEventListener('input', check);
      /* Enter so vale quando a palavra confere: o atalho global de Enter do
         modal enviaria o formulario com o campo vazio. */
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ok.disabled) e.stopPropagation(); });
      setTimeout(() => { try { inp.focus(); } catch (_) { _quiet(_); } }, 70);
    });
  },
  alert(message, opts = {}) {
    return new Promise((resolve) => {
      this._resolve = resolve; this._mode = 'confirm';
      // opts.html: conteúdo já montado por nós (ex.: Informações do card).
      // Continua passando pelo saneador, então nada vindo de card importado executa.
      const body = opts.html
        ? `<div style="font-size:13px;line-height:1.5;color:var(--text)">${_sanCard(message)}</div>`
        : `<p style="margin:0; font-size:14px; line-height:1.55; color:var(--text-soft); white-space:pre-line;">${escapeHtml(message)}</p>`;
      this._open(opts.title || 'Aviso', opts.sub || '', body, { okText: opts.okText || 'OK', hideCancel: true });
    });
  },
  prompt(fields, opts = {}) {
    return new Promise((resolve) => {
      this._resolve = resolve; this._mode = 'prompt'; this._fields = fields;
      const body = fields.map(f => {
        const id = 'uip_' + f.key;
        let input;
        if (f.type === 'textarea') input = `<textarea id="${id}" rows="${f.rows || 4}" placeholder="${escapeHtml(f.placeholder || '')}">${escapeHtml(f.value != null ? String(f.value) : '')}</textarea>`;
        else if (f.type === 'select') input = `<select id="${id}">${(f.options || []).map(o => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(f.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
        else input = `<input type="${f.type || 'text'}" id="${id}" value="${escapeHtml(f.value != null ? String(f.value) : '')}" placeholder="${escapeHtml(f.placeholder || '')}" ${f.min != null ? 'min=' + f.min : ''} ${f.max != null ? 'max=' + f.max : ''}>`;
        return `<div class="field" style="margin-bottom:12px;"><label>${escapeHtml(f.label)}${f.opt ? ' <span class="opt">(opcional)</span>' : ''}</label>${input}${f.hint ? `<p class="hint" style="margin:5px 0 0;">${escapeHtml(f.hint)}</p>` : ''}</div>`;
      }).join('');
      this._open(opts.title || 'Editar', opts.sub || '', body, { okText: opts.okText || 'Salvar' });
    });
  },
  _submit(ok) {
    const r = this._resolve; this._resolve = null;
    if (this._mode === 'prompt') {
      if (!ok) { this._close(); if (r) r(null); return; }
      const vals = {};
      (this._fields || []).forEach(f => { const el = document.getElementById('uip_' + f.key); vals[f.key] = el ? el.value : null; });
      this._close(); if (r) r(vals);
    } else {
      this._close(); if (r) r(!!ok);
    }
  }
};
(function () {
  const bind = () => {
    const ok = document.getElementById('ui-modal-ok'); if (ok) ok.addEventListener('click', () => UI._submit(true));
    const c = document.getElementById('ui-modal-cancel'); if (c) c.addEventListener('click', () => UI._submit(false));
    const x = document.getElementById('ui-modal-x'); if (x) x.addEventListener('click', () => UI._submit(false));
    /* Clicar no fundo desfocado NAO fecha o dialogo: um toque acidental fora da
       caixa cancelava o que estava sendo confirmado ou preenchido. Fecha-se pelo
       X, pelo Cancelar ou pelo Esc — sempre por uma acao deliberada. */
    document.addEventListener('keydown', (e) => {
      const m = document.getElementById('ui-modal');
      if (!m || m.style.display === 'none') return;
      if (e.key === 'Escape') UI._submit(false);
      else if (e.key === 'Enter' && (e.target.tagName !== 'TEXTAREA')) {
        const ok = document.getElementById('ui-modal-ok');
        if (ok && ok.disabled) return;      // confirmacao por palavra ainda nao confere
        e.preventDefault(); UI._submit(true);
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
