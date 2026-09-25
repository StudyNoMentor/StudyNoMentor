#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   CORREÇÕES DA AUDITORIA 25/09/2026 — conferidas no navegador real, com o
   index.html publicado (mesmo CSP, mesma ordem de módulos).
   ═══════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { montarApiFalsa } from '../test/supabase-falso.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const api = montarApiFalsa();
const server = createServer((q, r) => {
  if (/^\/(rest|auth)\/v1\//.test((q.url || '').split('?')[0])) {
    let corpo = ''; q.on('data', c => { corpo += c; }); q.on('end', () => { api.tratar(q, r, corpo); });
    return;
  }
  let caminho = decodeURIComponent(new URL(q.url, 'http://x').pathname);
  if (caminho === '/') caminho = '/index.html';
  const arq = normalize(join(ROOT, caminho));
  if (!arq.startsWith(ROOT) || !existsSync(arq) || caminho.startsWith('/node_modules')) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': TIPOS[extname(arq)] || 'application/octet-stream' });
  r.end(readFileSync(arq));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {});
let n = 0;
const ok = (v, m) => { n++; assert.ok(v, m); console.log('  ✓ ' + m); };

async function abrir() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://*.supabase.co/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  const erros = [], csp = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof FSRS !== 'undefined' && typeof DB !== 'undefined' && typeof AutoTeste !== 'undefined' && typeof UI !== 'undefined', null, { timeout: 30000 });
  return { ctx, page, erros, csp };
}

