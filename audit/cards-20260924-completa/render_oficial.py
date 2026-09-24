"""Renderização de modelos no anki==26.09.2 (pergunta e resposta) para casos
que exercitam campos, condicionais, campos especiais, filtros e cloze."""
import json, sys, tempfile
import anki.lang
anki.lang.set_lang('pt_BR')          # mensagens do Anki no idioma do usuário
from anki.collection import Collection
col = Collection(tempfile.mkdtemp() + '/r.anki2')
CASOS = [
  ('campos', '{{Front}}', '{{FrontSide}}<hr id=answer>{{Back}}', {'Front': 'Olá <b>mundo</b>', 'Back': 'resposta'}),
  ('cond_pos', '{{#Back}}tem:{{Back}}{{/Back}}{{Front}}', '{{Front}}', {'Front': 'f', 'Back': 'b'}),
  ('cond_pos_vazio', '{{Front}}{{#Back}}tem:{{Back}}{{/Back}}', '{{Front}}', {'Front': 'f', 'Back': ''}),
  ('cond_neg', '{{Front}}{{^Back}}sem verso{{/Back}}', '{{Front}}', {'Front': 'f', 'Back': ''}),
  ('cond_aninhada', '{{#Front}}A{{#Back}}B{{/Back}}C{{/Front}}', '{{Front}}', {'Front': 'x', 'Back': 'y'}),
  ('cond_espacos_html', '{{Front}}{{#Back}}[tem]{{/Back}}', '{{Front}}', {'Front': 'f', 'Back': '<br> <div></div>'}),
  ('texto', '{{text:Front}}', '{{Back}}', {'Front': '<b>negrito</b> &amp; <i>it</i><br>linha', 'Back': 'b'}),
  ('furigana', '{{furigana:Front}}', '{{kana:Front}}|{{kanji:Front}}', {'Front': '日本[にほん]語[ご] 漢字[かんじ]', 'Back': ''}),
  ('tipo', '{{Front}}{{type:Back}}', '{{Front}}<hr id=answer>{{type:Back}}', {'Front': 'f', 'Back': 'resp'}),
  ('tts', '{{tts en_US:Front}}', '{{Back}}', {'Front': 'hello', 'Back': 'b'}),
  ('especiais', '{{Type}}|{{Card}}|{{Deck}}|{{Subdeck}}|{{Tags}}', '{{Front}}', {'Front': 'f', 'Back': 'b'}),
  ('campo_inexistente_vazio', '{{Front}}[{{Back}}]', '{{Front}}', {'Front': 'f', 'Back': ''}),
  ('dica', '{{Front}}{{hint:Back}}', '{{Back}}', {'Front': 'f', 'Back': 'dica <b>aqui</b>'}),
  ('dica_longa', '{{Front}}{{hint:Back}}', '{{Back}}', {'Front': 'f', 'Back': 'áé' * 900}),
  ('dica_vazia', '{{Front}}{{hint:Back}}', '{{Back}}', {'Front': 'f', 'Back': '  '}),
  ('comentario_nao_vazio', '{{Front}}{{#Back}}[tem]{{/Back}}', '{{Front}}', {'Front': 'f', 'Back': '<!-- nota -->'}),
  ('flag_e_cn', '{{CardFlag}}|{{#c1}}um{{/c1}}{{#c2}}dois{{/c2}}|{{#Tags}}T{{/Tags}}', '{{Front}}', {'Front': 'f', 'Back': 'b'}),
  ('texto_entidade_invalida', '{{text:Front}}', '{{Back}}', {'Front': 'a &naoexiste; <i>b</i> &amp;', 'Back': 'b'}),
  ('texto_e_solto', '{{text:Front}}', '{{Back}}', {'Front': 'P & D <b>&lt;x&gt;</b>', 'Back': 'b'}),
  ('texto_comentario_style', '{{text:Front}}', '{{Back}}', {'Front': 'a<!--c--><style>.x{}</style>b<script>1</script>c&nbsp;d&#x41;&#66;', 'Back': 'b'}),
]
CLOZES = [
  ('cloze_simples', '{{c1::Brasília}} é a capital do {{c2::Brasil}}', 1),
  ('cloze_c2', '{{c1::Brasília}} é a capital do {{c2::Brasil}}', 2),
  ('cloze_dica', 'A {{c1::fotossíntese::processo}} ocorre na {{c1::folha}}', 1),
  ('cloze_html', 'Lei {{c1::<b>8.112</b>/90}} rege servidores', 1),
  ('cloze_aninhado', '{{c1::Rio de {{c2::Janeiro}}}}', 1),
  ('cloze_aninhado_c2', '{{c1::Rio de {{c2::Janeiro}}}}', 2),
  ('cloze_unicode', '{{c1::日本語 & ©}} x', 1),
  ('cloze_ausente', '{{c1::um}} e {{c3::três}}', 2),
]
out = []
def modelo(nome, campos, q, a, cloze=False):
    m = col.models.new(nome)
    if cloze: m['type'] = 1
    for f in campos: col.models.add_field(m, col.models.new_field(f))
    t = col.models.new_template('Cloze' if cloze else 'Card 1'); t['qfmt'] = q; t['afmt'] = a
    col.models.add_template(m, t); col.models.add(m); return col.models.by_name(nome)
