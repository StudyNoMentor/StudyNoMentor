from pathlib import Path


def rep(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'âncora não encontrada em {path}: {old[:120]!r}')
    s2 = s.replace(old, new, count)
    p.write_text(s2)

# ─────────────────────────────────────────────────────────────────────────────
# 1) Preferências do Plano: tamanho do ciclo de sugestões
# ─────────────────────────────────────────────────────────────────────────────
rep('src/js/51-tela-desempenho-tec.js',
"    limite: 10, ordenar: 'pior',\n",
"    limite: 10, ordenar: 'pior',\n    // Ciclo contínuo de sugestões: quantas matérias ficam em ataque simultâneo\n    // e quantos tópicos de cada uma podem ocupar o ciclo.\n    sugestoesDisciplinas: 3, sugestoesTopicosDisc: 1,\n")

rep('src/js/51-tela-desempenho-tec.js',
"      pesoBanca: [0, 12], migracao: [1, 4, true]\n",
"      pesoBanca: [0, 12], sugestoesDisciplinas: [1, 12, true], sugestoesTopicosDisc: [1, 5, true],\n      migracao: [1, 4, true]\n")

rep('src/js/51-tela-desempenho-tec.js',
"    set('plano-amostraalvo', p.amostraAlvo); set('plano-cadencia', p.cadenciaDias); set('plano-ordenar', p.ordenar);\n",
"    set('plano-amostraalvo', p.amostraAlvo); set('plano-cadencia', p.cadenciaDias); set('plano-ordenar', p.ordenar);\n    set('plano-sug-disciplinas', p.sugestoesDisciplinas); set('plano-sug-topicos', p.sugestoesTopicosDisc);\n")

rep('src/js/51-tela-desempenho-tec.js',
"      limite: Math.max(3, num('plano-limite', 10)),\n      amostraAlvo: Math.max(10, num('plano-amostraalvo', 50)),\n",
"      limite: Math.max(3, num('plano-limite', 10)),\n      sugestoesDisciplinas: Math.max(1, Math.min(12, num('plano-sug-disciplinas', 3))),\n      sugestoesTopicosDisc: Math.max(1, Math.min(5, num('plano-sug-topicos', 1))),\n      amostraAlvo: Math.max(10, num('plano-amostraalvo', 50)),\n")

rep('src/html/05-corpo-cont.html',
'''              <input type="number" inputmode="numeric" id="plano-limite" data-cfg-key="limite" min="3" max="200" step="1">
            </div>
            <div class="rfc-field">
              <label for="plano-meta"''',
'''              <input type="number" inputmode="numeric" id="plano-limite" data-cfg-key="limite" min="3" max="200" step="1">
            </div>
            <div class="rfc-field">
              <label for="plano-sug-disciplinas" data-info="Tamanho do ciclo automático de pontos fracos. O app mantém até esta quantidade de disciplinas simultaneamente em ataque. Quando uma frente do Plano termina, a vaga fica disponível e o próximo Puxar do Plano já pré-seleciona a próxima matéria prioritária ainda livre.">Disciplinas no ciclo de sugestões</label>
              <input type="number" inputmode="numeric" id="plano-sug-disciplinas" data-cfg-key="sugestoesDisciplinas" min="1" max="12" step="1">
            </div>
            <div class="rfc-field">
              <label for="plano-sug-topicos" data-info="Quantos assuntos de CADA disciplina podem ficar simultaneamente em reforço. Com 1, o ciclo abre uma frente por matéria; com 2, só abre o segundo tópico depois de respeitar a prioridade e os slots já ocupados.">Tópicos por disciplina no ciclo</label>
              <input type="number" inputmode="numeric" id="plano-sug-topicos" data-cfg-key="sugestoesTopicosDisc" min="1" max="5" step="1">
            </div>
            <div class="rfc-field">
              <label for="plano-meta"''')

