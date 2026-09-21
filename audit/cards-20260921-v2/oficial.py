"""2ª auditoria — replay dos estados do Study no backend OFICIAL do Anki.

Correções em relação ao script de 21/09 (1ª rodada):

1. CARD NOVO A CADA VETOR. A 1ª rodada reaproveitava um único card temporário
   para os 5.781 estados. Campos não reescritos (posição na fila, histórico de
   revisão, id) vazavam de um vetor para o outro, e o id fixo tornava o fator
   de fuzz dependente da ordem dos vetores.

2. FUZZ REMOVIDO DOS DOIS LADOS. A 1ª rodada comparou intervalos JÁ sorteados e
   colheu 15.125 divergências em 17.343 — um número que não significava nada.
   Aqui o backend devolve `fuzz_delta`, e o intervalo SEM fuzz é recuperado
   exatamente. Sobra a equação, que é o que se quer comparar.

3. FAIXA DE FUZZ EXPORTADA. Além do intervalo sem fuzz, exportamos os limites
   que o Anki aceitaria, para verificar que o sorteio do Study cai dentro deles.

4. SM-2 E PASSOS DE APRENDIZADO COBERTOS. A 1ª rodada só replicou cards em
   revisão com FSRS. Aqui entram também card novo, card em aprendizado e card
   em reaprendizado, com FSRS ligado e desligado.

Não usa nenhuma fórmula do Study. Roda depois de simulacao.mjs.
"""
import json, tempfile, time, importlib.metadata
from pathlib import Path
from anki.collection import Collection
from anki.cards import FSRSMemoryState
from anki.config_pb2 import ConfigKey

PASTA = Path(__file__).parent
vetores = json.loads((PASTA / 'vetores.json').read_text())

NOTAS = [('errei', 'again'), ('dificil', 'hard'), ('bom', 'good'), ('facil', 'easy')]


def estados(col, card, kind):
    st = col._backend.get_scheduling_states(card.id)
    out = {}
    for local, oficial in NOTAS:
        normal = getattr(st, oficial).normal
        fase = normal.WhichOneof('kind')
        estado = getattr(normal, fase)
        mem = estado.learning.memory_state if fase == 'relearning' else estado.memory_state
        item = {
            'fase': fase,
            'estabilidade': mem.stability,
            'dificuldade': mem.difficulty,
        }
        if fase == 'review':
            dias = estado.scheduled_days
            item['diasAgendados'] = dias
            # `fuzz_delta` NÃO serve para recuperar o intervalo puro: ele relata o
            # fuzz aplicado na revisão ANTERIOR e devolve 0 para card sem revlog,
            # que é o caso destes estados sintéticos. Então não se inverte o
            # sorteio — compara-se por FAIXA, em comparar.mjs. Registrado aqui
            # para que ninguém repita a tentativa achando que funciona.
            item['fuzzDeltaRelatado'] = col._backend.fuzz_delta(card_id=card.id, interval=dias)
        elif fase == 'relearning':
            item['segundos'] = estado.learning.scheduled_secs
        elif fase == 'learning':
            item['segundos'] = estado.scheduled_secs
        out[local] = item
    return out


def nova_colecao(tmp, i, fsrs=True):
    col = Collection(f'{tmp}/c{i}.anki2')
    col.set_config('fsrs', fsrs)
    col._backend.set_config_bool(key=ConfigKey.Bool.LOAD_BALANCER_ENABLED, value=False, undoable=False)
    col._backend.set_config_bool(key=ConfigKey.Bool.FSRS_SHORT_TERM_WITH_STEPS_ENABLED, value=True, undoable=False)
    return col


def novo_card(col, rotulo):
    n = col.new_note(col.models.by_name('Basic'))
    n['Front'] = rotulo
    col.add_note(n, 1)
    return n.cards()[0]


relatorio = {
    'versaoAnki': importlib.metadata.version('anki'),
    'origem': 'wheel oficial do PyPI, backend Rust compilado',
    'correcoes': [
        'card novo por vetor (a 1ª rodada reusava um card temporário)',
        'intervalo comparado por FAIXA de fuzz, não por valor sorteado (a 1ª rodada comparou sorteio com sorteio e teve de descartar o resultado)',
        'faixa de fuzz exportada para verificar o sorteio do Study',
        'cobertura de card novo, aprendizado, reaprendizado e SM-2',
    ],
    'vetoresEmRevisao': 0,
    'limitacoes': 'Replay de UM passo a partir de estados finais do Study, não a trajetória anual em lockstep. '
                  'Não exercita nuvem, AnkiWeb, mídia, notas/irmãos, modelos nem baralhos aninhados.',
}

saida = {'revisao': [], 'fases': []}
stamp = int(time.time())

