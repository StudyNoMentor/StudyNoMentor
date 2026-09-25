/* ============================================================
   EXTRAS — rodízio inteligente de lei seca
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__leiRodizioExtras) return;
  if (typeof window !== 'undefined') window.__leiRodizioExtras = true;

  /* Lei seca é independente do Motor de sugestão: agenda apenas leitura. */
  const LeiRodizio = {
    KEY_PREF: 'lei-rodizio-prefs-v1',
    DEFAULTS: {
      ativo: true,
      porDia: 1,
      linhasSessao: 30,
      alternarMaterias: true,
      ordem: 'circular',
      dias: [0, 1, 2, 3, 4, 5, 6],
      aoFinal: 'pausar'
    },

    _prefKey() {
      try { return DB.planSettingRaw ? DB.planSettingRaw(this.KEY_PREF).key : DB.planSettingKey(this.KEY_PREF); }
      catch (_) { return DB._profilePrefix() + 'p:' + DB._activePlanId() + ':' + this.KEY_PREF; }
    },
    prefs() {
      let raw = {};
      try { raw = JSON.parse(localStorage.getItem(this._prefKey()) || '{}') || {}; }
      catch (_) { raw = {}; }
      const dias = Array.isArray(raw.dias) ? [...new Set(raw.dias.map(Number).filter(n => n >= 0 && n <= 6))] : this.DEFAULTS.dias.slice();
      return {
        ativo: raw.ativo !== false,
        porDia: Math.max(1, Math.min(5, Math.round(Number(raw.porDia) || this.DEFAULTS.porDia))),
        linhasSessao: Math.max(5, Math.min(300, Math.round(Number(raw.linhasSessao) || this.DEFAULTS.linhasSessao))),
        alternarMaterias: raw.alternarMaterias !== false,
        ordem: raw.ordem === 'prioridade' ? 'prioridade' : 'circular',
        dias: dias.length ? dias.sort((a, b) => a - b) : this.DEFAULTS.dias.slice(),
        aoFinal: raw.aoFinal === 'reiniciar' ? 'reiniciar' : 'pausar'
      };
    },
    salvarPrefs(patch) {
      const p = Object.assign({}, this.prefs(), patch || {});
      const saneado = Object.assign({}, this.DEFAULTS, p, {
        porDia: Math.max(1, Math.min(5, Math.round(Number(p.porDia) || 1))),
        linhasSessao: Math.max(5, Math.min(300, Math.round(Number(p.linhasSessao) || 30))),
        ordem: p.ordem === 'prioridade' ? 'prioridade' : 'circular',
        aoFinal: p.aoFinal === 'reiniciar' ? 'reiniciar' : 'pausar',
        dias: Array.isArray(p.dias) && p.dias.length ? [...new Set(p.dias.map(Number).filter(n => n >= 0 && n <= 6))].sort((a, b) => a - b) : this.DEFAULTS.dias.slice()
      });
      try {
        if (typeof DB.setRaw === 'function') DB.setRaw(this._prefKey(), JSON.stringify(saneado));
        else localStorage.setItem(this._prefKey(), JSON.stringify(saneado));
      } catch (e) { _quiet(e, 'lei-rodizio-prefs'); }
      this.sincronizarHoje();
      return saneado;
    },
    cfgLei(lei) {
      const r = (lei && lei.rodizio) || {};
      const ls = Number(r.linhasSessao);
      return {
        apta: !!r.apta,
        prioridade: Math.max(1, Math.min(5, Math.round(Number(r.prioridade) || 3))),
        linhasSessao: Number.isFinite(ls) && ls > 0 ? Math.max(5, Math.min(300, Math.round(ls))) : null,
        aoFinal: ['padrao', 'pausar', 'reiniciar'].includes(r.aoFinal) ? r.aoFinal : 'padrao',
        ultimaConclusao: r.ultimaConclusao || '',
        ultimaGeracao: r.ultimaGeracao || '',
        ultimaPulada: r.ultimaPulada || '',
        sessoes: Math.max(0, Number(r.sessoes) || 0),
        linhasLidas: Math.max(0, Number(r.linhasLidas) || 0)
      };
    },
    salvarCfgLei(id, patch) {
      const lei = DB.getLei(id);
      if (!lei) return null;
      const atual = this.cfgLei(lei);
      const prox = Object.assign({}, atual, patch || {});
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'linhasSessao')) {
        const n = Number(patch.linhasSessao);
        prox.linhasSessao = Number.isFinite(n) && n > 0 ? Math.max(5, Math.min(300, Math.round(n))) : null;
      }
      prox.prioridade = Math.max(1, Math.min(5, Math.round(Number(prox.prioridade) || 3)));
      prox.aoFinal = ['padrao', 'pausar', 'reiniciar'].includes(prox.aoFinal) ? prox.aoFinal : 'padrao';
      DB.updateLei(id, { rodizio: prox });
      this.sincronizarHoje();
      return prox;
    },
    eExtra(e) { return !!(e && e.origemLei && e.origemLei.rodizio && e.origemLei.leiId); },
    _diaPermitido(dia, p) {
      // Dia congelado pela pausa do planejamento não recebe sessão de lei seca.
      try { if (typeof PlanManager !== 'undefined' && PlanManager.isDayPaused && PlanManager.isDayPaused(dia)) return false; }
      catch (_) { if (typeof _quiet === 'function') _quiet(_, '56-leis-rodizio'); }
      const d = new Date(String(dia) + 'T00:00:00');
      return (p.dias || []).includes(d.getDay());
    },
    _linhas(lei) {
      try { return LawEngine.lines(lei && lei.texto || ''); }
      catch (_) { return String(lei && lei.texto || '').split(/\r?\n/).filter(x => x.trim()); }
    },
    _bookmark(lei) {
      let n = null;
      try { n = LawEngine.resolveBookmark(lei); } catch (_) { n = lei && lei.bookmark; }
      n = Math.round(Number(n) || 0);
      const total = this._linhas(lei).length;
      return Math.max(1, Math.min(Math.max(1, total), n > 0 ? n : 1));
    },
    _anchor(lei, linha) {
      const linhas = this._linhas(lei);
      return (linhas[Math.max(0, linha - 1)] || '').trim().slice(0, 40) || null;
    },
    _setBookmark(lei, linha, rodizioPatch) {
      if (!lei) return null;
      const linhas = this._linhas(lei), total = linhas.length;
      const n = total ? Math.max(1, Math.min(total, Math.round(Number(linha) || 1))) : null;
      const rodizio = Object.assign({}, this.cfgLei(lei), rodizioPatch || {});
      DB.updateLei(lei.id, { bookmark: n, bookmarkTxt: n ? this._anchor(lei, n) : null, rodizio });
      return n;
    },
    _linhasSessao(lei, p) { return this.cfgLei(lei).linhasSessao || p.linhasSessao; },
    _fimModo(lei, p) {
      const m = this.cfgLei(lei).aoFinal;
      return m === 'padrao' ? p.aoFinal : m;
    },
    _ordenaLeis(a, b, p) {
      const ca = this.cfgLei(a), cb = this.cfgLei(b);
      if (p.ordem === 'prioridade') {
        return cb.prioridade - ca.prioridade
          || String(ca.ultimaConclusao || ca.ultimaGeracao || '').localeCompare(String(cb.ultimaConclusao || cb.ultimaGeracao || ''))
          || String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt-BR');
      }
      return String(ca.ultimaConclusao || ca.ultimaGeracao || '').localeCompare(String(cb.ultimaConclusao || cb.ultimaGeracao || ''))
        || cb.prioridade - ca.prioridade
        || String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt-BR');
    },
    _selecionar(leis, n, p, materiasUsadas) {
      const ordenadas = leis.slice().sort((a, b) => this._ordenaLeis(a, b, p));
      if (!p.alternarMaterias) return ordenadas.slice(0, n);
      const out = [], usadas = new Set(materiasUsadas || []);
      for (const lei of ordenadas) {
        if (out.length >= n) break;
        const m = String(lei.materia || '').trim().toLowerCase() || '—';
        if (usadas.has(m)) continue;
        out.push(lei); usadas.add(m);
      }
      if (out.length < n) {
        for (const lei of ordenadas) {
          if (out.length >= n) break;
          if (!out.includes(lei)) out.push(lei);
        }
      }
      return out;
    },
    _criarMissao(lei, hoje, p) {
      const linhas = this._linhas(lei), total = linhas.length;
      if (!total) return null;
      const de = this._bookmark(lei);
      const carga = this._linhasSessao(lei, p);
      const ate = Math.min(total, de + carga - 1);
      const e = DB.addExtra({
        titulo: 'Lei seca · ' + (lei.titulo || 'Leitura'),
        tipo: 'leitura', disciplina: lei.materia || '', unidade: 'linhas',
        alvo: Math.max(1, ate - de + 1), periodo: 'unica', datas: [hoje],
        marcador: 'linhas ' + de + '–' + ate, contaMetricas: false,
        obs: 'Gerado pelo rodízio inteligente de lei seca.'
      });
      if (!e) return null;
      DB.updateExtra(e.id, {
        origemLei: {
          rodizio: true, leiId: lei.id, deLinha: de, ateLinha: ate, totalLinhas: total,
          geradoEmDia: hoje, agendadoPara: hoje, carga, versao: 1
        }
      });
      const cfg = this.cfgLei(lei);
      DB.updateLei(lei.id, { rodizio: Object.assign({}, cfg, { ultimaGeracao: hoje, ultimaPulada: '' }) });
      return DB.getExtra(e.id) || e;
    },
    sincronizarHoje() {
      if (typeof DB === 'undefined' || typeof LawEngine === 'undefined') return { mudou: false, criadas: 0 };
      try {
        if (typeof PlanManager !== 'undefined' && PlanManager.isActivePlanPaused && PlanManager.isActivePlanPaused()) {
          return { mudou: false, criadas: 0, pausado: true };
        }
      } catch (_) { if (typeof _quiet === 'function') _quiet(_, '56-leis-rodizio'); }
      const p = this.prefs(), hoje = todayLocal();
      if (!p.ativo || !this._diaPermitido(hoje, p)) return { mudou: false, criadas: 0 };
      let extras = DB.getExtras();
      const leis = DB.getLeis();
      const porId = new Map(leis.map(l => [l.id, l]));
      let mudou = false;

      extras.forEach(e => {
        if (!this.eExtra(e) || e.status === 'concluida') return;
        const lei = porId.get(e.origemLei.leiId);
        if (!lei || !this.cfgLei(lei).apta) return;
        const ag = e.origemLei.agendadoPara || (e.datas || [])[0] || '';
        if (ag && ag < hoje && !(e.datas || []).includes(hoje)) {
          e.datas = [hoje];
          e.origemLei = Object.assign({}, e.origemLei, { agendadoPara: hoje, carregadaDe: ag });
          e.updatedAt = new Date().toISOString();
          mudou = true;
        }
      });
      if (mudou) { DB.saveExtras(extras); extras = DB.getExtras(); }

      const hojeGeradas = extras.filter(e => this.eExtra(e) && (
        (e.origemLei && e.origemLei.agendadoPara === hoje) || (e.datas || []).includes(hoje)
      ));
      const vagas = Math.max(0, p.porDia - hojeGeradas.length);
      if (!vagas) return { mudou, criadas: 0, hoje: hojeGeradas.length };

      const abertasPorLei = new Set(extras.filter(e => this.eExtra(e) && e.status !== 'concluida').map(e => e.origemLei.leiId));
      const elegiveis = leis.filter(lei => {
        const c = this.cfgLei(lei);
        return c.apta && c.ultimaPulada !== hoje && !abertasPorLei.has(lei.id) && this._linhas(lei).length > 0;
      });
      const materiasHoje = hojeGeradas.map(e => {
        const lei = porId.get(e.origemLei.leiId);
        return String(lei && lei.materia || '').trim().toLowerCase() || '—';
      });
      const escolhidas = this._selecionar(elegiveis, vagas, p, materiasHoje);
      let criadas = 0;
      escolhidas.forEach(lei => { if (this._criarMissao(lei, hoje, p)) criadas++; });
      return { mudou: mudou || criadas > 0, criadas, hoje: hojeGeradas.length + criadas };
    },
    _progressoExtra(e) {
      if (!e || !this.eExtra(e)) return 0;
      return Math.max(0, Math.min(Number(e.alvo) || 0, Number(e.progresso) || 0));
    },
    avancarParcial(e) {
      if (!this.eExtra(e) || e.status === 'concluida') return;
      const lei = DB.getLei(e.origemLei.leiId); if (!lei) return;
      const lidas = Math.floor(this._progressoExtra(e)); if (lidas <= 0) return;
      const prox = Math.min(e.origemLei.totalLinhas || this._linhas(lei).length, e.origemLei.deLinha + lidas);
      const atual = this._bookmark(lei);
      if (prox > atual) this._setBookmark(lei, prox, {});
    },
    finalizarExtra(e, dia) {
      if (!this.eExtra(e) || !e.origemLei || e.origemLei.finalizadaEm) return e;
      const lei = DB.getLei(e.origemLei.leiId); if (!lei) return e;
      const p = this.prefs(), o = e.origemLei, cfg = this.cfgLei(lei);
      const atual = this._bookmark(lei);
      const total = Math.max(1, Number(o.totalLinhas) || this._linhas(lei).length || 1);
      const depoisNatural = Math.min(total, (Number(o.ateLinha) || atual) + 1);
      const chegouFim = Number(o.ateLinha) >= total;
      const modoFim = this._fimModo(lei, p);
      const antes = { bookmark: lei.bookmark == null ? null : lei.bookmark, bookmarkTxt: lei.bookmarkTxt || null, rodizio: Object.assign({}, lei.rodizio || {}) };
      let depois = Math.max(atual, depoisNatural);
      const novoCfg = Object.assign({}, cfg, {
        ultimaConclusao: dia || todayLocal(),
        sessoes: cfg.sessoes + 1,
        linhasLidas: cfg.linhasLidas + Math.max(1, (Number(o.ateLinha) || 0) - (Number(o.deLinha) || 1) + 1)
      });
      if (chegouFim && modoFim === 'reiniciar') depois = 1;
      if (chegouFim && modoFim === 'pausar') novoCfg.apta = false;
      this._setBookmark(lei, depois, novoCfg);
      const origemLei = Object.assign({}, o, {
        finalizadaEm: new Date().toISOString(), concluidaEmDia: dia || todayLocal(),
        bookmarkDepois: depois, chegouFim, antesConclusao: antes
      });
      DB.updateExtra(e.id, { origemLei, marcador: chegouFim ? 'fim da lei' : 'próxima linha ' + depois });
      return DB.getExtra(e.id) || e;
    },
    reabrirExtra(e) {
      if (!this.eExtra(e) || !e.origemLei || !e.origemLei.finalizadaEm) return e;
      const o = e.origemLei, lei = DB.getLei(o.leiId), antes = o.antesConclusao;
      if (lei && antes) {
        const atual = this._bookmark(lei);
        const patch = { rodizio: Object.assign({}, antes.rodizio || {}) };
        if (Number(atual) === Number(o.bookmarkDepois)) {
          patch.bookmark = antes.bookmark;
          patch.bookmarkTxt = antes.bookmarkTxt;
        }
        DB.updateLei(lei.id, patch);
      }
      const origemLei = Object.assign({}, o);
      ['finalizadaEm', 'concluidaEmDia', 'bookmarkDepois', 'chegouFim', 'antesConclusao'].forEach(k => delete origemLei[k]);
      DB.updateExtra(e.id, { origemLei, marcador: 'linhas ' + o.deLinha + '–' + o.ateLinha });
      return DB.getExtra(e.id) || e;
    },
    pularExtra(e) {
      if (!this.eExtra(e)) return;
      const lei = DB.getLei(e.origemLei.leiId); if (!lei) return;
      const cfg = this.cfgLei(lei);
      DB.updateLei(lei.id, { rodizio: Object.assign({}, cfg, { ultimaPulada: todayLocal(), ultimaGeracao: todayLocal() }) });
    },
    statusHoje() {
      const hoje = todayLocal(), p = this.prefs();
      const leis = DB.getLeis();
      const aptas = leis.filter(l => this.cfgLei(l).apta).length;
      const missoes = DB.getExtras().filter(e => this.eExtra(e) && ((e.origemLei && e.origemLei.agendadoPara === hoje) || (e.datas || []).includes(hoje))).length;
      return { aptas, missoes, permitido: this._diaPermitido(hoje, p), prefs: p };
    },
    abrirLei(leiId, linha) {
      const abrir = () => {
        if (typeof LeisScreen === 'undefined') return;
        LeisScreen.openReader(leiId);
        setTimeout(() => {
          const body = document.getElementById('lei-reader-body');
          const alvo = body && body.querySelector('.law-block[data-line="' + Number(linha) + '"]');
          if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      };
      try {
        if (typeof switchScreen === 'function') switchScreen('leis');
        setTimeout(abrir, 30);
      } catch (_) { abrir(); }
    },

    decorarExtras() {
      const agenda = document.querySelector('#extras-agenda .exm-dashboard') || document.querySelector('#extras-agenda .cal-card');
      if (agenda && !agenda.querySelector('.lr-panel')) {
        const s = this.statusHoje(), p = s.prefs;
        const box = document.createElement('div');
        box.className = 'lr-panel';
        box.innerHTML = `
          <div class="lr-panel-head">
            <div><strong>📚 Rodízio de lei seca</strong><small>Gera a leitura do dia a partir das leis aptas e retoma do marcador real.</small></div>
            <label class="lr-switch"><input type="checkbox" data-lr-ativo ${p.ativo ? 'checked' : ''}><span>Ativo</span></label>
          </div>
          <div class="lr-grid">
            <label>Leis por dia<select data-lr-pordia>${[1,2,3,4,5].map(n => `<option value="${n}" ${p.porDia === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>Linhas por sessão<input type="number" min="5" max="300" data-lr-linhas value="${p.linhasSessao}"></label>
            <label>Ordem<select data-lr-ordem><option value="circular" ${p.ordem === 'circular' ? 'selected' : ''}>Circular · há mais tempo sem ler</option><option value="prioridade" ${p.ordem === 'prioridade' ? 'selected' : ''}>Prioridade configurada</option></select></label>
            <label>Ao terminar<select data-lr-fim><option value="pausar" ${p.aoFinal === 'pausar' ? 'selected' : ''}>Pausar a lei</option><option value="reiniciar" ${p.aoFinal === 'reiniciar' ? 'selected' : ''}>Reiniciar do início</option></select></label>
          </div>
          <div class="lr-days">${['D','S','T','Q','Q','S','S'].map((r,i) => `<label title="Dia ${i}"><input type="checkbox" data-lr-dia value="${i}" ${p.dias.includes(i) ? 'checked' : ''}><span>${r}</span></label>`).join('')}</div>
          <div class="lr-panel-foot">
            <label class="lr-inline"><input type="checkbox" data-lr-alternar ${p.alternarMaterias ? 'checked' : ''}> Alternar matérias quando possível</label>
            <span>${s.aptas} lei(s) apta(s) · ${s.missoes} missão(ões) hoje${s.permitido ? '' : ' · hoje está fora da rotina'}</span>
            <button type="button" class="btn-secondary" data-lr-gerenciar>Gerenciar leis</button>
            <button type="button" class="btn-primary" data-lr-salvar>Salvar rotina</button>
          </div>`;
        agenda.appendChild(box);
        box.querySelector('[data-lr-salvar]').addEventListener('click', () => {
          const dias = [...box.querySelectorAll('[data-lr-dia]:checked')].map(x => Number(x.value));
          this.salvarPrefs({
            ativo: box.querySelector('[data-lr-ativo]').checked,
            porDia: Number(box.querySelector('[data-lr-pordia]').value),
            linhasSessao: Number(box.querySelector('[data-lr-linhas]').value),
            ordem: box.querySelector('[data-lr-ordem]').value,
            aoFinal: box.querySelector('[data-lr-fim]').value,
            alternarMaterias: box.querySelector('[data-lr-alternar]').checked,
            dias
          });
          showToast('Rotina de lei seca atualizada ✓');
          ExtrasScreen.render();
        });
        box.querySelector('[data-lr-gerenciar]').addEventListener('click', () => {
          if (typeof switchScreen === 'function') switchScreen('leis');
        });
      }

      document.querySelectorAll('#extras-list .exd').forEach(card => {
        const e = DB.getExtra(card.dataset.id);
        if (!this.eExtra(e)) return;
        card.classList.add('lr-extra-card');
        const o = e.origemLei, lei = DB.getLei(o.leiId);
        const manual = card.querySelector('.extra-marcador'); if (manual) manual.remove();
        const tags = card.querySelector('.exd-tags');
        if (tags && !tags.querySelector('.lr-tag')) tags.insertAdjacentHTML('beforeend', '<span class="extra-tag lr-tag">🔁 rodízio lei seca</span>');
        if (!card.querySelector('.lr-route')) {
          const feito = Math.floor(this._progressoExtra(e));
          const total = Math.max(1, Number(e.alvo) || 1);
          const prox = Math.min(Number(o.ateLinha) || o.deLinha, Number(o.deLinha) + feito);
          const route = document.createElement('div'); route.className = 'lr-route';
          route.innerHTML = `<div class="lr-route-main"><small>Leitura de hoje</small><strong>Linhas ${o.deLinha}–${o.ateLinha}</strong><span>${feito ? feito + '/' + total + ' linhas registradas · ' : ''}${e.status === 'concluida' ? 'sessão concluída' : 'próxima linha ' + prox}${lei && lei.referencia ? ' · ' + escapeHtml(lei.referencia) : ''}</span></div><button type="button" class="btn-secondary" data-lr-open>📖 Abrir lei</button>`;
          const top = card.querySelector('.exd-top'); if (top) top.insertAdjacentElement('afterend', route); else card.prepend(route);
          route.querySelector('[data-lr-open]').addEventListener('click', () => this.abrirLei(o.leiId, o.deLinha));
        }
      });
    },

    decorarLeis() {
      const wrap = document.getElementById('leis-cards'); if (!wrap) return;
      wrap.querySelectorAll('.lei-card').forEach(card => {
        if (card.closest('.lr-law-wrap')) return;
        const lei = DB.getLei(card.dataset.id); if (!lei) return;
        if (lei._planId && String(lei._planId) !== String(DB._activePlanId())) {
          card.classList.add('lr-law-readonly');
          return;
        }
        const cfg = this.cfgLei(lei), p = this.prefs(), linha = this._bookmark(lei);
        const holder = document.createElement('div'); holder.className = 'lr-law-wrap';
        card.parentNode.insertBefore(holder, card); holder.appendChild(card);
        const tools = document.createElement('div'); tools.className = 'lr-law-tools';
        tools.innerHTML = `<label class="lr-switch"><input type="checkbox" data-lr-law-on ${cfg.apta ? 'checked' : ''}><span>${cfg.apta ? 'Apta para rodízio' : 'Fora do rodízio'}</span></label><span class="lr-law-next">📌 começa na linha ${linha} · ${cfg.linhasSessao || p.linhasSessao} linhas/sessão</span><button type="button" class="btn-secondary" data-lr-law-cfg>⚙ Ajustar</button>`;
        holder.appendChild(tools);
        const on = tools.querySelector('[data-lr-law-on]');
        on.addEventListener('change', () => {
          this.salvarCfgLei(lei.id, { apta: on.checked, ultimaPulada: '' });
          showToast(on.checked ? 'Lei incluída no rodízio ✓' : 'Lei pausada no rodízio');
          if (typeof LeisScreen !== 'undefined') LeisScreen.renderCards();
        });
        tools.querySelector('[data-lr-law-cfg]').addEventListener('click', () => {
          let ed = holder.querySelector('.lr-law-editor');
          if (ed) { ed.remove(); return; }
          const atual = this.cfgLei(DB.getLei(lei.id));
          ed = document.createElement('div'); ed.className = 'lr-law-editor';
          ed.innerHTML = `<label>Linhas por sessão<input type="number" min="5" max="300" data-lr-leilinhas value="${atual.linhasSessao || ''}" placeholder="Padrão: ${p.linhasSessao}"></label><label>Prioridade<select data-lr-prio>${[1,2,3,4,5].map(n => `<option value="${n}" ${atual.prioridade === n ? 'selected' : ''}>${n}${n===1?' · baixa':n===3?' · normal':n===5?' · máxima':''}</option>`).join('')}</select></label><label>Ao terminar<select data-lr-leifim><option value="padrao" ${atual.aoFinal === 'padrao' ? 'selected' : ''}>Usar padrão global</option><option value="pausar" ${atual.aoFinal === 'pausar' ? 'selected' : ''}>Pausar esta lei</option><option value="reiniciar" ${atual.aoFinal === 'reiniciar' ? 'selected' : ''}>Reiniciar esta lei</option></select></label><div class="lr-law-editor-actions"><button type="button" class="btn-secondary" data-lr-reset-line>↺ Recomeçar na linha 1</button><button type="button" class="btn-primary" data-lr-law-save>Salvar</button></div>`;
          holder.appendChild(ed);
          ed.querySelector('[data-lr-law-save]').addEventListener('click', () => {
            const raw = ed.querySelector('[data-lr-leilinhas]').value;
            this.salvarCfgLei(lei.id, { linhasSessao: raw === '' ? null : Number(raw), prioridade: Number(ed.querySelector('[data-lr-prio]').value), aoFinal: ed.querySelector('[data-lr-leifim]').value });
            showToast('Parâmetros desta lei atualizados ✓'); LeisScreen.renderCards();
          });
          ed.querySelector('[data-lr-reset-line]').addEventListener('click', () => {
            const l = DB.getLei(lei.id); if (!l) return;
            this._setBookmark(l, 1, {}); showToast('Leitura reiniciada na linha 1'); LeisScreen.renderCards();
          });
        });
      });
    }
  };
  if (typeof window !== 'undefined') window.LeiRodizio = LeiRodizio;

  if (typeof DB !== 'undefined') {
    const addProgressAnterior = DB.addExtraProgress;
    DB.addExtraProgress = function () {
      const id = arguments[0];
      const r = addProgressAnterior.apply(this, arguments);
      const e = this.getExtra(id);
      if (LeiRodizio.eExtra(e)) {
        if (e.status === 'concluida') LeiRodizio.finalizarExtra(e, (arguments[3] && arguments[3].data) || todayLocal());
        else LeiRodizio.avancarParcial(e);
      }
      return this.getExtra(id) || r;
    };

    const concluirAnterior = DB.setConcluidaDia;
    DB.setConcluidaDia = function (id, dia, on) {
      const antes = this.getExtra(id), ehLei = LeiRodizio.eExtra(antes);
      const r = concluirAnterior.call(this, id, dia, on);
      const e = this.getExtra(id);
      if (ehLei && e) {
        if (on) LeiRodizio.finalizarExtra(e, dia || todayLocal());
        else LeiRodizio.reabrirExtra(e);
      }
      return this.getExtra(id) || r;
    };

    if (typeof DB.deleteExtra === 'function') {
      const delAnterior = DB.deleteExtra;
      DB.deleteExtra = function (id) {
        const e = this.getExtra(id);
        if (LeiRodizio.eExtra(e) && e.status !== 'concluida') LeiRodizio.pularExtra(e);
        return delAnterior.call(this, id);
      };
    }
  }

  if (typeof ExtrasScreen !== 'undefined') {
    const renderAnterior = ExtrasScreen.render;
    ExtrasScreen.render = function () {
      try { LeiRodizio.sincronizarHoje(); } catch (e) { _quiet(e, 'lei-rodizio-sync'); }
      const r = renderAnterior.apply(this, arguments);
      try { LeiRodizio.decorarExtras(); } catch (e) { _quiet(e, 'lei-rodizio-ui'); }
      return r;
    };
  }

  if (typeof LeisScreen !== 'undefined' && typeof LeisScreen.renderCards === 'function') {
    const cardsAnterior = LeisScreen.renderCards;
    LeisScreen.renderCards = function () {
      const r = cardsAnterior.apply(this, arguments);
      try { LeiRodizio.decorarLeis(); } catch (e) { _quiet(e, 'lei-rodizio-leis-ui'); }
      return r;
    };
  }
})();
