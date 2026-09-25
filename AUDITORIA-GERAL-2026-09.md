# Auditoria geral do StudyNoMentor — 25/09/2026

Somente análise. Nenhum código foi alterado.

## Cobertura

| Lido integralmente, linha a linha | Lido por varredura dirigida (grep de padrões de risco + trechos) |
|---|---|
| `build.mjs`, `sw.js`, `manifest.webmanifest`, `src/html/00-cabecalho.html`, `src/html/90-rodape.html`, `supabase/migrations/*`, `.github/workflows/*`, `anki_official_backend/app.py`, `src/js/10`, `11`, `12`, `14`, `15`, `16`, `17`, `20`, `21`, `22`, `30`, `31`, `32`, `33-grade-gerador`, `33-tela-grade`, `34`, `35`, `40`, `53`, `60-cloud-store`, `60-relational-store`, `46` (sanitizador), `66` (metade), `44-tela-cards` (fluxo de resposta), `94-global-scope` (sobrescritas do DB) | `41`–`43`, `44-anki-*`, `45-*`, `47`–`52`, `54`–`59`, `63`, `64`, `67`, `70`, `80`–`93`, CSS (`src/css/*`), `03/05-corpo*.html` |

Escala: **CRÍTICO** (perda de dado / funcionalidade quebrada em produção / segurança), **ALTO**, **MÉDIO**, **BAIXO**.

---

## 1. Achados críticos

### C1. Falhas de gravação no banco são descartadas em silêncio e "somem" na próxima gravação bem-sucedida
`src/js/60-relational-store.js:515-547`
- `_queue` tenta 3 vezes (≈1,2 s no total). Se falhar, grava `_lastError` e **descarta a operação** — ela não volta para a fila.
- A próxima tarefa que der certo faz `this._lastError = null` (linha 524). Um `flush()` depois disso retorna OK.
- Como a sincronização é por **diferença** (`_syncById` compara `oldRaw`×`newRaw` de cada mutação), a mudança perdida não é reenviada por edições posteriores na mesma lista.
- Resultado: queda de rede de 2 s → a edição fica só na RAM; ao recarregar/abrir em outro aparelho, ela desaparece. O `SaveGuard` só protege quando o flush roda *antes* de outra operação ter sucesso, e a maioria das telas grava direto por `DB._set` sem `SaveGuard`.

### C2. Sem sessão válida, toda edição vira projeção em RAM e é descartada — sem aviso
`src/js/60-relational-store.js:735` (`if(!this.isReady()) return;`) + `src/js/60-cloud-store.js:138` + `src/js/53-portao-de-acesso.js:80-88`
- Se o token expirar e o refresh falhar (evento `SIGNED_OUT`), `CloudStore.session` vira `null`. O portão só se repinta se já estiver aberto; com o app em uso, nada acontece.
- O usuário continua registrando estudos, respondendo cards, editando grade — nada é enfileirado. Ao recarregar, tudo some.
- Não há `beforeunload` que avise sobre fila pendente (`grep beforeunload` só encontra o iframe do Anki). Fechar a aba com a fila cheia também perde dados.

### C3. Escrever TEC/incidência antes do "bloco pesado" carregar apaga o histórico inteiro no banco
`src/js/11-db.js:2310-2318` (`saveTecSnapshot`), `1659-1683` (`addIncidenciaRows`), `src/js/60-relational-store.js:891-903`
- O perfil abre com `includeHeavy:false` (`53-portao-de-acesso.js:300`); TEC e incidência chegam depois, em segundo plano (`scheduleHeavyData`, 2,5 s + idle; **não baixa nunca** com "economia de dados" ligada, linha 469).
- `saveTecSnapshot` lê `_get(KEYS.tec, [])` → `[]` enquanto o bloco não chegou, acrescenta o retrato novo e grava. A persistência de `tec` é `replace_study_tec` (substitui **todos** os retratos do plano). O mesmo vale para `incidencia` (`replace_study_plan_rows`).
- A tela de importação do TEC (`51-tela-desempenho-tec.js:1070`, `2011`) não espera `ensureHeavyData`. Importar um retrato logo ao abrir o app, ou com economia de dados, apaga todo o histórico TEC/incidência do planejamento.

