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

/* ---- Medidor de espaço: consumo REAL por módulo e quanto ainda cabe ---- */
const StorageMeter = {
  // Fallback usado só quando navigator.storage.estimate() não está disponível.
  // O IndexedDB costuma liberar centenas de MB / vários GB por origem.
  LIMITE_FALLBACK: 512 * 1024 * 1024,
  GRUPOS: [
    ['Flashcards', /:cards$/], ['Histórico de revisões', /:revlog$/],
    ['Registros de estudo', /:entries$/], ['Leis secas', /:leis$/],
    ['Retratos do TEC', /:tec$/], ['Incidência da banca', /:incidencia$/],
    ['Ciclos e grade', /:(current-cycle|cycle-history|grade-template|tracks|custom-siglas)$/],
    ['Atividades extras', /:extras$/], ['Links e baralhos', /:(links|decks)$/]
  ],
  medir() {
    const grupos = {}; let total = 0, outros = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const bytes = (k.length + (localStorage.getItem(k) || '').length) * 2; // UTF-16
        total += bytes;
        const g = this.GRUPOS.find(([, re]) => re.test(k));
        if (g) grupos[g[0]] = (grupos[g[0]] || 0) + bytes; else outros += bytes;
      }
    } catch (_) { _quiet(_); }
    return { total, outros, grupos };
  },
  // Cota real do IndexedDB (por origem) via Storage API. Retorna também a origem
  // do número: 'estimate' quando veio do navegador, 'fallback' caso contrário.
  async cota() {
    try {
      if (navigator.storage && typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        const quota = est && est.quota ? est.quota : this.LIMITE_FALLBACK;
        const usage = est && typeof est.usage === 'number' ? est.usage : null;
        return { quota, usage, fonte: 'estimate' };
      }
    } catch (_) { _quiet(_); }
    return { quota: this.LIMITE_FALLBACK, usage: null, fonte: 'fallback' };
  },
  fmt(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
    return Math.round(b / 1024) + ' KB';
  },
  async render() {
    const host = document.getElementById('cfg-storage-body');
    if (!host) return;
    const { total, outros, grupos } = this.medir();
    const { quota, usage, fonte } = await this.cota();
    // "total" = tamanho dos dados do app (medido na camada de storage).
    // "usage" = uso real da origem no disco (IndexedDB + caches), quando disponível.
    const usoReal = (usage != null) ? Math.max(usage, total) : total;
    const pct = quota > 0 ? Math.min(100, usoReal / quota * 100) : 0;
    const tom = pct >= 85 ? 'bad' : pct >= 60 ? 'warn' : 'good';
    // As barras por grupo são proporcionais aos DADOS DO APP (não à cota gigante),
    // senão ficariam invisíveis. Assim continua fácil ver o que mais pesa.
    const base = total > 0 ? total : 1;
    const linhas = Object.entries(grupos).concat(outros > 0 ? [['Outros', outros]] : [])
      .sort((a, b) => b[1] - a[1])
      .map(([nome, b]) => `<div class="acm-row"><div class="acm-name">${escapeHtml(nome)}</div>
        <div class="bar-track"><span style="width:${Math.min(100, b / base * 100)}%"></span></div>
        <span class="acm-q">${this.fmt(b)}</span></div>`).join('');
    const cotaLbl = fonte === 'estimate'
      ? `de ${this.fmt(quota)} disponíveis (IndexedDB) · ${pct.toFixed(pct < 1 ? 1 : 0)}% usado`
      : `dados do app · cota do IndexedDB não informada pelo navegador`;
    const detalheUso = (usage != null && usage > total)
      ? `<div class="hint" style="margin:-4px 0 10px;opacity:.75;">Dados do app: ${this.fmt(total)} · Uso total da origem: ${this.fmt(usoReal)}</div>`
      : '';
    // rótulos dos módulos precisam de mais largura que o padrão de .acm-row
    host.innerHTML = `
      <div style="font-family:'Space Mono',monospace;font-size:26px;font-weight:800;" class="tone-${tom}">${this.fmt(usoReal)}</div>
      <div class="hint" style="margin:2px 0 10px;">${cotaLbl}</div>
      ${detalheUso}
      <div class="bar-track" style="height:10px;margin-bottom:16px;"><span style="width:${pct}%"></span></div>
      ${linhas || '<p class="hint">Nenhum dado ainda.</p>'}
      <p class="hint" style="margin-top:14px;">
        ${pct >= 85
          ? '⚠ Perto do limite da cota do navegador. Exporte um backup e considere remover imagens de cards ou leis que não usa mais.'
          : pct >= 60
            ? 'Espaço ainda confortável, mas vale acompanhar. Imagens coladas em cards são o que mais pesa.'
            : 'Espaço tranquilo — agora sobre IndexedDB, com cota bem maior que os antigos ~5 MB do localStorage. O que mais cresce é o histórico de revisões, limitado a 8.000 entradas.'}
      </p>`;
  }
};
window.StorageMeter = StorageMeter;
(function () {
  const b = document.getElementById('cfg-storage-refresh');
  if (b) b.addEventListener('click', () => { StorageMeter.render(); showToast('Espaço recalculado'); });
  window.addEventListener('screen:activated', (e) => { if (e.detail && e.detail.screen === 'config') StorageMeter.render(); });
})();

