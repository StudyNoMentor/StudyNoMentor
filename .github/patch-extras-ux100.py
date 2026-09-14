from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(path, old, new):
    p = ROOT / path
    txt = p.read_text(encoding='utf-8')
    if new in txt:
        return False
    if old not in txt:
        raise SystemExit(f'padrao nao encontrado em {path}: {old[:120]!r}')
    p.write_text(txt.replace(old, new, 1), encoding='utf-8')
    return True

# A camada final precisa participar da montagem literal do index.html.
replace_once(
    'build.mjs',
    "  SEP('\\n</style>\\n\\n<style id=\"interaction-feedback-v1\">\\n'), S('css/17-interaction-feedback.css'),\n  SEP('\\n</style>\\n\\n<script id=\"app-code\" type=\"application/x-diario-inert\">\\n'),",
    "  SEP('\\n</style>\\n\\n<style id=\"interaction-feedback-v1\">\\n'), S('css/17-interaction-feedback.css'),\n  SEP('\\n</style>\\n\\n<style id=\"extras-ux100-v1\">\\n'), S('css/18-extras-ux100.css'),\n  SEP('\\n</style>\\n\\n<script id=\"app-code\" type=\"application/x-diario-inert\">\\n'),"
)
replace_once(
    'build.mjs',
    "    'js/59-interaction-feedback.js',\n    'js/60-cloud-store.js',",
    "    'js/59-interaction-feedback.js',\n    'js/59-extras-ux100.js',\n    'js/60-cloud-store.js',"
)

# Mantém a camada-base coerente com a hierarquia final, evitando código morto
# que descreva o comportamento antigo ao próximo mantenedor.
replace_once(
    'src/js/55-extras-ui-moderna.js',
    "    reorganizar() {\n      const screen = document.getElementById('screen-extras');\n      const curso = document.getElementById('extras-curso');\n      const toolbar = screen && screen.querySelector('.extras-toolbar');\n      if (screen && curso && toolbar && curso.nextElementSibling !== toolbar) {\n        screen.insertBefore(curso, toolbar);\n      }\n      if (toolbar) toolbar.classList.add('exm-toolbar');\n    },",
    "    reorganizar() {\n      const screen = document.getElementById('screen-extras');\n      if (!screen) return;\n      const header = screen.querySelector('.page-header');\n      const toolbar = screen.querySelector('.extras-toolbar');\n      const curso = document.getElementById('extras-curso');\n      const agenda = document.getElementById('extras-agenda');\n      const list = document.getElementById('extras-list');\n      if (header && toolbar && header.nextElementSibling !== toolbar) header.insertAdjacentElement('afterend', toolbar);\n      if (toolbar && curso && toolbar.nextElementSibling !== curso) toolbar.insertAdjacentElement('afterend', curso);\n      if (curso && agenda && curso.nextElementSibling !== agenda) curso.insertAdjacentElement('afterend', agenda);\n      if (agenda && list && agenda.nextElementSibling !== list) agenda.insertAdjacentElement('afterend', list);\n      if (toolbar) toolbar.classList.add('exm-toolbar');\n    },"
)
replace_once(
    'src/css/09-extras-v51.css',
    '/* A leitura principal da tela passa a ser: Reforços -> controles -> Atividades. */',
    '/* A camada operacional final usa: Configurações -> Reforços em curso -> Extras de hoje. */'
)

# A auditoria passa a ser uma barreira permanente do PR/main.
replace_once(
    '.github/workflows/verificar.yml',
    '#   · modais de Extras voltarem a se sobrepor ou a ativacao adaptativa travar;\n',
    '#   · modais de Extras voltarem a se sobrepor ou a ativacao adaptativa travar;\n#   · hierarquia, presets, bordas e responsividade do menu Extras regredirem;\n'
)
replace_once(
    '.github/workflows/verificar.yml',
    "      - name: Validar modais e ativacao adaptativa no navegador\n        run: node testes/extras-estabilidade-browser.mjs\n\n      # Perfil sintetico propositalmente grande:",
    "      - name: Validar modais e ativacao adaptativa no navegador\n        run: node testes/extras-estabilidade-browser.mjs\n\n      # Auditoria de UX do modulo inteiro: hierarquia Configuracoes -> Reforcos\n      # -> Hoje, quatro abas da Central, presets de Lei Seca/Adaptativo, bordas,\n      # overflow e responsividade em cinco larguras. Executa 100+ invariantes.\n      - name: Auditar UX completa de Extras\n        run: node testes/extras-ux100-browser.mjs\n\n      # Perfil sintetico propositalmente grande:"
)

# O título da agenda contém um pequeno botão informativo dentro do h2; o texto
# acessível pode terminar em "i". A asserção deve validar o rótulo, não o ícone.
replace_once(
    'testes/extras-ux100-browser.mjs',
    "  eq(visual.title,'Extras de hoje','agenda deve comunicar execução diária');",
    "  ok(visual.title.startsWith('Extras de hoje'),'agenda deve comunicar execução diária');"
)

# O editor adaptativo, por contrato, reabre a Central na aba Reforços ao fechar.
# Ao repetir a auditoria em outro viewport, reutiliza a Central que já voltou em
# vez de tentar clicar no botão que ficou atrás do overlay.
replace_once(
    'testes/extras-ux100-browser.mjs',
    "  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();});\n  await page.locator('#extras-settings-btn').click();\n  await page.locator('[data-xsc-tab=\"reforcos\"]').click();\n  await page.locator('[data-ra-open]').waitFor({state:'visible'});",
    "  await page.evaluate(()=>{switchScreen('extras');ExtrasScreen.render();});\n  await page.waitForTimeout(70);\n  if(!(await page.locator('.xsc-overlay').count())) await page.locator('#extras-settings-btn').click();\n  await page.locator('.xsc-overlay').waitFor({state:'visible'});\n  await page.locator('[data-xsc-tab=\"reforcos\"]').click();\n  await page.locator('[data-ra-open]').waitFor({state:'visible'});"
)

print('Patch UX100 aplicado/ja presente.')
