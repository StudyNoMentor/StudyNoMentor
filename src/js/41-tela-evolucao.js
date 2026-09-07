/* ============================================================
   TELA: EVOLUÇÃO
   ============================================================ */
// ============================================================================
// CONQUISTAS — presença, marcos e recordes.
// Desenho deliberado para MOTIVAR SEM COBRAR:
//   • nenhuma contagem de sequência (streak) — dia sem estudo fica neutro, não vermelho
//   • marcos só sobem: não existe estado de falha
//   • o próximo marco só aparece quando está ao alcance, senão comemorar 500h viraria
//     "faltam 499h", que transforma conquista em dívida
//   • recordes vêm acompanhados do melhor recente, para um recorde antigo não
//     comunicar decadência
// ============================================================================
const ConquistasEngine = {
  RECENTE_DIAS: 90,
  MIN_Q_SEMANA: 30,      // amostra mínima para uma semana disputar recorde de acerto
  ESCADAS: {
    horas:    [10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
    questoes: [100, 500, 1000, 2500, 5000, 10000, 25000, 50000],
    dias:     [10, 30, 60, 100, 180, 365, 730, 1095],
    cards:    [100, 500, 1000, 5000, 10000, 25000, 50000]
  },
  _iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  _diasEntre(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); },
  // Segunda-feira da semana de uma data (chave de agrupamento semanal)
  _semanaDe(iso) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return this._iso(d);
  },
  // Mapa dia → { min, q, ac, cards, temAlgo }. Um dia em que você só revisou cards
  // ou só avançou uma atividade extra CONTA como presente.
  porDia(entries) {
    const m = {};
    const get = (dia) => (m[dia] = m[dia] || { min: 0, q: 0, ac: 0, cards: 0 });
    (entries || []).forEach(e => {
      if (!e.date) return;
      const d = get(e.date);
      d.min += (e.durationMin || 0); d.q += (e.total || 0); d.ac += (e.correct || 0);
    });
    try {
      (DB.getRevlog() || []).forEach(r => { if (r.date) get(r.date).cards++; });
    } catch (_) { _quiet(_); }
    try {
      (DB.getExtras() || []).forEach(x => (x.historico || []).forEach(h => {
        if (!h.data) return;
        const d = get(h.data); d.min += (h.minutos || 0);
      }));
    } catch (_) { _quiet(_); }
    Object.values(m).forEach(d => { d.temAlgo = (d.min > 0 || d.q > 0 || d.cards > 0); });
    return m;
  },
  // Calendário: N semanas terminando na semana atual, alinhado em segunda-feira
  calendario(entries, semanas) {
    const dias = this.porDia(entries);
    const hoje = todayLocal();
    const fim = new Date(hoje + 'T00:00:00');
    fim.setDate(fim.getDate() + (6 - ((fim.getDay() + 6) % 7)));   // domingo desta semana
    const total = semanas * 7;
    const grade = [];
    for (let i = total - 1; i >= 0; i--) {
      const d = new Date(fim); d.setDate(d.getDate() - i);
      const iso = this._iso(d);
      const info = dias[iso] || { min: 0, q: 0, ac: 0, cards: 0, temAlgo: false };
      grade.push({
        iso, futuro: iso > hoje, hoje: iso === hoje,
        min: info.min, q: info.q, cards: info.cards, presente: !!info.temAlgo,
        nivel: !info.temAlgo ? 0 : info.min >= 180 ? 3 : info.min >= 90 ? 2 : 1
      });
    }
    const ultimos = (n) => {
      let c = 0;
      for (let i = 0; i < n; i++) {
        const d = new Date(hoje + 'T00:00:00'); d.setDate(d.getDate() - i);
        if ((dias[this._iso(d)] || {}).temAlgo) c++;
      }
      return c;
    };
    return { grade, semanas, em7: ultimos(7), em30: ultimos(30) };
  },
  // Grade de UM mês (calendário tradicional), semana começando na segunda-feira.
  mesGrade(entries, ano, mes) {
    const dias = this.porDia(entries);
    const hoje = todayLocal();
    const primeiro = new Date(ano, mes, 1);
    const ultimoDia = new Date(ano, mes + 1, 0).getDate();
    const offset = (primeiro.getDay() + 6) % 7; // 0 = segunda
    const celulas = [];
    for (let i = 0; i < offset; i++) celulas.push(null);
    let presentes = 0, totMin = 0;
    for (let d = 1; d <= ultimoDia; d++) {
      const dt = new Date(ano, mes, d);
      const iso = this._iso(dt);
      const info = dias[iso] || { min: 0, q: 0, cards: 0, temAlgo: false };
      if (info.temAlgo) { presentes++; totMin += info.min; }
      celulas.push({ dia: d, iso, futuro: iso > hoje, hoje: iso === hoje,
        min: info.min, q: info.q, cards: info.cards, presente: !!info.temAlgo,
        nivel: !info.temAlgo ? 0 : info.min >= 180 ? 3 : info.min >= 90 ? 2 : 1 });
    }
    while (celulas.length % 7 !== 0) celulas.push(null);
    return { celulas, ano, mes, presentes, totalMin: totMin, diasNoMes: ultimoDia };
  },
  marcos(entries) {
    const dias = this.porDia(entries);
    const vals = Object.values(dias);
    const horas = Math.round(vals.reduce((a, d) => a + d.min, 0) / 60);
    const questoes = vals.reduce((a, d) => a + d.q, 0);
    const diasEstudo = vals.filter(d => d.temAlgo).length;
    const cards = vals.reduce((a, d) => a + d.cards, 0);
    const montar = (valor, escada, rot, unidade) => {
      const atingidos = escada.filter(x => x <= valor);
      const atual = atingidos.length ? atingidos[atingidos.length - 1] : null;
      const prox = escada.find(x => x > valor) || null;
      const anterior = atual || 0;
      const progresso = prox ? (valor - anterior) / (prox - anterior) : 1;
      return {
        rot, unidade, valor, atual, prox,
        // o próximo marco só aparece quando está perto (>=80% do caminho).
        // Longe dele, a linha só celebra o que já foi conquistado.
        mostrarProx: !!prox && progresso >= 0.8,
        falta: prox ? prox - valor : 0, progresso
      };
    };
    return [
      montar(horas, this.ESCADAS.horas, 'horas de estudo', 'h'),
      montar(questoes, this.ESCADAS.questoes, 'questões resolvidas', ''),
      montar(diasEstudo, this.ESCADAS.dias, 'dias com estudo', ''),
      montar(cards, this.ESCADAS.cards, 'cards revisados', '')
    ].filter(m => m.valor > 0);
  },
  // ── BADGES ────────────────────────────────────────────────────────────────
  // Cada badge é um FATO verificável sobre o que você já fez. Nenhuma tem prazo,
  // nenhuma expira, nenhuma pode ser perdida. Definição orientada a dados: o
  // contexto é calculado uma vez e cada badge só declara de onde tira seu número.
  CATEGORIAS: [
    { id: 'volume',    nome: 'Volume',    ico: '⏳', desc: 'o quanto você já acumulou' },
    { id: 'amplitude', nome: 'Amplitude', ico: '🗺️', desc: 'quanto terreno você cobriu' },
    { id: 'qualidade', nome: 'Qualidade', ico: '🎓', desc: 'o que virou conhecimento sólido' },
    { id: 'habito',    nome: 'Hábito',    ico: '🌗', desc: 'como você se mantém na caminhada' },
    { id: 'metodo',    nome: 'Método',    ico: '🧭', desc: 'o quanto você usa o próprio sistema' }
  ],
  _contexto(entries) {
    const dias = this.porDia(entries);
    const vals = Object.values(dias);
    const hoje = todayLocal();
    const g = (fn, d) => { try { return fn(); } catch (_) { return d; } };
    const cards = g(() => DB.getCards(), []);
    const revlog = g(() => DB.getRevlog(), []);
    const leis = g(() => DB.getLeis(), []);
    const extras = g(() => DB.getExtras(), []);
    const decks = g(() => DB.getDecks(), []);
    const tec = g(() => DB.getTecSnapshots(), []);
    const incid = g(() => DB.getIncidencia(), []);
    const ciclos = g(() => DB.getCycleHistory(), []);
    const ent = entries || [];

    // semanas e meses ativos
    const semanas = {}, meses = {};
    Object.keys(dias).forEach(k => {
      if (!dias[k].temAlgo) return;
      semanas[this._semanaDe(k)] = true;
      meses[k.slice(0, 7)] = (meses[k.slice(0, 7)] || 0) + 1;
    });
    // maior dia e maior semana em minutos
    const porSemanaMin = {};
    Object.keys(dias).forEach(k => { const w = this._semanaDe(k); porSemanaMin[w] = (porSemanaMin[w] || 0) + dias[k].min; });
    // retomadas: quantas vezes voltou depois de 7+ dias parado
    const ativos = Object.keys(dias).filter(k => dias[k].temAlgo).sort();
    let retomadas = 0, maiorPausa = 0, ultimaRetomada = null;
    for (let i = 1; i < ativos.length; i++) {
      const gap = this._diasEntre(ativos[i - 1], ativos[i]);
      if (gap >= 7) { retomadas++; if (gap > maiorPausa) { maiorPausa = gap; ultimaRetomada = ativos[i]; } }
    }
    // sequência de semanas com estudo (sem exibir como streak — só para uma badge)
    const semOrd = Object.keys(semanas).sort();
    let maiorSeqSem = 0, seq = 0;
    for (let i = 0; i < semOrd.length; i++) {
      if (i === 0 || this._diasEntre(semOrd[i - 1], semOrd[i]) === 7) seq++; else seq = 1;
      if (seq > maiorSeqSem) maiorSeqSem = seq;
    }
    // páginas lidas
    const paginas = ent.reduce((a, e) => a + Math.max(0, (e.pagFim || 0) - (e.pagIni || 0)), 0);
    // melhor semana de aproveitamento e melhor bateria num dia
    const semQ = {};
    ent.forEach(e => { if (!e.date) return; const w = this._semanaDe(e.date);
      const x = semQ[w] || { q: 0, ac: 0 }; x.q += (e.total || 0); x.ac += (e.correct || 0); semQ[w] = x; });
    const melhorSemPct = Object.values(semQ).filter(x => x.q >= 50).reduce((m, x) => Math.max(m, x.ac / x.q * 100), 0);
    const melhorDiaBateria = vals.filter(d => d.q >= 50).reduce((m, d) => Math.max(m, d.ac / d.q * 100), 0);
    // meses com 15+ dias ativos
    const mesesFirmes = Object.values(meses).filter(n => n >= 15).length;
    // Plano
    let solidos = 0, virada = null, dominio = 0, semCegos = false;
    try {
      const r = PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      if (r && !r.erro) {
        solidos = r.consolidados || 0; dominio = r.dominioPct || 0;
        semCegos = (r.ignorados === 0 && r.assuntos > 0);
        const v = (r.itens || []).find(x => x.pctHist != null && x.pctHist < 50 && x.taxa >= 80);
        if (v) virada = v.nome;
      }
    } catch (_) { _quiet(_); }
    const totQ = vals.reduce((a, d) => a + d.q, 0), totAc = vals.reduce((a, d) => a + d.ac, 0);
    return {
      horas: vals.reduce((a, d) => a + d.min, 0) / 60,
      questoes: totQ, acertos: totAc,
      aproveitamento: totQ ? totAc / totQ * 100 : 0,
      cardsRevisados: vals.reduce((a, d) => a + d.cards, 0),
      sessoes: ent.length, paginas,
      cardsCriados: cards.length,
      cardsMaduros: cards.filter(c => (c.s || 0) >= 21).length,
      cardsSemLapso: cards.filter(c => (c.reps || 0) >= 3 && !(c.lapses || 0)).length,
      cardsComImagem: cards.filter(c => /<img/i.test((c.frente || '') + (c.verso || ''))).length,
      leis: leis.length,
      leisMarcadas: leis.filter(l => (l.marcacoes || []).length > 0).length,
      leisComMarcador: leis.filter(l => l.bookmark != null).length,
      decks: decks.length,
      materias: new Set(ent.map(e => e.subject).filter(Boolean)).size,
      topicos: new Set(ent.map(e => e.topico).filter(Boolean).concat(cards.map(c => c.topico).filter(Boolean))).size,
      metodos: new Set(ent.map(e => e.method).filter(Boolean)).size,
      fases: new Set(ent.map(e => e.fase).filter(Boolean)).size,
      bancas: new Set(incid.map(r => r.banca).filter(Boolean)).size,
      retratos: tec.length,
      assuntosTec: new Set([].concat(...tec.map(t => (t.rows || []).filter(r => r.depth > 0).map(r => r.nome)))).size,
      discTec: new Set([].concat(...tec.map(t => (t.rows || []).map(r => r.disciplina).filter(Boolean)))).size,
      temIncidencia: incid.length > 0,
      ciclos: (ciclos || []).length,
      temGrade: g(() => Object.keys((DB.getGradeTemplate() || {}).grade || {}).length > 0, false),
      extrasCriadas: extras.length,
      extrasConcluidas: extras.reduce((n, x) => n + (DB.extraRecorrente(x) ? (x.concluidasEm || []).length : (x.status === 'concluida' ? 1 : 0)), 0),
      extrasDoPlano: extras.filter(x => x.origemPlano).length,
      reforcoQueFuncionou: extras.some(x => x.origemPlano && x.origemPlano.taxaInicial != null && (x.status === 'concluida' || (x.concluidasEm || []).length > 0)),
      diasEstudo: vals.filter(d => d.temAlgo).length,
      diasFimDeSemana: Object.keys(dias).filter(k => { if (!dias[k].temAlgo) return false; const w = new Date(k + 'T00:00:00').getDay(); return w === 0 || w === 6; }).length,
      semanasAtivas: Object.keys(semanas).length,
      mesesAtivos: Object.keys(meses).length,
      mesesFirmes, maiorSeqSem, retomadas, maiorPausa, ultimaRetomada,
      diasAtivos30: (() => { let c = 0; for (let i = 0; i < 30; i++) { const d = new Date(hoje + 'T00:00:00'); d.setDate(d.getDate() - i); if ((dias[this._iso(d)] || {}).temAlgo) c++; } return c; })(),
      maiorDiaMin: vals.reduce((m, d) => Math.max(m, d.min), 0),
      maiorSemanaMin: Object.values(porSemanaMin).reduce((m, v) => Math.max(m, v), 0),
      melhorSemPct, melhorDiaBateria,
      solidos, virada, dominio, semCegos,
      nuvem: g(() => !!(CloudStore && CloudStore.session), false),
      planejamentos: g(() => (PlanManager.getPlans() || []).length, 1)
    };
  },
  // n = número puro · h = horas · pc = percentual
  DEFS: [
    // ── VOLUME ──────────────────────────────────────────────────────────────
    { c: 'volume', i: '⏳', n: 'Horas na cadeira', k: 'horas', f: 'h', ns: [[10, 'Primeiros passos'], [50, 'Aquecendo'], [100, 'Constância'], [250, 'Rotina firme'], [500, 'Maratonista'], [1000, 'Mil horas'], [2000, 'Veterano']] },
    { c: 'volume', i: '🎯', n: 'Questões resolvidas', k: 'questoes', ns: [[100, 'Primeira leva'], [500, 'Pegando o jeito'], [1000, 'Artilheiro'], [5000, 'Metralhadora'], [10000, 'Dez mil'], [25000, 'Fora de série']] },
    { c: 'volume', i: '✅', n: 'Acertos acumulados', k: 'acertos', ns: [[100, 'Começou'], [1000, 'Mil certas'], [5000, 'Consistente'], [15000, 'Preciso']] },
    { c: 'volume', i: '🃏', n: 'Cards revisados', k: 'cardsRevisados', ns: [[100, 'Primeiro baralho'], [500, 'Pegando ritmo'], [1000, 'Memória treinada'], [5000, 'Disciplinado'], [10000, 'Memória de elefante']] },
    { c: 'volume', i: '✍️', n: 'Cards criados', k: 'cardsCriados', ns: [[10, 'Primeiros cards'], [50, 'Coleção'], [200, 'Baralho sério'], [500, 'Acervo'], [1000, 'Fábrica'] ] },
    { c: 'volume', i: '📖', n: 'Sessões registradas', k: 'sessoes', ns: [[10, 'Registrando'], [50, 'Hábito'], [200, 'Diário fiel'], [500, 'Arquivo vivo'], [1000, 'Historiador']] },
    { c: 'volume', i: '📄', n: 'Páginas lidas', k: 'paginas', ns: [[100, 'Primeiras páginas'], [500, 'Leitor'], [2000, 'Devorador'], [5000, 'Biblioteca inteira']] },
    { c: 'volume', i: '🔥', n: 'Dia mais longo', k: 'maiorDiaMin', f: 'min', ns: [[120, 'Duas horas'], [240, 'Quatro horas'], [360, 'Seis horas'], [480, 'Oito horas']] },
    { c: 'volume', i: '📅', n: 'Semana mais cheia', k: 'maiorSemanaMin', f: 'min', ns: [[600, 'Dez horas'], [1200, 'Vinte horas'], [1800, 'Trinta horas'], [2400, 'Quarenta horas']] },
    { c: 'volume', i: '🏁', n: 'Atividades concluídas', k: 'extrasConcluidas', ns: [[1, 'Primeira meta'], [5, 'Cumpridor'], [15, 'Executor'], [50, 'Imparável']] },
    // ── AMPLITUDE ───────────────────────────────────────────────────────────
    { c: 'amplitude', i: '📚', n: 'Matérias estudadas', k: 'materias', ns: [[2, 'Dupla'], [4, 'Explorando'], [6, 'Panorama'], [10, 'Visão ampla']] },
    { c: 'amplitude', i: '🔍', n: 'Tópicos diferentes', k: 'topicos', ns: [[10, 'Mapeando'], [50, 'Detalhista'], [150, 'Profundidade'], [400, 'Cartógrafo']] },
    { c: 'amplitude', i: '🗂️', n: 'Baralhos criados', k: 'decks', ns: [[1, 'Primeiro baralho'], [3, 'Organizado'], [8, 'Arquiteto'], [15, 'Curador']] },
    { c: 'amplitude', i: '§', n: 'Leis no leitor', k: 'leis', ns: [[1, 'Letra da lei'], [3, 'Vade mecum'], [10, 'Biblioteca'], [25, 'Acervo jurídico']] },
    { c: 'amplitude', i: '🖍️', n: 'Leis marcadas', k: 'leisMarcadas', ns: [[1, 'Primeiro grifo'], [5, 'Leitor ativo'], [15, 'Anotador']] },
    { c: 'amplitude', i: '🏛️', n: 'Bancas mapeadas', k: 'bancas', ns: [[1, 'Uma banca'], [2, 'Comparando'], [3, 'Multibanca'], [5, 'Panorama de bancas']] },
    { c: 'amplitude', i: '🧪', n: 'Formas de estudo', k: 'metodos', ns: [[2, 'Variando'], [4, 'Repertório'], [6, 'Caixa de ferramentas']] },
    { c: 'amplitude', i: '📐', n: 'Assuntos medidos no TEC', k: 'assuntosTec', ns: [[10, 'Diagnóstico inicial'], [40, 'Mapa em formação'], [100, 'Mapa detalhado'], [250, 'Raio-x completo']] },
    { c: 'amplitude', i: '🎓', n: 'Disciplinas no TEC', k: 'discTec', ns: [[1, 'Primeira'], [3, 'Frente ampla'], [6, 'Edital inteiro']] },
    { c: 'amplitude', i: '🖼️', n: 'Cards com imagem', k: 'cardsComImagem', ns: [[1, 'Primeira imagem'], [10, 'Visual'], [50, 'Memória visual']] },
    // ── QUALIDADE ───────────────────────────────────────────────────────────
    { c: 'qualidade', i: '🎓', n: 'Assuntos consolidados', k: 'solidos', ns: [[1, 'Primeiro domínio'], [5, 'Base sólida'], [15, 'Terreno firme'], [30, 'Fortaleza']] },
    { c: 'qualidade', i: '📈', n: 'Aproveitamento geral', k: 'aproveitamento', f: 'pc', ns: [[50, 'Meio caminho'], [60, 'Acima da média'], [70, 'Bom nível'], [80, 'Alto nível']] },
    { c: 'qualidade', i: '🏹', n: 'Melhor semana de acerto', k: 'melhorSemPct', f: 'pc', ns: [[70, 'Semana boa'], [80, 'Semana ótima'], [85, 'Semana excelente'], [90, 'Semana perfeita']] },
    { c: 'qualidade', i: '💪', n: 'Cards maduros', k: 'cardsMaduros', ns: [[10, 'Fixando'], [50, 'Memória firme'], [200, 'Longo prazo'], [500, 'Cristalizado']] },
    { c: 'qualidade', i: '🛡️', n: 'Cards sem nenhum erro', k: 'cardsSemLapso', ns: [[20, 'Limpos'], [100, 'Sólidos'], [400, 'Impecáveis']] },
    { c: 'qualidade', i: '🧠', n: 'Domínio da banca', k: 'dominio', f: 'pc', ns: [[40, 'Construindo'], [60, 'Meio do caminho'], [75, 'Bem posicionado'], [85, 'Pronto']] },
    { c: 'qualidade', i: '🎯', n: 'Bateria certeira', k: 'melhorDiaBateria', f: 'pc', ns: [[70, 'Dia bom'], [80, 'Dia ótimo'], [90, 'Dia perfeito']] },
    { c: 'qualidade', i: '📊', n: 'Sem pontos cegos', u: 'semCegos', d: 'todos os assuntos que você pratica têm amostra suficiente para diagnóstico', dOff: 'ter todos os assuntos com amostra suficiente' },
    { c: 'qualidade', i: '🚀', n: 'A virada', u: 'virada', d: (x) => 'você levou "' + x.virada + '" de menos de 50% para mais de 80%', dOff: 'levar um assunto de menos de 50% para mais de 80%' },
    { c: 'qualidade', i: '🔁', n: 'Reforço que funcionou', u: 'reforcoQueFuncionou', d: 'uma atividade criada pelo Plano foi concluída e o assunto melhorou', dOff: 'concluir uma atividade gerada pelo Plano de pontos fracos' },
    // ── HÁBITO ──────────────────────────────────────────────────────────────
    { c: 'habito', i: '🌗', n: 'Dias ativos no mês', k: 'diasAtivos30', ns: [[8, 'Presente'], [15, 'Metade do mês'], [21, 'Ritmo firme'], [26, 'Quase todo dia']] },
    { c: 'habito', i: '📆', n: 'Meses na caminhada', k: 'mesesAtivos', ns: [[2, 'Dois meses'], [6, 'Meio ano'], [12, 'Um ano'], [24, 'Dois anos'], [36, 'Três anos']] },
    { c: 'habito', i: '🗓️', n: 'Dias com estudo', k: 'diasEstudo', ns: [[15, 'Começando'], [60, 'Firmeza'], [180, 'Meia maratona'], [365, 'Um ano de dias'], [730, 'Longa jornada']] },
    { c: 'habito', i: '📈', n: 'Semanas ativas', k: 'semanasAtivas', ns: [[4, 'Um mês'], [12, 'Um trimestre'], [26, 'Um semestre'], [52, 'Um ano'], [104, 'Dois anos']] },
    { c: 'habito', i: '🏖️', n: 'Estudou no fim de semana', k: 'diasFimDeSemana', ns: [[5, 'Sábado produtivo'], [20, 'Fim de semana firme'], [60, 'Sem folga fixa']] },
    { c: 'habito', i: '💎', n: 'Meses firmes', k: 'mesesFirmes', d2: 'meses com 15 dias ou mais de estudo', ns: [[1, 'Primeiro mês firme'], [3, 'Trimestre firme'], [6, 'Semestre firme'], [12, 'Ano firme']] },
    { c: 'habito', i: '🔗', n: 'Semanas seguidas', k: 'maiorSeqSem', d2: 'sua maior sequência de semanas com algum estudo', ns: [[4, 'Um mês seguido'], [12, 'Um trimestre'], [26, 'Meio ano'], [52, 'Um ano']] },
    { c: 'habito', i: '🌅', n: 'Retomada', u: 'ultimaRetomada', d: (x) => 'você voltou depois de ' + x.maiorPausa + ' dias parado, em ' + formatDateShort(x.ultimaRetomada) + '. Parar acontece — voltar é o que conta.', dOff: 'voltar a estudar depois de uma pausa também é conquista' },
    { c: 'habito', i: '🦾', n: 'Voltou mais de uma vez', k: 'retomadas', d2: 'quantas vezes você retomou depois de uma pausa', ns: [[2, 'Persistente'], [4, 'Teimoso do bem'], [8, 'Inabalável']] },
    { c: 'habito', i: '🌱', n: 'Ainda na caminhada', u: 'sempre', d: 'você abriu o app hoje. Todo dia conta, inclusive os leves.', dOff: '' },
    // ── MÉTODO ──────────────────────────────────────────────────────────────
    { c: 'metodo', i: '🔄', n: 'Ciclos concluídos', k: 'ciclos', ns: [[1, 'Primeiro ciclo'], [5, 'Rodando'], [15, 'Método rodado'], [30, 'Engrenagem']] },
    { c: 'metodo', i: '▦', n: 'Grade montada', u: 'temGrade', d: 'você montou sua grade semanal', dOff: 'montar a Grade Semanal' },
    { c: 'metodo', i: '📥', n: 'Retratos do TEC', k: 'retratos', ns: [[1, 'Primeiro retrato'], [3, 'Acompanhando'], [6, 'Série histórica'], [12, 'Um ano de dados']] },
    { c: 'metodo', i: '🏛️', n: 'Incidência importada', u: 'temIncidencia', d: 'você mapeou o que a banca cobra', dOff: 'importar o Índice do Caderno na aba Incidência' },
    { c: 'metodo', i: '🎯', n: 'Atividades do Plano', k: 'extrasDoPlano', ns: [[1, 'Primeiro reforço'], [5, 'Plano em uso'], [15, 'Ciclo fechado']] },
    { c: 'metodo', i: '📌', n: 'Marcador de leitura', k: 'leisComMarcador', ns: [[1, 'Onde parei'], [3, 'Leitura organizada'], [8, 'Sempre no lugar']] },
    { c: 'metodo', i: '➕', n: 'Atividades extras criadas', k: 'extrasCriadas', ns: [[1, 'Primeira meta'], [5, 'Metas paralelas'], [15, 'Multitarefa']] },
    { c: 'metodo', i: '🗺️', n: 'Planejamentos', k: 'planejamentos', ns: [[1, 'Primeiro plano'], [2, 'Duas frentes'], [3, 'Estrategista']] },
    { c: 'metodo', i: '☁️', n: 'Backup na nuvem', u: 'nuvem', d: 'seus dados estão sincronizados', dOff: 'conectar a sincronização em Configurações' },
    { c: 'metodo', i: '🧭', n: 'Sistema completo', u: 'sistemaCompleto', d: 'você usa registro, cards, leis, TEC e atividades — o app inteiro trabalhando junto', dOff: 'usar registro, cards, leis, TEC e atividades extras' }
  ],
  badges(entries) {
    const x = this._contexto(entries);
    x.sempre = true;
    x.sistemaCompleto = (x.sessoes > 0 && x.cardsCriados > 0 && x.leis > 0 && x.retratos > 0 && x.extrasCriadas > 0);
    const fmt = (v, f) => f === 'h' ? Math.round(v) + 'h'
      : f === 'min' ? (v >= 60 ? (v / 60).toFixed(v % 60 ? 1 : 0) + 'h' : Math.round(v) + 'min')
      : f === 'pc' ? v.toFixed(0) + '%' : Math.round(v).toLocaleString('pt-BR');
    return this.DEFS.map(d => {
      if (d.u) {   // badge única (conquistou ou não)
        const ok = !!x[d.u];
        return {
          cat: d.c, ico: d.i, nome: d.n, unica: true, conquistada: ok, nivel: ok ? 'conquistada' : null,
          detalhe: ok ? (typeof d.d === 'function' ? d.d(x) : d.d) : d.dOff, progresso: ok ? 1 : 0
        };
      }
      const v = x[d.k] || 0;
      const niveis = d.ns.map(([val, rot]) => ({ v: val, rot }));
      const alc = niveis.filter(n => v >= n.v);
      const atual = alc.length ? alc[alc.length - 1] : null;
      const prox = niveis.find(n => n.v > v);
      const base = atual ? atual.v : 0;
      return {
        cat: d.c, ico: d.i, nome: d.n, conquistada: !!atual, nivel: atual ? atual.rot : null,
        detalhe: atual ? ('você já tem ' + fmt(v, d.f)) : ((d.d2 ? d.d2 + '. ' : '') + 'conquista a partir de ' + fmt(niveis[0].v, d.f)),
        progresso: prox ? Math.min(1, (v - base) / (prox.v - base)) : 1,
        prox: prox ? { rot: prox.rot, falta: fmt(prox.v - v, d.f) } : null,
        totalNiveis: niveis.length, nivelAtual: alc.length,
        // [MELHORIA 5] escada completa de níveis (para o modal ao clicar no cartão)
        valorFmt: fmt(v, d.f),
        niveis: niveis.map(nv => ({ rot: nv.rot, req: fmt(nv.v, d.f), alcancado: v >= nv.v }))
      };
    });
  },
  recordes(entries) {
    const dias = this.porDia(entries);
    const hoje = todayLocal();
    const sem = {};
    Object.keys(dias).forEach(iso => {
      const k = this._semanaDe(iso);
      const s = sem[k] || { min: 0, q: 0, ac: 0, dias: 0 };
      s.min += dias[iso].min; s.q += dias[iso].q; s.ac += dias[iso].ac;
      if (dias[iso].temAlgo) s.dias++;
      sem[k] = s;
    });
    const semArr = Object.entries(sem).filter(([, v]) => v.min > 0 || v.q > 0);
    const diaArr = Object.entries(dias).filter(([, v]) => v.temAlgo);
    const melhor = (arr, valor, filtro) => {
      const elegiveis = filtro ? arr.filter(([, v]) => filtro(v)) : arr;
      if (!elegiveis.length) return null;
      const top = elegiveis.reduce((a, b) => valor(b[1]) > valor(a[1]) ? b : a);
      return { data: top[0], valor: valor(top[1]), idade: this._diasEntre(top[0], hoje) };
    };
    const recente = (arr) => arr.filter(([k]) => this._diasEntre(k, hoje) <= this.RECENTE_DIAS);
    const par = (arr, valor, filtro, rot, fmt) => {
      const hist = melhor(arr, valor, filtro);
      if (!hist) return null;
      const rec = melhor(recente(arr), valor, filtro);
      return {
        rot, fmt,
        hist, rec,
        // recorde batido nos últimos 14 dias ganha selo de novidade
        novo: hist.idade <= 14,
        // só mostra o recente se for de outra data E com valor diferente — senão
        // a linha repetiria o mesmo número duas vezes
        mostraRec: !!rec && rec.data !== hist.data && Math.abs(rec.valor - hist.valor) > 0.05
      };
    };
    /* Recordes de DIA entram junto com os de semana: quem estuda todo dia so
       via marca semanal e nunca reconhecia o proprio melhor dia. O minimo de
       questoes evita que um 2/2 vire "melhor aproveitamento" e desvalorize o
       recorde de quem resolveu 80 com 88%. */
    const MIN_Q_DIA = Math.max(10, Math.round((this.MIN_Q_SEMANA || 30) / 3));
    return [
      par(semArr, v => v.min, null, 'Melhor semana em tempo', v => (v / 60).toFixed(1) + 'h'),
      par(semArr, v => v.q, null, 'Melhor semana em questões', v => Math.round(v) + ' questões'),
      par(semArr, v => v.q >= this.MIN_Q_SEMANA ? v.ac / v.q * 100 : -1,
        v => v.q >= this.MIN_Q_SEMANA, 'Melhor aproveitamento semanal', v => v.toFixed(0) + '%'),
      par(semArr, v => v.dias, v => v.dias > 0, 'Semana com mais dias de estudo', v => Math.round(v) + ' dia(s)'),
      par(diaArr, v => v.min, null, 'Melhor dia em tempo', v => (v / 60).toFixed(1) + 'h'),
      par(diaArr, v => v.q, v => v.q > 0, 'Melhor dia em questões', v => Math.round(v) + ' questões'),
      par(diaArr, v => v.q >= MIN_Q_DIA ? v.ac / v.q * 100 : -1,
        v => v.q >= MIN_Q_DIA, 'Melhor aproveitamento em um dia', v => v.toFixed(0) + '%')
    ].filter(Boolean);
  }
};

