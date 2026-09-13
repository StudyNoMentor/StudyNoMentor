/* ============================================================
   FILA DIÁRIA DO REFORÇO — parcelas executáveis, meta global intacta
   ------------------------------------------------------------
   Uma atividade criada pelo Plano tem DUAS escalas diferentes:

     1) a META GLOBAL do ciclo (ex.: 100 questões de um assunto);
     2) a PARCELA DO DIA (ex.: 25 questões hoje).

   Misturar as duas foi a causa do bug em que concluir um parcial encerrava o
   reforço inteiro. Esta camada mantém o objeto original como ciclo global e
   usa `reforcoFila.alvosPorDia` + `concluidasEm` apenas para a execução diária.

   Regras do rodízio:
     · até 3 tarefas de reforço por dia;
     · disciplinas diferentes no mesmo dia;
     · um assunto por disciplina/dia;
     · prioriza quem está há mais tempo sem entrar no rodízio e, no empate, a
       menor taxa atual (assunto mais crítico);
     · blocos balanceados com teto de 25 questões: 100 -> 25/25/25/25,
       61 -> 21/20/20, 47 -> 24/23. Não cria uma esteira artificial de 7/8;
     · se a parcela do dia for concluída parcialmente, o saldo NÃO some: volta
       automaticamente para a fila a partir do dia seguinte;
     · histórico já executado nunca é reescrito nem deslocado.
   ============================================================ */
