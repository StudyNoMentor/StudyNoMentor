from pathlib import Path

p = Path('src/js/51-tela-desempenho-tec.js')
s = p.read_text(encoding='utf-8')

def one(old, new, name):
    global s
    if old not in s:
        raise SystemExit(f'nao encontrei: {name}')
    s = s.replace(old, new, 1)

one(
'''    return iv ? Math.max(Math.max(0, pct - iv[0]), Math.max(0, iv[1] - pct)) : null;''',
'''    // A API histórica desta função é uma margem simétrica (±pp). O intervalo
    // Wilson completo continua disponível em `intervalo`; aqui devolvemos sua
    // meia-largura para que empate técnico e demais consumidores comparem a
    // mesma grandeza nos dois lados.
    return iv ? (iv[1] - iv[0]) / 2 : null;''',
'margem Wilson')

one(
'''    const todos = (scoped._fontes && scoped._fontes.length ? scoped._fontes : [scoped]).slice();
    if (!todos.length) return { erro: 'sem-retrato' };
    opts._snapshots = todos;''',
'''    const fontesEscopo = (scoped._fontes && scoped._fontes.length) ? scoped._fontes : null;
    const historico = fontesEscopo || (DB.getTecSnapshots() || []);
    // Agregados reais carregam `_fontes` e ficam rigorosamente presos ao escopo.
    // Snapshots unitários/sintéticos não carregam essa propriedade; nesses casos
    // o histórico do DB é necessário para delta, sequência e consolidação.
    const todos = (historico.length ? historico : [scoped]).slice();
    if (!todos.length) return { erro: 'sem-retrato' };
    opts._snapshots = todos;''',
'fontes temporais do Plano')

one(
'''    // inicializa a seleção (todos marcados) e o intervalo (cobre tudo) na 1ª vez
    if (this.selectedSnapIds === null) this.selectedSnapIds = new Set(snaps.map(s => s.id));
    // remove ids que não existem mais
    [...this.selectedSnapIds].forEach(id => { if (!snaps.find(s => s.id === id)) this.selectedSnapIds.delete(id); });
    if (this.selectedSnapIds.size === 0) snaps.forEach(s => this.selectedSnapIds.add(s.id));
    if (!this.rangeStart || !this.rangeEnd) {
      this.rangeStart = snaps[0].startDate;
      this.rangeEnd = snaps[snaps.length - 1].endDate;
    }''',
'''    // Na primeira abertura, restaura inclusive []: "Limpar" é um estado válido.
    if (this.selectedSnapIds === null) {
      const salvos = Array.isArray(_p.selectedSnapIds) ? _p.selectedSnapIds : null;
      this.selectedSnapIds = salvos
        ? new Set(salvos.map(id => Number.isFinite(Number(id)) ? Number(id) : id))
        : new Set(snaps.map(s => s.id));
    }
    // remove apenas ids que realmente deixaram de existir; seleção vazia permanece vazia
    [...this.selectedSnapIds].forEach(id => { if (!snaps.find(s => s.id === id)) this.selectedSnapIds.delete(id); });
    if (!this.rangeStart && _p.rangeStart) this.rangeStart = _p.rangeStart;
    if (!this.rangeEnd && _p.rangeEnd) this.rangeEnd = _p.rangeEnd;
    if (!this.rangeStart || !this.rangeEnd) {
      this.rangeStart = snaps[0].startDate;
      this.rangeEnd = snaps[snaps.length - 1].endDate;
    }''',
'persistencia do escopo')

