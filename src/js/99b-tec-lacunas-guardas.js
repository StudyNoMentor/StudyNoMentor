/* Guardas finais da Correção Contínua de Lacunas.
 * Carrega logo depois do motor principal para manter o contrato visual simples:
 * no máximo 3 matérias no DIA inteiro (não apenas 3 pendentes simultâneas),
 * leitura tolerante das matérias do ciclo, reaproveitamento da biblioteca antiga
 * e progresso longitudinal que sobrevive à troca/remoção de planejamentos.
 */
(() => {
  const L=window.TecLacunasContinuas;
  if (!L || window.__tecLacunasGuardas) return;
  window.__tecLacunasGuardas=true;

  const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const normLocal=(v)=>String(v==null?'':v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const day=()=>typeof todayLocal==='function'?todayLocal():(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;})();
  const localDateOf=(raw)=>{
    const s=String(raw||'');
    let m=s.match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1];
    m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const d=new Date(raw||Date.now());
    return Number.isNaN(d.getTime())?day():`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  /* Biblioteca importada/antiga também é patrimônio do aluno. O realtime é a
     fonte preferencial porque preserva TODAS as tentativas; a biblioteca só
     fornece um evento de backfill quando aquela combinação conta+caderno+ID
     ainda não possui nenhuma resolução factual no ledger realtime. */
  const originalEvents=L.events.bind(L);
  L.events=function(){
    const live=originalEvents()||[];
    const covered=new Set(live.map(e=>[e&&e.tecAccount||'',e&&e.bookId||'',e&&e.questionId||''].join('|')));
    const out=[...live];
    try {
      for (const row of this.libraryRows()||[]) {
        const question=row&&row.question||{}, id=String(question.id||'').trim();
        if (!id || typeof question.acertou!=='boolean') continue;
        const account=String(row.tecAccount||'conta-importada'), book=String(row.bookId||question.cadernoId||'');
        const sig=[account,book,id].join('|'); if (covered.has(sig)) continue;
        const resolvedAt=String(question.capturadoEm||row.receivedAt||new Date().toISOString());
        out.push({
          eventId:`library_${encodeURIComponent(account)}_${encodeURIComponent(book)}_${encodeURIComponent(id)}`,
          questionId:id, tecAccount:account, bookId:book, resolvedAt,
          localDate:localDateOf(question.dataResolucao||resolvedAt), acertou:question.acertou,
          marcada:question.marcada||null, correta:question.correta||null,
          materia:String(question.materia||''), assunto:String(question.assunto||''), banca:String(question.banca||''), concurso:String(question.concurso||''),
          favorite:question.favorite===true||question.favorita===true||question.favorito===true||question.isFavorite===true,
          favorita:question.favorita===true||question.favorito===true,
          phaseHint:question.phaseHint||question.contexto||question.origem||null,
          bookLabel:question.bookLabel||question.cadernoNome||row.bookLabel||row.bookName||null,
          source:'library-backfill', receivedAt:row.receivedAt||resolvedAt
        });
        covered.add(sig);
      }
    } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-library-backfill'); }
    return out.sort((a,b)=>String(a.resolvedAt||'').localeCompare(String(b.resolvedAt||'')));
  };

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

  /* O progresso verdadeiro é global. Cada espelho em Extras registra quanto já
     havia sido feito antes de ele nascer. Por isso o valor canônico é o MAIOR
     ponto alcançado (offset + progresso local), e não a soma cega de espelhos.
     Isso continua correto mesmo se o planejamento anterior for removido. */
  L.assignmentProgress=function(assignment){
    const target=Math.max(0,num(assignment&&assignment.target));
    let progress=Math.max(0,num(assignment&&assignment.progress));
    let completedAt=assignment&&assignment.completedAt||null;
    try {
      for (const { extra } of this.allPlanExtras()||[]) {
        const o=extra&&extra.origemLacunaGlobal;
        if (!o || o.assignmentId!==(assignment&&assignment.id)) continue;
        const reached=Math.max(0,num(o.globalProgressBefore))+Math.max(0,num(extra.progresso));
        if (reached>progress) progress=reached;
        const done=extra.status==='concluida' || (target>0 && reached>=target);
        if (done && (!completedAt || String(extra.updatedAt||'')>String(completedAt))) completedAt=extra.updatedAt||completedAt;
      }
    } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-global-progress'); }
    return { progress, completedAt, done:target>0&&progress>=target };
  };

  const originalCompletions=L.reinforcementCompletions.bind(L);
  L.reinforcementCompletions=function(){
    const byTopic=originalCompletions()||new Map();
    try {
      const st=this.state();
      for (const rec of Object.values(st.days||{})) for (const a of rec&&rec.assignments||[]) {
        if (!a || !a.topicKey || a.status!=='completed') continue;
        if (!byTopic.has(a.topicKey)) byTopic.set(a.topicKey,[]);
        const rows=byTopic.get(a.topicKey);
        if (rows.some(x=>x&&x.assignmentId===a.id)) continue;
        rows.push({ assignmentId:a.id, planId:a.planAtCreation||rec.planId||null, extraId:null, complete:true, progress:num(a.progress), target:num(a.target), completedAt:a.completedAt||rec.updatedAt||null, createdAt:a.createdAt||rec.createdAt||null, source:'global-ledger' });
      }
    } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-global-completions'); }
    return byTopic;
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
