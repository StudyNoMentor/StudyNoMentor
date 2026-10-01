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

        # {{type:Campo}}: o padrão precisa reconhecer o marcador REAL do Anki.
        # (A regex com barras dobradas nunca casava e o campo de digitação sumia.)
        assert app.TYPE_ANSWER_PATTERN.search("<div>[[type:Back]]</div>").group(1) == "Back"
        typed_nt = col.models.by_name("Basic (type in the answer)")
        assert typed_nt, "tipo de nota oficial com campo de digitação ausente"
        typed = col.new_note(typed_nt)
        tkeys = typed.keys()
        typed[tkeys[0]] = "Capital da França?"
        typed[tkeys[1]] = "Paris"
        col.add_note(typed, col.decks.get_current_id())
        typed_card = typed.cards()[0]
        ctx = app.type_answer_context(col, typed_card)
        assert ctx and ctx["enabled"] is True and ctx["expected"] == "Paris", ctx
        assert "[[type:" not in ctx["question_html"]
        compared = app.reviewer_type_answer(int(typed_card.id), app.TypeAnswerBody(provided="Pariz"), user_ctx)
        assert compared["enabled"] is True and "anki-type-answer-comparison" in compared["answer_html"]

        # "Marcar" dois cards IRMÃOS alterna a nota uma única vez.
        rev_nt = col.models.by_name("Basic (and reversed card)")
        pair = col.new_note(rev_nt)
        pkeys = pair.keys()
        pair[pkeys[0]] = "Irmão A"
        pair[pkeys[1]] = "Irmão B"
        col.add_note(pair, col.decks.get_current_id())
        sibling_ids = [int(c.id) for c in pair.cards()]
        assert len(sibling_ids) == 2
        app.card_action(app.CardActionBody(action="mark", card_ids=sibling_ids), user_ctx)
        assert "marked" in col.get_note(pair.id).tags, "marcar irmãos deve marcar a nota"

        # /health não expõe caminhos do servidor.
        assert "data_dir" not in app.health()

    # A tela Cards usa uma coleção OFICIAL separada do menu Anki.
    cards_user = app.cards_pool.get("smoke-user")
    assert cards_user.collection_path != user.collection_path
    assert "study-cards" in str(cards_user.collection_path)
    cards_ctx = {"id": "smoke-user"}
    with cards_user.lock:
        ccol = cards_user.col
        cnt = ccol.models.current()
        cnt_id = int(cnt["id"])
        cards_current_deck = int(ccol.decks.get_current_id())
        cnote = ccol.new_note(cnt)
        ckeys = cnote.keys()
        cnote[ckeys[0]] = "Cards bridge pergunta"
        cnote[ckeys[1]] = "Cards bridge resposta"
        ccol.add_note(cnote, ccol.decks.get_current_id())
        ccid = int(cnote.cards()[0].id)

    cq = app.cards_official_reviewer_next(cards_ctx)
    assert cq["finished"] is False
    assert ccid in cq["queue_ids"]
    assert cq["card"]["question"]
    assert cq["card"]["answer"]
    assert set(cq["counts"]) == {"new", "learning", "review"}

    # A marca pertence à nota. IDs repetidos não podem alterná-la duas vezes,
    # e a casca recebe tags oficiais em ambas as direções.
    marked = app.cards_official_card_action(
        app.CardActionBody(action="mark", card_ids=[ccid, ccid]), cards_ctx
    )
    assert len(marked["notes"]) == 1
    assert marked["notes"][0]["id"] == int(cnote.id)
    assert "marked" in marked["notes"][0]["tags"]
    unmarked = app.cards_official_card_action(
        app.CardActionBody(action="mark", card_ids=[ccid]), cards_ctx
    )
    assert "marked" not in unmarked["notes"][0]["tags"]

    answered = app.cards_official_reviewer_answer(
        app.AnswerBody(card_id=ccid, rating=3, milliseconds_taken=321),
        cards_ctx,
    )
    state = answered["answered"]
    assert state["id"] == ccid
    assert state["question"] and state["answer"]
    assert state["reps"] >= 1
    assert state["review_logs"], "revlog oficial precisa voltar no snapshot"
    assert state["memory_state"] is None or {"stability", "difficulty"} <= set(state["memory_state"])

    # CRUD de Note da tela Cards: criação, edição e exclusão acontecem na
    # Collection oficial e devolvem o conjunto de cards gerado pelo Anki.
    created_note = app.cards_official_add_note(
        app.AddNoteBody(
            deck_id=cards_current_deck,
            notetype_id=cnt_id,
            fields={ckeys[0]: "CRUD oficial pergunta", ckeys[1]: "CRUD oficial resposta"},
            tags=["crud-official"],
        ),
        cards_ctx,
    )
    assert created_note["note"]["id"] > 0 and created_note["cards"]
    crud_nid = int(created_note["note"]["id"])
    crud_fields = dict(created_note["note"]["fields"])
    crud_fields[ckeys[0]] = "CRUD oficial editado"
    updated_note = app.cards_official_update_note(
        crud_nid,
        app.NoteUpdateBody(fields=crud_fields, tags=["crud-oficial-editado"]),
        cards_ctx,
    )
    assert updated_note["note"]["fields"][ckeys[0]] == "CRUD oficial editado"
    assert updated_note["cards"], "update_note oficial deve manter/gerar os cards válidos"
    deleted_note = app.cards_official_delete_note(crud_nid, cards_ctx)
    assert deleted_note["ok"] is True and deleted_note["deleted_note_id"] == crud_nid
    with cards_user.lock:
        try:
            ccol.get_note(crud_nid)
            raise AssertionError("nota excluída ainda existe na Collection oficial")
        except Exception:
            pass

    # Search/sort do Browser vêm de find_cards/find_notes oficiais.
    bcards = app.cards_official_browser_ids("cards", "Cards bridge pergunta", "", False, cards_ctx)
    bnotes = app.cards_official_browser_ids("notes", "Cards bridge pergunta", "", False, cards_ctx)
    assert bcards["ids"] == [ccid]
    assert int(cnote.id) in bnotes["ids"]
    bfacets = app.cards_official_browser_facets(cards_ctx)
    assert bfacets["columns"] and bfacets["notetypes"]

    # Stats, Deck Options, Custom Study, Filtered Decks e Empty Cards usam a
    # MESMA coleção isolada dos Cards, não a coleção do menu Anki.
    cgraphs = app.cards_official_collection_graphs("", 365, cards_ctx)
    assert "card_counts" in cgraphs and "true_retention" in cgraphs

    # Preferences globais de scheduling pertencem à Collection oficial.
    cprefs = app.cards_official_preferences(cards_ctx)
    old_rollover = int(cprefs["scheduling"]["rollover"])
    old_learn_ahead = int(cprefs["scheduling"]["learn_ahead_secs"])
    changed_prefs = app.cards_official_update_preferences(
        {"scheduling": {"rollover": (old_rollover + 1) % 24, "learn_ahead_secs": old_learn_ahead + 60}},
        cards_ctx,
    )
    assert changed_prefs["ok"] is True
    assert int(changed_prefs["preferences"]["scheduling"]["rollover"]) == (old_rollover + 1) % 24
    assert int(changed_prefs["preferences"]["scheduling"]["learn_ahead_secs"]) == old_learn_ahead + 60
    app.cards_official_update_preferences(
        {"scheduling": {"rollover": old_rollover, "learn_ahead_secs": old_learn_ahead}},
        cards_ctx,
    )
    copts = app.cards_official_deck_options(cards_current_deck, cards_ctx)
    assert copts["current_deck"]["name"]
    # Um preset novo é enviado com id=0, exatamente como o frontend oficial:
    # o backend aloca a identidade, aponta o deck para ela e devolve o estado
    # canônico posterior à transação.
    current_conf_id = int(copts["current_deck"]["config_id"])
    selected = next(x for x in copts["all_config"] if int(x["config"]["id"]) == current_conf_id)
    new_conf = dict(selected["config"])
    new_conf["config"] = dict(new_conf.get("config") or {})
    new_conf["id"] = 0
    new_conf["name"] = "Cards Smoke Preset"
    new_conf["config"]["new_per_day"] = int(new_conf["config"].get("new_per_day", 20)) + 1
    cupdated = app.cards_official_update_deck_options(
        cards_current_deck,
        {
            "configs": [new_conf],
            "removed_config_ids": [],
            "mode": 0,
            "limits": dict(copts["current_deck"].get("limits") or {}),
            "new_cards_ignore_review_limit": bool(copts.get("new_cards_ignore_review_limit", False)),
            "fsrs": bool(copts.get("fsrs", True)),
            "apply_all_parent_limits": bool(copts.get("apply_all_parent_limits", False)),
            "fsrs_reschedule": False,
            "fsrs_health_check": False,
        },
        cards_ctx,
    )
    allocated_conf_id = int(cupdated["options"]["current_deck"]["config_id"])
    assert allocated_conf_id > 0 and allocated_conf_id != current_conf_id
    assert cupdated["state"]["cards"] and cupdated["state"]["reviewer"]
    inherited = app.cards_official_update_deck_options(
        cards_current_deck,
        {
            "configs": [dict(selected["config"])],
            "removed_config_ids": [],
            "mode": 0,
            "limits": dict(copts["current_deck"].get("limits") or {}),
            "new_cards_ignore_review_limit": bool(copts.get("new_cards_ignore_review_limit", False)),
            "fsrs": bool(copts.get("fsrs", True)),
            "apply_all_parent_limits": bool(copts.get("apply_all_parent_limits", False)),
            "fsrs_reschedule": False,
            "fsrs_health_check": False,
        },
        cards_ctx,
    )
    assert int(inherited["options"]["current_deck"]["config_id"]) == current_conf_id
    cdefaults = app.cards_official_custom_study_defaults(cards_current_deck, cards_ctx)
    assert "available_new" in cdefaults and "available_review" in cdefaults
    cfiltered = app.cards_official_get_filtered_deck(0, cards_ctx)
    assert "deck" in cfiltered and "orders" in cfiltered
    filtered_deck = dict(cfiltered["deck"])
    # Proto3 omite escalares no valor padrão: um deck NOVO possui id=0 e o
    # MessageToDict não emite a chave "id". O ID canônico só nasce no update.
    filtered_id = int(filtered_deck.get("id", 0))
    assert filtered_id == 0
    filtered_deck["name"] = "Cards Smoke Filtrado"
    filtered_deck["allow_empty"] = True
    fconfig = dict(filtered_deck.get("config") or {})
    fconfig["reschedule"] = True
    fconfig["search_terms"] = [
        {"search": "Cards bridge pergunta", "limit": 20, "order": 1}
    ]
    filtered_deck["config"] = fconfig
    fupdated = app.cards_official_update_filtered_deck(filtered_id, filtered_deck, cards_ctx)
    filtered_id = int(fupdated["deck_id"])
    assert filtered_id > 0
    frebuilt = app.cards_official_rebuild_filtered_deck(filtered_id, cards_ctx)
    assert frebuilt["state"]["decks"] and frebuilt["state"]["cards"]
    moved = next(x for x in frebuilt["state"]["cards"] if int(x["id"]) == ccid)
    assert int(moved["deck_id"]) == filtered_id
    assert int(moved["original_deck_id"]) == cards_current_deck
    fstate = app.cards_official_collection_state(cards_ctx)
    assert any(int(d["id"]) == filtered_id and d["filtered"] for d in fstate["decks"])
    fempty = app.cards_official_empty_filtered_deck(filtered_id, cards_ctx)
    restored = next(x for x in fempty["state"]["cards"] if int(x["id"]) == ccid)
    assert int(restored["deck_id"]) == cards_current_deck
    assert int(restored.get("original_deck_id", 0)) == 0

    custom = app.cards_official_custom_study(
        {"deck_id": cards_current_deck, "new_limit_delta": 1},
        cards_ctx,
    )
    assert custom["ok"] is True and custom["state"]["reviewer"]

    cempty = app.cards_official_empty_cards_report(cards_ctx)
    assert isinstance(cempty, dict)
    # Segurança: o endpoint de limpeza só aceita IDs que o EmptyCardsReport da
    # MESMA coleção acabou de classificar como vazios. Um card normal não pode
    # ser apagado por uma chamada forjada.
    try:
        app.cards_official_delete_empty_cards({"card_ids": [ccid]}, cards_ctx)
        raise AssertionError("Empty Cards aceitou excluir um card não vazio")
    except app.HTTPException as exc:
        assert exc.status_code == 400

    bulk = app.cards_official_browser_bulk(
        {"action": "flag", "card_ids": [ccid], "note_ids": [], "flag": 6},
        cards_ctx,
    )
    assert bulk["cards"][0]["flag"] == 6
    tagged = app.cards_official_browser_bulk(
        {"action": "tags_add", "card_ids": [], "note_ids": [int(cnote.id)], "tags": "cards-official"},
        cards_ctx,
    )
    assert "cards-official" in tagged["notes"][0]["tags"]

    # Change Notetype usa o mapa e a mutação oficiais e devolve o conjunto final de cards.
    with cards_user.lock:
        reversed_nt = ccol.models.by_name("Basic (and reversed card)")
        old_nt = ccol.get_note(cnote.id).note_type()
        old_id = int(old_nt["id"])
        new_id = int(reversed_nt["id"])
    info = app.cards_official_change_notetype_info(old_id, new_id, cards_ctx)
    request = dict(info["input"])
    request["note_ids"] = [int(cnote.id)]
    changed = app.cards_official_change_notetype(request, cards_ctx)
    assert changed["notes"][0]["notetype_id"] == new_id
    assert changed["cards"], "Anki deve devolver os cards resultantes da mudança de tipo"

    # Undo/redo da coleção Cards também pertencem ao backend oficial.
    undo_out = app.cards_official_undo(cards_ctx)
    assert undo_out["ok"] is True and "reviewer" in undo_out
    redo_out = app.cards_official_redo(cards_ctx)
    assert redo_out["ok"] is True and "reviewer" in redo_out

    app.cards_pool.close_all()
    app.pool.close_all()

    # Pool com teto (LRU): coleções antigas e livres são fechadas.
    small = app.CollectionPool(max_open=2)
    a = small.get("lru-a"); small.get("lru-b"); small.get("lru-c")
    assert "lru-a" not in small._items and len(small._items) == 2
    small.close_all()

    # Upload em blocos com teto: passa do limite -> 413, sem temporário órfão.
    import asyncio, io, glob

    class FakeUpload:
        def __init__(self, data):
            self._b = io.BytesIO(data)
        async def read(self, n=-1):
            return self._b.read(n)

    before = set(glob.glob(os.path.join(tempfile.gettempdir(), "*.bin")))
    try:
        asyncio.run(app._upload_to_tempfile(FakeUpload(b"x" * (3 * 1024 * 1024)), ".bin", 1024 * 1024))
        raise AssertionError("upload acima do limite deveria falhar")
    except app.HTTPException as exc:
        assert exc.status_code == 413
    after = set(glob.glob(os.path.join(tempfile.gettempdir(), "*.bin")))
    assert after == before, "upload recusado não pode deixar arquivo temporário"
    ok_tmp = asyncio.run(app._upload_to_tempfile(FakeUpload(b"abc"), ".bin", 1024))
    assert Path(ok_tmp).read_bytes() == b"abc"
    os.unlink(ok_tmp)

    # .colpkg inválido: a coleção do usuário continua ABERTA e intacta.
    user2 = app.pool.get("colpkg-user")
    with user2.lock:
        n2 = user2.col.new_note(user2.col.models.current())
        k2 = n2.keys(); n2[k2[0]] = "Sobrevive"; n2[k2[1]] = "à importação"
        user2.col.add_note(n2, user2.col.decks.get_current_id())

    class NamedUpload(FakeUpload):
        filename = "quebrado.colpkg"

    try:
        asyncio.run(app.import_colpkg(NamedUpload(b"isto nao e um colpkg"), {"id": "colpkg-user"}))
        raise AssertionError("colpkg inválido deveria falhar")
    except AssertionError:
        raise
    except Exception:
        pass
    with user2.lock:
        assert user2.col.card_count() >= 1, "a coleção deve seguir aberta e com os dados anteriores"
        assert user2.col.find_cards("Sobrevive")
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
