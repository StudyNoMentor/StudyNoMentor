# Consolidação de branches — Cards / Anki Oficial

Data: 2026-10-01. Base auditada: `b1256a40194aea0f15e24dc6525427edbe1335b2`.

Foram comparadas as 58 branches disponíveis. Para as branches divergentes de Cards e interfaces relacionadas, foram inspecionados 291 commits exclusivos e suas alterações, além dos blobs atuais. Ahead/behind mede ancestralidade; squash pode deixar uma branch divergente mesmo quando seu conteúdo já foi incorporado.

## Mudanças aproveitadas

- Health da branch `fix/anki-official-health-source-rev-20261001`: revisão real Railway prioritária, branch de origem e testes. `source_main` identifica a main cujo conteúdo foi publicado, separadamente do commit de publicação.
- Smoke adicional de `feat/cards-anki-upstream-parity-20260930`: FSRS S/D, GUID, tags, flags, revlog completo (inclusive Learning), recusa de remigração, ordinais de reverso/Cloze e NoteTypes homônimos. Foram acrescentados os cenários ausentes sem remover testes mais recentes.
- Preservação integral do PR #296: reparo de templates stock duplicados, validação oficial, resposta HTTP 422 e rollback físico. Acrescentado teste de tipo customizado inválido.
- Sincronização de produção recupera a finalidade dos commits DEPLOY_REVISION, preserva o histórico divergente e publica a árvore atual da main com um único marcador gerado. Não usa force push. Teste real com repositórios locais cobre divergência, árvore, ancestrais e idempotência.
- O workflow verifica `/health` até confirmar versão e main publicada; sincronizar uma branch sem atualizar o serviço passa a ser falha explícita.

## Diagnóstico de produção antes da mudança

Railway: projeto `studynomentor-anki-official`, serviço `anki-official`, ambiente `production`. Deploy ativo `5fb85ee1-2b56-4d37-8917-cc9d5ffe2d1f`, commit `d34e966a445b917f4a85c4702cef56dd4591ab53`.

Os logs de 2026-10-01 mostram GET status/state 200 e POST migrate/legacy 500 com `CardTypeError`: a frente do segundo template de Basic (and reversed card) era idêntica à primeira. O navegador reduzia a resposta sem CORS a Failed to fetch. O reparo estava na main, mas não no deploy ativo.

## Destino por branch