const ReforcoFila = {
  VERSAO: 1,
  MAX_TAREFAS_DIA: 3,
  BLOCO_MAX: 25,
  _rodando: false,
  _agendado: false,
  _forcarGlobal: false,
  _orig: {},

  _norm(s) {
    try {
      if (typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm) return ReforcoEngine.norm(s || '');
    } catch (_) { _quiet(_); }
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  },
  _addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  ePlano(e) { return !!(e && e.origemPlano && e.origemPlano.topico && e.periodo === 'unica'); },
  eGerenciado(e) { return this.ePlano(e) && !!(e.reforcoFila && e.reforcoFila.auto !== false); },
  _meta(e) {
    if (!e.reforcoFila || typeof e.reforcoFila !== 'object') {
      e.reforcoFila = { versao: this.VERSAO, auto: true, alvosPorDia: {}, criadoEm: new Date().toISOString() };
    }
    if (!e.reforcoFila.alvosPorDia || typeof e.reforcoFila.alvosPorDia !== 'object' || Array.isArray(e.reforcoFila.alvosPorDia)) {
      e.reforcoFila.alvosPorDia = {};
    }
    e.reforcoFila.versao = this.VERSAO;
    if (e.reforcoFila.auto == null) e.reforcoFila.auto = true;
    if (!Array.isArray(e.concluidasEm)) e.concluidasEm = [];
    if (!Array.isArray(e.datas)) e.datas = [];
    if (!Array.isArray(e.historico)) e.historico = [];
    return e.reforcoFila;
  },
  alvoNoDia(e, dia) {
    if (!this.eGerenciado(e)) return null;
    const v = e.reforcoFila.alvosPorDia && e.reforcoFila.alvosPorDia[dia];
    const n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : null;
  },
  feitoNoDia(e, dia) {
    return (e && e.historico || []).filter(h => h.data === dia)
      .reduce((a, h) => a + (parseFloat(h.quantidade) || 0), 0);
  },
  tamanhoBloco(restante) {
    const r = Math.max(0, Math.ceil(parseFloat(restante) || 0));
    if (!r) return 0;
    if (r <= this.BLOCO_MAX) return r;
    const n = Math.max(2, Math.ceil(r / this.BLOCO_MAX));
    return Math.max(1, Math.ceil(r / n));
  },
  _ultimoDia(e, ate) {
    const m = e.reforcoFila && e.reforcoFila.alvosPorDia || {};
    const dias = Object.keys(m).filter(d => (!ate || d <= ate) && parseFloat(m[d]) > 0).sort();
    return dias.length ? dias[dias.length - 1] : '';
  },
  _planoRef() {
    try {
      if (typeof PlanoEngine === 'undefined' || typeof DesempenhoTecScreen === 'undefined') return null;
      const snap = DesempenhoTecScreen.scopedSnapshot();
      if (!snap) return null;
      return PlanoEngine.calcular(snap, PlanoEngine.prefs());
    } catch (e) { _quiet(e, 'fila-plano-ref'); return null; }
  },
  avaliarGlobal(e, ref) {
    try {
      if (typeof PlanoCiclo !== 'undefined' && PlanoCiclo.avaliar) {
        const v = PlanoCiclo.avaliar(e, ref || this._planoRef(), null);
        if (v) return v;
      }
    } catch (err) { _quiet(err, 'fila-avaliar'); }
    const alvo = Math.max(1, parseFloat(e && e.alvo) || 1);
    const feito = Math.max(0, parseFloat(e && e.progresso) || 0);
    return { extra: e, alvo, feito, pct: Math.min(100, Math.round(feito / alvo * 100)), estado: 'andamento' };
  },
  saldo(e, ref) {
    const v = this.avaliarGlobal(e, ref);
    return { restante: Math.max(0, Math.ceil((v.alvo || 0) - (v.feito || 0))), avaliacao: v };
  },

  /* Versões anteriores gravavam `status=concluida` ao tocar no checkbox do dia.
     Quando é possível PROVAR que o trabalho global ainda não tinha acabado,
     reabrimos a atividade e removemos apenas o veredito criado por aquele
     fechamento prematuro. Não tocamos em ciclos encerrados pelo motor. */
  _recuperarParcialFechado(e, ref) {
    if (!this.ePlano(e) || e.status !== 'concluida' || !e.origemPlano || !e.origemPlano.veredito) return false;
    const ver = e.origemPlano.veredito;
    const dia = ver.em || '';
    const teveParcialNoDia = (e.historico || []).some(h => h.data === dia && (parseFloat(h.quantidade) || 0) > 0);
    // Só corrige automaticamente o padrão inequívoco do bug atual. Fechamentos
    // históricos ou vereditos com medição/calibração permanecem intocados.
    if (!ver.porMao || ver.tipo !== 'encerradaPorVoce' || dia !== todayLocal() || !teveParcialNoDia) return false;
    let v = null;
    try { v = this.avaliarGlobal(e, ref); } catch (_) { _quiet(_); }
    if (!v || !(v.feito < v.alvo) || v.bateu || v.mediu) return false;
    const origem = Object.assign({}, e.origemPlano);
    delete origem.veredito;
    e.origemPlano = origem;
    e.status = 'ativa';
    e.concluidasEm = Array.isArray(e.concluidasEm) ? e.concluidasEm : [];
    if (!e.concluidasEm.includes(dia)) e.concluidasEm.push(dia);
    const m = this._meta(e);
    m.recuperadaDeParcial = true;
    m.recuperadaEm = new Date().toISOString();
    m.ultimoDiaConcluido = dia;
    return true;
  },

  /* Recalcula SOMENTE o futuro. Hoje e o passado ficam congelados porque já são
     execução/histórico; é essa separação que impede uma importação ou um F5 de
     reescrever a meta que a pessoa viu de manhã. */
  sincronizar() {
    if (this._rodando) return { mudou: false };
    this._rodando = true;
    let mudou = false;
    try {
      const hoje = todayLocal();
      const list = DB.getExtras();
      if (!Array.isArray(list) || !list.length) return { mudou: false };
      const ref = this._planoRef();

      // Primeiro, recupera fechamentos prematuros identificáveis e adota todos
      // os reforços abertos do Plano na fila nova.
      list.forEach(e => {
        if (!this.ePlano(e)) return;
        if (this._recuperarParcialFechado(e, ref)) mudou = true;
        if (e.status !== 'concluida' && !e.reforcoFila) { this._meta(e); mudou = true; }
        if (e.reforcoFila) this._meta(e);
      });

      const todos = list.filter(e => this.eGerenciado(e));
      if (!todos.length) {
        if (mudou) DB.saveExtras(list);
        return { mudou };
      }

      // Apaga somente agenda FUTURA gerada pela própria fila. Datas antigas e
      // de hoje ficam como trilha de auditoria. Ciclo global concluído também
      // perde qualquer promessa futura que ainda estivesse salva.
      todos.forEach(e => {
        const m = this._meta(e);
        Object.keys(m.alvosPorDia).forEach(d => {
          if (d > hoje) { delete m.alvosPorDia[d]; mudou = true; }
        });
        const antes = e.datas.slice();
        e.datas = e.datas.filter(d => d <= hoje);
        if (antes.length !== e.datas.length) mudou = true;
        if (e.status === 'concluida') return;

        // Migração suave: se já houve execução hoje antes da fila existir,
        // transforma o que está acontecendo em uma parcela de hoje, sem apagar
        // nem reinterpretar nenhuma questão registrada.
        if (!this.alvoNoDia(e, hoje)) {
          const feitoHoje = this.feitoNoDia(e, hoje);
          if (feitoHoje > 0) {
            const s = this.saldo(e, ref).restante;
            m.alvosPorDia[hoje] = Math.max(feitoHoje, Math.min(this.BLOCO_MAX, feitoHoje + s));
            if (!e.datas.includes(hoje)) e.datas.push(hoje);
            mudou = true;
          }
        }
      });

      const ativos = todos.filter(e => e.status !== 'concluida');
      const tarefas = [];
      const ocupadasHoje = new Set();
      let nHoje = 0;

      ativos.forEach(e => {
        const m = this._meta(e);
        const s = this.saldo(e, ref);
        let restante = s.restante;
        const qHoje = this.alvoNoDia(e, hoje);
        const disc = this._norm(e.disciplina || (e.origemPlano && e.origemPlano.disciplina) || 'sem disciplina');
        if (qHoje != null) {
          nHoje++;
          ocupadasHoje.add(disc);
          const feitoHoje = this.feitoNoDia(e, hoje);
          const concluidaHoje = (e.concluidasEm || []).includes(hoje);
          if (!concluidaHoje) restante -= Math.min(restante, Math.max(0, qHoje - feitoHoje));
        }
        restante = Math.max(0, Math.ceil(restante));
        if (restante > 0) tarefas.push({
          e, m, restante, disc,
          taxa: (s.avaliacao && isFinite(parseFloat(s.avaliacao.taxa)))
            ? parseFloat(s.avaliacao.taxa)
            : ((e.origemPlano && e.origemPlano.taxaInicial != null) ? e.origemPlano.taxaInicial : 999),
          ultimo: this._ultimoDia(e, hoje),
          jaHoje: qHoje != null
        });
      });

      const cmp = (a, b) => String(a.ultimo || '').localeCompare(String(b.ultimo || ''))
        || a.taxa - b.taxa
        || String(a.e.titulo || '').localeCompare(String(b.e.titulo || ''), 'pt-BR');

      // Cada passagem abre o dia mais cedo possível e preenche até três
      // disciplinas diferentes. O saldo de uma disciplina que não coube espera
      // o próximo dia em vez de virar uma microtarefa no mesmo dia.
      let dia = hoje;
      let guarda = 0;
      while (tarefas.some(t => t.restante > 0) && guarda++ < 1460) {
        const usadas = (dia === hoje) ? new Set(ocupadasHoje) : new Set();
        let slots = this.MAX_TAREFAS_DIA - (dia === hoje ? nHoje : 0);
        if (slots < 0) slots = 0;
        const cand = tarefas.filter(t => t.restante > 0 && !(dia === hoje && t.jaHoje)).sort(cmp);
        let incluidas = 0;
        for (const t of cand) {
          if (slots <= 0) break;
          if (usadas.has(t.disc)) continue;
          const q = this.tamanhoBloco(t.restante);
          if (!q) continue;
          t.m.alvosPorDia[dia] = q;
          if (!t.e.datas.includes(dia)) t.e.datas.push(dia);
          t.restante -= q;
          t.ultimo = dia;
          t.jaHoje = t.jaHoje || dia === hoje;
          usadas.add(t.disc);
          slots--; incluidas++; mudou = true;
        }
        // Se hoje já estava lotado, ou todas as candidatas pertenciam a uma
        // disciplina já usada, simplesmente avança. Nunca força a quarta frente.
        dia = this._addDays(dia, 1);
        if (!incluidas && dia !== hoje && guarda > 1450) break;
      }

      todos.forEach(e => {
        const m = this._meta(e);
        e.datas = [...new Set(e.datas)].sort();
        m.atualizadoEm = new Date().toISOString();
      });

      /* `mudou` fica verdadeiro também ao reescrever a mesma agenda durante a
         reconstrução. Comparamos uma assinatura funcional para não fazer I/O e
         sync de nuvem em toda repintura quando o resultado final é idêntico. */
      const assinatura = e => JSON.stringify([
        e.id, e.status, (e.datas || []).slice().sort(), (e.concluidasEm || []).slice().sort(),
        e.reforcoFila && e.reforcoFila.alvosPorDia || {},
        e.reforcoFila && !!e.reforcoFila.recuperadaDeParcial,
        e.origemPlano && e.origemPlano.veredito || null
      ]);
      const antesKey = this._assinaturaAnterior || '';
      const agoraKey = todos.map(assinatura).join('|');
      const realmente = mudou && agoraKey !== antesKey;
      this._assinaturaAnterior = agoraKey;
      if (realmente) DB.saveExtras(list);
      return { mudou: realmente, ativos: ativos.length };
    } catch (e) {
      _quiet(e, 'fila-sincronizar');
      return { mudou: false, erro: e };
    } finally {
      this._rodando = false;
    }
  },

  sinalizar() {
    if (this._agendado) return;
    this._agendado = true;
    setTimeout(() => {
      this._agendado = false;
      try { this.sincronizar(); } catch (e) { _quiet(e, 'fila-agendada'); }
    }, 0);
  },

  forcarHoje(id) {
    this.sincronizar();
    const list = DB.getExtras();
    const e = list.find(x => x.id === id);
    if (!e || !this.eGerenciado(e) || e.status === 'concluida') return { ok: false, motivo: 'encerrada' };
    const hoje = todayLocal();
    if (this.alvoNoDia(e, hoje)) return { ok: true, ja: true };
    const outras = list.filter(x => x.id !== id && this.eGerenciado(x) && this.alvoNoDia(x, hoje));
    const disc = this._norm(e.disciplina || (e.origemPlano && e.origemPlano.disciplina) || 'sem disciplina');
    if (outras.length >= this.MAX_TAREFAS_DIA || outras.some(x => this._norm(x.disciplina || (x.origemPlano && x.origemPlano.disciplina) || 'sem disciplina') === disc)) {
      return { ok: false, motivo: 'lotado' };
    }
    const s = this.saldo(e).restante;
    if (!s) return { ok: false, motivo: 'sem-saldo' };
    const m = this._meta(e);
    m.alvosPorDia[hoje] = this.tamanhoBloco(s);
    if (!e.datas.includes(hoje)) e.datas.push(hoje);
    DB.saveExtras(list);
    this._assinaturaAnterior = '';
    this.sincronizar();
    return { ok: true };
  },

  encerrarCiclo(id) {
    const e = DB.getExtra(id);
    if (!e) return null;
    this._forcarGlobal = true;
    try { return this._orig.setConcluidaDia.call(DB, id, todayLocal(), true); }
    finally { this._forcarGlobal = false; this._assinaturaAnterior = ''; this.sincronizar(); }
  },

  cargaDoDia(dia) {
    dia = dia || todayLocal();
    const itens = DB.getExtras().filter(e => this.eGerenciado(e) && this.alvoNoDia(e, dia));
    return {
      itens,
      total: itens.reduce((a, e) => a + (this.alvoNoDia(e, dia) || 0), 0),
      disciplinas: new Set(itens.map(e => this._norm(e.disciplina || (e.origemPlano && e.origemPlano.disciplina)))).size
    };
  }
};

