# Auditoria JSON do Robusto

## Objetivo

O log é um **flight recorder local** do motor Robusto. Ele registra o estado existente quando uma recomendação foi calculada, quais frentes realmente viraram atividades e o que aconteceu depois na execução humana.

O objetivo é permitir:

- auditoria retrospectiva das recomendações;
- detecção de vieses e regras que funcionam ou falham no uso real;
- comparação por fase, perfil de ataque e tipo de intervenção;
- calibração assistida dos pesos e limiares com dados observados;
- análise externa por uma pessoa ou ferramenta estatística a partir do `.json` exportado.

O log **não altera o score nem o aprendizado do Robusto**. Essa separação é intencional: a instrumentação não deve mudar a decisão que está tentando medir.

## Privacidade e armazenamento

- armazenamento local, separado por perfil;
- nenhuma chamada de rede, upload ou sincronização é feita pelo logger;
- exportação somente por ação explícita do usuário;
- o arquivo não lê nome, e-mail, token, senha ou outros dados arbitrários da conta;
- cada perfil recebe apenas um identificador local aleatório (`anonProfileId`).

## Fluxo registrado

### 1. `decisao`

Fotografia anterior à execução:

- versão/revisão do motor;
- perfil de ataque e fase Pré/Pós;
- configuração efetiva do Robusto;
- escopo TEC usado;
- candidatos considerados e frentes selecionadas;
- score e componentes;
- estado de domínio/calibração;
- modelo de tempo;
- intervenção pedagógica indicada;
- metadados do otimizador/orçamento.

Decisões idênticas calculadas repetidamente em uma janela curta são deduplicadas para evitar ruído de renderização da interface.

### 2. `atividade_criada`

Registra somente frentes do Robusto que realmente entraram em Extras:

- atividade e decisão de origem;
- disciplina e tópico;
- alvo global e dose diária;
- score/componentes da criação;
- intervenção e otimização persistidas.

Atividades antigas do Robusto, criadas antes da existência deste logger, são descobertas pela reconciliação e entram no histórico quando ainda possuem metadados de origem compatíveis.

### 3. `resultado_snapshot`

Fotografia posterior da execução humana:

- progresso e conclusão;
- quantidade efetivamente executada;
- minutos registrados;
- quantidade de lançamentos;
- acertos/erros quando existirem no histórico;
- taxa inicial e taxa posterior;
- ganho em pontos percentuais (`ganhoPP`) quando houver nova medição TEC;
- data do veredito.

Um novo snapshot só é gravado quando o estado observado muda.

## `calibrationDataset`

O exportador também constrói uma visão derivada, de uma linha por atividade, usando o **último desfecho conhecido**.

Cada linha contém:

```text
features -> outcome
```

### Features

- score;
- componentes do score;
- taxa e amostra no momento da decisão;
- domínio e incerteza;
- calibração histórica;
- confiabilidade/velocidade de tempo;
- intervenção escolhida;
- metadados do otimizador;
- alvo global e dose diária.

### Outcome

- conclusão;
- questões executadas;
- minutos executados;
- ganho absoluto em pontos percentuais;
- ganho por 100 questões;
- ganho por hora, quando houver tempo válido;
- taxa inicial e taxa posterior.

O campo `observado` só é verdadeiro quando existe ganho mensurável e volume associado. Atividades ainda sem novo retrato TEC continuam no dataset, mas não são tratadas como labels de eficácia.

## Diagnóstico agregado

O arquivo exportado inclui um resumo com:

- decisões registradas;
- atividades criadas;
- resultados disponíveis;
- pares decisão → resultado realmente medidos;
- pares com informação de tempo;
- horas registradas;
- prontidão em relação ao mínimo atual de ciclos do aprendizado;
- agregações por fase;
- agregações por perfil de ataque;
- agregações por tipo de intervenção.

## Como exportar

Em **Desempenho TEC → Motores → Robusto**, use **Exportar auditoria .json**.

Nome padrão:

```text
studynomentor-robusto-auditoria-AAAA-MM-DD.json
```

## Como interpretar

Os dados são **observacionais**. Um tópico pode ter melhorado por fatores externos ao Robusto: estudo fora da plataforma, diferença de dificuldade entre retratos, mudança de banca, descanso, qualidade das questões ou regressão à média.

Portanto:

- correlação não deve ser tratada como causalidade;
- mudanças de pesos devem exigir amostra mínima e estabilidade temporal;
- Pré e Pós-edital devem ser analisados separadamente;
- perfis de ataque devem ser analisados separadamente;
- ganho por hora deve ser usado apenas quando o tempo registrado for confiável;
- nenhuma configuração deve ser alterada automaticamente só porque uma correlação pontual apareceu no log.

A finalidade do arquivo é permitir **calibração assistida, versionada e reversível** com evidência real de uso humano.
