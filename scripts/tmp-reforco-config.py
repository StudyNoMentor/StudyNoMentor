from pathlib import Path

def rep(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'Padrão não encontrado em {path}: {old[:120]!r}')
    p.write_text(s.replace(old, new, 1))

def app(path, marker, text):
    p = Path(path)
    s = p.read_text()
    if marker not in s:
        p.write_text(s + '\n' + text + '\n')

p54='src/js/54-reforco-fila.js'
rep(p54, """  DEFAULT_PREFS: { disciplinasDia: 1 },
  BLOCO_MAX: 25,""", """  DEFAULT_PREFS: { disciplinasDia: 1, blocoMin: 10, blocoMax: 25 },
  BLOCO_MAX: 25,""")
rep(p54, """  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(DB._profilePrefix() + this.KEY_PREF) || '{}'); }
    catch (_) { _quiet(_); raw = {}; }
    const n = Number(raw && raw.disciplinasDia);
    return { disciplinasDia: n === 2 ? 2 : this.DEFAULT_PREFS.disciplinasDia };
  },
  salvarPrefs(patch) {
    const p = Object.assign({}, this.prefs(), patch || {});
    p.disciplinasDia = Number(p.disciplinasDia) === 2 ? 2 : 1;
    const key = DB._profilePrefix() + this.KEY_PREF;
    try {
      if (typeof DB.setRaw === 'function') DB.setRaw(key, JSON.stringify(p));
      else localStorage.setItem(key, JSON.stringify(p));
    } catch (e) { _quiet(e, 'fila-prefs'); }
    this._assinaturaAnterior = '';
    this.sincronizar();
    return p;
  },
  limiteDisciplinasDia() {
    return Math.max(1, Math.min(this.MAX_TAREFAS_DIA, Number(this.prefs().disciplinasDia) || 1));
  },""", """  _sanearLimites(min, max) {
    let mi = Math.max(1, Math.min(100, Math.round(Number(min) || this.DEFAULT_PREFS.blocoMin)));
    let ma = Math.max(1, Math.min(100, Math.round(Number(max) || this.DEFAULT_PREFS.blocoMax)));
    if (mi > ma) mi = ma;
    return { min: mi, max: ma };
  },
  prefs() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(DB._profilePrefix() + this.KEY_PREF) || '{}'); }
    catch (_) { _quiet(_); raw = {}; }
    const n = Number(raw && raw.disciplinasDia);
    const lim = this._sanearLimites(raw && raw.blocoMin, raw && raw.blocoMax);
    return { disciplinasDia: n === 2 ? 2 : this.DEFAULT_PREFS.disciplinasDia, blocoMin: lim.min, blocoMax: lim.max };
  },
  salvarPrefs(patch) {
    const p = Object.assign({}, this.prefs(), patch || {});
    p.disciplinasDia = Number(p.disciplinasDia) === 2 ? 2 : 1;
    const lim = this._sanearLimites(p.blocoMin, p.blocoMax);
    p.blocoMin = lim.min; p.blocoMax = lim.max;
    const key = DB._profilePrefix() + this.KEY_PREF;
    try {
      if (typeof DB.setRaw === 'function') DB.setRaw(key, JSON.stringify(p));
      else localStorage.setItem(key, JSON.stringify(p));
    } catch (e) { _quiet(e, 'fila-prefs'); }
    this._assinaturaAnterior = '';
    this.sincronizar();
    return p;
  },
  limiteDisciplinasDia() {
    return Math.max(1, Math.min(this.MAX_TAREFAS_DIA, Number(this.prefs().disciplinasDia) || 1));
  },
  limitesBloco(e) {
    const p = this.prefs();
    const m = e && e.reforcoFila;
    const personalizado = !!(m && Number.isFinite(Number(m.blocoMin)) && Number.isFinite(Number(m.blocoMax)));
    const lim = personalizado ? this._sanearLimites(m.blocoMin, m.blocoMax) : this._sanearLimites(p.blocoMin, p.blocoMax);
    return { min: lim.min, max: lim.max, personalizado };
  },
  salvarCargaExtra(id, min, max) {
    const list = DB.getExtras();
    const e = list.find(x => x.id === id);
    if (!this.eGerenciado(e)) return null;
    const lim = this._sanearLimites(min, max);
    const m = this._meta(e); m.blocoMin = lim.min; m.blocoMax = lim.max; m.cargaAtualizadaEm = new Date().toISOString();
    e.updatedAt = new Date().toISOString();
    DB.saveExtras(list); this._assinaturaAnterior = ''; this.sincronizar();
    return this.limitesBloco(e);
  },
  usarCargaPadrao(id) {
    const list = DB.getExtras();
    const e = list.find(x => x.id === id);
    if (!this.eGerenciado(e)) return null;
    const m = this._meta(e); delete m.blocoMin; delete m.blocoMax; m.cargaAtualizadaEm = new Date().toISOString();
    e.updatedAt = new Date().toISOString();
    DB.saveExtras(list); this._assinaturaAnterior = ''; this.sincronizar();
    return this.limitesBloco(e);
  },
  aplicarCargaTodos(min, max) {
    const lim = this._sanearLimites(min, max);
    const list = DB.getExtras();
    list.forEach(e => {
      if (!this.eGerenciado(e) || e.status === 'concluida') return;
      const m = this._meta(e); delete m.blocoMin; delete m.blocoMax; m.cargaAtualizadaEm = new Date().toISOString();
      e.updatedAt = new Date().toISOString();
    });
    DB.saveExtras(list);
    return this.salvarPrefs({ blocoMin: lim.min, blocoMax: lim.max });
  },""")
