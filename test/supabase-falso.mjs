/* ═══════════════════════════════════════════════════════════════════════════
   SUPABASE FALSO — um PostgREST de mentira, com as regras de verdade
   ───────────────────────────────────────────────────────────────────────────
   POR QUE ISTO EXISTE

   Todo o caminho da nuvem — enviar, baixar, resolver conflito de revisão,
   criar backup, aplicar a retenção, RESTAURAR — era verificado por leitura e
   por testes com dublês. Nunca contra um servidor. E leitura não basta: o
   service worker também tinha sido lido linha a linha e considerado correto,
   e bastou executá-lo num navegador de verdade para aparecer uma troca de
   versão que levava 24 segundos.

   Este módulo é a outra metade. Ele implementa o subconjunto do PostgREST que
   o app usa, com as CONSTRAINTS QUE IMPORTAM — as mesmas que estão no banco
   real e que o app confia que existem:

     · trava otimista por `rev`: um UPDATE filtrado por `rev=eq.N` não acerta
       linha nenhuma se outro aparelho já subiu — é assim que o conflito nasce;
     · índice único parcial em profile_backups: no máximo uma foto-âncora por
       perfil, e a segunda tentativa recebe 23505;
     · unicidade de (profile_id, section) e de user_id em active_sessions;
     · isolamento por dono (RLS): uma conta não enxerga linha de outra, e as
       seções herdam o dono pelo perfil a que pertencem.

   O cliente NÃO é falso: o teste carrega o supabase-js de verdade (o pacote
   do npm bate byte a byte com o do CDN — o mesmo hash de integridade), então
   o que roda contra este servidor é a biblioteca real, com o mesmo builder de
   consultas, o mesmo tratamento de erro e o mesmo formato de resposta.
   ═══════════════════════════════════════════════════════════════════════════ */

const AGORA = () => new Date().toISOString();

