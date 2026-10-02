# Como mexer neste código

## O que é publicado

`index.html` — um único arquivo publicado. Ele é montado por `build.mjs` a
partir de `src/` e é o que o GitHub Pages serve.

**O app é cloud-first.** Os dados de estudo moram no Supabase (PostgreSQL,
tabelas `study_*`); no navegador existe só uma projeção em memória (o
`localStorage` é substituído por um shim em RAM em `src/html/90-rodape.html`).
Sem conta/sessão não há onde salvar. Ver "Persistência" abaixo.

`manifest.webmanifest` e `sw.js` são opcionais: se estiverem ao lado do
`index.html`, o app fica instalável e a **casca** abre sem internet (os dados
continuam dependendo do banco).

## O que existe para quem MANTÉM o código

`index.html` tem dezenas de milhares de linhas. Editar isso direto é onde os
erros nascem. Por isso o conteúdo-fonte vive em `src/`, separado por função:

```
src/
  html/   pedaços estruturais do documento
  css/    folhas de estilo por superfície/camada
  js/     módulos do aplicativo
```

Evite registrar contagens fixas aqui: elas mudam com a evolução do produto. A
fonte de verdade sobre quais arquivos entram no publicado é o próprio
`build.mjs`, e `testes/repositorio-higiene.mjs` garante que nenhuma fonte de
`src/` fique órfã ou seja carregada duas vezes.

`build.mjs` junta `src/` de volta em `index.html`. A montagem é uma
**concatenação literal**: nada é minificado, transpilado, reordenado ou
reescrito. O `index.html` gerado é **byte a byte** igual ao que está no
repositório — e `node build.mjs --check` prova isso.

A única coisa que a montagem **escreve** além da concatenação é o carimbo de
versão: um resumo do conteúdo de `src/`, gravado no `<meta name="diario-versao">`
do `index.html` e na linha `const VERSAO` do `sw.js`. É o que dá nome ao cache do
service worker, para que cada publicação tenha um balde próprio e o antigo seja
descartado sozinho. O resumo é calculado sobre a montagem **sem o carimbo**, para
não depender de si mesmo; `--check` recalcula, compara e falha se o `sw.js`
estiver com versão diferente da que `src/` monta.

### Por que não viramos módulos ES de verdade

`<script type="module" src="...">` seria o caminho óbvio, e foi descartado por
quatro motivos concretos:

1. o formato publicado é um arquivo único (e o app nasceu abrindo por
   `file://`, onde módulos ES são bloqueados por CORS);
2. seriam ~45 requisições em vez de 1, num app cuja abertura precisa ser rápida;
3. a CSP teria de afrouxar;
4. o escopo global compartilhado é premissa do código atual — converter para
   `import`/`export` seria uma reescrita, não uma reorganização.

A separação em `src/` entrega a manutenibilidade sem pagar nenhum desses preços.

## O fluxo de trabalho

```bash
# 1. edite os arquivos em src/ (nunca o index.html direto)
$EDITOR src/js/95-cards-official-bridge.js

# 2. regrave o index.html
node build.mjs

# 3. verifique antes de commitar
node verificar.mjs
```

Se você já mexeu no `index.html` direto, `node build.mjs --check` vai apontar a
**primeira linha divergente** — leve a mudança para o arquivo de `src/`
correspondente (o `src/manifesto.json` diz qual faixa de linhas veio de onde —
ele é **gerado pelo `build.mjs`** junto com o `index.html`, então nunca fica
desatualizado; não edite na mão).

Localmente, rode `node build.mjs` antes de commitar para manter `src/`,
`index.html`, `sw.js` e `src/manifesto.json` sincronizados. Em PRs criados
no próprio repositório, o job `sincronizar-gerados` da CI refaz esses artefatos
e os commita na branch quando necessário; a verificação seguinte exige que não
reste divergência.

## O que `verificar.mjs` checa

