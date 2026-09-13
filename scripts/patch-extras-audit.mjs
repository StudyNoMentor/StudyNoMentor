#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');
const write = (p, s) => writeFileSync(p, s);
function once(src, old, neu, rot) {
  const n = src.split(old).length - 1;
  if (n !== 1) throw new Error(`${rot}: esperava 1 ocorrência, encontrei ${n}`);
  return src.replace(old, neu);
}
function between(src, ini, fim, neu, rot) {
  const a = src.indexOf(ini), b = src.indexOf(fim, a + ini.length);
  if (a < 0 || b < 0 || src.indexOf(ini, a + 1) >= 0) throw new Error(`${rot}: fronteira não única/encontrada`);
  return src.slice(0, a) + neu + src.slice(b);
}

const jsPath = 'src/js/47-tela-extras.js';
let js = read(jsPath);

js = once(js,
`    const gt = document.getElementById('extras-global-toggle');
    if (gt) gt.classList.toggle('on', DB.extrasCountGlobal());`,
`    const gt = document.getElementById('extras-global-toggle');
    if (gt) {
      const on = DB.extrasCountGlobal();
      gt.classList.toggle('on', on);
      gt.setAttribute('aria-checked', on ? 'true' : 'false');
    }`, 'switch global acessível');

const cursoNovo = `  /* ── REFERÊNCIA OPERACIONAL DO PLANO ───────────────────────────────────────
     Criar/sugerir uma atividade é uma DECISÃO analítica e respeita o período
     escolhido no Desempenho TEC. Medir uma atividade JÁ CRIADA é outra coisa:
     é histórico operacional e não pode andar para trás quando o usuário troca
     o filtro da Análise. Esta referência usa todos os retratos e fica cacheada
     só durante uma repintura da tela. */
  _planoRefOperacional() {
    if (this._planoRefCard) return this._planoRefCard;
    try {
      const snaps = DB.getTecSnapshots() || [];
      const agregado = snaps.length && DesempenhoTecScreen && typeof DesempenhoTecScreen.aggregate === 'function'
        ? DesempenhoTecScreen.aggregate(snaps) : null;
      this._planoRefCard = PlanoEngine.calcular(agregado, PlanoEngine.prefs());
    } catch (e) { _quiet(e, 'extras-plano-operacional'); this._planoRefCard = { erro: 'sem-retrato' }; }
    return this._planoRefCard;
  },
  /* Progresso de uma recorrência NO PERÍODO DO DIA QUE ESTÁ NA TELA. O helper
     global é intencionalmente orientado a "hoje"; usá-lo ao visitar uma semana
     antiga mostrava os números da semana atual dentro do cartão antigo. */
  _progressoNoPeriodo(x, day) {
    const hist = (x && x.historico) || [];
    if (!x || !DB.extraRecorrente(x)) return Math.max(0, Number(x && x.progresso) || 0);
    day = day || todayLocal();
    const base = new Date(day + 'T00:00:00');
    let ini = day, fim = day;
    if (x.periodo === 'semanal') {
      const a = new Date(base); a.setDate(a.getDate() - ((a.getDay() + 6) % 7));
      const b = new Date(a); b.setDate(b.getDate() + 6);
      ini = this._addDays(day, -((base.getDay() + 6) % 7));
      fim = this._addDays(ini, 6);
    } else if (x.periodo === 'quinzenal') {
      ini = this._addDays(day, -13);
    } else if (x.periodo === 'mensal') {
      const a = new Date(base.getFullYear(), base.getMonth(), 1);
      const b = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      ini = DB._isoDia(a); fim = DB._isoDia(b);
    }
    return hist.filter(h => h.data >= ini && h.data <= fim)
      .reduce((n, h) => n + (Number(h.quantidade) || 0), 0);
  },
  /* ── REFORÇOS EM CURSO ────────────────────────────────────────────────────
     Fila operacional compacta. Ela não agenda automaticamente: o ritmo diário
     é derivado do saldo e da próxima importação; "Ver hoje" apenas leva à
     atividade na agenda, sem transformar uma pendência flutuante em data fixa. */
  renderEmCurso() {
    const host = document.getElementById('extras-curso');
    if (!host) return;
    let itens = [];
    try { itens = PlanoCiclo.emCurso(this._planoRefOperacional()); }
    catch (e) { _quiet(e, 'curso'); }
    if (!itens.length) { host.innerHTML = ''; return; }
    const aberto = this._cursoAberto !== false;
    const totalFalta = itens.reduce((a, v) => a + Math.max(0, v.alvo - v.feito), 0);
    const totalAlvo = itens.reduce((a, v) => a + v.alvo, 0);
    const feito = totalAlvo - totalFalta;
    const discs = [...new Set(itens.map(v => v.origem.disciplina || 'Sem disciplina'))];
    let dias = 0;
    try {
      const p = PlanoEngine.prefs();
      const snaps = DB.getTecSnapshots();
      const ult = snaps[snaps.length - 1];
      const idade = ult ? PlanoEngine._diasDesde(ult.endDate || ult.date) : 0;
      dias = Math.max(1, (p.cadenciaDias || 30) - idade);
    } catch (e) { _quiet(e, 'curso-dias'); }
    const porDia = totalFalta > 0 ? Math.max(1, Math.ceil(totalFalta / dias)) : 0;
    const SELO = {
      funcionou: ['✓', 'tone-good', 'Meta atingida'],
      naoFuncionou: ['!', 'tone-bad', 'Reavaliar'],
      subiu: ['↗', 'tone-good', 'Evoluindo'],
      mediu: ['◉', 'incid', 'Medido'],
      andamento: ['•', 'incid', 'Em curso'],
      orfa: ['?', '', 'Sem vínculo TEC']
    };
    const linha = (v) => {
      const [ic, tom, rot] = SELO[v.estado] || SELO.andamento;
      const falta = Math.max(0, v.alvo - v.feito);
      const evo = (v.origem.taxaInicial != null && v.taxa != null)
        ? `<span title="Aproveitamento quando a atividade nasceu → aproveitamento atual"><b>${v.origem.taxaInicial.toFixed(0)}%</b> → <b class="tone-${v.delta != null && v.delta >= 0 ? 'good' : 'bad'}">${v.taxa.toFixed(0)}%</b></span>` : '';
      return `<li class="exc-item" data-id="${escapeHtml(v.extra.id)}">
        <div class="exc-item-head">
          <span class="exc-item-name">${escapeHtml(v.origem.topico)}</span>
          <span class="exc-status ${tom}"><i>${ic}</i>${rot}</span>
        </div>
        <div class="exc-progress"><div class="exc-bar"><i style="width:${v.pct}%"></i></div><span>${v.pct}%</span></div>
        <div class="exc-item-foot">
          <div class="exc-meta">
            <span><b>${v.feito}</b> / ${v.alvo} questões</span>
            ${falta > 0 ? `<span><b>${falta}</b> restantes</span>` : '<span class="tone-good"><b>meta cumprida</b></span>'}
            ${evo}
          </div>
          <div class="exc-actions">
            <button type="button" class="exc-btn exc-btn-primary" data-curso-dia="${escapeHtml(v.extra.id)}">Ver hoje</button>
            <button type="button" class="exc-btn" data-curso-fim="${escapeHtml(v.extra.id)}">Concluir</button>
            <button type="button" class="exc-btn exc-btn-danger" data-curso-del="${escapeHtml(v.extra.id)}" title="Excluir atividade" aria-label="Excluir atividade">Excluir</button>
          </div>
        </div>
      </li>`;
    };
    host.innerHTML = `
      <div class="card exc-card">
        <button type="button" class="exc-head" id="exc-toggle" aria-expanded="${aberto}">
          <span class="exc-brand"><span class="exc-brand-ico">🏁</span><span>Reforços em curso</span></span>
          <span class="exc-kpis" aria-label="Resumo dos reforços em curso">
            <span class="exc-kpi"><b>${itens.length}</b> ativos</span>
            <span class="exc-kpi"><b>${feito}</b> / ${totalAlvo} questões</span>
            ${totalFalta > 0 ? `<span class="exc-kpi exc-kpi-ritmo"><b>${porDia}/dia</b><span> · ${dias}d</span></span>` : '<span class="exc-kpi tone-good"><b>metas cumpridas</b></span>'}
          </span>
          <span class="chev" aria-hidden="true">${aberto ? '▴' : '▾'}</span>
        </button>
        ${aberto ? discs.map(d => {
          const doGrupo = itens.filter(v => (v.origem.disciplina || 'Sem disciplina') === d);
          return `<div class="exc-grupo">
            <div class="exc-disc-row"><p class="exc-disc">${escapeHtml(d)}</p><span class="exc-disc-count">${doGrupo.length}</span></div>
            <ul class="exc-lista">${doGrupo.map(linha).join('')}</ul>
          </div>`;
        }).join('') : ''}
      </div>`;
    const tg = document.getElementById('exc-toggle');
    if (tg) tg.addEventListener('click', () => { this._cursoAberto = !aberto; this.renderEmCurso(); });
    /* Navegar é diferente de agendar. Atividade única do Plano sem `datas`
       já aparece em "A fazer" todos os dias enquanto estiver aberta. Fixá-la
       em hoje faria ela desaparecer amanhã. */
    host.querySelectorAll('[data-curso-dia]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.cursoDia;
      const hoje = todayLocal();
      this.selDay = hoje; this._calStart = this._addDays(hoje, -3); this.render();
      setTimeout(() => {
        const alvo = [...document.querySelectorAll('#extras-list .exd')].find(el => el.dataset.id === id);
        if (alvo) { try { alvo.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { _quiet(e, 'curso-scroll'); } }
      }, 0);
    }));
    host.querySelectorAll('[data-curso-fim]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.cursoFim;
      const v = itens.find(x => String(x.extra.id) === String(id));
      if (v && v.feito < v.alvo) {
        const falta = Math.max(0, v.alvo - v.feito);
        const ok = await UI.confirm(`Ainda faltam ${falta} questões para a meta deste reforço. Concluir agora encerra o ciclo mesmo assim.`,
          { title: 'Concluir antes da meta?', okText: 'Concluir mesmo assim' });
        if (!ok) return;
      }
      DB.setConcluidaDia(id, todayLocal(), true);
      showToast('Reforço concluído ✓'); this.render();
    }));
    host.querySelectorAll('[data-curso-del]').forEach(b => b.addEventListener('click', async () => {
      const e = DB.getExtras().find(x => x.id === b.dataset.cursoDel);
      if (!e) return;
      if (!await UI.confirm('Excluir "' + e.titulo + '"? O histórico desta atividade também será removido.', { title: 'Excluir atividade', okText: 'Excluir', danger: true })) return;
      DB.deleteExtra(e.id); showToast('Atividade excluída'); this.render();
    }));
  },
`;
js = between(js, '  renderEmCurso() {', '  // ── Ocorrências de um dia', cursoNovo, 'renderEmCurso');

