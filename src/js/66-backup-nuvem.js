/* ═══════════════════ BACKUP NO BANCO DE DADOS ══════════════════════════════
   O que existia antes, e por que não bastava.

   O app tinha três redes de segurança, e as três moram NO APARELHO:
     · a Lixeira (30 dias) — o que foi apagado;
     · o Histórico de versões (7 dias, até 24 fotos) — o estado inteiro;
     · a tela de Recuperação — o vasculhador.

   Todas resolvem o mesmo tipo de acidente: um erro que aconteceu AQUI e que
   dá para desfazer AQUI. Nenhuma delas sobrevive a trocar de celular, formatar
   o computador, limpar os dados do navegador ou simplesmente abrir o app pela
   primeira vez num aparelho novo. E o banco de dados guardava só o ESTADO
   ATUAL: a linha do perfil é sobrescrita a cada salvamento, as seções idem.
   Quer dizer: no lugar mais durável de todos, não havia como voltar atrás.

   Este módulo fecha esse buraco. Uma tabela `profile_backups` guarda FOTOS
   IMUTÁVEIS do perfil — comprimidas com gzip, uma linha por foto, nunca
   sobrescritas. Elas são resgatáveis de qualquer aparelho, com a conta e nada
   mais. As regras foram escolhidas para que a resposta a "e se eu perder
   tudo?" seja sempre a mesma: não perde.

     · UMA ÂNCORA PERMANENTE. A primeira foto de cada perfil é marcada
       `ancora` e NUNCA é apagada pela faxina, tenha a idade que tiver. É o
       chão: por pior que fique, existe um ponto de retorno.
     · FOTO DIÁRIA automática, na primeira abertura de cada dia.
     · FOTO ANTES DE ENCOLHER. Se o que vai subir é bem menor que o que subiu
       da última vez, o estado anterior é fotografado antes. É a defesa contra
       o apagamento acidental que se propaga para todos os aparelhos.
     · FOTO ANTES DE ESVAZIAR uma seção que tinha conteúdo.
     · A FAXINA NUNCA DESCE DE `MIN_KEEP`, nunca toca na âncora e nunca apaga
       nada com menos de 24 h. Um bug na faxina não pode virar perda de dados.

   Se a tabela ainda não existir no Supabase, o módulo se desliga sozinho e
   avisa no console — o app inteiro continua funcionando como antes. O SQL para
   criá-la está em BANCO-DE-DADOS.md.
   ═══════════════════════════════════════════════════════════════════════════ */
