/* ============================================================
   TELA: ESTUDO NOVO
   ============================================================ */
const EstudoNovoScreen = {
  currentSubject: null,
  draggedId: null,
  subjectFilter: '',
  commentEditing: new Set(), // ids das aulas com o editor de comentário aberto

  render() {
    const subjects = DB.getActiveSubjects();
    const layout = document.getElementById('en-layout');
    const emptyEl = document.getElementById('en-empty-subject');

    if (subjects.length === 0) {
      layout.style.display = 'none';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    layout.style.display = 'grid';

    // se a matéria selecionada foi desativada/removida, limpa a seleção
    if (this.currentSubject && !subjects.find(s => s.nome === this.currentSubject)) {
      this.currentSubject = null;
    }

    this.renderSubjectList(subjects);
    this.renderMainArea();
  },

  renderSubjectList(subjects) {
    const listEl = document.getElementById('en-subject-list');
    const q = this.subjectFilter.toLowerCase();
    // Ordena colocando PRIMEIRO as matérias que já têm aulas cadastradas (as com
    // trilha montada aparecem no topo), e dentro de cada grupo mantém a ordem
    // alfabética (pt-BR, ignorando acentos/caixa).
    const ordered = subjects.slice().sort((a, b) => {
      const ha = DB.getTrack(a.nome).some(i => i.type === 'aula');
      const hb = DB.getTrack(b.nome).some(i => i.type === 'aula');
      if (ha !== hb) return ha ? -1 : 1;
      return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
    });
    const filtered = q ? ordered.filter(s => s.nome.toLowerCase().includes(q)) : ordered;

    if (filtered.length === 0) {
      listEl.innerHTML = `<p style="color:var(--text-faint); font-size:12.5px; padding: 10px 8px;">Nenhuma matéria encontrada.</p>`;
      return;
    }

    listEl.innerHTML = filtered.map(s => {
      const items = DB.getTrack(s.nome);
      const total = items.filter(i => i.type === 'aula').length;
      const done = items.filter(i => i.type === 'aula' && DB.isStatusDone(i.status)).length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const isActive = s.nome === this.currentSubject;

      const progressHtml = total > 0
        ? `
          <div class="en-subject-progress-row">
            <div class="en-subject-progress-track"><div class="en-subject-progress-fill ${pct === 100 ? 'complete' : ''}" style="width:${pct}%;"></div></div>
            <span class="en-subject-progress-text">${done}/${total}</span>
          </div>
        `
        : `<span class="en-subject-empty-text">sem aulas ainda</span>`;

      return `
        <div class="en-subject-item ${isActive ? 'active' : ''}" data-subject="${escapeHtml(s.nome)}">
          <span class="en-subject-name" title="${escapeHtml(s.nome)}">${escapeHtml(s.nome)}</span>
          ${progressHtml}
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.en-subject-item').forEach(item => {
      item.addEventListener('click', () => {
        this.currentSubject = item.dataset.subject;
        this.render();
      });
    });
  },

  renderMainArea() {
    const noSelection = document.getElementById('en-no-selection');
    const trackArea = document.getElementById('en-track-area');

    if (!this.currentSubject) {
      noSelection.style.display = 'block';
      trackArea.style.display = 'none';
      return;
    }
    noSelection.style.display = 'none';
    trackArea.style.display = 'block';
    this.renderTrack();
  },

  // Popula o seletor de modo de estudo da disciplina selecionada
  renderModePicker() {
    const sel = document.getElementById('en-subject-mode');
    if (!sel) return;
    const subj = DB.getSubjects().find(s => s.nome === this.currentSubject);
    const current = subj ? DB.resolveMode(subj.modo) : null;
    let opts = DB.getActiveModes();
    // se o modo atual estiver inativo, mantém na lista para não sumir
    if (current && !opts.find(o => o.id === current.id)) opts = [current, ...opts];
    sel.innerHTML = `<option value="">— Sem modo definido —</option>` +
      opts.map(m => `<option value="${m.id}" ${current && current.id === m.id ? 'selected' : ''}>${escapeHtml(m.nome)}</option>`).join('');
    sel.value = current ? current.id : '';
    sel.classList.toggle('is-empty', !current);
  },

  // Monta o bloco de comentário de uma aula (toggle + preview OU editor aberto)
  // ---- Resumo/anotação da aula (modal) ----
  openResumo(itemId) {
    const subject = this.currentSubject;
    const item = (DB.getTrack(subject) || []).find(i => i.id === itemId);
    if (!item) return;
    this._resumoItemId = itemId;
    $id('resumo-modal-sub').textContent = (item.text || 'Aula') + ' · ' + subject;
    $id('resumo-editor').innerHTML = item.resumo || '';
    $id('resumo-modal').style.display = 'flex';
    setTimeout(() => $id('resumo-editor').focus(), 60);
  },
  saveResumo() {
    if (!this._resumoItemId) return;
    const html = $id('resumo-editor').innerHTML.trim();
    DB.updateTrackItem(this.currentSubject, this._resumoItemId, { resumo: html });
    $id('resumo-modal').style.display = 'none';
    this._resumoItemId = null;
    this.renderTrack();
    showToast('Resumo salvo ✓');
  },
  commentHtml(item) {
    const hasComment = !!(item.comment && item.comment.trim());
    const hasResumo = !!(item.resumo && item.resumo.trim());
    const isEditing = this.commentEditing.has(item.id);
    // Resumo saiu do cabeçalho (liberou espaço p/ o nome da aula) e virou uma
    // pílula de nota, ao lado da de Comentário — as duas ferramentas juntas.
    const resumoBtn = `<button type="button" class="track-note-btn btn-open-resumo ${hasResumo ? 'has' : ''}" title="Resumo / anotação da aula"><span class="i">📄</span> Resumo${hasResumo ? ' <span class="dot"></span>' : ''}</button>`;
    let cToggle, below = '';
    if (isEditing) {
      cToggle = `<button type="button" class="track-note-btn track-comment-toggle" data-comment-toggle="${item.id}"><span class="i">✎</span> Comentário</button>`;
      below = `<textarea class="track-comment-box" data-comment-box="${item.id}" placeholder="Onde parei, o que revisar, lembretes...">${escapeHtml(item.comment || '')}</textarea>`;
    } else if (hasComment) {
      cToggle = `<button type="button" class="track-note-btn track-comment-toggle ${'has'}" data-comment-toggle="${item.id}"><span class="dot"></span> Comentário</button>`;
      below = `<div class="track-comment-preview" data-comment-edit="${item.id}" title="Clique para editar">${escapeHtml(item.comment)}</div>`;
    } else {
      cToggle = `<button type="button" class="track-note-btn track-comment-toggle" data-comment-toggle="${item.id}"><span class="i">＋</span> Comentário</button>`;
    }
    return `<div class="track-note-row">${resumoBtn}${cToggle}</div>${below}`;
  },

  renderTrack() {
    const subject = this.currentSubject;
    const items = DB.getTrack(subject);
    $id('en-track-title').textContent = subject;

    this.renderModePicker();

    const totalLessons = items.filter(i => i.type === 'aula').length;
    const done = items.filter(i => i.type === 'aula' && DB.isStatusDone(i.status)).length;
    $id('en-track-summary').textContent =
      totalLessons > 0 ? `${done} de ${totalLessons} aulas concluídas` : 'Nenhuma aula cadastrada ainda';

    // mantém a barra de progresso da sidebar sincronizada sem perder o filtro/seleção atual
    this.renderSubjectList(DB.getActiveSubjects());

    const listEl = document.getElementById('en-track-list');
    const avgEl = document.getElementById('en-track-averages');

    if (items.length === 0) {
      avgEl.innerHTML = '';
      listEl.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 12px 28px;">Adicione a primeira aula abaixo para começar a trilha desta matéria.</p>`;
      return;
    }

    // média geral em bloco próprio, separado no topo
    avgEl.innerHTML = this.averagesHtml(items);

    // agrupa as aulas em "trechos" delimitados por checkpoints, para deixar claro quais
    // aulas pertencem ao mesmo grupo. Os checkpoints funcionam como divisores entre trechos.
    const hasCheckpoints = items.some(i => i.type === 'checkpoint');
    let lessonCounter = 0;
    let segmentCount = 0;
    let segOpen = false, segLessons = 0, segBuffer = '';
    let html = '';

    const flushSegment = () => {
      if (!segOpen) return;
      segmentCount++;
      const head = hasCheckpoints
        ? `<div class="track-segment-head"><span class="seg-badge">Trecho ${segmentCount}</span><span class="seg-count">${segLessons} aula${segLessons === 1 ? '' : 's'}</span></div>`
        : '';
      html += `<div class="track-segment">${head}${segBuffer}</div>`;
      segOpen = false; segLessons = 0; segBuffer = '';
    };

    items.forEach(item => {
      if (item.type === 'checkpoint') {
        flushSegment();
        html += `
          <div class="track-row-wrap" data-id="${item.id}" data-type="checkpoint" draggable="true">
            <div class="track-checkpoint-row">
              <span class="drag-handle">⠿</span>
              <span class="track-checkpoint-label">${escapeHtml(item.label)}</span>
              <button type="button" class="track-remove-btn btn-remove-checkpoint" title="Remover checkpoint" aria-label="Remover checkpoint">×</button>
            </div>
            ${this.insertButtonHtml(item.id)}
          </div>
        `;
        return;
      }
      lessonCounter++;
      segLessons++;
      segOpen = true;
      const st = DB.resolveStatus(item.status);
      // opções: status ativos + o status atual (mesmo que esteja inativo, para não sumir)
      let opts = DB.getActiveStatuses();
      if (!opts.find(o => o.id === st.id)) opts = [st, ...opts];
      const stagesHtml = DB.STAGE_DEFS.map(def => {
        const { acertos, total } = DB.getStageValues(item, def);
        const pct = DB.getStagePct(item, def);
        const toneCls = pct === null ? '' : 'tone-' + toneFor(pct);
        return `
          <div class="track-stage">
            <div class="ts-label">${def.label}</div>
            <div class="ts-inputs">
              <input type="text" inputmode="numeric" maxlength="4" class="ts-num ts-ac" data-stage="${def.key}" data-part="acertos" value="${acertos ?? ''}" placeholder="ac." aria-label="Acertos — ${def.label}">
              <span class="ts-slash">/</span>
              <input type="text" inputmode="numeric" maxlength="4" class="ts-num ts-tot" data-stage="${def.key}" data-part="total" value="${total ?? ''}" placeholder="tot." aria-label="Total de questões — ${def.label}">
              <span class="ts-pct ${toneCls}" data-pct="${def.key}">${pct === null ? '—' : formatPct(pct) + '%'}</span>
            </div>
          </div>`;
      }).join('');
      segBuffer += `
        <div class="track-row-wrap" data-id="${item.id}" data-type="aula" draggable="true">
          <div class="track-card" style="--lesson-accent:${st.color};">
            <div class="track-card-head">
              <span class="drag-handle">⠿</span>
              <span class="track-lesson-num">${lessonCounter}</span>
              <textarea class="track-lesson-text" rows="1" data-field="text" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</textarea>
              <select class="track-status-select" data-field="status" style="color:${st.color}; background-color:${st.bg}; border-color:${st.color}33;">
                ${opts.map(s => `<option value="${s.id}" ${s.id === st.id ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`).join('')}
              </select>
              <button type="button" class="track-remove-btn btn-remove-lesson" title="Remover aula" aria-label="Remover aula">×</button>
            </div>
            <div class="track-stages">${stagesHtml}</div>
            <div class="track-comment-wrap">${this.commentHtml(item)}</div>
          </div>
          ${this.insertButtonHtml(item.id)}
        </div>
      `;
    });
    flushSegment();

    listEl.innerHTML = html;
    this.bindTrackEvents();
  },

  /* Média de acerto de cada etapa — AGREGADA (Σ acertos ÷ Σ questões), a mesma
     régua do Ciclo, do Histórico e da Evolução.
     Antes era a média dos percentuais das aulas: uma aula de 2/2 (100%) pesava
     o mesmo que uma de 40/80 (50%) e o resultado saía 75%, quando o acerto real
     é 42/82 = 51,2%. Aproveitamento é quantas questões você acertou, não a
     média das suas aulas.
     Aulas antigas que guardam só o percentual (sem acertos/total) não têm como
     entrar no agregado; quando SÓ existem aulas assim, a média dos percentuais
     continua sendo o melhor disponível — e o rótulo diz qual das duas está na
     tela, para o número nunca se explicar errado. */
  averagesHtml(items) {
    const lessons = items.filter(i => i.type === 'aula');
    const cards = DB.STAGE_DEFS.map(def => {
      let acertos = 0, questoes = 0, nAgregadas = 0;
      lessons.forEach(i => {
        const v = DB.getStageValues(i, def);
        if (v.total > 0) { acertos += (v.acertos || 0); questoes += v.total; nAgregadas++; }
      });
      const pcts = lessons.map(i => DB.getStagePct(i, def)).filter(p => p !== null);
      if (questoes <= 0 && pcts.length === 0) {
        return `<div class="track-avg-card"><div class="lbl">${def.label}</div><div class="val">—</div><div class="cnt">sem dados</div></div>`;
      }
      const agregada = questoes > 0;
      const avg = agregada
        ? Math.round((acertos / questoes) * 10000) / 100
        : Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100;
      const nota = agregada
        ? `${acertos.toLocaleString('pt-BR')} de ${questoes.toLocaleString('pt-BR')} em ${nAgregadas} aula${nAgregadas === 1 ? '' : 's'}`
        : `média de ${pcts.length} percentual${pcts.length === 1 ? '' : 'is'} lançado${pcts.length === 1 ? '' : 's'}`;
      return `<div class="track-avg-card">
        <div class="lbl">${def.label}</div>
        <div class="val tone-${toneFor(avg)}">${formatPct(avg)}%</div>
        <div class="cnt">${nota}</div>
      </div>`;
    }).join('');
    return `
      <div class="track-averages-block">
        <div class="track-averages-title"><span class="ico">◇</span> Média geral de acertos</div>
        <div class="track-averages">${cards}</div>
      </div>`;
  },

  insertButtonHtml(afterItemId) {
    return `
      <div class="track-insert-wrap">
        <button type="button" class="track-insert-checkpoint-btn btn-insert-checkpoint" data-after="${afterItemId}">+ inserir checkpoint aqui</button>
      </div>
    `;
  },

  bindTrackEvents() {
    const subject = this.currentSubject;
    const listEl = document.getElementById('en-track-list');

    // edição de campos simples (texto da aula, status)
    listEl.querySelectorAll('[data-field]').forEach(input => {
      const row = input.closest('.track-row-wrap');
      const itemId = row.dataset.id;
      const field = input.dataset.field;
      input.addEventListener('change', () => {
        DB.updateTrackItem(subject, itemId, { [field]: input.value });
        if (field === 'status') this.renderTrack(); // recolore o select e atualiza o progresso
      });
    });
    // textarea do nome da aula: auto-cresce e quebra linha (nomes longos legíveis)
    const autoGrow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    listEl.querySelectorAll('textarea.track-lesson-text').forEach(ta => {
      autoGrow(ta);
      ta.addEventListener('input', () => autoGrow(ta));
      // Enter não quebra linha aqui (salva/desfoca) — nome de aula é curto por natureza
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ta.blur(); } });
    });
    // botão de resumo/anotação
    listEl.querySelectorAll('.btn-open-resumo').forEach(btn => {
      const row = btn.closest('.track-row-wrap');
      btn.addEventListener('click', () => this.openResumo(row.dataset.id));
    });

    // comentário: abrir/fechar o editor
    listEl.querySelectorAll('[data-comment-toggle]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.commentToggle;
        if (this.commentEditing.has(id)) this.commentEditing.delete(id);
        else this.commentEditing.add(id);
        this.renderTrack();
        // foca o textarea recém-aberto
        const box = document.querySelector(`[data-comment-box="${id}"]`);
        if (box) { box.focus(); box.selectionStart = box.value.length; }
      });
    });

    // comentário: clicar no preview abre para edição
    listEl.querySelectorAll('[data-comment-edit]').forEach(prev => {
      prev.addEventListener('click', () => {
        const id = prev.dataset.commentEdit;
        this.commentEditing.add(id);
        this.renderTrack();
        const box = document.querySelector(`[data-comment-box="${id}"]`);
        if (box) { box.focus(); box.selectionStart = box.value.length; }
      });
    });

    // comentário: salvar ao sair do campo (mantém o editor aberto para continuar editando)
    listEl.querySelectorAll('[data-comment-box]').forEach(box => {
      const id = box.dataset.commentBox;
      box.addEventListener('change', () => {
        DB.updateTrackItem(subject, id, { comment: box.value.trim() });
      });
    });

    // edição das etapas (acertos/total) — recalcula o % e a média ao vivo
    listEl.querySelectorAll('.ts-num').forEach(input => {
      const row = input.closest('.track-row-wrap');
      const itemId = row.dataset.id;
      const stageKey = input.dataset.stage;
      const part = input.dataset.part;
      /* type="text" + inputmode="numeric" (o mesmo padrão da duração na Grade):
         tira as setinhas de incremento — que roubavam largura da caixa e mudavam
         o valor num giro de roda por engano — e mantém o teclado numérico no
         celular. Só dígitos entram, então nada de "e", "+" ou "-". */
      input.addEventListener('input', () => {
        const limpo = input.value.replace(/\D/g, '').slice(0, 4);
        if (limpo !== input.value) input.value = limpo;
      });
      input.addEventListener('change', () => {
        const value = input.value === '' ? null : Math.max(0, parseInt(input.value, 10) || 0);
        DB.updateTrackStage(subject, itemId, stageKey, part, value);
        this.renderTrack(); // atualiza o % da etapa e as médias no topo
      });
    });

    // remover aula
    listEl.querySelectorAll('.btn-remove-lesson').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.track-row-wrap');
        const item = DB.getTrack(subject).find(i => i.id === row.dataset.id);
        if (!await UI.confirm(`Remover a aula "${item.text}" da trilha?`)) return;
        DB.removeTrackItem(subject, row.dataset.id);
        this.renderTrack();
      });
    });

    // remover checkpoint
    listEl.querySelectorAll('.btn-remove-checkpoint').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.track-row-wrap');
        if (!await UI.confirm('Remover este checkpoint?')) return;
        DB.removeTrackItem(subject, row.dataset.id);
        this.renderTrack();
      });
    });

    // inserir checkpoint em posição específica
    listEl.querySelectorAll('.btn-insert-checkpoint').forEach(btn => {
      btn.addEventListener('click', () => {
        DB.addTrackCheckpoint(subject, btn.dataset.after);
        this.renderTrack();
      });
    });

    // drag and drop nativo para reordenar
    const rows = listEl.querySelectorAll('.track-row-wrap');
    rows.forEach(row => {
      row.addEventListener('dragstart', (e) => {
        this.draggedId = row.dataset.id;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        rows.forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (row.dataset.id === this.draggedId) return;
        const rect = row.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        row.classList.toggle('drag-over-top', e.clientY < midpoint);
        row.classList.toggle('drag-over-bottom', e.clientY >= midpoint);
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetId = row.dataset.id;
        if (targetId === this.draggedId) return;

        const items = DB.getTrack(subject);
        const ids = items.map(i => i.id);
        const fromIdx = ids.indexOf(this.draggedId);
        let toIdx = ids.indexOf(targetId);
        if (fromIdx === -1 || toIdx === -1) return;

        const rect = row.getBoundingClientRect();
        const insertAfter = e.clientY >= rect.top + rect.height / 2;

        ids.splice(fromIdx, 1);
        toIdx = ids.indexOf(targetId);
        ids.splice(insertAfter ? toIdx + 1 : toIdx, 0, this.draggedId);

        DB.reorderTrack(subject, ids);
        this.renderTrack();
      });
    });
  },

  /* ── CADASTRO EM LOTE ─────────────────────────────────────────────────────
     Montar uma trilha de 40 assuntos uma linha por vez é trabalho manual puro:
     o índice do curso já existe pronto em algum lugar. Aqui você cola o bloco
     inteiro e ele vira a trilha; os checkpoints entram depois, onde fizerem
     sentido.

     A limpeza de cada linha é o que faz a colagem funcionar de verdade, porque
     índice copiado vem sujo:
       "1. Princípios"      → "Princípios"
       "1.2 - Competência"  → "Competência"
       "• Imunidades"       → "Imunidades"
       "Aula 03 – Taxas"    → "Taxas"
     A numeração é removida porque a ORDEM da trilha já é a posição na lista —
     manter "1." no texto duplicaria a informação e atrapalharia a busca. */
  _limparLinha(linha) {
    let t = String(linha || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^[-–—•*·▪◦>»]+\s*/, '');                    // marcadores
    t = t.replace(/^(?:aula|módulo|modulo|cap[íi]tulo|unidade|tema)\s*0*\d+\s*[.):–—-]*\s*/i, '');
    t = t.replace(/^\d+(?:[.\-]\d+)*\s*[.):–—-]*\s*/, '');    // 1. / 1.2 / 1-2)
    t = t.replace(/^[-–—•*·]+\s*/, '');                        // marcador após a numeração
    return t.trim();
  },
  async addLessonsBulk() {
    if (!this.currentSubject) { showToast('Escolha uma matéria primeiro'); return; }
    /* UI.prompt recebe uma LISTA DE CAMPOS e devolve um objeto com as chaves —
       não é o prompt() do navegador. */
    const resp = await UI.prompt(
      [{
        key: 'lista', label: 'Um assunto por linha', type: 'textarea', rows: 12,
        placeholder: 'Princípios constitucionais tributários\nCompetência tributária\nImunidades\nObrigação tributária',
        hint: 'Numeração e marcadores saem sozinhos: “1.2 - Competência tributária” vira “Competência tributária”. Linhas repetidas e assuntos que já existem nesta matéria são ignorados.'
      }],
      { title: '📋 Colar lista de aulas', sub: this.currentSubject, okText: 'Pré-visualizar' }
    );
    const texto = resp && resp.lista;
    if (!texto || !String(texto).trim()) return;

    const existentes = new Set(DB.getTrack(this.currentSubject)
      .filter(i => i.type === 'aula')
      .map(i => String(i.text || '').trim().toLowerCase()));

    const vistos = new Set();
    const novas = [], repetidas = [], jaExistiam = [];
    String(texto).split(/\r?\n/).forEach(linha => {
      const t = this._limparLinha(linha);
      if (!t) return;
      const chave = t.toLowerCase();
      if (existentes.has(chave)) { jaExistiam.push(t); return; }
      if (vistos.has(chave)) { repetidas.push(t); return; }
      vistos.add(chave); novas.push(t);
    });

    if (!novas.length) {
      UI.alert(jaExistiam.length
        ? `Nenhuma aula nova: as ${jaExistiam.length} linhas já existem nesta matéria.`
        : 'Nenhuma linha aproveitável na lista colada.',
        { title: 'Nada a adicionar', okText: 'Entendi' });
      return;
    }

    /* Pré-visualização antes de gravar: colagem em lote é fácil de errar
       (coluna errada, cabeçalho junto, lista do curso errado) e desfazer 40
       inserções na mão seria pior que o trabalho que a função economiza. */
    const amostra = novas.slice(0, 12).map((t, i) => `${i + 1}. ${t}`).join('\n');
    const resto = novas.length > 12 ? `\n… e mais ${novas.length - 12}` : '';
    const ignoradas = [];
    if (jaExistiam.length) ignoradas.push(`${jaExistiam.length} já existiam`);
    if (repetidas.length) ignoradas.push(`${repetidas.length} repetidas na lista`);

    const okc = await UI.confirm(
      `${novas.length} aula(s) serão criadas em “${this.currentSubject}”, nesta ordem:\n\n${amostra}${resto}` +
      (ignoradas.length ? `\n\nIgnoradas: ${ignoradas.join(' · ')}.` : '') +
      `\n\nOs checkpoints você encaixa depois, onde fizer sentido.`,
      { title: 'Conferir antes de criar', okText: `Criar ${novas.length} aula(s)`, cancelText: 'Cancelar' }
    );
    if (!okc) return;

    novas.forEach(t => DB.addTrackLesson(this.currentSubject, t));
    this.renderTrack();
    this.renderSubjectList(DB.getActiveSubjects());
    showToast(`${novas.length} aula(s) adicionadas ✓`);
  },

  addLesson() {
    const input = document.getElementById('en-new-lesson-input');
    const text = input.value.trim();
    if (!text) { showToast('Digite o nome da aula'); return; }
    DB.addTrackLesson(this.currentSubject, text);
    input.value = '';
    this.renderTrack();
  }
};

