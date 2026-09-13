/* ============================================================
   FLUIDEZ DE INTERAÇÃO — feedback antes do trabalho pesado
   Extras + Desempenho TEC / Plano
   ============================================================ */
(() => {
  if (typeof window === 'undefined' || window.WorkFeedback) return;

  const proximoFrame = (fn) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(fn));
    else setTimeout(fn, 0);
  };
  const resolver = (v) => typeof v === 'string' ? document.querySelector(v) : v;

  const WorkFeedback = {
    _busy: new WeakSet(),
    run(alvo, rotulo, fn, opts) {
      opts = opts || {};
      const el = resolver(alvo);
      const regiao = resolver(opts.region);
      if (el && this._busy.has(el)) return Promise.resolve(null);
      if (el) this._busy.add(el);

      const estado = el ? {
        html: el.innerHTML,
        disabled: !!el.disabled,
        ariaBusy: el.getAttribute('aria-busy')
      } : null;
      if (el) {
        el.classList.add('ui-working');
        el.setAttribute('aria-busy', 'true');
        el.disabled = true;
        if (rotulo && /^(BUTTON|A)$/.test(el.tagName)) el.textContent = rotulo;
      }
      if (regiao) {
        regiao.classList.add('ui-work-region');
        regiao.setAttribute('aria-busy', 'true');
      }

      let hud = null;
      if (opts.overlay) {
        hud = document.createElement('div');
        hud.className = 'ui-work-hud';
        hud.setAttribute('role', 'status');
        hud.setAttribute('aria-live', 'polite');
        hud.innerHTML = `<i aria-hidden="true"></i><span>${escapeHtml(rotulo || 'Processando…')}</span>`;
        document.body.appendChild(hud);
      }

      const limpar = () => {
        if (el) {
          this._busy.delete(el);
          if (el.isConnected) {
            el.classList.remove('ui-working');
            if (estado.ariaBusy == null) el.removeAttribute('aria-busy'); else el.setAttribute('aria-busy', estado.ariaBusy);
            el.disabled = estado.disabled;
            if (estado.html != null && /^(BUTTON|A)$/.test(el.tagName)) el.innerHTML = estado.html;
          }
        }
        if (regiao && regiao.isConnected) {
          regiao.classList.remove('ui-work-region');
          regiao.removeAttribute('aria-busy');
        }
        if (hud && hud.isConnected) hud.remove();
      };

      return new Promise(resolve => {
        proximoFrame(async () => {
          try { resolve(await fn()); }
          catch (e) {
            if (typeof _quiet === 'function') _quiet(e, opts.context || 'work-feedback');
            if (opts.errorToast !== false && typeof showToast === 'function') showToast(opts.errorText || 'Não foi possível concluir a ação');
            resolve(null);
          } finally { limpar(); }
        });
      });
    }
  };
  window.WorkFeedback = WorkFeedback;

  /* Reabrir uma atividade do Plano precisa reabrir também o CICLO. O status
     sozinho não basta: `origemPlano.veredito` é o que alimenta histórico,
     calibragem e a governança de ciclo fechado. Mantemos o último veredito em
     campo de auditoria, mas ele deixa de valer enquanto a atividade está aberta. */
  if (typeof DB !== 'undefined' && typeof DB.setConcluidaDia === 'function' && !DB.setConcluidaDia._reopenPlanAware) {
    const anterior = DB.setConcluidaDia;
    const envolvida = function(id, dia, on) {
      const r = anterior.apply(this, arguments);
      if (on) return r;
      try {
        const e = this.getExtra(id);
        if (!e || !e.origemPlano || !e.origemPlano.veredito || this.extraRecorrente(e)) return r;
        const origem = Object.assign({}, e.origemPlano, {
          ultimoVereditoReaberto: e.origemPlano.veredito,
          reabertoEm: new Date().toISOString()
        });
        delete origem.veredito;
        return this.updateExtra(id, { status: 'ativa', origemPlano: origem });
      } catch (err) {
        if (typeof _quiet === 'function') _quiet(err, 'reabrir-ciclo-plano');
        return r;
      }
    };
    envolvida._reopenPlanAware = true;
    DB.setConcluidaDia = envolvida;
  }

  /* O gerenciador sempre mostrou as concluídas, mas só com editar/excluir. A
     ação explícita deixa a reversibilidade descobrível mesmo fora do calendário. */
  if (typeof ExtrasScreen !== 'undefined' && typeof ExtrasScreen.renderManageList === 'function') {
    const renderManage = ExtrasScreen.renderManageList;
    ExtrasScreen.renderManageList = function() {
      const ret = renderManage.apply(this, arguments);
      const host = document.getElementById('extras-manage-list');
      if (!host) return ret;
      host.querySelectorAll('.exm-row[data-id]').forEach(row => {
        const e = DB.getExtra(row.dataset.id);
        if (!e || DB.extraRecorrente(e) || e.status !== 'concluida') return;
        const acts = row.querySelector('.exm-acts');
        if (!acts || acts.querySelector('.exm-reopen')) return;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'icon-btn exm-reopen'; b.title = 'Reabrir atividade';
        b.setAttribute('aria-label', 'Reabrir atividade'); b.textContent = '↩';
        acts.insertBefore(b, acts.firstChild);
        b.addEventListener('click', () => WorkFeedback.run(b, '↩', () => {
          DB.setConcluidaDia(e.id, todayLocal(), false);
          this.render();
          showToast('Atividade reaberta ↩');
        }, { region: '#extras-manage-modal', context: 'extras-reabrir-manage' }));
      });
      return ret;
    };
  }

  /* Defesa visual: o template já escreve “+ focar”/“✓ em foco”. Esta camada
     transforma isso em invariante de UI; nenhuma decoração posterior pode
     deixar um botão de foco sem rótulo, cor legível ou nome acessível. */
  const garantirRotulosFoco = () => {
    if (typeof PlanoEngine === 'undefined') return;
    let foco = null;
    try { foco = PlanoEngine.focoSet(PlanoEngine.prefs()); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'foco-rotulo'); }
    document.querySelectorAll('#tec-panel-plano .pl-foco-bt').forEach(b => {
      const nome = b.dataset.foco || '';
      const ligado = !!(nome && foco && PlanoEngine.noFoco(nome, foco));
      const txt = ligado ? '✓ em foco' : '+ focar';
      if (!String(b.textContent || '').trim()) b.textContent = txt;
      b.setAttribute('aria-pressed', ligado ? 'true' : 'false');
      b.setAttribute('aria-label', (ligado ? 'Tirar do foco: ' : 'Adicionar ao foco: ') + nome);
    });
  };
  window.garantirRotulosFocoPlano = garantirRotulosFoco;

  if (typeof DesempenhoTecScreen !== 'undefined' && typeof DesempenhoTecScreen.renderPlanoConteudo === 'function') {
    const renderConteudo = DesempenhoTecScreen.renderPlanoConteudo;
    DesempenhoTecScreen.renderPlanoConteudo = function() {
      const ret = renderConteudo.apply(this, arguments);
      garantirRotulosFoco();
      return ret;
    };
  }
})();
