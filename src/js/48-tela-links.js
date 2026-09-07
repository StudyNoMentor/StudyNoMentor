/* ============================================================
   TELA: LINKS ÚTEIS
   ============================================================ */
const LinksScreen = {
  _editingId: null,
  _draftLogo: null,
  _draftCor: '#4f46e5',
  PALETTE: ['#4f46e5', '#29abe2', '#5b4fc4', '#7cb342', '#123a5e', '#4285f4', '#d97757', '#e0393f', '#0f9d63', '#d97a12', '#b3308a', '#5b6270'],

  render() { this.renderGrid(); },
  monogram(nome) {
    const parts = String(nome || '?').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0] || '?').slice(0, 2).toUpperCase();
  },
  hostname(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url || ''; } },
  logoHtml(l) {
    if (l.logo) return `<div class="link-card-logo"><img src="${l.logo}" alt="${escapeHtml(l.nome)}"></div>`;
    /* A cor da marca vai como --marca e o CSS a ESCURECE 30% para desenhar o
       fundo. Aplicada crua, o monograma branco ficava em 2,5:1 sobre o verde e
       2,6:1 sobre o azul-claro — abaixo do minimo 4,5:1 do WCAG AA. Escurecida,
       o menor caso sobe para 4,8:1 e a marca continua reconhecivel. */
    return `<div class="link-card-logo mono" style="--marca:${l.cor}">${escapeHtml(this.monogram(l.nome))}</div>`;
  },
  renderGrid() {
    const grid = document.getElementById('links-grid');
    const links = DB.getLinks();
    if (links.length === 0) {
      grid.innerHTML = `<div class="card"><div class="empty-state" style="padding:40px 20px;"><div class="big">🔗</div><h3 style="margin:4px 0;">Nenhum link ainda</h3><p style="color:var(--text-faint)">Clique em <strong>＋ Novo link</strong> para adicionar seus atalhos.</p></div></div>`;
      return;
    }
    grid.innerHTML = links.map(l => `
      <a class="link-card" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" data-id="${l.id}">
        ${this.logoHtml(l)}
        <div class="link-card-body">
          <div class="link-card-name" title="${escapeHtml(l.nome)}">${escapeHtml(l.nome)}</div>
          <div class="link-card-host">${escapeHtml(this.hostname(l.url))}</div>
          ${l.categoria ? `<span class="link-card-cat">${escapeHtml(l.categoria)}</span>` : ''}
        </div>
        <button type="button" class="link-card-edit" data-edit="${l.id}" title="Editar" aria-label="Editar">✎</button>
      </a>`).join('');
    grid.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); this.openModal(b.dataset.edit);
    }));
  },

  fillCategoryDatalist() {
    const cats = [...new Set(DB.getLinks().map(l => l.categoria).filter(Boolean))].sort();
    $id('link-cat-list').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
  },
  renderColorSwatches() {
    const box = document.getElementById('link-color-swatches');
    box.innerHTML = this.PALETTE.map(c =>
      `<button type="button" class="link-swatch ${c === this._draftCor ? 'sel' : ''}" data-cor="${c}" aria-label="Cor ${c}" style="background:${c}"></button>`).join('');
    box.querySelectorAll('.link-swatch').forEach(sw => sw.addEventListener('click', () => {
      this._draftCor = sw.dataset.cor;
      $id('link-cor').value = sw.dataset.cor;
      this.renderColorSwatches(); this.refreshLogoPreview();
    }));
  },
  refreshLogoPreview() {
    const prev = document.getElementById('link-logo-preview');
    const clearBtn = document.getElementById('link-logo-clear');
    if (this._draftLogo) {
      prev.innerHTML = `<img src="${this._draftLogo}" alt="">`;
      clearBtn.style.display = 'inline-block';
    } else {
      const nome = $id('link-nome').value || '?';
      prev.innerHTML = `<span class="link-preview-mono" style="background:${this._draftCor}">${escapeHtml(this.monogram(nome))}</span>`;
      clearBtn.style.display = 'none';
    }
  },
  openModal(id) {
    this._editingId = id || null;
    const isEdit = !!id;
    $id('link-modal-title').textContent = isEdit ? '✎ Editar link' : '＋ Novo link';
    $id('link-del-btn').style.display = isEdit ? 'inline-block' : 'none';
    let nome = '', url = '', categoria = '';
    this._draftLogo = null; this._draftCor = this.PALETTE[Math.floor(Math.random() * 4)];
    if (isEdit) {
      const l = DB.getLinks().find(x => x.id === id);
      if (l) { nome = l.nome; url = l.url; categoria = l.categoria || ''; this._draftLogo = l.logo || null; this._draftCor = l.cor || '#4f46e5'; }
    }
    $id('link-nome').value = nome;
    $id('link-url').value = url;
    $id('link-categoria').value = categoria;
    $id('link-cor').value = this._draftCor;
    $id('link-logo-file').value = '';
    this.fillCategoryDatalist();
    this.renderColorSwatches();
    this.refreshLogoPreview();
    $id('link-modal').style.display = 'flex';
    setTimeout(() => $id('link-nome').focus(), 50);
  },
  closeModal() { $id('link-modal').style.display = 'none'; this._editingId = null; },
  // redimensiona a imagem para no máx. 256px e devolve dataURL (PNG p/ transparência)
  processLogo(file) {
    if (!file) return;
    if (file.size > 400 * 1024) { showToast('Imagem muito grande (máx. 400 KB). Reduza antes de enviar.'); return; }
    // SVG: guarda direto (é leve e vetorial)
    if (file.type === 'image/svg+xml') {
      const r = new FileReader();
      r.onload = (e) => { this._draftLogo = e.target.result; this.refreshLogoPreview(); };
      r.readAsDataURL(file); return;
    }
    const r = new FileReader();
    r.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const max = 256;
        let w = img.width, h = img.height;
        if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        this._draftLogo = cv.toDataURL('image/png');
        this.refreshLogoPreview();
      };
      img.onerror = () => showToast('Não foi possível ler a imagem.');
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  },
  save() {
    const nome = $id('link-nome').value.trim();
    let url = $id('link-url').value.trim();
    if (!nome) { showToast('Dê um nome ao link'); return; }
    if (!url) { showToast('Informe o endereço (URL)'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url; // conserta URL sem protocolo
    const data = { nome, url, categoria: $id('link-categoria').value.trim(), cor: this._draftCor, logo: this._draftLogo };
    if (this._editingId) { DB.updateLink(this._editingId, data); showToast('Link atualizado ✓'); }
    else { DB.addLink(data); showToast('Link adicionado ✓'); }
    this.closeModal();
    this.renderGrid();
    if ($id('link-manage-modal').style.display === 'flex') this.renderManageList();
  },
  async deleteCurrent() {
    if (!this._editingId) return;
    const l = DB.getLinks().find(x => x.id === this._editingId);
    if (!await UI.confirm(`Excluir o link "${l ? l.nome : ''}"?`)) return;
    DB.deleteLink(this._editingId); this.closeModal(); this.renderGrid();
    if ($id('link-manage-modal').style.display === 'flex') this.renderManageList();
    showToast('Link excluído');
  },
  openManage() { this.renderManageList(); $id('link-manage-modal').style.display = 'flex'; },
  renderManageList() {
    const box = document.getElementById('link-manage-list');
    const links = DB.getLinks();
    if (links.length === 0) { box.innerHTML = `<p class="hint">Nenhum link cadastrado.</p>`; return; }
    box.innerHTML = links.map(l => `
      <div class="link-manage-row" data-id="${l.id}">
        ${this.logoHtml(l)}
        <div class="link-manage-info">
          <div class="link-manage-name">${escapeHtml(l.nome)}</div>
          <div class="link-manage-url">${escapeHtml(this.hostname(l.url))}</div>
        </div>
        <button type="button" class="icon-btn link-manage-edit" title="Editar" aria-label="Editar">✎</button>
        <button type="button" class="icon-btn danger link-manage-del" title="Excluir" aria-label="Excluir">×</button>
      </div>`).join('');
    box.querySelectorAll('.link-manage-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.link-manage-edit').addEventListener('click', () => this.openModal(id));
      row.querySelector('.link-manage-del').addEventListener('click', async () => {
        const l = DB.getLinks().find(x => x.id === id);
        if (!await UI.confirm(`Excluir o link "${l ? l.nome : ''}"?`)) return;
        DB.deleteLink(id); this.renderManageList(); this.renderGrid(); showToast('Link excluído');
      });
    });
  }
};
window.LinksScreen = LinksScreen;

