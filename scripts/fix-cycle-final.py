from pathlib import Path

# 1) Sem catch vazio na migração conservadora de legado.
scope = Path('src/js/51a-tec-scope-consistency.js')
s = scope.read_text(encoding='utf-8')
old_catch = "            try { if (typeof DB.extraProgressoPeriodo === 'function') feito = Math.max(feito, Number(DB.extraProgressoPeriodo(e)) || 0); } catch (_) {}"
new_catch = "            try { if (typeof DB.extraProgressoPeriodo === 'function') feito = Math.max(feito, Number(DB.extraProgressoPeriodo(e)) || 0); }\n            catch (err) { if (typeof _quiet === 'function') _quiet(err, 'plano-migracao-progresso'); }"
if old_catch in s:
    s = s.replace(old_catch, new_catch, 1)
if "catch (_) {}" in s:
    raise SystemExit('ainda existe catch vazio na camada de execução real')
scope.write_text(s, encoding='utf-8')

# 2) Integração do navegador: o assunto abaixo da meta continua aberto,
# mas a meta agora é o ciclo curto, não os antigos 120q.
v = Path('verificar.mjs')
r = v.read_text(encoding='utf-8')
repls = [
("D('Dir Adm', 350, 195), L('01', 'Licitacoes', 'Dir Adm', 150, 138),\n      L('02', 'Atos', 'Dir Adm', 150, 42), L('03', 'Contratos', 'Dir Adm', 50, 15)",
 "D('Dir Adm', 310, 183), L('01', 'Licitacoes', 'Dir Adm', 150, 138),\n      L('02', 'Atos', 'Dir Adm', 150, 42), L('03', 'Contratos', 'Dir Adm', 10, 3)"),
("(dep.emCurso.length === 1 && /50\\/120/.test(dep.emCurso[0]) && /pelo retrato/.test(dep.emCurso[0]))\n    ? ok('o bloco \"Em curso\" conta as questoes a partir do retrato, sem lancamento manual (50/120)')",
 "(dep.emCurso.length === 1 && /10\\/(?:15|20|25|30)/.test(dep.emCurso[0]) && /pelo retrato/.test(dep.emCurso[0]))\n    ? ok('o bloco \"Em curso\" conta as questões do retrato contra o ciclo curto vigente')"),
("barra: /50 \\/ 120/.test(t) };",
 "barra: /10 \\/ (?:15|20|25|30)/.test(t) };"),
("(card.doPlano && card.evo && card.barra)",
 "(card.doPlano && card.retrato && card.barra)"),
("? ok('o cartao da atividade diz que veio do Plano, mostra 45% → 30% e a barra em 50/120')",
 "? ok('o cartão da atividade diz que veio do Plano, usa o retrato e mostra a barra do ciclo curto')")
]
for old, new in repls:
    if old in r:
        r = r.replace(old, new, 1)
    elif new not in r:
        raise SystemExit('âncora do verificar não encontrada: ' + old[:70])
v.write_text(r, encoding='utf-8')

# 3) Jornada anual: ciclos curtos podem fechar todos os reforços nas quatro
# importações iniciais. Para continuar testando a conclusão MANUAL, cria-se
# uma nova atividade aberta somente quando não restou nenhuma viva.
j = Path('test/jornada-invariantes.js')
z = j.read_text(encoding='utf-8')
old = """    const viva = banco.find(e => e.origemPlano && e.status !== 'concluida' && e.origemPlano.motivo !== 'diagnostico');
    if (viva) DB.setConcluidaDia(viva.id, todayLocal(), true);"""
new = """    let viva = banco.find(e => e.origemPlano && e.status !== 'concluida' && e.origemPlano.motivo !== 'diagnostico');
    if (!viva) {
      const rr5 = P.calcular(T.scopedSnapshot(), P.prefs());
      const abertos = new Set(banco.filter(e => e.origemPlano && e.status !== 'concluida')
        .map(e => e.origemPlano.disciplina + '|' + e.origemPlano.topico));
      const x5 = rr5 && !rr5.erro ? (rr5.itens || []).find(x => !abertos.has(x.disciplina + '|' + x.nome)) : null;
      if (x5) {
        T.criarExtraDoPlano(x5.nome, x5.disciplina, x5.custoQ || 30, 'reforco', true);
        viva = banco.find(e => e.origemPlano && e.status !== 'concluida' && e.origemPlano.motivo !== 'diagnostico');
      }
    }
    if (viva) DB.setConcluidaDia(viva.id, todayLocal(), true);"""
if old in z:
    z = z.replace(old, new, 1)
elif new not in z:
    raise SystemExit('âncora da conclusão manual na jornada não encontrada')
j.write_text(z, encoding='utf-8')

print('Correções aplicadas: ciclo curto, cartão e jornada manual alinhados ao novo contrato.')
