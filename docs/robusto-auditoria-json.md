# Robusto V8 — auditoria humana local

O Robusto V8 mantém um **flight recorder local** para permitir calibração posterior com uso humano real sem transformar observações em causalidade.

## Fontes registradas

A auditoria acompanha somente dados pertinentes ao V8:

- estado e evolução do **TEC escopado**;
- disciplina e tópico canônicos do TEC;
- incidência importada da banca;
- prioridade da disciplina e do tópico;
- quantidade de questões recomendada;
- quantidade e minutos efetivamente registrados no reforço em **Extras**;
- desfecho posteriormente observado no TEC, quando disponível;
- peso manual da disciplina TEC no Pós-edital.

O arquivo não registra método subjetivo de estudo, nomes/pesos do ciclo regular nem tempo do estudo regular.

## TEC não é um experimento causal

Um retrato TEC pode conter questões feitas pelo reforço e também questões resolvidas em outros cadernos durante o ciclo regular. Portanto:

- o TEC é tratado como **verdade observada do estado atual**;
- o Extra é tratado como **exposição conhecida**;
- melhora posterior não é atribuída automaticamente ao reforço;
- quando o veredito informa volume TEC, o logger calcula `fracaoExposicaoConhecida`;
- ciclos mais contaminados recebem `pesoCalibracao` menor;
- toda linha do dataset mantém `causal: false`.

Isso evita ensinar o motor com uma falsa relação causa → efeito.

## Arquivo exportado

O botão **Desempenho TEC → Motores → Robusto → Exportar auditoria .json** gera:

`studynomentor-robusto-auditoria-AAAA-MM-DD.json`

Schema atual:

`studynomentor.robusto-audit.v2`

O payload contém:

- `meta`: versão do motor, privacidade e interpretação observacional;
- `diagnostico`: quantidade de decisões, reforços, resultados medidos, amostra efetiva de atribuição e horas diretamente registradas nos Extras;
- `events`: sequência cronológica dos eventos;
- `calibrationDataset`: uma linha por reforço, ligando `features` da decisão ao `outcome` observado.

## Uso recomendado

A calibração deve ser conservadora e versionada. Antes de alterar uma dose ou peso, deve haver amostra efetiva suficiente e estabilidade entre períodos. Um ganho isolado não é prova de que determinada quantidade de questões causou a melhora.

A finalidade do JSON é responder perguntas como:

- quais tipos de lacuna recebem doses excessivas ou insuficientes;
- em quais disciplinas a dose recomendada costuma ser concluída;
- qual faixa de questões apresenta melhor resposta observacional;
- se o tempo direto por questão em Extras está estável;
- se o ranking das três disciplinas antecipa de forma consistente as maiores fraquezas posteriores.

## Privacidade

A auditoria é **local-only**. Não executa upload automático e só sai do navegador quando o usuário aciona explicitamente a exportação. O perfil é representado por um identificador local anônimo.