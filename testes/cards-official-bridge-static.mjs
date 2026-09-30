#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const bridge=readFileSync(join(ROOT,'src/js/95-cards-official-bridge.js'),'utf8');
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
assert.match(backend,/@app\.get\("\/api\/cards-official\/media\/\{filename:path\}"\)/);

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
]) assert.ok(routes.includes(path),'rota oficial ausente: '+path);

console.log('CARDS OFFICIAL BRIDGE: scheduler/fila/rendering/type-answer/revlog/undo-redo/search/sort ancorados no anki==26.09.3, sem fallback acadêmico local.');
