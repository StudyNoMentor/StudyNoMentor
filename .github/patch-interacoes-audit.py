from pathlib import Path


def once(s, old, new, nome):
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{nome}: esperava 1 ocorrência, achei {n}')
    return s.replace(old, new, 1)

# ---------------------------------------------------------------------------
# 1) WorkFeedback: feedback visual NUNCA reescreve o conteúdo semântico do
# botão. Isso elimina a corrida em que "Processando…" sobrevivia ao render.
# ---------------------------------------------------------------------------
p = Path('src/js/59-interaction-feedback.js')
s = p.read_text()
s = once(s,
"""      const estado = el ? {
        html: el.innerHTML,
        disabled: !!el.disabled,
        ariaBusy: el.getAttribute('aria-busy')
      } : null;""",
"""      const estado = el ? {
        disabled: !!el.disabled,
        ariaBusy: el.getAttribute('aria-busy'),
        workLabel: el.getAttribute('data-work-label')
      } : null;""",
'feedback estado')
s = once(s,
"""        if (rotulo && /^(BUTTON|A)$/.test(el.tagName)) el.textContent = rotulo;""",
"""        /* O rótulo REAL do controle nunca é substituído. O spinner vem da
           classe `.ui-working`; `data-work-label` serve apenas como metadado de
           diagnóstico/acessibilidade e não entra no conteúdo do botão. Assim um
           render no meio da operação não pode cristalizar “Processando…” dentro
           de um botão novo. */
        if (rotulo) el.setAttribute('data-work-label', rotulo);""",
'feedback nao troca texto')
s = once(s,
"""            if (estado.ariaBusy == null) el.removeAttribute('aria-busy'); else el.setAttribute('aria-busy', estado.ariaBusy);
            el.disabled = estado.disabled;
            if (estado.html != null && /^(BUTTON|A)$/.test(el.tagName)) el.innerHTML = estado.html;""",
"""            if (estado.ariaBusy == null) el.removeAttribute('aria-busy'); else el.setAttribute('aria-busy', estado.ariaBusy);
            el.disabled = estado.disabled;
            if (estado.workLabel == null) el.removeAttribute('data-work-label'); else el.setAttribute('data-work-label', estado.workLabel);""",
'feedback limpeza')
p.write_text(s)

# ---------------------------------------------------------------------------
# 2) CSS: spinner compacto no checkbox de conclusão, sem salto de layout; efeito
# de toque/foco consistente nas duas telas; nunca dependemos de trocar o texto.
# ---------------------------------------------------------------------------
p = Path('src/css/17-interaction-feedback.css')
s = p.read_text()
extra = r'''

/* Auditoria de interação: feedback sem mutar rótulos e sem salto de layout. */
#screen-extras button:not(:disabled),#screen-desempenhotec button:not(:disabled){-webkit-tap-highlight-color:transparent}
#screen-extras button:not(:disabled):active,#screen-desempenhotec button:not(:disabled):active{opacity:.78}
#screen-extras button:focus-visible,#screen-desempenhotec button:focus-visible{outline:2px solid color-mix(in srgb,var(--accent) 72%,white);outline-offset:2px}
.exd-check.ui-working{min-width:0;overflow:hidden}
.exd-check.ui-working::before{position:absolute;left:50%;top:50%;width:15px;height:15px;min-width:15px;margin:0;transform:translate(-50%,-50%);z-index:2;animation:ui-work-spin-center .7s linear infinite}
.exd-check.ui-working>svg,.exd-check.ui-working>.exd-check-lbl{opacity:.18}
@keyframes ui-work-spin-center{to{transform:translate(-50%,-50%) rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.exd-check.ui-working::before{animation-duration:1.6s}}
'''
if 'ui-work-spin-center' not in s:
    s += extra
p.write_text(s)