/* ---- UI do Histórico de versões (Configurações) ---- */
const VersionHistoryUI = {
  _quando(ts) {
    const d = new Date(ts), agora = Date.now();
    const min = Math.round((agora - ts) / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return 'há ' + min + ' min';
    const h = Math.round(min / 60);
    if (h < 24 && d.toDateString() === new Date().toDateString()) return 'hoje ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },
  render() {
    const host = document.getElementById('cfg-vhist-body');
    if (!host) return;
    const id = ProfileManager.getActiveProfileId();
    const arr = id ? VersionHistory._list(id).slice().reverse() : [];
    if (!arr.length) {
      host.innerHTML = '<p class="hint">Ainda não há versões guardadas. O app cria uma automaticamente na primeira alteração de cada dia e sempre antes de baixar da nuvem. Você também pode salvar uma agora, com o botão acima.</p>';
      return;
    }
    host.innerHTML = arr.map((r, i) => {
      const kb = Math.max(1, Math.round(r.chars * 2 / 1024)); // aprox. em KB (UTF-16)
      const nota = r.note ? escapeHtml(r.note) : 'versão salva';
      const atual = i === 0 ? '<span class="inactive-tag" style="color:var(--good-text);background:var(--good-soft);border-color:transparent;">mais recente</span>' : '';
      return `<div class="cloud-slot-row" data-ts="${r.ts}">
        <div class="cloud-slot-info">
          <div class="name">${this._quando(r.ts)} ${atual}</div>
          <div class="meta">${nota} · ~${kb} KB${r.enc === 'gz' ? ' · comprimido' : ''}</div>
        </div>
        <div class="cloud-slot-actions">
          <button type="button" class="btn-secondary vh-download" title="Baixar esta versão como arquivo .json">↓ Baixar</button>
          <button type="button" class="btn-primary vh-restore" title="Restaurar esta versão sobre o perfil atual">↺ Restaurar</button>
        </div>
      </div>`;
    }).join('') + '<p class="hint" style="margin-top:10px;">Guardamos até ' + VersionHistory.MAX + ' versões dos últimos 7 dias (uma cópia automática a cada 20 min de uso e sempre antes de uma limpeza). As mais antigas saem sozinhas, então o histórico nunca ocupa espaço demais. Restaurar cria antes uma cópia do estado atual, então a ação é reversível.</p>';
    host.querySelectorAll('.cloud-slot-row').forEach(row => {
      const ts = parseInt(row.dataset.ts, 10);
      row.querySelector('.vh-download').addEventListener('click', async () => {
        const backup = await VersionHistory.buildBackup(id, ts);
        if (!backup) { showToast('Não foi possível ler esta versão'); return; }
        const meta = ProfileManager.getProfiles().find(p => p.id === id) || {};
        const nome = 'versao-' + (meta.nome || 'perfil').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + new Date(ts).toISOString().slice(0, 10) + '.json';
        CardsScreen._download(nome, JSON.stringify(backup, null, 2), 'application/json');
        showToast('Versão baixada ✓');
      });
      row.querySelector('.vh-restore').addEventListener('click', async () => {
        const ok = await UI.confirm('Restaurar esta versão sobre o perfil atual?\n\nO estado de agora é guardado antes, então você pode voltar atrás. Depois de restaurar, o app recarrega.', { title: '↺ Restaurar versão', okText: 'Restaurar' });
        if (!ok) return;
        showToast('Restaurando…');
        // rede de segurança no banco antes de sobrescrever o estado atual
        try { if (window.CloudBackup) await CloudBackup.protegerAgora('antes de restaurar uma versão local'); } catch (e) { _quiet(e, 'vh-cbk'); }
        const done = await VersionHistory.restore(id, ts);
        if (!done) { showToast('Não foi possível restaurar esta versão'); return; }
        try { await CloudStore.flushPending(); } catch (_) { _quiet(_); }
        setTimeout(() => recarregarApp('versão restaurada', { imediato: true }), 600);
      });
    });
  }
};
window.VersionHistoryUI = VersionHistoryUI;
(function () {
  const b = document.getElementById('cfg-vhist-save');
  if (b) b.addEventListener('click', async () => {
    const ok = await VersionHistory.snapshot('salvo manualmente');
    showToast(ok ? 'Versão salva ✓' : 'Nada mudou desde a última versão');
    VersionHistoryUI.render();
  });
  window.addEventListener('screen:activated', (e) => { if (e.detail && e.detail.screen === 'config') VersionHistoryUI.render(); });
})();


/* ---- Dica por toque nos gráficos ------------------------------------------
   Antes, o valor de uma barra só aparecia passando o mouse (atributo title),
   o que no celular nunca acontece. Agora um toque mostra a bolha com o valor.
   Funciona por delegação: qualquer elemento com title ou data-tip dentro de uma
   área de gráfico responde, sem precisar alterar cada gráfico. */
const GraficoTip = {
  AREAS: '#screen-evolucao, #screen-conquistas, #tec-panel-plano, #tec-panel-analise, #tec-panel-incidencia, #tec-panel-reforco, #screen-ciclo, #screen-historico',
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