### C4. `AutoTeste.rodar()` mexe nos dados reais do usuário e os envia ao Supabase
`src/js/45-autoteste.js:727-770`
- O teste `incidenciaGravacao` chama `DB.saveIncidencia([])` várias vezes no **perfil ativo** e no final regrava o `guardado`.
- Cada chamada vira `replace_study_plan_rows` no banco. Se o bloco pesado não estiver carregado, `guardado` é `[]` e o "restaurar" grava vazio → incidência apagada. Se a aba fechar no meio, idem.
- `CONTRIBUINDO.md` orienta o usuário a rodar `AutoTeste.rodar()` no console do app de produção.

### C5. O otimizador FSRS oficial (WASM) não funciona no navegador: o CSP bloqueia WebAssembly
`src/html/00-cabecalho.html` (CSP) + `src/js/30-fsrs.js:609-621`
- `script-src` não tem `'wasm-unsafe-eval'`. Testado no Chromium com o CSP exato do `index.html`:
  `Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is not an allowed source...`
- Ficam quebrados: otimizar parâmetros, Health Check, simulador e o reagendamento por memory state (`44-tela-cards.js:~2775`).
- O teste `testes/cards-fsrs-optimizer-oficial.mjs` roda no Node (sem CSP), então a CI passa.

### C6. O backend "Anki Oficial" nunca reconhece campos `{{type:...}}`
`anki_official_backend/app.py:356`
- `re.compile(r"\\[\\[type:(.+?)\\]\\]")` é uma raw string com barras dobradas: o padrão procura uma barra invertida literal. Verificado: `search('[[type:Back]]')` → `None`.
- O mesmo erro de escape aparece no front: `src/js/45-anki-official-surfaces.js:428` (`/\\[\\[type:.+?\\]\\]/g`).
- O smoke test (`testes/anki-oficial-backend-smoke.py:69`) só verifica o caso sem campo de digitação, por isso não pega o problema.

### C7. Os dados do estudante no perfil (concurso, cargo, banca, data da prova, meta de horas) nunca são salvos
`src/js/53-portao-de-acesso.js:411-412`, `src/js/12-planos-perfis.js:685,879-892`, `src/js/60-relational-store.js:745`
- O `meta` é gravado em `diario-estudos:profiles`, que o `RelationalStore` ignora de propósito (`p.sub==='profiles'` → `return`).
- `syncMirrorFromCloud` reconstrói a lista sem `meta` a cada carregamento de perfis. O toast diz "Perfil atualizado ✓", mas os dados somem na próxima abertura.

### C8. A persistência agora depende 100% da nuvem, mas o app continua se apresentando como "offline-first"
`src/html/00-cabecalho.html` (shim de `localStorage` só em RAM + limpeza das chaves antigas após 5 s), `manifest.webmanifest` ("tudo no seu dispositivo"), `sw.js`, `CONTRIBUINDO.md`
- Sem internet o app abre (o SW serve a casca), mas nada que for feito persiste (ver C2).
- A limpeza automática (`setTimeout(..., 5000)`) apaga todas as chaves `diario-estudos:*` do `localStorage` e o IndexedDB `diario-estudos-db` **sem verificar** se aquele conteúdo já foi migrado para a nuvem. Um usuário antigo que nunca sincronizou perde o diário local na primeira abertura desta versão.
- `LS.clear()` limpa o `localStorage` nativo **inteiro** da origem. No GitHub Pages, a origem `studynomentor.github.io` é compartilhada com qualquer outro repositório Pages da mesma conta.

---

## 2. Achados altos

### A1. Importar um `.apkg` é O(n²) e dispara milhares de requisições
`src/js/35-anki-import.js:515-533`
Para cada card: `DB.getCards().find` (parse do JSON de todos os cards), `DB.addCard` (parse + stringify de todos), dois `DB.updateCard` (mais dois ciclos completos, cada um gerando um diff no `RelationalStore`) e um `SELECT` no SQLite por card (linha 519). Um baralho de 10 mil cards chega a centenas de milhões de operações de JSON e dezenas de milhares de RPCs no Supabase. `_ensureCardsForTextNote` (texto/CSV/Mnemosyne) tem o mesmo padrão.

