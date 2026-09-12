/* ════════════════════════════════════════════════════════════════════════════
   SANITIZAÇÃO DE CARDS — proteção do conteúdo que vira HTML de verdade
   ────────────────────────────────────────────────────────────────────────────
   Os cards são renderizados com innerHTML de propósito (negrito, cores, imagens,
   tabelas — é um editor de texto rico). Isso é seguro para o que VOCÊ digita.
   O risco está no que vem DE FORA: um .tsv/.json de baralho trocado com colega
   ou baixado da internet podia trazer <img src=x onerror="..."> e executar
   script dentro do app — com acesso ao token do Supabase guardado no
   localStorage (ou seja: acesso à sua conta na nuvem).

   Diferente do rteSanitize (usado ao COLAR), aqui as CORES são preservadas:
   um baralho importado deve manter o realce original do autor.

   Por que DOMParser e não innerHTML num <div> solto: o documento do DOMParser é
   INERTE — não busca imagens nem dispara onerror durante a análise. Atribuir
   innerHTML a um div desanexado, em alguns navegadores, já inicia o carregamento
   das imagens ANTES de removermos o onerror.
   ══════════════════════════════════════════════════════════════════════════ */
// FONT entra na lista porque o próprio editor produz <font color> / <font size>
// (é o que o execCommand gera no Chrome) — sem ela, sanear apagaria as cores que
// você aplicou pela barra de ferramentas.
const CARD_TAGS_OK = new Set([...RTE_TAGS_OK, 'FONT']);
const CARD_CSS_OK = /^(font-weight|font-style|font-size|font-family|text-decoration|text-align|color|background-color|background|border|border-color|padding|margin|width|height|vertical-align|line-height|list-style-type|white-space)$/;
const _sanCache = new Map();   // memória curta: sanear o mesmo card em cada re-render sai caro

