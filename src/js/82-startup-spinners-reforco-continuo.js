/* ============================================================================
   STARTUP + LOADERS + REFORÇO CONTÍNUO V4
   ----------------------------------------------------------------------------
   1) abre o perfil LOCAL primeiro quando a identidade já é segura neste aparelho;
   2) reconcilia a nuvem depois, sem manter o usuário preso no gate;
   3) normaliza todos os spinners/loaders visíveis e dá mensagem operacional;
   4) cria a ponte entre doses adaptativas quando o TEC só é reimportado dias depois.

   A ponte NÃO inventa uma nova medição: enquanto o snapshot não muda, a confiança
   estatística permanece a mesma. Ela apenas decide quanto esforço adicional ainda
   é razoável antes de exigir nova evidência e, sobretudo, força rodízio para não
   martelar o mesmo assunto no mesmo dia.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__startupSpinnerReforco) return;
  window.__startupSpinnerReforco = true;

  const quiet = (e, tag) => { try { if (typeof _quiet === 'function') _quiet(e, tag || 'ux-v4'); } catch (ignored) { void ignored; } };
  const norm = (s) => {
    try { if (window.ReforcoEngine && ReforcoEngine.norm) return ReforcoEngine.norm(s || ''); } catch (e) { quiet(e, 'ux-v4-norm'); }
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };
  const today = () => { try { return todayLocal(); } catch (_) { return new Date().toISOString().slice(0, 10); } };

  /* ── TELEMETRIA LOCAL DE STARTUP ──────────────────────────────────────────
     Não envia nada para fora. Serve para diagnosticar exatamente onde um login
     ficou lento: autenticação, abertura local ou reconciliação remota. */
  const StartupTrace = {
    KEY: 'diario-estudos:startup-v4:last',
    startedAt: performance && performance.now ? performance.now() : Date.now(),
    marks: [],
    mark(etapa, extra) {
      const t = performance && performance.now ? performance.now() : Date.now();
      const item = { etapa, ms: Math.max(0, Math.round(t - this.startedAt)), em: new Date().toISOString(), ...(extra || {}) };
      this.marks.push(item);
      try { sessionStorage.setItem(this.KEY, JSON.stringify(this.marks)); } catch (e) { quiet(e, 'startup-trace'); }
      return item;
    },
    last() {
      try { return JSON.parse(sessionStorage.getItem(this.KEY) || '[]'); } catch (_) { return this.marks.slice(); }
    },
    table() { try { console.table(this.last()); } catch (e) { quiet(e, 'startup-trace-table'); } return this.last(); }
  };
  window.StartupTrace = StartupTrace;
  StartupTrace.mark('camada-v4-pronta');

  /* ── LOADERS / SPINNERS ────────────────────────────────────────────────── */
  const LoaderUX = {
    _seen: new WeakMap(),
    _observer: null,
    _timer: null,
    spinnerSelector: '.app-loading-spin,.gate-spinner,.loading-spinner,.tec-loading-spinner,.conq-spinner,.screen-loading-spinner,.csb-spin,[class*="spinner"],[class*="loading-spin"]',
    messageFor(el) {
      const host = el && el.closest ? el.closest('.screen,[id^="screen-"],#profile-gate,#app-loading') : null;
      const id = host && host.id || '';
      if (id === 'app-loading') return ['Preparando seus estudos deste aparelho…', 'Estrutura local, preferências e dados salvos.'];
      if (id === 'profile-gate') return ['Abrindo seu perfil…', 'A nuvem será conferida sem bloquear seus estudos sempre que houver cópia local segura.'];
      if (/desempenhotec/i.test(id)) return ['Calculando seu Desempenho TEC…', 'Escopo, métricas e Plano estão sendo atualizados.'];
      if (/conquist/i.test(id)) return ['Atualizando suas conquistas…', 'Conferindo metas, marcos e progresso acumulado.'];
      if (/extras/i.test(id)) return ['Organizando suas Atividades Extras…', 'Reforços, saldos e agenda estão sendo conciliados.'];
      if (/leis/i.test(id)) return ['Preparando suas leis…', 'Leituras, marcadores e rodízio estão sendo atualizados.'];
      if (/cards/i.test(id)) return ['Preparando seus cards…', 'Fila de revisão e agendamento estão sendo calculados.'];
      if (/evolucao/i.test(id)) return ['Atualizando sua evolução…', 'Consolidando seus registros e indicadores.'];
      return ['Atualizando esta tela…', 'O processamento continua em andamento.'];
    },
    visible(el) {
      if (!el || !el.isConnected) return false;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    },
    decorateSpinner(el) {
      if (!el || el.nodeType !== 1) return;
      el.classList.add('uxv4-spinner');
      if (!el.getAttribute('aria-hidden') && !el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Processando');
      const inButton = !!el.closest('button,[role="button"]');
      if (inButton) return; // botão já tem rótulo próprio; não injeta texto nele.
      let parent = el.parentElement; if (!parent) return;
      const known = parent.matches('#app-loading,.gate-entering-box,[class*="loading"],[class*="loader"],[role="status"]') ||
        !!parent.closest('#app-loading,#gate-entering');
      if (!known) return;
      const [main, sub] = this.messageFor(el);
      let copy = parent.querySelector(':scope > .uxv4-loader-copy');
      if (!copy && !parent.querySelector('.app-loading-txt,.gate-entering-text,.gate-entering-sub')) {
        copy = document.createElement('span'); copy.className = 'uxv4-loader-copy'; parent.appendChild(copy);
      }
      if (copy && !copy.dataset.manual) copy.innerHTML = `${main}<small>${sub}</small>`;
      if (!parent.getAttribute('role')) parent.setAttribute('role', 'status');
      parent.setAttribute('aria-live', 'polite'); parent.setAttribute('aria-busy', 'true');
      if (!this._seen.has(el)) this._seen.set(el, Date.now());
    },
    decorate(root) {
      root = root && root.querySelectorAll ? root : document;
      try { root.querySelectorAll(this.spinnerSelector).forEach(el => this.decorateSpinner(el)); } catch (e) { quiet(e, 'loader-decorate'); }
      // textos conhecidos recebem contexto mesmo quando já existiam antes da camada v4.
      const app = document.querySelector('#app-loading .app-loading-txt');
      if (app && !app.dataset.uxv4) { app.dataset.uxv4 = '1'; app.textContent = 'Preparando seus estudos…'; }
      const gate = document.querySelector('#gate-entering .gate-entering-sub');
      if (gate && !gate.dataset.uxv4) { gate.dataset.uxv4 = '1'; gate.textContent = 'Abrindo os dados deste aparelho com segurança.'; }
    },
    watchdog() {
      document.querySelectorAll(this.spinnerSelector).forEach(el => {
        if (!this.visible(el)) { this._seen.delete(el); return; }
        if (!this._seen.has(el)) this._seen.set(el, Date.now());
        const age = Date.now() - this._seen.get(el);
        const p = el.parentElement; if (!p) return;
        const copy = p.querySelector(':scope > .uxv4-loader-copy');
        if (copy && age > 8000 && !copy.dataset.slow) {
          copy.dataset.slow = '1';
          const [main] = this.messageFor(el);
          copy.innerHTML = `${main}<small>Ainda processando. Seus dados locais continuam seguros.</small>`;
        }
        if (copy && age > 20000) {
          copy.dataset.slow = '1';
          copy.innerHTML = `Isso está demorando mais que o normal.<small>A rede ou o volume de dados podem estar lentos. O app não apagou seus estudos.</small>`;
        }
      });
    },
    init() {
      this.decorate(document);
      if (document.body && !this._observer) {
        this._observer = new MutationObserver(ms => ms.forEach(m => (m.addedNodes || []).forEach(n => {
          if (!n || n.nodeType !== 1) return;
          if (n.matches && n.matches(this.spinnerSelector)) this.decorateSpinner(n);
          this.decorate(n);
        })));
        this._observer.observe(document.body, { childList: true, subtree: true });
      }
      if (!this._timer) this._timer = setInterval(() => this.watchdog(), 1000);
    }
  };
  window.LoaderUX = LoaderUX;
  LoaderUX.init();

  function gateMessage(main, sub, localFirst) {
    try {
      const box = document.getElementById('gate-entering');
      const a = box && box.querySelector('.gate-entering-text');
      const b = box && box.querySelector('.gate-entering-sub');
      if (a && main) a.textContent = main;
      if (b && sub) b.textContent = sub;
      if (box) box.dataset.localFirst = localFirst ? '1' : '0';
    } catch (e) { quiet(e, 'gate-message'); }
  }

  function syncNote(text) {
    try {
      let el = document.querySelector('.uxv4-sync-note');
      if (!text) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement('div'); el.className = 'uxv4-sync-note'; el.innerHTML = '<span class="uxv4-mini-spin"></span><span></span>'; document.body.appendChild(el); }
      el.querySelector('span:last-child').textContent = text;
    } catch (e) { quiet(e, 'sync-note'); }
  }

  /* ── ABERTURA LOCAL-FIRST ──────────────────────────────────────────────── */
  const RECON_KEY = 'diario-estudos:uxv4-reconcile';
  async function reconcileProfile(id) {
    if (!id || !window.CloudStore || !CloudStore.isReady || !CloudStore.isReady() || !CloudStore.isLoggedIn || !CloudStore.isLoggedIn()) return false;
    if (window.ProfileManager && ProfileManager.getActiveProfileId && ProfileManager.getActiveProfileId() !== id) return false;
    StartupTrace.mark('reconciliacao-inicio');
    syncNote('Conferindo novidades da nuvem em segundo plano…');
    try {
      // Primeiro entrega o que este aparelho ainda não enviou. Só depois pergunta
      // se a nuvem tem algo mais novo — evita download apagar uma edição local.
      let pend = 0;
      try { if (window.SectionSync) pend = SectionSync.pendingQuick(); } catch (e) { quiet(e, 'reconcile-pend'); }
      if (pend && CloudStore.flushPending) await CloudStore.flushPending();

      let novidade = false;
      if (window.SectionSync && SectionSync.readEnabled) novidade = await SectionSync.hasRemoteUpdates(id);
      else if (CloudStore._fetchRev) {
        const rr = await CloudStore._fetchRev(id); novidade = rr != null && rr > ProfileManager.getRev(id);
      }
      if (novidade) {
        syncNote('Há novidades de outro aparelho. Atualizando com segurança…');
        if (window.SectionSync && SectionSync.readEnabled) await SectionSync.pullAndReload();
        else if (CloudStore.pullActiveAndReload) await CloudStore.pullActiveAndReload();
      } else {
        try { if (window.SectionSync) SectionSync.kick(); } catch (e) { quiet(e, 'reconcile-kick'); }
        StartupTrace.mark('reconciliacao-sem-novidade');
      }
      return true;
    } catch (e) {
      quiet(e, 'reconciliacao-v4');
      StartupTrace.mark('reconciliacao-adiada', { erro: String(e && e.message || e || '') });
      return false;
    } finally {
      setTimeout(() => syncNote(''), 650);
    }
  }

  function scheduleReconcile(id) {
    let tent = 0;
    const run = () => {
      tent++;
      if (window.CloudStore && CloudStore.isReady && CloudStore.isReady() && CloudStore.isLoggedIn && CloudStore.isLoggedIn()) {
        try { sessionStorage.removeItem(RECON_KEY); } catch (e) { quiet(e, 'reconcile-key'); }
        setTimeout(() => reconcileProfile(id), 220);
        return;
      }
      if (tent < 30) setTimeout(run, 250);
      else StartupTrace.mark('reconciliacao-sem-sessao');
    };
    setTimeout(run, 80);
  }

  function installLocalFirst() {
    if (!window.ProfileUI || ProfileUI._uxv4LocalFirst || typeof ProfileUI.enterProfile !== 'function') return;
    ProfileUI._uxv4LocalFirst = true;
    const original = ProfileUI.enterProfile.bind(ProfileUI);
    ProfileUI.enterProfile = async function (id) {
      const logged = !!(window.CloudStore && CloudStore.isLoggedIn && CloudStore.isLoggedIn());
      const uid = logged && CloudStore.session && CloudStore.session.user ? CloudStore.session.user.id : null;
      let has = false, can = true;
      try { has = !!((this._hasLocalData && this._hasLocalData(id)) || (window.ProfileManager && ProfileManager.temDadosLocais && ProfileManager.temDadosLocais(id))); } catch (e) { quiet(e, 'local-first-has'); }
      try { if (ProfileManager._podeVerLocal) can = !!ProfileManager._podeVerLocal(id, uid); } catch (e) { can = false; quiet(e, 'local-first-owner'); }

      // Sessão autenticada + dado local pertencente à conta: a rede não precisa
      // ficar no caminho crítico. A lista de perfis já confirmou o alvo quando
      // chegamos aqui pelo auto-enter; nos demais caminhos a marca de proprietário
      // local impede abrir dado de outra conta.
      if (logged && has && can) {
        const ativoAntes = ProfileManager.getActiveProfileId();
        StartupTrace.mark('perfil-local-encontrado', { mesmoPerfil: ativoAntes === id });
        this._autoEnterTried = true; this._entering = true;
        gateMessage('Abrindo seus estudos deste aparelho…', 'Você já pode entrar; a nuvem será conferida em segundo plano.', true);
        try { ProfileManager.setActiveProfile(id); if (ProfileManager._setOwner && uid) ProfileManager._setOwner(id, uid); } catch (e) { quiet(e, 'local-first-active'); }
        try { if (window.PlanManager) PlanManager.init(); } catch (e) { quiet(e, 'local-first-plan'); }
        try { sessionStorage.setItem(this.SESSION_KEY, id); sessionStorage.setItem(RECON_KEY, id); } catch (e) { quiet(e, 'local-first-session'); }
        try { this.setLastProfile(id); } catch (e) { quiet(e, 'local-first-last'); }

        if (ativoAntes === id) {
          this._entering = false;
          try { this.hideGate(); this.renderChip(); } catch (e) { quiet(e, 'local-first-hide'); }
          try { DB.checarEspaco(); } catch (e) { quiet(e, 'local-first-space'); }
          StartupTrace.mark('perfil-local-visivel');
          scheduleReconcile(id);
          return true;
        }

        // Outro perfil local: troca o namespace e recarrega IMEDIATAMENTE a partir
        // do armazenamento local. Não espera hydrate/fetchPayload antes do reload.
        StartupTrace.mark('troca-perfil-local-reload');
        if (typeof recarregarApp === 'function') recarregarApp('troca local-first de perfil', { imediato: true });
        else location.reload();
        return true;
      }

      gateMessage('Baixando seu perfil…', 'Este aparelho ainda precisa receber os dados necessários antes de abrir.', false);
      StartupTrace.mark('perfil-remoto-necessario');
      return original(id);
    };

    /* ═══ ABRIR O APP SEM CONFERIR A NUVEM ERA O CAMINHO MAIS COMUM ═════════
       A reconciliação de abertura — "a nuvem tem algo mais novo que este
       aparelho?" — só era agendada quando `RECON_KEY` estava no sessionStorage,
       e esse marcador é posto em UM lugar: o `enterProfile` envolvido aqui, ou
       seja, quando se passa pela lista de perfis. Ele é consumido (removido) na
       primeira reconciliação.

       Só que `ProfileUI.boot()` tem um atalho de ENTRADA DIRETA: se
       `sessionStorage[SESSION_KEY]` aponta para o perfil ativo e existe dado
       local, ele fecha o portão e retorna — sem ler nada da nuvem. E
       `sessionStorage` SOBREVIVE a um recarregamento da mesma aba. Então a
       sequência real do dia a dia era:

         1. entrar no perfil     → RECON_KEY posto, reconcilia, RECON_KEY some;
         2. sai uma versão nova  → `recarregarApp()` recarrega a MESMA aba;
         3. `boot()` vê SESSION_KEY e entra direto, sem RECON_KEY;
         4. nada reconcilia, e `syncOnFocus` não roda numa carga nova (não há
            evento `focus` nem `visibilitychange` quando a aba já está em foco);
         5. a tela abre com o que havia no localStorage — atrasado, e sem os
            registros que vieram de outro aparelho.

       Isso explica os três contornos que funcionavam: guia anônima e outro
       navegador começam com sessionStorage e localStorage vazios (download
       completo); entrar e sair da conta limpa SESSION_KEY e força o caminho do
       `enterProfile`, que põe RECON_KEY.

       A correção não é mexer no atalho — abrir rápido com o dado local é
       proposital e bom. É deixar de depender de um marcador consumível: TODA
       abertura que termina dentro de um perfil agenda a conferência em segundo
       plano. `reconcileProfile` já entrega o que está pendente antes de baixar,
       já checa se há novidade real e só recarrega quando alguma seção mudou,
       então agendar sempre não custa download nem recarga desnecessária. */
    try {
      const pending = sessionStorage.getItem(RECON_KEY);
      if (pending) { scheduleReconcile(pending); }
      else {
        const ativo = (window.ProfileManager && ProfileManager.getActiveProfileId)
          ? ProfileManager.getActiveProfileId() : null;
        const chave = (window.ProfileUI && ProfileUI.SESSION_KEY) || 'diario-estudos:entered';
        if (ativo && sessionStorage.getItem(chave) === ativo) {
          StartupTrace.mark('reconciliacao-entrada-direta', { perfil: ativo });
          scheduleReconcile(ativo);
        }
      }
    } catch (e) { quiet(e, 'reconcile-boot'); }
  }
  installLocalFirst();

  /* ── CONTINUIDADE DA PRESCRIÇÃO ADAPTATIVA ENTRE IMPORTAÇÕES ───────────── */
  function installAdaptiveContinuity() {
    const RA = window.ReforcoAdaptativo;
    if (!RA || RA._uxv4Continuity || typeof RA.enriquecer !== 'function') return;
    RA._uxv4Continuity = true;
    const originalEnriquecer = RA.enriquecer.bind(RA);
    const originalInfo = typeof RA.info === 'function' ? RA.info.bind(RA) : null;

    RA.CONTINUIDADE = Object.freeze({
      maxCiclosConfirmada: 3,
      maxCiclosComum: 2,
      maxCiclosTeoria: 2,
      multConfirmada: 2.6,
      multComum: 1.9,
      multPosUrgente: 3.0,
      decaimento: [1, .85, .70],
      cooldownMesmoDia: true
    });

    RA._contKey = (disc, top) => norm(disc) + '\u0001' + norm(top);
    RA._contStats = function (snapshotId) {
      const out = new Map();
      if (!snapshotId || typeof DB === 'undefined' || typeof DB.getExtras !== 'function') return out;
      let extras = []; try { extras = DB.getExtras() || []; } catch (e) { quiet(e, 'cont-extras'); }
      for (const e of extras) {
        const o = e && e.origemPlano, rx = o && o.prescricaoAdaptativa;
        if (!o || !rx || rx.snapshotId !== snapshotId) continue;
        const key = this._contKey(o.disciplina || e.disciplina, o.topico || e.titulo);
        let st = out.get(key); if (!st) { st = { executado:0, ciclos:0, abertos:0, ultimoDia:'', extras:0 }; out.set(key, st); }
        const hist = Array.isArray(e.historico) ? e.historico : [];
        const porHist = hist.reduce((s,h) => s + Math.max(0, Number(h && h.quantidade) || 0), 0);
        const feito = Math.max(porHist, Math.max(0, Number(e.progresso) || 0));
        const alvo = Math.max(0, Number(e.alvo) || Number(rx.dose) || 0);
        st.executado += alvo > 0 ? Math.min(feito, alvo) : feito;
        const fechou = e.status === 'concluida' || (alvo > 0 && feito >= alvo);
        if (fechou) st.ciclos++; else st.abertos++;
        st.extras++;
        const dias = hist.map(h => h && h.data).filter(Boolean);
        if (o.veredito && o.veredito.em) dias.push(String(o.veredito.em).slice(0,10));
        if (e.updatedAt) dias.push(String(e.updatedAt).slice(0,10));
        dias.sort(); if (dias.length && dias[dias.length - 1] > st.ultimoDia) st.ultimoDia = dias[dias.length - 1];
      }
      return out;
    };

    RA._aplicarContinuidade = function (item, rx, st) {
      if (!rx || rx.dose <= 0 || rx.confiouMeta) return rx;
      st = st || { executado:0, ciclos:0, abertos:0, ultimoDia:'', extras:0 };
      const base = Math.max(1, Math.round(Number(rx.dose) || 1));
      const fase = rx.fase || 'pre';
      const prefs = this.prefs ? this.prefs() : {};
      const minDose = Math.max(5, Number(prefs[fase === 'pos' ? 'dosePosMin' : 'dosePreMin']) || 10);
      const cfg = this.CONTINUIDADE;
      const diagnostico = rx.objetivo === 'diagnosticar';
      const urgente = fase === 'pos' && Number(prefs.diasAteProva || 999) <= 45;
      let maxCiclos = diagnostico ? 1 : (rx.teoriaPrimeiro ? cfg.maxCiclosTeoria : (rx.lacunaConfirmada ? cfg.maxCiclosConfirmada : cfg.maxCiclosComum));
      let mult = diagnostico ? 1 : (urgente ? cfg.multPosUrgente : (rx.lacunaConfirmada ? cfg.multConfirmada : cfg.multComum));
      const custo = Math.max(base, Number(rx.custoEstrategico) || base);
      const orcamento = Math.max(base, Math.min(custo, Math.round(base * mult)));
      const saldo = Math.max(0, orcamento - st.executado);
      const mesmoDia = cfg.cooldownMesmoDia && st.ciclos > 0 && st.ultimoDia === today();
      const esgotado = st.ciclos >= maxCiclos || saldo < minDose;
      const semNovaMedicao = st.ciclos > 0 || st.executado > 0;
      const dec = cfg.decaimento[Math.min(st.ciclos, cfg.decaimento.length - 1)] || cfg.decaimento[cfg.decaimento.length - 1];
      let proxima = base;
      let estado = 'dose-inicial';
      if (st.abertos > 0) { proxima = 0; estado = 'ciclo-em-aberto'; }
      else if (mesmoDia) { proxima = 0; estado = 'rodar-outro-hoje'; }
      else if (esgotado) { proxima = 0; estado = 'aguardar-medicao'; }
      else if (semNovaMedicao) { proxima = Math.min(saldo, Math.max(minDose, Math.round(base * dec))); estado = 'continuar'; }

      rx.continuidade = {
        versao:1,
        snapshotId:rx.snapshotId || null,
        semNovaMedicao,
        executadoSemMedicao:Math.round(st.executado),
        ciclosSemMedicao:st.ciclos,
        ciclosMaximos:maxCiclos,
        orcamentoSemMedicao:orcamento,
        saldoSemMedicao:saldo,
        doseBase:base,
        proximaDose:Math.max(0, Math.round(proxima)),
        estado,
        ultimoDia:st.ultimoDia || null,
        regra: diagnostico ? 'diagnóstico: mede uma vez e roda para outro tópico' : 'intervenção: continua com limite e rodízio até novo TEC'
      };
      rx.scoreBase = Number(rx.score) || 0;
      const penal = estado === 'dose-inicial' ? 1 : estado === 'continuar' ? Math.max(.55, 1 - .18 * st.ciclos) : .02;
      rx.scoreEfetivo = Math.max(0, rx.scoreBase * penal);
      rx.dose = rx.continuidade.proximaDose;
      return rx;
    };

    RA.enriquecer = function (r) {
      const out = originalEnriquecer(r);
      if (!out) return out;
      const todos = [...(out.itens || []), ...(out.pequenas || [])];
      const sid = todos.map(x => x && x.prescricaoAdaptativa && x.prescricaoAdaptativa.snapshotId).find(Boolean) || null;
      const stats = this._contStats(sid);
      for (const x of todos) {
        const rx = x && x.prescricaoAdaptativa; if (!rx) continue;
        this._aplicarContinuidade(x, rx, stats.get(this._contKey(x.disciplina, x.nome)));
      }
      return out;
    };

    // A fila usa o score adaptativo; entre duas fraquezas equivalentes, assunto
    // ainda não trabalhado neste retrato vem antes do que já recebeu uma dose.
    if (window.ReforcoFila && typeof ReforcoFila._cmpSug === 'function' && !ReforcoFila._uxv4Cmp) {
      ReforcoFila._uxv4Cmp = true; const cmp = ReforcoFila._cmpSug;
      ReforcoFila._cmpSug = function (a,b) {
        const A = a && a.x && a.x.prescricaoAdaptativa, B = b && b.x && b.x.prescricaoAdaptativa;
        const sa = A ? Number(A.scoreEfetivo != null ? A.scoreEfetivo : A.score) : null;
        const sb = B ? Number(B.scoreEfetivo != null ? B.scoreEfetivo : B.score) : null;
        if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sb - sa;
        return cmp.apply(this, arguments);
      };
    }

    // Puxar do Plano: candidatos em cooldown, já em ciclo ou aguardando nova
    // medição não voltam como uma meta cheia tradicional por acidente.
    if (window.ExtrasScreen && typeof ExtrasScreen._planoRecalc === 'function' && !ExtrasScreen._uxv4ContRecalc) {
      ExtrasScreen._uxv4ContRecalc = true; const rec = ExtrasScreen._planoRecalc;
      ExtrasScreen._planoRecalc = function () {
        const r = rec.apply(this, arguments);
        if (Array.isArray(this._planoCand)) {
          this._planoCand.forEach(x => {
            const rx = x && x.prescricaoAdaptativa;
            if (x.motivo === 'reforco' && rx) { x.alvo = Math.max(0, Number(rx.dose) || 0); x.continuidadeAdaptativa = rx.continuidade || null; }
          });
          this._planoCand = this._planoCand.filter(x => !(x.motivo === 'reforco' && x.prescricaoAdaptativa && Number(x.prescricaoAdaptativa.dose) <= 0));
        }
        return r;
      };
    }

    // Clique direto no Plano recebe a mesma trava. Dose 0 nunca cai de volta no
    // custoQ tradicional, que transformaria "aguarde nova medição" em 95 questões.
    if (window.DesempenhoTecScreen && typeof DesempenhoTecScreen.criarExtraDoPlano === 'function' && !DesempenhoTecScreen._uxv4ContCreate) {
      DesempenhoTecScreen._uxv4ContCreate = true; const create = DesempenhoTecScreen.criarExtraDoPlano;
      DesempenhoTecScreen.criarExtraDoPlano = function (top, disc, alvo, motivo, lote) {
        if (motivo === 'reforco') {
          try {
            const rr = PlanoEngine.calcular(this.scopedSnapshot(), PlanoEngine.prefs());
            const xx = [...(rr.itens || []), ...(rr.pequenas || [])].find(z => norm(z.nome) === norm(top) && norm(z.disciplina) === norm(disc));
            const rx = xx && xx.prescricaoAdaptativa;
            if (rx) {
              if (Number(rx.dose) <= 0) {
                if (!lote && typeof showToast === 'function') {
                  const st = rx.continuidade && rx.continuidade.estado;
                  showToast(st === 'rodar-outro-hoje' ? 'Dose concluída hoje — o Plano vai priorizar outra fraqueza antes de repetir este tópico.' : 'Este tópico já recebeu a carga segura deste retrato. Importe um novo TEC para recalibrar ou ataque outra fraqueza.');
                }
                return null;
              }
              alvo = Number(rx.dose);
            }
          } catch (e) { quiet(e, 'cont-create'); }
        }
        return create.call(this, top, disc, alvo, motivo, lote);
      };
    }

    if (originalInfo) {
      RA.info = function (rx, nome) {
        const out = originalInfo(rx, nome);
        try {
          const c = rx && rx.continuidade; if (!c) return out;
          const body = [...document.querySelectorAll('.ra-overlay .ra-info-body')].pop(); if (!body) return out;
          const p = document.createElement('div'); p.className = 'ra-continuity-note';
          if (c.estado === 'dose-inicial') p.innerHTML = `<b>Continuidade entre importações</b><br>Esta é a primeira dose deste retrato. Se você concluir antes do próximo TEC, o motor roda para outras fraquezas e só volta aqui dentro de um orçamento seguro.`;
          else if (c.estado === 'rodar-outro-hoje') p.innerHTML = `<b>Rodízio obrigatório hoje</b><br>Você já executou ${c.executadoSemMedicao}q deste tópico com o mesmo retrato. Hoje o motor prioriza outra fraqueza para ampliar cobertura.`;
          else if (c.estado === 'continuar') p.innerHTML = `<b>Continuação sem fingir nova medição</b><br>Já foram ${c.executadoSemMedicao}q em ${c.ciclosSemMedicao} ciclo(s) desde este TEC. Próxima dose: <b>${c.proximaDose}q</b>. Limite antes de exigir nova medição: ${c.orcamentoSemMedicao}q.`;
          else if (c.estado === 'aguardar-medicao') p.innerHTML = `<b class="tone-warn">Hora de medir novamente</b><br>Este tópico já recebeu ${c.executadoSemMedicao}q com o mesmo retrato. O motor não aumenta a carga às cegas: ele desloca esforço para outras fraquezas até chegar um novo TEC.`;
          else if (c.estado === 'ciclo-em-aberto') p.innerHTML = `<b>Conclua o ciclo atual primeiro</b><br>Já existe uma dose aberta para este tópico; nenhuma duplicata será criada.`;
          body.appendChild(p);
        } catch (e) { quiet(e, 'cont-info'); }
        return out;
      };
    }

    // Recalcula imediatamente para que qualquer cache montado antes desta camada
    // já receba dose/score efetivos de continuidade.
    try { if (window.ReforcoFila) ReforcoFila._assinaturaAnterior = ''; } catch (e) { quiet(e, 'cont-refresh'); }
  }
  installAdaptiveContinuity();

  // Exposto para auditoria automatizada e diagnóstico no console.
  window.UX = { StartupTrace, LoaderUX, reconcileProfile, installLocalFirst, installAdaptiveContinuity };
})();
