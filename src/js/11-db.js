/* ============================================================
   CAMADA DE DADOS — usada por todas as telas do app
   ============================================================ */
const DB = {
  // ---- Camada de PERFIL: tudo é namespaced pelo perfil ativo (multi-usuário no dispositivo) ----
  PROFILES_KEY: 'diario-estudos:profiles',
  ACTIVE_PROFILE_KEY: 'diario-estudos:active-profile',
  _profilePrefix() {
    try {
      const pid = localStorage.getItem(this.ACTIVE_PROFILE_KEY);
      return pid ? 'diario-estudos:u:' + pid + ':' : 'diario-estudos:';
    } catch (e) { return 'diario-estudos:'; }
  },
  // Chaves globais DO PERFIL ativo (lista de planejamentos e planejamento ativo)
  get GLOBAL_KEYS() {
    const p = this._profilePrefix();
    return { plans: p + 'planejamentos', activePlan: p + 'active-plan' };
  },
  // Chaves "legadas" (versão sem planejamentos) — usadas só na migração inicial
  LEGACY_KEYS: {
    entries: 'diario-estudos:entries',
    subjects: 'diario-estudos:subjects',
    methods: 'diario-estudos:methods',
    phases: 'diario-estudos:phases',
    currentCycle: 'diario-estudos:current-cycle',
    cycleHistory: 'diario-estudos:cycle-history',
    tracks: 'diario-estudos:tracks'
  },
  _activePlanId() {
    try { return localStorage.getItem(this.GLOBAL_KEYS.activePlan) || 'default'; }
    catch (e) { return 'default'; }
  },
  // Monta o conjunto de chaves namespaced de UM planejamento qualquer (dentro do perfil ativo)
  keysForPlan(planId) {
    const base = this._profilePrefix() + 'p:' + planId + ':';
    return {
      entries: base + 'entries',
      subjects: base + 'subjects',
      methods: base + 'methods',
      phases: base + 'phases',
      statuses: base + 'statuses',
      modes: base + 'modes',
      currentCycle: base + 'current-cycle',
      cycleHistory: base + 'cycle-history',
      tracks: base + 'tracks',
      tec: base + 'tec',
      gradeTemplate: base + 'grade-template',
      savedGrades: base + 'saved-grades',
      customSiglas: base + 'custom-siglas',
      leis: base + 'leis',
      leiKeywords: base + 'lei-keywords',
      decks: base + 'decks',
      cards: base + 'cards',
      links: base + 'links',
      incidencia: base + 'incidencia',
      lastCycleSetup: base + 'last-cycle-setup',
      extras: base + 'extras',
      revlog: base + 'revlog'
    };
  },
  // KEYS "dinâmico": sempre aponta para o planejamento ativo no momento da leitura
  get KEYS() { return this.keysForPlan(this._activePlanId()); },

  DEFAULT_METHODS: ['Videoaula', 'Leitura', 'PDF', 'Resumo', 'Questões', 'Revisão Teórica', 'Mapa mental', 'Outro'],
  DEFAULT_PHASES: ['Novo', 'Sólido'],
  // Modos de estudo de cada disciplina na trilha de Estudo Novo (configuráveis)
  DEFAULT_MODES: ['Resumo + Mapa', 'Passo Estratégico', 'Teoria'],
  // Status das aulas na trilha de Estudo Novo. "done" marca quais contam como concluída no progresso.
  DEFAULT_STATUSES: [
    /* Tons de TEXTO, nao os de preenchimento: sobre o proprio fundo suave, o
       #e0393f dava 3,81:1, o #d97a12 dava 2,80:1 e o #0f9d63 dava 3,13:1 — os
       tres abaixo do minimo 4,5:1 do WCAG AA. Os tons abaixo ficam entre 5,2:1
       e 6,0:1, com a mesma leitura de cor (vermelho / laranja / verde).
       Vale so para perfis NOVOS: quem ja escolheu suas cores mantem as dele. */
    { nome: 'ESTUDAR', color: '#b3282e', bg: '#fdecee', done: false },
    { nome: 'ESTUDANDO', color: '#9a5200', bg: '#fdf1e2', done: false },
    { nome: 'CONCLUÍDO', color: '#0a6b44', bg: '#e5f7ee', done: true }
  ],
  // Paleta de cores oferecida ao personalizar um status (cor forte + tinta clara de fundo)
  STATUS_PALETTE: [
    { color: '#b3282e', bg: '#fdecee' },
    { color: '#9a5200', bg: '#fdf1e2' },
    { color: '#c9a20a', bg: '#fbf6df' },
    { color: '#0a6b44', bg: '#e5f7ee' },
    { color: '#0a95a8', bg: '#e2f6f8' },
    { color: '#4f46e5', bg: '#eef0fd' },
    { color: '#b3308a', bg: '#fbe8f4' },
    { color: '#5b6270', bg: '#eef0f3' }
  ],
  // Definição das 3 etapas de resolução de cada aula (com o nome do campo legado por percentual)
  STAGE_DEFS: [
    { key: 'r1', legacy: 'pct1', label: '1ª Resolução' },
    { key: 'rCheck', legacy: 'pctCheckpoint', label: 'Checkpoint' },
    { key: 'rRev', legacy: 'pctRevisao', label: 'Revisão' }
  ],

  _get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Erro ao ler', key, e);
      return fallback;
    }
  },
  _set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Estouro de cota (imagens coladas em cards, leis longas, muitos retratos do TEC).
      // Antes, a exceção subia e abortava a operação em silêncio — o dado simplesmente
      // não era salvo e nada avisava o usuário.
      const cota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
      console.error('Falha ao gravar', key, e);
      if (cota) {
        if (!DB._quotaAvisado) {
          DB._quotaAvisado = true;
          setTimeout(() => { DB._quotaAvisado = false; }, 15000);
          const uso = DB.storageUsageMB();
          try {
            showToast('⚠ Armazenamento cheio (' + uso + ' MB): este dado NÃO foi salvo. Libere espaço em Configurações → exporte um backup e apague imagens de cards ou leis antigas.');
          } catch (_) { try { UI.alert('Armazenamento do navegador cheio (' + uso + ' MB). O último dado não foi salvo. Faça um backup e libere espaço.', { title: 'Armazenamento cheio' }); } catch (__) { _quiet(__); } }
        }
      } else {
        try { showToast('⚠ Não foi possível salvar. Verifique se o navegador não está em modo privado.'); } catch (_) { _quiet(_); }
      }
      return false;
    }
    // dispara sincronização automática com atraso (se conectado à nuvem) — não bloqueia a escrita
    if (_cloudNotifyHook) _cloudNotifyHook();
    if (_sectionMarkHook) _sectionMarkHook(key); // marca a seção alterada (sync por seção)
    return true;
  },
  /* ── CANAL ÚNICO DE ESCRITA ────────────────────────────────────────────────
     _set serve para valores JSON. Mas dezenas de pontos do app guardam TEXTO
     puro (preferências de tela, sinalizadores de painel recolhido, escala da
     fonte...) e chamavam localStorage.setItem direto. Isso pulava o aviso da
     camada por seção: o dado subia só no "blob" periódico e a linha da seção
     correspondente ficava velha na nuvem. Como a LEITURA hoje vem das seções,
     ao abrir em outro aparelho o valor voltava desatualizado — parecia que a
     alteração "não tinha salvo".

     setRaw/delRaw dão a esses pontos o mesmo caminho de _set: grava, avisa a
     nuvem e marca a seção. Toda escrita no namespace do perfil deve passar por
     _set, setRaw ou delRaw — nunca por localStorage direto. */
  setRaw(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (e) {
      console.error('Falha ao gravar', key, e);
      try { showToast('⚠ Não foi possível salvar. Verifique o espaço do navegador ou o modo privado.'); } catch (_) { _quiet(_, 'setRaw-aviso'); }
      return false;
    }
    if (_cloudNotifyHook) _cloudNotifyHook();
    if (_sectionMarkHook) _sectionMarkHook(key);
    return true;
  },
  delRaw(key) {
    try { localStorage.removeItem(key); } catch (e) { _quiet(e, 'delRaw'); return false; }
    if (_cloudNotifyHook) _cloudNotifyHook();
    if (_sectionDropHook) _sectionDropHook(key);
    return true;
  },
  _del(key) { return this.delRaw(key); },
  // Quanto o app está ocupando no navegador (útil na mensagem de cota e em Configurações)
  storageUsageMB() {
    try {
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        n += (k.length + (localStorage.getItem(k) || '').length);
      }
      return (n * 2 / 1048576).toFixed(1); // UTF-16: ~2 bytes por caractere
    } catch (_) { return '?'; }
  },
  /* ── AVISO ANTECIPADO DE ESPAÇO ────────────────────────────────────────────
     O tratamento de QuotaExceededError em _set já existe, mas age DEPOIS do
     estouro: você descobre que acabou o espaço no instante em que um dado deixa
     de ser salvo — no meio de uma revisão, por exemplo. Este aviso chega antes,
     enquanto ainda dá tempo de exportar um backup com calma.

     O limite depende de ONDE o app está gravando:
       · sobre a fachada de IndexedDB (o normal) → centenas de MB; o alerta só
         faz sentido perto do teto real informado pelo navegador;
       · caída no localStorage nativo (modo privado antigo, navegador sem
         suporte) → ~5 MB, e aí o aperto chega rápido.
     Sem essa distinção, o aviso dispararia com 4 MB mesmo havendo 500 MB livres. */
  LIMITE_NATIVO_MB: 5,
  _quotaAvisoKey() { return 'diario-estudos:quota-aviso'; },
  async checarEspaco() {
    try {
      const hoje = todayLocal();
      if (localStorage.getItem(this._quotaAvisoKey()) === hoje) return; // 1x por dia
      const usoMB = parseFloat(this.storageUsageMB());
      if (!isFinite(usoMB)) return;

      let limiteMB = this.LIMITE_NATIVO_MB, sobreIDB = false;
      if (window.__idbShim) {
        sobreIDB = true;
        limiteMB = 512; // piso conservador se o navegador não informar a cota
        try {
          if (navigator.storage && navigator.storage.estimate) {
            const est = await navigator.storage.estimate();
            if (est && est.quota) limiteMB = est.quota / 1048576;
          }
        } catch (_) { _quiet(_); }
      }
      const pct = usoMB / limiteMB;
      const gatilho = sobreIDB ? 0.85 : 0.75;
      if (pct < gatilho) return;

      localStorage.setItem(this._quotaAvisoKey(), hoje);
      const msg = pct >= 0.95
        ? '🛑 Espaço quase no fim (' + usoMB.toFixed(1) + ' MB de ~' + Math.round(limiteMB) + ' MB). Exporte um backup AGORA — a partir daqui alterações podem deixar de ser salvas.'
        : '⚠ Armazenamento em ' + Math.round(pct * 100) + '% (' + usoMB.toFixed(1) + ' MB). Veja o medidor em Configurações e considere limpar imagens de cards ou retratos antigos do TEC.';
      setTimeout(() => { try { showToast(msg); } catch (_) { _quiet(_); } }, 2500);
    } catch (_) { _quiet(_); }
  },
  _uid() {
    // UUID v4 real quando disponível. crypto.randomUUID exige contexto seguro —
    // funciona em file:// e https://, mas NÃO em http:// simples (ex.: servir de um NAS).
    // Por isso o fallback com getRandomValues, e só então o antigo baseado em Math.random.
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
      }
    } catch (_) { _quiet(_); }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  },

  // --- Entries (Diário) ---
  getEntries() { return this._get(this.KEYS.entries, []); },
  /* Devolve o ENTRY quando a gravacao deu certo e null quando falhou (cota
     estourada, modo privado). Antes devolvia sempre o entry, entao a tela dizia
     "Estudo registrado" mesmo quando o localStorage recusou a escrita — foi
     assim que registros "sumiram" sem aviso nenhum. */
  saveEntry(entry) {
    const entries = this.getEntries();
    entries.push(entry);
    if (this._set(this.KEYS.entries, entries) === false) return null;
    return entry;
  },
  /* Comparação por TEXTO, de propósito. Registros antigos têm id NUMÉRICO
     (Date.now()) e os novos têm UUID em texto. Além disso o id passa pelo DOM
     via data-id, que sempre devolve texto. Comparar com === puro faria o app
     "não achar" o registro conforme o tipo, e editar/excluir falhariam em
     silêncio. String() dos dois lados atende os dois formatos. */
  _mesmoId(a, b) { return String(a) === String(b); },
  deleteEntry(id) {
    const entries = this.getEntries().filter(e => !this._mesmoId(e.id, id));
    return this._set(this.KEYS.entries, entries) !== false;
  },
  updateEntry(id, patch) {
    const entries = this.getEntries();
    const e = entries.find(x => this._mesmoId(x.id, id));
    if (e) Object.assign(e, patch);
    if (this._set(this.KEYS.entries, entries) === false) return null;
    return e;
  },
  getEntry(id) { return this.getEntries().find(e => this._mesmoId(e.id, id)); },

  // --- Subjects (cadastro mestre de matérias) ---
  getSubjects() {
    // migra registros antigos (sem id/ativo) transparentemente
    const list = this._get(this.KEYS.subjects, []);
    let migrated = false;
    list.forEach(s => {
      if (!s.id) { s.id = this._uid(); migrated = true; }
      if (s.ativo === undefined) { s.ativo = true; migrated = true; }
    });
    if (migrated) this._set(this.KEYS.subjects, list);
    return list;
  },
  getActiveSubjects() { return this.getSubjects().filter(s => s.ativo); },
  saveSubjects(list) { this._set(this.KEYS.subjects, list); },
  upsertSubjectName(name) {
    // garante que toda matéria digitada no Diário exista no cadastro mestre
    const subjects = this.getSubjects();
    if (!subjects.find(s => s.nome.toLowerCase() === name.toLowerCase())) {
      subjects.push({ id: this._uid(), nome: name, dificuldade: 3, fase: 'Novo', ativo: true });
      this._set(this.KEYS.subjects, subjects);
    }
  },
  addSubject(data) {
    const subjects = this.getSubjects();
    subjects.push({ id: this._uid(), nome: data.nome, dificuldade: data.dificuldade || 3, fase: data.fase || 'Novo', ativo: true });
    this._set(this.KEYS.subjects, subjects);
  },
  updateSubject(id, patch) {
    const subjects = this.getSubjects();
    const s = subjects.find(x => x.id === id);
    if (s) Object.assign(s, patch);
    this._set(this.KEYS.subjects, subjects);
  },
  setSubjectActive(id, ativo) { this.updateSubject(id, { ativo }); },
  // normaliza nome p/ casamento robusto (sem acento/espaços extras/caixa)
  _normSubj(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  },
  // Renomeia a matéria e PROPAGA para tudo que a referencia por nome:
  // registros, ciclo ativo (matérias + grade), trilhas do Estudo Novo e histórico.
  // Retorna { ok, reason, changed:{...} }. Bloqueia colisão com outra matéria existente.
  renameSubjectEverywhere(id, newNameRaw) {
    const newName = String(newNameRaw || '').trim();
    if (!newName) return { ok: false, reason: 'empty' };
    const subjects = this.getSubjects();
    const target = subjects.find(x => x.id === id);
    if (!target) return { ok: false, reason: 'not-found' };
    const oldName = target.nome;
    if (oldName === newName) return { ok: true, reason: 'unchanged', changed: {} };
    // colisão: já existe OUTRA matéria com esse nome (mesmo ignorando acento/caixa)
    const collision = subjects.find(x => x.id !== id && this._normSubj(x.nome) === this._normSubj(newName));
    if (collision) return { ok: false, reason: 'collision', collisionName: collision.nome };

    const oldKey = this._normSubj(oldName);
    const changed = { entries: 0, cycle: false, gradeCells: 0, track: false, history: 0 };

    // 1) catálogo
    target.nome = newName;
    this._set(this.KEYS.subjects, subjects);

    // 2) registros
    const entries = this.getEntries();
    entries.forEach(e => { if (this._normSubj(e.subject) === oldKey) { e.subject = newName; changed.entries++; } });
    if (changed.entries) this._set(this.KEYS.entries, entries);

    // 3) ciclo ativo (matérias + células da grade)
    const cycle = this.getCurrentCycle();
    if (cycle) {
      let touched = false;
      (cycle.subjects || []).forEach(s => { if (this._normSubj(s.nome) === oldKey) { s.nome = newName; touched = true; changed.cycle = true; } });
      const dias = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
      dias.forEach(d => {
        const arr = cycle.grade && cycle.grade[d];
        if (!Array.isArray(arr)) return;
        arr.forEach((cell, i) => {
          if (cell && typeof cell === 'object' && this._normSubj(cell.subject) === oldKey) { cell.subject = newName; touched = true; changed.gradeCells++; }
          else if (typeof cell === 'string' && this._normSubj(cell) === oldKey) { arr[i] = newName; touched = true; changed.gradeCells++; }
        });
      });
      if (touched) this.saveCurrentCycle(cycle);
    }

    // 3b) MODELO PERSISTENTE da grade (rotina reutilizável) + siglas customizadas vinculadas
    const tmpl = this._get(this.KEYS.gradeTemplate, null);
    if (tmpl && tmpl.grade) {
      let gTouched = false;
      const dias = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'];
      dias.forEach(d => {
        const arr = tmpl.grade[d];
        if (!Array.isArray(arr)) return;
        arr.forEach((cell, i) => {
          if (cell && typeof cell === 'object' && this._normSubj(cell.subject) === oldKey) { cell.subject = newName; gTouched = true; changed.gradeCells++; }
          else if (typeof cell === 'string' && this._normSubj(cell) === oldKey) { arr[i] = newName; gTouched = true; changed.gradeCells++; }
        });
      });
      if (gTouched) this._set(this.KEYS.gradeTemplate, tmpl);
    }
    // siglas customizadas que apontam para a matéria renomeada
    const csig = this.getCustomSiglas();
    let csTouched = false;
    csig.forEach(c => { if (c.nome && this._normSubj(c.nome) === oldKey) { c.nome = newName; csTouched = true; } });
    if (csTouched) this.saveCustomSiglas(csig);

    // 4) trilhas do Estudo Novo (chaveadas por nome) — move/mescla a chave
    const tracks = this._get(this.KEYS.tracks, {});
    const keysToMove = Object.keys(tracks).filter(k => this._normSubj(k) === oldKey);
    if (keysToMove.length) {
      const merged = tracks[newName] ? tracks[newName].slice() : [];
      keysToMove.forEach(k => { (tracks[k] || []).forEach(it => merged.push(it)); if (k !== newName) delete tracks[k]; });
      tracks[newName] = merged;
      this._set(this.KEYS.tracks, tracks);
      changed.track = true;
    }

    // 5) histórico (para consolidar corretamente na Evolução)
    const hist = this.getCycleHistory();
    let histTouched = false;
    hist.forEach(snap => {
      (snap.subjects || []).forEach(s => { if (this._normSubj(s.nome) === oldKey) { s.nome = newName; histTouched = true; changed.history++; } });
    });
    if (histTouched) this._set(this.KEYS.cycleHistory, hist);

    return { ok: true, reason: 'renamed', oldName, newName, changed };
  },
  removeSubjectPermanently(id) {
    // só usado quando a matéria nunca teve nenhum registro (ver removeSubjectSafely)
    const subjects = this.getSubjects().filter(s => s.id !== id);
    this._set(this.KEYS.subjects, subjects);
  },
  subjectHasEntries(nome) {
    return this.getEntries().some(e => e.subject.toLowerCase() === nome.toLowerCase());
  },
  // exclusão "inteligente": se nunca foi usada, remove de vez; se tem histórico, apenas desativa
  removeSubjectSafely(id) {
    const subjects = this.getSubjects();
    const s = subjects.find(x => x.id === id);
    if (!s) return;
    if (this.subjectHasEntries(s.nome)) {
      this.setSubjectActive(id, false);
    } else {
      this.removeSubjectPermanently(id);
    }
  },

  // --- Formas de estudo (lista simples com soft-delete) ---
  getMethods() {
    let list = this._get(this.KEYS.methods, null);
    if (!list) {
      list = this.DEFAULT_METHODS.map(nome => ({ id: this._uid(), nome, ativo: true }));
      this._set(this.KEYS.methods, list);
    }
    return list;
  },
  getActiveMethods() { return this.getMethods().filter(m => m.ativo); },
  addMethod(nome) {
    const list = this.getMethods();
    if (list.find(m => m.nome.toLowerCase() === nome.toLowerCase())) return;
    list.push({ id: this._uid(), nome, ativo: true });
    this._set(this.KEYS.methods, list);
  },
  renameMethod(id, nome) {
    const list = this.getMethods();
    const m = list.find(x => x.id === id);
    if (m) m.nome = nome;
    this._set(this.KEYS.methods, list);
  },
  methodInUse(nome) {
    return this.getEntries().some(e => e.method.toLowerCase() === nome.toLowerCase());
  },
  removeMethodSafely(id) {
    const list = this.getMethods();
    const m = list.find(x => x.id === id);
    if (!m) return;
    if (this.methodInUse(m.nome)) {
      m.ativo = false;
      this._set(this.KEYS.methods, list);
    } else {
      this._set(this.KEYS.methods, list.filter(x => x.id !== id));
    }
  },

  // --- Fases de estudo (lista simples com soft-delete) ---
  getPhases() {
    let list = this._get(this.KEYS.phases, null);
    if (!list) {
      list = this.DEFAULT_PHASES.map(nome => ({ id: this._uid(), nome, ativo: true }));
      this._set(this.KEYS.phases, list);
    }
    return list;
  },
  getActivePhases() { return this.getPhases().filter(p => p.ativo); },
  addPhase(nome) {
    const list = this.getPhases();
    if (list.find(p => p.nome.toLowerCase() === nome.toLowerCase())) return;
    list.push({ id: this._uid(), nome, ativo: true });
    this._set(this.KEYS.phases, list);
  },
  renamePhase(id, nome) {
    const list = this.getPhases();
    const p = list.find(x => x.id === id);
    if (p) p.nome = nome;
    this._set(this.KEYS.phases, list);
  },
  phaseInUse(nome) {
    return this.getSubjects().some(s => s.fase === nome) ||
           (this.getCurrentCycle()?.subjects || []).some(s => s.fase === nome);
  },
  removePhaseSafely(id) {
    const list = this.getPhases();
    const p = list.find(x => x.id === id);
    if (!p) return;
    if (this.phaseInUse(p.nome)) {
      p.ativo = false;
      this._set(this.KEYS.phases, list);
    } else {
      this._set(this.KEYS.phases, list.filter(x => x.id !== id));
    }
  },

  // --- Modos de estudo por disciplina (lista simples com soft-delete) ---
  getModes() {
    let list = this._get(this.KEYS.modes, null);
    if (!list) {
      list = this.DEFAULT_MODES.map(nome => ({ id: this._uid(), nome, ativo: true }));
      this._set(this.KEYS.modes, list);
    }
    return list;
  },
  getActiveModes() { return this.getModes().filter(m => m.ativo); },
  // Resolve uma referência de modo (id OU nome) para o objeto; retorna null se não houver/definido
  resolveMode(ref) {
    if (!ref) return null;
    const list = this.getModes();
    return list.find(m => m.id === ref)
        || list.find(m => m.nome.toLowerCase() === String(ref).toLowerCase())
        || null;
  },
  addMode(nome) {
    const list = this.getModes();
    if (list.find(m => m.nome.toLowerCase() === nome.toLowerCase())) return;
    list.push({ id: this._uid(), nome, ativo: true });
    this._set(this.KEYS.modes, list);
  },
  renameMode(id, nome) {
    const list = this.getModes();
    const m = list.find(x => x.id === id);
    if (m) m.nome = nome;
    this._set(this.KEYS.modes, list);
  },
  modeInUse(modeObj) {
    return this.getSubjects().some(s => {
      const r = this.resolveMode(s.modo);
      return r && r.id === modeObj.id;
    });
  },
  removeModeSafely(id) {
    const list = this.getModes();
    const m = list.find(x => x.id === id);
    if (!m) return;
    if (this.modeInUse(m)) {
      m.ativo = false;
      this._set(this.KEYS.modes, list);
    } else {
      this._set(this.KEYS.modes, list.filter(x => x.id !== id));
    }
  },

  // --- Current Cycle ---
  getCurrentCycle() { return this._get(this.KEYS.currentCycle, null); },
  saveCurrentCycle(cycle) { this._set(this.KEYS.currentCycle, cycle); },
  clearCurrentCycle() { localStorage.removeItem(this.KEYS.currentCycle); },
  // memória do último ciclo montado (para pré-preencher a próxima semana) — por planejamento
  getLastCycleSetup() { return this._get(this.KEYS.lastCycleSetup, null); },
  saveLastCycleSetup(setup) { this._set(this.KEYS.lastCycleSetup, setup); },

  // ---- Modelo de grade (rotina semanal persistente, reutilizada entre ciclos) ----
  // Estrutura: { grade: { Segunda:[celulas], ... }, sessions: N }
  getGradeTemplate() {
    let t = this._get(this.KEYS.gradeTemplate, null);
    if (!t) {
      // migração: se já existe uma grade no ciclo atual, ela vira o modelo inicial
      const cyc = this.getCurrentCycle();
      if (cyc && cyc.grade && Object.keys(cyc.grade).length) {
        t = { grade: JSON.parse(JSON.stringify(cyc.grade)), sessions: cyc.sessions || 3 };
      } else {
        t = { grade: {}, sessions: 3 };
      }
      const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
      DIAS.forEach(d => { if (!Array.isArray(t.grade[d])) t.grade[d] = []; while (t.grade[d].length < t.sessions) t.grade[d].push(''); });
      this._set(this.KEYS.gradeTemplate, t);
    }
    return t;
  },
  saveGradeTemplate(t) { this._set(this.KEYS.gradeTemplate, t); },

  // ---- Grades salvas: [{ id, nome, grade, sessions, createdAt }] ----
  // Permite guardar a grade atual sob um nome, trocar de planejamento/meta e depois
  // restaurar exatamente a grade anterior sem precisar remontá-la.
  getSavedGrades() { return this._get(this.KEYS.savedGrades, []); },
  saveSavedGrades(list) { this._set(this.KEYS.savedGrades, list); },
  addSavedGrade(nome) {
    const t = this.getGradeTemplate();
    const list = this.getSavedGrades();
    const item = {
      id: this._uid(),
      nome: (nome || 'Grade salva').trim().slice(0, 40) || 'Grade salva',
      grade: JSON.parse(JSON.stringify(t.grade || {})),
      sessions: t.sessions || 3,
      createdAt: new Date().toISOString()
    };
    list.push(item);
    this.saveSavedGrades(list);
    return item;
  },
  // Sobrescreve uma grade salva com a grade atual (mantém o nome).
  overwriteSavedGrade(id) {
    const t = this.getGradeTemplate();
    const list = this.getSavedGrades();
    const s = list.find(x => x.id === id);
    if (!s) return false;
    s.grade = JSON.parse(JSON.stringify(t.grade || {}));
    s.sessions = t.sessions || 3;
    s.createdAt = new Date().toISOString();
    this.saveSavedGrades(list);
    return true;
  },
  renameSavedGrade(id, nome) {
    const list = this.getSavedGrades();
    const s = list.find(x => x.id === id);
    if (s) { s.nome = (nome || '').trim().slice(0, 40) || s.nome; this.saveSavedGrades(list); }
  },
  deleteSavedGrade(id) { this.saveSavedGrades(this.getSavedGrades().filter(x => x.id !== id)); },
  // Aplica uma grade salva ao modelo ativo (substitui a grade atual).
  applySavedGrade(id) {
    const s = this.getSavedGrades().find(x => x.id === id);
    if (!s) return false;
    const t = this.getGradeTemplate();
    t.grade = JSON.parse(JSON.stringify(s.grade || {}));
    t.sessions = s.sessions || t.sessions || 3;
    this.saveGradeTemplate(t);
    return true;
  },

  // ---- Siglas customizadas: [{ id, sigla, nome, color }] ----
  // 'nome' opcional casa a sigla a uma matéria; sem nome, é uma etiqueta livre.
  getCustomSiglas() { return this._get(this.KEYS.customSiglas, []); },
  saveCustomSiglas(list) { this._set(this.KEYS.customSiglas, list); },

  // ---- Leis Secas: [{ id, titulo, referencia, materia, texto, marcacoes:[{start,end}], opts, createdAt, updatedAt }] ----
  // 'marcacoes' guarda os destaques MANUAIS por offset de caractere no texto normalizado.
  getLeis() { return this._get(this.KEYS.leis, []); },
  saveLeis(list) { this._set(this.KEYS.leis, list); },
  getLei(id) { return this.getLeis().find(l => l.id === id) || null; },
  addLei({ titulo, referencia, materia, texto }) {
    const list = this.getLeis();
    const now = new Date().toISOString();
    const lei = { id: this._uid(), titulo: (titulo || 'Sem título').trim(), referencia: (referencia || '').trim(),
      materia: (materia || '').trim(), texto: texto || '', marcacoes: [], suppressed: [],
      opts: { ressalvas: true, restricoes: true, competencias: true, prazos: true, efeitos: true, relacoes: true },
      createdAt: now, updatedAt: now };
    list.push(lei);
    this.saveLeis(list);
    return lei;
  },
  updateLei(id, patch) {
    const list = this.getLeis();
    const l = list.find(x => x.id === id);
    if (l) { Object.assign(l, patch); l.updatedAt = new Date().toISOString(); }
    this.saveLeis(list);
  },
  deleteLei(id) { this.saveLeis(this.getLeis().filter(l => l.id !== id)); },
  // ---- Palavras de destaque automático (gerenciáveis; valem para TODAS as leis) ----
  // Formato: [{ t:'palavra', cat:'ressalvas'|'restricoes'|'competencias'|'prazos'|'efeitos'|'relacoes', def:true? }]
  // Na 1ª vez, semeamos a lista com os termos PADRÃO (legíveis), para o usuário
  // ver, incluir e excluir. A partir daí, a lista dele é a fonte da verdade.
  LEI_KEYWORDS_DEFAULT: [
    // Ressalvas / Exceções
    'salvo','salvo se','exceto','com exceção','ressalvado','ressalvados','excetuado','sem prejuízo','desde que','não obstante',
    // Restrições / Exclusividade
    'exclusivamente','somente','apenas','vedado','vedada','vedação','proibido','proibida','independentemente','integralmente','restrito',
    // Poder / Dever / Competência
    'deverá','deverão','deve','poderá','poderão','pode','é facultado','facultativo','competência','compete','privativamente','indelegável','obrigatório','dispensável','inexigível',
    // Prazos / Tempo
    'dias','horas','meses','anos','maioria absoluta','maioria simples','dois terços','três quintos','úteis','corridos','vigência','em vigor','decadência','prescrição','trânsito em julgado',
    // Validade / Sanções
    'nulidade','nulo','anulável','anulação','ineficaz','suspensão','extinção','exclusão','revogação','presume-se','penalidade','multa','sanção','infração','improbidade','crime',
    // Causalidade / Subordinação
    'subsidiariamente','supletivamente','solidariamente','pessoalmente','diretamente','indiretamente','conjuntamente'
  ],
  _leiKwCatOf(termo) {
    // Mapeia um termo padrão à sua categoria (para semear com a cor certa).
    const t = termo.toLowerCase();
    const G = {
      ressalvas: ['salvo','salvo se','exceto','com exceção','ressalvado','ressalvados','excetuado','sem prejuízo','desde que','não obstante'],
      restricoes: ['exclusivamente','somente','apenas','vedado','vedada','vedação','proibido','proibida','independentemente','integralmente','restrito'],
      competencias: ['deverá','deverão','deve','poderá','poderão','pode','é facultado','facultativo','competência','compete','privativamente','indelegável','obrigatório','dispensável','inexigível'],
      prazos: ['dias','horas','meses','anos','maioria absoluta','maioria simples','dois terços','três quintos','úteis','corridos','vigência','em vigor','decadência','prescrição','trânsito em julgado'],
      efeitos: ['nulidade','nulo','anulável','anulação','ineficaz','suspensão','extinção','exclusão','revogação','presume-se','penalidade','multa','sanção','infração','improbidade','crime'],
      relacoes: ['subsidiariamente','supletivamente','solidariamente','pessoalmente','diretamente','indiretamente','conjuntamente']
    };
    for (const k in G) if (G[k].includes(t)) return k;
    return 'competencias';
  },
  getLeiKeywords() {
    let list = this._get(this.KEYS.leiKeywords, null);
    if (list === null) {  // 1ª vez: semeia com os padrões
      list = this.LEI_KEYWORDS_DEFAULT.map(t => ({ t, cat: this._leiKwCatOf(t), def: true }));
      this._set(this.KEYS.leiKeywords, list);
    }
    return list;
  },
  saveLeiKeywords(list) { this._set(this.KEYS.leiKeywords, list); },
  addLeiKeyword(t, cat) {
    const termo = String(t || '').trim();
    if (termo.length < 2) return false;
    const list = this.getLeiKeywords();
    if (list.some(k => k.t.toLowerCase() === termo.toLowerCase())) return false;
    list.push({ t: termo, cat: cat || 'competencias' });
    this.saveLeiKeywords(list);
    return true;
  },
  removeLeiKeyword(termo) {
    const key = String(termo || '').toLowerCase();
    this.saveLeiKeywords(this.getLeiKeywords().filter(k => k.t.toLowerCase() !== key));
  },
  restoreLeiKeywordDefaults() {
    const list = this.LEI_KEYWORDS_DEFAULT.map(t => ({ t, cat: this._leiKwCatOf(t), def: true }));
    this.saveLeiKeywords(list);
    return list;
  },

  // ---- Cards de Revisão: baralhos + cards com repetição espaçada ----
  // Baralho: { id, nome, createdAt }
  getDecks() { return this._get(this.KEYS.decks, []); },
  saveDecks(list) { this._set(this.KEYS.decks, list); },
  addDeck(nome) {
    const list = this.getDecks();
    const n = (nome || '').trim();
    if (!n) return null;
    if (list.some(d => d.nome.toLowerCase() === n.toLowerCase())) { return list.find(d => d.nome.toLowerCase() === n.toLowerCase()); }
    const deck = { id: this._uid(), nome: n, createdAt: new Date().toISOString() };
    list.push(deck); this.saveDecks(list); return deck;
  },
  renameDeck(id, nome) { const l = this.getDecks(); const d = l.find(x => x.id === id); if (d) d.nome = (nome || '').trim(); this.saveDecks(l); },
  deleteDeck(id) {
    this.saveDecks(this.getDecks().filter(d => d.id !== id));
    // cards que apontavam para o baralho ficam "sem destino" (deckId null) — não são apagados
    const cards = this.getCards(); let touched = false;
    cards.forEach(c => { if (c.deckId === id) { c.deckId = null; touched = true; } });
    if (touched) this.saveCards(cards);
  },
  // Card: { id, deckId|null, materia|null, topico, tipo, frente, verso, favorito,
  //         status:'pendente'|'sei'|'naosei', ease, intervalo(dias), due(YYYY-MM-DD), reps, lapses, createdAt, updatedAt }
  getCards() { return this._get(this.KEYS.cards, []); },
  saveCards(list) { this._set(this.KEYS.cards, list); },
  // Histórico de revisões (revlog) — base para o otimizador FSRS personalizar seus pesos.
  getRevlog() { return this._get(this.KEYS.revlog, []); },
  addRevlog(entry) { const l = this.getRevlog(); l.push(entry); if (l.length > 8000) l.splice(0, l.length - 8000); this._set(this.KEYS.revlog, l); },
  removeRevlog(ts) { const l = this.getRevlog(); const i = l.findIndex(r => r.ts === ts); if (i >= 0) { l.splice(i, 1); this._set(this.KEYS.revlog, l); } },
  getCard(id) { return this.getCards().find(c => c.id === id) || null; },
  addCard(data) {
    const list = this.getCards();
    const now = new Date().toISOString();
    const card = {
      id: this._uid(),
      deckId: data.deckId || null,
      materia: data.materia || null,
      topico: (data.topico || '').trim(),
      banca: (data.banca || '').trim(),
      tipo: data.tipo || '',
      kind: data.kind || 'basic',      // 'basic' | 'cloze'
      reversedOf: data.reversedOf || null, // id do card original (cartão invertido)
      // Higienizado na ENTRADA: cobre o editor, a importação de .tsv/.json e
      // qualquer outro caminho que crie card. Ver sanitizeCardHtml().
      frente: _sanCard(data.frente),
      verso: _sanCard(data.verso),
      favorito: false,
      status: 'pendente',
      // BUG CORRIGIDO: usava todayLocal() (data de CALENDARIO) enquanto o agendador
      // compara com todayCards() (dia de estudo, que vira as 4h como no Anki). Um
      // card criado entre a meia-noite e as 4h nascia vencendo "amanha" e sumia da
      // fila ate o dia virar — o card existia, mas nao aparecia para revisar.
      ease: 2.5, intervalo: 0, due: todayCards(), reps: 0, lapses: 0,
      // estado FSRS (Anki): fase, passo de aprendizado, estabilidade (S), dificuldade (D)
      phase: 'new', learnStep: 0, s: null, d: null, dueTs: null,
      /* new_card_insert_order do Anki: a POSIÇÃO na fila de novos é decidida
         aqui, no momento da criação — não na hora de montar a fila.
         · 'sequencial' (padrão): entra no fim, atrás de tudo que já espera.
         · 'aleatoria': recebe uma posição sorteada dentro da faixa existente,
           então um lote grande se intercala com o que já estava na fila em vez
           de virar um bloco monotemático no fim.
         Reposicionar depois continua funcionando: ele reescreve posicaoNova. */
      posicaoNova: (function () {
        try {
          const cfg = CardsConfig.get();
          const novos = list.filter(c => (c.phase || 'new') === 'new');
          const maior = novos.reduce((a, c) => Math.max(a, typeof c.posicaoNova === 'number' ? c.posicaoNova : -1), -1);
          if ((cfg.newInsertOrder || 'sequencial') === 'aleatoria' && maior >= 0) {
            return Math.floor(Math.random() * (maior + 2));
          }
          return maior + 1;
        } catch (e) { _quiet(e, 'posicao-nova'); return Date.now(); }
      })(),
      createdAt: now, updatedAt: now
    };
    list.push(card); this.saveCards(list); return card;
  },
  updateCard(id, patch) {
    const list = this.getCards(); const c = list.find(x => x.id === id);
    // Só sanea quando o texto do card está de fato no patch — a maioria das
    // chamadas é agendamento do FSRS (due, s, d, reps) e não toca em frente/verso.
    if (patch && ('frente' in patch || 'verso' in patch)) {
      patch = { ...patch };
      if ('frente' in patch) patch.frente = _sanCard(patch.frente);
      if ('verso' in patch) patch.verso = _sanCard(patch.verso);
    }
    if (c) { Object.assign(c, patch); c.updatedAt = new Date().toISOString(); }
    this.saveCards(list); return c;
  },
  // Varredura de segurança: usada depois de IMPORTAR UM BACKUP DE PERFIL, que
  // escreve direto no localStorage e por isso não passa por addCard/updateCard.
  // Retorna quantos cards foram alterados (0 = arquivo estava limpo).
  sanitizeCardsInPlace() {
    try {
      const list = this.getCards();
      let n = 0;
      list.forEach(c => {
        const f = _sanCard(c.frente), v = _sanCard(c.verso);
        if (f !== c.frente || v !== c.verso) { c.frente = f; c.verso = v; n++; }
      });
      if (n) this.saveCards(list);
      return n;
    } catch (_) { return 0; }
  },
  /* Excluir um card tem de levar embora TUDO que era dele. A auditoria real
     mostrou 178 entradas de histórico para 4 cards existentes: 16 cards apagados
     tinham deixado o histórico para trás. Pior, o contador diário guardava os IDs
     deles e continuava consumindo a cota de 20 novos do dia — cards que nem
     existiam mais ocupavam vaga na fila. */
  deleteCard(id) {
    this.saveCards(this.getCards().filter(c => c.id !== id));
    try {
      const l = this.getRevlog().filter(r => r.cardId !== id);
      this._set(this.KEYS.revlog, l);
    } catch (_) { _quiet(_); }
    try { CardsConfig.forgetCardId(id); } catch (_) { _quiet(_); }
  },
  /* Zera TODO o progresso dos cards, preservando o conteúdo. Equivale a aplicar
     o "Esquecer" (Forget) do Anki em todos os cards, mais limpar o histórico e
     os contadores do dia. Devolve o que foi afetado, para o aviso na tela. */
  /* ══════════════════════════════════════════════════════════════════════════
     AÇÕES DO REVIEWER DO ANKI (qt/aqt/reviewer.py :: _shortcutKeys)
     Implementadas aqui com o MESMO significado do original. Este app tem um
     card por nota, então "enterrar nota" e "enterrar card" coincidem — no Anki
     eles diferem só quando uma nota gera vários cards.
     ═══════════════════════════════════════════════════════════════════════ */
  // ENTERRAR (bury, tecla "-"): tira o card da fila até o próximo dia.
  // Diferente de suspender, que o remove por tempo indeterminado.
  buryCard(id) {
    const c = this.getCard(id); if (!c) return null;
    const amanha = CardEngine.addDays(todayCards(), 1);
    this.updateCard(id, { enterradoAte: amanha, dueTs: null });
    return amanha;
  },
  unburyCard(id) { this.updateCard(id, { enterradoAte: null }); },
  // ESQUECER (forget, Ctrl+Alt+N): devolve o card ao estado de novo, apagando
  // a memória do FSRS. O conteúdo permanece.
  forgetCard(id) {
    const c = this.getCard(id); if (!c) return;
    this.updateCard(id, {
      phase: 'new', learnStep: 0, due: todayCards(), dueTs: null,
      intervalo: 0, reps: 0, lapses: 0, ease: 2.5, s: null, d: null,
      lastReview: null, status: 'pendente', leech: false
    });
  },
  // DEFINIR DATA (Ctrl+Shift+D): agenda o card para daqui a N dias.
  setDueDays(id, dias) {
    const n = Math.max(0, Math.round(Number(dias) || 0));
    const c = this.getCard(id); if (!c) return null;
    const data = CardEngine.addDays(todayCards(), n);
    this.updateCard(id, { due: data, dueTs: null, enterradoAte: null,
      phase: (c.phase === 'new' ? 'review' : c.phase), status: c.status || 'sei' });
    return data;
  },
  // BANDEIRAS (Ctrl+1..4 / 0 remove) — mesmas cores e ordem do Anki
  FLAGS: [null, { nome: 'Vermelha', cor: '#e0393f' }, { nome: 'Laranja', cor: '#e07a1f' },
          { nome: 'Verde', cor: '#0f9d63' }, { nome: 'Azul', cor: '#2563eb' }],
  setFlag(id, n) { this.updateCard(id, { flag: (n >= 1 && n <= 4) ? n : 0 }); },
  zerarProgressoCards() {
    const cards = this.getCards();
    const nRev = this.getRevlog().length;
    cards.forEach(c => {
      c.phase = 'new'; c.learnStep = 0;
      c.due = todayCards(); c.dueTs = null;
      c.intervalo = 0; c.reps = 0; c.lapses = 0;
      c.ease = 2.5; c.s = null; c.d = null;
      c.lastReview = null; c.status = 'pendente';
      c.leech = false; c.suspenso = false;
      c.updatedAt = new Date().toISOString();
    });
    this.saveCards(cards);
    this._set(this.KEYS.revlog, []);
    try {
      this.setRaw(CardsConfig.DKEY, JSON.stringify({ date: todayCards(), newIds: [], revIds: [] }));
    } catch (_) { _quiet(_); }
    return { cards: cards.length, revlog: nRev };
  },
  // Faxina geral: remove do histórico e dos contadores tudo que aponta para card
  // inexistente. Devolve quantos registros foram descartados.
  limparOrfaos() {
    const ids = new Set(this.getCards().map(c => c.id));
    let n = 0;
    try {
      const l = this.getRevlog();
      const limpo = l.filter(r => ids.has(r.cardId));
      n = l.length - limpo.length;
      if (n) this._set(this.KEYS.revlog, limpo);
    } catch (_) { _quiet(_); }
    try { n += CardsConfig.limparContadorOrfao(ids); } catch (_) { _quiet(_); }
    // A cura de cards FSRS roda em silêncio (não entra na contagem de "órfãos"):
    // é uma correção de metadados, não uma remoção de lixo.
    try { const migradas = this.migrarAproveitamentoAgregado(); if (migradas > 0) console.info('[migração] ' + migradas + ' semana(s) com aproveitamento recalculado'); } catch (e) { _quiet(e, 'mig-aprov'); }
    try { const recump = this.migrarCumprimentoSemana(); if (recump > 0) console.info('[migração] ' + recump + ' semana(s) com % cumprido recalculado'); } catch (e) { _quiet(e, 'mig-cumprido'); }
    try { const curados = this.curarCardsFSRS(); if (curados > 0) console.warn('[cura FSRS] cards com metadados corrigidos:', curados); } catch (_) { _quiet(_); }
    return n;
  },
  /* CURA de cards FSRS legados (migração indolor, roda no boot).
     Versões antigas graduavam um card para 'review' sem gravar o campo
     `intervalo` (ficava 0). Isso NÃO quebrava o agendamento — o `due` está
     correto e o próprio scheduler tem fallback (ivPrevio calcula por lastReview↔due)
     — mas deixava a EXIBIÇÃO e as ESTATÍSTICAS erradas (intervalo 0 dias num card
     maduro). Aqui reconstruímos o intervalo a partir de lastReview↔due, sem tocar
     no S/D nem no agendamento. Também sanea S/D fora de faixa e NaN. */
  /* ── MIGRAÇÃO: aproveitamento do histórico para a régua agregada ───────────
     As semanas fechadas guardam `avgPerformancePct` calculado no fechamento.
     Mudar a fórmula sem tocar nelas deixaria o gráfico "por semana fechada"
     misturando DUAS réguas — semanas antigas pela média das sessões, novas pelo
     agregado. Seria pior que o problema original.

     Recalculamos a partir dos registros, que continuam gravados. Só mexe onde
     há sessões no intervalo (semana vazia fica como está) e roda UMA vez,
     marcada por flag. O valor anterior vai para `avgPerformancePctLegado`
     para o número antigo não sumir sem rastro. */
  migrarAproveitamentoAgregado() {
    const FLAG = 'mig-aprov-agregado-v1';
    try {
      if (this._get(FLAG, null)) return 0;
      const hist = this.getCycleHistory() || [];
      const todas = this.getEntries() || [];
      let n = 0;
      hist.forEach(w => {
        if (!w || !w.startDate || !w.endDate) return;
        const novo = CycleEngine.aproveitamentoNoPeriodo(w.startDate, w.endDate, todas);
        if (novo == null) return;
        const antigo = w.avgPerformancePct;
        if (antigo != null && Math.abs(antigo - novo) < 0.005) return;
        if (antigo != null && w.avgPerformancePctLegado === undefined) w.avgPerformancePctLegado = antigo;
        w.avgPerformancePct = novo;
        n++;
      });
      if (n) this._set(this.KEYS.cycleHistory, hist);
      this._set(FLAG, 1);
      if (n) { try { console.info('[migração] aproveitamento recalculado em ' + n + ' semana(s).'); } catch (e) { _quiet(e, 'log-migracao'); } }
      return n;
    } catch (e) { _quiet(e, 'migrar-aproveitamento'); return 0; }
  },

  /* ── MIGRAÇÃO: "estudado" e "% cumprido" das semanas fechadas ─────────────
     A auditoria de métricas unificou o progresso da semana numa fórmula só
     (CycleEngine.progressoSemana). As semanas fechadas ANTES disso guardam
     números de outra régua: o "estudado" incluía matérias fora do ciclo e o
     "% cumprido" era limitado a 150%. Deixá-las como estavam faria o Histórico
     comparar semanas medidas de dois jeitos — exatamente o problema que a
     unificação resolve.

     Recalculamos a partir dos registros, que continuam gravados. Roda UMA vez,
     marcada por flag, e guarda o valor anterior em `totalStudiedMinLegado` /
     `pctCumpridoLegado` para nada sumir sem rastro. */
  migrarCumprimentoSemana() {
    const FLAG = 'mig-cumprido-semana-v1';
    try {
      if (this._get(FLAG, null)) return 0;
      const hist = this.getCycleHistory() || [];
      let n = 0;
      hist.forEach(w => {
        if (!w || !w.startDate || !w.endDate || !Array.isArray(w.subjects) || !w.subjects.length) return;
        const prog = CycleEngine.progressoSemana(w.subjects, w.startDate, w.endDate);
        const mudouMin = Math.abs((w.totalStudiedMin || 0) - prog.totalStudiedMin) >= 1;
        const mudouPct = Math.abs((w.pctCumprido || 0) - prog.pctCumprido) >= 0.005;
        if (!mudouMin && !mudouPct) return;
        if (w.totalStudiedMinLegado === undefined) w.totalStudiedMinLegado = w.totalStudiedMin;
        if (w.pctCumpridoLegado === undefined) w.pctCumpridoLegado = w.pctCumprido;
        w.subjects = prog.subjects;
        w.totalStudiedMin = prog.totalStudiedMin;
        w.totalTargetMin = prog.totalTargetMin;
        w.pctCumprido = prog.pctCumprido;
        w.finalizadas = prog.finalizadas;
        w.totalSubjects = prog.totalSubjects;
        n++;
      });
      if (n) this._set(this.KEYS.cycleHistory, hist);
      this._set(FLAG, 1);
      return n;
    } catch (e) { _quiet(e, 'migrar-cumprimento'); return 0; }
  },

  curarCardsFSRS() {
    const list = this.getCards();
    let mudou = 0;
    const daysBetween = (a, b) => {
      try { const A = new Date(a + 'T00:00:00'), B = new Date(b + 'T00:00:00');
        return Math.round((B - A) / 86400000); } catch (_) { return 0; }
    };
    list.forEach(c => {
      let alterou = false;
      // 1) review/relearning com intervalo<=0: reconstrói pelo due
      if ((c.phase === 'review' || c.phase === 'relearning') && (!(c.intervalo > 0))) {
        let iv = 0;
        if (c.lastReview && c.due) iv = daysBetween(c.lastReview, c.due);
        if (!(iv > 0) && c.due) iv = Math.max(1, daysBetween(todayCards(), c.due));
        if (iv > 0) { c.intervalo = Math.min(36500, iv); alterou = true; }
      }
      // 2) S fora dos limites do Anki (S_MIN 0.001 · S_MAX 36500)
      if (typeof c.s === 'number') {
        if (!isFinite(c.s)) { c.s = 0.001; alterou = true; }
        else if (c.s < 0.001) { c.s = 0.001; alterou = true; }
        else if (c.s > 36500) { c.s = 36500; alterou = true; }
      }
      // 3) D fora de 1..10 (ou NaN)
      if (typeof c.d === 'number') {
        if (!isFinite(c.d)) { c.d = 5; alterou = true; }
        else if (c.d < 1) { c.d = 1; alterou = true; }
        else if (c.d > 10) { c.d = 10; alterou = true; }
      }
      if (alterou) { c.updatedAt = new Date().toISOString(); mudou++; }
    });
    if (mudou) this.saveCards(list);
    return mudou;
  },

  // ---- Links úteis: [{ id, nome, url, categoria, cor, logo(dataURL|null), createdAt }] ----
  DEFAULT_LINKS: [
    { nome: 'TecConcursos', url: 'https://www.tecconcursos.com.br/', categoria: 'Questões', cor: '#29abe2' },
    { nome: 'Estratégia', url: 'https://perfil.estrategia.com/login', categoria: 'Curso', cor: '#5b4fc4' },
    { nome: 'Nazli Setton', url: 'https://www.nazlisetton.com.br/', categoria: 'Curso', cor: '#7cb342' },
    { nome: 'Prof. Rabelo', url: 'https://cursos.rabeloconcursos.com/login', categoria: 'Curso', cor: '#123a5e' },
    { nome: 'Gemini', url: 'https://gemini.google.com/app', categoria: 'IA', cor: '#4285f4' },
    { nome: 'Claude', url: 'https://claude.ai/', categoria: 'IA', cor: '#d97757' }
  ],
  getLinks() {
    let list = this._get(this.KEYS.links, null);
    if (list === null) {
      list = this.DEFAULT_LINKS.map(l => ({ id: this._uid(), ...l, logo: null, createdAt: new Date().toISOString() }));
      this._set(this.KEYS.links, list);
    }
    return list;
  },
  saveLinks(list) { this._set(this.KEYS.links, list); },
  addLink(data) {
    const list = this.getLinks();
    const link = {
      id: this._uid(),
      nome: (data.nome || 'Novo link').trim(),
      url: (data.url || '').trim(),
      categoria: (data.categoria || '').trim(),
      cor: data.cor || '#4f46e5',
      logo: data.logo || null,
      createdAt: new Date().toISOString()
    };
    list.push(link); this.saveLinks(list); return link;
  },
  updateLink(id, patch) {
    const list = this.getLinks(); const l = list.find(x => x.id === id);
    if (l) Object.assign(l, patch);
    this.saveLinks(list); return l;
  },
  deleteLink(id) { this.saveLinks(this.getLinks().filter(l => l.id !== id)); },

  // ---- Incidência da banca: [{ id, banca, disciplina, topico, incidencia }] ----
  getIncidencia() { return this._get(this.KEYS.incidencia, []); },
  saveIncidencia(list) { this._set(this.KEYS.incidencia, list); },
  getBancas() { return [...new Set(this.getIncidencia().map(r => r.banca).filter(Boolean))].sort(); },
  // adiciona/substitui em lote as linhas de uma banca (replace = troca todo o histórico daquela banca)
  addIncidenciaRows(banca, rows, replace) {
    let list = this.getIncidencia();
    if (replace) list = list.filter(r => r.banca.toLowerCase() !== banca.toLowerCase());
    rows.forEach(r => {
      list.push({ id: this._uid(), banca, disciplina: (r.disciplina || '').trim(), topico: (r.topico || '').trim(), incidencia: r.incidencia || 0, codigo: r.codigo || null, depth: (r.depth != null ? r.depth : null), pct: (r.pct != null ? r.pct : null) });
    });
    this.saveIncidencia(list);
    return rows.length;
  },
  clearIncidenciaBanca(banca) { this.saveIncidencia(this.getIncidencia().filter(r => r.banca.toLowerCase() !== banca.toLowerCase())); },
  // Edita um item de incidência (renomear tópico e/ou ajustar a incidência).
  // Se for uma DISCIPLINA (depth 0) e o nome mudar, propaga o novo nome de disciplina aos filhos.
  updateIncidenciaItem(id, patch) {
    const list = this.getIncidencia();
    const it = list.find(r => r.id === id);
    if (!it) return null;
    const oldTopico = it.topico, oldDisc = it.disciplina, wasDisc = (it.depth === 0);
    if (patch.topico != null) it.topico = String(patch.topico).trim() || it.topico;
    if (patch.incidencia != null && !isNaN(parseFloat(patch.incidencia))) it.incidencia = Math.max(0, parseFloat(patch.incidencia));
    // renomear disciplina → atualiza o campo disciplina de todos os itens daquele grupo
    if (wasDisc && patch.topico != null && it.topico !== oldDisc) {
      list.forEach(r => { if (r.banca === it.banca && r.disciplina === oldDisc) r.disciplina = it.topico; });
    }
    this.saveIncidencia(list); return it;
  },
  deleteIncidenciaItem(id) { this.saveIncidencia(this.getIncidencia().filter(r => r.id !== id)); },
  // ---- Atividades Extras (metas paralelas): anki, lei seca, questões, revisão, vídeo, livre ----
  // Cada extra: { id, titulo, tipo, disciplina, unidade, alvo, periodo, progresso, contaMetricas,
  //               status, historico:[{data, quantidade, minutos}], createdAt, updatedAt }
  getExtras() {
    const list = this._get(this.KEYS.extras, []);
    let mig = false;
    list.forEach(e => {
      if (!Array.isArray(e.concluidasEm)) { e.concluidasEm = []; mig = true; }
      // Migração: recorrente que ficou 'concluida' no modelo antigo (global) volta a ser
      // ativa — agora a conclusão é por dia (concluidasEm), não trava a atividade toda.
      if (this.extraRecorrente(e) && e.status === 'concluida') { e.status = 'ativa'; mig = true; }
    });
    if (mig) { try { this._set(this.KEYS.extras, list); } catch (_) { _quiet(_); } }
    return list;
  },
  saveExtras(list) { this._set(this.KEYS.extras, list); },
  getExtra(id) { return this.getExtras().find(x => x.id === id) || null; },
  addExtra(data) {
    const list = this.getExtras();
    const now = new Date().toISOString();
    const ex = {
      id: this._uid(),
      titulo: (data.titulo || 'Nova atividade').trim(),
      tipo: data.tipo || 'livre',                 // anki|leitura|questoes|revisao|video|livre
      disciplina: (data.disciplina || '').trim(),
      unidade: data.unidade || 'itens',           // cards|paginas|questoes|min|sessoes|itens
      alvo: Math.max(0, parseFloat(data.alvo) || 0),
      periodo: data.periodo || 'unica',           // unica|diaria|semanal|quinzenal|mensal
      dataInicio: (data.dataInicio || '').trim() || null, // início da recorrência (opcional; padrão: hoje)
      dataFim: (data.dataFim || '').trim() || null, // fim da recorrência (opcional): para de reiniciar depois disso
      progresso: 0,
      datas: Array.isArray(data.datas) ? data.datas : [], // datas agendadas (calendário)
      marcador: (data.marcador || '').trim(),      // "onde parei" (lei seca / leitura)
      contaMetricas: data.contaMetricas !== false, // por atividade (padrão: conta)
      status: 'ativa',                            // ativa|concluida|pausada (só para 'unica')
      concluidasEm: [],                           // datas em que a OCORRÊNCIA foi concluída (recorrentes)
      historico: [],
      createdAt: now, updatedAt: now
    };
    // Recorrência com data-fim: já calcula e vincula automaticamente as datas do calendário.
    if (this.extraRecorrente(ex) && ex.dataFim) ex.datas = this._gerarDatasRecorrencia(ex).filter(d => !(ex.excluidasEm || []).includes(d));
    list.push(ex); this.saveExtras(list); return ex;
  },
  updateExtra(id, patch) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (e) {
      const p = Object.assign({}, patch);
      // normaliza tipos numéricos (o modal entrega strings vindas dos inputs)
      if ('alvo' in p) p.alvo = Math.max(0, parseFloat(p.alvo) || 0);
      if ('progresso' in p) p.progresso = Math.max(0, parseFloat(p.progresso) || 0);
      if ('dataFim' in p) p.dataFim = (String(p.dataFim || '').trim()) || null;
      if ('dataInicio' in p) p.dataInicio = (String(p.dataInicio || '').trim()) || null;
      Object.assign(e, p); e.updatedAt = new Date().toISOString();
    }
    this.saveExtras(list); return e;
  },
  deleteExtra(id) { this.saveExtras(this.getExtras().filter(x => x.id !== id)); },
  // Exclui somente a ocorrência escolhida, preservando a série e as demais datas.
  deleteExtraOccurrence(id, dia) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    dia = dia || todayLocal();
    e.excluidasEm = Array.isArray(e.excluidasEm) ? e.excluidasEm : [];
    if (!e.excluidasEm.includes(dia)) e.excluidasEm.push(dia);
    e.datas = (Array.isArray(e.datas) ? e.datas : []).filter(d => d !== dia);
    e.concluidasEm = (Array.isArray(e.concluidasEm) ? e.concluidasEm : []).filter(d => d !== dia);
    const removidos = (Array.isArray(e.historico) ? e.historico : []).filter(h => h.data === dia);
    e.historico = (Array.isArray(e.historico) ? e.historico : []).filter(h => h.data !== dia);
    const qtdRemovida = removidos.reduce((n, h) => n + (parseFloat(h.quantidade) || 0), 0);
    e.progresso = Math.max(0, (parseFloat(e.progresso) || 0) - qtdRemovida);
    if (e.periodo === 'unica' && e.status === 'concluida' && e.alvo > 0 && e.progresso < e.alvo) e.status = 'ativa';
    e.updatedAt = new Date().toISOString();
    this.saveExtras(list); return e;
  },
  // Exclui um conjunto explícito de ocorrências sem afetar datas não selecionadas.
  deleteExtraOccurrences(id, dias) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    const set = new Set((dias || []).filter(Boolean));
    if (!set.size) return e;
    e.excluidasEm = [...new Set([...(e.excluidasEm || []), ...set])].sort();
    e.datas = (e.datas || []).filter(d => !set.has(d));
    e.concluidasEm = (e.concluidasEm || []).filter(d => !set.has(d));
    const removidos = (e.historico || []).filter(h => set.has(h.data));
    e.historico = (e.historico || []).filter(h => !set.has(h.data));
    const qtd = removidos.reduce((n,h) => n + (parseFloat(h.quantidade) || 0), 0);
    e.progresso = Math.max(0, (parseFloat(e.progresso) || 0) - qtd);
    e.updatedAt = new Date().toISOString();
    this.saveExtras(list); return e;
  },
  // Exclui a ocorrência escolhida e todas as posteriores, preservando apenas o histórico anterior.
  deleteExtraFromDate(id, dia) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    dia = dia || todayLocal();
    e.datas = (Array.isArray(e.datas) ? e.datas : []).filter(d => d < dia);
    e.concluidasEm = (Array.isArray(e.concluidasEm) ? e.concluidasEm : []).filter(d => d < dia);
    e.excluidasEm = (Array.isArray(e.excluidasEm) ? e.excluidasEm : []).filter(d => d < dia);
    const removidos = (Array.isArray(e.historico) ? e.historico : []).filter(h => h.data >= dia);
    e.historico = (Array.isArray(e.historico) ? e.historico : []).filter(h => h.data < dia);
    const qtdRemovida = removidos.reduce((n, h) => n + (parseFloat(h.quantidade) || 0), 0);
    e.progresso = Math.max(0, (parseFloat(e.progresso) || 0) - qtdRemovida);
    const base = new Date(dia + 'T00:00:00');
    e.dataFim = this._isoDia(new Date(base.getTime() - 86400000));
    if (e.periodo === 'unica' && e.status === 'concluida' && e.alvo > 0 && e.progresso < e.alvo) e.status = 'ativa';
    e.updatedAt = new Date().toISOString();
    this.saveExtras(list); return e;
  },
  // Remove APENAS as ocorrências futuras (a partir de hoje) de uma atividade recorrente,
  // preservando a atividade e todo o histórico já registrado. Encerra a recorrência hoje.
  encerrarRecorrenciaFutura(id) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    const hoje = todayLocal();
    e.datas = (e.datas || []).filter(d => d < hoje);   // mantém só as ocorrências passadas
    const ontem = this._isoDia(new Date(new Date(hoje + 'T00:00:00').getTime() - 86400000));
    e.dataFim = ontem;                                 // para de reiniciar/gerar a partir de hoje
    e.updatedAt = new Date().toISOString();
    this.saveExtras(list); return e;
  },
  // Agenda: vincula/desvincula uma atividade a uma data (calendário em linha)
  toggleExtraData(id, dataISO) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    e.datas = Array.isArray(e.datas) ? e.datas : [];
    const i = e.datas.indexOf(dataISO);
    if (i >= 0) e.datas.splice(i, 1); else e.datas.push(dataISO);
    e.updatedAt = new Date().toISOString();
    this.saveExtras(list); return e;
  },
  setExtraData(id, dataISO, on) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    e.datas = Array.isArray(e.datas) ? e.datas : [];
    const i = e.datas.indexOf(dataISO);
    if (on && i < 0) e.datas.push(dataISO);
    if (!on && i >= 0) e.datas.splice(i, 1);
    this.saveExtras(list); return e;
  },
  addExtraProgress(id, quantidade, minutos, opts) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    opts = opts || {};
    const q = Math.max(0, parseFloat(quantidade) || 0);
    const data = opts.data || todayLocal();          // permite lançamento retroativo
    e.progresso = Math.max(0, (e.progresso || 0) + q);
    e.historico = e.historico || [];
    let min = Math.max(0, parseFloat(minutos) || 0);
    // Atividades medidas em MINUTOS (unidade 'min' ou tipo vídeo): a própria quantidade
    // já é o tempo. Sem isto, o "registrado hoje" (que soma minutos) ficava 0 e o tempo
    // não entrava nas métricas de estudo.
    if (min === 0 && (e.unidade === 'min' || e.tipo === 'video')) min = q;
    const reg = { data, quantidade: q, minutos: min };
    // questões: guarda os ACERTOS para não zerar o aproveitamento nas métricas
    if (opts.acertos != null && opts.acertos !== '') reg.acertos = Math.max(0, Math.min(q, parseFloat(opts.acertos) || 0));
    e.historico.push(reg);
    // Conclusão: recorrentes concluem por PERÍODO (reiniciam); únicas concluem no total.
    if (e.alvo > 0 && this.extraProgressoPeriodo(e) >= e.alvo && e.periodo === 'unica') e.status = 'concluida';
    e.updatedAt = new Date().toISOString();
    this.saveExtras(list); return e;
  },
  // Remove o ÚLTIMO lançamento (desfaz erro de digitação, que antes ficava permanente)
  undoExtraProgress(id) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e || !e.historico || !e.historico.length) return null;
    const ultimo = e.historico.pop();
    e.progresso = Math.max(0, (e.progresso || 0) - (ultimo.quantidade || 0));
    if (e.status === 'concluida' && e.periodo === 'unica' && e.alvo > 0 && e.progresso < e.alvo) e.status = 'ativa';
    e.updatedAt = new Date().toISOString();
    this.saveExtras(list); return ultimo;
  },
  // Desfaz o ÚLTIMO lançamento feito num DIA específico (permite corrigir/diminuir
  // o registro de qualquer dia, não só o último global). Retorna o lançamento removido.
  undoExtraProgressDay(id, dia) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e || !e.historico || !e.historico.length) return null;
    dia = dia || todayLocal();
    for (let i = e.historico.length - 1; i >= 0; i--) {
      if (e.historico[i].data === dia) {
        const removido = e.historico.splice(i, 1)[0];
        e.progresso = Math.max(0, (e.progresso || 0) - (removido.quantidade || 0));
        if (e.status === 'concluida' && e.periodo === 'unica' && e.alvo > 0 && e.progresso < e.alvo) e.status = 'ativa';
        e.updatedAt = new Date().toISOString();
        this.saveExtras(list); return removido;
      }
    }
    return null;
  },
  // Quantidade de lançamentos registrados num dia específico
  extraRegistrosNoDia(e, dia) {
    if (!e || !e.historico) return 0;
    dia = dia || todayLocal();
    return e.historico.filter(h => h.data === dia).length;
  },
  _isoDia(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  // Gera as DATAS de ocorrência de uma atividade recorrente, do início até a data-fim.
  // Passo conforme a periodicidade (diária/semanal/quinzenal/mensal). Sem data-fim,
  // não gera nada (para não criar ocorrências infinitas) — exige o limite de propósito.
  _gerarDatasRecorrencia(e) {
    if (!e || !this.extraRecorrente(e)) return [];
    const fim = (e.dataFim && String(e.dataFim).trim()) || null;
    if (!fim) return []; // sem limite: não vincula datas automaticamente
    let inicio = (e.dataInicio && String(e.dataInicio).trim())
      || (e.createdAt ? String(e.createdAt).slice(0, 10) : todayLocal());
    if (inicio > fim) return [];
    const datas = [];
    const ini = new Date(inicio + 'T00:00:00');
    const dFim = new Date(fim + 'T00:00:00');
    let guard = 0;
    if (e.periodo === 'mensal') {
      // Passo mensal ancorado no DIA de início, com clamp ao último dia do mês
      // (31/jan → 28/fev, não 03/mar). Evita a "deriva" do setMonth nativo.
      const diaAlvo = ini.getDate();
      let ano = ini.getFullYear(), mes = ini.getMonth();
      while (guard++ < 4000) {
        const ultimoDia = new Date(ano, mes + 1, 0).getDate();
        const d = new Date(ano, mes, Math.min(diaAlvo, ultimoDia));
        if (d > dFim) break;
        datas.push(this._isoDia(d));
        mes++; if (mes > 11) { mes = 0; ano++; }
      }
    } else {
      const passo = e.periodo === 'semanal' ? 7 : e.periodo === 'quinzenal' ? 14 : 1;
      const d = new Date(ini);
      while (d <= dFim && guard++ < 4000) {
        datas.push(this._isoDia(d));
        d.setDate(d.getDate() + passo);
      }
    }
    return datas;
  },
  // Prévia (contagem) de quantas ocorrências serão geradas — para o modal mostrar ao usuário.
  previewDatasRecorrencia(cfg) { return this._gerarDatasRecorrencia(cfg).length; },
  // Recalcula e vincula as datas de recorrência de uma atividade já salva.
  // Recorrente + data-fim → substitui `datas` pelas geradas. Caso contrário, não mexe.
  sincronizarDatasRecorrencia(id) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    if (this.extraRecorrente(e) && e.dataFim) {
      e.datas = this._gerarDatasRecorrencia(e).filter(d => !(e.excluidasEm || []).includes(d));
      e.updatedAt = new Date().toISOString();
      this.saveExtras(list);
    }
    return e;
  },
  // É recorrente (reinicia a cada período)? diária, semanal, quinzenal ou mensal.
  extraRecorrente(x) { return x && (x.periodo === 'diaria' || x.periodo === 'semanal' || x.periodo === 'quinzenal' || x.periodo === 'mensal'); },
  // A recorrência terminou? (passou da data-fim escolhida). Depois disso não reinicia mais.
  extraEncerrada(x) { return !!(x && x.dataFim && todayLocal() > x.dataFim); },
  // Início do PERÍODO CORRENTE de uma meta recorrente. Alinhado ao calendário para que
  // a meta "reinicie" de forma previsível: semanal reseta na segunda-feira, mensal no dia 1.
  //   diária    = hoje
  //   semanal   = segunda-feira desta semana
  //   quinzenal = 14 dias atrás (janela móvel)
  //   mensal    = dia 1 deste mês
  _periodoInicio(periodo) {
    const hoje = todayLocal();
    const d = new Date(hoje + 'T00:00:00');
    if (periodo === 'diaria') return hoje;
    if (periodo === 'semanal') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return this._isoDia(d); }
    if (periodo === 'quinzenal') { d.setDate(d.getDate() - 13); return this._isoDia(d); }
    if (periodo === 'mensal') { d.setDate(1); return this._isoDia(d); }
    return null;
  },
  // Progresso que vale para a barra: metas recorrentes contam só o PERÍODO ATUAL.
  // Sem isso, uma meta de 50 cards/dia mostrava 100% para sempre a partir do 1º dia.
  extraProgressoPeriodo(e) {
    if (!e) return 0;
    // recorrência encerrada: mostra o total acumulado (não reinicia mais)
    if (this.extraEncerrada(e)) return e.progresso || 0;
    const ini = this._periodoInicio(e.periodo);
    if (!ini) return e.progresso || 0;
    return (e.historico || []).filter(h => h.data >= ini).reduce((a, h) => a + (h.quantidade || 0), 0);
  },
  // A OCORRÊNCIA daquele dia está concluída?
  //   única     → status global (permanente)
  //   recorrente → só se a data estiver marcada como concluída (por DIA)
  // Assim, concluir "hoje" não some com a atividade nos dias seguintes: cada dia é
  // uma tarefa independente, que reaparece limpa no dia seguinte.
  extraConcluidaEm(e, dia) {
    if (!e) return false;
    dia = dia || todayLocal();
    if (this.extraRecorrente(e)) return (e.concluidasEm || []).includes(dia);
    return e.status === 'concluida';
  },
  // Marca/desmarca a conclusão de uma ocorrência num dia específico.
  setConcluidaDia(id, dia, on) {
    const list = this.getExtras(); const e = list.find(x => x.id === id);
    if (!e) return null;
    dia = dia || todayLocal();
    // Guarda de integridade: nunca conclui um dia futuro (planejamento, não execução).
    if (on && dia > todayLocal()) return e;
    if (this.extraRecorrente(e)) {
      e.concluidasEm = Array.isArray(e.concluidasEm) ? e.concluidasEm : [];
      const i = e.concluidasEm.indexOf(dia);
      if (on && i < 0) e.concluidasEm.push(dia);
      if (!on && i >= 0) e.concluidasEm.splice(i, 1);
    } else {
      e.status = on ? 'concluida' : 'ativa';
    }
    e.updatedAt = new Date().toISOString();
    this.saveExtras(list); return e;
  },
  // Configuração: incluir Atividades Extras nas métricas de Evolução (por PERFIL, sincronizada)
  _extrasMetricsKey() { return this._profilePrefix() + 'extras-in-metrics'; },
  extrasCountGlobal() {
    try {
      let v = localStorage.getItem(this._extrasMetricsKey());
      if (v === null) { // migra a chave global antiga
        const legado = localStorage.getItem('diario-estudos:extras-in-metrics');
        if (legado !== null) { this.setRaw(this._extrasMetricsKey(), legado); v = legado; }
      }
      return v === null ? false : v === '1';
    } catch (_) { return false; }
  },
  setExtrasCountGlobal(on) { this.setRaw(this._extrasMetricsKey(), on ? '1' : '0'); },
  addCustomSigla({ sigla, nome, color }) {
    const list = this.getCustomSiglas();
    list.push({ id: this._uid(), sigla: (sigla || '').trim().toUpperCase(), nome: (nome || '').trim(), color: color || '#4f46e5' });
    this.saveCustomSiglas(list);
    return list[list.length - 1];
  },
  updateCustomSigla(id, patch) {
    const list = this.getCustomSiglas();
    const s = list.find(x => x.id === id);
    if (s) { if (patch.sigla !== undefined) patch.sigla = String(patch.sigla || '').trim().toUpperCase(); Object.assign(s, patch); }
    this.saveCustomSiglas(list);
  },
  removeCustomSigla(id) { this.saveCustomSiglas(this.getCustomSiglas().filter(x => x.id !== id)); },
  // Cria/atualiza a sigla e/ou cor de uma MATÉRIA (usada para editar as siglas automáticas).
  // Guarda como uma sigla customizada vinculada ao nome da matéria.
  upsertSubjectSigla(nome, { sigla, color }) {
    const list = this.getCustomSiglas();
    const nk = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    let s = list.find(c => c.nome && nk(c.nome) === nk(nome));
    if (!s) { s = { id: this._uid(), sigla: '', nome: nome, color: '#4f46e5' }; list.push(s); }
    if (sigla !== undefined) s.sigla = (sigla || '').trim().toUpperCase();
    if (color !== undefined) s.color = color;
    this.saveCustomSiglas(list);
    return s;
  },

  // --- Cycle History ---
  getCycleHistory() { return this._get(this.KEYS.cycleHistory, []); },
  saveCycleToHistory(cycleSnapshot) {
    const history = this.getCycleHistory();
    history.push(cycleSnapshot);
    this._set(this.KEYS.cycleHistory, history);
  },
  updateCycleHistoryEntry(id, patch) {
    const history = this.getCycleHistory();
    const w = history.find(x => x.id === id);
    if (w) Object.assign(w, patch);
    this._set(this.KEYS.cycleHistory, history);
    return w;
  },
  deleteCycleHistoryEntry(id) {
    const history = this.getCycleHistory().filter(x => x.id !== id);
    this._set(this.KEYS.cycleHistory, history);
  },
  // Verifica se o intervalo [start,end] se sobrepõe a algum ciclo já existente.
  // excludeHistoryId: ignora uma semana do histórico (ao editá-la).
  // includeActive: também considera a semana ativa atual (default true).
  // Retorna o item conflitante { start, end, label } ou null.
  findCycleOverlap(start, end, excludeHistoryId, includeActive) {
    if (!start || !end) return null;
    if (includeActive === undefined) includeActive = true;
    const items = [];
    this.getCycleHistory().forEach(w => {
      if (excludeHistoryId != null && w.id === excludeHistoryId) return;
      items.push({ start: w.startDate, end: w.endDate, label: 'semana ' + w.startDate + ' → ' + w.endDate });
    });
    if (includeActive) {
      const c = this.getCurrentCycle();
      if (c) items.push({ start: c.startDate, end: c.endDate, label: 'a semana atual em montagem' });
    }
    return items.find(it => start <= it.end && it.start <= end) || null;
  },

  // --- Trilhas de Estudo Novo (por matéria) ---
  // Cada trilha é uma lista ordenada de itens: { type: 'aula', ... } ou { type: 'checkpoint', ... }
  // A ordem do array É a ordem de exibição — reordenar = reordenar o array.
  // --- Status do Estudo Novo (lista editável, com cor e flag "done") ---
  getStatuses() {
    let list = this._get(this.KEYS.statuses, null);
    if (!list) {
      list = this.DEFAULT_STATUSES.map(s => ({ id: this._uid(), ...s, ativo: true }));
      this._set(this.KEYS.statuses, list);
    }
    return list;
  },
  getActiveStatuses() { return this.getStatuses().filter(s => s.ativo); },
  // Resolve uma referência de status (id novo OU nome legado) para o objeto de status.
  resolveStatus(ref) {
    const list = this.getStatuses();
    if (!list.length) return { id: null, nome: ref || '—', color: '#5b6270', bg: '#eef0f3', done: false };
    return list.find(s => s.id === ref)
        || list.find(s => s.nome.toLowerCase() === String(ref || '').toLowerCase())
        || list[0];
  },
  isStatusDone(ref) { return !!this.resolveStatus(ref).done; },
  addStatus(nome) {
    const list = this.getStatuses();
    if (list.find(s => s.nome.toLowerCase() === nome.toLowerCase())) return;
    const palette = this.STATUS_PALETTE[list.length % this.STATUS_PALETTE.length];
    list.push({ id: this._uid(), nome, color: palette.color, bg: palette.bg, done: false, ativo: true });
    this._set(this.KEYS.statuses, list);
  },
  updateStatus(id, patch) {
    const list = this.getStatuses();
    const s = list.find(x => x.id === id);
    if (s) Object.assign(s, patch);
    this._set(this.KEYS.statuses, list);
  },
  setStatusActive(id, ativo) { this.updateStatus(id, { ativo }); },
  statusInUse(statusObj) {
    const all = this._get(this.KEYS.tracks, {});
    return Object.values(all).some(items =>
      (items || []).some(i => i.type === 'aula' && this.resolveStatus(i.status).id === statusObj.id));
  },
  removeStatusSafely(id) {
    const list = this.getStatuses();
    const s = list.find(x => x.id === id);
    if (!s) return;
    if (this.statusInUse(s)) {
      s.ativo = false;
      this._set(this.KEYS.statuses, list);
    } else {
      this._set(this.KEYS.statuses, list.filter(x => x.id !== id));
    }
  },

  // --- Etapas de resolução de uma aula: acertos/total => percentual ---
  // Lê o percentual de uma etapa: usa acertos/total se houver; senão cai no valor legado (manualPct/pct antigo).
  getStagePct(item, stageDef) {
    const stage = item[stageDef.key];
    if (stage && stage.total > 0) return calcPct(stage.acertos || 0, stage.total);
    if (stage && stage.manualPct !== null && stage.manualPct !== undefined) return stage.manualPct;
    const legacy = item[stageDef.legacy];
    if (legacy !== null && legacy !== undefined && legacy !== '') return legacy;
    return null;
  },
  getStageValues(item, stageDef) {
    const stage = item[stageDef.key] || {};
    return { acertos: stage.acertos ?? null, total: stage.total ?? null };
  },

  getTrack(subjectName) {
    const all = this._get(this.KEYS.tracks, {});
    return all[subjectName] || [];
  },
  saveTrack(subjectName, items) {
    const all = this._get(this.KEYS.tracks, {});
    all[subjectName] = items;
    this._set(this.KEYS.tracks, all);
  },
  getAllTrackSubjects() {
    const all = this._get(this.KEYS.tracks, {});
    return Object.keys(all).filter(name => (all[name] || []).length > 0);
  },
  addTrackLesson(subjectName, text) {
    const items = this.getTrack(subjectName);
    const firstStatus = this.getActiveStatuses()[0] || this.getStatuses()[0];
    items.push({
      id: this._uid(), type: 'aula', text,
      status: firstStatus ? firstStatus.id : 'ESTUDAR',
      r1: { acertos: null, total: null },
      rCheck: { acertos: null, total: null },
      rRev: { acertos: null, total: null }
    });
    this.saveTrack(subjectName, items);
  },
  // Grava os valores (acertos/total) de uma etapa de uma aula
  /* Acertos nunca podem passar do total. Sem esta trava dava para gravar
     "12 de 8" e a etapa exibia 150% de acerto — número impossível que ainda
     entrava na média da trilha. O ajuste é feito no dado, não só na exibição:
     percentual acima de 100% contamina qualquer agregado que o some depois. */
  updateTrackStage(subjectName, itemId, stageKey, part, value) {
    const items = this.getTrack(subjectName);
    const item = items.find(i => i.id === itemId);
    if (item) {
      if (!item[stageKey] || typeof item[stageKey] !== 'object') item[stageKey] = { acertos: null, total: null };
      item[stageKey][part] = value;
      const st = item[stageKey];
      if (st.total != null && st.acertos != null && st.acertos > st.total) {
        // quem acabou de digitar manda: ajusta o OUTRO campo para caber
        if (part === 'total') st.acertos = st.total; else st.total = st.acertos;
      }
    }
    this.saveTrack(subjectName, items);
  },
  addTrackCheckpoint(subjectName, afterItemId) {
    const items = this.getTrack(subjectName);
    const checkpoint = { id: this._uid(), type: 'checkpoint', label: 'CHECKPOINT \\o/' };
    if (afterItemId === null) {
      items.push(checkpoint);
    } else {
      const idx = items.findIndex(i => i.id === afterItemId);
      items.splice(idx + 1, 0, checkpoint);
    }
    this.saveTrack(subjectName, items);
  },
  updateTrackItem(subjectName, itemId, patch) {
    const items = this.getTrack(subjectName);
    const item = items.find(i => i.id === itemId);
    if (item) Object.assign(item, patch);
    this.saveTrack(subjectName, items);
  },
  removeTrackItem(subjectName, itemId) {
    const items = this.getTrack(subjectName).filter(i => i.id !== itemId);
    this.saveTrack(subjectName, items);
  },
  reorderTrack(subjectName, newOrderIds) {
    const items = this.getTrack(subjectName);
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    const reordered = newOrderIds.map(id => byId[id]).filter(Boolean);
    this.saveTrack(subjectName, reordered);
  },

  /* ---- Leituras cruzando planejamentos (usadas na gestão e nas telas consolidadas) ---- */
  getEntriesForPlan(planId) { return this._get(this.keysForPlan(planId).entries, []); },
  getSubjectsForPlan(planId) { return this._get(this.keysForPlan(planId).subjects, []); },
  getCycleHistoryForPlan(planId) { return this._get(this.keysForPlan(planId).cycleHistory, []); },
  getTracksForPlan(planId) { return this._get(this.keysForPlan(planId).tracks, {}); },
  // Todos os registros de todos os planejamentos, cada um marcado com o plano de origem
  getAllEntriesTagged() {
    return PlanManager.getPlans().flatMap(p =>
      this.getEntriesForPlan(p.id).map(e => ({ ...e, _planId: p.id, _planNome: p.nome }))
    );
  },
  getAllCycleHistoryTagged() {
    return PlanManager.getPlans().flatMap(p =>
      this.getCycleHistoryForPlan(p.id).map(w => ({ ...w, _planId: p.id, _planNome: p.nome }))
    );
  },

  /* ---- Desempenho TEC: retratos por INTERVALO de importação do TecConcursos ---- */
  // Cada snapshot: { id, startDate, endDate, label, rows:[...], importedAt }
  // (retratos antigos tinham só `date` — migrados para startDate=endDate=date)
  getTecSnapshots() {
    const list = this._get(this.KEYS.tec, []);
    let migrated = false;
    list.forEach(s => {
      if (!s.startDate) { s.startDate = s.date || todayLocal(); migrated = true; }
      if (!s.endDate) { s.endDate = s.date || s.startDate; migrated = true; }
    });
    if (migrated) this._set(this.KEYS.tec, list);
    // ordena pelo início do intervalo
    return list.slice().sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  },
  saveTecSnapshot(snap) {
    const list = this._get(this.KEYS.tec, []);
    list.push(snap);
    this._set(this.KEYS.tec, list);
    return snap;
  },
  deleteTecSnapshot(id) {
    this._set(this.KEYS.tec, this._get(this.KEYS.tec, []).filter(s => s.id !== id));
  },
  updateTecSnapshot(id, patch) {
    const list = this._get(this.KEYS.tec, []);
    const s = list.find(x => x.id === id);
    if (s) Object.assign(s, patch);
    this._set(this.KEYS.tec, list);
  },
  latestTecSnapshot() {
    const list = this.getTecSnapshots();
    return list.length ? list[list.length - 1] : null;
  },
  // Retorna o retrato existente que se sobrepõe ao intervalo [start,end], ou null.
  // Dois intervalos se sobrepõem quando start <= b.end E end >= b.start.
  tecOverlap(start, end, ignoreId = null) {
    return this.getTecSnapshots().find(s =>
      s.id !== ignoreId && start <= s.endDate && end >= s.startDate) || null;
  }
};
