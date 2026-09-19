/* ============================================================
   SAVEGUARD — só confirma depois do PostgreSQL
   ------------------------------------------------------------
   A projeção síncrona em RAM existe para manter as telas rápidas, mas não é
   persistência. SaveGuard executa a mutação, valida a projeção e espera a fila
   relacional terminar. Se o banco não confirmar, reidrata o perfil canônico.
   ============================================================ */
const SaveGuard = {
  CLOUD_TIMEOUT_MS: 12000,
  MIN_BUSY_MS: 400,

  async _aguardaNuvem(ms) {
    if (!window.CloudStore || !CloudStore.isReady() || !CloudStore.isLoggedIn() ||
        !window.RelationalStore) {
      return { enviado: false, motivo: 'sem-banco' };
    }
    if (window.SessionLock && SessionLock.isBlocked && SessionLock.isBlocked()) {
      return { enviado: false, motivo: 'sessao-em-outro-aparelho' };
    }

    const limite = Math.max(1000, Number(ms) || this.CLOUD_TIMEOUT_MS);
    let timer = null;
    try {
      await Promise.race([
        RelationalStore.flush(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout-sql')), limite);
        })
      ]);
      if (RelationalStore.pendingCount() === 0 && !RelationalStore._lastError) {
        return { enviado: true, motivo: '' };
      }
      return { enviado: false, motivo: 'pendente' };
    } catch (e) {
      return {
        enviado: false,
        motivo: (e && e.message === 'timeout-sql') ? 'tempo-esgotado' : 'erro-banco',
        erro: e
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  async run(opts) {
    opts = opts || {};
    const t0 = Date.now();
    const comPiso = async (r) => {
      const falta = this.MIN_BUSY_MS - (Date.now() - t0);
      if (falta > 0) await new Promise(res => setTimeout(res, falta));
      return r;
    };

    let retorno;
    try { retorno = await opts.escrever(); }
    catch (e) {
      console.error('SaveGuard.escrever', e);
      retorno = false;
    }
    if (retorno === false || retorno === null) {
      return comPiso({ ok: false, local: false, cloud: false, motivo: 'escrita-recusada' });
    }

    /* A releitura abaixo detecta bug da projeção. Não é prova de persistência:
       essa prova vem exclusivamente do flush SQL. */
    if (typeof opts.verificar === 'function') {
      let confere = false;
      try { confere = !!opts.verificar(); }
      catch (e) { console.error('SaveGuard.verificar', e); }
      if (!confere) {
        return comPiso({ ok: false, local: false, cloud: false, motivo: 'projecao-invalida' });
      }
    }

    if (opts.nuvem === false) {
      return comPiso({ ok: true, local: true, cloud: false, motivo: 'memoria-apenas' });
    }

    const r = await this._aguardaNuvem(opts.timeout);
    if (!r.enviado) {
      try {
        const pid = window.ProfileManager && ProfileManager.getActiveProfileId
          ? ProfileManager.getActiveProfileId() : null;
        if (pid && window.RelationalStore) {
          await RelationalStore.hydrateProfile(pid, { reason: 'rollback-after-write-failure' });
        }
      } catch (e) { _quiet(e, 'saveguard-rollback'); }
      return comPiso({
        ok: false, local: false, cloud: false,
        motivo: r.motivo || 'erro-banco'
      });
    }

    return comPiso({ ok: true, local: false, cloud: true, motivo: '' });
  },

  ocupar(btn, texto) {
    if (!btn) return () => {};
    const rotuloOriginal = btn.innerHTML;
    const larguraOriginal = btn.style.minWidth;
    try { btn.style.minWidth = btn.getBoundingClientRect().width + 'px'; }
    catch (e) { _quiet(e, 'saveguard-largura'); }
    btn.disabled = true;
    btn.classList.add('is-saving');
    btn.innerHTML = '<span class="sg-spin" aria-hidden="true"></span><span>' +
      escapeHtml(texto || 'Salvando…') + '</span>';
    return () => {
      btn.disabled = false;
      btn.classList.remove('is-saving');
      btn.innerHTML = rotuloOriginal;
      btn.style.minWidth = larguraOriginal;
    };
  },

  toast(res, okTexto) {
    if (!res || !res.ok) {
      const msg = res && res.motivo === 'tempo-esgotado'
        ? '⚠ O banco não confirmou a operação a tempo. A tela voltou ao último estado confirmado.'
        : '⚠ O banco não confirmou a operação. Nada foi considerado salvo.';
      showToast(msg);
      return;
    }
    if (res.cloud) {
      showToast((okTexto || 'Salvo') + ' — confirmado no banco ✓');
      return;
    }
    showToast(okTexto || 'Alteração temporária');
  }
};
window.SaveGuard = SaveGuard;

// ---- Metas/limiares de aproveitamento (editáveis pelo usuário) ----
// good = verde a partir de METAS.bom; warn entre METAS.atencao e METAS.bom; bad abaixo.
// METAS.linhas = linhas de referência exibidas nos gráficos (ex.: 70/80/85).
/* ── METAS: configuração do usuário precisa pertencer ao perfil ────────────
   Esta chave já foi global e, por isso, não acompanhava o usuário entre
   aparelhos. Hoje ela fica no namespace do perfil e segue pelo RelationalStore
   para o PostgreSQL. A memória local é apenas projeção; o banco é a fonte de
   verdade.

   As três coisas corrigidas, no mesmo padrão de CardsConfig: chave namespaced,
   escrita por DB._set (que avisa a nuvem e marca a seção) e cache amarrado à
   chave que o originou — troca de perfil ou chegada de dado novo o descarta. */
const AppSettings = {
  LEGACY_KEY: 'diario-estudos:metas',
  _pfx() { try { return DB._profilePrefix(); } catch (_) { return 'diario-estudos:'; } },
  get KEY() { return this._pfx() + 'metas'; },
  _cache: null,
  _cacheKey: null,
  DEFAULTS: { atencao: 50, bom: 70, linhas: [70, 80, 85] },
  get() {
    const k = this.KEY;
    if (this._cache && this._cacheKey === k) return this._cache;
    let v = null;
    try { v = JSON.parse(localStorage.getItem(k)); } catch (_) { _quiet(_); }
    // migração única: o valor global antigo passa a viver dentro do perfil
    if (v == null && k !== this.LEGACY_KEY) {
      try {
        const antigo = JSON.parse(localStorage.getItem(this.LEGACY_KEY));
        if (antigo != null) { v = antigo; DB._set(k, antigo); }
      } catch (_) { _quiet(_); }
    }
    this._cacheKey = k;
    this._cache = Object.assign({}, this.DEFAULTS, v || {});
    if (!Array.isArray(this._cache.linhas) || !this._cache.linhas.length) this._cache.linhas = this.DEFAULTS.linhas.slice();
    return this._cache;
  },
  set(patch) {
    const v = Object.assign(this.get(), patch || {});
    const k = this.KEY;
    this._cache = v; this._cacheKey = k;
    DB._set(k, v);   // grava, avisa a nuvem e marca a seção
  },
  // chamado quando o perfil muda ou a nuvem aplica dados novos
  invalidar() { this._cache = null; this._cacheKey = null; }
};
function toneFor(pct) {
  const m = AppSettings.get();
  if (pct >= m.bom) return 'good';
  if (pct >= m.atencao) return 'warn';
  return 'bad';
}
// linhas de referência (metas) para os gráficos, com cores fixas por posição
function metaRefs() {
  const cores = ['#0f9d63', '#d97a12', '#7c3aed', '#2563eb'];
  return AppSettings.get().linhas.slice().sort((a, b) => a - b).map((v, i) => ({ v, color: cores[i % cores.length] }));
}

function calcPct(correct, total) {
  // percentual com 2 casas decimais, sem arredondamento agressivo
  if (!total || total <= 0) return null;
  return Math.round((correct / total) * 10000) / 100;
}

/* Percentual na notacao do app: virgula decimal (pt-BR) e sem casas inuteis.
   Antes esta funcao devolvia "67.36" com PONTO, enquanto o Ciclo, a Grade e o
   Relatorio ja escreviam "67,36" — a mesma metrica aparecia com dois formatos
   conforme a tela. Agora ha UMA notacao para todo o app.
   As duas casas so aparecem quando dizem algo: 100% continua "100", 67,36%
   nao vira "67". Evita a falsa precisao ("100,00%") e a perda de informacao. */
function formatPct(pct) {
  if (pct === null || pct === undefined || !isFinite(pct)) return '—';
  const r = Math.round(pct * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',');
}

/* Medalha por faixa de aproveitamento — o olho encontra a linha boa antes de
   ler o numero. As faixas nao se sobrepoem: cada percentual cai em uma so.
     >= 90 .......... 👽  (fora da curva)
     85 a 89,99 ..... 🥇
     80 a 84,99 ..... 🥈
     75 a 79,99 ..... 🥉
   Abaixo de 75 nao ha medalha — premiar tudo tiraria o sentido de premiar. */
function medalFor(pct) {
  if (pct == null) return null;
  if (pct >= 90) return { emoji: '👽', titulo: 'Fora da curva — 90% ou mais' };
  if (pct >= 85) return { emoji: '🥇', titulo: 'Ouro — de 85% a 89,99%' };
  if (pct >= 80) return { emoji: '🥈', titulo: 'Prata — de 80% a 84,99%' };
  if (pct >= 75) return { emoji: '🥉', titulo: 'Bronze — de 75% a 79,99%' };
  return null;
}
function medalHtml(pct) {
  const m = medalFor(pct);
  return m ? `<span class="reg-medal" title="${m.titulo}" aria-label="${m.titulo}">${m.emoji}</span>` : '';
}

// Escape por substituição direta: ~25x mais rápido que criar um nó DOM a cada chamada,
// o que importa nas listas que renderizam centenas de itens.
const _ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, ch => _ESC_MAP[ch]);
}

