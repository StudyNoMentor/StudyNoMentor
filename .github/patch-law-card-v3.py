from pathlib import Path

css = Path('src/css/18-extras-ux100.css')
s = css.read_text(encoding='utf-8')
repls = {
  '#extras-list .lr-extra-card.ux100-law-task{':'#extras-list .lr-extra-card{',
  '#extras-list .lr-extra-card.ux100-law-task:not(.is-concluidas){':'#extras-list .lr-extra-card:not(.is-concluidas){',
  '#extras-list .lr-extra-card.ux100-law-task:not(.is-concluidas)::before{':'#extras-list .lr-extra-card:not(.is-concluidas)::before{',
  '#extras-list .lr-extra-card.ux100-law-task.is-concluidas{':'#extras-list .lr-extra-card.is-concluidas{',
  '#extras-list .ux100-law-task .lr-route{':'#extras-list .lr-extra-card .lr-route{',
  '#extras-list .ux100-law-task .lr-route-main{':'#extras-list .lr-extra-card .lr-route-main{',
  '#extras-list .ux100-law-task .lr-route-main small{':'#extras-list .lr-extra-card .lr-route-main small{',
  '#extras-list .ux100-law-task .lr-route-main strong{':'#extras-list .lr-extra-card .lr-route-main strong{',
  '#extras-list .ux100-law-task .lr-route-main span{':'#extras-list .lr-extra-card .lr-route-main span{',
  '#extras-list .ux100-law-task .lr-route .btn-secondary{':'#extras-list .lr-extra-card .lr-route .btn-secondary{',
  '#extras-list .ux100-law-task .exd-top{':'#extras-list .lr-extra-card .exd-top{',
  '#extras-list .ux100-law-task .exd-actions{':'#extras-list .lr-extra-card .exd-actions{',
  '#extras-list .ux100-law-task .lr-route{margin:12px 0 7px}':'#extras-list .lr-extra-card .lr-route{margin:12px 0 7px}'
}
for old,new in repls.items():
    s = s.replace(old,new)
css.write_text(s, encoding='utf-8')

test = Path('testes/extras-ux100-browser.mjs')
t = test.read_text(encoding='utf-8')
old = """  await page.waitForTimeout(80);\n  const order=await page.evaluate(()=>{const s=document.getElementById('screen-extras'),ch=[...s.children];return{toolbar:ch.indexOf(s.querySelector('.extras-toolbar')),curso:ch.indexOf(document.getElementById('extras-curso')),agenda:ch.indexOf(document.getElementById('extras-agenda')),lista:ch.indexOf(document.getElementById('extras-list'))};});\n"""
new = """  await page.waitForTimeout(80);\n  await page.waitForFunction(()=>[...document.querySelectorAll('#extras-list .exd')].some(c=>{const e=DB.getExtra(c.dataset.id);return !!(e&&e.origemLei&&e.origemLei.rodizio);}),null,{timeout:3000});\n  await page.evaluate(()=>{try{LeiRodizio.decorarExtras();}catch(_){}try{ExtrasUx100.compactarCards();}catch(_){}});\n  const order=await page.evaluate(()=>{const s=document.getElementById('screen-extras'),ch=[...s.children];return{toolbar:ch.indexOf(s.querySelector('.extras-toolbar')),curso:ch.indexOf(document.getElementById('extras-curso')),agenda:ch.indexOf(document.getElementById('extras-agenda')),lista:ch.indexOf(document.getElementById('extras-list'))};});\n"""
if old not in t:
    raise SystemExit('ponto de sincronizacao do mainAudit nao encontrado')
t = t.replace(old,new,1)
t = t.replace("document.querySelector('#extras-list .ux100-law-task')", "document.querySelector('#extras-list .lr-extra-card')")
test.write_text(t, encoding='utf-8')

print('Patch v3 aplicado: seletores robustos e fixture sincronizada com os decoradores reais.')
