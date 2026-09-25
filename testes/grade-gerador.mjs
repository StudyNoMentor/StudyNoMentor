#!/usr/bin/env node
/* Motor "✨ Sugerir grade": regras de montagem da grade semanal. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../src/js/33-grade-gerador.js');
let n = 0; const ok = (v, m) => { n++; assert.ok(v, m); };

// Sessões: mínimo 60, máximo 120, sempre preferindo 60.
assert.deepEqual(G.dividir(180, 60, 120).sessoes, [60, 60, 60]); n++;
assert.deepEqual(G.dividir(150, 60, 120).sessoes, [60, 90]); n++;
assert.deepEqual(G.dividir(200, 60, 120).sessoes, [60, 60, 80]); n++;
assert.equal(G.dividir(500, 60, 60).perdido, 20, "resto que não cabe é informado, não descartado em silêncio"); n++;
assert.ok(G.gerar({ minSess: 60, maxSess: 60, dias: [{ dia: G.DIAS[0], minutos: 600 }], materias: [{ nome: "X", minutos: 500 }] }).avisos.some(a => /não couberam/.test(a)), "aviso de minutos perdidos"); n++;
ok(G.dividir(30, 60, 120).arredondado && G.dividir(30, 60, 120).sessoes[0] === 60, 'meta menor que o mínimo vira uma sessão mínima');
ok(G.dividir(1000, 60, 120).sessoes.every(x => x >= 60 && x <= 120), 'nenhuma sessão fora de 60–120');

const M = [['DITRI', 180, 1, 0], ['LETRI', 180, 1, 0], ['RETRI', 120, 1, 0], ['COGER', 120, 0, 1], ['COAVA', 120, 0, 1], ['TEINF', 120, 0, 0], ['DIADM', 60, 0, 0], ['ESINF', 60, 0, 1], ['AFFIN', 120, 0, 1], ['DICON', 60, 0, 0], ['RALOG', 60, 0, 1], ['DICIV', 60, 0, 0], ['ESBAS', 60, 0, 1], ['ECFIN', 120, 0, 1], ['DIPEN', 60, 0, 0], ['DIEMP', 60, 0, 0], ['COCUS', 60, 0, 1], ['AUDIT', 60, 0, 0], ['LIPOR', 60, 0, 0]]
  .map(([nome, minutos, p, c]) => ({ nome, minutos, prioritaria: !!p, calculo: !!c }));
const info = nome => M.find(m => m.nome === nome);
const dias = G.DIAS.map(dia => ({ dia, minutos: dia === 'Sábado' ? 300 : 240 }));
const idx = d => G.DIAS.indexOf(d);
const circ = (a, b) => { const x = Math.abs(a - b) % 7; return Math.min(x, 7 - x); };

let calcSeguidas = 0, pares = 0;
for (let semente = 0; semente < 30; semente++) {
  const r = G.gerar({ materias: M, dias, semente });
  ok(r.sobras.length === 0, 'tudo cabe quando há tempo');
  const porMat = {};
  G.DIAS.forEach(d => {
    const l = r.grade[d].filter(Boolean);
    ok(l.reduce((s, c) => s + c.minutes, 0) <= (d === 'Sábado' ? 300 : 240), 'respeita o tempo do dia');
    ok(new Set(l.map(c => c.subject)).size === l.length, 'matéria não repete no mesmo dia');
    l.forEach((c, i) => { (porMat[c.subject] = porMat[c.subject] || []).push(idx(d)); if (i) { pares++; if (info(l[i - 1].subject).calculo && info(c.subject).calculo) calcSeguidas++; } });
    // prioritárias vêm antes de qualquer não prioritária
    const pr = l.map(c => info(c.subject).prioritaria);
    ok(pr.indexOf(false) < 0 || pr.lastIndexOf(true) < pr.indexOf(false), 'prioritárias nos primeiros horários');
  });
  M.forEach(m => {
    const total = (porMat[m.nome] || []).length;
    ok(total === G.dividir(m.minutos, 60, 120).sessoes.length, 'todas as sessões da matéria alocadas');
    const pos = (porMat[m.nome] || []).sort((a, b) => a - b);
    if (pos.length === 3) ok(Math.min(circ(pos[0], pos[1]), circ(pos[1], pos[2]), circ(pos[0], pos[2])) >= 2, '3 sessões ficam espaçadas (≥ 2 dias)');
    if (pos.length === 2) ok(circ(pos[0], pos[1]) >= 3, '2 sessões ficam espaçadas (≥ 3 dias)');
  });
}
ok(calcSeguidas / pares < 0.02, 'cálculo praticamente nunca em sequência: ' + calcSeguidas + '/' + pares);

// Exemplo pedido: 3 sessões em seg–sáb → seg/qua/sex (ou ter/qui/sáb).
const r3 = G.gerar({ materias: [{ nome: 'DITRI', minutos: 180 }], dias: G.DIAS.map(dia => ({ dia, minutos: dia === 'Domingo' ? 0 : 120 })) });
const d3 = G.DIAS.filter(d => r3.grade[d].some(Boolean));
ok(['Segunda,Quarta,Sexta', 'Terça,Quinta,Sábado'].includes(d3.join()), '3 sessões em 6 dias: dia sim, dia não (' + d3.join() + ')');

// Falta de tempo: sobra explícita, dia nunca estoura.
const rf = G.gerar({ materias: [{ nome: 'A', minutos: 600 }], dias: [{ dia: 'Segunda', minutos: 120 }, { dia: 'Terça', minutos: 60 }] });
ok(rf.sobras.reduce((s, x) => s + x.minutos, 0) > 0 && rf.avisos.some(a => /Não couberam/.test(a)), 'avisa o que não coube');
ok(rf.grade.Segunda.filter(Boolean).reduce((s, c) => s + c.minutes, 0) <= 120, 'não estoura o dia');

// Mesma semente → mesma grade; outra semente → alternativa válida.
ok(JSON.stringify(G.gerar({ materias: M, dias, semente: 3 }).grade) === JSON.stringify(G.gerar({ materias: M, dias, semente: 3 }).grade), 'determinístico por semente');
ok(G.pareceCalculo('Contabilidade Geral') && G.pareceCalculo('Raciocínio Lógico') && !G.pareceCalculo('Direito Tributário'), 'palpite de cálculo');
console.log(`GRADE GERADOR OK — ${n} invariantes.`);
