from pathlib import Path

# O rodízio não deve pulverizar a força-tarefa. Cada assunto usa a capacidade
# diária inteira (até 15q); só o saldo vai para a próxima passagem do rodízio.
p=Path('src/js/51b-reforco-agenda-auto.js')
s=p.read_text(encoding='utf-8')
s=s.replace("""   - sessão de até 15 questões, dividida de forma equilibrada (17 => 9+8,
     não 15+2; 25 => 13+12);
""", """   - sessão de até 15 questões em BLOCO CHEIO: 17 => 15+2 e 25 => 15+10;
     não pulveriza a força-tarefa em vários dias de 7 ou 8 questões;
""", 1)
s=s.replace("""  /* Divide SEM criar rabicho inútil. O objetivo é produzir blocos comparáveis,
     bons para alternância e para leitura do resultado do ciclo. */
  function dividir(restante, teto) {
    restante = inteiro(restante, 0);
    teto = Math.max(1, inteiro(teto, MAX_SESSAO));
    if (!restante) return [];
    const n = Math.max(1, Math.ceil(restante / teto));
    const base = Math.floor(restante / n), sobra = restante % n;
    const out = [];
    for (let i = 0; i < n; i++) out.push(base + (i < sobra ? 1 : 0));
    return out.filter(Boolean);
  }
""", """  /* Força-tarefa: usa a capacidade diária antes de abrir outro dia.
     O saldo — mesmo pequeno — fica para a próxima passagem do rodízio. Isso
     evita transformar 25q em 13+12 ou 17q em 9+8 só para "embelezar" a agenda. */
  function dividir(restante, teto) {
    restante = inteiro(restante, 0);
    teto = Math.max(1, inteiro(teto, MAX_SESSAO));
    const out = [];
    while (restante > 0) {
      const bloco = Math.min(teto, restante);
      out.push(bloco);
      restante -= bloco;
    }
    return out;
  }
""", 1)
if '17 => 15+2' not in s or 'while (restante > 0)' not in s:
    raise SystemExit('falhou ao alterar o divisor para blocos cheios')
p.write_text(s,encoding='utf-8')

t=Path('testes/atividades-extras.mjs')
q=t.read_text(encoding='utf-8')
q=q.replace("a(JSON.stringify([...A.dividir(17)])===JSON.stringify([9,8]),'17q não foi balanceado em 9+8');", "a(JSON.stringify([...A.dividir(17)])===JSON.stringify([15,2]),'17q foi pulverizado em vez de 15+2');")
q=q.replace("a(JSON.stringify([...A.dividir(25)])===JSON.stringify([13,12]),'25q não foi balanceado em 13+12');", "a(JSON.stringify([...A.dividir(25)])===JSON.stringify([15,10]),'25q foi pulverizado em vez de 15+10');\na(JSON.stringify([...A.dividir(44)])===JSON.stringify([15,15,14]),'44q não consumiu blocos cheios em sequência');")
q=q.replace("// O pai DEVE ficar ativo e as 17 restantes devem virar 9+8 nos dias seguintes.", "// O pai DEVE ficar ativo e as 17 restantes devem virar 15+2 nos dias seguintes.")
q=q.replace("a(JSON.stringify(futuras)===JSON.stringify([9,8]),'restante 17q não foi redistribuído em 9+8');", "a(JSON.stringify(futuras)===JSON.stringify([15,2]),'restante 17q não foi empurrado em bloco cheio 15+2');")
q=q.replace("console.log('OK: Atividades Extras — sessão parcial preserva o ciclo, redistribui o restante e mantém rodízio de até 3 disciplinas.');", "console.log('OK: Atividades Extras — 3 focos em rodízio, bloco cheio, saldo no próximo dia e ciclo preservado.');")
if "[15,2]" not in q or "[15,10]" not in q or "[15,15,14]" not in q:
    raise SystemExit('falhou ao alinhar os testes de blocos cheios')
t.write_text(q,encoding='utf-8')

print('Reforço ajustado para rodízio de blocos cheios, sem diluição artificial.')