# ---------------------------------------------------------------------------
# 3) Extras: reutiliza o cache curto do Plano em repinturas sucessivas e põe
# feedback antes de ações que alteram dados e redesenham toda a tela.
# ---------------------------------------------------------------------------
p = Path('src/js/47-tela-extras.js')
s = p.read_text()
s = once(s,
"""    let itens = [];
    try { itens = PlanoCiclo.emCurso(this._planoRefCard || (this._planoRefCard =
      PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs()))); }
    catch (e) { _quiet(e, 'curso'); }""",
"""    let itens = [];
    try {
      /* Repinturas encadeadas (registrar → concluir → reabrir) não precisam
         recalcular a mesma fotografia do TEC a cada clique. O cache curto do
         próprio Desempenho TEC já é a régua usada pela criação em lote e é
         invalidado quando o escopo muda. */
      const refPlano = (typeof DesempenhoTecScreen !== 'undefined' && typeof DesempenhoTecScreen._planoRef === 'function')
        ? DesempenhoTecScreen._planoRef()
        : PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs());
      itens = PlanoCiclo.emCurso(this._planoRefCard || (this._planoRefCard = refPlano));
    }
    catch (e) { _quiet(e, 'curso'); }""",
'extras cache plano')
s = once(s,
"""    host.querySelectorAll('[data-curso-dia]').forEach(b => b.addEventListener('click', () => {
      DB.toggleExtraData(b.dataset.cursoDia, todayLocal());
      this.selDay = todayLocal(); showToast('Marcada para hoje ✓'); this.render();
    }));
    host.querySelectorAll('[data-curso-fim]').forEach(b => b.addEventListener('click', () => {
      DB.setConcluidaDia(b.dataset.cursoFim, todayLocal(), true);
      showToast('Concluída ✓'); this.render();
    }));
    host.querySelectorAll('[data-curso-del]').forEach(b => b.addEventListener('click', async () => {
      const e = DB.getExtras().find(x => x.id === b.dataset.cursoDel);
      if (!e) return;
      if (!await UI.confirm('Excluir "' + e.titulo + '"?', { title: 'Excluir atividade', okText: 'Excluir', danger: true })) return;
      DB.deleteExtra(e.id); showToast('Atividade excluída'); this.render();
    }));""",
"""    host.querySelectorAll('[data-curso-dia]').forEach(b => b.addEventListener('click', () => {
      const executar = () => {
        DB.toggleExtraData(b.dataset.cursoDia, todayLocal());
        this.selDay = todayLocal(); showToast('Marcada para hoje ✓'); this.render();
      };
      if (window.WorkFeedback) WorkFeedback.run(b, 'Organizando…', executar, { region: '#extras-curso', context: 'extras-curso-hoje' });
      else executar();
    }));
    host.querySelectorAll('[data-curso-fim]').forEach(b => b.addEventListener('click', () => {
      const executar = () => {
        DB.setConcluidaDia(b.dataset.cursoFim, todayLocal(), true);
        showToast('Concluída ✓'); this.render();
      };
      if (window.WorkFeedback) WorkFeedback.run(b, 'Concluindo…', executar, { region: '#extras-curso', context: 'extras-curso-concluir' });
      else executar();
    }));
    host.querySelectorAll('[data-curso-del]').forEach(b => b.addEventListener('click', async () => {
      const e = DB.getExtras().find(x => x.id === b.dataset.cursoDel);
      if (!e) return;
      if (!await UI.confirm('Excluir "' + e.titulo + '"?', { title: 'Excluir atividade', okText: 'Excluir', danger: true })) return;
      const executar = () => { DB.deleteExtra(e.id); showToast('Atividade excluída'); this.render(); };
      if (window.WorkFeedback) WorkFeedback.run(b, 'Excluindo…', executar, { region: '#extras-curso', context: 'extras-curso-excluir' });
      else executar();
    }));""",
'extras acoes curso')
s = once(s,
"""      if (regBtn) regBtn.addEventListener('click', () => {
        const qEl = card.querySelector('.exd-qtd');
        const acEl = card.querySelector('.exd-ac');
        const q = qEl ? qEl.value : '';
        if (!q || parseFloat(q) <= 0) { showToast('Informe um valor válido'); return; }
        if (acEl && acEl.value !== '' && parseFloat(acEl.value) > parseFloat(q)) { showToast('Acertos não podem passar do total'); return; }
        if (day > todayLocal()) { showToast('Não dá para registrar em data futura'); return; }
        DB.addExtraProgress(id, q, 0, { data: day, acertos: acEl ? acEl.value : null });
        this._addMoreFor = null;
        this.render();
        showToast(day === todayLocal() ? 'Registrado ✓' : 'Registrado em ' + formatDateShort(day) + ' ✓');
      });""",
"""      if (regBtn) regBtn.addEventListener('click', () => {
        const qEl = card.querySelector('.exd-qtd');
        const acEl = card.querySelector('.exd-ac');
        const q = qEl ? qEl.value : '';
        if (!q || parseFloat(q) <= 0) { showToast('Informe um valor válido'); return; }
        if (acEl && acEl.value !== '' && parseFloat(acEl.value) > parseFloat(q)) { showToast('Acertos não podem passar do total'); return; }
        if (day > todayLocal()) { showToast('Não dá para registrar em data futura'); return; }
        const executar = () => {
          DB.addExtraProgress(id, q, 0, { data: day, acertos: acEl ? acEl.value : null });
          this._addMoreFor = null;
          this.render();
          showToast(day === todayLocal() ? 'Registrado ✓' : 'Registrado em ' + formatDateShort(day) + ' ✓');
        };
        if (window.WorkFeedback) WorkFeedback.run(regBtn, 'Registrando…', executar, { region: '#extras-list', context: 'extras-registro' });
        else executar();
      });""",
'extras registrar')
p.write_text(s)

