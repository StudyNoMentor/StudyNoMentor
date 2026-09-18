/* ============================================================
   EXTRAS — central única de configurações e automações
   Camada de UX: não altera motores de Reforço/Lei Seca.
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__extrasCentralUi) return;
  if (typeof window !== 'undefined') window.__extrasCentralUi = true;
  if (typeof ExtrasScreen === 'undefined') return;

  const esc = (v) => typeof escapeHtml === 'function'
    ? escapeHtml(String(v == null ? '' : v))
    : String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const ExtrasCentral = {
    modal: null,
    tab: 'geral',

    _info(txt) {
      return `<button type="button" class="xsc-info" aria-label="Mais informações" title="${esc(txt)}">i</button>`;
    },
    _status() {
      let reforcos = 0, fechados = 0, lei = { aptas: 0, missoes: 0, prefs: {} };
      try {
        reforcos = typeof ReforcoGovernanca !== 'undefined' ? ReforcoGovernanca.ativos().length : 0;
        fechados = typeof ReforcoGovernanca !== 'undefined' ? ReforcoGovernanca.fechados().length : 0;
      } catch (_) { /* somente resumo */ }
      try {
        if (typeof LeiRodizio !== 'undefined') lei = LeiRodizio.statusHoje();
      } catch (_) { /* somente resumo */ }
      const p = (typeof ReforcoFila !== 'undefined' && ReforcoFila.prefs) ? ReforcoFila.prefs() : { disciplinasDia: 1, blocoMin: 10, blocoMax: 25 };
      return { reforcos, fechados, lei, reforcoPrefs: p };
    },

    garantirBotao() {
      const novo = document.getElementById('extras-new-btn');
      if (!novo || document.getElementById('extras-settings-btn')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-secondary xsc-open';
      btn.id = 'extras-settings-btn';
      btn.innerHTML = '⚙ Configurações';
      btn.title = 'Configurar automações, reforços, lei seca e comportamento das Atividades Extras';
      novo.parentElement.insertBefore(btn, novo.parentElement.firstChild);
      btn.addEventListener('click', () => this.abrir('geral'));
    },

    /* A fita ganha ícone e contador: "Reforços" e "Lei seca" são as duas
       seções que TÊM estado, e saber quantos itens há em cada uma antes de
       entrar é o que evita abrir as quatro para achar o que se procura. */
    _nav() {
      const s = this._status();
      const itens = [
        ['geral', '◎', 'Visão geral', ''],
        ['reforcos', '🎯', 'Reforços', String(s.reforcos)],
        ['lei', '📚', 'Lei seca', String(s.lei.aptas || 0)],
        ['manuais', '✍️', 'Manuais', '']
      ];
      return `
        <nav class="xsc-nav" aria-label="Seções das configurações de Extras">
          ${itens.map(([id, ic, rot, n]) => `<button type="button" data-xsc-tab="${id}" aria-current="${this.tab === id ? 'page' : 'false'}"><span aria-hidden="true">${ic}</span>${esc(rot)}${n ? `<em>${esc(n)}</em>` : ''}</button>`).join('')}
        </nav>`;
    },

    _geral() {
      const s = this._status(), lp = s.lei.prefs || {};
      /* ── O RESUMO TEM DE DIZER SE ALGO ESTÁ ROLANDO HOJE ──────────────────
         A visão geral listava quatro cartões de atalho e três "cenários" de
         configuração, e nenhum deles respondia a pergunta com que se abre
         esta janela: o que a automação vai colocar na minha fila hoje? Com
         "0 ativo(s)" e "1 lei apta", a leitura correta é "nada de reforço,
         uma leitura" — e isso precisava ser somado de dois cartões
         diferentes. A faixa abaixo soma. */
      const leiLigada = lp.ativo !== false;
      const nLei = leiLigada ? Math.min(Number(lp.porDia) || 1, Number(s.lei.aptas) || 0) : 0;
      const hoje = s.reforcos + nLei;
      const estado = hoje === 0
        ? { cls: 'is-off', ic: '💤', rot: 'Nada automático hoje', det: 'Nenhum reforço ativo e nenhuma leitura programada. Tudo o que aparecer em Extras vai ser o que você criar à mão.' }
        : { cls: 'is-on', ic: '⚙️', rot: hoje === 1 ? '1 item automático hoje' : hoje + ' itens automáticos hoje',
            det: [s.reforcos ? s.reforcos + ' reforço(s) de questões' : '', nLei ? nLei + ' leitura(s) de lei seca' : ''].filter(Boolean).join(' + ') + ' — o resto da fila é o que você criar.' };
      return `
        <section class="xsc-section xsc-overview">
          <div class="xsc-section-head"><div><small>RESUMO OPERACIONAL</small><h4>O que está automatizado</h4><p>A tela principal fica só com execução. Ajustes raros ficam concentrados aqui.</p></div></div>
          <div class="xsc-today ${estado.cls}">
            <span class="xsc-today-ic" aria-hidden="true">${estado.ic}</span>
            <div><strong>${esc(estado.rot)}</strong><span>${esc(estado.det)}</span></div>
          </div>
          <div class="xsc-overview-grid">
            <article class="xsc-summary-card">
              <div class="xsc-summary-icon">🎯</div><div><strong>Reforços</strong><span>${s.reforcos} ativo(s)</span><small>Padrão ${s.reforcoPrefs.disciplinasDia || 1}/dia · ${s.reforcoPrefs.blocoMin || 10}–${s.reforcoPrefs.blocoMax || 25} questões</small></div>
              <button type="button" class="btn-secondary" data-xsc-go="reforcos">Configurar</button>
            </article>
            <article class="xsc-summary-card">
              <div class="xsc-summary-icon">📚</div><div><strong>Lei seca</strong><span>${s.lei.aptas || 0} lei(s) apta(s)</span><small>${lp.ativo === false ? 'Rotina pausada' : `${lp.porDia || 1} lei(s)/dia · ${lp.modoCarga === 'tempo' ? `${lp.minutosSessao || 20} min/sessão` : `${lp.linhasSessao || 30} linhas/sessão`}`}</small></div>
              <button type="button" class="btn-secondary" data-xsc-go="lei">Configurar</button>
            </article>
            <article class="xsc-summary-card">
              <div class="xsc-summary-icon">✍️</div><div><strong>Atividades manuais</strong><span>Você decide quando e como</span><small>Anki, leitura, revisão, vídeo e tarefas livres continuam simples e independentes.</small></div>
              <button type="button" class="btn-secondary" data-xsc-go="manuais">Ver opções</button>
            </article>
            <article class="xsc-summary-card">
              <div class="xsc-summary-icon">◷</div><div><strong>Histórico gerenciado</strong><span>${s.fechados} reforço(s) encerrado(s)</span><small>Execução diária, alterações de regra e auditoria ficam fora da rotina principal.</small></div>
              <button type="button" class="btn-secondary" data-xsc-history>Ver histórico</button>
            </article>
          </div>
          <div class="xsc-scenarios">
            <strong>Como pensar a configuração</strong>
            <div><b>Rotina leve</b><span>1 reforço/dia + 1 lei curta. Boa quando o estudo principal já está pesado.</span></div>
            <div><b>Rotina equilibrada</b><span>1–2 reforços compatíveis + 1 lei/dia. Mantém giro sem pulverizar o estudo.</span></div>
            <div><b>Pós-edital</b><span>Use 2 reforços/dia somente nas frentes escolhidas e lei seca por tempo para controlar a carga total.</span></div>
          </div>
        </section>`;
    },

    _reforcos() {
      const s = this._status(), p = s.reforcoPrefs;
      return `
        <section class="xsc-section">
          <div class="xsc-section-head"><div><small>RODÍZIO DE QUESTÕES</small><h4>Reforços automáticos</h4><p>Altere apenas as frentes desejadas. Missões já iniciadas hoje permanecem protegidas.</p></div></div>
          <div class="xsc-kpis"><span><b>${s.reforcos}</b><small>ativos</small></span><span><b>${p.disciplinasDia || 1}</b><small>disciplinas/dia padrão</small></span><span><b>${p.blocoMin || 10}–${p.blocoMax || 25}</b><small>questões por parcela</small></span><span><b>${s.fechados}</b><small>no histórico</small></span></div>
          <div class="xsc-explain">
            <div class="xsc-field help-open"><div class="xsc-label"><b>Disciplinas por dia</b>${this._info('Controla quantas frentes de reforço podem compartilhar o mesmo dia. Uma frente configurada como 1/dia nunca é comprimida junto com outra.')}</div><small class="xsc-help">Use <b>1/dia</b> para maior espaçamento e <b>2/dia</b> quando quiser acelerar o giro entre matérias distintas.</small></div>
            <div class="xsc-field"><div class="xsc-label"><b>Faixa de questões</b>${this._info('É o tamanho das parcelas diárias, não a meta total do tópico. Mudar a faixa não apaga o que já foi feito.')}</div><small class="xsc-help">Ex.: meta global 80 e máximo 20 → o sistema distribui em parcelas compatíveis de até 20.</small></div>
            <div class="xsc-field"><div class="xsc-label"><b>Escopo da mudança</b>${this._info('Você pode aplicar só ao futuro ou também ao dia atual se aquela missão ainda não começou.')}</div><small class="xsc-help">Se já houve progresso hoje, a missão é congelada para impedir perda ou redução abaixo do executado.</small></div>
          </div>
          <div class="xsc-callout"><div><b>Configuração seletiva</b><span>Escolha exatamente quais reforços recebem a regra e veja o impacto antes de confirmar.</span></div><button type="button" class="btn-primary" data-xsc-policy>⚙ Configurar reforços</button></div>
          <button type="button" class="btn-secondary xsc-wide" data-xsc-history>◷ Abrir histórico completo dos reforços</button>
        </section>`;
    },

    _lei() {
      const s = this._status(), p = s.lei.prefs || {};
      const dias = Array.isArray(p.dias) ? p.dias : [0,1,2,3,4,5,6];
      const info = (txt) => this._info(txt);
      return `
        <section class="xsc-section">
          <div class="xsc-section-head"><div><small>RODÍZIO DE LEITURA</small><h4>Lei seca</h4><p>O sistema escolhe entre as leis aptas, retoma do marcador real e cria somente a missão que cabe no dia.</p></div><label class="xsc-master"><input type="checkbox" data-xsc-law-active ${p.ativo !== false ? 'checked' : ''}><span>Rotina ativa</span></label></div>
          <div class="xsc-presets"><span>Sugestões rápidas:</span><button type="button" data-xsc-law-preset="leve">Leve</button><button type="button" data-xsc-law-preset="equilibrado">Equilibrada</button><button type="button" data-xsc-law-preset="intenso">Intensa</button></div>
          <div class="xsc-form-grid">
            <label class="xsc-field"><span class="xsc-label"><b>Leis por dia</b>${info('Número máximo de leis diferentes que o rodízio tenta colocar no mesmo dia.')}</span><select data-xsc-law-day>${[1,2,3,4,5].map(n=>`<option value="${n}" ${(p.porDia||1)===n?'selected':''}>${n}</option>`).join('')}</select><small class="xsc-help">Para a maioria das rotinas, 1 ou 2 preserva melhor a alternância.</small></label>
            <label class="xsc-field"><span class="xsc-label"><b>Meta da sessão</b>${info('Escolha se a missão nasce por quantidade de linhas ou por tempo disponível.')}</span><select data-xsc-law-mode><option value="linhas" ${p.modoCarga!=='tempo'?'selected':''}>Por linhas</option><option value="tempo" ${p.modoCarga==='tempo'?'selected':''}>Por tempo</option></select><small class="xsc-help">Por tempo é útil quando sua agenda varia; por linhas dá uma meta textual fixa.</small></label>
            <label class="xsc-field"><span class="xsc-label"><b>Linhas por sessão</b>${info('Usado diretamente no modo por linhas e como referência quando uma lei não possui ajuste próprio.')}</span><input type="number" min="5" max="300" data-xsc-law-lines value="${Number(p.linhasSessao)||30}"><small class="xsc-help">Ex.: 30 linhas costuma gerar uma leitura curta e objetiva.</small></label>
            <label class="xsc-field"><span class="xsc-label"><b>Minutos por sessão</b>${info('No modo por tempo, o sistema converte os minutos em uma faixa concreta de linhas usando seu ritmo.')}</span><input type="number" min="5" max="180" data-xsc-law-min value="${Number(p.minutosSessao)||20}"><small class="xsc-help">Ex.: 20 min em 1,5 linha/min ≈ 30 linhas.</small></label>
            <label class="xsc-field"><span class="xsc-label"><b>Ritmo de segurança</b>${info('Linhas por minuto usadas quando ainda não há registros suficientes para medir seu ritmo real naquela lei.')}</span><input type="number" step="0.1" min="0.1" max="20" data-xsc-law-pace value="${Number(p.linhasPorMinuto)||1.5}"><small class="xsc-help">Depois que você registra linhas + minutos, o ritmo medido passa a orientar a conversão.</small></label>
            <label class="xsc-field"><span class="xsc-label"><b>Ordem do rodízio</b>${info('Circular favorece espaçamento; prioridade usa a prioridade individual definida em cada lei.')}</span><select data-xsc-law-order><option value="circular" ${p.ordem!=='prioridade'?'selected':''}>Circular · há mais tempo sem ler</option><option value="prioridade" ${p.ordem==='prioridade'?'selected':''}>Prioridade configurada</option></select><small class="xsc-help">Circular é o padrão recomendado para memória e cobertura ampla.</small></label>
            <label class="xsc-field"><span class="xsc-label"><b>Ao terminar uma lei</b>${info('Define o que acontece quando o marcador chega ao final do texto.')}</span><select data-xsc-law-end><option value="pausar" ${p.aoFinal!=='reiniciar'?'selected':''}>Pausar a lei</option><option value="reiniciar" ${p.aoFinal==='reiniciar'?'selected':''}>Reiniciar do início</option></select><small class="xsc-help">Pausar evita ciclos infinitos; reiniciar é útil para leis nucleares que você quer reler continuamente.</small></label>
          </div>
          <div class="xsc-days-wrap"><div class="xsc-label"><b>Dias permitidos</b>${info('A rotina só cria ou redistribui leituras nos dias marcados.')}</div><div class="xsc-days">${['D','S','T','Q','Q','S','S'].map((r,i)=>`<label><input type="checkbox" data-xsc-law-week value="${i}" ${dias.includes(i)?'checked':''}><span>${r}</span></label>`).join('')}</div></div>
          <label class="xsc-check"><input type="checkbox" data-xsc-law-alt ${p.alternarMaterias!==false?'checked':''}><span><b>Alternar matérias quando possível</b><small>Evita duas leis da mesma matéria no mesmo dia quando houver opções elegíveis.</small></span></label>
          <div class="xsc-law-status"><span><b>${s.lei.aptas || 0}</b> lei(s) apta(s)</span><span><b>${s.lei.missoes || 0}</b> missão(ões) hoje</span></div>
          <div class="xsc-foot-actions"><button type="button" class="btn-secondary" data-xsc-law-manage>Gerenciar leis aptas</button><button type="button" class="btn-primary" data-xsc-law-save>Salvar rotina</button></div>
        </section>`;
    },

    _manuais() {
      return `
        <section class="xsc-section">
          <div class="xsc-section-head"><div><small>ATIVIDADES SOB SEU CONTROLE</small><h4>Manuais e recorrentes</h4><p>Não há automação escondida aqui: você escolhe título, tipo, meta, data e recorrência.</p></div></div>
          <div class="xsc-manual-grid">
            <article><b>＋ Avulsa</b><span>Uma tarefa para um dia ou objetivo específico.</span><small>Ex.: assistir uma aula extra ou fazer um simulado curto.</small><button class="btn-secondary" type="button" data-xsc-manual-new>Nova atividade</button></article>
            <article><b>🔁 Recorrente</b><span>Para hábitos que já são previsíveis.</span><small>Ex.: Anki diário ou revisão semanal. Não precisa entrar no motor automático.</small><button class="btn-secondary" type="button" data-xsc-manual-manage>Gerenciar recorrências</button></article>
            <article><b>🃏 Anki</b><span>Mantenha manual/recorrente.</span><small>A recorrência existente já resolve bem o problema sem criar mais um motor de rodízio.</small></article>
          </div>
          <div class="xsc-scenarios"><strong>Regra simples</strong><div><b>Automatize o que precisa decidir sozinho</b><span>Reforços e lei seca.</span></div><div><b>Mantenha manual o que você já sabe quando fazer</b><span>Anki, aulas extras, simulados e compromissos pontuais.</span></div></div>
        </section>`;
    },

    _body() {
      if (this.tab === 'reforcos') return this._reforcos();
      if (this.tab === 'lei') return this._lei();
      if (this.tab === 'manuais') return this._manuais();
      return this._geral();
    },

    /* A fita é repintada junto com o corpo: os contadores que ela mostra
       (reforços ativos, leis aptas) mudam quando se salva a rotina, e uma fita
       montada uma vez só na abertura passaria a mentir a partir do primeiro
       salvamento. */
    _render() {
      if (!this.modal) return;
      this.modal.querySelector('[data-xsc-body]').innerHTML = this._body();
      const nav = this.modal.querySelector('.xsc-nav');
      if (nav) {
        const novo = document.createElement('div');
        novo.innerHTML = this._nav();
        const el = novo.firstElementChild;
        if (el) { nav.replaceWith(el); this._bindNav(el); }
      }
      this.modal.querySelectorAll('[data-xsc-tab]').forEach(b => b.classList.toggle('active', b.dataset.xscTab === this.tab));
      this._bindBody();
    },
    _bindNav(nav) {
      if (!nav) return;
      nav.querySelectorAll('[data-xsc-tab]').forEach(b => b.onclick = () => { this.tab = b.dataset.xscTab; this._render(); });
    },

    _bindInfo(root) {
      root.querySelectorAll('.xsc-info').forEach(b => b.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const field = b.closest('.xsc-field, .xsc-days-wrap');
        if (field) field.classList.toggle('help-open');
      }));
    },

    _bindBody() {
      const root = this.modal;
      this._bindInfo(root);
      root.querySelectorAll('[data-xsc-go]').forEach(b => b.onclick = () => { this.tab = b.dataset.xscGo; this._render(); });
      root.querySelectorAll('[data-xsc-history]').forEach(b => b.onclick = () => {
        this.fechar();
        if (typeof ReforcoGovernanca !== 'undefined') ReforcoGovernanca.abrirHistorico('reforco');
      });
      const pol = root.querySelector('[data-xsc-policy]');
      if (pol) pol.onclick = () => { this.fechar(); if (typeof ReforcoGovernanca !== 'undefined') ReforcoGovernanca.abrirPolitica(); };

      const novo = root.querySelector('[data-xsc-manual-new]');
      if (novo) novo.onclick = () => { this.fechar(); const b=document.getElementById('extras-new-btn'); if(b)b.click(); };
      const man = root.querySelector('[data-xsc-manual-manage]');
      if (man) man.onclick = () => { this.fechar(); const b=document.getElementById('extras-manage-btn'); if(b)b.click(); };

      root.querySelectorAll('[data-xsc-law-preset]').forEach(b => b.onclick = () => {
        const preset = b.dataset.xscLawPreset;
        const set = (q,v) => { const el=root.querySelector(q); if(el)el.value=v; };
        if (preset === 'leve') { set('[data-xsc-law-day]',1); set('[data-xsc-law-mode]','tempo'); set('[data-xsc-law-min]',15); }
        else if (preset === 'intenso') { set('[data-xsc-law-day]',2); set('[data-xsc-law-mode]','tempo'); set('[data-xsc-law-min]',25); }
        else { set('[data-xsc-law-day]',1); set('[data-xsc-law-mode]','tempo'); set('[data-xsc-law-min]',20); }
        root.querySelectorAll('[data-xsc-law-week]').forEach(x => { x.checked = true; });
      });

      const manage = root.querySelector('[data-xsc-law-manage]');
      if (manage) manage.onclick = () => { this.fechar(); if(typeof switchScreen==='function')switchScreen('leis'); };
      const save = root.querySelector('[data-xsc-law-save]');
      if (save) save.onclick = () => {
        if (typeof LeiRodizio === 'undefined') return;
        const dias=[...root.querySelectorAll('[data-xsc-law-week]:checked')].map(x=>Number(x.value));
        if (!dias.length) { showToast('Marque ao menos um dia para a rotina de lei seca'); return; }
        const patch={
          ativo: !!root.querySelector('[data-xsc-law-active]').checked,
          porDia: Number(root.querySelector('[data-xsc-law-day]').value),
          modoCarga: root.querySelector('[data-xsc-law-mode]').value,
          linhasSessao: Number(root.querySelector('[data-xsc-law-lines]').value),
          minutosSessao: Number(root.querySelector('[data-xsc-law-min]').value),
          linhasPorMinuto: Number(root.querySelector('[data-xsc-law-pace]').value),
          ordem: root.querySelector('[data-xsc-law-order]').value,
          aoFinal: root.querySelector('[data-xsc-law-end]').value,
          alternarMaterias: !!root.querySelector('[data-xsc-law-alt]').checked,
          dias
        };
        LeiRodizio.salvarPrefs(patch);
        try { if(typeof LeiRodizioPremium!=='undefined'&&LeiRodizioPremium.rebalancearHoje) LeiRodizioPremium.rebalancearHoje(); } catch(e){ if(typeof _quiet==='function')_quiet(e,'xsc-law-reflow'); }
        showToast('Rotina de lei seca atualizada ✓');
        this._render();
        if (typeof ExtrasScreen.render === 'function') ExtrasScreen.render();
      };
    },

    abrir(tab) {
      if (this.modal) this.fechar();
      this.tab = tab || 'geral';
      const ov = document.createElement('div');
      ov.className = 'xsc-overlay';
      ov.innerHTML = `<div class="xsc-modal" role="dialog" aria-modal="true" aria-label="Configurações de Atividades Extras">
        <header class="xsc-head"><div><small>CENTRAL DE CONFIGURAÇÕES</small><h3>Atividades Extras</h3><p>Automação e parâmetros ficam aqui; a tela principal continua focada no que você precisa fazer.</p></div><button type="button" class="xsc-close" aria-label="Fechar">×</button></header>
        ${this._nav()}<main class="xsc-body" data-xsc-body></main>
      </div>`;
      document.body.appendChild(ov); this.modal = ov;
      ov.querySelector('.xsc-close').onclick = () => this.fechar();
      ov.addEventListener('click', e => { if (e.target === ov) this.fechar(); });
      this._bindNav(ov.querySelector('.xsc-nav'));
      /* Esc fecha: a janela cobre a tela inteira no celular e não havia saída
         pelo teclado — só o × no canto. */
      this._esc = (ev) => { if (ev.key === 'Escape') this.fechar(); };
      document.addEventListener('keydown', this._esc);
      this._render();
    },

    fechar() {
      if (this._esc) { document.removeEventListener('keydown', this._esc); this._esc = null; }
      if (this.modal) this.modal.remove();
      this.modal = null;
    },

    instalar() {
      this.garantirBotao();
      if (typeof LeiRodizio !== 'undefined' && LeiRodizio.decorarExtras && !LeiRodizio._xscWrapped) {
        LeiRodizio._xscWrapped = true;
        const base = LeiRodizio.decorarExtras, self=this;
        LeiRodizio.decorarExtras = function() {
          const r = base.apply(this, arguments);
          document.querySelectorAll('#extras-agenda .lr-panel').forEach(x => x.remove());
          self.garantirBotao();
          return r;
        };
      }
      if (typeof ReforcoGovernanca !== 'undefined' && ReforcoGovernanca.decorarPainel && !ReforcoGovernanca._xscWrapped) {
        ReforcoGovernanca._xscWrapped = true;
        const base = ReforcoGovernanca.decorarPainel, self=this;
        ReforcoGovernanca.decorarPainel = function() {
          const r = base.apply(this, arguments);
          document.querySelectorAll('#extras-agenda .rg-console').forEach(x => x.remove());
          self.garantirBotao();
          return r;
        };
      }
      document.querySelectorAll('#extras-agenda .lr-panel,#extras-agenda .rg-console').forEach(x=>x.remove());
    }
  };

  ExtrasCentral.instalar();
  if (typeof window !== 'undefined') window.ExtrasCentral = ExtrasCentral;
})();
