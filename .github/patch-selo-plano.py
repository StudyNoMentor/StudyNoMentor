from pathlib import Path
p=Path('src/js/11-db.js')
s=p.read_text()
old="if (window.PlanoCiclo && typeof PlanoCiclo.vereditoManual === 'function') PlanoCiclo.vereditoManual(e);"
new="if (typeof PlanoCiclo !== 'undefined' && PlanoCiclo && typeof PlanoCiclo.vereditoManual === 'function') PlanoCiclo.vereditoManual(e);"
if s.count(old) != 1:
    raise SystemExit(f'esperava 1 guarda window.PlanoCiclo, achei {s.count(old)}')
p.write_text(s.replace(old,new,1))
