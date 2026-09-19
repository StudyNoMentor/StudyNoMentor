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
      this.setStatus('ok', 'Sincronização automática ativa');
      this.renderQueue();
      this.renderSessions();
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
    let fila = [];
    try { if (window.SectionSync) fila = SectionSync.pendingSections(); } catch (_) { _quiet(_); }
    const acoes = document.getElementById('cloud-push-now');
    if (!fila.length) {
      box.innerHTML = '<p class="cloud-queue-ok">✓ <strong>Nada pendente.</strong> Tudo o que você registrou já está na nuvem e aparece ao entrar em outro aparelho.</p>';
      if (acoes) acoes.disabled = false;
      return;
    }
    const nomes = [...new Set(fila.map(s => this._nomeSecao(s)))];
    box.innerHTML = '<p><strong>' + fila.length +
      (fila.length === 1 ? ' alteração ainda não enviada' : ' alterações ainda não enviadas') +
      '.</strong> Está salvo neste aparelho e sobe sozinho assim que houver conexão — nada é perdido, e nenhum download apaga o que está aqui.</p>' +
      '<div class="cloud-queue-secoes" aria-label="Seções aguardando envio">' +
      nomes.map(n => '<span>' + escapeHtml(n) + '</span>').join('') + '</div>';
    if (acoes) acoes.disabled = false;
  },
  // Painel "Aparelho com sessão ativa" (login único entre dispositivos).
  async renderSessions() {
    const box = document.getElementById('cloud-sessions-list');
    if (!box) return;
    if (!window.SessionGuard) { box.innerHTML = '<p class="cloud-sessions-off">Controle de sessões indisponível nesta versão.</p>'; return; }
    if (SessionGuard.enabled === false) {
      box.innerHTML = '<div class="cloud-sessions-empty">✓ <strong>PC e celular podem permanecer conectados.</strong> A sincronização usa controle de revisão para conciliar alterações sem expulsar o outro aparelho.</div>';
      return;
    }
    box.innerHTML = '<p class="hint" style="text-align:center; padding:10px;">Carregando…</p>';
    const r = await SessionGuard.fetchActive();
    if (r.status === 'multi') {
      box.innerHTML = '<div class="cloud-sessions-empty">✓ <strong>PC e celular podem ficar conectados ao mesmo tempo.</strong> A sincronização usa revisão protegida e reconciliação de registros; apenas duas abas do mesmo navegador continuam evitando edição simultânea.</div>';
      return;
    }
    if (r.status === 'disabled') {
      box.innerHTML = '<div class="cloud-sessions-off">Controle remoto de sessão indisponível. A sincronização multiaparelho continua protegida pelas revisões dos dados; o bloqueio entre abas do mesmo navegador segue ativo.</div>';
      return;
    }
    if (r.status === 'offline') { box.innerHTML = '<div class="cloud-sessions-off">Sem conexão com a conta agora. Tente novamente.</div>'; return; }
    if (r.status === 'error') { box.innerHTML = '<div class="cloud-sessions-off">Não foi possível carregar: ' + escapeHtml(r.message || '') + '</div>'; return; }
    if (r.status === 'empty') {
      box.innerHTML = '<div class="cloud-sessions-empty">Nenhuma sessão registrada ainda. Ela aparece assim que você usar a conta em um aparelho.</div>';
      return;
    }
    // status 'ok'
    const row = r.row;
    const isThis = r.isThisDevice;
    const quando = row.updated_at ? new Date(row.updated_at).toLocaleString('pt-BR') : '';
    const nome = escapeHtml(row.device_label || 'Aparelho');
    const idCurto = escapeHtml(String(row.device_id || '').slice(0, 8));
    if (isThis) {
      box.innerHTML = `<div class="sess-card is-this">
        <span class="sess-ico">💻</span>
        <div class="sess-info">
          <div class="sess-name">${nome} <span class="sess-badge this">este aparelho</span></div>
          <div class="sess-meta">ativo desde ${escapeHtml(quando)} · id ${idCurto}</div>
        </div>
      </div>
      <p class="hint" style="margin:8px 0 0;">Esta é a única sessão ativa. Ao entrar em outro aparelho, ele assume e esta é encerrada automaticamente.</p>`;
    } else {
      box.innerHTML = `<div class="sess-card">
        <span class="sess-ico">📱</span>
        <div class="sess-info">
          <div class="sess-name">${nome} <span class="sess-badge other">outro aparelho</span></div>
          <div class="sess-meta">ativo desde ${escapeHtml(quando)} · id ${idCurto}</div>
        </div>
        <div class="sess-actions">
          <button type="button" class="btn-primary" id="cloud-sess-endother">Encerrar e usar aqui</button>
        </div>
      </div>
      <p class="hint" style="margin:8px 0 0;">Este aparelho (${escapeHtml(r.thisLabel)}) não está com a sessão. "Encerrar e usar aqui" bloqueia o outro e traz a sessão para cá.</p>`;
      const btn = document.getElementById('cloud-sess-endother');
      if (btn) btn.addEventListener('click', async () => {
        const ok = await UI.confirm('Encerrar a sessão em "' + (row.device_label || 'outro aparelho') + '" e trazer a sessão para este aparelho?\n\nO outro aparelho será bloqueado e sua sincronização, pausada.', { title: '📵 Encerrar sessão', okText: 'Encerrar e usar aqui' });
        if (!ok) return;
        btn.disabled = true; btn.textContent = 'Encerrando…';
        const done = await SessionGuard.endRemoteAndClaimHere();
        if (done) { showToast('Sessão trazida para este aparelho ✓'); }
        else { showToast('Não foi possível agora — verifique a internet'); }
        this.renderSessions();
      });
    }
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
    let tone = forceTone, text = forceText;
    // Fila real de envio (sobrevive a recarregamentos).
    let fila = 0;
    try { if (window.SectionSync) fila = SectionSync.pendingQuick(); } catch (_) { _quiet(_); }
    // Sessão em outro aparelho não é, por si só, erro. Se estamos entregando a
    // outbox anterior, mostra envio real; depois fica neutro/pausado. Vermelho
    // fica reservado para conflito/falha de transporte.
    if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') {
      if (window.SessionGuard && SessionGuard._handoffDraining) {
        tone = 'syncing'; text = 'Entregando alteração pendente antes de pausar…';
      } else if (fila) {
        const hs = window.SessionGuard && SessionGuard._handoffLast ? SessionGuard._handoffLast.status : '';
        tone = hs === 'erro' || hs === 'pendente' ? 'error' : 'pending';
        text = hs === 'erro' || hs === 'pendente'
          ? 'Alteração preservada neste aparelho · envio pendente'
          : 'Salvo neste aparelho · aguardando entrega';
      } else {
        tone = 'off'; text = 'Pausado · conta ativa em outro aparelho';
      }
    }
    // Estado tranquilizador — o app salva SEMPRE no aparelho na hora. O spinner
    // (azul) só aparece durante um envio REAL e curto; o resto é verde "ok".
    if (!tone) {
      if (!CS || !CS.isReady() || !CS.isLoggedIn()) { tone = 'off'; text = 'Salvo neste aparelho'; }
      else if (CS._syncing) { tone = 'syncing'; text = 'Enviando para a nuvem…'; }
      else if (CS._pending || CS._debounce || fila) { tone = 'ok'; text = fila ? ('Salvo · ' + fila + (fila === 1 ? ' alteração aguardando envio' : ' alterações aguardando envio')) : 'Salvo · será enviado em instantes'; }
      else if (CS._lastSyncAt) { tone = 'ok'; text = 'Sincronizado ' + this._timeAgo(CS._lastSyncAt); }
      else { tone = 'ok'; text = 'Sincronizado'; }
    } else {
      if (tone === 'pending') { tone = 'ok'; text = 'Salvo · será enviado em instantes'; }
      if (tone === 'off') text = 'Salvo neste aparelho';
      if (tone === 'ok' && CS && CS._lastSyncAt) text = 'Sincronizado ' + this._timeAgo(CS._lastSyncAt);
    }
    // Trava anti-"eterno-Salvando": se ficar em syncing por muito tempo, cai para ok.
    if (tone === 'syncing') {
      clearTimeout(this._syncStuckT);
      this._syncStuckT = setTimeout(() => { try { this.refreshSyncBtn('ok', 'Salvo neste aparelho'); } catch (_) { _quiet(_); } }, 8000);
    } else {
      clearTimeout(this._syncStuckT);
    }
    btn.className = 'cloud-sync-btn st-' + tone;
    btn.title = (tone === 'error') ? (text || 'Erro na sincronização — toque para tentar de novo')
      : (text || 'Sincronização');
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
        await RelationalStore.replaceProfileFromPayload(row.id, obj.data || {}, { reason: 'json-import' });
        showToast('Perfil importado no banco ✓');
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
  on('cloud-sessions-refresh', 'click', () => CloudUI.renderSessions());
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
    const ss = document.getElementById('cfg-single-session');
    const im = document.getElementById('cfg-idle-mins');
    const sync = () => {
      if (ss) ss.checked = g('single-session', '0') === '1';
      if (im) im.value = g('idle-mins', '0');
    };
    if (ss) {
      ss.checked = false;
      ss.disabled = true;
      const row = ss.closest('label') || ss.parentElement;
      if (row) row.style.display = 'none';
    }
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
_cloudNotifyHook = () => CloudStore.notifyChange();