# ─────────────────────────────────────────────────────────────────────────────
# 2) Fila do reforço: 1 ou 2 disciplinas/dia + rodízio por disciplina
# ─────────────────────────────────────────────────────────────────────────────
rep('src/js/54-reforco-fila.js',
"     · até 3 tarefas de reforço por dia;\n",
"     · 1 ou 2 disciplinas por dia, configurável em Atividades Extras;\n")
rep('src/js/54-reforco-fila.js',
"  MAX_TAREFAS_DIA: 3,\n",
"  MAX_TAREFAS_DIA: 2,\n  KEY_PREF: 'reforco-fila-prefs',\n  DEFAULT_PREFS: { disciplinasDia: 1 },\n")
rep('src/js/54-reforco-fila.js',
"  _orig: {},\n\n  _norm(s) {\n",
'''  _orig: {},

  prefs() {
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
  },

  _norm(s) {
''')

rep('src/js/54-reforco-fila.js',
'''      const cmp = (a, b) => String(a.ultimo || '').localeCompare(String(b.ultimo || ''))
        || a.taxa - b.taxa
        || String(a.e.titulo || '').localeCompare(String(b.e.titulo || ''), 'pt-BR');

      // Cada passagem abre o dia mais cedo possível e preenche até três
      // disciplinas diferentes. O saldo de uma disciplina que não coube espera
      // o próximo dia em vez de virar uma microtarefa no mesmo dia.
''',
'''      // O rodízio é por DISCIPLINA, não só por tarefa. Se A1 entrou hoje, A2
      // não fura a fila amanhã enquanto B e C ainda aguardam: isso preserva o
      // espaçamento mesmo quando o Plano permite mais de um tópico por matéria.
      const ultimoPorDisc = new Map();
      tarefas.forEach(t => {
        const u = t.ultimo || '';
        const at = ultimoPorDisc.get(t.disc) || '';
        if (!at || u > at) ultimoPorDisc.set(t.disc, u);
      });
      const cmp = (a, b) => String(ultimoPorDisc.get(a.disc) || '').localeCompare(String(ultimoPorDisc.get(b.disc) || ''))
        || String(a.ultimo || '').localeCompare(String(b.ultimo || ''))
        || a.taxa - b.taxa
        || String(a.e.titulo || '').localeCompare(String(b.e.titulo || ''), 'pt-BR');

      // Cada passagem abre o dia mais cedo possível e preenche só a densidade
      // escolhida (1 ou 2 disciplinas). O saldo que não coube espera o próximo
      // dia em vez de virar microtarefa ou concentrar três matérias de uma vez.
''')
rep('src/js/54-reforco-fila.js',
"        let slots = this.MAX_TAREFAS_DIA - (dia === hoje ? nHoje : 0);\n",
"        let slots = this.limiteDisciplinasDia() - (dia === hoje ? nHoje : 0);\n")
rep('src/js/54-reforco-fila.js',
"          t.ultimo = dia;\n          t.jaHoje = t.jaHoje || dia === hoje;\n",
"          t.ultimo = dia;\n          ultimoPorDisc.set(t.disc, dia);\n          t.jaHoje = t.jaHoje || dia === hoje;\n")
rep('src/js/54-reforco-fila.js',
"    if (outras.length >= this.MAX_TAREFAS_DIA || outras.some(x => this._norm(x.disciplina || (x.origemPlano && x.origemPlano.disciplina) || 'sem disciplina') === disc)) {\n",
"    if (outras.length >= this.limiteDisciplinasDia() || outras.some(x => this._norm(x.disciplina || (x.origemPlano && x.origemPlano.disciplina) || 'sem disciplina') === disc)) {\n")
rep('src/js/54-reforco-fila.js',
"          ? 'Hoje já tem 3 frentes do reforço (ou esta disciplina já está no rodízio)'\n",
"          ? `Hoje já atingiu ${ReforcoFila.limiteDisciplinasDia()} disciplina(s) do reforço (ou esta matéria já está no rodízio)`\n")

