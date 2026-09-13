from pathlib import Path
p = Path('testes/reforco-fila.mjs')
s = p.read_text()
old = "assert.deepEqual(sel22.indices.slice().sort((a, b) => a - b), [0, 1, 2, 3],"
new = "assert.deepEqual(Array.from(sel22.indices).sort((a, b) => a - b), [0, 1, 2, 3],"
if old not in s:
    raise SystemExit('âncora do teste 2x2 não encontrada')
p.write_text(s.replace(old, new, 1))
print('array vm normalizado')
