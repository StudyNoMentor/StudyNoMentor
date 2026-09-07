/* ============================================================
   TELA DE ACESSO — seleção de perfil (gate) + gestão de perfis
   ============================================================ */
/* ============================================================
   TELA DE ACESSO (cloud-first): login -> perfis do banco -> entrar
   Modelo: study_profiles (1 linha por perfil), com optimistic lock.
   ============================================================ */
const ProfileUI = {
  SESSION_KEY: 'diario-estudos:entered',
  _stage: 'login',
  _offline: false,
  _entering: false,   // true enquanto entra num perfil (trava o gate na tela "Entrando…")
  _lastAuthKey: null,   // evita re-render do gate a cada evento de auth repetido
  _gridToken: 0,        // ignora respostas fora de ordem ao listar perfis
  _gridSig: null,       // assinatura do grid já pintado (evita repintar igual)
  _authMode: 'signin',
  _editingId: null,
  _draftAvatar: null,
  _draftColor: null,

  AUTO_ENTER_KEY: 'diario-estudos:auto-enter',
  autoEnterOn() { try { return localStorage.getItem(this.AUTO_ENTER_KEY) !== '0'; } catch (e) { return true; } },
  setAutoEnter(on) { try { localStorage.setItem(this.AUTO_ENTER_KEY, on ? '1' : '0'); } catch (e) { _quiet(e); } },
  // Último perfil usado POR CONTA (uid): permite entrar direto após o login,
  // sem mostrar o seletor de perfil (a troca fica dentro do app, no chip do nome).
  _uid() { try { const s = window.CloudStore && CloudStore.session; return (s && s.user && s.user.id) || null; } catch (e) { return null; } },
  _lastProfileKey() { const u = this._uid(); return u ? 'diario-estudos:last-profile:' + u : null; },
  getLastProfile() { try { const k = this._lastProfileKey(); return k ? localStorage.getItem(k) : null; } catch (e) { return null; } },
  setLastProfile(id) { try { const k = this._lastProfileKey(); if (k && id) localStorage.setItem(k, id); } catch (e) { _quiet(e); } },
  // Perfil PADRÃO por conta (definido nas Configurações). Se existir, entra nele
  // direto ao logar, com prioridade sobre o "último usado".
  _defaultProfileKey() { const u = this._uid(); return u ? 'diario-estudos:default-profile:' + u : null; },
  getDefaultProfile() { try { const k = this._defaultProfileKey(); return k ? localStorage.getItem(k) : null; } catch (e) { return null; } },
  setDefaultProfile(id) { try { const k = this._defaultProfileKey(); if (!k) return; if (id) localStorage.setItem(k, id); else localStorage.removeItem(k); } catch (e) { _quiet(e); } },
  _autoEnterTried: false,   // não repete o auto-enter na mesma sessão de gate
  boot() {
    this.renderChip();
    let entered = null;
    try { entered = sessionStorage.getItem(this.SESSION_KEY); } catch (e) { _quiet(e); }
    const active = ProfileManager.getActiveProfileId();
    // Só entramos direto quando há o marcador de sessão desta aba (SESSION_KEY).
    // NÃO entramos apenas por existir dado local — senão, após deslogar + F5, o
    // app abriria sem sessão. O "entrar direto" acontece após o login confirmado
    // (loadCloudProfiles → auto-enter do último perfil).
    if (entered && entered === active && this._hasLocalData(active)) {
      this.hideGate();
      // Só depois de entrar de fato: no gate o aviso não teria o que fazer.
      try { DB.checarEspaco(); } catch (_) { _quiet(_); }
      // Faxina de dados órfãos deixados por versões anteriores (histórico e
      // contadores apontando para cards já excluídos). Silenciosa quando não há
      // nada a limpar; avisa quando limpa, para você saber que aconteceu.
      try {
        const nOrf = DB.limparOrfaos();
        if (nOrf > 0) {
          console.warn('[faxina] registros órfãos removidos:', nOrf);
          setTimeout(() => { try { showToast('🧹 ' + nOrf + ' registro(s) órfão(s) de cards excluídos foram limpos'); } catch (_) { _quiet(_); } }, 3500);
        }
      } catch (_) { _quiet(_); }
      return;
    }
    this.showGate();
  },
  _hasLocalData(id) {
    if (!id) return false;
    const pfx = 'diario-estudos:u:' + id + ':';
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(pfx)) return true; }
    return false;
  },
  isGateOpen() { const g = document.getElementById('profile-gate'); return g && g.style.display !== 'none'; },
  showGate() { $id('profile-gate').style.display = 'block'; this.refreshStage(); },
  hideGate() { $id('profile-gate').style.display = 'none'; },
  // O Supabase dispara vários eventos de auth (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED...).
  // Sem este guarda, cada evento re-renderizava o gate e causava a "piscada" nos perfis.
  onAuthChanged() {
    const CS = window.CloudStore;
    const uid = (CS && CS.session && CS.session.user) ? CS.session.user.id : null;
    const key = (uid || 'anon') + '|' + (this._offline ? 'off' : 'on') + '|' + ((CS && CS.libStatus) || '');
    const changed = (key !== this._lastAuthKey);
    this._lastAuthKey = key;
    if (this.isGateOpen() && changed) this.refreshStage();
    if (window.CloudUI) CloudUI.render();
  },

  refreshStage() {
    // Se já estamos entrando num perfil (reload a caminho), não repinta o gate —
    // evita qualquer flash do seletor por um evento de auth tardio.
    if (this._entering) return;
    const CS = window.CloudStore;
    const logged = !!(CS && CS.isReady && CS.isReady() && CS.isLoggedIn());
    const loginEl = document.getElementById('gate-login');
    const profilesEl = document.getElementById('gate-profiles');
    const enteringEl = document.getElementById('gate-entering');
    const title = document.getElementById('profile-gate-title');
    const sub = document.getElementById('profile-gate-sub');
    const head = document.querySelector('#profile-gate .gate-panel-head');
    if (!logged && !this._offline) {
      this._stage = 'login';
      this._gridSig = null;
      this._gridToken++;
      const g = document.getElementById('profile-gate-grid');
      if (g) g.innerHTML = '';
      if (loginEl) loginEl.style.display = 'block';
      if (profilesEl) profilesEl.style.display = 'none';
      if (enteringEl) enteringEl.style.display = 'none';
      if (head) head.style.display = '';
      if (title) title.textContent = 'Bem-vindo de volta';
      if (sub) sub.textContent = 'Entre para continuar seus estudos.';
      const st = document.getElementById('gate-conn-status');
      if (st) {
        const s = CS ? CS.libStatus : 'pending';
        if (s === 'ready') { st.innerHTML = '<span class="cdot ok"></span> Servidor conectado'; st.className = 'gate-conn ok'; }
        else if (s === 'pending') { st.innerHTML = '<span class="cdot"></span> Conectando ao servidor...'; st.className = 'gate-conn'; }
        else { st.innerHTML = '<span class="cdot bad"></span> Servidor indisponível — verifique a internet'; st.className = 'gate-conn bad'; }
      }
    } else {
      // Logado. Se vamos ENTRAR DIRETO (perfil padrão), NÃO mostramos o seletor:
      // exibimos a tela limpa "Entrando…" até o app recarregar. O seletor só
      // aparece se o auto-enter falhar (sem perfil válido) ou se você pediu para trocar.
      const willAutoEnter = logged && this.autoEnterOn() && !this._autoEnterTried && !this._offline;
      if (loginEl) loginEl.style.display = 'none';
      if (willAutoEnter) {
        this._stage = 'entering';
        if (enteringEl) enteringEl.style.display = 'block';
        if (profilesEl) profilesEl.style.display = 'none';
        if (head) head.style.display = 'none';   // esconde "Quem vai estudar?"
        this.loadCloudProfiles();                 // vai auto-entrar (ou cair no picker)
      } else {
        this._stage = 'profiles';
        if (enteringEl) enteringEl.style.display = 'none';
        if (profilesEl) profilesEl.style.display = 'block';
        if (head) head.style.display = '';
        if (title) title.textContent = 'Quem vai estudar?';
        if (sub) sub.textContent = 'Selecione seu perfil para entrar no seu diário.';
        const lo = document.getElementById('gate-logout-btn');
        if (lo) lo.style.display = logged ? 'inline-block' : 'none';
        if (logged) this.loadCloudProfiles();
        else this.renderGrid(ProfileManager.getProfiles());
      }
    }
  },
  // Mostra o seletor de perfis quando o auto-enter NÃO acontece (fallback).
  _showProfilePicker() {
    const profilesEl = document.getElementById('gate-profiles');
    const enteringEl = document.getElementById('gate-entering');
    const head = document.querySelector('#profile-gate .gate-panel-head');
    const title = document.getElementById('profile-gate-title');
    const sub = document.getElementById('profile-gate-sub');
    const lo = document.getElementById('gate-logout-btn');
    this._stage = 'profiles';
    if (enteringEl) enteringEl.style.display = 'none';
    if (profilesEl) profilesEl.style.display = 'block';
    if (head) head.style.display = '';
    if (title) title.textContent = 'Quem vai estudar?';
    if (sub) sub.textContent = 'Selecione seu perfil para entrar no seu diário.';
    if (lo) lo.style.display = 'inline-block';
  },

  async loadCloudProfiles() {
    const grid = document.getElementById('profile-gate-grid');
    if (!grid) return;
    const token = ++this._gridToken;
    // só mostra "Carregando" quando ainda não há nada pintado — assim uma
    // atualização em segundo plano (realtime/token refresh) não pisca a tela.
    if (!grid.querySelector('.profile-card')) {
      grid.innerHTML = '<p class="hint" style="text-align:center; padding:20px;">Carregando perfis...</p>';
    }
    try {
      const rows = await CloudStore.listProfiles();
      if (token !== this._gridToken) return; // chegou uma resposta mais nova
      ProfileManager.syncMirrorFromCloud(rows);
      // ENTRAR DIRETO: após o login, vai direto ao perfil padrão/último usado (ou
      // ao único existente) sem exibir o seletor. A troca fica dentro do app.
      if (this.autoEnterOn() && !this._autoEnterTried && !this._offline) {
        let alvo = this.getDefaultProfile();               // perfil padrão definido nas configurações
        if (!alvo || !rows.some(r => r.id === alvo)) alvo = this.getLastProfile();
        if (!alvo && rows.length === 1) alvo = rows[0].id;  // conta com 1 perfil: entra nele
        if (alvo && rows.some(r => r.id === alvo)) {
          this._autoEnterTried = true;
          this._entering = true;     // trava o gate na tela "Entrando…" até o reload
          this.enterProfile(alvo);   // a tela "Entrando…" já está visível
          return;
        }
      }
      // Fallback: nenhum alvo válido → mostra o seletor de perfis de propósito
      this._showProfilePicker();
      this.renderGrid(rows.map(r => ({ id: r.id, nome: r.profile_name, avatar: r.avatar, cor: r.color })));
    } catch (err) {
      if (token !== this._gridToken) return;
      this._showProfilePicker();
      if (grid.querySelector('.profile-card')) return; // mantém o que já está na tela
      grid.innerHTML = '<p class="hint" style="color:var(--bad); text-align:center; padding:20px;">Não foi possível carregar seus perfis: ' + escapeHtml(err.message || '') + '<br>Tente recarregar a página.</p>';
    }
  },

  renderGrid(profiles) {
    const grid = document.getElementById('profile-gate-grid');
    if (!grid) return;
    // Se a lista é exatamente a mesma que já está na tela, não repinta (evita o "flash").
    const sig = JSON.stringify((profiles || []).map(p => [p.id, p.nome, p.avatar, p.cor]));
    if (sig === this._gridSig && grid.querySelector('.profile-card')) return;
    this._gridSig = sig;
    grid.innerHTML = (profiles || []).map(p => `
      <div class="profile-card" data-id="${p.id}">
        <button type="button" class="profile-card-edit" data-edit="${p.id}" title="Editar" aria-label="Editar">✎</button>
        <div class="profile-card-avatar" style="background:${p.cor};">${p.avatar}</div>
        <div class="profile-card-name">${escapeHtml(p.nome)}</div>
        <div class="profile-card-stats">&nbsp;</div>
      </div>`).join('') + `
      <div class="profile-card add" id="profile-card-add">
        <div class="profile-card-avatar">＋</div>
        <div class="profile-card-name">Novo perfil</div>
        <div class="profile-card-stats">&nbsp;</div>
      </div>`;
    grid.querySelectorAll('.profile-card[data-id]').forEach(card => {
      card.addEventListener('click', (e) => { if (e.target.closest('[data-edit]')) return; this.enterProfile(card.dataset.id); });
    });
    grid.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.openModal(btn.dataset.edit); });
    });
    const add = document.getElementById('profile-card-add');
    if (add) add.addEventListener('click', () => this.openModal(null));
  },

  async enterProfile(id) {
    if (window.CloudStore && CloudStore.isLoggedIn()) {
      showToast('Carregando perfil...');
      try {
        CloudStore._applying = true;
        // FASE 2 — a leitura vem de profile_sections. Se o conjunto de seções não
        // passar na verificação (manifesto ausente, seção faltando, rede), caímos
        // automaticamente no blob de study_profiles, que continua
        // sendo escrito. Nenhum caminho fica sem plano B.
        let porSecao = null;
        if (window.SectionSync && SectionSync.readEnabled) {
          porSecao = await SectionSync.hydrate(id);
          if (porSecao.ok) {
            try { ProfileManager.setRev(id, await CloudStore._fetchRev(id) || ProfileManager.getRev(id)); } catch (_) { _quiet(_); }
          } else {
            console.warn('[SectionSync] entrando pelo blob (motivo:', porSecao.motivo + ')');
          }
        }
        if (!porSecao || !porSecao.ok) {
          try { SectionSync._saveLast({ ok: false, origem: 'blob', motivo: (porSecao && porSecao.motivo) || 'leitura-por-seção-não-tentada', em: new Date().toISOString() }); } catch (_) { _quiet(_); }
          const res = await CloudStore.fetchPayload(id);
          ProfileManager.restorePayloadInto(id, (res.payload && res.payload.data) || {});
          ProfileManager.setRev(id, res.rev);
        }
        ProfileManager.setActiveProfile(id);
        PlanManager.init();
        CloudStore._applying = false;
      } catch (err) {
        CloudStore._applying = false;
        this._entering = false;   // libera o gate para mostrar o seletor de novo
        this._autoEnterTried = true;
        showToast('Erro ao carregar o perfil: ' + (err.message || ''));
        this._showProfilePicker();
        return;
      }
    } else {
      ProfileManager.setActiveProfile(id);
      PlanManager.init();
    }
    try { sessionStorage.setItem(this.SESSION_KEY, id); } catch (e) { _quiet(e); }
    this.setLastProfile(id);   // lembra este perfil para esta conta (entra direto no próximo login)
    location.reload();
  },

  openModal(id) {
    this._editingId = id;
    const isNew = !id;
    $id('profile-modal-title').textContent = isNew ? 'Novo perfil' : 'Editar perfil';
    $id('pf-delete').style.display = isNew ? 'none' : 'inline-block';
    // O botão de exportar só faz sentido para um perfil que JÁ EXISTE (precisa
    // de dados salvos para gerar o arquivo). Antes ficava sempre escondido —
    // nada no código voltava a exibi-lo depois do reset acima.
    const exp = document.getElementById('pf-export-row'); if (exp) exp.style.display = isNew ? 'none' : 'block';
    let nome = '', avatar = ProfileManager.DEFAULT_AVATARS[0], cor = ProfileManager.DEFAULT_COLORS[0], meta = {};
    if (!isNew) { const p = ProfileManager.getProfiles().find(x => x.id === id); if (p) { nome = p.nome; avatar = p.avatar; cor = p.cor; meta = p.meta || {}; } }
    this._draftAvatar = avatar; this._draftColor = cor;
    $id('pf-nome').value = nome;
    // dados do estudante (guardados em profile.meta)
    const setV = (fid, v) => { const el = document.getElementById(fid); if (el) el.value = v || ''; };
    setV('pf-concurso', meta.concurso); setV('pf-cargo', meta.cargo);
    setV('pf-banca', meta.banca); setV('pf-prova', meta.provaDate); setV('pf-metah', meta.metaHoras);
    // "Opções avançadas" começa recolhida sempre que o modal abre
    const advBody = document.getElementById('pf-advanced-body');
    const advTgl = document.getElementById('pf-advanced-toggle');
    if (advBody) advBody.hidden = true;
    if (advTgl) advTgl.setAttribute('aria-expanded', 'false');
    $id('pf-avatar-grid').innerHTML = ProfileManager.DEFAULT_AVATARS.map(a =>
      `<button type="button" class="pf-avatar-opt ${a === avatar ? 'selected' : ''}" data-av="${a}">${a}</button>`).join('');
    $id('pf-color-grid').innerHTML = ProfileManager.DEFAULT_COLORS.map(c =>
      `<button type="button" class="pf-color-opt ${c === cor ? 'selected' : ''}" data-color="${c}" aria-label="Cor ${c}" style="background:${c};"></button>`).join('');
    document.querySelectorAll('#pf-avatar-grid .pf-avatar-opt').forEach(b => b.addEventListener('click', () => {
      this._draftAvatar = b.dataset.av;
      document.querySelectorAll('#pf-avatar-grid .pf-avatar-opt').forEach(x => x.classList.toggle('selected', x === b));
      this._pfUpdatePreview();
    }));
    document.querySelectorAll('#pf-color-grid .pf-color-opt').forEach(b => b.addEventListener('click', () => {
      this._draftColor = b.dataset.color;
      document.querySelectorAll('#pf-color-grid .pf-color-opt').forEach(x => x.classList.toggle('selected', x === b));
      this._pfUpdatePreview();
    }));
    // pré-visualização ao vivo enquanto edita
    ['pf-nome', 'pf-concurso', 'pf-cargo', 'pf-prova'].forEach(fid => {
      const el = document.getElementById(fid);
      if (el && !el._pfBound) { el._pfBound = true; el.addEventListener('input', () => this._pfUpdatePreview()); el.addEventListener('change', () => this._pfUpdatePreview()); }
    });
    this._pfUpdatePreview();
    $id('profile-modal').style.display = 'flex';
    setTimeout(() => $id('pf-nome').focus(), 50);
  },
  _pfUpdatePreview() {
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const av = document.getElementById('pf-preview-avatar');
    const nm = document.getElementById('pf-preview-name');
    const sb = document.getElementById('pf-preview-sub');
    const cd = document.getElementById('pf-preview-countdown');
    if (av) { av.textContent = this._draftAvatar || '📘'; av.style.background = this._draftColor || 'var(--accent)'; }
    if (nm) nm.textContent = g('pf-nome') || 'Seu perfil';
    if (sb) {
      const cargo = g('pf-cargo'), conc = g('pf-concurso');
      sb.textContent = [cargo, conc].filter(Boolean).join(' · ') || 'Estudante';
    }
    if (cd) {
      const d = g('pf-prova');
      if (d) {
        const alvo = new Date(d + 'T00:00:00'), hoje = new Date(); hoje.setHours(0, 0, 0, 0);
        const dias = Math.round((alvo - hoje) / 86400000);
        if (!isNaN(dias)) {
          cd.style.display = 'block';
          cd.innerHTML = dias >= 0 ? `<b>${dias}</b><span>dias p/ prova</span>` : `<b>${Math.abs(dias)}</b><span>dias atrás</span>`;
        } else cd.style.display = 'none';
      } else cd.style.display = 'none';
    }
  },
  async saveModal() {
    const nome = $id('pf-nome').value.trim();
    if (!nome) { showToast('Dê um nome ao perfil'); return; }
    const btn = document.getElementById('pf-save');
    btn.disabled = true; btn.textContent = 'Salvando...';
    try {
      // coleta os dados do estudante
      const gv = (fid) => { const el = document.getElementById(fid); return el ? el.value.trim() : ''; };
      const meta = { concurso: gv('pf-concurso'), cargo: gv('pf-cargo'), banca: gv('pf-banca'), provaDate: gv('pf-prova'), metaHoras: gv('pf-metah') };
      if (this._editingId) {
        ProfileManager.addMirror({ id: this._editingId, nome, avatar: this._draftAvatar, cor: this._draftColor });
        ProfileManager.updateProfile(this._editingId, { meta });   // dados do estudante (local + sincroniza no blob)
        if (window.CloudStore && CloudStore.isLoggedIn()) await CloudStore.updateMeta(this._editingId, { nome, avatar: this._draftAvatar, cor: this._draftColor });
        showToast('Perfil atualizado ✓');
        $id('profile-modal').style.display = 'none';
        this.renderChip();
        this.refreshStage();
      } else {
        if (!(window.CloudStore && CloudStore.isLoggedIn())) { showToast('Faça login para criar um perfil.'); btn.disabled = false; btn.textContent = 'Salvar'; return; }
        const row = await CloudStore.createRow({ name: nome, avatar: this._draftAvatar, color: this._draftColor, payload: {} });
        ProfileManager.addMirror({ id: row.id, nome, avatar: this._draftAvatar, cor: this._draftColor });
        ProfileManager.setRev(row.id, row.rev || 1);
        ProfileManager.setActiveProfile(row.id);
        PlanManager.init();
        await CloudStore.saveActive();
        $id('profile-modal').style.display = 'none';
        try { sessionStorage.setItem(this.SESSION_KEY, row.id); } catch (e) { _quiet(e); }
        location.reload();
      }
    } catch (err) {
      showToast('Erro: ' + (err.message || ''));
    } finally {
      btn.disabled = false; btn.textContent = 'Salvar';
    }
  },
  async deleteCurrent() {
    const id = this._editingId; if (!id) return;
    const p = ProfileManager.getProfiles().find(x => x.id === id);
    if (!await UI.confirmTyped(`Excluir o perfil "${p ? p.nome : ''}"?\n\nTODOS os dados dele serão apagados permanentemente, inclusive na nuvem.`,
      { word: 'EXCLUIR', title: '🗑️ Excluir perfil', okText: 'Excluir definitivamente' })) return;
    try {
      if (window.CloudStore && CloudStore.isLoggedIn()) await CloudStore.deleteRow(id);
    } catch (err) { showToast('Erro ao excluir na nuvem: ' + (err.message || '')); return; }
    const prefix = 'diario-estudos:u:' + id + ':';
    const rm = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) rm.push(k); }
    rm.forEach(k => localStorage.removeItem(k));
    ProfileManager.saveProfiles(ProfileManager.getProfiles().filter(x => x.id !== id));
    $id('profile-modal').style.display = 'none';
    const wasActive = ProfileManager.getActiveProfileId() === id;
    if (wasActive) { try { sessionStorage.removeItem(this.SESSION_KEY); } catch (e) { _quiet(e); } location.reload(); return; }
    this.refreshStage();
    showToast('Perfil excluído');
  },

  setGateAuthMode(mode) {
    this._authMode = mode;
    document.querySelectorAll('#gate-login .cloud-auth-tab').forEach(t => t.classList.toggle('active', t.dataset.gatemode === mode));
    $id('gate-auth-submit').textContent = mode === 'signup' ? 'Criar conta' : 'Entrar';
    $id('gate-auth-msg').style.display = 'none';
  },
  async submitGateAuth() {
    const email = $id('gate-email').value.trim();
    const password = $id('gate-password').value;
    const msg = document.getElementById('gate-auth-msg');
    const show = (t, kind) => { msg.textContent = t; msg.className = 'gate-alert ' + (kind || 'bad'); msg.style.display = 'block'; };
    msg.style.display = 'none';
    const CS = window.CloudStore;
    if (!CS || !CS.isReady()) { show('Servidor da nuvem indisponível. Verifique a internet ou use "Usar offline".', 'warn'); return; }
    if (!email) { show('Informe seu e-mail.', 'bad'); return; }
    if (password.length < 6) { show('A senha precisa ter ao menos 6 caracteres.', 'bad'); return; }
    const btn = document.getElementById('gate-auth-submit');
    const orig = this._authMode === 'signup' ? 'Criar conta' : 'Entrar';
    btn.disabled = true; btn.textContent = 'Aguarde...'; show('Conectando...', 'info');
    try {
      if (this._authMode === 'signup') {
        await CS.signUp(email, password);
        if (CS.isLoggedIn()) show('Conta criada! Entrando...', 'good');
        else show('Conta criada! Verifique seu e-mail para confirmar e depois clique em "Entrar".', 'good');
      } else {
        await CS.signIn(email, password);
        show('Entrando...', 'good');
        // transição imediata para a tela limpa "Entrando…" (sem esperar 2s nem
        // mostrar o seletor de perfil). refreshStage detecta o login e auto-entra.
        this._autoEnterTried = false;   // garante que o auto-enter rode neste login
        this.refreshStage();
        setTimeout(() => { if (this.isGateOpen() && this._stage === 'login') this.refreshStage(); }, 1500);
      }
    } catch (err) {
      show(this._friendlyAuthError(err), 'bad');
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  },
  _friendlyAuthError(err) {
    const m = (err && err.message || '').toLowerCase();
    if (m.includes('invalid login')) return 'E-mail ou senha incorretos.';
    if (m.includes('email not confirmed')) return 'Confirme seu e-mail e tente novamente.';
    if (m.includes('already registered') || m.includes('already been registered')) return 'Este e-mail já tem conta. Use a aba "Entrar".';
    if (m.includes('password')) return 'Senha inválida (mínimo 6 caracteres).';
    if (m.includes('demorou') || m.includes('timeout') || m.includes('failed to fetch') || m.includes('network')) return 'Sem resposta do servidor. Verifique sua internet.';
    return (err && err.message) ? err.message : 'Não foi possível autenticar.';
  },
  // Recuperação de senha: envia o e-mail de redefinição do Supabase.
  async forgotPassword() {
    const emailEl = document.getElementById('gate-email');
    const email = (emailEl && emailEl.value.trim()) || '';
    const msg = document.getElementById('gate-auth-msg');
    const show = (t, kind) => { if (msg) { msg.textContent = t; msg.className = 'gate-alert ' + (kind || 'bad'); msg.style.display = 'block'; } };
    const CS = window.CloudStore;
    if (!CS || !CS.isReady()) { show('Servidor indisponível. Verifique a internet.', 'warn'); return; }
    if (!email || !/.+@.+\..+/.test(email)) { show('Digite seu e-mail no campo acima e clique de novo em "Esqueci minha senha".', 'bad'); if (emailEl) emailEl.focus(); return; }
    show('Enviando e-mail de recuperação...', 'info');
    try {
      await CS.resetPassword(email);
      show('Enviamos um link de recuperação para ' + email + '. Abra o e-mail, clique no link e defina uma nova senha.', 'good');
    } catch (err) {
      show(this._friendlyAuthError(err), 'bad');
    }
  },
  // Quando o usuário volta pelo link de recuperação, pede a nova senha e a aplica.
  async promptNewPasswordAfterRecovery() {
    const CS = window.CloudStore;
    if (!CS || !CS.isReady()) return;
    const vals = await UI.prompt([
      { key: 'p1', label: 'Nova senha', type: 'password', placeholder: 'Mínimo 6 caracteres' },
      { key: 'p2', label: 'Confirme a nova senha', type: 'password', placeholder: 'Repita a senha' }
    ], { title: '🔑 Definir nova senha', sub: 'Você chegou pelo link de recuperação. Escolha uma nova senha.', okText: 'Salvar senha' });
    if (!vals) return;
    if (!vals.p1 || vals.p1.length < 6) { showToast('A senha precisa ter ao menos 6 caracteres'); return this.promptNewPasswordAfterRecovery(); }
    if (vals.p1 !== vals.p2) { showToast('As senhas não coincidem'); return this.promptNewPasswordAfterRecovery(); }
    try { await CS.changePassword(vals.p1); showToast('Senha alterada com sucesso ✓'); }
    catch (err) { showToast('Não foi possível alterar a senha: ' + (err.message || '')); }
  },
  useOffline() { this._offline = true; this.refreshStage(); showToast('Modo offline — os dados ficam só neste dispositivo'); },
  async gateLogout() {
    const CS = window.CloudStore;
    const logged = !!(CS && CS.isReady && CS.isReady() && CS.isLoggedIn());
    // Envia pendências antes de sair (nada se perde) — mas com TIMEOUT: se a rede
    // estiver ruim, o logout NÃO pode travar esperando o envio. Segue mesmo assim
    // (os dados continuam salvos no aparelho e sobem no próximo login).
    if (logged && CS.flushPending) {
      try {
        await Promise.race([
          CS.flushPending(),
          new Promise(res => setTimeout(res, 2500))
        ]);
      } catch (_) { _quiet(_); }
    }
    if (logged) { try { await CS.signOut(); } catch (e) { _quiet(e); } }
    this._offline = false;
    this._autoEnterTried = true;   // ao voltar, não auto-entra: mostra o login
    try { sessionStorage.removeItem(this.SESSION_KEY); } catch (e) { _quiet(e); }
    if (typeof showToast === 'function') showToast('Sessão encerrada ✓');
    // Recarrega para um estado 100% limpo. Sem isto o app continuava na tela
    // atual (logado por baixo), só com "Offline" no indicador — o reload faz o
    // boot() reabrir a tela de login corretamente.
    setTimeout(() => location.reload(), 200);
  },

  // Trocar de perfil: mostra o seletor de propósito (não auto-entra). O
  // auto-enter volta a valer no próximo login.
  switchProfile() { try { sessionStorage.removeItem(this.SESSION_KEY); } catch (e) { _quiet(e); } this._autoEnterTried = true; this.showGate(); },
  renderChipMobile() {
    const p = ProfileManager.getActiveProfile(); if (!p) return;
    const av = document.getElementById('mobile-profile-avatar'); if (av) { av.textContent = p.avatar; av.style.background = p.cor; }
    const nm = document.getElementById('mobile-profile-name'); if (nm) nm.textContent = p.nome;
  },
  renderChip() {
    this.renderChipMobile();
    const p = ProfileManager.getActiveProfile(); if (!p) return;
    const av = document.getElementById('profile-chip-avatar'); if (av) { av.textContent = p.avatar; av.style.background = p.cor; }
    const nm = document.getElementById('profile-chip-name'); if (nm) nm.textContent = p.nome;
    const eb = document.querySelector('#profile-chip .profile-chip-eyebrow');
    if (eb && p.meta && p.meta.concurso) eb.textContent = p.meta.concurso; else if (eb) eb.textContent = 'Perfil';
  },
  // ── Menu do perfil (abre ao clicar no chip do nome) ──
  _profileMenuEl: null,
  closeProfileMenu() {
    if (this._profileMenuEl) { this._profileMenuEl.remove(); this._profileMenuEl = null; }
    document.removeEventListener('click', this._pmOutside, true);
  },
  _pmOutside(e) {
    const m = ProfileUI._profileMenuEl;
    if (m && !m.contains(e.target) && !e.target.closest('#profile-chip, #mobile-profile-btn')) ProfileUI.closeProfileMenu();
  },
  _profileStats() {
    // números rápidos e reais para o cabeçalho do menu
    let regs = 0, horas = 0;
    try {
      const es = DB.getEntries();
      regs = es.length;
      horas = Math.round(es.reduce((s, e) => s + (e.durationMin || 0), 0) / 60);
    } catch (_) { _quiet(_); }
    return { regs, horas };
  },
  openProfileMenu(anchorEl) {
    this.closeProfileMenu();
    const p = ProfileManager.getActiveProfile(); if (!p) return;
    const others = ProfileManager.getProfiles().filter(x => x.id !== p.id);
    const st = this._profileStats();
    const meta = p.meta || {};
    const sub = meta.cargo || meta.concurso || 'Estudante';
    const m = document.createElement('div');
    m.className = 'profile-menu';
    m.innerHTML = `
      <div class="profile-menu-head">
        <span class="profile-menu-avatar" style="background:${p.cor}">${p.avatar}</span>
        <div class="profile-menu-id">
          <div class="profile-menu-name">${escapeHtml(p.nome)}</div>
          <div class="profile-menu-sub">${escapeHtml(sub)}</div>
        </div>
      </div>
      <div class="profile-menu-stats">
        <div class="profile-menu-stat"><b>${st.regs}</b><span>Registros</span></div>
        <div class="profile-menu-stat"><b>${st.horas}h</b><span>Estudadas</span></div>
        <div class="profile-menu-stat"><b>${meta.metaHoras ? meta.metaHoras + 'h' : '—'}</b><span>Meta/sem</span></div>
      </div>
      <div class="profile-menu-list">
        <button type="button" class="profile-menu-item" data-a="edit"><span class="ic">✎</span>Meus dados e perfil</button>
        ${others.length ? `<div class="profile-menu-sec">Trocar de perfil</div>` +
          others.slice(0, 4).map(o => `<button type="button" class="profile-menu-switch" data-switch="${o.id}"><span class="pm-av" style="background:${o.cor}">${o.avatar}</span><span class="pm-nm">${escapeHtml(o.nome)}</span></button>`).join('') +
          `<button type="button" class="profile-menu-item" data-a="manage"><span class="ic">⇄</span>Ver todos os perfis</button>` : ''}
        <button type="button" class="profile-menu-item danger" data-a="logout"><span class="ic">🚪</span>Sair da conta</button>
      </div>`;
    document.body.appendChild(m);
    this._profileMenuEl = m;
    // posiciona acima/ao lado do chip
    const r = anchorEl.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    let left = Math.min(Math.max(10, r.left), window.innerWidth - w - 10);
    let top = r.top - h - 8;
    if (top < 10) top = Math.min(r.bottom + 8, window.innerHeight - h - 10);
    m.style.left = left + 'px'; m.style.top = top + 'px';
    m.addEventListener('click', (e) => e.stopPropagation());
    m.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.switch;
      this.closeProfileMenu();
      // troca direta: define e entra nesse perfil
      this._autoEnterTried = true;
      this.enterProfile(id);
    }));
    m.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      this.closeProfileMenu();
      if (a === 'edit') this.openModal(p.id);
      else if (a === 'manage') this.switchProfile();
      else if (a === 'logout') this.gateLogout();
    }));
    setTimeout(() => document.addEventListener('click', this._pmOutside, true), 0);
  }
};
window.ProfileUI = ProfileUI;
