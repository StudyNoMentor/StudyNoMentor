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
  _savePend() {
    try {
      const lista = [...this._dirty];
      if (lista.length) localStorage.setItem(this._pendKey(), JSON.stringify(lista));
      else localStorage.removeItem(this._pendKey());
    } catch (_) { _quiet(_); }
  },
  // Recarrega a caixa de saída gravada para a memória (na abertura do app).
  restorePending() {
    const antes = this._dirty.size;
    this._loadPend().forEach(s => this._dirty.add(s));
    const novas = this._dirty.size - antes;
    if (novas) console.info('[SectionSync] ' + novas + ' alteração(ões) recuperada(s) da caixa de saída');
    return novas;
  },
  /* Tudo que ainda não foi confirmado na nuvem para um perfil. Soma duas fontes:
       1. a caixa de saída gravada (o que sabemos que ficou por enviar);
       2. o CONTEÚDO real — se o texto de uma seção não bate com o hash do último
          envio, ela mudou aqui depois disso, mesmo que a lista tenha se perdido.
     Seções sem envio anterior registrado ficam de fora: não dá para saber se são
     novidade local ou sobra de uma versão antiga, e a semeadura normal cuida delas. */
  pendingSections(id) {
    const ativo = (window.ProfileManager ? ProfileManager.getActiveProfileId() : null);
    const mesmo = !id || id === ativo;
    const out = new Set();
    if (mesmo) this._dirty.forEach(s => out.add(s));
    this._loadPend(id).forEach(s => out.add(s));
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
  hasLocalPending(id) { return this.pendingSections(id).length > 0; },
  /* Contagem BARATA, sem varrer nem re-hashear o conteúdo: é a que alimenta o
     indicador na tela, chamado a cada foco e a cada 30 s. A checagem completa
     (pendingSections) fica para os momentos em que ela é decisiva — antes de um
     download sobrescrever o local. */
  pendingQuick() {
    const out = new Set(this._dirty);
    this._loadPend().forEach(s => out.add(s));
    return out.size;
  },
  /* Tenta ENTREGAR o que está pendente antes de qualquer download sobrescrever o
     local. Devolve o que CONTINUA pendente depois da tentativa — quem chamou usa
     essa lista para preservar essas seções em vez de apagá-las. */
  async flushBeforeRead(id) {
    const pend = this.pendingSections(id);
    if (!pend.length) return [];
    const ativo = (window.ProfileManager ? ProfileManager.getActiveProfileId() : null);
    if (id && id !== ativo) return pend;   // outro perfil: não há como enviar daqui agora
    pend.forEach(s => this._dirty.add(s));
    this._savePend();
    try { await this.pushDirty(); } catch (e) { console.warn('[SectionSync] envio antes da leitura falhou', e); }
    const resta = this.pendingSections(id);
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
    return sub;
  },
  markDirty(fullKey) {
    if (!this.enabled) return;
    const sec = this.sectionForKey(fullKey);
    if (sec) { this._dirty.add(sec); this._savePend(); }
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
    try { const a = JSON.parse(localStorage.getItem(this._delKey(id))); return Array.isArray(a) ? a : []; }
    catch (_) { return []; }
  },
  _saveDel(lista, id) {
    try {
      if (lista.length) localStorage.setItem(this._delKey(id), JSON.stringify([...new Set(lista)]));
      else localStorage.removeItem(this._delKey(id));
    } catch (e) { _quiet(e, 'secdel-gravar'); }
  },
  /* Uma chave APAGADA não vira linha suja (subiria vazia em vez de sumir): sai da
     fila, entra no registro de exclusões e some da nuvem no próximo envio. */
  dropSection(fullKey) {
    if (!this.enabled) return;
    const sec = this.sectionForKey(fullKey);
    if (!sec) return;
    this._dirty.delete(sec);
    this._savePend();
    const revs = this._getRevs();
    if (revs[sec]) { delete revs[sec]; this._saveRevs(revs); }
    const del = this._loadDel();
    del.push(sec);
    this._saveDel(del);
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
    this._savePend();
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
      this._savePend();
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
    this._savePend();   // o que sobrou na fila continua gravado: sobrevive ao fechamento
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
    const locais = this.localSections();
    const apagadas = this._loadDel(id);
    /* O manifesto NÃO é mais "o que existe aqui agora". É "o que existe aqui" MAIS
       "o que existe na nuvem e ninguém mandou apagar". Assim um sumiço local
       nunca se converte em exclusão remota — e a seção volta para cá na próxima
       leitura, em vez de deixar de existir no mundo. */
    let remotas = [];
    try {
      const { data } = await CloudStore.client.from(this.TABLE).select('section').eq('profile_id', id);
      remotas = (data || []).map(r => r.section).filter(sec => sec !== this.MANIFEST);
    } catch (e) { console.warn('[SectionSync] não deu para ler a lista remota; manifesto sai só com o local', e); }
    const sobreviventes = remotas.filter(sec => locais.indexOf(sec) === -1 && apagadas.indexOf(sec) === -1);
    if (sobreviventes.length) {
      console.warn('[SectionSync] ' + sobreviventes.length + ' seção(ões) existem na nuvem e não aqui, sem ordem de exclusão — MANTIDAS: ' + sobreviventes.join(', '));
    }
    const list = [...new Set(locais.concat(sobreviventes))].sort();
    const body = { v: this.FORMAT, sections: list, at: new Date().toISOString() };
    const h = this._hash(list.join('|'));
    const prev = revs[this.MANIFEST] || { rev: 0, hash: null };
    if (prev.hash === h) return false;               // lista inalterada → nada a fazer
    const rev = prev.rev + 1;
    const { error } = await CloudStore.client.from(this.TABLE)
      .upsert({ profile_id: id, section: this.MANIFEST, data: body, rev, updated_at: body.at }, { onConflict: 'profile_id,section' });
    if (error) throw error;
    revs[this.MANIFEST] = { rev, hash: h };
    /* Só some da nuvem o que foi apagado DE PROPÓSITO (passou por dropSection).
       Ausência local nunca apaga nada lá. */
    const sobra = remotas.filter(sec => apagadas.indexOf(sec) !== -1);
    if (sobra.length) {
      try {
        await CloudStore.client.from(this.TABLE).delete().eq('profile_id', id).in('section', sobra);
        sobra.forEach(sec => { delete revs[sec]; });
        this._saveDel(apagadas.filter(sec => sobra.indexOf(sec) === -1), id);
        console.info('[SectionSync] removidas da nuvem', sobra.length, 'seção(ões) excluída(s) de propósito');
      } catch (e) { console.warn('[SectionSync] limpeza de seções excluídas falhou', e); }
    }
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
      // Recupera, uma vez por perfil, o que ficou por enviar na sessão anterior.
      if (this._restoredFor !== ProfileManager.getActiveProfileId()) {
        this._restoredFor = ProfileManager.getActiveProfileId();
        this.restorePending();
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
      CloudStore.client.from(this.TABLE).select('section,data,rev,updated_at').eq('profile_id', id),
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
    // O manifesto manda: o que não está nele é resto de versão anterior e é descartado.
    const finalMap = {};
    manifesto.sections.forEach(s => { finalMap[s] = map[s]; });
    return { ok: true, map: finalMap, revs, manifesto, manifestoRev, extras: secoes.filter(s => manifesto.sections.indexOf(s) === -1) };
  },
  // Escreve o mapa no localStorage do perfil. Preserva o histórico de versões local
  // (vhist) — ao contrário do restore do blob, que apagava tudo do namespace.
  _applyMap(id, map, revs, preservar, manifestoRev) {
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
      if (localStorage.getItem(prefix + sec) !== txt) { localStorage.setItem(prefix + sec, txt); mudou++; }
      novoRev[sec] = { rev: (revs && revs[sec]) || 1, hash: this._hash(txt) };
    });
    /* A REVISÃO DO MANIFESTO precisa ser guardada como a de qualquer outra seção.
       Ela não era — e como hasRemoteUpdates compara TODAS as linhas remotas com as
       locais, o manifesto (rev 7 na nuvem, 0 aqui) anunciava "tem novidade" para
       sempre. Cada foco na janela disparava um download e um location.reload():
       era exatamente a tela piscando e recarregando sozinha. */
    if (manifestoRev) novoRev[this.MANIFEST] = { rev: manifestoRev, hash: this._hash(Object.keys(map).sort().join('|')) };
    else if (antigos[this.MANIFEST]) novoRev[this.MANIFEST] = antigos[this.MANIFEST];
    // Alinha a contabilidade local com o que acabou de vir: sem isto, a próxima
    // rodada acharia tudo "sujo" e re-subiria o perfil inteiro sem necessidade.
    try { localStorage.setItem('diario-estudos:u:' + id + ':__secrev', JSON.stringify(novoRev)); } catch (_) { _quiet(_); }
    this._seededProfile = id;
    this._dirty.clear();
    manter.forEach(s => this._dirty.add(s));
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
      if (!this.readEnabled && !opts.force) { res.motivo = 'leitura-por-seção-desligada'; return this._saveLast(res); }
      if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn()) { res.motivo = 'sem-conexão'; return this._saveLast(res); }
      /* ANTES de ler: entrega o que este aparelho ainda não enviou. O que não
         conseguir subir volta como `preservar` e sai ileso do download — é o que
         garante que uma alteração feita offline (ou com a sessão em outro
         aparelho) não seja apagada pela cópia mais velha da nuvem. */
      const preservar = await this.flushBeforeRead(id);
      const rows = await this.fetchAllSections(id);
      const prep = this._prepare(rows);
      if (!prep.ok) { res.motivo = prep.motivo; return this._saveLast(res); }
      // Rede de segurança antes de sobrescrever o estado local.
      try { if (window.VersionHistory && ProfileManager.getActiveProfileId() === id) await VersionHistory.snapshot('antes de baixar por seção'); } catch (_) { _quiet(_); }
      res.mudou = this._applyMap(id, prep.map, prep.revs, preservar, prep.manifestoRev);
      res.ok = true; res.seções = Object.keys(prep.map).length;
      if (preservar.length) res.preservadas = preservar;   // ficaram com o valor local, ainda na fila
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
  /* Baixa por seção e recarrega a tela — MAS SÓ SE ALGO MUDOU DE VERDADE.
     Antes recarregava sempre que a checagem dissesse "pode haver novidade", e
     bastava um falso positivo para a tela reiniciar do nada no meio do uso. */
  async pullAndReload() {
    const id = ProfileManager.getActiveProfileId(); if (!id) return false;
    CloudStore._applying = true;
    const r = await this.hydrate(id);
    CloudStore._applying = false;
    if (!r.ok) return false;
    if (!r.mudou) { console.info('[SectionSync] nuvem conferida: nada mudou, sem recarregar'); return true; }
    showToast('Sincronizado da nuvem ✓');
    recarregarApp('dados novos da nuvem');
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
      naCaixaDeSaída: this.pendingSections(),   // inclui o que sobreviveu a recarregamentos
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
// e o hook do DB.delRaw: apagar sai da fila e viaja pelo manifesto
_sectionDropHook = function (key) { try { SectionSync.dropSection(key); } catch (_) { _quiet(_); } };
// Recupera na abertura o que ficou por enviar (antes de qualquer leitura da nuvem).
try { SectionSync.restorePending(); } catch (_) { _quiet(_); }
