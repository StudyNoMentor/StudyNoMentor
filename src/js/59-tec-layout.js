/* ============================================================
   DESEMPENHO TEC — hierarquia visual e leitura guiada v2
   Camada exclusivamente de apresentação: não altera cálculos nem filas.
   ============================================================ */
(() => {
  if (typeof window !== 'undefined' && window.__tecLayout) return;
  if (typeof window !== 'undefined') window.__tecLayout = true;
  if (typeof DesempenhoTecScreen === 'undefined') return;

  const DT = DesempenhoTecScreen;
  const TecLayout = {
    _find(panel, sels) {
      for (const s of sels) { const el = panel.querySelector(s); if (el) return el; }
      return null;
    },
    /* ── UM ATALHO QUE NÃO ROLA PARA NADA NÃO É ATALHO ─────────────────────
       Os três passos apontavam para `.pl-hero`, `.pl-tempo` e `.pl-hoje` — os
       blocos do Plano legado. Com um motor ativo (o padrão), `.pl-hero` está
       oculto e os outros dois vivem dentro do recolhível da rota manual: os
       botões existiam, ficavam clicáveis e não levavam a lugar nenhum. É o
       tipo de comando que faz duvidar de tudo o que está na tela.

       Agora cada passo tem uma LISTA de alvos, na ordem da leitura atual:
       primeiro a superfície do motor, depois a legada, para o atalho valer
       nos dois estados. E se o alvo estiver dentro de um `<details>` fechado,
       ele é aberto antes — rolar até algo invisível é a mesma falha com outra
       aparência. */
    _scroll(el) {
      if (!el) return;
      let d = el.closest ? el.closest('details:not([open])') : null;
      while (d) { d.open = true; d = d.parentElement && d.parentElement.closest ? d.parentElement.closest('details:not([open])') : null; }
      if (el.scrollIntoView) el.scrollIntoView({ behavior:'smooth', block:'start' });
    },
    _visivel(el) {
      if (!el) return false;
      if (el.hidden) return false;
      /* `offsetParent` nulo cobre de uma vez `display:none` no elemento e em
         qualquer ancestral — que é como o CSS do TEC oculta o legado. Um alvo
         dentro de `<details>` fechado NÃO cai aqui (ele tem offsetParent), e
         é de propósito: `_scroll` sabe abrir. */
      return el.offsetParent !== null || !!(el.closest && el.closest('details'));
    },
    _primeiro(panel, sels) {
      for (const sel of sels) {
        const el = panel.querySelector(sel);
        if (this._visivel(el)) return el;
      }
      return null;
    },
    _guide(panel) {
      let guide = panel.querySelector('.tl2-guide');
      if (!guide) {
        guide = document.createElement('section');
        guide.className = 'tl2-guide';
        guide.innerHTML = `
          <div class="tl2-guide-copy"><small>COMO LER O PLANO</small><strong>Do diagnóstico para a ação</strong><span>O motor continua igual. Esta trilha apenas organiza a leitura da tela.</span></div>
          <div class="tl2-steps">
            <button type="button" data-tl2-step="panorama"><b>1</b><span><strong>Panorama</strong><small>Veja o nível e a distância da meta.</small></span></button>
            <button type="button" data-tl2-step="prioridade"><b>2</b><span><strong>Prioridades</strong><small>Escolha a matéria que mais pesa agora.</small></span></button>
            <button type="button" data-tl2-step="acao"><b>3</b><span><strong>Ação</strong><small>Execute o bloco sugerido ou ajuste a fila.</small></span></button>
          </div>`;
        /* A âncora precisa ser filha DIRETA do painel. A barra de ajustes pode
           morar dentro de um card; usar o sibling dela em panel.insertBefore()
           gerava NotFoundError em alguns estados de renderização. */
        const alvo = [...panel.children].find(el =>
          !el.classList.contains('tl2-guide') && !el.classList.contains('tl2-summary-strip'));
        if (alvo) panel.insertBefore(guide, alvo); else panel.appendChild(guide);
      }
      const ALVOS = {
        // o panorama do motor primeiro; o hero legado só quando não há motor
        panorama:   ['[data-tpm-panorama]', '.pl-hero'],
        // a força-tarefa do motor é a prioridade de hoje; depois o quadro legado
        prioridade: ['[data-tpm-output] .tpm-recs', '[data-tpm-output]', '.pl-tempo', '.pl-ciclo'],
        // a ação: ranking completo do motor, ou o bloco/lista do legado
        acao:       ['.tpm-ranking', '.tpm-legacy-exec', '.pl-hoje', '.pl-item']
      };
      guide.querySelectorAll('[data-tl2-step]').forEach(b => b.onclick = () => {
        const el = this._primeiro(panel, ALVOS[b.dataset.tl2Step] || []);
        if (el) this._scroll(el);
        else if (typeof showToast === 'function') showToast('Esta etapa não tem nada para mostrar no escopo atual.');
      });
    },
    _decorateSections(panel) {
      panel.classList.add('tl2-plan');
      const hero=this._find(panel,['.pl-hero']); if(hero) hero.classList.add('tl2-panorama');
      const prioridade=this._find(panel,['.pl-tempo']); if(prioridade) prioridade.classList.add('tl2-prioridades');
      const hoje=this._find(panel,['.pl-hoje']); if(hoje) hoje.classList.add('tl2-acao');
      panel.querySelectorAll('.pl-mat').forEach((el,i)=>{el.classList.add('tl2-materia');el.style.setProperty('--tl2-i',String(i));});
      panel.querySelectorAll('.pl-item').forEach((el,i)=>{el.classList.add('tl2-topico');el.style.setProperty('--tl2-i',String(i));});
      panel.querySelectorAll('.info-dot').forEach(b=>b.classList.add('tl2-info'));
      panel.querySelectorAll('.pl-atacar-bt').forEach(b=>{if(!b.dataset.tl2Label){b.dataset.tl2Label='1';b.setAttribute('aria-label',b.title||'Atacar esta matéria');}});
    },
    _summary(panel) {
      let strip=panel.querySelector('.tl2-summary-strip');
      const mats=[...panel.querySelectorAll('.pl-mat:not(.is-resumo)')];
      const acao=mats.filter(x=>x.classList.contains('is-acao')).length;
      const fila=mats.filter(x=>x.classList.contains('is-fila')).length;
      const topicos=panel.querySelectorAll('.pl-item').length;
      if(!strip){
        strip=document.createElement('div');strip.className='tl2-summary-strip';
        const guide=panel.querySelector('.tl2-guide'); if(guide) guide.insertAdjacentElement('afterend',strip); else panel.prepend(strip);
      }
      /* O quarto azulejo dizia "3 passos · panorama → prioridade → ação" —
         a mesma frase da faixa "COMO LER O PLANO" imediatamente acima, no
         formato de um número que não é número. Um dado por azulejo; a
         instrução fica onde ela já estava. */
      const frentes=panel.querySelectorAll('[data-tpm-rec]').length;
      strip.innerHTML=`<span><b>${acao}</b><small>matéria${acao===1?'':'s'} para atacar</small></span><span><b>${fila}</b><small>na fila</small></span><span><b>${topicos}</b><small>tópico${topicos===1?'':'s'} exibido${topicos===1?'':'s'}</small></span>`
        +(frentes?`<span><b>${frentes}</b><small>frente${frentes===1?'':'s'} na força-tarefa do motor</small></span>`:'');
    },
    decorarPlano() {
      const panel=document.getElementById('tec-panel-plano'); if(!panel)return;
      this._guide(panel); this._decorateSections(panel); this._summary(panel);
    },
    decorarGeral() {
      const screen=document.getElementById('screen-desempenhotec'); if(!screen)return;
      screen.classList.add('tl2-screen');
      const subtabs=screen.querySelector('#tec-subtabs'); if(subtabs)subtabs.classList.add('tl2-tabs');
      if((DT.tecTab||'analise')==='plano') this.decorarPlano();
    },
    instalar() {
      if (DT._tl2Installed) return; DT._tl2Installed=true; const self=this;
      const rp=DT.renderPlanoConteudo;
      if(typeof rp==='function') DT.renderPlanoConteudo=function(){const r=rp.apply(this,arguments);self.decorarPlano();return r;};
      const rr=DT.render;
      if(typeof rr==='function') DT.render=function(){const r=rr.apply(this,arguments);self.decorarGeral();return r;};
      const sw=DT.switchTecTab;
      if(typeof sw==='function') DT.switchTecTab=function(){const r=sw.apply(this,arguments);self.decorarGeral();return r;};
      this.decorarGeral();
    }
  };
  TecLayout.instalar();
  if(typeof window!=='undefined')window.TecLayout=TecLayout;
})();
