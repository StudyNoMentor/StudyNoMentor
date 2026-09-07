/* ============================================================
   VERSION HISTORY — histórico de versões (rede de segurança "A")
   ------------------------------------------------------------
   Guarda no próprio dispositivo as últimas versões do perfil, para você
   RESTAURAR caso algo se perca (apagou algo sem querer, ou um aparelho
   sobrescreveu o outro). Cada snapshot é COMPRIMIDO com gzip (CompressionStream),
   ficando ~5-10x menor — cabe com folga mesmo em perfis grandes.
   Gatilhos: antes de baixar da nuvem (cobre o clobber, por dispositivo),
   um backup automático por dia, e manual pelo botão em Configurações.
   100% no cliente, reversível, e não exige nada do Supabase.
   ============================================================ */
/* ═══════════════════ HISTORICO DE VERSOES (rede de seguranca) ═══════════════
   Antes: 1 foto por dia, 8 no total. Quem apagasse algo por engano de manha e
   percebesse a tarde so tinha a foto da meia-noite — perdia o dia inteiro de
   trabalho. Agora as fotos sao FREQUENTES (a cada 20 min de uso, e sempre que
   uma acao destrutiva acontece) e a lista se AUTOLIMPA:

     • JANELA de 7 dias — nada mais velho que isso e mantido; um backup de duas
       semanas atras nao ajuda e ocupa espaco.
     • PISO de 3 versoes — mesmo depois de 7 dias parado, voce sempre volta as
       tres ultimas fotos. A limpeza nunca deixa o usuario sem rede.
     • ORCAMENTO de espaco — o conjunto nunca passa de ~3 MB (ja comprimido em
       gzip). Estourou, as mais antigas saem primeiro.
   O resultado e uma protecao continua que nao cresce sem limite.
   ═══════════════════════════════════════════════════════════════════════════ */
