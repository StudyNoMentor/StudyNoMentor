# Auditoria dos cards Study × Anki — 21/09/2026

**Veredito: reprovado para equivalência integral com o Anki.** O núcleo FSRS passou nas comparações numéricas delimitadas abaixo; funcionalidades e persistência apresentam falhas reproduzidas. Nenhum teste finito garante todas as combinações possíveis nem aprendizado humano idêntico. Não foram alterados os módulos de produção nem os dados do usuário.

Código auditado: `StudyNoMentor/StudyNoMentor`, `main` no commit `1691b80dbe52e1f750322781b743c23004a7bc9a`. Backend independente: pacote oficial `anki==26.9.2` (Rust compilado), Python 3.12 e Node 24.19.0. A referência é esta versão fixada do Anki desktop, não uma sessão autenticada do AnkiWeb.

## Execuções e resultados

| Cenário | Cards na coleção | Dias simulados | Dias ativos | Cards efetivamente revisados | Respostas |
|---|---:|---:|---:|---:|---:|
| FSRS, retenção 90%, sem balanceamento | 6.000 | 365 | 330 | 6.000 | 181.572 |
| FSRS, retenção 95%, com balanceamento | 6.000 | 365 | 330 | 6.000 | 190.631 |
| SM-2, mesma coleção e limites | 6.000 | 365 | 330 | 255 | 9.900 |

Total: **382.103 respostas**, sendo **372.203 em FSRS**. Os cenários usam os mesmos IDs sintéticos: são três execuções de coleções de 6.000, não 18.000 cards únicos. Nos dois cenários FSRS, zero estados inválidos, zero divergências de memória contra o porte local e zero diferenças na categoria/valor nominal da prévia versus agendamento. Isso não compara os segundos de fuzz intradiário.

Condições: semente 9212026; 30 novos/dia; 300 revisões/dia; passos 1 e 10 minutos e reaprendizado de 10 minutos; cinco perfis sintéticos de erro (6%, 12%, 23%, 35%, 48%); 35 dias de ausência em dois blocos; até quatro horas de sessão diária; recarga semanal por serialização JSON. As notas são sintéticas e não derivadas da retrievability: o teste mede correção e resistência do software, não eficácia pedagógica ou previsão de retenção humana.

O agendador, configuração e montagem inicial da fila são os módulos reais. Relógio, armazenamento e execução das sessões são controlados pelo harness. A simulação anual não roda a interface, `CardsScreen.answer()` nem o armazenamento real a cada resposta. Esses caminhos receberam testes funcionais separados. O resultado de persistência JSON semanal não certifica localStorage, quota do navegador ou sincronização.

### Comparação independente com Anki

Dos estados finais do primeiro cenário, **5.781 cards estavam em revisão**; os demais 219 não entraram neste replay. Cada um foi submetido às quatro notas no backend oficial: **23.124 transições**, **46.248 comparações escalares de S/D**. Todas passaram com tolerância relativa `1e-5`; erro relativo máximo `2,5661230723796136e-6`. Também passaram fases e atraso nominal de reaprendizado nesses estados.

Foi necessário alinhar as entradas à precisão que o Anki realmente persiste. Exemplo observado: dificuldade `2,0905863426205253` vira `2,091` na coleção Anki. Antes desse alinhamento, 17.354 transições ultrapassavam a tolerância numérica. A comparação normalizada está em `canonical-comparison.json`; a comparação bruta está em `official-anki.json`. O alinhamento separa arredondamento de armazenamento de equações: **não comprova trajetórias anuais idênticas entre os dois programas**.

Após alinhamento, **15.125 intervalos de revisão divergiram nos 17.343 intervalos comparados**. Os geradores de fuzz não foram sincronizados e o backend usa um card temporário reutilizado: esta contagem é evidência de que o teste não demonstrou igualdade de datas, não uma taxa de erro matemático do FSRS. Não se deve classificar todo sorteio diferente como defeito. Limites de fuzz, balanceamento e equivalência de distribuições não foram certificados contra o backend neste replay.

