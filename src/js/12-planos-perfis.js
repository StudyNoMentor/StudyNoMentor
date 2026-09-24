/* ============================================================
   PLANEJAMENTOS — registro de espaços de trabalho (workspaces)
   Cada planejamento tem seu próprio namespace de dados (via DB.keysForPlan).
   ============================================================ */
const PlanManager = {
  // GK do perfil ativo (planejamentos, planejamento ativo e estado de pausa).
  // A pausa fica em profile setting separado para não exigir migração destrutiva
  // da tabela study_plans e sincroniza pelo mesmo canal relacional já existente.
  get GK() { const p = DB._profilePrefix(); return { plans: p + 'planejamentos', active: p + 'active-plan', pauses: p + 'plan-pauses-v1' }; },
  TIPOS: ['Pré-edital', 'Pós-edital', 'Outro'],

  getPlans() { return DB._get(this.GK.plans, []); },
  savePlans(list) { DB._set(this.GK.plans, list); },
  _pauseMap() {
    const v = DB._get(this.GK.pauses, {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  },
  _savePauseMap(v) { return DB._set(this.GK.pauses, v || {}); },
  pauseInfo(id) {
    const x = this._pauseMap()[String(id)] || null;
    if (!x || !x.pausedAt || x.resumedAt) return null;
    return x;
  },
  isPaused(id) { return !!this.pauseInfo(id); },
  isActivePlanPaused() { return this.isPaused(this.getActivePlanId()); },
  getOperationalPlans() { return this.getPlans().filter(p => !this.isPaused(p.id)); },
  getPausedPlans() { return this.getPlans().filter(p => this.isPaused(p.id)); },
  pausePlan(id) {
    id = String(id || '');
    const plans = this.getPlans(), p = plans.find(x => String(x.id) === id);
    if (!p) return { ok: false, reason: 'not-found' };
    if (this.isPaused(id)) return { ok: true, unchanged: true, info: this.pauseInfo(id) };
    const outros = plans.filter(x => String(x.id) !== id && !this.isPaused(x.id));
    if (!outros.length) return { ok: false, reason: 'last-operational' };
    const now = new Date().toISOString(), map = this._pauseMap();
    map[id] = { pausedAt: now, resumedAt: null };
    if (this._savePauseMap(map) === false) return { ok: false, reason: 'save-failed' };
    let switchedTo = null;
    if (String(this.getActivePlanId()) === id) {
      switchedTo = outros[0].id;
      DB.setRaw(this.GK.active, switchedTo);
      try { DB.invalidarRevlogMemoria(); } catch (e) { _quiet(e, 'plano-revlog-mem-pause'); }
    }
    try { window.dispatchEvent(new CustomEvent('planning:pause-changed', { detail: { planId: id, paused: true, pausedAt: now, switchedTo } })); }
    catch (e) { _quiet(e, 'planning-pause-event'); }
    return { ok: true, pausedAt: now, switchedTo };
  },
  resumePlan(id) {
    id = String(id || '');
    if (!this.getPlans().some(x => String(x.id) === id)) return { ok: false, reason: 'not-found' };
    const map = this._pauseMap(), old = map[id];
    if (!old || !old.pausedAt || old.resumedAt) return { ok: true, unchanged: true };
    const now = new Date().toISOString();
    map[id] = Object.assign({}, old, { resumedAt: now });
    if (this._savePauseMap(map) === false) return { ok: false, reason: 'save-failed' };
    try { window.dispatchEvent(new CustomEvent('planning:pause-changed', { detail: { planId: id, paused: false, resumedAt: now } })); }
    catch (e) { _quiet(e, 'planning-resume-event'); }
    return { ok: true, resumedAt: now };
  },
  // Mesma leitura saneada do DB._activePlanId: um id com aspas renomearia de uma
  // vez todas as chaves do planejamento e as telas abririam vazias.
  getActivePlanId() { try { return DB._activePlanId(); } catch (e) { return null; } },
  getActivePlan() { return this.getPlans().find(p => p.id === this.getActivePlanId()) || null; },
  // Trocar de planejamento é uma alteração do perfil como qualquer outra: passa
  // pelo canal único para chegar à nuvem (antes só subia no blob periódico).
  setActivePlan(id) {
    if (this.isPaused(id)) return false;
    DB.setRaw(this.GK.active, id);
    // Idem: cada planejamento tem o seu histórico.
    try { DB.invalidarRevlogMemoria(); } catch (e) { _quiet(e, 'plano-revlog-mem'); }
    return true;
  },

  // Semeia formas de estudo e fases padrão para um planejamento novo,
  // para que todas as telas já funcionem "de fábrica".
  _seedDefaults(planId, opts) {
    const k = DB.keysForPlan(planId);
    const silent = !!(opts && opts.silent);
    /* No bootstrap de um aparelho novo estes valores são apenas andaimes para a
       UI abrir. Eles NÃO são uma edição do usuário e não podem entrar na outbox
       antes da primeira hidratação; caso contrário colidem com os mesmos
       cadastros já existentes na nuvem e deixam o spinner preso em erro.
       Se o perfil for realmente novo, seedUntrackedOnly os publica depois. */
    const put = (key, value) => {
      if (silent) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { _quiet(e, 'plan-bootstrap'); return false; }
      }
      return DB._set(key, value);
    };
    if (localStorage.getItem(k.methods) === null)
      put(k.methods, DB.DEFAULT_METHODS.map(nome => ({ id: DB._uid(), nome, ativo: true })));
    if (localStorage.getItem(k.phases) === null)
      put(k.phases, DB.DEFAULT_PHASES.map(nome => ({ id: DB._uid(), nome, ativo: true })));
    if (localStorage.getItem(k.statuses) === null)
      put(k.statuses, DB.DEFAULT_STATUSES.map(s => ({ id: DB._uid(), ...s, ativo: true })));
    if (localStorage.getItem(k.modes) === null)
      put(k.modes, DB.DEFAULT_MODES.map(nome => ({ id: DB._uid(), nome, ativo: true })));
  },

  createPlan({ nome, tipo }) {
    const id = 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const plans = this.getPlans();
    plans.push({ id, nome: nome.trim(), tipo: tipo || 'Outro', createdAt: new Date().toISOString() });
    this.savePlans(plans);
    this._seedDefaults(id);
    return id;
  },

  // Cria um planejamento novo aproveitando a ESTRUTURA de outro. Registros, ciclos e semanas
  // fechadas nunca viajam; o histórico TEC só viaja quando o usuário pede explicitamente.
  duplicateFrom(sourceId, opts) {
    const id = this.createPlan({ nome: opts.nome, tipo: opts.tipo }); // já semeia padrões
    const sk = DB.keysForPlan(sourceId);
    const dk = DB.keysForPlan(id);
    const clone = (key) => JSON.parse(JSON.stringify(DB._get(key, null)));
    if (opts.copyMethods)  { const v = clone(sk.methods);  if (v) DB._set(dk.methods, v); }
    if (opts.copyPhases)   { const v = clone(sk.phases);   if (v) DB._set(dk.phases, v); }
    // Copiar matérias exige copiar os modos junto (as disciplinas referenciam o modo por id)
    if (opts.copySubjects) {
      const md = clone(sk.modes);    if (md) DB._set(dk.modes, md);
      const v = clone(sk.subjects);  if (v) DB._set(dk.subjects, v);
    }
    // Copiar trilhas exige copiar os status junto (as aulas referenciam status por id)
    if (opts.copyTracks) {
      const st = clone(sk.statuses); if (st) DB._set(dk.statuses, st);
      const v = clone(sk.tracks);    if (v) DB._set(dk.tracks, v);
    }
    // Histórico TEC é contexto estratégico, não herança automática. Só via
    // opção explícita na criação; a cópia recebe IDs próprios para continuar
    // independente da origem (excluir/reimportar aqui nunca toca o outro plano).
    if (opts.copyTec) {
      const v = clone(sk.tec);
      if (Array.isArray(v) && v.length) {
        const stamp = Date.now().toString(36);
        v.forEach((s, i) => {
          const originalId = s.id;
          s.id = 'tec_' + stamp + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
          s.copiedFrom = { planId: sourceId, snapshotId: originalId };
          s.importedAt = new Date().toISOString();
        });
        DB._set(dk.tec, v);
      }
    }
    return id;
  },

  renamePlan(id, nome) {
    const plans = this.getPlans();
    const p = plans.find(x => x.id === id);
    if (p) p.nome = nome.trim();
    this.savePlans(plans);
  },
  updatePlan(id, patch) {
    const plans = this.getPlans();
    const p = plans.find(x => x.id === id);
    if (p) Object.assign(p, patch);
    this.savePlans(plans);
  },
  /* Cards/Anki são patrimônio do PERFIL. Como a persistência histórica ainda
     fica fisicamente sob o namespace de um planejamento, excluir esse plano
     primeiro migra toda a coleção que nasceu nele para outro plano operacional.
     Isso inclui decks, cards, revlog e as entidades dinâmicas Note/NoteType. */
  _migrateKnowledgeBeforeDelete(sourceId, targetId) {
    sourceId = String(sourceId || ''); targetId = String(targetId || '');
    if (!sourceId || !targetId || sourceId === targetId) return { ok:false, reason:'invalid-target' };
    const sk = DB.keysForPlan(sourceId), tk = DB.keysForPlan(targetId);
    const clone = x => { try { return JSON.parse(JSON.stringify(x)); } catch (_) { return x; } };
    const same = (a,b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; } };
    let numericSeed = Date.now();
    const allocNumeric = () => {
      try {
        if (typeof AnkiParity !== 'undefined' && AnkiParity._allocId) return AnkiParity._allocId();
      } catch (_) {}
      numericSeed += 1; return numericSeed;
    };
    const cleanTagged = x => {
      const y = clone(x); if (y && typeof y === 'object') { delete y._planId; delete y._planNome; delete y._planPaused; } return y;
    };

    const sourceDecks = DB._get(sk.decks, []) || [], targetDecks = DB._get(tk.decks, []) || [];
    const deckIds = new Set(targetDecks.map(x => String(x && x.id))), deckMap = new Map(), movedDecks = [];
    sourceDecks.forEach(d0 => {
      const d = cleanTagged(d0); if (!d) return;
      const old = String(d.id), existing = targetDecks.find(x => String(x && x.id) === old);
      let next = d.id;
      if (existing && !same(existing, d)) {
        do { next = DB._uid(); } while (deckIds.has(String(next)));
        d.id = next;
      }
      deckMap.set(old, d.id); deckIds.add(String(d.id));
      if (!existing || String(d.id) !== old) movedDecks.push(d);
    });
    movedDecks.forEach(d => {
      ['parentId','filteredDeckId','originalDeckId'].forEach(k => {
        if (d[k] != null && deckMap.has(String(d[k]))) d[k] = deckMap.get(String(d[k]));
      });
      targetDecks.push(d);
    });

    const entityPrefix = DB._profilePrefix() + 'p:' + sourceId + ':cards-';
    const entityRows = [];
    try {
      for (let i=0;i<localStorage.length;i++) {
        const key=localStorage.key(i);
        if (key && String(key).startsWith(entityPrefix)) entityRows.push([String(key), localStorage.getItem(key)]);
      }
    } catch (_) {}

    const byKind = kind => entityRows.filter(([k]) => k.startsWith(entityPrefix + kind + ':'));
    const migratedEntityKeys = new Set();
    const ntMap = new Map(), noteMap = new Map();
    const targetEntityKey = (kind,id) => DB._profilePrefix() + 'p:' + targetId + ':cards-' + kind + ':' + String(id);

    byKind('notetype').forEach(([key,raw]) => {
      let x=null; try { x=JSON.parse(raw||'null'); } catch (_) {}
      if (!x || x.id == null) return;
      const old=String(x.id), direct=targetEntityKey('notetype',x.id), existingRaw=localStorage.getItem(direct);
      let next=x.id;
      if (existingRaw != null && existingRaw !== raw) {
        do { next=allocNumeric(); } while (localStorage.getItem(targetEntityKey('notetype',next)) != null);
        x.id=next; x.ankiId=next;
      }
      ntMap.set(old,x.id);
      let ok=true;
      if (existingRaw == null || String(next) !== old) ok = DB.setRaw(targetEntityKey('notetype',x.id),JSON.stringify(x)) !== false;
      if (ok) migratedEntityKeys.add(key);
    });

    byKind('note').forEach(([key,raw]) => {
      let x=null; try { x=JSON.parse(raw||'null'); } catch (_) {}
      if (!x || x.id == null) return;
      if (x.notetypeId != null && ntMap.has(String(x.notetypeId))) x.notetypeId=ntMap.get(String(x.notetypeId));
      const old=String(x.id), direct=targetEntityKey('note',x.id), existingRaw=localStorage.getItem(direct);
      let next=x.id;
      if (existingRaw != null && existingRaw !== JSON.stringify(x)) {
        do { next=allocNumeric(); } while (localStorage.getItem(targetEntityKey('note',next)) != null);
        x.id=next; x.ankiId=next;
      }
      noteMap.set(old,x.id);
      let ok=true;
      if (existingRaw == null || String(next) !== old) ok = DB.setRaw(targetEntityKey('note',x.id),JSON.stringify(x)) !== false;
      if (ok) migratedEntityKeys.add(key);
    });

    /* Compatibilidade futura: se uma versão posterior criar outra entidade
       cards-* sob o planejamento, não a destrua só porque esta versão ainda
       não conhece sua semântica. Copiamos byte-a-byte quando não há colisão;
       se houver uma colisão diferente, cancelamos a exclusão em vez de perder
       patrimônio do usuário. */
    for (const [key,raw] of entityRows) {
      if (migratedEntityKeys.has(key)) continue;
      const suffix=key.slice(entityPrefix.length);
      const targetKey=DB._profilePrefix() + 'p:' + targetId + ':cards-' + suffix;
      const existingRaw=localStorage.getItem(targetKey);
      if (existingRaw != null && existingRaw !== raw) return {ok:false,reason:'unknown-anki-entity-conflict',key:suffix};
      if (existingRaw == null && DB.setRaw(targetKey,raw) === false) return {ok:false,reason:'save-unknown-anki-entity',key:suffix};
      migratedEntityKeys.add(key);
    }

    const sourceCards = DB._get(sk.cards, []) || [], targetCards = DB._get(tk.cards, []) || [];
    const cardIds = new Set(targetCards.map(x => String(x && x.id))), ankiIds = new Set(targetCards.map(x => String(x && x.ankiId)).filter(Boolean));
    const cardMap = new Map(), prepared = [];
    sourceCards.forEach(c0 => {
      const card=cleanTagged(c0); if (!card) return;
      const old=String(card.id), existing=targetCards.find(x => String(x && x.id) === old);
      let next=card.id;
      if (existing && !same(existing,card)) {
        do { next=DB._uid(); } while(cardIds.has(String(next)));
        card.id=next;
      }
      cardMap.set(old,card.id); cardIds.add(String(card.id));
      if (card.ankiId != null && ankiIds.has(String(card.ankiId)) && (!existing || String(existing.ankiId) !== String(card.ankiId))) {
        let aid; do { aid=allocNumeric(); } while(ankiIds.has(String(aid)));
        card.ankiId=aid;
      }
      if (card.ankiId != null) ankiIds.add(String(card.ankiId));
      ['deckId','originalDeckId','filteredDeckId'].forEach(k => {
        if (card[k] != null && deckMap.has(String(card[k]))) card[k]=deckMap.get(String(card[k]));
      });
      if (card.notetypeId != null && ntMap.has(String(card.notetypeId))) card.notetypeId=ntMap.get(String(card.notetypeId));
      if (card.noteId != null && noteMap.has(String(card.noteId))) card.noteId=noteMap.get(String(card.noteId));
      if (card.ankiNoteId != null && noteMap.has(String(card.ankiNoteId))) card.ankiNoteId=noteMap.get(String(card.ankiNoteId));
      prepared.push({old,card,skip:!!existing && String(next)===old && same(existing,card)});
    });
    prepared.forEach(x => {
      if (x.card.reversedOf != null && cardMap.has(String(x.card.reversedOf))) x.card.reversedOf=cardMap.get(String(x.card.reversedOf));
      if (!x.skip) targetCards.push(x.card);
    });

    const remapLogs = rows => (rows || []).map(r0 => {
      const r=cleanTagged(r0); if (!r) return r;
      if (r.cardId != null && cardMap.has(String(r.cardId))) r.cardId=cardMap.get(String(r.cardId));
      return r;
    }).filter(Boolean);
    const sourceRev = remapLogs(DB._get(sk.revlog, []) || []), targetRev = DB._get(tk.revlog, []) || [];
    const reviewIds = new Set(targetRev.map(r => String(r && (r.reviewId || r.id))).filter(Boolean));
    sourceRev.forEach((r,i) => {
      const rid=r.reviewId||r.id;
      if (rid != null && reviewIds.has(String(rid))) {
        const nr=DB._uid(); if (r.reviewId != null) r.reviewId=nr; else r.id=nr;
      }
      r._position=Math.max(targetRev.length+1,Number(r._position)||0)+i;
      targetRev.push(r);
      const id2=r.reviewId||r.id; if(id2!=null) reviewIds.add(String(id2));
    });

    const mergeSafety = suffix => {
      if (!sk[suffix] || !tk[suffix]) return;
      const src=remapLogs(DB._get(sk[suffix], []) || []), dst=DB._get(tk[suffix], []) || [];
      if (src.length) DB._set(tk[suffix], dst.concat(src));
    };

    const sourceBanks=DB._get(sk.bancasCards,[])||[], targetBanks=DB._get(tk.bancasCards,[])||[];
    const banks=[...new Set(targetBanks.concat(sourceBanks).map(x=>String(x||'').trim()).filter(Boolean))];

    // Links Úteis também são patrimônio global do perfil. Como ainda moram
    // fisicamente no plano de origem, acompanham a migração antes da exclusão.
    const sourceLinks=DB._get(sk.links,[])||[], targetLinks=DB._get(tk.links,[])||[];
    const linkIds=new Set(targetLinks.map(x=>String(x&&x.id)));
    sourceLinks.forEach(l0=>{
      const l=cleanTagged(l0); if(!l)return;
      const existing=targetLinks.find(x=>String(x&&x.id)===String(l.id));
      if(existing&&same(existing,l))return;
      if(existing){let nid;do{nid=DB._uid();}while(linkIds.has(String(nid)));l.id=nid;}
      linkIds.add(String(l.id));targetLinks.push(l);
    });

    if (DB._set(tk.decks,targetDecks) === false) return {ok:false,reason:'save-decks'};
    if (DB._set(tk.cards,targetCards) === false) return {ok:false,reason:'save-cards'};
    if (DB._set(tk.revlog,targetRev) === false) return {ok:false,reason:'save-revlog'};
    if (DB._set(tk.links,targetLinks) === false) return {ok:false,reason:'save-links'};
    if (banks.length) DB._set(tk.bancasCards,banks);
    mergeSafety('revlogPendente'); mergeSafety('revlogArquivo');

    /* Só removemos da origem as entidades que foram reconhecidas E confirmadas
       no destino. Qualquer futuro cards-* que esta versão ainda não conheça fica
       preservado em vez de ser destruído silenciosamente. */
    entityRows.forEach(([key]) => {
      if (migratedEntityKeys.has(key)) DB.delRaw(key,'planejamento excluído após migração do Anki');
    });
    try { DB.invalidarRevlogMemoria(); } catch (_) {}
    try { if (typeof CardEngine !== 'undefined' && CardEngine.invalidateDueCache) CardEngine.invalidateDueCache(); } catch (_) {}
    return {ok:true,targetId,cards:sourceCards.length,decks:sourceDecks.length,revlog:sourceRev.length,entities:entityRows.length};
  },

  deletePlan(id) {
    id = String(id || '');
    const atuais = this.getPlans();
    const alvo = atuais.find(p => String(p.id) === id);
    if (!alvo || atuais.length <= 1) return false;
    /* Não deixa a exclusão criar um perfil que só tenha planejamentos pausados.
       Nesse estado nenhuma tela operacional teria um destino seguro para novas
       gravações. Reative outro antes de excluir o último operacional. */
    if (!this.isPaused(id)) {
      const outrosOperacionais = atuais.filter(p => String(p.id) !== id && !this.isPaused(p.id));
      const outrosQuaisquer = atuais.filter(p => String(p.id) !== id);
      if (!outrosOperacionais.length && outrosQuaisquer.length) return false;
    }
    // Antes de apagar o namespace, move a memória Anki/Cards para um plano que
    // continuará existindo. O plano ativo é o destino preferido.
    const destino = atuais.find(p => String(p.id) === String(this.getActivePlanId()) && String(p.id) !== id && !this.isPaused(p.id))
      || atuais.find(p => String(p.id) !== id && !this.isPaused(p.id))
      || atuais.find(p => String(p.id) !== id);
    if (!destino) return false;
    const mig = this._migrateKnowledgeBeforeDelete(id, destino.id);
    if (!mig || !mig.ok) return false;

    // apaga os dados operacionais remanescentes do planejamento. A exclusão
    // explícita é a única operação administrativa que atravessa o congelamento.
    const k = DB.keysForPlan(id);
    const wipe = () => Object.values(k).forEach(key => DB.delRaw(key, 'planejamento excluído'));
    if (DB.withPausedPlanWrite) DB.withPausedPlanWrite(wipe); else wipe();
    const plans = this.getPlans().filter(p => p.id !== id);
    this.savePlans(plans);
    const map = this._pauseMap(); if (map[String(id)]) { delete map[String(id)]; this._savePauseMap(map); }
    if (this.getActivePlanId() === id) {
      const next = plans.find(p => !this.isPaused(p.id));
      if (next) this.setActivePlan(next.id);
      else if (!plans.length) this._ensureInitial();
    }
    return true;
  },

  _ensureInitial() {
    const id = this.createPlan({ nome: 'Planejamento inicial', tipo: 'Pré-edital' });
    this.setActivePlan(id);
    return id;
  },

  init() {
    let plans = this.getPlans();
    let bootstrap = false;
    if (plans.length === 0) {
      bootstrap = true;
      const id = 'pl_inicial';
      plans = [{ id, nome: 'Planejamento inicial', tipo: 'Pré-edital', createdAt: new Date().toISOString() }];
      /* Inicialização física do namespace, sem declarar "o usuário mudou".
         Em aparelho já existente a hidratação remota substitui estes andaimes;
         em perfil realmente novo a semeadura de seções os envia normalmente. */
      try { localStorage.setItem(this.GK.plans, JSON.stringify(plans)); } catch (e) { _quiet(e, 'plan-bootstrap-plans'); }
      this._seedDefaults(id, { silent: true });
      try { localStorage.setItem(this.GK.active, id); } catch (e) { _quiet(e, 'plan-bootstrap-active'); }
    }
    // garante um planejamento ativo válido E operacional. Um planejamento
    // pausado pode continuar existindo indefinidamente, mas nunca vira o
    // contexto de escrita do app por acidente.
    if (!this.getActivePlan() || this.isActivePlanPaused()) {
      let p = this.getOperationalPlans()[0] || null;
      if (!p && this.getPlans()[0]) {
        // Estado impossível pela UI (o último operacional não pode ser pausado),
        // mas saneia dados antigos/sincronização parcial reativando o primeiro.
        this.resumePlan(this.getPlans()[0].id);
        p = this.getPlans()[0];
      }
      const id = p && p.id;
      if (id) {
        if (bootstrap) { try { localStorage.setItem(this.GK.active, id); } catch (e) { _quiet(e, 'plan-bootstrap-active2'); } }
        else this.setActivePlan(id);
      }
    }
  }
};

