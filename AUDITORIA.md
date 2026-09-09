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

---

## 12. Auditoria de estabilidade e segurança do `main` — o backup que faltava

**A pergunta desta rodada:** existe algum caminho em que um dado deixe de existir
no mundo? Não "fique escondido", não "volte desatualizado" — deixe de existir.

As auditorias anteriores fecharam os caminhos de **sumiço**: ausência não é
exclusão, a nuvem só esquece o que mandaram esquecer, apagar passa pela Lixeira,
o que está fora do alcance é encontrável. O que sobrou foi uma classe diferente
de risco, e ela tinha três buracos.

### Buraco 1 — as três redes de segurança moravam todas no mesmo lugar

Lixeira (30 dias), Histórico de versões (7 dias, 24 fotos) e a tela de
Recuperação são excelentes, e são **todas locais**. Elas cobrem "errei e quero
desfazer aqui". Nenhuma cobre trocar de celular, formatar o computador, limpar
os dados do navegador, ou abrir o app pela primeira vez num aparelho novo.

E o banco de dados guardava **só o presente**: a linha em `study_profiles` é
sobrescrita a cada envio, e cada linha de `profile_sections` também. No lugar
mais durável de todos não havia como voltar atrás um único passo.

**Correção — `profile_backups`.** Fotos imutáveis do perfil, comprimidas em
gzip, uma linha por foto, nunca sobrescritas — a tabela é a única sem política
de `UPDATE`, para que a imutabilidade seja regra do banco e não promessa do
código. Resgatáveis de qualquer aparelho, só com a conta. Uma **âncora
permanente** (a primeira foto de cada perfil) que a limpeza automática nunca
remove, mais fotos diárias e fotos disparadas antes de cada operação de risco.
A limpeza só apaga uma linha se as quatro travas concordarem: não é a âncora,
passou do teto de 14, tem mais de 24 h, e sobram pelo menos 5. Tela em
`Configurações → Dados → ☁️ Backup no banco de dados`; SQL e runbook de resgate
em `BANCO-DE-DADOS.md`.

### Buraco 2 — dois caminhos publicavam o vazio por cima do cheio

| Onde | O que acontecia |
|---|---|
| `CloudStore.saveActive` / `_beaconSave` | `exportProfile` devolve `null` quando o perfil não está na lista local — e essa lista é um espelho da nuvem, que pode chegar incompleta (RLS negando, resposta parcial, corrida entre login e montagem do espelho). Nesse caso gravava-se **`payload: null`**: a única cópia remota de tudo virava nada, e a leitura seguinte propagava o vazio para os outros aparelhos |
| `SectionSync.pushDirty` | `localStorage.getItem(k) \|\| ''` transformava "esta chave não existe mais aqui" em "o conteúdo desta seção agora é vazio", e publicava isso por cima da linha boa. Um sumiço local — cota estourada no meio de uma gravação, limpeza do navegador pela metade — destruía a última cópia |

**As duas regras agora:** um perfil sem nenhuma seção com conteúdo **não é
publicado** (o envio é recusado, a pendência é mantida, a cópia da nuvem fica
intacta); e uma chave que sumiu **sem ordem de exclusão** sai da fila sem subir
nada — o próximo download a traz de volta. Exclusão de verdade continua sendo o
que passa por `DB.delRaw`, entra em `__secdel` e viaja pelo manifesto.

### Buraco 3 — esvaziar não deixava rastro

`delRaw` mandava para a Lixeira tudo o que era **removido**. Mas a forma mais
comum de perder uma seção nunca foi a remoção: é ela ser **reescrita como `[]`**.
Uma tela que renderiza a lista errada e salva, um filtro que zera o array antes
de gravar, uma importação parcial — em todos, o `localStorage` recebe uma
gravação perfeitamente normal e o conteúdo anterior deixa de existir.

Agora `valorVazio()` é o critério único de "aqui não há mais nada", e ele guarda
o valor anterior na Lixeira em **três** pontos que antes decidiam cada um do seu
jeito: a gravação local (`DB._set` / `DB.setRaw`), a hidratação por seção
(`_applyMap`) e a do blob (`restorePayloadInto`). Um vazio vindo da nuvem por
cima de conteúdo local também deixa rastro.

### E quando o apagamento é legítimo

Apagar é um direito de quem digitou, e nenhuma trava aqui bloqueia o usuário. O
que passa a existir sempre é a cópia: `GuardaNuvem` fotografa o **estado
anterior** antes de publicar um encolhimento de mais de 40% ou o esvaziamento de
seções que comprovadamente tinham conteúdo.

A armadilha desta trava era fotografar a coisa errada — quando ela dispara, o
apagamento já aconteceu localmente, então uma foto do estado atual registraria o
estrago. Ela fotografa o que o envio vai **substituir**: o payload que está na
nuvem naquele instante ou, se a rede não responder, a foto local mais recente do
histórico (no máximo 20 minutos anterior, portanto anterior ao apagamento).

### Segurança do banco

`BANCO-DE-DADOS.md` passa a ser a fonte única do esquema, com o SQL idempotente
das quatro tabelas e suas políticas RLS. A mais delicada é `profile_sections`:
ela não tem `user_id` próprio — o dono é o dono do perfil —, e por isso suas
políticas precisam verificar a posse por consulta a `study_profiles`, nunca
`using (true)`. O documento traz as duas queries de conferência (`relrowsecurity`
por tabela e `pg_policies` procurando permissão solta).

### O que foi verificado

- `verificar.mjs` completo no Chromium: 7 checagens, zero erro de console, 14
  telas, contraste WCAG AA nos dois temas.
- **AutoTeste 196 → 231.** Os grupos novos — "Travas contra perda" e "Esvaziar
  deixa rastro" — exercitam as regras como **funções puras**, fora da rede:
  `valorVazio`, `CloudStore._payloadUtil`, `SectionSync.decidirEnvio` e
  `CloudBackup.selecionarParaFaxina`. Uma garantia que só existe no comentário
  não é garantia; estas falham a CI se alguém as afrouxar.
- O caso "todas as fotos são de hoje" está entre os testes da faxina: a resposta
  certa é não apagar nada.

### O que continua fora

Backup automático **fora do Supabase** (uma segunda nuvem, ou um `.json`
periódico para o disco) não existe e não dá para existir sem o usuário: o
navegador não escreve em disco sozinho. O botão de exportar `.json` continua
sendo a resposta a "e se a conta do Supabase se perder?", e a tela de Dados diz
isso com todas as letras.

---

## 13. Vazamento entre contas num aparelho compartilhado

**Relatado pelo usuário:** ao logar com uma segunda conta no mesmo navegador, o
perfil da PRIMEIRA conta aparecia na lista da segunda.

**A causa não era cache.** `CloudStore.listProfiles()` já era seguro — o
Supabase só devolve os perfis da conta logada (RLS por `user_id`). O problema
era o passo seguinte: `ProfileManager.syncMirrorFromCloud()` soma a essa lista
qualquer perfil com dado FÍSICO no navegador (`perfisComDadosLocais()`), sem
nenhuma noção de qual conta é dona de cada um — a regra "quem tem dado aqui
nunca sai da lista" (item 11) não distinguia "a nuvem desta conta ainda não
trouxe" de "isto é de outra conta".

