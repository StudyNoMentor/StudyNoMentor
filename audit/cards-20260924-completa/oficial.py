"""Aplica cada estado gerado por gerar.mjs no anki==26.09.2 e registra os 4 botões."""
import json, sys, tempfile, time
from anki.collection import Collection
from anki.cards import FSRSMemoryState
from anki.config_pb2 import ConfigKey

estados = json.load(open(sys.argv[1]))
NOMES = [('errei', 'again'), ('dificil', 'hard'), ('bom', 'good'), ('facil', 'easy')]
cols = {}
tmp = tempfile.mkdtemp()

def colecao(nome, cfg):
    if nome in cols: return cols[nome]
    col = Collection(f'{tmp}/{nome}.anki2')
    col.set_config('fsrs', cfg['algo'] == 'fsrs')
    col._backend.set_config_bool(key=ConfigKey.Bool.LOAD_BALANCER_ENABLED, value=bool(cfg.get('loadBalance')), undoable=False)
    conf = col.decks.get_config(1)
    conf['new']['delays'] = [float(x) for x in cfg['learnSteps']]
    conf['lapse']['delays'] = [float(x) for x in cfg['relearnSteps']]
    conf['desiredRetention'] = cfg['retention']
    conf['rev']['maxIvl'] = cfg['maxInterval']
    conf['new']['initialFactor'] = int(round(cfg['initialEase'] * 1000))
    conf['new']['ints'] = [cfg['graduatingIntervalGood'], cfg['graduatingIntervalEasy'], 0]
    conf['rev']['hardFactor'] = cfg['hardMultiplier']
    conf['rev']['ease4'] = cfg['easyMultiplier']
    conf['rev']['ivlFct'] = cfg['intervalMultiplier']
    conf['lapse']['mult'] = cfg['lapseMultiplier']
    conf['lapse']['minInt'] = cfg['minimumLapseInterval']
    conf['lapse']['leechFails'] = cfg['leechThreshold']
    conf['lapse']['leechAction'] = 1
    conf['rev']['bury'] = bool(cfg.get('buryReviews'))
    ed = cfg.get('easyDays') or [1] * 7
    conf['easyDaysPercentages'] = [ed[1], ed[2], ed[3], ed[4], ed[5], ed[6], ed[0]]
    col.decks.update_config(conf)
    for f in (cfg.get('fundo') or []):
        n = col.new_note(col.models.by_name('Basic')); n['Front'] = 'fundo' + f['id']; col.add_note(n, 1)
        cid = n.cards()[0].id
        col.db.execute('update cards set id=? where id=?', f['ankiId'], cid)
        fc = col.get_card(f['ankiId'])
        fc.type = 1 if f['phase'] == 'learning' else 2
        fc.queue = -1 if f['suspenso'] else (3 if f['phase'] == 'learning' else 2)
        fc.ivl = f['intervalo']; fc.reps = f['reps']; fc.due = col.sched.today + f['offset']
        col._backend.update_cards(cards=[fc._to_backend_card()], skip_undo_entry=True)
    cols[nome] = col
    return col

saida = []
agora = int(time.time())
for e in estados:
    cfg, c = e['cfg'], e['card']
    col = colecao(e['config'], cfg)
    irm = c.get('irmao')
    n = col.new_note(col.models.by_name('Basic (and reversed card)' if irm else 'Basic')); n['Front'] = str(c['ankiId']); n['Back'] = 'x'; col.add_note(n, 1)
    cs = n.cards(); old = cs[0].id
    col.db.execute('update cards set id=? where id=?', c['ankiId'], old)
    if irm:
        col.db.execute('update cards set id=? where id=?', irm['ankiId'], cs[1].id)
        ic = col.get_card(irm['ankiId'])
        ic.type = 2; ic.queue = 2; ic.ivl = irm['intervalo']; ic.reps = irm['reps']; ic.due = col.sched.today + irm['offset']
        col._backend.update_cards(cards=[ic._to_backend_card()], skip_undo_entry=True)
    card = col.get_card(c['ankiId'])
    fase = c['phase']; fsrs = cfg['algo'] == 'fsrs'; el = e['elapsed']
    steps = cfg['relearnSteps'] if fase == 'relearning' else cfg['learnSteps']
    if fase != 'new':
        card.type = {'learning': 1, 'review': 2, 'relearning': 3}[fase]
        card.queue = 2 if fase == 'review' else 1
        card.reps = c['reps']; card.lapses = c['lapses']
        card.factor = int(round(c['ease'] * 1000))
        card.ivl = c.get('intervalo') or 0
        if fase == 'review':
            card.due = col.sched.today - el + card.ivl
        else:
            card.due = agora - 1
            card.left = len(steps) - c['learnStep']
        if fsrs:
            card.memory_state = FSRSMemoryState(stability=c['s'], difficulty=c['d'])
            card.desired_retention = cfg['retention']
        card.last_review_time = agora - (el * 86400 if el else 60)
        col._backend.update_cards(cards=[card._to_backend_card()], skip_undo_entry=True)
    if cfg.get('filtrado') and fase != 'new':
        # Baralho filtrado real, com reagendamento, contendo só este card.
        fd = col.sched.get_or_create_filtered_deck(deck_id=0)
        fd.name = f"F{c['ankiId']}"
        fd.config.reschedule = True
        del fd.config.search_terms[1:]
        fd.config.search_terms[0].search = f"cid:{c['ankiId']}"
        fd.config.search_terms[0].limit = 10
        fdid = col.sched.add_or_update_filtered_deck(fd).id
        card = col.get_card(card.id)
        assert card.odid, 'card não entrou no filtrado'
    if cfg.get('loadBalance'):
        # O LoadBalancer do Anki vive na fila montada (queue/builder): sem ela, não há balanceamento.
        col.sched.get_queued_cards(fetch_limit=1)
    st = col._backend.get_scheduling_states(card.id)
    r = {}
    for local, of in NOMES:
        est = getattr(st, of)
        if est.WhichOneof('kind') == 'filtered':      # filtrado com reagendamento: estado normal embrulhado
            s = est.filtered.rescheduling.original_state
        else:
            s = est.normal
        k = s.WhichOneof('kind'); o = getattr(s, k)
        item = {'kind': k}
        if k == 'review':
            item.update(days=o.scheduled_days, ease=o.ease_factor, lapses=o.lapses, leeched=o.leeched)
            m = o.memory_state if o.HasField('memory_state') else None
        elif k == 'relearning':
            item.update(secs=o.learning.scheduled_secs, remaining=o.learning.remaining_steps, days=o.review.scheduled_days,
                        ease=o.review.ease_factor, lapses=o.review.lapses, leeched=o.review.leeched)
            m = o.learning.memory_state if o.learning.HasField('memory_state') else None
        else:
            item.update(secs=o.scheduled_secs, remaining=o.remaining_steps)
            m = o.memory_state if o.HasField('memory_state') else None
        if m is not None: item.update(s=m.stability, d=m.difficulty)
        r[local] = item
    saida.append(r)
    # O card de teste não pode entrar na carga dos estados seguintes.
    col.remove_notes([card.nid])
    if cfg.get('filtrado') and fase != 'new':
        col.decks.remove([fdid])
json.dump(saida, open(sys.argv[2], 'w'))
print('oráculo:', len(saida))
