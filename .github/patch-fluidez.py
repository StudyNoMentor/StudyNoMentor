from pathlib import Path


def once(s, old, new, nome):
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{nome}: esperava 1 ocorrência, achei {n}')
    return s.replace(old, new, 1)


# build: monta o novo CSS/JS no artefato publicado.
p = Path('build.mjs')
s = p.read_text()
s = once(s,
    "  SEP('\\n</style>\\n\\n<style id=\"extras-stability-v1\">\\n'), S('css/16-extras-stability.css'),\n  SEP('\\n</style>\\n\\n<script id=\"app-code\" type=\"application/x-diario-inert\">\\n'),",
    "  SEP('\\n</style>\\n\\n<style id=\"extras-stability-v1\">\\n'), S('css/16-extras-stability.css'),\n  SEP('\\n</style>\\n\\n<style id=\"interaction-feedback-v1\">\\n'), S('css/17-interaction-feedback.css'),\n  SEP('\\n</style>\\n\\n<script id=\"app-code\" type=\"application/x-diario-inert\">\\n'),",
    'build css')
s = once(s,
    "    'js/59-extras-stability.js',\n    'js/60-cloud-store.js',",
    "    'js/59-extras-stability.js',\n    'js/59-interaction-feedback.js',\n    'js/60-cloud-store.js',",
    'build js')
p.write_text(s)


# Extras: o clique pinta feedback antes de entrar no cálculo.
p = Path('src/js/47-tela-extras.js')
s = p.read_text()
s = once(s,
    "  on('extras-plano-btn', 'click', () => ExtrasScreen.puxarDoPlano());",
    "  on('extras-plano-btn', 'click', (ev) => {\n    if (window.WorkFeedback) WorkFeedback.run(ev.currentTarget, 'Analisando Plano…', () => ExtrasScreen.puxarDoPlano(), { overlay: true, region: '#screen-extras', context: 'extras-puxar-plano' });\n    else ExtrasScreen.puxarDoPlano();\n  });",
    'extras botão plano')
s = once(s,
    """    if (ord) ord.addEventListener('change', () => {
      this._planoOrd = ord.value;
      this._planoRecalc();
      // mantém as marcações por NOME do assunto ao reordenar
      const marcadosNomes = new Set([...this._planoSel].map(i => (cand[i] || {}).nome).filter(Boolean));
      this._planoSel = new Set();
      (this._planoCand || []).forEach((x, i) => { if (marcadosNomes.has(x.nome)) this._planoSel.add(i); });
      // atualiza o dropdown de disciplinas (a contagem pode mudar) e a lista
      this._planoBind();
      this._planoRenderLista();
    });""",
    """    if (ord) ord.addEventListener('change', () => {
      const executar = () => {
        this._planoOrd = ord.value;
        this._planoRecalc();
        // mantém as marcações por NOME do assunto ao reordenar
        const marcadosNomes = new Set([...this._planoSel].map(i => (cand[i] || {}).nome).filter(Boolean));
        this._planoSel = new Set();
        (this._planoCand || []).forEach((x, i) => { if (marcadosNomes.has(x.nome)) this._planoSel.add(i); });
        // atualiza o dropdown de disciplinas (a contagem pode mudar) e a lista
        this._planoBind();
        this._planoRenderLista();
      };
      if (window.WorkFeedback) WorkFeedback.run(null, 'Reordenando sugestões…', executar, { overlay: true, region: '#ui-modal', context: 'extras-plano-ordem' });
      else executar();
    });""",
    'extras ordem plano')
