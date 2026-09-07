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
  // Visão da lista de registros: 'cartoes' (padrão) ou 'tabela' (com filtros por coluna)
  let recentView = 'cartoes';
  try { recentView = localStorage.getItem('diario-estudos:recent-view') || 'cartoes'; } catch (e) { _quiet(e); }
  let tblFilters = { subject: '', lesson: '', method: '', date: '' };
  let tblSort = { key: 'date', dir: 'desc' };
  let _pendingFocus = null; // { fk, pos } — devolve o foco ao filtro de texto após re-render

  dateInput.value = todayLocal();
  gaugeFill.style.strokeDasharray = CIRC;
  gaugeFill.style.strokeDashoffset = CIRC;

  function updateGauge() {
    const correct = parseFloat(correctInput.value);
    const total = parseFloat(totalInput.value);
    gauge.classList.remove('tone-good', 'tone-warn', 'tone-bad');
    perfPanel.classList.remove('tone-good', 'tone-warn', 'tone-bad');

    if (!total || total <= 0 || isNaN(correct)) {
      gaugePct.textContent = '—';
      gaugeFill.style.strokeDashoffset = CIRC;
      return;
    }
    const pct = Math.max(0, Math.min(100, calcPct(correct, total)));
    gaugePct.textContent = formatPct(pct);
    gaugeFill.style.strokeDashoffset = CIRC - (CIRC * pct / 100);
    const tone = toneFor(pct);
    gauge.classList.add('tone-' + tone);
    perfPanel.classList.add('tone-' + tone);
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
    $id('subject').value = entry.subject;
    $id('lesson').value = entry.lesson || '';
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
    const allEntries = DB.getEntries();
    if (allEntries.length === 0) {
      recentSection.style.display = 'none';
      return;
    }
    recentSection.style.display = 'block';

    // ordena sempre por data (mais recente no topo); desempata pela ordem de criação (id/createdAt)
    let entries = allEntries.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.id || 0) - (a.id || 0);
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

    if (entries.length === 0) {
      recentList.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 16px 0;">Nenhum registro encontrado para "${escapeHtml(searchTerm)}".</p>`;
      return;
    }

    if (recentView === 'tabela') { renderRecentTable(entries); return; }

    recentList.innerHTML = entries.map(e => {
      const hasPct = e.total > 0;
      const pct = hasPct ? calcPct(e.correct, e.total) : null;
      const tone = hasPct ? toneFor(pct) : null;
      const hours = Math.floor(e.durationMin / 60);
      const mins = e.durationMin % 60;
      const timeStr = (hours > 0 ? hours + 'h ' : '') + (mins > 0 || hours === 0 ? mins + 'min' : '');
      const [y, m, d] = e.date.split('-');
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
            <button type="button" class="reg-act-btn btn-edit-entry" title="Editar registro" aria-label="Editar registro">✎</button>
            <button type="button" class="reg-act-btn danger btn-delete-entry" title="Excluir registro" aria-label="Excluir registro">✕</button>
          </div>
        </div>
      `;
    }).join('');

    wireEntryRows();
  }

  // Liga os botões de editar/excluir de cada linha — funciona tanto para os
  // cartões (.recent-item) quanto para as linhas da tabela (.reg-row).
  function wireEntryRows() {
    recentList.querySelectorAll('.recent-item, .reg-row').forEach(row => {
      // Sem parseFloat: o id agora pode ser UUID (texto). parseFloat devolveria
      // NaN e os botões parariam de funcionar sem erro visível.
      const id = row.dataset.id;
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
    const bar = document.getElementById('reg-hbar');
    const thumb = document.getElementById('reg-hbar-thumb');
    if (!sc || !bar || !thumb) return;
    const sync = () => {
      const overflow = sc.scrollWidth - sc.clientWidth;
      if (overflow <= 2) { bar.classList.remove('show'); return; }
      bar.classList.add('show');
      const ratio = sc.clientWidth / sc.scrollWidth;
      const trackW = bar.clientWidth;
      const thumbW = Math.max(40, Math.round(trackW * ratio));
      const maxLeft = trackW - thumbW;
      const left = overflow > 0 ? Math.round((sc.scrollLeft / overflow) * maxLeft) : 0;
      thumb.style.width = thumbW + 'px';
      thumb.style.transform = 'translateX(' + left + 'px)';
    };
    sc.addEventListener('scroll', sync, { passive: true });
    // recalcula quando a janela muda de tamanho (fica ligado a esta render)
    if (setupRegHBar._ro) setupRegHBar._ro.disconnect();
    if (window.ResizeObserver) { setupRegHBar._ro = new ResizeObserver(sync); setupRegHBar._ro.observe(sc); }
    else window.addEventListener('resize', sync);
    // arrastar o thumb move a tabela
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
      date: (a, b) => a.date < b.date ? -1 : (a.date > b.date ? 1 : ((a.id || 0) - (b.id || 0))),
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

    const bodyRows = rows.map(e => {
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
      return `
        <tr class="reg-row" data-id="${e.id}">
          <td class="reg-c reg-c-date">${d}/${m}/${y}</td>
          <th scope="row" class="reg-c reg-c-subject" title="${subj}"><span>${subj}</span></th>
          <td class="reg-c reg-c-lesson" title="${less}">${less || '<span class="reg-empty">—</span>'}</td>
          <td class="reg-c reg-c-method" title="${meth}"><span class="reg-method-chip">${meth}</span></td>
          <td class="reg-c reg-c-num reg-c-time">${timeStr}</td>
          <td class="reg-c reg-c-num reg-c-hits">${hasPct ? e.correct + '/' + e.total : '<span class="reg-empty">—</span>'}</td>
          <td class="reg-c reg-c-pct">${pctBadge}</td>
          <td class="reg-c reg-c-act">
            <div class="reg-act-group">
              <button type="button" class="reg-act-btn btn-edit-entry" title="Editar registro" aria-label="Editar registro">✎</button>
              <button type="button" class="reg-act-btn danger btn-delete-entry" title="Excluir registro" aria-label="Excluir registro">✕</button>
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
        <span class="count">Mostrando <strong>${rows.length}</strong> de ${baseEntries.length} registro${baseEntries.length === 1 ? '' : 's'}${anyFilter ? ' (filtrados)' : ''}.</span>
      </div>`;

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
      try { localStorage.setItem('diario-estudos:recent-view', recentView); } catch (e) { _quiet(e); }
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

    const fields = { subject, lesson, method, date, pageStart: pStart, pageEnd: pEnd, videoStart: vStart, videoEnd: vEnd, durationMin, correct, total, comment };

    /* ── GRAVACAO COM PROVA ──────────────────────────────────────────────────
       Esta e a tela que sustenta o diario inteiro. Enquanto o registro nao
       estiver comprovadamente no armazenamento (e a caminho da nuvem), o botao
       fica girando e travado. Se a gravacao falhar, o formulario NAO e limpo —
       o que foi digitado continua na tela para ser reenviado. */
    const submitBtn = document.getElementById('submit-btn');
    form.dataset.saving = '1';
    const soltarBotao = SaveGuard.ocupar(submitBtn, 'Salvando…');

    try {
      if (editingId !== null) {
        const alvo = editingId;
        const res = await SaveGuard.run({
          escrever: () => DB.updateEntry(alvo, fields),
          // prova: rele do armazenamento e confere que o patch esta la
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
        const res = await SaveGuard.run({
          escrever: () => DB.saveEntry(entry),
          verificar: () => !!DB.getEntry(entry.id)     // prova: esta no disco
        });
        if (!res.ok) { SaveGuard.toast(res, ''); return; }   // formulario preservado de proposito
        DB.upsertSubjectName(subject);
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

  window.RegistrarScreen = { refreshSubjectSelect, refreshMethodSelect, renderRecent, atualizarEtapas };
})();
