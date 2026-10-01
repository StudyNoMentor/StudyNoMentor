"""Testa a trava de versão sem carregar Anki, FastAPI ou abrir coleções."""
import ast
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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

# Diagnóstico público precisa identificar o código realmente publicado, sem
# depender dos antigos carimbos manuais que podem continuar apontando outra revisão.
health_node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "health")
health_node.decorator_list = []
health_code = compile(ast.Module(body=[health_node], type_ignores=[]), "app.py:health", "exec")
with tempfile.TemporaryDirectory() as tmp:
    backend_path = Path(tmp) / "app.py"
    namespace = {
        "Path": Path, "os": os, "__file__": str(backend_path), "Any": object,
        "ANKI_VERSION": version, "ANKI_RUNTIME_VERSION": version,
    }
    exec(health_code, namespace)
    with patch.dict(os.environ, {"RAILWAY_GIT_COMMIT_SHA": "actual-commit", "RAILWAY_GIT_BRANCH": "production", "STUDY_BACKEND_SOURCE_REV": "stale-manual-revision"}, clear=True):
        health = namespace["health"]()
        assert health["source_rev"] == "actual-commit"
        assert health["source_branch"] == "production"
        assert health["source_main"] is None
        (Path(tmp) / "DEPLOY_REVISION").write_text("source-main: validated-main\nreason: test\n")
        assert namespace["health"]()["source_main"] == "validated-main"
    with patch.dict(os.environ, {"STUDY_BACKEND_SOURCE_REV": "manual-revision"}, clear=True):
        assert namespace["health"]()["source_rev"] == "manual-revision"
    with patch.dict(os.environ, {}, clear=True):
        health = namespace["health"]()
        assert health["source_rev"] is None and health["source_branch"] is None
        assert "data_dir" not in health
print("ANKI HEALTH: revisão Railway prioritária, main publicada rastreável, ausência explícita e sem caminhos privados.")
