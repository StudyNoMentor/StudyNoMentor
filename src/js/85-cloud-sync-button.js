/* ============================================================================
   BOTÃO DE SINCRONIZAÇÃO — restaura a ação direta do indicador do topo
   ----------------------------------------------------------------------------
   A camada CloudUX substitui o nó original do botão para montar o menu de conta.
   Ao clonar o elemento, porém, ela também remove o listener histórico que chama
   CloudStore.syncNow(). O resultado é um indicador visualmente correto, mas que
   deixou de cumprir o contrato de "toque para sincronizar agora".

   Esta ponte roda DEPOIS de CloudUX, no nó definitivo. O listener em captura
   garante uma única ação: sincronizar. Não altera CloudStore, SectionSync,
   Supabase, filas, revisões ou regras de conflito.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__cloudSyncButtonDirect) return;
  window.__cloudSyncButtonDirect = true;

  const install = () => {
    const btn = document.getElementById('cloud-sync-btn');
    if (!btn || btn.dataset.syncDirect === '1') return;

    btn.dataset.syncDirect = '1';
    btn.title = 'Sincronizar agora';
    btn.setAttribute('aria-label', 'Sincronizar agora');

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (window.CloudStore && typeof CloudStore.syncNow === 'function') {
        CloudStore.syncNow();
      }
    }, true);
  };

  install();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
})();
