/* ============================================================
   TELA + SELETOR DE PLANEJAMENTOS (workspace)
   ============================================================ */
const PlanUI = {
  _fmtPause(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) { return String(iso); }
  },
  _fmtDia(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
  },
  // Texto da pausa para o card: vigente, agendada e janelas já encerradas.
  _pauseHint(id) {
    const hoje = todayLocal();
    const ws = PlanManager.pauseWindows(id);
    const vig = PlanManager.pauseInfo(id);
    const ag = PlanManager.scheduledPause(id);
    const passadas = ws.filter(w => w.until && w.until <= hoje);
    const partes = [];
    if (vig) {
      partes.push(`Pausado desde <strong>${escapeHtml(this._fmtDia(vig.from))}</strong>` +
        (vig.until ? ` · volta a contar em <strong>${escapeHtml(this._fmtDia(vig.until))}</strong>` : ' · sem data de retorno') +
        '. Histórico preservado; nesses dias métricas, motores, ciclos e Extras não contam atraso nem geram atividades. Cards/Anki e Links Úteis continuam globais.');
    } else if (ag) {
      partes.push(`Pausa agendada a partir de <strong>${escapeHtml(this._fmtDia(ag.from))}</strong>` +
        (ag.until ? ` até <strong>${escapeHtml(this._fmtDia(ag.until))}</strong> (retorno)` : ' · sem data de retorno') +
        '. Até lá tudo funciona normalmente; Extras e rodízios não são gerados para os dias pausados.');
    }
    if (passadas.length) {
      partes.push('Pausas anteriores (não contam em atrasos e métricas): ' + passadas.slice(-4).map(w =>
        `${escapeHtml(this._fmtDia(w.from))} → ${escapeHtml(this._fmtDia(PlanManager._somaDias(w.until, -1)))}`).join(' · ') + '.');
    }
    return partes.length ? `<div class="hint plan-pause-hint" style="margin:.35rem 0 .6rem">${partes.join('<br>')}</div>` : '';
  },
  async _explicarFalhaPausa(r) {
    const msgs = {
      'last-operational': 'É preciso manter pelo menos um planejamento operacional em todos os dias a partir da pausa. Crie outro planejamento, ou reative/cancele a pausa de outro, antes de pausar este.',
      'overlap': r && r.min ? `A pausa não pode começar antes de ${this._fmtDia(r.min)}, quando terminou a pausa anterior.` : (r && r.max ? `O retorno precisa ser até ${this._fmtDia(r.max)}, início da pausa seguinte.` : 'As datas se sobrepõem a outra pausa.'),
      'until-before-from': 'A data de retorno precisa ser posterior ao primeiro dia da pausa.',
      'before-pause': r && r.min ? `A reativação não pode ser anterior ao início da pausa (${this._fmtDia(r.min)}).` : 'A reativação não pode ser anterior ao início da pausa.',
      'invalid-date': 'Data inválida.'
    };
    const txt = msgs[r && r.reason];
    if (txt) await UI.alert(txt, { title: 'Não foi possível salvar a pausa' });
    else showToast('Não foi possível salvar a pausa');
  },
  // Pausar (ou reagendar uma pausa futura) escolhendo o primeiro dia congelado.
  async _pedirPausa(id) {
    const p = PlanManager.getPlans().find(x => x.id === id);
    if (!p) return;
    const hoje = todayLocal();
    const ag = PlanManager.scheduledPause(id);
    const ws = PlanManager.pauseWindows(id).filter(w => w.until && w.until <= hoje);
    const min = ws.length ? ws[ws.length - 1].until : null;
    const v = await UI.prompt([
      { key: 'from', label: 'Pausar a partir de', type: 'date', value: ag ? ag.from : hoje, min,
        hint: 'Primeiro dia congelado. Pode ser uma data passada (os dias desde então deixam de contar como atraso) ou futura (pausa agendada).' },
      { key: 'until', label: 'Voltar a contar em', type: 'date', value: ag && ag.until ? ag.until : '', opt: true,
        hint: 'Deixe em branco para pausar sem data de retorno — você define ao reativar.' }
    ], {
      title: ag ? '⏸ Alterar pausa agendada' : '⏸ Pausar planejamento',
      sub: `"${p.nome}": registros e histórico ficam preservados. Nos dias pausados não são gerados Extras, rodízio de Lei Seca ou reforços, nada conta como atraso e as métricas do planejamento ignoram esses dias. Cards/Anki e Links Úteis continuam disponíveis globalmente.`,
      okText: ag ? 'Salvar pausa' : 'Pausar'
    });
    if (!v) return;
    const r = PlanManager.pausePlan(id, { from: v.from || hoje, until: v.until || null });
    if (!r.ok) { await this._explicarFalhaPausa(r); return; }
    if (r.unchanged) { showToast('Este planejamento já está pausado'); return; }
    showToast(r.scheduled ? `Pausa agendada para ${this._fmtDia(r.from)} ✓` : 'Planejamento pausado ✓');
    if (r.switchedTo) { CloudStore.saveThenReload(); return; }
    this.renderScreen(); this.renderSidebar();
  },
  // Reativar escolhendo o dia em que tudo volta a contar.
  async _pedirRetorno(id) {
    const p = PlanManager.getPlans().find(x => x.id === id);
    const vig = PlanManager.pauseInfo(id);
    if (!p || !vig) return;
    const hoje = todayLocal();
    const v = await UI.prompt([
      { key: 'until', label: 'Voltar a contar em', type: 'date', value: vig.until || hoje, min: vig.from,
        hint: `A pausa começou em ${this._fmtDia(vig.from)}. Uma data passada reativa desde aquele dia (o que venceu depois dela volta a contar); uma data futura agenda o retorno.` }
    ], { title: '▶ Reativar planejamento', sub: `"${p.nome}" volta a entrar em métricas, motores, ciclo e Extras a partir da data escolhida.`, okText: 'Reativar' });
    if (!v) return;
    const r = PlanManager.resumePlan(id, { from: v.until || hoje });
    if (!r.ok) { await this._explicarFalhaPausa(r); return; }
    showToast(r.cancelled ? 'Pausa desfeita ✓' : (r.scheduled ? `Retorno agendado para ${this._fmtDia(r.until)} ✓` : 'Planejamento reativado ✓'));
    this.renderScreen(); this.renderSidebar();
  },

  // ---------- Seletor na sidebar ----------
  renderSidebar() {
    const active = PlanManager.getActivePlan();
    $id('active-plan-name').textContent = active ? active.nome : '—';
    const listEl = document.getElementById('plan-switcher-list');
    const plans = PlanManager.getPlans();
    const activeId = PlanManager.getActivePlanId();
    listEl.innerHTML = plans.map(p => {
      const paused = PlanManager.isPaused(p.id);
      const ag = !paused && PlanManager.scheduledPause(p.id);
      return `
      <button type="button" class="plan-switcher-item ${p.id === activeId ? 'active' : ''} ${paused ? 'paused' : ''}" data-id="${p.id}" aria-disabled="${paused ? 'true' : 'false'}">
        <span class="psi-dot"></span>
        <span class="psi-text">
          <span class="psi-name">${escapeHtml(p.nome)}</span>
          <span class="psi-tipo">${paused ? '⏸ Pausado · ' : ''}${ag ? '⏳ Pausa em ' + escapeHtml(formatDateShort(ag.from)) + ' · ' : ''}${escapeHtml(p.tipo)}</span>
        </span>
        ${p.id === activeId ? '<span class="psi-check">✓</span>' : paused ? '<span class="psi-check">⏸</span>' : ''}
      </button>`;
    }).join('');
    listEl.querySelectorAll('.plan-switcher-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (PlanManager.isPaused(id)) {
          showToast('⏸ Este planejamento está pausado. Reative-o em Planejamentos para voltar a usá-lo.');
          this.closeMenu();
          return;
        }
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
      plans.map(p => `<option value="${p.id}">${PlanManager.isPaused(p.id) ? '⏸ ' : ''}${escapeHtml(p.nome)}</option>`).join('');
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
      const pause = PlanManager.pauseInfo(p.id);
      const isPaused = !!pause;
      const agendada = !isPaused && PlanManager.scheduledPause(p.id);
      return `
        <div class="plan-card ${isActive ? 'is-active' : ''} ${isPaused ? 'is-paused' : ''}" data-id="${p.id}">
          <div class="plan-card-head">
            <div class="plan-card-title">
              <span class="nome">${escapeHtml(p.nome)}</span>
              <span class="plan-type-badge">${escapeHtml(p.tipo)}</span>
              ${isActive ? '<span class="plan-active-pill">ativo</span>' : ''}
              ${isPaused ? '<span class="plan-active-pill">⏸ pausado</span>' : ''}
              ${agendada ? `<span class="plan-active-pill">⏳ pausa em ${escapeHtml(this._fmtDia(agendada.from))}</span>` : ''}
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
          ${this._pauseHint(p.id)}
          <div class="plan-card-actions">
            ${isPaused
              ? '<button type="button" class="btn-primary btn-resume-plan">▶ Reativar…</button>'
              : (isActive
                ? '<button type="button" class="btn-secondary" disabled>Planejamento atual</button>'
                : '<button type="button" class="btn-primary btn-open-plan">Abrir este planejamento</button>')}
            ${isPaused ? '' : `<button type="button" class="btn-secondary btn-pause-plan">${agendada ? '✎ Alterar pausa' : '⏸ Pausar'}</button>`}
            ${agendada ? '<button type="button" class="btn-secondary btn-cancel-pause-plan">✕ Cancelar pausa</button>' : ''}
          </div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('.plan-card').forEach(card => {
      const id = card.dataset.id;
      const openBtn = card.querySelector('.btn-open-plan');
      if (openBtn) openBtn.addEventListener('click', () => {
        if (!PlanManager.setActivePlan(id)) { showToast('Planejamento pausado'); return; }
        CloudStore.saveThenReload();
      });
      const pauseBtn = card.querySelector('.btn-pause-plan');
      if (pauseBtn) pauseBtn.addEventListener('click', () => this._pedirPausa(id));
      const cancelPauseBtn = card.querySelector('.btn-cancel-pause-plan');
      if (cancelPauseBtn) cancelPauseBtn.addEventListener('click', () => {
        const r = PlanManager.cancelScheduledPause(id);
        if (!r.ok) { showToast('Não foi possível cancelar a pausa'); return; }
        showToast('Pausa agendada cancelada ✓');
        this.renderScreen(); this.renderSidebar();
      });
      const resumeBtn = card.querySelector('.btn-resume-plan');
      if (resumeBtn) resumeBtn.addEventListener('click', () => this._pedirRetorno(id));
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
        if (!await UI.confirmTyped(`Excluir o planejamento "${p.nome}"?\n\nOs dados operacionais (${entries} registro(s), matérias, ciclos, histórico e trilhas) serão apagados permanentemente.\n\nCards/Anki e Links Úteis são patrimônio global do perfil e serão preservados automaticamente em outro planejamento.`,
          { word: 'EXCLUIR', title: '🗑️ Excluir planejamento', okText: 'Excluir definitivamente' })) return;
        try { if (window.CloudBackup) await CloudBackup.protegerAgora('antes de excluir um planejamento'); } catch (_) { _quiet(_); }
        const wasActive = PlanManager.getActivePlanId() === id;
        const apagou = PlanManager.deletePlan(id);
        if (apagou === false) {
          await UI.alert('Reative outro planejamento antes de excluir este. O perfil precisa manter pelo menos um planejamento operacional.', { title: 'Não é possível excluir' });
          return;
        }
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
        copyPhases: $id('np-copy-phases').checked,
        copyTec: $id('np-copy-tec').checked
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
  /* O seletor é global e pode ter sido pintado antes do login/hidratação. */
  PlanUI.renderSidebar();
  if (e.detail.screen === 'planejamentos') PlanUI.renderScreen();
});
window.addEventListener('data:relational-hydrated', () => {
  /* hydrateProfile já reconstruiu planejamentos + active-plan na memória.
     Repaint aqui evita o nome "—" permanecer preso no DOM pré-login. */
  PlanUI.renderSidebar();
  const tela = document.getElementById('screen-planejamentos');
  if (tela && tela.classList.contains('active')) PlanUI.renderScreen();
});

/* Pausa ou retorno agendado que entrou em vigor sozinho (virada do dia ou
   sincronização). Se o planejamento aberto congelou, o app reabre no próximo
   operacional; senão basta repintar a tela atual com as novas datas. */
window.addEventListener('planning:pause-changed', (e) => {
  const d = (e && e.detail) || {};
  if (!d.automatic) return;
  if (d.switchedTo) { showToast('⏸ A pausa agendada começou — abrindo outro planejamento.'); CloudStore.saveThenReload(); return; }
  PlanUI.renderSidebar();
  const atual = document.querySelector('.screen.active');
  if (atual && atual.id) switchScreen(atual.id.replace(/^screen-/, ''));
});

// Render inicial do seletor na sidebar
PlanUI.renderSidebar();