O teste anterior do projeto passou: **21.080/21.080**, mas usa um porte JavaScript mantido no mesmo repositório. A robustez existente também passou: 12 configurações inválidas × 4 fases × 4 notas. Esses checks não cobriam as falhas abaixo. Os testes novos de comportamento e persistência tiveram **19 falhas em 29 verificações direcionadas**; várias verificações se referem ao mesmo problema, não são 19 defeitos independentes.

## Achados prioritários

| Prioridade | Achado reproduzido | Consequência | Origem |
|---|---|---|---|
| Crítica | Histórico limitado às últimas 8.000 revisões. Foram inseridas 180.000; restaram 8.000 e 172.000 foram descartadas. | Perda do histórico anual; limita estatísticas, treino e recálculo da memória. Estado S/D atual não é apagado por esse corte. | `src/js/11-db.js`, `addRevlog` |
| Crítica | Exportação específica de backup de cards não inclui revlog; importação recria todos via `addCard`. | Conteúdo dos 6.000 cards foi preservado, mas os 6.000 estados de revisão viraram novos, sem memória/agendamento anterior. Não confundir com backup completo de perfil, que não foi certificado aqui. | `src/js/44-tela-cards.js`, `exportJson`, `doImport` |
| Alta | SM-2 não atualiza `phase`; um card novo respondido Fácil permanece `new`. | Contadores/fila continuam tratando cards estudados como novos; só 255 cards foram alcançados no ano da simulação. | `src/js/32-card-engine.js`, `_scheduleSM2`; `44-tela-cards.js`, `_bucket` |
| Alta | SM-2 retorna dias diretamente para Errei/Difícil/Bom novos; Fácil altera ease inicial. | Diverge do aprendizado inicial oficial: 60/330/600 segundos e ease 2,5 no Fácil. O backend oficial confirmou esses valores. | `_scheduleSM2`; `anki-new-sm2.json` |
| Alta | Limite do baralho de 1 novo devolveu 20; limite de 0 revisões não bloqueou novos; 10 aprendizados entre dias passaram por limite de 1. | Carga e seleção diária divergem do Anki. | `CardsScreen.buildQueue`, `CardsConfig.newRemaining/revRemaining` |
| Alta | Aprendizado intradiário já vencido apareceu depois de duas revisões numa fila de quatro. | Prioridade de aprendizado não é respeitada em todas as filas. | `CardsScreen.buildQueue` |
| Média | Passos vazios são substituídos por padrões. | Impede desativar reaprendizado/usar modos sem passos como no Anki. | `CardsConfig._passosValidos` |
| Média | Antecipação aceita card com enterramento ativo se ele ainda tiver `dueTs`. | Estado vindo de importação/sync pode reaparecer antes de desenterrar. O enterramento local normalmente zera `dueTs`; portanto esse caso exige a combinação de estado testada. | `CardsScreen._learnAheadQueue` |
| Média | Enterrar e desenterrar aprendizado perde seu timestamp original. | Não restaura o horário intradiário anterior. | `DB.buryCard/unburyCard` |
| Média | CSV com vírgula dentro de campo entre aspas é dividido incorretamente. | Frente, verso e tags são deslocados. TSV simples de 6.000 linhas passou. | `CardsScreen.parseAnkiText` |
| Média | Exportar para Anki remove imagem e áudio e perde formatação HTML. | Não preserva cards multimídia, embora gere cabeçalho HTML. | `CardsScreen.exportAnki`, `CardEngine.plain` |
| Média | Cloze ignora dica `{{c1::Paris::capital}}`. | Não reproduz renderização das dicas do Anki. | `CardEngine.clozeRender` |
| Média | Remoção de revlog usa só timestamp e remove a primeira ocorrência. | Com dois registros no mesmo milissegundo, desfazer a última resposta pode retirar o registro errado. Não foi medida a frequência real dessa colisão. | `DB.removeRevlog` |