s = once(s,
    """    }).then((ok) => {
      if (!ok) return;
      let n = 0;
      (this._planoCand || []).forEach((x, i) => {
        if (!this._planoSel || !this._planoSel.has(i)) return;
        const e = DB.addExtra({
          // o mesmo título dos dois portões (ver `PlanoCiclo.titulo`)
          titulo: PlanoCiclo.titulo(x.nome, x.motivo, x.membros),
          tipo: 'questoes', disciplina: x.disciplina || '', unidade: 'questoes',
          alvo: Math.max(1, x.alvo), periodo: 'unica', contaMetricas: false,
          obs: 'Gerado pelo Plano de pontos fracos.'
        });
        // mesma origem do outro portão: sem isto a atividade nascia sem
        // `taxaInicial` nem `qBase`, e o ciclo dela nunca teria veredito
        if (e) { DB.updateExtra(e.id, { origemPlano: PlanoCiclo.origem(x.nome, x.disciplina, x, { motivo: x.motivo }) }); n++; }
      });
      this.render();
      showToast(n ? n + ' atividade(s) criada(s) ✓' : 'Nenhuma selecionada');
    });""",
    """    }).then((ok) => {
      if (!ok) return;
      const criar = () => {
        let n = 0;
        (this._planoCand || []).forEach((x, i) => {
          if (!this._planoSel || !this._planoSel.has(i)) return;
          const e = DB.addExtra({
            // o mesmo título dos dois portões (ver `PlanoCiclo.titulo`)
            titulo: PlanoCiclo.titulo(x.nome, x.motivo, x.membros),
            tipo: 'questoes', disciplina: x.disciplina || '', unidade: 'questoes',
            alvo: Math.max(1, x.alvo), periodo: 'unica', contaMetricas: false,
            obs: 'Gerado pelo Plano de pontos fracos.'
          });
          // mesma origem do outro portão: sem isto a atividade nascia sem
          // `taxaInicial` nem `qBase`, e o ciclo dela nunca teria veredito
          if (e) { DB.updateExtra(e.id, { origemPlano: PlanoCiclo.origem(x.nome, x.disciplina, x, { motivo: x.motivo }) }); n++; }
        });
        this.render();
        showToast(n ? n + ' atividade(s) criada(s) ✓' : 'Nenhuma selecionada');
        return n;
      };
      if (window.WorkFeedback) return WorkFeedback.run(null, 'Criando atividades…', criar, { overlay: true, region: '#screen-extras', context: 'extras-plano-criar' });
      return criar();
    });""",
    'extras criação plano')
s = once(s,
    """      if (check) check.addEventListener('click', () => {
        // Bug corrigido (B): concluir só faz sentido até hoje — dia futuro é planejamento.
        if (day > todayLocal()) { showToast('Este dia ainda não chegou — conclua a partir da data de hoje'); return; }
        const x = DB.getExtra(id);
        const jaFeita = DB.extraConcluidaEm(x, day);
        DB.setConcluidaDia(id, day, !jaFeita);
        this.render();
        if (!jaFeita) showToast(DB.extraRecorrente(x) ? 'Concluída neste dia 🎉' : 'Atividade concluída 🎉');
      });""",
    """      if (check) check.addEventListener('click', () => {
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
      });""",
    'extras concluir/reabrir')
s = once(s,
    "  on('extras-suggest-btn', 'click', () => { ExtrasScreen._sugAdded = new Set(); ExtrasScreen.openSuggest(); });",
    "  on('extras-suggest-btn', 'click', (ev) => { ExtrasScreen._sugAdded = new Set(); if (window.WorkFeedback) WorkFeedback.run(ev.currentTarget, 'Analisando…', () => ExtrasScreen.openSuggest(), { overlay: true, region: '#screen-extras', context: 'extras-sugestoes' }); else ExtrasScreen.openSuggest(); });",
    'extras sugestões abrir')
s = once(s,
    "  on('extra-suggest-add', 'click', () => ExtrasScreen.addSuggested());",
    "  on('extra-suggest-add', 'click', (ev) => { if (window.WorkFeedback) WorkFeedback.run(ev.currentTarget, 'Criando…', () => ExtrasScreen.addSuggested(), { overlay: true, region: '#extra-suggest-modal', context: 'extras-sugestoes-criar' }); else ExtrasScreen.addSuggested(); });",
    'extras sugestões criar')
p.write_text(s)


# Plano: uma função única para pintar o feedback antes de qualquer repintura cara.
p = Path('src/js/51-tela-desempenho-tec.js')
s = p.read_text()
s = once(s,
    """  _marcarPlanoOcupado(on) {
    const l = document.getElementById('plano-lista');
    const p = document.getElementById('plano-proj');
    [l, p].forEach(e => { if (e) e.classList.toggle('pl-ocupado', !!on); });
  },""",
    """  _marcarPlanoOcupado(on) {
    const l = document.getElementById('plano-lista');
    const p = document.getElementById('plano-proj');
    [l, p].forEach(e => { if (e) { e.classList.toggle('pl-ocupado', !!on); if (on) e.setAttribute('aria-busy', 'true'); else e.removeAttribute('aria-busy'); } });
  },
  _trabalharPlano(alvo, rotulo, fn, overlay) {
    if (window.WorkFeedback) return WorkFeedback.run(alvo, rotulo || 'Processando…', fn, { overlay: !!overlay, region: '#tec-panel-plano', context: 'plano-interacao' });
    return fn();
  },""",
    'helper plano')
