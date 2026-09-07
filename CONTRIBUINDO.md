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
| 3 | id duplicado, tag estrutural desbalanceada, CSP íntegra, trava anti-moldura presente | não |
| 4 | o app carrega no Chromium sem **um único** erro de console | sim |
| 5 | as 14 telas navegam, `AutoTeste` passa 100%, o botão "Opções" da Grade não vaza do cabeçalho | sim |

`node verificar.mjs --rapido` roda só 1–3 (segundos, sem navegador).
A CI (`.github/workflows/verificar.yml`) roda tudo em cada push e PR.

## A suíte interna

O próprio app carrega uma suíte de testes. No console do navegador:

```js
AutoTeste.rodar()     // 139 asserções: FSRS-6, fuzz, agendador, parser TEC,
                      // robustez, SM-2, filtros, gráficos
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
