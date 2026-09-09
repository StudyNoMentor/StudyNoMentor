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

  /* Espera a fila de envio esvaziar, com teto de tempo. Devolve true se tudo
     foi entregue. Não é decoração: recarregar com alteração pendente é o
     jeito mais fácil de perder o trabalho de alguém. */
  async _entregarPendencias(limiteMs) {
    const CS = window.CloudStore;
    if (!CS || !CS.isReady || !CS.isReady() || !CS.isLoggedIn || !CS.isLoggedIn()) return true;
    const fim = Date.now() + (limiteMs || 8000);
    try { await CS.flushPending(); } catch (e) { _quiet(e, 'upd-flush'); }
    while (Date.now() < fim) {
      let fila = 0;
      try { if (window.SectionSync) fila = SectionSync.pendingQuick(); } catch (e) { _quiet(e, 'upd-fila'); }
      if (!CS._pending && !CS._syncing && !fila) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  },

  async aplicar() {
    if (this._trocando) return;
    this._trocando = true;
    const btn = this._barra && this._barra.querySelector('.upd-agora');
    const restaurar = (window.SaveGuard && SaveGuard.ocupar) ? SaveGuard.ocupar(btn, 'Salvando…') : () => {};
    const entregue = await this._entregarPendencias(8000);
    restaurar();
    if (!entregue) {
      const seguir = await UI.confirm(
        'Ainda há alterações subindo para a nuvem.\n\nElas estão salvas neste aparelho e continuam na fila depois de atualizar — mas, se preferir, espere alguns segundos e tente de novo.',
        { title: '↻ Atualizar mesmo assim?', okText: 'Atualizar assim mesmo' });
      if (!seguir) { this._trocando = false; return; }
    }
    this._recarregarComWorkerNovo();
  },

  /* A troca em si: manda o worker que está esperando assumir e recarrega
     UMA vez, quando ele assumir de fato. O `controllerchange` é o sinal certo
     — recarregar antes dele traria a versão velha de novo. */
  _recarregarComWorkerNovo() {
    let recarregou = false;
    const recarregar = () => { if (recarregou) return; recarregou = true; location.reload(); };
    try {
      navigator.serviceWorker.addEventListener('controllerchange', recarregar, { once: true });
    } catch (e) { _quiet(e, 'upd-controller'); }
    try {
      const esperando = this._reg && this._reg.waiting;
      if (esperando) esperando.postMessage('skipWaiting');
      else recarregar();     // sem worker esperando: só recarregar já resolve
    } catch (e) { _quiet(e, 'upd-skip'); recarregar(); }
    // rede de segurança: se o controllerchange não vier, recarrega assim mesmo
    setTimeout(recarregar, 4000);
  },

  /* ── LIMPEZA MANUAL ───────────────────────────────────────────────────────
     Para quando algo continua estranho depois de atualizar. Apaga APENAS os
     caches de arquivos do app (o que o service worker guardou) — nunca os seus
     dados, que vivem no IndexedDB e na nuvem, e não são tocados aqui. */
  async limparCacheERecarregar() {
    const ok = await UI.confirm(
      'Apagar os arquivos do app guardados neste navegador e recarregar?\n\n' +
      'Serve para quando o app fica estranho depois de uma atualização. ' +
      'Seus dados de estudo NÃO são afetados: eles ficam no armazenamento do perfil e na nuvem, não neste cache.',
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
    setTimeout(() => location.reload(), 500);
  },

  // Procura atualização agora (usado pelo botão em Diagnóstico).
  async procurar() {
    try {
      if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistration) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { showToast('Este aparelho não está usando o modo instalável.'); return false; }
      await reg.update();
      if (reg.waiting) { this.avisar(reg); return true; }
      showToast('Você já está na versão mais recente ✓');
      return false;
    } catch (e) { _quiet(e, 'upd-procurar'); showToast('Não foi possível verificar agora.'); return false; }
  }
};
window.Atualizacao = Atualizacao;
// ponte usada pelo registrador do service worker, que roda fora do escopo do app
window.__avisarAtualizacao = (reg) => { try { Atualizacao.avisar(reg); } catch (e) { _quiet(e, 'upd-ponte'); } };
