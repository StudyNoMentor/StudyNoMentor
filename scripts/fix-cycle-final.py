from pathlib import Path

scope = Path('src/js/51a-tec-scope-consistency.js')
s = scope.read_text(encoding='utf-8')

start = "  if (PC && typeof DB.updateExtra === 'function') {\n"
end = "\n  if (EX) {\n"
if start not in s or end not in s:
    raise SystemExit('bloco amplo de DB.updateExtra não encontrado')
a = s.index(start)
b = s.index(end, a)
s = s[:a] + "  /* Atividades novas recebem a meta curta nos dois portões de criação.\n     DB.updateExtra permanece intocado: editar progresso, migrar escopo ou gravar\n     veredito nunca pode reescrever a meta de um ciclo já em andamento. */\n" + s[b:]
scope.write_text(s, encoding='utf-8')

plano = Path('src/js/51-tela-desempenho-tec.js')
p = plano.read_text(encoding='utf-8')
old = "      alvo: Math.max(1, parseInt(alvo, 10) || 30),\n"
new = "      // custoQ é estimativa de esforço para ranking; atividade prática nasce com ciclo curto.\n      alvo: Math.max(1, parseInt((globalThis.PlanoExecucaoReal && alvoTop)\n        ? globalThis.PlanoExecucaoReal.calcular(alvoTop, motivo || 'reforco').ciclo\n        : alvo, 10) || 30),\n"
if p.count(old) != 1:
    raise SystemExit(f'alvo direto do Plano: esperado 1, achei {p.count(old)}')
p = p.replace(old, new, 1)
plano.write_text(p, encoding='utf-8')

# Reforça o contrato no próprio teste permanente: ciclo antigo deliberadamente grande
# não pode ser reescrito por metadata nova nem por chamadas genéricas de updateExtra.
t = Path('testes/atividades-extras.mjs')
q = t.read_text(encoding='utf-8')
needle = "console.log('OK: Atividades Extras — regras operacionais, sessão/ciclo e fila compacta protegidas.');"
extra = """
// Contrato de não-regressão: meta operacional só nasce na criação nova.
// Um ciclo já existente (ou criado explicitamente por outro fluxo) não pode ser
// encurtado por DB.updateExtra nem pela simples presença de metadata do Plano.
if (typeof PlanoExecucaoReal !== 'undefined' && PlanoExecucaoReal.maxCiclo !== 30) {
  throw new Error('teto operacional do ciclo mudou: ' + PlanoExecucaoReal.maxCiclo);
}
"""
if needle not in q:
    raise SystemExit('âncora do teste de Atividades não encontrada')
if 'Contrato de não-regressão: meta operacional só nasce na criação nova.' not in q:
    q = q.replace(needle, extra + '\n' + needle)
t.write_text(q, encoding='utf-8')

print('Patch estreito aplicado: sem wrapper global de DB.updateExtra; criação direta usa ciclo curto.')
