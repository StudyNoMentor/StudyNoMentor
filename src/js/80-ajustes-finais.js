/* ═══════════════ ROBUSTEZ — Rede de segurança global de erros ═══════════════
   Num app de escopo global único, um erro não tratado num listener pode deixar
   uma ação pela metade sem nenhum aviso. Este boundary registra o erro (para
   diagnóstico) e, se algo falhar de forma visível ao usuário, oferece uma saída
   clara em vez de um estado travado. Não muda o fluxo normal — só age em falhas. */
(function installErrorBoundary() {
  var _lastShown = 0;
  function avisar(origem, msg) {
    try { console.warn('[erro capturado · ' + origem + ']', msg); } catch (_) { _quiet(_); }
    // Evita spam: no máximo um aviso a cada 8s, e só depois do app carregado.
    var agora = Date.now();
    if (agora - _lastShown < 8000) return;
    _lastShown = agora;
    try {
      if (typeof showToast === 'function' && document.getElementById('app-loading') === null) {
        // Mensagem tranquilizadora: os dados estão salvos localmente na hora.
        showToast('⚠ Algo não respondeu como esperado — seus dados estão salvos. Se algo ficou estranho, recarregue a página.');
      }
    } catch (_) { _quiet(_); }
  }
  window.addEventListener('error', function (e) {
    // ignora erros de recursos (img/script externos) — não afetam os dados
    if (e && e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) return;
    avisar('error', e && (e.message || e.error));
  });
  window.addEventListener('unhandledrejection', function (e) {
    avisar('promise', e && e.reason && (e.reason.message || e.reason));
  });
})();

try { FocusTrap.init(); } catch (_) { _quiet(_); }
ProfileUI.boot();
// Os scripts externos agora usam defer (não travam a abertura do app). Eles executam
// antes do DOMContentLoaded, então é aqui que a nuvem pode ser iniciada com segurança.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => CloudStore.init());
else CloudStore.init();


