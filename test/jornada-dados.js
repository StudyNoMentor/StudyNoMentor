/* ══════════════════════════════════════════════════════════════════════════
   GERADOR DE JORNADA — um ano de uso, com a árvore irregular do TecConcursos
   ────────────────────────────────────────────────────────────────────────── */
window.SIM = (function () {
  // PRNG determinístico: a mesma jornada em toda execução (senão a falha não se reproduz)
  let _s = 20260912;
  const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
  const ent = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const DISCS = [
    { nome: 'Direito Tributario', prof: 4, ramos: 6, peso: 300, base: 0.52 },
    { nome: 'Contabilidade Geral', prof: 3, ramos: 5, peso: 250, base: 0.46 },
    { nome: 'Auditoria', prof: 2, ramos: 4, peso: 150, base: 0.61 },
    { nome: 'Direito Administrativo', prof: 5, ramos: 5, peso: 120, base: 0.58 },
    { nome: 'Portugues', prof: 2, ramos: 6, peso: 100, base: 0.72 },
    { nome: 'Legislacao Tributaria', prof: 3, ramos: 4, peso: 90, base: 0.41 },
    { nome: 'Direito Constitucional', prof: 4, ramos: 5, peso: 80, base: 0.64 },
    { nome: 'Estatistica', prof: 2, ramos: 3, peso: 60, base: 0.38 }
  ];
  /* A árvore: cada disciplina desce até a PRÓPRIA profundidade, e cada nó tem de
     2 a 4 filhos. É a irregularidade real do índice — matéria que acaba no
     segundo nível convive com matéria que desce ao quinto. */
  function arvore() {
    const out = [];
    DISCS.forEach(d => {
      const nos = [];
      const criar = (pai, nivel) => {
        const n = (nivel === 1) ? d.ramos : ent(2, 4);
        for (let i = 1; i <= n; i++) {
          const nome = (pai ? pai.nome + '.' : d.nome.split(' ')[0] + ' ') + i;
          const no = { nome, nivel, pai, filhos: [], disc: d.nome,
            taxa: Math.max(0.08, Math.min(0.93, d.base + (rnd() - 0.5) * 0.5)),
            massa: Math.max(0.2, rnd() * 3), ganho: rnd() * 0.05 };
          nos.push(no);
          if (pai) pai.filhos.push(no);
          if (nivel < d.prof) criar(no, nivel + 1);
        }
      };
      criar(null, 1);
      /* UM ramo nasce SEM detalhe e passa a ser detalhado no 4º mês: é o caso
         que fazia o Plano perder as questões do pai que virou pai. */
      const tarde = nos.find(x => x.nivel === 2 && x.filhos.length);
      if (tarde) tarde.detalhaEm = 4;
      out.push({ d, nos });
    });
    return out;
  }
  const ARV = arvore();
  const folhasDe = (mes) => {
    const out = [];
    ARV.forEach(({ nos }) => nos.forEach(no => {
      // nó com filhos só é folha enquanto o detalhe não chegou
      const detalhado = !no.detalhaEm || mes >= no.detalhaEm;
      const semAncestralEsperando = (() => { let p = no.pai; while (p) { if (p.detalhaEm && mes < p.detalhaEm) return false; p = p.pai; } return true; })();
      if (!semAncestralEsperando) return;
      if (!no.filhos.length || !detalhado) out.push(no);
    }));
    return out;
  };
  /* Um mês de export: volume por folha (muitas com zero — o índice é fino), taxa
     melhorando devagar, e a ORDEM dos irmãos embaralhada para os códigos serem
     posicionais entre retratos, como no TEC de verdade. */
  function mes(m, escala) {
    const vol = Object.create(null), ac = Object.create(null);
    folhasDe(m).forEach(no => {
      const lam = no.massa * escala;
      const q = (rnd() < 0.45) ? 0 : Math.max(1, Math.round(lam * (0.4 + rnd() * 1.6)));
      if (!q) return;
      const t = Math.min(0.97, no.taxa + no.ganho * m);
      let k = 0; for (let i = 0; i < q; i++) if (rnd() < t) k++;
      vol[no.nome] = q; ac[no.nome] = k;
    });
    // sobe a soma pela árvore: no export do TEC o pai é a soma exata dos filhos
    const rows = [];
    ARV.forEach(({ d, nos }) => {
      const somaDe = (no) => {
        if (vol[no.nome] != null) return { q: vol[no.nome], ac: ac[no.nome] };
        let q = 0, a = 0;
        no.filhos.forEach(f => { const s = somaDe(f); q += s.q; a += s.ac; });
        return { q, ac: a };
      };
      const raizes = nos.filter(n => n.nivel === 1);
      let dq = 0, da = 0;
      const emitir = (no, cod) => {
        const s = somaDe(no);
        if (!s.q) return;
        rows.push({ depth: cod.split('.').length, codigo: cod, nome: no.nome,
          disciplina: d.nome, questoes: s.q, acertos: s.ac });
        if (vol[no.nome] != null) return;            // é folha neste mês
        const fs = no.filhos.slice();
        for (let i = fs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = fs[i]; fs[i] = fs[j]; fs[j] = t; }
        let k = 0;
        fs.forEach(f => { if (somaDe(f).q) { k++; emitir(f, cod + '.' + String(k).padStart(2, '0')); } });
      };
      const rs = raizes.slice();
      for (let i = rs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = rs[i]; rs[i] = rs[j]; rs[j] = t; }
      const antes = rows.length;
      let k = 0;
      rs.forEach(r => { if (somaDe(r).q) { k++; emitir(r, String(k).padStart(2, '0')); } });
      rows.slice(antes).forEach(r => { if (r.depth === 1) { dq += r.questoes; da += r.acertos; } });
      // o balde sem código que todo export traz no fim da disciplina
      const bq = (rnd() < 0.6) ? ent(1, 9) : 0;
      if (bq) { const ba = Math.round(bq * 0.5); rows.push({ depth: 1, codigo: null, nome: 'Sem Classificação', disciplina: d.nome, questoes: bq, acertos: ba }); dq += bq; da += ba; }
      if (dq) rows.splice(antes, 0, { depth: 0, codigo: null, nome: d.nome, disciplina: d.nome, questoes: dq, acertos: da });
    });
    return rows;
  }
  const dia = (n) => { const d = new Date(todayLocal() + 'T00:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  function retratos(n) {
    const out = [];
    for (let m = 1; m <= n; m++) {
      const fim = 30 * (n - m) + 3, ini = fim + 29;
      out.push({ id: 'S' + m, nome: 'Mes ' + m, date: dia(fim), startDate: dia(ini), endDate: dia(fim),
        rows: mes(m, 1 + m * 0.35) });
    }
    return out;
  }
  // índice de incidência da banca, coerente com a árvore (é a mesma fonte no TEC)
  function incidencia() {
    const out = [];
    ARV.forEach(({ d, nos }) => {
      out.push({ banca: 'CESPE', disciplina: d.nome, topico: d.nome, incidencia: d.peso, codigo: null, depth: 0 });
      nos.forEach((n, i) => out.push({ banca: 'CESPE', disciplina: d.nome,
        topico: n.nome, incidencia: Math.max(1, Math.round(d.peso * n.massa / 12)), codigo: String(i + 1), depth: n.nivel }));
    });
    return out;
  }
  return { retratos, incidencia, folhas: () => folhasDe(99).length };
})();
