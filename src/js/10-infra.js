/* ═══════════════════════════════════════════════════════════════════════════
   DIÁRIO DE ESTUDOS — mapa do código
   ───────────────────────────────────────────────────────────────────────────
   Arquivo único, sem build step. A ordem abaixo é a ordem física no arquivo.

   INFRAESTRUTURA
     $id / _quiet / __diag ....... robustez: nada derruba o app por id ausente
     DB .......................... camada de dados (chave-valor, por perfil)
     PlanManager / ProfileManager  planejamentos e multi-usuário no dispositivo
     VersionHistory .............. 8 versões + backup diário
     UI .......................... diálogos (substituem confirm/prompt nativos)

   MOTORES (puros — não tocam o DOM, portáveis)
     FSRS ........................ FSRS-6 fiel ao fsrs-rs do Anki + otimizador
     CardEngine .................. agendador: passos, fuzz, leech, load balance
     TecEngine ................... parser hierárquico do relatório TecConcursos
     ReforcoEngine / CycleEngine / LawEngine / PlanoEngine

   TELAS (uma por aba)
     Registrar · Ciclo · Grade · Cards · Leis · Extras · Links · Histórico
     Evolução · Conquistas · Desempenho TEC · Ferramentas · Config

   NUVEM (opcional)
     CloudStore .................. blob + sync por seção (Supabase)
     SessionGuard ................ uma sessão por vez
     SectionSync ................. escrita/leitura por seção

   QUALIDADE
     AutoTeste.rodar() ........... suíte de testes no console
     __diag() .................... erros engolidos, ids ausentes, contadores
   ═══════════════════════════════════════════════════════════════════════════ */
/* ═══════════════════ ROBUSTEZ — infraestrutura de base ═══════════════════
   Duas peças que o app inteiro usa. Ficam ANTES de tudo de propósito: são
   dependência de qualquer módulo abaixo.
   ═════════════════════════════════════════════════════════════════════════ */

/* ── $id(): getElementById que NUNCA devolve null ─────────────────────────
   O app roda num escopo global único: `$id('x').value`
   com um id ausente lançava TypeError e derrubava TODA a inicialização — um
   id renomeado no HTML apagava o aplicativo inteiro.

   $id devolve o elemento quando ele existe e, quando não existe, um elemento
   DESCARTÁVEL que aceita as mesmas operações sem efeito: ler .value dá '',
   escrever não faz nada, addEventListener registra num nó que ninguém verá.
   A falha vira LOCAL e VISÍVEL (console.warn uma vez por id) em vez de fatal.

   O elemento nulo é criado NOVO a cada chamada de propósito: reaproveitar um
   só faria dois ids ausentes compartilharem listeners — `$id('a')
   .addEventListener('click', f)` seguido de `$id('b').click()` dispararia f. */
const _idsAusentes = new Set();
function $id(id) {
  const el = document.getElementById(id);
  if (el) return el;
  if (!_idsAusentes.has(id)) {
    _idsAusentes.add(id);
    try { console.warn('[$id] elemento ausente no DOM: #' + id + ' — a ação foi ignorada (o app continua).'); } catch (_) { _quiet(_); }
  }
  // <div> destacado + expandos .value/.checked: cobre tudo que o app acessa
  // (value, checked, style, classList, innerHTML, textContent, focus, click,
  // addEventListener, getAttribute) sem lançar e sem efeito colateral.
  const nulo = document.createElement('div');
  nulo.value = ''; nulo.checked = false;
  nulo.dataset.idAusente = id;
  return nulo;
}
window.$id = $id;

/* ── _quiet(): erros engolidos passam a deixar rastro ─────────────────────
   Havia 169 blocos `catch (_) { _quiet(_); }`. Cada um transformava uma falha real —
   cota estourada, IndexedDB bloqueado, JSON corrompido — em silêncio: o
   usuário achava que salvou. Remover os catch seria pior (quebraria fluxos
   que dependem da tolerância). Então eles continuam engolindo, mas agora
   REGISTRAM: contador, buffer circular dos últimos 50 e console.debug.
   Diagnóstico pelo console: __diag()  */