js = once(js,
`    let feito = !rec ? (x.progresso || 0) : (diaria ? feitoDia : DB.extraProgressoPeriodo(x));`,
`    let feito = !rec ? (x.progresso || 0) : (diaria ? feitoDia : this._progressoNoPeriodo(x, day));`, 'progresso histórico por período');

js = once(js,
`        ciclo = PlanoCiclo.avaliar(x, this._planoRefCard || (this._planoRefCard =
          PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(), PlanoEngine.prefs())));`,
`        ciclo = PlanoCiclo.avaliar(x, this._planoRefOperacional());`, 'ciclo operacional no cartão');

js = once(js,
`    const totalDia = regsDia.reduce((a, h) => a + (h.quantidade || 0), 0);
    const acertosDia = regsDia.reduce((a, h) => a + (h.acertos != null ? (parseFloat(h.acertos) || 0) : 0), 0);`,
`    const totalDia = regsDia.reduce((a, h) => a + (h.quantidade || 0), 0);
    const totalMin = regsDia.reduce((a, h) => a + (parseFloat(h.minutos) || 0), 0);
    const acertosDia = regsDia.reduce((a, h) => a + (h.acertos != null ? (parseFloat(h.acertos) || 0) : 0), 0);`, 'total de minutos do dia');

js = once(js,
`              ${x.tipo === 'questoes' ? `<input type="number" inputmode="numeric" class="exd-num exd-ac" min="0" placeholder="acertos" title="Acertos (opcional)" aria-label="Acertos (opcional)">` : ''}
              <button type="button" class="btn-primary exd-reg-btn">Registrar</button>`,
`              ${x.tipo === 'questoes' ? `<input type="number" inputmode="numeric" class="exd-num exd-ac" min="0" placeholder="acertos" title="Acertos (opcional)" aria-label="Acertos (opcional)">` : ''}
              ${!emMin ? `<input type="number" inputmode="numeric" class="exd-num exd-min" min="0" placeholder="min" title="Tempo gasto em minutos (opcional)" aria-label="Tempo gasto em minutos (opcional)">` : ''}
              <button type="button" class="btn-primary exd-reg-btn">Registrar</button>`, 'campo opcional de minutos');

