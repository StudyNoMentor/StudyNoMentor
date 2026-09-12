/* ============================================================
   TELA: LEIS SECAS — vade mecum com destaque de pegadinhas
   ============================================================ */
const LeisScreen = {
  currentId: null,
  fontStep: 0, // -2..+4
  // Preferências do leitor: por PERFIL e sincronizadas (antes eram chaves globais do navegador)
  _prefKey(nome) { try { return DB._profilePrefix() + 'lei-' + nome; } catch (_) { return 'diario-estudos:lei-' + nome; } },
  _prefGet(nome, legado, padrao) {
    try {
      const v = localStorage.getItem(this._prefKey(nome));
      if (v !== null) return v;
      const lv = legado ? localStorage.getItem(legado) : null;
      if (lv !== null) { this._prefSet(nome, lv); return lv; }
    } catch (_) { _quiet(_); }
    return padrao;
  },
  _prefSet(nome, valor) { DB.setRaw(this._prefKey(nome), String(valor)); },

  /* ── O QUE APARECE NA TELA (preferências do leitor) ──────────────────────
     A tela nasceu acumulando faixas: chips de metadados, seis filtros de cor,
     a dica do marca-texto, o painel de destaques, a barra fixa. Cada uma se
     justifica sozinha; juntas, empurram a lei para baixo da dobra e fazem a
     tela parecer desarrumada. Aqui cada faixa vira uma escolha do usuário,
     guardada por PERFIL e sincronizada como as demais preferências.
     'classe' é a classe que a ausência liga em #screen-leis — a regra de CSS
     correspondente esconde a faixa. */
  PREFS: [
    { k: 'p-linhas', grupo: 'leitura', padrao: '0', lbl: '🔢 Numeração das linhas',
      sub: 'Numera cada linha e permite fixar onde você parou' },
    { k: 'p-justificado', grupo: 'leitura', padrao: '0', lbl: '⚖️ Texto justificado',
      sub: 'Alinha os dois lados, como no papel. Em tela estreita abre buracos entre as palavras' },
    { k: 'p-chips', grupo: 'partes', padrao: '1', classe: 'leis-cfg-sem-chips', lbl: '🏷️ Etiquetas do cabeçalho',
      sub: 'Matéria, referência, nº de artigos e de palavras' },
    { k: 'p-cores', grupo: 'partes', padrao: '1', classe: 'leis-cfg-sem-cores', lbl: '🎨 Filtros de cor',
      sub: 'A fileira de categorias do destaque automático' },
    { k: 'p-dica', grupo: 'partes', padrao: '1', classe: 'leis-cfg-sem-dica', lbl: '💡 Dica do marca-texto',
      sub: 'O lembrete azul entre a barra e o texto da lei' },
    { k: 'p-painel', grupo: 'partes', padrao: '1', classe: 'leis-cfg-sem-painel', lbl: '📋 Painel "Seus destaques"',
      sub: 'A lista dos trechos marcados, no fim da página' },
    { k: 'p-sticky', grupo: 'partes', padrao: '1', classe: 'leis-cfg-sem-sticky', lbl: '📌 Barra fixa no topo',
      sub: 'Desligada, a barra rola junto com o texto e libera a tela' }
  ],
  prefOn(k) {
    const d = this.PREFS.find(x => x.k === k);
    return this._prefGet(k, null, d ? d.padrao : '1') === '1';
  },
  prefSetOn(k, on) { this._prefSet(k, on ? '1' : '0'); },
  conforto() {
    const v = this._prefGet('p-conforto', null, 'normal');
    return ['compacto', 'normal', 'amplo'].includes(v) ? v : 'normal';
  },
  // Aplica TODAS as preferências de uma vez: é o único ponto que mexe nas
  // classes da tela, então não há como um ajuste ficar meio aplicado.
  aplicarPrefs() {
    const tela = document.getElementById('screen-leis');
    if (tela) {
      this.PREFS.forEach(d => { if (d.classe) tela.classList.toggle(d.classe, !this.prefOn(d.k)); });
      const c = this.conforto();
      ['compacto', 'normal', 'amplo'].forEach(v => tela.classList.toggle('leis-cfg-conf-' + v, v === c));
    }
    const body = document.getElementById('lei-reader-body');
    if (body) body.classList.toggle('sem-justificar', !this.prefOn('p-justificado'));
    // a numeração é a mesma preferência do botão "🔢 Linhas": um estado só
    this.showLines = this.prefOn('p-linhas');
    if (body) body.classList.toggle('show-lines', !!this.showLines);
    this._pintarBotaoLinhas();
  },

  render() {
    // ao ativar a aba, volta sempre para a lista
    this.aplicarPrefs();
    this.showList();
  },
  showList() {
    // Sair do leitor tem de sair TAMBÉM do modo foco: ele esconde abas e menu,
    // e voltar para a lista com a interface escondida deixava o app sem saída.
    this.sairFoco();
    this._esconderFab();
    $id('leis-list-view').style.display = 'block';
    $id('leis-reader-view').style.display = 'none';
    this.currentId = null;
    this.hlMode = null;
    ['lei-mark-btn', 'lei-unmark-btn', 'lei-foco-mark', 'lei-foco-erase'].forEach(bid => {
      const b = document.getElementById(bid); if (b) b.classList.remove('active');
    });
    this.renderCards();
  },
  _busca: '',
  renderCards() {
    const wrap = document.getElementById('leis-cards');
    if (!wrap) return;
    const todas = DB.getLeis().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    // A busca só aparece quando há leis o bastante para valer a pena procurar.
    const barra = document.querySelector('.leis-busca');
    if (barra) barra.hidden = todas.length < 4;
    const q = (this._busca || '').trim().toLowerCase();
    const leis = q
      ? todas.filter(l => [l.titulo, l.referencia, l.materia].some(v => String(v || '').toLowerCase().includes(q)))
      : todas;
    const contagem = document.getElementById('leis-list-contagem');
    if (contagem) {
      contagem.textContent = todas.length === 0 ? ''
        : q ? `${leis.length} de ${todas.length} lei${todas.length === 1 ? '' : 's'}`
            : `${todas.length} lei${todas.length === 1 ? '' : 's'} no seu vade mecum`;
    }
    if (todas.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">§</div>Nenhuma lei cadastrada ainda. Toque em <strong>＋ Nova lei</strong> para começar seu vade mecum.</div>`;
      return;
    }
    if (leis.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><div class="big">🔎</div>Nenhuma lei encontrada para <strong>${escapeHtml(this._busca)}</strong>.</div>`;
      return;
    }
    wrap.innerHTML = leis.map(l => {
      const st = LawEngine.stats(l);
      const bk = (l.bookmark != null) ? LawEngine.resolveBookmark(l) : null;
      return `
        <button type="button" class="lei-card" data-id="${l.id}" aria-label="Abrir ${escapeHtml(l.titulo)}">
          <span class="lei-card-main">
            <span class="lei-card-title">${escapeHtml(l.titulo)}</span>
            <span class="lei-card-meta">
              ${l.materia ? `<span class="lei-tag mat">${escapeHtml(l.materia)}</span>` : ''}
              ${l.referencia ? `<span class="lei-tag ref">${escapeHtml(l.referencia)}</span>` : ''}
            </span>
            <span class="lei-card-stats">
              <span>§ ${st.artigos} art.</span>
              <span>📝 ${Number(st.palavras).toLocaleString('pt-BR')} palavras</span>
              ${st.marcacoes ? `<span>🖍️ ${st.marcacoes} destaque${st.marcacoes === 1 ? '' : 's'}</span>` : ''}
              ${bk != null && bk > 0 ? `<span class="lei-card-bk">📌 parou na linha ${bk}</span>` : ''}
            </span>
          </span>
          <span class="lei-card-go" aria-hidden="true">→</span>
        </button>`;
    }).join('');
    wrap.querySelectorAll('.lei-card').forEach(card => {
      card.addEventListener('click', () => this.openReader(card.dataset.id));
    });
  },

  openForm() {
    $id('lei-titulo').value = '';
    $id('lei-ref').value = '';
    $id('lei-materia').value = '';
    $id('lei-texto').value = '';
    $id('lei-form-modal').style.display = 'flex';
    setTimeout(() => $id('lei-titulo').focus(), 60);
  },
  addFromForm() {
    const titulo = $id('lei-titulo').value.trim();
    const texto = $id('lei-texto').value;
    if (!titulo) { showToast('Dê um título à lei'); return; }
    if (!texto.trim()) { showToast('Cole o texto da lei'); return; }
    const lei = DB.addLei({
      titulo,
      referencia: $id('lei-ref').value,
      materia: $id('lei-materia').value,
      texto
    });
    $id('lei-form-modal').style.display = 'none';
    showToast('Lei cadastrada ✓');
    this.openReader(lei.id);
  },

  openReader(id) {
    const lei = DB.getLei(id);
    if (!lei) { this.showList(); return; }
    this.currentId = id;
    this.hlMode = null; // reseta a ferramenta ativa ao abrir
    ['lei-mark-btn', 'lei-unmark-btn', 'lei-foco-mark', 'lei-foco-erase'].forEach(bid => { const b = document.getElementById(bid); if (b) b.classList.remove('active'); });
    this._esconderFab();
    $id('leis-list-view').style.display = 'none';
    $id('leis-reader-view').style.display = 'block';
    $id('lei-reader-titulo').textContent = lei.titulo;
    const st = LawEngine.stats(lei);
    /* Antes os metadados iam todos numa unica caixa cinza, colada ao titulo e
       quebrando em qualquer largura. Agora cada informacao e um chip proprio:
       alinham entre si, quebram por inteiro e nunca cortam palavra no meio. */
    const chips = [];
    if (lei.materia) chips.push({ ic: '📚', txt: lei.materia });
    if (lei.referencia) chips.push({ ic: '🏷️', txt: lei.referencia });
    chips.push({ ic: '§', txt: `${st.artigos} artigo${st.artigos === 1 ? '' : 's'}` });
    chips.push({ ic: '📝', txt: `${Number(st.palavras).toLocaleString('pt-BR')} palavras` });
    $id('lei-reader-meta').innerHTML = chips
      .map(c => `<span class="lei-meta-chip"><span class="lmc-ic">${c.ic}</span>${escapeHtml(String(c.txt))}</span>`).join('');
    // sincroniza os toggles com as opções salvas da lei
    const opts = lei.opts || {};
    const autoOn = opts._auto !== false;
    const master = document.getElementById('lei-auto-master');
    if (master) master.checked = autoOn;
    document.querySelectorAll('#lei-hl-toggles input[data-cat]').forEach(cb => {
      cb.checked = opts[cb.dataset.cat] !== false;
      cb.disabled = !autoOn;
    });
    $id('lei-hl-toggles').classList.toggle('auto-off', !autoOn);
    this.fontStep = Math.max(-2, Math.min(5, parseInt(this._prefGet('font-step', null, '0'), 10) || 0));
    this._pintarBarraFerramentas();
    this.aplicarPrefs();
    this.renderBody();
    this.renderMarks();
  },
  renderBody() {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const body = document.getElementById('lei-reader-body');
    if (!body) return;
    body.innerHTML = LawEngine.toHtml(lei, DB.getLeiKeywords());
    this._pintarFonte();
    body.classList.toggle('tool-mark', this.hlMode === 'mark');
    body.classList.toggle('tool-erase', this.hlMode === 'erase');
    body.classList.toggle('show-lines', !!this.showLines);
    body.classList.toggle('sem-justificar', !this.prefOn('p-justificado'));
    // DELEGAÇÃO: um único listener no corpo. Antes registrava um por destaque e um por
    // número de linha — em leis grandes eram dezenas de milhares a cada re-render.
    if (!body._leiDelegado) {
      body._leiDelegado = true;
      body.addEventListener('click', (e) => {
        const num = e.target.closest ? e.target.closest('.law-lnum') : null;
        if (num) { e.stopPropagation(); this.onLineNumClick(parseInt(num.dataset.line, 10)); return; }
        const mk = e.target.closest ? e.target.closest('mark[class*="lawmark-"]') : null;
        if (mk && this.hlMode === 'erase') {
          e.stopPropagation();
          const bloco = mk.closest('.law-block');
          this.eraseHighlight(mk.textContent || '', bloco ? parseInt(bloco.dataset.line, 10) : null);
        }
      });
    }
    this.atualizarFoco();
    this._pintarBotaoMarcador(lei.bookmark != null);
  },
  /* Re-renderizar a lei inteira custa caro (é o innerHTML de centenas de
     blocos). Quando o usuário desliga três categorias em sequência, isso
     acontecia três vezes seguidas e a tela engasgava. Aqui as chamadas
     seguidas colapsam num único render no próximo quadro. */
  renderBodySoon() {
    if (this._rafRender) return;
    this._rafRender = requestAnimationFrame(() => { this._rafRender = 0; this.renderBody(); });
  },
  /* Estado recolhido/aberto da barra de ferramentas do leitor.
     A escolha passa pelo mesmo caminho das outras preferências do leitor
     (fonte, numeração): por PERFIL e sincronizada. Antes era uma chave solta
     gravada direto no localStorage — não subia para a nuvem e valia para todos
     os perfis do aparelho. Como o perfil só é conhecido depois do portão de
     acesso, o estado é repintado também ao abrir uma lei. */
  ferramentasAbertas() { return this._prefGet('tools-open', 'diario-estudos:leis-tools-open', '1') !== '0'; },
  _pintarBarraFerramentas() {
    const btn = document.getElementById('lei-tools-toggle');
    const box = document.getElementById('leis-sticky-toolbar');
    if (!btn || !box) return;
    const aberto = this.ferramentasAbertas();
    box.classList.toggle('tools-collapsed', !aberto);
    btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
    const t = btn.querySelector('.ltt-txt');
    if (t) t.textContent = aberto ? 'Ajustes da leitura' : 'Mostrar ajustes da leitura';
  },
  _pintarBotaoLinhas() {
    const on = !!this.showLines;
    ['lei-lines-btn', 'lei-foco-lines'].forEach(id => {
      const b = document.getElementById(id);
      if (b) { b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    });
    const cx = document.querySelector('#lei-prefs-modal input[data-pref="p-linhas"]');
    if (cx) cx.checked = on;
  },
  // O A−/A+ mexia num tamanho invisível: dois toques e não dava para saber
  // onde se estava, nem voltar ao original. Agora o valor aparece entre eles.
  _pintarFonte() {
    const body = document.getElementById('lei-reader-body');
    const pct = 100 + this.fontStep * 8;
    if (body) body.style.fontSize = pct + '%';
    const v = document.getElementById('lei-font-val');
    if (v) v.textContent = pct + '%';
  },
  // Estado do botão "📌 Onde parei": ele serve para MARCAR quando não há
  // marcador e para IR até ele quando há. O rótulo tem de dizer qual dos dois.
  _pintarBotaoMarcador(tem) {
    const gb = document.getElementById('lei-goto-mark-btn');
    if (!gb) return;
    gb.classList.toggle('has-mark', !!tem);
    gb.style.opacity = '1';
    gb.title = tem
      ? 'Ir para a linha onde você parou (clique no número da linha para trocar ou tirar)'
      : 'Marcar onde você parou: fixa a linha que está no topo da tela';
  },
  // Move o pin "onde parei" no HTML já montado. Antes isto redesenhava a lei
  // inteira só para deslocar um emoji — em leis grandes, meio segundo travado.
  _pintarMarcador(ln) {
    const body = document.getElementById('lei-reader-body');
    if (body) {
      body.querySelectorAll('.law-bookmarked').forEach(b => {
        b.classList.remove('law-bookmarked', 'law-bk-flash');
        const p = b.querySelector('.law-pin'); if (p) p.remove();
      });
      if (ln != null) {
        const alvo = body.querySelector('.law-block[data-line="' + ln + '"]');
        if (alvo) {
          alvo.classList.add('law-bookmarked');
          if (!alvo.querySelector('.law-pin')) {
            const pin = document.createElement('span');
            pin.className = 'law-pin'; pin.title = 'Você parou aqui'; pin.textContent = '📌';
            alvo.appendChild(pin);
          }
        }
      }
    }
    this._pintarBotaoMarcador(ln != null);
    this.atualizarFoco();
  },
  // clicar no NÚMERO da linha → fixa/retira o pin "onde parei"
  onLineNumClick(ln, semRolar) {
    if (ln == null || !isFinite(ln)) return;
    const cur = DB.getLei(this.currentId);
    if (!cur) return;
    const atual = LawEngine.resolveBookmark(cur);
    const novo = (atual === ln) ? null : ln; // clicar de novo remove
    // guarda também um trecho da linha: se o texto for editado, o pin se reancora
    let ancora = null;
    if (novo != null) ancora = (LawEngine.lines(cur.texto)[novo - 1] || '').trim().slice(0, 40) || null;
    DB.updateLei(this.currentId, { bookmark: novo, bookmarkTxt: ancora });
    this._pintarMarcador(novo);
    if (novo != null) { if (!semRolar) this.gotoBookmark(); showToast('📌 Marcado: você parou na linha ' + novo); }
    else showToast('Marcador removido');
  },
  toggleLines() {
    this.showLines = !this.showLines;
    // Mesma chave da caixa "Numeração das linhas" em ⚙️ Exibição: o botão e a
    // preferência são o MESMO estado, não dois que se desencontram.
    this.prefSetOn('p-linhas', this.showLines);
    this._pintarBotaoLinhas();
    // Só a CLASSE muda — o HTML da lei é o mesmo com ou sem numeração. Antes
    // este botão redesenhava a lei inteira, e num texto grande a tela parecia
    // ter travado no clique.
    const body = document.getElementById('lei-reader-body');
    if (body) body.classList.toggle('show-lines', !!this.showLines);
  },
  // ── Modo foco: ler a lei em tela cheia ──
  entrarFoco() {
    if (!this.currentId) { showToast('Abra uma lei primeiro'); return; }
    document.body.classList.add('leis-foco');
    this.atualizarFoco();
    // reflete o estado atual da ferramenta (marca-texto/borracha) nos botões da barra de foco
    const fMark = document.getElementById('lei-foco-mark');
    const fErase = document.getElementById('lei-foco-erase');
    if (fMark) fMark.classList.toggle('active', this.hlMode === 'mark');
    if (fErase) fErase.classList.toggle('active', this.hlMode === 'erase');
    this._pintarBotaoLinhas();
    showToast('Modo foco · toque em ✕ Sair (ou Esc) para voltar');
  },
  sairFoco() {
    if (!document.body.classList.contains('leis-foco')) return;
    document.body.classList.remove('leis-foco');
    this._esconderFab();
  },
  emFoco() { return document.body.classList.contains('leis-foco'); },
  atualizarFoco() {
    if (!this.emFoco()) return;
    const lei = DB.getLei(this.currentId);
    const el = document.getElementById('lei-foco-info');
    if (!el || !lei) return;
    const bk = LawEngine.resolveBookmark(lei);
    const st = LawEngine.stats(lei);
    el.textContent = (lei.titulo || 'Lei') + ' · ' + st.artigos + ' art.' + (bk > 0 ? ' · 📌 linha ' + bk : '');
  },
  // marca a linha que está no topo da tela — no modo foco a numeração fica oculta
  marcarLinhaVisivel() {
    const body = document.getElementById('lei-reader-body');
    if (!body || !this.currentId) { showToast('Abra uma lei primeiro'); return; }
    const blocos = body.querySelectorAll('.law-block');
    if (!blocos.length) return;
    // O "topo útil" depende da barra que estiver por cima agora: a de foco
    // (fixa no alto) ou a de ferramentas (sticky). Antes eram 70px fixos, o que
    // no leitor normal marcava uma linha já escondida sob a barra.
    let topo = 70;
    const barra = document.getElementById(this.emFoco() ? 'lei-foco-bar' : 'leis-sticky-toolbar');
    if (barra && barra.offsetParent !== null) {
      const r = barra.getBoundingClientRect();
      if (r.height) topo = Math.max(topo, r.bottom + 6);
    }
    let alvo = null;
    for (const b of blocos) { if (b.getBoundingClientRect().bottom > topo) { alvo = b; break; } }
    if (!alvo) alvo = blocos[0];
    const ln = parseInt(alvo.dataset.line, 10);
    const cur = DB.getLei(this.currentId);
    // Sem esta guarda, marcar duas vezes na mesma linha APAGAVA o marcador —
    // o botão "Marcar aqui" desmarcaria em vez de confirmar.
    if (cur && LawEngine.resolveBookmark(cur) === ln) { showToast('📌 Já estava marcado na linha ' + ln); return; }
    this.onLineNumClick(ln, true);   // sem rolar: o leitor já está aqui
  },
  /* "📌 Onde parei" faz as DUAS pontas do fluxo. Antes ele só sabia ir até um
     marcador — e o único jeito de criar um era clicar no número da linha, que
     estava invisível por um recorte do CSS. Resultado: o botão nunca funcionava.
     Agora, sem marcador, ele marca onde a leitura está; com marcador, ele leva
     até lá. Trocar ou tirar continua sendo o clique no número da linha. */
  gotoBookmark() {
    const lei = DB.getLei(this.currentId);
    if (!lei) { showToast('Abra uma lei primeiro'); return; }
    if (lei.bookmark == null) { this.marcarLinhaVisivel(); return; }
    const body = document.getElementById('lei-reader-body');
    const ln = LawEngine.resolveBookmark(lei);
    const alvo = (body && ln > 0) ? body.querySelector('.law-block[data-line="' + ln + '"]') : null;
    if (!alvo) {
      // o texto encolheu depois da edição e a linha não existe mais
      DB.updateLei(this.currentId, { bookmark: null, bookmarkTxt: null });
      this._pintarMarcador(null);
      showToast('A linha marcada não existe mais neste texto — o marcador foi retirado');
      return;
    }
    alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    alvo.classList.add('law-bk-flash');
    setTimeout(() => alvo.classList.remove('law-bk-flash'), 1200);
  },
  /* ── APLICAR A SELEÇÃO NO TOQUE ──────────────────────────────────────────
     A marcação dependia só do evento "mouseup" no corpo da lei. Num celular
     não existe mouseup ao fim de uma seleção por toque longo (o dedo sai sobre
     as alças de seleção), então o marca-texto e a borracha simplesmente não
     respondiam. Com a ferramenta ativa e um trecho selecionado, aparece uma
     faixa: tocar nela aplica. No mouse nada muda — lá o mouseup segue
     aplicando na hora e a faixa nem chega a aparecer. */
  _selecaoValida() {
    const body = document.getElementById('lei-reader-body');
    const sel = window.getSelection ? window.getSelection() : null;
    if (!body || !sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
    const no = sel.anchorNode;
    const el = no && (no.nodeType === 3 ? no.parentNode : no);
    if (!el || !body.contains(el)) return '';
    const t = String(sel).trim();
    return (t.length >= 2 && t.length <= 200) ? t : '';
  },
  _fab() {
    let el = document.getElementById('lei-sel-fab');
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.id = 'lei-sel-fab';
      el.className = 'lei-sel-fab';
      el.hidden = true;
      // pointerdown: no toque, o clique chegaria DEPOIS de o navegador já ter
      // descartado a seleção ao tirar o foco do texto.
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onBodyMouseUp(); });
      document.body.appendChild(el);
    }
    return el;
  },
  _esconderFab() { const el = document.getElementById('lei-sel-fab'); if (el) el.hidden = true; },
  _atualizarFab() {
    if (!this.currentId || !this.hlMode) { this._esconderFab(); return; }
    const leitorAberto = $id('leis-reader-view').style.display !== 'none';
    const txt = leitorAberto ? this._selecaoValida() : '';
    if (!txt) { this._esconderFab(); return; }
    const el = this._fab();
    el.textContent = this.hlMode === 'mark' ? '🖍️ Destacar seleção' : '🧽 Apagar destaque';
    el.classList.toggle('is-erase', this.hlMode === 'erase');
    el.hidden = false;
  },
  // captura a seleção atual DENTRO do corpo do leitor (chamado no mouseup/keyup)
  captureSelection() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return;
    const body = document.getElementById('lei-reader-body');
    const anchor = sel.anchorNode;
    // só guarda se a seleção está dentro do texto da lei
    if (anchor && body && body.contains(anchor.nodeType === 3 ? anchor.parentNode : anchor)) {
      const t = String(sel).trim();
      if (t.length >= 2) this._selText = t;
    }
  },
  renderMarks() {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const marks = lei.marcacoes || [];
    const suppressed = lei.suppressed || [];
    const parts = [];
    if (marks.length) parts.push(`${marks.length} destaque(s) seu(s)`);
    if (suppressed.length) parts.push(`${suppressed.length} automático(s) apagado(s)`);
    $id('lei-mark-count').textContent = parts.join(' · ');
    const panel = document.getElementById('lei-marks-panel');
    const list = document.getElementById('lei-marks-list');
    if (!panel || !list) return;
    if (marks.length === 0 && suppressed.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    let html = '';
    if (marks.length) {
      html += `<p class="section-label" style="margin:0 0 8px;">Seus destaques</p>` +
        marks.map((m, i) => {
          const mt = (typeof m === 'string') ? m : (m.t || '');
          const ln = (typeof m === 'string') ? null : m.l;
          return `
          <div class="lei-mark-row" data-mark="${i}">
            <span class="lawmark-manual lei-mark-text">${escapeHtml(mt)}</span>
            ${ln != null ? `<span class="hint" style="margin:0 8px 0 auto; white-space:nowrap;">linha ${ln}</span>` : ''}
            <button type="button" class="icon-btn danger lei-mark-del" title="Remover destaque" aria-label="Remover destaque">×</button>
          </div>`;
        }).join('');
    }
    if (suppressed.length) {
      html += `<div style="display:flex; align-items:center; justify-content:space-between; margin:14px 0 8px;">
          <span class="section-label" style="margin:0;">Automáticos que você apagou</span>
          <button type="button" class="btn-secondary" id="lei-restore-auto" style="padding:4px 10px; font-size:12px;">↺ Restaurar todos</button>
        </div>` +
        suppressed.map((m, i) => {
          const txt = (typeof m === 'string') ? m : String(m.t || '');
          const ln = (typeof m === 'string') ? null : m.l;
          return `
          <div class="lei-mark-row" data-supp="${i}">
            <span class="lei-mark-text" style="text-decoration:line-through; opacity:0.7;">${escapeHtml(txt)}</span>
            <span class="hint" style="margin:0 8px 0 auto; white-space:nowrap;">${ln != null ? 'linha ' + ln : 'lei toda'}</span>
            <button type="button" class="icon-btn supp-restore" title="Voltar a destacar" aria-label="Voltar a destacar">↺</button>
          </div>`;
        }).join('');
    }
    list.innerHTML = html;
    list.querySelectorAll('[data-mark]').forEach(row => {
      row.querySelector('.lei-mark-del').addEventListener('click', () => {
        const idx = parseInt(row.dataset.mark, 10);
        const l = DB.getLei(this.currentId);
        if (!l || !Array.isArray(l.marcacoes)) return;
        l.marcacoes.splice(idx, 1);
        DB.updateLei(this.currentId, { marcacoes: l.marcacoes });
        this.renderBody(); this.renderMarks();
      });
    });
    list.querySelectorAll('[data-supp]').forEach(row => {
      row.querySelector('.supp-restore').addEventListener('click', () => {
        const idx = parseInt(row.dataset.supp, 10);
        const l = DB.getLei(this.currentId);
        if (!l) return;
        const sup = (l.suppressed || []).slice(); sup.splice(idx, 1);
        DB.updateLei(this.currentId, { suppressed: sup });
        this.renderBody(); this.renderMarks();
      });
    });
    const restoreBtn = document.getElementById('lei-restore-auto');
    if (restoreBtn) restoreBtn.addEventListener('click', () => this.restoreAuto());
  },
  // Ferramenta ativa: 'mark' (marca-texto) | 'erase' (borracha) | null
  hlMode: null,
  setTool(mode) {
    this.hlMode = (this.hlMode === mode) ? null : mode;
    const markBtn = document.getElementById('lei-mark-btn');
    const eraseBtn = document.getElementById('lei-unmark-btn');
    if (markBtn) markBtn.classList.toggle('active', this.hlMode === 'mark');
    if (eraseBtn) eraseBtn.classList.toggle('active', this.hlMode === 'erase');
    // espelha o estado nos botões da barra do MODO FOCO
    const fMark = document.getElementById('lei-foco-mark');
    const fErase = document.getElementById('lei-foco-erase');
    if (fMark) fMark.classList.toggle('active', this.hlMode === 'mark');
    if (fErase) fErase.classList.toggle('active', this.hlMode === 'erase');
    const body = document.getElementById('lei-reader-body');
    if (body) {
      body.classList.toggle('tool-mark', this.hlMode === 'mark');
      body.classList.toggle('tool-erase', this.hlMode === 'erase');
    }
    this._atualizarFab();
    if (this.hlMode === 'mark') showToast('Marca-texto ativo — selecione trechos para destacar');
    else if (this.hlMode === 'erase') showToast('Borracha ativa — selecione um destaque para apagar');
    else showToast('Ferramenta desligada');
  },
  // Chamado no mouseup do corpo: aplica a ferramenta ativa à seleção atual
  onBodyMouseUp() {
    if (!this.hlMode) return;
    const sel = window.getSelection ? window.getSelection() : null;
    const raw = sel ? String(sel) : '';
    const txt = raw.trim();
    if (!txt || txt.length < 2) return;
    if (txt.length > 200) { showToast('Seleção muito longa'); return; }
    // Descobre a LINHA e o DESLOCAMENTO exato da seleção dentro do texto puro da
    // linha. Com isso a marcação manual acende só ESTA ocorrência — não todas as
    // palavras iguais da lei (o "marcar todas" segue valendo só para o automático).
    let linha = null, offset = null;
    try {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      const el = node && (node.nodeType === 3 ? node.parentNode : node);
      const bloco = el && el.closest ? el.closest('.law-block') : null;
      const content = el && el.closest ? el.closest('.law-content') : null;
      if (bloco) linha = parseInt(bloco.dataset.line, 10);
      if (content) {
        const pre = range.cloneRange();
        pre.selectNodeContents(content);
        pre.setEnd(range.startContainer, range.startOffset);
        const lead = raw.length - raw.replace(/^\s+/, '').length; // espaços aparados à esquerda
        offset = pre.toString().length + lead;
      }
    } catch (_) { _quiet(_); }
    if (this.hlMode === 'mark') this.applyMark(txt, linha, offset);
    else if (this.hlMode === 'erase') this.applyErase(txt, linha);
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
    this._esconderFab();
  },
  applyMark(txt, linha, offset) {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const marks = (lei.marcacoes || []).slice();
    const norm = (m) => (typeof m === 'string' ? m : (m && m.t) || '').toLowerCase();
    if (linha != null && typeof offset === 'number' && offset >= 0) {
      // Marcação ANCORADA: aquela ocorrência específica (linha + posição).
      const existe = marks.some(m => m && typeof m === 'object' && m.l === linha && m.s === offset && norm(m) === txt.toLowerCase());
      if (existe) return;
      marks.push({ t: txt, l: linha, s: offset });
    } else {
      // Fallback sem âncora: mantém o comportamento antigo por texto.
      if (marks.some(m => norm(m) === txt.toLowerCase())) return;
      marks.push(txt);
    }
    DB.updateLei(this.currentId, { marcacoes: marks });
    this.renderBody(); this.renderMarks();
  },
  // Borracha: remove destaque MANUAL e suprime os automáticos daquele trecho — só na LINHA
  // em que você apagou (quando conhecida), não na lei inteira.
  applyErase(txt, linha) {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const key = txt.toLowerCase();
    const marks = (lei.marcacoes || []).filter(m => {
      if (typeof m === 'string') return m.toLowerCase() !== key;        // legado: remove os iguais
      if ((m.t || '').toLowerCase() !== key) return true;               // texto diferente: mantém
      if (linha != null && m.l != null && m.l !== linha) return true;   // outra linha: mantém
      return false;                                                     // mesma ocorrência: remove
    });
    const suppressed = (lei.suppressed || []).slice();
    const jaTem = (t) => suppressed.some(s => (typeof s === 'string' ? s.toLowerCase() === t.toLowerCase()
      : String(s.t).toLowerCase() === t.toLowerCase() && s.l === linha));
    this._collectAutoInText(txt).forEach(w => {
      if (!jaTem(w)) suppressed.push(linha != null ? { t: w, l: linha } : w);
    });
    DB.updateLei(this.currentId, { marcacoes: marks, suppressed });
    this.renderBody(); this.renderMarks();
  },
  // encontra os termos que as categorias automáticas destacariam dentro de um texto
  _collectAutoInText(txt) {
    const found = [];
    Object.keys(LawEngine.categories).forEach(k => {
      const cat = LawEngine.categories[k];
      const re = new RegExp(cat.re.source, cat.re.flags);
      let m;
      while ((m = re.exec(txt)) !== null) { if (m.index === re.lastIndex) re.lastIndex++; found.push(m[0]); }
    });
    return found;
  },
  // remove uma marcação específica (manual) OU suprime um automático, pelo texto exato
  eraseHighlight(text, linha) {
    const lei = DB.getLei(this.currentId);
    const key = (text || '').trim().toLowerCase();
    if (!lei || !key) return;
    const marks = (lei.marcacoes || []).filter(m => {
      if (typeof m === 'string') return m.toLowerCase() !== key;
      if ((m.t || '').toLowerCase() !== key) return true;
      if (linha != null && m.l != null && m.l !== linha) return true;
      return false;
    });
    const suppressed = (lei.suppressed || []).slice();
    const jaTem = suppressed.some(s => (typeof s === 'string' ? s.toLowerCase() === key
      : String(s.t).toLowerCase() === key && s.l === linha));
    if (!jaTem) suppressed.push(linha != null ? { t: text.trim(), l: linha } : text.trim());
    DB.updateLei(this.currentId, { marcacoes: marks, suppressed });
    this.renderBody(); this.renderMarks();
  },
  // restaura todos os destaques automáticos suprimidos
  restoreAuto() {
    if (!this.currentId) return;
    DB.updateLei(this.currentId, { suppressed: [] });
    this.renderBody(); this.renderMarks();
    showToast('Destaques automáticos restaurados');
  },
  // ── Painel "⚙️ Exibição": liga e desliga cada faixa da tela ──
  openPrefs() {
    const m = document.getElementById('lei-prefs-modal');
    if (m) m.style.display = 'flex';
    this.renderPrefs();
  },
  closePrefs() { const m = document.getElementById('lei-prefs-modal'); if (m) m.style.display = 'none'; },
  /* Os controles moram num painel só, aberto de DOIS botões da própria tela de
     Leis: o ⚙️ Ajustes da lista e o ⚙️ Exibição do leitor. A marcação usa
     data-attributes (repetíveis) em vez de id (único) e o listener é um só,
     delegado no documento — foi o que permitiu tirar a cópia que vivia em
     Configurações sem reescrever nada daqui. */
  renderPrefs() {
    const linha = (d) => `
      <label class="lei-pref-item">
        <input type="checkbox" data-pref="${d.k}" ${this.prefOn(d.k) ? 'checked' : ''}>
        <span class="lei-pref-txt"><span class="lei-pref-lbl">${d.lbl}</span><span class="lei-pref-sub">${d.sub}</span></span>
      </label>`;
    document.querySelectorAll('[data-lei-prefs]').forEach(host => {
      host.innerHTML = this.PREFS.filter(d => d.grupo === host.dataset.leiPrefs).map(linha).join('');
    });
    const c = this.conforto();
    document.querySelectorAll('[data-lei-conforto] button[data-conforto]').forEach(b => {
      const on = b.dataset.conforto === c;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (document._leiPrefsDelegado) return;
    document._leiPrefsDelegado = true;
    document.addEventListener('change', (e) => {
      const cx = e.target.closest ? e.target.closest('[data-lei-prefs] input[data-pref]') : null;
      if (!cx) return;
      this.prefSetOn(cx.dataset.pref, cx.checked);
      this.aplicarPrefs();
      this.renderPrefs();                                    // espelha no outro lugar
      if (cx.dataset.pref === 'p-cores' && this.currentId) this.renderBodySoon();
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-lei-conforto] button[data-conforto]') : null;
      if (!b) return;
      this._prefSet('p-conforto', b.dataset.conforto);
      this.aplicarPrefs();
      this.renderPrefs();
    });
  },
  async resetPrefs() {
    if (!await UI.confirm('Voltar todas as opções de exibição da tela de Leis ao padrão?')) return;
    this.PREFS.forEach(d => this._prefSet(d.k, d.padrao));
    this._prefSet('p-conforto', 'normal');
    this.aplicarPrefs();
    this.renderPrefs();
    if (this.currentId) this.renderBodySoon();
    showToast('Exibição restaurada ao padrão');
  },
  // ── Gerenciador de palavras destacadas por padrão (todas as leis) ──
  _kwCatMeta: {
    ressalvas:   { cls: 'lawmark-ressalvas',   label: '⚖️ Ressalvas / Exceções' },
    restricoes:  { cls: 'lawmark-restricoes',  label: '🚫 Restrições / Exclusividade' },
    competencias:{ cls: 'lawmark-competencias',label: '🏛️ Poder / Dever / Competência' },
    prazos:      { cls: 'lawmark-prazos',      label: '⏱️ Prazos / Tempo' },
    efeitos:     { cls: 'lawmark-efeitos',     label: '⚠️ Validade / Sanções' },
    relacoes:    { cls: 'lawmark-relacoes',    label: '🔗 Causalidade / Subordinação' }
  },
  openKeywords() {
    const m = document.getElementById('lei-kw-modal');
    if (m) m.style.display = 'flex';
    this.renderKeywords();
    setTimeout(() => { const i = document.getElementById('lei-kw-input'); if (i) i.focus(); }, 40);
  },
  closeKeywords() { const m = document.getElementById('lei-kw-modal'); if (m) m.style.display = 'none'; },
  addKeywordFromForm() {
    const inp = document.getElementById('lei-kw-input');
    const sel = document.getElementById('lei-kw-cat');
    const termo = (inp.value || '').trim();
    if (termo.length < 2) { showToast('Digite ao menos 2 letras'); return; }
    if (!DB.addLeiKeyword(termo, sel.value)) { showToast('Essa palavra já está na lista'); inp.value = ''; inp.focus(); return; }
    inp.value = '';
    this.renderKeywords();
    if (this.currentId) this.renderBodySoon();   // reaplica imediatamente na lei aberta
    inp.focus();
  },
  renderKeywords() {
    const host = document.getElementById('lei-kw-groups');
    if (!host) return;
    const kws = DB.getLeiKeywords();
    const order = ['ressalvas','restricoes','competencias','prazos','efeitos','relacoes'];
    let html = '';
    order.forEach(cat => {
      const meta = this._kwCatMeta[cat];
      const itens = kws.filter(k => (k.cat || 'competencias') === cat);
      html += `<div class="lei-kw-group">
        <div class="lei-kw-group-head">
          <span class="lei-kw-group-title">${meta.label}</span>
          <span class="lei-kw-group-count">${itens.length}</span>
        </div>
        <div class="lei-kw-chips">
          ${itens.length ? itens.map(k => `
            <span class="lei-kw-chip" data-kw="${escapeHtml(k.t)}">
              <mark class="${meta.cls}">${escapeHtml(k.t)}</mark>
              <button type="button" class="lei-kw-del" title="Remover" aria-label="Remover">×</button>
            </span>`).join('') : '<span class="lei-kw-empty">Nenhuma palavra nesta categoria.</span>'}
        </div>
      </div>`;
    });
    host.innerHTML = html;
    host.querySelectorAll('.lei-kw-chip').forEach(el => {
      el.querySelector('.lei-kw-del').addEventListener('click', () => {
        DB.removeLeiKeyword(el.dataset.kw);
        this.renderKeywords();
        if (this.currentId) this.renderBodySoon();
      });
    });
  },
  async restoreKeywordDefaults() {
    if (!await UI.confirm('Restaurar a lista de palavras que vem por padrão? Suas inclusões/exclusões nesta lista serão substituídas.')) return;
    DB.restoreLeiKeywordDefaults();
    this.renderKeywords();
    if (this.currentId) this.renderBody();
    showToast('Palavras padrão restauradas');
  },
  _clearSel() {
    this._selText = '';
    const s = window.getSelection ? window.getSelection() : null;
    if (s && s.removeAllRanges) s.removeAllRanges();
  },
  toggleCategory(cat, on) {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const opts = Object.assign({}, lei.opts || {});
    opts[cat] = on;
    DB.updateLei(this.currentId, { opts });
    this.renderBodySoon();
  },
  // Interruptor mestre: liga/desliga TODO o destaque automático desta lei
  setAutoMaster(on) {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    const opts = Object.assign({}, lei.opts || {});
    opts._auto = on;
    DB.updateLei(this.currentId, { opts });
    // desabilita visualmente as categorias individuais quando o mestre está off
    document.querySelectorAll('#lei-hl-toggles input[data-cat]').forEach(cb => { cb.disabled = !on; });
    $id('lei-hl-toggles').classList.toggle('auto-off', !on);
    this.renderBodySoon();
  },
  changeFont(delta) {
    this.fontStep = Math.max(-2, Math.min(5, this.fontStep + delta));
    this._prefSet('font-step', this.fontStep);
    this._pintarFonte();
  },
  editCurrent() {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    UI.prompt([
      { key: 'titulo', label: 'Título da lei', type: 'text', value: lei.titulo },
      { key: 'ref', label: 'Referência', type: 'text', value: lei.referencia || '', opt: true },
      { key: 'mat', label: 'Matéria', type: 'text', value: lei.materia || '', opt: true },
      { key: 'texto', label: 'Texto da lei', type: 'textarea', value: lei.texto, rows: 8 }
    ], { title: '✎ Editar lei', okText: 'Salvar' }).then(v => {
      if (!v) return;
      DB.updateLei(this.currentId, {
        titulo: (v.titulo || '').trim() || lei.titulo,
        referencia: (v.ref || '').trim(),
        materia: (v.mat || '').trim(),
        texto: v.texto
      });
      this.openReader(this.currentId);
      showToast('Lei atualizada ✓');
    });
  },
  async deleteCurrent() {
    const lei = DB.getLei(this.currentId);
    if (!lei) return;
    if (!await UI.confirm(`Excluir a lei "${lei.titulo}"? Esta ação não pode ser desfeita.`)) return;
    DB.deleteLei(this.currentId);
    showToast('Lei excluída');
    this.showList();
  }
};
window.LeisScreen = LeisScreen;

// Listeners da tela de Leis
(function () {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  // modal de nova lei
  on('lei-open-form-btn', 'click', () => LeisScreen.openForm());
  on('lei-form-close', 'click', () => $id('lei-form-modal').style.display = 'none');
  on('lei-form-cancel', 'click', () => $id('lei-form-modal').style.display = 'none');
  on('lei-add-btn', 'click', () => LeisScreen.addFromForm());
  const fm = document.getElementById('lei-form-modal');
  if (fm) fm.addEventListener('click', (e) => { if (e.target === fm) fm.style.display = 'none'; });
  // leitor
  on('lei-back-btn', 'click', () => LeisScreen.showList());
  on('lei-edit-btn', 'click', () => LeisScreen.editCurrent());
  on('lei-del-btn', 'click', () => LeisScreen.deleteCurrent());
  // ferramentas de marcação: marca-texto e borracha (modos)
  on('lei-mark-btn', 'click', () => LeisScreen.setTool('mark'));
  on('lei-unmark-btn', 'click', () => LeisScreen.setTool('erase'));
  // aplica a ferramenta ativa ao soltar a seleção
  const body = document.getElementById('lei-reader-body');
  if (body) body.addEventListener('mouseup', () => setTimeout(() => LeisScreen.onBodyMouseUp(), 0));
  /* No toque não há mouseup ao fim da seleção: quem avisa é o selectionchange.
     Ele dispara muito (a cada arrasto da alça), então a atualização da faixa
     "Destacar seleção" espera o gesto assentar. */
  let _selTimer = 0;
  document.addEventListener('selectionchange', () => {
    if (!LeisScreen.currentId || !LeisScreen.hlMode) return;
    clearTimeout(_selTimer);
    _selTimer = setTimeout(() => LeisScreen._atualizarFab(), 260);
  });
  on('lei-font-inc', 'click', () => LeisScreen.changeFont(1));
  on('lei-font-dec', 'click', () => LeisScreen.changeFont(-1));
  on('lei-prefs-btn', 'click', () => LeisScreen.openPrefs());
  /* O mesmo painel abre da LISTA de leis, pelo "⚙️ Ajustes" ao lado de "＋ Nova
     lei". Era o único ajuste do app que só existia em Configurações, a duas
     telas de distância de onde ele se vê — e o pedido foi trazê-lo para cá. */
  on('lei-ajustes-btn', 'click', () => LeisScreen.openPrefs());
  on('lei-prefs-close', 'click', () => LeisScreen.closePrefs());
  on('lei-prefs-done', 'click', () => LeisScreen.closePrefs());
  on('lei-prefs-reset', 'click', () => LeisScreen.resetPrefs());
  // a dica do marca-texto se dispensa no próprio lugar, sem procurar ajuste
  on('lei-mark-hint-x', 'click', () => {
    LeisScreen.prefSetOn('p-dica', false);
    LeisScreen.aplicarPrefs();
    showToast('Dica ocultada — volte em ⚙️ Exibição se quiser vê-la de novo');
  });
  // busca na lista de leis
  on('lei-busca', 'input', (e) => {
    LeisScreen._busca = e.target.value;
    const x = document.getElementById('lei-busca-limpar');
    if (x) x.hidden = !e.target.value;
    LeisScreen.renderCards();
  });
  on('lei-busca-limpar', 'click', () => {
    const i = document.getElementById('lei-busca');
    if (i) { i.value = ''; i.focus(); }
    LeisScreen._busca = '';
    const x = document.getElementById('lei-busca-limpar');
    if (x) x.hidden = true;
    LeisScreen.renderCards();
  });
  on('lei-kw-btn', 'click', () => LeisScreen.openKeywords());
  on('lei-kw-close', 'click', () => LeisScreen.closeKeywords());
  on('lei-kw-done', 'click', () => LeisScreen.closeKeywords());
  on('lei-kw-add-btn', 'click', () => LeisScreen.addKeywordFromForm());
  on('lei-kw-restore', 'click', () => LeisScreen.restoreKeywordDefaults());
  on('lei-kw-input', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); LeisScreen.addKeywordFromForm(); } });
  /* fundo desfocado nao fecha (ver UI._open): so o X / Cancelar / Esc fecham */

  /* Barra de ferramentas do leitor: recolher/expandir, com a escolha lembrada.
     Comeca ABERTA na primeira visita (para as ferramentas serem descobertas) e
     depois respeita o que o usuario deixou. */
  const btnTools = document.getElementById('lei-tools-toggle');
  if (btnTools) btnTools.addEventListener('click', () => {
    LeisScreen._prefSet('tools-open', LeisScreen.ferramentasAbertas() ? '0' : '1');
    LeisScreen._pintarBarraFerramentas();
  });
  LeisScreen._pintarBarraFerramentas();
  on('lei-lines-btn', 'click', () => LeisScreen.toggleLines());
  on('lei-goto-mark-btn', 'click', () => LeisScreen.gotoBookmark());
  on('lei-foco-btn', 'click', () => LeisScreen.entrarFoco());
  on('lei-foco-mark', 'click', () => LeisScreen.setTool('mark'));
  on('lei-foco-erase', 'click', () => LeisScreen.setTool('erase'));
  on('lei-foco-lines', 'click', () => LeisScreen.toggleLines());
  // Esc sai do modo foco da leitura. Não conflita com o dos cards: cada um só
  // reage quando a sua própria classe está no body.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !LeisScreen.emFoco()) return;
    const alvo = e.target;
    if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
    if (document.querySelector('.cards-modal[style*="flex"], #ui-modal[style*="flex"]')) return; // modal aberto tem prioridade
    e.preventDefault(); LeisScreen.sairFoco();
  });
  on('lei-foco-sair', 'click', () => LeisScreen.sairFoco());
  on('lei-foco-marcar', 'click', () => LeisScreen.marcarLinhaVisivel());
  on('lei-auto-master', 'change', (e) => LeisScreen.setAutoMaster(e.target.checked));
  document.querySelectorAll('#lei-hl-toggles input[data-cat]').forEach(cb => {
    cb.addEventListener('change', () => LeisScreen.toggleCategory(cb.dataset.cat, cb.checked));
  });
})();
window.addEventListener('screen:activated', (e) => {
  const tela = e && e.detail && e.detail.screen;
  // o cartão de exibição das Leis vive em Configurações: pinta ao abrir a tela
  if (tela === 'config') LeisScreen.renderPrefs();
  if (tela === 'leis') { LeisScreen.render(); return; }
  /* Trocar de aba com o modo foco ligado deixava body.leis-foco no ar: abas,
     menu e as outras telas continuavam escondidos por CSS e o app parecia
     travado, sem nenhum caminho de volta no celular. */
  LeisScreen.sairFoco();
  LeisScreen._esconderFab();
});
