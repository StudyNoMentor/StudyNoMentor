# 2ª auditoria dos cards Study × Anki — 21/09/2026

Reauditoria dos cards do StudyNoMentor. Duas tarefas: **conferir o que a
auditoria de 21/09 (1ª rodada) apontou e o que já foi corrigido**, e **repetir a
auditoria com os erros dela consertados e cenários mais agressivos**. Toda
afirmação aqui vem de execução contra o código, não de comentário no código.

**Veredito da auditoria: reprovado — e corrigido nesta mesma entrega.** Os treze
achados da 1ª rodada estavam endereçados no `main`, três deles apenas em parte.
Os cenários novos reproduziram **dez defeitos** que a 1ª rodada não podia ver,
três deles críticos. Cada um tem uma verificação que falhava, a correção
correspondente e a mesma verificação passando: a suíte saiu de **44/60** para
**62/62** e entrou no `verificar.mjs`.

Código auditado: `StudyNoMentor/StudyNoMentor`, `main` no commit `3299fc2`.
Backend independente: pacote oficial `anki==26.9.2` (Rust compilado), Python
3.11 e Node 22. Nenhum módulo de produção foi alterado.

---

## 1. O que a 1ª rodada apontou e onde está hoje

Os scripts da 1ª rodada (`audit/cards-20260921/`) foram reexecutados **sem
nenhuma modificação** contra o `main` atual. Os resultados estão em
`rerodada-1a-auditoria.json`; os arquivos de evidência da 1ª rodada não foram
tocados.

| Execução da 1ª rodada | Resultado em 21/09 | Resultado agora |
|---|---|---|
| `functions.mjs` (17 verificações) | 9 falhas | **17/17 passam** |
| `simulate.mjs` (12 verificações de caracterização) | 10 falhas | **12/12 passam** |
| `simulate.mjs` — cenário SM-2 | 255 cards alcançados no ano | **6.000 alcançados** |
| `simulate.mjs` — 3 cenários × 6.000 cards × 365 dias | — | 0 estados inválidos, 0 divergências de memória, 0 divergências de prévia |

A simulação desta rodada (`simulacao.mjs`, cenários independentes dos da 1ª)
repetiu a escala e passou em todas as invariantes — estes números são da
execução feita ANTES das correções, isto é, sobre o `main` auditado:

| Cenário | Respostas | Distintos | Inválidos | Memória | Prévia | Limite diário | Fila suja | Pico/dia |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| FSRS 90%, sem balanceamento | 182.274 | 6.000 | 0 | 0 | 0 | 0 | 0 | 720 |
| FSRS 95%, com balanceamento | 191.493 | 6.000 | 0 | 0 | 0 | 0 | 0 | 707 |
| Clássico (SM-2) | 176.822 | 6.000 | 0 | 0 | 0 | 0 | 0 | 675 |

**550.589 respostas**, 330 dias ativos em cada cenário, 35 dias de ausência em
dois blocos. "Fila suja" reúne três contagens separadas, todas zero: id
repetido, card suspenso e card não vencido no momento em que a fila é montada.
3,7 h de CPU no total.

Os treze achados prioritários, um a um:

| Achado da 1ª rodada | Situação |
|---|---|
| Histórico cortado em 8.000 revisões | **Parcial.** O teto saiu; o meio de armazenamento não mudou. Virou o achado crítico N1/N2 abaixo. |
| Exportação de cards sem revlog | Corrigido (`exportJson` grava `revlog`) |
| SM-2 não atualiza `phase` | Corrigido |
| SM-2 devolvia dias em vez de 60/330/600 s | Corrigido |
| Limites por baralho ignorados | Corrigido |
| Aprendizado intradiário sem prioridade | Corrigido |
| Passos vazios substituídos por padrões | **Parcial.** `CardsConfig` preserva `[]`; o agendador FSRS não executa essa configuração. Achado N5. |
| Antecipação aceitava card enterrado | Corrigido |
| Enterrar/desenterrar perdia o horário | Corrigido |
| CSV com vírgula dentro de aspas | **Parcial.** Corrigido para campo de uma linha; quebra com campo multi-linha. Achados N7/N8. |
| Exportar para o Anki perdia mídia | Corrigido |
| Cloze ignorava a dica | Corrigido |
| `removeRevlog` removia a primeira ocorrência | Corrigido |

O outro branch examinado, `claude/meus-card-anki-0ktxhg`, **já está integrado ao
`main`** (commit `1691b80`, Load Balancing determinístico e saneamento de
`CardsConfig.set()`); não há nada pendente nele.