| # | Checagem | Precisa de navegador |
|---|----------|:---:|
| 1 | `src/` monta exatamente o `index.html` publicado | não |
| 2 | cada módulo de `src/js` tem sintaxe válida isoladamente | não |
| 3 | inventário upstream, ponte oficial dos Cards e contratos de runtime (`testes/cards-anki-upstream-manifest.mjs`, `testes/cards-official-bridge-static.mjs`, `testes/cards-runtime-anki.mjs`) | não |
| 4 | id duplicado, tag estrutural desbalanceada, CSP íntegra, trava anti-moldura presente | não |
| 5 | o app carrega no Chromium sem **um único** erro de console | sim |
| 6 | as telas principais navegam, `AutoTeste` passa e invariantes críticas de interface continuam válidas | sim |
| 7 | nenhum texto abaixo do contraste WCAG AA — nos temas claro **e** escuro | sim |

`node verificar.mjs --rapido` roda só 1–4 (segundos, sem navegador).

A CI (`.github/workflows/verificar.yml`) roda, em cada push e PR:
`node build.mjs --check`, `node verificar.mjs --rapido`, as suítes Node de
`testes/` e, no job de suítes, o `verificar.mjs` completo (1–7) e as suítes de
navegador — incluindo `testes/auditoria-correcoes-browser.mjs`. Todo arquivo
`testes/*.mjs` precisa estar referenciado na CI ou no `verificar.mjs`
(`testes/repositorio-higiene.mjs` reprova o que ficar de fora).

## Cards e fonte oficial Anki

### Atualização de versão do Anki

A rotina normal não exige editar manualmente os pins. `.github/workflows/auto-update-anki-stable.yml` detecta releases estáveis e usa `tools/update-anki-stable.mjs` para gerar a atualização. Arquivo upstream novo em área funcional nunca é classificado por aproximação: fica `UNCLASSIFIED`, o PR permanece aberto e a produção continua na release anterior até revisão explícita.

O merge automático só ocorre após a execução completa de `Verificacao` na branch gerada. O deploy Railway é então disparado por `workflow_dispatch` e validado pelo `UPSTREAM.lock.json`.


Os Cards delegam scheduling, FSRS, filas, busca, rendering e operações de
coleção ao pacote `anki==26.09.3` por `anki_official_backend/app.py` e
`src/js/95-cards-official-bridge.js`. Mudanças nesses comportamentos devem usar
as APIs oficiais e preservar os resultados na projeção do Study. A versão do
runtime é conferida antes de abrir qualquer coleção.

`anki-oficial/upstream` aponta o repositório literal `ankitects/anki`, no commit
registrado em `anki-oficial/UPSTREAM.lock.json`. Não editar os fontes desse
submódulo. Para atualizar a referência, alinhar pacote, gitlink, inventário,
contratos e testes na mesma alteração.

```sh
git submodule update --init --recursive
node testes/cards-anki-upstream-manifest.mjs --require-upstream
node testes/cards-official-bridge-static.mjs
node testes/cards-runtime-anki.mjs
python testes/anki-oficial-version.py
python -m pip install -r anki_official_backend/requirements.txt
python testes/anki-oficial-backend-smoke.py
```

O gate de inventário verifica todos os 2.107 blobs e os quatro gitlinks
internos. A opção `--require-upstream`, obrigatória no CI, recusa checkout sem
a fonte oficial. O teste de versão verifica também a recusa de runtimes
incompatíveis ou sem versão, sem exigir dependências Python externas.

O inventário, `cards-contracts.json` e as suítes oficiais são a trilha de verificação versionada. Relatórios derivados de auditoria não devem ser commitados: diagnóstico novo precisa virar teste reproduzível ou correção no contrato correspondente, evitando artefatos históricos sem efeito funcional.

O `AutoTeste` no navegador continua validando as invariantes próprias do Study.
Para diagnóstico, usar `AutoTeste.rodar()` e `__diag()`; a lista de asserções
atual vive em `src/js/45-autoteste.js`.

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

## Persistência

- **Fila durável** (`src/js/60-relational-store.js`): toda mutação de chave do
  perfil vira uma chave "suja" com o valor confirmado anterior guardado. Falha
  de rede, sessão caída ou recusa temporária **não descartam nada**: a chave
  continua pendente, é reenviada com backoff e ao voltar a rede/sessão, e o
  aviso `#rel-pending-banner` aparece. `flush()` só resolve quando tudo foi
  confirmado; `beforeunload` pede confirmação com pendência.
- **Recusa definitiva** (FK, CHECK, tipo…) não trava a fila: a linha ruim é
  isolada, a tela é realinhada com o banco e um aviso é mostrado. Na fila de
  revisões, a operação vai para a "fila morta" do `ReviewJournal`.
