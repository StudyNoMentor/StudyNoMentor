from pathlib import Path


def rep(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'âncora não encontrada em {path}: {old[:140]!r}')
    p.write_text(s.replace(old, new, count))

# Este script roda DEPOIS de tmp-loop-sugestoes.py e fecha um caso importante:
# um alvo recém-concluído não pode voltar para a fila usando o MESMO retrato TEC.
rep('src/js/54-reforco-fila.js',
'''  const abertas = DB.getExtras().filter(e => this.ePlano(e) && e.status !== 'concluida');
  const abertasPorDisc = new Map();
  abertas.forEach(e => {
    const k = this._norm(e.disciplina || (e.origemPlano && e.origemPlano.disciplina) || 'sem disciplina');
    abertasPorDisc.set(k, (abertasPorDisc.get(k) || 0) + 1);
  });

  const { ordem, porDisc } = this._rankDisciplinasPlano(cand);
''',
'''  const extras = DB.getExtras();
  const abertas = extras.filter(e => this.ePlano(e) && e.status !== 'concluida');
  const abertasPorDisc = new Map();
  abertas.forEach(e => {
    const k = this._norm(e.disciplina || (e.origemPlano && e.origemPlano.disciplina) || 'sem disciplina');
    abertasPorDisc.set(k, (abertasPorDisc.get(k) || 0) + 1);
  });

  /* FRESCOR DO LOOP — terminar uma frente não prova que ela continua sendo a
     pior. Enquanto não entrar um retrato TEC NOVO, reabrir a mesma disciplina
     faria o ciclo ficar preso no dado antigo. O veredito já grava o id do
     retrato que julgou a atividade; usamos esse id como barreira natural. */
  let ultimoRetrato = null;
  try {
    const snaps = (typeof DB.getTecSnapshots === 'function') ? (DB.getTecSnapshots() || []) : [];
    ultimoRetrato = snaps.length ? snaps[snaps.length - 1].id : null;
  } catch (e) { _quiet(e, 'fila-sug-frescor'); }
  const topicosEmCooldown = new Set(), disciplinasEmCooldown = new Set();
  if (ultimoRetrato != null) extras.forEach(e => {
    if (!this.ePlano(e) || e.status !== 'concluida') return;
    const o = e.origemPlano || {}, v = o.veredito || {};
    if (v.retrato !== ultimoRetrato) return;
    const d = this._norm(e.disciplina || o.disciplina || 'sem disciplina');
    const t = this._norm(o.topico || '');
    disciplinasEmCooldown.add(d);
    if (t) topicosEmCooldown.add(d + '|' + t);
  });
  // Se ainda há outra frente aberta da matéria, ela continua no ciclo e pode
  // preencher seus tópicos configurados; só o tópico já julgado fica vetado.
  abertasPorDisc.forEach((_n, d) => disciplinasEmCooldown.delete(d));

  const { ordem, porDisc } = this._rankDisciplinasPlano(cand);
''')

rep('src/js/54-reforco-fila.js',
'''  ordem.forEach(k => {
    if (alvoDiscs.length >= cfg.disciplinas) return;
    if (!alvoDiscs.includes(k)) alvoDiscs.push(k);
  });
''',
'''  ordem.forEach(k => {
    if (alvoDiscs.length >= cfg.disciplinas) return;
    if (disciplinasEmCooldown.has(k)) return;
    if (!alvoDiscs.includes(k)) alvoDiscs.push(k);
  });
''')

rep('src/js/54-reforco-fila.js',
'''    for (const c of grupo.itens) {
      if (vagas <= 0) break;
      indices.push(c.i); vagas--;
    }
''',
'''    for (const c of grupo.itens) {
      if (vagas <= 0) break;
      const tk = k + '|' + this._norm(c.x.nome || '');
      if (topicosEmCooldown.has(tk)) continue;
      indices.push(c.i); vagas--;
    }
''')

