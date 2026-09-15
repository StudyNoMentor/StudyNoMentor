# Integração TEC

## Como funciona

O menu **Integração TEC** abre `tecconcursos.com.br` em um quadro dentro do StudyNoMentor. O navegador mantém o login no próprio domínio do TEC. O userscript StudyMentor V21 captura a questão resolvida e envia ao quadro pai por `postMessage`. O Study aceita mensagens apenas do domínio oficial do TEC e grava os dados no perfil ativo.

Caso o login incorporado seja bloqueado pelo navegador, use **Abrir separado** e depois exporte o JSON pelo userscript. O botão **Importar JSON** aceita o formato das versões 20.3 e 21.

## Assistente de IA

A tela chama a Edge Function autenticada `tec-ai`. A chave do provedor existe somente no ambiente da função; ela nunca é incluída no HTML, no armazenamento do navegador ou no userscript.

Variáveis necessárias:

- `OPENAI_API_KEY`: chave secreta usada exclusivamente pela Edge Function.
- `OPENAI_MODEL`: modelo da Responses API; o padrão é `gpt-5-mini`.

Implantação com Supabase CLI:

```sh
supabase secrets set OPENAI_API_KEY=... OPENAI_MODEL=gpt-5-mini
supabase functions deploy tec-ai
```

O projeto deve manter a verificação JWT da função habilitada. O cliente envia a sessão do Study e a função limita cada usuário a 12 pedidos por minuto por instância, aplica timeout de 45 segundos e registra apenas identificadores técnicos de falha.

## Dados e cache

Cada registro usa `conta TEC anonimizada + caderno + questão` como chave. A análise acrescenta a versão do prompt à chave de cache. Trocar `PROMPT_VERSION` em `src/js/94-tec-integracao.js` invalida as análises anteriores sem apagar as questões.

As abas Diagnóstico, Revisão, Flashcards, Teste, Reforço e Professor compartilham a questão e o histórico. O botão de análise reprocessa a aba selecionada; a primeira execução pode gerar o conjunto completo. O Professor recebe a questão, o histórico e a pergunta atual.