const EvolucaoScreen = {
  filterStart: null,
  filterEnd: null,
  activeShortcut: 'all', // '7d' | '30d' | 'all' | null (null = intervalo personalizado)
  scope: 'plan', // 'plan' = só o planejamento ativo | 'all' = todos somados
  evoLineMode: 'week', // 'week' = % por semana | 'cum' = média acumulada
  evoLineSubjects: null, // Set de disciplinas selecionadas (null = ainda não inicializado)

  // segunda-feira da semana de uma data (chave do agrupamento temporal)
  _weekKey(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const off = (d.getDay() + 6) % 7; // 0 = segunda
    d.setDate(d.getDate() - off);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  _palette: ['#4f46e5', '#e0393f', '#0f9d63', '#d97a12', '#0a95a8', '#b3308a', '#7c3aed', '#2563eb', '#059669', '#dc2626'],

  /* Tema dos gráficos — lê as variáveis CSS em tempo de render, então TODO gráfico
     SVG passa a respeitar o modo claro/escuro automaticamente. Antes as cores eram
     fixas (grade #eceef1, rótulos #9297a3, centro dos pontos #fff), o que deixava
     os gráficos ilegíveis no tema escuro. Fonte e geometria também padronizadas. */
  _ctheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => { const s = (cs.getPropertyValue(name) || '').trim(); return s || fb; };
    return {
      grid: v('--border', '#e5e7eb'),
      gridStrong: v('--border-strong', '#d1d5db'),
      label: v('--text-faint', '#9297a3'),
      axis: v('--text-soft', '#5b6270'),
      accent: v('--accent', '#4f46e5'),
      surface: v('--surface', '#ffffff'),
      text: v('--text', '#14161a'),
      fMono: "'Space Mono', ui-monospace, monospace",
      fSans: "'Inter', system-ui, sans-serif"
    };
  },
  // Largura da viewport (para decidir densidade de rótulos e tamanho de fonte).
  _vw() { try { return window.innerWidth || document.documentElement.clientWidth || 1024; } catch (_) { return 1024; } },
  /* Métricas RESPONSIVAS de gráfico. O problema no celular: o SVG tem viewBox fixo
     (ex.: 720 de largura) e é reduzido para caber na tela — uma fonte 11 vira ~5px,
     ilegível, e as datas se sobrepõem. Aqui, quando a tela é estreita, aumentamos a
     fonte (em unidades do SVG, para compensar a redução) e mostramos MENOS rótulos
     de data (1 a cada N), evitando o amontoado. Também encurtamos a data (dd/mm). */
  _chartMetrics(n) {
    const vw = this._vw();
    const narrow = vw < 640, tiny = vw < 400;
    // nº alvo de rótulos no eixo X conforme a largura
    const targetLabels = tiny ? 3 : narrow ? 4 : 8;
    const labelEvery = Math.max(1, Math.ceil(n / targetLabels));
    return {
      narrow, tiny, labelEvery,
      fLabel: narrow ? 15 : 11,   // rótulos de eixo (datas / %)
      fVal: narrow ? 15 : 12,     // valores nos pontos
      fAxisTitle: narrow ? 14 : 11,
      dot: narrow ? 4 : 3.5
    };
  },
  // Rótulo de data curto para o eixo (dd/mm). A legibilidade no celular é garantida
  // pela densidade responsiva (labelEvery) + fonte maior, não por truncar a data.
  _shortDate(iso, _narrow) { return formatDateShort(iso); },

  // Índices do eixo X que recebem rótulo. Distribui pelos múltiplos de `every`,
  // SEMPRE inclui o último ponto e — este é o bug relatado — evita DOIS rótulos
  // colados no canto direito: se o penúltimo rótulo ficaria perto demais do
  // último, ele é SUBSTITUÍDO pelo último (os dois nunca são desenhados juntos).
  _labelIndices(n, every) {
    if (!n || n < 1) return [];
    every = Math.max(1, every || 1);
    const idx = [];
    for (let i = 0; i < n; i += every) idx.push(i);
    const last = n - 1;
    if (idx.length === 0) { idx.push(last); return idx; }
    if (idx[idx.length - 1] !== last) {
      const prev = idx[idx.length - 1];
      const minGap = Math.max(1, Math.ceil(every * 0.6));   // folga mínima em nº de pontos
      if (last - prev < minGap) idx[idx.length - 1] = last;  // troca o penúltimo pelo último
      else idx.push(last);
    }
    return idx;
  },

  // soma/subtrai dias a uma data 'YYYY-MM-DD' mantendo o fuso local
  addDaysLocal(isoDate, delta) {
    const d = new Date(isoDate + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // Converte o histórico das Atividades Extras (marcadas) em "registros virtuais",
  // para que, quando habilitado, o tempo delas entre nas métricas de Evolução.
  _extraEntries() {
    if (!DB.extrasCountGlobal()) return [];
    const methodByTipo = { anki: 'Revisão Teórica', leitura: 'Leitura', questoes: 'Questões', revisao: 'Revisão Teórica', video: 'Videoaula', livre: 'Outro' };
    const out = [];
    DB.getExtras().forEach(x => {
      if (!x.contaMetricas) return;
      (x.historico || []).forEach((h, i) => {
        const min = Math.max(0, h.minutos || (x.tipo === 'video' ? h.quantidade : 0) || 0);
        const contaQuestoes = (x.tipo === 'questoes' && h.acertos != null);
        // sem minutos e sem acertos informados não há o que somar em métrica alguma
        if (min <= 0 && !contaQuestoes) return;
        const e = {
          id: 'ex_' + x.id + '_' + i, date: h.data,
          subject: x.disciplina || 'Atividades Extras',
          method: methodByTipo[x.tipo] || 'Outro',
          durationMin: min, correct: 0, total: 0, _extra: true
        };
        // Questões: só entram no aproveitamento se os ACERTOS foram informados.
        // Antes, toda questão extra virava "0 acertos" e derrubava o % de acerto geral.
        if (x.tipo === 'questoes' && h.acertos != null) {
          e.total = Math.round(h.quantidade || 0);
          e.correct = Math.round(h.acertos);
        }
        out.push(e);
      });
    });
    return out;
  },
  // Fonte unificada de sessões p/ TODOS os gráficos: base (registros) + extras (se habilitado)
  _sourceEntries() {
    const base = this.scope === 'all' ? DB.getAllEntriesTagged() : DB.getEntries();
    return base.concat(this._extraEntries());
  },
  // [MELHORIA 5] Modal com todos os níveis de uma conquista (requisitos p/ subir).
  // Monta o HTML do calendário MENSAL (um mês, com navegação ‹ ›).
  _calMensalHtml() {
    const g = ConquistasEngine.mesGrade(this._calEntries || [], this.calAno, this.calMes);
    const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const hoje = new Date();
    const noFuturo = (this.calAno > hoje.getFullYear()) || (this.calAno === hoje.getFullYear() && this.calMes >= hoje.getMonth());
    const wds = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const cells = g.celulas.map(c => {
      if (!c) return '<div class="calm-cell empty"></div>';
      const cls = c.futuro ? 'futuro' : ('p' + c.nivel);
      const tip = c.futuro ? formatDateShort(c.iso) : (c.presente
        ? `${formatDateShort(c.iso)} · ${c.min ? Math.floor(c.min / 60) + 'h' + String(c.min % 60).padStart(2, '0') : 'sem tempo'}${c.q ? ' · ' + c.q + ' questões' : ''}${c.cards ? ' · ' + c.cards + ' cards' : ''}`
        : `${formatDateShort(c.iso)} · sem registro`);
      return `<div class="calm-cell ${cls}${c.hoje ? ' hoje' : ''}" data-tip="${escapeHtml(tip)}">${c.dia}${(c.presente && c.q) ? '<span class="calm-dot"></span>' : ''}</div>`;
    }).join('');
    const totH = g.totalMin ? (Math.floor(g.totalMin / 60) + 'h' + (g.totalMin % 60 ? String(g.totalMin % 60).padStart(2, '0') : '')) : '0h';
    return `
      <div class="calm-head">
        <div class="calm-title">${MES[this.calMes]} de ${this.calAno}</div>
        <div class="calm-nav">
          <button type="button" data-cal="prev" title="Mês anterior">&#8249;</button>
          <button type="button" class="calm-today" data-cal="today">Hoje</button>
          <button type="button" data-cal="next" title="Próximo mês" ${noFuturo ? 'disabled' : ''}>&#8250;</button>
        </div>
      </div>
      <div class="calm-weekdays">${wds.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="calm-grid">${cells}</div>
      <p class="conq-presenca" style="margin-top:10px;">Neste mês: <strong>${g.presentes}</strong> ${g.presentes === 1 ? 'dia' : 'dias'} com estudo &middot; <strong>${totH}</strong> no total.</p>
      <div class="calm-legend"><span>menos</span><i class="p0"></i><i class="p1"></i><i class="p2"></i><i class="p3"></i><span>mais</span><span style="margin-left:4px;">&middot; cor pela intensidade (tempo estudado)</span></div>`;
  },
  // Navega o calendário: 'prev' | 'next' | 'today'. Repinta só o corpo.
  _navCal(dir) {
    if (dir === 'today') { const h = new Date(); this.calAno = h.getFullYear(); this.calMes = h.getMonth(); }
    else if (dir === 'next') { this.calMes++; if (this.calMes > 11) { this.calMes = 0; this.calAno++; } }
    else { this.calMes--; if (this.calMes < 0) { this.calMes = 11; this.calAno--; } }
    const body = document.getElementById('conq-cal-body');
    if (body) body.innerHTML = this._calMensalHtml();
  },
  abrirNiveisModal(idx) {
    const b = this._badgesFlat && this._badgesFlat[idx];
    if (!b) return;
    const niveis = b.niveis || [];
    let itens, sub;
    if (niveis.length) {
      const nextIdx = niveis.findIndex(n => !n.alcancado);
      itens = niveis.map((n, i) => {
        const cls = n.alcancado ? 'done' : (i === nextIdx ? 'next' : '');
        const mark = n.alcancado ? '\u2713' : (i + 1);
        return `<div class="niv-item ${cls}"><div class="niv-check">${mark}</div><div class="niv-txt"><div class="niv-rot">${escapeHtml(n.rot)}</div><div class="niv-req">${n.alcancado ? 'conquistado \u00b7 ' : 'a partir de '}${escapeHtml(n.req)}</div></div></div>`;
      }).join('');
      sub = `${b.nivelAtual || 0} de ${b.totalNiveis} n\u00edveis \u00b7 voc\u00ea j\u00e1 tem ${escapeHtml(b.valorFmt || '')}`;
    } else {
      const done = b.conquistada;
      itens = `<div class="niv-item ${done ? 'done' : 'next'}"><div class="niv-check">${done ? '\u2713' : '\u2605'}</div><div class="niv-txt"><div class="niv-rot">${done ? 'Conquistada' : 'Como conquistar'}</div><div class="niv-req">${escapeHtml(b.detalhe || '')}</div></div></div>`;
      sub = done ? 'Conquista desbloqueada.' : 'Ainda n\u00e3o conquistada.';
    }
    const ov = document.createElement('div');
    ov.className = 'niv-overlay';
    ov.innerHTML = `<div class="niv-modal">
      <div class="niv-head"><span class="ic">${b.ico}</span><h3>${escapeHtml(b.nome)}</h3></div>
      <p class="niv-sub">${sub}</p>
      <div class="niv-list">${itens}</div>
      <p class="niv-foot">Nada aqui expira \u2014 cada n\u00edvel \u00e9 um marco do que voc\u00ea j\u00e1 construiu.</p>
      <button type="button" class="niv-close">Fechar</button>
    </div>`;
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', onEsc); };
    function onEsc(ev) { if (ev.key === 'Escape') fechar(); }
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    ov.querySelector('.niv-close').addEventListener('click', fechar);
    document.addEventListener('keydown', onEsc);
    document.body.appendChild(ov);
  },
  renderConquistas() {
    const box = document.getElementById('conquistas-body');
    if (!box) return;
    const entries = DB.getAllEntriesTagged ? DB.getAllEntriesTagged() : DB.getEntries();
    const largo = window.innerWidth >= 900;
    const cal = ConquistasEngine.calendario(entries, largo ? 26 : 14);
    const marcos = ConquistasEngine.marcos(entries);
    const recs = ConquistasEngine.recordes(entries);
    const badges = ConquistasEngine.badges(entries);
    this._badgesFlat = badges; // [MELHORIA 5] acesso p/ o modal de níveis
    const ganhas = badges.filter(b => b.conquistada).length;
    const niveisGanhos = badges.reduce((a, b) => a + (b.nivelAtual || (b.conquistada ? 1 : 0)), 0);
    const niveisTotal = badges.reduce((a, b) => a + (b.totalNiveis || 1), 0);

    // mês exibido no calendário (1ª vez: mês atual) + guarda entries p/ navegação
    if (this.calAno == null || this.calMes == null) { const h = new Date(); this.calAno = h.getFullYear(); this.calMes = h.getMonth(); }
    this._calEntries = entries;

    /* Resumo de presença — números que o calendário mostra em forma de quadrado
       mas nunca soletra: sequência atual, maior sequência, total de dias e
       quanto do tempo já acumulado. Sem eles a tela dizia "você esteve aqui"
       sem dizer "quanto". Tudo derivado dos mesmos registros; nenhum dado novo. */
    const _dias = ConquistasEngine.porDia(entries);
    const _isoAtivos = Object.keys(_dias).filter(k => _dias[k].temAlgo).sort();
    const _totalMin = Object.values(_dias).reduce((a, v) => a + (v.min || 0), 0);
    const _totalQ = Object.values(_dias).reduce((a, v) => a + (v.q || 0), 0);
    const _totalAc = Object.values(_dias).reduce((a, v) => a + (v.ac || 0), 0);
    // sequência: dias consecutivos até hoje (ou até ontem, para não zerar antes do fim do dia)
    /* Data local, NUNCA toISOString(): em fuso negativo (Brasil) o ISO em UTC
       devolve o dia seguinte e a sequencia quebraria sozinha na virada. */
    const _iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const _diaAnterior = (iso) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - 1); return _iso(d); };
    const _ativo = new Set(_isoAtivos);
    let _seqAtual = 0;
    {
      let cur = todayLocal();
      if (!_ativo.has(cur)) cur = _diaAnterior(cur);   // ainda da tempo de estudar hoje
      while (_ativo.has(cur)) { _seqAtual++; cur = _diaAnterior(cur); }
    }
    let _seqMax = 0, _run = 0, _prev = null;
    _isoAtivos.forEach(iso => {
      _run = (_prev && _diaAnterior(iso) === _prev) ? _run + 1 : 1;
      if (_run > _seqMax) _seqMax = _run;
      _prev = iso;
    });
    const _mediaDia = _isoAtivos.length ? Math.round(_totalMin / _isoAtivos.length) : 0;
    const _accGeral = _totalQ > 0 ? Math.round((_totalAc / _totalQ) * 10000) / 100 : null;
    const _mini = (v, r, t) => `<div class="conq-mini" title="${escapeHtml(t)}"><div class="cm-v">${v}</div><div class="cm-r">${r}</div></div>`;
    const resumoHtml = `
      <div class="conq-resumo">
        ${_mini(_seqAtual + (_seqAtual === 1 ? ' dia' : ' dias'), 'sequência atual', 'Dias consecutivos com registro, contando até hoje')}
        ${_mini(_seqMax + (_seqMax === 1 ? ' dia' : ' dias'), 'maior sequência', 'A sua melhor sequência de dias seguidos')}
        ${_mini(String(_isoAtivos.length), 'dias com estudo', 'Total de dias diferentes com pelo menos um registro')}
        ${_mini(CycleEngine.fmtHM(_totalMin), 'tempo acumulado', 'Soma de todo o tempo registrado')}
        ${_mini(CycleEngine.fmtHM(_mediaDia), 'média por dia', 'Tempo acumulado dividido pelos dias com estudo')}
        ${_mini(_totalQ.toLocaleString('pt-BR'), 'questões resolvidas', 'Total de questões registradas')}
        ${_mini(_accGeral == null ? '—' : _accGeral.toFixed(2) + '%', 'aproveitamento geral', 'Acertos divididos por questões resolvidas, em todo o período')}
      </div>`;

    box.innerHTML = `
      <div class="card"><div style="padding:18px 22px;">
        <div class="pl-hero-top" style="margin-bottom:2px;">
          <span class="pl-hero-num tone-good">${ganhas}</span>
          <span class="pl-hero-uni">de ${badges.length} conquistas · ${niveisGanhos} de ${niveisTotal} níveis</span>
        </div>
        <p class="pl-prosa" style="margin:6px 0 0;">Nenhuma conquista aqui expira, se perde ou tem prazo. São registros do que você já fez.</p>
      </div></div>

      <div class="card"><div style="padding:18px 22px;">
        <p class="conq-titulo">📅 Calendário de presença</p>
        <div id="conq-cal-body">${this._calMensalHtml()}</div>
        <p class="conq-presenca" style="margin-top:6px;">Você estudou em <strong>${cal.em7}</strong> dos últimos 7 dias e em <strong>${cal.em30}</strong> dos últimos 30.</p>
        ${resumoHtml}
      </div></div>

      ${recs.length ? `<div class="card"><div style="padding:18px 22px;">
        <p class="conq-titulo">🏆 Seus recordes</p>
        <div class="conq-recs">
        ${recs.map(r => `<div class="conq-rec">
          <span class="rot">${r.rot}${r.novo ? ' <span class="conq-novo">novo!</span>' : ''}</span>
          <span class="conq-rec-vals">
            <span class="val">${r.fmt(r.hist.valor)}</span><span class="qd"> · ${formatDateShort(r.hist.data)}</span>
            ${r.mostraRec ? `<span class="qd" style="display:block;">melhor dos últimos 90 dias: ${r.fmt(r.rec.valor)}</span>` : ''}
          </span>
        </div>`).join('')}
        </div>
        <p class="pl-prosa" style="margin-top:10px;color:var(--text-faint);">Comparação só com você mesmo. Recorde é história, não meta.</p>
      </div></div>` : ''}

      ${marcos.length ? `<div class="card"><div style="padding:18px 22px;">
        <p class="conq-titulo">🎯 Marcos acumulados</p>
        <div class="conq-marcos">
          ${marcos.map(m => `<div class="conq-marco">
            <div class="v">${m.valor.toLocaleString('pt-BR')}${m.unidade}</div>
            <div class="r">${m.rot}</div>
            ${m.atual ? `<div class="m">✓ marco de ${m.atual.toLocaleString('pt-BR')}${m.unidade} alcançado</div>` : ''}
            ${m.mostrarProx ? `<div class="p">próximo: ${m.prox.toLocaleString('pt-BR')}${m.unidade} — faltam ${m.falta.toLocaleString('pt-BR')}</div>` : ''}
          </div>`).join('')}
        </div>
      </div></div>` : ''}

      ${ConquistasEngine.CATEGORIAS.map(c => {
        const grupo = badges.filter(b => b.cat === c.id);
        if (!grupo.length) return '';
        const g = grupo.filter(b => b.conquistada).length;
        return `<div class="card"><div style="padding:18px 22px;">
          <p class="conq-titulo" style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
            <span>${c.ico} ${c.nome}</span>
            <span style="font-weight:500;text-transform:none;letter-spacing:0;">· ${c.desc}</span>
            <span style="margin-left:auto;font-weight:800;color:var(--good-text);">${g}/${grupo.length}</span>
          </p>
          <div class="badge-grid">
            ${grupo.map(b => `
              <div class="badge ${b.conquistada ? 'on' : 'off'}" data-badge-idx="${badges.indexOf(b)}" title="Ver todos os níveis">
                <span class="bi">${b.ico}</span>
                <div class="bn">${escapeHtml(b.nome)}</div>
                ${b.nivel ? `<div class="bl">✓ ${escapeHtml(b.nivel)}</div>` : `<div class="bl">ainda não</div>`}
                <div class="bd">${escapeHtml(b.detalhe || '')}</div>
                ${(b.prox && b.progresso < 1) ? `<div class="bp"><i style="width:${Math.round(b.progresso * 100)}%"></i></div>
                  <div class="bd" style="margin-top:4px;">próximo: ${escapeHtml(b.prox.rot)} — faltam ${escapeHtml(b.prox.falta)}</div>` : ''}
                ${b.totalNiveis ? `<div class="bd" style="margin-top:4px;opacity:0.75;">nível ${b.nivelAtual} de ${b.totalNiveis}</div>` : ''}
                <div class="bmore">${b.totalNiveis ? 'ver níveis ›' : 'ver detalhe ›'}</div>
              </div>`).join('')}
          </div>
        </div></div>`;
      }).join('')}

      `;
  },
  render() {
    const allEntries = this._sourceEntries();
    const emptyEl = document.getElementById('evolucao-empty');
    const contentEl = document.getElementById('evolucao-content');

    // mantém os campos de data e os atalhos sempre em sincronia com o estado atual
    this.syncControls();

    if (allEntries.length === 0) {
      $id('evolucao-empty-text').textContent = 'Registre alguns estudos para ver sua evolução aqui.';
      emptyEl.style.display = 'block';
      contentEl.style.display = 'none';
      return;
    }

    // aplica filtro de período (comparação lexicográfica de datas 'YYYY-MM-DD' é segura)
    let entries = allEntries;
    if (this.filterStart) entries = entries.filter(e => e.date >= this.filterStart);
    if (this.filterEnd) entries = entries.filter(e => e.date <= this.filterEnd);

    this.updatePeriodLabel(allEntries, entries.length);

    if (entries.length === 0) {
      $id('evolucao-empty-text').textContent = 'Nenhum registro no período selecionado. Tente ampliar o intervalo de datas.';
      emptyEl.style.display = 'block';
      contentEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    contentEl.style.display = 'block';

    this.renderStats(entries);
    this.renderDayChart(entries);
    this.renderLineChart(entries);
    this.renderAcertoLinha(entries);
    this.renderAcertoMateria(entries);
    this.renderBarChart(entries);
    this.renderPerformanceList(entries);
    this.renderMetaChart();
    this.renderTecChart();
    this.renderModalityTable(entries);
    this.renderRitmo(entries);
  },

  // ------- Ritmo de estudo (avanço, tempo por modalidade e médias reais) -------
  // Classifica o método de uma sessão num balde: 'questoes' | 'revisao' | 'video' | 'pdf'
  bucketOf(method) {
    const m = (method || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/quest/.test(m)) return 'questoes';
    if (/revis/.test(m)) return 'revisao';
    if (/video|aula/.test(m)) return 'video';
    return 'pdf'; // Leitura, PDF, Resumo, Mapa mental, Outro → estudo novo por leitura
  },
  renderRitmo(entries) {
    const container = document.getElementById('evolucao-ritmo');
    // avanço: páginas lidas (soma de pageEnd-pageStart+1 quando houver)
    let totalPaginas = 0, horasComPaginas = 0;
    let totalVideoMin = 0, clockMinComVideo = 0; // conteúdo assistido (min) e tempo real gasto nele
    const horas = { pdf: 0, video: 0, revisao: 0, questoes: 0 };
    entries.forEach(e => {
      const min = e.durationMin || 0;
      const b = this.bucketOf(e.method);
      horas[b] += min;
      // Ritmo de LEITURA: conta páginas e tempo APENAS de sessões de leitura/PDF.
      // (Antes contava páginas de qualquer sessão — inclusive Questões/Vídeo —,
      //  inflando o divisor e derrubando o "páginas por hora".)
      if (b === 'pdf' && e.pageStart != null && e.pageEnd != null && e.pageEnd >= e.pageStart) {
        totalPaginas += (e.pageEnd - e.pageStart + 1);
        horasComPaginas += min;
      }
      // Ritmo de VÍDEO: conta apenas sessões de vídeo/aula (mesma lógica de escopo).
      if (b === 'video' && e.videoStart != null && e.videoEnd != null && e.videoEnd >= e.videoStart) {
        totalVideoMin += (e.videoEnd - e.videoStart);
        clockMinComVideo += min;
      }
    });
    const totalMin = horas.pdf + horas.video + horas.revisao + horas.questoes;
    if (totalMin === 0) {
      container.innerHTML = `<div class="evo-empty-mini">Registre sessões de estudo (com tempo e, quando ler, as páginas) para ver seu ritmo real.</div>`;
      return;
    }
    const novoMin = horas.pdf + horas.video;
    const pct = (v) => totalMin > 0 ? Math.round((v / totalMin) * 10000) / 100 : 0;
    // médias reais (o coração da tabela)
    const pagPorHora = horasComPaginas > 0 ? Math.round((totalPaginas / (horasComPaginas / 60)) * 10) / 10 : null;
    // min de vídeo por hora e velocidade média efetiva, a partir dos minutos inicial/final registrados
    const minVideoPorHora = clockMinComVideo > 0 ? Math.round(totalVideoMin / (clockMinComVideo / 60)) : null;
    const velocidadeVideo = clockMinComVideo > 0 ? Math.round((totalVideoMin / clockMinComVideo) * 100) / 100 : null;

    const fmt = (min) => CycleEngine.fmtHM(Math.round(min));
    container.innerHTML = `
      <table class="ritmo-table">
        <tbody>
          <tr class="ritmo-section"><td colspan="2">Avanço na matéria</td></tr>
          <tr><td class="rk">Total de páginas lidas</td><td class="rv">${totalPaginas.toLocaleString('pt-BR')}</td></tr>
          <tr><td class="rk">Total de minutos de videoaula <span class="rk-hint">(conteúdo assistido)</span></td>${totalVideoMin > 0 ? `<td class="rv">${(Math.round(totalVideoMin * 10) / 10).toLocaleString('pt-BR')}</td>` : `<td class="rv rv-muted" title="Registre o minuto inicial e final do vídeo ao registrar uma sessão de vídeo/aula">—</td>`}</tr>

          <tr class="ritmo-section"><td colspan="2">Tempo estudado</td></tr>
          <tr><td class="rk">Leitura / PDF</td><td class="rv">${fmt(horas.pdf)}</td></tr>
          <tr><td class="rk">Videoaula</td><td class="rv">${fmt(horas.video)}</td></tr>
          <tr><td class="rk">Revisão</td><td class="rv">${fmt(horas.revisao)}</td></tr>
          <tr><td class="rk">Questões</td><td class="rv">${fmt(horas.questoes)}</td></tr>
          <tr class="ritmo-total"><td class="rk">Tempo total estudado</td><td class="rv">${fmt(totalMin)}</td></tr>

          <tr class="ritmo-section"><td colspan="2">Distribuição do tempo</td></tr>
          <tr><td class="rk">% Estudo novo <span class="rk-hint">(leitura + vídeo)</span></td><td class="rv">${formatPct(pct(novoMin))}%</td></tr>
          <tr><td class="rk">% Revisão</td><td class="rv">${formatPct(pct(horas.revisao))}%</td></tr>
          <tr><td class="rk">% Questões</td><td class="rv">${formatPct(pct(horas.questoes))}%</td></tr>
        </tbody>
      </table>

      <div class="ritmo-highlight">
        <div class="ritmo-highlight-title">⚡ Seu ritmo real <span class="rk-hint">— use como parâmetro na Estimativa de Tempo</span></div>
        <div class="ritmo-metric-grid">
          <div class="ritmo-metric">
            <div class="rm-val">${pagPorHora !== null ? pagPorHora.toLocaleString('pt-BR') : '—'}</div>
            <div class="rm-lbl">páginas por hora (leitura/PDF)</div>
            <div class="rm-sub">${totalPaginas.toLocaleString('pt-BR')} págs em ${fmt(horasComPaginas)}</div>
          </div>
          <div class="ritmo-metric">
            <div class="rm-val ${minVideoPorHora === null ? 'rm-muted' : ''}">${minVideoPorHora !== null ? minVideoPorHora.toLocaleString('pt-BR') : '—'}</div>
            <div class="rm-lbl">minutos de vídeo por hora</div>
            <div class="rm-sub">${minVideoPorHora !== null ? `${(Math.round(totalVideoMin * 10) / 10).toLocaleString('pt-BR')} min em ${fmt(clockMinComVideo)}` : 'registre min. inicial e final do vídeo'}</div>
          </div>
          <div class="ritmo-metric">
            <div class="rm-val ${velocidadeVideo === null ? 'rm-muted' : ''}">${velocidadeVideo !== null ? velocidadeVideo.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + 'x' : '—'}</div>
            <div class="rm-lbl">velocidade média efetiva</div>
            <div class="rm-sub">${velocidadeVideo !== null ? 'conteúdo assistido ÷ tempo real' : 'requer min. de vídeo'}</div>
          </div>
        </div>
        <button type="button" class="btn-primary" id="ritmo-use-btn" ${(pagPorHora === null && minVideoPorHora === null) ? 'disabled' : ''} style="margin-top:16px;">
          Usar na Estimativa de Tempo →
        </button>
      </div>
    `;
    const btn = document.getElementById('ritmo-use-btn');
    if (btn && (pagPorHora !== null || minVideoPorHora !== null)) {
      btn.addEventListener('click', () => this.sendRitmoToEstimativa(pagPorHora, minVideoPorHora));
    }
  },
  // Envia o ritmo medido para os campos da ferramenta Estimativa de Tempo
  sendRitmoToEstimativa(pagPorHora, minVideoPorHora) {
    if (window.FerramentasScreen) FerramentasScreen.load();
    const pph = document.getElementById('est-pph');
    if (pph && pagPorHora !== null) pph.value = pagPorHora;
    const mph = document.getElementById('est-mph');
    if (mph && minVideoPorHora !== null && minVideoPorHora !== undefined) mph.value = minVideoPorHora;
    if (window.FerramentasScreen) {
      FerramentasScreen.persistEstimativaInputs();
      FerramentasScreen.calcEstimativa();
    }
    showToast('Ritmo enviado para a Estimativa de Tempo ✓');
    switchScreen('ferramentas');
    // garante que a aba "Estimativa" esteja ativa
    document.querySelectorAll('.tool-tab').forEach(t => t.classList.toggle('active', t.dataset.tool === 'estimativa'));
    document.querySelectorAll('.tool-panel').forEach(p => p.classList.toggle('active', p.id === 'tool-estimativa'));
  },

  // ------- Tempo de estudo por dia (barras, com atalho de período OU intervalo de datas) -------
  tempoDias: 7,
  tempoStart: null, tempoEnd: null, // [MELHORIA] intervalo de datas personalizado (tem prioridade sobre os atalhos)
  renderDayChart(entries) {
    const container = document.getElementById('evolucao-day-chart');
    const hoje = todayLocal();
    // Se o usuário escolheu um intervalo de datas, ele manda; senão usa o atalho (N dias).
    const usaRange = !!(this.tempoStart && this.tempoEnd);
    let start, end, nDias;
    if (usaRange) {
      start = this.tempoStart; end = this.tempoEnd;
      if (start > end) { const t = start; start = end; end = t; }
      if (end > hoje) end = hoje;
      nDias = Math.max(1, Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000) + 1);
    } else {
      end = hoje; start = this.addDaysLocal(hoje, -(this.tempoDias - 1)); nDias = this.tempoDias;
    }
    // reflete o estado nos controles
    const chipGroup = document.getElementById('evo-tempo-periodo');
    if (chipGroup) chipGroup.classList.toggle('range-active', usaRange);
    const clearBtn = document.getElementById('evo-tempo-clear');
    if (clearBtn) clearBtn.style.display = usaRange ? '' : 'none';
    const deEl = document.getElementById('evo-tempo-de'); if (deEl) { deEl.value = usaRange ? start : ''; deEl.max = hoje; }
    const ateEl = document.getElementById('evo-tempo-ate'); if (ateEl) { ateEl.value = usaRange ? end : ''; ateEl.max = hoje; }
    // agrega minutos por dia dentro da janela (independe do filtro de data principal)
    const src = this._sourceEntries();
    const byDate = {};
    src.forEach(e => { if (e.date >= start && e.date <= end) byDate[e.date] = (byDate[e.date] || 0) + (e.durationMin || 0); });
    // monta a sequência completa de dias
    const days = [];
    for (let i = 0; i < nDias; i++) days.push(this.addDaysLocal(start, i));
    const maxMin = Math.max(1, ...days.map(d => byDate[d] || 0));
    const totalMin = days.reduce((a, d) => a + (byDate[d] || 0), 0);
    if (totalMin === 0) {
      container.innerHTML = `<div class="evo-empty-mini">Nenhum tempo registrado ${usaRange ? 'no intervalo de ' + formatDateShort(start) + ' a ' + formatDateShort(end) : 'nos últimos ' + nDias + ' dias'}.</div>`;
      return;
    }
    // com muitos dias, mostra rótulo a cada N (menos rótulos no celular)
    const labelEvery = Math.max(1, Math.ceil(days.length / (this._vw() < 640 ? 6 : 12)));
    const bars = days.map(d => {
      const min = byDate[d] || 0;
      const h = Math.round((min / maxMin) * 100);
      const title = `${formatDateShort(d)}: ${CycleEngine.fmtHM(min)}`;
      return `<div class="evo-day-bar ${min === 0 ? 'empty' : ''}" style="height:${Math.max(2, h)}%;" title="${title}"></div>`;
    }).join('');
    const axis = days.map((d, i) => `<span>${(i % labelEvery === 0 || i === days.length - 1) ? formatDateShort(d) : ''}</span>`).join('');
    container.innerHTML = `
      <div class="evo-day-bar-row">${bars}</div>
      <div class="evo-day-axis">${axis}</div>
      <p class="hint" style="text-align:center; margin-top:10px;">${CycleEngine.fmtHM(totalMin)} em ${nDias} dias · média de ${CycleEngine.fmtHM(Math.round(totalMin / nDias))}/dia</p>
    `;
  },

  // ------- % de acertos por matéria com linha de referência 70% -------
  renderAcertoMateria(entries) {
    const container = document.getElementById('evolucao-acerto-materia');
    const bySubject = {};
    entries.filter(e => e.total > 0).forEach(e => {
      if (!bySubject[e.subject]) bySubject[e.subject] = { correct: 0, total: 0 };
      bySubject[e.subject].correct += e.correct;
      bySubject[e.subject].total += e.total;
    });
    const rows = Object.entries(bySubject)
      .map(([name, v]) => ({ name, pct: calcPct(v.correct, v.total), correct: v.correct, total: v.total }))
      .sort((a, b) => b.pct - a.pct);
    if (rows.length === 0) {
      container.innerHTML = `<div class="evo-empty-mini">Nenhum dado de questões ainda. Registre acertos e total resolvido para ver este gráfico.</div>`;
      return;
    }
    const REFS = metaRefs();
    // Eixo com BASE dinâmica ancorada no MENOR percentual de disciplina (pedido do usuário),
    // arredondado para baixo ao múltiplo de 5 imediatamente abaixo dele. Assim as barras se
    // espalham e as metas ganham espaço. Nunca corta uma meta: garante base <= menor meta.
    const minPct = Math.min(...rows.map(r => r.pct));
    const minRef = REFS.length ? Math.min(...REFS.map(r => r.v)) : 100;
    let base = Math.floor((minPct - 3) / 5) * 5;          // múltiplo de 5 logo abaixo do menor
    base = Math.min(base, Math.floor(minRef / 5) * 5 - 5); // e sempre abaixo da menor meta (não a esconde)
    base = Math.max(0, Math.min(base, 60));                // limites de segurança
    const span = Math.max(1, 100 - base);
    const mp = (v) => Math.max(0, Math.min(100, (v - base) / span * 100)); // v -> posição 0..100 no eixo
    // Régua no topo: um rótulo por meta, alinhado à coluna da barra, sempre legível.
    const ruler = `
      <div class="acm-ruler">
        <div class="acm-ruler-head">metas</div>
        <div class="acm-ruler-track">
          ${REFS.map(r => `<span class="acm-ruler-lbl" style="left:${mp(r.v).toFixed(2)}%; background:${r.color}; border-top-color:${r.color};">${r.v}%</span>`).join('')}
        </div>
        <div></div>
      </div>`;
    // linhas de referência (metas) desenhadas sobre cada barra, na mesma posição da régua
    const refLines = REFS.map(r =>
      `<div class="acm-ref" style="left:${mp(r.v).toFixed(2)}%; background:${r.color};"></div>`
    ).join('');
    const bars = rows.map(r => {
      const tone = toneFor(r.pct);
      return `
        <div class="acm-row" title="${r.correct}/${r.total} questões">
          <div class="acm-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</div>
          <div class="acm-track">
            <div class="acm-fill" style="width:${mp(r.pct).toFixed(2)}%; background:var(--${tone});"></div>
            ${refLines}
          </div>
          <div class="acm-val" style="color:var(--${tone}-text);">${formatPct(r.pct)}%<span class="acm-q">${r.correct}/${r.total}</span></div>
        </div>`;
    }).join('');
    const legend = `<div class="evo-legend" style="padding:16px 0 0;">
      <span class="evo-legend-item" style="color:var(--text-faint)">escala do eixo: ${base}%–100%</span>
      ${REFS.map(r => `<span class="evo-legend-item"><span class="evo-legend-swatch" style="background:${r.color}; width:14px; height:0; border-top:2px dashed ${r.color};"></span>meta ${r.v}%</span>`).join('')}
    </div>`;
    container.innerHTML = `<div class="acm-chart">${ruler}${bars}</div>${legend}`;
  },

  // ------- Evolução do aproveitamento no tempo (média geral + por disciplina) -------
  renderAcertoLinha(entries) {
    const container = document.getElementById('evolucao-acerto-linha');
    const filterBox = document.getElementById('evo-line-subject-filter');
    const q = entries.filter(e => e.total > 0);
    if (q.length === 0) {
      filterBox.innerHTML = '';
      container.innerHTML = `<div class="evo-empty-mini">Registre questões (acertos e total) para acompanhar a evolução do aproveitamento.</div>`;
      return;
    }
    // atualiza destaque do modo
    ['week', 'cum'].forEach(m => {
      const b = document.getElementById(m === 'week' ? 'evo-line-mode-week' : 'evo-line-mode-cum');
      if (b) b.classList.toggle('active', this.evoLineMode === m);
    });

    // disciplinas com questões, ordenadas por volume
    const vol = {};
    q.forEach(e => { vol[e.subject] = (vol[e.subject] || 0) + e.total; });
    const discNames = Object.keys(vol).sort((a, b) => vol[b] - vol[a]);

    // inicializa a seleção (por padrão: só a média geral)
    if (this.evoLineSubjects === null) this.evoLineSubjects = new Set();
    // remove da seleção o que não existe mais
    [...this.evoLineSubjects].forEach(s => { if (!discNames.includes(s)) this.evoLineSubjects.delete(s); });

    // [MELHORIA 3] Filtro RECOLHÍVEL: botão discreto abre um painel com caixas de seleção,
    // em vez de deixar a pilha de disciplinas sempre visível poluindo a tela.
    const nSel = this.evoLineSubjects.size;
    if (this._evoSfOpen === undefined) this._evoSfOpen = false;
    const painel = this._evoSfOpen ? `
      <div class="evo-sf-panel">
        ${discNames.map((n, i) => {
          const color = this._palette[(i + 1) % this._palette.length];
          const on = this.evoLineSubjects.has(n);
          return `<label class="evo-sf-check"><input type="checkbox" data-subject="${escapeHtml(n)}" ${on ? 'checked' : ''}><span class="evo-sf-dot" style="background:${color}"></span><span>${escapeHtml(n)}</span><span class="evo-sf-vol">${vol[n]} q</span></label>`;
        }).join('')}
        <div class="evo-sf-actions">
          <button type="button" data-sf-action="none">Limpar seleção</button>
          <button type="button" data-sf-action="close">Fechar</button>
        </div>
      </div>` : '';
    filterBox.innerHTML =
      `<button type="button" class="evo-sf-toggle${this._evoSfOpen ? ' open' : ''}" id="evo-sf-toggle-btn">&#127899;&#65039; Comparar disciplinas${nSel ? `<span class="evo-sf-count">${nSel}</span>` : ''}<span class="chev">&#9662;</span></button>` +
      painel;
    const tb = document.getElementById('evo-sf-toggle-btn');
    if (tb) tb.addEventListener('click', () => { this._evoSfOpen = !this._evoSfOpen; this.renderAcertoLinha(entries); });
    filterBox.querySelectorAll('.evo-sf-check input[data-subject]').forEach(chk => {
      chk.addEventListener('change', () => {
        const s = chk.dataset.subject;
        if (chk.checked) this.evoLineSubjects.add(s); else this.evoLineSubjects.delete(s);
        this.renderAcertoLinha(entries);
      });
    });
    filterBox.querySelectorAll('[data-sf-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.getAttribute('data-sf-action');
        if (a === 'none') this.evoLineSubjects.clear();
        if (a === 'close') this._evoSfOpen = false;
        this.renderAcertoLinha(entries);
      });
    });

    // agrupa por semana
    const weeks = [...new Set(q.map(e => this._weekKey(e.date)))].sort();
    if (weeks.length < 2) {
      container.innerHTML = `<div class="evo-empty-mini">Registre questões em pelo menos 2 semanas diferentes para ver a linha de evolução.</div>`;
      return;
    }
    // função que gera os pontos de uma série (filtro opcional por disciplina)
    const seriesFor = (subject) => {
      let cumC = 0, cumT = 0;
      return weeks.map((wk, i) => {
        const inWeek = q.filter(e => this._weekKey(e.date) === wk && (!subject || e.subject === subject));
        const c = inWeek.reduce((a, e) => a + e.correct, 0);
        const t = inWeek.reduce((a, e) => a + e.total, 0);
        cumC += c; cumT += t;
        let pct;
        /* 2 CASAS DECIMAIS DE VERDADE.
           Antes: Math.round(x * 1000) / 10 → arredondava para UMA casa, e o
           rótulo imprimia com duas ("71.30"). Semanas de 71,34%, 71,27% e
           71,25% viravam três "71.30%" idênticos e pareciam um gráfico
           travado. O dado sempre esteve certo; a resolução é que era menor
           que a diferença entre as semanas. */
        if (this.evoLineMode === 'cum') pct = cumT > 0 ? Math.round((cumC / cumT) * 10000) / 100 : null;
        else pct = t > 0 ? Math.round((c / t) * 10000) / 100 : null;
        return { x: i, pct, label: formatDateShort(wk) };
      });
    };

    // série geral + selecionadas
    const series = [{ color: this._palette[0], name: 'Média geral', points: seriesFor(null).filter(p => p.pct !== null || this.evoLineMode === 'cum') }];
    discNames.forEach((n, i) => {
      if (!this.evoLineSubjects.has(n)) return;
      series.push({ color: this._palette[(i + 1) % this._palette.length], name: n, points: seriesFor(n) });
    });

    container.innerHTML = this.multiLineSVG(weeks, series, { yTitle: '% de acerto', xTitle: this.evoLineMode === 'cum' ? 'Semana (média acumulada)' : 'Semana' });
  },

  // Gráfico de linha MULTI-SÉRIE (0-100%) com grade, metas e legenda. Lida com pontos nulos (lacunas).
  multiLineSVG(weeks, series, opts = {}) {
    // padR maior para caber a "régua de metas" (pílulas 70/80/85) à direita — mesmo
    // padrão visual do gráfico "% de acertos por matéria", para leitura consistente.
    const T = this._ctheme();
    const M = this._chartMetrics(weeks.length);
    const w = 720, h = 280, padL = M.narrow ? 44 : 48, padR = 44, padT = 22, padB = M.narrow ? 50 : 44;
    const n = weeks.length;
    const xAt = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
    const yAt = (pct) => padT + (1 - pct / 100) * (h - padT - padB);
    let grid = '';
    // no celular, menos linhas de grade (0/50/100) para não competir com os rótulos
    (M.narrow ? [0, 50, 100] : [0, 25, 50, 75, 100]).forEach(g => {
      const y = yAt(g);
      grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${T.grid}" stroke-width="1" stroke-dasharray="${g === 0 ? '0' : '3 3'}"/>`;
      grid += `<text x="${padL - 8}" y="${y + 3.5}" font-size="${M.fLabel}" fill="${T.label}" text-anchor="end" font-family="${T.fMono}">${g}%</text>`;
    });
    // metas 70/80/85 — linha tracejada + RÉGUA: pílula colorida com o valor na direita
    metaRefs().map(r => ({ v: r.v, c: r.color })).forEach(r => {
      const y = yAt(r.v);
      const pw = M.narrow ? 36 : 30, ph = M.narrow ? 20 : 16;
      grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${r.c}" stroke-width="1.3" stroke-dasharray="6 4" opacity="0.85"/>`;
      grid += `<rect x="${w - padR + 2}" y="${y - ph / 2}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="${r.c}"/>`;
      grid += `<text x="${w - padR + 2 + pw / 2}" y="${y + 4}" font-size="${M.narrow ? 13 : 10.5}" fill="#fff" text-anchor="middle" font-weight="700" font-family="${T.fMono}">${r.v}%</text>`;
    });
    // rótulos X compactos estilo "S1, S2, S3…" (semanas) — curtos e legíveis, como no
    // gráfico de referência (M1/M2/M3). A data completa fica no tooltip do ponto.
    let xlabels = '';
    const _wkLabSet = new Set(this._labelIndices(n, M.labelEvery));
    weeks.forEach((wk, i) => {
      if (_wkLabSet.has(i)) { const _a = (i === n - 1) ? 'end' : (i === 0 ? 'start' : 'middle'); xlabels += `<text x="${xAt(i)}" y="${h - padB + (M.narrow ? 22 : 18)}" font-size="${M.fLabel}" fill="${T.label}" text-anchor="${_a}" font-weight="700" font-family="${T.fMono}">S${i + 1}</text>`; }
    });
    const yTitle = M.narrow ? '' : `<text x="14" y="${padT + (h - padT - padB) / 2}" font-size="11" fill="${T.axis}" text-anchor="middle" font-weight="700" transform="rotate(-90 14 ${padT + (h - padT - padB) / 2})" font-family="${T.fSans}">${opts.yTitle || '%'}</text>`;
    // desenha cada série (segmentando em lacunas de pct nulo)
    let paths = '', valLabels = '';
    series.forEach((s, si) => {
      const isGeral = si === 0;
      let seg = [];
      const flush = () => {
        if (seg.length === 0) return;
        const d = seg.map((p, k) => `${k === 0 ? 'M' : 'L'} ${xAt(p.x)} ${yAt(p.pct)}`).join(' ');
        paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${isGeral ? 3 : 2}" stroke-linecap="round" stroke-linejoin="round" ${isGeral ? '' : 'opacity="0.9"'}/>`;
        paths += seg.map(p => `<circle cx="${xAt(p.x)}" cy="${yAt(p.pct)}" r="${M.narrow ? (isGeral ? 4.5 : 4) : (isGeral ? 3.5 : 3)}" fill="${T.surface}" stroke="${s.color}" stroke-width="2"><title>${escapeHtml(s.name)} · ${p.label}: ${formatPct(p.pct)}%</title></circle>`).join('');
        seg = [];
      };
      s.points.forEach(p => { if (p.pct === null) flush(); else seg.push(p); });
      flush();
      // RÓTULOS DE VALOR na série geral (a principal), para ver o progresso de relance.
      // No celular, afina para 1 a cada labelEvery e sempre no último ponto.
      if (isGeral) {
        s.points.forEach((p, i) => {
          if (p.pct === null) return;
          const mostra = !M.narrow || (i % M.labelEvery === 0) || (i === s.points.length - 1);
          if (!mostra) return;
          const cx = xAt(p.x), cy = yAt(p.pct);
          const acima = cy > padT + 24;
          const ly = acima ? cy - 10 : cy + 18;
          const anchor = (i === 0) ? 'start' : (i === s.points.length - 1) ? 'end' : 'middle';
          const dx = (i === 0) ? 4 : (i === s.points.length - 1) ? -4 : 0;
          valLabels += `<text x="${cx + dx}" y="${ly}" font-size="${M.fVal}" fill="${s.color}" text-anchor="${anchor}" font-weight="800" font-family="${T.fMono}">${formatPct(p.pct)}%</text>`;
        });
      }
    });
    paths += valLabels;
    // legenda: séries + uma entrada por meta (cor batendo com a régua) + dica S = semana
    const legend = `<div class="evo-legend" style="padding:12px 20px 0;">` +
      series.map(s => `<span class="evo-legend-item"><span class="evo-legend-swatch" style="background:${s.color}; height:3px;"></span>${escapeHtml(s.name)}</span>`).join('') +
      metaRefs().map(r => `<span class="evo-legend-item"><span class="evo-legend-swatch" style="background:${r.color}; height:0; border-top:2px dashed ${r.color};"></span>meta ${r.v}%</span>`).join('') +
      `<span class="evo-legend-item" style="color:var(--text-faint)">S1, S2… = semanas (data no ponto)</span>` +
      `</div>`;
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; overflow:visible;" preserveAspectRatio="xMidYMid meet">${grid}${yTitle}${paths}${xlabels}</svg>${legend}`;
  },

  // ------- Aproveitamento por semana fechada (histórico de ciclos) -------
  renderMetaChart() {
    const container = document.getElementById('evolucao-meta-chart');
    const hist = (this.scope === 'all' ? DB.getAllCycleHistoryTagged() : DB.getCycleHistory())
      .filter(w => w.avgPerformancePct !== null && w.avgPerformancePct !== undefined)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (hist.length === 0) {
      container.innerHTML = `<div class="evo-empty-mini">Feche semanas com questões registradas para acompanhar o aproveitamento por semana.</div>`;
      return;
    }
    const points = hist.map((w, i) => ({ x: i, pct: w.avgPerformancePct, label: formatDateShort(w.endDate) }));
    const legenda = `<div class="evo-legend" style="padding:12px 0 0;">
      <span class="evo-legend-item"><span class="evo-legend-swatch" style="background:var(--accent); height:3px;"></span>% de acerto da semana (acertos ÷ questões)</span>
      ${metaRefs().map(r => `<span class="evo-legend-item"><span class="evo-legend-swatch" style="background:${r.color}; height:0; border-top:2px dashed ${r.color};"></span>meta ${r.v}%</span>`).join('')}
    </div>`;
    container.innerHTML = this.percentLineSVG(points, [{ color: this._ctheme().accent, points }],
      { yTitle: '% de acerto', xTitle: 'Semana (data de fechamento)' }) + legenda;
  },

  // ------- Evolução no TecConcursos (retratos importados) -------
  renderTecChart() {
    const card = document.getElementById('evolucao-tec-card');
    const snaps = DB.getTecSnapshots();
    const container = document.getElementById('evolucao-tec-chart');
    const legend = document.getElementById('evolucao-tec-legend');
    const sel = document.getElementById('evo-tec-disc');
    if (snaps.length === 0) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    // popular seletor de disciplina (mantém seleção)
    const discNames = [...new Set(snaps.flatMap(s => TecEngine.disciplinas(s).map(d => d.nome)))].sort();
    const cur = sel.value || '__geral__';
    sel.innerHTML = `<option value="__geral__">Geral (todas as disciplinas)</option>` +
      discNames.map(n => `<option value="${escapeHtml(n)}" ${n === cur ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('');
    if (snaps.length < 2) {
      container.innerHTML = `<div class="evo-empty-mini">Importe pelo menos 2 retratos do TecConcursos (em datas diferentes) para ver a evolução.</div>`;
      legend.innerHTML = '';
      return;
    }
    // [MELHORIA 4] recorte de período — evita o eixo espremido com muitos retratos
    const per = this.tecEvoDias || 'all';
    let usados = snaps;
    if (per !== 'all') {
      const lastIso = snaps[snaps.length - 1].date;
      const cut = new Date(lastIso + 'T00:00:00'); cut.setDate(cut.getDate() - per);
      const cutIso = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')}`;
      const f = snaps.filter(s => s.date >= cutIso);
      usados = f.length >= 2 ? f : snaps.slice(-2);
    }
    document.querySelectorAll('#evo-tec-periodo .evo-chip').forEach(bt => bt.classList.toggle('active', String(bt.dataset.tecdays) === String(per)));
    const showDisc = sel.value && sel.value !== '__geral__' ? sel.value : null;
    const points = usados.map((s, i) => {
      let pct;
      if (showDisc) {
        const d = TecEngine.disciplinas(s).find(x => x.nome === showDisc);
        pct = d ? d.pct : null;
      } else {
        pct = TecEngine.totais(s).pct;
      }
      return { x: i, pct, label: formatDateShort(s.date) };
    }).filter(p => p.pct !== null);
    container.innerHTML = this.percentLineSVG(points, [{ color: this._ctheme().accent, points }],
      { yTitle: '% de acerto', xTitle: 'Data do retrato importado' });
    legend.innerHTML = `<span class="evo-legend-item"><span class="evo-legend-swatch" style="background:var(--accent); height:3px;"></span>${showDisc ? escapeHtml(showDisc) : 'Aproveitamento geral'}</span>`
      + metaRefs().map(r => `<span class="evo-legend-item"><span class="evo-legend-swatch" style="background:${r.color}; height:0; border-top:2px dashed ${r.color};"></span>meta ${r.v}%</span>`).join('');
  },

  // Desenha um gráfico de linha de PERCENTUAL (0-100) com grade e rótulos
  percentLineSVG(allPoints, series, opts = {}) {
    const yTitle = opts.yTitle || '% de acerto';
    const xTitle = opts.xTitle || '';
    if (allPoints.length === 1) {
      const p = allPoints[0];
      return `<div class="evo-empty-mini">Só há um ponto (${p.label}): ${formatPct(p.pct)}%. Adicione mais dados para ver a linha.</div>`;
    }
    const T = this._ctheme();
    const M = this._chartMetrics(allPoints.length);
    const w = 720, h = 280, padL = M.narrow ? 52 : 60, padR = 30, padT = 28, padB = M.narrow ? 58 : 52;
    const n = allPoints.length;
    const refs = metaRefs();
    // EIXO Y com base dinâmica (não mais fixo em 0–100): começa num múltiplo de 10
    // logo abaixo do menor valor/meta e vai a um teto pouco acima do maior. Assim os
    // pontos deixam de ficar amontoados numa faixa estreita e os rótulos param de colidir.
    const vals = [].concat(...series.map(s => s.points.map(p => p.pct))).filter(v => v != null);
    const refVals = refs.map(r => r.v);
    const lo = Math.min(...vals, ...refVals), hi = Math.max(...vals, ...refVals);
    let yMin = Math.max(0, Math.floor((lo - 5) / 10) * 10);
    let yMax = Math.min(100, Math.ceil((hi + 5) / 10) * 10);
    if (yMax - yMin < 20) { yMin = Math.max(0, yMin - 10); yMax = Math.min(100, yMax + 10); }
    const ySpan = Math.max(1, yMax - yMin);
    const xAt = (i) => padL + (n === 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
    const yAt = (pct) => padT + (1 - (pct - yMin) / ySpan) * (h - padT - padB);
    // grade horizontal com 4 divisões dentro da faixa reescalada
    let grid = '';
    for (let k = 0; k <= 4; k++) {
      const gv = yMin + (ySpan * k / 4);
      const y = yAt(gv);
      grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${T.grid}" stroke-width="1" stroke-dasharray="${k === 0 ? '0' : '3 3'}"/>`;
      grid += `<text x="${padL - 10}" y="${y + 4}" font-size="${M.fLabel}" fill="${T.label}" text-anchor="end" font-family="${T.fMono}">${Math.round(gv)}%</text>`;
    }
    // linhas de meta: sem rótulo numérico solto na direita (era o que sobrepunha os
    // valores dos pontos). A legenda abaixo do gráfico já identifica cada meta.
    let refLines = '';
    refs.forEach(r => {
      if (r.v < yMin || r.v > yMax) return;
      const y = yAt(r.v);
      refLines += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${r.color}" stroke-width="1.4" stroke-dasharray="6 4" opacity="0.85"/>`;
    });
    const yAxisTitle = M.narrow ? '' : `<text x="16" y="${padT + (h - padT - padB) / 2}" font-size="12" fill="${T.axis}" text-anchor="middle" font-weight="700" transform="rotate(-90 16 ${padT + (h - padT - padB) / 2})" font-family="${T.fSans}">${yTitle}</text>`;
    let xlabels = '';
    const _labSet = new Set(this._labelIndices(n, M.labelEvery));
    allPoints.forEach((p, i) => {
      if (_labSet.has(i)) {
        // último rótulo à direita (não vaza nem colide com o penúltimo); demais, centrados
        const anchor = (i === n - 1) ? 'end' : (i === 0 ? 'start' : 'middle');
        xlabels += `<text x="${xAt(i)}" y="${h - padB + (M.narrow ? 26 : 22)}" font-size="${M.fLabel}" fill="${T.label}" text-anchor="${anchor}" font-family="${T.fMono}">${p.label || ''}</text>`;
      }
    });
    const xAxisTitle = xTitle ? `<text x="${padL + (w - padL - padR) / 2}" y="${h - 6}" font-size="${M.fAxisTitle}" fill="${T.axis}" text-anchor="middle" font-weight="700" font-family="${T.fSans}">${xTitle}</text>` : '';
    let paths = '';
    series.forEach((s, si) => {
      const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.x)} ${yAt(p.pct)}`).join(' ');
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
      // rótulo de valor: no celular, rotula 1 a cada N pontos (evita amontoado); alterna acima/abaixo
      paths += s.points.map((p, i) => {
        const cx = xAt(p.x), cy = yAt(p.pct);
        const mostra = !M.narrow || (i % M.labelEvery === 0) || (i === s.points.length - 1);
        const acima = (i % 2 === 0) ? (cy > padT + 20) : false;
        const ly = acima ? cy - 12 : cy + 22;
        const anchor = (i === 0) ? 'start' : (i === s.points.length - 1) ? 'end' : 'middle';
        const dx = (i === 0) ? 5 : (i === s.points.length - 1) ? -5 : 0;
        const dot = `<circle cx="${cx}" cy="${cy}" r="${M.narrow ? 5 : 4.5}" fill="${T.surface}" stroke="${s.color}" stroke-width="2.5"><title>${p.label}: ${formatPct(p.pct)}%</title></circle>`;
        const lbl = mostra ? `<text x="${cx + dx}" y="${ly}" font-size="${M.fVal}" fill="${s.color}" text-anchor="${anchor}" font-weight="700" font-family="${T.fMono}">${formatPct(p.pct)}%</text>` : '';
        return dot + lbl;
      }).join('');
    });
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; overflow:visible;" preserveAspectRatio="xMidYMid meet">${grid}${refLines}${yAxisTitle}${paths}${xlabels}${xAxisTitle}</svg>`;
  },

  // Reflete o estado (datas + atalho ativo) nos controles da tela
  syncControls() {
    const startEl = document.getElementById('evo-date-start');
    const endEl = document.getElementById('evo-date-end');
    const hoje = todayLocal();
    startEl.value = this.filterStart || '';
    endEl.value = this.filterEnd || '';
    // impede intervalos impossíveis já na UI: início ≤ fim ≤ hoje
    startEl.max = this.filterEnd || hoje;
    endEl.max = hoje;
    endEl.min = this.filterStart || '';
    // destaca o atalho ativo
    [['7d', 'evo-period-7d'], ['30d', 'evo-period-30d'], ['all', 'evo-period-all']].forEach(([key, id]) => {
      document.getElementById(id).classList.toggle('is-active', this.activeShortcut === key);
    });
  },

  updatePeriodLabel(allEntries, shownCount) {
    const label = document.getElementById('evo-period-label');
    if (!this.filterStart && !this.filterEnd) {
      label.textContent = `Exibindo todo o período (${allEntries.length} registro${allEntries.length === 1 ? '' : 's'})`;
    } else {
      const start = this.filterStart ? formatDateShort(this.filterStart) : 'início';
      const end = this.filterEnd ? formatDateShort(this.filterEnd) : 'hoje';
      label.textContent = `Exibindo de ${start} até ${end} · ${shownCount} registro${shownCount === 1 ? '' : 's'}`;
    }
  },

  setPeriod(days) {
    if (days === null) {
      this.filterStart = null;
      this.filterEnd = null;
      this.activeShortcut = 'all';
    } else {
      const hoje = todayLocal();
      this.filterEnd = hoje;
      this.filterStart = this.addDaysLocal(hoje, -days); // inclui hoje: 7 dias => hoje e 6 dias atrás
      this.activeShortcut = days === 6 ? '7d' : days === 29 ? '30d' : null;
    }
    this.render();
  },

  // Handlers dos campos manuais, com correção automática de intervalo inválido
  onStartChange(value) {
    this.filterStart = value || null;
    this.activeShortcut = null;
    // se o início ficou depois do fim, empurra o fim para acompanhar
    if (this.filterStart && this.filterEnd && this.filterStart > this.filterEnd) {
      this.filterEnd = this.filterStart;
    }
    this.render();
  },
  onEndChange(value) {
    this.filterEnd = value || null;
    this.activeShortcut = null;
    // se o fim ficou antes do início, puxa o início junto
    if (this.filterStart && this.filterEnd && this.filterEnd < this.filterStart) {
      this.filterStart = this.filterEnd;
    }
    this.render();
  },

  renderStats(entries) {
    const totalMin = entries.reduce((s, e) => s + (e.durationMin || 0), 0);
    const uniqueDays = new Set(entries.map(e => e.date)).size;
    const withPct = entries.filter(e => e.total > 0);
    /* BUG CORRIGIDO — media de percentuais x percentual real.
       Antes: somava o % de cada sessao e dividia pelo numero de sessoes. Isso da
       o mesmo peso a uma sessao de 2 questoes e a uma de 200. Um dia com
       2/2 (100%) e 100/200 (50%) resultava em 75%, quando o acerto real e
       102/202 = 50,5%.
       Agora: soma acertos, soma questoes, divide. E o mesmo criterio que os
       outros cartoes desta tela ja usavam — o KPI do topo era o unico fora. */
    const somaAcertos = withPct.reduce((s, e) => s + (e.correct || 0), 0);
    const somaQuestoes = withPct.reduce((s, e) => s + (e.total || 0), 0);
    const avgPct = somaQuestoes > 0 ? Math.round((somaAcertos / somaQuestoes) * 10000) / 100 : 0;

    // cor do cartao de acerto segue as metas configuradas (verde/amarelo/vermelho),
    // para o numero se explicar sozinho sem precisar consultar a legenda
    // Cor pela mesma regra do resto do app: toneFor() ja le as metas de "⚙ Metas".
    // Reimplementar a comparacao aqui criaria duas fontes de verdade que podiam
    // divergir quando voce mudasse as metas.
    const TOM = { good: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad, #e0393f)' };
    const corAcerto = somaQuestoes === 0 ? 'var(--text-faint)' : (TOM[toneFor(avgPct)] || 'var(--accent)');
    $id('evolucao-stats').innerHTML = `
      <div class="evo-stat-card" style="--evo-cor: var(--accent);">
        <div class="ico">⏱️</div>
        <div class="value">${CycleEngine.fmtHM(totalMin)}</div>
        <div class="label">tempo total estudado</div>
      </div>
      <div class="evo-stat-card" style="--evo-cor: #7c3aed;">
        <div class="ico">📅</div>
        <div class="value">${uniqueDays}</div>
        <div class="label">dias com registro</div>
      </div>
      <div class="evo-stat-card" style="--evo-cor: ${corAcerto};">
        <div class="ico">🎯</div>
        <div class="value">${formatPct(avgPct)}%</div>
        <div class="label">acerto em questões${somaQuestoes ? ' <span class="evo-stat-sub">' + somaAcertos.toLocaleString('pt-BR') + ' de ' + somaQuestoes.toLocaleString('pt-BR') + '</span>' : ''}</div>
      </div>
      <div class="evo-stat-card" style="--evo-cor: #0f9d63;" title="Tempo total dividido pelos dias em que houve registro — mede o TAMANHO da sua sessão típica, não a frequência.">
        <div class="ico">📈</div>
        <div class="value">${uniqueDays > 0 ? CycleEngine.fmtHM(Math.round(totalMin / uniqueDays)) : '—'}</div>
        <div class="label">média por dia estudado${uniqueDays ? ' <span class="evo-stat-sub">em ' + uniqueDays + ' dia' + (uniqueDays === 1 ? '' : 's') + '</span>' : ''}</div>
      </div>
    `;
  },

  renderLineChart(entries) {
    // agrupa horas por dia, acumulado
    const byDate = {};
    entries.forEach(e => { byDate[e.date] = (byDate[e.date] || 0) + (e.durationMin || 0); });
    const dates = Object.keys(byDate).sort();
    let acc = 0;
    const points = dates.map(d => { acc += byDate[d]; return { date: d, acc }; });

    $id('evolucao-chart-sub').textContent =
      `${dates.length} dia(s) registrados · ${CycleEngine.fmtHM(acc)} acumuladas`;

    const container = document.getElementById('evolucao-line-chart');
    if (points.length < 2) {
      container.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 20px 8px;">Registre estudos em pelo menos 2 dias diferentes para ver o gráfico de evolução.</p>`;
      return;
    }

    // Geometria padronizada entre todos os gráficos desta tela.
    const T = this._ctheme();
    const M = this._chartMetrics(points.length);
    const gid = 'areaGrad_' + Math.random().toString(36).slice(2, 8);
    const w = 720, h = 250, padR = 22, padT = 22, padB = M.narrow ? 52 : 46;
    const maxRaw = Math.max(...points.map(p => p.acc));
    const n = points.length;

    /* ── EIXO Y COM PASSO REDONDO ─────────────────────────────────────────────
       Antes o eixo dividia o máximo em 4 fatias iguais: com 95h acumuladas
       saíam 23h45min, 47h30min, 71h15min — rótulos de 9 caracteres, largos, e
       sem sentido de leitura. Pior: a margem esquerda era fixa (68px) e menor
       que eles, então apareciam CORTADOS no canto.

       Agora escolhemos um passo "de relógio" (30min, 1h, 2h, 5h, 10h, 12h,
       24h, 48h…) — o menor que caiba em ~5 linhas de grade. Todo rótulo vira
       hora cheia e a margem é calculada a partir do texto mais largo, então
       nada é cortado em nenhum tamanho de fonte. */
    const PASSOS = [30, 60, 120, 180, 300, 600, 720, 1440, 2880, 4320, 6000, 12000];
    const alvoLinhas = 5;
    let passo = PASSOS.find(p => maxRaw / p <= alvoLinhas) || Math.ceil(maxRaw / alvoLinhas / 60) * 60;
    const maxAcc = Math.max(passo, Math.ceil(maxRaw / passo) * passo);
    const linhas = Math.round(maxAcc / passo);

    // Margem esquerda a partir do rótulo mais largo (não um número mágico).
    const rotulos = [];
    // fmtHM(0) devolve "0min", que destoa numa escala de horas cheias.
    for (let s = 0; s <= linhas; s++) rotulos.push(s === 0 ? '0h' : CycleEngine.fmtHM(passo * s));
    const maxChars = rotulos.reduce((a, r) => Math.max(a, r.length), 1);
    const padL = Math.ceil(maxChars * (M.fLabel * 0.62)) + 16;   // 0.62em ≈ largura da monoespaçada

    const xAt = (i) => padL + (i / (n - 1)) * (w - padL - padR);
    const yAt = (val) => padT + (1 - val / maxAcc) * (h - padT - padB);

    let grid = '';
    for (let s = 0; s <= linhas; s++) {
      const val = passo * s;
      const y = yAt(val);
      grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${T.grid}" stroke-width="1" stroke-dasharray="${s === 0 ? '0' : '3 3'}"/>`;
      grid += `<text x="${padL - 10}" y="${y + 3.5}" font-size="${M.fLabel}" fill="${T.label}" text-anchor="end" font-family="${T.fMono}">${rotulos[s]}</text>`;
    }

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.acc)}`).join(' ');
    const areaD = pathD + ` L ${xAt(n - 1)} ${h - padB} L ${xAt(0)} ${h - padB} Z`;

    // Rótulos do eixo X CIENTES DE PIXELS: garante espaço suficiente entre uma
    // data e outra (largura aproximada de "dd/mm") para NUNCA sobreporem — nem no
    // fim do gráfico. Começamos pelo ÚLTIMO ponto (âncora à direita) e vamos para
    // a esquerda pulando o que estiver perto demais; assim o canto direito fica limpo.
    const plotW = w - padL - padR;
    const stepPx = plotW / Math.max(1, n - 1);
    const labelPx = (M.narrow ? 46 : 40);            // largura estimada de "dd/mm" + folga
    const minStep = Math.max(1, Math.ceil(labelPx / stepPx));
    /* A ÂNCORA MUDA O ESPAÇO OCUPADO — era isso que causava a sobreposição.
       O último rótulo é ancorado em "end": ele cresce para a ESQUERDA e ocupa
       uma largura inteira ANTES do seu x. O primeiro é "start" e cresce para a
       direita. O cálculo antigo tratava todos como "middle" (meia largura para
       cada lado), então o penúltimo invadia o último — o "04/09" grudado no
       "06/09" que você viu.
       Agora medimos o intervalo [esq, dir] real de cada candidato conforme a
       âncora que ele vai receber e descartamos quem colidir com o já aceito. */
    const extensao = (i) => {
      const x = xAt(i);
      if (i === n - 1) return [x - labelPx, x];      // âncora "end"
      if (i === 0) return [x, x + labelPx];          // âncora "start"
      return [x - labelPx / 2, x + labelPx / 2];     // âncora "middle"
    };
    const labSet = new Set([n - 1]);                 // âncora à direita: sempre entra
    let ultimoEsq = extensao(n - 1)[0];
    for (let i = n - 2; i >= 1; i -= 1) {
      const [e, d] = extensao(i);
      if (d + 4 <= ultimoEsq) { labSet.add(i); ultimoEsq = e; }   // 4px de respiro
    }
    // O primeiro só entra se realmente couber — melhor faltar do que sobrepor.
    if (n > 1 && extensao(0)[1] + 4 <= ultimoEsq) labSet.add(0);
    const labels = points.map((p, i) => {
      if (!labSet.has(i)) return '';
      const anchor = (i === n - 1) ? 'end' : (i === 0 ? 'start' : 'middle');
      return `<text x="${xAt(i)}" y="${h - padB + (M.narrow ? 24 : 20)}" font-size="${M.fLabel}" fill="${T.label}" text-anchor="${anchor}" font-family="${T.fMono}">${this._shortDate(p.date, M.narrow)}</text>`;
    }).join('');
    // rótulo do valor final acumulado
    const last = points[n - 1];
    const endLabel = `<text x="${xAt(n - 1)}" y="${yAt(last.acc) - 10}" font-size="${M.fVal}" fill="${T.accent}" text-anchor="end" font-weight="700" font-family="${T.fMono}">${CycleEngine.fmtHM(last.acc)}</text>`;
    const xAxisTitle = `<text x="${padL + (w - padL - padR) / 2}" y="${h - 5}" font-size="${M.fAxisTitle}" fill="${T.axis}" text-anchor="middle" font-weight="700" font-family="${T.fSans}">Data</text>`;

    container.innerHTML = `
      <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; overflow:visible;" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${T.accent}" stop-opacity="0.20"/>
            <stop offset="100%" stop-color="${T.accent}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${grid}
        <path d="${areaD}" fill="url(#${gid})" />
        <path d="${pathD}" fill="none" stroke="${T.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        ${points.map((p, i) => `<circle cx="${xAt(i)}" cy="${yAt(p.acc)}" r="${M.dot}" fill="${T.accent}"/><circle cx="${xAt(i)}" cy="${yAt(p.acc)}" r="13" fill="transparent" style="cursor:pointer" data-tip="${formatDateShort(p.date)}: ${CycleEngine.fmtHM(p.acc)} acumuladas"></circle>`).join('')}
        ${labels}${endLabel}${xAxisTitle}
      </svg>
    `;
  },

  renderBarChart(entries) {
    const bySubject = {};
    entries.forEach(e => { bySubject[e.subject] = (bySubject[e.subject] || 0) + (e.durationMin || 0); });
    const sorted = Object.entries(bySubject).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const max = sorted.length ? sorted[0][1] : 1;
    const totalAll = sorted.reduce((a, [, m]) => a + m, 0) || 1;
    const container = document.getElementById('evolucao-bar-chart');
    if (sorted.length === 0) {
      container.innerHTML = `<div class="evo-empty-mini">Nenhum tempo registrado no período.</div>`;
      return;
    }
    container.innerHTML = sorted.map(([name, min]) => {
      const pctTotal = Math.round((min / totalAll) * 100);
      return `
      <div class="tpm-row" data-tip="${escapeHtml(name)}: ${CycleEngine.fmtHM(min)} · ${pctTotal}% do seu tempo">
        <div class="tpm-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="tpm-bar-wrap">
          <div class="tpm-track"><div class="tpm-fill" style="width:${(min / max) * 100}%;"></div></div>
        </div>
        <div class="tpm-val">
          <span class="tpm-hours">${CycleEngine.fmtHM(min)}</span>
          <span class="tpm-pct">${pctTotal}%</span>
        </div>
      </div>`;
    }).join('');
  },

  renderPerformanceList(entries) {
    const bySubject = {};
    entries.filter(e => e.total > 0).forEach(e => {
      if (!bySubject[e.subject]) bySubject[e.subject] = { correct: 0, total: 0 };
      bySubject[e.subject].correct += e.correct;
      bySubject[e.subject].total += e.total;
    });
    const rows = Object.entries(bySubject)
      .map(([name, v]) => ({ name, pct: calcPct(v.correct, v.total) }))
      .sort((a, b) => b.pct - a.pct);

    const container = document.getElementById('evolucao-performance-list');
    if (rows.length === 0) {
      container.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 12px 0;">Nenhum registro com questões resolvidas ainda.</p>`;
      return;
    }
    container.innerHTML = rows.map(r => `
      <div class="perf-row">
        <span class="name">${escapeHtml(r.name)}</span>
        <span class="pct-badge tone-${toneFor(r.pct)}" style="background:var(--${toneFor(r.pct)}-soft); color:var(--${toneFor(r.pct)}-text);">${formatPct(r.pct)}%</span>
      </div>
    `).join('');
  },

  renderModalityTable(entries) {
    // matriz matéria x forma de estudo, em minutos
    const subjects = [...new Set(entries.map(e => e.subject))].sort();
    const methods = [...new Set(entries.map(e => e.method))].sort();
    const container = document.getElementById('evolucao-modality-table');

    if (subjects.length === 0 || methods.length === 0) {
      container.innerHTML = `<p style="color:var(--text-faint); font-size:13px; padding: 12px 0;">Sem dados suficientes no período.</p>`;
      return;
    }

    const matrix = {};
    subjects.forEach(s => { matrix[s] = {}; methods.forEach(m => matrix[s][m] = 0); });
    entries.forEach(e => { matrix[e.subject][e.method] += (e.durationMin || 0); });

    const subjectTotals = subjects.map(s => methods.reduce((sum, m) => sum + matrix[s][m], 0));
    const methodTotals = methods.map(m => subjects.reduce((sum, s) => sum + matrix[s][m], 0));
    const grandTotal = subjectTotals.reduce((a, b) => a + b, 0) || 1;
    // ordena matérias por total (as com mais tempo primeiro) e realça a célula
    // mais intensa de cada linha com uma tênue tarja da cor de acento (heatmap leve).
    const order = subjects.map((s, i) => i).sort((a, b) => subjectTotals[b] - subjectTotals[a]);
    const maxCell = Math.max(1, ...subjects.flatMap(s => methods.map(m => matrix[s][m])));

    let html = '<div class="modality-wrap"><table class="modality-table"><thead><tr><th class="mt-sticky">Matéria</th>';
    methods.forEach(m => html += `<th>${escapeHtml(m)}</th>`);
    html += '<th class="mt-total-col">Total</th></tr></thead><tbody>';
    order.forEach(i => {
      const s = subjects[i];
      html += `<tr><td class="mt-sticky mt-name" title="${escapeHtml(s)}">${escapeHtml(s)}</td>`;
      methods.forEach(m => {
        const min = matrix[s][m];
        const intensity = min > 0 ? (0.06 + 0.20 * (min / maxCell)).toFixed(3) : 0;
        const bg = min > 0 ? `background:color-mix(in srgb, var(--accent) ${(intensity * 100).toFixed(1)}%, transparent);` : '';
        html += `<td class="mt-cell${min === 0 ? ' mt-zero' : ''}" style="${bg}">${min > 0 ? CycleEngine.fmtHM(min) : '·'}</td>`;
      });
      html += `<td class="mt-cell mt-total-col">${CycleEngine.fmtHM(subjectTotals[i])}</td></tr>`;
    });
    // rodapé com o total por modalidade + participação
    html += '<tr class="mt-foot"><td class="mt-sticky">Total</td>';
    methodTotals.forEach(mt => html += `<td class="mt-cell">${mt > 0 ? CycleEngine.fmtHM(mt) : '·'}</td>`);
    html += `<td class="mt-cell mt-total-col">${CycleEngine.fmtHM(grandTotal === 1 && subjectTotals.reduce((a, b) => a + b, 0) === 0 ? 0 : subjectTotals.reduce((a, b) => a + b, 0))}</td></tr>`;
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }
};

