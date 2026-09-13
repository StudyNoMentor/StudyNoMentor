from pathlib import Path
p=Path('testes/extras-tec-interacoes-browser.mjs')
s=p.read_text()
old="""  const fechado=await page.evaluate(()=>{const e=DB.getExtras().find(x=>x.origemPlano&&x.origemPlano.topico);if(!e)return null;DB.setConcluidaDia(e.id,todayLocal(),true);const f=DB.getExtra(e.id);return{id:e.id,status:f.status,veredito:!!f.origemPlano?.veredito};});
  assert.ok(fechado&&fechado.status==='concluida'&&fechado.veredito,'conclusão de Extra do Plano deve selar o ciclo antes de testar a reabertura');"""
new="""  const fechado=await page.evaluate(()=>{
    const e=DB.getExtras().find(x=>x.origemPlano&&x.origemPlano.topico);if(!e)return null;
    const dbg={calls:0,erro:null,retorno:null,avaliar:null,origem:Object.keys(e.origemPlano||{}),selar:String(DB._selarCicloDoPlano).slice(0,260)};
    const base=PlanoCiclo.vereditoManual;
    PlanoCiclo.vereditoManual=function(){dbg.calls++;try{const r=base.apply(this,arguments);dbg.retorno=r;return r;}catch(err){dbg.erro=String(err&&err.stack||err);throw err;}};
    try{dbg.avaliar=PlanoCiclo.avaliar(e,{itens:[],pequenas:[]},null);}catch(err){dbg.avaliarErro=String(err&&err.stack||err);}
    DB.setConcluidaDia(e.id,todayLocal(),true);
    PlanoCiclo.vereditoManual=base;
    const f=DB.getExtra(e.id);return{id:e.id,status:f.status,veredito:!!f.origemPlano?.veredito,dbg};
  });
  assert.ok(fechado&&fechado.status==='concluida'&&fechado.veredito,`conclusão de Extra do Plano deve selar o ciclo antes de testar a reabertura: ${JSON.stringify(fechado)}`);"""
if s.count(old)!=1:
    raise SystemExit(f'bloco de diagnóstico não encontrado: {s.count(old)}')
p.write_text(s.replace(old,new,1))
