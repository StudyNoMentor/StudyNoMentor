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
    "    _lastPlanResult: null,\n    _observer: null,",
    "    _lastPlanResult: null,\n    _poolC: null,\n    _observer: null,"
)
replace_once(
    'src/js/59-tec-auditoria-v2.js',
    "      PE._indiceC = new WeakMap();\n    },",
    "      PE._indiceC = new WeakMap();\n      this._poolC = null;\n    },"
)
replace_once(
    'src/js/59-tec-auditoria-v2.js',
    "      };\n    },\n\n    selecionarDiverso(itens, cfg) {",
    "      };\n      if (!DT._tecV2RenderKeyInstalled) {\n        DT._tecV2RenderKeyInstalled = true;\n        const baseRender = DT.render;\n        DT.render = function() {\n          const out = baseRender.apply(this, arguments);\n          requestAnimationFrame(() => { self._renderedScopeKey = self.scopeKey(); });\n          return out;\n        };\n      }\n    },\n\n    poolAmplo(cfg) {\n      const p0 = Object.assign({}, PE.prefs ? PE.prefs() : {}, cfg || {});\n      const opts = Object.assign({}, p0, { foco: [], disciplina: '__todas__', limite: Math.max(240, Number(p0.limite) || 0) });\n      const key = this.scopeKey() + '|' + JSON.stringify(opts);\n      const agora = Date.now();\n      if (this._poolC && this._poolC.key === key && agora - this._poolC.t < 4000) return this._poolC.itens;\n      let r = null;\n      try { r = PE.calcular(DT.scopedSnapshot(), opts); } catch (_) { return []; }\n      if (!r || r.erro) return [];\n      const vistos = new Set(), itens = [];\n      const add = (x, pequena) => {\n        if (!x || !x.nome) return;\n        const k = norm(x.disciplina) + '|' + norm(x.nome);\n        if (vistos.has(k)) return;\n        vistos.add(k);\n        itens.push(pequena ? Object.assign({}, x, { custoQ: Number(x.custoQ) || Number(x.faltaAmostra) || 1, _diagnostico: true }) : x);\n      };\n      (r.itens || []).forEach(x => add(x, false));\n      (r.pequenas || []).forEach(x => add(x, true));\n      this._poolC = { key, t: agora, itens };\n      return itens;\n    },\n\n    selecionarDiverso(itens, cfg) {"
)
replace_once(
    'src/js/59-tec-auditoria-v2.js',
    "      const fonte = (r && Array.isArray(r.itens) && r.itens.length)\n        ? r.itens\n        : [...lista.querySelectorAll('.pl-hoje-sel')].map(c => ({ nome:c.dataset.topico, disciplina:c.dataset.disc, custoQ:Number(c.dataset.alvo)||1, extraAberta:c.disabled }));\n      const escolhidos = this.selecionarDiverso(fonte, prefs);",
    "      let fonte = (r && Array.isArray(r.itens) && r.itens.length)\n        ? r.itens.slice()\n        : [...lista.querySelectorAll('.pl-hoje-sel')].map(c => ({ nome:c.dataset.topico, disciplina:c.dataset.disc, custoQ:Number(c.dataset.alvo)||1, extraAberta:c.disabled }));\n      const focoSet = new Set(foco.map(norm));\n      const alvoDisc = Math.min(focoSet.size || Math.max(1, Number(prefs.sugestoesDisciplinas)||3), Math.max(1, Number(prefs.sugestoesDisciplinas)||3));\n      const presentes = new Set(fonte.filter(x => !x.extraAberta && (!focoSet.size || focoSet.has(norm(x.disciplina)))).map(x => norm(x.disciplina))).size;\n      if (alvoDisc > 1 && presentes < alvoDisc) {\n        const amplo = this.poolAmplo(prefs);\n        const vistos = new Set(fonte.map(x => this._chaveItem(x)));\n        amplo.forEach(x => { const k=this._chaveItem(x); if (!vistos.has(k)) { vistos.add(k); fonte.push(x); } });\n      }\n      const escolhidos = this.selecionarDiverso(fonte, prefs);"
)
replace_once(
    'src/js/59-tec-auditoria-v2.js',
    "      const escolhidos = this.selecionarDiverso(cand, PE.prefs());\n      if (!escolhidos.length) return;\n      const keys = new Set(escolhidos.map(x => this._chaveItem(x)));\n      ExtrasScreen._planoSel = new Set();\n      cand.forEach((x,i)=>{ if(keys.has(this._chaveItem(x))) ExtrasScreen._planoSel.add(i); });",
    "      const prefs = PE.prefs();\n      let fonte = cand.slice();\n      const foco = Array.isArray(prefs.foco) ? prefs.foco.filter(Boolean) : [];\n      if (foco.length > 1) {\n        const vistos = new Set(fonte.map(x => this._chaveItem(x)));\n        this.poolAmplo(prefs).forEach(x => {\n          const k=this._chaveItem(x);\n          if (!vistos.has(k) && !x.extraAberta) {\n            vistos.add(k);\n            fonte.push(Object.assign({}, x, { motivo:x._diagnostico?'diagnostico':'reforco', alvo:Number(x.custoQ)||Number(x.faltaAmostra)||1 }));\n          }\n        });\n      }\n      const escolhidos = this.selecionarDiverso(fonte, prefs);\n      if (!escolhidos.length) return;\n      const keys = new Set(escolhidos.map(x => this._chaveItem(x)));\n      escolhidos.forEach(x => {\n        const k=this._chaveItem(x);\n        if (!cand.some(y => this._chaveItem(y)===k)) cand.push(x);\n      });\n      ExtrasScreen._planoCand = cand;\n      ExtrasScreen._planoSel = new Set();\n      cand.forEach((x,i)=>{ if(keys.has(this._chaveItem(x))) ExtrasScreen._planoSel.add(i); });"
)

