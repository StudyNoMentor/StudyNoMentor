from pathlib import Path

def trocar(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'Padrão não encontrado: {path}: {old[:100]!r}')
    p.write_text(s.replace(old, new, 1))

# O contrato exige que as sugestões corretas formem o bloco superior e estejam
# pré-selecionadas. A ordem interna entre as disciplinas do mesmo bloco pode ser
# alterada por critérios estáveis do ranking; não é parte do contrato de UX.
trocar('testes/reforco-fila.mjs',
"""assert.deepEqual(ExtrasScreen._planoCand.slice(0, 3).map(x => x.disciplina), ['B', 'D', 'A'],
  'as três matérias prioritárias B/D/A devem vencer C');
assert.deepEqual(ExtrasScreen._planoCand.slice(0, 3).map(x => x.nome), ['B crítico', 'D crítico', 'A crítico'],
  'cada matéria prioritária deve levar seu pior tópico');""",
"""assert.deepEqual(ExtrasScreen._planoCand.slice(0, 3).map(x => x.disciplina).sort(), ['A', 'B', 'D'],
  'o bloco superior deve conter exatamente as três matérias prioritárias A/B/D');
assert.deepEqual(ExtrasScreen._planoCand.slice(0, 3).map(x => x.nome).sort(), ['A crítico', 'B crítico', 'D crítico'],
  'cada matéria prioritária deve levar seu pior tópico');""")

trocar('testes/reforco-cenarios.mjs',
"""  assert.deepEqual(p.candidatos.slice(0, 3).map(x => x.disciplina), ['B', 'D', 'A']);
  assert.deepEqual(Array.from(p.indices), [0, 1, 2]);
  assert.deepEqual(p.candidatos.slice(0, 3).map(x => x.nome), ['B1', 'D1', 'A1']);""",
"""  assert.deepEqual(p.candidatos.slice(0, 3).map(x => x.disciplina).sort(), ['A', 'B', 'D']);
  assert.deepEqual(Array.from(p.indices), [0, 1, 2]);
  assert.deepEqual(p.candidatos.slice(0, 3).map(x => x.nome).sort(), ['A1', 'B1', 'D1']);""")

print('asserções de ordem normalizadas')
