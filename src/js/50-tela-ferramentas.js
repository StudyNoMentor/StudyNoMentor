/* ============================================================
   TELA: FERRAMENTAS (auxiliares e independentes)
   ============================================================ */
const FerramentasScreen = {
  get STORE_KEY() { return DB._profilePrefix() + 'ferramentas'; },
  _state: null,

  load() {
    if (this._state) return this._state;
    this._state = DB._get(this.STORE_KEY, null) || {
      estimativa: {},
      editais: [
        { nome: 'Edital 1', texto: '' },
        { nome: 'Edital 2', texto: '' }
      ]
    };
    if (!this._state.editais) this._state.editais = [{ nome: 'Edital 1', texto: '' }];
    if (!this._state.estimativa) this._state.estimativa = {};
    return this._state;
  },
  save() { DB._set(this.STORE_KEY, this._state); },

  render() {
    this.load();
    this.restoreEstimativaInputs();
    this.calcEstimativa();
    this.renderEditais();
  },

  // ---------------- Estimativa de tempo ----------------
  EST_FIELDS: ['est-paginas', 'est-pph', 'est-minvideo', 'est-mph', 'est-horas-sem', 'est-pct-novo',
               'est-semanas-disp', 'est-carga-realista', 'est-carga-otimista'],
  restoreEstimativaInputs() {
    const saved = this._state.estimativa || {};
    this.EST_FIELDS.forEach(id => {
      if (saved[id] !== undefined && saved[id] !== null && saved[id] !== '') {
        document.getElementById(id).value = saved[id];
      }
    });
  },
  persistEstimativaInputs() {
    const obj = {};
    this.EST_FIELDS.forEach(id => { obj[id] = document.getElementById(id).value; });
    this._state.estimativa = obj;
    this.save();
  },
  num(id) { return parseFloat(document.getElementById(id).value) || 0; },
  fmtH(h) {
    if (!isFinite(h) || h <= 0) return '0h';
    const H = Math.floor(h);
    const m = Math.round((h - H) * 60);
    return (H > 0 ? H + 'h ' : '') + (m > 0 ? m + 'min' : (H > 0 ? '' : '0h')).trim();
  },
  calcEstimativa() {
    const paginas = this.num('est-paginas');
    const pph = this.num('est-pph');
    const minVideo = this.num('est-minvideo');
    const mph = this.num('est-mph');
    const horasSem = this.num('est-horas-sem');
    const pctNovo = this.num('est-pct-novo');

    const horasPDF = pph > 0 ? paginas / pph : 0;
    const horasVideo = mph > 0 ? minVideo / mph : 0;
    const totalHorasNovo = horasPDF + horasVideo;
    const semanasNovo = horasSem > 0 ? totalHorasNovo / horasSem : 0;
    const fatorNovo = pctNovo > 0 ? pctNovo / 100 : 1;
    const semanasPos = semanasNovo / fatorNovo;
    const totalHorasPos = totalHorasNovo / fatorNovo;

    $id('est-results').innerHTML = `
      <div class="tool-result-card hero">
        <div class="val">${this.fmtH(totalHorasNovo)}</div>
        <div class="lbl">Horas necessárias<br>(estudo novo)</div>
      </div>
      <div class="tool-result-card">
        <div class="val">${semanasNovo.toFixed(1)}</div>
        <div class="lbl">Semanas para<br>o estudo novo</div>
      </div>
      <div class="tool-result-card">
        <div class="val">${semanasPos.toFixed(1)}</div>
        <div class="lbl">Semanas mínimas<br>p/ o pós (${pctNovo || 0}%)</div>
      </div>
    `;

    const semanasDisp = this.num('est-semanas-disp');
    const cargaR = this.num('est-carga-realista');
    const cargaO = this.num('est-carga-otimista');
    const totalRealista = semanasDisp * cargaR;
    const totalOtimista = semanasDisp * cargaO;

    $id('est-avail-results').innerHTML = `
      <div class="tool-result-card">
        <div class="val">${Math.round(totalRealista)}h</div>
        <div class="lbl">Total realista<br>disponível</div>
      </div>
      <div class="tool-result-card">
        <div class="val">${Math.round(totalOtimista)}h</div>
        <div class="lbl">Total otimista<br>disponível</div>
      </div>
      <div class="tool-result-card ${totalHorasPos <= totalRealista ? '' : ''}">
        <div class="val">${this.fmtH(totalHorasPos)}</div>
        <div class="lbl">Horas totais<br>necessárias (pós)</div>
      </div>
    `;

    // veredito comparando necessidade total do pós com o tempo disponível
    const verdictEl = document.getElementById('est-verdict');
    if (totalHorasNovo <= 0 || semanasDisp <= 0) {
      verdictEl.innerHTML = '';
    } else if (totalHorasPos <= totalRealista) {
      const folga = totalRealista - totalHorasPos;
      verdictEl.innerHTML = `<div class="tool-verdict ok"><span class="vtitle">✓ Cabe no ritmo realista</span>
        Você precisa de ~${this.fmtH(totalHorasPos)} e tem ~${Math.round(totalRealista)}h disponíveis no ritmo realista — uma folga de ~${this.fmtH(folga)}.</div>`;
    } else if (totalHorasPos <= totalOtimista) {
      verdictEl.innerHTML = `<div class="tool-verdict tight"><span class="vtitle">⚠ Só cabe no ritmo otimista</span>
        No ritmo realista faltam ~${this.fmtH(totalHorasPos - totalRealista)}. É viável se você sustentar a carga otimista (${cargaO}h/sem). Considere priorizar as matérias de maior peso.</div>`;
    } else {
      const faltam = totalHorasPos - totalOtimista;
      verdictEl.innerHTML = `<div class="tool-verdict bad"><span class="vtitle">✗ Não cabe no prazo</span>
        Mesmo no ritmo otimista faltam ~${this.fmtH(faltam)}. Vale cortar conteúdo de menor incidência, aumentar a carga semanal ou focar em revisão/questões nas matérias de maior peso.</div>`;
    }
  },

  // ---------------- Seleção de matérias por incidência ----------------
  renderEditais() {
    const wrap = document.getElementById('selecao-editais');
    wrap.innerHTML = this._state.editais.map((ed, i) => {
      const count = ed.texto.split('\n').map(t => t.trim()).filter(Boolean).length;
      return `
        <div class="edital-col" data-idx="${i}">
          <div class="edital-col-head">
            <input type="text" class="edital-nome" value="${escapeHtml(ed.nome)}" placeholder="Nome do edital">
            <button type="button" class="edital-remove" title="Remover edital" aria-label="Remover edital">×</button>
          </div>
          <textarea class="edital-texto" placeholder="Uma matéria por linha...">${escapeHtml(ed.texto)}</textarea>
          <div class="edital-count">${count} matéria${count === 1 ? '' : 's'}</div>
        </div>`;
    }).join('');

    wrap.querySelectorAll('.edital-col').forEach(col => {
      const idx = parseInt(col.dataset.idx, 10);
      col.querySelector('.edital-nome').addEventListener('change', (e) => {
        this._state.editais[idx].nome = e.target.value; this.save();
      });
      col.querySelector('.edital-texto').addEventListener('input', (e) => {
        this._state.editais[idx].texto = e.target.value;
        col.querySelector('.edital-count').textContent =
          `${e.target.value.split('\n').map(t => t.trim()).filter(Boolean).length} matéria(s)`;
        this.save();
      });
      col.querySelector('.edital-remove').addEventListener('click', () => {
        if (this._state.editais.length <= 1) { showToast('Mantenha ao menos um edital'); return; }
        this._state.editais.splice(idx, 1); this.save(); this.renderEditais();
      });
    });
  },
  addEdital() {
    this._state.editais.push({ nome: 'Edital ' + (this._state.editais.length + 1), texto: '' });
    this.save();
    this.renderEditais();
  },
  // normaliza para comparação: minúsculas, sem acento, espaços colapsados
  _norm(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  },
  calcIncidencia() {
    const editais = this._state.editais;
    const totalEditais = editais.filter(e => e.texto.trim()).length;
    const map = {}; // norm -> { display, count }
    editais.forEach(ed => {
      const seen = new Set();
      ed.texto.split('\n').map(t => t.trim()).filter(Boolean).forEach(raw => {
        const key = this._norm(raw);
        if (!key || seen.has(key)) return; // dedupe dentro do mesmo edital
        seen.add(key);
        if (!map[key]) map[key] = { display: raw, count: 0 };
        map[key].count++;
      });
    });
    const rows = Object.values(map).sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));
    const resultEl = document.getElementById('selecao-resultado');
    if (rows.length === 0) {
      resultEl.innerHTML = `<div class="empty-state"><div class="big">🎯</div>Preencha ao menos um edital com matérias para ver a incidência.</div>`;
      return;
    }
    const maxCount = totalEditais || rows[0].count;
    resultEl.innerHTML = `
      <section class="card">
        <div class="card-header">
          <div>
            <h2>Incidência das matérias</h2>
            <p class="sub">${rows.length} matéria(s) distintas em ${totalEditais} edital(is). As que mais se repetem aparecem no topo.</p>
          </div>
        </div>
        <div style="padding: 14px 28px 22px;">
          ${rows.map(r => {
            const pct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
            const full = r.count >= totalEditais && totalEditais > 0;
            return `
              <div class="incid-bar-row">
                <div class="iname" title="${escapeHtml(r.display)}">${escapeHtml(r.display)}</div>
                <div class="incid-track"><div class="incid-fill ${full ? 'full' : ''}" style="width:${pct}%;"></div></div>
                <div class="incid-count"><span class="incid-badge">${r.count}</span>/${totalEditais} edital(is)</div>
              </div>`;
          }).join('')}
        </div>
      </section>`;
  }
};

// listeners da tela Ferramentas
$id('tool-tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tool-tab');
  if (!btn) return;
  const tool = btn.dataset.tool;
  document.querySelectorAll('.tool-tab').forEach(t => t.classList.toggle('active', t === btn));
  document.querySelectorAll('.tool-panel').forEach(p => p.classList.toggle('active', p.id === 'tool-' + tool));
});

['est-paginas','est-pph','est-minvideo','est-mph','est-horas-sem','est-pct-novo','est-semanas-disp','est-carga-realista','est-carga-otimista'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    FerramentasScreen.calcEstimativa();
    FerramentasScreen.persistEstimativaInputs();
  });
});
$id('btn-add-edital').addEventListener('click', () => FerramentasScreen.addEdital());
$id('btn-calc-incidencia').addEventListener('click', () => FerramentasScreen.calcIncidencia());

window.FerramentasScreen = FerramentasScreen;
window.addEventListener('screen:activated', (e) => {
  if (e.detail.screen === 'ferramentas') FerramentasScreen.render();
});
