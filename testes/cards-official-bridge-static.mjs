#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const bridge=readFileSync(join(ROOT,'src/js/95-cards-official-bridge.js'),'utf8');
const cards=readFileSync(join(ROOT,'src/js/44-tela-cards.js'),'utf8');
const statsMedia=readFileSync(join(ROOT,'src/js/44-anki-max-stats-media.js'),'utf8');
const maxEditor=readFileSync(join(ROOT,'src/js/44-anki-max-editor.js'),'utf8');
const imageOcclusion=readFileSync(join(ROOT,'src/js/44-anki-image-occlusion.js'),'utf8');
const sanitizer=readFileSync(join(ROOT,'src/js/46-sanitizacao-e-editor.js'),'utf8');
const exporter=readFileSync(join(ROOT,'src/js/34-anki-export.js'),'utf8');
const backend=readFileSync(join(ROOT,'anki_official_backend/app.py'),'utf8');
const build=readFileSync(join(ROOT,'build.mjs'),'utf8');
const req=readFileSync(join(ROOT,'anki_official_backend/requirements.txt'),'utf8');

assert.match(req,/^anki==26\.09\.3$/m,'backend precisa fixar exatamente anki==26.09.3');
assert.match(build,/'js\/95-cards-official-bridge\.js'/,'bridge precisa entrar no build publicado');

