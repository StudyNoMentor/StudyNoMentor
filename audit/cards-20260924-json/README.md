# Auditoria do JSON exportado — 24/09/2026

Entrada: `auditoria-cards_todos-planejamentos_2026-09-24.json` (60 cards, 193
revisões, plano PRÉ-EDITAL (MULTIBANCA)). O arquivo do usuário não é versionado.

Oráculo: pacote oficial `anki==26.9.2` (build 26.09.2, backend Rust do PyPI).
Cada card começa novo e cada resposta do `rawReviewLog` é aplicada no estado
OFICIAL anterior, com os dias decorridos reais (America/Fortaleza, virada às 4h).

```
python -m venv v && v/bin/pip install -r requisitos.txt
TZ=America/Fortaleza v/bin/python replay_oficial.py <json> replay.json
v/bin/python comparar.py replay.json
node recalcular.mjs <raiz-do-repo> <json> replay.json
```

## Resultado

| Verificação | Resultado |
|---|---|
| Configuração do deck (passos, retenção, limites, sanguessuga, graduação) | idêntica ao padrão do Anki 26.09.2 |
| Transições de fase (novo → aprendizado → revisão → reaprendizado) | 192/193 (a exceção é o card `cabb3a95`, abaixo) |
| Estabilidade/dificuldade após cada resposta | 158/193 idênticas; 35 divergências (causa 1 e 2) |
| Intervalos em dias | todos dentro da faixa de fuzz do Anki, exceto `cabb3a95` |
| Fila de 24/09 | 15 revisões vencidas + 4 novos intercalados = mesmo conjunto do Anki |
| `elapsed` do histórico | 193/193 coerente com as datas |

### Causa 1 — "Difícil" no mesmo dia reduzia a estabilidade (corrigido)

O Anki 26.09.2 trava `SInc >= 1` para G >= 2. O commit `29bafc5` trocou para
G >= 3 e fez `paridade-anki.mjs` falhar (6 divergências). Em revisões intradiárias
com "Difícil" o app gravava S menor que o Anki (ex.: 0,0801 vs 0,2467).
Cards afetados: `477e5bca`, `a96de7d3`, `a16ba379`, `7eec3309`, `27ac9e2c`.

Depois da correção, `FSRS.recomputarMemoria` sobre o histórico do JSON bate com o
Anki oficial em 56/56 cards (as duas diferenças restantes são o arredondamento
de S a 4 casas que o Anki grava, < 0,5% em S < 0,02 dia).

### Causa 2 — resposta gravada no histórico sem atualizar o card

`cabb3a95`: "Errei" às 17:09:40 com o card novo. O card voltou 3 posições
depois (reinserção do passo de 1 min), mas o estado lido na 2ª resposta ainda
era `phase: new, s: null`. O histórico tem 3 respostas; o card tem `reps: 2`,
S = 2,3065 (Anki: 0,2842) e vencimento 25/09 (Anki: 24/09). A volta 88 s depois,
3 cards adiante, é a reinserção do passo de 1 min, não um desfazer. O cenário é
de escopo global, com o card vindo de outro planejamento. A causa exata não é
reproduzível só pelo JSON.

### Observação menor

`_position` do histórico tem 9 valores duplicados e 9 lacunas. Não afeta o
agendamento.
