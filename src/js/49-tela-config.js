/* ============================================================
   TELA: CONFIGURAÇÕES
   ============================================================ */
const ConfigScreen = {
  render() {
    this.renderSubjects();
    this.renderMethods();
    this.renderPhases();
    this.renderStatuses();
    this.renderModes();
  },

  // ---------- Matérias ----------
  renderSubjects() {
    const container = document.getElementById('config-subjects-list');
    const subjects = DB.getSubjects();
    const phases = DB.getActivePhases();

    if (subjects.length === 0) {
      container.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 8px 0;">Nenhuma matéria cadastrada ainda. Elas aparecem aqui automaticamente ao registrar um estudo, ou adicione manualmente abaixo.</p>`;
      return;
    }

    /* ESTRUTURA REFEITA. A linha era uma grade de 4 colunas que, apertada, dava
       uma coluna de ~15px para a "Dificuldade": o rotulo descia letra por letra
       e o nome da matéria ficava cortado. Agora sao dois blocos explicitos —
       cabecalho (nome + acoes) e campos (dois seletores rotulados) — que o CSS
       empilha sem depender de nenhuma coluna sobrar com largura suficiente. */
    container.innerHTML = subjects.map(s => `
      <div class="config-subject-row ${s.ativo ? '' : 'inactive'}" data-id="${s.id}">
        <div class="csr-head">
          <input type="text" class="cfg-subj-name" aria-label="Nome da matéria" value="${escapeHtml(s.nome)}" title="${escapeHtml(s.nome)}" ${s.ativo ? '' : 'disabled'}>
          <div class="config-row-actions">
            ${s.ativo ? '' : '<span class="inactive-tag">inativa</span>'}
            <button type="button" class="toggle-switch ${s.ativo ? 'on' : ''}" role="switch" aria-checked="${s.ativo ? 'true' : 'false'}" aria-label="${s.ativo ? 'Desativar' : 'Reativar'}" title="${s.ativo ? 'Desativar matéria' : 'Reativar matéria'}"></button>
            <button type="button" class="reg-act-btn danger btn-delete-subject" title="Excluir matéria" aria-label="Excluir matéria">✕</button>
          </div>
        </div>
        <div class="csr-fields">
          <label class="cfg-field"><span>Dificuldade</span>
            <select class="cfg-subj-dif" ${s.ativo ? '' : 'disabled'}>
              ${[1,2,3,4,5].map(n => `<option value="${n}" ${n===s.dificuldade?'selected':''}>Dif. ${n}</option>`).join('')}
            </select>
          </label>
          <label class="cfg-field"><span>Fase padrão</span>
            <select class="cfg-subj-fase" ${s.ativo ? '' : 'disabled'}>
              ${phases.map(p => `<option ${p.nome===s.fase?'selected':''}>${escapeHtml(p.nome)}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.config-subject-row').forEach(row => {
      const id = row.dataset.id;
      const nameInput = row.querySelector('.cfg-subj-name');
      const difSelect = row.querySelector('.cfg-subj-dif');
      const faseSelect = row.querySelector('.cfg-subj-fase');
      const toggle = row.querySelector('.toggle-switch');
      const deleteBtn = row.querySelector('.btn-delete-subject');

      nameInput.addEventListener('change', () => {
        const val = nameInput.value.trim();
        if (!val) { this.renderSubjects(); return; }
        // Propaga o rename para registros, ciclo, grade, trilhas e histórico (dados interligados)
        const res = DB.renameSubjectEverywhere(id, val);
        if (!res.ok) {
          if (res.reason === 'collision') {
            showToast('Já existe a matéria "' + res.collisionName + '". Escolha outro nome.');
          }
          this.renderSubjects();
          return;
        }
        if (res.reason === 'renamed') {
          const c = res.changed || {};
          const partes = [];
          if (c.entries) partes.push(c.entries + ' registro(s)');
          if (c.cycle || c.gradeCells) partes.push('ciclo da semana');
          if (c.track) partes.push('trilha do Estudo Novo');
          if (c.history) partes.push('histórico');
          showToast(partes.length ? 'Matéria renomeada e atualizada em: ' + partes.join(', ') + ' ✓' : 'Matéria renomeada ✓');
        }
        this.renderSubjects();
        window.RegistrarScreen?.refreshSubjectSelect();
      });
      difSelect.addEventListener('change', () => DB.updateSubject(id, { dificuldade: parseInt(difSelect.value, 10) }));
      faseSelect.addEventListener('change', () => DB.updateSubject(id, { fase: faseSelect.value }));

      toggle.addEventListener('click', () => {
        const subj = DB.getSubjects().find(x => x.id === id);
        DB.setSubjectActive(id, !subj.ativo);
        this.renderSubjects();
        window.RegistrarScreen?.refreshSubjectSelect();
        showToast(subj.ativo ? 'Matéria desativada' : 'Matéria reativada');
      });

      deleteBtn.addEventListener('click', async () => {
        const subj = DB.getSubjects().find(x => x.id === id);
        const hasHistory = DB.subjectHasEntries(subj.nome);
        const msg = hasHistory
          ? `"${subj.nome}" tem estudos registrados. Ela será apenas ocultada das opções — o histórico continua contando nas estatísticas. Confirma?`
          : `Excluir "${subj.nome}" definitivamente? Ela não tem estudos registrados, então não há histórico a preservar.`;
        if (!await UI.confirm(msg)) return;
        DB.removeSubjectSafely(id);
        this.renderSubjects();
        window.RegistrarScreen?.refreshSubjectSelect();
        showToast('Matéria removida');
      });
    });
  },

  addSubject() {
    DB.addSubject({ nome: 'Nova matéria', dificuldade: 3, fase: DB.getActivePhases()[0]?.nome || 'Novo' });
    this.renderSubjects();
    window.RegistrarScreen?.refreshSubjectSelect();
  },

  // ---------- Formas de estudo (lista simples) ----------
  renderMethods() {
    const container = document.getElementById('config-methods-list');
    const methods = DB.getMethods();
    if (methods.length === 0) {
      container.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 8px 0;">Nenhuma forma de estudo cadastrada.</p>`;
      return;
    }
    container.innerHTML = methods.map(m => this.simpleRowTemplate(m)).join('');
    this.bindSimpleRows(container, {
      rename: (id, val) => DB.renameMethod(id, val),
      toggleGet: (id) => DB.getMethods().find(x => x.id === id),
      /* O item pode ter deixado de existir entre desenhar a tela e clicar —
         a sincronização por seção substitui listas com a tela aberta. Sem esta
         guarda, `find(...)` devolvia undefined, a atribuição lançava, e o
         `_set` seguinte NEM CHEGAVA A RODAR: a tela parecia inerte e a
         alteração se perdia sem aviso. */
      toggleSet: (id, ativo) => {
        const l = DB.getMethods(); const it = l.find(x => x.id === id);
        if (!it) { showToast('Este item não existe mais — atualizando a lista.'); ConfigScreen.render(); return; }
        it.ativo = ativo; DB._set(DB.KEYS.methods, l);
      },
      remove: (id) => DB.removeMethodSafely(id),
      inUse: (nome) => DB.methodInUse(nome),
      rerender: () => this.renderMethods(),
      afterChange: () => window.RegistrarScreen?.refreshMethodSelect(),
      entityLabel: 'forma de estudo'
    });
  },

  addMethod() {
    const input = document.getElementById('new-method-input');
    const val = input.value.trim();
    if (!val) { showToast('Digite um nome'); return; }
    DB.addMethod(val);
    input.value = '';
    this.renderMethods();
    window.RegistrarScreen?.refreshMethodSelect();
  },

  // ---------- Fases de estudo (lista simples) ----------
  renderPhases() {
    const container = document.getElementById('config-phases-list');
    const phases = DB.getPhases();
    if (phases.length === 0) {
      container.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 8px 0;">Nenhuma fase cadastrada.</p>`;
      return;
    }
    container.innerHTML = phases.map(p => this.simpleRowTemplate(p)).join('');
    this.bindSimpleRows(container, {
      rename: (id, val) => DB.renamePhase(id, val),
      toggleGet: (id) => DB.getPhases().find(x => x.id === id),
      /* O item pode ter deixado de existir entre desenhar a tela e clicar —
         a sincronização por seção substitui listas com a tela aberta. Sem esta
         guarda, `find(...)` devolvia undefined, a atribuição lançava, e o
         `_set` seguinte NEM CHEGAVA A RODAR: a tela parecia inerte e a
         alteração se perdia sem aviso. */
      toggleSet: (id, ativo) => {
        const l = DB.getPhases(); const it = l.find(x => x.id === id);
        if (!it) { showToast('Este item não existe mais — atualizando a lista.'); ConfigScreen.render(); return; }
        it.ativo = ativo; DB._set(DB.KEYS.phases, l);
      },
      remove: (id) => DB.removePhaseSafely(id),
      inUse: (nome) => DB.phaseInUse(nome),
      rerender: () => this.renderPhases(),
      afterChange: () => {},
      entityLabel: 'fase'
    });
  },

  addPhase() {
    const input = document.getElementById('new-phase-input');
    const val = input.value.trim();
    if (!val) { showToast('Digite um nome'); return; }
    DB.addPhase(val);
    input.value = '';
    this.renderPhases();
  },

  // ---------- Modos de estudo (lista simples) ----------
  renderModes() {
    const container = document.getElementById('config-modes-list');
    const modes = DB.getModes();
    if (modes.length === 0) {
      container.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 8px 0;">Nenhum modo de estudo cadastrado.</p>`;
      return;
    }
    container.innerHTML = modes.map(m => this.simpleRowTemplate(m)).join('');
    this.bindSimpleRows(container, {
      rename: (id, val) => DB.renameMode(id, val),
      toggleGet: (id) => DB.getModes().find(x => x.id === id),
      /* O item pode ter deixado de existir entre desenhar a tela e clicar —
         a sincronização por seção substitui listas com a tela aberta. Sem esta
         guarda, `find(...)` devolvia undefined, a atribuição lançava, e o
         `_set` seguinte NEM CHEGAVA A RODAR: a tela parecia inerte e a
         alteração se perdia sem aviso. */
      toggleSet: (id, ativo) => {
        const l = DB.getModes(); const it = l.find(x => x.id === id);
        if (!it) { showToast('Este item não existe mais — atualizando a lista.'); ConfigScreen.render(); return; }
        it.ativo = ativo; DB._set(DB.KEYS.modes, l);
      },
      remove: (id) => DB.removeModeSafely(id),
      inUse: (nome) => { const m = DB.getModes().find(x => x.nome === nome); return m ? DB.modeInUse(m) : false; },
      rerender: () => this.renderModes(),
      afterChange: () => { if (window.EstudoNovoScreen) EstudoNovoScreen.render(); },
      entityLabel: 'modo de estudo'
    });
  },

  addMode() {
    const input = document.getElementById('new-mode-input');
    const val = input.value.trim();
    if (!val) { showToast('Digite um nome'); return; }
    DB.addMode(val);
    input.value = '';
    this.renderModes();
    if (window.EstudoNovoScreen) EstudoNovoScreen.render();
  },

  // ---------- Status do Estudo Novo ----------
  renderStatuses() {
    const container = document.getElementById('config-statuses-list');
    const statuses = DB.getStatuses();
    const activeCount = statuses.filter(s => s.ativo).length;
    if (statuses.length === 0) {
      container.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 8px 0;">Nenhum status cadastrado.</p>`;
      return;
    }
    /* Cada status vira um CARTAO com tres seçoes rotuladas — nome, cor e regra
       de progresso. Antes eram cinco controles soltos na mesma linha, sem
       separacao nem rotulo: a paleta de cores encostava na caixa de texto e
       ninguem sabia o que o interruptor do fim desligava. */
    container.innerHTML = statuses.map(s => `
      <div class="config-status-row ${s.ativo ? '' : 'inactive'}" data-id="${s.id}">
        <div class="csr-head">
          <input type="text" class="cfg-status-name" aria-label="Nome do status" value="${escapeHtml(s.nome)}" ${s.ativo ? '' : 'disabled'}>
          <div class="config-row-actions">
            ${s.done ? '<span class="status-done-badge">conta como concluída</span>' : ''}
            ${s.ativo ? '' : '<span class="inactive-tag">inativo</span>'}
            <button type="button" class="toggle-switch ${s.ativo ? 'on' : ''}" role="switch" aria-checked="${s.ativo ? 'true' : 'false'}" aria-label="${s.ativo ? 'Desativar' : 'Reativar'}" title="${s.ativo ? 'Desativar status' : 'Reativar status'}"></button>
            <button type="button" class="reg-act-btn danger btn-delete-status" title="Excluir status" aria-label="Excluir status">✕</button>
          </div>
        </div>
        <div class="cst-blocks">
          <div class="cst-block">
            <span class="cst-lbl">Como aparece na trilha</span>
            <span class="status-preview" style="color:${s.color}; background:${s.bg}; border-color:${s.color}44;">${escapeHtml(s.nome)}</span>
          </div>
          <div class="cst-block">
            <span class="cst-lbl">Cor</span>
            <div class="status-swatches">
              ${DB.STATUS_PALETTE.map(p => `<button type="button" class="status-swatch ${p.color === s.color ? 'selected' : ''}" aria-label="Cor ${p.nome || p.color}" data-color="${p.color}" data-bg="${p.bg}" style="background:${p.color};" title="Usar esta cor"></button>`).join('')}
            </div>
          </div>
          <div class="cst-block">
            <span class="cst-lbl">Progresso</span>
            <label class="status-done-toggle" title="Aulas com este status contam como concluídas no progresso">
              <input type="checkbox" class="cfg-status-done" ${s.done ? 'checked' : ''} ${s.ativo ? '' : 'disabled'}>
              <span>Conta como aula concluída</span>
            </label>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.config-status-row').forEach(row => {
      const id = row.dataset.id;
      const nameInput = row.querySelector('.cfg-status-name');
      const doneCheck = row.querySelector('.cfg-status-done');
      const toggle = row.querySelector('.toggle-switch');
      const deleteBtn = row.querySelector('.btn-delete-status');

      nameInput.addEventListener('change', () => {
        const val = nameInput.value.trim();
        if (val) { DB.updateStatus(id, { nome: val }); this.renderStatuses(); }
        else this.renderStatuses();
      });

      row.querySelectorAll('.status-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          DB.updateStatus(id, { color: sw.dataset.color, bg: sw.dataset.bg });
          this.renderStatuses();
        });
      });

      doneCheck.addEventListener('change', () => {
        DB.updateStatus(id, { done: doneCheck.checked });
        this.renderStatuses();
      });

      toggle.addEventListener('click', () => {
        const st = DB.getStatuses().find(x => x.id === id);
        if (st.ativo && activeCount <= 1) { showToast('Mantenha ao menos um status ativo'); return; }
        DB.setStatusActive(id, !st.ativo);
        this.renderStatuses();
        showToast(st.ativo ? 'Status desativado' : 'Status reativado');
      });

      deleteBtn.addEventListener('click', async () => {
        const st = DB.getStatuses().find(x => x.id === id);
        if (DB.getStatuses().length <= 1) { showToast('É preciso ter ao menos um status'); return; }
        const used = DB.statusInUse(st);
        const msg = used
          ? `"${st.nome}" já está em uso por aulas na trilha. Será apenas ocultado das opções novas, sem alterar as aulas existentes. Confirma?`
          : `Excluir o status "${st.nome}" definitivamente?`;
        if (!await UI.confirm(msg)) return;
        DB.removeStatusSafely(id);
        this.renderStatuses();
        showToast('Status removido');
      });
    });
  },

  addStatus() {
    const input = document.getElementById('new-status-input');
    const val = input.value.trim();
    if (!val) { showToast('Digite um nome'); return; }
    DB.addStatus(val);
    input.value = '';
    this.renderStatuses();
  },

  // ---------- Helpers compartilhados para listas simples (métodos/fases) ----------
  simpleRowTemplate(item) {
    return `
      <div class="config-simple-row ${item.ativo ? '' : 'inactive'}" data-id="${item.id}">
        <span class="name"><input type="text" class="simple-name-input" aria-label="Nome do item" value="${escapeHtml(item.nome)}" ${item.ativo ? '' : 'disabled'}></span>
        <div class="config-row-actions">
          ${item.ativo ? '' : '<span class="inactive-tag">inativa</span>'}
          <button type="button" class="toggle-switch ${item.ativo ? 'on' : ''}" role="switch" aria-checked="${item.ativo ? 'true' : 'false'}" aria-label="${item.ativo ? 'Desativar' : 'Reativar'}" title="${item.ativo ? 'Desativar' : 'Reativar'}"></button>
          <button type="button" class="icon-btn danger btn-delete-simple" title="Excluir" aria-label="Excluir">×</button>
        </div>
      </div>
    `;
  },

  bindSimpleRows(container, cfg) {
    container.querySelectorAll('.config-simple-row').forEach(row => {
      const id = row.dataset.id;
      const nameInput = row.querySelector('.simple-name-input');
      const toggle = row.querySelector('.toggle-switch');
      const deleteBtn = row.querySelector('.btn-delete-simple');

      nameInput.addEventListener('change', () => {
        const val = nameInput.value.trim();
        if (val) { cfg.rename(id, val); cfg.afterChange(); }
        else cfg.rerender();
      });

      toggle.addEventListener('click', () => {
        const item = cfg.toggleGet(id);
        cfg.toggleSet(id, !item.ativo);
        cfg.rerender();
        cfg.afterChange();
        showToast(item.ativo ? 'Desativado' : 'Reativado');
      });

      deleteBtn.addEventListener('click', async () => {
        const item = cfg.toggleGet(id);
        const used = cfg.inUse(item.nome);
        const msg = used
          ? `"${item.nome}" já foi usado em registros. Será apenas ocultado das opções novas, sem afetar o histórico. Confirma?`
          : `Excluir "${item.nome}" definitivamente?`;
        if (!await UI.confirm(msg)) return;
        cfg.remove(id);
        cfg.rerender();
        cfg.afterChange();
        showToast('Removido');
      });
    });
  }
};

$id('btn-add-subject').addEventListener('click', () => ConfigScreen.addSubject());
$id('btn-add-method').addEventListener('click', () => ConfigScreen.addMethod());
$id('btn-add-phase').addEventListener('click', () => ConfigScreen.addPhase());
$id('btn-add-status').addEventListener('click', () => ConfigScreen.addStatus());
$id('btn-add-mode').addEventListener('click', () => ConfigScreen.addMode());
$id('new-method-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') ConfigScreen.addMethod(); });
$id('new-phase-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') ConfigScreen.addPhase(); });
$id('new-status-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') ConfigScreen.addStatus(); });
$id('new-mode-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') ConfigScreen.addMode(); });

window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'config') ConfigScreen.render();
});

/* ---- Alternador de escopo do Histórico (este planejamento / todos) ---- */
$id('hist-scope-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-scope]');
  if (!btn) return;
  HistoricoScreen.scope = btn.dataset.scope;
  HistoricoScreen.editingId = null; // sai de qualquer edição ao trocar de escopo
  document.querySelectorAll('#hist-scope-toggle button').forEach(b => b.classList.toggle('active', b === btn));
  HistoricoScreen.render();
});
