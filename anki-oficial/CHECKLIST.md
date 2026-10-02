# Checklist mestre — Cards × Anki Original 26.09.3

**Fonte literal:** `anki-oficial/upstream` → `ankitects/anki@29bb700b951e3f0c0cb69b77c0180fc1fe33e6ba`.

**Inventário integral:** 2.107/2.107 arquivos.  
**Runtime funcional de Cards:** 571 arquivos.  
**Restante do repositório:** 1.536 arquivos, todos inventariados e monitorados.

## Regra de conclusão

A fonte de verdade é o upstream literal fixado em `UPSTREAM.lock.json`, combinado com o inventário integral, os contratos funcionais e testes que executam a Collection oficial. A integração atual cobre **571/571 arquivos de runtime (100%)** sem reativar scheduler, FSRS, renderer ou banco acadêmico local.

Um contrato só é considerado fechado quando o caminho observável usa a implementação oficial, possui teste reproduzível para a operação e não contém fallback silencioso para uma implementação aproximada. Relatórios derivados e contadores manuais não fazem parte da definição de pronto.

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

Base reconciliada com a main; os contratos abaixo permanecem concluídos na métrica de integração oficial.

### Migração legado → Collection oficial — 2026-10-01

Este lote fecha a transição dos Cards já existentes sem criar um segundo motor. A
Collection oficial continua sendo a única fonte de verdade acadêmica; planejamento,
matéria, assunto, banca, tipo e favorito permanecem na casca Study ligados aos IDs
canônicos devolvidos pelo Anki.

- [x] Collection vazia + Cards legados dispara migração única automática antes do reviewer, abrangendo todos os planejamentos.
- [x] Decks, NoteTypes, Notes e Cards são materializados por objetos/managers da Collection oficial; legado anterior à camada Note/NoteType recebe apenas a forma transitória necessária para ser entregue ao NoteTypeManager oficial.
- [x] Migração backend é atômica: snapshot físico da Collection é restaurado se ocorrer exceção ou mapeamento 1:1 incompleto/ambíguo.
- [x] Estado compatível é transportado sem recalcular um scheduler local: queue/type/due, interval, ease, reps/lapses, S/D, flag, suspensão/enterro e revlog com semântica Anki conhecida.
- [x] GUID existente da Note é preservado; quando o legado não possui GUID, a casca gera uma identidade determinística somente para permitir recuperação idempotente do vínculo após reload.
- [x] `anki_review_kind=0` é preservado como Learning; NoteTypes homônimos distintos não reutilizam silenciosamente a mesma estrutura durante a migração.
- [x] `card.custom_data` não é usado como banco de planejamento/banca/assunto. O campo permanece pertencendo ao contrato oficial do Anki/add-ons; compatibilidade antiga é somente leitura.
- [x] Se a Collection já foi migrada mas houve interrupção antes de todos os espelhos Study receberem `ankiId`, o bootstrap recupera o vínculo por GUID + template ordinal e falha fechado em caso ambíguo, sem remigrar a Collection.
- [x] Não existe emulação de `clear_study_queues()`: o Scheduler v3 do Anki 26.09.3 invalida/reconstrói suas filas conforme o runtime oficial.
- [x] Gates estáticos verificam ausência de CardEngine/CardsConfig/fallbacks e o smoke real com `anki==26.09.3` valida round-trip da migração, rollback, GUID, Learning revlog e preservação de `custom_data`.

Este fechamento **não altera** a métrica de certificação comportamental exaustiva
por arquivo acima. A integração arquitetural segue 571/571; certificação individual
continua exigindo evidência específica por arquivo, caso e extremo.

### Remoção das implementações locais — 2026-10-01

