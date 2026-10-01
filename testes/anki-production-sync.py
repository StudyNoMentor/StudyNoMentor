"""Exercita a sincronização real com refs divergentes, sem rede ou force push."""
from pathlib import Path
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/sync-anki-production.sh"

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    remote = root / "remote.git"
    work = root / "work"
    env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull)

    def git(*args):
        return subprocess.check_output(["git", *args], cwd=work, env=env, text=True).strip()

    subprocess.run(["git", "init", "--bare", "--quiet", str(remote)], check=True, env=env)
    work.mkdir()
    git("init", "--quiet", "-b", "main")
    git("config", "user.name", "Sync Test")
    git("config", "user.email", "sync@example.test")
    git("remote", "add", "origin", str(remote))
    backend = work / "anki_official_backend"
    backend.mkdir()
    (backend / "app.py").write_text("initial\n")
    git("add", ".")
    git("commit", "--quiet", "-m", "initial")
    git("branch", "production")

    (backend / "app.py").write_text("fixed migration\n")
    (work / "frontend.txt").write_text("latest interface\n")
    git("add", ".")
    git("commit", "--quiet", "-m", "main fix")
    main_sha = git("rev-parse", "HEAD")
    git("switch", "--quiet", "production")
    (backend / "DEPLOY_REVISION").write_text("source-main: stale\n")
    (work / "production-only.txt").write_text("obsolete implementation\n")
    git("add", ".")
    git("commit", "--quiet", "-m", "production diverges")
    deploy_sha = git("rev-parse", "HEAD")
    git("push", "--quiet", "origin", "main", "production")
    git("fetch", "--quiet", "origin")

    subprocess.run(["bash", str(SCRIPT), "origin/main", "production"], cwd=work, env=env, check=True)
    git("fetch", "--quiet", "origin")
    synced = git("rev-parse", "origin/production")
    assert git("show", "origin/production:anki_official_backend/app.py") == "fixed migration"
    assert git("show", "origin/production:frontend.txt") == "latest interface"
    assert "production-only.txt" not in git("ls-tree", "-r", "--name-only", "origin/production").splitlines()
    assert git("show", "origin/production:anki_official_backend/DEPLOY_REVISION").splitlines()[0] == f"source-main: {main_sha}"
    git("merge-base", "--is-ancestor", main_sha, synced)
    git("merge-base", "--is-ancestor", deploy_sha, synced)
    assert set(git("rev-list", "--parents", "-n", "1", synced).split()[1:]) == {main_sha, deploy_sha}
    assert git("diff", "--name-only", "origin/main", "origin/production") == "anki_official_backend/DEPLOY_REVISION"

    subprocess.run(["bash", str(SCRIPT), "origin/main", "production"], cwd=work, env=env, check=True)
    git("fetch", "--quiet", "origin")
    assert git("rev-parse", "origin/production") == synced, "repetição não pode gerar deploy redundante"

print("ANKI PRODUCTION SYNC: árvore atual, histórico preservado, divergência e repetição validados.")
