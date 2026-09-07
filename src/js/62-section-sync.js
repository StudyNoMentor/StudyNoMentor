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
  _dirty: new Set(),        // seções alteradas aguardando envio
  _pushing: false,
  _seededProfile: null,     // id do perfil já "semeado" nesta sessão (envio inicial completo)
  _lastError: null,         // último erro de envio (para diagnóstico)
  _lastPushAt: null,        // quando o último envio bem-sucedido ocorreu
  _pushedCount: 0,          // total de seções enviadas com sucesso nesta sessão
  // FASE 1.5 — leitura-sombra: baixa e compara, mas NUNCA aplica no localStorage.
  _shadowRunning: false,
  _shadowLastAt: null,
  _shadowLastError: null,
  _shadowReport: null,

  _prefix() { try { return DB._profilePrefix(); } catch (_) { return 'diario-estudos:'; } },
  _revKey() { return this._prefix() + '__secrev'; },
  // Estrutura salva: { section: { rev, hash } } — o hash evita reenviar conteúdo idêntico
  // (antes, cada sessão re-subia tudo e inflava o rev). Migração automática do formato antigo.
  _getRevs() {
    try {
      const v = JSON.parse(localStorage.getItem(this._revKey())) || {};
      for (const k in v) { if (typeof v[k] === 'number') v[k] = { rev: v[k], hash: null }; } // formato antigo → novo
      return v;
    } catch (_) { return {}; }
  },
  _saveRevs(r) { try { localStorage.setItem(this._revKey(), JSON.stringify(r)); } catch (_) { _quiet(_); } },

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

  // Converte uma chave de localStorage na seção correspondente, ou null se não
  // pertence ao perfil ativo / não deve ser sincronizada.
  sectionForKey(fullKey, prefixo) {
    const pfx = prefixo || this._prefix();
    if (!fullKey || fullKey.indexOf(pfx) !== 0) return null;
    const sub = fullKey.slice(pfx.length);
    if (!sub) return null;
    if (sub.indexOf('__secrev') === 0) return null; // bookkeeping desta camada
    if (sub.indexOf('vhist') === 0) return null;     // histórico de versões é local
    return sub;
  },
  markDirty(fullKey) {
    if (!this.enabled) return;
    const sec = this.sectionForKey(fullKey);
    if (sec) this._dirty.add(sec);
  },
  // Marca as seções do perfil que REALMENTE MUDARAM (hash diferente do último envio).
  // Assim a semeadura de cada sessão não re-sobe tudo nem infla o rev à toa.
  markAllDirty() {
    const pfx = this._prefix();
    const revs = this._getRevs();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const full = localStorage.key(i);
        const sec = this.sectionForKey(full);
        if (!sec) continue;
        const raw = localStorage.getItem(full) || '';
        const h = this._hash(raw);
        if (!revs[sec] || revs[sec].hash !== h) this._dirty.add(sec); // só o que mudou
      }
    } catch (_) { _quiet(_); }
  },
  seedOnce() {
    const id = ProfileManager.getActiveProfileId();
    if (!id || this._seededProfile === id) return;
    this._seededProfile = id;
    this.markAllDirty();
  },
  // Envia as seções sujas para profile_sections (upsert por profile_id+section).
  // Best-effort: qualquer falha mantém a seção suja para a próxima rodada, e NUNCA
  // interfere no salvamento do blob (que é a fonte de verdade nesta fase).
  async pushDirty() {
    if (!this.enabled || this._pushing) return;
    if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return;
    const id = ProfileManager.getActiveProfileId();
    if (!id) return;
    this._pushing = true;
    const pfx = this._prefix();
    const revs = this._getRevs();
    // Monta as linhas com hash de conteúdo. Só bumpa o rev quando o conteúdo mudou
    // de verdade (evita inflar o rev quando a semeadura reencontra dados idênticos).
    const secs = [...this._dirty];
    const rows = [];
    secs.forEach(sec => {
      const raw = localStorage.getItem(pfx + sec) || '';
      const h = this._hash(raw);
      const prev = revs[sec] || { rev: 0, hash: null };
      if (prev.hash === h) { this._dirty.delete(sec); return; } // idêntico → nada a enviar
      rows.push({ _sec: sec, _hash: h, profile_id: id, section: sec, data: this._encode(raw), rev: prev.rev + 1, updated_at: new Date().toISOString() });
    });
    if (rows.length === 0) {
      // Nada de conteúdo novo, mas o MANIFESTO ainda pode estar desatualizado
      // (ex.: uma seção foi APAGADA localmente). Sem isto, exclusões nunca chegariam
      // à nuvem e a leitura por seção "ressuscitaria" dados apagados.
      try { await this._syncManifest(id, revs); } catch (_) { _quiet(_); }
      this._saveRevs(revs);
      this._pushing = false; return;
    }
    // Envio UMA SEÇÃO POR VEZ: assim uma seção grande (ex.: incidência, ~300 KB) fica
    // ISOLADA — se ela falhar (tamanho/timeout), não derruba as outras, o erro dela é
    // registrado individualmente, e ela reenvia sozinha na próxima rodada. Mais lento,
    // porém à prova de "seção presa" (era o caso da incidencia travada no rev 1).
    let okCount = 0; const falhas = [];
    for (const r of rows) {
      const { _sec, _hash, ...row } = r;
      try {
        const { error } = await CloudStore.client.from(this.TABLE).upsert(row, { onConflict: 'profile_id,section' });
        if (error) throw error;
        revs[_sec] = { rev: row.rev, hash: _hash };
        this._dirty.delete(_sec);
        okCount++;
      } catch (e) {
        const msg = (e && (e.message || e.code || JSON.stringify(e))) || 'erro';
        falhas.push(_sec + ' (' + (row.data ? JSON.stringify(row.data).length : 0) + ' bytes): ' + msg);
        // mantém a seção suja para o próximo retry
      }
    }
    // O MANIFESTO só é atualizado quando TODAS as seções sujas subiram. Se alguma
    // falhou, a nuvem ainda está incompleta — publicar o manifesto agora faria a
    // leitura por seção esperar uma linha que não existe (e cair no plano B à toa).
    if (!falhas.length) { try { await this._syncManifest(id, revs); } catch (_) { _quiet(_); } }
    this._saveRevs(revs);
    if (okCount) { this._lastPushAt = Date.now(); this._pushedCount += okCount; }
    if (falhas.length) {
      this._lastError = falhas.join(' | ');
      console.warn('[SectionSync] falharam', falhas.length, 'de', rows.length + ':', this._lastError);
    } else {
      this._lastError = null;
      console.info('[SectionSync] enviou', okCount, 'seção(ões)');
    }
    this._pushing = false;
  },
  // ── MANIFESTO ─────────────────────────────────────────────────────────────
  // Uma linha (section = '__manifest') que diz QUAIS seções o perfil tem agora.
  // É o que torna a leitura por seção segura: sem ele, um upsert nunca apaga nada
  // e uma seção excluída aqui voltaria à vida no próximo download. Com ele, a
  // hidratação usa a lista como verdade e ignora/limpa o que sobrou.
  localSections() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const sec = this.sectionForKey(localStorage.key(i));
        if (sec) out.push(sec);
      }
    } catch (_) { _quiet(_); }
    return out.sort();
  },
  async _syncManifest(id, revs) {
    const list = this.localSections();
    const body = { v: this.FORMAT, sections: list, at: new Date().toISOString() };
    const h = this._hash(list.join('|'));
    const prev = revs[this.MANIFEST] || { rev: 0, hash: null };
    if (prev.hash === h) return false;               // lista inalterada → nada a fazer
    const rev = prev.rev + 1;
    const { error } = await CloudStore.client.from(this.TABLE)
      .upsert({ profile_id: id, section: this.MANIFEST, data: body, rev, updated_at: body.at }, { onConflict: 'profile_id,section' });
    if (error) throw error;
    revs[this.MANIFEST] = { rev, hash: h };
    // Remove da nuvem as seções que não existem mais aqui (exclusões de verdade).
    try {
      const { data: remote } = await CloudStore.client.from(this.TABLE).select('section').eq('profile_id', id);
      const sobra = (remote || []).map(r => r.section)
        .filter(s => s !== this.MANIFEST && list.indexOf(s) === -1);
      if (sobra.length) {
        await CloudStore.client.from(this.TABLE).delete().eq('profile_id', id).in('section', sobra);
        sobra.forEach(s => { delete revs[s]; });
        console.info('[SectionSync] removidas da nuvem', sobra.length, 'seção(ões) excluída(s)');
      }
    } catch (e) { console.warn('[SectionSync] limpeza de seções órfãs falhou', e); }
    return true;
  },

  // Semeia (1x) e envia — dispara PROATIVAMENTE (não depende de uma edição/salvamento).
  // Chamado no login, ao entrar num perfil, periodicamente, e após cada salvamento.
  async kick() {
    if (!this.enabled) return;
    try {
      if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return;
      try { if (!sessionStorage.getItem('diario-estudos:entered')) return; } catch (_) { return; }
      if (!ProfileManager.getActiveProfileId()) return;
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
      CloudStore.client.from(this.TABLE).select('section,data,rev,updated_at').eq('profile_id', id),
      20000, 'Baixar as seções do perfil');
    if (error) throw error;
    return data || [];
  },
  // Monta o mapa seção→texto e valida. NÃO escreve nada.
  _prepare(rows) {
    const map = {}, revs = {};
    let manifesto = null;
    (rows || []).forEach(r => {
      if (r.section === this.MANIFEST) { manifesto = r.data || null; return; }
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
    // O manifesto manda: o que não está nele é resto de versão anterior e é descartado.
    const finalMap = {};
    manifesto.sections.forEach(s => { finalMap[s] = map[s]; });
    return { ok: true, map: finalMap, revs, manifesto, extras: secoes.filter(s => manifesto.sections.indexOf(s) === -1) };
  },
  // Escreve o mapa no localStorage do perfil. Preserva o histórico de versões local
  // (vhist) — ao contrário do restore do blob, que apagava tudo do namespace.
  _applyMap(id, map, revs) {
    const prefix = 'diario-estudos:u:' + id + ':';
    const apagar = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0 && this.sectionForKey(k, prefix)) apagar.push(k);
    }
    apagar.forEach(k => localStorage.removeItem(k));
    const novoRev = {};
    Object.keys(map).forEach(sec => {
      const txt = map[sec];
      localStorage.setItem(prefix + sec, txt);
      novoRev[sec] = { rev: (revs && revs[sec]) || 1, hash: this._hash(txt) };
    });
    // Alinha a contabilidade local com o que acabou de vir: sem isto, a próxima
    // rodada acharia tudo "sujo" e re-subiria o perfil inteiro sem necessidade.
    try { localStorage.setItem('diario-estudos:u:' + id + ':__secrev', JSON.stringify(novoRev)); } catch (_) { _quiet(_); }
    this._seededProfile = id;
    this._dirty.clear();
  },
  // Fluxo completo de leitura. Retorna { ok, motivo, seções }.
  async hydrate(id, opts) {
    opts = opts || {};
    const res = { ok: false, motivo: null, seções: 0, em: new Date().toISOString() };
    try {
      res.origem = 'seções';
      if (!this.readEnabled && !opts.force) { res.motivo = 'leitura-por-seção-desligada'; return this._saveLast(res); }
      if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) { res.motivo = 'sem-conexão'; return this._saveLast(res); }
      const rows = await this.fetchAllSections(id);
      const prep = this._prepare(rows);
      if (!prep.ok) { res.motivo = prep.motivo; return this._saveLast(res); }
      // Rede de segurança antes de sobrescrever o estado local.
      try { if (window.VersionHistory && ProfileManager.getActiveProfileId() === id) await VersionHistory.snapshot('antes de baixar por seção'); } catch (_) { _quiet(_); }
      this._applyMap(id, prep.map, prep.revs);
      res.ok = true; res.seções = Object.keys(prep.map).length;
      if (prep.extras && prep.extras.length) res.ignoradas = prep.extras;
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
  // Checagem barata "tem novidade na nuvem?" — compara as revisões remotas com as
  // que este aparelho já conhece. Substitui a comparação de rev do blob.
  async hasRemoteUpdates(id) {
    if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) return false;
    const { data, error } = await CloudStore.client.from(this.TABLE).select('section,rev').eq('profile_id', id);
    if (error) throw error;
    const locais = this._getRevs();
    let novidade = false;
    (data || []).forEach(r => {
      const meu = locais[r.section] ? locais[r.section].rev : 0;
      if ((r.rev || 0) > meu) novidade = true;
    });
    return novidade;
  },
  // Baixa por seção e recarrega a tela (equivalente ao pullActiveAndReload do blob).
  async pullAndReload() {
    const id = ProfileManager.getActiveProfileId(); if (!id) return false;
    CloudStore._applying = true;
    const r = await this.hydrate(id);
    CloudStore._applying = false;
    if (!r.ok) return false;
    showToast('Sincronizado da nuvem ✓');
    setTimeout(() => location.reload(), 500);
    return true;
  },
  // Reenvia TUDO no formato atual (v2). Use uma vez ao migrar para a Fase 2, ou
  // se desconfiar de alguma linha antiga: SectionSync.reenviarTudo()
  async reenviarTudo() {
    try { localStorage.removeItem(this._revKey()); } catch (_) { _quiet(_); }
    this._seededProfile = null;
    this._dirty.clear();
    this.markAllDirty();
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
      enviadasNestaSessão: this._pushedCount,
      últimoEnvio: this._lastPushAt ? new Date(this._lastPushAt).toLocaleString('pt-BR') : null,
      últimoErro: this._lastError,
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