| Branch | Head auditado | Ahead / behind | Destino |
|---|---|---|---|
| `audit/cards-anki-6000-365d-20260921` | `3d037a769444` | 24 / 790 | Artefatos de auditoria já preservados quando compatíveis. Simulação do scheduler local substituída por smoke do pacote oficial; não tratar antigos relatórios como certificação atual. |
| `backup-main-before-restore-69ac2f5-2026-09-16` | `211b13b9defe` | 89 / 1339 | Arquitetura TEC/companion anterior à restauração, sem contrato com o runtime atual. Preservada na branch; não reintroduzir módulos removidos, migrations ou workflows temporários neste PR de Cards/Anki. |
| `claude/anki-json-fidelity-audit-lnj2l6` | `a1ba7d1db49f` | 0 / 419 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `claude/carga-horaria-pendente-53fg6b` | `566ace7c1496` | 0 / 418 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `claude/paused-planning-view-wf5i3j` | `87512d86a0a1` | 3 / 399 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `claude/planning-pause-custom-date-04zbgq` | `3225118ca288` | 2 / 421 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `claude/study-generic-audit-5ailxt` | `27e023287777` | 0 / 405 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `claude/weekly-cycle-edit-flow-k5hf7u` | `2ff5bf3f4af8` | 1 / 403 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `claude/weekly-grid-redesign-0ojeni` | `ab21e2499c2f` | 0 / 400 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `feat/anki-official-engine-20260923` | `099fd6982219` | 2 / 1 | Branch de publicação; marcador exclusivo preservado como histórico. Sincronização substituída por árvore da main + revisão, commit com dois pais e push normal. |
| `feat/cards-anki-upstream-parity-20260930` | `4a963e4cc554` | 20 / 54 | Migração e separação de metadados já integradas; recuperados testes ausentes de FSRS/revlog/GUID, reverso/Cloze e tipos homônimos. Mantidos snapshot/rollback e reparo do PR #296. |
| `feat/cards-multiselect-filters-20260926` | `a5a3f79d1801` | 9 / 394 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `feat/ciclo-importar-outro-planejamento-20260923` | `16dbc16e6c2f` | 3 / 472 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `feat/copy-grade-law-between-plans-20260923` | `27ec351a2f64` | 0 / 474 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `feat/global-study-scope-banca-motor-20260923` | `e4855348e9ba` | 0 / 505 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `feat/pause-planning-20260923` | `1422d0b1fca6` | 15 / 462 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `feat/registrar-molduras-roxas-20260926` | `29ef3db5e12e` | 1 / 398 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `feat/toggle-anki-menu-20260923` | `f356188a76dc` | 4 / 522 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/anki-10of10-usability-20260930` | `40c6a423d092` | 0 / 300 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `fix/anki-official-health-source-rev-20261001` | `7ffcd964908a` | 2 / 2 | Recuperado: source_rev/source_branch no health e teste; acrescentada rastreabilidade source_main. |
| `fix/anki-official-production-fast-forward-20261001` | `174efec752a3` | 0 / 4 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `fix/anki-usability-parity-20260930` | `6294dc58123d` | 0 / 321 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `fix/banca-dropdown-hidden-state-20260923` | `76186ff1fb19` | 3 / 454 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/cards-all-types-edit-change-audit-20260930` | `b7b8e6875ea0` | 0 / 363 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `fix/cards-anki-26093-edit-parity-20260930` | `56d68c81f975` | 2 / 361 | Semântica compatível já migrada para 95-cards-official-bridge, editor e endpoints oficiais. Não restaurar CardEngine, renderer local ou entidades canônicas antigas. |
| `fix/cards-anki-26093-real-log-parity-20260923` | `bf27339767e5` | 25 / 466 | Scheduler local, journal e commit SQL foram substituídos pela Collection oficial, que persiste Card + revlog. Recuperada validação de revlog/FSRS na migração; não recriar escrita acadêmica paralela no Supabase. |
| `fix/cards-anki-audit-metrics-20261001` | `af92bf2451a4` | 0 / 6 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `fix/cards-anki-legacy-template-migration-20261001` | `1d0353a3cfd9` | 8 / 2 | Os quatro arquivos alterados são byte a byte iguais à main; preservar reparo dos templates stock e HTTP 422. |
| `fix/cards-audit-forensic-parity-20260927` | `8c149082abbe` | 16 / 388 | Auditoria exportada agora lê estado/logs/configuração da Collection oficial; não restaurar métricas calculadas pelo scheduler antigo. |
| `fix/cards-audit-upload-20260923` | `8b36b2ba41bf` | 1 / 452 | Auditoria exportada agora lê estado/logs/configuração da Collection oficial; não restaurar métricas calculadas pelo scheduler antigo. |
| `fix/cards-bank-picker-mobile-20260923` | `f4242f389054` | 3 / 456 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/cards-blank-front-canonical-sync-20260930` | `cbaf6c7b937f` | 12 / 382 | Semântica compatível já migrada para 95-cards-official-bridge, editor e endpoints oficiais. Não restaurar CardEngine, renderer local ou entidades canônicas antigas. |
| `fix/cards-daily-robustness-20260921` | `9d9630c63958` | 43 / 787 | Dependia de cache IndexedDB, offline autenticado e leases do scheduler local. A main usa nuvem e Collection oficial; conservar barreiras atuais de confirmação e isolamento. |
| `fix/cards-edit-type-matrix-20260930` | `8001b00647f0` | 14 / 380 | Semântica compatível já migrada para 95-cards-official-bridge, editor e endpoints oficiais. Não restaurar CardEngine, renderer local ou entidades canônicas antigas. |
| `fix/cards-focus-and-audit-scope-20260923` | `d7f11b552803` | 5 / 468 | Semântica compatível já migrada para 95-cards-official-bridge, editor e endpoints oficiais. Não restaurar CardEngine, renderer local ou entidades canônicas antigas. |
| `fix/cards-fsrs-healthcheck-wasm-20260923` | `4795b427e57c` | 6 / 552 | WASM local foi substituído pelo pacote oficial do Anki; não reintroduzir optimizer/scheduler paralelo. |
| `fix/cards-global-total-parity-20260923` | `c0382a23cd5c` | 22 / 466 | Semântica compatível já migrada para 95-cards-official-bridge, editor e endpoints oficiais. Não restaurar CardEngine, renderer local ou entidades canônicas antigas. |
| `fix/cards-review-dark-theme-20260923` | `47db0fbabc7d` | 6 / 552 | Semântica compatível já migrada para 95-cards-official-bridge, editor e endpoints oficiais. Não restaurar CardEngine, renderer local ou entidades canônicas antigas. |
| `fix/cards-reviewer-anki-counts-20260929` | `f0eca9308dae` | 4 / 386 | Semântica compatível já migrada para 95-cards-official-bridge, editor e endpoints oficiais. Não restaurar CardEngine, renderer local ou entidades canônicas antigas. |
| `fix/cloze-same-number-parity-20260929` | `76fcb41307f3` | 4 / 384 | Semântica compatível já migrada para 95-cards-official-bridge, editor e endpoints oficiais. Não restaurar CardEngine, renderer local ou entidades canônicas antigas. |
| `fix/global-profile-memory-20260923` | `ee04c44dca27` | 0 / 483 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `fix/login-server-status-20260924` | `c81cf4c714e2` | 2 / 444 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/mobile-floating-lists-20260924` | `685b89c10b74` | 12 / 458 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/pages-ignore-anki-upstream-20261001` | `ca948ae9428b` | 0 / 58 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `fix/plan-scope-tec-and-card-decks-20260923` | `11839f5d502b` | 8 / 470 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/planning-coherence-20260923` | `0e7ff8c8766a` | 27 / 460 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/prelogin-server-status-20260924` | `c5c4ecd5e807` | 2 / 441 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/registrar-expandido-final-20260926` | `861f1bfd7572` | 1 / 396 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/registrar-inner-width-20260926` | `76639d8c0b2f` | 3 / 392 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/registrar-largura-mobile-20260926` | `7b202056a5be` | 1 / 396 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/supabase-egress-20260923` | `092641799927` | 7 / 464 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |
| `fix/tec-ai-provider-diagnostics` | `a324b95b394e` | 79 / 1339 | Arquitetura TEC/companion anterior à restauração, sem contrato com o runtime atual. Preservada na branch; não reintroduzir módulos removidos, migrations ou workflows temporários neste PR de Cards/Anki. |
| `fix/tec-performance-actions-ritmo` | `dad275c3a345` | 11 / 1315 | Arquitetura TEC/companion anterior à restauração, sem contrato com o runtime atual. Preservada na branch; não reintroduzir módulos removidos, migrations ou workflows temporários neste PR de Cards/Anki. |
| `fix/tec-reconciliacao-multidispositivo` | `8bfb83823e4a` | 95 / 1339 | Arquitetura TEC/companion anterior à restauração, sem contrato com o runtime atual. Preservada na branch; não reintroduzir módulos removidos, migrations ou workflows temporários neste PR de Cards/Anki. |
| `hotfix/revert-289-runtime-20261001` | `63b8cc18c57b` | 0 / 56 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `main` | `b1256a40194a` | 0 / 0 | Base da consolidação; mantém a integração Anki-only. |
| `merge/cards-anki-upstream-milestone-20260930` | `35b7864def94` | 0 / 61 | Já ancestral da main; nenhuma mudança exclusiva para reaplicar. |
| `style/registrar-indigo-refine-20260927` | `0ff0f874b821` | 1 / 390 | Melhoria de interface/escopo já presente ou refinada na main; manter a implementação atual e os testes atuais, sem substituir arquivos por versões antigas. |

## Validação e limites

O teste da sincronização e o teste isolado de versão/health não exigem rede nem bibliotecas externas. Smoke oficial e suites Node/navegador permanecem obrigatórios no CI do PR antes do merge. A certificação individual exaustiva por arquivo continua sendo uma métrica diferente da integração; não há aumento artificial de percentual neste PR. A revisão autenticada de uma coleção real depende da sessão do usuário e deve ser distinguida dos testes de coleções temporárias.

