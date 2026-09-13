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

/* Contrato novo: Extras ocupa somente a faixa de modal do design system. O
   z-index é derivado da pilha PRESENTE, não de um contador que cresce a cada
   abertura, portanto nunca ultrapassa toast ou bloqueio global por deriva. */
assert.match(css, /--z-extras-modal:calc\(var\(--z-modal,1500\) \+ 20\)/, 'fallback deve derivar do token global de modal');
assert.doesNotMatch(css, /z-index:100\d{3,}/, 'Extras não pode usar camada arbitrária acima de bloqueios globais');
assert.match(js, /base:\s*1520/, 'pilha dinâmica deve iniciar dentro da faixa de modal');
assert.match(js, /this\.base\+i\*20/, 'z-index deve depender apenas da posição atual na pilha');
assert.doesNotMatch(js, /base:\s*200000/, 'pilha não pode ficar acima de toast/sessão');
assert.match(js, /e\.key!==['"]Tab['"]/, 'Tab deve ser aprisionado no modal superior');
assert.match(js, /focusin/, 'foco externo deve voltar ao modal superior');
assert.match(js, /paddingRight/, 'bloqueio de scroll deve compensar a barra para não deslocar layout');
assert.match(css, /100dvh/, 'modais mobile devem usar viewport dinâmica');
assert.match(css, /extras-modal-open/, 'scroll do fundo deve ser bloqueado com modal aberto');
assert.match(css, /safe-area-inset/, 'modais devem respeitar safe areas do dispositivo');

console.log('OK: estabilidade de Extras — pilha de modais, foco, layout e performance adaptativa protegidos.');
