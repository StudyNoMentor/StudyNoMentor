/* ═══════════════════ ATUALIZAÇÃO E CACHE ═══════════════════════════════════
   O problema que este arquivo resolve, dito como quem o vive: "toda vez que
   atualiza, dá bug e conflito de login".

   Um app instalável guarda seus próprios arquivos. Quando uma versão nova é
   publicada, três coisas podem ficar desencontradas ao mesmo tempo:

     · o service worker VELHO continuando a servir o app velho;
     · o service worker NOVO servindo ativos novos para uma página que ainda
       está executando o JavaScript velho (era o que o `skipWaiting()`
       automático fazia — duas versões vivas ao mesmo tempo);
     · o cache com o MESMO NOME entre versões, o que fazia a faxina de
       ativação nunca ter o que limpar.

   As três foram fechadas: o nome do cache agora carrega a versão (build.mjs
   carimba um resumo do conteúdo, então cada publicação tem um balde próprio e
   o antigo é descartado sozinho na ativação); o worker novo ESPERA em vez de
   assumir por baixo; e o que decide a troca é este aviso.

   A regra que sustenta tudo: TROCAR DE VERSÃO NUNCA PODE PERDER O QUE NÃO
   SUBIU. Antes de recarregar, a fila de envio é descarregada e esperada. Se
   não der para entregar, o aviso diz isso e deixa a escolha com quem está lá.
   ═══════════════════════════════════════════════════════════════════════════ */
