from pathlib import Path

p = Path('verificar.mjs')
s = p.read_text(encoding='utf-8')

old = """    const caixas = [...document.querySelectorAll('.pl-hoje-sel:not(:disabled)')];
    if (caixas.length < 2) return { poucas: caixas.length };
    const btn = document.getElementById('plano-lote');"""
new = """    let caixas = [...document.querySelectorAll('.pl-hoje-sel:not(:disabled)')];
    /* O bloco multidisciplinar pode legitimamente abrir uma frente de CADA
       disciplina elegível de uma vez. Neste fixture curto isso consome os três
       assuntos medidos e não sobra checkbox livre para testar a troca manual.
       A checagem da UI não deve depender desse saldo acidental: abrimos
       temporariamente a régua de amostra para os dois assuntos curtos que já
       existem no retrato, exercemos o listener e devolvemos a preferência ao
       valor que o usuário tinha. O teste continua cobrando a interação real,
       só deixa de pressupor que o algoritmo automático escolheu menos frentes. */
    let minAmostraAntes = null;
    if (caixas.length < 2) {
      minAmostraAntes = PlanoEngine.prefs().minAmostra;
      PlanoEngine.salvarPrefs({ minAmostra: 5 });
      DesempenhoTecScreen.renderPlano();
      await esperar(220);
      caixas = [...document.querySelectorAll('.pl-hoje-sel:not(:disabled)')];
    }
    if (caixas.length < 2) {
      if (minAmostraAntes != null) {
        PlanoEngine.salvarPrefs({ minAmostra: minAmostraAntes });
        DesempenhoTecScreen.renderPlano();
      }
      return { poucas: caixas.length };
    }
    const btn = document.getElementById('plano-lote');"""

old_return = """    const criadas = DB.getExtras().slice(antes);
    return { vazio, um, nome, n: criadas.length, casou: criadas.some((e) => e.origemPlano && e.origemPlano.topico === nome) };"""
new_return = """    const criadas = DB.getExtras().slice(antes);
    const resultado = { vazio, um, nome, n: criadas.length,
      casou: criadas.some((e) => e.origemPlano && e.origemPlano.topico === nome) };
    if (minAmostraAntes != null) {
      PlanoEngine.salvarPrefs({ minAmostra: minAmostraAntes });
      DesempenhoTecScreen.renderPlano();
      await esperar(160);
    }
    return resultado;"""

if new not in s:
    if old not in s:
        raise SystemExit('bloco de disponibilidade da escolha manual nao encontrado')
    s = s.replace(old, new, 1)

if new_return not in s:
    if old_return not in s:
        raise SystemExit('retorno da escolha manual nao encontrado')
    s = s.replace(old_return, new_return, 1)

p.write_text(s, encoding='utf-8')
print('teste canonico da escolha manual isolado do tamanho do bloco automatico')
