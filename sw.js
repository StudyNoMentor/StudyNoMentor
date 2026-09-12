/* ═══════════════════════════════════════════════════════════════════════════
   Diário de Estudos — Service Worker
   ───────────────────────────────────────────────────────────────────────────
   OPCIONAL. Coloque este arquivo NA MESMA PASTA que o index.html. Sem ele o
   app continua funcionando normalmente — só não abre sem internet.

   Estratégia deliberada, uma por tipo de recurso:

   · O PRÓPRIO APP (navegação) → rede primeiro, com queda para o cache.
     Rede primeiro porque o index.html muda com frequência: cache-first faria
     você ver a versão antiga por dias sem entender por quê. Se a rede falhar ou
     passar de 3s, serve o cache. Offline, abre igual.

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
const VERSAO = 'v31ec6d4d42';

/* Dois baldes com ciclos de vida diferentes, e a diferença é proposital:

   · CACHE_APP carrega a versão no nome. Cada publicação começa do zero e a
     anterior é descartada na ativação — é o que impede ativo novo e ativo velho
     de conviverem no mesmo lugar.

   · CACHE_CDN NÃO carrega a versão. As URLs de lá são imutáveis (a versão da
     biblioteca está na própria URL), então o conteúdo não pode ficar velho. Se
     este balde também fosse versionado, TODA publicação jogaria fora o Supabase,
     o SheetJS e as fontes — e o app teria de rebaixá-los de novo exatamente no
     pior momento: logo depois de atualizar, com a rede já ocupada. */
const CACHE_APP = VERSAO + '-app';
const CACHE_CDN = 'cdn-imutavel-v1';
const CDN_MAX = 60;               // teto de entradas do balde imutável

const TIMEOUT_REDE = 3000;

/* Toda navegação compartilha UMA entrada de cache: a casca do app. Sem isso,
   cada variação de endereço (`?utm=…`, `/` versus `/index.html`) guardaria outra
   cópia de ~2 MB, e o retorno offline dependia de acertar exatamente a mesma
   URL da vez anterior. */
const CHAVE_CASCA = './index.html';

// ── Auxiliares ──────────────────────────────────────────────────────────────

/* `waitUntil` mantém o worker vivo até a promessa terminar. Sem ele, o navegador
   pode encerrá-lo assim que a resposta chega ao usuário — e a gravação no cache
   morre no meio, deixando o balde da versão nova pela metade. */
function manterVivo(evt, p) {
  try { if (evt && evt.waitUntil) evt.waitUntil(p.catch(() => {})); } catch (_) { /* evento já encerrado */ }
}

/* O que pode ser guardado. Três recusas, cada uma por um motivo concreto:
     · resposta que não veio OK — guardar erro é servir erro depois;
     · resposta OPACA (status 0, corpo ilegível) fora do caso das fontes, onde
       ela é normal: em qualquer outro lugar, opaca só pode ser falha, e num
       cache ficaria servida para sempre;
     · `no-store`, que é o servidor dizendo explicitamente para não guardar. */
/* ── TODA BUSCA DO WORKER TEM TETO ────────────────────────────────────────
   Uma requisição pendurada aqui não atrasa só um arquivo: ela mantém o worker
   OCUPADO. Enquanto ele tem evento em aberto, o navegador não o encerra — e a
   troca para a versão nova fica esperando. É o pior encontro possível: rede
   ruim é exatamente quando alguém aperta "Atualizar agora", e era exatamente
   quando não acontecia nada.

   `AbortController` de verdade, não uma corrida de promessas: a corrida devolve
   o controle mas deixa o pedido vivo, que é justamente o que precisa acabar. */
const TETO_BUSCA = 20000;
function buscar(req) {
  if (typeof AbortController === 'undefined') return fetch(req);
  const ac = new AbortController();
  const t = setTimeout(() => { try { ac.abort(); } catch (_) {} }, TETO_BUSCA);
  return fetch(req, { signal: ac.signal }).finally(() => clearTimeout(t));
}

function podeGuardar(r, aceitarOpaca) {
  if (!r) return false;
  if (r.type === 'opaque') return !!aceitarOpaca;
  if (!r.ok) return false;
  const cc = r.headers.get('cache-control') || '';
  return !/no-store/i.test(cc);
}

