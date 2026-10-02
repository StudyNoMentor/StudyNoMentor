"""Exercise scoped review sessions against the real upstream scheduler."""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "anki_official_backend"))

with tempfile.TemporaryDirectory() as tmp:
    os.environ["ANKI_DATA_DIR"] = tmp
    import app

    user = {"id": "scope-regression"}
    item = app.cards_uc_for(user)
    with item.lock:
        col = item.col
        ids = []
        for idx in range(21):
            note = col.new_note(col.models.current())
            note["Front"] = f"Card {idx + 1}"
            note["Back"] = "Answer"
            col.add_note(note, col.decks.get_current_id())
            ids.extend(col.card_ids_of_note(note.id))

    # Session A sees only card 21. It must remain reviewable even though 20 cards
    # outside the scope would otherwise consume the native daily new-card limit.
    a = app.cards_official_reviewer_scope(
        app.CardsReviewScopeBody(
            session_id="device-a-session",
            deck_id=0,
            card_ids=[ids[-1]],
            label="Plan A",
        ),
        user,
    )
    assert a["review_scope"]["total_cards"] == 1
    assert a["counts"]["new"] == 1
    assert a["card"]["id"] == ids[-1]

    # A second device gets an independent snapshot and cannot overwrite A.
    b = app.cards_official_reviewer_scope(
        app.CardsReviewScopeBody(
            session_id="device-b-session",
            deck_id=0,
            card_ids=[ids[0]],
            label="Plan B",
        ),
        user,
    )
    assert b["card"]["id"] == ids[0]
    a_again = app.cards_official_reviewer_next("device-a-session", user)
    assert a_again["card"]["id"] == ids[-1]

    request_id = "device-a:card21:attempt1"
    out = app.cards_official_reviewer_answer(
        app.AnswerBody(
            session_id="device-a-session",
            session_version=a["review_session"]["version"],
            request_id=request_id,
            card_id=ids[-1],
            rating=3,
        ),
        user,
    )
    item = app.cards_uc_for(user)
    with item.lock:
        assert item.col.get_card(ids[-1]).reps == 1
        assert item.col.get_card(ids[0]).reps == 0
        revlogs = len(item.col.get_review_logs(ids[-1]))

    # Transport retry with the same request id is idempotent.
    retry = app.cards_official_reviewer_answer(
        app.AnswerBody(
            session_id="device-a-session",
            session_version=a["review_session"]["version"],
            request_id=request_id,
            card_id=ids[-1],
            rating=3,
        ),
        user,
    )
    assert retry["idempotent"] is True
    item = app.cards_uc_for(user)
    with item.lock:
        assert item.col.get_card(ids[-1]).reps == 1
        assert len(item.col.get_review_logs(ids[-1])) == revlogs

    empty = app.cards_official_reviewer_scope(
        app.CardsReviewScopeBody(
            session_id="empty-session",
            deck_id=0,
            card_ids=[],
            label="Empty",
        ),
        user,
    )
    assert empty["finished"] and empty["review_scope"]["total_cards"] == 0

    # A12: obtaining B must not close A before A acquires its lock.
    tiny = app.CollectionPool(max_open=1, namespace="pool-regression")
    first = tiny.get("pool-a")
    second = tiny.get("pool-b")
    with first.lock:
        first.col.card_count()  # must remain open despite the LRU pressure
    with second.lock:
        second.col.card_count()
    tiny.close_all()

    app.review_sessions.close_all()
    app.cards_pool.close_all()

print("Scoped native queue, device isolation and idempotent answer: OK")
