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
  await page.waitForFunction(() => window.TecIntegracaoScreen && window.TecRealtime && window.ProfileUI && window.TecWorkspaceKeepalive && window.TecTrustGate, { timeout: 30000 });
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
    const integrityErr={schema:3,status:'verified',confidence:'high',source:'marked-vs-gabarito',marked:'C',correct:'A',canonicalResult:false,conflict:false,conflictResolved:false};
    const base = {
      source: 'StudyMentorCompanion', protocol: 1, extensionVersion:'1.2.0', type: 'resolution', createdAtMs: Date.now(),
      payload: { tecAccount:'tec_conta_a', bookId:'caderno-9', integrity:integrityErr,
        question:{ id:'777001', materia:'Auditoria', assunto:'Materialidade', enunciado:'Teste realtime', marcada:'C', correta:'A', acertou:false, integrity:integrityErr },
        resolution:{ eventId:'res-1', questionId:'777001', tecAccount:'tec_conta_a', bookId:'caderno-9', resolvedAt:new Date().toISOString(), localDate:day, acertou:false, marcada:'C', correta:'A', materia:'Auditoria', assunto:'Materialidade', integrity:integrityErr } }
    };

    /* O contrato 1.2 exige vínculo explícito de usuário/perfil antes de aceitar
       mensagens do Companion. Neste browser isolado não há sessão autenticada,
       portanto a ponte DEVE rejeitar a mensagem em vez de gravá-la no perfil. */
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data:{...base,messageId:'unrouted-1'} }));
    const unroutedCount=Object.keys(TecRealtime.state().events||{}).length;

    /* A persistência/deduplicação do motor realtime é validada diretamente.
       Roteamento/ACK por perfil é coberto pelos contratos dedicados do Companion. */
    TecRealtime.ingest(base.payload,'res-1');
    TecRealtime.ingest(base.payload,'res-1');
    const second = JSON.parse(JSON.stringify(base));
    second.messageId='res-2'; second.payload.resolution.eventId='res-2'; second.payload.resolution.acertou=true; second.payload.resolution.marcada='A'; second.payload.question.acertou=true; second.payload.question.marcada='A'; second.payload.resolution.resolvedAt=new Date(Date.now()+1000).toISOString();
    const integrityOk={schema:3,status:'verified',confidence:'high',source:'marked-vs-gabarito',marked:'A',correct:'A',canonicalResult:true,conflict:false,conflictResolved:false};
    second.payload.integrity=integrityOk; second.payload.question.integrity=integrityOk; second.payload.resolution.integrity=integrityOk;
    TecRealtime.ingest(second.payload,'res-2');
    const rt = TecRealtime.state();
    const rows = TecRealtime.rows({from:day,to:day});
    const summary = TecRealtime.summary(rows);
    TecRealtime.render();
    return { afterBad, metrics, unroutedCount, rowCount: document.querySelectorAll('.tec-question-row').length,
      statement: document.querySelector('.tec-question-statement')?.textContent,
      selected: document.querySelector('.tec-question-alternatives .selected')?.textContent,
      correct: document.querySelector('.tec-question-alternatives .correct')?.textContent,
      realtimeCount:Object.keys(rt.events||{}).length, summary,
      radar:document.querySelector('#tec-realtime-card')?.textContent || '' };
  });
  assert.equal(result.afterBad, 0, 'mensagem de outro domínio deve ser ignorada');
  assert.deepEqual(result.metrics, { questions: 1, errors: 1, books: 1, pending: 1 }, 'recepção repetida deve ser idempotente');
  assert.equal(result.unroutedCount, 0, 'Companion sem vínculo de usuário/perfil não pode contaminar o histórico');
  assert.equal(result.rowCount >= 1, true, 'a biblioteca deve exibir questão');
  assert.match(result.statement, /Teste realtime|Enunciado de teste/);
  assert.equal(result.realtimeCount, 2, 'duas tentativas distintas devem ficar no log; duplicata exata não');
  assert.equal(result.summary.errors, 1);
  assert.equal(result.summary.uniqueWrong, 1);
  assert.equal(result.summary.corrected, 1, 'erro seguido de acerto deve ser reconhecido como corrigido');
  assert.match(result.radar, /Radar TEC em tempo real/);

  /* Regressão do caderno que reiniciava ao trocar de menu. Usamos about:blank
     para testar o browsing context sem depender da rede/conta real do TEC. */
  await page.evaluate(() => {
    const frame = document.getElementById('tec-workspace-frame');
    frame.src = 'about:blank'; frame.hidden = false;
    switchScreen('integracaotec');
  });
  await page.waitForTimeout(80);
  const before = await page.evaluate(() => {
    const frame = document.getElementById('tec-workspace-frame');
    frame.contentWindow.name = 'snm-caderno-preservado';
    return { node: frame.dataset.tecKeepaliveObserved, name: frame.contentWindow.name };
  });
  assert.equal(before.node, '1', 'iframe TEC deve estar sob keepalive');
  assert.equal(before.name, 'snm-caderno-preservado');

  await page.evaluate(() => switchScreen('registrar'));
  await page.waitForTimeout(80);
  const parked = await page.evaluate(() => {
    const s = document.getElementById('screen-integracaotec');
    const cs = getComputedStyle(s);
    return { parked:s.classList.contains('tec-screen-parked'), display:cs.display, position:cs.position, inert:s.hasAttribute('inert'), hidden:s.getAttribute('aria-hidden') };
  });
  assert.equal(parked.parked, true, 'TEC deve ser estacionado, não desmontado');
  assert.equal(parked.display, 'block', 'screen TEC deve continuar montado fora da viewport');
  assert.equal(parked.position, 'fixed');
  assert.equal(parked.inert, true);
  assert.equal(parked.hidden, 'true');

  await page.evaluate(() => switchScreen('integracaotec'));
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => {
    const frame = document.getElementById('tec-workspace-frame');
    const s = document.getElementById('screen-integracaotec');
    return { name:frame.contentWindow.name, parked:s.classList.contains('tec-screen-parked'), inert:s.hasAttribute('inert'), src:frame.getAttribute('src') };
  });
  assert.equal(after.name, 'snm-caderno-preservado', 'trocar de menu não pode recriar o browsing context do TEC');
  assert.equal(after.parked, false);
  assert.equal(after.inert, false);
  assert.equal(after.src, 'about:blank', 'keepalive não pode reatribuir src');

  const visual = await page.evaluate(() => {
    const screen=document.getElementById('screen-integracaotec');
    screen.focus();
    const lac=document.querySelector('.tec-lacunas-card');
    const cs=getComputedStyle(screen), lc=lac ? getComputedStyle(lac) : null;
    return { outline:cs.outlineStyle, lacStart:lc?.gridColumnStart, lacEnd:lc?.gridColumnEnd, font:getComputedStyle(document.body).fontFamily };
  });
  assert.equal(visual.outline, 'none', 'screen focado não pode desenhar moldura gigante');
  if (visual.lacStart) { assert.equal(visual.lacStart, '1'); assert.equal(visual.lacEnd, '-1'); }
  assert.match(visual.font, /Inter|system-ui/, 'tipografia global deve usar a família UI canônica');

  /* Auditoria responsiva do workbench completo. O bug de produção colocava os
     cards dinâmicos de reconstrução/gestão em 1 das 12 colunas e fazia títulos
     quebrarem letra por letra. Testamos desktop, notebook, tablet e mobile. */
  await page.waitForSelector('#tec-reconstruction-card', { timeout: 5000 });
  await page.waitForSelector('#tec-history-manager-card', { timeout: 5000 });
  for (const viewport of [
    { width:1280, height:900, name:'desktop' },
    { width:1024, height:820, name:'notebook' },
    { width:768, height:900, name:'tablet' },
    { width:390, height:844, name:'mobile' }
  ]) {
    await page.setViewportSize({ width:viewport.width, height:viewport.height });
    await page.evaluate(() => switchScreen('integracaotec'));
    await page.waitForTimeout(70);
    const layout = await page.evaluate(() => {
      const grid=document.querySelector('#screen-integracaotec .tec-connect-grid');
      const gridRect=grid?.getBoundingClientRect();
      const targets=['tec-reconstruction-card','tec-history-manager-card'].map(id=>{
        const el=document.getElementById(id),r=el?.getBoundingClientRect(),cs=el?getComputedStyle(el):null;
        return { id,exists:!!el,width:r?.width||0,gridStart:cs?.gridColumnStart||'',gridEnd:cs?.gridColumnEnd||'',scrollWidth:el?.scrollWidth||0,clientWidth:el?.clientWidth||0,
          titleWidth:el?.querySelector('h2')?.getBoundingClientRect().width||0 };
      });
      const direct=[...(grid?.children||[])]
        .filter(el=>el.classList?.contains('card')&&getComputedStyle(el).display!=='none'&&el.getBoundingClientRect().width>0)
        .map(el=>({id:el.id||el.className,width:el.getBoundingClientRect().width}));
      return { gridWidth:gridRect?.width||0,targets,direct,screenScroll:document.getElementById('screen-integracaotec')?.scrollWidth||0,screenClient:document.getElementById('screen-integracaotec')?.clientWidth||0 };
    });
    assert.ok(layout.gridWidth > 200, `${viewport.name}: grid TEC precisa ter largura útil`);
    for (const target of layout.targets) {
      assert.equal(target.exists, true, `${viewport.name}: ${target.id} deve existir`);
      assert.ok(target.width >= layout.gridWidth * 0.94, `${viewport.name}: ${target.id} deve ocupar a largura do grid, não uma coluna estreita`);
      assert.equal(target.gridStart, '1', `${viewport.name}: ${target.id} deve começar na primeira coluna`);
      assert.equal(target.gridEnd, '-1', `${viewport.name}: ${target.id} deve terminar na última coluna`);
      assert.ok(target.scrollWidth <= target.clientWidth + 4, `${viewport.name}: ${target.id} não pode gerar overflow horizontal`);
      assert.ok(target.titleWidth >= Math.min(180, layout.gridWidth * 0.55), `${viewport.name}: título de ${target.id} não pode colapsar letra por letra`);
    }
    const minRatio=Math.min(...layout.direct.map(x=>x.width/layout.gridWidth));
    assert.ok(minRatio >= 0.25, `${viewport.name}: nenhum card direto visível pode cair em 1/12 do grid (menor razão ${minRatio.toFixed(3)})`);
    assert.ok(layout.screenScroll <= layout.screenClient + 6, `${viewport.name}: a tela TEC não pode criar rolagem horizontal global`);
  }

  console.log('INTEGRAÇÃO TEC BROWSER: origem, isolamento, deduplicação, keepalive e layout responsivo desktop→mobile validados.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