rep(p54, """  tamanhoBloco(restante) {
    const r = Math.max(0, Math.ceil(parseFloat(restante) || 0));
    if (!r) return 0;
    if (r <= this.BLOCO_MAX) return r;
    const n = Math.max(2, Math.ceil(r / this.BLOCO_MAX));
    return Math.max(1, Math.ceil(r / n));
  },""", """  tamanhoBloco(restante, e) {
    const r = Math.max(0, Math.ceil(parseFloat(restante) || 0));
    if (!r) return 0;
    const lim = this.limitesBloco(e);
    if (r <= lim.max) return r;
    let n = Math.max(2, Math.ceil(r / lim.max));
    while (n > 1 && Math.floor(r / n) < lim.min && Math.ceil(r / (n - 1)) <= lim.max) n--;
    return Math.max(1, Math.min(lim.max, Math.ceil(r / n)));
  },""")
rep(p54, "const q = this.tamanhoBloco(t.restante);", "const q = this.tamanhoBloco(t.restante, t.e);")
rep(p54, "m.alvosPorDia[hoje] = this.tamanhoBloco(s);", "m.alvosPorDia[hoje] = this.tamanhoBloco(s, e);")

old_loop="""    const nums = li.querySelector('.pl-ciclo-nums');
    if (nums && !nums.querySelector('.exc-hoje')) {
      nums.insertAdjacentHTML('afterbegin', `<span class=\"exc-hoje\" title=\"Parcela executável desta data.\"><small>Hoje</small><b>${Math.min(q, feitoHoje)}</b>/${q} q</span>`);
    }
  });

  const resumo = host.querySelector('.exc-resumo');"""
