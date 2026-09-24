/* ============================================================================
   GERADOR DE GRADE SEMANAL
   ----------------------------------------------------------------------------
   Transforma as metas semanais do Ciclo (minutos por matéria) em uma grade
   pronta, seguindo as regras de montagem:

   • Sessões de 60 a 120 min, sempre preferindo 60. O que sobra de uma meta
     (ex.: 150 min) vai para UMA sessão maior (60 + 90), nunca fatia menor
     que o mínimo.
   • Repetições da mesma matéria espaçadas ao longo da semana (3 sessões em
     6 dias → seg/qua/sex), sem repetir a matéria no mesmo dia quando houver
     alternativa.
   • Matérias de cálculo nunca em sequência no mesmo dia, se der para alternar.
   • Matérias prioritárias ocupam os primeiros horários do dia.
   • Respeita o tempo disponível de cada dia; o que não couber volta como
     "sobra", em vez de estourar o dia.

   GradeGerador.gerar() é função pura (sem DB nem DOM) — testável em Node.
   A janela "✨ Sugerir grade" usa o motor e grava via DB.saveGradeTemplate.
   ============================================================================ */
(function (root) {
  'use strict';
  const DIAS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

  function rng(seed) {
    let a = (Number(seed) || 0) >>> 0 || 0x9e3779b9;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Divide a meta semanal em sessões. Prefere o mínimo; o resto (< mínimo)
     engorda uma única sessão, até o máximo. */
  function dividir(total, min, max) {
    total = Math.max(0, Math.round(Number(total) || 0));
    min = Math.max(5, Math.round(Number(min) || 60));
    max = Math.max(min, Math.round(Number(max) || 120));
    if (!total) return { sessoes: [], arredondado: false };
    if (total < min) return { sessoes: [min], arredondado: true };
    const k = Math.floor(total / min);
    const s = Array.from({ length: k }, () => min);
    let r = total - k * min;
    for (let i = s.length - 1; r > 0 && i >= 0; i--) {
      const add = Math.min(r, max - s[i]);
      s[i] += add; r -= add;
    }
    return { sessoes: s, arredondado: false };
  }

  const distCirc = (a, b, n) => { const d = Math.abs(a - b) % n; return Math.min(d, n - d); };

  function gerar(opts) {
    opts = opts || {};
    const min = Math.max(5, Math.round(Number(opts.minSess) || 60));
    const max = Math.max(min, Math.round(Number(opts.maxSess) || 120));
    const rand = rng(opts.semente || 0);
    const avisos = [];
    const diasCfg = (opts.dias || []).filter(d => d && DIAS.includes(d.dia));
    const livres = DIAS.filter(dia => {
      const c = diasCfg.find(d => d.dia === dia);
      return c && Number(c.minutos) > 0;
    });
    const cap = {}; DIAS.forEach(d => { const c = diasCfg.find(x => x.dia === d); cap[d] = c ? Math.max(0, Math.round(Number(c.minutos) || 0)) : 0; });
    const grade = {}; DIAS.forEach(d => { grade[d] = []; });
    const sobras = [];

    const materias = (opts.materias || [])
      .filter(m => m && String(m.nome || '').trim() && Number(m.minutos) > 0)
      .map((m, i) => {
        const div = dividir(m.minutos, min, max);
        if (div.arredondado) avisos.push(`${m.nome}: meta de ${Math.round(m.minutos)} min arredondada para uma sessão de ${min} min.`);
        return { nome: String(m.nome).trim(), minutos: Math.round(Number(m.minutos)), prioritaria: !!m.prioritaria, calculo: !!m.calculo, sessoes: div.sessoes, _ord: i, _r: rand() };
      })
      // mais restritas primeiro: prioritárias, depois as com mais sessões
      .sort((a, b) => (b.prioritaria - a.prioritaria) || (b.sessoes.length - a.sessoes.length) || (b.minutos - a.minutos) || (a._r - b._r));

    if (!livres.length) {
      materias.forEach(m => m.sessoes.forEach(s => sobras.push({ nome: m.nome, minutos: s })));
      return { grade, sessoes: 0, sobras, avisos: avisos.concat('Nenhum dia com tempo disponível.') };
    }

    const L = livres.length;
    const usado = {}; DIAS.forEach(d => { usado[d] = 0; });
    const temNoDia = (dia, nome) => grade[dia].some(x => x.nome === nome);
    // Excesso de cálculo no dia: com mais cálculo que teóricas não dá para alternar.
    // As prioritárias abrem o dia; a alternância acontece no restante dele.
    const cargaCalc = dia => {
      const resto = grade[dia].filter(x => !x.prioritaria), c = resto.filter(x => x.calculo).length;
      return Math.max(0, c - (resto.length - c) + 1);
    };

    materias.forEach(m => {
      const n = m.sessoes.length;
      if (n > L) avisos.push(`${m.nome}: ${n} sessões em ${L} dia(s) — a matéria se repete em algum dia.`);
      // Testa cada ponto de partida e fica com a distribuição mais espaçada
      // e que usa os dias mais folgados.
      let melhor = null;
      for (let o = 0; o < L; o++) {
        const plano = [], usoSim = Object.assign({}, usado), diasSim = new Set();
        let desloc = 0, cabe = 0;
        m.sessoes.forEach((mins, i) => {
          const alvo = Math.round(o + i * L / n) % L;
          // candidatos: alvo e vizinhos, do mais perto ao mais longe
          // perto do dia ideal, com menos cálculo e com o dia menos carregado
          const peso = k => distCirc(k, alvo, L) + (m.calculo ? 0.6 * cargaCalc(livres[k]) : 0) + 0.8 * (usoSim[livres[k]] / (cap[livres[k]] || 1));
          const ordem = Array.from({ length: L }, (_, k) => k).sort((a, b) => peso(a) - peso(b) || a - b);
          let esc = ordem.find(k => cap[livres[k]] - usoSim[livres[k]] >= mins && !diasSim.has(k) && !temNoDia(livres[k], m.nome));
          if (esc == null) esc = ordem.find(k => cap[livres[k]] - usoSim[livres[k]] >= mins);
          if (esc == null) { plano.push(null); return; }
          desloc += distCirc(esc, alvo, L); cabe++;
          usoSim[livres[esc]] += mins; diasSim.add(esc); plano.push(esc);
        });
        const pos = plano.filter(x => x != null).sort((a, b) => a - b);
        let gapMin = L;
        for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) gapMin = Math.min(gapMin, distCirc(pos[i], pos[j], L));
        if (pos.length < 2) gapMin = L;
        const folga = pos.reduce((s, k) => s + (cap[livres[k]] - usado[livres[k]]), 0);
        const calc = m.calculo ? pos.reduce((s, k) => s + cargaCalc(livres[k]), 0) : 0;
        const score = cabe * 1e6 + gapMin * 1e4 - desloc * 100 - calc * 150 + folga * 3 + rand();
        if (!melhor || score > melhor.score) melhor = { score, plano };
      }
      melhor.plano.forEach((k, i) => {
        const mins = m.sessoes[i];
        if (k == null) { sobras.push({ nome: m.nome, minutos: mins }); return; }
        const dia = livres[k];
        usado[dia] += mins;
        grade[dia].push({ nome: m.nome, minutos: mins, prioritaria: m.prioritaria, calculo: m.calculo, peso: m.minutos, r: rand() });
      });
    });

    // Ordem dentro do dia: prioritárias no topo, cálculo sem repetir em sequência.
    DIAS.forEach(dia => {
      const resto = grade[dia].slice().sort((a, b) => (b.prioritaria - a.prioritaria) || (b.peso - a.peso) || (a.r - b.r));
      const seq = [];
      while (resto.length) {
        const prev = seq[seq.length - 1];
        const nCalc = resto.filter(x => x.calculo).length, nOutras = resto.length - nCalc;
        let i = -1;
        // se sobram mais de cálculo do que intervalos possíveis, puxa uma de cálculo já
        // (sem furar a fila das prioritárias: elas sempre vêm primeiro)
        const priTeorica = resto.some(x => x.prioritaria && !x.calculo);
        if (prev && !prev.calculo && nCalc > nOutras && !priTeorica) i = resto.findIndex(x => x.calculo && x.nome !== prev.nome);
        if (i < 0) i = resto.findIndex(x => !(prev && prev.calculo && x.calculo) && !(prev && x.nome === prev.nome));
        // uma prioritária nunca fica atrás de uma não prioritária só para alternar
        if (i > 0 && !resto[i].prioritaria && resto[0].prioritaria) i = 0;
        if (i < 0) i = resto.findIndex(x => !(prev && x.nome === prev.nome));
        if (i < 0) i = 0;
        seq.push(resto.splice(i, 1)[0]);
      }
      grade[dia] = seq;
    });

    let sessoes = 0; DIAS.forEach(d => { sessoes = Math.max(sessoes, grade[d].length); });
    const out = {};
    DIAS.forEach(d => {
      out[d] = grade[d].map(x => ({ subject: x.nome, minutes: x.minutos, done: false }));
      while (out[d].length < sessoes) out[d].push('');
    });
    if (sobras.length) {
      const porMat = {}; sobras.forEach(s => { porMat[s.nome] = (porMat[s.nome] || 0) + s.minutos; });
      avisos.push('Não couberam no tempo disponível: ' + Object.keys(porMat).map(k => `${k} (${porMat[k]} min)`).join(', ') + '.');
    }
    return { grade: out, sessoes: Math.max(1, sessoes), sobras, avisos };
  }

  /* Palpite para "matéria de cálculo". Nunca é aplicado sozinho: o planejamento
     pode ser de qualquer área, então quem decide é o aluno. Serve só para o
     botão "Sugerir pelo nome", que marca as prováveis para ele revisar. */
  const CALC_RE = /(contab|custo|estat[ií]st|matem[aá]t|financ|racioc[ií]nio|l[oó]gica|econom|c[aá]lculo|f[ií]sica|qu[ií]mica|atuar|probabil)/i;
  function pareceCalculo(nome) { return CALC_RE.test(String(nome || '').normalize('NFC')); }

  const api = { gerar, dividir, pareceCalculo, DIAS };
  root.GradeGerador = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* ---------------------------------------------------------------- janela */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const G = window.GradeGerador, DIAS = G.DIAS;
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  // CycleEngine é um const global (não fica em window).
  const CE = () => (typeof CycleEngine !== 'undefined' ? CycleEngine : null);
  const nk = s => CE() ? CE().normKey(s) : String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const fmt = m => CE() ? CE().fmtHM(m) : (m + ' min');
  let _mapaSiglas = null;
  const sigla = n => { if (!CE()) return n; if (!_mapaSiglas) _mapaSiglas = CE().buildAcronymMap(); return _mapaSiglas[n] || CE().siglaForSubject(n); };

  function chavePrefs() {
    try { return DB._profilePrefix() + 'p:' + DB._activePlanId() + ':grade-gerador'; } catch (_) { return 'diario-estudos:grade-gerador'; }
  }
  function lerPrefs() { try { return JSON.parse(localStorage.getItem(chavePrefs()) || 'null') || {}; } catch (_) { return {}; } }
  function gravarPrefs(p) { try { DB.setRaw(chavePrefs(), JSON.stringify(p)); } catch (_) { try { localStorage.setItem(chavePrefs(), JSON.stringify(p)); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'grade-gerador'); } } }

  // Metas da semana: ciclo atual → último ciclo montado → matérias ativas (sem meta).
  function metasDoCiclo() {
    let subs = [];
    try {
      const cyc = DB.getCurrentCycle && DB.getCurrentCycle();
      const last = DB.getLastCycleSetup && DB.getLastCycleSetup();
      subs = (cyc && cyc.subjects && cyc.subjects.length ? cyc.subjects : (last && last.subjects) || []);
    } catch (_) { subs = []; }
    let lista = subs.filter(s => s && s.nome).map(s => ({ nome: s.nome, minutos: Math.round(Number(s.definidoMin != null ? s.definidoMin : s.sugeridoMin) || 0) }));
    if (!lista.length) { try { lista = DB.getActiveSubjects().map(s => ({ nome: s.nome, minutos: 0 })); } catch (_) { lista = []; } }
    return lista;
  }

  const st = { semente: 0, ultimo: null };

  function estadoInicial() {
    const p = lerPrefs(), metas = metasDoCiclo(), marc = p.materias || {};
    const total = metas.reduce((s, m) => s + m.minutos, 0);
    const porDia = Math.max(60, Math.ceil(total / 7 / 60) * 60);
    const dias = DIAS.map(d => {
      const salvo = (p.dias || {})[d];
      return { dia: d, ativo: salvo ? !!salvo.ativo : true, minutos: salvo ? Math.max(0, Number(salvo.minutos) || 0) : porDia };
    });
    return {
      minSess: Number(p.minSess) || 60, maxSess: Number(p.maxSess) || 120,
      dias,
      materias: metas.map(m => {
        const k = nk(m.nome), s = marc[k];
        return { nome: m.nome, minutos: m.minutos, prioritaria: s ? !!s.prioritaria : false, calculo: s ? !!s.calculo : false };
      })
    };
  }

  function montarModal() {
    let m = document.getElementById('grade-gerador-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'grade-gerador-modal'; m.className = 'siglas-modal grade-gerador-modal'; m.style.display = 'none';
    m.innerHTML = `
      <div class="siglas-modal-box" role="dialog" aria-modal="true" aria-labelledby="gg-titulo">
        <div class="siglas-modal-head">
          <div>
            <h2 id="gg-titulo">✨ Sugerir grade</h2>
            <p class="sub">Distribui as metas do ciclo na semana: sessões de 60 min (até o máximo), repetições espaçadas, cálculo alternado e prioritárias nos primeiros horários.</p>
          </div>
          <button type="button" class="icon-btn" data-gg-fechar title="Fechar" aria-label="Fechar">✕</button>
        </div>
        <div class="siglas-modal-body gg-body">
          <section class="gg-sec">
            <h3 class="gg-h">Tempo disponível por dia</h3>
            <div class="gg-dias" id="gg-dias"></div>
            <div class="gg-sess">
              <label>Sessão mínima <span class="gg-in"><input type="number" id="gg-min" min="15" max="240" step="5"> min</span></label>
              <label>Sessão máxima <span class="gg-in"><input type="number" id="gg-max" min="15" max="240" step="5"> min</span></label>
            </div>
          </section>
          <section class="gg-sec">
            <div class="gg-prev-head"><h3 class="gg-h">Matérias da semana</h3><button type="button" class="btn-link gg-sugerir-calc" id="gg-sugerir-calc">🧮 Sugerir cálculo pelo nome</button></div>
            <p class="gg-hint">⭐ Prioritária = vai para os primeiros horários do dia. 🧮 Cálculo = não fica em sequência com outra de cálculo. As marcações também ficam em ⚙ Opções → Prioridades e cálculo.</p>
            <div class="gg-mats" id="gg-mats"></div>
          </section>
          <section class="gg-sec">
            <div class="gg-prev-head"><h3 class="gg-h">Prévia</h3><span class="gg-resumo" id="gg-resumo"></span></div>
            <div class="gg-avisos" id="gg-avisos"></div>
            <div class="gg-prev grade-scroll" id="gg-prev"></div>
          </section>
        </div>
        <div class="siglas-modal-foot gg-foot">
          <button type="button" class="btn-secondary" data-gg-fechar>Cancelar</button>
          <button type="button" class="btn-secondary" id="gg-outra">🔀 Outra sugestão</button>
          <button type="button" class="btn-primary" id="gg-aplicar">Aplicar na grade</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-gg-fechar]')) fechar(); });
    m.addEventListener('input', e => { if (e.target.closest('#gg-dias, #gg-mats, .gg-sess')) { lerForm(); gerarPrevia(); } });
    m.addEventListener('change', e => { if (e.target.closest('#gg-dias, #gg-mats, .gg-sess')) { lerForm(); gerarPrevia(); } });
    m.querySelector('#gg-outra').addEventListener('click', () => { st.semente++; gerarPrevia(); });
    m.querySelector('#gg-sugerir-calc').addEventListener('click', () => {
      const n = sugerirCalculo(st.form.materias);
      renderForm(); lerForm(); gerarPrevia();
      if (typeof showToast === 'function') showToast(n ? n + ' matéria(s) marcada(s) como cálculo — confira' : 'Nenhuma matéria com nome de cálculo encontrada');
    });
    m.querySelector('#gg-aplicar').addEventListener('click', aplicar);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.style.display !== 'none') fechar(); });
    return m;
  }

  function renderForm() {
    const s = st.form;
    document.getElementById('gg-min').value = s.minSess;
    document.getElementById('gg-max').value = s.maxSess;
    document.getElementById('gg-dias').innerHTML = s.dias.map((d, i) => `
      <label class="gg-dia ${d.ativo ? '' : 'off'}">
        <span class="gg-dia-top"><input type="checkbox" data-dia-ativo="${i}" ${d.ativo ? 'checked' : ''}><b>${d.dia.slice(0, 3)}</b></span>
        <span class="gg-in"><input type="number" data-dia-h="${i}" min="0" max="16" step="0.5" value="${Math.round(d.minutos / 30) / 2}" ${d.ativo ? '' : 'disabled'} aria-label="Horas em ${d.dia}"> h</span>
      </label>`).join('');
    const mats = document.getElementById('gg-mats');
    if (!s.materias.length) { mats.innerHTML = '<p class="gg-hint">Monte o ciclo da semana (ou cadastre matérias) para ter metas a distribuir.</p>'; return; }
    mats.innerHTML = s.materias.map((m, i) => `
      <div class="gg-mat">
        <span class="gg-mat-nome" title="${esc(m.nome)}"><b>${esc(sigla(m.nome))}</b> ${esc(m.nome)}</span>
        <span class="gg-in gg-mat-min"><input type="number" data-mat-min="${i}" min="0" step="15" value="${m.minutos}" aria-label="Minutos por semana de ${esc(m.nome)}"> min</span>
        <label class="gg-tog" title="Prioritária: primeiros horários do dia"><input type="checkbox" data-mat-pri="${i}" ${m.prioritaria ? 'checked' : ''}><span>⭐</span></label>
        <label class="gg-tog" title="Matéria de cálculo"><input type="checkbox" data-mat-calc="${i}" ${m.calculo ? 'checked' : ''}><span>🧮</span></label>
      </div>`).join('');
  }

  function lerForm() {
    const s = st.form, q = sel => document.querySelectorAll(sel);
    s.minSess = Math.max(15, Number(document.getElementById('gg-min').value) || 60);
    s.maxSess = Math.max(s.minSess, Number(document.getElementById('gg-max').value) || 120);
    q('[data-dia-ativo]').forEach(el => { const d = s.dias[+el.dataset.diaAtivo]; d.ativo = el.checked; el.closest('.gg-dia').classList.toggle('off', !el.checked); const h = el.closest('.gg-dia').querySelector('[data-dia-h]'); if (h) h.disabled = !el.checked; });
    q('[data-dia-h]').forEach(el => { s.dias[+el.dataset.diaH].minutos = Math.max(0, Math.round((Number(el.value) || 0) * 60)); });
    q('[data-mat-min]').forEach(el => { s.materias[+el.dataset.matMin].minutos = Math.max(0, Math.round(Number(el.value) || 0)); });
    q('[data-mat-pri]').forEach(el => { s.materias[+el.dataset.matPri].prioritaria = el.checked; });
    q('[data-mat-calc]').forEach(el => { s.materias[+el.dataset.matCalc].calculo = el.checked; });
    const dias = {}; s.dias.forEach(d => { dias[d.dia] = { ativo: d.ativo, minutos: d.minutos }; });
    // funde com as marcações de matérias que não estão nesta semana
    const materias = Object.assign({}, lerPrefs().materias || {}); s.materias.forEach(m => { materias[nk(m.nome)] = { prioritaria: m.prioritaria, calculo: m.calculo }; });
    gravarPrefs({ minSess: s.minSess, maxSess: s.maxSess, dias, materias });
  }

  function gerarPrevia() {
    const s = st.form;
    const r = G.gerar({ minSess: s.minSess, maxSess: s.maxSess, semente: st.semente,
      dias: s.dias.map(d => ({ dia: d.dia, minutos: d.ativo ? d.minutos : 0 })), materias: s.materias });
    st.ultimo = r;
    const meta = s.materias.reduce((a, m) => a + m.minutos, 0);
    const disp = s.dias.reduce((a, d) => a + (d.ativo ? d.minutos : 0), 0);
    const aloc = DIAS.reduce((a, d) => a + r.grade[d].reduce((x, c) => x + (c ? c.minutes : 0), 0), 0);
    document.getElementById('gg-resumo').textContent = `${fmt(aloc)} alocadas · meta ${fmt(meta)} · disponível ${fmt(disp)}`;
    document.getElementById('gg-avisos').innerHTML = r.avisos.map(a => `<p class="gg-aviso">⚠ ${esc(a)}</p>`).join('');
    const cor = n => CE() ? CE().colorForSubject(n) : '';
    let h = '<table class="gg-tab"><thead><tr><th></th>' + DIAS.map(d => `<th>${d.slice(0, 3)}</th>`).join('') + '</tr></thead><tbody>';
    for (let i = 0; i < r.sessoes; i++) {
      h += `<tr><td class="gg-sn">${i + 1}ª</td>` + DIAS.map(d => {
        const c = r.grade[d][i];
        if (!c) return '<td></td>';
        const m = s.materias.find(x => x.nome === c.subject) || {};
        return `<td><span class="gg-cel" title="${esc(c.subject)}"${cor(c.subject) ? ` style="--chip-color:${cor(c.subject)}"` : ''}><b>${esc(sigla(c.subject))}</b><small>${c.minutes}${m.prioritaria ? ' ⭐' : ''}${m.calculo ? ' 🧮' : ''}</small></span></td>`;
      }).join('') + '</tr>';
    }
    h += '</tbody></table>';
    document.getElementById('gg-prev').innerHTML = aloc ? h : '<p class="gg-hint">Nada para distribuir ainda: informe as metas das matérias e o tempo dos dias.</p>';
    document.getElementById('gg-aplicar').disabled = !aloc;
  }

  async function aplicar() {
    const r = st.ultimo; if (!r) return;
    const t = DB.getGradeTemplate();
    const temAlgo = DIAS.some(d => (t.grade && t.grade[d] || []).some(Boolean));
    if (temAlgo) {
      const ok = await UI.confirm('Substituir a grade atual pela sugestão? Uma cópia da grade atual fica guardada em "Grades salvas".', { title: '✨ Aplicar sugestão', okText: 'Substituir' });
      if (!ok) return;
      try { DB.addSavedGrade('Antes da sugestão ' + new Date().toLocaleDateString('pt-BR')); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'grade-gerador'); }
    }
    DB.saveGradeTemplate(Object.assign({}, t, { grade: JSON.parse(JSON.stringify(r.grade)), sessions: r.sessoes }));
    fechar();
    if (window.GradeScreen && GradeScreen.render) GradeScreen.render();
    if (typeof showToast === 'function') showToast('Grade sugerida aplicada ✓');
  }

  function sugerirCalculo(lista) {
    let n = 0; lista.forEach(m => { if (!m.calculo && G.pareceCalculo(m.nome)) { m.calculo = true; n++; } }); return n;
  }

  /* ⚙ Opções → Prioridades e cálculo: marca as matérias de qualquer área,
     mesmo fora do ciclo da semana. Mesmas marcações da janela de sugestão. */
  function materiasDoPlano() {
    const nomes = [], vistos = new Set(), add = n => { const k = nk(n); if (n && !vistos.has(k)) { vistos.add(k); nomes.push(n); } };
    metasDoCiclo().forEach(m => add(m.nome));
    try { DB.getActiveSubjects().forEach(s => add(s.nome)); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'grade-gerador'); }
    return nomes;
  }
  function abrirPrioridades() {
    let m = document.getElementById('grade-prioridades-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'grade-prioridades-modal'; m.className = 'siglas-modal grade-gerador-modal grade-prioridades-modal'; m.style.display = 'none';
      m.innerHTML = `
        <div class="siglas-modal-box" role="dialog" aria-modal="true" aria-labelledby="gp-titulo">
          <div class="siglas-modal-head">
            <div>
              <h2 id="gp-titulo">⭐ Prioridades e cálculo</h2>
              <p class="sub">Usadas pelo ✨ Sugerir grade. ⭐ Prioritária vai para os primeiros horários do dia; 🧮 Cálculo nunca fica em sequência com outra de cálculo.</p>
            </div>
            <button type="button" class="icon-btn" data-gp-fechar title="Fechar" aria-label="Fechar">✕</button>
          </div>
          <div class="siglas-modal-body gg-body">
            <div class="gg-prev-head"><span class="gg-resumo" id="gp-resumo"></span><button type="button" class="btn-link gg-sugerir-calc" id="gp-sugerir-calc">🧮 Sugerir cálculo pelo nome</button></div>
            <div class="gg-mats gp-mats" id="gp-mats"></div>
          </div>
          <div class="siglas-modal-foot gg-foot">
            <button type="button" class="btn-secondary" id="gp-limpar">Limpar marcações</button>
            <button type="button" class="btn-primary" id="gp-ok" data-gp-fechar>Concluído</button>
          </div>
        </div>`;
      document.body.appendChild(m);
      m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-gp-fechar]')) m.style.display = 'none'; });
      m.addEventListener('change', e => { if (e.target.closest('#gp-mats')) salvarPrioridades(); });
      m.querySelector('#gp-sugerir-calc').addEventListener('click', () => {
        const lista = st.gp; const n = sugerirCalculo(lista); desenharPrioridades(); salvarPrioridades();
        if (typeof showToast === 'function') showToast(n ? n + ' matéria(s) marcada(s) como cálculo — confira' : 'Nenhuma matéria com nome de cálculo encontrada');
      });
      m.querySelector('#gp-limpar').addEventListener('click', () => { st.gp.forEach(x => { x.prioritaria = false; x.calculo = false; }); desenharPrioridades(); salvarPrioridades(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.style.display !== 'none') m.style.display = 'none'; });
    }
    _mapaSiglas = null;
    const marc = lerPrefs().materias || {};
    st.gp = materiasDoPlano().map(nome => { const s = marc[nk(nome)] || {}; return { nome, prioritaria: !!s.prioritaria, calculo: !!s.calculo }; });
    desenharPrioridades();
    m.style.display = 'flex';
  }
  function desenharPrioridades() {
    const box = document.getElementById('gp-mats'), lista = st.gp || [];
    box.innerHTML = lista.length ? lista.map((x, i) => `
      <div class="gg-mat gp-mat">
        <span class="gg-mat-nome" title="${esc(x.nome)}"><b>${esc(sigla(x.nome))}</b> ${esc(x.nome)}</span>
        <label class="gg-tog" title="Prioritária: primeiros horários do dia"><input type="checkbox" data-gp-pri="${i}" ${x.prioritaria ? 'checked' : ''}><span>⭐</span></label>
        <label class="gg-tog" title="Matéria de cálculo"><input type="checkbox" data-gp-calc="${i}" ${x.calculo ? 'checked' : ''}><span>🧮</span></label>
      </div>`).join('') : '<p class="gg-hint">Cadastre matérias em Configurações ou monte o ciclo da semana.</p>';
    resumoPrioridades();
  }
  function resumoPrioridades() {
    const l = st.gp || [], el = document.getElementById('gp-resumo');
    if (el) el.textContent = `${l.filter(x => x.prioritaria).length} prioritária(s) · ${l.filter(x => x.calculo).length} de cálculo`;
  }
  function salvarPrioridades() {
    const l = st.gp || [];
    document.querySelectorAll('[data-gp-pri]').forEach(el => { l[+el.dataset.gpPri].prioritaria = el.checked; });
    document.querySelectorAll('[data-gp-calc]').forEach(el => { l[+el.dataset.gpCalc].calculo = el.checked; });
    const p = lerPrefs(); p.materias = Object.assign({}, p.materias || {});
    l.forEach(x => { p.materias[nk(x.nome)] = { prioritaria: x.prioritaria, calculo: x.calculo }; });
    gravarPrefs(p); resumoPrioridades();
  }

  function abrir() {
    const m = montarModal();
    _mapaSiglas = null;
    st.form = estadoInicial(); st.semente = 0;
    renderForm(); gerarPrevia();
    m.style.display = 'flex';
  }
  function fechar() { const m = document.getElementById('grade-gerador-modal'); if (m) m.style.display = 'none'; }

  window.GradeGerador.abrir = abrir;
  window.GradeGerador.fechar = fechar;
  window.GradeGerador.abrirPrioridades = abrirPrioridades;
  document.addEventListener('click', e => {
    if (e.target.closest('#btn-grade-sugerir')) { e.preventDefault(); abrir(); }
    else if (e.target.closest('#btn-grade-prioridades')) { e.preventDefault(); abrirPrioridades(); }
  });
})();
