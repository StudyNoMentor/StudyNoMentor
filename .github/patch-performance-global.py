from pathlib import Path


def trocar(path, antigo, novo, n=1):
    p = Path(path)
    s = p.read_text()
    if antigo not in s:
        raise SystemExit(f'trecho nao encontrado em {path}: {antigo[:100]!r}')
    s2 = s.replace(antigo, novo, n)
    p.write_text(s2)

# Extras: um único mapa de ocorrências por pintura. O calendário, o painel moderno
# e os resumos perguntam pelos mesmos dias; não faz sentido refiltrar a coleção.
trocar('src/js/47-tela-extras.js',
"  PAGE_SIZE: 100,\n  _CHECK:",
"  PAGE_SIZE: 100,\n  _occCache: new Map(),\n  _CHECK:")

trocar('src/js/47-tela-extras.js',
"  render() {\n    // o retrato do Plano custa caro: um por repintura, não um por cartão\n    this._planoRefCard = null;\n    const extras = DB.getExtras();",
"  render() {\n    // caches estritamente de uma pintura: nenhuma informação atravessa um render.\n    this._planoRefCard = null;\n    this._occCache = new Map();\n    const extras = DB.getExtras();")

# Quando o painel moderno vai redesenhar o overview de hoje, não montamos antes
# a lista-base inteira só para descartá-la alguns microssegundos depois.
trocar('src/js/47-tela-extras.js',
"    if (extras.length === 0) {\n      list.innerHTML = `<div class=\"extras-empty\"><div class=\"big\">✅</div>Nenhuma atividade extra ainda.<br>Clique em <strong>＋ Nova atividade</strong> para começar, ou <strong>🔁 Gerenciar</strong> para criar recorrências.</div>`;\n      this._syncManage();\n      DB._extrasReadSnapshot = null;\n      return;\n    }\n    const day = this.selDay;",
"    if (extras.length === 0) {\n      list.innerHTML = `<div class=\"extras-empty\"><div class=\"big\">✅</div>Nenhuma atividade extra ainda.<br>Clique em <strong>＋ Nova atividade</strong> para começar, ou <strong>🔁 Gerenciar</strong> para criar recorrências.</div>`;\n      this._syncManage();\n      DB._extrasReadSnapshot = null;\n      return;\n    }\n    // A camada moderna substitui o overview de hoje. Evita pintar 100+ cards\n    // aqui e repintá-los de novo logo depois; agenda e reforços já estão prontos.\n    if (this._modernOverviewPass && this.selDay === hoje) {\n      list.innerHTML = '';\n      this._syncManage();\n      return;\n    }\n    const day = this.selDay;")

old_occ = """  occurrencesForDay(day) {
    const hoje = todayLocal();
    return DB.getExtras().filter(x => {
      const datas = x.datas || [];
      if (DB.extraRecorrente(x)) {
        if ((x.excluidasEm || []).includes(day)) return false;
        if (datas.length) return datas.includes(day);
        return this._recurOnDay(x, day);
      }
      if (datas.length) return datas.includes(day);
      /* BUG CORRIGIDO (A): a atividade AVULSA sumia da tela assim que era concluida
         (o filtro descartava status === 'concluida'). Sem ela na lista nao havia
         como editar, consultar o que foi feito, nem reabrir se voce marcou por
         engano — restava recriar do zero.
         Agora ela FICA, marcada como concluida, com o botao virando "Reabrir".

         BUG CORRIGIDO (A2 — preservacao de data): a avulsa aparecia SOMENTE hoje.
         Se voce registrasse progresso num dia passado, ao voltar aquele dia a
         atividade nao aparecia e o registro "sumia" da visao (parecia perda de
         dado). Agora ela tambem aparece em QUALQUER dia onde houve registro,
         preservando o historico exatamente no dia correto. */
      const temHistoricoNoDia = (x.historico || []).some(h => h.data === day);
      if (temHistoricoNoDia) return true;
      // pendencia: enquanto nao concluida, fica visivel no dia de hoje
      if (day === hoje && x.status !== 'concluida') return true;
      // concluida (sem data propria): permanece acessivel no dia de hoje
      if (day === hoje) return true;
      return false;
    });
  },"""
new_occ = """  occurrencesForDay(day) {
    if (this._occCache && this._occCache.has(day)) return this._occCache.get(day);
    const hoje = todayLocal();
    const extras = DB._extrasReadSnapshot || DB.getExtras();
    const occ = extras.filter(x => {
      const datas = x.datas || [];
      if (DB.extraRecorrente(x)) {
        if ((x.excluidasEm || []).includes(day)) return false;
        if (datas.length) return datas.includes(day);
        return this._recurOnDay(x, day);
      }
      if (datas.length) return datas.includes(day);
      const temHistoricoNoDia = (x.historico || []).some(h => h.data === day);
      if (temHistoricoNoDia) return true;
      if (day === hoje && x.status !== 'concluida') return true;
      if (day === hoje) return true;
      return false;
    });
    if (this._occCache) this._occCache.set(day, occ);
    return occ;
  },"""
trocar('src/js/47-tela-extras.js', old_occ, new_occ)