/* ── BANCO: conclusão diária ≠ encerramento do ciclo ───────────────────── */
ReforcoFila._orig.extraConcluidaEm = DB.extraConcluidaEm;
DB.extraConcluidaEm = function (e, dia) {
  if (!ReforcoFila.eGerenciado(e)) return ReforcoFila._orig.extraConcluidaEm.call(this, e, dia);
  dia = dia || todayLocal();
  if ((e.concluidasEm || []).includes(dia)) return true;
  // Se o ciclo global acabou HOJE ao alcançar a meta, a parcela que produziu
  // esse fechamento também aparece concluída sem falsificar os dias antigos.
  return e.status === 'concluida' && dia === todayLocal() && ReforcoFila.alvoNoDia(e, dia) != null;
};

ReforcoFila._orig.setConcluidaDia = DB.setConcluidaDia;
DB.setConcluidaDia = function (id, dia, on) {
  const e = this.getExtra(id);
  if (!ReforcoFila.eGerenciado(e) || ReforcoFila._forcarGlobal) {
    return ReforcoFila._orig.setConcluidaDia.call(this, id, dia, on);
  }
  dia = dia || todayLocal();
  if (on && dia > todayLocal()) return e;
  const list = this.getExtras();
  const x = list.find(v => v.id === id);
  if (!x) return null;
  x.concluidasEm = Array.isArray(x.concluidasEm) ? x.concluidasEm : [];
  const i = x.concluidasEm.indexOf(dia);
  if (on && i < 0) x.concluidasEm.push(dia);
  if (!on && i >= 0) x.concluidasEm.splice(i, 1);
  const m = ReforcoFila._meta(x);
  if (on) m.ultimoDiaConcluido = dia;
  x.updatedAt = new Date().toISOString();
  this.saveExtras(list);
  ReforcoFila._assinaturaAnterior = '';
  ReforcoFila.sincronizar();
  if (on) setTimeout(() => {
    try {
      const atual = DB.getExtra(id);
      const s = atual ? ReforcoFila.saldo(atual).restante : 0;
      if (s > 0) showToast('Parcela concluída ✓ · ' + s + ' questão(ões) seguem no rodízio');
    } catch (_) { _quiet(_); }
  }, 0);
  return x;
};

