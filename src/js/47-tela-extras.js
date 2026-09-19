/* ============================================================
   TELA: ATIVIDADES EXTRAS (metas paralelas)
   ============================================================ */
const ExtrasScreen = {
  _editingId: null,
  TIPOS: {
    anki: { ico: '🃏', nome: 'Anki', unidade: 'cards' },
    leitura: { ico: '📜', nome: 'Lei seca', unidade: 'paginas' },
    questoes: { ico: '❓', nome: 'Questões', unidade: 'questoes' },
    revisao: { ico: '🔁', nome: 'Revisão', unidade: 'sessoes' },
    video: { ico: '🎬', nome: 'Vídeo', unidade: 'min' },
    livre: { ico: '⭐', nome: 'Livre', unidade: 'itens' }
  },
  // dia selecionado da "missão do dia" (padrão: hoje)
  selDay: null,
  _showFilters: undefined,
  _fStart: null, _fEnd: null,
  _addMoreFor: null,   // "id@dia" cujo card está com o input de "registrar mais" aberto
  PAGE_SIZE: 100,
  _occCache: new Map(),
  _CHECK: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  render() {
    // caches estritamente de uma pintura: nenhuma informação atravessa um render.
    this._motorRefCard = null;
    this._occCache = new Map();
    const extras = DB.getExtras();
    DB._extrasReadSnapshot = extras;
    // toggle global
    const gt = document.getElementById('extras-global-toggle');
    if (gt) gt.classList.toggle('on', DB.extrasCountGlobal());
    const summary = document.getElementById('extras-summary');
    if (summary) { summary.innerHTML = ''; summary.style.display = 'none'; }  // topo agora vive na agenda
    const list = document.getElementById('extras-list');
    const hoje = todayLocal();
    // Bug corrigido (contexto): ao trocar de planejamento/perfil, o dia e a janela
    // do calendário ficavam presos no contexto anterior. Reseta para hoje quando o
    // contexto muda, para nunca exibir a data de outro planejamento.
    let ctx = 'p'; try { ctx = DB._profilePrefix() + '|' + DB._activePlanId(); } catch (_) { _quiet(_); }
    if (this._ctxKey !== ctx) {
      this._ctxKey = ctx; this.selDay = hoje; this._calStart = this._addDays(hoje, -3); this._addMoreFor = null;
      this._dayPageKey = null; this._dayLimit = this.PAGE_SIZE; this._cursoLimit = this.PAGE_SIZE;
    }
    // se a data selecionada ficou no futuro por navegação, ainda é válida; só garante um valor
    if (!this.selDay) this.selDay = hoje;
    this.renderAgenda(); // calendário + cabeçalho do dia + carga horária + filtros
    this.renderEmCurso();  // tudo o que está aberto, em todas as disciplinas
    if (extras.length === 0) {
      list.innerHTML = `<div class="extras-empty"><div class="big">✅</div>Nenhuma atividade extra ainda.<br>Clique em <strong>＋ Nova atividade</strong> para começar, ou <strong>🔁 Gerenciar</strong> para criar recorrências.</div>`;
      this._syncManage();
      DB._extrasReadSnapshot = null;
      return;
    }
    // A camada moderna substitui o overview de hoje. Evita pintar 100+ cards
    // aqui e repintá-los de novo logo depois; agenda e reforços já estão prontos.
    if (this._modernOverviewPass && this.selDay === hoje) {
      list.innerHTML = '';
      this._syncManage();
      return;
    }
    const day = this.selDay;
    const todasOcc = this.occurrencesForDay(day);
    if (todasOcc.length === 0) {
      const ehHoje = day === hoje;
      const futuro = day > hoje;
      const dica = futuro
        ? 'Vincule atividades a este dia no calendário para planejar com antecedência.'
        : (ehHoje
          ? 'Crie uma atividade ou uma recorrência em <strong>🔁 Gerenciar</strong>.'
          : 'Nenhum registro ou atividade neste dia.');
      list.innerHTML = `<div class="extras-empty"><div class="big">🗓️</div>Nada em <strong>${escapeHtml(this._prettyDay(day))}</strong>.<br>${dica}${!ehHoje ? '<br><button type="button" class="btn-secondary" id="ex-empty-hoje" style="margin-top:14px;">→ Ir para hoje</button>' : ''}</div>`;
      const bh = document.getElementById('ex-empty-hoje');
      if (bh) bh.addEventListener('click', () => { this.selDay = hoje; this._calStart = this._addDays(hoje, -3); this.render(); });
      this._syncManage();
      DB._extrasReadSnapshot = null;
      return;
    }
    const pageKey = ctx + '|' + day;
    if (this._dayPageKey !== pageKey) { this._dayPageKey = pageKey; this._dayLimit = this.PAGE_SIZE; }
    const occ = todasOcc.slice(0, this._dayLimit || this.PAGE_SIZE);
    const aFazer = occ.filter(x => !DB.extraConcluidaEm(x, day));
    const feitas = occ.filter(x => DB.extraConcluidaEm(x, day));
    const grupos = [['A fazer', aFazer], ['Concluídas', feitas]];
    /* Com quatro assuntos de três disciplinas no mesmo dia, a lista plana vira
       uma pilha: você lê tudo para achar o que é de Administrativo. Agrupar por
       disciplina só quando há MAIS DE UMA evita o outro extremo — um título de
       grupo sobre uma linha só é ruído com cara de organização. */
    const porDisc = (arr) => {
      const discs = [...new Set(arr.map(x => x.disciplina || ''))];
      if (discs.length < 2) return arr.map(x => this.cardHtml(x, day)).join('');
      return discs.map(d => `<div class="extras-disc-title">${d ? escapeHtml(d) : 'Sem disciplina'}</div>` +
        arr.filter(x => (x.disciplina || '') === d).map(x => this.cardHtml(x, day)).join('')).join('');
    };
    list.innerHTML = grupos.map(([titulo, arr]) => {
      if (!arr.length) return '';
      return `<div class="extras-group-title">${titulo} (${arr.length})</div>` + porDisc(arr);
    }).join('') + (occ.length < todasOcc.length
      ? `<div class="hint" style="padding:16px 0;text-align:center;"><button type="button" class="btn-secondary" id="extras-load-more">Mostrar mais ${Math.min(this.PAGE_SIZE, todasOcc.length - occ.length)} · ${occ.length} de ${todasOcc.length}</button></div>` : '');
    this.bind(list);
    const mais = document.getElementById('extras-load-more');
    if (mais) mais.addEventListener('click', () => { this._dayLimit = (this._dayLimit || this.PAGE_SIZE) + this.PAGE_SIZE; this.render(); });
    this._syncManage();
    DB._extrasReadSnapshot = null;
  },
  /* ── REFORÇOS EM CURSO ────────────────────────────────────────────────────
     Tudo o que está aberto, agrupado por disciplina, com o progresso que vem
     dos retratos. É a resposta a "o que eu tenho em andamento?" — que a agenda
     do dia não responde, porque ela só sabe de hoje.

     O RITMO É DERIVADO, NÃO AGENDADO. A tentação era amarrar cada atividade a
     um dia do calendário, e ela cria uma dor pior: dívida vencida. Você não
     estudou terça, e terça fica lá, atrasada, cobrando manutenção — duas
     semanas assim e o calendário vira uma lista de culpa. Aqui o ritmo é uma
     divisão feita na hora: o que falta, dividido pelos dias até a próxima
     importação. Ficou um dia sem estudar? O número de amanhã sobe sozinho.
     Nada vence, nada acumula, nada precisa ser arrumado. */
  renderEmCurso() {
    const host = document.getElementById('extras-curso');
    if (!host) return;
    /* Marcado apenas pelo caminho de ABERTURA da tela, que já agendou esta
       mesma função para o quadro seguinte. Sair aqui evita fazer o trabalho
       duas vezes — e sem apagar o host, senão o esqueleto que acabou de ser
       pintado sumiria antes de o cálculo começar. */
    if (this._pularEmCurso) return;
    const extrasMotor = DB.getExtras().filter(e => typeof MotorCiclo !== 'undefined' && MotorCiclo.origemDe(e) && MotorCiclo.origemDe(e).topico && e.status !== 'concluida');
    if (!extrasMotor.length) { host.innerHTML = ''; return; }
    let itens = [];
    try { itens = MotorCiclo.emCurso(); }
    catch (e) { _quiet(e, 'curso-motor'); }
    if (!itens.length) { host.innerHTML = ''; return; }
    const aberto = this._cursoAberto !== false;
    const totalFalta = itens.reduce((a, v) => a + Math.max(0, v.alvo - v.feito), 0);
    const totalAlvo = itens.reduce((a, v) => a + v.alvo, 0);
    const feito = totalAlvo - totalFalta;
    const discsTotal = [...new Set(itens.map(v => v.origem.disciplina || 'Sem disciplina'))];
    const visiveis = itens.slice(0, this._cursoLimit || this.PAGE_SIZE);
    const discs = [...new Set(visiveis.map(v => v.origem.disciplina || 'Sem disciplina'))];
    /* Dias até a próxima importação. O horizonte não é mais um número que
       alguém precisa configurar: ele sai do SEU histórico de importações — a
       mediana do intervalo entre os retratos que você já trouxe. Quem importa
       de quinze em quinze dias vê o bloco espalhado em quinze; quem importa
       uma vez por mês, em trinta. Sem retrato suficiente para medir, trinta
       dias é o palpite declarado. */
    let dias = 0;
    try {
      const snaps = DB.getTecSnapshots() || [];
      const fim = (s2) => s2 && (s2.endDate || s2.date || s2.startDate);
      const gaps = [];
      for (let i = 1; i < snaps.length; i++) {
        const a = fim(snaps[i - 1]), b = fim(snaps[i]);
        if (!a || !b) continue;
        const d = Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
        if (d > 0) gaps.push(d);
      }
      gaps.sort((x, y) => x - y);
      const cadencia = gaps.length ? gaps[gaps.length >> 1] : 30;
      const ult = snaps[snaps.length - 1];
      const idade = ult && fim(ult) ? Math.max(0, Math.floor((new Date(todayLocal() + 'T00:00:00') - new Date(fim(ult) + 'T00:00:00')) / 86400000)) : 0;
      dias = Math.max(1, cadencia - idade);
    } catch (e) { _quiet(e, 'curso-dias'); }
    const porDia = Math.max(1, Math.ceil(totalFalta / dias));
    const SELO = {
      resolvida: ['✅', 'tone-good', 'lacuna fechada'],
      rotacionada: ['🔄', 'tone-good', 'saiu do grupo prioritário'],
      rodada: ['✓', 'incid', 'rodada cumprida'],
      aguardando: ['⏳', 'incid', 'aguardando novo retrato'],
      andamento: ['▶', 'incid', 'em andamento'],
      orfa: ['❓', '', 'sem correspondência no TEC']
    };
    const linha = (v) => {
      const [ic, tom, rot] = SELO[v.estado] || SELO.andamento;
      const falta = Math.max(0, v.alvo - v.feito);
      const evo = (v.origem.taxaInicial != null && v.taxa != null)
        ? `${v.origem.taxaInicial.toFixed(0)}% → <b class="tone-${v.delta != null && v.delta >= 0 ? 'good' : 'bad'}">${v.taxa.toFixed(0)}%</b>` : '';
      return `<li data-id="${escapeHtml(v.extra.id)}">
        <div class="pl-ciclo-top">
          <span class="pl-ciclo-nome">${escapeHtml(v.origem.topico)}</span>
          <span class="reforco-tag ${tom}">${ic} ${rot}</span>
        </div>
        <div class="pl-ciclo-barra"><i style="width:${v.pct}%"></i></div>
        <div class="pl-ciclo-nums">
          <span><b>${v.feito}</b>/${v.alvo} questões</span>
          ${falta > 0 ? `<span>faltam <b>${falta}</b></span>` : '<span class="tone-good">alvo cumprido</span>'}
          ${evo ? `<span>${evo}</span>` : ''}
        </div>
        <div class="exc-acoes">
          <button type="button" class="pl-ciclo-acao" data-curso-dia="${escapeHtml(v.extra.id)}">Fazer hoje</button>
          <button type="button" class="pl-ciclo-acao" data-curso-fim="${escapeHtml(v.extra.id)}">Concluir</button>
          <button type="button" class="pl-ciclo-acao" data-curso-del="${escapeHtml(v.extra.id)}">Excluir</button>
        </div>
      </li>`;
    };
    host.innerHTML = `
      <div class="card exc-card">
        <button type="button" class="exc-head" id="exc-toggle" aria-expanded="${aberto}">
          <span class="exc-tit">🏁 Reforços em curso</span>
          <span class="exc-resumo">${itens.length} em ${discsTotal.length} ${discsTotal.length === 1 ? 'disciplina' : 'disciplinas'} ·
            <b>${feito}</b>/${totalAlvo} questões${totalFalta > 0 ? ` · <b>~${porDia}/dia</b> até a próxima importação (${dias} ${dias === 1 ? 'dia' : 'dias'})` : ''}</span>
          <span class="chev">${aberto ? '▴' : '▾'}</span>
        </button>
        ${aberto ? discs.map(d => `
          <div class="exc-grupo">
            <p class="exc-disc">${escapeHtml(d)}</p>
            <ul class="pl-ciclo-lista">${visiveis.filter(v => (v.origem.disciplina || 'Sem disciplina') === d).map(linha).join('')}</ul>
          </div>`).join('') : ''}
        ${aberto && visiveis.length < itens.length ? `<div class="hint" style="padding:12px 16px;text-align:center;"><button type="button" class="btn-secondary" id="exc-load-more">Mostrar mais ${Math.min(this.PAGE_SIZE, itens.length - visiveis.length)} · ${visiveis.length} de ${itens.length}</button></div>` : ''}
      </div>`;
    const tg = document.getElementById('exc-toggle');
    if (tg) tg.addEventListener('click', () => { this._cursoAberto = !aberto; this.renderEmCurso(); });
    const maisCurso = document.getElementById('exc-load-more');
    if (maisCurso) maisCurso.addEventListener('click', () => { this._cursoLimit = (this._cursoLimit || this.PAGE_SIZE) + this.PAGE_SIZE; this.renderEmCurso(); });
    /* "Fazer hoje" é o agendamento MANUAL que sobrou: a exceção para quem quer
       fixar um assunto num dia, sem que isso vire regra para todos. */
    host.querySelectorAll('[data-curso-dia]').forEach(b => b.addEventListener('click', () => {
      const executar = () => {
        DB.toggleExtraData(b.dataset.cursoDia, todayLocal());
        this.selDay = todayLocal(); showToast('Marcada para hoje ✓'); this.render();
      };
      if (window.WorkFeedback) WorkFeedback.run(b, 'Organizando…', executar, { region: '#extras-curso', context: 'extras-curso-hoje' });
      else executar();
    }));
    host.querySelectorAll('[data-curso-fim]').forEach(b => b.addEventListener('click', () => {
      const executar = () => {
        DB.setConcluidaDia(b.dataset.cursoFim, todayLocal(), true);
        showToast('Concluída ✓'); this.render();
      };
      if (window.WorkFeedback) WorkFeedback.run(b, 'Concluindo…', executar, { region: '#extras-curso', context: 'extras-curso-concluir' });
      else executar();
    }));
    host.querySelectorAll('[data-curso-del]').forEach(b => b.addEventListener('click', async () => {
      const e = DB.getExtras().find(x => x.id === b.dataset.cursoDel);
      if (!e) return;
      if (!await UI.confirm('Excluir "' + e.titulo + '"?', { title: 'Excluir atividade', okText: 'Excluir', danger: true })) return;
      const executar = () => { DB.deleteExtra(e.id); showToast('Atividade excluída'); this.render(); };
      if (window.WorkFeedback) WorkFeedback.run(b, 'Excluindo…', executar, { region: '#extras-curso', context: 'extras-curso-excluir' });
      else executar();
    }));
  },
  // ── Ocorrências de um dia ──────────────────────────────────────────────
  // Recorrentes: aparecem no dia se ele foi gerado (datas) OU, sem datas geradas,
  // se bate a cadência dentro da janela. Avulsas: aparecem nos dias vinculados;
  // se não têm nenhum dia vinculado, aparecem HOJE como pendência até concluir.
  occurrencesForDay(day) {
    if (this._occCache && this._occCache.has(day)) return this._occCache.get(day);
    const hoje = todayLocal();
    const extras = DB._extrasReadSnapshot || DB.getExtras();
    const occ = extras.filter(x => {
      const datas = x.datas || [];
      if (DB.extraRecorrente(x)) {
        if ((x.excluidasEm || []).includes(day)) return false;
        if (datas.length) return datas.includes(day);
        return this._recurOnDay(x, day);
      }
      if (datas.length) return datas.includes(day);
      const temHistoricoNoDia = (x.historico || []).some(h => h.data === day);
      if (temHistoricoNoDia) return true;
      if (day === hoje && x.status !== 'concluida') return true;
      if (day === hoje) return true;
      return false;
    });
    if (this._occCache) this._occCache.set(day, occ);
    return occ;
  },
  _recurOnDay(x, day) {
    const inicio = (x.dataInicio && String(x.dataInicio).trim())
      || (x.createdAt ? String(x.createdAt).slice(0, 10) : null);
    if (inicio && day < inicio) return false;
    if (x.dataFim && day > x.dataFim) return false;
    if (x.periodo === 'diaria') return true;
    const base = inicio || day;
    const d1 = new Date(base + 'T00:00:00'), d2 = new Date(day + 'T00:00:00');
    const diff = Math.round((d2 - d1) / 86400000);
    if (diff < 0) return false;
    if (x.periodo === 'semanal') return diff % 7 === 0;
    if (x.periodo === 'quinzenal') return diff % 14 === 0;
    if (x.periodo === 'mensal') {
      const ultimo = new Date(d2.getFullYear(), d2.getMonth() + 1, 0).getDate();
      return d2.getDate() === Math.min(d1.getDate(), ultimo);
    }
    return false;
  },
  // ── Carga horária (minutos) ────────────────────────────────────────────
  _minInDay(day) {
    return (DB._extrasReadSnapshot || DB.getExtras()).reduce((s, x) => {
      const emMin = (x.unidade === 'min' || x.tipo === 'video');
      return s + (x.historico || []).filter(h => h.data === day)
        .reduce((a, h) => a + (h.minutos || (emMin ? (h.quantidade || 0) : 0)), 0);
    }, 0);
  },
  _minInRange(a, b) {
    return (DB._extrasReadSnapshot || DB.getExtras()).reduce((s, x) => {
      const emMin = (x.unidade === 'min' || x.tipo === 'video');
      return s + (x.historico || []).filter(h => h.data >= a && h.data <= b)
        .reduce((acc, h) => acc + (h.minutos || (emMin ? (h.quantidade || 0) : 0)), 0);
    }, 0);
  },
  _minTotal() {
    return (DB._extrasReadSnapshot || DB.getExtras()).reduce((s, x) => {
      const emMin = (x.unidade === 'min' || x.tipo === 'video');
      return s + (x.historico || []).reduce((a, h) => a + (h.minutos || (emMin ? (h.quantidade || 0) : 0)), 0);
    }, 0);
  },
  _prettyDay(day) {
    const d = new Date(day + 'T00:00:00');
    const wd = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][d.getDay()];
    const mes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][d.getMonth()];
    return `${wd}, ${String(d.getDate()).padStart(2, '0')} de ${mes}`;
  },
  _syncManage() {
    const m = document.getElementById('extras-manage-modal');
    if (m && m.style.display === 'flex') this.renderManageList();
  },
  /* ── PUXAR DO MOTOR ───────────────────────────────────────────────────────
     A fila daqui é a MESMA do 🧭 Motor de sugestão: mesma travessia
     hierárquica, mesma régua e mesma fase. O diálogo só deixa escolher quais
     frentes executar hoje. Cada frente mantém sua própria dose útil; marcar
     mais uma não espreme as anteriores até virar atividade simbólica. */
  puxarDoMotor() {
    if (typeof MotorSugestao === 'undefined' || typeof DesempenhoTecScreen === 'undefined') { showToast('Motor indisponível'); return; }
    const motorPrefsIni = MotorSugestao.prefs();
    this._motorDiscSel = new Set(Array.isArray(motorPrefsIni.disciplinasSel) ? motorPrefsIni.disciplinasSel : []); // vazio = todas
    this._motorDiscOpen = false;
    this._motorSel = new Set();
    this._motorRecalc = () => {
      const r = MotorSugestao.calcular();
      if (!r || r.erro) { this._motorCand = null; this._motorErr = (r && r.erro) || 'erro'; return; }
      /* A DEDUPLICAÇÃO É POR DISCIPLINA + NOME, como no resto do app. Comparar
         só o nome fazia criar "Atos" de Administrativo esconder o "Atos" de
         Constitucional deste diálogo: dois assuntos de verdade, um deles sem
         porta nenhuma para virar atividade. E uma atividade JÁ CONCLUÍDA não
         bloqueia: o assunto pode ter voltado a cair, e atacá-lo de novo é o
         uso normal do app, não uma duplicata. */
      const abertas = DB.getExtras().filter(e => typeof MotorCiclo !== 'undefined' && MotorCiclo.origemDe(e) && e.status !== 'concluida');
      const disciplinasEmCurso = new Set(abertas.map(e => ReforcoEngine.norm((MotorCiclo.origemDe(e) || {}).disciplina || '')).filter(Boolean));
      const jaTem = (x) => disciplinasEmCurso.has(ReforcoEngine.norm(x.disciplina || ''))
        || !!MotorCiclo.atividadeSobreposta(x.nome, x.disciplina, x.membros);
      this._motorPrefs = r.prefs;
      this._motorFase = r.fase;
      this._motorDiscOrder = (r.disciplinas || []).map(d => d.nome);
      this._motorDiscsDisponiveis = (r.disciplinasDisponiveis || []).slice();
      this._motorCand = (r.todos || []).filter(x => !jaTem(x)).slice(0, 240);
      /* A recomendação da aba Motor pode já ter atividade aberta. Nesse caso,
         não deixamos um "buraco" entre recomendação 1 e 3: dentro da mesma
         disciplina pegamos a primeira frente seguinte que ainda está livre.
         A ordem das MATÉRIAS continua a mesma; só avançamos a fila interna. */
      const disponivel = new Map();
      this._motorCand.forEach(x => {
        const d = ReforcoEngine.norm(x.disciplina || '');
        if (d && !disponivel.has(d)) disponivel.set(d, x);
      });
      this._motorFila = [];
      (r.disciplinas || []).slice(0, r.prefs.maxFrentes || 3).forEach(d => {
        const x = disponivel.get(ReforcoEngine.norm(d.nome || ''));
        if (x) this._motorFila.push(x.disciplina + '\u0001' + x.nome);
      });
      this._motorErr = null;
    };
    this._motorRecalc();
    if (this._motorErr) {
      showToast(this._motorErr === 'sem-incidencia'
        ? 'O pós-edital precisa da incidência da banca. Importe-a em Desempenho TEC → Incidência.'
        : this._motorErr === 'sem-retrato'
          ? 'Importe um retrato do TEC em Desempenho TEC → Análise'
          : 'Sem dados suficientes para o motor ainda');
      return;
    }
    if (!this._motorCand.length) { showToast('Todas as frentes prioritárias já têm atividade'); return; }
    /* Nascem marcadas exatamente as frentes que o Motor colocaria na rodada de
       hoje — a tela de Extras não pode discordar da aba do Motor. */
    this._motorSelecionarRecomendadas();

    // HTML fixo do diálogo (a lista e o dropdown de disciplinas são preenchidos por JS)
    const body = `
      <p class="hint" style="margin:0 0 10px;">Este diálogo usa exatamente o mesmo 🧭 Motor e o mesmo filtro de disciplinas da tela TEC. Primeiro ele escolhe até <b>${this._motorPrefs.maxFrentes} matéria(s)</b> pela maior distância simples até a meta${this._motorFase === 'pos' ? '; a incidência da banca só desempata' : ''}; depois pega <b>uma frente de cada</b>, seguindo a fila hierárquica da matéria. As recomendadas ficam juntas no topo; alternativas ficam agrupadas logo abaixo.</p>
      <div class="pl-modal-tools">
        <div class="pl-modal-field" style="position:relative;">
          <span>Disciplinas</span>
          <button type="button" class="pl-disc-toggle" id="pl-disc-toggle">Todas <span class="chev">▾</span></button>
          <div class="pl-disc-panel" id="pl-disc-panel" style="display:none;"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px;">
        <span class="hint" id="pl-conta" style="margin:0;flex:1;min-width:0;"></span>
        <button type="button" class="btn-secondary" id="pl-marcar" style="white-space:nowrap;padding:5px 10px;">Usar recomendadas</button>
        <button type="button" class="btn-secondary" id="pl-limpar" style="white-space:nowrap;padding:5px 10px;">Limpar</button>
      </div>
      <div style="max-height:42vh;overflow:auto;" id="pl-lista"></div>`;

    new Promise((resolve) => {
      UI._resolve = resolve; UI._mode = 'confirm';
      UI._open('🧭 Puxar do Motor', 'Rodada recomendada primeiro; alternativas separadas por matéria', body, { okText: 'Criar atividades' });
    }).then((ok) => {
      if (!ok) return;
      const criar = () => {
        let n = 0;
        const doses = this._motorDoses();
        (this._motorCand || []).forEach((x, i) => {
          if (!this._motorSel || !this._motorSel.has(i)) return;
          const e = DB.addExtra({
            titulo: MotorCiclo.titulo(x.nome, x.membros),
            tipo: 'questoes', disciplina: x.disciplina || '', unidade: 'questoes',
            alvo: Math.max(1, doses[i] || this._motorPrefs.alvoQuestoes), periodo: 'unica', contaMetricas: false,
            obs: 'Gerado pelo Motor de sugestão — dose própria do reforço hierárquico.'
          });
          // mesma origem do outro portão: sem isto a atividade nascia sem
          // `taxaInicial` nem `qBase`, e o ciclo dela nunca teria veredito
          if (e) { DB.updateExtra(e.id, { origemMotor: MotorCiclo.origem(x.nome, x.disciplina, x) }); n++; }
        });
        this.render();
        showToast(n ? n + ' atividade(s) criada(s) ✓' : 'Nenhuma selecionada');
        return n;
      };
      if (window.WorkFeedback) return WorkFeedback.run(null, 'Criando atividades…', criar, { overlay: true, region: '#screen-extras', context: 'extras-plano-criar' });
      return criar();
    });

    // liga a interface do diálogo depois de renderizado
    setTimeout(() => this._motorBind(), 40);
  },
  /* ── TRÊS DISCIPLINAS, UM TÓPICO CADA ─────────────────────────────────────
     O contrato de execução do motor vale aqui também, e vale como REGRA, não
     como censura: o ranking inteiro continua à vista para trocar qualquer
     frente. Marcar um segundo tópico da mesma disciplina TROCA o que já estava
     marcado nela — é o gesto que a pessoa quis fazer. O que não passa é abrir
     uma quarta disciplina: aí a escolha é dela, e a tela diz o que fazer. */
  _motorSelecionarRecomendadas() {
    this._motorSel = new Set();
    const naFila = new Set(this._motorFila || []);
    (this._motorCand || []).forEach((x, i) => {
      if (naFila.has(x.disciplina + '\u0001' + x.nome)) this._motorSel.add(i);
    });
    if (!this._motorSel.size && (this._motorCand || []).length) this._motorSel.add(0);
  },
  _motorMarcar(i, silencioso) {
    const cand = this._motorCand || [];
    const x = cand[i];
    if (!x) return false;
    const chave = (y) => String((y && y.disciplina) || '').trim().toLowerCase();
    const marcados = [...this._motorSel].map(k => ({ k, x: cand[k] })).filter(o => o.x);
    const mesma = marcados.find(o => chave(o.x) === chave(x));
    if (mesma) this._motorSel.delete(mesma.k);
    const discs = new Set(marcados.filter(o => o !== mesma).map(o => chave(o.x)));
    const teto = (this._motorPrefs || MotorSugestao.prefs()).maxFrentes;
    if (!mesma && discs.size >= teto) {
      if (!silencioso) showToast(`A rodada abre ${teto} disciplina(s), uma frente em cada. Desmarque uma para trocar.`);
      return false;
    }
    this._motorSel.add(i);
    return true;
  },
  /* Cada frente conserva uma dose independente. O seletor muda O QUE será
     estudado, não comprime todas as atividades dentro de um orçamento único. */
  _motorDoses() {
    const cand = this._motorCand || [];
    const p = this._motorPrefs || MotorSugestao.prefs();
    const escolhidos = [...(this._motorSel || [])].sort((a, b) => a - b)
      .map(i => ({ i, x: cand[i] })).filter(o => o.x);
    if (!escolhidos.length) return {};
    const copia = escolhidos.map(o => ({
      score: o.x.score,
      taxaErro: o.x.taxaErro,
      questoes: o.x.questoes,
      gapMeta: o.x.gapMeta
    }));
    MotorSugestao.dosar(copia, p.alvoQuestoes, p.doseMin);
    const out = {};
    escolhidos.forEach((o, k) => { out[o.i] = copia[k].dose; });
    return out;
  },
  // Preenche a lista de assuntos do diálogo conforme o filtro de disciplinas atual.
  _motorRenderLista() {
    const host = document.getElementById('pl-lista');
    if (!host) return;
    const cand = this._motorCand || [];
    const doses = this._motorDoses();
    const pos = this._motorFase === 'pos';
    const recomendadas = new Set(this._motorFila || []);
    const porDisc = new Map();
    cand.forEach((x, i) => {
      const d = x.disciplina || '—';
      if (!porDisc.has(d)) porDisc.set(d, []);
      porDisc.get(d).push({ x, i });
    });
    const linha = ({ x, i }, destaque, ordem) => {
      const dose = doses[i];
      return '<label class="sug-row pl-linha ' + (destaque ? 'is-recommended' : '') + '" style="align-items:flex-start;">'
        + '<input type="checkbox" class="pl-pick" data-i="' + i + '" ' + (this._motorSel.has(i) ? 'checked' : '') + '>'
        + '<div style="min-width:0;">'
        + (destaque ? '<div class="pl-rec-eyebrow">Recomendação ' + ordem + ' · ' + escapeHtml(x.disciplina || '') + '</div>' : '')
        + '<div style="font-weight:700;">' + escapeHtml(x.nome)
        + (x.agregado ? ' <span class="ms-selo">bloco' + (x.membros ? ' · ' + x.membros.length + ' ramos' : '') + '</span>' : '') + '</div>'
        + '<div class="hint" style="margin:2px 0 0;">'
        + (!destaque && x.disciplina ? escapeHtml(x.disciplina) + ' · ' : '')
        + Math.round(x.taxaErro) + '% de erro em ' + x.questoes + ' questões'
        + (x.gapMeta != null ? ' · lacuna ' + (Math.round(x.gapMeta * 10) / 10) + 'pp até a meta' : '')
        + ' · amostra ' + x.questoes + ' q'
        + (pos && x.peso ? ' · incidência do tópico ' + x.peso : '')
        + (dose ? ' · <strong>' + dose + ' questões</strong>' : '')
        + '</div></div></label>';
    };

    const top = [];
    let ordem = 0;
    cand.forEach((x, i) => {
      const k = x.disciplina + '\u0001' + x.nome;
      if (!recomendadas.has(k)) return;
      top.push(linha({ x, i }, true, ++ordem));
    });
    const grupos = [];
    (this._motorDiscOrder || [...porDisc.keys()]).forEach(d => {
      const itens = porDisc.get(d) || [];
      if (!itens.length) return;
      const alternativas = itens.filter(({ x }) => !recomendadas.has(x.disciplina + '\u0001' + x.nome));
      grupos.push('<details class="pl-alt-group"><summary><span>' + escapeHtml(d) + '</span><small>'
        + itens.length + ' frente(s) na fila · pior → melhor</small><i>⌄</i></summary>'
        + '<div class="pl-alt-list">' + (alternativas.length
          ? alternativas.map(o => linha(o, false, 0)).join('')
          : '<p class="hint" style="padding:8px;">A recomendação acima já é a única frente acionável desta matéria.</p>')
        + '</div></details>');
    });

    host.innerHTML = (top.length
      ? '<section class="pl-rec-block"><div class="pl-rec-title"><b>🎯 Rodada recomendada agora</b><small>Uma frente por matéria, juntas e na ordem real do Motor.</small></div>' + top.join('') + '</section>'
      : '<p class="hint" style="padding:12px 4px;">Nenhuma recomendação automática neste recorte.</p>')
      + '<section class="pl-alt-block"><div class="pl-rec-title"><b>🧬 Alternativas por matéria</b><small>Trocar uma frente mantém a mesma matéria; abrir outra respeita o teto da rodada.</small></div>'
      + grupos.join('') + '</section>';

    host.querySelectorAll('.pl-pick').forEach(cb => cb.addEventListener('change', () => {
      const i = parseInt(cb.dataset.i, 10);
      if (!cb.checked) { this._motorSel.delete(i); this._motorRenderLista(); return; }
      if (this._motorMarcar(i)) this._motorRenderLista();
      else cb.checked = false;
    }));
    this._motorUpdConta();
  },
  _motorUpdConta() {
    const conta = document.getElementById('pl-conta');
    if (!conta) return;
    const cand = this._motorCand || [];
    const vis = cand.length;
    const nDisc = new Set(cand.map(x => x.disciplina || '')).size;
    const marcados = this._motorSel ? this._motorSel.size : 0;
    const p = this._motorPrefs || MotorSugestao.prefs();
    conta.innerHTML = `${vis} frente(s) em ${nDisc} matéria(s)`
      + ` · <strong>${marcados} marcada(s)</strong>`
      + (marcados ? ` · ${p.alvoQuestoes} questões por atividade` : '');
  },
  // Monta o dropdown de disciplinas (com contagem de pontos fracos) e liga tudo.
  _motorBind() {
    const discs = (this._motorDiscsDisponiveis || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const panel = document.getElementById('pl-disc-panel');
    const toggle = document.getElementById('pl-disc-toggle');
    const setToggleLabel = () => {
      const n = this._motorDiscSel.size;
      if (toggle) toggle.firstChild.textContent = (n === 0 ? 'Todas ' : n + ' selecionada' + (n > 1 ? 's ' : ' '));
    };
    const recalcular = () => {
      MotorSugestao.salvar({ disciplinasSel: [...this._motorDiscSel] });
      this._motorRecalc();
      if (this._motorErr) { showToast('Sem dados suficientes neste recorte'); return; }
      this._motorSelecionarRecomendadas();
      this._motorRenderLista();
    };
    if (panel) {
      panel.innerHTML = '<div class="pl-disc-actions is-first"><button type="button" data-act="all" class="'
        + (this._motorDiscSel.size ? '' : 'active') + '">✓ Todas as disciplinas</button></div>'
        + '<label class="pl-disc-search"><span>⌕</span><input type="search" placeholder="Buscar disciplina" autocomplete="off"></label>'
        + discs.map(d => '<label class="pl-disc-check" data-s="' + escapeHtml(ReforcoEngine.norm(d)) + '">'
          + '<input type="checkbox" data-disc="' + escapeHtml(d) + '" ' + (this._motorDiscSel.has(d) ? 'checked' : '') + '>'
          + '<span class="pl-disc-name">' + escapeHtml(d) + '</span></label>').join('');
      const busca = panel.querySelector('input[type="search"]');
      if (busca) busca.oninput = () => {
        const q = ReforcoEngine.norm(busca.value);
        panel.querySelectorAll('.pl-disc-check').forEach(el => { el.style.display = !q || (el.dataset.s || '').includes(q) ? '' : 'none'; });
      };
      panel.querySelectorAll('input[data-disc]').forEach(chk => chk.addEventListener('change', () => {
        const d = chk.dataset.disc;
        if (chk.checked) this._motorDiscSel.add(d); else this._motorDiscSel.delete(d);
        setToggleLabel(); recalcular();
      }));
      const allBtn = panel.querySelector('[data-act="all"]');
      if (allBtn) allBtn.addEventListener('click', () => {
        this._motorDiscSel.clear();
        panel.querySelectorAll('input[data-disc]').forEach(x => x.checked = false);
        setToggleLabel(); recalcular();
      });
    }
    if (toggle) toggle.addEventListener('click', () => {
      this._motorDiscOpen = !this._motorDiscOpen;
      if (panel) panel.style.display = this._motorDiscOpen ? 'block' : 'none';
      toggle.classList.toggle('open', this._motorDiscOpen);
    });
    setToggleLabel();
    const marcar = document.getElementById('pl-marcar');
    if (marcar) marcar.addEventListener('click', () => { this._motorSelecionarRecomendadas(); this._motorRenderLista(); });
    const limpar = document.getElementById('pl-limpar');
    if (limpar) limpar.addEventListener('click', () => { this._motorSel.clear(); this._motorRenderLista(); });
    this._motorRenderLista();
  },
  // Cartão de TAREFA DO DIA: controle individual por dia (concluir/registrar valem só neste dia)
  cardHtml(x, day) {
    day = day || this.selDay || todayLocal();
    const t = this.TIPOS[x.tipo] || this.TIPOS.livre;
    const rec = DB.extraRecorrente(x);
    const done = DB.extraConcluidaEm(x, day);
    const alvo = parseFloat(x.alvo) || 0;
    const emMin = (x.tipo === 'video' || x.unidade === 'min');
    const cor = this._tipoColor(x.tipo);
    /* PROGRESSO — a barra tem de medir o MESMO periodo da meta.
       Bug corrigido: para toda atividade recorrente a barra somava so o dia.
       Numa meta SEMANAL de 100 questoes com 60 feitas ontem e 30 hoje, o card
       exibia "30/100" — parecia que quase nada tinha sido feito, quando faltavam
       apenas 10. Agora: meta diaria continua medindo o dia; semanal, quinzenal e
       mensal medem o periodo corrente (DB.extraProgressoPeriodo), que e o mesmo
       criterio ja usado para decidir se a meta foi batida. */
    const feitoDia = (x.historico || []).filter(h => h.data === day).reduce((a, h) => a + (h.quantidade || 0), 0);
    const diaria = x.periodo === 'diaria';
    let feito = !rec ? (x.progresso || 0) : (diaria ? feitoDia : DB.extraProgressoPeriodo(x));
    /* Atividade do Motor: o progresso medido no TEC conta automaticamente. */
    let ciclo = null;
    if (typeof MotorCiclo !== 'undefined' && MotorCiclo.origemDe(x)) {
      try {
        ciclo = MotorCiclo.avaliar(x);
        if (ciclo && ciclo.feito > feito) feito = ciclo.feito;
      } catch (e) { _quiet(e, 'card-ciclo-motor'); }
    }
    // rotulo do que a barra esta medindo, para nao restar duvida
    const PER_LABEL = { semanal: 'na semana', quinzenal: 'na quinzena', mensal: 'no mês' };
    const escopo = !rec ? '' : (diaria ? (day === todayLocal() ? 'hoje' : 'no dia') : (PER_LABEL[x.periodo] || ''));
    const pct = alvo > 0 ? Math.min(100, Math.round((feito / alvo) * 100)) : 0;
    const barFull = alvo > 0 && feito >= alvo;
    const unidLabel = emMin ? 'min' : escapeHtml(x.unidade);
    const placeholder = emMin ? 'minutos' : (x.tipo === 'questoes' ? 'questões' : 'qtd');
    const REC_NOME = { diaria: 'diária', semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal' };
    const recTag = rec ? `<span class="extra-tag rec">🔁 ${REC_NOME[x.periodo] || ''}</span>` : '';
    const discTag = x.disciplina ? `<span class="extra-tag disc">${escapeHtml(x.disciplina)}</span>` : '';
    const metaTag = `<span class="extra-tag ${x.contaMetricas ? 'count-on' : 'count-off'}" title="${x.contaMetricas ? 'Conta nas métricas de Evolução' : 'Fora das métricas'}">${x.contaMetricas ? '📊 conta na Evolução' : '🚫 não conta'}</span>`;
    /* De onde a atividade veio e o que aconteceu com o assunto desde então. Sem
       isto o cartão é um item de lista de compras: não diz que nasceu de uma
       fraqueza medida, nem se a fraqueza cedeu. */
    /* ── A ETIQUETA DIZ EM QUE FASE A ESCOLHA FOI FEITA ────────────────────
       Com um motor só, "quem decidiu" deixou de ser pergunta. O que continua
       valendo é a FASE: pré-edital ordena pela lacuna simples até a meta;
       pós-edital usa a incidência somente como desempate. Atividades anteriores
       ao motor não têm a assinatura e continuam legíveis pelo que são. */
    const motorTag = (() => {
      const o = (typeof MotorCiclo !== 'undefined') ? MotorCiclo.origemDe(x) : null;
      if (!o || !o.topico) return '';
      const quando = escapeHtml(formatDateShort(o.criadoEm || ''));
      const fase = o.fase === 'pos' ? 'pós-edital' : (o.fase === 'pre' ? 'pré-edital' : '');
      const rank = o.rankInicial != null ? ' · posição inicial #' + o.rankInicial : '';
      const lacuna = o.lacunaDiscInicial != null ? ' · lacuna inicial ' + (Math.round(o.lacunaDiscInicial * 10) / 10) + 'pp' : '';
      const det = 'Escolhida pelo Motor de sugestão em ' + quando
        + (fase ? ', na fase ' + fase : '') + rank + lacuna
        + (o.minAmostra != null ? ' · piso de ' + o.minAmostra + ' questões por nível' : '') + '.';
      return '<span class="extra-tag plano" title="' + escapeHtml(det) + '">🧭 Motor' + (fase ? ' · ' + escapeHtml(fase) : '') + '</span>';
    })();
    const evoTag = (ciclo && ciclo.origem.taxaInicial != null && ciclo.taxa != null)
      ? `<span class="extra-tag evo ${ciclo.delta != null && ciclo.delta >= 0 ? 'up' : 'down'}" title="Acerto no assunto quando você criou a atividade, e hoje">${ciclo.origem.taxaInicial.toFixed(0)}% → ${ciclo.taxa.toFixed(0)}%</span>` : '';
    const progBlock = (alvo > 0)
      ? `<div class="exd-prog">
           <div class="bar"><i class="${barFull ? 'full' : ''}" style="width:${pct}%"></i></div>
           <div class="nums"><span><b>${feito.toLocaleString('pt-BR')}</b> / ${alvo.toLocaleString('pt-BR')} ${unidLabel}${escopo ? ' <span class="opt">' + escopo + '</span>' : ''}${(ciclo && ciclo.medido > ciclo.manual) ? ' <span class="opt" title="Contadas a partir dos seus retratos do TEC — não precisa lançar à mão.">pelo retrato</span>' : ''}</span><span>${pct}%</span></div>
         </div>`
      : (feitoDia > 0 ? `<div class="exd-prog"><div class="nums"><span><b>${feitoDia.toLocaleString('pt-BR')}</b> ${unidLabel} no dia</span></div></div>` : '');
    const marcador = x.tipo === 'leitura'
      ? `<div class="extra-marcador" style="margin-top:10px;">
           <span class="em-label">📌 Onde parei</span>
           <input type="text" class="ex-marcador" value="${escapeHtml(x.marcador || '')}" placeholder="ex.: art. 150 · pág. 88">
           <button type="button" class="btn-primary ex-marcador-save">Salvar</button>
         </div>` : '';
    // nº de lançamentos feitos neste dia → habilita o botão de desfazer (corrigir/diminuir)
    const regsDia = (x.historico || []).filter(h => h.data === day);
    const nReg = regsDia.length;
    const ultimoReg = nReg ? regsDia[nReg - 1] : null;
    const totalDia = regsDia.reduce((a, h) => a + (h.quantidade || 0), 0);
    const acertosDia = regsDia.reduce((a, h) => a + (h.acertos != null ? (parseFloat(h.acertos) || 0) : 0), 0);
    const temAcertos = x.tipo === 'questoes' && regsDia.some(h => h.acertos != null);
    const futuro = day > todayLocal();
    /* Registro independente da conclusão: pode ser parcial ou integral.
       Bug corrigido (C): quando concluída, o card ESCONDIA tudo o que foi feito.
       Agora mostra um resumo do que foi registrado no dia (inclusive acertos). */
    let regRow;
    if (done) {
      regRow = totalDia > 0
        ? `<div class="exd-reg exd-reg-donerow">
             <span class="exd-doneinfo">✓ <b>${totalDia.toLocaleString('pt-BR')}</b> ${escapeHtml(unidLabel)} registrado(s) neste dia${temAcertos ? ` · <b>${acertosDia.toLocaleString('pt-BR')}</b> acerto(s)` : ''}</span>
           </div>`
        : '';
    } else if (futuro) {
      // Dia futuro é planejamento: sem registro/conclusão, só um aviso discreto.
      regRow = `<div class="exd-reg"><span class="exd-planejado">🗓️ Planejado para ${escapeHtml(formatDateShort(day))} — registre a partir do dia</span></div>`;
    } else {
      const forceInput = (this._addMoreFor === x.id + '@' + day);
      const inputGroup = `
            <div class="exd-reg-group">
              <input type="number" inputmode="decimal" class="exd-num exd-qtd" min="0"
                     placeholder="${placeholder}" title="Informe o valor a registrar" aria-label="Informe o valor a registrar">
              ${x.tipo === 'questoes' ? `<input type="number" inputmode="numeric" class="exd-num exd-ac" min="0" placeholder="acertos" title="Acertos (opcional)" aria-label="Acertos (opcional)">` : ''}
              <button type="button" class="btn-primary exd-reg-btn">Registrar</button>
              ${ultimoReg ? `<button type="button" class="btn-secondary exd-reg-cancel">Cancelar</button>` : ''}
            </div>`;
      regRow = `
        <div class="exd-reg">
          ${(ultimoReg && !forceInput) ? `
            <div class="exd-reg-saved">
              <span class="exd-reg-value">✓ ${totalDia.toLocaleString('pt-BR')} ${escapeHtml(unidLabel)} no dia${temAcertos ? ` · ${acertosDia.toLocaleString('pt-BR')} acerto(s)` : ''}</span>
              <button type="button" class="btn-secondary exd-reg-more">＋ Registrar mais</button>
              <button type="button" class="btn-secondary exd-reg-edit">Editar último</button>
            </div>` : inputGroup}
        </div>`;
    }
    return `
      <div class="exd ${done ? 'done' : ''}" data-id="${x.id}" data-day="${day}" style="--exd-cor:${cor}; --exd-fill:${alvo > 0 ? pct : (done ? 100 : 0)}%;">
        <div class="exd-top">
          <button type="button" class="exd-check" aria-pressed="${done}"
                  aria-label="${done ? 'Reabrir atividade' : 'Concluir atividade'}">
            ${this._CHECK}<span class="exd-check-lbl">${done ? 'Reabrir' : 'Concluir'}</span>
          </button>
          <div class="exd-ico" style="background:color-mix(in srgb, ${cor} 16%, transparent); color:${cor};">${t.ico}</div>
          <div class="exd-main">
            <div class="exd-title">${escapeHtml(x.titulo)}</div>
            <div class="exd-tags">
              <span class="extra-tag">${t.nome}</span>
              ${discTag}${recTag}${motorTag}${evoTag}${metaTag}
              ${x.tipo === 'leitura' && x.marcador ? `<span class="extra-tag pin">📌 ${escapeHtml(x.marcador)}</span>` : ''}
            </div>
          </div>
          <div class="exd-actions">
            <button type="button" class="reg-act-btn exd-edit" title="Editar / configurar" aria-label="Editar / configurar">✎</button>
            <button type="button" class="reg-act-btn danger exd-delete" title="Excluir atividade" aria-label="Excluir atividade">✕</button>
          </div>
        </div>
                ${progBlock}
        ${marcador}
        ${regRow}
      </div>`;
  },
  bind(list) {
    list.querySelectorAll('.exd').forEach(card => {
      const id = card.dataset.id;
      const day = card.dataset.day || this.selDay || todayLocal();
      // marcar/desmarcar conclusão do DIA (checkbox redondo)
      const check = card.querySelector('.exd-check');
      if (check) check.addEventListener('click', () => {
        // Bug corrigido (B): concluir só faz sentido até hoje — dia futuro é planejamento.
        if (day > todayLocal()) { showToast('Este dia ainda não chegou — conclua a partir da data de hoje'); return; }
        const executar = () => {
          const x = DB.getExtra(id);
          const jaFeita = DB.extraConcluidaEm(x, day);
          DB.setConcluidaDia(id, day, !jaFeita);
          this.render();
          showToast(jaFeita ? 'Atividade reaberta ↩' : (DB.extraRecorrente(x) ? 'Concluída neste dia 🎉' : 'Atividade concluída 🎉'));
        };
        if (window.WorkFeedback) WorkFeedback.run(check, 'Processando…', executar, { region: '#extras-list', context: 'extras-conclusao' });
        else executar();
      });
      const edit = card.querySelector('.exd-edit');
      if (edit) edit.addEventListener('click', () => this.openModal(id));
      const del = card.querySelector('.exd-delete');
      if (del) del.addEventListener('click', () => this.excluir(id, day));
      // Registra um novo valor; a edição ocorre em uma caixa separada.
      const regBtn = card.querySelector('.exd-reg-btn');
      if (regBtn) regBtn.addEventListener('click', () => {
        const qEl = card.querySelector('.exd-qtd');
        const acEl = card.querySelector('.exd-ac');
        const q = qEl ? qEl.value : '';
        if (!q || parseFloat(q) <= 0) { showToast('Informe um valor válido'); return; }
        if (acEl && acEl.value !== '' && parseFloat(acEl.value) > parseFloat(q)) { showToast('Acertos não podem passar do total'); return; }
        if (day > todayLocal()) { showToast('Não dá para registrar em data futura'); return; }
        const executar = () => {
          DB.addExtraProgress(id, q, 0, { data: day, acertos: acEl ? acEl.value : null });
          this._addMoreFor = null;
          this.render();
          showToast(day === todayLocal() ? 'Registrado ✓' : 'Registrado em ' + formatDateShort(day) + ' ✓');
        };
        if (window.WorkFeedback) WorkFeedback.run(regBtn, 'Registrando…', executar, { region: '#extras-list', context: 'extras-registro' });
        else executar();
      });
      // "Registrar mais": revela o campo de entrada mesmo já havendo um registro no dia
      const moreBtn = card.querySelector('.exd-reg-more');
      if (moreBtn) moreBtn.addEventListener('click', () => { this._addMoreFor = id + '@' + day; this.render(); setTimeout(() => { const inp = list.querySelector(`.exd[data-id="${id}"][data-day="${day}"] .exd-qtd`); if (inp) inp.focus(); }, 30); });
      const cancelBtn = card.querySelector('.exd-reg-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => { this._addMoreFor = null; this.render(); });
      const editReg = card.querySelector('.exd-reg-edit');
      if (editReg) editReg.addEventListener('click', () => {
        const xAtual = DB.getExtra(id);
        const regs = (xAtual.historico || []).filter(h => h.data === day);
        const atual = regs.length ? regs[regs.length - 1] : null;
        if (!atual) { this.render(); return; }
        const campos = [{ key: 'quantidade', label: 'Novo valor', type: 'number', value: String(atual.quantidade || ''), min: 0 }];
        if (xAtual.tipo === 'questoes') campos.push({ key: 'acertos', label: 'Acertos', type: 'number', value: atual.acertos == null ? '' : String(atual.acertos), min: 0 });
        UI.prompt(campos, { title: 'Editar registro', okText: 'Salvar' }).then(v => {
          if (!v) return;
          const novo = parseFloat(v.quantidade);
          if (!novo || novo <= 0) { showToast('Informe um valor válido'); return; }
          if (v.acertos !== undefined && v.acertos !== '' && parseFloat(v.acertos) > novo) { showToast('Acertos não podem passar do total'); return; }
          DB.undoExtraProgressDay(id, day);
          DB.addExtraProgress(id, novo, 0, { data: day, acertos: v.acertos == null ? null : v.acertos });
          this._addMoreFor = null;
          this.render();
          showToast('Registro atualizado ✓');
        });
      });
      // marcador "onde parei" (leitura)
      const mkSave = card.querySelector('.ex-marcador-save');
      if (mkSave) mkSave.addEventListener('click', () => {
        DB.updateExtra(id, { marcador: card.querySelector('.ex-marcador').value });
        this.render(); showToast('📌 Marcador salvo');
      });
      const mkInput = card.querySelector('.ex-marcador');
      if (mkInput) mkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { DB.updateExtra(id, { marcador: mkInput.value }); this.render(); showToast('📌 Marcador salvo'); } });
    });
  },
  // ── Gerenciador de atividades (recorrentes + avulsas), separado do dia ──
  manageOpen() { this._manageLimit = 200; this.renderManageList(); const m = document.getElementById('extras-manage-modal'); if (m) m.style.display = 'flex'; },
  manageClose() { const m = document.getElementById('extras-manage-modal'); if (m) m.style.display = 'none'; },
  renderManageList() {
    const box = document.getElementById('extras-manage-list');
    if (!box) return;
    const extras = DB.getExtras();
    if (!extras.length) { box.innerHTML = `<p class="hint" style="padding:12px 2px;">Nenhuma atividade ainda. Use <strong>＋ Nova atividade</strong> para criar a primeira.</p>`; return; }
    const limite = this._manageLimit || 200;
    const visiveis = extras.slice(0, limite);
    const REC_NOME = { diaria: 'diária', semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal' };
    const rowHtml = (x) => {
      const t = this.TIPOS[x.tipo] || this.TIPOS.livre;
      const cor = this._tipoColor(x.tipo);
      const nDatas = (x.datas || []).length;
      const sub = [`<span class="extra-tag">${t.nome}</span>`];
      if (DB.extraRecorrente(x)) sub.push(`<span class="extra-tag rec">🔁 ${REC_NOME[x.periodo] || ''}</span>`);
      if (x.disciplina) sub.push(`<span class="extra-tag disc">${escapeHtml(x.disciplina)}</span>`);
      if (x.dataFim) sub.push(`<span class="extra-tag">⏳ até ${escapeHtml(formatDateShort(x.dataFim))}</span>`);
      if (nDatas) sub.push(`<span class="extra-tag">🗓️ ${nDatas} data(s)</span>`);
      if (!DB.extraRecorrente(x) && x.status === 'concluida') sub.push(`<span class="extra-tag count-on">✓ concluída</span>`);
      return `<div class="exm-row" data-id="${x.id}">
        <div class="exm-ico" style="background:color-mix(in srgb, ${cor} 16%, transparent); color:${cor};">${t.ico}</div>
        <div class="exm-body"><div class="exm-name">${escapeHtml(x.titulo)}</div><div class="exm-sub">${sub.join('')}</div></div>
        <div class="exm-acts">
          <button type="button" class="icon-btn exm-edit" title="Editar" aria-label="Editar">✎</button>
          <button type="button" class="icon-btn danger exm-del" title="Excluir" aria-label="Excluir">×</button>
        </div>
      </div>`;
    };
    const rec = visiveis.filter(x => DB.extraRecorrente(x));
    const uni = visiveis.filter(x => !DB.extraRecorrente(x));
    const recTotal = extras.filter(x => DB.extraRecorrente(x)).length;
    const uniTotal = extras.length - recTotal;
    box.innerHTML =
      (rec.length ? `<div class="exm-group-title">🔁 Recorrentes (${recTotal})</div>` + rec.map(rowHtml).join('') : '') +
      (uni.length ? `<div class="exm-group-title">⭐ Avulsas / únicas (${uniTotal})</div>` + uni.map(rowHtml).join('') : '') +
      (visiveis.length < extras.length
        ? `<div class="hint" style="padding:16px 0;text-align:center;"><button type="button" class="btn-secondary" id="exm-load-more">Mostrar mais ${Math.min(200, extras.length - visiveis.length)} · ${visiveis.length} de ${extras.length}</button></div>` : '');
    box.querySelectorAll('.exm-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.exm-edit').addEventListener('click', () => this.openModal(id));
      row.querySelector('.exm-del').addEventListener('click', () => this.excluir(id));
    });
    const mais = document.getElementById('exm-load-more');
    if (mais) mais.addEventListener('click', () => { this._manageLimit = (this._manageLimit || 200) + 200; this.renderManageList(); });
  },
  // Exclusão consciente da recorrência: se a atividade é recorrente e tem ocorrências
  // FUTURAS vinculadas, pergunta se apaga tudo ou só as ocorrências futuras (mantendo
  // a atividade e o histórico já registrado).
  _openOccurrencePicker(x, dia) {
    const dates = [...new Set([...(x.datas || []), ...(x.concluidasEm || []), ...(x.historico || []).map(h => h.data)])].sort();
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'occ-del-overlay';
      const minDia = d => (x.historico || []).filter(h => h.data === d).reduce((n,h) => n + (parseFloat(h.minutos) || ((x.unidade === 'min' || x.tipo === 'video') ? (parseFloat(h.quantidade)||0) : 0)), 0);
      ov.innerHTML = `<div class="occ-del-modal"><div class="occ-del-head"><h3>Selecionar ocorrências para excluir</h3><button class="occ-del-close" type="button" aria-label="Fechar">×</button></div><div class="occ-del-body"><div class="occ-del-quick"><button data-scope="all">Selecionar todas</button><button data-scope="future">Futuras</button><button data-scope="presentFuture">Presente e futuras</button><button data-scope="none" title="Limpar filtros e desmarcar todas as ocorrências">🧹 <span>Limpar filtros</span></button></div><div class="occ-del-grid">${dates.map(d => `<label class="occ-del-item"><input type="checkbox" value="${d}"><span class="occ-del-date">${formatDateShort(d)}</span><span class="occ-del-time">${minDia(d) ? minDia(d) + ' min' : 'sem tempo'}</span></label>`).join('')}</div></div><div class="occ-del-foot"><span class="occ-del-count">0 selecionadas</span><div class="occ-del-actions"><button type="button" class="btn-secondary occ-cancel">Cancelar</button><button type="button" class="btn-danger occ-confirm" disabled>Excluir</button></div></div></div>`;
      document.body.appendChild(ov);
      const boxes = [...ov.querySelectorAll('input[type=checkbox]')], count = ov.querySelector('.occ-del-count'), ok = ov.querySelector('.occ-confirm');
      const sync = () => { const n=boxes.filter(b=>b.checked).length; count.textContent=n+' selecionada(s)'; ok.disabled=!n; };
      const close = v => { ov.remove(); resolve(v); };
      const quick = [...ov.querySelectorAll('[data-scope]')];
      const setActive = btn => quick.forEach(q => q.classList.toggle('active', q === btn && btn.dataset.scope !== 'none'));
      boxes.forEach(b=>b.addEventListener('change',()=>{ setActive(null); sync(); }));
      quick.forEach(b=>b.addEventListener('click',()=>{
        const sc=b.dataset.scope;
        boxes.forEach(c=>{c.checked=sc==='all'||(sc==='future'&&c.value>dia)||(sc==='presentFuture'&&c.value>=dia);});
        setActive(b); sync();
      }));
      ov.querySelector('.occ-del-close').onclick=()=>close(null); ov.querySelector('.occ-cancel').onclick=()=>close(null);
      ok.onclick=()=>close(boxes.filter(b=>b.checked).map(b=>b.value));
      ov.addEventListener('click',e=>{if(e.target===ov)close(null)});
      sync();
    });
  },
  excluir(id, dia) {
    const x = DB.getExtra(id);
    if (!x) return;
    dia = dia || todayLocal();
    if (!DB.extraRecorrente(x)) {
      UI.confirm(`Excluir a atividade "${x.titulo}" deste dia?`, { title: 'Excluir atividade', okText: 'Excluir', danger: true }).then(ok => {
        if (!ok) return;
        DB.deleteExtra(id); this.render(); showToast('Atividade excluída');
      });
      return;
    }
    this._openOccurrencePicker(x, dia).then(dias => {
      if (!dias || !dias.length) return;
      const todas = [...new Set([...(x.datas || []), ...(x.concluidasEm || []), ...(x.historico || []).map(h => h.data)])];
      if (dias.length === todas.length && todas.every(d => dias.includes(d))) {
        UI.confirm('Excluir toda a recorrência e todos os registros vinculados?', { title: 'Excluir toda a recorrência', okText: 'Excluir tudo', danger: true }).then(ok => {
          if (!ok) return; DB.deleteExtra(id); this.render(); showToast('Toda a recorrência foi excluída');
        });
        return;
      }
      DB.deleteExtraOccurrences(id, dias);
      this.render();
      showToast(dias.length + ' ocorrência(s) excluída(s)');
    });
  },
  openModal(id, prefill) {
    this._editingId = id || null;
    const isEdit = !!id;
    const isConfig = !!prefill;  // veio das sugestões (configurar antes de criar)
    $id('extra-modal-title').textContent = isEdit ? '✎ Editar atividade' : (isConfig ? '⚙ Configurar atividade' : '＋ Nova atividade');
    $id('extra-del-btn').style.display = isEdit ? 'inline-block' : 'none';
    // datalist de disciplinas
    const discs = [...new Set([...DB.getActiveSubjects().map(s => s.nome), ...DB.getIncidencia().map(r => r.disciplina)].filter(Boolean))].sort();
    $id('extra-disc-list').innerHTML = discs.map(d => `<option value="${escapeHtml(d)}">`).join('');
    let x = { titulo: '', tipo: 'anki', disciplina: '', alvo: '', unidade: 'cards', periodo: 'unica', dataFim: '', marcador: '', contaMetricas: true };
    if (isEdit) x = Object.assign(x, DB.getExtra(id));
    else if (isConfig) x = Object.assign(x, prefill);
    // ajusta o texto do botão salvar conforme o contexto
    const okBtn = document.getElementById('extra-save'); if (okBtn) okBtn.textContent = isConfig ? 'Adicionar atividade' : 'Salvar';
    $id('extra-titulo').value = x.titulo;
    $id('extra-tipo').value = x.tipo;
    $id('extra-disciplina').value = x.disciplina || '';
    $id('extra-alvo').value = x.alvo || '';
    $id('extra-unidade').value = x.unidade;
    $id('extra-periodo').value = x.periodo;
    const dfEl = document.getElementById('extra-datafim'); if (dfEl) dfEl.value = x.dataFim || '';
    const diEl = document.getElementById('extra-datainicio'); if (diEl) diEl.value = x.dataInicio || '';
    $id('extra-marcador').value = x.marcador || '';
    $id('extra-conta').checked = x.contaMetricas !== false;
    this.onTipoChange(true); // mostra/oculta o campo marcador
    this.onPeriodoChange();  // mostra/oculta os campos de início/fim da recorrência
    $id('extra-modal').style.display = 'flex';
    setTimeout(() => $id('extra-titulo').focus(), 50);
  },
  // ao trocar o tipo, sugere a unidade padrão e mostra o marcador p/ leitura
  onTipoChange(keepUnit) {
    const tipo = $id('extra-tipo').value;
    const t = this.TIPOS[tipo];
    if (t && !keepUnit) $id('extra-unidade').value = t.unidade;
    // marcador "onde parei" faz sentido para leitura/lei seca
    const mf = document.getElementById('extra-marcador-field');
    if (mf) mf.style.display = (tipo === 'leitura') ? 'block' : 'none';
  },
  // os campos de início/fim da recorrência só fazem sentido quando a atividade é recorrente
  onPeriodoChange() {
    const per = $id('extra-periodo').value;
    const recorrente = (per === 'diaria' || per === 'semanal' || per === 'quinzenal' || per === 'mensal');
    const f = document.getElementById('extra-datafim-field');
    const iniF = document.getElementById('extra-datainicio-field');
    if (f) f.style.display = recorrente ? 'flex' : 'none';
    if (iniF) iniF.style.display = recorrente ? 'block' : 'none';
    if (!recorrente) {
      const dfEl = document.getElementById('extra-datafim'); if (dfEl) dfEl.value = '';
      const diEl = document.getElementById('extra-datainicio'); if (diEl) diEl.value = '';
    }
    this.updateRecPreview();
  },
  // Mostra ao vivo quantas ocorrências a recorrência vai gerar/vincular no calendário.
  updateRecPreview() {
    const el = document.getElementById('extra-rec-preview');
    if (!el) return;
    const per = $id('extra-periodo').value;
    const recorrente = (per === 'diaria' || per === 'semanal' || per === 'quinzenal' || per === 'mensal');
    const fim = (document.getElementById('extra-datafim') || {}).value || '';
    const inicio = (document.getElementById('extra-datainicio') || {}).value || '';
    if (!recorrente) { el.innerHTML = '&nbsp;'; return; }
    if (!fim) { el.textContent = 'Defina o fim para vincular as datas automaticamente.'; return; }
    const n = DB.previewDatasRecorrencia({ periodo: per, dataInicio: inicio, dataFim: fim, createdAt: todayLocal() });
    const NOME = { diaria: 'diárias', semanal: 'semanais', quinzenal: 'quinzenais', mensal: 'mensais' };
    el.innerHTML = n > 0
      ? `📅 <strong>${n}</strong> ocorrência(s) ${NOME[per] || ''} serão vinculadas ao calendário.`
      : '⚠ Intervalo inválido: o início é depois do fim.';
  },
  save() {
    const titulo = $id('extra-titulo').value.trim();
    if (!titulo) { showToast('Dê um título à atividade'); return; }
    const data = {
      titulo,
      tipo: $id('extra-tipo').value,
      disciplina: $id('extra-disciplina').value,
      alvo: $id('extra-alvo').value,
      unidade: $id('extra-unidade').value,
      periodo: $id('extra-periodo').value,
      dataInicio: document.getElementById('extra-datainicio') ? $id('extra-datainicio').value : '',
      dataFim: document.getElementById('extra-datafim') ? $id('extra-datafim').value : '',
      marcador: $id('extra-marcador').value,
      contaMetricas: $id('extra-conta').checked
    };
    let savedId;
    if (this._editingId) { DB.updateExtra(this._editingId, data); savedId = this._editingId; showToast('Atividade atualizada ✓'); }
    else { const ne = DB.addExtra(data); savedId = ne && ne.id; showToast('Atividade criada ✓'); }
    // recorrência com data-fim: recalcula e vincula as ocorrências ao calendário
    if (savedId) {
      const nDatas = (DB.getExtra(savedId) || {}).datas || [];
      DB.sincronizarDatasRecorrencia(savedId);
      const nova = (DB.getExtra(savedId) || {}).datas || [];
      if (data.periodo !== 'unica' && data.dataFim && nova.length) showToast(`📅 ${nova.length} data(s) vinculadas ao calendário ✓`);
    }
    $id('extra-modal').style.display = 'none';
    const okBtn = document.getElementById('extra-save'); if (okBtn) okBtn.textContent = 'Salvar';
    this.render();
  },
  // ===== Calendário em linha: vincule atividades a datas =====
  _addDays(iso, delta) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  _calSel: null,      // data selecionada no calendário
  _calStart: null,    // 1º dia visível (para navegação)
  renderAgenda() {
    const host = document.getElementById('extras-agenda');
    if (!host) return;
    const extras = DB.getExtras();
    if (!extras.length) { host.innerHTML = ''; return; }
    const hoje = todayLocal();
    if (!this.selDay) this.selDay = hoje;
    if (!this._calStart) this._calStart = this._addDays(hoje, -3);   // mostra alguns dias passados
    if (this._showFilters === undefined) this._showFilters = false;
    if (!this._fStart || !this._fEnd) { this._fEnd = hoje; this._fStart = this._addDays(hoje, -29); }
    const DIAS = 14;
    const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    // tira do calendário (strip) — dots pelas ocorrências de cada dia
    let strip = '';
    for (let i = 0; i < DIAS; i++) {
      const dia = this._addDays(this._calStart, i);
      const d = new Date(dia + 'T00:00:00');
      const occ = this.occurrencesForDay(dia);
      const total = occ.length;
      const feitos = occ.filter(x => DB.extraConcluidaEm(x, dia)).length;
      const allDone = total > 0 && feitos === total && dia <= hoje;
      const partial = total > 0 && feitos > 0 && feitos < total;
      const dots = occ.slice(0, 4).map(x => `<span class="cal-dot" style="background:${this._tipoColor(x.tipo)}"></span>`).join('');
      const sel = dia === this.selDay, isHoje = dia === hoje;
      const marca = allDone ? '<span class="cal-alldone">✓</span>'
        : (total > 0 ? `<span class="cal-dots">${dots}${total > 4 ? '<span class="cal-more">+' + (total - 4) + '</span>' : ''}</span>` : '<span class="cal-dots">&nbsp;</span>');
      strip += `<button type="button" class="cal-day ${sel ? 'sel' : ''} ${isHoje ? 'hoje' : ''} ${allDone ? 'alldone' : ''} ${partial ? 'partial' : ''}" data-dia="${dia}" title="${total ? feitos + '/' + total + ' concluída(s)' : 'sem atividades'}">
        <span class="cal-wd">${nomes[d.getDay()]}</span>
        <span class="cal-dn">${String(d.getDate()).padStart(2, '0')}</span>
        <span class="cal-mo">${meses[d.getMonth()]}</span>
        ${marca}
      </button>`;
    }
    // dados do dia selecionado
    const occSel = this.occurrencesForDay(this.selDay);
    const feitosSel = occSel.filter(x => DB.extraConcluidaEm(x, this.selDay)).length;
    const minDia = this._minInDay(this.selDay);
    const minTotal = this._minTotal();
    const minRange = this._minInRange(this._fStart, this._fEnd);
    host.innerHTML = `
      <div class="card cal-card">
        <div class="card-header">
          <div><h2>🗓️ Missão do dia</h2><p class="sub">Escolha um dia e conclua o que está vinculado a ele. Cada dia tem o seu próprio controle — o que você faz aqui vale só para o dia selecionado.</p></div>
          <div class="cal-nav">
            <button type="button" class="icon-btn" id="cal-prev" title="Recuar uma semana" aria-label="Recuar uma semana">‹</button>
            <button type="button" class="btn-secondary" id="cal-today">Hoje</button>
            <button type="button" class="icon-btn" id="cal-next" title="Avançar uma semana" aria-label="Avançar uma semana">›</button>
          </div>
        </div>
        <div class="cal-strip" style="padding:6px 24px 14px;">${strip}</div>
        <div style="padding:2px 24px 18px;">
          <div class="exx-dayhead">
            <div class="dh-l">
              <div class="dh-title">📌 ${escapeHtml(this._prettyDay(this.selDay))} ${this.selDay === hoje ? '<span class="hoje">hoje</span>' : ''}</div>
              <div class="dh-sub">${occSel.length} atividade(s) · ${feitosSel} concluída(s) neste dia</div>
            </div>
            <div class="dh-r">
              <div class="exx-metric"><span class="mv">${CycleEngine.fmtHM(minDia)}</span><span class="ml">registrado no dia</span></div>
              <button type="button" class="btn-secondary ${this._showFilters ? 'is-active' : ''}" id="ex-filters-btn" title="Ver carga horária total e filtrar por intervalo">⏱️ Carga horária</button>
            </div>
          </div>
          <div class="exx-filters ${this._showFilters ? '' : 'hidden'}" id="ex-filters">
            <div class="ef-row">
              <div class="ef-field"><label for="ex-f-de">De</label><input type="date" id="ex-f-de" value="${this._fStart}" max="${hoje}"></div>
              <div class="ef-field"><label for="ex-f-ate">Até</label><input type="date" id="ex-f-ate" value="${this._fEnd}" max="${hoje}"></div>
              <div class="ef-field"><label>Atalhos</label>
                <div class="ef-quick">
                  <button type="button" class="btn-secondary" data-fq="7">7 dias</button>
                  <button type="button" class="btn-secondary" data-fq="30">30 dias</button>
                  <button type="button" class="btn-secondary" data-fq="all">Tudo</button>
                </div>
              </div>
            </div>
            <div class="ef-cards">
              <div class="exx-fcard"><div class="v">${CycleEngine.fmtHM(minDia)}</div><div class="l">no dia selecionado</div></div>
              <div class="exx-fcard"><div class="v">${CycleEngine.fmtHM(minRange)}</div><div class="l">no intervalo</div></div>
              <div class="exx-fcard"><div class="v">${CycleEngine.fmtHM(minTotal)}</div><div class="l">total registrado</div></div>
            </div>
            <p class="gb-hint" style="margin-top:8px;">A carga horária soma os minutos registrados nas atividades: minutos/vídeo contam direto; as demais contam quando você informa minutos ao registrar.</p>
          </div>
        </div>
      </div>`;
    // interações
    host.querySelectorAll('.cal-day').forEach(b => b.addEventListener('click', () => { this.selDay = b.dataset.dia; this.render(); }));
    const prev = host.querySelector('#cal-prev'); if (prev) prev.addEventListener('click', () => { this._calStart = this._addDays(this._calStart, -7); this.renderAgenda(); });
    const next = host.querySelector('#cal-next'); if (next) next.addEventListener('click', () => { this._calStart = this._addDays(this._calStart, 7); this.renderAgenda(); });
    const tod = host.querySelector('#cal-today'); if (tod) tod.addEventListener('click', () => { this._calStart = this._addDays(hoje, -3); this.selDay = hoje; this.render(); });
    const fb = host.querySelector('#ex-filters-btn');
    if (fb) fb.addEventListener('click', () => { this._showFilters = !this._showFilters; const p = document.getElementById('ex-filters'); if (p) p.classList.toggle('hidden', !this._showFilters); fb.classList.toggle('is-active', this._showFilters); });
    const de = host.querySelector('#ex-f-de'), ate = host.querySelector('#ex-f-ate');
    const applyF = () => { if (de && de.value) this._fStart = de.value; if (ate && ate.value) this._fEnd = ate.value; if (this._fStart > this._fEnd) { const t = this._fStart; this._fStart = this._fEnd; this._fEnd = t; } this.renderAgenda(); };
    if (de) de.addEventListener('change', applyF);
    if (ate) ate.addEventListener('change', applyF);
    host.querySelectorAll('[data-fq]').forEach(b => b.addEventListener('click', () => {
      const q = b.dataset.fq;
      if (q === 'all') { let min = hoje; DB.getExtras().forEach(x => (x.historico || []).forEach(h => { if (h.data && h.data < min) min = h.data; })); this._fStart = min; this._fEnd = hoje; }
      else { this._fEnd = hoje; this._fStart = this._addDays(hoje, -(parseInt(q, 10) - 1)); }
      this._showFilters = true; this.renderAgenda();
    }));
  },
  _tipoColor(tipo) {
    return { anki: '#7c3aed', leitura: '#0f9d63', questoes: '#2563eb', revisao: '#d97a12', video: '#e0393f', livre: '#0a95a8' }[tipo] || '#6b7280';
  },
  deleteCurrent() {
    if (!this._editingId) return;
    const idToDel = this._editingId;
    $id('extra-modal').style.display = 'none';
    this.excluir(idToDel);
    return;
  }
};
window.ExtrasScreen = ExtrasScreen;
(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('extras-new-btn', 'click', () => { ExtrasScreen.openModal(null); });
  on('extras-motor-btn', 'click', (ev) => {
    if (window.WorkFeedback) WorkFeedback.run(ev.currentTarget, 'Analisando Motor…', () => ExtrasScreen.puxarDoMotor(), { overlay: true, region: '#screen-extras', context: 'extras-puxar-motor' });
    else ExtrasScreen.puxarDoMotor();
  });
  // Gerenciador de atividades (recorrentes + avulsas), separado da missão do dia
  on('extras-manage-btn', 'click', () => ExtrasScreen.manageOpen());
  on('extras-manage-close', 'click', () => ExtrasScreen.manageClose());
  on('extras-manage-done', 'click', () => ExtrasScreen.manageClose());
  on('extras-manage-new', 'click', () => { ExtrasScreen.openModal(null); });
  const _mng = document.getElementById('extras-manage-modal');
  if (_mng) _mng.addEventListener('click', (e) => { if (e.target === _mng) ExtrasScreen.manageClose(); });
  const closeExtraModal = () => {
    $id('extra-modal').style.display = 'none';
    const okBtn = document.getElementById('extra-save'); if (okBtn) okBtn.textContent = 'Salvar';
  };
  on('extra-modal-close', 'click', closeExtraModal);
  on('extra-cancel', 'click', closeExtraModal);
  on('extra-save', 'click', () => ExtrasScreen.save());
  on('extra-del-btn', 'click', () => ExtrasScreen.deleteCurrent());
  on('extra-tipo', 'change', () => ExtrasScreen.onTipoChange());
  on('extra-periodo', 'change', () => ExtrasScreen.onPeriodoChange());
  on('extra-datafim', 'change', () => ExtrasScreen.updateRecPreview());
  on('extra-datainicio', 'change', () => ExtrasScreen.updateRecPreview());
  on('extras-global-toggle', 'click', () => {
    DB.setExtrasCountGlobal(!DB.extrasCountGlobal());
    $id('extras-global-toggle').classList.toggle('on', DB.extrasCountGlobal());
    showToast(DB.extrasCountGlobal() ? 'Atividades marcadas entram nas métricas' : 'Atividades fora das métricas');
  });
  const m = document.getElementById('extra-modal');
  /* fundo desfocado nao fecha o modal: so o X / Cancelar / Esc fecham */
})();
window.addEventListener('screen:activated', (e) => {
  /* ═══ ABRIR EXTRAS NÃO PODE ESPERAR O MOTOR DO TEC ═════════════════════
     `renderEmCurso` chama `DesempenhoTecScreen._motorRef()` para saber, de
     cada reforço aberto, em que nível o assunto está hoje. Isso é o motor do
     Plano inteiro rodando sobre todos os retratos — num perfil com 8 retratos
     e ~960 assuntos, ~200 ms de trabalho síncrono ANTES da primeira pintura
     (mais de 1 s num aparelho 4× mais lento). Era a tela mais lenta do app
     para abrir, e o custo não vinha das atividades: vinha de uma consulta ao
     TEC feita para enfeitar as barras de progresso.

     A tela abre primeiro. O painel "em curso" pinta um esqueleto e se resolve
     no quadro seguinte — as barras de progresso, que dependem só das próprias
     atividades, aparecem junto com o resto.

     `ExtrasScreen.render()` continua 100% síncrona: quem a chama por código
     (e a suíte de verificação, que lê `#extras-curso` no mesmo tick) recebe a
     tela pronta. O adiamento é só deste caminho, o do toque no menu. */
  if (e.detail.screen === 'extras') {
    const host = document.getElementById('extras-curso');
    const temAberto = (() => {
      try { return DB.getExtras().some(x => x && typeof MotorCiclo !== 'undefined' && MotorCiclo.origemDe(x) && MotorCiclo.origemDe(x).topico && x.status !== 'concluida'); }
      catch (err) { _quiet(err, 'extras-abertura'); return false; }
    })();
    if (!host || !temAberto || typeof pintarDepois !== 'function') { ExtrasScreen.render(); return; }
    ExtrasScreen._pularEmCurso = true;
    try { ExtrasScreen.render(); } finally { ExtrasScreen._pularEmCurso = false; }
    pintarDepois(host, 'Conferindo o que está em curso…', () => {
      try { ExtrasScreen.renderEmCurso(); } catch (err) { _quiet(err, 'extras-em-curso'); }
    });
  }
});
