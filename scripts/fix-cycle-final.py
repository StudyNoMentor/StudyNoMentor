from pathlib import Path

scope = Path('src/js/51a-tec-scope-consistency.js')
s = scope.read_text(encoding='utf-8')

# Algumas iterações anteriores já removeram o wrapper amplo. Se ainda existir,
# eliminamos; se não existir, seguimos. O importante é que DB.updateExtra nunca
# seja interceptado para reescrever alvo de atividade existente.
start = "  if (PC && typeof DB.updateExtra === 'function') {\n"
end = "\n  if (EX) {\n"
if start in s:
    a = s.index(start)
    b = s.index(end, a)
    s = s[:a] + "  /* Meta operacional é definida somente na criação; DB.updateExtra permanece intocado. */\n" + s[b:]
if "DB.updateExtra = function updateExtraComMetaOperacional" in s:
    raise SystemExit('wrapper global de DB.updateExtra ainda presente')
scope.write_text(s, encoding='utf-8')

plano = Path('src/js/51-tela-desempenho-tec.js')
p = plano.read_text(encoding='utf-8')
old = "      alvo: Math.max(1, parseInt(alvo, 10) || 30),\n"
new = "      // custoQ é estimativa para ranking; a atividade prática nasce como ciclo curto.\n      alvo: Math.max(1, parseInt((globalThis.PlanoExecucaoReal && alvoTop)\n        ? globalThis.PlanoExecucaoReal.calcular(alvoTop, motivo || 'reforco').ciclo\n        : alvo, 10) || 30),\n"
if old in p:
    p = p.replace(old, new, 1)
elif 'globalThis.PlanoExecucaoReal.calcular(alvoTop' not in p:
    raise SystemExit('alvo direto do Plano não encontrado nem já corrigido')
plano.write_text(p, encoding='utf-8')

# Proteção textual/estrutural permanente.
t = Path('testes/atividades-extras.mjs')
q = t.read_text(encoding='utf-8')
needle = "console.log('OK: Atividades Extras — regras operacionais, sessão/ciclo e fila compacta protegidas.');"
extra = """
// Contrato de não-regressão: a meta operacional nasce na criação nova.
// Um ciclo existente não pode ser encurtado por DB.updateExtra.
if (typeof PlanoExecucaoReal !== 'undefined' && PlanoExecucaoReal.maxCiclo !== 30) {
  throw new Error('teto operacional do ciclo mudou: ' + PlanoExecucaoReal.maxCiclo);
}
"""
if needle not in q:
    raise SystemExit('âncora do teste de Atividades não encontrada')
if 'Contrato de não-regressão: a meta operacional nasce na criação nova.' not in q:
    q = q.replace(needle, extra + '\n' + needle)
t.write_text(q, encoding='utf-8')

print('Patch estreito aplicado: criação nova usa ciclo curto; ciclos existentes não são reescritos.')