- [x] Removidos `30-fsrs.js`, `31-cards-config.js` e `32-card-engine.js`.
- [x] Removidos parser de busca, renderer de templates, geração de tipos, RNG, load balancer e filas da antiga camada `44-anki-parity.js`.
- [x] Removidos reset, vencimento, enterro e reparos de memória executados em JavaScript.
- [x] Prévia de CSV delegada a `Collection.get_csv_metadata()`; importação delegada a `Collection.import_csv()`.
- [x] Removidos leitores locais de pacotes e vendors sem uso (FSRS WASM, SQLite e Zstd).
- [x] Excluídos autotestes de motores removidos e verificações de WASM/ZIP que ficaram obsoletas.
- [x] As ações acadêmicas do escopo global delegam à ponte oficial; o escopo mantém somente seleção e metadados do Study.
- [x] Lote validado no CI 2011, incluindo o round-trip CSV com o Anki real e os testes de navegador atualizados. As fixtures de layout e as asserções obsoletas de FSRS local foram corrigidas antes da aprovação.

A UI ainda mantém projeções de dados oficiais para relacioná-los a planejamentos, bancas e filtros. Elas não são um segundo motor Anki; o comportamento acadêmico permanece na Collection oficial.


- [x] **Integração oficial — Scheduler / FSRS / estados / filas — 67 arquivos**
  - responder Again/Hard/Good/Easy;
  - learning, relearning, review e preview;
  - queue gather/sort/mix;
  - sibling burying;
  - fuzz;
  - load balancer / Easy Days;
  - rollover, timing, limits e learn-ahead;
  - revlog e rescheduling;
  - FSRS params, optimization, evaluation e simulator.
- [x] **Integração oficial — Card rendering / Reviewer / AV / TTS — 20 arquivos**
  - question/answer rendering;
  - filters e special fields;
  - AV tags, sound, TTS;
  - type-answer;
  - reviewer actions/shortcuts/timers.
- [x] **Integração oficial — Cloze — 1 arquivo**
  - tokenizer;
  - nested cloze;
  - multi-ordinal;
  - hints;
  - typing;
  - MathJax edge cases;
  - image-occlusion cloze generation.
- [x] **Integração oficial — Cards / Notes — 10 arquivos**
  - identidade;
  - add/update/remove;
  - flags;
  - positions/due;
  - note/card relationships.
- [x] **Integração oficial — Notetypes / templates / change type / empty cards — 21 arquivos**
  - card generation;
  - field/template mapping;
  - schema change;
  - stock notetypes;
  - empty-card detection/removal.
- [x] **Integração oficial — Decks / Deck Options / Filtered Decks / Custom Study — 65 arquivos**
  - deck tree;
  - presets;
  - parent limits;
  - filtered decks;
  - custom study;
  - every deck_config field used by scheduling/reviewer.
- [x] **Integração oficial — Search / Browser / Card Info — 50 arquivos**
  - parser completo;
  - writer/normalizer;
  - SQL semantics;
  - all operators/properties/custom data;
  - browser columns/sort/selection/actions;
  - card info.
- [x] **Integração oficial — Editor — 90 arquivos**
  - rich/plain/HTML editing;
  - formatting;
  - clipboard/data transfer;
  - history;
  - media/audio;
  - cloze;
  - MathJax/LaTeX;
  - field state and keyboard behavior.
- [x] **Integração oficial — Tags — 31 arquivos**
  - canonicalization;
  - hierarchy;
  - rename/remove/clear;
  - editor/browser interactions.
- [x] **Integração oficial — Media — 9 arquivos**
  - normalized/canonical filenames;
  - checksum/collision handling;
  - check media;
  - trash/restore;
  - serving and package I/O.
- [x] **Integração oficial — Statistics — 72 arquivos**
  - all official graph data contracts;
  - today;
  - review counts/time;
  - card counts;
  - intervals;
  - retention;
  - FSRS memory data;
  - simulator inputs/results.
- [x] **Integração oficial — Import / Export — 65 arquivos**
  - APKG/COLPKG;
  - CSV/text;
  - schema versions;
  - legacy/latest packages;
  - zstd/media metadata;
  - scheduling/revlog round-trip.
- [x] **Integração oficial — Image Occlusion — 61 arquivos**
  - shapes;
  - masks;
  - grouping/alignment;
  - zoom/pan;
  - create/edit note;
  - undo/redo;
  - keyboard/touch interactions.
- [x] **Integração oficial — Collection operations — 9 arquivos**
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
