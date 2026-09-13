# Auditoria de Extras e Desempenho TEC — 13/09/2026

## Resultado executivo

A suíte oficial terminou com `TUDO OK`. Em paralelo, a auditoria exploratória e
o teste de estresse encontraram problemas que os cenários oficiais não cobrem:
validação de entradas adversas, recortes temporais e desempenho em volume alto.

Os testes rodaram no Chrome 148.0.7778.167, em perfil efêmero, com o DOM real do
aplicativo. Foram usadas janelas de 1440 × 1000, 390 × 844 e 360 × 640. Nenhum
dado de usuário foi lido ou alterado; toda a massa é fictícia e o navegador de
teste é descartado ao fim.

## Cobertura executada

- Suíte oficial: 40 módulos com sintaxe válida, 21.080 comparações com Anki,
  12 configurações inválidas × 4 fases × 4 notas, 52 verificações da importação
  TEC, 14 telas, AutoTeste 753/753, service worker/offline, banco falso do
  Supabase, nuvem ponta a ponta e WCAG AA nos temas claro e escuro.
- Jornada anual oficial: 8 importações, 13 atividades, 4 ciclos julgados e 25
  pontos de conferência sem violação de invariantes.
- Auditoria exploratória do motor: 187 casos; 173 passaram e 14 expuseram
  comportamentos problemáticos.
- Auditoria exploratória no DOM: 34 casos; 30 passaram e 4 falharam.
- Matriz de Extras: 360 combinações de 6 tipos × 5 períodos × 3 estados ×
  conta/não conta nas métricas × origem Plano/externa.
- Carga TEC: 12 retratos, 35.160 linhas, catálogo de 3.000 tópicos, 3.828.010
  questões agregadas e 9.090 linhas de incidência em 3 bancas.
- Carga Extras: 2.000 atividades, 8.000 lançamentos, 20 reforços vinculados ao
  Plano e atividades externas, inclusive Anki. Uma tentativa com 5.000 itens
  foi interrompida após mais de 90 segundos sem devolver controle à interface.

## O que passou em Extras

- Reforço criado pelo Plano guarda a origem e bloqueia outra atividade aberta
  para a mesma unidade.
- Anki e questões externas para o mesmo assunto coexistem com o reforço do
  Plano e não recebem progresso automático do TEC.
- Registro parcial pela interface preserva quantidade e acertos; vários
  parciais somam até a meta; desfazer o último parcial reabre a atividade.
- Acertos de uma atividade de questões são limitados à quantidade lançada.
- Uma recorrência não pode ser concluída no futuro e a conclusão de hoje não
  conclui a ocorrência de amanhã.
- Um novo retrato alimenta o progresso do reforço vinculado, sem alterar a
  atividade externa homônima.
- As 360 combinações produziram cartões finitos, sem `NaN` ou `undefined`, e o
  gerenciador preservou exatamente as 360 linhas.
- Com 2.000 atividades, o subconjunto diário permaneceu navegável (182 cartões)
  e o gerenciador materializou as 2.000 atividades.

## Problemas reproduzidos

### Alta prioridade

1. **Importação aceita contagens impossíveis.** O parser e o botão Salvar
   aceitam `acertos > questões`, acertos negativos, valores fracionários e um
   retrato com zero questões. Isso permite gravar percentuais acima de 100% ou
   abaixo de 0% e contaminar Análise, Reforço e Plano.
2. **Corrida durante leitura do arquivo.** Se Salvar for acionado enquanto um
   `.xlsx` ainda está sendo lido, a tela pode reutilizar linhas que já estavam
   em `_parsedRows` e persistir conteúdo anterior sob o novo período.
3. **Plano e Extras bloqueiam a thread principal em massa.** Com 3.000 tópicos,
   a aba Plano levou 20,6 s para renderizar. Com essa carga TEC mais 2.000
   atividades, Extras levou 37,0 s. A tentativa com 5.000 atividades não
   terminou em 90 s.

### Média prioridade

4. **CSV anunciado não implementa aspas.** Um tópico como `"Atos, Fatos"` em
   CSV resulta em zero linhas reconhecidas. O fluxo aceita extensão `.csv`,
   portanto o caso é parte do contrato visível da tela.
5. **Recorte temporal pode buscar dados fora do escopo.** A auditoria direta
   reproduziu uma seleção contendo só o retrato antigo que terminou calculada
   com a taxa do retrato novo (esperado 20%, obtido 80%). A janela máxima de 365
   dias também reutilizou uma observação com 500 dias.
