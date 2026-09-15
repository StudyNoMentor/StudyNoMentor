/* ============================================================
   DESEMPENHO TEC — auditoria transversal v2
   Escopo fluido, diversidade do próximo bloco e coerência Plano ↔ Extras.
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__tecAuditoria) return;
  if (typeof window !== 'undefined') window.__tecAuditoria = true;
  if (typeof DesempenhoTecScreen === 'undefined' || typeof PlanoEngine === 'undefined') return;

  const DT = DesempenhoTecScreen;
  const PE = PlanoEngine;
  const esc = (v) => typeof escapeHtml === 'function' ? escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const norm = (v) => {
    try { return typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm ? ReforcoEngine.norm(v || '') : String(v || '').trim().toLowerCase(); }
    catch (_) { return String(v || '').trim().toLowerCase(); }
  };

  const TecAuditoria = {
    _scopeTimer: null,
    _scopeRaf: null,
    _renderedScopeKey: null,
    _lastPlanResult: null,
    _poolC: null,
    _observer: null,
    _scopeDelay: 90,

    scopeIds() {
      let snaps = [];
      try { snaps = DB.getTecSnapshots() || []; } catch (_) { return []; }
      if (DT.scopeMode === 'select') {
        const set = DT.selectedSnapIds || new Set();
        return snaps.filter(s => set.has(s.id)).map(s => String(s.id));
      }
      if (DT.scopeMode === 'range') {
        const a = DT.rangeStart, b = DT.rangeEnd;
        return snaps.filter(s => (!a || s.endDate >= a) && (!b || s.startDate <= b)).map(s => String(s.id));
      }
      return snaps.map(s => String(s.id));
    },

    scopeKey() { return this.scopeIds().sort().join('|'); },

    invalidateScopeCaches() {
      DT._scopedC = null;
      DT._planoRefC = null;
      DT._fatias = null;
      PE._agrC = null;
      PE._tecScopeSignature = null;
      PE._indiceC = new WeakMap();
      this._poolC = null;
    },

    busy(on, txt) {
      const screen = document.getElementById('screen-desempenhotec');
      if (!screen) return;
      screen.classList.toggle('tec-v2-busy', !!on);
      screen.setAttribute('aria-busy', on ? 'true' : 'false');
      let bar = screen.querySelector('.tec-v2-scope-status');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'tec-v2-scope-status';
        bar.setAttribute('role', 'status');
        bar.setAttribute('aria-live', 'polite');
        const scope = document.getElementById('tec-scope-toggle');
        const host = scope && (scope.closest('.card') || scope.parentElement);
        if (host) host.insertAdjacentElement('afterend', bar);
        else {
          const cmd = screen.querySelector('.tp-command');
          if (cmd) cmd.insertAdjacentElement('afterend', bar);
        }
      }
      if (bar) {
        bar.textContent = on ? (txt || 'Atualizando o escopo…') : '';
        bar.hidden = !on;
      }
    },

    renderActiveTab() {
      const tab = DT.tecTab || 'analise';
      if (tab === 'plano') DT.renderPlano();
      else if (tab === 'reforco') DT.renderReforco();
      else if (tab === 'incidencia') DT.renderIncidencia();
      else DT.renderAnalysis();
      if (typeof TecPremium !== 'undefined' && TecPremium.atualizarComando) TecPremium.atualizarComando();
    },

    instalarEscopo() {
      const self = this;
      this._renderedScopeKey = this.scopeKey();
      DT.aplicarMudancaEscopo = function() {
        this.savePrefs(this._scopePrefsPatch());
        self.invalidateScopeCaches();
        const snaps = DB.getTecSnapshots();
        this.renderScopeControls(snaps);
        const tab = this.tecTab || 'analise';
        this._tpAnalysisDirty = tab !== 'analise';
        const key = self.scopeKey();

        if (self._scopeTimer) clearTimeout(self._scopeTimer);
        if (self._scopeRaf) cancelAnimationFrame(self._scopeRaf);

        /* Trocar Consolidado por “Selecionar retratos” com TODOS marcados muda
           apenas a forma de escolher o escopo, não os dados. Não recalcula 10 mil
           linhas só para chegar ao mesmo conjunto de retratos. */
        if (key === self._renderedScopeKey) {
          self.busy(false);
          if (typeof TecPremium !== 'undefined' && TecPremium.atualizarComando) TecPremium.atualizarComando();
          return;
        }

        self.busy(true, 'Aplicando filtros sem bloquear a tela…');
        self._scopeTimer = setTimeout(() => {
          self._scopeTimer = null;
          self._scopeRaf = requestAnimationFrame(() => {
            self._scopeRaf = null;
            try {
              self.renderActiveTab();
              self._renderedScopeKey = key;
            } finally {
              self.busy(false);
            }
          });
        }, self._scopeDelay);
      };
      if (!DT._tecV2RenderKeyInstalled) {
        DT._tecV2RenderKeyInstalled = true;
        const baseRender = DT.render;
        DT.render = function() {
          const out = baseRender.apply(this, arguments);
          requestAnimationFrame(() => { self._renderedScopeKey = self.scopeKey(); });
          return out;
        };
      }
    },

    poolAmplo(cfg) {
      const p0 = Object.assign({}, PE.prefs ? PE.prefs() : {}, cfg || {});
      const opts = Object.assign({}, p0, { foco: [], disciplina: '__todas__', limite: Math.max(240, Number(p0.limite) || 0) });
      const key = this.scopeKey() + '|' + JSON.stringify(opts);
      const agora = Date.now();
      if (this._poolC && this._poolC.key === key && agora - this._poolC.t < 4000) return this._poolC.itens;
      let r = null;
      try { r = PE.calcular(DT.scopedSnapshot(), opts); } catch (_) { return []; }
      if (!r || r.erro) return [];
      const vistos = new Set(), itens = [];
      const add = (x, pequena) => {
        if (!x || !x.nome) return;
        const k = norm(x.disciplina) + '|' + norm(x.nome);
        if (vistos.has(k)) return;
        vistos.add(k);
        itens.push(pequena ? Object.assign({}, x, { custoQ: Number(x.custoQ) || Number(x.faltaAmostra) || 1, _diagnostico: true }) : x);
      };
      (r.itens || []).forEach(x => add(x, false));
      (r.pequenas || []).forEach(x => add(x, true));
      this._poolC = { key, t: agora, itens };
      return itens;
    },

    selecionarDiverso(itens, cfg) {
      const p = Object.assign({}, PE.prefs ? PE.prefs() : {}, cfg || {});
      const foco = (Array.isArray(p.foco) ? p.foco : []).map(norm).filter(Boolean);
      const focoSet = new Set(foco);
      let pool = (itens || []).filter(x => x && !x.extraAberta && x.nome);
      if (focoSet.size) pool = pool.filter(x => focoSet.has(norm(x.disciplina || '')));
      if (!pool.length) return [];

      const distintas = [...new Set(pool.map(x => norm(x.disciplina || 'sem disciplina')))];
      const nDiscCfg = Math.max(1, Number(p.sugestoesDisciplinas) || 3);
      const porDisc = Math.max(1, Number(p.sugestoesTopicosDisc) || 1);
      const nDisc = Math.min(focoSet.size || nDiscCfg, nDiscCfg, distintas.length);
      const teto = Math.min(Number(DT.PLANO_BLOCO_MAX) || 5, Math.max(1, nDisc * porDisc));
      const out = [], cont = new Map(), usados = new Set();
      const push = (x) => { if (usados.has(x)) return false; usados.add(x); out.push(x); const d=norm(x.disciplina||'sem disciplina'); cont.set(d,(cont.get(d)||0)+1); return true; };

      // Primeira volta: uma frente de cada disciplina prioritária.
      for (const x of pool) {
        const d = norm(x.disciplina || 'sem disciplina');
        if (cont.has(d)) continue;
        push(x);
        if (out.length >= nDisc || out.length >= teto) break;
      }
      // Segunda volta: respeita o teto por disciplina configurado pelo Plano.
      for (const x of pool) {
        if (out.length >= teto) break;
        const d = norm(x.disciplina || 'sem disciplina');
        if ((cont.get(d) || 0) >= porDisc) continue;
        push(x);
      }
      // Fallback explícito: só repete além do teto por matéria se não houver
      // frentes distintas suficientes para preencher o bloco.
      for (const x of pool) {
        if (out.length >= teto) break;
        push(x);
      }
      return out;
    },

    _chaveItem(x) { return norm(x && x.disciplina) + '|' + norm(x && x.nome); },

    _linhaBloco(x) {
      const taxa = Number.isFinite(Number(x.taxa)) ? Number(x.taxa) : 0;
      const custo = Math.max(1, Math.round(Number(x.custoQ) || Number(x.faltaAmostra) || 1));
      const tom = x.conf && x.conf.tom ? x.conf.tom : (taxa < 60 ? 'bad' : taxa < 80 ? 'warn' : 'good');
      return `<li class="tec-v2-injected">
        <label class="pl-hoje-check">
          <input type="checkbox" class="pl-hoje-sel" checked data-topico="${esc(x.nome)}" data-disc="${esc(x.disciplina || '')}" data-alvo="${custo}">
          <span class="pl-hoje-nome">${esc(x.nome)}</span>
        </label>
        <span class="pl-hoje-num tone-${esc(tom)}">${taxa.toFixed(0)}%</span>
        <span class="pl-hoje-q">${custo}q</span>
      </li>`;
    },

    diversificarBloco(r) {
      const lista = document.querySelector('#plano-lista .pl-hoje-lista');
      if (!lista) return;
      const prefs = PE.prefs();
      const foco = Array.isArray(prefs.foco) ? prefs.foco.filter(Boolean) : [];
      let fonte = (r && Array.isArray(r.itens) && r.itens.length)
        ? r.itens.slice()
        : [...lista.querySelectorAll('.pl-hoje-sel')].map(c => ({ nome:c.dataset.topico, disciplina:c.dataset.disc, custoQ:Number(c.dataset.alvo)||1, extraAberta:c.disabled }));
      const focoSet = new Set(foco.map(norm));
      const alvoDisc = Math.min(focoSet.size || Math.max(1, Number(prefs.sugestoesDisciplinas)||3), Math.max(1, Number(prefs.sugestoesDisciplinas)||3));
      const presentes = new Set(fonte.filter(x => !x.extraAberta && (!focoSet.size || focoSet.has(norm(x.disciplina)))).map(x => norm(x.disciplina))).size;
      if (alvoDisc > 1 && presentes < alvoDisc) {
        const amplo = this.poolAmplo(prefs);
        const vistos = new Set(fonte.map(x => this._chaveItem(x)));
        amplo.forEach(x => { const k=this._chaveItem(x); if (!vistos.has(k)) { vistos.add(k); fonte.push(x); } });
      }
      const escolhidos = this.selecionarDiverso(fonte, prefs);
      if (!escolhidos.length) return;
      const want = new Map(escolhidos.map(x => [this._chaveItem(x), x]));
      const sep = lista.querySelector('.pl-hoje-sep');
      const atuais = new Map();
      lista.querySelectorAll('li').forEach(li => {
        const c = li.querySelector('.pl-hoje-sel');
        if (c) atuais.set(norm(c.dataset.disc)+'|'+norm(c.dataset.topico), li);
      });

      // Se a melhor frente de uma disciplina estava além da fatia visual padrão,
      // traz somente esse item para o bloco; não despeja o restante da lista.
      escolhidos.forEach(x => {
        const k = this._chaveItem(x);
        if (!atuais.has(k) && !x.extraAberta) {
          const tmp = document.createElement('div'); tmp.innerHTML = this._linhaBloco(x);
          const li = tmp.firstElementChild; if (li) { lista.insertBefore(li, sep || lista.firstChild); atuais.set(k, li); }
        }
      });

      const selecionados = [];
      atuais.forEach((li, k) => {
        const c = li.querySelector('.pl-hoje-sel');
        const on = want.has(k) && !c.disabled;
        c.checked = on;
        li.classList.toggle('fora', !on);
        li.classList.toggle('tec-v2-bloco', on);
        if (on) selecionados.push(li);
      });
      let ancora = sep || lista.firstChild;
      selecionados.forEach(li => lista.insertBefore(li, ancora));

      let divisor = lista.querySelector('.pl-hoje-sep');
      if (!divisor) {
        divisor = document.createElement('li'); divisor.className='pl-hoje-sep'; divisor.textContent='depois destes, a fila segue com:';
        selecionados.length ? selecionados[selecionados.length - 1]?.insertAdjacentElement('afterend', divisor) : lista.prepend(divisor);
      }
      // Garante que o separador fique imediatamente depois do bloco.
      if (selecionados.length) selecionados[selecionados.length - 1].insertAdjacentElement('afterend', divisor);

      const discs = new Set(escolhidos.map(x => norm(x.disciplina || 'sem disciplina')));
      const top = lista.closest('.pl-hoje')?.querySelector('.pl-hoje-top span');
      const q = escolhidos.reduce((s,x)=>s+Math.max(1,Math.round(Number(x.custoQ)||Number(x.faltaAmostra)||1)),0);
      if (top) top.innerHTML = `${escolhidos.length} ${escolhidos.length===1?'assunto':'assuntos'} · ${q.toLocaleString('pt-BR')} questões · <b>${discs.size} ${discs.size===1?'disciplina':'disciplinas'}</b> no rodízio`;
      const card = lista.closest('.pl-hoje');
      if (card) {
        card.classList.toggle('tec-v2-multifoco', foco.length > 1 || discs.size > 1);
        let note = card.querySelector('.tec-v2-diversidade');
        if (!note) { note=document.createElement('p');note.className='tec-v2-diversidade';card.querySelector('.pl-hoje-top')?.insertAdjacentElement('afterend',note); }
        if (note) note.textContent = discs.size > 1 ? `Rodízio ativo: uma prioridade por disciplina antes de repetir a mesma frente.` : `Bloco concentrado: não há outra disciplina elegível nesta fatia.`;
      }
      const lote = document.getElementById('plano-lote');
      if (lote) {
        const n = lista.querySelectorAll('.pl-hoje-sel:checked:not(:disabled)').length;
        lote.disabled = n === 0;
        lote.textContent = n===0?'＋ Marque ao menos um assunto':n===1?'＋ Criar a atividade marcada':`＋ Criar as ${n} atividades marcadas`;
      }
    },

    instalarBloco() {
      if (DT._tecV2PlanInstalled) return;
      DT._tecV2PlanInstalled = true;
      const self = this, base = DT.renderPlanoConteudo;
      if (typeof base !== 'function') return;
      DT.renderPlanoConteudo = function() {
        let capturado = null;
        const calc = PE.calcular;
        PE.calcular = function(snaps, opts) {
          let o = opts;
          const p = PE.prefs();
          if (opts && Array.isArray(p.foco) && p.foco.length > 1) {
            o = Object.assign({}, opts, { limite: Math.max(Number(opts.limite)||0, Math.min(100, p.foco.length * 20)) });
          }
          const r = calc.call(this, snaps, o);
          if (r && Array.isArray(r.itens)) capturado = r;
          return r;
        };
        try { return base.apply(this, arguments); }
        finally {
          PE.calcular = calc;
          if (capturado) self._lastPlanResult = capturado;
          requestAnimationFrame(() => self.diversificarBloco(capturado || self._lastPlanResult));
        }
      };
    },

    alinharPuxarPlano() {
      if (typeof ExtrasScreen === 'undefined') return;
      const host = document.getElementById('pl-lista');
      if (!host || host.dataset.tecV2Diversified === '1') return;
      const cand = ExtrasScreen._planoCand || [];
      const sel = ExtrasScreen._planoSel;
      if (!cand.length || !(sel instanceof Set)) return;
      const atual = [...sel].sort((a,b)=>a-b);
      const defaultInicial = atual.length <= 3 && atual.every((v,i)=>v===i);
      if (!defaultInicial) { host.dataset.tecV2Diversified='1'; return; }
      const prefs = PE.prefs();
      let fonte = cand.slice();
      const foco = Array.isArray(prefs.foco) ? prefs.foco.filter(Boolean) : [];
      if (foco.length > 1) {
        const vistos = new Set(fonte.map(x => this._chaveItem(x)));
        this.poolAmplo(prefs).forEach(x => {
          const k=this._chaveItem(x);
          if (!vistos.has(k) && !x.extraAberta) {
            vistos.add(k);
            fonte.push(Object.assign({}, x, { motivo:x._diagnostico?'diagnostico':'reforco', alvo:Number(x.custoQ)||Number(x.faltaAmostra)||1 }));
          }
        });
      }
      const escolhidos = this.selecionarDiverso(fonte, prefs);
      if (!escolhidos.length) return;
      const keys = new Set(escolhidos.map(x => this._chaveItem(x)));
      escolhidos.forEach(x => {
        const k=this._chaveItem(x);
        if (!cand.some(y => this._chaveItem(y)===k)) cand.push(x);
      });
      ExtrasScreen._planoCand = cand;
      ExtrasScreen._planoSel = new Set();
      cand.forEach((x,i)=>{ if(keys.has(this._chaveItem(x))) ExtrasScreen._planoSel.add(i); });
      host.dataset.tecV2Diversified='1';
      if (typeof ExtrasScreen._planoRenderLista === 'function') ExtrasScreen._planoRenderLista();
      if (typeof ExtrasScreen._planoUpdConta === 'function') ExtrasScreen._planoUpdConta();
      const modal = host.closest('#ui-modal,.ui-modal,.modal');
      if (modal) modal.classList.add('tec-v2-puxar-plano');
    },

    instalarPuxarObserver() {
      const self=this;
      this._observer = new MutationObserver(() => self.alinharPuxarPlano());
      this._observer.observe(document.body,{childList:true,subtree:true});
      this.alinharPuxarPlano();
    },

    instalarReaberturaFutura() {
      if (typeof DB !== 'undefined' && typeof DB.extraConcluidaEm === 'function' && !DB.extraConcluidaEm._tecV2GlobalClose) {
        const baseConcluida = DB.extraConcluidaEm;
        const concluidaComFechamento = function(e, dia) {
          if (baseConcluida.call(this, e, dia)) return true;
          if (!e || e.status !== 'concluida' || !e.origemPlano || !e.origemPlano.veredito) return false;
          const ref = String(e.origemPlano.veredito.em || e.updatedAt || '').slice(0, 10);
          return !!ref && ref === String(dia || todayLocal()).slice(0, 10);
        };
        concluidaComFechamento._tecV2GlobalClose = true;
        DB.extraConcluidaEm = concluidaComFechamento;
      }
      if (typeof ExtrasModern === 'undefined' || typeof ExtrasScreen === 'undefined') return;
      if (!ExtrasModern._tecV2CollectBase) {
        ExtrasModern._tecV2CollectBase = ExtrasModern.coletar;
        const self=this;
        ExtrasModern.coletar = function(screen) {
          const c = ExtrasModern._tecV2CollectBase.call(this, screen);
          const hoje = todayLocal(), existentes = new Set((c.proximas||[]).map(e=>`${e.x.id}@${e.day}`));
          for (let i=1;i<=this.janelaProximas;i++) {
            const day=this.addDays(hoje,i);
            screen.occurrencesForDay(day).forEach(x=>{
              const k=`${x.id}@${day}`;
              if (!existentes.has(k) && DB.extraConcluidaEm(x,day)) {
                c.proximas.push({x,day,bucket:'proximas',futureDone:true}); existentes.add(k);
              }
            });
          }
          const concluidas = Array.isArray(c.concluidas) ? c.concluidas : (c.concluidas = []);
          const concluidasIds = new Set(concluidas.map(e=>e.x&&e.x.id).filter(Boolean));
          const inicio = this.addDays(hoje, -(Math.max(1, Number(this.janelaConcluidas)||7) - 1));
          const extras = DB._extrasReadSnapshot || DB.getExtras();
          extras.forEach(x=>{
            if (!x || x.status !== 'concluida' || !x.origemPlano || !x.origemPlano.topico || !x.origemPlano.veredito || concluidasIds.has(x.id)) return;
            let day = String(x.origemPlano.veredito.em || x.updatedAt || hoje).slice(0,10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) day = hoje;
            if (day > hoje) day = hoje;
            if (day < inicio) return;
            concluidas.push({x,day,bucket:'concluidas',globalDone:true});
            concluidasIds.add(x.id);
            c.concluidas7d = (Number(c.concluidas7d)||0) + 1;
          });
          return c;
        };
      }
      if (!document.body.dataset.tecV2FutureReopen) {
        document.body.dataset.tecV2FutureReopen='1';
        document.addEventListener('click',(ev)=>{
          const btn=ev.target.closest && ev.target.closest('#extras-list .exd-check');
          if(!btn)return;
          const card=btn.closest('.exd'); if(!card)return;
          const day=card.dataset.day||'', id=card.dataset.id;
          if(!id || !day || day<=todayLocal())return;
          const x=DB.getExtra(id);
          if(!x || !DB.extraConcluidaEm(x,day))return; // continua proibido concluir o futuro; só reabre estado já concluído.
          ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
          DB.setConcluidaDia(id,day,false);
          ExtrasScreen.render();
          showToast('Atividade futura reaberta ↩');
        },true);
      }
    },

    instalar() {
      this.instalarEscopo();
      this.instalarBloco();
      this.instalarPuxarObserver();
      this.instalarReaberturaFutura();
      document.getElementById('screen-desempenhotec')?.classList.add('tec-audit-v2');
    }
  };

  TecAuditoria.instalar();
  if (typeof window !== 'undefined') {
    window.TecAuditoria = TecAuditoria;
    window.TecPlanDiversity = { selecionar: (itens,cfg) => TecAuditoria.selecionarDiverso(itens,cfg) };
  }
})();