js = once(js,
`             <span class="exd-doneinfo">✓ <b>${totalDia.toLocaleString('pt-BR')}</b> ${escapeHtml(unidLabel)} registrado(s) neste dia${temAcertos ? ` · <b>${acertosDia.toLocaleString('pt-BR')}</b> acerto(s)` : ''}</span>`,
`             <span class="exd-doneinfo">✓ <b>${totalDia.toLocaleString('pt-BR')}</b> ${escapeHtml(unidLabel)} registrado(s) neste dia${temAcertos ? ` · <b>${acertosDia.toLocaleString('pt-BR')}</b> acerto(s)` : ''}${totalMin > 0 && !emMin ? ` · <b>${totalMin.toLocaleString('pt-BR')}</b> min` : ''}</span>`, 'resumo concluído com tempo');

js = once(js,
`              <span class="exd-reg-value">✓ ${totalDia.toLocaleString('pt-BR')} ${escapeHtml(unidLabel)} no dia${temAcertos ? ` · ${acertosDia.toLocaleString('pt-BR')} acerto(s)` : ''}</span>`,
`              <span class="exd-reg-value">✓ ${totalDia.toLocaleString('pt-BR')} ${escapeHtml(unidLabel)} no dia${temAcertos ? ` · ${acertosDia.toLocaleString('pt-BR')} acerto(s)` : ''}${totalMin > 0 && !emMin ? ` · ${totalMin.toLocaleString('pt-BR')} min` : ''}</span>`, 'registro salvo com tempo');

