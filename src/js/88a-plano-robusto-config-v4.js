/* ============================================================================
   ROBUSTO V4 — configuração por tipo de ataque
   Cada perfil tem defaults próprios e estado isolado. O usuário pode restaurar
   campo, grupo ou perfil inteiro sem tocar no Simplificado/PlanoEngine.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoRobustoConfigV4) return;
  window.__planoRobustoConfigV4 = true;
  if (typeof DB === 'undefined') return;
  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,n(v,a)));
  const clone=x=>JSON.parse(JSON.stringify(x));
  const COMMON={
    recursos:{roteadorAtivo:true,otimizadorAtivo:true,aprendizadoPesosAtivo:true,tempoPessoalAtivo:true,fallbackTempoAtivo:false},
    roteador:{minCiclosIntervencao:5,confiancaMin:0.55,ganhoBaixaResposta:2.5,taxaTeoria:60,questoesBloco:15,revisaoMin:20,teoriaMin:30,leiSecaMin:20,flashcardsMin:15,manutencaoQuestoes:10,permitirTeoria:true,permitirLeiSeca:true,permitirFlashcards:true},
    otimizador:{orcamentoMin:90,maxFrentePct:45,penalidadeExcesso:1.5,minFrenteMin:10,fallbackSegQuestao:120,bonusEliminatoria:0.20,pesoPontos:0,pesoPPM:0,pesoLacuna:0.25,pesoIncidencia:0.10,pesoRecencia:0.10,pesoResposta:0.10,pesoEvidencia:0.20,pesoEficiencia:0.25}
  };
  const merge=(a,b)=>{const o=clone(a);Object.keys(b||{}).forEach(k=>{if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&o[k]&&typeof o[k]==='object')Object.assign(o[k],b[k]);else o[k]=clone(b[k]);});return o;};
  const DEFAULTS={
    base:merge(COMMON,{roteador:{taxaTeoria:60,questoesBloco:15},otimizador:{orcamentoMin:120,pesoLacuna:.30,pesoIncidencia:.10,pesoRecencia:.12,pesoResposta:.10,pesoEvidencia:.16,pesoEficiencia:.22}}),
    edital:merge(COMMON,{roteador:{taxaTeoria:65,questoesBloco:18,teoriaMin:25},otimizador:{orcamentoMin:90,pesoPontos:.30,pesoPPM:.28,pesoLacuna:.12,pesoIncidencia:.12,pesoRecencia:.06,pesoResposta:.05,pesoEvidencia:.03,pesoEficiencia:.04}}),
    curto:merge(COMMON,{roteador:{taxaTeoria:55,questoesBloco:12,revisaoMin:15,teoriaMin:18,leiSecaMin:15,flashcardsMin:10},otimizador:{orcamentoMin:60,maxFrentePct:50,pesoPontos:.12,pesoPPM:.38,pesoLacuna:.12,pesoIncidencia:.08,pesoRecencia:.04,pesoResposta:.03,pesoEvidencia:.03,pesoEficiencia:.20}}),
    manutencao:merge(COMMON,{roteador:{taxaTeoria:70,questoesBloco:10,revisaoMin:15,manutencaoQuestoes:8},otimizador:{orcamentoMin:45,maxFrentePct:40,pesoPontos:.05,pesoPPM:.08,pesoLacuna:.10,pesoIncidencia:.08,pesoRecencia:.34,pesoResposta:.18,pesoEvidencia:.05,pesoEficiencia:.12}}),
    diagnostico:merge(COMMON,{recursos:{otimizadorAtivo:false,aprendizadoPesosAtivo:false},roteador:{taxaTeoria:50,questoesBloco:20,minCiclosIntervencao:5},otimizador:{orcamentoMin:60,pesoPontos:0,pesoPPM:0,pesoLacuna:.25,pesoIncidencia:.10,pesoRecencia:.15,pesoResposta:.05,pesoEvidencia:.35,pesoEficiencia:.10}})
  };
  const LABELS={base:'🧱 Base ampla',edital:'🎯 Edital publicado',curto:'⏱️ Tempo curto',manutencao:'🛡️ Manutenção',diagnostico:'🔍 Diagnóstico'};
  const SCHEMA={
    recursos:[
      ['roteadorAtivo','Roteador pedagógico','bool','Escolhe como atacar a fraqueza.'],['otimizadorAtivo','Otimizador global','bool','Seleciona as 3 frentes em conjunto sob orçamento de tempo.'],['aprendizadoPesosAtivo','Aprendizado conservador','bool','Permite pesos aprendidos somente quando a validação histórica é suficiente.'],['tempoPessoalAtivo','Usar tempo pessoal','bool','Usa seu ritmo real apenas quando a amostra de tempo é confiável.'],['fallbackTempoAtivo','Fallback de tempo','bool','Se ligado, usa segundos/questão configurados quando não há amostra pessoal.']
    ],
    roteador:[
      ['minCiclosIntervencao','Ciclos mínimos p/ personalizar','num',5,30,1,'Evita trocar método com pouco histórico.'],['confiancaMin','Confiança mínima','num',0.30,0.95,.05,'Limiar para intervenção baseada em resposta histórica.'],['ganhoBaixaResposta','Baixa resposta (pp/100q)','num',0,10,.1,'Abaixo disso, volume puro perde prioridade.'],['taxaTeoria','Taxa abaixo da qual teoria ganha espaço','num',30,90,1,'Só vale com evidência pedagógica suficiente.'],['questoesBloco','Questões do bloco dirigido','num',5,50,1,'Dose pedagógica sugerida; não altera o alvo global.'],['revisaoMin','Revisão dirigida (min)','num',5,60,5,'Tempo recomendado antes das questões.'],['teoriaMin','Teoria focal (min)','num',10,90,5,'Bloco teórico curto e focal.'],['leiSecaMin','Lei seca (min)','num',5,60,5,'Bloco normativo para matérias jurídicas.'],['flashcardsMin','Flashcards/Anki (min)','num',5,45,5,'Recuperação ativa para sinal de esquecimento.'],['manutencaoQuestoes','Questões de manutenção','num',5,30,1,'Dose pequena para tópicos competitivos/elite.'],['permitirTeoria','Permitir teoria → questões','bool',''],['permitirLeiSeca','Permitir lei seca → questões','bool',''],['permitirFlashcards','Permitir flashcards → questões','bool','']
    ],
    otimizador:[
      ['orcamentoMin','Orçamento da rodada (min)','num',30,360,5,'Tempo total usado para comparar combinações.'],['maxFrentePct','Máximo por frente (%)','num',25,80,5,'Evita uma única frente consumir a rodada.'],['penalidadeExcesso','Penalidade por exceder orçamento','num',.2,5,.1,'Quanto combinações acima do orçamento são rebaixadas.'],['minFrenteMin','Mínimo por frente (min)','num',5,45,5,'Reserva prática por disciplina.'],['fallbackSegQuestao','Fallback seg/questão','num',45,300,5,'Só usado se o fallback estiver ligado.'],['bonusEliminatoria','Bônus risco eliminatório','num',0,.8,.05,'Protege matérias abaixo do mínimo da prova.'],['pesoPontos','Peso: pontos recuperáveis','num',0,1,.01,'Mais útil no pós-edital.'],['pesoPPM','Peso: pontos/minuto','num',0,1,.01,'Retorno esperado por tempo.'],['pesoLacuna','Peso: lacuna','num',0,1,.01,'Distância para a régua competitiva.'],['pesoIncidencia','Peso: incidência','num',0,1,.01,'Importância histórica do assunto.'],['pesoRecencia','Peso: recência','num',0,1,.01,'Prioriza medição vencida/esquecimento.'],['pesoResposta','Peso: resposta histórica','num',0,1,.01,'Usa resposta aos ciclos anteriores.'],['pesoEvidencia','Peso: evidência','num',0,1,.01,'Incerteza/probabilidade de não domínio.'],['pesoEficiencia','Peso: eficiência','num',0,1,.01,'Ganho relativo ao esforço fora do pós-edital.']
    ]
  };
  const C={
    VERSAO:4,KEY:'plano-robusto-v4',DEFAULTS,LABELS,SCHEMA,
    detectarModo(){
      let p={};try{p=PlanoEngine&&PlanoEngine.prefs?PlanoEngine.prefs():{};}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v4-modo');}
      let fase='pre';try{fase=typeof PlanoPontos!=='undefined'&&PlanoPontos.modo&&PlanoPontos.modo()==='pos'?'pos':'pre';}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v4-fase');}
      if(p.incluirPequenas&&n(p.minAmostra,20)<=5)return'diagnostico';
      if(p.ordenar==='queda')return'manutencao';
      if(p.ordenar==='rendimento')return'curto';
      if(fase==='pos'||p.ordenar==='pontos'||p.ordenar==='banca')return'edital';
      return'base';
    },
    chave(m){return DB._profilePrefix()+this.KEY+'-'+m;},
    _sanear(m,raw){
      const d=clone(DEFAULTS[m]||DEFAULTS.base),o=merge(d,raw||{});
      Object.keys(d.recursos).forEach(k=>o.recursos[k]=!!o.recursos[k]);
      const r=o.roteador,t=o.otimizador;
      r.minCiclosIntervencao=Math.round(clamp(r.minCiclosIntervencao,5,30));r.confiancaMin=clamp(r.confiancaMin,.30,.95);r.ganhoBaixaResposta=clamp(r.ganhoBaixaResposta,0,10);r.taxaTeoria=clamp(r.taxaTeoria,30,90);r.questoesBloco=Math.round(clamp(r.questoesBloco,5,50));
      ['revisaoMin','teoriaMin','leiSecaMin','flashcardsMin'].forEach(k=>r[k]=Math.round(clamp(r[k],5,90)));r.manutencaoQuestoes=Math.round(clamp(r.manutencaoQuestoes,5,30));['permitirTeoria','permitirLeiSeca','permitirFlashcards'].forEach(k=>r[k]=!!r[k]);
      t.orcamentoMin=Math.round(clamp(t.orcamentoMin,30,360));t.maxFrentePct=clamp(t.maxFrentePct,25,80);t.penalidadeExcesso=clamp(t.penalidadeExcesso,.2,5);t.minFrenteMin=Math.round(clamp(t.minFrenteMin,5,45));t.fallbackSegQuestao=Math.round(clamp(t.fallbackSegQuestao,45,300));t.bonusEliminatoria=clamp(t.bonusEliminatoria,0,.8);
      ['pesoPontos','pesoPPM','pesoLacuna','pesoIncidencia','pesoRecencia','pesoResposta','pesoEvidencia','pesoEficiencia'].forEach(k=>t[k]=clamp(t[k],0,1));
      const soma=['pesoPontos','pesoPPM','pesoLacuna','pesoIncidencia','pesoRecencia','pesoResposta','pesoEvidencia','pesoEficiencia'].reduce((s,k)=>s+t[k],0)||1;['pesoPontos','pesoPPM','pesoLacuna','pesoIncidencia','pesoRecencia','pesoResposta','pesoEvidencia','pesoEficiencia'].forEach(k=>t[k]/=soma);
      return o;
    },
    prefs(m){m=m||this.detectarModo();let raw={};try{raw=JSON.parse(localStorage.getItem(this.chave(m))||'{}')||{};}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v4-prefs');}return this._sanear(m,raw);},
    salvar(m,patch){m=m||this.detectarModo();const p=this._sanear(m,merge(this.prefs(m),patch||{}));try{const v=JSON.stringify(p);if(DB.setRaw)DB.setRaw(this.chave(m),v);else localStorage.setItem(this.chave(m),v);}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v4-save');}return p;},
    restaurarCampo(m,g,k){const p=this.prefs(m);p[g][k]=clone(DEFAULTS[m][g][k]);return this.salvar(m,p);},
    restaurarGrupo(m,g){const p=this.prefs(m);p[g]=clone(DEFAULTS[m][g]);return this.salvar(m,p);},
    restaurarTudo(m){try{if(DB.delRaw)DB.delRaw(this.chave(m));else localStorage.removeItem(this.chave(m));}catch(e){if(typeof _quiet==='function')_quiet(e,'robusto-v4-reset');}return this.prefs(m);},
    resumo(m){m=m||this.detectarModo();const p=this.prefs(m);return{modo:m,rotulo:LABELS[m],recursos:clone(p.recursos),orcamentoMin:p.otimizador.orcamentoMin,minCiclos:p.roteador.minCiclosIntervencao};},
    html(m){
      m=m||this.detectarModo();const p=this.prefs(m),row=(g,d)=>{const k=d[0],label=d[1],tipo=d[2],hint=d[tipo==='num'?6:3]||'',v=p[g][k];return `<div class="rv4-row" data-rv4-row="${g}.${k}"><div><b>${label}</b>${hint?`<small>${hint}</small>`:''}</div><div class="rv4-control">${tipo==='bool'?`<label class="rv4-switch"><input type="checkbox" data-rv4-field="${g}.${k}" ${v?'checked':''}><span></span></label>`:`<input type="number" data-rv4-field="${g}.${k}" min="${d[3]}" max="${d[4]}" step="${d[5]}" value="${Math.round(v*1000)/1000}">`}<button type="button" class="rv4-reset-one" data-rv4-reset="${g}.${k}" title="Restaurar padrão deste parâmetro">↺</button></div></div>`;};
      const sec=g=>`<section class="rv4-section"><header><div><b>${g==='recursos'?'Recursos':g==='roteador'?'Roteador pedagógico':'Otimizador global'}</b></div><button type="button" data-rv4-reset-group="${g}">↺ Restaurar grupo</button></header>${SCHEMA[g].map(d=>row(g,d)).join('')}</section>`;
      return `<div class="rv4-panel" data-rv4-panel><div class="rv4-panel-head"><div><strong>Configurações do Módulo Robusto</strong><span>${LABELS[m]} · padrões recomendados por estratégia</span></div><button type="button" data-rv4-reset-all>↺ Restaurar modo</button></div><p class="rv4-note">Os padrões são conservadores: personalização exige evidência; tempo pessoal só entra quando confiável. Alterações valem apenas para o Robusto.</p>${sec('recursos')}${sec('roteador')}${sec('otimizador')}</div>`;
    },
    bind(root,onChange,m){m=m||this.detectarModo();if(!root)return;const changed=()=>{if(onChange)onChange(this.prefs(m));};root.querySelectorAll('[data-rv4-field]').forEach(el=>el.addEventListener('change',()=>{const[g,k]=el.dataset.rv4Field.split('.'),p=this.prefs(m);p[g][k]=el.type==='checkbox'?el.checked:Number(el.value);this.salvar(m,p);changed();}));root.querySelectorAll('[data-rv4-reset]').forEach(b=>b.addEventListener('click',()=>{const[g,k]=b.dataset.rv4Reset.split('.');this.restaurarCampo(m,g,k);changed();}));root.querySelectorAll('[data-rv4-reset-group]').forEach(b=>b.addEventListener('click',()=>{this.restaurarGrupo(m,b.dataset.rv4ResetGroup);changed();}));const all=root.querySelector('[data-rv4-reset-all]');if(all)all.addEventListener('click',()=>{this.restaurarTudo(m);changed();});}
  };
  window.PlanoRobustoConfigV4=C;
})();