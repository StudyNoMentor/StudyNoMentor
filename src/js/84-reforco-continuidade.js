/* ============================================================================
   REFORÇO ADAPTATIVO — núcleo de continuidade V4
   ----------------------------------------------------------------------------
   Reinstala `enriquecer` como uma passagem única e determinística:
     prescrição estatística base -> estatísticas do mesmo snapshot -> continuidade.
   Isso evita depender de wrappers acumulados e garante que o cooldown/orçamento
   seja aplicado uma única vez por cálculo do Plano.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || !window.ReforcoAdaptativo || window.__raContinuityCore) return;
  window.__raContinuityCore = true;
  const RA = window.ReforcoAdaptativo;
  if (typeof RA.prescrever !== 'function' || typeof RA.contexto !== 'function' ||
      typeof RA._aplicarContinuidade !== 'function') return;

  /* DB é um global léxico do app. Ele não precisa (nem deve) existir como
     `window.DB`. A primeira versão da ponte checava `window.DB` e, em builds em
     que esse alias não existe, concluía que não havia histórico: a dose voltava
     cheia mesmo depois de o tópico ter sido concluído. O contador abaixo usa o
     contrato real do app (`typeof DB`) e é a única fonte de estatísticas da
     continuidade. */
  RA._contStats = function (snapshotId) {
    const out = new Map();
    if (!snapshotId || typeof DB === 'undefined' || typeof DB.getExtras !== 'function') return out;
    let extras = [];
    try { extras = DB.getExtras() || []; }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ra-cont-stats-v4'); }
    for (const e of extras) {
      const o = e && e.origemPlano;
      const rx = o && o.prescricaoAdaptativa;
      if (!o || !rx || rx.snapshotId !== snapshotId) continue;
      const k = this._contKey(o.disciplina || e.disciplina, o.topico || e.titulo);
      let st = out.get(k);
      if (!st) {
        st = { executado: 0, ciclos: 0, abertos: 0, ultimoDia: '', extras: 0 };
        out.set(k, st);
      }
      const hist = Array.isArray(e.historico) ? e.historico : [];
      const porHist = hist.reduce((s, h) => s + Math.max(0, Number(h && h.quantidade) || 0), 0);
      const feito = Math.max(porHist, Math.max(0, Number(e.progresso) || 0));
      const alvo = Math.max(0, Number(e.alvo) || Number(rx.dose) || 0);
      st.executado += alvo > 0 ? Math.min(feito, alvo) : feito;
      const fechou = e.status === 'concluida' || (alvo > 0 && feito >= alvo);
      if (fechou) st.ciclos++; else st.abertos++;
      st.extras++;
      const dias = hist.map(h => h && h.data).filter(Boolean);
      if (o.veredito && o.veredito.em) dias.push(String(o.veredito.em).slice(0, 10));
      if (e.updatedAt) dias.push(String(e.updatedAt).slice(0, 10));
      dias.sort();
      if (dias.length && dias[dias.length - 1] > st.ultimoDia) st.ultimoDia = dias[dias.length - 1];
    }
    return out;
  };

  RA.enriquecer = function (r) {
    if (!r) return r;
    const itens = [...((r && r.itens) || []), ...((r && r.pequenas) || [])];
    const ctx = this.contexto(r);
    for (const x of itens) x.prescricaoAdaptativa = this.prescrever(x, r, ctx);
    const sid = itens.map(x => x && x.prescricaoAdaptativa && x.prescricaoAdaptativa.snapshotId).find(Boolean) || null;
    const stats = this._contStats(sid);
    for (const x of itens) {
      const rx = x && x.prescricaoAdaptativa;
      if (!rx) continue;
      const k = this._contKey(x.disciplina, x.nome);
      this._aplicarContinuidade(x, rx, stats.get(k));
    }
    return r;
  };

  /* A ajuda antiga dizia “faça a dose e importe outro retrato”. Isso era verdade
     antes da ponte semanal, mas agora ficaria enganoso. Mantemos o modal original
     e atualizamos apenas a explicação operacional quando ele abrir. */
  if (typeof RA.config === 'function' && !RA._uxv4ConfigCopy) {
    RA._uxv4ConfigCopy = true;
    const cfg = RA.config.bind(RA);
    RA.config = function (...args) {
      /* O wrapper de estabilidade usa `fromCentral`/`returnTab` para fechar a
         Central antes do editor e reabri-la na mesma aba ao sair. A versão
         anterior descartava esses argumentos ao chamar `cfg()`, deixando dois
         overlays vivos ao mesmo tempo. Preserve integralmente o contrato. */
      const out = cfg(...args);
      setTimeout(() => {
        try {
          const calls = [...document.querySelectorAll('.ra-overlay .ra-callout')];
          const alvo = calls.find(el => /Custo estratégico|importe novo retrato/i.test(el.textContent || ''));
          if (alvo) alvo.innerHTML = '<b>Como a dose continua</b><span>A dose é curta de propósito. Se você concluir antes do próximo TEC, o motor roda para outras fraquezas no mesmo dia e pode liberar doses menores nos dias seguintes, dentro de um orçamento seguro do mesmo retrato. A confiança só muda quando chegar uma nova medição.</span>';
        } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ra-copy-v4'); }
      }, 0);
      return out;
    };
  }

  try { if (window.ReforcoFila) ReforcoFila._assinaturaAnterior = ''; } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'ra-core-v4'); }
})();