js = once(js,
`        const acEl = card.querySelector('.exd-ac');
        const q = qEl ? qEl.value : '';`,
`        const acEl = card.querySelector('.exd-ac');
        const minEl = card.querySelector('.exd-min');
        const q = qEl ? qEl.value : '';`, 'ler minutos');
js = once(js,
`        DB.addExtraProgress(id, q, 0, { data: day, acertos: acEl ? acEl.value : null });`,
`        const min = minEl && minEl.value !== '' ? minEl.value : 0;
        DB.addExtraProgress(id, q, min, { data: day, acertos: acEl ? acEl.value : null });`, 'gravar minutos');

js = once(js,
`        const campos = [{ key: 'quantidade', label: 'Novo valor', type: 'number', value: String(atual.quantidade || ''), min: 0 }];
        if (xAtual.tipo === 'questoes') campos.push({ key: 'acertos', label: 'Acertos', type: 'number', value: atual.acertos == null ? '' : String(atual.acertos), min: 0 });`,
`        const campos = [{ key: 'quantidade', label: 'Novo valor', type: 'number', value: String(atual.quantidade || ''), min: 0 }];
        const atualEmMin = xAtual.tipo === 'video' || xAtual.unidade === 'min';
        if (xAtual.tipo === 'questoes') campos.push({ key: 'acertos', label: 'Acertos', type: 'number', value: atual.acertos == null ? '' : String(atual.acertos), min: 0 });
        if (!atualEmMin) campos.push({ key: 'minutos', label: 'Minutos (opcional)', type: 'number', value: atual.minutos ? String(atual.minutos) : '', min: 0 });`, 'editar minutos');
js = once(js,
`          DB.addExtraProgress(id, novo, 0, { data: day, acertos: v.acertos == null ? null : v.acertos });`,
`          DB.addExtraProgress(id, novo, v.minutos == null || v.minutos === '' ? 0 : v.minutos, { data: day, acertos: v.acertos == null ? null : v.acertos });`, 'preservar minutos ao editar');

js = once(js,
`    const dates = [...new Set([...(x.datas || []), ...(x.concluidasEm || []), ...(x.historico || []).map(h => h.data)])].sort();`,
`    const dates = [...new Set([dia, ...(x.datas || []), ...(x.concluidasEm || []), ...(x.historico || []).map(h => h.data)].filter(Boolean))].sort();`, 'ocorrência atual no seletor');

js = once(js,
`      // mantém as marcações por NOME do assunto ao reordenar
      const marcadosNomes = new Set([...this._planoSel].map(i => (cand[i] || {}).nome).filter(Boolean));
      this._planoSel = new Set();
      (this._planoCand || []).forEach((x, i) => { if (marcadosNomes.has(x.nome)) this._planoSel.add(i); });`,
`      // disciplina + nome: tópicos homônimos de matérias diferentes são unidades distintas
      const chave = (x) => x ? ReforcoEngine.norm(x.disciplina || '') + ReforcoEngine.SEP + ReforcoEngine.norm(x.nome || '') : '';
      const marcados = new Set([...this._planoSel].map(i => chave(cand[i])).filter(Boolean));
      this._planoSel = new Set();
      (this._planoCand || []).forEach((x, i) => { if (marcados.has(chave(x))) this._planoSel.add(i); });`, 'preservar homônimos');

js = once(js,
`  save() {
    const titulo = $id('extra-titulo').value.trim();
    if (!titulo) { showToast('Dê um título à atividade'); return; }
    const data = {`,
`  save() {
    const titulo = $id('extra-titulo').value.trim();
    if (!titulo) { showToast('Dê um título à atividade'); return; }
    const anterior = this._editingId ? DB.getExtra(this._editingId) : null;
    const periodo = $id('extra-periodo').value;
    const dataInicio = document.getElementById('extra-datainicio') ? $id('extra-datainicio').value : '';
    const dataFim = document.getElementById('extra-datafim') ? $id('extra-datafim').value : '';
    const recorrente = ['diaria', 'semanal', 'quinzenal', 'mensal'].includes(periodo);
    if (recorrente && dataInicio && dataFim && dataInicio > dataFim) {
      showToast('O início da recorrência não pode ser depois do fim'); return;
    }
    const data = {`, 'validação da recorrência');
js = once(js,
`      periodo: $id('extra-periodo').value,
      dataInicio: document.getElementById('extra-datainicio') ? $id('extra-datainicio').value : '',
      dataFim: document.getElementById('extra-datafim') ? $id('extra-datafim').value : '',`,
`      periodo,
      dataInicio,
      dataFim,`, 'usar recorrência validada');

