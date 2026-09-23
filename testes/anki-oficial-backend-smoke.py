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
        col = user.col
        assert col.card_count() == 0
        decks = list(col.decks.all_names_and_ids())
        assert decks

        # Coleção + tipos de nota oficiais
        notetype = col.models.current()
        note = col.new_note(notetype)
        keys = note.keys()
        assert len(keys) >= 2
        note[keys[0]] = "Pergunta oficial"
        note[keys[1]] = "Resposta oficial"
        col.add_note(note, col.decks.get_current_id())
        assert col.card_count() >= 1

        # Busca oficial do Anki
        found = list(col.find_cards("Pergunta oficial"))
        assert found

        # Fila + scheduling states + resposta oficial
        queue = app.queued_payload(col)
        assert queue["finished"] is False
        assert set(queue["counts"]) == {"new", "learning", "review"}

        queued = col.sched.get_queued_cards(fetch_limit=1)
        q = queued.cards[0]
        card = col.get_card(q.card.id)
        card.start_timer()
        answer = col.sched.build_answer(
            card=card,
            states=q.states,
            rating=app.CardAnswer.GOOD,
        )
        answer.milliseconds_taken = 250
        col.sched.answer_card(answer)
        assert col.get_card(card.id).reps >= 1

        # Deck picker Android usa a árvore oficial do scheduler, com contagens.
        tree = col.sched.deck_due_tree()
        tree_json = app.deck_tree_payload(tree)
        assert "children" in tree_json
        assert tree_json["children"]
        first_deck = tree_json["children"][0]
        assert {"deck_id", "new_count", "learn_count", "review_count"} <= set(first_deck)

        # Deck Options e Check Media vêm do backend oficial
        options = col.decks.get_deck_configs_for_update(col.decks.get_current_id())
        assert options.current_deck.name
        media = col.media.check()
        assert media is not None

        # Exportador oficial abre e grava um pacote real.
        out = Path(tmp) / "smoke.apkg"
        col.export_anki_package(
            out_path=str(out),
            options=app.ExportAnkiPackageOptions(
                with_scheduling=True,
                with_deck_configs=True,
                with_media=True,
                legacy=False,
            ),
            limit=None,
        )
        assert out.is_file() and out.stat().st_size > 0

    app.pool.close_all()

header = (ROOT / "src" / "html" / "00-cabecalho.html").read_text(encoding="utf-8")
assert "https://anki-official-production.up.railway.app" in header
assert "frame-src 'self' blob:" in header
assert "media-src 'self' data: blob: https:" in header

css = (ROOT / "src" / "css" / "41-anki-official.css").read_text(encoding="utf-8")
js = (ROOT / "src" / "js" / "44-anki-official.js").read_text(encoding="utf-8")
html = (ROOT / "src" / "html" / "03-corpo.html").read_text(encoding="utf-8")
assert "ankidroid-bottom-nav" in css and "ankidroid-deck-row" in css
assert "deck_tree" in js and "anki-mobile-immersive" in js
assert 'id="anki-study-exit"' in html

print("OK: Anki 26.09.2 oficial + casca AnkiDroid validados em coleção, deck tree, fila, resposta, UI, mídia e exportação.")
