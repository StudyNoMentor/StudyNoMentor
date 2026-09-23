#!/usr/bin/env python3
import json, os, tempfile
from anki.collection import Collection

out=os.environ["SNM_ANKI_SEARCH_EXPECTED"]
db=tempfile.mktemp(suffix=".anki2")
col=Collection(db)
try:
    alpha=col.decks.id("Alpha")
    child=col.decks.id("Alpha::Child")
    beta=col.decks.id("Beta")
    basic=col.models.by_name("Basic"); cloze=col.models.by_name("Cloze")
    assert basic and cloze

    created={}
    def add_basic(marker, text, back, tags, did):
        n=col.new_note(basic); n["Front"]=marker+" "+text; n["Back"]=back; n.tags=list(tags); col.add_note(n,did)
        cid=n.card_ids()[0]; created[marker]=[cid]; return cid
    def add_cloze(marker, text, tags, did):
        n=col.new_note(cloze); n["Text"]=marker+" "+text; n["Back Extra"]="extra"; n.tags=list(tags); col.add_note(n,did)
        cids=n.card_ids(); created[marker]=list(cids); return cids

    add_basic("A_PARIS","Paris capital France","Seine",["geo","lang::fr"],alpha)
    add_basic("B_UBER","Über café","accent",["lang::de"],child)
    add_basic("C_PLAIN","plain dog","animal",[],beta)
    add_basic("D_REGEX","alpha-123","omega",["code"],beta)
    add_cloze("E_CLOZE","{{c1::mn}}{{c2::e}}monic",["cloze"],child)
    add_basic("F_TAG","nesting","tag",["parent::child"],alpha)
    g=add_basic("G_REVIEW","scheduled review","review",["sched"],alpha)
    h=add_basic("H_SUSP","suspended card","suspend",["state"],beta)
    i=add_basic("I_BURIED","buried card","bury",["state"],beta)
    j=add_basic("J_FLAG","flagged card","flag",["state"],alpha)

    card=col.get_card(g); card.type=2; card.queue=2; card.ivl=30; card.reps=5; card.lapses=2; card.factor=2500; card.due=col.sched.today; col.update_card(card)
    col.sched.suspend_cards([h])
    col.sched.bury_cards([i], manual=True)
    col.set_user_flag_for_cards(3,[j])

    def label(cid):
        card=col.get_card(cid); note=col.get_note(card.nid); first=str(note.fields[0]); marker=first.split(" ",1)[0]
        return f"{marker}#{card.ord}"

    base=[
      "", "Paris", "dog", "deck:Alpha", 'deck:"Alpha::Child"', "-deck:Beta",
      "tag:geo", "tag:none", "tag:parent", "tag:parent::*", "nc:uber", "w:dog",
      "re:^B_UBER", "sc:mnemonic", "Front:*Paris*", "Front:re:^A_PARIS",
      "Front:nc:uber", "note:Basic", "note:Cloze", "card:1", "flag:3",
      "is:new", "is:review", "is:suspended", "is:buried",
      "prop:ivl>=10", "prop:reps>=5", "prop:lapses=2",
      "(tag:geo OR tag:code)", "deck:Alpha tag:lang::*", "-tag:none",
      "(deck:Alpha OR deck:Beta) tag:state", "A_PARIS OR B_UBER", "tag:state -is:suspended"
    ]
    # Gera uma matriz de combinações booleanas para detectar precedência/negação.
    atoms=["tag:geo","tag:code","tag:state","deck:Alpha","deck:Beta","is:new","is:review","flag:3","nc:uber","w:dog"]
    queries=list(base)
    for a in atoms:
        for b in atoms:
            if a==b: continue
            queries.append(f"{a} {b}")
            queries.append(f"({a} OR {b})")
            queries.append(f"{a} -{b}")
    seen=set(); rows=[]
    for q in queries:
        if q in seen: continue
        seen.add(q)
        try:
            ids=col.find_cards(q)
            rows.append({"query":q,"labels":sorted(label(cid) for cid in ids)})
        except Exception as e:
            rows.append({"query":q,"error":str(e)})
    with open(out,"w",encoding="utf-8") as fh:
        json.dump({"queries":rows},fh,ensure_ascii=False,indent=2)
    print(f"ANKI SEARCH ORACLE: {len(rows)} queries generated.")
finally:
    col.close()
    try: os.unlink(db)
    except OSError: pass
