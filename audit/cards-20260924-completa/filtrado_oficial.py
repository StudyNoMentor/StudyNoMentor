"""Baralhos filtrados no anki==26.09.2: busca, ordem, limite e 2 termos."""
import json, sys, random, tempfile, time
from anki.collection import Collection
from anki.cards import FSRSMemoryState
CEN = [  # (nome, [(busca, limite, ordem)])
  ('tudo_intervalo_asc', [('', 25, 2)]), ('tudo_intervalo_desc', [('', 25, 3)]), ('lapsos', [('', 20, 4)]),
  ('adicionados', [('', 30, 5)]), ('vencimento', [('', 40, 6)]), ('adicionados_rev', [('', 30, 7)]),
  ('retencao_asc', [('-is:new', 20, 8)]), ('retencao_desc', [('', 25, 9)]), ('sobreatraso', [('', 25, 10)]),
  ('mais_antigo_revisado', [('', 20, 0)]), ('vencidos', [('is:due', 100, 6)]), ('novos', [('is:new', 12, 5)]),
  ('ivl_maior_10', [('prop:ivl>=10', 50, 2)]), ('dois_termos', [('is:due', 10, 3), ('is:new', 8, 7)]),
  ('dois_termos_sobrepostos', [('', 10, 2), ('-is:new', 10, 2)]),
]
agora = int(time.time()); out = {}
for nome, termos in CEN:
    rnd = random.Random(21)
    caminho = tempfile.mkdtemp() + '/f.anki2'; col = Collection(caminho)
    # Coleção "antiga" (hoje = dia ~1000), como a de um usuário real: com hoje=0
    # os vencidos teriam due <= 0 e o Anki não lhes daria posição no filtrado.
    col.db.execute('update col set crt = crt - 1000 * 86400'); col.close(); col = Collection(caminho)
    col.set_config('fsrs', True)
    basic, rev = col.models.by_name('Basic'), col.models.by_name('Basic (and reversed card)')
    cards = []
    for i in range(50):
        n = col.new_note(rev if i % 4 == 0 else basic); n['Front'] = f'q{i}'; n['Back'] = 'a'; col.add_note(n, 1); cards += n.cards()
    today = col.sched.today; revlog = []
    for k, c in enumerate(cards):
        t = k % 5
        if t in (0, 1):
            c.type = 0; c.queue = 0; c.due = rnd.randint(1, 300)
        elif t == 4 and k % 10 == 4:
            c.type = 1; c.queue = 1; c.due = agora + rnd.randint(-600, 1800); c.left = 1; c.reps = 1
            c.memory_state = FSRSMemoryState(stability=0.5, difficulty=5.0); c.last_review_time = agora - 600; c.desired_retention = 0.9
        else:
            ivl = rnd.randint(1, 60); c.type = 2; c.queue = 2; c.ivl = ivl; c.due = today + rnd.randint(-10, 20); c.reps = rnd.randint(1, 12)
            c.lapses = rnd.randint(0, 4); c.factor = 2500
            c.memory_state = FSRSMemoryState(stability=round(rnd.uniform(0.5, 90), 4), difficulty=round(rnd.uniform(1, 10), 3))
            c.last_review_time = agora - (ivl - (c.due - today)) * 86400 - rnd.randint(0, 80000); c.desired_retention = 0.9
            revlog.append((c.last_review_time * 1000 + k, c.id))
        col._backend.update_cards(cards=[c._to_backend_card()], skip_undo_entry=True)
    col.db.executemany('insert into revlog (id,cid,usn,ease,ivl,lastIvl,factor,time,type) values (?,?,-1,3,1,1,2500,5000,1)', revlog)
    lista = []
    for c in cards:
        c = col.get_card(c.id)
        lista.append(dict(id=c.id, nid=c.nid, ord=c.ord, mod=c.mod, queue=c.queue, due=c.due, ivl=c.ivl, reps=c.reps, lapses=c.lapses,
                          s=c.memory_state.stability if c.memory_state else None, d=c.memory_state.difficulty if c.memory_state else None,
                          lastReview=c.last_review_time))
    fd = col.sched.get_or_create_filtered_deck(deck_id=0); fd.name = 'F'; fd.config.reschedule = True
    del fd.config.search_terms[:]
    for busca, lim, ordem in termos:
        t = fd.config.search_terms.add(); t.search = busca; t.limit = lim; t.order = ordem
    fdid = col.sched.add_or_update_filtered_deck(fd).id
    # Aprendizado intradiário mantém o vencimento em segundos no filtrado; os
    # demais recebem a posição -100000+i. A ordem comparável é a dos demais.
    sel = col.db.list('select id from cards where did=? and queue != 1 order by due', fdid)
    sel_aprend = col.db.list('select id from cards where did=? and queue = 1', fdid)
    out[nome] = dict(termos=termos, today=today, agora=agora, cards=lista, revlog=revlog, selecionados=sel, aprendizado=sel_aprend)
    col.close()
json.dump(out, open(sys.argv[1], 'w')); print('cenários', len(out))
