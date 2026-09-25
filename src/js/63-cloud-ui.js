/* ============================================================
   CLOUD UI — status da conta em Configurações (simplificado)
   ============================================================ */
const CloudUI = {
  render() {
    const authBox = document.getElementById('cloud-auth-box');
    const connBox = document.getElementById('cloud-connected-box');
    if (!authBox || !connBox) return;
    const logged = window.CloudStore && CloudStore.isReady() && CloudStore.isLoggedIn();
    authBox.style.display = logged ? 'none' : 'block';
    connBox.style.display = logged ? 'block' : 'none';
    if (logged) {
      const em = document.getElementById('cloud-user-email'); if (em) em.textContent = CloudStore.userEmail() || '—';
      const p = ProfileManager.getActiveProfile();
      const nm = document.getElementById('cloud-current-profile-name'); if (nm) nm.textContent = p ? p.nome : '—';
      const slotField = document.getElementById('cloud-slot-name'); if (slotField && slotField.closest('.field')) slotField.closest('.field').style.display = 'none';
      const auto = document.getElementById('cloud-autosync'); if (auto && auto.closest('label')) auto.closest('label').style.display = 'none';
      const slots = document.getElementById('cloud-slots-list'); if (slots) slots.innerHTML = '<p class="hint">A sincronização é automática. Use os botões acima só para forçar envio/baixa manual.</p>';
      if (CloudStore.serviceStatus === 'restricted') {
        this.setStatus('error', 'Banco restrito por cota do Supabase');
      } else if (CloudStore.serviceStatus === 'offline') {
        this.setStatus('error', 'Sem conexão com o banco');
      } else {
        this.setStatus('ok', 'Sincronização automática ativa');
      }
      this.renderQueue();
    }
  },
  /* ── FILA DE ENVIO ────────────────────────────────────────────────────────
     A pergunta que o usuário faz é simples — "o que eu marquei está salvo lá?".
     Aqui ela tem resposta direta: ou a fila está vazia (tudo entregue), ou ela
     lista o que falta subir. O que aparece nesta lista está guardado NESTE
     aparelho e não é apagado por nenhum download até ser entregue. */
  _nomeSecao(sec) {
    const s = String(sec || '');
    const semPlano = s.replace(/^p:[^:]+:/, '');
    const mapa = {
      entries: 'registros de estudo', subjects: 'matérias', methods: 'métodos', phases: 'fases',
      statuses: 'status das aulas', modes: 'modos de estudo', 'current-cycle': 'ciclo atual',
      'cycle-history': 'histórico de ciclos', tracks: 'trilha de Estudo Novo', tec: 'Desempenho TEC',
      'grade-template': 'grade semanal', 'saved-grades': 'grades salvas', 'custom-siglas': 'siglas',
      leis: 'leis', 'lei-keywords': 'palavras-chave das leis', decks: 'baralhos', cards: 'cards',
      links: 'links', incidencia: 'incidência', extras: 'atividades extras', revlog: 'histórico de revisões',
      'last-cycle-setup': 'preferências do ciclo', planejamentos: 'lista de planejamentos',
      'active-plan': 'planejamento ativo'
    };
    if (mapa[semPlano]) return mapa[semPlano];
    if (semPlano.indexOf('pref-') === 0 || semPlano.indexOf('painel:') === 0 || semPlano.indexOf('ux47:') === 0) return 'preferências de tela';
    return semPlano;
  },
  /* ── UM BOTÃO DE ENVIAR, NÃO DOIS ─────────────────────────────────────────
     Este método injetava um `<button id="cloud-queue-flush">↑ Enviar agora</button>`
     dentro de `#cloud-queue-box` — a poucos pixels do `#cloud-push-now`
     "↑ Enviar agora" que já existe no HTML, logo abaixo, na mesma caixa. Com a
     fila vazia só um aparecia e ninguém notava; com qualquer pendência os dois
     ficavam visíveis ao mesmo tempo, com o mesmo rótulo e a mesma seta, em
     duas linhas que quebravam em alturas diferentes. Era o "Enviar Agora duas
     vezes ao mesmo tempo, cascateado e quebrado".

     Dois botões com o mesmo texto não são redundância inofensiva: fazem
     duvidar se um deles envia outra coisa. Fica o do HTML, que é o que a linha
     de ações agrupa junto com "Baixar da nuvem"; este bloco volta a ser só o
     que ele deveria ter sido — o ESTADO da fila. O clique daquele botão passa
     por `CloudUX`, que já mostra progresso e reconsulta a fila.

     As seções pendentes deixam de ser um parágrafo com " · " no meio e viram
     etiquetas: com oito seções na fila, a frase corrida virava três linhas de
     texto cinza em que não se achava nenhuma. */
  renderQueue() {
    const box = document.getElementById('cloud-queue-box');
    if (!box) return;
    const rs = window.RelationalStore;
    const n = rs ? rs.pendingCount() : 0;
    const acoes = document.getElementById('cloud-push-now');
    if (!rs) {
      box.innerHTML = '<p class="cloud-queue-ok">⚠ Camada relacional indisponível.</p>';
      if (acoes) acoes.disabled = true;
      return;
    }
    if (!n && !rs._lastError) {
      box.innerHTML = '<p class="cloud-queue-ok">✓ <strong>Nada pendente.</strong> O estado exibido foi confirmado no banco.</p>';
      if (acoes) acoes.disabled = false;
      return;
    }
    if (rs._lastError) {
      box.innerHTML = '<p><strong>Falha ao confirmar no banco.</strong> A tela não considera a alteração persistida até o PostgreSQL responder.</p>';
      if (acoes) acoes.disabled = false;
      return;
    }
    box.innerHTML = '<p><strong>' + n + (n === 1 ? ' operação SQL em andamento' : ' operações SQL em andamento') +
      '.</strong> O indicador volta a verde somente após a confirmação do banco.</p>';
    if (acoes) acoes.disabled = false;
  },
  setStatus(tone, text) {
    // painel em Configurações (quando visível)
    const el = document.getElementById('cloud-sync-status');
    if (el) { el.className = 'cloud-status-sub ' + (tone === 'ok' ? '' : tone); el.innerHTML = '<span class="dot"></span>' + escapeHtml(text); }
    // botão sempre visível no topo
    this.refreshSyncBtn(tone, text);
  },
  _timeAgo(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'agora';
    const m = Math.round(s / 60);
    if (m < 60) return 'há ' + m + ' min';
    const h = Math.round(m / 60);
    return 'há ' + h + 'h';
  },
  // Atualiza o botão de sincronização do topo conforme o estado do CloudStore
  refreshSyncBtn(forceTone, forceText) {
    const btn = document.getElementById('cloud-sync-btn');
    if (!btn) return;

    const CS = window.CloudStore;
    const RS = window.RelationalStore;
    let tone = forceTone, text = forceText;
    let fila = 0;
    try { fila = RS && RS.pendingCount ? RS.pendingCount() : 0; }
    catch (e) { _quiet(e, 'sync-ui-pending'); }

    if (!tone) {
      if (!CS || !CS.isReady()) {
        tone = 'error'; text = 'Banco indisponível';
      } else if (CS.serviceStatus === 'restricted') {
        tone = 'error'; text = 'Banco restrito por cota do Supabase';
      } else if (CS.serviceStatus === 'offline') {
        tone = 'error'; text = 'Sem conexão com o banco';
      } else if (!CS.isLoggedIn()) {
        tone = 'off'; text = 'Entre para acessar o banco';
      } else if (RS && RS._lastError) {
        tone = 'error'; text = 'Falha ao confirmar no banco';
      } else if ((CS && CS._syncing) || fila > 0) {
        tone = 'syncing';
        text = fila > 0
          ? 'Salvando no banco · ' + fila + (fila === 1 ? ' operação' : ' operações')
          : 'Salvando no banco…';
      } else if ((RS && RS._lastSyncAt) || (CS && CS._lastSyncAt)) {
        const ts = (RS && RS._lastSyncAt) || CS._lastSyncAt;
        tone = 'ok'; text = 'Banco sincronizado ' + this._timeAgo(ts);
      } else {
        tone = 'ok'; text = 'Banco conectado';
      }
    }

    if (tone === 'ok') {
      const ts = (RS && RS._lastSyncAt) || (CS && CS._lastSyncAt);
      if (ts && !forceText) text = 'Banco sincronizado ' + this._timeAgo(ts);
    }

    if (tone === 'syncing') {
      clearTimeout(this._syncStuckT);
      this._syncStuckT = setTimeout(() => {
        try {
          const ainda = window.RelationalStore && RelationalStore.pendingCount
            ? RelationalStore.pendingCount() : 0;
          if (ainda > 0) this.refreshSyncBtn('error', 'Banco demorando para confirmar · toque para tentar de novo');
          else this.refreshSyncBtn();
        } catch (e) { _quiet(e, 'sync-ui-stuck'); }
      }, 12000);
    } else {
      clearTimeout(this._syncStuckT);
    }

    btn.className = 'cloud-sync-btn st-' + tone;
    btn.title = text || (tone === 'error'
      ? 'Erro no banco — toque para tentar de novo'
      : 'Persistência no banco');
  },
  async submitAuth() {
    const email = $id('cloud-email').value.trim();
    const password = $id('cloud-password').value;
    const msg = document.getElementById('cloud-auth-msg');
    msg.style.display = 'none';
    if (!window.CloudStore || !CloudStore.isReady()) { msg.textContent = 'Servidor indisponível.'; msg.style.color = 'var(--bad)'; msg.style.display = 'block'; return; }
    if (!email || password.length < 6) { msg.textContent = 'Informe e-mail e senha (mín. 6 caracteres).'; msg.style.color = 'var(--bad)'; msg.style.display = 'block'; return; }
    try {
      if (CloudStore._cfgMode === 'signup') { await CloudStore.signUp(email, password); msg.textContent = 'Conta criada! Se pedir, confirme por e-mail.'; msg.style.color = 'var(--good)'; msg.style.display = 'block'; }
      else { await CloudStore.signIn(email, password); showToast('Conectado à nuvem ✓'); }
      this.render();
    } catch (err) { msg.textContent = (err.message || 'Erro ao autenticar'); msg.style.color = 'var(--bad)'; msg.style.display = 'block'; }
  },
  async changePassword() {
    const CS = window.CloudStore;
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) { showToast('Entre na sua conta primeiro'); return; }
    const vals = await UI.prompt([
      { key: 'p1', label: 'Nova senha', type: 'password', placeholder: 'Mínimo 6 caracteres' },
      { key: 'p2', label: 'Confirme a nova senha', type: 'password', placeholder: 'Repita a senha' }
    ], { title: '🔑 Alterar senha', sub: 'Defina uma nova senha para ' + (CS.userEmail() || 'sua conta') + '.', okText: 'Salvar senha' });
    if (!vals) return;
    if (!vals.p1 || vals.p1.length < 6) { showToast('A senha precisa ter ao menos 6 caracteres'); return; }
    if (vals.p1 !== vals.p2) { showToast('As senhas não coincidem'); return; }
    try { await CS.changePassword(vals.p1); showToast('Senha alterada com sucesso ✓'); }
    catch (err) { showToast('Não foi possível alterar a senha: ' + (err.message || '')); }
  }
};

