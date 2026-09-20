/* ============================================================
   PLANEJAMENTOS — registro de espaços de trabalho (workspaces)
   Cada planejamento tem seu próprio namespace de dados (via DB.keysForPlan).
   ============================================================ */
const PlanManager = {
  // GK do perfil ativo (planejamentos e planejamento ativo namespaced por perfil)
  get GK() { const p = DB._profilePrefix(); return { plans: p + 'planejamentos', active: p + 'active-plan' }; },
  TIPOS: ['Pré-edital', 'Pós-edital', 'Outro'],

  getPlans() { return DB._get(this.GK.plans, []); },
  savePlans(list) { DB._set(this.GK.plans, list); },
  // Mesma leitura saneada do DB._activePlanId: um id com aspas renomearia de uma
  // vez todas as chaves do planejamento e as telas abririam vazias.
  getActivePlanId() { try { return DB._activePlanId(); } catch (e) { return null; } },
  getActivePlan() { return this.getPlans().find(p => p.id === this.getActivePlanId()) || null; },
  // Trocar de planejamento é uma alteração do perfil como qualquer outra: passa
  // pelo canal único para chegar à nuvem (antes só subia no blob periódico).
  setActivePlan(id) { DB.setRaw(this.GK.active, id); },

  // Semeia formas de estudo e fases padrão para um planejamento novo,
  // para que todas as telas já funcionem "de fábrica".
  _seedDefaults(planId, opts) {
    const k = DB.keysForPlan(planId);
    const silent = !!(opts && opts.silent);
    /* No bootstrap de um aparelho novo estes valores são apenas andaimes para a
       UI abrir. Eles NÃO são uma edição do usuário e não podem entrar na outbox
       antes da primeira hidratação; caso contrário colidem com os mesmos
       cadastros já existentes na nuvem e deixam o spinner preso em erro.
       Se o perfil for realmente novo, seedUntrackedOnly os publica depois. */
    const put = (key, value) => {
      if (silent) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { _quiet(e, 'plan-bootstrap'); return false; }
      }
      return DB._set(key, value);
    };
    if (localStorage.getItem(k.methods) === null)
      put(k.methods, DB.DEFAULT_METHODS.map(nome => ({ id: DB._uid(), nome, ativo: true })));
    if (localStorage.getItem(k.phases) === null)
      put(k.phases, DB.DEFAULT_PHASES.map(nome => ({ id: DB._uid(), nome, ativo: true })));
    if (localStorage.getItem(k.statuses) === null)
      put(k.statuses, DB.DEFAULT_STATUSES.map(s => ({ id: DB._uid(), ...s, ativo: true })));
    if (localStorage.getItem(k.modes) === null)
      put(k.modes, DB.DEFAULT_MODES.map(nome => ({ id: DB._uid(), nome, ativo: true })));
  },

  createPlan({ nome, tipo }) {
    const id = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const plans = this.getPlans();
    plans.push({ id, nome: nome.trim(), tipo: tipo || 'Outro', createdAt: new Date().toISOString() });
    this.savePlans(plans);
    this._seedDefaults(id);
    return id;
  },

  // Cria um planejamento novo aproveitando a ESTRUTURA de outro (nunca os registros/ciclos/histórico).
  duplicateFrom(sourceId, opts) {
    const id = this.createPlan({ nome: opts.nome, tipo: opts.tipo }); // já semeia padrões
    const sk = DB.keysForPlan(sourceId);
    const dk = DB.keysForPlan(id);
    const clone = (key) => JSON.parse(JSON.stringify(DB._get(key, null)));
    if (opts.copyMethods)  { const v = clone(sk.methods);  if (v) DB._set(dk.methods, v); }
    if (opts.copyPhases)   { const v = clone(sk.phases);   if (v) DB._set(dk.phases, v); }
    // Copiar matérias exige copiar os modos junto (as disciplinas referenciam o modo por id)
    if (opts.copySubjects) {
      const md = clone(sk.modes);    if (md) DB._set(dk.modes, md);
      const v = clone(sk.subjects);  if (v) DB._set(dk.subjects, v);
    }
    // Copiar trilhas exige copiar os status junto (as aulas referenciam status por id)
    if (opts.copyTracks) {
      const st = clone(sk.statuses); if (st) DB._set(dk.statuses, st);
      const v = clone(sk.tracks);    if (v) DB._set(dk.tracks, v);
    }
    return id;
  },

  renamePlan(id, nome) {
    const plans = this.getPlans();
    const p = plans.find(x => x.id === id);
    if (p) p.nome = nome.trim();
    this.savePlans(plans);
  },
  updatePlan(id, patch) {
    const plans = this.getPlans();
    const p = plans.find(x => x.id === id);
    if (p) Object.assign(p, patch);
    this.savePlans(plans);
  },
  deletePlan(id) {
    // apaga todos os dados namespaced do planejamento
    const k = DB.keysForPlan(id);
    Object.values(k).forEach(key => DB.delRaw(key, 'planejamento excluído'));
    const plans = this.getPlans().filter(p => p.id !== id);
    this.savePlans(plans);
    if (this.getActivePlanId() === id) {
      this.setActivePlan(plans[0] ? plans[0].id : this._ensureInitial());
    }
  },

  _ensureInitial() {
    const id = this.createPlan({ nome: 'Planejamento inicial', tipo: 'Pré-edital' });
    this.setActivePlan(id);
    return id;
  },

  init() {
    let plans = this.getPlans();
    let bootstrap = false;
    if (plans.length === 0) {
      bootstrap = true;
      const id = 'pl_inicial';
      plans = [{ id, nome: 'Planejamento inicial', tipo: 'Pré-edital', createdAt: new Date().toISOString() }];
      /* Inicialização física do namespace, sem declarar "o usuário mudou".
         Em aparelho já existente a hidratação remota substitui estes andaimes;
         em perfil realmente novo a semeadura de seções os envia normalmente. */
      try { localStorage.setItem(this.GK.plans, JSON.stringify(plans)); } catch (e) { _quiet(e, 'plan-bootstrap-plans'); }
      this._seedDefaults(id, { silent: true });
      try { localStorage.setItem(this.GK.active, id); } catch (e) { _quiet(e, 'plan-bootstrap-active'); }
    }
    // garante um planejamento ativo válido
    if (!this.getActivePlan()) {
      const id = this.getPlans()[0] && this.getPlans()[0].id;
      if (id) {
        if (bootstrap) { try { localStorage.setItem(this.GK.active, id); } catch (e) { _quiet(e, 'plan-bootstrap-active2'); } }
        else this.setActivePlan(id);
      }
    }
  }
};