/* Devolve a promessa da gravação (ou nula, se a resposta não pode ser guardada)
   para que quem chamou a inclua no MESMO `waitUntil` registrado lá em cima, de
   forma síncrona. Registrar um `waitUntil` só aqui dentro seria tarde: o evento
   pode já ter sido encerrado, e aí a gravação fica sem quem a mantenha viva. */
function guardar(cacheNome, chave, resp, aceitarOpaca) {
  if (!podeGuardar(resp, aceitarOpaca)) return null;
  const copia = resp.clone();
  return caches.open(cacheNome).then((c) => c.put(chave, copia)).catch(() => {});
}

// ── Instalação ──────────────────────────────────────────────────────────────
/* `cache: 'reload'` não é detalhe: sem ele, o `add` pode ser atendido pelo CACHE
   HTTP do navegador — e o worker da versão NOVA guardaria o index.html VELHO no
   próprio balde. O app abriria com a casca antiga achando que está atualizado,
   que é exatamente o sintoma que este arquivo inteiro existe para eliminar. */
async function precarregar() {
  const c = await caches.open(CACHE_APP);
  // A casca vai sempre para a chave canônica, venha de './index.html' ou de './'
  // (há hospedagens que servem só a raiz, e outras só o arquivo).
  for (const origem of ['./index.html', './']) {
    try {
      const r = await fetch(new Request(origem, { cache: 'reload' }));
      if (r && r.ok) { await c.put(CHAVE_CASCA, r.clone()); break; }
    } catch (_) { /* tenta a próxima origem */ }
  }
  try {
    const m = await fetch(new Request('./manifest.webmanifest', { cache: 'reload' }));
    if (m && m.ok) await c.put('./manifest.webmanifest', m.clone());
  } catch (_) { /* o manifesto é dispensável para abrir offline */ }
}

self.addEventListener('install', (evt) => {
  evt.waitUntil(precarregar().catch(() => null));
  /* Sem skipWaiting() automático, de propósito.
     Ele fazia o worker novo assumir na hora — passando a servir ativos da
     versão NOVA para uma página que continua executando o JavaScript da
     versão VELHA. Essa mistura é a origem clássica de "atualizei e começou a
     dar erro estranho": duas versões do app vivas ao mesmo tempo, uma no
     worker e outra na página.
     O worker novo agora ESPERA. Quem decide a troca é o usuário, pelo aviso
     de atualização (ou ela acontece sozinha quando todas as abas fecham). */
});

// ── Ativação ────────────────────────────────────────────────────────────────
async function faxinaDeBaldes() {
  const nomes = await caches.keys();
  const manter = new Set([CACHE_APP, CACHE_CDN]);
  await Promise.all(nomes.filter((n) => !manter.has(n)).map((n) => caches.delete(n)));
}

/* O balde imutável não é descartado por versão, então precisa de um teto próprio
   — senão trocas de biblioteca ao longo dos anos o fariam crescer sem fim.
   `keys()` devolve na ordem de inserção, então as primeiras são as mais antigas. */
async function podarCdn() {
  try {
    const c = await caches.open(CACHE_CDN);
    const chaves = await c.keys();
    if (chaves.length <= CDN_MAX) return;
    await Promise.all(chaves.slice(0, chaves.length - CDN_MAX).map((k) => c.delete(k)));
  } catch (_) { /* poda é higiene, nunca motivo para falhar a ativação */ }
}

/* Pré-carregamento de navegação: o navegador dispara o pedido do documento EM
   PARALELO com o despertar do worker. Sem isso, toda navegação com o worker
   dormindo paga a inicialização dele antes de a rede sequer começar. */
async function ligarPreCarregamento() {
  try {
    if (self.registration && self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
  } catch (_) { /* navegador sem suporte: segue sem */ }
}

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    Promise.all([faxinaDeBaldes(), ligarPreCarregamento()])
      .then(() => podarCdn())
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
  );
});

// ── Estratégias ─────────────────────────────────────────────────────────────

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

/* Rede primeiro, com relógio. A busca CONTINUA correndo mesmo depois de perder a
   corrida, e é ela que atualiza o cache: antes, a corrida perdida descartava a
   resposta, e numa conexão lenta — acima de TIMEOUT_REDE, o que em rede móvel
   ruim é o normal, não a exceção — TODA carga servia o cache e NENHUMA o
   atualizava. O app ficava preso numa versão antiga indefinidamente, justamente
   para quem mais precisa da versão nova. */
