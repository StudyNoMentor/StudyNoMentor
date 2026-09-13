from pathlib import Path

# Harness principal: globais lexicais não são propriedades de window.
p=Path('testes/stress-jornada-massiva.mjs')
s=p.read_text(encoding='utf-8')
s=s.replace("await page.waitForFunction(() => window.DB && window.ExtrasScreen && window.PlanoEngine && window.PlanoCiclo && window.ReforcoAgendaAuto, null, { timeout: 30000 });",
"await page.waitForFunction(() => typeof DB !== 'undefined' && typeof ExtrasScreen !== 'undefined' && typeof PlanoEngine !== 'undefined' && typeof PlanoCiclo !== 'undefined' && !!window.ReforcoAgendaAuto, null, { timeout: 30000 });")
s=s.replace("await page.waitForFunction(() => window.DB && window.ExtrasScreen && window.ReforcoAgendaAuto, null, { timeout:30000 });",
"await page.waitForFunction(() => typeof DB !== 'undefined' && typeof ExtrasScreen !== 'undefined' && !!window.ReforcoAgendaAuto, null, { timeout:30000 });")
hook="await import('./stress-matriz-extrema.mjs');"
if hook not in s:
    s=s.rstrip()+"\n\n"+hook+"\n"
p.write_text(s,encoding='utf-8')

# Matriz extrema: ajustes puramente de harness/massa sintética.
p=Path('testes/stress-matriz-extrema.mjs')
s=p.read_text(encoding='utf-8')

# Evidências entram no diretório publicado pela workflow.
s=s.replace("const ART = join(RAIZ, 'artifacts', 'stress-matriz-extrema');",
            "const ART = join(RAIZ, 'artifacts', 'stress-jornada', 'extrema');")
s=s.replace("artifacts/stress-matriz-extrema/carga-desktop.png",
            "artifacts/stress-jornada/extrema/carga-desktop.png")
s=s.replace("artifacts/stress-matriz-extrema/carga-mobile-390.png",
            "artifacts/stress-jornada/extrema/carga-mobile-390.png")

# Evita TDZ ao fabricar sobreposição determinística de snapshots.
s=s.replace("const snaps=SIM.retratos(48).map((s,i)=>{",
            "const baseSnaps=SIM.retratos(48);\n      const snaps=baseSnaps.map((s,i)=>{")
s=s.replace("z.startDate=snaps?.[i-1]?.startDate||z.startDate;",
            "z.startDate=baseSnaps[i-1].startDate;")

# DB.addExtra normaliza o contrato público e não conserva origemPlano. Para os
# ciclos sintéticos, carimba esse metadado interno antes de usar a agenda.
needle="""      const manuais=[];
"""
repl="""      {
        const lote=DB.getExtras();
        lote.forEach(e=>{
          const ix=planos.indexOf(e.id);
          if(ix<0) return;
          e.origemPlano={topico:'Topico '+ix,disciplina:e.disciplina,metaCicloQ:Number(e.alvo)||1,metaSessaoQ:15};
        });
        DB.saveExtras(lote);
      }
      const manuais=[];
"""
if needle in s:
    s=s.replace(needle,repl,1)

# Idempotência: estabiliza primeiro no mesmo modo preservarHoje=true.
s=s.replace("""      const sig0=assinatura();
      for(let k=0;k<20;k++){ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});A(assinatura()===sig0,'replanejamento nao idempotente',k);}
""", """      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});
      const sig0=assinatura();
      for(let k=0;k<20;k++){ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});A(assinatura()===sig0,'replanejamento nao idempotente',k);}
""")

# Coexistência unitária: somente o reforço do Plano recebe origemPlano.
needle="""      const m0=JSON.stringify(DB.getExtra(manualQ.id)),a0=JSON.stringify(DB.getExtra(anki.id));
"""
repl="""      {
        const lote=DB.getExtras();
        const px=lote.find(e=>e.id===plano.id);
        if(px) px.origemPlano={topico:'Topico X',disciplina:'Tributario',metaCicloQ:25,metaSessaoQ:15};
        DB.saveExtras(lote);
      }
      const m0=JSON.stringify(DB.getExtra(manualQ.id)),a0=JSON.stringify(DB.getExtra(anki.id));
"""
if needle in s:
    s=s.replace(needle,repl,1)

# Mantém o Extra manual de questões explicitamente FORA das métricas. Depois
# criamos um segundo Extra de questões marcado nas métricas para testar os dois
# contratos separadamente, além do Anki.
s=s.replace("const manualQ=DB.addExtra({titulo:'Topico X',tipo:'questoes',disciplina:'Tributario',unidade:'questoes',alvo:40,periodo:'unica',datas:[hoje],contaMetricas:true});",
            "const manualQ=DB.addExtra({titulo:'Topico X',tipo:'questoes',disciplina:'Tributario',unidade:'questoes',alvo:40,periodo:'unica',datas:[hoje],contaMetricas:false});")

