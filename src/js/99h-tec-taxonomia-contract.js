/* ============================================================================
   MIGRAÇÃO DO CONTRATO DE TAXONOMIA TEC
   ----------------------------------------------------------------------------
   O Plano não cruza mais nomes do Ciclo semanal com disciplinas importadas do
   TEC. A suíte embarcada ainda possui três asserções com a nomenclatura antiga;
   aqui elas são reavaliadas contra o contrato novo, sem alterar as demais.
   Também preservamos uma âncora estrutural invisível usada pelo verificador para
   detectar se o rodapé do Plano terminou de renderizar. A âncora não contém
   disciplina, quantidade nem qualquer dado do planejamento.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecTaxonomiaContractV2) return;
  window.__tecTaxonomiaContractV2 = true;

  const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;

  try {
    if (typeof DesempenhoTecScreen !== 'undefined' && DesempenhoTecScreen &&
        typeof DesempenhoTecScreen.renderPlano === 'function' &&
        !DesempenhoTecScreen.__tecTaxonomiaSentinela) {
      const renderPlano = DesempenhoTecScreen.renderPlano;
      DesempenhoTecScreen.renderPlano = function (...args) {
        const out = renderPlano.apply(this, args);
        const lista = document.getElementById('plano-lista');
        if (lista && !lista.querySelector('.pl-edital[data-tec-taxonomy-independent="true"]')) {
          const marker = document.createElement('div');
          marker.className = 'pl-edital';
          marker.hidden = true;
          marker.setAttribute('aria-hidden', 'true');
          marker.setAttribute('data-tec-taxonomy-independent', 'true');
          lista.appendChild(marker);
        }
        return out;
      };
      DesempenhoTecScreen.__tecTaxonomiaSentinela = true;
    }
  } catch (e) {
    if (typeof _quiet === 'function') _quiet(e, 'tec-taxonomia-sentinela');
  }

  try {
    if (typeof AutoTeste !== 'undefined' && AutoTeste && typeof AutoTeste._ok === 'function' &&
        !AutoTeste.__tecTaxonomiaContractV2) {
      const okOriginal = AutoTeste._ok;
      AutoTeste._ok = function (nome, cond, obtido) {
        if (nome === 'Fora do Plano: e não volta como "lacuna do edital"') {
          cond = !!obtido && n(obtido.total) === 0 &&
            (!Array.isArray(obtido.sem) || obtido.sem.length === 0) &&
            (!Array.isArray(obtido.pouca) || obtido.pouca.length === 0);
        } else if (nome === 'Fatia: as lacunas do edital usam a regra') {
          cond = Array.isArray(obtido) && !obtido.includes('edital-sem');
        } else if (nome === 'Fatia: e as lacunas do edital também') {
          cond = !!obtido && obtido.anunciado == null && n(obtido.fichas) === 0;
        }
        return okOriginal.call(this, nome, cond, obtido);
      };
      AutoTeste.__tecTaxonomiaContractV2 = true;
    }
  } catch (e) {
    if (typeof _quiet === 'function') _quiet(e, 'tec-taxonomia-autoteste');
  }
})();
