# Manual operacional — Módulo Robusto V5

## Propósito

O Robusto é o motor estratégico do StudyNoMentor. Sua finalidade é responder duas perguntas diferentes:

1. **Onde investir o tempo agora?** — ranking + otimização global.
2. **Como atacar a fraqueza escolhida?** — roteador pedagógico.

Ele é independente do Simplificado. O Simplificado funciona como baseline transparente; o Robusto pode usar Plano, histórico de resposta, incidência, risco, tempo e aprendizado.

## Fluxo da decisão

1. Lê o retrato TEC já limitado pelo Escopo da Análise.
2. Lê o Plano apenas para o motor Robusto.
3. Resolve meta operacional, amostra mínima e validade.
4. Classifica domínio probabilisticamente.
5. Calibra resposta histórica em tópico → disciplina → global.
6. Mede incidência e confiança do casamento.
7. Estima velocidade pessoal somente quando a amostra é confiável.
8. Calcula componentes de score diferentes no pré e pós-edital.
9. Aplica aprendizado conservador, se habilitado e sustentado por evidência.
10. Escolhe a intervenção pedagógica.
11. O otimizador seleciona conjuntamente até três disciplinas sob orçamento de tempo.
12. Extras recebe uma única fila de execução.
13. Resultados fechados retroalimentam a calibração/aprendizado do Robusto.

## Perfis de ataque

### 🧱 Base ampla

Pré-edital, construção de repertório e fechamento de lacunas. Privilegia lacuna, evidência e eficiência sem deixar incidência dominar cedo demais.

### 🎯 Edital publicado

Quando composição e banca já importam diretamente. Pontos recuperáveis e pontos por minuto ganham peso maior.

### ⏱️ Tempo curto

Prioriza retorno sob forte restrição temporal. Usa blocos menores e peso alto para eficiência/pontos por minuto.

### 🛡️ Manutenção

Preserva conhecimento já conquistado. Recência, queda e resposta histórica ganham importância.

### 🔍 Diagnóstico

Produz evidência antes de personalizar demais. A amostra mínima é menor e otimização/aprendizado ficam conservadores por padrão.

## Grupos do painel avançado

### Recursos

Liga/desliga roteador, otimizador, aprendizado, tempo pessoal, fallback e a própria política especialista. Desligar um componente não muda o Simplificado.

### Fontes e elegibilidade

Controla se meta, amostra e validade são herdadas do Plano ou definidas especificamente para o Robusto.

### Domínio 90+ e risco

Controla as metas competitiva/elite, força do prior, probabilidades mínimas, margem para confirmar lacuna, proteção eliminatória e redução de prioridade para tópicos já dominados.

### Calibração hierárquica

Define quanto histórico é necessário antes de personalizar um tópico, a força do shrinkage e limites para converter histórico de ganho em expectativa de resposta.

### Aprendizado de pesos

Define quando o motor pode aprender com ciclos anteriores e quanto essa aprendizagem pode alterar os pesos configurados. O sinal precisa ser consistente em duas metades do histórico.

### Tempo e dose diária

Define quando o ritmo pessoal se torna confiável, limites plausíveis de segundos/questão e tamanho dos blocos diários. A dose diária nunca substitui o alvo global.

### Incidência e matching

Define a confiança atribuída ao casamento estruturado, por nome e ao fallback legado. Matching menos confiável recebe desconto.

### Roteador pedagógico

Controla quando usar diagnóstico, manutenção, revisão, teoria, Lei Seca, flashcards ou questões dirigidas, além dos tempos e limiares de cada intervenção.

### Score pré-edital

Pesos de lacuna, evidência, incidência, recência, resposta histórica e eficiência.

### Score pós-edital

Pesos de pontos recuperáveis, pontos/minuto, lacuna, incidência, recência e resposta histórica.

### Otimizador global

Define orçamento total, máximo por frente, penalidade por excesso, piso por frente, fallback de tempo, bônus eliminatório, pesos de utilidade e limites do espaço combinatório.

## Controles de gestão

- **↺ por parâmetro:** restaura somente aquele valor.
- **↺ Restaurar grupo:** restaura todos os parâmetros daquele grupo.
- **↺ Restaurar modo:** restaura o perfil de ataque selecionado.
- **Buscar:** localiza rapidamente um parâmetro.
- **Só alterados:** mostra apenas desvios dos defaults.
- **Exportar JSON:** guarda toda a política configurada dos cinco modos.
- **Importar JSON:** restaura uma configuração previamente exportada.
- **Manual / PDF:** abre este conteúdo em versão preparada para impressão e “Salvar como PDF”.

## Invariantes que não são editáveis

Esses itens são contratos do produto, não parâmetros de tuning:

- até 3 disciplinas distintas por rodada;
- 1 tópico por disciplina;
- alvo global nunca é substituído pela dose diária;
- o Robusto não lê configuração do Simplificado;
- se fallback de tempo estiver desligado, o sistema não inventa ritmo.

## Interpretação dos defaults

Os padrões são **defaults técnicos conservadores**, não constantes científicas universais. Foram escolhidos para reduzir decisões com pouca evidência, limitar overfitting e preservar estabilidade operacional. O aprendizado automático é deliberadamente limitado e reversível.

## Recomendações de ajuste

1. Mude poucos parâmetros por vez.
2. Prefira alterar um perfil de ataque em vez de todos os cinco simultaneamente.
3. Não reduza agressivamente amostra mínima, ciclos de calibração e confiança ao mesmo tempo.
4. Use fallback temporal apenas se aceitar trabalhar com uma estimativa em vez do ritmo observado.
5. Se o ranking ficar instável, restaure primeiro Aprendizado, Domínio e Calibração.
6. Se as atividades ficarem grandes ou pequenas demais, revise Tempo, Roteador e Otimizador antes de alterar meta global.

## Auditoria

A especificação de independência completa está em `docs/auditoria-independencia-motores-v5.md`. O CI deve falhar se um motor passar a consumir estado, preferências, fórmula ou storage do outro.
