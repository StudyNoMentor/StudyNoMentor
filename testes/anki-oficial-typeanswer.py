#!/usr/bin/env python3
import json, os, tempfile
from anki.collection import Collection

out=os.environ["SNM_ANKI_TYPEANSWER_EXPECTED"]
db=tempfile.mktemp(suffix=".anki2")
col=Collection(db)
try:
    cases=[
      ("123","",True),("123","123",True),("123","1123",True),("12","1",True),
      ("1","23",True),("нос","нс",True),("쓰다듬다","스다뜸다",True),
      ("¿Y ahora qué vamos a hacer?","y ahora qe vamosa hacer",True),
      ("<div>123</div>","123",True),("[sound:foo.mp3]<b>1</b> &nbsp;2","1  2",True),
      ('source <dir>/bin/activate','source <dir>/bin/activate',True),
      ("שִׁנּוּן","שנון",False),("חוֹף","חופ",False),("ば","は",False),
      ("élite","elite",False),("Über","Uber",False),("ação","acao",False),
      ("café","cafe",False),("mañana","manana",False),("Ångström","Angstrom",False),
      ("abcdef","abqdef",True),("abcdef","abdef",True),("abcdef","abXYcdef",True),
      ("kitten","sitting",True),("Saturday","Sunday",True),("aaaaab","aaaab",True),
      ("a b c","abc",True),("abc","a b c",True),("hello world","hello  world",True),
      ("A&B","A&B",True),("<b>A</b><br>B","A B",True)
    ]
    # systematic ASCII edits
    alphabet="abc123"
    for s in ["abc","aabbcc","12345","an anki card","spaced repetition"]:
        cases += [(s,s[:-1],True),(s,s+"x",True),(s,"x"+s,True),(s,s.replace("a","q",1),True)]
    rows=[]
    for expected,typed,combining in cases:
        rows.append({"expected":expected,"typed":typed,"combining":combining,"html":col.compare_answer(expected,typed,combining)})
    with open(out,"w",encoding="utf-8") as fh: json.dump(rows,fh,ensure_ascii=False,indent=2)
    print(f"ANKI TYPEANSWER ORACLE: {len(rows)} cases generated.")
finally:
    col.close()
    try: os.unlink(db)
    except OSError: pass