new_loop="""    const nums = li.querySelector('.pl-ciclo-nums');
    if (nums && !nums.querySelector('.exc-hoje')) {
      nums.insertAdjacentHTML('afterbegin', `<span class=\"exc-hoje\" title=\"Parcela executável desta data.\"><small>Hoje</small><b>${Math.min(q, feitoHoje)}</b>/${q} q</span>`);
    }
    const lim = ReforcoFila.limitesBloco(e);
    if (nums && !nums.querySelector('.exc-carga')) {
      nums.insertAdjacentHTML('beforeend', `<span class=\"exc-carga\" title=\"Faixa usada para recalcular as próximas parcelas. O dia atual fica congelado.\"><small>Carga</small><b>${lim.min}–${lim.max}</b> q${lim.personalizado ? ' · específica' : ' · padrão'}</span>`);
    }
    const acoes = li.querySelector('.exc-acoes');
    if (acoes && !acoes.querySelector('[data-curso-carga]')) {
      acoes.insertAdjacentHTML('beforeend', `<button type=\"button\" class=\"pl-ciclo-acao\" data-curso-carga=\"${escapeHtml(e.id)}\">Ajustar carga</button>`);
    }
  });

  host.querySelectorAll('[data-curso-carga]').forEach(b => b.addEventListener('click', () => {
    const li = b.closest('li[data-id]'); const e = DB.getExtra(b.dataset.cursoCarga); if (!li || !e) return;
    const aberto = li.querySelector('.exc-carga-editor'); if (aberto) { aberto.remove(); return; }
    const lim = ReforcoFila.limitesBloco(e);
    const ed = document.createElement('div'); ed.className = 'exc-carga-editor';
    ed.innerHTML = `<div><strong>Carga das próximas parcelas</strong><small>Hoje não muda. O futuro deste ciclo é recalculado.</small></div>
      <label>Mínimo <input type=\"number\" min=\"1\" max=\"100\" value=\"${lim.min}\" data-carga-min></label>
      <label>Máximo <input type=\"number\" min=\"1\" max=\"100\" value=\"${lim.max}\" data-carga-max></label>
      <div class=\"exc-carga-actions\"><button type=\"button\" class=\"btn-secondary\" data-carga-este>Só este reforço</button><button type=\"button\" class=\"btn-secondary\" data-carga-todos>Aplicar a todos</button><button type=\"button\" class=\"btn-secondary\" data-carga-padrao>Usar padrão</button></div>`;
    li.appendChild(ed);
    const vals = () => [Number(ed.querySelector('[data-carga-min]').value), Number(ed.querySelector('[data-carga-max]').value)];
    ed.querySelector('[data-carga-este]').addEventListener('click', () => { const [mi, ma] = vals(); ReforcoFila.salvarCargaExtra(e.id, mi, ma); showToast('Carga específica atualizada ✓'); ExtrasScreen.render(); });
    ed.querySelector('[data-carga-todos]').addEventListener('click', () => { const [mi, ma] = vals(); ReforcoFila.aplicarCargaTodos(mi, ma); showToast('Carga aplicada a todos os reforços ativos ✓'); ExtrasScreen.render(); });
    ed.querySelector('[data-carga-padrao]').addEventListener('click', () => { ReforcoFila.usarCargaPadrao(e.id); showToast('Este reforço voltou a usar o padrão ✓'); ExtrasScreen.render(); });
  }));

  const resumo = host.querySelector('.exc-resumo');"""
rep(p54, old_loop, new_loop)