/* Estado do indicador = estado REAL das operações SQL. Sem "salvo localmente". */
CloudUI.refreshSyncBtn = function (forceTone, forceText) {
  const btn = document.getElementById('cloud-sync-btn');
  if (!btn) return;
  const CS = window.CloudStore;
  const RS = window.RelationalStore;
  let tone = forceTone, text = forceText;

  if (!tone) {
    if (!CS || !CS.isReady() || !CS.isLoggedIn()) {
      tone = 'off'; text = 'Banco desconectado';
    } else if (!RS) {
      tone = 'error'; text = 'Camada de dados indisponível';
    } else if (RS._lastError) {
      tone = 'error'; text = 'Falha ao salvar no banco';
    } else if (RS.pendingCount() > 0) {
      tone = 'syncing'; text = 'Salvando no banco…';
    } else if (RS._lastSyncAt) {
      tone = 'ok'; text = 'Banco sincronizado ' + this._timeAgo(RS._lastSyncAt);
    } else {
      tone = 'ok'; text = 'Banco conectado';
    }
  }

  btn.className = 'cloud-sync-btn st-' + tone;
  btn.title = text || 'Estado do banco';
  const el = document.getElementById('cloud-sync-status');
  if (el) {
    el.className = 'cloud-status-sub ' + (tone === 'ok' ? '' : tone);
    el.innerHTML = '<span class="dot"></span>' + escapeHtml(text || '');
  }
};
window.CloudUI = CloudUI;