s = once(s,
    """    box.querySelectorAll('.pl-modo').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.modo;
      if (k === 'livre') return;
      if (!PlanoEngine.MODOS[k]) return;
      PlanoEngine.salvarPrefs(PlanoEngine.modoPatch(k));
      this.renderPlano();
      showToast(PlanoEngine.MODOS[k].rot + ' aplicado');
    }));""",
    """    box.querySelectorAll('.pl-modo').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.modo;
      if (k === 'livre') return;
      if (!PlanoEngine.MODOS[k]) return;
      this._trabalharPlano(b, 'Aplicando modo…', () => {
        PlanoEngine.salvarPrefs(PlanoEngine.modoPatch(k));
        this.renderPlano();
        showToast(PlanoEngine.MODOS[k].rot + ' aplicado');
      });
    }));""",
    'modo plano')
s = once(s,
    """      if (bj && g) bj.addEventListener('click', () => {
        PlanoEngine.salvarPrefs({ granPiso: g.piso });
        PlanoEngine._agrC = null;
        this.renderPlano(); showToast('🧩 Assuntos com menos de ' + g.piso + ' questões agrupados');
      });""",
    """      if (bj && g) bj.addEventListener('click', () => this._trabalharPlano(bj, 'Agrupando…', () => {
        PlanoEngine.salvarPrefs({ granPiso: g.piso });
        PlanoEngine._agrC = null;
        this.renderPlano(); showToast('🧩 Assuntos com menos de ' + g.piso + ' questões agrupados');
      }));""",
    'atalho agrupar')
s = once(s,
    """      if (bd) bd.addEventListener('click', () => {
        PlanoEngine.salvarPrefs(PlanoEngine.modoPatch('diagnostico'));
        this.renderPlano(); showToast('🔍 Diagnóstico aplicado');
      });""",
    """      if (bd) bd.addEventListener('click', () => this._trabalharPlano(bd, 'Aplicando…', () => {
        PlanoEngine.salvarPrefs(PlanoEngine.modoPatch('diagnostico'));
        this.renderPlano(); showToast('🔍 Diagnóstico aplicado');
      }));""",
    'atalho diagnostico')
s = once(s,
    """      if (bm) bm.addEventListener('click', () => {
        PlanoEngine.salvarPrefs({ minAmostra: sug });
        this.renderPlano(); showToast('Amostra mínima em ' + sug + ' questões');
      });""",
    """      if (bm) bm.addEventListener('click', () => this._trabalharPlano(bm, 'Recalculando…', () => {
        PlanoEngine.salvarPrefs({ minAmostra: sug });
        this.renderPlano(); showToast('Amostra mínima em ' + sug + ' questões');
      }));""",
    'atalho amostra')
s = once(s,
    """    lista.querySelectorAll('[data-atacar]').forEach(b => b.addEventListener('click', () => {
      const sel = document.getElementById('plano-disc');
      if (!sel) return;
      const alvo = b.dataset.atacar;
      const op = [...sel.options].find(o => ReforcoEngine.norm(o.value) === ReforcoEngine.norm(alvo));
      if (!op) { showToast('Sem assuntos medidos em ' + alvo); return; }
      // "Atacar" é decisão de uma matéria só: substitui o foco, não soma a ele
      PlanoEngine.salvarPrefs({ foco: [op.value], disciplina: op.value });
      this._sincronizarFiltroDisc();
      this._planoRefC = null;
      this.renderPlanoConteudo();
      /* Rolar até o bloco de criar atividades é metade do favor: filtrar e
         deixar a pessoa procurando onde a lista mudou não resolve nada. */
      requestAnimationFrame(() => {
        const bloco = document.querySelector('#plano-lista .pl-hoje');
        if (bloco) { try { bloco.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { _quiet(e, 'atacar-scroll'); } }
      });
      showToast('Plano filtrado por ' + op.value + ' — marque o que atacar');
    }));""",
    """    lista.querySelectorAll('[data-atacar]').forEach(b => b.addEventListener('click', () => {
      const sel = document.getElementById('plano-disc');
      if (!sel) return;
      const alvo = b.dataset.atacar;
      const op = [...sel.options].find(o => ReforcoEngine.norm(o.value) === ReforcoEngine.norm(alvo));
      if (!op) { showToast('Sem assuntos medidos em ' + alvo); return; }
      this._trabalharPlano(b, 'Filtrando…', () => {
        // "Atacar" é decisão de uma matéria só: substitui o foco, não soma a ele
        PlanoEngine.salvarPrefs({ foco: [op.value], disciplina: op.value });
        this._sincronizarFiltroDisc();
        this._planoRefC = null;
        this.renderPlanoConteudo();
        if (window.garantirRotulosFocoPlano) garantirRotulosFocoPlano();
        requestAnimationFrame(() => {
          const bloco = document.querySelector('#plano-lista .pl-hoje');
          if (bloco) { try { bloco.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { _quiet(e, 'atacar-scroll'); } }
        });
        showToast('Plano filtrado por ' + op.value + ' — marque o que atacar');
      });
    }));""",
    'atacar')
