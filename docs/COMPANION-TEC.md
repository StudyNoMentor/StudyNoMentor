# Arquitetura TEC em tempo real

## Objetivo

Concentrar a experiência do aluno no StudyNoMentor. A extensão é apenas a ponte de captura necessária para atravessar a separação de origem do navegador; toda interpretação pedagógica, armazenamento do histórico, priorização e execução permanecem no StudyNoMentor.

## Pipeline

`TEC -> Companion -> fila durável -> StudyNoMentor -> histórico append-only -> Radar diário -> Motor Robusto -> Reforço/Extras -> nova medição no TEC`

### 1. Captura

Cada clique em **Resolver questão** produz uma tentativa independente. Uma mesma questão pode gerar vários eventos ao longo do tempo. O evento não é substituído quando o aluno resolve a questão novamente.

Campos principais:

- `eventId`
- `questionId`
- `resolvedAt`
- `localDate`
- `tecAccount` anonimizada
- `bookId`
- `acertou`
- `marcada`
- `correta`
- `materia`
- `assunto`
- `banca`
- `concurso`

A questão completa (enunciado/alternativas) continua na biblioteca da Integração TEC; o log de resoluções fica enxuto.

### 2. Entrega confiável

A extensão grava primeiro em `chrome.storage.local`. O evento só é removido depois do ACK do StudyNoMentor. Se o Study estiver fechado, sem rede ou for recarregado, a fila é reenviada no próximo handshake. O site deduplica por `eventId` e também por assinatura temporal para impedir duplicação quando Tampermonkey e Companion coexistirem durante a migração.

### 3. Métricas reais

O Radar TEC calcula por dia ou pelos últimos 7 dias:

- resoluções;
- erros;
- questões únicas;
- IDs únicos errados;
- IDs corrigidos posteriormente;
- matérias atingidas;
- assuntos atingidos;
- reincidência por ID;
- concentração dos erros por matéria/assunto.

### 4. Mapeamento pedagógico

O assunto recebido do TEC é casado apenas por `disciplina + assunto` normalizados. O sistema diferencia:

- **Fraqueza confirmada:** o tópico também está elegível no Motor Robusto;
- **Erro do dia:** tópico reconhecido no TEC, mas sem fraqueza estatística confirmada;
- **Não mapeado:** não há correspondência exata suficiente.

Correspondência incerta nunca cria reforço automático.

### 5. Atacar erros

`Atacar erros deste período` considera apenas fraquezas confirmadas. Seleciona no máximo um tópico por disciplina e até três disciplinas. A dose vem do mecanismo TEC + Extras já existente. A atividade nasce com `origemPlano`, entra no `ReforcoFila` e passa a obedecer às regras de saldo, parcial e reagendamento já usadas em Extras.

### 6. Retroalimentação

As resoluções futuras do TEC e os retratos importados continuam sendo a medição posterior. O sistema não atribui causalidade automática ao reforço: a resposta posterior é observacional e alimenta a calibração conservadora já implementada em `ReforcoTecExtras`.

## Casos de falha previstos

- Study fechado: fila fica na extensão.
- Recarregamento durante captura: evento já enviado continua na fila até ACK.
- Evento duplicado: deduplicação por ID/assinatura temporal.
- Duas contas TEC: fingerprint de conta separa os eventos; a biblioteca continua usando conta + caderno + questão.
- Troca de questão antes do resultado: tentativa pendente é descartada se o ID mudar.
- Assunto sem mapeamento: aparece no Radar, não cria tarefa automática.
- Reforço já aberto: não cria duplicata.
- Apenas erro isolado em tópico dominado: permanece como sinal do dia, sem forçar reforço.
- Tampermonkey ainda ativo durante migração: site aceita V21, mas deduplica a resolução equivalente.