- **Operações que esvaziam e reconstroem** (importar Collection Package) rodam
  dentro de `RelationalStore.lote(fn)`: o estado intermediário nunca sai; no
  fim só o que mudou vai para a fila.
- **TEC/incidência** são gravados por substituição e só depois de o bloco
  pesado carregar (`DB.garantirPesado()`); antes disso a escrita é recusada.
- **Hidratação nunca passa por cima de pendência**: `hydrateProfile` tenta
  enviar primeiro e, se não conseguir, recusa com `code: 'pendencias-locais'`.
- Importações grandes usam `DB.withCardsBatch(fn)` (uma gravação no fim).

## Regras que não se negociam

- **Sem dependência nova em tempo de execução.** O app carrega com 1 requisição.
  O Supabase é obrigatório para salvar; o SheetJS é opcional, sob demanda.
- **Todo HTML de fora passa pelo sanitizador.** `sanitizeCardHtml` na entrada de
  qualquer card (editor, importação `.tsv`/`.json`, colagem). Nunca
  `innerHTML = <dado do usuário>` sem passar por `escapeHtml` ou pelo
  sanitizador.
- **Nada de `eval`, `new Function` ou `setTimeout('string')`.** A CSP barraria,
  mas o hábito é o que protege. Extensões locais e Custom Scheduling do Cards
  guardam o código, mas **não o executam** (rodariam com acesso à sessão). A
  otimização FSRS é delegada ao backend oficial.
- **Erro engolido deixa rastro.** `catch (e) { _quiet(e, 'contexto'); }`, nunca
  `catch (e) {}`.
- **`$id()` em vez de `getElementById()`** quando o elemento pode não existir:
  ele nunca devolve `null`, então um id renomeado vira um aviso local em vez de
  derrubar a inicialização inteira.
- **Nunca `localStorage.setItem`/`removeItem` direto numa chave do perfil.** Use
  `DB._set` (valores JSON), `DB.setRaw` (texto puro) ou `DB.delRaw`. Eles
  respeitam a pausa do planejamento, a Lixeira e devolvem `false` quando a
  gravação foi recusada — e a tela precisa checar esse retorno antes de
  anunciar "✓ salvo".
- **Nada de `location.reload()` novo.** Use `recarregarApp(motivo)`: ele espera o
  banco confirmar as pendências (a RAM é a única cópia do que ainda não subiu)
  e, para recargas que vêm de fora, espera a pessoa sair do campo ou fechar o
  diálogo. Passe `{ imediato: true }` só quando a recarga foi PEDIDA por ela.
- **Recarregar só com mudança de verdade.** `_applyMap` e `restorePayloadInto`
  devolvem quantas chaves mudaram; recarregue apenas se for maior que zero. Um
  download que traz exatamente o que já está aqui não justifica reiniciar a tela.
- **Download nunca apaga o que ainda não subiu.** Qualquer caminho novo que
  sobrescreva a projeção com dados do banco passa por
  `RelationalStore.hydrateProfile`, que recusa enquanto houver pendência não
  confirmada (ver "Persistência").


## O Supabase de mentira (`test/supabase-falso.mjs`)

Tudo que toca a nuvem — enviar, baixar, resolver conflito de revisão, criar
backup, aplicar a retenção, **restaurar** — era verificado por leitura. Este
módulo é a outra metade: um PostgREST de mentira, em memória, que aplica as
**constraints de verdade** — a trava otimista por `rev`, o índice único parcial
da âncora, a unicidade de `(profile_id, section)` e o isolamento por dono.

O cliente, esse **não** é de mentira. O `supabase-js` do npm bate byte a byte
com o do CDN — o mesmo hash de integridade que o `index.html` fixa —, e o
`verificar.mjs` serve esse arquivo no lugar do CDN. A biblioteca que roda no
teste é a mesma que roda em produção; por isso a versão está **pinada exata** no
`package.json`, e a própria checagem compara os dois hashes antes de começar.

A API falsa mora no MESMO servidor que serve a página, e isso é proposital: a
CSP só libera `connect-src 'self'`, então uma API em outra porta seria bloqueada
pelo navegador antes de sair. Mesma origem, nenhuma exceção aberta na CSP,
**nenhuma linha do app alterada** para poder testá-lo.
