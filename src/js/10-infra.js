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
/* ── RECARGA SEGURA E EDUCADA ──────────────────────────────────────────────
   Havia `location.reload()` espalhado por nove pontos do app. Dois problemas:

   1. RECARREGAR NO MEIO DE UMA DIGITAÇÃO. Uma atualização vinda da nuvem podia
      reiniciar a tela enquanto você escrevia um card ou preenchia um registro.
      Aqui a recarga ESPERA você terminar: se há um diálogo aberto ou o cursor
      está dentro de um campo, ela fica agendada e acontece quando a mão sai.

   2. RECARREGAR ANTES DO DISCO TERMINAR DE GRAVAR. O armazenamento do app é uma
      fachada síncrona sobre o IndexedDB: `setItem` volta na hora, mas a gravação
      real acontece logo depois, de forma assíncrona. Um reload imediato podia
      abortar essa transação — e era assim que a sessão recém-gravada do login
      às vezes não estava lá na abertura seguinte ("tive que entrar de novo").
      Agora a recarga espera o disco confirmar (com teto de 2 s, para nunca
      travar a interface). */
function _appOcupado() {
  try {
    const a = document.activeElement;
    // offsetParent nulo = o campo não está mais à vista (ex.: o campo de senha do
    // portão, que continua "focado" depois de o portão fechar). Só um campo VISÍVEL
    // significa alguém digitando.
    if (a && a.offsetParent !== null &&
        (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return true;
    // qualquer diálogo/modal visível: recarregar aqui descartaria o que a pessoa está fazendo
    const abertos = document.querySelectorAll('.cards-modal, .profile-modal, .siglas-modal, [role="dialog"]');
    for (let i = 0; i < abertos.length; i++) {
      if (abertos[i].style.display && abertos[i].style.display !== 'none') return true;
    }
  } catch (e) { _quiet(e, 'app-ocupado'); }
  return false;
}
var _recargaAgendada = null;
/* opts.imediato = a recarga foi PEDIDA pela pessoa (entrar num perfil, sair da
   conta, restaurar uma versão). Aí ela não espera nada: só a confirmação do
   disco. A espera educada é para as recargas que vêm de FORA — uma atualização
   chegando de outro aparelho no meio do seu trabalho. */
function recarregarApp(motivo, opts) {
  const ir = () => {
    try { console.info('[recarga]', motivo || 'sem motivo declarado'); } catch (e) { _quiet(e, 'recarga-log'); }
    const disco = (window.__idbFlush ? window.__idbFlush() : Promise.resolve());
    Promise.resolve(disco).catch(() => {}).then(() => location.reload());
  };
  if ((opts && opts.imediato) || !_appOcupado()) { ir(); return; }
  if (_recargaAgendada) return;                 // já há uma esperando a sua vez
  try { showToast('Há dados novos — a tela será atualizada quando você terminar aqui'); } catch (e) { _quiet(e, 'recarga-aviso'); }
  _recargaAgendada = setInterval(() => {
    if (_appOcupado()) return;
    clearInterval(_recargaAgendada); _recargaAgendada = null;
    ir();
  }, 1500);
}
window.recarregarApp = recarregarApp;

// Hook do APAGAMENTO de uma chave do perfil. Apagar também é uma alteração que
// precisa chegar aos outros aparelhos — mas pelo MANIFESTO (a lista de seções que
// o perfil tem), não como conteúdo. Marcar a seção como "suja" aqui faria subir
// uma linha vazia em vez de removê-la; por isso o apagamento tem hook próprio.
var _sectionDropHook = null;

/* ═══════════════════ LIXEIRA — apagar deixou de ser definitivo ═════════════
   O episódio que originou este código: um download tratou "esta seção não está
   na nuvem" como "esta seção foi excluída" e removeu do aparelho os cards, os
   retratos do TEC, a grade e o ciclo — o único exemplar que existia. O bug foi
   corrigido na origem, mas corrigir a origem não basta: qualquer caminho novo
   pode errar de novo, e o custo do erro é o trabalho de meses de alguém.

   Então a remoção deixa de ser destrutiva. Toda seção do perfil apagada pelo
   app passa por aqui: o valor é guardado em `__trash:<seção>` com a data e o
   motivo, e continua no aparelho por RETENCAO_DIAS. A tela de Recuperação
   lista e devolve com um clique.

   Regras que mantêm a lixeira barata:
     · só entra o que tem conteúdo (apagar chave vazia não gera lixo);
     · uma entrada por seção — reapagar substitui, não empilha;
     · expira em 30 dias e nunca passa de ORCAMENTO_BYTES (as mais antigas saem
       primeiro), então ela não come o espaço do navegador;
     · fica FORA da sincronização (sectionForKey a ignora): é uma rede local,
       não um dado do perfil.
   ═══════════════════════════════════════════════════════════════════════════ */
const Lixeira = {
  PREFIXO: '__trash:',
  RETENCAO_DIAS: 30,
  ORCAMENTO_BYTES: 2 * 1024 * 1024,

  _chave(prefixoPerfil, sec) { return prefixoPerfil + this.PREFIXO + sec; },
  /* Guarda o valor de uma seção antes de ela ser apagada. Devolve true quando
     algo foi realmente guardado (havia conteúdo). */
  guardar(chaveCompleta, motivo) {
    try {
      const valor = localStorage.getItem(chaveCompleta);
      /* Só entra o que tem CONTEÚDO — e "conteúdo" é o mesmo critério do resto
         do app (valorVazio). Com o teste antigo, `[]` contava como conteúdo: a
         partir do momento em que o esvaziamento passou a alertar a lixeira,
         uma tela que regrava `[]` a cada tecla guardaria um lixo vazio e
         dispararia a faxina (uma varredura do armazenamento) a cada tecla. */
      if (valorVazio(valor)) return false;
      const m = /^(diario-estudos:u:[^:]+:)(.+)$/.exec(chaveCompleta);
      if (!m) return false;
      const sec = m[2];
      if (sec.indexOf(this.PREFIXO) === 0 || sec.indexOf('vhist') === 0) return false;
      const pacote = JSON.stringify({ sec, em: Date.now(), motivo: motivo || '', valor });
      localStorage.setItem(this._chave(m[1], sec), pacote);
      this.faxina(m[1]);
      return true;
    } catch (e) { _quiet(e, 'lixeira-guardar'); return false; }
  },
  // Lê uma entrada da lixeira a partir da chave completa dela.
  ler(chaveCompleta) {
    try {
      const bruto = localStorage.getItem(chaveCompleta);
      if (!bruto) return null;
      const o = JSON.parse(bruto);
      if (!o || typeof o.valor !== 'string') return null;
      return { chave: chaveCompleta, sec: o.sec, em: o.em || 0, motivo: o.motivo || '', bytes: o.valor.length };
    } catch (e) { return null; }
  },
  // Tudo que está na lixeira de um perfil, do mais recente para o mais antigo.
  listar(pid) {
    const alvo = pid || (window.ProfileManager ? ProfileManager.getActiveProfileId() : null);
    if (!alvo) return [];
    const pfx = 'diario-estudos:u:' + alvo + ':' + this.PREFIXO;
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(pfx) === 0) { const it = this.ler(k); if (it) out.push(it); }
      }
    } catch (e) { _quiet(e, 'lixeira-listar'); }
    return out.sort((a, b) => b.em - a.em);
  },
  /* Devolve a seção ao lugar de onde saiu. Por padrão NÃO sobrescreve o que
     estiver lá agora — restaurar nunca pode causar uma segunda perda. */
  restaurar(chaveCompleta, sobrescrever) {
    try {
      const bruto = localStorage.getItem(chaveCompleta);
      if (!bruto) return { ok: false, motivo: 'não está mais na lixeira' };
      const o = JSON.parse(bruto);
      const m = /^(diario-estudos:u:[^:]+:)/.exec(chaveCompleta);
      if (!o || !m) return { ok: false, motivo: 'entrada ilegível' };
      const destino = m[1] + o.sec;
      const atual = localStorage.getItem(destino);
      if (!valorVazio(atual) && !sobrescrever) return { ok: false, motivo: 'já existe conteúdo aqui', sec: o.sec };
      if (DB.setRaw(destino, o.valor) === false) return { ok: false, motivo: 'não foi possível gravar' };
      localStorage.removeItem(chaveCompleta);
      return { ok: true, sec: o.sec, bytes: String(o.valor).length };
    } catch (e) { _quiet(e, 'lixeira-restaurar'); return { ok: false, motivo: 'erro' }; }
  },
  /* Expira por idade e por orçamento. Roda a cada guardada e na abertura. */
  faxina(prefixoPerfil) {
    try {
      const pfx = prefixoPerfil + this.PREFIXO;
      const itens = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(pfx) !== 0) continue;
        const it = this.ler(k);
        if (it) itens.push(it); else itens.push({ chave: k, em: 0, bytes: 0 });
      }
      const limite = Date.now() - this.RETENCAO_DIAS * 24 * 3600 * 1000;
      const vivos = [];
      itens.forEach(it => { if (it.em && it.em >= limite) vivos.push(it); else localStorage.removeItem(it.chave); });
      vivos.sort((a, b) => a.em - b.em);   // mais antigos primeiro
      let total = vivos.reduce((a, it) => a + it.bytes, 0);
      while (total > this.ORCAMENTO_BYTES && vivos.length) {
        const fora = vivos.shift();
        total -= fora.bytes;
        localStorage.removeItem(fora.chave);
      }
    } catch (e) { _quiet(e, 'lixeira-faxina'); }
  }
};
window.Lixeira = Lixeira;