one(
'''    const chave = perfil + '|' + this.scopeMode + '|' + snaps.map(s =>
      [s.id, s.startDate, s.endDate, (s.rows || []).length, s.importedAt || ''].join(':')).join('|');''',
'''    /* O cache precisa representar CONTEÚDO, não só envelope. Reimportar/corrigir
       um retrato pode preservar id, datas e quantidade de linhas enquanto muda
       acertos/questões (ou a árvore). Sem esta assinatura, Análise/Plano podem
       reutilizar silenciosamente o agregado anterior. FNV-1a é barato, estável
       e percorre exatamente os campos que alteram a consolidação. */
    const assinar = (snap) => {
      let h = 2166136261 >>> 0;
      const mix = (v) => {
        const t = String(v == null ? '' : v);
        for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
        h = Math.imul(h ^ 31, 16777619) >>> 0;
      };
      mix(snap.id); mix(snap.startDate); mix(snap.endDate); mix(snap.importedAt || '');
      (snap.rows || []).forEach(r => {
        mix(r.codigo); mix(r.nome); mix(r.disciplina); mix(r.depth);
        mix(r.questoes); mix(r.acertos);
      });
      return h.toString(36);
    };
    const chave = perfil + '|' + this.scopeMode + '|' + snaps.map(s => assinar(s)).join('|');''',
'assinatura de conteudo do escopo')

needle = '''    this._scopedC = { chave, valor };
    return valor;
  },
  openImport() {'''
insert = '''    this._scopedC = { chave, valor };
    return valor;
  },
  _scopePrefsPatch() {
    return {
      scopeMode: this.scopeMode,
      selectedSnapIds: this.selectedSnapIds ? [...this.selectedSnapIds] : [],
      rangeStart: this.rangeStart || null,
      rangeEnd: this.rangeEnd || null
    };
  },
  /* Contrato único de mudança de escopo: invalida caches e repinta o mesmo
     recorte em Análise, Plano e Reforço. Evita a antiga divergência em que o
     checkbox mudava a Análise enquanto o Plano permanecia com o retrato anterior. */
  aplicarMudancaEscopo() {
    this.savePrefs(this._scopePrefsPatch());
    this._scopedC = null;
    this._planoRefC = null;
    this._fatias = null;
    if (typeof PlanoEngine !== 'undefined') {
      PlanoEngine._agrC = null;
      PlanoEngine._tecScopeSignature = null;
      PlanoEngine._indiceC = new WeakMap();
    }
    this.renderScopeControls(DB.getTecSnapshots());
    this.renderAnalysis();
    if (this.tecTab === 'plano') this.renderPlano();
    else if (this.tecTab === 'reforco') this.renderReforco();
    else if (this.tecTab === 'incidencia') this.renderIncidencia();
  },
  openImport() {'''
one(needle, insert, 'contrato unico de escopo')

one(
'''      this.renderScopeControls(DB.getTecSnapshots());
      this.renderAnalysis();
    }));''',
'''      this.aplicarMudancaEscopo();
    }));''',
'checkbox de retrato')

one(
'''    if (allBtn) allBtn.addEventListener('click', () => { snaps.forEach(s => this.selectedSnapIds.add(s.id)); this.renderScopeControls(DB.getTecSnapshots()); this.renderAnalysis(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { this.selectedSnapIds.clear(); this.renderScopeControls(DB.getTecSnapshots()); this.renderAnalysis(); });''',
'''    if (allBtn) allBtn.addEventListener('click', () => { snaps.forEach(s => this.selectedSnapIds.add(s.id)); this.aplicarMudancaEscopo(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { this.selectedSnapIds.clear(); this.aplicarMudancaEscopo(); });''',
'botoes todos/limpar')

one(
'''  DesempenhoTecScreen.savePrefs({ scopeMode: btn.dataset.scope });
  DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
  DesempenhoTecScreen.renderAnalysis();
  // reaplica a aba ativa (reforço também depende do escopo)
  if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();''',
'''  DesempenhoTecScreen.aplicarMudancaEscopo();''',
'alternancia de modo de escopo')

one(
'''    DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
    DesempenhoTecScreen.renderAnalysis();
    if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();
  });''',
'''    DesempenhoTecScreen.aplicarMudancaEscopo();
  });''',
'intervalo manual')

one(
'''  DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
  DesempenhoTecScreen.renderAnalysis();
  if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();
}));''',
'''  DesempenhoTecScreen.aplicarMudancaEscopo();
}));''',
'atalhos de intervalo')

p.write_text(s, encoding='utf-8')
print('Plano: escopo, fontes temporais, cache de conteudo e margem estatistica corrigidos')
