/* ============================================================
   SECTION SYNC — sincronização POR SEÇÃO (Opção B) · FASE 1: escrita dupla
   ------------------------------------------------------------
   O que faz: além de salvar o "blob" único do perfil (como sempre), grava cada
   SEÇÃO (registros, cards, leis, ciclo, grade... de cada planejamento) como uma
   linha própria na tabela profile_sections, cada uma com sua revisão.
   Nesta fase a LEITURA continua vindo do blob — nada muda no seu dia a dia. Isto
   só POPULA a tabela nova em paralelo, sem risco. Assim dá para verificar no
   Supabase que as seções estão sendo escritas antes de trocar a leitura (Fase 2).
   Cada chave do localStorage do perfil (ex.: "p:pl_inicial:entries") vira uma
   seção. O histórico de versões e a bookkeeping interna ficam de fora.
   ============================================================ */
const SectionSync = {
  TABLE: 'profile_sections',
  enabled: true,            // escrita por seção ligada
  // ── FASE 2: LEITURA POR SEÇÃO ───────────────────────────────────────────
  // Quando ligada, ENTRAR num perfil e BAIXAR atualizações passa a ler a tabela
  // profile_sections (uma linha por seção) em vez do blob de study_profiles.
  // O blob CONTINUA sendo escrito como rede de segurança e é usado como PLANO B
  // automático sempre que a leitura por seção não passar na verificação.
  // Desligar em tempo real: SectionSync.setReadMode(false)
  READ_FLAG_KEY: 'diario-estudos:secread',
  LAST_READ_KEY: 'diario-estudos:secread-last',  // fora do prefixo do perfil de propósito:
                                                 // dentro, viraria uma "seção" e se auto-sincronizaria
  MANIFEST: '__manifest',   // linha especial que lista quais seções existem (trata exclusões)
  FORMAT: 2,                // v2: preserva fielmente o texto bruto do localStorage
  _lastHydrate: null,       // diagnóstico da última leitura por seção (em memória)
  // A entrada no perfil recarrega a página logo após ler; sem gravar, o diagnóstico
  // se perdia no reload e status() mostrava sempre "últimaLeitura: null".
  _saveLast(res) {
    this._lastHydrate = res;
    try { localStorage.setItem(this.LAST_READ_KEY, JSON.stringify(res)); } catch (_) { _quiet(_); }
    return res;
  },
  lastRead() {
    if (this._lastHydrate) return this._lastHydrate;
    try { return JSON.parse(localStorage.getItem(this.LAST_READ_KEY)) || null; } catch (_) { return null; }
  },
  get readEnabled() {
    try { const v = localStorage.getItem(this.READ_FLAG_KEY); return v === null ? true : v === '1'; }
    catch (_) { return true; }
  },
  setReadMode(on) {
    try { localStorage.setItem(this.READ_FLAG_KEY, on ? '1' : '0'); } catch (_) { _quiet(_); }
    console.info('[SectionSync] leitura por seção', on ? 'LIGADA (Fase 2)' : 'DESLIGADA (volta ao blob)');
    return this.readEnabled;
  },
  /* Outbox EM MEMÓRIA também é isolada por perfil. Antes "_dirty" era um Set
     global de nomes como "entries"/"tracks": se o perfil mudasse enquanto um
     request estava em voo, duas seções homônimas podiam compartilhar a mesma
     marca. Os getters _dirty/_dirtyGen preservam a API antiga para o perfil
     ativo, enquanto as rotinas assíncronas recebem o id capturado explicitamente. */
  _dirtySets: new Map(),
  _dirtyGenMaps: new Map(),
  _orphanDirty: new Set(),
  _orphanDirtyGen: new Map(),
  _activeProfileId() {
    try {
      if (window.ProfileManager && ProfileManager.getActiveProfileId) return ProfileManager.getActiveProfileId() || null;
      return localStorage.getItem('diario-estudos:active-profile') || null;
    } catch (_) { return null; }
  },
  _dirtyFor(id) {
    const pid = id || this._activeProfileId();
    if (!pid) return this._orphanDirty;
    if (!this._dirtySets.has(pid)) this._dirtySets.set(pid, new Set());
    return this._dirtySets.get(pid);
  },
  _dirtyGenFor(id) {
    const pid = id || this._activeProfileId();
    if (!pid) return this._orphanDirtyGen;
    if (!this._dirtyGenMaps.has(pid)) this._dirtyGenMaps.set(pid, new Map());
    return this._dirtyGenMaps.get(pid);
  },
  get _dirty() { return this._dirtyFor(); },
  get _dirtyGen() { return this._dirtyGenFor(); },
  _genSeq: 0,
  _lastConflict: null,
  _pushing: false,
  _seededProfile: null,     // id do perfil já "semeado" nesta sessão (envio inicial completo)
  _lastError: null,         // último erro de envio (para diagnóstico)
  _lastPushAt: null,        // quando o último envio bem-sucedido ocorreu
  _pushedCount: 0,          // total de seções enviadas com sucesso nesta sessão
  _restoredFor: null,       // perfil cuja caixa de saída já foi recuperada nesta carga
  // FASE 1.5 — leitura-sombra: baixa e compara, mas NUNCA aplica no localStorage.
  _shadowRunning: false,
  _shadowLastAt: null,
  _shadowLastError: null,
  _shadowReport: null,

  _prefix() { try { return DB._profilePrefix(); } catch (_) { return 'diario-estudos:'; } },
  // Prefixo de um perfil QUALQUER (não só o ativo). Necessário porque ao ENTRAR
  // num perfil a leitura acontece antes de ele virar o ativo: sem isto, a checagem
  // de pendências olharia para o namespace do perfil anterior.
  _prefixFor(id) { return id ? ('diario-estudos:u:' + id + ':') : this._prefix(); },
  _revKey(id) { return this._prefixFor(id) + '__secrev'; },
  // Estrutura salva: { section: { rev, hash } } — o hash evita reenviar conteúdo idêntico
  // (antes, cada sessão re-subia tudo e inflava o rev). Migração automática do formato antigo.
  _getRevs(id) {
    try {
      const v = JSON.parse(localStorage.getItem(this._revKey(id))) || {};
      for (const k in v) { if (typeof v[k] === 'number') v[k] = { rev: v[k], hash: null }; } // formato antigo → novo
      return v;
    } catch (_) { return {}; }
  },
  _saveRevs(r, id) { try { localStorage.setItem(this._revKey(id), JSON.stringify(r)); } catch (_) { _quiet(_); } },

  /* ── CAIXA DE SAÍDA DURÁVEL ───────────────────────────────────────────────
     _dirty morava só na memória. Um recarregamento, o fechamento do app, uma
     queda de rede ou uma sessão assumida por outro aparelho levavam a lista
     embora — e a alteração ficava presa NESTE navegador, sem ninguém para
     reenviá-la. Pior: na abertura seguinte a leitura da nuvem sobrescrevia o
     local, e a alteração sumia também daqui. Era assim que "marquei duas
     disciplinas como concluídas" desaparecia no dia seguinte.

     Agora a lista das seções não enviadas também é GRAVADA. Enquanto uma seção
     estiver nela, ela é tratada como não sincronizada: volta para a fila sozinha
     na próxima abertura e NUNCA é sobrescrita por um download. */
  PEND: '__secpend',
  _pendKey(id) { return this._prefixFor(id) + this.PEND; },
  _loadPend(id) {
    try { const a = JSON.parse(localStorage.getItem(this._pendKey(id))); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
  },
  // Espelha _dirty no armazenamento. Chamado a cada marcação e a cada envio.
  _savePend(id, listaOverride) {
    try {
      const lista = listaOverride ? [...new Set(listaOverride)] : [...this._dirtyFor(id)];
      if (lista.length) localStorage.setItem(this._pendKey(id), JSON.stringify(lista));
      else localStorage.removeItem(this._pendKey(id));
    } catch (_) { _quiet(_); }
  },
  _touchDirty(sec, id) {
    if (!sec) return 0;
    const dirty = this._dirtyFor(id), gens = this._dirtyGenFor(id);
    const g = ++this._genSeq;
    dirty.add(sec);
    gens.set(sec, g);
    return g;
  },
  _ensureDirty(sec, id) {
    if (!sec) return 0;
    const dirty = this._dirtyFor(id), gens = this._dirtyGenFor(id);
    if (!dirty.has(sec)) dirty.add(sec);
    if (!gens.has(sec)) gens.set(sec, ++this._genSeq);
    return gens.get(sec) || 0;
  },
  _clearDirtyIfGeneration(sec, gen, id) {
    const dirty = this._dirtyFor(id), gens = this._dirtyGenFor(id);
    if ((gens.get(sec) || 0) !== (gen || 0)) return false;
    dirty.delete(sec);
    gens.delete(sec);
    return true;
  },
  _ackSent(sec, gen, sentHash, prefix, id) {
    const atual = localStorage.getItem((prefix || this._prefixFor(id)) + sec);
    const gens = this._dirtyGenFor(id);
    /* Mesmo que algum código tenha escrito direto no armazenamento e esquecido
       de chamar markDirty(), o hash impede a confirmação antiga de limpar a fila. */
    if (atual !== null && this._hash(atual) !== sentHash) {
      if ((gens.get(sec) || 0) === (gen || 0)) this._touchDirty(sec, id);
      return false;
    }
    return this._clearDirtyIfGeneration(sec, gen, id);
  },
  // Recarrega a caixa de saída gravada para a memória (na abertura do app).
  restorePending(id) {
    const dirty = this._dirtyFor(id);
    const antes = dirty.size;
    this._loadPend(id).forEach(s => this._ensureDirty(s, id));
    const novas = dirty.size - antes;
    if (novas) console.info('[SectionSync] ' + novas + ' alteração(ões) recuperada(s) da caixa de saída');
    return novas;
  },
  captureExplicitSnapshot(id) {
    const alvo = id || this._activeProfileId();
    if (!alvo) return [];
    this.restorePending(alvo);
    const dirty = this._dirtyFor(alvo), gens = this._dirtyGenFor(alvo);
    return [...dirty].map(sec => {
      const gen = gens.get(sec) || this._ensureDirty(sec, alvo);
      return { section: sec, gen };
    });
  },
  /* Tudo que ainda não foi confirmado na nuvem para um perfil. Soma duas fontes:
       1. a caixa de saída gravada (o que sabemos que ficou por enviar);
       2. o CONTEÚDO real — se o texto de uma seção não bate com o hash do último
          envio, ela mudou aqui depois disso, mesmo que a lista tenha se perdido.
     Seções sem envio anterior registrado ficam de fora: não dá para saber se são
     novidade local ou sobra de uma versão antiga, e a semeadura normal cuida delas. */
  pendingSections(id) {
    const alvo = id || this._activeProfileId();
    const out = new Set();
    this._dirtyFor(alvo).forEach(s => out.add(s));
    this._loadPend(id).forEach(s => out.add(s));
    this._loadDel(id).forEach(x => { if (x && x.section) out.add(x.section); });
    const revs = this._getRevs(id), pfx = this._prefixFor(id);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        const sec = this.sectionForKey(full, pfx);
        if (!sec || !revs[sec] || !revs[sec].hash) continue;
        if (revs[sec].hash !== this._hash(localStorage.getItem(full) || '')) out.add(sec);
      }
    } catch (_) { _quiet(_); }
    return [...out];
  },
  /* Pendência EXPLÍCITA = alteração que passou pelo canal normal de escrita e
     ficou registrada na caixa de saída. Diferente de pendingSections(), este
     método NÃO infere "mudou localmente" só porque o hash do conteúdo divergiu
     da última revisão anotada.

     Essa distinção é crítica logo depois de uma ATUALIZAÇÃO DO APP: o IndexedDB
     pode ter restaurado um valor antigo enquanto __secrev já contém a revisão
     mais nova. Tratar essa divergência de cache como edição do usuário faria o
     aparelho subir o valor velho por cima da cópia correta da nuvem. */
  explicitPendingSections(id) {
    const alvo = id || this._activeProfileId();
    const out = new Set();
    this._dirtyFor(alvo).forEach(s => out.add(s));
    this._loadPend(id).forEach(s => out.add(s));
    this._loadDel(id).forEach(x => { if (x && x.section) out.add(x.section); });
    return [...out];
  },
  hasLocalPending(id) { return this.pendingSections(id).length > 0; },
  /* Contagem BARATA, sem varrer nem re-hashear o conteúdo: é a que alimenta o
     indicador na tela, chamado a cada foco e a cada 30 s. A checagem completa
     (pendingSections) fica para os momentos em que ela é decisiva — antes de um
     download sobrescrever o local. */
  pendingQuick(id) {
    const alvo = id || this._activeProfileId();
    const out = new Set(this._dirtyFor(alvo));
    this._loadPend(alvo).forEach(s => out.add(s));
    this._loadDel(alvo).forEach(x => { if (x && x.section) out.add(x.section); });
    return out.size;
  },

  /* ── JOURNAL DE MUTAÇÕES DO DIÁRIO ───────────────────────────────────────
     A seção `entries` é um array inteiro. CAS protege contra sobrescrita cega,
     mas dois aparelhos que editam o array em revisões diferentes precisam de uma
     forma de combinar intenções. Guardamos as mutações por ID neste aparelho:
     add/update = upsert do registro; delete = remoção daquele ID. Em conflito,
     baixamos a versão remota mais nova, reaplicamos SOMENTE essas operações e
     tentamos CAS outra vez. Assim uma exclusão no celular não apaga um registro
     novo criado no PC — e também não fica eternamente presa no spinner vermelho. */
  ENTRY_OPS: '__entryops',
  _entryOpsKey(id) { return this._prefixFor(id) + this.ENTRY_OPS; },
  _isEntriesSection(sec) { return !!sec && /(^|:)entries$/.test(String(sec)); },
  _loadEntryOps(id) {
    try {
      const v = JSON.parse(localStorage.getItem(this._entryOpsKey(id))) || {};
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (_) { return {}; }
  },
  _saveEntryOps(v, id) {
    try {
      const limpo = {};
      Object.keys(v || {}).forEach(sec => {
        const a = Array.isArray(v[sec]) ? v[sec].filter(x => x && x.id != null && (x.type === 'delete' || x.type === 'upsert')) : [];
        if (a.length) limpo[sec] = a;
      });
      if (Object.keys(limpo).length) localStorage.setItem(this._entryOpsKey(id), JSON.stringify(limpo));
      else localStorage.removeItem(this._entryOpsKey(id));
    } catch (e) { _quiet(e, 'entryops-gravar'); }
  },
  recordEntryMutation(fullKey, op) {
    if (!this.enabled || !op || op.id == null) return;
    const id = this._profileIdFromKey(fullKey);
    const sec = this.sectionForKey(fullKey, this._prefixFor(id));
    if (!id || !this._isEntriesSection(sec)) return;
    const all = this._loadEntryOps(id);
    const list = Array.isArray(all[sec]) ? all[sec] : [];
    const sid = String(op.id);
    const gen = this._dirtyGenFor(id).get(sec) || this._ensureDirty(sec, id);
    // Uma intenção mais nova para o mesmo ID substitui a anterior. Se criou e
    // apagou antes de sincronizar, o resultado final é delete — idempotente.
    const next = list.filter(x => String(x.id) !== sid);
    if (op.type === 'delete') next.push({ type: 'delete', id: sid, gen });
    else if (op.type === 'upsert' && op.entry) {
      let entry = op.entry;
      try { entry = JSON.parse(JSON.stringify(op.entry)); } catch (_) { _quiet(_); }
      next.push({ type: 'upsert', id: sid, entry, gen });
    } else return;
    all[sec] = next;
    this._saveEntryOps(all, id);
  },
  _entryOpsFor(id, sec, maxGen) {
    const all = this._loadEntryOps(id);
    const a = Array.isArray(all[sec]) ? all[sec] : [];
    return a.filter(x => maxGen == null || (Number(x.gen) || 0) <= Number(maxGen));
  },
  _ackEntryOps(id, sec, maxGen) {
    const all = this._loadEntryOps(id);
    const a = Array.isArray(all[sec]) ? all[sec] : [];
    if (!a.length) return [];
    const restantes = a.filter(x => (Number(x.gen) || 0) > Number(maxGen || 0));
    if (restantes.length) all[sec] = restantes;
    else delete all[sec];
    this._saveEntryOps(all, id);
    return restantes;
  },
  _applyEntryOps(raw, ops) {
    let out;
    try { out = JSON.parse(raw); } catch (_) { return null; }
    if (!Array.isArray(out)) return null;
    out = out.slice();
    (ops || []).forEach(op => {
      const sid = String(op.id);
      const idx = out.findIndex(e => e && String(e.id) === sid);
      if (op.type === 'delete') {
        if (idx >= 0) out.splice(idx, 1);
      } else if (op.type === 'upsert' && op.entry) {
        const entry = op.entry;
        if (idx >= 0) out[idx] = entry;
        else out.push(entry);
      }
    });
    try { return JSON.stringify(out); } catch (_) { return null; }
  },
  async _resolveEntriesConflict(id, sec, remotoInicial, gen) {
    const ops = this._entryOpsFor(id, sec, gen);
    if (!ops.length) return null; // conflito legado/sem intenção registrada: não adivinha
    let remoto = remotoInicial;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      if (!remoto) return null;
      const remotoRaw = this._decode(remoto.data);
      if (remotoRaw == null) return null;
      const mergedRaw = this._applyEntryOps(remotoRaw, ops);
      if (mergedRaw == null) return null;
      const mergedHash = this._hash(mergedRaw);
      const remoteHash = remoto.content_hash == null ? this._hash(remotoRaw) : String(remoto.content_hash);
      if (mergedHash === remoteHash) {
        const restantes = this._ackEntryOps(id, sec, gen);
        const finalRaw = restantes.length ? this._applyEntryOps(mergedRaw, restantes) : mergedRaw;
        if (finalRaw != null) localStorage.setItem(this._prefixFor(id) + sec, finalRaw);
        if (!restantes.length) this._clearDirtyIfGeneration(sec, gen, id);
        return { ok: true, rev: remoto.rev || 1, hash: mergedHash, raw: mergedRaw, len: mergedRaw.length, already: true };
      }
      const wr = await this._writeSectionCAS(
        {
          profile_id: id, section: sec, data: this._encode(mergedRaw),
          rev: (Number(remoto.rev) || 0) + 1, updated_at: new Date().toISOString(),
          _contentHash: mergedHash
        },
        Number(remoto.rev) || 0,
        remoto.content_hash == null ? null : String(remoto.content_hash),
        this._mutationId(sec, mergedHash)
      );
      if (wr.ok) {
        const restantes = this._ackEntryOps(id, sec, gen);
        /* Rebase local: primeiro a versão remota+operações confirmadas; depois
           reaplica alterações que aconteceram neste aparelho enquanto o request
           estava em voo. Nenhuma edição nova some por causa da reconciliação. */
        const finalRaw = restantes.length ? this._applyEntryOps(mergedRaw, restantes) : mergedRaw;
        if (finalRaw != null) localStorage.setItem(this._prefixFor(id) + sec, finalRaw);
        if (!restantes.length) this._clearDirtyIfGeneration(sec, gen, id);
        else this._ensureDirty(sec, id);
        this._savePend(id);
        return { ok: true, rev: wr.rev || ((Number(remoto.rev) || 0) + 1), hash: mergedHash, raw: mergedRaw, len: mergedRaw.length };
      }
      if (!wr.conflict) return null;
      remoto = await this._remoteSection(id, sec); // outro aparelho avançou de novo: rebaseia e tenta novamente
    }
    return null;
  },

  /* PROVA PARA O FAST PATH LOCAL.
     Um perfil só pode ser exibido sem hidratar a nuvem quando:
       1) não há mutação explícita ainda pendente; e
       2) cada seção já rastreada continua byte-a-byte com o hash que acompanha
          a revisão conhecida.
     Isso fecha o caso "metadata nova + conteúdo físico antigo": o rev pode estar
     em 12, mas se entries ainda contém uma versão velha o hash denuncia a
     regressão e o gate força uma hidratação canônica antes de mostrar o perfil. */
  fastPathIntegrity(id) {
    const alvo = id || this._activeProfileId();
    if (!alvo) return { ok: false, reason: 'sem-perfil', checked: 0, mismatches: [] };
    const explicitas = this.explicitPendingSections(alvo);
    if (explicitas.length) {
      return { ok: false, reason: 'pendencia-explicita', checked: 0, mismatches: explicitas.slice() };
    }
    const revs = this._getRevs(alvo);
    const pfx = this._prefixFor(alvo);
    let checked = 0;
    const mismatches = [];
    Object.keys(revs || {}).forEach(sec => {
      if (sec === '__manifest') return;
      const meta = revs[sec];
      if (!meta || !meta.hash) return;
      checked++;
      let raw = null;
      try { raw = localStorage.getItem(pfx + sec); } catch (_) { raw = null; }
      if (raw === null || this._hash(raw) !== meta.hash) mismatches.push(sec);
    });
    if (!checked) return { ok: false, reason: 'sem-prova-local', checked: 0, mismatches: [] };
    if (mismatches.length) return { ok: false, reason: 'hash-divergente', checked, mismatches };
    return { ok: true, reason: '', checked, mismatches: [] };
  },
  /* Tenta ENTREGAR o que está pendente antes de qualquer download sobrescrever o
     local. Devolve o que CONTINUA pendente depois da tentativa — quem chamou usa
     essa lista para preservar essas seções em vez de apagá-las. */
  async flushBeforeRead(id, opts) {
    opts = opts || {};
    /* No fluxo normal, a comparação por hash é uma segunda rede de segurança:
       se a lista __secpend se perder, uma edição local ainda é reencontrada.
       Já na PRIMEIRA RECONCILIAÇÃO DE UMA NOVA VERSÃO usamos explicitOnly:
       divergência de hash sem fila explícita pode ser cache local regressado,
       não uma edição. Nesse caso a cópia local é fotografada antes da aplicação
       e a nuvem confirmada vence, em vez de o cache velho ser publicado. */
    const listar = () => opts.explicitOnly ? this.explicitPendingSections(id) : this.pendingSections(id);
    const pend = listar();
    if (!pend.length) return [];
    const ativo = (window.ProfileManager ? ProfileManager.getActiveProfileId() : null);
    if (id && id !== ativo) return pend;   // outro perfil: não há como enviar daqui agora
    pend.forEach(s => this._ensureDirty(s, id));
    this._savePend(id);
    try { await this.pushDirty(); } catch (e) { console.warn('[SectionSync] envio antes da leitura falhou', e); }
    const resta = listar();
    if (resta.length) console.warn('[SectionSync] preservando ' + resta.length + ' seção(ões) não enviada(s):', resta.join(', '));
    return resta;
  },

  // ── CODEC v2 ──────────────────────────────────────────────────────────────
  // O localStorage guarda TEXTO. Se gravarmos no JSONB só o objeto já parseado,
  // valores que não voltam idênticos (strings cruas como "default", números com
  // formatação própria, JSON com ordem numérica de chaves) voltariam corrompidos
  // na leitura. Por isso: só guardamos o objeto quando o ida-e-volta é EXATO;
  // caso contrário guardamos o texto bruto em { __raw__ }. Assim a hidratação
  // reproduz byte a byte o que estava aqui.
  _encode(raw) {
    try { const v = JSON.parse(raw); if (JSON.stringify(v) === raw) return v; } catch (_) { _quiet(_); }
    return { __raw__: String(raw) };
  },
  // Retorna a STRING que deve ir para o localStorage, ou null se a linha for inválida.
  _decode(data) {
    if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.__raw__ === 'string') return data.__raw__;
    if (data === undefined) return null;
    try { const s = JSON.stringify(data); return (s === undefined) ? null : s; } catch (_) { return null; }
  },
  _hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); },
  _deviceId() {
    try {
      if (window.SessionGuard && SessionGuard.deviceId) return SessionGuard.deviceId();
      if (window.DB && DB._uid) return DB._uid();
    } catch (_) { _quiet(_); }
    return 'device-unknown';
  },
  _mutationId(section, hash) {
    let rnd = '';
    try {
      if (window.crypto && crypto.randomUUID) rnd = crypto.randomUUID();
      else if (window.crypto && crypto.getRandomValues) {
        const a = new Uint32Array(3); crypto.getRandomValues(a); rnd = Array.from(a).map(x => x.toString(36)).join('');
      }
    } catch (_) { _quiet(_); }
    if (!rnd) rnd = Date.now().toString(36) + Math.random().toString(36).slice(2);
    return [this._deviceId(), String(section || ''), String(hash || ''), rnd].join(':');
  },

  // Converte uma chave de localStorage na seção correspondente, ou null se não
  // pertence ao perfil ativo / não deve ser sincronizada.
  sectionForKey(fullKey, prefixo) {
    const pfx = prefixo || this._prefix();
    if (!fullKey || fullKey.indexOf(pfx) !== 0) return null;
    const sub = fullKey.slice(pfx.length);
    if (!sub) return null;
    if (sub.indexOf('__secrev') === 0) return null; // bookkeeping desta camada
    if (sub.indexOf(this.PEND) === 0) return null;   // caixa de saída: também é local
    if (sub.indexOf('vhist') === 0) return null;     // histórico de versões é local
    if (sub.indexOf(Lixeira.PREFIXO) === 0) return null; // lixeira: rede local, não é dado do perfil
    if (sub.indexOf(this.DEL) === 0) return null;    // registro de exclusões: contabilidade local
    if (sub.indexOf(this.ENTRY_OPS) === 0) return null; // journal de mutações do diário: somente local
    return sub;
  },
  _profileIdFromKey(fullKey) {
    const m = /^diario-estudos:u:([^:]+):/.exec(String(fullKey || ''));
    return m ? m[1] : this._activeProfileId();
  },
  markDirty(fullKey) {
    if (!this.enabled) return;
    const id = this._profileIdFromKey(fullKey);
    const sec = this.sectionForKey(fullKey, this._prefixFor(id));
    if (sec) { this._touchDirty(sec, id); this._savePend(id); }
  },
  /* ── EXCLUSÕES DELIBERADAS ────────────────────────────────────────────────
     A nuvem só pode esquecer o que VOCÊ mandou esquecer. Antes, o manifesto era
     a lista do que existia neste aparelho AGORA — então qualquer sumiço local
     (um bug, um download que apagou demais, uma cota estourada no meio de uma
     gravação) era publicado como "excluído" e apagava as linhas na nuvem: a
     última cópia do dado ia embora atrás da primeira.

     Agora exclusão é um FATO REGISTRADO, não uma dedução por ausência. Só o que
     passa por aqui — o caminho de DB.delRaw, isto é, uma remoção que o app
     realmente pediu — entra nesta lista durável e pode apagar a linha remota.
     Sumiço não registrado é tratado como acidente: a seção continua no
     manifesto e volta para o aparelho na próxima leitura.

     O preço é conhecido e aceito: se você apagar algo no aparelho A enquanto o
     aparelho B ainda tem a seção, B a devolve. Dado voltando é um aborrecimento;
     dado sumindo é o trabalho de meses de alguém. */
  DEL: '__secdel',
  _delKey(id) { return this._prefixFor(id) + this.DEL; },
  _loadDel(id) {
    try {
      const a = JSON.parse(localStorage.getItem(this._delKey(id)));
      if (!Array.isArray(a)) return [];
      /* Compatibilidade com o formato antigo ["sec"]. O formato novo preserva
         a revisão-base da exclusão para que DELETE também seja CAS. */
      return a.map(x => typeof x === 'string'
        ? { section: x, rev: null }
        : (x && x.section ? { section: x.section, rev: Number(x.rev) || null } : null)
      ).filter(Boolean);
    } catch (_) { return []; }
  },
  _saveDel(lista, id) {
    try {
      const porSec = new Map();
      (lista || []).forEach(x => {
        const it = typeof x === 'string' ? { section: x, rev: null } : x;
        if (it && it.section) porSec.set(it.section, { section: it.section, rev: Number(it.rev) || null });
      });
      const out = [...porSec.values()];
      if (out.length) localStorage.setItem(this._delKey(id), JSON.stringify(out));
      else localStorage.removeItem(this._delKey(id));
    } catch (e) { _quiet(e, 'secdel-gravar'); }
  },
  /* Uma chave APAGADA não vira linha suja (subiria vazia em vez de sumir): sai da
     fila, entra no registro de exclusões e some da nuvem no próximo envio. */
  dropSection(fullKey) {
    if (!this.enabled) return;
    const id = this._profileIdFromKey(fullKey);
    const sec = this.sectionForKey(fullKey, this._prefixFor(id));
    if (!sec) return;
    this._dirtyFor(id).delete(sec);
    this._dirtyGenFor(id).delete(sec);
    this._savePend(id);
    const revs = this._getRevs(id);
    const baseRev = revs[sec] ? (revs[sec].rev || 0) : 0;
    if (revs[sec]) { delete revs[sec]; this._saveRevs(revs, id); }
    const del = this._loadDel(id);
    del.push({ section: sec, rev: baseRev || null });
    this._saveDel(del, id);
  },
  // Marca as seções do perfil que REALMENTE MUDARAM (hash diferente do último envio).
  // Mantido para ações EXPLÍCITAS de recuperação/reenviar tudo. Não é seguro
  // usar esta heurística automaticamente no startup: conteúdo físico antigo +
  // __secrev novo é indistinguível de uma edição se olharmos apenas o hash.
  markAllDirty(id) {
    const alvo = id || this._activeProfileId();
    const pfx = this._prefixFor(alvo);
    const revs = this._getRevs(alvo);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        const sec = this.sectionForKey(full, pfx);
        if (!sec) continue;
        const raw = localStorage.getItem(full) || '';
        const h = this._hash(raw);
        if (!revs[sec] || revs[sec].hash !== h) this._ensureDirty(sec, alvo);
      }
    } catch (_) { _quiet(_); }
    this._savePend(alvo);
  },
  /* Startup conservador: só semeia seção que NUNCA teve revisão conhecida.
     Se já existe __secrev, divergência de hash NÃO vira edição automaticamente.
     Alterações reais feitas pelo usuário passam por DB._set/setRaw/delRaw e
     entram na outbox pelo hook no mesmo instante. Assim cache regressado nunca
     ganha autoridade só porque o navegador foi reaberto. */
  seedUntrackedOnly(id) {
    const alvo = id || this._activeProfileId();
    const pfx = this._prefixFor(alvo);
    const revs = this._getRevs(alvo);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        const sec = this.sectionForKey(full, pfx);
        if (!sec || revs[sec]) continue;
        this._ensureDirty(sec, alvo);
      }
    } catch (_) { _quiet(_); }
    this._savePend(alvo);
  },
  seedOnce() {
    const id = ProfileManager.getActiveProfileId();
    if (!id || this._seededProfile === id) return;
    this._seededProfile = id;
    this.seedUntrackedOnly(id);
  },
  /* ── O QUE FAZER COM UMA SEÇÃO SUJA (decisão pura, testável) ──────────────
     Recebe o texto local e o que sabemos do último envio; devolve a ação. Está
     separada do envio de propósito: é a regra que impede a perda, e uma regra
     que impede perda tem de ser exercitada pela suíte de autoteste, não só
     lida no código.

       'sumida'    — a chave não existe mais aqui, e NINGUÉM mandou apagá-la.
                     Antes, o `|| ''` transformava isso em "o conteúdo agora é
                     vazio" e publicava o vazio por cima da linha boa na nuvem:
                     um sumiço local (cota estourada no meio de uma gravação,
                     limpeza do navegador pela metade, corrida entre marcar e
                     apagar) destruía a última cópia que existia. Agora a seção
                     só sai da fila; nada sobe, e o próximo download a traz de
                     volta para cá. Uma exclusão DE VERDADE não passa por aqui:
                     passa por dropSection e viaja pelo manifesto.
       'idêntico'  — mesmo conteúdo do último envio; não gasta rede nem rev.
       'enviar'    — sobe. `esvaziando` marca o caso em que um conteúdo que
                     comprovadamente existia na nuvem está indo embora: é
                     legítimo, mas o estado anterior é fotografado antes.
     `len` só existe para seções enviadas depois desta versão; sem ele não dá
     para provar que havia conteúdo, e a proteção não dispara (não inventamos
     um passado que não conhecemos). */
  decidirEnvio(raw, prev) {
    if (raw === null || raw === undefined) return { acao: 'sumida' };
    const hash = this._hash(raw);
    const p = prev || { rev: 0, hash: null };
    if (p.hash === hash) return { acao: 'idêntico', hash };
    return {
      acao: 'enviar',
      hash,
      rev: (p.rev || 0) + 1,
      esvaziando: !!(valorVazio(raw) && p.hash && (p.len || 0) > 40)
    };
  },

  _uniqueViolation(err) {
    const c = ((err && (err.code || err.message || err.details)) || '').toString().toLowerCase();
    return c.indexOf('23505') >= 0 || c.indexOf('duplicate key') >= 0;
  },
  async _remoteSection(profileId, section) {
    const { data, error } = await CloudStore.client.from(this.TABLE)
      .select('section,data,rev,updated_at,content_hash,mutation_id,device_id')
      .eq('profile_id', profileId).eq('section', section).maybeSingle();
    if (error) throw error;
    return data || null;
  },
  /* Compare-and-swap V2: a decisão atômica mora no PostgreSQL. Além da revisão,
     o servidor valida o hash-base (quando já conhecido) e grava uma prova única
     da mutação. Clientes atrasados nunca recebem permissão para "alinhar a rev"
     e sobrescrever o estado vencedor. */
  async _writeSectionCAS(row, expectedRev, expectedHash, mutationId) {
    const newHash = row && row._contentHash
      ? row._contentHash
      : this._hash(this._decode(row.data) || '');
    const mid = mutationId || this._mutationId(row.section, newHash);
    const { data, error } = await CloudStore.client.rpc('write_profile_section_cas', {
      p_profile_id: row.profile_id,
      p_section: row.section,
      p_data: row.data,
      p_expected_rev: Number(expectedRev) || 0,
      p_expected_hash: expectedHash == null ? null : String(expectedHash),
      p_new_hash: newHash,
      p_mutation_id: mid,
      p_device_id: this._deviceId()
    });
    if (error) throw error;
    const r = (data && typeof data === 'object') ? data : {};
    if (r.ok) return { ok: true, rev: Number(r.rev) || row.rev, content_hash: r.content_hash || newHash, mutation_id: mid };
    return {
      ok: false,
      conflict: !!r.conflict,
      reason: r.reason || 'cas-recusado',
      remoteRev: r.remote_rev == null ? null : Number(r.remote_rev),
      remoteHash: r.remote_hash == null ? null : String(r.remote_hash)
    };
  },
  // Envia as seções sujas para profile_sections com controle otimista por revisão.
  async pushDirty(id, opts) {
    opts = opts || {};
    if (!this.enabled || this._pushing) return;
    if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return;
    if (!opts.allowBlocked) {
      if (window.SessionGuard && SessionGuard.enabled && SessionGuard.canEnterNow && !SessionGuard.canEnterNow()) return;
      if ((window.SessionGuard && SessionGuard.isBlockedByRemote && SessionGuard.isBlockedByRemote()) ||
          (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote')) return;
    }
    id = id || this._activeProfileId();
    if (!id) return;
    this._pushing = true;
    this._pushingProfile = id;
    try { await this._enviarSujas(id, opts); }
    finally { this._pushing = false; this._pushingProfile = null; }
  },
  async _enviarSujas(id, opts) {
    opts = opts || {};
    /* A operação inteira fica vinculada ao perfil capturado em pushDirty().
       Nunca voltamos a consultar "perfil ativo" no meio de uma requisição. */
    const pfx = this._prefixFor(id);
    const revs = this._getRevs(id);
    this._lastConflict = null;
    // Monta as linhas com hash de conteúdo. Só bumpa o rev quando o conteúdo mudou
    // de verdade (evita inflar o rev quando a semeadura reencontra dados idênticos).
    const dirty = this._dirtyFor(id), gens = this._dirtyGenFor(id);
    const snap = Array.isArray(opts.snapshot) ? new Map(opts.snapshot.map(x => [x.section, x.gen])) : null;
    const secs = snap
      ? [...snap.keys()].filter(sec => dirty.has(sec) && (gens.get(sec) || 0) === (snap.get(sec) || 0))
      : [...dirty];
    const rows = [];
    const sumidas = [], esvaziando = [];
    secs.forEach(sec => {
      const gen = snap ? (snap.get(sec) || 0) : (gens.get(sec) || this._ensureDirty(sec, id));
      if (snap && (gens.get(sec) || 0) !== gen) return;
      const raw = localStorage.getItem(pfx + sec);
      const d = this.decidirEnvio(raw, revs[sec]);
      if (d.acao === 'sumida') { this._clearDirtyIfGeneration(sec, gen, id); sumidas.push(sec); return; }
      if (d.acao === 'idêntico') { this._clearDirtyIfGeneration(sec, gen, id); return; }
      if (d.esvaziando) esvaziando.push(sec);
      rows.push({
        _sec: sec, _hash: d.hash, _len: raw.length, _gen: gen,
        _expectedRev: (revs[sec] && revs[sec].rev) || 0,
        _expectedHash: (revs[sec] && revs[sec].hash) || null,
        _mutationId: this._mutationId(sec, d.hash),
        profile_id: id, section: sec, data: this._encode(raw), rev: d.rev,
        updated_at: new Date().toISOString(), _contentHash: d.hash
      });
    });
    if (sumidas.length) {
      this._savePend(id);
      console.warn('[SectionSync] ' + sumidas.length + ' seção(ões) sumiram deste aparelho sem ordem de exclusão — NADA foi publicado por cima da nuvem: ' + sumidas.join(', '));
    }
    if (esvaziando.length) {
      try { if (window.GuardaNuvem) await GuardaNuvem.antesDeEsvaziar(id, esvaziando); } catch (e) { _quiet(e, 'guarda-esvaziar'); }
    }
    if (rows.length === 0) {
      // No handoff enviamos SOMENTE o snapshot capturado; manifesto/tombstones
      // ficam para a sessão que detém a interface.
      if (opts.skipManifest) {
        this._saveRevs(revs, id);
        this._savePend(id);
        return;
      }
      try {
        await this._syncManifest(id, revs);
        this._lastError = null;
      } catch (e) {
        const msg = (e && (e.message || e.code || JSON.stringify(e))) || 'erro';
        this._lastError = this.MANIFEST + ' (' + msg + ')';
        console.warn('[SectionSync] manifesto/exclusões continuam pendentes:', this._lastError);
      }
      this._saveRevs(revs, id);
      this._savePend(id);
      return;
    }
    // Envio UMA SEÇÃO POR VEZ: assim uma seção grande (ex.: incidência, ~300 KB) fica
    // ISOLADA — se ela falhar (tamanho/timeout), não derruba as outras, o erro dela é
    // registrado individualmente, e ela reenvia sozinha na próxima rodada. Mais lento,
    // porém à prova de "seção presa" (era o caso da incidencia travada no rev 1).
    let okCount = 0; const falhas = []; const conflitos = [];
    for (const r of rows) {
      const { _sec, _hash, _len, _gen, _expectedRev, _expectedHash, _mutationId, ...row } = r;
      try {
        const wr = await this._writeSectionCAS(row, _expectedRev, _expectedHash, _mutationId);
        if (!wr.ok && wr.conflict) {
          /* Pode ser um conflito real OU a mesma gravação já confirmada por outra
             tentativa. Só adotamos a revisão remota automaticamente quando o
             CONTEÚDO remoto é exatamente o snapshot que tentávamos enviar. */
          const remoto = await this._remoteSection(id, _sec);
          const remotoRaw = remoto ? this._decode(remoto.data) : null;
          const remotoHash = remotoRaw === null ? null : this._hash(remotoRaw);
          if (remoto && remotoHash === _hash) {
            revs[_sec] = { rev: remoto.rev || row.rev, hash: _hash, len: _len };
            const ack = this._ackSent(_sec, _gen, _hash, pfx, id);
            if (this._isEntriesSection(_sec)) this._ackEntryOps(id, _sec, _gen);
            /* Se houve edição nova durante o voo, a geração mudou e a seção fica
               suja; agora ela já parte da revisão remota confirmada. */
            okCount++;
            continue;
          }
          /* Para o Diário, conflito não é sentença final: temos um journal por ID.
             Rebaseamos delete/upsert sobre a cópia remota atual e repetimos CAS.
             Outras seções continuam com a política conservadora de preservar ambos. */
          if (remoto && this._isEntriesSection(_sec)) {
            const merged = await this._resolveEntriesConflict(id, _sec, remoto, _gen);
            if (merged && merged.ok) {
              revs[_sec] = { rev: merged.rev || row.rev, hash: merged.hash, len: merged.len };
              okCount++;
              continue;
            }
          }
          conflitos.push(_sec);
          falhas.push(_sec + ' (conflito de revisão protegido)');
          continue;
        }
        // `len` é a prova de que esta seção JÁ TEVE conteúdo na nuvem.
        revs[_sec] = { rev: wr.rev || row.rev, hash: _hash, len: _len };
        this._ackSent(_sec, _gen, _hash, pfx, id);
        if (this._isEntriesSection(_sec)) this._ackEntryOps(id, _sec, _gen);
        okCount++;
      } catch (e) {
        const msg = (e && (e.message || e.code || JSON.stringify(e))) || 'erro';
        falhas.push(_sec + ' (' + (row.data ? JSON.stringify(row.data).length : 0) + ' bytes): ' + msg);
        // mantém a seção suja para o próximo retry
      }
    }
    if (conflitos.length) {
      this._lastConflict = { em: Date.now(), seções: conflitos.slice() };
      console.warn('[SectionSync] conflito protegido em', conflitos.length, 'seção(ões):', conflitos.join(', '));
    }
    // O MANIFESTO só é atualizado quando TODAS as seções sujas subiram. Se alguma
    // falhou, a nuvem ainda está incompleta — publicar o manifesto agora faria a
    // leitura por seção esperar uma linha que não existe (e cair no plano B à toa).
    if (!falhas.length && !opts.skipManifest) {
      try { await this._syncManifest(id, revs); }
      catch (e) {
        const msg = (e && (e.message || e.code || JSON.stringify(e))) || 'erro';
        falhas.push(this.MANIFEST + ' (' + msg + ')');
      }
    }
    this._saveRevs(revs, id);
    this._savePend(id);   // o que sobrou na fila continua gravado: sobrevive ao fechamento
    if (okCount) { this._lastPushAt = Date.now(); this._pushedCount += okCount; }
    if (falhas.length) {
      this._lastError = falhas.join(' | ');
      console.warn('[SectionSync] falharam', falhas.length, 'de', rows.length + ':', this._lastError);
    } else {
      this._lastError = null;
      console.info('[SectionSync] enviou', okCount, 'seção(ões)');
    }
  },
  // ── MANIFESTO ─────────────────────────────────────────────────────────────
  // Uma linha (section = '__manifest') que diz QUAIS seções o perfil tem agora.
  // É o que torna a leitura por seção segura: sem ele, um upsert nunca apaga nada
  // e uma seção excluída aqui voltaria à vida no próximo download. Com ele, a
  // hidratação usa a lista como verdade e ignora/limpa o que sobrou.
  localSections(id) {
    const out = [];
    const pfx = this._prefixFor(id);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const sec = this.sectionForKey(localStorage.key(i), pfx);
        if (sec) out.push(sec);
      }
    } catch (_) { _quiet(_); }
    return out.sort();
  },
  async _syncManifest(id, revs, tentativa) {
    tentativa = Number(tentativa) || 0;
    const locais = this.localSections(id);
    const delEntries = this._loadDel(id);

    let remoteRows = [];
    try {
      const { data, error } = await CloudStore.client.from(this.TABLE)
        .select('section,rev').eq('profile_id', id);
      if (error) throw error;
      remoteRows = data || [];
    } catch (e) {
      console.warn('[SectionSync] não deu para ler a lista remota; manifesto não será publicado às cegas', e);
      throw e;
    }

    /* O manifesto remoto lido AGORA é a base correta do próximo CAS. Usar a
       revisão anotada de uma sessão anterior pode deixar o manifesto preso para
       sempre após qualquer alteração feita por outro aparelho. Atualizar esta
       contabilidade não aplica dados no perfil; apenas registra a base que acabou
       de ser observada no servidor. */
    const manifestoRemotoLido = remoteRows.find(r => r.section === this.MANIFEST) || null;
    if (manifestoRemotoLido) {
      const secs = manifestoRemotoLido.data && Array.isArray(manifestoRemotoLido.data.sections)
        ? manifestoRemotoLido.data.sections.slice().sort() : null;
      revs[this.MANIFEST] = {
        rev: manifestoRemotoLido.rev || 0,
        hash: secs ? this._hash(secs.join('|')) : null
      };
    }

    /* Primeiro resolvemos as exclusões. O manifesto só é publicado DEPOIS e
       descreve o resultado realmente confirmado no banco. Se a exclusão perdeu
       uma corrida para uma edição mais nova, a linha continua no manifesto. */
    const restantes = [];
    const apagadasComSucesso = new Set();
    for (const del of delEntries) {
      const rr = remoteRows.find(r => r.section === del.section);
      if (!rr) {
        delete revs[del.section];
        continue; // já não existe: tombstone cumprido
      }
      if (!del.rev || rr.rev !== del.rev) {
        restantes.push(del);
        this._lastConflict = { em: Date.now(), seções: [del.section], tipo: 'exclusão' };
        console.warn('[SectionSync] exclusão protegida por conflito:', del.section, 'base', del.rev, 'remota', rr.rev);
        continue;
      }
      try {
        /* DELETE direto foi desabilitado no banco. A exclusão passa por uma RPC
           CAS que valida propriedade + revisão no servidor. Isso protege inclusive
           contra navegadores antigos ainda executando uma versão anterior do app:
           eles podem atualizar o manifesto, mas não conseguem apagar uma linha
           cuja revisão não foi explicitamente confirmada por este protocolo. */
        const { data, error } = await CloudStore.client.rpc('delete_profile_section_cas', {
          p_profile_id: id,
          p_section: del.section,
          p_expected_rev: del.rev
        });
        if (error) throw error;
        if (data !== true) {
          restantes.push(del);
          this._lastConflict = { em: Date.now(), seções: [del.section], tipo: 'exclusão' };
          continue;
        }
        apagadasComSucesso.add(del.section);
        delete revs[del.section];
        console.info('[SectionSync] removida da nuvem por CAS seção excluída de propósito:', del.section);
      } catch (e) {
        restantes.push(del);
        console.warn('[SectionSync] exclusão remota CAS falhou:', del.section, e);
      }
    }
    this._saveDel(restantes, id);

    const remotas = remoteRows
      .map(r => r.section)
      .filter(sec => sec !== this.MANIFEST && !apagadasComSucesso.has(sec));

    /* Toda seção que ainda EXISTE remotamente e não existe aqui permanece no
       manifesto. Isso inclui, deliberadamente, exclusões em conflito. */
    const sobreviventes = remotas.filter(sec => locais.indexOf(sec) === -1);
    if (sobreviventes.length) {
      console.warn('[SectionSync] ' + sobreviventes.length + ' seção(ões) existem na nuvem e não aqui — MANTIDAS no manifesto: ' + sobreviventes.join(', '));
    }

    const list = [...new Set(locais.concat(sobreviventes))].sort();
    const body = { v: this.FORMAT, sections: list, at: new Date().toISOString() };
    const h = this._hash(list.join('|'));
    const prev = revs[this.MANIFEST] || { rev: 0, hash: null };

    if (prev.hash !== h) {
      const rev = (prev.rev || 0) + 1;
      const wr = await this._writeSectionCAS(
        { profile_id: id, section: this.MANIFEST, data: body, rev, updated_at: body.at, _contentHash: h },
        prev.rev || 0,
        prev.hash || null,
        this._mutationId(this.MANIFEST, h)
      );
      if (!wr.ok && wr.conflict) {
        const remoto = await this._remoteSection(id, this.MANIFEST);
        const secs = remoto && remoto.data && Array.isArray(remoto.data.sections)
          ? remoto.data.sections.slice().sort() : null;
        const rh = secs ? this._hash(secs.join('|')) : null;
        if (remoto && rh === h) {
          revs[this.MANIFEST] = { rev: remoto.rev || rev, hash: h };
        } else {
          /* Outro aparelho avançou o manifesto entre nosso SELECT e UPDATE.
             Registramos a nova base e refazemos a união a partir do estado
             remoto fresco. O CAS continua impedindo qualquer sobrescrita cega. */
          if (remoto) revs[this.MANIFEST] = { rev: remoto.rev || 0, hash: rh };
          if (!restantes.length && tentativa < 2) {
            return this._syncManifest(id, revs, tentativa + 1);
          }
          this._lastConflict = { em: Date.now(), seções: [this.MANIFEST], tipo: 'manifesto' };
          throw new Error('conflito de revisão protegido no manifesto');
        }
      } else {
        revs[this.MANIFEST] = { rev: wr.rev || rev, hash: h };
      }
    }

    /* Mantemos o tombstone em conflito, mas o manifesto já preserva a linha
       remota vencedora. Assim o conflito pode ser tratado depois sem esconder
       nem apagar o dado mais novo. */
    if (restantes.length) throw new Error('há exclusões com conflito ou falha pendentes');
    return true;
  },
  /* Entrega final antes/depois de outro aparelho assumir a interface.
     O snapshot congela seção+geração; qualquer escrita posterior ao bloqueio
     recebe outra geração e fica FORA deste lote. O CAS do servidor continua
     sendo a autoridade: se a base já avançou, nada é sobrescrito. */
  async drainExplicitSnapshot(id, snapshot) {
    const alvo = id || this._activeProfileId();
    const snap = Array.isArray(snapshot) ? snapshot : this.captureExplicitSnapshot(alvo);
    if (!alvo || !snap.length) return { ok: true, sent: 0, remaining: 0 };
    /* Se o takeover chegou no meio de um envio, não declaramos o handoff
       fracassado só porque _pushing estava ocupado. Esperamos a rodada em voo
       encerrar e então reenviamos apenas o que do snapshot ainda sobrou. */
    const limite = Date.now() + 8000;
    while (this._pushing && Date.now() < limite) {
      await new Promise(r => setTimeout(r, 80));
    }
    await this.pushDirty(alvo, { allowBlocked: true, snapshot: snap, skipManifest: true });
    const dirty = this._dirtyFor(alvo), gens = this._dirtyGenFor(alvo);
    const remaining = snap.filter(x => dirty.has(x.section) && (gens.get(x.section) || 0) === (x.gen || 0));
    return { ok: remaining.length === 0 && !this._lastConflict, sent: snap.length - remaining.length, remaining: remaining.length };
  },

  // Semeia (1x) e envia — dispara PROATIVAMENTE (não depende de uma edição/salvamento).
  // Chamado no login, ao entrar num perfil, periodicamente, e após cada salvamento.
  async kick() {
    if (!this.enabled) return;
    try {
      if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return;
      if (window.SessionGuard && SessionGuard.enabled && SessionGuard.canEnterNow && !SessionGuard.canEnterNow()) return;
      if ((window.SessionGuard && SessionGuard.isBlockedByRemote && SessionGuard.isBlockedByRemote()) ||
          (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote')) return;
      try { if (!sessionStorage.getItem('diario-estudos:entered')) return; } catch (_) { return; }
      if (!ProfileManager.getActiveProfileId()) return;
      // Recupera, uma vez por perfil, o que ficou por enviar na sessão anterior.
      if (this._restoredFor !== ProfileManager.getActiveProfileId()) {
        this._restoredFor = ProfileManager.getActiveProfileId();
        this.restorePending(this._restoredFor);
      }
      this.seedOnce();
      await this.pushDirty();
      // Depois de concluir a escrita dupla e ficar estável, compara em modo sombra.
      await this.shadowCheck();
    } catch (_) { _quiet(_); }
  },
  afterBlobSave() { this.kick(); },

  /* ── FASE 2: LEITURA POR SEÇÃO ────────────────────────────────────────────
     Baixa profile_sections e reconstrói o localStorage do perfil a partir das
     linhas. Só aplica se o conjunto passar na verificação (manifesto presente e
     todas as seções que ele lista realmente vieram). Qualquer falha devolve
     { ok:false, motivo } — e quem chamou cai no blob, sem perder nada. */
  async fetchAllSections(id) {
    const { data, error } = await CloudStore._withTimeout(
      CloudStore.client.from(this.TABLE).select('section,data,rev,updated_at,content_hash,mutation_id,device_id').eq('profile_id', id),
      20000, 'Baixar as seções do perfil');
    if (error) throw error;
    return data || [];
  },
  // Monta o mapa seção→texto e valida. NÃO escreve nada.
  _prepare(rows) {
    const map = {}, revs = {};
    let manifesto = null, manifestoRev = 0;
    (rows || []).forEach(r => {
      if (r.section === this.MANIFEST) { manifesto = r.data || null; manifestoRev = r.rev || 0; return; }
      const txt = this._decode(r.data);
      if (txt === null) return;                  // linha ilegível → tratada como ausente
      map[r.section] = txt;
      revs[r.section] = r.rev || 1;
    });
    const secoes = Object.keys(map);
    if (!manifesto || !Array.isArray(manifesto.sections)) {
      return { ok: false, motivo: secoes.length ? 'sem-manifesto' : 'sem-seções', map, revs };
    }
    const faltando = manifesto.sections.filter(s => !(s in map));
    if (faltando.length) return { ok: false, motivo: 'seções-faltando: ' + faltando.join(', '), map, revs, faltando };
    /* O manifesto prova que as seções listadas DEVEM existir, mas a ausência de uma
       seção no manifesto não prova que a linha remota é lixo. Há uma janela real
       entre gravar uma seção e avançar o manifesto; se a aba cair ali, a linha é
       mais nova que o manifesto. Portanto a união conservadora vence: toda linha
       remota legível é preservada. A próxima _syncManifest incorpora essas extras
       ao manifesto por CAS. Exclusão legítima continua inequívoca porque remove a
       linha remota por RPC CAS antes de retirar seu nome do manifesto. */
    const extras = secoes.filter(s => manifesto.sections.indexOf(s) === -1);
    const finalMap = {};
    [...new Set(manifesto.sections.concat(secoes))].forEach(s => {
      if (s in map) finalMap[s] = map[s];
    });
    return { ok: true, map: finalMap, revs, manifesto, manifestoRev, extras };
  },
  // Escreve o mapa no localStorage do perfil. Preserva o histórico de versões local
  // (vhist) — ao contrário do restore do blob, que apagava tudo do namespace.
  _applyMap(id, map, revs, preservar, manifestoRev, manifestoSections) {
    const prefix = 'diario-estudos:u:' + id + ':';
    /* REGRA DE OURO: o download NUNCA apaga uma alteração que ainda não subiu.
       As seções de `preservar` mantêm o valor deste aparelho e continuam na fila
       de envio; todo o resto é substituído pelo que veio da nuvem. */
    const manter = new Set(preservar || []);
    const antigos = this._getRevs(id);
    /* CONTA O QUE REALMENTE MUDOU. Sem isso, quem chamou não tem como saber se
       valeu a pena recarregar a tela — e recarregar "por precaução" a cada
       download era a origem do pisca-pisca. */
    let mudou = 0;
    /* ── AUSÊNCIA NA NUVEM NÃO É PROVA DE EXCLUSÃO ────────────────────────────
       Esta linha apagava do aparelho toda seção que não viesse no manifesto:
       "sumiu na nuvem". Só que uma seção pode não estar na nuvem por dois
       motivos MUITO diferentes:

         a) ela foi realmente excluída em outro aparelho — e aí apagar é o certo;
         b) ela NUNCA CHEGOU LÁ. É o caso das seções grandes (cards, retratos do
            TEC, incidência, grades salvas), que sobem uma a uma e podem falhar
            por tamanho ou tempo limite; e o de quem começou a usar offline.

       No caso (b) o download apagava o ÚNICO exemplar do dado que existia no
       mundo. Era assim que "os registros aparecem, mas o ciclo, os cards, o TEC
       e a grade sumiram": as seções pequenas subiam, as grandes não, e a
       primeira leitura por seção levava as grandes embora.

       A prova de que uma seção esteve na nuvem é haver revisão gravada para ela
       (`antigos[sec]`, escrito só depois de um envio ou download bem-sucedido).
       Sem essa prova, o dado é deste aparelho e só: fica onde está e entra na
       fila de envio. Na dúvida, o app guarda — nunca apaga. */
    const apagar = [];
    const orfas = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(prefix) !== 0) continue;
      const sec = this.sectionForKey(k, prefix);
      if (!sec || manter.has(sec) || (sec in map)) continue;
      if (antigos[sec]) apagar.push(k);   // já esteve na nuvem e saiu de lá: exclusão de verdade
      else orfas.push(sec);               // nunca subiu: é o único exemplar que existe
    }
    apagar.forEach(k => { Lixeira.guardar(k, 'excluída em outro aparelho'); localStorage.removeItem(k); mudou++; });
    if (orfas.length) {
      orfas.forEach(sec => manter.add(sec));   // preservadas E na fila, como as pendentes
      try { console.warn('[SectionSync] ' + orfas.length + ' seção(ões) existem só neste aparelho e foram PRESERVADAS (vão subir): ' + orfas.join(', ')); } catch (e) { _quiet(e, 'orfas-log'); }
    }
    const novoRev = {};
    manter.forEach(sec => { if (antigos[sec]) novoRev[sec] = antigos[sec]; }); // segue "suja" e será reenviada
    Object.keys(map).forEach(sec => {
      if (manter.has(sec)) return;
      const txt = map[sec];
      const atual = localStorage.getItem(prefix + sec);
      /* A nuvem também pode chegar vazia. Se ela traz `[]` onde este aparelho
         tem conteúdo, a gravação é legítima (alguém apagou lá) — mas o valor
         daqui vai para a Lixeira antes, como em qualquer outro apagamento.
         Sem isto, o único caminho de perda que sobrava era justamente o
         download: ele escrevia direto, sem passar por DB.setRaw. */
      if (atual !== txt && valorVazio(txt) && !valorVazio(atual)) {
        try { Lixeira.guardar(prefix + sec, 'esvaziada pela nuvem'); } catch (e) { _quiet(e, 'hidratar-lixeira'); }
      }
      if (atual !== txt) { localStorage.setItem(prefix + sec, txt); mudou++; }
      novoRev[sec] = { rev: (revs && revs[sec]) || 1, hash: this._hash(txt), len: txt.length };
    });
    /* A REVISÃO DO MANIFESTO precisa ser guardada como a de qualquer outra seção.
       Ela não era — e como hasRemoteUpdates compara TODAS as linhas remotas com as
       locais, o manifesto (rev 7 na nuvem, 0 aqui) anunciava "tem novidade" para
       sempre. Cada foco na janela disparava um download e um location.reload():
       era exatamente a tela piscando e recarregando sozinha. */
    if (manifestoRev) novoRev[this.MANIFEST] = {
      rev: manifestoRev,
      hash: this._hash((Array.isArray(manifestoSections) ? manifestoSections.slice() : Object.keys(map)).sort().join('|'))
    };
    else if (antigos[this.MANIFEST]) novoRev[this.MANIFEST] = antigos[this.MANIFEST];
    // Alinha a contabilidade local com o que acabou de vir: sem isto, a próxima
    // rodada acharia tudo "sujo" e re-subiria o perfil inteiro sem necessidade.
    try { localStorage.setItem('diario-estudos:u:' + id + ':__secrev', JSON.stringify(novoRev)); } catch (_) { _quiet(_); }
    this._seededProfile = id;
    this._dirtyFor(id).clear();
    this._dirtyGenFor(id).clear();
    manter.forEach(s => this._ensureDirty(s, id));
    try {
      const pk = prefix + this.PEND;
      if (manter.size) localStorage.setItem(pk, JSON.stringify([...manter]));
      else localStorage.removeItem(pk);
    } catch (_) { _quiet(_); }
    return mudou;
  },
  // Fluxo completo de leitura. Retorna { ok, motivo, seções }.
  async hydrate(id, opts) {
    opts = opts || {};
    const res = { ok: false, motivo: null, seções: 0, em: new Date().toISOString() };
    try {
      res.origem = 'seções';
      if (window.SessionGuard && SessionGuard.enabled && SessionGuard.canEnterNow && !SessionGuard.canEnterNow()) {
        res.motivo = 'sessão-ainda-não-confirmada';
        return this._saveLast(res);
      }
      if ((window.SessionGuard && SessionGuard.isBlockedByRemote && SessionGuard.isBlockedByRemote()) ||
          (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote')) {
        res.motivo = 'sessão-bloqueada-em-outro-aparelho';
        return this._saveLast(res);
      }
      if (!this.readEnabled && !opts.force) { res.motivo = 'leitura-por-seção-desligada'; return this._saveLast(res); }
      if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) { res.motivo = 'sem-conexão'; return this._saveLast(res); }
      /* ANTES de ler: entrega o que este aparelho ainda não enviou. O que não
         conseguir subir volta como `preservar` e sai ileso do download — é o que
         garante que uma alteração feita offline (ou com a sessão em outro
         aparelho) não seja apagada pela cópia mais velha da nuvem. */
      const preservar = opts.skipPush
        ? this.explicitPendingSections(id)
        : await this.flushBeforeRead(id, { explicitOnly: !!opts.explicitOnly });
      const rows = await this.fetchAllSections(id);
      res.linhasRemotas = rows.length;
      const prep = this._prepare(rows);
      if (!prep.ok) { res.motivo = prep.motivo; return this._saveLast(res); }
      // Rede de segurança antes de sobrescrever o estado local.
      try { if (window.BackupHistory && ProfileManager.getActiveProfileId() === id) await BackupHistory.snapshot('antes de baixar por seção'); } catch (_) { _quiet(_); }
      res.mudou = this._applyMap(id, prep.map, prep.revs, preservar, prep.manifestoRev, prep.manifesto && prep.manifesto.sections);
      res.ok = true; res.seções = Object.keys(prep.map).length;
      if (preservar.length) res.preservadas = preservar;   // ficaram com o valor local, ainda na fila
      if (prep.extras && prep.extras.length) {
        res.recuperadasForaManifesto = prep.extras;
        console.warn('[SectionSync] ' + prep.extras.length + ' seção(ões) remotas estavam fora do manifesto e foram PRESERVADAS:', prep.extras.join(', '));
      }
      this._saveLast(res);
      console.info('[SectionSync] leitura por seção aplicada:', res.seções, 'seção(ões)');
      return res;
    } catch (e) {
      res.motivo = (e && (e.message || e.code)) || 'erro';
      this._saveLast(res);
      console.warn('[SectionSync] leitura por seção falhou:', res.motivo);
      return res;
    }
  },
  /* Barreira de consistência após trocar a versão do aplicativo.
     Faz UMA hidratação completa usando somente a fila explícita como autoridade
     local. Isso corrige o caso em que o cache/IndexedDB volta com conteúdo de
     ontem mas a contabilidade __secrev já diz que a revisão de hoje foi vista.

     A hidratação já fotografa BackupHistory antes de aplicar qualquer coisa e
     _applyMap preserva seções locais que nunca existiram na nuvem. Portanto a
     barreira corrige cache regressado sem transformar ausência remota em perda. */
  async hydrateAfterAppUpdate(id) {
    return this.hydrate(id, { force: true, explicitOnly: true });
  },
  /* Download manual realmente somente-leitura: nunca publica nada antes de ler.
     Se houver divergência local conhecida, ela é preservada e permanece visível
     na fila em vez de ser apagada. */
  async hydrateReadOnly(id) {
    return this.hydrate(id, { force: true, skipPush: true });
  },

  // Checagem barata "tem novidade na nuvem?" — compara as revisões remotas com as
  // que este aparelho já conhece. Substitui a comparação de rev do blob.
  /* ── A CONTABILIDADE DE REVISÕES NÃO PROVA QUE O DADO ESTÁ AQUI ───────────
     Esta checagem decide se vale baixar. Ela comparava só revisão contra
     revisão — "a nuvem tem rev maior que a que eu anotei?" — e tinha dois
     furos, os dois com a mesma consequência: responder "nada novo" e deixar o
     aparelho com dado incompleto até alguém limpar o navegador.

     1. `_getRevs()` era chamada SEM o `id`, então lia as revisões do perfil
        ATIVO para comparar com as linhas remotas do perfil consultado. Com
        `id` diferente do ativo, a comparação era entre coisas distintas.

     2. Mais grave: a anotação de revisão é bookkeeping LOCAL, gravada quando
        este aparelho enviou ou aplicou a seção. Ela pode continuar dizendo
        "tenho a rev 5 de `entries`" depois de o conteúdo em si ter ido embora
        — cota de armazenamento estourada no meio de uma gravação, uma
        limpeza parcial do navegador, uma gravação interrompida. A seção fica
        AUSENTE no localStorage com a revisão intacta, e como a revisão bate,
        o download nunca acontecia: o registro sumia e não voltava mais.
        Era exactamente o "faltam alguns registros, e só normaliza em guia
        anônima" — guia anônima não tem revisão anotada, então baixa tudo.

     A ausência do conteúdo passa a valer como novidade, do mesmo jeito que uma
     revisão maior. A leitura é uma consulta ao localStorage por seção, que é
     barata, e a decisão erra para o lado de baixar — que é o lado em que o
     pior caso é tráfego, não perda. */
  async hasRemoteUpdates(id) {
    if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return false;
    const { data, error } = await CloudStore.client.from(this.TABLE).select('section,rev').eq('profile_id', id);
    if (error) throw error;
    const locais = this._getRevs(id);
    const pfx = this._prefixFor(id);
    return (data || []).some(r => this.precisaBaixar(r, locais, pfx));
  },
  /* A REGRA, separada da rede, para poder ser conferida sem inventar um
     servidor: dada uma linha remota (`section`, `rev`), as revisões anotadas
     neste aparelho e o prefixo do perfil, esta seção precisa ser baixada? */
  precisaBaixar(r, locais, pfx) {
    if (!r || !r.section) return false;
    const anotada = locais ? locais[r.section] : null;
    const meu = anotada ? (anotada.rev || 0) : 0;
    /* Exclusões físicas removem a linha da seção; quem anuncia a mudança aos
       outros aparelhos é o avanço do manifesto. Ignorá-lo fazia uma exclusão
       remota nunca ser percebida por hasRemoteUpdates(). */
    if (r.section === this.MANIFEST) return (r.rev || 0) > meu;
    if ((r.rev || 0) > meu) return true;
    /* Revisão anotada mas conteúdo ausente: o aparelho acha que tem e não tem.
       Só conta quando existe anotação — sem ela, a semeadura normal já cuida, e
       tratar como novidade faria todo perfil novo baixar duas vezes. */
    if (anotada && localStorage.getItem(pfx + r.section) === null) {
      console.warn('[SectionSync] seção anotada mas ausente no aparelho:', r.section, '— vai baixar');
      return true;
    }
    return false;
  },
  // Baixa por seção e recarrega a tela (equivalente ao pullActiveAndReload do blob).
  /* Baixa por seção e recarrega a tela — MAS SÓ SE ALGO MUDOU DE VERDADE.
     Antes recarregava sempre que a checagem dissesse "pode haver novidade", e
     bastava um falso positivo para a tela reiniciar do nada no meio do uso. */
  async pullAndReload(opts) {
    opts = opts || {};
    const id = ProfileManager.getActiveProfileId(); if (!id) return false;
    /* `aplicando` e não duas atribuições soltas: se `hydrate` lançar (rede,
       JSON malformado, armazenamento), a linha que desligava a marca era pulada
       e `notifyChange` passava a ignorar toda alteração seguinte. */
    const r = await CloudStore.aplicando(() => opts.readOnly ? this.hydrateReadOnly(id) : this.hydrate(id));
    if (!r.ok) return false;
    if (!r.mudou) { console.info('[SectionSync] nuvem conferida: nada mudou, sem recarregar'); return true; }
    showToast('Sincronizado da nuvem ✓');
    recarregarApp('dados novos da nuvem');
    return true;
  },
  // Reenvia TUDO no formato atual (v2). Use uma vez ao migrar para a Fase 2, ou
  // se desconfiar de alguma linha antiga: SectionSync.reenviarTudo()
  async reenviarTudo() {
    const id = this._activeProfileId();
    try { localStorage.removeItem(this._revKey(id)); } catch (_) { _quiet(_); }
    this._seededProfile = null;
    this._dirtyFor(id).clear();
    this._dirtyGenFor(id).clear();
    this.markAllDirty(id);
    await this.pushDirty();
    return this.status();
  },

  // ── FASE 1.5: LEITURA-SOMBRA (somente leitura) ────────────────────────────
  // Normaliza objetos/arrays JSONB do Supabase e strings do localStorage para uma
  // representação canônica. Ordenar chaves evita falso positivo por ordem diferente.
  _stable(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(v => this._stable(v)).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + this._stable(value[k])).join(',') + '}';
  },
  _localValue(section) {
    const raw = localStorage.getItem(this._prefix() + section);
    if (raw === null) return { exists: false, raw: null, value: null };
    let value; try { value = JSON.parse(raw); } catch (_) { value = raw; }
    return { exists: true, raw, value };
  },
  _count(value) {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') return Object.keys(value).length;
    return null;
  },
  // Baixa TODAS as seções e COMPARA. Nenhum setItem, restorePayloadInto, DB._set,
  // reload ou aplicação é feito aqui. O método é deliberadamente somente leitura.
  async shadowCheck(options) {
    options = options || {};
    if (this._shadowRunning) return this._shadowReport;
    if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return null;
    const id = window.ProfileManager ? ProfileManager.getActiveProfileId() : null;
    if (!id) return null;
    // Se há alteração local pendente ou envio de seção em curso, adia a comparação para
    // não registrar uma divergência transitória como problema real.
    if ((CloudStore._pending || CloudStore._syncing || this._pushing || this._dirty.size) && !options.force) return null;
    this._shadowRunning = true;
    try {
      const { data, error } = await CloudStore.client.from(this.TABLE)
        .select('section,data,rev,updated_at')
        .eq('profile_id', id)
        .order('section', { ascending: true });
      if (error) throw error;
      const remoteRows = data || [];
      const remoteMap = new Map(remoteRows.map(r => [r.section, r]));
      const localSections = [];
      const pfx = this._prefix();
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const sec = this.sectionForKey(key);
        if (sec) localSections.push(sec);
      }
      const all = [...new Set(localSections.concat([...remoteMap.keys()]))].sort();
      const rows = all.map(section => {
        const local = this._localValue(section);
        const remote = remoteMap.get(section) || null;
        // v2: a nuvem pode guardar { __raw__ }. Comparamos o TEXTO decodificado; se
        // diferir, ainda tentamos a comparação canônica (tolera linhas no formato antigo).
        const remoteTxt = remote ? this._decode(remote.data) : null;
        const localCanon = local.exists ? this._stable(local.value) : null;
        let remoteCanon = null;
        if (remote) {
          if (remoteTxt !== null && remoteTxt === local.raw) remoteCanon = localCanon;
          else { let rv; try { rv = JSON.parse(remoteTxt); } catch (_) { rv = remote.data; } remoteCanon = this._stable(rv); }
        }
        let status = 'igual';
        if (!local.exists && remote) status = 'somente_remoto';
        else if (local.exists && !remote) status = 'somente_local';
        else if (localCanon !== remoteCanon) status = 'divergente';
        return {
          section,
          status,
          revRemota: remote ? (remote.rev || 0) : null,
          atualizadaEm: remote ? remote.updated_at : null,
          tipoLocal: local.exists ? (Array.isArray(local.value) ? 'array' : local.value === null ? 'null' : typeof local.value) : null,
          tipoRemoto: remote ? (Array.isArray(remote.data) ? 'array' : remote.data === null ? 'null' : typeof remote.data) : null,
          itensLocal: local.exists ? this._count(local.value) : null,
          itensRemoto: remote ? this._count(remote.data) : null,
          hashLocal: localCanon === null ? null : this._hash(localCanon),
          hashRemoto: remoteCanon === null ? null : this._hash(remoteCanon)
        };
      });
      const summary = {
        perfil: id,
        executadoEm: new Date().toISOString(),
        modo: 'SOMENTE LEITURA — nenhum dado aplicado',
        total: rows.length,
        iguais: rows.filter(r => r.status === 'igual').length,
        divergentes: rows.filter(r => r.status === 'divergente').length,
        somenteLocal: rows.filter(r => r.status === 'somente_local').length,
        somenteRemoto: rows.filter(r => r.status === 'somente_remoto').length,
        criticas: rows.filter(r => /:(tec|incidencia|entries|cards|leis)$/.test(r.section)),
        diferenças: rows.filter(r => r.status !== 'igual'),
        rows
      };
      this._shadowReport = summary;
      this._shadowLastAt = Date.now();
      this._shadowLastError = null;
      console.info('[SectionSync sombra]', summary.iguais + '/' + summary.total, 'iguais ·', summary.divergentes, 'divergentes ·', summary.somenteLocal, 'somente local ·', summary.somenteRemoto, 'somente remoto');
      if (summary.diferenças.length) console.table(summary.diferenças);
      else console.info('[SectionSync sombra] equivalência total confirmada; nenhum dado foi aplicado.');
      return summary;
    } catch (e) {
      this._shadowLastError = (e && (e.message || e.code || JSON.stringify(e))) || 'erro';
      console.warn('[SectionSync sombra] falha:', this._shadowLastError);
      return null;
    } finally {
      this._shadowRunning = false;
    }
  },
  shadowReport() {
    if (!this._shadowReport) {
      console.info('[SectionSync sombra] ainda não executada. Use: await SectionSync.shadowCheck({force:true})');
      return null;
    }
    console.table(this._shadowReport.rows);
    return this._shadowReport;
  },

  // Diagnóstico rápido (rode no console: SectionSync.status())
  status() {
    return {
      habilitado: this.enabled,
      leituraPorSeção: this.readEnabled ? 'LIGADA (Fase 2)' : 'desligada (lendo do blob)',
      últimaLeitura: this.lastRead(),
      formato: 'v' + this.FORMAT,
      perfilAtivo: (window.ProfileManager ? ProfileManager.getActiveProfileId() : null) || null,
      logado: !!(window.CloudStore && CloudStore.isLoggedIn && CloudStore.isLoggedIn()),
      seedFeito: this._seededProfile,
      seçõesPendentes: [...this._dirty],
      naCaixaDeSaída: this.pendingSections(),   // inclui o que sobreviveu a recarregamentos
      enviadasNestaSessão: this._pushedCount,
      últimoEnvio: this._lastPushAt ? new Date(this._lastPushAt).toLocaleString('pt-BR') : null,
      últimoErro: this._lastError,
      últimoConflitoProtegido: this._lastConflict,
      sombraSomenteLeitura: true,
      sombraÚltimaExecução: this._shadowLastAt ? new Date(this._shadowLastAt).toLocaleString('pt-BR') : null,
      sombraÚltimoErro: this._shadowLastError,
      sombraResumo: this._shadowReport ? {
        total: this._shadowReport.total,
        iguais: this._shadowReport.iguais,
        divergentes: this._shadowReport.divergentes,
        somenteLocal: this._shadowReport.somenteLocal,
        somenteRemoto: this._shadowReport.somenteRemoto
      } : null
    };
  },
  // LOCALIZADOR DE DADOS (rode: SectionSync.localizarDados())
  // Varre o armazenamento e diz ONDE cada dado importante está fisicamente:
  // no endereço correto do perfil (…:u:<id>:…) ou num endereço "órfão" (sem perfil).
  // Serve para descobrir se os dados do TEC sumiram de verdade ou só estão no lugar errado.
  localizarDados() {
    const pid = (window.ProfileManager ? ProfileManager.getActiveProfileId() : null);
    const pfx = pid ? ('diario-estudos:u:' + pid + ':') : null;
    const achados = { perfilAtivo: pid, tec: [], entries: [], cards: [], leis: [], vhist: [] };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const val = localStorage.getItem(k) || '';
        const tam = val.length;
        const dentroDoPerfil = pfx && k.indexOf(pfx) === 0;
        const orfao = k.indexOf('diario-estudos:') === 0 && k.indexOf('diario-estudos:u:') !== 0;
        let itens = null; try { const p = JSON.parse(val); if (Array.isArray(p)) itens = p.length; } catch (_) { _quiet(_); }
        const info = { chave: k, ondePerfil: dentroDoPerfil, orfao, chars: tam, itens };
        if (/:tec$/.test(k)) achados.tec.push(info);
        else if (/:entries$/.test(k)) achados.entries.push(info);
        else if (/:cards$/.test(k)) achados.cards.push(info);
        else if (/:leis$/.test(k)) achados.leis.push(info);
        else if (/:vhist:/.test(k)) achados.vhist.push({ chave: k, chars: tam });
      }
    } catch (_) { _quiet(_); }
    const resumo = (arr) => arr.length ? arr.map(x => (x.itens != null ? x.itens + ' itens' : x.chars + ' chars') + (x.orfao ? ' ⚠ÓRFÃO' : '')).join(' · ') : 'NADA ENCONTRADO';
    console.info('[Localizador] perfil ativo:', pid || '(nenhum)');
    console.info('[Localizador] TEC:', resumo(achados.tec));
    console.info('[Localizador] registros:', resumo(achados.entries));
    console.info('[Localizador] cards:', resumo(achados.cards), '· leis:', resumo(achados.leis));
    console.info('[Localizador] histórico de versões:', achados.vhist.length, 'backup(s) guardado(s)');
    return achados;
  }
};
window.SectionSync = SectionSync;
// liga o hook do DB._set a esta camada (var definida lá no topo, sem zona morta)
_sectionMarkHook = function (key) { try { SectionSync.markDirty(key); } catch (_) { _quiet(_); } };
// Journal por registro: só o Diário usa esta trilha fina de conflito.
_entryMutationHook = function (key, op) { try { SectionSync.recordEntryMutation(key, op); } catch (_) { _quiet(_); } };
// e o hook do DB.delRaw: apagar sai da fila e viaja pelo manifesto
_sectionDropHook = function (key) { try { SectionSync.dropSection(key); } catch (_) { _quiet(_); } };
// Recupera na abertura o que ficou por enviar (antes de qualquer leitura da nuvem).
try { SectionSync.restorePending(); } catch (_) { _quiet(_); }
