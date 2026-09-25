#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   FILA RELACIONAL DURÁVEL — nada que a pessoa fez pode sumir em silêncio.

   Reproduz, contra o RelationalStore real (60-relational-store.js), os casos
   da auditoria de 25/09/2026:
     C1 · falha de rede: a alteração NÃO pode ser descartada, o erro NÃO pode
          ser zerado pelo próximo sucesso e o reenvio tem de levar o estado
          FINAL (nunca um intermediário velho);
     C2 · sessão caída com o perfil aberto: as alterações ficam pendentes e são
          enviadas quando a sessão volta;
     C3 · TEC/incidência antes do bloco pesado: nada é enviado (substituição
          apagaria o histórico no banco);
     ·    recusa definitiva do banco não trava a fila e realinha a tela;
     ·    chave/valor em lote (centenas de chaves -> poucas requisições);
     ·    hidratação nunca passa por cima de alteração ainda não confirmada.
   ═══════════════════════════════════════════════════════════════════════════ */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'src/js/60-relational-store.js'), 'utf8');

const store = new Map();
let R = null;
const localStorage = {
  get length() { return store.size; },
  key(i) { return [...store.keys()][i] ?? null; },
  getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
  setItem(k, v) {
    const key = String(k), old = store.has(key) ? store.get(key) : null;
    store.set(key, String(v));
    if (R && old !== String(v)) R.onStorageMutation(key, old, String(v));
  },
  removeItem(k) {
    const key = String(k), old = store.has(key) ? store.get(key) : null;
    store.delete(key);
    if (R && old != null) R.onStorageMutation(key, old, null);
  }
};