/* ---- Listeners: portão de acesso ---- */
(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('gate-auth-submit', 'click', () => ProfileUI.submitGateAuth());
  on('gate-password', 'keydown', (e) => { if (e.key === 'Enter') ProfileUI.submitGateAuth(); });
  on('gate-email', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $id('gate-password').focus(); } });
  on('gate-pass-eye', 'click', () => {
    const inp = $id('gate-password'), btn = $id('gate-pass-eye'), ver = inp.type === 'password';
    inp.type = ver ? 'text' : 'password';
    btn.setAttribute('aria-pressed', ver ? 'true' : 'false');
    btn.setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
    btn.title = ver ? 'Ocultar senha' : 'Mostrar senha';
    inp.focus();
  });
  document.querySelectorAll('#gate-login .cloud-auth-tab').forEach(tab => tab.addEventListener('click', () => ProfileUI.setGateAuthMode(tab.dataset.gatemode)));

  on('gate-forgot-btn', 'click', () => ProfileUI.forgotPassword());
  on('gate-logout-btn', 'click', () => ProfileUI.gateLogout());
  on('pf-cancel', 'click', () => $id('profile-modal').style.display = 'none');
  on('profile-modal-close', 'click', () => $id('profile-modal').style.display = 'none');
  // Toggle "Opções avançadas" (substitui o <details> nativo p/ funcionar em todo navegador)
  on('pf-advanced-toggle', 'click', () => {
    const body = document.getElementById('pf-advanced-body');
    const tgl = document.getElementById('pf-advanced-toggle');
    if (!body || !tgl) return;
    const willOpen = body.hidden;
    body.hidden = !willOpen;
    tgl.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });
  on('pf-save', 'click', () => ProfileUI.saveModal());
  on('pf-delete', 'click', () => ProfileUI.deleteCurrent());
  on('pf-export', 'click', async () => {
    const id = ProfileUI._editingId;
    if (!id) return;
    const meta = (ProfileManager.getProfiles().find(p => p.id === id) || {});
    const btn = document.getElementById('pf-export');
    /* Backup é montado a partir de SELECTs relacionais. A projeção em memória
       existe só durante esta aba e nunca é usada como fonte persistente. */
    const temProjecao = () => {
      const prefix = 'diario-estudos:u:' + id + ':';
      for (let i = 0; i < localStorage.length; i++) { if ((localStorage.key(i) || '').startsWith(prefix)) return true; }
      return false;
    };
    if (!temProjecao()) {
      if (btn) { btn.disabled = true; btn.textContent = 'Buscando dados no banco...'; }
      try {
        if (!window.RelationalStore) throw new Error('Camada relacional indisponível');
        await RelationalStore.hydrateProfile(id, { reason: 'export-backup' });
      } catch (err) {
        showToast('Não foi possível consultar este perfil no banco: ' + (err.message || ''));
        if (btn) { btn.disabled = false; btn.textContent = '↓ Exportar backup deste perfil (.json)'; }
        return;
      }
      if (btn) { btn.disabled = false; btn.textContent = '↓ Exportar backup deste perfil (.json)'; }
    }
    const backup = ProfileManager.exportProfile(id);
    if (!backup || !Object.keys(backup.data || {}).length) {
      showToast('⚠ Este perfil ainda não tem dados salvos — nada para exportar.');
      return;
    }
    const nomeArq = 'backup-' + (meta.nome || 'perfil').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + todayLocal() + '.json';
    CardsScreen._download(nomeArq, JSON.stringify(backup, null, 2), 'application/json');
    showToast('Backup baixado ✓');
  });
  on('profile-chip', 'click', (e) => { e.stopPropagation(); ProfileUI.openProfileMenu(document.getElementById('profile-chip')); });
  on('sidebar-logout-btn', 'click', async (e) => {
    e.stopPropagation();
    if (!await UI.confirm('Sair da conta neste dispositivo?\n\nO que estiver pendente é enviado antes. Seus dados continuam salvos na nuvem.')) return;
    await ProfileUI.gateLogout();
  });
  on('mobile-profile-btn', 'click', (e) => { e.stopPropagation(); ProfileUI.openProfileMenu(document.getElementById('mobile-profile-btn')); });
  // ── Recolher / expandir a barra lateral (estado salvo) ──
  (function () {
    const shell = document.querySelector('.app-shell');
    const btn = document.getElementById('sidebar-collapse-btn');
    if (!shell || !btn) return;
    const KEY = 'diario-estudos:nav-collapsed';
    // dá um title a cada aba = seu rótulo (tooltip quando recolhida)
    document.querySelectorAll('#tabs .tab[data-screen]').forEach(t => {
      const lbl = t.querySelector('.tab-label');
      if (lbl && !t.title) t.title = lbl.textContent.trim();
    });
    const apply = (collapsed) => {
      shell.classList.toggle('nav-collapsed', collapsed);
      btn.setAttribute('aria-label', collapsed ? 'Expandir o menu' : 'Recolher o menu');
      btn.title = collapsed ? 'Expandir o menu' : 'Recolher o menu';
      const tx = btn.querySelector('.scb-txt'); if (tx) tx.textContent = collapsed ? 'Expandir' : 'Recolher menu';
    };
    let init = false; try { init = localStorage.getItem(KEY) === '1'; } catch (_) { _quiet(_); }
    apply(init);
    btn.addEventListener('click', () => {
      const now = !shell.classList.contains('nav-collapsed');
      apply(now);
      try { localStorage.setItem(KEY, now ? '1' : '0'); } catch (_) { _quiet(_); }
    });
  })();
  // Importar perfil de um backup: o botão existia no HTML mas ficava escondido e
  // sem nenhum clique ligado — a função ProfileManager.importProfile nunca era
  // alcançável pela interface. Importar cria SEMPRE um perfil novo, nunca
  // sobrescreve um existente.
  on('profile-import-btn', 'click', () => {
    const inp = document.getElementById('profile-import-file');
    if (inp) { inp.value = ''; inp.click(); }
  });
  on('profile-import-file', 'change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let obj;
      /* jsonSeguro em vez de JSON.parse: existe exatamente para isto — remove
         `__proto__`, `constructor` e `prototype` de QUALQUER json vindo de
         fora antes de ele encostar no estado do app. O arquivo aqui é
         escolhido pelo usuário, e o próprio fluxo avisa que um backup pode vir
         de um colega ou de um download. */
      try { obj = jsonSeguro(reader.result); }
      catch (_) { showToast('⚠ Arquivo inválido: não é um JSON válido.'); return; }
      if (!ProfileManager.validateBackup(obj)) {
        showToast('⚠ Este arquivo não é um backup do Diário de Estudos.'); return;
      }
      const qtd = Object.keys(obj.data || {}).length;
      if (!qtd) { showToast('⚠ Este backup está vazio — não há dados para importar.'); return; }
      const nomeOrig = (obj.profile && obj.profile.nome) || 'Perfil importado';
      const quando = obj.exportedAt ? formatDateShort(obj.exportedAt.slice(0, 10)) : 'data desconhecida';
      const ok = await UI.confirm(
        `Importar o perfil "${escapeHtml(nomeOrig)}"?\n\nBackup de ${quando} · ${qtd} conjunto(s) de dados.\n\nSerá criado um perfil NOVO. Nenhum perfil existente é alterado.`,
        { title: '↑ Importar perfil', okText: 'Importar' });
      if (!ok) return;
      try {
        // Se já existe um perfil com o mesmo nome, diferencia — dois cards
        // idênticos na tela de seleção seriam impossíveis de distinguir.
        const existentes = ProfileManager.getProfiles().map(p => (p.nome || '').trim().toLowerCase());
        let nomeFinal = nomeOrig.trim();
        if (existentes.includes(nomeFinal.toLowerCase())) {
          const sufixo = obj.exportedAt ? formatDateShort(obj.exportedAt.slice(0, 10)) : todayLocal();
          nomeFinal = nomeFinal + ' (importado ' + sufixo + ')';
        }
        if (!(window.CloudStore && CloudStore.isLoggedIn()) || !window.RelationalStore) {
          throw new Error('Entre na conta para importar o backup no banco.');
        }
        /* Cloud-first: o UUID real nasce no banco ANTES de qualquer dado do
           arquivo. Nunca existe um perfil temporário "só neste aparelho". */
        const avatar = (obj.profile && obj.profile.avatar) || '📘';
        const cor = (obj.profile && obj.profile.cor) || '#4f46e5';
        const row = await CloudStore.createRow({ name: nomeFinal, avatar, color: cor, payload: {} });
        ProfileManager.addMirror({ id: row.id, nome: nomeFinal, avatar, cor });
        const imp = await RelationalStore.replaceProfileFromPayload(row.id, obj.data || {}, { reason: 'json-import' });
        showToast(imp && imp.pendente
          ? 'Perfil importado; parte ainda está sendo enviada ao banco — não feche o app até o aviso sumir.'
          : 'Perfil importado no banco ✓');
        ProfileUI.refreshStage();
      } catch (err) {
        showToast('Erro ao importar: ' + (err.message || ''));
      }
    };
    reader.onerror = () => showToast('Não foi possível ler o arquivo.');
    reader.readAsText(file);
  });
  /* ---- Listeners: seção Nuvem em Configurações ---- */
  on('cloud-auth-submit', 'click', () => CloudUI.submitAuth());
  document.querySelectorAll('#cloud-auth-box .cloud-auth-tab').forEach(tab => tab.addEventListener('click', () => {
    CloudStore._cfgMode = tab.dataset.mode;
    document.querySelectorAll('#cloud-auth-box .cloud-auth-tab').forEach(t => t.classList.toggle('active', t === tab));
    const b = document.getElementById('cloud-auth-submit'); if (b) b.textContent = tab.dataset.mode === 'signup' ? 'Criar conta' : 'Entrar';
  }));
  on('cloud-signout', 'click', async () => { await CloudStore.signOut(); CloudUI.render(); showToast('Desconectado da nuvem'); });
  on('cloud-change-pass', 'click', () => CloudUI.changePassword());
  on('cloud-queue-refresh', 'click', () => CloudUI.renderQueue());
  on('cloud-push-now', 'click', () => CloudStore.autoSave());
  // "Baixar da nuvem" é semanticamente somente leitura: nunca publica o local antes.
  on('cloud-pull-now', 'click', () => CloudStore.pullActiveAndReload({ readOnly: true }));
  // Segurança da sessão em Configurações (mesmas chaves ux47 → persistem e ficam
  // em sincronia com onde quer que o app leia essas preferências).
  (function () {
    // usa o MESMO namespace do módulo UX47 (por perfil) — assim o menu do
    // indicador e esta tela leem/gravam exatamente as mesmas preferências.
    const apfx = () => { try { const pid = localStorage.getItem('diario-estudos:active-profile'); return pid ? ('diario-estudos:u:' + pid + ':ux47:') : 'diario-estudos:ux47:'; } catch (_) { return 'diario-estudos:ux47:'; } };
    const g = (k, d) => { try { const v = localStorage.getItem(apfx() + k); return v === null ? d : v; } catch (_) { return d; } };
    const s = (k, v) => DB.setRaw(apfx() + k, String(v));
    const im = document.getElementById('cfg-idle-mins');
    const sync = () => {
      if (im) im.value = g('idle-mins', '0');
    };
    if (im) im.addEventListener('change', () => { s('idle-mins', im.value); showToast(im.value === '0' ? 'Saída automática desligada' : 'Saída automática em ' + im.value + ' min'); });
    sync();
    window.addEventListener('screen:activated', (e) => { if (e.detail && e.detail.screen === 'config') sync(); });
  })();
  // Preferência "entrar direto" + seletor de PERFIL PADRÃO — reflete o estado salvo e persiste.
  (function () {
    const pae = document.getElementById('pref-auto-enter');
    const sel = document.getElementById('pref-default-profile');
    const fillDefaultSel = () => {
      if (!sel) return;
      const profs = (window.ProfileManager && ProfileManager.getProfiles) ? ProfileManager.getProfiles() : [];
      const cur = ProfileUI.getDefaultProfile() || '';
      sel.innerHTML = '<option value="">Último perfil usado</option>' +
        profs.map(p => `<option value="${p.id}" ${p.id === cur ? 'selected' : ''}>${escapeHtml(p.nome)}</option>`).join('');
      sel.disabled = !(pae && pae.checked);
    };
    if (pae) {
      pae.checked = ProfileUI.autoEnterOn();
      pae.addEventListener('change', () => {
        ProfileUI.setAutoEnter(pae.checked);
        if (sel) sel.disabled = !pae.checked;
        showToast(pae.checked ? 'O app abrirá direto no seu perfil' : 'O app perguntará o perfil ao abrir');
      });
    }
    if (sel) {
      sel.addEventListener('change', () => {
        ProfileUI.setDefaultProfile(sel.value || null);
        showToast(sel.value ? 'Perfil padrão definido ✓' : 'Usando o último perfil usado');
      });
    }
    // popula sempre que a tela de configurações for aberta (perfis podem ter mudado)
    fillDefaultSel();
    window.addEventListener('screen:activated', (e) => { if (e.detail && e.detail.screen === 'config') fillDefaultSel(); });
  })();
})();
window.addEventListener('screen:activated', (e) => { if (e.detail.screen === 'config' && window.CloudUI) CloudUI.render(); });