old_tail="""ReforcoFila._orig.puxarDoPlano = ExtrasScreen.puxarDoPlano;
ExtrasScreen.puxarDoPlano = function () {
  this._reforcoFilaEscolhaPendente = true;
  this._reforcoFilaInfo = null;
  return ReforcoFila._orig.puxarDoPlano.apply(this, arguments);
};
ReforcoFila._orig.planoBind = ExtrasScreen._planoBind;
ExtrasScreen._planoBind = function () {
  if (this._reforcoFilaEscolhaPendente && Array.isArray(this._planoCand)) {
    const s = ReforcoFila.selecionarSugestoesPlano(this._planoCand);
    this._planoSel = new Set(s.indices);
    this._reforcoFilaInfo = s;
    this._reforcoFilaEscolhaPendente = false;
  }
  const ret = ReforcoFila._orig.planoBind.apply(this, arguments);
  const info = this._reforcoFilaInfo;
  const lista = document.getElementById('pl-lista');
  if (info && lista) {
    let n = document.getElementById('pl-fila-info');
    if (!n) {
      n = document.createElement('p'); n.id = 'pl-fila-info'; n.className = 'hint';
      n.style.margin = '0 0 10px';
      lista.insertAdjacentElement('beforebegin', n);
    }
    if (info.excesso) {
      n.innerHTML = `Ciclo configurado em <strong>${info.cfg.disciplinas} disciplina(s) × ${info.cfg.topicos} tópico(s)</strong>. Há ${info.disciplinasAtivas} disciplinas abertas de um ciclo anterior; nenhuma nova frente foi marcada até o rodízio voltar ao limite.`;
    } else {
      n.innerHTML = `Ciclo automático: <strong>${info.cfg.disciplinas} disciplina(s) × ${info.cfg.topicos} tópico(s)</strong> · ${info.abertasTotal} atividade(s) já ocupam vagas · <strong>${info.vagasSugeridas} nova(s)</strong> pré-selecionada(s) para completar o ciclo${info.disciplinasEmCooldown ? ` · ${info.disciplinasEmCooldown} aguardando novo retrato TEC` : ''}.`;
    }
  }
  return ret;
};

window.ReforcoFila = ReforcoFila;"""
new_tail="""ReforcoFila.filtrarCandidatosPlano = function (cand) {
  cand = Array.isArray(cand) ? cand : [];
  let p = {}, fora = null;
  try { p = PlanoEngine.prefs() || {}; fora = PlanoEngine.excluidasSet ? PlanoEngine.excluidasSet(p) : null; } catch (e) { _quiet(e, 'fila-excluidas'); }
  const fallback = new Set((p.excluidas || []).map(x => this._norm(x)));
  return cand.filter(x => {
    try { if (fora && PlanoEngine.foraDoPlano && PlanoEngine.foraDoPlano(x.disciplina || '', fora)) return false; } catch (e) { _quiet(e); }
    return !fallback.has(this._norm(x.disciplina || ''));
  });
};
ReforcoFila.prepararSugestoesPlano = function (cand) {
  const original = Array.isArray(cand) ? cand : [];
  const filtrados = this.filtrarCandidatosPlano(original);
  const s = this.selecionarSugestoesPlano(filtrados);
  const sel = new Set(s.indices || []);
  const sugeridos = [], demais = [];
  filtrados.forEach((x, i) => (sel.has(i) ? sugeridos : demais).push(x));
  const candidatos = sugeridos.concat(demais);
  const indices = new Set(sugeridos.map((_x, i) => i));
  const info = Object.assign({}, s, { vagasSugeridas: sugeridos.length, excluidasOcultas: Math.max(0, original.length - filtrados.length) });
  return { candidatos, indices, info };
};
ReforcoFila.decorarSugestoesPlano = function (screen) {
  const host = document.getElementById('pl-lista'); if (!host) return;
  const n = Math.max(0, Number(screen._reforcoFilaSugCount) || 0);
  const linhas = [...host.querySelectorAll('.pl-linha')];
  let primeiraSug = null, primeiraOutra = null;
  linhas.forEach(l => {
    const cb = l.querySelector('.pl-pick'); const i = cb ? Number(cb.dataset.i) : -1;
    if (i >= 0 && i < n) {
      l.classList.add('pl-auto-sug'); primeiraSug ||= l;
      const box = l.querySelector('div');
      if (box && !box.querySelector('.pl-auto-badge')) box.insertAdjacentHTML('afterbegin', '<span class=\"pl-auto-badge\">Sugestão automática</span>');
    } else if (!primeiraOutra) primeiraOutra = l;
    if (cb) cb.addEventListener('change', () => { screen._reforcoFilaAutoMode = false; });
  });
  if (primeiraSug) { const h = document.createElement('div'); h.className = 'pl-auto-head'; h.innerHTML = '<strong>Sugestões para completar o ciclo</strong><small>Compatíveis com as vagas livres e já pré-selecionadas.</small>'; host.insertBefore(h, primeiraSug); }
  if (primeiraOutra && primeiraSug) { const h = document.createElement('div'); h.className = 'pl-auto-rest'; h.textContent = 'Outros assuntos disponíveis'; host.insertBefore(h, primeiraOutra); }
};

ReforcoFila._orig.puxarDoPlano = ExtrasScreen.puxarDoPlano;
ExtrasScreen.puxarDoPlano = function () {
  this._reforcoFilaEscolhaPendente = true;
  this._reforcoFilaAutoMode = true;
  this._reforcoFilaInfo = null;
  this._reforcoFilaSugCount = 0;
  return ReforcoFila._orig.puxarDoPlano.apply(this, arguments);
};
if (typeof ExtrasScreen._planoRenderLista === 'function') {
  ReforcoFila._orig.planoRenderLista = ExtrasScreen._planoRenderLista;
  ExtrasScreen._planoRenderLista = function () {
    const ret = ReforcoFila._orig.planoRenderLista.apply(this, arguments);
    ReforcoFila.decorarSugestoesPlano(this);
    return ret;
  };
}
ReforcoFila._orig.planoBind = ExtrasScreen._planoBind;
ExtrasScreen._planoBind = function () {
  if (this._reforcoFilaEscolhaPendente) this._reforcoFilaAutoMode = true;
  if (Array.isArray(this._planoCand)) {
    if (this._reforcoFilaAutoMode !== false) {
      const prep = ReforcoFila.prepararSugestoesPlano(this._planoCand);
      this._planoCand = prep.candidatos;
      this._planoSel = prep.indices;
      this._reforcoFilaInfo = prep.info;
      this._reforcoFilaSugCount = prep.info.vagasSugeridas || 0;
    } else {
      this._planoCand = ReforcoFila.filtrarCandidatosPlano(this._planoCand);
    }
    if (this._planoDiscSel && this._planoDiscSel.size) {
      const disp = new Set(this._planoCand.map(x => x.disciplina || ''));
      [...this._planoDiscSel].forEach(d => { if (!disp.has(d)) this._planoDiscSel.delete(d); });
    }
    this._reforcoFilaEscolhaPendente = false;
  }
  const ret = ReforcoFila._orig.planoBind.apply(this, arguments);
  const info = this._reforcoFilaInfo;
  const lista = document.getElementById('pl-lista');
  if (info && lista) {
    let n = document.getElementById('pl-fila-info');
    if (!n) { n = document.createElement('p'); n.id = 'pl-fila-info'; n.className = 'hint'; n.style.margin = '0 0 10px'; lista.insertAdjacentElement('beforebegin', n); }
    if (info.excesso) {
      n.innerHTML = `Ciclo configurado em <strong>${info.cfg.disciplinas} disciplina(s) × ${info.cfg.topicos} tópico(s)</strong>. Há ${info.disciplinasAtivas} disciplinas abertas de um ciclo anterior; nenhuma nova frente foi marcada até o rodízio voltar ao limite.`;
    } else {
      n.innerHTML = `Ciclo automático: <strong>${info.cfg.disciplinas} disciplina(s) × ${info.cfg.topicos} tópico(s)</strong> · ${info.abertasTotal} atividade(s) já ocupam vagas · <strong>${info.vagasSugeridas} nova(s)</strong> pré-selecionada(s) para completar o ciclo${info.excluidasOcultas ? ` · ${info.excluidasOcultas} item(ns) de matérias excluídas ocultado(s)` : ''}${info.disciplinasEmCooldown ? ` · ${info.disciplinasEmCooldown} aguardando novo retrato TEC` : ''}.`;
    }
    ReforcoFila.decorarSugestoesPlano(this);
    const marcar = document.getElementById('pl-marcar'), limpar = document.getElementById('pl-limpar');
    if (marcar) marcar.addEventListener('click', () => { this._reforcoFilaAutoMode = false; });
    if (limpar) limpar.addEventListener('click', () => { this._reforcoFilaAutoMode = false; });
  }
  return ret;
};

window.ReforcoFila = ReforcoFila;"""
rep(p54, old_tail, new_tail)

