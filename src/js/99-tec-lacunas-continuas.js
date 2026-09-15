/* ============================================================================
   LACUNAS CONTÍNUAS — memória global do aluno + reforço diário enxuto
   ----------------------------------------------------------------------------
   Princípios:
   · a memória pertence ao PERFIL do aluno, não ao planejamento ativo;
   · caderno é CONTEXTO mutável, nunca unidade de verdade nem meta fixa;
   · questionId identifica a questão; cada resolução continua append-only;
   · a mesma questão pode aparecer em Base/Erradas/Favoritas sem inflar a
     quantidade de questões distintas: repetições medem resistência;
   · reforços usam SOMENTE questões já presentes no histórico pessoal;
   · o planejamento atual é uma lente de relevância, não dono da lacuna;
   · no dia entram no máximo 3 disciplinas, com rodízio semanal e doses baixas.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecLacunasContinuas) return;
  window.__tecLacunasContinuas = true;

  const KEY = 'tec-lacunas-global-v1';
  const SCHEMA = 1;
  const MAX_DISCIPLINAS_DIA = 3;
  const QUESTOES_PADRAO = 5;
  const QUESTOES_MICRO = 3;
  const QUESTOES_PERSISTENTE = 6;
  const MAX_QUESTOES_DIA = 18;
  const JANELA_RECENTE_DIAS = 30;
  const ROTACAO_DIAS = 7;
  const REPROCESS_DELAY = 80;

  const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const norm = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const esc = (v) => typeof escapeHtml === 'function' ? escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const isoDay = (value = new Date()) => {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const today = () => typeof todayLocal === 'function' ? todayLocal() : isoDay(new Date());
  const addDays = (iso, delta) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + delta);
    return isoDay(d);
  };
  const uid = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const q = (selector, root = document) => root && root.querySelector ? root.querySelector(selector) : null;

  const L = {
    _refreshTimer: null,
    _lastPlanId: null,
    _poll: null,
    _patched: false,

    /* PERFIL global: deliberadamente NÃO usa DB.KEYS nem _activePlanId(). */
    key() {
      try { return DB._profilePrefix() + KEY; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e,'lacunas-key'); return 'diario-estudos:' + KEY; }
    },
    blank() { return { schema:SCHEMA, days:{}, topicNotes:{}, updatedAt:null }; },
    state() {
      try {
        const raw=JSON.parse(localStorage.getItem(this.key()) || 'null');
        return raw && raw.schema===SCHEMA && raw.days && typeof raw.days==='object' ? raw : this.blank();
      } catch (e) { if (typeof _quiet === 'function') _quiet(e,'lacunas-state'); return this.blank(); }
    },
    save(st) {
      st.updatedAt=new Date().toISOString();
      try {
        const raw=JSON.stringify(st);
        if (typeof DB!=='undefined' && DB.setRaw) return DB.setRaw(this.key(),raw)!==false;
        localStorage.setItem(this.key(),raw); return true;
      } catch (e) { if (typeof _quiet === 'function') _quiet(e,'lacunas-save'); return false; }
    },
    planId() {
      try { return DB._activePlanId ? String(DB._activePlanId()) : 'default'; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e,'lacunas-plan-id'); return 'default'; }
    },
    topicKey(disc, topic) { return `${norm(disc)}¦${norm(topic)}`; },

    events() {
      try {
        const st=window.TecRealtime && TecRealtime.state ? TecRealtime.state() : null;
        return Object.values(st && st.events || {}).filter(Boolean).sort((a,b)=>String(a.resolvedAt||'').localeCompare(String(b.resolvedAt||'')));
      } catch (e) { if (typeof _quiet === 'function') _quiet(e,'lacunas-events'); return []; }
    },
    libraryRows() {
      try {
        const st=window.TecIntegracaoScreen && TecIntegracaoScreen.state ? TecIntegracaoScreen.state() : null;
        return Object.values(st && st.questions || {}).filter(Boolean);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e,'lacunas-library'); return []; }
    },
    currentSubjects() {
      try {
        const names=[];
        if (typeof DB!=='undefined' && DB.getActiveSubjects) for (const s of DB.getActiveSubjects() || []) if (s && s.nome) names.push(String(s.nome));
        if (typeof DB!=='undefined' && DB.getCurrentCycle) {
          const cyc=DB.getCurrentCycle();
          for (const s of cyc && cyc.subjects || []) {
            const name=s && (s.nome || s.name || s.subject || s.disciplina);
            if (name) names.push(String(name));
          }
        }
        return [...new Set(names.map(x=>x.trim()).filter(Boolean))];
      } catch (e) { if (typeof _quiet === 'function') _quiet(e,'lacunas-subjects'); return []; }
    },
    relevantToCurrentPlan(disc) {
      const wanted=this.currentSubjects().map(norm).filter(Boolean);
      if (!wanted.length) return true;
      const d=norm(disc);
      return wanted.some(x=>x===d || x.includes(d) || d.includes(x));
    },

    questionMeta() {
      const map=new Map();
      for (const row of this.libraryRows()) {
        const question=row && row.question || {};
        const id=String(question.id || '').trim(); if (!id) continue;
        if (!map.has(id)) map.set(id,{ rows:[], favorite:false, urls:[], books:new Set(), question:null });
        const m=map.get(id); m.rows.push(row); m.question=m.question || question;
        if (row.bookId) m.books.add(String(row.bookId));
        if (question.url) m.urls.push(String(question.url));
        const favorite = question.favorita === true || question.favorite === true || question.favorito === true || question.isFavorite === true || row.favorite === true || row.favorita === true;
        if (favorite || /favorit/.test(norm([question.contexto,question.origem,question.cadernoNome,row.bookLabel,row.bookName].filter(Boolean).join(' ')))) m.favorite=true;
      }
      return map;
    },
    eventFavorite(ev, meta) {
      if (!ev) return false;
      if (ev.favorite === true || ev.favorita === true || ev.isFavorite === true) return true;
      if (/favorit/.test(norm([ev.phaseHint,ev.bookLabel,ev.bookName,ev.contexto].filter(Boolean).join(' ')))) return true;
      const m=meta && meta.get(String(ev.questionId || ''));
      return !!(m && m.favorite);
    },
    eventPhase(ev) {
      const hay=norm([ev && ev.phaseHint,ev && ev.bookLabel,ev && ev.bookName,ev && ev.contexto].filter(Boolean).join(' '));
      if (/favorit/.test(hay)) return 'favoritas';
      if (/errad|erro/.test(hay)) return 'erradas';
      return 'nao-identificada';
    },

    allPlanExtras() {
      const out=[];
      try {
        const plans=window.PlanManager && PlanManager.getPlans ? (PlanManager.getPlans() || []) : [{ id:this.planId() }];
        for (const p of plans) {
          const pid=String(p && p.id || ''); if (!pid) continue;
          const key=DB.keysForPlan(pid).extras;
          const list=DB._get ? DB._get(key,[]) : [];
          for (const ex of Array.isArray(list) ? list : []) out.push({ planId:pid, extra:ex });
        }
      } catch (e) { if (typeof _quiet === 'function') _quiet(e,'lacunas-all-extras'); }
      return out;
    },
    reinforcementCompletions() {
      const byTopic=new Map();
      for (const { planId, extra } of this.allPlanExtras()) {
        const o=extra && extra.origemLacunaGlobal;
        if (!o || !o.topicKey) continue;
        const target=Math.max(0,n(o.globalTarget,extra.alvo));
        const progress=Math.max(0,n(extra.progresso));
        const complete=extra.status==='concluida' || (target>0 && progress>=Math.max(1,n(extra.alvo,target)));
        const history=Array.isArray(extra.historico) ? extra.historico : [];
        const lastHistory=history.map(h=>h && h.data).filter(Boolean).sort().pop() || null;
        const at=complete ? (String(extra.updatedAt || '').includes('T') ? extra.updatedAt : (lastHistory ? `${lastHistory}T23:59:59` : extra.updatedAt || null)) : null;
        if (!byTopic.has(o.topicKey)) byTopic.set(o.topicKey,[]);
        byTopic.get(o.topicKey).push({ planId, extraId:extra.id, complete, progress, target, completedAt:at, createdAt:extra.createdAt || null });
      }
      return byTopic;
    },

    topics() {
      const meta=this.questionMeta();
      const completions=this.reinforcementCompletions();
      const map=new Map();
      const perQuestion=new Map();
      const recentFrom=addDays(today(),-(JANELA_RECENTE_DIAS-1));
      for (const ev of this.events()) {
        const disc=String(ev.materia || 'Matéria não identificada').trim();
        const topic=String(ev.assunto || 'Assunto não identificado').trim();
        const id=String(ev.questionId || '').trim(); if (!id) continue;
        const tk=this.topicKey(disc,topic);
        if (!map.has(tk)) map.set(tk,{ key:tk,disciplina:disc,assunto:topic,events:[],questionIds:new Set(),wrongIds:new Set(),correctIds:new Set(),favoriteWrongIds:new Set(),books:new Set(),errors:0,correct:0,repeatErrors:0,recentErrors:0,lastError:null,lastSeen:null,phases:new Set() });
        const g=map.get(tk); g.events.push(ev); g.questionIds.add(id); if (ev.bookId) g.books.add(String(ev.bookId)); g.phases.add(this.eventPhase(ev));
        const qk=id; const prev=perQuestion.get(qk) || { wrong:0, attempts:0, last:null };
        prev.attempts++;
        if (ev.acertou===false) {
          g.errors++; g.wrongIds.add(id); if (prev.wrong>0) g.repeatErrors++; prev.wrong++;
          if (ev.localDate>=recentFrom) g.recentErrors++;
          if (this.eventFavorite(ev,meta)) g.favoriteWrongIds.add(id);
          if (!g.lastError || String(ev.resolvedAt||'')>String(g.lastError||'')) g.lastError=ev.resolvedAt || null;
        } else if (ev.acertou===true) { g.correct++; g.correctIds.add(id); }
        if (!g.lastSeen || String(ev.resolvedAt||'')>String(g.lastSeen||'')) g.lastSeen=ev.resolvedAt || null;
        prev.last=ev; perQuestion.set(qk,prev);
      }

      const robustCtx=(() => { try { return window.TecRealtime && TecRealtime.motorContext ? TecRealtime.motorContext() : null; } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-robust'); return null; } })();
      const out=[];
      for (const g of map.values()) {
        if (!g.errors) continue;
        const comps=(completions.get(g.key)||[]).filter(x=>x.complete && x.completedAt).sort((a,b)=>String(a.completedAt).localeCompare(String(b.completedAt)));
        const lastComp=comps.length ? comps[comps.length-1] : null;
        const post=lastComp ? g.events.filter(e=>String(e.resolvedAt||'')>String(lastComp.completedAt||'')) : [];
        const postErrors=post.filter(e=>e.acertou===false).length;
        const postCorrect=post.filter(e=>e.acertou===true).length;
        const postRate=post.length ? postCorrect/post.length : null;
        const persistent=postErrors>=2 || (lastComp && postErrors>=1 && g.repeatErrors>=1);
        const improving=post.length>=3 && postRate>=0.8 && postErrors<=1;
        let robust=false;
        try {
          if (robustCtx && robustCtx.key && robustCtx.robustMap) robust=!!robustCtx.robustMap.get(robustCtx.key(g.disciplina,g.assunto));
        } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-robust-map'); }
        const recencyDays=g.lastError ? Math.max(0,Math.floor((Date.now()-new Date(g.lastError).getTime())/86400000)) : 999;
        const priority =
          (persistent?70:0) + g.wrongIds.size*18 + g.repeatErrors*14 + g.recentErrors*8 + g.favoriteWrongIds.size*7 +
          (robust?8:0) + Math.max(0,18-Math.min(18,recencyDays)) - (improving?35:0);
        const status=persistent?'persistente':improving?'melhorando':g.repeatErrors>0?'resistente':g.wrongIds.size>=2?'ativa':'inicial';
        out.push({ ...g, uniqueWrong:g.wrongIds.size, uniqueQuestions:g.questionIds.size, favoriteWrong:g.favoriteWrongIds.size, lastCompletion:lastComp, postErrors, postCorrect, postRate, persistent, improving, robust, recencyDays, priority, status, relevant:this.relevantToCurrentPlan(g.disciplina) });
      }
      return out.sort((a,b)=>b.priority-a.priority || String(b.lastError||'').localeCompare(String(a.lastError||'')));
    },

    questionPool(topic) {
      const meta=this.questionMeta();
      const rows=new Map();
      for (const ev of topic.events || []) {
        const id=String(ev.questionId || ''); if (!id) continue;
        if (!rows.has(id)) rows.set(id,{ id, attempts:0, errors:0, correct:0, lastSeen:null, lastError:null, favorite:false, books:new Set(), phases:new Set(), url:null, lastResult:null });
        const r=rows.get(id); r.attempts++; r.lastResult=ev.acertou;
        if (ev.acertou===false) { r.errors++; r.lastError=ev.resolvedAt || r.lastError; }
        if (ev.acertou===true) r.correct++;
        if (!r.lastSeen || String(ev.resolvedAt||'')>String(r.lastSeen||'')) r.lastSeen=ev.resolvedAt || r.lastSeen;
        if (ev.bookId) r.books.add(String(ev.bookId));
        r.phases.add(this.eventPhase(ev));
        r.favorite = r.favorite || this.eventFavorite(ev,meta);
        const m=meta.get(id); if (m && m.urls && m.urls.length) r.url=m.urls[m.urls.length-1];
      }
      return [...rows.values()].sort((a,b)=>{
        const ca = a.errors>1 ? 0 : a.lastResult===false ? 1 : a.favorite ? 2 : a.errors>0 ? 3 : 4;
        const cb = b.errors>1 ? 0 : b.lastResult===false ? 1 : b.favorite ? 2 : b.errors>0 ? 3 : 4;
        if (ca!==cb) return ca-cb;
        if (ca<=3) return String(b.lastError||b.lastSeen||'').localeCompare(String(a.lastError||a.lastSeen||''));
        return String(a.lastSeen||'').localeCompare(String(b.lastSeen||''));
      });
    },
    targetFor(topic, poolSize) {
      const base=topic.persistent || topic.status==='resistente' ? QUESTOES_PERSISTENTE : topic.uniqueWrong<=1 ? QUESTOES_MICRO : QUESTOES_PADRAO;
      return Math.max(1,Math.min(base,poolSize));
    },

    usageByDiscipline(st, day=today()) {
      const start=addDays(day,-(ROTACAO_DIAS-1));
      const map=new Map();
      for (const [d,rec] of Object.entries(st.days||{})) {
        if (d<start || d>day) continue;
        for (const a of rec.assignments||[]) {
          if (a.status==='deferred') continue;
          const k=norm(a.disciplina); const u=map.get(k)||{ count:0,last:null,days:new Set() };
          u.count++; u.days.add(d); if (!u.last || d>u.last) u.last=d; map.set(k,u);
        }
      }
      return map;
    },
    assignmentProgress(assignment) {
      let progress=0, completedAt=null;
      for (const { planId, extra } of this.allPlanExtras()) {
        const o=extra && extra.origemLacunaGlobal;
        if (!o || o.assignmentId!==assignment.id) continue;
        progress += Math.max(0,n(extra.progresso));
        const done=extra.status==='concluida' || (n(extra.alvo)>0 && n(extra.progresso)>=n(extra.alvo));
        if (done && (!completedAt || String(extra.updatedAt||'')>String(completedAt))) completedAt=extra.updatedAt || null;
      }
      return { progress, completedAt, done:assignment.target>0 && progress>=assignment.target };
    },
    candidates(st) {
      const usage=this.usageByDiscipline(st);
      const yesterday=addDays(today(),-1);
      const current=this.topics().filter(t=>t.relevant && !t.improving);
      const topByDisc=new Map();
      for (const t of current) {
        const d=norm(t.disciplina); const u=usage.get(d)||{count:0,last:null};
        const yesterdayPenalty=u.last===yesterday ? 24 : 0;
        const weeklyPenalty=u.count*9;
        const rotationScore=t.priority-weeklyPenalty-yesterdayPenalty+(t.persistent?28:0);
        const row={...t,rotationScore,weeklyUse:u.count,lastUse:u.last};
        if (!topByDisc.has(d) || row.rotationScore>topByDisc.get(d).rotationScore) topByDisc.set(d,row);
      }
      return [...topByDisc.values()].sort((a,b)=>b.rotationScore-a.rotationScore || a.weeklyUse-b.weeklyUse || String(b.lastError||'').localeCompare(String(a.lastError||'')));
    },

    syncAssignmentStatuses(st) {
      let changed=false;
      for (const rec of Object.values(st.days||{})) for (const a of rec.assignments||[]) {
        if (a.status==='deferred') continue;
        const p=this.assignmentProgress(a);
        if (p.done && a.status!=='completed') { a.status='completed'; a.completedAt=p.completedAt || new Date().toISOString(); changed=true; }
        a.progress=p.progress;
      }
      return changed;
    },
    ensureToday(force=false) {
      const st=this.state(); this.syncAssignmentStatuses(st);
      const day=today(), planId=this.planId();
      if (!st.days[day]) st.days[day]={ day, planId, assignments:[], createdAt:new Date().toISOString(), updatedAt:null };
      const rec=st.days[day];

      /* Ao trocar de planejamento, pendências sem execução que ficaram fora da lente
         atual são adiadas, nunca apagadas. A memória da lacuna continua global. */
      if (rec.planId!==planId || force) {
        rec.planId=planId;
        for (const a of rec.assignments) {
          if (a.status!=='pending') continue;
          const p=this.assignmentProgress(a);
          if (p.progress<=0 && !this.relevantToCurrentPlan(a.disciplina)) a.status='deferred';
        }
      }

      const active=rec.assignments.filter(a=>a.status==='pending' || a.status==='completed');
      const usedDisc=new Set(active.map(a=>norm(a.disciplina)));
      let total=active.reduce((sum,a)=>sum+Math.max(0,n(a.target)),0);
      for (const t of this.candidates(st)) {
        if (active.filter(a=>a.status==='pending').length>=MAX_DISCIPLINAS_DIA) break;
        if (usedDisc.has(norm(t.disciplina))) continue;
        const pool=this.questionPool(t); if (!pool.length) continue;
        const target=Math.min(this.targetFor(t,pool.length),Math.max(0,MAX_QUESTOES_DIA-total)); if (!target) break;
        const selected=pool.slice(0,target);
        const assignment={
          id:'lac_'+uid(), topicKey:t.key, disciplina:t.disciplina, assunto:t.assunto,
          questionIds:selected.map(x=>x.id), target, status:'pending', progress:0,
          reason:t.status, evidence:{ uniqueWrong:t.uniqueWrong, repeatErrors:t.repeatErrors, favoriteWrong:t.favoriteWrong, recentErrors:t.recentErrors, persistent:t.persistent, robust:t.robust },
          createdAt:new Date().toISOString(), planAtCreation:planId, source:'historico-tec'
        };
        rec.assignments.push(assignment); active.push(assignment); usedDisc.add(norm(t.disciplina)); total+=target;
      }
      rec.updatedAt=new Date().toISOString(); this.save(st);
      this.mirrorTodayToExtras(st);
      return st.days[day];
    },

    mirrorTodayToExtras(st=this.state()) {
      const day=today(), rec=st.days && st.days[day]; if (!rec) return;
      const pid=this.planId();
      let changed=false;
      for (const a of rec.assignments||[]) {
        if (a.status!=='pending' || !this.relevantToCurrentPlan(a.disciplina)) continue;
        const links=this.allPlanExtras().filter(x=>x.planId===pid && x.extra && x.extra.origemLacunaGlobal && x.extra.origemLacunaGlobal.assignmentId===a.id);
        if (links.length) continue;
        const p=this.assignmentProgress(a), remaining=Math.max(0,a.target-p.progress); if (!remaining) continue;
        try {
          const ex=DB.addExtra({ titulo:`Reforço · ${a.assunto}`, tipo:'questoes', disciplina:a.disciplina, unidade:'questoes', alvo:remaining, periodo:'unica', datas:[day], contaMetricas:true });
          if (ex && ex.id) {
            DB.updateExtra(ex.id,{ origemLacunaGlobal:{ schema:1, assignmentId:a.id, topicKey:a.topicKey, questionIds:[...a.questionIds], globalTarget:a.target, globalProgressBefore:p.progress, day, planId:pid, source:'historico-tec' }, marcador:`IDs TEC: ${a.questionIds.join(', ')}` });
            changed=true;
          }
        } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-mirror-extra'); }
      }
      if (changed && typeof ExtrasScreen!=='undefined' && ExtrasScreen.render) {
        try { ExtrasScreen.render(); } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-render-extras'); }
      }
    },

    todayAssignments() {
      const rec=this.ensureToday(false); return (rec && rec.assignments || []).filter(a=>a.status!=='deferred');
    },
    topicForAssignment(a) { return this.topics().find(t=>t.key===a.topicKey) || null; },
    explain(a) {
      const e=a.evidence||{};
      if (e.persistent) return 'Persistiu depois de reforço anterior';
      if (n(e.repeatErrors)>0) return `${e.repeatErrors} reincidência(s) na mesma questão`;
      if (n(e.favoriteWrong)>0) return `${e.uniqueWrong} questão(ões) distintas erradas · favorita(s) envolvida(s)`;
      if (n(e.uniqueWrong)>=2) return `${e.uniqueWrong} questões diferentes erradas`;
      return 'Erro recente: microcorreção';
    },
    async copyIds(a) {
      try {
        await navigator.clipboard.writeText((a.questionIds||[]).join('\n'));
        if (typeof showToast==='function') showToast(`${(a.questionIds||[]).length} ID(s) copiados ✓`);
      } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-copy'); if (typeof showToast==='function') showToast('Não foi possível copiar os IDs.'); }
    },
    goExtras() {
      try {
        const btn=document.querySelector('[data-screen="extras"]'); if (btn) { btn.click(); return; }
        if (typeof navigate==='function') navigate('extras');
      } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-go-extras'); }
    },
    exportPayload() {
      const st=this.state();
      return { type:'StudyNoMentorLacunasContinuas', schema:SCHEMA, generatedAt:new Date().toISOString(), profileGlobal:true, activePlan:this.planId(), config:{ maxDisciplinasDia:MAX_DISCIPLINAS_DIA, questoesPadrao:QUESTOES_PADRAO, maxQuestoesDia:MAX_QUESTOES_DIA, rotacaoDias:ROTACAO_DIAS }, topics:this.topics().map(t=>({ disciplina:t.disciplina, assunto:t.assunto, uniqueWrong:t.uniqueWrong, errors:t.errors, repeatErrors:t.repeatErrors, favoriteWrong:t.favoriteWrong, recentErrors:t.recentErrors, status:t.status, relevant:t.relevant, lastError:t.lastError, postErrors:t.postErrors, postCorrect:t.postCorrect })), days:st.days };
    },
    async copyExport() {
      try { await navigator.clipboard.writeText(JSON.stringify(this.exportPayload(),null,2)); if (typeof showToast==='function') showToast('Mapa de lacunas copiado ✓'); }
      catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-export'); }
    },

    ensureCard() {
      const screen=q('#screen-integracaotec'); if (!screen) return null;
      const old=q('#tec-real-evidence-card'); if (old) old.hidden=true;
      let card=q('#tec-lacunas-card');
      if (!card) {
        card=document.createElement('section'); card.id='tec-lacunas-card'; card.className='card tec-lacunas-card';
        card.innerHTML=`<div class="card-header tec-lacunas-head"><div><h2>🎯 Correção contínua de lacunas</h2><p class="sub">Memória global do aluno. O planejamento atual só define o que é relevante agora.</p></div><div class="tec-lacunas-actions"><button type="button" class="btn-secondary" id="tec-lacunas-extras">Atividades Extras</button><button type="button" class="btn-secondary" id="tec-lacunas-export">Copiar mapa</button></div></div><div id="tec-lacunas-summary" class="tec-lacunas-summary"></div><div id="tec-lacunas-list" class="tec-lacunas-list"></div><p class="tec-lacunas-foot">Rodízio: até 3 disciplinas/dia · doses de 3–6 questões · somente questões já feitas · cadernos podem mudar de tamanho sem alterar o histórico.</p>`;
        const assistant=screen.querySelector('.tec-assistant-card');
        if (assistant && assistant.parentElement) assistant.insertAdjacentElement('afterend',card); else screen.appendChild(card);
        q('#tec-lacunas-extras',card)?.addEventListener('click',()=>this.goExtras());
        q('#tec-lacunas-export',card)?.addEventListener('click',()=>this.copyExport());
      }
      return card;
    },
    render() {
      const card=this.ensureCard(); if (!card) return;
      const assignments=this.todayAssignments();
      const pending=assignments.filter(a=>a.status==='pending'), completed=assignments.filter(a=>a.status==='completed');
      const total=pending.reduce((s,a)=>s+Math.max(0,n(a.target)-n(a.progress)),0);
      const globalTopics=this.topics(), relevant=globalTopics.filter(t=>t.relevant && !t.improving);
      const summary=q('#tec-lacunas-summary',card);
      if (summary) summary.innerHTML=`<strong>Hoje:</strong> ${pending.length} disciplina(s) · ${total} questão(ões) restantes <span>· ${completed.length} reforço(s) concluído(s) · ${relevant.length} lacuna(s) relevantes nesta lente</span>`;
      const list=q('#tec-lacunas-list',card); if (!list) return;
      if (!assignments.length) { list.innerHTML='<div class="tec-connect-empty">Nenhum erro registrado ainda nesta memória. O primeiro erro já poderá gerar uma microcorreção com o próprio histórico.</div>'; return; }
      list.innerHTML=assignments.map(a=>{
        const p=this.assignmentProgress(a), left=Math.max(0,a.target-p.progress), done=a.status==='completed' || p.done;
        return `<article class="tec-lacuna-row ${done?'done':''}"><div class="tec-lacuna-main"><div class="tec-lacuna-title"><b>${esc(a.disciplina)} · ${esc(a.assunto)}</b><span class="tec-lacuna-badge">${done?'Concluído':esc(a.reason==='persistente'?'Persistente':a.reason==='resistente'?'Resistente':a.reason==='ativa'?'Ativa':'Inicial')}</span></div><small>${esc(this.explain(a))}</small><div class="tec-lacuna-meta">${a.target} questão(ões) do seu histórico · ${p.progress}/${a.target} executadas · IDs únicos, mesmo que apareçam em Erradas e Favoritas</div></div><div class="tec-lacuna-buttons"><button type="button" class="btn-secondary" data-copy="${esc(a.id)}">Copiar IDs</button>${done?'':'<button type="button" class="btn-primary" data-extra="1">Ver em Extras</button>'}</div></article>`;
      }).join('');
      list.querySelectorAll('[data-copy]').forEach(btn=>btn.addEventListener('click',()=>{ const a=assignments.find(x=>x.id===btn.getAttribute('data-copy')); if (a) this.copyIds(a); }));
      list.querySelectorAll('[data-extra]').forEach(btn=>btn.addEventListener('click',()=>this.goExtras()));
    },

    refresh(reason='manual') {
      clearTimeout(this._refreshTimer);
      this._refreshTimer=setTimeout(()=>{
        try { this.ensureToday(reason==='plan-change'); this.render(); }
        catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-refresh'); }
      },REPROCESS_DELAY);
    },
    patchRealtime() {
      if (this._patched) return;
      const R=window.TecRealtime;
      if (!R || typeof R.ingest!=='function') return;
      const original=R.ingest.bind(R), self=this;
      R.ingest=function(...args) {
        const out=original(...args);
        try { if (out && out.ok) self.refresh('resolution'); }
        catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-ingest-hook'); }
        return out;
      };
      this._patched=true;
    },
    init() {
      this.patchRealtime();
      this._lastPlanId=this.planId();
      this.refresh('init');
      document.addEventListener('visibilitychange',()=>{ if (!document.hidden) this.refresh('visible'); });
      this._poll=setInterval(()=>{
        this.patchRealtime();
        const pid=this.planId();
        if (pid!==this._lastPlanId) { this._lastPlanId=pid; this.refresh('plan-change'); return; }
        const screen=q('#screen-integracaotec');
        if (screen && !screen.hidden) this.refresh('poll');
      },5000);
    }
  };

  window.TecLacunasContinuas=L;
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>L.init(),{once:true});
  else L.init();
})();
