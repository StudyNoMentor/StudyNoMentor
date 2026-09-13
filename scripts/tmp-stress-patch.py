from pathlib import Path
p=Path('testes/stress-jornada-massiva.mjs')
s=p.read_text(encoding='utf-8')
s=s.replace("await page.waitForFunction(() => window.DB && window.ExtrasScreen && window.PlanoEngine && window.PlanoCiclo && window.ReforcoAgendaAuto, null, { timeout: 30000 });",
"await page.waitForFunction(() => typeof DB !== 'undefined' && typeof ExtrasScreen !== 'undefined' && typeof PlanoEngine !== 'undefined' && typeof PlanoCiclo !== 'undefined' && !!window.ReforcoAgendaAuto, null, { timeout: 30000 });")
s=s.replace("await page.waitForFunction(() => window.DB && window.ExtrasScreen && window.ReforcoAgendaAuto, null, { timeout:30000 });",
"await page.waitForFunction(() => typeof DB !== 'undefined' && typeof ExtrasScreen !== 'undefined' && !!window.ReforcoAgendaAuto, null, { timeout:30000 });")
if "window.PlanoEngine && window.PlanoCiclo" in s:
    raise SystemExit('wait global lexical ainda incorreto')
p.write_text(s,encoding='utf-8')
print('Patch da auditoria aplicado.')
