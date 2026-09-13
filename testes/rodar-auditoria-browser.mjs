#!/usr/bin/env node
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const EVIDENCIAS = join(RAIZ, 'testes', 'evidencias');
const RESULTADO = join(RAIZ, 'audit-browser-results.json');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(existsSync);

if (!CHROME) throw new Error('Chrome/Edge local não encontrado.');
mkdirSync(EVIDENCIAS, { recursive: true });

const baseHtml = readFileSync(join(RAIZ, 'index.html'), 'utf8');
const testes = readFileSync(join(RAIZ, 'audit-tests.js'), 'utf8');
const browserTests = readFileSync(join(RAIZ, 'audit-browser.js'), 'utf8');
const pagina = baseHtml;
const supabase = readFileSync(join(RAIZ, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'));
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json'
};

let receberRelatorio;
const relatorioChegou = new Promise((resolve) => { receberRelatorio = resolve; });
const servidor = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'POST' && url === '/audit-report') {
    let corpo = '';
    req.on('data', (p) => { corpo += p; });
    req.on('end', () => {
      try {
        const json = JSON.parse(corpo);
        receberRelatorio(json);
        res.writeHead(204).end();
      } catch (e) {
        res.writeHead(400).end(e.message);
      }
    });
    return;
  }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': TIPOS['.html'] });
    res.end(pagina);
    return;
  }
  try {
    const arquivo = join(RAIZ, decodeURIComponent(url).replace(/^\/+/, ''));
    const corpo = readFileSync(arquivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(arquivo)] || 'application/octet-stream' });
    res.end(corpo);
  } catch {
    res.writeHead(404).end('não encontrado');
  }
});

await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
const origem = `http://127.0.0.1:${servidor.address().port}`;
const navegador = await chromium.launch({ headless: true, executablePath: CHROME });
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
const paginaReal = await contexto.newPage();
const erros = [];
paginaReal.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
paginaReal.on('console', (m) => {
  if (m.type() === 'error' && !/net::ERR_|favicon/.test(m.text())) erros.push('console: ' + m.text());
});
await paginaReal.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
  (rota) => rota.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: supabase }));
await paginaReal.route('https://fonts.googleapis.com/**',
  (rota) => rota.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' }));
await paginaReal.route('https://fonts.gstatic.com/**', (rota) => rota.abort());

try {
  await paginaReal.goto(origem + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await paginaReal.waitForFunction(() => typeof AutoTeste !== 'undefined' && typeof DB !== 'undefined', null,
    { timeout: 30_000 });
  await paginaReal.addScriptTag({ content: testes });
  const carregouMotor = await paginaReal.evaluate(() => typeof runTecAudit === 'function');
  if (!carregouMotor) throw new Error('audit-tests.js não expôs runTecAudit no navegador');
  await paginaReal.addScriptTag({ content: browserTests });
  const relatorio = await Promise.race([
    relatorioChegou,
    new Promise((_, reject) => setTimeout(() => reject(new Error('auditoria excedeu 120 s')), 120_000))
  ]);
  relatorio.browser = { engine: 'Chrome', version: await navegador.version(), consoleErrors: erros };

  await paginaReal.evaluate(() => { switchScreen('extras'); ExtrasScreen.render(); });
  await paginaReal.waitForTimeout(300);
  await paginaReal.screenshot({ path: join(EVIDENCIAS, 'extras-desktop.png'), fullPage: false });

  await paginaReal.setViewportSize({ width: 390, height: 844 });
  await paginaReal.waitForTimeout(200);
  await paginaReal.screenshot({ path: join(EVIDENCIAS, 'extras-celular.png'), fullPage: false });

  await paginaReal.setViewportSize({ width: 1440, height: 1000 });
  await paginaReal.evaluate(() => { switchScreen('desempenhotec'); DesempenhoTecScreen.switchTecTab('plano'); });
  await paginaReal.waitForTimeout(300);
  await paginaReal.screenshot({ path: join(EVIDENCIAS, 'desempenho-plano-desktop.png'), fullPage: false });

  await paginaReal.setViewportSize({ width: 390, height: 844 });
  await paginaReal.waitForTimeout(200);
  await paginaReal.screenshot({ path: join(EVIDENCIAS, 'desempenho-plano-celular.png'), fullPage: false });

  relatorio.evidencias = [
    'testes/evidencias/extras-desktop.png', 'testes/evidencias/extras-celular.png',
    'testes/evidencias/desempenho-plano-desktop.png', 'testes/evidencias/desempenho-plano-celular.png'
  ];
  writeFileSync(RESULTADO, JSON.stringify(relatorio, null, 2));
  const uiPassou = relatorio.ui.filter((x) => x.pass).length;
  const motorTestes = relatorio.engine?.tests || [];
  const motorPassou = motorTestes.filter((x) => x.pass).length;
  console.log(JSON.stringify({
    auto: `${relatorio.auto.passed}/${relatorio.auto.total}`,
    ui: `${uiPassou}/${relatorio.ui.length}`,
    motor: `${motorPassou}/${motorTestes.length}`,
    falhasUI: relatorio.ui.filter((x) => !x.pass),
    falhasMotor: motorTestes.filter((x) => !x.pass).map((x) => x.name),
    benchmarks: relatorio.engine?.benchmarks || [],
    erros
  }, null, 2));
} finally {
  await contexto.close();
  await navegador.close();
  await new Promise((resolve) => servidor.close(resolve));
}
