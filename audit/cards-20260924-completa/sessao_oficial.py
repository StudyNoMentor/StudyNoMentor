"""Sessão real no anki==26.09.2: responde a fila com o relógio de verdade e
registra a ordem de apresentação e o instante de cada resposta."""
import json, sys, time, random
from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer
from anki.cards import FSRSMemoryState
import tempfile
R = {1: CardAnswer.AGAIN, 2: CardAnswer.HARD, 3: CardAnswer.GOOD, 4: CardAnswer.EASY}
SEM = int(sys.argv[2]) if len(sys.argv) > 2 else 0
AHEAD = int(sys.argv[3]) if len(sys.argv) > 3 else 5
DESFAZER = len(sys.argv) > 4 and sys.argv[4] == 'desfazer'
def nota(cid, reps):
    h = (cid * 2654435761 + reps * 40503 + SEM * 7919) % 100
    return 1 if h < 30 else 2 if h < 40 else 3 if h < 90 else 4
col = Collection(tempfile.mkdtemp() + '/s.anki2'); col.set_config('fsrs', True)
col.set_config('collapseTime', AHEAD)               # "aprender adiantado" em segundos
conf = col.decks.get_config(1)
conf['new']['delays'] = [0.1, 0.2]; conf['lapse']['delays'] = [0.1]   # 6 s, 12 s, 6 s
col.decks.update_config(conf)
rnd = random.Random(3 + SEM); agora = int(time.time()); cards = []
for i in range(10):
    n = col.new_note(col.models.by_name('Basic')); n['Front'] = f'q{i}'; col.add_note(n, 1); c = n.cards()[0]
    if i < 6:
        ivl = rnd.randint(1, 30); c.type = 2; c.queue = 2; c.ivl = ivl; c.due = col.sched.today - rnd.randint(0, 5); c.reps = 5
        c.memory_state = FSRSMemoryState(stability=round(rnd.uniform(1, 30), 4), difficulty=round(rnd.uniform(3, 8), 3))
        c.desired_retention = 0.9; c.last_review_time = agora - ivl * 86400
        col._backend.update_cards(cards=[c._to_backend_card()], skip_undo_entry=True)
cards = [dict(id=c.id, nid=c.nid, ord=c.ord, mod=c.mod, type=c.type, queue=c.queue, due=c.due, ivl=c.ivl, reps=c.reps, factor=c.factor,
              s=c.memory_state.stability if c.memory_state else None, d=c.memory_state.difficulty if c.memory_state else None,
              lastReview=c.last_review_time) for c in (col.get_card(x) for x in col.find_cards(''))]
t0 = time.time(); passos = []
for k in range(45):
    q = col.sched.get_queued_cards(fetch_limit=1)
    if not q.cards:
        time.sleep(1); q = col.sched.get_queued_cards(fetch_limit=1)
        if not q.cards: break
    # Como no app de verdade: o próximo card é buscado LOGO após responder;
    # o estudante leva ~2 s para responder.
    card = col.get_card(q.cards[0].card.id)
    g = nota(card.id, card.reps)
    tb = round(time.time() - t0, 3)
    time.sleep(2)
    card.start_timer()
    st = col._backend.get_scheduling_states(card.id)
    ta = round(time.time() - t0, 3)
    col.sched.answer_card(col.sched.build_answer(card=card, states=st, rating=R[g]))
    desfaz = DESFAZER and (card.id * 31 + card.reps * 7 + k) % 8 == 0
    if desfaz: col.undo()
    passos.append(dict(t=tb, ta=ta, id=card.id, grade=g, desfez=desfaz))
g = col._backend.graphs(search='', days=365)
tr_ = g.true_retention
estat = dict(
    today=dict(answerCount=g.today.answer_count, answerMillis=g.today.answer_millis, correctCount=g.today.correct_count,
               matureCount=g.today.mature_count, matureCorrect=g.today.mature_correct, learnCount=g.today.learn_count,
               reviewCount=g.today.review_count, relearnCount=g.today.relearn_count, earlyReviewCount=g.today.early_review_count),
    retencao={k: [getattr(tr_, k).young_passed, getattr(tr_, k).young_failed, getattr(tr_, k).mature_passed, getattr(tr_, k).mature_failed]
              for k in ('today', 'yesterday', 'week', 'month', 'year', 'all_time')},
    contagem={k: getattr(g.card_counts.excluding_inactive, k) for k in ('newCards', 'learn', 'relearn', 'young', 'mature', 'suspended', 'buried')},
    revlog=col.db.all('select id, cid, ease, ivl, lastIvl, factor, type from revlog order by id'))
json.dump(dict(estat=estat, ahead=AHEAD, today=col.sched.today, t0=t0, cards=cards, passos=passos), open(sys.argv[1], 'w'))
print('respostas:', len(passos))