rep('src/js/54-reforco-fila.js',
'''    indices, cfg, abertasTotal: abertas.length, disciplinasAtivas: ativas.length,
    alvoDisciplinas: alvoDiscs.length, vagasSugeridas: indices.length, excesso: false
''',
'''    indices, cfg, abertasTotal: abertas.length, disciplinasAtivas: ativas.length,
    alvoDisciplinas: alvoDiscs.length, vagasSugeridas: indices.length,
    disciplinasEmCooldown: disciplinasEmCooldown.size, excesso: false
''')

rep('src/js/54-reforco-fila.js',
'''      n.innerHTML = `Ciclo automático: <strong>${info.cfg.disciplinas} disciplina(s) × ${info.cfg.topicos} tópico(s)</strong> · ${info.abertasTotal} atividade(s) já ocupam vagas · <strong>${info.vagasSugeridas} nova(s)</strong> pré-selecionada(s) para completar o ciclo.`;
''',
'''      n.innerHTML = `Ciclo automático: <strong>${info.cfg.disciplinas} disciplina(s) × ${info.cfg.topicos} tópico(s)</strong> · ${info.abertasTotal} atividade(s) já ocupam vagas · <strong>${info.vagasSugeridas} nova(s)</strong> pré-selecionada(s) para completar o ciclo${info.disciplinasEmCooldown ? ` · ${info.disciplinasEmCooldown} aguardando novo retrato TEC` : ''}.`;
''')

# O harness passa a ter retratos, para provar que o cooldown termina exatamente
# quando chega informação nova.
rep('testes/reforco-fila.mjs',
'''const prefMem = new Map();
const localStorage = { getItem(k) { return prefMem.has(k) ? prefMem.get(k) : null; }, setItem(k, v) { prefMem.set(k, String(v)); } };
const DB = {
''',
'''const prefMem = new Map();
let tecSnaps = [{ id: 'snap-1' }];
const localStorage = { getItem(k) { return prefMem.has(k) ? prefMem.get(k) : null; }, setItem(k, v) { prefMem.set(k, String(v)); } };
const DB = {
''')
rep('testes/reforco-fila.mjs',
'''  getExtras() { return this._data; },
  saveExtras(list) { this._data = list; },
''',
'''  getExtras() { return this._data; },
  getTecSnapshots() { return tecSnaps; },
  saveExtras(list) { this._data = list; },
''')

pt = Path('testes/reforco-fila.mjs')
s = pt.read_text()
start = s.index('// 8) Slots contínuos:')
end = s.index('// 9) A configuração do Plano', start)
novo = r'''// 8) Slots contínuos: atividades abertas ocupam vagas. Quando uma termina,
// a próxima MATÉRIA entra; a recém-concluída aguarda um retrato TEC novo.
const abertaA = extra('aberta-A', 'A', 40, 20);
const abertaB = extra('aberta-B', 'B', 40, 10);
DB._data = [abertaA, abertaB];
PlanoPontos.linhas = ['A', 'B', 'C', 'D'];
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel), [4],
  'com A e B ocupando duas das três vagas, C deve preencher a vaga restante');

// Simula que a sugestão C foi aceita antes de B terminar.
const abertaC = extra('aberta-C', 'C', 40, 5);
DB._data.push(abertaC);
abertaB.status = 'concluida';
abertaB.origemPlano.veredito = { tipo: 'funcionou', retrato: 'snap-1', em: HOJE };
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel), [5],
  'B recém-concluída não pode se reciclar com o mesmo retrato: a vaga passa para D');

// Chegou informação nova e B continua fraca: agora ela pode voltar legitimamente.
tecSnaps = [{ id: 'snap-1' }, { id: 'snap-2' }];
abertaC.status = 'concluida';
abertaC.origemPlano.veredito = { tipo: 'funcionou', retrato: 'snap-1', em: HOJE };
ExtrasScreen._reforcoFilaEscolhaPendente = true;
ExtrasScreen._planoBind();
assert.deepEqual(Array.from(ExtrasScreen._planoSel).sort((a, b) => a - b), [3, 4],
  'com retrato novo, B e C podem ser reavaliadas e voltar se ainda estiverem na fila de fraquezas');

'''
s = s[:start] + novo + s[end:]
pt.write_text(s)

print('frescor aplicado')
