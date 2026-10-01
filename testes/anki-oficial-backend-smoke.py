from __future__ import annotations

import json
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
    assert health["runtime_version"] == health["pinned_version"]
    assert "source_rev" in health and "source_branch" in health and "source_main" in health
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

    # Migração única do legado: a casca envia somente estado acadêmico ao
    # backend; metadados de planejamento/banca permanecem no espelho Study.
    # Deck/NoteType/Note/Card passam a existir como objetos oficiais.
    legacy_ctx = {"id": "legacy-migration-user"}
    legacy_item = app.cards_uc_for(legacy_ctx)
    with legacy_item.lock:
        legacy_today = int(legacy_item.col.sched.today)
        assert legacy_item.col.card_count() == 0
        assert legacy_item.col.note_count() == 0

    migrated = app.cards_official_migrate_legacy(
        {
            "decks": [{"id": "deck:p1", "name": "Legado Fiscal"}],
            "notetypes": [
                {
                    "id": "nt:basic",
                    "name": "Study Legacy Basic",
                    "stock_kind": "basic",
                }
            ],
            "notes": [
                {
                    "id": "note:p1",
                    "notetype_id": "nt:basic",
                    "guid": "legacyguid",
                    "fields": {"Front": "Pergunta legado", "Back": "Resposta legado"},
                    "tags": ["legacy", "marked"],
                }
            ],
            "cards": [
                {
                    "id": "card:p1",
                    "note_id": "note:p1",
                    "deck_id": "deck:p1",
                    "template_idx": 0,
                    "anki_type": 2,
                    "anki_queue": 2,
                    "anki_due": legacy_today + 3,
                    "interval": 12,
                    "ease": 2.5,
                    "reps": 7,
                    "lapses": 1,
                    "flag": 2,
                    "s": 4.5,
                    "d": 6.0,
                }
            ],
            "revlog": [
                {
                    "card_id": "card:p1",
                    "ts": 1700000000000,
                    "grade": 3,
                    "anki_interval": 12,
                    "anki_last_interval": 5,
                    "ease_factor": 2500,
                    "time": 432,
                    "anki_review_kind": 0,
                    "anki_ivl_semantica": 2,
                }
            ],
        },
        legacy_ctx,
    )
    assert migrated["ok"] is True
    assert migrated["migrated"] == {"decks": 1, "notetypes": 1, "notes": 1, "cards": 1, "revlog": 1}
    assert migrated["deck_map"]["deck:p1"] > 0
    assert migrated["notetype_map"]["nt:basic"] > 0
    official_legacy_cid = int(migrated["card_map"]["card:p1"])
    official_legacy_nid = int(migrated["note_map"]["note:p1"])
    assert official_legacy_cid > 0 and official_legacy_nid > 0
    assert any(int(x["id"]) == official_legacy_cid for x in migrated["state"]["cards"])
    assert any(int(x["id"]) == official_legacy_nid for x in migrated["state"]["notes"])

    with legacy_item.lock:
        legacy_card = legacy_item.col.get_card(official_legacy_cid)
        legacy_note = legacy_item.col.get_note(official_legacy_nid)
        assert legacy_card.ivl == 12
        assert legacy_card.reps == 7
        assert legacy_card.lapses == 1
        assert legacy_card.user_flag() == 2
        assert legacy_card.memory_state is not None
        assert abs(float(legacy_card.memory_state.stability) - 4.5) < 1e-6
        assert abs(float(legacy_card.memory_state.difficulty) - 6.0) < 1e-6
        assert legacy_note.guid == "legacyguid"
        assert "marked" in legacy_note.tags
        # custom_data é reservado ao scheduler oficial e tem limite <100 bytes;
        # a migração não o usa como armazenamento de metadados da casca.
        assert legacy_card.custom_data == ""
        revrow = legacy_item.col.db.first(
            "select ease,ivl,lastIvl,factor,time,type from revlog where cid = ? order by id",
            official_legacy_cid,
        )
        assert list(revrow) == [3, 12, 5, 2500, 432, 0], revrow
        assert legacy_item.col.card_count() == 1
        assert legacy_item.col.note_count() == 1

    try:
        app.cards_official_migrate_legacy({"cards": []}, legacy_ctx)
        raise AssertionError("segunda migração sobre Collection preenchida deveria ser recusada")
    except app.HTTPException as exc:
        assert exc.status_code == 409

    # Ordinais/siblings e NoteTypes homônimos: cada tipo legado distinto
    # precisa virar um NoteType oficial próprio, e cada card precisa conservar
    # seu ordinal gerado pelo Anki.
    shapes_ctx = {"id": "legacy-shapes-user"}
    shapes_item = app.cards_uc_for(shapes_ctx)
    shaped = app.cards_official_migrate_legacy(
        {
            "decks": [{"id": "deck:shapes", "name": "Legado Shapes"}],
            "notetypes": [
                {
                    "id": "nt:reverse",
                    "name": "Legacy Mesmo Nome",
                    "stock_kind": "basic_reversed",
                },
                {
                    "id": "nt:cloze",
                    "name": "Legacy Mesmo Nome",
                    "stock_kind": "cloze",
                },
            ],
            "notes": [
                {
                    "id": "note:reverse",
                    "notetype_id": "nt:reverse",
                    "fields": {"Front": "Frente reversa", "Back": "Verso reverso"},
                    "tags": [],
                },
                {
                    "id": "note:cloze",
                    "notetype_id": "nt:cloze",
                    "fields": {
                        "Text": "{{c1::Primeiro}} e {{c2::Segundo}}",
                        "Back Extra": "Extra",
                    },
                    "tags": [],
                },
            ],
            "cards": [
                {
                    "id": "card:reverse:0",
                    "note_id": "note:reverse",
                    "deck_id": "deck:shapes",
                    "template_idx": 0,
                    "anki_type": 0,
                    "anki_queue": 0,
                    "new_position": 1,
                },
                {
                    "id": "card:reverse:1",
                    "note_id": "note:reverse",
                    "deck_id": "deck:shapes",
                    "template_idx": 1,
                    "anki_type": 0,
                    "anki_queue": 0,
                    "new_position": 2,
                },
                {
                    "id": "card:cloze:1",
                    "note_id": "note:cloze",
                    "deck_id": "deck:shapes",
                    "template_idx": 0,
                    "anki_type": 0,
                    "anki_queue": 0,
                    "new_position": 3,
                },
                {
                    "id": "card:cloze:2",
                    "note_id": "note:cloze",
                    "deck_id": "deck:shapes",
                    "template_idx": 1,
                    "anki_type": 0,
                    "anki_queue": 0,
                    "new_position": 4,
                },
            ],
            "revlog": [],
        },
        shapes_ctx,
    )
    assert shaped["migrated"] == {"decks": 1, "notetypes": 2, "notes": 2, "cards": 4, "revlog": 0}
    reverse_ntid = int(shaped["notetype_map"]["nt:reverse"])
    cloze_ntid = int(shaped["notetype_map"]["nt:cloze"])
    assert reverse_ntid != cloze_ntid
    reverse_ids = {
        int(shaped["card_map"]["card:reverse:0"]),
        int(shaped["card_map"]["card:reverse:1"]),
    }
    cloze_ids = {
        int(shaped["card_map"]["card:cloze:1"]),
        int(shaped["card_map"]["card:cloze:2"]),
    }
    assert len(reverse_ids) == 2
    assert len(cloze_ids) == 2
    with shapes_item.lock:
        reverse_note = shapes_item.col.get_note(int(shaped["note_map"]["note:reverse"]))
        cloze_note = shapes_item.col.get_note(int(shaped["note_map"]["note:cloze"]))
        assert set(int(x) for x in shapes_item.col.card_ids_of_note(reverse_note.id)) == reverse_ids
        assert set(int(x) for x in shapes_item.col.card_ids_of_note(cloze_note.id)) == cloze_ids
        assert {int(shapes_item.col.get_card(cid).ord) for cid in reverse_ids} == {0, 1}
        assert {int(shapes_item.col.get_card(cid).ord) for cid in cloze_ids} == {0, 1}
        reverse_nt = shapes_item.col.models.get(reverse_ntid)
        cloze_nt = shapes_item.col.models.get(cloze_ntid)
        assert reverse_nt and cloze_nt
        assert reverse_nt["name"] != cloze_nt["name"], "Anki deve tornar nomes homônimos únicos"
        assert len(reverse_nt["tmpls"]) == 2
        assert int(cloze_nt["type"]) == 1


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
    crud_cid = int(created_note["cards"][0]["id"])
    crud_fields = dict(created_note["note"]["fields"])
    crud_fields[ckeys[0]] = "CRUD oficial editado"

    # A casca Study não usa custom_data como banco paralelo. Além do limite
    # oficial (<100 bytes), esse objeto JSON pode pertencer a Card State Customizer.
    with cards_user.lock:
        protected = ccol.get_card(crud_cid)
        protected.custom_data = '{"addon":1}'
        ccol.update_card(protected)

    updated_note = app.cards_official_update_note(
        crud_nid,
        app.NoteUpdateBody(fields=crud_fields, tags=["crud-oficial-editado"]),
        cards_ctx,
    )
    assert updated_note["note"]["fields"][ckeys[0]] == "CRUD oficial editado"
    assert updated_note["cards"], "update_note oficial deve manter/gerar os cards válidos"
    with cards_user.lock:
        assert ccol.get_card(crud_cid).custom_data == '{"addon":1}'

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
    # Migração automática legado -> Collection oficial. Esse é o caminho
    # usado pelos Cards quando o backend oficial está vazio na primeira abertura.
    legacy_user = {"id": "legacy-cards-migration-user"}
    legacy_payload = {
        "decks": [{"id": "deck:plan:p1:d1", "name": "Legado"}],
        "notetypes": [{
            "id": "notetype:plan:p1:nt1",
            "name": "Legado Basic",
            "kind": "basic",
            "fields": [{"name": "Front"}, {"name": "Back"}],
            "templates": [{"name": "Card 1", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}<hr id=answer>{{Back}}"}],
        }],
        "notes": [{
            "id": "note:plan:p1:n1",
            "notetype_id": "notetype:plan:p1:nt1",
            "guid": "study-guid-legacy-1",
            "fields": {"Front": "Pergunta legada", "Back": "Resposta legada"},
            "tags": ["legacy"],
        }],
        "cards": [{
            "id": "card:plan:p1:c1",
            "note_id": "note:plan:p1:n1",
            "deck_id": "deck:plan:p1:d1",
            "template_idx": 0,
            "phase": "new",
            "new_position": 1,
            "interval": 0,
            "ease_factor": 2500,
            "reps": 0,
            "lapses": 0,
            "remaining_steps": 0,
            "flag": 0,
            "materia": "Direito Tributário",
            "assunto": "ICMS",
            "banca": "CEBRASPE",
        }],
        "revlog": [{
            "card_id": "card:plan:p1:c1",
            "ts": 1700000000123,
            "grade": 3,
            "anki_interval": 1,
            "anki_last_interval": 0,
            "ease_factor": 2500,
            "time": 321,
            "anki_review_kind": 0,
            "anki_ivl_semantica": 2,
        }],
    }
    migrated = app.cards_official_migrate_legacy(legacy_payload, legacy_user)
    assert migrated["ok"] is True
    assert migrated["migrated"]["decks"] == 1
    assert migrated["migrated"]["notetypes"] == 1
    assert migrated["migrated"]["notes"] == 1
    assert migrated["migrated"]["cards"] == 1
    assert migrated["migrated"]["revlog"] == 1
    assert migrated["deck_map"]["deck:plan:p1:d1"] > 0
    assert migrated["notetype_map"]["notetype:plan:p1:nt1"] > 0
    assert migrated["note_map"]["note:plan:p1:n1"] > 0
    assert migrated["card_map"]["card:plan:p1:c1"] > 0
    migrated_state = migrated["state"]
    assert len(migrated_state["cards"]) == 1 and migrated_state["cards"][0]["question"]
    assert len(migrated_state["notes"]) == 1
    legacy_item = app.cards_uc_for(legacy_user)
    with legacy_item.lock:
        legacy_note = legacy_item.col.get_note(int(migrated["note_map"]["note:plan:p1:n1"]))
        assert legacy_note.guid == "study-guid-legacy-1"
        legacy_card_id = int(migrated["card_map"]["card:plan:p1:c1"])
        assert int(legacy_item.col.db.scalar("select type from revlog where cid = ? order by id desc limit 1", legacy_card_id)) == 0
    try:
        app.cards_official_migrate_legacy(legacy_payload, legacy_user)
        raise AssertionError("segunda migração deveria ser recusada")
    except app.HTTPException as exc:
        assert exc.status_code == 409

    # Regressão de produção: versões antigas do espelho Study podiam trazer
    # "Basic (and reversed card)" com qfmt duplicado. A migração deve preservar
    # os templates stock do Anki, em vez de tentar persistir o clone inválido.
    reversed_user = {"id": "legacy-cards-reversed-template-user"}
    reversed_payload = {
        "decks": [{"id": "d", "name": "Reversed"}],
        "notetypes": [{
            "id": "nt",
            "name": "Basic (and reversed card)",
            "stock_kind": "basic_reversed",
            "kind": "normal",
            "fields": [{"name": "Front"}, {"name": "Back"}],
            "templates": [
                {"name": "Card 1", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}<hr id=answer>{{Back}}"},
                {"name": "Card 2", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}<hr id=answer>{{Back}}"},
            ],
        }],
        "notes": [{
            "id": "n",
            "notetype_id": "nt",
            "fields": {"Front": "Pergunta", "Back": "Resposta"},
            "tags": [],
        }],
        "cards": [
            {"id": "c1", "note_id": "n", "deck_id": "d", "template_idx": 0, "phase": "new"},
            {"id": "c2", "note_id": "n", "deck_id": "d", "template_idx": 1, "phase": "new"},
        ],
        "revlog": [],
    }
    reversed = app.cards_official_migrate_legacy(reversed_payload, reversed_user)
    assert reversed["ok"] is True
    assert len(reversed["state"]["cards"]) == 2
    questions = {str(card["question"]) for card in reversed["state"]["cards"]}
    assert any("Pergunta" in question for question in questions)
    assert any("Resposta" in question for question in questions)

    # Snapshot real antigo: sem stockKind, o primeiro card básico causava o
    # fallback "basic", mesmo com nome e dois templates do tipo reverso.
    for stock_kind in (None, "basic", "normal"):
        old_reversed_payload = json.loads(json.dumps(reversed_payload))
        if stock_kind is None:
            old_reversed_payload["notetypes"][0].pop("stock_kind")
        else:
            old_reversed_payload["notetypes"][0]["stock_kind"] = stock_kind
        old_user = {"id": "legacy-reversed-missing-stock-" + str(stock_kind)}
        out = app.cards_official_migrate_legacy(old_reversed_payload, old_user)
        assert out["ok"] and len(out["state"]["cards"]) == 2
        assert len(out["card_map"]) == 2 and len(out["note_map"]) == 1
        fronts = {str(card["question"]) for card in out["state"]["cards"]}
        assert any("Pergunta" in front for front in fronts)
        assert any("Resposta" in front for front in fronts)

    # Campos extras devem sobreviver ao reparo sem impedir o par reverso.
    extra_payload = json.loads(json.dumps(reversed_payload))
    extra_payload["notetypes"][0]["stock_kind"] = "basic"
    extra_payload["notetypes"][0]["fields"].append({"name": "Origem"})
    extra_payload["notes"][0]["fields"]["Origem"] = "Anotação preservada"
    extra_user = {"id": "legacy-reversed-extra-field"}
    extra_out = app.cards_official_migrate_legacy(extra_payload, extra_user)
    assert extra_out["ok"] and len(extra_out["state"]["cards"]) == 2
    extra_col = app.cards_uc_for(extra_user).col
    extra_note = extra_col.get_note(int(extra_out["note_map"]["n"]))
    assert extra_note["Origem"] == "Anotação preservada"

    # Tipo customizado incompatível: a validação oficial deve retornar 422
    # (com CORS na API) e restaurar a coleção, em vez de gerar Failed to fetch.
    invalid_user = {"id": "legacy-invalid-custom-notetype-user"}
    invalid_payload = json.loads(json.dumps(reversed_payload))
    invalid_payload["notetypes"][0]["name"] = "Custom duplicated front"
    invalid_payload["notetypes"][0]["stock_kind"] = "basic"
    invalid_payload["notetypes"][0]["fields"].append({"name": "Extra"})
    invalid_payload["notes"][0]["fields"]["Extra"] = "Custom"
    try:
        app.cards_official_migrate_legacy(invalid_payload, invalid_user)
        raise AssertionError("tipo customizado inválido deveria retornar 422")
    except app.HTTPException as exc:
        assert exc.status_code == 422
        assert "NoteType legado incompatível" in str(exc.detail)
    invalid_item = app.cards_uc_for(invalid_user)
    with invalid_item.lock:
        assert invalid_item.col.card_count() == 0
        assert invalid_item.col.note_count() == 0

    # Um NoteType vazio com nome stock e shape antigo não pode impedir
    # o reparo. O modelo original permanece vazio e o Anki cria o par correto.
    for malformed_shape in ("one-template", "extra-field"):
        collision_user = {"id": "legacy-reversed-collision-" + malformed_shape}
        collision_col = app.cards_uc_for(collision_user).col
        existing = collision_col.models.by_name("Basic (and reversed card)")
        if malformed_shape == "one-template":
            collision_col.models.remove_template(existing, existing["tmpls"][1])
        else:
            collision_col.models.add_field(existing, collision_col.models.new_field("Old Extra"))
        collision_col.models.update_dict(existing, skip_checks=False)
        existing_id = int(existing["id"])
        out = app.cards_official_migrate_legacy(
            json.loads(json.dumps(reversed_payload)), collision_user
        )
        assert out["ok"] and len(out["card_map"]) == 2
        assert int(out["notetype_map"]["nt"]) != existing_id
        assert collision_col.models.use_count(collision_col.models.get(existing_id)) == 0
        questions = {str(card["question"]) for card in out["state"]["cards"]}
        assert any("Pergunta" in question for question in questions)
        assert any("Resposta" in question for question in questions)
        note = collision_col.get_note(int(out["note_map"]["n"]))
        assert note["Front"] == "Pergunta" and note["Back"] == "Resposta"

    # Estado legado sem anki_* moderno: due relativo, review, S/D e
    # suspensão são traduzidos para o Card oficial sem recalcular scheduler.
    schedule_user = {"id": "legacy-cards-schedule-user"}
    schedule_payload = {
        "decks": [{"id": "d", "name": "Schedule"}],
        "notetypes": [{
            "id": "nt", "name": "Schedule Basic", "kind": "basic",
            "fields": [{"name": "Front"}, {"name": "Back"}],
            "templates": [{"name": "Card 1", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}<hr id=answer>{{Back}}"}],
        }],
        "notes": [{"id": "n", "notetype_id": "nt", "fields": {"Front": "Q", "Back": "A"}, "tags": []}],
        "cards": [{
            "id": "c", "note_id": "n", "deck_id": "d", "template_idx": 0,
            "phase": "review", "due_offset_days": 4, "interval": 12,
            "ease_factor": 2300, "reps": 9, "lapses": 2, "suspenso": True,
            "s": 8.5, "d": 5.1,
        }],
        "revlog": [],
    }
    scheduled = app.cards_official_migrate_legacy(schedule_payload, schedule_user)
    schedule_item = app.cards_uc_for(schedule_user)
    with schedule_item.lock:
        scard = schedule_item.col.get_card(int(scheduled["card_map"]["c"]))
        assert int(scard.type) == 2
        assert int(scard.queue) == -1
        assert int(scard.due) == int(schedule_item.col.sched.today) + 4
        assert int(scard.ivl) == 12 and int(scard.factor) == 2300
        assert int(scard.reps) == 9 and int(scard.lapses) == 2
        assert scard.memory_state is not None
        assert abs(float(scard.memory_state.stability) - 8.5) < 1e-6
        assert str(scard.custom_data or "") == ""
    assert app._legacy_card_type_queue({"phase": "review", "bury_kind": "user"}) == (2, -3)
    assert app._legacy_card_type_queue({"phase": "review", "bury_kind": "scheduler"}) == (2, -2)

    # Mapeamento ambíguo deve abortar e restaurar fisicamente a Collection.
    rollback_user = {"id": "legacy-cards-rollback-user"}
    bad_payload = {
        "decks": [{"id": "d", "name": "Rollback"}],
        "notetypes": [{
            "id": "nt", "name": "Rollback Basic", "kind": "basic",
            "fields": [{"name": "Front"}, {"name": "Back"}],
            "templates": [{"name": "Card 1", "qfmt": "{{Front}}", "afmt": "{{FrontSide}}<hr id=answer>{{Back}}"}],
        }],
        "notes": [{"id": "n", "notetype_id": "nt", "fields": {"Front": "Q", "Back": "A"}, "tags": []}],
        "cards": [
            {"id": "c1", "note_id": "n", "deck_id": "d", "template_idx": 0, "phase": "new"},
            {"id": "c2", "note_id": "n", "deck_id": "d", "template_idx": 0, "phase": "new"},
        ],
        "revlog": [],
    }
    try:
        app.cards_official_migrate_legacy(bad_payload, rollback_user)
        raise AssertionError("mapeamento duplicado deveria abortar")
    except app.HTTPException as exc:
        assert exc.status_code == 422
    rollback_col = app.cards_uc_for(rollback_user)
    with rollback_col.lock:
        assert rollback_col.col.card_count() == 0
        assert rollback_col.col.note_count() == 0

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
    # A prévia e a importação usam o mesmo parser CSV nativo, inclusive aspas,
    # novas linhas, cabeçalho aparente dentro de um campo e Unicode.
    import json

    class CsvUpload(FakeUpload):
        filename = "cards.tsv"

    csv_user = {"id": "csv-official-user"}
    csv_bytes = '#separator:Tab\n#html:true\n"Frente ç\n#continuação do campo"\t"Resposta <b>oficial</b>"\n'.encode("utf-8")
    meta_out = asyncio.run(app.cards_official_csv_metadata(CsvUpload(csv_bytes), delimiter=None, user=csv_user))
    meta = meta_out["metadata"]
    csv_path = Path(tmp) / "oracle.tsv"
    csv_path.write_bytes(csv_bytes)
    oracle = app.pool.get("csv-native-oracle")
    with oracle.lock:
        native_meta = oracle.col.get_csv_metadata(str(csv_path), None)
        assert meta.get("preview") == app.pb(native_meta).get("preview"), "a ponte deve preservar a prévia nativa"
        oracle.col.import_csv(app.import_export_pb2.ImportCsvRequest(path=str(csv_path), metadata=native_meta))
        oracle_fields = [oracle.col.get_note(nid).fields for nid in oracle.col.find_notes("")]
        oracle_card_count = oracle.col.card_count()
    imported_csv = asyncio.run(app.cards_official_import_csv(CsvUpload(csv_bytes), metadata_json=json.dumps(meta), user=csv_user))
    assert imported_csv["ok"]
    native_csv = app.cards_uc_for(csv_user)
    with native_csv.lock:
        actual_fields = [native_csv.col.get_note(nid).fields for nid in native_csv.col.find_notes("")]
        assert actual_fields == oracle_fields and actual_fields, "a importação deve corresponder ao Anki nativo"
        assert native_csv.col.card_count() == oracle_card_count

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
assert 'id="screen-cards"' in html
assert '<h2 class="page-title">Anki</h2>' in html
assert 'id="screen-anki"' not in html
assert 'data-screen="anki"' not in html
assert 'id="cards-foco-btn"' in html

print("OK: Anki 26.09.3 oficial + UI Cards avançada validados em scheduler, browser, stats, custom study, filtered deck, tipos, IO, mídia e exportação.")