ReforcoFila._orig.addExtraProgress = DB.addExtraProgress;
DB.addExtraProgress = function () {
  const id = arguments[0];
  const r = ReforcoFila._orig.addExtraProgress.apply(this, arguments);
  const e = this.getExtra(id);
  if (ReforcoFila.eGerenciado(e)) {
    ReforcoFila._assinaturaAnterior = '';
    ReforcoFila.sincronizar();
  }
  return r;
};

ReforcoFila._orig.updateExtra = DB.updateExtra;
DB.updateExtra = function (id, patch) {
  const r = ReforcoFila._orig.updateExtra.call(this, id, patch);
  if (ReforcoFila.ePlano(r) || (patch && patch.origemPlano)) {
    ReforcoFila._assinaturaAnterior = '';
    ReforcoFila.sinalizar();
  }
  return r;
};

/* ── TELA: sincroniza antes de desenhar calendário e tarefas ───────────── */
ReforcoFila._orig.render = ExtrasScreen.render;
ExtrasScreen.render = function () {
  try { ReforcoFila.sincronizar(); } catch (e) { _quiet(e, 'fila-render'); }
  return ReforcoFila._orig.render.apply(this, arguments);
};

ReforcoFila._orig.occurrencesForDay = ExtrasScreen.occurrencesForDay;
ExtrasScreen.occurrencesForDay = function (day) {
  const base = ReforcoFila._orig.occurrencesForDay.call(this, day);
  const porId = new Map(base.map(e => [e.id, e]));
  DB.getExtras().forEach(e => {
    if (!ReforcoFila.eGerenciado(e)) return;
    const deve = ReforcoFila.alvoNoDia(e, day) != null
      || (e.historico || []).some(h => h.data === day)
      || (e.concluidasEm || []).includes(day);
    if (deve) porId.set(e.id, e); else porId.delete(e.id);
  });
  return [...porId.values()];
};

