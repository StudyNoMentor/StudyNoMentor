# Checklist mestre — Cards × Anki Original 26.09.3

**Fonte literal:** `anki-oficial/upstream` → `ankitects/anki@29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba`.

**Inventário integral:** 2.107/2.107 arquivos.  
**Runtime funcional de Cards:** 571 arquivos.  
**Restante do repositório:** 1.536 arquivos, todos inventariados e monitorados.

## Regra de conclusão

**Checklist por arquivo:** [`AUDITORIA-POR-ARQUIVO.md`](AUDITORIA-POR-ARQUIVO.md).
Ele contém os 2.107 caminhos upstream, SHAs, categorias e estados individuais.
O inventário foi comparado à Git tree oficial da referência 26.09.3 em 2026-10-01:
**2.107/2.107 blobs coincidem, sem divergências**. Os quatro submódulos internos
também estão registrados em `inventario/submodules.json`.

**Certificação individual:** `░░░░░░░░░░░░░░░░░░░░` **0/571 arquivos certificados**.
Esse número conta evidências integrais por arquivo, não recursos implementados ou
testes de categoria. O lote de marca de nota abaixo continua validado parcialmente,
mas não certifica por inteiro nenhum arquivo do Anki.

Um item só recebe **[x] PARIDADE CERTIFICADA** quando:
1. o comportamento oficial foi identificado no upstream;
2. o Cards usa a implementação oficial diretamente **ou** existe adapter cuja saída é comparada contra o Anki oficial;
3. há teste diferencial cobrindo estado, resultado, persistência e erro;
4. o teste passa para casos comuns + extremos;
5. não existe fallback silencioso para uma implementação aproximada.

Existência de botão, função ou comentário **não** conta como paridade.

## Contratos funcionais

### Integridade da fonte e do runtime — 2026-10-01