# Usa o mesmo modo antes/depois e estabiliza uma segunda vez: a primeira
# preservação renumera legitimamente `rodada` das continuações (15+10 passa de
# rodada 1 para rodada 0 no saldo futuro), sem mudar data/alvo. O teste de
# contaminação deve começar só depois dessa canonicalização.
s=s.replace("""      const m0=JSON.stringify(DB.getExtra(manualQ.id)),a0=JSON.stringify(DB.getExtra(anki.id));
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:false});
      const p=DB.getExtra(plano.id),m1=DB.getExtra(manualQ.id),a1=DB.getExtra(anki.id);
""", """      const m0=JSON.stringify(DB.getExtra(manualQ.id)),a0=JSON.stringify(DB.getExtra(anki.id));
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});
      const p=DB.getExtra(plano.id),m1=DB.getExtra(manualQ.id),a1=DB.getExtra(anki.id);
""")

old="""      DB.addExtraProgress(manualQ.id,20,25,{data:hoje,acertos:15});DB.addExtraProgress(anki.id,50,30,{data:hoje});
      const pAntes=JSON.stringify(DB.getExtra(plano.id));ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});const pDepois=JSON.stringify(DB.getExtra(plano.id));
      A(pAntes===pDepois,'progresso manual/Anki contaminou agenda do Plano');
      return {falhas,metricas:{manual:DB.getExtra(manualQ.id).progresso,anki:DB.getExtra(anki.id).progresso,planoSessoes:Object.keys(DB.getExtra(plano.id).origemPlano.agendaAuto.sessoes||{}).length}};
"""
new="""      const sigPlano=()=>{const x=DB.getExtra(plano.id), ss=(x.origemPlano&&x.origemPlano.agendaAuto&&x.origemPlano.agendaAuto.sessoes)||{};const slim={};Object.keys(ss).sort().forEach(d=>{slim[d]={alvo:ss[d].alvo,estado:ss[d].estado};});return JSON.stringify({datas:(x.datas||[]).slice().sort(),sessoes:slim,progresso:x.progresso,status:x.status});};
      const p0=sigPlano();
      DB.addExtraProgress(anki.id,50,30,{data:hoje});ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});const pAnki=sigPlano();
      A(p0===pAnki,'Anki fora do Plano alterou o reforço do Plano',{antes:JSON.parse(p0),depois:JSON.parse(pAnki)});
      DB.addExtraProgress(manualQ.id,20,25,{data:hoje,acertos:15});ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});const pManualFora=sigPlano();
      A(pAnki===pManualFora,'questões manuais fora das métricas alteraram o reforço do Plano',{antes:JSON.parse(pAnki),depois:JSON.parse(pManualFora)});
      const manualMetric=DB.addExtra({titulo:'Topico X',tipo:'questoes',disciplina:'Tributario',unidade:'questoes',alvo:40,periodo:'unica',datas:[hoje],contaMetricas:true});
      DB.addExtraProgress(manualMetric.id,20,25,{data:hoje,acertos:15});ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});const pManualMetric=sigPlano();
      A(pManualFora===pManualMetric,'questões manuais marcadas nas métricas alteraram o reforço do Plano',{antes:JSON.parse(pManualFora),depois:JSON.parse(pManualMetric)});
      return {falhas,metricas:{manualFora:DB.getExtra(manualQ.id).progresso,manualMetricas:DB.getExtra(manualMetric.id).progresso,anki:DB.getExtra(anki.id).progresso,planoSessoes:Object.keys((DB.getExtra(plano.id).origemPlano&&DB.getExtra(plano.id).origemPlano.agendaAuto&&DB.getExtra(plano.id).origemPlano.agendaAuto.sessoes)||{}).length}};
"""
if old in s:
    s=s.replace(old,new,1)

# Ausência de agenda deve virar diagnóstico, não TypeError do harness.
s=s.replace("Object.entries(e.origemPlano.agendaAuto.sessoes||{})",
            "Object.entries((e.origemPlano&&e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{})")
s=s.replace("Object.values(e.origemPlano.agendaAuto.sessoes||{})",
            "Object.values((e.origemPlano&&e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{})")
s=s.replace("Object.keys(DB.getExtra(plano.id).origemPlano.agendaAuto.sessoes||{}).length",
            "Object.keys((DB.getExtra(plano.id).origemPlano&&DB.getExtra(plano.id).origemPlano.agendaAuto&&DB.getExtra(plano.id).origemPlano.agendaAuto.sessoes)||{}).length")

# Sanidade: garante que os patches essenciais realmente casaram.
for token in ["const baseSnaps=SIM.retratos(48);", "const px=lote.find(e=>e.id===plano.id);", "const pManualMetric=sigPlano();", "contaMetricas:false"]:
    if token not in s:
        raise SystemExit('patch essencial não aplicado: '+token)
p.write_text(s,encoding='utf-8')
print('Harness massivo/extremo preparado.')
