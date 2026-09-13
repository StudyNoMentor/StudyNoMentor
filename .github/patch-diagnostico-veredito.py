from pathlib import Path
p=Path('testes/extras-tec-interacoes-browser.mjs')
s=p.read_text()
old="""  const fechado=await page.evaluate(()=>{const e=DB.getExtras().find(x=>x.origemPlano&&x.origemPlano.topico);if(!e)return null;DB.setConcluidaDia(e.id,todayLocal(),true);const f=DB.getExtra(e.id);return{id:e.id,status:f.status,veredito:!!f.origemPlano?.veredito};});
  assert.ok(fechado&&fechado.status==='concluida'&&fechado.veredito,'conclusão de Extra do Plano deve selar o ciclo antes de testar a reabertura');"""
new="""  const fechado=await page.evaluate(()=>{
    const e=DB.getExtras().find(x=>x.origemPlano&&x.origemPlano.topico);if(!e)return null;
    // O checkbox do card é conclusão da MISSÃO DIÁRIA para reforços gerenciados.
    // Para testar uma conclusão global acidental usamos a mesma porta do botão
    // “Encerrar ciclo”, que sela o veredito e pode depois ser desfeita.
    ReforcoFila.encerrarCiclo(e.id);
    const f=DB.getExtra(e.id);
    return{id:e.id,status:f.status,veredito:!!f.origemPlano?.veredito,feito:f.progresso||0,alvo:f.alvo};
  });
  assert.ok(fechado&&fechado.status==='concluida'&&fechado.veredito,`encerramento global da Extra do Plano deve selar o ciclo antes de testar a reabertura: ${JSON.stringify(fechado)}`);"""
if s.count(old)!=1:
    raise SystemExit(f'bloco de conclusão global não encontrado: {s.count(old)}')
p.write_text(s.replace(old,new,1))