function redePrimeiro(evt, req, cacheNome) {
  let gravacao = null;
  const daRede = buscar(req).then((r) => { gravacao = guardar(cacheNome, req, r); return r; });
  // um único waitUntil, registrado AGORA, cobrindo a busca E a gravação que ela
  // dispara — é o que garante que o worker não seja encerrado no meio
  manterVivo(evt, daRede.then(() => gravacao));
  const relogio = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_REDE));
  return Promise.race([daRede, relogio]).catch(async () => {
    const c = await caches.open(cacheNome);
    // sem casca de reserva aqui: devolver o HTML do app para um pedido de
    // manifesto ou de ícone seria pior que devolver um erro de rede honesto
    return (await c.match(req)) || Response.error();
  });
}

/* Navegação: igual à rota acima, mas aproveitando o pré-carregamento quando o
   navegador o oferece. A resposta pré-carregada precisa ser consumida — ignorá-la
   faz o navegador cancelá-la e reclamar no console. */
function responderNavegacao(evt) {
  const req = evt.request;
  let gravacao = null;
  const daRede = Promise.resolve(evt.preloadResponse)
    .catch(() => null)
    .then((pre) => pre || buscar(req))
    .then((r) => { gravacao = guardar(CACHE_APP, CHAVE_CASCA, r); return r; });
  manterVivo(evt, daRede.then(() => gravacao));
  const relogio = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_REDE));
  return Promise.race([daRede, relogio]).catch(async () => {
    const c = await caches.open(CACHE_APP);
    /* `ignoreVary` de propósito: se a hospedagem responder com um `Vary` que não
       bate na comparação, a casca guardada existiria e ainda assim não seria
       encontrada — e o app "sem conexão" com a cópia boa a um passo de distância. */
    return (await c.match(CHAVE_CASCA, { ignoreVary: true }))
        || (await c.match(req, { ignoreVary: true }))
        || respostaSemConexao();
  });
}

/* Cache e revalida — para as fontes. Aqui a resposta OPACA é aceita de
   propósito: o `<link>` do CSS das fontes vai sem `crossorigin`, então o que
   chega ao worker é opaco por natureza, não por erro. E a estratégia se
   autocorrige: revalidando a cada visita, uma entrada ruim não sobrevive. */
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

/* Cache primeiro — para bibliotecas com versão fixa na URL. Resposta opaca NÃO
   entra: aqui ela só pode ser falha, e numa estratégia "cache primeiro" ficaria
   servida para sempre, deixando o app sem nuvem até alguém limpar o cache à mão.
   As duas bibliotecas são pedidas com `crossorigin` e SRI, então o caso normal
   é uma resposta legível. */
function cachePrimeiro(evt, req, cacheNome) {
  return caches.open(cacheNome).then((c) => c.match(req)).then((guardado) => {
    if (guardado) return guardado;
    let gravacao = null;
    const rede = buscar(req).then((r) => { gravacao = guardar(cacheNome, req, r); return r; });
    manterVivo(evt, rede.then(() => gravacao));
    return rede;
  });
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

// ── Comandos vindos do app ──────────────────────────────────────────────────
self.addEventListener('message', (evt) => {
  if (!evt.data) return;
  const porta = evt.ports && evt.ports[0];

  if (evt.data === 'skipWaiting') { self.skipWaiting(); return; }

  /* Qual versão este worker está servindo. É o que permite ao Diagnóstico
     comparar com a versão da PÁGINA e detectar o desencontro — a situação exata
     que produz "atualizei e deu erro estranho". */
  if (evt.data === 'versao') {
    if (porta) porta.postMessage({ versao: VERSAO, app: CACHE_APP, cdn: CACHE_CDN });
    return;
  }

  if (evt.data === 'limparCache') {
    /* Responde ao final: sem isso, quem pediu não sabia quando podia recarregar
       e recarregava cedo demais, ainda com o cache pela metade. */
    evt.waitUntil(
      caches.keys()
        .then((n) => Promise.all(n.map((k) => caches.delete(k))))
        .then(() => { if (porta) porta.postMessage({ ok: true }); })
        .catch(() => { if (porta) porta.postMessage({ ok: false }); })
    );
  }
});
