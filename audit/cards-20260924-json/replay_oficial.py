"""Replay lockstep do rawReviewLog no Anki oficial 26.09.2.
Cada card começa novo; cada resposta do log é aplicada no estado OFICIAL anterior,
com os dias decorridos reais (fuso America/Fortaleza, virada às 4h)."""
import json, sys, time, datetime, tempfile, math
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer
from anki.cards import FSRSMemoryState

F = sys.argv[1]
d = json.load(open(F))
TZ = datetime.timezone(datetime.timedelta(hours=-3))
def anki_day(ts):  # dia de estudo: hora local - 4h
    return (datetime.datetime.fromtimestamp(ts/1000, TZ) - datetime.timedelta(hours=4)).date()

R = {1: CardAnswer.AGAIN, 2: CardAnswer.HARD, 3: CardAnswer.GOOD, 4: CardAnswer.EASY}
NAME = {1: 'again', 2: 'hard', 3: 'good', 4: 'easy'}
log = sorted(d['rawReviewLog'], key=lambda r: r['ts'])
byc = {}
for r in log: byc.setdefault(r['cardId'], []).append(r)
cards = {c['id']: c for c in d['cards'].values()}

tmp = tempfile.mkdtemp()
col = Collection(tmp + '/c.anki2')
col.set_config('fsrs', True)
model = col.models.by_name('Basic')
out = []
for cid, revs in byc.items():
    n = col.new_note(model); n['Front'] = cid; col.add_note(n, 1)
    card = n.cards()[0]
    steps = []
    prev_ts = None
    for i, r in enumerate(revs):
        card = col.get_card(card.id)
        now = int(time.time())
        if prev_ts is not None:
            days = (anki_day(r['ts']) - anki_day(prev_ts)).days
            secs = (r['ts'] - prev_ts) // 1000
            if days == 0:
                lrt = now - min(secs, 60)
            else:
                lrt = now - days * 86400
            card.last_review_time = lrt
            if card.type == 2 and card.queue == 2:
                card.due = col.sched.today + card.ivl - days
            elif card.queue in (1, 3):
                if card.queue == 1: card.due = now - 1
                else: card.due = col.sched.today
            col._backend.update_cards(cards=[card._to_backend_card()], skip_undo_entry=True)
            card = col.get_card(card.id)
        pre = dict(type=card.type, queue=card.queue, ivl=card.ivl, left=card.left,
                   s=card.memory_state.stability if card.memory_state else None,
                   d=card.memory_state.difficulty if card.memory_state else None)
        states = col._backend.get_scheduling_states(card.id)
        st = getattr(states, NAME[r['grade']]).normal
        kind = st.WhichOneof('kind')
        o = getattr(st, kind)
        if kind == 'review': sched = ('days', o.scheduled_days)
        elif kind == 'relearning': sched = ('secs', o.learning.scheduled_secs)
        elif kind == 'learning': sched = ('secs', o.scheduled_secs)
        else: sched = (kind, None)
        # intervalos dos 4 botões (para faixas)
        allb = {}
        for g in (1,2,3,4):
            s2 = getattr(states, NAME[g]).normal; k2 = s2.WhichOneof('kind'); o2 = getattr(s2, k2)
            allb[g] = (k2, o2.scheduled_days if k2=='review' else (o2.learning.scheduled_secs if k2=='relearning' else getattr(o2,'scheduled_secs',None)))
        card.start_timer()
        ans = col.sched.build_answer(card=card, states=states, rating=R[r['grade']])
        col.sched.answer_card(ans)
        c2 = col.get_card(card.id)
        post = dict(type=c2.type, queue=c2.queue, ivl=c2.ivl, left=c2.left, lapses=c2.lapses, reps=c2.reps,
                    s=c2.memory_state.stability if c2.memory_state else None,
                    d=c2.memory_state.difficulty if c2.memory_state else None)
        steps.append(dict(i=i, ts=r['ts'], day=str(anki_day(r['ts'])), grade=r['grade'], appPhaseBefore=r['phase'],
                          appIntervalBefore=r['intervalo'], appAnkiInterval=r.get('ankiInterval'),
                          appS_before=r['s'], appD_before=r['d'], legacy=r['reviewId'].startswith('legacy'),
                          anki_pre=pre, anki_kind=kind, anki_sched=sched, anki_post=post, anki_buttons=allb))
        prev_ts = r['ts']
    out.append(dict(cardId=cid, app=cards.get(cid), steps=steps))
json.dump(out, open(sys.argv[2], 'w'), indent=1, default=str)
print('ok', len(out), sum(len(x['steps']) for x in out))