p55='src/js/55-extras-ui-moderna.js'
rep(p55, """      const densidade = (typeof ReforcoFila !== 'undefined' && ReforcoFila.limiteDisciplinasDia) ? ReforcoFila.limiteDisciplinasDia() : 1;
      const old = card.querySelector('.exm-dashboard');""", """      const densidade = (typeof ReforcoFila !== 'undefined' && ReforcoFila.limiteDisciplinasDia) ? ReforcoFila.limiteDisciplinasDia() : 1;
      const cargaPadrao = (typeof ReforcoFila !== 'undefined' && ReforcoFila.prefs) ? ReforcoFila.prefs() : { blocoMin: 10, blocoMax: 25 };
      const old = card.querySelector('.exm-dashboard');""")
rep(p55, """          </label>
        </div>`;""", """          </label>
        </div>
        <div class=\"exm-load\">
          <div class=\"exm-rotation-copy\"><strong>Faixa de questões por reforço</strong><small>Controla as próximas parcelas diárias. O mínimo é preferencial quando o saldo permite; o máximo é respeitado. O dia atual não é reescrito.</small></div>
          <label>Mínimo <input id=\"exm-ref-min\" type=\"number\" min=\"1\" max=\"100\" value=\"${cargaPadrao.blocoMin}\"></label>
          <label>Máximo <input id=\"exm-ref-max\" type=\"number\" min=\"1\" max=\"100\" value=\"${cargaPadrao.blocoMax}\"></label>
          <button type=\"button\" class=\"btn-secondary\" id=\"exm-ref-salvar\">Salvar padrão</button>
          <button type=\"button\" class=\"btn-secondary\" id=\"exm-ref-aplicar-todos\">Aplicar a todos</button>
        </div>`;""")
