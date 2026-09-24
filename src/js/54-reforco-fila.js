/* ============================================================
   FILA DIÁRIA DO REFORÇO — parcelas executáveis, meta global intacta
   ------------------------------------------------------------
   Uma atividade criada pelo Motor de Sugestão tem DUAS escalas diferentes:

     1) a META GLOBAL do ciclo (ex.: 100 questões de um assunto);
     2) a PARCELA DO DIA (ex.: 25 questões hoje).

   Misturar as duas foi a causa do bug em que concluir um parcial encerrava o
   reforço inteiro. Esta camada mantém o objeto original como ciclo global e
   usa `reforcoFila.alvosPorDia` + `concluidasEm` apenas para a execução diária.

   Regras do rodízio:
     · 1 ou 2 disciplinas por dia, configurável em Atividades Extras;
     · disciplinas diferentes no mesmo dia;
     · um assunto por disciplina/dia;
     · prioriza quem está há mais tempo sem entrar no rodízio e, no empate, a
       menor taxa atual (assunto mais crítico);
     · blocos balanceados com faixa configurável (padrão 10–25 questões):
       100 -> 25/25/25/25, 61 -> 21/20/20, 47 -> 24/23. Não cria uma esteira artificial de 7/8;
     · se a parcela do dia for concluída parcialmente, o saldo NÃO some: volta
       automaticamente para a fila a partir do dia seguinte;
     · histórico já executado nunca é reescrito nem deslocado.
   ============================================================ */