/* ============================================================
   PERFIS DE ACESSO — multi-usuário no dispositivo
   Cada perfil tem seus próprios planejamentos e dados (namespace 'diario-estudos:u:<id>:').
   IMPORTANTE: é uma separação LOCAL, não autenticação forte. O PIN é uma trava leve.
   ============================================================ */
const ProfileManager = {
  DEFAULT_AVATARS: ['📘', '🎯', '⚖️', '📊', '🧠', '🚀', '🦉', '📚', '✏️', '🏆', '💡', '🔥'],
  DEFAULT_COLORS: ['#4f46e5', '#0f9d63', '#d97a12', '#e0393f', '#0a95a8', '#b3308a', '#5b6270', '#c9a20a'],

  /* ── A LISTA DE PERFIS É UM ÍNDICE, E ÍNDICE NÃO TEM LINHA REPETIDA ──────
     Ela crescia por seis caminhos (criar, importar, reanexar, espelhar da
     nuvem, readotar órfão, migrar id antigo) e nenhum deles era o dono da
     invariante: `saveProfiles` gravava o array como viesse. Bastava um deles
     escapar — a nuvem devolvendo a MESMA linha duas vezes é o mais fácil, e
     não depende de bug nenhum aqui — para a tela de acesso mostrar dois cards
     idênticos, com o mesmo nome, o mesmo avatar e o mesmo id. Do lado de fora
     parece que o app "criou um perfil do nada"; por dentro é a mesma pessoa
     listada duas vezes, e clicar em qualquer um dos dois abre o mesmo diário.

     Pior que confundir: quem vê um duplicado tende a apagar "o repetido" — e
     `deleteProfile` filtra por id, então apaga os DOIS, levando junto o dado
     que ele queria manter.

     A regra passa a morar aqui, no único ponto de escrita, e também na
     leitura — para uma lista já suja no aparelho aparecer limpa antes mesmo
     da próxima gravação. Vence a PRIMEIRA ocorrência (em
     `daNuvem.concat(sobreviventes)` a nuvem vem primeiro, e é ela quem manda),
     completada pelos campos que só as seguintes tiverem. */
  _sanearPerfis(list) {
    const vistos = Object.create(null);
    const out = [];
    (Array.isArray(list) ? list : []).forEach(p => {
      if (!p || typeof p !== 'object') return;
      const id = p.id == null ? '' : String(p.id).trim();
      if (!id) return;                                   // sem id não há perfil
      const ja = vistos[id];
      if (ja) {                                          // duplicado: completa o que falta
        Object.keys(p).forEach(k => {
          if (ja[k] == null || ja[k] === '') { if (p[k] != null && p[k] !== '') ja[k] = p[k]; }
        });
        return;
      }
      const copia = Object.assign({}, p, { id });
      vistos[id] = copia; out.push(copia);
    });
    return out;
  },
  getProfiles() { return this._sanearPerfis(DB._get(DB.PROFILES_KEY, [])); },
  saveProfiles(list) { DB._set(DB.PROFILES_KEY, this._sanearPerfis(list)); },
  getActiveProfileId() { try { return localStorage.getItem(DB.ACTIVE_PROFILE_KEY); } catch (e) { return null; } },
  getActiveProfile() { return this.getProfiles().find(p => p.id === this.getActiveProfileId()) || null; },
  setActiveProfile(id) {
    localStorage.setItem(DB.ACTIVE_PROFILE_KEY, id);
    // Trocar de perfil troca o dono do histórico: a lista viva não atravessa.
    try { DB.invalidarRevlogMemoria(); } catch (e) { _quiet(e, 'perfil-revlog-mem'); }
    /* A assinatura Realtime de seções depende do perfil ativo. Centralizar o
       aviso aqui evita deixar um canal antigo ouvindo o perfil anterior. */
    try {
      if (window.CloudStore && CloudStore.onActiveProfileChanged) {
        CloudStore.onActiveProfileChanged(id);
      }
    } catch (e) { _quiet(e, 'perfil-canal-secoes'); }
  },

  // hash simples (NÃO é segurança forte — apenas evita guardar o PIN em texto puro)
  _hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(36);
  },
  setPin(id, pin) {
    const list = this.getProfiles();
    const p = list.find(x => x.id === id);
    if (p) p.pinHash = pin ? this._hash(pin) : null;
    this.saveProfiles(list);
  },
  hasPin(id) { const p = this.getProfiles().find(x => x.id === id); return !!(p && p.pinHash); },
  checkPin(id, pin) {
    const p = this.getProfiles().find(x => x.id === id);
    if (!p || !p.pinHash) return true;
    return this._hash(pin) === p.pinHash;
  },

  createProfile({ nome, avatar, cor, pin }) {
    /* Helper de projeção em RAM. A persistência real de perfis é criada por
       CloudStore.createRow(), que recebe o UUID definitivo do PostgreSQL. */
    const id = DB._uid();
    const list = this.getProfiles();
    list.push({
      id, nome: (nome || 'Novo perfil').trim(),
      avatar: avatar || this.DEFAULT_AVATARS[list.length % this.DEFAULT_AVATARS.length],
      cor: cor || this.DEFAULT_COLORS[list.length % this.DEFAULT_COLORS.length],
      pinHash: pin ? this._hash(pin) : null,
      createdAt: new Date().toISOString()
    });
    this.saveProfiles(list);
    return id;
  },
  updateProfile(id, patch) {
    const list = this.getProfiles();
    const p = list.find(x => x.id === id);
    if (p) Object.assign(p, patch);
    this.saveProfiles(list);
  },
  renameProfile(id, nome) { this.updateProfile(id, { nome: (nome || '').trim() }); },
  // ---- Helpers usados pela reconciliação com o índice da nuvem ----
  // Inserem/atualizam/removem perfis SEM disparar novo push (o guard CloudStore._applying cuida disso)
  _insertRaw({ id, nome, avatar, cor }) {
    const list = this.getProfiles();
    if (list.find(p => p.id === id)) return;
    list.push({ id, nome: nome || 'Perfil', avatar: avatar || '📘', cor: cor || '#4f46e5', pinHash: null, createdAt: new Date().toISOString() });
    this.saveProfiles(list);
  },
  updateProfileSilent(id, patch) { this.updateProfile(id, patch); },
  _removeRaw(id) {
    const prefix = 'diario-estudos:u:' + id + ':';
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) toRemove.push(k); }
    toRemove.forEach(k => localStorage.removeItem(k));
    this.saveProfiles(this.getProfiles().filter(p => p.id !== id));
  },
  deleteProfile(id) {
    // apaga TODOS os dados namespaced desse perfil
    const prefix = 'diario-estudos:u:' + id + ':';
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(prefix)) toRemove.push(k); }
    toRemove.forEach(k => localStorage.removeItem(k));
    const list = this.getProfiles().filter(p => p.id !== id);
    this.saveProfiles(list);
    if (this.getActiveProfileId() === id) {
      this.setActiveProfile(list[0] ? list[0].id : this._ensureDefault());
    }
  },
  _ensureDefault() {
    const id = this.createProfile({ nome: 'Meu perfil', avatar: '📘', cor: '#4f46e5' });
    this.setActiveProfile(id);
    return id;
  },
  // Estatísticas rápidas de um perfil (para os cards da tela de acesso)
  statsForProfile(id) {
    const prefix = 'diario-estudos:u:' + id + ':';
    const plans = DB._get(prefix + 'planejamentos', []);
    let entries = 0;
    // conta registros de TODOS os planejamentos do perfil, varrendo as chaves de entries
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix + 'p:') && k.endsWith(':entries')) entries += DB._get(k, []).length;
    }
    return { planos: plans.length, registros: entries };
  },

  // Versão do formato de backup (para validar/importar arquivos)
  EXPORT_VERSION: 1,
  // Exporta um perfil completo: metadados + TODAS as chaves namespaced dele.
  exportProfile(id) {
    const meta = this.getProfiles().find(p => p.id === id);
    if (!meta) return null;
    const prefix = 'diario-estudos:u:' + id + ':';
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const sub = k.slice(prefix.length);
      if (sub.indexOf(Lixeira.PREFIXO) === 0) continue;   // lixeira técnica não entra no arquivo exportado
      data[sub] = localStorage.getItem(k);
    }
    // não exporta o PIN (backup não deve carregar credencial); o usuário redefine se quiser
    const metaOut = { nome: meta.nome, avatar: meta.avatar, cor: meta.cor };
    return {
      app: 'diario-estudos',
      kind: 'profile-backup',
      version: this.EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      profile: metaOut,
      data
    };
  },
  // Valida a estrutura de um arquivo importado
  validateBackup(obj) {
    return obj && obj.app === 'diario-estudos' && obj.kind === 'profile-backup'
      && obj.profile && typeof obj.data === 'object';
  },
  // Importa um backup como um NOVO perfil (id novo, para nunca sobrescrever nada).
  importProfile(obj, overrideName) {
    if (!this.validateBackup(obj)) throw new Error('Arquivo de backup inválido ou de outro app.');
    const nome = (overrideName || obj.profile.nome || 'Perfil importado').trim();
    const id = this.createProfile({
      nome,
      avatar: obj.profile.avatar || '📘',
      cor: obj.profile.cor || '#4f46e5'
      // sem PIN: perfil importado entra sem trava; o usuário define depois se quiser
    });
    const prefix = 'diario-estudos:u:' + id + ':';
    let saneados = 0;
    Object.keys(obj.data || {}).forEach(subKey => {
      // ignora eventuais chaves de perfil aninhadas por segurança
      if (subKey.startsWith('u:')) return;
      let valor = obj.data[subKey];
      // Um backup pode vir de fora (colega, grupo de estudos, download). Os cards
      // são o único conteúdo renderizado como HTML, então passam pelo saneamento
      // ANTES de tocar o localStorage — este caminho não usa DB.addCard.
      if (/(^|:)cards$/.test(subKey)) {
        try {
          const arr = JSON.parse(valor);
          if (Array.isArray(arr)) {
            arr.forEach(c => {
              if (!c || typeof c !== 'object') return;
              const f = _sanCard(c.frente), v = _sanCard(c.verso);
              if (f !== (c.frente || '') || v !== (c.verso || '')) saneados++;
              c.frente = f; c.verso = v;
            });
            valor = JSON.stringify(arr);
          }
        } catch (_) { /* chave ilegível: entra como veio, e falhará na leitura normal */ }
      }
      localStorage.setItem(prefix + subKey, valor);
    });
    /* O histórico de revisões vive em RAM (ver o bloco do revlog em 11-db.js).
       Este caminho grava as chaves CRUAS, sem passar por DB._set, então a
       projeção em memória precisa ser descartada à mão — senão o perfil
       importado continuaria mostrando o histórico do perfil anterior. */
    try { DB.invalidarRevlogMemoria(); } catch (e) { _quiet(e, 'import-revlog-mem'); }
    if (saneados) {
      try { showToast('⚠ ' + saneados + ' card(is) do backup tinham conteúdo suspeito e foram limpos na importação.'); } catch (_) { _quiet(_); }
      console.warn('[importProfile] cards saneados:', saneados);
    }
    return id;
  },

  // ---- Cloud-first: o banco é a fonte da verdade; o "espelho" local é só cache ----
  initMirror() {
    if (!Array.isArray(this.getProfiles())) this.saveProfiles([]);
  },
  // revisão conhecida (localmente) do perfil na nuvem — base do optimistic locking
  // adiciona/atualiza uma entrada no espelho local (sem tocar nos dados do perfil)
  addMirror({ id, nome, avatar, cor }) {
    const list = this.getProfiles();
    const ex = list.find(p => p.id === id);
    if (ex) { ex.nome = nome; ex.avatar = avatar; ex.cor = cor; }
    else list.push({ id, nome: nome || 'Perfil', avatar: avatar || '📘', cor: cor || '#4f46e5', createdAt: new Date().toISOString() });
    this.saveProfiles(list);
  },
  syncMirrorFromCloud(rows) {
    const daNuvem = (rows || []).map(r => ({
      id: r.id,
      nome: r.profile_name,
      avatar: r.avatar,
      cor: r.color,
      createdAt: r.created_at || ''
    }));
    this.saveProfiles(daNuvem);
    const ativo = this.getActiveProfileId();
    if (ativo && !daNuvem.some(p => p.id === ativo)) {
      try { localStorage.removeItem(DB.ACTIVE_PROFILE_KEY); } catch (e) { _quiet(e, 'perfil-ativo-obsoleto'); }
    }
  },

};

// Perfis PRIMEIRO (define o namespace), depois os planejamentos do perfil ativo.
// Modelo cloud-first: os perfis vêm do banco (study_profiles). No load só garantimos
// que o "espelho" local exista; o plano padrão é semeado ao ENTRAR num perfil.
ProfileManager.initMirror();
// Expõe o ProfileManager no window para os módulos carregados depois dele.
window.ProfileManager = ProfileManager;