/* O card mantém a barra do CICLO GLOBAL. A parcela executável do dia aparece
   em badge próprio; assim 10/25 hoje nunca substitui visualmente 50/120 no ciclo. */
ReforcoFila._orig.cardHtml = ExtrasScreen.cardHtml;
ExtrasScreen.cardHtml = function (x, day) {
  day = day || this.selDay || todayLocal();
  const q = ReforcoFila.alvoNoDia(x, day);
  if (q == null) return ReforcoFila._orig.cardHtml.call(this, x, day);
  let html = ReforcoFila._orig.cardHtml.call(this, x, day);
  const geral = ReforcoFila.avaliarGlobal(x, this._planoRefCard);
  const saldo = Math.max(0, Math.ceil((geral.alvo || 0) - (geral.feito || 0)));
  const feitoDia = ReforcoFila.feitoNoDia(x, day);
  const selo = `<span class="extra-tag rec" title="Meta executável desta data.">Missão diária · <b>${Math.min(q, feitoDia)}</b>/${q} q</span>` +
    `<span class="extra-tag" title="Progresso acumulado do ciclo de reforço.">Missão geral · <b>${geral.feito || 0}</b>/${geral.alvo || 0} q · saldo ${saldo}</span>`;
  if (html.includes('🏁 do Plano</span>')) html = html.replace('🏁 do Plano</span>', '🏁 do Plano</span>' + selo);
  return html;
};

