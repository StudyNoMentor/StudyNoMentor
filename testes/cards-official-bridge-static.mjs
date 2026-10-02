#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const bridge=readFileSync(join(ROOT,'src/js/95-cards-official-bridge.js'),'utf8');
const db=readFileSync(join(ROOT,'src/js/11-db.js'),'utf8');
const official=readFileSync(join(ROOT,'src/js/44-anki-official.js'),'utf8');
const cards=readFileSync(join(ROOT,'src/js/44-tela-cards.js'),'utf8');
const html=readFileSync(join(ROOT,'src/html/03-corpo.html'),'utf8');
const statsMedia=readFileSync(join(ROOT,'src/js/44-anki-max-stats-media.js'),'utf8');
const maxEditor=readFileSync(join(ROOT,'src/js/44-anki-max-editor.js'),'utf8');
const imageOcclusion=readFileSync(join(ROOT,'src/js/44-anki-image-occlusion.js'),'utf8');
const product=readFileSync(join(ROOT,'src/js/44-anki-product-parity.js'),'utf8');
const total=readFileSync(join(ROOT,'src/js/44-anki-total-parity.js'),'utf8');
const practical=readFileSync(join(ROOT,'src/js/44-anki-practical-10.js'),'utf8');
const final10=readFileSync(join(ROOT,'src/js/44-anki-10of10-final.js'),'utf8');
const sanitizer=readFileSync(join(ROOT,'src/js/46-sanitizacao-e-editor.js'),'utf8');
const importer=readFileSync(join(ROOT,'src/js/35-anki-import.js'),'utf8');
const backend=readFileSync(join(ROOT,'anki_official_backend/app.py'),'utf8');
const build=readFileSync(join(ROOT,'build.mjs'),'utf8');
const req=readFileSync(join(ROOT,'anki_official_backend/requirements.txt'),'utf8');

