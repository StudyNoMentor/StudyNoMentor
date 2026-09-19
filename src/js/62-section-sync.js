/* ============================================================
   COMPATIBILIDADE DE API — SINCRONIZAÇÃO LEGADA APOSENTADA
   ------------------------------------------------------------
   A persistência canônica é RelationalStore -> PostgreSQL.
   Este objeto existe somente para módulos antigos ainda carregados em versões
   intermediárias não quebrarem por referência ausente. Ele não lê, não grava,
   não enfileira e não consulta nenhuma tabela de sincronização antiga.
   ============================================================ */
const SectionSync = {
  retired: true,
  enabled: false,
  readEnabled: false,
  PEND: '__secpend',
  DEL: '__secdel',
  MANIFEST: '__manifest',
  _dirty: new Set(),
  _dirtyGen: new Map(),
  _pushing: false,
  _seededProfile: null,
  _lastConflict: null,

  setReadMode() { this.readEnabled = false; return false; },
  pendingQuick() { return 0; },
  pendingSections() { return []; },
  explicitPendingSections() { return []; },
  status() { return { retired: true, enabled: false, readEnabled: false, pending: 0 }; },
  localSections() { return []; },
  sectionForKey() { return null; },
  _getRevs() { return {}; },
  _loadPend() { return []; },
  _savePend() {},
  _loadDel() { return []; },
  _saveDel() {},
  _dirtyFor() { return this._dirty; },
  _dirtyGenFor() { return this._dirtyGen; },
  _clearDirtyIfGeneration() {},
  _hash(v) {
    const s = String(v == null ? '' : v);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  },
  decidirEnvio() { return { acao: 'aposentado', enviar: false, esvaziando: false }; },
  precisaBaixar() { return false; },
  _prepare() { return { ok: false, motivo: 'aposentado', map: {}, revs: {}, extras: [] }; },
  _applyMap() { return 0; },
  markDirty() {},
  markAllDirty() {},
  dropSection() {},
  restorePending() {},
  seedUntrackedOnly() {},
  kick() {},
  async pushDirty() { return true; },
  async _enviarSujas() { return true; },
  async _syncManifest() { return true; },
  async _writeSectionCAS() { return { ok: false, motivo: 'aposentado' }; },
  async fetchAllSections() { return []; },
  async hasRemoteUpdates() { return false; },
  async hydrate() { return { ok: false, motivo: 'aposentado' }; },
  async hydrateReadOnly() { return { ok: false, motivo: 'aposentado' }; },
  async hydrateAfterAppUpdate() { return { ok: false, motivo: 'aposentado' }; },
  async flushBeforeRead() { return []; },
  async pullAndReload() { return false; },
  fastPathIntegrity() { return { ok: false, reason: 'aposentado', mismatches: [] }; }
};
window.SectionSync = SectionSync;

/* Hooks históricos ficam neutros. Toda mutação real é capturada pelo
   RelationalStore na fachada DB/localStorage em memória. */
_sectionMarkHook = function () {};
_entryMutationHook = function () {};
_sectionDropHook = function () {};
