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
  await page.waitForFunction(() => window.TecIntegracaoScreen && window.TecRealtime && window.ProfileUI, { timeout: 30000 });
  const result = await page.evaluate(() => {
    try { ProfileUI.hideGate(); } catch (_) {}
    TecIntegracaoScreen.init(); TecRealtime.init();
    const frame = document.getElementById('tec-workspace-frame');
    const legacyPayload = { source: 'StudyMentorTEC', version: 21, type: 'question', payload: {
      tecAccount: 'tec_anonimo', bookId: 'caderno-7', history: { total: 3, acertos: 1, erros: 2 },
      question: { id: '123456', materia: 'Direito Tributário', assunto: 'Impostos', enunciado: 'Enunciado de teste', acertou: false,
        marcada: 'B', correta: 'A', alternativas: [{ letra: 'A', texto: 'Correta' }, { letra: 'B', texto: 'Marcada' }] }
    } };
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://site-malicioso.example', source: frame.contentWindow, data: legacyPayload }));
    const afterBad = TecIntegracaoScreen.metrics(TecIntegracaoScreen.state()).questions;
    window.dispatchEvent(new MessageEvent('message', { origin: TecIntegracaoScreen.TEC_ORIGIN, source: frame.contentWindow, data: legacyPayload }));
    window.dispatchEvent(new MessageEvent('message', { origin: TecIntegracaoScreen.TEC_ORIGIN, source: frame.contentWindow, data: legacyPayload }));
    const state = TecIntegracaoScreen.state(), metrics = TecIntegracaoScreen.metrics(state);
    localStorage.removeItem(TecRealtime._key());

    const day = todayLocal();
    const base = {
      source: 'StudyMentorCompanion', protocol: 1, type: 'resolution', createdAtMs: Date.now(),
      payload: { tecAccount:'tec_conta_a', bookId:'caderno-9', question:{ id:'777001', materia:'Auditoria', assunto:'Materialidade', enunciado:'Teste realtime', marcada:'C', correta:'A', acertou:false },
        resolution:{ eventId:'res-1', questionId:'777001', tecAccount:'tec_conta_a', bookId:'caderno-9', resolvedAt:new Date().toISOString(), localDate:day, acertou:false, marcada:'C', correta:'A', materia:'Auditoria', assunto:'Materialidade' } }
    };
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data:{...base,messageId:'res-1'} }));
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data:{...base,messageId:'res-1'} }));
    const second = JSON.parse(JSON.stringify(base));
    second.messageId='res-2'; second.payload.resolution.eventId='res-2'; second.payload.resolution.acertou=true; second.payload.resolution.marcada='A'; second.payload.question.acertou=true; second.payload.question.marcada='A'; second.payload.resolution.resolvedAt=new Date(Date.now()+1000).toISOString();
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data:second }));
    const rt = TecRealtime.state();
    const rows = TecRealtime.rows({from:day,to:day});
    const summary = TecRealtime.summary(rows);
    TecRealtime.render();
    return { afterBad, metrics, rowCount: document.querySelectorAll('.tec-question-row').length,
      statement: document.querySelector('.tec-question-statement')?.textContent,
      selected: document.querySelector('.tec-question-alternatives .selected')?.textContent,
      correct: document.querySelector('.tec-question-alternatives .correct')?.textContent,
      realtimeCount:Object.keys(rt.events||{}).length, summary,
      radar:document.querySelector('#tec-realtime-card')?.textContent || '' };
  });
  assert.equal(result.afterBad, 0, 'mensagem de outro domínio deve ser ignorada');
  assert.deepEqual(result.metrics, { questions: 1, errors: 1, books: 1, pending: 1 }, 'recepção repetida deve ser idempotente');
  assert.equal(result.rowCount >= 1, true, 'a biblioteca deve exibir questão');
  assert.match(result.statement, /Teste realtime|Enunciado de teste/);
  assert.equal(result.realtimeCount, 2, 'duas tentativas distintas devem ficar no log; duplicata exata não');
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.uniqueWrong, 1);
  assert.equal(result.summary.corrected, 1, 'erro seguido de acerto deve ser reconhecido como corrigido');
  assert.match(result.radar, /Radar TEC em tempo real/);
  console.log('INTEGRAÇÃO TEC BROWSER: origem, deduplicação, histórico append-only e Radar validados.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
