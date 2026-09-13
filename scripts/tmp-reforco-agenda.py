from pathlib import Path

# 1) Montador: inclui o novo módulo depois da camada de execução curta.
p=Path('build.mjs')
s=p.read_text(encoding='utf-8')
old="    'js/51a-tec-scope-consistency.js',\n"
new=old+"    'js/51b-reforco-agenda-auto.js',\n"
if "'js/51b-reforco-agenda-auto.js'" not in s:
    if old not in s: raise SystemExit('ancora 51a nao encontrada')
    s=s.replace(old,new,1)
    p.write_text(s,encoding='utf-8')

# 2) Harness VM: globalThis é provido pelo próprio vm.Context.
t=Path('testes/atividades-extras.mjs')
q=t.read_text(encoding='utf-8')
q=q.replace(',Intl,globalThis:null};', ',Intl};')
q=q.replace('\ncontexto.globalThis=contexto;', '')
t.write_text(q,encoding='utf-8')

# 3) Integração de navegador: o contrato antigo exigia ausência de datas.
# Agora as datas são justamente a agenda automática. Cobramos agenda futura,
# ausência de dívida vencida fantasma e navegação sem mutação da agenda.
v=Path('verificar.mjs')
r=v.read_text(encoding='utf-8')
old_prop="      semDatas: !DB.getExtras().some((e) => (e.datas || []).length),\n"
new_prop="""      agendaAuto: DB.getExtras().filter(e => e.origemPlano && e.origemPlano.topico && e.status !== 'concluida')
        .every(e => (e.datas || []).some(d => d >= todayLocal())),
      semDivida: DB.getExtras().filter(e => e.origemPlano && e.origemPlano.topico && e.status !== 'concluida')
        .every(e => (e.datas || []).filter(d => d < todayLocal()).every(d =>
          (e.concluidasEm || []).includes(d) || (e.historico || []).some(h => h.data === d))),
"""
if old_prop in r:
    r=r.replace(old_prop,new_prop,1)
elif 'agendaAuto: DB.getExtras().filter' not in r:
    raise SystemExit('propriedade semDatas nao encontrada')

old_assert="""  /* O RITMO É DERIVADO, NÃO AGENDADO. Amarrar cada atividade a um dia cria
     divida vencida: voce nao estudou terca, e terca fica la, cobrando. */
  (/\\/dia/.test(g.ritmo) && g.semDatas)
    ? ok('com ritmo por dia calculado na hora, e nenhuma atividade amarrada a uma data')
    : erro('o ritmo derivado falhou: ' + JSON.stringify({ ritmo: g.ritmo, semDatas: g.semDatas }));
"""
new_assert="""  /* O ritmo continua derivado do volume, mas a execução agora É agendada.
     O contrato novo cobra duas coisas mais fortes: cada frente aberta tem próxima
     sessão e nenhuma data passada sem histórico/conclusão permanece como dívida. */
  (/\\/dia/.test(g.ritmo) && g.agendaAuto && g.semDivida)
    ? ok('ritmo derivado + agenda automática futura, sem dívida vencida fantasma')
    : erro('agenda automática do painel falhou: ' + JSON.stringify({ ritmo: g.ritmo, agendaAuto: g.agendaAuto, semDivida: g.semDivida }));
"""
if old_assert in r:
    r=r.replace(old_assert,new_assert,1)
elif 'ritmo derivado + agenda automática futura' not in r:
    raise SystemExit('assert antigo de ritmo nao encontrado')

old_nav="""  const navHoje = await pag.evaluate(() => {
    const b=document.querySelector('#extras-curso [data-curso-dia]'); if(!b)return{faltando:true}; const id=b.dataset.cursoDia; b.click(); const e=DB.getExtra(id); return{datas:(e&&e.datas)||[],sel:ExtrasScreen.selDay,hoje:todayLocal()};
  });
  (!navHoje.faltando && navHoje.datas.length===0 && navHoje.sel===navHoje.hoje) ? ok('\"Ver hoje\" navega sem fixar uma data') : erro('\"Ver hoje\" alterou dados: '+JSON.stringify(navHoje));
"""
new_nav="""  const navHoje = await pag.evaluate(() => {
    const b=document.querySelector('#extras-curso [data-curso-dia]'); if(!b)return{faltando:true}; const id=b.dataset.cursoDia;
    const e0=DB.getExtra(id), antes=JSON.stringify((e0&&e0.datas)||[]); b.click(); const e=DB.getExtra(id);
    return{antes,depois:JSON.stringify((e&&e.datas)||[]),sel:ExtrasScreen.selDay,hoje:todayLocal()};
  });
  (!navHoje.faltando && navHoje.antes===navHoje.depois && navHoje.sel===navHoje.hoje) ? ok('\"Ver hoje\" só navega; a agenda automática permanece idêntica') : erro('\"Ver hoje\" alterou a agenda: '+JSON.stringify(navHoje));
"""
if old_nav in r:
    r=r.replace(old_nav,new_nav,1)
elif 'a agenda automática permanece idêntica' not in r:
    raise SystemExit('teste Ver hoje nao encontrado')
v.write_text(r,encoding='utf-8')

# 4) Jornada anual: "encerrar na mão" precisa usar a intenção explícita de
# encerrar o CICLO. setConcluidaDia agora representa a sessão diária.
j=Path('test/jornada-invariantes.js')
z=j.read_text(encoding='utf-8')
old_j="    if (viva) DB.setConcluidaDia(viva.id, todayLocal(), true);\n"
new_j="""    if (viva) {
      if (globalThis.ReforcoAgendaAuto && typeof ReforcoAgendaAuto.finalizarCiclo === 'function') ReforcoAgendaAuto.finalizarCiclo(viva.id, todayLocal());
      else DB.setConcluidaDia(viva.id, todayLocal(), true);
    }
"""
if old_j in z:
    z=z.replace(old_j,new_j,1)
elif 'ReforcoAgendaAuto.finalizarCiclo(viva.id' not in z:
    raise SystemExit('fechamento manual da jornada nao encontrado')
j.write_text(z,encoding='utf-8')

print('Montador, harness e invariantes alinhados à agenda automática.')
