/* ============================================================
   TELA: LEIS SECAS — vade mecum com destaque de pegadinhas
   ============================================================ */
const LeisScreen = {
  currentId: null,
  fontStep: 0, // -2..+4
  // Preferências do leitor: por PERFIL e sincronizadas (antes eram chaves globais do navegador)
  _prefKey(nome) { try { return DB._profilePrefix() + 'lei-' + nome; } catch (_) { return 'diario-estudos:lei-' + nome; } },
  _prefGet(nome, legado, padrao) {
    try {
      const v = localStorage.getItem(this._prefKey(nome));
      if (v !== null) return v;
      const lv = legado ? localStorage.getItem(legado) : null;
      if (lv !== null) { this._prefSet(nome, lv); return lv; }
    } catch (_) { _quiet(_); }
    return padrao;
  },
  _prefSet(nome, valor) {
    try { localStorage.setItem(this._prefKey(nome), String(valor)); } catch (_) { _quiet(_); }
    try { if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange(); } catch (_) { _quiet(_); }
  },

  render() {
    // ao ativar a aba, volta sempre para a lista
    this.showList();
  },
  showList() {
    $id('leis-list-view').style.display = 'block';
    $id('leis-reader-view').style.display = 'none';
    this.currentId = null;
    this.renderCards();
  },
  renderCards() {
    const wrap = document.getElementById('leis-cards');
    const leis = DB.getLeis().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (leis.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">§</div>Nenhuma lei cadastrada ainda. Clique em <strong>＋ Nova lei</strong> para começar seu vade mecum.</div>`;
      return;
    }
    wrap.innerHTML = leis.map(l => {
      const st = LawEngine.stats(l);
      return `
        <div class="lei-card" data-id="${l.id}">
          <div class="lei-card-main">
            <div class="lei-card-title">${escapeHtml(l.titulo)}</div>
            <div class="lei-card-meta">
              ${l.referencia ? `<span class="lei-tag ref">${escapeHtml(l.referencia)}</span>` : ''}
              ${l.materia ? `<span class="lei-tag mat">${escapeHtml(l.materia)}</span>` : ''}
              <span class="lei-card-stats">${st.artigos} art. · ${st.palavras} palavras${st.marcacoes ? ' · ' + st.marcacoes + ' destaque(s)' : ''}</span>
            </div>
          </div>
          <button type="button" class="btn-secondary lei-open">Ler →</button>
        </div>`;
    }).join('');
    wrap.querySelectorAll('.lei-card').forEach(card => {
      const id = card.dataset.id;
      const open = () => this.openReader(id);
      card.querySelector('.lei-open').addEventListener('click', open);
      card.querySelector('.lei-card-main').addEventListener('click', open);
    });
  },

  openForm() {
    $id('lei-titulo').value = '';
    $id('lei-ref').value = '';
    $id('lei-materia').value = '';
    $id('lei-texto').value = '';
    $id('lei-form-modal').style.display = 'flex';
    setTimeout(() => $id('lei-titulo').focus(), 60);
  },
  addFromForm() {
    const titulo = $id('lei-titulo').value.trim();
    const texto = $id('lei-texto').value;
    if (!titulo) { showToast('Dê um título à lei'); return; }
    if (!texto.trim()) { showToast('Cole o texto da lei'); return; }
    const lei = DB.addLei({
      titulo,
      referencia: $id('lei-ref').value,
      materia: $id('lei-materia').value,
      texto
    });
    $id('lei-form-modal').style.display = 'none';
    showToast('Lei cadastrada ✓');
    this.openReader(lei.id);
  },

  openReader(id) {
    const lei = DB.getLei(id);
    if (!lei) { this.showList(); return; }
    this.currentId = id;
    this.hlMode = null; // reseta a ferramenta ativa ao abrir
    ['lei-mark-btn', 'lei-unmark-btn'].forEach(bid => { const b = document.getElementById(bid); if (b) b.classList.remove('active'); });
    $id('leis-list-view').style.display = 'none';
    $id('leis-reader-view').style.display = 'block';
    $id('lei-reader-titulo').textContent = lei.titulo;
    const st = LawEngine.stats(lei);
    /* Antes os metadados iam todos numa unica caixa cinza, colada ao titulo e
       quebrando em qualquer largura. Agora cada informacao e um chip proprio:
       alinham entre si, quebram por inteiro e nunca cortam palavra no meio. */
    const chips = [];
    if (lei.materia) chips.push({ ic: '📚', txt: lei.materia });
    if (lei.referencia) chips.push({ ic: '🏷️', txt: lei.referencia });
    chips.push({ ic: '§', txt: `${st.artigos} artigo${st.artigos === 1 ? '' : 's'}` });
    chips.push({ ic: '📝', txt: `${Number(st.palavras).toLocaleString('pt-BR')} palavras` });
    $id('lei-reader-meta').innerHTML = chips
      .map(c => `<span class="lei-meta-chip"><span class="lmc-ic">${c.ic}</span>${escapeHtml(String(c.txt))}</span>`).join('');
    // sincroniza os toggles com as opções salvas da lei
    const opts = lei.opts || {};
    const autoOn = opts._auto !== false;
    const master = document.getElementById('lei-auto-master');
    if (master) master.checked = autoOn;
    document.querySelectorAll('#lei-hl-toggles input[data-cat]').forEach(cb => {
      cb.checked = opts[cb.dataset.cat] !== false;
      cb.disabled = !autoOn;
    });
    $id('lei-hl-toggles').classList.toggle('auto-off', !autoOn);
    // restaura preferência de numeração de linhas
    this.showLines = this._prefGet('show-lines', 'diario-estudos:lei-show-lines', '0') === '1';
    this.fontStep = Math.max(-2, Math.min(5, parseInt(this._prefGet('font-step', null, '0'), 10) || 0));
    const lb = document.getElementById('lei-lines-btn'); if (lb) lb.classList.toggle('active', !!this.showLines);
    this.renderBody();
    this.renderMarks();
  },
  renderBody() {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const body = document.getElementById('lei-reader-body');
    body.innerHTML = LawEngine.toHtml(lei, DB.getLeiKeywords());
    body.style.fontSize = (100 + this.fontStep * 8) + '%';
    body.classList.toggle('tool-mark', this.hlMode === 'mark');
    body.classList.toggle('tool-erase', this.hlMode === 'erase');
    body.classList.toggle('show-lines', !!this.showLines);
    // DELEGAÇÃO: um único listener no corpo. Antes registrava um por destaque e um por
    // número de linha — em leis grandes eram dezenas de milhares a cada re-render.
    if (!body._leiDelegado) {
      body._leiDelegado = true;
      body.addEventListener('click', (e) => {
        const num = e.target.closest ? e.target.closest('.law-lnum') : null;
        if (num) { e.stopPropagation(); this.onLineNumClick(parseInt(num.dataset.line, 10)); return; }
        const mk = e.target.closest ? e.target.closest('mark[class*="lawmark-"]') : null;
        if (mk && this.hlMode === 'erase') {
          e.stopPropagation();
          const bloco = mk.closest('.law-block');
          this.eraseHighlight(mk.textContent || '', bloco ? parseInt(bloco.dataset.line, 10) : null);
        }
      });
    }
    this.atualizarFoco();
    // atualiza o rótulo do botão "Onde parei"
    const gb = document.getElementById('lei-goto-mark-btn');
    if (gb) { const bk = LawEngine.resolveBookmark(lei); const has = lei.bookmark != null; gb.style.opacity = has ? '1' : '0.55'; gb.title = has ? 'Ir para a linha ' + bk : 'Nenhuma linha marcada ainda — clique no número de uma linha'; }
  },
  // clicar no NÚMERO da linha → fixa/retira o pin "onde parei"
  onLineNumClick(ln) {
    if (!ln && ln !== 0) return;
    const cur = DB.getLei(this.currentId);
    if (!cur) return;
    const atual = LawEngine.resolveBookmark(cur);
    const novo = (atual === ln) ? null : ln; // clicar de novo remove
    // guarda também um trecho da linha: se o texto for editado, o pin se reancora
    let ancora = null;
    if (novo != null) {
      const linhas = LawEngine.normalize(cur.texto).split('\n').filter(l => l.trim());
      ancora = (linhas[novo - 1] || '').trim().slice(0, 40) || null;
    }
    DB.updateLei(this.currentId, { bookmark: novo, bookmarkTxt: ancora });
    this.renderBody();
    if (novo != null) { this.gotoBookmark(); showToast('📌 Marcado: você parou na linha ' + novo); }
    else showToast('Marcador removido');
  },
  toggleLines() {
    this.showLines = !this.showLines;
    const btn = document.getElementById('lei-lines-btn');
    if (btn) btn.classList.toggle('active', this.showLines);
    this._prefSet('show-lines', this.showLines ? '1' : '0');
    this.renderBody();
  },
  // ── Modo foco: ler a lei em tela cheia ──
  entrarFoco() {
    if (!this.currentId) { showToast('Abra uma lei primeiro'); return; }
    document.body.classList.add('leis-foco');
    this.atualizarFoco();
    // reflete o estado atual da ferramenta (marca-texto/borracha) nos botões da barra de foco
    const fMark = document.getElementById('lei-foco-mark');
    const fErase = document.getElementById('lei-foco-erase');
    if (fMark) fMark.classList.toggle('active', this.hlMode === 'mark');
    if (fErase) fErase.classList.toggle('active', this.hlMode === 'erase');
    showToast('Modo foco · Esc sai · marca-texto e borracha disponíveis na barra do topo');
  },
  sairFoco() { document.body.classList.remove('leis-foco'); this.atualizarFoco(); },
  emFoco() { return document.body.classList.contains('leis-foco'); },
  atualizarFoco() {
    if (!this.emFoco()) return;
    const lei = DB.getLei(this.currentId);
    const el = document.getElementById('lei-foco-info');
    if (!el || !lei) return;
    const bk = LawEngine.resolveBookmark(lei);
    const st = LawEngine.stats(lei);
    el.textContent = (lei.titulo || 'Lei') + ' · ' + st.artigos + ' art.' + (bk > 0 ? ' · 📌 linha ' + bk : '');
  },
  // marca a linha que está no topo da tela — no modo foco a numeração fica oculta
  marcarLinhaVisivel() {
    const body = document.getElementById('lei-reader-body');
    if (!body || !this.currentId) return;
    const blocos = [...body.querySelectorAll('.law-block')];
    const topo = 70; // abaixo da barra fixa
    const alvo = blocos.find(b => b.getBoundingClientRect().bottom > topo) || blocos[0];
    if (!alvo) return;
    this.onLineNumClick(parseInt(alvo.dataset.line, 10));
    this.atualizarFoco();
  },
  gotoBookmark() {
    const lei = DB.getLei(this.currentId);
    if (!lei || lei.bookmark == null) { showToast('Marque uma linha primeiro: clique no 🔢 Linhas e depois no número onde parou'); if (!this.showLines) this.toggleLines(); return; }
    // garante que a numeração esteja visível para orientação
    const body = document.getElementById('lei-reader-body');
    const alvo = body.querySelector(`.law-block[data-line="${LawEngine.resolveBookmark(lei)}"]`);
    if (alvo) { alvo.scrollIntoView({ behavior: 'smooth', block: 'center' }); alvo.classList.add('law-bk-flash'); setTimeout(() => alvo.classList.remove('law-bk-flash'), 1200); }
  },
  // captura a seleção atual DENTRO do corpo do leitor (chamado no mouseup/keyup)
  captureSelection() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return;
    const body = document.getElementById('lei-reader-body');
    const anchor = sel.anchorNode;
    // só guarda se a seleção está dentro do texto da lei
    if (anchor && body && body.contains(anchor.nodeType === 3 ? anchor.parentNode : anchor)) {
      const t = String(sel).trim();
      if (t.length >= 2) this._selText = t;
    }
  },
  renderMarks() {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const marks = lei.marcacoes || [];
    const suppressed = lei.suppressed || [];
    const parts = [];
    if (marks.length) parts.push(`${marks.length} destaque(s) seu(s)`);
    if (suppressed.length) parts.push(`${suppressed.length} automático(s) apagado(s)`);
    $id('lei-mark-count').textContent = parts.join(' · ');
    const panel = document.getElementById('lei-marks-panel');
    const list = document.getElementById('lei-marks-list');
    if (marks.length === 0 && suppressed.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    let html = '';
    if (marks.length) {
      html += `<p class="section-label" style="margin:0 0 8px;">Seus destaques</p>` +
        marks.map((m, i) => {
          const mt = (typeof m === 'string') ? m : (m.t || '');
          const ln = (typeof m === 'string') ? null : m.l;
          return `
          <div class="lei-mark-row" data-mark="${i}">
            <span class="lawmark-manual lei-mark-text">${escapeHtml(mt)}</span>
            ${ln != null ? `<span class="hint" style="margin:0 8px 0 auto; white-space:nowrap;">linha ${ln}</span>` : ''}
            <button type="button" class="icon-btn danger lei-mark-del" title="Remover destaque" aria-label="Remover destaque">×</button>
          </div>`;
        }).join('');
    }
    if (suppressed.length) {
      html += `<div style="display:flex; align-items:center; justify-content:space-between; margin:14px 0 8px;">
          <span class="section-label" style="margin:0;">Automáticos que você apagou</span>
          <button type="button" class="btn-secondary" id="lei-restore-auto" style="padding:4px 10px; font-size:12px;">↺ Restaurar todos</button>
        </div>` +
        suppressed.map((m, i) => {
          const txt = (typeof m === 'string') ? m : String(m.t || '');
          const ln = (typeof m === 'string') ? null : m.l;
          return `
          <div class="lei-mark-row" data-supp="${i}">
            <span class="lei-mark-text" style="text-decoration:line-through; opacity:0.7;">${escapeHtml(txt)}</span>
            <span class="hint" style="margin:0 8px 0 auto; white-space:nowrap;">${ln != null ? 'linha ' + ln : 'lei toda'}</span>
            <button type="button" class="icon-btn supp-restore" title="Voltar a destacar" aria-label="Voltar a destacar">↺</button>
          </div>`;
        }).join('');
    }
    list.innerHTML = html;
    list.querySelectorAll('[data-mark]').forEach(row => {
      row.querySelector('.lei-mark-del').addEventListener('click', () => {
        const idx = parseInt(row.dataset.mark, 10);
        const l = DB.getLei(this.currentId); l.marcacoes.splice(idx, 1);
        DB.updateLei(this.currentId, { marcacoes: l.marcacoes });
        this.renderBody(); this.renderMarks();
      });
    });
    list.querySelectorAll('[data-supp]').forEach(row => {
      row.querySelector('.supp-restore').addEventListener('click', () => {
        const idx = parseInt(row.dataset.supp, 10);
        const l = DB.getLei(this.currentId); const sup = (l.suppressed || []).slice(); sup.splice(idx, 1);
        DB.updateLei(this.currentId, { suppressed: sup });
        this.renderBody(); this.renderMarks();
      });
    });
    const restoreBtn = document.getElementById('lei-restore-auto');
    if (restoreBtn) restoreBtn.addEventListener('click', () => this.restoreAuto());
  },
  // Ferramenta ativa: 'mark' (marca-texto) | 'erase' (borracha) | null
  hlMode: null,
  setTool(mode) {
    this.hlMode = (this.hlMode === mode) ? null : mode;
    const markBtn = document.getElementById('lei-mark-btn');
    const eraseBtn = document.getElementById('lei-unmark-btn');
    if (markBtn) markBtn.classList.toggle('active', this.hlMode === 'mark');
    if (eraseBtn) eraseBtn.classList.toggle('active', this.hlMode === 'erase');
    // espelha o estado nos botões da barra do MODO FOCO
    const fMark = document.getElementById('lei-foco-mark');
    const fErase = document.getElementById('lei-foco-erase');
    if (fMark) fMark.classList.toggle('active', this.hlMode === 'mark');
    if (fErase) fErase.classList.toggle('active', this.hlMode === 'erase');
    const body = document.getElementById('lei-reader-body');
    if (body) {
      body.classList.toggle('tool-mark', this.hlMode === 'mark');
      body.classList.toggle('tool-erase', this.hlMode === 'erase');
    }
    if (this.hlMode === 'mark') showToast('Marca-texto ativo — selecione trechos para destacar');
    else if (this.hlMode === 'erase') showToast('Borracha ativa — selecione um destaque para apagar');
  },
  // Chamado no mouseup do corpo: aplica a ferramenta ativa à seleção atual
  onBodyMouseUp() {
    if (!this.hlMode) return;
    const sel = window.getSelection ? window.getSelection() : null;
    const raw = sel ? String(sel) : '';
    const txt = raw.trim();
    if (!txt || txt.length < 2) return;
    if (txt.length > 200) { showToast('Seleção muito longa'); return; }
    // Descobre a LINHA e o DESLOCAMENTO exato da seleção dentro do texto puro da
    // linha. Com isso a marcação manual acende só ESTA ocorrência — não todas as
    // palavras iguais da lei (o "marcar todas" segue valendo só para o automático).
    let linha = null, offset = null;
    try {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      const el = node && (node.nodeType === 3 ? node.parentNode : node);
      const bloco = el && el.closest ? el.closest('.law-block') : null;
      const content = el && el.closest ? el.closest('.law-content') : null;
      if (bloco) linha = parseInt(bloco.dataset.line, 10);
      if (content) {
        const pre = range.cloneRange();
        pre.selectNodeContents(content);
        pre.setEnd(range.startContainer, range.startOffset);
        const lead = raw.length - raw.replace(/^\s+/, '').length; // espaços aparados à esquerda
        offset = pre.toString().length + lead;
      }
    } catch (_) { _quiet(_); }
    if (this.hlMode === 'mark') this.applyMark(txt, linha, offset);
    else if (this.hlMode === 'erase') this.applyErase(txt, linha);
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
  },
  applyMark(txt, linha, offset) {
    const lei = DB.getLei(this.currentId);
    const marks = (lei.marcacoes || []).slice();
    const norm = (m) => (typeof m === 'string' ? m : (m && m.t) || '').toLowerCase();
    if (linha != null && typeof offset === 'number' && offset >= 0) {
      // Marcação ANCORADA: aquela ocorrência específica (linha + posição).
      const existe = marks.some(m => m && typeof m === 'object' && m.l === linha && m.s === offset && norm(m) === txt.toLowerCase());
      if (existe) return;
      marks.push({ t: txt, l: linha, s: offset });
    } else {
      // Fallback sem âncora: mantém o comportamento antigo por texto.
      if (marks.some(m => norm(m) === txt.toLowerCase())) return;
      marks.push(txt);
    }
    DB.updateLei(this.currentId, { marcacoes: marks });
    this.renderBody(); this.renderMarks();
  },
  // Borracha: remove destaque MANUAL e suprime os automáticos daquele trecho — só na LINHA
  // em que você apagou (quando conhecida), não na lei inteira.
  applyErase(txt, linha) {
    const lei = DB.getLei(this.currentId);
    const key = txt.toLowerCase();
    const marks = (lei.marcacoes || []).filter(m => {
      if (typeof m === 'string') return m.toLowerCase() !== key;        // legado: remove os iguais
      if ((m.t || '').toLowerCase() !== key) return true;               // texto diferente: mantém
      if (linha != null && m.l != null && m.l !== linha) return true;   // outra linha: mantém
      return false;                                                     // mesma ocorrência: remove
    });
    const suppressed = (lei.suppressed || []).slice();
    const jaTem = (t) => suppressed.some(s => (typeof s === 'string' ? s.toLowerCase() === t.toLowerCase()
      : String(s.t).toLowerCase() === t.toLowerCase() && s.l === linha));
    this._collectAutoInText(txt).forEach(w => {
      if (!jaTem(w)) suppressed.push(linha != null ? { t: w, l: linha } : w);
    });
    DB.updateLei(this.currentId, { marcacoes: marks, suppressed });
    this.renderBody(); this.renderMarks();
  },
  // encontra os termos que as categorias automáticas destacariam dentro de um texto
  _collectAutoInText(txt) {
    const found = [];
    Object.keys(LawEngine.categories).forEach(k => {
      const cat = LawEngine.categories[k];
      const re = new RegExp(cat.re.source, cat.re.flags);
      let m;
      while ((m = re.exec(txt)) !== null) { if (m.index === re.lastIndex) re.lastIndex++; found.push(m[0]); }
    });
    return found;
  },
  // remove uma marcação específica (manual) OU suprime um automático, pelo texto exato
  eraseHighlight(text, linha) {
    const lei = DB.getLei(this.currentId);
    const key = (text || '').trim().toLowerCase();
    if (!key) return;
    const marks = (lei.marcacoes || []).filter(m => {
      if (typeof m === 'string') return m.toLowerCase() !== key;
      if ((m.t || '').toLowerCase() !== key) return true;
      if (linha != null && m.l != null && m.l !== linha) return true;
      return false;
    });
    const suppressed = (lei.suppressed || []).slice();
    const jaTem = suppressed.some(s => (typeof s === 'string' ? s.toLowerCase() === key
      : String(s.t).toLowerCase() === key && s.l === linha));
    if (!jaTem) suppressed.push(linha != null ? { t: text.trim(), l: linha } : text.trim());
    DB.updateLei(this.currentId, { marcacoes: marks, suppressed });
    this.renderBody(); this.renderMarks();
  },
  // restaura todos os destaques automáticos suprimidos
  restoreAuto() {
    DB.updateLei(this.currentId, { suppressed: [] });
    this.renderBody(); this.renderMarks();
    showToast('Destaques automáticos restaurados');
  },
  // ── Gerenciador de palavras destacadas por padrão (todas as leis) ──
  _kwCatMeta: {
    ressalvas:   { cls: 'lawmark-ressalvas',   label: '⚖️ Ressalvas / Exceções' },
    restricoes:  { cls: 'lawmark-restricoes',  label: '🚫 Restrições / Exclusividade' },
    competencias:{ cls: 'lawmark-competencias',label: '🏛️ Poder / Dever / Competência' },
    prazos:      { cls: 'lawmark-prazos',      label: '⏱️ Prazos / Tempo' },
    efeitos:     { cls: 'lawmark-efeitos',     label: '⚠️ Validade / Sanções' },
    relacoes:    { cls: 'lawmark-relacoes',    label: '🔗 Causalidade / Subordinação' }
  },
  openKeywords() {
    const m = document.getElementById('lei-kw-modal');
    if (m) m.style.display = 'flex';
    this.renderKeywords();
    setTimeout(() => { const i = document.getElementById('lei-kw-input'); if (i) i.focus(); }, 40);
  },
  closeKeywords() { const m = document.getElementById('lei-kw-modal'); if (m) m.style.display = 'none'; },
  addKeywordFromForm() {
    const inp = document.getElementById('lei-kw-input');
    const sel = document.getElementById('lei-kw-cat');
    const termo = (inp.value || '').trim();
    if (termo.length < 2) { showToast('Digite ao menos 2 letras'); return; }
    if (!DB.addLeiKeyword(termo, sel.value)) { showToast('Essa palavra já está na lista'); inp.value = ''; inp.focus(); return; }
    inp.value = '';
    this.renderKeywords();
    if (this.currentId) this.renderBody();   // reaplica imediatamente na lei aberta
    inp.focus();
  },
  renderKeywords() {
    const host = document.getElementById('lei-kw-groups');
    if (!host) return;
    const kws = DB.getLeiKeywords();
    const order = ['ressalvas','restricoes','competencias','prazos','efeitos','relacoes'];
    let html = '';
    order.forEach(cat => {
      const meta = this._kwCatMeta[cat];
      const itens = kws.filter(k => (k.cat || 'competencias') === cat);
      html += `<div class="lei-kw-group">
        <div class="lei-kw-group-head">
          <span class="lei-kw-group-title">${meta.label}</span>
          <span class="lei-kw-group-count">${itens.length}</span>
        </div>
        <div class="lei-kw-chips">
          ${itens.length ? itens.map(k => `
            <span class="lei-kw-chip" data-kw="${escapeHtml(k.t)}">
              <mark class="${meta.cls}">${escapeHtml(k.t)}</mark>
              <button type="button" class="lei-kw-del" title="Remover" aria-label="Remover">×</button>
            </span>`).join('') : '<span class="lei-kw-empty">Nenhuma palavra nesta categoria.</span>'}
        </div>
      </div>`;
    });
    host.innerHTML = html;
    host.querySelectorAll('.lei-kw-chip').forEach(el => {
      el.querySelector('.lei-kw-del').addEventListener('click', () => {
        DB.removeLeiKeyword(el.dataset.kw);
        this.renderKeywords();
        if (this.currentId) this.renderBody();
      });
    });
  },
  async restoreKeywordDefaults() {
    if (!await UI.confirm('Restaurar a lista de palavras que vem por padrão? Suas inclusões/exclusões nesta lista serão substituídas.')) return;
    DB.restoreLeiKeywordDefaults();
    this.renderKeywords();
    if (this.currentId) this.renderBody();
    showToast('Palavras padrão restauradas');
  },
  _clearSel() {
    this._selText = '';
    const s = window.getSelection ? window.getSelection() : null;
    if (s && s.removeAllRanges) s.removeAllRanges();
  },
  toggleCategory(cat, on) {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const opts = Object.assign({}, lei.opts || {});
    opts[cat] = on;
    DB.updateLei(this.currentId, { opts });
    this.renderBody();
  },
  // Interruptor mestre: liga/desliga TODO o destaque automático desta lei
  setAutoMaster(on) {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const opts = Object.assign({}, lei.opts || {});
    opts._auto = on;
    DB.updateLei(this.currentId, { opts });
    // desabilita visualmente as categorias individuais quando o mestre está off
    document.querySelectorAll('#lei-hl-toggles input[data-cat]').forEach(cb => { cb.disabled = !on; });
    $id('lei-hl-toggles').classList.toggle('auto-off', !on);
    this.renderBody();
  },
  changeFont(delta) {
    this.fontStep = Math.max(-2, Math.min(5, this.fontStep + delta));
    this._prefSet('font-step', this.fontStep);
    const body = document.getElementById('lei-reader-body');
    body.style.fontSize = (100 + this.fontStep * 8) + '%';
  },
  editCurrent() {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    UI.prompt([
      { key: 'titulo', label: 'Título da lei', type: 'text', value: lei.titulo },
      { key: 'ref', label: 'Referência', type: 'text', value: lei.referencia || '', opt: true },
      { key: 'mat', label: 'Matéria', type: 'text', value: lei.materia || '', opt: true },
      { key: 'texto', label: 'Texto da lei', type: 'textarea', value: lei.texto, rows: 8 }
    ], { title: '✎ Editar lei', okText: 'Salvar' }).then(v => {
      if (!v) return;
      DB.updateLei(this.currentId, {
        titulo: (v.titulo || '').trim() || lei.titulo,
        referencia: (v.ref || '').trim(),
        materia: (v.mat || '').trim(),
        texto: v.texto
      });
      this.openReader(this.currentId);
      showToast('Lei atualizada ✓');
    });
  },
  async deleteCurrent() {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    if (!await UI.confirm(`Excluir a lei "${lei.titulo}"? Esta ação não pode ser desfeita.`)) return;
    DB.deleteLei(this.currentId);
    showToast('Lei excluída');
    this.showList();
  }
};
window.LeisScreen = LeisScreen;

