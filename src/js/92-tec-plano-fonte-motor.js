/* ============================================================================
   DESEMPENHO TEC — FONTE EXPLICITA DAS SUGESTOES
   ----------------------------------------------------------------------------
   Fatos observados (taxa, historico, cobertura) permanecem dados. A camada de
   decisao usa EXCLUSIVAMENTE o motor escolhido no topo do Desempenho TEC.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecPlanoFonteMotor) return;
  const D = (typeof DesempenhoTecScreen !== 'undefined' && DesempenhoTecScreen) || window.DesempenhoTecScreen;
  const C = window.PlanoSugestoes;
  const G = window.PlanoMotoresGovernanca;
  const I = window.PlanoSugestoesInfra;
  if (!D || !C || !G || !I || typeof DB === 'undefined') return;
  window.__tecPlanoFonteMotor = true;

  const esc = I.esc || ((x) => String(x == null ? '' : x));
  const norm = I.norm || ((x) => String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim());
  const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const fmt = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v).toFixed(d).replace('.', ',') : '—';

  const M = {
    KEY: 'tec-plano-fonte-motor',
    LEGACY_KEY: 'tec-plano-fonte-motor-v1',
    DEFAULT: 'robusto',
    RANK_STEP: 10,
    _origPaint: null,
    _origRender: null,
    _rendering: false,
    _renderQueued: false,
    _rankingVisible: Object.create(null),

    _key() { return DB._profilePrefix() + this.KEY; },
    _estado() { return G.estado ? G.estado() : { simplificado: true, robusto: true }; },
    _resolver(preferido) {
      const e = this._estado();
      if (preferido === 'robusto' && e.robusto) return 'robusto';
      if (preferido === 'simplificado' && e.simplificado) return 'simplificado';
      if (e.robusto) return 'robusto';
      if (e.simplificado) return 'simplificado';
      return null;
    },
    fonte() {
      let k = this.DEFAULT;
      try {
        let z = JSON.parse(localStorage.getItem(this._key()) || 'null');
        if (!z) z = JSON.parse(localStorage.getItem(DB._profilePrefix() + this.LEGACY_KEY) || 'null');
        if (z && ['simplificado', 'robusto'].includes(z.fonte)) k = z.fonte;
      } catch (e) {
        if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-read');
      }
      return this._resolver(k);
    },
    salvar(fonte) {
      const k = this._resolver(fonte);
      if (!k) return null;
      try {
        const raw = JSON.stringify({ fonte: k });
        if (DB.setRaw) DB.setRaw(this._key(), raw); else localStorage.setItem(this._key(), raw);
      } catch (e) {
        if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-save');
      }
      try { C.salvar({ modo: k }); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-sync-controller'); }
      return k;
    },
    calcular(fonte) {
      const k = this._resolver(fonte || this.fonte());
      if (!k) return { erro: 'motores-desabilitados', modo: null, itens: [] };
      try { return k === 'simplificado' ? C.simplificado() : C.robusto(); }
      catch (e) {
        if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-calc');
        return { erro: 'falha-' + k, modo: k, itens: [] };
      }
    },
    _criterio(fonte, r) {
      if (fonte === 'simplificado') return r && r.fase === 'pos'
        ? 'Pós-edital: regra direta do Simplificado, usando sua própria incidência/composição configurada.'
        : 'Pré-edital: distância para a meta + amostra mínima, sem sobrepor pai e filho.';
      return r && r.fase === 'pos'
        ? 'Pós-edital: lacuna estatística do TEC + persistência/tendência + incidência + peso manual da disciplina TEC + resposta observacional dos reforços.'
        : 'Pré-edital: todas as disciplinas têm peso 1; prioridade vem de lacuna estatística, evidência, persistência/tendência, incidência e resposta observacional dos reforços.';
    },
    _erroTexto(r, fonte) {
      const e = r && r.erro;
      const map = {
        'sem-retrato': 'Importe um retrato TEC neste escopo antes de calcular.',
        'sem-lacunas': 'Nenhum assunto observado está abaixo da régua deste motor.',
        'sem-candidatos': 'Não há frente elegível sem sobrepor reforços já abertos.',
        'post-pesos-pendentes': 'Robusto Pós-edital: abra ⚙ Motores, selecione as disciplinas canônicas do TEC que pertencem à prova e atribua os pesos.',
        'pos-sem-banca': 'Simplificado Pós precisa de uma banca específica.',
        'pos-sem-planejamento': 'Simplificado Pós precisa da composição da prova.',
        'pos-sem-cruzamento': 'O Simplificado não encontrou cruzamento suficiente.',
        'motor-desabilitado': 'Este motor está desabilitado.',
        'motores-desabilitados': 'Ative ao menos um motor em Configurações.',
        'falha-simplificado': 'Falha ao calcular o Simplificado.',
        'falha-robusto': 'Falha ao calcular o Robusto.'
      };
      return map[e] || `O ${fonte === 'robusto' ? 'Robusto' : 'Simplificado'} não conseguiu formar recomendações neste escopo.`;
    },
    _quantidade(c) {
      if (!c) return null;
      return Math.max(1, Math.round(n(c.quantidadeRecomendada, c.alvo))) || null;
    },
    _tempo(c, fonte) {
      if (fonte === 'simplificado') return { texto: '—', detalhe: 'O Simplificado não modela tempo.' };
      const t = c && c.prescricao && c.prescricao.tempo || {};
      if (t.confiavel && n(t.minutosEstimados) > 0) return {
        texto: `≈ ${Math.round(n(t.minutosEstimados))} min`,
        detalhe: `${fmt(n(t.segundosPorQuestao) / 60, 1)} min/questão · medido em reforços de Extras`
      };
      return { texto: '—', detalhe: 'Sem tempo direto suficiente nos reforços de Extras.' };
    },
    _topicos(c, fonte) {
      if (fonte !== 'robusto' || !Array.isArray(c && c.topicosOrdenados) || c.topicosOrdenados.length < 2) return '';
      return `<details class="tpm-topic-order"><summary>Ordem dos próximos assuntos desta disciplina</summary><ol>${c.topicosOrdenados.slice(1, 6).map(x => `<li><span>${esc(x.nome)}</span><small>${fmt(x.taxa, 0)}% · prioridade ${Math.round(n(x.score))}/100${n(x.incidencia) > 0 ? ' · incid. ' + Math.round(n(x.incidencia)) : ''}</small></li>`).join('')}</ol></details>`;
    },
    _card(c, i, fonte) {
      const q = this._quantidade(c);
      const tempo = this._tempo(c, fonte);
      const taxa = Number.isFinite(Number(c.taxa)) ? `${fmt(c.taxa, 0)}%` : '—';
      const amostra = Math.max(0, Math.round(n(c.qJanela)));
      const score = Number.isFinite(Number(c.score)) ? Math.round(Number(c.score)) : null;
      return `<article class="tpm-rec" data-tpm-rec data-disciplina="${esc(c.disciplina || '')}"><div class="tpm-rank">${i + 1}</div><div class="tpm-main"><div class="tpm-head"><div><small>${esc(c.disciplina || 'Disciplina')}</small><b>${esc(c.nome || 'Assunto')}</b></div><span class="tpm-score">${score == null ? '' : 'prioridade ' + score + '/100'}</span></div><div class="tpm-metrics"><span><b>${taxa}</b><small>acerto observado</small></span><span><b>${amostra || '—'}</b><small>questões na amostra</small></span><span class="tpm-dose"><b>${q || '—'}</b><small>${fonte === 'robusto' ? 'questões recomendadas' : 'questões por frente'}</small></span><span><b>${esc(tempo.texto)}</b><small>${esc(tempo.detalhe)}</small></span></div><p class="tpm-context">${esc(c.motivo || '')}</p>${this._explica(c, fonte)}${this._topicos(c, fonte)}</div></article>`;
    },
    /* ═══ "POR QUE ISSO, AQUI?" TEM DE SER RESPONDÍVEL SEM SAIR DA TELA ═════
       Os cartões mostravam a CONCLUSÃO do motor — "prioridade 87/100" — e o
       motivo em uma frase. Nenhum dos dois diz de onde o 87 saiu, e é essa a
       pergunta de quem vai gastar a semana no assunto: qual métrica pesou,
       quanto ela pesou, e o que mudaria a posição.

       O Robusto compõe o score de seis fatores normalizados (0..1) com pesos
       fixos, renormalizados sobre os fatores que existem naquele assunto — um
       fator sem dado (incidência não importada, sem reforço medido) sai da
       conta em vez de entrar como zero. O explicador mostra exatamente isso:
       cada fator com o seu valor, o seu peso efetivo e a contribuição em
       pontos, mais o ajuste de amostra aplicado no fim. A soma das
       contribuições fecha com o número do cartão — é a mesma aritmética, não
       uma paráfrase.

       Nasce RECOLHIDO de propósito: é auditoria, não leitura diária. */
    PESOS_ROBUSTO: Object.freeze({ lacuna: .30, evidencia: .23, persistencia: .17, tendencia: .08, incidencia: .17, resistencia: .05 }),
    ROTULO_FATOR: Object.freeze({
      lacuna: ['Lacuna até a meta', 'Distância entre o seu acerto e a meta do motor, saturada em 30 pp.'],
      evidencia: ['Evidência da lacuna', 'Probabilidade de a lacuna ser real e não sorte de amostra (posterior Beta).'],
      persistencia: ['Persistência', 'Em quantos dos seus retratos este assunto já apareceu abaixo da meta.'],
      tendencia: ['Tendência', 'Se a taxa vem caindo entre os retratos (risco) ou subindo.'],
      incidencia: ['Incidência da banca', 'Quanto o assunto cai na prova, em escala logarítmica sobre o maior do escopo.'],
      resistencia: ['Resistência ao treino', 'Quanto os seus reforços em Extras renderam por 100 questões aqui.']
    }),
    _explicaRobusto(c) {
      const comp = c && c.componentes;
      if (!comp) return '';
      const pesos = this.PESOS_ROBUSTO;
      const vivos = Object.keys(pesos).filter(k => comp[k] != null);
      if (!vivos.length) return '';
      const den = vivos.reduce((t, k) => t + pesos[k], 0) || 1;
      const conf = n(comp.confiancaAmostra, 1);
      const ajuste = .68 + .32 * conf;
      const puro = vivos.reduce((t, k) => t + pesos[k] * n(comp[k]), 0) / den * 100;
      const linhas = vivos
        .map(k => ({ k, peso: pesos[k] / den, valor: n(comp[k]) }))
        .sort((a, b) => (b.peso * b.valor) - (a.peso * a.valor))
        .map(x => {
          const [rot, ajuda] = this.ROTULO_FATOR[x.k];
          const pontos = x.peso * x.valor * 100 * ajuste;
          return `<li><span class="tpm-why-bar" style="--tpm-why-w:${(x.valor * 100).toFixed(1)}%"></span>`
            + `<b>${esc(rot)}</b><em>${fmt(x.valor * 100, 0)}/100 · peso ${fmt(x.peso * 100, 0)}%</em>`
            + `<strong>+${fmt(pontos, 1)}</strong><small>${esc(ajuda)}</small></li>`;
        }).join('');
      const fora = Object.keys(pesos).filter(k => comp[k] == null)
        .map(k => this.ROTULO_FATOR[k][0]);
      return `<details class="tpm-why"><summary>Por que nesta posição — a conta do Robusto</summary>`
        + `<ol class="tpm-why-list">${linhas}</ol>`
        + `<div class="tpm-why-foot">`
        + `<span><b>${fmt(puro, 1)}</b><small>soma dos fatores</small></span>`
        + `<span><b>×${fmt(ajuste, 2)}</b><small>ajuste de amostra (${fmt(conf * 100, 0)}% da amostra mínima)</small></span>`
        + `<span><b>${fmt(n(c.scoreTopico, puro * ajuste), 1)}</b><small>prioridade do tópico</small></span>`
        + `</div>`
        + (fora.length ? `<p class="tpm-why-nota"><b>Fora da conta:</b> ${esc(fora.join(' · '))} — sem dado para este assunto, então o peso é redistribuído entre os demais em vez de entrar como zero.</p>` : '')
        + (Number.isFinite(Number(c.score)) && Number.isFinite(Number(c.scoreTopico)) && Math.abs(n(c.score) - n(c.scoreTopico)) > .05
          ? `<p class="tpm-why-nota"><b>Prioridade da disciplina (${fmt(c.score, 0)}/100):</b> média dos três melhores tópicos desta disciplina, com pesos 60/25/15${n(c.pesoPost, 1) !== 1 ? `, e o peso manual ${fmt(c.pesoPost, 1)} do Pós-edital` : ''}. É ela que define a ORDEM das disciplinas; a prioridade acima define qual tópico da disciplina vem primeiro.</p>` : '')
        + `</details>`;
    },
    _explicaSimplificado(c) {
      const comp = c && c.componentes;
      if (!comp) return '';
      const item = (rot, val, ajuda) => `<li><b>${esc(rot)}</b><strong>${esc(val)}</strong><small>${esc(ajuda)}</small></li>`;
      let linhas = '';
      if (comp.incidenciaDiscPct != null) {
        linhas = item('Lacuna até a meta', fmt(comp.lacunaPP, 1) + ' pp', 'Quanto falta do seu acerto atual até a meta deste motor.')
          + item('Fatia da incidência', fmt(comp.incidenciaDiscPct, 1) + '%', 'Peso do assunto dentro da incidência da disciplina na banca, sem contar pai e filho duas vezes.')
          + item('Peso da matéria', fmt(comp.pesoMateria, 1) + ' ponto(s)', 'O que a matéria vale na composição da prova que você declarou.')
          + item('Confiança do cruzamento', fmt(n(comp.confiancaCruzamento) * 100, 0) + '%', 'Quão seguro foi casar os nomes do TEC com os da incidência e do edital.')
          + item('Valor em pontos', fmt(comp.valorPontos, 2), 'Produto dos quatro acima — é o número bruto que o motor ordena.');
      } else {
        linhas = item('Lacuna até a meta', fmt(comp.lacunaPP, 1) + ' pp', 'É o critério ÚNICO do Simplificado Pré: nada mais entra na conta.')
          + item('Amostra', Math.round(n(comp.amostra)) + ' questões', 'Usada só como porta de entrada (amostra mínima), não como peso.')
          + item('Acerto observado', fmt(comp.taxa, 0) + '%', 'A taxa medida no escopo de retratos selecionado.');
      }
      return `<details class="tpm-why"><summary>Por que nesta posição — a conta do Simplificado</summary>`
        + `<ol class="tpm-why-list is-plain">${linhas}</ol>`
        + `<div class="tpm-why-foot"><span><b>${fmt(c.score, 0)}/100</b><small>prioridade, normalizada pelo maior valor bruto do escopo</small></span></div>`
        + `<p class="tpm-why-nota"><b>Regra:</b> ${esc((c.auditoria && c.auditoria.formula) || 'lacunaPP')} — leitura direta do TEC, sem estatística de persistência, tendência ou reforços.</p>`
        + `</details>`;
    },
    _explica(c, fonte) {
      try { return fonte === 'robusto' ? this._explicaRobusto(c) : this._explicaSimplificado(c); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tpm-explica'); return ''; }
    },
    /* Um `<details>` dentro de um cartão clicável precisa parar a propagação,
       senão abrir a explicação também dispara o que o cartão faz. */
    _bindExplain(root) {
      if (!root) return;
      root.querySelectorAll('.tpm-why > summary').forEach(sm =>
        sm.addEventListener('click', (e) => e.stopPropagation()));
    },
    _itemKey(c) { return norm(c && c.disciplina) + '\u0001' + norm(c && c.nome); },
    _rankingItems(fonte, r) {
      const todos = Array.isArray(r && r.todos) ? r.todos.slice() : [];
      if (fonte === 'robusto') return todos.sort((a, b) => n(b.scoreTopico, b.score) - n(a.scoreTopico, a.score) || n(a.taxa, 999) - n(b.taxa, 999) || this._itemKey(a).localeCompare(this._itemKey(b), 'pt-BR'));
      return todos.sort((a, b) => n(b.score) - n(a.score) || n(a.taxa, 999) - n(b.taxa, 999) || this._itemKey(a).localeCompare(this._itemKey(b), 'pt-BR'));
    },
    _rankingSignature(fonte, itens) {
      return `${fonte}|${itens.length}|${itens.slice(0, 8).map(x => this._itemKey(x)).join('|')}`;
    },
    _rankingRow(c, i, fonte, ataque) {
      const score = fonte === 'robusto' ? n(c.scoreTopico, c.score) : n(c.score);
      const taxa = Number.isFinite(Number(c.taxa)) ? `${fmt(c.taxa, 0)}%` : '—';
      const amostra = Math.max(0, Math.round(n(c.qJanela)));
      const incidencia = fonte === 'robusto' ? Math.max(0, Math.round(n(c && c.incidencia && c.incidencia.valor))) : null;
      const persist = fonte === 'robusto' && Number.isFinite(Number(c && c.histTec && c.histTec.persistencia)) ? `${Math.round(Number(c.histTec.persistencia) * 100)}%` : null;
      const extras = fonte === 'simplificado' && n(c.alvo) > 0 ? `<span><b>${Math.round(n(c.alvo))}</b><small>questões por frente</small></span>` : '';
      const robustoExtra = fonte === 'robusto' ? `<span><b>${incidencia || '—'}</b><small>incidência</small></span><span><b>${persist || '—'}</b><small>persistência da lacuna</small></span>` : '';
      return `<article class="tpm-ranking-item${ataque ? ' is-now' : ''}" data-tpm-ranking-item data-disciplina="${esc(c.disciplina || '')}"><div class="tpm-ranking-rank">${i + 1}</div><div class="tpm-ranking-main"><div class="tpm-ranking-head"><div><small>${esc(c.disciplina || 'Disciplina')}</small><b>${esc(c.nome || 'Assunto')}</b></div>${ataque ? '<em>ataque agora</em>' : ''}</div><div class="tpm-ranking-metrics"><span><b>${taxa}</b><small>acerto</small></span><span><b>${amostra || '—'}</b><small>amostra</small></span><span><b>${Math.round(score)}</b><small>prioridade do tópico</small></span>${extras}${robustoExtra}</div>${c.motivo ? `<p>${esc(c.motivo)}</p>` : ''}${this._explica(c, fonte)}</div></article>`;
    },
    _rankingHtml(fonte, r) {
      const itens = this._rankingItems(fonte, r);
      if (!itens.length) return '';
      const sig = this._rankingSignature(fonte, itens);
      const step = this.RANK_STEP;
      const aberto = Math.max(step, n(this._rankingVisible[sig], step));
      const visiveis = itens.slice(0, aberto);
      const ataque = new Set((r.itens || []).map(x => this._itemKey(x)));
      const faltam = Math.max(0, itens.length - visiveis.length);
      const controles = faltam || visiveis.length > step
        ? `<div class="tpm-ranking-actions">${faltam ? `<button type="button" data-tpm-rank-more>Mostrar mais ${Math.min(step, faltam)}</button>${faltam > step ? '<button type="button" data-tpm-rank-all>Mostrar todos</button>' : ''}` : ''}${visiveis.length > step ? `<button type="button" data-tpm-rank-reset>Voltar a ${step}</button>` : ''}</div>`
        : '';
      return `<section class="tpm-ranking" data-tpm-ranking data-tpm-ranking-sig="${esc(sig)}"><header><div><small>RANKING COMPLETO DO MOTOR</small><strong>Todas as frentes elegíveis</strong><p>O TOP 3 acima é a força-tarefa atual. Esta fila mantém o restante visível para diagnóstico e planejamento, sem criar uma terceira regra de decisão.</p></div><span>${visiveis.length} de ${itens.length}</span></header><div class="tpm-ranking-list">${visiveis.map((c, i) => this._rankingRow(c, i, fonte, ataque.has(this._itemKey(c)))).join('')}</div>${controles}</section>`;
    },
    _buttons(fonte, compact = false) {
      const e = this._estado();
      const btn = (k, ico, nome, desc) => e[k] ? `<button type="button" data-tpm-source="${k}" class="${fonte === k ? 'active' : ''}" aria-pressed="${fonte === k ? 'true' : 'false'}"><span>${ico}</span><div><b>${nome}</b><small>${desc}</small></div><i>${fonte === k ? 'em uso' : ''}</i></button>` : '';
      return `<div class="tpm-source-grid ${compact ? 'is-entry' : ''}">${btn('simplificado', '⚡', 'Simplificado', 'Regra direta e transparente.')}${btn('robusto', '🧠', 'Robusto', 'TEC + incidência + reforços em Extras.')}</div>`;
    },
    _entryHtml(fonte) {
      const e = this._estado(), ambos = e.simplificado && e.robusto;
      return `<section class="tpm-entry-selector" data-tpm-entry><div><small>MODELO DAS SUGESTÕES</small><strong>${ambos ? 'Escolha como o TEC deve priorizar suas fraquezas' : 'Modelo ativo'}</strong><p>A escolha afeta somente a camada prescritiva. Seus acertos, histórico e métricas observadas continuam iguais.</p></div>${this._buttons(fonte, true)}</section>`;
    },
    _selectorHtml(fonte) {
      const ambos = this._estado().simplificado && this._estado().robusto;
      return `<section class="tpm-selector" data-tpm-selector><header><div><small>FONTE DA DECISÃO</small><strong>${fonte === 'robusto' ? 'Robusto' : 'Simplificado'}</strong></div><span>${ambos ? 'Você pode trocar o modelo sem alterar os dados observados.' : 'Único motor habilitado.'}</span></header>${this._buttons(fonte, false)}<p><b>Separação de responsabilidades:</b> o TEC fornece os fatos; o motor escolhido decide disciplinas, assuntos e quantidade. O Robusto não escolhe seu método de estudo.</p></section>`;
    },

    _panoramaHtml(fonte, r) {
      const e = this._estado(), ambos = e.simplificado && e.robusto;
      const total = Array.isArray(r && r.todos) ? r.todos.length : 0;
      const top = Array.isArray(r && r.itens) ? r.itens.length : 0;
      const nome = fonte === 'robusto' ? 'Robusto' : 'Simplificado';
      const meta = Number(r && r.itens && r.itens[0] && r.itens[0].meta);
      const titulo = ambos ? 'Panorama TEC — dois motores ativos' : 'Panorama TEC + ' + nome;
      const descricao = ambos
        ? 'Os fatos abaixo são comuns. Simplificado e Robusto aplicam regras independentes sobre eles.'
        : (Number.isFinite(meta) ? 'Meta deste motor: ' + fmt(meta, 0) + '%. ' : '') + 'Somente as regras do ' + nome + ' orientam a força-tarefa abaixo.';
      return '<section class="tpm-panorama" data-tpm-panorama><header><div><small>LEITURA DO TEC</small><strong>' + titulo + '</strong><p>' + descricao + '</p></div><span>' + total + ' ' + (total === 1 ? 'frente elegível' : 'frentes elegíveis') + '</span></header><div class="tpm-panorama-metrics"><span><b>' + top + '</b><small>na força-tarefa</small></span><span><b>' + total + '</b><small>na fila completa</small></span><span><b>' + (ambos ? '2' : (Number.isFinite(meta) ? fmt(meta, 0) + '%' : '—')) + '</b><small>' + (ambos ? 'leituras independentes' : 'meta do motor') + '</small></span></div><details><summary>' + (ambos ? 'Ver como cada motor interpreta os fatos' : 'Ver o que este panorama não decide') + '</summary><p>' + (ambos ? 'A comparação apenas mostra as duas saídas. Ela não cria um terceiro motor nem combina scores.' : 'Este painel não usa rota, ritmo, meta ou prognóstico do Plano legado.') + '</p></details></section>';
    },
    _outputHtml(fonte, r) {
      const nome = fonte === 'robusto' ? 'Robusto' : 'Simplificado', ico = fonte === 'robusto' ? '🧠' : '⚡';
      if (!r || r.erro) return `<section class="tpm-output" data-tpm-output data-tpm-model="${fonte}"><header><div><small>${ico} ${nome.toUpperCase()}</small><strong>Recomendação deste modelo</strong></div></header><div class="tpm-empty">${esc(this._erroTexto(r, fonte))}</div></section>`;
      const itens = (r.itens || []).slice().sort((a, b) => fonte === 'robusto' ? n(b.score) - n(a.score) : 0);
      return `<section class="tpm-output" data-tpm-output data-tpm-model="${fonte}"><header><div><small>${ico} ${nome.toUpperCase()} · ${r.fase === 'pos' ? 'PÓS-EDITAL' : 'PRÉ-EDITAL'}</small><strong>Onde atacar agora</strong><p>${esc(this._criterio(fonte, r))}</p></div><span>${itens.length} ${itens.length === 1 ? 'disciplina' : 'disciplinas'}</span></header>${fonte === 'robusto' ? '<div class="tpm-method"><b>O algoritmo para aqui:</b> recomenda alvo, ordem e quantidade. Sua resolução aprofundada — comentários, resumo, lei seca e cards — é seu modus operandi e não entra no score.</div>' : ''}<div class="tpm-recs">${itens.map((c, i) => this._card(c, i, fonte)).join('')}</div>${this._rankingHtml(fonte, r)}<footer><b>Execução em Atividades → Puxar do Plano.</b><span>Resultados do TEC são observacionais: outras questões feitas no ciclo podem aparecer no mesmo retrato.</span></footer></section>`;
    },
    /* ═══ A ROTA MANUAL NÃO PODE DESAPARECER COM A DECISÃO ═════════════════
       O CSS apagava todo filho de `#plano-lista` que não fosse a saída do
       motor. Isso tirava da tela três coisas que EXECUTAM, não decidem: o
       quadro "🎯 Onde atacar primeiro" (onde vive o 🎯 Atacar, único caminho da
       matéria para os assuntos dela), "O seu próximo bloco" (atividades em
       lote) e as linhas de assunto com "+ Atividade". Os botões existiam, com
       ouvinte ligado, invisíveis — daí "o botão de ataque não funciona em
       nenhum lugar e não deixa gerar o extra manualmente".

       Em vez de devolver tudo ao fluxo (o que recria a segunda fonte de
       decisão que essa camada existe para evitar), a rota manual é reagrupada
       aqui: um `<details>` DEPOIS do resultado do motor, recolhido, com um
       rótulo que diz exatamente o que há dentro. A ordem de leitura continua
       sendo motor primeiro; a rota manual fica a um toque.

       `appendChild` MOVE o nó: os ouvintes que `_pintarPlano` acabou de ligar
       em cada botão vão junto. E como `_pintarPlano` reescreve a lista inteira
       a cada repintura, o agrupamento é refeito na sequência, sempre. */
    LEGADO_EXEC: ['.pl-ciclo.pl-tempo', '.pl-hoje', '.pl-item', '.pl-segundo', '.pl-mais', '.pl-ciclo.pl-feito'],
    _agruparRotaManual(lista) {
      if (!lista) return;
      lista.querySelectorAll(':scope > .tpm-legacy-exec').forEach(el => {
        /* Desmonta o agrupamento anterior antes de refazer: sem isto, uma
           repintura aninharia `<details>` dentro de `<details>`. */
        while (el.firstElementChild && el.firstElementChild.tagName !== 'SUMMARY') lista.insertBefore(el.firstElementChild, el);
        el.remove();
      });
      const alvos = Array.from(lista.children).filter(el =>
        !el.matches('[data-tpm-output]') && this.LEGADO_EXEC.some(sel => el.matches(sel)));
      if (!alvos.length) return;
      const box = document.createElement('details');
      box.className = 'tpm-legacy-exec';
      /* O estado fica guardado: quem usa a rota manual toda semana não deve
         reabri-la a cada repintura da tela. */
      box.open = this._legacyOpen === true;
      box.innerHTML = '<summary><span><b>🎯 Rota manual do Plano</b>'
        + '<small>Quadro de matérias com “Atacar”, o próximo bloco em lote e a criação avulsa de atividades.</small>'
        + '</span><i>▾</i></summary>';
      lista.appendChild(box);
      alvos.forEach(el => box.appendChild(el));
      box.addEventListener('toggle', () => { this._legacyOpen = box.open; });
    },
    /* Quem clica em 🎯 Atacar / + focar está DENTRO da rota manual, e a
       repintura que o clique dispara reconstrói o `<details>`. Sem esta marca
       ele voltaria recolhido no meio da ação. */
    _legacyOpen: false,
    _scheduleRender() {
      if (this._renderQueued) return;
      this._renderQueued = true;
      setTimeout(() => {
        this._renderQueued = false;
        if (D.tecTab === 'plano') this.renderPlano();
      }, 0);
    },
    _bindSource(root, fonte) {
      root?.querySelectorAll('[data-tpm-source]').forEach(b => b.addEventListener('click', () => {
        const k = this.salvar(b.dataset.tpmSource);
        if (!k || k === fonte) return;
        if (typeof showToast === 'function') showToast((k === 'robusto' ? 'Robusto' : 'Simplificado') + ' selecionado');
        this.renderEntry();
        this._scheduleRender();
      }));
    },
    _bindRanking(root, fonte, r) {
      const itens = this._rankingItems(fonte, r);
      if (!itens.length) return;
      const sig = this._rankingSignature(fonte, itens), step = this.RANK_STEP;
      const rerender = () => this._scheduleRender();
      const more = root.querySelector('[data-tpm-rank-more]');
      if (more) more.addEventListener('click', () => {
        this._rankingVisible[sig] = Math.min(itens.length, Math.max(step, n(this._rankingVisible[sig], step)) + step);
        rerender();
      });
      const all = root.querySelector('[data-tpm-rank-all]');
      if (all) all.addEventListener('click', () => { this._rankingVisible[sig] = itens.length; rerender(); });
      const reset = root.querySelector('[data-tpm-rank-reset]');
      if (reset) reset.addEventListener('click', () => { this._rankingVisible[sig] = step; rerender(); });
    },
    renderEntry() {
      if (typeof document === 'undefined') return;
      const tabs = document.getElementById('tec-subtabs');
      if (!tabs) return;
      document.querySelectorAll('[data-tpm-entry]').forEach(el => el.remove());
      const fonte = this.fonte();
      if (!fonte) return;
      const box = document.createElement('div');
      box.innerHTML = this._entryHtml(fonte);
      const el = box.firstElementChild;
      if (el) { tabs.parentNode.insertBefore(el, tabs); this._bindSource(el, fonte); }
    },
    renderPlano() {
      if (this._rendering || typeof document === 'undefined') return;
      const proj = document.getElementById('plano-proj'), lista = document.getElementById('plano-lista');
      if (!proj || !lista) return;
      const fonte = this.fonte();
      if (!fonte) {
        lista.classList.remove('tpm-engine-active');
        proj.querySelectorAll('[data-tpm-selector],[data-tpm-panorama]').forEach(el => el.remove());
        proj.querySelectorAll('.pl-hero').forEach(el => { el.hidden = false; });
        lista.querySelectorAll('[data-tpm-output]').forEach(el => el.remove());
        /* Sem motor, o Plano legado É a tela: nada de agrupar a rota manual
           num recolhível, porque aqui ela não é rota alternativa nenhuma. */
        lista.querySelectorAll(':scope > .tpm-legacy-exec').forEach(el => {
          while (el.firstElementChild && el.firstElementChild.tagName !== 'SUMMARY') lista.insertBefore(el.firstElementChild, el);
          el.remove();
        });
        return;
      }
      this._rendering = true;
      try {
        proj.querySelectorAll('.pl-hero').forEach(el => { el.hidden = true; });
        proj.querySelectorAll('[data-tpm-selector],[data-tpm-panorama]').forEach(el => el.remove());
        const s = document.createElement('div');
        s.innerHTML = this._selectorHtml(fonte);
        const sel = s.firstElementChild;
        if (sel) { proj.prepend(sel); this._bindSource(sel, fonte); }
        lista.querySelectorAll('[data-tpm-output]').forEach(el => el.remove());
        const r = this.calcular(fonte), panorama = document.createElement('div'), box = document.createElement('div');
        panorama.innerHTML = this._panoramaHtml(fonte, r);
        const p = panorama.firstElementChild;
        if (p) proj.prepend(p);
        box.innerHTML = this._outputHtml(fonte, r);
        const out = box.firstElementChild;
        if (out) { lista.prepend(out); this._bindRanking(out, fonte, r); this._bindExplain(out); }
        this._agruparRotaManual(lista);
        lista.classList.add('tpm-engine-active');
        proj.querySelectorAll('.pl-hero-sub').forEach(p => {
          if (/^\s*Caminho mais curto:/i.test(p.textContent || '')) p.classList.add('tpm-legacy-decision');
        });
      } finally { this._rendering = false; }
    },
    init() {
      if (!this._origRender && D.render) {
        this._origRender = D.render;
        const self = this;
        D.render = function () {
          const r = self._origRender.apply(this, arguments);
          self.renderEntry();
          if (this.tecTab === 'plano') self._scheduleRender();
          return r;
        };
      }
      if (!this._origPaint && D._pintarPlano) {
        this._origPaint = D._pintarPlano;
        const self = this;
        D._pintarPlano = function () {
          const r = self._origPaint.apply(this, arguments);
          self.renderPlano();
          return r;
        };
      }
      window.addEventListener('plano:motores-change', () => {
        const f = this.fonte();
        if (f) this.salvar(f);
        this.renderEntry();
        this._scheduleRender();
      });
      this.renderEntry();
      if (D.tecTab === 'plano') this._scheduleRender();
    }
  };

  window.TecPlanoFonteMotor = M;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => M.init(), { once: true });
  else M.init();
})();
