# Auditoria completa do módulo Cards × Anki 26.09.2 — 24/09/2026

Oráculo: `anki==26.9.2` (build 26.09.2, backend Rust do PyPI) e o código-fonte
da tag `26.09.2` de `ankitects/anki` (`rslib/src/scheduler/**`,
`storage/card/mod.rs`, `decks/limits.rs`). Escopo: o módulo **Cards** (motor
local `CardEngine`/`CardsScreen`), não a tela "Anki Oficial".

## Como reproduzir

```
python -m venv v && v/bin/pip install anki==26.9.2
export TZ=America/Fortaleza
node gerar.mjs 400 estados.json                   # agendador do Cards
v/bin/python oficial.py estados.json oficial.json # mesmos estados no Anki
python3 comparar.py estados.json oficial.json
v/bin/python fila_oficial.py fila.json            # 19 coleções no Anki
node fila_comparar.mjs fila.json                  # mesma fila no Cards
```

A identidade Anki do card (`ankiId`, `ankiMod`) é a mesma dos dois lados, então
fuzz, balanceamento e desempates pseudoaleatórios precisam coincidir EXATAMENTE,
não por faixa.

## Agendador — 72.877 / 72.878 comparações idênticas

4.000 estados × 4 botões em 10 predefinições (FSRS com 1, 2, 4 e 0 passos,
retenções 0,80–0,95, intervalo máximo 30/365/36500; SM-2 padrão, customizado e
com passos longos; balanceamento de carga com e sem easy days sobre 400 cards de
fundo, incluindo suspensos e aprendizado entre dias). Compara fase, passo em
segundos, intervalo em dias, S/D, facilidade, lapsos, sanguessuga e intervalo
pós-lapso. Resíduo: 1 passo de curto prazo com 1 s de diferença (aritmética f32
do Rust contra f64 do JS).

## Fila do dia — 19 / 19 cenários idênticos, posição a posição

Limites (inclusive teto de revisões sobre novos e o interruptor global),
mistura de novos e de aprendizado entre dias (antes/depois/misturar), as 12
ordens de revisão, as 6 coletas e as 5 ordenações de novos.

## Divergências encontradas e corrigidas nesta rodada

| # | Área | Anki 26.09.2 | Cards antes |
|---|---|---|---|
| 1 | Fuzz de revisão | faixa calculada sobre o intervalo fracionário | arredondava antes, faixa deslocada em ~10% dos casos |
| 2 | "Fácil" ao graduar | piso = "Bom" sorteado sobre o fracionário + 1 | "Bom" arredondado |
| 3 | FSRS sem passos | intervalo < 0,5 dia fica em (re)aprendizado em segundos | ia para 1 dia |
| 4 | FSRS "Errei" sem reaprendizado | só arredonda, sem fuzz | aplicava fuzz |
| 5 | Estado de memória gravado | S com 4 casas, D com 3 | precisão total (desvio acumulado) |
| 6 | SM-2 graduação | facilidade inicial da predefinição | 2,5 fixo do card novo |
| 7 | SM-2 graduação | sem multiplicador global | aplicava |
| 8 | SM-2 fuzz | sobre o fracionário | arredondava antes |
| 9 | SM-2 saída do reaprendizado | Bom = intervalo pós-lapso, Fácil = +1, sem fuzz | fuzz + multiplicador |
| 10 | SM-2 lapso | fuzz no intervalo pós-lapso, sem multiplicador global, já no erro | sem fuzz / com multiplicador |
| 11 | SM-2 "Errei" no reaprendizado | reaplica o multiplicador de lapso | mantinha o intervalo |
| 12 | SM-2 balanceamento | passa pelo LoadBalancer | não balanceava |
| 13 | Balanceamento: contagem | todo card com vencimento em dias (suspensos, aprendizado entre dias) | só revisões não suspensas |
| 14 | Balanceamento: limite de 90 dias | `interval as usize` (trunca) | comparava o fracionário |
| 15 | Balanceamento: irmãos | só com "enterrar revisões irmãs"; só vencimentos ≥ hoje | sempre; vencidos contavam como hoje |
| 16 | Fila: coleta | aprendizado entre dias → revisões → novos | novos primeiro |
| 17 | Fila: teto de novos | revisão aceita reduz novos; novo aceito não consome revisão | novo consumia revisão |
| 18 | Fila: ordenação de novos | depois do limite | antes (trocava posições menores por maiores) |
| 19 | Fila: intercalação | revisões conduzem; aprendizado entre dias entra antes dos novos | argumentos invertidos, ordem invertida |
| 20 | Fila: aprendizado entre dias | mesma ordem das revisões | sem ordenação |
| 21 | Fila: intradiário | primeiro quem tem repetições, depois vencimento | só vencimento |
| 22 | Ordem "facilidade" no FSRS | dificuldade invertida | dificuldade direta |
| 23 | Ordem "adicionados" | nid, ord | data de criação |
| 24 | Ordem "sobreatraso" no FSRS | retenção relativa | fórmula do SM-2 |
| 25 | Ordem por retenção | segundos desde a última revisão | dias inteiros (grava `lastReviewTs`) |
| 26 | Ordenação aleatória de novos | hash u64 sem sinal | com sinal |
