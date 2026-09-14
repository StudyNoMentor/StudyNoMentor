/* ============================================================================
   MENTOR 90+ V6 — endurecimento estatístico da calibragem
   ----------------------------------------------------------------------------
   Mantém a V5 intacta por compatibilidade e publica uma política V6 para o
   motor Robusto. Um tópico só ganha calibragem própria com >=5 ciclos úteis;
   antes disso recua para disciplina (>=5) ou global. A ausência de resposta só
   muda a intervenção quando esse limiar mínimo de evidência foi atingido.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.Mentor90V6 || !window.Mentor90V5) return;
  const B = window.Mentor90V5;
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, num(v, a)));
  const median = (arr) => {
    const a = (arr || []).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const norm = (s) => {
    try { if (typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm) return ReforcoEngine.norm(s || ''); }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'mentor90-v6-norm'); }
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };

  const V6 = Object.create(B);
  V6.VERSAO = 6;
  V6.MIN_CICLOS_PERSONALIZAR = Math.max(5, num(B.MIN_CICLOS_PERSONALIZAR, 5));
  V6.calibracaoHierarquica = function (item) {
    let anterior = null;
    try { anterior = B.calibracaoHierarquica.call(B, item); }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'mentor90-v6-base-cal'); }
    const c = B._calCache;
    if (!c || !c.porTop || !c.porDisc || !Array.isArray(c.global)) {
      const z = Object.assign({}, anterior || {});
      const nt = Math.max(0, num(z.nTopico)), nd = Math.max(0, num(z.nDisciplina));
      if (nt < this.MIN_CICLOS_PERSONALIZAR) {
        z.nivel = nd >= this.MIN_CICLOS_PERSONALIZAR ? 'disciplina' : 'global';
        z.baixaResposta = false;
        z.confianca = Math.min(num(z.confianca), .49);
      }
      z.limiarCiclos = this.MIN_CICLOS_PERSONALIZAR;
      return z;
    }
    const d = norm(item && item.disciplina), t = norm(item && item.nome);
    const top = c.porTop.get(d + '\u0001' + t) || [], disc = c.porDisc.get(d) || [], global = c.global || [];
    let nivel = 'global', pool = global;
    if (top.length >= this.MIN_CICLOS_PERSONALIZAR) { nivel = 'topico'; pool = top; }
    else if (disc.length >= this.MIN_CICLOS_PERSONALIZAR) { nivel = 'disciplina'; pool = disc; }
    const n = pool.length, k = 5, med = median(pool), base = Number.isFinite(Number(c.globalMed)) ? Number(c.globalMed) : 2.5;
    const ganho100 = med == null ? base : (n * med + k * base) / (n + k);
    const qPorPonto = ganho100 > .1 ? clamp(100 / ganho100, .5, 20) : 20;
    return {
      nivel, n, nTopico: top.length, nDisciplina: disc.length, nGlobal: global.length,
      ganho100: Math.round(ganho100 * 10) / 10, qPorPonto: Math.round(qPorPonto * 10) / 10,
      confianca: clamp(n / (n + k), 0, 1),
      baixaResposta: n >= this.MIN_CICLOS_PERSONALIZAR && ganho100 < 3,
      limiarCiclos: this.MIN_CICLOS_PERSONALIZAR
    };
  };
  window.Mentor90V6 = V6;
})();