window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'evolucao') EvolucaoScreen.render();
});

// Redesenha os gráficos ao girar/redimensionar (recalcula densidade de rótulos e
// fontes responsivas). Só age quando a Evolução está visível, e cruza um limiar de
// largura, para não re-renderizar à toa a cada pixel.
(function () {
  let t = null, lastNarrow = null;
  window.addEventListener('resize', () => {
    const scr = document.getElementById('screen-evolucao');
    if (!scr || !scr.classList.contains('active')) return;
    const narrow = (window.innerWidth || 1024) < 640;
    if (lastNarrow === null) lastNarrow = narrow;
    clearTimeout(t);
    t = setTimeout(() => { EvolucaoScreen.render(); lastNarrow = narrow; }, 220);
  }, { passive: true });
})();

// Filtro de período: inputs manuais e atalhos rápidos
$id('evo-date-start').addEventListener('change', (e) => EvolucaoScreen.onStartChange(e.target.value));
$id('evo-date-end').addEventListener('change', (e) => EvolucaoScreen.onEndChange(e.target.value));
$id('evo-period-7d').addEventListener('click', () => EvolucaoScreen.setPeriod(6));
$id('evo-period-30d').addEventListener('click', () => EvolucaoScreen.setPeriod(29));
$id('evo-period-all').addEventListener('click', () => EvolucaoScreen.setPeriod(null));

