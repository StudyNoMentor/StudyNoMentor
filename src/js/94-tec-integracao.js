/* ============================================================
   INTEGRAÇÃO TEC — navegador incorporado, biblioteca e IA
   ============================================================ */
const TecIntegracaoScreen = {
  STORAGE_SUFFIX: 'tec-integracao:estado-v2',
  TEC_ORIGIN: 'https://www.tecconcursos.com.br',
  TEC_HOME: 'https://www.tecconcursos.com.br/questoes/cadernos',
  PROMPT_VERSION: 'tec-pedagogico-v1',
  selectedKey: null,
  activeSection: 'diagnostico',
  _key() { try { return DB._profilePrefix() + this.STORAGE_SUFFIX; } catch (_) { return 'diario-estudos:' + this.STORAGE_SUFFIX; } },
  blank() { return { schema: 2, questions: {}, analyses: {}, connection: {}, updatedAt: null }; },
  state() {
    try { const p = JSON.parse(localStorage.getItem(this._key()) || 'null'); return p && p.schema === 2 ? p : this.blank(); }
    catch (_) { return this.blank(); }
  },
  save(next) {
    next.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(this._key(), JSON.stringify(next));
      if (typeof SectionSync !== 'undefined' && SectionSync.markDirty) SectionSync.markDirty(this._key());
      if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange();
      return true;
    }
    catch (e) { _quiet(e, 'tec-integracao-save'); return false; }
  },
  text(v) { return String(v == null ? '' : v).trim(); },
  questionKey(account, book, id) { return [account || 'conta', book || 'caderno', id || 'sem-id'].map(encodeURIComponent).join(':'); },
  hash(value) { let h = 2166136261; for (const c of String(value || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); },
  metrics(state) {
    const rows = Object.values(state.questions || {});
    return { questions: rows.length, errors: rows.filter(x => x.question && x.question.acertou === false).length,
      books: new Set(rows.map(x => x.bookId).filter(Boolean)).size,
      pending: rows.filter(x => !state.analyses || !state.analyses[x.key + ':' + this.PROMPT_VERSION]).length };
  },
  mergeInto(state, question, meta = {}) {
    if (!question || (!question.id && !question.enunciado)) throw new Error('Questão sem identificação ou enunciado.');
    const account = this.text(meta.tecAccount) || 'conta-importada';
    const book = this.text(meta.bookId || question.cadernoId) || 'caderno-desconhecido';
    const key = this.questionKey(account, book, question.id || this.hash(question.enunciado));
    state.questions[key] = { ...(state.questions[key] || {}), key, tecAccount: account, bookId: book,
      history: meta.history || null, question, receivedAt: meta.capturedAt || new Date().toISOString() };
    state.connection = { status: 'connected', account, bookId: book, lastSeenAt: new Date().toISOString() };
    return key;
  },
  ingest(question, meta = {}) {
    const state = this.state(), key = this.mergeInto(state, question, meta);
    if (!this.save(state)) throw new Error('Não foi possível salvar os dados neste navegador.');
    this.selectedKey = key; this.render();
  },
  onMessage(event) {
    const frame = document.getElementById('tec-workspace-frame');
    if (event.origin !== this.TEC_ORIGIN || !frame || event.source !== frame.contentWindow) return;
    const msg = event.data;
    if (!msg || msg.source !== 'StudyMentorTEC' || Number(msg.version) < 21) return;
    if (msg.type === 'ready') {
      const state = this.state(); state.connection = { status: 'connected', ...(msg.payload || {}), lastSeenAt: new Date().toISOString() };
      this.save(state); this.render(); showToast('🔌 TEC conectado ao Study');
    } else if (msg.type === 'question') {
      try { this.ingest(msg.payload && msg.payload.question, msg.payload || {}); showToast('✅ Questão recebida do TEC'); }
      catch (e) { showToast('⚠️ ' + e.message); }
    }
  },
  openEmbedded() {
    const frame = document.getElementById('tec-workspace-frame'), placeholder = document.getElementById('tec-workspace-placeholder');
    if (!frame) return; frame.hidden = false; if (placeholder) placeholder.hidden = true; if (!frame.src) frame.src = this.TEC_HOME;
    const msg = document.getElementById('tec-connect-message');
    if (msg) msg.textContent = 'Faça login no TEC dentro do quadro. Quando o V21 estiver ativo, a conexão aparecerá automaticamente.';
  },
  async importJSON(file) {
    const data = JSON.parse(await file.text()), questions = Array.isArray(data.questoes) ? data.questoes : [];
    if (!questions.length) throw new Error('O arquivo não contém questões exportadas pelo StudyMentor.');
    const state = this.state(); let lastKey = null;
    for (const raw of questions) {
      const result = data.resultados && data.resultados[String(raw.id)];
      const official = data.resultadosOficiais && data.resultadosOficiais[String(raw.id)];
      const question = { ...raw };
      if (typeof question.acertou !== 'boolean') question.acertou = typeof result?.acertou === 'boolean' ? result.acertou : official?.acertou;
      lastKey = this.mergeInto(state, question, { tecAccount: data.contaTec, bookId: data.cadernoId || question.cadernoId,
      history: data.desempenhoQuestoes && data.desempenhoQuestoes[String(question.id)], capturedAt: question.capturadoEm });
    }
    if (!this.save(state)) throw new Error('Não foi possível salvar os dados importados.');
    this.selectedKey = lastKey; this.render();
    showToast(`📥 ${questions.length} questão(ões) importada(s)`);
  },
  createText(tag, value, cls) { const el = document.createElement(tag); if (cls) el.className = cls; el.textContent = this.text(value); return el; },
  renderList(state) {
    const list = document.getElementById('tec-question-list'); if (!list) return; list.replaceChildren();
    const rows = Object.values(state.questions || {}).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
    if (!rows.length) { list.append(this.createText('div', 'Nenhuma questão recebida.', 'tec-connect-empty')); return; }
    if (!this.selectedKey || !state.questions[this.selectedKey]) this.selectedKey = rows[0].key;
    rows.forEach(row => {
      const q = row.question || {}, button = document.createElement('button'); button.type = 'button';
      button.className = 'tec-question-row' + (row.key === this.selectedKey ? ' active' : '');
      button.append(this.createText('strong', `#${q.id || '—'} · ${q.materia || 'Matéria não identificada'}`));
      button.append(this.createText('small', `${row.bookId} · ${q.assunto || q.banca || 'Sem assunto'} · ${q.acertou === true ? 'Acerto' : q.acertou === false ? 'Erro' : 'Sem resultado'}`));
      button.addEventListener('click', () => { this.selectedKey = row.key; this.render(); }); list.append(button);
    });
  },
  renderDetail(state) {
    const root = document.getElementById('tec-question-detail'); if (!root) return; root.replaceChildren();
    const row = state.questions && state.questions[this.selectedKey], run = document.getElementById('tec-ai-run');
    if (!row) { if (run) run.disabled = true; root.append(this.createText('div', 'Nenhuma questão selecionada.', 'tec-connect-empty')); return; }
    const q = row.question || {}; if (run) run.disabled = false;
    const sub = document.getElementById('tec-assistant-sub'); if (sub) sub.textContent = `Questão #${q.id || '—'} · ${q.materia || 'matéria não identificada'}`;
    root.append(this.createText('p', q.enunciado || 'Enunciado não capturado.', 'tec-question-statement'));
    const alternatives = document.createElement('div'); alternatives.className = 'tec-question-alternatives';
    (q.alternativas || []).forEach(a => { const item = this.createText('div', `${a.letra}) ${a.texto}`);
      if (a.letra === q.correta || a.correta) item.classList.add('correct');
      if (a.letra === q.marcada || a.marcadaPorMim) item.classList.add('selected'); alternatives.append(item); });
    root.append(alternatives); this.renderAnalysis(state);
  },
  analysisFor(state) { return state.analyses && state.analyses[this.selectedKey + ':' + this.PROMPT_VERSION]; },
  renderAnalysis(state) {
    const content = document.getElementById('tec-ai-content'); if (!content) return;
    const professor = document.getElementById('tec-professor-box'); if (professor) professor.hidden = this.activeSection !== 'professor';
    content.replaceChildren(); const analysis = this.analysisFor(state), value = analysis && analysis[this.activeSection];
    const run = document.getElementById('tec-ai-run');
    if (run) run.textContent = value ? 'Reprocessar esta aba' : (analysis ? 'Gerar esta aba' : 'Gerar análise completa');
    if (!value) { content.textContent = this.activeSection === 'professor' ? 'Faça uma pergunta usando a questão e as análises como contexto.' : 'Clique em “Analisar com IA” para gerar esta seção.'; return; }
    if (Array.isArray(value)) { const list = document.createElement('ul'); value.forEach(x => list.append(this.createText('li', typeof x === 'string' ? x : JSON.stringify(x)))); content.append(list); }
    else content.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (this.activeSection === 'reforco' && value) {
      const add = this.createText('button', 'Adicionar às Atividades Extras'); add.type = 'button'; add.className = 'btn-primary tec-reforco-add';
      add.addEventListener('click', () => this.addReinforcement(state)); content.append(add);
    }
  },
  addReinforcement(state) {
    const row = state.questions && state.questions[this.selectedKey], analysis = this.analysisFor(state);
    if (!row || !analysis || !analysis.reforco || !DB.addExtra) return;
    const q = row.question || {}, steps = Array.isArray(analysis.reforco) ? analysis.reforco.join(' · ') : String(analysis.reforco);
    DB.addExtra({ titulo: `Reforço TEC #${q.id || '—'} — ${q.assunto || q.materia || 'revisão'}`, tipo: 'revisao', disciplina: q.materia || '', unidade: 'sessoes', alvo: 1, periodo: 'unica', marcador: steps });
    showToast('✅ Reforço adicionado às Atividades Extras');
  },
  async callAI(section, professorQuestion) {
    const state = this.state(), row = state.questions && state.questions[this.selectedKey]; if (!row) throw new Error('Selecione uma questão.');
    const cs = window.CloudStore;
    if (!cs || !cs.isLoggedIn || !cs.isLoggedIn() || !cs.session) throw new Error('Entre na sua conta do Study para usar a IA.');
    const analysisKey = row.key + ':' + this.PROMPT_VERSION, requestBody = JSON.stringify({ question: row.question, history: row.history,
      existingAnalysis: state.analyses[analysisKey] || null, section: section || 'all', professorQuestion: professorQuestion || null, promptVersion: this.PROMPT_VERSION });
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await cs._buscarComTeto(cs.SUPABASE_URL + '/functions/v1/tec-ai', { method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cs.session.access_token }, body: requestBody });
      if (response.ok || ![429, 502, 503, 504].includes(response.status) || attempt === 1) break;
      await new Promise(resolve => setTimeout(resolve, 700 + Math.floor(Math.random() * 500)));
    }
    const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || 'A análise não pôde ser concluída.');
    state.analyses[analysisKey] = { ...(state.analyses[analysisKey] || {}), ...(body.analysis || body), updatedAt: new Date().toISOString() };
    this.save(state); this.render();
  },
  async runAI(section, question) {
    const button = document.getElementById(section === 'professor' ? 'tec-professor-send' : 'tec-ai-run'), old = button && button.textContent;
    if (button) { button.disabled = true; button.textContent = 'Analisando…'; }
    try { await this.callAI(section, question); showToast('🤖 Análise pronta'); } catch (e) { showToast('⚠️ ' + e.message); }
    finally { if (button) { button.disabled = false; button.textContent = old; } }
  },
  render() {
    const root = document.getElementById('screen-integracaotec'); if (!root) return;
    const state = this.state(), metrics = this.metrics(state);
    for (const [name, value] of Object.entries(metrics)) { const el = document.getElementById('tec-connect-' + name); if (el) el.textContent = String(value); }
    const empty = document.getElementById('tec-connect-empty'); if (empty) empty.hidden = metrics.questions > 0;
    const connected = state.connection.status === 'connected', stage = document.getElementById('tec-connect-stage'); if (stage) stage.textContent = connected ? 'TEC conectado' : 'Aguardando TEC';
    const status = document.getElementById('tec-connect-status');
    if (status) { const strong = status.querySelector('strong'), small = status.querySelector('small'), dot = status.querySelector('.tec-connect-dot');
      if (strong) strong.textContent = connected ? 'Ponte ativa' : 'Aguardando a ponte';
      if (small) small.textContent = connected ? `Conta ${state.connection.account || state.connection.tecAccount || 'identificada'} · caderno ${state.connection.bookId || '—'}` : 'Abra o TEC incorporado com o StudyMentor V21.';
      if (dot) dot.classList.toggle('connected', connected); }
    this.renderList(state); this.renderDetail(state);
  },
  bind() {
    const once = (id, event, fn) => { const el = document.getElementById(id); if (el && !el.dataset.tecBound) { el.dataset.tecBound = '1'; el.addEventListener(event, fn); } };
    once('tec-connect-start', 'click', () => this.openEmbedded());
    once('tec-connect-external', 'click', () => window.open(this.TEC_HOME, '_blank', 'noopener,noreferrer'));
    once('tec-connect-import', 'click', () => document.getElementById('tec-connect-file')?.click());
    once('tec-connect-file', 'change', e => { const f = e.target.files && e.target.files[0]; if (f) this.importJSON(f).catch(err => showToast('⚠️ ' + err.message)); e.target.value = ''; });
    once('tec-ai-run', 'click', () => {
      const state = this.state(), first = !this.analysisFor(state);
      this.runAI(first ? 'all' : (this.activeSection === 'professor' ? 'all' : this.activeSection));
    });
    once('tec-professor-send', 'click', () => { const input = document.getElementById('tec-professor-question'), q = this.text(input && input.value); if (q) this.runAI('professor', q); });
    const tabs = document.getElementById('tec-ai-tabs');
    if (tabs && !tabs.dataset.tecBound) { tabs.dataset.tecBound = '1'; tabs.addEventListener('click', e => { const b = e.target.closest('[data-section]'); if (!b) return;
      this.activeSection = b.dataset.section; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); this.renderAnalysis(this.state()); }); }
    if (!this._messageBound) { this._messageBound = true; window.addEventListener('message', e => this.onMessage(e)); }
    if (!this._storageBound) { this._storageBound = true; window.addEventListener('storage', e => { if (e.key === this._key()) this.render(); }); }
  },
  init() { this.bind(); this.render(); }
};
window.TecIntegracaoScreen = TecIntegracaoScreen;
window.addEventListener('screen:activated', e => { if (e.detail && e.detail.screen === 'integracaotec') TecIntegracaoScreen.init(); });
