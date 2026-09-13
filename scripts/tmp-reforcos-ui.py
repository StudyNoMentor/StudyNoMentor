from pathlib import Path

CSS_MARK = '/* ═══ REFORÇOS EM CURSO — REDESIGN MODERNO v50 ═══════════════════════════ */'
CSS = r'''
/* ═══ REFORÇOS EM CURSO — REDESIGN MODERNO v50 ═══════════════════════════ */
/* Camada estritamente visual. A fila, os saldos, o rodízio e os fechamentos
   continuam sendo controlados por ReforcoFila; esta seção só transforma o
   painel em uma leitura de decisão: o que é, quanto falta e qual ação executar. */
#extras-curso .exc-card {
  margin: 16px 0 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  border-radius: 20px;
  background: color-mix(in srgb, var(--surface) 97%, var(--accent-soft));
  box-shadow: 0 12px 36px color-mix(in srgb, var(--text) 8%, transparent);
}
#extras-curso .exc-head {
  display: grid;
  grid-template-columns: minmax(190px, .75fr) minmax(360px, 1.35fr) auto;
  gap: 14px;
  align-items: center;
  width: 100%;
  padding: 18px 20px;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  background: linear-gradient(135deg,
    color-mix(in srgb, var(--surface) 98%, var(--accent-soft)),
    color-mix(in srgb, var(--surface) 92%, var(--accent-soft)));
  text-align: left;
  cursor: pointer;
}
#extras-curso .exc-tit {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: clamp(17px, 1.65vw, 23px);
  font-weight: 850;
  letter-spacing: -.025em;
  color: var(--text);
}
#extras-curso .exc-resumo {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-width: 0;
  color: var(--text-soft);
}
#extras-curso .exc-metric {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: 'label label' 'value meta';
  gap: 3px 10px;
  align-items: end;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 14%, var(--border));
  border-radius: 13px;
  background: color-mix(in srgb, var(--accent-soft) 58%, var(--surface));
}
#extras-curso .exc-metric-all {
  border-color: color-mix(in srgb, var(--good) 20%, var(--border));
  background: color-mix(in srgb, var(--good-soft) 62%, var(--surface));
}
#extras-curso .exc-metric small {
  grid-area: label;
  font-size: var(--fs-3xs);
  font-weight: 800;
  letter-spacing: .055em;
  text-transform: uppercase;
  color: var(--text-faint);
}
#extras-curso .exc-metric strong {
  grid-area: value;
  min-width: 0;
  font-size: var(--fs-sm);
  font-weight: 850;
  color: var(--text);
  white-space: nowrap;
}
#extras-curso .exc-metric em {
  grid-area: meta;
  justify-self: end;
  font-size: var(--fs-3xs);
  font-style: normal;
  font-weight: 700;
  color: var(--text-soft);
  white-space: nowrap;
}
#extras-curso .exc-head .chev {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text-faint);
  box-shadow: var(--shadow-sm);
}
#extras-curso .exc-grupo {
  padding: 16px 18px 0;
}
#extras-curso .exc-grupo:last-of-type { padding-bottom: 18px; }
#extras-curso .exc-disc {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 9px;
  font-size: var(--fs-3xs);
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: .065em;
  color: var(--text-faint);
}
#extras-curso .exc-disc::after {
  content: '';
  height: 1px;
  flex: 1 1 auto;
  background: color-mix(in srgb, var(--border) 72%, transparent);
}
#extras-curso .pl-ciclo-lista { gap: 10px; }
#extras-curso .pl-ciclo-lista > li {
  position: relative;
  display: grid;
  grid-template-columns: minmax(260px, 1.35fr) minmax(250px, .9fr) minmax(210px, .62fr);
  grid-template-areas:
    'top bar actions'
    'top nums actions';
  column-gap: 18px;
  row-gap: 9px;
  align-items: center;
  min-width: 0;
  padding: 16px 16px 16px 18px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  box-shadow: 0 5px 16px color-mix(in srgb, var(--text) 5%, transparent);
  transition: border-color .14s ease, box-shadow .14s ease, transform .14s ease;
}
#extras-curso .pl-ciclo-lista > li::before {
  content: '';
  position: absolute;
  inset: 12px auto 12px 0;
  width: 3px;
  border-radius: 0 999px 999px 0;
  background: color-mix(in srgb, var(--accent) 78%, var(--good));
}
#extras-curso .pl-ciclo-lista > li:hover {
  border-color: color-mix(in srgb, var(--accent) 34%, var(--border));
  box-shadow: 0 10px 26px color-mix(in srgb, var(--text) 8%, transparent);
  transform: translateY(-1px);
}
#extras-curso .pl-ciclo-top {
  grid-area: top;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}
#extras-curso .pl-ciclo-nome {
  width: 100%;
  font-size: clamp(14px, 1.22vw, 17px);
  font-weight: 850;
  line-height: 1.32;
  letter-spacing: -.012em;
  color: var(--text);
  overflow-wrap: anywhere;
}
#extras-curso .reforco-tag {
  display: inline-flex;
  align-items: center;
  min-height: 25px;
  padding: 4px 9px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-soft) 78%, var(--surface));
  color: var(--accent);
  font-size: var(--fs-3xs);
  font-weight: 800;
  white-space: nowrap;
}
#extras-curso .pl-ciclo-barra {
  grid-area: bar;
  width: 100%;
  height: 9px;
  margin: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border) 82%, var(--surface-sunken));
  overflow: hidden;
}
#extras-curso .pl-ciclo-barra > i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, var(--good)));
}
#extras-curso .pl-ciclo-nums {
  grid-area: nums;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 14px;
  align-items: center;
  min-width: 0;
  margin: 0;
  color: var(--text-faint);
}
#extras-curso .pl-ciclo-nums > span {
  min-width: 0;
  font-size: var(--fs-3xs);
  line-height: 1.35;
}
#extras-curso .pl-ciclo-nums > span b { color: var(--text); font-weight: 850; }
#extras-curso .pl-ciclo-nums .exc-hoje {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  width: max-content;
  max-width: 100%;
  padding: 5px 8px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--accent-soft) 66%, var(--surface));
  color: var(--accent-text, var(--accent));
  white-space: nowrap;
}
#extras-curso .pl-ciclo-nums .exc-hoje small {
  font-size: inherit;
  font-weight: 850;
  color: var(--accent);
}
#extras-curso .exc-acoes {
  grid-area: actions;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  align-self: stretch;
  align-content: center;
  min-width: 0;
  margin: 0;
}
#extras-curso .exc-acoes .pl-ciclo-acao {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text-soft);
  font: inherit;
  font-size: var(--fs-2xs);
  font-weight: 800;
  line-height: 1.15;
  text-align: center;
  cursor: pointer;
  transition: border-color .13s ease, background .13s ease, color .13s ease, transform .13s ease;
}
#extras-curso .exc-acoes .pl-ciclo-acao:hover { transform: translateY(-1px); }
#extras-curso .exc-acoes .pl-ciclo-acao:first-child {
  grid-column: 1 / -1;
  min-height: 42px;
  border-color: var(--accent);
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 82%, #7657ff));
  color: var(--on-accent);
  box-shadow: 0 7px 18px color-mix(in srgb, var(--accent) 24%, transparent);
}
#extras-curso .exc-acoes .pl-ciclo-acao:first-child::before { content: '▶'; font-size: .8em; margin-right: 6px; }
#extras-curso .exc-acoes .pl-ciclo-acao:nth-child(2):hover {
  border-color: color-mix(in srgb, var(--warn) 52%, var(--border));
  background: var(--warn-soft);
  color: var(--warn-text);
}
#extras-curso .exc-acoes .pl-ciclo-acao:nth-child(3):hover {
  border-color: color-mix(in srgb, var(--bad) 52%, var(--border));
  background: var(--bad-soft);
  color: var(--bad-text);
}

@media (max-width: 1040px) {
  #extras-curso .exc-head { grid-template-columns: 1fr auto; }
  #extras-curso .exc-tit { grid-column: 1; }
  #extras-curso .exc-resumo { grid-column: 1 / -1; grid-row: 2; }
  #extras-curso .exc-head .chev { grid-column: 2; grid-row: 1; }
  #extras-curso .pl-ciclo-lista > li {
    grid-template-columns: minmax(220px, 1fr) minmax(220px, 1fr);
    grid-template-areas:
      'top actions'
      'bar actions'
      'nums actions';
  }
}
@media (max-width: 720px) {
  #extras-curso .exc-card { border-radius: 16px; }
  #extras-curso .exc-head { padding: 15px; gap: 10px; }
  #extras-curso .exc-resumo { grid-template-columns: 1fr 1fr; }
  #extras-curso .exc-metric { grid-template-columns: 1fr; grid-template-areas: 'label' 'value' 'meta'; }
  #extras-curso .exc-metric em { justify-self: start; }
  #extras-curso .exc-grupo { padding: 14px 12px 0; }
  #extras-curso .pl-ciclo-lista > li {
    grid-template-columns: 1fr;
    grid-template-areas: 'top' 'bar' 'nums' 'actions';
    padding: 14px;
    row-gap: 11px;
  }
  #extras-curso .pl-ciclo-top { gap: 7px; }
  #extras-curso .pl-ciclo-nums { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #extras-curso .exc-acoes { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 470px) {
  #extras-curso .exc-resumo { grid-template-columns: 1fr; }
  #extras-curso .exc-metric { grid-template-columns: 1fr auto; grid-template-areas: 'label label' 'value meta'; }
  #extras-curso .exc-metric em { justify-self: end; }
  #extras-curso .pl-ciclo-nums { grid-template-columns: 1fr 1fr; gap: 7px 10px; }
  #extras-curso .exc-acoes .pl-ciclo-acao:nth-child(2),
  #extras-curso .exc-acoes .pl-ciclo-acao:nth-child(3) { font-size: var(--fs-3xs); }
}
'''