// ⚙ Editor de metas/limiares (verde/amarelo + linhas de referência) — reflete em todo o app
(function () {
  const btn = document.getElementById('btn-edit-metas');
  const syncSub = () => { const s = document.getElementById('metas-sub'); if (s) s.textContent = 'metas ' + AppSettings.get().linhas.slice().sort((a, b) => a - b).join('/'); };
  syncSub();
  if (btn) btn.addEventListener('click', () => {
    const m = AppSettings.get();
    UI.prompt([
      { key: 'bom', label: '🟢 Meta VERDE — "bom" a partir de (%)', type: 'number', value: m.bom, min: 1, max: 100 },
      { key: 'at', label: '🟡 Meta AMARELA — "atenção" a partir de (%)', type: 'number', value: m.atencao, min: 1, max: 100, hint: 'Abaixo deste valor é vermelho.' },
      { key: 'linhas', label: '📏 Linhas de referência nos gráficos', type: 'text', value: m.linhas.join(', '), placeholder: '70, 80, 85', hint: 'Percentuais separados por vírgula (até 4).' }
    ], { title: '⚙ Editar metas de aproveitamento', okText: 'Salvar metas' }).then(v => {
      if (!v) return;
      const nb = Math.max(1, Math.min(100, parseFloat(v.bom) || m.bom));
      const na = Math.max(1, Math.min(nb - 1, parseFloat(v.at) || m.atencao));
      const nl = String(v.linhas).split(/[,;\s]+/).map(x => parseFloat(x)).filter(x => !isNaN(x) && x > 0 && x <= 100).slice(0, 4);
      AppSettings.set({ bom: nb, atencao: na, linhas: nl.length ? nl : m.linhas });
      syncSub();
      EvolucaoScreen.render();
      showToast('Metas atualizadas ✓');
    });
  });
})();
$id('evo-scope-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-scope]');
  if (!btn) return;
  EvolucaoScreen.scope = btn.dataset.scope;
  document.querySelectorAll('#evo-scope-toggle button').forEach(b => b.classList.toggle('active', b === btn));
  EvolucaoScreen.render();
});
// [MELHORIA 1] Minimizar o cartão de Escopo/filtros — estado salvo por perfil.
function _evoScopeKey() { try { return DB._profilePrefix() + 'evo-scope-collapsed'; } catch (_) { return 'diario-estudos:evo-scope-collapsed'; } }
function evoApplyScopeCollapsed(collapsed, persist) {
  const body = document.getElementById('evo-scope-body');
  const btn = document.getElementById('evo-scope-collapse');
  const txt = document.getElementById('evo-scope-collapse-txt');
  if (!body || !btn) return;
  body.hidden = collapsed;
  btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  if (txt) txt.textContent = collapsed ? 'Mostrar filtros' : 'Ocultar filtros';
  if (persist) { try { localStorage.setItem(_evoScopeKey(), collapsed ? '1' : '0'); } catch (_) { _quiet(_); }
    try { if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange(); } catch (_) { _quiet(_); } }
}
(function () { const b = document.getElementById('evo-scope-collapse');
  if (b) b.addEventListener('click', () => {
    const collapsed = $id('evo-scope-collapse').getAttribute('aria-expanded') === 'true';
    evoApplyScopeCollapsed(collapsed, true);
  });
})();
window.addEventListener('screen:activated', (e) => {
  if (e.detail && e.detail.screen === 'evolucao') {
    let c = false; try { c = localStorage.getItem(_evoScopeKey()) === '1'; } catch (_) { _quiet(_); }
    evoApplyScopeCollapsed(c, false);
  }
});