p54 = Path('src/js/54-reforco-fila.js')
s54 = p54.read_text()
start = s54.index('/* ── PUXAR DO PLANO: padrão = 3 disciplinas diferentes')
end = s54.index('\nwindow.ReforcoFila = ReforcoFila;', start)
novo = r'''/* ── PUXAR DO PLANO: ciclo de slots, matéria primeiro, tópico depois ───── */
ReforcoFila._critSug = function (c) {
  const taxa = Number(c && c.x && c.x.taxa);
  return Number.isFinite(taxa) ? taxa : 101;
};
ReforcoFila._cmpSug = function (a, b) {
  return this._critSug(a) - this._critSug(b)
    || (Number(b.x.incid) || 0) - (Number(a.x.incid) || 0)
    || (Number(b.x.qJanela) || 0) - (Number(a.x.qJanela) || 0)
    || String(a.x.nome || '').localeCompare(String(b.x.nome || ''), 'pt-BR');
};
ReforcoFila.configSugestoesPlano = function () {
  let p = {};
  try { p = PlanoEngine.prefs() || {}; } catch (e) { _quiet(e, 'fila-sug-prefs'); }
  return {
    disciplinas: Math.max(1, Math.min(12, Math.round(Number(p.sugestoesDisciplinas) || 3))),
    topicos: Math.max(1, Math.min(5, Math.round(Number(p.sugestoesTopicosDisc) || 1)))
  };
};
ReforcoFila._rankDisciplinasPlano = function (cand) {
  const porDisc = new Map();
  (cand || []).forEach((x, i) => {
    const k = this._norm(x.disciplina || 'sem disciplina');
    if (!porDisc.has(k)) porDisc.set(k, { k, nome: x.disciplina || 'Sem disciplina', itens: [] });
    porDisc.get(k).itens.push({ x, i });
  });
  porDisc.forEach(g => g.itens.sort((a, b) => this._cmpSug(a, b)));

  const ordem = [], vistos = new Set();
  try {
    if (typeof PlanoPontos !== 'undefined' && PlanoPontos.esforcoPorMateria) {
      const tm = PlanoPontos.esforcoPorMateria(PlanoEngine.prefs());
      (tm && tm.linhas || []).forEach(l => {
        const k = this._norm(l.nome || '');
        if (porDisc.has(k) && !vistos.has(k)) { vistos.add(k); ordem.push(k); }
      });
    }
  } catch (e) { _quiet(e, 'fila-rank-disciplinas'); }

  // Se o quadro de matérias não conseguir casar um nome, a queda é explícita:
  // usa o pior tópico disponível daquela disciplina, sem perder candidato.
  [...porDisc.values()]
    .filter(g => !vistos.has(g.k))
    .sort((a, b) => this._cmpSug(a.itens[0], b.itens[0]))
    .forEach(g => { vistos.add(g.k); ordem.push(g.k); });
  return { ordem, porDisc };
};
ReforcoFila.selecionarSugestoesPlano = function (cand) {
  cand = Array.isArray(cand) ? cand : [];
  const cfg = this.configSugestoesPlano();
  const abertas = DB.getExtras().filter(e => this.ePlano(e) && e.status !== 'concluida');
  const abertasPorDisc = new Map();
  abertas.forEach(e => {
    const k = this._norm(e.disciplina || (e.origemPlano && e.origemPlano.disciplina) || 'sem disciplina');
    abertasPorDisc.set(k, (abertasPorDisc.get(k) || 0) + 1);
  });

  const { ordem, porDisc } = this._rankDisciplinasPlano(cand);
  const ativas = [...abertasPorDisc.keys()];
  // Perfil antigo pode já ter mais matérias abertas do que a nova configuração.
  // Nesse caso não criamos MAIS trabalho: esperamos o ciclo convergir sozinho.
  if (ativas.length > cfg.disciplinas) {
    return { indices: [], cfg, abertasTotal: abertas.length, disciplinasAtivas: ativas.length, excesso: true };
  }

  const alvoDiscs = ativas.slice();
  ordem.forEach(k => {
    if (alvoDiscs.length >= cfg.disciplinas) return;
    if (!alvoDiscs.includes(k)) alvoDiscs.push(k);
  });

  const indices = [];
  alvoDiscs.forEach(k => {
    let vagas = Math.max(0, cfg.topicos - (abertasPorDisc.get(k) || 0));
    if (!vagas) return;
    const grupo = porDisc.get(k);
    if (!grupo) return;
    for (const c of grupo.itens) {
      if (vagas <= 0) break;
      indices.push(c.i); vagas--;
    }
  });
  return {
    indices, cfg, abertasTotal: abertas.length, disciplinasAtivas: ativas.length,
    alvoDisciplinas: alvoDiscs.length, vagasSugeridas: indices.length, excesso: false
  };
};

ReforcoFila._orig.puxarDoPlano = ExtrasScreen.puxarDoPlano;
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
      n.innerHTML = `Ciclo automático: <strong>${info.cfg.disciplinas} disciplina(s) × ${info.cfg.topicos} tópico(s)</strong> · ${info.abertasTotal} atividade(s) já ocupam vagas · <strong>${info.vagasSugeridas} nova(s)</strong> pré-selecionada(s) para completar o ciclo.`;
    }
  }
  return ret;
};
'''
s54 = s54[:start] + novo + s54[end:]
p54.write_text(s54)

