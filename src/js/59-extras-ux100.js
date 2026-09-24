/* ============================================================
   EXTRAS — auditoria UX 100 camadas
   Hierarquia, densidade e interações sem alterar os motores.
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__extrasUx100) return;
  if (typeof window !== 'undefined') window.__extrasUx100 = true;
  if (typeof document === 'undefined') return;

  const esc = (v) => typeof escapeHtml === 'function'
    ? escapeHtml(String(v == null ? '' : v))
    : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const ExtrasUx100 = {
    _status() {
      let reforcos = 0, lei = { aptas: 0, missoes: 0, prefs: {} };
      try { reforcos = typeof ReforcoGovernanca !== 'undefined' ? ReforcoGovernanca.ativos().length : 0; } catch (_) { /* resumo */ }
      try { if (typeof LeiRodizio !== 'undefined') lei = LeiRodizio.statusHoje(); } catch (_) { /* resumo */ }
      return { reforcos, lei };
    },

    reorganizar() {
      const screen = document.getElementById('screen-extras');
      if (!screen) return;
      const header = screen.querySelector('.page-header');
      const toolbar = screen.querySelector('.extras-toolbar');
      const resumo = document.getElementById('extras-summary');
      const curso = document.getElementById('extras-curso');
      const agenda = document.getElementById('extras-agenda');
      const lista = document.getElementById('extras-list');

      /* Hierarquia operacional aprovada:
         1. configurar a automação; 2. gerir ciclos longos; 3. executar o dia. */
      if (header && toolbar && header.nextElementSibling !== toolbar) header.insertAdjacentElement('afterend', toolbar);
      if (toolbar && curso && toolbar.nextElementSibling !== curso) toolbar.insertAdjacentElement('afterend', curso);
      if (curso && resumo && resumo.style.display !== 'none' && curso.nextElementSibling !== resumo) curso.insertAdjacentElement('afterend', resumo);
      const ancoraAgenda = resumo && resumo.style.display !== 'none' ? resumo : curso;
      if (ancoraAgenda && agenda && ancoraAgenda.nextElementSibling !== agenda) ancoraAgenda.insertAdjacentElement('afterend', agenda);
      if (agenda && lista && agenda.nextElementSibling !== lista) agenda.insertAdjacentElement('afterend', lista);
      if (toolbar) toolbar.classList.add('exm-toolbar', 'ux100-config-card');
    },

    decorarConfiguracoes() {
      const screen = document.getElementById('screen-extras');
      const toolbar = screen && screen.querySelector('.extras-toolbar');
      if (!toolbar) return;
      let head = toolbar.querySelector('.ux100-config-head');
      if (!head) {
        head = document.createElement('div');
        head.className = 'ux100-config-head';
        toolbar.prepend(head);
      }
      const s = this._status(), lp = s.lei.prefs || {};
      const rotinaLei = lp.ativo === false ? 'Lei seca pausada' : `${s.lei.aptas || 0} lei(s) apta(s)`;
      head.innerHTML = `
        <div class="ux100-config-icon" aria-hidden="true">🔁</div>
        <div class="ux100-config-copy">
          <small>ROTINA AUTOMÁTICA</small>
          <strong>Reforços e lei seca</strong>
          <span>O que o app agenda sozinho. Ajuste em ⚙ Configurações; abaixo fica só a execução do dia.</span>
        </div>
        <div class="ux100-config-kpis" aria-label="Resumo das automações">
          <span><b>${s.reforcos}</b> reforço${s.reforcos === 1 ? '' : 's'}</span>
          <span>${esc(rotinaLei)}</span>
        </div>`;

      const settings = document.getElementById('extras-settings-btn');
      if (settings) {
        /* "Abrir configurações" era o rótulo mais longo da fileira, e era ele
           que fazia os cinco botões não caberem numa linha só. O cartão ao
           lado já diz "Configurações" em destaque; o verbo era redundante. */
        settings.innerHTML = '⚙ Configurações';
        settings.setAttribute('aria-label', 'Abrir configurações de Atividades Extras');
      }
      const subtitle = screen && screen.querySelector('.page-subtitle');
      if (subtitle) subtitle.textContent = 'Reforços, lei seca e atividades complementares organizados em uma rotina única e objetiva.';
    },

    compactarAgenda() {
      const host = document.getElementById('extras-agenda');
      if (!host) return;
      const card = host.querySelector('.cal-card');
      if (!card) return;
      card.classList.add('ux100-day-card');
      const h2 = card.querySelector('.card-header h2');
      const sub = card.querySelector('.card-header .sub');
      if (h2) h2.textContent = 'Extras de hoje';
      if (sub) sub.textContent = 'Execute as missões do dia. Ajustes de automação ficam concentrados em Configurações.';
      /* A Central já oferece estes parâmetros. Duplicá-los na execução tornava
         o topo longo e criava duas portas para a mesma regra. */
      card.querySelectorAll('.exm-rotation,.exm-load').forEach(x => x.remove());
      const filtro = card.querySelector('#ex-filters-btn');
      if (filtro) filtro.textContent = '⏱️ Filtros';
    },

    compactarCards() {
      document.querySelectorAll('#extras-list .exd.exm-task').forEach(card => {
        card.classList.add('ux100-task');
        const actions = card.querySelector('.exd-actions');
        if (actions) actions.setAttribute('aria-label', 'Ações da atividade');
        const edit = card.querySelector('.exd-edit');
        const del = card.querySelector('.exd-delete');
        if (edit) edit.setAttribute('title', 'Editar atividade');
        if (del) del.setAttribute('title', 'Excluir atividade');
      });
      document.querySelectorAll('#extras-list .lr-extra-card').forEach(card => card.classList.add('ux100-law-task'));
    },

    aplicarMain() {
      this.reorganizar();
      this.decorarConfiguracoes();
      this.compactarAgenda();
      this.compactarCards();
    },

    leiMarkup(ctx) {
      const s = ctx._status(), p = s.lei.prefs || {};
      const dias = Array.isArray(p.dias) ? p.dias : [0,1,2,3,4,5,6];
      const info = (t) => ctx._info(t);
      const modo = p.modoCarga === 'tempo' ? 'tempo' : 'linhas';
      return `
        <section class="xsc-section xsc-law-compact">
          <div class="xsc-law-hero">
            <div class="xsc-law-hero-icon" aria-hidden="true">📚</div>
            <div class="xsc-law-hero-copy"><small>RODÍZIO DE LEITURA</small><h4>Lei seca</h4><p>Escolhe entre as leis aptas, retoma o marcador real e gera apenas a leitura que cabe no dia.</p></div>
            <label class="xsc-master xsc-master-card"><input type="checkbox" data-xsc-law-active ${p.ativo !== false ? 'checked' : ''}><span><b>Rotina ativa</b><small>${s.lei.aptas || 0} lei(s) apta(s) · ${s.lei.missoes || 0} missão(ões) hoje</small></span></label>
          </div>

          <div class="xsc-presets xsc-presets-card" role="group" aria-label="Sugestões rápidas de lei seca">
            <div><b>Sugestões rápidas</b><small>Aplique uma base e personalize se precisar.</small></div>
            <button type="button" data-xsc-law-preset="leve" aria-pressed="false">Leve</button>
            <button type="button" data-xsc-law-preset="equilibrado" aria-pressed="false">Equilibrada</button>
            <button type="button" data-xsc-law-preset="intenso" aria-pressed="false">Intensa</button>
            <span class="xsc-preset-feedback" data-xsc-law-feedback aria-live="polite"></span>
          </div>

          <section class="xsc-setting-group">
            <header><span class="xsc-group-icon">▤</span><div><b>Volume e tempo da sessão</b><small>Quanto ler e como medir cada sessão.</small></div></header>
            <div class="xsc-compact-grid">
              <label class="xsc-field"><span class="xsc-label"><b>Leis por dia</b>${info('Número máximo de leis diferentes que o rodízio tenta colocar no mesmo dia.')}</span><select data-xsc-law-day>${[1,2,3,4,5].map(n=>`<option value="${n}" ${(p.porDia||1)===n?'selected':''}>${n}</option>`).join('')}</select><small class="xsc-help">1 ou 2 costuma preservar melhor a alternância.</small></label>
              <label class="xsc-field"><span class="xsc-label"><b>Meta da sessão</b>${info('Escolha se a missão nasce por quantidade de linhas ou por tempo disponível.')}</span><select data-xsc-law-mode><option value="linhas" ${modo==='linhas'?'selected':''}>Por linhas</option><option value="tempo" ${modo==='tempo'?'selected':''}>Por tempo</option></select><small class="xsc-help">Trocar o modo não apaga os valores do outro modo.</small></label>
              <label class="xsc-field" data-xsc-mode-field="linhas"><span class="xsc-label"><b>Linhas por sessão</b>${info('Meta textual usada diretamente no modo por linhas.')}</span><input type="number" min="5" max="300" data-xsc-law-lines value="${Number(p.linhasSessao)||30}"><small class="xsc-help">30 linhas é uma leitura curta e objetiva.</small></label>
              <label class="xsc-field" data-xsc-mode-field="tempo"><span class="xsc-label"><b>Minutos por sessão</b>${info('No modo por tempo, converte o tempo em uma faixa concreta de linhas.')}</span><input type="number" min="5" max="180" data-xsc-law-min value="${Number(p.minutosSessao)||20}"><small class="xsc-help">20 minutos costuma caber bem entre blocos de questões.</small></label>
              <label class="xsc-field xsc-field-wide"><span class="xsc-label"><b>Ritmo de segurança</b>${info('Linhas por minuto usadas enquanto ainda não há registros suficientes para medir seu ritmo real.')}</span><input type="number" step="0.1" min="0.1" max="20" data-xsc-law-pace value="${Number(p.linhasPorMinuto)||1.5}"><small class="xsc-help">O ritmo observado passa a orientar a conversão quando houver dados suficientes.</small></label>
            </div>
          </section>

          <section class="xsc-setting-group">
            <header><span class="xsc-group-icon">↻</span><div><b>Sequência e comportamento</b><small>Como escolher a próxima lei e o que fazer ao final.</small></div></header>
            <div class="xsc-compact-grid">
              <label class="xsc-field"><span class="xsc-label"><b>Ordem do rodízio</b>${info('Circular favorece espaçamento; prioridade usa a prioridade individual de cada lei.')}</span><select data-xsc-law-order><option value="circular" ${p.ordem!=='prioridade'?'selected':''}>Circular · há mais tempo sem ler</option><option value="prioridade" ${p.ordem==='prioridade'?'selected':''}>Prioridade configurada</option></select><small class="xsc-help">Circular é o padrão recomendado para cobertura ampla.</small></label>
              <label class="xsc-field"><span class="xsc-label"><b>Ao terminar uma lei</b>${info('Define o que acontece quando o marcador chega ao final do texto.')}</span><select data-xsc-law-end><option value="pausar" ${p.aoFinal!=='reiniciar'?'selected':''}>Pausar a lei</option><option value="reiniciar" ${p.aoFinal==='reiniciar'?'selected':''}>Reiniciar do início</option></select><small class="xsc-help">Pausar evita ciclos infinitos; reiniciar serve para textos nucleares.</small></label>
            </div>
          </section>

          <section class="xsc-setting-group xsc-days-group">
            <header><span class="xsc-group-icon">▣</span><div><b>Dias e variações</b><small>Quando gerar as missões e como alternar matérias.</small></div></header>
            <div class="xsc-days-wrap"><div class="xsc-label"><b>Dias permitidos</b>${info('A rotina só cria ou redistribui leituras nos dias marcados.')}</div><div class="xsc-days">${['D','S','T','Q','Q','S','S'].map((r,i)=>`<label><input type="checkbox" data-xsc-law-week value="${i}" ${dias.includes(i)?'checked':''}><span title="${['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][i]}">${r}</span></label>`).join('')}</div></div>
            <label class="xsc-check"><input type="checkbox" data-xsc-law-alt ${p.alternarMaterias!==false?'checked':''}><span><b>Alternar matérias quando possível</b><small>Evita duas leis da mesma matéria no mesmo dia quando houver opções elegíveis.</small></span></label>
          </section>

          <div class="xsc-law-footer">
            <div class="xsc-law-status"><span><b>${s.lei.aptas || 0}</b> lei(s) apta(s)</span><span><b>${s.lei.missoes || 0}</b> missão(ões) hoje</span></div>
            <div class="xsc-foot-actions"><button type="button" class="btn-secondary" data-xsc-law-manage>Gerenciar leis aptas</button><button type="button" class="btn-primary" data-xsc-law-save>Salvar rotina</button></div>
          </div>
        </section>`;
    },

    atualizarModoLei(root) {
      const mode = root && root.querySelector('[data-xsc-law-mode]')?.value || 'linhas';
      root?.querySelectorAll('[data-xsc-mode-field]').forEach(el => {
        const active = el.dataset.xscModeField === mode;
        el.classList.toggle('is-secondary-mode', !active);
        el.setAttribute('aria-disabled', active ? 'false' : 'true');
      });
    },

    bindCentral(central) {
      const root = central && central.modal;
      if (!root) return;
      const mode = root.querySelector('[data-xsc-law-mode]');
      if (mode) {
        this.atualizarModoLei(root);
        mode.addEventListener('change', () => {
          this.atualizarModoLei(root);
          root.querySelectorAll('[data-xsc-law-preset]').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed','false'); });
        });
      }
      const feedback = root.querySelector('[data-xsc-law-feedback]');
      const presets = {
        leve: { day:1, mode:'tempo', min:15, lines:20, pace:1.5 },
        equilibrado: { day:1, mode:'tempo', min:20, lines:30, pace:1.5 },
        intenso: { day:2, mode:'tempo', min:25, lines:40, pace:1.8 }
      };
      const set = (q,v) => { const el=root.querySelector(q); if(el)el.value=String(v); };
      root.querySelectorAll('[data-xsc-law-preset]').forEach(b => {
        b.onclick = () => {
          const p = presets[b.dataset.xscLawPreset] || presets.equilibrado;
          set('[data-xsc-law-day]',p.day); set('[data-xsc-law-mode]',p.mode); set('[data-xsc-law-min]',p.min); set('[data-xsc-law-lines]',p.lines); set('[data-xsc-law-pace]',p.pace);
          root.querySelectorAll('[data-xsc-law-week]').forEach(x => { x.checked = true; });
          root.querySelectorAll('[data-xsc-law-preset]').forEach(x => { const on=x===b; x.classList.toggle('active',on); x.setAttribute('aria-pressed',on?'true':'false'); });
          if(feedback)feedback.textContent='Prévia aplicada · salve para confirmar';
          this.atualizarModoLei(root);
        };
      });
    },
  };

  if (typeof ExtrasModern !== 'undefined') {
    ExtrasModern.reorganizar = function(){ ExtrasUx100.reorganizar(); };
    if (!ExtrasModern._ux100ApplyBase) {
      ExtrasModern._ux100ApplyBase = ExtrasModern.aplicar;
      ExtrasModern.aplicar = function(screen) {
        const r = ExtrasModern._ux100ApplyBase.call(this, screen);
        ExtrasUx100.aplicarMain();
        return r;
      };
    }
  }

  if (typeof ExtrasCentral !== 'undefined') {
    ExtrasCentral._lei = function(){ return ExtrasUx100.leiMarkup(this); };
    if (!ExtrasCentral._ux100BindBase) {
      ExtrasCentral._ux100BindBase = ExtrasCentral._bindBody;
      ExtrasCentral._bindBody = function(){
        ExtrasCentral._ux100BindBase.call(this);
        ExtrasUx100.bindCentral(this);
      };
    }
    if (!ExtrasCentral._ux100InstallBase) {
      ExtrasCentral._ux100InstallBase = ExtrasCentral.instalar;
      ExtrasCentral.instalar = function(){ const r=ExtrasCentral._ux100InstallBase.call(this); ExtrasUx100.aplicarMain(); return r; };
    }
  }

  if (typeof window !== 'undefined') window.ExtrasUx100 = ExtrasUx100;
  try { ExtrasUx100.aplicarMain(); } catch (_) { /* tela ainda pode não ter renderizado */ }
})();