### A2. Mídia vira base64 dentro do HTML do card
`src/js/35-anki-import.js:133-157`
Imagens e áudios importados viram `data:` embutido em `frente`/`verso`. Consequências:
- linhas do banco com MB cada;
- `DB.getCards()` faz parse de tudo isso a cada leitura;
- o egress do Supabase explode (o código já trata `exceed_egress_quota`);
- a foto de backup passa do teto de 6 MB (`66-backup-nuvem.js:185`) e o backup automático para de funcionar para esses perfis. Hoje isso só aparece em `CloudBackup.status()`, não na tela.
A migration `study_anki_media` existe, mas a importação não a usa.

### A3. O modelo de dados reescreve listas inteiras a cada mutação
`src/js/11-db.js` (todos os `getX`/`saveX`)
Toda gravação faz `JSON.parse` da lista completa + alteração + `JSON.stringify` completo + diff linha a linha no `RelationalStore`. Com milhares de cards, **cada resposta de revisão** faz parse e stringify da coleção inteira (`updateCard`). Leituras também repetem parse: `CycleEngine.minutesStudied` relê todos os registros por matéria; `renderCellContent` da grade relê o modelo por célula; o Histórico relê os registros três vezes por semana exibida.

### A4. Importar um Collection Package apaga primeiro e restaura depois — sem atomicidade no banco
`src/js/35-anki-import.js:434-445`
`saveCards([])` + `replaceRevlog([])` já são enfileirados para o Supabase antes da importação. Se a importação falhar ou a aba fechar, o banco fica vazio. O "restaurar" é só local e também depende da fila (ver C1).

### A5. `replaceProfileFromPayload` apaga o perfil no banco e regrava tabela por tabela, sem transação
`src/js/60-relational-store.js:912-975`
`DELETE study_plans` (cascade) seguido de dezenas de RPCs sequenciais. Uma falha no meio deixa o perfil parcialmente vazio. Além disso, `CloudBackup.restaurar` (`66-backup-nuvem.js:309`) segue com a restauração **mesmo se a foto de segurança anterior falhar** (por exemplo, "grande-demais").

### A6. Uma operação envenenada na fila de revisões impede abrir o perfil
`src/js/60-relational-store.js:653-694` + `491`
`hydrateProfile` espera `replayReviewOutbox`. Se uma operação sempre falha (card apagado em outro aparelho → violação de FK, por exemplo), o loop lança exceção em toda abertura e o perfil deixa de abrir naquele aparelho.

### A7. Código de extensões e "Custom Scheduling" é executado com `new Function` na origem do app
`src/js/44-anki-total-parity.js:348,426`
- Hoje isso não roda porque o CSP não tem `unsafe-eval` (a funcionalidade está quebrada).
- Se alguém "consertar" o CSP, vira execução arbitrária no mesmo contexto do token Supabase. O código vem de chaves do perfil sincronizadas pelo banco e **importáveis por backup JSON** (`importProfile` copia as chaves sem filtro), inclusive já com `enabled:true`.
- Isso precisa ir para um iframe sandbox, como os templates, ou sair do produto.

### A8. Baralhos importados podem responder cards sozinhos
`src/js/44-anki-runtime.js:260-266`
O iframe do card (script do template) pode enviar `pycmd('ease4')`, que chama `CardsScreen.answer`. Um template malicioso ou defeituoso pode responder a fila inteira como "Fácil". O sandbox também inclui `allow-popups allow-modals`.

### A9. Diálogos `UI.*` concorrentes deixam promessas penduradas; Enter confirma mesmo com "Cancelar" focado
`src/js/14-navegacao-e-dialogos.js:289-430`
- Existe um único `_resolve`. Abrir um segundo diálogo substitui o primeiro, e o `await` do primeiro nunca termina.
- O `keydown` de Enter faz `preventDefault` e `_submit(true)` para qualquer alvo que não seja `TEXTAREA`. Com o foco no botão "Cancelar" (o `FocusTrap` foca o primeiro focável, frequentemente o X/Cancelar), Enter **confirma** a ação — inclusive exclusões `danger`.

