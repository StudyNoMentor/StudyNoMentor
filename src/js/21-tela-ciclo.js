/* ============================================================
   TELA: CICLO DA SEMANA
   ============================================================ */
const CycleEngine = {
  // Mesma lógica da planilha: peso = (1 + dificuldade*0.1) * (0.2 se Sólido, senão 1)
  weight(dificuldade, fase) {
    const base = 1 + dificuldade * 0.1;
    return fase === 'Sólido' ? base * 0.2 : base;
  },
  // distribui as horas semanais proporcionalmente ao peso de cada matéria
  suggestMinutes(subjects, weeklyHours) {
    const weights = subjects.map(s => this.weight(s.dificuldade, s.fase));
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    const totalMinutes = weeklyHours * 60;
    return subjects.map((s, i) => {
      const share = weights[i] / totalWeight;
      const minutes = Math.max(60, Math.round(share * totalMinutes)); // mínimo 1h por matéria
      return { ...s, sugeridoMin: minutes, definidoMin: minutes };
    });
  },

  /* ---------- Pós-edital: ponderação estratégica (lógica da planilha) ----------
     Total de Pontos = Qtd Questões × Pontos/Questão × Peso
     Relevância      = Total de Pontos ÷ Σ Total de Pontos
     Pontuação       = Relevância × (1 + Dificuldade×0,1 + Extensão×0,1)
     Tempo sugerido  = (Pontuação ÷ Σ Pontuação) × Carga horária semanal          */
  totalPontos(s) {
    return (parseFloat(s.qtdQuestoes) || 0) * (parseFloat(s.pontosPorQuestao) || 1) * (parseFloat(s.peso) || 1);
  },
  posScore(s, somaPontos) {
    const relevancia = somaPontos > 0 ? this.totalPontos(s) / somaPontos : 0;
    const dif = parseFloat(s.dificuldade) || 1;
    const ext = parseFloat(s.extensao) || 1;
    return relevancia * (1 + dif * 0.1 + ext * 0.1);
  },
  suggestMinutesPos(subjects, weeklyHours) {
    const somaPontos = subjects.reduce((a, s) => a + this.totalPontos(s), 0);
    const scores = subjects.map(s => this.posScore(s, somaPontos));
    const totalScore = scores.reduce((a, b) => a + b, 0) || 1;
    const totalMinutes = weeklyHours * 60;
    return subjects.map((s, i) => {
      const share = scores[i] / totalScore;
      // pós-edital NÃO usa piso de 1h (segue a planilha): o tempo é proporcional ao peso estratégico
      const minutes = Math.max(0, Math.round(share * totalMinutes));
      const tp = this.totalPontos(s);
      return {
        ...s,
        totalPontos: tp,
        relevancia: somaPontos > 0 ? tp / somaPontos : 0,
        pontuacao: scores[i],
        sugeridoMin: minutes,
        definidoMin: minutes
      };
    });
  },
  // Escolhe o método de sugestão conforme o modo do planejamento ('pos' | 'pre')
  suggestMinutesFor(subjects, weeklyHours, mode) {
    return mode === 'pos'
      ? this.suggestMinutesPos(subjects, weeklyHours)
      : this.suggestMinutes(subjects, weeklyHours);
  },
  // normaliza nome (matéria/método) p/ casamento robusto: sem espaços extras, sem acentos, minúsculas
  normKey(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  },
  // minutos já estudados desta matéria dentro do intervalo da semana (casamento robusto por nome)
  minutesStudied(subjectName, startDate, endDate) {
    const key = this.normKey(subjectName);
    return DB.getEntries()
      .filter(e => this.normKey(e.subject) === key && e.date >= startDate && e.date <= endDate)
      .reduce((sum, e) => sum + (e.durationMin || 0), 0);
  },
  /* Questões resolvidas e acertos desta matéria no intervalo (para o % de aproveitamento).
     subjectName === null soma TODAS as matérias (aproveitamento geral da semana).

     `entries` existe para o HISTÓRICO CONSOLIDADO (escopo "todos os
     planejamentos"): sem ele a função lia sempre DB.getEntries(), ou seja, os
     registros do planejamento ATIVO — e o detalhe de uma semana de OUTRO
     planejamento mostrava o aproveitamento do plano errado, brigando com o
     próprio selo de acerto daquele cartão. */
  questionsStudied(subjectName, startDate, endDate, entries) {
    const key = subjectName == null ? null : this.normKey(subjectName);
    return (entries || DB.getEntries())
      .filter(e => (key === null || this.normKey(e.subject) === key) && e.date >= startDate && e.date <= endDate)
      .reduce((acc, e) => { acc.total += (Number(e.total) || 0); acc.correct += (Number(e.correct) || 0); return acc; }, { total: 0, correct: 0 });
  },
  /* effectiveEnd() foi REMOVIDA na auditoria de métricas. Ela estendia o fim do
     ciclo até hoje e era usada SÓ para as questões — os minutos usavam rangeEnd().
     Resultado: na mesma tela, o tempo parava no término da semana e o
     aproveitamento continuava somando questões de depois dele. E o comentário
     dizia ser "consistente com o fechamento", que usa cycle.endDate. Agora TODA
     medição do ciclo (minutos, questões, aproveitamento) usa rangeEnd(). */
  /* BUG CORRIGIDO — fim do intervalo do ciclo.
     Varios pontos passavam `cycle.endDate` cru para minutesStudied(). Quando o
     ciclo nao tinha endDate gravado (ciclos legados e importados nao tem), a
     comparacao `e.date <= undefined` e SEMPRE falsa: o filtro devolvia zero e a
     tela mostrava "0h realizado" em todas as matérias — enquanto o total da
     semana, que somava os registros por outro caminho, mostrava as horas certas.
     Era exatamente a divergencia de contabilizacao entre os numeros do topo e os
     das matérias. rangeEnd() garante uma data valida sempre. */
  rangeEnd(cycle) {
    if (!cycle) return todayLocal();
    return cycle.endDate || this.weekEndDate(cycle.startDate);
  },
  /* minutesStudiedSince()/lastEntryDateSince() também saíram: ninguém as
     chamava e a documentação delas afirmava uma regra que o app NÃO segue
     ("o ciclo acumula tudo, sem limite superior"). Documentação que descreve
     uma métrica inexistente é pior que nenhuma — quem lesse concluiria que os
     números da tela contam mais do que contam. */
  // Recalcula os AGREGADOS de uma semana do histórico de forma fiel aos registros:
  // dado o snapshot (com suas matérias/metas) e um intervalo [start,end], soma os
  // registros reais e devolve um patch com os valores derivados. As mesmas fórmulas
  // usadas no fechamento do ciclo — garante coesão total entre telas.
  /* ── APROVEITAMENTO DE UM PERÍODO ─────────────────────────────────────────
     Fonte ÚNICA da métrica. Antes a fórmula estava escrita duas vezes (no
     fechamento da semana e no recálculo) e ainda por cima DIFERIA da usada na
     tela de Evolução — a mesma semana aparecia com dois números.

     A regra correta é a AGREGADA: soma de acertos ÷ soma de questões.
     Cada questão vale uma.

     A regra antiga era a média aritmética dos percentuais de cada sessão, o
     que dá peso igual a sessões de tamanhos muito diferentes: uma tentativa de
     9 questões pesava o mesmo que uma de 100. Como sessões curtas produzem
     percentuais mais extremos, elas puxavam o resultado — nos dados reais que
     motivaram esta correção, o desvio ia de 0,47 a 2,62 pontos, SEMPRE para
     baixo. "Aproveitamento" significa quantas questões você acertou, não a
     média das suas sessões. */
  aproveitamentoNoPeriodo(startDate, endDate, entries) {
    const lista = (entries || DB.getEntries())
      .filter(e => e.date >= startDate && e.date <= endDate && (Number(e.total) || 0) > 0);
    if (!lista.length) return null;
    let acertos = 0, questoes = 0;
    lista.forEach(e => { acertos += (Number(e.correct) || 0); questoes += (Number(e.total) || 0); });
    if (questoes <= 0) return null;
    return Math.round((acertos / questoes) * 10000) / 100;   // 2 casas
  },

  /* ── PROGRESSO DA SEMANA — FONTE ÚNICA ────────────────────────────────────
     A MESMA semana era medida por TRÊS fórmulas diferentes, e por isso mudava
     de número ao ser arquivada:

       · Ciclo ao vivo  — somava só as matérias do ciclo, com teto de 3× a meta
                          por matéria, e mostrava o % com 2 casas;
       · Fechar semana  — somava TODOS os registros do período (inclusive de
                          matérias fora do ciclo), com teto global de 150%, e
                          mostrava o % inteiro;
       · Recalcular     — repetia a fórmula do fechamento.

     Fechar a semana podia, sozinho, mudar "estudado" e "% cumprido" — sem que
     um único registro tivesse sido tocado. Pior: no fechamento o "estudado"
     incluía matérias fora do ciclo, mas era comparado com a meta que só
     considera as matérias DO ciclo; a barra media uma coisa contra outra.

     Regra única, agora: o progresso da semana é o das matérias que ESTÃO na
     semana, sem teto artificial nenhum. Σ realizado ÷ Σ meta. Quem quiser o
     tempo total do período (todas as matérias) tem a tela de Evolução, que é
     onde essa pergunta mora. O teto some porque ele mentia nos dois sentidos:
     escondia o excesso real de quem estudou muito e, no fechamento, ainda
     transformava 220% em 150%.                                             */
  progressoSemana(subjects, startDate, endDate, metas) {
    const lista = (subjects || []).map(s => {
      // meta editável (quando fornecida) sobrescreve a definida no ciclo/snapshot
      let definido = s.definidoMin || 0;
      if (metas) {
        const ov = metas[this.normKey(s.nome)];
        if (ov !== undefined && ov !== '' && ov !== null) definido = Math.max(0, parseInt(ov, 10) || 0);
      }
      const estudado = this.minutesStudied(s.nome, startDate, endDate);
      return { ...s, definidoMin: definido, estudadoMin: estudado, status: this.statusFor(estudado, definido) };
    });
    const totalTargetMin = lista.reduce((a, s) => a + (s.definidoMin || 0), 0);
    const totalStudiedMin = lista.reduce((a, s) => a + (s.estudadoMin || 0), 0);
    return {
      subjects: lista,
      totalTargetMin,
      totalStudiedMin,
      // 2 casas: com metas em minutos, 1 casa esconde progresso real
      // (ex.: 8h05 de 12h = 67,36%, que aparecia como 67% por horas a fio).
      pctCumprido: totalTargetMin > 0 ? Math.round((totalStudiedMin / totalTargetMin) * 10000) / 100 : 0,
      finalizadas: lista.filter(s => s.status === 'finalizada').length,
      totalSubjects: lista.length,
      restanteMin: Math.max(0, totalTargetMin - totalStudiedMin)
    };
  },

  recomputeWeek(snapshot, opts) {
    opts = opts || {};
    const startDate = opts.startDate || (snapshot && snapshot.startDate);
    const endDate = opts.endDate || (snapshot && snapshot.endDate);
    const weeklyHours = (opts.weeklyHours != null) ? opts.weeklyHours : (snapshot && snapshot.weeklyHours) || 0;
    const entries = DB.getEntries().filter(e => e.date >= startDate && e.date <= endDate);
    const prog = this.progressoSemana((snapshot && snapshot.subjects) || [], startDate, endDate, opts.metas || null);
    return {
      startDate, endDate,
      weeklyHours: weeklyHours,
      subjects: prog.subjects,
      totalTargetMin: prog.totalTargetMin,
      totalStudiedMin: prog.totalStudiedMin,
      pctCumprido: prog.pctCumprido,
      finalizadas: prog.finalizadas,
      totalSubjects: prog.totalSubjects,
      avgPerformancePct: this.aproveitamentoNoPeriodo(startDate, endDate, entries)
    };
  },
  statusFor(studiedMin, targetMin) {
    if (studiedMin <= 0) return 'pendente';
    if (studiedMin >= targetMin) return 'finalizada';
    return 'iniciada';
  },
  weekEndDate(startDate) {
    // término = 6 dias após o início (contando o próprio dia de início, dá os 7 dias da semana)
    const d = new Date(startDate + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  fmtHM(min) {
    // defensivo: minutos ausentes/NaN (semanas legadas, importações) não podem
    // gerar "NaNh NaNmin" na tela. Trata como 0.
    if (typeof min !== 'number' || !isFinite(min)) min = 0;
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return (h > 0 ? h + 'h ' : '') + (m > 0 || h === 0 ? m + 'min' : '');
  },
  // carga horária semanal (em horas decimais) formatada: 35.5 -> "35h 30min", 36 -> "36h"
  fmtWeeklyHours(hDecimal) {
    const totalMin = Math.round((hDecimal || 0) * 60);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return h + 'h' + (m > 0 ? ' ' + m + 'min' : '');
  },
  // gera siglas curtas e únicas para as matérias do ciclo, para uso na grade da semana
  STOPWORDS: new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'para', 'com']),
  baseAcronym(nome) {
    const words = nome
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
      .toUpperCase()
      .split(/\s+/)
      .filter(w => w && !this.STOPWORDS.has(w.toLowerCase()));
    if (words.length === 0) return nome.slice(0, 4).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 5);
    // pega as 2 primeiras letras da 1ª palavra + as 2-3 primeiras da 2ª (estilo DCIV, DADM, LTE)
    const w1 = words[0], w2 = words[1];
    return (w1.slice(0, 2) + w2.slice(0, 3)).slice(0, 6);
  },
  assignAcronyms(subjects) {
    const used = new Set();
    return subjects.map(s => {
      let base = this.baseAcronym(s.nome);
      let candidate = base;
      let suffix = 1;
      while (used.has(candidate)) {
        suffix++;
        candidate = base.slice(0, Math.max(1, 6 - String(suffix).length)) + suffix;
      }
      used.add(candidate);
      return { ...s, acronym: candidate };
    });
  },
  // Sigla efetiva de uma matéria: usa a customizada (se houver) ou a gerada automaticamente.
  siglaForSubject(nome) {
    const custom = DB.getCustomSiglas().find(c => c.nome && this.normKey(c.nome) === this.normKey(nome));
    return (custom && custom.sigla) ? custom.sigla : this.baseAcronym(nome);
  },
  // Cor de uma matéria/sigla (customizada tem prioridade; senão, padrão do acento).
  colorForSubject(nome) {
    const custom = DB.getCustomSiglas().find(c => c.nome && this.normKey(c.nome) === this.normKey(nome));
    return (custom && custom.color) ? custom.color : '';
  },
  // Mapa nome->sigla de TODAS as fontes (matérias ativas + siglas customizadas livres),
  // para a grade e o tray funcionarem independentemente do ciclo.
  buildAcronymMap() {
    const map = {};
    DB.getActiveSubjects().forEach(s => { map[s.nome] = this.siglaForSubject(s.nome); });
    DB.getCustomSiglas().forEach(c => {
      const key = c.nome || c.sigla;
      if (key && !map[key]) map[key] = c.sigla || this.baseAcronym(key);
    });
    return map;
  }
};
