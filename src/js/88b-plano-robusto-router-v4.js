/* ============================================================================
   ROBUSTO V4 — roteador pedagógico
   Decide COMO atacar. Não ranqueia disciplinas e não lê estado do Simplificado.
   ============================================================================ */
(() => {
  if (typeof window === 'undefined' || window.__planoRobustoRouterV4) return;
  window.__planoRobustoRouterV4 = true;
  const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const juridica=s=>/(direito|legisl|tribut|constituc|administrat|penal|civil|process|previdenc|trabalho|financeir)/.test(norm(s));
  const quedaDe=x=>{for(const k of ['quedaPP','queda','deltaTaxa','tendenciaPP']){const v=Number(x&&x.item&&x.item[k]);if(Number.isFinite(v))return k==='deltaTaxa'||k==='tendenciaPP'?-v:v;}return 0;};
  const R={
    VERSAO:4,
    _tempoQuestoes(c,q,cfg){
      const t=c&&c.mentor&&c.mentor.tempo,rec=cfg.recursos||{},op=cfg.otimizador||{};
      if(rec.tempoPessoalAtivo&&t&&t.confiavel&&n(t.segundosPorQuestao)>0)return q*n(t.segundosPorQuestao)/60;
      if(rec.fallbackTempoAtivo)return q*n(op.fallbackSegQuestao,120)/60;
      return null;
    },
    decidir(c,cfg){
      if(!c)return null;const r=cfg.roteador||{},rec=cfg.recursos||{},q=n(c.qJanela),taxa=n(c.taxa),dom=c.mentor&&c.mentor.dominio,cal=c.mentor&&c.mentor.calibracao||{},aud=c.auditoria||{},bloco=Math.max(5,Math.round(n(r.questoesBloco,15))),tq=this._tempoQuestoes(c,bloco,cfg),disc=c.disciplina||'',legal=juridica(disc),stale=!!(c.item&&c.item.vencido),queda=quedaDe(c),evid=!!aud.intervencaoConfiavel&&Math.max(n(cal.nTopico),n(cal.nDisciplina),n(cal.n))>=Math.max(3,n(r.minCiclosIntervencao,5)),baixa=evid&&(cal.baixaResposta===true||n(cal.ganho100,99)<=n(r.ganhoBaixaResposta,2.5));
      const mk=(tipo,rotulo,passos,motivo,mins,confianca)=>({tipo,rotulo,passos,motivo,minutosEstimados:Math.max(1,Math.round(mins||0)),confianca:Math.max(0,Math.min(1,n(confianca,.5))),evidencia:{ciclos:Math.max(n(cal.nTopico),n(cal.nDisciplina),n(cal.n)),confiavel:evid,baixaResposta:baixa,legal,stale,quedaPP:queda}});
      if(!rec.roteadorAtivo)return c.intervencao||mk('legado','Intervenção do Mentor 90+',[], 'Roteador V4 desligado; preservada a política anterior.',tq||20,.5);
      if(q<Math.max(1,n(c.minAmostra,20))){const faltam=Math.max(5,Math.round(n(c.minAmostra,20)-q)),mins=this._tempoQuestoes(c,faltam,cfg)||25;return mk('diagnostico','Diagnóstico por questões',[{tipo:'questoes',quantidade:faltam}],`Amostra ${q}/${Math.round(n(c.minAmostra,20))}: primeiro produzir evidência confiável.`,mins,.9);}
      if(dom&&(dom.nivel==='elite'||dom.nivel==='competitivo')&&(stale||queda>3)){const qq=Math.max(5,Math.round(n(r.manutencaoQuestoes,10))),mins=this._tempoQuestoes(c,qq,cfg)||15;if(r.permitirFlashcards&&queda>3)return mk('flashcards_questoes','Flashcards → manutenção por questões',[{tipo:'anki',minutos:n(r.flashcardsMin,15)},{tipo:'questoes',quantidade:qq}],`Domínio alto com sinal de queda (${queda.toFixed(1)} pp): recuperar antes de ampliar volume.`,n(r.flashcardsMin,15)+mins,.78);return mk('manutencao','Manutenção por questões',[{tipo:'questoes',quantidade:qq}],`Domínio alto, mas ${stale?'medição vencida':'há sinal de queda'}; objetivo é retenção.`,mins,.8);}
      if(baixa&&taxa<n(r.taxaTeoria,60)&&r.permitirTeoria){const mins=(n(r.teoriaMin,30)+(tq||25));return mk('teoria_questoes','Teoria focal → questões',[{tipo:'teoria',minutos:n(r.teoriaMin,30)},{tipo:'questoes',quantidade:bloco}],`Resposta histórica baixa e taxa ${taxa.toFixed(0)}%: mais volume isolado tende a ter retorno marginal menor.`,mins,Math.max(n(r.confiancaMin,.55),.7));}
      if(baixa&&legal&&r.permitirLeiSeca){const mins=n(r.leiSecaMin,20)+(tq||25);return mk('lei_seca_questoes','Lei seca → questões',[{tipo:'leitura',minutos:n(r.leiSecaMin,20)},{tipo:'questoes',quantidade:bloco}],`Matéria normativa com baixa resposta ao volume; reforçar a fonte antes da nova medição.`,mins,Math.max(n(r.confiancaMin,.55),.68));}
      if(evid&&queda>3&&r.permitirFlashcards){const mins=n(r.flashcardsMin,15)+(tq||25);return mk('flashcards_questoes','Flashcards → questões',[{tipo:'anki',minutos:n(r.flashcardsMin,15)},{tipo:'questoes',quantidade:bloco}],`Queda recente sugere recuperação ativa antes do novo bloco de questões.`,mins,.65);}
      if(evid&&taxa<n(r.taxaTeoria,60)&&r.permitirTeoria){const mins=n(r.revisaoMin,20)+(tq||25);return mk('revisao_questoes','Revisão dirigida → questões',[{tipo:'revisao',minutos:n(r.revisaoMin,20)},{tipo:'questoes',quantidade:bloco}],`Taxa ${taxa.toFixed(0)}% abaixo do limiar pedagógico, com histórico suficiente para personalizar.`,mins,.62);}
      return mk('questoes_dirigidas','Questões dirigidas',[{tipo:'questoes',quantidade:bloco}],`Não há evidência suficiente de que trocar o método supere um novo bloco de questões.`,tq||25,evid?.62:.5);
    }
  };
  window.PlanoRobustoRouterV4=R;
})();