### A10. Vazamento de listeners na Grade
`src/js/33-tela-grade.js`
- `bindCellClick` (1242-1256) adiciona um `click` no **contêiner da célula** sempre que ela fica vazia. Quando a célula recebe uma matéria, o listener antigo continua lá: clicar no "×" abre o `UI.confirm` e o seletor de siglas ao mesmo tempo. Cada ciclo esvaziar/preencher acumula mais um.
- `bindDropZones` (1154-1166) adiciona `dragover`/`drop` na bandeja a cada `renderGrade` → um único drop executa `setCellData` + `renderGradeScreen` N vezes.

### A11. O schema do banco não está versionado
`supabase/migrations/` tem só 2 arquivos (review_id e mídia). Tabelas `study_*`, RLS, RPCs (`mutate_study_plan_rows`, `replace_study_tec`, `read_study_profile_core`...), triggers de change log e `profile_backups` não estão no repositório. Não dá para recriar o ambiente nem revisar a RLS a partir do código.

### A12. A CI não roda o que a documentação diz
`.github/workflows/verificar.yml`
- Não executa `node verificar.mjs` nem `node build.mjs --check`: roda `node build.mjs` (regrava) e segue. Checagens 4–7 do CONTRIBUINDO (CSP, console limpo, AutoTeste, contraste WCAG) não rodam na CI.
- Em push na `main`, só faz build e commita os artefatos direto na `main` (`[skip ci]`) — nenhum teste roda na `main`.
- `permissions: contents: write` em `pull_request`, e checkout por `head.ref`, que não existe para PRs de fork.
- `cards-fsrs-vendor.yml` aponta para a branch `fix/cards-anki-perfect-parity-20260923` (morta).

### A13. Backend Anki (`app.py`) — robustez
- `import_colpkg` (903-940): fecha a coleção e, se `import_collection_package` lançar exceção, **não reabre** → a coleção do usuário fica fechada até reiniciar o processo. O backup `before-colpkg-import.anki2` é sobrescrito a cada importação e nunca restaurado.
- `card_action "mark"` (523-530): se dois cards da mesma nota vierem na lista, a marcação alterna duas vezes e nada muda.
- Cada requisição valida o token chamando `/auth/v1/user` no Supabase (sem cache) → latência e custo em toda chamada.
- Arquivos de até 512 MB são lidos inteiros na RAM (`await file.read(MAX+1)`) em vários endpoints; o `CollectionPool` nunca libera coleções.
- Temporários vazam quando a exportação lança exceção (`export_apkg`, `export_colpkg`, CSV) ou quando `uc_for` falha depois do `mkstemp` (`csv_metadata`, `import_csv`).
- `/health` expõe `data_dir`; os `ALLOWED_ORIGINS` padrão incluem `localhost`; `@app.on_event` está depreciado.

---

## 3. Achados médios

1. **Arquitetura em camadas de monkey-patch.** Há 65 reatribuições de métodos do `DB`, 78 de `AnkiParity` e 31 de `CardsScreen` em arquivos posteriores (`54`, `56`, `58`, `94`, `44-anki-*`). `CardEngine.schedule` é embrulhado (`44-anki-total-parity.js:434`). `S.inPlan` troca `DB.getCards/saveCards` globalmente durante uma chamada (`94-global-scope.js:704-710`); se algum `fn` for `async`, o restante roda com as funções já restauradas. Ler `11-db.js` não descreve mais o comportamento real.
2. **Documentação desatualizada/contraditória.** `CONTRIBUINDO.md` fala de IndexedDB, `SectionSync`, fallback de `localStorage`, "funciona por file://", CI com `verificar.mjs`. O comentário do `ReviewJournal` (`11-db.js:9`) promete fallback em `localStorage` (hoje é RAM). `66-backup-nuvem.js:64-71` diz "GRAVADA em disco". `RelationalStore._ignoreSub` ignora `__lixeira:`, mas a Lixeira usa `__trash:` — o lixo é persistido como setting de perfil (até 2 MB por perfil, relido a cada abertura).
3. **Constantes do sanitizador moram no arquivo de testes.** `RTE_TAGS_OK`/`RTE_TAGS_FORA` estão em `45-autoteste.js:1127-1132`, mas são usadas pelo `46-sanitizacao-e-editor.js`. Mover ou apagar o AutoTeste quebra a sanitização.
4. **`rtePlainFromHtml` usa `innerHTML` num `div` do documento vivo** (`46-sanitizacao-e-editor.js:141-143`) — exatamente o que o próprio comentário do sanitizador explica ser perigoso (dispara `onerror`). O risco hoje é baixo porque a entrada é o editor já saneado.
5. **Datas em UTC em vez do dia local** (depois das 21h no Brasil caem no dia seguinte):
   - `35-anki-import.js:536` e `596` (data do revlog e `due` do Mnemosyne);
   - `44-anki-max-stats-media.js:296` (gráfico "Adicionados") e `392`;
   - `44-tela-cards.js:2780` (reagendamento: `lastDate` em UTC → `due` pode sair 1 dia depois).