# ---------------------------------------------------------------------------
# 4) Plano TEC: os dois caminhos que ainda redesenhavam/trocavam de tela sem a
# camada de feedback passam pelo mesmo contrato.
# ---------------------------------------------------------------------------
p = Path('src/js/51-tela-desempenho-tec.js')
s = p.read_text()
s = once(s,
"""    lista.querySelectorAll('.plano-nova-extra').forEach(b => b.addEventListener('click', () => {
      this._confirmarSobreposicao(b.dataset.topico, b.dataset.disc).then(ok => {
        if (ok) this.criarExtraDoPlano(b.dataset.topico, b.dataset.disc, b.dataset.alvo, b.dataset.motivo);
      });
    }));""",
"""    lista.querySelectorAll('.plano-nova-extra').forEach(b => b.addEventListener('click', () => {
      this._confirmarSobreposicao(b.dataset.topico, b.dataset.disc).then(ok => {
        if (!ok) return;
        this._trabalharPlano(b, 'Criando atividade…', () =>
          this.criarExtraDoPlano(b.dataset.topico, b.dataset.disc, b.dataset.alvo, b.dataset.motivo));
      });
    }));""",
'plano nova atividade')
s = once(s,
"""    const irExtras = document.getElementById('plano-ir-extras');
    if (irExtras) irExtras.addEventListener('click', () => switchScreen('extras'));""",
"""    const irExtras = document.getElementById('plano-ir-extras');
    if (irExtras) irExtras.addEventListener('click', () => {
      if (window.WorkFeedback) WorkFeedback.run(irExtras, 'Abrindo atividades…', () => switchScreen('extras'), { overlay: true, region: '#tec-panel-plano', context: 'plano-ir-extras' });
      else switchScreen('extras');
    });""",
'plano ir extras')
p.write_text(s)

