/* ============================================================================
   TEC WORKBENCH + EVIDÊNCIA REAL DE REFORÇO
   ----------------------------------------------------------------------------
   1) corrige a experiência de entrada: o TEC abre automaticamente no quadro;
   2) mantém um ledger pequeno e auditável do CONTEXTO disponível junto de
      cada resolução, sem fingir reconstruir o passado quando o registro é antigo;
   3) sugere atenção/reforço por evidência híbrida:
        · erros reais recentes (janela móvel de 14 dias);
        · confirmação exata do motor Robusto quando existir;
        · histórico de Extras do mesmo tópico, inclusive recaída pós-reforço.

   Regra de segurança pedagógica: um erro isolado, sem confirmação do Plano,
   NÃO cria reforço. Sugestão e criação automática continuam separadas.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecWorkbenchReforcoReal) return;
  window.__tecWorkbenchReforcoReal = true;

  const KEY = 'tec-real-evidence-v1';
  const SCHEMA = 1;
  const WINDOW_DAYS = 14;
  const CONTEXT_FRESH_MS = 10 * 60 * 1000;
  const norm = v => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const n = (v,d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const today = () => typeof todayLocal === 'function' ? todayLocal() : (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const addDays = (iso,delta) => { const d=new Date(`${iso}T12:00:00`); d.setDate(d.getDate()+delta); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const esc = v => typeof escapeHtml === 'function' ? escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const E = {
    _key() { try { return DB._profilePrefix() + KEY; } catch (_) { return 'diario-estudos:' + KEY; } },
    blank() { return { schema:SCHEMA, records:{}, updatedAt:null }; },
    state() {
      try {
        const raw=JSON.parse(localStorage.getItem(this._key()) || 'null');
        return raw && raw.schema===SCHEMA && raw.records && typeof raw.records==='object' ? raw : this.blank();
      } catch (_) { return this.blank(); }
    },
    save(st) {
      st.updatedAt=new Date().toISOString();
      try {
        const raw=JSON.stringify(st);
        if (typeof DB!=='undefined' && DB.setRaw) return DB.setRaw(this._key(),raw)!==false;
        localStorage.setItem(this._key(),raw); return true;
      } catch (e) { if (typeof _quiet==='function') _quiet(e,'tec-real-evidence-save'); return false; }
    },
    topicKey(disc,topic) { return `${norm(disc)}¦${norm(topic)}`; },
    events() {
      try {
        const st=window.TecRealtime && TecRealtime.state ? TecRealtime.state() : null;
        return st && st.events ? Object.values(st.events) : [];
      } catch (_) { return []; }
    },
    extras() {
      try { return typeof DB!=='undefined' && DB.getExtras ? (DB.getExtras() || []) : []; }
      catch (_) { return []; }
    },
    extraTopic(e) {
      const o=e && e.origemPlano || {};
      return { disciplina:String(e && e.disciplina || o.disciplina || ''), topico:String(o.topico || e && e.titulo || '') };
    },
    matchingExtras(disc,topic) {
      const k=this.topicKey(disc,topic);
      return this.extras().filter(e => { const t=this.extraTopic(e); return this.topicKey(t.disciplina,t.topico)===k; });
    },
    cycleDate(e) {
      const o=e && e.origemPlano || {}, v=o.veredito || {}, h=Array.isArray(e && e.historico) ? e.historico : [];
      const hd=h.map(x=>String(x && x.data || '')).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
      const raw=v.em || v.data || hd[hd.length-1] || e && (e.updatedAt || e.createdAt) || null;
      if (!raw) return null;
      const m=String(raw).match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null;
    },
    cycleSnapshot(e) {
      const o=e && e.origemPlano || {}, s=o.sugestao || {}, h=Array.isArray(e && e.historico) ? e.historico : [];
      const updated=e && e.updatedAt || null;
      return {
        id:String(e && e.id || ''),
        status:String(e && e.status || ''),
        criadoEm:e && e.createdAt || null,
        atualizadoEm:updated,
        referenciaEm:this.cycleDate(e),
        concluidoEmPreciso:e && e.status==='concluida' && updated && /T/.test(String(updated)) ? String(updated) : null,
        alvo:n(e && e.alvo),
        progresso:n(e && e.progresso),
        executado:h.reduce((sum,x)=>sum+Math.max(0,n(x && x.quantidade)),0),
        origemMotor:s.motor || s.modoInterface || null,
        veredito:o.veredito && o.veredito.tipo || null
      };
    },
    planSnapshot(ev) {
      try {
        const R=window.TecRealtime;
        const ctx=R && R.motorContext ? R.motorContext() : null;
        if (!ctx) return { mapped:false, robustConfirmed:false };
        const k=ctx.key(ev.materia || '',ev.assunto || '');
        const robust=ctx.robustMap && ctx.robustMap.get(k), tec=ctx.tecMap && ctx.tecMap.get(k);
        return {
          mapped:!!tec || !!robust,
          robustConfirmed:!!robust,
          scoreTopico:robust && Number.isFinite(Number(robust.scoreTopico)) ? Number(robust.scoreTopico) : null,
          qJanela:robust && Number.isFinite(Number(robust.qJanela)) ? Number(robust.qJanela) : null,
          meta:robust && Number.isFinite(Number(robust.meta)) ? Number(robust.meta) : null,
          fonte:robust && (robust.fonteMotor || robust.motor || robust.fonte) || null
        };
      } catch (_) { return { mapped:false, robustConfirmed:false }; }
    },
    reinforcementSnapshot(cycles) {
      return {
        activeIds:cycles.filter(x=>x.status!=='concluida').map(x=>x.id),
        completedIds:cycles.filter(x=>x.status==='concluida').map(x=>x.id),
        latestCompletedAt:cycles.filter(x=>x.status==='concluida'&&x.referenciaEm).map(x=>x.referenciaEm).sort().pop() || null
      };
    },
    snapshot(ev) {
      const observedAt=new Date().toISOString();
      const resolvedMs=new Date(ev.resolvedAt || '').getTime();
      const fresh=Number.isFinite(resolvedMs) && Math.abs(Date.now()-resolvedMs)<=CONTEXT_FRESH_MS;
      const cycles=this.matchingExtras(ev.materia,ev.assunto).map(e=>this.cycleSnapshot(e));
      const plan=this.planSnapshot(ev), reinforcement=this.reinforcementSnapshot(cycles);
      return {
        eventId:String(ev.eventId || ''), questionId:String(ev.questionId || ''), resolvedAt:ev.resolvedAt || null, localDate:ev.localDate || null,
        materia:ev.materia || '', assunto:ev.assunto || '', acertou:ev.acertou === true,
        tecAccount:ev.tecAccount || null, bookId:ev.bookId || null,
        contextObservedAt:observedAt,
        contextTemporalAccuracy:fresh ? 'near-resolution' : 'backfilled-current-state',
        planAtResolution:fresh ? plan : null,
        reinforcementAtResolution:fresh ? reinforcement : null,
        planAtLedgerCapture:fresh ? null : plan,
        reinforcementAtLedgerCapture:fresh ? null : reinforcement
      };
    },
    syncLedger() {
      const st=this.state(); let changed=false;
      for (const ev of this.events()) {
        if (!ev || !ev.eventId || st.records[String(ev.eventId)]) continue;
        st.records[String(ev.eventId)]=this.snapshot(ev); changed=true;
      }
      if (changed) this.save(st);
      return st;
    },
    eventAfterCycle(ev,cycle) {
      if (!ev || !cycle) return false;
      const rt=new Date(ev.resolvedAt || '').getTime(), ct=new Date(cycle.concluidoEmPreciso || '').getTime();
      if (Number.isFinite(rt) && Number.isFinite(ct)) return rt > ct;
      // Sem horário preciso, não chamamos um erro do MESMO dia de posterior:
      // é melhor perder um sinal por algumas horas do que fabricar uma recaída.
      return !!(ev.localDate && cycle.referenciaEm && String(ev.localDate) > String(cycle.referenciaEm));
    },
    groups() {
      const from=addDays(today(),-(WINDOW_DAYS-1));
      const rows=this.events().filter(e=>e && e.localDate>=from && e.localDate<=today());
      const map=new Map();
      for (const ev of rows) {
        const disc=String(ev.materia || 'Matéria não identificada'), topic=String(ev.assunto || 'Assunto não identificado');
        const k=this.topicKey(disc,topic);
        if (!map.has(k)) map.set(k,{ key:k,disciplina:disc,assunto:topic,attempts:0,errors:0,correct:0,wrongIds:new Set(),lastError:null,events:[] });
        const g=map.get(k); g.attempts++; g.events.push(ev);
        if (ev.acertou===false) { g.errors++; g.wrongIds.add(String(ev.questionId || '')); if (!g.lastError || String(ev.resolvedAt)>String(g.lastError)) g.lastError=ev.resolvedAt; }
        else if (ev.acertou===true) g.correct++;
      }
      const R=window.TecRealtime, ctx=R && R.motorContext ? R.motorContext() : null;
      return [...map.values()].map(g=>{
        const k=ctx ? ctx.key(g.disciplina,g.assunto) : null;
        const robust=!!(ctx && ctx.robustMap && ctx.robustMap.get(k));
        const cycles=this.matchingExtras(g.disciplina,g.assunto).map(e=>this.cycleSnapshot(e));
        const active=cycles.filter(x=>x.status!=='concluida');
        const completed=cycles.filter(x=>x.status==='concluida'&&x.referenciaEm).sort((a,b)=>String(a.referenciaEm).localeCompare(String(b.referenciaEm)));
        const lastCompleted=completed.length ? completed[completed.length-1] : null;
        const errorsAfter=lastCompleted ? g.events.filter(e=>e.acertou===false && this.eventAfterCycle(e,lastCompleted)).length : 0;
        const rate=g.attempts ? g.errors/g.attempts : 0;
        let kind='';
        if (active.length) kind='active';
        else if (lastCompleted && errorsAfter>=2) kind='relapse';
        else if (robust && g.errors>=1) kind='confirmed';
        else if (g.errors>=2) kind='watch';
        const score=(kind==='relapse'?100:kind==='confirmed'?80:kind==='watch'?55:kind==='active'?40:0) + g.errors*3 + Math.round(rate*10);
        return { ...g, uniqueWrong:g.wrongIds.size, errorRate:rate, robust, cycles, active, lastCompleted, errorsAfter, kind, score };
      }).filter(g=>g.errors>0 && g.kind).sort((a,b)=>b.score-a.score || String(b.lastError).localeCompare(String(a.lastError)));
    },
    exportPayload() {
      const ledger=this.syncLedger();
      return { type:'StudyNoMentorTecRealEvidence', schema:1, generatedAt:new Date().toISOString(), windowDays:WINDOW_DAYS,
        records:Object.values(ledger.records || {}), suggestions:this.groups().map(g=>({ disciplina:g.disciplina, assunto:g.assunto, attempts:g.attempts, errors:g.errors, uniqueWrong:g.uniqueWrong, errorRate:g.errorRate, robust:g.robust, kind:g.kind, errorsAfter:g.errorsAfter, lastError:g.lastError })) };
    },
    async copyEvidence() {
      try {
        await navigator.clipboard.writeText(JSON.stringify(this.exportPayload(),null,2));
        if (typeof showToast==='function') showToast('Evidências TEC copiadas ✓');
      } catch (_) { if (typeof showToast==='function') showToast('Não foi possível copiar as evidências.'); }
    },
    ensureCard() {
      const screen=document.getElementById('screen-integracaotec'); if (!screen) return null;
      let card=document.getElementById('tec-real-evidence-card'); if (card) return card;
      card=document.createElement('section'); card.id='tec-real-evidence-card'; card.className='card';
      card.innerHTML=`<div class="card-header tec-real-head"><div><h2>🎯 Evidência real para reforço</h2><p class="sub">Cruza erros recentes com o Plano e com reforços já executados. Erro isolado sem confirmação não gera tarefa.</p></div><div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><span class="tec-real-window">últimos ${WINDOW_DAYS} dias</span><button type="button" class="btn-secondary" id="tec-real-copy">Copiar evidências</button></div></div><p class="tec-real-summary" id="tec-real-summary"></p><div class="tec-real-list" id="tec-real-list"></div>`;
      const assistant=screen.querySelector('.tec-assistant-card');
      if (assistant && assistant.parentElement) assistant.insertAdjacentElement('afterend',card); else screen.appendChild(card);
      card.querySelector('#tec-real-copy')?.addEventListener('click',()=>this.copyEvidence());
      return card;
    },
    render() {
      this.syncLedger();
      const card=this.ensureCard(); if (!card) return;
      const groups=this.groups(), actionable=groups.filter(g=>g.kind==='relapse'||g.kind==='confirmed').length, watching=groups.filter(g=>g.kind==='watch').length, active=groups.filter(g=>g.kind==='active').length;
      const summary=card.querySelector('#tec-real-summary');
      if (summary) summary.textContent=`${actionable} tópico(s) com evidência para ação · ${active} já em reforço · ${watching} em observação. Recaída pós-reforço recebe prioridade; um erro único não confirmado é apenas registrado.`;
      const list=card.querySelector('#tec-real-list'); if (!list) return;
      if (!groups.length) { list.innerHTML='<div class="tec-connect-empty">Ainda não há padrão recente suficiente para sugerir reforço.</div>'; return; }
      list.innerHTML=groups.slice(0,10).map(g=>{
        const labels={ relapse:['Recaída pós-reforço','relapse'], confirmed:['Erro real + Plano','confirmed'], active:['Já em reforço','active'], watch:['Recorrência a observar','watch'] };
        const [label,cls]=labels[g.kind] || ['Observação','watch'];
        const pct=Math.round(g.errorRate*100);
        const post=g.kind==='relapse' ? ` · ${g.errorsAfter} erro(s) depois do último reforço` : '';
        return `<div class="tec-real-row"><div class="tec-real-main"><b>${esc(g.disciplina)} · ${esc(g.assunto)}</b><small>${g.attempts} resolução(ões) · ${g.errors} erro(s) · ${pct}% de erro${post}${g.lastError?` · último ${esc(String(g.lastError).slice(0,10))}`:''}</small></div><span class="tec-real-badge ${cls}">${label}</span></div>`;
      }).join('');
    },
    polishWorkbench() {
      const T=window.TecIntegracaoScreen, screen=document.getElementById('screen-integracaotec'); if (!T || !screen) return;
      const workspace=screen.querySelector('.tec-workspace-card');
      const h=workspace && workspace.querySelector('.card-header h2'); if (h) h.textContent='Resolver no TEC';
      const sub=workspace && workspace.querySelector('.card-header .sub'); if (sub) sub.textContent='Seu caderno fica aqui; captura, histórico e IA trabalham ao redor sem reduzir a área de resolução.';
      const placeholder=document.getElementById('tec-workspace-placeholder');
      if (placeholder) { const strong=placeholder.querySelector('strong'), span=placeholder.querySelector('span'); if (strong) strong.textContent='Carregando TEC…'; if (span) span.textContent='Se não abrir, use Recarregar no cabeçalho.'; }
      T.openEmbedded();
      const frame=document.getElementById('tec-workspace-frame');
      if (frame && !frame.hidden && placeholder) placeholder.hidden=true;
      this.render();
    },
    schedule() { setTimeout(()=>this.polishWorkbench(),0); setTimeout(()=>this.render(),350); }
  };

  window.TecRealEvidence=E;
  window.addEventListener('screen:activated',ev=>{ if (ev.detail && ev.detail.screen==='integracaotec') E.schedule(); });
  window.addEventListener('message',ev=>{
    const m=ev && ev.data;
    if (ev.source!==window || ev.origin!==location.origin || !m || typeof m!=='object') return;
    if (m.source==='StudyMentorCompanion' && Number(m.protocol)===1 && m.type==='resolution') setTimeout(()=>E.render(),250);
  });
  const start=()=>{
    if (document.getElementById('screen-integracaotec')?.classList.contains('active')) E.schedule();
    else E.syncLedger();
  };
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
