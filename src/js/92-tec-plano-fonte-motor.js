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
    /* O "i" é deliberadamente um <details>: nasce recolhido, não ocupa espaço
       no ranking e deixa a conta auditável quando o aluno quiser entender por
       que aquele tópico ficou naquela posição. */
    _porqueHtml(c, fonte) {
      if (!c) return '';
      const comp = c.componentes || {};
      const score = fonte === 'robusto' ? n(c.scoreTopico, c.score) : n(c.score);
      const rows = [];
      const add = (rot, val) => { if (val !== null && val !== undefined && val !== '' && Number.isFinite(Number(val))) rows.push([rot, val]); };
      add('Prioridade do tópico', Math.round(score));
      add('Acerto observado', Number.isFinite(Number(c.taxa)) ? fmt(c.taxa, 1) + '%' : null);
      add('Amostra', Math.max(0, Math.round(n(c.qJanela))));
      if (fonte === 'simplificado') {
        add('Lacuna para a meta', Number.isFinite(Number(comp.lacunaPP)) ? fmt(comp.lacunaPP, 1) + ' pp' : null);
        add('Incidência na disciplina', Number.isFinite(Number(comp.incidenciaDiscPct)) ? fmt(comp.incidenciaDiscPct, 1) + '%' : null);
        add('Valor estimado em pontos', Number.isFinite(Number(comp.valorPontos)) ? fmt(comp.valorPontos, 2) : null);
      } else {
        add('Evidência da lacuna', Number.isFinite(Number(comp.evidencia)) ? fmt(comp.evidencia * 100, 0) + '%' : null);
        add('Persistência', Number.isFinite(Number(comp.persistencia)) ? fmt(comp.persistencia * 100, 0) + '%' : (c.histTec && Number.isFinite(Number(c.histTec.persistencia)) ? fmt(c.histTec.persistencia * 100, 0) + '%' : null));
        add('Tendência de risco', Number.isFinite(Number(comp.tendencia)) ? fmt(comp.tendencia * 100, 0) + '%' : null);
        add('Incidência', c.incidencia && Number.isFinite(Number(c.incidencia.valor)) ? Math.round(Number(c.incidencia.valor)) : null);
        add('Confiança da amostra', Number.isFinite(Number(comp.confiancaAmostra)) ? fmt(comp.confiancaAmostra * 100, 0) + '%' : null);
      }
      const linhas = rows.map(([k,v]) => `<span><small>${esc(k)}</small><b>${esc(v)}</b></span>`).join('');
      return `<details class="tpm-why"><summary><i aria-hidden="true">i</i><span>Por que esta posição?</span></summary><div class="tpm-why-body">${c.motivo ? `<p>${esc(c.motivo)}</p>` : ''}<div class="tpm-why-grid">${linhas}</div><small>A posição é recalculada com o retrato, o escopo e as regras do ${fonte === 'robusto' ? 'Robusto' : 'Simplificado'}; não altera seus dados observados.</small></div></details>`;
    },
    _paraCriacao(c, fonte, r) {
      if (!c) return null;
      if (fonte !== 'robusto' || n(c.quantidadeRecomendada, c.alvo) > 0) return c;
      const R = window.PlanoSugestoesRobusto, p = R && R.prefs ? R.prefs() : {};
      const q = Math.max(1, Math.round(n(p.doseBase, 15)));
      return Object.assign({}, c, { modo:'robusto', fase:(r && r.fase) || (R && R.fase ? R.fase() : 'pre'),
        meta:n(c.meta, p.meta || 90), minAmostra:n(c.minAmostra, p.minAmostra || 20), banca:c.banca || p.banca || '__todas__',
        alvo:q, quantidadeRecomendada:q });
    },
    _card(c, i, fonte) {
      const q = this._quantidade(c);
      const tempo = this._tempo(c, fonte);
      const taxa = Number.isFinite(Number(c.taxa)) ? `${fmt(c.taxa, 0)}%` : '—';
      const amostra = Math.max(0, Math.round(n(c.qJanela)));
      const score = Number.isFinite(Number(c.score)) ? Math.round(Number(c.score)) : null;
      return `<article class="tpm-rec" data-tpm-rec data-disciplina="${esc(c.disciplina || '')}"><div class="tpm-rank">${i + 1}</div><div class="tpm-main"><div class="tpm-head"><div><small>${esc(c.disciplina || 'Disciplina')}</small><b>${esc(c.nome || 'Assunto')}</b></div><span class="tpm-score">${score == null ? '' : 'prioridade ' + score + '/100'}</span></div><div class="tpm-metrics"><span><b>${taxa}</b><small>acerto observado</small></span><span><b>${amostra || '—'}</b><small>questões na amostra</small></span><span class="tpm-dose"><b>${q || '—'}</b><small>${fonte === 'robusto' ? 'questões recomendadas' : 'questões por frente'}</small></span><span><b>${esc(tempo.texto)}</b><small>${esc(tempo.detalhe)}</small></span></div>${this._topicos(c, fonte)}<div class="tpm-rec-actions"><button type="button" class="btn-primary tpm-create-extra" data-tpm-create-top="${i}">🎯 Ataque agora</button>${this._porqueHtml(c, fonte)}</div></div></article>`;
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
      return `<article class="tpm-ranking-item${ataque ? ' is-now' : ''}" data-tpm-ranking-item data-disciplina="${esc(c.disciplina || '')}"><div class="tpm-ranking-rank">${i + 1}</div><div class="tpm-ranking-main"><div class="tpm-ranking-head"><div><small>${esc(c.disciplina || 'Disciplina')}</small><b>${esc(c.nome || 'Assunto')}</b></div>${ataque ? '<em>ataque agora</em>' : ''}</div><div class="tpm-ranking-metrics"><span><b>${taxa}</b><small>acerto</small></span><span><b>${amostra || '—'}</b><small>amostra</small></span><span><b>${Math.round(score)}</b><small>prioridade do tópico</small></span>${extras}${robustoExtra}</div><div class="tpm-ranking-actions-row"><button type="button" class="btn-secondary tpm-create-extra" data-tpm-create-rank="${i}">+ Gerar Extra</button>${this._porqueHtml(c, fonte)}</div></div></article>`;
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
      return `<section class="tpm-output" data-tpm-output data-tpm-model="${fonte}"><header><div><small>${ico} ${nome.toUpperCase()} · ${r.fase === 'pos' ? 'PÓS-EDITAL' : 'PRÉ-EDITAL'}</small><strong>Onde atacar agora</strong><p>${esc(this._criterio(fonte, r))}</p></div><span>${itens.length} ${itens.length === 1 ? 'disciplina' : 'disciplinas'}</span></header>${fonte === 'robusto' ? '<div class="tpm-method"><b>O algoritmo para aqui:</b> recomenda alvo, ordem e quantidade. Sua resolução aprofundada — comentários, resumo, lei seca e cards — é seu modus operandi e não entra no score.</div>' : ''}<div class="tpm-recs">${itens.map((c, i) => this._card(c, i, fonte)).join('')}</div>${this._rankingHtml(fonte, r)}<footer><b>Você pode criar a Atividade Extra daqui ou usar Atividades → Puxar do Plano.</b><span>Resultados do TEC são observacionais: outras questões feitas no ciclo podem aparecer no mesmo retrato.</span></footer></section>`;
    },
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
    _bindCriacao(root, fonte, r) {
      if (!root || !r || r.erro || !C || typeof C.criarItem !== 'function') return;
      const top = (r.itens || []).slice().sort((a,b) => fonte === 'robusto' ? n(b.score)-n(a.score) : 0);
      const ranking = this._rankingItems(fonte, r);
      const ligar = (sel, lista) => root.querySelectorAll(sel).forEach(b => b.addEventListener('click', () => {
        const i = Number(sel.indexOf('top') >= 0 ? b.dataset.tpmCreateTop : b.dataset.tpmCreateRank);
        const bruto = lista[i]; if (!bruto) return;
        b.disabled = true; b.setAttribute('aria-busy','true');
        try {
          const candidato = this._paraCriacao(bruto, fonte, r);
          const criado = C.criarItem(candidato, fonte);
          if (criado && criado.ok) {
            this._renderQueued = false;
            this.renderPlano();
          }
        } finally {
          if (document.contains(b)) { b.disabled = false; b.removeAttribute('aria-busy'); }
        }
      }));
      ligar('[data-tpm-create-top]', top);
      ligar('[data-tpm-create-rank]', ranking);
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
        if (out) { lista.prepend(out); this._bindRanking(out, fonte, r); this._bindCriacao(out, fonte, r); }
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