/* ── PAINEL "REFORÇOS EM CURSO": manual só quando for explícito ───────── */
ReforcoFila._orig.renderEmCurso = ExtrasScreen.renderEmCurso;
ExtrasScreen.renderEmCurso = function () {
  const ret = ReforcoFila._orig.renderEmCurso.apply(this, arguments);
  const host = document.getElementById('extras-curso');
  if (!host) return ret;

  // Substituir o nó remove o listener antigo. "Concluir" passa a ser uma ação
  // GLOBAL, consciente e confirmada; o checkbox do card continua sendo diário.
  host.querySelectorAll('[data-curso-fim]').forEach(old => {
    const b = old.cloneNode(true);
    b.textContent = 'Encerrar ciclo';
    b.title = 'Encerra definitivamente este reforço, mesmo com saldo restante';
    old.replaceWith(b);
    b.addEventListener('click', async () => {
      const e = DB.getExtra(b.dataset.cursoFim);
      if (!e) return;
      const s = ReforcoFila.eGerenciado(e) ? ReforcoFila.saldo(e).restante : 0;
      const ok = await UI.confirm(s > 0
        ? `Ainda faltam ${s} questão(ões). Encerrar definitivamente este ciclo?`
        : 'Encerrar definitivamente este ciclo?',
        { title: 'Encerrar reforço', okText: 'Encerrar ciclo', danger: s > 0 });
      if (!ok) return;
      ReforcoFila.encerrarCiclo(e.id);
      showToast('Ciclo encerrado');
      ExtrasScreen.render();
    });
  });

  // "Fazer hoje" passa a respeitar o limite de três disciplinas e replaneja o
  // resto. Não é mais um simples toggle de data capaz de brigar com a fila.
  host.querySelectorAll('[data-curso-dia]').forEach(old => {
    const b = old.cloneNode(true);
    old.replaceWith(b);
    b.addEventListener('click', () => {
      const r = ReforcoFila.forcarHoje(b.dataset.cursoDia);
      if (!r.ok) {
        showToast(r.motivo === 'lotado'
          ? 'Hoje já tem 3 frentes do reforço (ou esta disciplina já está no rodízio)'
          : 'Este reforço não tem saldo para hoje');
        return;
      }
      ExtrasScreen.selDay = todayLocal();
      showToast(r.ja ? 'Já está no reforço de hoje' : 'Incluída no reforço de hoje ✓');
      ExtrasScreen.render();
    });
  });

  // O painel em curso mostra também a PARCELA EXECUTÁVEL DE HOJE por assunto.
  // Isso é somente leitura: não cria agenda, não muda saldo e não conclui nada.
  host.querySelectorAll('.pl-ciclo-lista > li[data-id]').forEach(li => {
    const e = DB.getExtra(li.dataset.id);
    if (!e) return;
    const q = ReforcoFila.alvoNoDia(e, todayLocal());
    if (q == null) return;
    const feitoHoje = ReforcoFila.feitoNoDia(e, todayLocal());
    const nums = li.querySelector('.pl-ciclo-nums');
    if (nums && !nums.querySelector('.exc-hoje')) {
      nums.insertAdjacentHTML('afterbegin', `<span class="exc-hoje" title="Parcela executável desta data."><small>Hoje</small><b>${Math.min(q, feitoHoje)}</b>/${q} q</span>`);
    }
  });

  const resumo = host.querySelector('.exc-resumo');
  if (resumo) {
    const c = ReforcoFila.cargaDoDia(todayLocal());
    const ativos = DB.getExtras().filter(e => ReforcoFila.eGerenciado(e) && e.status !== 'concluida');
    const globais = ativos.map(e => ReforcoFila.avaliarGlobal(e));
    const feitoGeral = globais.reduce((a, v) => a + Math.max(0, Number(v.feito) || 0), 0);
    const alvoGeral = globais.reduce((a, v) => a + Math.max(0, Number(v.alvo) || 0), 0);
    const pctGeral = alvoGeral > 0 ? Math.min(100, Math.round(feitoGeral / alvoGeral * 100)) : 0;
    resumo.innerHTML =
      `<span class="exc-metric exc-metric-day"><small>Missão diária</small><strong>${c.total} questões</strong><em>${c.disciplinas} ${c.disciplinas === 1 ? 'disciplina' : 'disciplinas'}</em></span>` +
      `<span class="exc-metric exc-metric-all"><small>Missão geral</small><strong>${feitoGeral}/${alvoGeral} questões</strong><em>${pctGeral}% concluído</em></span>`;
  }
  return ret;
};

