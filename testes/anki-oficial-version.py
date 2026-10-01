"""Testa a trava de versão sem carregar Anki, FastAPI ou abrir coleções."""
import ast
from pathlib import Path
from types import SimpleNamespace

root = Path(__file__).resolve().parents[1]
tree = ast.parse((root / "anki_official_backend/app.py").read_text())
guard = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "verify_anki_runtime")
version = next(
    node.value.value for node in tree.body
    if isinstance(node, ast.Assign)
    and any(isinstance(target, ast.Name) and target.id == "ANKI_VERSION" for target in node.targets)
)
module = ast.Module(body=[guard], type_ignores=[])
code = compile(module, "app.py:verify_anki_runtime", "exec")

for runtime in (version, "26.09.2", "26.10", None, "", 260903):
    buildinfo = SimpleNamespace() if runtime is None else SimpleNamespace(version=runtime)
    namespace = {"anki": SimpleNamespace(buildinfo=buildinfo), "ANKI_VERSION": version}
    exec(code, namespace)
    if runtime == version:
        assert namespace["verify_anki_runtime"]() == version
    else:
        try:
            namespace["verify_anki_runtime"]()
        except RuntimeError as error:
            assert version in str(error)
        else:
            raise AssertionError(f"runtime divergente aceito: {runtime!r}")

# A trava precisa ser executada no import, antes dos efeitos no armazenamento.
assignments = {
    target.id: node for node in tree.body if isinstance(node, ast.Assign)
    for target in node.targets if isinstance(target, ast.Name)
}
call = assignments["ANKI_RUNTIME_VERSION"]
assert isinstance(call.value, ast.Call) and call.value.func.id == guard.name
assert call.lineno < assignments["DATA_DIR"].lineno
assert 'getattr(anki.buildinfo, "version", ANKI_VERSION)' not in (root / "anki_official_backend/app.py").read_text()
print("ANKI VERSION: versão oficial aceita; versões divergentes/ausentes recusadas antes do armazenamento.")
