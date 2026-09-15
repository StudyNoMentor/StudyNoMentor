/* Guardas finais da Correção Contínua de Lacunas.
 * Carrega logo depois do motor principal para manter o contrato visual simples:
 * no máximo 3 matérias no DIA inteiro (não apenas 3 pendentes simultâneas),
 * leitura tolerante das matérias do ciclo, reaproveitamento da biblioteca antiga,
 * progresso longitudinal entre planejamentos e reconhecimento da correção natural
 * feita pelo próprio fluxo Erradas → Erradas das erradas → zeragem.
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
  const ageDays=(raw)=>{
    const d=new Date(raw||0); if (Number.isNaN(d.getTime())) return 999;
    return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));
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

  /* A lente deve seguir primeiro as matérias ATIVAS do planejamento. O ciclo é
     fallback apenas quando essa lista não existe; assim uma disciplina desligada
     que ainda permaneça num ciclo antigo não volta a ganhar prioridade sozinha. */
  L.currentSubjects=function(){
    const names=[];
    try {
      const active=typeof DB!=='undefined'&&DB.getActiveSubjects?DB.getActiveSubjects():[];
      for (const s of active||[]) {
        const name=typeof s==='string'?s:s&&(s.nome||s.name||s.subject||s.disciplina);
        if (name) names.push(String(name));
      }
    } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-guard-subjects-active'); }
    if (!names.length) {
      try {
        const cyc=typeof DB!=='undefined'&&DB.getCurrentCycle?DB.getCurrentCycle():null;
        for (const s of cyc&&cyc.subjects||[]) {
          const name=typeof s==='string'?s:s&&(s.nome||s.name||s.subject||s.disciplina);
          if (name) names.push(String(name));
        }
      } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-guard-subjects-cycle'); }
    }
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

  /* O fluxo natural do aluno também corrige lacunas. Se TODAS as questões que
     já foram erradas no tópico terminaram com uma tentativa correta, o tópico
     entra em resfriamento curto. Não declaramos domínio permanente: um novo erro
     em Favoritas, em outro caderno ou numa amostra posterior o reativa na hora. */
  const originalTopics=L.topics.bind(L);
  L.topics=function(){
    const topics=originalTopics()||[];
    for (const t of topics) {
      const perId=new Map();
      for (const ev of t.events||[]) {
        const id=String(ev&&ev.questionId||''); if (!id) continue;
        const r=perId.get(id)||{ hadWrong:false,lastResult:null,lastAt:null };
        if (ev.acertou===false) r.hadWrong=true;
        if (typeof ev.acertou==='boolean') { r.lastResult=ev.acertou; r.lastAt=ev.resolvedAt||r.lastAt; }
        perId.set(id,r);
      }
      const wrongStates=[...perId.values()].filter(x=>x.hadWrong);
      t.unresolvedWrong=wrongStates.filter(x=>x.lastResult===false).length;
      t.correctedWrong=wrongStates.filter(x=>x.lastResult===true).length;
      t.naturalRecovered=wrongStates.length>0 && t.unresolvedWrong===0 && t.correctedWrong===wrongStates.length;
      const lastCorrection=[...perId.values()].filter(x=>x.hadWrong&&x.lastResult===true).map(x=>x.lastAt).filter(Boolean).sort().pop()||null;
      t.lastNaturalCorrection=lastCorrection;
      t.naturalCooldown=t.naturalRecovered && !t.persistent && ageDays(lastCorrection)<2;
      if (t.naturalRecovered && !t.persistent) {
        t.priority-=40;
        if (!t.improving) t.status='corrigida-na-rodada';
      }
    }
    return topics.sort((a,b)=>b.priority-a.priority||String(b.lastError||'').localeCompare(String(a.lastError||'')));
  };

  /* Dentro do banco pessoal, primeiro vêm erros AINDA abertos. Questões já
     corrigidas são úteis para consolidação, mas preferimos as mais antigas para
     reduzir mero reconhecimento do gabarito. */
  const originalPool=L.questionPool.bind(L);
  L.questionPool=function(topic){
    const rows=originalPool(topic)||[];
    return rows.sort((a,b)=>{
      const ca=a.lastResult===false?0:(a.favorite&&a.errors>0?1:(a.errors>1?2:(a.errors>0?3:4)));
      const cb=b.lastResult===false?0:(b.favorite&&b.errors>0?1:(b.errors>1?2:(b.errors>0?3:4)));
      if (ca!==cb) return ca-cb;
      if (ca===0) return String(b.lastError||b.lastSeen||'').localeCompare(String(a.lastError||a.lastSeen||''));
      return String(a.lastSeen||'').localeCompare(String(b.lastSeen||''));
    });
  };

  const originalCandidates=L.candidates.bind(L);
  L.candidates=function(st){
    const rows=(originalCandidates(st)||[]).filter(r=>!r.naturalCooldown);
    const rec=st&&st.days&&st.days[day()];
    const assignments=rec&&Array.isArray(rec.assignments)?rec.assignments:[];
    const used=new Set(assignments.filter(a=>a&&a.status!=='deferred').map(a=>normLocal(a.disciplina)).filter(Boolean));
    const remaining=Math.max(0,3-used.size);
    if (!remaining) return [];
    return rows.filter(r=>!used.has(normLocal(r&&r.disciplina))).slice(0,remaining);
  };
})();
