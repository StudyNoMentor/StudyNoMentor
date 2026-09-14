/* ═══════════════════════════════════════════════════════════════════════════
   ATIVIDADES EXTRAS — PAINEL OPERACIONAL v51
   ---------------------------------------------------------------------------
   Camada de apresentação sobre a tela existente. Mantém o contrato funcional
   de ExtrasScreen/DB e reorganiza a leitura para responder quatro perguntas:
   o que fazer hoje, o que ficou realmente pendente, o que vem a seguir e o
   que foi concluído recentemente.

   Regra importante: recorrências e a fila automática do reforço NÃO viram
   "atrasadas". Só uma atividade avulsa explicitamente vinculada a uma data
   passada pode entrar nessa fila.
   ═══════════════════════════════════════════════════════════════════════════ */
(() => {
  if (typeof ExtrasScreen === 'undefined') return;

  const ExtrasModern = {
    view: 'all',
    janelaProximas: 7,
    janelaConcluidas: 7,
    passoMais: 50,
    _limites: Object.create(null),

    limiteBase(k) {
      // No overview não há razão para montar centenas de cards fora do viewport.
      // Concluídas já nasce recolhida, então começa ainda mais enxuta. Ao filtrar
      // uma seção diretamente, mostramos uma janela maior de uma vez.
      if (this.view === k) return 80;
      return k === 'concluidas' ? 15 : 50;
    },

    fatiar(k, arr) {
      const limite = this._limites[k] || this.limiteBase(k);
      return { itens: arr.slice(0, limite), faltam: Math.max(0, arr.length - limite), limite };
    },

    addDays(iso, n) {
      const d = new Date(iso + 'T00:00:00');
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    fonte(x) {
      try {
        if (typeof ReforcoFila !== 'undefined' && ReforcoFila.eGerenciado && ReforcoFila.eGerenciado(x)) return 'reforco';
      } catch (_) { _quiet(_); }
      if (x && x.origemPlano && x.origemPlano.topico) return 'plano';
      return 'manual';
    },

    coletar(screen) {
      const hoje = todayLocal();
      const extras = DB._extrasReadSnapshot || DB.getExtras();
      const pendHoje = screen.occurrencesForDay(hoje)
        .filter(x => !DB.extraConcluidaEm(x, hoje))
        .map(x => ({ x, day: hoje, bucket: 'hoje' }));

      // Só tarefas avulsas com data explícita viram atraso. Recorrência não
      // acumula dívida e o reforço automático se replaneja sozinho.
      const atrasadas = [];
      extras.forEach(x => {
        if (!x || x.status === 'concluida' || DB.extraRecorrente(x)) return;
        try {
          if (typeof ReforcoFila !== 'undefined' && ReforcoFila.eGerenciado && ReforcoFila.eGerenciado(x)) return;
        } catch (_) { _quiet(_); }
        const dias = (x.datas || []).filter(d => d && d < hoje).sort().reverse();
        const d = dias.find(dia => !DB.extraConcluidaEm(x, dia));
        if (d) atrasadas.push({ x, day: d, bucket: 'atrasadas' });
      });

      // Próximas: uma única ocorrência futura por atividade para não transformar
      // recorrências diárias em sete linhas idênticas.
      const proximasMap = new Map();
      for (let i = 1; i <= this.janelaProximas; i++) {
        const day = this.addDays(hoje, i);
        screen.occurrencesForDay(day).forEach(x => {
          if (DB.extraConcluidaEm(x, day) || proximasMap.has(x.id)) return;
          proximasMap.set(x.id, { x, day, bucket: 'proximas' });
        });
      }
      const proximas = [...proximasMap.values()];

      // Lista curta de concluídas: mostra a ocorrência mais recente por
      // atividade, mas a métrica conta todas as ocorrências encerradas.
      const concluidasMap = new Map();
      let concluidas7d = 0;
      for (let i = 0; i < this.janelaConcluidas; i++) {
        const day = this.addDays(hoje, -i);
        screen.occurrencesForDay(day).forEach(x => {
          if (!DB.extraConcluidaEm(x, day)) return;
          concluidas7d++;
          if (!concluidasMap.has(x.id)) concluidasMap.set(x.id, { x, day, bucket: 'concluidas' });
        });
      }
      const concluidas = [...concluidasMap.values()];

      const ativos = extras.filter(x => x && x.status !== 'concluida');
      const fontes = {
        reforco: ativos.filter(x => this.fonte(x) === 'reforco').length,
        plano: ativos.filter(x => this.fonte(x) === 'plano').length,
        manual: ativos.filter(x => this.fonte(x) === 'manual').length
      };

      return {
        hoje,
        pendHoje,
        atrasadas,
        proximas,
        concluidas,
        concluidas7d,
        fontes,
        tempoHoje: screen._minInDay ? screen._minInDay(hoje) : 0
      };
    },

    filtroFonte(entry) {
      if (this.view === 'reforco' || this.view === 'plano' || this.view === 'manual') {
        return this.fonte(entry.x) === this.view;
      }
      return true;
    },

    grupos(c) {
      const base = [
        ['hoje', 'Hoje', '🗓️', c.pendHoje],
        ['atrasadas', 'Atrasadas', '⚠️', c.atrasadas],
        ['proximas', 'Próximas', '◷', c.proximas],
        ['concluidas', 'Concluídas recentemente', '✓', c.concluidas]
      ];
      return base
        .filter(([k]) => {
          if (this.view === 'all' || this.view === 'reforco' || this.view === 'plano' || this.view === 'manual') return true;
          return this.view === k;
        })
        .map(([k, titulo, ico, arr]) => [k, titulo, ico, arr.filter(e => this.filtroFonte(e))]);
    },

    chip(view, label, n, tone) {
      return `<button type="button" class="exm-chip ${this.view === view ? 'active' : ''} ${tone || ''}" data-exm-view="${view}">
        <span>${label}</span><b>${n}</b>
      </button>`;
    },

    decorarAgenda(screen, c) {
      const host = document.getElementById('extras-agenda');
      if (!host) return;
      const card = host.querySelector('.cal-card');
      if (!card) return;
      card.classList.add('exm-agenda-card');

      const h2 = card.querySelector('.card-header h2');
      const sub = card.querySelector('.card-header .sub');
      if (h2) h2.textContent = 'Atividades extras';
      if (sub) sub.textContent = 'Organize o que complementa seu plano sem misturar execução diária, pendências reais e próximos passos.';

      const densidade = (typeof ReforcoFila !== 'undefined' && ReforcoFila.limiteDisciplinasDia) ? ReforcoFila.limiteDisciplinasDia() : 1;
      const cargaPadrao = (typeof ReforcoFila !== 'undefined' && ReforcoFila.prefs) ? ReforcoFila.prefs() : { blocoMin: 10, blocoMax: 25 };
      const old = card.querySelector('.exm-dashboard');
      if (old) old.remove();
      const dash = document.createElement('div');
      dash.className = 'exm-dashboard';
      dash.innerHTML = `
        <div class="exm-stats">
          <div class="exm-stat exm-stat-today"><span>🗓️</span><div><small>Hoje</small><strong>${c.pendHoje.length}</strong><em>atividade${c.pendHoje.length === 1 ? '' : 's'}</em></div></div>
          <div class="exm-stat exm-stat-late"><span>!</span><div><small>Atrasadas</small><strong>${c.atrasadas.length}</strong><em>avulsa${c.atrasadas.length === 1 ? '' : 's'}</em></div></div>
          <div class="exm-stat exm-stat-done"><span>✓</span><div><small>Concluídas · 7 dias</small><strong>${c.concluidas7d}</strong><em>ocorrência${c.concluidas7d === 1 ? '' : 's'}</em></div></div>
          <div class="exm-stat exm-stat-time"><span>◷</span><div><small>Tempo hoje</small><strong>${CycleEngine.fmtHM(c.tempoHoje)}</strong><em>registrado</em></div></div>
        </div>
        <div class="exm-filters" role="group" aria-label="Filtrar atividades extras">
          ${this.chip('all', 'Todas', c.pendHoje.length + c.atrasadas.length + c.proximas.length + c.concluidas.length)}
          ${this.chip('hoje', 'Hoje', c.pendHoje.length)}
          ${this.chip('atrasadas', 'Atrasadas', c.atrasadas.length, 'danger')}
          ${this.chip('proximas', 'Planejadas', c.proximas.length)}
          ${this.chip('concluidas', 'Concluídas', c.concluidas.length, 'good')}
          ${this.chip('reforco', 'Reforço', c.fontes.reforco)}
          ${this.chip('manual', 'Manuais', c.fontes.manual)}
          ${this.chip('plano', 'Plano', c.fontes.plano)}
        </div>
        <div class="exm-rotation">
          <div class="exm-rotation-copy">
            <strong>Cadência do reforço</strong>
            <small>Espalha as matérias para favorecer alternância e revisão. O dia de hoje não é reescrito; a mudança reorganiza só o futuro.</small>
          </div>
          <label for="exm-ref-disciplinas-dia">Disciplinas por dia
            <select id="exm-ref-disciplinas-dia">
              <option value="1" ${densidade === 1 ? 'selected' : ''}>1 · mais espaçado</option>
              <option value="2" ${densidade === 2 ? 'selected' : ''}>2 · mais intenso</option>
            </select>
          </label>
        </div>
        <div class="exm-load">
          <div class="exm-rotation-copy"><strong>Faixa de questões por reforço</strong><small>Controla as próximas parcelas diárias. O mínimo é preferencial quando o saldo permite; o máximo é respeitado. O dia atual não é reescrito.</small></div>
          <label>Mínimo <input id="exm-ref-min" type="number" min="1" max="100" value="${cargaPadrao.blocoMin}"></label>
          <label>Máximo <input id="exm-ref-max" type="number" min="1" max="100" value="${cargaPadrao.blocoMax}"></label>
          <button type="button" class="btn-secondary" id="exm-ref-salvar">Salvar padrão</button>
          <button type="button" class="btn-secondary" id="exm-ref-aplicar-todos">Aplicar a todos</button>
        </div>`;
      const head = card.querySelector('.card-header');
      if (head) head.insertAdjacentElement('afterend', dash);

      dash.querySelectorAll('[data-exm-view]').forEach(b => b.addEventListener('click', () => {
        this.view = b.dataset.exmView || 'all';
        this._limites = Object.create(null);
        screen.selDay = todayLocal();
        screen.render();
      }));
      const cad = dash.querySelector('#exm-ref-disciplinas-dia');
      if (cad && typeof ReforcoFila !== 'undefined' && ReforcoFila.salvarPrefs) cad.addEventListener('change', () => {
        ReforcoFila.salvarPrefs({ disciplinasDia: Number(cad.value) === 2 ? 2 : 1 });
        screen.selDay = todayLocal();
        screen.render();
        showToast(`Rodízio ajustado para ${cad.value} disciplina(s) por dia ✓`);
      });
      const minEl = dash.querySelector('#exm-ref-min'), maxEl = dash.querySelector('#exm-ref-max');
      const valoresCarga = () => [Number(minEl && minEl.value), Number(maxEl && maxEl.value)];
      const salvarCarga = dash.querySelector('#exm-ref-salvar');
      if (salvarCarga && typeof ReforcoFila !== 'undefined') salvarCarga.addEventListener('click', () => {
        const [mi, ma] = valoresCarga(); ReforcoFila.salvarPrefs({ blocoMin: mi, blocoMax: ma });
        showToast('Padrão de carga atualizado ✓'); screen.render();
      });
      const aplicarTodos = dash.querySelector('#exm-ref-aplicar-todos');
      if (aplicarTodos && typeof ReforcoFila !== 'undefined') aplicarTodos.addEventListener('click', () => {
        const [mi, ma] = valoresCarga(); ReforcoFila.aplicarCargaTodos(mi, ma);
        showToast('Faixa aplicada a todos os reforços ativos ✓'); screen.render();
      });

      const carga = card.querySelector('#ex-filters-btn');
      if (carga) carga.textContent = '⏱️ Filtros e carga';
    },

    badgeStatus(entry) {
      const hoje = todayLocal();
      if (entry.bucket === 'atrasadas') return ['Atrasada', 'late'];
      if (entry.bucket === 'concluidas') return ['Concluída', 'done'];
      if (entry.day === hoje) return ['Hoje', 'today'];
      return [formatDateShort(entry.day), 'planned'];
    },

    decorarCards(list, entries) {
      const byKey = new Map(entries.map(e => [`${e.x.id}@${e.day}`, e]));
      list.querySelectorAll('.exd').forEach(card => {
        const key = `${card.dataset.id}@${card.dataset.day}`;
        const entry = byKey.get(key);
        const x = entry && entry.x;
        if (!entry || !x) return;

        const fonte = this.fonte(x);
        card.classList.add('exm-task', `is-${entry.bucket}`, `source-${fonte}`);
        const main = card.querySelector('.exd-main');
        if (main && !main.querySelector('.exm-card-meta')) {
          const meta = document.createElement('div');
          meta.className = 'exm-card-meta';
          const tipoDef = ExtrasScreen.TIPOS[x.tipo];
          const tipo = tipoDef ? tipoDef.nome : '';
          const bits = [];
          if (x.disciplina) bits.push(escapeHtml(x.disciplina));
          if (tipo) bits.push(escapeHtml(tipo));
          bits.push(entry.bucket === 'atrasadas' ? `prevista ${escapeHtml(formatDateShort(entry.day))}` :
            entry.day === todayLocal() ? 'execução de hoje' : escapeHtml(formatDateShort(entry.day)));
          meta.innerHTML = bits.join(' <span>·</span> ');
          const title = main.querySelector('.exd-title');
          if (title) title.insertAdjacentElement('afterend', meta);
        }

        const tags = card.querySelector('.exd-tags');
        if (tags && !tags.querySelector('.exm-status')) {
          const [rot, cls] = this.badgeStatus(entry);
          const fonteRot = fonte === 'reforco' ? 'Reforço' : (fonte === 'plano' ? 'Plano' : 'Manual');
          tags.insertAdjacentHTML('afterbegin',
            `<span class="extra-tag exm-source ${fonte}">${fonteRot}</span>` +
            `<span class="extra-tag exm-status ${cls}">${rot}</span>`);
        }

        const reg = card.querySelector('.exd-reg-btn');
        if (reg) reg.textContent = 'Registrar progresso';
        const more = card.querySelector('.exd-reg-more');
        if (more) more.textContent = '＋ Registrar parcial';
      });
    },

    cardsPorDisciplina(arr, screen) {
      if (!arr.length) return '';
      const discs = [...new Set(arr.map(e => e.x.disciplina || ''))];
      if (discs.length < 2) return arr.map(e => screen.cardHtml(e.x, e.day)).join('');
      return discs.map(d => {
        const nome = d ? escapeHtml(d) : 'Sem disciplina';
        const cards = arr.filter(e => (e.x.disciplina || '') === d)
          .map(e => screen.cardHtml(e.x, e.day)).join('');
        return `<div class="extras-disc-title exm-disc-title">${nome}</div>${cards}`;
      }).join('');
    },

    secao(k, titulo, ico, arr, screen) {
      if (!arr.length) return '';
      const fatia = this.fatiar(k, arr);
      const cards = this.cardsPorDisciplina(fatia.itens, screen);
      const mais = fatia.faltam ? `<div class="exm-more-row">
        <span>Mostrando ${fatia.itens.length} de ${arr.length}</span>
        <button type="button" class="btn-secondary" data-exm-more="${k}">Mostrar mais ${Math.min(this.passoMais, fatia.faltam)}</button>
      </div>` : '';
      if (k === 'concluidas' && this.view !== 'concluidas') {
        return `<details class="exm-section exm-section-${k}">
          <summary><span class="exm-section-title">${ico} ${titulo}</span><span class="exm-section-count">${arr.length}</span><span class="chev">⌄</span></summary>
          <div class="exm-section-body">${cards}${mais}</div>
        </details>`;
      }
      return `<section class="exm-section exm-section-${k}">
        <div class="exm-section-head"><span class="exm-section-title">${ico} ${titulo}</span><span class="exm-section-count">${arr.length}</span></div>
        <div class="exm-section-body">${cards}${mais}</div>
      </section>`;
    },

    renderOverview(screen, c) {
      const list = document.getElementById('extras-list');
      if (!list) return;
      const grupos = this.grupos(c);
      const entries = grupos.flatMap(g => g[3]);

      if (!entries.length) {
        list.innerHTML = `<div class="extras-empty exm-empty"><div class="big">✓</div>Nenhuma atividade neste filtro.</div>`;
        return;
      }
      list.innerHTML = grupos.map(([k, t, i, arr]) => this.secao(k, t, i, arr, screen)).join('');
      screen.bind(list);
      this.decorarCards(list, entries);
      list.querySelectorAll('[data-exm-more]').forEach(btn => btn.addEventListener('click', () => {
        const k = btn.dataset.exmMore;
        const atual = this._limites[k] || this.limiteBase(k);
        this._limites[k] = atual + this.passoMais;
        // Não recalcula calendário/Plano/agenda: só expande a fatia já coletada.
        this.renderOverview(screen, c);
      }));
    },

    decorarDiaSelecionado(screen) {
      const list = document.getElementById('extras-list');
      if (!list) return;
      const day = screen.selDay || todayLocal();
      const entries = screen.occurrencesForDay(day).map(x => ({
        x, day, bucket: DB.extraConcluidaEm(x, day) ? 'concluidas' : (day < todayLocal() ? 'atrasadas' : (day === todayLocal() ? 'hoje' : 'proximas'))
      }));
      this.decorarCards(list, entries);
    },

    reorganizar() {
      const screen = document.getElementById('screen-extras');
      const curso = document.getElementById('extras-curso');
      const toolbar = screen && screen.querySelector('.extras-toolbar');
      if (screen && curso && toolbar && curso.nextElementSibling !== toolbar) {
        screen.insertBefore(curso, toolbar);
      }
      if (toolbar) toolbar.classList.add('exm-toolbar');
    },

    aplicar(screen) {
      this.reorganizar();
      const c = this.coletar(screen);
      this.decorarAgenda(screen, c);
      if ((screen.selDay || todayLocal()) === todayLocal()) this.renderOverview(screen, c);
      else this.decorarDiaSelecionado(screen);
    }
  };

  const renderOriginal = ExtrasScreen.render;
  ExtrasScreen.render = function () {
    // Uma única fotografia alimenta a tela-base E a apresentação moderna. A tela
    // moderna substitui o overview de hoje, portanto sinalizamos à base para não
    // construir a mesma árvore de cards duas vezes.
    const snapshot = DB.getExtras();
    DB._extrasReadSnapshot = snapshot;
    this._modernOverviewPass = (this.selDay || todayLocal()) === todayLocal();
    let ret;
    try { ret = renderOriginal.apply(this, arguments); }
    finally { this._modernOverviewPass = false; }
    DB._extrasReadSnapshot = snapshot;
    try { ExtrasModern.aplicar(this); } catch (e) { _quiet(e, 'extras-modern'); }
    finally { DB._extrasReadSnapshot = null; }
    return ret;
  };

  window.ExtrasModern = ExtrasModern;
})();
