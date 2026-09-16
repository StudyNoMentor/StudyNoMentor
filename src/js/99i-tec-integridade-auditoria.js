/* ============================================================================
   TEC — INTEGRIDADE DE DADOS, ASSISTENTE CONFIÁVEL E LACUNAS EXPLICÁVEIS
   ----------------------------------------------------------------------------
   Camada final deliberadamente pequena e auditável. Corrige três contratos:
   1) resposta marcada + gabarito são a fonte primária do resultado;
   2) capturas incompletas jamais apagam dados completos já persistidos;
   3) toda lacuna diária deve explicar, em números, por que foi priorizada.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecIntegridadeAuditoriaV3) return;
  window.__tecIntegridadeAuditoriaV3 = true;

  const AUDIT_KEY = 'tec-resolution-audit-v1';
  const MAX_AUDIT = 5000;
  const norm = v => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const letter = v => { const m=String(v == null ? '' : v).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/); return m ? m[1] : null; };
  const n = (v,d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = v => typeof escapeHtml === 'function' ? escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const today = () => typeof todayLocal === 'function' ? todayLocal() : (()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const addDays = (iso,delta) => { const d=new Date(`${iso}T12:00:00`); d.setDate(d.getDate()+delta); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  function mergeAlternatives(oldRows, newRows, marked, correct) {
    const map=new Map();
    const add=(a, preferNew=false)=>{
      if (!a) return;
      const l=letter(a.letra || a.label || a.alternativa); if (!l) return;
      const old=map.get(l) || { letra:l, texto:'', correta:false, marcadaPorMim:false };
      const txt=String(a.texto || a.text || a.descricao || '').trim();
      if (txt && (preferNew || !old.texto)) old.texto=txt;
      old.correta=old.correta || a.correta===true || a.correct===true || l===correct;
      old.marcadaPorMim=old.marcadaPorMim || a.marcadaPorMim===true || a.selected===true || l===marked;
      map.set(l,old);
    };
    (oldRows||[]).forEach(a=>add(a,false));
    (newRows||[]).forEach(a=>add(a,true));
    return [...map.values()].sort((a,b)=>a.letra.localeCompare(b.letra));
  }

  function canonicalQuestion(oldQ={}, incoming={}) {
    const pick=(newV,oldV)=> newV != null && String(newV).trim() !== '' ? newV : oldV;
    let marked=letter(incoming.marcada) || letter(oldQ.marcada) ||
      letter(((incoming.alternativas||[]).find(a=>a && (a.marcadaPorMim===true || a.selected===true))||{}).letra) ||
      letter(((oldQ.alternativas||[]).find(a=>a && (a.marcadaPorMim===true || a.selected===true))||{}).letra);
    let correct=letter(incoming.correta) || letter(oldQ.correta) ||
      letter(((incoming.alternativas||[]).find(a=>a && (a.correta===true || a.correct===true))||{}).letra) ||
      letter(((oldQ.alternativas||[]).find(a=>a && (a.correta===true || a.correct===true))||{}).letra);
    const integrity={ ...(oldQ.integrity||{}), ...(incoming.integrity||{}) };
    const reported = typeof incoming.acertou==='boolean' ? incoming.acertou : (typeof oldQ.acertou==='boolean' ? oldQ.acertou : null);
    const derived = marked && correct ? marked===correct : null;
    const result = typeof derived==='boolean' ? derived : reported;
    const conflict = typeof derived==='boolean' && typeof reported==='boolean' && derived!==reported;
    const q={ ...oldQ, ...incoming };
    for (const k of ['id','cadernoId','materia','assunto','banca','concurso','enunciado','url','dataResolucao','capturadoEm']) q[k]=pick(incoming[k],oldQ[k]);
    q.marcada=marked || null; q.correta=correct || null;
    if (typeof result==='boolean') q.acertou=result;
    q.alternativas=mergeAlternatives(oldQ.alternativas,incoming.alternativas,marked,correct);
    q.integrity={ ...integrity,
      status:(marked&&correct) ? 'verified' : (integrity.status || 'unverified'),
      confidence:(marked&&correct) ? 'high' : (integrity.confidence || 'low'),
      source:(marked&&correct) ? 'marked-vs-gabarito' : (integrity.source || 'legacy'),
      marked:marked||null, correct:correct||null, canonicalResult:result,
      reportedResult:reported, conflict:conflict || integrity.conflict===true,
      reconciledAt:new Date().toISOString()
    };
    return q;
  }

  function quality(q={}) {
    const fields={
      id:!!q.id, enunciado:!!String(q.enunciado||'').trim(), alternativas:Array.isArray(q.alternativas)&&q.alternativas.length>=2,
      marcada:!!letter(q.marcada), gabarito:!!letter(q.correta), resultado:typeof q.acertou==='boolean',
      materia:!!String(q.materia||'').trim(), assunto:!!String(q.assunto||'').trim()
    };
    const core=fields.id && fields.enunciado && fields.alternativas;
    const outcome=fields.marcada && fields.gabarito && fields.resultado;
    const conflict=!!(q.integrity && q.integrity.conflict);
    return { fields, core, outcome, conflict, trustworthy:core && outcome && !conflict,
      captured:Object.values(fields).filter(Boolean).length, total:Object.keys(fields).length };
  }

  function auditKey() { try { return DB._profilePrefix()+AUDIT_KEY; } catch (_) { return 'diario-estudos:'+AUDIT_KEY; } }
  function readAudit() {
    try { const raw=JSON.parse(localStorage.getItem(auditKey())||'null'); return raw&&raw.schema===1&&Array.isArray(raw.rows)?raw:{schema:1,rows:[],updatedAt:null}; }
    catch (_) { return {schema:1,rows:[],updatedAt:null}; }
  }
  function writeAudit(st) {
    st.rows=(st.rows||[]).slice(-MAX_AUDIT); st.updatedAt=new Date().toISOString();
    const raw=JSON.stringify(st);
    try { if (typeof DB!=='undefined'&&DB.setRaw) return DB.setRaw(auditKey(),raw)!==false; localStorage.setItem(auditKey(),raw); return true; }
    catch (e) { if (typeof _quiet==='function') _quiet(e,'tec-integrity-audit-save'); return false; }
  }
  function appendAudit(ev,payload) {
    if (!ev) return;
    const st=readAudit();
    const q=payload&&payload.question || {};
    const sig=String(ev.eventId||'')+'|'+String(ev.receivedAt||'');
    if (st.rows.some(x=>x.sig===sig)) return;
    const qq=canonicalQuestion(q,{ marcada:ev.marcada, correta:ev.correta, acertou:ev.acertou, integrity:ev.integrity });
    const ql=quality(qq);
    st.rows.push({ sig, eventId:ev.eventId||null, questionId:ev.questionId||null, resolvedAt:ev.resolvedAt||null,
      tecAccount:ev.tecAccount||null, bookId:ev.bookId||null, materia:ev.materia||null, assunto:ev.assunto||null,
      marcada:qq.marcada||null, correta:qq.correta||null, acertou:typeof qq.acertou==='boolean'?qq.acertou:null,
      integrity:qq.integrity||null, quality:ql, source:ev.source||null, recordedAt:new Date().toISOString() });
    writeAudit(st);
  }

  /* ── Biblioteca da Integração: merge conservador ─────────────────────── */
  const T=window.TecIntegracaoScreen;
  if (T) {
    T.dataQuality=quality;
    T.canonicalQuestion=canonicalQuestion;
    T.mergeInto=function(state,question,meta={}) {
      if (!question || (!question.id && !question.enunciado)) throw new Error('Questão sem identificação ou enunciado.');
      const account=this.text(meta.tecAccount)||'conta-importada';
      const book=this.text(meta.bookId||question.cadernoId)||'caderno-desconhecido';
      const key=this.questionKey(account,book,question.id||this.hash(question.enunciado));
      const prev=state.questions[key]||{};
      const merged=canonicalQuestion(prev.question||{},question||{});
      state.questions[key]={ ...prev, key, tecAccount:account, bookId:book,
        history:meta.history || prev.history || null, question:merged,
        receivedAt:meta.capturedAt || prev.receivedAt || new Date().toISOString(),
        lastMergedAt:new Date().toISOString() };
      state.connection={ status:'connected', account, bookId:book, lastSeenAt:new Date().toISOString() };
      return key;
    };

    const originalRun=T.runAI && T.runAI.bind(T);
    if (originalRun) T.runAI=function(section,question) {
      /* A antiga primeira execução disparava 3 viagens completas ao ChatGPT em
         série. Um clique agora significa UMA análise. As outras abas são sob
         demanda e reaproveitam a mesma questão já validada. */
      return originalRun(section==='all'?'diagnostico':section,question);
    };

    T.localPrompt=function(section='diagnostico') {
      const st=this.state(), row=st.questions&&st.questions[this.selectedKey];
      if (!row) throw new Error('Selecione uma questão.');
      const q=canonicalQuestion({},row.question||{}), kind=this.promptKindFor(section,q)||'teoria';
      const tpl=this.promptState().prompts[kind] || this.DEFAULT_PROMPTS[kind] || this.DEFAULT_PROMPTS.teoria;
      return { text:this.renderPromptTemplate(tpl,q), question:q, quality:quality(q), kind };
    };

    T.copyLocalPrompt=async function() {
      const out=this.localPrompt('diagnostico');
      try { await navigator.clipboard.writeText(out.text); if (typeof showToast==='function') showToast('Prompt completo copiado instantaneamente ✓'); }
      catch (_) { if (typeof showToast==='function') showToast('Não foi possível copiar o prompt neste navegador.'); }
      return out;
    };
  }

  /* ── Radar: reconciliação e revisão de fatos ─────────────────────────── */
  const R=window.TecRealtime;
  if (R) {
    const originalNormalize=R.normalize.bind(R);
    R.normalize=function(payload) {
      const ev=originalNormalize(payload); if (!ev) return ev;
      const raw=payload&&payload.resolution||{}, q=payload&&payload.question||{};
      const merged=canonicalQuestion(q,{ marcada:raw.marcada||ev.marcada, correta:raw.correta||ev.correta,
        acertou:typeof raw.acertou==='boolean'?raw.acertou:ev.acertou, integrity:raw.integrity||payload&&payload.integrity||q.integrity });
      ev.marcada=merged.marcada; ev.correta=merged.correta;
      if (typeof merged.acertou==='boolean') ev.acertou=merged.acertou;
      ev.integrity=merged.integrity; ev.outcomeTrusted=quality(merged).outcome && !merged.integrity.conflict;
      return ev;
    };

    R.mergeEvent=function(old,ev) {
      if (!old) return ev;
      const next={...old};
      const richer=(x)=>n(x&&x.integrity&&x.integrity.confidence==='high'?3:x&&x.integrity&&x.integrity.confidence==='medium'?2:x&&x.integrity?1:0);
      const preferNew=richer(ev)>=richer(old);
      const changed=[];
      for (const k of ['acertou','marcada','correta']) if (ev[k]!=null&&old[k]!=null&&String(ev[k])!==String(old[k])) changed.push({ field:k,from:old[k],to:ev[k] });
      for (const [k,v] of Object.entries(ev)) {
        if (v==null||v==='') continue;
        if (preferNew || next[k]==null || next[k]==='') next[k]=v;
      }
      if (changed.length) next.revisions=[...(old.revisions||[]),{ at:new Date().toISOString(),changes:changed,source:ev.source||null }].slice(-20);
      next.receivedAt=ev.receivedAt||next.receivedAt;
      return next;
    };

    R.rememberQuestion=function(payload,ev) {
      try {
        const TI=window.TecIntegracaoScreen; if (!TI||!payload||!payload.question) return;
        const q=canonicalQuestion(payload.question,{ id:ev.questionId, acertou:ev.acertou, marcada:ev.marcada, correta:ev.correta,
          integrity:ev.integrity, dataResolucao:ev.localDate, capturadoEm:ev.resolvedAt });
        TI.ingest(q,{ tecAccount:ev.tecAccount, bookId:ev.bookId, history:payload.history||null, capturedAt:ev.resolvedAt });
      } catch (e) { if (typeof _quiet==='function') _quiet(e,'tec-integrity-remember-question'); }
    };

    const originalIngest=R.ingest.bind(R);
    R.ingest=function(payload,messageId) {
      const out=originalIngest(payload,messageId);
      try { if (out&&out.ok&&out.event) appendAudit(out.event,payload); }
      catch (e) { if (typeof _quiet==='function') _quiet(e,'tec-integrity-audit'); }
      return out;
    };
  }

  /* ── Lacunas: só fatos confiáveis + explicação matemática ────────────── */
  const L=window.TecLacunasContinuas;
  if (L) {
    const originalEvents=L.events.bind(L);
    L.events=function() {
      return (originalEvents()||[]).filter(ev=>{
        if (!ev) return false;
        if (ev.integrity && ev.integrity.status==='unverified') return false;
        if (ev.integrity && ev.integrity.conflict===true) return false;
        if (ev.marcada && ev.correta) return true;
        /* Compatibilidade com histórico anterior: mantém eventos legados que
           não carregavam o novo envelope, mas nunca mantém um evento marcado
           explicitamente como duvidoso pela guarda nova. */
        return !ev.integrity && typeof ev.acertou==='boolean';
      });
    };

    L.priorityBreakdown=function(topic,st) {
      if (!topic) return null;
      const recency=Math.max(0,18-Math.min(18,n(topic.recencyDays,999)));
      const parts={
        persistencia:topic.persistent?70:0,
        questoesDistintas:n(topic.uniqueWrong)*18,
        reincidencias:n(topic.repeatErrors)*14,
        errosRecentes:n(topic.recentErrors)*8,
        favoritas:n(topic.favoriteWrong)*7,
        confirmacaoRobusta:topic.robust?8:0,
        recencia:recency,
        melhora:topic.improving?-35:0
      };
      const priority=Object.values(parts).reduce((a,b)=>a+b,0);
      let usage={count:0,last:null};
      try { usage=this.usageByDiscipline(st||this.state()).get(norm(topic.disciplina))||usage; } catch (_) {}
      const yesterday=addDays(today(),-1);
      const rotation={ usoSemanal:-n(usage.count)*9, usadaOntem:usage.last===yesterday?-24:0, persistente:topic.persistent?28:0 };
      const rotationScore=priority+Object.values(rotation).reduce((a,b)=>a+b,0);
      return { parts, priority, rotation, rotationScore, weeklyUse:n(usage.count), lastUse:usage.last||null };
    };

    L.explain=function(a) {
      const t=this.topicForAssignment(a), b=this.priorityBreakdown(t,this.state()), e=a&&a.evidence||{};
      if (!b) return 'Priorização baseada no histórico TEC disponível.';
      const why=[];
      if (e.persistent) why.push('persistência após reforço');
      if (n(e.repeatErrors)) why.push(`${n(e.repeatErrors)} reincidência(s)`);
      if (n(e.uniqueWrong)) why.push(`${n(e.uniqueWrong)} ID(s) distintos errados`);
      if (n(e.recentErrors)) why.push(`${n(e.recentErrors)} erro(s) recentes`);
      if (e.robust) why.push('confirmação do motor Robusto');
      return `Entrou com ${b.rotationScore} pts no rodízio (${b.priority} de evidência): ${why.join(' · ') || 'erro recente'}.`;
    };

    const originalEnsure=L.ensureToday.bind(L);
    L.ensureToday=function(force) {
      const rec=originalEnsure(force);
      try {
        if (!rec||!Array.isArray(rec.assignments)) return rec;
        const st=this.state();
        for (const a of rec.assignments) {
          const t=this.topicForAssignment(a); if (!t) continue;
          const b=this.priorityBreakdown(t,st); if (!b) continue;
          a.evidence={ ...(a.evidence||{}), priority:b.priority, rotationScore:b.rotationScore, scoreBreakdown:b,
            lastError:t.lastError||null, recencyDays:t.recencyDays, postErrors:t.postErrors, postCorrect:t.postCorrect,
            selectedQuestionIds:[...(a.questionIds||[])], transparentSchema:1 };
        }
        this.save(st);
      } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-transparent-evidence'); }
      return rec;
    };

    const originalRender=L.render.bind(L);
    L.render=function() {
      const out=originalRender();
      try {
        const card=document.getElementById('tec-lacunas-card'); if (!card) return out;
        let guide=card.querySelector('.tec-lacunas-how');
        if (!guide) {
          guide=document.createElement('details'); guide.className='tec-lacunas-how';
          guide.innerHTML='<summary>Como a prioridade é calculada</summary><div><b>Evidência:</b> persistência +70; cada ID distinto errado +18; reincidência +14; erro recente +8; favorita +7; confirmação Robusta +8; recência até +18; melhora consistente −35.<br><b>Rodízio:</b> uso na semana −9 por vez; usada ontem −24; persistência +28. O maior resultado por disciplina entra primeiro, respeitando até 3 disciplinas/dia.</div>';
          const summary=card.querySelector('#tec-lacunas-summary'); if (summary) summary.insertAdjacentElement('afterend',guide);
        }
        const assignments=this.todayAssignments();
        card.querySelectorAll('.tec-lacuna-row').forEach(row=>{
          if (row.querySelector('.tec-lacuna-proof')) return;
          const id=row.querySelector('[data-copy]')?.getAttribute('data-copy');
          const a=assignments.find(x=>String(x.id)===String(id)); if (!a) return;
          const t=this.topicForAssignment(a), b=this.priorityBreakdown(t,this.state());
          const proof=document.createElement('details'); proof.className='tec-lacuna-proof';
          const ids=(a.questionIds||[]).join(', ')||'—';
          const base=t?`${n(t.uniqueWrong)} ID(s) distintos · ${n(t.repeatErrors)} reincidência(s) · ${n(t.recentErrors)} erro(s) em 30 dias · último erro ${t.lastError?new Date(t.lastError).toLocaleString('pt-BR'):'—'}`:'Evidência histórica indisponível neste instante.';
          const rot=b?`Evidência ${b.priority} pts → rodízio ${b.rotationScore} pts · uso semanal ${b.weeklyUse} · último uso ${b.lastUse||'—'}`:'Pontuação não disponível.';
          const dose=t?(t.persistent||t.status==='resistente'?'6 questões por persistência/resistência':t.uniqueWrong<=1?'3 questões por microcorreção':'5 questões por lacuna ativa'):`${a.target} questões`;
          proof.innerHTML=`<summary>Por que esta lacuna entrou hoje?</summary><div class="tec-lacuna-proof-grid"><span><b>Sinal observado</b>${esc(base)}</span><span><b>Pontuação</b>${esc(rot)}</span><span><b>Dose</b>${esc(dose)}; limitada ao histórico disponível e ao teto diário.</span><span><b>Questões usadas</b>${esc(ids)}</span></div>`;
          row.querySelector('.tec-lacuna-main')?.appendChild(proof);
        });
      } catch (e) { if (typeof _quiet==='function') _quiet(e,'lacunas-transparent-render'); }
      return out;
    };
  }

  /* ── Painel de confiança junto ao Assistente ─────────────────────────── */
  let plusStatus={ status:'idle', requestId:null, at:null };
  window.addEventListener('message',e=>{
    if (e.source!==window||e.origin!==location.origin) return;
    const m=e.data;
    if (!m||m.source!=='StudyMentorCompanion'||m.type!=='plus-ai-status') return;
    plusStatus={ status:m.status||'idle', requestId:m.requestId||null, at:new Date().toISOString(), error:m.error||null };
    renderTrustPanel();
  });

  function renderTrustPanel() {
    if (!T) return;
    const card=document.querySelector('#screen-integracaotec .tec-assistant-card'); if (!card) return;
    let box=card.querySelector('#tec-assistant-trust');
    if (!box) {
      box=document.createElement('section'); box.id='tec-assistant-trust'; box.className='tec-assistant-trust';
      const header=card.querySelector('.card-header'); if (header) header.insertAdjacentElement('afterend',box); else card.prepend(box);
      box.addEventListener('click',async e=>{
        const b=e.target.closest('[data-trust-action]'); if (!b) return;
        if (b.dataset.trustAction==='copy') await T.copyLocalPrompt();
        if (b.dataset.trustAction==='audit') {
          const text=JSON.stringify(readAudit(),null,2);
          try { await navigator.clipboard.writeText(text); if (typeof showToast==='function') showToast('Auditoria de resoluções copiada ✓'); } catch (_) {}
        }
      });
    }
    const st=T.state(), row=st.questions&&st.questions[T.selectedKey], q=row&&canonicalQuestion({},row.question||{}), ql=quality(q||{});
    const labels={ queued:'Na fila', 'opening-chatgpt':'Abrindo/reutilizando ChatGPT', 'waiting-chatgpt':'Aguardando ChatGPT', running:'Analisando no ChatGPT', complete:'Concluído', failed:'Falhou', retrying:'Tentando novamente', idle:'Pronto' };
    if (!q) { box.innerHTML='<div class="tec-trust-empty">Selecione uma questão para auditar os dados que serão enviados ao assistente.</div>'; return; }
    const chips=Object.entries(ql.fields).map(([k,v])=>`<span class="${v?'ok':'miss'}">${v?'✓':'!'} ${esc(k)}</span>`).join('');
    const outcome=q.marcada&&q.correta?`Você marcou <b>${esc(q.marcada)}</b> · gabarito <b>${esc(q.correta)}</b> · <b>${q.acertou?'ACERTO':'ERRO'}</b>`:'Resposta/gabarito ainda incompletos — nenhuma conclusão é inferida silenciosamente.';
    box.innerHTML=`<div class="tec-trust-head"><div><b>${ql.trustworthy?'✓ Dados confiáveis para o assistente':'⚠ Dados incompletos ou conflitantes'}</b><small>${outcome}</small></div><span class="tec-trust-status">IA: ${esc(labels[plusStatus.status]||plusStatus.status||'Pronto')}</span></div><div class="tec-trust-chips">${chips}</div><div class="tec-trust-actions"><button type="button" class="btn-primary" data-trust-action="copy">⚡ Copiar prompt agora</button><button type="button" class="btn-secondary" data-trust-action="audit">Copiar auditoria dos dados</button></div><p>O prompt local é montado instantaneamente, sem abrir outra aba. A análise por IA é opcional e usa exatamente estes dados.</p>`;
  }

  if (T) {
    const originalRender=T.render.bind(T);
    T.render=function(){ const out=originalRender(); setTimeout(renderTrustPanel,0); return out; };
  }
  window.addEventListener('screen:activated',e=>{ if (e.detail&&e.detail.screen==='integracaotec') setTimeout(renderTrustPanel,0); });
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(renderTrustPanel,0),{once:true});
  else setTimeout(renderTrustPanel,0);

  window.TecDataIntegrity={ canonicalQuestion, quality, readAudit, appendAudit, mergeAlternatives };
})();