O branch `audit/cards-anki-6000-365d-20260921` tem **seis commits que o `main`
não recebeu** (`01d4727`…`3d037a7`), justamente sobre escala do revlog. São a
resposta direta ao achado N1 — e estão condicionados a
`RelationalStore.fastRevlog === true`; com essa condição falsa, `addRevlog` cai
no mesmo caminho medido abaixo.

---

## 2. O que a 1ª rodada fez de errado, e o que mudou aqui

Seis correções de método. Sem elas, três dos nove achados novos são invisíveis
e dois números do relatório anterior não significavam nada.

**(a) O armazenamento era um dublê que apagava o problema.**
`functions.mjs` substituía `DB._get`/`DB._set` por um `Map` de objetos vivos.
Com isso, `JSON.parse`/`JSON.stringify` do histórico inteiro a cada resposta
saíram do teste — e é exatamente aí que está o custo. A verificação "histórico
anual preservado" passava com 180.000 entradas em memória, enquanto no navegador
a mesma carga estoura a cota. Aqui o `localStorage` é um `Map<string,string>`
real, com contabilidade de bytes e cota configurável.

**(b) A comparação de intervalos com o Anki não media nada.**
A 1ª rodada relatou "15.125 intervalos divergentes em 17.343" e teve de
desqualificar o próprio número ("não demonstra igualdade de datas"). O motivo é
o fuzz aleatório dos dois lados. O backend oficial expõe `fuzz_delta`: com ele o
intervalo **sem fuzz** é recuperado exatamente, e sobra a equação. É o que
`oficial.py` faz agora.

**(c) O replay oficial reusava um único card temporário.**
Os 5.781 estados passavam pelo mesmo card, com o mesmo id — e o fator de fuzz do
Anki é semeado por id + reps. Agora cada vetor recebe um card novo.

**(d) Verificações que não exercitavam o que afirmavam.**
"Passos de reaprendizado vazios preservados" só lia `CardsConfig.get()`. Nunca
mandou um card por esse caminho. Preservar uma configuração que o agendador não
sabe executar é pior do que rejeitá-la — e é o achado N5.

**(e) Asserções que passavam por acidente.**
`reset({revPerDay:0}); check(..., S.buildQueue().length===0)` rodava com a lista
de cards deixada pelo teste anterior (um único card SM-2), não com uma coleção
montada para o caso. Toda verificação aqui monta a sua própria coleção.

**(f) Cobertura estreita.** A 1ª rodada testou 12 configurações **inválidas**.
Esta testa 192 configurações **válidas** × 4 fases × 3 atrasos × 4 notas =
**9.216 agendamentos**, que é onde o usuário de verdade vive.

Dois erros meus, corrigidos antes de virarem achado: contar campo ausente de um
patch como regressão (um patch sem a chave significa "inalterado") produziu
3.168 falhas inexistentes; e cobrar ordem dos botões em configuração com passo
de dias inteiros produziu 72 — o backend oficial faz o mesmo, logo não é defeito
do app. Ambos estão anotados no código dos testes.

---

## 3. Achados novos — e o que foi feito

Todos reproduzidos por `regressao.mjs` antes da correção. A coluna
"verificação" é o id que falhava e hoje passa.

