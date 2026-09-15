# Correção Contínua de Lacunas — Plano de Guerra e Checklist

## Objetivo
Transformar o histórico real de resoluções do TEC em uma memória longitudinal do aluno, compartilhada entre planejamentos, capaz de montar reforços curtos e rotativos desde o primeiro erro, sem exigir criação manual de novos filtros ou cadernos específicos.

## Princípios
- A memória pertence ao aluno/perfil, não ao planejamento.
- O caderno é contexto mutável. Seu tamanho pode aumentar ou diminuir sem reescrever o passado.
- `questionId` identifica a questão; cada tentativa continua registrada separadamente.
- A mesma questão em Base, Erradas e Favoritas conta uma única vez como questão distinta, mas as novas tentativas medem resistência.
- O reforço usa prioritariamente e, nesta versão, exclusivamente questões já presentes no histórico pessoal.
- O planejamento atual só filtra relevância/prioridade das lacunas globais.
- A fila visível deve ser pequena; a complexidade fica nos bastidores.

## Dose diária padrão
- Até **3 disciplinas por dia**.
- Uma lacuna/tópico por disciplina por vez.
- Microcorreção: até **3 questões**.
- Reforço padrão: até **5 questões**.
- Lacuna resistente/persistente: até **6 questões**.
- Teto absoluto do dia: **18 questões**.
- Se o histórico do tópico tiver menos questões úteis, usa somente as disponíveis.
- Rodízio de **7 dias**, penalizando matérias usadas no dia anterior e matérias já muito usadas na semana; lacunas persistentes podem furar essa preferência.

## Fluxo operacional
1. Resolver normalmente no TEC.
2. Capturar ID, matéria, assunto, resposta marcada, gabarito, resultado, data/hora, caderno e metadados disponíveis.
3. Registrar a resolução append-only.
4. Agrupar por tópico e por `questionId`.
5. Separar quantidade de questões distintas erradas de reincidências na mesma questão.
6. O primeiro erro já pode gerar microcorreção.
7. Novos IDs errados aumentam amplitude da lacuna.
8. Novo erro no mesmo ID aumenta resistência.
9. Erros em favoritas aumentam relevância quando o contexto de favorita estiver disponível.
10. Montar reforço apenas com questões já feitas: erros atuais, erros antigos, favoritas relacionadas e acertos antigos do tópico.
11. Deduplicar a lista final por ID.
12. Espelhar o reforço do dia em Atividades Extras.
13. Continuar estudando normalmente; as resoluções posteriores medem o efeito.
14. Se melhorar, reduzir prioridade; se persistir, aumentar profundidade.
15. Ao trocar de planejamento, preservar a memória inteira e trocar apenas a lente de relevância.
16. Ao entrar em um novo pós-edital, resgatar automaticamente lacunas históricas das disciplinas do novo planejamento.

## Checklist de implementação

### Fonte factual e identidade
- [x] Histórico de resoluções continua append-only por perfil.
- [x] Memória de lacunas usa chave global do perfil, sem `activePlanId` na identidade.
- [x] Deduplicação de questão por `questionId` no cálculo da amplitude.
- [x] Tentativas repetidas do mesmo ID continuam preservadas.
- [x] Caderno permanece apenas contexto; não existe dependência de 400 questões.
- [x] Alteração do tamanho/composição do caderno não reescreve resoluções anteriores.

### Base / Erradas / Favoritas
- [x] Mesma questão em mais de um contexto não duplica a quantidade de questões distintas.
- [x] Reincidência no mesmo ID é medida separadamente da amplitude.
- [x] Motor aceita metadados de favorita quando disponíveis na biblioteca/evento.
- [x] Inferência conservadora de contexto por metadados textuais quando disponíveis.
- [ ] Validar ao vivo se o TEC expõe de forma estável o nome/tipo do caderno de Favoritas para captura explícita pelo Companion.

### Reforço com o próprio histórico
- [x] Não depende de filtrar novas questões no TEC.
- [x] Pool do reforço é composto apenas por IDs já vistos.
- [x] Erros reincidentes têm prioridade dentro do pool.
- [x] Erros atuais entram antes de acertos antigos.
- [x] Favoritas, quando identificadas, aumentam prioridade sem duplicar ID.
- [x] Acertos antigos do mesmo tópico podem completar a dose sem sair do histórico.
- [x] Quantidade do reforço respeita o número realmente disponível.

### Intervenção precoce
- [x] Primeiro erro pode gerar microcorreção.
- [x] Vários IDs errados promovem a lacuna para ativa.
- [x] Erro repetido no mesmo ID promove resistência.
- [x] Erros após reforço concluído detectam persistência.
- [x] Bom desempenho posterior detecta melhora e reduz prioridade.

### Rodízio diário/semanal
- [x] Máximo de 3 disciplinas no dia.
- [x] Máximo de 1 tópico por disciplina no dia.
- [x] Doses pequenas de 3/5/6 questões.
- [x] Teto diário de 18 questões.
- [x] Janela de rodízio de 7 dias.
- [x] Penalidade para repetir matéria do dia anterior.
- [x] Penalidade para matéria já muito usada na semana.
- [x] Lacuna persistente pode superar a penalidade de rodízio.

### Compartilhamento entre planejamentos
- [x] Questões/resoluções do TEC já são armazenadas no namespace global do perfil.
- [x] Memória de lacunas é global do perfil.
- [x] Planejamento atual funciona como lente por disciplinas ativas/ciclo.
- [x] Ao trocar de planejamento, pendência irrelevante é adiada, não apagada.
- [x] Lacunas históricas relevantes podem voltar no pós-edital.
- [x] Reforços já executados são reconciliados entre todos os planejamentos.
- [x] Um reforço global pode ser espelhado no planejamento atual com saldo remanescente.

### Atividades Extras
- [x] Reforço diário é espelhado automaticamente em Extras.
- [x] Extra guarda `assignmentId`, `topicKey`, IDs TEC e alvo global.
- [x] Progresso em Extras alimenta o estado global do reforço.
- [x] Troca de planejamento preserva progresso global já feito.
- [ ] Validar ao vivo o comportamento visual dos novos Extras em um ciclo real com troca pré-edital → pós-edital → pré-edital.

### Interface e auditoria
- [x] Painel simples “Correção contínua de lacunas”.
- [x] Mostra apenas fila curta do dia.
- [x] Mostra quantidade pequena e IDs disponíveis.
- [x] Botão para ir às Atividades Extras.
- [x] Botão para copiar IDs de cada reforço.
- [x] Exportação técnica do mapa global para auditoria.
- [x] Painel antigo de “Evidência real” fica oculto para evitar duplicidade conceitual.

### Validação necessária com uso real
- [ ] Confirmar captura/identificação de Favoritas no DOM real do TEC.
- [ ] Confirmar que questões repetidas em Erradas + Favoritas permanecem 1 ID com múltiplas tentativas.
- [ ] Confirmar que o rodízio diário gera 2–3 matérias quando existem candidatas suficientes.
- [ ] Confirmar que doses 3/5/6 são confortáveis na rotina real.
- [ ] Confirmar resgate de lacuna histórica ao mudar de planejamento.
- [ ] Confirmar progresso parcial de um reforço antes/depois de troca de planejamento.
- [ ] Recalibrar pesos internos de prioridade depois de acumular uma amostra real suficiente.

## Critério de sucesso
A tela deve continuar simples. O usuário resolve normalmente; o StudyNoMentor detecta, seleciona, agenda e mede. O sistema só deve aumentar a intervenção quando a evidência real de resistência/persistência justificar.