const ReforcoFila = {
  VERSAO: 1,
  MAX_TAREFAS_DIA: 2,
  KEY_PREF: 'reforco-fila-prefs',
  DEFAULT_PREFS: { disciplinasDia: 1, blocoMin: 10, blocoMax: 25 },
  _rodando: false,
  _agendado: false,
  _forcarGlobal: false,
  _orig: {},

  _sanearLimites(min, max) {
    let mi = Math.max(1, Math.min(100, Math.round(Number(min) || this.DEFAULT_PREFS.blocoMin)));
    let ma = Math.max(1, Math.min(100, Math.round(Number(max) || this.DEFAULT_PREFS.blocoMax)));
    if (mi > ma) mi = ma;
    return { min: mi, max: ma };
  },
  _prefKey() {
    try { return DB.planSettingRaw ? DB.planSettingRaw(this.KEY_PREF).key : DB.planSettingKey(this.KEY_PREF); }
    catch (_) { return DB._profilePrefix() + 'p:' + DB._activePlanId() + ':' + this.KEY_PREF; }
  },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(this._prefKey()) || '{}'); }
    catch (_) { _quiet(_); raw = {}; }
    const n = Number(raw && raw.disciplinasDia);
    const lim = this._sanearLimites(raw && raw.blocoMin, raw && raw.blocoMax);
    return { disciplinasDia: n === 2 ? 2 : this.DEFAULT_PREFS.disciplinasDia, blocoMin: lim.min, blocoMax: lim.max };
  },
  salvarPrefs(patch) {
    const p = Object.assign({}, this.prefs(), patch || {});
    p.disciplinasDia = Number(p.disciplinasDia) === 2 ? 2 : 1;
    const lim = this._sanearLimites(p.blocoMin, p.blocoMax);
    p.blocoMin = lim.min; p.blocoMax = lim.max;
    const key = this._prefKey();
    try {
      if (typeof DB.setRaw === 'function') DB.setRaw(key, JSON.stringify(p));
      else localStorage.setItem(key, JSON.stringify(p));
    } catch (e) { _quiet(e, 'fila-prefs'); }
    this._assinaturaAnterior = '';
    this.sincronizar();
    return p;
  },
  limiteDisciplinasDia() {
    return Math.max(1, Math.min(this.MAX_TAREFAS_DIA, Number(this.prefs().disciplinasDia) || 1));
  },
  limitesBloco(e) {
    const p = this.prefs();
    const m = e && e.reforcoFila;
    const personalizado = !!(m && Number.isFinite(Number(m.blocoMin)) && Number.isFinite(Number(m.blocoMax)));
    const lim = personalizado ? this._sanearLimites(m.blocoMin, m.blocoMax) : this._sanearLimites(p.blocoMin, p.blocoMax);
    return { min: lim.min, max: lim.max, personalizado };
  },
  salvarCargaExtra(id, min, max) {
    const list = DB.getExtras();
    const e = list.find(x => x.id === id);
    if (!this.eGerenciado(e)) return null;
    const lim = this._sanearLimites(min, max);
    const m = this._meta(e); m.blocoMin = lim.min; m.blocoMax = lim.max; m.cargaAtualizadaEm = new Date().toISOString();
    e.updatedAt = new Date().toISOString();
    DB.saveExtras(list); this._assinaturaAnterior = ''; this.sincronizar();
    return this.limitesBloco(e);
  },
  usarCargaPadrao(id) {
    const list = DB.getExtras();
    const e = list.find(x => x.id === id);
    if (!this.eGerenciado(e)) return null;
    const m = this._meta(e); delete m.blocoMin; delete m.blocoMax; m.cargaAtualizadaEm = new Date().toISOString();
    e.updatedAt = new Date().toISOString();
    DB.saveExtras(list); this._assinaturaAnterior = ''; this.sincronizar();
    return this.limitesBloco(e);
  },
  aplicarCargaTodos(min, max) {
    const lim = this._sanearLimites(min, max);
    const list = DB.getExtras();
    list.forEach(e => {
      if (!this.eGerenciado(e) || e.status === 'concluida') return;
      const m = this._meta(e); delete m.blocoMin; delete m.blocoMax; m.cargaAtualizadaEm = new Date().toISOString();
      e.updatedAt = new Date().toISOString();
    });
    DB.saveExtras(list);
    return this.salvarPrefs({ blocoMin: lim.min, blocoMax: lim.max });
  },

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
  eMotor(e) {
    return !!(e && typeof MotorCiclo !== 'undefined' && MotorCiclo.origemDe(e) && MotorCiclo.origemDe(e).topico && e.periodo === 'unica');
  },
  eGerenciado(e) { return this.eMotor(e) && !!(e.reforcoFila && e.reforcoFila.auto !== false); },
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
  tamanhoBloco(restante, e) {
    const r = Math.max(0, Math.ceil(parseFloat(restante) || 0));
    if (!r) return 0;
    const lim = this.limitesBloco(e);
    if (r <= lim.max) return r;
    let n = Math.max(2, Math.ceil(r / lim.max));
    while (n > 1 && Math.floor(r / n) < lim.min && Math.ceil(r / (n - 1)) <= lim.max) n--;
    return Math.max(1, Math.min(lim.max, Math.ceil(r / n)));
  },
  _ultimoDia(e, ate) {
    const m = e.reforcoFila && e.reforcoFila.alvosPorDia || {};
    const dias = Object.keys(m).filter(d => (!ate || d <= ate) && parseFloat(m[d]) > 0).sort();
    return dias.length ? dias[dias.length - 1] : '';
  },
  /* A fila diária não decide prioridade. Ela apenas distribui, ao longo dos
     dias, as atividades que o único Motor de Sugestão já abriu. */
  _motorRef() {
    try { return (typeof MotorSugestao !== 'undefined') ? MotorSugestao.calcular() : null; }
    catch (e) { _quiet(e, 'fila-motor-ref'); return null; }
  },
  avaliarGlobal(e, ref) {
    try {
      if (typeof MotorCiclo !== 'undefined' && MotorCiclo.avaliar) {
        const v = MotorCiclo.avaliar(e, ref || this._motorRef());
        if (v) return v;
      }
    } catch (err) { _quiet(err, 'fila-avaliar-motor'); }
    const alvo = Math.max(1, parseFloat(e && e.alvo) || 1);
    const feito = Math.max(0, parseFloat(e && e.progresso) || 0);
    return { extra: e, alvo, feito, pct: Math.min(100, Math.round(feito / alvo * 100)), estado: 'andamento' };
  },
  saldo(e, ref) {
    const v = this.avaliarGlobal(e, ref);
    return { restante: Math.max(0, Math.ceil((v.alvo || 0) - (v.feito || 0))), avaliacao: v };
  },
  _recuperarParcialFechado() { return false; },

  /* Recalcula SOMENTE o futuro. Hoje e o passado ficam congelados porque já são
     execução/histórico; é essa separação que impede uma importação ou um F5 de
     reescrever a meta que a pessoa viu de manhã. */
  sincronizar() {
    try {
      if (typeof PlanManager !== 'undefined' && PlanManager.isActivePlanPaused && PlanManager.isActivePlanPaused()) {
        return { mudou: false, pausado: true };
      }
    } catch (_) {}
    if (this._rodando) return { mudou: false };
    this._rodando = true;
    let mudou = false;
    try {
      const hoje = todayLocal();
      const list = DB.getExtras();
      if (!Array.isArray(list) || !list.length) return { mudou: false };
      /* ── A REFERÊNCIA DO TEC SÓ É PAGA QUANDO ALGUÉM A USA ────────────────
         `ref` serve exclusivamente às atividades vindas do Motor, no laço
         abaixo. Quem nunca usou o "Puxar do Motor" não tem nenhuma — e mesmo
         assim pagava o motor inteiro a cada repintura de Extras, para o
         resultado ser descartado sem uma única leitura. Agora a conta é
         adiada até a primeira atividade que realmente precise dela. */
      const doMotor = list.filter(e => this.eMotor(e));
      let ref = null, refLido = false;
      const obterRef = () => { if (!refLido) { refLido = true; ref = this._motorRef(); } return ref; };

      // Primeiro, recupera fechamentos prematuros identificáveis e adota todos
      // os reforços abertos do Motor na fila diária.
      doMotor.forEach(e => {
        if (this._recuperarParcialFechado(e, obterRef())) mudou = true;
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
            const s = this.saldo(e, obterRef()).restante;
            const limiteHoje = this.limitesBloco(e).max;
            m.alvosPorDia[hoje] = Math.max(feitoHoje, Math.min(limiteHoje, feitoHoje + s));
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
        const s = this.saldo(e, obterRef());
        let restante = s.restante;
        const qHoje = this.alvoNoDia(e, hoje);
        const disc = this._norm(e.disciplina || (MotorCiclo.origemDe(e) && MotorCiclo.origemDe(e).disciplina) || 'sem disciplina');
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
            : ((MotorCiclo.origemDe(e) && MotorCiclo.origemDe(e).taxaInicial != null) ? MotorCiclo.origemDe(e).taxaInicial : 999),
          ultimo: this._ultimoDia(e, hoje),
          jaHoje: qHoje != null
        });
      });

      // O rodízio é por DISCIPLINA, não só por tarefa. Se A1 entrou hoje, A2
      // não fura a fila amanhã enquanto B e C ainda aguardam: isso preserva o
      // espaçamento mesmo quando o Plano permite mais de um tópico por matéria.
      const ultimoPorDisc = new Map();
      tarefas.forEach(t => {
        const u = t.ultimo || '';
        const at = ultimoPorDisc.get(t.disc) || '';
        if (!at || u > at) ultimoPorDisc.set(t.disc, u);
      });
      const cmp = (a, b) => String(ultimoPorDisc.get(a.disc) || '').localeCompare(String(ultimoPorDisc.get(b.disc) || ''))
        || String(a.ultimo || '').localeCompare(String(b.ultimo || ''))
        || a.taxa - b.taxa
        || String(a.e.titulo || '').localeCompare(String(b.e.titulo || ''), 'pt-BR');

      // Cada passagem abre o dia mais cedo possível e preenche só a densidade
      // escolhida (1 ou 2 disciplinas). O saldo que não coube espera o próximo
      // dia em vez de virar microtarefa ou concentrar três matérias de uma vez.
      let dia = hoje;
      let guarda = 0;
      while (tarefas.some(t => t.restante > 0) && guarda++ < 1460) {
        const usadas = (dia === hoje) ? new Set(ocupadasHoje) : new Set();
        let slots = this.limiteDisciplinasDia() - (dia === hoje ? nHoje : 0);
        if (slots < 0) slots = 0;
        const cand = tarefas.filter(t => t.restante > 0 && !(dia === hoje && t.jaHoje)).sort(cmp);
        let incluidas = 0;
        for (const t of cand) {
          if (slots <= 0) break;
          if (usadas.has(t.disc)) continue;
          const q = this.tamanhoBloco(t.restante, t.e);
          if (!q) continue;
          t.m.alvosPorDia[dia] = q;
          if (!t.e.datas.includes(dia)) t.e.datas.push(dia);
          t.restante -= q;
          t.ultimo = dia;
          ultimoPorDisc.set(t.disc, dia);
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
        MotorCiclo.origemDe(e) && MotorCiclo.origemDe(e).veredito || null
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
    const disc = this._norm(e.disciplina || (MotorCiclo.origemDe(e) && MotorCiclo.origemDe(e).disciplina) || 'sem disciplina');
    if (outras.length >= this.limiteDisciplinasDia() || outras.some(x => this._norm(x.disciplina || (MotorCiclo.origemDe(x) && MotorCiclo.origemDe(x).disciplina) || 'sem disciplina') === disc)) {
      return { ok: false, motivo: 'lotado' };
    }
    const s = this.saldo(e).restante;
    if (!s) return { ok: false, motivo: 'sem-saldo' };
    const m = this._meta(e);
    m.alvosPorDia[hoje] = this.tamanhoBloco(s, e);
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
      disciplinas: new Set(itens.map(e => this._norm(e.disciplina || (MotorCiclo.origemDe(e) && MotorCiclo.origemDe(e).disciplina)))).size
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
  if (ReforcoFila.eMotor(r) || (patch && patch.origemMotor)) {
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
  const geral = ReforcoFila.avaliarGlobal(x, this._motorRefCard);
  const saldo = Math.max(0, Math.ceil((geral.alvo || 0) - (geral.feito || 0)));
  const feitoDia = ReforcoFila.feitoNoDia(x, day);
  const selo = `<span class="extra-tag rec" title="Meta executável desta data.">Missão diária · <b>${Math.min(q, feitoDia)}</b>/${q} q</span>` +
    `<span class="extra-tag" title="Progresso acumulado do ciclo de reforço.">Missão geral · <b>${geral.feito || 0}</b>/${geral.alvo || 0} q · saldo ${saldo}</span>`;
  if (html.includes('🧭 Motor')) html = html.replace(/(<span class="extra-tag plano"[^>]*>🧭 Motor[^<]*<\/span>)/, '$1' + selo);
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
          ? `Hoje já atingiu ${ReforcoFila.limiteDisciplinasDia()} disciplina(s) do reforço (ou esta matéria já está no rodízio)`
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

    /* O reforço precisa ser executável sem adivinhação: quantidade do caderno
       + trilha/filtros que devem ser marcados no TEC ficam visíveis também no
       painel "Reforços em curso", não só no cartão do dia. */
    const guiaTec = (typeof MotorCiclo !== 'undefined' && MotorCiclo.filtroTecDe)
      ? MotorCiclo.filtroTecDe(e) : null;
    if (guiaTec && !li.querySelector('.exc-tec-guide')) {
      const qtdCaderno = Math.max(1, Math.round(Number(guiaTec.quantidade || (MotorCiclo.origemDe(e) || {}).alvoQuestoes || e.alvo) || 1));
      const base = [guiaTec.disciplina].concat(Array.isArray(guiaTec.caminho) ? guiaTec.caminho : []).filter(Boolean);
      const rota = (guiaTec.agregado ? base : base.concat(guiaTec.selecoes || [])).filter(Boolean).join(' → ');
      const nivel = Math.max(1, Number(guiaTec.nivel) || 1);
      const rotulo = nivel <= 1 ? 'tópico' : (nivel === 2 ? 'subtópico' : 'subtópico nível ' + nivel);
      const box = document.createElement('div');
      box.className = 'exc-tec-guide';
      box.style.cssText = 'margin-top:8px;padding:9px 10px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface-sunken);font-size:var(--fs-sm);';
      box.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>🎯 Caderno no TEC</b><strong>'
        + qtdCaderno + ' questões</strong></div>'
        + '<div class="hint" style="margin-top:4px;"><b>Filtro:</b> ' + escapeHtml(rota) + '</div>'
        + (guiaTec.agregado
          ? '<div class="hint" style="margin-top:3px;"><b>Marque juntos:</b> '
            + (guiaTec.selecoes || []).map(escapeHtml).join(' + ')
            + ' <span class="opt">(' + (guiaTec.selecoes || []).length + ' itens no mesmo nível)</span></div>'
          : '<div class="hint" style="margin-top:3px;"><b>Selecionar:</b> '
            + escapeHtml((guiaTec.selecoes || [])[0] || '') + ' <span class="opt">(' + escapeHtml(rotulo) + ')</span></div>');
      const acoesHost = li.querySelector('.exc-acoes');
      if (acoesHost) li.insertBefore(box, acoesHost);
      else li.appendChild(box);
    }

    const nums = li.querySelector('.pl-ciclo-nums');
    if (nums && !nums.querySelector('.exc-hoje')) {
      nums.insertAdjacentHTML('afterbegin', `<span class="exc-hoje" title="Parcela executável desta data."><small>Hoje</small><b>${Math.min(q, feitoHoje)}</b>/${q} q</span>`);
    }
    const lim = ReforcoFila.limitesBloco(e);
    if (nums && !nums.querySelector('.exc-carga')) {
      nums.insertAdjacentHTML('beforeend', `<span class="exc-carga" title="Faixa usada para recalcular as próximas parcelas. O dia atual fica congelado."><small>Carga</small><b>${lim.min}–${lim.max}</b> q${lim.personalizado ? ' · específica' : ' · padrão'}</span>`);
    }
    const acoes = li.querySelector('.exc-acoes');
    if (acoes && !acoes.querySelector('[data-curso-carga]')) {
      acoes.insertAdjacentHTML('beforeend', `<button type="button" class="pl-ciclo-acao" data-curso-carga="${escapeHtml(e.id)}">Ajustar carga</button>`);
    }
  });

  host.querySelectorAll('[data-curso-carga]').forEach(b => b.addEventListener('click', () => {
    const li = b.closest('li[data-id]'); const e = DB.getExtra(b.dataset.cursoCarga); if (!li || !e) return;
    const aberto = li.querySelector('.exc-carga-editor'); if (aberto) { aberto.remove(); return; }
    const lim = ReforcoFila.limitesBloco(e);
    const ed = document.createElement('div'); ed.className = 'exc-carga-editor';
    ed.innerHTML = `<div><strong>Carga das próximas parcelas</strong><small>Hoje não muda. O futuro deste ciclo é recalculado.</small></div>
      <label>Mínimo <input type="number" min="1" max="100" value="${lim.min}" data-carga-min></label>
      <label>Máximo <input type="number" min="1" max="100" value="${lim.max}" data-carga-max></label>
      <div class="exc-carga-actions"><button type="button" class="btn-secondary" data-carga-este>Só este reforço</button><button type="button" class="btn-secondary" data-carga-todos>Aplicar a todos</button><button type="button" class="btn-secondary" data-carga-padrao>Usar padrão</button></div>`;
    li.appendChild(ed);
    const vals = () => [Number(ed.querySelector('[data-carga-min]').value), Number(ed.querySelector('[data-carga-max]').value)];
    ed.querySelector('[data-carga-este]').addEventListener('click', () => { const [mi, ma] = vals(); ReforcoFila.salvarCargaExtra(e.id, mi, ma); showToast('Carga específica atualizada ✓'); ExtrasScreen.render(); });
    ed.querySelector('[data-carga-todos]').addEventListener('click', () => { const [mi, ma] = vals(); ReforcoFila.aplicarCargaTodos(mi, ma); showToast('Carga aplicada a todos os reforços ativos ✓'); ExtrasScreen.render(); });
    ed.querySelector('[data-carga-padrao]').addEventListener('click', () => { ReforcoFila.usarCargaPadrao(e.id); showToast('Este reforço voltou a usar o padrão ✓'); ExtrasScreen.render(); });
  }));

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

/* A fila diaria nao decide sugestoes; apenas agenda e executa reforcos. */
window.ReforcoFila = ReforcoFila;