| # | Prioridade | Achado | Verificação | Origem |
|---|---|---|---|---|
| N1 | **Crítica** | Gravar uma resposta reescreve o histórico inteiro. Com 3.000 entradas: **472 KB guardados contra 884 MB escritos** (amplificação 1.871×). Dobrar as entradas multiplica o custo por **5,01** — linear seria 2. | A1, A2 | `DB.addRevlog` → `DB._set` (`11-db.js:699`) |
| N2 | **Crítica** | 157 bytes por revisão ⇒ um ano (180.000) ≈ **27 MB**, contra os ~5 MB de cota típica do `localStorage`. O estouro chega por volta de 33.000 revisões, não no fim do ano. | A3 | idem |
| N3 | **Crítica** | Com a cota estourada, `answer()` **avança a fila e empilha o desfazer** mesmo com `DB._set` devolvendo `false`. A revisão é dada por concluída sem ter sido gravada. | A4 | `CardsScreen.answer` (`44-tela-cards.js:867`), `DB._set` (`11-db.js:116`) |
| N4 | **Alta** | FSRS indexa o passo sem limitar ao último: card em reaprendizado com `learnStep` além da lista devolve `dueTs: NaN` e `_val: undefined`. **264 casos em 9.216**. O SM-2 faz o clamp na função equivalente; o FSRS não. | C1 | `atrasoDificil` em `_scheduleFSRS`, contra `hardDelay` em `_scheduleSM2` |
| N5 | **Alta** | FSRS não executa passos vazios, que a configuração declara válidos: `learnSteps: []` + "Errei" grava `dueTs: NaN`, o botão exibe **"NaN h"**, e 40 "Errei" seguidos não graduam o card. O SM-2 gradua. | B1, B3, B4, B5 | `_scheduleFSRS` vs. `if (!learn.length)` em `_scheduleSM2` |
| N6 | **Média** | Importar um backup **acrescenta**, não restaura: o mesmo arquivo aplicado duas vezes deixa 3.000 cards e 3.000 linhas de histórico numa coleção de 1.500. O encaminhamento nº 2 da 1ª rodada segue aberto. | F5 | `CardsScreen.doImport` |
| N7 | **Média** | A detecção do separador CSV olha só a primeira linha de dados. Se ela for o começo de um campo entre aspas com quebra de linha, o separador sai errado e a linha inteira é descartada. | F6.3 | `CardsScreen.parseAnkiText` |
| N8 | **Média** | Linhas de continuação de um campo multi-linha que comecem com `#` são removidas antes do parser. | F6.4 | idem |
| N9 | **Média** | Modo Clássico (SM-2): ao sair do reaprendizado, **"Fácil" devolve exatamente o mesmo intervalo que "Bom"** — acertar com folga um card que estava em reaprendizado não rende nada. O backend oficial devolve Bom = 1 dia e Fácil = 2 dias na mesma configuração. A invariante de ordem não pega isto porque aceita empate; a comparação com o Anki pega. | G4 | `graduateRelearn` em `_scheduleSM2` |
| N10 | **Baixa** | `_kind` e `_val` — transitórios da prévia dos botões — são gravados no card, entram na coleção e no backup, e fazem o desfazer não devolver o card idêntico. | E4, E4b | `CardEngine.schedule` + `DB.updateCard` |

### O que já passava antes da correção

44 das 60 verificações. Entre elas, e que a 1ª rodada não cobria: limites de
novos e de revisões **por baralho** (D1, D2); aprendizado entre dias dividindo o
mesmo teto de revisões do Anki (D4); `newCardsIgnoreReviewLimit` e
`newPerDayMinimum` (D6, D7); fila sem id repetido, sem suspenso, sem enterrado e
sem card não vencido (D3, D8); "learn ahead" de 20 min (D9); intercalador
proporcional em vez de sorteio (D10); limite diário respeitado ao longo de uma
**sessão real** por `CardsScreen.answer()` (D11–D13); desfazer 19 respostas
encadeadas e voltar ao estado anterior (E4 — a menos dos transitórios acima);
leech com limiar **ímpar** (G2); passo que atravessa a virada das 4 h virando
agendamento por dia (H1); card vencido às 23 h continuando vencido às 3 h (H3);
teto de intervalo respeitado em 9.216 agendamentos (C2); prévia do botão
idêntica ao que é gravado, inclusive com balanceamento ligado (C5).

### Medidas, não defeitos

- **Montar a fila é linear** na coleção: 17 ms com 3.000 cards, 57 ms com
  12.000 — razão 3,3 onde linear seria 4 e quadrático 16 (I1). Não é o gargalo.
- **Ordem invertida dos botões com passos de dias inteiros**: com
  `relearnSteps: [4320]` (3 dias) e intervalo pós-lapso de 1 dia, o modo
  Clássico agenda "Errei" para 3 dias e "Bom" para 1. **Perguntado ao backend
  oficial, ele responde igual**: Errei 3 dias, Difícil 4, Bom 1 (a evidência
  está em `comparacao.json`, seção `passoLongo`; com FSRS nenhum dos dois
  inverte). É consequência da configuração, não defeito do app, e por isso está
  excluído da invariante C3 — com a medição junto, não com uma dedução.
- **Degradação medida** por `CardsScreen.answer()` com DB e `localStorage`
  reais, 2.000 respostas em lotes de 250:

  | Respostas acumuladas | ms por resposta | Bytes escritos acumulados |
  |---:|---:|---:|
  | 250 | 6,6 | 98 MB |
  | 1.000 | 9,7 | 493 MB |
  | 2.000 | 13,7 | 1.257 MB |

  Responder fica **2,1× mais lento** em 2.000 respostas — cerca de duas semanas
  de uso — e o total escrito chega a 1,26 GB para 946 KB de dados. É o achado
  N1 visto do lado do usuário.

---

## 4. Comparação com o backend oficial do Anki

