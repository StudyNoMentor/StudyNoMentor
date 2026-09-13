/* ============================================================
   REFORÇO DO PLANO — agenda automática de sessões diárias
   ============================================================
   O ciclo do Plano é o CONTRATO (ex.: 25 questões). A Missão do dia é somente
   uma FATIA desse contrato. Fechar a sessão de hoje nunca pode encerrar o ciclo
   enquanto ainda houver questões a cumprir.

   Regras operacionais:
   - no máximo 3 reforços do Plano por dia;
   - sempre que possível, 3 disciplinas diferentes;
   - uma mesma frente nunca aparece duas vezes no mesmo dia;
   - sessão de até 15 questões, dividida de forma equilibrada (17 => 9+8,
     não 15+2; 25 => 13+12);
   - uma continuação tenta compartilhar o próximo dia com outro reforço, sem
     atrasar mais de 2 dias só para agrupar;
   - sessão parcial fechada vira fato histórico e o RESTANTE é redistribuído;
   - sessão perdida não vira dívida vencida: ao abrir o app ela é realocada;
   - histórico e sessões já concluídas nunca são apagados pela reorganização;
   - o ciclo só termina ao atingir a meta total ou pelo botão explícito
     "Concluir" do painel de ciclos.
   ============================================================ */
(function instalarAgendaAutoReforco() {
  if (typeof DB === 'undefined' || typeof ExtrasScreen === 'undefined') return;

  const EX = ExtrasScreen;
  const MAX_POR_DIA = 3;
  const MAX_SESSAO = (typeof PlanoExecucaoReal !== 'undefined' && PlanoExecucaoReal.maxSessao) || 15;
  const JANELA_AGRUPAR_DIAS = 2;
  const HORIZONTE_DIAS = 90;

  const setConcluidaBase = typeof DB.setConcluidaDia === 'function' ? DB.setConcluidaDia.bind(DB) : null;
  const extraConcluidaBase = typeof DB.extraConcluidaEm === 'function' ? DB.extraConcluidaEm.bind(DB) : null;
  const addProgressBase = typeof DB.addExtraProgress === 'function' ? DB.addExtraProgress.bind(DB) : null;
  const undoDayBase = typeof DB.undoExtraProgressDay === 'function' ? DB.undoExtraProgressDay.bind(DB) : null;
  const undoBase = typeof DB.undoExtraProgress === 'function' ? DB.undoExtraProgress.bind(DB) : null;

  const num = (v, f) => Number.isFinite(Number(v)) ? Number(v) : f;
  const inteiro = (v, f) => Math.max(0, Math.round(num(v, f)));
  const hoje = () => (typeof todayLocal === 'function' ? todayLocal() : new Date().toISOString().slice(0, 10));
  const addDias = (iso, n) => {
    const d = new Date(String(iso) + 'T00:00:00');
    d.setDate(d.getDate() + n);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dia = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dia}`;
  };
  const normDisc = (s) => String(s || 'Sem disciplina').trim().toLocaleLowerCase('pt-BR');
  const ehPlano = (e) => !!(e && e.origemPlano && e.origemPlano.topico && e.tipo === 'questoes');
  const historicoDia = (e, dia) => (e && e.historico || []).filter(h => h.data === dia)
    .reduce((a, h) => a + (Number(h.quantidade) || 0), 0);

  /* Divide SEM criar rabicho inútil. O objetivo é produzir blocos comparáveis,
     bons para alternância e para leitura do resultado do ciclo. */
  function dividir(restante, teto) {
    restante = inteiro(restante, 0);
    teto = Math.max(1, inteiro(teto, MAX_SESSAO));
    if (!restante) return [];
    const n = Math.max(1, Math.ceil(restante / teto));
    const base = Math.floor(restante / n), sobra = restante % n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(base + (i < sobra ? 1 : 0));
    return out.filter(Boolean);
  }

  function diaValido(ocupacao, dia, tarefa, maxPorDia) {
    const g = ocupacao[dia] || [];
    if (g.length >= maxPorDia) return false;
    if (g.some(x => String(x.id) === String(tarefa.id))) return false;
    if (g.some(x => normDisc(x.disciplina) === normDisc(tarefa.disciplina))) return false;
    return true;
  }

  /* Planejador puro, exposto também aos testes. Primeiro roda a 1ª sessão de
     cada frente, depois a 2ª etc.: breadth-first em vez de esgotar um assunto.
     Dentro de cada rodada, preenche o mesmo dia até 3 disciplinas. */
  function planejarModelo(itens, inicio, opts) {
    opts = opts || {};
    inicio = inicio || hoje();
    const maxPorDia = Math.max(1, inteiro(opts.maxPorDia, MAX_POR_DIA));
    const maxSessao = Math.max(1, inteiro(opts.maxSessao, MAX_SESSAO));
    const horizonte = Math.max(7, inteiro(opts.horizonteDias, HORIZONTE_DIAS));
    const agrupar = Math.max(0, inteiro(opts.janelaAgruparDias, JANELA_AGRUPAR_DIAS));
    const ocupacao = {};
    (opts.ocupacao || []).forEach(x => {
      if (!x || !x.data) return;
      (ocupacao[x.data] = ocupacao[x.data] || []).push({ id: x.id, disciplina: x.disciplina });
    });

    const preparados = (itens || []).map((x, ordem) => ({
      id: x.id,
      disciplina: x.disciplina || 'Sem disciplina',
      minDia: x.minDia && x.minDia > inicio ? x.minDia : inicio,
      ordem: x.ordem == null ? ordem : x.ordem,
      blocos: dividir(x.restante, maxSessao)
    })).filter(x => x.blocos.length);

    const tarefas = [];
    const maior = preparados.reduce((m, x) => Math.max(m, x.blocos.length), 0);
    for (let rodada = 0; rodada < maior; rodada++) {
      preparados.slice().sort((a, b) => a.ordem - b.ordem).forEach(x => {
        if (x.blocos[rodada]) tarefas.push({ id: x.id, disciplina: x.disciplina, alvo: x.blocos[rodada], rodada, minDia: x.minDia });
      });
    }

    const porId = {}, anterior = {};
    tarefas.forEach(t => {
      let minimo = t.minDia;
      if (anterior[t.id] && addDias(anterior[t.id], 1) > minimo) minimo = addDias(anterior[t.id], 1);
      let primeiro = null, agrupado = null;
      for (let i = 0; i <= horizonte; i++) {
        const dia = addDias(minimo, i);
        if (!diaValido(ocupacao, dia, t, maxPorDia)) continue;
        if (!primeiro) primeiro = dia;
        if ((ocupacao[dia] || []).length > 0 && i <= agrupar) { agrupado = dia; break; }
        if (i > agrupar && primeiro) break;
      }
      const dia = agrupado || primeiro || minimo;
      (ocupacao[dia] = ocupacao[dia] || []).push({ id: t.id, disciplina: t.disciplina });
      (porId[t.id] = porId[t.id] || []).push({ data: dia, alvo: t.alvo, rodada: t.rodada });
      anterior[t.id] = dia;
    });

    const porDia = {};
    Object.keys(porId).forEach(id => porId[id].forEach(s => {
      (porDia[s.data] = porDia[s.data] || []).push({ id, alvo: s.alvo });
    }));
    return { porId, porDia, ocupacao };
  }

  function referenciaOperacional() {
    try {
      if (EX && typeof EX._planoRefOperacional === 'function') return EX._planoRefOperacional();
    } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'agenda-ref-plano'); }
    return null;
  }

  function feitoCiclo(e, ref) {
    let feito = Math.max(0, num(e && e.progresso, 0));
    try {
      if (ehPlano(e) && typeof PlanoCiclo !== 'undefined' && PlanoCiclo && typeof PlanoCiclo.avaliar === 'function') {
        const a = PlanoCiclo.avaliar(e, ref || referenciaOperacional());
        if (a && Number.isFinite(Number(a.feito))) feito = Math.max(feito, Number(a.feito));
      }
    } catch (err) { if (typeof _quiet === 'function') _quiet(err, 'agenda-feito-ciclo'); }
    return Math.max(0, Math.round(feito));
  }

  function sessoesOrdenadas(e) {
    const a = e && e.origemPlano && e.origemPlano.agendaAuto;
    const s = a && a.sessoes ? a.sessoes : {};
    return Object.keys(s).sort().map(data => Object.assign({ data }, s[data]));
  }

  function proximaSessao(e, depoisDe) {
    const concluidas = new Set((e && e.concluidasEm) || []);
    return sessoesOrdenadas(e).find(s => s.data > (depoisDe || '') && s.estado !== 'concluida' && !concluidas.has(s.data)) || null;
  }

  /* Reorganiza TODAS as frentes abertas em uma única transação de extras.
     Datas históricas são fatos; só o futuro é fluido. */
  function replanejar(inicio, opcoes) {
    opcoes = opcoes || {};
    const hj = hoje();
    inicio = inicio || hj;
    const list = DB.getExtras ? DB.getExtras() : [];
    const ativos = list.filter(e => ehPlano(e) && e.status !== 'concluida');
    if (!ativos.length) return { alterou: false, porDia: {} };

    if (EX) EX._planoRefCard = null;
    const ref = referenciaOperacional();
    const dados = [];
    const fixos = [];
    const novosPorId = {};

    ativos.forEach((e, ordem) => {
      const o = e.origemPlano || {};
      const antiga = o.agendaAuto || {};
      const sessAnt = antiga.sessoes || {};
      const concluidas = new Set(e.concluidasEm || []);
      const alvo = Math.max(1, inteiro(e.alvo, inteiro(o.metaCicloQ, 1)));
      const feito = Math.min(alvo, feitoCiclo(e, ref));
      let restante = Math.max(0, alvo - feito);
      const mantidas = {};

      /* Passado com histórico/conclusão nunca se move. Planejamento perdido sem
         registro não é dívida: some do passado e volta para a fila de hoje. */
      const datasFato = new Set([...(e.concluidasEm || []), ...(e.historico || []).map(h => h.data).filter(Boolean)]);
      [...datasFato].sort().forEach(dia => {
        if (dia > hj) return;
        const ant = sessAnt[dia] || {};
        const qDia = historicoDia(e, dia);
        mantidas[dia] = Object.assign({}, ant, {
          alvo: Math.max(1, inteiro(ant.alvo, qDia || Math.min(MAX_SESSAO, alvo))),
          estado: concluidas.has(dia) ? 'concluida' : (ant.estado || 'historica')
        });
      });

      /* Se a sessão de HOJE já estava planejada e ainda está aberta, ela fica
         estável enquanto o usuário registra. Reservamos apenas o que falta
         dentro dela; o restante do ciclo já pode ocupar os dias seguintes. */
      const hojeAnt = sessAnt[hj];
      const hojeConcluido = concluidas.has(hj);
      if (!hojeConcluido && hojeAnt && hojeAnt.estado !== 'concluida' && restante > 0 && opcoes.preservarHoje !== false) {
        const feitoHoje = historicoDia(e, hj);
        const alvoHoje = Math.max(1, inteiro(hojeAnt.alvo, Math.min(MAX_SESSAO, restante + feitoHoje)));
        const faltaHoje = Math.max(0, alvoHoje - feitoHoje);
        if (faltaHoje > 0) {
          mantidas[hj] = Object.assign({}, hojeAnt, { alvo: alvoHoje, estado: 'planejada' });
          fixos.push({ id: e.id, disciplina: e.disciplina, data: hj });
          restante = Math.max(0, restante - Math.min(restante, faltaHoje));
        }
      }

      novosPorId[e.id] = mantidas;
      const minDia = hojeConcluido || mantidas[hj] ? addDias(hj, 1) : (inicio > hj ? inicio : hj);
      if (restante > 0) dados.push({ id: e.id, disciplina: e.disciplina, restante, minDia, ordem });
    });

    const plano = planejarModelo(dados, inicio > hj ? inicio : hj, { ocupacao: fixos });
    Object.keys(plano.porId).forEach(id => {
      (plano.porId[id] || []).forEach(s => {
        novosPorId[id] = novosPorId[id] || {};
        novosPorId[id][s.data] = { alvo: s.alvo, estado: 'planejada', rodada: s.rodada };
      });
    });

    let alterou = false;
    ativos.forEach(e => {
      const o = e.origemPlano || {};
      const anterior = o.agendaAuto || {};
      const sessoes = {};
      Object.keys(novosPorId[e.id] || {}).sort().forEach(d => { sessoes[d] = novosPorId[e.id][d]; });
      const datasFato = [...new Set([...(e.concluidasEm || []), ...(e.historico || []).map(h => h.data).filter(Boolean)])];
      const datas = [...new Set([...Object.keys(sessoes), ...datasFato])].sort();
      const assinaturaAntes = JSON.stringify({ s: anterior.sessoes || {}, d: (e.datas || []).slice().sort() });
      const assinaturaDepois = JSON.stringify({ s: sessoes, d: datas });
      if (assinaturaAntes === assinaturaDepois) return;
      e.datas = datas;
      e.origemPlano = Object.assign({}, o, {
        agendaAuto: Object.assign({}, anterior, {
          versao: 1,
          maxPorDia: MAX_POR_DIA,
          maxSessao: MAX_SESSAO,
          sessoes,
          atualizadoEm: new Date().toISOString()
        })
      });
      e.updatedAt = new Date().toISOString();
      alterou = true;
    });
    if (alterou && DB.saveExtras) DB.saveExtras(list);
    return { alterou, porDia: plano.porDia };
  }

  function salvarSessao(id, dia, on, opts) {
    opts = opts || {};
    const list = DB.getExtras();
    const e = list.find(x => String(x.id) === String(id));
    if (!e || !ehPlano(e)) return null;
    if (dia > hoje()) return e;
    e.concluidasEm = Array.isArray(e.concluidasEm) ? e.concluidasEm : [];
    const set = new Set(e.concluidasEm);
    if (on) set.add(dia); else set.delete(dia);
    e.concluidasEm = [...set].sort();
    const o = e.origemPlano || {}, ag = Object.assign({}, o.agendaAuto || {}), sessoes = Object.assign({}, ag.sessoes || {});
    const ant = sessoes[dia] || {};
    sessoes[dia] = Object.assign({}, ant, {
      alvo: Math.max(1, inteiro(ant.alvo, Math.min(MAX_SESSAO, Math.max(1, inteiro(e.alvo, MAX_SESSAO))))),
      estado: on ? 'concluida' : 'planejada',
      concluidaEm: on ? new Date().toISOString() : null,
      autoConcluida: !!(on && opts.auto)
    });
    ag.sessoes = sessoes; ag.versao = 1; ag.maxPorDia = MAX_POR_DIA; ag.maxSessao = MAX_SESSAO;
    e.origemPlano = Object.assign({}, o, { agendaAuto: ag });
    e.updatedAt = new Date().toISOString();
    DB.saveExtras(list);
    replanejar(on ? addDias(dia, 1) : dia, { preservarHoje: !on });
    return DB.getExtra ? DB.getExtra(id) : e;
  }

  function registrarFechamentoFinal(id, dia, manual) {
    const list = DB.getExtras();
    const e = list.find(x => String(x.id) === String(id));
    if (!e || !ehPlano(e)) return e;
    e.concluidasEm = [...new Set([...(e.concluidasEm || []), dia])].sort();
    const o = e.origemPlano || {}, ag = Object.assign({}, o.agendaAuto || {}), sessoes = Object.assign({}, ag.sessoes || {});
    const s = Object.assign({}, sessoes[dia] || {});
    s.alvo = Math.max(1, inteiro(s.alvo, Math.min(MAX_SESSAO, Math.max(1, historicoDia(e, dia)))));
    s.estado = 'concluida'; s.concluidaEm = new Date().toISOString();
    sessoes[dia] = s;
    Object.keys(sessoes).forEach(d => { if (d > dia && sessoes[d].estado !== 'concluida') delete sessoes[d]; });
    ag.sessoes = sessoes;
    ag.finalizadoEm = dia;
    if (manual) ag.finalizadoManualmente = { em: new Date().toISOString(), feito: feitoCiclo(e), alvo: inteiro(e.alvo, 0) };
    e.datas = [...new Set([...Object.keys(sessoes), ...(e.historico || []).map(h => h.data).filter(Boolean), ...(e.concluidasEm || [])])].sort();
    e.origemPlano = Object.assign({}, o, { agendaAuto: ag });
    e.updatedAt = new Date().toISOString();
    DB.saveExtras(list);
    return e;
  }

  function finalizarCiclo(id, dia) {
    dia = dia || hoje();
    if (!setConcluidaBase) return null;
    const r = setConcluidaBase(id, dia, true);
    registrarFechamentoFinal(id, dia, true);
    return r;
  }

  /* A semântica padrão de setConcluidaDia é GLOBAL para atividade única. Para
     reforço do Plano ela passa a ser DA SESSÃO. O encerramento global ganhou a
     função explícita finalizarCiclo(). */
  if (setConcluidaBase) {
    DB.setConcluidaDia = function setConcluidaDiaComSessao(id, dia, on) {
      const e = this.getExtra ? this.getExtra(id) : null;
      dia = dia || hoje();
      if (!ehPlano(e) || e.status === 'concluida') return setConcluidaBase(id, dia, on);
      return salvarSessao(id, dia, !!on, { auto: false });
    };
  }

  if (extraConcluidaBase) {
    DB.extraConcluidaEm = function extraConcluidaEmPorSessao(e, dia) {
      if (!ehPlano(e)) return extraConcluidaBase(e, dia);
      dia = dia || hoje();
      if ((e.concluidasEm || []).includes(dia)) return true;
      /* Compatibilidade com ciclos encerrados antes desta agenda existir. */
      if (e.status === 'concluida' && !(e.concluidasEm || []).length && dia === hoje()) return true;
      return false;
    };
  }

  if (addProgressBase) {
    DB.addExtraProgress = function addExtraProgressComAgenda(id, quantidade, minutos, opts) {
      const r = addProgressBase(id, quantidade, minutos, opts);
      const dia = opts && opts.data ? opts.data : hoje();
      let e = this.getExtra ? this.getExtra(id) : r;
      if (!ehPlano(e)) return r;
      if (e.status === 'concluida') {
        registrarFechamentoFinal(id, dia, false);
        return this.getExtra ? this.getExtra(id) : e;
      }
      const ag = e.origemPlano && e.origemPlano.agendaAuto;
      const s = ag && ag.sessoes && ag.sessoes[dia];
      if (s && historicoDia(e, dia) >= inteiro(s.alvo, MAX_SESSAO)) {
        salvarSessao(id, dia, true, { auto: true });
      } else {
        replanejar(hoje(), { preservarHoje: true });
      }
      return this.getExtra ? this.getExtra(id) : e;
    };
  }

  function reabrirSeDesfez(id, dia) {
    let e = DB.getExtra ? DB.getExtra(id) : null;
    if (!ehPlano(e)) return e;
    const ag = e.origemPlano && e.origemPlano.agendaAuto;
    const s = ag && ag.sessoes && ag.sessoes[dia];
    if (e.status !== 'concluida' && s && s.autoConcluida && historicoDia(e, dia) < inteiro(s.alvo, 0)) {
      const list = DB.getExtras(), alvo = list.find(x => String(x.id) === String(id));
      if (alvo) {
        alvo.concluidasEm = (alvo.concluidasEm || []).filter(d => d !== dia);
        if (alvo.origemPlano && alvo.origemPlano.veredito) {
          alvo.origemPlano = Object.assign({}, alvo.origemPlano);
          delete alvo.origemPlano.veredito;
        }
        if (alvo.origemPlano && alvo.origemPlano.agendaAuto && alvo.origemPlano.agendaAuto.sessoes && alvo.origemPlano.agendaAuto.sessoes[dia]) {
          alvo.origemPlano.agendaAuto.sessoes[dia] = Object.assign({}, alvo.origemPlano.agendaAuto.sessoes[dia], { estado: 'planejada', concluidaEm: null, autoConcluida: false });
        }
        DB.saveExtras(list);
      }
    }
    replanejar(hoje(), { preservarHoje: true });
    return DB.getExtra ? DB.getExtra(id) : e;
  }

  if (undoDayBase) {
    DB.undoExtraProgressDay = function undoExtraProgressDayComAgenda(id, dia) {
      const r = undoDayBase(id, dia);
      reabrirSeDesfez(id, dia || hoje());
      return r;
    };
  }
  if (undoBase) {
    DB.undoExtraProgress = function undoExtraProgressComAgenda(id) {
      const e0 = this.getExtra ? this.getExtra(id) : null;
      const ultimo = e0 && e0.historico && e0.historico.length ? e0.historico[e0.historico.length - 1] : null;
      const r = undoBase(id);
      reabrirSeDesfez(id, (ultimo && ultimo.data) || hoje());
      return r;
    };
  }

  function decorarDia() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('#extras-list .exd[data-id][data-day]').forEach(card => {
      const e = DB.getExtra ? DB.getExtra(card.dataset.id) : null;
      if (!ehPlano(e)) return;
      const dia = card.dataset.day, ag = e.origemPlano && e.origemPlano.agendaAuto;
      const s = ag && ag.sessoes && ag.sessoes[dia];
      if (!s) return;
      const qDia = historicoDia(e, dia), alvoSessao = inteiro(s.alvo, MAX_SESSAO);
      const feito = feitoCiclo(e), alvoCiclo = inteiro(e.alvo, inteiro(e.origemPlano.metaCicloQ, 0));
      let tag = card.querySelector('.pl-sessao-tag');
      if (!tag) {
        tag = document.createElement('span'); tag.className = 'extra-tag plano pl-sessao-tag';
        const tags = card.querySelector('.exd-tags'); if (tags) tags.appendChild(tag);
      }
      if (tag) {
        tag.textContent = s.estado === 'concluida'
          ? `sessão fechada · ${qDia}q feitos · ciclo ${feito}/${alvoCiclo}q`
          : (dia > hoje() ? `sessão planejada · ${alvoSessao}q · ciclo ${feito}/${alvoCiclo}q` : `sessão ${qDia}/${alvoSessao}q · ciclo ${feito}/${alvoCiclo}q`);
        tag.title = 'A sessão é apenas o bloco deste dia. Fechá-la não encerra o ciclo enquanto ainda houver questões restantes.';
      }
      const check = card.querySelector('.exd-check');
      if (check && e.status !== 'concluida') {
        const done = DB.extraConcluidaEm(e, dia);
        check.setAttribute('aria-label', done ? 'Reabrir sessão do dia' : 'Fechar sessão do dia');
        const lbl = check.querySelector('.exd-check-lbl'); if (lbl) lbl.textContent = done ? 'Reabrir sessão' : 'Fechar sessão';
      }
    });
    const sub = document.querySelector('#extras-agenda .cal-card .card-header .sub');
    if (sub) sub.textContent = 'Os reforços do Plano são auto-organizados em até 3 disciplinas por dia. Fechar a sessão registra o dia; o ciclo continua até cumprir a meta total.';
  }

  function decorarCurso() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('#extras-curso .exc-item[data-id]').forEach(row => {
      const e = DB.getExtra ? DB.getExtra(row.dataset.id) : null;
      if (!ehPlano(e)) return;
      const prox = proximaSessao(e, addDias(hoje(), -1));
      const meta = row.querySelector('.exc-meta');
      if (prox && meta && !meta.querySelector('.agenda-auto-proxima')) {
        const s = document.createElement('span'); s.className = 'agenda-auto-proxima';
        const data = typeof formatDateShort === 'function' ? formatDateShort(prox.data) : prox.data;
        s.innerHTML = `<b>próxima</b> ${data} · ${inteiro(prox.alvo, MAX_SESSAO)}q`;
        s.title = 'Próxima sessão calculada automaticamente pelo rodízio de reforços.';
        meta.appendChild(s);
      }
    });
  }

  /* Captura só os controles cuja intenção precisa ser inequívoca. O checkbox do
     cartão fecha SESSÃO; o botão do painel fecha CICLO. */
  if (typeof document !== 'undefined' && document && document.addEventListener) {
    document.addEventListener('click', (ev) => {
      const bot = ev.target && ev.target.closest ? ev.target.closest('#extras-list .exd-check') : null;
      if (!bot) return;
      const card = bot.closest('.exd[data-id][data-day]');
      const e = card && DB.getExtra ? DB.getExtra(card.dataset.id) : null;
      if (!ehPlano(e) || e.status === 'concluida') return;
      ev.preventDefault(); ev.stopPropagation();
      const dia = card.dataset.day || hoje();
      if (dia > hoje()) { if (typeof showToast === 'function') showToast('Este dia ainda não chegou — a sessão está apenas planejada'); return; }
      const feita = DB.extraConcluidaEm(e, dia);
      DB.setConcluidaDia(e.id, dia, !feita);
      const atual = DB.getExtra(e.id);
      const restante = Math.max(0, inteiro(atual.alvo, 0) - feitoCiclo(atual));
      const prox = proximaSessao(atual, dia);
      if (EX && typeof EX.render === 'function') EX.render();
      if (typeof showToast === 'function') {
        if (feita) showToast('Sessão reaberta — o rodízio foi reorganizado');
        else if (!restante) showToast('Sessão concluída ✓ · meta do ciclo atingida');
        else if (prox) {
          const d = typeof formatDateShort === 'function' ? formatDateShort(prox.data) : prox.data;
          showToast(`Sessão fechada ✓ · ${restante}q ainda no ciclo · próxima ${d}: ${inteiro(prox.alvo, MAX_SESSAO)}q`);
        } else showToast(`Sessão fechada ✓ · ${restante}q continuam no ciclo`);
      }
    }, true);

    document.addEventListener('click', async (ev) => {
      const bot = ev.target && ev.target.closest ? ev.target.closest('#extras-curso [data-curso-fim]') : null;
      if (!bot) return;
      const e = DB.getExtra ? DB.getExtra(bot.dataset.cursoFim) : null;
      if (!ehPlano(e) || e.status === 'concluida') return;
      ev.preventDefault(); ev.stopPropagation();
      const feito = feitoCiclo(e), falta = Math.max(0, inteiro(e.alvo, 0) - feito);
      if (falta > 0) {
        const ok = await UI.confirm(`Ainda faltam ${falta} questões para a meta deste reforço. Este botão encerra o CICLO inteiro. Se a intenção é só parar por hoje, feche a sessão na Missão do dia.`, { title: 'Concluir o ciclo antes da meta?', okText: 'Encerrar ciclo mesmo assim' });
        if (!ok) return;
      }
      finalizarCiclo(e.id, hoje());
      if (typeof showToast === 'function') showToast('Ciclo de reforço encerrado ✓');
      if (EX && typeof EX.render === 'function') EX.render();
    }, true);
  }

  /* A agenda se corrige na entrada da tela: sessões perdidas são realocadas e
     novas frentes entram no rodízio sem botão de manutenção. */
  if (typeof EX.render === 'function') {
    const renderBase = EX.render;
    EX.render = function renderComAgendaAuto() {
      try { this._planoRefCard = null; replanejar(hoje(), { preservarHoje: true }); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'agenda-auto-render'); }
      const r = renderBase.apply(this, arguments);
      try { decorarDia(); decorarCurso(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'agenda-auto-decorar'); }
      return r;
    };
  }

  if (typeof EX.renderEmCurso === 'function') {
    const cursoBase = EX.renderEmCurso;
    EX.renderEmCurso = function renderCursoComProximaSessao() {
      const r = cursoBase.apply(this, arguments);
      try { decorarCurso(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'agenda-auto-curso'); }
      return r;
    };
  }

  globalThis.ReforcoAgendaAuto = {
    versao: 1,
    maxPorDia: MAX_POR_DIA,
    maxSessao: MAX_SESSAO,
    dividir,
    planejarModelo,
    replanejar,
    feitoCiclo,
    proximaSessao,
    concluirSessao: (id, dia) => salvarSessao(id, dia || hoje(), true, { auto: false }),
    reabrirSessao: (id, dia) => salvarSessao(id, dia || hoje(), false, { auto: false }),
    finalizarCiclo
  };
})();
