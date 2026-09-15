/* ============================================================
   INTEGRAÇÃO TEC — workbench, biblioteca e IA pedagógica
   ============================================================ */
const TecIntegracaoScreen = {
  STORAGE_SUFFIX: 'tec-integracao:estado-v2',
  PROMPT_SUFFIX: 'tec-integracao:prompts-v2',
  TEC_ORIGIN: 'https://www.tecconcursos.com.br',
  TEC_HOME: 'https://www.tecconcursos.com.br/questoes/cadernos',
  PROMPT_VERSION: 'tec-pedagogico-v2',
  PROMPT_HISTORY_LIMIT: 20,
  selectedKey: null,
  activeSection: 'diagnostico',
  _messageBound: false,
  _storageBound: false,
  _experienceBound: false,

  DEFAULT_PROMPTS: {
    erro: `Você é um professor de alto nível especializado em concursos fiscais.

Analise criticamente o erro que cometi na questão abaixo.

1. Identifique o núcleo teórico efetivamente cobrado.
2. Compare diretamente a alternativa que EU MARQUEI com o GABARITO CORRETO.
3. Explique por que minha alternativa parece plausível e onde falha.
4. Explique por que o gabarito está correto.
5. Analise as demais alternativas e destaque pegadinhas.
6. Classifique a provável origem do erro.
7. Diga qual conhecimento preciso consolidar.
8. Termine com REGRA PARA MEMORIZAR, ALERTA DE PEGADINHA e UMA PERGUNTA CURTA.

Não invente fundamento normativo.

QUESTÃO:

{{QUESTAO}}`,
    acerto: `Você é um professor de alto nível especializado em concursos fiscais.

Eu ACERTEI a questão abaixo, mas quero aprofundá-la.

1. Identifique o núcleo teórico.
2. Explique por que o gabarito está correto.
3. Analise as demais alternativas.
4. Mostre conceitos próximos que a banca poderia confundir.
5. Diga o que preciso decorar e compreender.
6. Termine com uma pergunta curta.

QUESTÃO:

{{QUESTAO}}`,
    teoria: `Você é um professor de alto nível especializado em concursos fiscais.

Use a questão abaixo como DIAGNÓSTICO de uma possível lacuna e produza uma REVISÃO TEÓRICA COMPLETA, didática e tecnicamente rigorosa.

# Diagnóstico da lacuna
# Revisão teórica
# Quadro comparativo
# O que preciso decorar
# O que preciso compreender
# Resumo de revisão rápida
# Checklist de domínio

Não invente fundamento normativo.

QUESTÃO:

{{QUESTAO}}`,
    flashcards: `Você é especialista em aprendizagem ativa, revisão espaçada e concursos fiscais.

Crie FLASHCARDS a partir da questão abaixo, focando principalmente no meu erro. Compare o que EU MARQUEI, o GABARITO CORRETO, a diferença conceitual e as pegadinhas. Evite cartões redundantes.

QUESTÃO:

{{QUESTAO}}`,
    quiz: `Você é um professor de alto nível especializado em concursos fiscais.

Crie um teste curto e difícil para verificar se eu realmente dominei o núcleo teórico da questão. Priorize distinções conceituais, exceções e pegadinhas típicas de prova. Cada item deve ser autossuficiente e útil para revisão ativa.

Não invente fundamento normativo.

QUESTÃO:

{{QUESTAO}}`,
    reforco: `Você é um professor e estrategista de aprendizagem para concursos fiscais.

A partir da questão abaixo, prescreva um reforço objetivo e executável para eliminar a lacuna. Diga exatamente o que revisar, o que comparar, o que memorizar e que tipo de questões resolver. Evite tarefas genéricas e volumes irreais.

QUESTÃO:

{{QUESTAO}}`
  },
  PROMPT_LABELS: {
    erro: '🔎 Análise crítica do erro',
    acerto: '🔍 Aprofundamento do acerto',
    teoria: '📚 Revisão teórica',
    flashcards: '🧠 Flashcards',
    quiz: '🧪 Teste de domínio',
    reforco: '🎯 Plano de reforço'
  },

  _key() { try { return DB._profilePrefix() + this.STORAGE_SUFFIX; } catch (_) { return 'diario-estudos:' + this.STORAGE_SUFFIX; } },
  _promptKey() { try { return DB._profilePrefix() + this.PROMPT_SUFFIX; } catch (_) { return 'diario-estudos:' + this.PROMPT_SUFFIX; } },
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
    } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-integracao-save'); return false; }
  },
  promptBlank() { return { schema:2, prompts:{ ...this.DEFAULT_PROMPTS }, history:[], updatedAt:null }; },
  promptState() {
    try {
      const raw = JSON.parse(localStorage.getItem(this._promptKey()) || 'null');
      if (!raw || raw.schema !== 2 || !raw.prompts) return this.promptBlank();
      return { schema:2, prompts:{ ...this.DEFAULT_PROMPTS, ...raw.prompts }, history:Array.isArray(raw.history) ? raw.history.slice(-this.PROMPT_HISTORY_LIMIT) : [], updatedAt:raw.updatedAt || null };
    } catch (_) { return this.promptBlank(); }
  },
  savePromptState(next, snapshot = true) {
    const current = this.promptState();
    const changed = JSON.stringify(current.prompts) !== JSON.stringify(next.prompts);
    const out = { schema:2, prompts:{ ...this.DEFAULT_PROMPTS, ...(next.prompts || {}) }, history:Array.isArray(next.history) ? next.history.slice(-this.PROMPT_HISTORY_LIMIT) : [], updatedAt:new Date().toISOString() };
    if (snapshot && changed) out.history = [...out.history, { savedAt:new Date().toISOString(), prompts:{ ...current.prompts } }].slice(-this.PROMPT_HISTORY_LIMIT);
    try {
      localStorage.setItem(this._promptKey(), JSON.stringify(out));
      if (typeof SectionSync !== 'undefined' && SectionSync.markDirty) SectionSync.markDirty(this._promptKey());
      if (window.CloudStore && CloudStore.notifyChange) CloudStore.notifyChange();
      return true;
    } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-prompt-save'); return false; }
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
      this.save(state); this.render(); if (typeof showToast === 'function') showToast('🔌 TEC conectado ao Study');
    } else if (msg.type === 'question') {
      try { this.ingest(msg.payload && msg.payload.question, msg.payload || {}); if (typeof showToast === 'function') showToast('✅ Questão recebida do TEC'); }
      catch (e) { if (typeof showToast === 'function') showToast('⚠️ ' + e.message); }
    }
  },

  openEmbedded() {
    const frame = document.getElementById('tec-workspace-frame'), placeholder = document.getElementById('tec-workspace-placeholder');
    if (!frame) return;
    frame.hidden = false; if (placeholder) placeholder.hidden = true; if (!frame.src) frame.src = this.TEC_HOME;
    try { sessionStorage.setItem('snm:tec-workspace-open', '1'); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-workspace-session-save'); }
    document.getElementById('screen-integracaotec')?.classList.add('tec-workspace-open');
    const msg = document.getElementById('tec-connect-message');
    if (msg) msg.textContent = 'Companion ativo: resolva normalmente no TEC. As respostas são capturadas e confirmadas pela fila durável.';
  },
  reloadEmbedded() {
    const frame = document.getElementById('tec-workspace-frame'); if (!frame) return;
    const src = frame.getAttribute('src') || this.TEC_HOME; frame.setAttribute('src', src);
    if (typeof showToast === 'function') showToast('↻ TEC recarregado');
  },
  toggleFocus(force) {
    const root = document.getElementById('screen-integracaotec'); if (!root) return;
    const on = typeof force === 'boolean' ? force : !root.classList.contains('tec-focus-mode');
    root.classList.toggle('tec-focus-mode', on); document.body.classList.toggle('tec-workbench-lock', on);
    const b = document.getElementById('tec-workspace-focus'); if (b) b.textContent = on ? '↙ Sair do foco' : '⛶ Modo foco';
    if (on) this.openEmbedded();
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
    if (typeof showToast === 'function') showToast(`📥 ${questions.length} questão(ões) importada(s)`);
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
      const badge = q.acertou === true ? '✓' : q.acertou === false ? '×' : '•';
      button.append(this.createText('strong', `${badge} #${q.id || '—'} · ${q.materia || 'Matéria não identificada'}`));
      button.append(this.createText('small', `${q.assunto || q.banca || 'Sem assunto'} · caderno ${row.bookId || '—'}`));
      button.addEventListener('click', () => { this.selectedKey = row.key; this.render(); }); list.append(button);
    });
  },
  renderDetail(state) {
    const root = document.getElementById('tec-question-detail'); if (!root) return; root.replaceChildren();
    const row = state.questions && state.questions[this.selectedKey], run = document.getElementById('tec-ai-run');
    if (!row) { if (run) run.disabled = true; root.append(this.createText('div', 'Nenhuma questão selecionada.', 'tec-connect-empty')); return; }
    const q = row.question || {}; if (run) run.disabled = false;
    const sub = document.getElementById('tec-assistant-sub'); if (sub) sub.textContent = `#${q.id || '—'} · ${q.materia || 'matéria não identificada'} · ${q.acertou === true ? 'acerto' : q.acertou === false ? 'erro' : 'sem resultado'}`;
    root.append(this.createText('p', q.enunciado || 'Enunciado não capturado.', 'tec-question-statement'));
    const alternatives = document.createElement('div'); alternatives.className = 'tec-question-alternatives';
    (q.alternativas || []).forEach(a => { const item = this.createText('div', `${a.letra}) ${a.texto}`);
      if (a.letra === q.correta || a.correta) item.classList.add('correct');
      if (a.letra === q.marcada || a.marcadaPorMim) item.classList.add('selected'); alternatives.append(item); });
    root.append(alternatives); this.renderAnalysis(state);
  },

  questionText(q = {}) {
    const alternatives = (q.alternativas || []).map(a => `${a.letra || '—'}) ${a.texto || ''}${a.letra === q.marcada || a.marcadaPorMim ? ' [MINHA RESPOSTA]' : ''}${a.letra === q.correta || a.correta ? ' [GABARITO]' : ''}`).join('\n');
    return [
      `ID: ${q.id || '—'}`,
      `Banca: ${q.banca || '—'}`,
      `Concurso: ${q.concurso || '—'}`,
      `Matéria: ${q.materia || '—'}`,
      `Assunto: ${q.assunto || '—'}`,
      '', 'Enunciado:', q.enunciado || '—', '', 'Alternativas:', alternatives || '—', '',
      `Minha resposta: ${q.marcada || '—'}`,
      `Gabarito: ${q.correta || '—'}`,
      `Resultado: ${q.acertou === true ? 'ACERTOU' : q.acertou === false ? 'ERROU' : 'NÃO IDENTIFICADO'}`
    ].join('\n');
  },
  renderPromptTemplate(template, q = {}) {
    const alternatives = (q.alternativas || []).map(a => `${a.letra || '—'}) ${a.texto || ''}`).join('\n');
    const values = {
      QUESTAO:this.questionText(q), ID:q.id || '—', BANCA:q.banca || '—', CONCURSO:q.concurso || '—', MATERIA:q.materia || '—', ASSUNTO:q.assunto || '—',
      ENUNCIADO:q.enunciado || '—', ALTERNATIVAS:alternatives || '—', MINHA_RESPOSTA:q.marcada || '—', GABARITO:q.correta || '—',
      RESULTADO:q.acertou === true ? 'ACERTOU' : q.acertou === false ? 'ERROU' : 'NÃO IDENTIFICADO'
    };
    return String(template || '').replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => String(values[key] == null ? '' : values[key]));
  },
  promptKindFor(section, q) {
    if (section === 'diagnostico') return q && q.acertou === true ? 'acerto' : q && q.acertou === false ? 'erro' : 'teoria';
    if (section === 'revisao') return 'teoria';
    if (['flashcards','quiz','reforco'].includes(section)) return section;
    return null;
  },
  customPromptsFor(section, q) {
    const st = this.promptState();
    const sections = section === 'all' ? ['diagnostico','revisao','flashcards'] : [section];
    const out = {};
    sections.forEach(sec => { const kind = this.promptKindFor(sec, q); if (kind && st.prompts[kind]) out[sec] = this.renderPromptTemplate(st.prompts[kind], q); });
    return out;
  },

  analysisFor(state) { return state.analyses && state.analyses[this.selectedKey + ':' + this.PROMPT_VERSION]; },
  renderAnalysis(state) {
    const content = document.getElementById('tec-ai-content'); if (!content) return;
    const professor = document.getElementById('tec-professor-box'); if (professor) professor.hidden = this.activeSection !== 'professor';
    content.replaceChildren(); const analysis = this.analysisFor(state), value = analysis && analysis[this.activeSection];
    const run = document.getElementById('tec-ai-run');
    if (run) {
      run.hidden = this.activeSection === 'professor';
      run.textContent = value ? 'Reprocessar esta aba' : (analysis ? 'Gerar esta aba' : 'Gerar análise essencial');
    }
    if (!value) {
      content.textContent = this.activeSection === 'professor'
        ? 'Faça uma pergunta usando a questão e as análises já produzidas como contexto.'
        : 'A IA usa os seus prompts pedagógicos. Gere a análise essencial ou apenas esta aba.';
      return;
    }
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
    if (typeof showToast === 'function') showToast('✅ Reforço adicionado às Atividades Extras');
  },
  async callAI(section, professorQuestion) {
    const state = this.state(), row = state.questions && state.questions[this.selectedKey]; if (!row) throw new Error('Selecione uma questão.');
    const cs = window.CloudStore;
    if (!cs || !cs.isLoggedIn || !cs.isLoggedIn() || !cs.session) throw new Error('Entre na sua conta do Study para usar a IA.');
    const analysisKey = row.key + ':' + this.PROMPT_VERSION;
    const requestBody = JSON.stringify({ question:row.question, history:row.history, existingAnalysis:state.analyses[analysisKey] || null,
      section:section || 'diagnostico', professorQuestion:professorQuestion || null, promptVersion:this.PROMPT_VERSION,
      customPrompts:this.customPromptsFor(section, row.question) });
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await cs._buscarComTeto(cs.SUPABASE_URL + '/functions/v1/tec-ai', { method:'POST',
        headers:{ 'content-type':'application/json', authorization:'Bearer ' + cs.session.access_token }, body:requestBody });
      if (response.ok || ![429,502,503,504].includes(response.status) || attempt === 1) break;
      await new Promise(resolve => setTimeout(resolve, 700 + Math.floor(Math.random() * 500)));
    }
    const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || 'A análise não pôde ser concluída.');
    state.analyses[analysisKey] = { ...(state.analyses[analysisKey] || {}), ...(body.analysis || body), updatedAt:new Date().toISOString() };
    if (!this.save(state)) throw new Error('A análise foi gerada, mas não pôde ser salva.');
    return body.analysis || body;
  },
  async runAI(section, question) {
    const isProfessor = section === 'professor';
    const button = document.getElementById(isProfessor ? 'tec-professor-send' : 'tec-ai-run'), old = button && button.textContent;
    if (button) { button.disabled = true; button.textContent = isProfessor ? 'Consultando…' : 'Analisando…'; }
    try {
      if (section === 'all') {
        for (const part of ['diagnostico','revisao','flashcards']) await this.callAI(part, null);
      } else await this.callAI(section, question);
      this.render(); if (typeof showToast === 'function') showToast('🤖 Análise pronta');
    } catch (e) { if (typeof showToast === 'function') showToast('⚠️ ' + e.message); }
    finally {
      if (button) { button.disabled = false; if (isProfessor) button.textContent = old; }
      if (!isProfessor) this.renderAnalysis(this.state());
    }
  },

  ensurePromptModal() {
    let modal = document.getElementById('tec-prompt-modal'); if (modal) return modal;
    modal = document.createElement('div'); modal.id = 'tec-prompt-modal'; modal.className = 'cards-modal tec-prompt-modal'; modal.style.display = 'none';
    modal.innerHTML = `<div class="cards-modal-box tec-prompt-box"><div class="cards-modal-head"><div><h2>⚙️ Prompts da IA</h2><p class="sub">Os prompts ficam no seu perfil. Cada alteração preserva a versão anterior.</p></div><button type="button" class="icon-btn" id="tec-prompt-x" aria-label="Fechar">✕</button></div><div class="cards-modal-body"><div class="field"><label for="tec-prompt-kind">Prompt</label><select id="tec-prompt-kind"></select></div><div class="field"><label for="tec-prompt-text">Instruções</label><textarea id="tec-prompt-text" class="tec-prompt-text"></textarea><p class="hint">Placeholders: {{QUESTAO}}, {{ID}}, {{BANCA}}, {{CONCURSO}}, {{MATERIA}}, {{ASSUNTO}}, {{ENUNCIADO}}, {{ALTERNATIVAS}}, {{MINHA_RESPOSTA}}, {{GABARITO}}, {{RESULTADO}}</p></div><details class="tec-prompt-history-wrap"><summary>Histórico de versões</summary><div id="tec-prompt-history" class="tec-prompt-history"></div></details></div><div class="cards-modal-foot"><button type="button" class="btn-secondary" id="tec-prompt-reset">↺ Restaurar este padrão</button><span style="flex:1"></span><button type="button" class="btn-secondary" id="tec-prompt-cancel">Cancelar</button><button type="button" class="btn-primary" id="tec-prompt-save">Salvar prompts</button></div></div>`;
    document.body.appendChild(modal);
    const sel = modal.querySelector('#tec-prompt-kind');
    Object.entries(this.PROMPT_LABELS).forEach(([k,label]) => { const o=document.createElement('option'); o.value=k; o.textContent=label; sel.appendChild(o); });
    sel.addEventListener('change', () => this.loadPromptEditor(sel.value));
    modal.querySelector('#tec-prompt-x').addEventListener('click', () => this.closePromptEditor());
    modal.querySelector('#tec-prompt-cancel').addEventListener('click', () => this.closePromptEditor());
    modal.querySelector('#tec-prompt-save').addEventListener('click', () => this.savePromptEditor());
    modal.querySelector('#tec-prompt-reset').addEventListener('click', () => this.resetPromptEditor());
    modal.querySelector('#tec-prompt-history').addEventListener('click', e => { const b=e.target.closest('[data-history-index]'); if (b) this.restorePromptVersion(Number(b.dataset.historyIndex)); });
    return modal;
  },
  loadPromptEditor(kind) {
    const modal=this.ensurePromptModal(), st=this.promptState(), key=kind || modal.querySelector('#tec-prompt-kind').value || 'erro';
    modal.querySelector('#tec-prompt-kind').value=key; modal.querySelector('#tec-prompt-text').value=st.prompts[key] || '';
    const hist=modal.querySelector('#tec-prompt-history'); hist.replaceChildren();
    if (!st.history.length) { hist.append(this.createText('p','Ainda não há versões anteriores.','hint')); return; }
    [...st.history].reverse().forEach((v,revIdx) => { const index=st.history.length-1-revIdx, row=document.createElement('div'); row.className='tec-prompt-history-row';
      const when=new Date(v.savedAt); row.append(this.createText('span', Number.isNaN(when.getTime()) ? `Versão ${index+1}` : when.toLocaleString('pt-BR')));
      const b=this.createText('button','Restaurar','btn-secondary'); b.type='button'; b.dataset.historyIndex=String(index); row.append(b); hist.append(row); });
  },
  openPromptEditor() { const modal=this.ensurePromptModal(); modal.style.display='flex'; this.loadPromptEditor(modal.querySelector('#tec-prompt-kind').value || 'erro'); },
  closePromptEditor() { const modal=document.getElementById('tec-prompt-modal'); if (modal) modal.style.display='none'; },
  savePromptEditor() {
    const modal=this.ensurePromptModal(), st=this.promptState(), kind=modal.querySelector('#tec-prompt-kind').value, value=this.text(modal.querySelector('#tec-prompt-text').value);
    if (!value) { if (typeof showToast === 'function') showToast('⚠️ O prompt não pode ficar vazio.'); return; }
    st.prompts[kind]=value; if (this.savePromptState(st,true)) { this.loadPromptEditor(kind); if (typeof showToast === 'function') showToast('✅ Prompt salvo com histórico'); }
  },
  resetPromptEditor() {
    const modal=this.ensurePromptModal(), kind=modal.querySelector('#tec-prompt-kind').value, st=this.promptState(); st.prompts[kind]=this.DEFAULT_PROMPTS[kind];
    if (this.savePromptState(st,true)) { this.loadPromptEditor(kind); if (typeof showToast === 'function') showToast('↺ Prompt padrão restaurado'); }
  },
  restorePromptVersion(index) {
    const st=this.promptState(), version=st.history[index]; if (!version || !version.prompts) return;
    st.prompts={ ...this.DEFAULT_PROMPTS, ...version.prompts }; if (this.savePromptState(st,true)) { this.loadPromptEditor(document.getElementById('tec-prompt-kind')?.value || 'erro'); if (typeof showToast === 'function') showToast('✅ Versão de prompts restaurada'); }
  },

  ensureExperienceUI() {
    const root=document.getElementById('screen-integracaotec'); if (!root) return;
    root.classList.add('tec-workbench-v2');
    const subtitle=root.querySelector('.page-subtitle'); if (subtitle) subtitle.textContent='Resolva no TEC em uma área ampla; o Companion registra o desempenho e a IA transforma cada questão em diagnóstico, revisão e reforço.';
    const hero=root.querySelector('.tec-connect-hero'); if (hero) hero.hidden=true;
    const message=document.getElementById('tec-connect-message'); if (message) message.textContent='O StudyNoMentor Companion faz a ponte em tempo real. Importação JSON permanece apenas como contingência.';
    const workspace=root.querySelector('.tec-workspace-card');
    const wh=workspace?.querySelector('.card-header');
    if (wh && !wh.querySelector('.tec-workspace-tools')) {
      const tools=document.createElement('div'); tools.className='tec-workspace-tools';
      tools.innerHTML='<button type="button" class="btn-secondary" id="tec-workspace-reload">↻ Recarregar</button><button type="button" class="btn-secondary" id="tec-workspace-open-external">↗ Separado</button><button type="button" class="btn-primary" id="tec-workspace-focus">⛶ Modo foco</button>';
      wh.appendChild(tools);
      tools.querySelector('#tec-workspace-reload').addEventListener('click',()=>this.reloadEmbedded());
      tools.querySelector('#tec-workspace-open-external').addEventListener('click',()=>window.open(this.TEC_HOME,'_blank','noopener,noreferrer'));
      tools.querySelector('#tec-workspace-focus').addEventListener('click',()=>this.toggleFocus());
    }
    const assistant=root.querySelector('.tec-assistant-card .card-header');
    if (assistant && !document.getElementById('tec-ai-prompts')) {
      const run=document.getElementById('tec-ai-run'), tools=document.createElement('div'); tools.className='tec-ai-head-actions';
      const prompts=this.createText('button','⚙ Prompts','btn-secondary'); prompts.type='button'; prompts.id='tec-ai-prompts'; prompts.addEventListener('click',()=>this.openPromptEditor());
      if (run) { run.parentElement?.removeChild(run); tools.append(prompts,run); } else tools.append(prompts); assistant.appendChild(tools);
    }
    this.ensurePromptModal();
    if (!this._experienceBound) {
      this._experienceBound=true;
      document.addEventListener('keydown',e=>{ if (e.key==='Escape' && root.classList.contains('tec-focus-mode')) this.toggleFocus(false); });
    }
    try { if (sessionStorage.getItem('snm:tec-workspace-open')==='1') this.openEmbedded(); }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-workspace-session-read'); }
  },

  render() {
    const root = document.getElementById('screen-integracaotec'); if (!root) return;
    this.ensureExperienceUI();
    const state = this.state(), metrics = this.metrics(state);
    for (const [name, value] of Object.entries(metrics)) { const el = document.getElementById('tec-connect-' + name); if (el) el.textContent = String(value); }
    const empty = document.getElementById('tec-connect-empty'); if (empty) empty.hidden = metrics.questions > 0;
    const connected = state.connection.status === 'connected', stage = document.getElementById('tec-connect-stage'); if (stage) stage.textContent = connected ? 'Companion conectado' : 'Aguardando TEC';
    const status = document.getElementById('tec-connect-status');
    if (status) { const strong = status.querySelector('strong'), small = status.querySelector('small'), dot = status.querySelector('.tec-connect-dot');
      if (strong) strong.textContent = connected ? 'Ponte ativa' : 'Aguardando o Companion';
      if (small) small.textContent = connected ? `Conta ${state.connection.account || state.connection.tecAccount || 'identificada'} · caderno ${state.connection.bookId || '—'}` : 'Abra o TEC incorporado com o StudyNoMentor Companion ativo.';
      if (dot) dot.classList.toggle('connected', connected); }
    this.renderList(state); this.renderDetail(state);
  },
  bind() {
    const once = (id, event, fn) => { const el = document.getElementById(id); if (el && !el.dataset.tecBound) { el.dataset.tecBound = '1'; el.addEventListener(event, fn); } };
    once('tec-connect-start', 'click', () => this.openEmbedded());
    once('tec-connect-external', 'click', () => window.open(this.TEC_HOME, '_blank', 'noopener,noreferrer'));
    once('tec-connect-import', 'click', () => document.getElementById('tec-connect-file')?.click());
    once('tec-connect-file', 'change', e => { const f = e.target.files && e.target.files[0]; if (f) this.importJSON(f).catch(err => { if (typeof showToast === 'function') showToast('⚠️ ' + err.message); }); e.target.value = ''; });
    once('tec-ai-run', 'click', () => {
      const state = this.state(), first = !this.analysisFor(state);
      this.runAI(first ? 'all' : (this.activeSection === 'professor' ? 'diagnostico' : this.activeSection));
    });
    once('tec-professor-send', 'click', () => { const input = document.getElementById('tec-professor-question'), q = this.text(input && input.value); if (q) this.runAI('professor', q); });
    const tabs = document.getElementById('tec-ai-tabs');
    if (tabs && !tabs.dataset.tecBound) { tabs.dataset.tecBound = '1'; tabs.addEventListener('click', e => { const b = e.target.closest('[data-section]'); if (!b) return;
      this.activeSection = b.dataset.section; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); this.renderAnalysis(this.state()); }); }
    if (!this._messageBound) { this._messageBound = true; window.addEventListener('message', e => this.onMessage(e)); }
    if (!this._storageBound) { this._storageBound = true; window.addEventListener('storage', e => { if (e.key === this._key() || e.key === this._promptKey()) this.render(); }); }
  },
  init() { this.bind(); this.ensureExperienceUI(); this.render(); }
};
window.TecIntegracaoScreen = TecIntegracaoScreen;
window.addEventListener('screen:activated', e => { if (e.detail && e.detail.screen === 'integracaotec') TecIntegracaoScreen.init(); });