# Um ciclo do Plano pode ser encerrado num dia em que aquela frente não tinha
# parcela diária (por exemplo, ao encerrar pelo painel de reforços). O estado
# global é válido, mas a lista moderna de Extras só olhava ocorrências do dia e
# o ciclo desaparecia. A data do veredito passa a ser uma ocorrência lógica de
# conclusão: isso o torna visível/reabrível sem inventar meta diária executada.
replace_once(
    'src/js/59-tec-auditoria-v2.js',
    "    instalarReaberturaFutura() {\n      if (typeof ExtrasModern === 'undefined' || typeof ExtrasScreen === 'undefined') return;",
    "    instalarReaberturaFutura() {\n      if (typeof DB !== 'undefined' && typeof DB.extraConcluidaEm === 'function' && !DB.extraConcluidaEm._tecV2GlobalClose) {\n        const baseConcluida = DB.extraConcluidaEm;\n        const concluidaComFechamento = function(e, dia) {\n          if (baseConcluida.call(this, e, dia)) return true;\n          if (!e || e.status !== 'concluida' || !e.origemPlano || !e.origemPlano.veredito) return false;\n          const ref = String(e.origemPlano.veredito.em || e.updatedAt || '').slice(0, 10);\n          return !!ref && ref === String(dia || todayLocal()).slice(0, 10);\n        };\n        concluidaComFechamento._tecV2GlobalClose = true;\n        DB.extraConcluidaEm = concluidaComFechamento;\n      }\n      if (typeof ExtrasModern === 'undefined' || typeof ExtrasScreen === 'undefined') return;"
)
replace_once(
    'src/js/59-tec-auditoria-v2.js',
    "          const hoje = todayLocal(), existentes = new Set((c.proximas||[]).map(e=>`${e.x.id}@${e.day}`));\n          for (let i=1;i<=this.janelaProximas;i++) {\n            const day=this.addDays(hoje,i);\n            screen.occurrencesForDay(day).forEach(x=>{\n              const k=`${x.id}@${day}`;\n              if (!existentes.has(k) && DB.extraConcluidaEm(x,day)) {\n                c.proximas.push({x,day,bucket:'proximas',futureDone:true}); existentes.add(k);\n              }\n            });\n          }\n          return c;",
    "          const hoje = todayLocal(), existentes = new Set((c.proximas||[]).map(e=>`${e.x.id}@${e.day}`));\n          for (let i=1;i<=this.janelaProximas;i++) {\n            const day=this.addDays(hoje,i);\n            screen.occurrencesForDay(day).forEach(x=>{\n              const k=`${x.id}@${day}`;\n              if (!existentes.has(k) && DB.extraConcluidaEm(x,day)) {\n                c.proximas.push({x,day,bucket:'proximas',futureDone:true}); existentes.add(k);\n              }\n            });\n          }\n          const concluidas = Array.isArray(c.concluidas) ? c.concluidas : (c.concluidas = []);\n          const concluidasIds = new Set(concluidas.map(e=>e.x&&e.x.id).filter(Boolean));\n          const inicio = this.addDays(hoje, -(Math.max(1, Number(this.janelaConcluidas)||7) - 1));\n          const extras = DB._extrasReadSnapshot || DB.getExtras();\n          extras.forEach(x=>{\n            if (!x || x.status !== 'concluida' || !x.origemPlano || !x.origemPlano.topico || !x.origemPlano.veredito || concluidasIds.has(x.id)) return;\n            let day = String(x.origemPlano.veredito.em || x.updatedAt || hoje).slice(0,10);\n            if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) day = hoje;\n            if (day > hoje) day = hoje;\n            if (day < inicio) return;\n            concluidas.push({x,day,bucket:'concluidas',globalDone:true});\n            concluidasIds.add(x.id);\n            c.concluidas7d = (Number(c.concluidas7d)||0) + 1;\n          });\n          return c;"
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

# Diagnóstico temporário da primeira barreira: se a composição falhar, o log
# mostra imediatamente se a perda aconteceu no motor, na seleção ou no DOM.
replace_once(
    'testes/tec-ux100-browser.mjs',
    "  const bloco=await page.evaluate(()=>{const cs=[...document.querySelectorAll('#plano-lista .pl-hoje-sel:checked:not(:disabled)')];return{n:cs.length,discs:[...new Set(cs.map(c=>c.dataset.disc))],txt:document.querySelector('.tec-v2-diversidade')?.textContent||''};});\n  eq(bloco.n,3,'3 disciplinas × 1 tópico deve gerar bloco inicial de 3 assuntos');",
    "  const bloco=await page.evaluate(()=>{const cs=[...document.querySelectorAll('#plano-lista .pl-hoje-sel:checked:not(:disabled)')];return{n:cs.length,discs:[...new Set(cs.map(c=>c.dataset.disc))],txt:document.querySelector('.tec-v2-diversidade')?.textContent||''};});\n  const diagBloco=await page.evaluate(()=>({prefs:PlanoEngine.prefs(),last:(TecAuditoriaV2._lastPlanResult?.itens||[]).slice(0,80).map(x=>({d:x.disciplina,n:x.nome,q:x.custoQ,open:!!x.extraAberta})),pool:(TecAuditoriaV2._poolC?.itens||[]).slice(0,240).map(x=>({d:x.disciplina,n:x.nome,q:x.custoQ,open:!!x.extraAberta})),dom:[...document.querySelectorAll('#plano-lista .pl-hoje-sel')].map(x=>({d:x.dataset.disc,n:x.dataset.topico,on:x.checked,off:x.disabled}))}));\n  console.log('DIAG_BLOCO',JSON.stringify(diagBloco));\n  await snap('00-diag-plano-multifoco.png');\n  eq(bloco.n,3,'3 disciplinas × 1 tópico deve gerar bloco inicial de 3 assuntos');"
)

# O banco proíbe corretamente CRIAR uma conclusão futura. A regressão que o
# usuário reportou é um estado já concluído vindo de versão/sincronização antiga:
# ele precisa continuar visível e poder ser reaberto. Simulamos esse estado
# legado diretamente, sem enfraquecer a guarda de integridade do banco.
replace_once(
    'testes/tec-ux100-browser.mjs',
    "const e=DB.addExtra({titulo:'Extra futuro reabrível',tipo:'questoes',alvo:18,unidade:'questoes',periodo:'unica',datas:[day]});DB.setConcluidaDia(e.id,day,true);switchScreen('extras');",
    "const e=DB.addExtra({titulo:'Extra futuro reabrível',tipo:'questoes',alvo:18,unidade:'questoes',periodo:'unica',datas:[day]});const all=DB.getExtras();const legacy=all.find(x=>x.id===e.id);legacy.status='concluida';DB.saveExtras(all);switchScreen('extras');"
)

print('Patch TEC UX100 v2 aplicado/ja presente.')
