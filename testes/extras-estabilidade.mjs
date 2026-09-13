import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../src/js/59-extras-stability.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/css/16-extras-stability.css', import.meta.url), 'utf8');

assert.match(js, /MutationObserver/, 'pilha de overlays deve observar modais criados dinamicamente');
assert.match(js, /extras-overlay-background/, 'modais atrás precisam ficar inertes');
assert.match(js, /fromCentral:true/, 'editor adaptativo deve sair da Central antes de abrir');
assert.match(js, /getComputedStyle\(screen\)\.display!==['"]none['"]/, 'recalculo do TEC deve ocorrer apenas quando visível');
assert.match(js, /ctx\._histIndex=this\._historyIndex\(\)/, 'histórico deve ser indexado uma vez por cálculo');

const deco = js.match(/RA\.decorarPlano\s*=\s*function\(\)\s*\{([\s\S]*?)\n  \};/);
assert.ok(deco, 'decorarPlano otimizado deve existir');
assert.equal((deco[1].match(/PlanoEngine\.calcular/g)||[]).length, 0, 'decorarPlano não pode recalcular o Plano por card');
assert.match(deco[1], /new Map\(\)/, 'lookup dos tópicos deve ser indexado');

const z = [...css.matchAll(/\.(xsc|rg|ra)-overlay\{z-index:(\d+)\}/g)].map(m=>[m[1],Number(m[2])]);
assert.deepEqual(z, [['xsc',100200],['rg',100300],['ra',100400]], 'fallback de camadas deve ser crescente');
assert.match(css, /100dvh/, 'modais mobile devem usar viewport dinâmica');
assert.match(css, /extras-modal-open/, 'scroll do fundo deve ser bloqueado com modal aberto');

console.log('OK: estabilidade de Extras — pilha de modais, layout e performance adaptativa protegidos.');
