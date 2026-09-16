/* ============================================================================
   TEC HARDENING V2 — TRUST GATE, ROTEAMENTO POR PERFIL E PROVEDOR DE IA
   ----------------------------------------------------------------------------
   Contratos finais:
   1) resolução só vira evidência prescritiva quando marcada + gabarito são
      verificáveis e o resultado canônico bate com ambos;
   2) eventos legados continuam visíveis, mas NÃO podem criar lacuna/reforço;
   3) a extensão é vinculada explicitamente a usuário + perfil + aba do Study;
   4) Companion antigo ou evento roteado para outro perfil não recebe ACK;
   5) IA é configurável por provedor; segredo/API key nunca fica no navegador.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecHardeningApiV2) return;
  window.__tecHardeningApiV2 = true;

  const APP_SOURCE = 'StudyNoMentorApp';
  const EXT_SOURCE = 'StudyMentorCompanion';
  const MIN_COMPANION = '1.2.0';
  const PROVIDER_SUFFIX = 'tec-ai-provider-v1';
  const DEVICE_KEY = 'diario-estudos:device-id-v1';
  const TAB_KEY = 'snm:tab-session-id-v1';
  const PROVIDERS = [
    ['auto', 'Automático (servidor)'],
    ['gemini', 'Gemini · Google AI Studio'],
    ['openai', 'OpenAI API'],
    ['openai-compatible', 'API compatível com OpenAI'],
    ['chatgpt-plus-browser', 'ChatGPT Plus · Companion']
  ];

  const letter = v => {
    const m = String(v == null ? '' : v).toUpperCase().match(/(?:^|\b)([A-E])(?:\b|$)/);
    return m ? m[1] : null;
  };
  const uid = () => globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const quiet = (e,ctx) => { try { if (typeof _quiet === 'function') _quiet(e,ctx); } catch (ignored) { void ignored; } };

  function semver(v) {
    return String(v || '').replace(/^v/i,'').split(/[.+-]/).slice(0,3).map(x => Number.parseInt(x,10) || 0);
  }
  function versionAtLeast(actual, minimum) {
    const a=semver(actual), b=semver(minimum);
    for (let i=0;i<3;i++) { if ((a[i]||0)>(b[i]||0)) return true; if ((a[i]||0)<(b[i]||0)) return false; }
    return true;
  }

  const TecTrustGate = {
    classify(value) {
      const q=value && value.question ? value.question : (value || {});
      const integrity=q.integrity || value && value.integrity || null;
      const marked=letter(q.marcada != null ? q.marcada : value && value.marcada);
      const correct=letter(q.correta != null ? q.correta : value && value.correta);
      const result=typeof q.acertou==='boolean' ? q.acertou : (value && typeof value.acertou==='boolean' ? value.acertou : null);
      const derived=marked&&correct ? marked===correct : null;
      const schema=Number(integrity && integrity.schema || 0);
      const openConflict=!!(integrity && integrity.conflict===true && integrity.conflictResolved!==true);
      const verified=!!(
        integrity && schema>=3 && integrity.status==='verified' && integrity.confidence==='high' &&
        marked && correct && typeof result==='boolean' && result===derived && !openConflict
      );
      let reason='verified';
      if (!integrity || schema<3) reason='legacy-unverified';
      else if (!marked) reason='missing-marked-answer';
      else if (!correct) reason='missing-answer-key';
      else if (typeof result!=='boolean') reason='missing-result';
      else if (result!==derived) reason='result-mismatch';
      else if (openConflict) reason='open-conflict';
      else if (integrity.status!=='verified' || integrity.confidence!=='high') reason='insufficient-confidence';
      return { trusted:verified, prescriptive:verified, reason, integrity, marked, correct, result, derived };
    },
    isTrusted(value) { return this.classify(value).trusted; },
    prescriptive(rows) { return (rows || []).filter(x => this.isTrusted(x)); },
    stats(rows) {
      const out={total:0,trusted:0,legacy:0,untrusted:0,reasons:{}};
      for (const row of rows || []) {
        const c=this.classify(row); out.total++;
        if (c.trusted) out.trusted++;
        else { out.untrusted++; if (c.reason==='legacy-unverified') out.legacy++; out.reasons[c.reason]=(out.reasons[c.reason]||0)+1; }
      }
      return out;
    }
  };
  window.TecTrustGate=TecTrustGate;

  /* ── Contexto do Study entregue à extensão ───────────────────────────── */
  function deviceId() {
    try {
      let id=localStorage.getItem(DEVICE_KEY);
      if (!id) { id='dev_'+uid(); localStorage.setItem(DEVICE_KEY,id); }
      return id;
    } catch (_) { return 'dev_session_'+uid(); }
  }
  function tabSessionId() {
    try {
      let id=sessionStorage.getItem(TAB_KEY);
      if (!id) { id='tab_'+uid(); sessionStorage.setItem(TAB_KEY,id); }
      return id;
    } catch (_) { return 'tab_session_'+uid(); }
  }
  function siteBuild() {
    try { return document.querySelector('meta[name="diario-versao"]')?.getAttribute('content') || 'unknown'; }
    catch (_) { return 'unknown'; }
  }
  function studyContext() {
    try {
      const userId=window.CloudStore && CloudStore.session && CloudStore.session.user && CloudStore.session.user.id;
      const profileId=window.ProfileManager && ProfileManager.getActiveProfileId ? ProfileManager.getActiveProfileId() : null;
      if (!userId || !profileId) return null;
      return { userId:String(userId), profileId:String(profileId), deviceId:deviceId(), tabSessionId:tabSessionId(), siteBuild:siteBuild() };
    } catch (e) { quiet(e,'tec-study-context'); return null; }
  }
  function sendBridgeContext(claim=true) {
    const ctx=studyContext(); if (!ctx) return false;
    try {
      window.postMessage({source:APP_SOURCE,type:'bridge-context',payload:ctx,claim:!!claim},location.origin);
      return true;
    } catch (e) { quiet(e,'tec-bridge-context'); return false; }
  }
  window.__snmTecStudyContext=studyContext;
  window.__snmTecClaimRoute=() => sendBridgeContext(true);

  /* ── Resultado canônico + merge conservador da Biblioteca ───────────── */
  const T=window.TecIntegracaoScreen;
  if (T) {
    const baseCanonical=typeof T.canonicalQuestion==='function' ? T.canonicalQuestion.bind(T) : null;
    T.canonicalQuestion=function(oldQ={},incoming={}) {
      let q=baseCanonical ? baseCanonical(oldQ,incoming) : {...oldQ,...incoming};
      const marked=letter(incoming.marcada)||letter(q.marcada)||letter(oldQ.marcada)||
        letter(((incoming.alternativas||[]).find(a=>a&&a.marcadaPorMim===true)||{}).letra)||
        letter(((oldQ.alternativas||[]).find(a=>a&&a.marcadaPorMim===true)||{}).letra);
      const correct=letter(incoming.correta)||letter(q.correta)||letter(oldQ.correta)||
        letter(((incoming.alternativas||[]).find(a=>a&&a.correta===true)||{}).letra)||
        letter(((oldQ.alternativas||[]).find(a=>a&&a.correta===true)||{}).letra);
      const reported=typeof incoming.acertou==='boolean' ? incoming.acertou : (typeof q.acertou==='boolean' ? q.acertou : null);
      const derived=marked&&correct ? marked===correct : null;
      const rawConflict=typeof reported==='boolean'&&typeof derived==='boolean'&&reported!==derived;
      if (marked) q.marcada=marked;
      if (correct) q.correta=correct;
      if (typeof derived==='boolean') q.acertou=derived;
      const prev=q.integrity||oldQ.integrity||incoming.integrity||{};
      if (marked&&correct) {
        q.integrity={...prev,schema:Math.max(3,Number(prev.schema||0)),status:'verified',confidence:'high',source:'marked-vs-gabarito',
          marked,correct,canonicalResult:derived,reportedResult:reported,conflict:false,conflictResolved:rawConflict||prev.conflictResolved===true,
          conflictHistory:rawConflict?[...(Array.isArray(prev.conflictHistory)?prev.conflictHistory:[]),{reported,canonical:derived,resolved:true,at:new Date().toISOString()}].slice(-20):(prev.conflictHistory||[]),
          reconciledAt:new Date().toISOString()};
      }
      return q;
    };
    T.dataQuality=function(q={}) {
      const c=TecTrustGate.classify(q);
      const fields={id:!!q.id,enunciado:!!String(q.enunciado||'').trim(),alternativas:Array.isArray(q.alternativas)&&q.alternativas.length>=2,
        marcada:!!letter(q.marcada),gabarito:!!letter(q.correta),resultado:typeof q.acertou==='boolean',materia:!!String(q.materia||'').trim(),assunto:!!String(q.assunto||'').trim()};
      return {fields,core:fields.id&&fields.enunciado&&fields.alternativas,outcome:fields.marcada&&fields.gabarito&&fields.resultado,
        conflict:c.reason==='open-conflict',trustworthy:c.trusted,captured:Object.values(fields).filter(Boolean).length,total:Object.keys(fields).length,reason:c.reason};
    };
    T.mergeInto=function(state,question,meta={}) {
      if (!question || (!question.id && !question.enunciado)) throw new Error('Questão sem identificação ou enunciado.');
      const account=this.text(meta.tecAccount)||'conta-importada';
      const book=this.text(meta.bookId||question.cadernoId)||'caderno-desconhecido';
      const key=this.questionKey(account,book,question.id||this.hash(question.enunciado));
      const prev=state.questions[key]||{};
      const merged=this.canonicalQuestion(prev.question||{},question||{});
      state.questions[key]={...prev,key,tecAccount:account,bookId:book,history:meta.history||prev.history||null,question:merged,
        receivedAt:meta.capturedAt||prev.receivedAt||new Date().toISOString(),lastMergedAt:new Date().toISOString()};
      state.connection={status:'connected',account,bookId:book,lastSeenAt:new Date().toISOString()};
      return key;
    };
  }

  /* ── Roteamento, proveniência e versão do Companion ─────────────────── */
  const R=window.TecRealtime;
  if (R) {
    const originalNormalize=R.normalize.bind(R);
    R.normalize=function(payload) {
      const ev=originalNormalize(payload); if (!ev) return ev;
      const provenance=payload&&payload.provenance||{};
      const routing=payload&&payload.__routing||{};
      ev.provenance={...(ev.provenance||{}),...provenance,
        companionVersion:provenance.companionVersion||payload&&payload.__extensionVersion||null,
        deviceId:provenance.deviceId||routing.deviceId||null,
        tabSessionId:provenance.tabSessionId||routing.tabSessionId||null,
        siteBuild:provenance.siteBuild||routing.siteBuild||null,
        profileId:routing.profileId||null,userId:routing.userId||null};
      const c=TecTrustGate.classify(ev);
      ev.outcomeTrusted=c.trusted;
      ev.trustStatus=c.trusted?'verified':c.reason;
      return ev;
    };

    const originalOnMessage=R.onMessage.bind(R);
    R.onMessage=function(event) {
      const m=event&&event.data;
      if (!m||typeof m!=='object') return originalOnMessage(event);

      if (m.source===EXT_SOURCE && m.type==='companion-ready') {
        const version=String(m.payload&&m.payload.version||m.extensionVersion||'0.0.0');
        if (!versionAtLeast(version,MIN_COMPANION)) {
          try {
            const st=this.state(); st.connection={...(st.connection||{}),status:'incompatible',extensionVersion:version,minExtensionVersion:MIN_COMPANION,lastSeenAt:new Date().toISOString()}; this.save(st); this.render();
            if (typeof showToast==='function') showToast(`⚠️ Companion ${version} incompatível. Atualize para ${MIN_COMPANION} ou superior.`);
          } catch (e) { quiet(e,'tec-companion-incompatible'); }
          return;
        }
      }

      if (m.source===EXT_SOURCE && m.type==='resolution') {
        if (!this.accepted(event)) return;
        const ctx=studyContext();
        const route=m.routing||{};
        const extVersion=String(m.extensionVersion||m.payload&&m.payload.provenance&&m.payload.provenance.companionVersion||'0.0.0');
        if (!versionAtLeast(extVersion,MIN_COMPANION)) {
          if (typeof showToast==='function') showToast(`⚠️ Resolução preservada na fila: atualize o Companion para ${MIN_COMPANION}+.`);
          return; // SEM ACK: a fila continua íntegra.
        }
        if (!ctx || !route.userId || !route.profileId || String(route.userId)!==ctx.userId || String(route.profileId)!==ctx.profileId) {
          quiet(new Error('routing-mismatch'),'tec-resolution-routing');
          return; // SEM ACK: outro perfil nunca consome o evento.
        }
        const payload={...(m.payload||{}),__routing:{...route},__extensionVersion:extVersion};
        return this.ingest(payload,m.messageId);
      }
      return originalOnMessage(event);
    };

    /* Atacar erros continua mostrando o Radar completo, mas prescreve somente
       eventos verificados pelo mesmo TrustGate usado pelas demais camadas. */
    if (typeof R.attack==='function'&&!R.__trustAttackWrapped) {
      R.__trustAttackWrapped=true;
      const originalAttack=R.attack.bind(R);
      R.attack=function(...args) {
        const ownRows=this.rows;
        this.rows=(range)=>TecTrustGate.prescriptive(ownRows.call(this,range));
        try { return originalAttack(...args); }
        finally { this.rows=ownRows; }
      };
    }
  }

  /* ── ÚNICO TrustGate para motores prescritivos ───────────────────────── */
  const L=window.TecLacunasContinuas;
  if (L&&typeof L.events==='function'&&!L.__trustGateV2) {
    L.__trustGateV2=true;
    const original=L.events.bind(L);
    L.events=function() { return TecTrustGate.prescriptive(original()||[]); };
  }
  const E=window.TecRealEvidence;
  if (E&&typeof E.events==='function'&&!E.__trustGateV2) {
    E.__trustGateV2=true;
    const original=E.events.bind(E);
    E.events=function() { return TecTrustGate.prescriptive(original()||[]); };
  }

  /* ── Provedor de IA por perfil — somente configuração, nunca segredo ─── */
  function providerKey() {
    try { return DB._profilePrefix()+PROVIDER_SUFFIX; }
    catch (_) { return 'diario-estudos:'+PROVIDER_SUFFIX; }
  }
  function getProvider() {
    try {
      const v=String(localStorage.getItem(providerKey())||'auto');
      return PROVIDERS.some(([id])=>id===v)?v:'auto';
    } catch (_) { return 'auto'; }
  }
  function setProvider(value) {
    const v=PROVIDERS.some(([id])=>id===String(value))?String(value):'auto';
    try {
      if (typeof DB!=='undefined'&&DB.setRaw) DB.setRaw(providerKey(),v); else localStorage.setItem(providerKey(),v);
      ensureProviderUI();
      return v;
    } catch (e) { quiet(e,'tec-provider-save'); return getProvider(); }
  }
  window.TecAIProvider={get:getProvider,set:setProvider,options:PROVIDERS.map(([id,label])=>({id,label}))};

  if (T&&typeof T.callAI==='function') {
    /* Substitui também o adaptador de compatibilidade 97: o prompt é enviado UMA
       vez em customPrompts. professorQuestion continua exclusivo da aba Professor. */
    T.callAI=async function(section,professorQuestion) {
      const state=this.state(),row=state.questions&&state.questions[this.selectedKey];
      if (!row) throw new Error('Selecione uma questão.');
      const cs=window.CloudStore;
      if (!cs||!cs.isLoggedIn||!cs.isLoggedIn()||!cs.session) throw new Error('Entre na sua conta do Study para usar a IA.');
      const analysisKey=row.key+':'+this.PROMPT_VERSION;
      const provider=getProvider();
      const requestBody=JSON.stringify({
        question:row.question,history:row.history,existingAnalysis:state.analyses[analysisKey]||null,
        section:section||'diagnostico',professorQuestion:professorQuestion||null,promptVersion:this.PROMPT_VERSION,
        customPrompts:this.customPromptsFor(section,row.question),provider
      });
      let response;
      for (let attempt=0;attempt<2;attempt++) {
        response=await cs._buscarComTeto(cs.SUPABASE_URL+'/functions/v1/tec-ai',{method:'POST',
          headers:{'content-type':'application/json',authorization:'Bearer '+cs.session.access_token},body:requestBody});
        if (response.ok||![429,502,503,504].includes(response.status)||attempt===1) break;
        await new Promise(resolve=>setTimeout(resolve,700+Math.floor(Math.random()*500)));
      }
      const body=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(body.error||'A análise não pôde ser concluída.');
      state.analyses[analysisKey]={...(state.analyses[analysisKey]||{}),...(body.analysis||body),_provider:body.provider||provider,_model:body.model||null,_requestId:body.requestId||null,updatedAt:new Date().toISOString()};
      if (!this.save(state)) throw new Error('A análise foi gerada, mas não pôde ser salva.');
      return body.analysis||body;
    };
  }

  function ensureProviderUI() {
    const card=document.querySelector('#screen-integracaotec .tec-assistant-card');
    if (!card) return null;
    let box=card.querySelector('#tec-ai-provider-box');
    if (!box) {
      box=document.createElement('div'); box.id='tec-ai-provider-box'; box.className='tec-ai-provider-box';
      const label=document.createElement('label'); label.htmlFor='tec-ai-provider-select'; label.textContent='Provedor de IA';
      const select=document.createElement('select'); select.id='tec-ai-provider-select'; select.className='tec-ai-provider-select';
      for (const [id,name] of PROVIDERS) { const o=document.createElement('option'); o.value=id; o.textContent=name; select.appendChild(o); }
      const hint=document.createElement('span'); hint.className='tec-ai-provider-hint'; hint.textContent='Chaves ficam somente no servidor. Troque o provedor aqui sem alterar prompts nem dados.';
      select.addEventListener('change',()=>{ setProvider(select.value); if (typeof showToast==='function') showToast('Provedor de IA atualizado ✓'); });
      box.append(label,select,hint);
      const header=card.querySelector('.card-header');
      if (header) header.insertAdjacentElement('afterend',box); else card.prepend(box);
    }
    const select=box.querySelector('#tec-ai-provider-select'); if (select) select.value=getProvider();
    return box;
  }

  function renderTrustNotice() {
    const card=document.getElementById('tec-realtime-card'); if (!card||!R) return;
    let note=card.querySelector('#trt-trust-gate-v2');
    if (!note) { note=document.createElement('div'); note.id='trt-trust-gate-v2'; note.className='trt-trust-gate-v2'; card.appendChild(note); }
    const stats=TecTrustGate.stats(Object.values(R.state().events||{}));
    note.textContent=stats.untrusted
      ? `${stats.trusted} resolução(ões) verificadas podem alimentar reforços · ${stats.untrusted} legado/duvidosa(s) ficam somente no histórico.`
      : `${stats.trusted} resolução(ões) verificadas · TrustGate ativo.`;
  }

  function activate(reason) {
    sendBridgeContext(true); ensureProviderUI(); renderTrustNotice();
    try { window.dispatchEvent(new CustomEvent('tec:hardening-ready',{detail:{reason:reason||'activate',minCompanion:MIN_COMPANION,provider:getProvider()}})); }
    catch (e) { quiet(e,'tec-hardening-event'); }
  }

  window.addEventListener('focus',()=>activate('focus'));
  window.addEventListener('pageshow',()=>activate('pageshow'));
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden) activate('visible'); });
  window.addEventListener('screen:activated',ev=>{ if (ev.detail&&ev.detail.screen==='integracaotec') activate('screen'); else sendBridgeContext(false); });
  window.addEventListener('message',ev=>{
    const m=ev&&ev.data;
    if (ev.source===window&&ev.origin===location.origin&&m&&m.source===EXT_SOURCE&&m.type==='resolution') setTimeout(renderTrustNotice,150);
  });
  setInterval(()=>{ if (!document.hidden) sendBridgeContext(true); },60000);

  const start=()=>activate('startup');
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
})();