Estados finais da simulação anual foram replicados no backend oficial
(`oficial.py`), e o resultado comparado com o agendador do Study
(`comparar.mjs`). Nenhuma fórmula de referência local entra nessa comparação: o
lado direito é a saída do Rust compilado do Anki 26.9.2.

**Memória e fases: equivalentes.**

| O que foi comparado | Resultado |
|---|---|
| Estabilidade e dificuldade após cada nota | **46.256** comparações escalares em 5.782 cards, **0 divergências**; maior erro relativo **2,8 × 10⁻⁶** (tolerância 1e-5) |
| Fase resultante (revisão / reaprendizado) | **0 divergências** |
| Segundos do passo de reaprendizado | **0 divergências** |
| Card novo, aprendizado (passo 0 e 1), reaprendizado, revisão jovem, madura e muito atrasada — com FSRS ligado e desligado | 56 casos, **0 divergências** de fase, de segundos e de intervalo |

Foi preciso alinhar a entrada à precisão que o Anki realmente **persiste**: ele
arredonda a dificuldade ao gravar (a 1ª rodada já havia observado isso, e o
alinhamento continua necessário). Sem esse alinhamento a comparação mede
arredondamento de armazenamento, não equações.

**Intervalos: equivalentes dentro do sorteio, agora com um limite declarado.**

Os dois lados aplicam a mesma regra de fuzz sobre o mesmo valor puro, cada um
com o seu sorteio. Dois sorteios independentes da mesma faixa distam, no
máximo, duas larguras — e é isso que se cobra de "Difícil" e "Bom". De "Fácil"
cobram-se três, porque o PISO do Fácil é o intervalo do Bom **já sorteado** mais
1: os dois lados encadeiam dois sorteios, e a distância possível cresce junto.
Não é tolerância escolhida para o teste passar — é o que a medição por nota
mostra, e ela está em `comparacao.json`:

| Medida | Resultado |
|---|---|
| Intervalos de revisão comparados | **17.346** (5.782 cards × Difícil/Bom/Fácil) |
| Idênticos ao valor do Anki | 2.388 (13,8%) |
| Dentro de **uma** largura de fuzz | 14.797 (85,3%) |
| Fora do limite admissível | **0** |
| Difícil · Bom | 5.782 casos cada, razão máxima **exatamente 2,00** |
| Fácil | 5.782 casos, 18 acima de 2 larguras, razão máxima 2,50, **nenhum acima de 3** |
| Viés médio Anki − Study, por faixa de atraso | no prazo **+0,3%** · adiantado 25-75% **+0,7%** · adiantado <25% **+1,1%** · atrasado **+2,2%** — sem tendência sistemática |

Isto é o que a 1ª rodada não conseguiu concluir. Ela comparou valor sorteado com
valor sorteado sobre praticamente o mesmo conjunto — **15.125 divergências em
17.343** — e teve de escrever que o número não demonstrava nada. Com o limite
declarado por nota, sobre **17.346** comparações do mesmo tamanho, a afirmação
passa a ser verificável: **nenhuma divergência**.

**O que esta comparação ainda não demonstra:** trajetórias anuais idênticas.
É um replay de UM passo a partir de estados finais, não a fila oficial do Anki
rodando em lockstep por 365 dias. Também não entram nuvem, AnkiWeb, mídia,
notas/irmãos, modelos, baralhos aninhados nem o otimizador de pesos.

---

## 5. Limites desta rodada

Continuam **fora do escopo**, como na 1ª rodada: navegador real, desempenho de
interface, offline, concorrência, sincronização entre dispositivos, AnkiWeb,
APKG, mídia, notas/irmãos, modelos e baralhos aninhados. O otimizador de pesos
não é o oficial e não foi comparado com ele. Nenhuma base real de usuário foi
acessada ou modificada.

O que muda em relação à 1ª rodada: o armazenamento **não** é mais um dublê que
esconde o custo, e a comparação de intervalos com o Anki **não** depende mais de
dois geradores de sorteio coincidirem.

A simulação anual usa uma projeção dos cards em memória — declarada em
`simulacao.mjs` e justificada ali: `DB.getCards()` reserializa a coleção a cada
chamada e 180.000 respostas × 6.000 cards em JSON mediriam o armazenamento, não
o agendador. Esse custo **não** fica escondido: é o objeto das verificações
A1–A5 e da medição de degradação. Configuração, contadores diários e histórico
continuam passando pelo DB real em todas as verificações de `regressao.mjs`.

## 6. As correções

Os dez achados foram corrigidos. O que mudou, por área:

**Histórico de revisões (N1, N2, N3).** O histórico deixa de morar num JSON
único do `localStorage`. O dono dele passa a ser o banco relacional — onde ele
já tinha uma linha por revisão em `study_review_log`. Ficam três camadas: a
lista viva em RAM, a linha no banco, e uma rede de segurança local **apenas com
o que o banco ainda não confirmou**, arquivada em lotes pequenos quando não há
banco. Uma resposta passa a escrever o tamanho do lote, não o do histórico.

O DB avisa o banco por chamada direta (`queueRevlogAppend`/`Delete`/`Replace`)
em vez de deixá-lo **deduzir** a mudança comparando o JSON antigo com o novo —
era essa dedução que obrigava o `localStorage` a guardar o histórico inteiro. A
projeção em RAM é descartada na troca de perfil, na troca de planejamento, na
importação de perfil e em qualquer escrita crua na chave.

| Medida | Antes | Depois |
|---|---:|---:|
| Bytes escritos para gravar 3.000 revisões | 884 MB | **18 MB** |
| Fator ao dobrar o número de revisões | 5,01× | **2,0×** |
| Armazenamento local com 6.000 revisões e banco ativo | cresce sem limite | **do tamanho do lote** |

E uma resposta que não foi gravada deixou de ser dada por concluída: a fila não
avança, o desfazer não é empilhado, e se o agendamento falhar depois do
registro no histórico o registro é desfeito, para os dois não ficarem em
desacordo.

**Agendador (N4, N5, N9).** O FSRS passou a limitar o índice do passo ao último
da lista, como o Clássico já fazia. Passou a aceitar listas de passos vazias,
graduando o card em vez de travá-lo com `dueTs: NaN`. E ao sair do
reaprendizado no Clássico, "Fácil" voltou a render mais que "Bom" — 1 e 2 dias,
exatamente o que o backend oficial devolve.

**Importação e formatos (N6, N7, N8).** Aplicar um backup passou a restaurar
**por id**: o mesmo arquivo aplicado duas vezes é inócuo. Importar TSV/CSV
continua acrescentando, que é o correto para conteúdo sem id. A detecção do
separador varre o arquivo inteiro, e o descarte de linhas de comentário
respeita aspas.

**Estado do card (N10).** Os transitórios da prévia dos botões não são mais
gravados no card, na coleção nem no backup.

### O que a correção mudou de comportamento

O histórico passa a depender do banco relacional para durar indefinidamente —
que é o que a arquitetura do app já declara ("Supabase é a única fonte
persistente de verdade"). Sem banco, o histórico continua sendo gravado
localmente em lotes, e a recusa por falta de espaço passa a ser **visível e
bloqueante** em vez de silenciosa.

Uma verificação da 1ª auditoria foi ajustada à API nova: esvaziar o histórico é
`DB.replaceRevlog([])`, não uma escrita direta na chave. A verificação em si não
mudou. E a verificação de compensação de atraso do SM-2 no AutoTeste cobrava um
valor exato onde o agendador aplica fuzz — falha que **já existia no `main`** —
e passou a cobrar a faixa da equação, mais a ordem Bom < Fácil.

## 7. Reprodução

Na raiz do repositório, Node 22 e Python 3.11:

```sh
# 1ª rodada, para confirmar o que já foi corrigido (ambos saem com código 0)
node audit/cards-20260921/functions.mjs
TZ=UTC node audit/cards-20260921/simulate.mjs

# 2ª rodada
node audit/cards-20260921-v2/regressao.mjs          # 62/62 (também roda no verificar.mjs)
TZ=UTC node --max-old-space-size=6144 audit/cards-20260921-v2/simulacao.mjs

# comparação com o backend oficial (roda depois da simulação)
python3 -m venv /tmp/anki-audit-v2
/tmp/anki-audit-v2/bin/pip install -r audit/cards-20260921-v2/requisitos.txt
TZ=UTC /tmp/anki-audit-v2/bin/python audit/cards-20260921-v2/oficial.py
node audit/cards-20260921-v2/comparar.mjs
```

`regressao.mjs` roda no `verificar.mjs` e sai com código 1 em qualquer
divergência.
`vetores.json` e `vetores-oficiais.json` são gerados e ficam fora do Git; os
scripts e os resumos (`regressao.json`, `simulacao.json`, `oficial.json`,
`comparacao.json`) são versionados. Os intervalos com fuzz podem mudar entre
execuções; os valores **sem** fuzz, que são os comparados com o Anki, não.

Fontes: [manual oficial — opções de baralho](https://docs.ankiweb.net/deck-options.html),
[código oficial do Anki](https://github.com/ankitects/anki),
[distribuição do backend usado](https://pypi.org/project/anki/26.9.2/).
