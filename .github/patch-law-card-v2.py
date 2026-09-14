from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text(encoding='utf-8')
    if new in s:
        return False
    if old not in s:
        raise SystemExit(f'bloco nao encontrado em {path}: {old[:80]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')
    return True

css = Path('src/css/18-extras-ux100.css')
s = css.read_text(encoding='utf-8')
old = """#extras-list .lr-extra-card.ux100-law-task{\n  border-color:color-mix(in srgb,#0f9d63 40%,var(--border))!important;\n}\n"""
new = """#extras-list .lr-extra-card.ux100-law-task{\n  background:var(--surface)!important;\n}\n#extras-list .lr-extra-card.ux100-law-task:not(.is-concluidas){\n  border-color:color-mix(in srgb,var(--text-faint) 30%,var(--border))!important;\n}\n#extras-list .lr-extra-card.ux100-law-task:not(.is-concluidas)::before{\n  background:var(--accent)!important;\n  opacity:.72;\n}\n#extras-list .lr-extra-card.ux100-law-task.is-concluidas{\n  border-color:color-mix(in srgb,var(--good) 44%,var(--border))!important;\n  background:color-mix(in srgb,var(--good-soft) 26%,var(--surface))!important;\n}\n"""
if new not in s:
    if old not in s:
        raise SystemExit('bloco base da Lei Seca nao encontrado')
    s = s.replace(old, new, 1)

s = s.replace('  margin:9px 0 7px 78px;\n', '  margin:12px 0 7px 78px;\n', 1)
s = s.replace('  border:1.25px solid color-mix(in srgb,#0f9d63 34%,var(--border));\n', '  border:1.25px solid color-mix(in srgb,var(--text-faint) 26%,var(--border));\n', 1)
s = s.replace('  background:color-mix(in srgb,#0f9d63 6%,var(--surface));\n', '  background:color-mix(in srgb,var(--accent) 2.5%,var(--surface));\n', 1)
s = s.replace('#extras-list .ux100-law-task .lr-route-main small{font-size:9px}\n', '#extras-list .ux100-law-task .lr-route-main small{font-size:9px;color:var(--text-muted)}\n', 1)
s = s.replace('#extras-list .ux100-law-task .lr-route .btn-secondary{min-height:36px;padding:6px 10px;white-space:nowrap;border-color:color-mix(in srgb,#0f9d63 28%,var(--border))}\n', '#extras-list .ux100-law-task .lr-route .btn-secondary{min-height:36px;padding:6px 10px;white-space:nowrap;border-color:color-mix(in srgb,var(--accent) 18%,var(--border))}\n', 1)

mobile = """

/* Lei seca aberta: ações pertencem ao cabeçalho e nunca encostam no bloco de leitura. */
@media(max-width:390px){
  #extras-list .ux100-law-task .exd-top{
    grid-template-columns:25px 36px minmax(0,1fr) auto;
    align-items:start;
  }
  #extras-list .ux100-law-task .exd-actions{
    grid-column:4;
    grid-row:1;
    align-self:start;
    justify-self:end;
    margin:0 0 8px;
  }
  #extras-list .ux100-law-task .lr-route{margin:12px 0 7px}
}
"""
if 'Lei seca aberta: ações pertencem ao cabeçalho' not in s:
    s += mobile
css.write_text(s, encoding='utf-8')

test = Path('testes/extras-ux100-browser.mjs')
t = test.read_text(encoding='utf-8')
needle = """  ok(visual.title.startsWith('Extras de hoje'),'agenda deve comunicar execução diária');\n  if(width<=430){\n"""
insert = """  ok(visual.title.startsWith('Extras de hoje'),'agenda deve comunicar execução diária');\n  const law=await page.evaluate(()=>{\n    const card=document.querySelector('#extras-list .ux100-law-task');\n    if(!card)return{exists:false};\n    const route=card.querySelector('.lr-route'),actions=card.querySelector('.exd-actions');\n    const probe=document.createElement('i');probe.style.cssText='position:fixed;left:-9999px;background:var(--surface)';document.body.appendChild(probe);\n    const surface=getComputedStyle(probe).backgroundColor;probe.remove();\n    const rr=route?.getBoundingClientRect(),ar=actions?.getBoundingClientRect();\n    return{exists:true,bg:getComputedStyle(card).backgroundColor,surface,concluded:card.classList.contains('is-concluidas'),gap:rr&&ar?rr.top-ar.bottom:999};\n  });\n  ok(law.exists,'Lei seca precisa estar presente no cenário de auditoria');\n  ok(!law.concluded,'Lei seca de hoje aberta não pode usar estado visual de concluída');\n  eq(law.bg,law.surface,'Lei seca aberta deve manter fundo neutro do surface');\n  ok(law.gap>=6,`ações da Lei seca precisam ficar separadas do bloco de leitura (${law.gap.toFixed(1)}px)`);\n  if(width<=430){\n"""
if 'Lei seca aberta deve manter fundo neutro do surface' not in t:
    if needle not in t:
        raise SystemExit('ponto de insercao da auditoria de Lei Seca nao encontrado')
    t = t.replace(needle, insert, 1)
test.write_text(t, encoding='utf-8')

print('Patch Lei Seca v2 aplicado com auditoria geométrica.')
