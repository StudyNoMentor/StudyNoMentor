#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const arq = 'src/js/51-tela-desempenho-tec.js';
let s = readFileSync(arq, 'utf8');

function uma(label, antigo, novo) {
  const n = s.split(antigo).length - 1;
  if (n !== 1) throw new Error(`${label}: esperava 1 ocorrência, achei ${n}`);
  s = s.replace(antigo, novo);
  console.log(`${label}: ok`);
}
function todas(label, antigo, novo, minimo = 1) {
  const n = s.split(antigo).length - 1;
  if (n < minimo) throw new Error(`${label}: esperava >=${minimo} ocorrência(s), achei ${n}`);
  s = s.split(antigo).join(novo);
  console.log(`${label}: ${n} ocorrência(s)`);
}

uma('coordenador de escopo', `  scopedSnapshot() {
    const snaps = this.activeSnapshots();
    if (snaps.length === 0) return null;
    return this.aggregate(snaps);
  },`, `  scopedSnapshot() {
    const snaps = this.activeSnapshots();
    if (snaps.length === 0) return null;
    return this.aggregate(snaps);
  },
  /* UMA ÚNICA OPERAÇÃO PARA MUDAR O ESCOPO. Antes, cada controle decidia por
     conta própria quais abas repintar: Análise atualizava, Plano nem sempre,
     Reforço dependia do caminho do clique. Esta função é o contrato da tela. */
  _scopePrefsPatch() {
    return {
      scopeMode: this.scopeMode,
      selectedSnapIds: this.selectedSnapIds ? [...this.selectedSnapIds] : [],
      rangeStart: this.rangeStart || null,
      rangeEnd: this.rangeEnd || null
    };
  },
  aplicarMudancaEscopo() {
    this.savePrefs(this._scopePrefsPatch());
    if (typeof PlanoEngine !== 'undefined') {
      PlanoEngine._agrC = null;
      PlanoEngine._tecScopeSignature = null;
    }
    this._planoRefC = null;
    this._fatias = null;
    this.renderScopeControls(DB.getTecSnapshots());
    this.renderAnalysis();
    if (this.tecTab === 'plano') this.renderPlano();
    else if (this.tecTab === 'reforco') this.renderReforco();
    else if (this.tecTab === 'incidencia') this.renderIncidencia();
  },`);

uma('restauração de seleção vazia', `    // inicializa a seleção (todos marcados) e o intervalo (cobre tudo) na 1ª vez
    if (this.selectedSnapIds === null) this.selectedSnapIds = new Set(snaps.map(s => s.id));
    // remove ids que não existem mais
    [...this.selectedSnapIds].forEach(id => { if (!snaps.find(s => s.id === id)) this.selectedSnapIds.delete(id); });
    if (this.selectedSnapIds.size === 0) snaps.forEach(s => this.selectedSnapIds.add(s.id));
    if (!this.rangeStart || !this.rangeEnd) {
      this.rangeStart = snaps[0].startDate;
      this.rangeEnd = snaps[snaps.length - 1].endDate;
    }`, `    // Na primeira abertura, restaura inclusive []: "Limpar" é um estado válido,
    // não um pedido disfarçado para voltar a selecionar tudo.
    if (this.selectedSnapIds === null) {
      const salvos = Array.isArray(_p.selectedSnapIds) ? _p.selectedSnapIds : null;
      this.selectedSnapIds = salvos
        ? new Set(salvos.map(id => Number.isFinite(Number(id)) ? Number(id) : id))
        : new Set(snaps.map(s => s.id));
    }
    // remove apenas ids que realmente deixaram de existir
    [...this.selectedSnapIds].forEach(id => { if (!snaps.find(s => s.id === id)) this.selectedSnapIds.delete(id); });
    if (!this.rangeStart && _p.rangeStart) this.rangeStart = _p.rangeStart;
    if (!this.rangeEnd && _p.rangeEnd) this.rangeEnd = _p.rangeEnd;
    if (!this.rangeStart || !this.rangeEnd) {
      this.rangeStart = snaps[0].startDate;
      this.rangeEnd = snaps[snaps.length - 1].endDate;
    }`);

uma('checkbox de retrato', `      if (cb.checked) this.selectedSnapIds.add(id); else this.selectedSnapIds.delete(id);
      this.renderScopeControls(DB.getTecSnapshots());
      this.renderAnalysis();`, `      if (cb.checked) this.selectedSnapIds.add(id); else this.selectedSnapIds.delete(id);
      this.aplicarMudancaEscopo();`);

uma('marcar/limpar retratos', `    if (allBtn) allBtn.addEventListener('click', () => { snaps.forEach(s => this.selectedSnapIds.add(s.id)); this.renderScopeControls(DB.getTecSnapshots()); this.renderAnalysis(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { this.selectedSnapIds.clear(); this.renderScopeControls(DB.getTecSnapshots()); this.renderAnalysis(); });`, `    if (allBtn) allBtn.addEventListener('click', () => { snaps.forEach(s => this.selectedSnapIds.add(s.id)); this.aplicarMudancaEscopo(); });
    if (noneBtn) noneBtn.addEventListener('click', () => { this.selectedSnapIds.clear(); this.aplicarMudancaEscopo(); });`);

uma('toggle de tipo de escopo', `  DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
  DesempenhoTecScreen.renderAnalysis();
  // reaplica a aba ativa (reforço também depende do escopo)
  if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();`, `  DesempenhoTecScreen.aplicarMudancaEscopo();`);

/* Manual e atalhos rápidos compartilham exatamente o mesmo rodapé. */
todas('intervalo manual/atalhos', `    DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
    DesempenhoTecScreen.renderAnalysis();
    if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();`, `    DesempenhoTecScreen.aplicarMudancaEscopo();`, 1);
todas('atalho fora do bloco manual', `  DesempenhoTecScreen.renderScopeControls(DB.getTecSnapshots());
  DesempenhoTecScreen.renderAnalysis();
  if (DesempenhoTecScreen.tecTab === 'reforco') DesempenhoTecScreen.renderReforco();`, `  DesempenhoTecScreen.aplicarMudancaEscopo();`, 1);

/* Reforço nunca pode ressuscitar o snapshot global se o usuário escolheu um
   período sem dados ou limpou a seleção. */
todas('fallback global do Reforço', `this.scopedSnapshot() || ReforcoEngine.currentSnapshot()`, `this.scopedSnapshot()`, 2);

writeFileSync(arq, s);
console.log('Contrato de escopo aplicado em', arq);