const libSupabase = readFileSync(join(ROOT, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'), 'utf8');
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const linhas = (t, f) => api.estado.tabelas[t].filter(f || (() => true));

/* ── PERSISTÊNCIA DE PONTA A PONTA (supabase-js real × banco falso) ───────── */
async function pontaAPonta() {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: libSupabase }));
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const page = await ctx.newPage();
  const erros = []; page.on('pageerror', e => erros.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.CloudStore && window.RelationalStore && window.ProfileManager, null, { timeout: 30000 });
  const perfil = await page.evaluate(async (origem) => {
    CloudStore.SUPABASE_URL = origem; CloudStore.SUPABASE_KEY = 'chave-de-teste'; CloudStore.init();
    await CloudStore.signUp('fila@teste.local', 'senha-de-teste-123');
    await new Promise(r => setTimeout(r, 250));
    const row = await CloudStore.createRow({ name: 'Perfil Fila', avatar: '📘', color: '#4f46e5' });
    ProfileManager.addMirror({ id: row.id, nome: 'Perfil Fila', avatar: '📘', cor: '#4f46e5' });
    ProfileManager.setActiveProfile(row.id);
    PlanManager.init();
    await RelationalStore.flush();
    await RelationalStore.hydrateProfile(row.id, { reason: 'teste' });
    RelationalStore.RETRY_DELAYS_MS = [300, 300, 300, 300, 300];
    return { id: row.id, plano: PlanManager.getActivePlanId() };
  }, new URL(url).origin);
  ok(perfil.id && perfil.plano, 'perfil relacional aberto contra o banco falso');

  // C1 — o banco falha: nada se perde, o aviso aparece, o reenvio acontece sozinho
  api.estado.falhaForcada = (req, u) => u.pathname.includes('mutate_study_plan_rows');
  const durante = await page.evaluate(async () => {
    DB.saveEntry({ id: 'e-fila-1', subject: 'Constitucional', method: 'Questões', date: '2026-09-01', durationMin: 50, correct: 7, total: 10 });
    await new Promise(r => setTimeout(r, 1800));
    // outra gravação, em outra tabela, que DÁ CERTO
    ProfileManager.updateProfile(ProfileManager.getActiveProfileId(), { meta: { concurso: 'TRF' } });
    await new Promise(r => setTimeout(r, 400));
    let flushOk = true; try { await RelationalStore.flush(); } catch (_) { flushOk = false; }
    const b = document.getElementById('rel-pending-banner');
    const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev);
    return { pend: RelationalStore.pendingCount(), flushOk, banner: !!(b && !b.hidden), txt: b ? b.textContent : '', protegeAba: ev.defaultPrevented };
  });
  ok(!linhas('study_entries', r => r.entry_id === 'e-fila-1').length, 'com o banco falhando o registro ainda não está lá');
  ok(durante.pend > 0 && !durante.flushOk, 'a alteração continua pendente e o flush não declara sucesso mesmo após outro envio bem-sucedido');
  ok(durante.banner && /não foram confirmadas/.test(durante.txt), 'aviso de pendência visível na tela');
  ok(durante.protegeAba, 'fechar a aba com pendência pede confirmação (beforeunload)');
  api.estado.falhaForcada = null;
  await page.waitForFunction(() => RelationalStore.pendingCount() === 0, null, { timeout: 15000 });
  ok(linhas('study_entries', r => r.entry_id === 'e-fila-1' && Number(r.duration_min) === 50).length === 1, 'banco de volta: o registro chegou sozinho, uma única vez');
  ok(await page.evaluate(() => { const b = document.getElementById('rel-pending-banner'); return !b || b.hidden; }), 'o aviso some quando tudo foi confirmado');

  // C7 — dados do estudante persistidos no banco
  const meta = linhas('study_profile_settings', r => r.profile_id === perfil.id && r.key === 'profile-meta');
  ok(meta.length === 1 && meta[0].value && meta[0].value.concurso === 'TRF', 'dados do estudante gravados em study_profile_settings');

  // C2 — a sessão cai com o perfil aberto
  const semSessao = await page.evaluate(async () => {
    CloudStore.session = null; CloudStore.onAuth('SIGNED_OUT');
    const antes = RelationalStore.pendingCount();
    DB.saveEntry({ id: 'e-fila-2', subject: 'AFO', method: 'Questões', date: '2026-09-02', durationMin: 30, correct: 5, total: 8 });
    await new Promise(r => setTimeout(r, 600));
    const b = document.getElementById('rel-pending-banner');
    return { antes, depois: RelationalStore.pendingCount(), banner: !!(b && !b.hidden), txt: b ? b.textContent : '' };
  });
  ok(semSessao.depois === semSessao.antes + 1, 'sem sessão a alteração fica pendente (não é descartada)');
  ok(semSessao.banner && /sessão expirou/i.test(semSessao.txt), 'aviso de sessão expirada com o botão para entrar');
  ok(!linhas('study_entries', r => r.entry_id === 'e-fila-2').length, 'sem sessão nada foi enviado');
  await page.evaluate(async () => { await CloudStore.signIn('fila@teste.local', 'senha-de-teste-123'); });
  await page.waitForFunction(() => RelationalStore.pendingCount() === 0, null, { timeout: 15000 });
  ok(linhas('study_entries', r => r.entry_id === 'e-fila-2').length === 1, 'ao entrar de novo, a alteração pendente é enviada');

  // C7 — depois de "recarregar" (projeção limpa + hidratação), o meta volta
  const metaDepois = await page.evaluate(async (id) => {
    RelationalStore._clearProfileMemory(id);
    ProfileManager.syncMirrorFromCloud(await CloudStore.listProfiles());
    await RelationalStore.hydrateProfile(id, { reason: 'teste-reabrir' });
    const p = ProfileManager.getProfiles().find(x => x.id === id);
    return p && p.meta;
  }, perfil.id);
  ok(metaDepois && metaDepois.concurso === 'TRF', 'dados do estudante sobrevivem à reabertura do perfil');

  // C3 — TEC antes do bloco pesado
  const tec = await page.evaluate(async (id) => {
    const rows = [{ codigo: null, nome: 'Direito Adm', depth: 0, disciplina: 'Direito Adm', questoes: 10, acertos: 7, pctAcerto: 70 }];
    await DB.garantirPesado();
    const s1 = DB.saveTecSnapshot({ id: 'tec-s1', startDate: '2026-08-01', endDate: '2026-08-07', date: '2026-08-01', rows, importedAt: new Date().toISOString() });
    await RelationalStore.flush();
    // abre "de novo" sem o bloco pesado (como na abertura rápida)
    RelationalStore._heavyReady.delete(id); RelationalStore._heavyDirty.add(id); RelationalStore._clearHeavyMemory(id);
    const recusado = DB.saveTecSnapshot({ id: 'tec-s2', startDate: '2026-08-08', endDate: '2026-08-14', date: '2026-08-08', rows, importedAt: new Date().toISOString() });
    await RelationalStore.flush();
    const pronto = await DB.garantirPesado();
    const s2 = DB.saveTecSnapshot({ id: 'tec-s2', startDate: '2026-08-08', endDate: '2026-08-14', date: '2026-08-08', rows, importedAt: new Date().toISOString() });
    await RelationalStore.flush();
    return { s1: !!s1, recusado, pronto, s2: !!s2 };
  }, perfil.id);
  const snaps = linhas('study_tec_snapshots', r => r.profile_id === perfil.id).map(r => r.snapshot_id).sort();
  ok(tec.s1 && tec.recusado === false, 'sem o histórico carregado, gravar um retrato é recusado');
  ok(tec.pronto && tec.s2, 'depois de carregar o histórico, o retrato é gravado');
  ok(JSON.stringify(snaps) === JSON.stringify(['tec-s1', 'tec-s2']), 'o banco mantém o retrato antigo e o novo: ' + JSON.stringify(snaps));

  ok(erros.length === 0, 'ponta a ponta sem erro de página: ' + erros.join(' | '));
  await ctx.close();
}

