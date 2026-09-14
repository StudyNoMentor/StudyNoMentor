/* ============================================================================
   PLANO → EXTRAS — governança dos motores de sugestão V1
   ----------------------------------------------------------------------------
   Regras transversais que não pertencem à fórmula de um motor específico:
     • disciplina com reforço do Plano já aberto não entra em nova rodada;
     • Robusto herda a configuração real do Plano, não os controles do Simplificado;
     • nomes do edital/TEC usam o casamento conservador já auditado no Plano;
     • intervenção Mentor 90+ e configuração efetiva ficam gravadas na origem.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || !window.PlanoSugestoesV1 || window.__planoSugestoesGovernancaV1) return;
  window.__planoSugestoesGovernancaV1 = true;
  const E = window.PlanoSugestoesV1;
  const M90 = window.Mentor90V5;
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, num(v, a)));
  const norm = (s) => {
    try { if (typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm) return ReforcoEngine.norm(s || ''); }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-norm'); }
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  };
  const esc = (s) => typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s);

  // Um rodízio de três disciplinas perde o sentido se, enquanto uma frente está
  // aberta, a rodada seguinte abrir outro tópico da mesma matéria. A trava é por
  // disciplina para atividades oriundas do Plano; Extras livres não interferem.
  if (!E._poolGovernancaBase) {
    E._poolGovernancaBase = E._pool.bind(E);
    E._pool = function(r) {
      const out = E._poolGovernancaBase(r);
      let abertas = [];
      try { abertas = E._abertas ? E._abertas() : []; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-abertas'); }
      const bloqueadas = new Set(abertas.map(e => norm((e.origemPlano && e.origemPlano.disciplina) || e.disciplina)).filter(Boolean));
      return out.filter(x => !bloqueadas.has(norm(x && x.disciplina)));
    };
  }

  // Completa pontos/pesos quando o nome do planejamento não é literalmente o
  // mesmo nome que veio do TEC. Usa o mesmo casamento conservador do Plano:
  // igualdade, subconjunto inequívoco ou abreviação inequívoca; ambiguidade não chuta.
  if (!E._calcularGovernancaBase) {
    E._calcularGovernancaBase = E._calcular.bind(E);
    E._calcular = function(p, extra) {
      const z = E._calcularGovernancaBase(p, extra);
      const r = z && z.r;
      if (!r || r.erro || typeof PlanoPontos === 'undefined' || !PlanoPontos.temComposicao || !PlanoPontos.temComposicao()) return z;
      try {
        const itens = [].concat(r.itens || [], r.pequenas || []);
        const comp = PlanoPontos.composicao ? PlanoPontos.composicao() : [];
        if (!itens.length || !comp.length || typeof PlanoPontos._casarNomes !== 'function') return z;
        const discTec = [...new Set(itens.map(x => norm(x.disciplina)).filter(Boolean))];
        const chComp = comp.map(m => norm(m.nome));
        const cas = PlanoPontos._casarNomes(chComp, discTec) || {};
        const peso = Object.create(null);
        comp.forEach(m => {
          const k0 = norm(m.nome), k = cas[k0] || k0;
          peso[k] = (peso[k] || 0) + Math.max(0, num(m.valor));
        });
        const denomInc = Object.create(null), denomQ = Object.create(null);
        itens.forEach(x => {
          const d = norm(x.disciplina);
          denomInc[d] = (denomInc[d] || 0) + Math.max(0, num(x.incid));
          denomQ[d] = (denomQ[d] || 0) + Math.max(0, num(x.qHist, x.qJanela));
        });
        const teto = Math.max(50, Math.min(100, num(z.opts && z.opts.tetoDominio, 90)));
        itens.forEach(x => {
          const d = norm(x.disciplina), pm = Math.max(0, num(x.pontosMateria, peso[d]));
          if (!(pm > 0)) return;
          if (!(num(x.pontosMateria) > 0)) x.pontosMateria = pm;
          if (!(num(x.pontosGanho) > 0)) {
            const inc = Math.max(0, num(x.incid)), q = Math.max(0, num(x.qHist, x.qJanela));
            const share = denomInc[d] > 0 ? inc / denomInc[d] : (denomQ[d] > 0 ? q / denomQ[d] : 0);
            const ganho = pm * share * Math.max(0, teto - num(x.taxa, teto)) / 100;
            x.pontosGanho = ganho;
            x.pontosPorQuestao = ganho / Math.max(1, num(x.custoQ, 1));
          }
        });
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-edital'); }
      return z;
    };
  }

  // O modo Robusto é o Plano atual. Meta operacional, amostra e banca vêm dos
  // Ajustes do Plano. A régua competitiva de 90% continua dentro do Mentor 90+.
  if (!E._robustoGovernancaBase) {
    E._robustoGovernancaBase = E.robusto.bind(E);
    E.robusto = function(p) {
      let plano = {};
      try { plano = PlanoEngine.prefs ? PlanoEngine.prefs() : {}; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-prefs'); }
      let fase = E.faseEfetiva(p);
      if (p && p.modo === 'robusto') {
        try { if (typeof PlanoPontos !== 'undefined' && PlanoPontos.modo) fase = PlanoPontos.modo(); }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-fase'); }
      }
      const q = Object.assign({}, p || {}, {
        fase: fase === 'pos' ? 'pos' : 'pre',
        meta: clamp(plano.metaDominio, 30, 100),
        minAmostra: Math.max(1, Math.round(num(plano.minAmostra, 20))),
        banca: plano.banca && plano.banca !== '__todas__' ? plano.banca : (p && p.banca) || '__todas__'
      });
      const out = E._robustoGovernancaBase(q);
      if (!out || out.erro) return out;
      out.configPlano = { metaOperacional:q.meta, metaCompetitiva:90, minAmostra:q.minAmostra, banca:q.banca, fase:q.fase };
      (out.todos || out.itens || []).forEach(c => {
        if (!c) return;
        c.configPlano = out.configPlano;
        c.meta = q.meta; c.minAmostra = q.minAmostra; c.banca = q.fase === 'pos' ? q.banca : null;
        if (M90 && typeof M90.intervencao === 'function' && c.mentor && c.mentor.dominio && c.mentor.calibracao) {
          try {
            const dose = Math.max(0, Math.round(num(c.doseDiaria, Math.min(c.alvo || 12, 12))));
            c.intervencao = M90.intervencao(c.item, c.item && c.item.prescricaoAdaptativa, c.mentor.dominio, c.mentor.calibracao, dose);
            if (c.intervencao && c.intervencao.rotulo && !String(c.motivo || '').includes(c.intervencao.rotulo)) c.motivo += ` · ${c.intervencao.rotulo}`;
          } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-intervencao'); }
        }
      });
      return out;
    };
  }

  // No Robusto os campos Meta/Amostra/Banca do Simplificado seriam enganosos:
  // escondemos esses controles e declaramos quais ajustes do Plano estão valendo.
  if (!E._cabecalhoGovernancaBase) {
    E._cabecalhoGovernancaBase = E._cabecalho.bind(E);
    E._cabecalho = function(p, res) {
      let html = E._cabecalhoGovernancaBase(p, res);
      let plano = {};
      try { plano = PlanoEngine.prefs ? PlanoEngine.prefs() : {}; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-header'); }
      const resumo = `<div class="ps-rule"><b>Ajustes do Robusto:</b> Plano atual · meta operacional ${Math.round(num(plano.metaDominio,85))}% · régua competitiva 90%+ · amostra mínima ${Math.round(num(plano.minAmostra,20))} · ${esc((res&&res.fase)==='pos'?'pós-edital':'pré-edital')}.</div>`;
      const ini = html.indexOf('<div class="ps-settings');
      const regra = ini >= 0 ? html.indexOf('<div class="ps-rule"', ini) : -1;
      if (p && p.modo === 'robusto' && ini >= 0 && regra > ini) {
        html = html.slice(0, ini) + resumo + html.slice(regra);
      } else if (p && p.modo === 'comparar' && regra >= 0) {
        html = html.slice(0, regra) + resumo + html.slice(regra);
      }
      return html;
    };
  }

  // Persistência auditável: corrige a configuração efetiva (Robusto usa Plano)
  // e leva a intervenção recomendada para a origem/observação da atividade.
  if (!E._criarGovernancaBase) {
    E._criarGovernancaBase = E.criar.bind(E);
    E.criar = function(screen, p, res) {
      const escolhidos = E._escolhidos ? E._escolhidos(screen, p, res).slice() : [];
      let antes = new Set();
      try { antes = new Set((DB.getExtras() || []).map(x => x.id)); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-before'); }
      const n = E._criarGovernancaBase(screen, p, res);
      try {
        const novos = (DB.getExtras() || []).filter(x => !antes.has(x.id));
        novos.forEach(e => {
          const c = escolhidos.find(z => z && norm(z.disciplina) === norm(e.disciplina) && norm(z.nome) === norm(e.origemPlano && e.origemPlano.topico));
          if (!c || !e.origemPlano || !e.origemPlano.sugestao) return;
          const origem = Object.assign({}, e.origemPlano, { sugestao:Object.assign({}, e.origemPlano.sugestao) });
          origem.sugestao.meta = c.meta;
          origem.sugestao.minAmostra = c.minAmostra;
          origem.sugestao.banca = c.banca || null;
          origem.sugestao.configPlano = c.configPlano || null;
          origem.sugestao.intervencao = c.intervencao || null;
          let obs = e.obs || '';
          if (c.intervencao && c.intervencao.rotulo && !obs.includes(c.intervencao.rotulo)) obs += ` Intervenção: ${c.intervencao.rotulo}.`;
          DB.updateExtra(e.id, { origemPlano:origem, obs:obs.trim() });
        });
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-gov-after'); }
      return n;
    };
  }
})();