- [x] Conferidos os 2.107 caminhos, SHAs e tamanhos contra a Git tree oficial da referência congelada; nenhuma divergência.
- [x] Checkout recursivo e `--require-upstream` obrigatórios no job principal do CI; ausência da fonte oficial reprova o gate.
- [x] Gate alinha a release do inventário, o pin de `requirements.txt` e a versão declarada do backend.
- [x] Backend recusa versão instalada divergente ou ausente antes de abrir coleções; o health reporta somente a versão real validada.
- [x] Testados versão ausente/divergente, pin divergente e checkout ausente; contratos da ponte e runtime dos Cards passaram localmente.
- [x] Retirado o workflow obsoleto que tentava reconstruir o motor FSRS WASM removido.
- [x] Smoke com o pacote Anki real e todas as suítes de navegador aprovados no [CI 2011](https://github.com/StudyNoMentor/StudyNoMentor/actions/runs/36854806093), código `70a5bc2999022d5fb5c09f2b4b28db82f9cb87a2`.

Esses itens verificam integridade e rastreabilidade. Não alteram a contagem de
certificações individuais nem incorporam patches posteriores à 26.09.3.

### Continuação — 2026-10-01: marca de nota no revisor

Progresso deste lote: **4/4 verificações concluídas (100%)**. Isso não representa
o percentual de paridade integral dos 571 arquivos de runtime.

- [x] `anki_official_backend/app.py`: ação `mark` devolve as notas afetadas com tags oficiais, uma vez por nota.
- [x] `src/js/95-cards-official-bridge.js`: o revisor sincroniza essas notas, incluindo cards irmãos e réplicas entre planejamentos, sem calcular a marca localmente.
- [x] `testes/cards-official-bridge-static.mjs`: contratos estáticos e execução da ponte para marca/desmarca, estado antigo do revisor e falha de rede passaram. Checagem TTS atualizada para a assinatura com token de cancelamento.
- [x] `testes/anki-oficial-backend-smoke.py`: retorno de tags e IDs repetidos validado com o pacote real `anki==26.09.3` no CI (commit `5cc213be`).

Base reconciliada: a branch já contém `main@ae54ed3d` pelo merge `71f988e5`,
preservando a implementação Anki e a exclusão de `anki-oficial` no Pages.
Os contratos abaixo permanecem pendentes de certificação integral.

### Continuação — 2026-10-01: migração única Cards legado → Collection oficial

Progresso deste lote: **6/6 contratos implementados**. A aprovação final deste
lote depende do gate do PR; isto **não altera** a contagem conservadora de
certificação individual dos 571 arquivos upstream.

- [x] O bootstrap detecta `Collection` oficial vazia + Cards existentes e chama automaticamente `/api/cards-official/migrate/legacy`; o bloqueio manual anterior foi removido.
- [x] Decks, NoteTypes, Notes e Cards legados são materializados por `DeckManager`, `NoteTypeManager`, `Collection.new_note/add_note` e `Collection.update_card` do Anki oficial.
- [x] O UUID/local ID do Study permanece como identidade da casca; `ankiId`/`ankiNoteId` passam a referenciar as identidades canônicas geradas pelo Anki.
- [x] Estado acadêmico existente é transportado como estado inicial: queue/type/due, interval, ease, reps, lapses, steps, flags, S/D e revlog canônico quando a semântica Anki já era conhecida.
- [x] Planejamento, baralho local, matéria, assunto, matéria TEC, banca, tipo e favorito permanecem no espelho persistente do Study; a migração usa `card_map`/`note_map` para ligá-los aos IDs oficiais sem ocupar `Card.custom_data` (limitado pelo Anki a <100 bytes).
- [x] O `full-state` deixou de copiar a Collection inteira para o planejamento ativo: Notes/NoteTypes/Decks/Cards são projetados somente nos planejamentos registrados para cada card; registros sem identidade oficial não são apagados por snapshot parcial.

Os testes deste lote incluem uma Collection legada real migrada para
`anki==26.09.3`, preservação de GUID/tags/FSRS, separação explícita dos
metadados da casca e recusa de uma segunda migração sobre Collection já preenchida.

### Remoção das implementações locais — 2026-10-01

- [x] Removidos `30-fsrs.js`, `31-cards-config.js` e `32-card-engine.js`.
- [x] Removidos parser de busca, renderer de templates, geração de tipos, RNG, load balancer e filas da antiga camada `44-anki-parity.js`.
- [x] Removidos reset, vencimento, enterro e reparos de memória executados em JavaScript.
- [x] Prévia de CSV delegada a `Collection.get_csv_metadata()`; importação delegada a `Collection.import_csv()`.
- [x] Removidos leitores locais de pacotes e vendors sem uso (FSRS WASM, SQLite e Zstd).
- [x] Excluídos autotestes de motores removidos e verificações de WASM/ZIP que ficaram obsoletas.
- [x] As ações acadêmicas do escopo global delegam à ponte oficial; o escopo mantém somente seleção e metadados do Study.
- [x] Lote validado no CI 2011, incluindo o round-trip CSV com o Anki real e os testes de navegador atualizados. As fixtures de layout e as asserções obsoletas de FSRS local foram corrigidas antes da aprovação.

A UI ainda mantém projeções de dados oficiais para relacioná-los a planejamentos, bancas e filtros. Elas não são um motor Anki nem certificam todas as interações da interface. A certificação por arquivo acima continua pendente; este lote não autoriza declarar paridade integral.


- [ ] **Scheduler / FSRS / estados / filas — 67 arquivos**
  - responder Again/Hard/Good/Easy;
  - learning, relearning, review e preview;
  - queue gather/sort/mix;
  - sibling burying;
  - fuzz;
  - load balancer / Easy Days;
  - rollover, timing, limits e learn-ahead;
  - revlog e rescheduling;
  - FSRS params, optimization, evaluation e simulator.
- [ ] **Card rendering / Reviewer / AV / TTS — 20 arquivos**
  - question/answer rendering;
  - filters e special fields;
  - AV tags, sound, TTS;
  - type-answer;
  - reviewer actions/shortcuts/timers.
- [ ] **Cloze — 1 arquivo**
  - tokenizer;
  - nested cloze;
  - multi-ordinal;
  - hints;
  - typing;
  - MathJax edge cases;
  - image-occlusion cloze generation.
- [ ] **Cards / Notes — 10 arquivos**
  - identidade;
  - add/update/remove;
  - flags;
  - positions/due;
  - note/card relationships.
- [ ] **Notetypes / templates / change type / empty cards — 21 arquivos**
  - card generation;
  - field/template mapping;
  - schema change;
  - stock notetypes;
  - empty-card detection/removal.
- [ ] **Decks / Deck Options / Filtered Decks / Custom Study — 65 arquivos**
  - deck tree;
  - presets;
  - parent limits;
  - filtered decks;
  - custom study;
  - every deck_config field used by scheduling/reviewer.
- [ ] **Search / Browser / Card Info — 50 arquivos**
  - parser completo;
  - writer/normalizer;
  - SQL semantics;
  - all operators/properties/custom data;
  - browser columns/sort/selection/actions;
  - card info.
- [ ] **Editor — 90 arquivos**
  - rich/plain/HTML editing;
  - formatting;
  - clipboard/data transfer;
  - history;
  - media/audio;
  - cloze;
  - MathJax/LaTeX;
  - field state and keyboard behavior.
- [ ] **Tags — 31 arquivos**
  - canonicalization;
  - hierarchy;
  - rename/remove/clear;
  - editor/browser interactions.
- [ ] **Media — 9 arquivos**
  - normalized/canonical filenames;
  - checksum/collision handling;
  - check media;
  - trash/restore;
  - serving and package I/O.
- [ ] **Statistics — 72 arquivos**
  - all official graph data contracts;
  - today;
  - review counts/time;
  - card counts;
  - intervals;
  - retention;
  - FSRS memory data;
  - simulator inputs/results.
- [ ] **Import / Export — 65 arquivos**
  - APKG/COLPKG;
  - CSV/text;
  - schema versions;
  - legacy/latest packages;
  - zstd/media metadata;
  - scheduling/revlog round-trip.
- [ ] **Image Occlusion — 61 arquivos**
  - shapes;
  - masks;
  - grouping/alignment;
  - zoom/pan;
  - create/edit note;
  - undo/redo;
  - keyboard/touch interactions.
- [ ] **Collection operations — 9 arquivos**
  - undo/redo boundaries;
  - collection mutations used by Cards;
  - transactional behavior.

## Inventário 2.107/2.107

A lista exata, incluindo **SHA do blob oficial**, está em:

- `inventario/0001-0250.json`
- `inventario/0251-0500.json`
- `inventario/0501-0750.json`
- `inventario/0751-1000.json`
- `inventario/1001-1250.json`
- `inventario/1251-1500.json`
- `inventario/1501-1750.json`
- `inventario/1751-2000.json`
- `inventario/2001-2107.json`

O gate `testes/cards-anki-upstream-manifest.mjs` falha se qualquer item sumir, duplicar, perder categoria ou apontar para um adapter/teste inexistente.