with tempfile.TemporaryDirectory() as tmp:
    # ── (1) Cards em revisão vindos da simulação anual ───────────────────────
    col = nova_colecao(tmp, 'rev')
    for v in vetores:
        c = v['card']
        decorrido = v['decorrido']
        card = novo_card(col, 'v' + str(c['id']))
        card.type = 2
        card.queue = 2
        card.ivl = c['intervalo']
        card.due = col.sched.today + c['intervalo'] - decorrido
        card.reps = c['reps']
        card.lapses = c.get('lapses', 0) or 0
        card.factor = 2500
        card.memory_state = FSRSMemoryState(stability=c['s'], difficulty=c['d'])
        card.last_review_time = stamp - decorrido * 86400
        card.desired_retention = 0.9
        col._backend.update_cards(cards=[card._to_backend_card()], skip_undo_entry=True)
        carregado = col.get_card(card.id)
        saida['revisao'].append({
            # O estado de ENTRADA é o que o Anki realmente PERSISTE: ele arredonda
            # a dificuldade ao gravar. Comparar contra o que foi enviado, e não
            # contra o que ficou gravado, produziu 17.354 falsas divergências na
            # 1ª rodada. A correção é manter o alinhamento — e dizer que ele existe.
            'card': dict(c, s=carregado.memory_state.stability, d=carregado.memory_state.difficulty),
            'decorrido': decorrido,
            'oficial': estados(col, card, 'review'),
        })
    relatorio['vetoresEmRevisao'] = len(saida['revisao'])
    col.close()

    # ── (2) Fases não cobertas pela 1ª rodada, com e sem FSRS ────────────────
    CASOS = [
        # `left` = PASSOS QUE AINDA FALTAM. Sem defini-lo o backend assume 0, ou
        # seja, "último passo", e responde como se o card estivesse no fim da
        # aprendizagem: "Bom" gradua direto para revisão. Comparar contra isso
        # acusaria uma divergência de fase que é do teste, não do app. Com os
        # passos padrão [1, 10]: passo 0 → faltam 2; passo 1 → falta 1.
        ('novo', dict(type=0, queue=0, ivl=0, reps=0, lapses=0, left=0, passo=0, mem=None, decorrido=0)),
        ('aprendizado-passo0', dict(type=1, queue=1, ivl=0, reps=1, lapses=0, left=2, passo=0, mem=(0.5, 6.0), decorrido=0)),
        ('aprendizado-passo1', dict(type=1, queue=1, ivl=0, reps=2, lapses=0, left=1, passo=1, mem=(1.5, 6.0), decorrido=0)),
        ('reaprendizado', dict(type=3, queue=1, ivl=1, reps=12, lapses=4, left=1, passo=0, mem=(6.0, 7.5), decorrido=0)),
        ('revisao-jovem', dict(type=2, queue=2, ivl=3, reps=4, lapses=0, left=0, passo=0, mem=(3.2, 5.0), decorrido=3)),
        ('revisao-madura', dict(type=2, queue=2, ivl=210, reps=18, lapses=1, left=0, passo=0, mem=(200.0, 4.5), decorrido=210)),
        ('revisao-muito-atrasada', dict(type=2, queue=2, ivl=20, reps=9, lapses=2, left=0, passo=0, mem=(20.0, 6.0), decorrido=95)),
    ]
    for usa_fsrs in (True, False):
        col = nova_colecao(tmp, 'f' + str(usa_fsrs), fsrs=usa_fsrs)
        for nome, k in CASOS:
            card = novo_card(col, nome)
            card.type = k['type']; card.queue = k['queue']; card.ivl = k['ivl']
            card.reps = k['reps']; card.lapses = k['lapses']; card.factor = 2500; card.left = k['left']
            card.due = col.sched.today + k['ivl'] - k['decorrido'] if k['type'] == 2 else col.sched.today
            if usa_fsrs and k['mem']:
                card.memory_state = FSRSMemoryState(stability=k['mem'][0], difficulty=k['mem'][1])
                card.desired_retention = 0.9
            card.last_review_time = stamp - k['decorrido'] * 86400 if k['reps'] else 0
            col._backend.update_cards(cards=[card._to_backend_card()], skip_undo_entry=True)
            carregado = col.get_card(card.id)
            saida['fases'].append({
                'caso': nome,
                'fsrs': usa_fsrs,
                'entrada': dict(k, mem=[carregado.memory_state.stability, carregado.memory_state.difficulty] if (usa_fsrs and k['mem']) else None),
                'oficial': estados(col, card, nome),
            })
        col.close()

    # ── (3) PASSO DE REAPRENDIZADO LONGO ────────────────────────────────────
    # A ordem "Errei < Bom" se inverte quando o passo de reaprendizado dura
    # mais que o intervalo pós-lapso. Antes de chamar isso de defeito do app,
    # perguntamos ao backend oficial o que ELE faz na mesma configuração.
    saida['passoLongo'] = []
    for usa_fsrs in (True, False):
        col = nova_colecao(tmp, 'pl' + str(usa_fsrs), fsrs=usa_fsrs)
        conf = col.decks.get_config(1)
        conf['lapse']['delays'] = [4320.0]     # 3 dias
        conf['new']['delays'] = [1.0, 10.0]
        col.decks.update_config(conf)
        card = novo_card(col, 'passo-longo')
        card.type = 3; card.queue = 1; card.ivl = 1; card.due = col.sched.today
        card.reps = 12; card.lapses = 4; card.factor = 2500; card.left = 1
        if usa_fsrs:
            card.memory_state = FSRSMemoryState(stability=6.0, difficulty=7.5)
            card.desired_retention = 0.9
        card.last_review_time = stamp
        col._backend.update_cards(cards=[card._to_backend_card()], skip_undo_entry=True)
        saida['passoLongo'].append({'fsrs': usa_fsrs, 'oficial': estados(col, card, 'relearning')})
        col.close()

(PASTA / 'vetores-oficiais.json').write_text(json.dumps(saida))
relatorio['casosDeFase'] = len(saida['fases'])
relatorio['passoLongo'] = {
    ('fsrs' if x['fsrs'] else 'sm2'): {g: (v.get('segundos') or v.get('diasAgendados')) for g, v in x['oficial'].items()}
    for x in saida['passoLongo']
}
(PASTA / 'oficial.json').write_text(json.dumps(relatorio, indent=2))
print(json.dumps(relatorio, indent=2))