6. **`migrarAproveitamentoAgregado` reescreve semanas fechadas** (`11-db.js:1428-1450`), contrariando a regra "semana fechada é registro" do bloco logo abaixo. A flag `'mig-aprov-agregado-v1'` não tem prefixo de estudo: vai para o `localStorage` nativo, vale para o navegador inteiro e só roda no primeiro perfil/plano aberto.
7. **Gravações recusadas (plano pausado, falha) mostram sucesso.** `_set` devolve `false`, mas `saveCycleToHistory`, `clearCurrentCycle`, `saveGradeTemplate`, `deleteCycleHistoryEntry`, `saveSubjects` e outros ignoram o retorno, e as telas mostram "✓ Semana fechada", "Grade restaurada ✓" etc. (`33-tela-grade.js:1851-1853`, `40-tela-historico.js:376-377`). Leituras também gravam (`getSubjects`, `getMethods`, `getTecSnapshots` migram na leitura) → um plano pausado exibe o toast "somente leitura" só por abrir a tela.
8. **Histórico:** `parseFloat(card.dataset.id)` (`40-tela-historico.js:365`) + comparação estrita `x.id === id`. Semanas com id não numérico (backups antigos) não podem ser editadas, e excluir lança `TypeError` (`w.startDate` de `undefined`).
9. **`SaveGuard` faz rollback descartando mais do que a operação** (`15-saveguard.js:75-88`). Timeout de 12 s → `hydrateProfile` apaga da RAM todas as outras edições pendentes; se o flush original terminar depois, tela e banco divergem até o próximo catch-up.
10. **Registros:** o desempate da ordenação usa `(b.id||0)-(a.id||0)` com ids UUID → `NaN`, ordem arbitrária no mesmo dia (`20-tela-registrar.js:257`, `471`). Editar um registro de matéria desativada deixa o `<select>` vazio e o salvar é bloqueado. `subjectHasEntries`/`methodInUse` (`11-db.js:527,564`) quebram com `e.subject`/`e.method` ausente.
11. **Grade-gerador grava preferências a cada tecla** (`33-grade-gerador.js:273,306-319`) → um upsert no Supabase por `input`. Em `dividir()`, com `min === max`, o resto é perdido sem aviso.
12. **PIN de perfil é código morto.** Hash djb2 de 32 bits sem sal (`12-planos-perfis.js:702-718`); `checkPin` nunca é chamado e `syncMirrorFromCloud` descarta `pin_hash`. Remover ou implementar direito.
13. **Congelamento de `Object.prototype`/`Array.prototype`** (`10-infra.js:110-124`) depois do Supabase: SheetJS, sql.js, fzstd e MathJax são carregados depois e podem quebrar se escreverem em prototypes. O SheetJS vem do CDN **sem SRI** (`16-planilhas-e-tec.js:35`, `__SHEETJS_SRI` nunca é definido).
14. **Atualização do SW** (`67-atualizacao.js:158-200`): se o flush falhar depois do `skipWaiting`, o worker novo já assumiu e a página velha segue rodando — justamente a mistura que o módulo quer evitar.
15. **Exportação `.apkg`:** `Math.max(1, ...cards.map(...))` (`34-anki-export.js:819`) estoura a pilha com coleções muito grandes; ZIP sem ZIP64 (>65 535 entradas / >4 GB); `factor` do revlog usa o ease **atual** do card para todo o histórico (`34-anki-export.js:672`).
16. **Importação ZIP sem limite de tamanho descompactado** (`35-anki-import.js:82-98`, `16-planilhas-e-tec.js:85-94`): um arquivo-bomba derruba a aba.
17. **Backup diário e `protegerAgora`** enviam o perfil inteiro (gzip) a cada operação de risco, até para "desmarcar concluídos" da grade — custo de egress relevante. `listar()` limita a 60 linhas, e a faxina/âncora só enxerga essas.
18. **`incidPorDisciplina`/`raizIncid`** (`17-reforco.js:233-241`): linhas "Sem Classificação" chegam com `depth=1` e `codigo=null` e entram como raiz, inflando o total da disciplina. `currentSnapshot` promete "últimos 90 dias", mas não verifica a data.
19. **Links externos no celular** (`14-navegacao-e-dialogos.js:84-86`) navegam na mesma aba sem esperar o flush; com a RAM como única cópia, edições em trânsito se perdem.

