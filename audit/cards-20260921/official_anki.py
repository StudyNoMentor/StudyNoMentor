"""Replay sampled real Study states through the official compiled Anki backend.
No reference formulas from Study are used here. Run after simulate.mjs.
Anki's random fuzz is intentionally not replaced by Study's hash.
"""
import json, tempfile, time, math, importlib.metadata
from pathlib import Path
from anki.collection import Collection
from anki.cards import FSRSMemoryState
from anki.config_pb2 import ConfigKey
from google.protobuf.json_format import MessageToDict
folder=Path(__file__).parent
vectors=json.loads((folder/'vectors.json').read_text())
report={'ankiVersion':importlib.metadata.version('anki'),'source':'official PyPI anki wheel, compiled Rust backend','sampledCards':len(vectors),'comparisons':0,'memoryMismatches':0,'phaseMismatches':0,'exactIntervalMismatches':0,'maxRelativeMemoryError':0,'examples':[],'tolerance':1e-5,'limitations':'Independent one-step replay of end-of-year review cards, not lockstep yearly official queue. RNG differs. No cloud/AnkiWeb integration exercised.'}
with tempfile.TemporaryDirectory() as tmp:
 col=Collection(tmp+'/collection.anki2');col.set_config('fsrs',True)
 col._backend.set_config_bool(key=ConfigKey.Bool.LOAD_BALANCER_ENABLED,value=False,undoable=False)
 col._backend.set_config_bool(key=ConfigKey.Bool.FSRS_SHORT_TERM_WITH_STEPS_ENABLED,value=True,undoable=False)
 n=col.new_note(col.models.by_name('Basic'));n['Front']='Audit';col.add_note(n,1);card=n.cards()[0]
 canonical=[]
 stamp=int(time.time())
 for v in vectors:
  c=v['card'];elapsed=v['elapsed']
  card.type=2;card.queue=2;card.ivl=c['intervalo'];card.due=col.sched.today+c['intervalo']-elapsed;card.reps=c['reps'];card.lapses=c.get('lapses',0);card.factor=2500
  card.memory_state=FSRSMemoryState(stability=c['s'],difficulty=c['d']);card.last_review_time=stamp-elapsed*86400;card.desired_retention=.9
  col._backend.update_cards(cards=[card._to_backend_card()],skip_undo_entry=True)
  states=col._backend.get_scheduling_states(card.id)
  loaded=col.get_card(card.id)
  canonical.append({'card':dict(c,s=loaded.memory_state.stability,d=loaded.memory_state.difficulty),'states':MessageToDict(states)})
  for local,official in [('errei','again'),('dificil','hard'),('bom','good'),('facil','easy')]:
   patch=v['patches'][local];normal=getattr(states,official).normal;phase=normal.WhichOneof('kind');state=getattr(normal,phase)
   memory=state.learning.memory_state if phase=='relearning' else state.memory_state
   errs=[abs(memory.stability-patch['s'])/max(1,abs(memory.stability)),abs(memory.difficulty-patch['d'])/max(1,abs(memory.difficulty))]
   report['comparisons']+=1;report['maxRelativeMemoryError']=max(report['maxRelativeMemoryError'],*errs)
   if max(errs)>report['tolerance']:report['memoryMismatches']+=1
   if patch['phase']!=phase:report['phaseMismatches']+=1
   if phase=='review' and state.scheduled_days!=patch['intervalo']:
    report['exactIntervalMismatches']+=1
    if len(report['examples'])<8:report['examples'].append({'card':c['id'],'grade':local,'studyInterval':patch['intervalo'],'ankiInterval':state.scheduled_days,'note':'Random fuzz generators differ; mismatch alone does not establish wrong memory equations.'})
 col.close()
 (folder/'canonical-vectors.json').write_text(json.dumps(canonical))
(folder/'official-anki.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