try {
  const { ctx, page, erros, csp } = await abrir();

  // ── C5: WebAssembly do fsrs-rs sob o CSP publicado ─────────────────────────
  const wasm = await page.evaluate(async () => {
    try {
      const mod = await FSRS._loadOfficialOptimizer();
      const items = [], card_ids = [];
      for (let c = 0; c < 64; c++) for (let k = 2; k <= 7; k++) {
        const reviews = [{ rating: 3, delta_t: 0 }];
        for (let i = 1; i < k; i++) reviews.push({ rating: (i + c) % 11 === 0 ? 1 : 3, delta_t: Math.max(1, Math.round(Math.pow(1.7, i - 1))) });
        items.push({ reviews }); card_ids.push(100000 + c);
      }
      const out = JSON.parse(mod.optimize_json(JSON.stringify({ items, card_ids, current_params: FSRS.DEFAULT_W, num_relearning_steps: 1 })));
      const hc = JSON.parse(mod.health_check_json(JSON.stringify({ items, card_ids, num_relearning_steps: 1 })));
      return { ok: true, n: out.params && out.params.length, hc: typeof hc };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  });
  ok(wasm.ok && wasm.n === 21, 'otimizador FSRS oficial (WASM) roda sob o CSP publicado: ' + JSON.stringify(wasm));
  ok(!csp.some(t => /WebAssembly|wasm/i.test(t)), 'nenhuma recusa de WebAssembly pelo CSP');

  // ── C4: AutoTeste não encosta no planejamento real ──────────────────────────
  const auto = await page.evaluate(() => {
    const k = DB.KEYS.incidencia;
    const real = [{ id: 'real-1', banca: 'CEBRASPE', disciplina: 'Real', topico: 'Não mexer', incidencia: 42, codigo: '01', depth: 1 }];
    localStorage.setItem(k, JSON.stringify(real));
    const antes = localStorage.getItem(k);
    let escritas = 0; const chaves = [];
    // Espiona o ponto por onde QUALQUER mutação entra na fila do banco.
    const orig = RelationalStore._markDirty.bind(RelationalStore);
    const readyOrig = RelationalStore.isReady.bind(RelationalStore);
    RelationalStore.isReady = () => true;            // como se houvesse sessão
    RelationalStore._markDirty = function (key, old) { escritas++; chaves.push(key); };
    const r = AutoTeste.rodar(false);
    RelationalStore._markDirty = orig; RelationalStore.isReady = readyOrig;
    const sobras = [];
    for (let i = 0; i < localStorage.length; i++) { const x = localStorage.key(i); if (x && x.indexOf('__autoteste__') >= 0) sobras.push(x); }
    return { igual: localStorage.getItem(k) === antes, escritas, sobras, falhas: r.falhas.filter(f => /Incid/.test(f.nome || f)).length, plano: DB._activePlanId(), chaves: JSON.stringify(chaves.slice(0, 5)) };
  });
  ok(auto.igual, 'AutoTeste preserva a incidência real do planejamento ativo');
  ok(auto.escritas === 0, 'AutoTeste não gera nenhuma escrita persistível (' + auto.escritas + ') ' + auto.chaves);
  ok(auto.sobras.length === 0, 'AutoTeste não deixa resíduo do sandbox na RAM');
  ok(auto.falhas === 0, 'os testes de incidência continuam passando dentro do sandbox');
  ok(auto.plano !== '__autoteste__', 'o planejamento ativo é restaurado');

  ok(erros.length === 0, 'nenhum erro de página: ' + erros.join(' | '));
  await ctx.close();

  await pontaAPonta();
  console.log(`AUDITORIA (NAVEGADOR) OK — ${n} verificações.`);
} finally {
  await browser.close();
  server.close();
}
