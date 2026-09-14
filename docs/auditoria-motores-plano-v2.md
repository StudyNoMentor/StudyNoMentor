# Auditoria dos motores do Puxar do Plano — V2

## Objetivo

Garantir que **Simplificado** e **Robusto** sejam motores completos e independentes em lógica, cálculo, configuração, aprendizado e falhas. O modo **Comparar** é apenas um orquestrador de duas saídas públicas e não constitui um terceiro algoritmo de prioridade.

## Achados da auditoria V1

A V1 não atendia integralmente ao requisito de independência por quatro motivos:

1. Simplificado e Robusto moravam no mesmo objeto `Engine` e compartilhavam `_calcular`, `_pool`, `_top3` e outros auxiliares de decisão.
2. O Simplificado chamava `PlanoEngine.calcular()`. A fórmula final era simples, mas a base já havia sido processada pelo cérebro do Plano.
3. Uma camada posterior de governança fazia monkey-patch em `_pool`, `_calcular`, `robusto` e `criar`, podendo alterar os dois caminhos transversalmente.
4. O Comparar tratava scores normalizados dos dois motores como uma escala comparável, usando o maior score e bônus de consenso.

Esses quatro pontos foram removidos, não mascarados.

## Arquitetura V2

### Infraestrutura neutra

`src/js/86-plano-sugestoes-infra-v2.js`

Pode apenas:
- ler o retrato TEC já escopado;
- expor números brutos de questões/acertos/taxa;
- ler bancas, incidência e matérias;
- normalizar texto;
- informar disciplinas com reforço do Plano ainda aberto;
- informar a fase do planejamento.

Não contém score, lacuna, política aprendida, pontos recuperáveis ou fórmula de ranking.

### Motor Simplificado

`src/js/87-plano-sugestoes-simplificado-v2.js`

Dependências permitidas:
- retrato TEC escopado;
- incidência bruta;
- matérias/planejamento da prova.

Dependências proibidas:
- `PlanoEngine`;
- Mentor 90+;
- estado, funções ou resultados do Robusto.

Pré-edital:

`prioridade = meta desejada - taxa TEC`, após cumprir amostra mínima.

Pós-edital:

`prioridade = valor da matéria × participação do tópico na incidência da banca × lacuna × confiança do cruzamento`.

O alvo de questões do Simplificado é configuração própria. Não herda `custoQ`, dose ou alvo do Robusto.

### Motor Robusto

`src/js/88-plano-sugestoes-robusto-v2.js`

Dependências permitidas:
- `PlanoEngine` e seus ajustes efetivos;
- `PlanoPontos` no pós-edital;
- Mentor 90+ V6;
- histórico de atividades originadas pelo próprio Robusto.

Dependências proibidas:
- módulo Simplificado;
- preferências do Simplificado;
- score ou ranking do Simplificado.

O Robusto preserva as camadas já auditadas: domínio operacional/competitivo, incidência normalizada, recência, custo temporal pessoal quando confiável, resposta longitudinal, risco eliminatório, dose diária separada do alvo global e intervenção pedagógica.

### Mentor 90+ V6

`src/js/85-mentor90-policy-v6.js`

A V5 permanece intacta por compatibilidade. O Robusto usa a V6, que endurece a calibragem:
- tópico só ganha calibragem própria com **5 ou mais ciclos úteis**;
- antes disso recua para disciplina, também exigindo 5 ciclos;
- sem evidência suficiente usa nível global;
- baixa resposta não dispara troca de intervenção com amostra curta.

### Aprendizado dos pesos do Robusto

O Robusto não altera os pesos antes de 12 ciclos com desfecho observável.

Depois disso, cada componente é analisado em duas metades do histórico. O peso só recebe ajuste se o sinal da associação for consistente nas duas metades e tiver magnitude mínima. Mesmo assim, o ajuste recebe shrinkage e amplitude limitada. Isso reduz autoajuste a ruído.

### Comparar

`src/js/89-plano-sugestoes-controller-v2.js`

O Comparar:
- chama somente `Simplificado.calcular()` e `Robusto.calcular()`;
- não recalcula nenhuma fórmula;
- não lê variáveis privadas de nenhum motor;
- não soma scores heterogêneos;
- usa posição em cada ranking e bônus de consenso apenas para ordenar as disciplinas exibidas;
- permite uma única escolha por disciplina;
- envia no máximo 3 atividades para a mesma fila de Extras.

## Invariantes de execução comuns

Essas regras pertencem à execução, não à matemática de um motor:
- no máximo 3 disciplinas distintas por rodada;
- 1 tópico por disciplina;
- disciplina com reforço do Plano ainda aberto não entra em nova rodada;
- Extras é a única fila de execução;
- alvo global nunca é substituído pela dose diária;
- origem da atividade persiste motor, fórmula/componentes, política, configuração efetiva e arquitetura.

## Melhorias da auditoria anterior incorporadas

- régua competitiva explícita em 90%+, mantendo 85% como nível operacional quando configurado no Plano;
- separação entre alvo global e dose diária;
- incidência multi-banca normalizada em vez de soma bruta;
- confiança reduzida para casamento somente por nome;
- custo temporal pessoal somente com amostra suficiente;
- calibragem hierárquica com shrinkage e novo limiar mínimo de 5 ciclos;
- linguagem de resposta longitudinal sem inferência causal;
- backtest rolling-origin observacional do Mentor 90+;
- intervenção pedagógica separada da simples detecção de fraqueza;
- aprendizado dos pesos conservador, com 12 ciclos mínimos e estabilidade em duas metades;
- Comparar sem falsa equivalência entre scores matematicamente diferentes.

## Barreiras automatizadas

`testes/plano-sugestoes-modulos.mjs` verifica:
- ausência de dependências cruzadas no código;
- fórmulas Pré e Pós do Simplificado;
- configuração própria do Robusto;
- falha proposital de um motor sem alterar o outro;
- alteração das preferências de um motor sem contaminar o outro;
- limiar de calibragem Mentor 90+;
- aprendizado conservador;
- Comparar sem mistura de score;
- metadados e bloqueio de disciplina aberta.

`testes/plano-sugestoes-modulos-browser.mjs` verifica o fluxo real em Chromium/mobile, alternância dos três modos, controles independentes, regra 3×1, criação, metadados e reabertura.

Esses testes são obrigatórios na workflow `Verificacao` antes de qualquer merge em `main`.
