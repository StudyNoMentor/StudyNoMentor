/* ============================================================================
   TEC REALTIME + STUDYNOMENTOR COMPANION
   ----------------------------------------------------------------------------
   Contrato:
     · Companion captura fatos no TEC e os entrega com ACK durável;
     · este módulo mantém histórico append-only de RESOLUÇÕES por perfil;
     · a biblioteca da Integração TEC continua guardando a questão completa;
     · o Radar diário agrega erros sem apagar tentativas anteriores;
     · "Atacar erros" só cria reforço quando há correspondência EXATA com uma
       fraqueza confirmada pelo motor Robusto. Sem correspondência, não chuta.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecCompanionRealtime) return;
  window.__tecCompanionRealtime = true;

  const APP_SOURCE = 'StudyNoMentorApp';
  const EXT_SOURCE = 'StudyMentorCompanion';
  const TEC_SOURCE = 'StudyMentorTEC';
  const KEY = 'tec-realtime:eventos-v1';
  const SCHEMA = 1;
  const DUP_WINDOW_MS = 5000;

  const norm = (v) => {
    try { return typeof ReforcoEngine !== 'undefined' && ReforcoEngine.norm ? ReforcoEngine.norm(v || '') : String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
    catch (_) { return String(v || '').trim().toLowerCase(); }
  };
  const esc = (v) => typeof escapeHtml === 'function' ? escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const today = () => typeof todayLocal === 'function' ? todayLocal() : (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
  const addDays = (iso, delta) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + delta); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  const R = {
    mode: 'day',
    selectedDay: null,
    _messageBound: false,
    _uiBound: false,
    _queuePatched: false,
    _observer: null,

    _key() { try { return DB._profilePrefix() + KEY; } catch (_) { return 'diario-estudos:' + KEY; } },
    blank() { return { schema: SCHEMA, events: {}, connection: {}, lastEventAt: null, updatedAt: null }; },
    state() {
      try {
        const raw = JSON.parse(localStorage.getItem(this._key()) || 'null');
        return raw && raw.schema === SCHEMA && raw.events && typeof raw.events === 'object' ? raw : this.blank();
      } catch (_) { return this.blank(); }
    },
    save(state) {
      state.updatedAt = new Date().toISOString();
      const raw = JSON.stringify(state);
      try {
        if (typeof DB !== 'undefined' && DB.setRaw) return DB.setRaw(this._key(), raw) !== false;
        localStorage.setItem(this._key(), raw); return true;
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-realtime-save'); return false; }
    },
    hash(value) { let h=2166136261; for (const c of String(value||'')) { h^=c.charCodeAt(0); h=Math.imul(h,16777619); } return (h>>>0).toString(36); },
    localDate(ev) {
      if (ev && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.localDate || ''))) return String(ev.localDate);
      const br = String(ev && ev.dataResolucao || '');
      const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      const d = new Date(ev && ev.resolvedAt || Date.now());
      return Number.isNaN(d.getTime()) ? today() : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },
    eventId(ev) {
      if (ev && ev.eventId) return String(ev.eventId);
      const seed = [ev && ev.tecAccount, ev && ev.bookId, ev && ev.questionId, ev && ev.resolvedAt, ev && ev.acertou, ev && ev.marcada, ev && ev.correta].join('|');
      return 'legacy_' + this.hash(seed);
    },
    normalize(payload) {
      const raw = payload && payload.resolution || {};
      const q = payload && payload.question || {};
      const questionId = String(raw.questionId || q.id || '').trim();
      if (!questionId || typeof raw.acertou !== 'boolean' && typeof q.acertou !== 'boolean') return null;
      const resolvedAt = String(raw.resolvedAt || payload.capturedAt || q.capturadoEm || new Date().toISOString());
      const ev = {
        eventId: raw.eventId || null,
        questionId,
        tecAccount: String(raw.tecAccount || payload.tecAccount || 'conta-nao-identificada'),
        bookId: String(raw.bookId || payload.bookId || q.cadernoId || ''),
        resolvedAt,
        localDate: raw.localDate || null,
        timezoneOffsetMinutes: raw.timezoneOffsetMinutes == null ? null : n(raw.timezoneOffsetMinutes),
        acertou: typeof raw.acertou === 'boolean' ? raw.acertou : !!q.acertou,
        marcada: raw.marcada || q.marcada || null,
        correta: raw.correta || q.correta || null,
        materia: String(raw.materia || q.materia || ''),
        assunto: String(raw.assunto || q.assunto || ''),
        banca: String(raw.banca || q.banca || ''),
        concurso: String(raw.concurso || q.concurso || ''),
        source: String(raw.source || payload.transport || 'bridge'),
        receivedAt: new Date().toISOString()
      };
      ev.localDate = this.localDate(ev);
      ev.eventId = this.eventId(ev);
      return ev;
    },
    signature(ev) { return [norm(ev.tecAccount), ev.bookId, ev.questionId, ev.acertou ? '1':'0', ev.marcada || '', ev.correta || ''].join('|'); },
    recentDuplicate(state, ev) {
      const sig = this.signature(ev), t = new Date(ev.resolvedAt).getTime();
      if (!Number.isFinite(t)) return null;
      for (const old of Object.values(state.events || {})) {
        const ot = new Date(old.resolvedAt).getTime();
        if (!Number.isFinite(ot) || Math.abs(t - ot) > DUP_WINDOW_MS) continue;
        if (this.signature(old) === sig) return old;
      }
      return null;
    },
    mergeEvent(old, ev) {
      if (!old) return ev;
      const next = { ...old };
      for (const [k, v] of Object.entries(ev)) {
        if ((next[k] == null || next[k] === '') && v != null && v !== '') next[k] = v;
      }
      next.receivedAt = ev.receivedAt || next.receivedAt;
      return next;
    },
    rememberQuestion(payload, ev) {
      try {
        const T = window.TecIntegracaoScreen;
        if (!T || !payload || !payload.question) return;
        const q = { ...payload.question, id: ev.questionId, acertou: ev.acertou, dataResolucao: ev.localDate, capturadoEm: ev.resolvedAt };
        T.ingest(q, { tecAccount: ev.tecAccount, bookId: ev.bookId, history: payload.history || null, capturedAt: ev.resolvedAt });
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-realtime-question'); }
    },
    ingest(payload, messageId) {
      const ev = this.normalize(payload); if (!ev) return { ok:false, reason:'invalid' };
      const state = this.state();
      const exact = state.events[ev.eventId];
      if (exact) {
        state.events[ev.eventId] = this.mergeEvent(exact, ev);
      } else {
        const dup = this.recentDuplicate(state, ev);
        if (dup) state.events[dup.eventId] = this.mergeEvent(dup, ev);
        else state.events[ev.eventId] = ev;
      }
      state.lastEventAt = ev.receivedAt;
      state.connection = { ...(state.connection || {}), status:'connected', account:ev.tecAccount, bookId:ev.bookId, lastSeenAt:new Date().toISOString() };
      if (!this.save(state)) return { ok:false, reason:'save' };
      this.rememberQuestion(payload, ev);
      this.ack(messageId || ev.eventId);
      this.render();
      return { ok:true, event:ev };
    },
    ack(messageId) {
      if (!messageId) return;
      try { window.postMessage({ source:APP_SOURCE, type:'ack', messageId:String(messageId) }, location.origin); } catch (_) {}
    },
    setConnected(payload, transport) {
      const state = this.state();
      state.connection = {
        ...(state.connection || {}), status:'connected', transport:transport || state.connection.transport || 'companion',
        account:payload && (payload.tecAccount || payload.account) || state.connection.account || null,
        bookId:payload && payload.bookId || state.connection.bookId || null,
        extensionVersion:payload && payload.version || state.connection.extensionVersion || null,
        lastSeenAt:new Date().toISOString()
      };
      this.save(state);
      try {
        const T = window.TecIntegracaoScreen;
        if (T) { const s=T.state(); s.connection={ status:'connected', account:state.connection.account, bookId:state.connection.bookId, transport:state.connection.transport, lastSeenAt:state.connection.lastSeenAt }; T.save(s); }
      } catch (_) {}
      this.render();
    },
    accepted(event) {
      const m = event && event.data;
      if (!m || typeof m !== 'object') return false;
      if (m.source === EXT_SOURCE && Number(m.protocol) === 1) return event.source === window && event.origin === location.origin;
      if (m.source === TEC_SOURCE && Number(m.version) >= 21) {
        if (event.source === window && event.origin === location.origin) return true;
        const frame = document.getElementById('tec-workspace-frame');
        return !!(frame && event.source === frame.contentWindow && event.origin === 'https://www.tecconcursos.com.br');
      }
      return false;
    },
    onMessage(event) {
      if (!this.accepted(event)) return;
      const m = event.data;
      if (m.type === 'companion-ready') { this.setConnected(m.payload || {}, 'extension'); return; }
      if (m.type === 'ready' || m.type === 'status') { this.setConnected(m.payload || {}, m.source === EXT_SOURCE ? 'extension' : (m.transport || 'userscript')); return; }
      if (m.type === 'resolution') { this.ingest(m.payload || {}, m.messageId); return; }
      if (m.type === 'question' && m.payload && m.payload.question) {
        const q = m.payload.question;
        if (typeof q.acertou === 'boolean') this.ingest({ ...m.payload, resolution: m.payload.resolution || {
          eventId: String(m.messageId || '').replace(/^q_/, '') || null, questionId:q.id, acertou:q.acertou,
          resolvedAt:q.capturadoEm || m.payload.capturedAt, localDate:q.dataResolucao, tecAccount:m.payload.tecAccount, bookId:m.payload.bookId,
          marcada:q.marcada, correta:q.correta, materia:q.materia, assunto:q.assunto, banca:q.banca, concurso:q.concurso, source:'question-compat'
        } }, m.messageId);
        else this.rememberQuestion(m.payload, { questionId:q.id, acertou:q.acertou, localDate:today(), resolvedAt:new Date().toISOString(), tecAccount:m.payload.tecAccount, bookId:m.payload.bookId });
      }
    },

    range() {
      const day = this.selectedDay || today();
      return this.mode === '7d' ? { from:addDays(day,-6), to:day, label:'Últimos 7 dias' } : { from:day, to:day, label:day === today() ? 'Hoje' : day };
    },
    rows(range) {
      const r = range || this.range();
      return Object.values(this.state().events || {}).filter(e => e.localDate >= r.from && e.localDate <= r.to)
        .sort((a,b) => String(a.resolvedAt).localeCompare(String(b.resolvedAt)));
    },
    motorContext() {
      let robust = null, all = [], tecRows = [];
      try { if (window.PlanoSugestoesRobusto && PlanoSugestoesRobusto.calcular) robust = PlanoSugestoesRobusto.calcular(); } catch (_) {}
      if (robust && !robust.erro && Array.isArray(robust.todos)) all = robust.todos;
      try {
        const I = window.PlanoSugestoesInfra;
        const snap = I && I.snapshot ? I.snapshot() : null;
        if (I && I.linhasTec && snap) tecRows = I.linhasTec(snap) || [];
      } catch (_) {}
      const key = (d,t) => norm(d) + '\u0001' + norm(t);
      return {
        robust,
        robustMap:new Map(all.map(x => [key(x.disciplina,x.nome), x])),
        tecMap:new Map(tecRows.filter(x => x && x.nome).map(x => [key(x.disciplina,x.nome), x])), key
      };
    },
    groups(rows) {
      const ctx = this.motorContext();
      const map = new Map();
      for (const e of rows || []) {
        if (e.acertou !== false) continue;
        const disc = e.materia || 'Matéria não identificada', topic = e.assunto || 'Assunto não identificado';
        const k = ctx.key(disc, topic);
        if (!map.has(k)) map.set(k, { key:k, disciplina:disc, assunto:topic, errors:0, ids:new Set(), attempts:new Map(), robust:ctx.robustMap.get(k)||null, tec:ctx.tecMap.get(k)||null });
        const g = map.get(k); g.errors++; g.ids.add(String(e.questionId)); g.attempts.set(String(e.questionId), (g.attempts.get(String(e.questionId))||0)+1);
      }
      return [...map.values()].map(g => ({ ...g, uniqueIds:g.ids.size, recurrent:[...g.attempts.values()].filter(v=>v>1).length }))
        .sort((a,b) => (b.robust?1:0)-(a.robust?1:0) || b.uniqueIds-a.uniqueIds || b.errors-a.errors || n(b.robust&&b.robust.scoreTopico)-n(a.robust&&a.robust.scoreTopico) || a.assunto.localeCompare(b.assunto,'pt-BR'));
    },
    summary(rows) {
      const ids = new Set(), wrongIds = new Set(), disciplines = new Set(), topics = new Set(), last = new Map();
      let errors=0;
      for (const e of rows) {
        ids.add(String(e.questionId)); if (e.materia) disciplines.add(norm(e.materia)); if (e.assunto) topics.add(norm(e.materia)+'|'+norm(e.assunto));
        if (!e.acertou) { errors++; wrongIds.add(String(e.questionId)); }
        last.set(String(e.questionId), e);
      }
      let corrected=0; wrongIds.forEach(id => { if (last.get(id)?.acertou === true) corrected++; });
      return { attempts:rows.length, errors, uniqueQuestions:ids.size, uniqueWrong:wrongIds.size, disciplines:disciplines.size, topics:topics.size, corrected };
    },
    dose(candidate) {
      const direct = Number(candidate && candidate.quantidadeRecomendada || candidate && candidate.alvo);
      if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
      try {
        const p = PlanoSugestoesRobusto.prefs();
        const RX = window.ReforcoTecExtras;
        if (RX && RX.prescrever && candidate) {
          const out = RX.prescrever({ ...candidate, minAmostra:p.minAmostra, meta:p.meta,
            componentes:{ lacuna:candidate._gap, evidencia:candidate._evid, persistencia:candidate._persist } }, p);
          if (out && Number(out.dose) > 0) return Math.round(Number(out.dose));
        }
      } catch (_) {}
      return 15;
    },
    attack() {
      const rows = this.rows(), groups = this.groups(rows).filter(g => g.robust);
      if (!groups.length) {
        if (typeof showToast === 'function') showToast('Nenhuma fraqueza confirmada pelo motor Robusto entre os erros deste período. Nada foi criado artificialmente.');
        return { created:0, skipped:0, reason:'no-confirmed' };
      }
      const bestByDisc = new Map();
      for (const g of groups) {
        const d = norm(g.disciplina); if (!bestByDisc.has(d)) bestByDisc.set(d,g);
      }
      const chosen = [...bestByDisc.values()].sort((a,b) => b.uniqueIds-a.uniqueIds || b.errors-a.errors || n(b.robust.scoreTopico)-n(a.robust.scoreTopico)).slice(0,3);
      let created=0, skipped=0;
      for (const g of chosen) {
        const open = (DB.getExtras()||[]).some(e => e && e.status !== 'concluida' && e.origemPlano && norm(e.origemPlano.disciplina)===norm(g.disciplina) && norm(e.origemPlano.topico)===norm(g.assunto));
        if (open) { skipped++; continue; }
        const dose = this.dose(g.robust);
        const extra = DB.addExtra({ titulo:`Reforçar: ${g.assunto}`, tipo:'questoes', disciplina:g.disciplina, unidade:'questoes', alvo:dose, periodo:'unica', marcador:`Sinal TEC em tempo real: ${g.uniqueIds} ID(s) errados, ${g.errors} erro(s) no período ${this.range().from}${this.range().from!==this.range().to?' a '+this.range().to:''}.` });
        if (!extra) { skipped++; continue; }
        let origem = null;
        try { origem = PlanoCiclo.origem(g.assunto, g.disciplina, { ...g.robust, custoQ:dose }, { motivo:'reforco' }); } catch (_) {
          origem = { topico:g.assunto, disciplina:g.disciplina, motivo:'reforco', criadoEm:today(), taxaInicial:g.robust.taxa ?? null, custoEstimado:dose };
        }
        origem.sinalTempoReal = { versao:1, intervalo:this.range(), ids:[...g.ids], erros:g.errors, idsUnicos:g.uniqueIds, criadoEm:new Date().toISOString(), fonte:'companion' };
        DB.updateExtra(extra.id, { origemPlano:origem });
        created++;
      }
      try { if (typeof ReforcoFila !== 'undefined' && ReforcoFila.sincronizar) ReforcoFila.sincronizar(); } catch (_) {}
      try { if (typeof ExtrasScreen !== 'undefined' && ExtrasScreen.render) ExtrasScreen.render(); } catch (_) {}
      if (typeof showToast === 'function') showToast(created ? `Força-tarefa criada: ${created} reforço(s) a partir de fraquezas confirmadas ✓${skipped?' · '+skipped+' já estava(m) em curso':''}` : 'Os reforços correspondentes já estavam em curso.');
      return { created, skipped, chosen };
    },
    exportJSON() {
      const range=this.range(), rows=this.rows(range), summary=this.summary(rows), groups=this.groups(rows).map(g=>({ disciplina:g.disciplina, assunto:g.assunto, erros:g.errors, ids:[...g.ids], recorrentes:g.recurrent, fraquezaConfirmada:!!g.robust, mapeadoNoTEC:!!g.tec }));
      const data={ type:'StudyNoMentorTecRealtimeExport', schema:1, exportedAt:new Date().toISOString(), range, summary, groups, resolutions:rows };
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download=`studynomentor-tec-${range.from}${range.to!==range.from?'-'+range.to:''}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    },
    async copyWrongIds() {
      const ids=[...new Set(this.rows().filter(e=>e.acertou===false).map(e=>String(e.questionId)))];
      try { await navigator.clipboard.writeText(ids.join('\n')); if (typeof showToast==='function') showToast(`${ids.length} ID(s) errados copiados ✓`); }
      catch (_) { if (typeof showToast==='function') showToast('Não foi possível copiar os IDs neste navegador.'); }
    },

    ensureStyle() {
      if (document.getElementById('tec-realtime-style')) return;
      const s=document.createElement('style'); s.id='tec-realtime-style'; s.textContent=`
        .trt-card{margin-top:16px}.trt-head{display:flex;gap:14px;justify-content:space-between;align-items:flex-start}.trt-status{display:inline-flex;gap:7px;align-items:center;font-size:12px;font-weight:700}.trt-dot{width:9px;height:9px;border-radius:50%;background:#9ca3af}.trt-dot.on{background:#16a34a}.trt-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:0 28px 16px}.trt-toolbar input{max-width:155px}.trt-kpis{display:grid;grid-template-columns:repeat(6,minmax(90px,1fr));gap:9px;padding:0 28px 16px}.trt-kpi{border:1px solid var(--border,#e5e7eb);border-radius:12px;padding:10px}.trt-kpi b{display:block;font-size:20px}.trt-kpi small{opacity:.7}.trt-list{padding:0 28px 22px}.trt-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:11px 0;border-top:1px solid var(--border,#e5e7eb)}.trt-row:first-child{border-top:0}.trt-row b{display:block}.trt-row small{display:block;opacity:.72;margin-top:3px}.trt-badge{font-size:11px;font-weight:800;border-radius:999px;padding:5px 8px;white-space:nowrap}.trt-badge.confirmed{background:#dcfce7;color:#166534}.trt-badge.mapped{background:#fef3c7;color:#92400e}.trt-badge.unmapped{background:#fee2e2;color:#991b1b}.trt-empty{padding:8px 0 4px;opacity:.7}.trt-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 28px 20px}.trt-note{padding:0 28px 16px;font-size:12px;opacity:.72}
        @media(max-width:720px){.trt-head{display:block}.trt-kpis{grid-template-columns:repeat(2,1fr)}.trt-toolbar,.trt-kpis,.trt-list,.trt-actions,.trt-note{padding-left:16px;padding-right:16px}.trt-card .card-header{padding-left:16px;padding-right:16px}}
      `; document.head.appendChild(s);
    },
    ensureUI() {
      const screen=document.getElementById('screen-integracaotec'); if (!screen) return null;
      this.ensureStyle();
      let card=document.getElementById('tec-realtime-card'); if (card) return card;
      card=document.createElement('section'); card.id='tec-realtime-card'; card.className='card trt-card';
      card.innerHTML=`<div class="card-header trt-head"><div><h2>⚡ Radar TEC em tempo real</h2><p class="sub">Cada resolução vira um evento histórico. Erros são agrupados por assunto e só viram reforço automático quando o motor confirma a fraqueza.</p></div><span class="trt-status"><i class="trt-dot" id="trt-dot"></i><span id="trt-status">Companion não detectado</span></span></div><div class="trt-toolbar"><button type="button" class="btn-secondary" id="trt-today">Hoje</button><button type="button" class="btn-secondary" id="trt-7d">7 dias</button><input type="date" id="trt-date"><span id="trt-range-label"></span></div><div class="trt-kpis" id="trt-kpis"></div><div class="trt-note" id="trt-note"></div><div class="trt-list" id="trt-list"></div><div class="trt-actions"><button type="button" class="btn-primary" id="trt-attack">🎯 Atacar erros deste período</button><button type="button" class="btn-secondary" id="trt-copy">Copiar IDs errados</button><button type="button" class="btn-secondary" id="trt-export">Exportar JSON</button></div>`;
      const anchor=document.getElementById('tec-connect-status')?.closest('.card') || screen.querySelector('.tec-connect-data-card') || screen.firstElementChild;
      if (anchor && anchor.parentElement) anchor.insertAdjacentElement('afterend',card); else screen.prepend(card);
      this.bindUI(card); return card;
    },
    bindUI(card) {
      if (!card || card.dataset.bound) return; card.dataset.bound='1';
      const date=card.querySelector('#trt-date'); date.value=this.selectedDay||today();
      date.addEventListener('change',()=>{this.selectedDay=date.value||today();this.mode='day';this.render();});
      card.querySelector('#trt-today').addEventListener('click',()=>{this.selectedDay=today();this.mode='day';date.value=this.selectedDay;this.render();});
      card.querySelector('#trt-7d').addEventListener('click',()=>{this.selectedDay=date.value||today();this.mode='7d';this.render();});
      card.querySelector('#trt-attack').addEventListener('click',()=>this.attack());
      card.querySelector('#trt-copy').addEventListener('click',()=>this.copyWrongIds());
      card.querySelector('#trt-export').addEventListener('click',()=>this.exportJSON());
    },
    render() {
      const card=this.ensureUI(); if (!card) return;
      if (!this.selectedDay) this.selectedDay=today();
      const date=card.querySelector('#trt-date'); if (date && date.value!==this.selectedDay) date.value=this.selectedDay;
      const state=this.state(), connected=state.connection && state.connection.status==='connected';
      card.querySelector('#trt-dot')?.classList.toggle('on',!!connected);
      const st=card.querySelector('#trt-status'); if(st) st.textContent=connected ? `Companion conectado${state.connection.account?' · '+state.connection.account:''}` : 'Companion não detectado';
      const range=this.range(), rows=this.rows(range), s=this.summary(rows), groups=this.groups(rows);
      const label=card.querySelector('#trt-range-label'); if(label) label.textContent=range.label;
      const kpis=card.querySelector('#trt-kpis'); if(kpis) kpis.innerHTML=[['Resoluções',s.attempts],['Erros',s.errors],['IDs errados',s.uniqueWrong],['Corrigidos depois',s.corrected],['Matérias',s.disciplines],['Assuntos',s.topics]].map(([a,b])=>`<div class="trt-kpi"><b>${b}</b><small>${a}</small></div>`).join('');
      const note=card.querySelector('#trt-note'); if(note){const confirmed=groups.filter(g=>g.robust).length,mapped=groups.filter(g=>!g.robust&&g.tec).length,unmapped=groups.filter(g=>!g.tec).length;note.textContent=`Mapeamento dos erros: ${confirmed} fraqueza(s) confirmada(s) · ${mapped} tópico(s) reconhecido(s), mas sem fraqueza confirmada · ${unmapped} não mapeado(s). O sistema nunca cria reforço automático para correspondência incerta.`;}
      const list=card.querySelector('#trt-list');
      if(list) list.innerHTML=groups.length?groups.slice(0,30).map(g=>{const status=g.robust?['Fraqueza confirmada','confirmed']:g.tec?['Erro do dia','mapped']:['Não mapeado','unmapped'];return `<div class="trt-row"><div><b>${esc(g.disciplina)} · ${esc(g.assunto)}</b><small>${g.uniqueIds} ID(s) · ${g.errors} erro(s)${g.recurrent?` · ${g.recurrent} ID(s) reincidente(s)`:''}</small></div><span class="trt-badge ${status[1]}">${status[0]}</span></div>`;}).join(''):`<div class="trt-empty">Nenhum erro capturado neste período.</div>`;
      const attack=card.querySelector('#trt-attack'); if(attack) attack.disabled=!groups.some(g=>g.robust);
    },

    patchQueue() {
      if (this._queuePatched || typeof ReforcoFila === 'undefined' || typeof DB === 'undefined') return;
      this._queuePatched=true; ReforcoFila.MAX_TAREFAS_DIA=Math.max(3,n(ReforcoFila.MAX_TAREFAS_DIA,2));
      const originalPrefs=ReforcoFila.prefs.bind(ReforcoFila);
      ReforcoFila.prefs=function(){const p=originalPrefs();try{const raw=JSON.parse(localStorage.getItem(DB._profilePrefix()+this.KEY_PREF)||'{}');const d=Number(raw&&raw.disciplinasDia);if([1,2,3].includes(d))p.disciplinasDia=d;}catch(_){}return p;};
      const originalSave=ReforcoFila.salvarPrefs.bind(ReforcoFila);
      ReforcoFila.salvarPrefs=function(patch){
        if (!patch || Number(patch.disciplinasDia)!==3) return originalSave(patch);
        const current=this.prefs(), lim=this._sanearLimites(patch.blocoMin??current.blocoMin,patch.blocoMax??current.blocoMax);
        const p={...current,...patch,disciplinasDia:3,blocoMin:lim.min,blocoMax:lim.max};
        const key=DB._profilePrefix()+this.KEY_PREF;try{if(DB.setRaw)DB.setRaw(key,JSON.stringify(p));else localStorage.setItem(key,JSON.stringify(p));}catch(e){if(typeof _quiet==='function')_quiet(e,'fila-prefs-3');}
        this._assinaturaAnterior='';this.sincronizar();return p;
      };
      document.addEventListener('change',(e)=>{const el=e.target;if(!el||el.id!=='exm-ref-disciplinas-dia'||el.value!=='3')return;e.stopImmediatePropagation();ReforcoFila.salvarPrefs({disciplinasDia:3});try{ExtrasScreen.selDay=today();ExtrasScreen.render();}catch(_){}if(typeof showToast==='function')showToast('Rodízio ajustado para 3 disciplinas por dia ✓');},true);
      const decorate=()=>{const el=document.getElementById('exm-ref-disciplinas-dia');if(el&&!el.querySelector('option[value="3"]')){const o=document.createElement('option');o.value='3';o.textContent='3 · força-tarefa';el.appendChild(o);if(ReforcoFila.prefs().disciplinasDia===3)el.value='3';}};
      this._observer=new MutationObserver(decorate);this._observer.observe(document.documentElement,{childList:true,subtree:true});decorate();
    },
    bind() {
      if (!this._messageBound) { this._messageBound=true; window.addEventListener('message',e=>this.onMessage(e)); }
      try { window.postMessage({source:APP_SOURCE,type:'bridge-ready',version:1},location.origin); } catch (_) {}
      this.patchQueue(); this.render();
    },
    init() { this.bind(); }
  };

  window.TecRealtime = R;
  window.addEventListener('screen:activated', e => { if (e.detail && e.detail.screen === 'integracaotec') R.init(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',()=>R.bind(),{once:true}); else R.bind();
})();
