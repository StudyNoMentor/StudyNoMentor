from pathlib import Path
p = Path('src/js/54-reforco-fila.js')
s = p.read_text()

def troca(old, new):
    global s
    if old not in s:
        raise SystemExit(f'Padrão não encontrado: {old[:120]!r}')
    s = s.replace(old, new, 1)

troca("""     · blocos balanceados com teto de 25 questões: 100 -> 25/25/25/25,
       61 -> 21/20/20, 47 -> 24/23. Não cria uma esteira artificial de 7/8;""",
"""     · blocos balanceados com faixa configurável (padrão 10–25 questões):
       100 -> 25/25/25/25, 61 -> 21/20/20, 47 -> 24/23. Não cria uma esteira artificial de 7/8;""")

troca("""  DEFAULT_PREFS: { disciplinasDia: 1, blocoMin: 10, blocoMax: 25 },
  BLOCO_MAX: 25,""",
"""  DEFAULT_PREFS: { disciplinasDia: 1, blocoMin: 10, blocoMax: 25 },""")

troca("""            m.alvosPorDia[hoje] = Math.max(feitoHoje, Math.min(this.BLOCO_MAX, feitoHoje + s));""",
"""            const limiteHoje = this.limitesBloco(e).max;
            m.alvosPorDia[hoje] = Math.max(feitoHoje, Math.min(limiteHoje, feitoHoje + s));""")

troca("""ReforcoFila.decorarSugestoesPlano = function (screen) {
  const host = document.getElementById('pl-lista'); if (!host) return;
  const n = Math.max(0, Number(screen._reforcoFilaSugCount) || 0);""",
"""ReforcoFila.decorarSugestoesPlano = function (screen) {
  const host = document.getElementById('pl-lista'); if (!host) return;
  // `_planoBind` também chama `_planoRenderLista`; a decoração precisa ser
  // idempotente para nunca acumular cabeçalhos/separadores na mesma lista.
  host.querySelectorAll('.pl-auto-head,.pl-auto-rest').forEach(x => x.remove());
  const n = Math.max(0, Number(screen._reforcoFilaSugCount) || 0);""")

troca("""    if (cb) cb.addEventListener('change', () => { screen._reforcoFilaAutoMode = false; });""",
"""    if (cb && !cb.dataset.reforcoAutoBound) {
      cb.dataset.reforcoAutoBound = '1';
      cb.addEventListener('change', () => { screen._reforcoFilaAutoMode = false; });
    }""")

p.write_text(s)
print('polimento aplicado')
