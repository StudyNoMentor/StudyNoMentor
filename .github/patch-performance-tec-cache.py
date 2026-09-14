from pathlib import Path

p = Path('src/js/51-tela-desempenho-tec.js')
s = p.read_text()

old = """    DB._tecReadSnapshot = null;
    const snaps = DB.getTecSnapshots();
    DB._tecReadSnapshot = snaps;"""
new = """    DB._tecReadSnapshot = null;
    this._scopeSigC = new WeakMap();
    const snaps = DB.getTecSnapshots();
    DB._tecReadSnapshot = snaps;"""
if old not in s: raise SystemExit('render TEC ja nao tem o trecho esperado')
s = s.replace(old, new, 1)

old = """    const assinar = (snap) => {
      let h = 2166136261 >>> 0;
      const mix = (v) => {
        const t = String(v == null ? '' : v);
        for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
        h = Math.imul(h ^ 31, 16777619) >>> 0;
      };
      mix(snap.id); mix(snap.startDate); mix(snap.endDate); mix(snap.importedAt || '');
      (snap.rows || []).forEach(r => {
        mix(r.codigo); mix(r.nome); mix(r.disciplina); mix(r.depth);
        mix(r.questoes); mix(r.acertos);
      });
      return h.toString(36);
    };"""
new = """    const assinar = (snap) => {
      // scopedSnapshot pode ser consultado por totais, evolução, filtros e Plano
      // na mesma pintura. O objeto do retrato é imutável durante esse render;
      // portanto sua assinatura também é. Evita percorrer milhares de linhas
      // várias vezes só para confirmar a mesma chave de cache.
      if (!this._scopeSigC) this._scopeSigC = new WeakMap();
      const memo = this._scopeSigC.get(snap);
      if (memo) return memo;
      let h = 2166136261 >>> 0;
      const mix = (v) => {
        const t = String(v == null ? '' : v);
        for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619) >>> 0;
        h = Math.imul(h ^ 31, 16777619) >>> 0;
      };
      mix(snap.id); mix(snap.startDate); mix(snap.endDate); mix(snap.importedAt || '');
      (snap.rows || []).forEach(r => {
        mix(r.codigo); mix(r.nome); mix(r.disciplina); mix(r.depth);
        mix(r.questoes); mix(r.acertos);
      });
      const sig = h.toString(36);
      this._scopeSigC.set(snap, sig);
      return sig;
    };"""
if old not in s: raise SystemExit('assinatura TEC nao encontrada')
s = s.replace(old, new, 1)
p.write_text(s)
print('PATCH_TEC_SIG_OK')