/* ═══════════════════ VALOR VAZIO — a definição única ═══════════════════════
   "Esvaziar" e "apagar" são o mesmo estrago com nomes diferentes. Uma seção que
   vira `[]` perde exatamente o mesmo conteúdo que uma seção removida — só que a
   remoção passava pela Lixeira e o esvaziamento não passava por lugar nenhum.

   Esta função é o critério ÚNICO de "aqui não há mais nada", usado em três
   pontos que antes decidiam cada um do seu jeito: a gravação local (que agora
   guarda o valor anterior antes de esvaziar), a subida para a nuvem (que se
   recusa a publicar um vazio por cima de conteúdo) e a hidratação vinda da
   nuvem (que guarda o local antes de sobrescrevê-lo com nada).

   Um único lugar para mudar o critério significa que os três nunca divergem. */
function valorVazio(txt) {
  if (txt === null || txt === undefined) return true;
  const s = String(txt).trim();
  /* `'0'` NÃO entra aqui, e a distinção importa: as preferências booleanas do
     app são gravadas como '0'/'1', e '0' quer dizer "desligado" — um valor, não
     a ausência de um. Tratá-lo como vazio faria cada desligamento de opção
     parecer um apagamento. */
  return s === '' || s === '[]' || s === '{}' || s === 'null' || s === '""';
}
window.valorVazio = valorVazio;