# ─────────────────────────────────────────────────────────────────────────────
# 3) Atividades Extras: controle visual da densidade diária do rodízio
# ─────────────────────────────────────────────────────────────────────────────
rep('src/js/55-extras-ui-moderna.js',
"      const old = card.querySelector('.exm-dashboard');\n",
"      const densidade = (typeof ReforcoFila !== 'undefined' && ReforcoFila.limiteDisciplinasDia) ? ReforcoFila.limiteDisciplinasDia() : 1;\n      const old = card.querySelector('.exm-dashboard');\n")
rep('src/js/55-extras-ui-moderna.js',
'''          ${this.chip('plano', 'Plano', c.fontes.plano)}
        </div>`;''',
'''          ${this.chip('plano', 'Plano', c.fontes.plano)}
        </div>
        <div class="exm-rotation">
          <div class="exm-rotation-copy">
            <strong>Cadência do reforço</strong>
            <small>Espalha as matérias para favorecer alternância e revisão. O dia de hoje não é reescrito; a mudança reorganiza só o futuro.</small>
          </div>
          <label for="exm-ref-disciplinas-dia">Disciplinas por dia
            <select id="exm-ref-disciplinas-dia">
              <option value="1" ${densidade === 1 ? 'selected' : ''}>1 · mais espaçado</option>
              <option value="2" ${densidade === 2 ? 'selected' : ''}>2 · mais intenso</option>
            </select>
          </label>
        </div>`;''')
rep('src/js/55-extras-ui-moderna.js',
'''      dash.querySelectorAll('[data-exm-view]').forEach(b => b.addEventListener('click', () => {
        this.view = b.dataset.exmView || 'all';
        screen.selDay = todayLocal();
        screen.render();
      }));

      const carga = card.querySelector('#ex-filters-btn');
''',
'''      dash.querySelectorAll('[data-exm-view]').forEach(b => b.addEventListener('click', () => {
        this.view = b.dataset.exmView || 'all';
        screen.selDay = todayLocal();
        screen.render();
      }));
      const cad = dash.querySelector('#exm-ref-disciplinas-dia');
      if (cad && typeof ReforcoFila !== 'undefined' && ReforcoFila.salvarPrefs) cad.addEventListener('change', () => {
        ReforcoFila.salvarPrefs({ disciplinasDia: Number(cad.value) === 2 ? 2 : 1 });
        screen.selDay = todayLocal();
        screen.render();
        showToast(`Rodízio ajustado para ${cad.value} disciplina(s) por dia ✓`);
      });

      const carga = card.querySelector('#ex-filters-btn');
''')

