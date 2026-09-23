from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "anki_official_backend"))

with tempfile.TemporaryDirectory() as tmp:
    os.environ["ANKI_DATA_DIR"] = tmp
    import app

    health = app.health()
    assert health["pinned_version"] == "26.09.2"
    assert health["engine"] == "anki"

    user = app.pool.get("smoke-user")
    with user.lock:
        assert user.col.card_count() == 0
        decks = list(user.col.decks.all_names_and_ids())
        assert decks
        queue = app.queued_payload(user.col)
        assert queue["finished"] is True
        assert set(queue["counts"]) == {"new", "learning", "review"}

    app.pool.close_all()

print("OK: backend oficial Anki 26.09.2 abre coleção, decks e scheduler.")