// atalho de período do gráfico "Tempo de estudo por dia"
$id('evo-tempo-periodo').addEventListener('click', (e) => {
  const btn = e.target.closest('.evo-chip');
  if (!btn) return;
  EvolucaoScreen.tempoDias = parseInt(btn.dataset.days, 10);
  EvolucaoScreen.tempoStart = null; EvolucaoScreen.tempoEnd = null; // atalho anula o intervalo custom
  document.querySelectorAll('#evo-tempo-periodo .evo-chip').forEach(b => b.classList.toggle('active', b === btn));
  EvolucaoScreen.renderDayChart(EvolucaoScreen._sourceEntries());
});
// [MELHORIA] Intervalo de datas personalizado no "Tempo de estudo"
(function () {
  const de = document.getElementById('evo-tempo-de');
  const ate = document.getElementById('evo-tempo-ate');
  const clear = document.getElementById('evo-tempo-clear');
  const apply = () => {
    const dv = de && de.value, av = ate && ate.value;
    if (dv && av) {
      EvolucaoScreen.tempoStart = dv; EvolucaoScreen.tempoEnd = av;
      EvolucaoScreen.renderDayChart(EvolucaoScreen._sourceEntries());
    } else if (dv || av) {
      // com só uma data definida, ainda não filtra; espera a outra
      EvolucaoScreen.tempoStart = dv || null; EvolucaoScreen.tempoEnd = av || null;
    }
  };
  if (de) de.addEventListener('change', apply);
  if (ate) ate.addEventListener('change', apply);
  if (clear) clear.addEventListener('click', () => {
    EvolucaoScreen.tempoStart = null; EvolucaoScreen.tempoEnd = null;
    EvolucaoScreen.renderDayChart(EvolucaoScreen._sourceEntries());
  });
})();

