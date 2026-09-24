/* Renderiza no Cards (AnkiParity.renderTemplate) os casos de render_oficial.py. */
import { readFileSync } from 'node:fs';
import { criarAmbiente } from '../cards-20260921-v2/harness.mjs';
const dados = JSON.parse(readFileSync(process.argv[2], 'utf8')), casos = dados.render || dados;
const a = criarAmbiente(); a.reset({ algo: 'fsrs' });
const { AnkiParity, DB } = a;
const semEstilo = h => String(h).replace(/<style>[\s\S]*?<\/style>/g, '');
let ok = 0;
for (const c of casos) {
  DB.saveDecks([{ id: 'd', nome: c.deck, createdAt: '2026-01-01T00:00:00Z' }]);
  const nt = c.cloze ? AnkiParity._stockNotetypeDef('cloze') : { name: c.modelo, kind: 'normal', fields: Object.keys(c.campos).map(n => ({ name: n })), templates: [{ name: c.cartao, qfmt: c.qfmt, afmt: c.afmt }] };
  const note = { id: 1, fields: c.campos, tags: c.tags };
  const card = { id: 'x', ankiTemplateOrd: c.ord, deckId: 'd' };
  let q = AnkiParity.renderTemplate(nt, note, c.ord, 'question', card, '');
  const r = AnkiParity.renderTemplate(nt, note, c.ord, 'answer', card, q);
  let qa = semEstilo(c.pergunta), ra = semEstilo(c.resposta);
  if (c.tts && c.tts.length) { qa = c.tts.map(([l, t]) => `[anki:tts lang=${l}]${t}[/anki:tts]`).join(''); }
  const igual = q === qa && r === ra;
  if (igual) ok++;
  else console.log('✗', c.nome, '\n   anki Q:', JSON.stringify(qa), '\n   app  Q:', JSON.stringify(q), '\n   anki A:', JSON.stringify(ra), '\n   app  A:', JSON.stringify(r));
}
console.log(`\nRENDER: ${ok}/${casos.length} casos idênticos ao Anki 26.09.2`);
if (dados.geracao) {
  const g = dados.geracao, nt = { name: 'M_geracao', kind: 'normal', fields: ['Front', 'Back', 'Extra'].map(name => ({ name })),
    templates: g.templates.map((q, i) => ({ name: 'T' + (i + 1), qfmt: q, afmt: '{{Front}}' })) };
  let gok = 0;
  g.notas.forEach(n => {
    const app = g.templates.map((_, ord) => ord).filter(ord => AnkiParity.templateGeraCard(nt, { fields: n.campos, tags: n.tags }, ord));
    const igual = JSON.stringify(app) === JSON.stringify(n.ords); if (igual) gok++;
    else console.log('✗ geração', JSON.stringify(n.campos), n.tags, 'anki', n.ords, 'app', app);
  });
  console.log(`GERAÇÃO DE CARDS: ${gok}/${g.notas.length} notas com os mesmos cards do Anki 26.09.2`);
}
