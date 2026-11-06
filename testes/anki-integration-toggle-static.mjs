import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const transport = read('src/js/44-anki-official.js');
const bridge = read('src/js/95-cards-official-bridge.js');
const config = read('src/js/49-tela-config.js');
const html = read('src/html/05-corpo-cont.html');

assert.match(transport, /isEnabled\(\)[\s\S]*?raw == null\) return true/,
  'instalações existentes devem manter o comportamento ativo por padrão');
assert.match(transport, /apiBase\(\)[\s\S]*?if \(!this\.isEnabled\(\)\) throw new Error/,
  'toda chamada pelo transporte oficial deve ser bloqueada quando desativado');
assert.match(bridge, /_scheduleReviewPrewarm\(delay=700\)[\s\S]*?if\(!this\.api\(\)\.isEnabled\(\)\)return false/,
  'o carregamento antecipado não pode chamar o backend quando desativado');
assert.match(bridge, /async bootstrap\(force\)[\s\S]*?if\(!this\.api\(\)\.isEnabled\(\)\)throw new Error/,
  'o bootstrap não pode chamar o backend quando desativado');
assert.match(bridge, /async renderRevisar\(box\)[\s\S]*?Anki desativado/,
  'a tela de revisão deve explicar que a integração está desligada');
assert.match(config, /renderIntegrations\(\)[\s\S]*?AnkiOfficial\.setEnabled\(toggle\.checked\)/,
  'Configurações deve persistir o estado da integração');
assert.match(html, /id="cfg-anki-enabled"/,
  'Configurações deve exibir o controle da integração');
assert.match(html, /não elimina o egress do Supabase/,
  'a interface deve esclarecer que o espelho Supabase continua sincronizado');
console.log('OK — toggle Anki: persistência, bloqueio de chamadas, prewarm, UI e aviso de egress.');
