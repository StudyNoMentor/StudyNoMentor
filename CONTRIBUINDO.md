# Como mexer neste código

## O que é publicado

`index.html` — um arquivo, sem build step, sem dependência para rodar. É o que
abre no navegador, o que o GitHub Pages serve e o que funciona por `file://`.
**Isso não mudou e não deve mudar.**

`manifest.webmanifest` e `sw.js` são opcionais: se estiverem ao lado do
`index.html`, o app fica instalável e abre sem internet. Se não estiverem, o app
funciona igual — só sem offline.

## O que existe para quem MANTÉM o código

`index.html` tem ~32.800 linhas. Editar isso direto é onde os erros nascem.
Por isso o mesmo conteúdo vive também em `src/`, quebrado em 45 arquivos:

```
src/
  html/   4 pedaços do documento (cabeçalho, corpo, rodapé)
  css/    5 folhas de estilo
  js/    36 módulos do aplicativo
```

`build.mjs` junta `src/` de volta em `index.html`. A montagem é uma
**concatenação literal**: nada é minificado, transpilado, reordenado ou
reescrito. O `index.html` gerado é **byte a byte** igual ao que está no
repositório — e `node build.mjs --check` prova isso.

### Por que não viramos módulos ES de verdade

`<script type="module" src="...">` seria o caminho óbvio, e foi descartado por
quatro motivos concretos:

1. o app tem de abrir por `file://` — módulos ES são bloqueados por CORS aí;
2. seriam ~45 requisições em vez de 1, num app que é offline-first;
3. a CSP teria de afrouxar;
4. o escopo global compartilhado é premissa do código atual — converter para
   `import`/`export` seria uma reescrita, não uma reorganização.

A separação em `src/` entrega a manutenibilidade sem pagar nenhum desses preços.

## O fluxo de trabalho

```bash
# 1. edite os arquivos em src/ (nunca o index.html direto)
$EDITOR src/js/32-card-engine.js

# 2. regrave o index.html
node build.mjs

# 3. verifique antes de commitar
node verificar.mjs
```

Se você já mexeu no `index.html` direto, `node build.mjs --check` vai apontar a
**primeira linha divergente** — leve a mudança para o arquivo de `src/`
correspondente (o `src/manifesto.json` diz qual faixa de linhas veio de onde).

**Commite `src/` e `index.html` juntos.** Se só um dos dois for, a CI reprova.

## O que `verificar.mjs` checa

| # | Checagem | Precisa de navegador |
|---|----------|:---:|
| 1 | `src/` monta exatamente o `index.html` publicado | não |
| 2 | cada módulo de `src/js` tem sintaxe válida isoladamente | não |
| 3 | o agendador bate com o Anki — 21.080 pontos (`testes/paridade-anki.mjs`) e sobrevive a configuração corrompida (`testes/robustez-config.mjs`) | não |
| 4 | id duplicado, tag estrutural desbalanceada, CSP íntegra, trava anti-moldura presente | não |
| 5 | o app carrega no Chromium sem **um único** erro de console | sim |
| 6 | as 14 telas navegam, `AutoTeste` passa 100%, o botão "Opções" da Grade não vaza do cabeçalho | sim |
| 7 | nenhum texto abaixo do contraste WCAG AA — nos temas claro **e** escuro | sim |

`node verificar.mjs --rapido` roda só 1–4 (segundos, sem navegador).
A CI (`.github/workflows/verificar.yml`) roda tudo em cada push e PR.

## As duas suítes de teste

### `testes/paridade-anki.mjs` — teste diferencial (Node, sem navegador)

Recorta os módulos puros (`src/js/30-fsrs.js`, `31`, `32`), roda cada um num
contexto isolado e compara **21.080 pontos** contra `testes/referencia-anki.js`
— um porte linha a linha de `fsrs-rs/src/model.rs`,
`fsrs-rs/src/parameter_clipper.rs` e `anki/rslib/.../fuzz.rs`.

Cobre três coisas distintas:

- **fórmulas** (~12.700 comparações numéricas, tolerância 1e-12);
- **comportamento que o Anki impõe acima das fórmulas** (~8.300 asserções): a
  ordem Difícil < Bom < Fácil, o piso de crescimento, os limites de S/D/intervalo,
  o "Errei" voltando ao primeiro passo;
- **limites do otimizador** (`parameter_clipper.rs`), incluindo o teto dinâmico
  de w17/w18.

Ao atualizar a referência, **traduza o Rust de novo** — nunca "ajuste até bater
com o app". Se os dois divergirem, quem está errado é o app até prova em
contrário.

```bash
node testes/paridade-anki.mjs
```

### `testes/robustez-config.mjs` — configuração que vem de fora

A tela de opções valida o que você digita. A **nuvem, um backup importado e o
armazenamento editado à mão** não validam nada. Este teste joga 12 configurações
inválidas (`learnSteps: ["abc"]`, `maxInterval: "muito"`, `retention: 0`…) contra
as 4 fases × 4 notas e exige que nenhuma produza um card com `due: "NaN-NaN-NaN"`
ou `dueTs: NaN` — um card assim **nunca mais vence**: some da fila em silêncio.

O saneamento vive em `CardsConfig._sanear()`, no funil único de leitura
(`get()` / `forDeck()`). Se você adicionar uma opção nova que entra em cálculo,
**adicione a validação dela lá** e um caso aqui.

```bash
node testes/robustez-config.mjs
```

### `AutoTeste` — suíte interna (navegador)

O próprio app carrega 164 asserções. No console do navegador:

```js
AutoTeste.rodar()     // 164 asserções: FSRS-6, fuzz, agendador, parser TEC,
                      // robustez, SM-2, filtros, gráficos, garantia de salvamento
__diag()              // erros engolidos, ids ausentes, contadores
```

Os vetores de referência do FSRS em `src/js/45-autoteste.js` foram gerados por
uma implementação **independente** (semântica de `fsrs-rs` / `py-fsrs`) e estão
congelados ali de propósito: um vetor extraído do próprio código sob teste não
testaria nada.

## Fidelidade ao Anki

O agendador replica o Anki 25.07+ (FSRS-6). Quando divergir da referência, a
referência ganha. As fontes são:

- `ankitects/anki` → `rslib/src/scheduler/states/` (`learning.rs`,
  `relearning.rs`, `review.rs`, `fuzz.rs`, `steps.rs`)
- `open-spaced-repetition/fsrs-rs` → `src/model.rs`, `src/parameter_clipper.rs`

Os pontos onde o código dá um passo além da fórmula (pisos entre os botões,
`fuzz_factor` único por resposta, tetos dinâmicos do otimizador) estão comentados
no lugar com o arquivo de origem. **Não remova esses comentários** — eles são o
que permite reconferir a paridade sem reler o Rust inteiro.

## Cor e contraste

O tema escuro **inverte tokens**, então um par de cores aprovado no claro pode
reprovar no escuro sem ninguém notar. Foi assim que o aviso flutuante ficou
branco sobre fundo claro (1,21:1 — ilegível) e o botão primário do app inteiro
ficou em 3,62:1. A checagem 7 mede os dois temas em todas as telas e reprova
abaixo do WCAG AA.

Três tokens existem justamente para isso — use o certo:

| token | para quê |
|---|---|
| `--accent` | preenchimento (fundo de botão, barra de progresso, pontinho) |
| `--accent-text` | o accent usado como **texto** sobre fundo claro/suave |
| `--on-accent` | a **tinta em cima** de um preenchimento de accent |

O mesmo padrão vale para `--bad`/`--bad-text`, `--warn`/`--warn-text`,
`--good`/`--good-text`. **Cor de preenchimento nunca vira cor de texto**: no
tema claro elas são vivas demais (o `--warn` sobre fundo rebaixado dava 2,96:1).

Cor escolhida pelo usuário (paleta de links, cores de status) não dá para
garantir por token — aí o CSS escurece o fundo (`color-mix(... 70%, #000)`) para
a tinta branca passar no pior caso da paleta.