6. **A nota projetada pode usar uma taxa diferente da mostrada pelo Plano.** No
   caso reproduzido, a projeção ficou em 50% enquanto o domínio adaptativo
   exibido era 80%.
7. **Preferências vindas de backup/nuvem não são saneadas em todos os campos.**
   `metaDominio="abc"`, `limite=-1`, `custoFator="abc"` e `custoPiso="abc"`
   produziram meta textual, lista vazia ou custos não finitos.
8. **A margem de Wilson é apresentada como se fosse simétrica.** Em 0/20 o
   intervalo é 0%–16,1%, mas o cartão mostra `0% ±8pp`; essa escrita não cobre
   o limite superior.

### Revisão de texto/estado

9. Sem incidência cadastrada, o painel contém a frase sobre estar “no teto no
   que a prova cobra”. O teste oficial confirma corretamente que o Reforço fica
   cego para a prova; é preciso revisar se a frase problemática está visível no
   estado final ou apenas em conteúdo explicativo oculto.

## Medições

| Operação | Tempo |
|---|---:|
| Parse de TSV válido | 4,9 ms |
| Persistir 35.160 linhas TEC | 29,4 ms |
| Agregar 12 retratos | 238,2 ms |
| Calcular Plano com 3.000 tópicos | 8.363,0 ms |
| Calcular Reforço com 9.090 incidências | 101,1 ms |
| Render Análise massiva | 192,1 ms |
| Render Incidência massiva | 179,9 ms |
| Render Reforço massivo | 748,6 ms |
| Render Plano massivo | 20.599,6 ms |
| Render Extras, matriz de 360 | 662,3 ms |
| Persistir 2.000 Extras/8.000 lançamentos | 10,9 ms |
| Render Extras com TEC massivo | 37.014,7 ms |
| Gerenciador com 2.000 linhas | 163,6 ms |
| Varrer ocorrências de 31 dias | 162,1 ms |
| Registrar/desfazer parcial em 2.000 itens | 8,8 / 5,5 ms |

O pico observado foi 47,3 MB de heap JavaScript. Houve 10 tarefas longas. A
gravação e o gerenciador isolado são rápidos; o custo dominante é o recálculo do
Plano dentro das renderizações, repetido por telas e por reforços vinculados.

## Inspeção visual

- Extras em 390 × 844 reorganiza o cabeçalho, calendário e botões sem corte
  horizontal. A navegação inferior permanece acessível.
- O Plano em 390 × 844 empilha filtros e modos de ataque de forma legível; em
  desktop, mantém hierarquia visual mesmo com 3.000 tópicos.
- A captura longa de Extras em desktop mostra o painel de sessão translúcido
  sobre a tela porque a sessão de teste expirou durante a carga. A captura curta
  da mesma tela ficou limpa, então essa imagem não foi classificada como defeito
  de layout de Extras.

## Próximas correções sugeridas

1. Validar uma linha TEC em um funil único antes de preview e persistência:
   inteiros finitos, `questões >= 0`, `0 <= acertos <= questões` e total do
   retrato maior que zero.
2. Marcar a importação como “lendo” e desabilitar Salvar até a promessa do
   arquivo atual terminar; invalidar resultados de leituras antigas com um token.
3. Usar um parser CSV compatível com campos entre aspas.
4. Fazer toda consulta histórica receber e respeitar explicitamente os IDs do
   escopo; alinhar a nota projetada à mesma taxa adaptativa do Plano.
5. Sanear preferências no ponto de leitura, inclusive dados de backup e nuvem.
6. Exibir o intervalo Wilson como faixa assimétrica nos extremos.
7. Cachear `PlanoEngine.calcular` por retratos + preferências, evitar cálculo do
   Plano em Extras quando não há reforço aberto e virtualizar/paginar listas.
   Para o Plano massivo, calcular fora da thread principal ou em blocos
   canceláveis evitaria congelamentos de dezenas de segundos.

## Reprodução

```powershell
npm ci
node verificar.mjs
node audit-runner.cjs
node testes\rodar-auditoria-browser.mjs
$env:STRESS_EXTRAS=2000
node testes\stress-extras-tec.mjs
```

Resultados estruturados:

- `audit-results.json`
- `audit-browser-results.json`
- `testes/resultado-stress-extras-tec.json`
- `testes/evidencias/*.png`