const _engolidos = { total: 0, ultimos: [], porTipo: Object.create(null) };
function _quiet(err, ctx) {
  try {
    _engolidos.total++;
    const nome = (err && (err.name || err.constructor && err.constructor.name)) || 'erro';
    const msg = (err && (err.message || err.toString && err.toString())) || String(err);
    _engolidos.porTipo[nome] = (_engolidos.porTipo[nome] || 0) + 1;
    _engolidos.ultimos.push({ t: Date.now(), nome, msg: String(msg).slice(0, 200), ctx: ctx || null });
    if (_engolidos.ultimos.length > 50) _engolidos.ultimos.shift();
    if (console && console.debug) console.debug('[engolido]', nome, msg, ctx || '');
  } catch (_) { /* o registrador nunca pode derrubar o chamador */ }
}
window.__diag = function () {
  const d = {
    errosEngolidos: _engolidos.total,
    porTipo: Object.assign({}, _engolidos.porTipo),
    ultimos: _engolidos.ultimos.slice(-15),
    idsAusentes: Array.from(_idsAusentes),
    armazenamento: (window.__idbShim ? 'IndexedDB' : 'localStorage nativo'),
    cards: (function () { try { return DB.getCards().length; } catch (_) { return '?'; } })(),
    revisoes: (function () { try { return (DB.getRevlog() || []).length; } catch (_) { return '?'; } })()
  };
  try { console.table(d.porTipo); } catch (_) { _quiet(_); }
  return d;
};

/* ── Endurecimento contra poluição de prototype ───────────────────────────
   Defesa em profundidade para o caminho de IMPORTAÇÃO (planilha .xlsx, JSON
   de backup, colagem do TEC): esses fluxos parseiam dados de fora. Congelar
   os prototypes básicos faz uma tentativa de escrever em __proto__/constructor
   falhar em vez de contaminar todo objeto do app.
   Feito ANTES de qualquer parse e depois que os polyfills já rodaram. */
(function endurecerPrototypes() {
  try {
    // Escopo estreito de propósito: Object/Array.prototype são os alvos reais da
    // poluição de prototype. Congelar Function/String/Number ampliaria a
    // superfície de quebra sem ganho proporcional.
    Object.freeze(Object.prototype);
    Object.freeze(Array.prototype);
  } catch (e) { _quiet(e, 'freeze-prototypes'); }
})();

/* ── Guarda de estrutura para dados importados ────────────────────────────
   Rejeita chaves perigosas em qualquer JSON vindo de fora antes de ele
   encostar no estado do app. Complementa o congelamento acima. */
function jsonSeguro(texto) {
  const PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);
  return JSON.parse(texto, function (k, v) {
    if (PROIBIDAS.has(k)) return undefined;
    return v;
  });
}
window.jsonSeguro = jsonSeguro;

// Hook seguro para a sincronização na nuvem (CloudStore é definido bem mais abaixo no script).
// Usar `var` evita o erro de "temporal dead zone" que aconteceria com `typeof CloudStore`
// caso DB._set seja chamado durante a inicialização, antes do CloudStore existir.
var _cloudNotifyHook = null;
// Hook da SINCRONIZAÇÃO POR SEÇÃO (Opção B, Fase 1 = escrita dupla). Marca a seção
// alterada como "suja" para ser enviada à tabela profile_sections em paralelo ao blob.
// var (não const) evita erro de zona morta se DB._set rodar antes do SectionSync existir.
var _sectionMarkHook = null;
// Hook do APAGAMENTO de uma chave do perfil. Apagar também é uma alteração que
// precisa chegar aos outros aparelhos — mas pelo MANIFESTO (a lista de seções que
// o perfil tem), não como conteúdo. Marcar a seção como "suja" aqui faria subir
// uma linha vazia em vez de removê-la; por isso o apagamento tem hook próprio.
var _sectionDropHook = null;