---

## 4. Achados baixos / higiene

- `00-cabecalho.html`: `</script></script>` duplicado após o script do Supabase. `LS.key()` não invalida `keysCache` ao gravar chave nativa nova (`length` fica defasado).
- `sw.js`: a instalação "passa" mesmo sem conseguir baixar a casca (`precarregar().catch(()=>null)`); a versão nova ativa com o balde vazio. Os ícones do manifesto são SVG com emoji em `data:` — a renderização depende da fonte do sistema.
- `build.mjs --check` não valida `src/manifesto.json`; se a meta `diario-versao` sumir, o carimbo falha em silêncio.
- `11-db.js`: variáveis mortas (`removido` em `deleteEntry`, `before` em `updateEntry`); `getCard` usa `===` enquanto o resto usa `_mesmoId`.
- Duas implementações de SHA-1 em `34-anki-export.js` (`_sha1Bytes` / `_sha1First32`).
- `33-grade-gerador.js`: clicar no fundo fecha o modal, contrariando a regra do resto do app.
- `53-portao-de-acesso.js:255-266`: `p.avatar`, `p.cor` e `p.id` vão para o HTML sem escape (dados da própria conta, risco de self-XSS).
- CSS: 1 248 `!important` e 265 media queries espalhados em 42 folhas em camadas (`43-telas-tec-extras.css` sozinho tem 116); 257 `style=""` inline no HTML. `index.html` com 3,7 MB é todo analisado a cada abertura, e o JS roda via reinjeção de texto (sem cache de bytecode).
- `backend/app.py`: `font-family:{ctx["font"]}` interpolado sem escape no HTML da comparação.

---

## 5. Prioridade sugerida de correção

1. **C1 + C2** — fila relacional durável (reenfileirar em falha, nunca zerar `_lastError` sem reenviar, `beforeunload` com pendências, bloquear a UI/avisar quando a sessão cair).
2. **C3 + C4** — exigir `ensureHeavyData` antes de qualquer escrita em `tec`/`incidencia` (na camada `DB`, não na tela) e tirar o AutoTeste do caminho dos dados reais.
3. **C5** — adicionar `'wasm-unsafe-eval'` ao `script-src` e um teste de navegador que rode o otimizador sob o CSP real.
4. **C6, C7** — regex do `type:` (backend e front) e persistência do `meta` do perfil.
5. **C8 / A11 / A12** — decidir e documentar o modelo (cloud-only), revisar a limpeza automática do `localStorage` antigo, versionar o schema completo do Supabase e colocar `verificar.mjs` + `build --check` na CI.
6. **A1–A5** — importação em lote (uma leitura, uma gravação), mídia em `study_anki_media`, transações/RPC únicas para substituições em massa.
7. Restante (A7–A13, médios e baixos) conforme o roadmap.