assert.match(req,/^anki==26\.09\.3$/m,'backend precisa fixar exatamente anki==26.09.3');
assert.match(req,/^PyJWT\[crypto\]==2\.15\.1$/m,'verificador JWT precisa estar fixado e com suporte criptográfico');
assert.match(backend,/PyJWKClient/,'Auth rápido deve validar JWT assimétrico por JWKS');
assert.match(backend,/max_age=86400/,'preflight CORS precisa ficar cacheável para não duplicar round-trip');
assert.match(backend,/GZipMiddleware, minimum_size=1024/,'snapshots grandes precisam sair comprimidos');
assert.match(official,/async _fetchResponse\(path, opts\)[\s\S]*?AbortController[\s\S]*?\[502, 503, 504\]/,'cliente Anki precisa ter timeout e retry apenas no transporte seguro de leitura');
assert.doesNotMatch(official,/\/api\/anki\/bootstrap\?view=/,'cliente fino não pode reativar o bootstrap da antiga tela Anki');
assert.doesNotMatch(official,/\b(?:root|renderReviewer|renderDecks|setView)\s*\(/,'transporte oficial não pode voltar a carregar UI/reviewer próprios');
assert.match(bridge,/\/api\/cards-official\/bootstrap-state/,'Cards deve consolidar status, full-state e preferências');
assert.match(build,/'js\/95-cards-official-bridge\.js'/,'bridge precisa entrar no build publicado');
for(const removed of ['30-fsrs.js','31-cards-config.js','32-card-engine.js'])assert.ok(!build.includes('js/'+removed),'motor local não pode voltar ao build: '+removed);
assert.ok(!build.includes('js/34-anki-export.js'),'gerador APKG local não pode voltar ao build');
assert.ok(!bridge.includes('AnkiExport.'),'bridge oficial não pode depender de exportador local');
assert.doesNotMatch(cards,/cardTypeKey\(card\)[\s\S]{0,220}?card\.tipo/,'tipo canônico do Card deve vir de kind; fallback legado já migrado não pode voltar');

// MENU MAIS — inventário e destino. O menu único da tela Cards/Anki deve manter
// somente superfícies válidas: ações acadêmicas delegam ao backend oficial;
// utilidades de casca permanecem explicitamente não acadêmicas.
for(const id of [
  'cards-stats-btn','cards-algo-btn','cards-custom-btn','cards-filtered-btn',
  'cards-import-btn','cards-export-btn','cards-empty-btn','cards-audit-export-btn'
]) assert.ok(html.includes('id="'+id+'"'),'ação base do Mais ausente: '+id);

for(const [id,source] of [
  ['cards-advanced-add-btn',imageOcclusion],
  ['cards-browser-btn',product],
  ['cards-shared-decks-btn',product],
  ['cards-notetypes-btn',product],
  ['cards-check-collection-btn',product],
  ['cards-preferences-btn',practical],
]) assert.ok(source.includes(id),'ação injetada do Mais ausente: '+id);

for(const source of [html,practical,total,product,final10,imageOcclusion])
  assert.ok(!source.includes('cards-extensions-btn'),'Extensões locais não podem voltar ao Mais do Anki oficial');
for(const source of [html,practical,final10])
  assert.ok(!source.includes('cards-reviewer-bindings-btn'),'Atalhos personalizados não oficiais não podem voltar ao Mais');

assert.match(sanitizer,/on\('cards-empty-btn'[\s\S]{0,500}?CardsOfficialBridge\.openEmptyCards/,'Cards vazios deve delegar ao backend oficial');
assert.match(product,/openSharedDecks\(\)[\s\S]{0,500}?https:\/\/ankiweb\.net\/shared\/decks\//,'Baralhos compartilhados deve abrir a fonte oficial AnkiWeb');
assert.match(imageOcclusion,/anki-advanced-save[\s\S]{0,3000}?CardsOfficialBridge\.addOfficialNote/,'Adicionar nota avançada deve gravar pela Collection oficial');
assert.match(practical,/openPreferences\(\)[\s\S]{0,5000}?CardsOfficialBridge\.getOfficialPreferences[\s\S]{0,5000}?CardsOfficialBridge\.updateOfficialPreferences/,'Preferências acadêmicas devem ler e salvar pela Collection oficial');
assert.match(bridge,/async runCustomStudy\(\)[\s\S]{0,1800}?\/api\/cards-official\/custom-study/,'Estudo personalizado deve usar Custom Study oficial');


for(const forbidden of [
  'CardEngine.schedule(',
  'CardEngine.previewIntervals(',
  'CardsScreen.buildQueue('
]){
  assert.ok(!bridge.includes(forbidden),'reviewer oficial não pode cair para '+forbidden);
}

for(const forbidden of [
  'CardEngine.schedule(',
  'CardEngine.previewIntervals(',
  'DB.resetCard(',
  'DB.setDueSpec(',
  'AnkiParity.customStudy(',
  'AnkiParity.saveFilteredDeck('
]){
  assert.ok(!cards.includes(forbidden),'casca Cards não pode manter motor acadêmico legado: '+forbidden);
}
assert.match(bridge,/\/api\/cards-official\/collection\/full-state/,'bootstrap deve carregar o snapshot integral da Collection oficial persistente');
assert.match(bridge,/officialCards=new Set\(\(state\.cards\|\|\[\]\)\.map\(x=>String\(x\.id\)\)\)/,'IDs canônicos devem vir do snapshot oficial');
assert.ok(bridge.includes('const oid=Number(card&&card.ankiId)')&&bridge.includes('officialCards.has(String(oid))'),'espelhos Study com identidade oficial devem seguir o snapshot do Anki sem apagar legado não mapeado');
assert.ok(!bridge.includes("this.request('/api/cards-official/bootstrap'"),'runtime não pode reconstruir a Collection oficial a partir do Study');
assert.match(backend,/def cards_official_collection_full_state[\s\S]*?cards_collection_full_state_payload\(item\.col\)/,'full-state deve ser extraído da Collection oficial');
assert.match(backend,/def cards_official_preferences[\s\S]*?item\.col\.get_preferences\(\)/,'Preferences devem ser lidas da Collection oficial');
assert.match(backend,/def cards_official_update_preferences[\s\S]*?item\.col\.set_preferences\(prefs\)/,'Preferences devem ser persistidas pela Collection oficial');
assert.match(practical,/CardsOfficialBridge\.updateOfficialPreferences\(\{scheduling:\{rollover,learn_ahead_secs:/,'rollover e learn-ahead da UI devem ser oficiais');
assert.ok(!/CardsConfig\.set\(\{[\s\S]{0,350}disableAutoplay/.test(practical),'Preferências globais não podem duplicar Deck Options localmente');
assert.match(backend,/def cards_official_migrate_legacy[\s\S]*?item\.col\.add_note\(/,'migração legada deve materializar notas por objetos oficiais do Anki');
assert.match(bridge,/async _migrateLegacyCollection\(\)[\s\S]*?\/api\/cards-official\/migrate\/legacy/,'bootstrap dos Cards deve acionar a migração oficial quando a Collection estiver vazia');
assert.match(bridge,/stock_kind:String\(nt\.stockKind\|\|fallbackKind\|\|/,'migração deve conservar o stock kind inferido pelos cards quando o espelho antigo não o armazenou');
assert.match(backend,/except CardTypeError as exc:[\s\S]*?HTTPException\([\s\S]*?422/,'erro de template validado pelo Anki deve voltar como resposta estruturada, não 500 opaco');
assert.match(backend,/unknown_fields = sorted[\s\S]*?campos ausentes do NoteType oficial[\s\S]*?Migração interrompida sem descartar conteúdo/,'campo legado sem destino oficial deve abortar a migração, nunca sumir');
assert.match(bridge,/comparable=x=>JSON\.stringify[\s\S]*?Conflito de NoteType durante migração oficial/,'mesma identidade de NoteType com schemas divergentes deve falhar fechado');
assert.match(backend,/NoteType legado ambíguo:[\s\S]*?stock_kind=[\s\S]*?conflita com o nome stock/,'evidências contraditórias de stock devem abortar em vez de escolher um schema');
assert.match(bridge,/if\(!officialCount&&localCount\)[\s\S]*?this\._migrateLegacyCollection\(\)/,'Cards legados devem migrar automaticamente em vez de bloquear o reviewer');
assert.ok(!bridge.includes('A Collection oficial dos Cards está vazia, mas existem Cards legados no Study'),'erro antigo de migração manual não pode continuar no runtime');
const legacyMigrationBackend=backend.slice(backend.indexOf('def cards_official_migrate_legacy'),backend.indexOf('@app.post("/api/cards-official/bootstrap")'));
assert.ok(!bridge.includes('study_replicas:replicas'),'payload enviado ao Anki não deve transportar metadados de planejamento/banca/assunto');
assert.ok(!legacyMigrationBackend.includes('card.custom_data ='),'migração não pode usar custom_data como banco de metadados do Study');
assert.ok(backend.includes('"deck_map": deck_map')&&backend.includes('"notetype_map": nt_map')&&backend.includes('"card_map": card_map')&&backend.includes('"note_map": note_map'),'backend deve devolver todos os mapas canônicos necessários à casca');
assert.match(legacyMigrationBackend,/claimed_nt_ids: set\[int\] = set\(\)[\s\S]*?existing_id not in claimed_nt_ids/,'NoteTypes homônimos distintos não podem sobrescrever a mesma estrutura durante a migração');
assert.match(backend,/def _legacy_review_kind[\s\S]*?["']new["']:\s*0[\s\S]*?["']learning["']:\s*0/,'revlog legado deve distinguir Learning/New sem perder kind 0');
assert.doesNotMatch(bridge,/if\(semantic!==2\)continue/,'migração não pode descartar histórico legado só por não ter semântica Anki v2');
assert.match(backend,/def _reconcile_legacy_revlog_rows[\s\S]*?LEGACY_REVLOG_ARCHIVE_KEY/,'backend deve preservar bruto legado e projetar revlog nativo');
assert.match(backend,/\/api\/cards-official\/revlog\/reconcile-legacy/,'backend deve expor reparo idempotente do histórico legado');
assert.match(bridge,/_legacyReviewRepairRows\(\)[\s\S]*?semantic===2[\s\S]*?_reconcileLegacyReviewHistory/,'bridge deve reparar apenas histórico ainda não canonizado');
assert.match(bridge,/legacy_review_signature/,'bootstrap deve evitar reenviar o mesmo reparo em toda abertura');
assert.match(bridge,/['"]eraFsrs['"][\s\S]*?['"]firstReviewAt['"]/,'recriação de réplica deve preservar metadados históricos Study');
assert.ok(!legacyMigrationBackend.includes('item.col.clear_study_queues('),'migração deve seguir Scheduler v3 oficial, que invalida filas automaticamente');
assert.match(bridge,/for\(const ref of snapshot\.cardRefs\.get\(legacy\)\|\|\[\]\)[\s\S]*?StudyGlobalScope\.updateCardScoped/,'migração deve preservar metadados nas réplicas Study enquanto liga cada uma ao ID oficial');
assert.match(bridge,/_studyTargetsForState\(state,fallbackPlanId\)[\s\S]*?this\._replicas\(state&&state\.id\)/,'full-state deve reconstruir projeções a partir dos espelhos persistentes do Study');
assert.ok(bridge.includes('noteTargets=new Map(),deckTargets=new Map(),ntTargets=new Map(),touchedPlans=new Set()'),'snapshot integral deve ser projetado por planejamento, não copiado inteiro no planejamento ativo');

assert.match(bridge,/_legacyGuid\(key\)[\s\S]*?return 'snm'/,'Notes sem GUID precisam receber identidade determinística para recuperação idempotente');
assert.match(bridge,/guid:String\(localNote&&localNote\.guid\|\|this\._legacyGuid\(ng\.key\)\)/,'snapshot legado deve preservar GUID existente ou gerar GUID determinístico');
assert.match(bridge,/async _recoverLegacyIdentityFromOfficialState\(state\)[\s\S]*?officialNotesByGuid[\s\S]*?officialCardsByNoteOrd/,'reload após migração parcial deve recuperar IDs por GUID + template ord sem remigrar a Collection');
assert.match(bridge,/else\{[\s\S]*?collection\/full-state[\s\S]*?await this\._recoverLegacyIdentityFromOfficialState\(state\)/,'Collection já preenchida deve tentar recuperar espelhos legados sem ankiId');
assert.match(bridge,/claimed\.get\(String\(officialCard\.id\)\)[\s\S]*?Recuperação da migração oficial ambígua/,'recuperação não pode fundir silenciosamente dois cards legados no mesmo card oficial');
assert.match(bridge,/\/api\/cards-official\/reviewer\/answer/);
assert.match(bridge,/\/api\/cards-official\/reviewer\/type-answer\//);
assert.match(bridge,/\/api\/cards-official\/history\/undo/);
assert.match(bridge,/\/api\/cards-official\/history\/redo/);
assert.match(bridge,/\/api\/cards-official\/media\//);
assert.match(bridge,/const replayTxn=await this\._persistAnswered\(state,false\)/,'redo deve criar novo journal');
assert.match(bridge,/queue===1\|\|queue===4/,'Learn/PreviewRepeat usam timestamp oficial');
assert.match(bridge,/Number\(state\.due\)-\(Number\(timing\.today\)\|\|0\)/,'Review/DayLearn usam dia oficial');
assert.match(bridge,/state\.review_logs&&state\.review_logs\[0\]/,'revlog local deve vir do log oficial');
assert.match(bridge,/oc\.auto_advance\|\|\{\}/,'Auto Advance deve consumir o DeckConfig oficial devolvido pelo reviewer');
assert.match(bridge,/this\._elapsedMs\(\(current&&current\.auto_advance\)\|\|\{\}\)/,'tempo da resposta deve usar maxTaken e stopTimer oficiais');
assert.ok(!/trueRetention\(|previsaoCarga\(|_statBotoes\(|_statDistribuicao\(|_statsCards\(/.test(cards),'casca Cards não pode manter Stats acadêmicos locais mortos');
assert.ok(!/_armReviewerAutomation\(c,cfg\)|CardsConfig\.forDeck\(c\.deckId\)/.test(cards),'Auto Advance da casca não pode depender de configuração acadêmica local');
assert.ok(!/\bCardsConfig\b/.test(cards),'tela Cards não pode manter segunda fonte acadêmica em CardsConfig');
assert.ok(!/CardEngine\./.test(cards),'tela Cards não pode chamar o motor acadêmico legado');
assert.match(bridge,/source=window\.CardsScreen&&typeof CardsScreen\.currentFilteredCards===['"]function['"]\?CardsScreen\.currentFilteredCards\(\)/,'fila oficial deve usar o mesmo recorte visual dos filtros');
assert.ok(!bridge.includes('data-review-plan-scope'),'seletor de planejamento da revisão não pode duplicar o escopo do filtro recolhível');
assert.match(bridge,/cards-review-scope[^\n]*Baralho da revisão/,'card da revisão deve manter apenas o seletor específico de baralho e as contagens');
assert.match(bridge,/session_version:String\(this\._reviewSessionVersion\|\|['"]['"]\)/,'resposta deve estar vinculada à versão da sessão');
assert.match(official,/err\.status\s*=\s*r\.status/,'erros HTTP precisam preservar o status para distinguir conflito de falha de rede');
assert.match(bridge,/Number\(e&&e\.status\)===409[\s\S]*?await this\._syncReviewScope\(deckId\)/,'conflito de sessão deve reconstruir a fila em vez de prender o usuário no retry');
assert.match(bridge,/_reviewUiActive\(cardId,sessionVersion\)/,'Auto Advance precisa revalidar tela, card e sessão');
assert.ok(!cards.includes('value: opts[1].value'),'mover em lote não pode assumir um segundo baralho');
assert.match(cards,/async exportAudit\(\)[\s\S]*?\/api\/cards-official\/collection\/full-state/,'auditoria deve fotografar a Collection oficial');
assert.doesNotMatch(cards,/async exportAudit\(\)[\s\S]*?recomputarMemoria/,'auditoria não pode reexecutar FSRS localmente');
assert.match(cards,/CardsOfficialBridge\.deleteNotesForCardRefs\(\[\.\.\.sel\]\)/,'exclusão em lote da lista deve delegar ao Anki oficial');
assert.match(cards,/CardsOfficialBridge\.moveCardRefsToDeck\(\[\.\.\.sel\],v\.deck,sourcePlanId\)/,'movimentação em lote da lista deve delegar ao Anki oficial');
assert.match(bridge,/async deleteNotesForCardRefs\(refs\)[\s\S]*?action:'delete_notes'[\s\S]*?\/api\/cards-official\/browser\/bulk/,'bulk delete deve executar remove_notes pela rota oficial');
assert.match(bridge,/async moveCardRefsToDeck\(refs,localDeckId,planId\)[\s\S]*?action:'move_deck'[\s\S]*?\/api\/cards-official\/browser\/bulk/,'bulk move deve executar set_deck pela rota oficial');
assert.match(bridge,/mem\.stability/);
assert.match(bridge,/mem\.difficulty/);

assert.match(backend,/cards_pool = CollectionPool\(namespace="study-cards"\)/,'Cards precisa de coleção oficial isolada');
assert.match(backend,/def cards_uc_for/);
assert.match(backend,/class ReviewSessionPool:/,'revisão precisa de sessão isolada por aparelho');
assert.match(backend,/session\.col\.sched\.get_queued_cards/,'limites oficiais devem ser calculados já dentro do recorte');
assert.match(backend,/item\.col\.sched\.build_answer\(card=live, states=q\.states, rating=rating\)/);
assert.match(backend,/item\.col\.sched\.answer_card\(answer\)/);
assert.match(bridge,/session_id:this\._reviewSession\(\)/,'bridge deve identificar a sessão');
assert.match(bridge,/request_id:requestId/,'respostas precisam de chave idempotente');
assert.match(backend,/col\.sched\.describe_next_states\(q\.states\)/);
assert.match(backend,/col\.get_review_logs\(card\.id\)/);
assert.match(backend,/item\.col\.compare_answer/);
assert.match(backend,/card\.question\(\)/);
assert.match(backend,/card\.answer\(\)/);
assert.match(backend,/def cards_official_add_note[\s\S]*?item\.col\.add_note\(note, did\)/,'criação de nota dos Cards deve ser oficial');
assert.match(backend,/def cards_official_update_note[\s\S]*?item\.col\.update_note\(note\)/,'edição de nota dos Cards deve ser oficial');
assert.match(backend,/def cards_official_delete_note[\s\S]*?item\.col\.remove_notes\(\[int\(note_id\)\]\)/,'exclusão de nota dos Cards deve ser oficial');
assert.match(bridge,/CardsScreen\.saveCard=\(closeAfter\)=>\{void this\.saveSimpleCard\(closeAfter\)/,'editor simples deve delegar criação\/edição à Collection oficial');
assert.match(bridge,/CardsScreen\.deleteCard=\(\)=>\{void this\.deleteSimpleCard\(\)/,'exclusão do editor simples deve delegar à Collection oficial');
assert.match(bridge,/async addOfficialNote\(opts\)[\s\S]*?\/api\/cards-official\/notes/,'cadastro avançado deve possuir rota oficial');
assert.match(bridge,/async updateOfficialNote\(note,fields,tags,opts\)[\s\S]*?\/api\/cards-official\/note\//,'edição rica deve possuir rota oficial');
assert.match(bridge,/desiredKind===['"]cloze['"][\s\S]*?delete fields\[extra\]/,'editor Cloze simples deve preservar Back Extra não exposto');
assert.match(bridge,/\['basic_reversed','basic_optional_reversed','typing'\]\.includes\(currentStock\)/,'edição simples deve preservar o stock notetype atual e seus siblings');
assert.match(backend,/backend\.import_collection_package/);
assert.match(backend,/item\.col\.find_cards\(q, order=order, reverse=reverse\)/,'busca de cards deve usar find_cards oficial');
assert.match(backend,/item\.col\.find_notes\(q, order=order, reverse=reverse\)/,'busca de notas deve usar find_notes oficial');
assert.match(backend,/item\.col\.get_browser_column\(sort_key\)/,'ordenação deve usar BrowserColumn oficial');
assert.match(bridge,/\/api\/cards-official\/browser\/ids\?/,'Browser Study deve consultar IDs oficiais');
assert.match(bridge,/AnkiProductParity\._browserRows=\(\)=>self\._browserCache/,'linhas exibidas devem vir da ordem oficial em cache');
assert.match(bridge,/CardsScreen\.renderStats=\(box\)=>\{void this\.renderStats\(box\);\};/,'aba Stats dos Cards deve ser tomada pelo bridge oficial');
assert.match(db,/const createdMs = Date\.parse\(data && data\.createdAt \|\| ''\);/,'addCard deve ler createdAt histórico fornecido por importação oficial');
assert.match(db,/const createdAt = Number\.isFinite\(createdMs\) \? new Date\(createdMs\)\.toISOString\(\) : now;[\s\S]*?createdAt, updatedAt: now/,'addCard deve persistir o createdAt histórico validado');
assert.match(bridge,/_originalCreatedDay\(card\)[\s\S]{0,900}?card&&card\.createdAt/,'Stats deve preferir a criação histórica preservada no Study');
assert.match(bridge,/_statsOriginalAddedMap\(scopeIds\)[\s\S]{0,2600}?byOfficialId[\s\S]{0,2600}?this\._dayOffset/,'Adicionados deve reagrupar cards pela data original, deduplicando réplicas globais');
assert.match(bridge,/createdAt:seed\.createdAt\|\|this\._officialCreatedAt\(state\)/,'réplicas devem preservar createdAt histórico quando existir e usar o ID oficial só como fallback');
assert.match(bridge,/this\._statsOfficialAddedHtml\(addedMap\)/,'painel Adicionados deve renderizar a série histórica corrigida');
assert.match(backend,/def cards_official_collection_graphs_scoped[\s\S]{0,2200}?_study_scope_card_ids/,'backend deve devolver os IDs exatos do recorte usado pelo GraphsService');
assert.match(bridge,/\/api\/cards-official\/stats\/graphs\/scoped/,'Stats dos Cards devem consultar GraphsService oficial com o recorte Study');
assert.match(bridge,/Nenhum cálculo local foi usado como fallback/,'falha de Stats não pode cair para cálculo local');
assert.ok(!/this\._orig\.renderStats\(/.test(bridge),'Stats oficial não pode executar renderer local como fallback');
assert.ok(!statsMedia.includes('AnkiMediaStore'),'Cards não pode manter MediaStore IndexedDB paralelo ao MediaManager oficial');
assert.ok(!total.includes('study_anki_media'),'Cards não pode sincronizar mídia por tabela Study paralela');
assert.ok(!total.includes('content_b64'),'mídia não pode manter payload base64 paralelo ao backend oficial');
assert.ok(!product.includes('ensureCanonicalNotes('),'casca Cards não pode normalizar notas localmente ao carregar');
assert.ok(!/\bDB\.(?:addCard|updateCard|addDeck|saveCards|addRevlog)/.test(importer),'importador local deve ser apenas inspetor; mutação pertence ao Anki oficial');
assert.ok(!/AnkiParity\.(?:saveNote|saveNotetype|ensureIdentities)/.test(importer),'importador local não pode materializar Notes/NoteTypes');
assert.doesNotMatch(cards,/_readCardForm\(\)[\s\S]{0,1600}DB\.addDeck\(/,'primeiro baralho não pode ser criado localmente pelo formulário');
assert.doesNotMatch(cards,/saveCard\(closeAfter\)[\s\S]{0,1600}\bDB\.(?:addCard|updateCardNote)\(/,'salvar card deve delegar para Collection oficial');
assert.doesNotMatch(cards,/async deleteCard\(\)[\s\S]{0,900}\bDB\.deleteNoteByCard\(/,'excluir nota deve delegar para Collection oficial');
assert.doesNotMatch(cards,/data-unsusp[\s\S]{0,900}\bDB\.updateCard\(/,'reativar card na lista deve usar scheduler oficial');
assert.doesNotMatch(cards,/data-del[\s\S]{0,900}\bDB\.deleteCard\(/,'exclusão na lista deve seguir a exclusão de nota do Anki');
assert.match(bridge,/async deleteNoteForCard\(ref,ask\)[\s\S]*?this\.deleteOfficialNote\(note\)/,'lista deve excluir nota pela Collection oficial');
assert.doesNotMatch(practical,/_addSubdeck\(id\)[\s\S]{0,1200}DB\.addDeck/,'subbaralho deve nascer no DeckManager oficial');
assert.doesNotMatch(practical,/_simpleDestination\(\)[\s\S]{0,1600}DB\.addDeck/,'destino auxiliar não pode criar baralho local');

assert.ok(!/filteredSearchMatches\(/.test(bridge),'bridge oficial não pode executar parser de busca JS');
assert.match(backend,/item\.col\.sched\.set_due_date\(card_ids,/,'bulk due deve ser oficial');
assert.match(backend,/item\.col\.sched\.schedule_cards_as_new\(/,'bulk forget deve ser oficial');
assert.match(backend,/item\.col\.sched\.reposition_new_cards\(/,'bulk reposition deve ser oficial');
assert.match(backend,/item\.col\.set_user_flag_for_cards\(flag, card_ids\)/,'bulk flag deve ser oficial');
assert.match(backend,/item\.col\.tags\.bulk_add\(/,'tags add deve ser oficial');
assert.match(backend,/item\.col\.find_and_replace\(/,'find/replace deve ser oficial');
assert.match(bridge,/AnkiProductParity\.toggleSuspend=ids=>void self\._browserToggleSuspend/);
assert.match(bridge,/AnkiProductParity\.bulkFlag=ids=>void self\._browserBulkFlag/);
assert.match(bridge,/AnkiProductParity\.editTags=ids=>void self\._browserEditTags/);
assert.match(bridge,/AnkiMaxParity\._bulkCardsDue=ids=>void self\._browserSetDue/);
assert.ok(!/DB\.setDueSpec\(/.test(bridge),'bridge Browser não pode reagendar pelo DB local');
assert.ok(!/DB\.resetCard\(/.test(bridge),'bridge Browser não pode resetar pelo DB local');
assert.match(backend,/item\.col\.models\.change_notetype_info\(/,'mapa de mudança de tipo deve vir do Anki');
assert.match(backend,/item\.col\.models\.change_notetype_of_notes\(request\)/,'mudança de tipo deve ser executada pelo Anki');
assert.match(backend,/def cards_official_update_notetype[\s\S]*?item\.col\.models\.new_field\(name\)[\s\S]*?item\.col\.models\.add_field\(nt, field\)/,'campo novo de NoteType deve nascer no NoteTypeManager oficial');
assert.match(backend,/def cards_official_update_notetype[\s\S]*?item\.col\.models\.rename_field\(nt, field, name\)/,'renomear campo deve usar NoteTypeManager oficial');
assert.match(backend,/def cards_official_update_notetype[\s\S]*?item\.col\.models\.remove_field\(nt, field\)[\s\S]*?item\.col\.models\.reposition_field\(nt, field, idx\)/,'remoção e ordem de campos devem usar NoteTypeManager oficial');
assert.match(backend,/def cards_official_update_notetype[\s\S]*?item\.col\.models\.new_template\(name\)[\s\S]*?item\.col\.models\.add_template\(nt, template\)/,'template novo deve nascer no NoteTypeManager oficial');
assert.match(backend,/def cards_official_update_notetype[\s\S]*?item\.col\.models\.remove_template\(nt, template\)[\s\S]*?item\.col\.models\.reposition_template\(nt, template, idx\)/,'remoção e ordem de templates devem usar NoteTypeManager oficial');
assert.match(backend,/def cards_official_update_notetype[\s\S]*?item\.col\.models\.update_dict\(nt, skip_checks=False\)/,'persistência final de NoteType deve ser validada pelo Anki oficial');
assert.match(bridge,/async updateOfficialNotetype\(old,nt,notes,meta\)[\s\S]*?JSON\.stringify\(\{edit\}\)/,'Study deve enviar somente comandos semânticos da casca para o NoteTypeManager oficial');
assert.match(product,/fieldSources=.*?_source[\s\S]*?templateSources=.*?_sourceOrd[\s\S]*?CardsOfficialBridge\.updateOfficialNotetype\(old,clean,notes,\{fieldSources,templateSources\}\)/,'UI só deve indicar identidade visual de campos/templates; mutação pertence ao Anki');
assert.match(bridge,/input\.new_fields=\[\.\.\.document\.querySelectorAll/,'field map da UI deve virar new_fields oficial');
assert.match(bridge,/input\.new_templates=templates\.map/,'template map deve virar new_templates oficial');
assert.match(bridge,/await this\._reconcileOfficialCardSet\(out\.notes\|\|\[\],out\.cards\|\|\[\]\)/,'cards locais devem seguir conjunto final oficial');
assert.match(backend,/"question": card\.question\(\)/);
assert.match(backend,/"answer": card\.answer\(\)/);

assert.match(backend,/@app\.get\("\/api\/cards-official\/media\/\{filename:path\}"\)/);
assert.match(backend,/def cards_official_editor_media[\s\S]*?item\.col\.media\.write_data/,'mídia do editor precisa usar o MediaManager oficial');
assert.match(backend,/def cards_official_media_check[\s\S]*?item\.col\.media\.check\(\)/,'Check Media dos Cards deve usar MediaManager oficial');
assert.match(backend,/def cards_official_media_trash[\s\S]*?item\.col\.media\.trash_files\(files\)/,'Delete Unused deve mover arquivos pela lixeira oficial');
assert.match(backend,/def cards_official_media_restore_trash[\s\S]*?item\.col\.media\.restore_trash\(\)/,'Restore Deleted deve ser oficial');
assert.match(backend,/def cards_official_media_empty_trash[\s\S]*?item\.col\.media\.empty_trash\(\)/,'Empty Trash deve ser oficial');
assert.match(backend,/def cards_official_media_tag_missing[\s\S]*?item\.col\.tags\.bulk_add\(note_ids, "missing-media"\)/,'Tag Missing deve seguir mediacheck.py oficial');
assert.match(backend,/def cards_official_media_render_latex[\s\S]*?item\.col\.media\.render_all_latex\(\)/,'Render LaTeX deve usar o MediaManager oficial');
assert.match(bridge,/_officialTtsVoice\(tag\)[\s\S]*?tag&&tag\.voices[\s\S]*?tag&&tag\.lang/,'seleção de voz deve consumir voices/lang do TTSTag oficial');
assert.match(bridge,/async _playOfficialTts\(tag,token\)[\s\S]*?tag&&tag\.field_text[\s\S]*?this\._officialTtsVoice\(tag\)[\s\S]*?tag&&tag\.lang[\s\S]*?tag&&tag\.speed/,'TTS web deve consumir integralmente o TTSTag calculado pelo Anki');
assert.match(bridge,/async checkOfficialMedia\(\)[\s\S]*?\/api\/cards-official\/media\/check/,'UI Check Media deve consultar a Collection oficial');
assert.match(backend,/def cards_official_database_check[\s\S]*?item\.col\.fix_integrity\(\)/,'Check Database deve usar fix_integrity oficial');
assert.match(backend,/def cards_official_database_optimize[\s\S]*?item\.col\.optimize\(\)/,'Optimize deve usar Collection oficial');
assert.match(maxEditor,/CardsOfficialBridge\.uploadOfficialMedia\(f,f\.name\)/,'áudio\/vídeo do editor rico devem subir pelo backend oficial');
assert.ok(!/readAsDataURL/.test(maxEditor),'editor rico não pode persistir mídia nova como data URL');
assert.match(sanitizer,/async function insertImageFile[\s\S]*?CardsOfficialBridge\.uploadOfficialMedia/,'imagens do RTE devem subir pelo MediaManager oficial');
assert.match(backend,/def cards_official_image_occlusion_setup[\s\S]*?add_image_occlusion_notetype/,'Image Occlusion deve usar o stock notetype oficial');
assert.match(backend,/def cards_official_add_image_occlusion_note[\s\S]*?item\.col\.add_image_occlusion_note/,'criação de Image Occlusion deve usar Collection oficial');
assert.match(backend,/def cards_official_update_image_occlusion_note[\s\S]*?item\.col\.update_image_occlusion_note/,'edição de Image Occlusion deve usar Collection oficial');
assert.match(imageOcclusion,/CardsOfficialBridge\.saveOfficialImageOcclusion\(this\.state,payload\)/,'editor visual de IO deve salvar pelo backend oficial');
assert.match(imageOcclusion,/x\.toFixed\(4\)\.replace\(\/\^0\+\|0\+\$\/g,''\)/,'Image Occlusion deve usar floatToDisplay equivalente ao upstream');
assert.match(imageOcclusion,/image-occlusion:ellipse:[\s\S]*?:rx=[\s\S]*?:ry=/,'ellipse oficial deve serializar rx\/ry');
assert.ok(!/image-occlusion:ellipse:[^\n]*:width=/.test(imageOcclusion),'ellipse não pode gravar width\/height fora do contrato oficial');
assert.match(backend,/def cards_official_import_mnemosyne[\s\S]*?mnemosyne\.serialize[\s\S]*?item\.col\.import_json_string/,'Mnemosyne deve usar o serializer upstream do Anki');
assert.match(cards,/CardsOfficialBridge\.importOfficialMnemosyne\(this\._importFile,deckId\)/,'UI Mnemosyne deve executar primeiro no Anki oficial');
assert.match(backend,/def cards_official_csv_metadata[\s\S]*?item\.col\.get_csv_metadata/,'CsvMetadata deve vir do importador oficial');
assert.match(backend,/def cards_official_import_csv[\s\S]*?item\.col\.import_csv\(request\)/,'TXT\/CSV deve importar pela Collection oficial');
assert.match(backend,/def cards_official_export_notes_text[\s\S]*?item\.col\.export_note_csv/,'Notes in Plain Text deve ser exportado pelo Anki oficial');
assert.match(backend,/def cards_official_export_cards_text[\s\S]*?item\.col\.export_card_csv/,'Cards in Plain Text deve ser exportado pelo Anki oficial');
assert.match(cards,/CardsOfficialBridge\.importOfficialCsv\(this\._importFile,meta\)/,'execução da importação de texto da UI deve passar pelo Anki oficial');
assert.match(cards,/CardsOfficialBridge\.exportOfficialText\('notes'/,'exportação de notas da UI deve ser oficial');
assert.match(cards,/CardsOfficialBridge\.exportOfficialText\('cards'/,'exportação de cards da UI deve ser oficial');
assert.match(backend,/def cards_official_import_apkg[\s\S]*?item\.col\.import_anki_package\(request\)/,'APKG dos Cards deve importar pela Collection oficial');
assert.match(backend,/def cards_official_export_apkg[\s\S]*?item\.col\.export_anki_package/,'APKG dos Cards deve exportar pela Collection oficial');
assert.match(backend,/def cards_official_import_colpkg[\s\S]*?backend\.import_collection_package/,'COLPKG dos Cards deve importar pelo backend oficial');
assert.match(backend,/def cards_official_export_colpkg[\s\S]*?item\.col\.export_collection_package/,'COLPKG dos Cards deve exportar pela Collection oficial');
assert.match(bridge,/async exportOfficialPackage\(kind,options\)[\s\S]*?\/api\/cards-official\/export\//,'UI deve baixar o pacote produzido pelo Anki oficial');
assert.match(bridge,/async importOfficialPackage\(file,options\)[\s\S]*?\/api\/cards-official\/import\//,'UI deve executar importação de pacote no Anki oficial');
assert.match(backend,/def cards_official_collection_graphs[\s\S]*?item\.col\._backend\.graphs/,'Stats dos Cards precisam vir do Graphs oficial');
assert.match(backend,/def cards_official_custom_study[\s\S]*?item\.col\.sched\.custom_study/,'Custom Study dos Cards precisa usar scheduler oficial');
assert.match(bridge,/async runCustomStudy\(\)[\s\S]*?\/api\/cards-official\/custom-study/,'UI de Custom Study deve chamar a coleção oficial');
assert.ok(!/AnkiParity\.customStudy\(/.test(bridge),'bridge oficial não pode executar Custom Study local');
assert.match(bridge,/async saveFilteredDeckModal\(\)[\s\S]*?\/api\/cards-official\/filtered-deck\//,'UI de filtered deck deve salvar\/reconstruir no scheduler oficial');
assert.ok(!/AnkiParity\.saveFilteredDeck\(/.test(bridge),'bridge oficial não pode reconstruir filtered deck localmente');
assert.match(bridge,/async _syncCollectionState\([\s\S]*?await this\._syncStates\(cards\)/,'estado filtrado oficial deve voltar ao Study antes da próxima serialização');
assert.match(bridge,/ankiOriginalDue:Number\(state\.original_due\)\|\|0/,'odue oficial deve ser persistido cru para round-trip');
assert.match(backend,/def cards_official_rebuild_filtered_deck[\s\S]*?item\.col\.sched\.rebuild_filtered_deck/,'Filtered Deck dos Cards precisa usar scheduler oficial');
assert.match(backend,/def cards_official_add_deck[\s\S]*?add_normal_deck_with_name/,'criação de baralho deve usar DeckManager oficial');
assert.match(backend,/def cards_official_rename_deck[\s\S]*?item\.col\.decks\.rename/,'renomear baralho deve usar DeckManager oficial');
assert.match(backend,/def cards_official_delete_deck[\s\S]*?item\.col\.decks\.remove/,'excluir baralho deve usar DeckManager oficial');
assert.match(cards,/CardsOfficialBridge\.createOfficialDeck\(name\)/,'UI de criação de baralho deve ser uma casca sobre o Anki');
assert.match(bridge,/async createOfficialDeck\(name,planId\)[\s\S]*?\/api\/cards-official\/decks/,'qualquer criação de baralho deve passar pelo DeckManager oficial');
assert.match(bridge,/_reconcileLegacyDeckMirrors\(state\)[\s\S]*?officialCardDeck[\s\S]*?byName[\s\S]*?remappedCards/,'espelhos legados precisam ser reconciliados por evidência oficial e nome canônico, com remapeamento real');
assert.match(bridge,/async _syncOfficialFullState\(state,planId\)[\s\S]*?this\._reconcileLegacyDeckMirrors\(state\)[\s\S]*?_studyTargetsForState/,'reparo de baralhos precisa ocorrer antes da projeção do snapshot oficial');
assert.match(bridge,/_saveNormalDeckMirror\(row,planId,preferredLocalId\)[\s\S]*?legacy=list\.filter/,'salvar um deck oficial deve reaproveitar espelho legado homônimo em vez de criar outro Default');
assert.match(cards,/CardsOfficialBridge\.renameOfficialDeck\(id,value\)/,'UI de renomear baralho deve ser uma casca sobre o Anki');
assert.match(cards,/CardsOfficialBridge\.deleteOfficialDeck\(id\)/,'UI de exclusão de baralho deve ser uma casca sobre o Anki');
assert.match(backend,/def cards_official_deck_options[\s\S]*?get_deck_configs_for_update/,'Deck Options dos Cards precisam vir do DeckManager oficial');
assert.match(backend,/def cards_official_update_deck_options[\s\S]*?item\.col\.decks\.update_deck_configs\(request\)[\s\S]*?"state": cards_collection_state_payload/,'salvar Deck Options deve executar a transação oficial e devolver estado canônico');
assert.match(bridge,/async getDeckOptionsUi\(deckId\)[\s\S]*?\/api\/cards-official\/deck\/'/,'Deck Options exibidas pela casca devem ser lidas do backend oficial');
assert.match(bridge,/async updateDeckOptions\(deckId,cfg,opts\)[\s\S]*?\/api\/cards-official\/deck\/'/,'bridge deve salvar Deck Options no backend oficial');
assert.ok(!/\bCardsConfig\b/.test(bridge),'bridge oficial não pode usar CardsConfig como segunda fonte acadêmica');
assert.ok(!/CardEngine\./.test(bridge),'bridge oficial não pode chamar CardEngine');
assert.match(bridge,/targetId=isDeck\?\(opts\.forceCurrentPreset\?currentId:\(opts\.hadPreset\?currentId:0\)\):1/,'preset novo precisa usar id=0 e operações sobre o preset atual precisam preservar sua identidade canônica');
assert.match(bridge,/fsrs_reschedule:!!opts\.fsrsReschedule/,'reschedule de Deck Options deve ser delegado ao scheduler oficial');
assert.match(bridge,/async inheritDeckOptions\(deckId\)[\s\S]*?configs:\[conf\][\s\S]*?_saveDeckConfigIdentity\(deckId,ctx\.planId,selectedId\)/,'restaurar herança precisa reatribuir o deck ao preset global na Collection oficial');
assert.match(cards,/deck-inherit-btn[\s\S]*?CardsOfficialBridge\.inheritDeckOptions\(deckId\)/,'restaurar herança deve chamar apenas a operação oficial');
assert.match(cards,/CardsScreen\.openAlgoConfigFor = async function \(deckId\)[\s\S]*?CardsOfficialBridge\.getDeckOptionsUi/,'formulário de Deck Options deve abrir a partir do estado oficial');
assert.match(cards,/CardsOfficialBridge\.updateDeckOptions\(deckId, desiredCfg/,'UI de Deck Options deve salvar pela ponte oficial');
const deckOptionsShell=cards.slice(cards.indexOf('// Passo 1: escolher o ESCOPO'));
assert.ok(!/\bCardsConfig\b/.test(deckOptionsShell),'Deck Options/FSRS não podem ler nem persistir configuração acadêmica local');
assert.ok(!/const rescheduled=shouldReschedule\?await CardsScreen\.rescheduleFsrsScope\(deckId\):0/.test(cards),'salvar Deck Options não pode duplicar reschedule no scheduler local');
assert.match(backend,/def cards_official_fsrs_simulate[\s\S]*?simulate_fsrs_review/,'Simulador FSRS dos Cards precisa usar backend oficial');
assert.match(backend,/def cards_official_fsrs_optimize[\s\S]*?item\.col\._backend\.compute_fsrs_params/,'Optimize/Health Check precisam usar compute_fsrs_params do Anki oficial');
assert.match(bridge,/async computeFsrsParams\(deckId,healthCheck\)[\s\S]*?preset:\"[\s\S]*?-is:suspended[\s\S]*?\/api\/cards-official\/fsrs\/optimize/,'bridge FSRS deve usar a busca padrão do preset e o endpoint oficial');
assert.match(bridge,/async optimizeFsrsPreset\(deckId\)[\s\S]*?forceCurrentPreset:true/,'Optimize Current Preset não pode criar um preset novo para o deck');
assert.match(bridge,/async simulateFsrsPreset\(deckId,days,retention,opts,mode\)[\s\S]*?easy_days_percentages[\s\S]*?review_order[\s\S]*?\/api\/cards-official\/fsrs\/simulate\?mode=/,'simulador deve enviar o contrato oficial completo para a Collection');
assert.match(statsMedia,/async simulateOfficial\(days,retention,opts\)[\s\S]*?CardsOfficialBridge\.simulateFsrsPreset\(deckId,days,retention,opts,'review'\)/,'Simulador da UI deve usar simulate_fsrs_review oficial');
assert.match(statsMedia,/async runHelpMeDecide\(\)[\s\S]*?CardsOfficialBridge\.simulateFsrsPreset\(deckId,days,retention,opts,'optimal'\)[\s\S]*?optimal_retention/,'Help Me Decide deve usar compute_optimal_retention oficial');
assert.ok(!/simulate_json\(/.test(statsMedia),'simulador Cards não pode reconstruir a Collection localmente via simulate_json');
assert.ok(!/for\(let p=70;p<=99;p\+\+\)/.test(statsMedia),'Help Me Decide não pode estimar retenção ótima por varredura local');
assert.match(cards,/CardsOfficialBridge\.optimizeFsrsPreset\(deckId == null \? null : deckId\)/,'UI de Optimize deve delegar ao bridge oficial');
assert.match(cards,/CardsOfficialBridge\.fsrsHealthCheck\(deckId==null\?null:deckId\)/,'Health Check deve delegar ao compute_fsrs_params oficial');
assert.ok(!/FSRS\.optimizeOfficial\(this\._statsRevlog/.test(cards),'Deck Options não pode otimizar a partir do revlog local');
assert.ok(!/FSRS\.healthCheckOfficial\(this\._statsRevlog/.test(cards),'Health Check não pode avaliar a partir do revlog local');
assert.match(backend,/def cards_official_empty_cards_report[\s\S]*?item\.col\.get_empty_cards/,'Empty Cards dos Cards precisa usar Collection oficial');
assert.match(backend,/def cards_official_delete_empty_cards[\s\S]*?before = pb\(item\.col\.get_empty_cards\(\)\)[\s\S]*?remove_cards_and_orphaned_notes\(ids\)[\s\S]*?"state": cards_collection_state_payload/,'Empty Cards deve validar o relatório atual, excluir pela Collection oficial e devolver estado canônico');
assert.match(bridge,/async openEmptyCards\(\)[\s\S]*?\/api\/cards-official\/empty-cards[\s\S]*?cardIds\.slice\(1\)[\s\S]*?\/api\/cards-official\/empty-cards\/delete/,'UI Empty Cards deve usar o relatório oficial e preservar uma card quando a nota precisa ser mantida');
assert.match(bridge,/StudyGlobalScope\._removeProjectedNote\(note\)/,'nota órfã removida oficialmente deve ser espelhada em todos os planejamentos');
assert.match(cards,/value: '__empty__'[\s\S]*?CardsOfficialBridge\.openEmptyCards/,'ferramenta Empty Cards precisa estar acessível pela UI Cards');

const routes=[...backend.matchAll(/@app\.(?:get|post|put|delete)\("([^"]+)"/g)].map(m=>m[1]);
for(const path of [
  '/api/cards-official/status',
  '/api/cards-official/bootstrap',
  '/api/cards-official/bootstrap-state',
  '/api/cards-official/reviewer/next',
  '/api/cards-official/reviewer/answer',
  '/api/cards-official/reviewer/type-answer/{card_id}',
  '/api/cards-official/card/{card_id}/state',
  '/api/cards-official/cards/action',
  '/api/cards-official/notes',
  '/api/cards-official/note/{note_id}',
  '/api/cards-official/media/{filename:path}',
  '/api/cards-official/editor/media',
  '/api/cards-official/media/check',
  '/api/cards-official/media/trash',
  '/api/cards-official/media/restore-trash',
  '/api/cards-official/media/empty-trash',
  '/api/cards-official/media/tag-missing',
  '/api/cards-official/media/render-latex',
  '/api/cards-official/database/check',
  '/api/cards-official/database/optimize',
  '/api/cards-official/image-occlusion/setup',
  '/api/cards-official/image-occlusion/image',
  '/api/cards-official/image-occlusion/note',
  '/api/cards-official/image-occlusion/note/{note_id}',
  '/api/cards-official/import/mnemosyne',
  '/api/cards-official/import/csv/metadata',
  '/api/cards-official/import/csv',
  '/api/cards-official/export/notes-text',
  '/api/cards-official/export/cards-text',
  '/api/cards-official/import/apkg',
  '/api/cards-official/import/colpkg',
  '/api/cards-official/export/apkg',
  '/api/cards-official/export/colpkg',
  '/api/cards-official/browser/ids',
  '/api/cards-official/browser/facets',
  '/api/cards-official/browser/bulk',
  '/api/cards-official/notetypes/full',
  '/api/cards-official/notetypes/change-info',
  '/api/cards-official/notetypes/change',
  '/api/cards-official/preferences',
  '/api/cards-official/collection/state',
  '/api/cards-official/collection/full-state',
  '/api/cards-official/stats/graphs',
  '/api/cards-official/fsrs/optimize',
  '/api/cards-official/fsrs/simulate',
  '/api/cards-official/decks',
  '/api/cards-official/deck/{deck_id}',
  '/api/cards-official/deck/{deck_id}/options',
  '/api/cards-official/custom-study/defaults/{deck_id}',
  '/api/cards-official/custom-study',
  '/api/cards-official/filtered-deck/{deck_id}',
  '/api/cards-official/filtered-deck/{deck_id}/rebuild',
  '/api/cards-official/filtered-deck/{deck_id}/empty',
  '/api/cards-official/empty-cards',
  '/api/cards-official/empty-cards/delete',
]) assert.ok(routes.includes(path),'rota oficial ausente: '+path);

// Executa a ponte real: a nota devolvida pelo servidor é a autoridade, mesmo
// quando o card do revisor tem uma marca antiga. Irmãos e outros planos seguem
// as tags oficiais; uma falha de rede não pode alterar nenhum espelho.
const notes=[{id:11,ankiId:99,notetypeId:7,_planId:'a'},
             {id:22,ankiId:99,notetypeId:7,_planId:'b'}];
const mirrors=notes.flatMap(n=>[0,1].map(ord=>({id:n.id+':'+ord,noteId:n.id,_planId:n._planId,favorito:true})));
const toasts=[];
const context={window:{},document:{getElementById:()=>null},queueMicrotask(){},
  showToast:message=>toasts.push(message),
  CardsScreen:{updateFavCount(){}},
  AnkiParity:{saveNote(note){return note;}},
  AnkiProductParity:{_cardsForNote(note,pid){return mirrors.filter(c=>c.noteId===note.id&&c._planId===pid);}},
  StudyGlobalScope:{updateCardScoped(card,patch,pid){assert.equal(card._planId,pid);Object.assign(card,patch);return card;}}
};
context.window.StudyGlobalScope=context.StudyGlobalScope;
runInNewContext(bridge,context);
const live=context.window.CardsOfficialBridge;
live._noteReplicas=()=>notes;
live._localNotetypeId=()=>7;
live._applyReviewer=()=>{};
live.renderCurrent=async()=>{};
live.review={card:{id:101,marked:false}};
let tags=[];
live.request=async(path,opts)=>{
  assert.equal(path,'/api/cards-official/cards/action');
  assert.deepEqual(JSON.parse(opts.body),{action:'mark',card_ids:[101],value:null});
  return {notes:[{id:99,notetype_id:7,fields:{Front:'official'},tags}],reviewer:{}};
};
await live.mark();
assert.ok(mirrors.every(c=>c.favorito===false),'tags oficiais vazias desmarcam todos os irmãos e planos');
tags=['marked'];
await live.mark();
assert.ok(mirrors.every(c=>c.favorito===true),'tag oficial marca todos os irmãos e planos');
live.request=async()=>{throw new Error('offline');};
await live.mark();
assert.ok(mirrors.every(c=>c.favorito===true),'falha oficial preserva os espelhos');
assert.equal(toasts.at(-1),'offline');


const originalDateDelta=live._legacyDateDelta;
live._legacyDateDelta=()=>5;
for(const value of [undefined,null,'']){
  const card={phase:'review',template:'reverse',due:'2026-10-06',
    ankiType:value,ankiQueue:value,ankiDue:value,ankiTemplateOrd:value};
  assert.equal(live._legacyTemplateOrd(card),1,'valor ausente não é ordinal zero');
  const schedule=live._legacyScheduleRow(card,100);
  assert.equal(schedule.type,2);
  assert.equal(schedule.queue,2);
  assert.equal(schedule.due,105);
}
assert.equal(live._legacyScheduleRow({phase:'review',ankiType:2,ankiQueue:2,ankiDue:9000,due:'2026-10-06'},100).due,105,'review usa data de calendário no marco de destino');
assert.equal(live._legacyTemplateOrd({ankiTemplateOrd:0,template:'reverse'}),0,'zero explícito continua válido');
live._legacyDateDelta=originalDateDelta;


const staleCard={id:'stale',ankiId:999,_planId:'a'};
const snapshotMethod=live._legacyMigrationSnapshot,scopeMethod=live._scopeCards;
live._scopeCards=()=>[staleCard];
live._legacyMigrationSnapshot=()=>({
  payload:{notes:[{id:'legacy-note',guid:'matching-guid'}],cards:[{id:'legacy-card',note_id:'legacy-note',template_idx:0}]},
  cardRefs:new Map([['legacy-card',[{card:staleCard,planId:'a',localId:'stale'}]]])
});
assert.equal(await live._recoverLegacyIdentityFromOfficialState({
  reviewer:{timing:{today:1}},
  notes:[{id:99,guid:'matching-guid'}],cards:[{id:101,note_id:99,template_idx:0}]
}),1,'ID positivo ausente na Collection precisa ser reconciliado');
assert.equal(staleCard.ankiId,101);
live._legacyMigrationSnapshot=snapshotMethod;live._scopeCards=scopeMethod;

console.log('CARDS OFFICIAL BRIDGE: contratos estáticos e sincronização de marca oficial entre irmãos/planos verificados. Round-trip oficial exige o smoke Python.');