js = once(js,
`    // recorrência com data-fim: recalcula e vincula as ocorrências ao calendário
    if (savedId) {
      const nDatas = (DB.getExtra(savedId) || {}).datas || [];
      DB.sincronizarDatasRecorrencia(savedId);
      const nova = (DB.getExtra(savedId) || {}).datas || [];
      if (data.periodo !== 'unica' && data.dataFim && nova.length) showToast(`📅 ${nova.length} data(s) vinculadas ao calendário ✓`);
    }`,
`    // Mudança de modelo não pode carregar datas geradas pela recorrência antiga.
    if (savedId) {
      const eraRecorrente = !!(anterior && DB.extraRecorrente(anterior));
      if (!recorrente && eraRecorrente) {
        DB.updateExtra(savedId, { datas: [], concluidasEm: [], excluidasEm: [], dataInicio: null, dataFim: null });
      } else if (recorrente && data.dataFim) {
        DB.sincronizarDatasRecorrencia(savedId);
        const nova = (DB.getExtra(savedId) || {}).datas || [];
        if (nova.length) showToast(`📅 ${nova.length} data(s) vinculadas ao calendário ✓`);
      } else if (recorrente && anterior && (!DB.extraRecorrente(anterior) || anterior.dataFim)) {
        // sem fim = recorrência calculada na hora; datas materializadas antigas a limitariam
        DB.updateExtra(savedId, { datas: [] });
      }
    }`, 'transição de recorrência');

js = once(js,
`  on('extras-global-toggle', 'click', () => {
    DB.setExtrasCountGlobal(!DB.extrasCountGlobal());
    $id('extras-global-toggle').classList.toggle('on', DB.extrasCountGlobal());
    showToast(DB.extrasCountGlobal() ? 'Atividades marcadas entram nas métricas' : 'Atividades fora das métricas');
  });`,
`  on('extras-global-toggle', 'click', () => {
    DB.setExtrasCountGlobal(!DB.extrasCountGlobal());
    const on = DB.extrasCountGlobal();
    const bt = $id('extras-global-toggle');
    bt.classList.toggle('on', on); bt.setAttribute('aria-checked', on ? 'true' : 'false');
    showToast(on ? 'Atividades marcadas entram nas métricas' : 'Atividades fora das métricas');
  });`, 'aria do switch global');

write(jsPath, js);

let html = read('src/html/05-corpo-cont.html');
html = once(html,
`      <p class="page-subtitle">Metas paralelas ao seu planejamento obrigatório: baralhos de Anki, leitura de lei seca, questões de um assunto, revisão de pontos fracos, vídeos e revisões de véspera. Você decide, por atividade, se ela entra ou não nas métricas de Evolução.</p>`,
`      <p class="page-subtitle">Execute e acompanhe metas complementares ao ciclo: reforços do Plano, questões, Anki, lei seca e revisões. A agenda organiza o dia; o painel acompanha o que continua em aberto.</p>`, 'subtítulo profissional');
html = once(html,
`        <span>Incluir Atividades Extras (marcadas) nas métricas de Evolução</span>`,
`        <span>Incluir atividades marcadas nas métricas de Evolução</span>`, 'rótulo do switch');
write('src/html/05-corpo-cont.html', html);