**Todo `<button>` herda `color` da regra global.** Não declarar `color` num botão
não o deixa "neutro": sem `color: inherit` ele cairia no `buttontext` do
navegador (preto), que no tema escuro é preto sobre quase preto. Se um botão
precisa de cor própria, declare — e declare também a cor de **partida**, não só
a dos estados: o indicador de sincronização ficou em 1,14:1 porque a cor só
existia nas classes `st-*`, aplicadas depois que a nuvem responde.

## Filtros de tela

Barra de filtros nasce **recolhida** e mostra um **resumo do que está valendo**
no cabeçalho. As duas coisas juntas, sempre: recolher sem resumo esconde
informação, não ruído.

Use `PainelRecolhivel.registrar({ id, corpo, botao, texto, resumo, calcResumo })`
— o estado fica salvo por perfil. Quando o filtro mudar, chame
`PainelRecolhivel.sincronizar(id)` para o resumo não mentir.

Cuidado com **dois mecanismos de ocultar sobre o mesmo elemento**: no Desempenho
TEC, a classe `.tec-cfg` (menu ⚙ Exibição → "Filtros e configurações") aplica
`display: none !important` em toda a tela. A barra do Plano saiu dessa classe ao
ganhar painel próprio — com as duas, abrir "Mostrar ajustes" revelava um painel
pela metade.

## Regras que não se negociam

- **Sem dependência nova em tempo de execução.** O app carrega com 1 requisição.
  Supabase e SheetJS são opcionais, sob demanda, e o app funciona 100% sem eles.
- **Todo HTML de fora passa pelo sanitizador.** `sanitizeCardHtml` na entrada de
  qualquer card (editor, importação `.tsv`/`.json`, colagem). Nunca
  `innerHTML = <dado do usuário>` sem passar por `escapeHtml` ou pelo
  sanitizador.
- **Nada de `eval`, `new Function` ou `setTimeout('string')`.** A CSP barraria,
  mas o hábito é o que protege.
- **Erro engolido deixa rastro.** `catch (e) { _quiet(e, 'contexto'); }`, nunca
  `catch (e) {}`.
- **`$id()` em vez de `getElementById()`** quando o elemento pode não existir:
  ele nunca devolve `null`, então um id renomeado vira um aviso local em vez de
  derrubar a inicialização inteira.
- **Nunca `localStorage.setItem`/`removeItem` direto numa chave do perfil.** Use
  `DB._set` (valores JSON), `DB.setRaw` (texto puro) ou `DB.delRaw`. Só eles
  avisam as DUAS camadas de sincronização: o blob e a tabela por seção. Uma
  gravação direta sobe no blob mas deixa a linha da seção velha — e como a
  leitura vem das seções, o valor volta desatualizado ao abrir em outro
  aparelho. Foi assim que conclusões marcadas na grade "sumiam" no dia seguinte.
- **Nada de `location.reload()` novo.** Use `recarregarApp(motivo)`: ele espera o
  IndexedDB confirmar a gravação (um reload no meio da escrita aborta a
  transação e perde o que acabou de ser salvo — inclusive a sessão do login) e,
  para recargas que vêm de fora, espera a pessoa sair do campo ou fechar o
  diálogo. Passe `{ imediato: true }` só quando a recarga foi PEDIDA por ela.
- **Recarregar só com mudança de verdade.** `_applyMap` e `restorePayloadInto`
  devolvem quantas chaves mudaram; recarregue apenas se for maior que zero. Um
  download que traz exatamente o que já está aqui não justifica reiniciar a tela.
- **Download nunca apaga o que ainda não subiu.** Qualquer caminho novo que
  sobrescreva o armazenamento com dados da nuvem tem de chamar antes
  `SectionSync.flushBeforeRead(id)` e preservar as seções que a chamada devolver
  (é o que `SectionSync.hydrate`, `CloudStore.pullActiveAndReload` e
  `ProfileUI.enterProfile` fazem).
