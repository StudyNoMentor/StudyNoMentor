"""Monta no anki==26.09.2 coleções com cards em todos os estados e registra a
fila do dia (get_queued_cards) para cada combinação de opções de fila."""
import json, sys, random, tempfile, time
from anki.collection import Collection
from anki.cards import FSRSMemoryState
from anki import deck_config_pb2 as dpb
C = dpb.DeckConfig.Config
CEN = {
  'padrao': {},
  'limites_baixos': {'newPerDay': 5, 'revPerDay': 10},
  'novos_depois_interday_antes': {'newMix': 'depois', 'interdayMix': 'antes'},
  'novos_antes': {'newMix': 'antes'},
  'retrievability_asc': {'reviewOrder': 'retrievabilityAsc'},
  'retrievability_desc': {'reviewOrder': 'retrievabilityDesc'},
  'overdueness': {'reviewOrder': 'relativeOverdueness'},
  'intervalos_asc': {'reviewOrder': 'intervalsAsc'},
  'intervalos_desc': {'reviewOrder': 'intervalsDesc'},
  'ease_asc': {'reviewOrder': 'easeAsc'},
  'aleatoria': {'reviewOrder': 'random'},
  'adicionados': {'reviewOrder': 'added'},
  'adicionados_rev': {'reviewOrder': 'reverseAdded'},
  'coleta_aleatoria_cards': {'newGatherOrder': 'randomCards', 'newSortOrder': 'randomCard'},
  'coleta_aleatoria_notas': {'newGatherOrder': 'randomNotes', 'newSortOrder': 'randomNoteTemplate'},
  'coleta_posicao_desc': {'newGatherOrder': 'posicaoDesc', 'newSortOrder': 'templateRandom'},
  'coleta_deck_notas': {'newGatherOrder': 'deckRandomNotes', 'newSortOrder': 'coleta'},
  'coleta_posicao': {'newGatherOrder': 'posicao', 'newSortOrder': 'template'},
  'novos_ignoram_limite': {'revPerDay': 10, 'newCardsIgnoreReviewLimit': True},
}
RO = {'day': 0, 'intervalsAsc': 3, 'intervalsDesc': 4, 'easeAsc': 5, 'easeDesc': 6, 'retrievabilityAsc': 7,
      'random': 8, 'added': 9, 'reverseAdded': 10, 'retrievabilityDesc': 11, 'relativeOverdueness': 12}
MIX = {'misturar': 0, 'depois': 1, 'antes': 2}
GA = {'deck': 0, 'posicao': 1, 'posicaoDesc': 2, 'randomNotes': 3, 'randomCards': 4, 'deckRandomNotes': 5}
SO = {'template': 0, 'coleta': 1, 'templateRandom': 2, 'randomNoteTemplate': 3, 'randomCard': 4}
tmp = tempfile.mkdtemp(); out = {}
agora = int(time.time())
for nome, op in CEN.items():
    rnd = random.Random(7)
    col = Collection(f'{tmp}/{nome}.anki2'); col.set_config('fsrs', True)
    if op.get('newCardsIgnoreReviewLimit'): col.set_config('newCardsIgnoreReviewLimit', True)
    conf = col.decks.get_config(1)
    conf['new']['perDay'] = op.get('newPerDay', 20); conf['rev']['perDay'] = op.get('revPerDay', 200)
    conf['reviewOrder'] = RO[op.get('reviewOrder', 'day')]
    conf['newMix'] = MIX[op.get('newMix', 'misturar')]; conf['interdayLearningMix'] = MIX[op.get('interdayMix', 'misturar')]
    conf['newGatherPriority'] = GA[op.get('newGatherOrder', 'deck')]; conf['newSortOrder'] = SO[op.get('newSortOrder', 'template')]
    col.decks.update_config(conf)
    basic, rev = col.models.by_name('Basic'), col.models.by_name('Basic (and reversed card)')
    notas = []
    for i in range(70):
        n = col.new_note(rev if i % 3 == 0 else basic); n['Front'] = f'q{i}'; n['Back'] = f'a{i}'; col.add_note(n, 1); notas.append(n)
    cards = [c for n in notas for c in n.cards()]
    rnd.shuffle(cards)
    tipos = ['new'] * 40 + ['review'] * 45 + ['daylearn'] * 5 + ['learn'] * 4
    today = col.sched.today
    posicoes = list(range(1, 200)); rnd.shuffle(posicoes)
    for k, c in enumerate(cards):
        t = tipos[k] if k < len(tipos) else 'new'
        if t == 'new':
            c.type = 0; c.queue = 0; c.due = posicoes[k]
        elif t == 'review':
            ivl = rnd.randint(1, 120); atraso = rnd.randint(0, 15)
            c.type = 2; c.queue = 2; c.ivl = ivl; c.due = today - atraso; c.reps = rnd.randint(1, 20)
            c.factor = rnd.randint(1300, 3000)
            c.memory_state = FSRSMemoryState(stability=round(rnd.uniform(0.5, 200), 4), difficulty=round(rnd.uniform(1, 10), 3))
            c.last_review_time = agora - (ivl + atraso) * 86400
            c.desired_retention = 0.9   # o Anki grava a retenção desejada a cada revisão FSRS
        elif t == 'daylearn':
            c.type = 1; c.queue = 3; c.due = today - rnd.randint(0, 3); c.left = 1; c.reps = 2
            c.memory_state = FSRSMemoryState(stability=1.0, difficulty=5.0); c.last_review_time = agora - 2 * 86400; c.desired_retention = 0.9
        else:
            c.type = 1; c.queue = 1; c.due = agora - rnd.randint(30, 3000); c.left = 1; c.reps = 1
            c.memory_state = FSRSMemoryState(stability=0.5, difficulty=5.0); c.last_review_time = agora - 3600
        col._backend.update_cards(cards=[c._to_backend_card()], skip_undo_entry=True)
    lista = []
    for c in cards:
        c = col.get_card(c.id)
        lista.append(dict(id=c.id, nid=c.nid, ord=c.ord, mod=c.mod, type=c.type, queue=c.queue, due=c.due, ivl=c.ivl,
                          reps=c.reps, factor=c.factor, left=c.left,
                          s=c.memory_state.stability if c.memory_state else None,
                          d=c.memory_state.difficulty if c.memory_state else None,
                          lastReview=c.last_review_time))
    q = col.sched.get_queued_cards(fetch_limit=1000)
    out[nome] = dict(op=op, today=today, cards=lista, fila=[x.card.id for x in q.cards],
                     contagens=[q.new_count, q.learning_count, q.review_count])
    col.close()
json.dump(out, open(sys.argv[1], 'w'))
print('cenários:', len(out))
