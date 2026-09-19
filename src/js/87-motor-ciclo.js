/* ============================================================================
   CICLO DO MOTOR DE SUGESTÃO
   ----------------------------------------------------------------------------
   O Motor decide prioridade; este módulo só acompanha a execução entre dois
   retratos do TEC. Não existe segundo modelo nem score paralelo.

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

  const norm = (s) => {
    try { return ReforcoEngine.norm(s || ''); }
    catch (_) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  };
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;

  const C = {
    origemDe(extra) {
      if (!extra) return null;
      return extra.origemMotor || null;
    },

    _ultimoRetrato() {
      try {
        const s = (typeof MotorSugestao !== 'undefined' && MotorSugestao.retratoDeCiclo)
          ? MotorSugestao.retratoDeCiclo()
          : (typeof MotorSugestao !== 'undefined' && MotorSugestao.retratoAtual)
          ? MotorSugestao.retratoAtual()
          : null;
        if (!s) return null;
        const data = s.endDate || s.date || s.startDate || '';
        const fontes = (Array.isArray(s._fontes) && s._fontes.length) ? s._fontes : [s];
        const assinarFonte = f => {
          let h = 2166136261 >>> 0;
          const mix = v => {
            const t = String(v == null ? '' : v);
            for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
            h = Math.imul(h ^ 31, 16777619) >>> 0;
          };
          mix(f.id); mix(f.startDate || f.date); mix(f.endDate || f.date); mix(f.importedAt);
          (f.rows || []).forEach(r => {
            mix(r.codigo); mix(r.nome); mix(r.disciplina); mix(r.depth); mix(r.questoes); mix(r.acertos);
          });
          return [f.id || '', f.startDate || f.date || '', f.endDate || f.date || '', h.toString(36)].join(':');
        };
        const assinatura = fontes.map(assinarFonte).sort().join('|');
        return { id: String(s.id || ''), data, assinatura };
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-ciclo-retrato'); return null; }
    },

    titulo(nome, membros) {
      const base = (membros && membros.length > 1)
        ? String(nome || '').replace(/\s*·\s*bloco\s*$/i, '') + ' (bloco de ' + membros.length + ' tópicos)'
        : String(nome || '');
      return 'Reforçar: ' + base;
    },

    /* Receita operacional do caderno no TEC. O Motor trabalha com nomes
       semânticos porque os códigos 01/02/03 são posicionais e podem mudar entre
       retratos. Assim, a atividade guarda exatamente a trilha que a pessoa deve
       abrir e o(s) tópico(s)/subtópico(s) que precisa marcar no TEC. */
    filtroTec(item, disciplina) {
      item = item || {};
      const disc = String(disciplina || item.disciplina || '').trim();
      const caminho = (Array.isArray(item.caminho) ? item.caminho : [])
        .map(x => String(x == null ? '' : x).trim()).filter(Boolean);
      const membros = (Array.isArray(item.membros) ? item.membros : [])
        .map(x => String(x == null ? '' : x).trim()).filter(Boolean);
      const nome = String(item.nome || '').replace(/\s*·\s*bloco\s*$/i, '').trim();
      const selecoes = membros.length > 1 ? membros : (nome ? [nome] : []);
      if (!disc || !selecoes.length) return null;
      const nivel = Math.max(1, num(item.nivel, caminho.length + 1));
      const agregado = membros.length > 1;
      const trilha = [disc].concat(caminho).concat(agregado ? [] : selecoes).filter(Boolean);
      return {
        versao: 1,
        disciplina: disc,
        nivel,
        tipo: agregado ? 'grupo' : 'no',
        agregado,
        caminho,
        selecoes,
        trilha,
        quantidade: item.dose != null ? Math.max(1, Math.round(num(item.dose))) : null
      };
    },

    origem(topico, disciplina, item) {
      const p = MotorSugestao.prefs();
      const retrato = this._ultimoRetrato();
      const membros = item && Array.isArray(item.membros) ? item.membros.slice() : null;
      const disciplinaFinal = disciplina || (item && item.disciplina) || '';
      const alvoQuestoes = item && item.dose != null ? Math.max(1, Math.round(num(item.dose))) : p.alvoQuestoes;
      const filtroTec = this.filtroTec(Object.assign({}, item || {}, { dose: alvoQuestoes }), disciplinaFinal);
      const origemConsulta = {
        topico: topico || (item && item.nome) || '',
        disciplina: disciplinaFinal,
        caminho: item && Array.isArray(item.caminho) ? item.caminho.slice() : [],
        membros,
        escopo: membros && membros.length > 1 ? { membros: membros.slice() } : null
      };
      const retratoCiclo = (typeof MotorSugestao.retratoDeCiclo === 'function')
        ? MotorSugestao.retratoDeCiclo() : null;
      const baseCiclo = MotorSugestao.estadoAtual(origemConsulta, { retrato: retratoCiclo });
      return {
        motor: 'sugestao',
        versao: 3,
        topico: topico || (item && item.nome) || '',
        disciplina: disciplinaFinal,
        criadoEm: typeof todayLocal === 'function' ? todayLocal() : new Date().toISOString().slice(0, 10),
        taxaInicial: baseCiclo && baseCiclo.taxa != null
          ? num(baseCiclo.taxa) : item && item.taxa != null ? num(item.taxa) : null,
        qBase: baseCiclo && baseCiclo.questoes != null
          ? num(baseCiclo.questoes) : item && item.questoes != null ? num(item.questoes) : 0,
        metaAlvo: p.metaAcerto,
        alvoQuestoes,
        nivel: item && item.nivel != null ? Math.max(1, num(item.nivel)) : null,
        caminho: item && Array.isArray(item.caminho) ? item.caminho.slice() : [],
        membros,
        filtroTec,
        escopo: membros && membros.length > 1 ? { tipo: 'bloco', membros: membros.slice() } : { tipo: 'no', membros: [topico || (item && item.nome) || ''] },
        fase: p.fase,
        minAmostra: p.minAmostra,
        rankInicial: item && item.disciplinaRankAcionavel != null
          ? num(item.disciplinaRankAcionavel)
          : item && item.disciplinaRank != null ? num(item.disciplinaRank) : null,
        lacunaDiscInicial: item && item.disciplinaLacuna != null ? num(item.disciplinaLacuna) : null,
        retratoBase: retrato ? retrato.assinatura : null,
        retratoDataBase: retrato ? retrato.data : null
      };
    },

    filtroTecDe(extra) {
      const o = this.origemDe(extra);
      if (!o || !o.topico || !o.disciplina) return null;
      if (o.filtroTec && Array.isArray(o.filtroTec.selecoes) && o.filtroTec.selecoes.length) {
        const f = Object.assign({}, o.filtroTec);
        f.caminho = Array.isArray(f.caminho) ? f.caminho.slice() : [];
        f.selecoes = f.selecoes.slice();
        f.trilha = Array.isArray(f.trilha) ? f.trilha.slice() : [f.disciplina].concat(f.caminho).concat(f.agregado ? [] : f.selecoes);
        f.quantidade = Math.max(1, Math.round(num(f.quantidade, o.alvoQuestoes || (extra && extra.alvo) || 1)));
        return f;
      }
      const membros = (o.escopo && Array.isArray(o.escopo.membros) && o.escopo.membros.length > 1)
        ? o.escopo.membros : (Array.isArray(o.membros) ? o.membros : null);
      return this.filtroTec({
        nome: o.topico,
        disciplina: o.disciplina,
        caminho: Array.isArray(o.caminho) ? o.caminho : [],
        membros,
        nivel: o.nivel != null ? o.nivel : ((o.caminho || []).length + 1),
        dose: o.alvoQuestoes || (extra && extra.alvo)
      }, o.disciplina);
    },

    _disciplinaAtual(r, nome) {
      const k = norm(nome);
      return (r && r.disciplinasTodas || []).find(d => norm(d.nome) === k) || null;
    },

    _rankAtual(r, nome) {
      const k = norm(nome);
      const d = (r && r.disciplinasAcionaveis || r && r.disciplinas || []).find(x => norm(x.nome) === k);
      return d ? num(d.rankAcionavel, d.rank) : null;
    },

    avaliar(extra, resultado) {
      const o = this.origemDe(extra);
      if (!o || !o.topico) return null;
      let r = resultado;
      try { if (!r) r = MotorSugestao.calcular(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-ciclo-calcular'); }
      if (!r || r.erro) return null;

      const retratoCiclo = (typeof MotorSugestao.retratoDeCiclo === 'function')
        ? MotorSugestao.retratoDeCiclo() : null;
      const atual = MotorSugestao.estadoAtual(o, { retrato: retratoCiclo }) || null;
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
      const baseAssinatura = String(o.retratoBase || '');
      const dataAtual = String(retrato && retrato.data || '');
      const mudouBase = !!(retrato && (!baseAssinatura || retrato.assinatura !== baseAssinatura));
      const assinaturaDeEscopo = baseAssinatura.includes(':');
      const avancouData = !!baseData && dataAtual > baseData;
      const revisouMesmoPeriodo = !!baseData && dataAtual === baseData && assinaturaDeEscopo && mudouBase;
      /* Assinaturas antigas eram "id|data". Não fechamos atividades abertas
         só porque a atualização passou a assinar todas as fontes do escopo. */
      const novoRetrato = mudouBase && (!baseData || avancouData || revisouMesmoPeriodo);

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

    conciliar() {
      let r = null;
      try { r = MotorSugestao.calcular(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'motor-ciclo-conciliar-calculo'); }
      if (!r || r.erro) return { fechadas: [], rotacionadas: [], resolvidas: [], rodadas: [] };

      const fechadas = [], rotacionadas = [], resolvidas = [], rodadas = [];
      (DB.getExtras() || []).forEach(extra => {
        const origem = this.origemDe(extra);
        if (!origem || !origem.topico || extra.status === 'concluida') return;
        const v = this.avaliar(extra, r);
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
        DB.updateExtra(extra.id, { status: 'concluida', origemMotor: novaOrigem });
        fechadas.push(extra.id);
        if (v.estado === 'rotacionada') rotacionadas.push(extra.id);
        if (v.estado === 'resolvida') resolvidas.push(extra.id);
        if (v.estado === 'rodada') rodadas.push(extra.id);
      });
      return { fechadas, rotacionadas, resolvidas, rodadas };
    },

    emCurso() {
      let r = null;
      try { r = MotorSugestao.calcular(); } catch (e) { _quiet(e, 'motor-ciclo-em-curso'); }
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
