from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def patch(path, fn):
    p = ROOT / path
    old = p.read_text(encoding='utf-8')
    new = fn(old)
    if new == old:
        print(f'{path}: sem alteracao')
        return
    p.write_text(new, encoding='utf-8')
    print(f'{path}: atualizado')


def troca_unica(s, antigo, novo, nome):
    if antigo not in s:
        raise SystemExit(f'nao encontrei {nome}')
    return s.replace(antigo, novo, 1)


def patch_fila(s):
    if 'Missão diária · <b>${Math.min(q, feitoDia)}</b>/${q} q' not in s:
        antigo = '''  const s = ReforcoFila.saldo(x, this._planoRefCard).restante;
  const selo = `<span class="extra-tag rec" title="Parcela diária gerenciada automaticamente. A meta global do reforço não fecha até o saldo real chegar a zero.">🔄 ${q} q no rodízio · saldo ${s}</span>`;'''
        novo = '''  const geral = ReforcoFila.avaliarGlobal(x, this._planoRefCard);
  const saldo = Math.max(0, Math.ceil((geral.alvo || 0) - (geral.feito || 0)));
  const feitoDia = ReforcoFila.feitoNoDia(x, day);
  const selo = `<span class="extra-tag rec" title="Meta executável desta data.">Missão diária · <b>${Math.min(q, feitoDia)}</b>/${q} q</span>` +
    `<span class="extra-tag" title="Progresso acumulado do ciclo de reforço.">Missão geral · <b>${geral.feito || 0}</b>/${geral.alvo || 0} q · saldo ${saldo}</span>`;'''
        s = troca_unica(s, antigo, novo, 'o selo antigo do card diario')

    if 'Missão geral</b> · <b>${feitoGeral}</b>/${alvoGeral} questões' not in s:
        antigo = '''  const resumo = host.querySelector('.exc-resumo');
  if (resumo) {
    const c = ReforcoFila.cargaDoDia(todayLocal());
    if (c.itens.length) resumo.insertAdjacentHTML('beforeend', ` · <b>fila hoje: ${c.total} q</b> em ${c.disciplinas} disciplina(s)`);
  }'''
        novo = '''  const resumo = host.querySelector('.exc-resumo');
  if (resumo) {
    const c = ReforcoFila.cargaDoDia(todayLocal());
    const ativos = DB.getExtras().filter(e => ReforcoFila.eGerenciado(e) && e.status !== 'concluida');
    const globais = ativos.map(e => ReforcoFila.avaliarGlobal(e));
    const feitoGeral = globais.reduce((a, v) => a + Math.max(0, Number(v.feito) || 0), 0);
    const alvoGeral = globais.reduce((a, v) => a + Math.max(0, Number(v.alvo) || 0), 0);
    resumo.innerHTML = `<span><b>Missão diária</b> · ${c.total} questões em ${c.disciplinas} ${c.disciplinas === 1 ? 'disciplina' : 'disciplinas'}</span>` +
      ` · <span><b>Missão geral</b> · <b>${feitoGeral}</b>/${alvoGeral} questões</span>`;
  }'''
        s = troca_unica(s, antigo, novo, 'o resumo antigo do painel em curso')

    if 'const melhorPorDisc = new Map();' not in s:
        antigo = '''    const vistas = new Set();
    const sel = new Set();
    this._planoCand.forEach((x, i) => {
      if (sel.size >= 3) return;
      const d = ReforcoFila._norm(x.disciplina || 'sem disciplina');
      if (vistas.has(d)) return;
      vistas.add(d); sel.add(i);
    });
    this._planoSel = sel;'''
        novo = '''    const crit = (c) => {
      const taxa = Number(c.x.taxa);
      return Number.isFinite(taxa) ? taxa : 101;
    };
    const cmpCrit = (a, b) => crit(a) - crit(b)
      || (Number(b.x.incid) || 0) - (Number(a.x.incid) || 0)
      || (Number(b.x.qJanela) || 0) - (Number(a.x.qJanela) || 0)
      || String(a.x.nome || '').localeCompare(String(b.x.nome || ''), 'pt-BR');
    const ordenados = this._planoCand.map((x, i) => ({ x, i })).sort(cmpCrit);
    const melhorPorDisc = new Map();
    ordenados.forEach(c => {
      const d = ReforcoFila._norm(c.x.disciplina || 'sem disciplina');
      if (!melhorPorDisc.has(d)) melhorPorDisc.set(d, c);
    });
    const escolhidos = [...melhorPorDisc.values()].sort(cmpCrit).slice(0, 3);
    this._planoSel = new Set(escolhidos.map(c => c.i));'''
        s = troca_unica(s, antigo, novo, 'a selecao antiga de 3 disciplinas')

    return s


def patch_verificar(s):
    if 'o painel separa Missão diária e Missão geral' in s:
        return s
    padrao = re.compile(
        r"  /\* O RITMO É DERIVADO, NÃO AGENDADO\.[\s\S]*?"
        r"    : erro\('o ritmo derivado falhou: ' \+ JSON\.stringify\(\{ resumo: g\.resumo, semDatas: g\.semDatas \}\)\);\n"
    )
    novo = '''  /* O reforço agora tem duas escalas deliberadamente distintas: a parcela
     executável do dia e a meta acumulada do ciclo. A agenda automática precisa
     existir, mas o painel não pode misturá-la com a antiga projeção derivada. */
  (/Missão diária/.test(g.resumo) && /Missão geral/.test(g.resumo) && !g.semDatas && !/\\/dia até a próxima importação/.test(g.resumo))
    ? ok('o painel separa Missão diária e Missão geral, com agenda automática explícita')
    : erro('o contrato diário/geral falhou: ' + JSON.stringify({ resumo: g.resumo, semDatas: g.semDatas }));
'''
    s, n = padrao.subn(novo, s, count=1)
    if n != 1:
        raise SystemExit('nao encontrei a assercao antiga de ritmo derivado')
    return s


def patch_teste(s):
    marker = '// 7) Seleção inicial do Plano:'
    if marker in s:
        return s
    extra = r'''

// 7) Seleção inicial do Plano: 3 disciplinas distintas, sempre com o tópico
// mais crítico de cada disciplina; não depende da ordem incidental da lista.
ExtrasScreen._planoCand = [
  { nome: 'A mediano', disciplina: 'A', taxa: 50, incid: 8, qJanela: 30 },
  { nome: 'A crítico', disciplina: 'A', taxa: 20, incid: 3, qJanela: 20 },
  { nome: 'B mediano', disciplina: 'B', taxa: 40, incid: 5, qJanela: 40 },
  { nome: 'B crítico', disciplina: 'B', taxa: 10, incid: 2, qJanela: 15 },
  { nome: 'C crítico', disciplina: 'C', taxa: 30, incid: 9, qJanela: 50 },
  { nome: 'D menos crítico', disciplina: 'D', taxa: 60, incid: 10, qJanela: 80 }
];
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel).sort((a, b) => a - b), [1, 3, 4],
  'seleção automática deve pegar A crítico, B crítico e C crítico');
'''
    return s + extra


patch('src/js/54-reforco-fila.js', patch_fila)
patch('verificar.mjs', patch_verificar)
patch('testes/reforco-fila.mjs', patch_teste)