for(const forbidden of [
  'CardEngine.schedule(',
  'CardEngine.previewIntervals(',
  'CardsScreen.buildQueue('
]){
  assert.ok(!bridge.includes(forbidden),'reviewer oficial não pode cair para '+forbidden);
}
assert.match(bridge,/canonicalAnkiIds:true/,'bootstrap precisa deduplicar replicas pelo ankiId');
assert.match(bridge,/canonicalAnkiIds:true,preserveFiltered:true/,'bootstrap oficial precisa preservar filtered deck e odid\/odue entre recargas');
assert.match(bridge,/\/api\/cards-official\/bootstrap/);
assert.match(bridge,/\/api\/cards-official\/reviewer\/answer/);
assert.match(bridge,/\/api\/cards-official\/reviewer\/type-answer\//);
assert.match(bridge,/\/api\/cards-official\/undo/);
assert.match(bridge,/\/api\/cards-official\/redo/);
assert.match(bridge,/\/api\/cards-official\/media\//);
assert.match(bridge,/const replayTxn=await this\._persistAnswered\(state,false\)/,'redo deve criar novo journal');
assert.match(bridge,/queue===1\|\|queue===4/,'Learn/PreviewRepeat usam timestamp oficial');
assert.match(bridge,/Number\(state\.due\)-\(Number\(timing\.today\)\|\|0\)/,'Review/DayLearn usam dia oficial');
assert.match(bridge,/state\.review_logs&&state\.review_logs\[0\]/,'revlog local deve vir do log oficial');
assert.match(bridge,/mem\.stability/);
assert.match(bridge,/mem\.difficulty/);

assert.match(backend,/cards_pool = CollectionPool\(namespace="study-cards"\)/,'Cards precisa de coleção oficial isolada');
assert.match(backend,/def cards_uc_for/);
assert.match(backend,/item\.col\.sched\.get_queued_cards\(fetch_limit=1\)/);
assert.match(backend,/item\.col\.sched\.build_answer\(card=card, states=q\.states, rating=rating\)/);
assert.match(backend,/item\.col\.sched\.answer_card\(answer\)/);
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
assert.match(bridge,/\/api\/cards-official\/stats\/graphs\?/,'Stats dos Cards devem consultar GraphsService da coleção isolada');
assert.match(bridge,/Nenhum cálculo local foi usado como fallback/,'falha de Stats não pode cair para cálculo local');
assert.ok(!/this\._orig\.renderStats\(/.test(bridge),'Stats oficial não pode executar renderer local como fallback');

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
assert.match(bridge,/async _playOfficialTts\(tag\)[\s\S]*?tag&&tag\.field_text[\s\S]*?this\._officialTtsVoice\(tag\)[\s\S]*?tag&&tag\.lang[\s\S]*?tag&&tag\.speed/,'TTS web deve consumir integralmente o TTSTag calculado pelo Anki');
assert.match(bridge,/async checkOfficialMedia\(\)[\s\S]*?\/api\/cards-official\/media\/check/,'UI Check Media deve consultar a Collection oficial');
assert.match(backend,/def cards_official_database_check[\s\S]*?item\.col\.fix_integrity\(\)/,'Check Database deve usar fix_integrity oficial');
assert.match(backend,/def cards_official_database_optimize[\s\S]*?item\.col\.optimize\(\)/,'Optimize deve usar Collection oficial');
assert.match(maxEditor,/CardsOfficialBridge\.uploadOfficialMedia\(f,f\.name\)/,'áudio\/vídeo do editor rico devem subir pelo backend oficial');
assert.ok(!/readAsDataURL/.test(maxEditor),'editor rico não pode persistir mídia nova como data URL');
assert.match(sanitizer,/async function insertImageFile[\s\S]*?CardsOfficialBridge\.uploadOfficialMedia/,'imagens do RTE devem subir pelo MediaManager oficial');
assert.match(exporter,/registerExternalMedia\(/,'exportador deve registrar bytes de mídia oficial');
assert.match(exporter,/async _hydrateExternalMedia\(cards\)[\s\S]*?CardsOfficialBridge\._fetchMedia/,'exportador deve reidratar mídia oficial após reload');
assert.match(exporter,/await this\._hydrateExternalMedia\(cards\)/,'bootstrap/exportação não pode empacotar coleção antes de hidratar mídia');
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
assert.match(cards,/CardsOfficialBridge\.renameOfficialDeck\(id,value\)/,'UI de renomear baralho deve ser uma casca sobre o Anki');
assert.match(cards,/CardsOfficialBridge\.deleteOfficialDeck\(id\)/,'UI de exclusão de baralho deve ser uma casca sobre o Anki');
assert.match(backend,/def cards_official_deck_options[\s\S]*?get_deck_configs_for_update/,'Deck Options dos Cards precisam vir do DeckManager oficial');
assert.match(backend,/def cards_official_update_deck_options[\s\S]*?item\.col\.decks\.update_deck_configs\(request\)[\s\S]*?"state": cards_collection_state_payload/,'salvar Deck Options deve executar a transação oficial e devolver estado canônico');
assert.match(bridge,/async updateDeckOptions\(deckId,cfg,opts\)[\s\S]*?\/api\/cards-official\/deck\/'/,'bridge deve salvar Deck Options no backend oficial');
assert.match(bridge,/targetId=isDeck\?\(opts\.forceCurrentPreset\?currentId:\(opts\.hadPreset\?currentId:0\)\):1/,'preset novo precisa usar id=0 e operações sobre o preset atual precisam preservar sua identidade canônica');
assert.match(bridge,/fsrs_reschedule:!!opts\.fsrsReschedule/,'reschedule de Deck Options deve ser delegado ao scheduler oficial');
assert.match(bridge,/async inheritDeckOptions\(deckId\)[\s\S]*?configs:\[conf\][\s\S]*?_saveDeckConfigIdentity\(deckId,ctx\.planId,selectedId\)/,'restaurar herança precisa reatribuir o deck ao preset global na Collection oficial');
assert.match(cards,/deck-inherit-btn[\s\S]*?CardsOfficialBridge\.inheritDeckOptions\(deckId\)[\s\S]*?CardsConfig\.clearDeckPreset\(deckId\)/,'cache local só pode limpar o preset depois que o Anki oficial confirmar a herança');
assert.match(cards,/CardsOfficialBridge\.updateDeckOptions\(deckId, desiredCfg/,'UI de Deck Options deve chamar a ponte oficial antes de persistir o cache local');
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
assert.match(bridge,/StudyGlobalScope\.deleteNoteScoped\(note\)/,'nota órfã removida oficialmente deve ser espelhada em todos os planejamentos');
assert.match(cards,/value: '__empty__'[\s\S]*?CardsOfficialBridge\.openEmptyCards/,'ferramenta Empty Cards precisa estar acessível pela UI Cards');

const routes=[...backend.matchAll(/@app\.(?:get|post|put|delete)\("([^"]+)"/g)].map(m=>m[1]);
for(const path of [
  '/api/cards-official/status',
  '/api/cards-official/bootstrap',
  '/api/cards-official/reviewer/next',
  '/api/cards-official/reviewer/answer',
  '/api/cards-official/reviewer/type-answer/{card_id}',
  '/api/cards-official/card/{card_id}/state',
  '/api/cards-official/undo',
  '/api/cards-official/redo',
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
  '/api/cards-official/collection/state',
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

console.log('CARDS OFFICIAL BRIDGE: reviewer/browser/stats/deck-options/custom-study/filtered-decks ancorados no anki==26.09.3, com round-trip oficial e sem fallback acadêmico local.');
