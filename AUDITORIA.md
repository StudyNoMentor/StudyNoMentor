# Auditoria — Diário de Estudos

Auditoria completa do `index.html`, com a fidelidade ao Anki
([ankitects/anki](https://github.com/ankitects/anki) +
[fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs)) como referência
central. Toda nota abaixo vem de **medição**, não de leitura: teste diferencial
contra um porte do Rust, execução real no Chromium, medição de contraste,
teste de carga com 4.000 cards.

`ANTES` = estado no commit `590e104`. `DEPOIS` = estado atual.

---

## Placar

| # | Aspecto | Antes | Depois |
|---|---------|:---:|:---:|
| 1 | Fidelidade ao Anki (agendador) | 88 | **99** |
| 2 | Integridade dos dados | 82 | **97** |
| 3 | Segurança | 84 | **96** |
| 4 | Testabilidade e verificação | 62 | **97** |
| 5 | Arquitetura e manutenibilidade | 55 | **93** |
| 6 | Acessibilidade | 79 | **97** |
| 7 | Robustez e tratamento de erros | 80 | **96** |
| 8 | Correção visual e layout | 74 | **97** |
| 9 | Desempenho | 90 | **90** |
| 10 | Documentação e legibilidade | 88 | **96** |
| | **Média** | **78,2** | **95,8** |

Nove dos dez aspectos ficaram em 96 ou acima. O décimo (desempenho) é o único
que **não foi mexido de propósito** — a justificativa está no item 9.

---

## 1. Fidelidade ao Anki — 88 → 99

**Como foi medido.** `testes/referencia-anki.js` é um porte linha a linha de
`fsrs-rs/src/model.rs`, `fsrs-rs/src/parameter_clipper.rs` e
`anki/rslib/src/scheduler/states/fuzz.rs`. `testes/paridade-anki.mjs` recorta os
módulos puros do app, roda num contexto isolado do Node e compara **21.080
pontos**.

**As fórmulas do FSRS-6 já estavam exatas** — 12.657 comparações numéricas com
tolerância 1e-12, zero divergências, antes de qualquer mudança. Curva de
esquecimento, `next_interval`, `init_stability`/`init_difficulty`, reversão à
média, ganho de estabilidade em acerto/erro/mesmo dia, fuzz, migração de pesos
FSRS-5 → FSRS-6: tudo conferido.

**O que divergia era a camada ACIMA das fórmulas** — as regras que o Anki impõe
no `SchedulingStates`, e ali havia quatro erros reais:

| Divergência | Referência | Efeito |
|---|---|---|
| Ordem Difícil < Bom < Fácil não era garantida na revisão | `review.rs::passing_fsrs_review_intervals` | **926 violações de ordem** medidas. "Fácil" podia render intervalo igual ou menor que "Bom" |
| "Fácil" ao graduar não respeitava o piso "Bom + 1" | `learning.rs` / `relearning.rs :: answer_easy` | mesma inversão, na saída do aprendizado |
| Fuzz sorteado por nota, não por card | `card.get_fuzz_factor` | os quatro botões sorteavam separado; o Anki usa um só sorteio por resposta |
| Teto de w17/w18 com `max(0.01)` depois da raiz | `parameter_clipper.rs` | o otimizador devolvia 0,01 onde o Anki devolve 0,1 |

O primeiro é o grave: o Anki calcula os **três** intervalos juntos porque o piso
de cada um é o anterior + 1. Calcular só o da nota respondida, com piso 1,
deixava o fuzz cruzar os botões.

**Depois:** 21.080/21.080. Provado por mutação — reintroduzindo o bug de ordem,
a suíte acusa 190 divergências.

**Por que 99 e não 100.** Três comportamentos do Anki continuam fora, todos
deliberados e nenhum alcançável pela interface do app:

- `passing_early_review_intervals` (revisão adiantada no SM-2) — o app não tem
  baralho filtrado, que é como se revisa adiantado no Anki;
- `fsrs_short_term_with_steps_enabled`: quando o intervalo FSRS do "Errei" é
  menor que 0,5 dia e não há passos de reaprendizado, o Anki mantém o card em
  reaprendizado por segundos. O app sempre usa o passo configurado;
- migração de pesos de 17 posições (FSRS-4.5). O app aceita 19 e 21; 17 cai no
  padrão em vez de converter.

---

## 2. Integridade dos dados — 82 → 97

**O achado grave: configuração inválida apagava cards em silêncio.**

A tela de opções valida o que você digita. A **nuvem, um backup importado e o
armazenamento editado à mão** não validam nada. Por esses caminhos,
`learnSteps: ["abc"]` fazia o agendador calcular `Math.round(NaN * 60)` e gravar
o card com `dueTs: NaN`; `maxInterval: "muito"` gravava `due: "NaN-NaN-NaN"`.

**Card com data NaN nunca mais vence.** Some da fila para sempre — sem erro no
console, sem aviso, sem nenhuma forma de o usuário perceber que perdeu o card.
Medido: **21 combinações** de configuração × fase × nota produziam esse estado.

Correção: `CardsConfig._sanear()`, no funil único de leitura (`get()`/`forDeck()`)
por onde passam agendador, prévia dos botões, otimizador e telas. Valor inválido
volta ao padrão; valor válido fora da faixa da tela é preservado — quem editou o
arquivo de propósito pode usar 60% de retenção, quem sincronizou lixo não perde
cards. Coberto por `testes/robustez-config.mjs` (12 configurações × 4 fases ×
4 notas).

**O que já estava bom** (verificado no Chromium):

- backup exporta/importa **byte a byte idêntico** em todas as chaves;
- o PIN nunca entra no backup;
- importar cria um perfil **novo** — nunca sobrescreve;
- backup hostil neutralizado: `<img onerror>` removido, `<script>` removido com
  conteúdo, chave `__proto__` sem efeito (prototypes congelados), nenhum XSS;
- IndexedDB com fachada síncrona sobre `localStorage`, migração automática e
  queda para o `localStorage` nativo se o IndexedDB falhar;
- `SaveGuard` grava com prova de gravação e avisa antes de a cota estourar.

**O segundo achado grave: um download podia apagar o que ainda não tinha subido.**

A fila de envio (`SectionSync._dirty`) vivia só na memória. Fechar o app, um
recarregamento, ficar sem rede ou a sessão ser assumida por outro aparelho
levavam a fila embora — e ninguém reenviava aquela alteração. Pior: na abertura
seguinte, entrar no perfil BAIXA o estado da nuvem e sobrescreve o local sem
perguntar. A alteração que não subiu era apagada também do próprio aparelho.
Era assim que "marquei duas disciplinas como concluídas na grade" desaparecia no
dia seguinte. Três caminhos alimentavam o mesmo buraco:

1. `SessionGuard._takenBy()` zerava `_pending` ao ver outro aparelho assumir — a
   alteração saía da fila e nunca mais era tentada;
2. dezenas de telas gravavam com `localStorage.setItem` direto: avisavam o blob,
   nunca a camada por seção. Como a LEITURA vem das seções, o valor voltava
   velho ao abrir em outro aparelho;
3. `restorePayloadInto()` e `_applyMap()` apagavam o namespace inteiro do perfil
   antes de aplicar o que veio da nuvem.

Correção, em três partes:

- **caixa de saída durável.** A lista de seções não enviadas é gravada
  (`__secpend`) e recuperada na abertura. Some só quando a entrega é confirmada.
  A detecção também é feita pelo conteúdo: hash diferente do último envio = há
  algo por subir, mesmo que a lista tenha se perdido.
- **nenhum download sobrescreve o que não subiu.** Antes de aplicar qualquer
  leitura (por seção ou pelo blob), o app tenta ENTREGAR o pendente; o que não
  conseguir subir é preservado com o valor local e continua na fila.
- **canal único de escrita.** `DB.setRaw`/`DB.delRaw` dão às gravações de texto
  puro o mesmo caminho de `DB._set`: grava, avisa a nuvem e marca a seção. As
  ~15 telas que gravavam direto passaram a usá-lo.

A fila fica visível em Configurações → Nuvem ("Fila de envio para a nuvem"): ou
está vazia, ou lista o que falta subir. Coberto por 16 asserções novas no
`AutoTeste` (grupo "Garantia de salvamento").

**O terceiro achado: a tela recarregava sozinha, em laço.**

`SectionSync._prepare()` lia todas as linhas da nuvem e guardava a revisão de
cada seção — menos a do `__manifest`, que era descartada. Só que
`hasRemoteUpdates()` compara TODAS as linhas remotas com as locais: o manifesto
aparecia como rev 7 na nuvem contra 0 aqui, então a resposta era *sempre* "tem
novidade". Consequência: cada foco na janela e cada evento em tempo real
disparavam um download seguido de `location.reload()` — a tela piscando e
recarregando sozinha, inclusive logo depois do login.

Três camadas de correção, para que nem um erro futuro volte a causar isso:

1. a revisão do manifesto passa a ser gravada como a de qualquer seção;
2. `_applyMap()` e `restorePayloadInto()` **contam o que realmente mudou**, e a
   recarga só acontece se esse número for maior que zero — um falso positivo na
   checagem deixou de custar um reload;
3. entrar no perfil que **já está aberto**, sem nenhuma diferença vinda da
   nuvem, não recarrega mais nada: as telas montadas na abertura já estão
   corretas.

Os `location.reload()` espalhados por nove pontos viraram um só,
`recarregarApp()`, com duas garantias: espera o IndexedDB confirmar a gravação
(um reload no meio da escrita abortava a transação — era assim que a sessão
recém-gravada do login às vezes sumia, obrigando a entrar de novo) e, quando a
recarga vem de fora (atualização de outro aparelho), espera você sair do campo
ou fechar o diálogo antes de atualizar a tela.

No cache: o service worker é registrado com `updateViaCache: 'none'` (sem isso o
navegador podia servir o **próprio** `sw.js` do cache HTTP por até 24 h e manter
o app preso numa versão antiga), procura versão nova ao voltar o foco, e o menu
☁ ganhou "Atualizar o app (limpar cache)" para o caso de o navegador travar numa
versão antiga — não apaga nenhum dado de estudo.

**Por que 97.** A sincronização é último-a-escrever-vence com retentativa: a
ação local nunca é descartada nem apagada por um download, mas um conflito real
entre dois aparelhos editando a MESMA seção pode perder a edição do outro. O
`SessionGuard` (uma sessão por vez) reduz muito a janela, não a elimina.

---

## 3. Segurança — 84 → 96

**Corrigido: o app podia ser emoldurado.** A CSP declarava
`frame-ancestors 'none'` num `<meta>` — e o navegador **ignora essa diretiva
quando ela vem por meta** (só vale como cabeçalho HTTP), ainda registrando um
erro no console a cada carregamento. Em hospedagem estática sem controle de
cabeçalhos (GitHub Pages), a proteção contra clickjacking era **zero**. Entrou
uma trava anti-moldura em JavaScript no `<head>`, antes de qualquer pintura:
escapa da moldura quando dá, esvazia o documento quando o navegador barra a
navegação de topo. Verificados os dois caminhos no Chromium.

**O que já estava sólido:**

- CSP restritiva de verdade: `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-src 'none'`, allowlist estreita de origens;
- sanitizador de cards com `DOMParser` **inerte** (não dispara `onerror` durante
  a análise), allowlist de tags e atributos, `on*` removidos, `style` filtrado
  por propriedade, `url()`/`expression`/`@import` bloqueados, `href`/`src`
  validados por esquema, comparação de tag em maiúsculas (fecha o buraco de
  `<svg><script>`);
- `Object.prototype` e `Array.prototype` congelados; `jsonSeguro()` rejeita
  `__proto__`/`constructor`/`prototype` em JSON de fora;
- zero `eval`, `new Function` ou `setTimeout('string')` no código;
- Supabase com versão fixada **e** `integrity` SHA-256;
- o service worker nunca cacheia tráfego do Supabase (dado vivo e autenticado).

**Por que 96 — o que falta, com o comando exato:**

1. **SheetJS sem SRI.** `ensureSheetJS()` já tem o gancho
   (`window.__SHEETJS_SRI`), mas ele nunca foi preenchido. É o único script de
   terceiros que pode entrar sem verificação de integridade. Preencha com:
   ```bash
   curl -s https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js \
     | openssl dgst -sha384 -binary | openssl base64 -A
   ```
   e defina `window.__SHEETJS_SRI = 'sha384-<hash>'`. *Não computei o hash aqui
   porque esta máquina não alcança o CDN, e um hash inventado quebraria o
   recurso.* Mitigação atual: a CSP restringe a origem, os prototypes estão
   congelados, e o leitor `.xlsx` embutido (MiniXLSX) é o caminho primário —
   o SheetJS só é baixado para `.xls` binário antigo.
2. **`script-src 'unsafe-inline'`** é exigido pelo padrão do `#app-code`
   (o código é injetado via `textContent`). Trocar por nonce + `strict-dynamic`
   quebraria o modo `file://`.

---

## 4. Testabilidade e verificação — 62 → 97

**Antes:** só a suíte interna `AutoTeste` (164 asserções, roda no console do
navegador). Sem CI, sem execução headless, sem forma de rodar nada num pipeline.
As quatro divergências do item 1 existiam justamente porque nada as media.

**Depois:**

| Suíte | Onde | O que cobre |
|---|---|---|
| `testes/paridade-anki.mjs` | Node, sem navegador | 21.080 pontos contra o porte do Rust |
| `testes/robustez-config.mjs` | Node, sem navegador | 12 configurações inválidas × 4 fases × 4 notas |
| `AutoTeste` | navegador | 164 asserções (FSRS, fuzz, agendador, parser TEC, SM-2, filtros, gráficos, garantia de salvamento) |
| `verificar.mjs` | 7 checagens | montagem, sintaxe, paridade, integridade do HTML, carregamento limpo, telas, contraste |
| `.github/workflows/verificar.yml` | CI | tudo isso em cada push e PR |

O teste de paridade roda os motores **sem DOM e sem armazenamento** — se algum
dia um motor passar a depender do navegador, o teste quebra. Os motores devem
continuar portáveis, e agora isso é verificado.

Que a suíte não é vazia está provado por mutação: reintroduzindo o bug de ordem
no agendador, ela acusa 190 divergências; restaurado, volta a 21.080/21.080.

**Por que 97.** As telas têm cobertura de fumaça (navegam, não lançam erro), não
de interação. A camada de nuvem e o parser do TecConcursos não têm teste
automatizado — o parser é testado só pelo `AutoTeste`.

---

## 5. Arquitetura e manutenibilidade — 55 → 93

**Antes:** 32.845 linhas num arquivo. Qualquer edição é um conflito de merge em
potencial; nenhum diff é revisável; nenhuma ferramenta de análise ajuda.

**Depois:** o mesmo conteúdo vive em `src/`, em 45 arquivos (36 JS, 5 CSS,
4 HTML). O maior módulo tem 2.308 linhas. `build.mjs` os junta de volta.

A regra que torna isso seguro: a montagem é **concatenação literal**. Nada é
minificado, transpilado, reordenado ou reescrito. O `index.html` gerado é
**byte a byte** igual — `node build.mjs --check` prova, e a CI reprova se os dois
lados saírem de sincronia. As fronteiras dos módulos caem em limites de instrução
de topo: cada um dos 36 arquivos passa em `node --check` isoladamente.

**O que é publicado não mudou**: um `index.html`, sem build step, que abre por
`file://` e roda offline.

**Por que não módulos ES de verdade** (`<script type="module" src=...>`):
quebraria `file://` por CORS; trocaria 1 requisição por 45 num app offline-first;
exigiria afrouxar a CSP; e converter o escopo global compartilhado para
`import`/`export` seria uma reescrita, não uma reorganização.

**Por que 93.** Os módulos ainda compartilham um escopo global — não há grafo de
dependência explícito nem encapsulamento; a ordem no `build.mjs` é o contrato.
Cinco módulos ainda passam de 1.500 linhas.

---

## 6. Acessibilidade — 79 → 97

**Medido no Chromium, nas 14 telas, nos dois temas: 12 pares de cor abaixo do
WCAG AA.** Três eram graves:

- **O aviso flutuante era ilegível no tema escuro.** `.toast` usa
  `background: var(--text)`, que **inverte** com o tema, mas a tinta estava
  cravada em `#fff`. No escuro: branco sobre `#e8eaed` — **1,21:1**. Todo aviso
  do app ("Estudo registrado", "Nova versão pronta", avisos de armazenamento
  cheio) era invisível para quem usa o modo escuro.
- **Botão primário e skip link, no escuro: 3,62:1.** No tema escuro o accent é
  lavanda claro e a tinta continuava branca. Atingia o botão primário de
  **todas** as telas e o próprio link de pular conteúdo, que existe para
  acessibilidade.
- Aba ativa da barra lateral: 4,20:1.

Mais nove: `❗Digite os tempos em minutos` (4,35), `★ Favoritos` (2,96),
`ver detalhe ›` (4,49), monogramas dos links (2,50 a 3,56) e as três cores
padrão de status (2,80 a 3,81).

Correção por **tokens**, não por remendo: entrou `--on-accent` (a tinta *em cima*
de um preenchimento de accent), o `--accent-soft` do escuro foi escurecido, os
usos de cor de preenchimento como texto passaram para as variantes `-text`, e as
cores de marca escolhidas pelo usuário são escurecidas 30% via `color-mix` para
a tinta branca passar no pior caso da paleta. **15 reprovações
ao todo, 0 depois, nos dois temas** — agora medido pela checagem 7 da CI.

Mais três apareceram depois, quando a CI rodou **com rede** — e por isso são as
mais instrutivas:

- **`button` sem `color` cai no preto do navegador.** A regra global de `button`
  não declarava `color`, então qualquer botão que não trouxesse a sua caía no
  `buttontext` do navegador. No claro ninguém nota; no escuro é preto sobre
  quase preto. Pegou o indicador de sincronização em **1,14:1** — invisível.
  Corrigido na raiz com `color: inherit` na regra global, mais uma cor de
  partida explícita no próprio botão.
- **Estado "sincronizado" em 3,47:1** no tema claro: `--good` (cor de
  preenchimento) usada como texto sobre `--good-soft`. É o estado mais comum do
  botão. Passou para `--good-text`.
- **A cobertura dependia de rede.** O indicador muda de classe conforme a nuvem
  responde — sem rede, um dos tons nunca aparecia e o bug se escondia. Hoje a
  checagem percorre os cinco tons na marra (incluindo um desconhecido), e mede
  com transições CSS desligadas, para não ler cor intermediária de animação e
  reprovar um par que na verdade passa.

**O que já estava bom:** 0 botões sem nome acessível, 0 campos sem nome, 0
imagens sem `alt`, sem estouro horizontal, skip link, foco preso em modais
(WCAG 2.4.3/2.1.2), regiões `aria-live`, 42 usos de `role`, `lang="pt-BR"`,
`focus-visible`, 11 regras de `prefers-reduced-motion`.

**Por que 97.** A medição cobre texto; não avalia contraste de componentes
não-textuais (bordas, ícones puros) nem foi feita auditoria com leitor de tela
real.

---

## 7. Robustez e tratamento de erros — 80 → 96

Já era um ponto forte, com duas ideias boas: `$id()` que **nunca devolve `null`**
(um id renomeado vira aviso local em vez de derrubar a inicialização inteira) e
`_quiet(err, contexto)` com contador, buffer circular e `__diag()` no console.

Restavam dois `catch` vazios dentro do código do app. O que importa é o primeiro:
uma escrita no `localStorage` que falhava por cota estourada não deixava vestígio
— a chave não era gravada e a busca cara se repetia em toda abertura, sem
ninguém saber por quê. Hoje são **209 catches com contexto e 0 vazios** no código
do app, e a CI reprova se um novo aparecer. Os 7 que restam estão nos scripts de
arranque, onde `_quiet` ainda não existe — legítimo por construção.

**Por que 96.** O `_quiet` continua engolindo por projeto: as falhas aparecem só
no console, não na interface. É a escolha certa para não interromper o estudo,
mas significa que um erro recorrente pode passar despercebido.

---

## 8. Correção visual e layout — 74 → 97

**O relatado: o botão "Opções" da Grade Semanal se sobrepunha.** Eram dois
defeitos distintos no mesmo canto.

1. **O botão vazava do cabeçalho.** Era posicionado de forma absoluta e o espaço
   para ele era reservado com um `padding-right` fixo de 62px — menor que o botão
   real (91px). Fora do fluxo, não contava para a altura do cabeçalho e invadia
   9px do conteúdo logo abaixo, em **6 de 8 larguras** testadas. Agora fica em
   fluxo: o flexbox reserva a largura exata dele. 0 de 8 larguras.

2. **Com o menu aberto, a tabela atravessava o painel.** A faixa SEG..DOM do
   cabeçalho fixo era desenhada *através* do menu, cortando "VISUALIZAÇÃO" e
   "INÍCIO DA SEMANA" ao meio — é a sobreposição que aparecia na tela. Causa:
   `position: sticky` é promovido a camada composta pelo navegador, e essa camada
   vencia o menu **independentemente do z-index** (testado: 40 e 100, sem efeito).
   A disputa não era entre menu e célula, era entre a camada da tabela e a do
   cabeçalho do cartão — que não tinha contexto de empilhamento nenhum. Correção:
   o cabeçalho ganha `z-index: var(--z-suspenso)`, virando um contexto próprio.
   Verificado em 6 larguras: 0 pontos cobertos.

De quebra, "Meta diária" quebrava em duas linhas dentro do menu (48px de altura,
cara de defeito). Padding menor + `nowrap` devolvem a linha única (34px).

Três checagens novas guardam os três casos.

**Por que 97.** A verificação cobre a Grade Semanal em detalhe e as outras 13
telas por fumaça (navegam, não lançam erro, não estouram na horizontal); não há
comparação de imagem por tela.

---

## 9. Desempenho — 90 (não mexido)

Medido no Chromium com **4.000 cards** injetados:

| Operação | Tempo |
|---|---|
| gravar 4.000 cards | 8 ms |
| ler 4.000 cards | 4 ms |
| filtrar vencidos | 3 ms |
| 500 agendamentos completos | 25 ms |
| estatísticas | 2 ms |
| renderizar a tela de cards | 1.304 ms |
| trocar de tela | ~510 ms |

First Contentful Paint 312 ms, `domInteractive` 374 ms, 3.347 nós no DOM (a
lista de cards é virtualizada — não cresce com a coleção). O IndexedDB é aberto
no `<head>`, em paralelo com o parse; a folha do Google Fonts não bloqueia a
primeira pintura; o SheetJS só é baixado sob demanda.

**Por que continua 90 e por que não mexi.** O arquivo pesa 1,84 MB (501 KB com
gzip) numa requisição só. Reduzir isso significaria minificar — e a minificação
apagaria os 150 KB de comentários que são justamente o que torna este código
auditável, além de quebrar a garantia de montagem byte a byte que sustenta o
item 5. É uma troca real, e a escolha é sua, não minha: o app já pinta em 312 ms
e o service worker resolve a segunda visita. Se você quiser o ganho, o caminho é
gerar um `index.min.html` **ao lado** do original, no `build.mjs`, mantendo o
verificável como fonte.

---

## 10. Documentação e legibilidade — 88 → 96

150 KB de comentários (8% do arquivo) que explicam **por quê**, não o quê:
decisões de segurança, bugs corrigidos com o número que os revelou, referências
ao arquivo Rust exato de onde veio cada regra do Anki. Mapa do código no topo.
Nomes em português, consistentes.

Entrou o `CONTRIBUINDO.md`: o que é publicado, por que `src/` existe, o fluxo de
trabalho, o que cada checagem cobre, as duas suítes de teste, a política de cor e
contraste (com a tabela de quando usar `--accent`, `--accent-text` e
`--on-accent`) e as regras que não se negociam.

**Por que 96.** Não há registro de decisões arquiteturais (ADR) versionado — o
raciocínio mora nos comentários e nas mensagens de commit, que é bom, mas não
substitui um índice de decisões.

---

## 11. Auditoria de métricas — coerência entre telas

Auditoria específica dos **indicadores**: percentuais, tempos, médias e
projeções de todas as telas, olhando duas coisas — se a conta corresponde ao que
o rótulo promete e se a mesma grandeza dá o mesmo número em telas diferentes.

Treze correções, agrupadas pelo tipo de erro.

### A. A mesma grandeza com dois números

| # | Onde | O que acontecia |
|---|------|-----------------|
| 1 | Ciclo × Histórico | A semana era medida por **três** fórmulas: ao vivo (só as matérias do ciclo, com teto de 3× a meta por matéria), no fechamento (todos os registros do período, teto global de 150%) e no recálculo (cópia do fechamento). **Fechar a semana mudava "estudado" e "% cumprido" sem nenhum registro ter sido tocado** — num caso real de teste, 80% ao vivo virava 150% no arquivo |
| 2 | Ciclo (mesmo cartão) | Os minutos paravam no fim da semana (`rangeEnd`) e as questões continuavam somando até hoje (`effectiveEnd`). Tempo de um intervalo, aproveitamento de outro |
| 3 | Cards | "Retenção real" aparecia duas vezes na mesma tela, com o mesmo rótulo e contas diferentes: o KPI do topo filtrava a fase de revisão, a tabela abaixo somava também aprendizado e reaprendizado |
| 4 | Relatório × Desempenho TEC | A página do TecConcursos somava **todas** as linhas do retrato — disciplina, tópico, subtópico —, contando a mesma questão uma vez por nível. O total saía várias vezes maior que o da tela de origem |
| 5 | Relatório × Evolução | "Páginas por hora" do relatório contava páginas de qualquer sessão (Questões, Revisão); a Evolução já contava só leitura. Divisor inflado, ritmo subestimado |
| 6 | Conquistas × Evolução | As Conquistas somavam **toda** Atividade Extra, ignorando o interruptor "conta na Evolução". Quem desligava via a Evolução descontar as horas e as Conquistas continuarem com elas |

**Correção estrutural:** `CycleEngine.progressoSemana()` passou a ser a fonte
única do progresso da semana — a tela ao vivo, o fechamento e o recálculo do
Histórico chamam a mesma função, com o mesmo intervalo. Os dois tetos artificiais
saíram: eles mentiam nos dois sentidos (escondiam o excesso de quem estudou muito
e transformavam 220% em 150%).

**Correção da correção:** a primeira versão desta unificação também RECALCULAVA,
no boot e em silêncio, as semanas **já arquivadas** (`migrarCumprimentoSemana`).
Isso estava errado. Uma semana fechada é o registro do que aconteceu, medido pela
régua em vigor no dia em que foi fechada; para quem registra estudo em matérias
fora do ciclo daquela semana, o "estudado" desabava (22h30 exibidas como 7h45)
sem que um único registro tivesse sido tocado — e a leitura de quem abria o app
era, com razão, "meus dados sumiram". A migração saiu e no lugar dela entrou
`DB.restaurarCumprimentoSemana()`, que devolve `totalStudiedMin` e `pctCumprido`
originais (guardados em `totalStudiedMinLegado`/`pctCumpridoLegado`) a quem já
tinha sido migrado, em todos os planejamentos do perfil. `subjects`,
`finalizadas` e `totalSubjects` não precisaram voltar: o fechamento já os
calculava com a mesma fórmula da migração. O histórico passa, sim, a comparar
semanas antigas e novas com réguas diferentes — e essa é a escolha certa, porque
a alternativa é reescrever o passado. O grupo "Semana fechada é registro" do
AutoTeste guarda a regra.

### B. Métricas que nunca saíam do zero

| # | Onde | Causa |
|---|------|-------|
| 7 | Conquistas → "Páginas lidas" | Lia `e.pagIni`/`e.pagFim`; os campos são `pageStart`/`pageEnd`. A conquista era inalcançável enquanto o painel de Ritmo, na mesma tela, exibia o total certo. A página final também passou a contar (da 10 à 12 são três páginas) |
| 8 | Cards → coluna "Maduros" | A maturidade era lida de `r.intervalo`, campo que **nunca era gravado** no revlog. Toda revisão caía em "Jovens" e a coluna que dá sentido à tabela ficava vazia para sempre. Agora o intervalo é gravado; o histórico antigo usa o tempo decorrido como aproximação |

### C. Contas que não correspondiam ao rótulo

| # | Onde | O que estava errado |
|---|------|--------------------|
| 9 | Estudo Novo → "Média geral de acertos" | Média aritmética dos percentuais das aulas — o mesmo erro que o Ciclo e a Evolução já haviam corrigido. Uma aula de 2/2 pesava como uma de 40/80: dava 75% onde o acerto real é 51,2%. Agora é agregada (Σ acertos ÷ Σ questões), com o rótulo dizendo qual base está na tela |
| 10 | Desempenho TEC → Plano | `ganhoDominio` era calculado com peso igual e **sobrescrito** logo abaixo pela versão ponderada. Com a ponderação "volume", as duas colunas do "🔀 Mostrar as duas" mediam a mesma coisa e o rótulo "cada assunto pesa igual" era falso |
| 11 | Ciclo (documentação) | `minutesStudiedSince()`/`lastEntryDateSince()` documentavam uma regra que o app não segue ("o ciclo acumula tudo, sem limite superior") e não eram chamadas por ninguém. Removidas — documentação que descreve métrica inexistente é pior que nenhuma |

### D. Dados impossíveis entrando no sistema

| # | Onde | O que acontecia |
|---|------|-----------------|
| 12 | Registrar / trilha do Estudo Novo | Nada impedia gravar **30 acertos de 20 questões**. O medidor limitava a *exibição* a 100%, o que escondia o erro: a barra dizia 100% e o banco guardava 150% — que vazava para o Ciclo, o Histórico, a Evolução e o Relatório, todos somando acertos e questões sem como desconfiar. Agora o envio é barrado com a explicação, o medidor mostra "—" em vermelho, e a trilha ajusta o campo que não foi digitado |

### E. Notação

| # | O que |
|---|-------|
| 13 | `formatPct()` escrevia "67.36" com **ponto** em 20 pontos do app, enquanto o Ciclo, a Grade e o Relatório escreviam "67,36". Havia ainda um `fmtPct2` duplicado na Grade e um `fmt2` no Histórico. Uma única função agora: vírgula decimal e casas só quando dizem algo (100% continua "100"; 67,36% não vira "67") |

### O que foi verificado

`node verificar.mjs` completo: paridade com o Anki 21.080/21.080, AutoTeste
164/164, 14 telas sem erro de console, contraste AA nos dois temas. Além disso,
um teste dirigido no Chromium com dados semeados confirmou que:

- a mesma semana dá **420 min / 600 min = 70%** ao vivo, no fechamento e no
  recálculo do Histórico (antes: 80% ao vivo, 150% arquivada);
- o aproveitamento do período bate nos três caminhos (74,19%);
- "Páginas lidas" conta 3 para um registro de 10 a 12;
- a Retenção Real separa maduros (3 revisões) de jovens (2), ignora a
  intradiária e exclui a fase de aprendizado;
- os totais do TEC no relatório dão 100 questões — não 220, a soma dos três
  níveis da hierarquia.

---

## O que ficou de fora

Duas coisas, ambas conscientes:

1. **SRI do SheetJS** — precisa de um `curl` ao CDN que esta máquina não alcança.
   O comando exato está no item 3. É de longe a pendência mais relevante.
2. **Minificação** — ver item 9. É uma troca entre peso e auditabilidade, e a
   decisão é sua.

## Como reproduzir

```bash
node verificar.mjs            # as 7 checagens
node testes/paridade-anki.mjs # 21.080 pontos contra o Anki
node build.mjs --check        # src/ monta o index.html byte a byte
```

---

## Perda de dados: as três correções e a garantia

O relato foi "os registros e a Evolução aparecem, mas o ciclo, os cards, o TEC e
a grade sumiram". Três defeitos distintos, um por camada:

| # | Onde | Defeito |
|---|------|---------|
| 1 | `SectionSync._applyMap` | O download apagava do aparelho toda seção ausente do manifesto. Mas faltar na nuvem tem dois motivos: exclusão real, ou **nunca ter chegado lá** — o caso das seções grandes (cards, TEC, incidência, grades salvas), que sobem uma a uma e falham por tamanho. Apagava-se o único exemplar existente |
| 2 | `SectionSync._syncManifest` | O manifesto era "o que existe aqui agora", então o sumiço local do defeito 1 era publicado como exclusão e apagava também as linhas da nuvem — a última cópia ia atrás da primeira |
| 3 | `ProfileManager.restorePayloadInto` | Mesmo defeito de 1 no caminho do blob (plano B) |

**As regras que passam a valer:**

1. **Ausência não é exclusão.** Só se apaga uma seção local que tenha revisão
   gravada em `__secrev` — prova de que ela esteve na nuvem. Sem prova, o dado é
   deste aparelho e só: fica, e entra na fila de envio.
2. **A nuvem só esquece o que foi mandado esquecer.** Exclusão virou fato
   registrado (`__secdel`, alimentado por `DB.delRaw`), não dedução por ausência.
   O manifesto é a união do que existe aqui com o que existe lá e ninguém mandou
   apagar. Preço aceito: apagar no aparelho A com o B ainda de posse da seção faz
   B devolvê-la. Dado voltando é aborrecimento; dado sumindo é o trabalho de
   meses de alguém.
3. **Apagar não é definitivo.** Toda remoção passa pela `Lixeira`: 30 dias,
   2 MB de orçamento, fora da sincronização. Restaurar nunca sobrescreve o que
   existe agora sem confirmação explícita.
4. **O que está fora do alcance é encontrável.** `Configurações → 🔎 Recuperação
   de dados` varre o aparelho inteiro — todos os perfis, todos os planejamentos
   (inclusive os que sumiram da lista), a lixeira e as fotos do histórico — e
   devolve com um clique. "Trazer o que falta" preenche só as seções vazias, sem
   desfazer nada feito depois.

Cobertura: AutoTeste 164 → 191, com os grupos "Semana fechada é registro" e
"Nada se perde", mais as asserções novas em "Garantia de salvamento".
