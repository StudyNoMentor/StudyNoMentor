#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const read=(p)=>readFileSync(join(ROOT,p),'utf8');

const cloud=read('src/js/60-cloud-store.js');
const ui=read('src/js/63-cloud-ui.js');
const gate=read('src/js/53-portao-de-acesso.js');
const rel=read('src/js/60-relational-store.js');
const media=read('src/js/44-anki-total-parity.js');

// Realtime continua imediato; polling é apenas fallback econômico.
assert.match(cloud,/FOCUS_SYNC_MIN_MS:\s*60\s*\*\s*1000/,'foco deve ter throttle contra eventos duplicados');
assert.match(cloud,/_focusSyncPromise/,'sincronizações concorrentes de foco devem ser coalescidas');
assert.match(ui,/10\s*\*\s*60\s*\*\s*1000/,'fallback SQL não pode voltar ao polling de 30 s');
assert.doesNotMatch(ui,/syncOnFocus\(\);[\s\S]{0,300}\},\s*30000\)/,'polling de 30 s não pode reaparecer');

// Auth e escrita não devem multiplicar SELECT/UPSERT sem mudança.
assert.match(cloud,/_prefsHydratedUid/,'preferências globais devem ser hidratadas uma vez por usuário/sessão');
assert.match(rel,/if\(oldRaw===newRaw\) return;/,'escrita idêntica deve ser descartada antes do UPSERT');
assert.match(rel,/CloudStore\.serviceStatus==='restricted'/,'fila SQL deve parar retentativas sob 402');

// O payload base64 de mídia só pode ser baixado depois de comparar metadados.
assert.match(media,/select\('profile_id,plan_id,media_name,mime,fingerprint,size_bytes,deleted_at,updated_at'\)/,
  'primeira leitura de mídia deve conter apenas metadados');
assert.doesNotMatch(media,/select\('profile_id,plan_id,media_name,mime,fingerprint,size_bytes,content_b64,deleted_at,updated_at'\)/,
  'leitura integral de content_b64 para toda a coleção não pode reaparecer');
assert.match(media,/\.in\('media_name',names\)/,'conteúdo de mídia deve ser buscado apenas para nomes alterados');
assert.match(media,/MEDIA_SYNC_MIN_MS:5\*60\*1000/,'sincronização automática de mídia deve ser limitada');

// O indicador precisa representar a resposta real do backend, não só SDK carregado.
assert.match(cloud,/res\.status === 402 \? 'restricted' : 'ok'/,'HTTP 402 deve marcar serviço restrito');
assert.match(gate,/Servidor restrito por cota/,'portão deve mostrar restrição de cota');
assert.match(gate,/exceed_egress_quota/,'erro de egress deve ser traduzido para a UI');
assert.match(cloud,/signInWithPassword[\s\S]{0,240}_setServiceStatus\('ok'\)/,
  'login bem-sucedido deve confirmar o servidor sem depender do fetch interno do SDK');
assert.match(cloud,/auth\.signUp[\s\S]{0,240}_setServiceStatus\('ok'\)/,
  'cadastro bem-sucedido deve confirmar o servidor sem deixar o portão em pending');
assert.match(cloud,/_probeServiceOnce\(\);/,
  'inicialização deve sondar o backend mesmo sem sessão autenticada');
assert.match(cloud,/from\(this\.TABLE\)\.select\('id'\)\.limit\(1\)/,
  'sonda pré-login deve ser mínima: uma coluna e no máximo uma linha');
assert.doesNotMatch(cloud,/setInterval[\s\S]{0,180}_probeServiceOnce/,
  'sonda pré-login não pode virar polling');

console.log('EGRESS SUPABASE: polling, auth, no-op writes, quota e mídia incremental validados.');