for nome, q, a, campos in CASOS:
    m = modelo('M_' + nome, ['Front', 'Back'], q, a)
    did = col.decks.id('Pai::Filho ' + nome)
    n = col.new_note(m)
    for k, v in campos.items(): n[k] = v
    n.tags = ['t1', 'pai::t2']
    col.add_note(n, did)
    c = n.cards()[0]
    out.append(dict(nome=nome, qfmt=q, afmt=a, campos=campos, tags=n.tags, deck='Pai::Filho ' + nome, modelo=m['name'],
                    cartao=m['tmpls'][0]['name'], ord=0, pergunta=c.question(), resposta=c.answer(), tts=[[t.lang, t.field_text] for t in c.question_av_tags() if hasattr(t, 'lang')]))
m = modelo('M_campo_deck', ['Front', 'Back', 'Deck'], '{{Front}}|{{Deck}}|{{Subdeck}}', '{{Front}}'); n = col.new_note(m); n['Front'] = 'f'; n['Back'] = 'b'; n['Deck'] = 'meu campo'
did = col.decks.id('A::B'); col.add_note(n, did); c = n.cards()[0]
out.append(dict(nome='campo_nota_deck', qfmt=m['tmpls'][0]['qfmt'], afmt='{{Front}}', campos={'Front': 'f', 'Back': 'b', 'Deck': 'meu campo'}, tags=[], deck='A::B',
                modelo='M_campo_deck', cartao='Card 1', ord=0, pergunta=c.question(), resposta=c.answer()))
cz = modelo('Cloze', ['Text', 'Back Extra'], '{{cloze:Text}}', '{{cloze:Text}}<br>\n{{Back Extra}}', cloze=True)
for nome, texto, ordn in CLOZES:
    n = col.new_note(cz); n['Text'] = texto; n['Back Extra'] = 'extra'; col.add_note(n, 1)
    cs = [x for x in n.cards() if x.ord == ordn - 1]
    if cs:
        q, a = cs[0].question(), cs[0].answer()
    else:  # card cuja omissão sumiu do texto (fica na coleção até "Cartas Vazias")
        base = n.cards()[0].id; novo = base + 100000
        col.db.execute('insert into cards (id,nid,did,ord,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data) '
                       'select ?,nid,did,?,mod,usn,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data from cards where id=?', novo, ordn - 1, base)
        c = col.get_card(novo); q, a = c.question(), c.answer()
    out.append(dict(nome=nome, cloze=True, campos={'Text': texto, 'Back Extra': 'extra'}, tags=[], deck='Default', modelo='Cloze',
                    cartao='Cloze', ord=ordn - 1, pergunta=q, resposta=a))
# Geração de cards (cardgen.rs): quais templates viram card para cada nota.
TPLS = ['{{Front}}', '{{#Extra}}{{Back}}{{/Extra}}', '{{^Extra}}{{Front}}{{/Extra}}', '{{Tags}}', '{{Deck}}', '{{text:Back}}']
mg = col.models.new('M_geracao')
for f in ['Front', 'Back', 'Extra']: col.models.add_field(mg, col.models.new_field(f))
for i, q in enumerate(TPLS):
    t = col.models.new_template(f'T{i+1}'); t['qfmt'] = q; t['afmt'] = '{{Front}}'; col.models.add_template(mg, t)
col.models.add(mg); mg = col.models.by_name('M_geracao')
geracao = []
for campos, tags in [({'Front': 'f', 'Back': 'b', 'Extra': ''}, []), ({'Front': 'f', 'Back': 'b', 'Extra': 'x'}, ['t']),
                     ({'Front': '', 'Back': 'b', 'Extra': 'x'}, []), ({'Front': '<br>', 'Back': '', 'Extra': '<!--c-->'}, ['a', 'b'])]:
    n = col.new_note(mg)
    for k, v in campos.items(): n[k] = v
    n.tags = tags
    try:
        col.add_note(n, 1); ords = sorted(c.ord for c in n.cards())
    except Exception as e:
        ords = []
    geracao.append(dict(campos=campos, tags=tags, ords=ords))
json.dump(dict(render=out, geracao=dict(templates=TPLS, notas=geracao)), open(sys.argv[1], 'w'), ensure_ascii=False, indent=0); print('casos', len(out), 'geração', len(geracao))
