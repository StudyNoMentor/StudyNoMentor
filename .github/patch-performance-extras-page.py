from pathlib import Path

p = Path('src/js/55-extras-ui-moderna.js')
s = p.read_text()

old = """    view: 'all',
    janelaProximas: 7,
    janelaConcluidas: 7,"""
new = """    view: 'all',
    janelaProximas: 7,
    janelaConcluidas: 7,
    passoMais: 50,
    _limites: Object.create(null),

    limiteBase(k) {
      // No overview não há razão para montar centenas de cards fora do viewport.
      // Concluídas já nasce recolhida, então começa ainda mais enxuta. Ao filtrar
      // uma seção diretamente, mostramos uma janela maior de uma vez.
      if (this.view === k) return 80;
      return k === 'concluidas' ? 15 : 50;
    },

    fatiar(k, arr) {
      const limite = this._limites[k] || this.limiteBase(k);
      return { itens: arr.slice(0, limite), faltam: Math.max(0, arr.length - limite), limite };
    },"""
if old not in s: raise SystemExit('cabecalho ExtrasModern nao encontrado')
s = s.replace(old, new, 1)

old = """      dash.querySelectorAll('[data-exm-view]').forEach(b => b.addEventListener('click', () => {
        this.view = b.dataset.exmView || 'all';
        screen.selDay = todayLocal();
        screen.render();
      }));"""
new = """      dash.querySelectorAll('[data-exm-view]').forEach(b => b.addEventListener('click', () => {
        this.view = b.dataset.exmView || 'all';
        this._limites = Object.create(null);
        screen.selDay = todayLocal();
        screen.render();
      }));"""
if old not in s: raise SystemExit('chips modernos nao encontrados')
s = s.replace(old, new, 1)

old = """    secao(k, titulo, ico, arr, screen) {
      if (!arr.length) return '';
      const cards = this.cardsPorDisciplina(arr, screen);
      if (k === 'concluidas' && this.view !== 'concluidas') {
        return `<details class=\"exm-section exm-section-${k}\">
          <summary><span class=\"exm-section-title\">${ico} ${titulo}</span><span class=\"exm-section-count\">${arr.length}</span><span class=\"chev\">⌄</span></summary>
          <div class=\"exm-section-body\">${cards}</div>
        </details>`;
      }
      return `<section class=\"exm-section exm-section-${k}\">
        <div class=\"exm-section-head\"><span class=\"exm-section-title\">${ico} ${titulo}</span><span class=\"exm-section-count\">${arr.length}</span></div>
        <div class=\"exm-section-body\">${cards}</div>
      </section>`;
    },"""
new = """    secao(k, titulo, ico, arr, screen) {
      if (!arr.length) return '';
      const fatia = this.fatiar(k, arr);
      const cards = this.cardsPorDisciplina(fatia.itens, screen);
      const mais = fatia.faltam ? `<div class=\"exm-more-row\">
        <span>Mostrando ${fatia.itens.length} de ${arr.length}</span>
        <button type=\"button\" class=\"btn-secondary\" data-exm-more=\"${k}\">Mostrar mais ${Math.min(this.passoMais, fatia.faltam)}</button>
      </div>` : '';
      if (k === 'concluidas' && this.view !== 'concluidas') {
        return `<details class=\"exm-section exm-section-${k}\">
          <summary><span class=\"exm-section-title\">${ico} ${titulo}</span><span class=\"exm-section-count\">${arr.length}</span><span class=\"chev\">⌄</span></summary>
          <div class=\"exm-section-body\">${cards}${mais}</div>
        </details>`;
      }
      return `<section class=\"exm-section exm-section-${k}\">
        <div class=\"exm-section-head\"><span class=\"exm-section-title\">${ico} ${titulo}</span><span class=\"exm-section-count\">${arr.length}</span></div>
        <div class=\"exm-section-body\">${cards}${mais}</div>
      </section>`;
    },"""
if old not in s: raise SystemExit('secao moderna nao encontrada')
s = s.replace(old, new, 1)

old = """      list.innerHTML = grupos.map(([k, t, i, arr]) => this.secao(k, t, i, arr, screen)).join('');
      screen.bind(list);
      this.decorarCards(list, entries);
    },"""
new = """      list.innerHTML = grupos.map(([k, t, i, arr]) => this.secao(k, t, i, arr, screen)).join('');
      screen.bind(list);
      this.decorarCards(list, entries);
      list.querySelectorAll('[data-exm-more]').forEach(btn => btn.addEventListener('click', () => {
        const k = btn.dataset.exmMore;
        const atual = this._limites[k] || this.limiteBase(k);
        this._limites[k] = atual + this.passoMais;
        // Não recalcula calendário/Plano/agenda: só expande a fatia já coletada.
        this.renderOverview(screen, c);
      }));
    },"""
if old not in s: raise SystemExit('renderOverview moderno nao encontrado')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('src/css/09-extras-v51.css')
s = p.read_text()
marker = """#extras-list .exm-section > summary .chev {
  margin-left: auto;
  color: var(--text-faint);
}
"""
add = marker + """#extras-list .exm-more-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px 14px;
  border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  color: var(--text-faint);
  font-size: var(--fs-3xs);
}
#extras-list .exm-more-row .btn-secondary {
  min-height: 34px;
  white-space: nowrap;
}
@media (max-width: 520px) {
  #extras-list .exm-more-row { align-items: stretch; flex-direction: column; }
  #extras-list .exm-more-row .btn-secondary { width: 100%; }
}
"""
if marker not in s: raise SystemExit('marcador CSS exm nao encontrado')
s = s.replace(marker, add, 1)
p.write_text(s)
print('PATCH_EXTRAS_PAGE_OK')
