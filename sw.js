/* ═══════════════════════════════════════════════════════════════════════════
   Diário de Estudos — Service Worker
   ───────────────────────────────────────────────────────────────────────────
   OPCIONAL. Coloque este arquivo NA MESMA PASTA que o index.html. Sem ele o
   app continua funcionando normalmente — só não abre sem internet.

   Estratégia deliberada, uma por tipo de recurso:

   · O PRÓPRIO APP (navegação) → rede primeiro, com queda para o cache.
     Rede primeiro porque você edita o index.html com frequência: cache-first
     faria você ver a versão antiga por dias sem entender por quê. Se a rede
     falhar ou passar de 3s, serve o cache. Offline, abre igual.

   · FONTES do Google → serve do cache e revalida em segundo plano.
     Instantâneas a partir da 2ª visita. Fontes quase nunca mudam e são o
     recurso mais lento no primeiro carregamento.

   · SheetJS (importar planilha) → cache primeiro.
     A versão está FIXA na URL (xlsx-0.20.3). URL imutável pode ficar em cache
     para sempre; é o que torna a importação instantânea da 2ª vez em diante.

   · SUPABASE → nunca cacheado.
     São dados vivos e autenticados. Cachear sincronização produziria
     divergência silenciosa entre dispositivos — o pior tipo de bug.

   IMPORTANTE: este worker NÃO guarda nenhum dado de estudo. Seus dados moram
   no IndexedDB, que já é local e independente disto.
   ═══════════════════════════════════════════════════════════════════════════ */

const VERSAO = 'v0fb59dc657';
const CACHE_APP = VERSAO + '-app';
const CACHE_CDN = VERSAO + '-cdn';
const TIMEOUT_REDE = 3000;

const ESSENCIAIS = ['./', './index.html', './manifest.webmanifest'];

// ── Instalação ──────────────────────────────────────────────────────────────
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_APP)
      // addAll é tudo-ou-nada: um único 404 abortaria a instalação inteira.
      // Vamos um a um, ignorando o que falhar — cache parcial é melhor que nenhum.
      .then((c) => Promise.all(ESSENCIAIS.map((u) => c.add(u).catch(() => null))))
  );
  /* Sem skipWaiting() automático, de propósito.
     Ele fazia o worker novo assumir na hora — passando a servir ativos da
     versão NOVA para uma página que continua executando o JavaScript da
     versão VELHA. Essa mistura é a origem clássica de "atualizei e começou a
     dar erro estranho": duas versões do app vivas ao mesmo tempo, uma no
     worker e outra na página.
     O worker novo agora ESPERA. Quem decide a troca é o usuário, pelo aviso
     de atualização (ou ela acontece sozinha quando todas as abas fecham). */
});

// ── Ativação: descarta caches de versões antigas ────────────────────────────
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        nomes.filter((n) => !n.startsWith(VERSAO)).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Estratégias ─────────────────────────────────────────────────────────────

async function redePrimeiro(req, cacheNome) {
  const cache = await caches.open(cacheNome);
  try {
    const resp = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_REDE))
    ]);
    if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
    return resp;
  } catch (_) {
    const guardado = (await cache.match(req))
      || (await cache.match('./index.html'))
      || (await cache.match('./'));
    if (guardado) return guardado;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Sem conexão</title>'
      + '<div style="font:16px/1.6 system-ui,-apple-system,sans-serif;padding:40px;text-align:center">'
      + '<div style="font-size:44px">📚</div>'
      + '<h1 style="font-size:20px;margin:10px 0">Sem conexão</h1>'
      + '<p style="color:#5b6270">Abra o app pelo menos uma vez com internet para que ele fique disponível offline.</p></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
    );
  }
}

async function cacheERevalida(req, cacheNome) {
  const cache = await caches.open(cacheNome);
  const guardado = await cache.match(req);
  const rede = fetch(req)
    .then((r) => { if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()).catch(() => {}); return r; })
    .catch(() => null);
  return guardado || (await rede) || fetch(req);
}

async function cachePrimeiro(req, cacheNome) {
  const cache = await caches.open(cacheNome);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const resp = await fetch(req);
  if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone()).catch(() => {});
  return resp;
}

// ── Roteamento ──────────────────────────────────────────────────────────────
self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return;                    // POST/PUT nunca são cacheados

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Dados vivos e autenticados: passam direto, sempre.
  if (/supabase\.(co|in)$/.test(url.hostname)) return;

  if (req.mode === 'navigate') { evt.respondWith(redePrimeiro(req, CACHE_APP)); return; }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evt.respondWith(cacheERevalida(req, CACHE_CDN)); return;
  }

  if (url.hostname === 'cdn.sheetjs.com' || url.hostname === 'cdn.jsdelivr.net') {
    evt.respondWith(cachePrimeiro(req, CACHE_CDN)); return;
  }

  if (url.origin === self.location.origin) {
    evt.respondWith(redePrimeiro(req, CACHE_APP));
  }
});

// ── Comandos vindos do app ──────────────────────────────────────────────────
self.addEventListener('message', (evt) => {
  if (!evt.data) return;
  if (evt.data === 'skipWaiting') self.skipWaiting();
  if (evt.data === 'limparCache') {
    /* Responde ao final: sem isso, quem pediu não sabia quando podia recarregar
       e recarregava cedo demais, ainda com o cache pela metade. */
    const porta = evt.ports && evt.ports[0];
    evt.waitUntil(
      caches.keys()
        .then((n) => Promise.all(n.map((k) => caches.delete(k))))
        .then(() => { if (porta) porta.postMessage({ ok: true }); })
        .catch(() => { if (porta) porta.postMessage({ ok: false }); })
    );
  }
});