let css = read('src/css/08-ux-v49.css');
const marker = '/* 8. ATIVIDADES EXTRAS — FILA OPERACIONAL PROFISSIONAL */';
if (css.includes(marker)) throw new Error('CSS de Atividades já aplicado');
css += `\n\n/* ---------------------------------------------------------------------------\n   8. ATIVIDADES EXTRAS — FILA OPERACIONAL PROFISSIONAL\n   --------------------------------------------------------------------------- */\n#screen-extras #extras-curso { margin: 14px 0 16px; }\n#screen-extras .exc-card { padding: 0; overflow: hidden; border-color: var(--border); }\n#screen-extras .exc-head {\n  width: 100%; display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center;\n  gap: 10px 14px; padding: 11px 16px; background: var(--surface); border: 0;\n  color: var(--text); text-align: left; cursor: pointer;\n}\n#screen-extras .exc-head:hover { background: var(--surface-sunken); }\n#screen-extras .exc-brand { display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-xs); font-weight: 800; white-space: nowrap; }\n#screen-extras .exc-brand-ico { font-size: var(--fs-sm); line-height: 1; }\n#screen-extras .exc-kpis { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }\n#screen-extras .exc-kpi {\n  display: inline-flex; align-items: baseline; gap: 3px; padding: 3px 8px; border-radius: var(--r-pill);\n  background: var(--surface-sunken); border: 1px solid var(--border); color: var(--text-soft);\n  font-size: var(--fs-3xs); line-height: 1.25; white-space: nowrap;\n}\n#screen-extras .exc-kpi b { color: var(--text); font-weight: 800; font-variant-numeric: tabular-nums; }\n#screen-extras .exc-kpi-ritmo { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); }\n#screen-extras .exc-kpi-ritmo b { color: var(--accent-text); }\n#screen-extras .exc-head .chev { color: var(--text-faint); font-size: var(--fs-2xs); justify-self: end; }\n#screen-extras .exc-grupo { padding: 0 16px 4px; border-top: 1px solid var(--border); }\n#screen-extras .exc-disc-row { display: flex; align-items: center; gap: 7px; padding: 10px 0 4px; }\n#screen-extras .exc-disc { margin: 0; min-width: 0; font-size: var(--fs-3xs); font-weight: 800; text-transform: uppercase; letter-spacing: .045em; color: var(--text-faint); }\n#screen-extras .exc-disc-count {\n  display: inline-flex; min-width: 18px; height: 18px; align-items: center; justify-content: center;\n  border-radius: var(--r-pill); background: var(--surface-sunken); color: var(--text-faint);\n  font-size: calc(9px * var(--fs-scale,1)); font-weight: 800; border: 1px solid var(--border);\n}\n#screen-extras .exc-lista { list-style: none; margin: 0; padding: 0; }\n#screen-extras .exc-item { padding: 10px 0 11px; border-top: 1px solid color-mix(in srgb, var(--border) 76%, transparent); }\n#screen-extras .exc-item:first-child { border-top: 0; }\n#screen-extras .exc-item-head { display: flex; align-items: center; gap: 8px; min-width: 0; }\n#screen-extras .exc-item-name { flex: 1 1 auto; min-width: 0; font-size: var(--fs-xs); font-weight: 750; line-height: 1.3; color: var(--text); }\n#screen-extras .exc-status {\n  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; border-radius: var(--r-pill);\n  padding: 2px 7px; background: var(--surface-sunken); border: 1px solid var(--border);\n  color: var(--text-soft); font-size: calc(9px * var(--fs-scale,1)); font-weight: 800; line-height: 1.2; white-space: nowrap;\n}\n#screen-extras .exc-status i { font-style: normal; font-size: var(--fs-3xs); }\n#screen-extras .exc-status.tone-good { color: var(--good-text); background: var(--good-soft); border-color: color-mix(in srgb, var(--good) 32%, var(--border)); }\n#screen-extras .exc-status.tone-bad { color: var(--bad-text); background: var(--bad-soft); border-color: color-mix(in srgb, var(--bad) 28%, var(--border)); }\n#screen-extras .exc-status.incid { color: var(--accent-text); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 25%, var(--border)); }\n#screen-extras .exc-progress { display: grid; grid-template-columns: minmax(0,1fr) 28px; align-items: center; gap: 8px; margin-top: 6px; }\n#screen-extras .exc-bar { height: 4px; border-radius: var(--r-pill); background: var(--border); overflow: hidden; }\n#screen-extras .exc-bar > i { display: block; height: 100%; border-radius: inherit; background: var(--accent); }\n#screen-extras .exc-progress > span { text-align: right; color: var(--text-faint); font-size: calc(9px * var(--fs-scale,1)); font-weight: 700; font-variant-numeric: tabular-nums; }\n#screen-extras .exc-item-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px 14px; margin-top: 6px; }\n#screen-extras .exc-meta { display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; min-width: 0; color: var(--text-soft); font-size: var(--fs-3xs); }\n#screen-extras .exc-meta b { color: var(--text); font-weight: 800; font-variant-numeric: tabular-nums; }\n#screen-extras .exc-actions { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; }\n#screen-extras .exc-btn {\n  min-height: 28px; padding: 4px 9px; border: 1px solid var(--border); border-radius: var(--r-sm);\n  background: var(--surface); color: var(--text-soft); font: inherit; font-size: var(--fs-3xs); font-weight: 750;\n  line-height: 1.2; cursor: pointer; text-decoration: none; white-space: nowrap;\n}\n#screen-extras .exc-btn:hover, #screen-extras .exc-btn:focus-visible { border-color: var(--accent); color: var(--accent-text); background: var(--accent-soft); }\n#screen-extras .exc-btn-primary { color: var(--accent-text); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 28%, var(--border)); }\n#screen-extras .exc-btn-danger { color: var(--bad-text); }\n#screen-extras .exc-btn-danger:hover, #screen-extras .exc-btn-danger:focus-visible { border-color: var(--bad-text); color: var(--bad-text); background: var(--bad-soft); }\n/* Minutos é opcional; fica estreito para não transformar três campos curtos numa linha de formulário gigante. */\n#screen-extras .exd-reg-group .exd-min { max-width: 76px; }\n@media (max-width: 620px) {\n  #screen-extras .exc-head { grid-template-columns: minmax(0,1fr) auto; gap: 8px; padding: 10px 12px; }\n  #screen-extras .exc-kpis { grid-column: 1 / -1; order: 3; }\n  #screen-extras .exc-grupo { padding-left: 12px; padding-right: 12px; }\n  #screen-extras .exc-item-head { align-items: flex-start; }\n  #screen-extras .exc-item-foot { align-items: flex-start; flex-direction: column; }\n  #screen-extras .exc-actions { width: 100%; }\n  #screen-extras .exc-btn { flex: 1 1 auto; text-align: center; }\n}\n`;
write('src/css/08-ux-v49.css', css);

