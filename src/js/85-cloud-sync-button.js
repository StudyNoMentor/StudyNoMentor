/* ============================================================================
   BOTÃO DE SINCRONIZAÇÃO — restaura a ação direta do indicador do topo
   ----------------------------------------------------------------------------
   A camada CloudUX substitui o nó original do botão para montar o menu de conta.
   Ao clonar o elemento, porém, ela também remove o listener histórico que chama
   CloudStore.syncNow(). O resultado é um indicador visualmente correto, mas que
   deixou de cumprir o contrato de "toque para sincronizar agora".

   CloudUX faz essa substituição num setTimeout(boot, 0) após DOMContentLoaded.
   Por isso esta ponte agenda a instalação depois desse boot e atua no nó
   definitivo. O listener em captura garante uma única ação: sincronizar.
   Não altera CloudStore, SectionSync, Supabase, filas, revisões ou conflitos.
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

  const installAfterCloudUX = () => setTimeout(install, 0);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installAfterCloudUX, { once: true });
  } else {
    installAfterCloudUX();
  }
})();
