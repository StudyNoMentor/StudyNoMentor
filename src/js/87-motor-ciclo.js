/* ============================================================================
   CICLO DO MOTOR DE SUGESTÃO
   ----------------------------------------------------------------------------
   O Motor decide prioridade; este módulo só acompanha a execução entre dois
   retratos do TEC. Não existe segundo modelo, score paralelo ou plano legado.

   Ciclo:
     medir -> ordenar -> escolher até 3 matérias -> executar uma frente de cada
     -> importar novo retrato -> reordenar tudo -> manter ou trocar matérias.

   Uma atividade nunca "segura" uma matéria no ranking. Se a disciplina deixa
   o grupo prioritário no retrato seguinte, a rodada é encerrada por rotação e
   a vaga fica livre para uma lacuna maior.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__motorCiclo) return;
  window.__motorCiclo = true;

  const LEGACY_ORIGIN_KEY = 'origem' + 'Plano';
  const norm = (s) => {
    try { return ReforcoEngine.norm(s || ''); }
    catch (_) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  };
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;

  const C = {
    origemDe(extra) {
      if (!extra) return null;
      return extra.origemMotor || extra[LEGACY_ORIGIN_KEY] || null;
    },

    _ultimoRetrato() {
      try {
        const s = (typeof MotorSugestao !== 'undefined' && MotorSugestao.retratoAtual)
          ? MotorSugestao.retratoAtual()
          : null;
        if (!s) return null;
        const data = s.endDate || s.date || s.startDate || '';
        return { id: String(s.id || ''), data, assinatura: String(s.id || '') + '|' + String(data) };
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-ciclo-retrato'); return null; }
    },

    titulo(nome, membros) {
      const base = (membros && membros.length > 1)
        ? String(nome || '').replace(/\s*·\s*bloco\s*$/i, '') + ' (bloco de ' + membros.length + ' tópicos)'
        : String(nome || '');
      return 'Reforçar: ' + base;
    },

    origem(topico, disciplina, item) {
      const p = MotorSugestao.prefs();
      const retrato = this._ultimoRetrato();
      const membros = item && Array.isArray(item.membros) ? item.membros.slice() : null;
      return {
        motor: 'sugestao',
        versao: 2,
        topico: topico || (item && item.nome) || '',
        disciplina: disciplina || (item && item.disciplina) || '',
        criadoEm: typeof todayLocal === 'function' ? todayLocal() : new Date().toISOString().slice(0, 10),
        taxaInicial: item && item.taxa != null ? num(item.taxa) : null,
        qBase: item && item.questoes != null ? num(item.questoes) : 0,
        metaAlvo: p.metaAcerto,
        alvoQuestoes: item && item.dose != null ? num(item.dose) : p.alvoQuestoes,
        caminho: item && Array.isArray(item.caminho) ? item.caminho.slice() : [],
        membros,
        escopo: membros && membros.length > 1 ? { tipo: 'bloco', membros: membros.slice() } : { tipo: 'no', membros: [topico || (item && item.nome) || ''] },
        fase: p.fase,
        minAmostra: p.minAmostra,
        rankInicial: item && item.disciplinaRank != null ? num(item.disciplinaRank) : null,
        lacunaDiscInicial: item && item.disciplinaLacuna != null ? num(item.disciplinaLacuna) : null,
        retratoBase: retrato ? retrato.assinatura : null,
        retratoDataBase: retrato ? retrato.data : null
      };
    },

    _disciplinaAtual(r, nome) {
      const k = norm(nome);
      return (r && r.disciplinasTodas || []).find(d => norm(d.nome) === k) || null;
    },

    _rankAtual(r, nome) {
      const k = norm(nome);
      const d = (r && r.disciplinas || []).find(x => norm(x.nome) === k);
      return d ? num(d.rank) : null;
    },

    avaliar(extra, resultado) {
      const o = this.origemDe(extra);
      if (!o || !o.topico) return null;
      let r = resultado;
      try { if (!r) r = MotorSugestao.calcular(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-ciclo-calcular'); }
      if (!r || r.erro) return null;

      const atual = MotorSugestao.estadoAtual(o) || null;
      const d = this._disciplinaAtual(r, o.disciplina);
      const rank = this._rankAtual(r, o.disciplina);
      const p = r.prefs || MotorSugestao.prefs();
      const manual = DB.extraProgressoPeriodo ? num(DB.extraProgressoPeriodo(extra)) : num(extra.progresso);
      const qAgora = atual ? num(atual.questoes) : num(o.qBase);
      const medido = Math.max(0, qAgora - num(o.qBase));
      const feito = Math.max(manual, medido);
      const alvo = Math.max(1, num(extra.alvo, num(o.alvoQuestoes, p.alvoQuestoes)));
      const taxa = atual && atual.taxa != null ? num(atual.taxa) : null;
      const meta = num(o.metaAlvo, p.metaAcerto);
      const lacunaDisc = d ? num(d.lacunaDisc) : 0;
      const noGrupo = rank != null && rank <= num(p.maxFrentes, 3);
      const retrato = this._ultimoRetrato();
      const baseData = String(o.retratoDataBase || '');
      const novoRetrato = !!(retrato && (baseData
        ? String(retrato.data || '') > baseData
        : (!o.retratoBase || retrato.assinatura !== o.retratoBase)));

      let estado = 'andamento';
      if (!atual && !d) estado = 'orfa';
      else if (taxa != null && taxa >= meta) estado = 'resolvida';
      else if (novoRetrato && !noGrupo) estado = 'rotacionada';
      else if (feito >= alvo && novoRetrato) estado = 'rodada';
      else if (feito >= alvo) estado = 'aguardando';

      return {
        extra, origem: o, atual, disciplinaAtual: d,
        rank, lacunaDisc, noGrupo, novoRetrato,
        alvo, feito, falta: Math.max(0, alvo - feito),
        pct: Math.min(100, Math.round(feito / alvo * 100)),
        taxa, meta, delta: (taxa != null && o.taxaInicial != null) ? taxa - num(o.taxaInicial) : null,
        estado
      };
    },

    _migrarOrigem(extra, origem) {
      if (!extra || !origem || extra.origemMotor) return origem;
      const nova = Object.assign({}, origem, { motor: 'sugestao', versao: 2 });
      try { DB.updateExtra(extra.id, { origemMotor: nova, [LEGACY_ORIGIN_KEY]: null }); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-ciclo-migrar-origem'); }
      return nova;
    },

    conciliar() {
      let r = null;
      try { r = MotorSugestao.calcular(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-ciclo-conciliar-calculo'); }
      if (!r || r.erro) return { fechadas: [], rotacionadas: [], resolvidas: [], rodadas: [] };

      const fechadas = [], rotacionadas = [], resolvidas = [], rodadas = [];
      (DB.getExtras() || []).forEach(extra => {
        let origem = this.origemDe(extra);
        if (!origem || !origem.topico || extra.status === 'concluida') return;
        origem = this._migrarOrigem(extra, origem);
        const v = this.avaliar(Object.assign({}, extra, { origemMotor: origem }), r);
        if (!v || !['resolvida','rotacionada','rodada'].includes(v.estado)) return;

        const veredito = {
          tipo: v.estado,
          em: typeof todayLocal === 'function' ? todayLocal() : new Date().toISOString().slice(0, 10),
          taxaInicial: origem.taxaInicial,
          taxaFinal: v.taxa,
          questoes: v.feito,
          alvo: v.alvo,
          rankFinal: v.rank,
          lacunaDiscFinal: v.lacunaDisc
        };
        const novaOrigem = Object.assign({}, origem, { veredito });
        DB.updateExtra(extra.id, { status: 'concluida', origemMotor: novaOrigem, [LEGACY_ORIGIN_KEY]: null });
        fechadas.push(extra.id);
        if (v.estado === 'rotacionada') rotacionadas.push(extra.id);
        if (v.estado === 'resolvida') resolvidas.push(extra.id);
        if (v.estado === 'rodada') rodadas.push(extra.id);
      });
      return { fechadas, rotacionadas, resolvidas, rodadas };
    },

    emCurso() {
      let r = null;
      try { r = MotorSugestao.calcular(); } catch (_) {}
      return (DB.getExtras() || [])
        .filter(e => e.status !== 'concluida' && this.origemDe(e) && this.origemDe(e).topico)
        .map(e => this.avaliar(e, r))
        .filter(Boolean);
    },

    fechados() {
      return (DB.getExtras() || []).filter(e => {
        const o = this.origemDe(e);
        return e.status === 'concluida' && o && o.veredito;
      });
    },

    atividadeSobreposta(topico, disciplina, membros) {
      const alvo = {
        topico: topico || '',
        disciplina: disciplina || '',
        escopo: membros && membros.length ? { membros: membros.slice() } : { membros: [topico || ''] }
      };
      const setAlvo = new Set((alvo.escopo.membros || []).map(norm).filter(Boolean));
      for (const e of (DB.getExtras() || [])) {
        if (e.status === 'concluida') continue;
        const o = this.origemDe(e);
        if (!o || norm(o.disciplina || '') !== norm(disciplina || '')) continue;
        const ms = (o.escopo && o.escopo.membros) || o.membros || [o.topico];
        const set = new Set(ms.map(norm).filter(Boolean));
        const cruza = [...setAlvo].some(x => set.has(x))
          || set.has(norm(topico || ''))
          || setAlvo.has(norm(o.topico || ''));
        if (cruza) return { extra: e, noDela: o.topico, relacao: set.size >= setAlvo.size ? 'cobre' : 'contida' };
      }
      return null;
    },

    fotoDoProgresso(extra) { return this.avaliar(extra); },
    repinarProgresso() { return { atualizadas: 0 }; }
  };

  window.MotorCiclo = C;
})();