**Era mais grave do que a lista errada.** `enterProfile()` tem um caminho de
resgate deliberado: se a nuvem responde "perfil não encontrado" mas há dado
local, o app abre mesmo assim (para não trancar dados que falharam ao
sincronizar). Sem checagem de dono, clicar no perfil "vazado" da outra conta
abria os **dados inteiros** dela — registros, cards, tudo — na tela de quem
não é dono.

**Correção — dono rastreado, não dado apagado.** Um rótulo local
(`diario-estudos:owner:<id>` → `user_id`) é gravado sempre que a nuvem confirma
um perfil para uma conta, e checado nos dois pontos de risco:

1. `syncMirrorFromCloud` — um perfil local cujo dono é comprovadamente outra
   conta não entra na lista de quem loga;
2. `enterProfile` — o caminho de resgate ("nuvem não achou, mas há dado aqui")
   recusa abrir se o dono é comprovadamente outra conta, com uma mensagem
   explicando que o dado está preservado, só não é desta conta.

**Nenhum dado é apagado nem tocado** — a filtragem é só de exibição/abertura;
o namespace físico do perfil continua intacto e volta a aparecer normalmente
para a conta dona.

**Compatibilidade:** perfil sem dono conhecido (criado antes desta correção,
ou nunca sincronizado com nenhuma conta) continua visível para qualquer
conta — exatamente como sempre foi, sem regressão para quem usa uma conta só
no aparelho. A separação entre contas passa a valer para todo perfil que
passar pela nuvem a partir de agora.

Cobertura: `AutoTeste 231 → 237`, grupo "Isolamento entre contas" — testa a
função pura `_podeVerLocal` (dono próprio passa, dono alheio bloqueia, sem
dono passa) e o comportamento de `syncMirrorFromCloud` simulando duas contas
no mesmo `localStorage`.

---

## 14. Revisão do Backup no banco — concorrência, falha silenciosa e um bug de layout

**Pedido do usuário:** revisar as regras do backup no banco de dados (item
11-12), corrigir bugs de layout e garantir que a lógica não seja afetada por
outros bugs/comportamentos do app.

### Corrida na âncora — a garantia central podia quebrar sob concorrência

`CloudBackup._temAncora()` fazia "existe âncora? não → esta vira âncora" — um
ler-depois-escrever sem trava. Duas gravações simultâneas (o gatilho diário
batendo com um clique manual, ou a proteção de encolhimento disparando durante
um envio) podiam as duas checar "não existe" ao mesmo tempo e as duas virarem
âncora — quebrando exatamente a garantia "uma âncora permanente por perfil"
que o design promete. Piorando: a trava `_criando` que deveria impedir isso
era **pulada de propósito** por `opts.forcar` — usado justo pelo botão manual
e pelas proteções automáticas, os casos que mais precisavam da trava.

**Correção — o banco arbitra, não o cliente.** Um índice único parcial
(`profile_backups_uma_ancora_por_perfil`, `where ancora`) garante no banco que
nunca existem duas linhas `ancora=true` para o mesmo perfil. O cliente ainda
faz a checagem barata primeiro (acerta quase sempre), mas se perder a corrida
o INSERT leva um erro de violação de unicidade — tratado como sucesso normal
(grava como foto rolante), nunca como falha. E `_criando` virou uma fila real
por perfil (`_serializar`): `forcar` não pula mais a serialização, só pula o
atalho "idêntico à última" — a segunda chamada sempre espera a primeira
terminar antes de decidir qualquer coisa.

### Falha silenciosa em perfis grandes

Se a foto passa de 6 MB comprimidos, o envio falhava — mas isso nunca ficava
registrado em `_ultimoErro` (só erros de rede/banco ficavam). O diagnóstico em
Configurações e a própria tela do backup diziam "ativo" mesmo com o backup
automático de um perfil grande falhando **toda vez**, silenciosamente.
Corrigido: toda falha de um envio realmente tentado (grande demais, erro de
banco) agora marca `_ultimoErro`, e a tela mostra um aviso mesmo quando já há
fotos antigas na lista (de quando o perfil era menor).

### A proteção "antes de encolher" podia fotografar dado desatualizado

`GuardaNuvem._estadoAnterior()` só olhava o blob (`study_profiles`). Mas a
leitura por seção (Fase 2, item 2) trata `profile_sections` como a verdade — o
blob é só uma rede de segurança periódica e pode estar minutos atrasado.
Proteger com o blob nesse caso fotografaria um estado JÁ desatualizado, não o
que está de fato prestes a ser substituído. Corrigido: agora tenta reconstruir
o estado a partir das SEÇÕES primeiro, cai para o blob depois, e só por último
para a foto local mais recente do histórico.

### O bug de layout

A correção de CSS responsivo do histórico de versões local (`min-width:0`,
`flex-wrap`, botões com `flex-shrink:0`) foi feita só para `#cfg-vhist-body` e
nunca estendida para o card novo (`#cfg-cloudbk-body`) — que tem linhas ainda
mais longas (nota + tamanho + nome do aparelho). Confirmado visualmente a
380px de largura: o botão "Restaurar" aparecia cortado ("Restaura", "Resta") e
tudo se espremia numa linha só. Corrigido estendendo a mesma regra para as
duas telas.

### Bug relacionado, achado na mesma revisão: ids de perfil que não são UUID

