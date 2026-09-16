/* ============================================================================
   GUARDAS FINAIS — UX TEC, taxonomia independente e exclusão idempotente
   ----------------------------------------------------------------------------
   Esta camada resolve três contratos de produto que não podem depender de CSS:
   1) dados importados do TEC não são casados pelo nome com matérias do Ciclo;
   2) excluir um reforço automático é uma decisão do usuário, não um gatilho para
      o motor recriá-lo em loop;
   3) "Atacar erros deste período" é idempotente para a mesma evidência.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__uxTecFinalGuards) return;
  window.__uxTecFinalGuards = true;

  const norm = (v) => String(v == null ? '' : v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const day = () => typeof todayLocal === 'function' ? todayLocal() : (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const nowIso = () => new Date().toISOString();

  /* ------------------------------------------------------------------------
     TAXONOMIA TEC ≠ TAXONOMIA DO CICLO
     ------------------------------------------------------------------------
     O TEC é fonte factual própria. Comparar nomes com o Ciclo semanal gerava
     falsos "nunca praticados" e fazia a prioridade depender de nomenclaturas
     que não têm obrigação de coincidir. O cruzamento nominal é removido.
  */
  try {
    if (typeof PlanoEngine !== 'undefined' && PlanoEngine) {
      PlanoEngine.lacunasDoEdital = function () {
        return { sem: [], pouca: [], medidas: 0, total: 0, naoCasaram: [] };
      };
    }
  } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-taxonomia-plano'); }

  const L = window.TecLacunasContinuas;
  if (L) {
    L.currentSubjects = function () { return []; };
    L.relevantToCurrentPlan = function () { return true; };

    /* Uma exclusão precisa sobreviver aos refreshes automáticos. O motor marca
       cada espelho que efetivamente existiu. Se esse espelho desaparece enquanto
       a atribuição ainda está pendente, interpretamos como exclusão deliberada,
       registramos a dispensa no ledger global e só permitimos nova atribuição
       quando surgir evidência TEC posterior à dispensa. */
    const originalMirror = L.mirrorTodayToExtras.bind(L);
    L.mirrorTodayToExtras = function (state) {
      const st = state || this.state();
      const rec = st && st.days && st.days[day()];
      let touched = false;

      const linksFor = (assignment) => {
        try {
          return (this.allPlanExtras() || []).filter(x => x && x.extra && x.extra.origemLacunaGlobal
            && x.extra.origemLacunaGlobal.assignmentId === assignment.id);
        } catch (_) { return []; }
      };

      if (rec && Array.isArray(rec.assignments)) {
        for (const a of rec.assignments) {
          if (!a || a.status !== 'pending') continue;
          const links = linksFor(a);
          if (links.length) {
            const ids = links.map(x => String(x.extra && x.extra.id || '')).filter(Boolean);
            if (!a.mirrorObserved || JSON.stringify(a.mirrorExtraIds || []) !== JSON.stringify(ids)) {
              a.mirrorObserved = true;
              a.mirrorObservedAt = nowIso();
              a.mirrorExtraIds = ids;
              touched = true;
            }
            continue;
          }
          if (a.mirrorObserved && !a.userDismissedAt) {
            let topic = null;
            try { topic = this.topicForAssignment ? this.topicForAssignment(a) : null; } catch (_) { topic = null; }
            a.status = 'dismissed';
            a.userDismissedAt = nowIso();
            a.dismissedLastError = topic && topic.lastError || null;
            a.dismissedReason = 'extra-removida-pelo-usuario';
            touched = true;
          }
        }
      }
      if (touched) {
        try { this.save(st); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'lacunas-dismiss-save'); }
      }

      /* A função original só espelha status=pending. As atribuições dispensadas
         acima já estão protegidas e não reaparecem. */
      const out = originalMirror(st);

      /* Registra os espelhos recém-criados para que uma futura ausência tenha
         semântica inequívoca de exclusão, sem depender do DOM ou de timers. */
      let observed = false;
      if (rec && Array.isArray(rec.assignments)) {
        for (const a of rec.assignments) {
          if (!a || a.status !== 'pending') continue;
          const links = linksFor(a);
          if (!links.length) continue;
          const ids = links.map(x => String(x.extra && x.extra.id || '')).filter(Boolean);
          if (!a.mirrorObserved || JSON.stringify(a.mirrorExtraIds || []) !== JSON.stringify(ids)) {
            a.mirrorObserved = true;
            a.mirrorObservedAt = nowIso();
            a.mirrorExtraIds = ids;
            observed = true;
          }
        }
      }
      if (observed) {
        try { this.save(st); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'lacunas-observed-save'); }
      }
      return out;
    };

    const originalCandidates = L.candidates.bind(L);
    L.candidates = function (st) {
      const rows = originalCandidates(st) || [];
      const dismissed = new Map();
      try {
        for (const rec of Object.values(st && st.days || {})) {
          for (const a of rec && rec.assignments || []) {
            if (!a || a.status !== 'dismissed' || !a.topicKey || !a.userDismissedAt) continue;
            const old = dismissed.get(a.topicKey);
            if (!old || String(a.userDismissedAt) > String(old.userDismissedAt)) dismissed.set(a.topicKey, a);
          }
        }
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'lacunas-dismiss-map'); }

      return rows.filter(r => {
        const d = dismissed.get(r && r.key);
        if (!d) return true;
        const newEvidence = new Date(r && r.lastError || 0).getTime();
        const dismissedAt = new Date(d.userDismissedAt || 0).getTime();
        return Number.isFinite(newEvidence) && Number.isFinite(dismissedAt) && newEvidence > dismissedAt;
      });
    };

    const originalTodayAssignments = L.todayAssignments.bind(L);
    L.todayAssignments = function () {
      return (originalTodayAssignments() || []).filter(a => a && a.status !== 'dismissed');
    };
  }

  /* ------------------------------------------------------------------------
     BOTÃO "ATACAR ERROS" — idempotência por evidência
     ------------------------------------------------------------------------
     A lógica pedagógica original é preservada: somente fraqueza confirmada pelo
     motor Robusto, no máximo uma frente por disciplina e três disciplinas por
     execução. O ledger impede recriar exatamente a mesma evidência depois que
     o usuário removeu a tarefa. Nova evidência (novo ID/novo erro) gera assinatura
     diferente e pode voltar a ser atacada.
  */
  const R = window.TecRealtime;
  if (R && typeof R.attack === 'function') {
    const ledgerKey = () => {
      try { return DB._profilePrefix() + 'tec-realtime:attack-ledger-v2'; }
      catch (_) { return 'diario-estudos:tec-realtime:attack-ledger-v2'; }
    };
    const readLedger = () => {
      try {
        const raw = JSON.parse(localStorage.getItem(ledgerKey()) || 'null');
        return raw && raw.schema === 2 && raw.entries ? raw : { schema: 2, entries: {}, updatedAt: null };
      } catch (_) { return { schema: 2, entries: {}, updatedAt: null }; }
    };
    const saveLedger = (ledger) => {
      ledger.updatedAt = nowIso();
      const raw = JSON.stringify(ledger);
      try {
        if (typeof DB !== 'undefined' && DB.setRaw) return DB.setRaw(ledgerKey(), raw) !== false;
        localStorage.setItem(ledgerKey(), raw); return true;
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-attack-ledger'); return false; }
    };
    const signatureFor = (g, range, account) => {
      const ids = [...(g && g.ids || [])].map(String).sort();
      return [range.from, range.to, account || '__todas__', norm(g.disciplina), norm(g.assunto), ids.join(','), num(g.errors)].join('|');
    };

    R.attack = function () {
      const range = this.range();
      const rows = this.rows();
      const groups = (this.groups(rows) || []).filter(g => g && g.robust);
      if (!groups.length) {
        if (typeof showToast === 'function') showToast('Nenhuma fraqueza confirmada pelo motor Robusto neste período. Nenhum reforço foi criado.');
        return { created: 0, skipped: 0, reason: 'no-confirmed' };
      }

      const bestByDisc = new Map();
      for (const g of groups) {
        const d = norm(g.disciplina);
        const old = bestByDisc.get(d);
        if (!old || num(g.uniqueIds) > num(old.uniqueIds) || (num(g.uniqueIds) === num(old.uniqueIds) && num(g.errors) > num(old.errors))) bestByDisc.set(d, g);
      }
      const chosen = [...bestByDisc.values()]
        .sort((a, b) => num(b.uniqueIds) - num(a.uniqueIds) || num(b.errors) - num(a.errors) || num(b.robust && b.robust.scoreTopico) - num(a.robust && a.robust.scoreTopico))
        .slice(0, 3);

      const ledger = readLedger();
      const account = this.activeAccount ? (this.activeAccount() || '__todas__') : '__todas__';
      let created = 0, skipped = 0;

      for (const g of chosen) {
        const sig = signatureFor(g, range, account);
        const open = (() => {
          try {
            return (DB.getExtras() || []).some(e => e && e.status !== 'concluida' && e.origemPlano
              && norm(e.origemPlano.disciplina) === norm(g.disciplina)
              && norm(e.origemPlano.topico) === norm(g.assunto));
          } catch (_) { return false; }
        })();
        if (open || ledger.entries[sig]) { skipped++; continue; }

        const dose = Math.max(1, Math.round(num(this.dose && this.dose(g.robust), 15)));
        try {
          const extra = DB.addExtra({
            titulo: `Reforçar: ${g.assunto}`,
            tipo: 'questoes', disciplina: g.disciplina, unidade: 'questoes',
            alvo: dose, periodo: 'unica',
            marcador: `Sinal TEC: ${g.uniqueIds} ID(s) errados, ${g.errors} erro(s) no período ${range.from}${range.from !== range.to ? ' a ' + range.to : ''}.`
          });
          if (!extra || !extra.id) { skipped++; continue; }

          let origem;
          try {
            origem = (typeof PlanoCiclo !== 'undefined' && PlanoCiclo.origem)
              ? PlanoCiclo.origem(g.assunto, g.disciplina, { ...g.robust, custoQ: dose }, { motivo: 'reforco' })
              : null;
          } catch (_) { origem = null; }
          if (!origem) origem = { topico: g.assunto, disciplina: g.disciplina, motivo: 'reforco', criadoEm: day(), taxaInicial: g.robust && g.robust.taxa != null ? g.robust.taxa : null, custoEstimado: dose };
          origem.sinalTempoReal = {
            versao: 2, assinatura: sig, intervalo: range, contaTec: account,
            ids: [...(g.ids || [])], erros: g.errors, idsUnicos: g.uniqueIds,
            criadoEm: nowIso(), fonte: 'companion'
          };
          DB.updateExtra(extra.id, { origemPlano: origem });
          ledger.entries[sig] = { extraId: String(extra.id), createdAt: nowIso(), range, disciplina: g.disciplina, assunto: g.assunto, errors: g.errors };
          created++;
        } catch (e) {
          skipped++;
          if (typeof _quiet === 'function') _quiet(e, 'tec-attack-create');
        }
      }

      saveLedger(ledger);
      try { if (typeof ReforcoFila !== 'undefined' && ReforcoFila.sincronizar) ReforcoFila.sincronizar(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-attack-fila'); }
      try { if (typeof ExtrasScreen !== 'undefined' && ExtrasScreen.render) ExtrasScreen.render(); }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-attack-render'); }

      if (typeof showToast === 'function') {
        showToast(created
          ? `Força-tarefa criada: ${created} reforço(s) confirmado(s) ✓${skipped ? ' · ' + skipped + ' já tratado(s)' : ''}`
          : 'Nenhum reforço duplicado foi criado: esta evidência já está em curso ou já foi tratada.');
      }
      return { created, skipped, chosen };
    };
  }
})();
