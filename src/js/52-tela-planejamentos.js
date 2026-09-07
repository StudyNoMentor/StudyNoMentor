/* ============================================================
   TELA + SELETOR DE PLANEJAMENTOS (workspace)
   ============================================================ */
const PlanUI = {
  // ---------- Seletor na sidebar ----------
  renderSidebar() {
    const active = PlanManager.getActivePlan();
    $id('active-plan-name').textContent = active ? active.nome : '—';
    const listEl = document.getElementById('plan-switcher-list');
    const plans = PlanManager.getPlans();
    const activeId = PlanManager.getActivePlanId();
    listEl.innerHTML = plans.map(p => `
      <button type="button" class="plan-switcher-item ${p.id === activeId ? 'active' : ''}" data-id="${p.id}">
        <span class="psi-dot"></span>
        <span class="psi-text">
          <span class="psi-name">${escapeHtml(p.nome)}</span>
          <span class="psi-tipo">${escapeHtml(p.tipo)}</span>
        </span>
        ${p.id === activeId ? '<span class="psi-check">✓</span>' : ''}
      </button>`).join('');
    listEl.querySelectorAll('.plan-switcher-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (id === PlanManager.getActivePlanId()) { this.closeMenu(); return; }
        PlanManager.setActivePlan(id);
        CloudStore.saveThenReload(); // salva na nuvem antes de recarregar
      });
    });
  },
  openMenu() { $id('plan-switcher-menu').classList.add('open'); },
  closeMenu() { $id('plan-switcher-menu').classList.remove('open'); },
  toggleMenu() { $id('plan-switcher-menu').classList.toggle('open'); },

  // ---------- Tela de gestão ----------
  renderScreen() {
    this.populateForm();
    this.renderCards();
  },
  populateForm() {
    const tipoSel = document.getElementById('np-tipo');
    tipoSel.innerHTML = PlanManager.TIPOS.map(t => `<option>${escapeHtml(t)}</option>`).join('');
    const sourceSel = document.getElementById('np-source');
    const plans = PlanManager.getPlans();
    sourceSel.innerHTML = `<option value="">— Começar do zero —</option>` +
      plans.map(p => `<option value="${p.id}">${escapeHtml(p.nome)}</option>`).join('');
    this.updateCopyOptionsVisibility();
  },
  updateCopyOptionsVisibility() {
    const source = $id('np-source').value;
    $id('np-copy-options').style.display = source ? 'block' : 'none';
    $id('np-source-hint').style.display = source ? 'none' : 'block';
  },
  renderCards() {
    const wrap = document.getElementById('plan-cards-list');
    const plans = PlanManager.getPlans();
    const activeId = PlanManager.getActivePlanId();
    wrap.innerHTML = plans.map(p => {
      const entries = DB.getEntriesForPlan(p.id);
      const subjects = DB.getSubjectsForPlan(p.id).filter(s => s.ativo !== false);
      const totalMin = entries.reduce((a, e) => a + (e.durationMin || 0), 0);
      const weeks = DB.getCycleHistoryForPlan(p.id).length;
      const isActive = p.id === activeId;
      return `
        <div class="plan-card ${isActive ? 'is-active' : ''}" data-id="${p.id}">
          <div class="plan-card-head">
            <div class="plan-card-title">
              <span class="nome">${escapeHtml(p.nome)}</span>
              <span class="plan-type-badge">${escapeHtml(p.tipo)}</span>
              ${isActive ? '<span class="plan-active-pill">ativo</span>' : ''}
            </div>
            <div class="config-row-actions">
              <button type="button" class="icon-btn btn-rename-plan" title="Renomear">✎ Renomear</button>
              <button type="button" class="icon-btn danger btn-delete-plan" title="Excluir">× Excluir</button>
            </div>
          </div>
          <div class="plan-card-stats">
            <div class="plan-stat"><div class="value">${entries.length}</div><div class="label">registros</div></div>
            <div class="plan-stat"><div class="value">${subjects.length}</div><div class="label">matérias</div></div>
            <div class="plan-stat"><div class="value">${CycleEngine.fmtHM(totalMin)}</div><div class="label">estudado</div></div>
            <div class="plan-stat"><div class="value">${weeks}</div><div class="label">semanas no histórico</div></div>
          </div>
          <div class="plan-card-actions">
            ${isActive
              ? '<button type="button" class="btn-secondary" disabled>Planejamento atual</button>'
              : '<button type="button" class="btn-primary btn-open-plan">Abrir este planejamento</button>'}
          </div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('.plan-card').forEach(card => {
      const id = card.dataset.id;
      const openBtn = card.querySelector('.btn-open-plan');
      if (openBtn) openBtn.addEventListener('click', () => {
        PlanManager.setActivePlan(id);
        CloudStore.saveThenReload();
      });
      card.querySelector('.btn-rename-plan').addEventListener('click', () => {
        const p = PlanManager.getPlans().find(x => x.id === id);
        UI.prompt([{ key: 'nome', label: 'Novo nome do planejamento', type: 'text', value: p.nome }], { title: '✎ Renomear planejamento', okText: 'Salvar' }).then(v => {
          if (v && v.nome && v.nome.trim()) {
            PlanManager.renamePlan(id, v.nome);
            this.renderScreen();
            this.renderSidebar();
            showToast('Planejamento renomeado ✓');
          }
        });
      });
      card.querySelector('.btn-delete-plan').addEventListener('click', async () => {
        const plans = PlanManager.getPlans();
        if (plans.length <= 1) {
          await UI.alert('Este é o único planejamento. Crie outro antes de excluí-lo.', { title: 'Não é possível excluir' });
          return;
        }
        const p = plans.find(x => x.id === id);
        const entries = DB.getEntriesForPlan(id).length;
        if (!await UI.confirmTyped(`Excluir o planejamento "${p.nome}"?\n\nTodos os seus dados (${entries} registro(s), matérias, ciclos, histórico e trilhas) serão apagados permanentemente.`,
          { word: 'EXCLUIR', title: '🗑️ Excluir planejamento', okText: 'Excluir definitivamente' })) return;
        try { if (window.VersionHistory) await VersionHistory.antesDe('excluir um planejamento'); } catch (_) { _quiet(_); }
        const wasActive = PlanManager.getActivePlanId() === id;
        PlanManager.deletePlan(id);
        if (wasActive) { CloudStore.saveThenReload(); return; }
        this.renderScreen();
        this.renderSidebar();
        showToast('Planejamento excluído');
      });
    });
  },
  createFromForm() {
    const nome = $id('np-nome').value.trim();
    if (!nome) { showToast('Dê um nome ao planejamento'); return; }
    const tipo = $id('np-tipo').value;
    const source = $id('np-source').value;
    let newId;
    if (source) {
      newId = PlanManager.duplicateFrom(source, {
        nome, tipo,
        copySubjects: $id('np-copy-subjects').checked,
        copyTracks: $id('np-copy-tracks').checked,
        copyMethods: $id('np-copy-methods').checked,
        copyPhases: $id('np-copy-phases').checked
      });
    } else {
      newId = PlanManager.createPlan({ nome, tipo });
    }
    // ativa o novo planejamento e SALVA NA NUVEM antes de recarregar
    PlanManager.setActivePlan(newId);
    showToast('Salvando planejamento...');
    CloudStore.saveThenReload();
  }
};

// Interações do seletor
$id('plan-switcher-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  PlanUI.toggleMenu();
});
$id('plan-manage').addEventListener('click', () => {
  PlanUI.closeMenu();
  switchScreen('planejamentos');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#plan-switcher')) PlanUI.closeMenu();
});

// Interações da tela de gestão
$id('np-source').addEventListener('change', () => PlanUI.updateCopyOptionsVisibility());
$id('np-create').addEventListener('click', () => PlanUI.createFromForm());

window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'planejamentos') PlanUI.renderScreen();
});

// Render inicial do seletor na sidebar
PlanUI.renderSidebar();
