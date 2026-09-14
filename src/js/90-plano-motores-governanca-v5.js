/* ============================================================================
   GOVERNANÇA DOS MOTORES DO PLANO V5
   Uma única verdade decide se Simplificado/Robusto podem ser usados ou exibidos.
   Não altera fórmulas dos motores e não toca em atividades históricas.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoMotoresGovernancaV5) return;
  const C = window.PlanoSugestoesV2;
  if (!C || typeof DB === 'undefined') return;
  window.__planoMotoresGovernancaV5 = true;

  const G = {
    VERSAO: 5,
    KEY: 'plano-motores-governanca-v5',
    DEFAULTS: Object.freeze({ simplificado: true, robusto: true }),
    _orig: {},

    _key() { return DB._profilePrefix() + this.KEY; },
    estado() {
      let z = {};
      try { z = JSON.parse(localStorage.getItem(this._key()) || '{}') || {}; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-motores-v5-read'); }
      return {
        simplificado: typeof z.simplificado === 'boolean' ? z.simplificado : true,
        robusto: typeof z.robusto === 'boolean' ? z.robusto : true
      };
    },
    salvar(patch) {
      const atual = this.estado(), p = patch || {}, prox = {
        simplificado: typeof p.simplificado === 'boolean' ? p.simplificado : atual.simplificado,
        robusto: typeof p.robusto === 'boolean' ? p.robusto : atual.robusto
      };
      try {
        const raw = JSON.stringify(prox);
        if (DB.setRaw) DB.setRaw(this._key(), raw); else localStorage.setItem(this._key(), raw);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-motores-v5-save'); }
      try { window.dispatchEvent(new CustomEvent('plano:motores-change', { detail: prox })); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-motores-v5-event'); }
      this.syncVisibility();
      this.renderConfig();
      return prox;
    },
    restaurar() { return this.salvar({ simplificado: true, robusto: true }); },
    ativos() {
      const e = this.estado(), out = [];
      if (e.simplificado) out.push('simplificado');
      if (e.robusto) out.push('robusto');
      if (e.simplificado && e.robusto) out.push('comparar');
      return out;
    },
    resolverModo(preferido) {
      const e = this.estado();
      if (preferido === 'comparar' && e.simplificado && e.robusto) return 'comparar';
      if (preferido === 'simplificado' && e.simplificado) return 'simplificado';
      if (preferido === 'robusto' && e.robusto) return 'robusto';
      if (e.robusto) return 'robusto';
      if (e.simplificado) return 'simplificado';
      return null;
    },
    pode(modo) {
      const e = this.estado();
      if (modo === 'simplificado') return e.simplificado;
      if (modo === 'robusto') return e.robusto;
      if (modo === 'comparar') return e.simplificado && e.robusto;
      return false;
    },
    _erro(modo) { return { erro: modo ? 'motor-desabilitado' : 'motores-desabilitados', modo: modo || null, itens: [] }; },

    syncVisibility() {
      if (typeof document === 'undefined') return;
      const e = this.estado(), algum = e.simplificado || e.robusto;
      const puxar = new Set([
        document.getElementById('extras-plano-btn'),
        ...document.querySelectorAll('[data-puxar-plano],[data-plano-sugestoes],.btn-puxar-plano')
      ]);
      puxar.forEach(el => { if (el) { el.hidden = !algum; el.setAttribute('aria-hidden', algum ? 'false' : 'true'); } });

      const tabPlano = document.querySelector('.tec-subtab[data-tectab="plano"]');
      const painelPlano = document.getElementById('tec-panel-plano');
      if (tabPlano) {
        tabPlano.hidden = !e.robusto;
        tabPlano.setAttribute('aria-hidden', e.robusto ? 'false' : 'true');
        if (!e.robusto && tabPlano.classList.contains('active')) {
          const analise = document.querySelector('.tec-subtab[data-tectab="analise"]');
          if (analise && typeof analise.click === 'function') analise.click();
        }
      }
      if (painelPlano && !e.robusto) painelPlano.style.display = 'none';
    },

    _switchCard(key, titulo, badge, desc, detalhes, ligado) {
      return `<article class="pmg-engine ${ligado ? 'is-on' : 'is-off'}" data-pmg-engine="${key}">
        <div class="pmg-engine-copy">
          <div class="pmg-engine-title"><b>${titulo}</b><span>${badge}</span></div>
          <p>${desc}</p><small>${detalhes}</small>
        </div>
        <label class="pmg-switch" title="${ligado ? 'Desabilitar' : 'Habilitar'} ${titulo}">
          <input type="checkbox" data-pmg-toggle="${key}" ${ligado ? 'checked' : ''} aria-label="${ligado ? 'Desabilitar' : 'Habilitar'} ${titulo}">
          <span aria-hidden="true"></span>
        </label>
      </article>`;
    },
    renderConfig() {
      if (typeof document === 'undefined') return;
      let card = document.getElementById('cfg-plano-motores-card');
      const anchor = document.getElementById('config-subjects-list')?.closest('.card');
      if (!anchor) return;
      if (!card) {
        card = document.createElement('section');
        card.className = 'card pmg-card'; card.id = 'cfg-plano-motores-card';
        anchor.parentNode.insertBefore(card, anchor);
      }
      const e = this.estado(), n = Number(e.simplificado) + Number(e.robusto);
      const status = n === 2
        ? '<b>2 motores ativos</b> · o modo Comparar fica disponível no Puxar do Plano.'
        : n === 1
          ? `<b>1 motor ativo</b> · o Puxar do Plano abrirá direto no ${e.robusto ? 'Robusto' : 'Simplificado'}, sem etapa de escolha.`
          : '<b>Nenhum motor ativo</b> · Puxar do Plano ficará oculto. Reforços e histórico já criados continuam preservados.';
      card.innerHTML = `<div class="card-header pmg-head"><div><h2>🏁 Motores do Plano</h2><p class="sub">Controle quais estratégias de recomendação existem no app. Desligar um motor remove suas entradas do Desempenho TEC e do Puxar do Plano, sem apagar histórico.</p></div><button type="button" class="btn-secondary" data-pmg-reset>↺ Restaurar padrão</button></div>
        <div class="pmg-body">
          <div class="pmg-grid">
            ${this._switchCard('simplificado','⚡ Simplificado','Direto','Prioriza lacunas de forma transparente e auditável.','Pré: seu TEC × meta × amostra. Pós: cruza banca e planejamento.',e.simplificado)}
            ${this._switchCard('robusto','🧠 Robusto','Estratégico','Usa o Plano atual e o Mentor 90+ para decisões de maior profundidade.','Evolução, tempo, incidência, risco, roteador pedagógico e otimização.',e.robusto)}
          </div>
          <div class="pmg-status ${n === 0 ? 'is-warning' : ''}">${status}</div>
        </div>`;
      card.querySelectorAll('[data-pmg-toggle]').forEach(inp => inp.addEventListener('change', () => {
        const k = inp.dataset.pmgToggle, patch = {}; patch[k] = !!inp.checked; const prox = this.salvar(patch);
        if (typeof showToast === 'function') showToast(`${k === 'robusto' ? 'Robusto' : 'Simplificado'} ${prox[k] ? 'habilitado' : 'desabilitado'}`);
      }));
      card.querySelector('[data-pmg-reset]')?.addEventListener('click', () => {
        this.restaurar(); if (typeof showToast === 'function') showToast('Motores do Plano restaurados ✓');
      });
    },

    _selectorHtml(modo) {
      const e = this.estado();
      if (!(e.simplificado && e.robusto)) {
        const k = e.robusto ? 'robusto' : 'simplificado';
        if (!k || (!e.robusto && !e.simplificado)) return '';
        return `<div class="ps-single-engine"><span class="ps-single-ico">${k === 'robusto' ? '🧠' : '⚡'}</span><div><small>Motor ativo</small><b>${k === 'robusto' ? 'Robusto' : 'Simplificado'}</b><span>${k === 'robusto' ? 'Estratégia avançada com Plano + Mentor 90+' : 'Leitura direta do seu histórico TEC'}</span></div></div>`;
      }
      const card = (k, ico, nome, tag, desc) => `<button type="button" class="ps-engine-card ${modo === k ? 'active' : ''}" data-ps-modo="${k}" aria-pressed="${modo === k ? 'true' : 'false'}"><span class="ps-engine-check">✓</span><span class="ps-engine-ico">${ico}</span><span class="ps-engine-copy"><span class="ps-engine-name"><b>${nome}</b><em>${tag}</em></span><small>${desc}</small></span></button>`;
      return `<section class="ps-engine-chooser" aria-label="Como decidir as frentes"><header><div><small>ESTRATÉGIA DE DECISÃO</small><b>Como quer escolher estas 3 frentes?</b></div><span>Você pode trocar antes de criar.</span></header><div class="ps-engine-primary">${card('simplificado','⚡','Simplificado','Direto','Seu histórico TEC com regras transparentes e poucos parâmetros.')}${card('robusto','🧠','Robusto','Estratégico','Plano + Mentor 90+, evolução, tempo e retorno esperado.')}</div><button type="button" class="ps-compare-launch ${modo === 'comparar' ? 'active' : ''}" data-ps-modo="comparar" aria-pressed="${modo === 'comparar' ? 'true' : 'false'}"><span>🔀</span><div><b>Comparar os dois</b><small>Lado a lado, mantendo uma única escolha por disciplina.</small></div><em>${modo === 'comparar' ? 'Selecionado' : 'Abrir comparação'}</em></button></section>`;
    },

    instalarController() {
      if (this._controllerInstalled) return; this._controllerInstalled = true;
      ['prefs','salvar','simplificado','robusto','comparar','calcular','criar','_cabecalho','abrir'].forEach(k => { this._orig[k] = C[k]?.bind(C); });
      const self = this;

      C.prefs = function() {
        const p = self._orig.prefs ? self._orig.prefs() : {};
        const modo = self.resolverModo(p && p.modo);
        return Object.assign({}, p, { modo });
      };
      C.salvar = function(patch) {
        const x = Object.assign({}, patch || {});
        if ('modo' in x) x.modo = self.resolverModo(x.modo);
        const out = self._orig.salvar ? self._orig.salvar(x) : x;
        return Object.assign({}, out, { modo: self.resolverModo(out && out.modo) });
      };
      C.simplificado = function(p) { return self.pode('simplificado') ? self._orig.simplificado(p) : self._erro('simplificado'); };
      C.robusto = function() { return self.pode('robusto') ? self._orig.robusto() : self._erro('robusto'); };
      C.comparar = function(p) { return self.pode('comparar') ? self._orig.comparar(p) : self._erro('comparar'); };
      C.calcular = function(p) {
        const base = Object.assign({}, p || C.prefs()), modo = self.resolverModo(base.modo);
        if (!modo) return self._erro(null);
        base.modo = modo;
        if (modo === 'simplificado') return C.simplificado(base);
        if (modo === 'comparar') return C.comparar(base);
        return C.robusto();
      };
      const erroOrig = C._erroTexto?.bind(C);
      C._erroTexto = function(e) {
        if (e === 'motor-desabilitado') return 'Este motor está desabilitado nas Configurações.';
        if (e === 'motores-desabilitados') return 'Ative Simplificado ou Robusto em Configurações para usar o Puxar do Plano.';
        return erroOrig ? erroOrig(e) : 'Não foi possível formar sugestões.';
      };
      C._cabecalho = function(p, res) {
        p = Object.assign({}, p || C.prefs(), { modo: self.resolverModo(p && p.modo) });
        if (!p.modo) return '<div class="ps-empty"><b>Motores desabilitados</b><span>Ative Simplificado ou Robusto em Configurações.</span></div>';
        const html = self._orig._cabecalho ? self._orig._cabecalho(p, res) : '';
        const semSelector = html.replace(/<div class="ps-mode-grid"[\s\S]*?<\/div>(?=<div class="ps-settings"|<div class="ps-rule"|<div class="rv4-wrap")/, '');
        return self._selectorHtml(p.modo) + semSelector;
      };
      C.criar = function(screen, p, res) {
        const modo = self.resolverModo(p && p.modo);
        if (!modo) { if (typeof showToast === 'function') showToast('Ative um motor do Plano em Configurações.'); return 0; }
        const seguro = Object.assign({}, p || {}, { modo });
        if (!self.pode(modo)) return 0;
        return self._orig.criar(screen, seguro, res);
      };
      C.abrir = function(screen) {
        const p = C.prefs();
        if (!p.modo) { if (typeof showToast === 'function') showToast('Ative Simplificado ou Robusto em Configurações.'); return; }
        let res;
        try { res = C.calcular(p); }
        catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-motores-v5-open'); return; }
        screen._psResultado = res; screen._planoSel = new Set((res.itens || []).map((_,i) => i)); screen._rv4Open = false;
        const ambos = self.pode('comparar'), rot = p.modo === 'comparar' ? 'Comparar motores' : (p.modo === 'robusto' ? 'Robusto' : 'Simplificado');
        const sub = ambos ? 'Escolha a estratégia e confirme apenas as 3 frentes que irão para Extras.' : `${rot} é o único motor ativo; as 3 frentes seguem direto para a fila de Extras.`;
        new Promise(resolve => { UI._resolve = resolve; UI._mode = 'confirm'; UI._open('🏁 Puxar do Plano', sub, '<div id="ps-root"></div>', { okText:'Criar atividades' }); })
          .then(ok => { if (!ok) return; const atual = C.prefs(); return C.criar(screen, atual, screen._psResultado); });
        setTimeout(() => { try { C._renderModal(screen, p, res); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-motores-v5-render'); } }, 0);
      };
    },

    instalarHooks() {
      if (this._hooksInstalled) return; this._hooksInstalled = true;
      const self = this;
      if (typeof ConfigScreen !== 'undefined' && ConfigScreen.render) {
        const f = ConfigScreen.render.bind(ConfigScreen); ConfigScreen.render = function(){ const r=f(); self.renderConfig(); self.syncVisibility(); return r; };
      }
      if (typeof ExtrasScreen !== 'undefined' && ExtrasScreen.render) {
        const f = ExtrasScreen.render.bind(ExtrasScreen); ExtrasScreen.render = function(){ const r=f(); self.syncVisibility(); return r; };
      }
      if (typeof DesempenhoTecScreen !== 'undefined' && DesempenhoTecScreen.render) {
        const f = DesempenhoTecScreen.render.bind(DesempenhoTecScreen); DesempenhoTecScreen.render = function(){ const r=f(); self.syncVisibility(); return r; };
      }
      window.addEventListener('plano:motores-change', () => self.syncVisibility());
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { self.renderConfig(); self.syncVisibility(); }, { once:true });
      else { self.renderConfig(); self.syncVisibility(); }
    },
    instalar() { this.instalarController(); this.instalarHooks(); }
  };

  G.instalar();
  window.PlanoMotoresGovernancaV5 = G;
})();