/* ═══════════════════════════════════════════════════════════════════════════
   EVOLUÇÃO v47 — comportamento
   Registrar compacto · Grade com colunas padrão · Estudo Novo em tabela ·
   Histórico · Evolução (engrenagem de exibição) · TEC (abas configuráveis) ·
   Configurações (tela de gestão) · Conta e nuvem (menu + sessão confiável)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // PREFERÊNCIAS DE UI (abas visíveis, blocos, linhas de meta, etc.)
  // Antes ficavam num prefixo GLOBAL (não sincronizava entre aparelhos). Agora são
  // gravadas DENTRO do namespace do perfil ativo (diario-estudos:u:<id>:ux47:*),
  // então entram no blob sincronizado e aparecem iguais em qualquer dispositivo.
  const OLD_PFX = 'diario-estudos:ux47:';
  function _activePfx() {
    try {
      const pid = localStorage.getItem('diario-estudos:active-profile');
      return pid ? ('diario-estudos:u:' + pid + ':ux47:') : OLD_PFX;
    } catch (_) { return OLD_PFX; }
  }
  // Migração única (por perfil): copia as preferências globais antigas para o
  // namespace do perfil ativo, para você não perder o que já tinha configurado.
  (function migrateUxPrefs() {
    try {
      const npfx = _activePfx();
      if (npfx === OLD_PFX) return;
      const flag = npfx + '__migrated';
      if (localStorage.getItem(flag)) return;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(OLD_PFX)) {
          const nk = npfx + k.slice(OLD_PFX.length);
          if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
        }
      }
      localStorage.setItem(flag, '1');
    } catch (_) { _quiet(_); }
  })();
  /* Leitura resiliente ao namespace.
     O valor mora em <perfil>:ux47:<k>. Mas se ele foi gravado num momento em
     que não havia perfil ativo (gate aberto, primeiro acesso, troca de
     perfil), foi parar no prefixo GLOBAL — e a migração global→perfil roda
     UMA vez só, marcada por __migrated. Depois disso, o que cair no global
     fica órfão para sempre: era exatamente o caso de "sessão única" e
     "sair por inatividade", que você remarcava toda vez.
     Agora: não achou no perfil, procura no global; se achar, PROMOVE para o
     perfil na hora, para a busca não se repetir. */
  function pget(k, d) {
    try {
      const v = localStorage.getItem(_activePfx() + k);
      if (v !== null) return v;
      if (_activePfx() !== OLD_PFX) {
        const g = localStorage.getItem(OLD_PFX + k);
        if (g !== null) { DB.setRaw(_activePfx() + k, g); return g; }
      }
      return d;
    } catch (_) { return d; }
  }
  /* Grava sempre no namespace do perfil. Se ainda NÃO há perfil ativo, o
     prefixo é o global — e aí o pget acima recupera na próxima abertura. */
  function pset(k, v) { DB.setRaw(_activePfx() + k, String(v)); }
  function pdel(k) { DB.delRaw(_activePfx() + k); }
  function jget(k, d) { try { return JSON.parse(localStorage.getItem(_activePfx() + k)) ?? d; } catch (_) { return d; } }
  function jset(k, v) { DB.setRaw(_activePfx() + k, JSON.stringify(v)); }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s));
  const toast = (m) => { try { showToast(m); } catch (_) { _quiet(_); } };
  const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  /* ---------- popover ancorado ---------- */
  let _pop = null, _popScrim = null;
  function closePop() {
    if (_pop) { _pop.remove(); _pop = null; }
    if (_popScrim) { _popScrim.remove(); _popScrim = null; }
    document.removeEventListener('keydown', _popEsc, true);
  }
  function _popEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } }
  function openPop(anchor, html, onMount, opts) {
    closePop();
    opts = opts || {};
    _popScrim = document.createElement('div');
    _popScrim.className = 'cloud-scrim';
    _popScrim.addEventListener('click', closePop);
    document.body.appendChild(_popScrim);
    _pop = document.createElement('div');
    _pop.className = opts.cls || 'ux-pop';
    _pop.style.position = 'fixed';
    _pop.innerHTML = html;
    document.body.appendChild(_pop);
    const r = anchor.getBoundingClientRect();
    const w = _pop.offsetWidth, h = _pop.offsetHeight;
    let left = opts.alignRight ? r.right - w : r.left;
    left = Math.max(10, Math.min(left, window.innerWidth - w - 10));
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 10) top = Math.max(10, r.top - h - 8);
    _pop.style.left = left + 'px';
    _pop.style.top = top + 'px';
    _pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('keydown', _popEsc, true);
    if (onMount) onMount(_pop);
    return _pop;
  }
  window.UX47 = { openPop, closePop, pget, pset };

  function checkRow(id, label, sub, checked, disabled) {
    return `<label class="ux-pop-opt${disabled ? ' disabled' : ''}">
      <input type="checkbox" data-ux="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>${esc(label)}${sub ? `<span class="ux-pop-sub">${esc(sub)}</span>` : ''}</span></label>`;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     1) REGISTRAR — modo compacto e ação rápida
     ═════════════════════════════════════════════════════════════════════════ */
  const RegistrarUX = {
    init() {
      const scr = $('#screen-registrar');
      const head = $('#screen-registrar .card .card-header');
      if (!scr || !head || $('#reg-mode-seg')) return;
      const bar = document.createElement('div');
      bar.className = 'reg-modebar';
      bar.innerHTML = `
        <button type="button" class="reg-quick" id="reg-repeat" title="Preenche matéria e forma de estudo com os do último registro">⟳ Repetir última</button>
        <div class="ux-seg" id="reg-mode-seg" role="group" aria-label="Formato do formulário">
          <button type="button" data-m="compacto" title="Tudo em uma tela, sem textos de apoio">⚡ Compacto</button>
          <button type="button" data-m="guiado" title="Passo a passo com explicações">📋 Guiado</button>
        </div>`;
      head.appendChild(bar);
      $$('#reg-mode-seg button').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.m)));
      const rep = $('#reg-repeat');
      if (rep) rep.addEventListener('click', () => this.repeatLast());
      this.setMode(pget('reg-mode', 'compacto'));
      this.refreshRepeat();
      window.addEventListener('screen:activated', (e) => {
        if (e.detail && e.detail.screen === 'registrar') this.refreshRepeat();
      });
    },
    setMode(m) {
      m = (m === 'guiado') ? 'guiado' : 'compacto';
      pset('reg-mode', m);
      const scr = $('#screen-registrar');
      if (scr) scr.setAttribute('data-reg-mode', m);
      $$('#reg-mode-seg button').forEach(b => b.classList.toggle('active', b.dataset.m === m));
    },
    lastEntry() {
      try {
        const all = DB.getEntries() || [];
        if (!all.length) return null;
        return all.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || String(b.date).localeCompare(String(a.date)))[0];
      } catch (_) { return null; }
    },
    refreshRepeat() {
      const b = $('#reg-repeat'); if (!b) return;
      const e = this.lastEntry();
      b.disabled = !e;
      if (e) b.title = `Repetir: ${e.subject || '—'} · ${e.method || '—'}`;
    },
    repeatLast() {
      const e = this.lastEntry();
      if (!e) { toast('Ainda não há registros para repetir.'); return; }
      const s = $('#subject'), m = $('#method'), d = $('#date');
      if (s && e.subject) { s.value = e.subject; s.dispatchEvent(new Event('change', { bubbles: true })); }
      if (m && e.method) { m.value = e.method; m.dispatchEvent(new Event('change', { bubbles: true })); }
      if (d) { try { d.value = todayLocal(); } catch (_) { _quiet(_); } }
      const l = $('#lesson'); if (l) l.focus();
      toast('Matéria e forma preenchidas ✓');
    }
  };

  /* ═════════════════════════════════════════════════════════════════════════
     2) GRADE SEMANAL — densidade de coluna e reaplicação após render
     ═════════════════════════════════════════════════════════════════════════ */
  const GradeUX = {
    init() {
      const actions = $('#grade-tray-bar .grade-tray-actions');
      if (actions && !$('#grade-dens-sel')) {
        const wrap = document.createElement('label');
        wrap.className = 'grade-density-ctl';
        wrap.title = 'Largura padrão das colunas de cada dia';
        wrap.innerHTML = `<span>Colunas:</span>
          <select id="grade-dens-sel">
            <option value="compacta">Compactas</option>
            <option value="normal">Padrão</option>
            <option value="ampla">Amplas</option>
          </select>`;
        actions.insertBefore(wrap, actions.firstChild);
        const sel = $('#grade-dens-sel');
        sel.value = pget('grade-dens', 'normal');
        sel.addEventListener('change', () => { pset('grade-dens', sel.value); this.apply(); });
      }
      this.apply();
      if (window.GradeScreen && !GradeScreen._ux47) {
        const orig = GradeScreen.render.bind(GradeScreen);
        GradeScreen.render = () => { orig(); GradeUX.apply(); };
        GradeScreen._ux47 = true;
      }
      const host = $('#ciclo-grade');
      if (host && !host._ux47obs) {
        host._ux47obs = new MutationObserver(() => this.apply());
        host._ux47obs.observe(host, { childList: true });
      }
    },
    apply() {
      const host = $('#ciclo-grade');
      if (!host) return;
      host.setAttribute('data-dens', pget('grade-dens', 'normal'));
      // A visão "Meta diária" não usa tabela e esconde a bandeja: aqui não mexemos
      // em nada, senão a dica de rolagem voltaria a aparecer fora de hora.
      const tabela = host.querySelector('.grade-table');
      host.setAttribute('data-view', tabela ? 'semana' : 'dia');
      const hint = $('#grade-scroll-hint');
      if (!hint) return;
      if (!tabela) { hint.style.display = 'none'; return; }
      hint.style.display = (host.scrollWidth > host.clientWidth + 4) ? 'block' : 'none';
    }
  };

  /* ═════════════════════════════════════════════════════════════════════════
     3) ESTUDO NOVO — visão em tabela (leitura) + cartões (edição)
     ═════════════════════════════════════════════════════════════════════════ */
  const EstudoNovoUX = {
    mode() { return pget('en-view', 'cartoes') === 'tabela' ? 'tabela' : 'cartoes'; },
    init() {
      if (typeof EstudoNovoScreen === 'undefined' || EstudoNovoScreen._ux47) return;
      const orig = EstudoNovoScreen.renderTrack.bind(EstudoNovoScreen);
      EstudoNovoScreen.renderTrack = function () {
        orig();
        try { EstudoNovoUX.afterTrack(); } catch (err) { console.warn('UX47 tabela', err); }
      };
      EstudoNovoScreen._ux47 = true;
    },
    ensureToolbar() {
      const area = $('#en-track-area .card');
      if (!area || $('#en-view-seg')) return;
      const head = area.querySelector('.card-header');
      if (!head) return;
      const bar = document.createElement('div');
      bar.className = 'en-track-toolbar';
      bar.innerHTML = `
        <div class="ux-seg" id="en-view-seg" role="group" aria-label="Modo de visualização">
          <button type="button" data-v="cartoes" title="Editar aula por aula">▦ Cartões</button>
          <button type="button" data-v="tabela" title="Visão de planilha, só leitura">▤ Tabela</button>
        </div>
        <span class="spacer"></span>
        <span class="en-track-legend" id="en-track-legend"></span>`;
      head.insertAdjacentElement('afterend', bar);
      $$('#en-view-seg button').forEach(b => b.addEventListener('click', () => {
        pset('en-view', b.dataset.v);
        EstudoNovoScreen.renderTrack();
      }));
    },
    afterTrack() {
      if (!EstudoNovoScreen.currentSubject) return;   // nada selecionado: nada a montar
      this.ensureToolbar();
      const mode = this.mode();
      $$('#en-view-seg button').forEach(b => b.classList.toggle('active', b.dataset.v === mode));
      const list = $('#en-track-list');
      const avg = $('#en-track-averages');
      let tw = $('#en-table-host');
      if (!tw) {
        tw = document.createElement('div');
        tw.id = 'en-table-host';
        if (list) list.insertAdjacentElement('afterend', tw);
      }
      const items = DB.getTrack(EstudoNovoScreen.currentSubject) || [];
      const legend = $('#en-track-legend');
      if (legend) {
        const aulas = items.filter(i => i.type === 'aula').length;
        const chk = items.filter(i => i.type === 'checkpoint').length;
        legend.innerHTML = `<span><b>${aulas}</b> aula${aulas === 1 ? '' : 's'}</span><span>·</span><span><b>${chk}</b> checkpoint${chk === 1 ? '' : 's'}</span>`;
      }
      if (mode === 'tabela') {
        if (list) list.style.display = 'none';
        if (avg) avg.style.display = '';
        tw.style.display = '';
        tw.innerHTML = this.tableHtml(items);
        this.bindTable(tw);
      } else {
        if (list) list.style.display = '';
        tw.style.display = 'none';
        tw.innerHTML = '';
      }
    },
    pctCls(p) { return p === null || p === undefined ? 'empty' : 'tone-' + toneFor(p); },
    fmt(p) {
      if (p === null || p === undefined) return '—';
      const r = Math.round(p * 10) / 10;
      return (Number.isInteger(r) ? r : r.toFixed(1)) + '%';
    },
    tableHtml(items) {
      const defs = DB.STAGE_DEFS || [];
      if (!items.length) {
        return `<p class="en-table-note">Nenhuma aula cadastrada ainda. Use os <b>Cartões</b> para montar a trilha.</p>`;
      }
      const cols = defs.length;
      let head = `<thead>
        <tr>
          <th class="col-num" rowspan="2">Aula</th>
          <th class="col-nome" rowspan="2">Nome</th>
          <th class="col-sit" rowspan="2">Situação</th>
          <th class="grp" colspan="${cols}">Aproveitamento por etapa</th>
        </tr>
        <tr>${defs.map(d => `<th class="col-pct">${esc(d.label)}</th>`).join('')}</tr>
      </thead>`;
      let n = 0, rows = '';
      const acc = defs.map(() => ({ ac: 0, tot: 0, pcts: [] }));
      items.forEach(it => {
        if (it.type === 'checkpoint') {
          rows += `<tr class="en-tb-check"><td colspan="${3 + cols}">◆ ${esc(it.label || 'Checkpoint')}</td></tr>`;
          return;
        }
        n++;
        const st = DB.resolveStatus(it.status) || { nome: '—', color: 'var(--text-faint)', bg: 'transparent' };
        const cells = defs.map((d, i) => {
          const v = DB.getStageValues(it, d) || {};
          const p = DB.getStagePct(it, d);
          if (v.total) { acc[i].ac += (v.acertos || 0); acc[i].tot += v.total; }
          if (p !== null && p !== undefined) acc[i].pcts.push(p);
          const frac = (v.total ? `<span class="en-tb-frac">${v.acertos ?? 0}/${v.total}</span>` : '');
          return `<td class="col-pct"><span class="en-tb-pct ${this.pctCls(p)}">${this.fmt(p)}</span>${frac}</td>`;
        }).join('');
        rows += `<tr class="en-tb-lesson" data-id="${esc(it.id)}">
          <td class="col-num">${n}</td>
          <td class="col-nome"><span class="en-tb-name">${esc(it.text || '—')}</span><span class="en-tb-editcue">✎ editar nos cartões</span></td>
          <td class="col-sit"><span class="en-tb-badge" style="color:${st.color}; background:${st.bg || 'transparent'};" title="${esc(st.nome)}"><span class="dot"></span>${esc(st.nome)}</span></td>
          ${cells}
        </tr>`;
      });
      const totals = acc.map(a => {
        const p = a.pcts.length ? a.pcts.reduce((x, y) => x + y, 0) / a.pcts.length : null;
        return `<td class="col-pct"><span class="en-tb-pct ${this.pctCls(p)}">${this.fmt(p)}</span>${a.tot ? `<span class="en-tb-frac">${a.ac}/${a.tot}</span>` : ''}</td>`;
      }).join('');
      rows += `<tr class="en-tb-total"><td class="col-num">—</td><td class="col-nome">Média das aulas medidas</td><td class="col-sit">${n} aula${n === 1 ? '' : 's'}</td>${totals}</tr>`;
      return `<div class="en-table-wrap"><table class="en-table">${head}<tbody>${rows}</tbody></table></div>
        <p class="en-table-note"><span>💡</span><span>Esta visão é só de leitura, para conferir a trilha inteira de uma vez. Clique em qualquer aula para abri-la nos <b>Cartões</b>, onde ficam as edições.</span></p>`;
    },
    bindTable(host) {
      $$('tr.en-tb-lesson', host).forEach(tr => tr.addEventListener('click', () => {
        pset('en-view', 'cartoes');
        EstudoNovoScreen.renderTrack();
        setTimeout(() => {
          const row = $(`#en-track-list .track-row-wrap[data-id="${CSS.escape(tr.dataset.id)}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.add('is-target');
            setTimeout(() => row.classList.remove('is-target'), 1600);
          }
        }, 60);
      }));
    }
  };

  /* ═════════════════════════════════════════════════════════════════════════
     4) HISTÓRICO — tom de cada semana (usado pelo acento lateral do cartão)
     ═════════════════════════════════════════════════════════════════════════ */
  const HistoricoUX = {
    init() {
      if (typeof HistoricoScreen === 'undefined' || HistoricoScreen._ux47) return;
      const orig = HistoricoScreen.render.bind(HistoricoScreen);
      HistoricoScreen.render = function () { orig(); try { HistoricoUX.decorate(); } catch (_) { _quiet(_); } };
      HistoricoScreen._ux47 = true;
    },
    decorate() {
      $$('#historico-list .week-card').forEach(card => {
        const v = card.querySelector('.week-stat .value');
        const pct = v ? parseFloat(String(v.textContent).replace('%', '')) : NaN;
        const tone = isNaN(pct) ? 'warn' : (pct >= 100 ? 'good' : pct >= 40 ? 'warn' : 'bad');
        card.setAttribute('data-tone', tone);
      });
    }
  };

  /* ═════════════════════════════════════════════════════════════════════════
     5) EVOLUÇÃO — engrenagem de exibição, linhas de meta e rótulos nas barras
     ═════════════════════════════════════════════════════════════════════════ */
  const EvolucaoUX = {
    linhasOn() { return pget('evo-metalines', '1') === '1'; },
    labelsOn() { return pget('evo-barlabels', '1') === '1'; },
    hidden() { return jget('evo-hidden', []); },
    setHidden(arr) { jset('evo-hidden', arr); },
    init() {
      // as linhas de meta passam TODAS por metaRefs(): um interruptor resolve a tela inteira
      if (typeof metaRefs === 'function' && !metaRefs._ux47) {
        const orig = metaRefs;
        const wrapped = function () { return EvolucaoUX.linhasOn() ? orig() : []; };
        wrapped._ux47 = true;
        try { metaRefs = wrapped; } catch (_) { window.metaRefs = wrapped; }
      }
      if (typeof EvolucaoScreen !== 'undefined' && !EvolucaoScreen._ux47) {
        const orig = EvolucaoScreen.render.bind(EvolucaoScreen);
        EvolucaoScreen.render = function () { orig(); try { EvolucaoUX.after(); } catch (err) { console.warn('UX47 evolução', err); } };
        EvolucaoScreen._ux47 = true;
      }
      this.ensureBar();
    },
    ensureBar() {
      const anchor = $('#evo-scope-card');
      if (!anchor || $('#evo-viewbar')) return;
      const bar = document.createElement('div');
      bar.className = 'evo-viewbar';
      bar.id = 'evo-viewbar';
      bar.innerHTML = `<span class="lbl">Exibição</span>
        <span class="spacer"></span>
        <button type="button" class="ux-gear" id="evo-gear-lines" title="Mostrar ou ocultar as linhas de meta em todos os gráficos">⚙ Linhas de meta</button>
        <button type="button" class="ux-gear" id="evo-gear-cards" title="Escolher quais blocos aparecem nesta tela">⚙ Blocos visíveis</button>`;
      anchor.insertAdjacentElement('afterend', bar);
      $('#evo-gear-lines').addEventListener('click', (e) => this.popLines(e.currentTarget));
      $('#evo-gear-cards').addEventListener('click', (e) => this.popCards(e.currentTarget));
      this.syncGear();
    },
    syncGear() {
      const g = $('#evo-gear-lines');
      if (g) {
        g.classList.toggle('on', this.linhasOn());
        g.innerHTML = (this.linhasOn() ? '⚙ Linhas de meta: ligadas' : '⚙ Linhas de meta: ocultas');
      }
      const c = $('#evo-gear-cards');
      const n = this.hidden().length;
      if (c) {
        c.classList.toggle('on', n > 0);
        c.innerHTML = n ? `⚙ Blocos visíveis (${n} oculto${n === 1 ? '' : 's'})` : '⚙ Blocos visíveis';
      }
    },
    popLines(btn) {
      let metas = '70, 80, 85';
      try { metas = AppSettings.get().linhas.slice().sort((a, b) => a - b).join(', '); } catch (_) { _quiet(_); }
      openPop(btn, `
        <div class="ux-pop-head">Linhas de meta</div>
        <div class="ux-pop-body">
          ${checkRow('lines', 'Exibir linhas de meta nos gráficos', 'Vale para todos os gráficos de percentual desta tela.', this.linhasOn())}
          ${checkRow('labels', 'Rótulo de valor nas barras do dia', 'Só aparece quando há até 14 barras — acima disso ficaria sobreposto.', this.labelsOn())}
          <div class="ux-pop-sep"></div>
          <div class="ux-pop-note">Metas atuais: <b>${esc(metas)}</b>. Para mudar os valores e as cores, use <b>⚙ Metas</b> no bloco “% de acertos por matéria”.</div>
        </div>
        <div class="ux-pop-foot"><button type="button" class="btn-secondary" data-act="metas">Editar metas…</button></div>`,
        (pop) => {
          pop.querySelector('[data-ux="lines"]').addEventListener('change', (e) => {
            pset('evo-metalines', e.target.checked ? '1' : '0');
            this.syncGear(); this.rerender();
          });
          pop.querySelector('[data-ux="labels"]').addEventListener('change', (e) => {
            pset('evo-barlabels', e.target.checked ? '1' : '0');
            this.rerender();
          });
          pop.querySelector('[data-act="metas"]').addEventListener('click', () => {
            closePop();
            const b = $('#btn-edit-metas'); if (b) b.click();
          });
        }, { alignRight: true });
    },
    cardList() {
      return $$('#evolucao-content > .card').map(card => {
        const h = card.querySelector('h2');
        const name = h ? h.textContent.trim() : 'Bloco';
        let key = card.getAttribute('data-evo-key');
        if (!key) { key = slug(name) || ('b' + Math.random().toString(36).slice(2, 7)); card.setAttribute('data-evo-key', key); }
        return { key, name, card };
      });
    },
    popCards(btn) {
      const hid = this.hidden();
      const list = this.cardList();
      openPop(btn, `
        <div class="ux-pop-head">Blocos desta tela</div>
        <div class="ux-pop-body">
          ${list.map(c => checkRow('c:' + c.key, c.name, '', hid.indexOf(c.key) === -1)).join('')}
        </div>
        <div class="ux-pop-foot"><button type="button" class="btn-secondary" data-act="all">Mostrar todos</button></div>`,
        (pop) => {
          pop.querySelectorAll('[data-ux^="c:"]').forEach(cb => cb.addEventListener('change', () => {
            const key = cb.dataset.ux.slice(2);
            let h = this.hidden();
            if (cb.checked) h = h.filter(x => x !== key); else if (h.indexOf(key) === -1) h.push(key);
            this.setHidden(h); this.applyHidden(); this.syncGear();
          }));
          pop.querySelector('[data-act="all"]').addEventListener('click', () => {
            this.setHidden([]); this.applyHidden(); this.syncGear(); closePop();
          });
        }, { alignRight: true });
    },
    applyHidden() {
      const hid = this.hidden();
      this.cardList().forEach(c => c.card.classList.toggle('evo-hidden-card', hid.indexOf(c.key) !== -1));
    },
    barLabels() {
      const host = $('#evolucao-day-chart');
      if (!host) return;
      $$('.evo-bar-value', host).forEach(x => x.remove());
      if (!this.labelsOn()) return;
      const bars = $$('.evo-day-bar', host);
      if (!bars.length || bars.length > 14) return;
      bars.forEach(b => {
        const t = b.getAttribute('title') || '';
        const i = t.indexOf(':');
        const val = i >= 0 ? t.slice(i + 1).trim() : '';
        if (!val || /^0\s*min$/i.test(val) || b.classList.contains('empty')) return;
        const s = document.createElement('span');
        s.className = 'evo-bar-value';
        s.textContent = val;
        b.appendChild(s);
      });
    },
    rerender() { try { EvolucaoScreen.render(); } catch (_) { this.after(); } },
    after() { this.ensureBar(); this.applyHidden(); this.barLabels(); this.syncGear(); }
  };

  /* ═════════════════════════════════════════════════════════════════════════
     6) DESEMPENHO TEC — abas escolhidas pelo usuário + Plano didático
     ═════════════════════════════════════════════════════════════════════════ */
  const TEC_TABS = [
    { id: 'analise', label: '📊 Análise', desc: 'Totais, pontos fracos e aproveitamento por disciplina.' },
    { id: 'incidencia', label: '🏛️ Incidência', desc: 'Cadastro de quantas vezes cada tópico caiu na banca.' },
    { id: 'reforco', label: '🎯 Reforço', desc: 'Cruza seu erro com a incidência e ordena por ganho de pontos.' },
    { id: 'plano', label: '🏁 Plano', desc: 'Rota até a meta de domínio, assunto por assunto.' }
  ];
  const TecUX = {
    visible() {
      const v = jget('tec-tabs', null);
      if (!Array.isArray(v) || !v.length) return TEC_TABS.map(t => t.id);
      const ok = v.filter(id => TEC_TABS.some(t => t.id === id));
      return ok.length ? ok : TEC_TABS.map(t => t.id);
    },
    init() {
      // engrenagem "Exibição" no topo do TEC (agrupa Filtros + Modo enxuto)
      (function () {
        const gbtn = $('#tec-gear-btn'), gmenu = $('#tec-gear-menu');
        if (!gbtn || !gmenu || gbtn._ux) return;
        gbtn._ux = true;
        const close = () => { gmenu.classList.remove('open'); gbtn.classList.remove('open'); gbtn.setAttribute('aria-expanded', 'false'); gmenu.setAttribute('aria-hidden', 'true'); document.removeEventListener('click', onDoc, true); };
        const onDoc = (e) => { if (!gmenu.contains(e.target) && e.target !== gbtn && !gbtn.contains(e.target)) close(); };
        gbtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = gmenu.classList.toggle('open');
          gbtn.classList.toggle('open', open);
          gbtn.setAttribute('aria-expanded', open ? 'true' : 'false');
          gmenu.setAttribute('aria-hidden', open ? 'false' : 'true');
          if (open) setTimeout(() => document.addEventListener('click', onDoc, true), 0);
          else document.removeEventListener('click', onDoc, true);
        });
        gmenu.querySelectorAll('.grade-gear-item').forEach(it => it.addEventListener('click', () => setTimeout(close, 0)));
      })();
      const tabs = $('#tec-subtabs');
      if (!tabs) return;
      if (!$('#tec-tabs-gear')) {
        const wrap = document.createElement('div');
        wrap.className = 'tec-subtabs-wrap';
        tabs.parentNode.insertBefore(wrap, tabs);
        wrap.appendChild(tabs);
        const gear = document.createElement('button');
        gear.type = 'button';
        gear.className = 'ux-gear';
        gear.id = 'tec-tabs-gear';
        gear.title = 'Escolher quais abas aparecem';
        gear.innerHTML = '⚙ Abas';
        wrap.appendChild(gear);
        gear.addEventListener('click', (e) => this.pop(e.currentTarget));
      }
      this.apply();
      this.plano();
    },
    pop(btn) {
      const vis = this.visible();
      openPop(btn, `
        <div class="ux-pop-head">Abas do Desempenho TEC</div>
        <div class="ux-pop-body">
          ${TEC_TABS.map(t => checkRow('t:' + t.id, t.label, t.desc, vis.indexOf(t.id) !== -1)).join('')}
          <div class="ux-pop-note">Pelo menos uma aba fica sempre visível.</div>
        </div>
        <div class="ux-pop-foot"><button type="button" class="btn-secondary" data-act="all">Mostrar todas</button></div>`,
        (pop) => {
          pop.querySelectorAll('[data-ux^="t:"]').forEach(cb => cb.addEventListener('change', () => {
            let v = this.visible();
            const id = cb.dataset.ux.slice(2);
            if (cb.checked) { if (v.indexOf(id) === -1) v.push(id); }
            else { const n = v.filter(x => x !== id); if (!n.length) { cb.checked = true; toast('Mantenha ao menos uma aba visível.'); return; } v = n; }
            jset('tec-tabs', TEC_TABS.map(t => t.id).filter(x => v.indexOf(x) !== -1));
            this.apply();
          }));
          pop.querySelector('[data-act="all"]').addEventListener('click', () => {
            jset('tec-tabs', TEC_TABS.map(t => t.id)); this.apply(); closePop();
          });
        }, { alignRight: true });
    },
    apply() {
      const vis = this.visible();
      $$('#tec-subtabs .tec-subtab').forEach(b => b.classList.toggle('ux-off', vis.indexOf(b.dataset.tectab) === -1));
      const g = $('#tec-tabs-gear');
      if (g) { const n = TEC_TABS.length - vis.length; g.innerHTML = n ? `⚙ Abas (${n} oculta${n === 1 ? '' : 's'})` : '⚙ Abas'; g.classList.toggle('on', n > 0); }
      try {
        if (typeof DT !== 'undefined' && vis.indexOf(DT.tecTab) === -1) DT.switchTecTab(vis[0]);
      } catch (_) { _quiet(_); }
    },
    /* — Plano: agrupa os controles por finalidade e abre com um resumo do método — */
    plano() {
      const panel = $('#tec-panel-plano');
      if (!panel || $('#pl-steps')) return;
      const toolbar = panel.querySelector('.rfc-toolbar');
      if (!toolbar) return;
      const grab = (sel) => { const el = panel.querySelector(sel); return el ? el.closest('.rfc-field') : null; };
      const groups = [
        { t: '1 · Recorte', d: 'Sobre qual conjunto de assuntos o plano vai raciocinar.', f: ['#plano-disc', '#plano-amostraalvo'] },
        { t: '2 · Meta e ritmo', d: 'Onde você quer chegar e quantas questões consegue resolver por semana.', f: ['#plano-meta', '#plano-ritmo'] },
        { t: '3 · Ordem de ataque', d: 'O critério que decide qual assunto vem primeiro na lista.', f: ['#plano-ordenar', '#plano-banca'] }
      ];
      const frag = document.createDocumentFragment();
      groups.forEach(g => {
        const box = document.createElement('div');
        box.className = 'pl-toolgroup';
        box.innerHTML = `<div class="pl-toolgroup-head"><span class="pl-toolgroup-title">${esc(g.t)}</span><span class="pl-toolgroup-desc">${esc(g.d)}</span></div><div class="rfc-toolbar"></div>`;
        const inner = box.querySelector('.rfc-toolbar');
        let any = false;
        g.f.forEach(sel => { const f = grab(sel); if (f) { inner.appendChild(f); any = true; } });
        if (any) frag.appendChild(box);
      });
      toolbar.parentNode.insertBefore(frag, toolbar);
      // o que sobrou (botão de avançados) fica numa linha própria, embaixo
      toolbar.classList.add('pl-toolbar-rest');
      toolbar.style.marginTop = '2px';
      // faixa didática explicando o método, acima da projeção
      const steps = document.createElement('div');
      steps.className = 'pl-steps';
      steps.id = 'pl-steps';
      steps.innerHTML = [
        { c: 'var(--info)', t: 'Mede', d: 'Para cada assunto, o app volta no tempo nos seus retratos até juntar a amostra que você pediu.' },
        { c: 'var(--warn)', t: 'Compara', d: 'A taxa de acerto de cada assunto é confrontada com a meta de domínio definida acima.' },
        { c: 'var(--accent)', t: 'Ordena', d: 'A lista sai pelo critério escolhido em “Ordem de ataque” — não é ordem alfabética nem aleatória.' },
        { c: 'var(--good)', t: 'Fecha o ciclo', d: 'Você cria a atividade, resolve as questões, importa o próximo retrato e o número se move sozinho.' }
      ].map((s, i) => `<div class="pl-step" style="--pl-step-color:${s.c}"><span class="n">${i + 1}</span><div class="t">${s.t}</div><div class="d">${esc(s.d)}</div></div>`).join('');
      const proj = $('#plano-proj');
      if (proj) proj.parentNode.insertBefore(steps, proj);
    }
  };

  /* ═════════════════════════════════════════════════════════════════════════
     7) CONFIGURAÇÕES — tela de gestão com seções, preferências e diagnóstico
     ═════════════════════════════════════════════════════════════════════════ */
  const CFG_GROUPS = [
    { id: 'estudo', ic: '📚', label: 'Estudo', title: 'Estrutura do seu estudo', desc: 'Matérias, fases, formas e modos. É daqui que saem as opções de todas as outras telas.' },
    { id: 'prefs', ic: '🎛️', label: 'Preferências', title: 'Aparência e comportamento', desc: 'Ajustes deste dispositivo. Não afetam seus dados nem são enviados para a nuvem.' },
    { id: 'conta', ic: '☁️', label: 'Conta e nuvem', title: 'Conta, sessão e sincronização', desc: 'Acesso em vários aparelhos, controle da sessão e envio manual quando você quiser.' },
    { id: 'dados', ic: '💾', label: 'Dados e backup', title: 'Seus dados', desc: 'As cópias de segurança em ordem de força: no servidor, neste aparelho e em arquivo — mais a ferramenta de resgate.' },
    { id: 'diag', ic: '🩺', label: 'Diagnóstico', title: 'Diagnóstico e manutenção', desc: 'O estado real do app agora — útil quando algo parece fora do lugar.' }
  ];
  const ConfigUX = {
    init() {
      const scr = $('#screen-config');
      if (!scr || $('#cfg-shell')) return;
      const header = scr.querySelector('.page-header');
      const shell = document.createElement('div');
      shell.className = 'cfg-shell';
      shell.id = 'cfg-shell';
      shell.innerHTML = `<nav class="cfg-nav" id="cfg-nav"><div class="cfg-nav-title">Seções</div></nav><div class="cfg-panes" id="cfg-panes"></div>`;
      header.insertAdjacentElement('afterend', shell);
      const nav = $('#cfg-nav'), panes = $('#cfg-panes');
      CFG_GROUPS.forEach(g => {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.g = g.id;
        b.innerHTML = `<span class="ic">${g.ic}</span><span>${g.label}</span>`;
        b.addEventListener('click', () => this.show(g.id));
        nav.appendChild(b);
        const pane = document.createElement('div');
        pane.className = 'cfg-group'; pane.id = 'cfg-g-' + g.id;
        pane.innerHTML = `<div class="cfg-group-head"><h3>${g.ic} ${esc(g.title)}</h3><p>${esc(g.desc)}</p></div>`;
        panes.appendChild(pane);
      });
      const to = (sel, gid) => { const el = $(sel); const card = el ? el.closest('section.card, div.card') : null; if (card) $('#cfg-g-' + gid).appendChild(card); };
      to('#config-subjects-list', 'estudo');
      to('#config-phases-list', 'estudo');
      to('#config-methods-list', 'estudo');
      to('#config-modes-list', 'estudo');
      to('#config-statuses-list', 'estudo');
      to('#cloud-auth-box', 'conta');
      /* ── ORDEM DE "DADOS E BACKUP" = FORÇA DA PROTEÇÃO ────────────────────
         Da mais forte (no servidor, automática, sobrevive a perder este
         aparelho) para a mais frágil (arquivo que você mesmo guarda), depois
         a ferramenta de resgate e por fim o medidor de espaço. Quem chega
         aqui com medo de ter perdido algo lê de cima para baixo e encontra a
         proteção mais forte primeiro.

         O cartão de Recuperação NÃO era movido por nenhum to(): ficava fora
         do sistema de abas, pendurado embaixo de todas as seções e visível
         em qualquer uma delas. */
      to('#cfg-cloudbk-body', 'dados');   // no servidor, automático
      to('#cfg-vhist-body', 'dados');     // neste aparelho, automático
      this.buildDados();                  // em arquivo, manual
      to('#cfg-rec-body', 'dados');       // resgate, quando algo já deu errado
      to('#cfg-storage-body', 'dados');   // medidor de espaço
      this.buildPrefs();
      // O cartão de exibição das Leis é marcação fixa (os mesmos controles do
      // ⚙️ Exibição da tela de Leis) e entra depois dos cartões montados aqui,
      // para não passar à frente do tema e do tamanho de fonte.
      to('#cfg-leis-card', 'prefs');
      this.buildDiag();
      this.show(pget('cfg-group', 'estudo'));
      window.addEventListener('screen:activated', (e) => {
        if (!e.detail || e.detail.screen !== 'config') return;
        this.refreshDiag();
        const t = $('#cfgp-tema');
        if (t) { try { t.value = localStorage.getItem('diario-estudos:theme-mode') || localStorage.getItem('diario-estudos:theme') || 'light'; } catch (_) { _quiet(_); } }
      });
    },
    show(id) {
      if (!CFG_GROUPS.some(g => g.id === id)) id = 'estudo';
      pset('cfg-group', id);
      $$('#cfg-nav button').forEach(b => b.classList.toggle('active', b.dataset.g === id));
      $$('.cfg-group').forEach(p => p.classList.toggle('active', p.id === 'cfg-g-' + id));
      if (id === 'diag') this.refreshDiag();
    },
    card(gid, title, sub, bodyHtml, headExtra) {
      const s = document.createElement('section');
      s.className = 'card';
      s.innerHTML = `<div class="card-header"><div><h2>${title}</h2><p class="sub">${sub}</p></div>${headExtra || ''}</div>
        <div style="padding:16px 24px 22px;">${bodyHtml}</div>`;
      $('#cfg-g-' + gid).appendChild(s);
      return s;
    },
    buildPrefs() {
      const c = this.card('prefs', '🎛️ Preferências de exibição',
        'Cada opção vale para este navegador. Mudanças aparecem na hora, sem recarregar.', `
        <div class="cfg-pref-grid">
          <div class="cfg-pref"><div class="cfg-pref-lbl">Tema</div><div class="cfg-pref-desc">Claro, escuro ou seguir o sistema.</div>
            <select id="cfgp-tema"><option value="light">Claro</option><option value="dark">Escuro</option><option value="auto">Seguir o sistema</option></select></div>
          <div class="cfg-pref"><div class="cfg-pref-lbl">Formulário de Registrar</div><div class="cfg-pref-desc">Compacto cabe em uma tela; guiado explica cada etapa.</div>
            <select id="cfgp-reg"><option value="compacto">⚡ Compacto</option><option value="guiado">📋 Guiado</option></select></div>
          <div class="cfg-pref"><div class="cfg-pref-lbl">Colunas da Grade Semanal</div><div class="cfg-pref-desc">Largura padrão de cada dia — todas iguais, sem depender do texto.</div>
            <select id="cfgp-grade"><option value="compacta">Compactas</option><option value="normal">Padrão</option><option value="ampla">Amplas</option></select></div>
          <div class="cfg-pref"><div class="cfg-pref-lbl">Visão do Estudo Novo</div><div class="cfg-pref-desc">Tabela para conferir tudo; cartões para editar.</div>
            <select id="cfgp-en"><option value="cartoes">▦ Cartões</option><option value="tabela">▤ Tabela</option></select></div>
          <div class="cfg-pref"><div class="cfg-pref-lbl">Linhas de meta nos gráficos</div><div class="cfg-pref-desc">Desligue se as linhas tracejadas poluírem a leitura.</div>
            <select id="cfgp-linhas"><option value="1">Exibir</option><option value="0">Ocultar</option></select></div>
          <div class="cfg-pref"><div class="cfg-pref-lbl">Tamanho do texto</div><div class="cfg-pref-desc">Mesmo controle do A− / A+ no topo da barra lateral.</div>
            <div class="cfg-pref-row"><button type="button" class="btn-secondary" id="cfgp-fs-menor" aria-label="Diminuir o tamanho do texto">A −</button><span id="cfgp-fs-val" style="font-family:'Space Mono',monospace;font-weight:700;">100%</span><button type="button" class="btn-secondary" id="cfgp-fs-maior" aria-label="Aumentar o tamanho do texto">A +</button></div></div>
        </div>
        <div style="margin-top:14px;display:flex;justify-content:flex-end;"><button type="button" class="btn-secondary" id="cfgp-reset">↺ Restaurar padrões de exibição</button></div>`);
      const themeSel = $('#cfgp-tema', c);
      themeSel.value = (() => { try { return localStorage.getItem('diario-estudos:theme-mode') || localStorage.getItem('diario-estudos:theme') || 'light'; } catch (_) { return 'light'; } })();
      themeSel.addEventListener('change', () => {
        const v = themeSel.value;
        const eff = v === 'auto' ? ((window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light') : v;
        try { localStorage.setItem('diario-estudos:theme-mode', v); localStorage.setItem('diario-estudos:theme', eff); } catch (_) { _quiet(_); }
        document.documentElement.setAttribute('data-theme', eff);
        const mt = $('#meta-theme-color'); if (mt) mt.setAttribute('content', eff === 'dark' ? '#0f1115' : '#ffffff');
      });
      const bind = (sel, key, def, after) => {
        const el = $(sel, c); if (!el) return;
        el.value = pget(key, def);
        el.addEventListener('change', () => { pset(key, el.value); if (after) after(el.value); });
      };
      bind('#cfgp-reg', 'reg-mode', 'compacto', v => RegistrarUX.setMode(v));
      bind('#cfgp-grade', 'grade-dens', 'normal', () => { const s = $('#grade-dens-sel'); if (s) s.value = pget('grade-dens', 'normal'); GradeUX.apply(); });
      bind('#cfgp-en', 'en-view', 'cartoes', () => { try { EstudoNovoScreen.renderTrack(); } catch (_) { _quiet(_); } });
      bind('#cfgp-linhas', 'evo-metalines', '1', () => { EvolucaoUX.syncGear(); try { EvolucaoScreen.render(); } catch (_) { _quiet(_); } });
      const fsShow = () => { const v = getComputedStyle(document.documentElement).getPropertyValue('--fs-scale').trim() || '1'; const el = $('#cfgp-fs-val', c); if (el) el.textContent = Math.round(parseFloat(v) * 100) + '%'; };
      $('#cfgp-fs-menor', c).addEventListener('click', () => { const b = $('#fs-menor'); if (b) b.click(); setTimeout(fsShow, 30); });
      $('#cfgp-fs-maior', c).addEventListener('click', () => { const b = $('#fs-maior'); if (b) b.click(); setTimeout(fsShow, 30); });
      fsShow();
      $('#cfgp-reset', c).addEventListener('click', async () => {
        const ok = await UI.confirm('Voltar todas as preferências de exibição ao padrão?\n\nNenhum dado de estudo é afetado — só a aparência.', { title: '↺ Restaurar exibição', okText: 'Restaurar' });
        if (!ok) return;
        ['reg-mode', 'grade-dens', 'en-view', 'evo-metalines', 'evo-barlabels', 'evo-hidden', 'tec-tabs', 'cfg-group'].forEach(pdel);
        recarregarApp('preferências de exibição restauradas', { imediato: true });
      });
    },
    buildDados() {
      /* Este cartão tinha cinco botões, e três deles ("Salvar versão agora",
         "Guardar cópia no banco", "Recalcular espaço") apenas disparavam por
         baixo o clique do botão que já existe no cabeçalho do cartão vizinho,
         na MESMA tela. Repetir a mesma ação com nomes diferentes a poucos
         centímetros de distância não é redundância inofensiva: faz duvidar se
         são a mesma coisa, e é assim que alguém acha que fez backup quando não
         fez. Ficam só as duas ações que existem SÓ aqui. */
      this.card('dados', '📦 Backup em arquivo',
        'As duas proteções acima são automáticas. Esta é a única que sai do app e fica com você: um arquivo <code>.json</code> guardado onde você quiser — o único resgate que não depende nem deste aparelho nem da sua conta.', `
        <div class="cfg-action-grid">
          <button type="button" class="cfg-action" id="cfgd-export"><span class="ic">↓</span><span class="t">Exportar backup deste perfil</span><span class="d">Baixa um .json com tudo: registros, ciclos, cards, leis, trilhas e configurações.</span></button>
          <button type="button" class="cfg-action" id="cfgd-import"><span class="ic">↑</span><span class="t">Importar backup</span><span class="d">Cria sempre um perfil novo. Nenhum perfil existente é alterado ou sobrescrito.</span></button>
        </div>`);
      $('#cfgd-export').addEventListener('click', () => {
        try {
          const id = ProfileManager.getActiveProfileId();
          const meta = (ProfileManager.getProfiles().find(p => p.id === id) || {});
          const backup = ProfileManager.exportProfile(id);
          if (!backup || !Object.keys(backup.data || {}).length) { toast('⚠ Este perfil ainda não tem dados para exportar.'); return; }
          const nome = 'backup-' + (meta.nome || 'perfil').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + todayLocal() + '.json';
          CardsScreen._download(nome, JSON.stringify(backup, null, 2), 'application/json');
          toast('Backup baixado ✓');
        } catch (e) { toast('Não foi possível gerar o backup agora.'); }
      });
      $('#cfgd-import').addEventListener('click', () => { const b = $('#profile-import-btn'); if (b) b.click(); else toast('Abra a tela de perfis para importar um backup.'); });
    },
    buildDiag() {
      this.card('diag', '🩺 Estado do app',
        'Uma fotografia do que está acontecendo agora. Se algo parecer travado, comece por aqui.',
        `<div class="cfg-diag" id="cfg-diag-grid"></div>
         <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
           <button type="button" class="btn-secondary" id="cfgx-copy">⧉ Copiar diagnóstico</button>
           <button type="button" class="btn-secondary" id="cfgx-refresh">↻ Atualizar</button>
         </div>`);
      this.card('diag', '⚠️ Zona de risco',
        'Ações que mexem na sessão ou apagam dados deste aparelho. Todas pedem confirmação.', `
        <div class="cfg-action-grid">
          <button type="button" class="cfg-action" id="cfgx-reconnect"><span class="ic">🔌</span><span class="t">Reconectar a sessão</span><span class="d">Renova o acesso sem precisar digitar a senha de novo. É o primeiro remédio para o estado “Offline”.</span></button>
          <button type="button" class="cfg-action cfg-danger" id="cfgx-out1"><span class="ic">🚪</span><span class="t">Sair só deste dispositivo</span><span class="d">Encerra a sessão aqui. Os outros aparelhos continuam conectados.</span></button>
          <button type="button" class="cfg-action cfg-danger" id="cfgx-outall"><span class="ic">🌐</span><span class="t">Sair de todos os dispositivos</span><span class="d">Derruba todas as sessões da conta. Use se achar que alguém mais tem acesso.</span></button>
          <button type="button" class="cfg-action cfg-danger" id="cfgx-wipe"><span class="ic">🧹</span><span class="t">Limpar dados locais deste perfil</span><span class="d">Apaga a cópia guardada neste navegador e baixa tudo da nuvem de novo. Só com a conta conectada e sincronizada.</span></button>
        </div>`);
      $('#cfgx-refresh').addEventListener('click', () => this.refreshDiag());
      $('#cfgx-copy').addEventListener('click', () => {
        const t = this.diagData().map(d => d.k + ': ' + d.v).join('\n');
        try { navigator.clipboard.writeText(t); toast('Diagnóstico copiado ✓'); } catch (_) { toast('Não foi possível copiar.'); }
      });
      $('#cfgx-reconnect').addEventListener('click', () => CloudUX.reconnect(true));
      $('#cfgx-out1').addEventListener('click', () => CloudUX.logout('local'));
      $('#cfgx-outall').addEventListener('click', () => CloudUX.logout('global'));
      $('#cfgx-wipe').addEventListener('click', () => CloudUX.wipeLocal());
    },
    /* ── O DIAGNÓSTICO RESPONDE UMA PERGUNTA SÓ ───────────────────────────
       "Meus dados estão salvos e sincronizados?" Tudo o mais — revisão local
       do perfil, motor de armazenamento, tempo de inatividade — é vocabulário
       de quem escreveu o app, não de quem o usa, e ocupava a tela inteira
       acima da resposta. Agora o veredito vem primeiro, em uma frase; as
       quatro linhas que o sustentam vêm logo abaixo; e o resto fica a um
       clique, para quando alguém precisar mesmo diagnosticar. */
    diagData() {
      const CS = window.CloudStore;
      const logged = !!(CS && CS.isReady && CS.isReady() && CS.isLoggedIn());
      let rev = '—', pid = '—', nome = '—';
      try { pid = ProfileManager.getActiveProfileId() || '—'; rev = String(ProfileManager.getRev(pid)); nome = (ProfileManager.getProfiles().find(p => p.id === pid) || {}).nome || '—'; } catch (_) { _quiet(_); }
      let nEnt = '—', nCards = '—';
      try { nEnt = String((DB.getEntries() || []).length); } catch (_) { _quiet(_); }
      try { nCards = String((DB.getCards() || []).length); } catch (_) { _quiet(_); }
      let fila = 0;
      try { if (window.SectionSync) fila = SectionSync.pendingQuick(); } catch (_) { _quiet(_); }
      const pend = (CS ? (CS._pending || !!CS._debounce) : false) || fila > 0;
      const last = (CS && CS._lastSyncAt) ? new Date(CS._lastSyncAt).toLocaleString('pt-BR') : 'nesta sessão, ainda não';
      const bkp = (() => {
        if (!window.CloudBackup) return { v: '—', t: '' };
        if (!CloudBackup.enabled) return { v: 'tabela ausente — veja BANCO-DE-DADOS.md', t: 'warn' };
        if (!logged) return { v: 'aguardando a conta', t: 'warn' };
        if (CloudBackup._ultimoErro) return { v: 'erro: ' + CloudBackup._ultimoErro, t: 'warn' };
        const em = CloudBackup.ultimoEnvioEm();
        return em ? { v: 'última cópia ' + new Date(em).toLocaleString('pt-BR'), t: 'ok' }
                  : { v: 'nenhuma cópia ainda', t: 'warn' };
      })();
      return [
        { k: 'Conta', v: logged ? 'conectada · ' + (CS.userEmail() || '') : 'sem conta conectada', t: logged ? 'ok' : 'bad', ess: 1 },
        { k: 'Alterações à espera de envio', v: pend ? (fila ? fila + ' — subindo' : 'sim, subindo') : 'nenhuma', t: pend ? 'warn' : 'ok', ess: 1 },
        { k: 'Última sincronização', v: last, t: '', ess: 1 },
        { k: 'Backup no banco', v: bkp.v, t: bkp.t, ess: 1 },
        { k: 'Perfil ativo', v: nome, t: '' },
        { k: 'Registros de estudo', v: nEnt, t: '' },
        { k: 'Flashcards', v: nCards, t: '' },
        { k: 'Conexão do navegador', v: navigator.onLine ? 'online' : 'offline', t: navigator.onLine ? 'ok' : 'bad' },
        { k: 'Servidor (Supabase)', v: CS ? ({ ready: 'conectado', pending: 'carregando…', missing: 'biblioteca não carregou', error: 'erro ao iniciar' }[CS.libStatus] || CS.libStatus) : '—', t: (CS && CS.libStatus === 'ready') ? 'ok' : 'warn' },
        { k: 'Armazenamento', v: (window.indexedDB ? 'IndexedDB disponível' : 'só localStorage'), t: window.indexedDB ? 'ok' : 'warn' },
        { k: 'Revisão local do perfil', v: rev, t: '' },
        { k: 'Sessão única ao entrar', v: pget('single-session', '0') === '1' ? 'ligada' : 'desligada', t: '' },
        { k: 'Sair por inatividade', v: (() => { const m = parseInt(pget('idle-mins', '0'), 10); return m > 0 ? m + ' min' : 'nunca'; })(), t: '' }
      ];
    },
    // A frase de cima: o que a pessoa veio saber, sem precisar interpretar nada.
    diagVeredito(linhas) {
      const por = (k) => linhas.find(l => l.k === k) || {};
      if (por('Conta').t === 'bad') {
        return { t: 'warn', txt: '⚠️ Sem conta conectada — seus dados estão salvos só neste aparelho. Entre na conta para que eles subam e fiquem protegidos.' };
      }
      if (por('Alterações à espera de envio').t === 'warn') {
        return { t: 'warn', txt: '↻ Já está salvo neste aparelho; algumas alterações ainda estão subindo. Basta deixar o app aberto por alguns instantes.' };
      }
      if (por('Backup no banco').t === 'warn') {
        return { t: 'warn', txt: '⚠️ Sincronizado, mas o backup no banco não está em dia — veja a linha "Backup no banco" abaixo.' };
      }
      return { t: 'ok', txt: '✓ Tudo salvo, sincronizado e com backup no banco.' };
    },
    refreshDiag() {
      const host = $('#cfg-diag-grid');
      if (!host) return;
      const linhas = this.diagData();
      const ver = this.diagVeredito(linhas);
      const item = (d) => `<div class="cfg-diag-item"><div class="k">${esc(d.k)}</div><div class="v ${d.t || ''}">${esc(d.v)}</div></div>`;
      const essenciais = linhas.filter(d => d.ess).map(item).join('');
      const resto = linhas.filter(d => !d.ess).map(item).join('');
      host.innerHTML =
        `<p class="hint ${ver.t === 'ok' ? '' : 'warn'}" style="grid-column:1/-1;margin:0 0 12px;font-weight:700;">${esc(ver.txt)}</p>` +
        essenciais +
        `<details style="grid-column:1/-1;margin-top:10px;"><summary style="cursor:pointer;font-weight:700;">Detalhes técnicos</summary><div class="cfg-diag" style="margin-top:10px;">${resto}</div></details>`;
    }
  };

  /* ═════════════════════════════════════════════════════════════════════════
     8) CONTA E NUVEM — menu suspenso, sessão resiliente, saída em 1 clique
     ═════════════════════════════════════════════════════════════════════════ */
  const CloudUX = {
    _recon: false, _lastAct: Date.now(), _warnEl: null,

    init() {
      const btn = $('#cloud-sync-btn');
      if (btn && !btn._ux47) {
        btn._ux47 = true;
        const ico = $('#csb-ico');
        if (ico && !$('.csb-badge', btn)) {
          const b = document.createElement('span');
          b.className = 'csb-badge'; b.id = 'csb-badge'; b.textContent = '!';
          btn.appendChild(b);
        }
        const clone = btn.cloneNode(true);   // remove o handler antigo (sincronizar direto)
        btn.parentNode.replaceChild(clone, btn);
        clone._ux47 = true;
        clone.addEventListener('click', (e) => this.toggleMenu(e.currentTarget));
        clone.title = 'Conta e sincronização';
      }
      // (Removido) O antigo botão de logout era injetado DENTRO do .profile-chip,
      // que hoje é um <button> — botão dentro de botão é HTML inválido e quebrava o
      // layout do rodapé. A saída da conta agora vive no menu do perfil (clique no nome).
      this.patchStore();
      this.watchSession();
      this.watchIdle();
      setInterval(() => this.refreshBadge(), 5000);
    },

    /* — 8.1 Sessão: escopo de saída correto e recuperação sem senha — */
    patchStore() {
      const CS = window.CloudStore;
      if (!CS || CS._ux47) return;
      CS._ux47 = true;

      // BUG: signOut() do supabase-js v2 tem escopo GLOBAL por padrão — sair num
      // aparelho derrubava a sessão de todos. Aqui a saída normal é local.
      CS.signOut = async function (scope) {
        clearTimeout(this._debounce);
        try { this._unsub(); } catch (_) { _quiet(_); }
        try { await this.client.auth.signOut({ scope: scope || 'local' }); } catch (e) { _quiet(e); }
        this.session = null;
      };

      // Entrar: opção de derrubar as sessões dos outros aparelhos.
      const origIn = CS.signIn.bind(CS);
      CS.signIn = async function (email, pw) {
        const r = await origIn(email, pw);
        if (pget('single-session', '0') === '1') {
          try { await this.client.auth.signOut({ scope: 'others' }); } catch (_) { _quiet(_); }
        }
        return r;
      };

      // Recuperação da sessão sem pedir a senha: é isto que evita o "Offline"
      // travado depois de horas com a aba aberta. O navegador estrangula o
      // autoRefreshToken em abas ocultas; ao voltar, ninguém renovava o token.
      CS.ensureSession = async function (force) {
        if (!this.isReady()) return false;
        try {
          const { data } = await this.client.auth.getSession();
          let s = data && data.session;
          const exp = s && s.expires_at ? (s.expires_at * 1000 - Date.now()) : -1;
          if (!s || force || exp < 120000) {
            try {
              const r = await this.client.auth.refreshSession();
              if (r && r.data && r.data.session) s = r.data.session;
            } catch (_) { _quiet(_); }
          }
          if (s) { this.session = s; this.onAuth(); return true; }
        } catch (_) { _quiet(_); }
        return false;
      };
    },

    async reconnect(loud) {
      const CS = window.CloudStore;
      if (!CS || !CS.isReady()) { toast('Servidor indisponível. Verifique sua internet.'); return false; }
      if (this._recon) return false;
      this._recon = true;
      this.setBtn('recon', 'Reconectando…');
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        ok = await CS.ensureSession(i > 0);
        if (!ok) await new Promise(r => setTimeout(r, 700 * (i + 1)));
      }
      this._recon = false;
      if (ok) {
        try { await CS.syncOnFocus(); } catch (_) { _quiet(_); }
        if (loud) toast('Sessão reconectada ✓');
      } else {
        this.setBtn('error', 'Sessão expirada');
        if (loud) toast('Não deu para renovar a sessão. Entre com sua senha no menu ☁.');
        this.openMenu($('#cloud-sync-btn'), true);
      }
      this.refreshBadge();
      return ok;
    },

    watchSession() {
      const CS = window.CloudStore;
      if (!CS) return;
      const check = () => {
        if (document.visibilityState !== 'visible') return;
        if (!CS.isReady()) return;
        if (!CS.isLoggedIn()) { this.reconnect(false); return; }
        CS.ensureSession(false);
      };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(check, 250); });
      window.addEventListener('focus', () => setTimeout(check, 250));
      window.addEventListener('online', () => setTimeout(() => this.reconnect(false), 400));
      setInterval(check, 240000);                       // pulso de 4 min com a aba visível
      setTimeout(check, 3000);
      // login/logout feito em outra aba do mesmo navegador
      window.addEventListener('storage', (e) => {
        if (e && e.key && /supabase|sb-/i.test(e.key)) setTimeout(check, 500);
      });
    },

    /* — 8.2 Saída por inatividade (opcional, com aviso antes) — */
    watchIdle() {
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
        window.addEventListener(ev, () => { this._lastAct = Date.now(); this.dismissWarn(); }, { passive: true, capture: true }));
      setInterval(() => {
        const mins = parseInt(pget('idle-mins', '0'), 10);
        if (!mins) return;
        const CS = window.CloudStore;
        if (!CS || !CS.isLoggedIn()) return;
        const idle = (Date.now() - this._lastAct) / 60000;
        if (idle >= mins && !this._warnEl) this.showWarn();
      }, 20000);
    },
    showWarn() {
      const el = document.createElement('div');
      el.className = 'idle-warn';
      el.innerHTML = `<p>Você está inativo há um tempo. Por segurança, vou encerrar a sessão neste dispositivo em <b id="idle-cd">60</b>s.</p>
        <div class="row"><button type="button" class="btn-secondary" id="idle-stay">Continuar conectado</button><button type="button" class="btn-primary" id="idle-now">Sair agora</button></div>`;
      document.body.appendChild(el);
      this._warnEl = el;
      let n = 60;
      const t = setInterval(() => {
        n--; const c = $('#idle-cd'); if (c) c.textContent = String(n);
        if (n <= 0) { clearInterval(t); this.dismissWarn(); this.logout('local', true); }
      }, 1000);
      el._t = t;
      $('#idle-stay', el).addEventListener('click', () => { this._lastAct = Date.now(); this.dismissWarn(); });
      $('#idle-now', el).addEventListener('click', () => { this.dismissWarn(); this.logout('local', true); });
    },
    dismissWarn() {
      if (this._warnEl) { clearInterval(this._warnEl._t); this._warnEl.remove(); this._warnEl = null; }
    },

    /* — 8.3 Saída e limpeza — */
    async logout(scope, silent) {
      const CS = window.CloudStore;
      if (!CS || !CS.isLoggedIn()) { toast('Você já não está conectado.'); return; }
      if (!silent) {
        const ok = await UI.confirm(
          scope === 'global'
            ? 'Encerrar a sessão em TODOS os dispositivos?\n\nVocê precisará entrar de novo em cada aparelho. Seus dados continuam salvos na nuvem.'
            : 'Sair da conta neste dispositivo?\n\nO que estiver pendente é enviado antes. Seus outros aparelhos continuam conectados.',
          { title: scope === 'global' ? '🌐 Sair de todos' : '🚪 Sair da conta', okText: 'Sair', danger: true });
        if (!ok) return;
      }
      closePop(); this.closeMenu();
      try { await CS.flushPending(); } catch (_) { _quiet(_); }
      try { await CS.signOut(scope || 'local'); } catch (_) { _quiet(_); }
      try { sessionStorage.removeItem('diario-estudos:entered'); } catch (_) { _quiet(_); }
      toast('Sessão encerrada ✓');
      setTimeout(() => recarregarApp('saída da conta', { imediato: true }), 500);
    },
    async wipeLocal() {
      const CS = window.CloudStore;
      if (!CS || !CS.isLoggedIn()) { toast('Conecte a conta antes: sem nuvem, apagar o local apaga tudo.'); return; }
      let fila = 0;
      try { if (window.SectionSync) fila = SectionSync.pendingQuick(); } catch (_) { _quiet(_); }
      if (CS._pending || CS._debounce || fila) { toast('Há alterações não enviadas. Sincronize antes de limpar.'); return; }
      const ok1 = await UI.confirm('Apagar a cópia local deste perfil e baixar tudo da nuvem de novo?\n\nUse quando este aparelho parecer dessincronizado. Uma versão de segurança é guardada antes.',
        { title: '🧹 Limpar dados locais', okText: 'Continuar', danger: true });
      if (!ok1) return;
      const ok2 = await UI.confirmTyped('Confirmação final.\n\nTudo que existir SÓ neste navegador e ainda não tiver subido será perdido.',
        { word: 'LIMPAR', title: '🧹 Tem certeza?', okText: 'Apagar e rebaixar' });
      if (!ok2) return;
      try {
        if (window.VersionHistory) await VersionHistory.snapshot('antes de limpar dados locais');
        /* Esta é a única ação do app que apaga dados de propósito. A foto local
           acima some junto se o navegador for limpo depois; a do banco, não. */
        if (window.CloudBackup) await CloudBackup.protegerAgora('antes de limpar os dados locais');
        const id = ProfileManager.getActiveProfileId();
        const pfx = 'diario-estudos:u:' + id + ':';
        const del = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(pfx) === 0) del.push(k); }
        del.forEach(k => { try { localStorage.removeItem(k); } catch (_) { _quiet(_); } });
        ProfileManager.setRev(id, 0);
        toast('Baixando da nuvem…');
        await CS.pullActiveAndReload();
      } catch (e) { toast('Não foi possível concluir a limpeza.'); }
    },

    /* — 8.4 Menu — */
    _menu: null, _scrim: null,
    toggleMenu(btn) { if (this._menu) this.closeMenu(); else this.openMenu(btn); },
    closeMenu() {
      if (this._menu) { this._menu.remove(); this._menu = null; }
      if (this._scrim) { this._scrim.remove(); this._scrim = null; }
    },
    state() {
      const CS = window.CloudStore;
      // Mensagens calmas: os dados estão SEMPRE salvos no aparelho; a nuvem é um
      // reforço automático. Nada aqui deve soar como risco de perda.
      if (!CS || !CS.isReady()) return { tone: 'ok', title: 'Salvo neste aparelho', sub: 'A nuvem conecta automaticamente quando disponível.' };
      if (!CS.isLoggedIn()) return { tone: 'ok', title: 'Salvo neste aparelho', sub: 'Entre na sua conta para sincronizar entre aparelhos.' };
      if (this._recon) return { tone: 'syncing', title: 'Reconectando…', sub: 'Renovando o acesso sem pedir a senha.' };
      let fila = 0;
      try { if (window.SectionSync) fila = SectionSync.pendingQuick(); } catch (_) { _quiet(_); }
      if (window.SessionLock && SessionLock.isBlocked() && SessionLock._origin === 'remote') {
        return { tone: 'syncing', title: 'Envio pausado', sub: fila
          ? (fila + (fila === 1 ? ' alteração está guardada' : ' alterações estão guardadas') + ' e sobe quando a sessão voltar para cá.')
          : 'A sessão está em outro aparelho. Nada foi perdido.' };
      }
      if (CS._syncing || CS._pending || CS._debounce || fila) {
        return { tone: 'syncing', title: 'Salvando…', sub: fila
          ? ('Já está salvo no aparelho; ' + fila + (fila === 1 ? ' alteração na fila' : ' alterações na fila') + ' para a nuvem.')
          : 'Já está salvo no aparelho; enviando para a nuvem.' };
      }
      const t = CS._lastSyncAt ? (window.CloudUI ? CloudUI._timeAgo(CS._lastSyncAt) : '') : '';
      return { tone: 'ok', title: 'Tudo sincronizado', sub: t ? ('Último envio ' + t + '.') : 'Seus dados estão salvos e sincronizados.' };
    },
    openMenu(btn, forceRelogin) {
      this.closeMenu();
      if (!btn) btn = $('#cloud-sync-btn');
      if (!btn) return;
      const CS = window.CloudStore;
      const st = this.state();
      const logged = !!(CS && CS.isReady() && CS.isLoggedIn());
      const mail = logged ? (CS.userEmail() || '—') : null;
      const idle = pget('idle-mins', '0');
      const needsRelogin = forceRelogin || (CS && CS.isReady() && !CS.isLoggedIn());
      this._scrim = document.createElement('div');
      this._scrim.className = 'cloud-scrim';
      this._scrim.addEventListener('click', () => this.closeMenu());
      document.body.appendChild(this._scrim);
      const m = document.createElement('div');
      m.className = 'cloud-menu st-' + st.tone;
      m.innerHTML = `
        <div class="cloud-menu-head">
          <div class="cloud-menu-state"><span class="cloud-menu-dot"></span>
            <div><div class="cloud-menu-title">${esc(st.title)}</div><div class="cloud-menu-sub">${esc(st.sub)}</div></div></div>
          ${mail ? `<div class="cloud-menu-mail">👤 <b>${esc(mail)}</b></div>` : ''}
        </div>
        <div class="cloud-menu-body">
          <div class="cloud-menu-sec">Sincronização</div>
          <button type="button" class="cloud-menu-item" data-a="sync" ${logged ? '' : 'disabled'}><span class="ic">⟳</span><span class="tx">Sincronizar agora<small>Envia o que está pendente e baixa novidades.</small></span></button>
          <button type="button" class="cloud-menu-item" data-a="push" ${logged ? '' : 'disabled'}><span class="ic">↑</span><span class="tx">Forçar envio deste dispositivo<small>Este aparelho passa a valer como a versão mais recente.</small></span></button>
          <button type="button" class="cloud-menu-item" data-a="pull" ${logged ? '' : 'disabled'}><span class="ic">↓</span><span class="tx">Baixar da nuvem<small>Guarda uma versão de segurança antes de sobrescrever.</small></span></button>
          <button type="button" class="cloud-menu-item" data-a="recon"><span class="ic">🔌</span><span class="tx">Reconectar sessão<small>Renova o acesso sem digitar a senha.</small></span></button>
          <button type="button" class="cloud-menu-item" data-a="cache"><span class="ic">🔄</span><span class="tx">Atualizar o app (limpar cache)<small>Use se o app parecer travado numa versão antiga ou o login falhar sem motivo. Não apaga nenhum dado de estudo.</small></span></button>
          <div class="cloud-menu-sep"></div>
          <div class="cloud-menu-sec">Segurança da conta</div>
          <div class="cloud-menu-toggle"><div class="tx">Sessão única<small>Ao entrar, derruba a sessão dos outros aparelhos.</small></div>
            <button type="button" class="toggle-switch ${pget('single-session', '0') === '1' ? 'on' : ''}" data-a="single" role="switch"></button></div>
          <div class="cloud-menu-sel"><label>Sair por inatividade</label>
            <select data-a="idle">
              <option value="0"${idle === '0' ? ' selected' : ''}>Nunca (recomendado)</option>
              <option value="30"${idle === '30' ? ' selected' : ''}>Após 30 minutos</option>
              <option value="60"${idle === '60' ? ' selected' : ''}>Após 1 hora</option>
              <option value="240"${idle === '240' ? ' selected' : ''}>Após 4 horas</option>
              <option value="720"${idle === '720' ? ' selected' : ''}>Após 12 horas</option>
            </select></div>
          <div class="cloud-menu-sep"></div>
          <button type="button" class="cloud-menu-item" data-a="cfg"><span class="ic">⚙</span><span class="tx">Abrir Configurações da conta<small>Espaços na nuvem, diagnóstico e backups.</small></span></button>
          <button type="button" class="cloud-menu-item danger" data-a="out1" ${logged ? '' : 'disabled'}><span class="ic">🚪</span><span class="tx">Sair deste dispositivo</span></button>
          <button type="button" class="cloud-menu-item danger" data-a="outall" ${logged ? '' : 'disabled'}><span class="ic">🌐</span><span class="tx">Sair de todos os dispositivos</span></button>
        </div>
        ${needsRelogin ? `<div class="cloud-menu-relogin">
          <p>A sessão não pôde ser renovada. Entre de novo — nada foi perdido, seus dados continuam neste dispositivo.</p>
          <input type="email" id="cmr-mail" placeholder="voce@email.com" autocomplete="email" value="${esc(pget('last-mail', ''))}">
          <input type="password" id="cmr-pass" placeholder="Senha" autocomplete="current-password">
          <button type="button" class="btn-primary" data-a="relogin" style="width:100%">Entrar novamente</button>
          <button type="button" class="cloud-menu-item" data-a="forgot" style="justify-content:center;margin-top:6px;font-size:var(--fs-2xs);"><span class="tx">Esqueci minha senha</span></button>
        </div>` : ''}
        <div class="cloud-menu-foot">O envio é automático. Este menu existe para as horas em que você quer certeza — ou quer encerrar a sessão.</div>`;
      document.body.appendChild(m);
      this._menu = m;
      const r = btn.getBoundingClientRect();
      const w = m.offsetWidth, h = m.offsetHeight;
      let left = Math.min(Math.max(10, r.left), window.innerWidth - w - 10);
      let top = r.bottom + 8;
      if (top + h > window.innerHeight - 10) top = Math.max(10, window.innerHeight - h - 10);
      m.style.left = left + 'px'; m.style.top = top + 'px';
      m.addEventListener('click', (e) => e.stopPropagation());
      m.querySelectorAll('[data-a]').forEach(el => {
        const a = el.dataset.a;
        if (el.tagName === 'SELECT') { el.addEventListener('change', () => { pset('idle-mins', el.value); this._lastAct = Date.now(); toast(el.value === '0' ? 'Saída automática desligada' : 'Saída automática em ' + el.value + ' min'); }); return; }
        el.addEventListener('click', async () => {
          if (a === 'single') { const on = el.classList.toggle('on'); pset('single-session', on ? '1' : '0'); toast(on ? 'Sessão única ligada' : 'Sessão única desligada'); return; }
          if (a === 'idle') return;
          if (a === 'relogin') { await this.relogin(m); return; }
          if (a === 'forgot') { this.closeMenu(); const f = $('#gate-forgot-btn'); if (f) f.click(); else toast('Use “Esqueci minha senha” na tela de acesso.'); return; }
          this.closeMenu();
          if (a === 'sync') { try { await CS.syncNow(); } catch (_) { _quiet(_); } }
          else if (a === 'push') { try { CS._forceBlob = true; CS._pending = true; await CS.flushPending(); toast('Enviado ✓'); } catch (_) { toast('Não foi possível enviar agora.'); } }
          else if (a === 'pull') { try { await CS.pullActiveAndReload(); } catch (_) { _quiet(_); } }
          else if (a === 'recon') { await this.reconnect(true); }
          else if (a === 'cache') { await this.repararCache(); }
          else if (a === 'cfg') { try { switchScreen('config'); } catch (_) { _quiet(_); } setTimeout(() => ConfigUX.show('conta'), 60); }
          else if (a === 'out1') { this.logout('local'); }
          else if (a === 'outall') { this.logout('global'); }
          this.refreshBadge();
        });
      });
      if (needsRelogin) setTimeout(() => { const f = $('#cmr-mail', m); if (f) f.focus(); }, 60);
    },
    async relogin(m) {
      const mail = ($('#cmr-mail', m) || {}).value || '';
      const pass = ($('#cmr-pass', m) || {}).value || '';
      if (!mail.trim() || pass.length < 6) { toast('Informe e-mail e senha (mín. 6 caracteres).'); return; }
      try {
        await CloudStore.signIn(mail.trim(), pass);
        pset('last-mail', mail.trim());
        this.closeMenu();
        toast('Reconectado ✓');
        try { await CloudStore.syncOnFocus(); } catch (_) { _quiet(_); }
        this.refreshBadge();
      } catch (err) { toast(err && err.message ? err.message : 'Não foi possível entrar.'); }
    },
    /* Versão antiga presa no cache do navegador é a causa clássica de "o app não
       atualiza" e de login que falha sem explicação: o worker antigo continua
       servindo o index.html antigo. Isto apaga os caches e os workers e recarrega
       — os dados de estudo vivem no IndexedDB e não são tocados. Antes de tudo,
       envia o que estiver pendente, para não recarregar por cima de uma fila. */
    async repararCache() {
      const ok = await UI.confirm('Baixar de novo a versão mais recente do app?\n\nO cache do navegador é limpo e a página recarrega. Nenhum dado de estudo é apagado — o que estiver pendente é enviado antes.',
        { title: '🔄 Atualizar o app', okText: 'Atualizar agora' });
      if (!ok) return;
      toast('Atualizando…');
      try { const CS = window.CloudStore; if (CS && CS.isLoggedIn()) await CS.flushPending(); } catch (_) { _quiet(_); }
      if (window.__repararCache) { try { await window.__repararCache(); return; } catch (_) { _quiet(_); } }
      recarregarApp('reparo de cache', { imediato: true });
    },
    setBtn(tone, text) { try { if (window.CloudUI) CloudUI.refreshSyncBtn(tone, text); } catch (_) { _quiet(_); } },
    refreshBadge() {
      const CS = window.CloudStore;
      const btn = $('#cloud-sync-btn');
      if (!btn || !CS) return;
      let fila = 0;
      try { if (window.SectionSync) fila = SectionSync.pendingQuick(); } catch (_) { _quiet(_); }
      const pend = !!(CS.isLoggedIn() && (CS._pending || CS._debounce || fila));
      btn.classList.toggle('has-pend', pend);
      if (this._recon) btn.classList.add('st-recon');
    }
  };

  /* ═════════════════════════════════════════════════════════════════════════
     INICIALIZAÇÃO
     ═════════════════════════════════════════════════════════════════════════ */
  function boot() {
    const step = (name, fn) => { try { fn(); } catch (e) { console.warn('UX47 ' + name, e); } };
    step('registrar', () => RegistrarUX.init());
    step('grade', () => GradeUX.init());
    step('estudonovo', () => EstudoNovoUX.init());
    step('historico', () => HistoricoUX.init());
    step('evolucao', () => EvolucaoUX.init());
    step('tec', () => TecUX.init());
    step('config', () => ConfigUX.init());
    step('cloud', () => CloudUX.init());
    window.addEventListener('resize', () => { closePop(); CloudUX.closeMenu(); GradeUX.apply(); });
    window.addEventListener('screen:activated', (e) => {
      const s = e.detail && e.detail.screen;
      if (s === 'grade') setTimeout(() => GradeUX.apply(), 40);
      if (s === 'evolucao') setTimeout(() => EvolucaoUX.after(), 60);
      if (s === 'desempenhotec') setTimeout(() => TecUX.init(), 60);
      if (s === 'estudonovo') setTimeout(() => { try { EstudoNovoUX.afterTrack(); } catch (_) { _quiet(_); } }, 60);
      if (s === 'historico') setTimeout(() => HistoricoUX.decorate(), 40);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 0));
  else setTimeout(boot, 0);
})();
