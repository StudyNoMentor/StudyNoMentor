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
    assert health["pinned_version"] == "26.09.3"
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
        assert {"seconds_to_show_question", "seconds_to_show_answer", "question_action", "answer_action", "wait_for_audio"} <= set(queue["card"]["auto_advance"])

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

        # Ações expostas na tela Cards-style continuam delegadas ao Anki.
        user_ctx = {"id": "smoke-user"}
        app.card_action(app.CardActionBody(action="mark", card_ids=[int(card.id)]), user_ctx)
        assert "marked" in col.get_card(card.id).note().tags
        app.card_action(app.CardActionBody(action="flag", card_ids=[int(card.id)], value=3), user_ctx)
        assert col.get_card(card.id).user_flag() == 3

        detail = app.card_detail(int(card.id), user_ctx)
        assert detail["deck_name"]
        assert detail["note_id"] == int(note.id)
        assert app.type_answer_context(col, card) is None

        updated_fields = dict(detail["fields"])
        updated_fields[keys[0]] = "Pergunta editada oficialmente"
        app.update_note(
            int(note.id),
            app.NoteUpdateBody(fields=updated_fields, tags=["marked", "smoke"]),
            user_ctx,
        )
        assert col.get_note(note.id)[keys[0]] == "Pergunta editada oficialmente"

        created = app.create_deck(app.CreateDeckBody(name="Baralho Smoke"), user_ctx)
        assert created["deck_id"] > 0
        assert col.decks.id_for_name("Baralho Smoke")

        # Deck Manager avançado usa DeckManager oficial.
        app.manage_deck({"action": "rename", "deck_id": created["deck_id"], "name": "Baralho Smoke Renomeado"}, user_ctx)
        assert col.decks.id_for_name("Baralho Smoke Renomeado")

        # Browser Cards/Notes + facets e bulk usam Search/Tags/Scheduler oficiais.
        facets = app.browser_facets(user_ctx)
        assert facets["decks"] and facets["notetypes"]
        notes_mode = app.browser_notes("Pergunta editada oficialmente", 100, 0, "", False, user_ctx)
        assert notes_mode["notes"] and notes_mode["notes"][0]["note_id"] == int(note.id)
        browser_cols = app.browser_columns(user_ctx)
        assert browser_cols["columns"] and browser_cols["active_cards"] and browser_cols["active_notes"]
        app.browser_bulk({"action": "tags_add", "note_ids": [int(note.id)], "card_ids": [], "tags": "bulk-smoke"}, user_ctx)
        assert "bulk-smoke" in col.get_note(note.id).tags

        # StatsService oficial deve responder sem cálculo paralelo no Study.
        graphs = app.collection_graphs("", 365, user_ctx)
        assert "card_counts" in graphs and "true_retention" in graphs

        # Custom Study e Filtered Deck usam o scheduler oficial.
        defaults = app.custom_study_defaults(int(col.decks.get_current_id()), user_ctx)
        assert "available_new" in defaults
        filtered = app.get_filtered_deck(0, user_ctx)
        assert "deck" in filtered and "orders" in filtered

        # Relatório de cards vazios, tipos de nota e Image Occlusion são oficiais.
        empty = app.empty_cards_report(user_ctx)
        assert isinstance(empty, dict)
        nts = app.notetypes_full(user_ctx)
        assert nts["notetypes"]
        io = app.image_occlusion_setup(user_ctx)
        assert io["ok"] is True

        # Os métodos FSRS modernos existem no backend oficial carregado no CI.
        for method in ("compute_fsrs_params", "simulate_fsrs_review", "simulate_fsrs_workload", "compute_optimal_retention"):
            assert callable(getattr(col._backend, method))

        # Deck tree usa a árvore oficial do scheduler, com contagens.
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
css2 = (ROOT / "src" / "css" / "42-anki-official-surfaces.css").read_text(encoding="utf-8")
js = (ROOT / "src" / "js" / "44-anki-official.js").read_text(encoding="utf-8")
js2 = (ROOT / "src" / "js" / "45-anki-official-surfaces.js").read_text(encoding="utf-8")
html = (ROOT / "src" / "html" / "03-corpo.html").read_text(encoding="utf-8")
assert "anki-study-review-card" in css and "anki-study-deck-row" in css
assert "anki-browser-row-advanced" in css2 and "anki-io-stage" in css2
assert "anki-type-answer-box" in css2 and "anki-column-config-row" in css2
assert "cards-review-wrap" in js and "cards-ans4" in js
assert "renderStats" in js2 and "openCustomStudy" in js2 and "openFilteredDeck" in js2
assert "openFsrsTools" in js2 and "openNotetypes" in js2 and "openImageOcclusion" in js2
assert "openBrowserColumns" in js2 and "openRichEditNote" in js2 and "toggleAutoAdvance" in js2
assert "Shift+A" not in js2 or "KeyA" in js2
assert "CardEngine." not in js and "CardsConfig." not in js
assert "CardEngine." not in js2 and "CardsConfig." not in js2
assert 'class="cards-topbar anki-cards-topbar"' in html
assert 'class="cards-tabs anki-cards-tabs"' in html
assert 'id="anki-foco-btn"' in html

print("OK: Anki 26.09.3 oficial + UI Cards avançada validados em scheduler, browser, stats, custom study, filtered deck, tipos, IO, mídia e exportação.")
