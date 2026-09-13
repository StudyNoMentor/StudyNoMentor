from pathlib import Path

# 1) Ajustes do próprio harness (globais lexicais não são propriedades de window).
p=Path('testes/stress-jornada-massiva.mjs')
s=p.read_text(encoding='utf-8')
s=s.replace("await page.waitForFunction(() => window.DB && window.ExtrasScreen && window.PlanoEngine && window.PlanoCiclo && window.ReforcoAgendaAuto, null, { timeout: 30000 });",
"await page.waitForFunction(() => typeof DB !== 'undefined' && typeof ExtrasScreen !== 'undefined' && typeof PlanoEngine !== 'undefined' && typeof PlanoCiclo !== 'undefined' && !!window.ReforcoAgendaAuto, null, { timeout: 30000 });")
s=s.replace("await page.waitForFunction(() => window.DB && window.ExtrasScreen && window.ReforcoAgendaAuto, null, { timeout:30000 });",
"await page.waitForFunction(() => typeof DB !== 'undefined' && typeof ExtrasScreen !== 'undefined' && !!window.ReforcoAgendaAuto, null, { timeout:30000 });")

# Protege a descoberta do segundo bug: fechar A hoje não pode retirar B/C de hoje.
needle="""    }
    if (e1) {
      const s=e1.origemPlano.agendaAuto.sessoes[hoje];
"""
repl="""    }
    e1=DB.getExtra(onda1[1]); e2=DB.getExtra(onda1[2]);
    if (e1 && e2) {
      const s1=e1.origemPlano&&e1.origemPlano.agendaAuto&&e1.origemPlano.agendaAuto.sessoes&&e1.origemPlano.agendaAuto.sessoes[hoje];
      const s2=e2.origemPlano&&e2.origemPlano.agendaAuto&&e2.origemPlano.agendaAuto.sessoes&&e2.origemPlano.agendaAuto.sessoes[hoje];
      A(!!s1 && !!s2, 'fechar uma sessão removeu as outras frentes do rodízio de hoje', {e1:!!s1,e2:!!s2});
    }
    if (e1) {
      const s=e1.origemPlano.agendaAuto.sessoes[hoje];
"""
if needle in s:
    s=s.replace(needle,repl,1)
s=s.replace("{ alvo:s&&s.alvo, hist:histDia(e1,hoje) });",
            "{ alvo:s&&s.alvo, hist:histDia(e1,hoje), status:e1.status, concluidasEm:e1.concluidasEm, sessao:e1.origemPlano&&e1.origemPlano.agendaAuto&&e1.origemPlano.agendaAuto.sessoes&&e1.origemPlano.agendaAuto.sessoes[hoje] });")
if "window.PlanoEngine && window.PlanoCiclo" in s:
    raise SystemExit('wait global lexical ainda incorreto')
p.write_text(s,encoding='utf-8')

# 2) Produto: o horizonte de 90 dias era uma preferência de procura, mas virava
# fallback inseguro. Com >91 frentes da mesma disciplina, várias eram empilhadas
# no mesmo dia. Agora a busca continua além do horizonte ATÉ achar um dia válido.
p=Path('src/js/51b-reforco-agenda-auto.js')
s=p.read_text(encoding='utf-8')
s=s.replace("""      for (let i = 0; i <= horizonte; i++) {
        const dia = addDias(minimo, i);
""", """      /* O horizonte limita a procura normal, não a integridade. Se todos os
         dias da janela estiverem ocupados, continua avançando até achar um dia
         realmente válido — nunca cai de volta em `minimo` sobrepondo frentes. */
      for (let i = 0; !primeiro || i <= horizonte; i++) {
        const dia = addDias(minimo, i);
""", 1)

# 3) Produto: fechar A não pode replanejar B/C para amanhã. O dia de hoje é
# estável para todas as outras frentes; só a frente fechada avança ao saldo.
s=s.replace("""    replanejar(on ? addDias(dia, 1) : dia, { preservarHoje: !on });
""", """    /* Fechar uma das frentes de hoje não remove as outras duas da missão.
       O fato recém-fechado é preservado por `concluidasEm`; as demais sessões
       de hoje permanecem estáveis e só o saldo desta frente vai adiante. */
    replanejar(hoje(), { preservarHoje: true });
""", 1)

if "for (let i = 0; !primeiro || i <= horizonte; i++)" not in s:
    raise SystemExit('patch do horizonte não aplicado')
if "replanejar(hoje(), { preservarHoje: true });" not in s:
    raise SystemExit('patch de preservação do rodízio de hoje não aplicado')
p.write_text(s,encoding='utf-8')
print('Patch da auditoria + correções de agenda aplicado.')
