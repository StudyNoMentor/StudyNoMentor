from pathlib import Path

def read(p): return Path(p).read_text(encoding='utf-8')
def write(p,s): Path(p).write_text(s,encoding='utf-8')
def once(s,a,b,label):
    n=s.count(a)
    if n!=1: raise RuntimeError(f'{label}: esperava 1 ocorrência, encontrei {n}')
    return s.replace(a,b,1)

p='src/js/47-tela-extras.js'; s=read(p)
s=once(s,"""      if (DB.extraRecorrente(x)) {
        if ((x.excluidasEm || []).includes(day)) return false;
        if (datas.length) return datas.includes(day);
        return this._recurOnDay(x, day);
      }""","""      if (DB.extraRecorrente(x)) {
        /* Histórico é fato consumado. Editar a janela da recorrência ou excluir
           uma ocorrência futura não pode esconder um lançamento/conclusão que
           já aconteceu naquele dia. */
        const temHistoricoNoDia = (x.historico || []).some(h => h.data === day);
        const foiConcluidaNoDia = (x.concluidasEm || []).includes(day);
        if (temHistoricoNoDia || foiConcluidaNoDia) return true;
        if ((x.excluidasEm || []).includes(day)) return false;
        if (datas.length) return datas.includes(day);
        return this._recurOnDay(x, day);
      }""",'preservar histórico recorrente')
s=once(s,"""<span class=\"exd-doneinfo\">✓ <b>${totalDia.toLocaleString('pt-BR')}</b> ${escapeHtml(unidLabel)} registrado(s) neste dia${temAcertos ? ` · <b>${acertosDia.toLocaleString('pt-BR')}</b> acerto(s)` : ''}</span>""","""<span class=\"exd-doneinfo\">✓ <b>${totalDia.toLocaleString('pt-BR')}</b> ${escapeHtml(unidLabel)} registrado(s) neste dia${temAcertos ? ` · <b>${acertosDia.toLocaleString('pt-BR')}</b> acerto(s)` : ''}${totalMin > 0 && !emMin ? ` · <b>${totalMin.toLocaleString('pt-BR')}</b> min` : ''}</span>""",'mostrar minutos concluído')
s=once(s,"""<span class=\"exd-reg-value\">✓ ${totalDia.toLocaleString('pt-BR')} ${escapeHtml(unidLabel)} no dia${temAcertos ? ` · ${acertosDia.toLocaleString('pt-BR')} acerto(s)` : ''}</span>""","""<span class=\"exd-reg-value\">✓ ${totalDia.toLocaleString('pt-BR')} ${escapeHtml(unidLabel)} no dia${temAcertos ? ` · ${acertosDia.toLocaleString('pt-BR')} acerto(s)` : ''}${totalMin > 0 && !emMin ? ` · ${totalMin.toLocaleString('pt-BR')} min` : ''}</span>""",'mostrar minutos salvo')
write(p,s)

p='testes/atividades-extras.mjs'; t=read(p)
t=once(t,"a(js.includes('new Set([dia,'),'ocorrência calculada não entra no seletor');","a(js.includes('new Set([dia,'),'ocorrência calculada não entra no seletor');a(js.includes('if (temHistoricoNoDia || foiConcluidaNoDia) return true;'),'histórico recorrente pode sumir após editar agenda');a(js.includes('totalMin.toLocaleString'),'minutos registrados não ficam visíveis no cartão');",'testar histórico/minutos')
write(p,t)

p='verificar.mjs'; v=read(p)
v=once(v,"""  (/40\\s*\\/\\s*100/.test(histExtra.txt)&&histExtra.temMin) ? ok('dia histórico usa o próprio período e aceita minutos') : erro('progresso histórico/minutos incorretos: '+JSON.stringify(histExtra));""","""  (/40\\s*\\/\\s*100/.test(histExtra.txt) && /30\\s*min/.test(histExtra.txt) && histExtra.temMin) ? ok('dia histórico usa o próprio período, preserva e exibe minutos') : erro('progresso histórico/minutos incorretos: '+JSON.stringify(histExtra));
  const histRec = await pag.evaluate(() => {
    const add=(iso,n)=>{const d=new Date(iso+'T00:00:00');d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
    const hoje=todayLocal(), antigo=add(hoje,-7);
    const e=DB.addExtra({titulo:'Histórico recorrente',tipo:'questoes',disciplina:'Teste',alvo:10,unidade:'questoes',periodo:'semanal',dataInicio:antigo,dataFim:hoje,contaMetricas:false});
    DB.sincronizarDatasRecorrencia(e.id); DB.addExtraProgress(e.id,5,12,{data:antigo,acertos:4});
    DB.updateExtra(e.id,{datas:[hoje],excluidasEm:[antigo]});
    const aparece=ExtrasScreen.occurrencesForDay(antigo).some(x=>x.id===e.id);
    DB.deleteExtra(e.id); return {aparece};
  });
  histRec.aparece ? ok('editar/excluir recorrência não apaga um dia que já tem histórico') : erro('histórico recorrente ficou invisível');""",'browser histórico/minutos')
write(p,v)
print('Complemento da auditoria aplicado.')