(function () {
  const btn = document.getElementById('cloud-sync-btn');
  if (btn) btn.addEventListener('click', () => CloudStore.syncNow());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') CloudStore.syncOnFocus();
  });
  window.addEventListener('focus', () => CloudStore.syncOnFocus());
  window.addEventListener('online', () => {
    if (window.CloudUI) CloudUI.refreshSyncBtn();
    CloudStore.syncOnFocus();
  });
  window.addEventListener('offline', () => {
    if (window.CloudUI) CloudUI.setStatus('error', 'Sem conexão com o banco');
  });

  /* Realtime acelera. Este pulso é a rede de segurança contra qualquer evento
     WebSocket perdido: consulta a cópia canônica no SQL enquanto a aba está ativa. */
  setInterval(() => {
    try {
      if (document.visibilityState === 'visible' && window.CloudStore) CloudStore.syncOnFocus();
    } catch (_) { _quiet(_); }
  }, 30000);

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
  function aplicar(v, avisar) {
    document.documentElement.style.setProperty('--fs-scale', String(v));
    DB.setRaw(chave(), String(v));
    const i = PASSOS.indexOf(v);
    if (menor) menor.disabled = (i <= 0);
    if (maior) maior.disabled = (i >= PASSOS.length - 1);
    if (avisar) showToast('Texto em ' + Math.round(v * 100) + '%');
  }
  function mover(d) {
    const i = PASSOS.indexOf(atual());
    const novo = PASSOS[Math.max(0, Math.min(PASSOS.length - 1, i + d))];
    aplicar(novo, true);
  }
  if (menor) menor.addEventListener('click', () => mover(-1));
  if (maior) maior.addEventListener('click', () => mover(1));
  aplicar(atual(), false);
  window.aplicarEscalaFonte = () => aplicar(atual(), false); // reaplica ao trocar de perfil
})();