function uuid() {
  const h = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

// Um JWT com forma válida (cabeçalho.corpo.assinatura). Não é assinado de
// verdade — aqui ninguém verifica assinatura —, mas precisa DECODIFICAR, porque
// a biblioteca de autenticação lê o corpo para saber quando expira.
function jwt(sub, email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' +
         b64({ sub, email, role: 'authenticated', exp, iat: Math.floor(Date.now() / 1000) }) +
         '.assinatura-de-teste';
}

/* ── Interpretação dos filtros do PostgREST ────────────────────────────────
   `id=eq.123`, `section=in.(a,b)`, `created_at=gte.2026-01-01`. O valor vem
   sempre como texto na URL; a comparação é feita por texto dos dois lados para
   não inventar coerção que o Postgres não faria do mesmo jeito. */
function comparar(op, valorDaLinha, alvo) {
  const t = (v) => (v === null || v === undefined ? '' : String(v));
  switch (op) {
    case 'eq': return t(valorDaLinha) === t(alvo);
    case 'neq': return t(valorDaLinha) !== t(alvo);
    case 'gte': return t(valorDaLinha) >= t(alvo);
    case 'gt': return t(valorDaLinha) > t(alvo);
    case 'lte': return t(valorDaLinha) <= t(alvo);
    case 'lt': return t(valorDaLinha) < t(alvo);
    case 'in': {
      const lista = String(alvo).replace(/^\(|\)$/g, '').split(',')
        .map((x) => x.replace(/^"|"$/g, ''));
      return lista.some((x) => t(valorDaLinha) === t(x));
    }
    default: return true;
  }
}

const RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function extrairFiltros(params) {
  const fs = [];
  for (const [chave, bruto] of params) {
    if (RESERVADOS.has(chave)) continue;
    const m = String(bruto).match(/^([a-z]+)\.([\s\S]*)$/);
    if (!m) continue;
    fs.push({ col: chave, op: m[1], alvo: m[2] });
  }
  return fs;
}

function projetar(linha, select) {
  if (!select || select === '*') return { ...linha };
  const out = {};
  select.split(',').map((s) => s.trim()).forEach((c) => { if (c) out[c] = linha[c]; });
  return out;
}

export function montarApiFalsa() {
  const contas = new Map();      // email -> { id, email, senha }
  const tokens = new Map();      // access_token -> user_id
  const tabelas = {
    study_profiles: [],
    profile_sections: [],             // legado: mantido só para provar que não recebe novas escritas
    profile_backups: [],
    active_sessions: [],
    user_preferences: [],
    study_plans: [],
    study_profile_settings: [],
    study_plan_state: [],
    study_subjects: [],
    study_methods: [],
    study_phases: [],
    study_statuses: [],
    study_modes: [],
    study_entries: [],
    study_decks: [],
    study_cards: [],
    study_review_log: [],
    study_review_leases: [],
    study_laws: [],
    study_law_keywords: [],
    study_links: [],
    study_extras: [],
    study_custom_siglas: [],
    study_cycle_history: [],
    study_saved_grades: [],
    study_track_items: [],
    study_tec_snapshots: [],
    study_tec_snapshot_rows: [],
    study_incidence: [],
    study_change_log: []
  };
  const tombstones = new Map(); // profile_id\0section -> { deleted_rev, deleted_at }
  const estado = { tabelas, contas, tombstones, falhaForcada: null, pedidos: [] };

  function criarSessao(user) {
    const at = jwt(user.id, user.email);
    tokens.set(at, user.id);
    return {
      access_token: at, token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'refresh-' + user.id,
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated',
              created_at: AGORA(), app_metadata: {}, user_metadata: {} }
    };
  }

  function donoDoPedido(headers) {
    const auth = headers.authorization || headers.Authorization || '';
    const t = auth.replace(/^Bearer\s+/i, '');
    return tokens.get(t) || null;
  }

  /* O isolamento por dono, como as políticas do banco fazem: study_profiles,
     profile_backups e active_sessions têm user_id próprio; profile_sections
     herda o dono do perfil a que pertence. Sem isto, o teste de isolamento
     entre contas estaria testando o nada. */
  function visivel(tabela, linha, uid) {
    if (!uid) return false;
    if (tabela === 'study_profiles' || tabela === 'profile_backups' ||
        tabela === 'active_sessions' || tabela === 'user_preferences') {
      return linha.user_id === uid;
    }
    if (tabela === 'profile_sections' || tabela.startsWith('study_')) {
      const perfil = tabelas.study_profiles.find((p) => p.id === linha.profile_id);
      return !!perfil && perfil.user_id === uid;
    }
    return linha.user_id === uid;
  }

  const erro = (status, corpo) => ({ status, corpo });

  function checarUnicidade(tabela, nova, ignorar) {
    const outras = tabelas[tabela].filter((l) => l !== ignorar);
    if (tabela === 'profile_sections' &&
        outras.some((l) => l.profile_id === nova.profile_id && l.section === nova.section)) {
      return 'profile_sections_profile_id_section_key';
    }
    // índice único PARCIAL: no máximo uma âncora por perfil
    if (tabela === 'profile_backups' && nova.ancora === true &&
        outras.some((l) => l.profile_id === nova.profile_id && l.ancora === true)) {
      return 'profile_backups_ancora_unica';
    }
    if (tabela === 'active_sessions' && outras.some((l) => l.user_id === nova.user_id)) {
      return 'active_sessions_pkey';
    }
    if (tabela === 'study_review_log' && nova.review_id != null &&
        outras.some((l) => l.profile_id === nova.profile_id && l.plan_id === nova.plan_id &&
          l.review_id != null && String(l.review_id) === String(nova.review_id))) {
      return 'study_review_log_review_id_uidx';
    }
    if (tabela === 'study_review_leases' &&
        outras.some((l) => l.profile_id === nova.profile_id && l.plan_id === nova.plan_id)) {
      return 'study_review_leases_pkey';
    }
    return null;
  }

  function violacao(constraint) {
    return erro(409, { code: '23505', message: 'duplicate key value violates unique constraint "' + constraint + '"',
                       details: null, hint: null });
  }

  // ── RPC ──────────────────────────────────────────────────────────────────
  /* Em produção, a concorrência de profile_sections é decidida por funções SQL
     atômicas. O banco falso precisa reproduzir essa semântica; caso contrário
     um teste de ponta a ponta estaria validando um protocolo diferente do real. */
  function rpc(metodo, url, headers, corpo) {
    if (metodo !== 'POST') return erro(405, { code: '405', message: 'RPC exige POST' });
    const uid = donoDoPedido(headers);
    if (!uid) return erro(401, { code: '401', message: 'sem sessão' });
    const nome = url.pathname.replace(/^\/rest\/v1\/rpc\//, '').split('/')[0];
    const a = corpo || {};
    const perfil = tabelas.study_profiles.find((p) => p.id === a.p_profile_id);
    if (!perfil || perfil.user_id !== uid) {
      return erro(403, { code: '42501', message: 'profile not owned by current user' });
    }

    /* Leituras agrupadas do modelo relacional. Em produção são funções SQL
       SECURITY INVOKER: continuam obedecendo RLS, mas evitam dezenas de idas
       HTTP para reconstruir a projeção síncrona do app. */
    const rowsDoPerfil = (tabela) => (tabelas[tabela] || []).filter((x) => x.profile_id === a.p_profile_id);
    if (nome === 'read_study_profile_core') {
      return { status: 200, corpo: {
        profile: {
          id: perfil.id, profile_name: perfil.profile_name, avatar: perfil.avatar, color: perfil.color,
          pin_hash: perfil.pin_hash ?? null, active_plan_id: perfil.active_plan_id ?? null,
          created_at: perfil.created_at, updated_at: perfil.updated_at
        },
        plans: rowsDoPerfil('study_plans'),
        profileSettings: rowsDoPerfil('study_profile_settings'),
        planState: rowsDoPerfil('study_plan_state'),
        subjects: rowsDoPerfil('study_subjects'),
        methods: rowsDoPerfil('study_methods'),
        phases: rowsDoPerfil('study_phases'),
        statuses: rowsDoPerfil('study_statuses'),
        modes: rowsDoPerfil('study_modes'),
        entries: rowsDoPerfil('study_entries'),
        decks: rowsDoPerfil('study_decks'),
        cards: rowsDoPerfil('study_cards'),
        revlog: rowsDoPerfil('study_review_log'),
        laws: rowsDoPerfil('study_laws'),
        lawKeywords: rowsDoPerfil('study_law_keywords'),
        links: rowsDoPerfil('study_links'),
        extras: rowsDoPerfil('study_extras'),
        siglas: rowsDoPerfil('study_custom_siglas'),
        cycles: rowsDoPerfil('study_cycle_history'),
        savedGrades: rowsDoPerfil('study_saved_grades'),
        tracks: rowsDoPerfil('study_track_items')
      }};
    }
    if (nome === 'read_study_profile_heavy') {
      return { status: 200, corpo: {
        tecSnapshots: rowsDoPerfil('study_tec_snapshots'),
        tecRows: rowsDoPerfil('study_tec_snapshot_rows'),
        incidence: rowsDoPerfil('study_incidence')
      }};
    }
    if (nome === 'read_study_change_summary') {
      const after = Number(a.p_after_change_id) || 0;
      const rows = rowsDoPerfil('study_change_log').filter((x) => Number(x.change_id) > after);
      const max = rows.reduce((m, x) => Math.max(m, Number(x.change_id) || 0), after);
      return { status: 200, corpo: {
        count: rows.length,
        max_change_id: max,
        tables: [...new Set(rows.map((x) => x.table_name).filter(Boolean))]
      }};
    }

    if (nome === 'claim_study_review_lease') {
      const now = Date.now(), ttl = Math.max(60, Math.min(Number(a.p_ttl_seconds) || 600, 1800)) * 1000;
      let lease = tabelas.study_review_leases.find((x) =>
        x.profile_id === a.p_profile_id && String(x.plan_id) === String(a.p_plan_id));
      if (!lease) {
        lease = {
          profile_id:a.p_profile_id, plan_id:String(a.p_plan_id),
          holder_id:String(a.p_holder_id), lease_until:new Date(now + ttl).toISOString(), updated_at:AGORA()
        };
        tabelas.study_review_leases.push(lease);
      } else if (lease.holder_id === String(a.p_holder_id) || Date.parse(lease.lease_until) <= now) {
        lease.holder_id=String(a.p_holder_id);
        lease.lease_until=new Date(now + ttl).toISOString();
        lease.updated_at=AGORA();
      }
      return { status:200, corpo:{
        acquired:lease.holder_id===String(a.p_holder_id) && Date.parse(lease.lease_until)>now,
        holder_id:lease.holder_id, lease_until:lease.lease_until
      }};
    }

    if (nome === 'release_study_review_lease') {
      const antes=tabelas.study_review_leases.length;
      tabelas.study_review_leases=tabelas.study_review_leases.filter((x) =>
        !(x.profile_id===a.p_profile_id && String(x.plan_id)===String(a.p_plan_id) &&
          x.holder_id===String(a.p_holder_id)));
      estado.tabelas.study_review_leases=tabelas.study_review_leases;
      return { status:200, corpo:tabelas.study_review_leases.length < antes };
    }

    const key = String(a.p_profile_id) + '\0' + String(a.p_section);
    const achar = () => tabelas.profile_sections.find((l) =>
      l.profile_id === a.p_profile_id && l.section === a.p_section);

    if (nome === 'write_profile_section_cas') {
      const expected = Number(a.p_expected_rev) || 0;
      const ts = tombstones.get(key) || null;
      let atual = achar();

      if (expected === 0) {
        if (ts) {
          return { status: 200, corpo: {
            ok: false, conflict: true, reason: 'deleted', remote_rev: ts.deleted_rev
          }};
        }
        if (atual) return { status: 200, corpo: { ok: false, conflict: true, reason: 'exists' } };
        atual = {
          profile_id: a.p_profile_id,
          section: a.p_section,
          data: a.p_data,
          rev: 1,
          updated_at: AGORA(),
          content_hash: a.p_new_hash,
          mutation_id: a.p_mutation_id,
          device_id: a.p_device_id
        };
        tabelas.profile_sections.push(atual);
        return { status: 200, corpo: { ok: true, rev: 1, content_hash: atual.content_hash } };
      }

      if (!atual) {
        if (ts) {
          return { status: 200, corpo: {
            ok: false, conflict: true, reason: 'deleted', remote_rev: ts.deleted_rev
          }};
        }
        return { status: 200, corpo: {
          ok: false, conflict: true, reason: 'base-mismatch', remote_rev: null, remote_hash: null
        }};
      }
      const hashBaseOk = atual.content_hash == null || atual.content_hash === a.p_expected_hash;
      if (Number(atual.rev) !== expected || !hashBaseOk) {
        return { status: 200, corpo: {
          ok: false, conflict: true, reason: 'base-mismatch',
          remote_rev: atual.rev, remote_hash: atual.content_hash ?? null
        }};
      }

      atual.data = a.p_data;
      atual.rev = Number(atual.rev) + 1;
      atual.updated_at = AGORA();
      atual.content_hash = a.p_new_hash;
      atual.mutation_id = a.p_mutation_id;
      atual.device_id = a.p_device_id;
      return { status: 200, corpo: {
        ok: true, rev: atual.rev, content_hash: atual.content_hash
      }};
    }

    if (nome === 'delete_profile_section_cas') {
      const expected = Number(a.p_expected_rev) || 0;
      const atual = achar();
      if (!atual || expected < 1 || Number(atual.rev) !== expected) {
        return { status: 200, corpo: false };
      }
      tombstones.set(key, {
        deleted_rev: expected + 1,
        deleted_at: AGORA()
      });
      tabelas.profile_sections = tabelas.profile_sections.filter((l) => l !== atual);
      estado.tabelas.profile_sections = tabelas.profile_sections;
      return { status: 200, corpo: true };
    }


    const chavePorTabela = {
      study_subjects:'subject_id', study_methods:'method_id', study_phases:'phase_id',
      study_statuses:'status_id', study_modes:'mode_id', study_entries:'entry_id',
      study_decks:'deck_id', study_cards:'card_id', study_laws:'law_id',
      study_links:'link_id', study_custom_siglas:'sigla_id',
      study_cycle_history:'cycle_id', study_saved_grades:'grade_id'
    };
    const perfilEhDoUsuario = (pid) => {
      const p = tabelas.study_profiles.find((x) => x.id === pid);
      return !!p && p.user_id === uid;
    };
    const substituirPlano = (tabela, pid, planId, rows) => {
      if (!tabelas[tabela]) throw new Error('tabela relacional desconhecida: ' + tabela);
      tabelas[tabela] = tabelas[tabela].filter((x) => !(x.profile_id === pid && x.plan_id === planId));
      estado.tabelas[tabela] = tabelas[tabela];
      for (const row of (Array.isArray(rows) ? rows : [])) tabelas[tabela].push({ ...row });
      return Array.isArray(rows) ? rows.length : 0;
    };

    if (nome === 'mutate_study_plan_rows') {
      const tabela = a.p_table, pid = a.p_profile_id, planId = a.p_plan_id;
      const keyCol = chavePorTabela[tabela];
      if (!keyCol || !perfilEhDoUsuario(pid)) return erro(403, { code:'42501', message:'profile not owned by current user' });
      const removidos = new Set((a.p_delete_ids || []).map(String));
      tabelas[tabela] = tabelas[tabela].filter((x) =>
        !(x.profile_id === pid && x.plan_id === planId && removidos.has(String(x[keyCol]))));
      estado.tabelas[tabela] = tabelas[tabela];
      let n = 0;
      for (const row of (a.p_rows || [])) {
        if (row.profile_id !== pid || row.plan_id !== planId) return erro(400,{code:'22000',message:'row_scope_mismatch'});
        const atual = tabelas[tabela].find((x) =>
          x.profile_id === pid && x.plan_id === planId && String(x[keyCol]) === String(row[keyCol]));
        if (atual) Object.assign(atual,row); else tabelas[tabela].push({ ...row });
        n++;
      }
      return { status:200, corpo:n };
    }

    if (nome === 'replace_study_plan_rows') {
      if (!perfilEhDoUsuario(a.p_profile_id)) return erro(403,{code:'42501',message:'profile not owned by current user'});
      return { status:200, corpo:substituirPlano(a.p_table,a.p_profile_id,a.p_plan_id,a.p_rows || []) };
    }

    if (nome === 'replace_study_cards') {
      if (!perfilEhDoUsuario(a.p_profile_id)) return erro(403,{code:'42501',message:'profile not owned by current user'});
      return { status:200, corpo:substituirPlano('study_cards',a.p_profile_id,a.p_plan_id,a.p_rows || []) };
    }

    if (nome === 'replace_study_tec') {
      if (!perfilEhDoUsuario(a.p_profile_id)) return erro(403,{code:'42501',message:'profile not owned by current user'});
      const ns = substituirPlano('study_tec_snapshots',a.p_profile_id,a.p_plan_id,a.p_snapshots || []);
      const nr = substituirPlano('study_tec_snapshot_rows',a.p_profile_id,a.p_plan_id,a.p_rows || []);
      return { status:200, corpo:{snapshots:ns,rows:nr} };
    }

    if (nome === 'mutate_study_plans') {
      const pid = a.p_profile_id;
      if (!perfilEhDoUsuario(pid)) return erro(403,{code:'42501',message:'profile not owned by current user'});
      const rows = Array.isArray(a.p_rows) ? a.p_rows : [];
      const ids = new Set(rows.map((x)=>String(x.plan_id)));
      tabelas.study_plans = tabelas.study_plans.filter((x) =>
        x.profile_id !== pid || x.legacy_orphan === true || ids.has(String(x.plan_id)));
      estado.tabelas.study_plans = tabelas.study_plans;
      for (const row of rows) {
        const atual=tabelas.study_plans.find((x)=>x.profile_id===pid&&String(x.plan_id)===String(row.plan_id));
        if (atual) Object.assign(atual,row); else tabelas.study_plans.push({ ...row });
      }
      return { status:200, corpo:rows.length };
    }

    return erro(404, { code: 'PGRST202', message: 'Could not find the function public.' + nome });
  }

  // ── REST ─────────────────────────────────────────────────────────────────
  function rest(metodo, url, headers, corpo) {
    const partes = url.pathname.replace(/^\/rest\/v1\/?/, '').split('/');
    const tabela = partes[0];
    if (!tabelas[tabela]) {
      // é assim que o app descobre que a tabela de backup não foi criada
      return erro(404, { code: '42P01', message: 'relation "public.' + tabela + '" does not exist' });
    }
    const uid = donoDoPedido(headers);
    if (!uid) return erro(401, { code: '401', message: 'sem sessão' });

    const params = url.searchParams;
    const select = params.get('select');
    const filtros = extrairFiltros(params);
    const prefer = String(headers.prefer || headers.Prefer || '');
    const querObjeto = String(headers.accept || headers.Accept || '').includes('pgrst.object');
    const querRetorno = /return=representation/.test(prefer);

    const casa = (l) => visivel(tabela, l, uid) && filtros.every((f) => comparar(f.op, l[f.col], f.alvo));

    if (metodo === 'GET') {
      let linhas = tabelas[tabela].filter(casa);
      const ordem = params.get('order');
      if (ordem) {
        const [col, dir] = ordem.split('.');
        linhas = [...linhas].sort((a, b) => {
          const x = String(a[col] ?? ''), y = String(b[col] ?? '');
          return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
        });
      }
      const lim = parseInt(params.get('limit') || '0', 10);
      if (lim > 0) linhas = linhas.slice(0, lim);
      const saida = linhas.map((l) => projetar(l, select));
      if (querObjeto) {
        if (saida.length !== 1) {
          return erro(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned',
                             details: `Results contain ${saida.length} rows`, hint: null });
        }
        return { status: 200, corpo: saida[0] };
      }
      return { status: 200, corpo: saida };
    }

    if (metodo === 'POST') {
      const entradas = Array.isArray(corpo) ? corpo : [corpo];
      const mesclar = /resolution=merge-duplicates/.test(prefer);
      const chaves = (params.get('on_conflict') || '').split(',').filter(Boolean);
      const gravadas = [];
      for (const bruta of entradas) {
        const nova = { ...bruta };
        const diretoPorUsuario = tabela === 'study_profiles' || tabela === 'profile_backups' ||
          tabela === 'active_sessions' || tabela === 'user_preferences';
        if (diretoPorUsuario) {
          if (nova.user_id && nova.user_id !== uid) {
            return erro(403, { code: '42501', message: 'new row violates row-level security policy' });
          }
          if (!nova.user_id) nova.user_id = uid;
        } else if (tabela === 'profile_sections' || tabela.startsWith('study_')) {
          const perfil = tabelas.study_profiles.find((p) => p.id === nova.profile_id);
          if (!perfil || perfil.user_id !== uid) {
            return erro(403, { code: '42501', message: 'new row violates row-level security policy' });
          }
        }
        if (!nova.id) nova.id = uuid();
        if (!nova.created_at) nova.created_at = AGORA();
        if (!nova.updated_at) nova.updated_at = nova.created_at;

        let existente = null;
        if (mesclar && chaves.length) {
          existente = tabelas[tabela].find((l) => chaves.every((k) => String(l[k]) === String(nova[k])));
        }
        if (existente) {
          Object.assign(existente, nova, { id: existente.id, created_at: existente.created_at });
          gravadas.push(existente);
        } else {
          const c = checarUnicidade(tabela, nova, null);
          if (c) return violacao(c);
          tabelas[tabela].push(nova);
          gravadas.push(nova);
        }
      }
      const saida = gravadas.map((l) => projetar(l, select));
      if (querObjeto) {
        if (saida.length !== 1) {
          return erro(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        }
        return { status: 201, corpo: saida[0] };
      }
      return { status: 201, corpo: querRetorno ? saida : null };
    }

    if (metodo === 'PATCH') {
      /* Aqui mora a trava otimista. O app manda `.eq('id',id).eq('rev',rev)`:
         se outro aparelho já subiu, `rev` mudou, NENHUMA linha casa, e a
         resposta volta vazia — que é exatamente como o app detecta conflito.
         Nada de especial precisa ser feito: a semântica cai do filtro. */
      const alvos = tabelas[tabela].filter(casa);
      alvos.forEach((l) => Object.assign(l, corpo));
      const saida = alvos.map((l) => projetar(l, select));
      if (querObjeto) {
        if (saida.length !== 1) return erro(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return { status: 200, corpo: saida[0] };
      }
      return { status: 200, corpo: querRetorno ? saida : [] };
    }

    if (metodo === 'DELETE') {
      const alvos = new Set(tabelas[tabela].filter(casa));
      const saida = [...alvos].map((l) => projetar(l, select));
      tabelas[tabela] = tabelas[tabela].filter((l) => !alvos.has(l));
      return { status: 200, corpo: querRetorno ? saida : [] };
    }

    return erro(405, { code: '405', message: 'método não suportado' });
  }

  // ── AUTH ─────────────────────────────────────────────────────────────────
  function auth(metodo, url, headers, corpo) {
    const rota = url.pathname.replace(/^\/auth\/v1\/?/, '');
    if (rota === 'signup') {
      const { email, password } = corpo || {};
      if (contas.has(email)) return erro(400, { error: 'user_already_exists', error_description: 'já existe', message: 'User already registered' });
      const user = { id: uuid(), email, senha: password };
      contas.set(email, user);
      return { status: 200, corpo: criarSessao(user) };
    }
    if (rota === 'token') {
      const tipo = url.searchParams.get('grant_type');
      if (tipo === 'refresh_token') {
        const uidAlvo = String((corpo && corpo.refresh_token) || '').replace(/^refresh-/, '');
        const user = [...contas.values()].find((c) => c.id === uidAlvo);
        if (!user) return erro(400, { error: 'invalid_grant', message: 'Invalid Refresh Token' });
        return { status: 200, corpo: criarSessao(user) };
      }
      const { email, password } = corpo || {};
      const user = contas.get(email);
      if (!user || user.senha !== password) {
        return erro(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', message: 'Invalid login credentials' });
      }
      return { status: 200, corpo: criarSessao(user) };
    }
    if (rota === 'logout') { return { status: 204, corpo: null }; }
    if (rota === 'user') {
      const uid = donoDoPedido(headers);
      const user = [...contas.values()].find((c) => c.id === uid);
      if (!user) return erro(401, { message: 'sem sessão' });
      if (metodo === 'PUT' && corpo && corpo.password) user.senha = corpo.password;
      return { status: 200, corpo: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } };
    }
    if (rota === 'recover') return { status: 200, corpo: {} };
    return erro(404, { message: 'rota de autenticação desconhecida: ' + rota });
  }

  /* Ponto único de entrada, para ser pendurado no servidor estático que o
     verificar.mjs já tem. Devolve `false` quando a URL não é da API — assim o
     servidor segue servindo arquivos normalmente. */
  function tratar(req, res, corpoTexto) {
    const url = new URL(req.url, 'http://interno');
    if (!/^\/(rest|auth)\/v1\//.test(url.pathname)) return false;

    let corpo = null;
    if (corpoTexto) { try { corpo = JSON.parse(corpoTexto); } catch (_) { corpo = null; } }
    estado.pedidos.push({ metodo: req.method, caminho: url.pathname + url.search });

    let r;
    try {
      /* `falhaForcada` devolve `true` para a falha genérica (500) ou um objeto
         `{ status, corpo }` para encenar uma resposta específica — é assim que
         um teste reproduz o `JWT issued at future`, que não é erro de tabela
         nem de rede, e sim o validador recusando um token bom cedo demais. */
      const forcada = estado.falhaForcada && estado.falhaForcada(req, url);
      if (forcada) {
        r = (forcada && typeof forcada === 'object')
          ? erro(forcada.status || 500, forcada.corpo || { code: 'XX000', message: 'falha forçada pelo teste' })
          : erro(500, { code: 'XX000', message: 'falha forçada pelo teste' });
      } else {
        r = url.pathname.startsWith('/rest/v1/rpc/')
          ? rpc(req.method, url, req.headers, corpo)
          : (url.pathname.startsWith('/rest/v1/')
            ? rest(req.method, url, req.headers, corpo)
            : auth(req.method, url, req.headers, corpo));
      }
    } catch (e) {
      r = erro(500, { code: 'XX000', message: 'erro no servidor falso: ' + e.message });
    }

    const texto = r.corpo === null || r.corpo === undefined ? '' : JSON.stringify(r.corpo);
    res.writeHead(r.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Range': '*/*'
    });
    res.end(texto);
    return true;
  }

  return { tratar, estado, criarConta: (email, senha) => {
    const user = { id: uuid(), email, senha };
    contas.set(email, user);
    return user;
  } };
}
