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
       chão: por pior que fique, existe um ponto de retorno. A decisão de
       quem vira âncora é ARBITRADA PELO BANCO (índice único parcial em
       BANCO-DE-DADOS.md) — não por um "cheguei primeiro" lido no cliente,
       que sob concorrência real (o gatilho diário e um clique manual quase
       ao mesmo tempo) produzia DUAS âncoras para o mesmo perfil.
     · UMA FILA POR PERFIL. `criar`/`criarDeDados` nunca escrevem em paralelo
       para o mesmo perfil — a segunda chamada espera a primeira terminar.
       Sem isto, duas gravações simultâneas podiam duplicar conteúdo e
       corromper a decisão da âncora acima delas.
     · FOTO DIÁRIA automática, na primeira abertura de cada dia.
     · FOTO ANTES DE ENCOLHER. Se o que vai subir é bem menor que o que subiu
       da última vez, o estado anterior é fotografado antes. É a defesa contra
       o apagamento acidental que se propaga para todos os aparelhos.
     · FOTO ANTES DE ESVAZIAR uma seção que tinha conteúdo.
     · RETENÇÃO EM FAIXAS (avô-pai-filho), a prática consolidada de quem faz
       backup a sério: uma foto por dia nos últimos 14 dias, uma por semana
       nas últimas 8, uma por mês nos últimos 12. Um ano de histórico em ~30
       linhas — e um estrago percebido só três semanas depois ainda tem para
       onde voltar. A faxina nunca desce de `MIN_KEEP`, nunca toca na âncora
       e nunca apaga nada com menos de 24 h: um bug nela não vira perda.
     · FALHA NUNCA É SILENCIOSA. Um perfil grande demais para uma foto, ou
       qualquer erro de gravação, fica registrado e visível no diagnóstico e
       na própria tela — "ativo" só aparece quando o último envio realmente
       deu certo.

   Se a tabela ainda não existir no Supabase, o módulo se desliga sozinho e
   avisa no console — o app inteiro continua funcionando como antes. O SQL para
   criá-la está em BANCO-DE-DADOS.md.
   ═══════════════════════════════════════════════════════════════════════════ */