(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('link-add-btn', 'click', () => LinksScreen.openModal(null));
  on('link-manage-btn', 'click', () => LinksScreen.openManage());
  on('link-modal-close', 'click', () => LinksScreen.closeModal());
  on('link-cancel', 'click', () => LinksScreen.closeModal());
  on('link-save', 'click', () => LinksScreen.save());
  on('link-del-btn', 'click', () => LinksScreen.deleteCurrent());
  on('link-nome', 'input', () => LinksScreen.refreshLogoPreview());
  on('link-cor', 'input', (e) => { LinksScreen._draftCor = e.target.value; LinksScreen.renderColorSwatches(); LinksScreen.refreshLogoPreview(); });
  on('link-logo-pick', 'click', () => $id('link-logo-file').click());
  on('link-logo-file', 'change', (e) => { if (e.target.files[0]) LinksScreen.processLogo(e.target.files[0]); });
  on('link-logo-clear', 'click', () => { LinksScreen._draftLogo = null; LinksScreen.refreshLogoPreview(); });
  on('link-manage-close', 'click', () => $id('link-manage-modal').style.display = 'none');
  on('link-manage-done', 'click', () => $id('link-manage-modal').style.display = 'none');
  ['link-modal', 'link-manage-modal'].forEach(id => {
    const m = document.getElementById(id);
    /* fundo desfocado nao fecha o modal: so o X / Cancelar / Esc fecham */
  });
})();
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'links') LinksScreen.render();
});
