from pathlib import Path

p = Path('src/js/54-reforco-fila.js')
s = p.read_text(encoding='utf-8')

old = '''/* O card continua sendo o card normal do app, mas recebe uma cópia efêmera com
   o ALVO/PROGRESSO DA PARCELA. O objeto persistido conserva a meta global. */
ReforcoFila._orig.cardHtml = ExtrasScreen.cardHtml;
ExtrasScreen.cardHtml = function (x, day) {
  day = day || this.selDay || todayLocal();
  const q = ReforcoFila.alvoNoDia(x, day);
  if (q == null) return ReforcoFila._orig.cardHtml.call(this, x, day);
  const feito = ReforcoFila.feitoNoDia(x, day);
  const clone = Object.assign({}, x, {
    alvo: q,
    progresso: feito,
    _reforcoFilaDia: day,
    _reforcoFilaAlvo: q
  });
  let html = ReforcoFila._orig.cardHtml.call(this, clone, day);
  const geral = ReforcoFila.avaliarGlobal(x, this._planoRefCard);
  const saldo = Math.max(0, Math.ceil((geral.alvo || 0) - (geral.feito || 0)));
  const feitoDia = ReforcoFila.feitoNoDia(x, day);
  const selo = `<span class="extra-tag rec" title="Meta executável desta data.">Missão diária · <b>${Math.min(q, feitoDia)}</b>/${q} q</span>` +
    `<span class="extra-tag" title="Progresso acumulado do ciclo de reforço.">Missão geral · <b>${geral.feito || 0}</b>/${geral.alvo || 0} q · saldo ${saldo}</span>`;
  if (html.includes('🏁 do Plano</span>')) html = html.replace('🏁 do Plano</span>', '🏁 do Plano</span>' + selo);
  return html;
};

/* `cardHtml` chama PlanoCiclo.avaliar para mostrar a evolução. Para a cópia
   efêmera do card, mantemos taxa/delta do ciclo global mas trocamos somente a
   régua visual da barra pela parcela do dia. */
if (typeof PlanoCiclo !== 'undefined' && PlanoCiclo.avaliar) {
  ReforcoFila._orig.avaliar = PlanoCiclo.avaliar;
  PlanoCiclo.avaliar = function (extra, r, mapa) {
    if (!extra || !extra._reforcoFilaDia) return ReforcoFila._orig.avaliar.call(this, extra, r, mapa);
    const parent = DB.getExtra(extra.id) || extra;
    const base = ReforcoFila._orig.avaliar.call(this, parent, r, mapa);
    if (!base) return base;
    const alvo = Math.max(1, parseFloat(extra._reforcoFilaAlvo) || 1);
    const feito = ReforcoFila.feitoNoDia(parent, extra._reforcoFilaDia);
    return Object.assign({}, base, {
      extra, alvo, feito, manual: feito, medido: 0,
      pct: Math.min(100, Math.round(feito / alvo * 100)),
      cumpriu: feito >= alvo
    });
  };
}
'''

new = '''/* O card mantém a barra do CICLO GLOBAL. A parcela executável do dia aparece
   em badge próprio; assim 10/25 hoje nunca substitui visualmente 50/120 no ciclo. */
ReforcoFila._orig.cardHtml = ExtrasScreen.cardHtml;
ExtrasScreen.cardHtml = function (x, day) {
  day = day || this.selDay || todayLocal();
  const q = ReforcoFila.alvoNoDia(x, day);
  if (q == null) return ReforcoFila._orig.cardHtml.call(this, x, day);
  let html = ReforcoFila._orig.cardHtml.call(this, x, day);
  const geral = ReforcoFila.avaliarGlobal(x, this._planoRefCard);
  const saldo = Math.max(0, Math.ceil((geral.alvo || 0) - (geral.feito || 0)));
  const feitoDia = ReforcoFila.feitoNoDia(x, day);
  const selo = `<span class="extra-tag rec" title="Meta executável desta data.">Missão diária · <b>${Math.min(q, feitoDia)}</b>/${q} q</span>` +
    `<span class="extra-tag" title="Progresso acumulado do ciclo de reforço.">Missão geral · <b>${geral.feito || 0}</b>/${geral.alvo || 0} q · saldo ${saldo}</span>`;
  if (html.includes('🏁 do Plano</span>')) html = html.replace('🏁 do Plano</span>', '🏁 do Plano</span>' + selo);
  return html;
};
'''

if old not in s:
    raise SystemExit('trecho do card diario nao encontrado')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('card do reforco: barra global preservada; missao diaria fica no badge')