# ---------------------------------------------------------------------------
# 5) Teste de regressão: rótulo não pode virar Processando/Carregando e todo
# controle visível nas duas superfícies precisa conservar nome acessível.
# ---------------------------------------------------------------------------
p = Path('testes/extras-tec-interacoes-browser.mjs')
s = p.read_text()
s = once(s,
"""async function esperarLivre(){await page.waitForFunction(()=>!document.querySelector('.ui-work-hud,.ui-working'),null,{timeout:10000});}
""",
"""async function esperarLivre(){await page.waitForFunction(()=>!document.querySelector('.ui-work-hud,.ui-working'),null,{timeout:10000});}
async function auditarControles(root,label){
  const r=await page.evaluate(sel=>{
    const host=document.querySelector(sel);if(!host)return{ausente:true,vazios:[],stale:[],overflow:0};
    const vis=e=>{const cs=getComputedStyle(e),b=e.getBoundingClientRect();return cs.display!=='none'&&cs.visibility!=='hidden'&&b.width>0&&b.height>0};
    const botoes=[...host.querySelectorAll('button,[role="button"]')].filter(vis);
    return{
      ausente:false,
      vazios:botoes.filter(b=>!String(b.textContent||'').trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('title')).map(b=>b.id||b.className||b.outerHTML.slice(0,80)),
      stale:botoes.filter(b=>!b.classList.contains('ui-working')&&/^(processando|carregando|filtrando|recalculando|criando|concluindo|registrando|abrindo)/i.test(String(b.textContent||'').trim())).map(b=>(b.textContent||'').trim()),
      overflow:Math.max(0,host.scrollWidth-host.clientWidth)
    };
  },root);
  assert.equal(r.ausente,false,`${label}: raiz ausente`);
  assert.deepEqual(r.vazios,[],`${label}: botão visível sem nome acessível`);
  assert.deepEqual(r.stale,[],`${label}: rótulo transitório ficou preso`);
  assert.ok(r.overflow<=4,`${label}: overflow horizontal ${r.overflow}px`);
}
""",
'helper auditoria controles')
marker = """  // Extras → Puxar do Plano: feedback precisa pintar ANTES do cálculo.
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
"""
insert = """  // Regressão do bug relatado: concluir/reabrir não pode trocar o nome do
  // botão por “Processando…” nem deixar estado transitório preso no card novo.
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
  const rotulo=await page.evaluate(()=>{
    const e=DB.addExtra({titulo:'Extra de rótulo estável',tipo:'livre',alvo:1,periodo:'unica'});
    ExtrasScreen.render();
    const b=document.querySelector(`.exd[data-id="${e.id}"] .exd-check`),t=performance.now();
    const antes=(b.textContent||'').trim();b.click();
    return{id:e.id,antes,imediato:(b.textContent||'').trim(),sync:performance.now()-t,busy:b.classList.contains('ui-working')};
  });
  assert.equal(rotulo.antes,'Concluir','atividade nova deve começar em Concluir');
  assert.equal(rotulo.imediato,'Concluir','feedback não pode substituir o rótulo por Processando');
  assert.ok(rotulo.sync<100,`concluir bloqueou o clique por ${rotulo.sync.toFixed(0)}ms`);
  assert.equal(rotulo.busy,true,'concluir deve sinalizar processamento sem reescrever o rótulo');
  await esperarLivre();
  const aposConcluir=await page.evaluate(id=>{const b=document.querySelector(`.exd[data-id="${id}"] .exd-check`);return{txt:(b?.textContent||'').trim(),busy:!!b?.classList.contains('ui-working'),status:DB.getExtra(id)?.status};},rotulo.id);
  assert.equal(aposConcluir.txt,'Reabrir','card concluído deve terminar com rótulo Reabrir');
  assert.equal(aposConcluir.busy,false,'card novo não pode herdar estado busy');
  assert.equal(aposConcluir.status,'concluida');
  const reabrirRotulo=await page.evaluate(id=>{const b=document.querySelector(`.exd[data-id="${id}"] .exd-check`),t=performance.now();const antes=(b.textContent||'').trim();b.click();return{antes,imediato:(b.textContent||'').trim(),sync:performance.now()-t};},rotulo.id);
  assert.equal(reabrirRotulo.antes,'Reabrir');
  assert.equal(reabrirRotulo.imediato,'Reabrir','reabrir também preserva o rótulo durante o spinner');
  await esperarLivre();
  assert.equal(await page.evaluate(id=>(document.querySelector(`.exd[data-id="${id}"] .exd-check`)?.textContent||'').trim(),rotulo.id),'Concluir');
  await auditarControles('#screen-extras','Extras desktop');

  // Extras → Puxar do Plano: feedback precisa pintar ANTES do cálculo.
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
"""
if s.count(marker)!=1:
    raise SystemExit(f'marcador teste extras não encontrado: {s.count(marker)}')
s=s.replace(marker,insert,1)
# Auditoria final do Plano antes de encerrar.
endmarker="""  assert.deepEqual(errors,[],'fluxos de Extras/Plano não devem gerar erro de página ou console');
"""
endrepl="""  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.switchTecTab('plano');});
  await esperarPlano();
  await auditarControles('#tec-panel-plano','Plano TEC desktop');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.selDay=todayLocal();ExtrasScreen.render();});
  await auditarControles('#screen-extras','Extras mobile');
  await page.evaluate(()=>{switchScreen('desempenhotec');DesempenhoTecScreen.switchTecTab('plano');});
  await esperarPlano();
  await auditarControles('#tec-panel-plano','Plano TEC mobile');
  assert.deepEqual(errors,[],'fluxos de Extras/Plano não devem gerar erro de página ou console');
"""
s=once(s,endmarker,endrepl,'auditoria final teste')
p.write_text(s)

# ---------------------------------------------------------------------------
# 6) A barreira canônica passa a executar este teste em todo PR futuro.
# ---------------------------------------------------------------------------
p = Path('.github/workflows/verificar.yml')
s = p.read_text()
s = once(s,
"""      - name: Validar fluidez do Plano TEC
        run: node testes/tec-plano-performance-browser.mjs

      - name: Verificar
""",
"""      - name: Validar fluidez do Plano TEC
        run: node testes/tec-plano-performance-browser.mjs

      - name: Auditar interações de Extras e Plano TEC
        run: node testes/extras-tec-interacoes-browser.mjs

      - name: Verificar
""",
'workflow teste interacoes')
p.write_text(s)