/* Banco falso: guarda linhas por tabela e pode falhar de propósito. */
const net = { down: false, rejectCode: null, rejectTable: null };
const db = { rows: new Map(), requests: [] };
const tabela = (t) => { if (!db.rows.has(t)) db.rows.set(t, new Map()); return db.rows.get(t); };
const falhaAgora = (t) => {
  if (net.down) return { message: 'TypeError: Failed to fetch' };
  if (net.rejectCode && (!net.rejectTable || net.rejectTable === t)) return { code: net.rejectCode, message: 'violates constraint' };
  return null;
};
function builder(table) {
  const filtros = {};
  const b = {
    select() { return b; }, order() { return b; }, range() { return b; }, limit() { return b; }, gt() { return b; },
    eq(c, v) { filtros[c] = v; return b; },
    delete() { b._del = true; return b; },
    async upsert(rows, opts) {
      db.requests.push({ table, kind: 'upsert', n: Array.isArray(rows) ? rows.length : 1 });
      const err = falhaAgora(table); if (err) return { data: null, error: err };
      (Array.isArray(rows) ? rows : [rows]).forEach(r => tabela(table).set(JSON.stringify([r.profile_id || r.user_id, r.plan_id || '', r.key]), structuredClone(r)));
      return { data: null, error: null };
    },
    async update() { return { data: null, error: falhaAgora(table) }; },
    then(ok, ko) {
      if (b._del) {
        db.requests.push({ table, kind: 'delete' });
        const err = falhaAgora(table);
        if (!err) for (const [k, r] of tabela(table)) if (Object.keys(filtros).every(c => r[c] === filtros[c])) tabela(table).delete(k);
        return Promise.resolve({ data: null, error: err }).then(ok, ko);
      }
      return Promise.resolve({ data: [], error: null }).then(ok, ko);
    }
  };
  return b;
}
const planRows = new Map();   // "table|plan" -> Map(id -> row)
const client = {
  from: (t) => builder(t),
  async rpc(name, args) {
    db.requests.push({ table: name, kind: 'rpc' });
    const err = falhaAgora(args && args.p_table || name);
    if (err) return { data: null, error: err };
    if (name === 'mutate_study_plan_rows') {
      const k = args.p_table + '|' + args.p_plan_id;
      if (!planRows.has(k)) planRows.set(k, new Map());
      const m = planRows.get(k);
      (args.p_delete_ids || []).forEach(id => m.delete(String(id)));
      const idCol = { study_entries: 'entry_id', study_methods: 'method_id' }[args.p_table] || 'id';
      (args.p_rows || []).forEach(r => m.set(String(r[idCol]), structuredClone(r)));
    }
    return { data: null, error: null };
  }
};
let logado = true;
const CloudStore = { client, isLoggedIn: () => logado, session: { user: { id: 'u1' } }, serviceStatus: 'ok' };
let hidratacoes = 0;
const ctx = {
  console: { ...console, error() {} }, Promise, Set, Map, Object, Array, Number, String, Boolean, Date, JSON, RegExp, Error,
  structuredClone, parseInt, parseFloat, localStorage,
  navigator: {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
  setTimeout, clearTimeout,
  _quiet() {}, showToast() {},
  CloudStore, DB: { normalizeCardNotesInPlace() {} },
  ProfileManager: { getActiveProfileId: () => 'p1' },
  window: { CloudStore, dispatchEvent() {}, addEventListener() {}, CloudUI: null, ProfileManager: { getActiveProfileId: () => 'p1' } }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src + '\n;globalThis.RelationalStore=RelationalStore;', ctx, { filename: '60-relational-store.js' });
R = ctx.RelationalStore;
R.RETRY_DELAYS_MS = [20, 20, 20, 20, 20];
R._everHydrated = true;
R._heavyReady.add('p1');
const origHydrate = R.hydrateProfile.bind(R);
R.hydrateProfile = async () => { hidratacoes++; return { ok: true }; };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const entriesKey = 'diario-estudos:u:p1:p:pl1:entries';
const methodsKey = 'diario-estudos:u:p1:p:pl1:methods';
const banco = (t) => [...(planRows.get(t + '|pl1') || new Map()).values()];
const ok = (m) => console.log('  ✓ ' + m);

// ── C1: falha de rede não descarta, não zera o erro e reenvia o estado FINAL
R._memSet(entriesKey, '[]');   // hidratado: o banco está vazio
net.down = true;
localStorage.setItem(entriesKey, JSON.stringify([{ id: 'e1', subject: 'A', durationMin: 10 }]));
await R._tail;
assert.equal(R.dirtyCount(), 1, 'a alteração que falhou continua pendente');
assert.ok(R._lastError, 'o erro fica registrado');
await assert.rejects(() => R.flush(), 'flush não pode declarar sucesso com pendência');
ok('falha de rede mantém a alteração pendente e o flush acusa');

// Outra chave que dá certo NÃO pode apagar o erro da primeira
net.down = false;
R._memSet(methodsKey, '[]');
net.down = true;
localStorage.setItem(entriesKey, JSON.stringify([{ id: 'e1', subject: 'A', durationMin: 25 }]));   // edição sobre a que falhou
await R._tail;
assert.ok(R._lastError && R.dirtyCount() >= 1);
ok('o erro não é zerado enquanto houver pendência');

// A rede volta: reenvio automático leva o estado FINAL
net.down = false;
R.resumeDirty();
await R.flush();
const e1 = banco('study_entries').find(r => r.entry_id === 'e1');
assert.ok(e1, 'o registro chegou ao banco depois da falha');
assert.equal(e1.duration_min, 25, 'o banco recebe o estado final, não o intermediário');
assert.equal(R.dirtyCount(), 0); assert.equal(R._lastError, null);
ok('com a rede de volta, o reenvio automático grava o estado final');

// Reenvio sozinho (sem chamar resumeDirty), pela espera com backoff
net.down = true;
localStorage.setItem(entriesKey, JSON.stringify([{ id: 'e1', subject: 'A', durationMin: 25 }, { id: 'e2', subject: 'B', durationMin: 5 }]));
await R._tail;
assert.equal(R.dirtyCount(), 1);
net.down = false;
for (let i = 0; i < 100 && R.dirtyCount(); i++) await espera(30);
assert.equal(R.dirtyCount(), 0, 'a fila reenvia sozinha depois da espera');
assert.ok(banco('study_entries').some(r => r.entry_id === 'e2'));
ok('reenvio automático por tempo, sem intervenção');

// Exclusão enviada contra o CONFIRMADO: some no banco também
localStorage.setItem(entriesKey, JSON.stringify([{ id: 'e2', subject: 'B', durationMin: 5 }]));
await R.flush();
assert.ok(!banco('study_entries').some(r => r.entry_id === 'e1'), 'exclusão chega ao banco');
ok('exclusão é calculada contra o último estado confirmado');

// ── Coalescência: várias edições seguidas viram poucos envios
const antesReq = db.requests.length;
for (let i = 0; i < 50; i++) localStorage.setItem(entriesKey, JSON.stringify([{ id: 'e2', subject: 'B', durationMin: 100 + i }]));
await R.flush();
const envios = db.requests.length - antesReq;
assert.ok(envios <= 3, 'edições seguidas da mesma chave devem ser agrupadas (' + envios + ' envios)');
assert.equal(banco('study_entries').find(r => r.entry_id === 'e2').duration_min, 149);
ok('50 edições seguidas da mesma lista -> ' + envios + ' envio(s), valor final correto');

// ── Chave/valor em lote
const antesKv = db.requests.length;
for (let i = 0; i < 300; i++) localStorage.setItem('diario-estudos:u:p1:p:pl1:cards-note:' + i, JSON.stringify({ id: i, t: 'x' }));
await R.flush();
const kvReq = db.requests.slice(antesKv).filter(r => r.table === 'study_plan_state');
assert.ok(kvReq.length <= 2, '300 chaves de estado devem ir em lote (' + kvReq.length + ' requisições)');
assert.equal([...tabela('study_plan_state').values()].length, 300);
ok('300 chaves de estado -> ' + kvReq.length + ' requisição(ões)');

// ── Recusa definitiva: não trava a fila e realinha a tela
net.rejectCode = '23503'; net.rejectTable = 'study_entries';
const recusasAntes = R._rejected;
localStorage.setItem(entriesKey, JSON.stringify([{ id: 'e2', subject: 'B', durationMin: 1 }, { id: 'e9', subject: 'Z', durationMin: 1 }]));
await R._tail; await espera(5);
assert.equal(R._rejected, recusasAntes + 1, 'a recusa é contada');
assert.equal(R.dirtyCount(), 0, 'a recusa sai da fila (não trava as próximas)');
assert.ok(hidratacoes >= 1, 'o perfil é realinhado com o banco depois da recusa');
net.rejectCode = null; net.rejectTable = null;
await R.flush();
ok('recusa do banco sai da fila, é contada e realinha a projeção');

// ── C2: sessão caída com perfil aberto
logado = false;
const antesSessao = db.requests.length;
localStorage.setItem(methodsKey, JSON.stringify([{ id: 'm1', nome: 'Leitura', ativo: true }]));
await R._tail;
assert.equal(db.requests.length, antesSessao, 'sem sessão nada é enviado');
assert.equal(R.dirtyCount(), 1, 'mas a alteração NÃO é descartada');
assert.ok(R.pendingCount() > 0, 'e a aba avisa ao fechar (pendingCount > 0)');
await assert.rejects(() => R.flush());
logado = true;
R.resumeDirty();
await R.flush();
assert.ok(banco('study_methods').some(r => r.method_id === 'm1'), 'enviada quando a sessão voltou');
ok('sessão caída: alteração fica pendente e é enviada ao entrar de novo');

// Antes de qualquer perfil aberto (portão), escritas de UI não entram na fila
R._everHydrated = false; logado = false;
localStorage.setItem('diario-estudos:u:p1:gate-medida', '1');
assert.equal(R.dirtyCount(), 0);
R._everHydrated = true; logado = true;
ok('portão antes do login continua sem gerar pendência');

// ── C3: TEC/incidência antes do bloco pesado nunca são enviados
R._heavyReady.delete('p1');
const antesTec = db.requests.length;
localStorage.setItem('diario-estudos:u:p1:p:pl1:tec', JSON.stringify([{ id: 's-novo', rows: [] }]));
localStorage.setItem('diario-estudos:u:p1:p:pl1:incidencia', JSON.stringify([]));
await R._tail;
assert.equal(db.requests.length, antesTec, 'nenhuma substituição de TEC/incidência sai sem o histórico carregado');
assert.equal(R.dirtyCount(), 0);
R._heavyReady.add('p1');
ok('TEC/incidência sem o bloco pesado: nada é enviado ao banco');

// ── Hidratar com pendência que não sobe: recusa em vez de apagar
R.hydrateProfile = origHydrate;
net.down = true;
localStorage.setItem(entriesKey, JSON.stringify([{ id: 'e2', subject: 'B', durationMin: 7 }]));
await R._tail;
await assert.rejects(() => R.hydrateProfile('p1', { skipWatermark: true, includeHeavy: false }), (e) => e.code === 'pendencias-locais');
assert.equal(JSON.parse(localStorage.getItem(entriesKey))[0].durationMin, 7, 'a alteração local continua lá');
net.down = false;
R.resumeDirty(); await R.flush();
ok('hidratação não passa por cima de alteração não confirmada');

console.log('FILA DURÁVEL: falha de rede, erro persistente, estado final, coalescência, lote, recusa, sessão caída, bloco pesado e hidratação protegida.');
