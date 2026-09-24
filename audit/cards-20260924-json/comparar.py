import json, sys
X = json.load(open(sys.argv[1]))
PH = {0:'new',1:'learning',2:'review',3:'relearning'}
def frange(ivl):
    if ivl < 2.5: return (round(ivl), round(ivl))
    delta = 1.0
    for lo, hi, f in ((2.5,7,0.15),(7,20,0.1),(20,1e9,0.05)):
        delta += f * max(min(ivl,hi)-lo, 0)
    return (max(2, round(ivl-delta)), round(ivl+delta))
rows=[]; sd_bad=[]; ph_bad=[]; iv_bad=[]; maxdS=0; maxdD=0
for c in X:
    st=c['steps']; app=c['app']
    for k,s in enumerate(st):
        if k+1<len(st):
            aS,aD,aPh=st[k+1]['appS_before'],st[k+1]['appD_before'],st[k+1]['appPhaseBefore']
        else:
            aS,aD,aPh=app['s'],app['d'],app['phase']
        oS,oD=s['anki_post']['s'],s['anki_post']['d']; oPh=PH[s['anki_post']['type']]
        if aS is not None and oS is not None:
            dS=abs(aS-oS)/max(oS,1e-9); dD=abs(aD-oD)
            maxdS=max(maxdS,dS); maxdD=max(maxdD,dD)
            if dS>1e-3 or dD>1e-3: sd_bad.append((c['cardId'][:8],k,s['day'],s['grade'],s['appPhaseBefore'],'app',round(aS,4),round(aD,4),'anki',round(oS,4),round(oD,4),'legacy' if s['legacy'] else 'r'))
        else:
            sd_bad.append((c['cardId'][:8],k,'S/D ausente','app',aS,aD,'anki',oS,oD))
        if aPh!=oPh: ph_bad.append((c['cardId'][:8],k,s['day'],s['grade'],'app',aPh,'anki',oPh))
        if s['anki_kind']=='review' and s['appAnkiInterval'] is not None:
            o=s['anki_sched'][1]; a=s['appAnkiInterval']
            lo,hi=frange(oS) if oS else (o,o)
            if a!=o: iv_bad.append((c['cardId'][:8],k,s['day'],'g',s['grade'],'app',a,'anki',o,'S',round(oS,3),'faixa',(lo,hi),'dentro' if lo<=a<=hi else 'FORA'))
    # final
    last=st[-1]['anki_post']
    if app['intervalo']!=last['ivl'] or app['lapses']!=last['lapses'] or app['reps']!=last['reps']:
        rows.append((c['cardId'][:8],'app ivl/lapses/reps',app['intervalo'],app['lapses'],app['reps'],'anki',last['ivl'],last['lapses'],last['reps'],'due',app['due'],'lastRev',app['lastReview']))
print('max rel dS',maxdS,'max dD',maxdD)
print('\nS/D divergentes:',len(sd_bad)); [print(x) for x in sd_bad]
print('\nFase divergente:',len(ph_bad)); [print(x) for x in ph_bad]
print('\nIntervalo divergente:',len(iv_bad)); [print(x) for x in iv_bad]
print('\nFinal divergente:',len(rows)); [print(x) for x in rows]