/* ── PUXAR DO PLANO: padrão = 3 disciplinas diferentes ────────────────── */
ReforcoFila._orig.puxarDoPlano = ExtrasScreen.puxarDoPlano;
ExtrasScreen.puxarDoPlano = function () {
  this._reforcoFilaEscolhaPendente = true;
  return ReforcoFila._orig.puxarDoPlano.apply(this, arguments);
};
ReforcoFila._orig.planoBind = ExtrasScreen._planoBind;
ExtrasScreen._planoBind = function () {
  if (this._reforcoFilaEscolhaPendente && Array.isArray(this._planoCand)) {
    const crit = (c) => {
      const taxa = Number(c.x.taxa);
      return Number.isFinite(taxa) ? taxa : 101;
    };
    const cmpCrit = (a, b) => crit(a) - crit(b)
      || (Number(b.x.incid) || 0) - (Number(a.x.incid) || 0)
      || (Number(b.x.qJanela) || 0) - (Number(a.x.qJanela) || 0)
      || String(a.x.nome || '').localeCompare(String(b.x.nome || ''), 'pt-BR');
    const ordenados = this._planoCand.map((x, i) => ({ x, i })).sort(cmpCrit);
    const melhorPorDisc = new Map();
    ordenados.forEach(c => {
      const d = ReforcoFila._norm(c.x.disciplina || 'sem disciplina');
      if (!melhorPorDisc.has(d)) melhorPorDisc.set(d, c);
    });
    const escolhidos = [...melhorPorDisc.values()].sort(cmpCrit).slice(0, 3);
    this._planoSel = new Set(escolhidos.map(c => c.i));
    this._reforcoFilaEscolhaPendente = false;
  }
  return ReforcoFila._orig.planoBind.apply(this, arguments);
};

window.ReforcoFila = ReforcoFila;
