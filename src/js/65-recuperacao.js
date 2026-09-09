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
        if (sub === '__secrev' || sub === '__secpend') continue;
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
     'diario-estudos:vhist:<id>'. Ler pela API do próprio VersionHistory evita
     que este módulo se desatualize se aquele formato mudar. */
  _fotosDe(pid) {
    try { return VersionHistory._list(pid) || []; } catch (e) { _quiet(e, 'rec-lista-fotos'); return []; }
  },
  _contarFotos(pid) { return this._fotosDe(pid).length; },
  /* Planejamentos que TÊM dados mas não estão na lista — a causa mais comum de
     "os registros aparecem mas o resto sumiu": o ponteiro se perdeu, os dados
     não. Reanexar é uma operação puramente aditiva. */
  planosOrfaos(pid) {
    const alvo = pid || ProfileManager.getActiveProfileId();
    const perfil = this.varrer().find(p => p.id === alvo);
    if (!perfil) return [];
    const porPlano = {};
    perfil.orfas.forEach(s => {
      if (!s.plano) return;
      const g = porPlano[s.plano] || (porPlano[s.plano] = { id: s.plano, secoes: 0, bytes: 0, registros: 0 });
      g.secoes++; g.bytes += s.bytes;
      if (/:entries$/.test(s.sec)) {
        try { g.registros = (JSON.parse(localStorage.getItem(s.chave)) || []).length; } catch (e) { _quiet(e, 'rec-conta'); }
      }
    });
    return Object.values(porPlano).sort((a, b) => b.bytes - a.bytes);
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
      try { const json = await VersionHistory._gunzip(rec); data = json ? JSON.parse(json) : null; } catch (e) { _quiet(e, 'rec-abrir-foto'); }
      if (!data) continue;
      const secoes = Object.keys(data).filter(s => s !== '__secrev' && s !== '__secpend' && s.indexOf('vhist') !== 0);
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
    try { const json = await VersionHistory._gunzip(rec); data = json ? JSON.parse(json) : null; } catch (e) { _quiet(e, 'rec-abrir-foto2'); }
    if (!data) return { ok: false, motivo: 'foto ilegível' };
    try { await VersionHistory.snapshot('antes de recuperar seções faltantes'); } catch (e) { _quiet(e, 'rec-snap'); }
    const prefix = 'diario-estudos:u:' + alvo + ':';
    const trazidas = [];
    Object.keys(data).forEach(sub => {
      if (sub === '__secrev' || sub === '__secpend' || sub.indexOf('vhist') === 0) return;
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

/* ── A TELA ────────────────────────────────────────────────────────────────
   Escrita para ser lida por quem está com medo, não por quem escreveu o app:
   primeiro o veredito em uma frase, depois o que dá para fazer agora, e só no
   fim os detalhes técnicos. Cada ação diz o que faz ANTES de fazer. */
const RecuperacaoUI = {
  _kb(b) { return b < 1024 ? b + ' B' : (b < 1024 * 1024 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB'); },
  _quando(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
           d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  },

  async render() {
    const host = document.getElementById('cfg-rec-body');
    if (!host) return;
    host.innerHTML = '<p class="hint">Vasculhando…</p>';
    const ativo = ProfileManager.getActiveProfileId();
    const perfis = Recuperacao.varrer();
    const meu = perfis.find(p => p.id === ativo) || null;
    const orfaos = Recuperacao.planosOrfaos(ativo);
    const lixo = Lixeira.listar(ativo);
    const fotos = await Recuperacao.inspecionarFotos(ativo);

    const blocos = [];

    /* 1. VEREDITO — a pergunta que a pessoa veio fazer, respondida primeiro. */
    const alcancaveis = meu ? meu.secoes.filter(s => s.alcancavel) : [];
    const recuperavel = orfaos.length || lixo.length ||
      fotos.some(f => f.secoes.some(sec => {
        const v = localStorage.getItem('diario-estudos:u:' + ativo + ':' + sec);
        return v === null || v === '' || v === '[]' || v === '{}';
      }));
    blocos.push(`<div class="cloud-slot-row" style="align-items:flex-start;">
      <div class="cloud-slot-info">
        <div class="name">${recuperavel ? '⚠️ Há dado recuperável neste aparelho' : '✓ Nada fora do lugar'}</div>
        <div class="meta">${alcancaveis.length} seção(ões) em uso · ${this._kb(meu ? meu.bytes : 0)} no total · ${orfaos.length} planejamento(s) órfão(s) · ${lixo.length} item(ns) na lixeira · ${fotos.length} foto(s) do histórico</div>
      </div>
    </div>`);

    /* 2. PLANEJAMENTOS ÓRFÃOS — a causa mais comum de "sumiu tudo menos os
       registros": os dados existem, o app é que perdeu o caminho até eles. */
    if (orfaos.length) {
      blocos.push('<div class="wd-section-title">Planejamentos com dados fora da lista</div>' +
        '<p class="hint">Estes dados estão no aparelho, mas o planejamento deles não consta na sua lista — por isso as telas abrem vazias. Reanexar é aditivo: não move, não copia e não apaga nada, só devolve o caminho.</p>' +
        orfaos.map(o => `<div class="cloud-slot-row" data-plano="${escapeHtml(o.id)}">
          <div class="cloud-slot-info">
            <div class="name">${escapeHtml(o.id)}</div>
            <div class="meta">${o.secoes} seção(ões) · ${this._kb(o.bytes)}${o.registros ? ' · ' + o.registros + ' registro(s) de estudo' : ''}</div>
          </div>
          <div class="cloud-slot-actions">
            <button type="button" class="btn-primary rec-attach">↩ Reanexar</button>
          </div>
        </div>`).join(''));
    }

    /* 3. LIXEIRA — o que o app apagou nos últimos 30 dias. */
    if (lixo.length) {
      blocos.push('<div class="wd-section-title">Lixeira (30 dias)</div>' +
        '<p class="hint">Tudo o que o app apagou fica aqui antes de sumir de vez. Restaurar só grava onde não houver conteúdo agora — nunca por cima do que existe.</p>' +
        lixo.map(it => `<div class="cloud-slot-row" data-lixo="${escapeHtml(it.chave)}">
          <div class="cloud-slot-info">
            <div class="name">${escapeHtml(Recuperacao.rotulo(it.sec))}</div>
            <div class="meta">${escapeHtml(it.sec)} · ${this._kb(it.bytes)} · apagada em ${this._quando(it.em)}${it.motivo ? ' · ' + escapeHtml(it.motivo) : ''}</div>
          </div>
          <div class="cloud-slot-actions">
            <button type="button" class="btn-primary rec-untrash">↺ Restaurar</button>
          </div>
        </div>`).join(''));
    }

    /* 4. FOTOS — trazer de volta SÓ o que falta, sem desfazer o resto. */
    if (fotos.length) {
      blocos.push('<div class="wd-section-title">Fotos do histórico de versões</div>' +
        '<p class="hint">Diferente do botão “Restaurar” do histórico (que volta a foto inteira), aqui o app traz da foto <strong>apenas as seções que hoje estão vazias ou não existem</strong>. Nada do que você fez depois é desfeito.</p>' +
        fotos.map(f => `<div class="cloud-slot-row" data-foto="${f.ts}">
          <div class="cloud-slot-info">
            <div class="name">${this._quando(f.ts)}</div>
            <div class="meta">${f.total} seção(ões) · ${this._kb(f.bytes)}${f.nota ? ' · ' + escapeHtml(f.nota) : ''}</div>
          </div>
          <div class="cloud-slot-actions">
            <button type="button" class="btn-primary rec-fill">⤵ Trazer o que falta</button>
          </div>
        </div>`).join(''));
    }

    /* 5. O QUE EXISTE HOJE — a lista completa, para conferência. */
    if (meu && meu.secoes.length) {
      const linhas = meu.secoes.slice().sort((a, b) => b.bytes - a.bytes).map(s =>
        `<tr><td>${escapeHtml(Recuperacao.rotulo(s.sec))}</td><td>${escapeHtml(s.sec)}</td><td class="num">${this._kb(s.bytes)}</td><td>${s.alcancavel ? '✓ em uso' : '⚠️ fora do alcance'}</td></tr>`).join('');
      blocos.push('<div class="wd-section-title">Tudo o que existe neste aparelho</div>' +
        `<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>O que é</th><th>Seção</th><th class="num">Tamanho</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div>`);
    }

    /* 6. OUTROS PERFIS — dado de outro perfil também some da vista. */
    const outros = perfis.filter(p => p.id !== ativo);
    if (outros.length) {
      blocos.push('<div class="wd-section-title">Outros perfis neste aparelho</div>' +
        outros.map(p => `<div class="cloud-slot-row">
          <div class="cloud-slot-info">
            <div class="name">${escapeHtml(p.nome || p.id)} ${p.naListaDePerfis ? '' : '<span class="inactive-tag">fora da lista de perfis</span>'}</div>
            <div class="meta">${p.secoes.length} seção(ões) · ${this._kb(p.bytes)} · ${p.fotos} foto(s)</div>
          </div>
        </div>`).join('') +
        '<p class="hint">Para ver os dados de outro perfil, entre nele pelo seu nome no topo da tela.</p>');
    }

    host.innerHTML = blocos.join('');
    this._ligar(host, ativo);
  },

  _ligar(host, ativo) {
    host.querySelectorAll('.rec-attach').forEach(b => b.addEventListener('click', async () => {
      const id = b.closest('[data-plano]').dataset.plano;
      if (!await UI.confirm('Devolver o planejamento "' + id + '" à sua lista?\n\nNada é movido nem apagado: os dados já estão no aparelho e voltam a ficar acessíveis.', { title: '↩ Reanexar planejamento', okText: 'Reanexar' })) return;
      const ok = Recuperacao.reanexarPlano(id);
      showToast(ok ? 'Planejamento reanexado ✓ — selecione-o em Planejamentos' : 'Este planejamento já estava na lista');
      this.render();
    }));
    host.querySelectorAll('.rec-untrash').forEach(b => b.addEventListener('click', async () => {
      const chave = b.closest('[data-lixo]').dataset.lixo;
      const r = Lixeira.restaurar(chave, false);
      if (r.ok) { showToast('Restaurado ✓ — recarregando'); setTimeout(() => recarregarApp('dado restaurado da lixeira', { imediato: true }), 700); return; }
      if (r.motivo === 'já existe conteúdo aqui') {
        if (!await UI.confirm('Já existe conteúdo nesta seção agora.\n\nSubstituir pelo que está na lixeira? O conteúdo atual vai para a lixeira no lugar, então dá para voltar atrás.', { title: '↺ Substituir?', okText: 'Substituir', danger: true })) return;
        const r2 = Lixeira.restaurar(chave, true);
        showToast(r2.ok ? 'Restaurado ✓ — recarregando' : 'Não foi possível restaurar');
        if (r2.ok) setTimeout(() => recarregarApp('dado restaurado da lixeira', { imediato: true }), 700);
        return;
      }
      showToast('Não foi possível restaurar: ' + (r.motivo || ''));
    }));
    host.querySelectorAll('.rec-fill').forEach(b => b.addEventListener('click', async () => {
      const ts = parseInt(b.closest('[data-foto]').dataset.foto, 10);
      if (!await UI.confirm('Trazer desta foto apenas as seções que hoje estão vazias?\n\nO que já tem conteúdo fica exatamente como está.', { title: '⤵ Trazer o que falta', okText: 'Trazer' })) return;
      const r = await Recuperacao.restaurarFaltantes(ativo, ts);
      if (!r.ok) { showToast('Não foi possível: ' + r.motivo); return; }
      if (!r.trazidas.length) { showToast('Nada faltando — esta foto não tem nada que você já não tenha'); return; }
      showToast(r.trazidas.length + ' seção(ões) recuperada(s) ✓ — recarregando');
      setTimeout(() => recarregarApp('seções recuperadas de uma foto', { imediato: true }), 900);
    }));
  }
};
window.RecuperacaoUI = RecuperacaoUI;
(function () {
  const b = document.getElementById('cfg-rec-scan');
  if (b) b.addEventListener('click', () => RecuperacaoUI.render());
})();