/* ---- Integração SQL relacional ---- */

(function () {
  const btn = document.getElementById('cloud-sync-btn');
  if (btn) btn.addEventListener('click', () => CloudStore.syncNow());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') CloudStore.syncOnFocus();
  });
  window.addEventListener('focus', () => CloudStore.syncOnFocus());
  window.addEventListener('online', () => {
    if (window.CloudUI) CloudUI.refreshSyncBtn();
    CloudStore.syncOnFocus({ force: true });
  });
  window.addEventListener('offline', () => {
    if (window.CloudUI) CloudUI.setStatus('error', 'Sem conexão com o banco');
  });

  /* Realtime continua sendo o caminho normal e imediato. O pulso abaixo é
     somente uma rede de segurança para um raro evento WebSocket perdido.
     Antes rodava a cada 30 s e gerava milhares de SELECTs por dia mesmo sem
     mudança; 10 min preservam a recuperação sem transformar o SQL em polling. */
  setInterval(() => {
    try {
      if (document.visibilityState === 'visible' && window.CloudStore) CloudStore.syncOnFocus();
    } catch (_) { _quiet(_); }
  }, 10 * 60 * 1000);

  setInterval(() => {
    try { if (window.CloudUI) CloudUI.refreshSyncBtn(); } catch (_) { _quiet(_); }
  }, 10000);

  setTimeout(() => { if (window.CloudUI) CloudUI.refreshSyncBtn(); }, 300);
})();

