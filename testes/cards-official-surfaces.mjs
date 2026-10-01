import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const ROOT=process.cwd();
const bridge=readFileSync(join(ROOT,'src/js/95-cards-official-bridge.js'),'utf8');
const backend=readFileSync(join(ROOT,'anki_official_backend/app.py'),'utf8');
const html=readFileSync(join(ROOT,'src/html/03-corpo.html'),'utf8');
const sourceFiles=[
  'src/js/35-anki-import.js','src/js/44-anki-parity.js','src/js/44-anki-product-parity.js',
  'src/js/44-anki-total-parity.js','src/js/44-anki-practical-10.js','src/js/44-anki-10of10-final.js',
  'src/js/44-anki-max-reviewer-browser.js','src/js/44-anki-max-editor.js','src/js/44-anki-image-occlusion.js',
  'src/js/44-anki-max-image-occlusion.js','src/js/44-anki-max-stats-media.js','src/js/44-tela-cards.js',
  'src/js/46-sanitizacao-e-editor.js','src/js/94-global-scope.js','src/js/95-cards-official-bridge.js'
];
const all=sourceFiles.map(p=>readFileSync(join(ROOT,p),'utf8')).join('\n');

const backendRoutes=[...backend.matchAll(/@app\.(?:get|post|put|delete)\("([^"]+)"\)/g)].map(m=>m[1]);
const clientPrefixes=[...new Set([...bridge.matchAll(/['"`](\/api\/cards-official\/[^'"`+?$)]*)/g)].map(m=>m[1].replace(/\/$/,'')))];
for(const prefix of clientPrefixes){
  const ok=backendRoutes.some(route=>{
    const staticPrefix=route.split('{')[0].replace(/\/$/,'');
    return route===prefix || route.startsWith(prefix+'/') || prefix.startsWith(staticPrefix);
  });
  assert.ok(ok,'rota usada pelo Cards sem endpoint oficial correspondente: '+prefix);
}
assert.ok(clientPrefixes.length>=25,'inventário de rotas Cards ficou pequeno demais: '+clientPrefixes.length);

const start=html.indexOf('<!-- ============ TELA: CARDS DE REVISÃO');
const end=html.indexOf('<div id="link-modal"',start);
assert.ok(start>=0&&end>start,'segmento HTML dos Cards não encontrado');
const segment=html.slice(start,end);
const buttonIds=[...new Set([...segment.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1])
  .filter(id=>!id.startsWith('anki-')&&!id.startsWith('link-')&&!id.startsWith('resumo-')))];
for(const id of buttonIds)assert.ok(all.includes(id),'botão Cards sem handler/referência JS: '+id);
assert.ok(buttonIds.length>=40,'cobertura de botões Cards inesperadamente baixa: '+buttonIds.length);

const critical=[
  ['hook criar/salvar',/CardsScreen\.saveCard=.*saveSimpleCard/],
  ['salvar chama Note oficial',/async saveSimpleCard\([\s\S]*?addOfficialNote\(/],
  ['criar Note no backend oficial',/async addOfficialNote\([\s\S]*?\/api\/cards-official\/notes/],
  ['hook excluir',/CardsScreen\.deleteCard=.*deleteSimpleCard/],
  ['excluir chama Note oficial',/async deleteSimpleCard\([\s\S]*?deleteOfficialNote\(/],
  ['excluir Note no backend oficial',/async deleteOfficialNote\([\s\S]*?\/api\/cards-official\/note\//],
  ['reviewer',/\/api\/cards-official\/reviewer\/answer/],
  ['type answer',/\/api\/cards-official\/reviewer\/type-answer\//],
  ['custom study',/async runCustomStudy\(\)[\s\S]*?\/api\/cards-official\/custom-study/],
  ['filtered deck',/async saveFilteredDeckModal\(\)[\s\S]*?\/api\/cards-official\/filtered-deck\//],
  ['stats',/\/api\/cards-official\/stats\/graphs/],
  ['deck options',/\/api\/cards-official\/deck\/[\s\S]*?\/options/],
  ['empty cards',/\/api\/cards-official\/empty-cards/],
  ['media',/\/api\/cards-official\/media\/check/],
  ['image occlusion',/\/api\/cards-official\/image-occlusion\//],
  ['import apkg',/\/api\/cards-official\/import\/apkg/],
  ['export apkg',/\/api\/cards-official\/export\/apkg/],
  ['undo',/\/api\/cards-official\/undo/],
  ['redo',/\/api\/cards-official\/redo/],
  ['browser',/\/api\/cards-official\/browser\/ids/],
  ['migração automática',/if\(!officialCount&&localCount\)[\s\S]*?_migrateLegacyCollection\(\)/]
];
for(const [name,re] of critical)assert.match(bridge,re,'recurso acadêmico não termina no Anki oficial: '+name);

const forbidden=[
  /\bCardEngine\./,/\bCardsConfig\./,/\bAnkiMediaStore\b/,/filteredSearchMatches\(/,
  /CardEngine\.schedule\(/,/CardEngine\.previewIntervals\(/,/AnkiParity\.customStudy\(/,/AnkiParity\.saveFilteredDeck\(/
];
for(const re of forbidden)assert.doesNotMatch(all,re,'motor/recurso acadêmico local proibido reapareceu: '+re);

console.log('CARDS OFFICIAL SURFACES: '+buttonIds.length+' botões estáticos com handler; '+clientPrefixes.length+' famílias de rotas ligadas ao backend oficial; recursos críticos sem fallback local.');
