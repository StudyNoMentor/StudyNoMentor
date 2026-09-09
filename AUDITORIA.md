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
