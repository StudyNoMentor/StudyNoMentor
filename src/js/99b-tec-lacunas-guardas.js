/* Guardas finais da Correção Contínua de Lacunas.
 * Carrega logo depois do motor principal para manter o contrato visual simples:
 * no máximo 3 matérias no DIA inteiro (não apenas 3 pendentes simultâneas) e
 * leitura tolerante das matérias do ciclo quando vierem como string/objeto.
 */
(() => {
  const L=window.TecLacunasContinuas;
  if (!L || window.__tecLacunasGuardas) return;
  window.__tecLacunasGuardas=true;

  const normLocal=(v)=>String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const day=()=>typeof todayLocal==='function'?todayLocal():(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;})();

  const originalSubjects=L.currentSubjects.bind(L);
  L.currentSubjects=function(){
    const names=[];
    try { names.push(...(originalSubjects()||[])); } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-guard-subjects-base'); }
    try {
      const cyc=typeof DB!=='undefined'&&DB.getCurrentCycle?DB.getCurrentCycle():null;
      for (const s of cyc&&cyc.subjects||[]) {
        const name=typeof s==='string'?s:s&&(s.nome||s.name||s.subject||s.disciplina);
        if (name) names.push(String(name));
      }
    } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-guard-subjects-cycle'); }
    const seen=new Set(), out=[];
    for (const raw of names) { const k=normLocal(raw); if (!k||seen.has(k)) continue; seen.add(k); out.push(String(raw).trim()); }
    return out;
  };

  const originalCandidates=L.candidates.bind(L);
  L.candidates=function(st){
    const rows=originalCandidates(st)||[];
    const rec=st&&st.days&&st.days[day()];
    const assignments=rec&&Array.isArray(rec.assignments)?rec.assignments:[];
    const used=new Set(assignments.filter(a=>a&&a.status!=='deferred').map(a=>normLocal(a.disciplina)).filter(Boolean));
    const remaining=Math.max(0,3-used.size);
    if (!remaining) return [];
    return rows.filter(r=>!used.has(normLocal(r&&r.disciplina))).slice(0,remaining);
  };
})();