// seletor de disciplina do gráfico "Evolução no TecConcursos"
$id('evo-tec-disc').addEventListener('change', () => EvolucaoScreen.renderTecChart());
// [MELHORIA 4] seletor de período do gráfico "Evolução no TecConcursos"
$id('evo-tec-periodo').addEventListener('click', (e) => {
  const b = e.target.closest('.evo-chip'); if (!b) return;
  const v = b.dataset.tecdays;
  EvolucaoScreen.tecEvoDias = (v === 'all') ? 'all' : parseInt(v, 10);
  document.querySelectorAll('#evo-tec-periodo .evo-chip').forEach(x => x.classList.toggle('active', x === b));
  EvolucaoScreen.renderTecChart();
});

// modo do gráfico "Evolução do aproveitamento" (semanal x acumulada)
['evo-line-mode-week', 'evo-line-mode-cum'].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) btn.addEventListener('click', () => {
    EvolucaoScreen.evoLineMode = btn.dataset.mode;
    let entries = EvolucaoScreen._sourceEntries();
    if (EvolucaoScreen.filterStart) entries = entries.filter(e => e.date >= EvolucaoScreen.filterStart);
    if (EvolucaoScreen.filterEnd) entries = entries.filter(e => e.date <= EvolucaoScreen.filterEnd);
    EvolucaoScreen.renderAcertoLinha(entries);
  });
});
