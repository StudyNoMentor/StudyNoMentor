#!/usr/bin/env python3
"""Generate a tiny scheduler/revlog oracle with the installed upstream Anki."""
import json
import os
import tempfile

from google.protobuf.json_format import MessageToDict
from anki.collection import Collection
from anki import deck_config_pb2


def msg_dict(msg):
    return MessageToDict(msg, preserving_proto_field_name=True)


out = os.environ["SNM_ANKI_SCHEDULER_EXPECTED"]
db = tempfile.mktemp(suffix=".anki2")
col = Collection(db)
try:
    did = col.decks.id("Scheduler Oracle")

    # Force exactly the configuration used by the real Study log that exposed
    # the regression: FSRS, 1m/10m learning, 10m relearning, 90% retention.
    cfgs = col.decks.get_deck_configs_for_update(did)
    current_id = int(cfgs.current_deck.config_id)
    selected = None
    for entry in cfgs.all_config:
        if int(entry.config.id) == current_id:
            selected = entry.config
            break
    assert selected is not None
    selected.config.learn_steps[:] = [1.0, 10.0]
    selected.config.relearn_steps[:] = [10.0]
    selected.config.desired_retention = 0.9

    req = deck_config_pb2.UpdateDeckConfigsRequest()
    req.target_deck_id = int(did)
    req.configs.add().CopyFrom(selected)
    req.fsrs = True
    req.new_cards_ignore_review_limit = cfgs.new_cards_ignore_review_limit
    req.apply_all_parent_limits = cfgs.apply_all_parent_limits
    col.decks.update_deck_configs(req)

    model = col.models.by_name("Basic")
    assert model
    note = col.new_note(model)
    note["Front"] = "real-log-regression"
    note["Back"] = "oracle"
    col.add_note(note, did)
    cid = int(col.find_cards("real-log-regression")[0])
    card = col.get_card(cid)

    # Exact sequence from the corrupted real log: New/Again, then Good on the
    # learning card. The Study must never see the second answer as New again.
    card.start_timer()
    col.sched.answerCard(card, 1)
    card = col.get_card(cid)
    after_again = {
        "reps": int(card.reps),
        "lapses": int(card.lapses),
        "ivl": int(card.ivl),
        "state": msg_dict(col._backend.get_scheduling_states(card.id).current),
    }

    card.start_timer()
    col.sched.answerCard(card, 3)
    card = col.get_card(cid)
    after_good = {
        "reps": int(card.reps),
        "lapses": int(card.lapses),
        "ivl": int(card.ivl),
        "state": msg_dict(col._backend.get_scheduling_states(card.id).current),
    }

    rows = col.db.all(
        "select ease, ivl, lastIvl, factor, time, type from revlog where cid=? order by id",
        cid,
    )
    assert len(rows) == 2, rows
    revlog = [
        {
            "ease": int(r[0]),
            "ivl": int(r[1]),
            "lastIvl": int(r[2]),
            "factor": int(r[3]),
            "time": int(r[4]),
            "type": int(r[5]),
        }
        for r in rows
    ]

    payload = {
        "anki_version": "26.09.3",
        "card_id": cid,
        "sequence": ["again", "good"],
        "after_again": after_again,
        "after_good": after_good,
        "revlog": revlog,
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
finally:
    col.close()
    if os.path.exists(db):
        os.unlink(db)

print("ANKI OFICIAL 26.09.3: oracle scheduler/revlog gerado.")
