#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const bridge=readFileSync(join(ROOT,'src/js/95-cards-official-bridge.js'),'utf8');
const cards=readFileSync(join(ROOT,'src/js/44-tela-cards.js'),'utf8');
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
assert.match(backend,/def cards_official_collection_graphs[\s\S]*?item\.col\._backend\.graphs/,'Stats dos Cards precisam vir do Graphs oficial');
assert.match(backend,/def cards_official_custom_study[\s\S]*?item\.col\.sched\.custom_study/,'Custom Study dos Cards precisa usar scheduler oficial');
assert.match(bridge,/async runCustomStudy\(\)[\s\S]*?\/api\/cards-official\/custom-study/,'UI de Custom Study deve chamar a coleção oficial');
assert.ok(!/AnkiParity\.customStudy\(/.test(bridge),'bridge oficial não pode executar Custom Study local');
assert.match(bridge,/async saveFilteredDeckModal\(\)[\s\S]*?\/api\/cards-official\/filtered-deck\//,'UI de filtered deck deve salvar\/reconstruir no scheduler oficial');
assert.ok(!/AnkiParity\.saveFilteredDeck\(/.test(bridge),'bridge oficial não pode reconstruir filtered deck localmente');
assert.match(bridge,/async _syncCollectionState\([\s\S]*?await this\._syncStates\(cards\)/,'estado filtrado oficial deve voltar ao Study antes da próxima serialização');
assert.match(bridge,/ankiOriginalDue:Number\(state\.original_due\)\|\|0/,'odue oficial deve ser persistido cru para round-trip');
assert.match(backend,/def cards_official_rebuild_filtered_deck[\s\S]*?item\.col\.sched\.rebuild_filtered_deck/,'Filtered Deck dos Cards precisa usar scheduler oficial');
assert.match(backend,/def cards_official_deck_options[\s\S]*?get_deck_configs_for_update/,'Deck Options dos Cards precisam vir do DeckManager oficial');
assert.match(backend,/def cards_official_update_deck_options[\s\S]*?item\.col\.decks\.update_deck_configs\(request\)[\s\S]*?"state": cards_collection_state_payload/,'salvar Deck Options deve executar a transação oficial e devolver estado canônico');
assert.match(bridge,/async updateDeckOptions\(deckId,cfg,opts\)[\s\S]*?\/api\/cards-official\/deck\/'/,'bridge deve salvar Deck Options no backend oficial');
assert.match(bridge,/targetId=isDeck\?\(opts\.hadPreset\?currentId:0\):1/,'preset novo precisa usar id=0 para o Anki alocar identidade canônica');
assert.match(bridge,/fsrs_reschedule:!!opts\.fsrsReschedule/,'reschedule de Deck Options deve ser delegado ao scheduler oficial');
assert.match(cards,/CardsOfficialBridge\.updateDeckOptions\(deckId, desiredCfg/,'UI de Deck Options deve chamar a ponte oficial antes de persistir o cache local');
assert.ok(!/const rescheduled=shouldReschedule\?await CardsScreen\.rescheduleFsrsScope\(deckId\):0/.test(cards),'salvar Deck Options não pode duplicar reschedule no scheduler local');
assert.match(backend,/def cards_official_fsrs_simulate[\s\S]*?simulate_fsrs_review/,'Simulador FSRS dos Cards precisa usar backend oficial');
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
  '/api/cards-official/media/{filename:path}',
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
