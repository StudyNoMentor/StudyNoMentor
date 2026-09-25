/* ============================================================
   TELA: REGISTRAR
   ============================================================ */
(function initRegistrar() {
  const CIRC = 220;
  const form = document.getElementById('study-form');
  const dateInput = document.getElementById('date');
  const correctInput = document.getElementById('correct');
  const totalInput = document.getElementById('total');
  const gauge = document.getElementById('gauge');
  const gaugeFill = document.getElementById('gauge-fill');
  const gaugePct = document.getElementById('gauge-pct');
  const perfPanel = document.getElementById('perf-panel');
  const pageStart = document.getElementById('page-start');
  const pageEnd = document.getElementById('page-end');
  const pagesHint = document.getElementById('pages-hint');
  const videoFields = document.getElementById('video-fields');
  const videoStart = document.getElementById('video-start');
  const videoEnd = document.getElementById('video-end');
  const videoConsumed = document.getElementById('video-consumed');
  const methodSelect = document.getElementById('method');

  // Detecta se a forma de estudo selecionada é vídeo/aula (mesmo critério da Evolução)
  function isVideoMethod(name) {
    const m = (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return /video|aula/.test(m);
  }
  // Mostra os campos de vídeo apenas quando fizer sentido
  function updateVideoFieldsVisibility() {
    videoFields.style.display = isVideoMethod(methodSelect.value) ? 'block' : 'none';
  }
  // Calcula e exibe os minutos de conteúdo assistido (final − inicial)
  function updateVideoConsumed() {
    const s = parseFloat(videoStart.value);
    const e = parseFloat(videoEnd.value);
    if (!isNaN(s) && !isNaN(e) && e >= s) {
      const diff = Math.round((e - s) * 10) / 10;
      videoConsumed.value = `${diff.toLocaleString('pt-BR')} min`;
    } else {
      videoConsumed.value = '—';
    }
  }
  const recentSection = document.getElementById('recent-section');
  const recentList = document.getElementById('recent-list');
  const searchInput = document.getElementById('recent-search');
  const submitBtn = document.getElementById('submit-btn');
  const formTitle = document.getElementById('form-title');
  const editNote = document.getElementById('form-edit-note');
  const cancelEditBtn = document.getElementById('btn-cancel-edit');

  let editingId = null; // null = modo "novo registro"; caso contrário, id do registro em edição
  let searchTerm = '';
  /* Paginação da lista: desenhar milhares de registros de uma vez travava a
     tela por segundos. Mostra 60 e cresce sob demanda; volta a 60 quando a
     busca, a visão, os filtros ou a ordenação mudam. */
  const RECENT_PASSO = 60;
  let recentLimite = RECENT_PASSO, _recentChave = '';
  const botaoMais = (total, onde) => total > recentLimite
    ? `<div class="recent-more-row"><button type="button" class="btn-secondary recent-more-btn" data-onde="${onde}">Mostrar mais ${Math.min(RECENT_PASSO, total - recentLimite)} <span>· ${total - recentLimite} restante${total - recentLimite === 1 ? '' : 's'}</span></button></div>` : '';
  /* Visão da lista de registros: 'cartoes' (padrão) ou 'tabela' (com filtros por
     coluna). A chave é NAMESPACED pelo perfil, como todas as outras escolhas do
     usuário: fora do prefixo `diario-estudos:u:<perfil>:` nada é sincronizado, e
     esta era a única preferência de tela que ainda morava numa chave global —
     acompanhava o navegador em vez de acompanhar você. */
  const _recentViewKey = () => { try { return DB._profilePrefix() + 'recent-view'; } catch (_) { return 'diario-estudos:recent-view'; } };
  let recentView = 'cartoes';
  try {
    recentView = localStorage.getItem(_recentViewKey())
      || localStorage.getItem('diario-estudos:recent-view')   // valor global antigo
      || 'cartoes';
  } catch (e) { _quiet(e); }
  let tblFilters = { subject: '', lesson: '', method: '', date: '' };
  let tblSort = { key: 'date', dir: 'desc' };
  let _pendingFocus = null; // { fk, pos } — devolve o foco ao filtro de texto após re-render
  const entryIsLocal = (e) => !e || !e._planId || String(e._planId) === String(DB._activePlanId());
  // Nome do planejamento só ajuda quando a lista mistura planejamentos; com um
  // só, o selo se repetia em todo registro como ruído.
  let _variosPlanos = false;
  const entryPlanBadge = (e) => (_variosPlanos && e && e._planNome)
    ? `<span class="meta-badge badge-plan" title="${e._planPaused ? 'Planejamento pausado — somente leitura' : 'Planejamento de origem'}">${e._planPaused ? '⏸ ' : ''}${escapeHtml(e._planNome)}</span>` : '';
  /* O histórico de estudo é memória realizada: pausar um planejamento suspende
     a OPERAÇÃO dele (ciclo, metas, novas escritas), não apaga o que já foi
     estudado. Antes, a lista lia só os planejamentos operacionais e os
     registros do pausado sumiam dos outros. Eles continuam somente leitura. */
  const todosOsRegistros = () => DB.getAllEntriesTagged ? DB.getAllEntriesTagged({ includePaused: true }) : DB.getEntries();

  dateInput.value = todayLocal();
  gaugeFill.style.strokeDasharray = CIRC;
  gaugeFill.style.strokeDashoffset = CIRC;

  /* O tamanho da fonte do percentual é fixo em CSS (var(--fs-md)), mas o TEXTO
     não é: "100" e "91,67%" têm larguras bem diferentes, e em telas com fonte
     maior (zoom, acessibilidade) até "91,67%" sozinho já não cabia no anel —
     o "9" e o "%" encostavam no traço. Em vez de um limite de largura fixo
     (que só resolve um caso), medimos o texto de verdade depois de escrito e
     encolhemos a fonte só o necessário para caber dentro do anel. */
  function fitGaugePct() {
    if (!gauge || !gaugePct) return;
    gaugePct.style.fontSize = '';
    const diameter = gauge.clientWidth || gauge.getBoundingClientRect().width;
    if (!diameter) return;
    // r=35, stroke-width=7 num viewBox 80x80: a área livre dentro do traço.
    const avail = diameter * ((35 - 3.5) * 2 / 80) * 0.9;
    const width = gaugePct.getBoundingClientRect().width;
    if (width > avail && width > 0) {
      const base = parseFloat(getComputedStyle(gaugePct).fontSize) || 16;
      gaugePct.style.fontSize = Math.max(9, base * (avail / width)) + 'px';
    }
  }

  function setGaugePct(text) {
    gaugePct.textContent = text;
    fitGaugePct();
  }

  function updateGauge() {
    const correct = parseFloat(correctInput.value);
    const total = parseFloat(totalInput.value);
    gauge.classList.remove('tone-good', 'tone-warn', 'tone-bad');
    perfPanel.classList.remove('tone-good', 'tone-warn', 'tone-bad');

    if (!total || total <= 0 || isNaN(correct)) {
      setGaugePct('—');
      gaugeFill.style.strokeDashoffset = CIRC;
      return;
    }
    /* Acertos > total é dado impossível: o medidor deixa isso VISÍVEL ("—" com
       tom de erro) em vez de exibir 100%, que era o que o clamp fazia — a
       pessoa via um número plausível e só descobria o engano depois. */
    if (correct > total) {
      setGaugePct('—');
      gaugeFill.style.strokeDashoffset = CIRC;
      gauge.classList.add('tone-bad');
      perfPanel.classList.add('tone-bad');
      return;
    }
    const pct = Math.max(0, Math.min(100, calcPct(correct, total)));
    setGaugePct(formatPct(pct));
    gaugeFill.style.strokeDashoffset = CIRC - (CIRC * pct / 100);
    const tone = toneFor(pct);
    gauge.classList.add('tone-' + tone);
    perfPanel.classList.add('tone-' + tone);
  }
  if (window.ResizeObserver && gauge) {
    new ResizeObserver(() => fitGaugePct()).observe(gauge);
  } else {
    window.addEventListener('resize', fitGaugePct);
  }

  function updatePagesHint() {
    const start = parseFloat(pageStart.value);
    const end = parseFloat(pageEnd.value);
    if (!isNaN(start) && !isNaN(end) && end >= start) {
      pagesHint.textContent = `total de ${end - start + 1} página(s)`;
    } else {
      pagesHint.textContent = '\u00a0';
    }
  }

  // só dígitos nos campos numéricos livres (tempo, acertos, total)
  ['correct', 'total', 'duration-h', 'duration-m'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, ''); });
  });
  correctInput.addEventListener('input', updateGauge);
  totalInput.addEventListener('input', updateGauge);
  pageStart.addEventListener('input', updatePagesHint);
  pageEnd.addEventListener('input', updatePagesHint);
  videoStart.addEventListener('input', updateVideoConsumed);
  videoEnd.addEventListener('input', updateVideoConsumed);
  methodSelect.addEventListener('change', updateVideoFieldsVisibility);

  /* Desempate pela ordem de criação. Ids hoje são UUID (texto): subtrair dava
     NaN e a ordem do mesmo dia ficava arbitrária. createdAt primeiro; o id
     entra só como último critério, comparado como texto (estável). */
  function _ordemCriacao(a, b) {
    const ca = String(a && a.createdAt || ''), cb = String(b && b.createdAt || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    const na = Number(a && a.id), nb = Number(b && b.id);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a && a.id || '').localeCompare(String(b && b.id || ''));
  }
  /* Editar um registro de matéria/método DESATIVADO: a opção não existe mais no
     <select>, que ficava vazio e bloqueava o salvar. Acrescenta a opção só para
     este registro, marcada como desativada. */
  function _garantirOpcao(sel, valor) {
    if (!sel || !valor || [...sel.options].some(o => o.value === valor)) return;
    const o = document.createElement('option');
    o.value = valor; o.textContent = valor + ' (desativada)'; o.dataset.inativa = '1';
    sel.appendChild(o);
  }

  function refreshSubjectSelect() {
    const subjects = DB.getActiveSubjects();
    const subjectSelect = document.getElementById('subject');
    const currentVal = subjectSelect.value;
    if (subjects.length === 0) {
      subjectSelect.innerHTML = `<option value="">Cadastre uma matéria em Configurações</option>`;
      return;
    }
    subjectSelect.innerHTML = `<option value="" disabled>Selecione a matéria</option>` +
      subjects.map(s => `<option value="${escapeHtml(s.nome)}">${escapeHtml(s.nome)}</option>`).join('');
    if (subjects.find(s => s.nome === currentVal)) subjectSelect.value = currentVal;
    else subjectSelect.value = '';
  }

  function refreshMethodSelect(preferDefault) {
    const methods = DB.getActiveMethods();
    const methodSelect = document.getElementById('method');
    const currentVal = methodSelect.value;
    methodSelect.innerHTML = methods.map(m => `<option>${escapeHtml(m.nome)}</option>`).join('');
    // preserva a seleção atual; senão, usa "Questões" como padrão (o mais usual)
    if (!preferDefault && methods.find(m => m.nome === currentVal)) methodSelect.value = currentVal;
    else {
      const questoes = methods.find(m => m.nome.toLowerCase() === 'questões' || m.nome.toLowerCase() === 'questoes');
      methodSelect.value = questoes ? questoes.nome : (methods[0] ? methods[0].nome : '');
    }
  }

  function enterEditMode(entry) {
    editingId = entry.id;
    _garantirOpcao($id('subject'), entry.subject);
    $id('subject').value = entry.subject;
    $id('lesson').value = entry.lesson || '';
    _garantirOpcao($id('method'), entry.method);
    $id('method').value = entry.method;
    dateInput.value = entry.date;
    pageStart.value = entry.pageStart ?? '';
    pageEnd.value = entry.pageEnd ?? '';
    videoStart.value = entry.videoStart ?? '';
    videoEnd.value = entry.videoEnd ?? '';
    $id('duration-h').value = Math.floor(entry.durationMin / 60) || '';
    $id('duration-m').value = entry.durationMin % 60 || '';
    correctInput.value = entry.correct || '';
    totalInput.value = entry.total || '';
    $id('comment').value = entry.comment || '';

    updateGauge();
    updatePagesHint();
    updateVideoFieldsVisibility();
    updateVideoConsumed();

    formTitle.textContent = 'Editar sessão de estudo';
    editNote.style.display = 'block';
    cancelEditBtn.style.display = 'inline-block';
    submitBtn.textContent = 'Salvar alterações';

    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exitEditMode() {
    editingId = null;
    form.reset();
    dateInput.value = todayLocal();
    refreshMethodSelect(true);
    refreshSubjectSelect();
    $id('subject').value = '';
    updateGauge();
    atualizarEtapas();   // trilha volta ao início junto com o formulário
    updatePagesHint();
    updateVideoConsumed();
    updateVideoFieldsVisibility();

    formTitle.textContent = 'Nova sessão de estudo';
    editNote.style.display = 'none';
    cancelEditBtn.style.display = 'none';
    submitBtn.textContent = 'Registrar estudo';
  }

  cancelEditBtn.addEventListener('click', exitEditMode);

  function renderRecent() {
    const allEntries = todosOsRegistros();
    if (allEntries.length === 0) {
      recentSection.style.display = 'none';
      return;
    }
    recentSection.style.display = 'block';
    _variosPlanos = new Set(allEntries.map(e => String(e._planId || ''))).size > 1;

    // ordena sempre por data (mais recente no topo); desempata pela ordem de criação (id/createdAt)
    let entries = allEntries.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return _ordemCriacao(b, a);
    });
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      entries = entries.filter(e => {
        const [y, m, d] = e.date.split('-');
        const dateFull = `${d}/${m}/${y}`;   // 14/08/2026
        const dateShort = `${d}/${m}`;        // 14/08
        return (
          e.subject.toLowerCase().includes(q) ||
          (e.lesson && e.lesson.toLowerCase().includes(q)) ||
          e.method.toLowerCase().includes(q) ||
          dateFull.includes(q) ||
          dateShort.includes(q)
        );
      });
    }

    // Na visão TABELA, alarga a área de conteúdo (fica DENTRO do main-content,
    // nunca sobre a sidebar). O toggle é limpo ao voltar para Cartões.
    const _isTable = recentView === 'tabela';
    recentSection.classList.toggle('reg-mode-table', _isTable);
    const _wrap = document.querySelector('.content-wrap');
    if (_wrap) _wrap.classList.toggle('wrap-reg-table', _isTable);

    const chave = [searchTerm, recentView, JSON.stringify(typeof tblFilters !== 'undefined' ? tblFilters : null), JSON.stringify(typeof tblSort !== 'undefined' ? tblSort : null)].join('|');
    if (chave !== _recentChave) { _recentChave = chave; recentLimite = RECENT_PASSO; }

    if (entries.length === 0) {
      recentList.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 16px 0;">Nenhum registro encontrado para "${escapeHtml(searchTerm)}".</p>`;
      return;
    }

    if (recentView === 'tabela') { renderRecentTable(entries); return; }

    recentList.innerHTML = entries.slice(0, recentLimite).map(e => {
      const hasPct = e.total > 0;
      const pct = hasPct ? calcPct(e.correct, e.total) : null;
      const tone = hasPct ? toneFor(pct) : null;
      const hours = Math.floor(e.durationMin / 60);
      const mins = e.durationMin % 60;
      const timeStr = (hours > 0 ? hours + 'h ' : '') + (mins > 0 || hours === 0 ? mins + 'min' : '');
      const [y, m, d] = e.date.split('-');
      const editable = entryIsLocal(e);
      return `
        <div class="recent-item" data-id="${e.id}">
          <div class="recent-date-block">
            <span class="recent-date-dm">${d}/${m}</span>
            <span class="recent-date-y">${y}</span>
          </div>
          <div class="recent-main">
            <div class="subject">${escapeHtml(e.subject)}</div>
            <div class="meta-badges">
              <span class="meta-badge badge-method">${escapeHtml(e.method)}</span>
              <span class="meta-badge badge-duration">${timeStr}</span>
              ${progressBadgeHtml(e)}
              ${e.lesson ? `<span class="meta-badge badge-lesson">${escapeHtml(e.lesson)}</span>` : ''}
              ${entryPlanBadge(e)}
            </div>
            ${e.comment ? `<div class="comment">${escapeHtml(e.comment)}</div>` : ''}
          </div>
          ${hasPct ? `
            <div class="recent-pct-block">
              <div class="recent-pct tone-${tone}">${formatPct(pct)}%</div>
              <div class="recent-pct-count">${e.correct}/${e.total}</div>
            </div>
          ` : '<div class="recent-pct-block is-empty"></div>'}
          <div class="recent-actions">
            ${editable ? `
              <button type="button" class="reg-act-btn btn-edit-entry" title="Editar registro" aria-label="Editar registro">✎</button>
              <button type="button" class="reg-act-btn danger btn-delete-entry" title="Excluir registro" aria-label="Excluir registro">✕</button>
            ` : `<span class="reg-readonly" title="Registro de outro planejamento — somente leitura">🔒</span>`}
          </div>
        </div>
      `;
    }).join('') + botaoMais(entries.length, 'cartoes');

    wireEntryRows();
    ligarMostrarMais();
  }
  function ligarMostrarMais() {
    const b = recentList.querySelector('.recent-more-btn');
    if (b) b.addEventListener('click', () => { recentLimite += RECENT_PASSO; renderRecent(); });
  }

  // Liga os botões de editar/excluir de cada linha — funciona tanto para os
  // cartões (.recent-item) quanto para as linhas da tabela (.reg-row).
  function wireEntryRows() {
    // Um único levantamento dos registros (antes: um por LINHA, O(n²) — com
    // milhares de registros a tela travava vários segundos).
    const todos = todosOsRegistros();
    const porId = new Map(todos.map(e => [String(e.id), e]));
    recentList.querySelectorAll('.recent-item, .reg-row').forEach(row => {
      // Sem parseFloat: o id agora pode ser UUID (texto). parseFloat devolveria
      // NaN e os botões parariam de funcionar sem erro visível.
      const id = row.dataset.id;
      const visible = porId.get(String(id)) || (DB._mesmoId ? todos.find(e => DB._mesmoId(e.id, id)) : null);
      if (visible && !entryIsLocal(visible)) return;
      const eb = row.querySelector('.btn-edit-entry');
      const db = row.querySelector('.btn-delete-entry');
      if (eb) eb.addEventListener('click', () => {
        const entry = DB.getEntry(id);
        if (entry) enterEditMode(entry);
      });
      if (db) db.addEventListener('click', async () => {
        const entry = DB.getEntry(id);
        if (!entry) return;
        if (!await UI.confirm(`Excluir o registro de "${entry.subject}" em ${formatDateShort(entry.date)}?\n\nEssa ação não pode ser desfeita.`,
          { title: '🗑️ Excluir registro', okText: 'Excluir', danger: true })) return;
        const res = await SaveGuard.run({
          escrever: () => DB.deleteEntry(id),
          verificar: () => !DB.getEntry(id)            // prova: sumiu mesmo do disco
        });
        if (!res.ok) { SaveGuard.toast(res, ''); return; }
        if (DB._mesmoId(editingId, id)) exitEditMode();
        SaveGuard.toast(res, 'Registro excluído');
        renderRecent();
        window.dispatchEvent(new CustomEvent('data:entry-changed'));
      });
    });
  }

  // ── Visão em TABELA: colunas ordenáveis + filtros inteligentes por coluna ──
  // Barra de rolagem horizontal CUSTOM: a nativa é overlay/invisível em muitos
  // navegadores (o usuário não via que dava pra rolar). Esta é sempre visível,
  // sincronizada com o scroll da tabela, e arrastável. Aparece só quando há o que rolar.
  function setupRegHBar() {
    const sc = document.getElementById('reg-tbl-scroll');
    // duas barras (uma logo acima do filtro, outra abaixo da tabela): a tabela
    // pode ter centenas de linhas e a barra de baixo fica longe demais para
    // servir de atalho — a de cima resolve sem precisar descer até o fim.
    const bars = [
      { bar: document.getElementById('reg-hbar-top'), thumb: document.getElementById('reg-hbar-top-thumb') },
      { bar: document.getElementById('reg-hbar'), thumb: document.getElementById('reg-hbar-thumb') }
    ].filter(b => b.bar && b.thumb);
    if (!sc || !bars.length) return;
    const sync = () => {
      const overflow = sc.scrollWidth - sc.clientWidth;
      const has = overflow > 2;
      bars.forEach(({ bar, thumb }) => {
        bar.classList.toggle('show', has);
        if (!has) return;
        const ratio = sc.clientWidth / sc.scrollWidth;
        const trackW = bar.clientWidth;
        const thumbW = Math.max(40, Math.round(trackW * ratio));
        const maxLeft = trackW - thumbW;
        const left = overflow > 0 ? Math.round((sc.scrollLeft / overflow) * maxLeft) : 0;
        thumb.style.width = thumbW + 'px';
        thumb.style.transform = 'translateX(' + left + 'px)';
      });
    };
    sc.addEventListener('scroll', sync, { passive: true });
    // recalcula quando a janela muda de tamanho (fica ligado a esta render)
    if (setupRegHBar._ro) setupRegHBar._ro.disconnect();
    if (window.ResizeObserver) { setupRegHBar._ro = new ResizeObserver(sync); setupRegHBar._ro.observe(sc); }
    else window.addEventListener('resize', sync);
    // arrastar o thumb (de qualquer uma das duas barras) move a tabela
    bars.forEach(({ bar, thumb }) => {
      let dragging = false, startX = 0, startLeft = 0;
      const onDown = (e) => {
        dragging = true; startX = (e.touches ? e.touches[0].clientX : e.clientX);
        startLeft = sc.scrollLeft; e.preventDefault();
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
      };
      const onMove = (e) => {
        if (!dragging) return;
        const x = (e.touches ? e.touches[0].clientX : e.clientX);
        const overflow = sc.scrollWidth - sc.clientWidth;
        const trackW = bar.clientWidth; const thumbW = thumb.offsetWidth;
        const maxLeft = trackW - thumbW;
        const deltaPx = x - startX;
        const deltaScroll = maxLeft > 0 ? (deltaPx / maxLeft) * overflow : 0;
        sc.scrollLeft = startLeft + deltaScroll;
        if (e.cancelable) e.preventDefault();
      };
      const onUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
      };
      thumb.addEventListener('mousedown', onDown);
      thumb.addEventListener('touchstart', onDown, { passive: false });
      // clicar na trilha "salta" o scroll para a posição
      bar.addEventListener('mousedown', (e) => {
        if (e.target === thumb) return;
        const rect = bar.getBoundingClientRect();
        const rel = (e.clientX - rect.left) / rect.width;
        sc.scrollLeft = rel * (sc.scrollWidth - sc.clientWidth);
      });
    });
    requestAnimationFrame(sync);
  }

  function renderRecentTable(baseEntries) {
    // Opções de filtro (matéria/forma) a partir do universo já buscado
    const subjects = Array.from(new Set(baseEntries.map(e => e.subject))).sort((a, b) => a.localeCompare(b, 'pt'));
    const methods = Array.from(new Set(baseEntries.map(e => e.method))).sort((a, b) => a.localeCompare(b, 'pt'));

    // Aplica os filtros por coluna
    const inc = (v, q) => String(v || '').toLowerCase().includes(q.toLowerCase());
    let rows = baseEntries.filter(e => {
      const [y, m, d] = e.date.split('-');
      const dateStr = `${d}/${m}/${y}`;
      if (tblFilters.subject && e.subject !== tblFilters.subject) return false;
      if (tblFilters.method && e.method !== tblFilters.method) return false;
      if (tblFilters.lesson && !inc(e.lesson, tblFilters.lesson)) return false;
      if (tblFilters.date && !inc(dateStr, tblFilters.date) && !inc(`${d}/${m}`, tblFilters.date)) return false;
      return true;
    });

    // Ordenação
    const pctOf = e => (e.total > 0 ? (e.correct / e.total) : -1);
    const cmp = {
      date: (a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : _ordemCriacao(a, b)),
      subject: (a, b) => a.subject.localeCompare(b.subject, 'pt'),
      lesson: (a, b) => String(a.lesson || '').localeCompare(String(b.lesson || ''), 'pt'),
      method: (a, b) => a.method.localeCompare(b.method, 'pt'),
      time: (a, b) => (a.durationMin || 0) - (b.durationMin || 0),
      correct: (a, b) => (a.total || 0) - (b.total || 0),
      pct: (a, b) => pctOf(a) - pctOf(b)
    }[tblSort.key] || null;
    if (cmp) { rows.sort(cmp); if (tblSort.dir === 'desc') rows.reverse(); }

    const arrow = k => tblSort.key === k ? (tblSort.dir === 'asc' ? '▲' : '▼') : '';
    // Cabeçalho = <th> real com botão interno (ordenável e acessível).
    const hCell = (k, label, colCls) => `<th class="reg-th ${colCls || ''} ${tblSort.key === k ? 'is-sorted' : ''}" scope="col"><button type="button" class="reg-h sortable" data-sort="${k}">${label}<span class="sort-ind">${arrow(k)}</span></button></th>`;

    const opt = (arr, sel) => ['<option value="">Todas</option>'].concat(
      arr.map(v => `<option value="${escapeHtml(v)}" ${v === sel ? 'selected' : ''}>${escapeHtml(v)}</option>`)).join('');

    const bodyRows = rows.slice(0, recentLimite).map(e => {
      const hasPct = e.total > 0;
      const pct = hasPct ? calcPct(e.correct, e.total) : null;
      const tone = hasPct ? toneFor(pct) : 'none';
      const hours = Math.floor(e.durationMin / 60);
      const mins = e.durationMin % 60;
      const timeStr = (hours > 0 ? hours + 'h ' : '') + (mins > 0 || hours === 0 ? mins + 'min' : '');
      const [y, m, d] = e.date.split('-');
      const subj = escapeHtml(e.subject);
      const less = e.lesson ? escapeHtml(e.lesson) : '';
      const meth = escapeHtml(e.method);
      const pctBadge = hasPct
        ? `<span class="reg-pct-badge tone-${tone}">${medalHtml(pct)}${formatPct(pct)}%</span>`
        : '<span class="reg-empty">—</span>';
      const obs = e.comment ? escapeHtml(e.comment) : '';
      const editable = entryIsLocal(e);
      return `
        <tr class="reg-row" data-id="${e.id}">
          <td class="reg-c reg-c-date">${d}/${m}/${y}</td>
          <th scope="row" class="reg-c reg-c-subject" title="${subj}"><span>${subj}</span>${_variosPlanos && e._planNome ? `<small class="reg-origin-plan">${e._planPaused ? '⏸ ' : ''}${escapeHtml(e._planNome)}</small>` : ''}</th>
          <td class="reg-c reg-c-lesson" title="${less}">${less || '<span class="reg-empty">—</span>'}</td>
          <td class="reg-c reg-c-method" title="${meth}"><span class="reg-method-chip">${meth}</span></td>
          <td class="reg-c reg-c-num reg-c-time">${timeStr}</td>
          <td class="reg-c reg-c-num reg-c-hits">${hasPct ? e.correct + '/' + e.total : '<span class="reg-empty">—</span>'}</td>
          <td class="reg-c reg-c-pct">${pctBadge}</td>
          <td class="reg-c reg-c-act">
            <div class="reg-act-group">
              ${editable ? `
                <button type="button" class="reg-act-btn btn-edit-entry" title="Editar registro" aria-label="Editar registro">✎</button>
                <button type="button" class="reg-act-btn danger btn-delete-entry" title="Excluir registro" aria-label="Excluir registro">✕</button>
              ` : `<span class="reg-readonly" title="Registro de outro planejamento — somente leitura">🔒</span>`}
            </div>
          </td>
          <td class="reg-c reg-c-obs" title="${obs}">${obs ? `<span class="reg-obs-txt">${obs}</span>` : '<span class="reg-empty">—</span>'}</td>
        </tr>`;
    }).join('');

    const anyFilter = tblFilters.subject || tblFilters.method || tblFilters.lesson || tblFilters.date;
    // Sinaliza cabeçalho de ordenação também na barra de ordenação do mobile
    const sortOpts = [
      ['date', 'Data'], ['subject', 'Matéria'], ['lesson', 'Aula'], ['method', 'Forma'],
      ['time', 'Tempo'], ['correct', 'Acertos'], ['pct', '%']
    ].map(([k, l]) => `<option value="${k}" ${tblSort.key === k ? 'selected' : ''}>${l}</option>`).join('');

    recentList.innerHTML = `
      <div class="reg-filterbar" role="group" aria-label="Filtros dos registros">
        <div class="reg-filter-field">
          <label>Data</label>
          <input type="text" data-fk="date" value="${escapeHtml(tblFilters.date)}" placeholder="dd/mm" aria-label="Filtrar por data" inputmode="numeric">
        </div>
        <div class="reg-filter-field">
          <label>Matéria</label>
          <select data-fk="subject" aria-label="Filtrar por matéria">${opt(subjects, tblFilters.subject)}</select>
        </div>
        <div class="reg-filter-field">
          <label>Aula</label>
          <input type="text" data-fk="lesson" value="${escapeHtml(tblFilters.lesson)}" placeholder="Buscar aula" aria-label="Filtrar por aula">
        </div>
        <div class="reg-filter-field">
          <label>Forma</label>
          <select data-fk="method" aria-label="Filtrar por forma">${opt(methods, tblFilters.method)}</select>
        </div>
        <div class="reg-filter-field reg-sort-field">
          <label>Ordenar por</label>
          <div class="reg-sort-row">
            <select data-sortk aria-label="Ordenar por">${sortOpts}</select>
            <button type="button" class="reg-sort-dir" data-sortdir title="Inverter ordem" aria-label="Inverter ordem">${tblSort.dir === 'asc' ? '↑' : '↓'}</button>
          </div>
        </div>
        ${anyFilter ? '<button type="button" class="reg-filter-clear" id="reg-filter-clear">✕ Limpar filtros</button>' : ''}
      </div>

      <div class="reg-hbar reg-hbar-top" id="reg-hbar-top" aria-hidden="true"><div class="reg-hbar-thumb" id="reg-hbar-top-thumb"></div></div>
      <div class="reg-tbl-scroll" id="reg-tbl-scroll">
        <table class="reg-tbl">
          <colgroup>
            <col class="rc-date"><col class="rc-subject"><col class="rc-lesson"><col class="rc-method">
            <col class="rc-time"><col class="rc-hits"><col class="rc-pct"><col class="rc-act"><col class="rc-obs">
          </colgroup>
          <thead>
            <tr>
              ${hCell('date', 'Data', 'reg-th-date')}
              ${hCell('subject', 'Matéria', 'reg-th-subject')}
              ${hCell('lesson', 'Aula')}
              ${hCell('method', 'Forma')}
              ${hCell('time', 'Tempo', 'reg-th-num')}
              ${hCell('correct', 'Acertos', 'reg-th-num')}
              ${hCell('pct', '%', 'reg-th-num')}
              <th class="reg-th reg-th-act" scope="col"><span class="reg-h reg-h-static">Ações</span></th>
              <th class="reg-th reg-th-obs" scope="col"><span class="reg-h reg-h-static">Observação</span></th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows || `<tr class="reg-noresult-row"><td colspan="9" class="reg-noresult">Nenhum registro atende aos filtros aplicados.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="reg-hbar" id="reg-hbar" aria-hidden="true"><div class="reg-hbar-thumb" id="reg-hbar-thumb"></div></div>
      <div class="reg-table-foot">
        <span class="count">Mostrando <strong>${Math.min(rows.length, recentLimite)}</strong> de ${rows.length}${rows.length !== baseEntries.length ? ' (' + baseEntries.length + ' no total)' : ''} registro${rows.length === 1 ? '' : 's'}${anyFilter ? ' (filtrados)' : ''}.</span>
      </div>${botaoMais(rows.length, 'tabela')}`;

    // Barra de rolagem CUSTOM (sempre visível quando a tabela transborda a caixa)
    setupRegHBar();

    // Ordenação por clique no cabeçalho (desktop)
    recentList.querySelectorAll('.reg-h.sortable').forEach(h => {
      h.addEventListener('click', () => {
        const k = h.dataset.sort;
        if (tblSort.key === k) tblSort.dir = (tblSort.dir === 'asc' ? 'desc' : 'asc');
        else { tblSort.key = k; tblSort.dir = (k === 'subject' || k === 'lesson' || k === 'method') ? 'asc' : 'desc'; }
        renderRecent();
      });
    });
    // Ordenação pela barra (mobile): select de campo + botão de direção
    const sortSel = recentList.querySelector('[data-sortk]');
    if (sortSel) sortSel.addEventListener('change', () => {
      const k = sortSel.value;
      tblSort.key = k;
      tblSort.dir = (k === 'subject' || k === 'lesson' || k === 'method') ? 'asc' : 'desc';
      renderRecent();
    });
    const sortDir = recentList.querySelector('[data-sortdir]');
    if (sortDir) sortDir.addEventListener('click', () => {
      tblSort.dir = (tblSort.dir === 'asc' ? 'desc' : 'asc');
      renderRecent();
    });
    // Filtros
    recentList.querySelectorAll('.reg-filterbar [data-fk]').forEach(inp => {
      const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
      inp.addEventListener(ev, () => {
        if (inp.tagName !== 'SELECT') { try { _pendingFocus = { fk: inp.dataset.fk, pos: inp.selectionStart }; } catch (e) { _pendingFocus = { fk: inp.dataset.fk, pos: null }; } }
        tblFilters[inp.dataset.fk] = inp.value;
        renderRecent();
      });
    });
    const clr = document.getElementById('reg-filter-clear');
    if (clr) clr.addEventListener('click', () => { tblFilters = { subject: '', lesson: '', method: '', date: '' }; renderRecent(); });

    // Devolve o foco (e a posição do cursor) ao filtro de texto que estava sendo digitado
    if (_pendingFocus) {
      const back = recentList.querySelector(`.reg-filterbar [data-fk="${_pendingFocus.fk}"]`);
      if (back) {
        back.focus();
        if (_pendingFocus.pos != null) { try { back.setSelectionRange(_pendingFocus.pos, _pendingFocus.pos); } catch (e) { _quiet(e); } }
      }
      _pendingFocus = null;
    }

    wireEntryRows();
    ligarMostrarMais();
  }

  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value.trim();
    renderRecent();
  });

  // Alternador de visão: Cartões ⇄ Tabela (com filtros por coluna)
  (function () {
    const seg = document.getElementById('recent-view-seg');
    if (!seg) return;
    const paint = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === recentView));
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (recentView === b.dataset.v) return;
      recentView = b.dataset.v;
      DB.setRaw(_recentViewKey(), recentView);   // grava, avisa a nuvem e marca a seção
      paint();
      renderRecent();
    }));
    paint();
  })();

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (form.dataset.saving === '1') return;   // trava contra duplo toque / duplo submit

    const subject = $id('subject').value.trim();
    const lesson = $id('lesson').value.trim();
    const method = $id('method').value;
    const date = dateInput.value;
    const pStart = pageStart.value ? parseInt(pageStart.value, 10) : null;
    const pEnd = pageEnd.value ? parseInt(pageEnd.value, 10) : null;
    // Minutos de vídeo (posição no vídeo) — só guarda quando a forma de estudo é vídeo/aula
    const isVid = isVideoMethod(method);
    const vStart = (isVid && videoStart.value !== '') ? parseFloat(videoStart.value) : null;
    const vEnd = (isVid && videoEnd.value !== '') ? parseFloat(videoEnd.value) : null;
    const durH = parseInt($id('duration-h').value, 10) || 0;
    const durM = parseInt($id('duration-m').value, 10) || 0;
    const durationMin = durH * 60 + durM;
    const correct = correctInput.value ? parseInt(correctInput.value, 10) : 0;
    const total = totalInput.value ? parseInt(totalInput.value, 10) : 0;
    const comment = $id('comment').value.trim();

    if (!subject || !date) {
      showToast('Preencha matéria e data');
      return;
    }
    /* ── ACERTOS NUNCA PASSAM DO TOTAL ────────────────────────────────────────
       Este é o portão de entrada de TODA questão do app. Sem esta checagem dava
       para gravar "30 acertos de 20 questões", e o aproveitamento acima de 100%
       vazava para o Ciclo, o Histórico, a Evolução e o Relatório — que somam
       acertos e questões e não têm como desconfiar do dado. O medidor da própria
       tela já limitava a exibição a 100%, o que escondia o erro em vez de
       impedi-lo: a barra dizia 100% e o banco guardava 150%. */
    if (total > 0 && correct > total) {
      showToast('Os acertos (' + correct + ') não podem passar do total de questões (' + total + ')');
      correctInput.focus();
      correctInput.select();
      return;
    }
    if (total <= 0 && correct > 0) {
      showToast('Informe o total de questões resolvidas');
      totalInput.focus();
      return;
    }

    const fields = { subject, lesson, method, date, pageStart: pStart, pageEnd: pEnd, videoStart: vStart, videoEnd: vEnd, durationMin, correct, total, comment };

    /* ── GRAVAÇÃO COM CONFIRMAÇÃO DO BANCO ───────────────────────────────────
       O formulário só é liberado depois que o Supabase confirma o INSERT/UPDATE.
       A projeção em memória nunca é tratada como persistência. */
    const submitBtn = document.getElementById('submit-btn');
    form.dataset.saving = '1';
    const soltarBotao = SaveGuard.ocupar(submitBtn, 'Salvando…');

    try {
      if (editingId !== null) {
        const alvo = editingId;
        const res = await SaveGuard.run({
          escrever: () => DB.updateEntry(alvo, fields),
          // confere a projeção em memória; a persistência é provada pelo SaveGuard no SQL
          verificar: () => {
            const e2 = DB.getEntry(alvo);
            return !!e2 && e2.date === date && e2.subject === subject && (e2.durationMin || 0) === durationMin;
          }
        });
        if (!res.ok) { SaveGuard.toast(res, ''); return; }
        DB.upsertSubjectName(subject);
        SaveGuard.toast(res, 'Registro atualizado');
        exitEditMode();
        renderRecent();
        refreshSubjectSelect();
        window.dispatchEvent(new CustomEvent('data:entry-changed'));
      } else {
        // ID por UUID, não por Date.now(): dois registros criados no MESMO milissegundo
        // (duplo toque no botão, importação em lote, celular lento que dispara o submit
        // duas vezes) recebiam o mesmo id — e a partir daí editar ou apagar um deles
        // atingia o outro. DB._uid() já é usado pelos cards e não colide.
        const entry = { id: DB._uid(), ...fields, createdAt: new Date().toISOString() };
        /* INSERT relacional: só limpa o formulário quando o banco confirmou. */
        const res = await SaveGuard.run({
          escrever: () => DB.saveEntry(entry),
          verificar: () => !!DB.getEntry(entry.id)
        });
        if (!res.ok) { SaveGuard.toast(res, ''); renderRecent(); return; }
        DB.upsertSubjectName(subject);
        try { if (window.RelationalStore) await RelationalStore.flush(); } catch (e) { _quiet(e, 'subject-after-entry'); }
        SaveGuard.toast(res, 'Estudo registrado');
        form.reset();
        dateInput.value = todayLocal();
        refreshMethodSelect(true); // volta ao padrão "Questões"
        refreshSubjectSelect();
        $id('subject').value = ''; // matéria em branco p/ o usuário escolher
        updateGauge();
        atualizarEtapas();   // trilha volta ao início junto com o formulário
        updatePagesHint();
        updateVideoConsumed();
        updateVideoFieldsVisibility();
        renderRecent();
        window.dispatchEvent(new CustomEvent('data:entry-added', { detail: entry }));
      }
    } finally {
      form.dataset.saving = '0';
      soltarBotao();
      // exitEditMode() troca o rotulo do botao; garante o texto certo depois do restore
      if (editingId === null) submitBtn.textContent = 'Registrar estudo';
    }
  });

  updateGauge();
  refreshMethodSelect(true);
  refreshSubjectSelect();
  $id('subject').value = '';
  updateVideoFieldsVisibility();
  renderRecent();

  // expõe pra outras telas poderem forçar refresh se precisarem
  /* ── TRILHA DE ETAPAS ──────────────────────────────────────────────────────
     Acende cada etapa conforme ela é preenchida e move a barra de progresso.
     Só LÊ o formulário — não valida nada e não bloqueia o envio: a ordem é uma
     sugestão visual, não uma prisão. Quem quiser pular direto para o comentário
     e salvar, continua podendo.
     As etapas 4 e 5 são opcionais, então contam como concluídas quando têm
     conteúdo; do contrário ficam neutras, sem parecer pendência. */
  function atualizarEtapas() {
    const val = (id) => { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
    const preenchida = {
      1: !!val('subject'),
      2: !!val('date'),
      3: (Number(val('duration-h')) > 0 || Number(val('duration-m')) > 0),
      4: (!!val('correct') && !!val('total')),
      5: !!val('comment')
    };
    // "obrigatórias" para a barra: 1, 2 e 3. As opcionais somam bônus quando usadas.
    const base = [1, 2, 3].filter(n => preenchida[n]).length;
    const extra = [4, 5].filter(n => preenchida[n]).length;
    const pct = Math.round(((base + extra) / 5) * 100);

    let ativa = 0;
    for (let n = 1; n <= 5; n++) {
      const el = document.getElementById('step-' + n);
      if (!el) continue;
      el.classList.toggle('done', preenchida[n]);
      el.classList.remove('active');
      if (!ativa && !preenchida[n]) ativa = n;
    }
    if (ativa) { const a = document.getElementById('step-' + ativa); if (a) a.classList.add('active'); }

    const fill = document.getElementById('step-progress-fill');
    if (fill) fill.style.width = pct + '%';
    const lab = document.getElementById('step-progress-label');
    if (lab) {
      // O rótulo segue a etapa REALMENTE destacada. Antes ele usava a contagem de
      // concluídas, o que fazia dizer "Etapa 2" enquanto a 1 estava acesa — a data
      // e a forma de estudo já vêm preenchidas, então a etapa 2 nasce concluída e
      // as duas contas divergiam.
      lab.textContent = ativa ? ('Etapa ' + ativa + ' de 5')
        : (extra === 2 ? 'Tudo preenchido' : 'Pronto para registrar');
    }
  }
  // Um só listener no formulário (delegação): cobre campos que aparecem depois,
  // como os de vídeo, sem precisar religar nada.
  (function ligarEtapas() {
    const form = document.getElementById('study-form');
    if (!form) return;
    ['input', 'change'].forEach(ev => form.addEventListener(ev, atualizarEtapas));
    atualizarEtapas();
  })();
  window.atualizarEtapasRegistrar = atualizarEtapas;

  /* A tela nasce antes do login, portanto o primeiro render enxerga a memória
     vazia. Depois que o PostgreSQL hidrata o perfil, é obrigatório redesenhar
     a projeção visual: os dados já estão na RAM, mas DOM antigo não se atualiza
     sozinho. O mesmo evento também cobre catch-up/realtime entre aparelhos. */
  function refreshFromRelationalStore() {
    refreshSubjectSelect();
    refreshMethodSelect(false);
    renderRecent();
    updateGauge();
    updatePagesHint();
    updateVideoConsumed();
    updateVideoFieldsVisibility();
    atualizarEtapas();
  }
  window.addEventListener('data:relational-hydrated', refreshFromRelationalStore);
  window.addEventListener('screen:activated', (e) => {
    if (e.detail && e.detail.screen === 'registrar') refreshFromRelationalStore();
  });

  window.RegistrarScreen = { refreshSubjectSelect, refreshMethodSelect, renderRecent, atualizarEtapas, refreshFromRelationalStore };
})();