$id('en-subject-filter').addEventListener('input', (e) => {
  EstudoNovoScreen.subjectFilter = e.target.value.trim();
  EstudoNovoScreen.renderSubjectList(DB.getActiveSubjects());
});
$id('en-add-lesson-btn').addEventListener('click', () => EstudoNovoScreen.addLesson());
$id('en-bulk-lesson-btn').addEventListener('click', () => EstudoNovoScreen.addLessonsBulk());
$id('en-new-lesson-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') EstudoNovoScreen.addLesson();
});

// seletor de modo de estudo da disciplina
$id('en-subject-mode').addEventListener('change', (e) => {
  const subj = DB.getSubjects().find(s => s.nome === EstudoNovoScreen.currentSubject);
  if (subj) {
    DB.updateSubject(subj.id, { modo: e.target.value || null });
    EstudoNovoScreen.renderModePicker();
  }
});

// expõe para outras telas (ex.: Configurações) poderem forçar refresh após editar modos/status
window.EstudoNovoScreen = EstudoNovoScreen;
// listeners do modal de resumo
(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('resumo-modal-close', 'click', () => $id('resumo-modal').style.display = 'none');
  on('resumo-modal-cancel', 'click', () => $id('resumo-modal').style.display = 'none');
  on('resumo-modal-save', 'click', () => EstudoNovoScreen.saveResumo());
  // resumo também é área de digitação: só fecha pelo fundo se estiver vazio
  const m = document.getElementById('resumo-modal');
  if (m) m.addEventListener('click', (e) => {
    if (e.target !== m) return;
    const ta = m.querySelector('textarea, .rte-area');
    const cheio = ta && ((ta.value || ta.innerText || '').trim().length > 0);
    if (cheio) { showToast('Use ✕ ou Cancelar — há texto não salvo'); return; }
    m.style.display = 'none';
  });
})();

window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'estudonovo') EstudoNovoScreen.render();
});