const CloudBackup = {
  TABLE: 'profile_backups',
  enabled: true,            // vira false se a tabela não existir
  MAX: 14,                  // fotos "rolantes" mantidas por perfil (além da âncora)
  MIN_KEEP: 5,              // a faxina nunca deixa menos que isto
  IDADE_MINIMA_MS: 24 * 3600 * 1000,   // nada recém-criado é apagado pela faxina
  FRESCO_MS: 15 * 60 * 1000,           // uma foto com menos que isto já serve de proteção
  LIMITE_CHARS: 6 * 1024 * 1024,       // teto do texto comprimido enviado numa foto

  _avisouSemTabela: false,
  _ultimoSig: {},           // perfil → assinatura da última foto criada nesta sessão
  _ultimoEm: {},            // perfil → quando a última foto foi criada nesta sessão
  _criando: false,
  _ultimoErro: null,

  _diaKey(id) { return 'diario-estudos:cbk-dia:' + id; },
  _isMissingTable(err) {
    const m = ((err && (err.message || err.code || err.details)) || '').toString().toLowerCase();
    return m.includes(this.TABLE) || m.includes('does not exist') || m.includes('42p01') ||
           m.includes('could not find the table') || m.includes('schema cache');
  },
  _disable(err) {
    this.enabled = false;
    if (!this._avisouSemTabela) {
      this._avisouSemTabela = true;
      console.warn('[CloudBackup] tabela ' + this.TABLE + ' ausente — o backup NO BANCO está desligado. ' +
        'O histórico de versões local continua funcionando. Rode o SQL de BANCO-DE-DADOS.md para ativar. Detalhe:',
        err && (err.message || err));
    }
  },
  _pronto() {
    if (!this.enabled) return false;
    const CS = window.CloudStore;
    return !!(CS && CS.isReady() && CS.isLoggedIn());
  },
  _device() { try { return SessionGuard.deviceLabel(); } catch (_) { return 'Dispositivo'; } },

  /* ── CRIAR UMA FOTO ───────────────────────────────────────────────────────
     A compressão e a assinatura são as MESMAS do histórico local (reuso
     deliberado: um formato só para as duas redes, e uma foto da nuvem abre no
     leitor local sem conversão nenhuma). */
  async criar(nota, opts) {
    opts = opts || {};
    if (!this._pronto()) return { ok: false, motivo: 'sem-conexão' };
    if (this._criando && !opts.forcar) return { ok: false, motivo: 'já-em-andamento' };
    const id = ProfileManager.getActiveProfileId();
    if (!id) return { ok: false, motivo: 'sem-perfil' };
    const backup = ProfileManager.exportProfile(id);
    /* Nunca fotografamos o vazio. Guardar uma foto sem conteúdo seria pior que
       não guardar: ela empurraria uma foto BOA para fora da faxina. */
    if (!backup || !backup.data || !Object.keys(backup.data).some(k => !valorVazio(backup.data[k]))) {
      return { ok: false, motivo: 'perfil-vazio' };
    }
    const json = JSON.stringify(backup.data);
    const sig = VersionHistory._fnv(json);
    if (!opts.forcar && this._ultimoSig[id] === sig) return { ok: true, repetido: true };
    this._criando = true;
    try {
      const packed = await VersionHistory._gzip(json);
      if (String(packed.data).length > this.LIMITE_CHARS) {
        console.warn('[CloudBackup] foto grande demais para enviar (' + String(packed.data).length + ' chars) — pulada.');
        return { ok: false, motivo: 'grande-demais' };
      }
      // A primeira foto de cada perfil vira a ÂNCORA permanente.
      let ancora = false;
      try { ancora = !(await this._temAncora(id)); } catch (e) { _quiet(e, 'cbk-ancora'); }
      const linha = {
        user_id: CloudStore.session.user.id,
        profile_id: id,
        note: String(nota || 'backup'),
        device: this._device(),
        ancora,
        enc: packed.enc,
        chars: json.length,
        sig,
        data: String(packed.data)
      };
      const { error } = await CloudStore.client.from(this.TABLE).insert(linha);
      if (error) throw error;
      this._ultimoSig[id] = sig;
      this._ultimoEm[id] = Date.now();
      this._ultimoErro = null;
      console.info('[CloudBackup] foto gravada no banco' + (ancora ? ' (ÂNCORA permanente)' : '') + ': ' + linha.note);
      this.faxina(id);   // best-effort, não bloqueia
      return { ok: true, ancora, chars: json.length };
    } catch (err) {
      if (this._isMissingTable(err)) { this._disable(err); return { ok: false, motivo: 'tabela-ausente' }; }
      this._ultimoErro = (err && (err.message || err.code)) || 'erro';
      console.warn('[CloudBackup] não foi possível gravar a foto:', this._ultimoErro);
      return { ok: false, motivo: this._ultimoErro };
    } finally {
      this._criando = false;
    }
  },

  /* Fotografa um mapa de dados QUALQUER (não o estado atual). É o que permite
     preservar o que está NA NUVEM antes de sobrescrevê-lo — o estado que
     estamos protegendo pode nem existir mais neste aparelho. */
  async criarDeDados(id, dataObj, nota) {
    if (!this._pronto() || !id) return { ok: false, motivo: 'sem-conexão' };
    if (!dataObj || !Object.keys(dataObj).some(k => !valorVazio(dataObj[k]))) return { ok: false, motivo: 'vazio' };
    try {
      const json = JSON.stringify(dataObj);
      const sig = VersionHistory._fnv(json);
      if (this._ultimoSig[id] === sig) return { ok: true, repetido: true };
      const packed = await VersionHistory._gzip(json);
      if (String(packed.data).length > this.LIMITE_CHARS) return { ok: false, motivo: 'grande-demais' };
      let ancora = false;
      try { ancora = !(await this._temAncora(id)); } catch (e) { _quiet(e, 'cbk-ancora2'); }
      const { error } = await CloudStore.client.from(this.TABLE).insert({
        user_id: CloudStore.session.user.id, profile_id: id, note: String(nota || 'backup'),
        device: this._device(), ancora, enc: packed.enc, chars: json.length, sig, data: String(packed.data)
      });
      if (error) throw error;
      this._ultimoSig[id] = sig;
      this._ultimoEm[id] = Date.now();
      console.info('[CloudBackup] foto do estado REMOTO gravada: ' + nota);
      return { ok: true, ancora };
    } catch (err) {
      if (this._isMissingTable(err)) { this._disable(err); return { ok: false, motivo: 'tabela-ausente' }; }
      console.warn('[CloudBackup] falha ao fotografar o estado remoto:', err && (err.message || err));
      return { ok: false, motivo: (err && (err.message || err.code)) || 'erro' };
    }
  },

  async _temAncora(id) {
    const { data, error } = await CloudStore.client.from(this.TABLE)
      .select('id').eq('profile_id', id).eq('ancora', true).limit(1);
    if (error) throw error;
    return !!(data && data.length);
  },

  /* ── LISTAR / LER / RESTAURAR ─────────────────────────────────────────────
     A listagem NÃO traz a coluna `data`: são megabytes que ninguém precisa
     para escolher uma foto. O conteúdo só desce quando alguém abre uma. */
  async listar(id) {
    if (!this._pronto()) return [];
    const alvo = id || ProfileManager.getActiveProfileId();
    if (!alvo) return [];
    try {
      const { data, error } = await CloudStore._withTimeout(
        CloudStore.client.from(this.TABLE)
          .select('id,created_at,note,device,chars,sig,ancora,enc')
          .eq('profile_id', alvo).order('created_at', { ascending: false }).limit(60),
        15000, 'Listar os backups da nuvem');
      if (error) throw error;
      return data || [];
    } catch (err) {
      if (this._isMissingTable(err)) { this._disable(err); return []; }
      console.warn('[CloudBackup] não deu para listar:', err && (err.message || err));
      return [];
    }
  },
  // Devolve o mapa seção→texto de uma foto (ou null).
  async abrir(rowId) {
    if (!this._pronto()) return null;
    try {
      const { data, error } = await CloudStore._withTimeout(
        CloudStore.client.from(this.TABLE).select('data,enc,note,created_at,chars').eq('id', rowId).maybeSingle(),
        30000, 'Baixar o backup');
      if (error) throw error;
      if (!data) return null;
      const json = await VersionHistory._gunzip({ enc: data.enc, data: data.data });
      if (json == null) return null;
      let mapa; try { mapa = JSON.parse(json); } catch (_) { return null; }
      return { data: mapa, note: data.note, created_at: data.created_at, chars: data.chars };
    } catch (err) {
      if (this._isMissingTable(err)) { this._disable(err); return null; }
      console.warn('[CloudBackup] não deu para abrir a foto:', err && (err.message || err));
      return null;
    }
  },
  // Arquivo .json no mesmo formato do backup exportado pela tela de perfis.
  async construirArquivo(rowId) {
    const foto = await this.abrir(rowId);
    if (!foto) return null;
    const id = ProfileManager.getActiveProfileId();
    const meta = (ProfileManager.getProfiles().find(p => p.id === id) || {});
    return {
      app: 'diario-estudos', kind: 'profile-backup', version: 1,
      exportedAt: foto.created_at || new Date().toISOString(),
      profile: { nome: meta.nome, avatar: meta.avatar, cor: meta.cor },
      data: foto.data
    };
  },
  /* Restaura a foto SOBRE o perfil ativo. Duas garantias antes de qualquer
     escrita: uma foto local do estado de agora (dá para voltar atrás) e uma
     foto na nuvem do mesmo estado (dá para voltar atrás de outro aparelho). */
  async restaurar(rowId) {
    const id = ProfileManager.getActiveProfileId();
    if (!id) return { ok: false, motivo: 'sem-perfil' };
    const foto = await this.abrir(rowId);
    if (!foto || !foto.data) return { ok: false, motivo: 'foto-ilegível' };
    try { await VersionHistory.snapshot('antes de restaurar um backup da nuvem'); } catch (e) { _quiet(e, 'cbk-vh'); }
    try { await this.criar('antes de restaurar um backup da nuvem', { forcar: true }); } catch (e) { _quiet(e, 'cbk-pre'); }
    try {
      CloudStore._applying = true;
      ProfileManager.restorePayloadInto(id, foto.data);
      CloudStore._applying = false;
    } catch (e) {
      CloudStore._applying = false;
      console.error('[CloudBackup] restauração falhou', e);
      return { ok: false, motivo: 'falha-ao-aplicar' };
    }
    /* O que foi restaurado precisa SUBIR: sem isto o aparelho ficaria com o
       estado bom e a nuvem com o ruim, e o próximo download desfaria tudo. */
    try {
      if (window.SectionSync) { SectionSync._seededProfile = null; SectionSync.markAllDirty(); }
      CloudStore._pending = true;
      CloudStore._forceBlob = true;
    } catch (e) { _quiet(e, 'cbk-fila'); }
    return { ok: true, secoes: Object.keys(foto.data).length };
  },

  /* ── FAXINA — a única parte que apaga, e a mais desconfiada de todas ──────
     Três travas, e todas têm de passar para uma linha sair:
       1. a âncora nunca sai;
       2. nada com menos de 24 h sai (uma sequência de fotos hoje não pode
          empurrar para fora a última foto boa de ontem);
       3. o total nunca desce abaixo de MIN_KEEP.
     Se qualquer coisa der errado no meio, o efeito é guardar fotos DEMAIS —
     que é o lado certo de errar. */
  /* A ESCOLHA é pura e testável; só o DELETE é que fala com o banco. Quem
     apaga dado tem de poder ser interrogado por um teste. */
  selecionarParaFaxina(linhas, agora) {
    const lista = (linhas || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (lista.length <= Math.max(this.MIN_KEEP, this.MAX)) return [];
    const rolantes = lista.filter(r => !r.ancora);        // 1. a âncora nunca entra
    const candidatas = rolantes.slice(this.MAX)           // 2. só o que passa do teto
      .filter(r => (agora - new Date(r.created_at).getTime()) > this.IDADE_MINIMA_MS);  // 3. nada novo
    if (!candidatas.length) return [];
    if (lista.length - candidatas.length < this.MIN_KEEP) return [];                    // 4. piso absoluto
    return candidatas;
  },
  async faxina(id) {
    if (!this._pronto()) return 0;
    const alvo = id || ProfileManager.getActiveProfileId();
    if (!alvo) return 0;
    try {
      const linhas = await this.listar(alvo);
      const apagar = this.selecionarParaFaxina(linhas, Date.now());
      if (!apagar.length) return 0;
      const restariam = linhas.length - apagar.length;
      const { error } = await CloudStore.client.from(this.TABLE).delete().in('id', apagar.map(r => r.id));
      if (error) throw error;
      console.info('[CloudBackup] faxina: ' + apagar.length + ' foto(s) antiga(s) removida(s); ' + restariam + ' mantida(s).');
      return apagar.length;
    } catch (err) {
      if (this._isMissingTable(err)) { this._disable(err); return 0; }
      console.warn('[CloudBackup] faxina falhou (nada foi apagado):', err && (err.message || err));
      return 0;
    }
  },

  /* ── GATILHOS AUTOMÁTICOS ─────────────────────────────────────────────────
     Uma foto por dia, na primeira abertura. O carimbo é local (uma leitura, sem
     rede); se ele se perder, o pior que acontece é uma foto a mais, e criar()
     descarta a duplicata pela assinatura. */
  async garantirDoDia() {
    if (!this._pronto()) return false;
    const id = ProfileManager.getActiveProfileId();
    if (!id) return false;
    let ultimo = null;
    try { ultimo = localStorage.getItem(this._diaKey(id)); } catch (e) { _quiet(e, 'cbk-dia'); }
    const hoje = todayLocal();
    if (ultimo === hoje) return false;
    const r = await this.criar('backup diário');
    if (r.ok || r.repetido) {
      try { localStorage.setItem(this._diaKey(id), hoje); } catch (e) { _quiet(e, 'cbk-dia2'); }
    }
    return !!r.ok;
  },
  // Garante que existe uma foto RECENTE antes de uma operação arriscada.
  async protegerAgora(motivo) {
    if (!this._pronto()) return false;
    const id = ProfileManager.getActiveProfileId();
    if (!id) return false;
    if ((Date.now() - (this._ultimoEm[id] || 0)) < this.FRESCO_MS) return true;  // já há foto fresca
    const r = await this.criar(motivo || 'antes de uma operação de risco');
    return !!(r.ok || r.repetido);
  },

  // Diagnóstico (console: CloudBackup.status())
  async status() {
    const id = ProfileManager.getActiveProfileId();
    const linhas = await this.listar(id);
    return {
      habilitado: this.enabled,
      tabela: this.TABLE,
      perfil: id,
      fotosNoBanco: linhas.length,
      ancora: linhas.filter(r => r.ancora).length,
      maisRecente: linhas.length ? new Date(linhas[0].created_at).toLocaleString('pt-BR') : null,
      maisAntiga: linhas.length ? new Date(linhas[linhas.length - 1].created_at).toLocaleString('pt-BR') : null,
      últimoErro: this._ultimoErro
    };
  }
};
window.CloudBackup = CloudBackup;

/* ═══════════════════ GUARDA DA NUVEM — as travas de escrita ════════════════
   Duas perguntas, feitas sempre ANTES de publicar:

     1. o que vai subir é MUITO menor que o que subiu da última vez?
     2. esta seção está indo VAZIA para o lugar de um conteúdo que existia?

   Em qualquer um dos casos a resposta não é impedir — apagar é um direito de
   quem digitou. É garantir que o estado anterior fique guardado no banco antes
   de deixar de existir. O usuário nunca é bloqueado; a cópia é que passa a
   existir sempre.

   Quando o backup no banco não está disponível (tabela ausente), a proteção
   cai para a foto LOCAL do histórico de versões — pior, mas nunca nenhuma. */
const GuardaNuvem = {
  TAM_KEY: 'diario-estudos:ult-envio:',
  LIMIAR: 0.6,          // abaixo de 60% do último envio, é "encolhimento grande"
  PISO_CHARS: 2000,     // perfis minúsculos não disparam a proteção (ruído puro)
  _ultimaProtecao: 0,
  INTERVALO_MS: 60000,  // no máximo uma proteção por minuto (evita rajada)

  _key(id) { return this.TAM_KEY + id; },
  ultimoTamanho(id) {
    try { return parseInt(localStorage.getItem(this._key(id)), 10) || 0; } catch (_) { return 0; }
  },
  registrarEnvio(id, chars) {
    try { localStorage.setItem(this._key(id), String(chars || 0)); } catch (e) { _quiet(e, 'guarda-tam'); }
  },
  /* Classificação PURA (sem rede, sem estado global): é ela que a suíte de
     autoteste exercita. Devolve o veredito e os números que o motivaram. */
  avaliarEncolhimento(anterior, atual) {
    const a = anterior || 0, b = atual || 0;
    if (a < this.PISO_CHARS) return { encolheu: false, motivo: 'perfil-pequeno', anterior: a, atual: b };
    if (b >= a) return { encolheu: false, motivo: 'não-encolheu', anterior: a, atual: b };
    const razao = b / a;
    return { encolheu: razao < this.LIMIAR, razao, anterior: a, atual: b,
             motivo: razao < this.LIMIAR ? 'encolhimento-grande' : 'variação-normal' };
  },
  async antesDeEncolher(id, charsAgora) {
    const v = this.avaliarEncolhimento(this.ultimoTamanho(id), charsAgora);
    if (!v.encolheu) return v;
    const pct = Math.round((1 - v.razao) * 100);
    console.warn('[GuardaNuvem] o perfil encolheu ' + pct + '% (' + v.anterior + ' → ' + v.atual + ' chars). Guardando o estado ANTERIOR antes de publicar.');
    await this._proteger(id, 'antes de uma redução de ' + pct + '% no perfil');
    return v;
  },
  async antesDeEsvaziar(id, secoes) {
    console.warn('[GuardaNuvem] esvaziando na nuvem: ' + secoes.join(', ') + ' — guardando o estado ANTERIOR antes.');
    await this._proteger(id, 'antes de esvaziar ' + secoes.length + ' seção(ões): ' + secoes.slice(0, 3).join(', '));
  },

  /* ── QUAL ESTADO PRECISA SER GUARDADO ─────────────────────────────────────
     A armadilha desta trava é fotografar a coisa errada. Quando ela dispara, o
     apagamento JÁ ACONTECEU aqui: o localStorage deste aparelho já está com o
     perfil reduzido, e o que estamos prestes a fazer é propagar isso. Uma foto
     do estado ATUAL — local ou na nuvem — registraria justamente o estrago, e
     seria um backup que não devolve nada.

     O que precisa ser guardado é o que o envio vai SUBSTITUIR:

       1. o payload que está na nuvem neste instante. É a definição exata do
          que deixará de existir daqui a um segundo;
       2. se a nuvem não responder, a foto local mais recente do histórico de
          versões — ela é de no máximo 20 minutos atrás, e portanto anterior ao
          apagamento.

     Se as duas falharem, nada é publicado como backup e o console diz por quê.
     O envio em si continua: travar a sincronização por não conseguir fazer um
     backup criaria um segundo problema em vez de resolver o primeiro — e o
     conteúdo apagado continua na Lixeira e no histórico local deste aparelho. */
  async _estadoAnterior(id) {
    const util = (d) => !!(d && typeof d === 'object' && Object.keys(d).some(k => !valorVazio(d[k])));
    try {
      const res = await CloudStore.fetchPayload(id);
      const d = res && res.payload && res.payload.data;
      if (util(d)) return d;
    } catch (e) { _quiet(e, 'guarda-remoto'); }
    try {
      const fotos = VersionHistory._list(id) || [];
      for (let i = fotos.length - 1; i >= 0; i--) {
        const json = await VersionHistory._gunzip(fotos[i]);
        if (!json) continue;
        let d = null; try { d = JSON.parse(json); } catch (e) { _quiet(e, 'guarda-foto'); continue; }
        if (util(d)) return d;
      }
    } catch (e) { _quiet(e, 'guarda-local'); }
    return null;
  },
  async _proteger(id, nota) {
    if (Date.now() - this._ultimaProtecao < this.INTERVALO_MS) return false;
    this._ultimaProtecao = Date.now();
    try {
      const anterior = await this._estadoAnterior(id);
      if (!anterior) {
        console.warn('[GuardaNuvem] não foi possível recuperar o estado anterior para fotografar — o envio segue, e o conteúdo continua na Lixeira e no histórico deste aparelho.');
        return false;
      }
      const r = await CloudBackup.criarDeDados(id, anterior, nota);
      return !!r.ok;
    } catch (e) { _quiet(e, 'guarda-proteger'); return false; }
  }
};
window.GuardaNuvem = GuardaNuvem;

/* Gatilho de abertura: a foto diária sai um pouco depois de o perfil abrir, sem
   competir com a primeira sincronização. */
(function () {
  let feito = false;
  const tentar = () => {
    if (feito) return;
    try {
      if (!window.CloudBackup || !CloudBackup._pronto()) return;
      if (!ProfileManager.getActiveProfileId()) return;
      if (!sessionStorage.getItem('diario-estudos:entered')) return;
    } catch (e) { _quiet(e, 'cbk-gatilho'); return; }
    feito = true;
    CloudBackup.garantirDoDia();
  };
  setTimeout(tentar, 9000);
  setInterval(tentar, 60000);
})();

/* ── A TELA (Configurações → Dados) ────────────────────────────────────────
   O mesmo desenho do histórico local, de propósito: quem já sabe usar um sabe
   usar o outro. A diferença que importa está escrita em uma linha no topo —
   estas cópias NÃO dependem deste aparelho. */
const CloudBackupUI = {
  _quando(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },
  _kb(chars) { return chars < 1024 ? chars + ' B' : (chars < 1048576 ? Math.round(chars / 1024) + ' KB' : (chars / 1048576).toFixed(1) + ' MB'); },

  async render() {
    const host = document.getElementById('cfg-cloudbk-body');
    if (!host) return;
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) {
      host.innerHTML = '<p class="hint">Entre na sua conta (menu de sincronização, no rodapé) para que as cópias de segurança também fiquem guardadas no banco de dados — fora deste aparelho.</p>';
      return;
    }
    host.innerHTML = '<p class="hint">Consultando o banco…</p>';
    const linhas = await CloudBackup.listar();
    if (!CloudBackup.enabled) {
      host.innerHTML = '<p class="hint">⚠️ A tabela <code>profile_backups</code> ainda não existe no banco. As cópias continuam sendo guardadas <strong>neste aparelho</strong> (histórico de versões acima), mas ainda não no servidor. O SQL para criá-la está em <code>BANCO-DE-DADOS.md</code>, no repositório do app — é uma execução única, de menos de um minuto.</p>';
      return;
    }
    if (!linhas.length) {
      host.innerHTML = '<p class="hint">Nenhuma cópia no banco ainda. A primeira é criada sozinha na próxima abertura do dia — ou agora, no botão acima. A primeira de todas vira uma <strong>âncora permanente</strong>, que a limpeza automática nunca remove.</p>';
      return;
    }
    const ancoras = linhas.filter(r => r.ancora).length;
    host.innerHTML =
      '<p class="hint" style="margin:0 0 10px;">' + linhas.length + ' cópia(s) guardada(s) <strong>no banco de dados</strong>' +
      (ancoras ? ' — uma delas é a <strong>âncora permanente</strong>, que nunca é apagada' : '') +
      '. Elas não dependem deste navegador: trocando de aparelho, basta entrar na conta para resgatá-las.</p>' +
      linhas.map(r => {
        const tag = r.ancora
          ? '<span class="inactive-tag" style="color:var(--good-text);background:var(--good-soft);border-color:transparent;">âncora permanente</span>' : '';
        return `<div class="cloud-slot-row" data-bk="${escapeHtml(String(r.id))}">
          <div class="cloud-slot-info">
            <div class="name">${this._quando(r.created_at)} ${tag}</div>
            <div class="meta">${escapeHtml(r.note || 'backup')} · ${this._kb(r.chars || 0)}${r.device ? ' · ' + escapeHtml(r.device) : ''}</div>
          </div>
          <div class="cloud-slot-actions">
            <button type="button" class="btn-secondary cbk-download" title="Baixar esta cópia como arquivo .json">↓ Baixar</button>
            <button type="button" class="btn-primary cbk-restore" title="Restaurar esta cópia sobre o perfil atual">↺ Restaurar</button>
          </div>
        </div>`;
      }).join('');
    this._ligar(host);
  },

  _ligar(host) {
    host.querySelectorAll('.cbk-download').forEach(b => b.addEventListener('click', async () => {
      const rid = b.closest('[data-bk]').dataset.bk;
      showToast('Baixando do banco…');
      const arq = await CloudBackup.construirArquivo(rid);
      if (!arq) { showToast('Não foi possível ler esta cópia'); return; }
      const meta = ProfileManager.getProfiles().find(p => p.id === ProfileManager.getActiveProfileId()) || {};
      const nome = 'backup-nuvem-' + (meta.nome || 'perfil').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' +
        String(arq.exportedAt).slice(0, 10) + '.json';
      CardsScreen._download(nome, JSON.stringify(arq, null, 2), 'application/json');
      showToast('Cópia baixada ✓');
    }));
    host.querySelectorAll('.cbk-restore').forEach(b => b.addEventListener('click', async () => {
      const rid = b.closest('[data-bk]').dataset.bk;
      const ok = await UI.confirm(
        'Restaurar esta cópia sobre o perfil atual?\n\nAntes de qualquer coisa o app guarda o estado de agora — neste aparelho e também no banco —, então dá para voltar atrás. Depois de restaurar, o app recarrega e envia o resultado para a nuvem.',
        { title: '↺ Restaurar do banco', okText: 'Restaurar' });
      if (!ok) return;
      showToast('Restaurando…');
      const r = await CloudBackup.restaurar(rid);
      if (!r.ok) { showToast('Não foi possível restaurar: ' + (r.motivo || '')); return; }
      showToast(r.secoes + ' seção(ões) restaurada(s) ✓ — enviando e recarregando');
      try { await CloudStore.flushPending(); } catch (e) { _quiet(e, 'cbk-flush'); }
      setTimeout(() => recarregarApp('backup da nuvem restaurado', { imediato: true }), 700);
    }));
  }
};
window.CloudBackupUI = CloudBackupUI;

(function () {
  const b = document.getElementById('cfg-cloudbk-save');
  if (b) b.addEventListener('click', async () => {
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) { showToast('Entre na sua conta para guardar a cópia no banco.'); return; }
    showToast('Guardando no banco…');
    const r = await CloudBackup.criar('salvo manualmente', { forcar: true });
    if (r.ok) showToast('Cópia guardada no banco ✓');
    else if (r.motivo === 'tabela-ausente') showToast('A tabela de backups ainda não existe no banco — veja BANCO-DE-DADOS.md.');
    else if (r.motivo === 'perfil-vazio') showToast('Este perfil ainda não tem dados para guardar.');
    else showToast('Não foi possível guardar agora: ' + (r.motivo || ''));
    CloudBackupUI.render();
  });
  window.addEventListener('screen:activated', (e) => {
    if (e.detail && e.detail.screen === 'config') CloudBackupUI.render();
  });
})();
