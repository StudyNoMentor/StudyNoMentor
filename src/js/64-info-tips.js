/* ============================================================================
   INFO TIPS — converte textos de ajuda longos em um ícone "i" com popover
   ----------------------------------------------------------------------------
   Roda no carregamento e sempre que uma tela é ativada (para pegar cards que
   só são renderizados sob demanda). Page-subtitles sempre viram "i"; subtítulos
   de card só quando são longos (curtos e úteis permanecem como rótulo). */
(function () {
  const LONG = 60;              // limiar de caracteres p/ recolher um .sub de card
  let pop = null, hideTimer = null;
  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'info-pop';
    pop.setAttribute('role', 'tooltip');
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(pop);
    return pop;
  }
  function showFor(dot) {
    const p = ensurePop();
    p.innerHTML = dot._info || '';
    p.classList.add('open');
    p.style.maxWidth = Math.min(320, window.innerWidth - 24) + 'px';
    p.style.left = '-9999px'; p.style.top = '0px';         // mede fora da tela
    const pw = p.offsetWidth, ph = p.offsetHeight;
    const r = dot.getBoundingClientRect();
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
    let top = r.bottom + 8;
    if (top + ph > window.innerHeight - 12) top = r.top - ph - 8; // vira para cima
    p.style.left = left + 'px';
    p.style.top = Math.max(12, top) + 'px';
  }
  function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 140); }
  function hide() { if (pop) pop.classList.remove('open'); }
  function makeDot(html) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'info-dot'; b.setAttribute('aria-label', 'Mais informações');
    b.textContent = 'i'; b._info = html;
    b.addEventListener('mouseenter', () => { clearTimeout(hideTimer); showFor(b); });
    b.addEventListener('mouseleave', scheduleHide);
    b.addEventListener('focus', () => showFor(b));
    b.addEventListener('blur', hide);
    b.addEventListener('click', (e) => { e.stopPropagation(); if (pop && pop.classList.contains('open')) hide(); else showFor(b); });
    return b;
  }
  function upgrade() {
    // 1) subtítulos de página → sempre recolhem
    document.querySelectorAll('.page-subtitle').forEach(el => {
      if (el.dataset.tipped) return;
      const head = el.closest('.page-header') || el.parentElement;
      const h = head ? head.querySelector('.page-title, h2') : null;
      if (!h) return;
      const html = el.innerHTML.trim(); if (!html) return;
      h.appendChild(makeDot(html));
      el.style.display = 'none'; el.dataset.tipped = '1';
    });
    // 2) subtítulos de card LONGOS → recolhem (curtos permanecem)
    document.querySelectorAll('.card-header .sub, .evo-card-head .sub').forEach(el => {
      if (el.dataset.tipped) return;
      if ((el.textContent || '').trim().length < LONG) return;
      const head = el.closest('.card-header, .evo-card-head');
      const h = head ? head.querySelector('h2') : null;
      if (!h) return;
      h.appendChild(makeDot(el.innerHTML));
      el.style.display = 'none'; el.dataset.tipped = '1';
    });
    /* 3) QUALQUER elemento com data-info ganha o "i" ao lado — é assim que um
       campo de configuração passa a explicar o que faz.
       Existia um caminho de ajuda para isto: o atributo `title`. No celular ele
       NUNCA abre, e era onde moravam as explicações dos ajustes do Plano: a
       tela pedia decisões sobre "amostra desejada" e "sensibilidade da
       tendência" sem uma única frase visível dizendo o que aquilo faz.
       O "i" é visível, tem alvo de toque próprio e o texto sai do title quando
       o data-info vem vazio, sem precisar duplicar a redação. */
    document.querySelectorAll('[data-info]').forEach(el => {
      if (el.dataset.tipped) return;
      const html = (el.getAttribute('data-info') || el.getAttribute('title') || '').trim();
      if (!html) return;
      el.appendChild(makeDot(html));
      el.dataset.tipped = '1';
    });
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.info-dot') && !e.target.closest('.info-pop')) hide(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, { capture: true, passive: true });
  window.addEventListener('resize', hide);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', upgrade); else upgrade();
  window.addEventListener('screen:activated', () => setTimeout(upgrade, 40));
  window.InfoTips = { upgrade };
})();