/* ============================================================
   PERFIS DE ACESSO — multi-usuário no dispositivo
   Cada perfil tem seus próprios planejamentos e dados (namespace 'diario-estudos:u:<id>:').
   IMPORTANTE: é uma separação LOCAL, não autenticação forte. O PIN é uma trava leve.
   ============================================================ */
const ProfileManager = {
  DEFAULT_AVATARS: ['📘', '🎯', '⚖️', '📊', '🧠', '🚀', '🦉', '📚', '✏️', '🏆', '💡', '🔥'],
  DEFAULT_COLORS: ['#4f46e5', '#0f9d63', '#d97a12', '#e0393f', '#0a95a8', '#b3308a', '#5b6270', '#c9a20a'],

  /* ── A LISTA DE PERFIS É UM ÍNDICE, E ÍNDICE NÃO TEM LINHA REPETIDA ──────
     Ela crescia por seis caminhos (criar, importar, reanexar, espelhar da
     nuvem, readotar órfão, migrar id antigo) e nenhum deles era o dono da
     invariante: `saveProfiles` gravava o array como viesse. Bastava um deles
     escapar — a nuvem devolvendo a MESMA linha duas vezes é o mais fácil, e
     não depende de bug nenhum aqui — para a tela de acesso mostrar dois cards
     idênticos, com o mesmo nome, o mesmo avatar e o mesmo id. Do lado de fora
     parece que o app "criou um perfil do nada"; por dentro é a mesma pessoa
     listada duas vezes, e clicar em qualquer um dos dois abre o mesmo diário.

     Pior que confundir: quem vê um duplicado tende a apagar "o repetido" — e
     `deleteProfile` filtra por id, então apaga os DOIS, levando junto o dado
     que ele queria manter.

     A regra passa a morar aqui, no único ponto de escrita, e também na
     leitura — para uma lista já suja no aparelho aparecer limpa antes mesmo
     da próxima gravação. Vence a PRIMEIRA ocorrência (em
     `daNuvem.concat(sobreviventes)` a nuvem vem primeiro, e é ela quem manda),
     completada pelos campos que só as seguintes tiverem. */
  _sanearPerfis(list) {
    const vistos = Object.create(null);
    const out = [];
    (Array.isArray(list) ? list : []).forEach(p => {
      if (!p || typeof p !== 'object') return;
      const id = p.id == null ? '' : String(p.id).trim();
      if (!id) return;                                   // sem id não há perfil
      const ja = vistos[id];
      if (ja) {                                          // duplicado: completa o que falta
        Object.keys(p).forEach(k => {
          if (ja[k] == null || ja[k] === '') { if (p[k] != null && p[k] !== '') ja[k] = p[k]; }
        });
        return;
      }
      const copia = Object.assign({}, p, { id });
      vistos[id] = copia; out.push(copia);
    });
    return out;
  },
  getProfiles() { return this._sanearPerfis(DB._get(DB.PROFILES_KEY, [])); },
  saveProfiles(list) { DB._set(DB.PROFILES_KEY, this._sanearPerfis(list)); },
  getActiveProfileId() { try { return localStorage.getItem(DB.ACTIVE_PROFILE_KEY); } catch (e) { return null; } },
  getActiveProfile() { return this.getProfiles().find(p => p.id === this.getActiveProfileId()) || null; },
  setActiveProfile(id) {
    localStorage.setItem(DB.ACTIVE_PROFILE_KEY, id);
    /* A assinatura Realtime de seções depende do perfil ativo. Centralizar o
       aviso aqui evita deixar um canal antigo ouvindo o perfil anterior. */
    try {
      if (window.CloudStore && CloudStore.onActiveProfileChanged) {
        CloudStore.onActiveProfileChanged(id);
      }
    } catch (e) { _quiet(e, 'perfil-canal-secoes'); }
  },

  // hash simples (NÃO é segurança forte — apenas evita guardar o PIN em texto puro)
  _hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36);
  },
  setPin(id, pin) {
    const list = this.getProfiles();
    const p = list.find(x => x.id === id);
    if (p) p.pinHash = pin ? this._hash(pin) : null;
    this.saveProfiles(list);
  },
  hasPin(id) { const p = this.getProfiles().find(x => x.id === id); return !!(p && p.pinHash); },
  checkPin(id, pin) {
    const p = this.getProfiles().find(x => x.id === id);
    if (!p || !p.pinHash) return true;
    return this._hash(pin) === p.pinHash;
  },

  createProfile({ nome, avatar, cor, pin }) {
    /* Helper de projeção em RAM. A persistência real de perfis é criada por
       CloudStore.createRow(), que recebe o UUID definitivo do PostgreSQL. */
    const id = DB._uid();
    const list = this.getProfiles();
    list.push({
      id, nome: (nome || 'Novo perfil').trim(),
      avatar: avatar || this.DEFAULT_AVATARS[list.length % this.DEFAULT_AVATARS.length],
      cor: cor || this.DEFAULT_COLORS[list.length % this.DEFAULT_COLORS.length],
      pinHash: pin ? this._hash(pin) : null,
      createdAt: new Date().toISOString()
    });
    this.saveProfiles(list);
    return id;
  },
  updateProfile(id, patch) {
    const list = this.getProfiles();
    const p = list.find(x => x.id === id);
    if (p) Object.assign(p, patch);
    this.saveProfiles(list);
  },
  renameProfile(id, nome) { this.updateProfile(id, { nome: (nome || '').trim() }); },
  // ---- Helpers usados pela reconciliação com o índice da nuvem ----
  // Inserem/atualizam/removem perfis SEM disparar novo push (o guard CloudStore._applying cuida disso)
  _insertRaw({ id, nome, avatar, cor }) {
    const list = this.getProfiles();
    if (list.find(p => p.id === id)) return;
    list.push({ id, nome: nome || 'Perfil', avatar: avatar || '📘', cor: cor || '#4f46e5', pinHash: null, createdAt: new Date().toISOString() });
    this.saveProfiles(list);
  },
  updateProfileSilent(id, patch) { this.updateProfile(id, patch); },
  _removeRaw(id) {
    const prefix = 'diario-estudos:u:' + id + ':';
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) toRemove.push(k); }
    toRemove.forEach(k => localStorage.removeItem(k));
    this.saveProfiles(this.getProfiles().filter(p => p.id !== id));
  },
  deleteProfile(id) {
    // apaga TODOS os dados namespaced desse perfil
    const prefix = 'diario-estudos:u:' + id + ':';
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) toRemove.push(k); }
    toRemove.forEach(k => localStorage.removeItem(k));
    const list = this.getProfiles().filter(p => p.id !== id);
    this.saveProfiles(list);
    if (this.getActiveProfileId() === id) {
      this.setActiveProfile(list[0] ? list[0].id : this._ensureDefault());
    }
  },
  _ensureDefault() {
    const id = this.createProfile({ nome: 'Meu perfil', avatar: '📘', cor: '#4f46e5' });
    this.setActiveProfile(id);
    return id;
  },
  // Estatísticas rápidas de um perfil (para os cards da tela de acesso)
  statsForProfile(id) {
    const prefix = 'diario-estudos:u:' + id + ':';
    const plans = DB._get(prefix + 'planejamentos', []);
    let entries = 0;
    // conta registros de TODOS os planejamentos do perfil, varrendo as chaves de entries
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix + 'p:') && k.endsWith(':entries')) entries += DB._get(k, []).length;
    }
    return { planos: plans.length, registros: entries };
  },

  // Versão do formato de backup (para validar/importar arquivos)
  EXPORT_VERSION: 1,
  // Exporta um perfil completo: metadados + TODAS as chaves namespaced dele.
  exportProfile(id) {
    const meta = this.getProfiles().find(p => p.id === id);
    if (!meta) return null;
    const prefix = 'diario-estudos:u:' + id + ':';
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const sub = k.slice(prefix.length);
      if (sub.indexOf(Lixeira.PREFIXO) === 0) continue;   // a lixeira é rede local deste aparelho
      data[sub] = localStorage.getItem(k);
    }
    // não exporta o PIN (backup não deve carregar credencial); o usuário redefine se quiser
    const metaOut = { nome: meta.nome, avatar: meta.avatar, cor: meta.cor };
    return {
      app: 'diario-estudos',
      kind: 'profile-backup',
      version: this.EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: metaOut,
      data
    };
  },
  // Valida a estrutura de um arquivo importado
  validateBackup(obj) {
    return obj && obj.app === 'diario-estudos' && obj.kind === 'profile-backup'
      && obj.profile && typeof obj.data === 'object';
  },
  // Importa um backup como um NOVO perfil (id novo, para nunca sobrescrever nada).
  importProfile(obj, overrideName) {
    if (!this.validateBackup(obj)) throw new Error('Arquivo de backup inválido ou de outro app.');
    const nome = (overrideName || obj.profile.nome || 'Perfil importado').trim();
    const id = this.createProfile({
      nome,
      avatar: obj.profile.avatar || '📘',
      cor: obj.profile.cor || '#4f46e5'
      // sem PIN: perfil importado entra sem trava; o usuário define depois se quiser
    });
    const prefix = 'diario-estudos:u:' + id + ':';
    let saneados = 0;
    Object.keys(obj.data || {}).forEach(subKey => {
      // ignora eventuais chaves de perfil aninhadas por segurança
      if (subKey.startsWith('u:')) return;
      let valor = obj.data[subKey];
      // Um backup pode vir de fora (colega, grupo de estudos, download). Os cards
      // são o único conteúdo renderizado como HTML, então passam pelo saneamento
      // ANTES de tocar o localStorage — este caminho não usa DB.addCard.
      if (/(^|:)cards$/.test(subKey)) {
        try {
          const arr = JSON.parse(valor);
          if (Array.isArray(arr)) {
            arr.forEach(c => {
              if (!c || typeof c !== 'object') return;
              const f = _sanCard(c.frente), v = _sanCard(c.verso);
              if (f !== (c.frente || '') || v !== (c.verso || '')) saneados++;
              c.frente = f; c.verso = v;
            });
            valor = JSON.stringify(arr);
          }
        } catch (_) { /* chave ilegível: entra como veio, e falhará na leitura normal */ }
      }
      localStorage.setItem(prefix + subKey, valor);
    });
    if (saneados) {
      try { showToast('⚠ ' + saneados + ' card(is) do backup tinham conteúdo suspeito e foram limpos na importação.'); } catch (_) { _quiet(_); }
      console.warn('[importProfile] cards saneados:', saneados);
    }
    return id;
  },

  // ---- Cloud-first: o banco é a fonte da verdade; o "espelho" local é só cache ----
  initMirror() {
    if (!Array.isArray(this.getProfiles())) this.saveProfiles([]);
  },
  // revisão conhecida (localmente) do perfil na nuvem — base do optimistic locking
  // adiciona/atualiza uma entrada no espelho local (sem tocar nos dados do perfil)
  addMirror({ id, nome, avatar, cor }) {
    const list = this.getProfiles();
    const ex = list.find(p => p.id === id);
    if (ex) { ex.nome = nome; ex.avatar = avatar; ex.cor = cor; }
    else list.push({ id, nome: nome || 'Perfil', avatar: avatar || '📘', cor: cor || '#4f46e5', createdAt: new Date().toISOString() });
    this.saveProfiles(list);
  },
  syncMirrorFromCloud(rows) {
    const daNuvem = (rows || []).map(r => ({
      id: r.id,
      nome: r.profile_name,
      avatar: r.avatar,
      cor: r.color,
      createdAt: r.created_at || ''
    }));
    this.saveProfiles(daNuvem);
    const ativo = this.getActiveProfileId();
    if (ativo && !daNuvem.some(p => p.id === ativo)) {
      try { localStorage.removeItem(DB.ACTIVE_PROFILE_KEY); } catch (e) { _quiet(e, 'perfil-ativo-obsoleto'); }
    }
  },

};

// Perfis PRIMEIRO (define o namespace), depois os planejamentos do perfil ativo.
// Modelo cloud-first: os perfis vêm do banco (study_profiles). No load só garantimos
// que o "espelho" local exista; o plano padrão é semeado ao ENTRAR num perfil.
ProfileManager.initMirror();
// Expõe o ProfileManager no window para os módulos carregados depois dele.
window.ProfileManager = ProfileManager;
