"""Histórico realista numa coleção do anki==26.09.2 e os parâmetros FSRS que o
próprio Anki calcula (compute_fsrs_params, o botão "Otimizar")."""
import json, sys, random, tempfile, time, math
from anki.collection import Collection
N = int(sys.argv[2]) if len(sys.argv) > 2 else 400
HC = len(sys.argv) > 3 and sys.argv[3] == 'saude'
col = Collection(tempfile.mkdtemp() + '/o.anki2'); col.set_config('fsrs', True)
rnd = random.Random(11)
cut = col.sched.day_cutoff                   # próxima virada (s)
inicio = cut - 200 * 86400
rows = []; rid = inicio * 1000
cards = []
for i in range(N):
    n = col.new_note(col.models.by_name('Basic')); n['Front'] = f'q{i}'; col.add_note(n, 1); cid = n.cards()[0].id
    cards.append(cid)
    t = inicio + rnd.randint(0, 120) * 86400 + rnd.randint(3600 * 5, 3600 * 20)
    ivl = 0; S = 1.0
    # aprendizado: 1 a 3 respostas no mesmo dia
    for k in range(rnd.randint(1, 3)):
        g = rnd.choice([1, 3, 3, 3, 4]) if k == 0 else rnd.choice([3, 3, 4])
        rows.append((t * 1000 + rnd.randint(0, 999), cid, g, -600 if k < 2 else 1, 0, 0, 5000, 0)); t += rnd.randint(60, 900)
    ivl = 1
    while True:
        t += ivl * 86400 + rnd.randint(-3 * 3600, 3 * 3600)
        if t > cut - 3600: break
        p = math.exp(-ivl / (S * 4))
        g = 1 if rnd.random() > max(0.55, p) else rnd.choice([2, 3, 3, 3, 3, 4])
        if g == 1:
            rows.append((t * 1000 + rnd.randint(0, 999), cid, 1, -600, ivl, 2500, 7000, 1))
            t2 = t + 600
            rows.append((t2 * 1000 + rnd.randint(0, 999), cid, 3, 1, -600, 2500, 6000, 2))
            ivl = 1; S = max(0.5, S * 0.5)
        else:
            S *= {2: 1.4, 3: 2.3, 4: 3.2}[g]; nivl = max(1, round(ivl * {2: 1.2, 3: 2.4, 4: 3.3}[g]))
            rows.append((t * 1000 + rnd.randint(0, 999), cid, g, nivl, ivl, 2500, 8000, 1)); ivl = nivl
rows.sort()
vistos = set(); limpo = []
for r in rows:
    rid = r[0]
    while rid in vistos: rid += 1
    vistos.add(rid); limpo.append((rid,) + r[1:])
col.db.executemany('insert into revlog (id,cid,usn,ease,ivl,lastIvl,factor,time,type) values (?,?,-1,?,?,?,?,?,?)', limpo)
t = time.time()
out = col._backend.compute_fsrs_params(search='', current_params=[], ignore_revlogs_before_ms=0, num_of_relearning_steps=1, health_check=HC)
dt = time.time() - t
ev = col._backend.evaluate_params(search='', ignore_revlogs_before_ms=0, num_of_relearning_steps=1)
json.dump(dict(avaliacao=dict(log_loss=ev.log_loss, rmse_bins=ev.rmse_bins), nextDayAt=cut, cards=cards, revlog=limpo, params=list(out.params), fsrs_items=out.fsrs_items,
               health=(out.health_check_passed if out.HasField('health_check_passed') else None), segundos=dt), open(sys.argv[1], 'w'))
print('revlog', len(limpo), 'itens', out.fsrs_items, 'segundos %.2f' % dt, 'saude', out.health_check_passed if HC else '-')
print(','.join('%.4f' % x for x in out.params))