rep(p55, """      if (cad && typeof ReforcoFila !== 'undefined' && ReforcoFila.salvarPrefs) cad.addEventListener('change', () => {
        ReforcoFila.salvarPrefs({ disciplinasDia: Number(cad.value) === 2 ? 2 : 1 });
        screen.selDay = todayLocal();
        screen.render();
        showToast(`Rodízio ajustado para ${cad.value} disciplina(s) por dia ✓`);
      });

      const carga = card.querySelector('#ex-filters-btn');""", """      if (cad && typeof ReforcoFila !== 'undefined' && ReforcoFila.salvarPrefs) cad.addEventListener('change', () => {
        ReforcoFila.salvarPrefs({ disciplinasDia: Number(cad.value) === 2 ? 2 : 1 });
        screen.selDay = todayLocal();
        screen.render();
        showToast(`Rodízio ajustado para ${cad.value} disciplina(s) por dia ✓`);
      });
      const minEl = dash.querySelector('#exm-ref-min'), maxEl = dash.querySelector('#exm-ref-max');
      const valoresCarga = () => [Number(minEl && minEl.value), Number(maxEl && maxEl.value)];
      const salvarCarga = dash.querySelector('#exm-ref-salvar');
      if (salvarCarga && typeof ReforcoFila !== 'undefined') salvarCarga.addEventListener('click', () => {
        const [mi, ma] = valoresCarga(); ReforcoFila.salvarPrefs({ blocoMin: mi, blocoMax: ma });
        showToast('Padrão de carga atualizado ✓'); screen.render();
      });
      const aplicarTodos = dash.querySelector('#exm-ref-aplicar-todos');
      if (aplicarTodos && typeof ReforcoFila !== 'undefined') aplicarTodos.addEventListener('click', () => {
        const [mi, ma] = valoresCarga(); ReforcoFila.aplicarCargaTodos(mi, ma);
        showToast('Faixa aplicada a todos os reforços ativos ✓'); screen.render();
      });

      const carga = card.querySelector('#ex-filters-btn');""")

css='src/css/09-extras-v51.css'
app(css, '/* reforco-config-robustez */', r'''
/* reforco-config-robustez */
.exm-load{display:flex;gap:10px;align-items:end;flex-wrap:wrap;padding:12px 14px;border-top:1px solid var(--border,#e5e7eb)}
.exm-load .exm-rotation-copy{flex:1 1 280px}.exm-load label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700}.exm-load input{width:84px;padding:7px 8px;border:1px solid var(--border,#d1d5db);border-radius:8px;background:var(--surface,#fff);color:inherit}
.exc-carga-editor{margin-top:10px;padding:12px;border:1px solid var(--border,#dbe2ea);border-radius:10px;background:var(--surface-soft,#f8fafc);display:flex;gap:10px;align-items:end;flex-wrap:wrap}.exc-carga-editor>div:first-child{flex:1 1 220px;display:flex;flex-direction:column}.exc-carga-editor small{font-weight:400;opacity:.72}.exc-carga-editor label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700}.exc-carga-editor input{width:78px;padding:6px 7px;border:1px solid var(--border,#d1d5db);border-radius:7px;background:var(--surface,#fff);color:inherit}.exc-carga-actions{display:flex;gap:6px;flex-wrap:wrap}
.pl-auto-head{display:flex;flex-direction:column;gap:2px;padding:10px 12px;margin:0 0 6px;border-radius:10px;background:color-mix(in srgb,var(--accent,#2563eb) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent,#2563eb) 28%,transparent)}.pl-auto-head small{opacity:.72}.pl-auto-sug{border-color:color-mix(in srgb,var(--accent,#2563eb) 42%,var(--border,#d1d5db))!important;background:color-mix(in srgb,var(--accent,#2563eb) 5%,transparent)}.pl-auto-badge{display:inline-flex;font-size:10px;font-weight:800;letter-spacing:.02em;text-transform:uppercase;padding:2px 6px;border-radius:999px;margin-bottom:4px;background:color-mix(in srgb,var(--accent,#2563eb) 13%,transparent);color:var(--accent,#2563eb)}.pl-auto-rest{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;opacity:.58;margin:12px 2px 6px}
@media(max-width:640px){.exm-load{align-items:stretch}.exm-load label{flex:1}.exm-load input{width:100%}.exc-carga-editor{align-items:stretch}.exc-carga-editor label{flex:1}.exc-carga-editor input{width:100%}.exc-carga-actions{width:100%}.exc-carga-actions button{flex:1 1 130px}}
''')

