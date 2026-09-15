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
    _scroll(el) { if (el && el.scrollIntoView) el.scrollIntoView({ behavior:'smooth', block:'start' }); },
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
      guide.querySelectorAll('[data-tl2-step]').forEach(b => b.onclick = () => {
        const key = b.dataset.tl2Step;
        const el = key === 'panorama'
          ? this._find(panel,['.pl-hero'])
          : key === 'prioridade'
            ? this._find(panel,['.pl-tempo','.pl-ciclo'])
            : this._find(panel,['.pl-hoje','.pl-item']);
        this._scroll(el);
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
      strip.innerHTML=`<span><b>${acao}</b><small>matéria${acao===1?'':'s'} para atacar</small></span><span><b>${fila}</b><small>na fila</small></span><span><b>${topicos}</b><small>tópico${topicos===1?'':'s'} exibido${topicos===1?'':'s'}</small></span><span><b>3 passos</b><small>panorama → prioridade → ação</small></span>`;
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
