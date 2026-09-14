/* ============================================================================
   PUXAR DO PLANO V2 — orquestrador/UI neutro
   O Comparar consome apenas as APIs públicas dos dois motores e nunca recalcula
   nem mistura suas fórmulas. A escolha das 3 disciplinas usa ranking/consenso.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoSugControllerV2) return;
  window.__planoSugControllerV2 = true;
  const I=window.PlanoSugestoesInfraV2,S=window.PlanoSugestoesSimplificadoV2,R=window.PlanoSugestoesRobustoV2;
  if(!I||!S||!R||typeof ExtrasScreen==='undefined'||typeof PlanoCiclo==='undefined'||typeof DB==='undefined')return;
  const {num,norm,esc}=I;
  const C={
    VERSAO:2,KEY:'plano-sug-ui-v2',DEFAULTS:Object.freeze({modo:'robusto'}),_legacyPuxar:null,
    prefs(){let modo='robusto';try{const z=JSON.parse(localStorage.getItem(DB._profilePrefix()+this.KEY)||'{}')||{};if(['simplificado','robusto','comparar'].includes(z.modo))modo=z.modo;}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-v2-prefs');}return Object.assign({modo},S.prefs());},
    salvar(patch){patch=patch||{};if(Object.keys(patch).some(k=>['fase','meta','minAmostra','banca','alvoQuestoes'].includes(k)))S.salvar(patch);let modo=this.prefs().modo;if(['simplificado','robusto','comparar'].includes(patch.modo))modo=patch.modo;try{const k=DB._profilePrefix()+this.KEY,v=JSON.stringify({modo});if(DB.setRaw)DB.setRaw(k,v);else localStorage.setItem(k,v);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-v2-save');}return Object.assign({modo},S.prefs());},
    simplificado(p){return S.calcular(p||S.prefs());},
    robusto(){return R.calcular();},
    comparar(p){
      const s=S.calcular(p||S.prefs()),r=R.calcular();
      if(s.erro&&r.erro)return{erro:'ambos-indisponiveis',modo:'comparar',itens:[],simples:s,robusto:r};
      const rankMap=(res)=>{const m=new Map();(res.itens||[]).forEach((x,i)=>m.set(norm(x.disciplina),{c:x,rank:i+1}));return m;};
      const a=rankMap(s),b=rankMap(r),ch=[...new Set([...a.keys(),...b.keys()])];
      const linhas=ch.map(k=>{
        const sa=a.get(k),rb=b.get(k),cons=!!(sa&&rb&&norm(sa.c.nome)===norm(rb.c.nome));
        const pontos=(sa?4-sa.rank:0)+(rb?4-rb.rank:0)+(cons?10:0);
        return{disciplina:(sa&&sa.c.disciplina)||(rb&&rb.c.disciplina),simplificado:sa&&sa.c||null,robusto:rb&&rb.c||null,rankSimplificado:sa&&sa.rank||null,rankRobusto:rb&&rb.rank||null,consenso:cons,pontosComparacao:pontos,escolha:cons?'consenso':(rb?'robusto':'simplificado')};
      }).sort((x,y)=>y.pontosComparacao-x.pontosComparacao).slice(0,3);
      return{modo:'comparar',fase:{simplificado:s.fase,robusto:r.fase},itens:linhas,simples:s,robusto:r,explicacao:'Comparação por posição em cada ranking + bônus de consenso; scores dos motores não são somados nem tratados como mesma escala.'};
    },
    calcular(p){p=p||this.prefs();return p.modo==='simplificado'?this.simplificado(p):p.modo==='comparar'?this.comparar(p):this.robusto();},
    _erroTexto(e){return({'sem-retrato':'Importe um retrato do TEC antes de gerar sugestões.','sem-lacunas':'Nenhum assunto medido está abaixo da meta desejada.','pos-sem-planejamento':'O Simplificado Pós precisa do planejamento da prova com quantidade/pontos/peso por matéria.','pos-sem-banca':'Escolha uma banca específica para o Simplificado Pós.','pos-sem-cruzamento':'Não houve cruzamento confiável entre TEC, incidência da banca e planejamento.','sem-candidatos':'Não há candidatos elegíveis sem sobrepor reforços já abertos.','ambos-indisponiveis':'Nenhum dos dois motores conseguiu formar sugestões neste escopo.'})[e]||'Não foi possível formar sugestões com o escopo atual.';},
    _bancasOptions(atual){return `<option value="__todas__" ${atual==='__todas__'?'selected':''}>Selecionar automaticamente</option>`+I.bancas().map(b=>`<option value="${esc(b)}" ${b===atual?'selected':''}>${esc(b)}</option>`).join('');},
    _cabecalho(p,res){
      const sp=S.prefs(),fase=S.fase(sp),rp=res&&res.robusto&&res.robusto.configPlano?res.robusto.configPlano:(res&&res.configPlano)||null, simpleControls=p.modo!=='robusto';
      const resumoRob=rp?`<div class="ps-rule"><b>Robusto independente:</b> Plano atual · meta operacional ${Math.round(num(rp.metaOperacional,85))}% · régua competitiva 90%+ · amostra ${Math.round(num(rp.minAmostra,20))}. Não usa os controles do Simplificado.</div>`:`<div class="ps-rule"><b>Robusto independente:</b> usa exclusivamente PlanoEngine + Mentor 90+ e seus próprios históricos.</div>`;
      return `<div class="ps-mode-grid" role="group" aria-label="Modo das sugestões">${[['simplificado','Simplificado','TEC direto; não usa PlanoEngine/Mentor90'],['robusto','Robusto','Plano atual + Mentor 90+ + tempo + evolução'],['comparar','Comparar','Duas saídas independentes lado a lado']].map(([k,t,s])=>`<button type="button" class="ps-mode ${p.modo===k?'active':''}" data-ps-modo="${k}"><b>${t}</b><small>${s}</small></button>`).join('')}</div>${simpleControls?`<div class="ps-settings"><label><span>Fase simplificada</span><select data-ps-fase><option value="auto" ${sp.fase==='auto'?'selected':''}>Automática</option><option value="pre" ${sp.fase==='pre'?'selected':''}>Pré-edital</option><option value="pos" ${sp.fase==='pos'?'selected':''}>Pós-edital</option></select></label><label><span>Meta desejada</span><div class="ps-input-suffix"><input data-ps-meta type="number" min="50" max="100" value="${sp.meta}"><em>%</em></div></label><label><span>Amostra mínima</span><input data-ps-min type="number" min="1" max="500" value="${sp.minAmostra}"></label><label><span>Questões por frente</span><input data-ps-alvo type="number" min="5" max="200" value="${sp.alvoQuestoes}"></label><label class="${fase==='pos'?'':'ps-hidden'}"><span>Banca</span><select data-ps-banca>${this._bancasOptions(sp.banca)}</select></label></div>`:''}${p.modo!=='simplificado'?resumoRob:''}<div class="ps-rule"><b>Contrato:</b> até 3 disciplinas distintas · 1 tópico por disciplina · uma única fila em Extras. <span>${esc((res&&res.explicacao)||'')}</span></div>`;
    },
    _card(c,i,checked=true){return `<label class="ps-card"><input type="checkbox" class="ps-pick" data-i="${i}" ${checked?'checked':''}><div class="ps-card-body"><div class="ps-card-top"><span class="ps-disc">${esc(c.disciplina)}</span><span class="ps-score">${Math.round(num(c.score))}/100</span></div><strong>${esc(c.nome)}</strong><p>${esc(c.motivo)}</p><div class="ps-metrics"><span>${num(c.taxa,c.item&&c.item.taxa).toFixed(0)}% atual</span><span>${Math.round(num(c.qJanela,c.item&&c.item.qJanela))}q amostra</span><span>${c.alvo}q alvo global</span>${c.doseDiaria?`<span>~${c.doseDiaria}q/dia</span>`:''}</div>${c.modo==='robusto'&&c.politica&&c.politica.aprendida?`<small class="ps-learn">Pesos regularizados com ${c.politica.n} ciclos</small>`:''}</div></label>`;},
    _compareRow(x,i){const card=(c,k)=>c?`<label class="ps-compare-option ${x.consenso?'is-consensus':''}"><input type="radio" name="ps-choice-${i}" value="${k}" ${(x.escolha===k||(x.escolha==='consenso'&&k==='robusto'))?'checked':''}><div><span>${k==='simplificado'?'Simplificado':'Robusto'}${k==='simplificado'&&x.rankSimplificado?' · #'+x.rankSimplificado:k==='robusto'&&x.rankRobusto?' · #'+x.rankRobusto:''}</span><b>${esc(c.nome)}</b><small>${esc(c.motivo)}</small></div></label>`:'';return `<section class="ps-compare-row" data-row="${i}"><header><b>${esc(x.disciplina)}</b>${x.consenso?'<span class="ps-consensus">✓ Consenso</span>':'<span>Escolha a leitura</span>'}</header><div class="ps-compare-grid">${card(x.simplificado,'simplificado')}${card(x.robusto,'robusto')}</div></section>`;},
    _renderLista(screen,p,res){
      const host=document.getElementById('pl-lista'),conta=document.getElementById('pl-conta');if(!host)return;
      if(res.erro){host.innerHTML=`<div class="ps-empty"><b>Sem sugestões</b><span>${esc(this._erroTexto(res.erro))}</span></div>`;if(conta)conta.textContent='';return;}
      if(p.modo==='comparar'){
        host.innerHTML=(res.itens||[]).map((x,i)=>this._compareRow(x,i)).join('')||'<div class="ps-empty">Nenhuma disciplina elegível.</div>';
        if(conta)conta.innerHTML=`<strong>${res.itens.length}</strong> disciplina(s) para comparar`;
        host.querySelectorAll('input[type=radio]').forEach(el=>el.addEventListener('change',()=>{const i=Number(el.name.replace('ps-choice-',''));if(res.itens[i])res.itens[i].escolha=el.value;}));
      } else {
        screen._planoSel=new Set((res.itens||[]).map((_,i)=>i));
        host.innerHTML=(res.itens||[]).map((c,i)=>this._card(c,i,true)).join('')||'<div class="ps-empty">Nenhuma sugestão elegível.</div>';
        if(conta)conta.innerHTML=`<strong>${res.itens.length}</strong> disciplina(s) · 1 tópico por disciplina`;
        host.querySelectorAll('.ps-pick').forEach(cb=>cb.addEventListener('change',()=>{const i=Number(cb.dataset.i);if(cb.checked)screen._planoSel.add(i);else screen._planoSel.delete(i);}));
      }
    },
    _renderModal(screen,p,res){
      const body=document.getElementById('ui-modal-body');if(!body)return;
      body.innerHTML=`${this._cabecalho(p,res)}<div class="ps-list-head"><span id="pl-conta"></span><small>Disciplinas com reforço do Plano aberto já foram removidas.</small></div><div id="pl-lista" class="ps-list"></div>`;
      this._renderLista(screen,p,res);
      body.querySelectorAll('[data-ps-modo]').forEach(b=>b.addEventListener('click',()=>{p=this.salvar({modo:b.dataset.psModo});this._recalcularModal(screen,p);}));
      const bind=(q,ev,fn)=>{const el=body.querySelector(q);if(el)el.addEventListener(ev,fn);};
      bind('[data-ps-fase]','change',e=>{p=this.salvar({fase:e.target.value});this._recalcularModal(screen,p);});
      bind('[data-ps-meta]','change',e=>{p=this.salvar({meta:Number(e.target.value)});this._recalcularModal(screen,p);});
      bind('[data-ps-min]','change',e=>{p=this.salvar({minAmostra:Number(e.target.value)});this._recalcularModal(screen,p);});
      bind('[data-ps-alvo]','change',e=>{p=this.salvar({alvoQuestoes:Number(e.target.value)});this._recalcularModal(screen,p);});
      bind('[data-ps-banca]','change',e=>{p=this.salvar({banca:e.target.value});this._recalcularModal(screen,p);});
    },
    _recalcularModal(screen,p){const host=document.getElementById('pl-lista');if(host)host.innerHTML='<div class="ps-loading">Recalculando sugestões…</div>';setTimeout(()=>{try{const res=this.calcular(p);screen._psResultado=res;this._renderModal(screen,p,res);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-v2-recalc');}},0);},
    _escolhidos(screen,p,res){if(!res||res.erro)return[];if(p.modo==='comparar')return(res.itens||[]).map(x=>x.consenso?(x.robusto||x.simplificado):(x.escolha==='simplificado'?x.simplificado:x.robusto)).filter(Boolean);return(res.itens||[]).filter((_,i)=>!screen._planoSel||screen._planoSel.has(i));},
    criar(screen,p,res){
      const itens=this._escolhidos(screen,p,res);let n=0;
      itens.forEach(c=>{
        if(!c||!c.item)return;const x=c.item;
        const e=DB.addExtra({titulo:PlanoCiclo.titulo(c.nome,'reforco',x.membros),tipo:'questoes',disciplina:c.disciplina||'',unidade:'questoes',alvo:Math.max(1,c.alvo),periodo:'unica',contaMetricas:false,obs:`Gerado pelo Plano · ${c.modo==='robusto'?'Robusto':'Simplificado'} ${c.fase==='pos'?'Pós':'Pré'}.${c.intervencao&&c.intervencao.rotulo?' Intervenção: '+c.intervencao.rotulo+'.':''}`});
        if(!e)return;
        const origem=PlanoCiclo.origem(c.nome,c.disciplina,Object.assign({},x,{custoQ:c.alvo,taxa:c.taxa??x.taxa}),{motivo:'reforco'});
        origem.sugestao={versao:this.VERSAO,motor:c.modo==='robusto'?R.MOTOR:S.MOTOR,modoInterface:p.modo,fase:c.fase,meta:c.meta,minAmostra:c.minAmostra,banca:c.banca||null,score:Math.round(num(c.score)*10)/10,alvoGlobal:Math.max(1,c.alvo),doseDiaria:c.doseDiaria||null,componentes:c.componentes||{},politica:c.politica||null,configPlano:c.configPlano||null,intervencao:c.intervencao||null,auditoria:c.auditoria||null,arquitetura:c.modo==='robusto'?R.arquitetura():S.arquitetura(),criadoEm:typeof todayLocal==='function'?todayLocal():new Date().toISOString().slice(0,10)};
        DB.updateExtra(e.id,{origemPlano:origem});n++;
      });
      screen.render();if(typeof showToast==='function')showToast(n?`${n} reforço(s) criado(s) · ${p.modo==='comparar'?'comparação concluída':p.modo}`:'Nenhuma sugestão selecionada');return n;
    },
    abrir(screen){
      const p=this.prefs();let res;
      try{res=this.calcular(p);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-v2-open');if(this._legacyPuxar)return this._legacyPuxar.call(screen);return;}
      screen._psResultado=res;screen._planoSel=new Set((res.itens||[]).map((_,i)=>i));
      new Promise(resolve=>{UI._resolve=resolve;UI._mode='confirm';UI._open('🏁 Puxar do Plano','Dois motores independentes, uma única fila de execução','<div id="ps-root"></div>',{okText:'Criar atividades'});}).then(ok=>{if(!ok)return;const atual=this.prefs();return this.criar(screen,atual,screen._psResultado);});
      setTimeout(()=>{try{this._renderModal(screen,p,res);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-v2-render');}},0);
    },
    instalar(){if(ExtrasScreen._planoSugestoesV2)return;ExtrasScreen._planoSugestoesV2=true;this._legacyPuxar=ExtrasScreen.puxarDoPlano;const self=this;ExtrasScreen.puxarDoPlano=function(){return self.abrir(this);};}
  };
  C.instalar();window.PlanoSugestoesV2=C;window.PlanoSugestoesV1=C;
})();
