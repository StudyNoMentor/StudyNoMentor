/* ============================================================================
   DESEMPENHO TEC — FONTE EXPLICITA DAS SUGESTOES V1
   ----------------------------------------------------------------------------
   As metricas observadas do Plano continuam descritivas. A camada de DECISAO
   passa a vir exclusivamente do motor escolhido: Simplificado OU Robusto.
   Nenhum score e misturado e a antiga recomendacao do PlanoEngine fica oculta.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__tecPlanoFonteMotorV1) return;
  const D = (typeof DesempenhoTecScreen !== 'undefined' && DesempenhoTecScreen) || window.DesempenhoTecScreen;
  const C = window.PlanoSugestoesV4 || window.PlanoSugestoesV3 || window.PlanoSugestoesV2;
  const G = window.PlanoMotoresGovernancaV5;
  const I = window.PlanoSugestoesInfraV2;
  const Central = window.PlanoMotoresCentralTecV4 || window.PlanoMotoresCentralTecV3 || window.PlanoMotoresCentralTecV2;
  if (!D || !C || !G || !I || typeof DB === 'undefined') return;
  window.__tecPlanoFonteMotorV1 = true;

  const esc = I.esc || (x => String(x == null ? '' : x));
  const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const fmt = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v).toFixed(d).replace('.', ',') : '—';
  const norm = I.norm || (s => String(s || '').toLowerCase().trim());

  const M = {
    VERSAO: 1,
    KEY: 'tec-plano-fonte-motor-v1',
    DEFAULT: 'robusto',
    _origPaint: null,
    _origGovSync: null,
    _origGovConfig: null,
    _rendering: false,

    _key() { return DB._profilePrefix() + this.KEY; },
    _estado() { return G.estado ? G.estado() : { simplificado:true, robusto:true }; },
    _resolver(preferido) {
      const e = this._estado();
      if (preferido === 'robusto' && e.robusto) return 'robusto';
      if (preferido === 'simplificado' && e.simplificado) return 'simplificado';
      if (e.robusto) return 'robusto';
      if (e.simplificado) return 'simplificado';
      return null;
    },
    fonte() {
      let k = this.DEFAULT;
      try { const z = JSON.parse(localStorage.getItem(this._key()) || 'null'); if (z && ['simplificado','robusto'].includes(z.fonte)) k = z.fonte; }
      catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-read'); }
      return this._resolver(k);
    },
    salvar(fonte) {
      const k = this._resolver(fonte);
      if (!k) return null;
      try {
        const raw = JSON.stringify({ fonte:k });
        if (DB.setRaw) DB.setRaw(this._key(), raw); else localStorage.setItem(this._key(), raw);
      } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-save'); }
      return k;
    },
    calcular(fonte) {
      const k = this._resolver(fonte || this.fonte());
      if (!k) return { erro:'motores-desabilitados', modo:null, itens:[] };
      try {
        if (k === 'simplificado') return C.simplificado ? C.simplificado() : C.calcular({ modo:'simplificado' });
        return C.robusto ? C.robusto() : C.calcular({ modo:'robusto' });
      } catch (e) {
        if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-calcular');
        return { erro:'falha-' + k, modo:k, itens:[] };
      }
    },
    _criterio(fonte, r) {
      if (fonte === 'simplificado') {
        if (r && r.fase === 'pos') return 'Pós-edital: lacuna × incidência hierárquica limpa da banca × valor da matéria no planejamento. Uma frente por disciplina.';
        return 'Pré-edital: lacuna para a meta, com amostra mínima e fronteira hierárquica sem sobrepor pai e filho. Uma frente por disciplina.';
      }
      if (r && r.fase === 'pos') return 'Pós-edital: score estratégico com pontos recuperáveis, retorno por tempo, lacuna, incidência, recência e resposta histórica; o otimizador escolhe até 3 disciplinas.';
      return 'Pré-edital: score estratégico de lacuna, evidência, incidência, recência, resposta histórica e eficiência; o otimizador escolhe até 3 disciplinas.';
    },
    _erroTexto(r, fonte) {
      const e = r && r.erro;
      const mapa = {
        'sem-retrato':'Importe um retrato TEC neste escopo antes de calcular.',
        'sem-lacunas':'Nenhum assunto elegível está abaixo da régua deste motor.',
        'sem-candidatos':'Não há frente elegível sem sobrepor atividades já abertas.',
        'pos-sem-banca':'O Simplificado Pós precisa de uma banca específica.',
        'pos-sem-planejamento':'O Simplificado Pós precisa da composição da prova no planejamento.',
        'pos-sem-cruzamento':'Não houve cruzamento confiável entre TEC, incidência e planejamento.',
        'sem-plano':'O Robusto não conseguiu formar o universo estratégico neste escopo.',
        'motor-desabilitado':'Este motor está desabilitado nas Configurações.',
        'motores-desabilitados':'Ative ao menos um motor nas Configurações.'
      };
      return mapa[e] || `O ${fonte === 'robusto' ? 'Robusto' : 'Simplificado'} não conseguiu formar recomendações neste escopo.`;
    },
    _quantidade(c, fonte) {
      if (!c) return null;
      if (fonte === 'simplificado') return Math.max(1, Math.round(n(c.alvo, 0))) || null;
      const iv = c.intervencaoV5 || c.intervencaoV4 || c.intervencao || {};
      if (n(iv.quantidadeQuestoes) > 0) return Math.round(n(iv.quantidadeQuestoes));
      const passo = Array.isArray(iv.passos) ? iv.passos.find(x => x && x.tipo === 'questoes' && n(x.quantidade) > 0) : null;
      if (passo) return Math.round(n(passo.quantidade));
      if (n(c.doseDiaria) > 0) return Math.round(n(c.doseDiaria));
      return Math.max(1, Math.round(n(c.alvo, 0))) || null;
    },
    _tempo(c, fonte, q) {
      if (fonte === 'simplificado') return { texto:'Tempo não modelado pelo Simplificado', detalhe:'Esse motor decide pela regra direta e não empresta o relógio do Robusto.' };
      const iv = c && (c.intervencaoV5 || c.intervencaoV4 || c.intervencao) || {};
      const t = c && c.mentor && c.mentor.tempo || {};
      const mins = Number.isFinite(Number(iv.minutosEstimados)) ? Math.round(Number(iv.minutosEstimados))
        : (c && c.otimizacaoV5 && Number.isFinite(Number(c.otimizacaoV5.minutosAlocados)) ? Math.round(Number(c.otimizacaoV5.minutosAlocados)) : null);
      const spq = t.confiavel && n(t.segundosPorQuestao) > 0 ? n(t.segundosPorQuestao) : null;
      if (mins != null && spq != null) return { texto:`≈ ${mins} min`, detalhe:`${fmt(spq/60,1)} min/questão · ritmo ${t.escopo === 'disciplina' ? 'desta disciplina' : 'global'} · ${q || '—'} questões aprofundadas` };
      if (mins != null) return { texto:`≈ ${mins} min`, detalhe:`estimativa operacional · ${q || '—'} questões aprofundadas` };
      if (spq != null && q) return { texto:`≈ ${Math.max(1,Math.round(q*spq/60))} min`, detalhe:`${fmt(spq/60,1)} min/questão · ritmo ${t.escopo === 'disciplina' ? 'desta disciplina' : 'global'}` };
      return { texto:'Tempo ainda sem amostra confiável', detalhe:'O Robusto não inventa velocidade quando o histórico de tempo é insuficiente.' };
    },
    _card(c, i, fonte) {
      const q = this._quantidade(c, fonte), tempo = this._tempo(c, fonte, q), taxa = Number.isFinite(Number(c.taxa)) ? `${fmt(c.taxa,0)}%` : '—';
      const amostra = Math.max(0, Math.round(n(c.qJanela)));
      const score = Number.isFinite(Number(c.score)) ? Math.round(Number(c.score)) : null;
      const alvo = Math.max(0, Math.round(n(c.alvo)));
      const dom = c.mentor && c.mentor.dominio;
      const contexto = fonte === 'robusto' && dom && dom.rotulo ? dom.rotulo : (fonte === 'simplificado' ? 'Regra direta' : 'Prioridade estratégica');
      return `<article class="tpm-rec" data-tpm-rec data-disciplina="${esc(c.disciplina||'')}">
        <div class="tpm-rank">${i+1}</div>
        <div class="tpm-main">
          <div class="tpm-head"><div><small>${esc(c.disciplina||'Disciplina')}</small><b>${esc(c.nome||'Assunto')}</b></div><span class="tpm-score">${score == null ? '' : 'prioridade ' + score + '/100'}</span></div>
          <div class="tpm-metrics">
            <span><b>${taxa}</b><small>acerto</small></span>
            <span><b>${amostra || '—'}</b><small>questões na amostra</small></span>
            <span class="tpm-dose"><b>${q || '—'}</b><small>questões aprofundadas</small></span>
            <span><b>${esc(tempo.texto)}</b><small>${esc(tempo.detalhe)}</small></span>
          </div>
          <p class="tpm-context"><b>${esc(contexto)}</b> · ${esc(c.motivo || '')}</p>
          ${fonte === 'robusto' && alvo > 0 && q && alvo !== q ? `<p class="tpm-target">Bloco de agora: <b>${q}q</b> · alvo global estimado do assunto: <b>${alvo}q</b>. A dose não substitui o alvo.</p>` : ''}
        </div>
      </article>`;
    },
    _selectorHtml(fonte) {
      const e = this._estado(), ambos = e.simplificado && e.robusto;
      const bt = (k, ico, nome, desc) => `<button type="button" data-tpm-source="${k}" class="${fonte===k?'active':''}" aria-pressed="${fonte===k?'true':'false'}"><span>${ico}</span><div><b>${nome}</b><small>${desc}</small></div><i>${fonte===k?'em uso':''}</i></button>`;
      return `<section class="tpm-selector" data-tpm-selector>
        <header><div><small>FONTE DAS SUGESTÕES</small><strong>Qual modelo deve decidir onde atacar?</strong></div>${ambos?'<span>Trocar recalcula a decisão inteira.</span>':'<span>Um único motor está habilitado.</span>'}</header>
        <div class="tpm-source-grid">
          ${e.simplificado ? bt('simplificado','⚡','Simplificado','Regra direta, transparente e sem modelo de tempo.') : ''}
          ${e.robusto ? bt('robusto','🧠','Robusto','Prioridade estratégica, dose e tempo pessoal quando confiável.') : ''}
        </div>
        <p><b>Os números observados abaixo não mudam de motor:</b> taxa, domínio, trajetória e cobertura continuam descrevendo o seu TEC. O que muda é a camada de decisão — disciplinas, assuntos, quantidade e, no Robusto, tempo.</p>
      </section>`;
    },
    _outputHtml(fonte, r) {
      const nome = fonte === 'robusto' ? 'Robusto' : 'Simplificado', ico = fonte === 'robusto' ? '🧠' : '⚡';
      if (!r || r.erro) return `<section class="tpm-output" data-tpm-output data-tpm-model="${fonte}"><header><div><small>${ico} ${nome.toUpperCase()}</small><strong>Recomendação deste modelo</strong></div></header><div class="tpm-empty">${esc(this._erroTexto(r, fonte))}</div></section>`;
      const itens = (r.itens || []).slice();
      if (fonte === 'robusto') itens.sort((a,b)=>n(b.score)-n(a.score));
      return `<section class="tpm-output" data-tpm-output data-tpm-model="${fonte}">
        <header><div><small>${ico} ${nome.toUpperCase()} · ${r.fase === 'pos' ? 'PÓS-EDITAL' : 'PRÉ-EDITAL'}</small><strong>Onde atacar agora</strong><p>${esc(this._criterio(fonte,r))}</p></div><span>${itens.length} ${itens.length===1?'frente':'frentes'}</span></header>
        ${fonte === 'robusto' ? '<div class="tpm-method"><b>Seu método fica fixo:</b> cada dose abaixo significa resolução aprofundada de questões; leitura de comentários/resumo e criação de cards fazem parte da sua execução, não da decisão do algoritmo.</div>' : ''}
        <div class="tpm-recs">${itens.map((c,i)=>this._card(c,i,fonte)).join('')}</div>
        <footer><b>Execução continua em Atividades → Puxar do Plano.</b><span>Scores pertencem ao próprio modelo e não devem ser comparados entre Simplificado e Robusto.</span></footer>
      </section>`;
    },
    render() {
      if (this._rendering || typeof document === 'undefined') return;
      const proj = document.getElementById('plano-proj'), lista = document.getElementById('plano-lista');
      if (!proj || !lista) return;
      const fonte = this.fonte();
      if (!fonte) { lista.classList.remove('tpm-engine-active'); proj.querySelector('[data-tpm-selector]')?.remove(); lista.querySelector('[data-tpm-output]')?.remove(); return; }
      this._rendering = true;
      try {
        this.salvar(fonte);
        proj.querySelector('[data-tpm-selector]')?.remove();
        const s = document.createElement('div'); s.innerHTML = this._selectorHtml(fonte); const sel = s.firstElementChild; if (sel) proj.prepend(sel);
        lista.querySelector('[data-tpm-output]')?.remove();
        const r = this.calcular(fonte);
        const box = document.createElement('div'); box.innerHTML = this._outputHtml(fonte, r); const out = box.firstElementChild; if (out) lista.prepend(out);
        lista.classList.add('tpm-engine-active');
        proj.querySelectorAll('.pl-hero-sub').forEach(p=>{if(/^\s*Caminho mais curto:/i.test(p.textContent||''))p.classList.add('tpm-legacy-decision');});
        proj.querySelectorAll('[data-tpm-source]').forEach(b=>b.addEventListener('click',()=>{
          const k = this.salvar(b.dataset.tpmSource); if (!k || k === fonte) return;
          if (typeof showToast === 'function') showToast((k==='robusto'?'Robusto':'Simplificado') + ' recalculando as sugestões…');
          this.render();
        }));
      } finally { this._rendering = false; }
    },
    _patchGovernanca() {
      if (this._origGovSync || !G.syncVisibility) return;
      const self = this;
      this._origGovSync = G.syncVisibility.bind(G);
      G.syncVisibility = function() {
        const estavaPlano = D.tecTab === 'plano';
        const r = self._origGovSync();
        const e = self._estado(), algum = e.simplificado || e.robusto;
        const tab = document.querySelector('.tec-subtab[data-tectab="plano"]'), panel = document.getElementById('tec-panel-plano');
        if (tab) { tab.hidden = !algum; tab.setAttribute('aria-hidden', algum?'false':'true'); if (algum) { tab.classList.remove('ux-off'); tab.style.removeProperty('display'); } else tab.style.display='none'; }
        if (panel && algum) panel.style.removeProperty('display');
        const atual = self.fonte(); if (atual) self.salvar(atual);
        if (algum && estavaPlano && D.tecTab !== 'plano' && typeof D.switchTecTab === 'function') D.switchTecTab('plano');
        return r;
      };
      if (G.renderConfig) {
        this._origGovConfig = G.renderConfig.bind(G);
        G.renderConfig = function() {
          const r = self._origGovConfig();
          const rob = document.querySelector('[data-pmg-engine="robusto"] .pmg-engine-copy');
          if (rob) { const ps=rob.querySelectorAll('p,small'); if(ps[0])ps[0].textContent='Prioriza onde atacar, qual assunto escolher, a dose de questões e o tempo quando houver histórico confiável.'; if(ps[1])ps[1].textContent='Sem sugerir método de estudo: seu modus operandi permanece resolução aprofundada de questões.'; }
          return r;
        };
      }
    },
    _patchCentral() {
      if (!Central || Central.__tpmV1) return;
      Central.__tpmV1 = true;
      const old = Central._robustHtml && Central._robustHtml.bind(Central);
      if (old) Central._robustHtml = function() {
        return old().replace('Política estratégica V6: domínio probabilístico com prior real, calibração, incidência, tempo, roteador, aprendizado segregado e otimização pelo score canônico.', 'Política estratégica V7: escolhe disciplina, assunto, dose de questões e tempo quando houver amostra confiável. O método de estudo permanece fixo com o aluno.')
          .replace('Painel especialista', 'Prioridade, dose e tempo');
      };
    },
    init() {
      if (!this._origPaint && D._pintarPlano) {
        const orig = D._pintarPlano;
        this._origPaint = orig;
        const self = this;
        D._pintarPlano = function() { const r = orig.apply(this, arguments); self.render(); return r; };
      }
      this._patchGovernanca();
      this._patchCentral();
      try { G.syncVisibility(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-gov-init'); }
      window.addEventListener('plano:motores-change', () => {
        const f = this.fonte(); if (f) this.salvar(f);
        try { G.syncVisibility(); } catch (e) { if (typeof _quiet === 'function') _quiet(e, 'tec-plano-fonte-gov-change'); }
        if (D.tecTab === 'plano') D.renderPlanoConteudo();
      });
      if (D.tecTab === 'plano') this.render();
    }
  };

  window.TecPlanoFonteMotorV1 = M;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => M.init(), { once:true });
  else M.init();
})();
