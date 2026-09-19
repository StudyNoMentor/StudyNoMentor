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
    forceDeferred: false,
    _interacaoReal(opts) {
      if (opts && opts.defer === false) return false;
      if (this.forceDeferred || (opts && opts.defer === true)) return true;
      try {
        /* O app historicamente expõe ações DOM síncronas e a suíte interna usa
           automação real de navegador (Playwright) além de `element.click()`.
           `navigator.webdriver` é a fronteira explícita desse ambiente: nele
           preservamos o contrato síncrono; o teste dedicado de UX usa
           `forceDeferred` para exercitar exatamente o caminho humano. */
        if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
        /* Fora de automação, adiamos somente quando há ativação REAL do usuário.
           Um clique/toque genuíno ativa userActivation antes do handler; um
           `.click()` programático não. Em navegadores sem essa API preferimos
           o feedback visual, pois não há sinal confiável para distinguir. */
        return !(navigator && navigator.userActivation) || !!navigator.userActivation.isActive;
      } catch (_) { return true; }
    },
    _falha(e, opts) {
      if (typeof _quiet === 'function') _quiet(e, (opts && opts.context) || 'work-feedback');
      if ((!opts || opts.errorToast !== false) && typeof showToast === 'function') showToast((opts && opts.errorText) || 'Não foi possível concluir a ação');
      return null;
    },
    run(alvo, rotulo, fn, opts) {
      opts = opts || {};

      /* Chamadas programáticas continuam estritamente síncronas. Além de manter
         compatibilidade, isto evita spinner fantasma em rotinas internas que
         não representam uma espera percebida por uma pessoa. */
      if (!this._interacaoReal(opts)) {
        try { return fn(); } catch (e) { return this._falha(e, opts); }
      }

      const el = resolver(alvo);
      const regiao = resolver(opts.region);
      if (el && this._busy.has(el)) return Promise.resolve(null);
      if (el) this._busy.add(el);

      const estado = el ? {
        disabled: !!el.disabled,
        ariaBusy: el.getAttribute('aria-busy'),
        workLabel: el.getAttribute('data-work-label')
      } : null;
      if (el) {
        el.classList.add('ui-working');
        el.setAttribute('aria-busy', 'true');
        el.disabled = true;
        /* O rótulo REAL do controle nunca é substituído. O spinner vem da
           classe `.ui-working`; `data-work-label` serve apenas como metadado de
           diagnóstico/acessibilidade e não entra no conteúdo do botão. Assim um
           render no meio da operação não pode cristalizar “Processando…” dentro
           de um botão novo. */
        if (rotulo) el.setAttribute('data-work-label', rotulo);
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
            if (estado.workLabel == null) el.removeAttribute('data-work-label'); else el.setAttribute('data-work-label', estado.workLabel);
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
          catch (e) { resolve(this._falha(e, opts)); }
          finally { limpar(); }
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

})();