p = Path('src/css/09-extras-v51.css')
s = p.read_text()
s += r'''

/* Cadência do reforço: decisão pequena, visível na própria tela de execução. */
.exm-rotation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface-2) 72%, transparent);
}
.exm-rotation-copy { min-width: 0; display: grid; gap: 2px; }
.exm-rotation-copy strong { font-size: var(--fs-sm); color: var(--text); }
.exm-rotation-copy small { color: var(--text-faint); line-height: 1.4; }
.exm-rotation label {
  flex: 0 0 auto;
  display: grid;
  gap: 5px;
  font-size: var(--fs-xs);
  font-weight: 700;
  color: var(--text-soft);
}
.exm-rotation select { min-width: 170px; }
@media (max-width: 620px) {
  .exm-rotation { align-items: stretch; flex-direction: column; gap: 10px; }
  .exm-rotation label { width: 100%; }
  .exm-rotation select { width: 100%; min-width: 0; }
}
'''
p.write_text(s)

# ─────────────────────────────────────────────────────────────────────────────
# 4) Testes unitários do contrato novo
# ─────────────────────────────────────────────────────────────────────────────
rep('testes/reforco-fila.mjs',
"const DB = {\n  _data: data,\n",
"const prefMem = new Map();\nconst localStorage = { getItem(k) { return prefMem.has(k) ? prefMem.get(k) : null; }, setItem(k, v) { prefMem.set(k, String(v)); } };\nconst DB = {\n  _data: data,\n  _profilePrefix() { return 'p:'; },\n  setRaw(k, v) { localStorage.setItem(k, v); },\n")
rep('testes/reforco-fila.mjs',
'''const ctx = {
  window: {}, DB, ExtrasScreen, PlanoCiclo,
  PlanoEngine: { calcular() { return null; }, prefs() { return {}; } },
  DesempenhoTecScreen: { scopedSnapshot() { return null; } },
''',
'''let planPrefs = { sugestoesDisciplinas: 3, sugestoesTopicosDisc: 1 };
const PlanoPontos = {
  linhas: ['A', 'B', 'C', 'D'],
  esforcoPorMateria() { return { linhas: this.linhas.map(nome => ({ nome })) }; }
};
const ctx = {
  window: {}, DB, ExtrasScreen, PlanoCiclo, PlanoPontos, localStorage,
  PlanoEngine: { calcular() { return null; }, prefs() { return planPrefs; } },
  DesempenhoTecScreen: { scopedSnapshot() { return null; } },
''')

pt = Path('testes/reforco-fila.mjs')
st = pt.read_text()
ini = st.index('// 1) Planejamento:')
fim = st.index('// 2) Tamanho de bloco:', ini)
sec1 = r'''// 1) Planejamento: padrão = UMA disciplina por dia e rodízio por matéria.
F.sincronizar();
const agenda = new Map();
for (const e of DB._data) {
  assert.ok(e.reforcoFila, 'reforço aberto do Plano deve ser adotado pela fila');
  for (const [dia, q] of Object.entries(e.reforcoFila.alvosPorDia)) {
    if (!agenda.has(dia)) agenda.set(dia, []);
    agenda.get(dia).push({ e, q });
  }
}
for (const [dia, itens] of agenda) {
  assert.ok(itens.length <= 1, `${dia}: padrão deve espaçar uma disciplina por dia`);
}
const diasOrdenados = [...agenda.keys()].sort();
assert.equal((agenda.get(HOJE) || []).length, 1, 'hoje deve começar com uma única frente no padrão espaçado');
assert.equal((agenda.get(HOJE) || [])[0]?.e.id, 'A1', 'o assunto mais crítico disponível abre o rodízio');
const primeirasDiscs = diasOrdenados.slice(0, 4).map(d => (agenda.get(d) || [])[0]?.e.disciplina);
assert.deepEqual(primeirasDiscs.slice(0, 4), ['A', 'B', 'C', 'D'],
  'um segundo tópico de A não pode furar B/C/D: o espaçamento é por disciplina');

// 1b) Configuração mais intensa: dois assuntos por dia, ainda sem repetir matéria.
F.salvarPrefs({ disciplinasDia: 2 });
const agenda2 = new Map();
for (const e of DB._data) {
  for (const [dia, q] of Object.entries(e.reforcoFila.alvosPorDia)) {
    if (!agenda2.has(dia)) agenda2.set(dia, []);
    agenda2.get(dia).push({ e, q });
  }
}
for (const [dia, itens] of agenda2) {
  assert.ok(itens.length <= 2, `${dia}: configuração não pode passar de 2 disciplinas`);
  assert.equal(new Set(itens.map(x => x.e.disciplina)).size, itens.length, `${dia}: não pode repetir disciplina no mesmo dia`);
}
assert.ok([...agenda2.entries()].some(([d, itens]) => d > HOJE && itens.length === 2),
  'com saldo suficiente, algum dia futuro deve usar as duas vagas configuradas');
F.salvarPrefs({ disciplinasDia: 1 });

'''
st = st[:ini] + sec1 + st[fim:]

