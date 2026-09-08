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
  getActivePlanId() { try { return localStorage.getItem(this.GK.active); } catch (e) { return null; } },
  getActivePlan() { return this.getPlans().find(p => p.id === this.getActivePlanId()) || null; },
  // Trocar de planejamento é uma alteração do perfil como qualquer outra: passa
  // pelo canal único para chegar à nuvem (antes só subia no blob periódico).
  setActivePlan(id) { DB.setRaw(this.GK.active, id); },

  // Semeia formas de estudo e fases padrão para um planejamento novo,
  // para que todas as telas já funcionem "de fábrica".
  _seedDefaults(planId) {
    const k = DB.keysForPlan(planId);
    if (localStorage.getItem(k.methods) === null)
      DB._set(k.methods, DB.DEFAULT_METHODS.map(nome => ({ id: DB._uid(), nome, ativo: true })));
    if (localStorage.getItem(k.phases) === null)
      DB._set(k.phases, DB.DEFAULT_PHASES.map(nome => ({ id: DB._uid(), nome, ativo: true })));
    if (localStorage.getItem(k.statuses) === null)
      DB._set(k.statuses, DB.DEFAULT_STATUSES.map(s => ({ id: DB._uid(), ...s, ativo: true })));
    if (localStorage.getItem(k.modes) === null)
      DB._set(k.modes, DB.DEFAULT_MODES.map(nome => ({ id: DB._uid(), nome, ativo: true })));
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
    Object.values(k).forEach(key => localStorage.removeItem(key));
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

  // Migração transparente: na primeira execução com a nova versão, cria o
  // "Planejamento inicial" e move os dados antigos (sem namespace) para dentro dele.
  _migrateLegacy(planId) {
    // só migra o legado global UMA vez (para o perfil default). Perfis novos começam vazios.
    if (localStorage.getItem('diario-estudos:legacy-consumed')) return;
    const dk = DB.keysForPlan(planId);
    Object.keys(DB.LEGACY_KEYS).forEach(entity => {
      const legacyKey = DB.LEGACY_KEYS[entity];
      const raw = localStorage.getItem(legacyKey);
      if (raw !== null && localStorage.getItem(dk[entity]) === null) {
        localStorage.setItem(dk[entity], raw); // copia (mantém o legado como backup de segurança)
      }
    });
  },

  init() {
    let plans = this.getPlans();
    if (plans.length === 0) {
      const id = 'pl_inicial';
      plans = [{ id, nome: 'Planejamento inicial', tipo: 'Pré-edital', createdAt: new Date().toISOString() }];
      this.savePlans(plans);
      this._migrateLegacy(id);
      this._seedDefaults(id);
      this.setActivePlan(id);
    }
    // garante um planejamento ativo válido
    if (!this.getActivePlan()) this.setActivePlan(this.getPlans()[0].id);
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

  getProfiles() { return DB._get(DB.PROFILES_KEY, []); },
  saveProfiles(list) { DB._set(DB.PROFILES_KEY, list); },
  getActiveProfileId() { try { return localStorage.getItem(DB.ACTIVE_PROFILE_KEY); } catch (e) { return null; } },
  getActiveProfile() { return this.getProfiles().find(p => p.id === this.getActiveProfileId()) || null; },
  setActiveProfile(id) { localStorage.setItem(DB.ACTIVE_PROFILE_KEY, id); },

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
    const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
      // A contabilidade da sincronização por seção é local a cada aparelho: levá-la
      // no backup faria o aparelho que importa herdar a fila de envio de outro.
      if (sub === '__secrev' || sub === '__secpend') continue;
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

  // Migração única: move os dados globais existentes para o perfil default.
  _migrateToDefault(profileId) {
    const destPrefix = 'diario-estudos:u:' + profileId + ':';
    const srcKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('diario-estudos:')) continue;
      if (k.startsWith('diario-estudos:u:')) continue;
      if (k === DB.PROFILES_KEY || k === DB.ACTIVE_PROFILE_KEY || k === 'diario-estudos:legacy-consumed') continue;
      srcKeys.push(k);
    }
    srcKeys.forEach(k => {
      const destKey = destPrefix + k.slice('diario-estudos:'.length);
      if (localStorage.getItem(destKey) === null) localStorage.setItem(destKey, localStorage.getItem(k));
    });
  },

  // ---- Cloud-first: o banco é a fonte da verdade; o "espelho" local é só cache ----
  initMirror() {
    if (!Array.isArray(this.getProfiles())) this.saveProfiles([]);
  },
  // revisão conhecida (localmente) do perfil na nuvem — base do optimistic locking
  _revKey(id) { return 'diario-estudos:rev:' + id; },
  getRev(id) { try { return parseInt(localStorage.getItem(this._revKey(id)), 10) || 1; } catch (e) { return 1; } },
  setRev(id, r) { try { localStorage.setItem(this._revKey(id), String(r || 1)); } catch (e) { _quiet(e); } },
  // adiciona/atualiza uma entrada no espelho local (sem tocar nos dados do perfil)
  addMirror({ id, nome, avatar, cor }) {
    const list = this.getProfiles();
    const ex = list.find(p => p.id === id);
    if (ex) { ex.nome = nome; ex.avatar = avatar; ex.cor = cor; }
    else list.push({ id, nome: nome || 'Perfil', avatar: avatar || '📘', cor: cor || '#4f46e5', createdAt: new Date().toISOString() });
    this.saveProfiles(list);
  },
  // reconstrói o espelho local a partir das linhas vindas da nuvem
  syncMirrorFromCloud(rows) {
    const list = (rows || []).map(r => ({ id: r.id, nome: r.profile_name, avatar: r.avatar, cor: r.color, createdAt: r.created_at || '' }));
    this.saveProfiles(list);
    (rows || []).forEach(r => { if (r.rev) this.setRev(r.id, r.rev); });
  },
  /* Apaga o namespace local de um perfil e aplica um payload baixado (data map).
     `preservar` lista as seções que este aparelho ainda NÃO conseguiu enviar: elas
     ficam intactas, com o valor local, e continuam na fila. Sem isso, baixar da
     nuvem apagava do próprio aparelho a alteração que ainda não tinha subido. */
  restorePayloadInto(id, dataObj, preservar) {
    const prefix = 'diario-estudos:u:' + id + ':';
    const manter = new Set(preservar || []);
    // A contabilidade da sincronização é DESTE aparelho (o que ele já enviou e o
    // que falta): vinda no backup de outro, faria este achar que está em dia.
    const local = ['__secrev', '__secpend'];
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const sub = k.slice(prefix.length);
      if (manter.has(sub) || local.indexOf(sub) !== -1) continue;
      toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    Object.keys(dataObj || {}).forEach(sub => {
      if (sub.startsWith('u:')) return;
      if (manter.has(sub) || local.indexOf(sub) !== -1) return;
      localStorage.setItem(prefix + sub, dataObj[sub]);
    });
  }
};

// Perfis PRIMEIRO (define o namespace), depois os planejamentos do perfil ativo.
// Modelo cloud-first: os perfis vêm do banco (study_profiles). No load só garantimos
// que o "espelho" local exista; o plano padrão é semeado ao ENTRAR num perfil.
ProfileManager.initMirror();
// Expõe o ProfileManager no window. Sem isto, checagens como
// "(window.ProfileManager && ...)" davam SEMPRE falso — foi o que fazia o
// diagnóstico SectionSync.status() reportar "perfilAtivo: null" mesmo com um
// perfil aberto (falso alarme). O perfil ativo real vem de getActiveProfileId().
window.ProfileManager = ProfileManager;