css_path = Path('src/css/08-ux-v49.css')
css = css_path.read_text(encoding='utf-8')
if CSS_MARK not in css:
    css = css.rstrip() + '\n\n' + CSS.strip() + '\n'
    css_path.write_text(css, encoding='utf-8')

js_path = Path('src/js/54-reforco-fila.js')
js = js_path.read_text(encoding='utf-8')

anchor = """  const resumo = host.querySelector('.exc-resumo');\n"""
insert = """  // O painel em curso mostra também a PARCELA EXECUTÁVEL DE HOJE por assunto.\n  // Isso é somente leitura: não cria agenda, não muda saldo e não conclui nada.\n  host.querySelectorAll('.pl-ciclo-lista > li[data-id]').forEach(li => {\n    const e = DB.getExtra(li.dataset.id);\n    if (!e) return;\n    const q = ReforcoFila.alvoNoDia(e, todayLocal());\n    if (q == null) return;\n    const feitoHoje = ReforcoFila.feitoNoDia(e, todayLocal());\n    const nums = li.querySelector('.pl-ciclo-nums');\n    if (nums && !nums.querySelector('.exc-hoje')) {\n      nums.insertAdjacentHTML('afterbegin', `<span class=\"exc-hoje\" title=\"Parcela executável desta data.\"><small>Hoje</small><b>${Math.min(q, feitoHoje)}</b>/${q} q</span>`);\n    }\n  });\n\n  const resumo = host.querySelector('.exc-resumo');\n"""
if 'const q = ReforcoFila.alvoNoDia(e, todayLocal());' not in js:
    if anchor not in js:
        raise SystemExit('âncora do resumo não encontrada em 54-reforco-fila.js')
    js = js.replace(anchor, insert, 1)

old = """    resumo.innerHTML = `<span><b>Missão diária</b> · ${c.total} questões em ${c.disciplinas} ${c.disciplinas === 1 ? 'disciplina' : 'disciplinas'}</span>` +\n      ` · <span><b>Missão geral</b> · <b>${feitoGeral}</b>/${alvoGeral} questões</span>`;\n"""
new = """    const pctGeral = alvoGeral > 0 ? Math.min(100, Math.round(feitoGeral / alvoGeral * 100)) : 0;\n    resumo.innerHTML =\n      `<span class=\"exc-metric exc-metric-day\"><small>Missão diária</small><strong>${c.total} questões</strong><em>${c.disciplinas} ${c.disciplinas === 1 ? 'disciplina' : 'disciplinas'}</em></span>` +\n      `<span class=\"exc-metric exc-metric-all\"><small>Missão geral</small><strong>${feitoGeral}/${alvoGeral} questões</strong><em>${pctGeral}% concluído</em></span>`;\n"""
if 'exc-metric exc-metric-day' not in js:
    if old not in js:
        raise SystemExit('bloco do resumo não encontrado em 54-reforco-fila.js')
    js = js.replace(old, new, 1)

js_path.write_text(js, encoding='utf-8')
print('redesign dos reforços aplicado')