# Minutagem usa a mesma fotografia já lida para a pintura atual.
antigo = "return DB.getExtras().reduce((s, x) => {"
novo = "return (DB._extrasReadSnapshot || DB.getExtras()).reduce((s, x) => {"
p = Path('src/js/47-tela-extras.js'); s = p.read_text(); count = s.count(antigo)
if count < 3: raise SystemExit(f'esperava >=3 minutagens, achei {count}')
p.write_text(s.replace(antigo, novo, 3))

# A camada moderna compartilha a fotografia e não relê cada card pelo id.
trocar('src/js/55-extras-ui-moderna.js',
"      const extras = DB.getExtras();",
"      const extras = DB._extrasReadSnapshot || DB.getExtras();")
trocar('src/js/55-extras-ui-moderna.js',
"        const entry = byKey.get(key);\n        const x = DB.getExtra(card.dataset.id);\n        if (!entry || !x) return;",
"        const entry = byKey.get(key);\n        const x = entry && entry.x;\n        if (!entry || !x) return;")

old_wrap = """  const renderOriginal = ExtrasScreen.render;
  ExtrasScreen.render = function () {
    const ret = renderOriginal.apply(this, arguments);
    try { ExtrasModern.aplicar(this); } catch (e) { _quiet(e, 'extras-modern'); }
    return ret;
  };"""
new_wrap = """  const renderOriginal = ExtrasScreen.render;
  ExtrasScreen.render = function () {
    // Uma única fotografia alimenta a tela-base E a apresentação moderna. A tela
    // moderna substitui o overview de hoje, portanto sinalizamos à base para não
    // construir a mesma árvore de cards duas vezes.
    const snapshot = DB.getExtras();
    DB._extrasReadSnapshot = snapshot;
    this._modernOverviewPass = (this.selDay || todayLocal()) === todayLocal();
    let ret;
    try { ret = renderOriginal.apply(this, arguments); }
    finally { this._modernOverviewPass = false; }
    DB._extrasReadSnapshot = snapshot;
    try { ExtrasModern.aplicar(this); } catch (e) { _quiet(e, 'extras-modern'); }
    finally { DB._extrasReadSnapshot = null; }
    return ret;
  };"""
trocar('src/js/55-extras-ui-moderna.js', old_wrap, new_wrap)

# TEC: durante uma única pintura, todos os blocos usam exatamente o mesmo
# conjunto já desserializado e ordenado. É um snapshot efêmero, não cache global:
# a próxima pintura começa limpando-o, então sync/importação nunca fica presa a
# dados antigos.
trocar('src/js/11-db.js',
"  getTecSnapshots() {\n    const list = this._get(this.KEYS.tec, []);",
"  getTecSnapshots() {\n    if (Array.isArray(this._tecReadSnapshot)) return this._tecReadSnapshot;\n    const list = this._get(this.KEYS.tec, []);")

old_render = """  render() {
    const snaps = DB.getTecSnapshots();
    const emptyEl = document.getElementById('tec-empty');
    const importEl = document.getElementById('tec-import');
    const analysisEl = document.getElementById('tec-analysis');
    importEl.style.display = 'none';
    if (snaps.length === 0) {
      emptyEl.style.display = 'block';
      analysisEl.style.display = 'none';
      return;
    }"""
new_render = """  render() {
    // Uma abertura do TEC consulta os mesmos retratos em escopo, análise, série,
    // árvore e Plano. Desserializar 8× milhares de linhas a cada chamada era
    // trabalho repetido. A fotografia dura somente este render.
    DB._tecReadSnapshot = null;
    const snaps = DB.getTecSnapshots();
    DB._tecReadSnapshot = snaps;
    const emptyEl = document.getElementById('tec-empty');
    const importEl = document.getElementById('tec-import');
    const analysisEl = document.getElementById('tec-analysis');
    importEl.style.display = 'none';
    if (snaps.length === 0) {
      emptyEl.style.display = 'block';
      analysisEl.style.display = 'none';
      DB._tecReadSnapshot = null;
      return;
    }"""
trocar('src/js/51-tela-desempenho-tec.js', old_render, new_render)

# Não renderizar Análise escondida quando a pessoa voltou para Plano/Reforço/
# Incidência. A aba ativa passa a ser a única que paga seu motor naquele retorno.
trocar('src/js/51-tela-desempenho-tec.js',
"    this.renderScopeControls(snaps);\n    this.renderAnalysis();\n    this.switchTecTab(this.tecTab || 'analise'); // reaplica a aba ativa\n    this.applyCfgHidden();\n    this.applyEnxuto();\n  },",
"    this.renderScopeControls(snaps);\n    this.switchTecTab(this.tecTab || 'analise'); // reaplica e renderiza só a aba ativa\n    this.applyCfgHidden();\n    this.applyEnxuto();\n    DB._tecReadSnapshot = null;\n  },")

trocar('src/js/51-tela-desempenho-tec.js',
"    if (tab === 'incidencia') this.renderIncidencia();\n    if (tab === 'reforco') this.renderReforco();\n    if (tab === 'plano') this.renderPlano();",
"    if (tab === 'analise') this.renderAnalysis();\n    if (tab === 'incidencia') this.renderIncidencia();\n    if (tab === 'reforco') this.renderReforco();\n    if (tab === 'plano') this.renderPlano();")

print('PATCH_PERF_OK')
