/* ============================================================================
   EXTRAS ↔ PLANO — continuidade adaptativa no diálogo "Puxar do Plano"
   ----------------------------------------------------------------------------
   `_planoRecalc` nasce somente quando o diálogo é aberto. Por isso a camada
   adaptativa carregada no boot não conseguia embrulhá-lo de forma confiável.
   Este hook intercepta a abertura estável e aplica a dose efetiva já calculada
   pelo ReforçoAdaptativo, inclusive dose ZERO (cooldown / aguardar novo TEC),
   sem deixar o custo tradicional voltar por acidente.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || !window.ExtrasScreen || ExtrasScreen._uxv4PlanoContinuity) return;
  if (typeof ExtrasScreen.puxarDoPlano !== 'function') return;
  ExtrasScreen._uxv4PlanoContinuity = true;

  const key = x => {
    const n = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
    return n(x && x.disciplina) + '\u0001' + n(x && x.nome);
  };
  const aplicar = screen => {
    if (!screen || !Array.isArray(screen._planoCand)) return;
    const antes = screen._planoCand;
    const selecionados = new Set();
    if (screen._planoSel && typeof screen._planoSel.forEach === 'function') {
      screen._planoSel.forEach(i => { if (antes[i]) selecionados.add(key(antes[i])); });
    }
    const fora = [];
    const depois = [];
    antes.forEach(x => {
      const rx = x && x.prescricaoAdaptativa;
      if (x && x.motivo === 'reforco' && rx) {
        x.alvo = Math.max(0, Number(rx.dose) || 0);
        x.continuidadeAdaptativa = rx.continuidade || null;
        if (x.alvo <= 0) { fora.push(x); return; }
      }
      depois.push(x);
    });
    screen._planoCand = depois;
    if (screen._planoSel) {
      screen._planoSel = new Set();
      depois.forEach((x,i) => { if (selecionados.has(key(x))) screen._planoSel.add(i); });
    }
    screen._planoContinuityHidden = fora;
  };

  const original = ExtrasScreen.puxarDoPlano;
  ExtrasScreen.puxarDoPlano = function () {
    const r = original.apply(this, arguments);
    aplicar(this);

    if (typeof this._planoRecalc === 'function' && !this._planoRecalc._uxv4Continuity) {
      const rec = this._planoRecalc;
      const wrapped = (...args) => {
        const z = rec.apply(this, args);
        aplicar(this);
        return z;
      };
      wrapped._uxv4Continuity = true;
      this._planoRecalc = wrapped;
    }

    // A UI original agenda o bind alguns ms depois. Quando ele rodar, a lista
    // já estará filtrada; esta repintura é apenas uma garantia para implementações
    // que tenham desenhado o HTML antes de o wrapper recuperar o controle.
    setTimeout(() => {
      try {
        aplicar(this);
        if (typeof this._planoRenderLista === 'function') this._planoRenderLista();
        if (window.ReforcoAdaptativo && ReforcoAdaptativo.decorarPuxar) ReforcoAdaptativo.decorarPuxar(this);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-continuity-v4'); }
    }, 55);
    return r;
  };

  window.ExtrasPlanoContinuityV4 = { aplicar };
})();
