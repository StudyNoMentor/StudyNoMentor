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
  _CHECK: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
  render() {
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
    if (this._ctxKey !== ctx) { this._ctxKey = ctx; this.selDay = hoje; this._calStart = this._addDays(hoje, -3); this._addMoreFor = null; }
    // se a data selecionada ficou no futuro por navegação, ainda é válida; só garante um valor
    if (!this.selDay) this.selDay = hoje;
    const extras = DB.getExtras();
    this.renderAgenda(); // calendário + cabeçalho do dia + carga horária + filtros
    if (extras.length === 0) {
      list.innerHTML = `<div class="extras-empty"><div class="big">✅</div>Nenhuma atividade extra ainda.<br>Clique em <strong>＋ Nova atividade</strong> para começar, ou <strong>🔁 Gerenciar</strong> para criar recorrências.</div>`;
      this._syncManage();
      return;
    }
    const day = this.selDay;
    const occ = this.occurrencesForDay(day);
    if (occ.length === 0) {
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
      return;
    }
    const aFazer = occ.filter(x => !DB.extraConcluidaEm(x, day));
    const feitas = occ.filter(x => DB.extraConcluidaEm(x, day));
    const grupos = [['A fazer', aFazer], ['Concluídas', feitas]];
    list.innerHTML = grupos.map(([titulo, arr]) => {
      if (!arr.length) return '';
      return `<div class="extras-group-title">${titulo} (${arr.length})</div>` +
        arr.map(x => this.cardHtml(x, day)).join('');
    }).join('');
    this.bind(list);
    this._syncManage();
  },
  // ── Ocorrências de um dia ──────────────────────────────────────────────
  // Recorrentes: aparecem no dia se ele foi gerado (datas) OU, sem datas geradas,
  // se bate a cadência dentro da janela. Avulsas: aparecem nos dias vinculados;
  // se não têm nenhum dia vinculado, aparecem HOJE como pendência até concluir.
  occurrencesForDay(day) {
    const hoje = todayLocal();
    return DB.getExtras().filter(x => {
      const datas = x.datas || [];
      if (DB.extraRecorrente(x)) {
        if ((x.excluidasEm || []).includes(day)) return false;
        if (datas.length) return datas.includes(day);
        return this._recurOnDay(x, day);
      }
      if (datas.length) return datas.includes(day);
      /* BUG CORRIGIDO (A): a atividade AVULSA sumia da tela assim que era concluida
         (o filtro descartava status === 'concluida'). Sem ela na lista nao havia
         como editar, consultar o que foi feito, nem reabrir se voce marcou por
         engano — restava recriar do zero.
         Agora ela FICA, marcada como concluida, com o botao virando "Reabrir".

         BUG CORRIGIDO (A2 — preservacao de data): a avulsa aparecia SOMENTE hoje.
         Se voce registrasse progresso num dia passado, ao voltar aquele dia a
         atividade nao aparecia e o registro "sumia" da visao (parecia perda de
         dado). Agora ela tambem aparece em QUALQUER dia onde houve registro,
         preservando o historico exatamente no dia correto. */
      const temHistoricoNoDia = (x.historico || []).some(h => h.data === day);
      if (temHistoricoNoDia) return true;
      // pendencia: enquanto nao concluida, fica visivel no dia de hoje
      if (day === hoje && x.status !== 'concluida') return true;
      // concluida (sem data propria): permanece acessivel no dia de hoje
      if (day === hoje) return true;
      return false;
    });
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
    return DB.getExtras().reduce((s, x) => {
      const emMin = (x.unidade === 'min' || x.tipo === 'video');
      return s + (x.historico || []).filter(h => h.data === day)
        .reduce((a, h) => a + (h.minutos || (emMin ? (h.quantidade || 0) : 0)), 0);
    }, 0);
  },
  _minInRange(a, b) {
    return DB.getExtras().reduce((s, x) => {
      const emMin = (x.unidade === 'min' || x.tipo === 'video');
      return s + (x.historico || []).filter(h => h.data >= a && h.data <= b)
        .reduce((acc, h) => acc + (h.minutos || (emMin ? (h.quantidade || 0) : 0)), 0);
    }, 0);
  },
  _minTotal() {
    return DB.getExtras().reduce((s, x) => {
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
  // Puxa os assuntos prioritários do Plano de pontos fracos, com a meta já calculada
  puxarDoPlano() {
    if (typeof PlanoEngine === 'undefined' || typeof DesempenhoTecScreen === 'undefined') { showToast('Plano indisponível'); return; }
    // guarda o estado do diálogo: prioridade (ordenação) e disciplinas marcadas
    this._planoOrd = this._planoOrd || 'pior';
    this._planoDiscSel = this._planoDiscSel || new Set(); // vazio = todas
    this._planoDiscOpen = false;
    this._planoSel = new Set();
    // recomputa os candidatos com a ordenação escolhida (aproveita o motor do Plano)
    this._planoRecalc = () => {
      const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(),
        Object.assign({}, PlanoEngine.prefs(), { disciplina: '__todas__', limite: 200, ordenar: this._planoOrd }));
      if (!r || r.erro) { this._planoCand = null; this._planoErr = (r && r.erro) || 'erro'; return; }
      const jaTem = new Set(DB.getExtras().filter(e => e.origemPlano).map(e => ReforcoEngine.norm(e.origemPlano.topico)));
      this._planoCand = []
        .concat((r.itens || []).map(x => ({ ...x, motivo: 'reforco', alvo: x.custoQ })))
        .concat((r.pequenas || []).map(x => ({ ...x, motivo: 'diagnostico', alvo: x.faltaAmostra })))
        .filter(x => !jaTem.has(ReforcoEngine.norm(x.nome)));
      this._planoErr = null;
    };
    this._planoRecalc();
    if (this._planoErr) {
      showToast(this._planoErr === 'sem-retrato'
        ? 'Importe um retrato do TEC em Desempenho TEC → Análise'
        : 'Sem dados suficientes no Plano ainda');
      return;
    }
    if (!this._planoCand.length) { showToast('Todos os assuntos prioritários já têm atividade'); return; }
    // marca os 3 primeiros por padrão
    this._planoCand.forEach((_, i) => { if (i < 3) this._planoSel.add(i); });

    const ORDENS = [
      ['pior', '🔴 Pior acerto primeiro'],
      ['ganhoGeral', '📊 Maior ganho no Aproveitamento geral'],
      ['ganhoDominio', '⚖️ Maior ganho no Domínio'],
      ['banca', '🎯 Prioridade na banca'],
      ['rendimento', '⚡ Melhor retorno'],
      ['queda', '📉 Maior queda recente'],
      ['volume', '📚 Mais questões resolvidas']
    ];
    const temInc = (typeof ReforcoEngine !== 'undefined') && ReforcoEngine.hasIncidencia && ReforcoEngine.hasIncidencia();

    // HTML fixo do diálogo (a lista e o dropdown de disciplinas são preenchidos por JS)
    const body = `
      <p class="hint" style="margin:0 0 10px;">Cada item vira uma atividade de questões com a meta já calculada. Ao importar o próximo retrato do TEC, o Plano avisa se o assunto saiu da lista.</p>
      <div class="pl-modal-tools">
        <label class="pl-modal-field">
          <span>Prioridade</span>
          <select id="pl-ordenar">
            ${ORDENS.map(o => `<option value="${o[0]}" ${o[0] === this._planoOrd ? 'selected' : ''} ${o[0] === 'banca' && !temInc ? 'disabled' : ''}>${o[1]}${o[0] === 'banca' && !temInc ? ' (importe a incidência)' : ''}</option>`).join('')}
          </select>
        </label>
        <div class="pl-modal-field" style="position:relative;">
          <span>Disciplinas</span>
          <button type="button" class="pl-disc-toggle" id="pl-disc-toggle">Todas <span class="chev">▾</span></button>
          <div class="pl-disc-panel" id="pl-disc-panel" style="display:none;"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px;">
        <span class="hint" id="pl-conta" style="margin:0;flex:1;min-width:0;"></span>
        <button type="button" class="btn-secondary" id="pl-marcar" style="white-space:nowrap;padding:5px 10px;">Marcar visíveis</button>
        <button type="button" class="btn-secondary" id="pl-limpar" style="white-space:nowrap;padding:5px 10px;">Limpar</button>
      </div>
      <div style="max-height:42vh;overflow:auto;" id="pl-lista"></div>`;

    new Promise((resolve) => {
      UI._resolve = resolve; UI._mode = 'confirm';
      UI._open('🏁 Puxar do Plano', 'Assuntos prioritários com meta pronta', body, { okText: 'Criar atividades' });
    }).then((ok) => {
      if (!ok) return;
      let n = 0;
      (this._planoCand || []).forEach((x, i) => {
        if (!this._planoSel || !this._planoSel.has(i)) return;
        const e = DB.addExtra({
          titulo: (x.motivo === 'diagnostico' ? 'Diagnosticar: ' : 'Reforçar: ') + x.nome,
          tipo: 'questoes', disciplina: x.disciplina || '', unidade: 'questoes',
          alvo: Math.max(1, x.alvo), periodo: 'unica', contaMetricas: false,
          obs: 'Gerado pelo Plano de pontos fracos.'
        });
        if (e) { DB.updateExtra(e.id, { origemPlano: { topico: x.nome, disciplina: x.disciplina || '', motivo: x.motivo, criadoEm: todayLocal() } }); n++; }
      });
      this.render();
      showToast(n ? n + ' atividade(s) criada(s) ✓' : 'Nenhuma selecionada');
    });

    // liga a interface do diálogo depois de renderizado
    setTimeout(() => this._planoBind(), 40);
  },
  // Preenche a lista de assuntos do diálogo conforme o filtro de disciplinas atual.
  _planoRenderLista() {
    const host = document.getElementById('pl-lista');
    if (!host) return;
    const sel = this._planoDiscSel;
    const cand = this._planoCand || [];
    const visiveis = cand
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => sel.size === 0 || sel.has(x.disciplina || ''));
    host.innerHTML = visiveis.length ? visiveis.map(({ x, i }) => `
      <label class="sug-row pl-linha" style="align-items:flex-start;">
        <input type="checkbox" class="pl-pick" data-i="${i}" ${this._planoSel.has(i) ? 'checked' : ''}>
        <div style="min-width:0;">
          <div style="font-weight:700;">${escapeHtml(x.nome)}</div>
          <div class="hint" style="margin:2px 0 0;">
            ${x.disciplina ? escapeHtml(x.disciplina) + ' · ' : ''}
            ${x.taxa != null ? x.taxa.toFixed(0) + '% de acerto' : 'sem taxa'} em ${x.qJanela} questões
            ${(x.incid > 0) ? ' · 🎯 incidência ' + x.incid : ''} ·
            ${x.motivo === 'diagnostico'
              ? `<strong>diagnóstico</strong>: resolver ${x.alvo} para saber onde está`
              : `<strong>reforço</strong>: ${x.alvo} questões · +${x.ganhoPP.toFixed(1)}pp de domínio`}
          </div>
        </div>
      </label>`).join('') : `<p class="hint" style="padding:16px 4px;">Nenhum assunto nas disciplinas selecionadas.</p>`;
    host.querySelectorAll('.pl-pick').forEach(cb => cb.addEventListener('change', () => {
      const i = parseInt(cb.dataset.i, 10);
      if (cb.checked) this._planoSel.add(i); else this._planoSel.delete(i);
      this._planoUpdConta();
    }));
    this._planoUpdConta();
  },
  _planoUpdConta() {
    const conta = document.getElementById('pl-conta');
    if (!conta) return;
    const sel = this._planoDiscSel;
    const cand = this._planoCand || [];
    const vis = cand.filter(x => sel.size === 0 || sel.has(x.disciplina || '')).length;
    const marcados = this._planoSel ? this._planoSel.size : 0;
    conta.innerHTML = (sel.size === 0 ? `${vis} assunto(s)` : `${vis} assunto(s) em ${sel.size} disciplina(s)`)
      + ` · <strong>${marcados} marcado(s)</strong>`;
  },
  // Monta o dropdown de disciplinas (com contagem de pontos fracos) e liga tudo.
  _planoBind() {
    const cand = this._planoCand || [];
    // disciplinas com contagem
    const cont = {};
    cand.forEach(x => { const d = x.disciplina || '—'; cont[d] = (cont[d] || 0) + 1; });
    const discs = Object.keys(cont).sort((a, b) => cont[b] - cont[a] || a.localeCompare(b, 'pt-BR'));
    const panel = document.getElementById('pl-disc-panel');
    const toggle = document.getElementById('pl-disc-toggle');
    const setToggleLabel = () => {
      const n = this._planoDiscSel.size;
      if (toggle) toggle.firstChild.textContent = (n === 0 ? 'Todas ' : n + ' selecionada' + (n > 1 ? 's ' : ' '));
    };
    if (panel) {
      panel.innerHTML = discs.map(d => `
        <label class="pl-disc-check">
          <input type="checkbox" data-disc="${escapeHtml(d)}" ${this._planoDiscSel.has(d) ? 'checked' : ''}>
          <span class="pl-disc-name">${escapeHtml(d)}</span>
          <span class="pl-disc-count">${cont[d]}</span>
        </label>`).join('') + `
        <div class="pl-disc-actions">
          <button type="button" data-act="all">Todas</button>
        </div>`;
      panel.querySelectorAll('input[data-disc]').forEach(chk => chk.addEventListener('change', () => {
        const d = chk.dataset.disc;
        if (chk.checked) this._planoDiscSel.add(d); else this._planoDiscSel.delete(d);
        setToggleLabel();
        this._planoRenderLista();
      }));
      const allBtn = panel.querySelector('[data-act="all"]');
      if (allBtn) allBtn.addEventListener('click', () => {
        this._planoDiscSel.clear();
        panel.querySelectorAll('input[data-disc]').forEach(c => c.checked = false);
        setToggleLabel(); this._planoRenderLista();
      });
    }
    if (toggle) toggle.addEventListener('click', () => {
      this._planoDiscOpen = !this._planoDiscOpen;
      if (panel) panel.style.display = this._planoDiscOpen ? 'block' : 'none';
      toggle.classList.toggle('open', this._planoDiscOpen);
    });
    setToggleLabel();
    // seletor de prioridade → recomputa e repinta
    const ord = document.getElementById('pl-ordenar');
    if (ord) ord.addEventListener('change', () => {
      this._planoOrd = ord.value;
      this._planoRecalc();
      // mantém as marcações por NOME do assunto ao reordenar
      const marcadosNomes = new Set([...this._planoSel].map(i => (cand[i] || {}).nome).filter(Boolean));
      this._planoSel = new Set();
      (this._planoCand || []).forEach((x, i) => { if (marcadosNomes.has(x.nome)) this._planoSel.add(i); });
      // atualiza o dropdown de disciplinas (a contagem pode mudar) e a lista
      this._planoBind();
      this._planoRenderLista();
    });
    // marcar visíveis / limpar
    const marcar = document.getElementById('pl-marcar');
    if (marcar) marcar.addEventListener('click', () => {
      const sel = this._planoDiscSel;
      (this._planoCand || []).forEach((x, i) => { if (sel.size === 0 || sel.has(x.disciplina || '')) this._planoSel.add(i); });
      this._planoRenderLista();
    });
    const limpar = document.getElementById('pl-limpar');
    if (limpar) limpar.addEventListener('click', () => { this._planoSel.clear(); this._planoRenderLista(); });
    this._planoRenderLista();
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
    const feito = !rec ? (x.progresso || 0) : (diaria ? feitoDia : DB.extraProgressoPeriodo(x));
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
    const progBlock = (alvo > 0)
      ? `<div class="exd-prog">
           <div class="bar"><i class="${barFull ? 'full' : ''}" style="width:${pct}%"></i></div>
           <div class="nums"><span><b>${feito.toLocaleString('pt-BR')}</b> / ${alvo.toLocaleString('pt-BR')} ${unidLabel}${escopo ? ' <span class="opt">' + escopo + '</span>' : ''}</span><span>${pct}%</span></div>
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
              ${discTag}${recTag}${metaTag}
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
        const x = DB.getExtra(id);
        const jaFeita = DB.extraConcluidaEm(x, day);
        DB.setConcluidaDia(id, day, !jaFeita);
        this.render();
        if (!jaFeita) showToast(DB.extraRecorrente(x) ? 'Concluída neste dia 🎉' : 'Atividade concluída 🎉');
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
        DB.addExtraProgress(id, q, 0, { data: day, acertos: acEl ? acEl.value : null });
        this._addMoreFor = null;
        this.render();
        showToast(day === todayLocal() ? 'Registrado ✓' : 'Registrado em ' + formatDateShort(day) + ' ✓');
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
  manageOpen() { this.renderManageList(); const m = document.getElementById('extras-manage-modal'); if (m) m.style.display = 'flex'; },
  manageClose() { const m = document.getElementById('extras-manage-modal'); if (m) m.style.display = 'none'; },
  renderManageList() {
    const box = document.getElementById('extras-manage-list');
    if (!box) return;
    const extras = DB.getExtras();
    if (!extras.length) { box.innerHTML = `<p class="hint" style="padding:12px 2px;">Nenhuma atividade ainda. Use <strong>＋ Nova atividade</strong> para criar a primeira.</p>`; return; }
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
    const rec = extras.filter(x => DB.extraRecorrente(x));
    const uni = extras.filter(x => !DB.extraRecorrente(x));
    box.innerHTML =
      (rec.length ? `<div class="exm-group-title">🔁 Recorrentes (${rec.length})</div>` + rec.map(rowHtml).join('') : '') +
      (uni.length ? `<div class="exm-group-title">⭐ Avulsas / únicas (${uni.length})</div>` + uni.map(rowHtml).join('') : '');
    box.querySelectorAll('.exm-row').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.exm-edit').addEventListener('click', () => this.openModal(id));
      row.querySelector('.exm-del').addEventListener('click', () => this.excluir(id));
    });
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
    // se veio das sugestões: marca como adicionada e volta para a lista de sugestões
    if (this._fromSuggest != null) {
      if (this._sugAdded) this._sugAdded.add(this._fromSuggest);
      this._fromSuggest = null;
      this.render();
      this.openSuggest(); // reabre para configurar as próximas
    } else {
      this.render();
    }
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
  // ===== Sugestões a partir dos pontos fracos do TEC =====
  _suggestions() {
    const snap = (typeof DesempenhoTecScreen !== 'undefined' && DesempenhoTecScreen.scopedSnapshot)
      ? DesempenhoTecScreen.scopedSnapshot() : ReforcoEngine.currentSnapshot();
    if (!snap) return [];
    const bancaEl = document.getElementById('extra-suggest-banca');
    const discEl = document.getElementById('extra-suggest-disc');
    const ordEl = document.getElementById('extra-suggest-ordenar');
    const minqEl = document.getElementById('extra-suggest-minq');
    const banca = (bancaEl && bancaEl.value) || (DB.getBancas()[0]) || '__todas__';
    const ordenarPor = (ordEl && ordEl.value) || 'oportunidade';
    const minq = (minqEl && parseInt(minqEl.value, 10)) || 8;
    const res = ReforcoEngine.suggestFrontier(snap, { banca, estrategia: 0.5, granularidade: 0.5, minQuestoes: minq, limite: 60, ordenarPor });
    let items = (res.items || []).filter(it => it.selo !== 'ok');
    // filtro por disciplina
    const disc = discEl ? discEl.value : '__todas__';
    if (disc && disc !== '__todas__') { const nk = ReforcoEngine.norm(disc); items = items.filter(it => ReforcoEngine.norm(it.disciplina) === nk); }
    return items.slice(0, 20);
  },
  _populateSuggestFilters() {
    const bancaEl = document.getElementById('extra-suggest-banca');
    const discEl = document.getElementById('extra-suggest-disc');
    if (bancaEl) {
      const bancas = DB.getBancas();
      const cur = bancaEl.value;
      bancaEl.innerHTML = (bancas.length ? '' : '<option value="__todas__">Todas</option>') +
        bancas.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
      if (cur && [...bancaEl.options].some(o => o.value === cur)) bancaEl.value = cur;
    }
    if (discEl) {
      const bsel = bancaEl ? bancaEl.value : '__todas__';
      const discs = [...new Set(DB.getIncidencia().filter(r => r.depth === 0 && (bsel === '__todas__' || r.banca === bsel)).map(r => r.topico))].sort();
      const cur = discEl.value || '__todas__';
      discEl.innerHTML = `<option value="__todas__">📚 Todas as disciplinas</option>` + discs.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
      if ([...discEl.options].some(o => o.value === cur)) discEl.value = cur;
    }
  },
  _sugAdded: null,   // conjunto de índices já adicionados (para marcar ✓)
  openSuggest() {
    this._populateSuggestFilters();
    const sugs = this._suggestions();
    this._sugAdded = this._sugAdded || new Set();
    const listEl = document.getElementById('extra-suggest-list');
    if (!sugs.length) {
      listEl.innerHTML = `<div class="extras-empty" style="padding:24px;">Nenhum ponto fraco encontrado no escopo atual do Desempenho TEC.<br>Importe/atualize seus retratos e a incidência da banca primeiro.</div>`;
      $id('extra-suggest-count').textContent = '';
    } else {
      this._sugCache = sugs;
      listEl.innerHTML = sugs.map((it, i) => {
        const added = this._sugAdded.has(i);
        return `
        <div class="sug-row ${added ? 'is-added' : ''}">
          <input type="checkbox" class="sug-chk" data-i="${i}" ${added ? 'disabled' : ''}>
          <span class="sug-body">
            <span class="sug-name" title="${escapeHtml(it.nome)}">${escapeHtml(it.nome)}</span>
            <span class="sug-meta">
              <span class="sug-selo ${it.selo}">${it.selo === 'fraco' ? '🔥 fraco' : '⚠️ atenção'}</span>
              <span class="sug-tag">${escapeHtml(it.disciplina)}</span>
              <span class="sug-tag">${it.taxaErro}% erro</span>
              <span class="sug-tag">N=${it.incidencia}</span>
              <span class="sug-tag pts">+${it.pontosRecuperaveis} pts</span>
            </span>
          </span>
          ${added
            ? `<span class="sug-added-badge">✓ adicionada</span>`
            : `<button type="button" class="btn-secondary sug-config" data-i="${i}" title="Configurar a meta e adicionar esta atividade">⚙ Configurar</button>`}
        </div>`;
      }).join('');
      this._updateSugCount();
    }
    $id('extra-suggest-modal').style.display = 'flex';
    listEl.querySelectorAll('.sug-chk').forEach(c => c.addEventListener('change', () => this._updateSugCount()));
    listEl.querySelectorAll('.sug-config').forEach(b => b.addEventListener('click', () => this.configureSuggestion(parseInt(b.dataset.i, 10))));
    // botão marcar/desmarcar todos reflete o estado
    this._syncSelectAllBtn();
  },
  _updateSugCount() {
    const n = document.querySelectorAll('#extra-suggest-list .sug-chk:checked').length;
    const el = document.getElementById('extra-suggest-count');
    if (el) el.textContent = n ? `${n} selecionada(s) para adição rápida` : 'Configure uma a uma (⚙) ou marque para adicionar em lote';
    this._syncSelectAllBtn();
  },
  _syncSelectAllBtn() {
    const btn = document.getElementById('extra-suggest-all');
    if (!btn) return;
    const boxes = [...document.querySelectorAll('#extra-suggest-list .sug-chk:not(:disabled)')];
    const allOn = boxes.length > 0 && boxes.every(c => c.checked);
    btn.textContent = allOn ? '☐ Desmarcar todos' : '☑ Marcar todos';
    btn.dataset.state = allOn ? 'on' : 'off';
  },
  toggleSelectAll() {
    const boxes = [...document.querySelectorAll('#extra-suggest-list .sug-chk:not(:disabled)')];
    const btn = document.getElementById('extra-suggest-all');
    const turnOn = !(btn && btn.dataset.state === 'on');
    boxes.forEach(c => c.checked = turnOn);
    this._updateSugCount();
  },
  // Defaults de meta/unidade por tipo (usado no config e no lote)
  _tipoDefaults(tipo) {
    return {
      revisao: { prefixo: 'Revisar', unidade: 'sessoes', alvo: 3 },
      questoes: { prefixo: 'Questões de', unidade: 'questoes', alvo: 20 },
      video: { prefixo: 'Vídeo de', unidade: 'min', alvo: 30 },
      anki: { prefixo: 'Flashcards de', unidade: 'cards', alvo: 20 }
    }[tipo] || { prefixo: 'Estudar', unidade: 'itens', alvo: 0 };
  },
  // ⚙ Configurar UMA sugestão: abre a caixinha (modal) pré-preenchida com meta ajustável
  configureSuggestion(i) {
    const it = this._sugCache[i];
    if (!it) return;
    const tipo = $id('extra-suggest-tipo').value;
    const d = this._tipoDefaults(tipo);
    this._fromSuggest = i; // marca que veio das sugestões
    // esconde o modal de sugestões e abre o de configuração por cima
    $id('extra-suggest-modal').style.display = 'none';
    this.openModal(null, {
      titulo: `${d.prefixo} ${it.nome}`,
      tipo, disciplina: it.disciplina,
      alvo: d.alvo, unidade: d.unidade, periodo: 'unica', contaMetricas: true
    });
  },
  // Adição em LOTE das marcadas (com defaults do tipo escolhido)
  addSuggested() {
    const tipo = $id('extra-suggest-tipo').value;
    const checks = [...document.querySelectorAll('#extra-suggest-list .sug-chk:checked')];
    if (!checks.length) { showToast('Marque as sugestões ou use ⚙ Configurar para ajustar cada uma'); return; }
    const d = this._tipoDefaults(tipo);
    let n = 0;
    checks.forEach(c => {
      const it = this._sugCache[parseInt(c.dataset.i, 10)];
      if (!it) return;
      DB.addExtra({ titulo: `${d.prefixo} ${it.nome}`, tipo, disciplina: it.disciplina, alvo: d.alvo, unidade: d.unidade, periodo: 'unica', contaMetricas: true });
      this._sugAdded.add(parseInt(c.dataset.i, 10));
      n++;
    });
    $id('extra-suggest-modal').style.display = 'none';
    this._sugAdded = new Set(); // limpa para a próxima abertura
    this.render();
    showToast(`${n} atividade(s) criada(s) a partir dos pontos fracos ✓`);
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
  on('extras-new-btn', 'click', () => { ExtrasScreen._fromSuggest = null; ExtrasScreen._sugAdded = new Set(); ExtrasScreen.openModal(null); });
  on('extras-suggest-btn', 'click', () => { ExtrasScreen._sugAdded = new Set(); ExtrasScreen.openSuggest(); });
  on('extras-plano-btn', 'click', () => ExtrasScreen.puxarDoPlano());
  // Gerenciador de atividades (recorrentes + avulsas), separado da missão do dia
  on('extras-manage-btn', 'click', () => ExtrasScreen.manageOpen());
  on('extras-manage-close', 'click', () => ExtrasScreen.manageClose());
  on('extras-manage-done', 'click', () => ExtrasScreen.manageClose());
  on('extras-manage-new', 'click', () => { ExtrasScreen._fromSuggest = null; ExtrasScreen._sugAdded = new Set(); ExtrasScreen.openModal(null); });
  const _mng = document.getElementById('extras-manage-modal');
  if (_mng) _mng.addEventListener('click', (e) => { if (e.target === _mng) ExtrasScreen.manageClose(); });
  on('extra-suggest-close', 'click', () => { $id('extra-suggest-modal').style.display = 'none'; ExtrasScreen._sugAdded = new Set(); });
  on('extra-suggest-cancel', 'click', () => { $id('extra-suggest-modal').style.display = 'none'; ExtrasScreen._sugAdded = new Set(); });
  on('extra-suggest-add', 'click', () => ExtrasScreen.addSuggested());
  on('extra-suggest-all', 'click', () => ExtrasScreen.toggleSelectAll());
  // filtros das sugestões (recarregam a lista) — como no Reforço
  on('extra-suggest-banca', 'change', () => { ExtrasScreen._populateSuggestFilters(); ExtrasScreen.openSuggest(); });
  on('extra-suggest-disc', 'change', () => ExtrasScreen.openSuggest());
  on('extra-suggest-ordenar', 'change', () => ExtrasScreen.openSuggest());
  on('extra-suggest-minq', 'input', () => ExtrasScreen.openSuggest());
  // fechar/cancelar o config: se veio das sugestões, volta para elas
  const closeExtraModal = () => {
    $id('extra-modal').style.display = 'none';
    const okBtn = document.getElementById('extra-save'); if (okBtn) okBtn.textContent = 'Salvar';
    if (ExtrasScreen._fromSuggest != null) { ExtrasScreen._fromSuggest = null; ExtrasScreen.openSuggest(); }
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
  if (e.detail.screen === 'extras') ExtrasScreen.render();
});