const test = `#!/usr/bin/env node\nimport { readFileSync } from 'node:fs';\nconst js = readFileSync('src/js/47-tela-extras.js','utf8');\nconst css = readFileSync('src/css/08-ux-v49.css','utf8');\nconst html = readFileSync('src/html/05-corpo-cont.html','utf8');\nconst ok = (c,m) => { if (!c) { console.error('FALHA:',m); process.exit(1); } };\nok(js.includes('_planoRefOperacional()'), 'atividade aberta não tem referência operacional');\nok(js.includes('DesempenhoTecScreen.aggregate(snaps)'), 'referência operacional não agrega todos os retratos');\nok(!js.includes('DB.toggleExtraData(b.dataset.cursoDia'), 'Ver hoje ainda fixa/desfixa a atividade no calendário');\nok(js.includes('>Ver hoje</button>'), 'ação navegacional de hoje ausente');\nok(js.includes("title: 'Concluir antes da meta?'"), 'conclusão antecipada não pede confirmação');\nok(js.includes('_progressoNoPeriodo(x, day)'), 'cartão histórico continua usando o período de hoje');\nok(js.includes('class=\\"exd-num exd-min\\"'), 'registro não oferece minutos opcionais');\nok(js.includes('DB.addExtraProgress(id, q, min,'), 'minutos não chegam ao banco');\nok(js.includes("label: 'Minutos (opcional)'"), 'edição não preserva minutos');\nok(js.includes('const dates = [...new Set([dia,'), 'seletor de exclusão pode nascer vazio na ocorrência calculada');\nok(js.includes("ReforcoEngine.norm(x.disciplina || '') + ReforcoEngine.SEP"), 'reordenação ainda confunde homônimos entre disciplinas');\nok((js.match(/setAttribute\\('aria-checked'/g)||[]).length >= 2, 'switch global não sincroniza aria-checked');\nok(js.includes('O início da recorrência não pode ser depois do fim'), 'intervalo de recorrência invertido não é bloqueado');\nok(js.includes('datas: [], concluidasEm: [], excluidasEm: []'), 'troca recorrente → única mantém resíduos da série');\nok(css.includes('ATIVIDADES EXTRAS — FILA OPERACIONAL PROFISSIONAL'), 'camada visual profissional ausente');\nok(css.includes('.exc-btn') && css.includes('.exc-kpi') && css.includes('.exc-item'), 'componentes compactos do painel ausentes');\nok(html.includes('A agenda organiza o dia; o painel acompanha o que continua em aberto.'), 'hierarquia textual da página não foi enxugada');\nconsole.log('OK: Atividades Extras — fronteiras, recorrência, minutos, homônimos, acessibilidade e fila compacta protegidos.');\n`;
write('testes/atividades-extras.mjs', test);

let ver = read('verificar.mjs');
ver = once(ver,
`// ── 4. integridade estática do HTML ────────────────────────────────────────`,
`// ── 3d. ATIVIDADES EXTRAS ──────────────────────────────────────────────────
console.log('\\n3d) contrato operacional das Atividades Extras');
try {
  const saida = execFileSync(process.execPath, [join(RAIZ, 'testes', 'atividades-extras.mjs')], { stdio: 'pipe' });
  ok(String(saida).trim());
} catch (e) {
  erro('a tela de Atividades Extras perdeu uma invariante:\\n' + String(e.stdout || '') + String(e.stderr || ''));
}

// ── 4. integridade estática do HTML ────────────────────────────────────────`, 'registrar teste rápido');
ver = once(ver,
`      itens: painel.querySelectorAll('.pl-ciclo-lista > li').length,
      resumo: (painel.querySelector('.exc-resumo') || {}).textContent.replace(/\\s+/g, ' '),
      semDatas: !DB.getExtras().some((e) => (e.datas || []).length),`,
`      itens: painel.querySelectorAll('.exc-item').length,
      ritmo: (painel.querySelector('.exc-kpi-ritmo') || {}).textContent.replace(/\\s+/g, ' '),
      kpis: painel.querySelectorAll('.exc-kpi').length,
      botoes: [...painel.querySelectorAll('.exc-btn')].map(b => b.textContent.trim()),
      sublinhados: [...painel.querySelectorAll('.exc-btn')].filter(b => getComputedStyle(b).textDecorationLine !== 'none').length,
      semDatas: !DB.getExtras().some((e) => (e.datas || []).length),`, 'métricas visuais no Chromium');
