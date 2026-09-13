/* ============================================================
   EXTRAS MODERNOS — fonte própria para o rodízio de lei seca
   ============================================================ */
(() => {
  const EM = (typeof window !== 'undefined') ? window.ExtrasModern : null;
  if (!EM || typeof LeiRodizio === 'undefined' || EM._leiFonteV1) return;
  EM._leiFonteV1 = true;

  const fonteAnterior = EM.fonte;
  EM.fonte = function (x) {
    if (LeiRodizio.eExtra(x)) return 'lei';
    return fonteAnterior.call(this, x);
  };

  const filtroAnterior = EM.filtroFonte;
  EM.filtroFonte = function (entry) {
    if (this.view === 'lei') return this.fonte(entry.x) === 'lei';
    return filtroAnterior.call(this, entry);
  };

  const gruposAnterior = EM.grupos;
  EM.grupos = function (c) {
    if (this.view !== 'lei') return gruposAnterior.call(this, c);
    const anterior = this.view;
    this.view = 'all';
    let grupos;
    try { grupos = gruposAnterior.call(this, c); }
    finally { this.view = anterior; }
    return grupos.map(([k, titulo, ico, arr]) => [
      k, titulo, ico, arr.filter(e => this.fonte(e.x) === 'lei')
    ]);
  };

  const coletarAnterior = EM.coletar;
  EM.coletar = function (screen) {
    const c = coletarAnterior.call(this, screen);
    c.fontes = c.fontes || {};
    c.fontes.lei = DB.getExtras().filter(x =>
      x && x.status !== 'concluida' && LeiRodizio.eExtra(x)
    ).length;
    return c;
  };

  const agendaAnterior = EM.decorarAgenda;
  EM.decorarAgenda = function (screen, c) {
    const r = agendaAnterior.call(this, screen, c);
    const host = document.querySelector('#extras-agenda .exm-filters');
    if (host && !host.querySelector('[data-exm-view="lei"]')) {
      const tmp = document.createElement('div');
      tmp.innerHTML = this.chip('lei', 'Lei seca', (c.fontes && c.fontes.lei) || 0);
      const b = tmp.firstElementChild;
      if (b) {
        host.appendChild(b);
        b.addEventListener('click', () => {
          this.view = 'lei';
          screen.selDay = todayLocal();
          screen.render();
        });
      }
    }
    return r;
  };

  const cardsAnterior = EM.decorarCards;
  EM.decorarCards = function (list, entries) {
    const r = cardsAnterior.call(this, list, entries);
    list.querySelectorAll('.exd').forEach(card => {
      const e = DB.getExtra(card.dataset.id);
      if (!LeiRodizio.eExtra(e)) return;
      const tag = card.querySelector('.exm-source');
      if (!tag) return;
      tag.textContent = 'Lei seca';
      tag.classList.remove('manual', 'plano', 'reforco');
      tag.classList.add('lei');
    });
    return r;
  };
})();