const CloudBackup = {
  TABLE: 'profile_backups',
  enabled: true,            // vira false se a tabela não existir
  MIN_KEEP: 5,              // a faxina nunca deixa menos que isto
  IDADE_MINIMA_MS: 24 * 3600 * 1000,   // nada recém-criado é apagado pela faxina
  FRESCO_MS: 15 * 60 * 1000,           // uma foto com menos que isto já serve de proteção
  LIMITE_CHARS: 6 * 1024 * 1024,       // teto do texto comprimido enviado numa foto

  _avisouSemTabela: false,
  _filas: {},                // perfil → promessa em curso (serializa criar/criarDeDados)
  _ultimoEm: {},             // perfil → quando a última foto foi criada nesta sessão
  _ultimoErro: null,         // do último ENVIO REAL (não de "não havia nada a fazer")

  _diaKey(id) { return 'diario-estudos:cbk-dia:' + id; },
  /* Assinatura do último conteúdo publicado, por perfil. GRAVADA em disco (não
     só em memória): sem isto, um recarregamento — e o app recarrega sozinho
     depois de quase toda operação de risco, inclusive logo após restaurar um
     backup — esquecia a última assinatura e podia duplicar a MESMA foto que
     acabara de subir segundos antes. */
  _sigKey(id) { return 'diario-estudos:cbk-sig:' + id; },
  _lerUltimoSig(id) { try { return localStorage.getItem(this._sigKey(id)); } catch (_) { return null; } },
  _gravarUltimoSig(id, sig) { try { localStorage.setItem(this._sigKey(id), sig); } catch (e) { _quiet(e, 'cbk-sig'); } },
  /* Quando a última foto REALMENTE entrou no banco. Persistido porque é o que
     permite responder "o backup automático está mesmo funcionando?" sem pedir
     nada à rede — um app que promete proteção precisa PROVAR isso na tela, não
     só afirmar. Alimenta o diagnóstico e o cabeçalho da tela de backup. */
  _emKey(id) { return 'diario-estudos:cbk-em:' + id; },
  ultimoEnvioEm(id) {
    const alvo = id || (window.ProfileManager ? ProfileManager.getActiveProfileId() : null);
    if (!alvo) return 0;
    if (this._ultimoEm[alvo]) return this._ultimoEm[alvo];
    try { return parseInt(localStorage.getItem(this._emKey(alvo)), 10) || 0; } catch (_) { return 0; }
  },
  _marcarEnvio(id) {
    this._ultimoEm[id] = Date.now();
    try { localStorage.setItem(this._emKey(id), String(this._ultimoEm[id])); } catch (e) { _quiet(e, 'cbk-em'); }
  },

  _isMissingTable(err) {
    const m = ((err && (err.message || err.code || err.details)) || '').toString().toLowerCase();
    return m.includes(this.TABLE) || m.includes('does not exist') || m.includes('42p01') ||
           m.includes('could not find the table') || m.includes('schema cache');
  },
  // Violação do índice único parcial "uma âncora por perfil" (BANCO-DE-DADOS.md).
  // NÃO é uma falha: é a garantia de unicidade funcionando sob concorrência.
  _isUniqueViolation(err) {
    const code = err && err.code;
    const m = ((err && (err.message || err.details)) || '').toString().toLowerCase();
    return code === '23505' || m.includes('duplicate key') || m.includes('unique constraint');
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

  /* ── FILA POR PERFIL ───────────────────────────────────────────────────────
     `criar` e `criarDeDados` escrevem na mesma tabela para o mesmo perfil, e
     cada gravação decide sozinha "sou eu a âncora?". Sem serialização, duas
     chamadas simultâneas — o gatilho automático do dia batendo com um clique
     manual, ou a proteção de encolhimento disparando durante um envio — corriam
     essa decisão em paralelo. `forcar` (usado pelo botão manual e pelas
     proteções automáticas) pulava até a trava antiga de propósito — o que
     reabria exatamente essa corrida nos casos que mais precisavam da trava.

     Esta fila nunca REJEITA uma chamada (nenhum "já-em-andamento" que se perde
     — a versão antiga tinha isso, e `forcar` o ignorava, então na prática não
     protegia nada): ela só faz a segunda chamada esperar a primeira terminar
     antes de decidir qualquer coisa. */
  _serializar(id, fn) {
    const anterior = this._filas[id] || Promise.resolve();
    const atual = anterior.then(fn, fn);
    this._filas[id] = atual.catch(() => {});   // nunca trava a fila por uma falha
    return atual;
  },

  /* ── GRAVAR UMA LINHA + DECIDIR A ÂNCORA, COM O BANCO COMO ÁRBITRO ─────────
     A âncora não é mais decidida por "perguntei antes e não tinha nenhuma" —
     essa pergunta ainda é feita (é o caminho barato, acerta quase sempre), mas
     quem tem a palavra final é um ÍNDICE ÚNICO PARCIAL no banco: no máximo uma
     linha com `ancora = true` por perfil (ver BANCO-DE-DADOS.md). Se, apesar
     da checagem, duas gravações concorrentes tentarem virar âncora ao mesmo
     tempo, a SEGUNDA leva um erro de violação de unicidade — tratado aqui como
     sucesso normal (grava como foto rolante), não como falha. */
  async _inserirLinha({ id, nota, packed, chars, sig }) {
    const uid = (CloudStore.session && CloudStore.session.user) ? CloudStore.session.user.id : null;
    if (!uid) return { ok: false, motivo: 'sem-conexão' };
    const base = {
      user_id: uid, profile_id: id, note: String(nota || 'backup'),
      device: this._device(), enc: packed.enc, chars, sig, data: String(packed.data)
    };
    let tentaAncora = false;
    try { tentaAncora = !(await this._temAncora(id)); } catch (e) { _quiet(e, 'cbk-ancora'); }
    let { error } = await CloudStore.client.from(this.TABLE).insert({ ...base, ancora: tentaAncora });
    if (error && tentaAncora && this._isUniqueViolation(error)) {
      // outra foto venceu a corrida pela âncora nesse meio-tempo — normal
      tentaAncora = false;
      ({ error } = await CloudStore.client.from(this.TABLE).insert({ ...base, ancora: false }));
    }
    if (error) throw error;
    return { ok: true, ancora: tentaAncora };
  },
  async _temAncora(id) {
    const { data, error } = await CloudStore.client.from(this.TABLE)
      .select('id').eq('profile_id', id).eq('ancora', true).limit(1);
    if (error) throw error;
    return !!(data && data.length);
  },

  /* ── NÚCLEO COMUM DE PUBLICAÇÃO ────────────────────────────────────────────
     `criar()` (o estado atual do aparelho) e `criarDeDados()` (um mapa
     arbitrário — usado para proteger o estado que está NA NUVEM antes de
     sobrescrevê-lo) convergem aqui. Roda sempre DENTRO de `_serializar`. */
  async _publicar(id, dataObj, nota, opts) {
    opts = opts || {};
    if (!this._pronto()) return { ok: false, motivo: 'sem-conexão' };
    /* Nunca fotografamos o vazio. Guardar uma foto sem conteúdo seria pior que
       não guardar: ela empurraria uma foto BOA para fora da faxina. */
    if (!dataObj || !Object.keys(dataObj).some(k => !valorVazio(dataObj[k]))) {
      return { ok: false, motivo: 'perfil-vazio' };
    }
    const json = JSON.stringify(dataObj);
    const sig = VersionHistory._fnv(json);
    if (!opts.forcar && this._lerUltimoSig(id) === sig) return { ok: true, repetido: true };
    try {
      const packed = await VersionHistory._gzip(json);
      if (String(packed.data).length > this.LIMITE_CHARS) {
        /* Falha que ANTES era muda: nunca marcada em `_ultimoErro`, então o
           diagnóstico e a tela continuavam dizendo "ativo" enquanto o backup
           automático de um perfil grande falhava toda vez, silenciosamente. */
        this._ultimoErro = 'foto grande demais para o banco (' + String(packed.data).length + ' de ' + this.LIMITE_CHARS + ' caracteres). Backup em .json continua funcionando normalmente.';
        console.warn('[CloudBackup] ' + this._ultimoErro);
        return { ok: false, motivo: 'grande-demais' };
      }
      const r = await this._inserirLinha({ id, nota, packed, chars: json.length, sig });
      if (!r.ok) { this._ultimoErro = r.motivo; return r; }
      this._gravarUltimoSig(id, sig);
      this._marcarEnvio(id);
      this._ultimoErro = null;
      console.info('[CloudBackup] foto gravada no banco' + (r.ancora ? ' (ÂNCORA permanente)' : '') + ': ' + nota);
      this.faxina(id);   // best-effort, não bloqueia
      return { ok: true, ancora: r.ancora, chars: json.length };
    } catch (err) {
      if (this._isMissingTable(err)) { this._disable(err); return { ok: false, motivo: 'tabela-ausente' }; }
      this._ultimoErro = (err && (err.message || err.code)) || 'erro';
      console.warn('[CloudBackup] não foi possível gravar a foto:', this._ultimoErro);
      return { ok: false, motivo: this._ultimoErro };
    }
  },

  /* ── CRIAR UMA FOTO DO ESTADO ATUAL ────────────────────────────────────────
     O perfil é relido de dentro da fila — não antes de entrar nela — para que
     a foto reflita o estado mais próximo possível do instante real da
     gravação, mesmo que esta chamada tenha esperado outra terminar primeiro. */
  criar(nota, opts) {
    const id = ProfileManager.getActiveProfileId();
    if (!id) return Promise.resolve({ ok: false, motivo: 'sem-perfil' });
    if (!this._pronto()) return Promise.resolve({ ok: false, motivo: 'sem-conexão' });
    return this._serializar(id, () => {
      const backup = ProfileManager.exportProfile(id);
      return this._publicar(id, backup && backup.data, nota, opts);
    });
  },

  /* Fotografa um mapa de dados QUALQUER (não o estado atual). É o que permite
     preservar o que está NA NUVEM antes de sobrescrevê-lo — o estado que
     estamos protegendo pode nem existir mais neste aparelho. */
  criarDeDados(id, dataObj, nota, opts) {
    if (!id) return Promise.resolve({ ok: false, motivo: 'sem-perfil' });
    if (!this._pronto()) return Promise.resolve({ ok: false, motivo: 'sem-conexão' });
    return this._serializar(id, () => this._publicar(id, dataObj, nota, opts));
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

  /* ── RETENÇÃO EM FAIXAS (avô-pai-filho) ───────────────────────────────────
     A regra anterior era um teto simples: guardava as 14 fotos mais novas e
     descartava o resto. Com uma foto por dia, isso significa que o histórico
     inteiro tinha 14 DIAS — e essa é justamente a forma clássica de perder
     dados sem perceber. Um estrago que só é notado três semanas depois (uma
     matéria apagada por engano, uma importação que sobrescreveu o ciclo) já
     não teria nenhuma foto boa: as 14 mais novas já nasceram todas com o
     estrago dentro, e a única sobrevivente seria a âncora, do primeiro dia.

     A prática consolidada para isso — Time Machine, restic, borg, Backblaze,
     e todo desenho sério de retenção — é AVÔ-PAI-FILHO: densidade alta perto
     do presente, esparsa e LONGA no passado. Guardamos:

       · a ÂNCORA, sempre, para sempre;
       · as N fotos mais recentes, aconteça o que acontecer;
       · a mais nova de cada DIA, nos últimos 14 dias;
       · a mais nova de cada SEMANA, nas últimas 8 semanas;
       · a mais nova de cada MÊS, nos últimos 12 meses.

     Uma foto só é descartada se ficar fora de TODAS as faixas. O resultado é
     um histórico que cobre um ano inteiro com cerca de 30 linhas por perfil —
     e que responde "posso voltar ao estado de três meses atrás?" com sim.

     As mesmas travas de antes continuam valendo por cima disso: a âncora
     nunca sai (mesmo que existisse mais de uma), nada com menos de 24 h sai,
     e o total nunca desce abaixo de MIN_KEEP. Se alguma coisa der errado no
     meio, o efeito é guardar fotos DEMAIS — o lado certo de errar. */
  MANTER_RECENTES: 5,     // as mais novas, independentemente de faixa
  MANTER_DIAS: 14,
  MANTER_SEMANAS: 8,
  MANTER_MESES: 12,

  _faixaDia(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); },
  _faixaMes(d) { return d.getFullYear() + '-' + (d.getMonth() + 1); },
  // Semana ISO-8601: a quinta-feira da semana identifica o par ano-semana.
  _faixaSemana(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);   // quinta desta semana
    const q1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    q1.setUTCDate(q1.getUTCDate() - ((q1.getUTCDay() + 6) % 7) + 3); // quinta da semana 1
    return t.getUTCFullYear() + '-S' + (1 + Math.round((t - q1) / 604800000));
  },

  /* A ESCOLHA é pura e testável; só o DELETE é que fala com o banco. Quem
     apaga dado tem de poder ser interrogado por um teste. */
  selecionarParaFaxina(linhas, agora) {
    const lista = (linhas || [])
      .filter(r => r && r.created_at && !isNaN(new Date(r.created_at).getTime()))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));   // mais nova primeiro
    if (lista.length <= this.MIN_KEEP) return [];
    const manter = new Set();
    // 1. a âncora, sempre — nem precisa ser única para estar protegida
    lista.forEach(r => { if (r.ancora) manter.add(r.id); });
    // 2. as mais recentes
    lista.slice(0, this.MANTER_RECENTES).forEach(r => manter.add(r.id));
    // 3. a mais nova de cada faixa (a lista já vem da mais nova para a mais velha,
    //    então a PRIMEIRA vista em cada faixa é a que representa a faixa)
    const porFaixa = (chave, limite) => {
      const vistas = new Map();
      lista.forEach(r => {
        const k = chave(new Date(r.created_at));
        if (!vistas.has(k)) vistas.set(k, r);
      });
      [...vistas.values()].slice(0, limite).forEach(r => manter.add(r.id));
    };
    porFaixa(d => this._faixaDia(d), this.MANTER_DIAS);
    porFaixa(d => this._faixaSemana(d), this.MANTER_SEMANAS);
    porFaixa(d => this._faixaMes(d), this.MANTER_MESES);
    // fora de todas as faixas E com mais de 24 h
    const apagar = lista.filter(r => !manter.has(r.id) &&
      (agora - new Date(r.created_at).getTime()) > this.IDADE_MINIMA_MS);
    if (!apagar.length) return [];
    if (lista.length - apagar.length < this.MIN_KEEP) return [];   // piso absoluto
    return apagar;
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
     descarta a duplicata pela assinatura (persistida — sobrevive a reload). */
  /* ── QUEM SABE SE A FOTO DE HOJE JÁ EXISTE É O BANCO ──────────────────────
     O controle era só um carimbo local (`cbk-dia:<perfil>`). Um carimbo local
     responde bem quando sobrevive — e ele não sobrevive a tudo: trocar de
     aparelho, limpar o navegador, o id do perfil mudar (a migração para UUID
     muda a chave), ou qualquer gravação que não chegue ao disco. Toda vez que
     ele se perde, o app conclui "ainda não fiz a de hoje" e grava outra. Foi
     assim que um único dia acumulou seis fotos de 3 MB.

     Um trabalho agendado não pode ter como fonte da verdade um sinalizador do
     cliente: a fonte da verdade tem de ser o lugar onde o resultado é gravado.
     Agora o carimbo local é só um CAMINHO RÁPIDO (acerta quase sempre e custa
     zero consulta); quando ele não bate, quem decide é uma consulta ao banco
     — que sobrevive a recarregamento, a troca de aparelho e à perda da chave.
     Duplicar deixa de ser possível, não importa o que aconteça no cliente. */
  async _jaTemFotoDeHoje(id) {
    const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
    const { data, error } = await CloudStore.client.from(this.TABLE)
      .select('id').eq('profile_id', id).gte('created_at', inicio.toISOString()).limit(1);
    if (error) throw error;
    return !!(data && data.length);
  },
  _diaEmCurso: false,
  async garantirDoDia() {
    if (!this._pronto() || this._diaEmCurso) return false;
    const id = ProfileManager.getActiveProfileId();
    if (!id) return false;
    const hoje = todayLocal();
    let ultimo = null;
    try { ultimo = localStorage.getItem(this._diaKey(id)); } catch (e) { _quiet(e, 'cbk-dia'); }
    if (ultimo === hoje) return false;   // caminho rápido: nem consulta o banco
    this._diaEmCurso = true;
    try {
      if (await this._jaTemFotoDeHoje(id)) {
        // o banco já tem a de hoje: só reconstrói o carimbo local que se perdeu
        try { localStorage.setItem(this._diaKey(id), hoje); } catch (e) { _quiet(e, 'cbk-dia3'); }
        return false;
      }
      return await this._fazerDoDia(id, hoje);
    } catch (e) {
      /* Não deu para confirmar com o banco: NÃO grava. Uma foto a menos hoje é
         recuperável (o próximo ciclo, daqui a um minuto, tenta de novo); uma
         foto duplicada a cada minuto não é. */
      _quiet(e, 'cbk-dia-checagem');
      return false;
    } finally { this._diaEmCurso = false; }
  },
  async _fazerDoDia(id, hoje) {
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
    if ((Date.now() - this.ultimoEnvioEm(id)) < this.FRESCO_MS) return true;  // já há foto fresca
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

     O que precisa ser guardado é o que o envio vai SUBSTITUIR, na ordem do
     mais fiel ao mais aproximado:

       1. as SEÇÕES na nuvem (profile_sections). É o que a leitura por seção
          (Fase 2) trata como verdade — o blob de baixo é só uma rede de
          segurança periódica e pode estar minutos atrasado em relação a elas.
          Proteger com o blob quando as seções têm dado mais fresco seria
          fotografar um estado JÁ desatualizado, não o que está de fato prestes
          a ser substituído;
       2. o blob (study_profiles), se a leitura por seção falhar ou não validar;
       3. se nem a nuvem responder, a foto local mais recente do histórico de
          versões — ela é de no máximo 20 minutos atrás, e portanto anterior ao
          apagamento.

     Se as três falharem, nada é publicado como backup e o console diz por quê.
     O envio em si continua: travar a sincronização por não conseguir fazer um
     backup criaria um segundo problema em vez de resolver o primeiro — e o
     conteúdo apagado continua na Lixeira e no histórico local deste aparelho. */
  async _estadoAnterior(id) {
    const util = (d) => !!(d && typeof d === 'object' && Object.keys(d).some(k => !valorVazio(d[k])));
    try {
      if (window.SectionSync) {
        const rows = await SectionSync.fetchAllSections(id);
        const prep = SectionSync._prepare(rows);
        if (prep.ok && util(prep.map)) return prep.map;
      }
    } catch (e) { _quiet(e, 'guarda-secoes'); }
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

/* ── GATILHO DO BACKUP DIÁRIO ──────────────────────────────────────────────
   Este gatilho tinha um `feito = true` que o desarmava PARA SEMPRE depois da
   primeira execução. O efeito real não era "um backup por dia": era "um
   backup por CARREGAMENTO de página". Num app que fica aberto por dias — PWA
   instalado no celular, aba fixa no computador, que é exatamente como um
   diário de estudos é usado — a virada da meia-noite passava sem ninguém
   olhar, e podiam-se passar semanas sem um único backup diário, com a tela
   dizendo "ativo" o tempo todo.

   Agora a verificação é PERMANENTE e barata: `garantirDoDia` lê uma chave do
   armazenamento e desiste em microssegundos se a foto de hoje já existe. Além
   do intervalo, ela roda quando o app volta ao primeiro plano — que é o
   instante em que um celular "acorda" depois da virada do dia. */
(function () {
  const tentar = () => {
    try {
      if (!window.CloudBackup || !CloudBackup._pronto()) return;
      if (!ProfileManager.getActiveProfileId()) return;
      if (!sessionStorage.getItem('diario-estudos:entered')) return;
    } catch (e) { _quiet(e, 'cbk-gatilho'); return; }
    CloudBackup.garantirDoDia();
  };
  setTimeout(tentar, 9000);
  setInterval(tentar, 60000);          // permanente: a virada do dia precisa ser vista
  try {
    window.addEventListener('focus', tentar);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tentar(); });
  } catch (e) { _quiet(e, 'cbk-gatilho-eventos'); }
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
    /* Falha do ÚLTIMO envio real (não de "não havia nada a fazer"): antes essa
       informação só existia no console. Agora aparece aqui mesmo quando já há
       fotos boas na lista — um perfil grande demais falhando toda vez no
       gatilho diário não pode passar despercebido só porque fotos antigas
       (de quando o perfil era menor) continuam na lista. */
    const aviso = CloudBackup._ultimoErro
      ? `<p class="hint" style="color:var(--warn-text);background:var(--warn-soft);border-radius:10px;padding:8px 12px;margin:0 0 10px;">⚠️ O último envio ao banco não deu certo: ${escapeHtml(CloudBackup._ultimoErro)}. As fotos abaixo continuam válidas; o histórico local (acima) e o backup em .json seguem funcionando normalmente enquanto isso não for resolvido.</p>`
      : '';
    if (!linhas.length) {
      host.innerHTML = aviso + '<p class="hint">Nenhuma cópia no banco ainda. A primeira é criada sozinha na próxima abertura do dia — ou agora, no botão acima. A primeira de todas vira uma <strong>âncora permanente</strong>, que a limpeza automática nunca remove.</p>';
      return;
    }
    const ancoras = linhas.filter(r => r.ancora).length;
    host.innerHTML = aviso +
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
    else if (r.motivo === 'grande-demais') showToast('Este perfil está grande demais para uma foto no banco agora. Use "Exportar backup" (.json) enquanto isso.');
    else showToast('Não foi possível guardar agora: ' + (r.motivo || ''));
    CloudBackupUI.render();
  });
  window.addEventListener('screen:activated', (e) => {
    if (e.detail && e.detail.screen === 'config') CloudBackupUI.render();
  });
})();
