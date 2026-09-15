import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(readFileSync(join(root, 'index.html'))); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.TecIntegracaoScreen && window.ProfileUI, { timeout: 30000 });
  const result = await page.evaluate(() => {
    try { ProfileUI.hideGate(); } catch (_) {}
    TecIntegracaoScreen.init();
    const frame = document.getElementById('tec-workspace-frame');
    const payload = { source: 'StudyMentorTEC', version: 21, type: 'question', payload: {
      tecAccount: 'tec_anonimo', bookId: 'caderno-7', history: { total: 3, acertos: 1, erros: 2 },
      question: { id: '123456', materia: 'Direito Tributário', assunto: 'Impostos', enunciado: 'Enunciado de teste', acertou: false,
        marcada: 'B', correta: 'A', alternativas: [{ letra: 'A', texto: 'Correta' }, { letra: 'B', texto: 'Marcada' }] }
    } };
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://site-malicioso.example', source: frame.contentWindow, data: payload }));
    const afterBad = TecIntegracaoScreen.metrics(TecIntegracaoScreen.state()).questions;
    window.dispatchEvent(new MessageEvent('message', { origin: TecIntegracaoScreen.TEC_ORIGIN, source: frame.contentWindow, data: payload }));
    window.dispatchEvent(new MessageEvent('message', { origin: TecIntegracaoScreen.TEC_ORIGIN, source: frame.contentWindow, data: payload }));
    const state = TecIntegracaoScreen.state(), metrics = TecIntegracaoScreen.metrics(state);
    return { afterBad, metrics, rowCount: document.querySelectorAll('.tec-question-row').length,
      statement: document.querySelector('.tec-question-statement')?.textContent,
      selected: document.querySelector('.tec-question-alternatives .selected')?.textContent,
      correct: document.querySelector('.tec-question-alternatives .correct')?.textContent };
  });
  assert.equal(result.afterBad, 0, 'mensagem de outro domínio deve ser ignorada');
  assert.deepEqual(result.metrics, { questions: 1, errors: 1, books: 1, pending: 1 }, 'recepção repetida deve ser idempotente');
  assert.equal(result.rowCount, 1, 'a biblioteca deve exibir uma única questão');
  assert.match(result.statement, /Enunciado de teste/);
  assert.match(result.selected, /^B\)/);
  assert.match(result.correct, /^A\)/);
  console.log('INTEGRAÇÃO TEC BROWSER: origem, deduplicação e renderização validadas.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
