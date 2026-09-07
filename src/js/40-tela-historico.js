/* ============================================================
   TELA: HISTÓRICO
   ============================================================ */
const HistoricoScreen = {
  editingId: null,
  scope: 'plan', // 'plan' = só o planejamento ativo | 'all' = todos (somente leitura)

  render() {
    const consolidated = this.scope === 'all';
    const history = (consolidated ? DB.getAllCycleHistoryTagged() : DB.getCycleHistory()).slice().reverse();
    const emptyEl = document.getElementById('historico-empty');
    const listEl = document.getElementById('historico-list');

    if (history.length === 0) {
      emptyEl.style.display = 'block';
      listEl.innerHTML = '';
      return;
    }
    emptyEl.style.display = 'none';

    // No modo consolidado as semanas são apenas leitura (podem vir de vários planejamentos)
    listEl.innerHTML = history.map(w =>
      (!consolidated && this.editingId === w.id) ? this.editTemplate(w) : this.viewTemplate(w, consolidated)
    ).join('');
    this.bindDetailToggles(listEl);        // expandir/ocultar detalhes funciona nos dois escopos
    if (!consolidated) this.bindRows(listEl);
  },

  // minutos por dia da grade (aceita células legadas em string)
  normalizeGradeCell(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return { subject: raw, minutes: 60, done: false };
    return { subject: raw.subject, minutes: raw.minutes ?? 60, done: !!raw.done };
  },

  // sessões reais registradas no intervalo da semana (do planejamento correto)
  getPeriodEntries(w, consolidated) {
    const all = (consolidated && w._planId) ? DB.getEntriesForPlan(w._planId) : DB.getEntries();
    return all
      .filter(e => e.date >= w.startDate && e.date <= w.endDate)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.subject || '').localeCompare(b.subject || ''));
  },

  viewTemplate(w, consolidated) {
    const perfBadge = w.avgPerformancePct !== null && w.avgPerformancePct !== undefined
      ? `<span class="status-badge ${toneFor(w.avgPerformancePct) === 'good' ? 'finalizada' : toneFor(w.avgPerformancePct) === 'warn' ? 'iniciada' : 'pendente'}">${formatPct(w.avgPerformancePct)}% acerto</span>`
      : '';
    const planBadge = consolidated && w._planNome
      ? `<span class="plan-tag-badge">${escapeHtml(w._planNome)}</span>` : '';
    const actions = consolidated ? '' : `
            <button type="button" class="reg-act-btn btn-edit-week" title="Editar semana" aria-label="Editar semana">✎</button>
            <button type="button" class="reg-act-btn danger btn-delete-week" title="Excluir semana" aria-label="Excluir semana">✕</button>`;

    const subjects = w.subjects || [];
    const fin = subjects.filter(s => s.status === 'finalizada').length;
    const ini = subjects.filter(s => s.status === 'iniciada').length;
    const pen = subjects.filter(s => s.status === 'pendente').length;
    const sessions = this.getPeriodEntries(w, consolidated).length;
    // DEFENSIVO: semanas legadas/importadas podem não ter todos os campos calculados.
    // Sem estes fallbacks, o cartão exibia "NaN%" e "undefined/und…" (visto na auditoria).
    const _num = (v) => (typeof v === 'number' && isFinite(v)) ? v : 0;
    w.pctCumprido    = _num(w.pctCumprido);
    w.totalStudiedMin = _num(w.totalStudiedMin);
    w.weeklyHours    = _num(w.weeklyHours);
    w.finalizadas    = (w.finalizadas != null) ? w.finalizadas : fin;
    w.totalSubjects  = (w.totalSubjects != null) ? w.totalSubjects : subjects.length;
    const cumpTone = w.pctCumprido >= 100 ? 'finalizada' : w.pctCumprido >= 40 ? 'iniciada' : 'pendente';
    /* BUG CORRIGIDO — dois numeros de "planejado" na mesma tela.
       O cartao mostrava weeklyHours (a carga que voce PEDIU ao montar o ciclo) e
       logo abaixo a barra comparava com totalTargetMin (a soma do que voce
       DEFINIU por matéria, depois de ajustar). Quem mexeu no tempo de alguma
       matéria via "36h planejadas" acima de "28h de 40h" — sem erro em nenhum
       dos dois, mas impossivel de conciliar. Agora os dois leem a MESMA meta. */
    const _metaMin = (typeof w.totalTargetMin === 'number' && isFinite(w.totalTargetMin) && w.totalTargetMin > 0)
      ? w.totalTargetMin
      : Math.round(_num(w.weeklyHours) * 60);

    return `
      <div class="week-card" data-id="${w.id}">
        <div class="week-card-head">
          <div class="wk-period-box">
            ${planBadge}
            <span class="wk-period-ic">🗓️</span>
            <span class="wk-period-dates">${formatDateShort(w.startDate)}<span class="arrow">→</span>${formatDateShort(w.endDate)}</span>
          </div>
          <div class="wk-head-right">
            ${perfBadge}${actions}
          </div>
        </div>
        <div class="week-stats-row">
          <div class="week-stat">
            <div class="value">${Math.min(w.pctCumprido,999)}%</div>
            <div class="label">cumprido</div>
          </div>
          <div class="week-stat">
            <div class="value">${CycleEngine.fmtHM(w.totalStudiedMin)}</div>
            <div class="label">estudado</div>
          </div>
          <div class="week-stat">
            <div class="value">${w.finalizadas}/${w.totalSubjects}</div>
            <div class="label">finalizadas</div>
          </div>
          <div class="week-stat">
            <div class="value">${CycleEngine.fmtHM(_metaMin)}</div>
            <div class="label">planejadas</div>
          </div>
        </div>
        <div class="week-cumprido-wrap">
          <div class="week-cumprido-head">
            <span class="lbl">Meta da semana</span>
            <span class="val">${CycleEngine.fmtHM(w.totalStudiedMin)} de ${CycleEngine.fmtHM(_metaMin)}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill tone-${cumpTone}" style="width:${Math.min(100, w.pctCumprido)}%;"></div>
          </div>
        </div>
        <div class="week-status-dist">
          <span class="wsd-chip fin"><span class="n">${fin}</span> finalizada${fin===1?'':'s'}</span>
          <span class="wsd-chip ini"><span class="n">${ini}</span> iniciada${ini===1?'':'s'}</span>
          <span class="wsd-chip pen"><span class="n">${pen}</span> pendente${pen===1?'':'s'}</span>
          <span class="wsd-chip ses"><span class="n">${sessions}</span> ${sessions === 1 ? 'sessão registrada' : 'sessões registradas'}</span>
        </div>
        <button type="button" class="btn-toggle-detail" data-id="${w.id}">
          <span class="ttl">Ver detalhes da semana</span><span class="caret">▾</span>
        </button>
        <div class="week-detail" data-detail="${w.id}">
          ${this.detailHtml(w, consolidated)}
        </div>
      </div>
    `;
  },

  detailHtml(w, consolidated) {
    return `
      <div class="wd-section-title">Progresso por matéria</div>
      ${this.subjectsProgressHtml(w)}
      <div class="wd-section-title">Grade planejada da semana</div>
      ${this.gradeDetailHtml(w)}
      <div class="wd-section-title">Sessões registradas no período</div>
      ${this.entriesHtml(w, consolidated)}
    `;
  },

  subjectsProgressHtml(w) {
    const subjects = w.subjects || [];
    if (subjects.length === 0) return `<p class="wd-empty">Nenhuma matéria estava neste ciclo.</p>`;
    /* Mesma lista do Ciclo da Semana, inclusive o aproveitamento ao lado do
       status: antes o detalhe do historico mostrava so horas, entao a semana
       arquivada perdia a informacao de desempenho que a semana viva tinha. */
    return subjects.map(s => {
      const definido = s.definidoMin || 0;
      const estudado = s.estudadoMin || 0;
      const status = s.status || CycleEngine.statusFor(estudado, definido);
      const pct = definido > 0 ? Math.min(100, Math.round((estudado / definido) * 100)) : 0;
      const over = estudado > definido;
      const remaining = Math.max(0, definido - estudado);
      const q = CycleEngine.questionsStudied(s.nome, w.startDate, w.endDate);
      const acc = q.total > 0 ? Math.round((q.correct / q.total) * 10000) / 100 : null;
      const accTone = acc == null ? '' : (acc >= 70 ? 'tone-good' : acc >= 50 ? 'tone-warn' : 'tone-bad');
      const fmt2 = (v) => { const r = Math.round(v * 100) / 100; return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ','); };
      return `
        <div class="subject-progress-item status-${status}">
          <div class="subject-progress-head">
            <span class="name">${escapeHtml(s.nome)}</span>
            <span class="sp-head-right">
              <span class="subject-acc ${accTone}" title="${q.total ? q.correct + ' de ' + q.total + ' questões nesta semana' : 'Sem questões registradas nesta semana'}"><b>${acc == null ? '—' : fmt2(acc) + '%'}</b><span class="sp-acc-lbl">aproveit.</span></span>
              <span class="status-badge ${status}">${status}</span>
            </span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${over ? 'tone-over' : 'tone-' + status}" style="width:${pct}%;"></div>
          </div>
          <div class="subject-hours-breakdown">
            <div class="subject-hours-cell done">
              <div class="hv">${CycleEngine.fmtHM(estudado)}</div>
              <div class="hl">realizado</div>
            </div>
            <div class="subject-hours-cell remaining ${remaining === 0 ? 'zero' : ''}">
              <div class="hv">${remaining === 0 ? '✓' : CycleEngine.fmtHM(remaining)}</div>
              <div class="hl">${remaining === 0 ? 'completo' : 'falta'}</div>
            </div>
            <div class="subject-hours-cell">
              <div class="hv">${CycleEngine.fmtHM(definido)}</div>
              <div class="hl">meta</div>
            </div>
          </div>
          <div class="subject-progress-head sp-foot" style="margin-top:10px; margin-bottom:0;">
            <span class="subject-meta-tag">dificuldade ${s.dificuldade ?? '—'} · ${escapeHtml(s.fase || '—')}</span>
            <span class="subject-meta-tag">${pct}% da meta</span>
          </div>
        </div>
      `;
    }).join('');
  },

  gradeDetailHtml(w) {
    const grade = w.grade || {};
    const dias = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
    // nº de sessões vem do snapshot (dinâmico): usa w.sessions ou o maior array da grade (mín. 3)
    const maxLen = dias.reduce((m, d) => Math.max(m, Array.isArray(grade[d]) ? grade[d].length : 0), 0);
    const nRows = Math.max(w.sessions || 0, maxLen, 3);
    const rows = Array.from({ length: nRows }, (_, i) => `${i + 1}ª sessão`);
    const hasAny = dias.some(d => (grade[d] || []).some(c => this.normalizeGradeCell(c)));
    if (!hasAny) return `<p class="wd-empty">Nenhuma grade foi montada para esta semana.</p>`;

    let html = '<div style="overflow-x:auto;"><table class="grade-table"><thead><tr><th>Sessão</th>';
    dias.forEach(d => html += `<th>${d.slice(0, 3)}</th>`);
    html += '</tr></thead><tbody>';
    rows.forEach((label, ri) => {
      html += `<tr><td>${label}</td>`;
      dias.forEach(dia => {
        const cell = this.normalizeGradeCell(grade[dia] && grade[dia][ri]);
        if (!cell) {
          html += `<td><span class="wd-grade-empty">—</span></td>`;
        } else {
          const acr = CycleEngine.baseAcronym(cell.subject);
          html += `<td><div class="wd-grade-chip ${cell.done ? 'done' : ''}" title="${escapeHtml(cell.subject)}${cell.done ? ' · concluída' : ''}">
            <span class="acr">${escapeHtml(acr)}${cell.done ? '<span>✓</span>' : ''}</span>
            <span class="min">${CycleEngine.fmtHM(cell.minutes)}</span>
          </div></td>`;
        }
      });
      html += '</tr>';
    });
    // linha de total por dia
    html += '<tr class="grade-summary-row"><td>Total</td>';
    dias.forEach(dia => {
      const total = (grade[dia] || []).map(c => this.normalizeGradeCell(c)).filter(Boolean)
        .reduce((sum, c) => sum + (c.minutes || 0), 0);
      html += `<td class="grade-summary-cell">${total > 0 ? CycleEngine.fmtHM(total) : '—'}</td>`;
    });
    html += '</tr></tbody></table></div>';
    return html;
  },

  entriesHtml(w, consolidated) {
    const entries = this.getPeriodEntries(w, consolidated);
    if (entries.length === 0) return `<p class="wd-empty">Nenhuma sessão foi registrada neste período.</p>`;
    return entries.map(e => {
      const hasPct = e.total > 0;
      const pct = hasPct ? calcPct(e.correct, e.total) : null;
      const tone = hasPct ? toneFor(pct) : null;
      const hours = Math.floor(e.durationMin / 60), mins = e.durationMin % 60;
      const timeStr = (hours > 0 ? hours + 'h ' : '') + (mins > 0 || hours === 0 ? mins + 'min' : '');
      const [y, m, d] = e.date.split('-');
      return `
        <div class="wd-entry">
          <div class="wd-entry-date"><span class="dm">${d}/${m}</span><span class="y">${y}</span></div>
          <div class="wd-entry-main">
            <div class="subj">${escapeHtml(e.subject)}</div>
            <div class="wd-entry-badges">
              <span class="meta-badge badge-method">${escapeHtml(e.method)}</span>
              <span class="meta-badge badge-duration">${timeStr}</span>
              ${progressBadgeHtml(e)}
              ${e.lesson ? `<span class="meta-badge badge-lesson">${escapeHtml(e.lesson)}</span>` : ''}
            </div>
            ${e.comment ? `<div class="wd-entry-comment">${escapeHtml(e.comment)}</div>` : ''}
          </div>
          ${hasPct ? `
            <div class="wd-entry-pct">
              <span class="p tone-${tone}" style="background:var(--${tone}-soft); color:var(--${tone}-text);">${formatPct(pct)}%</span>
              <span class="c">${e.correct}/${e.total}</span>
            </div>` : '<div></div>'}
        </div>
      `;
    }).join('');
  },

  bindDetailToggles(listEl) {
    listEl.querySelectorAll('.btn-toggle-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const detail = listEl.querySelector(`.week-detail[data-detail="${id}"]`);
        if (!detail) return;
        const open = detail.classList.toggle('open');
        btn.classList.toggle('open', open);
        btn.querySelector('.ttl').textContent = open ? 'Ocultar detalhes da semana' : 'Ver detalhes da semana';
      });
    });
  },

  editTemplate(w) {
    const subjRows = (w.subjects || []).map(s => `
      <div class="wk-subj-row" data-subj="${escapeHtml(s.nome)}">
        <span class="wk-subj-name">${escapeHtml(s.nome)}</span>
        <label class="wk-subj-meta">Meta (min)
          <input type="number" inputmode="numeric" class="wk-subj-target" value="${s.definidoMin || 0}" min="0" step="5">
        </label>
        <span class="wk-subj-done">Estudado <b class="wk-subj-studied">—</b></span>
      </div>`).join('');
    return `
      <div class="week-card wk-editing" data-id="${w.id}" style="border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring);">
        <p class="wk-edit-note">🔒 Os indicadores abaixo (%, estudado, finalizadas, total, % médio) são <b>calculados a partir dos seus registros</b> e não podem ser digitados. Ajuste as <b>datas</b>, as <b>horas planejadas</b> ou as <b>metas por matéria</b> — os resultados se atualizam sozinhos.</p>
        <div class="week-card-head">
          <div class="field" style="margin-bottom:0;">
            <label>Início da semana</label>
            <input type="date" class="wk-start" value="${w.startDate}">
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Fim da semana</label>
            <input type="date" class="wk-end" value="${w.endDate}">
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Horas planejadas</label>
            <input type="number" inputmode="decimal" class="wk-hours" value="${w.weeklyHours}" min="0" step="0.5">
          </div>
        </div>
        <p class="wk-range-warn" style="display:none;"></p>

        <div class="wk-computed">
          <div class="wk-metric"><div class="wk-metric-val wk-c-pct">—</div><div class="wk-metric-lbl">% cumprido</div></div>
          <div class="wk-metric"><div class="wk-metric-val wk-c-studied">—</div><div class="wk-metric-lbl">estudado</div></div>
          <div class="wk-metric"><div class="wk-metric-val wk-c-final">—</div><div class="wk-metric-lbl">finalizadas</div></div>
          <div class="wk-metric"><div class="wk-metric-val wk-c-total">—</div><div class="wk-metric-lbl">matérias</div></div>
          <div class="wk-metric"><div class="wk-metric-val wk-c-perf">—</div><div class="wk-metric-lbl" title="Acertos ÷ questões no período — cada questão pesa uma">% de acerto</div></div>
        </div>

        ${subjRows ? `<div class="wk-subj-list"><div class="wk-subj-title">Metas por matéria</div>${subjRows}</div>` : ''}

        <div class="submit-row" style="margin-top:8px;">
          <button type="button" class="btn-secondary btn-cancel-week">Cancelar</button>
          <button type="button" class="btn-primary btn-save-week">Salvar alterações</button>
        </div>
      </div>
    `;
  },
  // Lê as fontes editáveis do card e recalcula tudo (usado ao vivo e ao salvar)
  _recomputeFromCard(card, w) {
    const metas = {};
    card.querySelectorAll('.wk-subj-row').forEach(row => {
      const nome = row.dataset.subj;
      metas[CycleEngine.normKey(nome)] = row.querySelector('.wk-subj-target').value;
    });
    return CycleEngine.recomputeWeek(w, {
      startDate: card.querySelector('.wk-start').value,
      endDate: card.querySelector('.wk-end').value,
      weeklyHours: parseFloat(card.querySelector('.wk-hours').value) || 0,
      metas
    });
  },
  _paintComputed(card, r) {
    const set = (sel, txt) => { const el = card.querySelector(sel); if (el) el.textContent = txt; };
    set('.wk-c-pct', Math.min(r.pctCumprido, 999) + '%');
    set('.wk-c-studied', CycleEngine.fmtHM(r.totalStudiedMin));
    set('.wk-c-final', r.finalizadas + '/' + r.totalSubjects);
    set('.wk-c-total', r.totalSubjects);
    set('.wk-c-perf', r.avgPerformancePct == null ? '—' : formatPct(r.avgPerformancePct) + '%');
    (r.subjects || []).forEach(s => {
      const row = card.querySelector(`.wk-subj-row[data-subj="${(s.nome || '').replace(/"/g, '\\"')}"]`);
      if (row) { const b = row.querySelector('.wk-subj-studied'); if (b) b.textContent = CycleEngine.fmtHM(s.estudadoMin); }
    });
  },

  bindRows(listEl) {
    listEl.querySelectorAll('.week-card').forEach(card => {
      const id = parseFloat(card.dataset.id);

      const editBtn = card.querySelector('.btn-edit-week');
      if (editBtn) editBtn.addEventListener('click', () => { this.editingId = id; this.render(); });

      const deleteBtn = card.querySelector('.btn-delete-week');
      if (deleteBtn) deleteBtn.addEventListener('click', async () => {
        const w = DB.getCycleHistory().find(x => x.id === id);
        if (!await UI.confirm(`Excluir a semana de ${formatDateShort(w.startDate)} a ${formatDateShort(w.endDate)} do histórico?\n\nEssa ação não pode ser desfeita.`,
          { title: '🗑️ Excluir semana', okText: 'Excluir', danger: true })) return;
        try { if (window.VersionHistory) await VersionHistory.antesDe('excluir uma semana do histórico'); } catch (_) { _quiet(_); }
        DB.deleteCycleHistoryEntry(id);
        showToast('Semana removida do histórico');
        this.render();
      });

      const cancelBtn = card.querySelector('.btn-cancel-week');
      if (cancelBtn) cancelBtn.addEventListener('click', () => { this.editingId = null; this.render(); });

      // Só entra no modo edição quando esta semana está sendo editada
      if (card.classList.contains('wk-editing')) {
        const w = DB.getCycleHistory().find(x => x.id === id);
        const warnEl = card.querySelector('.wk-range-warn');
        const startEl = card.querySelector('.wk-start');
        const endEl = card.querySelector('.wk-end');
        const saveBtn = card.querySelector('.btn-save-week');

        const refresh = () => {
          // datas coerentes
          let start = startEl.value, end = endEl.value;
          let dateError = '';
          if (start && end && end < start) dateError = 'O término não pode ser anterior ao início.';
          // sobreposição com outras semanas (histórico + semana ativa)
          let overlap = null;
          if (!dateError && start && end) overlap = DB.findCycleOverlap(start, end, id, true);
          if (overlap) dateError = 'Este intervalo se sobrepõe a ' + overlap.label + '. Ajuste as datas.';
          if (warnEl) { warnEl.style.display = dateError ? 'block' : 'none'; warnEl.textContent = dateError ? '⚠ ' + dateError : ''; }
          if (saveBtn) { saveBtn.disabled = !!dateError; saveBtn.style.opacity = dateError ? '0.5' : ''; }
          const r = this._recomputeFromCard(card, w);
          this._paintComputed(card, r);
          return { r, dateError };
        };
        // recálculo ao vivo em qualquer fonte editável
        card.querySelectorAll('.wk-start, .wk-end, .wk-hours, .wk-subj-target').forEach(inp => {
          inp.addEventListener('input', refresh);
          inp.addEventListener('change', refresh);
        });
        refresh(); // pinta os valores iniciais

        if (saveBtn) saveBtn.addEventListener('click', () => {
          const { r, dateError } = refresh();
          if (dateError) { showToast(dateError); return; }
          DB.updateCycleHistoryEntry(id, {
            startDate: r.startDate, endDate: r.endDate, weeklyHours: r.weeklyHours,
            subjects: r.subjects, totalTargetMin: r.totalTargetMin, totalStudiedMin: r.totalStudiedMin,
            pctCumprido: r.pctCumprido, finalizadas: r.finalizadas, totalSubjects: r.totalSubjects,
            avgPerformancePct: r.avgPerformancePct
          });
          this.editingId = null;
          showToast('Semana atualizada ✓');
          this.render();
        });
      }
    });
  }
};

window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'historico') HistoricoScreen.render();
});