ini = st.index('// 7) Seleção inicial do Plano:')
sec7 = r'''// 7) Seleção do Plano: primeiro ranqueia DISCIPLINAS pelo próprio Plano;
// depois pega o pior tópico disponível dentro de cada uma.
DB._data = [];
planPrefs = { sugestoesDisciplinas: 3, sugestoesTopicosDisc: 1 };
PlanoPontos.linhas = ['B', 'D', 'A', 'C'];
ExtrasScreen._planoCand = [
  { nome: 'A mediano', disciplina: 'A', taxa: 50, incid: 8, qJanela: 30 },
  { nome: 'A crítico', disciplina: 'A', taxa: 20, incid: 3, qJanela: 20 },
  { nome: 'B mediano', disciplina: 'B', taxa: 40, incid: 5, qJanela: 40 },
  { nome: 'B crítico', disciplina: 'B', taxa: 10, incid: 2, qJanela: 15 },
  { nome: 'C crítico', disciplina: 'C', taxa: 5, incid: 9, qJanela: 50 },
  { nome: 'D crítico', disciplina: 'D', taxa: 60, incid: 10, qJanela: 80 }
];
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel).sort((a, b) => a - b), [1, 3, 5],
  'as três matérias prioritárias B/D/A devem vencer C, e cada uma leva seu pior tópico');

// 8) Slots contínuos: atividades abertas ocupam vagas; concluir uma libera só
// o necessário para o próximo pior alvo disponível.
const abertaA = extra('aberta-A', 'A', 40, 20);
const abertaB = extra('aberta-B', 'B', 40, 10);
DB._data = [abertaA, abertaB];
PlanoPontos.linhas = ['A', 'B', 'C', 'D'];
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel), [4],
  'com A e B ocupando duas das três vagas, só o pior tópico de C deve preencher a vaga restante');

abertaB.status = 'concluida';
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel).sort((a, b) => a - b), [3, 4],
  'ao concluir B, duas vagas ficam livres: entram B novamente e C conforme a fila atual disponível');

// 9) A configuração do Plano também controla quantos tópicos cabem por matéria.
DB._data = [];
planPrefs = { sugestoesDisciplinas: 2, sugestoesTopicosDisc: 2 };
PlanoPontos.linhas = ['B', 'A', 'C', 'D'];
const sel22 = F.selecionarSugestoesPlano(ExtrasScreen._planoCand);
assert.deepEqual(sel22.indices.slice().sort((a, b) => a - b), [0, 1, 2, 3],
  '2 disciplinas × 2 tópicos deve preencher B e A com dois tópicos cada, sem puxar C/D');

console.log('OK: fila diária, espaçamento e ciclo contínuo de sugestões do Plano preservados.');
'''
st = st[:ini] + sec7
pt.write_text(st)

print('patch aplicado')