ver = once(ver,
`  (/\\/dia até a próxima importação/.test(g.resumo) && g.semDatas)
    ? ok('com ritmo por dia calculado na hora, e nenhuma atividade amarrada a uma data')
    : erro('o ritmo derivado falhou: ' + JSON.stringify({ resumo: g.resumo, semDatas: g.semDatas }));`,
`  (/\\/dia/.test(g.ritmo) && g.semDatas)
    ? ok('com ritmo por dia calculado na hora, e nenhuma atividade amarrada a uma data')
    : erro('o ritmo derivado falhou: ' + JSON.stringify({ ritmo: g.ritmo, semDatas: g.semDatas }));
  (g.kpis >= 3 && g.sublinhados === 0 && g.botoes.includes('Ver hoje') && g.botoes.includes('Concluir'))
    ? ok('painel em curso usa KPIs e ações compactas, sem links gigantes/sublinhados')
    : erro('acabamento do painel em curso regrediu: ' + JSON.stringify(g));`, 'teste visual compacto');

/* Insere dois testes comportamentais imediatamente antes do comentário de simplicidade. */
ver = once(ver,
`  /* SIMPLICIDADE VEM DE MOVER, NÃO DE SOMAR: o Plano abre mao do painel e`,
`  /* "Ver hoje" é NAVEGAÇÃO: não pode prender a atividade à data e fazê-la
     desaparecer amanhã. */
  const navHoje = await pag.evaluate(() => {
    const antes = DB.getExtras().filter(e => e.origemPlano && e.status !== 'concluida').map(e => [e.id, (e.datas || []).slice()]);
    const b = document.querySelector('#extras-curso [data-curso-dia]');
    if (!b) return { faltando: true };
    const id = b.dataset.cursoDia; b.click();
    const depois = DB.getExtra(id);
    return { datas: (depois && depois.datas) || [], sel: ExtrasScreen.selDay, hoje: todayLocal() };
  });
  (!navHoje.faltando && navHoje.datas.length === 0 && navHoje.sel === navHoje.hoje)
    ? ok('"Ver hoje" navega para a tarefa sem fixar uma data nem alterar o ciclo')
    : erro('"Ver hoje" alterou dados: ' + JSON.stringify(navHoje));

  /* O switch é um controle semântico, não só uma bolinha visual. */
  const ariaExtra = await pag.evaluate(() => {
    DB.setExtrasCountGlobal(false); ExtrasScreen.render();
    const b = document.getElementById('extras-global-toggle');
    const antes = b && b.getAttribute('aria-checked');
    if (b) b.click();
    return { antes, depois: b && b.getAttribute('aria-checked'), valor: DB.extrasCountGlobal() };
  });
  (ariaExtra.antes === 'false' && ariaExtra.depois === 'true' && ariaExtra.valor)
    ? ok('switch das métricas sincroniza estado visual, dado e aria-checked')
    : erro('switch global inconsistente: ' + JSON.stringify(ariaExtra));

  /* Uma meta semanal antiga tem de mostrar a semana antiga, não a semana de
     hoje. E uma atividade de questões precisa conseguir registrar minutos. */
  const histExtra = await pag.evaluate(() => {
    const add = (iso,n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
    const hoje = todayLocal(), inicio = add(hoje, -14);
    const e = DB.addExtra({ titulo:'Teste semanal auditável', tipo:'questoes', disciplina:'Teste', alvo:100, unidade:'questoes', periodo:'semanal', dataInicio:inicio, dataFim:hoje, contaMetricas:false });
    DB.addExtraProgress(e.id, 40, 30, { data: inicio, acertos: 30 });
    DB.addExtraProgress(e.id, 90, 25, { data: hoje, acertos: 70 });
    ExtrasScreen.selDay = inicio; ExtrasScreen._calStart = inicio; ExtrasScreen.render();
    const card = [...document.querySelectorAll('#extras-list .exd')].find(x => x.dataset.id === e.id);
    const txt = card ? card.textContent.replace(/\\s+/g,' ') : '';
    const temMin = !!(card && card.querySelector('.exd-min'));
    DB.deleteExtra(e.id); ExtrasScreen.selDay = hoje; ExtrasScreen.render();
    return { txt, temMin };
  });
  (/40\\s*\\/\\s*100/.test(histExtra.txt) && histExtra.temMin)
    ? ok('dia histórico usa o próprio período e questões oferecem minutos opcionais')
    : erro('progresso histórico/minutos incorretos: ' + JSON.stringify(histExtra));

  /* SIMPLICIDADE VEM DE MOVER, NÃO DE SOMAR: o Plano abre mao do painel e`, 'testes comportamentais Extras');
write('verificar.mjs', ver);

console.log('Patch de Atividades Extras aplicado.');
