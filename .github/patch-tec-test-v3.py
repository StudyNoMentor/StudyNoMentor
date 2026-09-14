from pathlib import Path
p=Path('testes/tec-ux100-browser.mjs')
s=p.read_text(encoding='utf-8')
old='''  ok(await futureCard.count()===1,'Extra futuro concluído não pode desaparecer da visão Próximas');
  eq((await futureCard.locator('.exd-check').getAttribute('aria-label')),'Reabrir atividade','Extra futuro concluído deve oferecer reabertura');
  await futureCard.locator('.exd-check').click();await page.waitForTimeout(160);
  eq(await page.evaluate(({id,day})=>DB.extraConcluidaEm(DB.getExtra(id),day),fut),false,'reabrir deve remover conclusão futura preservando a atividade');
  await snap('03-extra-futuro-reaberto.png');

  // Futuro não concluído continua protegido contra conclusão antecipada.
  await page.locator(`.exd[data-id="${fut.id}"][data-day="${fut.day}"] .exd-check`).click();await page.waitForTimeout(100);
'''
new='''  ok(await futureCard.count()===1,'Extra futuro concluído não pode desaparecer da visão Próximas');
  eq((await futureCard.locator('.exd-check').getAttribute('aria-label')),'Reabrir atividade','Extra futuro concluído deve oferecer reabertura');
  // A UX v3 deixa “Próximas” deliberadamente minimizada no overview. O teste
  // continua cobrando a reabertura real, mas expande o painel antes de interagir.
  let prox=page.locator('details.exm-section-proximas');
  if(await prox.count() && !(await prox.getAttribute('open'))) await prox.locator('summary').click();
  await futureCard.locator('.exd-check').click();await page.waitForTimeout(160);
  eq(await page.evaluate(({id,day})=>DB.extraConcluidaEm(DB.getExtra(id),day),fut),false,'reabrir deve remover conclusão futura preservando a atividade');
  await snap('03-extra-futuro-reaberto.png');

  // Futuro não concluído continua protegido contra conclusão antecipada. O
  // rerender fecha Próximas novamente por design, então reabrimos o painel.
  prox=page.locator('details.exm-section-proximas');
  if(await prox.count() && !(await prox.getAttribute('open'))) await prox.locator('summary').click();
  await page.locator(`.exd[data-id="${fut.id}"][data-day="${fut.day}"] .exd-check`).click();await page.waitForTimeout(100);
'''
if s.count(old)!=1: raise SystemExit(f'match esperado 1, encontrado {s.count(old)}')
p.write_text(s.replace(old,new,1),encoding='utf-8')
print('tec-ux100 adaptado ao painel Próximas recolhido')