s = once(s,
    """    lista.querySelectorAll('[data-foco]').forEach(b => b.addEventListener('click', () => {
      const nome = b.dataset.foco;
      const p = PlanoEngine.prefs();
      const atual = Array.isArray(p.foco) ? p.foco.slice() : [];
      const k = ReforcoEngine.norm(nome);
      const i = atual.findIndex(n => ReforcoEngine.norm(n) === k);
      const primeira = atual.length === 0;
      if (i >= 0) atual.splice(i, 1);
      else if (atual.length >= PlanoEngine.MAX_FOCO) { showToast('O foco cabe ' + PlanoEngine.MAX_FOCO + ' matérias'); return; }
      else atual.push(nome);
      PlanoEngine.salvarPrefs({ foco: atual, disciplina: atual.length === 1 ? atual[0] : '__todas__' });
      this._sincronizarFiltroDisc();
      this._planoRefC = null; this._fatias = null;
      this.renderPlanoConteudo();
      if (!atual.length) { showToast('Foco limpo — o Plano voltou a falar de todas as matérias'); return; }
      showToast(atual.length === 1 ? 'Foco em ' + atual[0] : atual.length + ' matérias em foco — a lista abaixo é só delas');
      if (primeira) requestAnimationFrame(() => {
        const bloco = document.querySelector('#plano-lista .pl-hoje');
        if (bloco) { try { bloco.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { _quiet(e, 'foco-scroll'); } }
      });
    }));""",
    """    lista.querySelectorAll('[data-foco]').forEach(b => b.addEventListener('click', () => {
      const nome = b.dataset.foco;
      const p = PlanoEngine.prefs();
      const atual = Array.isArray(p.foco) ? p.foco.slice() : [];
      const k = ReforcoEngine.norm(nome);
      const i = atual.findIndex(n => ReforcoEngine.norm(n) === k);
      const primeira = atual.length === 0;
      if (i >= 0) atual.splice(i, 1);
      else if (atual.length >= PlanoEngine.MAX_FOCO) { showToast('O foco cabe ' + PlanoEngine.MAX_FOCO + ' matérias'); return; }
      else atual.push(nome);
      this._trabalharPlano(b, 'Atualizando foco…', () => {
        PlanoEngine.salvarPrefs({ foco: atual, disciplina: atual.length === 1 ? atual[0] : '__todas__' });
        this._sincronizarFiltroDisc();
        this._planoRefC = null; this._fatias = null;
        this.renderPlanoConteudo();
        if (window.garantirRotulosFocoPlano) garantirRotulosFocoPlano();
        if (!atual.length) { showToast('Foco limpo — o Plano voltou a falar de todas as matérias'); return; }
        showToast(atual.length === 1 ? 'Foco em ' + atual[0] : atual.length + ' matérias em foco — a lista abaixo é só delas');
        if (primeira) requestAnimationFrame(() => {
          const bloco = document.querySelector('#plano-lista .pl-hoje');
          if (bloco) { try { bloco.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { _quiet(e, 'foco-scroll'); } }
        });
      });
    }));""",
    'foco')
s = once(s,
    "      PlanoPontos.setCorte(r2.corte);\n      this.renderPlanoConteudo(); showToast('Corte registrado ✓');",
    "      this._trabalharPlano(defCorte, 'Atualizando…', () => { PlanoPontos.setCorte(r2.corte); this.renderPlanoConteudo(); showToast('Corte registrado ✓'); });",
    'corte')