// Listeners da tela de Leis
(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  // modal de nova lei
  on('lei-open-form-btn', 'click', () => LeisScreen.openForm());
  on('lei-form-close', 'click', () => $id('lei-form-modal').style.display = 'none');
  on('lei-form-cancel', 'click', () => $id('lei-form-modal').style.display = 'none');
  on('lei-add-btn', 'click', () => LeisScreen.addFromForm());
  const fm = document.getElementById('lei-form-modal');
  if (fm) fm.addEventListener('click', (e) => { if (e.target === fm) fm.style.display = 'none'; });
  // leitor
  on('lei-back-btn', 'click', () => LeisScreen.showList());
  on('lei-edit-btn', 'click', () => LeisScreen.editCurrent());
  on('lei-del-btn', 'click', () => LeisScreen.deleteCurrent());
  // ferramentas de marcação: marca-texto e borracha (modos)
  on('lei-mark-btn', 'click', () => LeisScreen.setTool('mark'));
  on('lei-unmark-btn', 'click', () => LeisScreen.setTool('erase'));
  // aplica a ferramenta ativa ao soltar a seleção
  const body = document.getElementById('lei-reader-body');
  if (body) body.addEventListener('mouseup', () => setTimeout(() => LeisScreen.onBodyMouseUp(), 0));
  on('lei-font-inc', 'click', () => LeisScreen.changeFont(1));
  on('lei-font-dec', 'click', () => LeisScreen.changeFont(-1));
  on('lei-kw-btn', 'click', () => LeisScreen.openKeywords());
  on('lei-kw-close', 'click', () => LeisScreen.closeKeywords());
  on('lei-kw-done', 'click', () => LeisScreen.closeKeywords());
  on('lei-kw-add-btn', 'click', () => LeisScreen.addKeywordFromForm());
  on('lei-kw-restore', 'click', () => LeisScreen.restoreKeywordDefaults());
  on('lei-kw-input', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); LeisScreen.addKeywordFromForm(); } });
  /* fundo desfocado nao fecha (ver UI._open): so o X / Cancelar / Esc fecham */

  /* Barra de ferramentas do leitor: recolher/expandir, com a escolha lembrada.
     Comeca ABERTA na primeira visita (para as ferramentas serem descobertas) e
     depois respeita o que o usuario deixou. */
  (function () {
    const KEY = 'diario-estudos:leis-tools-open';
    const btn = document.getElementById('lei-tools-toggle');
    const box = document.getElementById('leis-sticky-toolbar');
    if (!btn || !box) return;
    const ler = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (_) { return true; } };
    const pintar = (aberto) => {
      box.classList.toggle('tools-collapsed', !aberto);
      btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      const t = btn.querySelector('.ltt-txt');
      if (t) t.textContent = aberto ? 'Ferramentas de leitura' : 'Mostrar ferramentas de leitura';
    };
    btn.addEventListener('click', () => {
      const novo = !ler();
      try { localStorage.setItem(KEY, novo ? '1' : '0'); } catch (_) { _quiet(_); }
      pintar(novo);
    });
    pintar(ler());
  })();
  on('lei-lines-btn', 'click', () => LeisScreen.toggleLines());
  on('lei-goto-mark-btn', 'click', () => LeisScreen.gotoBookmark());
  on('lei-foco-btn', 'click', () => LeisScreen.entrarFoco());
  on('lei-foco-mark', 'click', () => LeisScreen.setTool('mark'));
  on('lei-foco-erase', 'click', () => LeisScreen.setTool('erase'));
  on('lei-foco-lines', 'click', () => LeisScreen.toggleLines());
  // Esc sai do modo foco da leitura. Não conflita com o dos cards: cada um só
  // reage quando a sua própria classe está no body.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !LeisScreen.emFoco()) return;
    const alvo = e.target;
    if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
    if (document.querySelector('.cards-modal[style*="flex"], #ui-modal[style*="flex"]')) return; // modal aberto tem prioridade
    e.preventDefault(); LeisScreen.sairFoco();
  });
  on('lei-foco-sair', 'click', () => LeisScreen.sairFoco());
  on('lei-foco-marcar', 'click', () => LeisScreen.marcarLinhaVisivel());
  on('lei-auto-master', 'change', (e) => LeisScreen.setAutoMaster(e.target.checked));
  document.querySelectorAll('#lei-hl-toggles input[data-cat]').forEach(cb => {
    cb.addEventListener('change', () => LeisScreen.toggleCategory(cb.dataset.cat, cb.checked));
  });
})();
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'leis') LeisScreen.render();
});
