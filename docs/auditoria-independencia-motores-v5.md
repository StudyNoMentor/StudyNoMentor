# Auditoria de independência — Simplificado × Robusto V5

Data da revisão: 2026-09-14

## Objetivo

Garantir que **Simplificado** e **Robusto** sejam duas frentes de decisão genuinamente independentes, com propostas diferentes, e não duas interfaces sobre o mesmo cérebro.

## Propostas

### Simplificado

Motor deliberadamente transparente. Calcula diretamente sobre o TEC já filtrado.

- Pré-edital: histórico TEC × meta × amostra.
- Pós-edital: lacuna pessoal × incidência da banca × composição/valor da matéria.
- Poucos parâmetros.
- Não usa `PlanoEngine`.
- Não usa Mentor90.
- Não aprende pesos.
- Não lê configuração do Robusto.

### Robusto V5

Motor estratégico. Usa o Plano e uma política estatístico-pedagógica própria.

- domínio probabilístico e régua competitiva;
- calibração tópico → disciplina → global;
- incidência normalizada e confiança de matching;
- ritmo pessoal e custo temporal;
- scoring diferente no pré e pós-edital;
- roteador pedagógico;
- aprendizagem conservadora de pesos;
- otimização conjunta das frentes sob orçamento de tempo.

## Matriz de dependências

| Recurso | Simplificado | Robusto | Pode ser compartilhado? |
|---|---:|---:|---|
| TEC escopado | Sim | Sim | **Sim — dado bruto/neutro** |
| Normalização de texto | Sim | Sim | **Sim — utilitário neutro** |
| Lista de Extras abertos | Sim | Sim | **Sim — trava operacional** |
| Fila final de Extras | Sim | Sim | **Sim — camada de execução** |
| Preferências Simplificado | Sim | Não | **Não** |
| Preferências Robusto | Não | Sim | **Não** |
| `PlanoEngine` | Não | Sim | **Não** |
| Mentor90 / política probabilística | Não | Sim | **Não** |
| Score / pesos | Próprios | Próprios | **Não** |
| Aprendizado | Não | Próprio | **Não** |
| Calibração | Não | Própria | **Não** |
| Fallback temporal | Não | Próprio | **Não** |
| Tratamento de falha | Próprio | Próprio | **Não** |

## Fronteiras de código

- `86-plano-sugestoes-infra-v2.js`: infraestrutura neutra; não decide prioridade.
- `87-plano-sugestoes-simplificado-v2.js`: cérebro Simplificado.
- `88*`: família Robusto. Nenhum arquivo desta família pode referenciar o módulo ou storage do Simplificado.
- `89-plano-sugestoes-controller-v2.js`: orquestrador. É o único componente autorizado a conhecer os dois motores; persiste **somente `modo`**.
- `90-plano-motores-governanca-v5.js`: disponibilidade global; não altera fórmula.
- `91-plano-motores-central-tec-v1.js`: UI central de configuração; chama cada API de configuração separadamente.

## Contratos obrigatórios

1. Alterar qualquer preferência do Simplificado não pode modificar saída, configuração ou storage do Robusto.
2. Alterar qualquer preferência do Robusto não pode modificar saída, configuração ou storage do Simplificado.
3. Quebrar deliberadamente um motor não pode impedir a API direta do outro de calcular.
4. O modo Comparar não soma scores heterogêneos. Usa posição em cada ranking e consenso.
5. O controller não pode persistir campos de negócio de nenhum motor.
6. O Robusto não pode importar, buscar ou executar `PlanoSugestoesSimplificadoV2`.
7. O Simplificado não pode executar `PlanoEngine`, Mentor90 ou funções do Robusto.
8. A infraestrutura compartilhada não pode conter score, pesos ou regra de prioridade.
9. Atividades históricas permanecem identificadas com o motor que as originou.
10. Desabilitar um motor remove novas decisões daquele motor, mas não apaga histórico.

## Invariantes operacionais

- até 3 disciplinas distintas por rodada;
- 1 tópico por disciplina;
- alvo global da atividade é diferente da dose diária;
- otimizador nunca reduz o alvo global apenas para caber no dia;
- tempo desconhecido permanece desconhecido se fallback estiver desligado;
- uma disciplina com reforço do Plano aberto não volta ao próximo lote.

## Barreiras automáticas

A suíte deve verificar, no mínimo:

- referências proibidas por análise estática;
- chaves de storage disjuntas;
- controller com estado `modo` apenas;
- mutação de configuração unilateral;
- falha unilateral;
- fórmulas/componentes de score distintos;
- Comparar sem mistura de escalas;
- identidade do motor preservada nos metadados de Extras;
- navegação e configuração em Chromium/mobile.

## Resultado da auditoria

A arquitetura desejada é **dois motores + um orquestrador neutro + uma execução comum**. Compartilhar a fila final não significa compartilhar o raciocínio. Qualquer futura alteração que mova pesos, preferências, calibragem ou fallback para uma camada comum deve ser considerada regressão arquitetural e exigir revisão explícita deste contrato.