// Atalho tolerante para o saneamento de cards (definido junto do editor rico).
// O try/catch existe só para o caso de ser chamado antes do script terminar de
// carregar: nesse cenário nada é perdido, apenas não se sanea naquele instante.
function _sanCard(html) {
  const s = html == null ? '' : String(html);
  try { return sanitizeCardHtml(s); } catch (_) { return s; }
}

function formatDateShort(iso) {
  // defensivo: datas ausentes/malformadas (ciclos legados, importações) não podem
  // derrubar a renderização inteira da tela. Devolve '—' em vez de estourar.
  if (!iso || typeof iso !== 'string' || iso.indexOf('-') === -1) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}`;
}
// Badge de avanço material de uma sessão: min de vídeo assistido OU nº de páginas lidas.
// Aparece no histórico (Registrar e semanas) para dar contexto do que foi feito na sessão.
function progressBadgeHtml(e) {
  if (e && e.videoStart != null && e.videoEnd != null && e.videoEnd >= e.videoStart) {
    const min = Math.round((e.videoEnd - e.videoStart) * 10) / 10;
    if (min > 0) return `<span class="meta-badge badge-progress">🎬 ${min.toLocaleString('pt-BR')} min de vídeo</span>`;
  }
  if (e && e.pageStart != null && e.pageEnd != null && e.pageEnd >= e.pageStart) {
    const p = e.pageEnd - e.pageStart + 1;
    if (p > 0) return `<span class="meta-badge badge-progress">📖 ${p.toLocaleString('pt-BR')} pág.</span>`;
  }
  return '';
}

// Data de HOJE no fuso local (evita o desvio de 1 dia que o toISOString/UTC causa à noite)
/* ── VIRADA DO DIA PARA OS CARDS (rollover) ────────────────────────────────
   O Anki NAO vira o dia a meia-noite: o padrao e 4h da manha
   (rslib/src/scheduler/mod.rs -> set_v2_rollover(4)). Quem estuda ate 1h da
   madrugada continua "no dia de ontem": o limite diario nao reinicia e voce
   termina o dia que comecou. Com virada a meia-noite, um lote novo de cards
   aparecia do nada no meio da sessao.

   Esta funcao vale SO para o agendamento de cards. O diario de estudos, ciclos
   e demais telas continuam usando todayLocal() (data de calendario), que e o
   que faz sentido para um registro do dia. */
function cardsRolloverHour() {
  try {
    const h = (window.CardsConfig && CardsConfig.get) ? CardsConfig.get().rolloverHour : 4;
    return (Number.isFinite(h) && h >= 0 && h <= 23) ? Math.floor(h) : 4;
  } catch (_) { return 4; }
}
function todayCards() {
  const d = new Date();
  if (d.getHours() < cardsRolloverHour()) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Instante da PROXIMA virada — usado para reprogramar a tela sozinha.
function proximaViradaTs() {
  const h = cardsRolloverHour(), d = new Date();
  const alvo = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
  if (alvo.getTime() <= d.getTime()) alvo.setDate(alvo.getDate() + 1);
  return alvo.getTime();
}
window.todayCards = todayCards;

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