function sanitizeCardHtml(html) {
  const s = String(html == null ? '' : html);
  if (!s || s.indexOf('<') < 0) return s;          // texto puro: nada a fazer
  const hit = _sanCache.get(s);
  if (hit !== undefined) return hit;
  let out;
  try {
    const doc = new DOMParser().parseFromString('<body>' + s + '</body>', 'text/html');
    const body = doc.body;
    body.querySelectorAll('*').forEach(el => {
      // toUpperCase é ESSENCIAL: elementos em namespace SVG/MathML preservam a
      // caixa original ("svg", "script"), então comparar com a lista em maiúsculas
      // deixava <svg><script> passar batido — a tag era só desembrulhada e o corpo
      // do script sobrava como texto solto dentro do card.
      const tag = (el.tagName || '').toUpperCase();
      // Estas saem COM o conteúdo (senão o corpo de um <script> vazaria como texto)
      if (RTE_TAGS_FORA.has(tag)) { el.remove(); return; }
      // Tag desconhecida: some a tag, o texto de dentro fica
      if (!CARD_TAGS_OK.has(tag)) { el.replaceWith(...el.childNodes); return; }
      [...el.attributes].forEach(a => {
        const nome = a.name.toLowerCase();
        const val = String(a.value || '');
        // qualquer manipulador de evento (onerror, onload, onclick...) cai aqui
        if (nome.startsWith('on') || nome === 'srcdoc' || nome === 'formaction' || nome === 'xlink:href') {
          el.removeAttribute(a.name); return;
        }
        if (nome === 'style') {
          const manter = [];
          val.split(';').forEach(d => {
            const i = d.indexOf(':');
            if (i < 0) return;
            const prop = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim();
            if (!v || !CARD_CSS_OK.test(prop)) return;
            // url() traria rastreamento externo; expression()/@import executam CSS ativo
            if (/url\s*\(|expression|javascript:|@import|behavior/i.test(v)) return;
            manter.push(prop + ':' + v);
          });
          if (manter.length) el.setAttribute('style', manter.join(';')); else el.removeAttribute('style');
          return;
        }
        // 'class' fica de fora de propósito: um card importado não deve poder vestir
        // as classes do app e quebrar o layout da tela de revisão.
        if (!['href','src','alt','title','colspan','rowspan','color','size','face'].includes(nome)) {
          el.removeAttribute(a.name); return;
        }
        if (nome === 'href' || nome === 'src') {
          // \u0000-\u0020 fora: "java\tscript:" e afins driblariam a checagem
          const url = val.trim().replace(/[\u0000-\u0020]/g, '');
          const ok = (nome === 'src')
            ? (/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(url) || /^https?:\/\//i.test(url))
            : /^(https?:|mailto:)/i.test(url);
          if (!ok) el.removeAttribute(a.name);
        }
      });
      if (tag === 'A') {
        if (!el.getAttribute('href')) el.replaceWith(...el.childNodes);
        else { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      }
      if (tag === 'IMG' && !el.getAttribute('src')) el.remove();
    });
    out = body.innerHTML;
  } catch (_) {
    out = s.replace(/</g, '&lt;');   // sem DOMParser: degrada para texto puro (nunca executa)
  }
  if (_sanCache.size > 600) _sanCache.clear();
  _sanCache.set(s, out);
  return out;
}
window.sanitizeCardHtml = sanitizeCardHtml;

function rteSanitize(html) {
  // Mesma razão do DOMParser acima: análise inerte, sem carregar recurso nenhum.
  let tmp;
  try { tmp = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html').body; }
  catch (_) { tmp = document.createElement('div'); tmp.textContent = String(html || ''); return tmp.innerHTML; }
  tmp.querySelectorAll('*').forEach(el => {
    if (!el.isConnected && !tmp.contains(el)) return;
    // toUpperCase: elementos SVG/MathML mantêm a caixa original, então <svg> e o
    // <script> dentro dele escapavam da comparação com as listas em maiúsculas.
    const tag = (el.tagName || '').toUpperCase();
    if (RTE_TAGS_FORA.has(tag)) { el.remove(); return; }
    if (!RTE_TAGS_OK.has(tag)) { el.replaceWith(...el.childNodes); return; }
    [...el.attributes].forEach(a => {
      const nome = a.name.toLowerCase();
      // qualquer on* (onerror, onclick...) e URLs javascript: saem
      if (nome.startsWith('on') || /javascript:/i.test(a.value)) { el.removeAttribute(a.name); return; }
      if (nome === 'style') {
        // Mantém só formatação neutra. COR e FUNDO são descartados de propósito: texto
        // branco copiado de um site escuro ficava invisível no card claro (e vice-versa).
        // Para colorir, use a paleta da própria barra de ferramentas.
        const manter = [];
        a.value.split(';').forEach(d => {
          const i = d.indexOf(':');
          if (i < 0) return;
          const prop = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim();
          if (!val) return;
          if (/^(font-weight|font-style|text-decoration|text-align)$/.test(prop)) manter.push(prop + ':' + val);
        });
        if (manter.length) el.setAttribute('style', manter.join(';')); else el.removeAttribute('style');
        return;
      }
      if (!['href', 'src', 'alt', 'title', 'colspan', 'rowspan'].includes(nome)) el.removeAttribute(a.name);
    });
    if (tag === 'A') {
      if (!el.getAttribute('href')) el.replaceWith(...el.childNodes);
      else { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    }
    if (tag === 'IMG' && !el.getAttribute('src')) el.remove();
  });
  return tmp.innerHTML;
}
function rteExec(area, cmd, val) { area.focus(); try { document.execCommand(cmd, false, val || null); } catch (e) { _quiet(e); } }
// Converte HTML em TEXTO PURO preservando as quebras de linha (blocos/br viram \n).
// Base do botão "Limpar formatação" — remove cor, fonte, fundo, negrito etc. do texto colado.
function rtePlainFromHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  tmp.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  // isola cada bloco com quebras antes e depois, para não grudar parágrafos/linhas/células
  // (mesmo quando um bloco vem logo após texto inline)
  tmp.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, blockquote, pre').forEach(el => {
    el.insertBefore(document.createTextNode('\n'), el.firstChild);
    el.appendChild(document.createTextNode('\n'));
  });
  return (tmp.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Insere TEXTO PURO num range (substituindo o conteúdo) sem herdar cor/fonte/fundo.
// O truque é reconstruir com nós de texto reais (não execCommand, que herda o estilo
// do ponto de inserção) e, em seguida, "desembrulhar" spans que passaram a envolver
// somente o texto limpo — assim uma palavra colorida totalmente selecionada fica limpa.
function _rteInsertPlain(range, txt, area) {
  range.deleteContents();
  const frag = document.createDocumentFragment();
  const nodes = [];
  String(txt).split('\n').forEach((line, i) => {
    if (i) { const br = document.createElement('br'); frag.appendChild(br); nodes.push(br); }
    const tn = document.createTextNode(line); frag.appendChild(tn); nodes.push(tn);
  });
  range.insertNode(frag);
  // desembrulha ancestrais inline que envolvem APENAS o texto recém-inserido
  const INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'FONT', 'SPAN', 'MARK', 'SUB', 'SUP', 'SMALL', 'BIG']);
  let el = nodes[0] && nodes[0].parentNode;
  while (el && el !== area && INLINE.has(el.tagName)) {
    const outros = [...el.childNodes].filter(k => !nodes.includes(k) && !(k.nodeType === 3 && !k.textContent.trim()));
    if (outros.length) break;                 // tem outro conteúdo → preserva a formatação dele
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    el = parent;
  }
  // posiciona o cursor ao fim do texto inserido
  const last = nodes[nodes.length - 1];
  if (last) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStartAfter(last); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
  }
}
// Limpa a formatação: com um trecho selecionado, limpa só ele; senão, limpa o editor todo.
function rteClearFormatting(area) {
  area.focus();
  const sel = window.getSelection ? window.getSelection() : null;
  const dentro = sel && sel.rangeCount && area.contains(sel.anchorNode) && area.contains(sel.focusNode);
  const temSelecao = dentro && !sel.getRangeAt(0).collapsed;
  if (temSelecao) {
    const range = sel.getRangeAt(0);
    const div = document.createElement('div'); div.appendChild(range.cloneContents());
    const txt = rtePlainFromHtml(div.innerHTML);
    _rteInsertPlain(range, txt, area);
    showToast('Formatação removida da seleção ✓');
  } else {
    const txt = rtePlainFromHtml(area.innerHTML);
    if (!txt) { showToast('Nada para limpar'); return; }
    const range = document.createRange();
    range.selectNodeContents(area);
    _rteInsertPlain(range, txt, area);
    showToast('Formatação de todo o texto removida ✓');
  }
}
// paleta compacta: [rótulo, cor]
const RTE_TEXT_COLORS = [['Preto', '#1a1c20'], ['Vermelho', '#e0393f'], ['Verde', '#0f9d63'], ['Azul', '#2563eb'], ['Roxo', '#7c3aed'], ['Laranja', '#d97a12']];
const RTE_HILITE_COLORS = [['Amarelo', '#fde68a'], ['Verde', '#bbf7d0'], ['Azul', '#bfdbfe'], ['Rosa', '#fbcfe8'], ['Laranja', '#fed7aa']];

function buildRteToolbar(rte) {
  const target = rte.dataset.target;
  const area = document.getElementById(target);
  const tb = rte.querySelector('.rte-toolbar');
  const hasCloze = rte.dataset.cloze === '1';
  // monta os grupos
  const swatches = (arr, kind) => arr.map(([nome, cor]) =>
    `<button type="button" class="rte-swatch" data-${kind}="${cor}" title="${nome}" aria-label="${nome}" style="background:${cor}"></button>`).join('');
  tb.innerHTML = `
    <div class="rte-grp">
      <button type="button" data-cmd="bold" title="Negrito (Ctrl+B)" aria-label="Negrito (Ctrl+B)"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Itálico (Ctrl+I)" aria-label="Itálico (Ctrl+I)"><i>I</i></button>
      <button type="button" data-cmd="underline" title="Sublinhado (Ctrl+U)" aria-label="Sublinhado (Ctrl+U)"><u>U</u></button>
      <button type="button" data-cmd="strikeThrough" title="Tachado" aria-label="Tachado"><s>S</s></button>
    </div>
    <span class="rte-sep"></span>
    <div class="rte-grp rte-color-grp">
      <span class="rte-color-label" title="Cor do texto">A</span>${swatches(RTE_TEXT_COLORS, 'color')}
    </div>
    <span class="rte-sep"></span>
    <div class="rte-grp rte-color-grp">
      <span class="rte-color-label" title="Marca-texto">🖍️</span>${swatches(RTE_HILITE_COLORS, 'hilite')}
      <button type="button" data-cmd="removeHilite" title="Remover marca-texto" aria-label="Remover marca-texto">⌫</button>
    </div>
    <span class="rte-sep"></span>
    <div class="rte-grp">
      <select class="rte-size" title="Tamanho do texto">
        <option value="">Tamanho</option>
        <option value="2">Pequeno</option>
        <option value="3">Normal</option>
        <option value="5">Grande</option>
        <option value="6">Título</option>
      </select>
    </div>
    <span class="rte-sep"></span>
    <div class="rte-grp">
      <button type="button" data-cmd="justifyLeft" title="Esquerda" aria-label="Esquerda">⬅</button>
      <button type="button" data-cmd="justifyCenter" title="Centro" aria-label="Centro">⬍</button>
      <button type="button" data-cmd="justifyRight" title="Direita" aria-label="Direita">➡</button>
    </div>
    <span class="rte-sep"></span>
    <div class="rte-grp">
      <button type="button" data-cmd="insertUnorderedList" title="Lista">• Lista</button>
      <button type="button" data-cmd="insertOrderedList" title="Numerada" aria-label="Numerada">1.</button>
    </div>
    <span class="rte-sep"></span>
    <div class="rte-grp">
      <button type="button" data-link="1" title="Inserir link" aria-label="Inserir link">🔗</button>
      <button type="button" data-img="1" title="Inserir imagem" aria-label="Inserir imagem">🖼️</button>
      <button type="button" data-table="1" title="Inserir tabela" aria-label="Inserir tabela">▦</button>
      ${hasCloze ? `<button type="button" data-clozebtn="1" title="Ocultar seleção (cloze)" style="display:none;" id="card-cloze-btn">{{ }} Ocultar</button>` : ''}
    </div>
    <span class="rte-sep"></span>
    <div class="rte-grp">
      <button type="button" data-cmd="undo" title="Desfazer (Ctrl+Z)" aria-label="Desfazer (Ctrl+Z)">↶</button>
      <button type="button" data-cmd="redo" title="Refazer (Ctrl+Y)" aria-label="Refazer (Ctrl+Y)">↷</button>
      <button type="button" data-plain="1" title="Limpar formatação do texto colado (deixa como texto puro). Com um trecho selecionado, limpa só ele.">🧹 Limpar</button>
      <button type="button" data-cmd="removeFormat" title="Remover só negrito/itálico/cor da seleção" aria-label="Remover só negrito/itálico/cor da seleção">✕</button>
    </div>`;

  // preserva seleção: nenhum controle da toolbar pode roubar o foco
  tb.querySelectorAll('button, .rte-swatch, select, .rte-color-label').forEach(el => el.addEventListener('mousedown', (e) => e.preventDefault()));

  // comandos simples
  tb.querySelectorAll('button[data-cmd]').forEach(btn => btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd;
    if (cmd === 'removeHilite') rteExec(area, 'hiliteColor', 'transparent');
    else rteExec(area, cmd);
  }));
  // 🧹 Limpar formatação: converte o texto colado (seleção ou tudo) em texto puro
  const plainBtn = tb.querySelector('[data-plain]');
  if (plainBtn) plainBtn.addEventListener('click', () => rteClearFormatting(area));
  // cores de texto e marca-texto
  tb.querySelectorAll('[data-color]').forEach(sw => sw.addEventListener('click', () => rteExec(area, 'foreColor', sw.dataset.color)));
  tb.querySelectorAll('[data-hilite]').forEach(sw => sw.addEventListener('click', () => rteExec(area, 'hiliteColor', sw.dataset.hilite)));
  // tamanho
  const sizeSel = tb.querySelector('.rte-size');
  if (sizeSel) sizeSel.addEventListener('change', () => { if (sizeSel.value) rteExec(area, 'fontSize', sizeSel.value); sizeSel.value = ''; });
  // link
  const linkBtn = tb.querySelector('[data-link]');
  if (linkBtn) linkBtn.addEventListener('click', () => {
    UI.prompt([{ key: 'url', label: 'URL do link', type: 'text', value: 'https://', placeholder: 'https://...' }], { title: '🔗 Inserir link', okText: 'Inserir' }).then(v => {
      if (v && v.url) rteExec(area, 'createLink', v.url);
    });
  });
  // imagem
  const imgBtn = tb.querySelector('[data-img]');
  if (imgBtn) imgBtn.addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', () => { if (inp.files[0]) insertImageFile(area, inp.files[0]); });
    inp.click();
  });
  // tabela
  const tableBtn = tb.querySelector('[data-table]');
  if (tableBtn) tableBtn.addEventListener('click', () => {
    UI.prompt([{ key: 'dims', label: 'Tabela — linhas x colunas', type: 'text', value: '2x2', placeholder: 'ex.: 3x2' }], { title: '▦ Inserir tabela', okText: 'Inserir' }).then(v => {
      if (!v || !v.dims) return;
      const m = v.dims.match(/(\d+)\s*[x×]\s*(\d+)/i);
      if (!m) { showToast('Formato inválido. Use linhas x colunas (ex.: 3x2)'); return; }
      const r = Math.min(20, +m[1]), c = Math.min(10, +m[2]);
      let t = '<table class="rte-table"><tbody>';
      for (let i = 0; i < r; i++) { t += '<tr>'; for (let j = 0; j < c; j++) t += '<td>&nbsp;</td>'; t += '</tr>'; }
      t += '</tbody></table><p><br></p>';
      rteExec(area, 'insertHTML', t);
    });
  });
  // cloze
  const clozeBtn = tb.querySelector('[data-clozebtn]');
  if (clozeBtn) clozeBtn.addEventListener('click', () => {
    area.focus();
    const t = window.getSelection ? String(window.getSelection()).trim() : '';
    if (!t) { showToast('Selecione o trecho que deseja ocultar'); return; }
    try { document.execCommand('insertText', false, '{{' + t + '}}'); }
    catch (e) { document.execCommand('insertHTML', false, '{{' + t + '}}'); }
  });
  // colar: imagem direto (Ctrl+V) ou HTML já higienizado
  area.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    const items = (cd || {}).items || [];
    for (const it of items) {
      if (it.type && it.type.indexOf('image') === 0) { e.preventDefault(); insertImageFile(area, it.getAsFile()); return; }
    }
    if (!cd) return;
    const html = cd.getData('text/html');
    if (html) {
      e.preventDefault();
      const limpo = rteSanitize(html);
      try { document.execCommand('insertHTML', false, limpo); }
      catch (_) { area.innerHTML += limpo; }
    }
  });
}
document.querySelectorAll('.rte').forEach(buildRteToolbar);