/* ============================================================================
   SESSÃO ÚNICA — controlador central do bloqueio
   Duas camadas cooperam:
     · LOCAL  (SessionLock._local): abas/janelas do MESMO navegador, via
       BroadcastChannel — instantâneo e sem custo de rede.
     · REMOTO (SessionGuard, no CloudStore): entre DISPOSITIVOS diferentes,
       via Supabase Realtime — quem entra por último "assume" a conta e os
       demais aparelhos são bloqueados de verdade (login único real).
   O overlay é compartilhado; a mensagem muda conforme a origem do bloqueio.
   ============================================================================ */
window.SessionLock = {
  enabled: false,       // sem bloqueio entre abas/janelas/aparelhos; concorrência é resolvida nos dados
  _blocked: false,
  _origin: null,          // 'local' | 'remote'
  _takeoverFns: [],       // callbacks de "Usar aqui" (uma por camada)
  isBlocked() { return this.enabled ? this._blocked : false; },
  _els() {
    return {
      o: document.getElementById('single-session-overlay'),
      ico: document.getElementById('ss-ico'),
      t: document.getElementById('ss-title'),
      d: document.getElementById('ss-desc'),
      s: document.getElementById('ss-sub'),
      take: document.getElementById('single-session-takeover')
    };
  },
  // Exibe o bloqueio. kind: 'local' (outra aba) | 'remote' (outro aparelho).
  block(kind, info) {
    if (!this.enabled) { this._blocked = false; this._origin = null; const z = this._els(); if (z.o) z.o.style.display = 'none'; return; }
    this._blocked = true; this._origin = kind;
    const e = this._els(); if (!e.o) return;
    if (kind === 'remote') {
      if (e.ico) e.ico.textContent = '📵';
      if (e.t) e.t.textContent = 'Sessão aberta em outro aparelho';
      if (e.d) e.d.innerHTML = 'Sua conta foi aberta em <strong>outro dispositivo</strong>' + (info && info.label ? ' (' + escapeHtml(info.label) + ')' : '') + '. Para proteger seus dados, o Diário mantém <strong>um aparelho ativo por vez</strong> — a sincronização foi <strong>pausada aqui</strong>.';
      if (e.s) e.s.textContent = 'Se foi você, pode continuar neste aparelho: isso vai encerrar a sessão no outro.';
      if (e.take) { e.take.disabled = false; e.take.textContent = 'Continuar neste aparelho'; }
    } else {
      if (e.ico) e.ico.textContent = '🔒';
      if (e.t) e.t.textContent = 'Diário já aberto em outra janela';
      if (e.d) e.d.innerHTML = 'Para proteger seus dados, o Diário funciona em <strong>uma aba/janela por vez</strong> neste navegador.';
      if (e.s) e.s.textContent = 'Continuar em duas ao mesmo tempo pode misturar registros e sobrescrever a sincronização.';
      if (e.take) { e.take.disabled = false; e.take.textContent = 'Usar aqui (encerrar as outras)'; }
    }
    e.o.style.display = 'flex';
  },
  unblock() {
    this._blocked = false; this._origin = null;
    const e = this._els();
    if (e.take) e.take.disabled = false;
    if (e.o) e.o.style.display = 'none';
  },
  onTakeover(fn) { if (typeof fn === 'function') this._takeoverFns.push(fn); },
  _fireTakeover() { this._takeoverFns.forEach(fn => { try { fn(this._origin); } catch (_) { _quiet(_); } }); },
  init() {
    const e = this._els();
    if (!this.enabled) { if (e.o) e.o.style.display = 'none'; return; }
    if (e.take) e.take.addEventListener('click', () => {
      const origin = this._origin;
      /* Local: podemos liberar imediatamente porque o BroadcastChannel é deste
         próprio navegador. Remoto: o overlay só fecha DEPOIS de o Supabase
         confirmar o takeover. Assim um toque não cria uma janela em que o app
         parece liberado antes de a posse existir no servidor. */
      if (origin === 'local') this.unblock();
      else if (origin === 'remote') {
        e.take.disabled = true;
        e.take.textContent = 'Confirmando…';
      }
      this._takeoverFns.forEach(fn => { try { fn(origin); } catch (_) { _quiet(_); } });
    });
    const r = document.getElementById('single-session-reload');
    if (r) r.addEventListener('click', () => recarregarApp('recarga pedida no aviso de sessão', { imediato: true }));
  }
};

