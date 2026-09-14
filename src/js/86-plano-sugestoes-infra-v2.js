/* ============================================================================
   PLANO → EXTRAS — infraestrutura neutra dos motores V2
   ----------------------------------------------------------------------------
   Este arquivo NÃO decide prioridade. Ele apenas entrega dados e invariantes
   estruturais comuns. Simplificado e Robusto são módulos separados e nunca
   chamam funções privadas um do outro.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoSugInfraV2) return;
  window.__planoSugInfraV2 = true;
  if (typeof DB === 'undefined' || typeof DesempenhoTecScreen === 'undefined') return;

  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, num(v, a)));
  const norm = (s) => {
    try { if (typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm) return ReforcoEngine.norm(s || ''); }
    catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-v2-norm'); }
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  };
  const esc = (v) => typeof escapeHtml === 'function'
    ? escapeHtml(String(v == null ? '' : v))
    : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const I = {
    VERSAO: 2,
    num, clamp, norm, esc,
    snapshot() {
      try { return DesempenhoTecScreen.scopedSnapshot ? DesempenhoTecScreen.scopedSnapshot() : null; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-v2-snapshot'); return null; }
    },
    linhasTec(snapshot) {
      const rows = snapshot && Array.isArray(snapshot.rows) ? snapshot.rows : [];
      return rows.filter(r => {
        if (!r || !r.nome || !r.disciplina) return false;
        if (num(r.depth, 0) > 0) return true;
        const cod = String(r.codigo || '');
        return cod.includes('.') && norm(r.nome) !== norm(r.disciplina);
      });
    },
    q(row) { return Math.max(0, num(row && (row.questoes ?? row.q ?? row.total))); },
    ac(row) { return Math.max(0, num(row && (row.acertos ?? row.ac))); },
    taxa(row) {
      const q = this.q(row), pc = Number(row && (row.pctAcerto ?? row.taxa));
      if (Number.isFinite(pc)) return clamp(pc, 0, 100);
      return q > 0 ? clamp(this.ac(row) / q * 100, 0, 100) : null;
    },
    abertasPlano() {
      try { return (DB.getExtras ? DB.getExtras() : []).filter(e => e && e.origemPlano && e.status !== 'concluida'); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-v2-abertas'); return []; }
    },
    disciplinasBloqueadas() {
      return new Set(this.abertasPlano().map(e => norm((e.origemPlano && e.origemPlano.disciplina) || e.disciplina)).filter(Boolean));
    },
    bancas() {
      try { return DB.getBancas ? DB.getBancas() : []; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-v2-bancas'); return []; }
    },
    incidencia() {
      try { return DB.getIncidencia ? DB.getIncidencia() : []; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-v2-incidencia'); return []; }
    },
    materias() {
      try { return DB.getActiveSubjects ? DB.getActiveSubjects() : (DB.getSubjects ? DB.getSubjects().filter(x => x.ativo !== false) : []); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-v2-materias'); return []; }
    },
    fasePlano() {
      try { if (typeof PlanoPontos !== 'undefined' && PlanoPontos.modo) return PlanoPontos.modo() === 'pos' ? 'pos' : 'pre'; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-v2-fase'); }
      try { if (typeof planCycleMode === 'function') return planCycleMode() === 'pos' ? 'pos' : 'pre'; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'plano-sug-v2-fase-cycle'); }
      return 'pre';
    }
  };

  window.PlanoSugestoesInfraV2 = Object.freeze(I);
})();
