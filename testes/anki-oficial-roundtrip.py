#!/usr/bin/env python3
import os, tempfile
from anki.collection import (Collection, ImportAnkiPackageRequest, ImportAnkiPackageOptions, ExportAnkiPackageOptions)
from anki.decks import DeckId

def import_and_assert(path: str) -> None:
    db=tempfile.mktemp(suffix='.anki2')
    col=Collection(db)
    try:
        col.import_anki_package(ImportAnkiPackageRequest(package_path=path, options=ImportAnkiPackageOptions(merge_notetypes=True, with_scheduling=True, with_deck_configs=True)))
        assert col.note_count()==2, (path, col.note_count())
        cids=col.find_cards('')
        assert len(cids)==2, (path, len(cids))
        cards=[col.get_card(cid) for cid in cids]
        assert any(c.reps==4 for c in cards), 'scheduling/reps do Study não chegaram ao Anki oficial'
        names={col.models.get(col.get_note(c.nid).mid)['name'] for c in cards}
        assert any(n.startswith('Basic') for n in names) and any(n.startswith('Cloze') for n in names), names
        media=os.listdir(col.media.dir())
        assert any(x.endswith('.png') for x in media), media
        assert any(x.endswith('.mp3') for x in media), media
    finally:
        col.close()
        if os.path.exists(db): os.unlink(db)

for key in ('SNM_APKG_LEGACY_OUT','SNM_APKG_LATEST_OUT'):
    p=os.environ.get(key)
    assert p and os.path.exists(p), f'{key} ausente'
    import_and_assert(p)

# Gera uma fixture pelo próprio backend oficial 26.09.2 para o importador Study.
out=os.environ['SNM_ANKI_OFFICIAL_OUT']
db=tempfile.mktemp(suffix='.anki2')
col=Collection(db)
try:
    did=col.decks.id('Official Advanced')
    basic=col.models.by_name('Basic'); assert basic
    basic['css'] += '\n@font-face{font-family:OfficialFont;src:url("_official.woff2")} .card{font-family:OfficialFont}'
    basic['tmpls'][0]['qfmt']='<details open><summary>Dica oficial</summary>{{Front}}</details><script src="_official.js"></script>'
    basic['tmpls'][0]['afmt']='{{FrontSide}}<hr id=answer>{{Back}}'
    col.models.save(basic)
    with open(os.path.join(col.media.dir(),'_official.js'),'wb') as f: f.write(b'document.body.dataset.official="1";')
    with open(os.path.join(col.media.dir(),'_official.woff2'),'wb') as f: f.write(bytes([0,1,2,3,4,5,6,7]))
    with open(os.path.join(col.media.dir(),'_official.svg'),'wb') as f: f.write(b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')
    note=col.new_note(basic); note['Front']='<b>Gerado pelo Anki</b><img src="_official.svg">'; note['Back']='Resposta'; col.add_note(note,did)
    cloze=col.models.by_name('Cloze'); assert cloze
    cn=col.new_note(cloze); cn['Text']='O {{c1::ICMS}} é {{c2::estadual}}.'; cn['Back Extra']='CF/88'; col.add_note(cn,did)
    col.export_anki_package(out_path=out, options=ExportAnkiPackageOptions(with_scheduling=True,with_deck_configs=True,with_media=True,legacy=False), limit=None)
finally:
    col.close()

assert os.path.getsize(out)>0
print('ANKI OFICIAL 26.09.2: importou APKG Study Legacy/Latest e gerou fixture Latest avançada.')