/* O SessionGuard foi carregado antes deste arquivo. Agora que SessionLock
   realmente existe, liga o takeover REMOTO. Sem esta chamada o botão ficava
   eternamente em "Confirmando…" porque nenhum callback remoto estava registrado. */
try { if (window.SessionGuard && SessionGuard.bindSessionLock) SessionGuard.bindSessionLock(); } catch (_) { _quiet(_); }

/* ---- Camada LOCAL: uma aba/janela por vez (BroadcastChannel) ---- */
(function () {
  if (!SessionLock.enabled) return;
  let bc = null;
  try { bc = ('BroadcastChannel' in window) ? new BroadcastChannel('diario-estudos-single') : null; } catch (_) { bc = null; }
  if (!bc) return;
  const myId = Math.random().toString(36).slice(2);
  const myStart = Date.now();
  const outraEhDona = (m) => (m.start < myStart) || (m.start === myStart && m.id < myId);
  bc.onmessage = (e) => {
    const m = e.data || {};
    if (!m || m.id === myId) return;
    if (m.type === 'hello') { if (!(SessionLock.isBlocked() && SessionLock._origin === 'local')) bc.postMessage({ type: 'here', id: myId, start: myStart }); }
    else if (m.type === 'here') { if (outraEhDona(m)) SessionLock.block('local'); }
    else if (m.type === 'takeover') { if (m.id !== myId) SessionLock.block('local'); }
  };
  SessionLock.onTakeover((origin) => { if (origin === 'local') { try { bc.postMessage({ type: 'takeover', id: myId, start: myStart }); } catch (_) { _quiet(_); } } });
  try { bc.postMessage({ type: 'hello', id: myId, start: myStart }); } catch (_) { _quiet(_); }
  try { window.addEventListener('beforeunload', () => { try { bc.postMessage({ type: 'bye', id: myId }); } catch (_) { _quiet(_); } }); } catch (_) { _quiet(_); }
})();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => SessionLock.init());
else SessionLock.init();
