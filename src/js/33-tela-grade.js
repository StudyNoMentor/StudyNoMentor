const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

// modo de montagem do ciclo conforme o tipo do planejamento ativo
// 'pos' = Pós-edital (ponderação estratégica) | 'pre' = demais (dificuldade + fase)
function planCycleMode() {
  const p = PlanManager.getActivePlan();
  return (p && p.tipo === 'Pós-edital') ? 'pos' : 'pre';
}

(function initCiclo() {
  // helper com guarda de nulo: um ID renomeado não derruba mais o boot inteiro.
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  const elEmpty = document.getElementById('ciclo-empty');
  const elSetup = document.getElementById('ciclo-setup');
  const elReview = document.getElementById('ciclo-review');
  const elActive = document.getElementById('ciclo-active');

  const cycleHoursInput = document.getElementById('cycle-hours');
  const cycleMinutesInput = document.getElementById('cycle-minutes');
  const cycleStartInput = document.getElementById('cycle-start');
  // só dígitos nos campos de carga horária
  [cycleHoursInput, cycleMinutesInput].forEach(el => {
    if (el) el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, ''); });
  });
  // lê a carga horária (horas + minutos) e devolve horas decimais; escreve nos dois campos
  function readWeeklyHours() {
    const h = parseInt(cycleHoursInput.value, 10) || 0;
    let m = parseInt(cycleMinutesInput.value, 10) || 0;
    if (m > 59) m = 59;
    const dec = h + m / 60;
    return dec > 0 ? dec : 1; // mínimo de 1h para não zerar a sugestão
  }
  function writeWeeklyHours(hDecimal) {
    const total = Math.round((hDecimal || 0) * 60);
    cycleHoursInput.value = Math.floor(total / 60);
    cycleMinutesInput.value = total % 60;
  }
  const cycleEndInput = document.getElementById('cycle-end');
  const subjectsListEl = document.getElementById('cycle-subjects-list');

  // Ao mudar o início, sugere o término = início + 6 dias (o usuário ainda pode editar).
  if (cycleStartInput) cycleStartInput.addEventListener('change', () => {
    const s = cycleStartInput.value;
    if (s) cycleEndInput.value = CycleEngine.weekEndDate(s);
  });

  let pendingCycle = null; // rascunho entre "calcular sugestão" e "confirmar"

  // Monta o <select> de matéria puxando as disciplinas cadastradas em Configurações.
  // Mantém a matéria já escolhida (mesmo que tenha sido desativada) e oferece "outra".
  function subjectSelectHtml(selectedName) {
    const actives = DB.getActiveSubjects();
    // ordem alfabética (pt-BR, ignorando acentos/caixa)
    const names = actives.map(s => s.nome).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    // se a matéria atual não estiver na lista ativa, inclui para não perder a seleção
    if (selectedName && !names.includes(selectedName)) names.unshift(selectedName);
    if (names.length === 0) {
      return `<select class="cs-name">
        <option value="" disabled selected>Cadastre matérias em Configurações</option>
      </select>`;
    }
    const opts = names.map(n =>
      `<option value="${escapeHtml(n)}" ${n === selectedName ? 'selected' : ''}>${escapeHtml(n)}</option>`
    ).join('');
    return `<select class="cs-name">
      <option value="" ${!selectedName ? 'selected' : ''} disabled>Selecione a matéria</option>
      ${opts}
    </select>`;
  }

  /* ── A DIFICULDADE DECLARADA CONTRA A MEDIDA ────────────────────────────
     Este 1 a 5 distribui as suas horas da semana, e é um chute. O TEC sabe a
     resposta: 48% de acerto é difícil, 85% não é. Mostramos a nota medida ao
     lado da declarada — quem discorda continua discordando, mas de um número,
     não do vazio. Sem amostra suficiente não aparece nada: um palpite do app
     em cima de doze questões seria pior que o palpite da pessoa. */
  function medidaHtml(nome, dif) {
    if (!nome || typeof PlanoPontos === 'undefined') return '';
    let m = null;
    try { m = PlanoPontos.dificuldadeMedida(nome); } catch (e) { return ''; }
    if (!m) return '';
    if (m.nota === dif) return `<span class="cs-medida ok" title="Você acerta ${m.taxa.toFixed(0)}% nesta matéria, em ${m.q} questões do TEC">✓ bate com o TEC</span>`;
    return `<button type="button" class="cs-medida" data-adotar="${m.nota}"
      title="Pelo TEC você acerta ${m.taxa.toFixed(0)}% nesta matéria, em ${m.q} questões — isso equivale a ${m.nota}. Clique para adotar.">TEC diz ${m.nota} (${m.taxa.toFixed(0)}%)</button>`;
  }
  function subjectRowTemplate(s) {
    const nome = s ? s.nome : '';
    const dif = s ? s.dificuldade : 3;
    const rowId = 'row-' + Math.random().toString(36).slice(2, 9);
    if (planCycleMode() === 'pos') {
      // linha estratégica do pós-edital
      const qtd = s && s.qtdQuestoes != null ? s.qtdQuestoes : '';
      const pts = s && s.pontosPorQuestao != null ? s.pontosPorQuestao : 1;
      const peso = s && s.peso != null ? s.peso : 1;
      const ext = s ? (s.extensao || 1) : 1;
      return `
      <div class="cycle-subject-row pos" data-row-id="${rowId}">
        <div class="field">
          <label>Matéria</label>
          ${subjectSelectHtml(nome)}
        </div>
        <div class="field">
          <label title="Quantidade de questões na prova">Qtd. Q.</label>
          <input type="number" inputmode="numeric" class="cs-qtd cs-num" min="0" value="${qtd}" placeholder="0">
        </div>
        <div class="field">
          <label title="Pontos por questão">Pts/Q</label>
          <input type="number" inputmode="decimal" class="cs-pts cs-num" min="0" step="0.1" value="${pts}">
        </div>
        <div class="field">
          <label title="Peso da matéria na prova">Peso</label>
          <input type="number" inputmode="decimal" class="cs-peso cs-num" min="0" step="0.5" value="${peso}">
        </div>
        <div class="field">
          <label>Dif.</label>
          <select class="cs-dif">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${n===dif?'selected':''}>${n}</option>`).join('')}
          </select>
          ${medidaHtml(nome, dif)}
        </div>
        <div class="field">
          <label title="Extensão/volume de conteúdo">Extensão</label>
          <select class="cs-ext">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${n===ext?'selected':''}>${n}</option>`).join('')}
          </select>
        </div>
        <!-- O MÍNIMO NÃO É PESO, É RESTRIÇÃO. Muito edital exige nota mínima
             por matéria: abaixo dela você é cortado, por melhor que seja o
             total. Nenhuma otimização de pontos enxerga isso sozinha — por
             isso o número mora aqui e o Plano põe a matéria na frente de tudo
             quando ela está abaixo. Em branco = a prova não exige mínimo. -->
        <div class="field">
          <label title="Nota mínima exigida nesta matéria (%). Em branco se o edital não exige.">Mín. %</label>
          <input type="number" inputmode="numeric" class="cs-min cs-num" min="0" max="100" step="1"
            value="${s && s.minimoPct != null ? s.minimoPct : ''}" placeholder="—">
        </div>
        <button type="button" class="remove-btn" title="Remover" aria-label="Remover">×</button>
      </div>
    `;
    }
    // linha padrão (pré-edital / outro): dificuldade + fase
    const fase = s ? s.fase : 'Novo';
    return `
      <div class="cycle-subject-row" data-row-id="${rowId}">
        <div class="field">
          <label>Matéria</label>
          ${subjectSelectHtml(nome)}
        </div>
        <div class="field">
          <label>Dificuldade</label>
          <select class="cs-dif">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${n===dif?'selected':''}>${n}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Fase</label>
          <select class="cs-fase">
            ${DB.getActivePhases().map(p => `<option ${fase===p.nome?'selected':''}>${escapeHtml(p.nome)}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="remove-btn" title="Remover" aria-label="Remover">×</button>
      </div>
    `;
  }

  function renderSetupSubjects(list) {
    subjectsListEl.innerHTML = list.map(subjectRowTemplate).join('');
  }

  on('btn-add-cycle-subject', 'click', () => {
    subjectsListEl.insertAdjacentHTML('beforeend', subjectRowTemplate(null));
  });

  subjectsListEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-btn')) {
      e.target.closest('.cycle-subject-row').remove();
      return;
    }
    // adotar a dificuldade que o TEC mede, em vez do chute
    const ad = e.target.closest('[data-adotar]');
    if (ad) {
      const row = ad.closest('.cycle-subject-row');
      const sel = row && row.querySelector('.cs-dif');
      if (sel) { sel.value = ad.dataset.adotar; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      ad.outerHTML = '<span class="cs-medida ok">✓ adotado do TEC</span>';
      showToast('Dificuldade do TEC adotada ✓');
    }
  });
  /* Trocar de matéria troca a medida: o "TEC diz 4" ao lado de um select que
     agora aponta para outra matéria seria um número certo no lugar errado. */
  subjectsListEl.addEventListener('change', (e) => {
    if (!e.target.classList || !e.target.classList.contains('cs-name')) return;
    const row = e.target.closest('.cycle-subject-row');
    const campo = row && row.querySelector('.cs-dif') && row.querySelector('.cs-dif').parentElement;
    if (!campo) return;
    const velha = campo.querySelector('.cs-medida');
    if (velha) velha.remove();
    const dif = parseInt(row.querySelector('.cs-dif').value, 10);
    campo.insertAdjacentHTML('beforeend', medidaHtml(e.target.value, dif));
  });

  function readSetupSubjects() {
    const isPos = planCycleMode() === 'pos';
    return [...subjectsListEl.querySelectorAll('.cycle-subject-row')].map(row => {
      const base = {
        nome: row.querySelector('.cs-name').value.trim(),
        dificuldade: parseInt(row.querySelector('.cs-dif').value, 10)
      };
      if (isPos) {
        base.qtdQuestoes = parseFloat(row.querySelector('.cs-qtd').value) || 0;
        base.pontosPorQuestao = parseFloat(row.querySelector('.cs-pts').value) || 1;
        base.peso = parseFloat(row.querySelector('.cs-peso').value) || 1;
        base.extensao = parseInt(row.querySelector('.cs-ext').value, 10) || 1;
        // vazio é uma resposta: "esta prova não exige mínimo aqui"
        const mn = row.querySelector('.cs-min');
        const mv = mn ? String(mn.value).trim() : '';
        base.minimoPct = mv === '' ? null : Math.max(0, Math.min(100, parseFloat(mv) || 0));
        base.fase = 'Novo';
      } else {
        base.fase = row.querySelector('.cs-fase').value;
      }
      return base;
    }).filter(s => s.nome);
  }

  function showState(state) {
    elEmpty.style.display = state === 'empty' ? 'block' : 'none';
    elSetup.style.display = state === 'setup' ? 'block' : 'none';
    elReview.style.display = state === 'review' ? 'block' : 'none';
    elActive.style.display = state === 'active' ? 'block' : 'none';
  }

  function openSetup(prefill) {
    // memória: se não veio prefill (nova semana), usa o último ciclo montado deste planejamento
    if (!prefill) {
      const last = DB.getLastCycleSetup();
      if (last) prefill = { weeklyHours: last.weeklyHours, subjects: last.subjects, mode: last.mode };
    }
    writeWeeklyHours(prefill?.weeklyHours || 20);
    const _start = prefill?.startDate || todayLocal();
    cycleStartInput.value = _start;
    // término: usa o do prefill (edição) ou sugere início + 6 dias (7º dia da semana)
    cycleEndInput.value = prefill?.endDate || CycleEngine.weekEndDate(_start);
    // aviso e rótulos conforme o modo do planejamento ativo
    const isPos = planCycleMode() === 'pos';
    const hintEl = document.getElementById('ciclo-setup-mode-hint');
    const labelEl = document.getElementById('ciclo-setup-subjects-label');
    if (isPos) {
      hintEl.textContent = 'Planejamento Pós-edital: a sugestão de tempo pondera a relevância de cada matéria na prova (nº de questões × pontos × peso), somada à dificuldade e à extensão.';
      labelEl.textContent = 'Matérias no ciclo · ponderação estratégica';
    } else {
      hintEl.textContent = 'A sugestão de tempo é calculada pela dificuldade e pela fase de cada matéria.';
      labelEl.textContent = 'Matérias no ciclo';
    }
    const subjectsForCycle = prefill?.subjects?.length
      ? prefill.subjects
      : DB.getActiveSubjects().length ? DB.getActiveSubjects() : [null, null, null];
    renderSetupSubjects(subjectsForCycle.length ? subjectsForCycle : [null]);
    $id('cycle-subject-list').innerHTML =
      DB.getActiveSubjects().slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
        .map(s => `<option value="${escapeHtml(s.nome)}">`).join('');
    showState('setup');
  }

  on('btn-start-cycle', 'click', () => openSetup(null));
  on('btn-cancel-cycle', 'click', () => {
    const existing = DB.getCurrentCycle();
    showState(existing ? 'active' : 'empty');
  });
  on('btn-edit-cycle', 'click', () => {
    // reabre a revisão de tempo do ciclo já ativo, mantendo os tempos já definidos
    const existing = DB.getCurrentCycle();
    if (existing) {
      pendingCycle = {
        startDate: existing.startDate,
        endDate: existing.endDate || CycleEngine.weekEndDate(existing.startDate),
        weeklyHours: existing.weeklyHours,
        mode: existing.mode || planCycleMode(),
        subjects: existing.subjects.map(s => ({ ...s })),
        grade: existing.grade
      };
      renderReview();
      showState('review');
    } else {
      openSetup(null);
    }
  });

  on('btn-calc-cycle', 'click', () => {
    const weeklyHours = readWeeklyHours();
    const startDate = cycleStartInput.value || todayLocal();
    // término editável (fallback = início + 6). Garante término >= início.
    let endDate = cycleEndInput.value || CycleEngine.weekEndDate(startDate);
    if (endDate < startDate) {
      showToast('O término não pode ser anterior ao início. Ajustei para o 7º dia.');
      endDate = CycleEngine.weekEndDate(startDate);
      cycleEndInput.value = endDate;
    }
    // impede sobreposição com semanas já fechadas no histórico (evita ambiguidade de datas)
    const overlap = DB.findCycleOverlap(startDate, endDate, null, false);
    if (overlap) {
      showToast('Este intervalo se sobrepõe a ' + overlap.label + '. Ajuste as datas do ciclo.');
      return;
    }
    const rawSubjects = readSetupSubjects();

    if (rawSubjects.length === 0) {
      showToast('Adicione ao menos uma matéria');
      return;
    }

    const mode = planCycleMode();
    const withSuggestions = CycleEngine.suggestMinutesFor(rawSubjects, weeklyHours, mode);

    // preserva os minutos DEFINIDOS MANUALMENTE ao reeditar um ciclo: se a matéria já tinha
    // um tempo definido diferente da sugestão, mantém esse valor (casa por nome), em vez de
    // sobrescrever com a nova sugestão da ferramenta.
    const prevDefined = {};
    // 1) memória do último ciclo montado (base) — restaura os tempos definidos na semana anterior
    if (!pendingCycle) {
      const last = DB.getLastCycleSetup();
      if (last && Array.isArray(last.subjects)) {
        last.subjects.forEach(s => {
          if (s && s.nome != null && s.definidoMin != null) prevDefined[CycleEngine.normKey(s.nome)] = s.definidoMin;
        });
      }
    }
    // 2) rascunho em edição (tem prioridade sobre a memória)
    if (pendingCycle && Array.isArray(pendingCycle.subjects)) {
      pendingCycle.subjects.forEach(s => {
        if (s && s.nome != null && s.definidoMin != null) prevDefined[CycleEngine.normKey(s.nome)] = s.definidoMin;
      });
    }
    withSuggestions.forEach(s => {
      const pd = prevDefined[CycleEngine.normKey(s.nome)];
      if (pd != null) s.definidoMin = pd; // mantém o tempo do usuário; sugeridoMin segue como referência
    });

    // preserva grade existente e o nº de sessões se já havia um ciclo com a mesma janela
    const prevCycle = DB.getCurrentCycle();
    const sameWindow = prevCycle && prevCycle.startDate === startDate;
    const grade = sameWindow ? prevCycle.grade : {};
    const carriedSessions = sameWindow ? (prevCycle.sessions || sessionCount(prevCycle)) : (pendingCycle && pendingCycle.sessions);
    const nSess = Math.max(1, carriedSessions || 3);
    DIAS_SEMANA.forEach(d => {
      if (!Array.isArray(grade[d])) grade[d] = [];
      while (grade[d].length < nSess) grade[d].push('');
    });

    pendingCycle = { startDate, endDate, weeklyHours, mode, subjects: withSuggestions, grade, sessions: nSess };
    rawSubjects.forEach(s => {
      DB.upsertSubjectName(s.nome);
      // No pós-edital, persiste os parâmetros estratégicos no cadastro da matéria,
      // para que se mantenham ao montar os próximos ciclos do mesmo planejamento.
      if (mode === 'pos') {
        const subj = DB.getSubjects().find(x => x.nome.toLowerCase() === s.nome.toLowerCase());
        if (subj) DB.updateSubject(subj.id, {
          dificuldade: s.dificuldade,
          qtdQuestoes: s.qtdQuestoes,
          pontosPorQuestao: s.pontosPorQuestao,
          peso: s.peso,
          extensao: s.extensao,
          // o mínimo eliminatório viaja junto: é dele que o Plano tira a
          // restrição que vem antes de qualquer otimização de pontos
          minimoPct: s.minimoPct
        });
      }
    });

    renderReview();
    showState('review');
  });

  // ---- Estado de revisão: ajustar o tempo definido por matéria ----
  function budgetTotals() {
    const targetMin = pendingCycle.weeklyHours * 60;
    const allocatedMin = pendingCycle.subjects.reduce((sum, s) => sum + (s.definidoMin || 0), 0);
    return { targetMin, allocatedMin };
  }

  function renderBudgetIndicator() {
    const { targetMin, allocatedMin } = budgetTotals();
    const pct = targetMin > 0 ? (allocatedMin / targetMin) * 100 : 0;
    const diff = allocatedMin - targetMin;

    let tone = 'good', message;
    if (diff > 0) {
      tone = 'over';
      message = `${CycleEngine.fmtHM(Math.abs(diff))} acima da carga planejada`;
    } else if (diff < 0) {
      tone = 'warn';
      message = `${CycleEngine.fmtHM(Math.abs(diff))} ainda não alocado`;
    } else {
      tone = 'good';
      message = 'Carga horária totalmente alocada';
    }

    const container = document.getElementById('cycle-budget-indicator');
    container.className = 'cycle-budget-indicator tone-' + tone;
    container.innerHTML = `
      <div class="cycle-budget-head">
        <span class="cycle-budget-numbers">${CycleEngine.fmtHM(allocatedMin)} <span class="of">de ${CycleEngine.fmtHM(targetMin)} planejadas</span></span>
        <span class="cycle-budget-message tone-${tone}">${message}</span>
      </div>
      <div class="cycle-budget-track">
        <div class="cycle-budget-fill tone-${tone}" style="width:${Math.min(100, pct)}%;"></div>
      </div>
    `;
  }

  function renderReview() {
    renderBudgetIndicator();
    const container = document.getElementById('cycle-review-list');
    container.innerHTML = pendingCycle.subjects.map((s, idx) => {
      const h = Math.floor(s.definidoMin / 60);
      const m = s.definidoMin % 60;
      const changed = s.definidoMin !== s.sugeridoMin;
      const metaTxt = (pendingCycle.mode === 'pos')
        ? `relevância ${(( s.relevancia || 0) * 100).toFixed(1)}% · dif. ${s.dificuldade} · ext. ${s.extensao || 1}`
        : `dificuldade ${s.dificuldade} · ${escapeHtml(s.fase || '—')}`;
      return `
        <div class="cycle-review-row" data-idx="${idx}">
          <div>
            <div class="name">${escapeHtml(s.nome)}</div>
            <div class="meta">${metaTxt}</div>
          </div>
          <div class="suggested">sugestão<br>${CycleEngine.fmtHM(s.sugeridoMin)}</div>
          <div class="cycle-review-time-input">
            <input type="number" inputmode="numeric" class="cr-h" min="0" value="${h}"><span>h</span>
            <input type="number" inputmode="numeric" class="cr-m" min="0" max="59" value="${m}"><span>min</span>
          </div>
          ${changed ? `<button type="button" class="btn-reset-suggestion" data-idx="${idx}">usar sugestão</button>` : '<span></span>'}
        </div>
      `;
    }).join('');

    container.querySelectorAll('.cycle-review-row').forEach(row => {
      const idx = parseInt(row.dataset.idx, 10);
      const hInput = row.querySelector('.cr-h');
      const mInput = row.querySelector('.cr-m');
      const update = () => {
        const h = parseInt(hInput.value, 10) || 0;
        const m = parseInt(mInput.value, 10) || 0;
        pendingCycle.subjects[idx].definidoMin = h * 60 + m;
        renderReview(); // atualiza indicador e o botão "usar sugestão"
      };
      hInput.addEventListener('change', update);
      mInput.addEventListener('change', update);
    });

    container.querySelectorAll('.btn-reset-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        pendingCycle.subjects[idx].definidoMin = pendingCycle.subjects[idx].sugeridoMin;
        renderReview();
      });
    });
  }

  on('btn-back-to-setup', 'click', () => {
    // repopula o formulário com as matérias que já estavam no rascunho em edição,
    // em vez de deixar a tela "setup" vazia ou desatualizada
    openSetup(pendingCycle);
  });

  on('btn-confirm-cycle', 'click', () => {
    /* pendingCycle só existe depois de "calcular sugestão". O botão fica na
       tela de pré-visualização, mas essa tela pode ser alcançada de novo depois
       de um recarregamento — e aí o rascunho não existe mais. Sem esta guarda o
       clique lançava TypeError e a tela travava sem explicação nenhuma.
       (O handler de "voltar" já tinha guarda equivalente; este não.) */
    if (!pendingCycle || !pendingCycle.startDate) {
      showToast('Monte o ciclo primeiro — clique em "Calcular sugestão"');
      try { switchScreen('ciclo'); } catch (e) { _quiet(e, 'confirm-cycle'); }
      return;
    }
    const cycle = {
      startDate: pendingCycle.startDate,
      endDate: pendingCycle.endDate || CycleEngine.weekEndDate(pendingCycle.startDate),
      weeklyHours: pendingCycle.weeklyHours,
      mode: pendingCycle.mode || planCycleMode(),
      subjects: pendingCycle.subjects,
      grade: pendingCycle.grade,
      sessions: pendingCycle.sessions || sessionCount(pendingCycle),
      createdAt: new Date().toISOString()
    };
    DB.saveCurrentCycle(cycle);
    // memória: guarda os dados do ciclo montado para pré-preencher a próxima semana
    DB.saveLastCycleSetup({
      weeklyHours: cycle.weeklyHours,
      mode: cycle.mode,
      subjects: cycle.subjects.map(s => ({
        nome: s.nome, dificuldade: s.dificuldade, fase: s.fase,
        qtdQuestoes: s.qtdQuestoes, pontosPorQuestao: s.pontosPorQuestao, peso: s.peso, extensao: s.extensao,
        minimoPct: s.minimoPct, definidoMin: s.definidoMin
      }))
    });
    showToast('Ciclo confirmado ✓');
    renderActiveCycle();
    showState('active');
  });

  /* fmtPct2 local saiu: era uma segunda régua de formatação, idêntica em
     intenção à formatPct() global mas divergente na prática (a global escrevia
     "67.36" com ponto). Uma métrica, uma notação — formatPct() agora é a única.  */

  function renderOverviewGauges(cycle) {
    const container = document.getElementById('ciclo-overview-gauges');
    /* Uma única fonte para o progresso da semana (CycleEngine.progressoSemana):
       exatamente os mesmos números que o fechamento grava no histórico. Antes
       esta tela tinha fórmula própria — com teto de 3× a meta por matéria — e
       o cartão do Histórico, outra. A semana mudava de número ao ser fechada. */
    const prog = CycleEngine.progressoSemana(cycle.subjects, cycle.startDate, CycleEngine.rangeEnd(cycle));
    const totalTarget = prog.totalTargetMin;
    const totalStudied = prog.totalStudiedMin;
    const finalizadas = prog.finalizadas;
    const pctGeral = prog.pctCumprido;
    const overallAccent = pctGeral >= 100 ? 'accent-good' : pctGeral >= 40 ? 'accent-warn' : 'accent-bad';
    const finalizadasAccent = cycle.subjects.length > 0 && finalizadas === cycle.subjects.length ? 'accent-good' : '';
    const remaining = prog.restanteMin;
    const remAccent = remaining === 0 ? 'accent-good' : '';
    /* Aproveitamento geral da semana (acertos ÷ resolvidas em todas as matérias
       do intervalo). Mesmo intervalo dos minutos — antes as questões usavam
       effectiveEnd(), que ia até hoje, e o mesmo cartão media tempo até o fim
       da semana e acerto até depois dele. */
    const q = CycleEngine.questionsStudied(null, cycle.startDate, CycleEngine.rangeEnd(cycle));
    const acc = q.total > 0 ? Math.round((q.correct / q.total) * 10000) / 100 : null;
    const accAccent = acc == null ? '' : (acc >= 70 ? 'accent-good' : acc >= 50 ? 'accent-warn' : 'accent-bad');

    /* 6º indicador — RITMO NECESSARIO. Os outros cinco contam o que ja passou;
       este responde a unica pergunta sobre a qual ainda da para agir: "quanto
       preciso estudar por dia, daqui ate o fim da semana, para fechar a meta?".
       Divide o que falta pelos dias restantes (hoje incluido). Se a semana ja
       terminou, cai para 1 dia — o numero vira "o que falta", sem dividir por
       zero nem prometer um prazo que nao existe mais. */
    const _fimSemana = CycleEngine.rangeEnd(cycle);
    const _hojeIso = todayLocal();
    let diasRestantes = 1;
    try {
      const d1 = new Date((_hojeIso > cycle.startDate ? _hojeIso : cycle.startDate) + 'T00:00:00');
      const d2 = new Date(_fimSemana + 'T00:00:00');
      diasRestantes = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);
    } catch (_) { diasRestantes = 1; }
    const porDia = remaining > 0 ? Math.round(remaining / diasRestantes) : 0;
    const ritmoAccent = remaining === 0 ? 'accent-good' : (porDia > 300 ? 'accent-bad' : porDia > 180 ? 'accent-warn' : '');
    const ritmoTitulo = remaining === 0
      ? 'Meta da semana já cumprida'
      : `Faltam ${CycleEngine.fmtHM(remaining)} em ${diasRestantes} dia(s) — até ${formatDateShort(_fimSemana)}`;

    container.innerHTML = `
      <div class="mini-gauge-card ${overallAccent}">
        <div class="value">${formatPct(pctGeral)}%</div>
        <div class="label">cumprido</div>
      </div>
      <div class="mini-gauge-card">
        <div class="value">${CycleEngine.fmtHM(totalStudied)}</div>
        <div class="label">estudado</div>
      </div>
      <div class="mini-gauge-card ${remAccent}">
        <div class="value">${remaining === 0 ? '✓' : CycleEngine.fmtHM(remaining)}</div>
        <div class="label">${remaining === 0 ? 'meta batida' : 'faltam'}</div>
      </div>
      <div class="mini-gauge-card ${accAccent}" title="${q.total ? q.correct + ' de ' + q.total + ' questões' : 'Registre questões para ver o aproveitamento'}">
        <div class="value">${acc == null ? '—' : formatPct(acc) + '%'}</div>
        <div class="label">aproveitamento</div>
      </div>
      <div class="mini-gauge-card ${finalizadasAccent}">
        <div class="value">${finalizadas}/${cycle.subjects.length}</div>
        <div class="label">finalizadas</div>
      </div>
      <div class="mini-gauge-card ${ritmoAccent}" title="${escapeHtml(ritmoTitulo)}">
        <div class="value">${remaining === 0 ? '✓' : CycleEngine.fmtHM(porDia)}</div>
        <div class="label">${remaining === 0 ? 'nada a fazer' : 'por dia p/ fechar'}</div>
      </div>
    `;
  }

  let _cicloSubjFilter = null;   // nome da disciplina filtrada (null = todas)
  let _cicloChipsAbertos = true; // bandeja de siglas expandida/recolhida (por sessao)
  function renderSubjectsProgress(cycle) {
    const container = document.getElementById('ciclo-subjects-progress');
    // exibe em ordem alfabética (sem alterar a ordem salva do ciclo)
    const ordered = cycle.subjects.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
    // some com o filtro se a disciplina saiu do ciclo
    if (_cicloSubjFilter && !ordered.some(s => s.nome === _cicloSubjFilter)) _cicloSubjFilter = null;
    // Filtro rápido por disciplina (chips) — só aparece com 2+ matérias
    let filterHtml = '';
    if (ordered.length > 1) {
      const chip = (nome, label) => `<button type="button" class="csp-chip ${(_cicloSubjFilter === nome) ? 'active' : ''}" data-subj="${nome == null ? '' : escapeHtml(nome)}" title="${nome == null ? 'Ver todas as matérias' : escapeHtml(nome)}">${escapeHtml(label)}</button>`;
      /* A bandeja de siglas virou um GRID de colunas iguais, nao um wrap solto:
         com chips de larguras diferentes as linhas ficavam com buracos no fim e
         nada se alinhava na vertical. Colunas iguais resolvem os dois eixos de
         uma vez. E ela RECOLHE: com 20 matérias a lista empurrava o conteudo
         util para fora da tela no celular. */
      filterHtml = `
        <div class="csp-wrap ${_cicloChipsAbertos ? 'open' : 'closed'}">
          <div class="csp-head">
            <span class="csp-head-lbl">Filtrar por matéria</span>
            <button type="button" class="csp-toggle" id="csp-toggle" aria-expanded="${_cicloChipsAbertos}" aria-controls="csp-filter">
              <span>${_cicloChipsAbertos ? 'Ocultar' : 'Mostrar'} siglas (${ordered.length})</span>
              <span class="csp-caret">▾</span>
            </button>
          </div>
          <div class="csp-filter" id="csp-filter">${chip(null, 'TODAS')}${ordered.map(s => chip(s.nome, CycleEngine.siglaForSubject(s.nome))).join('')}</div>
        </div>`;
    }
    const shown = _cicloSubjFilter ? ordered.filter(s => s.nome === _cicloSubjFilter) : ordered;
    container.innerHTML = filterHtml + shown.map(s => {
      const studied = CycleEngine.minutesStudied(s.nome, cycle.startDate, CycleEngine.rangeEnd(cycle));
      const status = CycleEngine.statusFor(studied, s.definidoMin);
      const pct = (s.definidoMin > 0) ? Math.min(100, Math.round((studied / s.definidoMin) * 100)) : 0;
      const over = studied > s.definidoMin;
      const remaining = Math.max(0, s.definidoMin - studied);
      // aproveitamento em questões desta matéria na semana
      const q = CycleEngine.questionsStudied(s.nome, cycle.startDate, CycleEngine.rangeEnd(cycle));
      const acc = q.total > 0 ? Math.round((q.correct / q.total) * 10000) / 100 : null;
      const accTone = acc == null ? '' : (acc >= 70 ? 'tone-good' : acc >= 50 ? 'tone-warn' : 'tone-bad');
      return `
        <div class="subject-progress-item status-${status}">
          <div class="subject-progress-head">
            <span class="name">${escapeHtml(s.nome)}</span>
            <span class="sp-head-right">
              <span class="subject-acc ${accTone}" title="${q.total ? q.correct + ' de ' + q.total + ' questões nesta semana' : 'Sem questões registradas nesta semana'}"><b>${acc == null ? '—' : formatPct(acc) + '%'}</b><span class="sp-acc-lbl">aproveit.</span></span>
              <span class="status-badge ${status}">${status}</span>
            </span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${over ? 'tone-over' : 'tone-' + status}" style="width:${pct}%;"></div>
          </div>
          <div class="subject-hours-breakdown">
            <div class="subject-hours-cell done">
              <div class="hv">${CycleEngine.fmtHM(studied)}</div>
              <div class="hl">realizado</div>
            </div>
            <div class="subject-hours-cell remaining ${remaining === 0 ? 'zero' : ''}">
              <div class="hv">${remaining === 0 ? '✓' : CycleEngine.fmtHM(remaining)}</div>
              <div class="hl">${remaining === 0 ? 'completo' : 'falta'}</div>
            </div>
            <div class="subject-hours-cell">
              <div class="hv">${CycleEngine.fmtHM(s.definidoMin)}</div>
              <div class="hl">total</div>
            </div>
          </div>
          <div class="subject-progress-head sp-foot" style="margin-top:10px; margin-bottom:0;">
            <span class="subject-meta-tag">dificuldade ${s.dificuldade} · ${escapeHtml(s.fase)}</span>
            <span class="subject-meta-tag">${pct}% da meta</span>
          </div>
        </div>
      `;
    }).join('');
    // liga os chips de filtro
    container.querySelectorAll('.csp-chip').forEach(b => b.addEventListener('click', () => {
      _cicloSubjFilter = b.dataset.subj || null;
      renderSubjectsProgress(cycle);
    }));
    const cspT = document.getElementById('csp-toggle');
    if (cspT) cspT.addEventListener('click', () => { _cicloChipsAbertos = !_cicloChipsAbertos; renderSubjectsProgress(cycle); });
  }

  // Duração padrão ao alocar uma matéria numa célula vazia (o usuário pode editar livremente depois)
  const GRADE_DEFAULT_MIN = 60;

  // Fonte da grade = MODELO PERSISTENTE (rotina reutilizável entre ciclos)
  function gradeGet() { return DB.getGradeTemplate(); }
  function gradeSave(t) { DB.saveGradeTemplate(t); }
  /* ---- Preferências de exibição da Grade (por PERFIL e sincronizadas na nuvem) ----
     Antes ficavam em chaves globais do navegador: não acompanhavam o perfil nem iam
     para o backup, então "voltavam ao padrão" ao trocar de dispositivo/recarregar. */
  const GRADE_WS_LEGACY = 'diario-estudos:grade-weekstart';
  const GRADE_TRAY_LEGACY = 'diario-estudos:grade-tray-collapsed';
  function _gradePrefKey(name) {
    try { return DB._profilePrefix() + 'pref-' + name; } catch (e) { return 'diario-estudos:pref-' + name; }
  }
  function gradePrefGet(name, legacyKey, fallback) {
    try {
      const v = localStorage.getItem(_gradePrefKey(name));
      if (v !== null) return v;
      if (legacyKey) {
        const lv = localStorage.getItem(legacyKey);
        if (lv !== null) { gradePrefSet(name, lv); return lv; } // migra a preferência antiga
      }
    } catch (e) { _quiet(e); }
    return fallback;
  }
  function gradePrefSet(name, value) { DB.setRaw(_gradePrefKey(name), String(value)); }
  // preferência de início da semana ('mon' = segunda | 'sun' = domingo) — só afeta a ORDEM de exibição
  function gradeWeekStart() { return gradePrefGet('grade-weekstart', GRADE_WS_LEGACY, 'mon') === 'sun' ? 'sun' : 'mon'; }
  function setGradeWeekStart(v) { gradePrefSet('grade-weekstart', v === 'sun' ? 'sun' : 'mon'); }
  // preferência da bandeja de siglas (recolhida ou não)
  function gradeTrayCollapsed() { return gradePrefGet('grade-tray-collapsed', GRADE_TRAY_LEGACY, '0') === '1'; }
  function setGradeTrayCollapsed(b) { gradePrefSet('grade-tray-collapsed', b ? '1' : '0'); }
  // dias na ordem de exibição escolhida (os DADOS continuam guardados por nome do dia)
  function gradeDaysOrder() {
    if (gradeWeekStart() === 'sun') return ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    return DIAS_SEMANA.slice();
  }
  // Lista de siglas para a bandeja: matérias ativas + siglas livres customizadas.
  function gradeTrayItems() {
    const map = CycleEngine.buildAcronymMap(); // nome -> sigla (respeita customizadas)
    const items = DB.getActiveSubjects().map(s => ({
      nome: s.nome, acronym: map[s.nome] || CycleEngine.baseAcronym(s.nome), color: CycleEngine.colorForSubject(s.nome)
    }));
    // siglas livres (sem matéria vinculada) entram como itens arrastáveis próprios
    DB.getCustomSiglas().filter(c => !c.nome).forEach(c => {
      items.push({ nome: c.sigla, acronym: c.sigla, color: c.color, free: true });
    });
    return items;
  }

  function renderChipTray() {
    const tray = document.getElementById('grade-chip-tray');
    if (!tray) return;
    const items = gradeTrayItems();
    if (items.length === 0) {
      tray.innerHTML = `<span class="grade-chip-tray-empty">Cadastre matérias em Configurações ou crie siglas customizadas abaixo.</span>`;
      return;
    }
    tray.innerHTML = items.map(s => `
      <div class="subject-chip" draggable="true" data-subject="${escapeHtml(s.nome)}" data-acronym="${escapeHtml(s.acronym)}"${s.color ? ` style="--chip-color:${s.color}"` : ''}>
        <span>${escapeHtml(s.acronym)}</span>
        <span class="chip-full-name" title="${escapeHtml(s.nome)}">${escapeHtml(s.nome)}</span>
      </div>
    `).join('');

    tray.querySelectorAll('.subject-chip').forEach(chip => {
      chip.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({
          subject: chip.dataset.subject, acronym: chip.dataset.acronym, from: 'tray'
        }));
        chip.classList.add('dragging');
      });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });
  }

  // normaliza uma célula antiga (string) ou nova ({subject,minutes}) para o formato atual
  function normalizeCell(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return { subject: raw, minutes: GRADE_DEFAULT_MIN, done: false };
    if (raw.done === undefined) raw.done = false;
    return raw;
  }

  // número de sessões (linhas) da grade: usa cycle.sessions ou deriva do maior array da grade (mín. 1, padrão 3)
  function sessionCount(cycle) {
    let n = (cycle && Number.isFinite(cycle.sessions)) ? cycle.sessions : 0;
    if (!n && cycle && cycle.grade) {
      DIAS_SEMANA.forEach(d => { if (Array.isArray(cycle.grade[d])) n = Math.max(n, cycle.grade[d].length); });
    }
    return Math.max(1, n || 3);
  }
  function sessionLabel(i) { return `${i + 1}ª sessão`; }

  function renderGrade() {
    const container = document.getElementById('ciclo-grade');
    if (!container) return;
    const tmpl = gradeGet();
    const count = sessionCount(tmpl);
    const rows = Array.from({ length: count }, (_, i) => sessionLabel(i));
    const days = gradeDaysOrder();
    let html = '<table class="grade-table"><thead><tr><th>Sessão</th>';
    days.forEach(d => html += `<th>${d.slice(0, 3)}</th>`);
    html += '</tr></thead><tbody>';
    rows.forEach((label, ri) => {
      html += `<tr><td>${label}</td>`;
      days.forEach(dia => {
        html += `<td><div class="grade-cell-drop" data-dia="${dia}" data-idx="${ri}"></div></td>`;
      });
      html += '</tr>';
    });
    // linha de resumo de carga horária, como parte da própria tabela — garante alinhamento perfeito com as colunas
    html += '<tr class="grade-summary-row"><td>Total</td>';
    days.forEach(dia => {
      html += `<td class="grade-summary-cell" data-summary-dia="${dia}"></td>`;
    });
    html += '</tr>';
    html += '</tbody></table>';
    // controles para adicionar/remover sessões livremente
    html += `<div class="grade-session-controls">
      <button type="button" class="btn-secondary" id="btn-add-session">+ Adicionar sessão</button>
      <button type="button" class="btn-secondary" id="btn-remove-session"${count <= 1 ? ' disabled' : ''}>− Remover última sessão</button>
      <span class="grade-session-count">${count} sess${count === 1 ? 'ão' : 'ões'} por dia</span>
    </div>`;
    container.innerHTML = html;

    // preenche cada célula com o chip correspondente, se houver
    container.querySelectorAll('.grade-cell-drop').forEach(cell => {
      renderCellContent(cell);
    });

    bindDropZones(container);
    updateDaySummary();
    updateUncheckAllBtn();

    // adicionar sessão: cresce o nº de linhas da grade (no modelo persistente)
    const addBtn = container.querySelector('#btn-add-session');
    if (addBtn) addBtn.addEventListener('click', () => {
      const t = gradeGet();
      const newCount = sessionCount(t) + 1;
      t.sessions = newCount;
      DIAS_SEMANA.forEach(d => { if (!Array.isArray(t.grade[d])) t.grade[d] = []; while (t.grade[d].length < newCount) t.grade[d].push(''); });
      gradeSave(t);
      renderGrade();
    });
    // remover última sessão: só se estiver vazia em todos os dias
    const remBtn = container.querySelector('#btn-remove-session');
    if (remBtn) remBtn.addEventListener('click', () => {
      const t = gradeGet();
      const cur = sessionCount(t);
      if (cur <= 1) return;
      const lastIdx = cur - 1;
      const hasContent = DIAS_SEMANA.some(d => normalizeCell(t.grade[d] && t.grade[d][lastIdx]));
      if (hasContent) { showToast('A última sessão tem matérias. Remova-as antes de excluir a sessão.'); return; }
      const newCount = cur - 1;
      t.sessions = newCount;
      DIAS_SEMANA.forEach(d => { if (Array.isArray(t.grade[d])) t.grade[d] = t.grade[d].slice(0, newCount); });
      gradeSave(t);
      renderGrade();
    });
  }

  const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  function renderCellContent(cell) {
    const dia = cell.dataset.dia, idx = parseInt(cell.dataset.idx, 10);
    const tmpl = gradeGet();
    const cellData = normalizeCell(tmpl.grade[dia] && tmpl.grade[dia][idx]);
    if (!cellData) {
      cell.innerHTML = `<span class="grade-cell-empty-hint">+ escolher</span>`;
      bindCellClick(cell);
      return;
    }
    const { subject, minutes, done } = cellData;
    const acronym = CycleEngine.buildAcronymMap()[subject] || CycleEngine.siglaForSubject(subject);
    const _color = CycleEngine.colorForSubject(subject);
    cell.innerHTML = `
      <div class="subject-chip ${done ? 'done' : ''}" draggable="true" data-subject="${escapeHtml(subject)}" data-acronym="${escapeHtml(acronym)}" title="${escapeHtml(subject)}"${_color ? ` style="--chip-color:${_color}"` : ''}>
        <div class="chip-top-row">
          <span class="chip-acronym-label">${escapeHtml(acronym)}</span>
          <button type="button" class="chip-remove" title="Remover desta célula" aria-label="Remover desta célula">×</button>
        </div>
        <div class="chip-bottom-row">
          <span class="chip-duration-wrap"><input type="text" inputmode="numeric" class="chip-duration-input" value="${minutes}" title="Duração em minutos" aria-label="Duração em minutos"></span>
          <button type="button" class="chip-done-toggle" title="${done ? 'Marcar como não concluída' : 'Marcar como concluída'}">${CHECK_ICON}</button>
        </div>
      </div>
    `;
    const chip = cell.querySelector('.subject-chip');
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        subject, acronym, minutes, done, from: 'cell', fromDia: dia, fromIdx: idx
      }));
      chip.classList.add('dragging');
    });
    chip.addEventListener('dragend', () => chip.classList.remove('dragging'));

    const durationInput = cell.querySelector('.chip-duration-input');
    durationInput.addEventListener('click', (e) => e.stopPropagation());
    // aceita só dígitos enquanto digita
    durationInput.addEventListener('input', () => { durationInput.value = durationInput.value.replace(/\D/g, ''); });
    durationInput.addEventListener('change', () => {
      const newMin = Math.max(5, parseInt(durationInput.value, 10) || GRADE_DEFAULT_MIN);
      setCellData(dia, idx, { subject, minutes: newMin, done });
      durationInput.value = newMin;
      updateDaySummary();
    });

    cell.querySelector('.chip-done-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      // lê o estado ATUAL do armazenamento (não o do closure, que ficava desatualizado
      // e impedia desmarcar) e re-renderiza a célula para refletir/rebindar corretamente
      const t = gradeGet();
      const cur = normalizeCell(t && t.grade[dia] && t.grade[dia][idx]);
      const newDone = !(cur && cur.done);
      setCellData(dia, idx, { subject, minutes: (cur && cur.minutes) || minutes, done: newDone });
      renderCellContent(cell);
      updateDaySummary();
      updateUncheckAllBtn(); // <- FIX: reflete no botão "Desmarcar concluídos"
    });

    cell.querySelector('.chip-remove').addEventListener('click', async () => {
      if (!await UI.confirm(`Remover "${subject}" desta célula da grade?`)) return;
      setCellData(dia, idx, null);
      cell.innerHTML = `<span class="grade-cell-empty-hint">+ escolher</span>`;
      bindCellClick(cell);
      updateDaySummary();
      updateUncheckAllBtn();
    });
    bindCellClick(cell); // clicar na sigla troca a matéria (ótimo p/ toque)
  }

  function setCellData(dia, idx, cellData) {
    const t = gradeGet();
    if (!Array.isArray(t.grade[dia])) t.grade[dia] = [];
    while (t.grade[dia].length <= idx) t.grade[dia].push(''); // garante slot p/ sessões dinâmicas
    t.grade[dia][idx] = cellData; // objeto {subject, minutes, done} ou null
    gradeSave(t);
  }

  function bindDropZones(container) {
    const tray = document.getElementById('grade-chip-tray');
    const cells = container.querySelectorAll('.grade-cell-drop');

    function handleDrop(e, targetDia, targetIdx) {
      e.preventDefault();
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (!data || !data.subject) return;

      // se veio de outra célula, libera a célula de origem — cada CÉLULA guarda 1 matéria,
      // mas a MESMA matéria pode aparecer em quantas células o usuário quiser
      if (data.from === 'cell' && data.fromDia && (data.fromDia !== targetDia || data.fromIdx !== targetIdx)) {
        setCellData(data.fromDia, data.fromIdx, null);
      }

      const minutes = data.minutes || GRADE_DEFAULT_MIN;
      // move preserva o status de conclusão; nova alocação da bandeja sempre começa pendente
      const done = data.from === 'cell' ? !!data.done : false;
      setCellData(targetDia, targetIdx, { subject: data.subject, minutes, done });
      renderGradeScreen(); // re-renderiza a grade para refletir a movimentação
    }

    cells.forEach(cell => {
      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (e) => {
        cell.classList.remove('drag-over');
        handleDrop(e, cell.dataset.dia, parseInt(cell.dataset.idx, 10));
      });
    });

    // soltar de volta na bandeja de chips remove a matéria daquela célula (sem excluí-la do ciclo)
    tray.addEventListener('dragover', (e) => { e.preventDefault(); tray.classList.add('drag-active'); });
    tray.addEventListener('dragleave', () => tray.classList.remove('drag-active'));
    tray.addEventListener('drop', (e) => {
      e.preventDefault();
      tray.classList.remove('drag-active');
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (data && data.from === 'cell') {
        setCellData(data.fromDia, data.fromIdx, null);
        renderGradeScreen();
      }
    });
  }

  // ---- Seletor de sigla por CLIQUE (ideal para mobile/tablet) ----
  function closeSiglaPicker() {
    const ex = document.getElementById('grade-sigla-picker');
    if (ex) ex.remove();
    document.removeEventListener('click', _pickerOutside, true);
  }
  function _pickerOutside(e) {
    const p = document.getElementById('grade-sigla-picker');
    if (p && !p.contains(e.target) && !e.target.closest('.grade-cell-drop')) closeSiglaPicker();
  }
  function openSiglaPicker(cell, dia, idx) {
    closeSiglaPicker();
    const items = gradeTrayItems();
    const cur = normalizeCell(gradeGet().grade[dia] && gradeGet().grade[dia][idx]);
    const pop = document.createElement('div');
    pop.id = 'grade-sigla-picker';
    pop.className = 'grade-sigla-picker';
    let html = `<div class="gsp-head">Escolher matéria</div><div class="gsp-list">`;
    if (items.length === 0) html += `<div class="gsp-empty">Cadastre matérias em Configurações.</div>`;
    else html += items.map(s => `
      <button type="button" class="gsp-opt ${cur && cur.subject === s.nome ? 'sel' : ''}" data-subject="${escapeHtml(s.nome)}">
        <span class="gsp-sigla" ${s.color ? `style="color:${s.color}"` : ''}>${escapeHtml(s.acronym)}</span>
        <span class="gsp-nome">${escapeHtml(s.nome)}</span>
      </button>`).join('');
    html += `</div>`;
    if (cur) html += `<button type="button" class="gsp-remove" data-remove="1">✕ Remover desta célula</button>`;
    pop.innerHTML = html;
    document.body.appendChild(pop);
    // posiciona perto da célula, mantendo dentro da tela
    const r = cell.getBoundingClientRect();
    const pw = Math.min(260, window.innerWidth - 20);
    pop.style.width = pw + 'px';
    let left = r.left + window.scrollX;
    if (left + pw > window.scrollX + window.innerWidth - 10) left = window.scrollX + window.innerWidth - pw - 10;
    if (left < window.scrollX + 10) left = window.scrollX + 10;
    let top = r.bottom + window.scrollY + 4;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    // se estourar embaixo, abre acima
    const ph = pop.getBoundingClientRect().height;
    if (r.bottom + ph > window.innerHeight - 10) pop.style.top = (r.top + window.scrollY - ph - 4) + 'px';

    pop.querySelectorAll('.gsp-opt').forEach(b => b.addEventListener('click', () => {
      const c = normalizeCell(gradeGet().grade[dia] && gradeGet().grade[dia][idx]);
      setCellData(dia, idx, { subject: b.dataset.subject, minutes: (c && c.minutes) || GRADE_DEFAULT_MIN, done: (c && c.done) || false });
      closeSiglaPicker();
      renderCellContent(cell); updateDaySummary(); updateUncheckAllBtn();
    }));
    const rm = pop.querySelector('[data-remove]');
    if (rm) rm.addEventListener('click', () => {
      setCellData(dia, idx, null);
      closeSiglaPicker();
      cell.innerHTML = `<span class="grade-cell-empty-hint">+ escolher</span>`;
      bindCellClick(cell);
      updateDaySummary(); updateUncheckAllBtn();
    });
    setTimeout(() => document.addEventListener('click', _pickerOutside, true), 0);
  }
  // liga o clique de "abrir seletor" numa célula (vazia ou no rótulo da sigla)
  function bindCellClick(cell) {
    const dia = cell.dataset.dia, idx = parseInt(cell.dataset.idx, 10);
    const empty = cell.querySelector('.grade-cell-empty-hint');
    if (empty) {
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => openSiglaPicker(cell, dia, idx));
    } else {
      const label = cell.querySelector('.chip-acronym-label');
      if (label) {
        label.style.cursor = 'pointer';
        label.title = 'Trocar matéria';
        label.addEventListener('click', (e) => { e.stopPropagation(); openSiglaPicker(cell, dia, idx); });
      }
    }
  }

  function updateDaySummary() {
    const tmpl = gradeGet();
    DIAS_SEMANA.forEach(dia => {
      const cellEl = document.querySelector(`.grade-summary-cell[data-summary-dia="${dia}"]`);
      if (!cellEl) return;
      const slots = (tmpl.grade[dia] || []).map(normalizeCell).filter(Boolean);
      const totalMin = slots.reduce((sum, s) => sum + (s.minutes || 0), 0);
      cellEl.textContent = totalMin > 0 ? CycleEngine.fmtHM(totalMin) : '—';
    });
    updateGradeBudget();
  }
  // [NOVO] Saldo de horas do ciclo: mostra a meta semanal, o total já alocado na grade
  // e o quanto ainda falta (ou o excedente). Atualiza a cada mudança de célula, para
  // você montar a semana sem trocar de tela.
  function gradeBudgetKey() { try { return DB._profilePrefix() + 'grade-budget-open'; } catch (_) { return 'diario-estudos:grade-budget-open'; } }
  function updateGradeBudget() {
    const host = document.getElementById('grade-budget');
    if (!host) return;
    let open = false; try { open = localStorage.getItem(gradeBudgetKey()) === '1'; } catch (_) { _quiet(_); }
    host.classList.toggle('hidden', !open);
    if (!open) return;
    const cyc = DB.getCurrentCycle();
    const last = DB.getLastCycleSetup && DB.getLastCycleSetup();
    const metaH = (cyc && cyc.weeklyHours) || (last && last.weeklyHours) || 0;
    const tmpl = gradeGet();
    let alocMin = 0;
    // minutos alocados na grade POR DISCIPLINA (para o detalhamento)
    const porDisc = {};
    DIAS_SEMANA.forEach(dia => { (tmpl.grade[dia] || []).map(normalizeCell).filter(Boolean).forEach(s => {
      alocMin += (s.minutes || 0);
      const nm = s.subject || '—';
      porDisc[nm] = (porDisc[nm] || 0) + (s.minutes || 0);
    }); });
    // meta POR DISCIPLINA vinda do ciclo (tempo definido de cada matéria), casada por nome
    const alvoDisc = {};
    const subsCiclo = (cyc && cyc.subjects) || (last && last.subjects) || [];
    subsCiclo.forEach(s => { if (s && s.nome != null) alvoDisc[CycleEngine.normKey(s.nome)] = (s.definidoMin || 0); });
    const metaMin = metaH * 60;
    const saldoMin = metaMin - alocMin;
    const pct = metaMin > 0 ? Math.min(100, Math.round(alocMin / metaMin * 100)) : 0;
    const over = metaMin > 0 && alocMin > metaMin;
    const tomSaldo = !metaMin ? '' : (saldoMin < 0 ? 'tone-bad' : (saldoMin === 0 ? 'tone-good' : 'tone-warn'));
    // Detalhamento por disciplina: sigla, alocado na grade e (se houver) a meta do ciclo.
    const nomesGrade = Object.keys(porDisc);
    // inclui matérias do ciclo que ainda não têm nenhuma célula na grade (alocado 0)
    subsCiclo.forEach(s => { if (s && s.nome && !nomesGrade.some(n => CycleEngine.normKey(n) === CycleEngine.normKey(s.nome))) nomesGrade.push(s.nome); });
    const discOrdenadas = nomesGrade.sort((a, b) => (porDisc[b] || 0) - (porDisc[a] || 0) || a.localeCompare(b, 'pt-BR'));
    const discHtml = discOrdenadas.length ? `
      <div class="gb-discs">
        <div class="gb-discs-head">Horas planejadas por disciplina</div>
        <div class="gb-discs-grid">
        ${discOrdenadas.map(nome => {
          const aloc = porDisc[nome] || 0;
          const alvo = alvoDisc[CycleEngine.normKey(nome)];
          const cor = CycleEngine.colorForSubject(nome) || 'var(--accent)';
          const sig = CycleEngine.siglaForSubject(nome);
          const temAlvo = (alvo != null && alvo > 0);
          const cheio = temAlvo && aloc >= alvo;
          const excedente = temAlvo && aloc > alvo;
          // a barra PREENCHE até a carga desejada: cheia = meta batida (verde),
          // parcial = ainda falta (cor da disciplina), excedente = passou (âmbar).
          const barPct = temAlvo ? Math.min(100, Math.round(aloc / alvo * 100)) : (alocMin > 0 ? Math.round(aloc / alocMin * 100) : 0);
          const fill = excedente ? 'var(--warn)' : (cheio ? 'var(--good)' : cor);
          const valTom = excedente ? 'tone-warn' : (cheio ? 'tone-good' : '');
          const titulo = temAlvo ? (cheio ? 'meta de ' + CycleEngine.fmtHM(alvo) + ' atingida' : barPct + '% da meta de ' + CycleEngine.fmtHM(alvo)) : escapeHtml(nome);
          return `
            <div class="gb-disc-row">
              <span class="gb-disc-sig" style="color:${cor};" title="${escapeHtml(nome)}">${escapeHtml(sig)}</span>
              <div class="gb-disc-bar" title="${titulo}"><i style="width:${barPct}%;background:${fill};"></i></div>
              <span class="gb-disc-val ${valTom}">${CycleEngine.fmtHM(aloc)}${temAlvo ? ' <small>/ ' + CycleEngine.fmtHM(alvo) + '</small>' : ''}${excedente ? ' <em>+' + CycleEngine.fmtHM(aloc - alvo) + '</em>' : ''}</span>
            </div>`;
        }).join('')}
        </div>
        ${Object.keys(alvoDisc).length ? '<p class="gb-hint" style="margin:9px 0 0;">A barra enche até a carga definida de cada matéria no ciclo · verde = meta batida.</p>' : ''}
      </div>` : '';
    if (!metaMin) {
      host.innerHTML = `<div class="gb-top"><div class="gb-item"><span class="gb-k">Alocado</span><span class="gb-v">${CycleEngine.fmtHM(alocMin)}</span></div>
        <p class="gb-hint" style="margin:0;">Defina a carga horária semanal ao montar o ciclo para ver o saldo total.</p></div>${discHtml}`;
      return;
    }
    host.innerHTML = `
      <div class="gb-top">
        <div class="gb-item"><span class="gb-k">Meta semanal</span><span class="gb-v">${CycleEngine.fmtHM(metaMin)}</span></div>
        <div class="gb-item"><span class="gb-k">Alocado</span><span class="gb-v">${CycleEngine.fmtHM(alocMin)}</span></div>
        <div class="gb-item"><span class="gb-k">${saldoMin < 0 ? 'Excedente' : 'Saldo'}</span><span class="gb-v ${tomSaldo}">${(saldoMin < 0 ? '+' : '') + CycleEngine.fmtHM(Math.abs(saldoMin))}</span></div>
        <div class="gb-bar-wrap">
          <div class="gb-bar"><i class="${over ? 'over' : ''}" style="width:${pct}%"></i></div>
          <p class="gb-hint">${over ? '⚠ Você alocou mais que a meta do ciclo.' : (saldoMin === 0 ? '✓ Grade fechada exatamente na meta.' : 'Faltam ' + CycleEngine.fmtHM(saldoMin) + ' para atingir a meta.')}</p>
        </div>
      </div>
      ${discHtml}`;
  }

  function renderActiveCycle() {
    const cycle = DB.getCurrentCycle();
    if (!cycle) return;
    const _expired = todayLocal() > cycle.endDate;
    const _nota = _expired ? ' · ⚠ semana encerrada — feche para arquivar e iniciar a próxima' : '';
    $id('ciclo-active-dates').textContent =
      `${formatDateShort(cycle.startDate)} — ${formatDateShort(cycle.endDate)} · ${CycleEngine.fmtWeeklyHours(cycle.weeklyHours)} planejadas` + _nota;
    renderOverviewGauges(cycle);
    renderSubjectsProgress(cycle);
  }

  // Renderiza a TELA da Grade Semanal (bandeja + grade), independente do ciclo.
  /* ---- Visão da Grade: 'semana' (grade completa) | 'dia' (só a meta diária) ---- */
  function gradeViewMode() { return gradePrefGet('grade-view', null, 'semana') === 'dia' ? 'dia' : 'semana'; }
  function setGradeViewMode(v) { gradePrefSet('grade-view', v === 'dia' ? 'dia' : 'semana'); }

  // Nome do dia da semana de hoje, no vocabulário interno da grade
  function _todayWeekdayName() {
    return ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][new Date().getDay()];
  }

  // Visão "Meta diária": lista compacta com o alvo de cada dia (total + matérias planejadas).
  function renderGradeDaily() {
    const container = document.getElementById('ciclo-grade');
    if (!container) return;
    const tmpl = gradeGet();
    const days = gradeDaysOrder();
    const hoje = _todayWeekdayName();
    const html = days.map(dia => {
      const slots = (tmpl.grade[dia] || []).map(normalizeCell).filter(Boolean);
      const totalMin = slots.reduce((s, c) => s + (c.minutes || 0), 0);
      /* A meta diaria mostrava tudo com a mesma cara: nao dava para saber o que
         ja foi feito sem voltar para a visao semanal. Agora o que esta marcado
         como concluido vem em VERDE, com o visto — e o cabecalho do dia diz
         quantas das sessoes ja sairam. */
      const feitos = slots.filter(c => c.done).length;
      const diaCompleto = slots.length > 0 && feitos === slots.length;
      const chips = slots.map(c => {
        const cor = CycleEngine.colorForSubject(c.subject) || 'var(--accent)';
        const sig = CycleEngine.siglaForSubject(c.subject);
        const feito = !!c.done;
        return `<span class="gd-chip ${feito ? 'is-done' : ''}"${feito ? '' : ` style="color:${cor};"`} title="${escapeHtml(c.subject)}${feito ? ' — concluída' : ''}">${feito ? '<span class="gd-chip-check">✓</span>' : ''}${escapeHtml(sig)} <small>${CycleEngine.fmtHM(c.minutes || 0)}</small></span>`;
      }).join('');
      const isToday = dia === hoje;
      return `
        <div class="gd-day ${isToday ? 'is-today' : ''} ${diaCompleto ? 'is-complete' : ''}">
          <div class="gd-day-head">
            <span class="gd-day-name">${dia}${isToday ? '<span class="gd-today-tag">hoje</span>' : ''}${diaCompleto ? '<span class="gd-done-tag">✓ concluído</span>' : ''}</span>
            <span class="gd-day-total ${totalMin === 0 ? 'zero' : ''}">${slots.length ? `<span class="gd-day-count ${feitos ? 'has' : ''}">${feitos}/${slots.length}</span>` : ''}${totalMin === 0 ? '— sem meta' : CycleEngine.fmtHM(totalMin)}</span>
          </div>
          ${slots.length ? `<div class="gd-chips">${chips}</div>` : `<p class="gd-empty">Nenhuma matéria planejada para este dia.</p>`}
        </div>`;
    }).join('');
    container.innerHTML = `<div class="grade-daily">${html}</div>`;
  }

  // Alterna a exibição entre a grade semanal completa e a meta diária.
  function applyGradeView() {
    const mode = gradeViewMode();
    const trayBar = document.getElementById('grade-tray-bar');
    const scrollHint = document.getElementById('grade-scroll-hint');
    const minAlert = document.querySelector('#screen-grade .grade-min-alert');
    document.querySelectorAll('#grade-view-toggle .gvt-btn').forEach(b => {
      const on = b.dataset.gview === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    // o item "Siglas" so faz sentido na visao semanal (a bandeja arrastavel)
    const trayItem = document.getElementById('btn-toggle-tray');
    if (trayItem) trayItem.style.display = (mode === 'dia') ? 'none' : '';
    if (mode === 'dia') {
      if (trayBar) trayBar.style.display = 'none';
      if (scrollHint) scrollHint.style.display = 'none';
      if (minAlert) minAlert.style.display = 'none';
      renderGradeDaily();
    } else {
      if (trayBar) trayBar.style.display = '';
      if (scrollHint) scrollHint.style.display = '';
      if (minAlert) minAlert.style.display = '';
      renderChipTray();
      renderGrade();
      if (typeof window._applyGradeTray === 'function') window._applyGradeTray();
    }
  }

  function renderGradeScreen() {
    const ws = document.getElementById('grade-weekstart-select');
    if (ws) ws.value = gradeWeekStart();
    applyGradeView();
    // o gerenciador só é renderizado quando o modal abre (renderCustomSiglaManager)
  }
  // exposto para a navegação abrir a tela e para o botão de atalho do ciclo
  window.GradeScreen = { render: renderGradeScreen };

  // Gerenciador de siglas: MATÉRIAS (sigla auto editável) + siglas livres customizadas.
  function renderCustomSiglaManager() {
    const box = document.getElementById('custom-sigla-manager');
    if (!box) return;
    const subjects = DB.getActiveSubjects();
    const freeSiglas = DB.getCustomSiglas().filter(c => !c.nome);
    let html = '';

    // 1) Matérias — a sigla vem automática, mas é editável (salva como customizada vinculada)
    if (subjects.length) {
      html += `<p class="section-label" style="margin:16px 0 8px;">Siglas das matérias <span class="opt" style="text-transform:none;letter-spacing:0;font-weight:400;">— edite a sigla ou a cor</span></p>`;
      html += subjects.map(s => {
        const sig = CycleEngine.siglaForSubject(s.nome);
        const col = CycleEngine.colorForSubject(s.nome) || '#4f46e5';
        return `
          <div class="custom-sigla-row" data-subject="${escapeHtml(s.nome)}">
            <span class="custom-sigla-swatch" style="background:${col}"></span>
            <input type="text" class="cs-sigla" value="${escapeHtml(sig)}" maxlength="12" title="Sigla da matéria" aria-label="Sigla da matéria">
            <span class="cs-subject-name" title="${escapeHtml(s.nome)}">${escapeHtml(s.nome)}</span>
            <input type="color" class="cs-color" value="${col}" title="Cor" aria-label="Cor">
            <button type="button" class="icon-btn cs-reset" title="Voltar à sigla automática" aria-label="Voltar à sigla automática">↺</button>
          </div>`;
      }).join('');
    }

    // 2) Siglas livres (etiquetas próprias, sem matéria vinculada)
    if (freeSiglas.length) {
      html += `<p class="section-label" style="margin:18px 0 8px;">Siglas livres</p>`;
      html += freeSiglas.map(c => `
        <div class="custom-sigla-row" data-id="${c.id}">
          <span class="custom-sigla-swatch" style="background:${c.color}"></span>
          <input type="text" class="cs-sigla" value="${escapeHtml(c.sigla)}" maxlength="12" title="Sigla" aria-label="Sigla">
          <input type="text" class="cs-nome" value="${escapeHtml(c.nome || '')}" placeholder="Descrição (opcional)" title="Descrição" aria-label="Descrição">
          <input type="color" class="cs-color" value="${c.color || '#4f46e5'}" title="Cor" aria-label="Cor">
          <button type="button" class="icon-btn danger cs-del" title="Excluir sigla" aria-label="Excluir sigla">×</button>
        </div>`).join('');
    }

    box.innerHTML = html;
    const refresh = () => { renderChipTray(); renderGrade(); renderCustomSiglaManager(); };

    // --- linhas de matéria ---
    box.querySelectorAll('.custom-sigla-row[data-subject]').forEach(row => {
      const nome = row.dataset.subject;
      const commit = () => {
        const sigla = row.querySelector('.cs-sigla').value.trim();
        const color = row.querySelector('.cs-color').value;
        if (!sigla) { showToast('A sigla não pode ficar vazia'); refresh(); return; }
        DB.upsertSubjectSigla(nome, { sigla, color });
        refresh();
      };
      row.querySelector('.cs-sigla').addEventListener('change', commit);
      row.querySelector('.cs-color').addEventListener('change', commit);
      row.querySelector('.cs-reset').addEventListener('click', () => {
        // remove a customização da matéria → volta à sigla automática
        const cs = DB.getCustomSiglas().find(c => c.nome && CycleEngine.normKey(c.nome) === CycleEngine.normKey(nome));
        if (cs) DB.removeCustomSigla(cs.id);
        showToast('Sigla automática restaurada');
        refresh();
      });
    });

    // --- linhas de siglas livres ---
    box.querySelectorAll('.custom-sigla-row[data-id]').forEach(row => {
      const id = row.dataset.id;
      const commit = () => {
        DB.updateCustomSigla(id, {
          sigla: row.querySelector('.cs-sigla').value.trim(),
          nome: row.querySelector('.cs-nome').value.trim(),
          color: row.querySelector('.cs-color').value
        });
        refresh();
      };
      row.querySelector('.cs-sigla').addEventListener('change', commit);
      row.querySelector('.cs-nome').addEventListener('change', commit);
      row.querySelector('.cs-color').addEventListener('change', commit);
      row.querySelector('.cs-del').addEventListener('click', async () => {
        if (!await UI.confirm('Excluir esta sigla livre? As células da grade que a usam não são afetadas.')) return;
        DB.removeCustomSigla(id);
        refresh();
      });
    });
  }

  // criar nova sigla customizada
  const _addSiglaBtn = document.getElementById('btn-add-sigla');
  if (_addSiglaBtn) _addSiglaBtn.addEventListener('click', () => {
    const sigla = $id('new-sigla-input').value.trim();
    const nome = $id('new-sigla-nome').value.trim();
    if (!sigla) { showToast('Digite a sigla'); return; }
    DB.addCustomSigla({ sigla, nome });
    $id('new-sigla-input').value = '';
    $id('new-sigla-nome').value = '';
    renderChipTray(); renderGrade(); renderCustomSiglaManager();
    showToast('Sigla criada ✓');
  });

  // atalho do ciclo -> abre a Grade Semanal
  const _gotoGrade = document.getElementById('btn-goto-grade');
  if (_gotoGrade) _gotoGrade.addEventListener('click', () => switchScreen('grade'));

  // --- Modal de gerenciar siglas ---
  function openSiglasModal() {
    renderCustomSiglaManager();
    $id('siglas-modal').style.display = 'flex';
  }
  function closeSiglasModal() {
    $id('siglas-modal').style.display = 'none';
    renderChipTray(); renderGrade(); // reflete edições na bandeja/grade ao fechar
  }
  const _editSiglas = document.getElementById('btn-edit-siglas');
  if (_editSiglas) _editSiglas.addEventListener('click', openSiglasModal);
  // início da semana (segunda/domingo) — só reordena a exibição
  const _wsSel = document.getElementById('grade-weekstart-select');
  if (_wsSel) {
    _wsSel.value = gradeWeekStart();
    // renderGradeDaily tambem depende da ordem dos dias: applyGradeView cobre as duas visoes
    _wsSel.addEventListener('change', () => { setGradeWeekStart(_wsSel.value); applyGradeView(); });
  }
  const _mClose = document.getElementById('siglas-modal-close');
  if (_mClose) _mClose.addEventListener('click', closeSiglasModal);
  const _mDone = document.getElementById('siglas-modal-done');
  if (_mDone) _mDone.addEventListener('click', closeSiglasModal);
  const _modal = document.getElementById('siglas-modal');
  /* fundo desfocado nao fecha o modal: so o X / Concluido / Esc fecham */

  // --- Desmarcar todos os concluídos da grade ---
  function countDoneCells() {
    const t = gradeGet(); let n = 0;
    DIAS_SEMANA.forEach(d => (t.grade[d] || []).forEach(c => { const nc = normalizeCell(c); if (nc && nc.done) n++; }));
    return n;
  }
  function updateUncheckAllBtn() {
    const btn = document.getElementById('btn-uncheck-all');
    if (!btn) return;
    const n = countDoneCells();
    // botão SEMPRE visível (descoberta), apenas desabilitado quando não há nada a desmarcar
    btn.disabled = n === 0;
    btn.style.opacity = n === 0 ? '0.5' : '';
    const lbl = n > 0 ? `Desmarcar ${n} concluído${n === 1 ? '' : 's'}` : 'Desmarcar concluídos';
    btn.innerHTML = `<span class="gg-ic">↺</span>${lbl}`;
  }
  // minimizar/expandir a bandeja de siglas (lembra a preferência)
  // [NOVO] Botão que mostra/oculta o saldo de horas do ciclo na Grade (estado salvo por perfil).
  const _budgetBtn = document.getElementById('btn-toggle-budget');
  if (_budgetBtn) _budgetBtn.addEventListener('click', () => {
    let open = false; try { open = localStorage.getItem(gradeBudgetKey()) === '1'; } catch (_) { _quiet(_); }
    DB.setRaw(gradeBudgetKey(), open ? '0' : '1');
    try { if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange(); } catch (_) { _quiet(_); }
    _budgetBtn.classList.toggle('active', !open);
    updateGradeBudget();
  });
  const _trayBtn = document.getElementById('btn-toggle-tray');
  const _trayBar = document.getElementById('grade-tray-bar');
  const _applyTray = () => {
    const collapsed = gradeTrayCollapsed();
    if (_trayBar) _trayBar.classList.toggle('tray-collapsed', collapsed);
    if (_trayBtn) {
      _trayBtn.classList.toggle('is-collapsed', collapsed);
      _trayBtn.innerHTML = `<span class="gg-ic">${collapsed ? '▸' : '▾'}</span>${collapsed ? 'Siglas (mostrar)' : 'Siglas (minimizar)'}`;
      _trayBtn.title = collapsed ? 'Mostrar as siglas arrastáveis' : 'Ocultar as siglas arrastáveis';
    }
  };
  window._applyGradeTray = _applyTray; // reaplicado sempre que a tela da grade é aberta
  if (_trayBtn) _trayBtn.addEventListener('click', () => {
    setGradeTrayCollapsed(!gradeTrayCollapsed());
    _applyTray();
  });
  _applyTray();
  const _uncheckBtn = document.getElementById('btn-uncheck-all');
  if (_uncheckBtn) _uncheckBtn.addEventListener('click', async () => {
    const n = countDoneCells();
    if (n === 0) { showToast('Nenhuma célula marcada como concluída'); return; }
    if (!await UI.confirm(`Desmarcar as ${n} célula(s) concluída(s)?\n\nAs matérias e durações da grade são mantidas.`,
      { title: '↺ Desmarcar concluídos', okText: 'Desmarcar' })) return;
    try { if (window.VersionHistory) await VersionHistory.antesDe('desmarcar a grade'); } catch (_) { _quiet(_); }
    const t = gradeGet();
    DIAS_SEMANA.forEach(d => {
      if (!Array.isArray(t.grade[d])) return;
      t.grade[d].forEach((c, i) => { const nc = normalizeCell(c); if (nc && nc.done) { nc.done = false; t.grade[d][i] = nc; } });
    });
    gradeSave(t);
    renderGrade();
    showToast('Concluídos desmarcados ✓');
  });
  // Limpar grade: esvazia TODAS as células (mantém o nº de sessões), para remontar do zero.
  // As siglas/matérias cadastradas não são apagadas — só saem da grade.
  const _clearGradeBtn = document.getElementById('btn-clear-grade');
  if (_clearGradeBtn) _clearGradeBtn.addEventListener('click', async () => {
    const t = gradeGet();
    let ocupadas = 0;
    DIAS_SEMANA.forEach(d => (t.grade[d] || []).forEach(c => { if (normalizeCell(c)) ocupadas++; }));
    if (ocupadas === 0) { showToast('A grade já está vazia'); return; }
    if (!await UI.confirmTyped(`Limpar toda a grade?\n\nAs ${ocupadas} matéria(s) alocadas serão removidas das células. As siglas cadastradas são mantidas.`,
      { word: 'LIMPAR', title: '🗑️ Limpar grade inteira', okText: 'Limpar grade' })) return;
    // foto de seguranca ANTES de esvaziar: e exatamente este o caso de "limpei sem querer"
    try { if (window.VersionHistory) await VersionHistory.antesDe('limpar a grade'); } catch (_) { _quiet(_); }
    const n = sessionCount(t);
    DIAS_SEMANA.forEach(d => { t.grade[d] = Array.from({ length: n }, () => ''); });
    gradeSave(t);
    renderGrade();
    showToast('Grade limpa — monte do zero ✓');
  });

  /* ---- Engrenagem de opções da grade (agrupa os comandos secundários) ---- */
  (function () {
    const gbtn = document.getElementById('grade-gear-btn');
    const gmenu = document.getElementById('grade-gear-menu');
    if (!gbtn || !gmenu) return;
    const closeGear = () => {
      gmenu.classList.remove('open'); gbtn.classList.remove('open');
      gbtn.setAttribute('aria-expanded', 'false'); gmenu.setAttribute('aria-hidden', 'true');
      document.removeEventListener('click', onDoc, true);
    };
    const onDoc = (e) => { if (!gmenu.contains(e.target) && e.target !== gbtn && !gbtn.contains(e.target)) closeGear(); };
    gbtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = gmenu.classList.toggle('open');
      gbtn.classList.toggle('open', open);
      gbtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      gmenu.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) setTimeout(() => document.addEventListener('click', onDoc, true), 0);
      else document.removeEventListener('click', onDoc, true);
    });
    // fecha ao escolher um item (mas deixa o clique do próprio item executar antes)
    gmenu.querySelectorAll('.grade-gear-item').forEach(it => it.addEventListener('click', () => setTimeout(closeGear, 0)));
    /* O seletor de visao mora dentro do menu agora: escolher "Semanal" ou
       "Meta diaria" e uma decisao final, entao o menu se fecha junto. Ja o
       select de inicio da semana NAO fecha — quem esta ajustando isso costuma
       querer conferir o resultado com o menu ainda aberto. */
    const vt = gmenu.querySelector('#grade-view-toggle');
    if (vt) vt.addEventListener('click', (e) => { if (e.target.closest('.gvt-btn')) setTimeout(closeGear, 0); });
  })();

  /* ---- Item 1: seletor de visão (Semanal / Meta diária) ---- */
  const _viewToggle = document.getElementById('grade-view-toggle');
  if (_viewToggle) _viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.gvt-btn');
    if (!btn) return;
    setGradeViewMode(btn.dataset.gview);
    applyGradeView();
  });

  /* ---- Item 2: grades salvas (salvar / trocar / restaurar) ---- */
  function renderSavedGradesList() {
    const box = document.getElementById('saved-grades-list');
    if (!box) return;
    const list = DB.getSavedGrades();
    if (!list.length) {
      box.innerHTML = `<p class="sg-empty">Nenhuma grade salva ainda. Dê um nome acima e clique em <strong>Salvar grade atual</strong>.</p>`;
      return;
    }
    box.innerHTML = list.slice().reverse().map(s => {
      let ocupadas = 0;
      DIAS_SEMANA.forEach(d => (s.grade[d] || []).forEach(c => { if (normalizeCell(c)) ocupadas++; }));
      const dt = s.createdAt ? new Date(s.createdAt).toLocaleDateString('pt-BR') : '';
      return `<div class="sg-item" data-id="${s.id}">
        <div class="sg-info">
          <div class="sg-name">${escapeHtml(s.nome)}</div>
          <div class="sg-meta">${ocupadas} matéria(s) · ${s.sessions || 3} sessões${dt ? ' · ' + dt : ''}</div>
        </div>
        <div class="sg-actions">
          <button type="button" class="btn-secondary" data-sg-load="${s.id}" title="Substituir a grade atual por esta">↺ Restaurar</button>
          <button type="button" class="btn-secondary" data-sg-over="${s.id}" title="Atualizar esta grade salva com a grade atual">⭯ Atualizar</button>
          <button type="button" class="btn-secondary" data-sg-ren="${s.id}" title="Renomear" aria-label="Renomear">✎</button>
          <button type="button" class="btn-secondary" data-sg-del="${s.id}" title="Excluir" aria-label="Excluir">🗑️</button>
        </div>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-sg-load]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.sgLoad;
      const s = DB.getSavedGrades().find(x => x.id === id);
      if (!s) return;
      if (!await UI.confirm(`Restaurar a grade "${s.nome}"? A grade atual será substituída (salve-a antes se quiser mantê-la).`)) return;
      DB.applySavedGrade(id);
      applyGradeView();
      renderSavedGradesList();
      showToast('Grade restaurada ✓');
    }));
    box.querySelectorAll('[data-sg-over]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.sgOver;
      const s = DB.getSavedGrades().find(x => x.id === id);
      if (!s) return;
      if (!await UI.confirm(`Atualizar "${s.nome}" com a grade atual? O conteúdo salvo anterior será sobrescrito.`)) return;
      DB.overwriteSavedGrade(id);
      renderSavedGradesList();
      showToast('Grade salva atualizada ✓');
    }));
    box.querySelectorAll('[data-sg-ren]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.sgRen;
      const s = DB.getSavedGrades().find(x => x.id === id);
      if (!s) return;
      const v = await UI.prompt([{ key: 'nome', label: 'Novo nome da grade', value: s.nome }], { title: 'Renomear grade', okText: 'Renomear' });
      if (!v || v.nome == null) return;
      DB.renameSavedGrade(id, v.nome);
      renderSavedGradesList();
    }));
    box.querySelectorAll('[data-sg-del]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.sgDel;
      const s = DB.getSavedGrades().find(x => x.id === id);
      if (!s) return;
      if (!await UI.confirm(`Excluir a grade salva "${s.nome}"? Isto não altera a grade atual em uso.`)) return;
      DB.deleteSavedGrade(id);
      renderSavedGradesList();
      showToast('Grade salva excluída');
    }));
  }
  function openSavedGrades() {
    const m = document.getElementById('saved-grades-modal');
    if (!m) return;
    renderSavedGradesList();
    const inp = document.getElementById('new-saved-grade-name');
    if (inp) inp.value = '';
    m.style.display = 'flex';
  }
  function closeSavedGrades() { const m = document.getElementById('saved-grades-modal'); if (m) m.style.display = 'none'; }
  const _savedBtn = document.getElementById('btn-saved-grades');
  if (_savedBtn) _savedBtn.addEventListener('click', openSavedGrades);
  const _savedClose = document.getElementById('saved-grades-close');
  if (_savedClose) _savedClose.addEventListener('click', closeSavedGrades);
  const _savedDone = document.getElementById('saved-grades-done');
  if (_savedDone) _savedDone.addEventListener('click', closeSavedGrades);
  const _saveCurBtn = document.getElementById('btn-save-current-grade');
  if (_saveCurBtn) _saveCurBtn.addEventListener('click', async () => {
    const inp = document.getElementById('new-saved-grade-name');
    const nome = (inp && inp.value.trim()) || ('Grade ' + new Date().toLocaleDateString('pt-BR'));
    let ocupadas = 0;
    const t = gradeGet();
    DIAS_SEMANA.forEach(d => (t.grade[d] || []).forEach(c => { if (normalizeCell(c)) ocupadas++; }));
    if (ocupadas === 0 && !await UI.confirm('A grade atual está vazia. Salvar mesmo assim?')) return;
    DB.addSavedGrade(nome);
    if (inp) inp.value = '';
    renderSavedGradesList();
    showToast('Grade atual salva ✓');
  });
  const _savedModal = document.getElementById('saved-grades-modal');
  /* fundo desfocado nao fecha o modal: so o X / Cancelar / Esc fecham */

  on('btn-close-cycle', 'click', async () => {
    const cycle = DB.getCurrentCycle();
    if (!cycle) return;
    if (!await UI.confirm('Ela será salva no histórico permanentemente e uma nova semana começará zerada.\n\nOs registros de estudo não são apagados — continuam contando em Evolução e Conquistas.',
      { title: '✓ Fechar semana', sub: 'Encerrar o ciclo atual e arquivá-lo', okText: 'Fechar semana' })) return;
    try { if (window.VersionHistory) await VersionHistory.antesDe('fechar a semana'); } catch (_) { _quiet(_); }

    // a semana no histórico usa exatamente o intervalo definido no ciclo (início → término)
    const realEndDate = cycle.endDate || CycleEngine.weekEndDate(cycle.startDate);

    /* O snapshot arquivado é EXATAMENTE o que a tela mostrava ao vivo: mesma
       função, mesmo intervalo (startDate → realEndDate), mesmas matérias.
       Fechar a semana não altera mais nenhum número. */
    const entries = DB.getEntries().filter(e => e.date >= cycle.startDate && e.date <= realEndDate);
    const prog = CycleEngine.progressoSemana(cycle.subjects, cycle.startDate, realEndDate);

    const snapshot = {
      id: Date.now(),
      startDate: cycle.startDate,
      endDate: realEndDate,
      weeklyHours: cycle.weeklyHours,
      subjects: prog.subjects,
      grade: JSON.parse(JSON.stringify(gradeGet().grade)),
      sessions: gradeGet().sessions,
      totalTargetMin: prog.totalTargetMin,
      totalStudiedMin: prog.totalStudiedMin,
      pctCumprido: prog.pctCumprido,
      finalizadas: prog.finalizadas,
      totalSubjects: prog.totalSubjects,
      avgPerformancePct: CycleEngine.aproveitamentoNoPeriodo(cycle.startDate, realEndDate, entries),
      closedAt: new Date().toISOString()
    };

    DB.saveCycleToHistory(snapshot);
    DB.clearCurrentCycle();
    showToast('Semana fechada e salva no histórico ✓');
    showState('empty');
    HistoricoScreen.render();
  });

  // inicialização
  function init() {
    const cycle = DB.getCurrentCycle();
    if (cycle) {
      renderActiveCycle();
      showState('active');
    } else {
      showState('empty');
    }
  }

  window.addEventListener('screen:activated', (e) => {
    if (e.detail.screen === 'ciclo') init();
  });
  // recalcula progresso automaticamente quando um estudo é registrado, editado ou excluído
  window.addEventListener('data:entry-added', () => {
    if (DB.getCurrentCycle()) renderActiveCycle();
  });
  window.addEventListener('data:entry-changed', () => {
    if (DB.getCurrentCycle()) renderActiveCycle();
  });

  init();
})();