/* ---- Tamanho do texto (A− / A+): escala global, salva por perfil ---- */
(function () {
  const PASSOS = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.2, 1.3];
  const menor = document.getElementById('fs-menor');
  const maior = document.getElementById('fs-maior');
  function chave() { try { return DB._profilePrefix() + 'fs-scale'; } catch (_) { return 'diario-estudos:fs-scale'; } }
  function atual() {
    let v = 1;
    try { v = parseFloat(localStorage.getItem(chave())); } catch (_) { _quiet(_); }
    return PASSOS.includes(v) ? v : 1;
  }
  // Só PINTA: não grava. Antes, a abertura do app (ainda sem perfil) e a troca
  // de perfil regravavam o valor lido — "100%" antes de o banco responder.
  function pintar(v) {
    document.documentElement.style.setProperty('--fs-scale', String(v));
    const i = PASSOS.indexOf(v);
    if (menor) menor.disabled = (i <= 0);
    if (maior) maior.disabled = (i >= PASSOS.length - 1);
  }
  function aplicar(v, avisar) {
    pintar(v);
    DB.setRaw(chave(), String(v));
    if (avisar) showToast('Texto em ' + Math.round(v * 100) + '%');
  }
  function mover(d) {
    const i = PASSOS.indexOf(atual());
    const novo = PASSOS[Math.max(0, Math.min(PASSOS.length - 1, i + d))];
    aplicar(novo, true);
  }
  if (menor) menor.addEventListener('click', () => mover(-1));
  if (maior) maior.addEventListener('click', () => mover(1));
  pintar(atual());
  window.aplicarEscalaFonte = () => pintar(atual()); // reaplica ao trocar de perfil
  /* O valor é salvo POR PERFIL e só existe depois que o perfil é carregado do
     banco. Sem isto, ao sair e entrar de novo a tela ficava em 100% mesmo com
     o valor salvo. */
  window.addEventListener('profile:relational-ready', () => pintar(atual()));
})();

