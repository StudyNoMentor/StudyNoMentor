/* ============================================================================
   PUXAR DO PLANO — ORQUESTRADOR NEUTRO
   ----------------------------------------------------------------------------
   Conhece as APIs públicas do Simplificado e do Robusto, mas nunca mistura
   seus scores. Extras continua sendo uma fila única de execução.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoSugController) return;
  const I=window.PlanoSugestoesInfra,S=window.PlanoSugestoesSimplificado,R=window.PlanoSugestoesRobusto;
  if(!I||!S||!R||typeof ExtrasScreen==='undefined'||typeof PlanoCiclo==='undefined'||typeof DB==='undefined')return;
  window.__planoSugController=true;
  const {num,norm,esc}=I;

  const C={
    KEY:'plano-sug-ui-v5',LEGACY_KEYS:['plano-sug-ui-v3','plano-sug-ui-v2'],DEFAULTS:Object.freeze({modo:'robusto'}),
    prefs(){let modo=this.DEFAULTS.modo;try{let z=JSON.parse(localStorage.getItem(DB._profilePrefix()+this.KEY)||'null');if(!z){for(const k of this.LEGACY_KEYS){z=JSON.parse(localStorage.getItem(DB._profilePrefix()+k)||'null');if(z)break;}}if(z&&['simplificado','robusto','comparar'].includes(z.modo))modo=z.modo;}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-prefs');}return{modo};},
    salvar(patch){patch=patch||{};let modo=this.prefs().modo;if(['simplificado','robusto','comparar'].includes(patch.modo))modo=patch.modo;try{const k=DB._profilePrefix()+this.KEY,v=JSON.stringify({modo});if(DB.setRaw)DB.setRaw(k,v);else localStorage.setItem(k,v);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-save');}return{modo};},
    simplificado(){return S.calcular(S.prefs());},
    robusto(){const r=R.calcular();try{if(window.PlanoRobustoAudit)PlanoRobustoAudit.registrarCalculo(r,{modoInterface:'robusto'});}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-audit');}return r;},
    comparar(){
      let s,r;try{s=this.simplificado();}catch(e){s={erro:'falha-simplificado',modo:'simplificado',itens:[]};if(typeof _quiet==='function')_quiet(e,'plano-controller-simple');}
      try{r=R.calcular();if(window.PlanoRobustoAudit)PlanoRobustoAudit.registrarCalculo(r,{modoInterface:'comparar'});}catch(e){r={erro:'falha-robusto',modo:'robusto',itens:[]};if(typeof _quiet==='function')_quiet(e,'plano-controller-robusto');}
      if(s.erro&&r.erro)return{erro:'ambos-indisponiveis',modo:'comparar',itens:[],simples:s,robusto:r};
      const rankMap=res=>{const m=new Map();(res.itens||[]).forEach((x,i)=>m.set(norm(x.disciplina),{c:x,rank:i+1}));return m;},a=rankMap(s),b=rankMap(r),ch=[...new Set([...a.keys(),...b.keys()])];
      const linhas=ch.map(k=>{const sa=a.get(k),rb=b.get(k),cons=!!(sa&&rb&&norm(sa.c.nome)===norm(rb.c.nome)),pontos=(sa?4-sa.rank:0)+(rb?4-rb.rank:0)+(cons?10:0);return{disciplina:(sa&&sa.c.disciplina)||(rb&&rb.c.disciplina),simplificado:sa&&sa.c||null,robusto:rb&&rb.c||null,rankSimplificado:sa&&sa.rank||null,rankRobusto:rb&&rb.rank||null,consenso:cons,pontosComparacao:pontos,escolha:cons?'consenso':(rb?'robusto':'simplificado')};}).sort((x,y)=>y.pontosComparacao-x.pontosComparacao).slice(0,3);
      return{modo:'comparar',fase:{simplificado:s.fase,robusto:r.fase},itens:linhas,simples:s,robusto:r,explicacao:'Comparação por posição em cada ranking + consenso. Scores dos motores nunca são somados nem tratados como a mesma escala.'};
    },
    calcular(p){const modo=(p&&p.modo)||this.prefs().modo;return modo==='simplificado'?this.simplificado():modo==='comparar'?this.comparar():this.robusto();},
    _erroTexto(e){return({
      'sem-retrato':'Importe um retrato do TEC antes de gerar sugestões.',
      'sem-lacunas':'Nenhum assunto observado está abaixo da meta deste motor.',
      'pos-sem-planejamento':'O Simplificado Pós precisa da composição da prova configurada.',
      'pos-sem-banca':'Escolha uma banca específica em Desempenho TEC › Motores para o Simplificado Pós.',
      'pos-sem-cruzamento':'Não houve cruzamento confiável entre TEC, incidência e planejamento no Simplificado.',
      'post-pesos-pendentes':'No Robusto Pós-edital, selecione as disciplinas do TEC e atribua seus pesos em Desempenho TEC › Motores.',
      'sem-candidatos':'Não há candidatos elegíveis sem sobrepor reforços já abertos.',
      'ambos-indisponiveis':'Nenhum dos dois motores conseguiu formar sugestões neste escopo.',
      'falha-simplificado':'O Simplificado não conseguiu calcular este escopo.',
      'falha-robusto':'O Robusto não conseguiu calcular este escopo.',
      'motor-desabilitado':'Este motor está desabilitado nas Configurações.',
      'motores-desabilitados':'Ative Simplificado ou Robusto em Configurações.'
    })[e]||'Não foi possível formar sugestões com o escopo atual.';},
    _cabecalho(p,res){const modo=(p&&p.modo)||this.prefs().modo,info=modo==='simplificado'?'<b>Simplificado:</b> leitura direta do TEC com regra transparente.':modo==='robusto'?'<b>Robusto:</b> TEC + incidência + reforços em Extras; escolhe alvo, ordem e dose, não método de estudo.':'<b>Comparar:</b> confronta apenas posição/consenso entre as duas leituras.';return`<div class="ps-config-location"><span>⚙</span><div><b>Fonte centralizada</b><small>O motor é escolhido no Desempenho TEC e pode ser trocado aqui antes de criar as atividades.</small></div></div><div class="ps-rule">${info} <span>${esc((res&&res.explicacao)||'')}</span></div><div class="ps-rule"><b>Contrato:</b> até 3 disciplinas distintas · 1 tópico ativo por disciplina · uma fila única em Extras.</div>`;},
    _topicos(c){if(!c||!Array.isArray(c.topicosOrdenados)||c.topicosOrdenados.length<2)return'';return`<details class="ps-topic-queue"><summary>Próximos tópicos desta disciplina</summary><ol>${c.topicosOrdenados.slice(1,5).map(x=>`<li><span>${esc(x.nome)}</span><small>${num(x.taxa).toFixed(0)}% · prioridade ${Math.round(num(x.score))}/100</small></li>`).join('')}</ol></details>`;},
    _card(c,i,checked=true){const q=Math.max(1,Math.round(num(c.quantidadeRecomendada,c.alvo))),tempo=c.prescricao&&c.prescricao.tempo,tempoTxt=c.modo==='robusto'&&tempo&&tempo.confiavel&&tempo.minutosEstimados?`<span>≈${Math.round(tempo.minutosEstimados)} min · Extras</span>`:'';return`<label class="ps-card"><input type="checkbox" class="ps-pick" data-i="${i}" ${checked?'checked':''}><div class="ps-card-body"><div class="ps-card-top"><span class="ps-disc">${esc(c.disciplina)}</span><span class="ps-score">${Math.round(num(c.score))}/100</span></div><strong>${esc(c.nome)}</strong><p>${esc(c.motivo)}</p><div class="ps-metrics"><span>${num(c.taxa,c.item&&c.item.taxa).toFixed(0)}% atual</span><span>${Math.round(num(c.qJanela,c.item&&c.item.qJanela))}q na amostra</span><span><b>${q}q</b> bloco recomendado</span>${tempoTxt}</div>${c.modo==='robusto'?this._topicos(c):''}</div></label>`;},
    _compareRow(x,i){const card=(c,k)=>c?`<label class="ps-compare-option ${x.consenso?'is-consensus':''}"><input type="radio" name="ps-choice-${i}" value="${k}" ${(x.escolha===k||(x.escolha==='consenso'&&k==='robusto'))?'checked':''}><div><span>${k==='simplificado'?'Simplificado':'Robusto'}${k==='simplificado'&&x.rankSimplificado?' · #'+x.rankSimplificado:k==='robusto'&&x.rankRobusto?' · #'+x.rankRobusto:''}</span><b>${esc(c.nome)}</b><small>${esc(c.motivo)}</small><small>${Math.max(1,Math.round(num(c.quantidadeRecomendada,c.alvo)))} questões</small></div></label>`:'';return`<section class="ps-compare-row" data-row="${i}"><header><b>${esc(x.disciplina)}</b>${x.consenso?'<span class="ps-consensus">✓ Consenso</span>':'<span>Escolha a leitura</span>'}</header><div class="ps-compare-grid">${card(x.simplificado,'simplificado')}${card(x.robusto,'robusto')}</div></section>`;},
    _renderLista(screen,p,res){const host=document.getElementById('pl-lista'),conta=document.getElementById('pl-conta');if(!host)return;if(res.erro){host.innerHTML=`<div class="ps-empty"><b>Sem sugestões</b><span>${esc(this._erroTexto(res.erro))}</span></div>`;if(conta)conta.textContent='';return;}if(p.modo==='comparar'){host.innerHTML=(res.itens||[]).map((x,i)=>this._compareRow(x,i)).join('')||'<div class="ps-empty">Nenhuma disciplina elegível.</div>';if(conta)conta.innerHTML=`<strong>${res.itens.length}</strong> disciplina(s) para comparar`;host.querySelectorAll('input[type=radio]').forEach(el=>el.addEventListener('change',()=>{const i=Number(el.name.replace('ps-choice-',''));if(res.itens[i])res.itens[i].escolha=el.value;}));}else{screen._planoSel=new Set((res.itens||[]).map((_,i)=>i));host.innerHTML=(res.itens||[]).map((c,i)=>this._card(c,i,true)).join('')||'<div class="ps-empty">Nenhuma sugestão elegível.</div>';if(conta)conta.innerHTML=`<strong>${res.itens.length}</strong> disciplina(s) · 1 tópico por disciplina`;host.querySelectorAll('.ps-pick').forEach(cb=>cb.addEventListener('change',()=>{const i=Number(cb.dataset.i);if(cb.checked)screen._planoSel.add(i);else screen._planoSel.delete(i);}));}},
    _renderModal(screen,p,res){const body=document.getElementById('ui-modal-body');if(!body)return;body.innerHTML=`${this._cabecalho(p,res)}<div class="ps-list-head"><span id="pl-conta"></span><small>Disciplinas com reforço aberto já foram removidas.</small></div><div id="pl-lista" class="ps-list"></div>`;this._renderLista(screen,p,res);body.querySelectorAll('[data-ps-modo]').forEach(b=>b.addEventListener('click',()=>{p=this.salvar({modo:b.dataset.psModo});this._recalcularModal(screen,p);}));},
    _recalcularModal(screen,p){const host=document.getElementById('pl-lista');if(host)host.innerHTML='<div class="ps-loading">Recalculando sugestões…</div>';setTimeout(()=>{try{const res=this.calcular(p);screen._psResultado=res;this._renderModal(screen,p,res);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-recalc');}},0);},
    _escolhidos(screen,p,res){if(!res||res.erro)return[];if(p.modo==='comparar')return(res.itens||[]).map(x=>x.consenso?(x.robusto||x.simplificado):(x.escolha==='simplificado'?x.simplificado:x.robusto)).filter(Boolean);return(res.itens||[]).filter((_,i)=>!screen._planoSel||screen._planoSel.has(i));},
    criar(screen,p,res){
      const itens=this._escolhidos(screen,p,res);let total=0;
      itens.forEach(c=>{
        if(!c||!c.item)return;const x=c.item,q=Math.max(1,Math.round(num(c.quantidadeRecomendada,c.alvo))),rob=c.modo==='robusto';
        const e=DB.addExtra({titulo:PlanoCiclo.titulo(c.nome,'reforco',x.membros),tipo:'questoes',disciplina:c.disciplina||'',unidade:'questoes',alvo:q,periodo:'unica',contaMetricas:false,obs:`Gerado pelo Plano · ${rob?'Robusto':'Simplificado'} ${c.fase==='pos'?'Pós':'Pré'} · ${q} questões aprofundadas.`});
        if(!e)return;const origem=PlanoCiclo.origem(c.nome,c.disciplina,Object.assign({},x,{custoQ:q,taxa:c.taxa??x.taxa}),{motivo:'reforco'});
        origem.sugestao={versao:5,motor:rob?R.MOTOR:S.MOTOR,revisaoAuditoria:rob?R.REVISAO_REGISTRO:(S.REVISAO_REGISTRO||3),modoInterface:p.modo,fase:c.fase,meta:c.meta,minAmostra:c.minAmostra,banca:c.banca||null,score:Math.round(num(c.score)*10)/10,quantidadeRecomendada:q,componentes:c.componentes||{},configRobusto:rob?{versao:8,prefs:R.prefs()}:null,prescricao:rob?(c.prescricao||null):null,topicosOrdenados:rob?(c.topicosOrdenados||[]):null,pesoPost:rob?(c.pesoPost||1):null,auditoria:c.auditoria||null,arquitetura:rob?R.arquitetura():S.arquitetura(),criadoEm:typeof todayLocal==='function'?todayLocal():new Date().toISOString().slice(0,10)};
        DB.updateExtra(e.id,{origemPlano:origem});
        if(rob){try{if(window.PlanoRobustoAudit)PlanoRobustoAudit.registrarCriacao(DB.getExtras().find(z=>z.id===e.id)||e);}catch(err){if(typeof _quiet==='function')_quiet(err,'plano-controller-audit-create');}}
        total++;
      });
      screen.render();if(typeof showToast==='function')showToast(total?`${total} reforço(s) criado(s) · ${p.modo==='comparar'?'comparação concluída':p.modo}`:'Nenhuma sugestão selecionada');return total;
    },
    abrir(screen){const p=this.prefs();let res;try{res=this.calcular(p);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-open');if(typeof showToast==='function')showToast('Não foi possível calcular sugestões do Plano.');return;}screen._psResultado=res;screen._planoSel=new Set((res.itens||[]).map((_,i)=>i));new Promise(resolve=>{UI._resolve=resolve;UI._mode='confirm';UI._open('🏁 Puxar do Plano','Dois modelos independentes, uma única fila de execução','<div id="ps-root"></div>',{okText:'Criar atividades'});}).then(ok=>{if(!ok)return;const atual=this.prefs();return this.criar(screen,atual,screen._psResultado);});setTimeout(()=>{try{this._renderModal(screen,p,res);}catch(e){if(typeof _quiet==='function')_quiet(e,'plano-controller-render');}},0);},
    instalar(){if(ExtrasScreen._planoSugestoesV5)return;ExtrasScreen._planoSugestoesV5=true;const self=this;ExtrasScreen.puxarDoPlano=function(){return self.abrir(this);};}
  };
  C.instalar();window.PlanoSugestoes=C;
})();