/* ---- listeners da tela Cards ---- */
(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  // abas
  document.querySelectorAll('.cards-tab').forEach(t => t.addEventListener('click', () => {
    CardsScreen.tab = t.dataset.ctab;
    document.querySelectorAll('.cards-tab').forEach(x => x.classList.toggle('active', x === t));
    CardsScreen._reviewIdx = 0;
    CardsScreen.renderContent();
  }));
  // filtro colapsável
  on('cards-filter-toggle', 'click', () => {
    const card = document.getElementById('cards-filter-card');
    const body = document.getElementById('cards-filter-body');
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (card) card.classList.toggle('collapsed', open);
    $id('cards-filter-caret').textContent = open ? '▸' : '▾';
  });
  // busca
  on('cards-search', 'input', (e) => { CardsScreen.filters.busca = e.target.value; CardsScreen._reviewIdx = 0; CardsScreen.renderContent(); });
  on('cards-f-materia', 'change', (e) => {
    CardsScreen.filters.materias = e.target.value ? new Set([e.target.value]) : new Set();
    CardsScreen._reviewIdx = 0; CardsScreen.renderContent();
  });
  on('cards-f-topico', 'change', (e) => { CardsScreen.filters.topico = e.target.value; CardsScreen._reviewIdx = 0; CardsScreen.renderContent(); });
  on('cards-f-tipo', 'change', (e) => { CardsScreen.filters.tipo = e.target.value; CardsScreen._reviewIdx = 0; CardsScreen.renderContent(); });
  // status pills
  document.querySelectorAll('#cards-f-status .cards-pill').forEach(p => p.addEventListener('click', () => {
    document.querySelectorAll('#cards-f-status .cards-pill').forEach(x => x.classList.toggle('active', x === p));
    CardsScreen.filters.status = p.dataset.status; CardsScreen._reviewIdx = 0; CardsScreen.renderContent();
  }));
  on('cards-f-fav', 'click', () => {
    CardsScreen.filters.favorito = !CardsScreen.filters.favorito;
    $id('cards-f-fav').classList.toggle('active', CardsScreen.filters.favorito);
    CardsScreen._reviewIdx = 0; CardsScreen.renderContent();
  });
  // topo
  on('cards-algo-btn', 'click', () => CardsScreen.openAlgoConfig());
  // atalho 📊: pula direto para a aba Estatísticas
  on('cards-stats-btn', 'click', () => {
    CardsScreen.tab = 'stats';
    document.querySelectorAll('.cards-tab').forEach(x => x.classList.toggle('active', x.dataset.ctab === 'stats'));
    CardsScreen.renderContent();
  });
  on('cards-new-btn', 'click', () => CardsScreen.openCardModal(null));
  on('cards-foco-btn', 'click', () => CardsScreen.entrarFoco());
  // menu "Mais" da barra de cards (abre/fecha; fecha ao escolher, clicar fora ou Esc)
  (function () {
    const btn = document.getElementById('cards-more-btn');
    const menu = document.getElementById('cards-more-menu');
    if (!btn || !menu) return;
    const close = () => { menu.classList.remove('open'); btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    const toggle = () => { const open = menu.classList.contains('open'); if (open) close(); else { menu.classList.add('open'); btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); } };
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    menu.querySelectorAll('button').forEach(b => b.addEventListener('click', close));
    document.addEventListener('click', (e) => { if (!e.target.closest('#cards-more-menu') && !e.target.closest('#cards-more-btn')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  })();
  on('foco-sair', 'click', () => CardsScreen.sairFoco());
  on('foco-undo', 'click', () => CardsScreen.undoAnswer());
  on('cards-deck-btn', 'click', () => CardsScreen.openDeckModal());
  on('cards-export-btn', 'click', () => CardsScreen.openExportModal());
    on('cards-audit-export-btn', 'click', () => CardsScreen.exportAudit());
  on('cards-import-btn', 'click', () => CardsScreen.openImportModal());
  // modal card
  on('card-modal-close', 'click', () => CardsScreen.fecharCardComAviso());
  on('card-cancel', 'click', () => CardsScreen.fecharCardComAviso());
  on('card-kind', 'change', () => CardsScreen.applyKindUI());
  on('card-save-close', 'click', () => CardsScreen.saveCard(true));
  on('card-save-another', 'click', () => CardsScreen.saveCard(false));
  on('card-del-btn', 'click', () => CardsScreen.deleteCard());
  // modal baralho
  on('deck-modal-close', 'click', () => $id('deck-modal').style.display = 'none');
  on('deck-modal-done', 'click', () => $id('deck-modal').style.display = 'none');
  on('deck-add-btn', 'click', () => CardsScreen.addDeck());
  on('deck-new-input', 'keydown', (e) => { if (e.key === 'Enter') CardsScreen.addDeck(); });
  // modal exportar
  on('cards-export-close', 'click', () => $id('cards-export-modal').style.display = 'none');
  on('cards-export-cancel', 'click', () => $id('cards-export-modal').style.display = 'none');
  on('cards-export-anki', 'click', () => CardsScreen.exportAnki());
  on('cards-export-json', 'click', () => CardsScreen.exportJson());
  // modal importar
  on('cards-import-close', 'click', () => $id('cards-import-modal').style.display = 'none');
  on('cards-import-cancel', 'click', () => $id('cards-import-modal').style.display = 'none');
  on('cards-import-do', 'click', () => CardsScreen.doImport());
  const dz = document.getElementById('cards-import-drop');
  if (dz) {
    dz.addEventListener('click', () => $id('cards-import-file').click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files[0]) CardsScreen.handleImportFile(e.dataTransfer.files[0]); });
  }
  on('cards-import-file', 'change', (e) => { if (e.target.files[0]) CardsScreen.handleImportFile(e.target.files[0]); });
  // fechar modais clicando fora
  // Clique no fundo fecha o diálogo — MENOS quando há conteúdo digitado no card.
  // Perder uma frente/verso já escrita por um clique fora é o pior tipo de erro:
  // silencioso e irrecuperável.
  // O modal de CARD e o de LEI ficam FORA desta lista de propósito: neles você
  // digita conteúdo, e um clique acidental no fundo apagava tudo em silêncio.
  // Fechar esses dois é sempre explícito (✕, Cancelar ou Esc).
  ['deck-modal', 'cards-import-modal', 'cards-export-modal'].forEach(id => {
    const m = document.getElementById(id);
    /* fundo desfocado nao fecha o modal: so o X / Cancelar / Esc fecham */
  });
  // Esc fecha o card, confirmando quando há conteúdo
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = document.getElementById('card-modal');
    if (!m || m.style.display !== 'flex') return;
    e.preventDefault();
    // Abre no próximo tick: o handler global do diálogo é registrado no
    // DOMContentLoaded, portanto roda DEPOIS deste. Abrindo a confirmação agora,
    // o mesmo Esc chegaria nele e a fecharia no mesmo instante.
    setTimeout(() => CardsScreen.fecharCardComAviso(), 0);
  });
})();
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'cards') CardsScreen.render();
  /* ── CONQUISTAS ABRE ANTES DE TERMINAR DE CONTAR ────────────────────────
     A tela varre TODOS os registros de estudo quatro vezes (calendário,
     marcos, recordes, medalhas com níveis) antes de pintar um pixel. Com
     alguns anos de diário isso prende o toque no menu por um tempo visível, e
     o app parece ter engasgado — o mesmo sintoma da aba do Plano, pela mesma
     causa: trabalho síncrono antes da primeira pintura.

     A troca de tela acontece agora; a contagem, no quadro seguinte, com um
     sinal de que ela está acontecendo. O tempo total não muda — deixa de ser
     tempo mudo. Dois `requestAnimationFrame` porque um só ainda pode rodar
     antes de o navegador pintar. */
  if (e.detail.screen === 'conquistas') {
    pintarDepois('conquistas-body', 'Reunindo as suas conquistas…',
      () => EvolucaoScreen.renderConquistas());
  }
});