/* ---- Menu "Mais" da navegação no celular ---- */
(function () {
  const btn = document.getElementById('nav-more-btn');
  const sheet = document.getElementById('nav-sheet');
  const scrim = document.getElementById('nav-scrim');
  const grid = document.getElementById('nav-sheet-grid');
  if (!btn || !sheet || !grid) return;

  function montar() {
    const atual = document.querySelector('.screen.active');
    const ativa = atual ? atual.id.replace('screen-', '') : '';
    grid.innerHTML = [...document.querySelectorAll('.tab[data-screen]')].map(t => {
      const ico = t.querySelector('.tab-icon');
      const lbl = t.querySelector('.tab-label');
      const tela = t.dataset.screen;
      return `<button type="button" class="nav-sheet-item ${tela === ativa ? 'active' : ''}" data-goto="${tela}">
        <span class="i">${ico ? ico.textContent : '•'}</span>${escapeHtml(lbl ? lbl.textContent : tela)}</button>`;
    }).join('');
    grid.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
      switchScreen(b.dataset.goto);
      fechar();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }
  function abrir() {
    montar();
    sheet.classList.add('open'); scrim.classList.add('open'); btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true'); sheet.setAttribute('aria-hidden', 'false');
  }
  function fechar() {
    sheet.classList.remove('open'); scrim.classList.remove('open'); btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false'); sheet.setAttribute('aria-hidden', 'true');
  }
  btn.addEventListener('click', () => sheet.classList.contains('open') ? fechar() : abrir());
  scrim.addEventListener('click', fechar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) fechar(); });
  // trocar de tela por qualquer caminho fecha a folha
  window.addEventListener('screen:activated', fechar);

  /* ---- Arraste horizontal na faixa de navegação (mouse/caneta) ----
     No toque o navegador já rola; aqui damos o mesmo "puxar para o lado" ao mouse.
     Um pequeno limiar evita que um clique normal na aba seja tratado como arraste. */
  const tabsEl = document.getElementById('tabs');
  if (tabsEl) {
    let down = false, moved = false, startX = 0, startScroll = 0;
    tabsEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return; // toque usa a rolagem nativa
      if (e.target.closest('#nav-more-btn')) return;
      down = true; moved = false; startX = e.clientX; startScroll = tabsEl.scrollLeft;
    });
    tabsEl.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) { moved = true; tabsEl.classList.add('dragging'); }
      if (moved) { tabsEl.scrollLeft = startScroll - dx; e.preventDefault(); }
    });
    const end = () => { down = false; setTimeout(() => tabsEl.classList.remove('dragging'), 0); };
    tabsEl.addEventListener('pointerup', end);
    tabsEl.addEventListener('pointercancel', end);
    tabsEl.addEventListener('pointerleave', end);
    // se houve arraste, cancela o clique que abriria a tela por engano
    tabsEl.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  }
})();

/* O medidor de espaço ("Espaço usado") saiu de Ajustes ▸ Dados e backup.
   Dados de estudo não são persistidos no navegador: a projeção local vive em
   RAM e a fonte durável é o PostgreSQL. Medir quota local deixou de representar
   o tamanho real do perfil. */


/* ---- Dica por toque nos gráficos ------------------------------------------
   Antes, o valor de uma barra só aparecia passando o mouse (atributo title),
   o que no celular nunca acontece. Agora um toque mostra a bolha com o valor.
   Funciona por delegação: qualquer elemento com title ou data-tip dentro de uma
   área de gráfico responde, sem precisar alterar cada gráfico. */
const GraficoTip = {
  AREAS: '#screen-evolucao, #screen-conquistas, #tec-panel-analise, #tec-panel-incidencia, #tec-panel-motor, #screen-ciclo, #screen-historico',
  _el: null, _timer: null, _alvo: null,
  bolha() {
    if (!this._el) {
      this._el = document.createElement('div');
      this._el.className = 'tip-bolha';
      document.body.appendChild(this._el);
    }
    return this._el;
  },
  esconder() {
    if (this._el) this._el.classList.remove('on');
    document.querySelectorAll('.tip-alvo').forEach(x => x.classList.remove('tip-alvo'));
    this._alvo = null;
  },
  mostrar(el, texto) {
    if (!texto) return;
    // limpa destaques anteriores. Antes só o último era removido, então tocar em
    // várias barras deixava todas contornadas ao mesmo tempo.
    document.querySelectorAll('.tip-alvo').forEach(x => x.classList.remove('tip-alvo'));
    const b = this.bolha();
    b.textContent = texto;
    b.classList.remove('acima');
    b.classList.add('on');
    const r = el.getBoundingClientRect();
    const bb = b.getBoundingClientRect();
    // centraliza na horizontal, mantendo dentro da tela
    let left = r.left + r.width / 2 - bb.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bb.width - 8));
    let top = r.top - bb.height - 9;
    if (top < 8) { top = r.bottom + 9; b.classList.add('acima'); }   // sem espaço acima: vai abaixo
    b.style.left = left + 'px';
    b.style.top = top + 'px';
    b.style.setProperty('--seta', (r.left + r.width / 2 - left) + 'px');
    el.classList.add('tip-alvo');
    this._alvo = el;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.esconder(), 3200);
  },
  init() {
    document.addEventListener('click', (e) => {
      const area = e.target.closest ? e.target.closest(this.AREAS) : null;
      if (!area) { this.esconder(); return; }
      // sobe até encontrar quem carrega a informação
      let el = e.target;
      let texto = null;
      for (let i = 0; el && i < 4; i++, el = el.parentElement) {
        texto = el.getAttribute && (el.getAttribute('data-tip') || el.getAttribute('title'));
        if (texto) break;
        // <title> dentro de SVG (pontos do gráfico de trajetória)
        const t = el.querySelector && el.querySelector(':scope > title');
        if (t && t.textContent) { texto = t.textContent; break; }
      }
      if (texto && el) this.mostrar(el, texto); else this.esconder();
    });
    window.addEventListener('scroll', () => this.esconder(), true);
    window.addEventListener('resize', () => this.esconder());
  }
};
GraficoTip.init();
// Navegação do calendário mensal de presença (delegação única)
document.addEventListener('click', (e) => {
  const b = e.target.closest ? e.target.closest('#conq-cal-body [data-cal]') : null;
  if (b) EvolucaoScreen._navCal(b.dataset.cal);
});
// [MELHORIA 5] Clique no cartão de conquista abre o modal de níveis.
document.addEventListener('click', (e) => {
  const card = e.target.closest ? e.target.closest('#conquistas-body .badge[data-badge-idx]') : null;
  if (card) EvolucaoScreen.abrirNiveisModal(parseInt(card.dataset.badgeIdx, 10));
});