const VersionHistory = {
  MAX: 24,                       // teto de fotos guardadas
  MIN_KEEP: 3,                   // nunca limpa abaixo disto, custe o que custar
  MAX_AGE_MS: 7 * 24 * 3600 * 1000,   // janela de 7 dias
  MAX_BYTES: 3 * 1024 * 1024,    // orcamento total (~3 MB comprimidos)
  AUTO_EVERY_MS: 20 * 60 * 1000, // foto automatica a cada 20 min de uso
  _key(id) { return 'diario-estudos:vhist:' + id; },
  _dayKey(id) { return 'diario-estudos:vhist-day:' + id; },
  _autoKey(id) { return 'diario-estudos:vhist-auto:' + id; },
  _list(id) { try { return JSON.parse(localStorage.getItem(this._key(id))) || []; } catch (_) { return []; } },

  /* Autolimpeza: idade > orcamento > teto, sempre respeitando MIN_KEEP.
     Roda antes de cada gravacao, entao a lista nunca "engorda calada". */
  _prune(arr) {
    if (!Array.isArray(arr)) return [];
    const agora = Date.now();
    // 1) idade — descarta o que passou da janela, preservando o piso
    let out = arr.filter(r => (agora - (r.ts || 0)) <= this.MAX_AGE_MS);
    if (out.length < this.MIN_KEEP) out = arr.slice(-this.MIN_KEEP);
    // 2) teto de quantidade
    while (out.length > this.MAX) out.shift();
    // 3) orcamento de espaco — as mais antigas saem primeiro
    const peso = (r) => ((r && r.data) ? String(r.data).length : 0) * 2; // UTF-16
    let total = out.reduce((a, r) => a + peso(r), 0);
    while (total > this.MAX_BYTES && out.length > this.MIN_KEEP) {
      total -= peso(out[0]);
      out.shift();
    }
    return out;
  },

  _save(id, arr) {
    arr = this._prune(arr);
    while (true) {
      try { localStorage.setItem(this._key(id), JSON.stringify(arr)); return true; }
      catch (e) { if (arr.length > 1) { arr.shift(); continue; } try { localStorage.removeItem(this._key(id)); } catch (_) { _quiet(_); } return false; }
    }
  },
  _b64enc(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); },
  _b64dec(b64) { const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; },
  _fnv(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); },
  async _gzip(str) {
    try {
      if (typeof CompressionStream === 'undefined') return { enc: 'raw', data: str };
      const cs = new CompressionStream('gzip');
      const ab = await new Response(new Blob([str]).stream().pipeThrough(cs)).arrayBuffer();
      return { enc: 'gz', data: this._b64enc(new Uint8Array(ab)) };
    } catch (_) { return { enc: 'raw', data: str }; }
  },
  async _gunzip(rec) {
    if (!rec) return null;
    if (rec.enc !== 'gz') return rec.data;
    try {
      const ds = new DecompressionStream('gzip');
      const ab = await new Response(new Blob([this._b64dec(rec.data)]).stream().pipeThrough(ds)).arrayBuffer();
      return new TextDecoder().decode(ab);
    } catch (_) { return null; }
  },
  // Cria uma versão do perfil ATIVO. Não duplica se for idêntica à última.
  async snapshot(note) {
    try {
      const id = ProfileManager.getActiveProfileId(); if (!id) return false;
      const backup = ProfileManager.exportProfile(id); if (!backup) return false;
      const json = JSON.stringify(backup.data || {});
      if (json === '{}' || json.length < 3) return false;
      const sig = this._fnv(json);
      const arr = this._list(id);
      if (arr.length && arr[arr.length - 1].sig === sig) return false;
      const packed = await this._gzip(json);
      arr.push({ ts: Date.now(), rev: ProfileManager.getRev(id), note: note || '', sig, enc: packed.enc, data: packed.data, chars: json.length });
      while (arr.length > this.MAX) arr.shift();
      this._save(id, arr);
      return true;
    } catch (_) { return false; }
  },
  maybeDailySnapshot() {
    try {
      const id = ProfileManager.getActiveProfileId(); if (!id) return;
      let last = null; try { last = localStorage.getItem(this._dayKey(id)); } catch (_) { _quiet(_); }
      const hoje = todayLocal();
      if (last !== hoje) {
        try { localStorage.setItem(this._dayKey(id), hoje); } catch (_) { _quiet(_); }
        this.snapshot('backup diário');
        return;
      }
      this.maybeAutoSnapshot();
    } catch (_) { _quiet(_); }
  },

  /* Foto periodica durante o uso. E o que transforma a rede de seguranca de
     "uma vez por dia" em "sempre por perto": no maximo 20 min de trabalho entre
     uma foto e outra. snapshot() ja ignora estados identicos, entao ficar com o
     app aberto sem mexer em nada NAO gera copias repetidas. */
  maybeAutoSnapshot() {
    try {
      const id = ProfileManager.getActiveProfileId(); if (!id) return false;
      let last = 0; try { last = parseInt(localStorage.getItem(this._autoKey(id)), 10) || 0; } catch (_) { _quiet(_); }
      if (Date.now() - last < this.AUTO_EVERY_MS) return false;
      try { localStorage.setItem(this._autoKey(id), String(Date.now())); } catch (_) { _quiet(_); }
      this.snapshot('cópia automática');
      return true;
    } catch (_) { return false; }
  },

  /* Foto AGORA, antes de uma acao destrutiva (limpar grade, excluir semana,
     apagar planejamento). E o backup que salva o dia — literalmente o caso de
     "limpei a grade sem querer". Nao espera intervalo nenhum. */
  async antesDe(acao) {
    try { return await this.snapshot('antes de ' + acao); } catch (_) { return false; }
  },

  // Faxina avulsa (chamada na abertura do app): aplica a janela de 7 dias.
  limpar() {
    try {
      const id = ProfileManager.getActiveProfileId(); if (!id) return;
      const arr = this._list(id);
      const limpo = this._prune(arr.slice());
      if (limpo.length !== arr.length) this._save(id, limpo);
    } catch (_) { _quiet(_); }
  },
  async buildBackup(id, ts) {
    const rec = this._list(id).find(r => r.ts === ts);
    if (!rec) return null;
    const json = await this._gunzip(rec);
    if (json == null) return null;
    let data; try { data = JSON.parse(json); } catch (_) { return null; }
    const meta = ProfileManager.getProfiles().find(p => p.id === id) || {};
    return { app: 'diario-estudos', kind: 'profile-backup', version: 1, exportedAt: new Date(rec.ts).toISOString(),
      profile: { nome: meta.nome, avatar: meta.avatar, cor: meta.cor }, data };
  },
  // Restaura uma versão SOBRE o perfil ativo (guarda o estado atual antes, então é reversível).
  async restore(id, ts) {
    const rec = this._list(id).find(r => r.ts === ts);
    if (!rec) return false;
    const json = await this._gunzip(rec);
    if (json == null) return false;
    let data; try { data = JSON.parse(json); } catch (_) { return false; }
    await this.snapshot('antes de restaurar uma versão');
    try {
      if (window.CloudStore) CloudStore._applying = true;
      ProfileManager.restorePayloadInto(id, data);
      if (window.CloudStore) { CloudStore._applying = false; CloudStore._pending = true; }
    } catch (_) { if (window.CloudStore) CloudStore._applying = false; return false; }
    return true;
  }
};
window.VersionHistory = VersionHistory;
