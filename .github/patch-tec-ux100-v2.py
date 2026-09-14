from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(path, old, new):
    p = ROOT / path
    txt = p.read_text(encoding='utf-8')
    if new in txt:
        return False
    if old not in txt:
        raise SystemExit(f'padrao nao encontrado em {path}: {old[:140]!r}')
    p.write_text(txt.replace(old, new, 1), encoding='utf-8')
    return True

# Corrige um typo capturado antes da primeira execução e mantém a chave do
# escopo sincronizada quando um render completo ocorre por importação/F5.
replace_once(
    'src/js/59-tec-auditoria-v2.js',
    "selecionados.length ? selecionados[selectedos.length - 1]?.insertAdjacentElement('afterend', divisor) : lista.prepend(divisor);",
    "selecionados.length ? selecionados[selecionados.length - 1]?.insertAdjacentElement('afterend', divisor) : lista.prepend(divisor);"
)
replace_once(
    'src/js/59-tec-auditoria-v2.js',
    "      };\n    },\n\n    selecionarDiverso(itens, cfg) {",
    "      };\n      if (!DT._tecV2RenderKeyInstalled) {\n        DT._tecV2RenderKeyInstalled = true;\n        const baseRender = DT.render;\n        DT.render = function() {\n          const out = baseRender.apply(this, arguments);\n          requestAnimationFrame(() => { self._renderedScopeKey = self.scopeKey(); });\n          return out;\n        };\n      }\n    },\n\n    selecionarDiverso(itens, cfg) {"
)

# Camadas finais: só apresentação/governança pós-motores, sem reescrever o
# núcleo monolítico do Plano.
replace_once(
    'build.mjs',
    "  SEP('\\n</style>\\n\\n<style id=\"extras-ux100-v1\">\\n'), S('css/18-extras-ux100.css'),\n  SEP('\\n</style>\\n\\n<script id=\"app-code\" type=\"application/x-diario-inert\">\\n'),",
    "  SEP('\\n</style>\\n\\n<style id=\"extras-ux100-v1\">\\n'), S('css/18-extras-ux100.css'),\n  SEP('\\n</style>\\n\\n<style id=\"tec-auditoria-v2\">\\n'), S('css/19-tec-auditoria-v2.css'),\n  SEP('\\n</style>\\n\\n<script id=\"app-code\" type=\"application/x-diario-inert\">\\n'),"
)
replace_once(
    'build.mjs',
    "    'js/59-extras-ux100.js',\n    'js/60-cloud-store.js',",
    "    'js/59-extras-ux100.js',\n    'js/59-tec-auditoria-v2.js',\n    'js/60-cloud-store.js',"
)

print('Patch TEC UX100 v2 aplicado/ja presente.')
