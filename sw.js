/* ═══════════════════════════════════════════════════════════════════════════
   Diário de Estudos — Service Worker
   ───────────────────────────────────────────────────────────────────────────
   OPCIONAL. Coloque este arquivo NA MESMA PASTA que o index.html. Sem ele o
   app continua funcionando normalmente — só não abre sem internet.

   Estratégia deliberada, uma por tipo de recurso:

   · O PRÓPRIO APP (navegação) → rede fresca primeiro, com queda para o cache.
     Rede fresca porque o index.html muda com frequência: uma navegação atendida
     pelo HTTP cache do navegador pode continuar antiga mesmo quando o worker
     acredita ter ido à rede. O HTML usa cache:'reload' e tem um teto próprio
     mais folgado; só depois disso a casca offline é usada.

   · FONTES do Google → serve do cache e revalida em segundo plano.
     Instantâneas a partir da 2ª visita. Fontes quase nunca mudam e são o
     recurso mais lento no primeiro carregamento.

   · BIBLIOTECAS de CDN (Supabase, SheetJS) → cache primeiro.
     A versão está FIXA na URL (supabase-js@2.45.4, xlsx-0.20.3). URL imutável
     pode ficar em cache para sempre; é o que torna a 2ª carga instantânea.

   · SUPABASE → nunca cacheado.
     São dados vivos e autenticados. Cachear sincronização produziria
     divergência silenciosa entre dispositivos — o pior tipo de bug.

   IMPORTANTE: este worker NÃO guarda nenhum dado de estudo. Seus dados moram
   no IndexedDB, que já é local e independente disto.
   ═══════════════════════════════════════════════════════════════════════════ */

/* O carimbo é gravado pelo build.mjs a partir de um resumo do conteúdo de src/.
   Ele muda a cada publicação real — é isso que dá um BALDE NOVO a cada versão e
   faz a faxina da ativação ter o que descartar. Não edite à mão. */
const VERSAO = 'v61fe4c6069';

const CACHE_APP = VERSAO + '-app';
const CACHE_CDN = 'cdn-imutavel-v1';
const CDN_MAX = 60;

/* Arquivos auxiliares pequenos continuam com fallback rápido. A NAVEGAÇÃO recebe
   um teto maior: 3 s era curto demais em 4G/5G congestionado e fazia um refresh
   pós-deploy cair no HTML antigo do cache antes que o GitHub Pages respondesse. */
const TIMEOUT_REDE = 3000;
const TIMEOUT_NAVEGACAO = 9000;
const CHAVE_CASCA = './index.html';

function manterVivo(evt, p) {
  try { if (evt && evt.waitUntil) evt.waitUntil(p.catch(() => {})); } catch (_) {}
}

const TETO_BUSCA = 20000;
function buscar(req) {
  if (typeof AbortController === 'undefined') return fetch(req);
  const ac = new AbortController();
  const t = setTimeout(() => { try { ac.abort(); } catch (_) {} }, TETO_BUSCA);
  return fetch(req, { signal: ac.signal }).finally(() => clearTimeout(t));
}

/* Navegação é diferente de um asset: o request original pode ser satisfeito pelo
   HTTP cache do navegador. Recriamos com cache:'reload' para revalidar a casca
   publicada sem destruir a possibilidade de cache offline do próprio worker. */
function buscarNavegacao(req) {
  try {
    const fresh = new Request(req, { cache: 'reload' });
    return buscar(fresh);
  } catch (_) {
    return buscar(req);
  }
}

function podeGuardar(r, aceitarOpaca) {
  if (!r) return false;
  if (r.type === 'opaque') return !!aceitarOpaca;
  if (!r.ok) return false;
  const cc = r.headers.get('cache-control') || '';
  return !/no-store/i.test(cc);
}

function guardar(cacheNome, chave, resp, aceitarOpaca) {
  if (!podeGuardar(resp, aceitarOpaca)) return null;
  const copia = resp.clone();
  return caches.open(cacheNome).then((c) => c.put(chave, copia)).catch(() => {});
}

async function precarregar() {
  const c = await caches.open(CACHE_APP);
  for (const origem of ['./index.html', './']) {
    try {
      const r = await fetch(new Request(origem, { cache: 'reload' }));
      if (r && r.ok) { await c.put(CHAVE_CASCA, r.clone()); break; }
    } catch (_) {}
  }
  try {
    const m = await fetch(new Request('./manifest.webmanifest', { cache: 'reload' }));
    if (m && m.ok) await c.put('./manifest.webmanifest', m.clone());
  } catch (_) {}
}

self.addEventListener('install', (evt) => {
  evt.waitUntil(precarregar().catch(() => null));
  /* O worker novo ESPERA; a aplicação decide a troca para nunca misturar
     JavaScript de duas versões na mesma página. */
});