Investigando um relato do usuário ("perfis com nomes antigos piscando depois
de importar e renomear um backup"), a causa raiz não era cache nem o backup no
banco — era mais fundamental: `ProfileManager.createProfile()` (usado tanto
para "novo perfil" quanto para **importar um backup**, e para o perfil padrão
de instalações novas) gerava ids como `'u_' + timestamp + random`, **não um
UUID**. Toda tabela da nuvem (`study_profiles`, `profile_sections`,
`profile_backups`) tem a coluna id/profile_id como `uuid` — um perfil com id
fora desse formato faz **toda** operação de nuvem falhar, na maioria dos
caminhos em silêncio (`SectionSync.pushDirty` engole o erro por seção e só
loga no console). Resultado: o perfil parece normal localmente (o nome muda na
hora), mas nunca sincroniza — nunca aparece em outro aparelho, nunca tem
backup no banco, e a lista de perfis "pisca" porque a nuvem nunca tem nada de
verdade para ele.

**Correção em duas partes.** `createProfile` agora usa `DB._uid()` (já
existente, usado em cards/registros — produz UUID de verdade em qualquer
navegador real): todo perfil novo, importado ou não, nasce compatível.
`ProfileManager.migrarIdsAntigos()`, chamado a cada login, promove perfis já
existentes com id antigo: cria a linha na nuvem (`createRow`, que aloca um
UUID de verdade), move o namespace local inteiro para a chave nova — copia
primeiro, só remove a antiga depois de confirmar a cópia — e enfileira o
envio, sem apagar nada em momento algum.

### O que foi verificado

`verificar.mjs` completo: 7 checagens, zero erro de console, 14 telas,
contraste WCAG AA nos dois temas. **AutoTeste 237 → 241**: a classificação de
violação de unicidade e a fila por perfil não têm teste de rede direto (função
não-pura), mas a faxina, `avaliarEncolhimento` e o classificador `idValido`
(aceita UUID de verdade, rejeita o formato antigo, confirma que
`createProfile` já nasce válido) são exercitados como funções puras. O bug de
layout foi confirmado com uma captura de tela em 380px de largura reproduzindo
o estado ANTES da correção (botão cortado) e comparando com o DEPOIS.

---

## 15. Auditoria da tela de Configurações — o backup diário que não era diário

**Pedido:** auditar de novo a tela de Configurações (vasculhar, dados, nuvem),
garantir o backup automático diário no banco que nunca se perde nem é
sobrescrito, adotar as práticas de quem faz isso a sério, e deixar só o que é
essencial — a tela tinha informação demais sobre o assunto.

### O achado grave: "diário" era, na verdade, "por carregamento de página"

O gatilho do backup diário tinha um `feito = true` que o desarmava **para
sempre** depois da primeira execução:

```js
let feito = false;
const tentar = () => { if (feito) return; …; feito = true; CloudBackup.garantirDoDia(); };
setTimeout(tentar, 9000); setInterval(tentar, 60000);
```

O `setInterval` só servia para reencontrar as condições até a primeira
execução; depois disso virava um no-op permanente. Num app que fica **aberto
por dias** — PWA instalado no celular, aba fixa no computador, que é
exatamente como um diário de estudos é usado — a virada da meia-noite passava
sem ninguém olhar. Podiam-se passar semanas sem um único backup diário, com a
tela dizendo "ativo" o tempo todo.

**Correção:** a verificação passou a ser permanente (o custo é uma leitura de
chave local, que desiste em microssegundos se a foto de hoje já existe) e
acontece também em `focus` e `visibilitychange` — o instante em que um celular
acorda depois da virada. Uma trava `_diaEmCurso` impede rajada.

### Retenção: 14 dias de histórico não é histórico

A regra era um teto simples: guardar as 14 fotos mais novas. Com uma foto por
dia, o histórico inteiro tinha **14 dias** — e essa é a forma clássica de
perder dados sem perceber. Um estrago notado três semanas depois (uma matéria
apagada por engano, uma importação que sobrescreveu o ciclo) já não teria
nenhuma foto boa: as 14 mais novas nasceram todas com o estrago dentro, e a
única sobrevivente seria a âncora, do primeiro dia.

**Correção — avô-pai-filho**, a política de Time Machine, restic, borg e
Backblaze: densa perto do presente, esparsa e longa no passado. Âncora para
sempre + as 5 mais recentes + uma por dia (14 dias) + uma por semana (8
semanas) + uma por mês (12 meses). Um ano de cobertura em ~30 linhas. As três
travas absolutas continuam por cima: âncora nunca sai, nada com menos de 24 h
sai, nunca desce de `MIN_KEEP`.

### O cartão de Recuperação estava fora das abas

`ConfigUX.init()` move cada cartão para o seu grupo com `to()` — e nenhum
`to()` movia `#cfg-recuperacao-card`. Medido no navegador: `dentroDoShell:
false`, `grupo: "FORA DAS ABAS"`, `visivel: true`. A ferramenta mais
importante para quem acha que perdeu algo ficava pendurada embaixo de todas as
seções, aparecendo em qualquer aba.

### Informação demais dizendo a mesma coisa

O grupo "Dados e backup" tinha cinco cartões, e o de "Backup em arquivo" tinha
cinco botões — três deles (`Salvar versão agora`, `Guardar cópia no banco`,
`Recalcular espaço`) apenas disparavam por baixo o clique do botão que já
existia no cabeçalho do cartão vizinho, na mesma tela. Repetir a mesma ação
com nomes diferentes a poucos centímetros de distância não é redundância
inofensiva: faz duvidar se são a mesma coisa, e é assim que alguém acha que
fez backup quando não fez.

**Correção:** os três atalhos duplicados saíram, e os cartões passaram a ser
ordenados por **força da proteção** — no servidor (automática, sobrevive a
perder o aparelho) → neste aparelho (automática) → em arquivo (manual, a única
que não depende nem do aparelho nem da conta) → resgate → medidor de espaço.
Quem chega com medo lê de cima para baixo e encontra a proteção mais forte
primeiro.

### Provar, não afirmar

"Ativo" sozinho não prova nada. O instante da última cópia bem-sucedida passou
a ser gravado em disco e exibido no diagnóstico (`última cópia 09/09 10:28`) —
um backup automático que parou de rodar fica visível ali, em vez de ser
descoberto no dia em que alguém precisa restaurar.

### O que foi verificado

`verificar.mjs` completo: 7 checagens, zero erro de console, 14 telas, WCAG AA
nos dois temas. **AutoTeste 241 → 246**, com a retenção nova travada por
testes que exercitam a propriedade central: um ano de fotos diárias é podado a
≤ 40 linhas **mantendo cobertura acima de 30 e de 180 dias**, os últimos 14
dias ficam dia a dia, a âncora sobrevive sendo a mais antiga de todas, uma
rajada no mesmo dia não apaga nada, e uma linha com data ilegível é ignorada
em vez de virar alvo silencioso. A posição de cada cartão da tela foi medida
no navegador antes e depois.

---

## 16. O que é sincronizado, chave por chave — e a configuração que não era

**Pedido:** verificar se todos os comandos, salvamentos, registros,
configurações, filtros e demais aspectos são de fato registrados no banco e não
correm risco de se perder ao abrir em outro dispositivo.

### A regra é binária, e não avisa quando é violada

Só é sincronizado o que mora dentro de `diario-estudos:u:<perfil>:`. Uma chave
fora desse prefixo é **invisível** para o SectionSync: não entra em
`profile_sections`, não entra no blob, não entra em backup nenhum, e some
quando o navegador é limpo. Não há meio-termo nem aviso — a gravação parece
funcionar perfeitamente e o dado simplesmente não viaja.

Foram extraídas do código **todas** as chaves literais `diario-estudos:*` e
classificadas uma a uma. O resultado:

| Categoria | Situação |
|---|---|
| Dados de estudo (registros, ciclos, cards, leis, trilhas, TEC, grades, links, incidência, extras, revlog…) | ✅ namespaced — sincronizam |
| Configuração de cards / FSRS, presets, contadores diários | ✅ namespaced (com migração das chaves globais antigas) |
| Preferências de tela, painéis, leitura das leis, grade | ✅ namespaced |
| Contabilidade de sync, lixeira, histórico de versões, device-id | ✅ local **de propósito** |
| Tema, tamanho de fonte, menu recolhido | ✅ local por decisão de produto (ajuste do aparelho) |
| **Metas de aproveitamento** | ❌ **chave global — nunca sincronizava** |
| **Visão da lista de registros** | ❌ chave global (única preferência de tela fora do padrão) |

### As metas de aproveitamento nunca saíam deste navegador

`AppSettings` guardava em `diario-estudos:metas` — global. São o limiar de
"bom"/"atenção" e as linhas de referência dos gráficos: alimentam `toneFor()`,
que colore o aproveitamento em **todas** as telas, e `metaRefs()`, as linhas
dos gráficos. Quem definia "bom = 88%" via o app inteiro voltar a julgar o
desempenho pela régua padrão ao abrir em outro aparelho — e nem o backup no
banco trazia de volta, porque a chave nunca chegou lá.

Errava nos três pontos ao mesmo tempo: chave global, gravação com
`localStorage.setItem` direto (sem avisar a nuvem nem marcar a seção) e cache
em memória nunca invalidado (depois de um download, a tela seguia com o valor
velho até recarregar).

**Correção**, no mesmo padrão que `CardsConfig` já usava: chave namespaced por
getter, escrita por `DB._set`, migração única do valor global antigo para
dentro do perfil, e cache amarrado à chave que o originou. Verificado no
navegador: a gravação passa a produzir `…u:<perfil>:metas`, o SectionSync a
reconhece como seção `metas` **e a marca para envio** — o passo que nunca
acontecia antes.

### A garantia virou um teste, não uma promessa

`AutoTeste 246 → 285`. O grupo novo **"Tudo entra na sincronização"** percorre
toda gravação de dado e de configuração do app — as ~21 chaves de dados do
planejamento, o índice de planejamentos, as configurações do usuário e as
escolhas de tela — e exige que cada uma caia numa seção reconhecida pelo
SectionSync. E faz a checagem na contramão também: a contabilidade de
sincronização, a lixeira e o histórico de versões **têm** de ficar de fora
(levar a fila de envio de um aparelho para outro faria o segundo achar que já
entregou o que nunca enviou).

Se alguém amanhã guardar uma preferência nova numa chave global, a suíte falha
aqui — antes de virar dado perdido de alguém.

---

## 17. Seis backups num dia, planejamentos fantasma e telas que gritavam

Achados a partir de capturas de uso real, não de leitura de código.

### Seis "backup diário" no mesmo dia

A lista mostrava, num só dia, seis fotos de 3 MB com a nota `backup diário`.
O controle de "já fiz a de hoje" era um **carimbo local** (`cbk-dia:<perfil>`).
Um carimbo local responde bem enquanto sobrevive — e ele não sobrevive a tudo:
trocar de aparelho, limpar o navegador, o id do perfil mudar (a migração para
UUID muda a chave) ou qualquer gravação que não chegue ao disco. Cada vez que
ele se perde, o app conclui "ainda não fiz a de hoje" e grava outra.

**A regra que faltava:** um trabalho agendado não pode ter como fonte da
verdade um sinalizador do cliente — a fonte da verdade é o lugar onde o
resultado é gravado. O carimbo local virou apenas um **caminho rápido** (acerta
quase sempre, custa zero consulta); quando ele não bate, quem decide é uma
consulta ao banco (`_jaTemFotoDeHoje`), que sobrevive a recarregamento, troca de
aparelho e perda da chave. Duplicar deixou de ser possível pelo lado do cliente.
E se a consulta falhar, **não grava**: uma foto a menos hoje é recuperável no
minuto seguinte; uma foto duplicada por minuto não é.

### Planejamentos fantasma com aspas no nome

A tela de Recuperação listava dois "planejamentos órfãos": `"pl_inicial"` —
**com aspas** — e `default`, cada um com 617 B. O id do planejamento entra na
composição de todas as chaves (`p:<id>:entries`, `p:<id>:cards`…): um id com
aspas renomeia todas de uma vez, e o app passa a ler e gravar em
`p:"pl_inicial":entries` enquanto os dados de verdade seguem em
`p:pl_inicial:entries`. Nada é apagado, mas as telas abrem vazias.

Corrigido no ponto certo — a **leitura** (`DB._activePlanId`) passa a sanear
aspas ao redor, o que conserta o presente e o passado de uma vez; e
`PlanManager.getActivePlanId` passou a usar a mesma leitura saneada em vez de
ler a chave crua.

### Um alarme que disparava por 617 bytes

Os dois órfãos acima continham **apenas as listas semeadas de fábrica**
(formas de estudo, fases, modos, status) — nada do usuário. Mesmo assim faziam
a tela estampar "⚠️ Há dado recuperável neste aparelho". Um alarme que dispara
sem motivo é pior que nenhum alarme: ensina a ignorar o alarme de verdade.
Agora um órfão que só tem seções semeadas não é reportado, e o histórico de
fotos parou de acender o alarme (ter uma foto com uma seção vazia é o normal —
basta não usar aquela parte do app).

### Telas que despejavam vocabulário de banco de dados

**Recuperação** abria com uma linha de jargão ("50 seção(ões) em uso · 0
perfil(is) fora da lista · 2 planejamento(s) órfão(s)…") e, logo abaixo, uma
tabela com o nome interno de cada seção (`p:pl_inicial:leis`) — que ocupava a
maior parte da tela e não responde nada a quem teme ter perdido meses de
estudo. O veredito passou a ser uma frase em português; a tabela e as chaves
legadas foram para um `<details>` recolhido, a um clique, para diagnóstico.

**Diagnóstico** tinha 13 linhas, das quais 9 eram detalhe interno (revisão
local do perfil, motor de armazenamento, tempo de inatividade…). Ele responde
a uma pergunta só — "meus dados estão salvos e sincronizados?" —, então passou
a começar por essa resposta em uma frase, seguida das quatro linhas que a
sustentam (conta, alterações à espera de envio, última sincronização, backup no
banco). O resto ficou recolhido.

Verificado: `verificar.mjs` completo, AutoTeste 285/285, zero erro de console,
WCAG AA nos dois temas. As telas foram conferidas por captura, incluindo o
caso do órfão só-com-semente, que deixou de acender o alarme.

---

## 18. Revisão de layout das três telas — o que o usuário final precisa ver

Complemento do item 17, que tinha corrigido os bugs e mexido na estrutura mas
não tinha revisado as telas populadas nem a aba de conta no estado LOGADO.

### Conta e nuvem: um cartão com sete blocos empilhados

No estado logado era um bloco só, separado por linhas horizontais: conta, fila
de envio, sessão ativa, nome do espaço na nuvem, perfil ao abrir, segurança da
sessão e outros espaços — quatro controles de configuração, seis botões e três
parágrafos explicativos. Quem abre ali quer saber duas coisas: **estou
conectado?** e **meus dados subiram?**

Ficaram visíveis a conta, a fila de envio (com "Enviar agora"/"Baixar da
nuvem") e o aparelho com a sessão. Nome do espaço, perfil ao abrir, segurança
da sessão, alterar senha e outros espaços foram para um `<details>` — ajustes
que se mexe uma vez e não se olha mais. Nenhum id foi removido: os 675 ids da
página seguem íntegros, e todo handler continua achando seu elemento.

### A lista de backups: trinta linhas quase idênticas

Com a retenção em faixas a lista chega a ~30 cópias, e elas eram praticamente
iguais — mesma nota, mesmo tamanho e mesmo aparelho repetidos linha após linha.
Repetição não informa: atrapalha achar o que interessa.

- **Agrupadas por período** (Hoje · Últimos 7 dias · Este mês · Meses
  anteriores). É assim que se procura um backup: "aquele de antes da semana
  passada".
- **O aparelho só aparece quando é outro.** "Android · Chrome" trinta vezes
  não distingue nada; `de Windows · Edge` numa linha só, sim.
- **Só os grupos recentes ficam abertos**; o resto vai para um `<details>`.
  O corte respeita grupos inteiros — nunca parte um período ao meio.
- **"Baixar" virou ícone.** Dois botões rotulados quebravam a linha e dobravam
  a altura de cada item; Restaurar é a ação principal e ficou rotulado.

### Notas que citavam nomes internos

Uma cópia aparecia como `antes de esvaziar 1 seção(ões): p:pl_inicial:extras`.
Essa nota existe para alguém ESCOLHER qual cópia restaurar, e um nome interno
não ajuda a escolher. Passou a usar o rótulo humano — "antes de esvaziar:
atividades extras". O nome interno continua no console, para diagnóstico.

Verificado por captura em 420px de largura (celular), nos dois casos: cópia
feita neste aparelho e cópia vinda de outro. `verificar.mjs` completo,
AutoTeste 285/285, 675 ids íntegros, zero erro de console, WCAG AA nos dois
temas.

---

## 19. Auditoria arquivo por arquivo — o perfil que nascia partido em dois

Varredura sistemática por classes de defeito sobre os arquivos que sustentam
dados, sincronização e segurança, com verificação em cada achado.

### O achado grave: a importação partia o perfil em dois

`CloudStore.createRow` **não aceita um id** — a coluna é `uuid primary key
default gen_random_uuid()`, então quem decide o id é o banco, e ele o devolve
em `{ id, rev }`. A importação de backup chamava `createRow` e **descartava o
retorno**:

```js
const novoId = ProfileManager.importProfile(obj, nomeFinal);   // id X, local
await CloudStore.createRow({ ..., payload: exportProfile(novoId) });  // id Y, nuvem
```

O resultado era um perfil partido em dois. O local, com o id X, ficava **mudo
para sempre**: `saveActive` e `updateMeta` só sabem fazer UPDATE, e um UPDATE
sem linha correspondente atinge zero linhas — sem erro, sem aviso, com a tela
dizendo "sincronizado". O da nuvem, com o id Y, ficava congelado no instante da
importação e aparecia como um **segundo perfil** na lista de todos os
aparelhos, com o nome de antes — porque renomear depois só mexia no local.

É exatamente o sintoma relatado em uso real: *"importei um json de backup e
mudei o nome, e agora aparecem 2 ou 3 perfis, uns com nomes antigos; quando vou
entrar aparece o nome atualizado"*. O diagnóstico anterior (ids fora do formato
UUID, item 17) era um bug real, mas não era **este**.

**Correção em duas camadas.** `ProfileManager.adotarIdDaNuvem(idAntigo, row)`
— extraída da migração de ids, que já fazia isso certo — move o namespace
local inteiro para o id do banco (copia, confere, só então apaga), troca o id
no índice, herda rev e dono e reaponta o perfil ativo. A importação passa a
usá-la. E `repararSemLinhaNaNuvem()`, no login, conserta quem **já está**
quebrado: perfil com dados aqui e sem linha lá ganha a linha e adota o id.

O reparo cria linha na nuvem, então tem trava própria: só roda com a lista da
nuvem obtida **com sucesso** (falha de rede não pode virar linha duplicada),
só para perfis com dado real, e só reivindica um perfil sem dono marcado se
este aparelho **nunca viu outra conta** — senão um perfil antigo seria
reivindicado por quem estiver logado agora.

### Um link podia virar código

`escapeHtml` protege o conteúdo de um atributo e não diz nada sobre o **esquema
da URL**: `javascript:...` num `href` executa script na origem do app, com
acesso ao armazenamento inteiro e ao token da sessão. A tela de cadastro
barrava por acidente (prefixa `https://` no que não começa com http), mas a
**importação de backup** passava — e o próprio app avisa que um backup pode vir
"de um colega, de um grupo de estudos, de um download". Cards importados já
eram saneados por isso; links não.

A trava (`DB.urlSegura`) ficou na camada de dados, valendo para todo caminho de
entrada — inclusive os que ainda não existem —, e `getLinks` neutraliza o que
já estiver guardado de antes.

### `jsonSeguro` existia e não era usado

A função que remove `__proto__`, `constructor` e `prototype` de JSON externo
estava escrita, comentada e exercitada só pelo autoteste: os dois pontos reais
de entrada de arquivo (backup de perfil e backup de cards) usavam
`JSON.parse` puro. Agora usam `jsonSeguro`.

### Três gravações que a sincronização podia derrubar

Em `49-tela-config.js`, ativar/desativar forma de estudo, fase ou modo fazia
`l.find(x => x.id === id).ativo = ativo`. Se o item tivesse deixado de existir
entre desenhar a tela e clicar — e a leitura por seção **substitui listas com
a tela aberta** —, `find` devolvia `undefined`, a atribuição lançava, e o
`DB._set` da linha seguinte **nem chegava a rodar**: a tela parecia inerte e a
alteração se perdia sem aviso. Guardadas as três, com aviso e redesenho.

### O que a varredura mostrou saudável

- **XSS**: o app escapa na ATRIBUIÇÃO da variável (`const obs = escapeHtml(...)`),
  não na interpolação — o que faz uma busca ingênua acusar centenas de falsos
  positivos. Conferidos os candidatos de texto digitado: todos escapados, e
  `UI.confirm`/`confirmTyped` escapam a mensagem inteira.
- **`JSON.parse` sem proteção**: um único caso em todo o código, e é a própria
  `jsonSeguro`, que lança de propósito para quem chama tratar.
- **Escritas fora do canal de sincronização**: todas as encontradas são
  contabilidade da própria sincronização, preferências de aparelho ou
  aplicação de dado vindo da nuvem — nenhuma é dado do usuário.

Cobertura: **AutoTeste 285 → 302**, com os grupos "Link nunca vira código"
(esquemas perigosos recusados, http/https preservados, saneamento retroativo) e
"Adota o id do banco" (o namespace é movido, o índice aponta para o id novo, o
perfil ativo acompanha, a revisão é herdada, e nada fica duplicado).

Nota de processo: a primeira versão do teste de URL continha um `</script>`
literal, que encerrava o bloco de código no HTML montado. A checagem 4 do
`verificar.mjs` pegou na hora — é para isso que ela existe.

---

## 20. O cache que nunca virava — por que "atualizar" dava bug

O relato foi direto: *"sempre que atualizamos tem gerado bugs e diversos
conflitos de login e uso"*. Não era impressão. Havia três defeitos somados no
caminho de atualização, e cada um sozinho já bastaria.

### 20.1. O nome do cache era fixo — a faxina nunca tinha o que limpar

`sw.js` abria com `const VERSAO = 'diario-v2';`. Esse valor dá nome aos dois
baldes de cache (`-app` e `-cdn`) e é o que a ativação usa para descartar o que
é velho:

```js
caches.keys().then(n => Promise.all(
  n.filter(k => !k.startsWith(VERSAO)).map(k => caches.delete(k))))
```

Como `VERSAO` era escrita à mão e não mudava entre publicações, **nenhuma chave
jamais deixava de começar com a versão atual**. A faxina rodava a cada ativação
e apagava zero. O cache de meses atrás continuava lá, com o mesmo nome do novo,
servindo ativos antigos a código novo. É exatamente a mistura que produz erro
sem explicação — inclusive em login, onde um arranque velho conversa com um
fluxo de sessão novo.

**Correção:** a versão passou a ser um resumo (SHA-256, 10 dígitos) do conteúdo
montado de `src/`. O `build.mjs` a calcula, carimba no `index.html`
(`<meta name="diario-versao">`) e reescreve a linha `const VERSAO` do `sw.js`.
Cada alteração real de código gera um nome de cache novo; o antigo passa a
falhar no `startsWith` e é descartado sozinho na ativação — sem ninguém pedir.

O resumo é calculado sobre a montagem **sem o carimbo**, para não depender de si
mesmo; assim `node build.mjs --check` reproduz o mesmo byte a byte. E o
`--check` ganhou uma trava nova: se o `sw.js` publicado estiver carimbado com
versão diferente da que `src/` monta, ele falha. Um carimbo defasado ali
significa cache com nome errado, e isso não pode passar despercebido.

### 20.2. `skipWaiting()` automático — duas versões vivas ao mesmo tempo

A instalação terminava com `.then(() => self.skipWaiting())`. O worker novo
assumia **na hora**, enquanto a aba aberta continuava executando o JavaScript da
versão anterior. Da ativação em diante, a página velha pedia recursos e recebia
os da versão nova.

É a origem clássica do "atualizei e começou a dar erro estranho": não há uma
versão errada, há **duas versões vivas** — uma na página, outra no worker.

**Correção:** o `skipWaiting()` automático saiu. O worker novo **espera**. Quem
decide a troca é o usuário, pelo aviso; ou ela acontece sozinha quando todas as
abas fecham, que é o comportamento padrão e seguro da plataforma.

### 20.3. O aviso era um toast — some antes de alguém agir

O registrador mostrava `showToast('Nova versão pronta — recarregue quando
quiser')`. Um toast dura segundos. Num app instalado que fica aberto por dias,
o resultado prático é rodar código velho por dias.

**Correção:** uma barra persistente (`.upd-bar`), que fica na tela até ser
resolvida e traz o botão que resolve — **Depois** e **Atualizar agora**. Ela não
bloqueia nada: dá para continuar usando.

A regra que sustenta a troca está no novo `src/js/67-atualizacao.js`:

> **trocar de versão nunca pode perder o que não subiu.**

Antes de recarregar, `_entregarPendencias()` chama `CloudStore.flushPending()` e
**espera** a fila esvaziar (`_pending`, `_syncing`, `SectionSync.pendingQuick()`),
com teto de 8 s. Se não der para entregar no prazo, o app **diz isso** e deixa a
escolha com quem está lá — a alteração continua salva no aparelho e na fila
depois de atualizar, mas quem decide é o usuário, não o relógio.

O recarregamento em si escuta `controllerchange` antes de mandar
`postMessage('skipWaiting')`: recarregar antes do worker assumir de fato traria
a versão velha outra vez. Há uma rede de segurança de 4 s caso o evento não
chegue, e `{ once: true }` mais uma trava `recarregou` garantem uma única
recarga.

Um caso a mais foi coberto: se **outra aba** já viu a atualização, esta abre com
`reg.waiting` preenchido e nenhum `updatefound` acontece. O registrador agora
também avisa nesse caso.

### 20.4. A saída manual, para quando ainda assim algo ficar estranho

Em Diagnóstico há um cartão novo, **↻ Atualização do app**, com duas ações:

- **Procurar atualização** — força `reg.update()` e mostra o aviso se houver
  worker esperando; senão, confirma que já está na versão mais recente.
- **Limpar cache do app e recarregar** — o botão de último recurso.

A limpeza é explícita sobre o que faz e o que **não** faz: apaga apenas os
arquivos do app guardados pelo service worker; os dados de estudo vivem no
IndexedDB e na nuvem, e não são tocados. Mesmo assim ela descarrega a fila antes
de agir. A sequência é pedir ao worker (dono dos caches), limpar também do lado
da página (cobre o caso de não haver worker ativo) e desregistrar os workers,
para que a próxima carga instale o atual do zero.

O `sw.js` passou a **responder** ao `limparCache` por `MessageChannel`. Sem
resposta, quem pediu não sabia quando podia recarregar e recarregava cedo demais,
com o cache pela metade.

A versão em execução também aparece em Diagnóstico. "Qual versão está rodando
aqui?" passou a ter resposta — que é o primeiro dado de qualquer suporte.

### 20.5. O lado da escrita: a fila de envio sobrevive?

A outra metade do pedido era garantia de que alteração do usuário **chega ao
banco**, não só ao aparelho. A varredura não encontrou caminho de gravação fora
do canal de sincronização (item 16 já havia fechado a última exceção, o
`AppSettings`). O que faltava era prova de que a fila **sobrevive**.

Ela existe em duas camadas: `_dirty`, em memória, e `__secpend`, gravada no
armazenamento; e há uma terceira prova independente das duas — o **hash** do
conteúdo: se o texto de uma seção não bate com o hash do último envio, ela mudou
depois disso, mesmo que as duas listas tenham se perdido. Os drenos periódicos
(8 s e 12 s) e os ganchos de `focus`/`online`/`visibilitychange` cuidam do resto.

Isso virou o grupo de teste **"Fila de envio sobrevive"**: gravar enfileira;
a fila é persistida; memória zerada não vê pendência; `restorePending()` a traz
de volta; conteúdo diferente do último envio é detectado como pendente; e
conteúdo idêntico **não** é reenviado à toa.

Cobertura: **AutoTeste 302 → 308**.

### Nota de layout

A primeira versão da barra usava `flex: 1 1 220px` no texto. Em telas estreitas
o container vira `flex-direction: column`, e nessa direção o `flex-basis` passa
a valer como **altura** — a barra ocupava cerca de 330 px do celular. Corrigido
com `.upd-bar .upd-txt { flex: 0 0 auto; }` na consulta de mídia, e conferido em
captura real nas duas larguras.

---

## 21. As travas que ficavam presas, e a requisição que nunca respondia

A pergunta foi se sobrava algo em estabilidade, sincronização, cache, backup,
segurança e rede. Sobrava — na camada de **rede** e nas **travas de
concorrência**, que é onde os defeitos não gritam: eles calam o app.

### 21.1. Nada tinha teto de tempo no caminho de ESCRITA

`_withTimeout` existia e cobria seis chamadas — login, criação de conta, troca
de senha, o download do perfil. As outras vinte, **inclusive todo o caminho de
escrita** (`pushDirty`, `saveActive`, o manifesto, os backups, a sessão ativa),
iam sem teto nenhum.

Uma requisição que **falha** é inofensiva: cai no `catch`, remarca a pendência e
tenta de novo. A que fica **pendurada** é o problema — e é o caso comum em rede
móvel ruim e em portal de wi-fi público, onde a conexão abre e nada volta. O
`await` nunca retornava, `_syncing` continuava `true`, e a sincronização parava
até alguém recarregar a página. A alteração não se perdia (está no
armazenamento e na fila), mas **parava de subir, sem aviso**.

A correção não foi cobrir as vinte chamadas — listas assim sempre esquecem a
próxima. Foi pôr a trava no **transporte**: `createClient` passou a receber um
`fetch` próprio, e **toda** requisição que a biblioteca fizer — leitura,
escrita, renovação de token, e as que ainda forem escritas — nasce com teto de
25 s e um `AbortController` de verdade. `Promise.race` sozinho devolveria o
controle deixando a requisição viva; o abort a encerra. Um sinal que a própria
biblioteca tenha passado (`.abortSignal()`) é respeitado e propagado.

Os 25 s são folgados de propósito: os tetos por operação (15-20 s) disparam
antes, com mensagem melhor. Este é a rede de baixo, para o que não tem teto
próprio.

### 21.2. Três marcas de "ocupado" que uma exceção deixava ligadas

`_syncing`, `_pushing` e `_applying` governam a sincronização. Todas existem
para evitar atropelo — e todas, presas em `true`, param tudo em silêncio.

**`_applying` em `SectionSync.pullAndReload`** era o pior:

```js
CloudStore._applying = true;
const r = await this.hydrate(id);   // rede, JSON, armazenamento — pode lançar
CloudStore._applying = false;       // ← pulada pela exceção
```

`_applying` existe para que gravar o que VEIO da nuvem não dispare um envio de
volta, em eco. Presa em `true`, ela faz `notifyChange()` **devolver na primeira
linha** — e toda alteração seguinte deixa de virar pendência. A fila por seção
continua andando (é marcada por outro gancho, e foi o que impediu que isso
virasse perda de dado), mas o blob de segurança congela no que era antes, e a
checagem de novidade da nuvem para. Sem erro, sem aviso.

**`_pushing` em `pushDirty`** tinha a mesma forma. Entre ligar e desligar há
`_savePend()` e `_saveRevs()`, que gravam no armazenamento e **lançam com o
disco cheio** — situação que este app alcança, tanto que tem faxina para ela.
Uma vez presa, `pushDirty` passava a devolver na primeira linha para sempre: a
fila crescia e nada mais subia.

**`_syncing` em `autoSave`** já tinha `catch`, mas a linha
`CloudUI.setStatus('syncing', …)` ficava **fora** do `try`.

Correções:

- `CloudStore.aplicando(fn)` — liga a marca, desliga em `finally`, e **restaura
  o valor anterior** em vez de forçar `false`, para que uma aplicação aninhada
  não desligue a de fora antes da hora.
- `pushDirty` virou um invólucro fino (`try { await this._enviarSujas(id) }
  finally { this._pushing = false }`) com o corpo em método próprio — assim o
  `finally` cobre tudo sem reindentar 70 linhas.
- `autoSave` ganhou `finally`, e o `setStatus` entrou no `try`.

E, como terceira camada, um **cão de guarda**: um envio "em curso" há mais de
60 s é considerado preso e destravado. `finally` cobre exceção; o cão de guarda
cobre o que nem exceção lança — uma promessa que simplesmente nunca se resolve.

### 21.3. O service worker que, em conexão lenta, nunca atualizava

`redePrimeiro` corria a rede contra um relógio de 3 s. Perdida a corrida,
servia o cache — e **descartava** a resposta da rede quando ela chegava. Numa
conexão lenta, isto é permanente: **toda** carga passa dos 3 s, **toda** carga
serve o cache, e **nenhuma** o atualiza. O app fica preso numa versão antiga
indefinidamente — justamente para quem tem a pior rede.

Agora a busca continua correndo depois de perder a corrida e é ela quem grava
no cache, dentro de um `waitUntil` (sem ele o navegador pode encerrar o worker
assim que a resposta é entregue, e a gravação morre no meio). A mesma proteção
foi dada à revalidação das fontes.

`cachePrimeiro` deixou de guardar resposta **opaca**. Opaca é status 0 com corpo
ilegível: numa estratégia "cache primeiro" ela seria servida para sempre. As
bibliotecas que passam por ali (Supabase, planilhas) são pedidas com
`crossorigin` e SRI, então uma resposta opaca só pode ser falha — não cachear
custa uma nova tentativa; cachear custaria o app sem nuvem até limpar o cache
à mão.

### O que ficou conferido e saudável

- **Roteamento do service worker**: `POST/PUT` nunca são cacheados, e todo
  tráfego `*.supabase.co` passa direto, sem tocar em cache — dado vivo e
  autenticado não corre risco de ser servido velho.
- **Salvamento de emergência** (`_beaconSave`): usa `fetch` cru com `keepalive`
  de propósito, e fica **fora** do teto de transporte — abortar por tempo numa
  página que está fechando seria cancelar a última chance de entrega. Mantém a
  trava de revisão (`rev`) e a recusa de payload vazio.
- **Fila de envio**: `_serializar` encadeia com `.then(fn, fn)` e nunca trava a
  fila por uma falha; com o teto de transporte, toda operação agora termina.
- **Segurança**: CSP restritiva com `object-src 'none'`, `frame-src 'none'` e
  `base-uri 'self'`; as duas bibliotecas de CDN com `integrity` fixado; a chave
  publicável do Supabase é a que deve estar no cliente, e o que protege os dados
  são as políticas de RLS por dono, conferidas nas três tabelas.

Cobertura: **AutoTeste 308 → 317**, com o grupo "Travas não ficam presas" — que
prova as correções do jeito que importa: fazendo a operação **falhar** e
conferindo que a marca ficou livre, que o envio preso é destravado, que toda
requisição nasce com sinal de cancelamento, e que é a criação do cliente que
entrega o `fetch` com teto à biblioteca.

---

## 22. A gravação que o disco recusava — e ninguém ficava sabendo

Este é o achado mais sério de todas as rodadas, e estava escondido justamente
onde a auditoria tinha menos motivo para olhar: na peça que faz o app inteiro
funcionar sem ter sido reescrito.

### O que a fachada faz — e o que ela não fazia

O app foi escrito sobre a API **síncrona** do `localStorage`. Para ganhar a cota
do IndexedDB (centenas de MB em vez de ~5 MB), há uma fachada que imita aquela
API: `setItem` grava num cache em memória e **volta na hora**, enquanto a
gravação real no IndexedDB acontece depois, em lote.

O tratamento de cota em `DB._set` — o que mostra "armazenamento cheio, este dado
NÃO foi salvo" — está num `try/catch` em volta do `setItem`. Só que **o
`setItem` da fachada nunca lança**. Quem lança é a transação, depois, em outro
contexto. Ou seja: no caminho normal do app, **aquele aviso jamais poderia
disparar**. Ele protegia apenas o caso raro de o app ter caído no
`localStorage` nativo.

E o que acontecia quando a transação falhava — cota estourada, disco cheio,
conexão fechada por um `versionchange`, ou a própria abertura da transação
lançando?

```js
var ops = queue; queue = [];              // saem da fila ANTES de gravar
...
catch (e) { flushing = false; return; }   // ops descartadas
tx.onerror = function () { flushing = false; avisarDisco(); };   // ops descartadas
```

O lote **sumia**. O cache em memória continuava com o valor. A tela continuava
mostrando o valor. A pessoa continuava estudando. E o dado só deixava de existir
**na abertura seguinte**, sem um único erro em nenhum ponto do caminho.

É o modo de perda mais traiçoeiro que existe, porque nada parece errado até ser
tarde demais — e é indistinguível, para quem usa, de "o site perdeu meus dados".

### O que passou a acontecer

1. **O lote volta para a fila.** Em toda falha — a abertura da transação, o
   `onerror` e o `onabort` — as operações são devolvidas, e a ordem é
   preservada: elas entram **na frente** das que chegaram depois, então uma
   gravação mais nova para a mesma chave continua vencendo.
2. **Retentativa com espera crescente** (400 ms, 2 s, 8 s). A maior parte das
   falhas reais é transitória.
3. **Esgotadas as tentativas, o app é avisado** — `window.__idbFalhouAoGravar`,
   a ponte para `DB.aoFalharGravacaoLocal`. E aí a informação chega a quem pode
   agir: um aviso direto sobre o que está em jogo ("o que está na tela ainda não
   está salvo AQUI"), contido a um por minuto para não virar enxurrada.
4. **A nuvem é acionada na hora.** Se o disco local recusou, a cópia que importa
   passa a ser a da nuvem: toda recusa força um `flushPending()` — a cada
   recusa, não só na primeira, porque é o envio que de fato põe o dado a salvo.
5. **A fila NÃO é descartada** ao desistir. Qualquer gravação seguinte dispara
   nova rodada, e se o disco voltar o que está lá ainda entra. Descartar seria
   repetir de propósito a perda que este bloco existe para impedir.

O aviso antecipado (`checarEspaco`, que avisa em 85% da cota) continua sendo a
primeira linha de defesa — ele age **antes** do estouro. Esta correção é a
segunda: para quando o estouro acontece assim mesmo.

Cobertura: **AutoTeste 317 → 323**, com o grupo "O disco que recusa gravação":
a ponte existe, a recusa avisa quem está usando, força a subida para a nuvem,
avisos repetidos são contidos, a subida é tentada em toda recusa, e uma recusa
sem nuvem disponível não derruba nada.

---

## 23. Revisão profunda do cache — sete defeitos, e um que só a medição revelou

Pedido: trazer para o cache o que houver de mais avançado, com segurança de não
gerar problema. A parte "com segurança" mudou o método: em vez de confiar na
leitura, o `sw.js` passou a ser **executado num navegador de verdade** dentro da
suíte (checagem 6.6) — instala, guarda, é interrogado, e a página é aberta
**offline** para provar que o que ficou guardado abre. Foi assim que o defeito
mais grave apareceu, e ele não estava visível em nenhuma linha.

### 23.1. O pré-carregamento guardava a casca VELHA

`cache.add(url)` faz uma busca com o modo de cache **padrão** — ou seja, pode
ser atendida pelo **cache HTTP do navegador**. Na prática: o worker da versão
NOVA instalava e guardava, no próprio balde, o `index.html` **ANTIGO** que o
navegador ainda tinha guardado. O app abria com a casca velha achando que estava
atualizado.

É o oposto exato do que o arquivo inteiro existe para garantir. A correção é uma
palavra: `new Request(u, { cache: 'reload' })`, que obriga a ida à rede.

### 23.2. O balde de bibliotecas era jogado fora a cada publicação

`CACHE_CDN` carregava a versão do app no nome. Como a faxina de ativação apaga
tudo que não é da versão atual, **toda publicação descartava o Supabase, o
SheetJS e as fontes** — obrigando a rebaixá-los exatamente no pior momento:
logo depois de atualizar, com a rede já ocupada. Num aparelho com rede ruim,
isso é o app abrindo sem nuvem.

Aquelas URLs são **imutáveis** (a versão da biblioteca está na própria URL), então
o conteúdo não pode ficar velho e não há motivo para descartá-lo. O balde passou
a se chamar `cdn-imutavel-v1`, fora do ciclo de versões, com teto próprio de 60
entradas (a Cache API devolve as chaves na ordem de inserção, então as mais
antigas saem primeiro) — sem isso, trocas de biblioteca ao longo dos anos o
fariam crescer sem fim.

### 23.3. Cada endereço guardava outra cópia de 2 MB

A casca era guardada sob a URL do pedido. `…/`, `…/index.html`, `…?utm=x` —
três entradas, três cópias de ~2 MB, e o retorno offline dependia de acertar
exatamente o mesmo endereço da vez anterior. Agora toda navegação escreve e lê
uma **chave canônica** (`./index.html`). A suíte prova as duas metades: offline
pelo endereço normal, e offline com query string.

O `match` da casca usa `ignoreVary: true`: se a hospedagem responder com um
`Vary` que não bate na comparação, a cópia boa existiria e ainda assim não seria
encontrada — o app diria "sem conexão" com a resposta a um passo.

### 23.4. Pré-carregamento de navegação (o que faltava de moderno)

`navigationPreload` faz o navegador disparar o pedido do documento **em
paralelo** com o despertar do worker. Sem ele, toda navegação com o worker
dormindo paga a inicialização antes de a rede sequer começar. Ligado na ativação
e consumido na navegação (ignorá-lo faria o navegador cancelá-lo e reclamar).

### 23.5. Duas recusas novas no que pode ser guardado

- **`no-store`** passou a ser respeitado: é o servidor dizendo explicitamente
  para não guardar.
- **Resposta opaca** (status 0, corpo ilegível) só é aceita onde é normal: o
  `<link>` do CSS das fontes vai sem `crossorigin`, então ali o opaco é natural
  e a estratégia se autocorrige revalidando. Em "cache primeiro", opaco só pode
  ser falha — e ficaria servido para sempre, deixando o app sem nuvem até alguém
  limpar o cache à mão.

### 23.6. O `waitUntil` que chegava tarde

As gravações no cache eram mantidas vivas por um `waitUntil` registrado **depois**
de um `await` — quando o evento já podia ter sido encerrado. Agora há **um único**
`waitUntil`, registrado de forma síncrona, cobrindo a busca **e** a gravação que
ela dispara.

### 23.7. O defeito que só a medição revelou: a troca que não acontecia

Com o worker exercitado de verdade, o teste falhou num ponto inesperado: depois
de `postMessage('skipWaiting')`, o worker novo **continuava esperando** e o
antigo seguia no comando. Medindo, o número apareceu: **24 segundos** até a
troca — e, sem teto de tempo nas buscas do worker, às vezes ela simplesmente
não acontecia.

A causa: **uma requisição em aberto mantém o worker OCUPADO**, e o navegador não
o encerra enquanto isso. Rede ruim é exatamente quando alguém aperta "Atualizar
agora" — e era exatamente quando não acontecia nada.

Duas correções:

1. **Toda busca do worker tem teto** (`AbortController`, 20 s). Corrida de
   promessas não serve aqui: ela devolve o controle mas deixa o pedido vivo, que
   é justamente o que precisa acabar.
2. **O pedido de troca é repetido**, a cada 600 ms. A versão anterior pedia UMA
   vez e recarregava cegamente em 4 s — o pior resultado possível: a página
   recarregava com o worker ANTIGO ainda no comando, a mesma versão voltava e o
   aviso reaparecia. É literalmente o "atualizei e não mudou nada". Insistindo,
   a troca acontece no instante em que o worker antigo fica livre; o teto passou
   a 12 s de espera de verdade, com o botão dizendo "Atualizando…".

### 23.8. "Qual versão está rodando aqui?" agora tem resposta completa

O worker responde à pergunta `versao`, e o Diagnóstico compara com a versão da
**página**. Enquanto as duas coincidem, está tudo bem; o desencontro é que
produz o erro sem explicação — e agora ele é dito em uma linha, com o remédio ao
lado.

### As travas que passam a guardar tudo isso

Checagem **4.5** (estática, sem navegador): o `sw.js` analisa; a versão é um
carimbo de conteúdo e não um nome fixo; o balde de CDN não é versionado; o
pré-carregamento usa `cache: 'reload'`; o pré-carregamento de navegação está
ligado; o Supabase passa direto; só GET é cacheado; **o `skipWaiting` automático
não voltou para a instalação**; e os carimbos do `index.html` e do `sw.js`
batem.

Checagem **6.6** (navegador real): instala e ativa; um único balde de versão; a
casca na chave canônica; o worker responde a própria versão; offline abre a
casca certa; offline com query string também; **a versão nova instala e espera**;
quem serve a página continua sendo a antiga até haver ordem; a troca descarta o
balde anterior; e o balde imutável de CDN sobrevive à publicação.

Cada uma dessas linhas é uma decisão que custou caro para descobrir. Escrita
como teste, ela não se perde na próxima alteração.
