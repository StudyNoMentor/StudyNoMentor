"""Confronta botão a botão o módulo Cards (gerar.mjs) com o anki==26.09.2 (oficial.py)."""
import json, sys
from collections import Counter, defaultdict
E = json.load(open(sys.argv[1])); O = json.load(open(sys.argv[2]))
KIND = {'learning': 'learning', 'relearning': 'relearning', 'review': 'review'}
tot = Counter(); bad = Counter(); ex = defaultdict(list)
def falha(cat, cfg, msg):
    bad[(cat, cfg)] += 1
    if len(ex[(cat, cfg)]) < 4: ex[(cat, cfg)].append(msg)
for e, o in zip(E, O):
    cfgn = e['config']; fsrs = e['cfg']['algo'] == 'fsrs'; fase = e['card']['phase']
    for g in ('errei', 'dificil', 'bom', 'facil'):
        a, b = e['resp'][g], o[g]
        ctx = f"{fase} step={e['card'].get('learnStep')} el={e['elapsed']} ivl={e['card'].get('intervalo')} {g}"
        tot[('fase', cfgn)] += 1
        if a['phase'] != b['kind']:
            falha('fase', cfgn, f"{ctx}: app={a['phase']} anki={b['kind']}"); continue
        if b['kind'] in ('learning', 'relearning'):
            tot[('passo(segundos)', cfgn)] += 1
            if a['kind'] != 'min' or round(a['val'] * 60) != b['secs']:
                falha('passo(segundos)', cfgn, f"{ctx}: app={a['kind']}:{a['val']} anki={b['secs']}s")
        if b['kind'] == 'review':
            tot[('intervalo(dias)', cfgn)] += 1
            if a['intervalo'] != b['days']:
                falha('intervalo(dias)', cfgn, f"{ctx}: app={a['intervalo']} anki={b['days']}")
        if b['kind'] == 'relearning' and not fsrs:
            tot[('intervalo pos-lapso', cfgn)] += 1
            if a['intervalo'] != b['days']:
                falha('intervalo pos-lapso', cfgn, f"{ctx}: app={a['intervalo']} anki={b['days']}")
        if b['kind'] in ('review', 'relearning') and not fsrs:
            tot[('facilidade', cfgn)] += 1
            if abs(a['ease'] - b['ease']) > 1e-6:
                falha('facilidade', cfgn, f"{ctx}: app={a.get('ease')} anki={b['ease']}")
        if b['kind'] in ('review', 'relearning'):
            tot[('lapsos', cfgn)] += 1
            if a['lapses'] != b['lapses']:
                falha('lapsos', cfgn, f"{ctx}: app={a.get('lapses')} anki={b['lapses']}")
            tot[('sanguessuga', cfgn)] += 1
            if a['leech'] != b['leeched']:
                falha('sanguessuga', cfgn, f"{ctx}: app={a['leech']} anki={b['leeched']}")
        if fsrs and 's' in b:
            tot[('memoria S/D', cfgn)] += 1
            # O Cards grava como o Anki grava: S com 4 casas e D com 3.
            if a['s'] is None or abs(a['s'] - round(b['s'], 4)) > max(1.1e-4, 2e-6 * b['s']) or abs(a['d'] - round(b['d'], 3)) > 1.1e-3:
                falha('memoria S/D', cfgn, f"{ctx}: app S={a['s']} D={a['d']} anki S={b['s']:.6f} D={b['d']:.6f}")
cats = sorted(set(k[0] for k in tot)); cfgs = sorted(set(k[1] for k in tot))
print('%-18s' % 'categoria', ' '.join('%18s' % c for c in cfgs))
for cat in cats:
    print('%-18s' % cat, ' '.join('%18s' % (f"{tot[(cat,c)]-bad[(cat,c)]}/{tot[(cat,c)]}" if tot[(cat,c)] else '-') for c in cfgs))
print('\nTOTAL', sum(tot.values()) - sum(bad.values()), '/', sum(tot.values()))
for k, v in ex.items():
    print('\n##', k[0], k[1], bad[k]); [print('  ', x) for x in v]