/* ── TEMPO MUDO É O QUE PARECE TRAVAMENTO ──────────────────────────────────
   Duas telas do app fazem trabalho pesado antes da primeira pintura: o Plano
   varre todos os retratos por assunto, as Conquistas varrem todos os
   registros quatro vezes. Sem sinal, o toque no menu simplesmente não
   responde por um tempo visível e o app parece ter engasgado.

   O remédio é sempre o mesmo e por isso mora aqui, uma vez só: troque a tela
   AGORA, pinte o esqueleto no mesmo quadro, e faça a conta no quadro
   seguinte. Dois `requestAnimationFrame` porque um só ainda pode rodar antes
   de o navegador pintar — com um, o esqueleto nunca chega à tela e o
   adiamento vira custo sem benefício. */
function esqueletoCarregando(texto) {
  return '<div class="pl-skel" role="status" aria-live="polite">'
    + '<span class="pl-skel-giro" aria-hidden="true"></span>'
    + '<span class="pl-skel-txt">' + escapeHtml(texto || 'Carregando…') + '</span></div>';
}
function pintarDepois(el, texto, fn) {
  const alvo = (typeof el === 'string') ? document.getElementById(el) : el;
  if (!alvo) { fn(); return; }
  alvo.innerHTML = esqueletoCarregando(texto);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { fn(); } catch (e) { _quiet(e, 'pintar-depois'); }
  }));
}
window.esqueletoCarregando = esqueletoCarregando;
window.pintarDepois = pintarDepois;