Também passaram testes de desfazer simples (campos de agendamento e contador), exclusão com limpeza de histórico/contador, suspensão fora da fila, marcação de bandeira, reset de memória e isolamento de configuração por perfil. O teste de desfazer simples não exige remoção de metadados transitórios como `_leechNow`.

## Divergências identificadas por leitura de código

O otimizador local usa gradiente por diferenças finitas, número próprio de iterações e faixas próprias de parâmetros liberados por volume. Não é uma chamada ao otimizador oficial. O teste antigo de clipping verifica a referência local, sem executar o treino real do aplicativo. **Treinar os mesmos pesos que o Anki não está demonstrado.**

Também não há equivalência integral de notas/modelos/irmãos e baralhos hierárquicos: a configuração declara baralhos planos e cards independentes. Recomendações de retenção e balanceamento têm implementação própria; seus resultados não foram certificados como idênticos. Importar/exportar APKG, modelos, mídia, irmãos, filtros completos, atalhos completos, todos os fusos/DST e combinações de parâmetros não receberam certificação nesta rodada.

## Limites e bloqueio da interface

A instalação do Chromium do projeto falhou por timeout/HTTP 502 no CDN. A tentativa com o runtime alternativo também teve falhas de download. Portanto **testes visuais e ponta a ponta no navegador não foram executados**, e não há aprovação de desempenho da interface, persistência real em navegador, offline, concorrência, sincronização entre dispositivos ou AnkiWeb. Nenhuma base real do usuário foi acessada/modificada.

## Encaminhamento técnico

1. Preservar o histórico completo com armazenamento adequado e backup verificável; não basta retirar o limite e ampliar indefinidamente um único JSON no localStorage.
2. Criar restauração versionada dos cards que preserve identidade, agendamento, revlogs e presets; separar claramente importar conteúdo de restaurar backup.
3. Corrigir a máquina de estados SM-2 e a fila: limites por baralho, aprendizagem entre dias e prioridade intradiária.
4. Resolver formatos, cloze, enterramento e identidade de revisão no desfazer.
5. Reexecutar os testes que hoje falham; executar UI/offline/sync quando o navegador estiver disponível.
6. Para pretensão de equivalência exata, fixar versão e configurações do Anki, comparar trajetória completa com backend oficial, tratar precisão/fuzz e definir quais funcionalidades são deliberadamente diferentes.

Esta entrega é uma auditoria com evidências e testes; **as falhas de produção ainda não foram corrigidas**.

## Reprodução

Na raiz do repositório, use Node 24 e Python 3.12:

```sh
node testes/paridade-anki.mjs
node testes/robustez-config.mjs
TZ=UTC node audit/cards-20260921/simulate.mjs
node audit/cards-20260921/functions.mjs
python -m venv /tmp/anki-audit-env
/tmp/anki-audit-env/bin/pip install -r audit/cards-20260921/requirements-lock.txt
TZ=UTC /tmp/anki-audit-env/bin/python audit/cards-20260921/official_anki.py
node audit/cards-20260921/compare-canonical.mjs
```

`simulate.mjs` e `functions.mjs` saem com código 1 quando detectam as divergências: isso é intencional. Execute os comandos separadamente para continuar após a falha. `vectors.json` e `canonical-vectors.json` são gerados e omitidos do Git; os scripts e resultados resumidos são versionados. O replay oficial utiliza o instante atual apenas como âncora para os dias decorridos; o sorteio de intervalos pode mudar entre execuções. Os resultados numéricos deste relatório correspondem aos arquivos desta rodada, não a uma promessa de intervalos aleatórios reproduzíveis.

Fontes: [manual oficial — opções e limites](https://docs.ankiweb.net/deck-options.html), [código oficial do Anki](https://github.com/ankitects/anki), [distribuição oficial do backend usado](https://pypi.org/project/anki/26.9.2/).
