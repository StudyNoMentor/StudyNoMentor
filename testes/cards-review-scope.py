"""Exercise planning scope against a real upstream collection, including shared decks."""
import os
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'anki_official_backend'))
with tempfile.TemporaryDirectory() as tmp:
    os.environ['ANKI_DATA_DIR'] = tmp
    import app
    user = {'id': 'scope-regression'}
    item = app.cards_uc_for(user)
    col = item.col
    ids = []
    for text in ['Other plan', 'Current plan', 'Shared replica']:
        note = col.new_note(col.models.current())
        note['Front'] = text
        note['Back'] = 'Answer'
        col.add_note(note, col.decks.get_current_id())
        ids.extend(col.card_ids_of_note(note.id))
    full = app.cards_official_reviewer_scope(app.CardsReviewScopeBody(deck_id=0, card_ids=ids), user)
    assert full['review_scope']['total_cards'] == 3
    scoped = app.cards_official_reviewer_scope(app.CardsReviewScopeBody(deck_id=0, card_ids=ids[1:], label='Current plan'), user)
    assert scoped['review_scope']['total_cards'] == 2
    assert scoped['counts']['new'] == 2
    assert ids[0] not in scoped['queue_ids']
    assert scoped['card']['id'] == ids[1]
    assert scoped['review_scope']['inventory']['new'] == 2
    out = app.cards_official_reviewer_answer(app.AnswerBody(card_id=ids[1], rating=3), user)
    assert col.get_card(ids[1]).reps == 1
    assert col.get_card(ids[0]).reps == 0
    col.undo()
    assert col.get_card(ids[1]).reps == 0
    col.redo()
    assert col.get_card(ids[1]).reps == 1
    assert ids[0] not in out['reviewer']['queue_ids']
    empty = app.cards_official_reviewer_scope(app.CardsReviewScopeBody(deck_id=0, card_ids=[]), user)
    assert empty['finished'] and not empty['queue_ids']
    assert empty['review_scope']['total_cards'] == 0
    restored = app.cards_official_reviewer_scope(app.CardsReviewScopeBody(deck_id=0, card_ids=ids), user)
    assert restored['review_scope']['total_cards'] == 3
    assert ids[0] in restored['queue_ids']
    # Review a plan whose only card is in a different deck.
    deck = col.decks.add_normal_deck_with_name('Second').id
    col.set_deck([ids[2]], deck)
    other = app.cards_official_reviewer_scope(app.CardsReviewScopeBody(deck_id=0, card_ids=[ids[2]]), user)
    assert other['card']['id'] == ids[2]
    assert other['queue_ids'] == [ids[2]]
    col.close()
print('Planning scopes, shared decks, official answer, empty scope and deck traversal: OK')
