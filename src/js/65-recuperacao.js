/* ============================================================
   RECUPERAÇÃO DE DADOS — o vasculhador do aparelho
   ------------------------------------------------------------
   Existe porque um dado pode ficar INVISÍVEL sem estar perdido, e as duas
   situações se parecem na tela: você abre o app e "sumiu tudo". Os caminhos
   conhecidos até aqui:

     · a seção foi APAGADA no aparelho (era o caso do download que tratava
       "não está na nuvem" como "foi excluída" — corrigido, e agora tudo o que
       é apagado passa pela LIXEIRA antes);
     · a seção existe, mas debaixo de um PLANEJAMENTO que não está mais na
       lista de planejamentos — o app não tem por onde chegar até ela;
     · a seção existe debaixo de um PERFIL que sumiu da lista de perfis;
     · o dado só existe dentro de uma foto do histórico de versões.

   Esta tela varre TODAS essas fontes, mostra o que encontrou com tamanho e
   data, e restaura. Ela nunca apaga nada: só copia de volta para onde o app
   sabe procurar. É de propósito uma ferramenta de LEITURA + RESTAURAÇÃO.
   ============================================================ */
const Recuperacao = {
  /* Rótulos legíveis das seções. O nome interno ("p:pl_x:cards") não diz nada
     a quem está com medo de ter perdido meses de estudo. */
  ROTULOS: {
    entries: 'registros de estudo', subjects: 'matérias', methods: 'formas de estudo',
    phases: 'fases', statuses: 'status do Estudo Novo', modes: 'modos de estudo',
    'current-cycle': 'ciclo da semana', 'cycle-history': 'histórico de semanas',
    tracks: 'trilhas do Estudo Novo', tec: 'retratos do TEC',
    'grade-template': 'grade semanal', 'saved-grades': 'grades salvas',
    'custom-siglas': 'siglas', leis: 'leis secas', 'lei-keywords': 'palavras-chave das leis',
    decks: 'baralhos', cards: 'cards', links: 'links', incidencia: 'incidência',
    'last-cycle-setup': 'última montagem de ciclo', extras: 'atividades extras',
    revlog: 'histórico de revisões', planejamentos: 'lista de planejamentos',
    'active-plan': 'planejamento ativo', ferramentas: 'ferramentas'
  },
  rotulo(sec) {
    const m = /^p:([^:]+):(.+)$/.exec(sec);
    const folha = m ? m[2] : sec;
    return this.ROTULOS[folha] || folha;
  },
  planoDe(sec) { const m = /^p:([^:]+):/.exec(sec); return m ? m[1] : null; },

  /* ── VARREDURA ────────────────────────────────────────────────────────────
     Percorre o armazenamento inteiro, não só o perfil ativo. Devolve, por
     perfil: as seções presentes, quais estão alcançáveis hoje e quais estão
     órfãs (planejamento fora da lista), mais a lixeira e as fotos. */
  varrer() {
    const perfis = {};
    const registrados = {};
    try { (ProfileManager.getProfiles() || []).forEach(p => { registrados[p.id] = p.nome || p.id; }); } catch (e) { _quiet(e, 'rec-perfis'); }
    const RE = /^diario-estudos:u:([^:]+):(.+)$/;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const m = RE.exec(k);
        if (!m) continue;
        const pid = m[1], sub = m[2];
        const p = perfis[pid] || (perfis[pid] = {
          id: pid, nome: registrados[pid] || null, naListaDePerfis: pid in registrados,
          secoes: [], lixo: [], fotos: 0, bytes: 0
        });
        const bytes = (localStorage.getItem(k) || '').length;
        p.bytes += bytes;
        if (sub.indexOf('vhist') === 0) continue;          // fotos são contadas à parte
        if (sub.indexOf(Lixeira.PREFIXO) === 0) {
          const item = Lixeira.ler(k);
          if (item) p.lixo.push(item);
          continue;
        }
        if (sub === '__secrev' || sub === '__secpend' || sub === '__secdel' || sub === '__entryops') continue;
        p.secoes.push({ chave: k, sec: sub, bytes });
      }
    } catch (e) { _quiet(e, 'rec-varrer'); }

    // Quais planejamentos cada perfil consegue ALCANÇAR hoje
    Object.values(perfis).forEach(p => {
      let planos = [];
      try { planos = (JSON.parse(localStorage.getItem('diario-estudos:u:' + p.id + ':planejamentos')) || []).map(x => x.id); }
      catch (e) { _quiet(e, 'rec-planos'); }
      p.planos = planos;
      p.secoes.forEach(s => {
        const plano = this.planoDe(s.sec);
        s.plano = plano;
        s.alcancavel = !plano || planos.indexOf(plano) !== -1;
      });
      p.orfas = p.secoes.filter(s => !s.alcancavel);
      p.fotos = this._contarFotos(p.id);
    });
    return Object.values(perfis).sort((a, b) => b.bytes - a.bytes);
  },
  /* As fotos NÃO moram no namespace do perfil — a chave é
     'diario-estudos:vhist:<id>'. Ler pela API do próprio BackupHistory evita
     que este módulo se desatualize se aquele formato mudar. */
  _fotosDe(pid) {
    try { return BackupHistory._list(pid) || []; } catch (e) { _quiet(e, 'rec-lista-fotos'); return []; }
  },
  _contarFotos(pid) { return this._fotosDe(pid).length; },
  /* Planejamentos que TÊM dados mas não estão na lista — a causa mais comum de
     "os registros aparecem mas o resto sumiu": o ponteiro se perdeu, os dados
     não. Reanexar é uma operação puramente aditiva. */
  /* Seções que TODO planejamento ganha de fábrica ao ser criado. Um "órfão"
     que só tem isto não guarda nada seu: é a sobra de uma semeadura que não
     virou planejamento nenhum. Reportá-lo como dado recuperável faz a tela
     gritar "⚠️ há dado recuperável" por causa de 617 bytes de lista padrão —
     e um alarme que dispara sem motivo é pior que nenhum alarme, porque ensina
     a ignorar o alarme de verdade. */
  SEMEADAS: ['methods', 'phases', 'modes', 'statuses'],
  _soTemSemente(g) {
    return g.folhas.length > 0 && g.folhas.every(f => this.SEMEADAS.indexOf(f) !== -1);
  },
  planosOrfaos(pid) {
    const alvo = pid || ProfileManager.getActiveProfileId();
    const perfil = this.varrer().find(p => p.id === alvo);
    if (!perfil) return [];
    const porPlano = {};
    perfil.orfas.forEach(s => {
      if (!s.plano) return;
      const g = porPlano[s.plano] || (porPlano[s.plano] = { id: s.plano, secoes: 0, bytes: 0, registros: 0, folhas: [] });
      g.secoes++; g.bytes += s.bytes;
      const m = /^p:[^:]+:(.+)$/.exec(s.sec);
      if (m) g.folhas.push(m[1]);
      if (/:entries$/.test(s.sec)) {
        try { g.registros = (JSON.parse(localStorage.getItem(s.chave)) || []).length; } catch (e) { _quiet(e, 'rec-conta'); }
      }
    });
    return Object.values(porPlano)
      .filter(g => !this._soTemSemente(g))
      .sort((a, b) => b.bytes - a.bytes);
  },
  /* ── CÓPIAS ANTIGAS DO NAVEGADOR ─────────────────────────────────────────
     O app atual usa RAM + PostgreSQL. Esta rotina existe apenas para recuperação
     manual de cópias deixadas por versões anteriores no localStorage nativo;
     esses dados nunca voltam a ser fonte operacional automaticamente. */
  varrerAntigo() {
    const nativo = window.__nativeLS;
    const out = [];
    if (!nativo) return out;
    try {
      for (let i = 0; i < nativo.length; i++) {
        const k = nativo.key(i);
        if (!k || k.indexOf('diario-estudos') !== 0) continue;
        if (localStorage.getItem(k) !== null) continue;   // já está no armazenamento atual
        const v = nativo.getItem(k) || '';
        if (v === '' || v === '[]' || v === '{}' || v === 'null') continue;
        out.push({ chave: k, bytes: v.length });
      }
    } catch (e) { _quiet(e, 'rec-antigo'); }
    return out.sort((a, b) => b.bytes - a.bytes);
  },
  /* Traz para o armazenamento atual o que ficou no antigo. Nunca sobrescreve:
     onde já existe valor, o atual manda. */
  adotarAntigo() {
    const achadas = this.varrerAntigo();
    let n = 0;
    achadas.forEach(it => {
      try {
        const v = window.__nativeLS.getItem(it.chave);
        if (v == null) return;
        if (localStorage.getItem(it.chave) !== null) return;
        if (DB.setRaw(it.chave, v) !== false) n++;
      } catch (e) { _quiet(e, 'rec-adotar'); }
    });
    return n;
  },
  /* Chaves sem namespace de perfil ("diario-estudos:entries" e irmãs), de antes
     de existirem perfis e planejamentos. O app só as consome numa migração que
     roda uma vez — se ela não rodou, o dado fica parado ali. */
  varrerLegado() {
    const out = [];
    try {
      Object.keys(DB.LEGACY_KEYS).forEach(nome => {
        const k = DB.LEGACY_KEYS[nome];
        const v = localStorage.getItem(k);
        if (v == null || v === '' || v === '[]' || v === '{}' || v === 'null') return;
        let itens = null;
        try { const o = JSON.parse(v); itens = Array.isArray(o) ? o.length : (o && typeof o === 'object' ? Object.keys(o).length : null); } catch (e) { _quiet(e, 'rec-legado-parse'); }
        out.push({ nome, chave: k, bytes: v.length, itens });
      });
    } catch (e) { _quiet(e, 'rec-legado'); }
    return out;
  },
  /* Devolve um PERFIL à lista de perfis. É a irmã de reanexarPlano um nível
     acima: o namespace do perfil está inteiro no aparelho, só o registro dele
     no índice se perdeu — e sem o registro não há como entrar nele. */
  reanexarPerfil(pid, nome) {
    const list = ProfileManager.getProfiles();
    if (list.some(p => p.id === pid)) return false;
    list.push({ id: pid, nome: nome || ProfileManager.rotuloRecuperado(pid),
      avatar: '🛟', cor: '#0a95a8', createdAt: new Date().toISOString(), soLocal: true });
    ProfileManager.saveProfiles(list);
    return true;
  },
  /* Devolve um planejamento órfão à lista. Não move, não copia e não apaga
     nada: só torna alcançável o que já está no aparelho. */
  reanexarPlano(planId, nome) {
    const plans = PlanManager.getPlans();
    if (plans.some(p => p.id === planId)) return false;
    plans.push({ id: planId, nome: nome || ('Planejamento recuperado ' + planId.slice(-4)), tipo: 'Outro', createdAt: new Date().toISOString(), recuperadoEm: new Date().toISOString() });
    PlanManager.savePlans(plans);
    return true;
  },

  /* ── FOTOS DO HISTÓRICO DE VERSÕES ────────────────────────────────────────
     Além de restaurar a foto inteira (o que o Histórico de versões já faz),
     aqui dá para ver O QUE cada foto tem e trazer de volta SÓ o que falta —
     sem desfazer o que você fez depois. */
  async inspecionarFotos(pid) {
    const alvo = pid || ProfileManager.getActiveProfileId();
    const out = [];
    const lista = this._fotosDe(alvo);
    for (const rec of lista) {
      let data = null;
      try { const json = await BackupHistory._gunzip(rec); data = json ? JSON.parse(json) : null; } catch (e) { _quiet(e, 'rec-abrir-foto'); }
      if (!data) continue;
      const secoes = Object.keys(data).filter(s => s !== '__secrev' && s !== '__secpend' && s !== '__secdel' && s !== '__entryops' && s.indexOf('vhist') !== 0);
      out.push({ ts: rec.ts, nota: rec.note || '', secoes, total: secoes.length,
        bytes: secoes.reduce((a, s) => a + String(data[s] || '').length, 0) });
    }
    return out.sort((a, b) => b.ts - a.ts);
  },
  /* Traz de volta, de uma foto, APENAS as seções que hoje não existem ou estão
     vazias. É a operação segura por construção: nada do estado atual é
     sobrescrito, então não há como perder o que você fez desde a foto. */
  async restaurarFaltantes(pid, ts) {
    const alvo = pid || ProfileManager.getActiveProfileId();
    const rec = this._fotosDe(alvo).find(r => r.ts === ts);
    if (!rec) return { ok: false, motivo: 'foto não encontrada' };
    let data = null;
    try { const json = await BackupHistory._gunzip(rec); data = json ? JSON.parse(json) : null; } catch (e) { _quiet(e, 'rec-abrir-foto2'); }
    if (!data) return { ok: false, motivo: 'foto ilegível' };
    try { await BackupHistory.snapshot('antes de recuperar seções faltantes'); } catch (e) { _quiet(e, 'rec-snap'); }
    const prefix = 'diario-estudos:u:' + alvo + ':';
    const trazidas = [];
    Object.keys(data).forEach(sub => {
      if (sub === '__secrev' || sub === '__secpend' || sub === '__secdel' || sub === '__entryops' || sub.indexOf('vhist') === 0) return;
      const atual = localStorage.getItem(prefix + sub);
      if (atual !== null && atual !== '' && atual !== '[]' && atual !== '{}' && atual !== 'null') return; // já há algo vivo aqui
      const valor = data[sub];
      if (valor == null || valor === '') return;
      if (DB.setRaw(prefix + sub, valor) !== false) trazidas.push(sub);
    });
    return { ok: true, trazidas };
  }
};
window.Recuperacao = Recuperacao;

/* ── A TELA SAIU, O MOTOR FICOU ────────────────────────────────────────────
   `RecuperacaoUI` era um painel de resgate em Ajustes ▸ Dados e backup: um
   botão "Vasculhar o aparelho" e uma lista do que dava para trazer de volta.
   Ele nasceu para um defeito que hoje tem conserto na raiz — seções anotadas
   localmente mas ausentes do aparelho voltam sozinhas na reconciliação de
   entrada, e nada é apagado sem passar pela lixeira. Um botão de emergência
   que a pessoa vê todo dia, para uma emergência que não acontece mais, é
   ruído na tela onde ela vai mexer em outra coisa.

   O `Recuperacao` acima NÃO saiu, e não é resíduo: `66-backup-nuvem.js` lê
   `rotulo()` para nomear seções em português, e o AutoTeste usa `varrer()` e
   `planosOrfaos()` para provar, a cada execução, que nenhum dado ficou fora
   de alcance. É a mesma varredura de antes — só não tem mais um botão. */