s = once(s,
    "      DB.deleteExtra(e.id); showToast('Atividade excluída'); this.renderPlanoConteudo();",
    "      this._trabalharPlano(b, 'Excluindo…', () => { DB.deleteExtra(e.id); showToast('Atividade excluída'); this.renderPlanoConteudo(); });",
    'excluir ciclo')
s = once(s,
    """      PlanoEngine.salvarPrefs({ ritmoSemanal: null });
      this._planoRefC = null;
      this.renderPlanoConteudo();
      showToast('Ritmo voltou a seguir a sua medição (' + medido + '/sem)');""",
    """      this._trabalharPlano(ritmoBtn, 'Recalculando…', () => {
        PlanoEngine.salvarPrefs({ ritmoSemanal: null });
        this._planoRefC = null;
        this.renderPlanoConteudo();
        showToast('Ritmo voltou a seguir a sua medição (' + medido + '/sem)');
      });""",
    'ritmo')
s = once(s,
    """      PlanoEngine.salvarPrefs({ foco: [], disciplina: '__todas__' });
      this._sincronizarFiltroDisc();
      this._planoRefC = null; this._fatias = null;
      this.renderPlanoConteudo();
      showToast('Mostrando o número geral, de todas as matérias');""",
    """      this._trabalharPlano(todasBtn, 'Abrindo geral…', () => {
        PlanoEngine.salvarPrefs({ foco: [], disciplina: '__todas__' });
        this._sincronizarFiltroDisc();
        this._planoRefC = null; this._fatias = null;
        this.renderPlanoConteudo();
        showToast('Mostrando o número geral, de todas as matérias');
      });""",
    'todas disciplinas')
s = once(s,
    "      PlanoEngine.salvarPrefs({ custoPorPonto: c.qPorPonto });\n      this.renderPlano(); showToast('Custo calibrado com o seu histórico ✓');",
    "      this._trabalharPlano(calBtn, 'Calibrando…', () => { PlanoEngine.salvarPrefs({ custoPorPonto: c.qPorPonto }); this.renderPlano(); showToast('Custo calibrado com o seu histórico ✓'); });",
    'calibragem')
s = once(s,
    """    if (lote) lote.addEventListener('click', () => {
      let n = 0, sobre = 0;
      lista.querySelectorAll('.pl-hoje-sel:checked:not(:disabled)').forEach(c => {
        const u = this._unidadeDoPlano(c.dataset.topico, c.dataset.disc);
        if (PlanoEngine.atividadeSobreposta(c.dataset.topico, c.dataset.disc, u && u.membros)) { sobre++; return; }
        if (this.criarExtraDoPlano(c.dataset.topico, c.dataset.disc, c.dataset.alvo, 'reforco', true)) n++;
      });
      /* Em série não há como perguntar por item — então o que foi pulado é
         DITO. Pular em silêncio deixaria a pessoa achando que marcou errado. */
      showToast((n ? n + (n === 1 ? ' atividade criada ✓' : ' atividades criadas ✓') : 'Nenhuma atividade nova a criar')
        + (sobre ? ' · ' + sobre + (sobre === 1 ? ' pulado: já dentro de uma atividade aberta' : ' pulados: já dentro de atividades abertas') : ''));
      this.renderPlanoConteudo();
    });""",
    """    if (lote) lote.addEventListener('click', () => {
      this._trabalharPlano(lote, 'Criando atividades…', () => {
        let n = 0, sobre = 0;
        lista.querySelectorAll('.pl-hoje-sel:checked:not(:disabled)').forEach(c => {
          const u = this._unidadeDoPlano(c.dataset.topico, c.dataset.disc);
          if (PlanoEngine.atividadeSobreposta(c.dataset.topico, c.dataset.disc, u && u.membros)) { sobre++; return; }
          if (this.criarExtraDoPlano(c.dataset.topico, c.dataset.disc, c.dataset.alvo, 'reforco', true)) n++;
        });
        showToast((n ? n + (n === 1 ? ' atividade criada ✓' : ' atividades criadas ✓') : 'Nenhuma atividade nova a criar')
          + (sobre ? ' · ' + sobre + (sobre === 1 ? ' pulado: já dentro de uma atividade aberta' : ' pulados: já dentro de atividades abertas') : ''));
        this.renderPlanoConteudo();
      }, true);
    });""",
    'lote plano')
p.write_text(s)
