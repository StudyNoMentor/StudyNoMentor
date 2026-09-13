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

# O teste de contaminação deve usar o mesmo modo antes/depois e comparar apenas
# o estado funcional do reforço, não timestamps/metadados transitórios.
s=s.replace("""      const m0=JSON.stringify(DB.getExtra(manualQ.id)),a0=JSON.stringify(DB.getExtra(anki.id));
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:false});
      const p=DB.getExtra(plano.id),m1=DB.getExtra(manualQ.id),a1=DB.getExtra(anki.id);
""", """      const m0=JSON.stringify(DB.getExtra(manualQ.id)),a0=JSON.stringify(DB.getExtra(anki.id));
      ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});
      const p=DB.getExtra(plano.id),m1=DB.getExtra(manualQ.id),a1=DB.getExtra(anki.id);
""")
s=s.replace("""      const pAntes=JSON.stringify(DB.getExtra(plano.id));ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});const pDepois=JSON.stringify(DB.getExtra(plano.id));
      A(pAntes===pDepois,'progresso manual/Anki contaminou agenda do Plano');
""", """      const sigPlano=()=>{const x=DB.getExtra(plano.id);return JSON.stringify({datas:(x.datas||[]).slice(),sessoes:(x.origemPlano&&x.origemPlano.agendaAuto&&x.origemPlano.agendaAuto.sessoes)||{},progresso:x.progresso,status:x.status});};
      const pAntes=sigPlano();ReforcoAgendaAuto.replanejar(hoje,{preservarHoje:true});const pDepois=sigPlano();
      A(pAntes===pDepois,'progresso manual/Anki contaminou agenda do Plano');
""")

# Ausência de agenda deve virar diagnóstico, não TypeError do harness.
s=s.replace("Object.entries(e.origemPlano.agendaAuto.sessoes||{})",
            "Object.entries((e.origemPlano&&e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{})")
s=s.replace("Object.values(e.origemPlano.agendaAuto.sessoes||{})",
            "Object.values((e.origemPlano&&e.origemPlano.agendaAuto&&e.origemPlano.agendaAuto.sessoes)||{})")
s=s.replace("Object.keys(DB.getExtra(plano.id).origemPlano.agendaAuto.sessoes||{}).length",
            "Object.keys((DB.getExtra(plano.id).origemPlano&&DB.getExtra(plano.id).origemPlano.agendaAuto&&DB.getExtra(plano.id).origemPlano.agendaAuto.sessoes)||{}).length")

# Sanidade: garante que os patches essenciais realmente casaram.
for token in ["const baseSnaps=SIM.retratos(48);", "const px=lote.find(e=>e.id===plano.id);", "const sigPlano=()=>"]:
    if token not in s:
        raise SystemExit('patch essencial não aplicado: '+token)
p.write_text(s,encoding='utf-8')
print('Harness massivo/extremo preparado.')