const Atualizacao = {
  _reg: null,
  _barra: null,
  _trocando: false,

  versao() {
    try {
      const m = document.querySelector('meta[name="diario-versao"]');
      return (m && m.getAttribute('content')) || 'desconhecida';
    } catch (_) { return 'desconhecida'; }
  },

  /* ── A PÁGINA E O CACHE ESTÃO NA MESMA VERSÃO? ────────────────────────────
     Esta é a pergunta que ninguém conseguia responder quando algo dava errado
     depois de uma publicação. A página carrega uma versão; o service worker
     serve os arquivos de outra. Enquanto as duas coincidem, está tudo bem — o
     desencontro é que produz o erro sem explicação.

     Agora dá para perguntar ao worker, e a resposta aparece no Diagnóstico. */
  _versaoWorker: null,
  async perguntarVersaoAoWorker() {
    try {
      const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (!ctrl || typeof MessageChannel === 'undefined') { this._versaoWorker = null; return null; }
      const resposta = await new Promise((resolve) => {
        const canal = new MessageChannel();
        canal.port1.onmessage = (e) => resolve(e.data || null);
        setTimeout(() => resolve(null), 2000);     // worker mudo não trava a tela
        ctrl.postMessage('versao', [canal.port2]);
      });
      this._versaoWorker = (resposta && resposta.versao) || null;
      return this._versaoWorker;
    } catch (e) { _quiet(e, 'upd-versao-sw'); this._versaoWorker = null; return null; }
  },
  // Linha pronta para o Diagnóstico (síncrona: usa o que a pergunta acima achou).
  linhaDeVersao() {
    const pagina = this.versao();
    const sw = this._versaoWorker;
    if (!('serviceWorker' in navigator)) return { v: pagina + ' · sem modo instalável', t: '' };
    if (!sw) return { v: pagina + ' · cache ainda não respondeu', t: '' };
    if (sw === pagina) return { v: pagina + ' · app e cache na mesma versão', t: 'ok' };
    return {
      v: 'app ' + pagina + ' · cache ' + sw + ' — desencontrados. Use "Procurar atualização" ou "Limpar cache do app".',
      t: 'warn'
    };
  },

  /* ── O AVISO ──────────────────────────────────────────────────────────────
     Fica na tela até ser resolvido — um toast some antes de alguém agir. Não
     bloqueia nada: dá para continuar usando e atualizar depois. */
  avisar(reg) {
    this._reg = reg || this._reg;
    if (this._barra) return;                       // já está avisando
    const b = document.createElement('div');
    b.className = 'upd-bar';
    b.setAttribute('role', 'status');
    b.innerHTML =
      '<div class="upd-txt"><strong>Nova versão disponível.</strong> ' +
      'Atualizar leva um segundo e evita erros de versões misturadas.</div>' +
      '<div class="upd-acoes">' +
      '<button type="button" class="btn-secondary upd-depois">Depois</button>' +
      '<button type="button" class="btn-primary upd-agora">Atualizar agora</button>' +
      '</div>';
    document.body.appendChild(b);
    this._barra = b;
    b.querySelector('.upd-depois').addEventListener('click', () => this.fechar());
    b.querySelector('.upd-agora').addEventListener('click', () => this.aplicar());
  },
  fechar() {
    if (this._barra) { this._barra.remove(); this._barra = null; }
  },

  /* Antes de qualquer reload, a única barreira de durabilidade é o SQL.
     Se o PostgreSQL não confirmar, a atualização é cancelada. */
  async _entregarPendencias(limiteMs) {
    const CS = window.CloudStore;
    const RS = window.RelationalStore;
    /* ── SEM SESSÃO NÃO HÁ O QUE O BANCO CONFIRMAR ──────────────────────────
       A fila do RelationalStore só recebe trabalho quando isReady() é
       verdadeiro, ou seja, com sessão ativa. Tratar "sem sessão" como "não
       entregue" invertia a barreira: ela existe para não perder alteração
       pendente, mas passava a CANCELAR a atualização justamente onde não
       existe alteração nenhuma — a tela de login. Quem estava deslogado via
       "Banco ainda não confirmou" a cada tentativa e nunca conseguia sair da
       versão antiga, que é exatamente quem mais precisa da versão nova para
       conseguir entrar. É o mesmo critério que recarregarApp() em 10-infra.js
       já usava: só cobra o banco quando há conexão. */
    if (!RS) return true;
    const comSessao = !!(CS && CS.isReady && CS.isReady() && CS.isLoggedIn && CS.isLoggedIn());
    if (!comSessao) {
      // Sessão pode ter caído com a fila cheia: aí ainda há o que perder.
      try { return typeof RS.pendingCount === 'function' ? RS.pendingCount() === 0 : true; }
      catch (_) { return true; }
    }
    const limite = Math.max(1000, Number(limiteMs) || 8000);
    let timer = null;
    try {
      await Promise.race([
        RS.flush(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout-sql-update')), limite);
        })
      ]);
      return RS.pendingCount() === 0 && !RS._lastError;
    } catch (e) {
      _quiet(e, 'upd-flush-sql');
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  async aplicar() {
    if (this._trocando) return;
    this._trocando = true;
    const btn = this._barra && this._barra.querySelector('.upd-agora');
    const restaurar = (window.SaveGuard && SaveGuard.ocupar)
      ? SaveGuard.ocupar(btn, 'Confirmando no banco…')
      : () => {};

    const entregue = await this._entregarPendencias(10000);
    restaurar();
    if (!entregue) {
      this._trocando = false;
      await UI.alert(
        'A atualização foi cancelada porque o banco ainda não confirmou todas as alterações. Nada será descartado da memória. Tente novamente quando a conexão estiver normal.',
        { title: 'Banco ainda não confirmou' });
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Atualizando…'; }
    this._recarregarComWorkerNovo();
  },

  _recarregarComWorkerNovo() {
    let recarregou = false, tentativas = 0, bater = null;

    const recarregar = async () => {
      if (recarregou) return;
      recarregou = true;
      clearInterval(bater);

      /* Cobre mutações ocorridas entre o clique e o controllerchange. */
      const ok = await this._entregarPendencias(10000);
      if (!ok) {
        recarregou = false;
        this._trocando = false;
        try {
          showToast('⚠ A nova versão está pronta, mas o banco ainda não confirmou tudo. A página não foi recarregada.');
        } catch (e) { _quiet(e, 'upd-reload-cancel'); }
        return;
      }
      location.reload();
    };

    try {
      navigator.serviceWorker.addEventListener('controllerchange', recarregar, { once: true });
    } catch (e) { _quiet(e, 'upd-controller'); }

    const pedir = () => {
      try {
        const esperando = this._reg && this._reg.waiting;
        if (esperando) {
          esperando.postMessage('skipWaiting');
          return true;
        }
      } catch (e) { _quiet(e, 'upd-skip'); }
      return false;
    };

    if (!pedir()) { recarregar(); return; }
    bater = setInterval(() => {
      tentativas++;
      if (recarregou || tentativas > 20 || !pedir()) clearInterval(bater);
    }, 600);
    setTimeout(recarregar, 12000);
  },

  /* ── LIMPEZA MANUAL ───────────────────────────────────────────────────────
     Para quando algo continua estranho depois de atualizar. Apaga APENAS os
     caches de arquivos do app (o que o service worker guardou) — nunca os seus
     dados, cuja fonte durável é o PostgreSQL e não é tocada aqui. */
  async limparCacheERecarregar() {
    const ok = await UI.confirm(
      'Apagar os arquivos do app guardados neste navegador e recarregar?\n\n' +
      'Serve para quando o app fica estranho depois de uma atualização. ' +
      'Seus dados de estudo NÃO são afetados: eles ficam no PostgreSQL, não neste cache.',
      { title: '🧹 Limpar cache do app', okText: 'Limpar e recarregar' });
    if (!ok) return;
    showToast('Salvando o que falta antes de limpar…');
    await this._entregarPendencias(8000);
    // 1. pede ao worker que limpe (ele é o dono dos caches) e espera a resposta
    try {
      await new Promise((resolve) => {
        const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (!ctrl || typeof MessageChannel === 'undefined') { resolve(); return; }
        const canal = new MessageChannel();
        canal.port1.onmessage = () => resolve();
        setTimeout(resolve, 3000);                 // não fica preso se ele não responder
        ctrl.postMessage('limparCache', [canal.port2]);
      });
    } catch (e) { _quiet(e, 'upd-limpar-sw'); }
    // 2. limpa também do lado da página (cobre o caso de não haver worker ativo)
    try { if (window.caches) { const n = await caches.keys(); await Promise.all(n.map(k => caches.delete(k))); } }
    catch (e) { _quiet(e, 'upd-limpar-caches'); }
    // 3. desregistra os workers: a próxima carga instala o atual, do zero
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (e) { _quiet(e, 'upd-desregistrar'); }
    showToast('Cache limpo ✓ recarregando…');
    setTimeout(() => recarregarApp('limpeza manual do cache', { imediato: true }), 500);
  },

  // Procura atualização agora (usado pelo botão em Diagnóstico).
  async procurar() {
    try {
      if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistration) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { showToast('Este aparelho não está usando o modo instalável.'); return false; }
      await reg.update();
      try { await this.perguntarVersaoAoWorker(); } catch (e) { _quiet(e, 'upd-versao'); }
      if (reg.waiting) { this.avisar(reg); return true; }
      showToast('Você já está na versão mais recente ✓');
      return false;
    } catch (e) { _quiet(e, 'upd-procurar'); showToast('Não foi possível verificar agora.'); return false; }
  }
};
window.Atualizacao = Atualizacao;
// ponte usada pelo registrador do service worker, que roda fora do escopo do app
window.__avisarAtualizacao = (reg) => { try { Atualizacao.avisar(reg); } catch (e) { _quiet(e, 'upd-ponte'); } };