async function faxinaDeBaldes() {
  const nomes = await caches.keys();
  const manter = new Set([CACHE_APP, CACHE_CDN]);
  await Promise.all(nomes.filter((n) => !manter.has(n)).map((n) => caches.delete(n)));
}

async function podarCdn() {
  try {
    const c = await caches.open(CACHE_CDN);
    const chaves = await c.keys();
    if (chaves.length <= CDN_MAX) return;
    await Promise.all(chaves.slice(0, chaves.length - CDN_MAX).map((k) => c.delete(k)));
  } catch (_) {}
}

/* Navigation preload foi retirado do caminho crítico. Ele nasce antes do código
   do worker e pode reutilizar o HTTP cache do navegador; para um app que muda
   frequentemente isso reabria justamente a janela "worker novo + HTML velho".
   O fetch explícito com cache:'reload' acima é a única autoridade online. */
async function desligarPreCarregamento() {
  try {
    if (self.registration && self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable();
    }
  } catch (_) {}
}

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    Promise.all([faxinaDeBaldes(), desligarPreCarregamento()])
      .then(() => podarCdn())
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

function respostaSemConexao() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Sem conexão</title>'
    + '<div style="font:16px/1.6 system-ui,-apple-system,sans-serif;padding:40px;text-align:center">'
    + '<div style="font-size:44px">📚</div>'
    + '<h1 style="font-size:20px;margin:10px 0">Sem conexão</h1>'
    + '<p style="color:#5b6270">Abra o app pelo menos uma vez com internet para que ele fique disponível offline.</p></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
  );
}

function redePrimeiro(evt, req, cacheNome) {
  let gravacao = null;
  const daRede = buscar(req).then((r) => { gravacao = guardar(cacheNome, req, r); return r; });
  manterVivo(evt, daRede.then(() => gravacao));
  const relogio = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_REDE));
  return Promise.race([daRede, relogio]).catch(async () => {
    const c = await caches.open(cacheNome);
    return (await c.match(req)) || Response.error();
  });
}

function responderNavegacao(evt) {
  const req = evt.request;
  let gravacao = null;
  const daRede = buscarNavegacao(req)
    .then((r) => { gravacao = guardar(CACHE_APP, CHAVE_CASCA, r); return r; });
  manterVivo(evt, daRede.then(() => gravacao));
  const relogio = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_NAVEGACAO));
  return Promise.race([daRede, relogio]).catch(async () => {
    const c = await caches.open(CACHE_APP);
    return (await c.match(CHAVE_CASCA, { ignoreVary: true }))
        || (await c.match(req, { ignoreVary: true }))
        || respostaSemConexao();
  });
}

function cacheERevalida(evt, req, cacheNome) {
  let gravacao = null;
  const rede = buscar(req)
    .then((r) => { gravacao = guardar(cacheNome, req, r, true); return r; })
    .catch(() => null);
  manterVivo(evt, rede.then(() => gravacao));
  return caches.open(cacheNome)
    .then((c) => c.match(req))
    .then((guardado) => guardado || rede.then((r) => r || Response.error()));
}

function cachePrimeiro(evt, req, cacheNome) {
  return caches.open(cacheNome).then((c) => c.match(req)).then((guardado) => {
    if (guardado) return guardado;
    let gravacao = null;
    const rede = buscar(req).then((r) => { gravacao = guardar(cacheNome, req, r); return r; });
    manterVivo(evt, rede.then(() => gravacao));
    return rede;
  });
}

self.addEventListener('fetch', (evt) => {
  const req = evt.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (/supabase\.(co|in)$/.test(url.hostname)) return;

  if (req.mode === 'navigate') { evt.respondWith(responderNavegacao(evt)); return; }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    evt.respondWith(cacheERevalida(evt, req, CACHE_CDN)); return;
  }

  if (url.hostname === 'cdn.sheetjs.com' || url.hostname === 'cdn.jsdelivr.net') {
    evt.respondWith(cachePrimeiro(evt, req, CACHE_CDN)); return;
  }

  if (url.origin === self.location.origin) {
    evt.respondWith(redePrimeiro(evt, req, CACHE_APP));
  }
});

self.addEventListener('message', (evt) => {
  if (!evt.data) return;
  const porta = evt.ports && evt.ports[0];

  if (evt.data === 'skipWaiting') { self.skipWaiting(); return; }

  if (evt.data === 'versao') {
    if (porta) porta.postMessage({ versao: VERSAO, app: CACHE_APP, cdn: CACHE_CDN });
    return;
  }

  if (evt.data === 'limparCache') {
    evt.waitUntil(
      caches.keys()
        .then((n) => Promise.all(n.map((k) => caches.delete(k))))
        .then(() => { if (porta) porta.postMessage({ ok: true }); })
        .catch(() => { if (porta) porta.postMessage({ ok: false }); })
    );
  }
});