# Ajusta asserções antigas ao novo contrato: sugestões são movidas para o topo.
t='testes/reforco-fila.mjs'
rep(t, """assert.deepEqual(Array.from(ExtrasScreen._planoSel).sort((a, b) => a - b), [1, 3, 5],
  'as três matérias prioritárias B/D/A devem vencer C, e cada uma leva seu pior tópico');""", """assert.deepEqual(Array.from(ExtrasScreen._planoSel), [0, 1, 2],
  'as sugestões automáticas devem ser movidas para o topo e continuar pré-selecionadas');
assert.deepEqual(ExtrasScreen._planoCand.slice(0, 3).map(x => x.disciplina), ['B', 'D', 'A'],
  'as três matérias prioritárias B/D/A devem vencer C');
assert.deepEqual(ExtrasScreen._planoCand.slice(0, 3).map(x => x.nome), ['B crítico', 'D crítico', 'A crítico'],
  'cada matéria prioritária deve levar seu pior tópico');""")
rep(t, """assert.deepEqual(Array.from(ExtrasScreen._planoSel), [4],
  'com A e B ocupando duas das três vagas, C deve preencher a vaga restante');""", """assert.deepEqual(Array.from(ExtrasScreen._planoSel), [0],
  'a vaga restante deve ficar no topo e pré-selecionada');
assert.equal(ExtrasScreen._planoCand[0].disciplina, 'C',
  'com A e B ocupando duas das três vagas, C deve preencher a vaga restante');""")
rep(t, """assert.deepEqual(Array.from(ExtrasScreen._planoSel), [5],
  'B recém-concluída não pode se reciclar com o mesmo retrato: a vaga passa para D');""", """assert.deepEqual(Array.from(ExtrasScreen._planoSel), [0],
  'a nova vaga deve permanecer no topo e pré-selecionada');
assert.equal(ExtrasScreen._planoCand[0].disciplina, 'D',
  'B recém-concluída não pode se reciclar com o mesmo retrato: a vaga passa para D');""")
rep(t, """assert.deepEqual(Array.from(ExtrasScreen._planoSel).sort((a, b) => a - b), [3, 4],
  'com retrato novo, B e C podem ser reavaliadas e voltar se ainda estiverem na fila de fraquezas');""", """assert.deepEqual(Array.from(ExtrasScreen._planoSel), [0, 1],
  'duas vagas liberadas devem ficar no topo e pré-selecionadas');
assert.deepEqual(ExtrasScreen._planoCand.slice(0, 2).map(x => x.disciplina), ['B', 'C'],
  'com retrato novo, B e C podem ser reavaliadas e voltar se ainda estiverem na fila de fraquezas');""")
rep(t, """const sel22 = F.selecionarSugestoesPlano(ExtrasScreen._planoCand);
assert.deepEqual(Array.from(sel22.indices).sort((a, b) => a - b), [0, 1, 2, 3],""", """const sel22 = F.selecionarSugestoesPlano(ExtrasScreen._planoCand);
const sel22Itens = Array.from(sel22.indices).map(i => ExtrasScreen._planoCand[i]);
const sel22Cont = sel22Itens.reduce((m, x) => (m[x.disciplina] = (m[x.disciplina] || 0) + 1, m), {});
assert.deepEqual(sel22Cont, { B: 2, A: 2 },""")

print('patch aplicado')
