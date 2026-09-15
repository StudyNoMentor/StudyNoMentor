import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('src/js/99-tec-lacunas-continuas.js');
const guards = read('src/js/99b-tec-lacunas-guardas.js');
const css = read('src/css/29-tec-lacunas-continuas.css');
const build = read('build.mjs');

const checks = [
  ['memória é global do perfil, não do planejamento', js.includes("DB._profilePrefix() + KEY") && !js.includes("DB.KEYS + KEY")],
  ['caderno é contexto e não existe meta fixa de 400', !/\b400\b/.test(js) && js.includes('bookId')],
  ['questões distintas são deduplicadas por ID', js.includes('wrongIds:new Set()') && js.includes('g.wrongIds.add(id)')],
  ['tentativas repetidas medem resistência', js.includes('repeatErrors') && js.includes('prev.wrong>0')],
  ['favoritas podem coexistir sem duplicar a questão', js.includes('eventFavorite') && js.includes('favoriteWrongIds:new Set()')],
  ['base/erradas/favoritas são contexto inferível, não regra estrutural', js.includes("return 'favoritas'") && js.includes("return 'erradas'") && js.includes("return 'nao-identificada'")],
  ['reforço usa somente o histórico pessoal', js.includes("source:'historico-tec'") && js.includes('questionPool(topic)')],
  ['biblioteca antiga/importada também alimenta a memória sem duplicar realtime', guards.includes("source:'library-backfill'") && guards.includes('covered.has(sig)') && guards.includes("typeof question.acertou!=='boolean'")],
  ['não há criação de filtro ou busca de questão nova no TEC', !/filtrar.*TEC|nova[s]? quest[oõ]es.*TEC/i.test(js)],
  ['dose diária é baixa e limitada', js.includes('MAX_DISCIPLINAS_DIA = 3') && js.includes('QUESTOES_MICRO = 3') && js.includes('QUESTOES_PADRAO = 5') && js.includes('QUESTOES_PERSISTENTE = 6') && js.includes('MAX_QUESTOES_DIA = 18')],
  ['rodízio semanal evita repetir matéria sem necessidade', js.includes('ROTACAO_DIAS = 7') && js.includes('yesterdayPenalty') && js.includes('weeklyPenalty')],
  ['uma matéria fornece no máximo um tópico por dia', js.includes('usedDisc.has(norm(t.disciplina))') && js.includes('usedDisc.add(norm(t.disciplina))')],
  ['teto de três matérias vale no dia inteiro, inclusive após concluir reforços', guards.includes('const remaining=Math.max(0,3-used.size)') && guards.includes("a.status!=='deferred'") && guards.includes('.slice(0,remaining)')],
  ['ciclo aceita matéria tanto em string quanto objeto', guards.includes("typeof s==='string'?s")],
  ['primeiro erro já pode entrar como microcorreção', js.includes("return 'Erro recente: microcorreção'") && js.includes("g.wrongIds.size>=2?'ativa':'inicial'")],
  ['zeragem natural reconhece quando todo ID errado termina correto', guards.includes('t.naturalRecovered=') && guards.includes('t.unresolvedWrong===0') && guards.includes("t.status='corrigida-na-rodada'")],
  ['zeragem natural cria resfriamento curto sem declarar domínio permanente', guards.includes('t.naturalCooldown') && guards.includes('ageDays(lastCorrection)<2') && guards.includes("filter(r=>!r.naturalCooldown)")],
  ['pool privilegia erro ainda aberto e usa questões corrigidas como consolidação', guards.includes('a.lastResult===false?0') && guards.includes("return String(a.lastSeen||'').localeCompare")],
  ['persistência pós-reforço aumenta prioridade', js.includes('postErrors>=2') && js.includes("status=persistent?'persistente'")],
  ['melhora posterior reduz prioridade', js.includes('postRate>=0.8') && js.includes('(improving?35:0)')],
  ['planejamento atual funciona como lente', js.includes('relevantToCurrentPlan') && js.includes('currentSubjects()')],
  ['troca de planejamento não apaga lacunas globais', js.includes("a.status='deferred'") && js.includes("rec.planId=planId")],
  ['reforço é espelhado em Extras com identidade global', js.includes('origemLacunaGlobal') && js.includes('assignmentId:a.id')],
  ['histórico de reforço é reconciliado entre planejamentos', js.includes('PlanManager.getPlans') && js.includes('allPlanExtras()')],
  ['progresso global usa offset do espelho e sobrevive à remoção do plano antigo', guards.includes('o.globalProgressBefore') && guards.includes('if (reached>progress) progress=reached') && guards.includes('assignment&&assignment.progress')],
  ['conclusão do reforço também fica no ledger global', guards.includes("source:'global-ledger'") && guards.includes("a.status!=='completed'")],
  ['mesmo reforço pode continuar após troca de plano sem duplicar a memória', js.includes('globalProgressBefore') && js.includes('remaining=Math.max(0,a.target-p.progress)')],
  ['UI expõe somente fila curta e simples', js.includes('Correção contínua de lacunas') && js.includes('até 3 disciplinas/dia')],
  ['mapa técnico continua exportável', js.includes("type:'StudyNoMentorLacunasContinuas'") && js.includes('copyExport')],
  ['módulo reage imediatamente a nova resolução', js.includes('patchRealtime()') && js.includes("self.refresh('resolution')")],
  ['build inclui CSS, motor e guardas', build.includes("S('css/29-tec-lacunas-continuas.css')") && build.includes("'js/99-tec-lacunas-continuas.js'") && build.includes("'js/99b-tec-lacunas-guardas.js'")],
  ['painel antigo de evidência fica fora da interface', css.includes('#tec-real-evidence-card { display:none !important; }')]
];

const failed=checks.filter(([,ok])=>!ok);
if (failed.length) {
  for (const [name] of failed) console.error('FALHOU:',name);
  process.exit(1);
}
console.log(`LACUNAS CONTÍNUAS: ${checks.length}/${checks.length} contratos válidos.`);
