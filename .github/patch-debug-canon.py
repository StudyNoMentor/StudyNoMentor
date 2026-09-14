from pathlib import Path
p=Path('verificar.mjs')
s=p.read_text(encoding='utf-8')
old="if (caixas.length < 2) return { poucas: caixas.length };"
new="""if (caixas.length < 2) {
      let r=null; try { r=PlanoEngine.calcular(DesempenhoTecScreen.scopedSnapshot(),PlanoEngine.prefs()); } catch(_) {}
      return { poucas: caixas.length, prefs: PlanoEngine.prefs(), dom:[...document.querySelectorAll('.pl-hoje-sel')].map(c=>({d:c.dataset.disc,t:c.dataset.topico,off:c.disabled,on:c.checked})), itens:(r&&r.itens||[]).slice(0,20).map(x=>({d:x.disciplina,t:x.nome,open:!!x.extraAberta,membros:(x.membros||[]).length})), extras:DB.getExtras().filter(x=>x.origemPlano&&x.origemPlano.topico).map(x=>({d:x.origemPlano.disciplina,t:x.origemPlano.topico,status:x.status,membros:(x.origemPlano.membros||[]).length})) };
    }"""
if new not in s:
    if old not in s: raise SystemExit('padrao debug nao encontrado')
    p.write_text(s.replace(old,new,1),encoding='utf-8')
print('debug canon aplicado')
