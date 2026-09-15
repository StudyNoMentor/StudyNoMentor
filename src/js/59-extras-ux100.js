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
        <div class="ux100-config-icon" aria-hidden="true">⚙</div>
        <div class="ux100-config-copy">
          <small>CONTROLE DAS ATIVIDADES</small>
          <strong>Configurações</strong>
          <span>Automação, reforços e lei seca ficam aqui; abaixo você executa o que já foi planejado.</span>
        </div>
        <div class="ux100-config-kpis" aria-label="Resumo das automações">
          <span><b>${s.reforcos}</b> reforço${s.reforcos === 1 ? '' : 's'}</span>
          <span>${esc(rotinaLei)}</span>
        </div>`;

      const settings = document.getElementById('extras-settings-btn');
      if (settings) {
        settings.innerHTML = '⚙ Abrir configurações';
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

    adaptiveEditor(RA) {
      const p = RA.prefs(), o = document.createElement('div');
      o.className = 'ra-overlay';
      const strategyCard = (key,title,sub) => `<button type="button" class="ra-strategy" data-ra-strategy="${key}" aria-pressed="false"><b>${title}</b><span>${sub}</span></button>`;
      const metric = (key,title,sub,min,max,step='1') => `<label class="ra-metric"><span>${title} ${RA.help(sub)}</span><div class="ra-number"><input data-ra="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${p[key]}"></div></label>`;
      o.innerHTML = `<div class="ra-modal ra-ux100" role="dialog" aria-modal="true" aria-label="Configurações do reforço adaptativo">
        <div class="ra-head"><div><small>ATIVIDADES EXTRAS</small><h3>Reforço adaptativo</h3><p>Defina a estratégia, a dose e os pesos usados para transformar lacunas do Plano em reforços executáveis.</p></div><button class="ra-x" type="button" aria-label="Fechar">×</button></div>
        <div class="ra-tabs" role="tablist"><button class="on" data-tab="estrategia" role="tab" aria-selected="true">Estratégia</button><button data-tab="dose" role="tab" aria-selected="false">Dose</button><button data-tab="pre" role="tab" aria-selected="false">Pesos pré</button><button data-tab="pos" role="tab" aria-selected="false">Pesos pós</button></div>
        <div class="ra-body">
          <section data-pane="estrategia">
            <label class="ra-switch ra-switch-hero"><span class="ra-switch-copy"><b>Ativar prescrição adaptativa</b><small>O Plano ajusta os reforços conforme evidência, lacuna e retorno observado.</small></span><input data-ra="ativo" type="checkbox" ${p.ativo?'checked':''}><span class="ra-toggle-ui" aria-hidden="true"></span></label>
            <div class="ra-strategy-block"><div class="ra-block-head"><b>Estratégia de estudo</b><small>Um clique ajusta a régua inteira; nada é gravado até você salvar.</small></div><div class="ra-strategies">${strategyCard('conservadora','Conservadora','Mais evidência, doses menores')}${strategyCard('equilibrada','Equilibrada','Padrão recomendado')}${strategyCard('intensa','Intensa','Mais giro e intervenção')}</div><p class="ra-preset-status" data-ra-strategy-status aria-live="polite"></p></div>
            <label class="ra-phase"><span><b>Fase do plano</b><small>Automática acompanha a fase pré/pós do Plano.</small></span><select data-ra="fase"><option value="auto" ${p.fase==='auto'?'selected':''}>Automática · seguir Plano</option><option value="pre" ${p.fase==='pre'?'selected':''}>Pré-edital</option><option value="pos" ${p.fase==='pos'?'selected':''}>Pós-edital</option></select></label>
            <div class="ra-metric-grid">${metric('diasAteProva','Dias até a prova','No pós, prazo curto aumenta a importância de retorno por questão.',1,730)}${metric('confiancaMeta','Confiança para encerrar','Probabilidade mínima de o domínio real estar na meta ou acima.',60,99.9,'.1')}${metric('confiancaLacuna','Confiança da lacuna','Exige evidência antes de chamar uma taxa baixa de fraqueza real.',60,99.9,'.1')}${metric('margemMedicao','Margem de medição (±pp)','Régua estatística de precisão; não é uma obrigação de volume.',3,25,'.5')}</div>
            <details class="ra-advanced"><summary>Ajuste avançado</summary><div class="ra-metric-grid">${metric('deltaLacuna','Delta da lacuna','Com meta 85 e delta 5, mede a probabilidade de o domínio ser 80% ou menos.',1,20,'.5')}</div></details>
          </section>
          <section data-pane="dose" hidden>
            <div class="ra-block-head"><b>Volume por ciclo</b><small>A dose é o bloco executável agora, não a necessidade total do tópico.</small></div>
            <div class="ra-presets ra-dose-presets"><button type="button" data-preset="conservador" data-ra-dose-preset="leve">Leve</button><button type="button" data-preset="equilibrado" data-ra-dose-preset="padrao">Equilibrada</button><button type="button" data-preset="reta" data-ra-dose-preset="forte">Reta final</button></div>
            <div class="ra-dose-cols"><div><h4>Pré-edital</h4>${RA.doseFields('Pre',p)}</div><div><h4>Pós-edital</h4>${RA.doseFields('Pos',p)}</div></div>
            <div class="ra-grid">${metric('ciclosAprender','Ciclos para aprender resposta','Após ciclos suficientes, o motor aprende se só aumentar volume está rendendo pouco.',1,8)}${metric('ganhoMinimoPP','Ganho mínimo/ciclo (pp)','Abaixo disso, a recomendação tende a priorizar teoria antes de mais volume.',0,20,'.5')}</div>
            <div class="ra-callout"><b>Regra</b><span>Execute a dose, importe o novo retrato e deixe o motor decidir se ainda vale investir no mesmo assunto.</span></div>
          </section>
          <section data-pane="pre" hidden><div class="ra-block-head"><b>Pesos pré-edital</b><small>Cobertura, confirmação da lacuna e construção de base.</small></div>${RA.weightFields('pre',p)}</section>
          <section data-pane="pos" hidden><div class="ra-block-head"><b>Pesos pós-edital</b><small>Pontos recuperáveis por unidade de esforço.</small></div>${RA.weightFields('pos',p)}</section>
        </div>
        <div class="ra-foot"><button class="btn-secondary" data-cancel>Cancelar</button><button class="btn-secondary ra-reset" data-reset>Restaurar padrões</button><span class="ra-spacer"></span><button class="btn-primary" data-save>Salvar e recalcular</button></div>
      </div>`;
      document.body.appendChild(o);

      const close = () => o.remove();
      const setValue = (k,v) => { const el=o.querySelector(`[data-ra="${k}"]`); if(!el)return; if(el.type==='checkbox')el.checked=!!v; else el.value=String(v); };
      const apply = (patch) => Object.entries(patch).forEach(([k,v])=>setValue(k,v));
      const strategies = {
        conservadora:{fase:'auto',diasAteProva:90,confiancaMeta:92,confiancaLacuna:90,margemMedicao:8,deltaLacuna:5,dosePreMin:8,dosePreBase:12,dosePreMax:18,dosePosMin:8,dosePosBase:15,dosePosMax:22},
        equilibrada:{fase:'auto',diasAteProva:60,confiancaMeta:85,confiancaLacuna:85,margemMedicao:10,deltaLacuna:5,dosePreMin:10,dosePreBase:15,dosePreMax:20,dosePosMin:10,dosePosBase:18,dosePosMax:25},
        intensa:{fase:'auto',diasAteProva:45,confiancaMeta:82,confiancaLacuna:80,margemMedicao:12,deltaLacuna:6,dosePreMin:12,dosePreBase:18,dosePreMax:25,dosePosMin:12,dosePosBase:22,dosePosMax:30}
      };
      const dosePresets = {
        leve:{dosePreMin:8,dosePreBase:12,dosePreMax:18,dosePosMin:8,dosePosBase:15,dosePosMax:22},
        padrao:{dosePreMin:10,dosePreBase:15,dosePreMax:20,dosePosMin:10,dosePosBase:18,dosePosMax:25},
        forte:{fase:'pos',diasAteProva:30,dosePosMin:10,dosePosBase:18,dosePosMax:24,confiancaMeta:82}
      };
      const markStrategy = (key) => {
        o.querySelectorAll('[data-ra-strategy]').forEach(b=>{const on=b.dataset.raStrategy===key;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false');});
        const msg=o.querySelector('[data-ra-strategy-status]');if(msg)msg.textContent=`Prévia ${key} aplicada · salve para confirmar.`;
      };
      o.querySelector('.ra-x').onclick=close;
      o.querySelector('[data-cancel]').onclick=close;
      o.onclick=e=>{if(e.target===o)close();};
      o.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
        o.querySelectorAll('[data-tab]').forEach(x=>{const on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-selected',on?'true':'false');});
        o.querySelectorAll('[data-pane]').forEach(x=>x.hidden=x.dataset.pane!==b.dataset.tab);
      });
      o.querySelectorAll('.ra-help').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();b.closest('label')?.classList.toggle('help-open');});
      o.querySelectorAll('[data-ra-strategy]').forEach(b=>b.onclick=()=>{apply(strategies[b.dataset.raStrategy]||strategies.equilibrada);markStrategy(b.dataset.raStrategy);});
      o.querySelectorAll('[data-ra-dose-preset]').forEach(b=>b.onclick=()=>{
        apply(dosePresets[b.dataset.raDosePreset]||dosePresets.padrao);
        o.querySelectorAll('[data-ra-dose-preset]').forEach(x=>x.classList.toggle('active',x===b));
      });
      o.querySelectorAll('[data-ra]').forEach(el=>el.addEventListener('change',()=>{
        if(!el.closest('.ra-strategy'))o.querySelectorAll('[data-ra-strategy]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});
      }));
      const read=()=>{const z={};o.querySelectorAll('[data-ra]').forEach(el=>z[el.dataset.ra]=el.type==='checkbox'?el.checked:(el.dataset.ra==='fase'?el.value:Number(el.value)));return z;};
      o.querySelector('[data-reset]').onclick=()=>{RA.save(RA.DEFAULTS);close();RA.rerender();if(typeof showToast==='function')showToast('Padrões do reforço adaptativo restaurados ✓');};
      o.querySelector('[data-save]').onclick=()=>{RA.save(read());close();RA.rerender();if(typeof showToast==='function')showToast('Prescrição adaptativa atualizada ✓');};

      /* Reconhece o padrão atual sem forçar nenhuma alteração. */
      const atual=Object.keys(strategies).find(k=>Object.entries(strategies[k]).every(([key,v])=>String(p[key])===String(v)));
      if(atual)markStrategy(atual);
    }
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

  if (typeof ReforcoAdaptativo !== 'undefined') {
    const RA = ReforcoAdaptativo;
    const editor = function(){ return ExtrasUx100.adaptiveEditor(this); };
    /* 59-extras-stability encapsula o editor para fechar/reabrir a Central.
       Trocar apenas a base mantém foco, ESC, z-index e retorno de contexto. */
    if (RA._stableConfigBase) RA._stableConfigBase = editor;
    else RA.config = editor;
  }

  if (typeof window !== 'undefined') window.ExtrasUx100 = ExtrasUx100;
  try { ExtrasUx100.aplicarMain(); } catch (_) { /* tela ainda pode não ter renderizado */ }
})();
