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


def patch_fila(s):
    if 'Missão diária · <b>${Math.min(q, feitoDia)}</b>/${q} q' not in s:
        padrao = re.compile(
            r"  const s = ReforcoFila\.saldo\(x, this\._planoRefCard\)\.restante;\n"
            r"  const selo = `<span class=\\\"extra-tag rec\\\" title=\\\"Parcela diária gerenciada automaticamente\. A meta global do reforço não fecha até o saldo real chegar a zero\.\\\">🔄 \$\{q\} q no rodízio · saldo \$\{s\}</span>`;"
        )
        novo = '''  const geral = ReforcoFila.avaliarGlobal(x, this._planoRefCard);\n  const saldo = Math.max(0, Math.ceil((geral.alvo || 0) - (geral.feito || 0)));\n  const feitoDia = ReforcoFila.feitoNoDia(x, day);\n  const selo = `<span class=\\"extra-tag rec\\" title=\\"Meta executável desta data.\\">Missão diária · <b>${Math.min(q, feitoDia)}</b>/${q} q</span>` +\n    `<span class=\\"extra-tag\\" title=\\"Progresso acumulado do ciclo de reforço.\\">Missão geral · <b>${geral.feito || 0}</b>/${geral.alvo || 0} q · saldo ${saldo}</span>`;'''
        s, n = padrao.subn(novo, s, count=1)
        if n != 1:
            raise SystemExit('nao encontrei o selo antigo do card diario')

    if 'Missão geral · <b>${feitoGeral}</b>/${alvoGeral} questões' not in s:
        antigo = '''  const resumo = host.querySelector('.exc-resumo');\n  if (resumo) {\n    const c = ReforcoFila.cargaDoDia(todayLocal());\n    if (c.itens.length) resumo.insertAdjacentHTML('beforeend', ` · <b>fila hoje: ${c.total} q</b> em ${c.disciplinas} disciplina(s)`);\n  }'''
        novo = '''  const resumo = host.querySelector('.exc-resumo');\n  if (resumo) {\n    const c = ReforcoFila.cargaDoDia(todayLocal());\n    const ativos = DB.getExtras().filter(e => ReforcoFila.eGerenciado(e) && e.status !== 'concluida');\n    const globais = ativos.map(e => ReforcoFila.avaliarGlobal(e));\n    const feitoGeral = globais.reduce((a, v) => a + Math.max(0, Number(v.feito) || 0), 0);\n    const alvoGeral = globais.reduce((a, v) => a + Math.max(0, Number(v.alvo) || 0), 0);\n    resumo.innerHTML = `<span><b>Missão diária</b> · ${c.total} questões em ${c.disciplinas} ${c.disciplinas === 1 ? 'disciplina' : 'disciplinas'}</span>` +\n      ` · <span><b>Missão geral</b> · <b>${feitoGeral}</b>/${alvoGeral} questões</span>`;\n  }'''
        if antigo not in s:
            raise SystemExit('nao encontrei o resumo antigo do painel em curso')
        s = s.replace(antigo, novo, 1)

    if 'const melhorPorDisc = new Map();' not in s:
        antigo = '''    const vistas = new Set();\n    const sel = new Set();\n    this._planoCand.forEach((x, i) => {\n      if (sel.size >= 3) return;\n      const d = ReforcoFila._norm(x.disciplina || 'sem disciplina');\n      if (vistas.has(d)) return;\n      vistas.add(d); sel.add(i);\n    });\n    this._planoSel = sel;'''
        novo = '''    const crit = (c) => {\n      const taxa = Number(c.x.taxa);\n      return Number.isFinite(taxa) ? taxa : 101;\n    };\n    const cmpCrit = (a, b) => crit(a) - crit(b)\n      || (Number(b.x.incid) || 0) - (Number(a.x.incid) || 0)\n      || (Number(b.x.qJanela) || 0) - (Number(a.x.qJanela) || 0)\n      || String(a.x.nome || '').localeCompare(String(b.x.nome || ''), 'pt-BR');\n    const ordenados = this._planoCand.map((x, i) => ({ x, i })).sort(cmpCrit);\n    const melhorPorDisc = new Map();\n    ordenados.forEach(c => {\n      const d = ReforcoFila._norm(c.x.disciplina || 'sem disciplina');\n      if (!melhorPorDisc.has(d)) melhorPorDisc.set(d, c);\n    });\n    const escolhidos = [...melhorPorDisc.values()].sort(cmpCrit).slice(0, 3);\n    this._planoSel = new Set(escolhidos.map(c => c.i));'''
        if antigo not in s:
            raise SystemExit('nao encontrei a selecao antiga de 3 disciplinas')
        s = s.replace(antigo, novo, 1)

    return s


def patch_verificar(s):
    if 'o painel separa Missão diária e Missão geral' in s:
        return s
    antigo = '''  /* O RITMO É DERIVADO, NÃO AGENDADO. Amarrar cada atividade a um dia cria\n     divida vencida: voce nao estudou terca, e terca fica la, cobrando. */\n  (/\\/dia até a próxima importação/.test(g.resumo) && g.semDatas)\n    ? ok('com ritmo por dia calculado na hora, e nenhuma atividade amarrada a uma data')\n    : erro('o ritmo derivado falhou: ' + JSON.stringify({ resumo: g.resumo, semDatas: g.semDatas }));'''
    novo = '''  /* O reforço agora tem duas escalas deliberadamente distintas: a parcela\n     executável do dia e a meta acumulada do ciclo. A agenda automática precisa\n     existir, mas o painel não pode misturá-la com a antiga projeção derivada. */\n  (/Missão diária/.test(g.resumo) && /Missão geral/.test(g.resumo) && !g.semDatas && !/\\/dia até a próxima importação/.test(g.resumo))\n    ? ok('o painel separa Missão diária e Missão geral, com agenda automática explícita')\n    : erro('o contrato diário/geral falhou: ' + JSON.stringify({ resumo: g.resumo, semDatas: g.semDatas }));'''
    if antigo not in s:
        raise SystemExit('nao encontrei a assercao antiga de ritmo derivado')
    return s.replace(antigo, novo, 1)


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
