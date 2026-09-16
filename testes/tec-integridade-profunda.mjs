import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const guard = read('companion/src/tec-integrity-guard.js');
const reconstruct = read('companion/src/tec-reconstruct.js');
const capture = read('companion/src/tec-capture-v2.js');
const site = read('src/js/99j-tec-hardening-api.js');
const cloud = read('src/js/99k-tec-cloud-ledger-hardening.js');
const reconstructionHardening = read('src/js/99n-tec-integracao-auditoria-total.js');
const background = read('companion/src/background-v2.js');
const reconstructionBackground = read('companion/src/background-reconstruct.js');
const entry = read('companion/src/background-entry.js');
const proxy = read('companion/src/study-ai-proxy.js');
const chatgpt = read('companion/src/chatgpt-content.js');
const edge = read('supabase/functions/tec-ai/index.ts');
const build = read('build.mjs');
const manifest = JSON.parse(read('companion/manifest.json'));

const isolated = (manifest.content_scripts || []).find((x) => (x.js || []).includes('src/tec-capture-v2.js'));
assert.ok(isolated, 'captura factual v2 ausente do manifest');
assert.equal(isolated.js[0], 'src/tec-integrity-guard.js', 'guarda precisa executar primeiro');
assert.equal(isolated.js[1], 'src/tec-reconstruct.js', 'reconstrutor precisa bloquear a captura normal antes de navegar no caderno');
assert.equal(isolated.js[2], 'src/tec-capture-v2.js', 'captura v2 precisa executar antes dos capturadores legados');
assert.equal(manifest.version, '1.4.0');
assert.ok((manifest.permissions || []).includes('alarms'));
assert.ok((manifest.permissions || []).includes('unlimitedStorage'));

/* Fonte factual: gabarito e resultado explícito são sinais diferentes. */
assert.ok(guard.includes('"Resposta correta" identifica SOMENTE o gabarito'));
assert.ok(guard.includes("source='marked-vs-gabarito'"));
assert.ok(guard.includes('conflictResolved'));
assert.ok(guard.includes("status:confidence==='high'?'verified'"));
assert.ok(!capture.includes('if (acertou === true && correta && !marcada)'));
assert.ok(!capture.includes('marcada = correta'));
assert.ok(capture.includes("confidence='high'; source='marked-vs-gabarito'"));
assert.ok(capture.includes('window.__snmTecCompanion = true'));
assert.ok(capture.includes('window.__snmTecCaptureWatchdog = true'));
assert.ok(capture.includes("source:'session-random'"), 'captura normal desconhecida continua isolada por sessão');

/* A aba técnica de reconstrução não pode gerar falsas resoluções novas nem
   fabricar uma conta diferente a cada aba. */
assert.ok(reconstruct.includes('window.__snmTecCompanionV2 = true'));
assert.ok(reconstruct.includes('window.__snmTecCompanion = true'));
assert.ok(reconstruct.includes('window.__snmTecCaptureWatchdog = true'));
assert.ok(reconstruct.includes("selectFilter('Resolvidas')"));
assert.ok(reconstruct.includes("id:'conta-nao-identificada'"));
assert.ok(reconstructionBackground.includes('snm-study-reconstruct-v1'));
assert.ok(reconstructionBackground.includes('sameOwner'));
assert.ok(reconstructionBackground.includes('BATCHES_KEY'));
assert.ok(reconstructionBackground.includes('awaiting-persistence'));
assert.ok(reconstructionBackground.includes('replayBatches'));
assert.ok(reconstructionHardening.includes("MIN_RECON_COMPANION='1.4.0'"));
assert.ok(reconstructionHardening.includes("type:'tec-reconstruct-batch-ack'"));
assert.ok(reconstructionHardening.includes('archive-before-removal'));
assert.ok(reconstructionHardening.includes('canonicalDay'));

/* TrustGate único: legado nunca entra silenciosamente em prescrição. */
assert.ok(site.includes('window.TecTrustGate=TecTrustGate'));
assert.ok(site.includes("reason='legacy-unverified'"));
assert.ok(site.includes("integrity.status==='verified'"));
assert.ok(site.includes('L.events=function()'));
assert.ok(site.includes('E.events=function()'));
assert.ok(site.includes('R.__trustAttackWrapped'));
assert.ok(site.includes("MIN_COMPANION = '1.2.0'"));

/* Perfil/ACK/fila precisam ter dono explícito. */
assert.ok(background.includes('study_route_unbound'));
assert.ok(background.includes('QUEUE_ITEM_PREFIX'));
assert.ok(background.includes('sameOwner(ctx,item.target)'));
assert.ok(background.includes('chrome.alarms'));

/* ChatGPT browser é opcional, cancelável e isolado. */
assert.ok(entry.includes('snmPlusOwnedTabV2'));
assert.ok(entry.includes("importScripts('background-v2.js','background-reconstruct.js')"));
assert.ok(proxy.includes("BROWSER_PROVIDER = 'chatgpt-plus-browser'"));
assert.ok(proxy.includes("type:'plus-ai-cancel'"));
assert.ok(chatgpt.includes("throw new Error('PARTIAL_RESPONSE')"));
assert.ok(chatgpt.includes('ensureFreshConversation'));

/* Nuvem factual não reescreve evento e baixa deltas. */
assert.ok(cloud.includes('ignoreDuplicates:true'));
assert.ok(cloud.includes("CURSOR_SUFFIX='tec-cloud-ledger:cursor-v2'"));
assert.ok(cloud.includes(".gte('created_at',cursor.at)"));

/* IA multi-provedor: chave somente no backend, erros diagnósticos e modelo
   Gemini de texto válido/estável. */
assert.ok(edge.includes('callGemini'));
assert.ok(edge.includes('callOpenAI'));
assert.ok(edge.includes('callOpenAICompatible'));
assert.ok(edge.includes('GEMINI_API_KEY'));
assert.ok(edge.includes("DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'"));
assert.ok(edge.includes("configured === 'gemini-3.8-flash'"), 'migração de configuração Gemini legada ausente');
assert.ok(edge.includes('GEMINI_API_KEY_INVALID'));
assert.ok(edge.includes('GEMINI_MODEL_UNAVAILABLE'));
assert.ok(edge.includes('GEMINI_QUOTA_EXCEEDED'));
assert.ok(edge.includes('callProviderWithRetry'));
assert.ok(edge.includes('consume_tec_ai_quota'));
assert.ok(edge.includes('MAX_REQUEST_CHARS'));
assert.ok(!site.includes('GEMINI_API_KEY'));
assert.ok(!site.includes('OPENAI_API_KEY'));
assert.ok(build.includes("'js/99m-tec-historico-gestao.js','js/99n-tec-integracao-auditoria-total.js'"));

console.log('TEC INTEGRIDADE V4: captura factual, reconstrução durável, TrustGate, roteamento, ledger e IA validados.');
