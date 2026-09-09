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
    /* O id precisa ser um UUID de verdade: toda tabela da nuvem (study_profiles,
       profile_sections, profile_backups) tem a coluna id/profile_id como `uuid`.
       Um id fora desse formato faz TODA operação de nuvem para este perfil
       falhar com "invalid input syntax for type uuid" — na maioria dos
       caminhos, silenciosamente (SectionSync engole erro por seção e só loga
       no console). O sintoma: o perfil parece normal aqui (o nome muda na
       hora, é local), mas nunca sincroniza — nunca aparece em outro aparelho,
       nunca tem backup no banco, e a lista pode "piscar" porque a nuvem nunca
       tem nada de verdade para ele. Perfis com o formato antigo ('u_...') já
       existentes são promovidos por ProfileManager.migrarIdsAntigos(). */
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
    // se há conta logada, este perfil nasce já marcado como dela — impede que
    // ele apareça na lista de outra conta neste mesmo navegador antes mesmo
    // do primeiro envio à nuvem
    try {
      const uid = (window.CloudStore && CloudStore.session && CloudStore.session.user) ? CloudStore.session.user.id : null;
      if (uid) this._setOwner(id, uid);
    } catch (e) { _quiet(e, 'owner-create'); }
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
      if (sub === '__secrev' || sub === '__secpend' || sub === '__secdel') continue;
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
  /* ── PERFIS QUE TÊM DADOS NESTE APARELHO ──────────────────────────────────
     Varre o armazenamento atrás de namespaces `diario-estudos:u:<id>:` com
     conteúdo de verdade (a contabilidade de sync, a lixeira e as fotos não
     contam — um perfil que só tem isso está vazio). É a fonte da verdade para
     a regra abaixo: quem tem dado aqui NUNCA some da lista. */
  perfisComDadosLocais() {
    const achados = {};
    const RE = /^diario-estudos:u:([^:]+):(.+)$/;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const m = RE.exec(k);
        if (!m) continue;
        const sub = m[2];
        if (sub === '__secrev' || sub === '__secpend' || sub === '__secdel') continue;
        if (sub.indexOf('vhist') === 0) continue;
        if (window.Lixeira && sub.indexOf(Lixeira.PREFIXO) === 0) continue;
        const v = localStorage.getItem(k) || '';
        if (v === '' || v === '[]' || v === '{}' || v === 'null') continue;
        const a = achados[m[1]] || (achados[m[1]] = { id: m[1], bytes: 0, secoes: 0 });
        a.bytes += v.length; a.secoes++;
      }
    } catch (e) { _quiet(e, 'perfis-com-dados'); }
    return Object.values(achados);
  },
  temDadosLocais(id) { return this.perfisComDadosLocais().some(p => p.id === id); },

  /* ── DE QUAL CONTA É ESTE PERFIL LOCAL ────────────────────────────────────
     `perfisComDadosLocais` varre o navegador inteiro, sem saber de quem é cada
     perfil. Isso é intencional para o caso de UMA conta (nunca perder dado que
     falhou ao sincronizar) — mas em um navegador compartilhado por DUAS contas
     diferentes, a mesma varredura reaparecia com o perfil da OUTRA conta na
     lista de quem acabou de logar. Pior: `temDadosLocais` (usado para decidir
     se abre um perfil "às cegas" quando a nuvem não o encontra) não distinguia
     isso — clicar no perfil errado abria os dados inteiros de outra pessoa.

     O rótulo é gravado FORA do namespace de qualquer perfil (não é dado do
     usuário, é bookkeeping deste navegador) e associa profileId → user_id de
     quem, alguma vez, teve esse perfil confirmado pela nuvem. Perfis gravados
     ANTES desta correção não têm rótulo — ficam visíveis para qualquer um,
     exatamente como sempre foram (nenhuma regressão, nenhum dado escondido
     por engano). A partir daqui, todo perfil que passa pela nuvem uma vez fica
     marcado, e para de vazar para a próxima conta que logar neste aparelho. */
  _ownerKey(id) { return 'diario-estudos:owner:' + id; },
  _getOwner(id) { try { return localStorage.getItem(this._ownerKey(id)) || null; } catch (_) { return null; } },
  _setOwner(id, uid) { if (!id || !uid) return; try { localStorage.setItem(this._ownerKey(id), uid); } catch (e) { _quiet(e, 'owner-set'); } },
  /* true quando o perfil pode ser mostrado/aberto por esta sessão: sem dono
     conhecido (dado anterior à correção, ou nunca sincronizado) OU dono é
     quem está logado agora. Falso só quando o dono é COMPROVADAMENTE outra
     conta. */
  _podeVerLocal(id, uidAtual) {
    const dono = this._getOwner(id);
    return !dono || !uidAtual || dono === uidAtual;
  },

  /* ── PROMOÇÃO DE IDS ANTIGOS (não-UUID) A IDS DE VERDADE ──────────────────
     `createProfile` gerava ids como 'u_<timestamp><random>' — uma string
     curta, não um UUID. Localmente isso nunca importou (localStorage não
     exige formato de chave nenhum). Mas TODA tabela da nuvem tem a coluna
     id/profile_id como `uuid`, e um id fora desse formato faz cada operação
     de nuvem para aquele perfil falhar — na maioria dos caminhos, em
     silêncio (SectionSync engole erro por seção e só loga no console). Quem
     usa só vê: o nome muda na hora aqui, mas nunca sincroniza — nunca
     aparece em outro aparelho, nunca tem backup no banco, e a lista pode
     "piscar" porque a nuvem nunca tem nada de verdade para esse perfil.

     Esta função promove cada perfil de id antigo a um id novo e válido —
     movendo TODO o namespace local para a chave nova, sem apagar nada, e
     enfileirando o envio à nuvem. Só roda com conta logada (é o `createRow`
     da nuvem quem determina o id novo) e uma vez por perfil. */
  ID_VALIDO_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  idValido(id) { return !!id && this.ID_VALIDO_RE.test(id); },
  _migMarcaChave(id) { return 'diario-estudos:migrado-uuid:' + id; },
  async migrarIdsAntigos() {
    if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return;
    const alvos = (this.getProfiles() || []).filter(p => p && p.id && !this.idValido(p.id));
    for (const p of alvos) {
      let jaFeito = false;
      try { jaFeito = !!localStorage.getItem(this._migMarcaChave(p.id)); } catch (_) { _quiet(_); }
      if (jaFeito) continue;
      try { await this._migrarUmPerfil(p); } catch (e) { console.warn('[perfis] migração de id falhou para', p.id, e); }
    }
  },
  async _migrarUmPerfil(perfilAntigo) {
    const idAntigo = perfilAntigo.id;
    console.info('[perfis] promovendo perfil de id local "' + idAntigo + '" a um id de nuvem válido…');
    const row = await CloudStore.createRow({ name: perfilAntigo.nome, avatar: perfilAntigo.avatar, color: perfilAntigo.cor, payload: {} });
    if (!row || !row.id) throw new Error('createRow não devolveu id');
    const idNovo = row.id;
    const prefixoAntigo = 'diario-estudos:u:' + idAntigo + ':';
    const prefixoNovo = 'diario-estudos:u:' + idNovo + ':';
    // Move o namespace inteiro: copia para a chave nova primeiro, só remove a
    // antiga depois de confirmar que a cópia bateu — nunca apaga sem provar
    // que o destino já tem o mesmo valor.
    const mover = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefixoAntigo) === 0) mover.push(k);
    }
    mover.forEach(k => {
      const valor = localStorage.getItem(k);
      try { localStorage.setItem(prefixoNovo + k.slice(prefixoAntigo.length), valor); } catch (e) { _quiet(e, 'mig-copia'); }
    });
    mover.forEach(k => {
      const destino = prefixoNovo + k.slice(prefixoAntigo.length);
      if (localStorage.getItem(destino) === localStorage.getItem(k)) localStorage.removeItem(k);
    });
    // troca o id no índice de perfis, preservando nome/avatar/cor atuais
    const lista = this.getProfiles();
    const entrada = lista.find(p => p.id === idAntigo);
    if (entrada) entrada.id = idNovo;
    this.saveProfiles(lista);
    this.setRev(idNovo, row.rev || 1);
    try { this._setOwner(idNovo, CloudStore.session.user.id); } catch (e) { _quiet(e, 'mig-dono'); }
    // se este era o perfil ATIVO, o ponteiro precisa apontar para o id novo —
    // e só nesse caso vale a pena empurrar o conteúdo agora (SectionSync só
    // enxerga o namespace do perfil ATIVO; migrar um perfil em segundo plano
    // não deve trocar o que está aberto por baixo do usuário).
    const eraAtivo = (this.getActiveProfileId() === idAntigo);
    if (eraAtivo) this.setActiveProfile(idNovo);
    try { localStorage.setItem(this._migMarcaChave(idAntigo), idNovo); } catch (e) { _quiet(e, 'mig-marca'); }
    if (eraAtivo) {
      try { if (window.SectionSync) { SectionSync._seededProfile = null; SectionSync.markAllDirty(); SectionSync.kick(); } } catch (e) { _quiet(e, 'mig-envio'); }
      try { await CloudStore.saveActiveWithRetry(); } catch (e) { _quiet(e, 'mig-blob'); }
    }
    console.info('[perfis] perfil migrado: ' + idAntigo + ' → ' + idNovo + (eraAtivo ? ' (ativo — enviado agora)' : ' (sincroniza ao ser aberto)'));
  },

  /* ── ESPELHO DA NUVEM — COM UMA TRAVA ─────────────────────────────────────
     Esta função reconstruía a lista de perfis com o que a nuvem devolvesse, e
     só com isso. Se a resposta viesse sem um perfil — linha apagada, RLS
     recusando, outra conta, resposta parcial —, a entrada dele sumia da lista
     e os dados dele ficavam ILHADOS: continuam no aparelho, inteiros, sem
     nenhuma porta para chegar até eles. Foi assim que um perfil com 1,1 MB de
     estudo desapareceu da tela enquanto estava todo ali.

     Duas regras agora:

       1. QUEM TEM DADO AQUI NÃO SAI DA LISTA. Um perfil ausente na nuvem mas
          com conteúdo neste aparelho permanece, marcado `soLocal`.
       2. QUEM TEM DADO AQUI E NÃO ESTÁ NA LISTA, ENTRA. Se o registro já se
          perdeu numa versão anterior, ele é readotado sozinho — a pessoa não
          precisa descobrir que existe uma tela de recuperação para ver o
          próprio estudo de volta.

     A lista de perfis é um ÍNDICE, e um índice nunca pode ser mais restritivo
     que o conteúdo que ele indexa. */
  syncMirrorFromCloud(rows) {
    const daNuvem = (rows || []).map(r => ({ id: r.id, nome: r.profile_name, avatar: r.avatar, cor: r.color, createdAt: r.created_at || '' }));
    const idsNuvem = new Set(daNuvem.map(p => p.id));
    const anteriores = this.getProfiles() || [];
    const porId = {};
    anteriores.forEach(p => { if (p && p.id) porId[p.id] = p; });

    /* A nuvem ACABOU de confirmar: estes ids são desta conta. Marca o dono
       agora — é o que impede o mesmo perfil de "vazar" para a lista da
       próxima conta que logar neste navegador. */
    const uidAtual = (window.CloudStore && CloudStore.session && CloudStore.session.user) ? CloudStore.session.user.id : null;
    if (uidAtual) daNuvem.forEach(p => this._setOwner(p.id, uidAtual));

    const sobreviventes = [];
    const deOutraConta = [];
    this.perfisComDadosLocais().forEach(d => {
      if (idsNuvem.has(d.id)) return;                 // a nuvem já traz este
      // dado físico existe, mas é COMPROVADAMENTE de outra conta: não mostra
      // aqui (o dado não é apagado — só não aparece para quem não é dono).
      if (!this._podeVerLocal(d.id, uidAtual)) { deOutraConta.push(d.id); return; }
      const antigo = porId[d.id] || {};
      sobreviventes.push({
        id: d.id,
        nome: antigo.nome || ('Perfil recuperado ' + String(d.id).slice(0, 8)),
        avatar: antigo.avatar || '🛟',
        cor: antigo.cor || '#0a95a8',
        createdAt: antigo.createdAt || '',
        soLocal: true
      });
    });
    if (sobreviventes.length) {
      try { console.warn('[perfis] ' + sobreviventes.length + ' perfil(is) têm dados neste aparelho e não vieram da nuvem — MANTIDOS na lista: ' + sobreviventes.map(p => p.id).join(', ')); } catch (e) { _quiet(e, 'perfis-log'); }
    }
    if (deOutraConta.length) {
      try { console.info('[perfis] ' + deOutraConta.length + ' perfil(is) locais pertencem a OUTRA conta — ocultados desta sessão (dado preservado, não apagado): ' + deOutraConta.join(', ')); } catch (e) { _quiet(e, 'perfis-log2'); }
    }
    this.saveProfiles(daNuvem.concat(sobreviventes));
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
    const local = ['__secrev', '__secpend', '__secdel'];
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const sub = k.slice(prefix.length);
      if (manter.has(sub) || local.indexOf(sub) !== -1) continue;
      toRemove.push(k);
    }
    // Conta o que REALMENTE mudou: é o que permite a quem chamou decidir se vale
    // recarregar a tela. Recarregar "por precaução" era o que fazia o app piscar.
    let mudou = 0;
    const vindas = dataObj || {};
    /* MESMA REGRA DO CAMINHO POR SEÇÃO: não estar no que veio da nuvem não prova
       que a pessoa apagou — prova, no mínimo das vezes, que o dado nunca chegou
       lá (blob antigo, envio que falhou, uso offline). Só apagamos daqui o que
       TEM revisão gravada, isto é, o que comprovadamente já esteve na nuvem.
       O resto é o único exemplar existente e fica. */
    let jaSincronizadas = {};
    try { jaSincronizadas = (window.SectionSync ? SectionSync._getRevs(id) : {}) || {}; } catch (e) { _quiet(e, 'revs-blob'); }
    const preservadas = [];
    toRemove.forEach(k => {
      const sub = k.slice(prefix.length);
      if (sub in vindas) return;                       // vem logo abaixo, atualizada
      if (!jaSincronizadas[sub]) { preservadas.push(sub); return; }   // nunca subiu: fica
      Lixeira.guardar(k, 'ausente no download da nuvem');
      localStorage.removeItem(k); mudou++;
    });
    if (preservadas.length) {
      try { console.warn('[perfil] ' + preservadas.length + ' seção(ões) existem só neste aparelho e foram PRESERVADAS: ' + preservadas.join(', ')); } catch (e) { _quiet(e, 'preservadas-log'); }
      try { if (window.SectionSync) preservadas.forEach(sec => SectionSync.markDirty(prefix + sec)); } catch (e) { _quiet(e, 'preservadas-fila'); }
    }
    Object.keys(vindas).forEach(sub => {
      if (sub.startsWith('u:')) return;
      if (manter.has(sub) || local.indexOf(sub) !== -1) return;
      const atual = localStorage.getItem(prefix + sub);
      if (atual === vindas[sub]) return;
      // vazio vindo por cima de conteúdo: o local vai para a Lixeira antes (30 dias)
      if (valorVazio(vindas[sub]) && !valorVazio(atual)) {
        try { Lixeira.guardar(prefix + sub, 'esvaziada pelo download da nuvem'); } catch (e) { _quiet(e, 'restore-lixeira'); }
      }
      localStorage.setItem(prefix + sub, vindas[sub]);
      mudou++;
    });
    return mudou;
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
